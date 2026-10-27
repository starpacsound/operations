// Firestore security-rules tests (v5.1). Runs against the local emulator:
//   npm run test:rules
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, orderBy, limit, writeBatch } from "firebase/firestore";
import firebase from "firebase/compat/app";
import "firebase/compat/firestore";

const env = await initializeTestEnvironment({
    projectId: "demo-showbase",
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") }
});

const ROW = ["internalAssetNo", "qty", "assetNo", "serialNo", "code", "itemSpace", "itemLocation", "condition", "yearOfPurchase", "remarks"];
const ALL = ["category", "brand", "model", "description", ...ROW];
const MODS = {
    catalogue: ["view", "addDetailed", "addGeneral", "import", "export", "delete"], rack: ["view"],
    check: ["view", "report", "rounds", "review", "history", "deleteHistory"],
    maintenance: ["view", "submit", "viewAll", "viewWork", "verify", "repair"],
    loans: ["view", "request", "viewAll", "manage", "catalogue"], shows: ["view", "signOut", "viewAll"], avail: ["view", "edit", "viewAll", "book"], events: ["view", "viewAll"], logs: ["view", "pdf"]
};
const permAll = v => Object.fromEntries(Object.entries(MODS).map(([m, fs]) => [m, Object.fromEntries(fs.map(f => [f, v]))]));
const permWith = (base, o) => { const p = JSON.parse(JSON.stringify(base)); Object.entries(o).forEach(([m, fs]) => Object.assign(p[m], fs)); return p; };
const CO = permWith(permAll(true), { catalogue: { delete: false } });
const MEM = permWith(permAll(false), { catalogue: { view: true }, rack: { view: true }, check: { view: true, report: true },
    maintenance: { view: true, submit: true }, loans: { view: true, request: true }, shows: { view: true, signOut: true }, avail: { view: true, edit: true }, events: { view: true } });
const prof = (email, role, extra = {}) => ({
    email, displayName: "", role, status: "active", isPrimary: false, perm: role === "Member" ? MEM : CO,
    viewCols: ROW, editCols: role === "Member" ? [] : ALL, viewCats: [], editCats: [], ...extra
});

await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    const put = (p, d) => setDoc(doc(db, p), d);
    await put("users/primary", prof("primary@x.com", "Admin", { isPrimary: true }));
    await put("users/admin2", prof("admin2@x.com", "Admin"));
    await put("users/co", prof("co@x.com", "Co-Admin"));
    await put("users/coRO", prof("coro@x.com", "Co-Admin", { editCols: [] }));
    await put("users/verifier", prof("ver@x.com", "Member", { perm: permWith(MEM, { maintenance: { viewAll: true, verify: true } }) }));
    await put("users/repairer", prof("rep@x.com", "Member", { perm: permWith(MEM, { maintenance: { viewWork: true, repair: true } }) }));
    await put("users/lender", prof("lend@x.com", "Member", { editCols: ["condition"], perm: permWith(MEM, { loans: { catalogue: true } }) }));
    await put("users/bulk", prof("bulk@x.com", "Member", { perm: permWith(MEM, { catalogue: { addGeneral: true } }) }));
    await put("users/mem", prof("mem@x.com", "Member", { displayName: "M", casualId: "C1" }));
    await put("users/mem2", prof("mem2@x.com", "Member"));
    await put("users/memAll", prof("memall@x.com", "Member", { perm: permWith(MEM, { shows: { viewAll: true } }) }));
    await put("users/evAll", prof("evall@x.com", "Member", { perm: permWith(MEM, { events: { view: true, viewAll: true } }) }));
    await put("users/condMem", prof("cond@x.com", "Member", { editCols: ["condition"] }));
    await put("users/crew", prof("crew@x.com", "Member", {
        viewCols: ["internalAssetNo", "itemLocation"], editCols: ["itemSpace", "itemLocation", "remarks"],
        viewCats: ["Wired Mics", "Wireless Mics"], editCats: ["Wired Mics"],
        perm: permWith(MEM, { loans: { view: false, request: false }, check: { view: false, report: false } })
    }));
    await put("users/v3", { email: "v3@x.com", role: "Co-Admin", status: "active", tabs: { logs: true }, can: { manageMaintenance: true }, viewCols: ROW, editCols: [], viewCats: [], editCats: [] });
    await put("users/pend", { ...prof("pend@x.com", "Member"), status: "pending" });
    await put("users/tmp", prof("tmp@x.com", "Member", { mustChangePassword: true }));
    await put("users/tmp2", prof("tmp2@x.com", "Member"));
    // v5.4 Admin tools handed to Co-Admins
    await put("users/coCond", prof("cocond@x.com", "Co-Admin", { perm: { ...CO, admin: { conditions: true, resetPw: false } } }));
    await put("users/coPw", prof("copw@x.com", "Co-Admin", { perm: { ...CO, avail: { view: true, edit: true, viewAll: false, book: false }, admin: { conditions: false, resetPw: true } } }));
    await put("users/memTool", prof("memtool@x.com", "Member", { perm: { ...MEM, admin: { conditions: true, resetPw: true } } }));
    await put("users/mem3", prof("mem3@x.com", "Member"));
    await put("settings/app", { appName: "Showbase", logo: "" });
    await put("settings/venues", { list: ["LT1", "The Arc"] });
    await put("crewRoles/all", { roles: { mem: ["SE", "ST"] }, updatedAt: "2026-10-01T00:00:00Z", updatedBy: "x" });
    await put("reminders/R1", { month: "2026-11", uids: ["mem"], byUid: "co", byName: "C", at: "now" });
    await put("reminders/R2", { month: "2026-11", uids: ["mem2"], byUid: "co", byName: "C", at: "now" });
    await put("jobs/J1", { kind: "show", date: "2026-11-05", month: "2026-11", title: "ABC", start: "14:00", end: "17:00", venue: "LT1", manpower: [],
        crew: [{ uid: "mem", name: "M", role: "ST" }, { uid: "co", name: "C", role: "SE" }], crewUids: ["mem", "co"] });
    await put("avail/mem_2026-11", { uid: "mem", month: "2026-11", name: "M", casualId: "C1", roles: ["SE"], avail: ["03", "04", "05"], soft: ["04"], conf: ["05"], withdrawn: [] });
    await put("inventory/wired1", { category: "Wired Mics", model: "SM58", serialNo: "S1", itemLocation: "Cab 2", condition: "Available", yearOfPurchase: "2024" });
    await put("inventory/wl1", { category: "Wireless Mics", model: "EW-DX", serialNo: "W1", itemLocation: "Shelf", condition: "Available" });
    await put("inventory/spk1", { category: "Speakers", model: "UPQ", serialNo: "M1", itemLocation: "Bay A", condition: "Available" });
    await put("maintenance/t1", { stage: "request", assetId: "spk1", requestedByUid: "mem" });
    await put("maintenance/t2", { stage: "confirmed", assetId: "wl1", requestedByUid: "mem2" });
    await put("loans/L1", { status: "requested", requestedByUid: "mem", assigned: [] });
    await put("loans/L2", { status: "approved", requestedByUid: "mem", assigned: [{ assetId: "wl1" }] });
    await put("loans/L3", { status: "collected", requestedByUid: "mem", assigned: [], returnDate: "", returnTbc: true, history: [] });
    await put("shows/S1", { status: "out", createdByUid: "mem", items: [{ name: "SM58", qty: 2, accounted: false }] });
    // v5.3 job-linked sign-outs
    const job = (crewUids) => ({ kind: "show", date: "2026-11-06", month: "2026-11", title: "J", start: "14:00", end: "17:00", venue: "LT1", manpower: [], crew: crewUids.map(u => ({ uid: u, name: u, role: "ST" })), crewUids });
    await put("jobs/J3", job(["mem"]));
    await put("jobs/J4", job(["mem", "mem2"]));
    await put("jobs/J5", job(["mem"]));
    const jshow = (jobId, crewUids, by) => ({ title: "J", titleLower: "j", showDate: "2026-11-06", venue: "LT1", jobId, crewUids, createdByUid: by, status: "out",
        items: [{ name: "SM58", qty: 2, accounted: false }, { name: "XLR", qty: 4, accounted: false }], missingCount: 0, history: [] });
    await put("shows/job_J4", jshow("J4", ["mem", "mem2"], "mem"));
    await put("shows/job_J5", jshow("J5", [], "co"));
    await put("audits/R1", { status: "open", venue: "Mic Store", name: "Oct" });
    await put("audits/R0", { status: "closed", venue: "Warehouse", name: "Sep", summary: { total: 3, checked: 2 } });
    await put("discrepancies/d1", { status: "pending", byUid: "mem", assetId: "spk1", proposed: { itemLocation: "Bay B" } });
    await put("logs/l1", { action: "x", byUid: "primary", at: "2026-01-01" });
});

const as = (id, email, verifiedEmail = true) => env.authenticatedContext(id, { email: email || `${id}@x.com`, email_verified: verifiedEmail }).firestore();
const anon = env.unauthenticatedContext().firestore();
const results = [];
async function t(name, p) {
    try { await p; results.push([name, true]); console.log("PASS", name); }
    catch (e) { results.push([name, false]); console.log("FAIL", name, "-", String(e.message).split("\n")[0]); }
}
const mem = as("mem"), mem2 = as("mem2"), co = as("co"), coRO = as("coRO");

// ---------- branding / sign-up ----------
await t("anyone can read branding", assertSucceeds(getDoc(doc(anon, "settings/app"))));
await t("member can't change branding", assertFails(setDoc(doc(mem, "settings/app"), { appName: "Hacked" })));
await t("admin edits role templates", assertSucceeds(setDoc(doc(as("admin2"), "settings/roles"), { Member: { perm: { logs: { view: true } } } }, { merge: true })));
const pendingProfile = email => ({ email, displayName: "N", casualId: "C12345", role: "Member", status: "pending", isPrimary: false,
    perm: {}, viewCols: [], editCols: [], viewCats: [], editCats: [], createdAt: "now", updatedAt: "now" });
await t("self sign-up as pending Member", assertSucceeds(setDoc(doc(as("newbie", "newbie@x.com"), "users/newbie"), pendingProfile("newbie@x.com"))));
await t("full-time staff sign up with no Casual ID", assertSucceeds(setDoc(doc(as("ft", "ft@x.com"), "users/ft"), { ...pendingProfile("ft@x.com"), casualId: "" })));
await t("self sign-up can't grant itself features", assertFails(setDoc(doc(as("evil", "evil@x.com"), "users/evil"), { ...pendingProfile("evil@x.com"), perm: { loans: { manage: true } } })));
await t("can't sign up on the reserved username domain", assertFails(setDoc(doc(as("fake", "fake@showbase.local"), "users/fake"), pendingProfile("fake@showbase.local"))));
await t("sign-up rejects a malformed Casual ID", assertFails(setDoc(doc(as("bad", "bad@x.com"), "users/bad"), { ...pendingProfile("bad@x.com"), casualId: "c 1<script>" })));
await t("member can't change own Casual ID", assertFails(updateDoc(doc(mem, "users/mem"), { casualId: "C99999" })));
await t("temp-password account can't read inventory", assertFails(getDocs(collection(as("tmp"), "inventory"))));
await t("temp-password account can't write logs", assertFails(setDoc(doc(as("tmp"), "logs/tmp1"), { action: "x", byUid: "tmp" })));
await t("temp-password account can't re-set the flag to true", assertFails(updateDoc(doc(as("tmp"), "users/tmp"), { mustChangePassword: true, passwordChangedAt: "now" })));
await t("temp-password account clears its own flag", assertSucceeds(updateDoc(doc(as("tmp"), "users/tmp"), { mustChangePassword: false, passwordChangedAt: "now" })));
await t("member can't flag someone else for reset", assertFails(updateDoc(doc(mem, "users/tmp2"), { mustChangePassword: true })));
await t("admin flags a user for reset", assertSucceeds(updateDoc(doc(as("primary"), "users/tmp2"), { mustChangePassword: true, tempPasswordSetAt: "now", tempPasswordSetBy: "primary@x.com" })));
await t("admin can't flag the primary admin", assertFails(updateDoc(doc(as("admin2"), "users/primary"), { mustChangePassword: true })));
await t("admin corrects a Casual ID", assertSucceeds(updateDoc(doc(as("primary"), "users/mem2"), { casualId: "C55555" })));
await t("self sign-up as Admin blocked", assertFails(setDoc(doc(as("evil", "evil@x.com"), "users/evil"), { ...pendingProfile("evil@x.com"), role: "Admin" })));
await t("sign-up works before the email is verified", assertSucceeds(setDoc(doc(as("newbie2", "newbie2@x.com", false), "users/newbie2"), pendingProfile("newbie2@x.com"))));
await t("approved but unverified account can't read data", assertFails(getDocs(collection(as("mem", "mem@x.com", false), "inventory"))));
await t("unverified user can't claim to be verified", assertFails(updateDoc(doc(as("pend", "pend@x.com", false), "users/pend"), { emailVerified: true, emailVerifiedAt: "now" })));
await t("verified user records verification on their profile", assertSucceeds(updateDoc(doc(as("pend"), "users/pend"), { emailVerified: true, emailVerifiedAt: "now" })));
await t("pending user can't read inventory", assertFails(getDocs(collection(as("pend"), "inventory"))));
await t("member can't grant themselves features", assertFails(updateDoc(doc(mem, "users/mem"), { "perm.loans.manage": true })));
await t("v3 profile without perm map has no v4 features", assertFails(getDocs(collection(as("v3"), "logs"))));

// ---------- catalogue ----------
await t("member can't edit inventory", assertFails(updateDoc(doc(mem, "inventory/wired1"), { itemLocation: "X" })));
await t("member can't add a detailed asset", assertFails(setDoc(doc(mem, "inventory/new"), { kind: "detailed", category: "Cables", model: "X" })));
await t("general-only user adds a general asset", assertSucceeds(setDoc(doc(as("bulk"), "inventory/g1"), { kind: "general", category: "Cables", model: "XLR 3m", qty: 20 })));
await t("general-only user can't add a detailed asset", assertFails(setDoc(doc(as("bulk"), "inventory/d1"), { kind: "detailed", category: "Cables", model: "X" })));
await t("co-admin edits Year of Purchase", assertSucceeds(updateDoc(doc(co, "inventory/wired1"), { yearOfPurchase: "2025" })));
await t("condition-only member can't edit Year of Purchase", assertFails(updateDoc(doc(as("condMem"), "inventory/wired1"), { yearOfPurchase: "2020" })));
await t("condition-only member edits condition", assertSucceeds(updateDoc(doc(as("condMem"), "inventory/wired1"), { condition: "Deployed" })));
await t("co-admin can't delete assets", assertFails(deleteDoc(doc(co, "inventory/spk1"))));

// ---------- maintenance: submit vs view vs verify vs repair ----------
await t("member submits a request", assertSucceeds(setDoc(doc(mem, "maintenance/m1"), { stage: "request", assetId: "spk1", requestedByUid: "mem" })));
await t("member sees own tickets", assertSucceeds(getDocs(query(collection(mem, "maintenance"), where("requestedByUid", "==", "mem")))));
await t("member can't list everyone's requests", assertFails(getDocs(collection(mem, "maintenance"))));
await t("member can't read someone else's ticket", assertFails(getDoc(doc(mem, "maintenance/t2"))));
await t("member can't file straight to confirmed", assertFails(setDoc(doc(mem, "maintenance/m2"), { stage: "confirmed", requestedByUid: "mem" })));
await t("verifier lists all requests", assertSucceeds(getDocs(query(collection(as("verifier"), "maintenance"), where("stage", "in", ["request", "confirmed", "repairing"])))));
await t("repairer can't verify a request", assertFails(updateDoc(doc(as("repairer"), "maintenance/t1"), { stage: "confirmed" })));
await t("verifier verifies a request", assertSucceeds(updateDoc(doc(as("verifier"), "maintenance/t1"), { stage: "confirmed" })));
await t("verifier can't send to repair", assertFails(updateDoc(doc(as("verifier"), "maintenance/t2"), { stage: "repairing" })));
await t("repairer sends to repair", assertSucceeds(updateDoc(doc(as("repairer"), "maintenance/t2"), { stage: "repairing", vendor: "A" })));

// ---------- workflow path ----------
await t("read-only co-admin can't edit inventory directly", assertFails(updateDoc(doc(coRO, "inventory/spk1"), { condition: "Faulty" })));
{
    const b = writeBatch(coRO);
    b.set(doc(coRO, "maintenance/t9"), { stage: "confirmed", assetId: "spk1", requestedByUid: "coRO" });
    b.update(doc(coRO, "inventory/spk1"), { condition: "Faulty", itemLocation: "Faulty bin", wfCol: "maintenance", wfRef: "t9", wfStep: "confirmed:1" });
    await t("…but can move it as part of a maintenance ticket", assertSucceeds(b.commit()));
}
await t("workflow path can't change other fields", assertFails(updateDoc(doc(coRO, "inventory/spk1"), { model: "HACK", wfCol: "maintenance", wfRef: "t9", wfStep: "x:2" })));
await t("workflow path needs a real document", assertFails(updateDoc(doc(coRO, "inventory/spk1"), { condition: "Sold", wfCol: "maintenance", wfRef: "nope", wfStep: "x:3" })));
await t("member can't use the workflow path", assertFails(updateDoc(doc(mem, "inventory/spk1"), { condition: "Sold", wfCol: "maintenance", wfRef: "t1", wfStep: "x:5" })));
// v5.10: a fault report marks the asset Faulty (awaiting confirmation) at once.
{
    const b = writeBatch(mem);
    b.set(doc(mem, "maintenance/fm1"), { stage: "request", assetId: "spk1", requestedByUid: "mem" });
    b.update(doc(mem, "inventory/spk1"), { condition: "Faulty", faultStatus: "pending", condBefore: "Available", wfCol: "maintenance", wfRef: "fm1", wfStep: "request:1" });
    await t("fault report: member marks the asset Faulty together with their own report", assertSucceeds(b.commit()));
}
await t("fault report: only to Faulty", assertFails(updateDoc(doc(mem, "inventory/spk1"), { condition: "Sold", faultStatus: "pending", wfCol: "maintenance", wfRef: "fm1", wfStep: "request:2" })));
await t("fault report: nothing else changes with it", assertFails(updateDoc(doc(mem, "inventory/spk1"), { condition: "Faulty", faultStatus: "pending", model: "HACK", wfCol: "maintenance", wfRef: "fm1", wfStep: "request:3" })));
await t("fault report: must be the member's own report", assertFails(updateDoc(doc(mem, "inventory/spk1"), { condition: "Faulty", faultStatus: "pending", wfCol: "maintenance", wfRef: "t2", wfStep: "request:4" })));
await t("fault report: member can't mark it confirmed", assertFails(updateDoc(doc(mem, "inventory/spk1"), { condition: "Faulty", faultStatus: "confirmed", wfCol: "maintenance", wfRef: "fm1", wfStep: "request:5" })));
await t("fault report: another member can't use that report", assertFails(updateDoc(doc(as("mem2"), "inventory/spk1"), { condition: "Faulty", faultStatus: "pending", wfCol: "maintenance", wfRef: "fm1", wfStep: "request:6" })));
await t("fault report: a verifier puts the condition back on reject", assertSucceeds(updateDoc(doc(as("verifier"), "inventory/spk1"), { condition: "Available", faultStatus: "", condBefore: "", wfCol: "maintenance", wfRef: "fm1", wfStep: "rejected:7" })));

// ---------- loans ----------
await t("member requests a loan", assertSucceeds(setDoc(doc(mem, "loans/L9"), { status: "requested", requestedByUid: "mem", assigned: [], items: [], borrowerName: "Choir" })));
await t("member can't create an already-out loan", assertFails(setDoc(doc(mem, "loans/L10"), { status: "collected", source: "catalogue", requestedByUid: "mem", assigned: [] })));
await t("restricted user without request permission can't request", assertFails(setDoc(doc(as("crew"), "loans/L11"), { status: "requested", requestedByUid: "crew", assigned: [] })));
{
    const lender = as("lender");
    const b = writeBatch(lender);
    b.set(doc(lender, "loans/C1"), { status: "collected", source: "catalogue", requestedByUid: "lender", borrowerName: "Drama Club", assigned: [{ assetId: "wired1" }] });
    b.update(doc(lender, "inventory/wired1"), { condition: "On Loan", wfCol: "loans", wfRef: "C1", wfStep: "lent:1" });
    await t("catalogue lender creates a linked loan + sets On Loan", assertSucceeds(b.commit()));
}
await t("member reads own loans", assertSucceeds(getDocs(query(collection(mem, "loans"), where("requestedByUid", "==", "mem")))));
await t("member can't list everyone's loans", assertFails(getDocs(collection(mem, "loans"))));
await t("member can't approve own loan", assertFails(updateDoc(doc(mem, "loans/L1"), { status: "approved" })));
await t("member marks approved loan collected", assertSucceeds(updateDoc(doc(mem, "loans/L2"), { status: "collected", collectedAt: "now", history: [] })));
await t("member starts a return", assertSucceeds(updateDoc(doc(mem, "loans/L2"), { status: "returnRequested", returnRequestedAt: "now", returnNote: "", history: [] })));
await t("manager closes a loan", assertSucceeds(updateDoc(doc(co, "loans/L2"), { status: "returned" })));

// ---------- shows ----------
await t("member signs out a show", assertSucceeds(setDoc(doc(mem, "shows/S9"), { status: "out", createdByUid: "mem", venue: "LT1", items: [] })));
await t("show needs a venue", assertFails(setDoc(doc(mem, "shows/S8"), { status: "out", createdByUid: "mem", items: [] })));
await t("show venue can't be blank", assertFails(setDoc(doc(mem, "shows/S7"), { status: "out", createdByUid: "mem", venue: "", items: [] })));
await t("member lists own shows", assertSucceeds(getDocs(query(collection(mem, "shows"), where("createdByUid", "==", "mem")))));
await t("member with viewAll ticked still can't list all (Member lock)", assertFails(getDocs(collection(as("memAll"), "shows"))));
await t("member can't read another member's show", assertFails(getDoc(doc(mem2, "shows/S1"))));
await t("co-admin lists all shows", assertSucceeds(getDocs(collection(co, "shows"))));
// ---------- availability ----------
const av = (u, extra = {}) => ({ uid: u, month: "2026-12", name: "M", casualId: "C1", avail: ["01"], soft: [], conf: [], withdrawn: [], updatedAt: "now", updatedBy: "x", ...extra });
await t("member creates own month", assertSucceeds(setDoc(doc(mem, "avail/mem_2026-12"), av("mem"))));
await t("member can't create someone else's month", assertFails(setDoc(doc(mem, "avail/mem2_2026-12"), av("mem2"))));
await t("member can't book themselves on create", assertFails(setDoc(doc(mem2, "avail/mem2_2026-12"), av("mem2", { conf: ["01"] }))));
await t("member can't put someone else's name on their availability", assertFails(updateDoc(doc(mem, "avail/mem_2026-11"), { name: "Somebody Else", updatedAt: "t" })));
await t("member can't put a fake Casual ID on their availability", assertFails(updateDoc(doc(mem, "avail/mem_2026-11"), { casualId: "SC9999", updatedAt: "t" })));
await t("sign-up name length is capped", assertFails(setDoc(doc(as("long1", "long1@x.com"), "users/long1"), { ...pendingProfile("long1@x.com"), displayName: "x".repeat(61) })));
await t("member adds a free day", assertSucceeds(updateDoc(doc(mem, "avail/mem_2026-11"), { avail: ["03", "04", "05", "09"], updatedAt: "t" })));
await t("member sets available hours for a day", assertSucceeds(updateDoc(doc(mem, "avail/mem_2026-11"), { times: { "09": "18:00-23:00" }, updatedAt: "t" })));
await t("member can't drop a confirmed day", assertFails(updateDoc(doc(mem, "avail/mem_2026-11"), { avail: ["03", "04"], updatedAt: "t" })));
await t("member can't confirm themselves", assertFails(updateDoc(doc(mem, "avail/mem_2026-11"), { conf: ["05", "09"] })));
await t("member can't soft-book themselves", assertFails(updateDoc(doc(mem, "avail/mem_2026-11"), { soft: ["04", "09"] })));
await t("member can't change roles", assertFails(updateDoc(doc(mem, "avail/mem_2026-11"), { roles: ["SE", "ST"] })));
await t("member withdraws a soft booking", assertSucceeds(updateDoc(doc(mem, "avail/mem_2026-11"), { avail: ["03", "05", "09"], soft: [], withdrawn: ["04"], updatedAt: "t" })));
await t("member can't hide a withdrawal", assertFails(updateDoc(doc(mem, "avail/mem_2026-11"), { withdrawn: [] })));
await t("other member can't read my availability", assertFails(getDoc(doc(mem2, "avail/mem_2026-11"))));
await t("member reads own availability", assertSucceeds(getDocs(query(collection(mem, "avail"), where("uid", "==", "mem")))));
await t("co-admin reads the month grid", assertSucceeds(getDocs(query(collection(co, "avail"), where("month", "==", "2026-11")))));
await t("co-admin confirms a booking", assertSucceeds(updateDoc(doc(co, "avail/mem_2026-11"), { conf: ["05", "09"], withdrawn: [], updatedAt: "t" })));
await t("co-admin can't rename people", assertFails(updateDoc(doc(co, "avail/mem_2026-11"), { name: "X" })));
await t("member can't read crew roles (not even their own)", assertFails(getDoc(doc(mem, "crewRoles/all"))));
await t("member can't tick crew roles", assertFails(setDoc(doc(mem, "crewRoles/all"), { roles: { mem: ["SE", "ST", "CRS"] } }, { merge: true })));
await t("co-admin reads crew roles (one record)", assertSucceeds(getDoc(doc(co, "crewRoles/all"))));
await t("co-admin ticks a crew role in the app", assertSucceeds(setDoc(doc(co, "crewRoles/all"), { roles: { mem: ["SE", "ST", "NEW"] }, updatedAt: "now", updatedBy: "co@x.com" }, { merge: true })));
await t("crew roles record takes no other fields", assertFails(setDoc(doc(co, "crewRoles/all"), { roles: {}, perm: {} }, { merge: true })));
await t("crew roles live only in crewRoles/all", assertFails(setDoc(doc(co, "crewRoles/other"), { roles: {} })));
await t("old per-person rosterRoles records are gone", assertFails(getDoc(doc(co, "rosterRoles/mem"))));
await t("crew member reads their show (with teammates)", assertSucceeds(getDoc(doc(mem, "jobs/J1"))));
await t("crew member lists their shows", assertSucceeds(getDocs(query(collection(mem, "jobs"), where("crewUids", "array-contains", "mem")))));
await t("member not on the show can't read it", assertFails(getDoc(doc(mem2, "jobs/J1"))));
await t("member can't list everyone's shows", assertFails(getDocs(collection(mem, "jobs"))));
await t("member with 'see every event' lists the month's shows", assertSucceeds(getDocs(query(collection(as("evAll"), "jobs"), where("month", "==", "2026-11")))));
await t("'see every event' doesn't allow editing shows", assertFails(updateDoc(doc(as("evAll"), "jobs/J1"), { start: "15:00" })));
await t("member can't change show details", assertFails(updateDoc(doc(mem, "jobs/J1"), { start: "15:00" })));
await t("member can't create a show", assertFails(setDoc(doc(mem, "jobs/J9"), { kind: "show", crewUids: ["mem"], month: "2026-11" })));
await t("co-admin edits show details for everyone", assertSucceeds(updateDoc(doc(co, "jobs/J1"), { start: "15:00" })));
await t("co-admin lists the month's shows", assertSucceeds(getDocs(query(collection(co, "jobs"), where("month", "==", "2026-11")))));
await t("member can't read remembered show names", assertFails(getDoc(doc(mem, "settings/rosterLists"))));
await t("co-admin saves remembered show names", assertSucceeds(setDoc(doc(co, "settings/rosterLists"), { titles: ["ABC"] }, { merge: true })));
await t("co-admin sends an availability reminder", assertSucceeds(setDoc(doc(co, "reminders/R9"), { month: "2026-12", uids: ["mem", "mem2"], byUid: "co", byName: "C", at: "now" })));
await t("reminder must be signed by the sender", assertFails(setDoc(doc(co, "reminders/R8"), { month: "2026-12", uids: ["mem"], byUid: "primary", byName: "P", at: "now" })));
await t("member can't send reminders", assertFails(setDoc(doc(mem, "reminders/R7"), { month: "2026-12", uids: ["mem2"], byUid: "mem", byName: "M", at: "now" })));
await t("member reads reminders naming them", assertSucceeds(getDocs(query(collection(mem, "reminders"), where("uids", "array-contains", "mem")))));
await t("member can't read someone else's reminder", assertFails(getDoc(doc(mem, "reminders/R2"))));
await t("reminders can't be edited", assertFails(updateDoc(doc(co, "reminders/R1"), { uids: [] })));
await t("co-admin lists active people (for 'not filled yet')", assertSucceeds(getDocs(query(collection(co, "users"), where("status", "==", "active")))));
await t("co-admin can't read pending / disabled profiles", assertFails(getDoc(doc(co, "users/pend"))));
await t("member can't list people", assertFails(getDocs(query(collection(mem, "users"), where("status", "==", "active")))));
await t("member marks a month 'not available'", assertSucceeds(updateDoc(doc(mem, "avail/mem_2026-11"), { noAvail: true, updatedAt: "t" })));
await t("member can't turn booking emails on", assertFails(setDoc(doc(mem, "settings/availability"), { emailOnBooking: true })));
await t("admin turns booking emails on", assertSucceeds(setDoc(doc(as("primary"), "settings/availability"), { emailOnBooking: true })));

// ---------- shared venue list ----------
// ---------- asset conditions ----------
const condList = { list: [{ name: "Upgraded", short: "Upgr", color: "warn", retired: false }], updatedAt: "t", updatedBy: "a@x.com" };
await t("admin saves the condition list", assertSucceeds(setDoc(doc(as("primary"), "settings/conditions"), condList)));
await t("member reads the condition list", assertSucceeds(getDoc(doc(mem, "settings/conditions"))));
await t("member can't change conditions", assertFails(setDoc(doc(mem, "settings/conditions"), condList)));
await t("co-admin can't change conditions", assertFails(setDoc(doc(co, "settings/conditions"), condList)));
await t("pending user can't read conditions", assertFails(getDoc(doc(as("pend"), "settings/conditions"))));
await t("condition list can't carry other fields", assertFails(setDoc(doc(as("primary"), "settings/conditions"), { ...condList, x: 1 })));

await t("member reads venues", assertSucceeds(getDoc(doc(mem, "settings/venues"))));
await t("member adds a venue", assertSucceeds(setDoc(doc(mem, "settings/venues"), { list: ["LT1", "The Arc", "LT2"] }, { merge: true })));
await t("member can't remove venues", assertFails(setDoc(doc(mem, "settings/venues"), { list: ["LT1"] }, { merge: true })));
await t("member can't add other keys", assertFails(setDoc(doc(mem, "settings/venues"), { list: ["LT1", "The Arc", "LT2"], x: 1 }, { merge: true })));
await t("member adds a venue with its colour", assertSucceeds(setDoc(doc(mem, "settings/venues"), { list: ["LT1", "The Arc", "LT2", "LT3"], colors: { LT3: "#4e9be6" } }, { merge: true })));
await t("member can't recolour a venue", assertFails(setDoc(doc(mem, "settings/venues"), { colors: { LT3: "#ffffff" } }, { merge: true })));
await t("admin recolours a venue", assertSucceeds(setDoc(doc(as("primary"), "settings/venues"), { colors: { LT3: "#ffffff" } }, { merge: true })));
await t("admin removes a venue", assertSucceeds(setDoc(doc(as("primary"), "settings/venues"), { list: ["LT1"] })));
await t("pending user can't read venues", assertFails(getDoc(doc(as("pend"), "settings/venues"))));
await t("member can't list all shows", assertFails(getDocs(collection(mem, "shows"))));
await t("other member can't sign in my show", assertFails(updateDoc(doc(mem2, "shows/S1"), { status: "in" })));
await t("member signs in own show", assertSucceeds(updateDoc(doc(mem, "shows/S1"), { status: "in", items: [], signedInAt: "now", signedInBy: "mem@x.com", missingCount: 1, history: [] })));

// ---------- inventory check: rounds, ticks, history ----------
await t("member reads open rounds", assertSucceeds(getDocs(query(collection(mem, "audits"), where("status", "==", "open")))));
await t("member can't read check history", assertFails(getDoc(doc(mem, "audits/R0"))));
await t("member can't start a round", assertFails(setDoc(doc(mem, "audits/R2"), { status: "open", venue: "Warehouse" })));
await t("co-admin starts a round", assertSucceeds(setDoc(doc(co, "audits/R2"), { status: "open", venue: "Warehouse", name: "Oct" })));
const tickSet = (who, id, data) => setDoc(doc(who, "checkTicks/" + id), data, { merge: true });
await t("member ticks an asset in an open round", assertSucceeds(tickSet(mem, "R1_0", { roundId: "R1", shard: 0, last: "wired1", ticks: { wired1: { checked: true, at: "t", by: "x@x.com", byName: "X", byUid: "mem" } } })));
await t("another member ticks a different asset in the same record", assertSucceeds(tickSet(mem2, "R1_0", { roundId: "R1", shard: 0, last: "wl1", ticks: { wl1: { checked: true, at: "t", by: "x@x.com", byName: "X", byUid: "mem2" } } })));
await t("both ticks are kept", assertSucceeds(getDoc(doc(mem, "checkTicks/R1_0")).then(d => { if (!d.data().ticks.wired1 || !d.data().ticks.wl1) throw new Error("lost a tick"); })));
await t("member unticks their asset", assertSucceeds(tickSet(mem, "R1_0", { roundId: "R1", shard: 0, last: "wired1", ticks: { wired1: { checked: false, at: "t2", by: "x@x.com", byName: "X", byUid: "mem" } } })));
await t("anyone with the tab can re-tick someone else's asset (as themselves)", assertSucceeds(tickSet(mem, "R1_0", { roundId: "R1", shard: 0, last: "wl1", ticks: { wl1: { checked: true, at: "t", by: "x@x.com", byName: "X", byUid: "mem" } } })));
await t("a save can't change a tick other than `last`", assertFails(tickSet(mem, "R1_0", { roundId: "R1", shard: 0, last: "wired1", ticks: { wired1: { checked: true, at: "t", by: "x@x.com", byName: "X", byUid: "mem" }, zz9: { checked: true, at: "t", by: "x@x.com", byName: "X", byUid: "mem" } } })));
await t("can't tick as someone else", assertFails(tickSet(mem, "R1_0", { roundId: "R1", shard: 0, last: "x9", ticks: { x9: { checked: true, at: "t", by: "x@x.com", byName: "X", byUid: "co" } } })));
await t("record id must match round + shard", assertFails(tickSet(mem, "R1_7", { roundId: "R1", shard: 0, last: "x9", ticks: { x9: { checked: true, at: "t", by: "x@x.com", byName: "X", byUid: "mem" } } })));
await t("shard must be below the round's record count", assertFails(tickSet(mem, "R1_1", { roundId: "R1", shard: 1, last: "x9", ticks: { x9: { checked: true, at: "t", by: "x@x.com", byName: "X", byUid: "mem" } } })));
await t("no extra fields in a tick", assertFails(tickSet(mem, "R1_0", { roundId: "R1", shard: 0, last: "x9", ticks: { x9: { checked: true, byUid: "mem", note: "hi" } } })));
await t("can't tick a finished round", assertFails(tickSet(mem, "R0_0", { roundId: "R0", shard: 0, last: "wired1", ticks: { wired1: { checked: true, at: "t", by: "x@x.com", byName: "X", byUid: "mem" } } })));
await t("user without the Check tab can't tick", assertFails(tickSet(as("crew"), "R1_0", { roundId: "R1", shard: 0, last: "wl2", ticks: { wl2: { checked: true, at: "t", by: "x@x.com", byName: "X", byUid: "crew" } } })));
await t("member reads a round's tick records", assertSucceeds(getDocs(query(collection(mem, "checkTicks"), where("roundId", "in", ["R1"])))));
await t("member can't clear a round's ticks", assertFails(deleteDoc(doc(mem, "checkTicks/R1_0"))));
await t("co-admin clears a round's ticks when finishing", assertSucceeds(deleteDoc(doc(co, "checkTicks/R1_0"))));
await t("co-admin finishes a round", assertSucceeds(updateDoc(doc(co, "audits/R1"), { status: "closed", summary: { total: 1, checked: 1 } })));
await t("finished rounds can't be edited", assertFails(updateDoc(doc(co, "audits/R1"), { summary: { total: 9, checked: 9 } })));
await t("co-admin reads history", assertSucceeds(getDocs(collection(co, "audits"))));
await t("member can't delete history", assertFails(deleteDoc(doc(mem, "audits/R0"))));
await t("co-admin deletes a history record", assertSucceeds(deleteDoc(doc(co, "audits/R0"))));
await t("member reports a discrepancy", assertSucceeds(setDoc(doc(mem, "discrepancies/d9"), { status: "pending", byUid: "mem", assetId: "spk1" })));
await t("member can't approve a discrepancy", assertFails(updateDoc(doc(mem, "discrepancies/d1"), { status: "approved" })));

// ---------- restricted rows ----------
const crew = as("crew");
await t("restricted: unfiltered inventory query denied", assertFails(getDocs(collection(crew, "inventory"))));
await t("restricted: scoped query allowed", assertSucceeds(getDocs(query(collection(crew, "inventory"), where("category", "in", ["Wired Mics", "Wireless Mics"])))));
await t("restricted: edit row outside edit categories denied", assertFails(updateDoc(doc(crew, "inventory/wl1"), { itemLocation: "X" })));

// ---------- admins ----------
const admin2 = as("admin2"), primary = as("primary");
await t("member can't read Log History", assertFails(getDocs(collection(mem, "logs"))));
await t("co-admin reads Log History", assertSucceeds(getDocs(collection(co, "logs"))));
await t("member can't forge a log entry", assertFails(setDoc(doc(mem, "logs/lm2"), { action: "x", byUid: "primary" })));
await t("admin toggles a single feature", assertSucceeds(updateDoc(doc(admin2, "users/mem2"), { "perm.catalogue.export": true })));
await t("admin can't edit the primary admin", assertFails(updateDoc(doc(admin2, "users/primary"), { role: "Member" })));
await t("non-primary admin can't reset the log", assertFails(deleteDoc(doc(admin2, "logs/l1"))));
await t("primary admin can reset the log", assertSucceeds(deleteDoc(doc(primary, "logs/l1"))));
{
    const b = writeBatch(admin2);
    for (let i = 0; i < 40; i++) b.set(doc(admin2, `inventory/imp${i}`), { kind: "detailed", category: "Cables", model: "XLR", condition: "Available" });
    await t("admin imports 40 assets in one batch", assertSucceeds(b.commit()));
}
// ---------- v5.0: inventory bundles + recent changes + month copies ----------
// Saves go through the app's real transaction code (public/js/bundles.js).
// Loaded in this realm (not a vm context) so its objects are plain objects to the Firestore SDK.
const B = new Function(readFileSync(new URL("../public/js/bundles.js", import.meta.url), "utf8") + "\nreturn Bundles;")();
const NS = firebase.firestore;
await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    const all = (await getDocs(collection(db, "inventory"))).docs.map(d => ({ id: d.id, ...d.data() }));
    const { bundles, meta } = B.build(all, 0);
    for (const [bid, b] of Object.entries(bundles)) await setDoc(doc(db, "invBundles/" + bid), b);
    await setDoc(doc(db, "invMeta/changes"), meta);
});
const raw = async p => { let out; await env.withSecurityRulesDisabled(async c => { out = (await getDoc(doc(c.firestore(), p))).data(); }); return out; };
const save = (who, ops, trusted = false) => { B.index.clear(); B.setTrusted(() => trusted); return B.commitTx(who, NS, ops); };
const metaSeq = async () => (await raw("invMeta/changes")).seq;
const bundleOf = async id => { const m = await raw("invMeta/changes"); const inv = await raw("inventory/" + id);
    return Object.keys(m.bundles).find(b => m.bundles[b].cat === inv.category); };

await t("bundles: co-admin edit saves asset + bundle + change record together", (async () => {
    const s0 = await metaSeq();
    await assertSucceeds(save(co, [{ op: "update", col: "inventory", id: "wired1", data: { yearOfPurchase: "2023" } }]));
    const b = await raw("invBundles/" + await bundleOf("wired1"));
    if (b.items.wired1.yearOfPurchase !== "2023" || await metaSeq() !== s0 + 1) throw new Error("bundle or seq not updated");
})());
await t("bundles: member with condition rights edits through the bundle path",
    assertSucceeds(save(as("condMem"), [{ op: "update", col: "inventory", id: "wired1", data: { condition: "On Repair" } }])));
await t("bundles: workflow write (maintenance) goes through the bundle path", assertSucceeds(save(coRO, [
    { op: "set", col: "maintenance", id: "tb1", data: { stage: "confirmed", assetId: "spk1", requestedByUid: "coRO" } },
    { op: "update", col: "inventory", id: "spk1", data: { condition: "On Repair", wfCol: "maintenance", wfRef: "tb1", wfStep: "repairing:77" } }])));
await t("bundles: member can't write a bundle entry that doesn't match the asset", (async () => {
    const bid = await bundleOf("wired1");
    const cm = as("condMem");
    await assertFails(cm.runTransaction(async tx => {
        await tx.get(cm.collection("invMeta").doc("changes"));
        tx.update(cm.collection("inventory").doc("wired1"), { condition: "Available" });
        tx.update(cm.collection("invBundles").doc(bid), new NS.FieldPath("items", "wired1", "condition"), "Faulty", "v", 99, "last", ["wired1"]);
    }));
})());
await t("bundles: member can't edit a bundle on its own", (async () => {
    const bid = await bundleOf("wired1");
    await assertFails(updateDoc(doc(mem, "invBundles/" + bid), { "items.wired1.itemLocation": "Gone", last: ["wired1"] }));
})());
await t("bundles: member can't add an asset to a bundle by hand", (async () => {
    const bid = await bundleOf("wired1");
    await assertFails(updateDoc(doc(mem, "invBundles/" + bid), { "items.fake1": { category: "Wired Mics", model: "Fake" }, last: ["fake1"] }));
})());
await t("bundles: non-Admin bulk add is split into saves of 10 and passes", assertSucceeds(save(as("bulk"),
    Array.from({ length: 13 }, (_, i) => ({ op: "set", col: "inventory", id: "gb" + i, data: { kind: "general", category: "Cables", model: "Tape " + i, qty: 1 } })))));
await t("bundles: a non-Admin write changing 11 entries at once is refused", (async () => {
    const ops = Array.from({ length: 11 }, (_, i) => ({ op: "set", col: "inventory", id: "gx" + i, data: { kind: "general", category: "Cables", model: "X", qty: 1 } }));
    B.index.clear(); B.setTrusted(() => true);           // pretend to be trusted so the client doesn't split it
    await assertFails(B.commitTx(as("bulk"), NS, ops));
})());
await t("bundles: category change moves the asset between bundles", (async () => {
    const from = await bundleOf("wl1");
    await assertSucceeds(save(co, [{ op: "update", col: "inventory", id: "wl1", data: { category: "Wired Mics" } }]));
    const old = await raw("invBundles/" + from), now = await raw("invBundles/" + await bundleOf("wl1"));
    if ("wl1" in old.items || !now.items.wl1) throw new Error("not moved");
})());
await t("bundles: admin delete removes the bundle entry", (async () => {
    const bid = await bundleOf("imp3");
    await assertSucceeds(save(as("primary"), [{ op: "delete", col: "inventory", id: "imp3" }], true));
    if ("imp3" in (await raw("invBundles/" + bid)).items) throw new Error("still in bundle");
})());
await t("bundles: restricted person reads their category's bundle", (async () => assertSucceeds(getDoc(doc(crew, "invBundles/" + await bundleOf("wired1")))))());
await t("bundles: restricted person can't read another category's bundle", (async () => assertFails(getDoc(doc(crew, "invBundles/" + await bundleOf("spk1")))))());
await t("bundles: members read the change record", assertSucceeds(getDoc(doc(mem, "invMeta/changes"))));
await t("bundles: change record can't skip ahead", (async () => {
    const m = await raw("invMeta/changes");
    await assertFails(setDoc(doc(mem, "invMeta/changes"), { ...m, seq: m.seq + 5 }));
})());
await t("bundles: members can't delete the change record", assertFails(deleteDoc(doc(mem, "invMeta/changes"))));
await t("month copy: booker saves a copy of the month", assertSucceeds(setDoc(doc(co, "availMonths/2026-11"),
    { month: "2026-11", rows: { "mem_2026-11": { uid: "mem" } }, mark: "2026-10-01T00:00:00Z", builtAt: "2026-10-21T00:00:00Z", n: 1 })));
await t("month copy: member can't read it", assertFails(getDoc(doc(mem, "availMonths/2026-11"))));
await t("month copy: member can't write it", assertFails(setDoc(doc(mem, "availMonths/2026-12"), { month: "2026-12", rows: {}, mark: "", builtAt: "", n: 0 })));
await t("month copy: id must match the month", assertFails(setDoc(doc(co, "availMonths/2026-12"), { month: "2026-11", rows: {}, mark: "", builtAt: "", n: 0 })));
await t("month copy: booker queries only changed avail docs",
    assertSucceeds(getDocs(query(collection(co, "avail"), where("month", "==", "2026-11"), where("updatedAt", ">", "2026-10-01")))));

// ---------- v5.1: people copy + updatedAt on profiles ----------
await t("people: member stamps updatedAt with their last-seen/name change", assertSucceeds(updateDoc(doc(mem, "users/mem"), { displayName: "M2", updatedAt: "2026-10-21T01:00:00Z" })));
await t("people: member still can't sneak a role change in with updatedAt", assertFails(updateDoc(doc(mem, "users/mem"), { role: "Admin", updatedAt: "2026-10-21T01:00:00Z" })));
await t("people: admin saves the full people copy", assertSucceeds(setDoc(doc(admin2, "peopleCopy/all"),
    { rows: { mem: { email: "mem@x.com", status: "active" }, pend: { email: "pend@x.com", status: "pending" } }, mark: "2026-10-21T00:00:00Z", builtAt: "2026-10-21T00:00:00Z", n: 2 })));
await t("people: admin lists only people changed since the copy", assertSucceeds(getDocs(query(collection(admin2, "users"), where("updatedAt", ">", "2026-10-20")))));
await t("people: co-admin can't read the full copy (it has pending people)", assertFails(getDoc(doc(co, "peopleCopy/all"))));
await t("people: co-admin can't write the full copy", assertFails(setDoc(doc(co, "peopleCopy/all"), { rows: {}, mark: "", builtAt: "", n: 0 })));
await t("people: co-admin saves and reads the active copy", (async () => {
    await assertSucceeds(setDoc(doc(co, "peopleCopy/active"), { rows: { mem: { status: "active" } }, mark: "2026-10-21T00:00:00Z", builtAt: "2026-10-21T00:00:00Z", n: 1 }));
    await assertSucceeds(getDoc(doc(co, "peopleCopy/active")));
})());
await t("people: co-admin lists active people changed since", assertSucceeds(getDocs(query(collection(co, "users"), where("status", "==", "active"), where("updatedAt", ">", "2026-10-20")))));
await t("people: co-admin can't list all changed people", assertFails(getDocs(query(collection(co, "users"), where("updatedAt", ">", "2026-10-20")))));
await t("people: member can't read the active copy", assertFails(getDoc(doc(mem, "peopleCopy/active"))));
await t("people: copy rejects extra fields", assertFails(setDoc(doc(admin2, "peopleCopy/all"), { rows: {}, mark: "", builtAt: "", n: 0, perm: {} })));
await t("people: only the two copy names exist", assertFails(setDoc(doc(admin2, "peopleCopy/other"), { rows: {}, mark: "", builtAt: "", n: 0 })));
await t("logs: Load older reads the next page", assertSucceeds(getDocs(query(collection(as("primary"), "logs"), where("at", "<", "2026-10-21"), orderBy("at", "desc"), limit(50)))));

// ---------- v5.3: show sign-outs linked to a calendar job, shared with its crew ----------
const newJobShow = (jobId, crewUids, by) => ({ title: "J", titleLower: "j", showDate: "2026-11-06", venue: "LT1", jobId, crewUids, createdByUid: by, status: "out",
    items: [{ name: "SM58", qty: 1, accounted: false }], missingCount: 0, history: [] });
const J4items = [{ name: "SM58", qty: 2, accounted: false }, { name: "XLR", qty: 4, accounted: false }];
await t("job show: crew member creates the job's shared sign-out", assertSucceeds(setDoc(doc(mem, "shows/job_J1"), newJobShow("J1", ["mem", "co"], "mem"))));
await t("job show: someone not on the crew can't create it", assertFails(setDoc(doc(mem2, "shows/job_J3"), newJobShow("J3", ["mem"], "mem2"))));
await t("job show: id must be job_<jobId>", assertFails(setDoc(doc(mem, "shows/X1"), newJobShow("J3", ["mem"], "mem"))));
await t("job show: crew list must match the job", assertFails(setDoc(doc(mem, "shows/job_J3"), newJobShow("J3", ["mem", "mem2"], "mem"))));
await t("job show: a plain sign-out can't carry a crew list", assertFails(setDoc(doc(mem, "shows/S5"), { status: "out", createdByUid: "mem", venue: "LT1", items: [], crewUids: ["mem", "mem2"] })));
await t("job show: second press can't overwrite the first", assertFails(setDoc(doc(as("co"), "shows/job_J1"), newJobShow("J1", ["mem", "co"], "co"))));
await t("job show: teammate (not the creator) reads it", assertSucceeds(getDoc(doc(mem2, "shows/job_J4"))));
await t("job show: crew lists their shared lists", assertSucceeds(getDocs(query(collection(mem2, "shows"), where("crewUids", "array-contains", "mem2"), where("showDate", ">=", "2026-10-01")))));
await t("job show: can't list someone else's shared lists", assertFails(getDocs(query(collection(mem2, "shows"), where("crewUids", "array-contains", "mem")))));
await t("job show: not on the crew, can't read it", assertFails(getDoc(doc(as("memAll"), "shows/job_J4"))));
await t("job show: teammate adds gear", assertSucceeds(updateDoc(doc(mem2, "shows/job_J4"), { items: [...J4items, { name: "DI box", qty: 2, accounted: false }], updatedAt: "t", updatedBy: "mem2@x.com" })));
await t("job show: teammate ticks an item back in", assertSucceeds(updateDoc(doc(mem2, "shows/job_J4"), { items: [{ ...J4items[0], accounted: true }, J4items[1], { name: "DI box", qty: 2, accounted: false }], updatedAt: "t" })));
await t("job show: lines can't be dropped", assertFails(updateDoc(doc(mem2, "shows/job_J4"), { items: [J4items[0]] })));
await t("job show: teammate can't rename it", assertFails(updateDoc(doc(mem2, "shows/job_J4"), { title: "Other" })));
await t("job show: teammate can't add people to the crew list", assertFails(updateDoc(doc(mem2, "shows/job_J4"), { crewUids: ["mem", "mem2", "memAll"] })));
await t("job show: crew member re-syncs the list's crew to the job", assertSucceeds(updateDoc(doc(mem, "shows/job_J5"), { crewUids: ["mem"], updatedAt: "t" })));
await t("job show: booker removes someone from the job and the list together", (async () => {
    const b = writeBatch(co);
    b.update(doc(co, "jobs/J4"), { crew: [{ uid: "mem", name: "mem", role: "ST" }], crewUids: ["mem"] });
    b.update(doc(co, "shows/job_J4"), { crewUids: ["mem"], updatedAt: "t" });
    await assertSucceeds(b.commit());
    await assertFails(getDoc(doc(mem2, "shows/job_J4")));
})());
await t("job show: removed teammate can't sign it in", assertFails(updateDoc(doc(mem2, "shows/job_J4"), { status: "in", signedInAt: "t", signedInBy: "x", missingCount: 0 })));
await t("job show: teammate signs it in", assertSucceeds(updateDoc(doc(co, "shows/job_J1"), { status: "in", items: [], signedInAt: "now", signedInBy: "co@x.com", missingCount: 0, history: [] })));
await t("job show: nothing changes once signed in", assertFails(updateDoc(doc(mem, "shows/job_J1"), { items: [{ name: "X", qty: 1 }] })));

// ---------- v5.3: loan return date TBC ----------
await t("loan TBC: member requests a loan with no return date", assertSucceeds(setDoc(doc(mem, "loans/L19"), { status: "requested", requestedByUid: "mem", assigned: [], returnDate: "", returnTbc: true, items: [] })));
await t("loan TBC: someone else can't set the date", assertFails(updateDoc(doc(mem2, "loans/L3"), { returnDate: "2026-12-01", returnTbc: false, history: [] })));
await t("loan TBC: borrower can't change anything else with it", assertFails(updateDoc(doc(mem, "loans/L3"), { returnDate: "2026-12-01", returnTbc: false, status: "returned" })));
await t("loan TBC: date must be a real date", assertFails(updateDoc(doc(mem, "loans/L3"), { returnDate: "soon", returnTbc: false })));
await t("loan TBC: borrower sets the return date later", assertSucceeds(updateDoc(doc(mem, "loans/L3"), { returnDate: "2026-12-01", returnTbc: false, history: [{ status: "collected" }] })));
await t("loan TBC: once dated, the borrower can't move it again", assertFails(updateDoc(doc(mem, "loans/L3"), { returnDate: "2027-01-01", returnTbc: false })));

// ---------- v5.4: Admin tools for chosen Co-Admins ----------
const condList2 = { list: [{ name: "Upgraded", short: "Upgr", color: "orange", retired: false }], updatedAt: "t", updatedBy: "c@x.com" };
await t("tools: Co-Admin with 'Edit asset conditions' saves the list", assertSucceeds(setDoc(doc(as("coCond"), "settings/conditions"), condList2)));
await t("tools: Co-Admin without it can't", assertFails(setDoc(doc(as("coPw"), "settings/conditions"), condList2)));
await t("tools: a Member ticked for it still can't", assertFails(setDoc(doc(as("memTool"), "settings/conditions"), condList2)));
await t("tools: conditions right doesn't open branding", assertFails(setDoc(doc(as("coCond"), "settings/app"), { appName: "X" })));
await t("tools: Co-Admin with 'Reset passwords' lists active people", assertSucceeds(getDocs(query(collection(as("coPw"), "users"), where("status", "==", "active")))));
await t("tools: ... and reads the active people copy", assertSucceeds(getDoc(doc(as("coPw"), "peopleCopy/active"))));
await t("tools: Co-Admin flags a member for a password reset", assertSucceeds(updateDoc(doc(as("coPw"), "users/mem3"), { mustChangePassword: true, tempPasswordSetAt: "t", tempPasswordSetBy: "copw@x.com" })));
await t("tools: ... and can undo the flag if the reset fails", assertSucceeds(updateDoc(doc(as("coPw"), "users/mem3"), { mustChangePassword: false })));
await t("tools: can't flag an Admin", assertFails(updateDoc(doc(as("coPw"), "users/admin2"), { mustChangePassword: true })));
await t("tools: can't flag a pending sign-up", assertFails(updateDoc(doc(as("coPw"), "users/pend"), { mustChangePassword: true })));
await t("tools: can't change anything else on the profile", assertFails(updateDoc(doc(as("coPw"), "users/mem3"), { mustChangePassword: true, role: "Co-Admin" })));
await t("tools: Co-Admin without the right can't flag anyone", assertFails(updateDoc(doc(as("coCond"), "users/mem3"), { mustChangePassword: true })));
await t("tools: a Member ticked for it can't flag anyone", assertFails(updateDoc(doc(as("memTool"), "users/mem3"), { mustChangePassword: true })));

await t("disabled user loses access", (async () => {
    await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), "users/co"), { status: "disabled" }));
    await assertFails(getDocs(collection(as("co"), "inventory")));
})());

await env.cleanup();
const passed = results.filter(r => r[1]).length;
console.log(`\n${passed}/${results.length} rules checks passed`);
process.exit(passed === results.length ? 0 : 1);
