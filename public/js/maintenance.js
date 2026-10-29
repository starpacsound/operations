// =====================================================================
// Maintenance: request -> confirmed -> repairing -> closed (or rejected)
// =====================================================================
const STAGE_INFO = {
    request: { label: "Requests", desc: "Fault reports waiting for Admin / Co-Admin verification." },
    confirmed: { label: "Confirmed Faulty", desc: "Verified faulty. Waiting to be sent for repair (or fixed in-house)." },
    repairing: { label: "Repairing", desc: "Currently with an external vendor." }
};
const stageLabel = s => (STAGE_INFO[s] && STAGE_INFO[s].label) || s;
const ticketAsset = t => assetById(t.assetId);

// Tickets for assets this user can't see are hidden (unless they raised it themselves).
function visibleTickets() {
    if (isAdmin() || !pList("viewCats").length) return tickets;
    return tickets.filter(t => pList("viewCats").includes(t.category) || t.requestedByUid === (authUser && authUser.uid));
}

function ticketAssetCell(t) {
    const a = ticketAsset(t) || t;
    const ids = [canViewCol("serialNo") && dv(a.serialNo) ? `S/N ${esc(dv(a.serialNo))}` : "",
        canViewCol("assetNo") && dv(a.assetNo) ? esc(dv(a.assetNo)) : ""].filter(Boolean).join(" · ");
    return `<div class="asset-cell"><b>${esc(ticketAsset(t) ? assetLabel(a) : t.assetLabel)}</b><span>${esc(`${dv(a.brand)} ${dv(a.model)}`)} · ${esc(a.category)}${t.faultQty ? ` · <b>${t.faultQty} faulty unit${t.faultQty === 1 ? "" : "s"}</b>` : ""}</span>
        ${ids ? `<span class="ids">${ids}</span>` : ""}${ticketAsset(t) ? "" : `<span class="warn-text">asset no longer in inventory</span>`}</div>`;
}

const canVerify = () => can("maintenance", "verify");
const canRepair = () => can("maintenance", "repair");
const seeAllRequests = () => can("maintenance", "viewAll") || canVerify();
const seeWork = () => can("maintenance", "viewWork") || canRepair();

function renderMaintenance() {
    const host = $("maint-sections");
    if (!host || !profile) return;
    const vt = visibleTickets();
    const mine = t => authUser && t.requestedByUid === authUser.uid;
    const section = (stage, list, title, desc) => {
        let head, row;
        if (stage === "request") {
            head = ["Asset", "Reported", "Type", "Requested status", "Fault description", "New location", ""];
            row = t => [
                ticketAssetCell(t),
                `<div class="who">${esc(t.requestedByName || t.requestedBy)}<span>${fmtDateTime(t.requestedAt)}</span></div>`,
                `<span class="lt ${typeClass(t.logType)}">${esc(t.logType || "Fault")}</span>`,
                t.requestedCondition ? `<span class="pill ${condClass(t.requestedCondition)}">${esc(t.requestedCondition)}</span>` : `<span class="muted small">No change</span>`,
                `<div class="desc">${esc(t.faultDescription)}</div>`,
                esc([t.newSpace, t.newLocation].filter(Boolean).join(" › ") || "—"),
                t.stage !== "request" ? `<span class="st st-${t.stage === "repairing" ? "returnRequested" : "approved"}">${esc(stageLabel(t.stage))}</span>`
                    : canVerify() ? `<button type="button" class="btn btn-ok btn-sm" data-act="verify" data-id="${esc(t.id)}">Verify &amp; Confirm</button>
                       <button type="button" class="btn btn-danger btn-sm" data-act="reject" data-id="${esc(t.id)}">Reject</button>`
                    : `<span class="muted small">Awaiting verification</span>`
            ];
        } else {
            head = ["Asset", "Fault", "Verified", "Verification notes", "Status · location", ""];
            row = t => {
                const a = ticketAsset(t);
                return [
                    ticketAssetCell(t),
                    `<div class="desc">${esc(t.faultDescription)}</div><span class="muted small">by ${esc(t.requestedByName || t.requestedBy)}</span>`,
                    `<div class="who">${esc(t.verifiedBy)}<span>${fmtDateTime(t.verifiedAt)}</span></div>`,
                    `<div class="desc">${esc(t.verifyNotes)}</div>`,
                    a ? `<span class="pill ${condClass(a.condition)}">${esc(a.condition)}</span><div class="muted small">${esc([dv(a.itemSpace), dv(a.itemLocation)].filter(Boolean).join(" › "))}</div>` : "—",
                    canRepair() ? `<button type="button" class="btn btn-primary btn-sm" data-act="send" data-id="${esc(t.id)}">Send to Repair</button>
                           <button type="button" class="btn btn-sm" data-act="resolve" data-id="${esc(t.id)}" title="Fixed without a vendor">Fixed in-house</button>`
                        : `<span class="muted small">With the repair team</span>`
                ];
            };
        }
        const body = list.length
            ? list.map(t => `<tr data-ticket="${esc(t.id)}">${row(t).map(c => `<td>${c}</td>`).join("")}</tr>`).join("")
            : `<tr><td colspan="${head.length}" class="empty-cell">${stage === "request" ? "No open fault reports" : "Nothing here"}</td></tr>`;
        return `<div class="maint-section stage-${stage}">
            <div class="maint-head"><div><h3>${title} <span class="count">${list.length}</span></h3><p class="muted small">${desc}</p></div></div>
            <div class="panel"><div class="table-scroll"><table class="data-table maint-table">
                <thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody>
            </table></div></div></div>`;
    };
    const newest = (a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt));
    const parts = [];
    if (seeAllRequests()) parts.push(section("request", vt.filter(t => t.stage === "request").sort(newest), "Requests", STAGE_INFO.request.desc));
    else parts.push(section("request", vt.filter(t => mine(t) && (seeWork() ? t.stage === "request" : true)).sort(newest), "My requests",
        seeWork() ? "Your reports waiting for verification." : "Your open fault reports and where they are in the process."));
    if (seeWork()) parts.push(section("confirmed", vt.filter(t => t.stage === "confirmed").sort(newest), "Confirmed Faulty", STAGE_INFO.confirmed.desc));
    host.innerHTML = parts.join("");
    $("maint-repair").classList.toggle("hidden", !seeWork());
    if (seeWork()) { refreshRepairVendors(); renderRepairRows(); }
}

// ---------- Repairing: vendor / date / search filters ----------
function repairTickets() { return visibleTickets().filter(t => t.stage === "repairing"); }

function refreshRepairVendors() {
    const sel = $("repair-vendor");
    const cur = sel.value;
    const vendors = uniq(repairTickets().map(t => t.vendor)).sort();
    sel.innerHTML = `<option value="ALL">All vendors</option>` + vendors.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    sel.value = vendors.includes(cur) ? cur : "ALL";
}

function renderRepairRows() {
    const body = $("repair-body");
    if (!body || !profile) return;
    const q = lc($("repair-search").value).trim();
    const vendor = $("repair-vendor").value, from = $("repair-from").value, to = $("repair-to").value, overdueOnly = $("repair-overdue").checked;
    const limit = window.APP_CONFIG.repairOverdueDays || 14;
    const all = repairTickets();
    const list = all.filter(t => {
        const sent = String(t.dateSent || t.sentAt || "").slice(0, 10);
        if (vendor !== "ALL" && t.vendor !== vendor) return false;
        if (from && sent < from) return false;
        if (to && sent > to) return false;
        if (overdueOnly && daysSince(t.dateSent || t.sentAt) <= limit) return false;
        if (!q) return true;
        return [t.assetLabel, t.brand, t.model, t.category, t.serialNo, t.assetNo, t.faultDescription, t.verifyNotes, t.vendor, t.sendNotes, t.sentBy]
            .map(lc).join(" ").includes(q);
    }).sort((a, b) => String(a.dateSent || a.sentAt).localeCompare(String(b.dateSent || b.sentAt)));
    const filtered = list.length !== all.length;
    $("repair-count").textContent = filtered ? `${list.length} of ${all.length}` : all.length;
    $("repair-clear").classList.toggle("hidden", !(q || vendor !== "ALL" || from || to || overdueOnly));
    body.innerHTML = list.length ? list.map(t => {
        const days = daysSince(t.dateSent || t.sentAt);
        const over = days > limit;
        return `<tr data-ticket="${esc(t.id)}">
            <td>${ticketAssetCell(t)}</td>
            <td><div class="desc">${esc(t.faultDescription)}</div></td>
            <td><b>${esc(t.vendor)}</b>${t.sendNotes ? `<div class="muted small">${esc(t.sendNotes)}</div>` : ""}</td>
            <td><div class="who">${fmtDate(t.dateSent)}<span>by ${esc(t.sentBy)}</span>${t.expectedReturn ? `<span>ETA ${fmtDate(t.expectedReturn)}</span>` : ""}</div></td>
            <td><span class="days ${over ? "over" : ""}">${days}d</span></td>
            <td>${canRepair() ? `<button type="button" class="btn btn-ok btn-sm" data-act="resolve" data-id="${esc(t.id)}">Mark Repaired</button>` : `<span class="muted small">At vendor</span>`}</td>
        </tr>`;
    }).join("") : `<tr><td colspan="6" class="empty-cell">${all.length ? "No repair jobs match these filters" : "Nothing at a vendor right now"}</td></tr>`;
}

function clearRepairFilters() {
    $("repair-search").value = ""; $("repair-vendor").value = "ALL"; $("repair-from").value = ""; $("repair-to").value = ""; $("repair-overdue").checked = false;
    renderRepairRows();
}

$("view-maintenance").addEventListener("click", e => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const t = tickets.find(x => x.id === b.dataset.id);
    if (!t) return;
    const act = b.dataset.act;
    if ((act === "verify" || act === "reject") && !canVerify()) return;
    if ((act === "send" || act === "resolve") && !canRepair()) return;
    ({ verify: openVerifyModal, reject: rejectTicket, send: openSendRepairModal, resolve: openResolveModal })[act](t);
});

// ---------- 1. Log maintenance / report fault ----------
// opts.fromFaulty: opened because someone picked "Faulty" as an asset's condition; Admins / Co-Admins then
// start on "Confirmed Faulty" so the condition changes straight away. opts.onClose runs when the dialog closes.
function openLogMaintenance(preselectId, opts) {
    opts = opts || {};
    if (!can("maintenance", "submit")) return;
    const selected = new Map();
    const faultQtys = new Map();   // general assets: how many units this report is about
    const mgr = canVerify();
    const openFor = new Map(tickets.map(t => [t.assetId, t]));
    Combo.register("maintAsset", () => inventory.map(a => ({
        value: assetLabel(a), data: a, disabled: (openFor.has(a.id) && !isGeneral(a)) || selected.has(a.id) || (isGeneral(a) && usableUnits(a) < 1),
        sub: [`${dv(a.brand)} ${dv(a.model)}`, isGeneral(a) && `${usableUnits(a)} of ${units(a)} available`, canViewCol("assetNo") && a.assetNo, canViewCol("serialNo") && a.serialNo && `S/N ${a.serialNo}`,
            openFor.has(a.id) ? stageLabel(openFor.get(a.id).stage) : selected.has(a.id) ? "selected" : ""].filter(Boolean).join(" · "),
        search: [a.assetNo, a.serialNo, a.code, a.brand, a.model].filter((v, i) => i > 2 || canViewCol(["assetNo", "serialNo", "code"][i])).join(" ")
    })));
    const body = `
        <form id="lm-form" class="form-stack" novalidate>
            <div class="field">
                <label for="lm-search">Select assets for maintenance</label>
                <input type="text" id="lm-search" data-combo="maintAsset" data-combo-strict="1" autocomplete="off"
                    placeholder="Scan or type Asset No, Serial No, AEV / Code, Internal No or model">
                <span class="muted small">Pick from the list (or scan and press Enter). You can add several assets.</span>
            </div>
            <div class="field">
                <label>Selected assets (<span id="lm-count">0</span>) <span class="hint">details filled in from the catalogue</span></label>
                <div id="lm-selected" class="selected-assets"></div>
            </div>
            <div class="form-grid cols-4">
                <div class="field"><label>User</label><input type="text" value="${esc(myName())}" readonly></div>
                <div class="field"><label for="lm-type">Log type</label>
                    <select id="lm-type">${LOG_TYPES.map(t => `<option ${t === "Fault" ? "selected" : ""}>${t}</option>`).join("")}</select></div>
                <div class="field"><label for="lm-cond">Asset status change</label>
                    <select id="lm-cond">${condOptions("Faulty", "No change")}</select></div>
                <div class="field"><label for="lm-date">Date</label><input type="date" id="lm-date" value="${today()}" max="${today()}"></div>
            </div>
            <p class="muted small" style="margin:-.4rem 0 0">Assets can only have one status. ${mgr ? "" : "Status and location are applied once an Admin / Co-Admin verifies the report."}</p>
            <div class="field"><label for="lm-desc">Fault description / log entry *</label>
                <textarea id="lm-desc" rows="3" placeholder="Describe the fault or the work done…"></textarea></div>
            <div class="form-grid">${placeFields("lm", "", "", { space: "New item space (optional)", location: "New item location (optional)", ph: "Leave blank to keep current" })}</div>
            ${mgr ? `<div class="field box"><label>Workflow</label>
                <label class="radio-row"><input type="radio" name="lm-mode" value="request" ${opts.fromFaulty ? "" : "checked"}> Submit as a fault request (goes to <b>Requests</b>)</label>
                <label class="radio-row"><input type="radio" name="lm-mode" value="confirm" ${opts.fromFaulty ? "checked" : ""}> I've verified it - file straight to <b>Confirmed Faulty</b></label>
                <label class="radio-row"><input type="radio" name="lm-mode" value="log"> Log only - apply status / location now, no repair needed</label>
            </div>` : ""}
            <p id="lm-error" class="error-msg hidden"></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">Log Maintenance</button></div>
        </form>`;

    showModal({
        title: "Log Maintenance", size: "lg", body, onClose: opts.onClose, onMount(root) {
            const search = root.querySelector("#lm-search");
            const err = m => { const p = root.querySelector("#lm-error"); p.textContent = m || ""; p.classList.toggle("hidden", !m); };
            const renderSelected = () => {
                root.querySelector("#lm-count").textContent = selected.size;
                const fields = [["category", "Category"], ["internalAssetNo", "Internal No"], ["assetNo", "Asset No"], ["serialNo", "Serial No"],
                    ["code", "Code / AEV"], ["itemSpace", "Space"], ["itemLocation", "Location"]].filter(([k]) => canViewCol(k));
                root.querySelector("#lm-selected").innerHTML = selected.size ? Array.from(selected.values()).map(a => `
                    <div class="sel-asset">
                        <div class="sel-head"><b>${esc(assetLabel(a))}</b><span>${esc(a.brand)} ${esc(a.model)}</span>
                            ${isGeneral(a)
                                ? `<label class="fault-units">Faulty units <input type="number" min="1" max="${usableUnits(a)}" value="${faultQtys.get(a.id) || 1}" data-fq="${esc(a.id)}"> <span class="muted small">of ${usableUnits(a)} available</span></label>`
                                : `<span class="pill ${condClass(a.condition)}">${esc(a.condition)}</span>`}
                            <button type="button" class="icon-btn" data-remove="${esc(a.id)}" title="Remove" aria-label="Remove">✕</button></div>
                        <div class="sel-grid">${fields.map(([k, l]) => `<div><span>${l}</span>${esc(dv(a[k]) || "—")}</div>`).join("")}</div>
                    </div>`).join("") : `<div class="muted small sel-empty">No assets selected yet - search above.</div>`;
            };
            const add = a => {
                if (!a) return;
                if (openFor.has(a.id) && !isGeneral(a)) return err(`${assetLabel(a)} already has an open ticket (${stageLabel(openFor.get(a.id).stage)}).`);
                if (isGeneral(a) && usableUnits(a) < 1) return err(`${assetLabel(a)} has no available units left to report.`);
                err("");
                selected.set(a.id, a);
                search.value = "";
                renderSelected();
            };
            search.addEventListener("combo:pick", e => add(e.detail.data));
            root.querySelector("#lm-selected").addEventListener("input", e => {
                const q = e.target.closest("[data-fq]");
                if (q) faultQtys.set(q.dataset.fq, parseInt(q.value, 10) || 0);
            });
            root.querySelector("#lm-selected").addEventListener("click", e => {
                const r = e.target.closest("[data-remove]");
                if (r) { selected.delete(r.dataset.remove); renderSelected(); }
            });
            root.querySelector("#lm-type").addEventListener("change", e => {
                const c = root.querySelector("#lm-cond");
                if (e.target.value === "Fault" && !c.value) c.value = "Faulty";
                if (["General", "Update", "Preventative maintenance"].includes(e.target.value) && c.value === "Faulty") c.value = "";
            });
            root.querySelector("#lm-form").addEventListener("submit", async e => {
                e.preventDefault();
                const desc = root.querySelector("#lm-desc").value.trim();
                if (!selected.size) return err("Select at least one asset.");
                if (!desc) return err("Describe the fault or the work done.");
                const mode = mgr ? root.querySelector('input[name="lm-mode"]:checked').value : "request";
                const v = {
                    logType: root.querySelector("#lm-type").value,
                    requestedCondition: root.querySelector("#lm-cond").value,
                    maintDate: root.querySelector("#lm-date").value || today(),
                    newSpace: root.querySelector("#lm-space").value.trim(),
                    newLocation: root.querySelector("#lm-loc").value.trim(),
                    faultDescription: desc
                };
                for (const a of selected.values()) {
                    if (!isGeneral(a) || mode === "log") continue;
                    const n = faultQtys.get(a.id) || 1;
                    if (n < 1 || n > usableUnits(a)) return err(`${assetLabel(a)}: faulty units must be 1 to ${usableUnits(a)}.`);
                }
                const btn = root.querySelector("button[type=submit]");
                btn.disabled = true;
                try {
                    const ops = [];
                    selected.forEach(a => ops.push(...newTicketOps(a, isGeneral(a) && mode !== "log" ? { ...v, faultQty: faultQtys.get(a.id) || 1 } : v, mode)));
                    await commitOps(ops);
                    closeDynModal();
                    toast(mode === "request" ? `Fault report submitted for ${selected.size} asset(s)` : mode === "confirm" ? `${selected.size} asset(s) filed as Confirmed Faulty` : "Maintenance logged");
                    if (currentView !== "maintenance" && mode !== "log" && tabOn("maintenance")) switchView("maintenance");
                } catch (er) { console.error(er); err(friendlyError(er)); btn.disabled = false; }
            });
            if (preselectId) add(assetById(preselectId));
            renderSelected();
        }
    });
}

function newTicketOps(a, v, mode) {
    const id = store.newId("maintenance");
    const stage = mode === "request" ? "request" : mode === "confirm" ? "confirmed" : "closed";
    const now = nowIso();
    const ticket = {
        assetId: a.id, assetLabel: assetLabel(a), category: a.category || "", brand: a.brand || "", model: a.model || "",
        internalAssetNo: dv(a.internalAssetNo), serialNo: dv(a.serialNo), assetNo: dv(a.assetNo),
        ...v, stage,
        requestedBy: myEmail(), requestedByName: myName(), requestedByUid: authUser.uid, requestedAt: now,
        history: [histEntry("request", v.faultDescription)]
    };
    const ops = [{ op: "set", col: "maintenance", id, data: ticket }];
    let changes = [];
    if (isGeneral(a) && mode !== "log") {
        // v5.13: a general asset keeps its condition; only the faulty units are counted (the rest stay available).
        const n = v.faultQty;
        const patch = { faultyQty: faultyUnits(a) + n };
        if (mode === "request") patch.faultPendingQty = pendingUnits(a) + n;
        const m = wfAssetOps(a, patch, "maintenance", id, stage);
        ops.push(...m.ops);
        if (mode === "confirm") Object.assign(ticket, { verifiedBy: myEmail(), verifiedAt: now, verifyNotes: "Confirmed on submission", confirmedCondition: "Faulty" });
        if (mode === "confirm") ticket.history.push(histEntry(stage));
    } else if (mode === "request") {
        // The asset shows Faulty straight away, marked "awaiting confirmation"; a rejected report puts the old condition back.
        const patch = { faultStatus: "pending" };
        if (a.condition !== "Faulty") { patch.condition = "Faulty"; patch.condBefore = a.condition || "Available"; }
        if (!a.faultStatus) {
            const m = wfAssetOps(a, patch, "maintenance", id, "request");
            changes = m.changes;
            ops.push(...m.ops);
        }
    } else {
        const patch = {};
        const rc = isGeneral(a) && v.requestedCondition === "Faulty" ? "" : v.requestedCondition;   // a general line is never marked Faulty as a whole
        if (mode === "confirm") { patch.condition = rc || "Faulty"; patch.faultStatus = "confirmed"; patch.condBefore = ""; }
        else if (rc) patch.condition = rc;
        if (v.newSpace) patch.itemSpace = v.newSpace;
        if (v.newLocation) patch.itemLocation = v.newLocation;
        const m = wfAssetOps(a, patch, "maintenance", id, stage);
        changes = m.changes;
        ops.push(...m.ops);
        if (mode === "confirm") Object.assign(ticket, { verifiedBy: myEmail(), verifiedAt: now, verifyNotes: "Confirmed on submission", confirmedCondition: patch.condition });
        if (mode === "log") Object.assign(ticket, { resolvedBy: myEmail(), resolvedAt: now, resolution: "Logged (no repair needed)", finalCondition: patch.condition || a.condition });
        ticket.history.push(histEntry(stage));
    }
    const action = mode === "request" ? "Maintenance request" : mode === "confirm" ? "Maintenance confirmed" : `Maintenance log: ${v.logType}`;
    const unitNote = v.faultQty ? `${v.faultQty} unit${v.faultQty === 1 ? "" : "s"} · ` : "";
    ops.push(makeLog(action, a, changes, unitNote + v.faultDescription, { ticketId: id }));
    return ops;
}

// ---------- 2. Verify & confirm ----------
function openVerifyModal(t) {
    const a = ticketAsset(t);
    showModal({
        title: `Verify &amp; Confirm · ${esc(t.assetLabel)}`, body: `
        <form id="vf-form" novalidate>
            <div class="ticket-summary">
                ${ticketAssetCell(t)}
                <div><span class="muted small">Reported by ${esc(t.requestedByName || t.requestedBy)} · ${fmtDateTime(t.requestedAt)} · <span class="lt ${typeClass(t.logType)}">${esc(t.logType)}</span></span>
                <p class="desc">${esc(t.faultDescription)}</p></div>
            </div>
            <div class="form-grid">
                ${a && isGeneral(a) && t.faultQty
                    ? `<div class="field"><label for="vf-qty">Units confirmed faulty <span class="hint">reported: ${t.faultQty}</span></label><input type="number" id="vf-qty" min="1" max="${t.faultQty}" value="${t.faultQty}"></div>`
                    : `<div class="field"><label for="vf-cond">Confirmed condition</label><select id="vf-cond">${condOptions(t.requestedCondition || "Faulty")}</select></div>`}
                <div class="field"><label>Current condition · location</label><input type="text" readonly value="${esc(a ? `${a.condition} · ${[dv(a.itemSpace), dv(a.itemLocation)].filter(Boolean).join(" › ")}` : "—")}"></div>
                ${placeFields("vf", t.newSpace || (a ? dv(a.itemSpace) : ""), t.newLocation || (a ? dv(a.itemLocation) : ""), { space: "Move to item space", location: "Move to item location" })}
                <div class="field span2"><label for="vf-notes">Verification notes *</label>
                    <textarea id="vf-notes" rows="3" placeholder="What did you check? What's the confirmed fault?"></textarea></div>
            </div>
            <p id="vf-error" class="error-msg hidden"></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-ok">Confirm faulty</button></div>
        </form>`,
        onMount(root) {
            root.querySelector("#vf-form").addEventListener("submit", async e => {
                e.preventDefault();
                const notes = root.querySelector("#vf-notes").value.trim();
                const errEl = root.querySelector("#vf-error");
                if (!notes) { errEl.textContent = "Add verification notes."; errEl.classList.remove("hidden"); return; }
                const unit = a && isGeneral(a) && t.faultQty;
                let cond = "Faulty", confirmedQty = 0;
                if (unit) {
                    confirmedQty = parseInt(root.querySelector("#vf-qty").value, 10) || 0;
                    if (confirmedQty < 1 || confirmedQty > t.faultQty) { errEl.textContent = `Confirm 1 to ${t.faultQty} units (use Reject if none are faulty).`; errEl.classList.remove("hidden"); return; }
                } else cond = root.querySelector("#vf-cond").value;
                const patch = unit
                    // units that were reported but not confirmed go back to available
                    ? { itemSpace: root.querySelector("#vf-space").value.trim(), itemLocation: root.querySelector("#vf-loc").value.trim(),
                        faultyQty: Math.max(0, faultyUnits(a) - (t.faultQty - confirmedQty)), faultPendingQty: Math.max(0, pendingUnits(a) - t.faultQty) }
                    : { condition: cond, itemSpace: root.querySelector("#vf-space").value.trim(), itemLocation: root.querySelector("#vf-loc").value.trim(),
                        faultStatus: cond === "Available" ? "" : "confirmed", condBefore: "" };
                const m = wfAssetOps(a, patch, "maintenance", t.id, "confirmed");
                try {
                    await commitOps([
                        { op: "update", col: "maintenance", id: t.id, data: {
                            stage: "confirmed", verifiedBy: myEmail(), verifiedAt: nowIso(), verifyNotes: notes,
                            confirmedCondition: cond, ...(unit ? { faultQty: confirmedQty, reportedQty: t.faultQty } : {}),
                            history: [...(t.history || []), histEntry("confirmed", notes)] } },
                        ...m.ops,
                        makeLog("Maintenance verified", a || { label: t.assetLabel }, m.changes, notes, { ticketId: t.id })
                    ]);
                    closeDynModal();
                    toast(`${t.assetLabel} moved to Confirmed Faulty`);
                } catch (er) { errEl.textContent = friendlyError(er); errEl.classList.remove("hidden"); }
            });
        }
    });
}

async function rejectTicket(t) {
    const reason = await uiConfirm({ title: `Reject fault report for ${t.assetLabel}?`, confirmText: "Reject report", danger: true,
        input: { label: "Reason (recorded in the log)", required: true, requiredMsg: "Give a short reason." } });
    if (!reason) return;
    // Put the condition back to what it was before the report, unless it has moved on or another report is still open.
    const a = ticketAsset(t);
    const others = tickets.some(x => x.id !== t.id && x.assetId === t.assetId && x.stage === "request");
    const back = a && isGeneral(a) && t.faultQty
        // general asset: the reported units simply stop counting as faulty
        ? wfAssetOps(a, { faultyQty: Math.max(0, faultyUnits(a) - t.faultQty), faultPendingQty: Math.max(0, pendingUnits(a) - t.faultQty) }, "maintenance", t.id, "rejected")
        : a && !others && a.faultStatus === "pending"
        ? wfAssetOps(a, { condition: a.condition === "Faulty" && a.condBefore ? a.condBefore : a.condition, faultStatus: "", condBefore: "" }, "maintenance", t.id, "rejected")
        : { ops: [], changes: [] };
    try {
        await commitOps([
            { op: "update", col: "maintenance", id: t.id, data: {
                stage: "rejected", rejectReason: reason, rejectedBy: myEmail(), rejectedAt: nowIso(),
                history: [...(t.history || []), histEntry("rejected", reason)] } },
            ...back.ops,
            makeLog("Maintenance request rejected", a || { label: t.assetLabel }, back.changes, reason, { ticketId: t.id })
        ]);
        toast("Fault report rejected");
    } catch (er) { toast(friendlyError(er), "err"); }
}

// ---------- 3. Send to repair ----------
function openSendRepairModal(t) {
    const a = ticketAsset(t);
    showModal({
        title: `Send to Repair · ${esc(t.assetLabel)}`, size: "sm", body: `
        <form id="sr-form" class="form-stack" novalidate>
            <div class="ticket-summary">${ticketAssetCell(t)}<p class="desc">${esc(t.verifyNotes || t.faultDescription)}</p></div>
            <div class="field"><label for="sr-vendor">Vendor name *</label>
                <input type="text" id="sr-vendor" data-combo="vendor" autocomplete="off" placeholder="e.g. Audio House SG"></div>
            <div class="form-grid">
                <div class="field"><label for="sr-date">Date sent *</label><input type="date" id="sr-date" value="${today()}"></div>
                <div class="field"><label for="sr-eta">Expected return</label><input type="date" id="sr-eta"></div>
            </div>
            <div class="field"><label for="sr-notes">Notes / job reference</label><input type="text" id="sr-notes" placeholder="Optional"></div>
            <p id="sr-error" class="error-msg hidden"></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">Send to Repair</button></div>
        </form>`,
        onMount(root) {
            root.querySelector("#sr-form").addEventListener("submit", async e => {
                e.preventDefault();
                const vendor = root.querySelector("#sr-vendor").value.trim();
                const date = root.querySelector("#sr-date").value;
                const errEl = root.querySelector("#sr-error");
                if (!vendor || !date) { errEl.textContent = "Vendor name and date sent are required."; errEl.classList.remove("hidden"); return; }
                const notes = root.querySelector("#sr-notes").value.trim();
                const m = a && isGeneral(a) && t.faultQty ? { ops: [], changes: [] }   // the faulty units stay counted; the rest of the line is untouched
                    : wfAssetOps(a, { condition: "On Repair", faultStatus: "", condBefore: "" }, "maintenance", t.id, "repairing");
                try {
                    await commitOps([
                        { op: "update", col: "maintenance", id: t.id, data: {
                            stage: "repairing", vendor, dateSent: date, expectedReturn: root.querySelector("#sr-eta").value, sendNotes: notes,
                            sentBy: myEmail(), sentAt: nowIso(), history: [...(t.history || []), histEntry("repairing", `Vendor: ${vendor}`)] } },
                        ...m.ops,
                        makeLog("Sent to repair", a || { label: t.assetLabel }, m.changes, `Vendor: ${vendor}`, { ticketId: t.id })
                    ]);
                    closeDynModal();
                    toast(`${t.assetLabel} sent to ${vendor}`);
                } catch (er) { errEl.textContent = friendlyError(er); errEl.classList.remove("hidden"); }
            });
        }
    });
}

// ---------- 4. Mark repaired / fixed in-house (returns the asset to the catalogue) ----------
function openResolveModal(t) {
    const a = ticketAsset(t);
    const fromVendor = t.stage === "repairing";
    showModal({
        title: `${fromVendor ? "Mark Repaired" : "Fixed In-house"} · ${esc(t.assetLabel)}`, size: "lg", body: `
        <form id="rs-form" novalidate>
            <div class="ticket-summary">${ticketAssetCell(t)}
                <div class="muted small">${fromVendor ? `At <b>${esc(t.vendor)}</b> since ${fmtDate(t.dateSent)} (${daysSince(t.dateSent || t.sentAt)} days)` : `Confirmed by ${esc(t.verifiedBy)}`}
                <p class="desc">${esc(t.verifyNotes || t.faultDescription)}</p></div>
            </div>
            <p class="muted small">Check every field before the asset goes back into the catalogue.</p>
            <div class="form-grid cols-3">
                <div class="field"><label for="rs-cond">${a && isGeneral(a) && t.faultQty ? `Condition of the ${t.faultQty} unit${t.faultQty === 1 ? "" : "s"} *` : "Condition / status *"}</label><select id="rs-cond">${condOptions("Available")}</select>
                    ${a && isGeneral(a) && t.faultQty ? `<span class="muted small">Available puts them back in stock; a retired condition removes them from the quantity.</span>` : ""}</div>
                ${placeFields("rs", a ? dv(a.itemSpace) : "", a ? dv(a.itemLocation) : "")}
                <div class="field"><label for="rs-serial">Serial no <span class="hint">change if replaced</span></label><input type="text" id="rs-serial" class="mono" value="${esc(a ? dv(a.serialNo) : "")}"></div>
                <div class="field"><label for="rs-date">Date returned</label><input type="date" id="rs-date" value="${today()}"></div>
                <div class="field"><label for="rs-cost">Repair cost <span class="hint">optional</span></label><input type="text" id="rs-cost" inputmode="decimal" placeholder="$"></div>
                <div class="field span-all"><label for="rs-remarks">Asset remarks</label><input type="text" id="rs-remarks" value="${esc(a ? dv(a.remarks) : "")}"></div>
                <div class="field span-all"><label for="rs-notes">Resolution notes <span class="hint">optional</span></label>
                    <textarea id="rs-notes" rows="3" placeholder="What was repaired or replaced?"></textarea></div>
            </div>
            <p id="rs-error" class="error-msg hidden"></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-ok">Return to inventory</button></div>
        </form>`,
        onMount(root) {
            root.querySelector("#rs-form").addEventListener("submit", async e => {
                e.preventDefault();
                const notes = root.querySelector("#rs-notes").value.trim();
                const errEl = root.querySelector("#rs-error");
                const cond = root.querySelector("#rs-cond").value;
                const patch = {
                    condition: cond, itemSpace: root.querySelector("#rs-space").value.trim(), itemLocation: root.querySelector("#rs-loc").value.trim(),
                    serialNo: root.querySelector("#rs-serial").value.trim(), remarks: root.querySelector("#rs-remarks").value.trim() || "-",
                    faultStatus: "", condBefore: ""
                };
                const unit = a && isGeneral(a) && t.faultQty;
                let m;
                if (unit) {
                    // the repaired units go back to available; units that are written off leave the quantity
                    const gone = RETIRED.includes(cond) ? t.faultQty : 0;
                    m = wfAssetOps(a, { itemSpace: patch.itemSpace, itemLocation: patch.itemLocation, remarks: patch.remarks, serialNo: patch.serialNo,
                        faultyQty: Math.max(0, faultyUnits(a) - t.faultQty), faultPendingQty: Math.max(0, pendingUnits(a) - t.faultQty), ...(gone ? { qty: Math.max(0, units(a) - gone) } : {}) },
                        "maintenance", t.id, "closed");
                } else m = wfAssetOps(a, patch, "maintenance", t.id, "closed");
                const cost = root.querySelector("#rs-cost").value.trim();
                const summary = [notes || (fromVendor ? "Repaired" : "Fixed in-house"), cost && `cost ${cost}`, fromVendor && `Vendor: ${t.vendor}`].filter(Boolean).join(" · ");
                try {
                    await commitOps([
                        { op: "update", col: "maintenance", id: t.id, data: {
                            stage: "closed", resolution: notes, finalCondition: cond, dateReturned: root.querySelector("#rs-date").value,
                            cost, resolvedBy: myEmail(), resolvedAt: nowIso(), history: [...(t.history || []), histEntry("closed", notes)] } },
                        ...m.ops,
                        makeLog(fromVendor ? "Repair completed" : "Fixed in-house", a || { label: t.assetLabel }, m.changes, summary, { ticketId: t.id })
                    ]);
                    closeDynModal();
                    toast(`${t.assetLabel} returned to inventory as ${cond}`);
                } catch (er) { errEl.textContent = friendlyError(er); errEl.classList.remove("hidden"); }
            });
        }
    });
}
