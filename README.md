# Showbase / STAR Inventory - Asset System (v5.2)

A live inventory app for a production / AV team. **Firebase Auth + Firestore** hold the data and logins,
every change is also pushed **one-way to Google Sheets** as a backup, and the site is a static page hosted on **GitHub Pages**.

```
Browser (GitHub Pages)  ──read/write──▶  Firestore  (source of truth, enforced by firestore.rules)
        │
        └──every change──▶  Apps Script web app  ──▶  Google Sheet backup
                                                       (Inventory · Deleted Inventory · Maintenance · Loans · Shows · Discrepancies · Audits · Log)
```

Try it with no setup: open `public/index.html?demo` (offline sample data, quick sign-in buttons, nothing is saved).

---

## What's new in v5.2 - asset conditions you can edit

| Area | Change |
|---|---|
| Asset conditions | Admins edit the condition list in **Branding › Asset conditions**, the same way as show venues. The 9 built-in conditions (Available, Deployed, Faulty, On Repair, On Loan, Missing, Decommissioned, To Check, Sold) drive loans, repairs and checks, so their names are fixed, but their **short label** and **colour** can change. Admins can **add** their own (e.g. **Upgraded**: in use, due for replacement), each with a short label, a colour and a **Counts as retired** tick (retired assets are left out of Inventory Check rounds and the location tree, like Sold and Decommissioned). An added condition can be **renamed** (assets with it move to the new name) and **removed** once no asset has it. The list is one record, `settings/conditions` (1 read per app open). Changes show up for everyone straight away. |
| Import | A CSV's Condition column matches any condition on the list (built-in or added), by **name or short label**, ignoring upper/lower case. Anything else still becomes **To Check**, and a blank cell becomes **Available**. Add a new condition in the app **before** importing rows that use it. |
| Rules | New rule for `settings/conditions`: every active user can read it, and only Admins can change it. **203 rule checks pass.** |

**Upgrading from v5.1:** publish **firestore.rules** again (`npx firebase deploy --only firestore:rules`) and upload the changed site files (`public/js/core.js`, `admin.js`, `inventory.js`, `shell.js`, `public/css/components.css`). There's nothing to build, and the Apps Scripts don't change.

---

## What was new in v5.1 - Log History and people list read less

| Area | Change |
|---|---|
| Log History | Loads only when its page is first opened (opening the app costs 0 log reads), then shows the **newest 50 entries** (50 reads instead of up to 1,000). **Load 50 older entries** under the table reads the next 50 each press. New entries still appear live. Search and filters look through the entries loaded so far; load older ones to go further back. |
| Log: useful entries only | The log (and the backup Sheet's Log tab) now records only who did what to equipment or accounts: asset adds / deletes / imports / edits, maintenance steps, loans approved / collected / returned / rejected, show sign-out and sign-in, check results, and user / access / password-reset changes. Not logged any more: crew bookings and reminders (they live in the roster and Shows Sheets), show / maintenance-call edits, loan requests / cancellations, discrepancy reports, round starts, own password changes, branding, venues, bundle builds. The list is `LOG_SKIP` in `public/js/core.js`. |
| Log PDF | Still reads what it prints (1 read per entry). With a **From / To date** filter it now reads only those days (plus a day each side), not the whole history. The dialog shows how many entries "Full history" has, where the browser can count them. |
| People list | Admins (Users & Permissions) read **one saved copy of everyone** (`peopleCopy/all`) plus only profiles changed since. Bookers who aren't Admin read `peopleCopy/active` the same way. A new sign-up, approval or role change shows straight away. The viewer's app saves a fresh copy when 30+ people have changed, or after a day. |
| `updatedAt` on profiles | Every profile save now stamps `updatedAt` (that's how "changed since" works). The "last seen" touch on app open does **not**, so "last seen" in the list can be up to a day old. Deleting someone, or moving them out of active, also removes them from the copies. |
| Daily limit message | If the free plan's daily allowance runs out, a red banner says **"Daily limit reached"** with the time it comes back (midnight US Pacific, shown in Singapore time, e.g. "Thu 3:00 pm SGT"), the sync badge says **Not live**, and a failed save says it was **not saved** (dialogs stay open with what you typed). The app checks every 5 minutes and clears the banner and restarts live updates once the database answers again. |
| Backup Sheet | All times are written in **Singapore time** (e.g. `2026-10-21 17:42:10`), and time column headers say `(SGT)`. Plain dates (show date, return date) are unchanged. Deleted assets now **move to a separate "Deleted Inventory" tab** (same columns, with `deletedAt`), so the Inventory tab only lists assets that still exist. Backup now / the nightly snapshot also move any asset no longer in the database there. Rows written before v5.1 keep their old times until they're next updated (Backup now rewrites the whole Inventory tab). **Re-deploy the backup Apps Script.** |
| No more roster Sheet | **The availability roster Google Sheet is gone**: availability, bookings and crew role ticks live only in the app. Admins / Co-Admins with **Book people** tick **SE / ST / CRS / NEW** straight in **Availability › Team** (click a role cell). All ticks are one record, `crewRoles/all`, so loading them is 1 read instead of one per person. This also removes the old roster script, whose 5-minute timer could cost up to ~1 million reads a day. The **Shows Sheet and booking emails stay**, now run by a small one-way script (`apps-script/shows/`) that the app calls after a booking or availability save. It has no timers, reads the app's saved copies plus what changed (about 5 reads + that month's shows per update), and never writes to the app. Booking emails only go out for changes a booker made, and the script checks each one against what's saved first. |
| Inventory Check ticks | Ticks load **only while Inventory Check is open** and stop when you leave it (opening the app costs 0 tick reads). A round's ticks are saved in a few shared records, `checkTicks/{roundId}_{n}`, about 200 assets each (the number is set when the round starts), so opening a 2,000-asset round mid-check is **about 10 reads instead of up to 2,000**. Each tick is a field-level save that touches only that asset, so several people ticking at once don't overwrite each other. A tick costs 1 write, plus 1 read for each person who has Inventory Check open. Finishing a round still saves the same summary to History and clears the records. |
| Rules + index | Rules for `peopleCopy` (all = Admins only; active = Admins and bookers) and `updatedAt` allowed on self-updates and sign-up. Rules for `crewRoles` (bookers tick, members can't read). Rules for `checkTicks` (a save may change only its own tick, as yourself, while the round is open). New index: `users (status, updatedAt)`. **197 rule checks pass.** |

**Upgrading from v5.0:** deploy rules **and** indexes again (`npx firebase deploy --only firestore`), re-deploy the backup Apps Script (SGT times, Deleted Inventory tab, host setup stamps `updatedAt`), **delete the old roster Sheet's script triggers** (open its Apps Script › Triggers and remove them, or just delete that Sheet), put `apps-script/shows/` into the Shows Sheet as its own bound script and deploy it as a web app (setup step 5), set `showsWebAppUrl` in config.js, and publish the site. Nothing to build: the people copy is made the first time an Admin opens the app.

**Rough reads per open, before → after:** Log History up to 1,000 → 50 (+50 per "Load older"); Admin people list ~300 → about 2 plus anyone changed since the copy; bookers' active list ~300 → about 2 plus changes.

## What was new in v5.0 - stays inside Firebase's free plan

Built for about **500 people and 20,000 assets** on the free (Spark) plan: 50,000 reads and 20,000 writes a day, about 10 GB of downloads a month.

| Area | Change |
|---|---|
| Inventory bundles | Besides one record per asset, assets are also stored in **bundles**: a few large records grouped by category (up to 2,000 assets, under 1 MB each, e.g. `wired-mics-1`, `cables-2`). The app reads bundles, so opening it costs **about 15 reads instead of one per asset**. |
| Browser copy + recent changes | Each browser keeps a **saved copy** of the bundles (IndexedDB). Everyone's app listens to one small record, `invMeta/changes`, which lists each bundle's version and the last 300 asset edits. On open, unchanged bundles come from the saved copy (0 reads), a bundle with a few listed edits is patched by reading just those assets (1 read each), and anything else is downloaded (1 read per bundle). A live edit costs everyone with the app open 1 read for the record plus 1 for the changed asset, a few KB, instead of re-sending a whole bundle. |
| Saving | Every save that touches inventory (edits, adds, deletes, imports, loans, maintenance, discrepancy approvals) also updates the asset's bundle entry and `invMeta/changes` **in the same transaction**, so they can't get out of step. A one-asset edit is 3 writes instead of 1. Non-Admin saves are capped at 10 assets each (bigger ones are split automatically) because the rules check every entry. |
| Build bundles (once) | **Branding › Inventory bundles › Build bundles**. Run it once after deploying v5.0 (it reads every asset once). Until then the app works as before and Admins get a reminder. **Rebuild** fixes anything out of step; everyone then downloads fresh bundles once. |
| Team grid (availability) | Admins / Co-Admins opening a month read **one saved copy of the month** (`availMonths/{YYYY-MM}`) plus only the people who changed since, instead of one read per person. The viewer's app refreshes the copy when 30+ people have changed, or after a day. |
| Sheets snapshot | The nightly / full inventory snapshot reads the bundles (about 15 reads) instead of every asset. **Re-deploy the backup Apps Script.** |
| Rules tested | `firestore.rules` now has rules for `invBundles`, `invMeta` and `availMonths`. A bundle entry must equal the asset as saved in the same commit, so nobody can put anything into a bundle the inventory itself doesn't say. **171 rule checks now run and pass on the Firestore emulator.** |

**Upgrading from v4.x:** deploy `firestore.rules` **and** `firestore.indexes.json` (`npx firebase deploy --only firestore`), re-deploy the backup Apps Script, publish the site, then sign in as the host and press **Build bundles**.

**Rough daily budget** (300 people opening the app once, 300 inventory edits with ~30 apps open, 1,500 availability changes, admins opening the grid 10 times): about 10,000-20,000 reads and 2,500 writes a day. In v5.0 the biggest remaining read costs were **Log History**, the **people list** and **crew roles** for bookers; v5.1 fixes the first two.

## What was new in v4.4

| Area | Change |
|---|---|
| Email verification | After signing up, Firebase emails a **verification link**. Until it's clicked the person sees *Verify your email* (with **Resend** and **I've clicked the link**), and the database refuses their requests. Admins see **✓ email verified / not verified yet** in Pending sign-ups, and **Approve** stays disabled until verified. Sent by Firebase itself (not the Sheets script's Gmail). The host's username login is exempt. |
| Sign-up | **Full name, Casual ID, email, password and confirm password are all compulsory** (marked *), checked top to bottom; passwords at least 8 characters. |
| Rack Layout | Assets with no Item Space / Item Location are grouped under **TBC** (to be confirmed), listed last. |
| Calendar | The **Calendar** tab is now live: a **month calendar** (or **list**) of every show and maintenance call - time, name, venue; click one for details and crew with roles. Admin / Co-Admin see everything (with manpower filled vs needed); members see only the shows they're on, with their role (soft bookings have a dashed outline). The placeholder **Plan** tab was removed. |
| Calendar access | **People & access** now has an **Calendar** row: *See the tab* and *See every show & maintenance call* (otherwise people only see shows they're booked on). Co-Admins get both, Members get the tab only. Existing people keep the tab automatically. Re-deploy **firestore.rules**. |
| Venue colours | Each show venue has **one colour used on every page** (Calendar, Shows & manpower, My bookings, Show Sign-Out). New venues get a free colour automatically; Admin can change it in **Branding › Show venues** (tap the dot). Maintenance calls stay yellow. Colours are saved in `settings/venues` - re-deploy **firestore.rules**. |
| Availability reminders | **Automatic:** from the **15th of every month**, members who haven't filled in **next month** see a reminder banner, a tab badge and a notice when they open the app. **Remind now:** Team roster › *Reminders* shows who hasn't filled the month (with how often they've been reminded); Admin / Co-Admin can **remind everyone not filled** or **ticked people**, again as often as needed. A reminder clears once the member marks a day, or presses **I'm not available in <month>**. In-app only (no email). |
| Availability hours | Members **tap a date** and a pop-up asks: **Available all day**, **Available at certain times** (from–to in 24-hour time, e.g. 1800 to 2300; 0000 = midnight) or, for a day already marked, **Not available**. **Mark all remaining days** asks the same once. Hours show on the calendar, in the Team roster (corner mark + hover), in the booking form and "add someone free" list, and as **hover notes** on the roster Sheet cells. Booking someone outside their hours asks first. |
| 3rd Google Sheet: Shows | One-way **compiled shows Sheet** in the team's monthly layout: a tab per month ("Oct 26"), Sunday-Saturday week blocks, names + IDs on the left, each show as a **venue-coloured block** (name · time · manpower) with the **booked crew underneath** as "Name ROLE" (**cyan = confirmed, yellow = soft**); each week's Name / ID No. list = everyone **confirmed** that week (shows + maintenance), once each, maintenance calls at the bottom. Rebuilt from the app on every change, so edits and **removals show up live**. Don't edit it by hand. |

The app now feeds **3 Google Sheets**: inventory backup (one-way), availability roster (two-way, colours), shows (one-way). *(Since v5.1 the roster Sheet is gone: 2 Sheets, inventory backup and shows, both one-way.)*

## What was new in v4.3 - Shows & manpower

| Area | Change |
|---|---|
| Booking form | Clicking a person's day in the Team roster opens a form: **Show name, Start, End, Venue, Manpower needed** (e.g. 2 ST, 1 CRS - optional), **their role**, and **Soft / Confirmed**. Every field is type-and-select and remembers past entries; times are 24-hour (`1400`; `0000` = midnight) - typing `2pm` also works. Shows already on that date are offered first - picking one joins it. |
| One record per show | All people booked on a show share one record, so **editing the time / venue once updates everyone** (it asks first and lists who is affected). |
| One show per day | A person can be on **one show per day**, plus any number of **maintenance calls** (same form, "Maintenance call" tab). |
| Shows & manpower list | New sub-tab for Admin / Co-Admin: every show and call in the month, grouped and expandable like the catalogue - name · date · time · venue · **manpower filled vs needed per role** (red = short, orange = includes soft) · who is booked, role and status (Soft / Confirmed / Withdrew / Released). Add someone free that day, remove people, edit or delete the show, or create a show before booking anyone. |
| Needs details | Days booked without a show (e.g. before v4.3) are listed with **Add details**. |
| Members | Their calendar and **Your bookings** show the show name, time, venue, their role and **their teammates**. |
| Sheet | Unchanged - colours only. Booking emails (if switched on) now include the show, time, venue and role. |

## What was new in v4.2 - Availability & bookings

| Area | Change |
|---|---|
| Availability tab | Members tap days on a month calendar to mark themselves **available** (green). Bookings show on the same calendar and in **Your bookings**: **soft booked** (orange) or **confirmed** (red), with a 🔔 notice and a tab badge for new ones. |
| Members' rules | Soft-booked days can be withdrawn (Admins see it flagged **!**); confirmed days are locked - ask an Admin / Co-Admin. Past days can't be changed. |
| Team roster | Admin / Co-Admin (with **Book people**) see everyone × days, filter by name, Casual ID or role, click a date to see who's free, and click a cell to **Soft book / Confirm / Clear**. Since v5.1 bookers also tick crew roles here. |
| Roster Google Sheet | *Removed in v5.1: everything is in the app now.* |
| Booking emails | Email on soft book / confirm / cancel, sent by the Shows Sheet's script (v5.1). **Off by default**; an Admin switches it on in the Availability tab. Username logins (the host) are never emailed. |
| Permissions | New **Availability** module: see the tab · mark own days · see everyone · book people. Members get the first two by default. |

## What was new in v4.1

| Area | Change |
|---|---|
| Host login | The host signs in with a **username** (`Starpacsound Admin`), not an email. Created and recovered from the backup Sheet's **Showbase admin** menu (Setup › 2). The username domain `@showbase.local` can't be used to sign up. |
| Passwords | Admin › People & access › **Reset password…** issues a **temporary password** (auto-generated or typed, shown once with Copy). The person signs in with it and must set their own before anything else works - enforced by the rules, not just the screen. Everyone also has **🔑 Change password** in the sidebar. Needs the Apps Script web app (Setup › 3). |
| Sign-up | **Casual ID is required** (letters, numbers, `-`, `/`; saved upper-case). Shown to Admins in Pending sign-ups (flagged if two accounts share one), searchable in People & access, and editable by Admins. |
| Add Asset › General | **Description is required** (prefilled when you pick an existing model). |
| Show Sign-Out | **Venue is required** and is a **search-and-select** list (shared `settings/venues`). Typing a new venue adds it; Admins tidy the list under **Branding › Show venues**. **Members only ever see their own sign-outs** - locked for the Member role in the app *and* in `firestore.rules`, even if the box is ticked. |
| Users & Permissions | The big matrix is replaced by a **People & access** editor: search and pick a person (or a role template) → tick features by module, rows & columns, role → **Save changes**. Nothing is written until Save; unsaved changes are counted and you're asked before switching person. One log entry per save lists what changed. |

## What was new in v4

| Area | Change |
|---|---|
| Theme | Full **light and dark** palettes with a switch in the sidebar (and on the sign-in screen / phone top bar). Follows the device until someone picks one; the choice is kept per browser. Solid, higher-contrast colours throughout. |
| Catalogue | **Year of Purchase** column beside Condition (follows the Edit lock, unlike Condition). Year filter beside the Condition filter, a **Year of purchase** tab in the mix panel, and a **Needs finance code** view (year set, Code empty). Template button removed. |
| Add Asset ▾ | **Detailed** (full form) or **General** - bulk items stored as one record with a quantity (space, location, condition, quantity; name + category so it can be found). |
| Loans ↔ catalogue | Setting an asset to **On Loan** in the catalogue opens a loan pop-up (borrower name, dates, reason) and creates a linked loan in Equipment Loans. Setting it back offers to close the loan. Loan requests now capture a **Borrower name**. |
| Inventory Check | Rounds are per **venue** (Item Space), several at once. **Finish round** freezes a summary into **History** (kept until deleted), viewable and downloadable as **PDF**. |
| Maintenance | Repairing list has **vendor**, **sent-date range**, **overdue** and **search** filters. |
| Permissions | **Feature-level** matrix: 30 features in 7 modules × templates and people, with module-wide toggles and a filter. E.g. Maintenance separates *submit*, *see everyone's requests*, *see Confirmed & Repairing*, *verify*, *repair*. |

## What was new in v3

| Area | Change |
|---|---|
| Branding | Admins set the app name and logo in **Admin › Branding**. They show in the sidebar, sign-in screen, browser tab and PDF exports. |
| Theme | Lighter slate / charcoal palette, IBM Plex type, monospace IDs; works down to phone width. |
| Navigation | Grouped sidebar: **Inventory** (Catalogue, Rack Layout, Inventory Check) · **Operations** (Maintenance, Loans, Show Sign-Out) · **Events** · **Admin** (Log History, Users & Permissions, Branding). Live badges show what's waiting. |
| Combo-boxes | Category, Brand, Model, Space, Location (and Vendor) are type-or-select everywhere: click for the list, type to filter, or type something new. |
| Catalogue | Condition stays editable with the edit lock off; **Clear all** resets every filter. |
| Maintenance | Verify and Mark Repaired use space/location combo-boxes; resolution notes are optional. |
| Rack Layout | Space › Location › Equipment type tree with in-place editing. |
| Inventory Check | Same tree with a tick box per asset, progress per location, check rounds, and **Report discrepancy** → review → approve / reject. |
| Equipment Loans | Request by equipment name (no IDs shown), 2-day notice, approver assigns exact units (auto-filled, set to **On Loan**), Collected → Return → check-in. |
| Show Sign-Out | Name the show, add gear by name + qty, tick it back in; missing items are recorded. Searchable by title, kept permanently. |
| Log History | PDF export (A4 landscape, branded header, filters, page numbers). |
| Permissions | Matrix of users × 7 tabs + 9 actions, editable role templates, per-user rows & columns. |
| Pop-ups | Browser `confirm`/`prompt` replaced by in-app dialogs. |

---

## Repo layout

| Path | What it is |
|---|---|
| `public/` | The website (GitHub Pages serves this folder) |
| `public/js/config.js` | **The only file you normally edit**: Firebase config, Sheets URL, loan notice days |
| `public/js/perms.js` | Tabs, actions, column lists, role templates |
| `public/js/bundles.js` | Inventory bundles, browser copy, recent-changes record and month copies (keeps reads low) |
| `public/js/people.js` | People list from one saved copy + only profiles changed since; stamps `updatedAt` on profile saves |
| `public/js/store.js` | Data/auth layer (Firebase, or in-memory demo with `?demo`) |
| `public/js/backup.js` | Queue that pushes every change to Google Sheets, with retry |
| `public/js/combo.js` | The type-or-select combo-box |
| `public/js/core.js` | Shared state, helpers, dialogs, write + log pipeline |
| `public/js/inventory.js` · `rack.js` · `maintenance.js` · `loans.js` · `shows.js` · `availability.js` · `jobs.js` · `logs.js` · `admin.js` | One file per module |
| `public/js/pdf.js` | Shared PDF report layout (Log History, Inventory Check history) |
| `public/js/shell.js` | Sign-in, routing, live subscriptions, branding, badges (loads last) |
| `public/css/base.css` · `components.css` | Theme tokens + layout · module styles |
| `public/vendor/` | jsPDF 2.5.2 + AutoTable 3.8.4 (MIT), bundled so PDF export works offline |
| `firestore.rules` | **Server-side security** |
| `apps-script/` | Google Apps Script for the inventory Sheets backup (+ password resets, host account) |
| `apps-script/shows/` | Google Apps Script bound to the **Shows** Sheet: rebuilds the monthly shows tabs and sends booking emails (one-way, called by the app) |
| `tests/` | Rules tests (Firestore emulator) + browser end-to-end test (demo mode) |
| `.github/workflows/` | Auto-deploy to Pages; test (and optionally deploy) the rules |

---

## Firestore data model

| Collection / doc | Holds | Who can write |
|---|---|---|
| `settings/app` | `appName`, `logo` (resized image, ≤ ~300 KB) | Admin (anyone can read, for the sign-in screen) |
| `settings/roles` | Co-Admin and Member templates (features, rows, columns) | Admin |
| `settings/conditions` | `list[]` of `{name, short, color, retired}`: built-ins + Admins' own conditions | Everyone active reads · Admin writes |
| `settings/venues` | `list[]` of show venues | Admin · people who can sign out may only **add** |
| `users/{uid}` | `casualId`, `mustChangePassword` (+ `tempPasswordSetAt/By`, `passwordChangedAt`), `role`, `status`, `isPrimary`, `perm{module:{feature}}`, `viewCols`, `editCols`, `viewCats`, `editCats`, `updatedAt` (stamped on every save except last seen) | Admin (self: name / last seen; Casual ID set at sign-up, Admin-only after) |
| `inventory/{id}` | Asset fields, `kind` (detailed / general), `qty` (general), `yearOfPurchase`, + `wfCol/wfRef/wfStep` tag on workflow moves | Edit rights · workflows · Admin |
| `maintenance/{id}` | Ticket: `stage` request → confirmed → repairing → closed / rejected | Anyone raises; Manage maintenance runs it |
| `loans/{id}` | `borrowerName`, `source` (request / catalogue), `items[]`, `collectDate`, `returnDate`, `reason`, `status`, `assigned[]`, `history[]` | Requester: create / cancel / Collected / Return · loan managers: the rest · catalogue lenders: create catalogue loans |
| `shows/{id}` | `title`, `showDate`, `venue` (required), `items[{name, qty, accounted}]`, `status` out/in, `missingCount` | Owner while out · never deleted (primary Admin only) |
| `audits/{roundId}` | Check round: `venue`, `name`, `status` open/closed, started/closed by + at, frozen `summary` (total, checked, discrepancies, items) | Start/finish: rounds permission · delete: history-delete permission |
| `checkTicks/{roundId}_{n}` | A round's ticks, ~200 assets per record: `ticks{assetId: {checked, at, by, byName, byUid}}`, `last` (cleared when the round finishes; the round's `shards` says how many) | Anyone with the Check tab, while the round is open |
| `discrepancies/{id}` | `current{}`, `proposed{}`, `missing`, `note`, `status` | Reporter creates · Manage checks reviews |
| `avail/{uid}_{YYYY-MM}` | One person, one month: `avail[]` free days (incl. booked), `soft[]`, `conf[]`, `withdrawn[]`, `name`, `casualId`, `times{day: "HH:MM-HH:MM"}` (no entry = all day) (days are `"01"`…`"31"`) | Member: own free days, withdraw soft · bookers: bookings · the roster Sheet script (as project owner) |
| `crewRoles/all` | `roles{uid: [..]}`, `updatedAt`, `updatedBy` - every crew role tick (SE / ST / CRS / NEW) in one record | Bookers tick them in Availability › Team · readable by Admins / Co-Admins (see-everyone or booking rights), never members |
| `jobs/{id}` | One show or maintenance call on one date: `kind` show/maint, `date`, `month`, `title`, `start`, `end` (HH:MM), `venue`, `manpower[{role, qty}]`, `notes`, `crew[{uid, name, casualId, role}]`, `crewUids[]` | Bookers (Admin / Co-Admin) · readable by bookers and by the people on it |
| `settings/rosterLists` | Remembered `titles`, `maintTitles`, `roles`, `times` for type-and-select | Bookers |
| `reminders/{id}` | `month`, `uids[]`, `byUid`, `byName`, `at` - an availability reminder | Bookers create · members read the ones naming them · can't be edited |
| `settings/availability` | `emailOnBooking` | Admin |
| `logs/{id}` | Append-only audit trail | Everyone appends their own; primary Admin resets |
| `invBundles/{bid}` | `cat`, `v`, `items{assetId: asset}`, `last[]` - copies of up to 2,000 assets of one category | Saved automatically with every inventory save (each entry must match the asset) · Admin builds |
| `invMeta/changes` | `seq`, `bundles{bid: {cat, v, n, sz}}`, `recent[{s, b, id}]` (last 300 edits) | Moves on by one with every inventory save · Admin builds |
| `availMonths/{YYYY-MM}` | `rows{availDocId: doc}`, `mark`, `builtAt`, `n` - one copy of a whole month for the team grid | Admins / Co-Admins who can see everyone's availability |
| `peopleCopy/all`, `peopleCopy/active` | `rows{uid: profile}`, `mark`, `builtAt`, `n` - one copy of every profile (all) or of active people (active) | all: Admins · active: Admins and bookers |

**Upgrading from v3:** profiles stored `tabs{}` + `can{}`. The app translates them on the fly, but the v4 rules only read `perm{}`. After deploying, open **Users & Permissions** and pick each template and click **Apply to N …** (or save any person, which writes their full `perm` map). `settings/audit` is no longer used.

---

## Setup (about 20 minutes, once)

### 1. Firebase
1. Firebase console → project **starpac-audio** → **Authentication → Sign-in method** → enable **Email/Password**.
2. Optional: **Authentication → Templates → Email address verification** - set the sender name (e.g. "STAR Inventory") and wording of the verification email. Tell people to check spam / junk the first time.
3. **Authentication → Settings → Authorized domains** → add `<your-github-username>.github.io`.
4. Test and deploy the security rules (needs Node 18+ and Java 11+):
   ```bash
   npm install
   npm run test:rules      # rule checks on the local emulator
   npx firebase login
   npm run deploy:rules
   ```
   > ⚠️ Deploying these rules **locks out the old STAR Inventory page** (it has no login). Move your team to this app first.

### 2. Create the host (primary Admin) - do this right after step 3
The host signs in with a **username** (`Starpacsound Admin`) instead of an email. Everyone else uses their real email.
1. Finish **step 3** (backup Sheet + Apps Script), then **reload the Google Sheet**. A **Showbase admin** menu appears.
2. **Showbase admin → Set up / recover host account…** → type the host password → OK. (First run: Google asks you to authorise.)
   This creates the login and its primary-Admin profile. The password is never stored in any file.
3. Open the app and sign in with **Username:** `Starpacsound Admin` + that password. Set the name and logo in **Admin › Branding**, then approve everyone else in **Users & Permissions**.

**Forgot the host password?** Run the same menu item again and type a new one. Only someone who can edit the Sheet *and* owns the Firebase project can do this.
To change the host username, edit `HOST_USERNAME` in `apps-script/Code.gs` (the sign-in address is derived from it, e.g. `starpacsound.admin@showbase.local`).

### 3. Google Sheets backup
1. Create a Google Sheet (e.g. "STAR Inventory - Backup"), then **Extensions → Apps Script**.
2. Replace `Code.gs` with `apps-script/Code.gs`. In Project Settings tick *Show "appsscript.json"* and replace it with `apps-script/appsscript.json`.
3. **Deploy → New deployment → Web app**: *Execute as* **Me**, *Who has access* **Anyone**. Authorise, copy the `/exec` URL.
   (If you deployed v2 before: **Deploy → Manage deployments → Edit → New version** so the new tabs are used.)
4. Paste the URL into `public/js/config.js` → `sheetsWebAppUrl`, commit and push.
5. Optional safety net: run `installNightlySnapshot` once in the Apps Script editor (rewrites the Inventory tab every night at 3 am SGT).

**Password resets also run through this web app**, so:
- Deploy it with the **same Google account that owns the Firebase project** (it sets passwords with that account's access).
- The extra scopes in `appsscript.json` (`identitytoolkit`, `cloud-platform`) will show up on the authorise screen - that's expected.
- If a reset says *Firebase refused the change (403)*, the deploying account isn't an Owner/Editor of the Firebase project.

"Anyone" only makes the URL reachable. Every request must carry a valid Firebase sign-in token for an **active** user or Apps Script rejects it. Share the Sheet with Admins only.

### 4. GitHub
```bash
git remote add origin https://github.com/<you>/star-showbase.git
git push -u origin main
```
Repo **Settings → Pages → Source: GitHub Actions**. Every push to `main` redeploys the site.


### 5. Shows Sheet + booking emails (optional, any time later)
1. Create a **new** Google Sheet (e.g. "STAR Shows") - not the backup one. **Extensions → Apps Script**.
2. Replace `Code.gs` with `apps-script/shows/Code.gs` and `appsscript.json` with `apps-script/shows/appsscript.json`. Optionally set `APP_URL` (link in emails). Venue groups and colours are `VENUES` at the top: any venue with "theatre"/"theater" → THT (red), "terrace" → TERRACE (orange), "loft" → LOFT (green), "studio"/"gallery" → GAL/STU (blue), anything else → Other (purple). Maintenance calls have no colour.
3. **Deploy → New deployment → Web app**: *Execute as* **Me** (the Firebase project owner), *Who has access* **Anyone**. Copy the `/exec` URL into `public/js/config.js` → `showsWebAppUrl`, push.
4. That's it: there are no timers or menus. Each booking / availability / show save in the app rebuilds that month's tab (e.g. "Oct 26"). Crew rows read **Name ROLE** - **cyan = confirmed, yellow = soft**; the Name / ID No. list for each week shows everyone **confirmed** that week, once each, in ID order. Share the Sheet **view-only**; edits there are overwritten.
5. Booking emails: an Admin switches them on in **Availability** (off by default). They come from the Google account that deployed the script.

---

## Permissions

Admin always has full access. Everything below is per person, starting from the role template (Users & Permissions › People & access: pick → tick → Save).

| Module | Feature | Co-Admin | Member | Server-enforced |
|---|---|---|---|---|
| Catalogue | See the tab · Export CSV | ✅ · ✅ | ✅ · ❌ | UI |
| | Add detailed · Add general · Delete | ✅ · ✅ · ❌ | ❌ | ✅ |
| | Import CSV (also needs Add detailed) | ✅ | ❌ | UI |
| Rack Layout | See the tab | ✅ | ✅ | UI |
| Inventory Check | See & tick · Report discrepancies | ✅ | ✅ | ✅ |
| | Start/finish rounds · Review discrepancies · History & PDF · Delete history | ✅ | ❌ | ✅ |
| Maintenance | See the tab | ✅ | ✅ | UI |
| | Submit requests | ✅ | ✅ | ✅ |
| | See everyone's requests · See Confirmed & Repairing | ✅ | ❌ (own only) | ✅ |
| | Verify / reject · Send to repair / mark repaired | ✅ | ❌ | ✅ |
| Loans | See the tab · Request | ✅ | ✅ | ✅ (request) |
| | See everyone's · Approve/assign/receive · Set On Loan from catalogue | ✅ | ❌ | ✅ |
| Show Sign-Out | See the tab · Sign gear out | ✅ | ✅ | ✅ (sign out) |
| | See everyone's shows | ✅ | 🔒 never (own only) | ✅ |
| Log History | See the tab | ✅ | ❌ | ✅ |
| | Download PDF | ✅ | ❌ | UI |
| Data scope | Columns see / edit, categories see / edit | all | all / none | Edit ✅ · column visibility UI only* |

\* Firestore sends whole documents, so a hidden column can still be read in the browser's developer tools. If a column is truly confidential it must move to a separate collection.

**Condition vs Year of Purchase:** Condition ignores the Edit lock (still needs the Condition edit right); Year of Purchase and every other column need the lock switched on.

## Workflows

**Maintenance**  Report fault → ① Requests → *Verify & Confirm* (condition, move-to space/location) → ② Confirmed Faulty → *Send to Repair* (vendor, date) → ③ Repairing → *Mark Repaired* (condition, space, location, serial, cost, notes optional) → back in the catalogue.

**Loans**  Request (names + qty, collect ≥ 2 days ahead, return ≥ collect, reason optional) → approver assigns exact units (details auto-fill, units → On Loan) → borrower **Collected** → borrower **Return** → approver checks each unit in (condition, space, location). Approvers can also reject, or cancel an approved loan (units go back to their previous condition).

**Show Sign-Out**  Title + date + venue (required, pick from the list) → add gear by name and quantity → after the show, tick what's back → **Sign In**. Unticked lines are recorded as missing and logged. Show lists don't change catalogue status, because they're names, not specific units.

**Inventory Check**  A manager starts a round for one venue (Item Space). Everyone ticks what they can see; several venues can run at once. **Finish round** saves a frozen summary (verified / not found per item) to **History**, downloadable as PDF and kept until someone with permission deletes it. **Report discrepancy** proposes changes (counted quantity for bulk items) or marks an item missing; nothing changes until a manager approves it.

**Lending from the catalogue**  Pick **On Loan** in an asset's Condition. A pop-up asks for the borrower name, dates and reason, and creates a loan that's already out in Equipment Loans. Pick another condition later and the app offers to close that loan.

---

## Testing
```bash
npm run serve           # http://localhost:8765/?demo
npm run test:rules      # 203 security-rule checks on the Firestore emulator (needs Java)
pip install playwright && python3 -m playwright install chromium
npm run test:e2e        # 248 browser checks in demo mode (both themes) (needs `npm run serve` running)
npm run test:shows      # 23 checks of the Shows Sheet + booking emails script against a mock Sheet + Firestore
npm run test:bundles    # 22 checks of the bundle logic (no browser needed)
npm run test:people     # 15 checks of the people copy (no browser needed)
npm run test:backup     # 8 checks of the backup Sheet writer (SGT times, Deleted Inventory tab)
```

## Security checklist (before go-live)
1. `npm run test:rules` passes, then `npm run deploy:rules`.
2. Strong host password (set via the backup Sheet's **Showbase admin** menu).
3. Sheet sharing: **backup** = Admins only · **shows** = view-only.
4. Firebase › Authentication › Settings › **Authorized domains**: only your GitHub Pages address (plus localhost for testing).
5. Google Cloud › APIs & Services › Credentials: restrict the **browser API key** to your site (HTTP referrers) and to the Identity Toolkit + Cloud Firestore APIs. The two Apps Scripts can't use that key (Apps Script sends no referrer, so backups, password resets and the Shows sync would stop): create a **second API key** restricted to the **Identity Toolkit API** only, with no application restriction, and paste it into `CFG.FIREBASE_API_KEY` in both `Code.gs` files **in the Apps Script editor only**. Don't commit that key to the GitHub Pages repo.
6. Optional: Firebase **App Check** (reCAPTCHA) to stop scripted sign-up spam.
7. Keep Admins few; Co-Admins get exactly the features they need.

What is enforced where: the **database rules** enforce every permission (approval, verified email, temporary-password lock, features, rows, bookings, crew-role privacy). The **Apps Scripts** accept only signed-in, verified, approved users, re-read data from Firestore themselves (nothing the browser sends is written to a Sheet as-is), and write all text so Sheets can't treat it as a formula.

## Known limits
- Hidden **columns** are hidden in the app only - Firestore sends whole asset records to anyone allowed to see that row.
- Someone given a temporary password could clear the "must change" flag with a crafted request and keep the temporary password (which the Admin knows). Low risk; reset again if in doubt.
- Log entries are written by the signed-in user's browser: they can't be edited or deleted, but a rogue approved user could add a misleading one.
- Booking emails come from the Gmail account that deployed the shows script: about 100 / day on a free account.
- Photo / video attachments need Firebase Storage (Blaze plan) - not included.
- A restricted user could see at most 30 categories before the bundles are built (a Firestore query limit); with bundles there's no limit.
- Bundles: the browser copy can be cleared by the browser (e.g. Safari after 7 days without a visit, private windows). That just means one full download (about 15 reads). Everyone's inventory saves also update one shared record (`invMeta/changes`), which Firestore handles at about one save per second sustained - far above normal team use; clashing saves retry automatically.
- The month copy for the team grid and the people copy rely on each device's clock (with 10 minutes' leeway); they are rebuilt from scratch at least once a day.
- Log History search and filters only look through the entries loaded so far (newest 50 + any you load). The PDF reads straight from the database, so it always covers the full range you pick.
- Removing someone's login entirely is done in Firebase console → Authentication; the app can disable them instantly.
- The Sheets backup is pushed from the browser. If a tab closes mid-send the change is retried on that browser's next visit; the optional nightly snapshot covers the rest.
- General (bulk) items are one record: a loan or condition change applies to the whole batch. Split the batch (edit the quantity and add a second record) if part of it goes out.
- PDF export uses standard PDF fonts, so non-Latin characters (e.g. Chinese names) are dropped from the PDF. They still show in the app and the CSV.
