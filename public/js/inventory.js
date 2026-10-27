// =====================================================================
// Asset Catalogue: grouped table, condition / year mix, inline editing, detailed + general asset forms, CSV.
// The row renderer + event handlers here are shared by Rack Layout and Inventory Check.
// =====================================================================

// ---------- Shared asset row pieces ----------
function openTicketFor(id) { return tickets.find(t => t.assetId === id) || null; }
function openLoanFor(id) { return loans.find(l => OPEN_LOAN.includes(l.status) && (l.assigned || []).some(a => a.assetId === id)) || null; }
function pendingDiscFor(id) { return discrepancies.find(d => d.assetId === id && d.status === "pending") || null; }
const loanWho = l => l.borrowerName || l.requestedByName || l.requestedBy || "";

function assetTags(it) {
    const t = openTicketFor(it.id), l = openLoanFor(it.id), d = pendingDiscFor(it.id);
    return [
        t ? `<button type="button" class="ticket-tag stage-${t.stage}" data-action="goto" data-view="maintenance" title="Open maintenance ticket">${esc(stageLabel(t.stage))}</button>` : "",
        l ? `<button type="button" class="ticket-tag loan" data-action="goto" data-view="loans" title="On loan to ${esc(loanWho(l))} - due ${esc(loanReturnRaw(l))}">📦 ${esc(loanWho(l).split(" ")[0])}</button>` : "",
        d ? `<button type="button" class="ticket-tag disc" data-action="goto" data-view="check" title="Discrepancy waiting for review">Reported</button>` : "",
        needsFinance(it) ? `<span class="ticket-tag finance" title="Bought ${esc(it.yearOfPurchase)} - no finance code yet">Needs code</span>` : ""
    ].join("");
}

// One editable cell. Condition ignores the edit toggle; everything else (Year of Purchase included) needs it.
function assetCell(it, col, inline) {
    if (col.key === "condition") {
        const editable = canEditCell(it, "condition");
        const opts = CONDITIONS.includes(it.condition) ? CONDITIONS : [...CONDITIONS, it.condition];
        return `<td><select class="cond-select ${condClass(it.condition)}" data-id="${esc(it.id)}" ${editable ? "" : "disabled"} aria-label="Condition of ${esc(assetLabel(it))}">
            ${opts.map(o => `<option value="${esc(o)}" ${it.condition === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>${faultTag(it)}</td>`;
    }
    const editable = inline && canEditCell(it, col.key);
    if (col.key === "yearOfPurchase") {
        return `<td><select class="year-select ${inline && !editable ? "locked" : ""} ${dv(it.yearOfPurchase) ? "" : "unset"}" data-id="${esc(it.id)}" ${editable ? "" : "disabled"} aria-label="Year of purchase of ${esc(assetLabel(it))}">
            ${yearOptions(dv(it.yearOfPurchase), "—")}</select></td>`;
    }
    if (col.key === "qty") {
        if (!isGeneral(it)) return `<td class="qty-cell muted">1</td>`;
        return `<td class="qty-cell"><input type="number" min="0" class="cell-input qty-input ${inline && !editable ? "locked" : ""}" data-id="${esc(it.id)}" data-field="qty"
            value="${esc(it.qty)}" aria-label="Quantity" ${editable ? "" : "readonly tabindex=\"-1\""}></td>`;
    }
    const cls = ["cell-input", col.strong ? "strong" : "", col.mono ? "mono" : "", inline && !editable ? "locked" : ""].join(" ");
    // v5.7: long values (asset no, serial) widen their column, so the table scrolls sideways instead of cutting them off
    const w = String(dv(it[col.key])).length;
    return `<td><input class="${cls}" data-id="${esc(it.id)}" data-field="${col.key}" value="${esc(dv(it[col.key]))}" ${w > 9 ? `style="min-width:calc(${w}ch + 1rem)"` : ""}
        ${col.combo && editable ? `data-combo="${col.combo}" autocomplete="off"` : ""}
        placeholder="${editable ? esc(col.ph || "") : ""}" aria-label="${esc(col.label)}" ${editable ? "" : "readonly tabindex=\"-1\""}></td>`;
}

function assetActions(it, extra) {
    const t = openTicketFor(it.id);
    return `<td class="actions-cell">${assetTags(it)}${extra || ""}
        ${canEditAny() && canEditRow(it) ? `<button type="button" class="icon-btn" data-action="edit" data-id="${esc(it.id)}" title="Edit asset" aria-label="Edit">✎</button>` : ""}
        ${!t && can("maintenance", "submit") ? `<button type="button" class="icon-btn" data-action="report" data-id="${esc(it.id)}" title="Log maintenance / report a fault" aria-label="Report fault">⚠</button>` : ""}
        ${can("catalogue", "delete") ? `<button type="button" class="icon-btn danger" data-action="delete" data-id="${esc(it.id)}" title="Delete asset" aria-label="Delete">🗑</button>` : ""}
    </td>`;
}

// keys: limit to these columns; withQty: include the Qty column (only when general items are shown)
const visibleColumns = (keys, withQty) => ROW_COLUMNS.filter(c => (!keys || keys.includes(c.key)) && (c.key !== "qty" || withQty) && canViewCol(c.key));

// ---------- Filters ----------
function fillSelect(id, allLabel, values, extra) {
    const el = $(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="ALL">${esc(allLabel)}</option>` + (extra || "") + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    el.value = Array.from(el.options).some(o => o.value === cur) ? cur : "ALL";
}
const allCategories = () => uniq(inventory.map(i => i.category)).sort();
const allSpaces = () => uniq(inventory.map(i => dv(i.itemSpace))).sort();
const usedYears = () => uniq(inventory.map(i => dv(i.yearOfPurchase))).sort().reverse();

function refreshDynamicDropdowns() {
    fillSelect("filter-category", "All categories", allCategories());
    fillSelect("rack-category", "All categories", allCategories());
    fillSelect("rack-space", "All spaces", allSpaces());
    fillSelect("filter-year", "All purchase years", usedYears(), `<option value="FINANCE">Needs finance code</option><option value="NOCODE">No code</option><option value="NONE">Year not set</option>`);
    const spaces = new Set();
    inventory.forEach(it => {
        const sp = canViewCol("itemSpace") ? dv(it.itemSpace) : "", lo = canViewCol("itemLocation") ? dv(it.itemLocation) : "";
        if (sp) spaces.add(sp);
        if (lo) spaces.add(lo);
        if (sp && lo) spaces.add(`${sp} (${lo})`);
    });
    fillSelect("filter-location", "All spaces / locations", Array.from(spaces).sort());
}

function searchHay(it) {
    return ["category", "brand", "model", "description", ...ROW_KEYS].filter(canViewCol).map(k => lc(it[k])).join("\u0001");
}

const yearMatch = (it, y) => y === "ALL" || (y === "NONE" ? !dv(it.yearOfPurchase) : y === "FINANCE" ? needsFinance(it) : y === "NOCODE" ? noCode(it) : dv(it.yearOfPurchase) === y);

function getFiltered() {
    const q = $("search-input").value.trim().toLowerCase();
    const cat = $("filter-category").value, loc = $("filter-location").value, cond = $("filter-condition").value, year = $("filter-year").value;
    return inventory.filter(it => {
        const combined = `${it.itemSpace || ""} (${it.itemLocation || ""})`;
        return (!q || searchHay(it).includes(q)) &&
            (cat === "ALL" || it.category === cat) &&
            (loc === "ALL" || it.itemSpace === loc || it.itemLocation === loc || combined === loc) &&
            (cond === "ALL" || it.condition === cond) &&
            yearMatch(it, year);
    });
}
const filtersActive = () => !!$("search-input").value.trim() || ["filter-category", "filter-location", "filter-condition", "filter-year"].some(id => $(id).value !== "ALL");

// Space / location sorts: the models line up by the first space (or location) they sit in, and the rows inside a model by space then location.
const PLACE_SORT = { space: ["itemSpace", "itemLocation"], location: ["itemLocation", "itemSpace"] };
const placeText = (it, f) => { const v = dv(it[f]).trim(); return v === "N/A" ? "" : v; };
function placeCompare(a, b, [first, second], d = 1) {
    const A = placeText(a, first), B = placeText(b, first);
    if (!A !== !B) return A ? -1 : 1;       // blanks last, either way round
    return (sortCollator.compare(A, B) || sortCollator.compare(placeText(a, second), placeText(b, second))) * d;
}

function sortItems(items, sortKey) {
    const place = PLACE_SORT[sortKey.split("_")[0]];
    if (place) { const d = sortKey.endsWith("_desc") ? -1 : 1; return items.slice().sort((a, b) => placeCompare(a, b, place, d)); }
    const field = sortKey.startsWith("code") ? "code" : sortKey.startsWith("asset") ? "assetNo" : sortKey.startsWith("serial") ? "serialNo" : sortKey.startsWith("year") ? "yearOfPurchase" : "internalAssetNo";
    const desc = sortKey.endsWith("_desc");
    return items.slice().sort((a, b) => {
        const A = dv(a[field]).trim() === "N/A" ? "" : dv(a[field]).trim();
        const B = dv(b[field]).trim() === "N/A" ? "" : dv(b[field]).trim();
        if (!A && !B) return 0;
        if (!A) return 1;
        if (!B) return -1;
        const nA = Number(A), nB = Number(B);
        const cmp = (!isNaN(nA) && !isNaN(nB)) ? nA - nB : A.localeCompare(B, undefined, { numeric: true, sensitivity: "base" });
        return desc ? -cmp : cmp;
    });
}

// ---------- Condition / Year mix + action tiles ----------
let mixTab = "condition";

function renderOpsStrip() {
    const el = $("ops-mix"), tilesEl = $("ops-tiles");
    if (!el || !tilesEl || !profile) return;
    const totalUnits = inventory.reduce((n, a) => n + units(a), 0) || 1;
    const shown = getFiltered().reduce((n, a) => n + units(a), 0);
    let bar, legend, hint;
    if (mixTab === "condition") {
        const counts = Object.fromEntries(CONDITIONS.map(c => [c, 0]));
        inventory.forEach(i => { if (counts[i.condition] !== undefined) counts[i.condition] += units(i); });
        const active = $("filter-condition").value;
        bar = CONDITIONS.filter(c => counts[c]).map(c =>
            `<button type="button" class="seg ${condClass(c)}" style="flex:${counts[c]}" title="${esc(c)}: ${counts[c]} (${Math.round(counts[c] * 100 / totalUnits)}%)" data-cond="${esc(c)}" aria-label="Filter ${esc(c)}"></button>`).join("");
        legend = CONDITIONS.map(c =>
            `<button type="button" class="chip ${condClass(c)} ${active === c ? "active" : ""} ${counts[c] ? "" : "zero"}" data-cond="${esc(c)}"><b>${counts[c]}</b>${esc(c)}</button>`).join("");
        hint = "Click a condition to filter";
    } else {
        const counts = {};
        inventory.forEach(i => { const y = dv(i.yearOfPurchase) || "NONE"; counts[y] = (counts[y] || 0) + units(i); });
        const years = Object.keys(counts).filter(y => y !== "NONE").sort().reverse();
        const fin = inventory.filter(needsFinance).reduce((n, a) => n + units(a), 0);
        const nocode = inventory.filter(noCode).reduce((n, a) => n + units(a), 0);
        const active = $("filter-year").value;
        const shade = i => `--c: color-mix(in srgb, var(--accent) ${Math.max(35, 100 - i * 12)}%, var(--surface-3))`;
        bar = [...years.map((y, i) => `<button type="button" class="seg" style="flex:${counts[y]};${shade(i)}" title="${y}: ${counts[y]}" data-year="${y}" aria-label="Filter ${y}"></button>`),
            counts.NONE ? `<button type="button" class="seg cond-decommissioned" style="flex:${counts.NONE}" title="Year not set: ${counts.NONE}" data-year="NONE" aria-label="Year not set"></button>` : ""].join("");
        legend = `<button type="button" class="chip finance-chip ${active === "FINANCE" ? "active" : ""} ${fin ? "" : "zero"}" data-year="FINANCE"><b>${fin}</b>Needs finance code</button>` +
            `<button type="button" class="chip nocode-chip ${active === "NOCODE" ? "active" : ""} ${nocode ? "" : "zero"}" data-year="NOCODE" title="In use, no Code / AEV (any year)"><b>${nocode}</b>No code</button>` +
            years.map((y, i) => `<button type="button" class="chip year-chip ${active === y ? "active" : ""}" style="${shade(i)}" data-year="${y}"><b>${counts[y]}</b>${y}</button>`).join("") +
            `<button type="button" class="chip cond-decommissioned ${active === "NONE" ? "active" : ""} ${counts.NONE ? "" : "zero"}" data-year="NONE"><b>${counts.NONE || 0}</b>Year not set</button>`;
        hint = "Year set but no Code = send to finance · No code = any asset in use without a Code / AEV";
    }

    const tiles = [];
    const overdueDays = window.APP_CONFIG.repairOverdueDays || 14;
    if (can("maintenance", "verify")) {
        const req = tickets.filter(t => t.stage === "request").length;
        tiles.push(`<button type="button" class="ops-tile ${req ? "hot" : ""}" data-goto="maintenance"><span class="n">${req}</span><span class="l">Fault reports to verify</span></button>`);
    }
    if (can("maintenance", "repair") || can("maintenance", "viewWork")) {
        const rep = tickets.filter(t => t.stage === "repairing");
        const overdue = rep.filter(t => daysSince(t.dateSent || t.sentAt) > overdueDays).length;
        tiles.push(`<button type="button" class="ops-tile ${overdue ? "warn" : ""}" data-goto="maintenance"><span class="n">${rep.length}</span><span class="l">At repair vendor${overdue ? ` · <b>${overdue} overdue</b>` : ""}</span></button>`);
    } else if (tabOn("maintenance")) {
        const mine = tickets.filter(t => t.requestedByUid === authUser.uid).length;
        tiles.push(`<button type="button" class="ops-tile" data-goto="maintenance"><span class="n">${mine}</span><span class="l">My open fault reports</span></button>`);
    }
    if (can("loans", "manage")) {
        const req = loans.filter(l => l.status === "requested" || l.status === "returnRequested").length;
        tiles.push(`<button type="button" class="ops-tile ${req ? "hot" : ""}" data-goto="loans"><span class="n">${req}</span><span class="l">Loan requests &amp; returns</span></button>`);
    } else if (tabOn("loans")) {
        const mine = loans.filter(l => l.requestedByUid === authUser.uid && ["requested", ...OPEN_LOAN].includes(l.status)).length;
        tiles.push(`<button type="button" class="ops-tile" data-goto="loans"><span class="n">${mine}</span><span class="l">My active loans</span></button>`);
    }
    if (can("check", "review")) {
        const n = discrepancies.filter(d => d.status === "pending").length;
        tiles.push(`<button type="button" class="ops-tile ${n ? "hot" : ""}" data-goto="check"><span class="n">${n}</span><span class="l">Check discrepancies to review</span></button>`);
    }
    const fin = inventory.filter(needsFinance).length;
    if (tiles.length < 4 && fin && canViewCol("code")) tiles.push(`<button type="button" class="ops-tile warn" data-finance><span class="n">${fin}</span><span class="l">Need a finance code</span></button>`);
    if (tiles.length < 4 && can("maintenance", "submit")) tiles.push(`<button type="button" class="ops-tile action" data-action="report"><span class="n">⚠</span><span class="l">Report a faulty item</span></button>`);
    if (tiles.length < 4 && can("loans", "request")) tiles.push(`<button type="button" class="ops-tile action" data-goto-act="loan"><span class="n">⇄</span><span class="l">Request a loan</span></button>`);

    tilesEl.innerHTML = tiles.slice(0, 4).join("");
    el.innerHTML = `
        <div class="ops-mix">
            <div class="ops-mix-head">
                <div class="mix-tabs" role="tablist">
                    <button type="button" class="mix-tab ${mixTab === "condition" ? "active" : ""}" data-mix="condition" role="tab" aria-selected="${mixTab === "condition"}">Condition</button>
                    <button type="button" class="mix-tab ${mixTab === "year" ? "active" : ""}" data-mix="year" role="tab" aria-selected="${mixTab === "year"}">Year of purchase</button>
                </div>
                <span class="right"><span class="muted small">${shown === totalUnits ? `${totalUnits} units` : `${shown} of ${totalUnits} units shown`} · ${hint}</span>
                <button type="button" class="btn btn-sm chip-clear" data-clear ${filtersActive() ? "" : "disabled"}>Clear all</button></span>
            </div>
            <div class="cond-bar">${bar || `<span class="seg" style="flex:1"></span>`}</div>
            <div class="chip-row">${legend}</div>
        </div>`;
}

// ---------- Catalogue table ----------
const openDrawers = new Set();
// Models drawn at once: drawing all ~500 model groups of 4,000 assets on every change made the site sluggish.
const GROUP_PAGE = 100;
let groupsShown = GROUP_PAGE, groupsKey = "";
const sortCollator = new Intl.Collator(undefined, { sensitivity: "base" });

function renderCatalogue() {
    renderOpsStrip();
    const container = $("inventory-container");
    if (invError) { container.innerHTML = `<div class="empty-state">Couldn't reach the database. Check your connection and Firestore rules, then reload.</div>`; return; }
    if (!invLoaded) { container.innerHTML = `<div class="empty-state">Connecting to database…</div>`; return; }
    if (!inventory.length) { container.innerHTML = `<div class="empty-state">No assets yet.${can("catalogue", "addDetailed") || can("catalogue", "addGeneral") ? " Use <b>+ Add Asset</b> or <b>Import</b> to get started." : ""}</div>`; return; }
    const filtered = getFiltered();
    if (!filtered.length) { container.innerHTML = `<div class="empty-state">No assets match your search or filters. <a href="#" onclick="clearAllFilters(); return false;">Clear all filters</a></div>`; return; }

    const sortVal = $("sort-order").value;
    const groups = {};
    filtered.forEach(it => { const k = groupKeyOf(it); (groups[k] = groups[k] || []).push(it); });
    const keys = Object.keys(groups).sort((a, b) => {
        if (sortVal.startsWith("brand")) {
            const cmp = sortCollator.compare((groups[a][0].brand || "").trim(), (groups[b][0].brand || "").trim());
            if (cmp !== 0) return sortVal.endsWith("_desc") ? -cmp : cmp;
        }
        const place = PLACE_SORT[sortVal.split("_")[0]];
        if (place) {
            const d = sortVal.endsWith("_desc") ? -1 : 1, first = g => groups[g].slice().sort((x, y) => placeCompare(x, y, place, d))[0];
            const cmp = placeCompare(first(a), first(b), place, sortVal.endsWith("_desc") ? -1 : 1);
            if (cmp !== 0) return cmp;
        }
        return sortCollator.compare(a, b);
    });
    // A new search / filter / sort starts again from the first page of models.
    const fKey = [$("search-input").value, $("filter-category").value, $("filter-location").value, $("filter-condition").value, $("filter-year").value, sortVal].join("|");
    if (fKey !== groupsKey) { groupsKey = fKey; groupsShown = GROUP_PAGE; }
    const shownKeys = keys.slice(0, Math.max(groupsShown, ...keys.map((k, i) => openDrawers.has(k) ? i + 1 : 0)));

    const inline = inlineOn();
    const more = keys.length - shownKeys.length;
    container.innerHTML = shownKeys.map(key => {
        const items = groups[key];
        const first = items[0];
        const open = openDrawers.has(key);
        const hasGeneral = items.some(isGeneral);
        const cols = visibleColumns(null, hasGeneral);
        const condCounts = {};
        items.forEach(it => { condCounts[it.condition] = (condCounts[it.condition] || 0) + units(it); });
        const badges = Object.keys(condCounts).map(c =>
            `<span class="pill ${condClass(c)}"><span>${condCounts[c]}</span><span>${esc(COND_SHORT[c] || c)}</span></span>`).join("");
        const total = items.reduce((n, a) => n + units(a), 0);
        const table = open ? `<div class="table-scroll"><table class="asset-table ${inline ? "inline-on" : ""}">
                <thead><tr>${cols.map(c => `<th>${esc(c.label)}</th>`).join("")}<th></th></tr></thead>
                <tbody>${sortItems(items, sortVal).map(it => `<tr>${cols.map(c => assetCell(it, c, inline)).join("")}${assetActions(it)}</tr>`).join("")}</tbody>
            </table></div>` : "";
        return `<div class="asset-group">
            <div class="group-head ${open ? "open" : ""}" data-group="${esc(key)}" role="button" tabindex="0" aria-expanded="${open}">
                <div class="group-title">
                    <span class="chev ${open ? "open" : ""}">▶</span>
                    <span class="group-name">${first.brand && first.brand !== "Generic" ? `<span class="brand">${esc(first.brand)}</span>` : ""}${esc(first.model || "Unknown Model")}</span>
                    ${first.description ? `<span class="group-desc">${esc(first.description)}</span>` : ""}
                    <span class="tag">${esc(first.category || "General")}</span>
                    ${hasGeneral ? `<span class="tag bulk">Bulk</span>` : ""}
                </div>
                <div class="group-badges"><span class="pill qty">Total Qty: ${total}</span>${badges}</div>
            </div>
            ${table}
        </div>`;
    }).join("") + (more > 0 ? `<div class="group-more"><span class="muted small">Showing ${shownKeys.length} of ${keys.length} models. Search or filter to find one faster.</span>
        <button type="button" class="btn btn-sm" data-groups-more="${GROUP_PAGE}">Show ${Math.min(GROUP_PAGE, more)} more</button>
        <button type="button" class="btn btn-ghost btn-sm" data-groups-more="all">Show all</button></div>` : "");
}
document.addEventListener("click", e => {
    const b = e.target.closest("[data-groups-more]");
    if (!b) return;
    groupsShown = b.dataset.groupsMore === "all" ? Infinity : groupsShown + GROUP_PAGE;
    renderCatalogue();
});

function handleSearch() { requestRender(true); }

function clearAllFilters() {
    $("search-input").value = "";
    ["filter-category", "filter-location", "filter-condition", "filter-year"].forEach(id => { $(id).value = "ALL"; });
    handleSearch();
}

// ---------- Edit mode ----------
function toggleEditMode() {
    if (!canEditNonCondition()) return;
    editMode = !editMode;
    try { localStorage.setItem("sb_edit_" + authUser.uid, editMode ? "1" : "0"); } catch (e) { /* ignore */ }
    renderEditToggle();
    requestRender(true);
    toast(editMode ? "Edit mode on - table cells are editable" : "Edit mode off - only Condition stays editable");
}

function renderEditToggle() {
    const on = inlineOn();
    document.querySelectorAll(".edit-toggle").forEach(b => {
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
        b.querySelector(".edit-toggle-label").textContent = `Edit: ${on ? "On" : "Off"}`;
    });
    document.querySelectorAll(".edit-banner").forEach(b => b.classList.toggle("hidden", !on));
}

// ---------- Condition changes (with the On Loan hand-off) ----------
// Picking "Faulty" opens the same fault report as the ⚠ button, so a maintenance ticket is made too.
// (Not when the asset already has an open ticket, or the person can't report faults.)
const faultTag = it => { const f = faultNote(it); return f ? `<span class="fault-tag ${f}">${f === "pending" ? "Awaiting confirmation" : "Confirmed faulty"}</span>` : ""; };
const faultReportFirst = it => it && it.condition !== "Faulty" && can("maintenance", "submit") && !tickets.some(t => t.assetId === it.id);
function openFaultFor(it) {
    openLogMaintenance(it.id, { fromFaulty: true, onClose: () => requestRender(true) });
}

async function changeCondition(sel) {
    const it = assetById(sel.dataset.id);
    if (!it) return;
    const next = sel.value;
    if (next === it.condition) return;
    if (next === "Faulty" && faultReportFirst(it)) return openFaultFor(it);
    // Lending from the catalogue: capture the loan details first.
    if (next === "On Loan") {
        if (!can("loans", "catalogue")) {
            toast("To lend an item, use Equipment Loans - you can't set On Loan here", "err");
            sel.value = it.condition;
            return;
        }
        return openCatalogueLoan(it, () => { sel.value = it.condition; requestRender(true); });
    }
    // Coming back from On Loan with an open loan: offer to close it.
    const loan = it.condition === "On Loan" && openLoanFor(it.id);
    if (loan && can("loans", "manage")) {
        const close = await uiConfirm({ title: `Close the loan to ${loanWho(loan)}?`, confirmText: "Close loan & update", cancelText: "Only change condition",
            message: `${assetLabel(it)} is on loan (due ${loanReturnText(loan)}). Closing records it as returned in Equipment Loans.` });
        if (close) return closeLoanFromCatalogue(it, loan, next);
    }
    updateAsset(it.id, { condition: next });
}

// ---------- Shared event handling for every .asset-zone (catalogue, rack, check) ----------
document.addEventListener("click", e => {
    const zone = e.target.closest(".asset-zone");
    if (!zone) return;
    const act = e.target.closest("[data-action]");
    if (act) {
        const a = act.dataset.action, id = act.dataset.id;
        if (a === "edit") editAsset(id);
        else if (a === "delete") deleteAsset(id);
        else if (a === "report") openLogMaintenance(id);
        else if (a === "goto") switchView(act.dataset.view);
        else if (a === "discrepancy") openDiscrepancy(id);
        return;
    }
    const head = e.target.closest(".group-head");
    if (head) toggleDrawer(head.dataset.group);
});

document.addEventListener("keydown", e => {
    const t = e.target;
    if (t.classList && t.classList.contains("group-head") && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggleDrawer(t.dataset.group); }
    if (!t.closest || !t.closest(".asset-zone") || !t.classList.contains("cell-input")) return;
    if (e.key === "Enter") t.blur();
    if (e.key === "Escape") { const it = assetById(t.dataset.id); if (it) t.value = dv(it[t.dataset.field]); t.blur(); }
});

document.addEventListener("change", e => {
    const t = e.target;
    if (!t.closest || !t.closest(".asset-zone")) return;
    if (t.classList.contains("cond-select") && !t.disabled) {
        changeCondition(t);
    } else if (t.classList.contains("year-select") && !t.disabled && inlineOn()) {
        updateAsset(t.dataset.id, { yearOfPurchase: t.value });
    } else if (t.classList.contains("cell-input") && !t.readOnly && inlineOn()) {
        if (t.dataset.sent === t.value) return; // the combo-box and blur can both fire "change"
        t.dataset.sent = t.value;
        const v = t.dataset.field === "qty" ? String(Math.max(0, parseInt(t.value, 10) || 0)) : t.value.trim();
        updateAsset(t.dataset.id, { [t.dataset.field]: t.dataset.field === "qty" ? +v : v });
    } else if (t.classList.contains("check-box")) {
        toggleCheck(t.dataset.id, t.checked);
    }
});

document.addEventListener("focusout", e => {
    if (!pendingRender || !e.target.closest || !e.target.closest(".asset-zone")) return;
    setTimeout(() => { if (pendingRender) requestRender(); }, 0);
});

$("ops-strip").addEventListener("click", e => {
    if (e.target.closest("[data-clear]")) return clearAllFilters();
    const tab = e.target.closest("[data-mix]");
    if (tab) { mixTab = tab.dataset.mix; return renderOpsStrip(); }
    const cond = e.target.closest("[data-cond]");
    if (cond) {
        const sel = $("filter-condition");
        sel.value = sel.value === cond.dataset.cond ? "ALL" : cond.dataset.cond;
        return handleSearch();
    }
    const yr = e.target.closest("[data-year]");
    if (yr) {
        const sel = $("filter-year");
        sel.value = sel.value === yr.dataset.year ? "ALL" : yr.dataset.year;
        return handleSearch();
    }
    if (e.target.closest("[data-finance]")) { mixTab = "year"; $("filter-year").value = "FINANCE"; return handleSearch(); }
    const go = e.target.closest("[data-goto]");
    if (go) return switchView(go.dataset.goto);
    if (e.target.closest("[data-action='report']")) return openLogMaintenance();
    if (e.target.closest("[data-goto-act='loan']")) { switchView("loans"); openLoanRequest(); }
});

function toggleDrawer(key) {
    if (openDrawers.has(key)) openDrawers.delete(key); else openDrawers.add(key);
    renderCatalogue();
}

// ---------- Add Asset menu (Detailed / General) ----------
function toggleAddMenu(force) {
    const m = $("add-menu");
    const open = force !== undefined ? force : m.classList.contains("hidden");
    m.classList.toggle("hidden", !open);
    $("add-asset-btn").setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
        m.querySelector("[data-add=detailed]").classList.toggle("hidden", !can("catalogue", "addDetailed"));
        m.querySelector("[data-add=general]").classList.toggle("hidden", !can("catalogue", "addGeneral"));
    }
}
document.addEventListener("click", e => {
    const m = $("add-menu");
    if (!m || m.classList.contains("hidden")) return;
    const pick = e.target.closest("[data-add]");
    if (pick) { toggleAddMenu(false); return pick.dataset.add === "general" ? openAddGeneralModal() : openAddItemModal(); }
    if (!e.target.closest("#add-asset-wrap")) toggleAddMenu(false);
});

// ---------- Detailed add / edit ----------
const FORM_IDS = {
    category: "form-category", brand: "form-brand", model: "form-model", description: "form-description",
    internalAssetNo: "form-internal-no", assetNo: "form-asset-no", serialNo: "form-serial-no", code: "form-code",
    itemSpace: "form-item-space", itemLocation: "form-item-location", condition: "form-condition",
    yearOfPurchase: "form-year", qty: "form-qty", remarks: "form-remarks"
};
const assetErr = m => { $("asset-error").textContent = m || ""; $("asset-error").classList.toggle("hidden", !m); };

function openAddItemModal() {
    if (!can("catalogue", "addDetailed")) return;
    $("modal-title").textContent = "Add detailed asset";
    $("asset-form").reset();
    $("asset-id").value = "";
    Object.values(FORM_IDS).forEach(id => { $(id).disabled = false; $(id).closest(".field").classList.remove("hidden"); });
    $("form-qty").closest(".field").classList.add("hidden");
    $("form-condition").value = "Available";
    $("form-year").innerHTML = yearOptions("");
    $("asset-perm-note").classList.add("hidden");
    assetErr("");
    $("asset-modal").classList.remove("hidden");
    focusSoon($("form-category"), 40);
}

function editAsset(id) {
    const it = assetById(id);
    if (!it || !canEditAny() || !canEditRow(it)) return;
    $("modal-title").textContent = `Edit ${isGeneral(it) ? "general" : ""} asset · ${assetLabel(it)}`;
    $("asset-id").value = it.id;
    $("form-year").innerHTML = yearOptions(dv(it.yearOfPurchase));
    let locked = 0;
    Object.entries(FORM_IDS).forEach(([field, elId]) => {
        const el = $(elId);
        el.value = field === "condition" ? (it.condition || "Available") : field === "qty" ? (it.qty || 1)
            : (["category", "brand", "model", "description"].includes(field) ? (it[field] || "") : dv(it[field]));
        el.disabled = !canEditCell(it, field);
        if (el.disabled) locked++;
        const hide = !canViewCol(field) || (field === "qty" && !isGeneral(it));
        el.closest(".field").classList.toggle("hidden", hide);
    });
    $("asset-perm-note").classList.toggle("hidden", !locked);
    assetErr("");
    $("asset-modal").classList.remove("hidden");
}

function closeModal() { Combo.close(); $("asset-modal").classList.add("hidden"); }

async function saveAsset(e) {
    e.preventDefault();
    const id = $("asset-id").value;
    const read = field => $(FORM_IDS[field]).value.trim();
    try {
        if (!id) {
            if (!can("catalogue", "addDetailed")) return;
            const data = Object.fromEntries(ALL_FIELD_KEYS.filter(k => k !== "qty").map(k => [k, read(k)]));
            data.category = data.category || "General";
            data.remarks = data.remarks || "-";
            data.kind = "detailed";
            if (!data.brand || !data.model) return assetErr("Brand and model name are required.");
            if (!isAdmin() && pList("editCats").length && !pList("editCats").includes(data.category))
                return assetErr(`You can only add assets in: ${pList("editCats").join(", ")}.`);
            const newId = store.newId("inventory");
            const created = { ...data, ...meta() };
            openDrawers.add(groupKeyOf(created));
            await commitOps([
                { op: "set", col: "inventory", id: newId, data: created },
                makeLog("Asset created", { id: newId, ...created }, [], `${data.category} · ${data.brand} ${data.model}`)
            ]);
            toast("New asset created");
            closeModal();
        } else {
            const it = assetById(id);
            if (!it) return;
            const patch = {};
            ALL_FIELD_KEYS.forEach(k => {
                if (!canEditCell(it, k) || !canViewCol(k)) return;
                if (k === "qty") { if (isGeneral(it)) patch.qty = Math.max(0, parseInt(read("qty"), 10) || 0); return; }
                patch[k] = read(k);
            });
            if (patch.category === "") patch.category = "General";
            // Changed to Faulty: save the other edits, then open the fault report (it sets the condition).
            const fault = patch.condition === "Faulty" && faultReportFirst(it);
            if (fault) delete patch.condition;
            if (!diffFields(it, patch).length) { closeModal(); if (fault) return openFaultFor(it); return toast("No changes to save"); }
            const ok = await updateAsset(id, patch, "Edited via asset form");
            if (ok) { openDrawers.add(groupKeyOf({ ...it, ...patch })); closeModal(); if (fault) openFaultFor(assetById(id) || it); }
        }
    } catch (err) {
        console.error(err);
        assetErr("Couldn't save: " + friendlyError(err));
    }
}

// ---------- General (bulk) asset: one record + quantity ----------
function openAddGeneralModal() {
    if (!can("catalogue", "addGeneral")) return;
    showModal({
        title: "Add general asset", size: "sm", body: `
        <form id="ga-form" class="form-stack" novalidate>
            <p class="muted small" style="margin:0">For bulk items like cables, tape or stands. They're stored as one record with a quantity - no serial or asset numbers.</p>
            <div class="form-grid">
                <div class="field"><label for="ga-name">Item name *</label><input type="text" id="ga-name" data-combo="model" autocomplete="off" placeholder="e.g. XLR 3m patch"></div>
                <div class="field"><label for="ga-cat">Category *</label><input type="text" id="ga-cat" data-combo="category" autocomplete="off" placeholder="e.g. Cables"></div>
                <div class="field span2"><label for="ga-desc">Description *</label><input type="text" id="ga-desc" placeholder="e.g. 3 m XLR male-female patch cables, black"></div>
                ${placeFields("ga", "", "", { space: "Item space *", location: "Item location *" })}
                <div class="field"><label for="ga-cond">Condition</label><select id="ga-cond">${condOptions("Available")}</select></div>
                <div class="field"><label for="ga-qty">Total count / quantity *</label><input type="number" id="ga-qty" min="1" value="1"></div>
                <div class="field span2"><label for="ga-year">Year of purchase <span class="hint">optional</span></label><select id="ga-year">${yearOptions("")}</select></div>
            </div>
            <p id="ga-error" class="error-msg hidden"></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">Add general asset</button></div>
        </form>`,
        onMount(root) {
            const v = id => root.querySelector(id).value.trim();
            root.querySelector("#ga-name").addEventListener("combo:pick", () => {
                const m = inventory.find(a => lc(a.model) === lc(v("#ga-name")));
                if (m && !v("#ga-cat")) root.querySelector("#ga-cat").value = m.category || "";
                if (m && !v("#ga-desc")) root.querySelector("#ga-desc").value = m.description || "";
            });
            root.querySelector("#ga-form").addEventListener("submit", async e => {
                e.preventDefault();
                const err = m => { const p = root.querySelector("#ga-error"); p.textContent = m; p.classList.remove("hidden"); };
                const qty = parseInt(v("#ga-qty"), 10);
                const data = {
                    kind: "general", category: v("#ga-cat"), brand: "Generic", model: v("#ga-name"), description: v("#ga-desc"),
                    qty, internalAssetNo: `${v("#ga-name")} · bulk`, assetNo: "", serialNo: "", code: "",
                    itemSpace: v("#ga-space"), itemLocation: v("#ga-loc"), condition: v("#ga-cond"), yearOfPurchase: v("#ga-year"), remarks: "-"
                };
                if (!data.model || !data.category) return err("Item name and category are required.");
                if (!data.description) return err("Add a short description so people can tell what the item is.");
                if (!data.itemSpace || !data.itemLocation) return err("Item space and location are required.");
                if (!qty || qty < 1) return err("Quantity must be at least 1.");
                if (!isAdmin() && pList("editCats").length && !pList("editCats").includes(data.category))
                    return err(`You can only add assets in: ${pList("editCats").join(", ")}.`);
                const id = store.newId("inventory");
                const created = { ...data, ...meta() };
                openDrawers.add(groupKeyOf(created));
                try {
                    await commitOps([
                        { op: "set", col: "inventory", id, data: created },
                        makeLog("General asset created", { id, ...created }, [], `${qty} × ${data.model} · ${data.itemSpace} › ${data.itemLocation}`)
                    ]);
                    closeDynModal();
                    toast(`Added ${qty} × ${data.model}`);
                } catch (er) { err(friendlyError(er)); }
            });
        }
    });
}

async function deleteAsset(id) {
    if (!can("catalogue", "delete")) return;
    const it = assetById(id);
    if (!it) return;
    const ok = await uiConfirm({ title: `Delete ${assetLabel(it)}?`, danger: true, confirmText: "Delete asset",
        message: `${it.brand} ${it.model}${isGeneral(it) ? ` · ${it.qty} pcs` : ` · S/N ${dv(it.serialNo) || "-"}`}\n\nThis can't be undone. The Sheets backup keeps a copy marked as deleted.` });
    if (!ok) return;
    try {
        await commitOps([
            { op: "delete", col: "inventory", id },
            makeLog("Asset deleted", it, [], `${it.category} · ${it.brand} ${it.model}${isGeneral(it) ? ` · ${it.qty} pcs` : ` · S/N ${dv(it.serialNo) || "-"}`}`)
        ]);
        toast("Asset deleted");
    } catch (err) { toast(friendlyError(err), "err"); }
}

function autoSuggestInternalNo() {
    if ($("asset-id").value) return;
    const model = $("form-model").value.trim();
    if (!model) { $("form-internal-no").value = ""; return; }
    let max = 0;
    inventory.filter(it => lc(it.model) === model.toLowerCase()).forEach(it => {
        const m = String(it.internalAssetNo || "").match(/#(\d+)/);
        if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    $("form-internal-no").value = `${model} #${max + 1}`;
}
$("form-model").addEventListener("input", autoSuggestInternalNo);
// picking a known model fills brand / category / description when they're still empty
$("form-model").addEventListener("combo:pick", () => {
    if ($("asset-id").value) return;
    const m = inventory.find(a => lc(a.model) === lc($("form-model").value.trim()));
    if (!m) return;
    [["form-brand", "brand"], ["form-category", "category"], ["form-description", "description"]].forEach(([id, k]) => { if (!$(id).value.trim()) $(id).value = m[k] || ""; });
});

// =====================================================================
// CSV: export, import
// =====================================================================
const CSV_HEADERS = ["Type", "Category", "Brand", "Model", "Description", "Code", "Serial No.", "Asset No.", "Internal Asset No.", "Quantity", "Item Space", "Item Location", "Condition", "Year of Purchase", "Remarks"];
const CSV_FIELDS = ["kind", "category", "brand", "model", "description", "code", "serialNo", "assetNo", "internalAssetNo", "qty", "itemSpace", "itemLocation", "condition", "yearOfPurchase", "remarks"];
const HEADER_ALIASES = {
    type: "kind", kind: "kind", category: "category", brand: "brand", model: "model", modelname: "model", description: "description",
    code: "code", aev: "code", codeaev: "code", serialno: "serialNo", serial: "serialNo", assetno: "assetNo",
    internalassetno: "internalAssetNo", quantity: "qty", qty: "qty", totalqty: "qty", itemspace: "itemSpace", itemlocation: "itemLocation",
    condition: "condition", yearofpurchase: "yearOfPurchase", year: "yearOfPurchase", purchaseyear: "yearOfPurchase", remarks: "remarks"
};
const csvCell = v => `"${String(v === undefined || v === null ? "" : v).replace(/"/g, '""')}"`;
const csvBlob = text => new Blob(["﻿" + text], { type: "text/csv;charset=utf-8;" });

function exportDataCSV() {
    if (!can("catalogue", "export")) return;
    if (!inventory.length) return toast("No data to export");
    const idx = CSV_FIELDS.map((f, i) => (f === "kind" || canViewCol(f)) ? i : -1).filter(i => i >= 0);
    const head = idx.map(i => csvCell(CSV_HEADERS[i])).join(",");
    const rows = getFiltered().map(it => idx.map(i => {
        const f = CSV_FIELDS[i];
        if (f === "kind") return csvCell(isGeneral(it) ? "General" : "Detailed");
        if (f === "qty") return csvCell(units(it));
        return csvCell(f === "condition" ? (it.condition || "Available") : dv(it[f]));
    }).join(","));
    saveFile(`Inventory_Export_${today()}.csv`, csvBlob([head, ...rows].join("\n")));
    toast(`Exported ${rows.length} rows (current filters)`);
}

function parseCSV(text) {
    text = String(text).replace(/^﻿/, "");
    const rows = [];
    let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQ) {
            if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
            else field += c;
        } else if (c === '"') inQ = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") i++;
            row.push(field); field = ""; rows.push(row); row = [];
        } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ""));
}

function csvRowsToItems(rows) {
    const header = rows[0].map(h => HEADER_ALIASES[String(h).toLowerCase().replace(/[^a-z]/g, "")] || null);
    const fields = header.filter(Boolean).length >= 3 ? header : CSV_FIELDS;
    const items = [];
    let skipped = 0, fixedCondition = 0;
    rows.slice(1).forEach(cols => {
        const rec = {};
        fields.forEach((f, i) => { if (f) rec[f] = (cols[i] || "").trim(); });
        if (!rec.model && !rec.brand) { skipped++; return; }
        // Any condition on the list (built-in or added by an Admin), by name or short label; unknown ones become To Check.
        const want = lc(rec.condition).trim();
        let cond = conditionList.find(c => lc(c.name) === want) || conditionList.find(c => lc(c.short) === want);
        cond = cond && cond.name;
        if (!cond) { cond = rec.condition ? "To Check" : "Available"; if (rec.condition) fixedCondition++; }
        const qty = parseInt(rec.qty, 10);
        const general = /^gen/i.test(rec.kind || "") || (qty > 1 && !rec.serialNo && !rec.assetNo);
        const year = /^\d{4}$/.test(rec.yearOfPurchase || "") ? rec.yearOfPurchase : "";
        items.push({
            kind: general ? "general" : "detailed",
            category: rec.category || "Unassigned", brand: rec.brand || (general ? "Generic" : ""), model: rec.model || "Unassigned Model",
            description: rec.description || "", code: rec.code || "", serialNo: rec.serialNo || "", assetNo: rec.assetNo || "",
            internalAssetNo: rec.internalAssetNo || (general ? `${rec.model} · bulk` : ""), itemSpace: rec.itemSpace || "", itemLocation: rec.itemLocation || "",
            condition: cond, yearOfPurchase: year, remarks: rec.remarks || "-", ...(general ? { qty: qty > 0 ? qty : 1 } : {})
        });
    });
    return { items, skipped, fixedCondition };
}

const importErr = m => { $("import-error").textContent = m || ""; $("import-error").classList.toggle("hidden", !m); };
function openImportModal() {
    if (!can("catalogue", "import") || !can("catalogue", "addDetailed")) return;
    $("csv-file-input").value = "";
    $("file-input-label").textContent = "Click to choose a CSV file";
    document.querySelector('input[name="importMode"][value="append"]').checked = true;
    document.querySelector('input[name="importMode"][value="replace"]').disabled = !isAdmin();
    importErr(""); importProgress("");
    $("import-modal").classList.remove("hidden");
}
function closeImportModal(force) { if (importRunning && !force) return; $("import-modal").classList.add("hidden"); }
function handleFileSelect(e) { const f = e.target.files[0]; if (f) $("file-input-label").textContent = f.name; }

// Each imported row gets an id made from its content (and how many identical rows came before it in the file),
// so importing the same file again overwrites those assets instead of adding duplicates. That makes a stopped
// import safe to finish: just import the same file again.
function importRowId(r, nth) {
    const key = ["kind", "category", "brand", "model", "description", "code", "serialNo", "assetNo", "internalAssetNo", "itemSpace", "itemLocation", "condition", "yearOfPurchase", "remarks", "qty"]
        .map(k => String(r[k] === undefined ? "" : r[k]).trim().toLowerCase()).join("\u0001");
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < key.length; i++) {
        const c = key.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
    }
    return `imp-${h1.toString(36)}${h2.toString(36)}-${nth}`;
}
function importIds(items) {
    const seen = new Map();
    return items.map(r => {
        const base = importRowId(r, 0);
        const n = seen.get(base) || 0;
        seen.set(base, n + 1);
        return n ? importRowId(r, n) : base;
    });
}

let importRunning = false;
const importProgress = m => { const p = $("import-progress"); p.textContent = m || ""; p.classList.toggle("hidden", !m); };
function setImportBusy(on) {
    importRunning = on;
    $("import-go").disabled = on;
    $("import-go").textContent = on ? "Importing…" : "Import";
    $("import-cancel").disabled = on;
    document.querySelectorAll('#import-modal input, #import-modal .icon-btn').forEach(el => { el.disabled = on; });
    if (!on) document.querySelector('input[name="importMode"][value="replace"]').disabled = !isAdmin();
}
// Leaving or reloading the page stops an import part-way: ask first.
window.addEventListener("beforeunload", e => { if (importRunning) { e.preventDefault(); e.returnValue = ""; } });

async function parseCSVAndImport() {
    if (importRunning) return;                 // a second click while saving would run the import twice
    if (!can("catalogue", "import") || !can("catalogue", "addDetailed")) return;
    const file = $("csv-file-input").files[0];
    if (!file) return importErr("Choose a CSV file first.");
    const replace = document.querySelector('input[name="importMode"]:checked').value === "replace";
    if (replace && !isAdmin()) return importErr("Only an Admin can replace the whole database.");
    setImportBusy(true);
    importErr(""); importProgress("Reading the file…");
    try {
        let text;
        try { text = await file.text(); } catch (err) { return importErr("Couldn't read that file."); }
        const rows = parseCSV(text);
        if (rows.length < 2) return importErr("The CSV is empty or has no data rows.");
        const { items, skipped, fixedCondition } = csvRowsToItems(rows);
        if (!items.length) return importErr("No valid rows found (each row needs at least a brand or model).");
        if (items.some(isGeneral) && !can("catalogue", "addGeneral")) return importErr("This file has general (bulk) rows, and you can't add general assets.");
        if (!isAdmin() && pList("editCats").length) {
            const bad = items.filter(i => !pList("editCats").includes(i.category));
            if (bad.length) return importErr(`${bad.length} row(s) are in categories you can't add to (e.g. "${bad[0].category}").`);
        }
        const ids = importIds(items);
        const idSet = new Set(ids);
        const already = inventory.filter(a => idSet.has(a.id)).length;
        const gone = replace ? inventory.filter(a => !idSet.has(a.id)) : [];
        importProgress("");
        if (replace && !(await uiConfirm({ title: "Replace all inventory?", danger: true, confirmText: "Replace",
            message: `This removes ${plural(gone.length, "asset")} that ${gone.length === 1 ? "isn't" : "aren't"} in this file and saves its ${items.length} rows${already ? ` (${already} are already in from an earlier import of this file and are just overwritten)` : ""}.\nIf it stops part-way, run the same Replace again: it finishes the job without duplicates.` }))) return;
        if (!replace && already && !(await uiConfirm({ title: "Some rows are already in", confirmText: "Import",
            message: `${already} of the ${items.length} rows were imported from this file before. They'll be overwritten with the file's values, not added twice. ${items.length - already} new rows will be added.` }))) return;

        const stamp = meta();
        const ops = items.map((r, i) => ({ op: "set", col: "inventory", id: ids[i], data: { ...r, ...stamp } }));
        gone.forEach(it => ops.push({ op: "delete", col: "inventory", id: it.id }));
        ops.push(makeLog(replace ? "Inventory replaced (import)" : "Assets imported", { label: file.name }, [],
            `${items.length} rows from ${file.name}${replace ? `, ${gone.length} old assets removed` : ""}`));
        const total = ops.filter(o => o.col === "inventory").length;
        importProgress(`Saving 0 of ${total.toLocaleString()}… Keep this page open.`);
        await commitOps(ops, { onProgress: (done, all) => importProgress(`Saving ${done.toLocaleString()} of ${all.toLocaleString()}… Keep this page open.`) });
        importProgress("");
        closeImportModal(true);
        let msg = `Imported ${items.length} rows`;
        if (replace && gone.length) msg += `, removed ${gone.length} old`;
        if (skipped) msg += `, skipped ${skipped} blank`;
        if (fixedCondition) msg += `, ${fixedCondition} unknown condition(s) set to To Check`;
        toast(msg);
    } catch (err) {
        console.error(err);
        const p = $("import-progress").textContent.match(/Saving ([\d,]+) of ([\d,]+)/);
        importProgress("");
        importErr(`Import stopped${p ? ` after ${p[1]} of ${p[2]}` : ""}: ${friendlyError(err)} Nothing is duplicated if you import the same file again, so run it again to finish.`);
    } finally {
        setImportBusy(false);
    }
}
