// =====================================================================
// Today (v5.3): the first page. "My next show" card (from the jobs I'm booked on) and tiles for
// what needs the viewer now, each only when they have the permission for it. Everything comes from
// data the app already loads, plus two small reads while this page is open, for bookers only:
// this week's jobs (to spot shows short of crew) and next month's availability copy (who hasn't filled it).
// =====================================================================
let todayWeekJobs = [], todayWeekUnsub = null;
let todayNextGrid = [], todayGridUnsub = null, todayGridMonth = "";

const mapsUrl = venue => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(venue);
const jobSort = (a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || ""));
// Today's first, then the next ones (shows before maintenance calls on the same day).
const upcomingJobs = () => myJobs.filter(j => j.date >= today()).sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "show" ? 0 : 1) - (b.kind === "show" ? 0 : 1) || String(a.start).localeCompare(String(b.start)));
// Roles still short on a job (booked people by role vs the manpower asked for).
const shortRoles = j => (j.manpower || []).map(x => ({ role: x.role, need: +x.qty || 0, have: (j.crew || []).filter(c => c.role === x.role).length }))
    .filter(x => x.have < x.need);

// Bookers: the extra reads run only while Today is open (switchView calls this).
function syncToday() {
    const on = currentView === "today" && !!profile;
    if (on && canSeeAll() && !todayWeekUnsub) {
        todayWeekUnsub = store.watchCol("jobs", { where: [["date", ">=", today()], ["date", "<=", addDays(6)]] },
            rows => { todayWeekJobs = rows; if (currentView === "today") requestRender(true); },
            err => { console.error(err); todayWeekJobs = []; });
    }
    const next = addMonths(thisMonth(), 1);
    if (on && canBook() && (!todayGridUnsub || todayGridMonth !== next)) {
        stopTodayGrid();
        todayGridMonth = next;
        todayGridUnsub = Bundles.watchAvailMonth(store, next, { canWrite: canSeeAll() },
            rows => { todayNextGrid = rows; if (currentView === "today") requestRender(true); },
            err => { console.error(err); });
    }
    if (!on) stopToday();
}
function stopTodayGrid() {
    if (todayGridUnsub) { try { todayGridUnsub(); } catch (e) { /* ignore */ } }
    todayGridUnsub = null; todayGridMonth = ""; todayNextGrid = [];
}
function stopToday() {
    if (todayWeekUnsub) { try { todayWeekUnsub(); } catch (e) { /* ignore */ } }
    todayWeekUnsub = null; todayWeekJobs = [];
    stopTodayGrid();
}

function nextShowHtml() {
    const list = upcomingJobs();
    const j = list[0];
    if (!j) return `<div class="panel today-card empty"><h2 class="today-h">My next show</h2><p class="muted">You're not booked on any upcoming shows. When an Admin books you, it shows here.</p></div>`;
    const when = j.date === today() ? "Today" : j.date === addDays(1) ? "Tomorrow" : fmtDay(j.month, jobDay(j));
    const st = dayState(myAvailDoc(j.month), jobDay(j));
    const g = jobShowOf(j);
    const gear = !g ? `<span class="muted small">No gear signed out yet.</span>`
        : g.status === "out" ? `<span class="small">Gear signed out · ${plural((g.items || []).length, "line")}${g.items.some(i => i.accounted) ? ` · ${(g.items || []).filter(i => i.accounted).length} ticked back in` : ""}</span>`
        : g.missingCount ? `<span class="warn-tag">⚠ Gear signed in · ${plural(g.missingCount, "missing item")}</span>` : `<span class="ok-tag">✓ Gear signed in</span>`;
    const later = list.slice(1, 4);
    return `<div class="panel today-card">
        <div class="today-card-top">
            <div><span class="u-sub">${j.kind === "show" ? "My next show" : "My next maintenance call"} · ${esc(when)}</span>
                <h2 class="today-show">${esc(j.title)}</h2></div>
            ${st === "C" ? `<span class="chip st-C">Confirmed</span>` : st === "S" ? `<span class="chip st-S">Soft booked</span>` : ""}
        </div>
        <div class="ev-facts">
            <div><span class="u-sub">Call time</span><b>${esc(fmtTime(j.start))}</b><span class="muted small">${esc(fmtRange(j))}</span></div>
            <div><span class="u-sub">Venue</span><b>${j.venue ? venueTag(j.venue) : "-"}</b>${j.venue ? `<a class="link-btn small" href="${mapsUrl(j.venue)}" target="_blank" rel="noopener">📍 Google Maps</a>` : ""}</div>
            <div><span class="u-sub">My role</span><b>${esc(crewRoleOf(j, authUser.uid) || "-")}</b></div>
        </div>
        ${j.notes ? `<p class="muted">${esc(j.notes)}</p>` : ""}
        <div><span class="u-sub">Team (${(j.crew || []).length})</span>
            <ul class="ev-crew today-crew">${(j.crew || []).map(c => `<li><b>${esc(c.name)}</b> <span class="role-pill">${esc(c.role)}</span>${c.uid === authUser.uid ? ` <span class="muted small">(you)</span>` : ""}</li>`).join("")}</ul></div>
        <div class="today-gear">${gear}
            <button type="button" class="btn ${g ? "" : "btn-primary"}" data-today-gear="${esc(j.id)}">${g ? "Open gear list" : "Sign out gear"}</button></div>
        ${later.length ? `<p class="muted small today-later">Then: ${later.map(x => `${esc(fmtDay(x.month, jobDay(x)))} ${esc(x.title)}`).join(" · ")}</p>` : ""}
    </div>`;
}

// One tile = a count, a short list and a button to the page that deals with it.
const todayTile = (cls, title, rows, view, btn, extra) => `<div class="panel today-tile ${cls}">
    <div class="today-tile-h"><b>${esc(title)}</b><span class="today-count">${rows.length}</span></div>
    ${rows.length ? `<ul class="today-list">${rows.slice(0, 5).join("")}${rows.length > 5 ? `<li class="muted small">+${rows.length - 5} more</li>` : ""}</ul>` : ""}
    ${extra || ""}
    ${view && canOpenView(view) ? `<button type="button" class="btn btn-sm" data-today-go="${view}">${esc(btn)}</button>` : ""}
</div>`;

function todayTiles() {
    const tiles = [];
    const li = (main, sub) => `<li><span>${main}</span>${sub ? `<span class="muted small">${sub}</span>` : ""}</li>`;
    if (can("maintenance", "verify")) {
        const reqs = visibleTickets().filter(t => t.stage === "request");
        if (reqs.length) tiles.push(todayTile("t-warn", "Fault reports to verify", reqs.map(t => li(esc(t.assetLabel || t.model || "Asset"), esc(t.requestedByName || t.requestedBy || ""))), "maintenance", "Open Faults & Repairs"));
    }
    if (can("loans", "manage")) {
        const todo = loans.filter(l => l.status === "requested" || l.status === "returnRequested");
        if (todo.length) tiles.push(todayTile("t-warn", "Loans to approve / receive", todo.map(l => li(esc(l.requestedByName || l.requestedBy || ""), l.status === "requested" ? "wants to borrow" : "returning")), "loans", "Open Equipment Loans"));
    }
    const late = loans.filter(isLoanOverdue);
    if (late.length) tiles.push(todayTile("t-err", "Overdue loans", late.map(l => li(esc(l.borrowerName || l.requestedByName || ""), `due ${esc(fmtDate(l.returnDate))}`)), "loans", "Open Equipment Loans"));
    const tbc = loans.filter(isLoanTbcLong);
    if (tbc.length) tiles.push(todayTile("t-warn", "Loans with no return date (out over 30 days)", tbc.map(l => li(esc(l.borrowerName || l.requestedByName || ""), `out since ${esc(fmtDate(l.collectedAt || l.collectDate))}`)), "loans", "Set return dates"));
    if (canSeeAll()) {
        const short = todayWeekJobs.filter(j => j.kind === "show" && shortRoles(j).length).sort(jobSort);
        if (short.length) tiles.push(todayTile("t-warn", "Shows this week short of crew", short.map(j => li(`${esc(fmtDay(j.month, jobDay(j)))} · ${esc(j.title)}`, shortRoles(j).map(r => `${esc(r.role)} ${r.have}/${r.need}`).join(" "))), "availability", "Book crew"));
    }
    const out = shows.filter(s => s.status === "out" && (can("shows", "viewAll") || s.createdByUid === authUser.uid || onShowCrew(s)))
        .sort((a, b) => String(a.showDate).localeCompare(String(b.showDate)));
    if (out.length) tiles.push(todayTile(out.some(s => s.showDate < today()) ? "t-warn" : "", "Gear still signed out", out.map(s => li(`${s.showDate < today() ? "⚠ " : ""}${esc(s.title)}`, `${esc(fmtDate(s.showDate))}${s.venue ? " · " + esc(s.venue) : ""}`)), "shows", "Open Show Sign-Out"));
    if (canBook() && todayGridMonth) {
        const missing = rosterPeople(todayNextGrid).filter(p => !monthFilled(p.doc) && !availOptional(p.uid));
        if (missing.length) tiles.push(todayTile("", `${missing.length === 1 ? "1 person hasn't" : missing.length + " people haven't"} filled ${monthTitle(todayGridMonth)}`,
            missing.sort(rosterCmp).map(p => li(esc(p.name), esc(p.casualId))), "", "",
            `<button type="button" class="btn btn-primary btn-sm" data-today-remind>Remind them (${missing.length})</button>`));
    }
    return tiles;
}

function renderToday() {
    const host = $("today-container");
    if (!host || !profile) return;
    syncToday();
    const tiles = todayTiles();
    host.innerHTML = `${nextShowHtml()}
        <h2 class="section-title">Needs you</h2>
        ${tiles.length ? `<div class="today-tiles">${tiles.join("")}</div>` : `<div class="empty-state">Nothing waiting on you right now. ✓</div>`}
        ${installHelpHtml()}`;
}

// ---------- install as a phone app (PWA) ----------
let installPrompt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; if (currentView === "today") requestRender(); });
window.addEventListener("appinstalled", () => { installPrompt = null; if (currentView === "today") requestRender(); });
const isInstalled = () => (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function installHelpHtml() {
    if (isInstalled()) return "";
    return `<details class="panel today-install" id="today-install">
        <summary><b>📱 Put ${esc(appName())} on your phone's home screen</b></summary>
        ${installPrompt ? `<p><button type="button" class="btn btn-primary btn-sm" data-today-install>Install app</button></p>` : ""}
        <ul class="small">
            <li><b>Android (Chrome):</b> tap <b>Install app</b> above, or the ⋮ menu › <b>Install app</b> / <b>Add to Home screen</b>.</li>
            <li><b>iPhone / iPad:</b> open this page in <b>Safari</b>, tap the Share button (□↑) › <b>Add to Home Screen</b> › Add.</li>
        </ul>
        <p class="muted small">It opens full screen like an app and loads faster. You still need internet for live data.</p>
    </details>`;
}

(function bindToday() {
    const v = $("view-today");
    if (!v) return;
    v.addEventListener("click", async e => {
        const g = e.target.closest("[data-today-gear]");
        if (g) return openJobGear(myJobs.find(j => j.id === g.dataset.todayGear));
        const go = e.target.closest("[data-today-go]");
        if (go) return switchView(go.dataset.todayGo);
        if (e.target.closest("[data-today-remind]")) return remindNow("all", todayGridMonth, todayNextGrid);
        if (e.target.closest("[data-today-install]") && installPrompt) {
            installPrompt.prompt();
            try { await installPrompt.userChoice; } catch (er) { /* ignore */ }
            installPrompt = null; requestRender();
        }
    });
})();
