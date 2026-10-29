# Showbase / STAR Inventory - Gear, Shows & Crew (v5.11)

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

## What's new in v5.11 - far fewer database reads, lighter log
- Loan managers keep only OPEN loans live; finished loans load when asked (search, "Finished" filter, or the button) and are kept in the browser for 3 hours. A loan that closes while the app is open is added at once.
- Full-timers keep the last 60 days of show sign-outs plus anything still signed out live; older ones load on request (3-hour copy). Discrepancy reviewers keep only pending reports live; finishing a check round reads just that round's reports.
- Edits this browser saved itself are applied from memory instead of being read back (bundles.js ownTx).
- v5.11.1: Today's two extra lists (next 7 days, next month's availability) stay on after the first visit instead of restarting every time you return to Today.
- v5.11.2: Log History opens empty and costs no reads until "Load newest 50 entries" is pressed.
- Settings > "Database reads on this device": estimated reads by list since the app was opened.
- Log History keeps: asset create/import/delete, condition and location changes (not detail edits), loans, maintenance, discrepancy review, account actions. Dropped: show sign-out/in/gear lines, crew role ticks, role template edits, auto sign-out changes, finished rounds, detail edits.

## What's new in v5.10 - fault reports mark the asset Faulty at once
- A member's fault report sets the asset to Faulty straight away, tagged "Awaiting confirmation" in the Asset Catalogue. A Co-Admin's Verify & Confirm changes the tag to "Confirmed faulty"; Reject puts the previous condition back. Any later condition change (repair, loan, check) clears the tag.
- New asset fields faultStatus and condBefore (rules: members may only set Faulty / pending together with their own report). The backup Sheet gets a "Fault status" column at the end of Inventory and Deleted Inventory (apps-script/Code.gs).

## What's new in v5.9 - sort by space / location
- Asset Catalogue sort menu: Item space A → Z / Z → A and Item location A → Z / Z → A (blanks last).

## What's new in v5.8 - people list fix
- The Admin People & Access list could save a partial copy (only the profiles the browser already held) and then never show the rest. The app now saves the people copy only from a server-confirmed answer, and copies saved before 2026-10-27 06:00 UTC are rebuilt once.

## What's new in v5.7 - frozen condition bar, Equipment Loans as a list

1. **Condition colour bar frozen** in Asset Catalogue: the Condition / Year bar and its coloured chips now stay with the search and filter row under the title row while you scroll. The four tiles (Fault reports, Repair vendor, Loan requests, Check discrepancies) sit in a row above and scroll away.
2. **Equipment Loans is a list**, like the Asset Catalogue: one line per loan (equipment, borrower, collect / return dates, status and its buttons). Click a line to open the details (who requested, reason, note, exact units, progress). 
3. **Search and filter on the Loans page**, frozen at the top: search equipment, borrower, requester, reason or unit; status filter (Requested, Return pending, Ready to collect, On loan, Overdue, Finished). Empty sections hide while you search.

4. **Identical loans share one line** in Equipment Loans (same equipment, borrower, status and dates), e.g. "1 × Digico … · 7 loans · For NCC". Click it to see each loan with its own buttons. The group line also has **Return all (n)** (for the borrower) and **Receive all (n)…** (loan managers: one check-in pop-up listing every unit, close them all at once).
5. **Phone fixes.** The top menu bar and the frozen bars now stay for the whole page on a phone (the page area was only one screen tall, so they let go after one screen of scrolling). Long Internal Asset No / Asset No / Serial No values are no longer cut off: the column widens and the table swipes sideways.

Files changed: `index.html`, `css/base.css`, `css/components.css`, `js/inventory.js`, `js/loans.js`, `tests/e2e_demo.py`. No rules change. Tests: e2e 376.

## What's new in v5.6 - pages remember their place, frozen top bars

1. **Each page keeps its place.** Leave a page (e.g. Asset Catalogue) for another and come back: it returns to the same scroll position, with the same search, filters, open categories and "Show more" state. Refreshing the browser, or being away from that page for **more than 10 minutes** (fixed), starts it at the top again. Signing out forgets everything.
2. **Frozen top bars on every page.** The title row with Import / Export / Edit / Add buttons, the search box and the filters stay at the top while you scroll: Asset Catalogue, Rack Layout, Inventory Check (tabs + search), Faults & Repairs (+ the repairs search), Equipment Loans, Show Sign-Out, Activity Log, My Availability (tabs + month), Show Calendar (month + tabs). On a phone the bar sits under the top menu bar, filters become one sideways-scrolling row and the sub-titles are hidden to keep it short.

Files changed: `index.html`, `css/components.css`, `js/shell.js`, `js/availability.js`, `js/events.js` (no rules change). Tests: e2e 356.

(v5.5 = the Co-Admin optional availability + roster order changes listed under v5.4 below.)

## What's new in v5.4 - Co-Admin tools, 20 colours, repeat shows, several venues, auto sign-out

1. **Admin tools for chosen Co-Admins.** People & Access now has an **Admin tools (Co-Admins only)** box with two ticks: *Edit asset conditions* and *Reset other people's passwords*. Both start **off** for every Co-Admin; the Admin ticks them per person (or on the Co-Admin template). A Co-Admin with *conditions* sees Settings with only the conditions part; with *reset* sees People & Access as a simple search-and-reset list (active people only, never Admins). Members can never get these.
2. **20 condition colours** (9 theme colours + 11 more), with a swatch beside the picker.
3. **Password reset by Co-Admins needs the new backup script**: paste the new `apps-script/Code.gs` into the backup Sheet's Apps Script editor (keep your own `CFG` block) and **Deploy > Manage deployments > edit > New version**.
4. **Repeat a show / maintenance call** (Availability > Shows & manpower): *Repeat...* on a show, or inside Edit details. Every week / 2 weeks / month / day (up to 26 copies) or dates you pick. Copies have no crew booked; dates that already have the same name are skipped. **Recall:** when adding a new show or call, picking a name used before fills in its times, venue, manpower and notes - change the date or anything else.
5. **Several venues on one show.** In the show / call editor and the booking pop-up, pick or type a venue and leave the box to add it as a chip; add as many as needed (e.g. Studio 1, Studio 2, Studio 5). Pages, the Calendar and the Shows Sheet show them combined: `Studio 1, 2, 5`, or `Studio 1-3` for three or more in a row (`Studio 1-3, 5`; other names stay separate: `Studio 1, 2, Gallery 3`). Stored as `jobs.venues` (list) plus `jobs.venue` (the combined text, so older records and Sheets keep working). Colour follows the first studio. Everything filled in by recall is editable.
6. **Availability is optional for Co-Admins.** They stay on the roster and can be booked, and can fill in their own days if they like, but they are never listed as "not filled", never counted or reminded (Reminders panel, Today tile, their own banner/badge).
7. **Team roster order.** Sorted by Casual ID number, lowest first (C9 before C20788); Co-Admins (full-time) right below the casuals, A-Z. Same order in the Reminders panel and Today tile.
8. **Auto sign-out when idle.** Default 15 minutes with no taps, clicks or typing (shared across open tabs); a warning with *Stay signed in* shows for the last minute. Admin changes it (Never / 10 / 15 / 30 / 60) in **Settings > Auto sign-out** (`settings/app.idleMinutes`). Not applied while an import is running.

**Upgrade:** (1) publish `firestore.rules` (no new index); (2) upload the changed files: `index.html`, `css/components.css`, `js/perms.js`, `core.js`, `shell.js`, `admin.js`, `jobs.js`, `shows.js`, `events.js`, `availability.js`, `today.js`; (3) paste the new `Code.gs` and deploy a new version; (4) tick *Admin tools* for the Co-Admins you choose.

Tests: rules 243, e2e 334, bundles 22, people 15, backup 9, shows 23.

## What's new in v5.3.1 - full-time staff sign up without a Casual ID

| Area | Change |
|---|---|
| Sign-up | New tick under Casual ID: **I'm full-time staff (no Casual ID)**. It clears and disables the Casual ID box; the profile is saved with `casualId: ""`. Casual staff still must enter one. |
| Approvals · People & Access | A blank Casual ID shows as **Full-time** (it used to say "missing"). The Admin's **Edit** Casual ID box now accepts empty = full-time, so an Admin can also switch someone either way. |
| Availability | Unchanged: Co-Admins (and anyone with "Mark own available days") still appear in the roster; full-timers just have no Casual ID next to their name. |

**Upgrading from v5.3:** upload `public/index.html`, `public/js/shell.js` and `public/js/admin.js`. No rules, index or Apps Script changes (the rules already allow a blank Casual ID).

---

## What was new in v5.3 - Today page, shared show gear, phone app, loan return date TBC

| Area | Change |
|---|---|
| **Today** (new first page) | The app now opens on **Today**. At the top, **My next show**: the next show or maintenance call you're booked on (today's first), with call time, venue + Google Maps link, your role, the team with their roles, and a **Sign out gear** button. Below, **Needs you** tiles, each only if you have the permission for it: fault reports to verify, loans to approve / receive, overdue loans, loans with return date TBC out over 30 days, shows this week short of crew, gear still signed out (⚠ when past the show date), and "N people haven't filled <next month>" with a **Remind them** button (same reminder as My Availability › Team). It uses data already loaded; bookers add 2 small reads while Today is open (this week's jobs, next month's availability copy). |
| **Shared show gear** | **Sign out gear** on the Today card (or on a job in the Show Calendar) starts that job's sign-out with the title, date and venue filled in, saved as `shows/job_<jobId>` with `jobId` and `crewUids`. The first press creates it; later presses open the same list. Everyone booked on the job can see it, **+ Add gear**, tick items back in (each tick is saved for the whole crew, 1 write) and **Sign In**. When a booker adds or removes someone on the job, the list's crew follows in the same save. Nobody else can see it (members still only see their own plain sign-outs). Full-timers see the list on the job in the **Show Calendar**: missing items or gear still out after the show get a ⚠ on the calendar chip. Sign-outs not linked to a job work as before. |
| **Phone app** | The site can be installed: Android Chrome shows **Install app** (also a button on Today); on iPhone use Safari › Share › **Add to Home Screen** (short how-to on Today). `manifest.webmanifest`, icons in `public/icons/`, and `sw.js`, a service worker that keeps a copy of the app's own files for quick loads. It always asks the server first, so an upload reaches everyone straight away; the saved copy is only used with no connection. Firebase / Google requests are never cached: live data still needs internet. On iPhone the home-screen icon uses your branding logo. |
| **Loan return date TBC** | A **Return date TBC** tick in **+ Request Loan** and in the catalogue's **On Loan** pop-up clears the date (`returnDate: ""`, `returnTbc: true`). "TBC" shows on loan cards, approvals, the catalogue loan tag, the collect message, logs and the backup Sheet. A TBC loan is never overdue. Loan managers and the borrower can **Set return date** later (logged). TBC loans out over 30 days are listed on Today. |
| **Menu names** | Maintenance → **Faults & Repairs** · Events → **Crew** · Availability → **My Availability** · Calendar → **Show Calendar** · Log History → **Activity Log** · Users & Permissions → **People & Access** · Branding → **Settings** · tagline "Inventory & Asset Control" / "Asset System" → **Gear, Shows & Crew**. The calendar's "maintenance call" job type keeps its name. Unchanged: Inventory, Asset Catalogue, Rack Layout, Inventory Check, Operations, Show Sign-Out, Equipment Loans, Admin. |

**Upgrading from v5.2.3:**
1. Publish the new `firestore.rules` (Firebase console › Firestore › Rules, paste, Publish).
2. Add one composite index (Firestore › Indexes › Composite › Create): collection `shows`, fields `crewUids` **Arrays** + `showDate` **Ascending**, query scope Collection. Wait until it says Enabled.
3. Upload to GitHub: `public/index.html`, `public/manifest.webmanifest`, `public/sw.js`, the `public/icons/` folder, `public/css/components.css`, and in `public/js/`: `today.js` (new), `shows.js`, `shell.js`, `events.js`, `jobs.js`, `availability.js`, `loans.js`, `inventory.js`, `core.js`, `perms.js`, `admin.js`, `logs.js`, `store.js`.
4. Optional: paste the new `apps-script/Code.gs` into the backup Sheet's Apps Script editor (keep your `CFG` values, including the second API key) and deploy a new version, so TBC loans show "TBC" in the Loans tab instead of a blank.

---

## What was new in v5.2.3 - Faulty opens the fault report, "No code" filter

| Area | Change |
|---|---|
| Picking Faulty | Changing an asset's condition to **Faulty** (in the table, Rack Layout or the ✎ edit form) opens the same **Log Maintenance** pop-up as the ⚠ button, with the asset filled in, so a maintenance ticket is made too. Admins / Co-Admins start on **"I've verified it - Confirmed Faulty"**, which sets the condition straight away. Members send a fault request, as with ⚠, and the condition changes once it's verified. Cancel leaves the condition as it was. In the edit form, your other changes are saved first. If the asset already has an open ticket, or you can't report faults, Faulty is simply set as before. |
| "No code" | The Catalogue's **Year of purchase** summary has a new **No code** chip next to **Needs finance code**: every asset still in use (not retired) with an empty Code / AEV, whatever its year. Click it to filter. It's also in the purchase-year filter list. "Needs finance code" is unchanged (year set, no code). |

**Upgrading from v5.2.2:** upload `public/js/core.js`, `inventory.js`, `maintenance.js` and `public/css/components.css`. No rules, indexes or Apps Script changes.

---

## What was new in v5.2.2 - Rack Layout stays quick with thousands of assets

| Area | Change |
|---|---|
| Rack Layout / Inventory Check search | Searching used to open every matching location and category on every keystroke. With 4,000 assets, typing one letter drew about 4,500 rows and froze the page for over 10 seconds. Now the search waits for a short pause in typing, and it only opens everything when there are **150 matches or fewer**. With more, a note says how many matched, and you open the location or category you want. |
| Big categories | An open category draws its first **100** rows, with a **Show all** button for the rest. **Expand all** opens only the locations when more than 1,000 assets are showing. |
| Opening a location / category | Only that location is redrawn, not the whole tree (about 15 ms instead of 150+ with 4,000 assets). With more than 40 locations, they start **closed**, so the page lists them and you open the one you want. |
| Catalogue | Draws **100 models at a time**, with **Show more** / **Show all** at the bottom (search and filters still cover every asset). Several updates arriving together are drawn once. |
| Leaving the page | Rack Layout and Inventory Check clear their rows when you switch to another page (they're redrawn when you come back), so thousands of hidden rows don't slow the rest of the site. |

**Upgrading from v5.2.1:** upload `public/index.html`, `public/js/rack.js`, `public/js/inventory.js`, `public/js/shell.js` and `public/css/components.css`. No rules, indexes or Apps Script changes.

---

## What was new in v5.2.1 - safer big imports

| Area | Change |
|---|---|
| One import at a time | While an import runs, the **Import** button says *Importing…* and can't be pressed again, the dialog can't be closed, and the browser asks before you leave or reload the page. Before this, a second click started a second import alongside the first, which caused duplicates. |
| Progress | The dialog shows **"Saving 1,200 of 4,041… Keep this page open."** It closes with a summary when everything is saved. |
| Safe to run again | Each imported row gets an id made from its contents, so **importing the same file again overwrites those rows instead of adding duplicates**. If an import stops part-way (lost connection, page closed, daily limit), it says how far it got, and you just import the same file again to finish. The app tells you first when some rows are already in. Rows imported before v5.2.1 have random ids, so they aren't matched. Use **Replace all** once to clean them up. |
| Replace all | Removes every asset that **isn't in the file** and saves the file's rows. If it stops part-way, run the same Replace again and it finishes the job. |
| Big categories | A bundle now holds up to **800** assets (was 2,000), and `firestore.indexes.json` turns off indexing for the bundle and saved-copy maps. Firestore allows 40,000 index entries per record, and every field of every asset counts about 2, so a category of about 1,000+ assets would have failed to save. Deploy indexes: `npx firebase deploy --only firestore:indexes`. |

**Upgrading from v5.2:** deploy the indexes (`npx firebase deploy --only firestore:indexes`; this adds single-field exemptions and builds nothing heavy), then upload `public/index.html`, `public/js/bundles.js`, `core.js`, `inventory.js`, `store.js` and `public/css/components.css`. No rules or Apps Script changes.

---

## What was new in v5.2 - asset conditions you can edit

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
| `public/js/inventory.js` · `rack.js` · `maintenance.js` · `loans.js` · `shows.js` · `availability.js` · `jobs.js` · `events.js` · `today.js` · `logs.js` · `admin.js` | One file per module (`today.js` = the Today page) |
| `public/manifest.webmanifest` · `public/sw.js` · `public/icons/` | Install as a phone app: name, icons, theme colour; service worker (network first, never caches Firebase) |
| `public/js/pdf.js` | Shared PDF report layout (Activity Log, Inventory Check history) |
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
| `loans/{id}` | `borrowerName`, `source` (request / catalogue), `items[]`, `collectDate`, `returnDate` (`""` with `returnTbc: true` = TBC), `reason`, `status`, `assigned[]`, `history[]` | Requester: create / cancel / Collected / Return / set a TBC return date · loan managers: the rest · catalogue lenders: create catalogue loans |
| `shows/{id}` | `title`, `showDate`, `venue` (required), `items[{name, qty, accounted}]`, `status` out/in, `missingCount`; job sign-outs (`shows/job_<jobId>`) also `jobId`, `crewUids[]` (copied from the job) | Owner while out · job sign-outs: everyone on the job's crew (add gear, tick, sign in; lines can't be removed) and bookers (crew list only, must match the job) · never deleted (primary Admin only) |
| `audits/{roundId}` | Check round: `venue`, `name`, `status` open/closed, started/closed by + at, frozen `summary` (total, checked, discrepancies, items) | Start/finish: rounds permission · delete: history-delete permission |
| `checkTicks/{roundId}_{n}` | A round's ticks, ~200 assets per record: `ticks{assetId: {checked, at, by, byName, byUid}}`, `last` (cleared when the round finishes; the round's `shards` says how many) | Anyone with the Check tab, while the round is open |
| `discrepancies/{id}` | `current{}`, `proposed{}`, `missing`, `note`, `status` | Reporter creates · Manage checks reviews |
| `avail/{uid}_{YYYY-MM}` | One person, one month: `avail[]` free days (incl. booked), `soft[]`, `conf[]`, `withdrawn[]`, `name`, `casualId`, `times{day: "HH:MM-HH:MM"}` (no entry = all day) (days are `"01"`…`"31"`) | Member: own free days, withdraw soft · bookers: bookings · the roster Sheet script (as project owner) |
| `crewRoles/all` | `roles{uid: [..]}`, `updatedAt`, `updatedBy` - every crew role tick (SE / ST / CRS / NEW) in one record | Bookers tick them in My Availability › Team · readable by Admins / Co-Admins (see-everyone or booking rights), never members |
| `jobs/{id}` | One show or maintenance call on one date: `kind` show/maint, `date`, `month`, `title`, `start`, `end` (HH:MM), `venue`, `manpower[{role, qty}]`, `notes`, `crew[{uid, name, casualId, role}]`, `crewUids[]` | Bookers (Admin / Co-Admin) · readable by bookers and by the people on it |
| `settings/rosterLists` | Remembered `titles`, `maintTitles`, `roles`, `times` for type-and-select | Bookers |
| `reminders/{id}` | `month`, `uids[]`, `byUid`, `byName`, `at` - an availability reminder | Bookers create · members read the ones naming them · can't be edited |
| `settings/availability` | `emailOnBooking` | Admin |
| `logs/{id}` | Append-only audit trail | Everyone appends their own; primary Admin resets |
| `invBundles/{bid}` | `cat`, `v`, `items{assetId: asset}`, `last[]` - copies of up to 800 assets of one category | Saved automatically with every inventory save (each entry must match the asset) · Admin builds |
| `invMeta/changes` | `seq`, `bundles{bid: {cat, v, n, sz}}`, `recent[{s, b, id}]` (last 300 edits) | Moves on by one with every inventory save · Admin builds |
| `availMonths/{YYYY-MM}` | `rows{availDocId: doc}`, `mark`, `builtAt`, `n` - one copy of a whole month for the team grid | Admins / Co-Admins who can see everyone's availability |
| `peopleCopy/all`, `peopleCopy/active` | `rows{uid: profile}`, `mark`, `builtAt`, `n` - one copy of every profile (all) or of active people (active) | all: Admins · active: Admins and bookers |

**Upgrading from v3:** profiles stored `tabs{}` + `can{}`. The app translates them on the fly, but the v4 rules only read `perm{}`. After deploying, open **People & Access** and pick each template and click **Apply to N …** (or save any person, which writes their full `perm` map). `settings/audit` is no longer used.

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
3. Open the app and sign in with **Username:** `Starpacsound Admin` + that password. Set the name and logo in **Admin › Branding**, then approve everyone else in **People & Access**.

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

Admin always has full access. Everything below is per person, starting from the role template (People & Access: pick → tick → Save). **Today** is open to everyone and only shows what each person has permission for.

| Module | Feature | Co-Admin | Member | Server-enforced |
|---|---|---|---|---|
| Catalogue | See the tab · Export CSV | ✅ · ✅ | ✅ · ❌ | UI |
| | Add detailed · Add general · Delete | ✅ · ✅ · ❌ | ❌ | ✅ |
| | Import CSV (also needs Add detailed) | ✅ | ❌ | UI |
| Rack Layout | See the tab | ✅ | ✅ | UI |
| Inventory Check | See & tick · Report discrepancies | ✅ | ✅ | ✅ |
| | Start/finish rounds · Review discrepancies · History & PDF · Delete history | ✅ | ❌ | ✅ |
| Faults & Repairs | See the tab | ✅ | ✅ | UI |
| | Submit requests | ✅ | ✅ | ✅ |
| | See everyone's requests · See Confirmed & Repairing | ✅ | ❌ (own only) | ✅ |
| | Verify / reject · Send to repair / mark repaired | ✅ | ❌ | ✅ |
| Loans | See the tab · Request | ✅ | ✅ | ✅ (request) |
| | See everyone's · Approve/assign/receive · Set On Loan from catalogue | ✅ | ❌ | ✅ |
| Show Sign-Out | See the tab · Sign gear out | ✅ | ✅ | ✅ (sign out) |
| | See everyone's shows | ✅ | 🔒 never (own + the shared lists of jobs they're booked on) | ✅ |
| Activity Log | See the tab | ✅ | ❌ | ✅ |
| | Download PDF | ✅ | ❌ | UI |
| Data scope | Columns see / edit, categories see / edit | all | all / none | Edit ✅ · column visibility UI only* |

\* Firestore sends whole documents, so a hidden column can still be read in the browser's developer tools. If a column is truly confidential it must move to a separate collection.

**Condition vs Year of Purchase:** Condition ignores the Edit lock (still needs the Condition edit right); Year of Purchase and every other column need the lock switched on.

## Workflows

**Maintenance**  Report fault → ① Requests → *Verify & Confirm* (condition, move-to space/location) → ② Confirmed Faulty → *Send to Repair* (vendor, date) → ③ Repairing → *Mark Repaired* (condition, space, location, serial, cost, notes optional) → back in the catalogue.

**Loans**  Request (names + qty, collect ≥ 2 days ahead, return ≥ collect or **Return date TBC**, reason optional) → approver assigns exact units (details auto-fill, units → On Loan) → borrower **Collected** → borrower **Return** → approver checks each unit in (condition, space, location). Approvers can also reject, or cancel an approved loan (units go back to their previous condition).

**Show Sign-Out**  Title + date + venue (required, pick from the list) → add gear by name and quantity → after the show, tick what's back → **Sign In**. Unticked lines are recorded as missing and logged. Show lists don't change catalogue status, because they're names, not specific units. **For a calendar show** use **Sign out gear** on Today or the job in the Show Calendar: the list is shared with everyone booked on the job, any of them can add gear, tick items (saved for all) and sign it in.

**Inventory Check**  A manager starts a round for one venue (Item Space). Everyone ticks what they can see; several venues can run at once. **Finish round** saves a frozen summary (verified / not found per item) to **History**, downloadable as PDF and kept until someone with permission deletes it. **Report discrepancy** proposes changes (counted quantity for bulk items) or marks an item missing; nothing changes until a manager approves it.

**Lending from the catalogue**  Pick **On Loan** in an asset's Condition. A pop-up asks for the borrower name, dates and reason, and creates a loan that's already out in Equipment Loans. Pick another condition later and the app offers to close that loan.

---

## Testing
```bash
npm run serve           # http://localhost:8765/?demo
npm run test:rules      # 243 security-rule checks on the Firestore emulator (needs Java)
pip install playwright && python3 -m playwright install chromium
npm run test:e2e        # 376 browser checks in demo mode (both themes) (needs `npm run serve` running)
npm run test:shows      # 23 checks of the Shows Sheet + booking emails script against a mock Sheet + Firestore
npm run test:bundles    # 22 checks of the bundle logic (no browser needed)
npm run test:people     # 15 checks of the people copy (no browser needed)
npm run test:backup     # 9 checks of the backup Sheet writer (SGT times, Deleted Inventory tab, TBC return dates)
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
- Activity Log search and filters only look through the entries loaded so far (newest 50 + any you load). The PDF reads straight from the database, so it always covers the full range you pick.
- Removing someone's login entirely is done in Firebase console → Authentication; the app can disable them instantly.
- The Sheets backup is pushed from the browser. If a tab closes mid-send the change is retried on that browser's next visit; the optional nightly snapshot covers the rest.
- General (bulk) items are one record: a loan or condition change applies to the whole batch. Split the batch (edit the quantity and add a second record) if part of it goes out. Faulty units are the exception (v5.13): a fault report on a bulk item names how many units are faulty, the line stays Available and shows "N available · M faulty".
- PDF export uses standard PDF fonts, so non-Latin characters (e.g. Chinese names) are dropped from the PDF. They still show in the app and the CSV.
- Members see shared job gear lists from the last 60 days (plus any they open from Today or the calendar). Older ones stay in the database and full-timers still see them all.
- The installed phone app still needs internet for data; with no connection it opens but can't load or save anything. iPhone only installs from Safari.

## v5.13 - faulty units of a general (bulk) asset
- A fault report on a general asset asks "Faulty units" (1 to the units still available). The asset keeps its condition; `faultyQty` counts the faulty units and `faultPendingQty` those awaiting a Co-Admin. The catalogue shows "N available · M faulty" and "M awaiting confirmation" under the Qty.
- Several reports can be open on one general asset at once. Confirm can take fewer units than reported (the rest go back to available); Reject takes the whole report off; Send to repair leaves the count; Fixed / Repaired puts the units back (a retired condition removes them from the quantity instead).
- Rules: `isUnitFaultReport` lets a member raise the counts by exactly the units in their own report; the other steps are normal workflow writes (`faultyQty`, `faultPendingQty` added to `wfKeys`). Backup Sheet: `faultyQty` appended to the Inventory and Deleted Inventory columns.
