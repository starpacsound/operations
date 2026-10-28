// =====================================================================
// Data + auth layer.
// Cloud mode = Firebase Auth + Firestore. Demo mode (?demo in the URL) = in-memory sample data.
// Both expose the same interface, so the UI never cares which one it is talking to.
//
// Collections
//   settings/app, settings/roles   branding, role templates
//   audits/{roundId}       inventory-check rounds (open per venue -> closed with a frozen summary)
//   users/{uid}            profile, role, status, permissions
//   inventory/{id}         assets
//   maintenance/{id}       maintenance tickets (request -> confirmed -> repairing -> closed / rejected)
//   loans/{id}             equipment loans (requested -> approved -> collected -> returnRequested -> returned)
//   shows/{id}             show sign-out lists (out -> in)
//   checkTicks/{roundId}_{n}     inventory-check ticks for one round, ~200 assets per record
//   discrepancies/{id}     inventory-check reports (pending -> approved / rejected)
//   logs/{id}              audit trail (append-only)
//   invBundles/{bid}, invMeta/changes, availMonths/{YYYY-MM}   read-saving copies (see bundles.js)
//
// Updates may use dotted paths ("perm.logs.view": true) for nested fields.
// =====================================================================
const FORCE_DEMO = new URLSearchParams(location.search).has("demo");
const clone = o => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------------
// Firebase
// ---------------------------------------------------------------------
function createFirebaseStore() {
    firebase.initializeApp(window.APP_CONFIG.firebase);
    const auth = firebase.auth();
    const db = firebase.firestore();

    const query = (col, q = {}) => {
        let ref = db.collection(col);
        (q.where || []).forEach(w => { ref = ref.where(w[0], w[1], w[2]); });
        if (q.orderBy) ref = ref.orderBy(q.orderBy[0], q.orderBy[1] || "asc");
        if (q.limit) ref = ref.limit(q.limit);
        return ref;
    };
    const rows = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const store = {
        mode: "cloud",
        onAuth: cb => auth.onAuthStateChanged(u => cb(u ? { uid: u.uid, email: u.email, emailVerified: !!u.emailVerified } : null)),
        signIn: (email, pw) => auth.signInWithEmailAndPassword(email, pw),
        async signUp(email, pw, name, casualId) {
            const cred = await auth.createUserWithEmailAndPassword(email, pw);
            await db.collection("users").doc(cred.user.uid).set(newPendingProfile(email, name, casualId));
            try { await cred.user.sendEmailVerification(verifyLinkSettings()); } catch (e) { console.warn("Verification email not sent:", e); }
        },
        // Email verification: send the link again / check whether it has been clicked.
        sendVerification: () => auth.currentUser.sendEmailVerification(verifyLinkSettings()),
        async refreshVerification() {
            const u = auth.currentUser;
            if (!u) return false;
            await u.reload();
            if (u.emailVerified) await u.getIdToken(true);   // fresh token so the database sees "verified"
            return !!auth.currentUser.emailVerified;
        },
        resetPassword: email => auth.sendPasswordResetEmail(email),
        // Admin sets a temporary password for someone else. Browsers can't do that with Firebase Auth,
        // so it goes through the Apps Script web app (apps-script/Code.gs), which checks the caller is an Admin.
        async adminSetPassword(uid, password) {
            const url = String((window.APP_CONFIG && window.APP_CONFIG.sheetsWebAppUrl) || "").trim();
            if (!url) throw new Error("Password reset needs the Apps Script web app - paste its URL into sheetsWebAppUrl in config.js (README › Setup › 3).");
            const idToken = await auth.currentUser.getIdToken(true);
            let out;
            try {
                const res = await fetch(url, { method: "POST", body: JSON.stringify({ action: "resetPassword", idToken, uid, password }) });
                out = await res.json();
            } catch (e) { throw new Error("Couldn't reach the Apps Script web app. Check your connection and the URL in config.js."); }
            if (!out.ok) throw new Error(out.error || "Password reset failed");
        },
        // Signed-in user replaces their password (checks the current / temporary one first).
        async changePassword(current, next) {
            const u = auth.currentUser;
            await u.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(u.email, current));
            await u.updatePassword(next);
        },
        signOut: () => auth.signOut(),
        getIdToken: () => auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null),
        async ensureProfile(user) {
            const ref = db.collection("users").doc(user.uid);
            const snap = await ref.get();
            if (!snap.exists) await ref.set(newPendingProfile(user.email, ""));
        },
        watchDoc: (col, id, cb, onErr) =>
            db.collection(col).doc(id).onSnapshot(s => { if (!s.metadata.fromCache && !s.metadata.hasPendingWrites) ReadStats.add(col, 1); cb(s.exists ? { id: s.id, ...s.data() } : null); }, onErr),
        // Second argument: true while the answer comes only from what this browser already holds (not yet confirmed by the server).
        watchCol: (col, q, cb, onErr) => {
            let served = false;
            return query(col, q).onSnapshot(s => {
                if (!s.metadata.fromCache) { ReadStats.add(col, served ? s.docChanges().filter(c => !c.doc.metadata.hasPendingWrites).length : s.size || 1); served = true; }
                cb(rows(s), s.metadata.fromCache);
            }, onErr);
        },
        getAll: async (col, q) => { const r = rows(await query(col, q).get()); ReadStats.add(col, r.length || 1); return r; },
        // How many docs match (1 read per 1,000 counted). Null where this SDK build can't count.
        async count(col, q) {
            const ref = query(col, q);
            if (typeof ref.count !== "function") return null;
            return (await ref.count().get()).data().count;
        },
        async getDoc(col, id) { const s = await db.collection(col).doc(id).get(); ReadStats.add(col, 1); return s.exists ? { id: s.id, ...s.data() } : null; },
        newId: col => db.collection(col).doc().id,
        // ops: [{ op: "set" | "merge" | "update" | "delete", col, id, data }]
        // Atomic up to 450 ops (Firestore caps a batch at 500); bigger jobs (imports) are chunked.
        // Saves that touch inventory also update the asset's bundle and invMeta/changes, in one transaction.
        // Saves to users/{uid} also stamp updatedAt and keep the people copies right (people.js).
        async commit(ops, opts) {
            ops = People.stamp(ops);
            if (ops.some(o => o.col === "inventory")) await commitWithBundles(ops, opts && opts.onProgress);
            else await store.commitPlain(ops);
            if (ops.some(o => o.col === "users")) await People.afterCommit(store, ops);
        },
        async commitPlain(ops) {
            for (let i = 0; i < ops.length; i += 450) {
                const batch = db.batch();
                ops.slice(i, i + 450).forEach(o => {
                    const ref = db.collection(o.col).doc(o.id);
                    if (o.op === "set") batch.set(ref, o.data);
                    else if (o.op === "merge") batch.set(ref, o.data, { merge: true });
                    else if (o.op === "update") batch.update(ref, o.data);
                    else if (o.op === "delete") batch.delete(ref);
                });
                await batch.commit();
            }
        },
        async deleteAll(col) {
            const all = await store.getAll(col);
            await store.commit(all.map(d => ({ op: "delete", col, id: d.id })));
            return all.length;
        }
    };

    const commitWithBundles = (ops, onProgress) => Bundles.commitTx(db, firebase.firestore, ops, onProgress);
    return store;
}

// ---------------------------------------------------------------------
// Demo (in-memory, resets on refresh, never touches the real database)
// ---------------------------------------------------------------------
// Where the "verify your email" link sends people back to.
const verifyLinkSettings = () => ({ url: location.origin + location.pathname });

function seedDemo() {
    const day = n => new Date(Date.now() - n * 86400000).toISOString();
    const dateIn = n => { const d = new Date(Date.now() + n * 86400000); return d.toLocaleDateString("en-CA"); };
    const tpl = r => resolveTemplate(r, null);
    const profile = (email, displayName, role, extra) => ({
        email, displayName, role, status: "active", isPrimary: false, ...tpl(role), createdAt: day(60), ...extra
    });

    const users = {
        "u-ken": profile("ken@showbase.com", "Ken (new crew)", "Member", { casualId: "C20900", createdAt: day(5) }),
        "u-admin": profile("admin@showbase.com", "Eugene (Host)", "Admin", { isPrimary: true, createdAt: day(120), casualId: "C10001" }),
        "u-coadmin": profile("coadmin@showbase.com", "Farah (Co-Admin)", "Co-Admin", { casualId: "C10024" }),
        "u-member": profile("member@showbase.com", "Marcus", "Member", { casualId: "C20417" }),
        "u-crew": profile("crew@showbase.com", "Priya (restricted crew)", "Member", { casualId: "C20533",
            viewCols: ["internalAssetNo", "serialNo", "itemSpace", "itemLocation", "condition", "remarks"],
            editCols: ["itemSpace", "itemLocation", "remarks", "condition"],
            viewCats: ["Wired Mics", "Wireless Mics"], editCats: ["Wired Mics"],
            perm: permWith(tpl("Member").perm, { loans: { view: false, request: false } })
        }),
        "u-pending": { ...newPendingProfile("newhire@showbase.com", "Jun (new hire)", "C20788"), createdAt: day(1), emailVerified: true },
        "u-pending2": { ...newPendingProfile("unverified@showbase.com", "Ali (hasn't verified)", "C20801"), createdAt: day(0.2) }
    };

    const inventory = {};
    let n = 0;
    const add = (category, brand, model, description, count, place, conds, year) => {
        for (let i = 1; i <= count; i++) {
            n++;
            const [space, location] = typeof place === "function" ? place(i) : place;
            inventory["demo-" + n] = {
                category, brand, model, description,
                internalAssetNo: `${model} #${i}`, assetNo: `AST-${1000 + n}`,
                serialNo: `${brand.charAt(0)}${70000 + n * 37}`, code: String(393900 + n * 13),
                itemSpace: space, itemLocation: location,
                condition: (conds && conds[i]) || "Available", remarks: "-", kind: "detailed", yearOfPurchase: year || "",
                updatedAt: day(10), updatedBy: "admin@showbase.com"
            };
        }
    };
    add("Wired Mics", "DPA", "DPA 4060", "Core Omnidirectional Lavalier", 4, ["Mic Store", "Cabinet 4"], { 2: "Deployed", 4: "Faulty" }, "2023");
    add("Wired Mics", "Shure", "SM58", "Dynamic vocal microphone, cardioid", 5, ["Mic Store", "Cabinet 2"], { 1: "Deployed", 2: "Deployed", 5: "On Repair" }, "2022");
    add("Wireless Mics", "Sennheiser", "EW-DX", "Digital wireless handheld set", 3, ["Wireless Rack", "Shelf 1"], { 3: "On Loan" }, "2025");
    add("Speakers", "Meyer Sound", "UPQ-1P", "Compact line array loudspeaker", 4, i => i <= 2 ? ["Warehouse", "Bay A"] : ["Warehouse", "Bay B"], { 1: "Deployed", 2: "Deployed", 3: "To Check" }, "2024");
    add("Mixing Consoles", "Yamaha", "CL5", "Digital mixing console", 1, ["FOH Store", "Rack 1"], null, "2021");
    add("Cables", "Neutrik", "XLR 10m", "XLR male-female balanced cable", 8, i => i <= 4 ? ["Cable Store", "Drawer 3"] : ["Cable Store", "Drawer 4"], { 6: "Missing", 7: "Decommissioned" });
    add("Accessories", "Generic", "AS-6 Drum Shield", "5.5' x 12' wide, 6-section CSP acrylic setup", 2, ["Warehouse", "Bay C"], { 1: "Faulty" }, "2026");
    // Newly bought this year and not yet given a finance code
    ["demo-26", "demo-27"].forEach(id => { inventory[id].code = ""; inventory[id].assetNo = ""; });
    // Not placed yet -> shows under "TBC" in Rack Layout
    inventory["demo-tbc"] = { category: "Stage Boxes", brand: "Klark Teknik", model: "DN16 Stage Box", description: "16-ch digital stage box",
        internalAssetNo: "DN16 #1", assetNo: "AST-1999", serialNo: "KT55120", code: "", itemSpace: "", itemLocation: "",
        condition: "Available", remarks: "Just delivered", kind: "detailed", yearOfPurchase: "2026", updatedAt: day(1), updatedBy: "admin@showbase.com" };
    // General (bulk) items: one record + quantity
    const gen = (id, category, model, description, qty, space, location, year, condition) => {
        inventory[id] = { kind: "general", category, brand: "Generic", model, description, qty,
            internalAssetNo: `${model} · bulk`, assetNo: "", serialNo: "", code: "", itemSpace: space, itemLocation: location,
            condition: condition || "Available", yearOfPurchase: year || "", remarks: "-", updatedAt: day(6), updatedBy: "coadmin@showbase.com" };
    };
    gen("gen-1", "Cables", "XLR 3m patch", "Short patch cables", 24, "Cable Store", "Drawer 5", "2025");
    gen("gen-2", "Accessories", "Mic stand (boom)", "Tripod boom stands", 10, "Mic Store", "Stand Rack", "2026");
    gen("gen-3", "Consumables", "Gaffer tape", "48 mm black cloth tape", 12, "Warehouse", "Bay C", "");

    const snap = id => {
        const a = inventory[id];
        return { assetId: id, assetLabel: a.internalAssetNo, category: a.category, brand: a.brand, model: a.model,
            internalAssetNo: a.internalAssetNo, serialNo: a.serialNo, assetNo: a.assetNo };
    };
    const maintenance = {
        "t-1": { ...snap("demo-4"), stage: "request", logType: "Fault", requestedCondition: "Faulty",
            faultDescription: "Crackling when the cable is flexed near the capsule.", newSpace: "Mic Store", newLocation: "Faulty Bin",
            maintDate: day(1).slice(0, 10), requestedBy: "member@showbase.com", requestedByName: "Marcus", requestedByUid: "u-member", requestedAt: day(1),
            history: [{ stage: "request", at: day(1), by: "member@showbase.com" }] },
        "t-2": { ...snap("demo-26"), stage: "confirmed", logType: "Fault", requestedCondition: "Faulty",
            faultDescription: "One acrylic panel cracked along the hinge.", newSpace: "", newLocation: "",
            maintDate: day(4).slice(0, 10), requestedBy: "crew@showbase.com", requestedByName: "Priya", requestedByUid: "u-crew", requestedAt: day(4),
            verifiedBy: "coadmin@showbase.com", verifiedAt: day(3), verifyNotes: "Confirmed - hinge panel needs replacing.", confirmedCondition: "Faulty",
            history: [{ stage: "request", at: day(4), by: "crew@showbase.com" }, { stage: "confirmed", at: day(3), by: "coadmin@showbase.com" }] },
        "t-3": { ...snap("demo-9"), stage: "repairing", logType: "Repair", requestedCondition: "Faulty",
            faultDescription: "Grille dented, intermittent output.", newSpace: "", newLocation: "",
            maintDate: day(18).slice(0, 10), requestedBy: "member@showbase.com", requestedByName: "Marcus", requestedByUid: "u-member", requestedAt: day(18),
            verifiedBy: "admin@showbase.com", verifiedAt: day(17), verifyNotes: "Output drops out under load.", confirmedCondition: "Faulty",
            vendor: "Audio House SG", dateSent: day(16).slice(0, 10), expectedReturn: "", sentBy: "admin@showbase.com", sentAt: day(16),
            history: [{ stage: "request", at: day(18), by: "member@showbase.com" }, { stage: "confirmed", at: day(17), by: "admin@showbase.com" },
                { stage: "repairing", at: day(16), by: "admin@showbase.com" }] },
        "t-4": { ...snap("demo-2"), stage: "repairing", logType: "Repair", requestedCondition: "Faulty",
            faultDescription: "Capsule noisy, cable strain relief split.", newSpace: "", newLocation: "",
            maintDate: day(6).slice(0, 10), requestedBy: "crew@showbase.com", requestedByName: "Priya", requestedByUid: "u-crew", requestedAt: day(6),
            verifiedBy: "coadmin@showbase.com", verifiedAt: day(5), verifyNotes: "Hiss above -30 dB, needs capsule service.", confirmedCondition: "Faulty",
            vendor: "DPA Microphones Asia", dateSent: day(4).slice(0, 10), expectedReturn: "", sendNotes: "Job #DPA-5521", sentBy: "coadmin@showbase.com", sentAt: day(4),
            history: [{ stage: "repairing", at: day(4), by: "coadmin@showbase.com" }] },
        "t-5": { ...snap("demo-23"), stage: "repairing", logType: "Repair", requestedCondition: "Faulty",
            faultDescription: "Pin 2 intermittent at the female end.", newSpace: "", newLocation: "",
            maintDate: day(28).slice(0, 10), requestedBy: "member@showbase.com", requestedByName: "Marcus", requestedByUid: "u-member", requestedAt: day(28),
            verifiedBy: "admin@showbase.com", verifiedAt: day(27), verifyNotes: "Re-solder both ends.", confirmedCondition: "Faulty",
            vendor: "Audio House SG", dateSent: day(26).slice(0, 10), expectedReturn: "", sentBy: "admin@showbase.com", sentAt: day(26),
            history: [{ stage: "repairing", at: day(26), by: "admin@showbase.com" }] }
    };
    inventory["demo-2"].condition = "On Repair";
    inventory["demo-23"].condition = "On Repair";

    const unit = id => { const a = inventory[id]; return { assetId: id, label: a.internalAssetNo, brand: a.brand, model: a.model,
        category: a.category, serialNo: a.serialNo, assetNo: a.assetNo, internalAssetNo: a.internalAssetNo, prevCondition: "Available" }; };
    const loans = {
        "loan-1": { requestedByUid: "u-member", requestedBy: "member@showbase.com", requestedByName: "Marcus", borrowerName: "Marcus (Choir CCA)", source: "request", requestedAt: day(0.3),
            items: [{ name: "Shure SM58", brand: "Shure", model: "SM58", category: "Wired Mics", qty: 2 }],
            collectDate: dateIn(3), returnDate: dateIn(6), reason: "Hall rehearsal for the welcome concert", status: "requested",
            assigned: [], history: [{ status: "requested", at: day(0.3), by: "member@showbase.com" }] },
        "loan-2": { requestedByUid: "u-member", requestedBy: "member@showbase.com", requestedByName: "Marcus", borrowerName: "Marcus", source: "request", requestedAt: day(9),
            items: [{ name: "Sennheiser EW-DX", brand: "Sennheiser", model: "EW-DX", category: "Wireless Mics", qty: 1 }],
            collectDate: day(6).slice(0, 10), returnDate: day(1).slice(0, 10), reason: "", status: "collected",
            assigned: [unit("demo-12")], approvedBy: "coadmin@showbase.com", approvedAt: day(8), collectedAt: day(6),
            history: [{ status: "requested", at: day(9), by: "member@showbase.com" }, { status: "approved", at: day(8), by: "coadmin@showbase.com" },
                { status: "collected", at: day(6), by: "member@showbase.com" }] },
        "loan-3": { requestedByUid: "u-coadmin", requestedBy: "coadmin@showbase.com", requestedByName: "Farah", borrowerName: "Farah", source: "request", requestedAt: day(30),
            items: [{ name: "DPA 4060", brand: "DPA", model: "DPA 4060", category: "Wired Mics", qty: 1 }],
            collectDate: day(27).slice(0, 10), returnDate: day(24).slice(0, 10), reason: "Theatre workshop", status: "returned",
            assigned: [unit("demo-1")], approvedBy: "admin@showbase.com", approvedAt: day(29), collectedAt: day(27), returnedAt: day(24), receivedBy: "admin@showbase.com",
            history: [{ status: "requested", at: day(30), by: "coadmin@showbase.com" }, { status: "returned", at: day(24), by: "admin@showbase.com" }] },
        "loan-4": { requestedByUid: "u-coadmin", requestedBy: "coadmin@showbase.com", requestedByName: "Farah", borrowerName: "Wei Ling (Drama Club)", source: "catalogue",
            requestedAt: day(2), items: [{ name: "AS-6 Drum Shield", brand: "Generic", model: "AS-6 Drum Shield", category: "Accessories", qty: 1 }],
            collectDate: day(2).slice(0, 10), returnDate: dateIn(5), reason: "Drama Club production week", status: "collected",
            assigned: [unit("demo-27")], approvedBy: "coadmin@showbase.com", approvedAt: day(2), collectedAt: day(2),
            history: [{ status: "collected", at: day(2), by: "coadmin@showbase.com", note: "Lent from the catalogue" }] }
    };
    // v5.3: a loan with no return date yet, out for 40 days (listed on Today for loan managers)
    loans["loan-5"] = { requestedByUid: "u-coadmin", requestedBy: "coadmin@showbase.com", requestedByName: "Farah", borrowerName: "Hall 2 band room", source: "request",
        requestedAt: day(42), items: [{ name: "Gaffer tape", brand: "", model: "", category: "Consumables", qty: 4 }],
        collectDate: day(40).slice(0, 10), returnDate: "", returnTbc: true, reason: "Long-term loan", status: "collected", assigned: [],
        approvedBy: "coadmin@showbase.com", approvedAt: day(41), collectedAt: day(40),
        history: [{ status: "collected", at: day(40), by: "coadmin@showbase.com" }] };
    inventory["demo-12"].condition = "On Loan";
    inventory["demo-27"].condition = "On Loan";

    const shows = {
        "show-1": { title: "Welcome Concert 2026", titleLower: "welcome concert 2026", showDate: day(1).slice(0, 10), venue: "LT1",
            createdByUid: "u-member", createdBy: "member@showbase.com", createdByName: "Marcus", signedOutAt: day(1), status: "out",
            items: [{ name: "Shure SM58", qty: 4, accounted: false }, { name: "XLR 10m", qty: 8, accounted: false }, { name: "Mic stand (boom)", qty: 4, accounted: false }],
            missingCount: 0, history: [{ status: "out", at: day(1), by: "member@showbase.com" }] },
        "show-2": { title: "Orientation Night", titleLower: "orientation night", showDate: day(12).slice(0, 10), venue: "Nanyang Auditorium",
            createdByUid: "u-crew", createdBy: "crew@showbase.com", createdByName: "Priya", signedOutAt: day(12), status: "in",
            signedInAt: day(11), signedInBy: "crew@showbase.com",
            items: [{ name: "DPA 4060", qty: 2, accounted: true }, { name: "Gaffer tape", qty: 3, accounted: false }, { name: "Sennheiser EW-DX", qty: 2, accounted: true }],
            missingCount: 1, history: [{ status: "out", at: day(12), by: "crew@showbase.com" }, { status: "in", at: day(11), by: "crew@showbase.com" }] }
    };

    // One open round (Cable Store) with a few ticks, and one finished round in history (Mic Store)
    const audits = {
        "aud-open": { name: "October stock take", venue: "Cable Store", status: "open", shards: 1, startedBy: "coadmin@showbase.com", startedByName: "Farah", startedAt: day(2) }
    };
    const checkTicks = { "aud-open_0": { roundId: "aud-open", shard: 0, last: "gen-1", ticks: {} } };
    ["demo-19", "demo-20", "demo-21", "gen-1"].forEach((id, i) => {
        checkTicks["aud-open_0"].ticks[id] = { checked: true, at: day(1.5 - i * 0.1),
            by: i % 2 ? "crew@showbase.com" : "member@showbase.com", byName: i % 2 ? "Priya" : "Marcus", byUid: i % 2 ? "u-crew" : "u-member" };
    });
    const micItems = ["demo-1", "demo-2", "demo-3", "demo-4", "demo-5", "demo-6", "demo-7", "demo-8", "demo-9"].map((id, i) => {
        const a = inventory[id];
        const ok = ![3, 8].includes(i);
        return { id, label: a.internalAssetNo, model: `${a.brand} ${a.model}`, category: a.category, location: a.itemLocation,
            condition: a.condition, qty: 1, checked: ok, by: ok ? (i % 2 ? "Priya" : "Marcus") : "", at: ok ? day(33.2 - i * 0.02) : "" };
    });
    audits["aud-sep"] = { name: "September stock take", venue: "Mic Store", status: "closed", startedBy: "admin@showbase.com", startedByName: "Eugene (Host)",
        startedAt: day(35), closedBy: "coadmin@showbase.com", closedByName: "Farah", closedAt: day(33),
        summary: { total: micItems.length, checked: micItems.filter(x => x.checked).length, discrepancies: 1, items: micItems } };

    const discrepancies = {
        "dis-1": { assetId: "demo-22", assetLabel: "XLR 10m #4", category: "Cables", brand: "Neutrik", model: "XLR 10m",
            current: { itemSpace: "Cable Store", itemLocation: "Drawer 3", condition: "Available" },
            proposed: { itemLocation: "Drawer 4" }, missing: false, note: "Found in Drawer 4 with the 5-8 set.",
            status: "pending", by: "member@showbase.com", byName: "Marcus", byUid: "u-member", at: day(0.5) }
    };

    const settings = {
        app: { appName: window.APP_CONFIG.appName || "Showbase", logo: "" },
        roles: { "Co-Admin": BUILTIN_TEMPLATES["Co-Admin"], "Member": BUILTIN_TEMPLATES.Member },
        venues: { list: ["LT1", "LT2", "Nanyang Auditorium", "The Arc", "Hall 2 Multipurpose", "Outdoor Plaza"],
            colors: { "LT1": "#4e9be6", "LT2": "#9b6bdf", "Nanyang Auditorium": "#3fbf7f", "The Arc": "#e46fb0", "Hall 2 Multipurpose": "#2bb5b5", "Outdoor Plaza": "#7a83f0" } },
        availability: { emailOnBooking: false }
    };

    // Availability: days counted from today, grouped into month docs.
    const avail = {};
    const crewRoleTicks = {};
    const availFor = (uid, name, casualId, roles, offs, soft, conf, withdrawn) => {
        crewRoleTicks[uid] = roles;
        const at = n => { const d = new Date(); d.setDate(d.getDate() + n); const s = d.toLocaleDateString("en-CA"); return [s.slice(0, 7), s.slice(8, 10)]; };
        const put = (n, key) => {
            const [m, day] = at(n);
            const id = `${uid}_${m}`;
            const doc = avail[id] || (avail[id] = { uid, month: m, name, casualId, avail: [], soft: [], conf: [], withdrawn: [], updatedAt: day0, updatedBy: "demo" });
            if (!doc[key].includes(day)) doc[key].push(day);
            if (key !== "avail" && key !== "withdrawn" && !doc.avail.includes(day)) doc.avail.push(day);
        };
        offs.forEach(n => put(n, "avail")); soft.forEach(n => put(n, "soft")); conf.forEach(n => put(n, "conf")); withdrawn.forEach(n => put(n, "withdrawn"));
        Object.values(avail).forEach(d => ["avail", "soft", "conf", "withdrawn"].forEach(k => d[k].sort()));
    };
    const day0 = day(0);
    const withTimes = (uid, offsets, w) => offsets.forEach(n => { const d = new Date(); d.setDate(d.getDate() + n); const s = d.toLocaleDateString("en-CA"); const doc = avail[`${uid}_${s.slice(0, 7)}`]; if (doc) (doc.times = doc.times || {})[s.slice(8, 10)] = w; });
    availFor("u-member", "Marcus", "C20417", ["SE", "ST"], [1, 2, 3, 5, 8, 9, 10, 12, 15, 16, 19, 22, 23, 30, 31, 36], [3, 16], [9], []);
    availFor("u-crew", "Priya (restricted crew)", "C20533", ["CRS"], [1, 2, 4, 5, 9, 11, 13, 16, 18, 20, 25, 27], [5], [2, 13], [6]);
    withTimes("u-member", [1, 5, 12], "18:00-23:00"); withTimes("u-crew", [4, 11], "09:00-14:00");
    availFor("u-coadmin", "Farah (Co-Admin)", "C10024", ["SE", "ST", "CRS"], [2, 3, 4, 9, 10, 11, 16, 17, 18, 23, 24, 25], [], [9], []);

    // Shows / maintenance calls linked to some of those bookings (one is left without details on purpose).
    const jobs = {};
    const dateAt = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
    const crew = (uid, role) => { const u = { "u-member": ["Marcus", "C20417"], "u-crew": ["Priya (restricted crew)", "C20533"], "u-coadmin": ["Farah (Co-Admin)", "C10024"] }[uid]; return { uid, name: u[0], casualId: u[1], role }; };
    const job = (id, n, kind, title, start, end, venue, manpower, people, notes) => {
        const date = dateAt(n);
        jobs[id] = { kind, date, month: date.slice(0, 7), title, start, end, venue, manpower, notes: notes || "", crew: people, crewUids: people.map(p => p.uid),
            createdBy: "coadmin@showbase.com", createdAt: day0, updatedBy: "coadmin@showbase.com", updatedAt: day0 };
    };
    job("job-1", 9, "show", "Welcome Concert 2026", "14:00", "17:00", "LT1", [{ role: "SE", qty: 1 }, { role: "ST", qty: 2 }, { role: "CRS", qty: 2 }],
        [crew("u-member", "ST"), crew("u-coadmin", "SE")], "Crew call 1pm at loading bay");
    job("job-2", 3, "show", "Jazz Night", "19:30", "22:00", "The Arc", [{ role: "SE", qty: 1 }, { role: "CRS", qty: 1 }], [crew("u-member", "SE")]);
    job("job-3", 2, "maint", "Maintenance call", "10:00", "13:00", "Cable Store", [], [crew("u-crew", "CRS")], "Re-terminate XLRs");
    const rosterLists = { titles: ["Welcome Concert 2026", "Jazz Night", "Orientation Night"], maintTitles: ["Maintenance call"], roles: ["SE", "ST", "CRS", "NEW"], times: ["14:00", "17:00", "19:30", "22:00"] };
    settings.rosterLists = rosterLists;

    const logs = {};
    const log = (id, at, by, action, assetId, changes, note) => {
        const a = inventory[assetId] || {};
        logs[id] = { at, by, byName: by.split("@")[0], byUid: "", action, assetId, assetLabel: a.internalAssetNo || "",
            category: a.category || "", changes, note: note || "", ticketId: "" };
    };
    log("l-1", day(18), "member@showbase.com", "Maintenance request", "demo-9", [], "Grille dented, intermittent output.");
    log("l-2", day(16), "admin@showbase.com", "Sent to repair", "demo-9", [{ field: "condition", from: "Faulty", to: "On Repair" }], "Vendor: Audio House SG");
    log("l-3", day(12), "crew@showbase.com", "Show signed out", "", [], "Orientation Night - 3 items");
    log("l-4", day(8), "coadmin@showbase.com", "Loan approved", "demo-12", [{ field: "condition", from: "Available", to: "On Loan" }], "Marcus · return " + day(1).slice(0, 10));
    log("l-5", day(3), "coadmin@showbase.com", "Maintenance verified", "demo-26", [{ field: "condition", from: "To Check", to: "Faulty" }], "Confirmed - hinge panel needs replacing.");
    log("l-6", day(1), "member@showbase.com", "Maintenance request", "demo-4", [], "Crackling when the cable is flexed near the capsule.");
    log("l-6b", day(2), "coadmin@showbase.com", "Loan created from catalogue", "demo-27", [{ field: "condition", from: "Available", to: "On Loan" }], "Wei Ling (Drama Club) · return " + dateIn(5));
    log("l-7", day(0.1), "coadmin@showbase.com", "Location change", "demo-11", [{ field: "itemLocation", from: "Stage Left", to: "Shelf 1" }], "Returned after rehearsal");

    const accounts = Object.entries(users).map(([uid, u]) => ({ uid, email: u.email, password: "123", emailVerified: uid !== "u-pending2" }));
    const built = Bundles.build(Object.entries(inventory).map(([id, a]) => ({ id, ...a })), 0);
    return { data: { settings, users, inventory, maintenance, loans, shows, audits, checkTicks, discrepancies, logs, avail, crewRoles: { all: { roles: crewRoleTicks, updatedAt: day(0), updatedBy: "demo" } }, jobs, reminders: {},
        invBundles: built.bundles, invMeta: { changes: built.meta }, availMonths: {} }, accounts };
}

function setPath(obj, path, value) {
    const parts = path.split(".");
    let o = obj;
    parts.slice(0, -1).forEach(p => { if (typeof o[p] !== "object" || o[p] === null) o[p] = {}; o = o[p]; });
    o[parts[parts.length - 1]] = value;
}

function deepMerge(target, src) {
    Object.entries(src).forEach(([k, v]) => {
        if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) deepMerge(target[k], v);
        else target[k] = v;
    });
    return target;
}

function createDemoStore() {
    const { data, accounts } = seedDemo();
    const watchers = new Set();
    let authCb = null;
    let authUser = null;
    let seq = 0;

    const run = (col, q = {}) => {
        let out = Object.entries(data[col] || {}).map(([id, d]) => ({ id, ...clone(d) }));
        (q.where || []).forEach(([f, op, v]) => {
            out = out.filter(r => op === "in" ? v.includes(r[f]) : op === "==" ? r[f] === v : op === "array-contains" ? (r[f] || []).includes(v)
                : op === ">" ? r[f] !== undefined && r[f] > v : op === ">=" ? r[f] !== undefined && r[f] >= v : op === "<" ? r[f] !== undefined && r[f] < v : op === "<=" ? r[f] !== undefined && r[f] <= v : true);
        });
        if (q.orderBy) {
            const [f, dir] = q.orderBy;
            out.sort((a, b) => String(a[f] || "").localeCompare(String(b[f] || "")) * (dir === "desc" ? -1 : 1));
        }
        if (q.limit) out = out.slice(0, q.limit);
        return out;
    };
    const fire = w => {
        if (w.id) { const d = (data[w.col] || {})[w.id]; w.cb(d ? { id: w.id, ...clone(d) } : null); }
        else w.cb(run(w.col, w.q));
    };
    const watch = w => { watchers.add(w); setTimeout(() => watchers.has(w) && fire(w), 0); return () => watchers.delete(w); };
    const setAuth = u => { authUser = u; setTimeout(() => authCb && authCb(u ? { ...u } : null), 0); };

    const store = {
        mode: "demo",
        onAuth(cb) { authCb = cb; setTimeout(() => cb(authUser), 0); return () => { authCb = null; }; },
        async signIn(email, pw) {
            const a = accounts.find(x => x.email === String(email).trim().toLowerCase() && x.password === pw);
            if (!a) throw Object.assign(new Error("Invalid email or password."), { code: "auth/invalid-credential" });
            setAuth({ uid: a.uid, email: a.email, emailVerified: a.emailVerified !== false });
        },
        async signUp(email, pw, name, casualId) {
            email = String(email).trim().toLowerCase();
            if (accounts.some(a => a.email === email)) throw Object.assign(new Error("Email already registered."), { code: "auth/email-already-in-use" });
            if (String(pw).length < 6) throw Object.assign(new Error("Password should be at least 6 characters."), { code: "auth/weak-password" });
            const uid = "u-" + (++seq) + "-" + Date.now();
            accounts.push({ uid, email, password: pw, emailVerified: false });
            data.users[uid] = newPendingProfile(email, name, casualId);
            setAuth({ uid, email, emailVerified: false });
            store._notify(["users"]);
        },
        async resetPassword() { /* no-op in demo */ },
        async sendVerification() { /* no-op in demo */ },
        async refreshVerification() { const a = authUser && accounts.find(x => x.uid === authUser.uid); return !!(a && a.emailVerified !== false); },
        // Demo only: pretend the person clicked the link in their inbox.
        demoVerify() { const a = authUser && accounts.find(x => x.uid === authUser.uid); if (a) a.emailVerified = true; },
        async adminSetPassword(uid, password) {
            const a = accounts.find(x => x.uid === uid);
            if (!a) throw new Error("That person has no sign-in account.");
            a.password = password;
        },
        async changePassword(current, next) {
            const a = authUser && accounts.find(x => x.uid === authUser.uid);
            if (!a || a.password !== current) throw Object.assign(new Error("wrong"), { code: "auth/wrong-password" });
            if (String(next).length < 8) throw Object.assign(new Error("weak"), { code: "auth/weak-password" });
            a.password = next;
        },
        async signOut() { setAuth(null); },
        getIdToken: () => Promise.resolve(authUser ? "demo-token" : null),
        async ensureProfile(user) {
            if (!data.users[user.uid]) { data.users[user.uid] = newPendingProfile(user.email, ""); store._notify(["users"]); }
        },
        watchDoc: (col, id, cb) => watch({ col, id, cb }),
        watchCol: (col, q, cb) => watch({ col, q, cb }),
        getAll: async (col, q) => run(col, q),
        count: async (col, q) => run(col, q).length,
        async getDoc(col, id) { const d = (data[col] || {})[id]; return d ? { id, ...clone(d) } : null; },
        newId: col => `${col.slice(0, 3)}-${Date.now().toString(36)}-${(++seq).toString(36)}`,
        async commit(ops, opts) {
            ops = People.stamp(ops);
            const onProgress = opts && opts.onProgress, total = ops.filter(o => o.col === "inventory").length;
            let done = 0;
            if (!ops.some(o => o.col === "inventory")) {
                await store.commitPlain(ops);
                if (ops.some(o => o.col === "users")) await People.afterCommit(store, ops);
                return;
            }
            for (const part of Bundles.chunkOps(ops, 400)) {
                const meta = data.invMeta && data.invMeta.changes;
                const extra = [];
                if (meta) {
                    const current = new Map();
                    part.filter(o => o.col === "inventory" && o.op !== "set").forEach(o => current.set(o.id, data.inventory[o.id] ? clone(data.inventory[o.id]) : null));
                    const { bundleOps, meta: nextMeta } = Bundles.expand(part, clone(meta), current);
                    bundleOps.forEach(b => {
                        const cur = (data.invBundles || {})[b.bid];
                        const items = b.isNew || !cur ? {} : clone(cur.items);
                        Object.entries(b.sets).forEach(([id, d]) => { items[id] = d; });
                        b.dels.forEach(id => { delete items[id]; });
                        extra.push({ op: "set", col: "invBundles", id: b.bid, data: { cat: b.cat, v: b.v, items, last: b.last } });
                    });
                    extra.push({ op: "set", col: "invMeta", id: "changes", data: nextMeta });
                }
                await store.commitPlain([...part, ...extra]);
                done += part.filter(o => o.col === "inventory").length;
                if (onProgress) { onProgress(done, total); await new Promise(r => setTimeout(r, 0)); }
            }
        },
        async commitPlain(ops) {
            const touched = new Set();
            const next = clone(data); // apply to a copy, so a failing op leaves nothing half-done
            for (const o of ops) {
                const c = next[o.col] || (next[o.col] = {});
                if (o.op === "set") c[o.id] = clone(o.data);
                else if (o.op === "merge") c[o.id] = deepMerge(c[o.id] || {}, clone(o.data)); // like set(..., {merge:true})
                else if (o.op === "update") {
                    if (!c[o.id]) throw new Error(`No document to update: ${o.col}/${o.id}`);
                    Object.entries(clone(o.data)).forEach(([k, v]) => setPath(c[o.id], k, v));
                } else if (o.op === "delete") delete c[o.id];
                touched.add(o.col);
            }
            Object.keys(next).forEach(k => { data[k] = next[k]; });
            store._notify(touched);
        },
        async deleteAll(col) { const n = Object.keys(data[col] || {}).length; data[col] = {}; store._notify([col]); return n; },
        _notify(cols) { const s = new Set(cols); watchers.forEach(w => s.has(w.col) && fire(w)); }
    };
    return store;
}

function createStore() {
    if (!FORCE_DEMO && typeof firebase !== "undefined" && firebase.auth) {
        try { return createFirebaseStore(); }
        catch (err) { console.error("Firebase init failed, falling back to demo data:", err); }
    }
    return createDemoStore();
}
