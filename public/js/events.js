// =====================================================================
// Calendar: calendar / list of every show and maintenance call, read from the same jobs/{id}
// records as Availability › Shows & manpower. Members see the shows they're booked on (with
// teammates); Admin / Co-Admin see everything.
// =====================================================================
let eventsMode = "calendar";

const evSeeAll = () => can("events", "viewAll");   // every show & maintenance call, not just the ones they're on
const onCrew = j => (j.crewUids || []).includes(authUser.uid);
const eventJobs = () => evSeeAll() ? allKnownJobs() : myJobs.slice();
const jobsInMonth = m => eventJobs().filter(j => j.month === m)
    .sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")));

function eventsNav() {
    const maxM = addMonths(thisMonth(), monthsAhead() - 1);
    return `<div class="av-nav">
        <button type="button" class="btn btn-sm" data-ev-month="-1" aria-label="Previous month">‹</button>
        <h2 class="av-month">${esc(monthTitle(availMonth))}</h2>
        <button type="button" class="btn btn-sm" data-ev-month="1" ${availMonth >= maxM ? "disabled" : ""} aria-label="Next month">›</button>
        ${availMonth !== thisMonth() ? `<button type="button" class="link-btn" data-ev-month="0">This month</button>` : ""}
    </div>`;
}
function ensureEventData() {
    if (!availMonth) availMonth = thisMonth();
    if (evSeeAll()) watchMonthJobs();
    if (canSeeAll()) watchAvailGrid();   // crew soft / confirmed status and manpower fill
}
const jobState = j => {   // members: their own soft / confirmed booking
    if (canSeeAll() || !onCrew(j)) return "";
    const st = dayState(myAvailDoc(j.month), jobDay(j)); return st === "C" ? "C" : st === "S" ? "S" : "";
};
function venueLegend(list) {   // venues of this month's shows + maintenance
    const vs = uniq(list.filter(j => j.kind === "show" && j.venue).flatMap(j => jobVenueList(j))).sort((a, b) => a.localeCompare(b));
    return `<span class="av-legend">${vs.map(v => `<i class="av-lg" style="background:${venueColor(v)}"></i>${esc(v)}`).join(" ")}
        ${list.some(j => j.kind === "maint") || !vs.length ? `<i class="av-lg kind-maint"></i>Maintenance call` : ""}
        ${!canSeeAll() ? `<i class="av-lg soft-mark"></i>Soft booked` : ""}</span>`;
}

// ---------- Calendar ----------
function renderEvents() {
    const host = $("events-container");
    if (!host || !profile) return;
    ensureEventData();
    const m = availMonth, list = jobsInMonth(m);
    const modeTabs = `<div class="seg-tabs ev-mode" role="tablist">
        <button type="button" class="seg-tab ${eventsMode === "calendar" ? "active" : ""}" data-ev-mode="calendar">Calendar</button>
        <button type="button" class="seg-tab ${eventsMode === "list" ? "active" : ""}" data-ev-mode="list">List</button></div>`;
    const legend = venueLegend(list);
    host.innerHTML = `<div class="ev-top stick">${eventsNav()}${modeTabs}${legend}</div>
        ${eventsMode === "calendar" ? evCalendarHtml(m, list) : evListHtml(list)}
        ${!list.length ? `<div class="empty-state">${evSeeAll() ? "No shows or maintenance calls this month yet. Add them from My Availability › Shows & manpower." : "You're not booked on anything this month."}</div>` : ""}`;
}

// The job's shared gear list (shows.js): missing items, or still out after the show, get a ⚠ on the calendar.
const gearAlert = j => { const g = jobShowOf(j); return !!g && (g.missingCount > 0 || (g.status === "out" && j.date < today())); };
function gearSummaryHtml(j) {
    const g = jobShowOf(j), canGear = isAdmin() || onCrew(j);
    if (!g && !canGear) return "";
    const pcs = g ? (g.items || []).reduce((n, i) => n + (+i.qty || 0), 0) : 0;
    const missing = g ? (g.items || []).filter(i => g.status === "in" && !i.accounted) : [];
    const line = !g ? `<p class="muted small">No gear signed out for this yet.</p>`
        : g.status === "out" ? `<p class="${j.date < today() ? "warn-tag" : ""}">${j.date < today() ? "⚠ Still signed out after the show" : "Signed out"} · ${plural((g.items || []).length, "line")}, ${pcs} pcs</p>`
        : missing.length ? `<p class="warn-tag">⚠ Signed in with ${plural(missing.length, "missing item")}: ${esc(missing.map(m => `${m.qty}× ${m.name}`).join(", "))}</p>`
        : `<p class="ok-tag">✓ Signed in · everything accounted for</p>`;
    return `<div class="ev-gear"><h4 class="dm-h">Show gear</h4>${line}
        ${canGear || g ? `<button type="button" class="btn btn-sm ${g ? "" : "btn-primary"}" data-ev-gear="${esc(j.id)}">${g ? "Open gear list" : "Sign out gear"}</button>` : ""}</div>`;
}

const evChip = j => {
    const st = jobState(j);
    return `<button type="button" class="ev-chip kind-${j.kind} ${st ? "st-" + st : ""}"${venueStyle(j)} data-ev-open="${esc(j.id)}" title="${esc(j.title)} · ${esc(fmtRange(j))}${j.venue ? " · " + esc(j.venue) : ""}${st === "S" ? " · soft booked" : ""}">
        <span class="t">${esc(fmtTime(j.start))}</span> ${gearAlert(j) ? `<span class="gear-flag" title="Show gear: missing items or not signed in">⚠</span> ` : ""}${esc(j.title)}</button>`;
};
function evCalendarHtml(m, list) {
    const n = daysInMonth(m), first = (dayDate(m, "01").getDay() + 6) % 7;
    const cells = [];
    for (let i = 0; i < first; i++) cells.push(`<div class="ev-cell blank"></div>`);
    for (let i = 1; i <= n; i++) {
        const day = dd(i), date = `${m}-${day}`, js = list.filter(j => j.date === date);
        cells.push(`<div class="ev-cell ${date === today() ? "today" : ""} ${date < today() ? "past" : ""}">
            <span class="d ${dayDate(m, day).getDay() === 0 ? "sun" : ""}">${i}</span>
            ${js.slice(0, 3).map(evChip).join("")}
            ${js.length > 3 ? `<button type="button" class="ev-more" data-ev-day="${date}">+${js.length - 3} more</button>` : ""}</div>`);
    }
    return `<div class="panel ev-cal-panel"><div class="av-week">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(w => `<span class="${w === "Sun" ? "sun" : ""}">${w}</span>`).join("")}</div>
        <div class="ev-cal">${cells.join("")}</div></div>`;
}
function evListHtml(list) {
    const byDate = {};
    list.forEach(j => (byDate[j.date] = byDate[j.date] || []).push(j));
    return `<div class="ev-list">${Object.keys(byDate).map(date => `<div class="ev-day ${date < today() ? "past" : ""}">
        <div class="ev-day-h">${esc(fmtDay(date.slice(0, 7), date.slice(8)))}</div>
        ${byDate[date].map(j => `<button type="button" class="ev-row kind-${j.kind}"${venueStyle(j)} data-ev-open="${esc(j.id)}">
            <span class="ev-time">${esc(fmtRange(j))}</span>
            <span class="ev-title"><b>${gearAlert(j) ? `<span class="gear-flag" title="Show gear: missing items or not signed in">⚠</span> ` : ""}${esc(j.title)}</b><span class="u-sub">${venueTag(j.venue)}${j.kind === "maint" ? " · maintenance call" : ""}</span></span>
            <span class="mp-chips">${canSeeAll() ? fillChips(j) : onCrew(j) ? `<span class="chip st-${jobState(j) || "A"}">${jobState(j) === "C" ? "Confirmed" : "Soft"} · you: ${esc(crewRoleOf(j, authUser.uid))}</span>` : `<span class="muted small">${(j.crew || []).length} crew</span>`}</span>
        </button>`).join("")}</div>`).join("")}</div>`;
}

function openEventModal(j) {
    if (!j) return;
    const crew = (j.crew || []);
    showModal({
        title: `${esc(j.title)} · ${esc(fmtDay(j.month, jobDay(j)))}`, body: `
        <div class="form-stack">
            <div class="ev-facts">
                <div><span class="u-sub">When</span><b>${esc(fmtRange(j))}</b></div>
                <div><span class="u-sub">Where</span><b>${j.venue ? venueTag(j.venue) : "-"}</b></div>
                <div><span class="u-sub">Type</span><b>${j.kind === "show" ? "Show" : "Maintenance call"}</b></div>
                ${canSeeAll() && (j.manpower || []).length ? `<div><span class="u-sub">Manpower</span><span class="mp-chips">${fillChips(j)}</span></div>` : ""}
            </div>
            ${j.notes ? `<p class="muted">${esc(j.notes)}</p>` : ""}
            <div><h4 class="dm-h">Crew (${crew.length})</h4>
                ${crew.length ? `<ul class="ev-crew">${crew.map(c => `<li><b>${esc(c.name)}</b> <span class="role-pill">${esc(c.role)}</span>${canSeeAll() ? ` <span class="chip cs-${crewStatus(j, c.uid)}">${CREW_STATUS[crewStatus(j, c.uid)]}</span>` : c.uid === authUser.uid ? ` <span class="muted small">(you)</span>` : ""}</li>`).join("")}</ul>` : `<p class="muted small">Nobody booked yet.</p>`}</div>
            ${j.venue ? `<a class="link-btn" href="${mapsUrl(j.venue)}" target="_blank" rel="noopener">📍 Open ${esc(j.venue)} in Google Maps</a>` : ""}
            ${gearSummaryHtml(j)}
            <div class="form-actions">
                ${canBook() ? `<button type="button" class="btn" data-ev-edit="${esc(j.id)}">Edit details</button>` : ""}
                <button type="button" class="btn btn-primary" data-close>Close</button>
            </div>
        </div>`,
        onMount(root) {
            root.addEventListener("click", e => {
                const ed = e.target.closest("[data-ev-edit]");
                if (ed) { closeDynModal(); openJobEditor(allKnownJobs().find(x => x.id === ed.dataset.evEdit)); }
                const gr = e.target.closest("[data-ev-gear]");
                if (gr) { closeDynModal(); openJobGear(allKnownJobs().find(x => x.id === gr.dataset.evGear)); }
            });
        }
    });
}

// ---------- events ----------
(function bindEvents() {
    const ev = $("view-events");
    const month = t => { const mv = t.closest("[data-ev-month]"); if (!mv) return false; const k = +mv.dataset.evMonth; availMonth = k ? addMonths(availMonth, k) : thisMonth(); return true; };
    if (ev) ev.addEventListener("click", e => {
        const t = e.target;
        if (month(t)) return renderEvents();
        const md = t.closest("[data-ev-mode]");
        if (md) { eventsMode = md.dataset.evMode; return renderEvents(); }
        const o = t.closest("[data-ev-open]");
        if (o) return openEventModal(allKnownJobs().find(j => j.id === o.dataset.evOpen));
        const more = t.closest("[data-ev-day]");
        if (more) { eventsMode = "list"; return renderEvents(); }
    });
})();
