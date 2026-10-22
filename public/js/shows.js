// =====================================================================
// Show Sign-Out / Sign-In
// A member names the show, builds a list of gear (names + quantities), and later ticks off what came
// back before hitting Sign In. Unticked items are recorded as missing. Lists are kept permanently and
// are searchable by show title.
// =====================================================================
const showOpen = new Set();
const showTicks = {}; // showId -> Set(item index) while signing in (local until Sign In)

const canSignIn = s => s.status === "out" && (isAdmin() || (authUser && s.createdByUid === authUser.uid));

function renderShows() {
    const host = $("shows-container");
    if (!host || !profile) return;
    const q = lc($("show-search").value).trim();
    const st = $("show-status").value;
    const mineOnly = can("shows", "viewAll") && $("show-mine").checked;
    const list = shows.filter(s =>
        (!q || lc(s.title).includes(q) || lc(s.venue).includes(q)) &&
        (st === "ALL" || (st === "missing" ? s.missingCount > 0 : s.status === st)) &&
        (!mineOnly || s.createdByUid === authUser.uid))
        .sort((a, b) => (a.status === "out" ? 0 : 1) - (b.status === "out" ? 0 : 1) || String(b.showDate || b.signedOutAt).localeCompare(String(a.showDate || a.signedOutAt)));
    if (!list.length) {
        host.innerHTML = `<div class="empty-state">${shows.length ? "No shows match your search." : "No show sign-outs yet. Use <b>+ New Show Sign-Out</b> to start one."}</div>`;
        return;
    }
    host.innerHTML = `<div class="show-list">${list.map(s => {
        const open = showOpen.has(s.id) || (q && list.length === 1);
        const total = (s.items || []).reduce((n, i) => n + (+i.qty || 0), 0);
        const status = s.status === "out" ? `<span class="st st-out">Signed out</span>`
            : s.missingCount ? `<span class="st st-missing">Signed in · ${s.missingCount} missing</span>` : `<span class="st st-in">Signed in</span>`;
        let body = "";
        if (open) {
            const signing = canSignIn(s);
            const ticks = showTicks[s.id] || (showTicks[s.id] = new Set());
            body = `<div class="show-body">
                <div class="show-items">${(s.items || []).map((it, i) => {
                    if (signing) return `<label class="show-item ${ticks.has(i) ? "ok" : ""}"><input type="checkbox" data-show="${esc(s.id)}" data-i="${i}" ${ticks.has(i) ? "checked" : ""}>
                        <span>${esc(it.name)}</span><span class="qty">× ${esc(it.qty)}</span></label>`;
                    const ok = s.status === "in" ? !!it.accounted : null;
                    return `<div class="show-item ${ok === true ? "ok" : ok === false ? "miss" : ""}"><span class="mark">${ok === true ? "✓" : ok === false ? "✗" : "•"}</span>
                        <span>${esc(it.name)}</span><span class="qty">× ${esc(it.qty)}${ok === false ? " · missing" : ""}</span></div>`;
                }).join("")}</div>
                <div class="show-foot">
                    <span class="muted small">Signed out ${fmtDateTime(s.signedOutAt)} by ${esc(s.createdByName || s.createdBy)}${s.signedInAt ? ` · signed in ${fmtDateTime(s.signedInAt)} by ${esc(s.signedInBy)}` : ""}</span>
                    ${signing ? `<span class="muted small">${ticks.size}/${(s.items || []).length} accounted for</span>
                        <button type="button" class="btn btn-sm" data-show-all="${esc(s.id)}">Tick all</button>
                        <button type="button" class="btn btn-ok btn-sm" data-signin="${esc(s.id)}">Sign In</button>` : ""}
                </div></div>`;
        }
        return `<div class="show-card">
            <button type="button" class="show-head" data-show-toggle="${esc(s.id)}" aria-expanded="${!!open}">
                <span class="chev ${open ? "open" : ""}">▶</span>
                <span><span class="show-title">${esc(s.title)}</span><br><span class="show-meta">${fmtDate(s.showDate)}${s.venue ? ` · ${venueTag(s.venue)}` : ""} · ${esc(s.createdByName || s.createdBy)} · ${plural((s.items || []).length, "line")}, ${total} pcs</span></span>
                <span class="right">${status}</span>
            </button>${body}</div>`;
    }).join("")}</div>`;
}

$("shows-container").addEventListener("click", async e => {
    const t = e.target.closest("[data-show-toggle]");
    if (t) { const id = t.dataset.showToggle; showOpen.has(id) ? showOpen.delete(id) : showOpen.add(id); return renderShows(); }
    const all = e.target.closest("[data-show-all]");
    if (all) { const s = shows.find(x => x.id === all.dataset.showAll); showTicks[s.id] = new Set((s.items || []).map((_, i) => i)); return renderShows(); }
    const si = e.target.closest("[data-signin]");
    if (si) signInShow(shows.find(x => x.id === si.dataset.signin));
});
$("shows-container").addEventListener("change", e => {
    const c = e.target.closest("[data-show]");
    if (!c) return;
    const set = showTicks[c.dataset.show] || (showTicks[c.dataset.show] = new Set());
    c.checked ? set.add(+c.dataset.i) : set.delete(+c.dataset.i);
    renderShows();
});
$("show-mine").addEventListener("change", renderShows);

async function signInShow(s) {
    if (!s || !canSignIn(s)) return;
    const ticks = showTicks[s.id] || new Set();
    const items = (s.items || []).map((it, i) => ({ ...it, accounted: ticks.has(i) }));
    const missing = items.filter(i => !i.accounted);
    if (missing.length) {
        const ok = await uiConfirm({ title: `Sign in with ${plural(missing.length, "missing item")}?`, danger: true, confirmText: "Sign in anyway",
            message: `These will be recorded as missing:\n${missing.map(m => `• ${m.qty} × ${m.name}`).join("\n")}` });
        if (!ok) return;
    }
    try {
        await commitOps([
            { op: "update", col: "shows", id: s.id, data: { status: "in", items, signedInAt: nowIso(), signedInBy: myEmail(), missingCount: missing.length,
                history: [...(s.history || []), { status: "in", at: nowIso(), by: myEmail() }] } },
            makeLog("Show signed in", { label: s.title }, [], missing.length ? `Missing: ${missing.map(m => `${m.qty}× ${m.name}`).join(", ")}` : "All items accounted for", { ticketId: s.id })
        ]);
        delete showTicks[s.id];
        toast(missing.length ? `Signed in · ${plural(missing.length, "item")} recorded as missing` : "Signed in · everything accounted for");
    } catch (er) { toast(friendlyError(er), "err"); }
}

function openNewShow() {
    if (!can("shows", "signOut")) return;
    const lines = [];
    showModal({
        title: "New show sign-out", body: `
        <form id="sh-form" class="form-stack" novalidate>
            <div class="field"><label for="sh-title">Show / event title *</label><input type="text" id="sh-title" placeholder="e.g. Welcome Concert 2026" autofocus></div>
            <div class="form-grid">
                <div class="field"><label for="sh-date">Show date</label><input type="date" id="sh-date" value="${today()}"></div>
                <div class="field"><label for="sh-venue">Venue *</label><input type="text" id="sh-venue" data-combo="venue" autocomplete="off" placeholder="Search or pick a venue"></div>
            </div>
            <div class="field"><label for="sh-search">Add gear</label>
                <input type="text" id="sh-search" data-combo="equipment" autocomplete="off" placeholder="Type an item name, e.g. SM58, XLR, gaffer tape - then Enter">
                <span class="muted small">Pick from the catalogue or type any miscellaneous item.</span></div>
            <div class="line-list" id="sh-lines"></div>
            <p id="sh-error" class="error-msg hidden"></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">Sign out gear</button></div>
        </form>`,
        onMount(root) {
            const search = root.querySelector("#sh-search");
            const err = m => { const p = root.querySelector("#sh-error"); p.textContent = m || ""; p.classList.toggle("hidden", !m); };
            const renderLines = () => {
                root.querySelector("#sh-lines").innerHTML = lines.length ? lines.map((l, i) => `<div class="line-item">
                    <div class="name">${esc(l.name)}${l.category ? `<span>${esc(l.category)}</span>` : ""}</div>
                    <label class="muted small" for="sh-q-${i}">Qty</label><input type="number" id="sh-q-${i}" min="1" max="999" value="${l.qty}" data-qty="${i}">
                    <button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove">✕</button></div>`).join("")
                    : `<div class="muted small sel-empty">No gear on the list yet.</div>`;
            };
            const addLine = (name, data) => {
                name = String(name || "").trim();
                if (!name) return;
                const ex = lines.find(l => lc(l.name) === lc(name));
                if (ex) ex.qty++; else lines.push({ name, category: data ? data.category : "", qty: 1 });
                search.value = ""; err(""); renderLines();
            };
            search.addEventListener("combo:pick", e => addLine(e.detail.value, e.detail.data));
            search.addEventListener("combo:commit", () => addLine(search.value));
            search.addEventListener("keydown", e => { if (e.key === "Enter" && search.value.trim() && !e.defaultPrevented) { e.preventDefault(); addLine(search.value); } });
            root.querySelector("#sh-lines").addEventListener("input", e => { const q = e.target.dataset.qty; if (q !== undefined) lines[+q].qty = Math.max(1, parseInt(e.target.value, 10) || 1); });
            root.querySelector("#sh-lines").addEventListener("click", e => { const r = e.target.closest("[data-rm]"); if (r) { lines.splice(+r.dataset.rm, 1); renderLines(); } });
            root.querySelector("#sh-form").addEventListener("submit", async e => {
                e.preventDefault();
                if (search.value.trim()) addLine(search.value);
                const title = root.querySelector("#sh-title").value.trim();
                const venue = root.querySelector("#sh-venue").value.trim();
                if (!title) return err("Give the show a title.");
                if (!venue) return err("Choose the venue for this show.");
                if (!lines.length) return err("Add at least one item.");
                const id = store.newId("shows");
                const items = lines.map(l => ({ name: l.name, qty: l.qty, accounted: false }));
                showOpen.add(id); // open the new list so it can be ticked off later
                try {
                    await commitOps([
                        { op: "set", col: "shows", id, data: {
                            title, titleLower: title.toLowerCase(), showDate: root.querySelector("#sh-date").value || today(), venue,
                            createdByUid: authUser.uid, createdBy: myEmail(), createdByName: myName(), signedOutAt: nowIso(), status: "out",
                            items, missingCount: 0, history: [{ status: "out", at: nowIso(), by: myEmail() }] } },
                        makeLog("Show signed out", { label: title }, [], `${venue} · ` + items.map(i => `${i.qty}× ${i.name}`).join(", "), { ticketId: id }),
                        ...venueAddOps(venue)
                    ]);
                    closeDynModal();
                    renderShows();
                    toast(`"${title}" signed out`);
                    if (currentView !== "shows") switchView("shows");
                } catch (er) { err(friendlyError(er)); }
            });
            renderLines();
        }
    });
}

// ---------- Show venues (shared list in settings/venues; new venues typed at sign-out are added) ----------
const venueList = () => {
    const saved = (settings.venues && settings.venues.list) || [];
    return uniq(saved.length ? saved : shows.map(s => s.venue).filter(Boolean)).sort((a, b) => a.localeCompare(b));
};
function venueAddOps(venue) {
    const list = (settings.venues && settings.venues.list) || [];
    if (!venue || list.some(v => lc(v) === lc(venue))) return [];
    return [{ op: "merge", col: "settings", id: "venues", data: { list: [...list, venue], colors: { [venue]: venueColor(venue) } } }];
}
Combo.register("venue", () => {
    const used = countBy(shows, s => s.venue);
    return venueList().map(v => ({ value: v, sub: used[v] ? plural(used[v], "show") : "" }));
});
