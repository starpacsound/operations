/**
 * Showbase -> SHOWS Google Sheet + booking emails (one-way, app -> Sheet)
 * ------------------------------------------------------------------
 * Availability, bookings and crew role ticks live only in the app. This script just:
 *   - rebuilds the monthly Shows Sheet (one tab per month, Sunday-Saturday week blocks) whenever the
 *     app saves a booking, a show / maintenance call or someone's availability, and
 *   - emails people when a booker changes their booking (only when "email on booking" is on in the app).
 * Bind it to the Shows Sheet (Extensions > Apps Script), then Deploy > New deployment > Web app:
 * Execute as "Me", Who has access "Anyone". Paste the /exec URL into public/js/config.js -> showsWebAppUrl.
 * Deploy with the Google account that OWNS the Firebase project: it reads Firestore with that account's access.
 * Share the Sheet view-only with the team. Nothing is ever written back to the app.
 *
 * Reads per update: the saved copies the app keeps (peopleCopy/active, availMonths/{month}) plus only
 * what changed since, and that month's shows - about 5 reads + the month's shows (no timers).
 */

const CFG = {
  FIREBASE_API_KEY: 'AIzaSyAraFqQWYbeAf1NoRikNpyBYF98rvyxjKo',
  FIREBASE_PROJECT_ID: 'starpac-audio',
  APP_URL: '',                       // e.g. https://<you>.github.io/<repo>/  (link in emails)
  USERNAME_DOMAIN: 'showbase.local', // username logins (host) have no real mailbox - never emailed
  // Leave '' when this script is bound to the Shows Sheet itself (the usual setup). Or paste another
  // Sheet's ID (the long part of its URL between /d/ and /edit) to write the shows there.
  SHOWS_SHEET_ID: '',
  // Venue colours / legend in the shows Sheet, in display order (name matched case-insensitively,
  // "contains" also matches, e.g. 'GAL/STU' matches "Gallery / Studio" only if you list both names).
  // Any venue whose name contains one of the words goes in that group (first match wins); anything else is "Other".
  VENUES: [
    { name: 'THT', match: ['theatre', 'theater', 'tht'], color: '#e06666', tint: '#f4cccc' },
    { name: 'TERRACE', match: ['terrace', 'terrance'], color: '#f6b26b', tint: '#fce5cd' },
    { name: 'LOFT', match: ['loft'], color: '#93c47d', tint: '#d9ead3' },
    { name: 'GAL/STU', match: ['studio', 'gallery', 'gal/stu'], color: '#6d9eeb', tint: '#c9daf8' }
  ],
  OTHER_VENUE: { name: 'Other', color: '#b4a7d6', tint: '#d9d2e9' },
  MAINT_COLOR: { color: '#ffffff', tint: '#ffffff' },   // maintenance calls: no colour
  CONFIRMED_COLOR: '#00ffff',         // crew row: confirmed booking (cyan)
  SOFT_COLOR: '#ffff00'               // crew row: soft booking (yellow)
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SKEW_MS = 10 * 60 * 1000;          // clocks a few minutes off: re-check docs saved shortly before a copy

// ------------------------------------------------------------------ web app (called by the app)
function doGet() { return json_({ ok: true, service: 'showbase-shows' }); }

// { action: "sync", idToken, months: ["2026-11"], notices: [{ uid, month, day, now }] }
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const me = verifyUser_(body.idToken);
    if (body.action !== 'sync') throw new Error('Unknown action');
    const months = (Array.isArray(body.months) ? body.months : []).filter(function (m) { return /^\d{4}-\d{2}$/.test(m); }).slice(0, 6);
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      months.forEach(function (m) { const d = monthData_(m); writeShowsSheet_(m, d.states, d.users, d.docs); });
    } finally {
      lock.releaseLock();
    }
    // Only bookers' changes are emailed (members changing their own days never are).
    const canBook = me.role === 'Admin' || !!(me.perm && me.perm.avail && me.perm.avail.book === true);
    if (canBook && Array.isArray(body.notices) && body.notices.length) emailNotices_(body.notices.slice(0, 200), me);
    return json_({ ok: true, months: months });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// Returns the caller's app profile (must be signed in, verified and approved).
function verifyUser_(idToken) {
  if (!idToken) throw new Error('Missing sign-in token');
  const res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + CFG.FIREBASE_API_KEY,
    { method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Invalid or expired sign-in token');
  const u = (JSON.parse(res.getContentText()).users || [])[0];
  if (!u) throw new Error('Unknown user');
  if (!u.emailVerified) throw new Error('Email not verified');
  const p = fsGet_('users/' + u.localId);
  if (!p || p.status !== 'active') throw new Error('Account is not approved');
  p.uid = u.localId;
  return p;
}

// ------------------------------------------------------------------ the month's data, cheaply
// People and availability come from the saved copies the app keeps (1 read each) plus only the docs
// saved since; if a copy doesn't exist yet, everything is read once.
const sinceOf_ = mark => new Date(Date.parse(mark) - SKEW_MS).toISOString();
let people_ = null;                      // per execution
function activePeople_() {
  if (people_) return people_;
  const copy = fsGet_('peopleCopy/active');
  if (copy && copy.rows && copy.mark) {
    people_ = copy.rows;
    const changed = queryWhere_('users', [['status', '==', 'active'], ['updatedAt', '>', sinceOf_(copy.mark)]]);
    Object.keys(changed).forEach(function (id) { people_[id] = changed[id]; });
  } else people_ = listUsers_();
  return people_;
}
function monthData_(m) {
  const users = activePeople_();
  const copy = fsGet_('availMonths/' + m);
  let docs;
  if (copy && copy.rows && copy.mark) {
    docs = {};
    Object.keys(copy.rows).forEach(function (k) { const d = copy.rows[k]; if (d && d.uid) docs[d.uid] = d; });
    const changed = queryWhere_('avail', [['month', '==', m], ['updatedAt', '>', sinceOf_(copy.mark)]]);
    Object.keys(changed).forEach(function (k) { if (changed[k].uid) docs[changed[k].uid] = changed[k]; });
  } else docs = queryAvail_(m);
  const n = daysIn_(m), states = {};
  Object.keys(docs).forEach(function (uid) { states[uid] = docStates_(docs[uid], n); });
  return { users: users, docs: docs, states: states };
}

function docStates_(doc, n) {
  let s = '';
  for (let i = 1; i <= n; i++) {
    const d = (i < 10 ? '0' : '') + i;
    s += !doc ? '-' : (doc.conf || []).indexOf(d) >= 0 ? 'C' : (doc.soft || []).indexOf(d) >= 0 ? 'S' : (doc.avail || []).indexOf(d) >= 0 ? 'A' : '-';
  }
  return s;
}


const monthKey_ = d => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
const daysIn_ = m => new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
const nameOf_ = (u, doc) => (u && (u.displayName || String(u.email || '').split('@')[0])) || (doc && doc.name) || '?';
const casualOf_ = (u, doc) => (u && u.casualId) || (doc && doc.casualId) || '';

// Text typed by people (names, show titles, venues...) must never become a Sheets formula:
// a leading = + - @ would make Sheets run it (e.g. =IMPORTDATA to leak data). Prefix ' so it stays text.
function cell_(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@]/.test(v) && v !== '-' ? "'" + v : v;
}

const hm_ = t => !t ? '' : t === '23:59' ? '0000' : String(t).replace(':', '');   // 24-hour like the team's sheet; midnight = 0000

// ------------------------------------------------------------------ 3rd Sheet: compiled shows (one-way)
// Rebuilt from the app's data on every sync, so edits, new bookings and removals always show the latest.
// Don't edit it by hand - it's overwritten. Layout follows the team's existing monthly sheet:
// week blocks (Sunday-Saturday), names + IDs on the left, each show as a venue-coloured block
// (name / time / manpower) with the booked crew underneath, maintenance calls at the bottom.
function writeShowsSheet_(m, mergedByUid, users, docs) {
  const book = CFG.SHOWS_SHEET_ID ? SpreadsheetApp.openById(CFG.SHOWS_SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  const y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1, n = daysIn_(m);
  const tab = MONTHS[mo] + ' ' + String(y).slice(2);              // e.g. "Oct 26"
  let sh = book.getSheetByName(tab);
  if (!sh) sh = book.insertSheet(tab);
  const jobs = queryCol_('jobs', 'month', m);
  const COLS = 9;                                                   // A name, B ID, C..I Sun..Sat
  const dd = d => (d < 10 ? '0' : '') + d;
  const stateOf = (uid, d) => ((mergedByUid[uid] || '')[d - 1]) || '-';
  const nameOf = uid => nameOf_(users[uid], docs[uid]);
  const venueOf = j => {
    if (j.kind === 'maint') return 'MAINT';
    const v = String(j.venue || '').toLowerCase();
    const hit = CFG.VENUES.filter(function (x) { return x.name.toLowerCase() === v || x.match.some(function (k) { return v.indexOf(k) >= 0; }); })[0];
    return hit ? hit.name : 'OTHER';
  };
  const venueCfg = k => k === 'MAINT' ? CFG.MAINT_COLOR : k === 'OTHER' ? CFG.OTHER_VENUE : CFG.VENUES.filter(function (x) { return x.name === k; })[0];
  const bands = CFG.VENUES.map(function (x) { return x.name; }).concat(['OTHER', 'MAINT']);
  const hhmm = t => t === '23:59' ? '0000' : String(t || '').replace(':', '');   // midnight shown as 0000 like the team's sheet

  // Each job -> a list of [text, background, fontColour, bold] lines.
  function block(j) {
    const day = +j.date.slice(8, 10);
    const crew = (j.crew || []).filter(function (c) { return ['S', 'C'].indexOf(stateOf(c.uid, day)) >= 0; });
    const vc = venueCfg(venueOf(j));
    const lines = [];
    if (j.kind === 'maint') {
      lines.push([j.title || 'Maintenance', vc.color, '#000000', true]);
      if (j.start) lines.push([hhmm(j.start) + ' - ' + hhmm(j.end), vc.color, '#000000', false]);
    } else {
      lines.push([j.title, vc.color, '#000000', true]);
      lines.push([hhmm(j.start) + ' - ' + hhmm(j.end) + (j.notes && /^\(?\d+(\.\d+)?h\)?$/i.test(j.notes) ? ' (' + j.notes.replace(/[()]/g, '') + ')' : ''), vc.color, '#000000', false]);
      if ((j.manpower || []).length) lines.push([j.manpower.map(function (x) { return x.qty + x.role; }).join(', '), vc.color, '#000000', false]);
    }
    // "Name ROLE" - cyan when confirmed, yellow when soft booked.
    crew.forEach(function (c) {
      lines.push([(c.name || nameOf(c.uid)) + (c.role ? ' ' + c.role : ''), stateOf(c.uid, day) === 'C' ? CFG.CONFIRMED_COLOR : CFG.SOFT_COLOR, '#000000', false]);
    });
    lines.push(['', vc.tint, '#000000', false]);                   // spacer
    return { band: venueOf(j), lines: lines };
  }
  const blocksByDate = {};
  jobs.slice().sort(function (a, b) { return String(a.start).localeCompare(String(b.start)); }).forEach(function (j) {
    (blocksByDate[j.date] = blocksByDate[j.date] || []).push(block(j));
  });

  const vals = [], bgs = [], fcs = [], fws = [], merges = [];
  const row = (v, bg, fc, fw) => { vals.push(v); bgs.push(bg); fcs.push(fc); fws.push(fw); };
  const blank = c => Array(COLS).fill(c === undefined ? '' : c);
  // Rows 1-3: legend, title, weekday names
  const leg = CFG.VENUES.concat([]);
  row([leg[0] ? leg[0].name : '', leg[1] ? leg[1].name : '', y && Utilities.formatDate(new Date(y, mo, 1), Session.getScriptTimeZone(), 'MMMM yyyy'), '', '', '', '', '', ''],
    [leg[0] ? leg[0].color : null, leg[1] ? leg[1].color : null, '#000000', '#000000', '#000000', '#000000', '#000000', '#000000', '#000000'],
    ['#000000', '#000000', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff'], blank('bold'));
  row([leg[2] ? leg[2].name : '', leg[3] ? leg[3].name : '', '', '', '', '', '', '', ''],
    [leg[2] ? leg[2].color : null, leg[3] ? leg[3].color : null, '#000000', '#000000', '#000000', '#000000', '#000000', '#000000', '#000000'], blank('#000000'), blank('normal'));
  merges.push([1, 3, 2, 7]);
  row(['Name', 'ID No.', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], blank('#fce5cd'), blank('#000000'), blank('normal'));

  // Week blocks
  const first = new Date(y, mo, 1);
  let start = 1 - first.getDay();                                   // Sunday on/before the 1st
  let week = 1;
  while (start <= n) {
    const days = [];
    for (let k = 0; k < 7; k++) days.push(start + k);
    const inMonth = d => d >= 1 && d <= n;
    // Left-hand list: everyone CONFIRMED to work this week - shows AND maintenance calls (soft bookings left out),
    // each person once, sorted by ID No. like the team's sheet.
    const firstShow = {};
    jobs.slice().sort(function (a, b) { return (a.date + a.start).localeCompare(b.date + b.start); })
      .forEach(function (j) {
        const d = +j.date.slice(8, 10);
        if (days.indexOf(d) < 0 || !inMonth(d)) return;
        (j.crew || []).forEach(function (c) {
          if (stateOf(c.uid, d) === 'C' && !(c.uid in firstShow)) firstShow[c.uid] = Object.keys(firstShow).length;
        });
      });
    const idOf = uid => casualOf_(users[uid], docs[uid]);
    const people = Object.keys(firstShow).sort(function (a, b) {
      return idOf(a).localeCompare(idOf(b), undefined, { numeric: true }) || nameOf(a).localeCompare(nameOf(b));
    });
    // Lay out each day's column: bands in venue order, each band as tall as its tallest day
    const cols = days.map(function () { return []; });
    bands.forEach(function (band) {
      const per = days.map(function (d) {
        if (!inMonth(d)) return [];
        return [].concat.apply([], (blocksByDate[m + '-' + dd(d)] || []).filter(function (b) { return b.band === band; }).map(function (b) { return b.lines; }));
      });
      const h = Math.max.apply(null, per.map(function (p) { return p.length; }));
      if (!h) return;
      const tint = venueCfg(band).tint;
      per.forEach(function (lines, k) {
        for (let i = 0; i < h; i++) cols[k].push(lines[i] || ['', inMonth(days[k]) ? tint : '#999999', '#000000', false]);
      });
    });
    const height = Math.max(people.length, cols[0].length, 6);
    row(['Week ' + week, '', ...days.map(function (d) { return inMonth(d) ? d : ''; })],
      ['#fce5cd', '#fce5cd', ...days.map(function (d) { return inMonth(d) ? '#fce5cd' : '#999999'; })], blank('#000000'), blank('bold'));
    merges.push([vals.length, 1, 1, 2]);
    for (let i = 0; i < height; i++) {
      const uid = people[i];
      const v = [uid ? nameOf(uid) : '', uid ? casualOf_(users[uid], docs[uid]) : ''], bg = [null, null], fc = ['#000000', '#000000'], fw = ['normal', 'normal'];
      days.forEach(function (d, k) {
        const cell = cols[k][i];
        if (!inMonth(d)) { v.push(''); bg.push('#999999'); fc.push('#000000'); fw.push('normal'); }
        else if (cell) { v.push(cell[0]); bg.push(cell[1]); fc.push(cell[2]); fw.push(cell[3] ? 'bold' : 'normal'); }
        else { v.push(''); bg.push(null); fc.push('#000000'); fw.push('normal'); }
      });
      row(v, bg, fc, fw);
    }
    start += 7; week++;
  }

  // Write it all in one go (the tab is rebuilt every time, so removals disappear too).
  sh.clear();
  sh.getRange(1, 1, sh.getMaxRows(), Math.min(sh.getMaxColumns(), COLS)).breakApart();
  if (sh.getMaxRows() < vals.length) sh.insertRowsAfter(sh.getMaxRows(), vals.length - sh.getMaxRows());
  const rg = sh.getRange(1, 1, vals.length, COLS);
  rg.setValues(vals.map(function (row) { return row.map(cell_); })).setBackgrounds(bgs).setFontColors(fcs).setFontWeights(fws).setFontSize(9).setVerticalAlignment('middle');
  merges.forEach(function (x) { sh.getRange(x[0], x[1], x[2], x[3]).merge(); });
  sh.getRange(1, 3).setFontSize(16).setHorizontalAlignment('center');
  sh.getRange(1, 1, 3, 2).setHorizontalAlignment('center');
  sh.getRange(3, 3, 1, 7).setHorizontalAlignment('center');
  sh.setColumnWidth(1, 110); sh.setColumnWidth(2, 75); sh.setColumnWidths(3, 7, 150);
  sh.setFrozenRows(3);
  rg.setBorder(true, true, true, true, true, false, '#bbbbbb', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(1, 1).setNote('Generated by Showbase from the app - edits here are overwritten. Updated ' + new Date().toLocaleString());
}


// ------------------------------------------------------------------ email (only when switched on in the app)
// notices come from the booker's app; each is checked against the person's saved availability first.
function emailNotices_(notices, booker) {
  const s = fsGet_('settings/availability');
  if (!s || s.emailOnBooking !== true) return;
  const byUid = {}, docs = {}, jobsOf = {};
  notices.forEach(function (x) {
    if (!x || !/^[A-Za-z0-9_-]{1,128}$/.test(String(x.uid)) || !/^\d{4}-\d{2}$/.test(String(x.month)) || !(x.day >= 1 && x.day <= 31)) return;
    if (x.uid === booker.uid) return;                                  // your own change
    const key = x.uid + '_' + x.month;
    if (!(key in docs)) docs[key] = fsGet_('avail/' + key);
    const now = docStates_(docs[key], daysIn_(x.month))[x.day - 1];
    if (now !== (x.now === 'S' || x.now === 'C' ? x.now : '-') && !(x.now === '-' && now === 'A')) return;   // not what's saved: ignore
    (byUid[x.uid] = byUid[x.uid] || []).push({ month: x.month, day: +x.day, now: now });
  });
  Object.keys(byUid).forEach(function (uid) {
    const u = fsGet_('users/' + uid);
    if (!u || !u.email || /@/.test(u.email) === false || u.email.toLowerCase().endsWith('@' + CFG.USERNAME_DOMAIN)) return;
    if (MailApp.getRemainingDailyQuota() < 1) return console.warn('Email quota used up for today');
    const lines = byUid[uid].map(function (x) {
      const m = x.month;
      if (!jobsOf[m]) jobsOf[m] = queryCol_('jobs', 'month', m);
      const d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, x.day);
      const when = Utilities.formatDate(d, Session.getScriptTimeZone(), 'EEE d MMM yyyy');
      const what = x.now === 'S' ? 'Soft booked' : x.now === 'C' ? 'Confirmed' : 'Booking cancelled';
      const date = m + '-' + ('0' + x.day).slice(-2);
      const mine = (x.now === 'S' || x.now === 'C') ? jobsOf[m].filter(function (j) { return j.date === date && (j.crewUids || []).indexOf(uid) >= 0; }) : [];
      const detail = mine.map(function (j) {
        const role = ((j.crew || []).filter(function (c) { return c.uid === uid; })[0] || {}).role || '';
        return j.title + ', ' + hm_(j.start) + (j.end ? '-' + hm_(j.end) : '') + (j.venue ? ' @ ' + j.venue : '') + (role ? ' (you: ' + role + ')' : '');
      }).join('; ');
      return '<li><b>' + when + '</b> - ' + what + (detail ? ': ' + detail : '') + '</li>';
    });
    MailApp.sendEmail({
      to: u.email,
      subject: 'Your bookings were updated (' + byUid[uid].length + ')',
      htmlBody: '<p>Hi ' + (u.displayName || '') + ',</p><p>Your bookings changed:</p><ul>' + lines.join('') + '</ul>' +
        (CFG.APP_URL ? '<p><a href="' + CFG.APP_URL + '#availability">Open your availability</a></p>' : '') +
        '<p style="color:#888">Sent automatically by Showbase.</p>'
    });
  });
}

// ------------------------------------------------------------------ Firestore REST (as the script owner)
const FS_BASE = () => 'https://firestore.googleapis.com/v1/projects/' + CFG.FIREBASE_PROJECT_ID + '/databases/(default)/documents';
const auth_ = () => ({ Authorization: 'Bearer ' + ScriptApp.getOAuthToken() });

function fsGet_(path) {
  const r = UrlFetchApp.fetch(FS_BASE() + '/' + path, { headers: auth_(), muteHttpExceptions: true });
  if (r.getResponseCode() === 404) return null;
  if (r.getResponseCode() !== 200) throw new Error('Firestore read failed: ' + r.getContentText());
  return fromFields_(JSON.parse(r.getContentText()).fields || {});
}


function listUsers_() {
  const out = {};
  let pageToken = '';
  do {
    const r = UrlFetchApp.fetch(FS_BASE() + '/users?pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''),
      { headers: auth_(), muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('Firestore read failed: ' + r.getContentText());
    const body = JSON.parse(r.getContentText());
    (body.documents || []).forEach(function (d) { out[d.name.split('/').pop()] = fromFields_(d.fields || {}); });
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return out;
}


function queryWhere_(col, filters) {
  const OPS = { '==': 'EQUAL', '>': 'GREATER_THAN' };
  const ff = filters.map(function (f) { return { fieldFilter: { field: { fieldPath: f[0] }, op: OPS[f[1]], value: { stringValue: f[2] } } }; });
  const r = UrlFetchApp.fetch(FS_BASE() + ':runQuery', {
    method: 'post', contentType: 'application/json', headers: auth_(), muteHttpExceptions: true,
    payload: JSON.stringify({ structuredQuery: { from: [{ collectionId: col }],
      where: ff.length === 1 ? ff[0] : { compositeFilter: { op: 'AND', filters: ff } } } })
  });
  if (r.getResponseCode() !== 200) throw new Error('Firestore query failed: ' + r.getContentText());
  const out = {};
  JSON.parse(r.getContentText()).forEach(function (x) { if (x.document) out[x.document.name.split('/').pop()] = fromFields_(x.document.fields || {}); });
  return out;
}

function queryCol_(col, field, value) {
  const r = UrlFetchApp.fetch(FS_BASE() + ':runQuery', {
    method: 'post', contentType: 'application/json', headers: auth_(), muteHttpExceptions: true,
    payload: JSON.stringify({ structuredQuery: { from: [{ collectionId: col }],
      where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } } } })
  });
  if (r.getResponseCode() !== 200) throw new Error('Firestore query failed: ' + r.getContentText());
  return JSON.parse(r.getContentText()).filter(function (x) { return x.document; }).map(function (x) { return fromFields_(x.document.fields || {}); });
}

function queryAvail_(m) {
  const r = UrlFetchApp.fetch(FS_BASE() + ':runQuery', {
    method: 'post', contentType: 'application/json', headers: auth_(), muteHttpExceptions: true,
    payload: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'avail' }],
      where: { fieldFilter: { field: { fieldPath: 'month' }, op: 'EQUAL', value: { stringValue: m } } } } })
  });
  if (r.getResponseCode() !== 200) throw new Error('Firestore query failed: ' + r.getContentText());
  const out = {};
  JSON.parse(r.getContentText()).forEach(function (x) {
    if (!x.document) return;
    const d = fromFields_(x.document.fields || {});
    if (d.uid) out[d.uid] = d;
  });
  return out;
}


function toValue_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue_) } };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'object') { const f = {}; Object.keys(v).forEach(function (k) { f[k] = toValue_(v[k]); }); return { mapValue: { fields: f } }; }
  return { stringValue: String(v) };
}
function fromValue_(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue_);
  if ('mapValue' in v) return fromFields_(v.mapValue.fields || {});
  return null;
}
function fromFields_(f) { const o = {}; Object.keys(f).forEach(function (k) { o[k] = fromValue_(f[k]); }); return o; }
