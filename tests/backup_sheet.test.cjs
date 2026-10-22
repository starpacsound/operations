// Offline test of the backup Sheet writer in apps-script/Code.gs (mock Sheet, no Google).  Run: node tests/backup_sheet.test.cjs
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "../apps-script/Code.gs"), "utf8");

class Sheet {
    constructor(name) { this.name = name; this.v = []; }
    getLastRow() { let m = 0; this.v.forEach((r, i) => { if (r && r.some(x => x !== "")) m = i + 1; }); return m; }
    getRange(r, c, nr, nc) {
        const sh = this, px = {
            setNumberFormat: () => px, setFontWeight: () => px,
            getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((sh.v[r - 1 + i] || [])[c - 1 + j] ?? ""))),
            setValues: vs => { vs.forEach((row, i) => { const R = sh.v[r - 1 + i] || (sh.v[r - 1 + i] = []); row.forEach((x, j) => { R[c - 1 + j] = x; }); }); return px; },
            clearContent: () => { for (let i = 0; i < nr; i++) { const R = sh.v[r - 1 + i]; if (R) for (let j = 0; j < nc; j++) R[c - 1 + j] = ""; } return px; }
        };
        return px;
    }
    setFrozenRows() {}
    rows() { return this.v.slice(1).filter(r => r && r.some(x => x !== "")); }
}
const sheets = {};
const SS = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)) };
const Utilities = { formatDate: (d, tz) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
} };
const ctx = { Utilities, console, JSON, Date, Object, Array, String };
vm.createContext(ctx);
vm.runInContext(src + "\nthis.applyItems_ = applyItems_; this.TABS = TABS;", ctx);

let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + name); };
const col = (tab, name) => ctx.TABS[tab].cols.indexOf(name);
const asset = (id, extra) => ({ id, category: "Cables", brand: "Generic", model: "XLR", condition: "Available", updatedAt: "2026-10-21T09:42:10.000Z", ...(extra || {}) });

ctx.applyItems_(SS, [{ kind: "asset", op: "upsert", data: asset("a1") }, { kind: "asset", op: "upsert", data: asset("a2") }, { kind: "asset", op: "upsert", data: asset("a3") }]);
const inv = sheets["Inventory"];
check("times are written in SGT", inv.rows()[0][col("asset", "updatedAt")] === "2026-10-21 17:42:10");
check("time column headers say SGT", inv.v[0][col("asset", "updatedAt")] === "updatedAt (SGT)" && inv.v[0][col("asset", "category")] === "category");

ctx.applyItems_(SS, [{ kind: "asset", op: "delete", data: { id: "a2" } }]);
const del = sheets["Deleted Inventory"];
check("a deleted asset leaves the Inventory tab", inv.rows().length === 2 && !inv.rows().some(r => r[0] === "a2"));
check("...and moves to Deleted Inventory with its details and a deletedAt time (SGT)", del && del.rows().length === 1 && del.rows()[0][0] === "a2"
    && del.rows()[0][col("asset", "model")] === "XLR" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(del.rows()[0][col("asset", "deletedAt")]));

// an older version left a deleted row (with deletedAt) in Inventory; and a3 vanished without a delete reaching the Sheet
inv.v.push(["old1", "", "Cables", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "2026-10-01T00:00:00Z"]);
ctx.applyItems_(SS, [{ kind: "asset", op: "snapshot", rows: [asset("a1"), asset("a4")] }]);
check("Backup now / nightly: Inventory holds exactly the live assets", inv.rows().map(r => r[0]).sort().join() === "a1,a4");
check("...assets no longer in the database move to Deleted Inventory", del.rows().map(r => r[0]).sort().join() === "a2,a3,old1");

ctx.applyItems_(SS, [{ kind: "log", op: "append", data: { at: "2026-10-21T16:30:00Z", action: "Asset deleted", id: "l1" } },
    { kind: "show", op: "upsert", data: { id: "s1", showDate: "2026-10-25", signedOutAt: "2026-10-21T01:00:00Z" } }]);
check("Log times are SGT (past midnight rolls to the next day)", sheets["Log"].rows()[0][col("log", "at")] === "2026-10-22 00:30:00");
check("plain dates like the show date stay as they are", sheets["Shows"].rows()[0][col("show", "showDate")] === "2026-10-25"
    && sheets["Shows"].rows()[0][col("show", "signedOutAt")] === "2026-10-21 09:00:00");

console.log(`\n${pass}/${pass + fail} backup Sheet checks passed`);
process.exit(fail ? 1 : 0);
