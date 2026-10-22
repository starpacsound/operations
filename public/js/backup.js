// =====================================================================
// One-way backup to Google Sheets.
// After every successful Firestore write, the changed documents are queued here and POSTed to the
// Apps Script web app (apps-script/Code.gs). The queue is kept in localStorage, so if the network
// or Apps Script is down, nothing is lost: it retries every 30 s and on the next page load.
// The request carries the user's Firebase ID token; Apps Script verifies it before writing.
// Data never flows back from the Sheet into the app.
// =====================================================================
const Backup = (() => {
    const KEY = "sb_backup_outbox_v1";
    const KIND = { inventory: "asset", maintenance: "ticket", loans: "loan", shows: "show", discrepancies: "discrepancy", audits: "audit", logs: "log" };
    const url = () => String((window.APP_CONFIG && window.APP_CONFIG.sheetsWebAppUrl) || "").trim();

    let store = null;
    let lookup = () => null;              // (col, id) => cached doc, supplied by app.js
    let listener = () => {};
    let outbox = [];
    let busy = false;
    let timer = null;
    let lastError = null;
    let lastOk = null;

    const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; } };
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(outbox.slice(-5000))); } catch (e) { /* storage full or blocked */ } };
    const enabled = () => !!store && store.mode === "cloud" && !!url();
    const emit = () => listener({ enabled: enabled(), demo: !!store && store.mode !== "cloud", pending: outbox.length, busy, error: lastError, lastOk });

    function init(s, lookupFn, onStatus) {
        store = s;
        lookup = lookupFn || lookup;
        listener = onStatus || listener;
        outbox = load();
        emit();
    }

    // Turn committed store ops into backup items. Updates are merged with the cached doc so
    // the Sheet always receives the full record, not just the changed fields.
    function fromOps(ops) {
        return ops.map(o => {
            const kind = KIND[o.col];
            if (!kind) return null;
            if (o.op === "delete") return { kind, op: "delete", id: o.id, data: { ...(lookup(o.col, o.id) || {}), id: o.id } };
            const base = o.op === "set" ? {} : (lookup(o.col, o.id) || {});
            const flat = Object.fromEntries(Object.entries(o.data).filter(([k]) => !k.includes("."))); // nested paths aren't backed up
            return { kind, op: kind === "log" ? "append" : "upsert", id: o.id, data: { ...base, ...flat, id: o.id } };
        }).filter(Boolean);
    }

    function push(items) {
        if (!enabled() || !items.length) return;
        const at = new Date().toISOString();
        items.forEach(i => outbox.push({ ...i, queuedAt: at }));
        save();
        emit();
        flush();
    }

    async function flush() {
        if (busy || !enabled() || !outbox.length) return;
        busy = true;
        emit();
        try {
            while (outbox.length) {
                const batch = outbox.slice(0, 100);
                const idToken = await store.getIdToken();
                if (!idToken) break; // not signed in yet - the queue waits for the next sign-in
                // text/plain body = "simple" CORS request, so Apps Script needs no preflight handling.
                const res = await fetch(url(), { method: "POST", body: JSON.stringify({ idToken, items: batch }) });
                const out = await res.json();
                if (!out.ok) throw new Error(out.error || "Backup rejected");
                outbox.splice(0, batch.length);
                save();
            }
            if (!outbox.length) { lastError = null; lastOk = new Date().toISOString(); }
        } catch (err) {
            lastError = (err && err.message) || String(err);
            console.warn("Sheets backup failed, will retry:", lastError);
            clearTimeout(timer);
            timer = setTimeout(flush, 30000);
        } finally {
            busy = false;
            emit();
        }
    }

    // Full rewrite of the Inventory tab (Admin "Backup now" button).
    function snapshot(inventoryRows) {
        if (!enabled()) return false;
        push([{ kind: "asset", op: "snapshot", rows: inventoryRows }]);
        return true;
    }

    return { init, fromOps, push, flush, snapshot, enabled };
})();
