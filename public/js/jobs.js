// =====================================================================
// Shows & maintenance calls on the roster ("jobs")
//   jobs/{id} { kind: "show" | "maint", date "YYYY-MM-DD", month "YYYY-MM", title, start "14:00", end "17:00",
//               venue, manpower [{ role, qty }], notes, crew [{ uid, name, casualId, role }], crewUids [] }
// One record per show per date: editing it updates everyone booked on it.
// Each person has at most ONE show per day, plus any number of maintenance calls.
// Soft / confirmed stays per person per day in avail/{uid}_{month} (soft[] / conf[]), so a job's crew
// member shows as soft / confirmed / withdrew / released from that.
// Remembered lists for type-and-select live in settings/rosterLists { titles[], roles[], times[] }.
// =====================================================================
let monthJobs = [];        // bookers: jobs in the month on screen
let myJobs = [];           // anyone: jobs I'm crew on
let jobsUnsub = null, jobsKey = "";
const jobOpen = new Set();

const JOB_KIND = { show: "Show", maint: "Maintenance call" };
const jobDate = (m, day) => `${m}-${day}`;
const jobDay = j => j.date.slice(8, 10);

// ---------- time helpers: "2pm", "2:30 pm", "1430", "14:30", "9" -> "HH:MM" ----------
function parseTime(s) {
    const t = String(s || "").trim().toLowerCase().replace(/\s+/g, "").replace(/\./g, ":");
    if (!t) return "";
    let m = /^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/.exec(t);
    if (!m) return null;
    let h = +m[1];
    const min = m[2] ? +m[2] : 0;
    if (m[3] === "pm" && h < 12) h += 12;
    if (m[3] === "am" && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
// Times are shown 24-hour like the team's sheet: "0800", "1430", midnight = "0000".
// (An end time of midnight is stored as "23:59" so it sorts after the start.)
function fmtTime(hhmm) {
    if (!hhmm) return "";
    if (hhmm === "23:59") return "0000";
    return hhmm.replace(":", "");
}
const fmtRange = j => j.start ? `${fmtTime(j.start)}${j.end ? "–" + fmtTime(j.end) : ""}` : "";

// ---------- data ----------
function watchMonthJobs() {
    const key = availMonth;
    if (key === jobsKey && jobsUnsub) return;
    stopMonthJobs();
    jobsKey = key;
    jobsUnsub = store.watchCol("jobs", { where: [["month", "==", key]] }, rows => {
        monthJobs = rows;
        if (["availability", "events"].includes(currentView)) requestRender(true);
    }, err => { console.error(err); toast(`Couldn't load shows: ${friendlyError(err)}`, "err"); });
}
function stopMonthJobs() {
    if (jobsUnsub) { try { jobsUnsub(); } catch (e) { /* ignore */ } }
    jobsUnsub = null; jobsKey = ""; monthJobs = [];
}
const allKnownJobs = () => { const map = new Map(); [...myJobs, ...monthJobs].forEach(j => map.set(j.id, j)); return [...map.values()]; };
const jobsOn = date => allKnownJobs().filter(j => j.date === date).sort((a, b) => (a.kind === "show" ? 0 : 1) - (b.kind === "show" ? 0 : 1) || String(a.start).localeCompare(String(b.start)));
const jobsOfPerson = (uid, date) => jobsOn(date).filter(j => (j.crewUids || []).includes(uid));
const crewRoleOf = (j, uid) => ((j.crew || []).find(c => c.uid === uid) || {}).role || "";
const availDocOf = (uid, m) => availGrid.find(d => d.uid === uid && d.month === m) || (uid === (authUser && authUser.uid) ? myAvailDoc(m) : null);

// Crew status on a job, from the person's day state.
function crewStatus(j, uid) {
    const d = availDocOf(uid, j.month), day = jobDay(j);
    const st = dayState(d, day);
    if (st === "S" || st === "C") return st;
    if (d && (d.withdrawn || []).includes(day)) return "W";
    return "R"; // released: booking cleared (e.g. in the Sheet)
}
const CREW_STATUS = { S: "Soft", C: "Confirmed", W: "Withdrew", R: "Released" };

function manpowerFill(j) {
    const live = (j.crew || []).filter(c => ["S", "C"].includes(crewStatus(j, c.uid)));
    const needed = j.manpower || [];
    const roles = uniq([...needed.map(x => x.role), ...live.map(c => c.role)]);
    return roles.map(role => {
        const have = live.filter(c => c.role === role);
        const need = (needed.find(x => x.role === role) || {}).qty || 0;
        return { role, have: have.length, soft: have.filter(c => crewStatus(j, c.uid) === "S").length, need };
    });
}
const fillChips = j => manpowerFill(j).map(f => `<span class="mp-chip ${f.need && f.have < f.need ? "short" : f.need && f.soft ? "soft" : f.need ? "ok" : ""}" title="${f.have} booked${f.soft ? ` (${f.soft} soft)` : ""}${f.need ? ` of ${f.need} needed` : ""}">${esc(f.role)} ${f.have}${f.need ? "/" + f.need : ""}</span>`).join("");

// ---------- type-and-select sources ----------
const rosterList = k => ((settings.rosterLists && settings.rosterLists[k]) || []);
Combo.register("jobTitle", () => {
    const used = countBy(allKnownJobs().filter(j => j.kind === "show"), j => j.title);
    return uniq([...rosterList("titles"), ...Object.keys(used)]).sort((a, b) => a.localeCompare(b))
        .map(t => ({ value: t, sub: used[t] ? plural(used[t], "date") + " this month" : "" }));
});
Combo.register("maintTitle", () => uniq(["Maintenance call", ...rosterList("maintTitles"), ...allKnownJobs().filter(j => j.kind === "maint").map(j => j.title)]));
Combo.register("jobTime", inp => {
    const typed = parseTime(inp.value);
    // The whole day in time order: 0000, 0030 ... 2330 (plus any odd times already used, e.g. 1945).
    const grid = [];
    for (let h = 0; h <= 23; h++) ["00", "30"].forEach(m => grid.push(`${String(h).padStart(2, "0")}:${m}`));
    const used = [...rosterList("times"), ...allKnownJobs().flatMap(j => [j.start, j.end])].filter(t => /^\d{2}:\d{2}$/.test(t || "") && t !== "23:59");
    const list = uniq([...(typed && typed !== "23:59" ? [typed] : []), ...uniq([...grid, ...used]).sort()]);
    return list.map(t => ({ value: fmtTime(t), search: t }));
});
Combo.register("crewRole", () => uniq([...crewRoles(), ...rosterList("roles"), ...Object.values(crewRoleMap).flat()]));

function listAddOps(add) {
    const cur = settings.rosterLists || {};
    const data = {};
    Object.entries(add).forEach(([k, vals]) => {
        const list = cur[k] || [];
        const fresh = vals.filter(v => v && !list.some(x => lc(x) === lc(v)));
        if (fresh.length) data[k] = [...list, ...fresh].slice(-300);
    });
    return Object.keys(data).length ? [{ op: "merge", col: "settings", id: "rosterLists", data }] : [];
}

// ---------- booking a person on a day (the cell click) ----------
function openDayModal(row, day) {
    const m = availMonth, date = jobDate(m, day);
    const doc0 = row.doc;
    const st0 = dayState(doc0, day);
    const mine = () => jobsOfPerson(row.uid, date);
    const hasShow = () => mine().some(j => j.kind === "show");
    const defaultRole = (crewRoleMap[row.uid] || [])[0] || "";
    let pickedJob = null;      // existing job on this date chosen in the add form
    let kind = hasShow() ? "maint" : "show";
    let manpower = [];

    const assignedHtml = () => mine().length ? mine().map(j => `<div class="job-card vn-edge kind-${j.kind}"${venueStyle(j)}>
        <div><span class="kind-chip ${j.kind}">${JOB_KIND[j.kind]}</span> <b>${esc(j.title)}</b>
            <div class="u-sub">${esc(fmtRange(j))}${j.venue ? " · " + venueTag(j.venue) : ""} · as <b>${esc(crewRoleOf(j, row.uid) || "—")}</b></div></div>
        <div class="toolbar"><button type="button" class="btn btn-sm" data-dm-edit="${esc(j.id)}">Edit show</button>
            <button type="button" class="btn btn-sm btn-danger" data-dm-remove="${esc(j.id)}">Remove</button></div></div>`).join("")
        : `<p class="muted small">Not on any show or call this day yet.</p>`;

    const sameDay = () => jobsOn(date).filter(j => j.kind === kind && !(j.crewUids || []).includes(row.uid));
    const mpHtml = () => manpower.map((x, i) => `<div class="mp-row">
        <input type="text" data-combo="crewRole" value="${esc(x.role)}" data-mp-role="${i}" placeholder="Role" aria-label="Role" ${pickedJob ? "disabled" : ""}>
        <input type="number" min="1" max="99" value="${x.qty}" data-mp-qty="${i}" aria-label="How many" ${pickedJob ? "disabled" : ""}>
        ${pickedJob ? "" : `<button type="button" class="icon-btn" data-mp-rm="${i}" aria-label="Remove">✕</button>`}</div>`).join("");

    showModal({
        title: `${esc(row.name)} · ${esc(fmtDay(m, day))}`, size: "lg", body: `
        <form id="dm-form" class="form-stack" novalidate>
            <div class="dm-top">
                <span class="muted small">${esc(row.casualId || "")}${(crewRoleMap[row.uid] || []).length ? " · " + crewRoleMap[row.uid].map(esc).join(" ") : ""} · now <b>${esc(AV_STATE[st0])}</b>${st0 ? ` · free <b>${esc(fmtWindow(dayTimes(doc0, day)))}</b>` : ""}</span>
            </div>
            <div><h4 class="dm-h">Booked on</h4><div id="dm-assigned">${assignedHtml()}</div></div>
            <div class="dm-add">
                <h4 class="dm-h">Add to a show or call</h4>
                <div class="seg-tabs dm-kind" role="tablist">
                    <button type="button" class="seg-tab" data-dm-kind="show">Show</button>
                    <button type="button" class="seg-tab" data-dm-kind="maint">Maintenance call</button>
                </div>
                <p class="muted small hidden" id="dm-one-show">Already on a show this day (one show per day). You can still add a maintenance call.</p>
                <div id="dm-sameday" class="chip-row"></div>
                <div class="form-grid">
                    <div class="field span2"><label for="dm-title" id="dm-title-l">Show name</label><input type="text" id="dm-title" autocomplete="off"></div>
                    <div class="field"><label for="dm-start">Start</label><input type="text" id="dm-start" data-combo="jobTime" placeholder="e.g. 1400" autocomplete="off"></div>
                    <div class="field"><label for="dm-end">End</label><input type="text" id="dm-end" data-combo="jobTime" placeholder="e.g. 1700" autocomplete="off"></div>
                    <div class="field span2"><label for="dm-venue">Venue</label><input type="text" id="dm-venue" data-combo="venue" autocomplete="off" placeholder="Search or type a venue"></div>
                    <div class="field span2"><label>Manpower needed <span class="muted small">(optional)</span></label>
                        <div id="dm-mp"></div><button type="button" class="link-btn" id="dm-mp-add">+ Add role</button></div>
                    <div class="field span2"><label for="dm-notes">Notes <span class="muted small">(optional)</span></label><input type="text" id="dm-notes" maxlength="200"></div>
                </div>
                <p class="muted small hidden" id="dm-locked">Details belong to the existing show - change them with “Edit show” so everyone booked is updated.</p>
                <div class="form-grid">
                    <div class="field"><label for="dm-role">${esc(row.name)}'s role *</label><input type="text" id="dm-role" data-combo="crewRole" value="${esc(defaultRole)}" autocomplete="off"></div>
                </div>
            </div>
            <div class="field"><label>Booking</label>
                <div class="seg-tabs dm-state" role="radiogroup">
                    <button type="button" class="seg-tab" data-dm-state="S"><i class="av-lg S"></i>Soft booked</button>
                    <button type="button" class="seg-tab" data-dm-state="C"><i class="av-lg C"></i>Confirmed</button>
                </div></div>
            <p id="dm-error" class="error-msg hidden"></p>
            <div class="form-actions">
                ${["S", "C"].includes(st0) ? `<button type="button" class="btn btn-danger" id="dm-clear" style="margin-right:auto">Clear booking</button>` : ""}
                <button type="button" class="btn btn-ghost" data-close>Cancel</button>
                <button type="submit" class="btn btn-primary">Save</button>
            </div>
        </form>`,
        onMount(root) {
            const $r = s => root.querySelector(s);
            const err = msg => { $r("#dm-error").textContent = msg || ""; $r("#dm-error").classList.toggle("hidden", !msg); };
            let state = st0 === "C" ? "C" : "S";
            const paintState = () => root.querySelectorAll("[data-dm-state]").forEach(b => b.classList.toggle("active", b.dataset.dmState === state));
            const fields = ["#dm-title", "#dm-start", "#dm-end", "#dm-venue", "#dm-notes"];
            function fill(j) {
                $r("#dm-title").value = j ? j.title : ""; $r("#dm-start").value = j ? fmtTime(j.start) : ""; $r("#dm-end").value = j ? fmtTime(j.end) : "";
                $r("#dm-venue").value = j ? j.venue || "" : ""; $r("#dm-notes").value = j ? j.notes || "" : "";
                manpower = j ? (j.manpower || []).map(x => ({ ...x })) : [];
                fields.forEach(s => { $r(s).disabled = !!j; });
                $r("#dm-mp-add").classList.toggle("hidden", !!j);
                $r("#dm-locked").classList.toggle("hidden", !j);
                $r("#dm-mp").innerHTML = mpHtml();
            }
            function paintKind() {
                const showBlocked = hasShow();
                if (kind === "show" && showBlocked) kind = "maint";
                root.querySelectorAll("[data-dm-kind]").forEach(b => { b.classList.toggle("active", b.dataset.dmKind === kind); b.disabled = b.dataset.dmKind === "show" && showBlocked; });
                $r("#dm-one-show").classList.toggle("hidden", !showBlocked);
                $r("#dm-title-l").textContent = kind === "show" ? "Show name" : "Call name";
                $r("#dm-title").dataset.combo = kind === "show" ? "jobTitle" : "maintTitle";
                $r("#dm-title").placeholder = kind === "show" ? "Type a new show or pick one" : "e.g. Maintenance call";
                const others = sameDay();
                $r("#dm-sameday").innerHTML = others.length ? `<span class="muted small">On this date:</span> ${others.map(j => `<button type="button" class="chip-btn ${pickedJob && pickedJob.id === j.id ? "on" : ""}" data-dm-pick="${esc(j.id)}">${esc(j.title)} · ${esc(fmtRange(j))}${(j.crew || []).length ? ` · ${(j.crew || []).length} booked` : ""}</button>`).join("")}
                    ${pickedJob ? `<button type="button" class="link-btn" data-dm-pick="">+ New ${kind === "show" ? "show" : "call"} instead</button>` : ""}` : "";
            }
            root.addEventListener("click", async e => {
                const k = e.target.closest("[data-dm-kind]");
                if (k && !k.disabled) { kind = k.dataset.dmKind; pickedJob = null; fill(null); if (kind === "maint" && !$r("#dm-title").value) $r("#dm-title").value = "Maintenance call"; return paintKind(); }
                const p = e.target.closest("[data-dm-pick]");
                if (p) { pickedJob = p.dataset.dmPick ? jobsOn(date).find(j => j.id === p.dataset.dmPick) : null; fill(pickedJob); return paintKind(); }
                const s = e.target.closest("[data-dm-state]");
                if (s) { state = s.dataset.dmState; return paintState(); }
                if (e.target.id === "dm-mp-add") { manpower.push({ role: "", qty: 1 }); $r("#dm-mp").innerHTML = mpHtml(); const ins = root.querySelectorAll("[data-mp-role]"); ins[ins.length - 1].focus(); return; }
                const rm = e.target.closest("[data-mp-rm]");
                if (rm) { manpower.splice(+rm.dataset.mpRm, 1); $r("#dm-mp").innerHTML = mpHtml(); return; }
                const ed = e.target.closest("[data-dm-edit]");
                if (ed) { closeDynModal(); return openJobEditor(allKnownJobs().find(j => j.id === ed.dataset.dmEdit)); }
                const rmv = e.target.closest("[data-dm-remove]");
                if (rmv) {
                    const j = allKnownJobs().find(x => x.id === rmv.dataset.dmRemove);
                    if (await removeFromJob(j, row.uid, row.name)) { $r("#dm-assigned").innerHTML = assignedHtml(); paintKind(); }
                    return;
                }
                if (e.target.id === "dm-clear") {
                    if (!(await uiConfirm({ title: `Clear ${row.name}'s booking?`, message: `${fmtDay(m, day)} goes back to "available" and they're taken off ${plural(mine().length, "show / call")} that day.`, confirmText: "Clear booking", danger: true }))) return;
                    await saveDay(row, day, "", null, mine());
                    closeDynModal();
                }
            });
            root.addEventListener("input", e => {
                const r = e.target.dataset.mpRole, q = e.target.dataset.mpQty;
                if (r !== undefined) manpower[+r].role = e.target.value.trim().toUpperCase();
                if (q !== undefined) manpower[+q].qty = Math.max(1, parseInt(e.target.value, 10) || 1);
            });
            root.addEventListener("combo:pick", e => {
                if (e.target.id !== "dm-title" || kind !== "show") return;
                // Picking a show already on this date joins it; picking a past show copies its usual details.
                const same = sameDay().find(j => lc(j.title) === lc(e.target.value));
                if (same) { pickedJob = same; fill(same); return paintKind(); }
                const past = allKnownJobs().filter(j => j.kind === "show" && lc(j.title) === lc(e.target.value)).sort((a, b) => b.date.localeCompare(a.date))[0];
                if (past) {
                    if (!$r("#dm-start").value) $r("#dm-start").value = fmtTime(past.start);
                    if (!$r("#dm-end").value) $r("#dm-end").value = fmtTime(past.end);
                    if (!$r("#dm-venue").value) $r("#dm-venue").value = past.venue || "";
                    if (!manpower.length) { manpower = (past.manpower || []).map(x => ({ ...x })); $r("#dm-mp").innerHTML = mpHtml(); }
                }
            });
            $r("#dm-form").addEventListener("submit", async e => {
                e.preventDefault();
                const title = $r("#dm-title").value.trim();
                const adding = !!(pickedJob || title);
                if (!adding && !mine().length) return err(kind === "show" ? "Type or pick the show name." : "Give the call a name.");
                let draft = null;
                if (adding) {
                    const role = $r("#dm-role").value.trim().toUpperCase();
                    if (!role) return err(`Give ${row.name} a role for this ${kind === "show" ? "show" : "call"}.`);
                    if (pickedJob) draft = { job: pickedJob, role };
                    else {
                        const start = parseTime($r("#dm-start").value), end = parseTime($r("#dm-end").value);
                        if (!title) return err(kind === "show" ? "Type or pick the show name." : "Give the call a name.");
                        if (start === null || !start) return err("Start time: e.g. 1400.");
                        if (end === null || !end) return err("End time: e.g. 1700 (0000 = midnight).");
                        const venue = $r("#dm-venue").value.trim();
                        if (kind === "show" && !venue) return err("Choose the venue.");
                        const mp = manpower.filter(x => x.role).map(x => ({ role: x.role.toUpperCase(), qty: x.qty }));
                        draft = { fresh: { kind, title, start, end, venue, notes: $r("#dm-notes").value.trim(), manpower: mp }, role };
                    }
                    if (kind === "show" && hasShow()) return err(`${row.name} is already on a show this day.`);
                    const win = dayTimes(doc0, day), js_ = pickedJob || (draft && draft.fresh);
                    if (win && js_ && js_.start && (js_.start < win.split("-")[0] || (js_.end || js_.start) > win.split("-")[1])
                        && !(await uiConfirm({ title: "Outside their available hours", confirmText: "Book anyway",
                            message: `${row.name} is free ${fmtWindow(win)} that day, but this runs ${fmtRange(js_)}.` }))) return;
                }
                err("");
                if (await saveDay(row, day, state, draft, mine())) closeDynModal();
            });
            fill(null); paintKind(); paintState();
            if (!mine().length || !hasShow()) focusSoon($r("#dm-title"), 40);
        }
    });
}

// Save one person-day: optionally add them to a job (new or existing), and set the day's booking state.
async function saveDay(row, day, state, draft, currentJobs) {
    const m = availMonth, date = jobDate(m, day), d = row.doc;
    const ops = [], logs = [];
    let jobsAfter = currentJobs.slice();
    const crewEntry = role => ({ uid: row.uid, name: row.name, casualId: row.casualId || "", role });
    if (draft && draft.fresh) {
        const id = store.newId("jobs");
        const j = { ...draft.fresh, date, month: m, crew: [crewEntry(draft.role)], crewUids: [row.uid], createdBy: myEmail(), createdAt: nowIso(), updatedBy: myEmail(), updatedAt: nowIso() };
        ops.push({ op: "set", col: "jobs", id, data: j });
        ops.push(...listAddOps({ [j.kind === "show" ? "titles" : "maintTitles"]: [j.title], roles: [draft.role, ...j.manpower.map(x => x.role)], times: [j.start, j.end] }));
        if (j.venue && typeof venueAddOps === "function") ops.push(...venueAddOps(j.venue));
        logs.push(makeLog(j.kind === "show" ? "Show created" : "Maintenance call created", { label: `${j.title} · ${fmtDay(m, day)}` }, [], `${fmtRange(j)}${j.venue ? " @ " + j.venue : ""}`));
        jobsAfter.push({ ...j, id });
    } else if (draft && draft.job) {
        const j = draft.job;
        ops.push({ op: "update", col: "jobs", id: j.id, data: { crew: [...(j.crew || []).filter(c => c.uid !== row.uid), crewEntry(draft.role)], crewUids: uniq([...(j.crewUids || []), row.uid]), updatedBy: myEmail(), updatedAt: nowIso() } });
        ops.push(...listAddOps({ roles: [draft.role] }));
        jobsAfter.push(j);
    }
    if (!state) {
        // Clearing: take them off every job that day.
        currentJobs.forEach(j => ops.push({ op: "update", col: "jobs", id: j.id, data: { crew: (j.crew || []).filter(c => c.uid !== row.uid), crewUids: (j.crewUids || []).filter(u => u !== row.uid), updatedBy: myEmail(), updatedAt: nowIso() } }));
        jobsAfter = [];
    }
    ops.push(dayStateOp(row, day, state));
    const what = jobsAfter.map(j => `${j.title} (${(draft && (draft.job === j || (draft.fresh && j.title === draft.fresh.title))) ? draft.role : crewRoleOf(j, row.uid)})`).join(", ");
    logs.push(makeLog(state === "C" ? "Booking confirmed" : state === "S" ? "Soft booked" : "Booking cleared", { label: `${row.name} · ${fmtDay(m, day)}` },
        [{ field: "booking", from: AV_STATE[dayState(d, day)], to: AV_STATE[state] }], what));
    try {
        await commitOps([...ops, ...logs]);
        Roster.push(m);
        toast(`${row.name} · ${fmtDay(m, day)}: ${AV_STATE[state]}${what ? " · " + what : ""}`);
        return true;
    } catch (err) { toast(friendlyError(err), "err"); return false; }
}

// The avail-doc write that sets one person's day to soft / confirmed / cleared.
function dayStateOp(row, day, kind) {
    const m = availMonth, d = row.doc;
    const lists = { avail: [...((d && d.avail) || [])], soft: ((d && d.soft) || []).filter(x => x !== day), conf: ((d && d.conf) || []).filter(x => x !== day),
        withdrawn: ((d && d.withdrawn) || []).filter(x => x !== day) };
    if (kind === "S") lists.soft.push(day);
    if (kind === "C") lists.conf.push(day);
    if (kind) lists.avail = uniq([...lists.avail, day]);
    Object.keys(lists).forEach(k => lists[k].sort());
    // A booking change for someone: the Shows Sheet script may email them (it checks the saved state first).
    const was = dayState(d, day);
    if (was !== kind && (["S", "C"].includes(was) || kind)) Roster.note({ uid: row.uid, month: m, day: +day, now: kind || "-" });
    const stamp = { updatedAt: nowIso(), updatedBy: myEmail() };
    return d ? { op: "update", col: "avail", id: d.id, data: { ...lists, ...stamp } }
        : { op: "set", col: "avail", id: `${row.uid}_${m}`, data: { uid: row.uid, month: m, name: row.name, casualId: row.casualId || "", ...lists, ...stamp } };
}

async function removeFromJob(j, uid, name) {
    if (!j) return false;
    const others = jobsOfPerson(uid, j.date).filter(x => x.id !== j.id);
    const m = j.month, day = jobDay(j);
    const row = { uid, name, doc: availGrid.find(d => d.uid === uid && d.month === m) || null, casualId: "" };
    if (!(await uiConfirm({ title: `Take ${name} off ${j.title}?`, confirmText: "Remove", danger: true,
        message: others.length ? `They stay booked for ${others.map(x => x.title).join(", ")} that day.` : `${fmtDay(m, day)} goes back to "available" for them.` }))) return false;
    const ops = [{ op: "update", col: "jobs", id: j.id, data: { crew: (j.crew || []).filter(c => c.uid !== uid), crewUids: (j.crewUids || []).filter(u => u !== uid), updatedBy: myEmail(), updatedAt: nowIso() } }];
    if (!others.length && ["S", "C"].includes(dayState(row.doc, day))) {
        const saved = availMonth; availMonth = m; ops.push(dayStateOp(row, day, "")); availMonth = saved;
    }
    try {
        await commitOps([...ops, makeLog("Removed from show", { label: `${name} · ${j.title}` }, [], fmtDay(m, day))]);
        Roster.push(m);
        toast(`${name} removed from ${j.title}`);
        return true;
    } catch (err) { toast(friendlyError(err), "err"); return false; }
}

// ---------- edit a show / call for everyone booked on it (or create one with nobody yet) ----------
function openJobEditor(j, preset) {
    const isNew = !j;
    const kind0 = j ? j.kind : (preset && preset.kind) || "show";
    let manpower = j ? (j.manpower || []).map(x => ({ ...x })) : [];
    let crew = j ? (j.crew || []).map(c => ({ ...c })) : [];
    const mpHtml = () => manpower.map((x, i) => `<div class="mp-row">
        <input type="text" data-combo="crewRole" value="${esc(x.role)}" data-mp-role="${i}" placeholder="Role" aria-label="Role">
        <input type="number" min="1" max="99" value="${x.qty}" data-mp-qty="${i}" aria-label="How many">
        <button type="button" class="icon-btn" data-mp-rm="${i}" aria-label="Remove">✕</button></div>`).join("");
    const crewHtml = () => crew.length ? `<table class="data-table compact"><thead><tr><th>Person</th><th>Role</th><th>Status</th></tr></thead><tbody>${crew.map((c, i) => `<tr>
        <td>${esc(c.name)} <span class="u-sub mono">${esc(c.casualId || "")}</span></td>
        <td><input type="text" class="cell-input" data-combo="crewRole" data-crew-role="${i}" value="${esc(c.role)}" aria-label="Role of ${esc(c.name)}"></td>
        <td>${j ? `<span class="chip cs-${crewStatus(j, c.uid)}">${CREW_STATUS[crewStatus(j, c.uid)]}</span>` : ""}</td></tr>`).join("")}</tbody></table>` : `<p class="muted small">Nobody booked yet - book people from the roster grid or with “Add person” in the Shows list.</p>`;
    showModal({
        title: isNew ? `New ${JOB_KIND[kind0].toLowerCase()}` : `${esc(j.title)} · ${esc(fmtDay(j.month, jobDay(j)))}`, size: "lg", body: `
        <form id="je-form" class="form-stack" novalidate>
            ${isNew ? `<div class="seg-tabs" role="tablist"><button type="button" class="seg-tab ${kind0 === "show" ? "active" : ""}" data-je-kind="show">Show</button><button type="button" class="seg-tab ${kind0 === "maint" ? "active" : ""}" data-je-kind="maint">Maintenance call</button></div>` : ""}
            <div class="form-grid">
                <div class="field span2"><label for="je-title">${kind0 === "show" ? "Show name" : "Call name"} *</label><input type="text" id="je-title" data-combo="${kind0 === "show" ? "jobTitle" : "maintTitle"}" value="${esc(j ? j.title : kind0 === "maint" ? "Maintenance call" : "")}" autocomplete="off"></div>
                <div class="field"><label for="je-date">Date *</label><input type="date" id="je-date" value="${esc(j ? j.date : (preset && preset.date) || today())}"></div>
                <div class="field"><label for="je-start">Start *</label><input type="text" id="je-start" data-combo="jobTime" value="${esc(j ? fmtTime(j.start) : "")}" placeholder="e.g. 1400" autocomplete="off"></div>
                <div class="field"><label for="je-end">End *</label><input type="text" id="je-end" data-combo="jobTime" value="${esc(j ? fmtTime(j.end) : "")}" placeholder="e.g. 1700" autocomplete="off"></div>
                <div class="field span2"><label for="je-venue">Venue${kind0 === "show" ? " *" : ""}</label><input type="text" id="je-venue" data-combo="venue" value="${esc(j ? j.venue || "" : "")}" autocomplete="off"></div>
                <div class="field span2"><label>Manpower needed <span class="muted small">(optional)</span></label><div id="je-mp">${mpHtml()}</div><button type="button" class="link-btn" id="je-mp-add">+ Add role</button></div>
                <div class="field span2"><label for="je-notes">Notes</label><input type="text" id="je-notes" maxlength="200" value="${esc(j ? j.notes || "" : "")}"></div>
            </div>
            ${isNew ? "" : `<div><h4 class="dm-h">Booked (${crew.length})</h4><div id="je-crew">${crewHtml()}</div></div>`}
            <p id="je-error" class="error-msg hidden"></p>
            <div class="form-actions">
                ${isNew ? "" : `<button type="button" class="btn btn-danger" id="je-delete" style="margin-right:auto">Delete ${j.kind === "show" ? "show" : "call"}</button>`}
                <button type="button" class="btn btn-ghost" data-close>Cancel</button>
                <button type="submit" class="btn btn-primary">${isNew ? "Create" : crew.length > 1 ? `Save for all ${crew.length}` : "Save"}</button>
            </div>
        </form>`,
        onMount(root) {
            const $r = s => root.querySelector(s);
            const err = msg => { $r("#je-error").textContent = msg || ""; $r("#je-error").classList.toggle("hidden", !msg); };
            let kind = kind0;
            root.addEventListener("click", async e => {
                const k = e.target.closest("[data-je-kind]");
                if (k) { closeDynModal(); return openJobEditor(null, { ...(preset || {}), kind: k.dataset.jeKind, date: $r("#je-date").value }); }
                if (e.target.id === "je-mp-add") { manpower.push({ role: "", qty: 1 }); $r("#je-mp").innerHTML = mpHtml(); return; }
                const rm = e.target.closest("[data-mp-rm]");
                if (rm) { manpower.splice(+rm.dataset.mpRm, 1); $r("#je-mp").innerHTML = mpHtml(); return; }
                if (e.target.id === "je-delete") {
                    if (!(await uiConfirm({ title: `Delete ${j.title}?`, danger: true, confirmText: "Delete",
                        message: crew.length ? `${plural(crew.length, "person")} come off it. Anyone with nothing else that day goes back to "available".` : "Nobody is booked on it." }))) return;
                    if (await deleteJob(j)) closeDynModal();
                }
            });
            root.addEventListener("input", e => {
                const r = e.target.dataset.mpRole, q = e.target.dataset.mpQty, c = e.target.dataset.crewRole;
                if (r !== undefined) manpower[+r].role = e.target.value.trim().toUpperCase();
                if (q !== undefined) manpower[+q].qty = Math.max(1, parseInt(e.target.value, 10) || 1);
                if (c !== undefined) crew[+c].role = e.target.value.trim().toUpperCase();
            });
            root.addEventListener("change", e => { const c = e.target.dataset.crewRole; if (c !== undefined) crew[+c].role = e.target.value.trim().toUpperCase(); });
            $r("#je-form").addEventListener("submit", async e => {
                e.preventDefault();
                const title = $r("#je-title").value.trim(), date = $r("#je-date").value;
                const start = parseTime($r("#je-start").value), end = parseTime($r("#je-end").value), venue = $r("#je-venue").value.trim();
                if (!title) return err("Give it a name.");
                if (!date) return err("Pick the date.");
                if (!start) return err("Start time: e.g. 1400.");
                if (!end) return err("End time: e.g. 1700 (0000 = midnight).");
                if (kind === "show" && !venue) return err("Choose the venue.");
                if (crew.some(c => !c.role)) return err("Every booked person needs a role.");
                if (!isNew && date !== j.date) return err("To move a show to another date, create it on the new date and book people there.");
                const data = { title, start, end, venue, notes: $r("#je-notes").value.trim(), manpower: manpower.filter(x => x.role).map(x => ({ role: x.role, qty: x.qty })),
                    updatedBy: myEmail(), updatedAt: nowIso() };
                const ops = [];
                if (isNew) ops.push({ op: "set", col: "jobs", id: store.newId("jobs"), data: { ...data, kind, date, month: date.slice(0, 7), crew: [], crewUids: [], createdBy: myEmail(), createdAt: nowIso() } });
                else {
                    const changes = [];
                    ["title", "start", "end", "venue", "notes"].forEach(k => { if ((j[k] || "") !== data[k]) changes.push({ field: k, from: j[k] || "", to: data[k] }); });
                    if (JSON.stringify(j.manpower || []) !== JSON.stringify(data.manpower)) changes.push({ field: "manpower", from: (j.manpower || []).map(x => x.qty + x.role).join(" "), to: data.manpower.map(x => x.qty + x.role).join(" ") });
                    const roleChanges = crew.filter((c, i) => c.role !== (j.crew[i] || {}).role);
                    if (!changes.length && !roleChanges.length) return closeDynModal();
                    if (changes.length && crew.length > 1 && !(await uiConfirm({ title: `Update ${j.title} for everyone?`, confirmText: `Update all ${crew.length}`,
                        message: `${changes.map(c => `${c.field}: ${c.field === "start" || c.field === "end" ? fmtTime(c.from) : c.from || "(blank)"} → ${c.field === "start" || c.field === "end" ? fmtTime(c.to) : c.to || "(blank)"}`).join("\n")}\n\nEveryone booked sees the new details:\n${crew.map(c => "• " + c.name).join("\n")}` }))) return;
                    ops.push({ op: "update", col: "jobs", id: j.id, data: { ...data, crew } });
                    ops.push(makeLog("Show details changed", { label: `${title} · ${fmtDay(j.month, jobDay(j))}` }, changes.map(c => ({ field: c.field, from: String(c.from), to: String(c.to) })),
                        `${plural(crew.length, "person")} updated${roleChanges.length ? ` · roles: ${roleChanges.map(c => `${c.name} ${c.role}`).join(", ")}` : ""}`));
                }
                ops.push(...listAddOps({ [kind === "show" ? "titles" : "maintTitles"]: [title], roles: [...data.manpower.map(x => x.role), ...crew.map(c => c.role)], times: [start, end] }));
                if (venue && typeof venueAddOps === "function") ops.push(...venueAddOps(venue));
                if (isNew) ops.push(makeLog(kind === "show" ? "Show created" : "Maintenance call created", { label: `${title} · ${fmtDay(date.slice(0, 7), date.slice(8))}` }, [], `${fmtTime(start)}–${fmtTime(end)}${venue ? " @ " + venue : ""}`));
                try {
                    await commitOps(ops);
                    Roster.push(isNew ? date.slice(0, 7) : j.month);
                    closeDynModal();
                    toast(isNew ? `${title} created` : `${title} updated${crew.length > 1 ? ` for ${plural(crew.length, "person")}` : ""}`);
                } catch (er) { err(friendlyError(er)); }
            });
        }
    });
}

async function deleteJob(j) {
    const ops = [{ op: "delete", col: "jobs", id: j.id }];
    const saved = availMonth;
    availMonth = j.month;
    (j.crew || []).forEach(c => {
        const others = jobsOfPerson(c.uid, j.date).filter(x => x.id !== j.id);
        const doc = availGrid.find(d => d.uid === c.uid && d.month === j.month);
        if (!others.length && doc && ["S", "C"].includes(dayState(doc, jobDay(j)))) ops.push(dayStateOp({ uid: c.uid, name: c.name, casualId: c.casualId, doc }, jobDay(j), ""));
    });
    availMonth = saved;
    try {
        await commitOps([...ops, makeLog(j.kind === "show" ? "Show deleted" : "Maintenance call deleted", { label: `${j.title} · ${fmtDay(j.month, jobDay(j))}` }, [], `${plural((j.crew || []).length, "person")} taken off`)]);
        Roster.push(j.month);
        toast(`${j.title} deleted`);
        return true;
    } catch (err) { toast(friendlyError(err), "err"); return false; }
}

// Book someone straight from the Shows list.
async function addPersonToJob(j, uid, role) {
    const doc = availGrid.find(d => d.uid === uid && d.month === j.month);
    const person = gridRows().find(r => r.uid === uid) || { uid, name: (doc && doc.name) || "?", casualId: (doc && doc.casualId) || "", doc };
    if (j.kind === "show" && jobsOfPerson(uid, j.date).some(x => x.kind === "show")) return toast(`${person.name} is already on a show that day.`, "err");
    const st = dayState(person.doc, jobDay(j));
    return saveDay(person, jobDay(j), st === "C" ? "C" : "S", { job: j, role: role.toUpperCase() }, jobsOfPerson(uid, j.date));
}

// ---------- compiled list: Shows tab (Admin / Co-Admin) ----------
function jobsHtml() {
    const m = availMonth;
    const list = monthJobs.slice().sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "show" ? 0 : 1) - (b.kind === "show" ? 0 : 1) || String(a.start).localeCompare(String(b.start)));
    const q = lc(availQuery).trim();
    const shown = list.filter(j => !q || lc(`${j.title} ${j.venue} ${(j.crew || []).map(c => c.name + " " + c.casualId + " " + c.role).join(" ")}`).includes(q));
    // Booked days with no show / call attached (e.g. painted in the Sheet)
    const loose = [];
    availGrid.forEach(d => [...(d.soft || []), ...(d.conf || [])].forEach(day => {
        if (!jobsOfPerson(d.uid, jobDate(m, day)).length) loose.push({ d, day, st: dayState(d, day) });
    }));
    loose.sort((a, b) => a.day.localeCompare(b.day) || String(a.d.name).localeCompare(String(b.d.name)));
    const people = gridRows();
    const groups = shown.map(j => {
        const open = jobOpen.has(j.id) || (q && shown.length <= 3);
        const crewRows = (j.crew || []).map(c => {
            const s = crewStatus(j, c.uid);
            return `<tr><td><b>${esc(c.name)}</b> <span class="u-sub mono">${esc(c.casualId || "")}</span></td><td><span class="role-pill">${esc(c.role)}</span></td>
                <td><span class="chip cs-${s}">${CREW_STATUS[s]}</span></td>
                <td class="nowrap">${canBook() ? `<button type="button" class="btn btn-sm" data-jb-day="${esc(c.uid)}" data-day="${jobDay(j)}">Booking…</button>
                <button type="button" class="btn btn-sm btn-danger" data-jb-remove="${esc(j.id)}" data-uid="${esc(c.uid)}">Remove</button>` : ""}</td></tr>`;
        }).join("");
        const free = people.filter(r => dayState(r.doc, jobDay(j)) === "A" && !(j.crewUids || []).includes(r.uid) && !(j.kind === "show" && jobsOfPerson(r.uid, j.date).some(x => x.kind === "show")));
        return `<div class="asset-group job-group vn-edge kind-${j.kind} ${open ? "open" : ""}"${venueStyle(j)}>
            <button type="button" class="group-head job-head" data-jb-toggle="${esc(j.id)}" aria-expanded="${open}">
                <span class="chev ${open ? "open" : ""}">▶</span>
                <span class="job-date">${esc(fmtDay(m, jobDay(j)))}</span>
                <span class="kind-chip ${j.kind}">${j.kind === "show" ? "Show" : "Maint."}</span>
                <span class="job-title"><b>${esc(j.title)}</b><span class="u-sub">${esc(fmtRange(j))}${j.venue ? " · " + venueTag(j.venue) : ""}${j.notes ? " · " + esc(j.notes) : ""}</span></span>
                <span class="mp-chips">${fillChips(j) || `<span class="muted small">no manpower set</span>`}</span>
                <span class="job-count">${(j.crew || []).length} booked</span>
            </button>
            ${open ? `<div class="job-body">
                <table class="data-table compact"><thead><tr><th>Person</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>${crewRows || `<tr><td colspan="4" class="empty-cell">Nobody booked yet</td></tr>`}</tbody></table>
                ${canBook() ? `<div class="job-actions">
                    <form class="job-add" data-jb-add="${esc(j.id)}">
                        <select data-jb-person aria-label="Person to add"><option value="">+ Add someone free that day…</option>${free.map(r => `<option value="${esc(r.uid)}">${esc(r.name)}${r.roles.length ? " (" + r.roles.join(" ") + ")" : ""} · ${esc(fmtWindow(dayTimes(r.doc, jobDay(j))))}</option>`).join("")}</select>
                        <input type="text" data-combo="crewRole" data-jb-role placeholder="Role" aria-label="Role" autocomplete="off">
                        <button type="submit" class="btn btn-sm">Add (soft)</button>
                    </form>
                    <span class="acc-spacer"></span>
                    <button type="button" class="btn btn-sm" data-jb-edit="${esc(j.id)}">Edit details${(j.crew || []).length > 1 ? ` (all ${(j.crew || []).length})` : ""}</button>
                </div>` : ""}
            </div>` : ""}
        </div>`;
    }).join("");
    const totals = (() => {
        const t = {};
        monthJobs.forEach(j => manpowerFill(j).forEach(f => { t[f.role] = (t[f.role] || 0) + f.have; }));
        return Object.entries(t).sort().map(([r, n]) => `<span class="mp-chip">${esc(r)} ${n}</span>`).join("");
    })();
    return `<div class="filter-bar">
        <input type="search" id="av-search" class="filter-input" placeholder="Search show, venue, person, role…" value="${esc(availQuery)}">
        ${canBook() ? `<button type="button" class="btn btn-primary" data-jb-new="show">+ New show</button><button type="button" class="btn" data-jb-new="maint">+ Maintenance call</button>` : ""}
    </div>
    <p class="muted small">${plural(monthJobs.filter(j => j.kind === "show").length, "show")} · ${plural(monthJobs.filter(j => j.kind === "maint").length, "maintenance call")} this month ${totals ? "· booked person-days by role: " + totals : ""}</p>
    ${loose.length ? `<div class="panel needs-details"><h4 class="dm-h">Needs details <span class="muted small">booked days not attached to a show or call (e.g. booked before the show was added)</span></h4>
        <ul class="av-book-list">${loose.map(x => `<li><span class="chip st-${x.st}">${x.st === "C" ? "Confirmed" : "Soft"}</span> ${esc(fmtDay(m, x.day))} · <b>${esc(x.d.name)}</b>
            ${canBook() ? `<button type="button" class="link-btn" data-jb-day="${esc(x.d.uid)}" data-day="${x.day}">Add details</button>` : ""}</li>`).join("")}</ul></div>` : ""}
    <div class="job-list">${groups || `<div class="empty-state">${monthJobs.length ? "Nothing matches your search." : `No shows or calls in ${esc(monthTitle(m))} yet.${canBook() ? " Click a day in the Team roster, or use <b>+ New show</b>." : ""}`}</div>`}</div>`;
}

(function bindJobs() {
    const view = $("view-availability");
    if (!view) return;
    view.addEventListener("click", async e => {
        const t = e.target;
        const tg = t.closest("[data-jb-toggle]");
        if (tg) { const id = tg.dataset.jbToggle; jobOpen.has(id) ? jobOpen.delete(id) : jobOpen.add(id); return renderAvailability(); }
        const nw = t.closest("[data-jb-new]");
        if (nw) return openJobEditor(null, { kind: nw.dataset.jbNew, date: availMonth === thisMonth() ? today() : `${availMonth}-01` });
        const ed = t.closest("[data-jb-edit]");
        if (ed) return openJobEditor(monthJobs.find(j => j.id === ed.dataset.jbEdit));
        const rm = t.closest("[data-jb-remove]");
        if (rm) { const j = monthJobs.find(x => x.id === rm.dataset.jbRemove); const c = (j.crew || []).find(x => x.uid === rm.dataset.uid); return removeFromJob(j, c.uid, c.name); }
        const dy = t.closest("[data-jb-day]");
        if (dy) { const row = gridRows().find(r => r.uid === dy.dataset.jbDay); if (row) openDayModal(row, dy.dataset.day); }
    });
    view.addEventListener("submit", async e => {
        const f = e.target.closest("[data-jb-add]");
        if (!f) return;
        e.preventDefault();
        const j = monthJobs.find(x => x.id === f.dataset.jbAdd);
        const uid = f.querySelector("[data-jb-person]").value, role = f.querySelector("[data-jb-role]").value.trim();
        if (!uid) return toast("Pick someone to add.", "err");
        if (!role) return toast("Give them a role.", "err");
        await addPersonToJob(j, uid, role);
    });
})();

// ---------- member view helpers ----------
function myJobsOn(date) { return myJobs.filter(j => j.date === date).sort((a, b) => (a.kind === "show" ? 0 : 1) - (b.kind === "show" ? 0 : 1)); }
function myBookingDetailHtml(b) {
    const js = myJobsOn(b.date);
    if (!js.length) return `<div class="u-sub">Details to follow</div>`;
    return js.map(j => {
        const team = (j.crew || []).filter(c => c.uid !== authUser.uid);
        return `<div class="my-job vn-edge kind-${j.kind}"${venueStyle(j)}><b>${esc(j.title)}</b>${j.kind === "maint" ? ` <span class="kind-chip maint">Maint.</span>` : ""}
            <div class="u-sub">${esc(fmtRange(j))}${j.venue ? " · " + venueTag(j.venue) : ""} · you: <b>${esc(crewRoleOf(j, authUser.uid))}</b></div>
            ${j.notes ? `<div class="u-sub">${esc(j.notes)}</div>` : ""}
            ${team.length ? `<details class="my-team"><summary>Team (${team.length})</summary><ul>${team.map(c => `<li>${esc(c.name)} - ${esc(c.role)}</li>`).join("")}</ul></details>` : ""}</div>`;
    }).join("");
}
