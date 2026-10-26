// =====================================================================
// Admin: Users & Permissions (approvals + access editor) and Branding
//
// Access editor: pick a person or a role template on the left, tick what they can do on the right,
// then press Save. Nothing is written until Save, so changes can be reviewed and discarded.
// =====================================================================
let accessSel = null;      // "tpl:Member" | user id
let accessDraft = null;    // { role, perm, viewCols, editCols, viewCats, editCats }
let accessBase = "";       // JSON of the saved state the draft started from
let accessQuery = "";

const activeUsers = () => users.filter(u => u.status === "active")
    .sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0) || ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.email.localeCompare(b.email));
const personName = u => u.displayName || u.email.split("@")[0];
const accessDirty = () => !!accessDraft && JSON.stringify(accessDraft) !== accessBase;
const copy = o => JSON.parse(JSON.stringify(o));
const dupCasual = u => !!u.casualId && users.some(x => x.id !== u.id && x.casualId === u.casualId && x.status !== "rejected");

function renderUsers() {
    if (!isAdmin() || !$("pending-users-list")) return;
    const pending = users.filter(u => u.status === "pending").sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const inactive = users.filter(u => !["pending", "active"].includes(u.status));

    $("pending-users-list").innerHTML = pending.length ? pending.map(u => `<tr>
        <td><b>${esc(u.email)}</b><div class="u-sub">${u.emailVerified ? `<span class="ok-tag">✓ email verified</span>` : `<span class="warn-tag" title="They haven't clicked the link in the verification email yet">email not verified yet</span>`}</div></td><td>${esc(u.displayName || "—")}</td>
        <td class="mono nowrap">${u.casualId ? esc(u.casualId) + (dupCasual(u) ? ` <span class="custom-badge" title="Another account uses this Casual ID">duplicate</span>` : "") : `<span class="muted">missing</span>`}</td>
        <td class="nowrap">${fmtDateTime(u.createdAt)}</td>
        <td><select class="role-select" data-role-for="${esc(u.id)}" aria-label="Role for ${esc(u.email)}">${ROLES.slice().reverse().map(r => `<option>${r}</option>`).join("")}</select></td>
        <td class="nowrap"><button type="button" class="btn btn-ok btn-sm" data-uact="approve" data-uid="${esc(u.id)}" ${u.emailVerified ? "" : `disabled title="Can be approved once they verify their email"`}>Approve</button>
            <button type="button" class="btn btn-danger btn-sm" data-uact="reject" data-uid="${esc(u.id)}">Reject</button></td>
    </tr>`).join("") : `<tr><td colspan="6" class="empty-cell">No pending sign-ups</td></tr>`;

    renderAccess();

    $("inactive-users-list").innerHTML = inactive.length ? inactive.map(u => `<tr>
        <td><b>${esc(u.email)}</b></td><td><span class="st st-missing">${esc(u.status)}</span></td>
        <td><button type="button" class="btn btn-sm" data-uact="restore" data-uid="${esc(u.id)}">Move back to pending</button></td></tr>`).join("")
        : `<tr><td colspan="3" class="empty-cell">None</td></tr>`;
}

// ---------- Access editor ----------
function accessSource(id) {
    if (!id) return null;
    if (id.startsWith("tpl:")) { const role = id.slice(4); return TEMPLATE_ROLES.includes(role) ? { tpl: true, role } : null; }
    const u = users.find(x => x.id === id && x.status === "active");
    return u ? { user: u, role: u.role } : null;
}
function savedState(src) {
    if (src.tpl) { const t = roleTemplate(src.role); return { role: src.role, perm: t.perm, viewCols: t.viewCols, editCols: t.editCols, viewCats: t.viewCats, editCats: t.editCats }; }
    const u = src.user;
    return { role: u.role, perm: effectivePerm(u), viewCols: [...(u.viewCols || [])], editCols: [...(u.editCols || [])], viewCats: [...(u.viewCats || [])], editCats: [...(u.editCats || [])] };
}
function loadDraft(id) {
    const src = accessSource(id);
    accessSel = src ? id : null;
    accessDraft = src ? savedState(src) : null;
    accessBase = accessDraft ? JSON.stringify(accessDraft) : "";
}

function accessListItems() {
    const q = lc(accessQuery).trim();
    const tpls = TEMPLATE_ROLES.map(role => ({ id: "tpl:" + role, name: `${role} template`, sub: `What new ${role}s get · ${plural(users.filter(u => u.status === "active" && u.role === role).length, "person")}`, tpl: true }));
    const people = activeUsers().map(u => ({ id: u.id, name: personName(u), sub: `${u.role} · ${u.casualId || "no Casual ID"} · ${loginLabel(u.email, u.displayName)}`, user: u,
        custom: u.role !== "Admin" && differsFromTemplate(u, roleTemplate(u.role)) }));
    const match = it => !q || lc(`${it.name} ${it.sub}`).includes(q);
    return { tpls, people: people.filter(match), total: people.length };   // templates always stay in view
}

function renderAccess() {
    const host = $("access-editor");
    if (!host) return;
    // Keep an in-progress draft through live updates; otherwise follow the saved data.
    if (accessSel && !accessSource(accessSel)) loadDraft(null);
    if (!accessSel) loadDraft("tpl:Member");
    else if (!accessDirty()) loadDraft(accessSel);

    host.innerHTML = `<div class="acc">
        <aside class="acc-list panel" aria-label="People and templates">
            <div class="acc-search"><input type="search" id="acc-search" class="filter-input" placeholder="Search people…" value="${esc(accessQuery)}" aria-label="Search people"></div>
            <div class="acc-items" id="acc-items">${accessItemsHtml()}</div>
        </aside>
        <div class="acc-pane panel" id="acc-pane">${accessPaneHtml()}</div>
    </div>`;
    syncAccessPane();
}

function accessItemsHtml() {
    const { tpls, people, total } = accessListItems();
    const item = it => `<button type="button" class="acc-item ${it.id === accessSel ? "on" : ""} ${it.tpl ? "tpl" : ""}" data-acc-pick="${esc(it.id)}" aria-pressed="${it.id === accessSel}">
        <span class="acc-av">${it.tpl ? "⚙" : esc(initials(it.name.replace(/\(.*?\)/g, "")))}</span>
        <span class="acc-txt"><span class="u-name">${esc(it.name)}${it.user && it.user.isPrimary ? " 👑" : ""}${it.custom ? `<span class="custom-badge">custom</span>` : ""}${it.user && it.user.mustChangePassword ? `<span class="custom-badge" title="Has a temporary password and must set a new one at next sign-in">temp password</span>` : ""}</span><span class="u-sub">${esc(it.sub)}</span></span>
        ${it.id === accessSel && accessDirty() ? `<span class="acc-dot" title="Unsaved changes"></span>` : ""}</button>`;
    return `${tpls.length ? `<p class="acc-group">Role templates</p>${tpls.map(item).join("")}` : ""}
        <p class="acc-group">People <span class="muted">${people.length === total ? total : `${people.length} of ${total}`}</span></p>
        ${people.map(item).join("") || `<p class="muted small acc-none">No one matches “${esc(accessQuery)}”</p>`}`;
}

function accessPaneHtml() {
    const src = accessSource(accessSel);
    if (!src) return `<p class="empty-cell">Pick a person or template on the left.</p>`;
    const d = accessDraft, u = src.user;
    const self = u && u.id === authUser.uid;
    const roleLocked = u && (u.isPrimary || self);
    const isAdm = d.role === "Admin";
    const title = src.tpl ? `${esc(src.role)} template` : esc(personName(u));
    const sub = src.tpl ? `Copied onto people when they're approved as ${esc(src.role)} or moved to this role. Use “Apply” to push changes to existing ${esc(src.role)}s.`
        : `${esc(loginLabel(u.email, u.displayName))} · Casual ID <b class="mono">${esc(u.casualId || "—")}</b>${dupCasual(u) ? ` <span class="custom-badge">duplicate</span>` : ""}
            <button type="button" class="link-btn" data-acc-act="casual">Edit</button>${(crewRoleMap[u.id] || []).length ? ` · Crew roles <b>${(crewRoleMap[u.id]).map(esc).join(" ")}</b> <span class="muted">(ticked in My Availability › Team)</span>` : ""} · <span title="Refreshed about once a day, to keep database reads low">last seen ${u.lastSeen ? fmtDateTime(u.lastSeen) : "never"}</span>`;

    const head = `<div class="acc-head">
        <div><h3>${title}</h3><p class="muted small">${sub}</p></div>
        ${u ? `<div class="field acc-role"><label for="acc-role">Role</label>
            <select id="acc-role" class="role-select" ${roleLocked ? "disabled" : ""}>${ROLES.map(r => `<option ${d.role === r ? "selected" : ""}>${r}</option>`).join("")}</select>
            ${roleLocked ? `<span class="u-sub">${u.isPrimary ? "Primary admin" : "Your own role"} can't be changed</span>` : ""}</div>` : ""}
    </div>`;

    if (isAdm) return `${head}<div class="acc-admin"><b>Full access.</b> Admins can use every feature, see every row and column, and manage users and branding.</div>${accessBar(src)}`;

    const tools = `<div class="acc-tools">
        <input type="search" id="acc-feat-search" class="filter-input" placeholder="Filter features…" aria-label="Filter features">
        <button type="button" class="btn btn-sm" data-acc-bulk="all">Tick everything</button>
        <button type="button" class="btn btn-sm" data-acc-bulk="none">Clear everything</button>
        ${u ? `<button type="button" class="btn btn-sm" data-acc-bulk="template">Reset to ${esc(d.role)} template</button>` : ""}
    </div>`;

    const mods = PERM_MODULES.map(m => `<fieldset class="acc-mod" data-acc-mod="${m.key}">
        <legend><label class="acc-all"><input type="checkbox" data-acc-mall="${m.key}"> <b>${esc(m.label)}</b></label><span class="u-sub" data-acc-count="${m.key}"></span></legend>
        ${m.features.map(f => {
            const locked = isLocked(d.role, m.key, f.key);
            return `<label class="acc-feat ${locked ? "locked" : ""}" data-acc-text="${esc(lc(m.label + " " + f.label))}">
                <input type="checkbox" data-acc-f="${m.key}.${f.key}" ${d.perm[m.key][f.key] ? "checked" : ""} ${locked ? "disabled" : ""}>
                <span><span>${esc(f.label)}${f.srv ? ` <span class="srv" title="Enforced by the server">●</span>` : ""}</span>
                ${locked ? `<span class="u-sub">Not allowed for ${esc(d.role)}s</span>` : f.hint ? `<span class="u-sub">${esc(f.hint)}</span>` : ""}</span></label>`;
        }).join("")}</fieldset>`).join("");

    const has = (list, k) => (d[list] || []).includes(k);
    const fieldRows = ALL_FIELDS.map(f => {
        const isGroup = !ROW_KEYS.includes(f.key);
        return `<tr><td>${esc(f.label)}${isGroup ? ` <span class="muted small">(always visible)</span>` : ""}</td>
            <td class="c"><input type="checkbox" data-acc-view="${f.key}" ${isGroup || has("viewCols", f.key) ? "checked" : ""} ${isGroup ? "disabled" : ""} aria-label="See ${esc(f.label)}"></td>
            <td class="c"><input type="checkbox" data-acc-edit="${f.key}" ${has("editCols", f.key) ? "checked" : ""} aria-label="Edit ${esc(f.label)}"></td></tr>`;
    }).join("");
    const cats = uniq([...allCategories(), ...(d.viewCats || []), ...(d.editCats || [])]).sort();
    const catBoxes = (attr, list) => cats.map(c => `<label class="cat-box"><input type="checkbox" data-${attr}="${esc(c)}" ${has(list, c) ? "checked" : ""}> ${esc(c)}</label>`).join("") || `<span class="muted small">No categories yet</span>`;

    const scope = `<details class="acc-scope" ${accessScopeOpen ? "open" : ""} id="acc-scope">
        <summary><b>Rows &amp; columns</b> <span class="u-sub" id="acc-scope-sum"></span></summary>
        <div class="access-grid">
            <div>
                <p class="muted small">See = shown in tables and exports. Edit = can change it (Condition stays editable even with the edit lock on). Edit implies see.</p>
                <table class="perm-table"><thead><tr><th>Field</th><th class="c">See</th><th class="c">Edit</th></tr></thead><tbody>${fieldRows}</tbody></table>
                <div class="toolbar" style="margin-top:.5rem">
                    <button type="button" class="btn btn-sm" data-acc-bulk="view-all">See all</button>
                    <button type="button" class="btn btn-sm" data-acc-bulk="edit-none">No edit</button>
                    <button type="button" class="btn btn-sm" data-acc-bulk="edit-cond">Condition only</button>
                    <button type="button" class="btn btn-sm" data-acc-bulk="edit-all">Edit all</button>
                </div>
            </div>
            <div class="form-stack">
                <p class="muted small">Leave all unticked for <b>every</b> category. Category visibility is enforced by the server.</p>
                <div class="field"><label>Can see categories</label><div class="cat-list">${catBoxes("acc-vcat", "viewCats")}</div></div>
                <div class="field"><label>Can edit categories</label><div class="cat-list">${catBoxes("acc-ecat", "editCats")}</div></div>
            </div>
        </div>
    </details>`;

    return `${head}${tools}<div class="acc-mods">${mods}</div>${scope}${accessBar(src)}`;
}
let accessScopeOpen = false;

function accessBar(src) {
    const n = src.tpl ? users.filter(u => u.status === "active" && u.role === src.role).length : 0;
    const u = src.user;
    return `<div class="acc-bar">
        <span class="acc-state" id="acc-state"></span>
        ${src.tpl ? `<button type="button" class="btn btn-sm" data-acc-act="apply" ${n ? "" : "disabled"} title="Overwrite these people's access with the saved template">Apply to ${plural(n, src.role)}…</button>` : ""}
        ${u ? `<button type="button" class="btn btn-sm" data-acc-act="resetpw" ${u.isPrimary || u.id === authUser.uid ? `disabled title="${u.isPrimary ? "The primary admin's password can't be reset by others" : "Use Change password (sidebar) for your own account"}"` : ""}>Reset password…</button>` : ""}
        ${u ? `<button type="button" class="btn btn-danger btn-sm" data-uact="disable" data-uid="${esc(u.id)}" ${u.isPrimary || u.id === authUser.uid ? "disabled" : ""}>Disable account</button>` : ""}
        <span class="acc-spacer"></span>
        <button type="button" class="btn btn-ghost" data-acc-act="discard">Discard</button>
        <button type="button" class="btn btn-primary" data-acc-act="save" id="acc-save">Save changes</button>
    </div>`;
}

// Refresh the bits that depend on the draft without rebuilding the pane (keeps focus and scroll).
function syncAccessPane() {
    const pane = $("acc-pane");
    if (!pane || !accessDraft) return;
    const d = accessDraft;
    PERM_MODULES.forEach(m => {
        const all = pane.querySelector(`[data-acc-mall="${m.key}"]`);
        if (!all) return;
        const open = m.features.filter(f => !isLocked(d.role, m.key, f.key));
        const on = open.filter(f => d.perm[m.key][f.key]).length;
        all.checked = on === open.length && on > 0;
        all.indeterminate = on > 0 && on < open.length;
        pane.querySelector(`[data-acc-count="${m.key}"]`).textContent = `${on} of ${open.length}`;
    });
    const sum = $("acc-scope-sum");
    if (sum) sum.textContent = `· see ${d.viewCols.length}/${ROW_KEYS.length} columns, ${d.viewCats.length ? plural(d.viewCats.length, "category") : "all categories"} · edit ${d.editCols.length ? `${d.editCols.length} fields` : "nothing"}`;
    const dirty = accessDirty();
    const st = $("acc-state");
    if (st) { st.textContent = dirty ? `● ${plural(accessChanges().length, "unsaved change")}` : "✓ All changes saved"; st.classList.toggle("dirty", dirty); }
    pane.querySelectorAll("[data-acc-act='save'], [data-acc-act='discard']").forEach(b => { b.disabled = !dirty; });
    const items = $("acc-items");
    if (items) items.innerHTML = accessItemsHtml();
}

// Human-readable list of what the draft changes.
function accessChanges() {
    if (!accessDraft) return [];
    const b = JSON.parse(accessBase), d = accessDraft, out = [];
    if (b.role !== d.role) out.push(`Role ${b.role} → ${d.role}`);
    if (d.role !== "Admin") {
        PERM_MODULES.forEach(m => m.features.forEach(f => {
            if (!!b.perm[m.key][f.key] !== !!d.perm[m.key][f.key]) out.push(`${m.label}: ${f.label} ${d.perm[m.key][f.key] ? "on" : "off"}`);
        }));
        const same = (x = [], y = []) => x.length === y.length && x.every(v => y.includes(v));
        if (!same(b.viewCols, d.viewCols) || !same(b.editCols, d.editCols)) out.push(`Columns: see ${d.viewCols.length}, edit ${d.editCols.length}`);
        if (!same(b.viewCats, d.viewCats) || !same(b.editCats, d.editCats)) out.push(`Categories: ${d.viewCats.length ? d.viewCats.join("/") : "all"}`);
    }
    return out;
}

async function confirmLeaveAccess() {
    if (!accessDirty()) return true;
    return uiConfirm({ title: "Discard unsaved changes?", danger: true, confirmText: "Discard",
        message: `You have ${plural(accessChanges().length, "unsaved change")} for ${accessTitle()}.` });
}
const accessTitle = () => { const s = accessSource(accessSel); return !s ? "" : s.tpl ? `the ${s.role} template` : personName(s.user); };

async function pickAccess(id) {
    if (id === accessSel) return;
    if (!(await confirmLeaveAccess())) return;
    loadDraft(id);
    renderAccess();
    const pane = $("acc-pane");
    if (pane && window.innerWidth < 900) pane.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveAccess() {
    const src = accessSource(accessSel);
    if (!src || !accessDirty()) return;
    const d = accessDraft;
    if (d.viewCats.length > 30) return toast("Pick 30 categories or fewer (or none for all).", "err");
    if (d.viewCats.length) d.editCats = d.editCats.filter(c => d.viewCats.includes(c));
    const changes = accessChanges();
    const note = changes.slice(0, 6).join("; ") + (changes.length > 6 ? `; +${changes.length - 6} more` : "");
    const btn = $("acc-save");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    let ok;
    if (src.tpl) {
        ok = await saveTemplate(src.role, { perm: applyLocks(src.role, copy(d.perm)), viewCols: d.viewCols, editCols: d.editCols, viewCats: d.viewCats, editCats: d.editCats }, note);
    } else {
        const patch = d.role === "Admin" ? { role: "Admin", ...roleTemplate("Admin") }
            : { role: d.role, perm: applyLocks(d.role, copy(d.perm)), viewCols: d.viewCols, editCols: d.editCols, viewCats: d.viewCats, editCats: d.editCats };
        ok = await saveUser(src.user, patch, d.role !== src.user.role ? "Role changed" : "Access changed", note);
    }
    if (ok) {
        toast(`Saved ${accessTitle()} · ${plural(changes.length, "change")}`);
        accessBase = JSON.stringify(accessDraft);  // the live snapshot will refresh the draft too
        renderAccess();
    } else if (btn) { btn.disabled = false; btn.textContent = "Save changes"; }
}

function accessToggleView(key, on) {
    const d = accessDraft;
    if (on) { if (ROW_KEYS.includes(key) && !d.viewCols.includes(key)) d.viewCols.push(key); }
    else { d.viewCols = d.viewCols.filter(k => k !== key); d.editCols = d.editCols.filter(k => k !== key); }
}

function accessBulk(kind) {
    const d = accessDraft, pane = $("acc-pane");
    const setAllFeatures = val => PERM_MODULES.forEach(m => m.features.forEach(f => { d.perm[m.key][f.key] = val && !isLocked(d.role, m.key, f.key); }));
    if (kind === "all") setAllFeatures(true);
    else if (kind === "none") setAllFeatures(false);
    else if (kind === "template") { const t = roleTemplate(d.role); Object.assign(d, { perm: copy(t.perm), viewCols: [...t.viewCols], editCols: [...t.editCols], viewCats: [...t.viewCats], editCats: [...t.editCats] }); }
    else if (kind === "view-all") d.viewCols = [...ROW_KEYS];
    else if (kind === "edit-none") d.editCols = [];
    else if (kind === "edit-cond") { d.editCols = ["condition"]; if (!d.viewCols.includes("condition")) d.viewCols.push("condition"); }
    else if (kind === "edit-all") { d.editCols = [...ALL_FIELD_KEYS]; d.viewCols = [...ROW_KEYS]; }
    accessScopeOpen = !!(($("acc-scope") || {}).open);
    pane.innerHTML = accessPaneHtml();
    syncAccessPane();
}

async function applyTemplateTo(role) {
    if (accessDirty() && !(await uiConfirm({ title: "Save the template first?", message: "Apply uses the saved template. Your unsaved ticks would be ignored.", confirmText: "Save then apply" }))) return;
    if (accessDirty()) await saveAccess();
    const targets = users.filter(u => u.status === "active" && u.role === role);
    if (!(await uiConfirm({ title: `Apply the ${role} template?`, confirmText: `Apply to ${plural(targets.length, "person")}`,
        message: `Overwrites features, rows and columns for:\n${targets.map(u => "• " + u.email).join("\n")}` }))) return;
    const tpl = roleTemplate(role);
    try {
        await commitOps([...targets.map(u => ({ op: "update", col: "users", id: u.id, data: tpl })),
            makeLog("Role template applied", { label: `${role} template` }, [], `${targets.length} people reset to the template`)]);
        toast(`Template applied to ${plural(targets.length, "person")}`);
    } catch (err) { toast(friendlyError(err), "err"); }
}

// ---------- Temporary password ----------
function makeTempPassword() {
    const chars = "abcdefghjkmnpqrstuvwxyz23456789";  // no 0/o, 1/l/i
    const r = new Uint32Array(12);
    crypto.getRandomValues(r);
    const s = Array.from(r, n => chars[n % chars.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

async function resetPasswordFor(u) {
    if (!u || u.isPrimary || u.id === authUser.uid) return;
    const val = await uiConfirm({ title: `Reset password · ${personName(u)}`, confirmText: "Set temporary password",
        message: `${u.email} won't be able to use their old password. With the temporary one they sign in once, then must choose their own before they can use the app.`,
        input: { label: "Temporary password (you can type your own)", value: makeTempPassword(),
            validate: v => v.length < 8 ? "Use at least 8 characters." : v.length > 64 ? "Use 64 characters or fewer." : "" } });
    if (typeof val !== "string") return;
    const flag = { op: "update", col: "users", id: u.id, data: { mustChangePassword: true, tempPasswordSetAt: nowIso(), tempPasswordSetBy: myEmail() } };
    try {
        await store.commit([flag]);                 // flag first: the server only resets flagged accounts
        try { await store.adminSetPassword(u.id, val); }
        catch (err) {
            await store.commit([{ op: "update", col: "users", id: u.id, data: { mustChangePassword: !!u.mustChangePassword } }]).catch(() => {});
            throw err;
        }
        await commitOps([makeLog("Password reset", { label: u.email }, [], "Temporary password issued - must set a new one at next sign-in")]).catch(() => {});
    } catch (err) { return toast(friendlyError(err), "err"); }

    showModal({
        title: "Temporary password set", size: "sm", body: `
        <div class="form-stack">
            <p>Give this to <b>${esc(personName(u))}</b> (${esc(u.email)}) privately. It's shown only now.</p>
            <div class="temp-pw"><code id="tp-code">${esc(val)}</code><button type="button" class="btn btn-sm" id="tp-copy">Copy</button></div>
            <p class="muted small">At their next sign-in they enter it once, then pick a new password of their own.</p>
            <div class="form-actions"><button type="button" class="btn btn-primary" data-close>Done</button></div>
        </div>`,
        onMount(root) {
            root.querySelector("#tp-copy").addEventListener("click", async e => {
                try { await navigator.clipboard.writeText(val); e.target.textContent = "Copied ✓"; }
                catch (er) { e.target.textContent = "Select & copy"; }
            });
        }
    });
}

async function editCasualId(u) {
    const val = await uiConfirm({ title: `Casual ID · ${personName(u)}`, confirmText: "Save",
        input: { label: "Casual ID", value: u.casualId || "", placeholder: "e.g. C20417",
            validate: v => { const n = normCasualId(v); return !n ? "Enter a Casual ID." : !CASUAL_ID_RE.test(n) ? "Letters, numbers, - and / only (up to 30)." : ""; } } });
    if (typeof val !== "string") return;
    const n = normCasualId(val);
    if (n === (u.casualId || "")) return;
    if (await saveUser(u, { casualId: n }, "Access changed", `Casual ID ${u.casualId || "(none)"} → ${n}`)) toast(`Casual ID saved for ${personName(u)}`);
}

async function saveUser(u, patch, logAction, note) {
    try {
        await commitOps([{ op: "update", col: "users", id: u.id, data: patch }, makeLog(logAction, { label: u.email }, [], note || "")]);
        return true;
    } catch (err) { toast(friendlyError(err), "err"); return false; }
}
async function saveTemplate(role, patch, note) {
    try {
        // Replace the role's template wholesale so unticked features are stored as false.
        await commitOps([{ op: "merge", col: "settings", id: "roles", data: { [role]: patch } }, makeLog("Role template changed", { label: `${role} template` }, [], note)]);
        return true;
    } catch (err) { toast(friendlyError(err), "err"); return false; }
}

// Leaving the page with unsaved access changes
window.addEventListener("beforeunload", e => { if (currentView === "users" && accessDirty()) { e.preventDefault(); e.returnValue = ""; } });

$("view-users").addEventListener("input", e => {
    if (e.target.id === "acc-search") { accessQuery = e.target.value; $("acc-items").innerHTML = accessItemsHtml(); return; }
    if (e.target.id === "acc-feat-search") {
        const q = lc(e.target.value).trim();
        document.querySelectorAll("#acc-pane .acc-mod").forEach(fs => {
            let any = false;
            fs.querySelectorAll(".acc-feat").forEach(l => { const hit = !q || l.dataset.accText.includes(q); l.classList.toggle("hidden", !hit); any = any || hit; });
            fs.classList.toggle("hidden", !any);
        });
    }
});

$("view-users").addEventListener("click", async e => {
    const pick = e.target.closest("[data-acc-pick]");
    if (pick) return pickAccess(pick.dataset.accPick);
    const bulk = e.target.closest("[data-acc-bulk]");
    if (bulk && accessDraft) return accessBulk(bulk.dataset.accBulk);
    const act = e.target.closest("[data-acc-act]");
    if (act && accessDraft) {
        const k = act.dataset.accAct;
        if (k === "save") return saveAccess();
        if (k === "discard") { accessScopeOpen = !!(($("acc-scope") || {}).open); loadDraft(accessSel); return renderAccess(); }
        if (k === "apply") return applyTemplateTo(accessSource(accessSel).role);
        if (k === "casual") return editCasualId(accessSource(accessSel).user);
        if (k === "resetpw") return resetPasswordFor(accessSource(accessSel).user);
    }
    const b = e.target.closest("[data-uact]");
    if (!b || !isAdmin()) return;
    const u = users.find(x => x.id === b.dataset.uid);
    if (!u) return;
    const a = b.dataset.uact;
    if (a === "approve") {
        const role = document.querySelector(`[data-role-for="${CSS.escape(u.id)}"]`).value;
        if (await saveUser(u, { ...roleTemplate(role), role, status: "active", approvedBy: myEmail(), approvedAt: nowIso() }, "User approved", `Role: ${role}`))
            toast(`${u.email} approved as ${role}`);
    } else if (a === "reject") {
        if (await uiConfirm({ title: `Reject ${u.email}?`, danger: true, confirmText: "Reject sign-up" }) && await saveUser(u, { status: "rejected" }, "User rejected"))
            toast(`${u.email} rejected`);
    } else if (a === "disable") {
        if (await uiConfirm({ title: `Disable ${u.email}?`, danger: true, confirmText: "Disable", message: "They lose access immediately. You can restore them later." })
            && await saveUser(u, { status: "disabled" }, "User disabled")) { if (accessSel === u.id) loadDraft(null); toast(`${u.email} disabled`); }
    } else if (a === "restore") {
        if (await saveUser(u, { status: "pending" }, "User moved to pending")) toast(`${u.email} is pending again`);
    }
});

$("view-users").addEventListener("change", e => {
    if (!isAdmin() || !accessDraft) return;
    const t = e.target, d = accessDraft;
    if (t.id === "acc-role") {
        const role = t.value;
        if (role === "Admin") d.role = "Admin";
        else { const tpl = roleTemplate(role); Object.assign(d, { role, perm: copy(tpl.perm), viewCols: [...tpl.viewCols], editCols: [...tpl.editCols], viewCats: [...tpl.viewCats], editCats: [...tpl.editCats] }); }
        toast(role === "Admin" ? "Admins get full access - press Save to confirm" : `Loaded the ${role} template - adjust if needed, then Save`);
        accessScopeOpen = !!(($("acc-scope") || {}).open);
        $("acc-pane").innerHTML = accessPaneHtml();
        return syncAccessPane();
    }
    if (t.dataset.accF) { const [m, f] = t.dataset.accF.split("."); d.perm[m][f] = t.checked; }
    else if (t.dataset.accMall) {
        const m = PERM_MODULES.find(x => x.key === t.dataset.accMall);
        m.features.forEach(f => { if (!isLocked(d.role, m.key, f.key)) d.perm[m.key][f.key] = t.checked; });
        $("acc-pane").querySelectorAll(`[data-acc-f^="${m.key}."]`).forEach(cb => { const f = cb.dataset.accF.split(".")[1]; cb.checked = !!d.perm[m.key][f]; });
    }
    else if (t.dataset.accView) { accessToggleView(t.dataset.accView, t.checked); if (!t.checked) { const ed = document.querySelector(`[data-acc-edit="${t.dataset.accView}"]`); if (ed) ed.checked = false; } }
    else if (t.dataset.accEdit) {
        const k = t.dataset.accEdit;
        d.editCols = t.checked ? uniq([...d.editCols, k]) : d.editCols.filter(x => x !== k);
        if (t.checked) { accessToggleView(k, true); const v = document.querySelector(`[data-acc-view="${k}"]`); if (v) v.checked = true; }
    }
    else if (t.dataset.accVcat !== undefined) d.viewCats = t.checked ? uniq([...d.viewCats, t.dataset.accVcat]) : d.viewCats.filter(x => x !== t.dataset.accVcat);
    else if (t.dataset.accEcat !== undefined) d.editCats = t.checked ? uniq([...d.editCats, t.dataset.accEcat]) : d.editCats.filter(x => x !== t.dataset.accEcat);
    else return;
    syncAccessPane();
});

// =====================================================================
// BRANDING
// =====================================================================
let brandDraft = null;

function renderBranding() {
    const host = $("branding-form");
    if (!host || !isAdmin()) return;
    if (!brandDraft) brandDraft = { appName: appName(), logo: (settings.app && settings.app.logo) || "" };
    const mark = (cls) => `<div class="brand-mark ${cls || ""} ${brandDraft.logo ? "has-logo" : ""}">${brandDraft.logo ? `<img src="${esc(brandDraft.logo)}" alt="">` : esc(initials(brandDraft.appName))}</div>`;
    host.innerHTML = `<div class="brand-editor">
        <form class="panel form-stack" id="br-form" novalidate>
            <div class="field"><label for="br-name">App name</label><input type="text" id="br-name" maxlength="40" value="${esc(brandDraft.appName)}"></div>
            <div class="field"><label>Logo</label>
                <div class="logo-drop" id="br-drop" tabindex="0" role="button" aria-label="Upload logo">
                    ${mark()}
                    <div><b>Click or drop an image</b><div class="muted small">PNG, JPG, SVG or WebP. Resized to 256 px and stored with your settings.</div></div>
                </div>
                <input type="file" id="br-file" accept="image/*" hidden>
                ${brandDraft.logo ? `<button type="button" class="link-btn" id="br-remove">Remove logo (use initials)</button>` : ""}
            </div>
            <p id="br-error" class="error-msg hidden"></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" id="br-reset">Discard changes</button><button type="submit" class="btn btn-primary">Save branding</button></div>
        </form>
        <div>
            <p class="preview-label">Sidebar</p>
            <div class="preview-side">${mark()}<div class="brand-text"><span class="brand-name-text">${esc(brandDraft.appName || "Untitled")}</span><span class="brand-sub">Gear, Shows &amp; Crew</span></div></div>
            <p class="preview-label">Sign-in screen</p>
            <div class="preview-login">${mark("lg")}<b>${esc(brandDraft.appName || "Untitled")}</b><span class="muted small">Gear, Shows &amp; Crew</span></div>
        </div></div>
        ${venuesPanelHtml()}
        ${conditionsPanelHtml()}
        ${bundlesPanelHtml()}`;
    bindVenuesPanel();
    bindConditionsPanel();
    $("bd-build").addEventListener("click", buildBundles);

    const err = m => { const p = $("br-error"); p.textContent = m || ""; p.classList.toggle("hidden", !m); };
    $("br-name").addEventListener("input", e => { brandDraft.appName = e.target.value; document.querySelectorAll(".brand-editor .brand-name-text, .preview-login b").forEach(el => { el.textContent = e.target.value || "Untitled"; }); if (!brandDraft.logo) document.querySelectorAll(".brand-editor .brand-mark").forEach(el => { el.textContent = initials(e.target.value); }); });
    const drop = $("br-drop");
    drop.addEventListener("click", () => $("br-file").click());
    drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("br-file").click(); } });
    drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("drag"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
    drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("drag"); if (e.dataTransfer.files[0]) loadLogo(e.dataTransfer.files[0]); });
    $("br-file").addEventListener("change", e => { if (e.target.files[0]) loadLogo(e.target.files[0]); });
    if ($("br-remove")) $("br-remove").addEventListener("click", () => { brandDraft.logo = ""; renderBranding(); });
    $("br-reset").addEventListener("click", () => { brandDraft = null; renderBranding(); });
    $("br-form").addEventListener("submit", async e => {
        e.preventDefault();
        const name = brandDraft.appName.trim();
        if (!name) return err("Give the app a name.");
        try {
            await commitOps([
                { op: "merge", col: "settings", id: "app", data: { appName: name, logo: brandDraft.logo || "", updatedBy: myEmail(), updatedAt: nowIso() } },
                makeLog("Branding updated", { label: name }, [], brandDraft.logo ? "Name and logo saved" : "Name saved, no logo")
            ]);
            brandDraft = null;
            toast("Branding saved - everyone sees it now");
        } catch (er) { err(friendlyError(er)); }
    });

    function loadLogo(file) {
        if (!/^image\//.test(file.type)) return err("That file isn't an image.");
        if (file.size > 5 * 1024 * 1024) return err("Use an image under 5 MB.");
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const max = 256, s = Math.min(1, max / Math.max(img.width, img.height));
                const c = document.createElement("canvas");
                c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
                c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
                let url = c.toDataURL("image/png");
                if (url.length > 300000) url = c.toDataURL("image/webp", 0.9);
                if (url.length > 300000) return err("That image is too detailed to store. Try a simpler logo.");
                brandDraft.logo = url;
                err("");
                renderBranding();
            };
            img.onerror = () => err("Couldn't read that image.");
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    }
}

// ---------- Show venues (the searchable list on Show Sign-Out) ----------
const savedVenues = () => ((settings.venues && settings.venues.list) || []).slice().sort((a, b) => a.localeCompare(b));
function venuesPanelHtml() {
    const list = savedVenues();
    return `<h2 class="section-title">Show venues</h2>
    <div class="panel form-stack venue-panel">
        <p class="muted small">The venue list people search when signing gear out for a show. Venues typed at sign-out are added automatically; remove typos here. Each venue keeps one colour on every page - tap the dot to change it.</p>
        <form id="vn-form" class="vn-add" novalidate><input type="text" id="vn-new" maxlength="60" placeholder="Add a venue, e.g. LT3" aria-label="New venue"><button type="submit" class="btn btn-sm">Add venue</button></form>
        <div class="cat-list" id="vn-list">${list.map(v => `<span class="cat-box"><label class="vn-pick" title="Colour for ${esc(v)}"><i class="vn-dot" style="--vc:${venueColor(v)}"></i><input type="color" data-vn-color="${esc(v)}" value="${venueColor(v)}" aria-label="Colour for ${esc(v)}"></label>${esc(v)} <button type="button" class="icon-btn" data-vn-rm="${esc(v)}" aria-label="Remove ${esc(v)}">✕</button></span>`).join("") || `<span class="muted small">No venues yet</span>`}</div>
    </div>`;
}
async function saveVenues(list, action, label, colors) {
    // keep colours of removed venues too, so past shows don't change colour
    colors = colors || { ...((settings.venues && settings.venues.colors) || {}), ...venueColorsFor(list) };
    try {
        await commitOps([{ op: "set", col: "settings", id: "venues", data: { list, colors } }, makeLog(action, { label }, [], "Show venue list")]);
        return true;
    } catch (er) { toast(friendlyError(er), "err"); return false; }
}
function bindVenuesPanel() {
    $("vn-form").addEventListener("submit", async e => {
        e.preventDefault();
        const v = $("vn-new").value.trim();
        if (!v) return;
        if (savedVenues().some(x => lc(x) === lc(v))) return toast(`${v} is already on the list`, "err");
        if (await saveVenues([...savedVenues(), v], "Venue added", v)) toast(`Added ${v}`);
    });
    $("vn-list").addEventListener("change", async e => {
        const c = e.target.closest("[data-vn-color]");
        if (!c) return;
        const v = c.dataset.vnColor, hex = c.value.toLowerCase();
        const colors = { ...((settings.venues && settings.venues.colors) || {}), ...venueColorsFor(savedVenues()), [v]: hex };
        if (await saveVenues(savedVenues(), "Venue colour changed", v, colors)) toast(`${v} colour updated`);
    });
    $("vn-list").addEventListener("click", async e => {
        const b = e.target.closest("[data-vn-rm]");
        if (!b) return;
        const v = b.dataset.vnRm;
        if (await saveVenues(savedVenues().filter(x => x !== v), "Venue removed", v)) toast(`Removed ${v} - past shows keep their venue`);
    });
}

// ---------- Asset conditions (settings/conditions; built-ins can't be renamed or removed) ----------
const condUse = name => inventory.filter(a => a.condition === name).length;
const condColorSelect = (c, attrs) => `<select ${attrs}>${Object.entries(COND_COLORS).map(([k, v]) => `<option value="${k}" ${c === k ? "selected" : ""}>${v}</option>`).join("")}</select>`;
function conditionsPanelHtml() {
    return `<h2 class="section-title">Asset conditions</h2>
    <div class="panel form-stack cond-panel">
        <p class="muted small">The conditions an asset can have. The 9 built-in ones are used by loans, repairs and checks, so their names are fixed, but you can change their short label and colour. Add your own (e.g. <b>Upgraded</b>) for anything else. <b>Counts as retired</b> hides the asset from Inventory Check rounds and the location tree, like Sold and Decommissioned. Imports match a condition by its name or short label.</p>
        <div class="table-scroll"><table class="data-table cond-table">
            <thead><tr><th>Condition</th><th>Short label</th><th>Colour</th><th>Counts as retired</th><th>Assets</th><th></th></tr></thead>
            <tbody id="cd-list">${conditionList.map(c => {
                const b = isBuiltinCondition(c.name), n = condUse(c.name);
                return `<tr data-cd="${esc(c.name)}">
                    <td><span class="pill ${condClass(c.name)}">${esc(c.name)}</span>${b ? ` <span class="muted small">built-in</span>` : ""}</td>
                    <td><input type="text" maxlength="12" value="${esc(c.short)}" data-cd-short aria-label="Short label for ${esc(c.name)}"></td>
                    <td>${condColorSelect(c.color, `data-cd-color aria-label="Colour for ${esc(c.name)}"`)}</td>
                    <td><input type="checkbox" data-cd-retired ${c.retired ? "checked" : ""} ${b ? "disabled" : ""} aria-label="${esc(c.name)} counts as retired"></td>
                    <td>${n}</td>
                    <td class="nowrap">${b ? "" : `<button type="button" class="btn btn-ghost btn-sm" data-cd-rename>Rename</button> <button type="button" class="icon-btn" data-cd-rm aria-label="Remove ${esc(c.name)}">✕</button>`}</td></tr>`;
            }).join("")}</tbody></table></div>
        <form id="cd-form" class="cd-add" novalidate>
            <input type="text" id="cd-name" maxlength="30" placeholder="New condition, e.g. Upgraded" aria-label="New condition">
            <input type="text" id="cd-short" maxlength="12" placeholder="Short label" aria-label="Short label">
            ${condColorSelect("warn", `id="cd-color" aria-label="Colour"`)}
            <label class="check-inline"><input type="checkbox" id="cd-retired"> Counts as retired</label>
            <button type="submit" class="btn btn-sm">Add condition</button>
        </form>
    </div>`;
}
const condRow = c => ({ name: c.name, short: c.short, color: c.color, retired: !!c.retired });
function condNameProblem(name, except) {
    if (!name) return "Type a name.";
    if (name.length > 30) return "Keep it under 30 characters.";
    const slug = condClass(name);
    if (slug === "cond-") return "Use letters or numbers.";
    if (conditionList.some(c => c.name !== except && (lc(c.name) === lc(name) || condClass(c.name) === slug))) return `${name} is already on the list.`;
    return "";
}
async function saveConditions(list, action, label, extraOps) {
    try {
        await commitOps([...(extraOps || []), { op: "set", col: "settings", id: "conditions", data: { list: list.map(condRow), updatedAt: nowIso(), updatedBy: myEmail() } },
            makeLog(action, { label }, [], "Asset conditions")]);
        return true;
    } catch (er) { toast(friendlyError(er), "err"); return false; }
}
function bindConditionsPanel() {
    $("cd-form").addEventListener("submit", async e => {
        e.preventDefault();
        const name = $("cd-name").value.trim().replace(/\s+/g, " ");
        const bad = condNameProblem(name);
        if (bad) return toast(bad, "err");
        const c = { name, short: $("cd-short").value.trim() || name, color: $("cd-color").value, retired: $("cd-retired").checked };
        if (await saveConditions([...conditionList, c], "Condition added", name)) toast(`Added ${name}`);
    });
    $("cd-list").addEventListener("change", async e => {
        const tr = e.target.closest("[data-cd]");
        if (!tr) return;
        const name = tr.dataset.cd;
        const list = conditionList.map(c => c.name !== name ? c : {
            ...c, short: tr.querySelector("[data-cd-short]").value.trim() || c.name, color: tr.querySelector("[data-cd-color]").value,
            retired: isBuiltinCondition(name) ? c.retired : tr.querySelector("[data-cd-retired]").checked });
        if (await saveConditions(list, "Condition changed", name)) toast(`${name} updated`);
    });
    $("cd-list").addEventListener("click", async e => {
        const tr = e.target.closest("[data-cd]");
        if (!tr || isBuiltinCondition(tr.dataset.cd)) return;
        const name = tr.dataset.cd, n = condUse(name);
        if (e.target.closest("[data-cd-rm]")) {
            if (n) return toast(`${plural(n, "asset")} still ${n === 1 ? "has" : "have"} ${name}. Change ${n === 1 ? "it" : "them"} to another condition first.`, "err");
            if (!(await uiConfirm({ title: `Remove ${name}?`, confirmText: "Remove", message: "No asset has this condition. Past records that mention it keep the text." }))) return;
            if (await saveConditions(conditionList.filter(c => c.name !== name), "Condition removed", name)) toast(`Removed ${name}`);
            return;
        }
        if (e.target.closest("[data-cd-rename]")) {
            const next = await uiConfirm({ title: `Rename ${name}`, confirmText: "Rename",
                message: n ? `${plural(n, "asset")} with ${name} will change to the new name too.` : "",
                input: { label: "New name", value: name, required: true, validate: v => v === name ? "Type a different name." : condNameProblem(v.replace(/\s+/g, " "), name) } });
            if (!next) return;
            const to = next.replace(/\s+/g, " ");
            const assetOps = inventory.filter(a => a.condition === name).map(a => ({ op: "update", col: "inventory", id: a.id, data: { condition: to } }));
            const list = conditionList.map(c => c.name !== name ? c : { ...c, name: to, short: c.short === name ? to : c.short });
            if (await saveConditions(list, "Condition renamed", `${name} → ${to}`, assetOps)) toast(`Renamed to ${to}${n ? ` on ${plural(n, "asset")}` : ""}`);
        }
    });
}

// ---------- Inventory bundles (read-saving copies, see bundles.js) ----------
function bundlesPanelHtml() {
    const st = Bundles.stats;
    const status = bundlesLegacy
        ? `<p class="av-banner warn">Not built yet. Every time someone opens the app it reads each asset separately (${inventory.length} reads). Build the bundles once before you import your full inventory, or straight after.</p>`
        : `<p class="muted small"><b>Built.</b> ${plural(st.bundles, "bundle")} for ${plural(inventory.length, "asset")} you can see. This session: ${plural(st.reads, "read")} for inventory (${st.bundleDownloads} bundle downloads, ${st.assetReads} single assets), ${st.fromCache} bundles used from this browser's copy.</p>`;
    return `<h2 class="section-title">Inventory bundles</h2>
    <div class="panel form-stack" id="bd-panel">
        <p class="muted small">Assets are also stored in a few large records grouped by category (up to ${Bundles.MAX_ASSETS.toLocaleString()} each), and each browser keeps a copy. Opening the app then costs a few reads instead of one per asset. Saves keep the bundles up to date automatically.</p>
        ${status}
        <div><button type="button" class="btn btn-sm" id="bd-build">${bundlesLegacy ? "Build bundles" : "Rebuild bundles"}</button></div>
        <p class="muted small">Building reads every asset once (one read each) and takes a few seconds. Rebuild only if something looks out of step; everyone's app then downloads fresh bundles once.</p>
    </div>`;
}
async function buildBundles() {
    if (!isAdmin()) return;
    const ok = await uiConfirm({ title: bundlesLegacy ? "Build inventory bundles?" : "Rebuild inventory bundles?", confirmText: bundlesLegacy ? "Build" : "Rebuild",
        message: `This reads every asset once and writes the bundles. Do it at a quiet time: saves made while it runs may need a rebuild.` });
    if (!ok) return;
    const btn = $("bd-build");
    if (btn) { btn.disabled = true; btn.textContent = "Building…"; }
    try {
        const all = await store.getAll("inventory");
        const prev = await store.getDoc("invMeta", "changes");
        const { bundles, meta } = Bundles.build(all, prev ? prev.seq : 0);
        // Big records: send a few per batch (Firestore caps one request at about 10 MB).
        let group = [], size = 0;
        const flush = async () => { if (group.length) await store.commitPlain(group); group = []; size = 0; };
        for (const [bid, b] of Object.entries(bundles)) {
            const sz = JSON.stringify(b).length;
            if (size + sz > 4000000) await flush();
            group.push({ op: "set", col: "invBundles", id: bid, data: b }); size += sz;
        }
        await flush();
        const gone = prev ? Object.keys(prev.bundles || {}).filter(bid => !bundles[bid]) : [];
        await store.commitPlain(keepUsefulLogs([...gone.map(bid => ({ op: "delete", col: "invBundles", id: bid })),
            { op: "set", col: "invMeta", id: "changes", data: meta },
            makeLog(prev ? "Inventory bundles rebuilt" : "Inventory bundles built", { label: "Inventory bundles" }, [], `${all.length} assets in ${Object.keys(bundles).length} bundles`)]));
        toast(`Bundles ready: ${all.length} assets in ${Object.keys(bundles).length} bundles`);
    } catch (err) {
        console.error(err);
        toast("Couldn't build the bundles: " + friendlyError(err), "err");
    }
    if (currentView === "branding") renderBranding();
}

function initials(name) {
    const w = String(name || "").trim().split(/\s+/).filter(Boolean);
    return ((w[0] || "S")[0] + (w[1] ? w[1][0] : (w[0] || "SB")[1] || "")).toUpperCase();
}
