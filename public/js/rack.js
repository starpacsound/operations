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
// v5.17: a round covers either one venue (Item Space) or one item: a category, or a single model inside it, wherever it is stored.
const inItemScope = (a, cat, model) => a.category === cat && (!model || subKeyOf(a) === model) && !RETIRED.includes(a.condition);
const roundScope = r => !r ? [] : r.scopeType === "item" ? inventory.filter(a => inItemScope(a, r.category, r.model)) : inventory.filter(a => inVenue(a, r.venue));
const itemRoundLabel = (cat, model) => `Item · ${cat}${model ? ` › ${model}` : ""}`;

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
    if (!isCheck) buildDrawerPos();
    const cols = visibleColumns(["internalAssetNo", "qty", "serialNo", "designation", "drawer", "condition", "yearOfPurchase", "remarks"], hasGeneral);
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
        const posCell = isCheck ? "" : selCell(a) + posCellHtml(a);
        return `<tr class="${done && isCheck ? "is-checked" : ""}">${posCell}${checkCell}${cells.join("")}${by}${assetActions(a, extra)}</tr>`;
    };
    const headRow = `<tr>${isCheck ? `<th class="leaf-check">✓</th>` : `${canDrawer() ? '<th class="leaf-sel"></th>' : ""}<th class="leaf-pos" title="Position in the rack: 1 is the top">Pos</th>`}${cols.map((c, i) => (i === nameCol ? `<th>Model</th>` : "") + `<th>${esc(c.label)}</th>`).join("")}${nameCol === cols.length ? "<th>Model</th>" : ""}${isCheck ? "<th>Checked</th>" : ""}<th></th></tr>`;

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
        ${lOpen && !isCheck && rackPicture.has(lKey) ? `<div class="rack-loc-body">${viewBarHtml(lKey, true)}${rackPicHtml(space, loc, locItems)}</div>`
        : lOpen ? `<div class="rack-loc-body">${isCheck ? "" : viewBarHtml(lKey, false)}${sortKeys(cats).map(cat => {
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
// ---------- v5.18: rack positions (1 = top). List is the default view; "Rack picture" shows the order like the real rack. ----------
// v5.19: assets with the same Drawer name (in the same location) are one block in the rack: the block has one position, all its items share it.
const rackPicture = new Set();   // location keys shown as a picture
const drawerOpen = new Set();    // "space|loc|drawer" blocks opened in the picture
const rackSel = new Set();       // asset ids ticked in the list (for "Move to drawer")
const fineMouse = () => !!(window.matchMedia && matchMedia("(pointer: fine)").matches);
const locOf = a => [dv(a.itemSpace) || UNASSIGNED, dv(a.itemLocation) || UNASSIGNED];
const rackPosOf = a => { const n = Number(a.rackPos); return n > 0 ? n : 0; };
const drawerOf = a => dv(a.drawer).trim();
const entKey = a => drawerOf(a) ? "D:" + lc(drawerOf(a)) : "A:" + a.id;
const byLabel = (x, y) => byNum(assetLabel(x), assetLabel(y));
// Every non-retired asset of one location, as entities: a lone asset, or a drawer with its items.
function entitiesFor(space, loc) {
    const m = new Map();
    inventory.forEach(a => {
        if (RETIRED.includes(a.condition)) return;
        const [s, l] = locOf(a);
        if (s !== space || l !== loc) return;
        const k = entKey(a);
        let e = m.get(k);
        if (!e) { e = { key: k, name: drawerOf(a), items: [] }; m.set(k, e); }
        e.items.push(a);
    });
    m.forEach(e => {
        const ps = e.items.map(rackPosOf).filter(Boolean);
        e.pos = ps.length ? Math.min(...ps) : 0;
        e.items.sort(byLabel);
        e.label = e.name || assetLabel(e.items[0]);
    });
    return [...m.values()];
}
const placedEnts = (space, loc) => entitiesFor(space, loc).filter(e => e.pos > 0).sort((x, y) => x.pos - y.pos || byNum(x.label, y.label));
const unplacedEnts = (space, loc) => entitiesFor(space, loc).filter(e => !e.pos).sort((x, y) => byNum(x.label, y.label));
// Position shown in the list: a drawer's items all show the drawer's position.
let drawerPos = new Map();
function buildDrawerPos() {
    drawerPos = new Map();
    inventory.forEach(a => {
        const n = rackPosOf(a);
        if (!n || !drawerOf(a)) return;
        const k = locOf(a).join("|") + "|" + lc(drawerOf(a));
        if (!drawerPos.has(k) || n < drawerPos.get(k)) drawerPos.set(k, n);
    });
}
const shownPos = a => drawerOf(a) ? (drawerPos.get(locOf(a).join("|") + "|" + lc(drawerOf(a))) || 0) : rackPosOf(a);

function posCellHtml(a) {
    const n = shownPos(a);
    if (arrangeOn()) return `<td class="leaf-pos"><input type="number" class="rack-pos-in" min="0" max="999" inputmode="numeric" value="${n || ""}" placeholder="-" data-rack-pos="${esc(a.id)}" aria-label="Rack position of ${esc(assetLabel(a))}"></td>`;
    return `<td class="leaf-pos">${n || '<span class="muted">-</span>'}</td>`;
}
const canDrawer = () => editMode && canEditCol("drawer");
const selCell = a => canDrawer() ? `<td class="leaf-sel"><input type="checkbox" class="rack-sel" data-rack-sel="${esc(a.id)}" ${rackSel.has(a.id) ? "checked" : ""} aria-label="Select ${esc(assetLabel(a))}"></td>` : "";
function selBarHtml() {
    const n = rackSel.size;
    return `<span class="rack-selbar ${n && canDrawer() ? "" : "hidden"}"><b>${n}</b> selected
        <button type="button" class="btn btn-sm btn-primary" data-rackact="todrawer">Move to drawer…</button>
        <button type="button" class="btn btn-sm" data-rackact="outdrawer">Take out of drawer</button>
        <button type="button" class="btn btn-sm btn-ghost" data-rackact="selclear">Clear</button></span>`;
}
function refreshSelBars() {
    document.querySelectorAll(".rack-selbar").forEach(el => { el.outerHTML = selBarHtml(); });
}
function viewBarHtml(lKey, pic) {
    return `<div class="rack-viewbar"><span class="muted small">View</span>
        <span class="seg"><button type="button" class="${pic ? "" : "on"}" data-rackview="list" data-lkey="${esc(lKey)}">List</button><button type="button" class="${pic ? "on" : ""}" data-rackview="pic" data-lkey="${esc(lKey)}">Rack picture</button></span>
        ${pic && !arrangeOn() ? `<span class="muted small">Front view. Turn on Edit mode to change the order.</span>` : ""}${pic ? "" : selBarHtml()}</div>`;
}
function rackPicHtml(space, loc, shown) {
    const ids = new Set(shown.map(a => a.id));
    const seen = e => e.items.some(a => ids.has(a.id));
    const placed = placedEnts(space, loc).filter(seen), unplaced = unplacedEnts(space, loc).filter(seen);
    const arr = arrangeOn(), drag = arr && fineMouse();
    const pill = a => `<span class="pill ${condClass(a.condition)}">${esc(COND_SHORT[a.condition] || a.condition)}</span>`;
    const itemLine = a => `<div class="u-item"><b>${esc(assetLabel(a))}</b> <span class="u-model">${esc(subKeyOf(a))}</span>${dv(a.designation) ? ` <span class="u-des">${esc(dv(a.designation))}</span>` : ""}${dv(a.description) ? ` <span class="u-desc">${esc(dv(a.description))}</span>` : ""} ${pill(a)}</div>`;
    const mainOf = e => {
        if (!e.name) {
            const a = e.items[0], desc = dv(a.description);
            return `<b>${esc(assetLabel(a))}</b> <span class="u-model">${esc(subKeyOf(a))}</span>${dv(a.designation) ? ` <span class="u-des">${esc(dv(a.designation))}</span>` : ""}${desc ? ` <span class="u-desc">${esc(desc)}</span>` : ""}`;
        }
        const ok = [space, loc, lc(e.name)].join("|"), open = drawerOpen.has(ok);
        return `<button type="button" class="u-drawer-btn" data-drawer-toggle="${esc(ok)}" aria-expanded="${open}"><span class="chev ${open ? "open" : ""}">▶</span> <b>${esc(e.name)}</b> <span class="u-model">${plural(e.items.length, "item")}</span></button> <span class="u-tag u-tag-d">Drawer</span>`;
    };
    const condOf = e => e.name ? [...new Set(e.items.map(a => a.condition))].map(c => `<span class="pill ${condClass(c)}">${esc(COND_SHORT[c] || c)}</span>`).join("") : pill(e.items[0]);
    const row = (e, i) => {
        const tag = i === 0 ? "Top" : i === placed.length - 1 && placed.length > 1 ? "Bottom" : "";
        const open = e.name && drawerOpen.has([space, loc, lc(e.name)].join("|"));
        return `<div class="rack-u ${e.name ? "is-drawer" : ""}" data-ek="${esc(e.key)}" ${drag ? 'draggable="true"' : ""}>
            <span class="u-pos">${e.pos}</span>
            <span class="u-main">${mainOf(e)}${tag ? ` <span class="u-tag">${tag}</span>` : ""}</span>
            ${condOf(e)}
            ${arr ? `<span class="u-acts">
                <button type="button" class="btn btn-sm" data-rackact="up" data-ek="${esc(e.key)}" ${i === 0 ? "disabled" : ""} aria-label="Move up" title="Move up">▲</button>
                <button type="button" class="btn btn-sm" data-rackact="down" data-ek="${esc(e.key)}" ${i === placed.length - 1 ? "disabled" : ""} aria-label="Move down" title="Move down">▼</button>
                <button type="button" class="btn btn-sm" data-rackact="below" data-ek="${esc(e.key)}" title="Place another asset or drawer below this one">+ Below</button>
                <button type="button" class="btn btn-sm" data-rackact="remove" data-ek="${esc(e.key)}" aria-label="Take out of the rack picture" title="Take out (back to Unplaced)">✕</button></span>` : ""}
            ${open ? `<div class="u-items">${e.items.map(itemLine).join("")}</div>` : ""}
        </div>`;
    };
    const urow = e => `<div class="rack-u is-un ${e.name ? "is-drawer" : ""}" data-ek="${esc(e.key)}" ${drag ? 'draggable="true"' : ""}>
            <span class="u-pos">-</span><span class="u-main">${mainOf(e)}</span>${condOf(e)}
            ${arr ? `<span class="u-acts"><button type="button" class="btn btn-sm btn-primary" data-rackact="place" data-ek="${esc(e.key)}">Place…</button></span>` : ""}
            ${e.name && drawerOpen.has([space, loc, lc(e.name)].join("|")) ? `<div class="u-items">${e.items.map(itemLine).join("")}</div>` : ""}</div>`;
    return `<div class="rack-pic" data-space="${esc(space)}" data-loc="${esc(loc)}">
        <div class="rack-frame">${placed.length ? placed.map(row).join("") : `<div class="empty-state">Nothing placed yet.${arr ? " Use Place… on an asset below, or Number in order." : ""}</div>`}</div>
        ${unplaced.length ? `<div class="rack-unplaced" data-drop-remove="1"><div class="rack-un-head"><b>Unplaced</b> <span class="muted small">(${unplaced.length})${drag ? " - drag one into the rack above, or drop a rack row here to take it out" : ""}</span>
            ${arr ? `<button type="button" class="btn btn-sm" data-rackact="number" title="Give every unplaced asset or drawer the next numbers, in name order">Number in order</button>` : ""}</div>
            ${unplaced.map(urow).join("")}</div>` : ""}
    </div>`;
}
// Write the final order of one location: only assets whose number changed are saved. Not logged (it is layout, not a stock change).
// A drawer's items all get the drawer's number.
async function applyRackOrder(order, removed) {
    const ops = [], set = (a, n) => { if (rackPosOf(a) !== n) ops.push({ op: "update", col: "inventory", id: a.id, data: { rackPos: n, ...meta() } }); };
    order.forEach((e, i) => e.items.forEach(a => set(a, i + 1)));
    (removed || []).forEach(e => e.items.forEach(a => set(a, 0)));
    if (!ops.length) return;
    try { await commitOps(ops); } catch (er) { toast(friendlyError(er), "error"); }
}
function rackMoveEnt(space, loc, key, toIndex) { // toIndex: 0-based place in the rack, or -1 to take out
    const all = entitiesFor(space, loc), e = all.find(x => x.key === key);
    if (!e) return;
    const order = all.filter(x => x.pos > 0 && x.key !== key).sort((x, y) => x.pos - y.pos || byNum(x.label, y.label));
    if (toIndex < 0) return applyRackOrder(order, [e]);
    order.splice(Math.min(toIndex, order.length), 0, e);
    return applyRackOrder(order);
}
function openPlaceModal(space, loc, ekey, afterKey) {
    const placed = placedEnts(space, loc), un = unplacedEnts(space, loc);
    if (!un.length) return toast("Everything here is already placed.");
    const lab = e => e.name ? `${e.name} (drawer, ${plural(e.items.length, "item")})` : `${assetLabel(e.items[0])} · ${subKeyOf(e.items[0])}`;
    const posOpts = [`<option value="0">At the top</option>`].concat(placed.map((e, i) => `<option value="${i + 1}" ${e.key === afterKey ? "selected" : ""}>After ${e.pos} · ${esc(e.label)}</option>`));
    showModal({ title: "Place in rack", size: "sm", body: `
        <form id="pl-form" class="form-stack" novalidate>
            <div class="field"><label for="pl-asset">Asset or drawer</label><select id="pl-asset">${un.map(e => `<option value="${esc(e.key)}" ${e.key === ekey ? "selected" : ""}>${esc(lab(e))}</option>`).join("")}</select></div>
            <div class="field"><label for="pl-pos">Position</label><select id="pl-pos">${posOpts.join("")}</select></div>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">Place</button></div>
        </form>`,
        onMount(root) {
            const pos = root.querySelector("#pl-pos");
            if (!afterKey) pos.value = String(placed.length);   // default: bottom
            root.querySelector("#pl-form").addEventListener("submit", e => {
                e.preventDefault();
                const key = root.querySelector("#pl-asset").value, idx = Number(pos.value);
                closeDynModal();
                rackMoveEnt(space, loc, key, idx);   // "after N" means index N (0 = top)
            });
        } });
}
// Move the ticked assets into a drawer (or out of it). A normal edit of the Drawer field, so it needs the right to edit that column.
function openDrawerModal() {
    const picked = inventory.filter(a => rackSel.has(a.id));
    if (!picked.length) return;
    const names = [...new Set(inventory.filter(a => picked.some(p => locOf(p).join("|") === locOf(a).join("|")) && drawerOf(a)).map(drawerOf))].sort(byNum);
    showModal({ title: `Move ${plural(picked.length, "item")} to a drawer`, size: "sm", body: `
        <form id="dr-form" class="form-stack" novalidate>
            <div class="field"><label for="dr-name">Drawer name</label><input type="text" id="dr-name" list="dr-names" maxlength="60" autocomplete="off" placeholder="e.g. Drawer 1">
                <datalist id="dr-names">${names.map(n => `<option value="${esc(n)}">`).join("")}</datalist></div>
            <p class="muted small">Items with the same drawer name (in the same rack) show as one drawer in the rack picture.</p>
            <p id="dr-error" class="error-msg hidden"></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">Move</button></div>
        </form>`,
        onMount(root) {
            root.querySelector("#dr-form").addEventListener("submit", e => {
                e.preventDefault();
                const name = root.querySelector("#dr-name").value.trim();
                if (!name) { const er = root.querySelector("#dr-error"); er.textContent = "Type a drawer name."; er.classList.remove("hidden"); return; }
                closeDynModal(); setDrawer(picked, name);
            });
        } });
}
async function setDrawer(list, name) {
    const ops = list.filter(a => drawerOf(a) !== name).map(a => ({ op: "update", col: "inventory", id: a.id, data: { drawer: name, ...meta() } }));
    if (!ops.length) return;
    try { await commitOps(ops); rackSel.clear(); toast(name ? `${plural(ops.length, "item")} moved to ${name}` : `${plural(ops.length, "item")} taken out of their drawer`); renderRack(); }
    catch (er) { toast(friendlyError(er), "error"); }
}
document.addEventListener("click", e => {
    const v = e.target.closest("[data-rackview]");
    if (v) {
        v.dataset.rackview === "pic" ? rackPicture.add(v.dataset.lkey) : rackPicture.delete(v.dataset.lkey);
        redrawLoc("rack", v);
        return;
    }
    const dt = e.target.closest("[data-drawer-toggle]");
    if (dt) { const k = dt.dataset.drawerToggle; drawerOpen.has(k) ? drawerOpen.delete(k) : drawerOpen.add(k); redrawLoc("rack", dt); return; }
    const b = e.target.closest("[data-rackact]");
    if (!b || !arrangeOn()) return;
    const act = b.dataset.rackact, pic = b.closest(".rack-pic"), space = pic && pic.dataset.space, loc = pic && pic.dataset.loc, ek = b.dataset.ek;
    if (act === "todrawer") return openDrawerModal();
    if (act === "outdrawer") return setDrawer(inventory.filter(a => rackSel.has(a.id)), "");
    if (act === "selclear") { rackSel.clear(); document.querySelectorAll(".rack-sel").forEach(c => { c.checked = false; }); return refreshSelBars(); }
    if (!pic) return;
    if (act === "number") { applyRackOrder([...placedEnts(space, loc), ...unplacedEnts(space, loc)]); return; }
    const idx = placedEnts(space, loc).findIndex(x => x.key === ek);
    if (act === "up" && idx > 0) rackMoveEnt(space, loc, ek, idx - 1);
    else if (act === "down") rackMoveEnt(space, loc, ek, idx + 1);
    else if (act === "remove") rackMoveEnt(space, loc, ek, -1);
    else if (act === "place") openPlaceModal(space, loc, ek, null);
    else if (act === "below") openPlaceModal(space, loc, null, ek);
});
// Typing a number in the Pos column moves the asset (or its drawer) there; blank / 0 takes it out. Ticking a row selects it.
document.addEventListener("change", e => {
    const sel = e.target.closest && e.target.closest("[data-rack-sel]");
    if (sel) { sel.checked ? rackSel.add(sel.dataset.rackSel) : rackSel.delete(sel.dataset.rackSel); refreshSelBars(); return; }
    const i = e.target.closest && e.target.closest("[data-rack-pos]");
    if (!i || !arrangeOn()) return;
    const a = inventory.find(x => x.id === i.dataset.rackPos);
    if (!a) return;
    const n = parseInt(i.value, 10), [space, loc] = locOf(a);
    rackMoveEnt(space, loc, entKey(a), n > 0 ? n - 1 : -1);
});
// Drag and drop (laptop / mouse only): drop on a rack row to insert before or after it; drop on Unplaced to take out.
let dragEk = null, dragPic = null;
const dropSide = (el, ev) => { const r = el.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2 ? "before" : "after"; };
const clearOver = () => document.querySelectorAll(".rack-u.over-before,.rack-u.over-after,.rack-unplaced.over").forEach(x => x.classList.remove("over-before", "over-after", "over"));
document.addEventListener("dragstart", e => { const r = e.target.closest && e.target.closest(".rack-u[draggable]"); if (!r || !arrangeOn()) return; dragEk = r.dataset.ek; dragPic = r.closest(".rack-pic"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", dragEk); } catch (_) {} });
document.addEventListener("dragend", () => { dragEk = null; dragPic = null; clearOver(); });
document.addEventListener("dragover", e => {
    if (!dragEk) return;
    const row = e.target.closest(".rack-u:not(.is-un)"), zone = e.target.closest(".rack-unplaced");
    if ((!row && !zone) || (row || zone).closest(".rack-pic") !== dragPic) return;
    e.preventDefault(); clearOver();
    if (row) row.classList.add("over-" + dropSide(row, e)); else zone.classList.add("over");
});
document.addEventListener("drop", e => {
    if (!dragEk) return;
    const row = e.target.closest(".rack-u:not(.is-un)"), zone = e.target.closest(".rack-unplaced");
    if (!(row || zone)) return;
    const pic = (row || zone).closest(".rack-pic");
    if (pic !== dragPic) { dragEk = null; clearOver(); return toast("That one is stored in a different location."); }
    e.preventDefault();
    const key = dragEk, side = row ? dropSide(row, e) : "", space = pic.dataset.space, loc = pic.dataset.loc;
    dragEk = null; dragPic = null; clearOver();
    if (zone && !row) return rackMoveEnt(space, loc, key, -1);
    if (row.dataset.ek === key) return;
    const order = placedEnts(space, loc).filter(x => x.key !== key);
    const ti = order.findIndex(x => x.key === row.dataset.ek);
    rackMoveEnt(space, loc, key, side === "before" ? ti : ti + 1);
});

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
        el.innerHTML = `<div class="empty-state">No check round is running.${can("check", "rounds") ? ` Use <b>Start new round</b> and pick a venue or an item to check.` : " Ask an Admin / Co-Admin to start one for your venue."}</div>`;
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
        <div class="stat"><span>${r.scopeType === "item" ? "Item" : "Venue"}</span><span class="round-name">${esc(r.venue)} · ${esc(r.name)}</span>
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
    const cats = uniq(inventory.filter(a => !RETIRED.includes(a.condition)).map(a => a.category).filter(Boolean)).sort((x, y) => byNum(x, y));
    const itemCount = (c, m) => inventory.filter(a => inItemScope(a, c, m)).length;
    const month = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });
    showModal({
        title: "Start a new check round", size: "sm", body: `
        <form id="nr-form" class="form-stack" novalidate>
            <div class="field"><label>Check by</label>
                <label class="radio-row"><input type="radio" name="nr-by" value="venue" checked> A venue (Item Space) - everything stored there</label>
                <label class="radio-row"><input type="radio" name="nr-by" value="item"> An item - a category or one model, wherever it is stored</label></div>
            <div class="field nr-item hidden"><label for="nr-cat">Category *</label>
                <select id="nr-cat"><option value="">Choose a category…</option>${cats.map(c => `<option value="${esc(c)}">${esc(c)} - ${plural(itemCount(c, ""), "record")}</option>`).join("")}</select></div>
            <div class="field nr-item hidden"><label for="nr-model">Model <span class="hint">optional - leave on All to check the whole category</span></label>
                <select id="nr-model"><option value="">All models</option></select></div>
            <div class="field nr-venue"><label for="nr-venue">Venue (Item Space) *</label>
                <select id="nr-venue"><option value="">Choose a venue…</option>${spaces.map(s => `<option value="${esc(s)}">${esc(s)} - ${plural(count(s), "record")}${openBy.has(s) ? " (round open)" : ""}</option>`).join("")}</select></div>
            <div class="field"><label for="nr-name">Round name *</label><input type="text" id="nr-name" value="${esc(month)} stock take"></div>
            <p class="muted small" id="nr-note" style="margin:0">Only assets in this venue are counted. Other venues can run their own rounds at the same time.</p>
            <p id="nr-error" class="error-msg hidden"></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">Start round</button></div>
        </form>`,
        onMount(root) {
            const venue = root.querySelector("#nr-venue"), cat = root.querySelector("#nr-cat"), model = root.querySelector("#nr-model");
            const byItem = () => root.querySelector("input[name=nr-by]:checked").value === "item";
            const note = () => {
                if (!byItem()) { venue.dispatchEvent(new Event("change")); return; }
                const label = itemRoundLabel(cat.value || "…", model.value), r = openBy.get(label);
                root.querySelector("#nr-note").innerHTML = r ? `<b>${esc(label)}</b> already has “${esc(r.name)}” open. Starting a new round finishes that one first and saves it to History.`
                    : "Counts that item in every venue where it is stored. A venue round and an item round can run at the same time.";
            };
            root.querySelectorAll("input[name=nr-by]").forEach(i => i.addEventListener("change", () => {
                root.querySelectorAll(".nr-item").forEach(el => el.classList.toggle("hidden", !byItem()));
                root.querySelector(".nr-venue").classList.toggle("hidden", byItem());
                note();
            }));
            cat.addEventListener("change", () => {
                const models = uniq(inventory.filter(a => inItemScope(a, cat.value, "")).map(subKeyOf)).sort((x, y) => byNum(x, y));
                model.innerHTML = `<option value="">All models</option>` + models.map(m => `<option value="${esc(m)}">${esc(m)} - ${plural(itemCount(cat.value, m), "record")}</option>`).join("");
                note();
            });
            model.addEventListener("change", note);
            venue.addEventListener("change", () => {
                const r = openBy.get(venue.value);
                root.querySelector("#nr-note").innerHTML = r ? `<b>${esc(venue.value)}</b> already has “${esc(r.name)}” open. Starting a new round finishes that one first and saves it to History.`
                    : "Only assets in this venue are counted. Other venues can run their own rounds at the same time.";
            });
            root.querySelector("#nr-form").addEventListener("submit", async e => {
                e.preventDefault();
                const err = m => { const p = root.querySelector("#nr-error"); p.textContent = m; p.classList.remove("hidden"); };
                const item = byItem();
                const v = item ? (cat.value ? itemRoundLabel(cat.value, model.value) : "") : venue.value, name = root.querySelector("#nr-name").value.trim();
                if (!v) return err(item ? "Choose the category to check." : "Choose the venue to check.");
                if (!name) return err("Give the round a name.");
                const total = item ? itemCount(cat.value, model.value) : count(v);
                try {
                    const prev = openBy.get(v);
                    if (prev) await finishRound(prev, true);
                    const id = store.newId("audits");
                    await commitOps([
                        { op: "set", col: "audits", id, data: { name, venue: v, ...(item ? { scopeType: "item", category: cat.value, model: model.value } : {}), status: "open", shards: tickRecords(total), startedBy: myEmail(), startedByName: myName(), startedAt: nowIso() } },
                        makeLog("Check round started", { label: `${v} · ${name}` }, [], `${plural(total, "record")} to check`)
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
        <thead><tr><th>Round</th><th>Venue / item</th><th>Started</th><th>Finished</th><th>Verified</th><th>Not found</th><th>Discrepancies</th><th></th></tr></thead>
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
    rep.facts([[r.scopeType === "item" ? "Item" : "Venue", r.venue], ["Verified", `${s.checked} / ${s.total}`], ["Completion", `${pct}%`], ["Not found", String(s.total - s.checked)], ["Discrepancies", String(s.discrepancies || 0)],
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
