// =====================================================================
// Log History: filterable audit trail, PDF export, reset (primary admin only)
// =====================================================================
function logLocalDay(l) { const d = new Date(l.at); return isNaN(d) ? String(l.at).slice(0, 10) : localDate(d); }

function logFilters() {
    return { q: lc($("log-search").value).trim(), act: $("log-action").value, from: $("log-from").value, to: $("log-to").value };
}

function filterLogs(list, f) {
    return list.filter(l => {
        const day = logLocalDay(l);
        if (f.act !== "ALL" && l.action !== f.act) return false;
        if (f.from && day < f.from) return false;
        if (f.to && day > f.to) return false;
        if (!f.q) return true;
        return [l.by, l.byName, l.action, l.assetLabel, l.category, l.note, ...(l.changes || []).map(c => `${c.field} ${c.from} ${c.to}`)].map(lc).join(" ").includes(f.q);
    });
}

// ---------- paging ----------
// Only the newest LOG_PAGE entries are live (1 read each when the app opens). "Load older" reads the next
// LOG_PAGE (1 read each). Entries that slide out of the live page as new ones arrive are kept in `logOlder`.
const LOG_PAGE = 50;
let logLive = [], logOlder = new Map(), logNoMore = false, logLoading = false, logStarted = false, logWatch = null;
function resetLogPages() { logLive = []; logOlder = new Map(); logNoMore = false; logLoading = false; logs = []; logStarted = false; }
// Opening the app costs no log reads; the newest page starts listening when Log History is first opened.
function startLogs() {
    if (logStarted || !logWatch || !tabOn("logs")) return;
    logStarted = true;
    logWatch();
}
function mergeLogs() {
    const ids = new Set(logLive.map(l => l.id));
    logs = logLive.concat([...logOlder.values()].filter(l => !ids.has(l.id))).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
function onLiveLogs(rows) {
    const oldest = rows.length ? rows[rows.length - 1].at : "";
    const keep = new Set(rows.map(r => r.id));
    // Entries that dropped off the bottom of the live page (pushed out by newer ones) stay on screen.
    logLive.forEach(l => { if (!keep.has(l.id) && oldest && String(l.at) <= String(oldest)) logOlder.set(l.id, l); });
    if (!logOlder.size) logNoMore = rows.length < LOG_PAGE;   // the live page holds everything there is
    logLive = rows;
    mergeLogs();
}
async function loadOlderLogs() {
    if (logLoading || logNoMore || !logs.length) return;
    logLoading = true; renderLogs();
    try {
        const oldest = logs[logs.length - 1].at;
        const more = await store.getAll("logs", { where: [["at", "<", oldest]], orderBy: ["at", "desc"], limit: LOG_PAGE });
        more.forEach(l => logOlder.set(l.id, l));
        if (more.length < LOG_PAGE) logNoMore = true;
        mergeLogs();
    } catch (err) { toast(friendlyError(err), "err"); }
    logLoading = false;
    renderLogs();
}

const actionClass = a => /deleted|replaced|reject|reset|disabled|missing|cancel/i.test(a) ? "danger"
    : /^maint|repair|in-house/i.test(a) ? "maint" : /^loan/i.test(a) ? "loan" : /^show/i.test(a) ? "show" : "";

function renderLogs() {
    const body = $("log-list");
    if (!body || !tabOn("logs")) return;
    startLogs();
    const sel = $("log-action");
    const cur = sel.value;
    const actions = uniq(logs.map(l => l.action)).sort();
    sel.innerHTML = `<option value="ALL">All actions</option>` + actions.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
    sel.value = actions.includes(cur) ? cur : "ALL";

    const list = filterLogs(logs, logFilters());
    const shown = list.slice(0, 300);
    body.innerHTML = shown.length ? shown.map(l => `<tr>
        <td class="nowrap">${fmtDateTime(l.at)}</td>
        <td><div class="who">${esc(l.byName || l.by)}<span>${esc(l.by)}</span></div></td>
        <td><span class="log-action ${actionClass(String(l.action || ""))}">${esc(l.action)}</span></td>
        <td>${l.assetLabel ? `<b>${esc(l.assetLabel)}</b>` : "—"}${l.category ? `<div class="muted small">${esc(l.category)}</div>` : ""}</td>
        <td>${(l.changes || []).length ? l.changes.map(c => `<div class="chg"><span>${esc(FIELD_LABEL[c.field] || c.field)}</span> <s>${esc(c.from || "∅")}</s> → <b>${esc(c.to || "∅")}</b></div>`).join("") : `<span class="muted small">—</span>`}</td>
        <td class="desc">${esc(l.note)}</td>
    </tr>`).join("") : `<tr><td colspan="6" class="empty-cell">No log entries${logs.length ? " match these filters" : " yet"}</td></tr>`;
    const more = $("log-more");
    if (more) {
        more.classList.toggle("hidden", logNoMore || !logs.length);
        more.disabled = logLoading;
        more.textContent = logLoading ? "Loading…" : `Load ${LOG_PAGE} older entries`;
    }
    $("log-footnote").textContent = `Showing ${shown.length} of ${list.length} matching entries · ${logs.length} newest loaded`
        + (logNoMore ? " (that's everything)." : ". Search and filters only look through loaded entries; load older ones to go further back.");
}

// ---------- PDF ----------
function openLogPdf() {
    if (!can("logs", "pdf") || !tabOn("logs")) return;
    const f = logFilters();
    const filtered = f.q || f.act !== "ALL" || f.from || f.to;
    showModal({
        title: "Download Activity Log (PDF)", size: "sm", body: `
        <form id="pdf-form" class="form-stack" novalidate>
            <div class="field"><label>What to include</label>
                <label class="radio-row"><input type="radio" name="pdf-scope" value="filtered" ${filtered ? "checked" : "disabled"}> Current filters${f.from || f.to ? " (reads only the chosen dates)" : ""}</label>
                <label class="radio-row"><input type="radio" name="pdf-scope" value="all" ${filtered ? "" : "checked"}> Full history <span id="pdf-count" class="muted small"></span></label>
            </div>
            <p class="muted small">The PDF reads every entry it includes from the database (1 read each), not just the ones on screen.</p>
            <label class="radio-row"><input type="checkbox" id="pdf-changes" checked> Include field changes</label>
            <p id="pdf-error" class="error-msg hidden"></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">Download PDF</button></div>
        </form>`,
        onMount(root) {
            if (store.count) store.count("logs").then(n => {
                const el = root.querySelector("#pdf-count");
                if (el && n != null) el.textContent = `· ${n.toLocaleString()} entries, about ${n.toLocaleString()} reads`;
            }).catch(() => {});
            root.querySelector("#pdf-form").addEventListener("submit", async e => {
                e.preventDefault();
                const btn = root.querySelector("button[type=submit]");
                btn.disabled = true; btn.textContent = "Building…";
                try {
                    const scope = root.querySelector("input[name=pdf-scope]:checked").value;
                    const all = await store.getAll("logs", logPdfQuery(scope === "filtered" ? f : null));
                    const rows = scope === "filtered" ? filterLogs(all, f) : all;
                    if (!rows.length) throw new Error("There are no log entries to export.");
                    await buildLogPdf(rows, { filters: scope === "filtered" ? f : null, changes: root.querySelector("#pdf-changes").checked });
                    closeDynModal();
                    toast(`PDF ready · ${rows.length} entries`);
                } catch (er) {
                    console.error(er);
                    const p = root.querySelector("#pdf-error"); p.textContent = friendlyError(er); p.classList.remove("hidden");
                    btn.disabled = false; btn.textContent = "Download PDF";
                }
            });
        }
    });
}

// With a date filter, read only those days (a day's margin each side: entries are stored in UTC).
function logPdfQuery(f) {
    const where = [];
    const shift = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString();
    if (f && f.from) where.push(["at", ">=", shift(f.from, -1)]);
    if (f && f.to) where.push(["at", "<", shift(f.to, 2)]);
    return where.length ? { where, orderBy: ["at", "desc"] } : { orderBy: ["at", "desc"] };
}

async function buildLogPdf(rows, opts) {
    const f = opts.filters;
    const filterText = f ? [f.q && `search "${f.q}"`, f.act !== "ALL" && `action: ${f.act}`, f.from && `from ${f.from}`, f.to && `to ${f.to}`].filter(Boolean).join(", ") : "none (full history)";
    const r = await newReport({ title: "Activity Log report", meta: [
        `${rows.length} entries | ${pdfDate(rows[rows.length - 1].at)} - ${pdfDate(rows[0].at)}`, `Filters: ${filterText}` ] });
    r.table({
        head: [["When", "User", "Action", "Asset", ...(opts.changes ? ["Changes"] : []), "Note"]],
        body: rows.map(l => [
            pdfText(new Date(l.at).toLocaleString(undefined, { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })),
            pdfText(`${l.byName || ""}\n${l.by || ""}`),
            pdfText(l.action),
            pdfText([l.assetLabel, l.category].filter(Boolean).join("\n")),
            ...(opts.changes ? [pdfText((l.changes || []).map(c => `${FIELD_LABEL[c.field] || c.field}: ${c.from || "(blank)"} -> ${c.to || "(blank)"}`).join("\n"))] : []),
            pdfText(l.note)
        ]),
        columnStyles: opts.changes
            ? { 0: { cellWidth: 30 }, 1: { cellWidth: 40 }, 2: { cellWidth: 34, fontStyle: "bold" }, 3: { cellWidth: 36 }, 4: { cellWidth: 62 }, 5: { cellWidth: "auto" } }
            : { 0: { cellWidth: 30 }, 1: { cellWidth: 46 }, 2: { cellWidth: 40, fontStyle: "bold" }, 3: { cellWidth: 48 }, 4: { cellWidth: "auto" } }
    });
    return r.save(`Log_History_${today()}.pdf`);
}

async function resetLog() {
    if (!isPrimary()) return;
    const typed = await uiConfirm({ title: "Reset Activity Log?", danger: true, confirmText: "Delete all log entries",
        message: "This permanently deletes ALL log history from the app. The Google Sheet backup keeps its copy.\nDownload the PDF first if you need it.",
        input: { label: "Type RESET to confirm", match: "RESET", required: true } });
    if (!typed) return;
    try {
        const n = await store.deleteAll("logs");
        resetLogPages();
        await commitOps([makeLog("Log reset", null, [], `${n} entries cleared by the primary admin`)]);
        toast(`Log reset · ${n} entries removed`);
    } catch (err) { toast(friendlyError(err), "err"); }
}
