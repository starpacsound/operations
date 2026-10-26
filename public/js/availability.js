// =====================================================================
// Availability & bookings
// Members tap days on a calendar to mark themselves available. Admins / Co-Admins with the "book"
// permission soft-book (orange) or confirm (red) people from the team grid. Everything lives in the app;
// there is no roster Google Sheet any more. Firestore holds one doc per person per month:
//   avail/{uid}_{YYYY-MM}  { uid, month, name, casualId, avail[], soft[], conf[], withdrawn[], times{day: "HH:MM-HH:MM"} }
//                          (no times entry = available all day)
//   crewRoles/all          { roles: { uid: ["SE", …] } }  crew role ticks, one record for everyone (1 read).
//                          Ticked in the team grid by bookers; readable only by people who can see
//                          everyone / book (never by members)
// Days are "01".."31". avail includes booked days; soft / conf are the bookings; withdrawn = soft
// bookings the member pulled out of (flagged for bookers until someone books that day again).
// After a booking / availability save, Roster.push asks apps-script/shows/Code.gs to rebuild that month
// of the Shows Google Sheet and email people whose booking a booker changed (if emails are on).
// =====================================================================
let availMonth = "";            // "YYYY-MM" shown in both views
let availTab = "mine";
let availQuery = "", availRole = "", availDay = "";
let availGridUnsub = null, availGridKey = "";
let crewRoleMap = {};
           // uid -> ["SE", …] (loaded only for Admins / Co-Admins)

const AV_STATE = { A: "Available", S: "Soft booked", C: "Confirmed", "": "Not available" };
const monthKeyOf = d => d.toLocaleDateString("en-CA").slice(0, 7);
const thisMonth = () => monthKeyOf(new Date());
const addMonths = (m, k) => monthKeyOf(new Date(+m.slice(0, 4), +m.slice(5, 7) - 1 + k, 1));
const daysInMonth = m => new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
const dd = n => String(n).padStart(2, "0");
const monthTitle = m => new Date(m + "-01T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" });
const dayDate = (m, day) => new Date(`${m}-${day}T00:00:00`);
const fmtDay = (m, day) => dayDate(m, day).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const isPastDay = (m, day) => `${m}-${day}` < today();
const dayState = (doc, day) => !doc ? "" : (doc.conf || []).includes(day) ? "C" : (doc.soft || []).includes(day) ? "S" : (doc.avail || []).includes(day) ? "A" : "";
const myAvailDoc = m => availMine.find(d => d.month === m);
// Availability time window for a day ("" = all day)
const dayTimes = (doc, day) => (doc && doc.times && doc.times[day]) || "";
const fmtWindow = w => { if (!w) return "All day"; const [a, b] = w.split("-"); return `${fmtTime(a)}–${fmtTime(b)}`; };

const canBook = () => can("avail", "book");
const canSeeAll = () => can("avail", "viewAll") || canBook();
const crewRoles = () => (window.APP_CONFIG && window.APP_CONFIG.crewRoles) || [];
const monthsAhead = () => (window.APP_CONFIG && window.APP_CONFIG.availMonthsAhead) || 6;

// ---------- Roster Sheet sync ping ----------
const Roster = (() => {
    const url = () => String((window.APP_CONFIG && (window.APP_CONFIG.showsWebAppUrl || window.APP_CONFIG.rosterWebAppUrl)) || "").trim();
    const pending = new Set();
    let notices = [];               // booking changes made by a booker, for the emails (the script checks each one)
    let timer = null;
    const enabled = () => !!store && store.mode === "cloud" && !!url();
    function note(n) { if (enabled()) notices.push(n); }
    function push(month) {
        if (!enabled()) return;
        pending.add(month);
        clearTimeout(timer);
        timer = setTimeout(flush, 1500);
    }
    async function flush() {
        const months = [...pending], sent = notices;
        pending.clear(); notices = [];
        if (!months.length) return;
        try {
            const idToken = await store.getIdToken();
            if (!idToken) return;
            const res = await fetch(url(), { method: "POST", body: JSON.stringify({ action: "sync", idToken, months, notices: sent }) });
            const out = await res.json();
            if (!out.ok) throw new Error(out.error || "Roster sync rejected");
        } catch (err) {
            console.warn("Shows Sheet update failed, will retry:", err);
            months.forEach(m => pending.add(m));
            notices = sent.concat(notices);
            clearTimeout(timer);
            timer = setTimeout(flush, 30000);
        }
    }
    return { push, note, enabled };
})();

// ---------- New-booking notices (per browser) ----------
const seenKey = () => "sb_av_seen_" + (authUser ? authUser.uid : "");
function myBookings(fromToday) {
    const t = today();
    const out = [];
    availMine.forEach(d => {
        [...(d.soft || []), ...(d.conf || [])].forEach(day => {
            const date = `${d.month}-${day}`;
            if (!fromToday || date >= t) out.push({ month: d.month, day, date, state: dayState(d, day) });
        });
    });
    return out.sort((a, b) => a.date.localeCompare(b.date));
}
const bookingSig = b => `${b.date}:${b.state}`;
function unseenBookings() {
    let seen = [];
    try { seen = JSON.parse(localStorage.getItem(seenKey()) || "[]"); } catch (e) { seen = []; }
    return myBookings(true).filter(b => !seen.includes(bookingSig(b)));
}
function markBookingsSeen() {
    try { localStorage.setItem(seenKey(), JSON.stringify(myBookings(true).map(bookingSig))); } catch (e) { /* storage blocked */ }
}

// ---------- Render ----------
function renderAvailability() {
    const host = $("avail-container");
    if (!host || !profile) return;
    if (!availMonth) availMonth = thisMonth();
    const canMine = can("avail", "edit");
    if (!canMine) availTab = "team";
    if (!canSeeAll()) availTab = "mine";
    const teamSide = availTab === "team" || availTab === "shows";
    if (teamSide) { watchAvailGrid(); watchMonthJobs(); } else { stopAvailGrid(); stopMonthJobs(); }

    const tabs = canSeeAll() ? `<div class="sub-tabs" role="tablist">
        ${canMine ? `<button type="button" class="sub-tab ${availTab === "mine" ? "active" : ""}" data-av-tab="mine" role="tab">My availability</button>` : ""}
        <button type="button" class="sub-tab ${availTab === "team" ? "active" : ""}" data-av-tab="team" role="tab">Team roster${availAlerts() ? ` <span class="nav-badge">${availAlerts()}</span>` : ""}</button>
        <button type="button" class="sub-tab ${availTab === "shows" ? "active" : ""}" data-av-tab="shows" role="tab">Shows &amp; manpower</button>
    </div>` : "";
    const minM = teamSide ? addMonths(thisMonth(), -12) : thisMonth();
    const maxM = addMonths(thisMonth(), monthsAhead() - 1);
    const nav = `<div class="av-nav">
        <button type="button" class="btn btn-sm" data-av-month="-1" ${availMonth <= minM ? "disabled" : ""} aria-label="Previous month">‹</button>
        <h2 class="av-month">${esc(monthTitle(availMonth))}</h2>
        <button type="button" class="btn btn-sm" data-av-month="1" ${availMonth >= maxM ? "disabled" : ""} aria-label="Next month">›</button>
        ${availMonth !== thisMonth() ? `<button type="button" class="link-btn" data-av-month="0">This month</button>` : ""}
        <span class="av-legend"><i class="av-lg A"></i>Available <i class="av-lg S"></i>Soft booked <i class="av-lg C"></i>Confirmed</span>
    </div>`;
    host.innerHTML = tabs + nav + (availTab === "team" ? teamHtml() : availTab === "shows" ? jobsHtml() : mineHtml()) + (isAdmin() ? availSettingsHtml() : "");
    if (availTab === "mine") markBookingsSeen();
    renderNavBadges();
}

function mineHtml() {
    const m = availMonth, doc = myAvailDoc(m), n = daysInMonth(m);
    const first = (dayDate(m, "01").getDay() + 6) % 7; // Monday first
    const cells = [];
    for (let i = 0; i < first; i++) cells.push(`<div class="av-cell blank"></div>`);
    for (let i = 1; i <= n; i++) {
        const day = dd(i), st = dayState(doc, day), past = isPastDay(m, day);
        const wd = (doc && (doc.withdrawn || []).includes(day) && !st);
        const sun = dayDate(m, day).getDay() === 0;
        const jt = ["S", "C"].includes(st) ? myJobsOn(`${m}-${day}`).map(j => j.title).join(" + ") : "";
        cells.push(`<button type="button" class="av-cell st-${st || "N"} ${past ? "past" : ""} ${sun ? "sun" : ""} ${`${m}-${day}` === today() ? "today" : ""}" data-av-day="${day}"
            ${past ? "disabled" : ""} aria-label="${esc(fmtDay(m, day))}: ${AV_STATE[st]}${st ? " " + esc(fmtWindow(dayTimes(doc, day))) : ""}" title="${esc(AV_STATE[st])}${st === "C" ? " - ask an Admin to change" : ""}">
            <span class="d">${i}</span><span class="s">${jt ? `<span class="jt">${esc(jt)}</span>` : ""}${st ? esc(AV_STATE[st]) : wd ? "Withdrawn" : ""}${st && dayTimes(doc, day) ? `<span class="tw">${esc(fmtWindow(dayTimes(doc, day)))}</span>` : ""}</span><span class="s-short">${st && dayTimes(doc, day) ? esc(fmtTime(dayTimes(doc, day).split("-")[0])) + "+" : { A: "Free", S: "Soft", C: "Conf" }[st] || (wd ? "Out" : "")}</span></button>`);
    }
    const count = k => n && Array.from({ length: n }, (_, i) => dayState(doc, dd(i + 1))).filter(s => s === k).length;
    const fresh = unseenBookings();
    const upcoming = myBookings(true).slice(0, 12);
    const banner = fresh.length ? `<div class="av-banner">🔔 <b>New booking${fresh.length > 1 ? "s" : ""}:</b> ${fresh.slice(0, 5).map(b => `${esc(fmtDay(b.month, b.day))}${myJobsOn(b.date).length ? " · " + esc(myJobsOn(b.date).map(j => j.title).join(" + ")) : ""} (${b.state === "C" ? "confirmed" : "soft"})`).join(", ")}${fresh.length > 5 ? "…" : ""}</div>` : "";
    const asks = pendingAsks();
    const askHtml = asks.map(a => `<div class="av-banner ask">📝 <b>Please fill in your availability for ${esc(monthTitle(a.month))}.</b>
        <span class="muted small">${a.last ? `Reminder from ${esc(a.last.byName || "an Admin")} · ${esc(fmtDateTime(a.last.at))}${a.count > 1 ? ` · ${a.count} reminders` : ""}` : `Due by the end of ${esc(monthTitle(thisMonth()))}`}</span>
        <span class="toolbar">${a.month !== m ? `<button type="button" class="btn btn-sm btn-primary" data-av-goto="${a.month}">Fill in ${esc(monthTitle(a.month).split(" ")[0])}</button>` : ""}
        <button type="button" class="btn btn-sm" data-av-none="${a.month}">I'm not available in ${esc(monthTitle(a.month).split(" ")[0])}</button></span></div>`).join("");
    const noneNote = doc && doc.noAvail && !(doc.avail || []).length ? `<div class="av-banner">You said you're <b>not available</b> in ${esc(monthTitle(m))}. <button type="button" class="link-btn" data-av-undo-none="${m}">Undo</button></div>` : "";
    return `${askHtml}${banner}${noneNote}
    <div class="av-layout">
        <div class="panel av-cal-panel">
            <div class="av-week">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(w => `<span class="${w === "Sun" ? "sun" : ""}">${w}</span>`).join("")}</div>
            <div class="av-cal" id="av-cal">${cells.join("")}</div>
            <div class="av-cal-foot">
                <span class="muted small">Tap a date to say when you're free. ${count("A") + count("S") + count("C")} day(s) available this month.</span>
                <span class="toolbar"><button type="button" class="btn btn-sm" data-av-bulk="all">Mark all remaining days</button>
                <button type="button" class="btn btn-sm" data-av-bulk="clear">Clear unbooked days</button></span>
            </div>
        </div>
        <div class="panel av-side">
            <h3>Your bookings</h3>
            ${upcoming.length ? `<ul class="av-book-list my-bookings">${upcoming.map(b => `<li><div><span class="chip st-${b.state}">${b.state === "C" ? "Confirmed" : "Soft booked"}</span> <b>${esc(fmtDay(b.month, b.day))}</b></div>${myBookingDetailHtml(b)}</li>`).join("")}</ul>`
                : `<p class="muted small">No upcoming bookings yet. When an Admin books you (in the app or the roster sheet) it shows here.</p>`}
            <p class="muted small av-help"><b>Soft booked</b> = pencilled in; you can still withdraw.<br><b>Confirmed</b> = locked; ask an Admin or Co-Admin to change it.</p>
        </div>
    </div>`;
}

// ---------- Team grid ----------
function watchAvailGrid() {
    const key = availMonth;
    if (key === availGridKey && availGridUnsub) return;
    stopAvailGrid();
    availGridKey = key;
    // One saved copy of the whole month + only the docs changed since (bundles.js), instead of one read per person.
    availGridUnsub = Bundles.watchAvailMonth(store, key, { canWrite: canSeeAll() }, rows => {
        availGrid = rows;
        if ((currentView === "availability" && (availTab === "team" || availTab === "shows")) || currentView === "events") requestRender(true);
        else renderNavBadges();
    }, err => { console.error(err); toast(`Couldn't load the roster: ${friendlyError(err)}`, "err"); });
}
function stopAvailGrid() {
    if (availGridUnsub) { try { availGridUnsub(); } catch (e) { /* ignore */ } }
    availGridUnsub = null; availGridKey = ""; availGrid = [];
}
const availAlerts = () => canBook() ? availGrid.reduce((n, d) => n + (d.withdrawn || []).filter(day => !dayState(d, day) && !isPastDay(d.month, day)).length, 0) : 0;

// Everyone on the roster for the month on screen: people with a month doc, plus (from the users list,
// which Admins and bookers can read) everyone allowed to mark availability who hasn't started yet.
function rosterPeople(grid = availGrid) {
    const rolesOf = uid => crewRoleMap[uid] || [];
    const rows = grid.map(d => ({ uid: d.uid, name: d.name || "", casualId: d.casualId || "", roles: rolesOf(d.uid), doc: d }));
    users.filter(u => u.status === "active" && u.role !== "Admin" && effectivePerm(u).avail.edit && !rows.some(r => r.uid === u.id))
        .forEach(u => rows.push({ uid: u.id, name: personNameOf(u), casualId: u.casualId || "", roles: rolesOf(u.id), doc: null }));
    return rows;
}
function gridRows() {
    const rows = rosterPeople();
    const q = lc(availQuery).trim();
    return rows
        .filter(r => (!q || lc(`${r.name} ${r.casualId}`).includes(q)) && (!availRole || r.roles.includes(availRole)) && (!availDay || dayState(r.doc, availDay)))
        .sort((a, b) => a.name.localeCompare(b.name) || a.casualId.localeCompare(b.casualId));
}
const personNameOf = u => u.displayName || String(u.email || "").split("@")[0];

function teamHtml() {
    const m = availMonth, n = daysInMonth(m), rows = gridRows();
    const days = Array.from({ length: n }, (_, i) => dd(i + 1));
    const head = days.map(day => {
        const d = dayDate(m, day), sun = d.getDay() === 0;
        return `<th class="av-dh ${sun ? "sun" : ""} ${availDay === day ? "on" : ""}" data-av-dayfilter="${day}" title="Show who is available on ${esc(fmtDay(m, day))}">
            <span>${+day}</span><small>${"SMTWTFS"[d.getDay()]}</small></th>`;
    }).join("");
    const roleCols = uniq([...crewRoles(), ...Object.values(crewRoleMap).flat()]);
    const body = rows.map(r => `<tr>
        <th class="av-person"><span class="u-name">${esc(r.name || "—")}</span><span class="u-sub mono">${esc(r.casualId || "")}</span></th>
        ${roleCols.map(role => `<td class="av-role ${r.roles.includes(role) ? "on" : ""} ${canBook() ? "tickable" : ""}" ${canBook() ? `data-av-crole="${esc(r.uid)}" data-role="${esc(role)}" tabindex="0"` : ""}
            title="${esc(role)}: ${r.roles.includes(role) ? "ticked" : "not ticked"}${canBook() ? " - click to change" : ""}">${r.roles.includes(role) ? "✓" : ""}</td>`).join("")}
        ${days.map(day => {
            const st = dayState(r.doc, day), wd = !st && r.doc && (r.doc.withdrawn || []).includes(day);
            const js = ["S", "C"].includes(st) ? jobsOfPerson(r.uid, jobDate(m, day)) : [];
            const label = wd ? "!" : js.length ? js.map(j => j.title.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase()).join("").slice(0, 3) : st === "S" || st === "C" ? "?" : "";
            const tw = st ? dayTimes(r.doc, day) : "";
            const tip = wd ? "withdrew from a soft booking" : `${AV_STATE[st]}${tw ? " " + fmtWindow(tw) : ""}${js.length ? " · " + js.map(j => `${j.title} ${fmtRange(j)} as ${crewRoleOf(j, r.uid)}`).join(" + ") : ["S", "C"].includes(st) ? " · needs show details" : ""}`;
            return `<td class="av-gc st-${st || "N"} ${wd ? "wd" : ""} ${tw ? "part" : ""} ${canBook() ? "bookable" : ""}" ${canBook() ? `data-av-book="${esc(r.uid)}" data-day="${day}" tabindex="0"` : ""}
                title="${esc(r.name)} · ${esc(fmtDay(m, day))}: ${esc(tip)}">${esc(label)}</td>`;
        }).join("")}</tr>`).join("");
    const counts = days.map(day => {
        const av = rows.filter(r => dayState(r.doc, day) === "A").length;
        const bk = rows.filter(r => ["S", "C"].includes(dayState(r.doc, day))).length;
        return `<td class="av-count" title="${av} free, ${bk} booked">${av ? `<b>${av}</b>` : ""}${bk ? `<span>${bk}</span>` : ""}</td>`;
    }).join("");
    const roles = roleCols;
    const alerts = availAlerts();
    return `<div class="filter-bar">
        <input type="search" id="av-search" class="filter-input" placeholder="Search name or Casual ID…" value="${esc(availQuery)}">
        <select id="av-role" class="filter-select"><option value="">All roles</option>${roles.map(r => `<option ${availRole === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select>
        ${availDay ? `<button type="button" class="chip-btn" data-av-dayfilter="${availDay}">Free / booked on ${esc(fmtDay(m, availDay))} ✕</button>` : `<span class="muted small">Tip: click a date to see who's free that day.</span>`}
    </div>
    ${alerts ? `<div class="av-banner warn">⚠ ${plural(alerts, "soft booking")} withdrawn by the member - marked <b>!</b> in the grid.</div>` : ""}
    <div class="panel"><div class="table-scroll av-grid-wrap">
        <table class="av-grid"><thead><tr><th class="av-person">Person <span class="u-sub">${rows.length} listed</span></th>${roleCols.map(role => `<th class="av-role-h" title="Crew role${canBook() ? " - click a cell to tick / untick" : ""}">${esc(role)}</th>`).join("")}${head}</tr></thead>
        <tbody>${body || `<tr><td colspan="${n + 1 + roleCols.length}" class="empty-cell">${availGrid.length ? "Nobody matches the filters." : "No availability for this month yet."}</td></tr>`}</tbody>
        <tfoot><tr><th class="av-person"><span class="u-sub"><b>free</b> / booked</span></th>${roleCols.map(role => `<td class="av-count">${rows.filter(r => r.roles.includes(role)).length || ""}</td>`).join("")}${counts}</tr></tfoot></table>
    </div></div>
    ${remindPanelHtml()}
    <p class="muted small">Cells show the first letters of the show; <b>?</b> = booked but no show attached yet. Role ticks (${roleCols.map(esc).join(" / ")}) are only seen by Admins / Co-Admins${canBook() ? "; click one to tick or untick it" : ""}. ${canBook() ? "Click a day cell to book someone onto a show or maintenance call. " : ""}${Roster.enabled() ? "Bookings also update the Shows Google Sheet." : store.mode === "cloud" ? "Shows Google Sheet not connected (set showsWebAppUrl in config.js)." : "Demo: the Shows Google Sheet isn't connected."}</p>`;
}

function availSettingsHtml() {
    const on = !!(settings.availability && settings.availability.emailOnBooking);
    return `<div class="panel av-settings">
        <label class="switch-row"><input type="checkbox" id="av-email-toggle" ${on ? "checked" : ""}>
            <span><b>Email people when they're booked</b><span class="u-sub">Soft booked, confirmed or cancelled - sent by the Shows Sheet's Apps Script from its Google account. Admin only.</span></span></label>
    </div>`;
}

// ---------- Actions ----------
// Crew role ticks: one shared record (crewRoles/all); bookers tick / untick from the team grid.
async function toggleCrewRole(uid, role) {
    if (!canBook()) return;
    const cur = crewRoleMap[uid] || [];
    const order = uniq([...crewRoles(), ...Object.values(crewRoleMap).flat()]);
    const next = (cur.includes(role) ? cur.filter(r => r !== role) : [...cur, role]).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const person = rosterPeople().find(r => r.uid === uid);
    const name = person ? person.name : uid;
    try {
        await commitOps([{ op: "merge", col: "crewRoles", id: "all", data: { roles: { [uid]: next }, updatedAt: nowIso(), updatedBy: myEmail() } },
            makeLog("Crew roles changed", { label: name }, [{ field: "crewRoles", from: cur.join(" "), to: next.join(" ") }], "")]);
        crewRoleMap = { ...crewRoleMap, [uid]: next };      // the live record catches up a moment later
        renderAvailability();
    } catch (err) { toast(friendlyError(err), "err"); }
}

async function saveMine(m, next, logs) {
    const doc = myAvailDoc(m);
    const stamp = { updatedAt: nowIso(), updatedBy: myEmail(), name: myName(), casualId: profile.casualId || "" };
    const op = doc ? { op: "update", col: "avail", id: doc.id, data: { ...next, ...stamp } }
        : { op: "set", col: "avail", id: `${authUser.uid}_${m}`, data: { uid: authUser.uid, month: m, avail: [], soft: [], conf: [], withdrawn: [], ...next, ...stamp } };
    try { await commitOps([op, ...(logs || [])]); Roster.push(m); }
    catch (err) { toast(friendlyError(err), "err"); }
}

// ---------- Pop-up: when are you free on this day? ----------
// value passed to onSave: null = not available · "" = all day · "HH:MM-HH:MM" = those hours
function openHoursPicker({ title, sub, cur, allowNot, confirmText, onSave }) {
    let mode = cur === null || cur === undefined ? "all" : cur ? "time" : "all";
    const [s0, e0] = cur ? cur.split("-") : ["", ""];
    showModal({
        title: esc(title), size: "sm", body: `
        <form id="hp-form" class="form-stack" novalidate>
            ${sub ? `<p class="muted small hp-sub">${sub}</p>` : ""}
            <div class="hp-opts" role="radiogroup" aria-label="Availability">
                <label class="hp-opt"><input type="radio" name="hp" value="all"><span><b>Available all day</b></span></label>
                <label class="hp-opt"><input type="radio" name="hp" value="time"><span><b>Available at certain times</b>
                    <span class="hp-times">
                        <input type="text" id="hp-from" data-combo="jobTime" placeholder="From e.g. 1400" value="${esc(s0 ? fmtTime(s0) : "")}" autocomplete="off" aria-label="From">
                        <span>to</span>
                        <input type="text" id="hp-to" data-combo="jobTime" placeholder="To e.g. 2300" value="${esc(e0 ? fmtTime(e0) : "")}" autocomplete="off" aria-label="Until">
                    </span></span></label>
                ${allowNot ? `<label class="hp-opt"><input type="radio" name="hp" value="none"><span><b>Not available</b></span></label>` : ""}
            </div>
            <p id="hp-error" class="error-msg hidden"></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">${esc(confirmText || "Save")}</button></div>
        </form>`,
        onMount(root) {
            const $r = q => root.querySelector(q);
            const err = m => { $r("#hp-error").textContent = m || ""; $r("#hp-error").classList.toggle("hidden", !m); };
            const set = v => { mode = v; root.querySelectorAll("[name=hp]").forEach(i => { i.checked = i.value === v; i.closest(".hp-opt").classList.toggle("on", i.value === v); }); };
            set(mode);
            root.addEventListener("change", e => { if (e.target.name === "hp") set(e.target.value); });
            ["#hp-from", "#hp-to"].forEach(q => $r(q).addEventListener("focus", () => set("time")));
            $r("#hp-form").addEventListener("submit", async e => {
                e.preventDefault();
                if (mode === "none") { closeDynModal(); return onSave(null); }
                if (mode === "all") { closeDynModal(); return onSave(""); }
                const a = parseTime($r("#hp-from").value);
                let b = parseTime($r("#hp-to").value);
                if (b === "00:00") b = "23:59";            // end 0000 = until midnight
                if (!a) return err("Enter the time you're free from (e.g. 1400).");
                if (!b) return err("Enter the time you're free until (e.g. 2300, or 0000 for midnight).");
                if (b <= a) return err("The end time must be after the start time.");
                closeDynModal();
                onSave(`${a}-${b}`);
            });
            focusSoon(root.querySelector("[name=hp]:checked"), 30);
        }
    });
}

async function toggleMyDay(day) {
    const m = availMonth, doc = myAvailDoc(m), st = dayState(doc, day);
    if (isPastDay(m, day)) return;
    if (st === "C") return toast(`${fmtDay(m, day)} is a confirmed booking - ask an Admin or Co-Admin to change it.`, "err");
    const next = { avail: [...((doc && doc.avail) || [])], soft: [...((doc && doc.soft) || [])], withdrawn: [...((doc && doc.withdrawn) || [])], times: { ...((doc && doc.times) || {}) } };
    if (st === "S") {
        if (!(await uiConfirm({ title: `Withdraw from ${fmtDay(m, day)}?`, danger: true, confirmText: "Withdraw",
            message: "You're soft booked on this day. Withdrawing frees you up and flags it for the Admins." }))) return;
        next.avail = next.avail.filter(x => x !== day);
        next.soft = next.soft.filter(x => x !== day);
        next.withdrawn = uniq([...next.withdrawn, day]).sort();
        delete next.times[day];
        return saveMine(m, next, [makeLog("Soft booking withdrawn", { label: `${myName()} · ${fmtDay(m, day)}` }, [], "Member withdrew from a soft booking")]);
    }
    openHoursPicker({
        title: fmtDay(m, day), cur: st === "A" ? dayTimes(doc, day) : null, allowNot: st === "A",
        sub: st === "A" ? `You're marked <b>free ${esc(fmtWindow(dayTimes(doc, day)))}</b>. Change it, or choose Not available.` : "When are you free on this day?",
        onSave: v => {
            if (v === null) { next.avail = next.avail.filter(x => x !== day); delete next.times[day]; }
            else { next.avail = uniq([...next.avail, day]).sort(); if (v) next.times[day] = v; else delete next.times[day]; }
            return saveMine(m, next, []);
        }
    });
}

async function bulkMine(kind) {
    const m = availMonth, doc = myAvailDoc(m), n = daysInMonth(m);
    const future = Array.from({ length: n }, (_, i) => dd(i + 1)).filter(day => !isPastDay(m, day));
    const cur = (doc && doc.avail) || [];
    const times = { ...((doc && doc.times) || {}) };
    if (kind === "all") {
        const fresh = future.filter(day => !cur.includes(day));
        if (!fresh.length) return toast("Every remaining day is already marked.");
        return openHoursPicker({
            title: `Mark ${plural(fresh.length, "day")} in ${monthTitle(m)}`, cur: "", allowNot: false, confirmText: "Mark days",
            sub: "Every remaining day you haven't marked yet. Days you already marked keep their hours.",
            onSave: v => { fresh.forEach(day => { if (v) times[day] = v; }); return saveMine(m, { avail: uniq([...cur, ...fresh]).sort(), times }, []); }
        });
    }
    const keep = day => isPastDay(m, day) || ["S", "C"].includes(dayState(doc, day));
    if (!(await uiConfirm({ title: `Clear ${monthTitle(m)}?`, message: "Removes every future day you marked available. Booked days stay.", confirmText: "Clear days" }))) return;
    const avail = cur.filter(keep);
    Object.keys(times).forEach(day => { if (!avail.includes(day)) delete times[day]; });
    await saveMine(m, { avail, times }, []);
}

function openBookFor(cell) {
    const row = gridRows().find(r => r.uid === cell.dataset.avBook);
    if (row && canBook()) openDayModal(row, cell.dataset.day);
}

// ---------- "Please fill in your availability" reminders ----------
// Automatic: from the 15th of every month, anyone who hasn't filled NEXT month is asked to.
// Manual: Admins / Co-Admins press "Remind now" (everyone not filled, or chosen people) - a reminders/{id} doc
// { month, uids[], byUid, byName, at }. A reminder clears itself once the person marks a day (or says
// they're not available that month).
const REMIND_DAY = 15;
const monthFilled = doc => !!doc && (((doc.avail || []).length > 0) || doc.noAvail === true);
function pendingAsks() {
    // Admins aren't on the roster (the Sheet leaves them out), so they're never asked.
    if (!can("avail", "edit") || !authUser || isAdmin()) return [];
    const months = new Set();
    if (+today().slice(8, 10) >= REMIND_DAY) months.add(addMonths(thisMonth(), 1));
    reminders.filter(r => (r.uids || []).includes(authUser.uid) && r.month >= thisMonth()).forEach(r => months.add(r.month));
    return [...months].sort().filter(m => !monthFilled(myAvailDoc(m))).map(m => {
        const mine = reminders.filter(r => r.month === m && (r.uids || []).includes(authUser.uid)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
        return { month: m, last: mine[0] || null, count: mine.length };
    });
}
let askToastShown = false;
function maybeAskToast() {
    if (askToastShown || !profile) return;
    const a = pendingAsks()[0];
    if (!a) return;
    askToastShown = true;
    toast(`📝 Please fill in your availability for ${monthTitle(a.month)} (My Availability).`);
}

function remindPanelHtml() {
    if (!canBook()) return "";
    const m = availMonth;
    if (m < thisMonth()) return "";
    const people = rosterPeople().sort((a, b) => a.name.localeCompare(b.name));
    const sent = reminders.filter(r => r.month === m);
    const info = p => {
        const mine = sent.filter(r => (r.uids || []).includes(p.uid)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
        return { count: mine.length, last: mine[0] };
    };
    const status = p => p.doc && (p.doc.avail || []).length ? "filled" : p.doc && p.doc.noAvail ? "none" : "missing";
    const missing = people.filter(p => status(p) === "missing");
    const auto = m === addMonths(thisMonth(), 1) ? (+today().slice(8, 10) >= REMIND_DAY ? "on now - members who haven't filled it see a reminder" : `starts on ${REMIND_DAY} ${monthTitle(thisMonth()).split(" ")[0]}`) : "";
    return `<details class="panel av-remind" id="av-remind" ${missing.length ? "open" : ""}>
        <summary><b>Reminders for ${esc(monthTitle(m))}</b> <span class="u-sub">${missing.length ? `${plural(missing.length, "person")} not filled yet` : "everyone has filled it in ✓"}${auto ? ` · automatic reminder ${esc(auto)}` : ""}</span></summary>
        <table class="data-table compact"><thead><tr><th class="c"><input type="checkbox" id="rm-all" aria-label="Select everyone not filled"></th><th>Person</th><th>${esc(monthTitle(m).split(" ")[0])}</th><th>Reminded</th></tr></thead><tbody>
        ${people.map(p => { const st = status(p), i = info(p); return `<tr>
            <td class="c">${st === "missing" ? `<input type="checkbox" data-rm-uid="${esc(p.uid)}" aria-label="Remind ${esc(p.name)}">` : ""}</td>
            <td>${esc(p.name)} <span class="u-sub mono">${esc(p.casualId)}</span></td>
            <td>${st === "filled" ? `<span class="ok-tag">✓ filled (${(p.doc.avail || []).length} days)</span>` : st === "none" ? `<span class="muted small">not available this month</span>` : `<span class="warn-tag">not filled yet</span>`}</td>
            <td class="small">${i.count ? `${plural(i.count, "time")} · last ${esc(fmtDateTime(i.last.at))}` : `<span class="muted">-</span>`}</td></tr>`; }).join("") || `<tr><td colspan="4" class="empty-cell">Nobody on the roster yet</td></tr>`}
        </tbody></table>
        <div class="toolbar av-remind-actions">
            <button type="button" class="btn btn-primary btn-sm" data-rm-send="all" ${missing.length ? "" : "disabled"}>Remind everyone not filled (${missing.length})</button>
            <button type="button" class="btn btn-sm" data-rm-send="some" ${missing.length ? "" : "disabled"}>Remind selected</button>
            <span class="muted small">They see it in the app until they mark a day for ${esc(monthTitle(m))}. You can remind again any time.</span>
        </div>
    </details>`;
}

// m / grid: another month than the one on screen (the Today page reminds for next month).
async function remindNow(kind, m = availMonth, grid = availGrid) {
    const people = rosterPeople(grid);
    const missing = people.filter(p => !monthFilled(p.doc));
    const uids = kind === "all" ? missing.map(p => p.uid) : [...document.querySelectorAll("[data-rm-uid]:checked")].map(c => c.dataset.rmUid);
    if (!uids.length) return toast(kind === "all" ? "Everyone has filled it in." : "Tick the people to remind first.", "err");
    const names = uids.map(u => (people.find(p => p.uid === u) || {}).name).filter(Boolean);
    try {
        await commitOps([{ op: "set", col: "reminders", id: store.newId("reminders"), data: { month: m, uids, byUid: authUser.uid, byName: myName(), at: nowIso() } },
            makeLog("Availability reminder sent", { label: monthTitle(m) }, [], `${plural(uids.length, "person")}: ${names.slice(0, 8).join(", ")}${names.length > 8 ? "…" : ""}`)]);
        toast(`Reminder sent to ${plural(uids.length, "person")} for ${monthTitle(m)}`);
    } catch (err) { toast(friendlyError(err), "err"); }
}

async function setNoAvail(m, on) {
    const doc = myAvailDoc(m);
    if (on && doc && (doc.avail || []).length) return toast("You've already marked days in that month.", "err");
    if (on && !(await uiConfirm({ title: `Not available in ${monthTitle(m)}?`, confirmText: "I'm not available",
        message: "The reminder stops and Admins see you can't work that month. You can still mark days later." }))) return;
    await saveMine(m, { noAvail: !!on }, []);
    if (on) toast(`Noted: not available in ${monthTitle(m)}`);
}

// ---------- Events ----------
(function bindAvailability() {
    const view = $("view-availability");
    if (!view) return;
    view.addEventListener("click", e => {
        const t = e.target;
        const tab = t.closest("[data-av-tab]");
        if (tab) { availTab = tab.dataset.avTab; return renderAvailability(); }
        const mv = t.closest("[data-av-month]");
        if (mv) { const k = +mv.dataset.avMonth; availMonth = k ? addMonths(availMonth, k) : thisMonth(); availDay = ""; return renderAvailability(); }
        const day = t.closest("[data-av-day]");
        if (day && can("avail", "edit")) return toggleMyDay(day.dataset.avDay);
        const go = t.closest("[data-av-goto]");
        if (go) { availMonth = go.dataset.avGoto; availTab = "mine"; return renderAvailability(); }
        const none = t.closest("[data-av-none]");
        if (none) return setNoAvail(none.dataset.avNone, true);
        const undo = t.closest("[data-av-undo-none]");
        if (undo) return setNoAvail(undo.dataset.avUndoNone, false);
        const rs = t.closest("[data-rm-send]");
        if (rs) return remindNow(rs.dataset.rmSend);
        if (t.id === "rm-all") { document.querySelectorAll("[data-rm-uid]").forEach(c => { c.checked = t.checked; }); return; }
        const bulk = t.closest("[data-av-bulk]");
        if (bulk) return bulkMine(bulk.dataset.avBulk);
        const df = t.closest("[data-av-dayfilter]");
        if (df) { availDay = availDay === df.dataset.avDayfilter ? "" : df.dataset.avDayfilter; return renderAvailability(); }
        const cr = t.closest("[data-av-crole]");
        if (cr) return toggleCrewRole(cr.dataset.avCrole, cr.dataset.role);
        const cell = t.closest("[data-av-book]");
        if (cell) return openBookFor(cell);
    });
    view.addEventListener("keydown", e => {
        const cr = e.target.closest && e.target.closest("[data-av-crole]");
        if (cr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); return toggleCrewRole(cr.dataset.avCrole, cr.dataset.role); }
        const cell = e.target.closest && e.target.closest("[data-av-book]");
        if (cell && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openBookFor(cell); }
    });
    view.addEventListener("input", e => {
        if (e.target.id === "av-search") {
            availQuery = e.target.value;
            const pos = e.target.selectionStart;
            renderAvailability();
            const s = $("av-search"); if (s) { s.focus(); s.setSelectionRange(pos, pos); }
        }
    });
    view.addEventListener("change", async e => {
        if (e.target.id === "av-role") { availRole = e.target.value; return renderAvailability(); }
        if (e.target.id === "av-email-toggle" && isAdmin()) {
            const on = e.target.checked;
            try {
                await commitOps([{ op: "merge", col: "settings", id: "availability", data: { emailOnBooking: on, updatedBy: myEmail(), updatedAt: nowIso() } },
                    makeLog("Booking emails " + (on ? "turned on" : "turned off"), { label: "Availability" }, [], "")]);
                toast(on ? "Booking emails on" : "Booking emails off");
            } catch (err) { e.target.checked = !on; toast(friendlyError(err), "err"); }
        }
    });
})();
