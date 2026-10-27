// =====================================================================
// People list with few reads.
//
//   peopleCopy/all      every user profile in one record (Admins)            { rows, mark, builtAt, n }
//   peopleCopy/active   only active people (Co-Admins who book crew)          { rows, mark, builtAt, n }
//
//   Opening Users & Permissions (or the booking screens) reads the copy (1 read) plus only the
//   profiles changed since it was saved, so a new sign-up still shows straight away.
//   Every save to users/{uid} stamps updatedAt (stamp() below), except the "last seen" touch on
//   app open, so "last seen" in the list can be up to a day old.
//   When more than 30 people changed, or the copy is a day old, the viewer's app saves a fresh copy.
//   Deleting someone (or moving them out of "active") also takes them out of the copies (afterCommit),
//   because "changed since" can't see a profile that no longer matches.
// =====================================================================
const People = (() => {
    // Copies saved before this were taken by an older app that could save a partial list; they are rebuilt once.
    const VALID_FROM = "2026-10-27T06:00:00.000Z";
    let canFix = () => false;       // the app sets this to isAdmin()

    // Add updatedAt to every users write except a lone lastSeen touch.
    function stamp(ops) {
        const at = new Date().toISOString();
        return ops.map(o => {
            if (o.col !== "users" || o.op === "delete" || !o.data) return o;
            const keys = Object.keys(o.data);
            if (keys.length && keys.every(k => k === "lastSeen")) return o;
            return { ...o, data: { ...o.data, updatedAt: at } };
        });
    }

    // After a save: remove deleted people from both copies, and people who are no longer active from the active copy.
    async function afterCommit(store, ops) {
        if (!canFix()) return;
        const gone = new Set(), inactive = new Set();
        ops.forEach(o => {
            if (o.col !== "users") return;
            if (o.op === "delete") { gone.add(o.id); inactive.add(o.id); } else if (o.data && o.data.status !== undefined && o.data.status !== "active") inactive.add(o.id);
        });
        const fix = async (id, drop) => {
            if (!drop.size) return;
            const copy = await store.getDoc("peopleCopy", id);
            if (!copy || !copy.rows || ![...drop].some(uid => copy.rows[uid])) return;
            const { id: _, ...data } = copy;
            data.rows = { ...copy.rows };
            drop.forEach(uid => { delete data.rows[uid]; });
            data.n = Object.keys(data.rows).length;
            await store.commitPlain([{ op: "set", col: "peopleCopy", id, data }]);
        };
        try { await fix("all", gone); await fix("active", inactive); } catch (err) { console.warn("Couldn't update the people copy:", err); }
    }

    // Admins: everyone. Bookers: active people only (the rules only let them read those).
    function watch(store, opts, cb, onErr) {
        return Bundles.watchCopy(store, opts.all
            ? { copyCol: "peopleCopy", copyId: "all", liveCol: "users", canWrite: true, validFrom: VALID_FROM }
            : { copyCol: "peopleCopy", copyId: "active", liveCol: "users", where: [["status", "==", "active"]], canWrite: true, validFrom: VALID_FROM }, cb, onErr);
    }

    return { stamp, afterCommit, watch, setCanFix(fn) { canFix = fn; } };
})();
