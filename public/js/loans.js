// =====================================================================
// Equipment Loans
//   requested --(approver picks exact units; units -> On Loan)--> approved
//   approved  --(member: Collected)--> collected
//   collected --(member: Return)--> returnRequested --(approver: Receive)--> returned (units restored)
//   requested --> rejected (approver) | cancelled (member);  approved --> cancelled (approver, units restored)
// Members only ever see equipment names, never asset numbers or serials.
// =====================================================================
const LOAN_STATUS = {
    requested: "Requested", approved: "Ready to collect", collected: "On loan", returnRequested: "Return pending",
    returned: "Returned", rejected: "Rejected", cancelled: "Cancelled"
};
const LOAN_FLOW = ["requested", "approved", "collected", "returnRequested", "returned"];
const loanItemsText = l => (l.items || []).map(i => `${i.qty} × ${i.name}`).join(", ");
const isLoanOverdue = l => ["collected", "returnRequested"].includes(l.status) && !l.returnTbc && l.returnDate && l.returnDate < today();
// v5.3: return date "TBC" (returnTbc: true, returnDate ""). Never overdue; listed on Today once out over 30 days.
const loanTbc = l => !!l.returnTbc && !l.returnDate;
const loanReturnText = l => loanTbc(l) ? "TBC" : fmtDate(l.returnDate);   // for display
const loanReturnRaw = l => loanTbc(l) ? "TBC" : (l.returnDate || "");      // for logs / messages
const isLoanTbcLong = l => ["collected", "returnRequested"].includes(l.status) && loanTbc(l) && daysBetween(String(l.collectedAt || l.collectDate).slice(0, 10), today()) > 30;
// The "Return date TBC" tick: clears and disables the date box.
const tbcTickHtml = (id, on) => `<label class="check-inline tbc-tick"><input type="checkbox" id="${id}" ${on ? "checked" : ""}> Return date TBC</label>`;
function bindTbcTick(root, tickSel, dateSel, after) {
    const tick = root.querySelector(tickSel), date = root.querySelector(dateSel);
    let kept = date.value;
    tick.addEventListener("change", () => {
        if (tick.checked) { kept = date.value || kept; date.value = ""; } else date.value = kept;
        date.disabled = tick.checked;
        if (after) after();
    });
}
const loanOpen = new Set();   // loan rows opened to show details
const loanMine = l => authUser && l.requestedByUid === authUser.uid;

function loanCard(l, approver) {
    const mine = loanMine(l);
    const overdue = isLoanOverdue(l);
    const nights = l.collectDate && l.returnDate ? daysBetween(l.collectDate, l.returnDate) : 0;
    const canSetDate = loanTbc(l) && ["approved", "collected", "returnRequested"].includes(l.status) && (approver || mine);
    const step = LOAN_FLOW.indexOf(l.status);
    const showUnits = approver && (l.assigned || []).length;
    const actions = [];
    if (l.status === "requested") {
        if (approver) actions.push(`<button type="button" class="btn btn-ok btn-sm" data-loan="approve" data-id="${esc(l.id)}">Approve…</button>`,
            `<button type="button" class="btn btn-danger btn-sm" data-loan="reject" data-id="${esc(l.id)}">Reject</button>`);
        if (mine) actions.push(`<button type="button" class="btn btn-sm" data-loan="cancel" data-id="${esc(l.id)}">Cancel request</button>`);
    } else if (l.status === "approved") {
        if (mine) actions.push(`<button type="button" class="btn btn-primary btn-sm" data-loan="collected" data-id="${esc(l.id)}">Collected</button>`);
        if (approver) actions.push(`<button type="button" class="btn btn-sm" data-loan="void" data-id="${esc(l.id)}">Cancel loan</button>`);
    } else if (l.status === "collected") {
        if (mine) actions.push(`<button type="button" class="btn btn-primary btn-sm" data-loan="return" data-id="${esc(l.id)}">Return</button>`);
        if (approver) actions.push(`<button type="button" class="btn btn-sm" data-loan="receive" data-id="${esc(l.id)}">Receive return…</button>`);
    } else if (l.status === "returnRequested") {
        if (approver) actions.push(`<button type="button" class="btn btn-ok btn-sm" data-loan="receive" data-id="${esc(l.id)}">Receive return…</button>`);
        else if (mine) actions.push(`<span class="muted small">Waiting for the team to check it back in</span>`);
    }
    if (canSetDate) actions.push(`<button type="button" class="btn btn-sm" data-loan="setdate" data-id="${esc(l.id)}">Set return date</button>`);
    const open = loanOpen.has(l.id);
    const when = `Collect ${fmtDate(l.collectDate)} · Return ${loanTbc(l) ? "TBC" : fmtDate(l.returnDate)}`;
    const body = !open ? "" : `<div class="loan-body">
        <div class="card-sub">${l.source === "catalogue" ? `Lent from the catalogue by ${esc(l.requestedByName || l.requestedBy)} · ${fmtDateTime(l.requestedAt)}`
            : `${approver || !mine ? `Requested by ${esc(l.requestedByName || l.requestedBy)} · ` : "Requested "}${fmtDateTime(l.requestedAt)}`}</div>
        <dl class="kv">
            <dt>Collect</dt><dd>${fmtDate(l.collectDate)}</dd>
            <dt>Return</dt><dd>${loanTbc(l) ? `<b>TBC</b>${isLoanTbcLong(l) ? ` <span class="warn-text small">out over 30 days</span>` : ""}` : `${fmtDate(l.returnDate)} <span class="muted">(${plural(nights, "day")})</span>`}</dd>
            ${l.reason ? `<dt>Reason</dt><dd>${esc(l.reason)}</dd>` : ""}
            ${l.approveNote ? `<dt>Note</dt><dd>${esc(l.approveNote)}</dd>` : ""}
            ${l.rejectReason ? `<dt>Reason</dt><dd>${esc(l.rejectReason)}</dd>` : ""}
        </dl>
        ${showUnits ? `<div class="unit-list">${l.assigned.map(u => `<div><b>${esc(u.label)}</b>${canViewCol("assetNo") && u.assetNo ? `<span class="mono">${esc(u.assetNo)}</span>` : ""}${canViewCol("serialNo") && u.serialNo ? `<span class="mono">S/N ${esc(u.serialNo)}</span>` : ""}</div>`).join("")}</div>` : ""}
        ${step >= 0 ? `<div class="timeline">${LOAN_FLOW.map((s, i) => `<span class="${i <= step ? "on" : ""}">${esc(LOAN_STATUS[s])}</span>`).join("<span>›</span>")}</div>` : ""}
    </div>`;
    // v5.7: one line per loan (like the Asset Catalogue); click the line for the details, buttons stay on the line.
    return `<div class="asset-group loan-row ${overdue ? "overdue" : ""}">
        <div class="group-head ${open ? "open" : ""}" data-loan-toggle="${esc(l.id)}" role="button" tabindex="0" aria-expanded="${open}">
            <div class="group-title">
                <span class="chev ${open ? "open" : ""}">▶</span>
                <span class="group-name">${esc(loanItemsText(l))}</span>
                <span class="group-desc">For <b>${esc(loanWho(l))}</b></span>
            </div>
            <div class="group-badges"><span class="pill qty loan-when">${esc(when)}</span>
                <span class="st st-${overdue ? "overdue" : l.status}">${overdue ? "Overdue" : LOAN_STATUS[l.status] || l.status}</span>
                ${actions.length ? `<span class="loan-acts">${actions.join("")}</span>` : ""}</div>
        </div>
        ${body}
    </div>`;
}

// v5.7: identical loans (same equipment, borrower, status and dates) share one line; click it to see each loan.
const loanGroupKey = l => [l.status, loanItemsText(l), loanWho(l), l.collectDate || "", loanTbc(l) ? "TBC" : l.returnDate || "", isLoanOverdue(l) ? "late" : ""].join("|").toLowerCase();
function loanGroups(list) {
    const map = new Map();
    list.forEach(l => { const k = loanGroupKey(l); if (!map.has(k)) map.set(k, []); map.get(k).push(l); });
    return [...map.values()];
}
function loanGroup(g, approver) {
    const l = g[0], key = "grp:" + loanGroupKey(l), open = loanOpen.has(key), overdue = isLoanOverdue(l);
    const when = `Collect ${fmtDate(l.collectDate)} · Return ${loanTbc(l) ? "TBC" : fmtDate(l.returnDate)}`;
    // whole-group buttons (v5.7): the borrower returns them all at once; a loan manager receives them all at once
    const acts = [], gk = esc(loanGroupKey(l));
    if (l.status === "collected" && g.every(loanMine)) acts.push(`<button type="button" class="btn btn-primary btn-sm" data-loan-group="${gk}" data-gact="return">Return all (${g.length})</button>`);
    if (approver && ["collected", "returnRequested"].includes(l.status)) acts.push(`<button type="button" class="btn btn-ok btn-sm" data-loan-group="${gk}" data-gact="receive">Receive all (${g.length})…</button>`);
    return `<div class="asset-group loan-row loan-group ${overdue ? "overdue" : ""}">
        <div class="group-head ${open ? "open" : ""}" data-loan-toggle="${esc(key)}" role="button" tabindex="0" aria-expanded="${open}">
            <div class="group-title">
                <span class="chev ${open ? "open" : ""}">▶</span>
                <span class="group-name">${esc(loanItemsText(l))}</span>
                <span class="tag">${g.length} loans</span>
                <span class="group-desc">For <b>${esc(loanWho(l))}</b></span>
            </div>
            <div class="group-badges"><span class="pill qty loan-when">${esc(when)}</span>
                <span class="st st-${overdue ? "overdue" : l.status}">${overdue ? "Overdue" : LOAN_STATUS[l.status] || l.status}</span>
                ${acts.length ? `<span class="loan-acts">${acts.join("")}</span>` : ""}</div>
        </div>
        ${open ? `<div class="loan-group-body">${g.map(x => loanCard(x, approver)).join("")}</div>` : ""}
    </div>`;
}

function renderLoans() {
    const host = $("loans-container");
    if (!host || !profile) return;
    const approver = can("loans", "manage");
    const seeAll = approver || can("loans", "viewAll");
    $("loans-sub").textContent = approver ? "Review requests, hand out the exact units, and check gear back in." : seeAll ? "Every loan, live. Only loan managers can approve or receive." : "Borrow gear for rehearsals and events. Requests need at least 2 days' notice.";
    const byDate = (a, b) => String(a.collectDate || a.requestedAt).localeCompare(String(b.collectDate || b.requestedAt));
    // v5.7: search + status filter (the bar at the top of the page)
    const q = lc(($("loan-search") || {}).value || "").trim(), stF = ($("loan-status") || {}).value || "ALL";
    const filtering = !!q || stF !== "ALL";
    const passes = l => (stF === "ALL" || (stF === "overdue" ? isLoanOverdue(l) : stF === "history" ? ["returned", "rejected", "cancelled"].includes(l.status) : l.status === stF))
        && (!q || lc([loanItemsText(l), loanWho(l), l.requestedByName, l.requestedBy, l.reason, l.approveNote, LOAN_STATUS[l.status], (l.assigned || []).map(u => `${u.label} ${u.assetNo || ""}`).join(" ")].join(" ")).includes(q));
    const section = (title, desc, list, emptyText) => filtering && !list.length ? "" : `<section class="board-section">
        <div class="board-head"><h3>${title}</h3><span class="count">${list.length}</span>${desc ? `<p class="muted small">${desc}</p>` : ""}</div>
        ${list.length ? `<div class="loan-list">${loanGroups(list).map(g => g.length > 1 ? loanGroup(g, approver) : loanCard(g[0], approver)).join("")}</div>` : `<div class="empty-state">${emptyText}</div>`}
    </section>`;
    const none = `<div class="empty-state">No loans match${q ? ` “${esc(q)}”` : ""}. <button type="button" class="link-btn" onclick="clearLoanFilters()">Clear search</button></div>`;
    let html;
    if (seeAll) {
        const st = s => loans.filter(l => l.status === s && passes(l)).sort(byDate);
        const finished = loans.filter(l => ["returned", "rejected", "cancelled"].includes(l.status) && passes(l))
            .sort((a, b) => String(b.returnedAt || b.rejectedAt || b.cancelledAt || b.requestedAt).localeCompare(String(a.returnedAt || a.rejectedAt || a.cancelledAt || a.requestedAt)));
        const history = filtering ? finished.slice(0, 100) : finished.slice(0, 12);
        html =
            section("Requests", "Approve to assign exact units - they switch to On Loan in the catalogue.", st("requested"), "No new requests") +
            section("Returns to receive", "The borrower says it's back. Check each unit in.", st("returnRequested"), "Nothing waiting") +
            section("Ready for collection", "Approved and waiting for the borrower to pick up.", st("approved"), "Nothing waiting") +
            section("On loan", "", st("collected"), "Nothing out on loan") +
            section("Recent history", "", history, "No finished loans yet");
    } else {
        const mine = loans.filter(l => loanMine(l) && passes(l));
        const active = mine.filter(l => ["requested", ...OPEN_LOAN].includes(l.status)).sort(byDate);
        const past = mine.filter(l => !active.includes(l)).sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt))).slice(0, filtering ? 100 : 10);
        html = section("My active loans", "", active, `No active loans. Use <b>+ Request Loan</b> to borrow gear.`) +
            (past.length ? section("Past loans", "", past, "") : "");
    }
    host.innerHTML = filtering && !html ? none : html;
}
function clearLoanFilters() {
    if ($("loan-search")) $("loan-search").value = "";
    if ($("loan-status")) $("loan-status").value = "ALL";
    renderLoans();
}

$("loans-container").addEventListener("click", e => {
    const gb = e.target.closest("[data-loan-group]");
    if (gb) {
        const list = loans.filter(l => loanGroupKey(l) === gb.dataset.loanGroup);
        return list.length ? (gb.dataset.gact === "return" ? requestReturnMany(list) : openLoanReceiveMany(list)) : undefined;
    }
    const b = e.target.closest("[data-loan]");
    if (!b) {
        const t = e.target.closest("[data-loan-toggle]");
        if (t) { const id = t.dataset.loanToggle; if (loanOpen.has(id)) loanOpen.delete(id); else loanOpen.add(id); renderLoans(); }
        return;
    }
    const l = loans.find(x => x.id === b.dataset.id);
    if (!l) return;
    ({ approve: openLoanApprove, reject: rejectLoan, cancel: cancelLoanRequest, collected: markCollected,
        return: requestReturn, receive: openLoanReceive, void: voidLoan, setdate: setLoanReturnDate })[b.dataset.loan](l);
});

const loanHist = (l, status, note) => [...(l.history || []), { status, at: nowIso(), by: myEmail(), note: note || "" }];

// ---------- Request ----------
function openLoanRequest() {
    if (!can("loans", "request")) return;
    const notice = window.APP_CONFIG.loanNoticeDays || 2;
    const earliest = addDays(notice);
    const lines = [];
    showModal({
        title: "Request a loan", body: `
        <form id="ln-form" class="form-stack" novalidate>
            <div class="field"><label for="ln-search">Equipment</label>
                <input type="text" id="ln-search" data-combo="equipment" autocomplete="off" placeholder="Type an equipment name, e.g. SM58, wireless, speaker">
                <span class="muted small">Pick from the list or type your own item, then press Enter. Add as many as you need.</span></div>
            <div class="line-list" id="ln-lines"></div>
            <div class="field"><label for="ln-who">Borrower name *</label>
                <input type="text" id="ln-who" data-combo="borrower" autocomplete="off" value="${esc(myName())}" placeholder="Who is taking the gear?">
                <span class="muted small">Change it if you're borrowing for someone else or a group, e.g. “Choir CCA - Wei Ling”.</span></div>
            <div class="form-grid">
                <div class="field"><label for="ln-collect">Collection date *</label><input type="date" id="ln-collect" min="${earliest}" value="${earliest}"></div>
                <div class="field"><label for="ln-return">Return date *</label><input type="date" id="ln-return" min="${earliest}" value="${addDays(notice + 2)}">${tbcTickHtml("ln-tbc")}</div>
            </div>
            <p class="date-note" id="ln-dates"></p>
            <div class="field"><label for="ln-reason">Reason for loan <span class="hint">optional</span></label><textarea id="ln-reason" rows="2" placeholder="e.g. CCA rehearsal at LT1"></textarea></div>
            <p id="ln-error" class="error-msg hidden"></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">Submit request</button></div>
        </form>`,
        onMount(root) {
            const search = root.querySelector("#ln-search");
            const err = m => { const p = root.querySelector("#ln-error"); p.textContent = m || ""; p.classList.toggle("hidden", !m); };
            const renderLines = () => {
                root.querySelector("#ln-lines").innerHTML = lines.length ? lines.map((l, i) => `<div class="line-item">
                    <div class="name">${esc(l.name)}<span>${esc(l.category || "Custom item")}${l.available !== undefined ? ` · ${l.available} available now` : ""}</span></div>
                    <label class="muted small" for="ln-q-${i}">Qty</label><input type="number" id="ln-q-${i}" min="1" max="99" value="${l.qty}" data-qty="${i}">
                    <button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove">✕</button></div>`).join("")
                    : `<div class="muted small sel-empty">No equipment added yet.</div>`;
            };
            const addLine = (name, data) => {
                name = String(name || "").trim();
                if (!name) return;
                const ex = lines.find(l => lc(l.name) === lc(name));
                if (ex) ex.qty++;
                else lines.push({ name, brand: data ? data.brand : "", model: data ? data.model : "", category: data ? data.category : "", qty: 1, available: data ? data.available : undefined });
                search.value = "";
                err("");
                renderLines();
            };
            const dateNote = () => {
                const c = root.querySelector("#ln-collect"), r = root.querySelector("#ln-return");
                r.min = c.value || earliest;
                const n = c.value && r.value ? daysBetween(c.value, r.value) : 0;
                if (root.querySelector("#ln-tbc").checked) return void (root.querySelector("#ln-dates").textContent = `Earliest collection: ${fmtDate(earliest)} (${notice} days' notice). Return date to be confirmed - set it later on the loan.`);
                root.querySelector("#ln-dates").textContent = `Earliest collection: ${fmtDate(earliest)} (${notice} days' notice).` + (c.value && r.value && n >= 0 ? ` Loan length: ${plural(n, "day")}.` : "");
            };
            search.addEventListener("combo:pick", e => addLine(e.detail.value, e.detail.data));
            search.addEventListener("combo:commit", () => addLine(search.value));
            search.addEventListener("keydown", e => { if (e.key === "Enter" && search.value.trim() && !e.defaultPrevented) { e.preventDefault(); addLine(search.value); } });
            root.querySelector("#ln-lines").addEventListener("input", e => { const q = e.target.dataset.qty; if (q !== undefined) lines[+q].qty = Math.max(1, parseInt(e.target.value, 10) || 1); });
            root.querySelector("#ln-lines").addEventListener("click", e => { const r = e.target.closest("[data-rm]"); if (r) { lines.splice(+r.dataset.rm, 1); renderLines(); } });
            root.querySelector("#ln-collect").addEventListener("change", dateNote);
            root.querySelector("#ln-return").addEventListener("change", dateNote);
            bindTbcTick(root, "#ln-tbc", "#ln-return", dateNote);
            root.querySelector("#ln-form").addEventListener("submit", async e => {
                e.preventDefault();
                if (search.value.trim()) addLine(search.value);
                const tbc = root.querySelector("#ln-tbc").checked;
                const collect = root.querySelector("#ln-collect").value, ret = tbc ? "" : root.querySelector("#ln-return").value;
                if (!lines.length) return err("Add at least one piece of equipment.");
                if (!collect || collect < earliest) return err(`Collection date must be ${fmtDate(earliest)} or later (${notice} days' notice).`);
                if (!tbc && (!ret || ret < collect)) return err("Return date must be on or after the collection date, or tick Return date TBC.");
                const id = store.newId("loans");
                const reason = root.querySelector("#ln-reason").value.trim();
                const who = root.querySelector("#ln-who").value.trim();
                if (!who) return err("Enter the borrower's name.");
                const items = lines.map(l => ({ name: l.name, brand: l.brand || "", model: l.model || "", category: l.category || "", qty: l.qty }));
                try {
                    await commitOps([
                        { op: "set", col: "loans", id, data: {
                            requestedByUid: authUser.uid, requestedBy: myEmail(), requestedByName: myName(), requestedAt: nowIso(),
                            borrowerName: who, source: "request",
                            items, collectDate: collect, returnDate: ret, returnTbc: tbc, reason, status: "requested", assigned: [],
                            history: [{ status: "requested", at: nowIso(), by: myEmail(), note: "" }] } },
                        makeLog("Loan requested", { label: items.map(i => `${i.qty}× ${i.name}`).join(", ") }, [], `For ${who} · ${collect} → ${ret || "TBC"}${reason ? ` · ${reason}` : ""}`, { ticketId: id })
                    ]);
                    closeDynModal();
                    toast("Loan request sent");
                    if (currentView !== "loans") switchView("loans");
                } catch (er) { err(friendlyError(er)); }
            });
            renderLines();
            dateNote();
        }
    });
}

// ---------- Approve: pick exact units ----------
function openLoanApprove(l) {
    if (!can("loans", "manage")) return;
    const slots = []; // { line, input }
    const linesHtml = (l.items || []).map((it, li) => `<div class="fulfil-line">
        <h4>${esc(it.qty)} × ${esc(it.name)} ${it.model ? `<span class="muted small">${equipmentList().find(e => e.name === it.name) ? `${equipmentList().find(e => e.name === it.name).available} available` : ""}</span>` : `<span class="muted small">custom item - pick any unit</span>`}</h4>
        ${Array.from({ length: it.qty }, (_, k) => `<div class="slot" data-slot="${li}-${k}">
            <input type="text" data-combo="loanAsset" data-combo-strict="1" data-model="${esc((it.brand || "") + "|" + (it.model || ""))}" data-line="${li}" autocomplete="off"
                placeholder="Type or scan Equipment ID: Asset No, Serial, Internal No" aria-label="Unit ${k + 1} for ${esc(it.name)}">
            <button type="button" class="icon-btn" data-clear-slot title="Leave this unit out" aria-label="Clear">✕</button>
            <div class="unit-card hidden"></div></div>`).join("")}
    </div>`).join("");
    showModal({
        title: "Approve loan", size: "lg", body: `
        <form id="la-form" class="form-stack" novalidate>
            <div class="ticket-summary"><div class="asset-cell"><b>${esc(l.requestedByName || l.requestedBy)}</b><span>${esc(l.requestedBy)}</span></div>
                <div><span class="muted small">${fmtDate(l.collectDate)} → ${loanReturnText(l)}</span><p class="desc">${esc(l.reason || "No reason given")}</p></div></div>
            <p class="muted small" style="margin:0">Assign the exact unit for each item. Details fill in automatically, and the units are set to <b>On Loan</b> when you approve.</p>
            ${linesHtml}
            <div class="field"><label for="la-note">Note to borrower <span class="hint">optional</span></label><input type="text" id="la-note" placeholder="e.g. Collect from the Mic Store after 2pm"></div>
            <p id="la-error" class="error-msg hidden"></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-ok">Approve &amp; set On Loan</button></div>
        </form>`,
        onMount(root) {
            const fill = (inp, a) => {
                const card = inp.parentElement.querySelector(".unit-card");
                inp.dataset.assetId = a ? a.id : "";
                card.classList.toggle("hidden", !a);
                if (a) card.innerHTML = [["Internal No", a.internalAssetNo], ["Asset No", a.assetNo], ["Serial No", a.serialNo], ["Code / AEV", a.code],
                    ["Model", `${a.brand} ${a.model}`], ["Location", [dv(a.itemSpace), dv(a.itemLocation)].filter(Boolean).join(" › ")], ["Condition", a.condition]]
                    .map(([k, v]) => `<div><span>${k}</span>${esc(dv(v) || "—")}</div>`).join("");
            };
            root.addEventListener("combo:pick", e => { if (e.target.dataset.combo === "loanAsset") fill(e.target, e.detail.data); });
            root.addEventListener("input", e => { if (e.target.dataset.combo === "loanAsset" && e.target.dataset.assetId) fill(e.target, null); });
            root.addEventListener("click", e => { const c = e.target.closest("[data-clear-slot]"); if (c) { const inp = c.parentElement.querySelector("input"); inp.value = ""; fill(inp, null); } });
            root.querySelector("#la-form").addEventListener("submit", async e => {
                e.preventDefault();
                const err = m => { const p = root.querySelector("#la-error"); p.textContent = m; p.classList.remove("hidden"); };
                const picked = Array.from(root.querySelectorAll("input[data-combo='loanAsset']")).filter(i => i.dataset.assetId);
                const typedButNotPicked = Array.from(root.querySelectorAll("input[data-combo='loanAsset']")).filter(i => i.value.trim() && !i.dataset.assetId);
                if (typedButNotPicked.length) return err("Choose each unit from the suggestions list (or clear it with ✕).");
                if (!picked.length) return err("Assign at least one unit.");
                const ids = picked.map(i => i.dataset.assetId);
                if (new Set(ids).size !== ids.length) return err("The same unit is assigned twice.");
                const unitsUnavailable = ids.map(assetById).filter(a => !a || a.condition !== "Available");
                if (unitsUnavailable.length) return err(`${unitsUnavailable.map(a => a ? assetLabel(a) : "A unit").join(", ")} is no longer Available.`);
                const note = root.querySelector("#la-note").value.trim();
                const assigned = picked.map(i => { const a = assetById(i.dataset.assetId); return {
                    assetId: a.id, label: assetLabel(a), brand: a.brand || "", model: a.model || "", category: a.category || "",
                    serialNo: dv(a.serialNo), assetNo: dv(a.assetNo), internalAssetNo: dv(a.internalAssetNo), prevCondition: a.condition, line: +i.dataset.line }; });
                const ops = [{ op: "update", col: "loans", id: l.id, data: {
                    status: "approved", assigned, approvedBy: myEmail(), approvedAt: nowIso(), approveNote: note, history: loanHist(l, "approved", note) } }];
                assigned.forEach(u => {
                    const a = assetById(u.assetId);
                    const m = wfAssetOps(a, { condition: "On Loan" }, "loans", l.id, "approved");
                    ops.push(...m.ops, makeLog("Loan approved", a, m.changes, `${l.requestedByName || l.requestedBy} · return ${loanReturnRaw(l)}`, { ticketId: l.id }));
                });
                const short = (l.items || []).reduce((s, x) => s + x.qty, 0) - assigned.length;
                try {
                    await commitOps(ops);
                    closeDynModal();
                    toast(`Approved · ${plural(assigned.length, "unit")} set to On Loan${short > 0 ? ` (${short} not assigned)` : ""}`);
                } catch (er) { err(friendlyError(er)); }
            });
        }
    });
}

async function rejectLoan(l) {
    const reason = await uiConfirm({ title: "Reject this loan request?", confirmText: "Reject", danger: true,
        message: loanItemsText(l), input: { label: "Reason (the borrower sees this)", required: true, requiredMsg: "Give a short reason." } });
    if (!reason) return;
    try {
        await commitOps([
            { op: "update", col: "loans", id: l.id, data: { status: "rejected", rejectReason: reason, rejectedBy: myEmail(), rejectedAt: nowIso(), history: loanHist(l, "rejected", reason) } },
            makeLog("Loan rejected", { label: loanItemsText(l) }, [], `${l.requestedByName || l.requestedBy}: ${reason}`, { ticketId: l.id })
        ]);
        toast("Loan request rejected");
    } catch (er) { toast(friendlyError(er), "err"); }
}

async function cancelLoanRequest(l) {
    if (!(await uiConfirm({ title: "Cancel this request?", message: loanItemsText(l), confirmText: "Cancel request", cancelText: "Keep it" }))) return;
    try {
        await commitOps([
            { op: "update", col: "loans", id: l.id, data: { status: "cancelled", cancelledAt: nowIso(), history: loanHist(l, "cancelled") } },
            makeLog("Loan cancelled", { label: loanItemsText(l) }, [], "Cancelled by borrower", { ticketId: l.id })
        ]);
        toast("Request cancelled");
    } catch (er) { toast(friendlyError(er), "err"); }
}

async function markCollected(l) {
    if (!(await uiConfirm({ title: "Mark as collected?", message: `Confirm you've picked up: ${loanItemsText(l)}.\n${loanTbc(l) ? "Return date: TBC. Set it on the loan once you know." : `Please return it by ${fmtDate(l.returnDate)}.`}`, confirmText: "I've collected it" }))) return;
    try {
        await commitOps([
            { op: "update", col: "loans", id: l.id, data: { status: "collected", collectedAt: nowIso(), history: loanHist(l, "collected") } },
            makeLog("Loan collected", { label: loanItemsText(l) }, [], `${myName()} · due back ${loanReturnRaw(l)}`, { ticketId: l.id })
        ]);
        toast("Marked as collected");
    } catch (er) { toast(friendlyError(er), "err"); }
}

async function requestReturn(l) {
    const note = await uiConfirm({ title: "Return this equipment?", confirmText: "Start return",
        message: `${loanItemsText(l)}\nHand it back to the team. They'll check each item in.`,
        input: { label: "Anything to flag? (optional)", placeholder: "e.g. One cable is frayed" } });
    if (note === false) return;
    try {
        await commitOps([
            { op: "update", col: "loans", id: l.id, data: { status: "returnRequested", returnRequestedAt: nowIso(), returnNote: note || "", history: loanHist(l, "returnRequested", note) } },
            makeLog("Loan return started", { label: loanItemsText(l) }, [], note || "", { ticketId: l.id })
        ]);
        toast("Return started - the team will check it in");
    } catch (er) { toast(friendlyError(er), "err"); }
}

// Several identical loans at once (the group buttons).
async function requestReturnMany(list) {
    const note = await uiConfirm({ title: `Return all ${list.length} loans?`, confirmText: "Start return",
        message: `${loanItemsText(list[0])} · ${plural(list.length, "loan")} for ${loanWho(list[0])}\nHand them back to the team. They'll check each item in.`,
        input: { label: "Anything to flag? (optional)", placeholder: "e.g. One cable is frayed" } });
    if (note === false) return;
    const ops = list.map(l => ({ op: "update", col: "loans", id: l.id, data: { status: "returnRequested", returnRequestedAt: nowIso(), returnNote: note || "", history: loanHist(l, "returnRequested", note) } }));
    ops.push(makeLog("Loan return started", { label: `${loanItemsText(list[0])} × ${list.length} loans` }, [], note || "", { ticketId: list[0].id }));
    try { await commitOps(ops); toast(`Return started for ${plural(list.length, "loan")} - the team will check them in`); } catch (er) { toast(friendlyError(er), "err"); }
}
function openLoanReceiveMany(list) {
    if (!can("loans", "manage")) return;
    let n = 0;
    const rows = list.map((l, li) => `<h4 class="loan-recv-h">${esc(loanItemsText(l))} · ${esc(loanWho(l))} <span class="muted small">(${li + 1} of ${list.length})</span></h4>` +
        ((l.assigned || []).map(u => {
            const a = assetById(u.assetId), i = n++;
            return `<div class="fulfil-line" data-li="${li}" data-unit="${i}">
                <h4>${esc(u.label)} <span class="muted small">${esc(u.brand)} ${esc(u.model)}${u.serialNo ? ` · S/N ${esc(u.serialNo)}` : ""}</span>${a ? "" : `<span class="warn-text">no longer in inventory</span>`}</h4>
                <div class="form-grid cols-3">
                    <div class="field"><label for="rm-cond-${i}">Condition</label><select id="rm-cond-${i}" ${a ? "" : "disabled"}>${condOptions(u.prevCondition && u.prevCondition !== "On Loan" ? u.prevCondition : "Available")}</select></div>
                    ${placeFields(`rm${i}`, a ? dv(a.itemSpace) : "", a ? dv(a.itemLocation) : "")}
                </div></div>`;
        }).join("") || `<p class="muted small">No units were assigned.</p>`)).join("");
    showModal({
        title: `Receive ${list.length} returned loans`, size: "lg", body: `
        <form id="rm-form" class="form-stack" novalidate>
            <p class="muted">${esc(loanItemsText(list[0]))} · ${plural(list.length, "loan")} for <b>${esc(loanWho(list[0]))}</b>. Check each unit's condition and place, then close them all.</p>
            ${rows}
            <div class="field"><label for="rm-note">Check-in notes <span class="hint">optional, applies to all</span></label><input type="text" id="rm-note" placeholder="e.g. All good, cables coiled"></div>
            <p id="rm-error" class="error-msg hidden"></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-ok">Check in &amp; close ${list.length} loans</button></div>
        </form>`,
        onMount(root) {
            root.querySelector("#rm-form").addEventListener("submit", async e => {
                e.preventDefault();
                const note = root.querySelector("#rm-note").value.trim(), ops = [];
                let k = 0;
                list.forEach(l => {
                    ops.push({ op: "update", col: "loans", id: l.id, data: { status: "returned", returnedAt: nowIso(), receivedBy: myEmail(), receiveNote: note, history: loanHist(l, "returned", note) } });
                    (l.assigned || []).forEach(u => {
                        const i = k++, a = assetById(u.assetId);
                        if (!a) return;
                        const m = wfAssetOps(a, { condition: root.querySelector(`#rm-cond-${i}`).value, itemSpace: root.querySelector(`#rm${i}-space`).value.trim(), itemLocation: root.querySelector(`#rm${i}-loc`).value.trim() }, "loans", l.id, "returned");
                        ops.push(...m.ops, makeLog("Loan returned", a, m.changes, [l.requestedByName || l.requestedBy, note].filter(Boolean).join(" · "), { ticketId: l.id }));
                    });
                });
                try {
                    await commitOps(ops);
                    closeDynModal();
                    toast(`${plural(list.length, "loan")} closed - units are back in the catalogue`);
                } catch (er) { const p = root.querySelector("#rm-error"); p.textContent = friendlyError(er); p.classList.remove("hidden"); }
            });
        }
    });
}

// ---------- Return date TBC -> a real date (manager or borrower) ----------
function setLoanReturnDate(l) {
    if (!loanTbc(l) || !(can("loans", "manage") || loanMine(l))) return;
    const from = String(l.collectDate || today()).slice(0, 10);
    showModal({
        title: "Set return date", size: "sm", body: `
        <form id="sd-form" class="form-stack" novalidate>
            <p class="muted">${esc(loanItemsText(l))} · for <b>${esc(loanWho(l))}</b> · collected ${fmtDate(from)}</p>
            <div class="field"><label for="sd-date">Return date *</label><input type="date" id="sd-date" min="${from}" value="${today() > from ? today() : from}"></div>
            <p id="sd-error" class="error-msg hidden"></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">Save date</button></div>
        </form>`,
        onMount(root) {
            root.querySelector("#sd-form").addEventListener("submit", async e => {
                e.preventDefault();
                const err = m => { const p = root.querySelector("#sd-error"); p.textContent = m; p.classList.remove("hidden"); };
                const d = root.querySelector("#sd-date").value;
                if (!d || d < from) return err("Pick a date on or after the collection date.");
                try {
                    await commitOps([
                        { op: "update", col: "loans", id: l.id, data: { returnDate: d, returnTbc: false, history: loanHist(l, l.status, `Return date set: ${d}`) } },
                        makeLog("Loan return date set", { label: loanItemsText(l) }, [{ field: "returnDate", from: "TBC", to: d }], loanWho(l), { ticketId: l.id })
                    ]);
                    closeDynModal();
                    toast(`Return date set: ${fmtDate(d)}`);
                } catch (er) { err(friendlyError(er)); }
            });
        }
    });
}

// ---------- Receive: restore each unit ----------
function openLoanReceive(l) {
    if (!can("loans", "manage")) return;
    const units = (l.assigned || []).map((u, i) => {
        const a = assetById(u.assetId);
        return `<div class="fulfil-line" data-unit="${i}">
            <h4>${esc(u.label)} <span class="muted small">${esc(u.brand)} ${esc(u.model)}${u.serialNo ? ` · S/N ${esc(u.serialNo)}` : ""}</span>${a ? "" : `<span class="warn-text">no longer in inventory</span>`}</h4>
            <div class="form-grid cols-3">
                <div class="field"><label for="rc-cond-${i}">Condition</label><select id="rc-cond-${i}" ${a ? "" : "disabled"}>${condOptions(u.prevCondition && u.prevCondition !== "On Loan" ? u.prevCondition : "Available")}</select></div>
                ${placeFields(`rc${i}`, a ? dv(a.itemSpace) : "", a ? dv(a.itemLocation) : "")}
            </div></div>`;
    }).join("");
    showModal({
        title: "Receive returned equipment", size: "lg", body: `
        <form id="rc-form" class="form-stack" novalidate>
            <div class="ticket-summary"><div class="asset-cell"><b>${esc(l.requestedByName || l.requestedBy)}</b><span>${esc(loanItemsText(l))}</span></div>
                <div class="muted small">Due ${loanReturnText(l)}${isLoanOverdue(l) ? ` · <b class="warn-text">overdue</b>` : ""}${l.returnNote ? `<p class="desc">“${esc(l.returnNote)}”</p>` : ""}</div></div>
            ${units || `<p class="muted">No units were assigned.</p>`}
            <div class="field"><label for="rc-note">Check-in notes <span class="hint">optional</span></label><input type="text" id="rc-note" placeholder="e.g. All good, cables coiled"></div>
            <p id="rc-error" class="error-msg hidden"></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-ok">Check in &amp; close loan</button></div>
        </form>`,
        onMount(root) {
            root.querySelector("#rc-form").addEventListener("submit", async e => {
                e.preventDefault();
                const note = root.querySelector("#rc-note").value.trim();
                const ops = [{ op: "update", col: "loans", id: l.id, data: { status: "returned", returnedAt: nowIso(), receivedBy: myEmail(), receiveNote: note, history: loanHist(l, "returned", note) } }];
                (l.assigned || []).forEach((u, i) => {
                    const a = assetById(u.assetId);
                    if (!a) return;
                    const m = wfAssetOps(a, { condition: root.querySelector(`#rc-cond-${i}`).value, itemSpace: root.querySelector(`#rc${i}-space`).value.trim(), itemLocation: root.querySelector(`#rc${i}-loc`).value.trim() }, "loans", l.id, "returned");
                    ops.push(...m.ops, makeLog("Loan returned", a, m.changes, [l.requestedByName || l.requestedBy, note].filter(Boolean).join(" · "), { ticketId: l.id }));
                });
                try {
                    await commitOps(ops);
                    closeDynModal();
                    toast("Loan closed - units are back in the catalogue");
                } catch (er) { const p = root.querySelector("#rc-error"); p.textContent = friendlyError(er); p.classList.remove("hidden"); }
            });
        }
    });
}

async function voidLoan(l) {
    const reason = await uiConfirm({ title: "Cancel this approved loan?", confirmText: "Cancel loan", danger: true,
        message: "Assigned units go back to the condition they had before approval.", input: { label: "Reason", required: true } });
    if (!reason) return;
    const ops = [{ op: "update", col: "loans", id: l.id, data: { status: "cancelled", cancelledAt: nowIso(), cancelledBy: myEmail(), rejectReason: reason, history: loanHist(l, "cancelled", reason) } }];
    (l.assigned || []).forEach(u => {
        const a = assetById(u.assetId);
        if (!a) return;
        const m = wfAssetOps(a, { condition: u.prevCondition || "Available" }, "loans", l.id, "cancelled");
        ops.push(...m.ops, makeLog("Loan cancelled", a, m.changes, reason, { ticketId: l.id }));
    });
    try { await commitOps(ops); toast("Loan cancelled - units released"); } catch (er) { toast(friendlyError(er), "err"); }
}

// =====================================================================
// Lending straight from the catalogue (condition set to "On Loan")
// Creates a linked loan that's already out ("On loan"), so it shows in Equipment Loans.
// =====================================================================
function openCatalogueLoan(a, onCancel) {
    if (!can("loans", "catalogue")) return onCancel && onCancel();
    let done = false;
    const root = showModal({
        title: `Lend ${esc(assetLabel(a))}`, body: `
        <form id="cl-form" class="form-stack" novalidate>
            <div class="ticket-summary"><div class="asset-cell"><b>${esc(assetLabel(a))}</b><span>${esc(equipName(a))} · ${esc(a.category)}${isGeneral(a) ? ` · ${a.qty} pcs` : ""}</span>
                ${[canViewCol("assetNo") && dv(a.assetNo), canViewCol("serialNo") && dv(a.serialNo) && `S/N ${dv(a.serialNo)}`].filter(Boolean).length ? `<span class="ids">${esc([canViewCol("assetNo") && dv(a.assetNo), canViewCol("serialNo") && dv(a.serialNo) && `S/N ${dv(a.serialNo)}`].filter(Boolean).join(" · "))}</span>` : ""}</div>
                <div class="muted small">Setting this to <b>On Loan</b> creates a loan in Equipment Loans.</div></div>
            <div class="field"><label for="cl-who">Borrower name *</label>
                <input type="text" id="cl-who" data-combo="borrower" autocomplete="off" placeholder="Who is taking it? e.g. Wei Ling (Drama Club)"></div>
            <div class="form-grid">
                <div class="field"><label for="cl-collect">Collection date *</label><input type="date" id="cl-collect" value="${today()}"></div>
                <div class="field"><label for="cl-return">Return date *</label><input type="date" id="cl-return" min="${today()}" value="${addDays(3)}">${tbcTickHtml("cl-tbc")}</div>
            </div>
            <div class="field"><label for="cl-reason">Reason for loan <span class="hint">optional</span></label><textarea id="cl-reason" rows="2" placeholder="e.g. Production week"></textarea></div>
            <p id="cl-error" class="error-msg hidden"></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">Lend &amp; set On Loan</button></div>
        </form>`,
        onMount(r) {
            r.querySelector("#cl-collect").addEventListener("change", e => { r.querySelector("#cl-return").min = e.target.value || today(); });
            bindTbcTick(r, "#cl-tbc", "#cl-return");
            r.querySelector("#cl-form").addEventListener("submit", async e => {
                e.preventDefault();
                const err = m => { const p = r.querySelector("#cl-error"); p.textContent = m; p.classList.remove("hidden"); };
                const who = r.querySelector("#cl-who").value.trim();
                const tbc = r.querySelector("#cl-tbc").checked;
                const collect = r.querySelector("#cl-collect").value, ret = tbc ? "" : r.querySelector("#cl-return").value;
                if (!who) return err("Enter the borrower's name.");
                if (!collect) return err("Pick the collection date.");
                if (!tbc && (!ret || ret < collect)) return err("Return date must be on or after the collection date, or tick Return date TBC.");
                const reason = r.querySelector("#cl-reason").value.trim();
                const id = store.newId("loans");
                const now = nowIso();
                const unit = { assetId: a.id, label: assetLabel(a), brand: a.brand || "", model: a.model || "", category: a.category || "",
                    serialNo: dv(a.serialNo), assetNo: dv(a.assetNo), internalAssetNo: dv(a.internalAssetNo), prevCondition: a.condition, line: 0 };
                const m = wfAssetOps(a, { condition: "On Loan" }, "loans", id, "lent");
                try {
                    await commitOps([
                        { op: "set", col: "loans", id, data: {
                            source: "catalogue", status: "collected", borrowerName: who,
                            requestedByUid: authUser.uid, requestedBy: myEmail(), requestedByName: myName(), requestedAt: now,
                            items: [{ name: equipName(a), brand: a.brand || "", model: a.model || "", category: a.category || "", qty: isGeneral(a) ? units(a) : 1 }],
                            collectDate: collect, returnDate: ret, returnTbc: tbc, reason, assigned: [unit],
                            approvedBy: myEmail(), approvedAt: now, collectedAt: now,
                            history: [{ status: "collected", at: now, by: myEmail(), note: "Lent from the catalogue" }] } },
                        ...m.ops,
                        makeLog("Loan created from catalogue", a, m.changes, `${who} · return ${ret || "TBC"}${reason ? ` · ${reason}` : ""}`, { ticketId: id })
                    ]);
                    done = true;
                    closeDynModal();
                    toast(`${assetLabel(a)} is on loan to ${who}`);
                } catch (er) { err(friendlyError(er)); }
            });
        }
    });
    // Escape closes the modal without a click - treat it as cancel too
    const obs = new MutationObserver(() => { if (!document.body.contains(root)) { obs.disconnect(); if (!done) { done = true; onCancel && onCancel(); } } });
    obs.observe($("modal-host"), { childList: true });
}

// Condition changed away from On Loan in the catalogue: close the linked loan as returned.
async function closeLoanFromCatalogue(a, l, nextCondition) {
    const others = (l.assigned || []).filter(u => u.assetId !== a.id && (assetById(u.assetId) || {}).condition === "On Loan");
    const m = wfAssetOps(a, { condition: nextCondition }, "loans", l.id, "returned");
    const ops = [...m.ops, makeLog("Loan returned", a, m.changes, `${loanWho(l)} · closed from the catalogue`, { ticketId: l.id })];
    if (!others.length) ops.unshift({ op: "update", col: "loans", id: l.id, data: {
        status: "returned", returnedAt: nowIso(), receivedBy: myEmail(), receiveNote: "Closed from the catalogue", history: loanHist(l, "returned", "Closed from the catalogue") } });
    else ops.unshift({ op: "update", col: "loans", id: l.id, data: { history: loanHist(l, l.status, `${assetLabel(a)} returned via the catalogue`) } });
    try {
        await commitOps(ops);
        toast(others.length ? `${assetLabel(a)} returned - ${plural(others.length, "unit")} still out on this loan` : `Loan to ${loanWho(l)} closed`);
    } catch (er) { toast(friendlyError(er), "err"); requestRender(true); }
}

$("loans-container").addEventListener("keydown", e => {
    const t = e.target.closest && e.target.closest("[data-loan-toggle]");
    if (t && t === e.target && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); t.click(); }
});
