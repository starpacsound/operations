"""End-to-end browser test of v4.1 in offline demo mode (?demo).
Run:  npm run serve   (or: python3 -m http.server 8765 --directory public)
      python3 tests/e2e_demo.py [url] [screenshot-dir]
"""
import datetime, os, sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8765/index.html?demo"
SHOTS = sys.argv[2] if len(sys.argv) > 2 else None
results, errors = [], []


def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name)


def login(page, email):
    page.click(f"[data-demo='{email}']")
    page.wait_for_selector("#app-screen:not(.hidden)")


def logout(page):
    page.click(".sidebar-foot .foot-row .btn:not(.theme-btn)")
    page.wait_for_selector("#login-screen:not(.hidden)")


def go(page, view):
    page.click(f".nav-item[data-view={view}]")
    page.wait_for_timeout(120)


def dialog_ok(page, text=None):
    page.wait_for_selector("#dlg-form")
    if text is not None:
        page.fill("#dlg-input", text)
    page.click("#dlg-ok")
    page.wait_for_timeout(150)


def combo_pick(page, selector, typed, option_text=None):
    page.click(selector)
    page.fill(selector, typed)
    page.wait_for_selector(".combo-pop:not([hidden]) .combo-opt")
    loc = page.locator(".combo-pop .combo-opt:not(.disabled)", has_text=option_text) if option_text else page.locator(".combo-pop .combo-opt:not(.disabled)")
    loc.first.click()
    page.wait_for_timeout(80)


def ev(page, js):
    return page.evaluate(js)


def logs_has(page, js):
    # Log History only starts loading when its page is first opened (v5.1)
    ev(page, "startLogs()"); page.wait_for_timeout(150)
    return ev(page, js)


def asset(page, label, field=None):
    a = ev(page, f"inventory.find(a => a.internalAssetNo === {label!r})")
    return a[field] if (a and field) else a


def shot(page, name):
    if SHOTS:
        page.screenshot(path=f"{SHOTS}/{name}.png")


def open_group(page, model):
    g = page.locator(".asset-group", has_text=model).first
    if g.locator("table").count() == 0:
        g.locator(".group-head").click()
    return page.locator(".asset-group", has_text=model).first


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get("CHROME") or None)
    page = browser.new_page(viewport={"width": 1440, "height": 950}, accept_downloads=True, color_scheme="dark")
    page.on("console", lambda m: m.type == "error" and "ERR_" not in m.text and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e.stack or e)))
    page.on("dialog", lambda d: (errors.append("native dialog used: " + d.message), d.dismiss()))
    page.goto(BASE)
    page.wait_for_selector("#login-screen:not(.hidden)")

    # ---- theme switch ----
    check("follows device theme until chosen", ev(page, "currentTheme()") == "dark" and ev(page, "document.documentElement.getAttribute('data-theme')") is None)
    page.click(".auth-theme")
    check("switch flips to light", ev(page, "document.documentElement.getAttribute('data-theme')") == "light")
    bg = ev(page, "getComputedStyle(document.body).backgroundColor")
    check("light palette applied", bg == "rgb(238, 241, 245)")
    page.reload(); page.wait_for_selector("#login-screen:not(.hidden)")
    check("theme choice persists after reload", ev(page, "document.documentElement.getAttribute('data-theme')") == "light")
    page.click(".auth-theme")
    check("switch back to dark", ev(page, "currentTheme()") == "dark")

    # ---- username login for the host ----
    check("host username maps to its sign-in address", ev(page, "loginToEmail('  Starpacsound   Admin ')") == "starpacsound.admin@showbase.local"
          and ev(page, "loginToEmail('Someone@Gmail.com')") == "someone@gmail.com")
    check("sign-in box takes email or username", page.inner_text("#auth-email-label") == "Email or username")
    page.fill("#auth-email", "Starpacsound Admin"); page.click("#forgot-link"); page.wait_for_timeout(80)
    check("forgot password explains username reset", "Showbase admin" in page.inner_text("#auth-info"))
    page.fill("#auth-email", "")
    # ---- sign-up needs a Casual ID ----
    page.click(".seg-tab[data-tab=signup]")
    check("sign-up asks for Casual ID", page.is_visible("#auth-casual"))
    check("sign-up marks every field compulsory", all(t.strip().endswith("*") for t in page.locator("#auth-form .field:visible label").all_inner_texts()))
    err = lambda: (page.click("#auth-submit"), page.wait_for_timeout(80), page.inner_text("#auth-error"))[2]
    check("name is compulsory", "full name" in err())
    page.fill("#auth-name", "Test Signup")
    check("Casual ID checked next", "Casual ID" in err())
    page.fill("#auth-casual", "C3107")
    check("email is compulsory", "email address" in err())
    page.fill("#auth-email", "not-an-email@x")
    check("email must look like an email", "doesn't look right" in err())
    page.fill("#auth-email", "signup@showbase.com")
    check("password is compulsory", "password" in err().lower())
    page.fill("#auth-password", "short1")
    check("password at least 8 characters", "8 characters" in err())
    page.fill("#auth-password", "secret123")
    check("confirm password is compulsory", "again" in err())
    page.fill("#auth-casual", "")
    page.fill("#auth-name", "Test Signup"); page.fill("#auth-email", "signup@showbase.com")
    page.fill("#auth-password", "secret123"); page.fill("#auth-password2", "secret123")
    page.click("#auth-submit"); page.wait_for_timeout(120)
    check("Casual ID is compulsory", "Casual ID" in page.inner_text("#auth-error") and page.is_visible("#login-screen"))
    page.fill("#auth-casual", "C3107"); page.fill("#auth-email", "Starpacsound Admin"); page.click("#auth-submit"); page.wait_for_timeout(80)
    check("sign-up needs a real email, not a username", "email address" in page.inner_text("#auth-error"))
    page.fill("#auth-email", "x@showbase.local"); page.click("#auth-submit"); page.wait_for_timeout(80)
    check("username domain reserved at sign-up", "reserved" in page.inner_text("#auth-error"))
    page.fill("#auth-email", "signup@showbase.com")
    page.fill("#auth-casual", "c 31 07")
    page.click("#auth-submit")
    page.wait_for_selector("#gate-screen:not(.hidden)")
    check("sign-up stores Casual ID (upper-case, no spaces)", ev(page, "profile && profile.casualId") == "C3107")
    check("new account must verify its email first", "Verify your email" in page.inner_text("#gate-title") and page.is_visible("#verify-resend"))
    page.click("#verify-check"); page.wait_for_timeout(120)
    check("checking before clicking the link says not yet", "Not verified yet" in page.inner_text("#gate-msg"))
    page.click("#verify-resend"); page.wait_for_timeout(100)
    check("verification email can be resent", "Sent again" in page.inner_text("#gate-msg"))
    page.click("#verify-demo"); page.wait_for_timeout(200)
    check("after verifying: waiting for Admin approval", "Awaiting approval" in page.inner_text("#gate-title") and ev(page, "profile.emailVerified") is True)
    page.click("#gate-signout"); page.wait_for_selector("#login-screen:not(.hidden)")
    page.click(".seg-tab[data-tab=signin]")

    # ================= ADMIN =================
    login(page, "admin@showbase.com")
    page.wait_for_selector(".asset-group")
    check("Template button removed", "Template" not in page.inner_text("#view-catalogue .toolbar") and ev(page, "typeof downloadCSVTemplate") == "undefined")
    tb = page.inner_text("#view-catalogue .toolbar")
    check("Add Asset sits after Import / Export / Edit", tb.index("Import") < tb.index("Export") < tb.index("Edit:") < tb.index("Add Asset"))

    # Year of purchase column + lock toggle
    g = open_group(page, "SM58")
    heads = g.locator("thead").inner_text().upper()
    check("Year of Purchase column right after Condition", heads.index("CONDITION") < heads.index("YEAR OF PURCHASE"))
    ys = g.locator(".year-select").first
    check("year locked while Edit is off", ys.is_disabled())
    check("condition still editable while Edit is off", not g.locator(".cond-select").first.is_disabled())
    page.locator("#view-catalogue .edit-toggle").click()
    g = open_group(page, "SM58")
    g.locator(".year-select").nth(2).select_option("2025")
    page.wait_for_timeout(150)
    check("year editable with Edit on, saved", asset(page, "SM58 #3", "yearOfPurchase") == "2025")
    page.locator("#view-catalogue .edit-toggle").click()

    # Year filter + finance view
    opts = page.locator("#filter-year option").all_inner_texts()
    check("Year filter sits beside Condition filter", "Needs finance code" in opts and "2026" in opts)
    page.click("[data-mix=year]")
    check("mix panel has a Year of purchase tab", page.locator(".finance-chip").count() == 1)
    page.click(".finance-chip")
    shown = ev(page, "getFiltered().map(a => a.internalAssetNo)")
    check("'Needs finance code' = year set, no code", len(shown) >= 2 and all(ev(page, f"needsFinance(inventory.find(a => a.internalAssetNo === {s!r}))") for s in shown))
    page.select_option("#filter-year", "2023")
    check("filter by a purchase year", set(ev(page, "getFiltered().map(a => a.model)")) == {"DPA 4060"})
    page.click("[data-clear]")
    check("Clear all resets year filter too", page.input_value("#filter-year") == "ALL")
    page.click("[data-mix=condition]")
    shot(page, "catalogue")

    # Rack Layout: assets with no space / location go under TBC
    go(page, "rack")
    tbc = page.locator(".rack-space", has=page.locator("h2", has_text="TBC"))
    check("unplaced assets grouped under TBC", tbc.count() == 1 and "Stage Boxes" in tbc.inner_text() and tbc.locator(".tbc-tag").count() >= 1)
    check("TBC listed after the real spaces", page.locator(".rack-space h2").last.inner_text().startswith("TBC"))
    go(page, "catalogue")

    # Add Asset menu: General asset
    page.click("#add-asset-btn")
    check("Add Asset offers Detailed and General", page.is_visible("[data-add=detailed]") and page.is_visible("[data-add=general]"))
    page.click("[data-add=general]")
    page.wait_for_selector("#ga-form")
    page.fill("#ga-name", "Speakon 5m"); page.fill("#ga-cat", "Cables")
    page.fill("#ga-space", "Cable Store"); page.fill("#ga-loc", "Drawer 6")
    page.fill("#ga-qty", "30")
    page.locator("#ga-form").evaluate("f => f.requestSubmit()")   # a combo list may still overlap the button
    page.wait_for_timeout(120)
    check("general asset needs a description", page.is_visible("#ga-form") and "description" in page.inner_text("#ga-form .error-msg")
          and not ev(page, "inventory.some(a => a.model === 'Speakon 5m')"))
    page.fill("#ga-desc", "5 m NL4 speaker cable")
    page.locator("#ga-form").evaluate("f => f.requestSubmit()")
    page.wait_for_timeout(150)
    rec = ev(page, "inventory.find(a => a.model === 'Speakon 5m')")
    check("general asset = one record with quantity", rec and rec["kind"] == "general" and rec["qty"] == 30 and rec["serialNo"] == "")
    check("general asset description saved", rec and rec["description"] == "5 m NL4 speaker cable")
    check("Total Qty counts the quantity", "Total Qty: 30" in page.locator(".asset-group", has_text="Speakon 5m").inner_text())
    page.click("#add-asset-btn"); page.click("[data-add=detailed]")
    check("Detailed option opens the full form", page.is_visible("#asset-modal") and page.is_visible("#form-serial-no") and not page.is_visible("#form-qty"))
    page.click("#asset-modal .btn-ghost")

    # On Loan from the catalogue -> linked loan
    g = open_group(page, "CL5")
    cl5 = asset(page, "CL5 #1", "id")
    page.locator(f".cond-select[data-id='{cl5}']").select_option("On Loan")
    page.wait_for_selector("#cl-form")
    check("choosing On Loan opens the loan pop-up", page.is_visible("#cl-who"))
    page.click("#dyn-modal [data-close]")
    page.wait_for_timeout(150)
    check("cancelling keeps the old condition", asset(page, "CL5 #1", "condition") == "Available" and page.locator(f".cond-select[data-id='{cl5}']").input_value() == "Available")
    page.locator(f".cond-select[data-id='{cl5}']").select_option("On Loan")
    page.wait_for_selector("#cl-form")
    page.click("#cl-form button[type=submit]")
    check("borrower name is required", "borrower" in page.inner_text("#cl-error").lower())
    page.fill("#cl-who", "Wei Ling (Drama Club)")
    page.click("#cl-form button[type=submit]")
    page.wait_for_timeout(150)
    loan = ev(page, f"loans.find(l => (l.assigned || []).some(u => u.assetId === {cl5!r}) && l.status === 'collected')")
    check("loan created + linked, asset On Loan", loan and loan["source"] == "catalogue" and loan["borrowerName"] == "Wei Ling (Drama Club)" and asset(page, "CL5 #1", "condition") == "On Loan")
    go(page, "loans")
    card = page.locator(".card", has_text="Wei Ling (Drama Club)").filter(has_text="Yamaha CL5")
    check("linked loan visible in Equipment Loans with borrower", card.count() == 1 and "Lent from the catalogue" in card.inner_text())
    go(page, "catalogue")
    open_group(page, "CL5")
    page.locator(f".cond-select[data-id='{cl5}']").select_option("Available")
    dialog_ok(page)
    check("setting it back closes the loan as returned", ev(page, f"loans.find(l => l.id === {loan['id']!r}).status") == "returned" and asset(page, "CL5 #1", "condition") == "Available")

    # Inventory check: venue round -> history -> PDF -> delete
    check("ticks aren't loaded outside Inventory Check", ev(page, "ticksUnsub === null && Object.keys(checks).length === 0"))
    go(page, "check")
    check("open round per venue shown", page.locator(".round-chip", has_text="Cable Store").count() == 1)
    check("opening Inventory Check loads the round's ticks from its shared record", ev(page, "!!ticksUnsub && !!checks['aud-open_demo-19'] && checks['aud-open_demo-19'].byName === 'Marcus'"))
    check("all 4 seeded ticks load (1 record read)", ev(page, "Object.keys(checks).filter(k => k.startsWith('aud-open_')).length") == 4)
    go(page, "catalogue")
    check("leaving Inventory Check stops the ticks", ev(page, "ticksUnsub === null && Object.keys(checks).length === 0"))
    go(page, "check")
    page.click("text=Start new round")
    page.wait_for_selector("#nr-form")
    venues = page.locator("#nr-venue option").all_inner_texts()
    check("venue list comes from Item Space", any(v.startswith("Warehouse") for v in venues) and any(v.startswith("Mic Store") for v in venues))
    page.select_option("#nr-venue", "Warehouse")
    page.fill("#nr-name", "Test count")
    page.click("#nr-form button[type=submit]")
    page.wait_for_timeout(200)
    check("second venue round runs alongside the first", page.locator(".round-chip").count() == 2 and "Warehouse" in page.inner_text("#check-round"))
    in_scope = ev(page, "roundScope(curRound()).every(a => a.itemSpace === 'Warehouse')")
    check("round only covers its venue", in_scope)
    first = page.locator("#check-container .check-box").first.get_attribute("data-id")
    page.locator(f".check-box[data-id='{first}']").check()
    page.wait_for_timeout(150)
    check("tick saved against the round", ev(page, f"isChecked({first!r})"))
    rec = ev(page, f"(async () => {{ const r = curRound(); const d = await store.getDoc('checkTicks', r.id + '_' + tickShard({first!r}, r.shards)); return d && {{ last: d.last, t: d.ticks[{first!r}], shards: r.shards }}; }})()")
    check("tick is a field in the round's shared record (one record per ~200 assets)", rec and rec["last"] == first and rec["t"]["checked"] is True and rec["t"]["byUid"] and rec["shards"] >= 1)
    second = page.locator("#check-container .check-box").nth(1).get_attribute("data-id")
    page.locator(f".check-box[data-id='{second}']").check()
    page.wait_for_timeout(150)
    check("a second tick keeps the first", ev(page, f"isChecked({first!r}) && isChecked({second!r})"))
    page.locator(f".check-box[data-id='{second}']").uncheck()
    page.wait_for_timeout(150)
    check("unticking clears only that asset", ev(page, f"isChecked({first!r}) && !isChecked({second!r})"))
    wh = ev(page, "curRound().id")
    page.click("#check-round .btn-ok")
    dialog_ok(page)
    check("finished round leaves Current rounds", page.locator(".round-chip", has_text="Warehouse").count() == 0)
    check("finishing clears the round's tick records", ev(page, f"store.getAll('checkTicks', {{ where: [['roundId', '==', {wh!r}]] }}).then(r => r.length)") == 0)
    page.click("[data-check-tab=history]")
    row = page.locator("#check-history tr", has_text="Test count")
    check("finished round saved to History", row.count() == 1 and "1/" in row.inner_text())
    with page.expect_download() as dl:
        row.locator("[data-hist=pdf]").click()
    path = dl.value.path()
    check("check summary downloads as PDF", dl.value.suggested_filename.startswith("Inventory_Check_Warehouse") and open(path, "rb").read(5) == b"%PDF-")
    if SHOTS:
        import shutil; shutil.copy(path, f"{SHOTS}/audit.pdf")
    row.locator("[data-hist=view]").click()
    check("history record opens with per-item results", page.locator("#dyn-modal .st-missing").count() >= 1)
    page.click("#dyn-modal .btn-ghost")
    row.locator("[data-hist=delete]").click()
    dialog_ok(page)
    check("history persists until explicitly deleted", page.locator("#check-history tr", has_text="Test count").count() == 0 and page.locator("#check-history tr", has_text="September").count() == 1)
    page.click("[data-check-tab=current]")

    # Maintenance repairing filters
    go(page, "maintenance")
    check("repair list has several jobs", page.locator("#repair-body tr").count() == 3)
    page.select_option("#repair-vendor", "Audio House SG")
    check("filter by vendor", page.locator("#repair-body tr").count() == 2 and "2 of 3" in page.inner_text("#repair-count"))
    start = (datetime.date.today() - datetime.timedelta(days=20)).isoformat()
    page.fill("#repair-from", start); page.dispatch_event("#repair-from", "change")
    check("filter by sent-date range", page.locator("#repair-body tr").count() == 1)
    page.click("#repair-clear")
    page.fill("#repair-search", "capsule")
    check("search repair jobs", page.locator("#repair-body tr").count() == 1 and "DPA" in page.inner_text("#repair-body"))
    page.click("#repair-clear")
    shot(page, "maintenance")

    # Access editor: pick a person -> tick -> Save
    go(page, "users")
    check("pending list shows Casual ID", "C20788" in page.inner_text("#pending-users-list"))
    unv = page.locator("#pending-users-list tr", has_text="unverified@showbase.com")
    check("pending list shows who hasn't verified, and blocks approving them", "not verified" in unv.inner_text() and unv.locator("[data-uact=approve]").is_disabled())
    check("verified sign-ups can be approved", page.locator("#pending-users-list tr", has_text="newhire@showbase.com").locator("[data-uact=approve]").is_enabled())
    page.fill("#acc-search", "C20533")
    check("people search matches Casual ID", page.locator(".acc-item:not(.tpl)").count() == 1 and "Priya" in page.inner_text("#acc-items"))
    page.click("[data-acc-pick='u-crew']")
    page.click("[data-acc-act='casual']")
    page.fill("#dlg-input", "bad id!"); page.click("#dlg-ok"); page.wait_for_timeout(80)
    check("Casual ID edit validates", page.is_visible("#dlg-err"))
    page.fill("#dlg-input", "c 20999"); page.click("#dlg-ok"); page.wait_for_timeout(150)
    check("admin edits Casual ID (normalised)", ev(page, "users.find(u => u.id === 'u-crew').casualId") == "C20999")
    page.fill("#acc-search", "")
    check("editor lists templates and people", page.locator("[data-acc-pick='tpl:Member']").count() == 1 and page.locator("[data-acc-pick='u-member']").count() == 1)
    page.fill("#acc-search", "marcus")
    check("people search narrows the list", page.locator(".acc-item:not(.tpl)").count() == 1)
    page.click("[data-acc-pick='u-member']")
    check("picking a person opens their access", "Marcus" in page.inner_text("#acc-pane h3") and page.locator(".acc-mod").count() == 9)
    check("Calendar box is in the editor", "Calendar" in page.inner_text("[data-acc-mod=events]"))
    page.uncheck("[data-acc-f='events.view']"); page.click("#acc-save"); page.wait_for_timeout(300)
    check("admin can hide the Calendar tab from a member", ev(page, "effectivePerm(users.find(u => u.id === 'u-member')).events.view") is False)
    page.check("[data-acc-f='events.view']"); page.click("#acc-save"); page.wait_for_timeout(300)
    page.locator("[data-acc-f='maintenance.viewAll']").check()
    page.locator("[data-acc-f='rack.view']").uncheck()
    check("ticks are a draft until Save", ev(page, "effectivePerm(users.find(u => u.id === 'u-member')).maintenance.viewAll") is False
          and "2 unsaved changes" in page.inner_text("#acc-state"))
    check("Member can't be given everyone's shows", page.locator("[data-acc-f='shows.viewAll']").is_disabled())
    page.click("[data-acc-pick='tpl:Member']")
    check("switching with unsaved changes asks first", page.is_visible("#dlg-form"))
    page.click("#dlg-cancel"); page.wait_for_timeout(120)
    check("cancel keeps the draft", "Marcus" in page.inner_text("#acc-pane h3") and page.locator("[data-acc-f='maintenance.viewAll']").is_checked())
    page.click("#acc-save"); page.wait_for_timeout(200)
    m = ev(page, "effectivePerm(users.find(u => u.id === 'u-member'))")
    check("Save writes every ticked change at once", m["maintenance"]["viewAll"] is True and m["rack"]["view"] is False and "saved" in page.inner_text("#acc-state").lower())
    check("access change logged", logs_has(page, "logs.some(l => l.action === 'Access changed' && /Rack Layout/.test(l.note))"))
    page.fill("#acc-search", "")
    page.click("[data-acc-pick='tpl:Member']")
    page.locator("[data-acc-mall='logs']").check()
    check("module tick sets every feature", page.locator("[data-acc-f='logs.view']").is_checked() and page.locator("[data-acc-f='logs.pdf']").is_checked())
    page.click("[data-acc-act='discard']"); page.wait_for_timeout(120)
    check("discard drops the draft", not page.locator("[data-acc-f='logs.view']").is_checked() and ev(page, "roleTemplate('Member').perm.logs.view") is False)
    page.fill("#acc-feat-search", "repair")
    check("feature filter narrows the list", page.locator(".acc-feat:not(.hidden)").count() == 2)
    page.fill("#acc-feat-search", "")
    go(page, "branding")
    page.fill("#vn-new", "LT3"); page.click("#vn-form button[type=submit]"); page.wait_for_timeout(150)
    page.click("[data-vn-rm='Outdoor Plaza']"); page.wait_for_timeout(150)
    check("admin manages the show venue list", ev(page, "settings.venues.list.includes('LT3') && !settings.venues.list.includes('Outdoor Plaza')"))
    shot(page, "matrix")
    logout(page)

    # ================= MEMBER (Marcus: can see all requests, no Rack tab) =================
    login(page, "member@showbase.com")
    page.wait_for_selector(".asset-group")
    check("hidden tab disappears from nav", not page.is_visible(".nav-item[data-view=rack]"))
    check("no Add Asset / Edit for members", not page.is_visible("#add-asset-btn") and not page.is_visible(".edit-toggle"))
    go(page, "maintenance")
    check("viewAll: member sees everyone's Requests", page.inner_text("#maint-sections h3").startswith("Requests") and page.locator(".maint-section.stage-request tbody tr", has_text="Marcus").count() >= 1)
    check("submit-only member can't see Confirmed / Repairing", page.locator(".maint-section.stage-confirmed").count() == 0 and not page.is_visible("#maint-repair"))
    check("submitting still allowed", page.is_visible(".maint-submit-only"))
    go(page, "loans")
    page.click("text=+ Request Loan")
    check("loan request captures borrower name", page.input_value("#ln-who") == "Marcus")
    combo_pick(page, "#ln-search", "sm58")
    page.fill("#ln-who", "Choir CCA - Marcus")
    page.click("#ln-form button[type=submit]")
    page.wait_for_timeout(150)
    check("borrower name saved and shown", ev(page, "loans.some(l => l.borrowerName === 'Choir CCA - Marcus')") and page.locator(".card", has_text="Choir CCA - Marcus").count() == 1)
    # Show sign-out: venue is required and searchable; members only see their own
    go(page, "shows")
    check("member only sees own show sign-outs", ev(page, "shows.length > 0 && shows.every(s => s.createdByUid === 'u-member')")
          and "Orientation Night" not in page.inner_text("#shows-container") and not page.is_visible(".shows-all-only"))
    page.click("text=+ New Show Sign-Out")
    page.wait_for_selector("#sh-form")
    page.fill("#sh-title", "Choir Recital")
    page.fill("#sh-search", "Gaffer tape"); page.press("#sh-search", "Enter")
    try: page.wait_for_selector("#sh-lines .line-item", timeout=3000)
    except Exception: page.press("#sh-search", "Enter"); page.wait_for_selector("#sh-lines .line-item", timeout=3000)
    page.locator("#sh-form").evaluate("f => f.requestSubmit()"); page.wait_for_timeout(100)
    check("venue is compulsory", page.is_visible("#sh-form") and "venue" in page.inner_text("#sh-error"))
    combo_pick(page, "#sh-venue", "nanyang", "Nanyang Auditorium")
    check("venue picked from the shared searchable list", page.input_value("#sh-venue") == "Nanyang Auditorium")
    page.locator("#sh-form").evaluate("f => f.requestSubmit()")
    try: page.wait_for_function("shows.some(s => s.title === 'Choir Recital')", timeout=4000)
    except Exception: print("  sh-error:", page.inner_text("#sh-error") if page.is_visible("#sh-error") else "-")
    check("show saved with venue", ev(page, "shows.some(s => s.title === 'Choir Recital' && s.venue === 'Nanyang Auditorium')"))

    # Availability: mark days, see bookings, withdraw soft, confirmed locked
    check("new bookings badge on the Availability tab", page.is_visible("#badge-avail"))
    go(page, "availability")
    check("member never loads crew role ticks", ev(page, "Object.keys(crewRoleMap).length") == 0 and page.locator(".av-role-h, .av-role").count() == 0)
    check("member sees calendar, not the team roster", page.locator(".av-cell[data-av-day]").count() >= 28 and page.locator("[data-av-tab=team]").count() == 0)
    mb = page.locator(".my-bookings li", has_text="Welcome Concert 2026")
    check("member sees show name, time, venue and their role", mb.count() == 1 and "1400–1700" in mb.inner_text() and "LT1" in mb.inner_text() and "you: ST" in mb.inner_text())
    mb.locator("summary").click()
    check("member sees teammates on the show", "Farah (Co-Admin) - SE" in mb.inner_text())
    check("new bookings are announced", page.locator(".av-banner").count() == 1 and page.locator(".av-book-list li").count() >= 2)
    go(page, "events"); ev(page, "availMonth = thisMonth(); renderEvents()"); page.wait_for_timeout(150)
    check("member's Calendar shows only their own shows", ev(page, "eventJobs().every(j => (j.crewUids || []).includes(authUser.uid))")
          and page.locator(".ev-chip", has_text="Welcome Concert").count() == 1 and page.locator(".ev-chip.kind-maint").count() == 0)
    ev(page, "profile = { ...profile, perm: { ...profile.perm, events: { view: false, viewAll: false } } }; applyRoleVisibility()")
    check("member without 'See the tab' has no Calendar tab", page.locator(".nav-item[data-view=events]").is_hidden() and not ev(page, "canOpenView('events')"))
    ev(page, "profile = { ...profile, perm: { ...profile.perm, events: { view: true, viewAll: false } } }; applyRoleVisibility()")
    go(page, "availability")
    page.click("[data-av-month='1']")
    free = page.locator(".av-cell.st-N:not(.past)").first
    day = free.get_attribute("data-av-day"); nxt = ev(page, "availMonth")
    check("no time choice bar at the top any more", page.locator("[data-av-brush]").count() == 0)
    free.click(); page.wait_for_selector("#hp-form")
    check("tapping a date opens a pop-up: all day / certain times", page.locator(".hp-opt").count() == 2 and page.locator("[name=hp][value=all]").is_checked())
    page.click("#hp-form button[type=submit]"); page.wait_for_timeout(150)
    check("all day saves the day as available", ev(page, f"(myAvailDoc('{nxt}') || {{avail: []}}).avail.includes('{day}')")
          and not ev(page, f"!!(myAvailDoc('{nxt}').times || {{}})['{day}']") and "st-A" in page.locator(f".av-cell[data-av-day='{day}']").get_attribute("class"))
    page.click(f".av-cell[data-av-day='{day}']"); page.wait_for_selector("#hp-form")
    check("tapping a marked day offers Not available too", page.locator(".hp-opt").count() == 3)
    page.click(".hp-opt:has([value=time])"); page.fill("#hp-from", "6pm"); page.click("#hp-form button[type=submit]"); page.wait_for_timeout(80)
    check("certain times need both times", "until" in page.inner_text("#hp-error"))
    page.fill("#hp-to", "5pm"); page.click("#hp-form button[type=submit]"); page.wait_for_timeout(80)
    check("end must be after start", "after" in page.inner_text("#hp-error"))
    page.fill("#hp-to", "2300"); page.click("#hp-form button[type=submit]"); page.wait_for_timeout(150)
    check("certain times saved and shown on the day", ev(page, f"myAvailDoc('{nxt}').times['{day}']") == "18:00-23:00"
          and "1800–2300" in page.locator(f".av-cell[data-av-day='{day}']").inner_text())
    page.click(f".av-cell[data-av-day='{day}']"); page.wait_for_selector("#hp-form")
    check("pop-up remembers the hours", page.locator("[name=hp][value=time]").is_checked() and page.input_value("#hp-from") == "1800")
    page.fill("#hp-from", ""); page.click("#hp-from"); page.wait_for_selector(".combo-pop:not([hidden]) .combo-opt")
    try: page.wait_for_function("() => { const o = document.querySelector('.combo-pop:not([hidden]) .combo-opt'); return o && o.textContent.trim().startsWith('0000'); }", timeout=6000)
    except Exception: print("DEBUG first opts:", page.locator(".combo-pop .combo-opt").all_inner_texts()[:4], repr(page.input_value("#hp-from")))
    opts = page.locator(".combo-pop .combo-opt").all_inner_texts()
    if not (len(opts) >= 48 and opts[-1].strip() == "2330"): print("DEBUG opts", len(opts), opts[:3], opts[-3:])
    check("time list = 24-hour times only, in order 0000 ... 2330", len(opts) >= 48 and opts[0].strip() == "0000" and opts[1].strip() == "0030"
          and opts[-1].strip() == "2330" and all(o.strip().isdigit() and len(o.strip()) == 4 for o in opts))
    page.keyboard.press("Escape")
    page.fill("#hp-from", "0500"); page.fill("#hp-to", "0000"); page.click("#hp-form button[type=submit]"); page.wait_for_timeout(150)
    check("early start and end 0000 (midnight) accepted", ev(page, f"myAvailDoc('{nxt}').times['{day}']") == "05:00-23:59"
          and "0500–0000" in page.locator(f".av-cell[data-av-day='{day}']").inner_text())
    page.click(f".av-cell[data-av-day='{day}']"); page.wait_for_selector("#hp-form")
    page.click(".hp-opt:has([value=none])"); page.click("#hp-form button[type=submit]"); page.wait_for_timeout(150)
    check("Not available unmarks the day", not ev(page, f"myAvailDoc('{nxt}').avail.includes('{day}')") and not ev(page, f"!!(myAvailDoc('{nxt}').times || {{}})['{day}']"))
    page.click("[data-av-bulk=all]"); page.wait_for_selector("#hp-form")
    page.click(".hp-opt:has([value=time])"); page.fill("#hp-from", "9am"); page.fill("#hp-to", "5pm"); page.click("#hp-form button[type=submit]"); page.wait_for_timeout(150)
    check("mark all remaining days asks for hours once", ev(page, f"myAvailDoc('{nxt}').avail.length") >= 28 and ev(page, f"myAvailDoc('{nxt}').times['{day}']") == "09:00-17:00")
    page.click("[data-av-bulk=clear]"); dialog_ok(page)
    check("clear keeps booked days", ev(page, f"myAvailDoc('{nxt}').avail.length === myAvailDoc('{nxt}').soft.length + myAvailDoc('{nxt}').conf.length"))
    page.click("[data-av-month='0']")
    soft = page.locator(".av-cell.st-S:not(.past)").first
    if soft.count() == 0:
        page.click("[data-av-month='1']"); soft = page.locator(".av-cell.st-S:not(.past)").first
    sday = soft.get_attribute("data-av-day"); sm = ev(page, "availMonth")
    soft.click(); dialog_ok(page)
    check("member withdraws from a soft booking", ev(page, f"myAvailDoc('{sm}').withdrawn.includes('{sday}') && !myAvailDoc('{sm}').soft.includes('{sday}')"))
    conf = ev(page, "availMine.find(d => (d.conf || []).some(x => !isPastDay(d.month, x)))")
    availMonthGo = conf["month"]; cday = [x for x in conf["conf"] if ev(page, f"!isPastDay('{availMonthGo}', '{x}')")][0]
    ev(page, f"availMonth = '{availMonthGo}'; renderAvailability()")
    page.click(f".av-cell[data-av-day='{cday}']"); page.wait_for_timeout(150)
    check("confirmed day is locked for the member", ev(page, f"myAvailDoc('{availMonthGo}').conf.includes('{cday}')") and page.locator(".toast", has_text="confirmed booking").count() >= 1)
    go(page, "check")
    check("members can't start rounds or see history", not page.is_visible(".rounds-only") and not page.is_visible("[data-check-tab=history]"))
    logout(page)

    # ================= RESTRICTED =================
    login(page, "crew@showbase.com")
    page.wait_for_selector(".asset-group")
    check("restricted: Loans tab hidden", not page.is_visible(".nav-item[data-view=loans]"))
    check("restricted: only permitted categories loaded", ev(page, "Array.from(new Set(inventory.map(a => a.category))).sort()") == ["Wired Mics", "Wireless Mics"])
    logout(page)

    # ================= CO-ADMIN books people =================
    login(page, "coadmin@showbase.com")
    go(page, "availability")
    page.click("[data-av-tab=team]"); page.wait_for_timeout(150)
    check("team roster lists people with Casual ID", page.locator(".av-grid tbody tr").count() >= 3 and "C20417" in page.inner_text(".av-grid"))
    check("co-admin sees the Sheet's role ticks as columns", page.locator(".av-role-h").count() == 4
          and page.locator(".av-grid tbody tr", has_text="Marcus").locator(".av-role.on").count() == 2)
    page.select_option("#av-role", "CRS"); page.wait_for_timeout(100)
    check("filter roster by role", page.locator(".av-grid tbody tr").count() == 2)
    page.select_option("#av-role", ""); page.wait_for_timeout(100)
    check("withdrawn soft bookings are flagged", page.locator(".av-gc.wd").count() >= 1 and page.locator(".av-banner.warn").count() == 1)
    page.click("[data-av-month='1']")
    # a day Marcus hasn't marked and Priya is free but not booked (demo data moves with today's date)
    bday = ev(page, """(() => {
        const p = availGrid.find(d => d.uid === 'u-crew') || { avail: [], soft: [], conf: [] };
        const cells = [...document.querySelectorAll(".av-gc.st-N[data-av-book='u-member']")].map(c => c.dataset.day);
        return cells.find(x => !(p.soft || []).includes(x) && !(p.conf || []).includes(x)) || cells[0]; })()""")
    cell = page.locator(f".av-gc.st-N[data-av-book='u-member'][data-day='{bday}']"); bm = ev(page, "availMonth"); bdate = f"{bm}-{bday}"
    rec = lambda uid: ev(page, f"availGrid.find(d => d.uid === '{uid}') || {{soft: [], conf: [], avail: []}}")
    gala = lambda: ev(page, f"monthJobs.find(j => j.title === 'Gala Dinner' && j.date === '{bdate}')")
    # 1) book Marcus onto a brand-new show, typed in
    cell.click(); page.wait_for_selector("#dm-form")
    check("clicking a day opens the booking form", page.is_visible("#dm-title") and page.is_visible("#dm-venue") and page.input_value("#dm-role") == "SE")
    page.click("#dm-form button[type=submit]"); page.wait_for_timeout(80)
    check("show name required", "show name" in page.inner_text("#dm-error"))
    page.fill("#dm-title", "Gala Dinner"); page.fill("#dm-start", "6pm"); page.fill("#dm-end", "2230")
    combo_pick(page, "#dm-venue", "lt2", "LT2")
    page.click("#dm-mp-add"); page.fill("[data-mp-role='0']", "ST"); page.fill("[data-mp-qty='0']", "2")
    page.click("#dm-mp-add"); page.fill("[data-mp-role='1']", "CRS"); page.fill("[data-mp-qty='1']", "1")
    page.fill("#dm-role", "ST")
    page.click("[data-dm-state='C']")
    page.click("#dm-form button[type=submit]"); page.wait_for_timeout(200)
    g = gala()
    check("new show saved with times parsed, venue, manpower", g and g["start"] == "18:00" and g["end"] == "22:30" and g["venue"] == "LT2"
          and g["manpower"] == [{"role": "ST", "qty": 2}, {"role": "CRS", "qty": 1}])
    check("person booked on it with their role + confirmed", g and g["crew"][0]["uid"] == "u-member" and g["crew"][0]["role"] == "ST" and bday in rec("u-member")["conf"])
    check("new show name remembered for type-and-select", "Gala Dinner" in ev(page, "settings.rosterLists.titles"))
    check("grid cell shows the show", page.locator(f".av-gc[data-av-book='u-member'][data-day='{bday}']").inner_text().strip() == "GA")
    # 2) book Priya onto the same show by picking it
    page.locator(f".av-gc[data-av-book='u-crew'][data-day='{bday}']").click(); page.wait_for_selector("#dm-form")
    check("shows already on that date are offered", page.locator("#dm-sameday [data-dm-pick]", has_text="Gala Dinner").count() == 1)
    page.click("#dm-sameday [data-dm-pick]")
    check("picking it fills and locks the details", page.input_value("#dm-start") == "1800" and page.locator("#dm-title").is_disabled())
    page.fill("#dm-role", "CRS")
    page.click("#dm-form button[type=submit]"); page.wait_for_timeout(200)
    # Depending on today's date, the demo may have Priya free only at certain hours that day: accept the warning.
    if page.is_visible("#dlg-form") and "Outside their available hours" in page.inner_text("#dialog-host"):
        page.click("#dlg-ok"); page.wait_for_timeout(200)
    check("second person joins the same show", len(gala()["crew"]) == 2 and bday in rec("u-crew")["soft"])
    # 3) one show per day; maintenance call allowed on top
    page.locator(f".av-gc[data-av-book='u-member'][data-day='{bday}']").click(); page.wait_for_selector("#dm-form")
    check("only one show per person per day", page.locator("[data-dm-kind='show']").is_disabled() and page.is_visible("#dm-one-show"))
    check("their current show is listed", page.locator(".job-card", has_text="Gala Dinner").count() == 1)
    page.fill("#dm-title", "Maintenance call"); page.fill("#dm-start", "10am"); page.fill("#dm-end", "12pm"); page.fill("#dm-role", "ST")
    page.click("#dm-form button[type=submit]"); page.wait_for_timeout(200)
    check("maintenance call added on the same day", ev(page, f"jobsOfPerson('u-member', '{bdate}').map(j => j.kind).sort().join()") == "maint,show")
    # 4) compiled list
    page.click("[data-av-tab=shows]"); page.wait_for_timeout(150)
    grp = page.locator(".job-group", has_text="Gala Dinner")
    check("Shows list: name, time, venue, manpower filled vs needed", grp.count() == 1 and "1800–2230" in grp.inner_text() and "LT2" in grp.inner_text()
          and grp.locator(".mp-chip.short", has_text="ST 1/2").count() == 1 and grp.locator(".mp-chip", has_text="CRS 1/1").count() == 1)
    grp.locator(".job-head").click(); page.wait_for_timeout(100)
    grp = page.locator(".job-group", has_text="Gala Dinner")
    check("expanding lists people, roles, status", grp.locator("tbody tr").count() == 2 and "Confirmed" in grp.inner_text() and "Soft" in grp.inner_text())
    # 5) change the time once -> everyone on it
    grp.locator("[data-jb-edit]").click(); page.wait_for_selector("#je-form")
    page.fill("#je-start", "7pm"); page.click("#je-form button[type=submit]")
    page.wait_for_selector("#dlg-form")
    check("asks before updating everyone", "Everyone booked" in page.inner_text("#dlg-form") and "Marcus" in page.inner_text("#dlg-form"))
    page.click("#dlg-ok")
    try: page.wait_for_function(f"(monthJobs.find(j => j.title === 'Gala Dinner' && j.date === '{bdate}') || {{}}).start === '19:00'", timeout=5000)
    except Exception: pass
    check("one edit updates the show for all booked", (gala() or {}).get("start") == "19:00" and len((gala() or {}).get("crew", [])) == 2)
    check("show edits aren't logged (bookings live in the Sheets)", not logs_has(page, "logs.some(l => l.action === 'Show details changed')"))
    # 6) add someone free that day from the list, then remove them
    grp = page.locator(".job-group", has_text="Gala Dinner")
    if grp.locator("tbody tr").count() == 0: grp.locator(".job-head").click()
    opts = grp.locator("[data-jb-person] option").all_inner_texts()
    check("'add someone' lists only people free that day", all("Marcus" not in o and "Priya" not in o for o in opts))
    grp.locator("tr", has_text="Priya").locator("[data-jb-remove]").click(); dialog_ok(page)
    check("remove from show frees their day", len(gala()["crew"]) == 1 and bday not in rec("u-crew")["soft"])
    # 7) bookings without a show (e.g. from the Sheet)
    page.click("[data-av-month='0']"); page.wait_for_timeout(150)
    check("bookings without show details are listed", page.locator(".needs-details li").count() >= 1)
    page.locator(".needs-details [data-jb-day]").first.click(); page.wait_for_selector("#dm-form")
    check("'Add details' opens the booking form", page.is_visible("#dm-title"))
    page.click("#dyn-modal .form-actions [data-close]")
    page.click("[data-av-tab=team]"); page.wait_for_timeout(100)
    page.click(f".av-dh[data-av-dayfilter='{bday}']"); page.wait_for_timeout(100)
    check("click a date to see who's free", ev(page, "availDay") == bday)
    page.fill("#av-search", "C20533"); page.wait_for_timeout(100)
    check("roster search by Casual ID", page.locator(".av-grid tbody tr").count() <= 1)
    page.fill("#av-search", "")
    shot(page, "availability-team")
    # Calendar tab: of shows / maintenance calls
    go(page, "events")
    ev(page, "availMonth = thisMonth(); renderEvents()"); page.wait_for_timeout(150)
    check("Calendar tab shows shows and maintenance calls", page.locator(".ev-chip", has_text="Welcome Concert").count() == 1
          and page.locator(".ev-chip.kind-maint").count() >= 1 and page.locator(".nav-item[data-view=plan]").count() == 0)
    page.locator(".ev-chip", has_text="Welcome Concert").click(); page.wait_for_selector("#dyn-modal")
    check("clicking an event shows time, venue and crew with roles", "1400–1700" in page.inner_text("#dyn-modal") and "LT1" in page.inner_text("#dyn-modal")
          and page.locator("#dyn-modal .ev-crew li").count() == 2 and "Open plan" not in page.inner_text("#dyn-modal"))
    page.click("#dyn-modal .form-actions [data-close]")
    page.click("[data-ev-mode=list]"); page.wait_for_timeout(100)
    check("list view with manpower filled vs needed", page.locator(".ev-row", has_text="Welcome Concert").locator(".mp-chip").count() >= 2)
    page.click("[data-ev-mode=calendar]"); page.wait_for_timeout(100)
    chip_vc = page.locator(".ev-chip", has_text="Welcome Concert").evaluate("e => e.style.getPropertyValue('--vc')")
    legend = page.inner_text("#events-container .av-legend")
    check("show chips use their venue colour; legend lists venues, no 'Short of crew'",
          chip_vc == ev(page, "venueColor('LT1')") and chip_vc == "#4e9be6" and "LT1" in legend and "Short of crew" not in legend)
    check("Calendar has its own row in People & access", ev(page, "PERM_MODULES.some(m => m.key === 'events' && m.features.length === 2)")
          and ev(page, "can('events','viewAll') && tabOn('events')"))
    check("old profiles without a Calendar row keep the tab", ev(page, "effectivePerm({ role: 'Member', perm: { avail: { view: true, edit: true } } }).events.view === true && effectivePerm({ role: 'Member', perm: { avail: { view: true } } }).events.viewAll === false"))
    check("different venues get different colours", len(set(ev(page, "settings.venues.list.map(v => venueColor(v))"))) == 6)
    go(page, "availability")
    ev(page, "availTab = 'shows'; availMonth = thisMonth(); renderAvailability()"); page.wait_for_timeout(200)
    check("same venue colour on the Shows & manpower list", page.locator(".job-group", has_text="Welcome Concert").evaluate("e => e.style.getPropertyValue('--vc')") == chip_vc)
    # Reminders: who hasn't filled next month, Remind now (selected), remind again
    ev(page, "availTab = 'team'; availMonth = addMonths(thisMonth(), 1); availQuery = ''; availRole = ''; availDay = ''; renderAvailability()"); page.wait_for_timeout(200)
    panel = page.locator("#av-remind")
    check("co-admin sees who hasn't filled next month", panel.count() == 1 and panel.locator("tr", has_text="Ken").locator(".warn-tag").count() == 1
          and panel.locator("tr", has_text="Marcus").locator(".ok-tag").count() == 1)
    panel.locator("tr", has_text="Ken").locator("[data-rm-uid]").check()
    page.click("[data-rm-send=some]"); page.wait_for_timeout(200)
    check("Remind selected sends to just those people", ev(page, "reminders.length && JSON.stringify(reminders[0].uids)") == '["u-ken"]')
    page.click("[data-rm-send=all]"); page.wait_for_timeout(200)
    check("can remind again; count shown", "2 times" in page.locator("#av-remind tr", has_text="Ken").inner_text())
    check("reminders aren't logged", not logs_has(page, "logs.some(l => l.action === 'Availability reminder sent')"))
    logout(page)
    page.fill("#auth-email", "ken@showbase.com"); page.fill("#auth-password", "123"); page.click("#auth-submit")
    page.wait_for_selector("#app-screen:not(.hidden)"); page.wait_for_timeout(300)
    check("member gets a notice when opening the app", page.locator(".toast", has_text="fill in your availability").count() >= 1 and page.is_visible("#badge-avail"))
    go(page, "availability")
    ask = page.locator(".av-banner.ask")
    check("member sees the reminder banner (who sent it, how many times)", ask.count() >= 1 and "Farah" in ask.first.inner_text() and "2 reminders" in ask.first.inner_text())
    ask.first.locator("[data-av-none]").click(); dialog_ok(page)
    check("'I'm not available' clears the reminder", page.locator(".av-banner.ask").count() == 0 and ev(page, "myAvailDoc(addMonths(thisMonth(), 1)).noAvail") is True)
    logout(page)

    # ================= light mode screenshots + mobile =================
    login(page, "coadmin@showbase.com")
    page.wait_for_selector(".asset-group")
    page.locator(".sidebar .theme-btn").click()
    check("in-app switch to light", ev(page, "currentTheme()") == "light")
    shot(page, "light-catalogue")
    go(page, "check")
    shot(page, "light-check")
    page.set_viewport_size({"width": 400, "height": 860})
    page.wait_for_timeout(400)
    check("phone: topbar theme switch visible", page.is_visible(".topbar .theme-btn"))
    check("phone: no horizontal page scroll", ev(page, "document.documentElement.scrollWidth") <= 400)

    # ================= Admin resets a password -> user sets their own =================
    page.set_viewport_size({"width": 1440, "height": 950})
    logout(page)
    login(page, "admin@showbase.com")
    go(page, "availability")
    check("booking emails start off", page.locator("#av-email-toggle").is_checked() is False)
    page.locator("#av-email-toggle").check(); page.wait_for_timeout(150)
    check("admin can switch booking emails on", ev(page, "settings.availability.emailOnBooking") is True)
    go(page, "users")
    page.click("[data-acc-pick='u-admin']")
    check("can't reset your own password here", page.locator("[data-acc-act='resetpw']").is_disabled())
    page.click("[data-acc-pick='u-crew']")
    page.click("[data-acc-act='resetpw']")
    page.wait_for_selector("#dlg-form")
    check("temporary password is pre-generated", len(page.input_value("#dlg-input")) >= 12)
    page.fill("#dlg-input", "short"); page.click("#dlg-ok"); page.wait_for_timeout(80)
    check("temporary password needs 8+ characters", page.is_visible("#dlg-err"))
    page.fill("#dlg-input", "temp-pass-42"); page.click("#dlg-ok")
    page.wait_for_selector("#tp-code")
    check("admin sees the temporary password to hand over", page.inner_text("#tp-code") == "temp-pass-42")
    check("account flagged + logged", ev(page, "users.find(u => u.id === 'u-crew').mustChangePassword") is True
          and logs_has(page, "logs.some(l => l.action === 'Password reset' && /crew@/.test(l.assetLabel || ''))"))
    page.click("#dyn-modal .form-actions [data-close]")
    page.wait_for_timeout(100)
    check("people list marks the temporary password", page.locator("[data-acc-pick='u-crew'] .custom-badge", has_text="temp password").count() == 1)
    logout(page)
    page.click("[data-demo='crew@showbase.com']"); page.wait_for_timeout(200)
    check("old password stops working", page.is_visible("#login-screen") and page.is_visible("#auth-error"))
    page.fill("#auth-email", "crew@showbase.com"); page.fill("#auth-password", "temp-pass-42"); page.click("#auth-submit")
    page.wait_for_selector("#pwchange-screen:not(.hidden)")
    check("temporary password leads to 'set new password', not the app", not page.is_visible("#app-screen"))
    page.fill("#pwc-temp", "wrong-one"); page.fill("#pwc-new", "MyOwnPass9"); page.fill("#pwc-new2", "MyOwnPass9"); page.click("#pwc-submit"); page.wait_for_timeout(120)
    check("wrong temporary password rejected", "isn't right" in page.inner_text("#pwc-error"))
    page.fill("#pwc-temp", "temp-pass-42"); page.fill("#pwc-new2", "MyOwnPass8"); page.click("#pwc-submit"); page.wait_for_timeout(80)
    check("new passwords must match", "match" in page.inner_text("#pwc-error"))
    page.fill("#pwc-new2", "MyOwnPass9"); page.click("#pwc-submit")
    page.wait_for_selector("#app-screen:not(.hidden)")
    check("after setting own password the app opens", ev(page, "profile.mustChangePassword") is False)
    logout(page)
    page.fill("#auth-email", "crew@showbase.com"); page.fill("#auth-password", "MyOwnPass9"); page.click("#auth-submit")
    page.wait_for_selector("#app-screen:not(.hidden)")
    check("signs in with the new password", True)
    page.wait_for_timeout(500)   # let the first render / data load settle before opening the dialog
    page.click("#change-pw-btn"); page.wait_for_selector("#cp-form"); page.wait_for_timeout(100)
    page.fill("#cp-cur", "MyOwnPass9"); page.fill("#cp-new", "Another1234"); page.fill("#cp-new2", "Another1234")
    page.locator("#cp-form").evaluate("f => f.requestSubmit()")   # a toast can sit over the button
    try: page.wait_for_selector("#cp-form", state="detached", timeout=6000)
    except Exception: print("  cp-error:", page.inner_text("#cp-form") if page.is_visible("#cp-form") else "-")
    check("anyone can change their own password", not page.is_visible("#cp-form"))

    # ================= v5.0: inventory bundles + browser copy + recent changes =================
    def crew_login():
        page.fill("#auth-email", "crew@showbase.com"); page.fill("#auth-password", "Another1234"); page.click("#auth-submit")
        page.wait_for_selector("#app-screen:not(.hidden)"); page.wait_for_timeout(300)
    stats = lambda: ev(page, "({...Bundles.stats})")
    meta = lambda: ev(page, "store.getDoc('invMeta', 'changes')")
    page.wait_for_timeout(300)
    check("bundles: inventory is loaded from bundles, not per asset", ev(page, "Bundles.stats.built && !bundlesLegacy"))
    check("bundles: restricted person only gets their categories' bundles",
          ev(page, "Array.from(new Set(inventory.map(a => a.category))).sort()") == ["Wired Mics", "Wireless Mics"])
    s0 = stats(); logout(page); crew_login(); s1 = stats()
    check("bundles: signing in again uses this browser's copy (no downloads, 1 read)",
          s1["bundleDownloads"] == s0["bundleDownloads"] and s1["reads"] - s0["reads"] == 1 and s1["fromCache"] > s0["fromCache"])
    mic = ev(page, "inventory.find(a => a.category === 'Wired Mics').id")
    logout(page); login(page, "admin@showbase.com"); page.wait_for_timeout(300)
    seq0 = meta()["seq"]
    check("bundles: an edit saves", ev(page, f"updateAsset('{mic}', {{ remarks: 'Bundle test' }}, 'test')") is True)
    page.wait_for_timeout(200)
    m1 = meta(); bid = ev(page, f"Bundles.index.get('{mic}')")
    check("bundles: the edit bumps the recent-changes record by one", m1["seq"] == seq0 + 1 and m1["recent"][-1]["id"] == mic and m1["recent"][-1]["b"] == bid)
    check("bundles: the asset's bundle entry matches the asset", ev(page, f"store.getDoc('invBundles', '{bid}').then(b => b.items['{mic}'].remarks)") == "Bundle test"
          and ev(page, f"store.getDoc('inventory', '{mic}').then(a => a.remarks)") == "Bundle test")
    check("bundles: the editor's own list updates live", asset(page, ev(page, f"inventory.find(a => a.id === '{mic}').internalAssetNo"), "remarks") == "Bundle test")
    logout(page); s2 = stats(); crew_login(); s3 = stats()
    check("bundles: after one edit, the next open reads just that asset (no bundle download)",
          s3["bundleDownloads"] == s2["bundleDownloads"] and s3["assetReads"] - s2["assetReads"] == 1)
    check("bundles: ...and shows the new value", ev(page, f"inventory.find(a => a.id === '{mic}').remarks") == "Bundle test")
    # move the mic to a category Priya can't see, then delete another one
    logout(page); login(page, "admin@showbase.com"); page.wait_for_timeout(300)
    ev(page, f"updateAsset('{mic}', {{ category: 'Speakers' }}, 'test')"); page.wait_for_timeout(200)
    nb = ev(page, f"Bundles.index.get('{mic}')")
    check("bundles: a category change moves the asset to the new category's bundle",
          nb != bid and ev(page, f"store.getDoc('invBundles', '{bid}').then(b => !('{mic}' in b.items))")
          and ev(page, f"store.getDoc('invBundles', '{nb}').then(b => b.cat === 'Speakers' && b.items['{mic}'].category === 'Speakers')"))
    gone = ev(page, f"inventory.find(a => a.category === 'Wired Mics' && a.id !== '{mic}').id")
    gbid = ev(page, f"Bundles.index.get('{gone}')")
    ev(page, f"commitOps([{{ op: 'delete', col: 'inventory', id: '{gone}' }}])"); page.wait_for_timeout(200)
    check("bundles: a deleted asset leaves its bundle", ev(page, f"store.getDoc('invBundles', '{gbid}').then(b => !('{gone}' in b.items))")
          and not ev(page, f"inventory.some(a => a.id === '{gone}')"))
    logout(page); crew_login()
    check("bundles: restricted person no longer sees the moved or deleted asset",
          not ev(page, f"inventory.some(a => a.id === '{mic}' || a.id === '{gone}')")
          and ev(page, "Array.from(new Set(inventory.map(a => a.category))).sort()") == ["Wired Mics", "Wireless Mics"])
    # bulk save: 45 assets in a new category -> one new bundle, marked for re-download
    logout(page); login(page, "admin@showbase.com"); page.wait_for_timeout(300)
    n0 = ev(page, "inventory.length")
    ev(page, """commitOps(Array.from({ length: 45 }, (_, i) => ({ op: 'set', col: 'inventory', id: 'bulk-' + i,
        data: { kind: 'general', category: 'Bulk Test', brand: 'Generic', model: 'Tape ' + i, description: 'test', qty: 1, condition: 'Available', remarks: '-' } })))""")
    page.wait_for_timeout(300)
    m2 = meta(); bb = [b for b, x in m2["bundles"].items() if x["cat"] == "Bulk Test"]
    check("bundles: a bulk save creates the category's bundle and asks apps to re-download it",
          len(bb) == 1 and m2["bundles"][bb[0]]["n"] == 45 and m2["recent"][-1] == {"s": m2["seq"], "b": bb[0], "id": "*"} and ev(page, "inventory.length") == n0 + 45)
    # Admin rebuild
    go(page, "branding")
    check("bundles: Branding shows the bundle status", "Built." in page.inner_text("#bd-panel"))
    page.click("#bd-build"); dialog_ok(page); page.wait_for_timeout(400)
    m3 = meta()
    check("bundles: rebuild writes fresh bundles and clears the change list",
          m3["seq"] == m2["seq"] + 1 and m3["recent"] == [] and sum(b["n"] for b in m3["bundles"].values()) == n0 + 45
          and not logs_has(page, "logs.some(l => l.action === 'Inventory bundles rebuilt')"))
    page.wait_for_timeout(200)
    check("bundles: after a rebuild the app still has every asset", ev(page, "inventory.length") == n0 + 45)

    # ================= v5.0: availability month copy for the team grid =================
    go(page, "availability"); page.click("[data-av-tab=team]"); page.wait_for_timeout(400)
    am = ev(page, "availMonth")
    copy = ev(page, f"store.getDoc('availMonths', '{am}')")
    check("avail bundle: opening the team grid saves one copy of the month", copy and copy["n"] == ev(page, "availGrid.length") and copy["n"] > 0)
    # someone changes their availability while the grid is open
    ev(page, f"""(async () => {{ const d = availGrid.find(x => x.uid === 'u-member');
        await store.commit([{{ op: 'update', col: 'avail', id: d.id, data: {{ avail: [...d.avail, '28'].filter((x, i, a) => a.indexOf(x) === i).sort(), updatedAt: new Date().toISOString(), updatedBy: 'test' }} }}]); }})()""")
    page.wait_for_timeout(300)
    check("avail bundle: a change shows live in the open grid", ev(page, "availGrid.find(x => x.uid === 'u-member').avail.includes('28')"))
    ev(page, "stopAvailGrid()"); ev(page, "watchAvailGrid()"); page.wait_for_timeout(400)
    check("avail bundle: reopening uses the copy plus the changed person", ev(page, "availGrid.find(x => x.uid === 'u-member').avail.includes('28')")
          and ev(page, "availGrid.length") == copy["n"])

    # ================= v5.1: Log History pages of 50 =================
    ev(page, """store.commitPlain(Array.from({ length: 130 }, (_, i) => ({ op: 'set', col: 'logs', id: 'old-' + i,
        data: { at: new Date(Date.now() - (40 + i) * 86400000).toISOString(), by: 'admin@showbase.com', byName: 'admin', byUid: '', action: 'Old entry', assetId: '', assetLabel: '', category: '', changes: [], note: 'n' + i, ticketId: '' } })))""")
    page.wait_for_timeout(200)
    total = ev(page, "store.count('logs')")
    logout(page); login(page, "admin@showbase.com"); page.wait_for_timeout(300)
    check("logs: opening the app reads no log entries", ev(page, "logs.length") == 0 and ev(page, "logStarted") is False)
    go(page, "logs"); page.wait_for_timeout(200)
    check("logs: only the newest 50 entries load", ev(page, "logs.length") == 50 and page.is_visible("#log-more"))
    page.click("#log-more"); page.wait_for_timeout(200)
    check("logs: 'Load older' adds the next 50", ev(page, "logs.length") == 100 and len(set(ev(page, "logs.map(l => l.id)"))) == 100)
    ev(page, "commitOps([makeLog('Fresh entry', null, [], 'live')])"); page.wait_for_timeout(200)
    check("logs: a new entry shows live and nothing loaded drops off", ev(page, "logs[0].action") == "Fresh entry" and ev(page, "logs.length") == 101)
    for _ in range(4):
        if page.is_visible("#log-more"): page.click("#log-more"); page.wait_for_timeout(200)
    check("logs: loading to the end gets every entry once, then the button goes",
          ev(page, "logs.length") == total + 1 and not page.is_visible("#log-more") and "that's everything" in page.inner_text("#log-footnote"))
    check("logs: entries are newest first", ev(page, "logs.every((l, i) => !i || String(logs[i - 1].at) >= String(l.at))"))
    old_day = ev(page, "logs.find(l => l.id === 'old-10').at.slice(0, 10)")
    got = ev(page, f"store.getAll('logs', logPdfQuery({{ from: '{old_day}', to: '{old_day}' }})).then(r => r.map(l => l.id))")
    check("logs: the PDF date filter only reads those days (plus a day each side)", "old-10" in got and 1 <= len(got) <= 4)

    # ================= v5.1: people list from one saved copy =================
    go(page, "users"); page.wait_for_timeout(300)
    pc = ev(page, "store.getDoc('peopleCopy', 'all')")
    check("people: Admins get one saved copy of everyone", pc and pc["n"] == ev(page, "users.length") and pc["n"] > 3)
    ev(page, "store.commit([{ op: 'set', col: 'users', id: 'u-signup', data: newPendingProfile('fresh@showbase.com', 'Fresh Sign-up', 'C77777') }])")
    page.wait_for_timeout(300)
    check("people: a new sign-up shows straight away", ev(page, "users.some(u => u.id === 'u-signup' && u.status === 'pending')")
          and "fresh@showbase.com" in page.inner_text("#view-users"))
    ev(page, "commitOps([{ op: 'update', col: 'users', id: 'u-signup', data: { status: 'rejected' } }])"); page.wait_for_timeout(200)
    check("people: profile saves are stamped and show live", ev(page, "users.find(u => u.id === 'u-signup').status") == "rejected"
          and ev(page, "store.getDoc('users', 'u-signup').then(u => !!u.updatedAt)"))
    ev(page, "commitOps([{ op: 'delete', col: 'users', id: 'u-signup' }])"); page.wait_for_timeout(300)
    check("people: a deleted person leaves the list and the saved copy",
          not ev(page, "users.some(u => u.id === 'u-signup')") and ev(page, "store.getDoc('peopleCopy', 'all').then(c => !('u-signup' in c.rows))"))
    logout(page); login(page, "coadmin@showbase.com"); page.wait_for_timeout(400)
    check("people: bookers get a copy of active people only", ev(page, "store.getDoc('peopleCopy', 'active').then(c => c && Object.values(c.rows).every(u => u.status === 'active'))")
          and ev(page, "users.length > 0 && users.every(u => u.status === 'active')"))

    # ================= v5.1: clear message when the free daily limit is hit =================
    msg = ev(page, "friendlyError({ code: 'resource-exhausted', message: 'Quota exceeded.' })")
    check("limit: a save that hits the daily limit says it wasn't saved and when it works again", msg.startswith("Not saved: the daily limit") and "Try again after" in msg)
    check("limit: a banner shows the reset time in local time, and the sync badge says not live",
          page.is_visible("#quota-banner") and "Daily limit reached" in page.inner_text("#quota-banner") and "SGT" in page.inner_text("#quota-banner") and "daily limit" in page.inner_text("#sync-badge"))
    check("limit: the reset is the next midnight US Pacific",
          ev(page, "(() => { const t = quotaResetTime(new Date('2026-10-21T11:00:00Z')); return t.toISOString(); })()") == "2026-10-22T07:00:00.000Z"
          and ev(page, "quotaResetTime(new Date('2026-12-01T09:00:00Z')).toISOString()") == "2026-12-02T08:00:00.000Z")
    check("limit: other errors don't trigger it", ev(page, "isQuotaError({ code: 'permission-denied' })") is False)
    check("limit: once the database answers again the banner clears and data restarts",
          ev(page, "quotaProbe()") is True and not page.is_visible("#quota-banner"))
    page.wait_for_timeout(300)

    # ================= v5.1: Log History keeps only useful entries =================
    check("log filter: equipment / account actions are kept", ev(page, "logWanted('Condition change') && logWanted('Loan approved') && logWanted('Show signed out') && logWanted('User approved') && logWanted('Maintenance log: Fault')"))
    check("log filter: bookings and in-between steps are dropped", ev(page, "!logWanted('Soft booked') && !logWanted('Loan requested') && !logWanted('Check round started') && !logWanted('Password changed')"))
    check("log filter: a save with only a dropped entry writes nothing", ev(page, "(async () => { const n = (await store.getAll('logs')).length; await commitOps([makeLog('Soft booked', null, [], 'x')]); return (await store.getAll('logs')).length === n; })()"))

    # ================= v5.1: crew role ticks in the app (no roster Sheet) =================
    if ev(page, "authUser.email") != "coadmin@showbase.com":
        logout(page); login(page, "coadmin@showbase.com"); page.wait_for_timeout(300)
    go(page, "availability"); page.click("[data-av-tab=team]"); page.wait_for_timeout(300)
    had = ev(page, "(crewRoleMap['u-crew'] || []).includes('NEW')")
    page.click("[data-av-crole='u-crew'][data-role='NEW']"); page.wait_for_timeout(300)
    check("roles: a Co-Admin ticks a crew role in the team grid", ev(page, "(crewRoleMap['u-crew'] || []).includes('NEW')") != had
          and ev(page, "store.getDoc('crewRoles', 'all').then(d => (d.roles['u-crew'] || []).includes('NEW'))") != had)
    check("roles: the tick is logged", logs_has(page, "logs.some(l => l.action === 'Crew roles changed')"))
    page.click("[data-av-crole='u-crew'][data-role='NEW']"); page.wait_for_timeout(300)
    check("roles: clicking again unticks it, other roles kept", ev(page, "(crewRoleMap['u-crew'] || []).includes('NEW')") == had
          and ev(page, "(crewRoleMap['u-crew'] || []).includes('CRS')"))
    check("roles: no roster Sheet wording left", "roster Sheet" not in page.inner_text("#view-availability") and "roster Google Sheet" not in page.inner_text("#view-availability"))

    check("no console / page errors, no native dialogs", not errors)
    if errors:
        print("\n".join(errors[:10]))
    browser.close()

passed = sum(1 for _, ok in results if ok)
print(f"\n{passed}/{len(results)} checks passed")
sys.exit(0 if passed == len(results) else 1)
