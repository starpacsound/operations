// =====================================================================
// Type-or-Select combo-box.
// Any <input data-combo="name"> becomes searchable: focus shows saved values, typing filters them,
// arrow keys + Enter pick one, and anything new can simply be typed.
//
// Sources are registered by name:  Combo.register("space", input => ["Mic Store", ...])
// An option is a string or { value, sub?, group?, disabled?, data? }.
// Attributes:
//   data-combo-strict="1"   value must come from the list (used for picking exact assets)
// Events fired on pick: "input", "change" and "combo:pick" (detail = the option).
// =====================================================================
const Combo = (() => {
    const sources = {};
    let pop = null, input = null, items = [], active = -1, closeTimer = null, silent = false, typed = false;

    const escH = s => String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const usable = el => el && el.matches && el.matches("input[data-combo]") && !el.readOnly && !el.disabled;

    function register(name, fn) { sources[name] = fn; }

    function ensurePop() {
        if (pop) return;
        pop = document.createElement("div");
        pop.className = "combo-pop";
        pop.setAttribute("role", "listbox");
        pop.hidden = true;
        document.body.appendChild(pop);
        pop.addEventListener("mousedown", e => {
            e.preventDefault(); // keep focus in the input
            const o = e.target.closest("[data-i]");
            if (o && !o.classList.contains("disabled")) pick(+o.dataset.i);
            else if (!o) close(); // clicking the hint / empty area just dismisses the list
        });
    }

    function options(inp) {
        const fn = sources[inp.dataset.combo];
        if (!fn) return [];
        const seen = new Set();
        return (fn(inp) || []).map(o => typeof o === "string" ? { value: o } : o)
            .filter(o => o && String(o.value || "").trim())
            .filter(o => { const k = String(o.value).toLowerCase() + "|" + (o.group || ""); if (seen.has(k)) return false; seen.add(k); return true; });
    }

    function render() {
        if (!input) return;
        // On click the full list shows (current value highlighted); typing filters it.
        const q = typed ? input.value.trim().toLowerCase() : "";
        let opts = options(input);
        if (q) {
            const groups = [...new Set(opts.map(o => o.group || ""))];
            opts = opts
                .filter(o => `${o.value} ${o.sub || ""} ${o.search || ""}`.toLowerCase().includes(q))
                .map(o => ({ o, s: String(o.value).toLowerCase().startsWith(q) ? 0 : 1, g: groups.indexOf(o.group || "") }))
                .sort((a, b) => a.g - b.g || a.s - b.s || String(a.o.value).localeCompare(String(b.o.value), undefined, { numeric: true }))
                .map(x => x.o);
        }
        items = opts.slice(0, 80);
        if (active >= items.length) active = items.length - 1;
        const strict = input.dataset.comboStrict === "1";
        const exact = items.some(o => String(o.value).toLowerCase() === q);
        if (q && !items.length && !strict) { pop.hidden = true; return; } // a brand-new value: nothing to suggest, stay out of the way
        if (!typed && active < 0) active = items.findIndex(o => String(o.value).toLowerCase() === input.value.trim().toLowerCase());

        let html = "", lastGroup = null;
        items.forEach((o, i) => {
            if ((o.group || "") !== lastGroup) {
                lastGroup = o.group || "";
                if (lastGroup) html += `<div class="combo-group">${escH(lastGroup)}</div>`;
            }
            html += `<div class="combo-opt${i === active ? " active" : ""}${o.disabled ? " disabled" : ""}" data-i="${i}" role="option">
                <span class="v">${escH(o.value)}</span>${o.sub ? `<span class="s">${escH(o.sub)}</span>` : ""}</div>`;
        });
        if (!items.length) html += `<div class="combo-empty">${q ? (strict ? "No match" : "No saved match") : "Nothing saved yet - type a new value"}</div>`;
        if (q && !exact && !strict) html += `<div class="combo-new">↵ Enter keeps “${escH(input.value.trim())}” as a new value</div>`;
        pop.innerHTML = html;
        pop.hidden = false;
        place();
        const act = pop.querySelector(".combo-opt.active");
        if (act) act.scrollIntoView({ block: "nearest" });
    }

    function place() {
        if (!input || !pop || pop.hidden) return;
        const r = input.getBoundingClientRect();
        if (!r.width) return close();
        const below = window.innerHeight - r.bottom, above = r.top;
        const maxH = Math.min(300, Math.max(below, above) - 12);
        pop.style.maxHeight = maxH + "px";
        pop.style.width = Math.max(r.width, 220) + "px";
        pop.style.left = Math.min(r.left, window.innerWidth - Math.max(r.width, 220) - 8) + "px";
        const h = Math.min(pop.scrollHeight, maxH);
        pop.style.top = (below < h + 8 && above > below ? r.top - h - 4 : r.bottom + 4) + "px";
    }

    function open(inp, byTyping) { clearTimeout(closeTimer); ensurePop(); input = inp; active = -1; typed = !!byTyping; render(); }
    function close() { if (pop) pop.hidden = true; input = null; items = []; active = -1; }

    function pick(i) {
        const o = items[i];
        if (!o || !input) return;
        const inp = input;
        inp.value = o.value;
        close();
        silent = true; // don't let our own input event re-open the list
        try {
            inp.dispatchEvent(new Event("input", { bubbles: true }));
            inp.dispatchEvent(new Event("change", { bubbles: true }));
            inp.dispatchEvent(new CustomEvent("combo:pick", { bubbles: true, detail: o }));
        } finally { silent = false; }
    }

    function init() {
        // Opens on click or typing (not on plain focus, so tabbing through a form doesn't cover the next fields).
        document.addEventListener("mousedown", e => {
            if (usable(e.target) && !(input === e.target && pop && !pop.hidden)) open(e.target);
        });
        document.addEventListener("input", e => {
            if (silent || !usable(e.target)) return;
            if (e.target !== input || !pop || pop.hidden) open(e.target, true);
            else { active = -1; typed = true; render(); }
        });
        document.addEventListener("focusout", e => {
            const t = e.target;
            if (t === input) closeTimer = setTimeout(() => { if (input === t && document.activeElement !== t) close(); }, 120);
        });
        // Capture phase so we win over modal-level Escape / form submit handlers.
        document.addEventListener("keydown", e => {
            if (!usable(e.target)) return;
            if (e.target !== input || !pop || pop.hidden) {
                if (e.key === "ArrowDown") { open(e.target); e.preventDefault(); }
                // Enter in a combo accepts the typed value instead of submitting the form
                else if (e.key === "Enter") { e.preventDefault(); if (e.target.dataset.comboStrict !== "1") e.target.dispatchEvent(new CustomEvent("combo:commit", { bubbles: true })); }
                return;
            }
            if (e.key === "ArrowDown") { active = Math.min(items.length - 1, active + 1); render(); e.preventDefault(); }
            else if (e.key === "ArrowUp") { active = Math.max(-1, active - 1); render(); e.preventDefault(); }
            else if (e.key === "Enter") {
                const q = input.value.trim().toLowerCase();
                const exactIdx = items.findIndex(o => String(o.value).toLowerCase() === q && !o.disabled);
                if (active >= 0 && !items[active].disabled) { e.preventDefault(); e.stopPropagation(); pick(active); }
                else if (input.dataset.comboStrict === "1" && items.filter(o => !o.disabled).length === 1) { e.preventDefault(); e.stopPropagation(); pick(items.findIndex(o => !o.disabled)); }
                else if (exactIdx >= 0) { e.preventDefault(); e.stopPropagation(); pick(exactIdx); }
                else if (input.dataset.comboStrict === "1") { e.preventDefault(); e.stopPropagation(); }
                else { e.preventDefault(); const inp = input; close(); inp.dispatchEvent(new CustomEvent("combo:commit", { bubbles: true })); } // keep the typed value
            }
            else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
            else if (e.key === "Tab") close();
        }, true);
        window.addEventListener("resize", place);
        document.addEventListener("scroll", place, true);
    }

    return { register, init, close, refresh: () => input && render() };
})();
