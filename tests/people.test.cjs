// Unit tests for public/js/people.js and the saved-copy watcher in bundles.js (no browser, no Firebase).
// Run: node tests/people.test.cjs
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const read = f => fs.readFileSync(path.join(__dirname, "..", "public", "js", f), "utf8");
const ctx = { console, setTimeout, clearTimeout, Promise, Map, Set, JSON, Date };
vm.createContext(ctx);
vm.runInContext(read("bundles.js") + "\n" + read("people.js") + "\nthis.Bundles = Bundles; this.People = People;", ctx);
const P = ctx.People;

let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + name); };
const tick = () => new Promise(r => setTimeout(r, 20));
const clone = o => JSON.parse(JSON.stringify(o));

// A tiny in-memory store that counts reads like Firestore does (1 per doc returned, re-sent docs count again).
function fakeStore(docs) {
    const watchers = new Set();
    const match = (d, where) => (where || []).every(([f, op, v]) => op === "==" ? d[f] === v : op === ">" ? d[f] !== undefined && d[f] > v : true);
    const s = {
        reads: 0, writes: 0, docs,
        getDoc: async (col, id) => { s.reads++; const d = (docs[col] || {})[id]; return d ? { id, ...clone(d) } : null; },
        watchDoc: (col, id, cb) => { const w = { col, id, cb }; watchers.add(w); setTimeout(() => fire(w), 0); return () => watchers.delete(w); },
        watchCol: (col, q, cb) => { const w = { col, q, cb }; watchers.add(w); setTimeout(() => fire(w), 0); return () => watchers.delete(w); },
        async commitPlain(ops) {
            ops.forEach(o => {
                const c = docs[o.col] || (docs[o.col] = {});
                s.writes++;
                if (o.op === "delete") delete c[o.id]; else if (o.op === "update") Object.assign(c[o.id], clone(o.data)); else c[o.id] = clone(o.data);
            });
            const cols = new Set(ops.map(o => o.col));
            watchers.forEach(w => cols.has(w.col) && fire(w));
        },
        async commit(ops) { ops = P.stamp(ops); await s.commitPlain(ops); await P.afterCommit(s, ops); }
    };
    const fire = w => {
        if (!watchers.has(w)) return;
        if (w.id) { const d = (docs[w.col] || {})[w.id]; s.reads++; w.cb(d ? { id: w.id, ...clone(d) } : null); return; }
        const rows = Object.entries(docs[w.col] || {}).filter(([, d]) => match(d, w.q && w.q.where)).map(([id, d]) => ({ id, ...clone(d) }));
        s.reads += Math.max(rows.length, 1);
        w.cb(rows);
    };
    return s;
}
const iso = minsAgo => new Date(Date.now() - minsAgo * 60000).toISOString();

(async () => {
    // ---------------------------------------------------------------- stamp
    {
        const ops = P.stamp([
            { op: "update", col: "users", id: "a", data: { status: "active" } },
            { op: "update", col: "users", id: "a", data: { lastSeen: "x" } },
            { op: "delete", col: "users", id: "b" },
            { op: "set", col: "logs", id: "l", data: {} }
        ]);
        check("stamp: profile saves get updatedAt", !!ops[0].data.updatedAt);
        check("stamp: the last-seen touch on app open doesn't (so it doesn't count as a change)", !ops[1].data.updatedAt);
        check("stamp: deletes and other collections are left alone", !ops[2].data && !ops[3].data.updatedAt);
    }

    // ---------------------------------------------------------------- watch: no copy yet -> full list, then saves one
    const users = {};
    for (let i = 0; i < 300; i++) users["u" + i] = { email: `u${i}@x.com`, status: "active", updatedAt: iso(3000) };
    users.pend = { email: "pend@x.com", status: "pending", updatedAt: iso(3000) };
    const st = fakeStore({ users });
    P.setCanFix(() => true);
    let rows = [];
    let stop = P.watch(st, { all: true }, r => { rows = r; });
    await tick(); await tick();
    check("watch: with no saved copy, the whole list is read once", rows.length === 301 && st.docs.peopleCopy && st.docs.peopleCopy.all.n === 301);
    stop();

    // ---------------------------------------------------------------- reopen: 1 read for the copy + only changes
    st.reads = 0;
    stop = P.watch(st, { all: true }, r => { rows = r; });
    await tick();
    check("watch: reopening reads the copy plus nothing else when nobody changed", rows.length === 301 && st.reads <= 2);

    st.reads = 0;
    await st.commitPlain([{ op: "set", col: "users", id: "newbie", data: { email: "new@x.com", status: "pending", updatedAt: iso(0) } }]);
    await tick();
    check("watch: a new sign-up shows straight away", rows.some(r => r.id === "newbie" && r.status === "pending") && st.reads <= 2);

    await st.commit([{ op: "update", col: "users", id: "u5", data: { role: "Co-Admin" } }]);
    await tick();
    check("watch: an Admin's change to someone shows straight away", rows.find(r => r.id === "u5").role === "Co-Admin");

    await st.commit([{ op: "delete", col: "users", id: "u7" }]);
    await tick();
    check("watch: a deleted person disappears (the copy is patched)", !rows.some(r => r.id === "u7") && !st.docs.peopleCopy.all.rows.u7);
    stop();

    // ---------------------------------------------------------------- more than 30 changed -> fresh copy
    for (let i = 0; i < 40; i++) st.docs.users["u" + (100 + i)].updatedAt = iso(0);
    const before = st.docs.peopleCopy.all.builtAt;
    stop = P.watch(st, { all: true }, r => { rows = r; });
    await tick(); await tick();
    check("watch: after more than 30 changes the copy is saved again", st.docs.peopleCopy.all.builtAt !== before && st.docs.peopleCopy.all.n === rows.length);
    stop();

    // ---------------------------------------------------------------- a day old -> rebuilt
    st.docs.peopleCopy.all.builtAt = iso(25 * 60);
    stop = P.watch(st, { all: true }, r => { rows = r; });
    await tick(); await tick();
    check("watch: a copy older than a day is rebuilt from the live list", Date.now() - Date.parse(st.docs.peopleCopy.all.builtAt) < 60000);
    stop();

    // ---------------------------------------------------------------- bookers: active only
    stop = P.watch(st, { all: false }, r => { rows = r; });
    await tick(); await tick();
    check("bookers: only active people, never pending", rows.length > 0 && rows.every(r => r.status === "active") && st.docs.peopleCopy.active);
    stop();
    Object.values(st.docs.users).forEach(u => { u.updatedAt = iso(60); });   // those edits were an hour ago
    st.reads = 0;
    stop = P.watch(st, { all: false }, r => { rows = r; });
    await tick();
    check("bookers: reopening reads the active copy only", st.reads <= 2);
    await st.commit([{ op: "update", col: "users", id: "u9", data: { status: "disabled" } }]);
    await tick();
    check("bookers: someone disabled drops out of the active list", !rows.some(r => r.id === "u9") && !st.docs.peopleCopy.active.rows.u9);
    await st.commit([{ op: "update", col: "users", id: "newbie", data: { status: "active" } }]);
    await tick();
    check("bookers: someone approved appears", rows.some(r => r.id === "newbie"));
    stop();

    // ---------------------------------------------------------------- non-Admins don't patch copies
    P.setCanFix(() => false);
    const w = st.writes;
    await st.commit([{ op: "update", col: "users", id: "u11", data: { status: "disabled" } }]);
    check("afterCommit: only Admins fix the copies", st.writes === w + 1);

    console.log(`\n${pass}/${pass + fail} people checks passed`);
    process.exit(fail ? 1 : 0);
})();
