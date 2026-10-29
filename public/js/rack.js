// =====================================================================
// Rack Layout + Inventory Check.
// Both views show the same tree:  Space  ›  Location panel  ›  Category accordion  ›  asset rows.
// Inventory Check runs per-venue rounds (one open round per Item Space). Each round has its own ticks;
// finishing a round freezes a summary into History (kept until someone with permission deletes it).
// =====================================================================
const rackState = { rack: new Map(), check: new Map() }; // node key -> open?
let checkTab = "current";
let selectedRound = null;

const openRounds = () => audits.filter(a => a.status === "open").sort((a, b) => String(a.venue).localeCompare(String(b.venue)));
const closedRounds = () => audits.filter(a => a.status === "closed").sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt)));
function curRound() {
    const open = openRounds();
    if (!open.length) return null;
    return open.find(r => r.id === selectedRound) || open[0];
}
const inVenue = (a, venue) => (dv(a.itemSpace) || UNASSIGNED) === venue && !RETIRED.includes(a.condition);
const roundScope = r => r ? inventory.filter(a => inVenue(a, r.venue)) : [];

function rackItems(mode) {
    const q = lc($(`${mode}-search`).value).trim();
    if (mode === "check") {
        const r = curRound();
        const uncheckedOnly = $("check-unchecked").checked;
        return roundScope(r).filter(a => (!q || searchHay(a).includes(q)) && (!uncheckedOnly || !isChecked(a.id)));
    }
    const space = $("rack-space").value, cat = $("rack-category").value, retired = $("rack-retired").checked;
    return inventory.filter(a =>
        (retired || !RETIRED.includes(a.condition)) &&
        (space === "ALL" || dv(a.itemSpace) === space) &&
        (cat === "ALL" || a.category === cat) &&
        (!q || searchHay(a).includes(q)));
}

// Assets with no Item Space / Item Location are grouped under "TBC" (to be confirmed).
const UNASSIGNED = "TBC";
const tbcTag = v => v === UNASSIGNED ? ` <span class="tbc-tag" title="No item space / location recorded yet - to be confirmed">to be confirmed</span>` : "";
// One shared collator: localeCompare with options builds a new one per call, which was slow over thousands of assets.
const numCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const byNum = (a, b) => numCollator.compare(a, b);

function buildTree(items) {
    const tree = new Map();
    items.forEach(a => {
        const s = dv(a.itemSpace) || UNASSIGNED, l = dv(a.itemLocation) || UNASSIGNED, c = a.category || "Uncategorised";
        if (!tree.has(s)) tree.set(s, new Map());
        const locs = tree.get(s);
        if (!locs.has(l)) locs.set(l, new Map());
        const cats = locs.get(l);
        if (!cats.has(c)) cats.set(c, []);
        cats.get(c).push(a);
    });
    const sortKeys = m => [...m.keys()].sort((a, b) => (a === UNASSIGNED) - (b === UNASSIGNED) || byNum(a, b));
    return { tree, sortKeys };
}

// Searching opens every matching location and category, but only for a manageable number of matches:
// opening thousands of rows at once froze the page (e.g. typing one letter with 4,000 assets).
const SEARCH_OPEN_MAX = 150;
// Rows drawn per open category until "Show all" is pressed.
const CAT_ROWS = 100;
const showAllCats = { rack: new Set(), check: new Set() };
// Typing waits for a short pause before redrawing.
const debounce = (fn, ms) => { let t = null; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
const renderRackSoon = debounce(() => renderRack(), 250);
const renderCheckSoon = debounce(() => renderCheck(), 250);

function nodeOpen(mode, key, def) {
    const m = rackState[mode];
    return m.has(key) ? m.get(key) : def;
}

const EXPAND_ALL_MAX = 1000;
function rackExpandAll(mode, open) {
    const items = rackItems(mode);
    // Opening every category of thousands of assets would freeze the page: open the locations only.
    const cats = !open || items.length <= EXPAND_ALL_MAX;
    items.forEach(a => {
        const s = dv(a.itemSpace) || UNASSIGNED, l = dv(a.itemLocation) || UNASSIGNED, c = a.category || "Uncategorised";
        rackState[mode].set(`L|${s}|${l}`, open);
        if (cats) { rackState[mode].set(`C|${s}|${l}|${c}`, open); rackState[mode].set(`S|${s}|${l}|${c}|${subKeyOf(a)}`, open); }
    });
    if (!cats) toast(`${items.length.toLocaleString()} assets is too many to open at once, so only the locations are open. Pick a space or category, or search, then Expand all.`);
    mode === "rack" ? renderRack() : renderCheck();
}

function condMiniBar(items) {
    const c = {};
    items.forEach(a => { c[a.condition] = (c[a.condition] || 0) + units(a); });
    return `<span class="mini-bar" title="${esc(Object.entries(c).map(([k, v]) => `${k}: ${v}`).join(" · "))}">${CONDITIONS.filter(k => c[k]).map(k => `<span class="${condClass(k)}" style="flex:${c[k]}"></span>`).join("")}</span>`;
}
function progressHtml(done, total, cls) {
    const pct = total ? Math.round(done * 100 / total) : 0;
    return `<span class="progress ${done === total && total ? "done" : ""} ${cls || ""}"><span class="bar"><span style="width:${pct}%"></span></span>${done}/${total}</span>`;
}

function renderTree(mode) {
    const host = $(`${mode}-container`);
    if (!host || !profile) return;
    if (!invLoaded) { host.innerHTML = `<div class="empty-state">Connecting to database…</div>`; return; }
    const isCheck = mode === "check";
    if (isCheck && !curRound()) { host.innerHTML = ""; return; }
    const items = rackItems(mode);
    if (!items.length) {
        host.innerHTML = `<div class="empty-state">${inventory.length ? "Nothing matches these filters." : "No assets yet."}</div>`;
        return;
    }
    const searchOn = !!$(`${mode}-search`).value.trim();
    const searching = searchOn && items.length <= SEARCH_OPEN_MAX;
    const { tree, sortKeys } = buildTree(items);
    const inline = !isCheck && inlineOn();
    const hasGeneral = items.some(isGeneral);
    const cols = visibleColumns(["internalAssetNo", "qty", "serialNo", "condition", "yearOfPurchase", "remarks"], hasGeneral);
    const nameCol = cols.findIndex(c => c.key === "internalAssetNo") + 1;
    const canTick = isCheck && tabOn("check");

    const leafRow = a => {
        const tick = checks[tickId(a.id)];
        const done = isChecked(a.id);
        const cells = cols.map(c => assetCell(a, c, inline));
        cells.splice(nameCol, 0, `<td class="leaf-model">${esc(dv(a.brand) === "Generic" ? "" : dv(a.brand))} <span>${esc(dv(a.model))}</span></td>`);
        const checkCell = isCheck ? `<td class="leaf-check"><input type="checkbox" class="check-box" data-id="${esc(a.id)}" ${done ? "checked" : ""} ${canTick ? "" : "disabled"} aria-label="Verified ${esc(assetLabel(a))}"></td>` : "";
        const by = isCheck ? `<td class="check-by">${done ? `✓ ${esc(tick.byName || tick.by)} · ${fmtDateTime(tick.at)}` : ""}</td>` : "";
        const extra = isCheck && can("check", "report") && !pendingDiscFor(a.id) ? `<button type="button" class="btn btn-sm" data-action="discrepancy" data-id="${esc(a.id)}" title="Report a discrepancy for this asset">⚑ Report</button> ` : "";
        return `<tr class="${done && isCheck ? "is-checked" : ""}">${checkCell}${cells.join("")}${by}${assetActions(a, extra)}</tr>`;
    };
    const headRow = `<tr>${isCheck ? `<th class="leaf-check">✓</th>` : ""}${cols.map((c, i) => (i === nameCol ? `<th>Model</th>` : "") + `<th>${esc(c.label)}</th>`).join("")}${nameCol === cols.length ? "<th>Model</th>" : ""}${isCheck ? "<th>Checked</th>" : ""}<th></th></tr>`;

    const locCount = [...tree.values()].reduce((n, m) => n + m.size, 0);
    // Opening a location or category redraws only that location (locHtml), not the whole tree.
    const ctx = treeCtx[mode] = { mode, isCheck, searching, inline, headRow, leafRow, tree, sortKeys, locDefault: locCount <= LOC_OPEN_MAX };
    const doneOf = list => isCheck ? list.filter(a => isChecked(a.id)).length : 0;
    const hint = searchOn && !searching ? `<div class="av-banner search-hint">${items.length.toLocaleString()} matches. Type more to narrow them down, or open a location or category below to see its matches.</div>` : "";
    host.innerHTML = hint + sortKeys(tree).map(space => {
        const locs = tree.get(space);
        const spaceItems = [...locs.values()].flatMap(m => [...m.values()].flat());
        return `<section class="rack-space">
            <div class="rack-space-head"><h2>${esc(space)}${tbcTag(space)}</h2>
                <span class="meta">${plural(locs.size, "location")} · ${plural(spaceItems.reduce((n, a) => n + units(a), 0), "unit")}</span>
                ${isCheck ? progressHtml(doneOf(spaceItems), spaceItems.length) : ""}</div>
            ${sortKeys(locs).map(loc => locHtml(ctx, space, loc)).join("")}
        </section>`;
    }).join("");
}

// Locations start open when there are only a few; with hundreds the page lists them closed.
const LOC_OPEN_MAX = 40;
const treeCtx = { rack: null, check: null };
function locHtml(ctx, space, loc) {
    const { mode, isCheck, searching, inline, headRow, leafRow, sortKeys } = ctx;
    const cats = ctx.tree.get(space).get(loc);
    const doneOf = list => isCheck ? list.filter(a => isChecked(a.id)).length : 0;
    const locItems = [...cats.values()].flat();
    const lKey = `L|${space}|${loc}`;
    const lOpen = searching || nodeOpen(mode, lKey, ctx.locDefault);
    return `<div class="rack-loc" data-space="${esc(space)}" data-loc="${esc(loc)}">
        <button type="button" class="rack-loc-head" data-node="${esc(lKey)}" aria-expanded="${lOpen}">
            <span class="chev ${lOpen ? "open" : ""}">▶</span>
            <span class="loc-name"><span class="crumb">${esc(space)} ›</span> ${esc(loc)}${tbcTag(loc)}</span>
            <span class="loc-meta">${plural(locItems.length, "item")} · ${plural(cats.size, "type")}</span>
            <span class="loc-right">${isCheck ? progressHtml(doneOf(locItems), locItems.length) : condMiniBar(locItems)}</span>
        </button>
        ${lOpen ? `<div class="rack-loc-body">${sortKeys(cats).map(cat => {
            const cKey = `C|${space}|${loc}|${cat}`;
            const cOpen = searching || nodeOpen(mode, cKey, isCheck);
            // Only an open category needs its rows in order.
            const list = cOpen ? cats.get(cat).map(a => [assetLabel(a), a]).sort((x, y) => byNum(x[0], y[0])).map(x => x[1]) : cats.get(cat);
            const cc = {};
            list.forEach(a => { cc[a.condition] = (cc[a.condition] || 0) + units(a); });
            const all = showAllCats[mode].has(cKey);
            return `<div class="rack-cat">
                <button type="button" class="rack-cat-head" data-node="${esc(cKey)}" aria-expanded="${cOpen}">
                    <span class="chev ${cOpen ? "open" : ""}">▶</span>${esc(cat)} <span class="count">(${list.reduce((n, a) => n + units(a), 0)})</span>
                    <span class="pills">${isCheck ? progressHtml(doneOf(list), list.length) : Object.entries(cc).map(([k, v]) => `<span class="pill ${condClass(k)}">${v} ${esc(COND_SHORT[k] || k)}</span>`).join("")}</span>
                </button>
                ${cOpen ? `<div class="rack-cat-body">${subsOf(list) ? subsHtml(ctx, mode, cKey, list) : tableHtml(ctx, mode, cKey, list)}</div>` : ""}
            </div>`;
        }).join("")}</div>` : ""}
    </div>`;
}
// v5.14: a long category splits into one sub-group per model (e.g. Wireless -> Shure ADX 2, Sennheiser EW-DX SKM-S), each opened on its own.
const SUB_MIN = 8;
const subKeyOf = a => `${dv(a.brand) === "Generic" ? "" : dv(a.brand)} ${dv(a.model)}`.trim() || "No model";
function subsOf(list) {
    if (list.length <= SUB_MIN) return null;
    const m = new Map();
    list.forEach(a => { const k = subKeyOf(a); if (!m.has(k)) m.set(k, []); m.get(k).push(a); });
    return m.size >= 2 ? m : null;
}
function tableHtml(ctx, mode, key, list) {
    const all = showAllCats[mode].has(key);
    return `<div class="table-scroll"><table class="asset-table leaf-table ${ctx.inline ? "inline-on" : ""}">
        <thead>${ctx.headRow}</thead><tbody>${(all ? list : list.slice(0, CAT_ROWS)).map(ctx.leafRow).join("")}</tbody></table></div>
        ${list.length > CAT_ROWS && !all ? `<div class="cat-more"><button type="button" class="btn btn-sm" data-cat-all="${esc(key)}">Show all ${list.length.toLocaleString()}</button> <span class="muted small">Showing the first ${CAT_ROWS}</span></div>` : ""}`;
}
function subsHtml(ctx, mode, cKey, list) {
    const { isCheck, searching } = ctx;
    const subs = subsOf(list);
    const doneOf = l => isCheck ? l.filter(a => isChecked(a.id)).length : 0;
    return [...subs.keys()].sort((x, y) => byNum(x, y)).map(name => {
        const items = subs.get(name);
        const sKey = `S|${cKey.slice(2)}|${name}`;
        const sOpen = searching || nodeOpen(mode, sKey, false);
        const cc = {};
        items.forEach(a => { cc[a.condition] = (cc[a.condition] || 0) + units(a); });
        const desc = dv((items.find(a => dv(a.description)) || {}).description);
        const rows = sOpen ? items.map(a => [assetLabel(a), a]).sort((x, y) => byNum(x[0], y[0])).map(x => x[1]) : items;
        return `<div class="rack-sub">
            <button type="button" class="rack-sub-head" data-node="${esc(sKey)}" aria-expanded="${sOpen}">
                <span class="chev ${sOpen ? "open" : ""}">▶</span><b>${esc(name)}</b> <span class="count">(${items.reduce((n, a) => n + units(a), 0)})</span>
                ${desc ? `<span class="sub-desc">${esc(desc)}</span>` : ""}
                <span class="pills">${isCheck ? progressHtml(doneOf(items), items.length) : Object.entries(cc).map(([k, v]) => `<span class="pill ${condClass(k)}">${v} ${esc(COND_SHORT[k] || k)}</span>`).join("")}</span>
            </button>
            ${sOpen ? `<div class="rack-sub-body">${tableHtml(ctx, mode, sKey, rows)}</div>` : ""}
        </div>`;
    }).join("");
}

// Redraw just the location an open/close or "Show all" happened in.
function redrawLoc(mode, el) {
    const box = el.closest(".rack-loc"), ctx = treeCtx[mode];
    const locs = ctx && box && ctx.tree.get(box.dataset.space);
    if (!locs || !locs.has(box.dataset.loc)) return renderTree(mode);
    box.outerHTML = locHtml(ctx, box.dataset.space, box.dataset.loc);
}

function renderRack() { renderTree("rack"); }

document.addEventListener("click", e => {
    const more = e.target.closest("[data-cat-all]");
    if (more) {
        const mode = more.closest("#check-container") ? "check" : "rack";
        showAllCats[mode].add(more.dataset.catAll);
        redrawLoc(mode, more);
        return;
    }
    const node = e.target.closest("[data-node]");
    if (!node) return;
    const mode = node.closest("#check-container") ? "check" : node.closest("#rack-container") ? "rack" : null;
    if (!mode) return;
    rackState[mode].set(node.dataset.node, node.getAttribute("aria-expanded") !== "true");
    redrawLoc(mode, node);
});

// =====================================================================
// Inventory Check: rounds per venue
// =====================================================================
const tickId = assetId => { const r = curRound(); return r ? `${r.id}_${assetId}` : `none_${assetId}`; };
// A round's ticks are saved in a few shared records, checkTicks/{roundId}_{n} (about 200 assets each),
// so opening Inventory Check reads one record per 200 assets instead of one per tick.
// The number of records is fixed when the round starts (audit.shards); each asset always goes to the same one.
const TICKS_PER_RECORD = 200;
const tickRecords = n => Math.max(1, Math.ceil(n / TICKS_PER_RECORD));
function tickShard(assetId, n) {
    let h = 0;
    for (const ch of String(assetId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % Math.max(1, n || 1);
}
function isChecked(id) { const c = checks[tickId(id)]; return !!(c && c.checked); }

function renderCheck() {
    document.querySelectorAll("[data-check-tab]").forEach(b => b.classList.toggle("active", b.dataset.checkTab === checkTab));
    $("check-current").classList.toggle("hidden", checkTab !== "current");
    $("check-history").classList.toggle("hidden", checkTab !== "history");
    if (checkTab === "history") return renderCheckHistory();
    renderRoundPicker(); renderRoundBanner(); renderReview(); renderTree("check");
    $("check-filters").classList.toggle("hidden", !curRound());
}

document.addEventListener("click", e => {
    const t = e.target.closest("[data-check-tab]");
    if (t) { checkTab = t.dataset.checkTab; renderCheck(); return; }
    const r = e.target.closest("[data-round]");
    if (r) { selectedRound = r.dataset.round; renderCheck(); }
});

function renderRoundPicker() {
    const el = $("check-rounds");
    const open = openRounds();
    const cur = curRound();
    if (!open.length) {
        el.innerHTML = `<div class="empty-state">No check round is running.${can("check", "rounds") ? ` Use <b>Start new round</b> and pick the venue to check.` : " Ask an Admin / Co-Admin to start one for your venue."}</div>`;
        return;
    }
    el.innerHTML = `<span class="muted small">Open rounds</span>` + open.map(r => {
        const scope = roundScope(r);
        const done = scope.filter(a => checks[`${r.id}_${a.id}`] && checks[`${r.id}_${a.id}`].checked).length;
        return `<button type="button" class="round-chip ${cur && cur.id === r.id ? "active" : ""}" data-round="${esc(r.id)}">
            <b>${esc(r.venue)}</b><span>${esc(r.name)}</span>${progressHtml(done, scope.length)}</button>`;
    }).join("");
}

function renderRoundBanner() {
    const el = $("check-round");
    const r = curRound();
    el.classList.toggle("hidden", !r);
    if (!r) { el.innerHTML = ""; return; }
    const scope = roundScope(r);
    const done = scope.filter(x => isChecked(x.id)).length;
    const pending = discrepancies.filter(d => d.status === "pending" && scope.some(a => a.id === d.assetId)).length;
    el.innerHTML = `
        <div class="stat"><span>Venue</span><span class="round-name">${esc(r.venue)} · ${esc(r.name)}</span>
            <span>Started ${fmtDateTime(r.startedAt)} by ${esc(r.startedByName || r.startedBy)}</span></div>
        <div class="stat"><b>${done} / ${scope.length}</b><span>records verified</span></div>
        ${progressHtml(done, scope.length)}
        <div class="stat"><b>${scope.length - done}</b><span>still to check</span></div>
        <div class="stat"><b>${pending}</b><span>discrepancies pending</span></div>
        ${can("check", "rounds") ? `<button type="button" class="btn btn-ok btn-sm" onclick="finishRound()">Finish round</button>` : ""}`;
}

async function toggleCheck(id, on) {
    const r = curRound();
    if (!tabOn("check") || !r) return;
    try {
        // A merge that only touches this asset's tick, so people ticking the same record at once don't clash.
        const shard = tickShard(id, r.shards);
        await store.commit([{ op: "merge", col: "checkTicks", id: `${r.id}_${shard}`, data: { roundId: r.id, shard, last: id,
            ticks: { [id]: { checked: !!on, at: nowIso(), by: myEmail(), byName: myName(), byUid: authUser.uid } } } }]);
    } catch (err) { toast(friendlyError(err), "err"); renderCheck(); }
}

function startCheckRound() {
    if (!can("check", "rounds")) return;
    const spaces = allSpaces();
    const openBy = new Map(openRounds().map(r => [r.venue, r]));
    const count = s => inventory.filter(a => inVenue(a, s)).length;
    const month = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });
    showModal({
        title: "Start a new check round", size: "sm", body: `
        <form id="nr-form" class="form-stack" novalidate>
            <div class="field"><label for="nr-venue">Venue (Item Space) *</label>
                <select id="nr-venue"><option value="">Choose a venue…</option>${spaces.map(s => `<option value="${esc(s)}">${esc(s)} - ${plural(count(s), "record")}${openBy.has(s) ? " (round open)" : ""}</option>`).join("")}</select></div>
            <div class="field"><label for="nr-name">Round name *</label><input type="text" id="nr-name" value="${esc(month)} stock take"></div>
            <p class="muted small" id="nr-note" style="margin:0">Only assets in this venue are counted. Other venues can run their own rounds at the same time.</p>
            <p id="nr-error" class="error-msg hidden"></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">Start round</button></div>
        </form>`,
        onMount(root) {
            const venue = root.querySelector("#nr-venue");
            venue.addEventListener("change", () => {
                const r = openBy.get(venue.value);
                root.querySelector("#nr-note").innerHTML = r ? `<b>${esc(venue.value)}</b> already has “${esc(r.name)}” open. Starting a new round finishes that one first and saves it to History.`
                    : "Only assets in this venue are counted. Other venues can run their own rounds at the same time.";
            });
            root.querySelector("#nr-form").addEventListener("submit", async e => {
                e.preventDefault();
                const err = m => { const p = root.querySelector("#nr-error"); p.textContent = m; p.classList.remove("hidden"); };
                const v = venue.value, name = root.querySelector("#nr-name").value.trim();
                if (!v) return err("Choose the venue to check.");
                if (!name) return err("Give the round a name.");
                try {
                    const prev = openBy.get(v);
                    if (prev) await finishRound(prev, true);
                    const id = store.newId("audits");
                    await commitOps([
                        { op: "set", col: "audits", id, data: { name, venue: v, status: "open", shards: tickRecords(count(v)), startedBy: myEmail(), startedByName: myName(), startedAt: nowIso() } },
                        makeLog("Check round started", { label: `${v} · ${name}` }, [], `${plural(count(v), "record")} to check`)
                    ]);
                    selectedRound = id;
                    checkTab = "current";
                    closeDynModal();
                    toast(`Round started for ${v}`);
                } catch (er) { err(friendlyError(er)); }
            });
        }
    });
}

// Freeze the round's results into its audit record (History), then clear its ticks.
async function finishRound(round, silent) {
    const r = round || curRound();
    if (!r || !can("check", "rounds")) return;
    const scope = roundScope(r);
    const tick = a => checks[`${r.id}_${a.id}`];
    const done = scope.filter(a => tick(a) && tick(a).checked).length;
    if (!silent && !(await uiConfirm({ title: `Finish “${r.name}” for ${r.venue}?`, confirmText: "Finish & save to History",
        message: `${done} of ${scope.length} records verified. ${scope.length - done ? `${scope.length - done} will be recorded as not found.` : "Everything was found."}\nThe summary is saved to History and can be downloaded as a PDF.` }))) return;
    const items = scope.map(a => {
        const t = tick(a);
        return { id: a.id, label: assetLabel(a), model: equipName(a), category: a.category || "", location: dv(a.itemLocation), condition: a.condition,
            qty: units(a), checked: !!(t && t.checked), by: t && t.checked ? (t.byName || t.by) : "", at: t && t.checked ? t.at : "" };
    }).sort((x, y) => byNum(x.location, y.location) || byNum(x.label, y.label));
    // Only pending reports stay live now, so count this round's reports (any status) with one read of just those.
    let roundDisc = discrepancies;
    try { roundDisc = await store.getAll("discrepancies", { where: [["at", ">=", String(r.startedAt)]] }); } catch (e) { /* not allowed to list them: use what's loaded */ }
    const disc = roundDisc.filter(d => scope.some(a => a.id === d.assetId) && String(d.at) >= String(r.startedAt)).length;
    const ops = [
        { op: "update", col: "audits", id: r.id, data: { status: "closed", closedBy: myEmail(), closedByName: myName(), closedAt: nowIso(),
            summary: { total: items.length, checked: done, discrepancies: disc, items } } },
        makeLog("Check round finished", { label: `${r.venue} · ${r.name}` }, [], `${done}/${items.length} verified${items.length - done ? `, ${items.length - done} not found` : ""}`)
    ];
    for (let n = 0; n < (r.shards || 1); n++) ops.push({ op: "delete", col: "checkTicks", id: `${r.id}_${n}` });
    try {
        await commitOps(ops);
        if (!silent) toast(`Round finished - saved to History`);
    } catch (er) { if (silent) throw er; toast(friendlyError(er), "err"); }
}

// ---------- History ----------
function renderCheckHistory() {
    const el = $("check-history");
    if (!can("check", "history")) { el.innerHTML = `<div class="empty-state">You don't have access to check history.</div>`; return; }
    const list = closedRounds();
    el.innerHTML = `<div class="panel"><div class="table-scroll"><table class="data-table">
        <thead><tr><th>Round</th><th>Venue</th><th>Started</th><th>Finished</th><th>Verified</th><th>Not found</th><th>Discrepancies</th><th></th></tr></thead>
        <tbody>${list.length ? list.map(r => {
            const s = r.summary || { total: 0, checked: 0, discrepancies: 0 };
            const pct = s.total ? Math.round(s.checked * 100 / s.total) : 0;
            return `<tr>
                <td><b>${esc(r.name)}</b></td><td>${esc(r.venue)}</td>
                <td><div class="who">${fmtDate(r.startedAt)}<span>${esc(r.startedByName || r.startedBy)}</span></div></td>
                <td><div class="who">${fmtDate(r.closedAt)}<span>${esc(r.closedByName || r.closedBy)}</span></div></td>
                <td>${progressHtml(s.checked, s.total)} <span class="muted small">${pct}%</span></td>
                <td>${s.total - s.checked ? `<span class="st st-missing">${s.total - s.checked}</span>` : `<span class="st st-ok">0</span>`}</td>
                <td>${s.discrepancies || 0}</td>
                <td class="nowrap"><button type="button" class="btn btn-sm" data-hist="view" data-id="${esc(r.id)}">View</button>
                    <button type="button" class="btn btn-sm" data-hist="pdf" data-id="${esc(r.id)}">PDF</button>
                    ${can("check", "deleteHistory") ? `<button type="button" class="btn btn-danger btn-sm" data-hist="delete" data-id="${esc(r.id)}">Delete</button>` : ""}</td>
            </tr>`;
        }).join("") : `<tr><td colspan="8" class="empty-cell">No finished rounds yet. Finished rounds are kept here until someone deletes them.</td></tr>`}</tbody>
    </table></div></div>`;
}

$("check-history").addEventListener("click", async e => {
    const b = e.target.closest("[data-hist]");
    if (!b) return;
    const r = audits.find(x => x.id === b.dataset.id);
    if (!r) return;
    if (b.dataset.hist === "view") return viewRound(r);
    if (b.dataset.hist === "pdf") {
        b.disabled = true;
        try { await buildAuditPdf(r); toast("PDF ready"); } catch (er) { toast(friendlyError(er), "err"); }
        b.disabled = false;
        return;
    }
    if (b.dataset.hist === "delete" && can("check", "deleteHistory")) {
        const ok = await uiConfirm({ title: `Delete “${r.name}” (${r.venue})?`, danger: true, confirmText: "Delete record",
            message: "The check summary is removed from History for everyone. Download the PDF first if you need a copy." });
        if (!ok) return;
        try {
            await commitOps([{ op: "delete", col: "audits", id: r.id }, makeLog("Check history deleted", { label: `${r.venue} · ${r.name}` }, [], `${(r.summary || {}).checked || 0}/${(r.summary || {}).total || 0} verified`)]);
            toast("History record deleted");
        } catch (er) { toast(friendlyError(er), "err"); }
    }
});

function viewRound(r) {
    const s = r.summary || { items: [] };
    const byLoc = {};
    (s.items || []).forEach(i => { (byLoc[i.location || UNASSIGNED] = byLoc[i.location || UNASSIGNED] || []).push(i); });
    showModal({
        title: `${esc(r.venue)} · ${esc(r.name)}`, size: "lg", body: `
        <div class="round-banner flat">
            <div class="stat"><b>${s.checked} / ${s.total}</b><span>verified</span></div>
            ${progressHtml(s.checked, s.total)}
            <div class="stat"><b>${s.total - s.checked}</b><span>not found</span></div>
            <div class="stat"><b>${s.discrepancies || 0}</b><span>discrepancies</span></div>
            <div class="stat"><span>Started ${fmtDateTime(r.startedAt)} · ${esc(r.startedByName || r.startedBy)}</span><span>Finished ${fmtDateTime(r.closedAt)} · ${esc(r.closedByName || r.closedBy)}</span></div>
        </div>
        ${Object.keys(byLoc).sort(byNum).map(loc => `<h4 class="hist-loc">${esc(loc)}</h4>
            <div class="panel"><div class="table-scroll"><table class="data-table">
            <thead><tr><th>Asset</th><th>Model</th><th>Condition</th><th>Result</th><th>Checked by</th></tr></thead>
            <tbody>${byLoc[loc].map(i => `<tr><td><b>${esc(i.label)}</b>${i.qty > 1 ? ` <span class="muted small">× ${i.qty}</span>` : ""}</td><td>${esc(i.model)}</td>
                <td><span class="pill ${condClass(i.condition)}">${esc(i.condition)}</span></td>
                <td>${i.checked ? `<span class="st st-ok">Verified</span>` : `<span class="st st-missing">Not found</span>`}</td>
                <td class="muted small">${i.checked ? `${esc(i.by)} · ${fmtDateTime(i.at)}` : "—"}</td></tr>`).join("")}</tbody></table></div></div>`).join("")}
        <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Close</button><button type="button" class="btn btn-primary" id="vr-pdf">Download PDF</button></div>`,
        onMount(root) { root.querySelector("#vr-pdf").addEventListener("click", async () => { try { await buildAuditPdf(r); toast("PDF ready"); } catch (er) { toast(friendlyError(er), "err"); } }); }
    });
}

async function buildAuditPdf(r) {
    const s = r.summary || { items: [], total: 0, checked: 0 };
    const rep = await newReport({ title: `Inventory Check · ${r.venue}`, orientation: "portrait", meta: [
        `Round: ${r.name}`, `${pdfDate(r.startedAt)} - ${pdfDate(r.closedAt)}` ] });
    const pct = s.total ? Math.round(s.checked * 100 / s.total) : 0;
    rep.facts([["Venue", r.venue], ["Verified", `${s.checked} / ${s.total}`], ["Completion", `${pct}%`], ["Not found", String(s.total - s.checked)], ["Discrepancies", String(s.discrepancies || 0)],
        ["Started", pdfDate(r.startedAt, true)], ["Started by", r.startedByName || r.startedBy], ["Finished", pdfDate(r.closedAt, true)], ["Finished by", r.closedByName || r.closedBy]]);
    const missing = (s.items || []).filter(i => !i.checked);
    if (missing.length) {
        rep.heading(`Not found (${missing.length})`);
        rep.table({ head: [["Location", "Asset", "Model", "Category", "Condition", "Qty"]],
            body: missing.map(i => [i.location, i.label, i.model, i.category, i.condition, String(i.qty || 1)].map(pdfText)),
            headStyles: { fillColor: [201, 54, 54], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.8 } });
    }
    rep.heading(`All records (${(s.items || []).length})`);
    rep.table({ head: [["Location", "Asset", "Model", "Condition", "Result", "Checked by", "When"]],
        body: (s.items || []).map(i => [i.location, i.label + (i.qty > 1 ? ` (x${i.qty})` : ""), i.model, i.condition, i.checked ? "Verified" : "NOT FOUND", i.by || "-", i.at ? pdfDate(i.at, true) : "-"].map(pdfText)),
        didParseCell: d => { if (d.section === "body" && d.column.index === 4 && d.cell.raw === "NOT FOUND") { d.cell.styles.textColor = [201, 54, 54]; d.cell.styles.fontStyle = "bold"; } },
        columnStyles: { 0: { cellWidth: 26 }, 1: { cellWidth: 34, fontStyle: "bold" }, 4: { cellWidth: 22 }, 6: { cellWidth: 30 } } });
    return rep.save(`Inventory_Check_${String(r.venue).replace(/[^A-Za-z0-9]+/g, "_")}_${String(r.closedAt || r.startedAt).slice(0, 10)}.pdf`);
}

// =====================================================================
// Discrepancies
// =====================================================================
const DISC_FIELDS = ["condition", "qty", "itemSpace", "itemLocation", "serialNo", "remarks"];

function openDiscrepancy(id) {
    const a = assetById(id);
    if (!a || !can("check", "report")) return;
    if (pendingDiscFor(id)) return toast("This asset already has a report waiting for review");
    showModal({
        title: `Report discrepancy · ${esc(assetLabel(a))}`, body: `
        <form id="dc-form" class="form-stack" novalidate>
            <div class="ticket-summary"><div class="asset-cell"><b>${esc(assetLabel(a))}</b><span>${esc(a.brand)} ${esc(a.model)} · ${esc(a.category)}${isGeneral(a) ? ` · ${a.qty} pcs` : ""}</span>
                <span>Recorded at ${esc([dv(a.itemSpace), dv(a.itemLocation)].filter(Boolean).join(" › ") || "no location")} · ${esc(a.condition)}</span></div></div>
            <label class="radio-row box"><input type="checkbox" id="dc-missing"> <span><b>I can't find this asset</b> - mark it as Missing</span></label>
            <p class="muted small" style="margin:0">Otherwise, change whatever is different from what you see. Only changed fields are sent for review.</p>
            <div class="form-grid" id="dc-fields">
                <div class="field"><label for="dc-cond">Condition</label><select id="dc-cond">${condOptions(a.condition)}</select></div>
                ${isGeneral(a) ? `<div class="field"><label for="dc-qty">Counted quantity</label><input type="number" id="dc-qty" min="0" value="${esc(a.qty)}"></div>`
                    : canViewCol("serialNo") ? `<div class="field"><label for="dc-serial">Serial no</label><input type="text" id="dc-serial" class="mono" value="${esc(dv(a.serialNo))}"></div>` : `<div></div>`}
                ${placeFields("dc", dv(a.itemSpace), dv(a.itemLocation), { space: "Found in space", location: "Found at location" })}
                <div class="field span2"><label for="dc-remarks">Remarks</label><input type="text" id="dc-remarks" value="${esc(dv(a.remarks))}"></div>
            </div>
            <div class="field"><label for="dc-note">What did you notice? *</label><textarea id="dc-note" rows="2" placeholder="e.g. Found on the wrong shelf, label peeling, serial doesn't match, only 18 of 24 cables"></textarea></div>
            <p id="dc-error" class="error-msg hidden"></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">Send for review</button></div>
        </form>`,
        onMount(root) {
            const missing = root.querySelector("#dc-missing");
            missing.addEventListener("change", () => root.querySelectorAll("#dc-fields input, #dc-fields select").forEach(el => { el.disabled = missing.checked; }));
            root.querySelector("#dc-form").addEventListener("submit", async e => {
                e.preventDefault();
                const err = m => { const p = root.querySelector("#dc-error"); p.textContent = m; p.classList.remove("hidden"); };
                const note = root.querySelector("#dc-note").value.trim();
                if (!note) return err("Describe what you noticed.");
                const val = id => { const el = root.querySelector(id); return el ? el.value.trim() : undefined; };
                const isMissing = missing.checked;
                const proposed = {};
                if (isMissing) proposed.condition = "Missing";
                else {
                    const vals = { condition: val("#dc-cond"), qty: val("#dc-qty"), itemSpace: val("#dc-space"), itemLocation: val("#dc-loc"), serialNo: val("#dc-serial"), remarks: val("#dc-remarks") };
                    DISC_FIELDS.forEach(k => { if (vals[k] !== undefined && dv(vals[k]) !== dv(a[k])) proposed[k] = k === "qty" ? Math.max(0, parseInt(vals[k], 10) || 0) : vals[k]; });
                }
                if (!Object.keys(proposed).length) return err("Change at least one field, or tick “I can't find this asset”.");
                const id = store.newId("discrepancies");
                const r = curRound();
                try {
                    await commitOps([
                        { op: "set", col: "discrepancies", id, data: {
                            assetId: a.id, assetLabel: assetLabel(a), category: a.category || "", brand: a.brand || "", model: a.model || "",
                            current: Object.fromEntries(DISC_FIELDS.map(k => [k, dv(a[k])])), proposed, missing: isMissing, note,
                            roundId: r ? r.id : "", status: "pending", by: myEmail(), byName: myName(), byUid: authUser.uid, at: nowIso() } },
                        makeLog("Discrepancy reported", a, Object.entries(proposed).map(([k, v]) => ({ field: k, from: dv(a[k]), to: v })), note, { ticketId: id })
                    ]);
                    closeDynModal();
                    toast("Report sent - an Admin / Co-Admin will review it");
                } catch (er) { err(friendlyError(er)); }
            });
        }
    });
}

function diffList(d) {
    return Object.entries(d.proposed || {}).map(([k, v]) =>
        `<div class="diff"><span>${esc(FIELD_LABEL[k] || k)}</span> <s>${esc((d.current || {})[k] || "∅")}</s> → <b>${esc(v || "∅")}</b></div>`).join("");
}

function renderReview() {
    const el = $("check-review");
    if (!el) return;
    if (can("check", "review")) {
        const list = discrepancies.filter(d => d.status === "pending").sort((a, b) => String(a.at).localeCompare(String(b.at)));
        el.innerHTML = list.length ? `<div class="review-panel"><h3>Discrepancies to review <span class="count">${list.length}</span></h3>
            <div class="panel"><div class="table-scroll"><table class="data-table">
                <thead><tr><th>Asset</th><th>Reported</th><th>Suggested change</th><th>Note</th><th></th></tr></thead>
                <tbody>${list.map(d => `<tr>
                    <td><div class="asset-cell"><b>${esc(d.assetLabel)}</b><span>${esc(d.brand)} ${esc(d.model)} · ${esc(d.category)}</span>${assetById(d.assetId) ? "" : `<span class="warn-text">asset no longer in inventory</span>`}</div></td>
                    <td><div class="who">${esc(d.byName || d.by)}<span>${fmtDateTime(d.at)}</span></div></td>
                    <td>${d.missing ? `<span class="st st-missing">Reported missing</span>` : ""}${diffList(d)}</td>
                    <td class="desc">${esc(d.note)}</td>
                    <td class="nowrap"><button type="button" class="btn btn-ok btn-sm" data-disc="approve" data-id="${esc(d.id)}">Approve</button>
                        <button type="button" class="btn btn-danger btn-sm" data-disc="reject" data-id="${esc(d.id)}">Reject</button></td>
                </tr>`).join("")}</tbody>
            </table></div></div></div>` : "";
    } else {
        const mine = discrepancies.filter(d => d.byUid === authUser.uid).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 6);
        el.innerHTML = mine.length ? `<div class="review-panel"><h3>My reports</h3><div class="panel"><div class="table-scroll"><table class="data-table">
            <thead><tr><th>Asset</th><th>Sent</th><th>Suggested change</th><th>Status</th></tr></thead>
            <tbody>${mine.map(d => `<tr><td><b>${esc(d.assetLabel)}</b></td><td class="nowrap">${fmtDateTime(d.at)}</td>
                <td>${d.missing ? `<span class="st st-missing">Missing</span>` : diffList(d)}</td>
                <td><span class="st st-${d.status === "pending" ? "pending" : d.status === "approved" ? "ok" : "rejected"}">${esc(d.status)}</span>${d.reviewNote ? `<div class="muted small">${esc(d.reviewNote)}</div>` : ""}</td></tr>`).join("")}</tbody>
        </table></div></div></div>` : "";
    }
}

$("check-review").addEventListener("click", async e => {
    const b = e.target.closest("[data-disc]");
    if (!b || !can("check", "review")) return;
    const d = discrepancies.find(x => x.id === b.dataset.id);
    if (!d) return;
    const a = assetById(d.assetId);
    if (b.dataset.disc === "approve") {
        if (!a) return toast("That asset no longer exists - reject the report instead", "err");
        const note = await uiConfirm({ title: `Apply change to ${d.assetLabel}?`, confirmText: "Approve & apply", html: true,
            message: `${d.missing ? "Asset will be marked <b>Missing</b>." : ""}${diffList(d)}`,
            input: { label: "Note (optional)", placeholder: "e.g. Confirmed on site" } });
        if (note === false) return;
        const m = wfAssetOps(a, d.proposed || {}, "discrepancies", d.id, "approved");
        try {
            await commitOps([
                { op: "update", col: "discrepancies", id: d.id, data: { status: "approved", reviewedBy: myEmail(), reviewedAt: nowIso(), reviewNote: note || "" } },
                ...m.ops,
                makeLog("Discrepancy approved", a, m.changes, [d.note, note].filter(Boolean).join(" · "), { ticketId: d.id })
            ]);
            toast(`${d.assetLabel} updated`);
        } catch (er) { toast(friendlyError(er), "err"); }
    } else {
        const reason = await uiConfirm({ title: `Reject report on ${d.assetLabel}?`, confirmText: "Reject", danger: true,
            input: { label: "Reason (shown to the reporter)", required: true, requiredMsg: "Give a short reason." } });
        if (!reason) return;
        try {
            await commitOps([
                { op: "update", col: "discrepancies", id: d.id, data: { status: "rejected", reviewedBy: myEmail(), reviewedAt: nowIso(), reviewNote: reason } },
                makeLog("Discrepancy rejected", a || { label: d.assetLabel }, [], reason, { ticketId: d.id })
            ]);
            toast("Report rejected");
        } catch (er) { toast(friendlyError(er), "err"); }
    }
});
