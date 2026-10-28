// =====================================================================
// Shell: sign-in flow, routing, live data subscriptions, branding, badges, boot.
// Loaded last, after every module has defined its render functions.
// =====================================================================
let dataUnsubs = [];
let profileUnsub = null;
let appRunning = false;
let permKey = "";
let pendingRender = false;
let authTab = "signin";
let verifySynced = false;

const VIEWS = {
    today: { always: true, render: renderToday },
    catalogue: { tab: "catalogue", render: renderCatalogue },
    rack: { tab: "rack", render: renderRack },
    check: { tab: "check", render: renderCheck },
    maintenance: { tab: "maintenance", render: renderMaintenance },
    loans: { tab: "loans", render: renderLoans },
    shows: { tab: "shows", render: renderShows },
    availability: { tab: "avail", render: renderAvailability },
    logs: { tab: "logs", render: renderLogs },
    // Admin pages; Co-Admins given an Admin tool see just that part (v5.4).
    users: { admin: true, also: () => coTool("resetPw"), render: renderUsers },
    branding: { admin: true, also: () => coTool("conditions"), render: renderBranding },
    events: { tab: "events", render: renderEvents }
};
const canOpenView = v => { const d = VIEWS[v]; return !!d && (d.placeholder || d.always ? true : d.admin ? isAdmin() || !!(d.also && d.also()) : tabOn(d.tab)); };
const firstView = () => Object.keys(VIEWS).find(v => !VIEWS[v].placeholder && canOpenView(v)) || "events";

// =====================================================================
// AUTH
// =====================================================================
function showScreen(name) {
    ["login", "gate", "pwchange", "loading", "app"].forEach(s => $(`${s}-screen`).classList.toggle("hidden", s !== name));
}

function setAuthTab(tab) {
    authTab = tab;
    document.querySelectorAll(".seg-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".signup-only").forEach(el => el.classList.toggle("hidden", tab !== "signup"));
    document.querySelectorAll(".signin-only").forEach(el => el.classList.toggle("hidden", tab !== "signin"));
    $("auth-submit").textContent = tab === "signup" ? "Create account" : "Sign in";
    $("auth-email-label").textContent = tab === "signup" ? "Email address *" : "Email or username";
    $("auth-password").placeholder = tab === "signup" ? "At least 8 characters" : "••••••••";
    $("auth-email").placeholder = tab === "signup" ? "name@company.com" : "name@company.com or username";
    $("auth-password").autocomplete = tab === "signup" ? "new-password" : "current-password";
    authMsg("", "");
}

function authMsg(err, info) {
    $("auth-error").textContent = err || "";
    $("auth-error").classList.toggle("hidden", !err);
    $("auth-info").textContent = info || "";
    $("auth-info").classList.toggle("hidden", !info);
}

const fullTimeSignup = () => !!($("auth-fulltime") && $("auth-fulltime").checked);
function syncFullTimeTick() {
    const on = fullTimeSignup(), box = $("auth-casual");
    if (on) box.value = "";
    box.disabled = on;
    box.placeholder = on ? "Not needed for full-time staff" : "Your casual staff ID";
    const lab = document.querySelector("label[for=auth-casual]");
    if (lab) lab.textContent = on ? "Casual ID" : "Casual ID *";
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    const typed = $("auth-email").value.trim();
    const pw = $("auth-password").value;
    if (authTab === "signup") {
        // Every sign-up field is compulsory; check them top to bottom so the first gap is named.
        const name = $("auth-name").value.trim();
        if (!name) return authMsg("Enter your full name.");
        if (!fullTimeSignup() && !normCasualId($("auth-casual").value)) return authMsg("Enter your Casual ID, or tick \"I'm full-time staff\".");
        if (!typed) return authMsg("Enter your email address.");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed)) return authMsg(typed.includes("@") ? "That email address doesn't look right." : "Use your email address to create an account.");
        if (!pw) return authMsg("Choose a password.");
        if (pw.length < 8) return authMsg("Password must be at least 8 characters.");
        if (!$("auth-password2").value) return authMsg("Type the password again to confirm it.");
    }
    if (!typed || !pw) return authMsg(authTab === "signup" ? "Enter your email and password." : "Enter your email (or username) and password.");
    if (authTab === "signup" && !typed.includes("@")) return authMsg("Use your email address to create an account.");
    if (authTab === "signup" && isUsernameEmail(typed)) return authMsg("That address is reserved. Use your own email address.");
    const email = loginToEmail(typed);
    const btn = $("auth-submit");
    btn.disabled = true;
    try {
        if (authTab === "signup") {
            // Full-time staff have no Casual ID: it's saved blank and shows as "Full-time".
            const casualId = fullTimeSignup() ? "" : normCasualId($("auth-casual").value);
            if (!casualId && !fullTimeSignup()) throw new Error("Enter your Casual ID.");
            if (casualId && !CASUAL_ID_RE.test(casualId)) throw new Error("Casual ID can only use letters, numbers, - and / (up to 30 characters).");
            if (pw !== $("auth-password2").value) throw new Error("Passwords don't match.");
            if (pw.length < 8) throw new Error("Password must be at least 8 characters.");
            await store.signUp(email, pw, $("auth-name").value.trim(), casualId);
        } else {
            await store.signIn(email, pw);
        }
        authMsg("", "");
    } catch (err) {
        authMsg(friendlyError(err));
    } finally {
        btn.disabled = false;
    }
}

async function handleForgot(e) {
    e.preventDefault();
    const email = $("auth-email").value.trim();
    if (!email) return authMsg("Type your email above first, then click “Forgot password?”.");
    if (!email.includes("@") || isUsernameEmail(email))
        return authMsg("", "Username accounts can't get reset emails. The host resets it from the backup Google Sheet (menu “Showbase admin”); anyone else, ask an Admin for a temporary password.");
    try { await store.resetPassword(email); authMsg("", "If that email has an account, a reset link is on its way."); }
    catch (err) { authMsg(friendlyError(err)); }
}

function doSignOut() { idleForget(); store.signOut(); }

// ---------- auto sign-out when idle (v5.4) ----------
// Last activity sits in localStorage, so every open tab shares it (busy in one tab = active in all).
// The Admin picks the time in Settings (settings/app idleMinutes: 0 = off, default 15).
const IDLE_KEY = "sb_last_active", IDLE_WARN_MS = 60 * 1000, IDLE_OPTIONS = [0, 10, 15, 30, 60];
let idleMem = Date.now(), idleWrote = 0, idleTick = null;
const idleMinutes = () => { const m = settings.app && settings.app.idleMinutes; return m === 0 ? 0 : (+m > 0 ? +m : 15); };
function idleLast() {
    let v = 0;
    try { v = +localStorage.getItem(IDLE_KEY) || 0; } catch (e) { /* private mode */ }
    return Math.max(v, idleMem);
}
function markActive(force) {
    const now = Date.now();
    idleMem = now;
    if (force || now - idleWrote > 5000) { idleWrote = now; try { localStorage.setItem(IDLE_KEY, String(now)); } catch (e) { /* ignore */ } }
    if ($("idle-warn")) checkIdle();
}
function idleForget() { try { localStorage.removeItem(IDLE_KEY); } catch (e) { /* ignore */ } idleMem = Date.now(); }
function checkIdle() {
    const mins = idleMinutes();
    if (!appRunning || !mins || (typeof importRunning !== "undefined" && importRunning)) return idleWarn(0);
    const left = mins * 60000 - (Date.now() - idleLast());
    if (left <= 0) return idleSignOut(mins);
    idleWarn(left <= IDLE_WARN_MS ? left : 0);
}
function idleWarn(left) {
    let el = $("idle-warn");
    if (!left) { if (el) el.remove(); return; }
    if (!el) {
        el = document.createElement("div");
        el.id = "idle-warn"; el.className = "idle-warn"; el.setAttribute("role", "alert");
        el.innerHTML = `<span>No activity for a while. You'll be signed out in <b id="idle-left"></b>.</span><button type="button" class="btn btn-primary btn-sm" id="idle-stay">Stay signed in</button>`;
        document.body.appendChild(el);
        $("idle-stay").addEventListener("click", () => markActive(true));
    }
    $("idle-left").textContent = Math.ceil(left / 1000) + " s";
}
function idleSignOut(mins) {
    idleWarn(0); idleForget();
    store.signOut();
    authMsg("", `You were signed out after ${mins} minutes with no activity, to keep your account safe. Sign in again to carry on.`);
}
// A tab left closed past the limit counts as idle too: checked once when the app opens.
function idleOnStart() {
    let v = 0;
    try { v = +localStorage.getItem(IDLE_KEY) || 0; } catch (e) { /* ignore */ }
    const mins = idleMinutes();
    if (mins && v && Date.now() - v > mins * 60000) { idleSignOut(mins); return false; }
    markActive(true);
    return true;
}
["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"].forEach(t => window.addEventListener(t, () => markActive(), { passive: true, capture: true }));
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkIdle(); });
idleTick = setInterval(checkIdle, 5000);

function teardown() {
    stopData();
    if (profileUnsub) { profileUnsub(); profileUnsub = null; }
    profile = null; inventory = []; tickets = []; loans = []; liveLoans = []; oldLoans = []; oldLoansAt = 0; shows = []; showsOld = []; showsOldAt = 0; availMine = []; reminders = []; askToastShown = false; availMonth = ""; availTab = "mine"; crewRoleMap = {}; myJobs = []; showOpen.clear(); stopAvailGrid(); stopMonthJobs(); settings.rosterLists = null; settings.availability = null; checks = {}; audits = []; discrepancies = []; logs = []; users = [];
    settings.roles = null; settings.venues = null; settings.conditions = null; applyConditions(null); selectedRound = null;
    Object.keys(viewScroll).forEach(k => delete viewScroll[k]);
    appRunning = false; permKey = ""; invLoaded = false; editMode = false; brandDraft = null;
    openDrawers.clear();
    closeModal(); closeImportModal(); closeDynModal();
    $("dialog-host").innerHTML = "";
    const ts = $("toast-stack"); if (ts) ts.innerHTML = "";
    $("auth-password").value = "";
}

// ---------- Email verification ----------
const needsVerify = () => !!authUser && !authUser.emailVerified && !isUsernameEmail(authUser.email);
function showVerifyGate(p) {
    showGate("✉️", "Verify your email", `We sent a link to ${p.email}. Open it (check spam / junk too), then come back and press “I've clicked the link”.`, true);
    $("verify-demo").classList.toggle("hidden", store.mode !== "demo");
}
const gateMsg = (m, bad) => { const el = $("gate-msg"); el.textContent = m; el.className = bad ? "error-msg" : "info-msg"; };
async function checkVerified() {
    const btn = $("verify-check");
    btn.disabled = true;
    try {
        if (!(await store.refreshVerification())) return gateMsg("Not verified yet - open the link in the email first. It can take a minute to arrive.", true);
        authUser.emailVerified = true;
        // Record it on the profile so Admins can see it (the rules only allow this once the email really is verified).
        await store.commit([{ op: "update", col: "users", id: authUser.uid, data: { emailVerified: true, emailVerifiedAt: nowIso() } }]).catch(() => {});
        gateMsg("Email verified ✓");
        if (profile) onProfile(profile);
    } catch (err) { gateMsg(friendlyError(err), true); }
    finally { btn.disabled = false; }
}
async function resendVerification() {
    try { await store.sendVerification(); gateMsg("Sent again. It can take a minute - check spam / junk too."); }
    catch (err) { gateMsg(err && err.code === "auth/too-many-requests" ? "Too many emails sent. Wait a few minutes, then try again." : friendlyError(err), true); }
}

// ---------- Passwords: forced change after an Admin reset, and voluntary change ----------
const PW_MIN = 8;
function pwProblem(cur, next, again) {
    if (!cur) return "Enter your current password.";
    if (next.length < PW_MIN) return `New password must be at least ${PW_MIN} characters.`;
    if (next === cur) return "Choose a password different from the current one.";
    if (next !== again) return "The new passwords don't match.";
    return "";
}
const pwError = err => ["auth/wrong-password", "auth/invalid-credential", "auth/invalid-login-credentials"].includes(err && err.code)
    ? "That current password isn't right." : err && err.code === "auth/requires-recent-login" ? "Sign out, sign in again, then retry." : friendlyError(err);

async function changeMyPassword(cur, next, forced) {
    await store.changePassword(cur, next);
    const ops = [{ op: "update", col: "users", id: authUser.uid, data: { mustChangePassword: false, passwordChangedAt: nowIso() } }];
    await store.commit(ops);
    if (!forced) await commitOps([makeLog("Password changed", { label: myEmail() }, [], "Changed by the user")]).catch(() => {});
}

function showPwChange() {
    const f = $("pwc-form");
    f.reset();
    $("pwc-error").classList.add("hidden");
    $("pwc-email").textContent = (profile && profile.email) || "";
    showScreen("pwchange");
    focusSoon($("pwc-temp"), 30);
}
async function handlePwChange(e) {
    e.preventDefault();
    const err = m => { $("pwc-error").textContent = m; $("pwc-error").classList.toggle("hidden", !m); };
    const cur = $("pwc-temp").value, next = $("pwc-new").value, again = $("pwc-new2").value;
    const bad = pwProblem(cur, next, again);
    if (bad) return err(bad);
    const btn = $("pwc-submit");
    btn.disabled = true;
    try {
        await changeMyPassword(cur, next, true);
        err("");
        toast("New password saved - welcome back");
        // The profile listener sees mustChangePassword = false and opens the app.
        commitOps([makeLog("Password changed", { label: myEmail() }, [], "Set own password after an Admin reset")]).catch(() => {});
    } catch (er) { err(pwError(er)); }
    finally { btn.disabled = false; }
}

function openChangePassword() {
    showModal({
        title: "Change password", size: "sm", body: `
        <form id="cp-form" class="form-stack" novalidate>
            <div class="field"><label for="cp-cur">Current password</label><input type="password" id="cp-cur" autocomplete="current-password"></div>
            <div class="field"><label for="cp-new">New password</label><input type="password" id="cp-new" autocomplete="new-password" placeholder="At least ${PW_MIN} characters"></div>
            <div class="field"><label for="cp-new2">Confirm new password</label><input type="password" id="cp-new2" autocomplete="new-password"></div>
            <p id="cp-error" class="error-msg hidden"></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">Save password</button></div>
        </form>`,
        onMount(root) {
            root.querySelector("#cp-form").addEventListener("submit", async e => {
                e.preventDefault();
                const err = m => { const p = root.querySelector("#cp-error"); p.textContent = m; p.classList.toggle("hidden", !m); };
                const cur = root.querySelector("#cp-cur").value, next = root.querySelector("#cp-new").value, again = root.querySelector("#cp-new2").value;
                const bad = pwProblem(cur, next, again);
                if (bad) return err(bad);
                try { await changeMyPassword(cur, next, false); closeDynModal(); toast("Password changed"); }
                catch (er) { err(pwError(er)); }
            });
            focusSoon(root.querySelector("#cp-cur"), 30);
        }
    });
}

function showGate(icon, title, text, actions) {
    $("gate-actions").classList.toggle("hidden", !actions);
    $("gate-msg").classList.add("hidden");
    $("gate-icon").textContent = icon;
    $("gate-title").textContent = title;
    $("gate-text").textContent = text;
    showScreen("gate");
}

function onProfile(p) {
    profile = p;
    if (!p) return showGate("⚠️", "No profile found", "Sign out and sign in again. If this keeps happening, contact your Admin.");
    // Email must be verified first (username logins like the host have no mailbox and are exempt).
    if (needsVerify() && p.status !== "rejected" && p.status !== "disabled") {
        stopData(); appRunning = false;
        return showVerifyGate(p);
    }
    // Verified in Firebase but the profile still says not verified (e.g. they clicked the email link,
    // then signed in again instead of pressing "I've clicked the link"): record it so Admins can approve.
    if (authUser && authUser.emailVerified && !p.emailVerified && !isUsernameEmail(authUser.email) && !verifySynced) {
        verifySynced = true;
        store.refreshVerification()
            .then(ok => ok && store.commit([{ op: "update", col: "users", id: authUser.uid, data: { emailVerified: true, emailVerifiedAt: nowIso() } }]))
            .catch(() => { verifySynced = false; });
    }
    if (p.status === "pending") {
        stopData(); appRunning = false;
        return showGate("⏳", "Awaiting approval", `Your account (${p.email}) has been created. An Admin needs to approve it and assign your role. This page updates by itself once you're approved.`);
    }
    if (p.status !== "active") {
        stopData(); appRunning = false;
        return showGate("⛔", p.status === "rejected" ? "Sign-up not approved" : "Account disabled", "Contact your System Admin if you think this is a mistake.");
    }
    if (p.mustChangePassword) {
        stopData(); appRunning = false;
        return showPwChange();
    }
    // Restart subscriptions only when something that changes *what we query* changes.
    const key = JSON.stringify([p.role, p.viewCats || [], effectivePerm(p)]);
    if (!appRunning || key !== permKey) { permKey = key; startApp(); }
    else { applyRoleVisibility(); renderAll(); }
}

function startApp() {
    if (!appRunning && !idleOnStart()) return;
    appRunning = true;
    showScreen("app");
    try { editMode = localStorage.getItem("sb_edit_" + authUser.uid) === "1"; } catch (e) { editMode = false; }
    applyRoleVisibility();
    startData();
    store.commit([{ op: "update", col: "users", id: authUser.uid, data: { lastSeen: nowIso() } }]).catch(() => {});
    const want = (location.hash || "").replace("#", "");
    switchView(canOpenView(want) ? want : firstView(), true);
}

function applyRoleVisibility() {
    $("user-display-tag").innerHTML = `<b>${esc(myName())}</b><br>${esc(loginLabel(myEmail(), profile.displayName))}<br>${esc(profile.role)}${profile.isPrimary ? " · primary admin 👑" : ""}`;
    const show = (sel, on) => document.querySelectorAll(sel).forEach(el => el.classList.toggle("hidden", !on));
    show(".primary-only", isPrimary());
    show(".editor-only", canEditNonCondition());
    show(".adder-only", can("catalogue", "addDetailed") || can("catalogue", "addGeneral"));
    show(".importer-only", can("catalogue", "import") && can("catalogue", "addDetailed"));
    show(".exporter-only", can("catalogue", "export"));
    show(".logpdf-only", can("logs", "pdf"));
    show(".rounds-only", can("check", "rounds"));
    show(".history-only", can("check", "history"));
    show(".shows-all-only", can("shows", "viewAll"));
    show(".maint-submit-only", can("maintenance", "submit"));
    show(".loan-request-only", can("loans", "request"));
    show(".show-signout-only", can("shows", "signOut"));
    document.querySelectorAll(".nav-item").forEach(a => a.classList.toggle("hidden", !canOpenView(a.dataset.view)));
    document.querySelectorAll(".nav-group").forEach(g => g.classList.toggle("hidden", !g.querySelector(".nav-item:not(.hidden)")));
    $("backup-now").classList.toggle("hidden", !(isAdmin() && Backup.enabled()));
    renderEditToggle();
}

// =====================================================================
// LIVE DATA
// =====================================================================
function setSync(state) {
    const map = { ok: ["Live sync", "ok"], demo: ["Demo data (offline)", "warn"], connecting: ["Connecting…", "warn"], error: ["Sync error", "err"], quota: ["Not live: daily limit", "err"] };
    $("sync-badge").textContent = map[state][0];
    $("sync-badge").className = "status-dot " + map[state][1];
}

let bundleTipShown = false;
function startData() {
    stopData();
    invLoaded = false; invError = false;
    setSync(store.mode === "cloud" ? "connecting" : "demo");
    const onErr = what => err => { console.error(what, err); toast(`Couldn't load ${what}: ${friendlyError(err)}`, "err"); };
    const sub = (col, q, cb, what) => dataUnsubs.push(store.watchCol(col, q, cb, onErr(what)));
    const uid = authUser.uid;

    // Row-level visibility: restricted users only subscribe to their categories (the rules require it).
    const cats = pList("viewCats");
    // Inventory comes from the bundles + this browser's saved copy (bundles.js); restricted people only get their categories.
    Bundles.setTrusted(() => isAdmin());
    const projectKey = (window.APP_CONFIG && APP_CONFIG.firebase && APP_CONFIG.firebase.projectId) || "";
    dataUnsubs.push(Bundles.watchInventory(store, { uid, cats: isAdmin() ? [] : cats, projectKey }, (rows, info) => {
        inventory = rows; invLoaded = true; invError = false; bundlesLegacy = !!(info && info.legacy);
        if (bundlesLegacy && isAdmin() && !bundleTipShown) { bundleTipShown = true; toast("Inventory bundles aren't built yet. Build them in Settings › Inventory bundles to keep reads low."); }
        if (store.mode === "cloud") setSync("ok");
        refreshDynamicDropdowns();
        requestRender();
    }, err => { invError = true; setSync("error"); onErr("inventory")(err); requestRender(true); }));

    dataUnsubs.push(store.watchDoc("settings", "roles", d => { settings.roles = d; if (currentView === "users") renderUsers(); }, () => {}));
    dataUnsubs.push(store.watchDoc("settings", "venues", d => { settings.venues = d; if (currentView === "branding") renderBranding(); }, () => {}));
    // Asset conditions: built-ins + the Admins' own (1 read).
    dataUnsubs.push(store.watchDoc("settings", "conditions", d => { settings.conditions = d; applyConditions(d); fillConditionSelects(); requestRender(); }, () => {}));
    // Maintenance: people who only submit see their own tickets (the rules enforce this).
    const OPEN_STAGES = ["request", "confirmed", "repairing"];
    const allMaint = can("maintenance", "viewAll") || can("maintenance", "viewWork") || can("maintenance", "verify") || can("maintenance", "repair");
    if (tabOn("maintenance") || can("maintenance", "submit"))
        sub("maintenance", allMaint ? { where: [["stage", "in", OPEN_STAGES]] } : { where: [["requestedByUid", "==", uid]] },
            rows => { tickets = rows.filter(t => OPEN_STAGES.includes(t.stage)); dataChanged(); }, "maintenance");
    if (tabOn("check")) {
        // Rounds: open ones for everyone with the tab, finished ones (history) only with permission.
        sub("audits", can("check", "history") ? {} : { where: [["status", "==", "open"]] }, rows => { audits = rows; syncTicks(); dataChanged(); }, "check rounds");
        sub("discrepancies", can("check", "review") ? { where: [["status", "==", "pending"]] } : { where: [["byUid", "==", uid]] }, rows => { discrepancies = rows; dataChanged(); }, "discrepancy reports");
    }
    const allLoans = can("loans", "manage") || can("loans", "viewAll");
    // Loan managers: only open loans stay live. Finished ones (returned / rejected / cancelled) are fetched when asked for and
    // kept in this browser for 3 hours (loans.js › loadFinishedLoans); one that closes while the app is open is added on the spot.
    if (allLoans) sub("loans", { where: [["status", "in", LOAN_OPEN_STATUSES]] }, rows => { liveLoans = rows; keepJustClosed(rows); mergeLoans(); }, "loans");
    else if (tabOn("loans")) sub("loans", { where: [["requestedByUid", "==", uid]] }, rows => { loans = rows; dataChanged(); }, "loans");
    // Shows: own sign-outs (or all, for full-timers), plus the shared lists of jobs I'm booked on (last 60 days on).
    // Full-timers see the last 60 days plus anything still signed out; older lists load on request (shows.js › loadOlderShows, kept 3 hours).
    let showsOwn = [], showsCrew = [], showsOut = [];
    mergeShows = () => { const m = new Map(); [...showsOwn, ...showsOut, ...showsCrew, ...showsOld].forEach(s => m.set(s.id, s)); shows = [...m.values()]; dataChanged(); };
    if (can("shows", "viewAll")) {
        sub("shows", { where: [["showDate", ">=", addDays(-SHOWS_LIVE_DAYS)]] }, rows => { showsOwn = rows; mergeShows(); }, "shows");
        sub("shows", { where: [["status", "==", "out"]] }, rows => { showsOut = rows; mergeShows(); }, "shows signed out");
    } else if (tabOn("shows")) sub("shows", { where: [["createdByUid", "==", uid]] }, rows => { showsOwn = rows; mergeShows(); }, "shows");
    if (!can("shows", "viewAll")) sub("shows", { where: [["crewUids", "array-contains", uid], ["showDate", ">=", addDays(-60)]] }, rows => { showsCrew = rows; mergeShows(); }, "your shows' gear lists");
    if (tabOn("avail")) {
        dataUnsubs.push(store.watchDoc("settings", "availability", d => { settings.availability = d; if (currentView === "availability") renderAvailability(); }, () => {}));
        if (can("avail", "edit")) sub("avail", { where: [["uid", "==", uid]] }, rows => { availMine = rows; dataChanged(); maybeAskToast(); }, "your availability");
        // Availability reminders: bookers see all (to track who was reminded); members only their own.
        if (canBook()) sub("reminders", { orderBy: ["at", "desc"], limit: 500 }, rows => { reminders = rows; dataChanged(); maybeAskToast(); }, "reminders");
        else if (can("avail", "edit")) sub("reminders", { where: [["uids", "array-contains", uid]] }, rows => { reminders = rows; dataChanged(); maybeAskToast(); }, "reminders");
        // Bookers who aren't Admin need the active people list to see who hasn't filled in yet.
        if (canBook() && !isAdmin()) dataUnsubs.push(People.watch(store, { all: false }, rows => { users = rows; dataChanged(); }, onErr("people")));
    }
    // Shows / maintenance calls I'm booked on (with teammates): Availability, Calendar and the Today card.
    sub("jobs", { where: [["crewUids", "array-contains", uid]] }, rows => { myJobs = rows; if (["availability", "events", "today"].includes(currentView)) requestRender(true); }, "your shows");
    // Crew role ticks: Admins / Co-Admins only (the rules refuse everyone else).
    if (canBook()) dataUnsubs.push(store.watchDoc("settings", "rosterLists", d => { settings.rosterLists = d; }, () => {}));
    if (canSeeAll()) {
        // All crew role ticks are one record (1 read per open, 1 per change).
        dataUnsubs.push(store.watchDoc("crewRoles", "all", d => { crewRoleMap = (d && d.roles) || {}; if (["availability", "users"].includes(currentView)) requestRender(); }, onErr("crew roles")));
    }
    // Log History loads the first time its page is opened (logs.js › startLogs), newest 50 only.
    resetLogPages();
    logWatch = () => sub("logs", { orderBy: ["at", "desc"], limit: LOG_PAGE }, rows => { onLiveLogs(rows); if (currentView === "logs") renderLogs(); }, "log history");
    // People: one saved copy + only the profiles changed since (people.js).
    People.setCanFix(() => isAdmin());
    if (isAdmin()) dataUnsubs.push(People.watch(store, { all: true }, rows => { users = rows; dataChanged(); }, onErr("users")));
    // Co-Admins who may reset passwords need the active people list (unless booking already loads it).
    else if (coTool("resetPw") && !(tabOn("avail") && canBook())) dataUnsubs.push(People.watch(store, { all: false }, rows => { users = rows; dataChanged(); }, onErr("people")));
}

// Ticks load only while Inventory Check is open (switchView starts / stops them), and only for open rounds.
// They come as a few shared records per round (rack.js › tickShard); `checks` is rebuilt as `${roundId}_${assetId}` -> tick.
let ticksUnsub = null, ticksKey = "";
function syncTicks() {
    const ids = currentView === "check" ? audits.filter(a => a.status === "open").map(a => a.id).sort().slice(0, 30) : [];
    const key = ids.join(",");
    if (key === ticksKey && (ticksUnsub || !ids.length)) return;
    stopTicks();
    ticksKey = key;
    if (!ids.length) return;
    ticksUnsub = store.watchCol("checkTicks", { where: [["roundId", "in", ids]] }, rows => {
        const next = {};
        rows.forEach(d => Object.entries(d.ticks || {}).forEach(([assetId, t]) => {
            const k = `${d.roundId}_${assetId}`;
            if (!next[k] || String(t.at) > String(next[k].at)) next[k] = { roundId: d.roundId, assetId, ...t };
        }));
        checks = next;
        if (currentView === "check") renderCheck();
    }, err => { console.error(err); toast(`Couldn't load check ticks: ${friendlyError(err)}`, "err"); });
}
function stopTicks() {
    if (ticksUnsub) { try { ticksUnsub(); } catch (e) { /* ignore */ } ticksUnsub = null; }
    ticksKey = "";
    checks = {};
}

function stopData() {
    dataUnsubs.forEach(u => { try { u(); } catch (e) { /* ignore */ } });
    dataUnsubs = [];
    stopTicks();
    stopToday();
    stopAvailGrid();
    stopMonthJobs();
}

// Any collection changed: refresh badges and the visible view (asset tables wait while someone types).
function dataChanged() { renderNavBadges(); requestRender(); }

function requestRender(force) {
    if (!profile || !appRunning) return;
    const a = document.activeElement;
    const typingInZone = a && a.matches && a.matches(".asset-zone input:not([readonly]):not([type=checkbox])");
    if (!force && typingInZone) { pendingRender = true; if (currentView === "catalogue") renderOpsStrip(); return; }
    pendingRender = false;
    if (force) { cancelAnimationFrame(renderFrame); renderFrame = 0; renderView(currentView); return; }
    // Several updates often arrive together (a save, its bundle, the change log): draw once per frame.
    if (!renderFrame) renderFrame = requestAnimationFrame(() => { renderFrame = 0; if (profile && appRunning) renderView(currentView); });
}
let renderFrame = 0;

function renderView(v) {
    const d = VIEWS[v];
    if (d && d.render) d.render();
}

function renderAll() { renderNavBadges(); requestRender(true); }

// =====================================================================
// NAVIGATION
// =====================================================================
// v5.6: each page remembers where it was scrolled to for 10 minutes (the page itself, not a refresh).
const SCROLL_KEEP_MS = 10 * 60 * 1000;
const viewScroll = {};     // view -> { y, at }
const phoneLayout = () => !!(window.matchMedia && window.matchMedia("(max-width: 900px)").matches);
const getScrollY = () => phoneLayout() ? window.scrollY : $("main").scrollTop;
const setScrollY = y => { if (phoneLayout()) window.scrollTo(0, y); else $("main").scrollTop = y; };
// Frozen bars sit under the phone top bar; the page's own bar height lets a second bar (search row) stack below it.
function syncStick() {
    const root = document.documentElement, tb = document.querySelector(".topbar");
    root.style.setProperty("--stick-top", phoneLayout() && tb ? tb.offsetHeight + "px" : "0px");
    const v = document.querySelector(".view:not(.hidden)"), st = v && v.querySelector(".stick");
    root.style.setProperty("--stick-h", st ? st.offsetHeight + "px" : "0px");
}
window.addEventListener("resize", syncStick);
if (window.ResizeObserver) { try { const ro = new ResizeObserver(syncStick); document.querySelectorAll(".view .stick").forEach(el => ro.observe(el)); } catch (e) { /* ignore */ } }

function switchView(view, silent) {
    if (!canOpenView(view)) view = firstView();
    if (appRunning && currentView && currentView !== view && $("main")) viewScroll[currentView] = { y: getScrollY(), at: Date.now() };
    // Big trees are redrawn on entry anyway; don't keep thousands of hidden rows in the page.
    if (currentView !== view) ["rack", "check"].forEach(v => { if (v === currentView && v !== view && $(`${v}-container`)) $(`${v}-container`).innerHTML = ""; });
    currentView = view;
    syncTicks();
    syncToday();
    const d = VIEWS[view];
    const panel = d.placeholder ? "placeholder" : view;
    document.querySelectorAll(".view").forEach(s => s.classList.toggle("hidden", s.id !== `view-${panel}`));
    document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.view === view));
    if (d.placeholder) $("placeholder-title").textContent = d.placeholder;
    if (location.hash !== "#" + view) history.replaceState(null, "", "#" + view);
    $("app-screen").classList.remove("nav-open");
    if (view === "branding") brandDraft = null;
    renderView(view);
    syncStick();
    if (!silent) {
        const keep = viewScroll[view], y = keep && Date.now() - keep.at < SCROLL_KEEP_MS ? keep.y : 0;
        setScrollY(y);
        // lists draw in over the next frames; put the page back once they have their height
        if (y) { requestAnimationFrame(() => { if (currentView === view) { setScrollY(y); syncStick(); requestAnimationFrame(() => { if (currentView === view) setScrollY(y); }); } }); }
    }
}

function setBadge(id, n, info) {
    const b = $(id);
    if (!b) return;
    b.textContent = n;
    b.classList.toggle("hidden", !n);
    b.classList.toggle("info", !!info);
}

function renderNavBadges() {
    if (!profile) return;
    setBadge("badge-maintenance", can("maintenance", "verify") ? visibleTickets().filter(t => t.stage === "request").length : 0);
    setBadge("badge-loans", can("loans", "manage") ? loans.filter(l => l.status === "requested" || l.status === "returnRequested").length
        : loans.filter(l => loanMine(l) && l.status === "approved").length, !can("loans", "manage"));
    setBadge("badge-check", can("check", "review") ? discrepancies.filter(d => d.status === "pending").length : 0);
    setBadge("badge-shows", shows.filter(s => s.status === "out" && (s.createdByUid === authUser.uid || onShowCrew(s))).length, true);
    setBadge("badge-avail", (can("avail", "edit") ? unseenBookings().length + pendingAsks().length : 0) + availAlerts(), true);
    setBadge("badge-users", isAdmin() ? users.filter(u => u.status === "pending").length : 0);
}

// =====================================================================
// BRANDING (applied everywhere: sidebar, topbar, login, tab title, favicon)
// =====================================================================
function applyBranding() {
    const name = appName();
    const logo = settings.app && settings.app.logo;
    document.querySelectorAll(".brand-name-text").forEach(el => { if (!el.closest(".brand-editor")) el.textContent = name; });
    document.querySelectorAll(".brand-mark").forEach(m => {
        if (m.closest(".brand-editor")) return;
        const img = m.querySelector(".brand-logo"), ini = m.querySelector(".brand-initials");
        if (!img || !ini) return;
        m.classList.toggle("has-logo", !!logo);
        img.classList.toggle("hidden", !logo);
        if (logo) img.src = logo; else img.removeAttribute("src");
        ini.classList.toggle("hidden", !!logo);
        ini.textContent = initials(name);
    });
    document.title = `${name} · Gear, Shows & Crew`;
    // iPhone "Add to Home Screen" uses these at the moment it's added: the branded logo and name.
    if ($("apple-icon")) $("apple-icon").href = logo || "icons/apple-touch-icon.png";
    const appTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appTitle) appTitle.content = name;
    let fav = $("favicon");
    if (!fav) { fav = document.createElement("link"); fav.id = "favicon"; fav.rel = "icon"; document.head.appendChild(fav); }
    fav.href = logo || `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#6cc1ea"/><text x="32" y="42" font-family="Arial" font-weight="700" font-size="26" text-anchor="middle" fill="#0d1b24">${initials(name)}</text></svg>`)}`;
}

// =====================================================================
// SHEETS BACKUP STATUS
// =====================================================================
function renderBackupBadge(s) {
    const el = $("backup-badge");
    if (!el) return;
    const set = (text, cls, title) => { el.textContent = text; el.className = "status-dot " + cls; el.title = title; };
    if (s.demo) return set("Backup: demo", "off", "Sheets backup is off in demo mode");
    if (!s.enabled) return set("Backup: off", "off", "Set sheetsWebAppUrl in js/config.js to turn on the Google Sheets backup");
    if (s.error) return set(`Backup: retrying (${s.pending})`, "err", `Last error: ${s.error}. Changes are queued in this browser and will be retried.`);
    if (s.pending || s.busy) return set(`Backup: sending ${s.pending}`, "warn", "Sending changes to Google Sheets");
    set("Backup: OK", "ok", s.lastOk ? `Last backup ${new Date(s.lastOk).toLocaleTimeString()}` : "Google Sheets backup is on");
}

async function backupNow() {
    if (!isAdmin()) return;
    if (!Backup.enabled()) return toast("Sheets backup is not configured");
    if (!(await uiConfirm({ title: "Full backup to Google Sheets?", confirmText: "Back up now",
        message: `Rewrites the Inventory tab of the backup Sheet with all ${inventory.length} current assets.` }))) return;
    Backup.snapshot(inventory.map(a => ({ ...a })));
    toast("Full inventory snapshot queued for Google Sheets");
}

// =====================================================================
// THEME (light / dark). Follows the device until the person picks one; the choice is kept per browser.
// =====================================================================
function currentTheme() {
    const t = document.documentElement.getAttribute("data-theme");
    if (t === "light" || t === "dark") return t;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
function applyThemeUi() {
    const t = currentTheme();
    document.querySelectorAll("[data-theme-toggle]").forEach(b => {
        b.querySelector(".theme-ico").textContent = t === "dark" ? "☀" : "☾";
        const l = b.querySelector(".theme-label");
        if (l) l.textContent = t === "dark" ? "Light mode" : "Dark mode";
        b.title = `Switch to ${t === "dark" ? "light" : "dark"} mode`;
        b.setAttribute("aria-label", b.title);
    });
}
function toggleTheme() {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("sb_theme", next); } catch (e) { /* ignore */ }
    applyThemeUi();
}
function initTheme() {
    try { const t = localStorage.getItem("sb_theme"); if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t); } catch (e) { /* ignore */ }
    document.querySelectorAll("[data-theme-toggle]").forEach(b => b.addEventListener("click", toggleTheme));
    if (window.matchMedia) { const mq = window.matchMedia("(prefers-color-scheme: light)"); if (mq.addEventListener) mq.addEventListener("change", applyThemeUi); }
    applyThemeUi();
}

// The condition dropdowns that live in the page (filter + asset form); rebuilt when the list changes.
function fillConditionSelects() {
    const f = $("filter-condition"), form = $("form-condition");
    const keep = [f.value, form.value];
    const opts = CONDITIONS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    f.innerHTML = `<option value="ALL">All conditions</option>` + opts;
    form.innerHTML = opts;
    if (keep[0] && [...f.options].some(o => o.value === keep[0])) f.value = keep[0];
    if (keep[1] && [...form.options].some(o => o.value === keep[1])) form.value = keep[1];
}

// =====================================================================
// BOOT
// =====================================================================
function boot() {
    initTheme();
    fillConditionSelects();

    Combo.init();
    registerComboSources();

    document.querySelectorAll(".seg-tab").forEach(b => b.addEventListener("click", () => setAuthTab(b.dataset.tab)));
    $("auth-form").addEventListener("submit", handleAuthSubmit);
    $("pwc-form").addEventListener("submit", handlePwChange);
    $("verify-check").addEventListener("click", checkVerified);
    $("verify-resend").addEventListener("click", resendVerification);
    $("verify-demo").addEventListener("click", () => { store.demoVerify(); checkVerified(); });
    $("forgot-link").addEventListener("click", handleForgot);
    document.querySelectorAll(".nav-item").forEach(a => a.addEventListener("click", e => { e.preventDefault(); switchView(a.dataset.view); }));
    window.addEventListener("hashchange", () => { const v = location.hash.replace("#", ""); if (appRunning && v !== currentView && VIEWS[v]) switchView(v); });
    $("nav-open").addEventListener("click", () => $("app-screen").classList.add("nav-open"));
    $("nav-scrim").addEventListener("click", () => $("app-screen").classList.remove("nav-open"));
    document.addEventListener("keydown", e => {
        if (e.key !== "Escape" || $("dialog-host").innerHTML) return;
        if ($("dyn-modal")) closeDynModal();
        else if (!$("asset-modal").classList.contains("hidden")) closeModal();
        else if (!$("import-modal").classList.contains("hidden")) closeImportModal();
    });

    if (store.mode === "demo") {
        $("demo-box").classList.remove("hidden");
        $("mode-note").innerHTML = FORCE_DEMO
            ? `Running on <b>offline demo data</b> - nothing is saved. <a href="${location.pathname}">Switch to live</a>`
            : `Firebase didn't load - running on offline demo data.`;
        document.querySelectorAll("[data-demo]").forEach(b => b.addEventListener("click", () => {
            $("auth-email").value = b.dataset.demo;
            $("auth-password").value = "123";
            setAuthTab("signin");
            $("auth-form").requestSubmit();
        }));
    }

    // Branding is readable before sign-in so the login screen shows the right name and logo.
    store.watchDoc("settings", "app", d => { settings.app = d; applyBranding(); if (currentView === "branding" && appRunning) renderBranding(); }, () => applyBranding());
    applyBranding();

    store.onAuth(async user => {
        teardown();
        authUser = user;
        if (!user) { currentView = "today"; history.replaceState(null, "", location.pathname + location.search); showScreen("login"); return; }
        showScreen("loading");
        try { await store.ensureProfile(user); } catch (err) { console.error(err); }
        profileUnsub = store.watchDoc("users", user.uid, onProfile, err => {
            console.error(err);
            showGate("⚠️", "Couldn't load your profile", "Check your connection, or ask an Admin whether your account exists.");
        });
    });

    if ($("auth-fulltime")) $("auth-fulltime").addEventListener("change", syncFullTimeTick);
    setAuthTab("signin");
    Backup.init(store, cacheLookup, renderBackupBadge);
    window.addEventListener("online", () => Backup.flush());
    setTimeout(() => Backup.flush(), 3000);
}

boot();

// Phone app (PWA, v5.3): sw.js keeps a copy of the app's files so it opens fast and can be installed.
// Only on the live https site (or with ?sw for testing), so local demo runs never get a stale copy.
if ("serviceWorker" in navigator && (location.protocol === "https:" || /[?&]sw\b/.test(location.search)))
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(err => console.warn("Service worker not registered:", err)));
