// =====================================================================
// Core: shared state, helpers, permission checks, dialogs and the write + log pipeline.
// Every module (inventory.js, rack.js, loans.js ...) builds on these globals.
// =====================================================================

// ---------- Domain constants ----------
// Asset conditions. The 9 built-in ones drive workflows (loans, repairs, checks), so their names are fixed;
// Admins can add their own in Branding › Asset conditions (settings/conditions, 1 read). See applyConditions().
const BUILTIN_CONDITIONS = [
    { name: "Available", short: "Avail", color: "ok" }, { name: "Deployed", short: "Deployed", color: "info" },
    { name: "Faulty", short: "Faulty", color: "bad" }, { name: "On Repair", short: "Repair", color: "cyan" },
    { name: "On Loan", short: "Loan", color: "warn" }, { name: "Missing", short: "Missing", color: "rose" },
    { name: "Decommissioned", short: "Decom", color: "neutral", retired: true }, { name: "To Check", short: "To Check", color: "violet" },
    { name: "Sold", short: "Sold", color: "neutral-2", retired: true }
];
// Colours offered for a condition: theme tokens, so they suit light and dark mode.
// 20 colours: the first 9 follow the light / dark theme, the rest (v5.4) are fixed mid-tones that read on both.
const COND_COLORS = { ok: "Green", info: "Blue", bad: "Red", cyan: "Teal", warn: "Amber", rose: "Pink", violet: "Purple", neutral: "Grey", "neutral-2": "Slate",
    orange: "Orange", gold: "Gold", lime: "Lime", mint: "Mint", sky: "Sky blue", indigo: "Indigo", magenta: "Magenta", coral: "Coral", maroon: "Maroon", brown: "Brown", olive: "Olive" };
const COND_HEX = { orange: "#ee8a32", gold: "#d4a40f", lime: "#7dbf3f", mint: "#2fbf9a", sky: "#3aa8e6", indigo: "#6370e0", magenta: "#cf4fbd",
    coral: "#ef6e5c", maroon: "#a8395c", brown: "#a87048", olive: "#8e9a32" };
const condColorCss = k => COND_HEX[k] || `var(--${k})`;
let conditionList = BUILTIN_CONDITIONS.map(c => ({ ...c }));
let CONDITIONS = conditionList.map(c => c.name);
let RETIRED = conditionList.filter(c => c.retired).map(c => c.name);
let COND_SHORT = Object.fromEntries(conditionList.map(c => [c.name, c.short]));
const isBuiltinCondition = name => BUILTIN_CONDITIONS.some(c => c.name === name);
const LOG_TYPES = ["General", "Preventative maintenance", "Fault", "Update", "Repair"];
const DEFAULT_CATEGORIES = ["Wired Mics", "Wireless Mics", "Speakers", "Mixing Consoles", "Cables", "Accessories"];
const LOCATION_KEYS = ["itemSpace", "itemLocation"];
const OPEN_LOAN = ["approved", "collected", "returnRequested"];

const condClass = c => "cond-" + String(c).toLowerCase().replace(/[^a-z0-9]+/g, "-");

// Use the saved condition list (settings/conditions). Built-ins keep their names and retired flag;
// only their short label and colour can change. Missing built-ins are put back.
function applyConditions(doc) {
    const saved = (doc && Array.isArray(doc.list)) ? doc.list.filter(c => c && c.name) : [];
    const list = [];
    saved.forEach(c => {
        const b = BUILTIN_CONDITIONS.find(x => x.name === c.name);
        if (list.some(x => x.name === c.name)) return;
        list.push({ name: c.name, short: String(c.short || (b && b.short) || c.name), color: COND_COLORS[c.color] ? c.color : (b ? b.color : "neutral"),
            retired: b ? !!b.retired : !!c.retired });
    });
    BUILTIN_CONDITIONS.forEach(b => { if (!list.some(x => x.name === b.name)) list.push({ ...b, retired: !!b.retired }); });
    conditionList = list;
    CONDITIONS = list.map(c => c.name);
    RETIRED = list.filter(c => c.retired).map(c => c.name);
    COND_SHORT = Object.fromEntries(list.map(c => [c.name, c.short]));
    let st = document.getElementById("cond-style");
    if (!st) { st = document.createElement("style"); st.id = "cond-style"; document.head.appendChild(st); }
    st.textContent = list.map(c => `.${condClass(c.name)} { --c: ${condColorCss(c.color)}; }`).join("\n");
}
const typeClass = t => "lt-" + String(t).toLowerCase().split(" ")[0];

// ---------- State ----------
const store = createStore();
let authUser = null;
let profile = null;
let inventory = [];
let tickets = [];
let loans = [];
let shows = [];
// v5.11: loan managers keep only open loans live; finished ones (oldLoans) and shows older than SHOWS_LIVE_DAYS (showsOld) load on request.
const LOAN_OPEN_STATUSES = ["requested", "approved", "collected", "returnRequested"];
const SHOWS_LIVE_DAYS = 60;
let liveLoans = [], oldLoans = [], oldLoansAt = 0, showsOld = [], showsOldAt = 0;
let mergeShows = () => {};
const oldKey = name => `old:${(window.APP_CONFIG && APP_CONFIG.firebase && APP_CONFIG.firebase.projectId) || "demo"}:${authUser ? authUser.uid : ""}:${name}`;
let checks = {};          // `${roundId}_${assetId}` -> tick (built from checkTicks while Inventory Check is open)
let audits = [];          // inventory-check rounds (open + history)
let discrepancies = [];
let logs = [];
let users = [];
let availMine = [];       // my availability docs (all months)
let availGrid = [];
let reminders = [];       // "please fill in your availability" requests (reminders/{id})       // everyone's docs for the month shown in the team grid
let settings = { app: null, roles: null, venues: null, conditions: null, availability: null, rosterLists: null };

// ---------- Venue colours: one fixed colour per show venue, used on every page ----------
// Stored in settings/venues.colors { venue: "#rrggbb" } so it never shifts when venues are added
// or removed. Yellow is kept for maintenance calls and red for Sundays, so they're not in here.
const VENUE_PALETTE = ["#4e9be6", "#9b6bdf", "#3fbf7f", "#e46fb0", "#2bb5b5", "#7a83f0", "#94c447", "#c98a5a", "#d65fd6", "#5b8fa8", "#e0707a", "#6fcf9f"];
const venueHash = v => { let h = 0; for (const ch of lc(v)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
function venueColorMap(extra) {   // stored colours + a free palette colour for any venue without one
    const stored = (settings.venues && settings.venues.colors) || {};
    const map = {}, used = new Set();
    Object.keys(stored).forEach(k => { if (/^#[0-9a-f]{6}$/i.test(stored[k])) { map[lc(k)] = stored[k]; used.add(stored[k].toLowerCase()); } });
    const names = [...((settings.venues && settings.venues.list) || []), ...(extra || [])];
    names.forEach(v => {
        if (!v || map[lc(v)]) return;
        const free = VENUE_PALETTE.find(c => !used.has(c));
        map[lc(v)] = free || VENUE_PALETTE[venueHash(v) % VENUE_PALETTE.length];
        used.add(map[lc(v)]);
    });
    return map;
}
// v5.4: a show can have several venues. `venues` keeps the list; `venue` keeps the combined text ("Studio 1-3, 5")
// so every page, the Sheets and older records keep working with the one string.
const venueNum = v => { const m = /^(.*\S)\s+(\d+)$/.exec(String(v).trim()); return m ? { name: m[1], n: +m[2] } : null; };
function fmtVenues(list) {
    const groups = [];                                   // [{ name, nums: [] }] or [{ plain }], in the order first picked
    uniq((list || []).map(v => String(v).trim()).filter(Boolean)).forEach(v => {
        const x = venueNum(v);
        if (!x) return groups.push({ plain: v });
        const g = groups.find(g => g.name && lc(g.name) === lc(x.name));
        if (g) g.nums.push(x.n); else groups.push({ name: x.name, nums: [x.n] });
    });
    return groups.map(g => {
        if (g.plain) return g.plain;
        const ns = uniq(g.nums).sort((a, b) => a - b), parts = [];
        for (let i = 0; i < ns.length;) {
            let k = i;
            while (k + 1 < ns.length && ns[k + 1] === ns[k] + 1) k++;
            if (k - i >= 2) parts.push(`${ns[i]}-${ns[k]}`);          // 3 or more in a row: 1-3
            else for (let n = i; n <= k; n++) parts.push(String(ns[n]));
            i = k + 1;
        }
        return `${g.name} ${parts.join(", ")}`;
    }).join(", ");
}
const jobVenueList = j => j && Array.isArray(j.venues) && j.venues.length ? j.venues : (j && j.venue ? [j.venue] : []);
// A combined text ("Studio 1-3, 5") takes the colour of its first venue ("Studio 1").
const venueBase = v => { const m = /^(.*?\S)\s+(\d+)(?:-\d+)?(?:,|$)/.exec(String(v)); return m ? `${m[1]} ${m[2]}` : String(v).split(", ")[0]; };
const venueColor = v => {
    if (!v) return "";
    const k = venueColorMap()[lc(v)] ? v : venueBase(v);
    return venueColorMap([k])[lc(k)] || VENUE_PALETTE[venueHash(k) % VENUE_PALETTE.length];
};
// colours to save alongside the list (keeps existing ones, gives new venues a free colour)
function venueColorsFor(list) {
    const map = venueColorMap(list), out = {};
    list.forEach(v => { out[v] = map[lc(v)]; });
    return out;
}
const venueTag = v => v ? `<span class="vn-tag"><i class="vn-dot" style="--vc:${venueColor(v)}"></i>${esc(v)}</span>` : "";
const venueStyle = j => j && j.kind === "show" && j.venue ? ` style="--vc:${venueColor(j.venue)}"` : "";
let invLoaded = false;
let bundlesLegacy = false;   // true until an Admin builds the inventory bundles (Branding › Inventory bundles)
let invError = false;
let editMode = false;
let currentView = "today";

// ---------- Helpers ----------
const $ = id => document.getElementById(id);
const esc = s => String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dv = v => (v === undefined || v === null || v === "-") ? "" : String(v);
const lc = v => String(v === undefined || v === null ? "" : v).toLowerCase();
const uniq = arr => Array.from(new Set(arr.filter(Boolean)));
const nowIso = () => new Date().toISOString();
const localDate = (d = new Date()) => d.toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
const today = () => localDate();
const addDays = (n, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + n); return localDate(d); };
const fmtDateTime = iso => { if (!iso) return "—"; const d = new Date(iso); return isNaN(d) ? esc(iso) : d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); };
const fmtDate = iso => { if (!iso) return "—"; const d = new Date(String(iso).length === 10 ? iso + "T00:00:00" : iso); return isNaN(d) ? esc(iso) : d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" }); };
const daysSince = iso => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0;
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
const groupKeyOf = it => `${it.category || "Unassigned"} - ${it.brand || "Generic"} - ${it.model || "Unknown Model"}`;
const assetLabel = a => dv(a.internalAssetNo) || `${dv(a.brand)} ${dv(a.model)}`.trim() || "Unnamed asset";
const equipName = a => `${dv(a.brand) === "Generic" ? "" : dv(a.brand)} ${dv(a.model)}`.trim();
const myEmail = () => (profile && profile.email) || (authUser && authUser.email) || "";
// ---------- Username logins (host) ----------
const usernameDomain = () => String((window.APP_CONFIG && window.APP_CONFIG.usernameDomain) || "showbase.local").toLowerCase();
const usernameToEmail = name => String(name).trim().toLowerCase().replace(/\s+/g, ".").replace(/[^a-z0-9._-]/g, "") + "@" + usernameDomain();
const loginToEmail = input => { const v = String(input || "").trim(); return v.includes("@") ? v.toLowerCase() : usernameToEmail(v); };
const isUsernameEmail = email => String(email || "").toLowerCase().endsWith("@" + usernameDomain());
// What to show instead of the hidden technical address of a username account.
const loginLabel = (email, name) => isUsernameEmail(email) ? `Username: ${name || String(email).split("@")[0]}` : String(email || "");
const myName = () => (profile && profile.displayName) || myEmail().split("@")[0];
const appName = () => (settings.app && settings.app.appName) || window.APP_CONFIG.appName || "Showbase";
const assetById = id => inventory.find(a => a.id === id) || null;

function toast(msg, kind) {
    let stack = $("toast-stack");
    if (!stack) { stack = document.createElement("div"); stack.id = "toast-stack"; document.body.appendChild(stack); }
    const t = document.createElement("div");
    t.className = "toast" + (kind ? " " + kind : "");
    t.setAttribute("role", "status");
    t.textContent = msg;
    stack.appendChild(t);
    while (stack.children.length > 4) stack.firstChild.remove();
    setTimeout(() => t.remove(), 3400);
}

// ---------- Free-plan limit ----------
// Firestore's free plan stops reads / saves for the rest of the day once its daily allowance is used
// (it comes back at midnight US Pacific time). Instead of failing quietly, show a banner with that time
// in Singapore time, keep what's on screen, and check every 5 minutes whether it's back.
const isQuotaError = err => !!err && (err.code === "resource-exhausted" || /quota exceeded|resource[_ -]exhausted/i.test(String(err.message || "")));
function quotaResetTime(now = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23",
        year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(now).map(x => [x.type, x.value]));
    const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(now.getTime() / 1000) * 1000;
    return new Date(Date.UTC(+p.year, +p.month - 1, +p.day + 1) - offset);   // next Pacific midnight
}
// Always shown in Singapore time (SGT), whatever time zone the device is set to.
const quotaResetText = () => quotaResetTime().toLocaleString("en-SG", { timeZone: "Asia/Singapore", weekday: "short", hour: "numeric", minute: "2-digit" }) + " SGT";
let quotaTimer = null;
function showQuotaBanner() {
    const el = $("quota-banner");
    if (el) {
        el.innerHTML = `<b>Daily limit reached.</b> The database's free daily allowance is used up, so saving (and live updates) will work again at about <b>${esc(quotaResetText())}</b>. `
            + `You can still look at what's on screen, but it isn't live, and anything you tried to save was <b>not saved</b>. `
            + `<span class="muted">If it isn't back by then, the monthly data allowance may be used up; that resets on the 1st.</span>`;
        el.classList.remove("hidden");
    }
    if (typeof setSync === "function") setSync("quota");
    if (!quotaTimer) quotaTimer = setInterval(quotaProbe, 5 * 60 * 1000);
}
async function quotaProbe() {
    try { await store.getDoc("settings", "app"); } catch (err) { return false; }
    clearInterval(quotaTimer); quotaTimer = null;
    const el = $("quota-banner"); if (el) el.classList.add("hidden");
    if (typeof appRunning !== "undefined" && appRunning) startData();     // listeners stop on the error; start them again
    toast("Back to normal: the daily limit has reset and saving works again.");
    return true;
}

function friendlyError(err) {
    const code = err && err.code;
    if (isQuotaError(err)) {
        showQuotaBanner();
        return `Not saved: the daily limit is reached. Try again after ${quotaResetText()}.`;
    }
    const map = {
        "permission-denied": "Permission denied - your account isn't allowed to make that change.",
        "auth/invalid-credential": "Invalid email or password.",
        "auth/wrong-password": "Invalid email or password.",
        "auth/user-not-found": "Invalid email or password.",
        "auth/email-already-in-use": "That email already has an account. Try signing in.",
        "auth/weak-password": "Password must be at least 6 characters.",
        "auth/invalid-email": "That email address doesn't look right.",
        "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
        "auth/configuration-not-found": "Sign-in isn't set up yet: in the Firebase console open Authentication → Get started, then enable Email/Password.",
        "auth/operation-not-allowed": "Email/Password sign-in is switched off in the Firebase console (Authentication → Sign-in method)."
    };
    return map[code] || (err && err.message) || String(err);
}

// Save a generated file. The preview build can override this via window.__saveFileHook.
async function saveFile(name, blob) {
    if (typeof window.__saveFileHook === "function") return window.__saveFileHook(name, blob);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ---------- Permissions (UI side - firestore.rules enforces the same thing server-side) ----------
const isActive = () => !!profile && profile.status === "active";
const isAdmin = () => isActive() && profile.role === "Admin";
const isPrimary = () => isAdmin() && !!profile.isPrimary;
let permCache = { src: null, perm: null };
function myPerm() {
    if (permCache.src !== profile) permCache = { src: profile, perm: profile ? effectivePerm(profile) : permAll(false) };
    return permCache.perm;
}
// can("maintenance", "verify") - feature-level permission check. Admins can do everything.
const can = (mod, feat) => isAdmin() || (isActive() && !!(myPerm()[mod] || {})[feat]);
const tabOn = k => can(k, "view");
// v5.4: Admin tools an Admin can hand to a Co-Admin (People & Access › Admin tools). Never Members.
const coTool = feat => isAdmin() || (!!profile && profile.role === "Co-Admin" && can("admin", feat));
const pList = k => (profile && Array.isArray(profile[k])) ? profile[k] : [];
const canViewCol = key => isAdmin() || !ROW_KEYS.includes(key) || pList("viewCols").includes(key);
const canEditCol = key => isAdmin() || pList("editCols").includes(key);
const canEditRow = it => isAdmin() || !pList("editCats").length || pList("editCats").includes(it.category);
const canEditCell = (it, key) => canEditCol(key) && canEditRow(it);
const canEditAny = () => isAdmin() || pList("editCols").length > 0;
const canEditNonCondition = () => isAdmin() || pList("editCols").some(k => k !== "condition");
const units = a => a && a.kind === "general" ? Math.max(0, parseInt(a.qty, 10) || 0) : 1;   // general records carry a quantity
const isGeneral = a => !!a && a.kind === "general";
// Year of Purchase: next year back to 2010
const YEARS = (() => { const y = new Date().getFullYear() + 1; return Array.from({ length: y - 2009 }, (_, i) => String(y - i)); })();
const yearOptions = (sel, blank) => `<option value="">${blank || "Not set"}</option>` + uniq([...(sel && !YEARS.includes(String(sel)) ? [String(sel)] : []), ...YEARS])
    .map(y => `<option value="${esc(y)}" ${String(sel) === y ? "selected" : ""}>${esc(y)}</option>`).join("");
// Bought (year set) but no finance asset code yet -> send to finance
const needsFinance = a => !!dv(a.yearOfPurchase) && !dv(a.code) && !RETIRED.includes(a.condition);
// Any asset still in use without a Code / AEV, whatever its purchase year.
const noCode = a => !dv(a.code) && !RETIRED.includes(a.condition);
const inlineOn = () => editMode && canEditNonCondition();
const roleTemplate = role => resolveTemplate(role, settings.roles);

// =====================================================================
// DIALOGS (in-app replacements for confirm/prompt, plus a generic modal host)
// =====================================================================
// onClose runs once when this dialog goes away (saved, cancelled or replaced).
let dynOnClose = null;
function showModal({ title, body, size, onMount, onClose }) {
    closeDynModal();
    dynOnClose = onClose || null;
    const host = $("modal-host");
    host.innerHTML = `<div class="modal-backdrop" id="dyn-modal">
        <div class="modal ${size || ""}" role="dialog" aria-modal="true">
            <div class="modal-head"><h3>${title}</h3><button type="button" class="icon-btn" data-close title="Close" aria-label="Close">✕</button></div>
            <div class="modal-body">${body}</div>
        </div></div>`;
    const root = $("dyn-modal");
    root.addEventListener("click", e => { if (e.target.closest("[data-close]")) closeDynModal(); });
    if (onMount) onMount(root);
    const first = root.querySelector("[autofocus]") || root.querySelector("input:not([type=hidden]):not([type=checkbox]):not([disabled]):not([readonly]), textarea, select");
    if (first) focusSoon(first, 40);
    return root;
}
// Focus a field shortly after a dialog opens - unless the person has already clicked or typed
// into something in that dialog (fast typists / taps would otherwise have their cursor yanked away).
function focusSoon(el, ms) {
    setTimeout(() => {
        if (!el || !el.isConnected) return;
        const box = el.closest(".modal, .modal-overlay, form, .auth-card") || document.body;
        const a = document.activeElement;
        if (a && a !== document.body && a !== el && box.contains(a)) return;
        el.focus();
    }, ms || 30);
}
function closeDynModal() {
    Combo.close();
    const h = $("modal-host");
    if (h) h.innerHTML = "";
    const cb = dynOnClose; dynOnClose = null;
    if (cb) cb();
}

// uiConfirm({ title, message, confirmText, danger, input: { label, placeholder, required, value, multiline, match } })
// Resolves to false (cancelled), true (confirmed), or the typed string when an input is requested.
function uiConfirm(opts) {
    return new Promise(resolve => {
        const host = $("dialog-host");
        const inp = opts.input;
        host.innerHTML = `<div class="modal-backdrop dialog-layer"><div class="modal sm" role="alertdialog" aria-modal="true">
            <div class="modal-head"><h3>${esc(opts.title || "Are you sure?")}</h3></div>
            <form class="modal-body" id="dlg-form" novalidate>
                ${opts.message ? `<p class="dlg-msg">${opts.html ? opts.message : esc(opts.message)}</p>` : ""}
                ${inp ? `<div class="field"><label for="dlg-input">${esc(inp.label || "")}</label>
                    ${inp.multiline ? `<textarea id="dlg-input" rows="3" placeholder="${esc(inp.placeholder || "")}">${esc(inp.value || "")}</textarea>`
                        : `<input type="text" id="dlg-input" placeholder="${esc(inp.placeholder || "")}" value="${esc(inp.value || "")}" autocomplete="off">`}</div>` : ""}
                <p class="error-msg hidden" id="dlg-err"></p>
                <div class="form-actions">
                    <button type="button" class="btn btn-ghost" id="dlg-cancel">${esc(opts.cancelText || "Cancel")}</button>
                    <button type="submit" class="btn ${opts.danger ? "btn-danger-solid" : "btn-primary"}" id="dlg-ok">${esc(opts.confirmText || "Confirm")}</button>
                </div>
            </form></div></div>`;
        const done = v => { host.innerHTML = ""; document.removeEventListener("keydown", onKey, true); resolve(v); };
        const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); done(false); } };
        document.addEventListener("keydown", onKey, true);
        $("dlg-cancel").addEventListener("click", () => done(false));
        $("dlg-form").addEventListener("submit", e => {
            e.preventDefault();
            if (!inp) return done(true);
            const v = $("dlg-input").value.trim();
            const err = m => { $("dlg-err").textContent = m; $("dlg-err").classList.remove("hidden"); };
            if (inp.required && !v) return err(inp.requiredMsg || "This field is required.");
            if (inp.match && v !== inp.match) return err(`Type ${inp.match} exactly to confirm.`);
            if (inp.validate) { const m = inp.validate(v); if (m) return err(m); }
            done(v);
        });
        focusSoon(inp ? $("dlg-input") : $("dlg-ok"), 30);
    });
}

const condOptions = (sel, extra) => (extra ? `<option value="">${extra}</option>` : "") +
    CONDITIONS.map(c => `<option value="${esc(c)}" ${c === sel ? "selected" : ""}>${esc(c)}</option>`).join("");

// Space + location combo pair used by many forms. ids: `${prefix}-space`, `${prefix}-loc`
function placeFields(prefix, space, location, labels) {
    const l = labels || {};
    return `<div class="field"><label for="${prefix}-space">${l.space || "Item space"}</label>
            <input type="text" id="${prefix}-space" data-combo="space" autocomplete="off" value="${esc(space || "")}" placeholder="${l.ph || "Type or select a space"}"></div>
        <div class="field"><label for="${prefix}-loc">${l.location || "Item location"}</label>
            <input type="text" id="${prefix}-loc" data-combo="location" data-combo-space="${prefix}-space" autocomplete="off" value="${esc(location || "")}" placeholder="${l.ph || "Type or select a location"}"></div>`;
}

// =====================================================================
// WRITES: every change = one atomic commit (doc changes + audit log) + Sheets backup
// =====================================================================
function cacheLookup(col, id) {
    const src = { inventory, maintenance: tickets, loans, shows, discrepancies, audits }[col];
    return src ? src.find(x => x.id === id) || null : null;
}

// Log History keeps only what answers "who did what to our equipment or accounts".
// In-between steps, and things already recorded elsewhere (crew bookings live in the roster / Shows Sheets),
// are not logged. Anything not listed here is logged.
const LOG_SKIP_BOOKINGS = ["Soft booked", "Booking confirmed", "Booking cleared", "Soft booking withdrawn", "Removed from show",
    "Availability reminder sent", "Show created", "Show deleted", "Show details changed", "Maintenance call created", "Maintenance call deleted",
    "Show repeated", "Maintenance call repeated"];
const LOG_SKIP = new Set([...LOG_SKIP_BOOKINGS,
    "Loan requested", "Loan cancelled", "Loan return started", "Discrepancy reported", "Check round started",
    "Password changed", "Branding updated", "Venue added", "Venue removed", "Venue colour changed", "Condition added", "Condition changed", "Condition removed",
    "Inventory bundles built", "Inventory bundles rebuilt", "Booking emails turned on", "Booking emails turned off",
    // v5.11 (MY's pick): asset detail edits (only condition / location changes are logged), show lists, crew ticks, templates, finished rounds
    "Asset updated", "Show signed out", "Show signed in", "Show gear added", "Crew roles changed", "Role template changed", "Auto sign-out changed", "Check round finished"]);
const logWanted = action => !LOG_SKIP.has(String(action || ""));
const keepUsefulLogs = ops => ops.filter(o => o.col !== "logs" || o.op !== "set" || logWanted(o.data && o.data.action));

// opts.onProgress(doneAssets, totalAssets): called after each saved chunk of a big inventory save (imports).
async function commitOps(ops, opts) {
    ops = keepUsefulLogs(ops);
    if (!ops.length) return;
    const backupItems = Backup.fromOps(ops); // built before the snapshot listener replaces the cache
    await store.commit(ops, opts);
    Backup.push(backupItems);
}

function makeLog(action, asset, changes, note, extra) {
    const a = asset || {};
    return {
        op: "set", col: "logs", id: store.newId("logs"),
        data: {
            at: nowIso(), by: myEmail(), byName: myName(), byUid: authUser.uid,
            action, assetId: a.id || "", assetLabel: a.id ? assetLabel(a) : (a.label || ""), category: a.category || "",
            changes: changes || [], note: note || "", ticketId: "", ...(extra || {})
        }
    };
}

function diffFields(asset, patch) {
    return Object.keys(patch)
        .filter(k => dv(asset[k]).trim() !== dv(patch[k]).trim())
        .map(k => ({ field: k, from: dv(asset[k]), to: dv(patch[k]) }));
}

function classifyChange(changes) {
    const f = changes.map(c => c.field);
    if (f.includes("condition") && f.some(x => LOCATION_KEYS.includes(x))) return "Condition + location change";
    if (f.includes("condition")) return "Condition change";
    if (f.every(x => LOCATION_KEYS.includes(x))) return "Location change";
    return "Asset updated";
}

const meta = () => ({ updatedAt: nowIso(), updatedBy: myEmail() });

async function updateAsset(id, patch, note) {
    const it = assetById(id);
    if (!it) return false;
    const blocked = Object.keys(patch).filter(k => !canEditCell(it, k));
    if (blocked.length) { toast(`You don't have permission to edit ${blocked.map(k => FIELD_LABEL[k] || k).join(", ")}`, "err"); return false; }
    const changes = diffFields(it, patch);
    if (!changes.length) return true;
    const clean = Object.fromEntries(changes.map(c => [c.field, c.field === "remarks" && !dv(patch.remarks) ? "-" : patch[c.field]]));
    if (clean.condition !== undefined && isAdmin() && (it.faultStatus || it.condBefore)) { clean.faultStatus = ""; clean.condBefore = ""; }
    try {
        await commitOps([
            { op: "update", col: "inventory", id, data: { ...clean, ...meta() } },
            makeLog(classifyChange(changes), it, changes, note)
        ]);
        toast(changes.length === 1 ? `${FIELD_LABEL[changes[0].field]} updated` : "Asset updated");
        return true;
    } catch (err) {
        console.error(err);
        toast(friendlyError(err), "err");
        requestRender(true); // put the stored value back in the cell
        return false;
    }
}

// Workflow writes (maintenance / loans / discrepancies) may move an asset even when the person has no
// column edit rights. They're limited to these fields and tagged with the workflow doc, which
// firestore.rules checks exists in the same commit.
// faultStatus ("pending" = reported, waiting for a Co-Admin; "confirmed") and condBefore (the condition to go back to if the report is rejected)
// are kept by the fault workflow only; they aren't shown as columns.
const WF_FIELDS = ["condition", "qty", "itemSpace", "itemLocation", "serialNo", "remarks", "faultStatus", "condBefore"];
const faultNote = a => a && a.condition === "Faulty" ? (a.faultStatus === "pending" ? "pending" : a.faultStatus === "confirmed" ? "confirmed" : "") : "";
function wfAssetOps(asset, patch, col, ref, step) {
    if (!asset) return { ops: [], changes: [] };
    const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => WF_FIELDS.includes(k)));
    // Any other step that changes the condition (a loan, a repair, a check) ends the fault flag.
    if (clean.condition !== undefined && clean.condition !== asset.condition && clean.faultStatus === undefined && (asset.faultStatus || asset.condBefore)) { clean.faultStatus = ""; clean.condBefore = ""; }
    const changes = diffFields(asset, clean).filter(c => c.field !== "faultStatus" && c.field !== "condBefore");
    const data = Object.fromEntries(changes.map(c => [c.field, c.field === "remarks" && !c.to ? "-" : clean[c.field]]));
    ["faultStatus", "condBefore"].forEach(k => { if (clean[k] !== undefined && dv(asset[k]).trim() !== dv(clean[k]).trim()) data[k] = clean[k]; });
    return {
        changes,
        ops: [{ op: "update", col: "inventory", id: asset.id, data: { ...data, wfCol: col, wfRef: ref, wfStep: `${step}:${Date.now()}`, ...meta() } }]
    };
}
const histEntry = (stage, note) => ({ stage, at: nowIso(), by: myEmail(), note: note || "" });

// =====================================================================
// COMBO-BOX SOURCES
// =====================================================================
const countBy = (arr, fn) => arr.reduce((m, x) => { const k = fn(x); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
const plural = (n, w) => `${n} ${n === 1 ? w : w === "person" ? "people" : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + "ies" : /(s|x|ch|sh)$/.test(w) ? w + "es" : w + "s"}`;

function spaceFor(inp) {
    if (inp.dataset.comboSpace) { const el = $(inp.dataset.comboSpace); return el ? el.value.trim() : ""; }
    if (inp.dataset.id) { const a = assetById(inp.dataset.id); return a ? dv(a.itemSpace) : ""; }
    return "";
}

function registerComboSources() {
    Combo.register("category", () => {
        const c = countBy(inventory, a => a.category);
        return uniq([...Object.keys(c), ...DEFAULT_CATEGORIES]).sort().map(v => ({ value: v, sub: c[v] ? plural(c[v], "asset") : "" }));
    });
    Combo.register("brand", () => {
        const c = countBy(inventory, a => a.brand);
        return Object.keys(c).sort().map(v => ({ value: v, sub: plural(c[v], "asset") }));
    });
    Combo.register("model", inp => {
        const brandEl = inp.dataset.comboBrand && $(inp.dataset.comboBrand);
        const brand = brandEl ? brandEl.value.trim().toLowerCase() : "";
        const models = {};
        inventory.forEach(a => { if (a.model) { const k = a.model; models[k] = models[k] || { n: 0, brand: a.brand, desc: a.description }; models[k].n += units(a); } });
        const all = Object.entries(models).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
        const mine = brand ? all.filter(([, m]) => lc(m.brand) === brand) : [];
        const rest = brand ? all.filter(([, m]) => lc(m.brand) !== brand) : all;
        const opt = (g) => ([k, m]) => ({ value: k, sub: `${m.brand || ""} · ${plural(m.n, "unit")}`, group: g });
        return [...(mine.length ? mine.map(opt(`${brandEl.value.trim()} models`)) : []), ...rest.map(opt(mine.length ? "Other models" : ""))];
    });
    Combo.register("space", () => {
        const c = countBy(inventory, a => dv(a.itemSpace));
        return Object.keys(c).sort().map(v => ({ value: v, sub: plural(c[v], "item") }));
    });
    Combo.register("location", inp => {
        const space = spaceFor(inp).toLowerCase();
        const locs = {};
        inventory.forEach(a => {
            const l = dv(a.itemLocation); if (!l) return;
            const k = l; locs[k] = locs[k] || { n: 0, spaces: new Set() }; locs[k].n++; locs[k].spaces.add(dv(a.itemSpace));
        });
        const all = Object.entries(locs).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
        const inSpace = space ? all.filter(([, v]) => [...v.spaces].some(s => s.toLowerCase() === space)) : [];
        const other = space ? all.filter(([, v]) => ![...v.spaces].some(s => s.toLowerCase() === space)) : all;
        const label = spaceFor(inp);
        return [
            ...inSpace.map(([k, v]) => ({ value: k, sub: plural(v.n, "item"), group: `In ${label}` })),
            ...other.map(([k, v]) => ({ value: k, sub: [...v.spaces].filter(Boolean).join(", "), group: inSpace.length ? "Other locations" : "" }))
        ];
    });
    Combo.register("borrower", () => uniq([...loans.map(l => l.borrowerName), ...loans.map(l => l.requestedByName), ...users.filter(u => u.status === "active").map(u => u.displayName)]).sort());
    Combo.register("vendor", () => uniq([...tickets.map(t => t.vendor),
        ...logs.map(l => (String(l.note || "").match(/Vendor: ([^·]+)/) || [])[1]).map(v => v && v.trim())]).sort());
    // Equipment names only - no asset numbers or serials (used by loans and show sign-out)
    Combo.register("equipment", () => equipmentList().map(e => ({
        value: e.name, sub: [e.description, e.loanable ? `${e.available} available` : null].filter(Boolean).join(" · "),
        search: `${e.category} ${e.model} ${e.brand}`, data: e
    })));
    // Exact units for loan fulfilment (strict)
    Combo.register("loanAsset", inp => {
        const [brand, model] = (inp.dataset.model || "|").split("|");
        const taken = new Set(Array.from(document.querySelectorAll("input[data-combo='loanAsset']"))
            .filter(x => x !== inp && x.dataset.assetId).map(x => x.dataset.assetId));
        const busy = new Set(loans.filter(l => OPEN_LOAN.includes(l.status)).flatMap(l => (l.assigned || []).map(a => a.assetId)));
        const opt = (a, group) => ({
            value: assetLabel(a), group, data: a, disabled: taken.has(a.id),
            sub: [isGeneral(a) && `Bulk ×${a.qty}`, a.assetNo && `Asset ${a.assetNo}`, a.serialNo && `S/N ${a.serialNo}`, [dv(a.itemSpace), dv(a.itemLocation)].filter(Boolean).join(" / ")].filter(Boolean).join(" · ") + (taken.has(a.id) ? " · picked" : ""),
            search: `${a.assetNo} ${a.serialNo} ${a.code} ${a.brand} ${a.model}`
        });
        const avail = inventory.filter(a => a.condition === "Available" && !busy.has(a.id));
        const same = avail.filter(a => lc(a.model) === lc(model) && (!brand || lc(a.brand) === lc(brand)));
        const others = avail.filter(a => !same.includes(a));
        return [...same.map(a => opt(a, `Available ${model || "units"}`)), ...others.map(a => opt(a, same.length ? "Other available units" : "Available units"))];
    });
}

// Distinct equipment by brand + model, with how many units are free to lend.
function equipmentList() {
    const busy = new Set(loans.filter(l => OPEN_LOAN.includes(l.status)).flatMap(l => (l.assigned || []).map(a => a.assetId)));
    const map = {};
    inventory.forEach(a => {
        if (RETIRED.includes(a.condition)) return;
        const name = equipName(a);
        if (!name) return;
        const e = map[name] || (map[name] = { name, brand: a.brand || "", model: a.model || "", category: a.category || "", description: a.description || "", total: 0, available: 0, loanable: true });
        e.total += units(a);
        if (a.condition === "Available" && !busy.has(a.id)) e.available += units(a);
    });
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
