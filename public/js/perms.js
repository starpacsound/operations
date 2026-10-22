// =====================================================================
// Permission model - shared by the UI, the demo store and (in spirit) firestore.rules.
//
// Each user profile carries its own effective permissions:
//   perm      { module: { feature: true/false } }       - see PERM_MODULES below
//   viewCols  [row columns they can see]        viewCats [categories they can see; [] = all]
//   editCols  [fields they can edit]            editCats [categories they can edit; [] = all]
// Role templates (settings/roles) are copied onto a user when they're approved or change role.
// Admins bypass all of this and always have full access.
// =====================================================================

const GROUP_FIELDS = [
    { key: "category", label: "Category" }, { key: "brand", label: "Brand" },
    { key: "model", label: "Model" }, { key: "description", label: "Description" }
];
const ROW_COLUMNS = [
    { key: "internalAssetNo", label: "Internal Asset No", ph: "Internal No", strong: true, mono: true },
    { key: "qty", label: "Qty", ph: "Qty", general: true },
    { key: "assetNo", label: "Asset No", ph: "Asset No", mono: true },
    { key: "serialNo", label: "Serial No", ph: "Serial No", mono: true },
    { key: "code", label: "Code / AEV", ph: "Code", mono: true },
    { key: "itemSpace", label: "Item Space", ph: "Space", combo: "space" },
    { key: "itemLocation", label: "Item Location", ph: "Location", combo: "location" },
    { key: "condition", label: "Condition" },
    { key: "yearOfPurchase", label: "Year of Purchase" },
    { key: "remarks", label: "Remarks", ph: "Remarks" }
];
const ALL_FIELDS = [...GROUP_FIELDS, ...ROW_COLUMNS];
const ALL_FIELD_KEYS = ALL_FIELDS.map(f => f.key);
const ROW_KEYS = ROW_COLUMNS.map(f => f.key);
const FIELD_LABEL = Object.fromEntries(ALL_FIELDS.map(f => [f.key, f.label]));

// Feature-level permissions, grouped by module. srv = enforced by firestore.rules (others hide UI only).
const PERM_MODULES = [
    { key: "catalogue", label: "Asset Catalogue", features: [
        { key: "view", label: "See the tab" },
        { key: "addDetailed", label: "Add detailed assets", srv: true },
        { key: "addGeneral", label: "Add general (bulk) assets", srv: true },
        { key: "import", label: "Import CSV", hint: "Also needs Add detailed assets" },
        { key: "export", label: "Export CSV" },
        { key: "delete", label: "Delete assets", srv: true }
    ] },
    { key: "rack", label: "Rack Layout", features: [
        { key: "view", label: "See the tab" }
    ] },
    { key: "check", label: "Inventory Check", features: [
        { key: "view", label: "See the tab & tick assets", srv: true },
        { key: "report", label: "Report discrepancies", srv: true },
        { key: "rounds", label: "Start / finish check rounds", srv: true },
        { key: "review", label: "Approve / reject discrepancies", srv: true },
        { key: "history", label: "See check history & download PDF", srv: true },
        { key: "deleteHistory", label: "Delete check history records", srv: true }
    ] },
    { key: "maintenance", label: "Maintenance", features: [
        { key: "view", label: "See the tab" },
        { key: "submit", label: "Submit fault requests", srv: true },
        { key: "viewAll", label: "See everyone's requests (not just own)", srv: true },
        { key: "viewWork", label: "See Confirmed & Repairing lists" },
        { key: "verify", label: "Verify / reject requests", srv: true },
        { key: "repair", label: "Send to repair / mark repaired", srv: true }
    ] },
    { key: "loans", label: "Equipment Loans", features: [
        { key: "view", label: "See the tab" },
        { key: "request", label: "Request loans", srv: true },
        { key: "viewAll", label: "See everyone's loans", srv: true },
        { key: "manage", label: "Approve, assign & receive loans", srv: true },
        { key: "catalogue", label: "Set “On Loan” from the catalogue", srv: true }
    ] },
    { key: "shows", label: "Show Sign-Out", features: [
        { key: "view", label: "See the tab" },
        { key: "signOut", label: "Sign gear out for a show", srv: true },
        { key: "viewAll", label: "See everyone's shows", srv: true }
    ] },
    { key: "avail", label: "Availability", features: [
        { key: "view", label: "See the tab" },
        { key: "edit", label: "Mark own available days", srv: true, hint: "People with this are listed in the roster sheet" },
        { key: "viewAll", label: "See everyone's availability", srv: true },
        { key: "book", label: "Book people (soft / confirmed)", srv: true, hint: "Also lets them see everyone" }
    ] },
    { key: "events", label: "Calendar", features: [
        { key: "view", label: "See the tab", hint: "Untick to hide the Calendar tab. Ticked alone: only shows they're booked on" },
        { key: "viewAll", label: "See every show & maintenance call", srv: true }
    ] },
    { key: "logs", label: "Log History", features: [
        { key: "view", label: "See the tab", srv: true },
        { key: "pdf", label: "Download Log PDF" }
    ] }
];
const ROLES = ["Admin", "Co-Admin", "Member"];
// Features a role can never have, whatever the matrix says (also enforced in firestore.rules).
const ROLE_LOCKS = { Member: { shows: ["viewAll"] } };
const isLocked = (role, mod, feat) => !!(ROLE_LOCKS[role] && (ROLE_LOCKS[role][mod] || []).includes(feat));
function applyLocks(role, perm) {
    Object.entries(ROLE_LOCKS[role] || {}).forEach(([m, fs]) => fs.forEach(f => { if (perm[m]) perm[m][f] = false; }));
    return perm;
}
const TEMPLATE_ROLES = ["Co-Admin", "Member"];

const permAll = val => Object.fromEntries(PERM_MODULES.map(m => [m.key, Object.fromEntries(m.features.map(f => [f.key, val]))]));
const permWith = (base, overrides) => {
    const p = JSON.parse(JSON.stringify(base));
    Object.entries(overrides).forEach(([m, fs]) => Object.assign(p[m], fs));
    return p;
};

const BUILTIN_TEMPLATES = {
    "Co-Admin": {
        perm: permWith(permAll(true), { catalogue: { delete: false } }),
        viewCols: [...ROW_KEYS], editCols: [...ALL_FIELD_KEYS], viewCats: [], editCats: []
    },
    "Member": {
        perm: permWith(permAll(false), {
            catalogue: { view: true }, rack: { view: true }, check: { view: true, report: true },
            maintenance: { view: true, submit: true }, loans: { view: true, request: true },
            shows: { view: true, signOut: true }, avail: { view: true, edit: true }, events: { view: true }
        }),
        viewCols: [...ROW_KEYS], editCols: [], viewCats: [], editCats: []
    }
};

function mergePerm(base, stored) {
    const p = JSON.parse(JSON.stringify(base));
    Object.entries(stored || {}).forEach(([m, fs]) => { if (p[m] && fs) Object.entries(fs).forEach(([f, v]) => { if (f in p[m]) p[m][f] = !!v; }); });
    return p;
}

// Merge a stored template over the built-in one (so new features get sane defaults).
function resolveTemplate(role, stored) {
    if (role === "Admin") return { perm: permAll(true), viewCols: [...ROW_KEYS], editCols: [...ALL_FIELD_KEYS], viewCats: [], editCats: [] };
    const base = BUILTIN_TEMPLATES[role] || BUILTIN_TEMPLATES.Member;
    const s = (stored && stored[role]) || {};
    const list = (k) => Array.isArray(s[k]) ? [...s[k]] : [...base[k]];
    return { perm: applyLocks(role, mergePerm(base.perm, s.perm)), viewCols: list("viewCols"), editCols: list("editCols"), viewCats: list("viewCats"), editCats: list("editCats") };
}

// v3 profiles stored tabs{} + can{}; translate them so nobody loses access in the app after upgrading.
function permFromV3(u) {
    const t = u.tabs || {}, c = u.can || {};
    return {
        catalogue: { view: !!t.catalogue, addDetailed: !!c.addAssets, addGeneral: !!c.addAssets, import: !!c.importAssets, export: !!c.exportData, delete: !!c.deleteAssets },
        rack: { view: !!t.rack },
        check: { view: !!t.check, report: !!t.check, rounds: !!c.manageChecks, review: !!c.manageChecks, history: !!c.manageChecks, deleteHistory: !!c.manageChecks },
        maintenance: { view: !!t.maintenance, submit: true, viewAll: !!c.manageMaintenance, viewWork: !!c.manageMaintenance, verify: !!c.manageMaintenance, repair: !!c.manageMaintenance },
        loans: { view: !!t.loans, request: !!t.loans, viewAll: !!c.approveLoans, manage: !!c.approveLoans, catalogue: !!c.approveLoans },
        shows: { view: !!t.shows, signOut: !!t.shows, viewAll: !!c.viewAllShows },
        avail: { view: true, edit: true, viewAll: false, book: false },
        events: { view: true, viewAll: false },
        logs: { view: !!t.logs, pdf: !!c.downloadLogs }
    };
}
// Profiles saved before Calendar had its own row: give them the tab, and "see every event" if they could already see everyone's availability.
function withEventsDefault(stored) {
    if (!stored || stored.events) return stored;
    const a = stored.avail || {};
    return { ...stored, events: { view: a.view !== false, viewAll: !!(a.viewAll || a.book) } };
}
const effectivePerm = u => applyLocks(u.role, mergePerm(permAll(false), withEventsDefault(u.perm) || ((u.tabs || u.can) ? permFromV3(u) : {})));

// True when a user's permissions differ from their role template.
function differsFromTemplate(u, tpl) {
    const p = effectivePerm(u);
    const sameList = (a = [], b = []) => a.length === b.length && a.every(x => b.includes(x));
    const samePerm = PERM_MODULES.every(m => m.features.every(f => !!p[m.key][f.key] === !!tpl.perm[m.key][f.key]));
    return !(samePerm && sameList(u.viewCols, tpl.viewCols) && sameList(u.editCols, tpl.editCols) &&
        sameList(u.viewCats, tpl.viewCats) && sameList(u.editCats, tpl.editCats));
}

// Casual ID: staff ID typed at sign-up (stored upper-case, no spaces).
const CASUAL_ID_RE = /^[A-Z0-9][A-Z0-9\-\/]{0,29}$/;
const normCasualId = s => String(s || "").trim().toUpperCase().replace(/\s+/g, "");

function newPendingProfile(email, name, casualId) {
    return {
        email: String(email || "").toLowerCase(),
        displayName: name || "",
        casualId: normCasualId(casualId),
        role: "Member",
        status: "pending",
        isPrimary: false,
        perm: {},
        viewCols: [], editCols: [], viewCats: [], editCats: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()      // so the people list's "changed since" picks up new sign-ups
    };
}
