// Unit tests for public/js/bundles.js (no browser, no Firebase).
// Run: node tests/bundles.test.cjs
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "public", "js", "bundles.js"), "utf8");
const ctx = { console, setTimeout, clearTimeout, Promise, Map, Set, JSON, Date };
vm.createContext(ctx);
vm.runInContext(src + "\nthis.Bundles = Bundles;", ctx);
const B = ctx.Bundles;

let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + name); };
const tick = () => new Promise(r => setTimeout(r, 20));
const asset = (id, cat, extra) => ({ id, category: cat, brand: "Shure", model: "SM58", remarks: "-", ...(extra || {}) });

// ---------------------------------------------------------------- build
{
    const assets = [];
    for (let i = 0; i < 1700; i++) assets.push(asset("a" + i, "Cables"));
    assets.push(asset("m1", "Wired Mics"));
    const { bundles, meta } = B.build(assets, 0);
    check("build: a category over 800 assets is split into parts", Object.keys(bundles).filter(b => b.startsWith("cables-")).length === 3
        && Object.keys(bundles["cables-1"].items).length === 800 && Object.keys(bundles["cables-3"].items).length === 100);
    check("build: meta lists every bundle with its count", meta.seq === 1 && meta.bundles["wired-mics-1"].n === 1 && meta.bundles["cables-2"].n === 800);
    const big = []; for (let i = 0; i < 1500; i++) big.push(asset("b" + i, "Notes", { remarks: "x".repeat(800) }));
    const sized = B.build(big, 4);
    check("build: bundles also split before they reach the 1 MB record limit", Object.keys(sized.bundles).length >= 2
        && Object.values(sized.meta.bundles).every(b => b.sz <= 900000) && sized.meta.seq === 5);
}

// ---------------------------------------------------------------- expand (save path)
{
    const { meta } = B.build([asset("x1", "Cables"), asset("m1", "Wired Mics")], 0);
    B.index.clear(); B.index.set("x1", "cables-1"); B.index.set("m1", "wired-mics-1");
    const cur = new Map([["x1", { category: "Cables", brand: "Generic", model: "XLR", remarks: "-" }]]);
    let r = B.expand([{ op: "update", col: "inventory", id: "x1", data: { remarks: "frayed" } }, { op: "set", col: "logs", id: "l1", data: {} }], meta, cur);
    check("expand: an edit writes one bundle entry with the full merged asset",
        r.bundleOps.length === 1 && r.bundleOps[0].bid === "cables-1" && r.bundleOps[0].sets.x1.remarks === "frayed" && r.bundleOps[0].sets.x1.model === "XLR");
    check("expand: ...and bumps seq and the bundle version, with one recent entry", r.meta.seq === 2 && r.meta.bundles["cables-1"].v === 2
        && r.meta.recent.length === 1 && r.meta.recent[0].id === "x1" && r.bundleOps[0].last.join() === "x1");
    r = B.expand([{ op: "update", col: "inventory", id: "x1", data: { category: "Wired Mics" } }], meta, cur);
    const ops = Object.fromEntries(r.bundleOps.map(b => [b.bid, b]));
    check("expand: a category change removes from the old bundle and adds to the new one",
        ops["cables-1"].dels.join() === "x1" && ops["wired-mics-1"].sets.x1.category === "Wired Mics" && r.meta.bundles["cables-1"].n === 0 && r.meta.bundles["wired-mics-1"].n === 2);
    r = B.expand([{ op: "set", col: "inventory", id: "n1", data: { category: "Speakers", model: "K12" } }], meta, new Map());
    check("expand: a new category gets a new bundle", r.bundleOps[0].isNew && r.bundleOps[0].bid === "speakers-1" && r.meta.bundles["speakers-1"].n === 1);
    const full = JSON.parse(JSON.stringify(meta)); full.bundles["cables-1"].n = 800;
    r = B.expand([{ op: "set", col: "inventory", id: "n2", data: { category: "Cables", model: "XLR" } }], full, new Map());
    check("expand: a full bundle overflows into part 2", r.bundleOps[0].bid === "cables-2" && r.bundleOps[0].isNew);
    r = B.expand([{ op: "delete", col: "inventory", id: "m1" }], meta, new Map([["m1", { category: "Wired Mics" }]]));
    check("expand: a delete removes the bundle entry", r.bundleOps[0].dels.join() === "m1" && Object.keys(r.bundleOps[0].sets).length === 0);
    const many = Array.from({ length: 50 }, (_, i) => ({ op: "set", col: "inventory", id: "k" + i, data: { category: "Cables" } }));
    r = B.expand(many, meta, new Map());
    check("expand: a bulk save adds one 're-download' marker instead of 50 entries", r.meta.recent.length === 1 && r.meta.recent[0].id === "*");
    const long = JSON.parse(JSON.stringify(meta)); long.recent = Array.from({ length: 300 }, (_, i) => ({ s: 1, b: "cables-1", id: "z" + i }));
    r = B.expand([{ op: "update", col: "inventory", id: "x1", data: { remarks: "a" } }], long, cur);
    check("expand: the recent list is capped at 300", r.meta.recent.length === 300 && r.meta.recent[299].id === "x1");
}

// ---------------------------------------------------------------- chunk (rules check 5 assets per bundle for non-Admins)
{
    const ops = Array.from({ length: 23 }, (_, i) => ({ op: "set", col: "inventory", id: "c" + i, data: {} })).concat([{ op: "set", col: "logs", id: "l", data: {} }]);
    B.setTrusted(() => false);
    const parts = B.chunk(ops, 400);
    check("chunk: a non-Admin bulk save is split into saves of 10 assets", parts.length === 3 && parts[0].length === 10 && parts[2].length === 4 && parts[2].some(o => o.col === "logs"));
    B.setTrusted(() => true);
    check("chunk: an Admin save stays in one piece", B.chunk(ops, 400).length === 1);
}

// ---------------------------------------------------------------- watchInventory against a fake store
function fakeStore(docs) {
    const watchers = [];
    const s = {
        mode: "demo", reads: 0,
        docs,
        getDoc: async (col, id) => { s.reads++; const d = (docs[col] || {})[id]; if (d && d.__deny) throw new Error("permission-denied"); return d ? { id, ...JSON.parse(JSON.stringify(d)) } : null; },
        watchDoc: (col, id, cb) => { const w = { col, id, cb }; watchers.push(w); setTimeout(() => cb((docs[col] || {})[id] || null), 0); return () => {}; },
        watchCol: (col, q, cb) => { s.legacyWatched = col; setTimeout(() => cb(Object.entries(docs[col] || {}).map(([id, d]) => ({ id, ...d }))), 0); return () => {}; },
        fire: () => watchers.forEach(w => w.cb((docs[w.col] || {})[w.id] || null))
    };
    return s;
}
(async () => {
    // legacy: no invMeta yet
    {
        const st = fakeStore({ inventory: { a: { category: "Cables" } } });
        let got = null;
        B.resetCache();
        B.watchInventory(st, { uid: "u1", cats: [] }, (rows, info) => { got = { rows, info }; });
        await tick();
        check("watch: without bundles it falls back to the whole inventory", got && got.info.legacy && st.legacyWatched === "inventory" && got.rows.length === 1);
    }
    // full flow
    const assets = [asset("a1", "Cables"), asset("a2", "Cables"), asset("m1", "Wired Mics")];
    const built = B.build(assets, 0);
    const docs = { inventory: Object.fromEntries(assets.map(({ id, ...d }) => [id, d])), invBundles: built.bundles, invMeta: { changes: built.meta } };
    const st = fakeStore(docs);
    B.resetCache();
    let rows = [];
    const stop = B.watchInventory(st, { uid: "u1", cats: ["Cables"] }, r => { rows = r; });
    await tick();
    check("watch: first open downloads only the visible bundles", rows.length === 2 && st.reads === 1);
    // apply a save the way store.commit would
    const save = (ops, own) => {
        const meta = docs.invMeta.changes, cur = new Map();
        ops.filter(o => o.op !== "set").forEach(o => cur.set(o.id, docs.inventory[o.id] ? JSON.parse(JSON.stringify(docs.inventory[o.id])) : null));
        const r = B.expand(ops, meta, cur);
        ops.forEach(o => { if (o.op === "delete") delete docs.inventory[o.id]; else docs.inventory[o.id] = { ...(o.op === "set" ? {} : docs.inventory[o.id]), ...o.data }; });
        r.bundleOps.forEach(b => {
            const d = docs.invBundles[b.bid] || (docs.invBundles[b.bid] = { cat: b.cat, items: {} });
            Object.assign(d.items, b.sets); b.dels.forEach(id => delete d.items[id]); d.v = b.v;
        });
        docs.invMeta.changes = r.meta;
        if (own) B.ownTx.push({ seq: r.meta.seq, ops: r.bundleOps.map(b => ({ bid: b.bid, sets: b.sets, dels: b.dels })) });
        st.fire();
    };
    st.reads = 0;
    save([{ op: "update", col: "inventory", id: "a1", data: { remarks: "live" } }]);
    await tick();
    check("watch: a live edit costs one asset read, no bundle download", rows.find(r => r.id === "a1").remarks === "live" && st.reads === 1);
    st.reads = 0;
    save([{ op: "update", col: "inventory", id: "m1", data: { remarks: "hidden" } }]);
    await tick();
    check("watch: an edit in a category you can't see costs nothing", st.reads === 0 && !rows.some(r => r.id === "m1"));
    st.reads = 0;
    save([{ op: "update", col: "inventory", id: "m1", data: { category: "Cables" } }]);
    await tick();
    check("watch: an asset moved into your category appears", rows.some(r => r.id === "m1") && st.reads === 1);
    st.reads = 0;
    save([{ op: "update", col: "inventory", id: "a1", data: { remarks: "mine" } }], true);
    await tick();
    check("watch: an edit this browser saved itself is applied from memory, no read at all", rows.find(r => r.id === "a1").remarks === "mine" && st.reads === 0);
    st.reads = 0;
    save([{ op: "update", col: "inventory", id: "a1", data: { remarks: "mine2" } }], true);
    save([{ op: "update", col: "inventory", id: "m1", data: { remarks: "theirs" } }]);
    await tick();
    check("watch: other people's edits are still read back, even right after one of mine", rows.find(r => r.id === "a1").remarks === "mine2" && rows.find(r => r.id === "m1").remarks === "theirs" && st.reads === 1);
    save([{ op: "delete", col: "inventory", id: "a2" }]);
    await tick();
    check("watch: a deleted asset disappears", !rows.some(r => r.id === "a2") && rows.length === 2);
    stop();
    await tick(); await new Promise(r => setTimeout(r, 900));

    // same browser, later: many edits happened and the recent list no longer reaches back -> download
    for (let i = 0; i < 5; i++) save([{ op: "update", col: "inventory", id: "a1", data: { remarks: "r" + i } }]);
    docs.invMeta.changes.recent = docs.invMeta.changes.recent.slice(-1);    // simulate trimming
    st.reads = 0;
    const stop2 = B.watchInventory(st, { uid: "u1", cats: ["Cables"] }, r => { rows = r; });
    await tick();
    check("watch: when the change list doesn't reach back far enough, the bundle is downloaded", st.reads === 1 && rows.find(r => r.id === "a1").remarks === "r4");
    stop2(); await new Promise(r => setTimeout(r, 50));

    // same browser, nothing changed -> 0 reads
    st.reads = 0;
    const stop3 = B.watchInventory(st, { uid: "u1", cats: ["Cables"] }, r => { rows = r; });
    await tick();
    check("watch: reopening with nothing changed reads nothing beyond the change record", st.reads === 0 && rows.length === 2);
    stop3(); await new Promise(r => setTimeout(r, 50));

    // database rebuilt from scratch (seq went backwards) -> start over
    docs.invMeta.changes.seq = 1;
    st.reads = 0;
    B.watchInventory(st, { uid: "u1", cats: ["Cables"] }, r => { rows = r; });
    await tick();
    check("watch: a reset database (lower seq) throws the browser copy away", st.reads >= 1 && rows.length === 2);

    console.log(`\n${pass}/${pass + fail} bundle checks passed`);
    process.exit(fail ? 1 : 0);
})();
