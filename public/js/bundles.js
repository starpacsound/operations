// =====================================================================
// Bundles: keep Firestore reads (and downloaded data) inside the free plan.
//
// INVENTORY
//   inventory/{id}        each asset on its own (unchanged; the Sheets backup and rules use it)
//   invBundles/{bid}      copies of the assets, grouped by category, up to ~2,000 per record
//                         { cat, v, items: { <assetId>: {...asset} }, last: [assetIds changed by the latest write] }
//   invMeta/changes       the "recent changes" record everyone listens to
//                         { seq, bundles: { <bid>: { cat, v, n, sz } }, recent: [{ s, b, id }], updatedAt }
//
//   Each browser keeps its own copy of the bundles (IndexedDB). On open, and on every change, the app
//   reads only invMeta/changes (1 read), then:
//     - bundles whose version hasn't moved are used from the browser copy (0 reads)
//     - bundles with a few listed edits are patched by reading just those assets (1 read each)
//     - anything else (new device, long gap, bulk import) downloads that bundle (1 read each)
//   Every save that touches inventory also updates the asset's bundle entry and invMeta/changes in
//   the same transaction (3 writes for a one-asset edit), so they can't get out of step.
//
// AVAILABILITY (Admin / Co-Admin team grid)
//   availMonths/{YYYY-MM}  every person's avail doc for that month in one record { month, rows, mark, builtAt }
//   Opening the grid reads that record (1 read) plus only the avail docs changed since it was saved.
//   When enough changes pile up, the viewer's app saves a fresh copy (1 write).
//
// PEOPLE (Admin people list, bookers' active list) works the same way: see people.js.
// =====================================================================
// Rough count of the documents this browser has read from the database since the app was opened, by collection
// (Settings shows it). Estimate: the first answer from the server counts every document, later ones the changed ones.
const ReadStats = {
    by: {},
    add(col, n) { if (n > 0) this.by[col] = (this.by[col] || 0) + n; },
    total() { return Object.values(this.by).reduce((a, b) => a + b, 0); }
};

const Bundles = (() => {
    // Per bundle. Firestore caps one record at 1 MiB and at 40,000 index entries; every field of every asset
    // counts about 2 entries unless `items` is exempt from indexing (firestore.indexes.json), so stay well under.
    const MAX_ASSETS = 800;
    const MAX_BYTES = 900000;         // leave headroom under the 1 MiB limit
    const RECENT_KEEP = 300;          // edits kept in invMeta/changes
    const BULK_PER_BUNDLE = 40;       // more edits than this to one bundle in one save = "re-download it"
    const PATCH_LIMIT = 40;           // patching more assets than this costs more than re-downloading
    const UNTRUSTED_PER_BUNDLE = 10;  // the rules check up to 10 assets per save for non-Admins

    const clone = o => JSON.parse(JSON.stringify(o));
    const bytes = o => { try { return JSON.stringify(o).length; } catch (e) { return 0; } };
    const slug = s => String(s || "General").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "general";
    const partOf = bid => parseInt(String(bid).split("-").pop(), 10) || 1;

    // ---------------------------------------------------------------- index (which bundle holds which asset)
    // Filled by the inventory watcher; the save path uses it to find an asset's current bundle.
    const index = new Map();
    let trusted = () => false;        // the app sets this to isAdmin()

    function setPath(obj, path, value) {
        const parts = path.split(".");
        let o = obj;
        parts.slice(0, -1).forEach(p => { if (typeof o[p] !== "object" || o[p] === null) o[p] = {}; o = o[p]; });
        o[parts[parts.length - 1]] = value;
    }

    // ---------------------------------------------------------------- build (Admin button + demo seed)
    // assets: [{ id, ...data }]. Returns { bundles: { bid: {cat, v, items, last} }, meta }.
    function build(assets, prevSeq) {
        const seq = (prevSeq || 0) + 1;
        const byCat = {};
        assets.forEach(a => { const c = a.category || "General"; (byCat[c] = byCat[c] || []).push(a); });
        const bundles = {}, info = {};
        const used = new Set();
        Object.keys(byCat).sort().forEach(cat => {
            let base = slug(cat);
            while (used.has(base)) base += "-x";          // two categories with the same slug
            used.add(base);
            let part = 0, cur = null;
            byCat[cat].forEach(a => {
                const { id, ...data } = a;
                const sz = bytes(data) + id.length + 8;
                if (!cur || cur.n >= MAX_ASSETS || cur.sz + sz > MAX_BYTES) {
                    part++;
                    const bid = `${base}-${part}`;
                    cur = bundles[bid] = { cat, v: seq, items: {}, last: [], n: 0, sz: 0, bid };
                }
                cur.items[id] = data; cur.n++; cur.sz += sz;
            });
        });
        Object.values(bundles).forEach(b => { info[b.bid] = { cat: b.cat, v: seq, n: b.n, sz: b.sz }; delete b.n; delete b.sz; delete b.bid; });
        return { bundles, meta: { seq, bundles: info, recent: [], updatedAt: new Date().toISOString() } };
    }

    // ---------------------------------------------------------------- save path
    // Turns the inventory ops of one commit into bundle writes + the new invMeta/changes.
    //   ops      the commit's ops (only col "inventory" ones are looked at)
    //   meta     current invMeta/changes data
    //   current  Map assetId -> current stored asset data (for update / delete ops), or null if missing
    // Returns { bundleOps: [{ bid, isNew, cat, v, sets: {id: data}, dels: [ids], last }], meta }
    function expand(ops, meta, current) {
        const seq = (meta.seq || 0) + 1;
        const info = clone(meta.bundles || {});
        const state = new Map();                 // id -> final data (null = deleted)
        ops.filter(o => o.col === "inventory").forEach(o => {
            const before = state.has(o.id) ? state.get(o.id) : (current.get(o.id) || null);
            if (o.op === "delete") state.set(o.id, null);
            else if (o.op === "set") state.set(o.id, clone(o.data));
            else {
                const next = clone(before || {});
                Object.entries(o.data).forEach(([k, v]) => setPath(next, k, v));
                state.set(o.id, next);
            }
        });

        const touched = {};                      // bid -> { sets, dels }
        const t = bid => touched[bid] || (touched[bid] = { sets: {}, dels: [] });
        const pick = (cat, sz) => {
            const mine = Object.entries(info).filter(([, b]) => b.cat === cat).sort((a, b) => partOf(a[0]) - partOf(b[0]));
            const fit = mine.find(([, b]) => (b.n || 0) < MAX_ASSETS && (b.sz || 0) + sz <= MAX_BYTES);
            if (fit) return fit[0];
            // new part: reuse the category's slug, or find a free one
            let base = mine.length ? mine[0][0].replace(/-\d+$/, "") : slug(cat);
            if (!mine.length) while (Object.keys(info).some(b => b.replace(/-\d+$/, "") === base)) base += "-x";
            const next = mine.reduce((m, [b]) => Math.max(m, partOf(b)), 0) + 1;
            const bid = `${base}-${next}`;
            info[bid] = { cat, v: seq, n: 0, sz: 0, isNew: true };
            return bid;
        };

        state.forEach((data, id) => {
            const old = current.get(id) || null;
            const oldBid = index.get(id) || (old ? findBundle(info, old.category) : null);
            const oldSz = old ? bytes(old) + id.length + 8 : 0;
            if (data === null) {
                if (oldBid && info[oldBid]) { t(oldBid).dels.push(id); info[oldBid].n = Math.max(0, (info[oldBid].n || 1) - 1); info[oldBid].sz = Math.max(0, (info[oldBid].sz || 0) - oldSz); }
                return;
            }
            const cat = data.category || "General";
            const sz = bytes(data) + id.length + 8;
            if (oldBid && info[oldBid] && info[oldBid].cat === cat) {
                t(oldBid).sets[id] = data;
                info[oldBid].sz = Math.max(0, (info[oldBid].sz || 0) + sz - oldSz);
                return;
            }
            if (oldBid && info[oldBid]) { t(oldBid).dels.push(id); info[oldBid].n = Math.max(0, (info[oldBid].n || 1) - 1); info[oldBid].sz = Math.max(0, (info[oldBid].sz || 0) - oldSz); }
            const bid = pick(cat, sz);
            t(bid).sets[id] = data;
            info[bid].n = (info[bid].n || 0) + 1;
            info[bid].sz = (info[bid].sz || 0) + sz;
        });

        const recent = (meta.recent || []).slice();
        const bundleOps = Object.entries(touched).map(([bid, ch]) => {
            const ids = [...Object.keys(ch.sets), ...ch.dels];
            const isNew = !!info[bid].isNew;
            delete info[bid].isNew;
            info[bid].v = seq;
            if (ids.length > BULK_PER_BUNDLE) recent.push({ s: seq, b: bid, id: "*" });
            else ids.forEach(id => recent.push({ s: seq, b: bid, id }));
            return { bid, isNew, cat: info[bid].cat, v: seq, sets: ch.sets, dels: ch.dels, last: ids };
        });
        // Empty bundles stay (keeping their id avoids clashes); they cost one tiny read on a new device.
        return { bundleOps, meta: { seq, bundles: info, recent: recent.slice(-RECENT_KEEP), updatedAt: new Date().toISOString() } };
    }
    function findBundle(info, cat) {
        const hits = Object.keys(info).filter(b => info[b].cat === (cat || "General"));
        return hits.length === 1 ? hits[0] : null;
    }

    // Split a commit so a non-Admin save never changes more than 10 assets (the rules check each one). Non-inventory ops ride along with the last chunk.
    function chunk(ops, size) {
        const inv = ops.filter(o => o.col === "inventory");
        const rest = ops.filter(o => o.col !== "inventory");
        const per = trusted() ? size : UNTRUSTED_PER_BUNDLE;
        const ids = [...new Set(inv.map(o => o.id))];
        if (ids.length <= per) return [ops];
        const out = [];
        for (let i = 0; i < ids.length; i += per) {
            const group = new Set(ids.slice(i, i + per));
            out.push(inv.filter(o => group.has(o.id)));
        }
        out[out.length - 1] = [...out[out.length - 1], ...rest];
        return out;
    }

    // Split a save into transactions: max `size` ops each, and (for non-Admins) max 10 assets per save.
    function chunkOps(ops, size) {
        const out = [];
        for (let i = 0; i < ops.length; i += size) out.push(...chunk(ops.slice(i, i + size), size));
        return out;
    }

    // This browser's own saved changes (seq + the full assets written). When invMeta/changes reports them, the app applies
    // them from here instead of reading the same assets back from the database.
    const ownTx = [];

    // Firestore save of ops that touch inventory: the ops + bundle entries + invMeta/changes in one
    // transaction per chunk. ns = firebase.firestore (for FieldPath / FieldValue).
    // onProgress(doneAssets, totalAssets) runs after each transaction (imports show it).
    async function commitTx(db, ns, ops, onProgress) {
        const FP = (...p) => new ns.FieldPath(...p);
        const metaRef = db.collection("invMeta").doc("changes");
        const total = ops.filter(o => o.col === "inventory").length;
        let done = 0;
        for (const part of chunkOps(ops, 400)) {
            let applied = null;
            await db.runTransaction(async t => {
                applied = null;
                const metaSnap = await t.get(metaRef);
                const current = new Map();
                if (metaSnap.exists) {
                    // Updates need the stored asset; deletes only when we don't already know its bundle.
                    const ids = [...new Set(part.filter(o => o.col === "inventory" && (o.op === "update" || o.op === "merge" || (o.op === "delete" && !index.has(o.id)))).map(o => o.id))];
                    for (const id of ids) {
                        const s = await t.get(db.collection("inventory").doc(id));
                        current.set(id, s.exists ? s.data() : null);
                    }
                }
                part.forEach(o => {
                    const ref = db.collection(o.col).doc(o.id);
                    if (o.op === "set") t.set(ref, o.data);
                    else if (o.op === "merge") t.set(ref, o.data, { merge: true });
                    else if (o.op === "update") t.update(ref, o.data);
                    else if (o.op === "delete") t.delete(ref);
                });
                if (!metaSnap.exists) return;                    // bundles not built yet: plain save
                const { bundleOps, meta } = expand(part, metaSnap.data(), current);
                applied = { seq: meta.seq, ops: bundleOps.map(b => ({ bid: b.bid, sets: b.sets, dels: b.dels })) };
                bundleOps.forEach(b => {
                    const ref = db.collection("invBundles").doc(b.bid);
                    if (b.isNew) { t.set(ref, { cat: b.cat, v: b.v, items: b.sets, last: b.last }); return; }
                    const args = [FP("v"), b.v, FP("last"), b.last];
                    Object.entries(b.sets).forEach(([id, d]) => args.push(FP("items", id), d));
                    b.dels.forEach(id => args.push(FP("items", id), ns.FieldValue.delete()));
                    t.update(ref, ...args);
                });
                t.set(metaRef, meta);
            });
            if (applied) { ownTx.push(applied); if (ownTx.length > 30) ownTx.shift(); }
            done += part.filter(o => o.col === "inventory").length;
            if (onProgress) onProgress(done, total);
        }
    }

    // ---------------------------------------------------------------- browser copy
    // IndexedDB in the real app; memory in demo (demo data resets on reload anyway).
    function makeCache(persist) {
        const mem = new Map();
        const DB = "showbase-bundles", OS = "kv";
        let dbp = null;
        const open = () => dbp || (dbp = new Promise((res, rej) => {
            try {
                const r = indexedDB.open(DB, 1);
                r.onupgradeneeded = () => r.result.createObjectStore(OS);
                r.onsuccess = () => res(r.result);
                r.onerror = () => rej(r.error);
            } catch (e) { rej(e); }
        }));
        return {
            async get(key) {
                if (!persist) return mem.has(key) ? clone(mem.get(key)) : null;
                try {
                    const db = await open();
                    return await new Promise((res, rej) => { const q = db.transaction(OS).objectStore(OS).get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); });
                } catch (e) { return null; }      // private window / storage blocked: just download
            },
            async put(key, val) {
                if (!persist) { mem.set(key, clone(val)); return; }
                try {
                    const db = await open();
                    await new Promise((res, rej) => { const tx = db.transaction(OS, "readwrite"); tx.objectStore(OS).put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
                } catch (e) { /* ignore */ }
            }
        };
    }
    let cache = null;

    // Older, finished records (closed loans, past shows) are fetched when someone asks for them and kept in this browser's
    // copy for 3 hours, so opening them again, or refreshing the page, costs no reads. fetcher() returns the rows.
    const OLD_KEEP_MS = 3 * 3600 * 1000;
    async function cachedList(store, key, fetcher, force) {
        if (!cache) cache = makeCache(store.mode === "cloud");
        const hit = force ? null : await cache.get(key);
        if (hit && hit.rows && Date.now() - hit.at < OLD_KEEP_MS) return { rows: hit.rows, at: hit.at, fromCopy: true };
        const rows = await fetcher();
        const at = Date.now();
        cache.put(key, { at, rows });
        return { rows, at, fromCopy: false };
    }
    const stats = { reads: 0, bundleDownloads: 0, assetReads: 0, fromCache: 0, legacy: false, built: false, seq: 0, bundles: 0 };

    // ---------------------------------------------------------------- read path
    // opts: { uid, cats ([] = all), projectKey }. cb(rows, info). Returns an unsubscribe function.
    // If the bundles haven't been built yet, falls back to listening to the whole inventory collection.
    function watchInventory(store, opts, cb, onErr) {
        if (!cache) cache = makeCache(store.mode === "cloud");
        const cats = opts.cats || [];
        const visible = cat => !cats.length || cats.includes(cat || "General");
        const key = `inv:${opts.projectKey || "demo"}:${opts.uid}:${cats.slice().sort().join("|")}`;
        let st = null;                    // { seq, bundles: { bid: { v, cat, items } } }
        let legacyUnsub = null, stopped = false, queue = Promise.resolve(), saveTimer = null;

        const emit = () => {
            index.clear();
            const rows = [], seen = new Set();
            Object.entries(st.bundles).forEach(([bid, b]) => Object.entries(b.items).forEach(([id, d]) => {
                if (seen.has(id) || !visible(d.category)) return;
                seen.add(id); index.set(id, bid); rows.push({ id, ...d });
            }));
            stats.bundles = Object.keys(st.bundles).length;
            cb(rows, { legacy: false });
        };
        const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => cache.put(key, st), 800); };
        const stopLegacy = () => { if (legacyUnsub) { try { legacyUnsub(); } catch (e) { /* ignore */ } legacyUnsub = null; } };

        async function apply(meta) {
            if (stopped) return;
            if (!meta) {                      // not built yet: old behaviour
                stats.legacy = true; stats.built = false;
                if (!legacyUnsub) legacyUnsub = store.watchCol("inventory", cats.length ? { where: [["category", "in", cats.slice(0, 30)]] } : {},
                    rows => { index.clear(); cb(rows, { legacy: true }); }, onErr);
                return;
            }
            stopLegacy();
            stats.legacy = false; stats.built = true; stats.seq = meta.seq;
            stats.reads++;                    // the invMeta/changes read itself
            if (!st) st = (await cache.get(key)) || { seq: -1, bundles: {} };
            if (st.seq > meta.seq) st = { seq: -1, bundles: {} };          // database was reset
            const recent = meta.recent || [];
            const covered = st.seq >= 0 && (meta.seq === st.seq || (recent.length > 0 && recent[0].s <= st.seq + 1));
            const want = Object.entries(meta.bundles || {}).filter(([, b]) => visible(b.cat));
            const newer = covered ? recent.filter(e => e.s > st.seq) : [];
            // Changes this browser saved itself are applied from memory; only other people's changes are read back.
            const own = new Map(ownTx.map(x => [x.seq, x]));
            const isOwn = e => e.id !== "*" && own.has(e.s);
            const foreign = newer.filter(e => !isOwn(e));

            const download = [], patchable = [];
            want.forEach(([bid, b]) => {
                const have = st.bundles[bid];
                if (have && have.v === b.v) { stats.fromCache++; return; }
                const here = newer.filter(e => e.b === bid), mine = foreign.filter(e => e.b === bid);
                if (!have || !covered || !here.length || here.some(e => e.id === "*") || mine.length > PATCH_LIMIT) download.push(bid);
                else patchable.push(bid);
            });
            [...new Set(newer.filter(isOwn).map(e => e.s))].sort((a, b) => a - b).forEach(s => own.get(s).ops.forEach(b => {
                const tgt = st.bundles[b.bid];
                if (!tgt || download.includes(b.bid)) return;
                Object.entries(b.sets).forEach(([id, d]) => { tgt.items[id] = d; });
                b.dels.forEach(id => { delete tgt.items[id]; });
            }));
            // Assets to re-read, each with the bundle of its latest entry (an asset can move between bundles).
            const patchIds = new Map();
            foreign.forEach(e => { if (e.id !== "*" && (patchable.includes(e.b) || download.includes(e.b))) patchIds.set(e.id, e.b); });
            const toRead = [...patchIds].filter(([, bid]) => !download.includes(bid));
            if (toRead.length > PATCH_LIMIT) { patchable.forEach(bid => download.push(bid)); patchable.length = 0; }
            patchable.forEach(bid => { st.bundles[bid].v = meta.bundles[bid].v; });

            for (const bid of download) {
                const doc = await store.getDoc("invBundles", bid).catch(() => null);
                stats.reads++; stats.bundleDownloads++;
                if (doc) st.bundles[bid] = { v: doc.v, cat: doc.cat, items: doc.items || {} };
                else delete st.bundles[bid];
            }
            for (const [id, bid] of patchIds) {
                // Drop the asset from every other bundle; the bundle it now lives in gets the fresh copy.
                Object.entries(st.bundles).forEach(([b, x]) => { if (b !== bid) delete x.items[id]; });
                if (download.includes(bid)) continue;          // already fresh from the download
                const doc = await store.getDoc("inventory", id).catch(() => null);
                stats.reads++; stats.assetReads++;
                if (st.bundles[bid]) delete st.bundles[bid].items[id];
                if (doc && visible(doc.category) && st.bundles[bid]) { const { id: _, ...data } = doc; st.bundles[bid].items[id] = data; }
            }
            Object.keys(st.bundles).forEach(bid => { if (!want.some(([w]) => w === bid)) delete st.bundles[bid]; });
            st.seq = meta.seq;
            if (!stopped) { emit(); save(); }
        }

        const unsub = store.watchDoc("invMeta", "changes", meta => {
            queue = queue.then(() => apply(meta)).catch(err => { console.error("bundles", err); onErr && onErr(err); });
        }, onErr);
        return () => { stopped = true; stopLegacy(); try { unsub(); } catch (e) { /* ignore */ } clearTimeout(saveTimer); if (st) cache.put(key, st); };
    }

    // ---------------------------------------------------------------- availability month bundles
    const SKEW_MS = 10 * 60 * 1000;     // allow for clocks that are a few minutes off
    const REFRESH_AFTER = 30;           // changed docs since the copy was saved -> save a fresh copy
    const MAX_AGE_MS = 24 * 3600 * 1000;

    // One saved copy of a whole list + only the docs changed since it was saved (availability months, people).
    // spec: { copyCol, copyId, liveCol, where: [...], canWrite, extra: {...fields stored with the copy} }
    // The copy record is watched, so when someone saves a fresh copy (or an Admin removes a deleted person
    // from it) every open app picks that up for 1 read. cb(rows). Returns an unsubscribe function.
    function watchCopy(store, spec, cb, onErr) {
        const where = spec.where || [];
        let stopped = false, inner = null, innerSince = null, base = {}, changed = [], wrote = false, fullMode = false;
        const stopInner = () => { if (inner) { try { inner(); } catch (e) { /* ignore */ } inner = null; } };
        const merged = () => {
            const all = { ...base };
            changed.forEach(r => { const { id, ...d } = r; all[id] = d; });
            return Object.entries(all).map(([id, d]) => ({ id, ...d }));
        };
        const saveCopy = rows => {
            if (!spec.canWrite || wrote || stopped) return;
            const map = Object.fromEntries(rows.map(r => { const { id, ...d } = r; return [id, d]; }));
            // mark = when the copy was taken. Docs saved since then (less a 10-minute allowance for clocks
            // that are a little off) are read on top of it.
            const now = new Date().toISOString();
            const data = { ...(spec.extra || {}), rows: map, mark: now, builtAt: now, n: rows.length };
            if (bytes(data) > MAX_BYTES) return;      // too big for one record: keep reading the live list
            wrote = true;
            store.commitPlain([{ op: "set", col: spec.copyCol, id: spec.copyId, data }])
                .catch(err => console.warn(`Couldn't save the ${spec.copyCol} copy:`, err));
        };
        const full = () => {
            if (fullMode || stopped) return;
            fullMode = true; stopInner();
            // Save only what the server confirmed: a first answer from this browser's own memory can hold just a few profiles.
            inner = store.watchCol(spec.liveCol, where.length ? { where } : {}, (rows, fromCache) => { cb(rows); if (!fromCache) saveCopy(rows); }, onErr);
        };
        const outer = store.watchDoc(spec.copyCol, spec.copyId, copy => {
            if (stopped || fullMode) return;
            const fresh = copy && copy.builtAt && (Date.now() - Date.parse(copy.builtAt) < MAX_AGE_MS) && (!spec.validFrom || copy.builtAt >= spec.validFrom);
            if (!fresh) return full();
            base = copy.rows || {};
            const since = copy.mark ? new Date(Date.parse(copy.mark) - SKEW_MS).toISOString() : "";
            if (since === innerSince && inner) return cb(merged());
            stopInner(); innerSince = since; changed = [];
            let first = true;
            inner = store.watchCol(spec.liveCol, { where: [...where, ["updatedAt", ">", since]] }, rows => {
                changed = rows;
                const all = merged();
                cb(all);
                if (first && rows.length > REFRESH_AFTER) saveCopy(all);
                first = false;
            }, onErr);
        }, () => { if (!stopped) full(); });
        return () => { stopped = true; stopInner(); try { outer(); } catch (e) { /* ignore */ } };
    }

    // Team availability grid for one month. opts: { canWrite }.
    function watchAvailMonth(store, month, opts, cb, onErr) {
        return watchCopy(store, { copyCol: "availMonths", copyId: month, liveCol: "avail", where: [["month", "==", month]],
            canWrite: opts.canWrite, extra: { month } }, cb, onErr);
    }

    return {
        MAX_ASSETS, OLD_KEEP_MS, ownTx, cachedList, build, expand, chunk, chunkOps, commitTx, index, stats, watchInventory, watchAvailMonth, watchCopy,
        setTrusted(fn) { trusted = fn; },
        resetCache() { cache = null; }
    };
})();
