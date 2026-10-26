/**
 * Showbase -> Google Sheets ONE-WAY backup
 * ------------------------------------------------------------------
 * Bind this script to the backup spreadsheet (Extensions > Apps Script), then
 * Deploy > New deployment > Web app:  Execute as "Me",  Who has access "Anyone".
 * Paste the /exec URL into public/js/config.js -> sheetsWebAppUrl.
 *
 * "Anyone" only means the URL is reachable. Every request must carry a valid Firebase
 * ID token for an *active* app user, or it is rejected before anything is written.
 *
 * Tabs (created automatically):
 *   Inventory    one row per asset, upserted by ID (deleted assets are kept, with "deletedAt")
 *   Maintenance  one row per maintenance ticket, upserted by ID
 *   Loans        one row per equipment loan, upserted by ID
 *   Shows        one row per show sign-out list, upserted by ID
 *   Discrepancies  one row per inventory-check report, upserted by ID
 *   Audits       one row per inventory-check round (venue, progress, result), upserted by ID
 *   Log          append-only audit trail
 *
 * It also handles one admin action: { action: 'resetPassword', idToken, uid, password }.
 * The caller must be an active Admin (checked live, not cached). The script then sets the new
 * password through the Identity Toolkit admin API using the deploying account's own Google
 * credentials - so deploy it with the Google account that OWNS the Firebase project.
 */

const CFG = {
  FIREBASE_API_KEY: 'AIzaSyAraFqQWYbeAf1NoRikNpyBYF98rvyxjKo',
  FIREBASE_PROJECT_ID: 'starpac-audio',
  REQUIRE_ACTIVE_PROFILE: true,  // also check users/{uid}.status == 'active' in Firestore
  // Host (primary Admin) signs in with a username instead of an email. Must match public/js/config.js.
  HOST_USERNAME: 'Starpacsound Admin',
  USERNAME_DOMAIN: 'showbase.local'
};

// Calls made with YOUR Google login. X-Goog-User-Project bills them to the Firebase project; without it
// Google uses the script's hidden default project, where the Identity Toolkit / Firestore APIs are off.
function ownerAuth_() {
  return { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Goog-User-Project': CFG.FIREBASE_PROJECT_ID };
}

// Same rule as the app: "Starpacsound Admin" -> "starpacsound.admin@showbase.local"
function usernameToEmail_(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '') + '@' + CFG.USERNAME_DOMAIN;
}

const TABS = {
  asset: {
    name: 'Inventory',
    cols: ['id', 'kind', 'category', 'brand', 'model', 'description', 'internalAssetNo', 'qty', 'assetNo', 'serialNo', 'code',
           'itemSpace', 'itemLocation', 'condition', 'yearOfPurchase', 'remarks', 'updatedAt', 'updatedBy', 'deletedAt']
  },
  ticket: {
    name: 'Maintenance',
    cols: ['id', 'stage', 'assetId', 'assetLabel', 'category', 'brand', 'model', 'serialNo', 'assetNo', 'logType',
           'requestedCondition', 'faultDescription', 'newSpace', 'newLocation', 'maintDate', 'requestedBy', 'requestedAt',
           'verifiedBy', 'verifiedAt', 'verifyNotes', 'confirmedCondition', 'vendor', 'dateSent', 'expectedReturn', 'sendNotes',
           'sentBy', 'sentAt', 'dateReturned', 'cost', 'resolution', 'finalCondition', 'resolvedBy', 'resolvedAt',
           'rejectReason', 'rejectedBy', 'rejectedAt']
  },
  loan: {
    name: 'Loans',
    cols: ['id', 'status', 'source', 'borrowerName', 'requestedByName', 'requestedBy', 'requestedAt', 'items', 'collectDate', 'returnDate', 'reason',
           'assigned', 'approvedBy', 'approvedAt', 'approveNote', 'collectedAt', 'returnRequestedAt', 'returnNote',
           'returnedAt', 'receivedBy', 'receiveNote', 'rejectReason', 'rejectedBy', 'rejectedAt', 'cancelledAt']
  },
  show: {
    name: 'Shows',
    cols: ['id', 'title', 'showDate', 'venue', 'status', 'createdByName', 'createdBy', 'signedOutAt', 'items',
           'signedInAt', 'signedInBy', 'missingCount']
  },
  discrepancy: {
    name: 'Discrepancies',
    cols: ['id', 'status', 'assetLabel', 'category', 'brand', 'model', 'missing', 'current', 'proposed', 'note',
           'byName', 'by', 'at', 'reviewedBy', 'reviewedAt', 'reviewNote', 'assetId']
  },
  audit: {
    name: 'Audits',
    cols: ['id', 'name', 'venue', 'status', 'startedByName', 'startedAt', 'closedByName', 'closedAt', 'total', 'checked', 'notFound', 'discrepancies', 'notFoundItems']
  },
  // Deleted assets are moved here, so the Inventory tab only lists what still exists.
  assetDeleted: {
    name: 'Deleted Inventory',
    cols: ['id', 'kind', 'category', 'brand', 'model', 'description', 'internalAssetNo', 'qty', 'assetNo', 'serialNo', 'code',
           'itemSpace', 'itemLocation', 'condition', 'yearOfPurchase', 'remarks', 'updatedAt', 'updatedBy', 'deletedAt']
  },
  log: {
    name: 'Log',
    append: true,
    cols: ['at', 'by', 'action', 'assetLabel', 'category', 'changes', 'note', 'assetId', 'ticketId', 'id', 'receivedAt']
  }
};

// ------------------------------------------------------------------ web app
function doGet() {
  return json_({ ok: true, service: 'showbase-sheets-backup' });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'resetPassword') return json_(resetPassword_(body));
    const user = verifyUser_(body.idToken);
    const sent = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
    // Never trust what the browser sent: re-read every document from Firestore as the project owner,
    // so an approved user can't write made-up rows into the backup.
    const items = trustedItems_(sent, user);
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      applyItems_(SpreadsheetApp.getActiveSpreadsheet(), items);
    } finally {
      lock.releaseLock();
    }
    return json_({ ok: true, count: items.length, by: user.email });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

// ------------------------------------------------------------------ auth
function verifyUser_(idToken) {
  if (!idToken) throw new Error('Missing sign-in token');
  const cache = CacheService.getScriptCache();
  const key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)).slice(0, 40);
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const res = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + CFG.FIREBASE_API_KEY,
    { method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Invalid or expired sign-in token');
  const u = (JSON.parse(res.getContentText()).users || [])[0];
  if (!u) throw new Error('Unknown user');
  if (!u.emailVerified) throw new Error('Email not verified');
  const user = { uid: u.localId, email: u.email, role: '' };

  if (CFG.REQUIRE_ACTIVE_PROFILE) {
    // Read the caller's own profile *as the caller* - Firestore rules allow that.
    const r = UrlFetchApp.fetch(
      'https://firestore.googleapis.com/v1/projects/' + CFG.FIREBASE_PROJECT_ID +
      '/databases/(default)/documents/users/' + user.uid,
      { headers: { Authorization: 'Bearer ' + idToken }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('No app profile for this account');
    const fields = JSON.parse(r.getContentText()).fields || {};
    if (!fields.status || fields.status.stringValue !== 'active') throw new Error('Account is not approved');
    user.role = (fields.role && fields.role.stringValue) || '';
  }

  cache.put(key, JSON.stringify(user), 300); // 5 min
  return user;
}

// ------------------------------------------------------------------ trusted backup items
const BACKUP_COL = { asset: 'inventory', ticket: 'maintenance', loan: 'loans', show: 'shows', discrepancy: 'discrepancies', audit: 'audits', log: 'logs' };
function trustedItems_(sent, user) {
  const out = [];
  // Full Inventory rewrite: Admins only, and built here from Firestore - the browser's rows are ignored.
  if (sent.some(function (it) { return it && it.op === 'snapshot'; })) {
    if (user.role !== 'Admin') throw new Error('Only Admins can run a full backup');
    out.push({ kind: 'asset', op: 'snapshot', rows: listInventory_() });
  }
  const wanted = sent.filter(function (it) {
    return it && it.op !== 'snapshot' && BACKUP_COL[it.kind] && /^[A-Za-z0-9_.\-]{1,200}$/.test(String(it.id || ''));
  });
  if (!wanted.length) return out;
  const path = it => 'projects/' + CFG.FIREBASE_PROJECT_ID + '/databases/(default)/documents/' + BACKUP_COL[it.kind] + '/' + it.id;
  const names = wanted.map(path).filter(function (n, i, a) { return a.indexOf(n) === i; });
  const res = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/' + CFG.FIREBASE_PROJECT_ID + '/databases/(default)/documents:batchGet', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: ownerAuth_(), payload: JSON.stringify({ documents: names })
  });
  if (res.getResponseCode() !== 200) throw new Error('Firestore read failed: ' + res.getContentText());
  const found = {};
  JSON.parse(res.getContentText()).forEach(function (x) {
    if (!x.found) return;
    const o = {};
    Object.keys(x.found.fields || {}).forEach(function (k) { o[k] = fromValue_(x.found.fields[k]); });
    found[x.found.name] = o;
  });
  wanted.forEach(function (it) {
    const d = found[path(it)];
    if (d) out.push({ kind: it.kind, op: it.kind === 'log' ? 'append' : 'upsert', data: Object.assign({}, d, { id: it.id }) });
    else if (it.op === 'delete' && it.kind !== 'log') out.push({ kind: it.kind, op: 'delete', data: { id: it.id } });   // gone: keep the old row, stamp deletedAt
  });
  return out;
}

// ------------------------------------------------------------------ admin: temporary password
function fsGet_(path, idToken) {
  const r = UrlFetchApp.fetch(
    'https://firestore.googleapis.com/v1/projects/' + CFG.FIREBASE_PROJECT_ID + '/databases/(default)/documents/' + path,
    { headers: { Authorization: 'Bearer ' + idToken }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return null;
  return JSON.parse(r.getContentText()).fields || {};
}
const fsStr_ = (f, k) => (f && f[k] && f[k].stringValue) || '';
const fsBool_ = (f, k) => !!(f && f[k] && f[k].booleanValue);

function resetPassword_(body) {
  const uid = String(body.uid || '');
  const pw = String(body.password || '');
  if (!body.idToken) throw new Error('Missing sign-in token');
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) throw new Error('Bad user id');
  if (pw.length < 8 || pw.length > 64) throw new Error('Temporary password must be 8-64 characters');

  // Who is asking? Always checked live (no cache) for admin actions.
  const look = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + CFG.FIREBASE_API_KEY,
    { method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: body.idToken }), muteHttpExceptions: true });
  if (look.getResponseCode() !== 200) throw new Error('Invalid or expired sign-in token');
  const caller = (JSON.parse(look.getContentText()).users || [])[0];
  if (!caller) throw new Error('Unknown user');
  if (!caller.emailVerified) throw new Error('Email not verified');
  const me = fsGet_('users/' + caller.localId, body.idToken);
  if (!me || fsStr_(me, 'status') !== 'active' || fsStr_(me, 'role') !== 'Admin') throw new Error('Only Admins can reset passwords');
  if (caller.localId === uid) throw new Error('Use "Change password" for your own account');

  // Read the target as the admin (rules allow it). The primary admin can't be reset by others.
  const target = fsGet_('users/' + uid, body.idToken);
  if (!target) throw new Error('That person has no app profile');
  if (fsBool_(target, 'isPrimary')) throw new Error("The primary admin's password can't be reset by others");
  // The app flags the account first, so the person is forced to pick their own password at next sign-in.
  if (!fsBool_(target, 'mustChangePassword')) throw new Error('Account is not flagged for a password change');

  const res = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/v1/projects/' + CFG.FIREBASE_PROJECT_ID + '/accounts:update',
    { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: ownerAuth_(),
      payload: JSON.stringify({ localId: uid, password: pw }) });
  if (res.getResponseCode() !== 200) {
    console.error(res.getContentText());
    throw new Error('Firebase refused the change (' + res.getResponseCode() + '). Is this script deployed by the Firebase project owner?');
  }
  console.log('Password reset for ' + uid + ' by ' + caller.email);
  return { ok: true };
}

// ------------------------------------------------------------------ sheet writing
function applyItems_(ss, items) {
  const tables = {};
  const table = kind => tables[kind] || (tables[kind] = loadTable_(ss, TABS[kind]));
  const received = new Date().toISOString();

  // Move one Inventory row (already in Sheet format) to the Deleted Inventory tab.
  const moveToDeleted = function (row, when) {
    const del = table('assetDeleted');
    const out = row.slice();
    const at = TABS.asset.cols.indexOf('deletedAt');
    if (!out[at]) out[at] = sgt_(when);
    const id = String(out[0]);
    if (del.index[id] !== undefined) del.rows[del.index[id]] = out; else { del.index[id] = del.rows.length; del.rows.push(out); }
    del.dirty = true;
  };

  items.forEach(function (it) {
    const def = TABS[it.kind];
    if (!def) return;
    const t = table(it.kind);
    if (it.op === 'append') {
      t.appends.push(toRow_(def, Object.assign({}, it.data, { receivedAt: received })));
    } else if (it.op === 'upsert') {
      upsert_(t, def, it.data);
    } else if (it.op === 'delete' && it.kind === 'asset') {
      // Take the asset out of Inventory and keep its last known row in Deleted Inventory.
      const id = String(it.data.id || '');
      const row = t.index[id] !== undefined ? t.rows[t.index[id]] : toRow_(def, it.data);
      moveToDeleted(row, received);
      if (t.index[id] !== undefined) { t.rows.splice(t.index[id], 1); reindex_(t); t.dirty = true; }
    } else if (it.op === 'delete') {
      upsert_(t, def, Object.assign({}, it.data, { deletedAt: received }));
    } else if (it.op === 'snapshot') {
      const live = {};
      (it.rows || []).forEach(function (r) { live[String(r.id)] = true; });
      // Rows no longer in the database (or marked deleted by an older version) go to Deleted Inventory.
      const at = def.cols.indexOf('deletedAt');
      t.rows.forEach(function (r) { if (r[0] !== '' && (!live[String(r[0])] || r[at])) moveToDeleted(r, received); });
      t.rows = (it.rows || []).map(function (r) { return toRow_(def, r); });
      reindex_(t);
      t.dirty = true;
    }
  });

  Object.keys(tables).forEach(function (k) { saveTable_(tables[k]); });
}

function reindex_(t) {
  t.index = {};
  t.rows.forEach(function (r, i) { if (r[0] !== '') t.index[String(r[0])] = i; });
}

// Times in the Sheet are Singapore time, e.g. "2026-10-21 17:42:10". Plain dates (show / return dates) are left as they are.
const ISO_TIME_ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
function sgt_(v) {
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? String(v) : Utilities.formatDate(d, 'Asia/Singapore', 'yyyy-MM-dd HH:mm:ss');
}
// Header label: time columns say they're in SGT.
const isTimeCol_ = c => c === 'at' || /At$/.test(c);
const headerOf_ = c => isTimeCol_(c) ? c + ' (SGT)' : c;

function loadTable_(ss, def) {
  let sheet = ss.getSheetByName(def.name);
  if (!sheet) {
    sheet = ss.insertSheet(def.name);
    sheet.getRange(1, 1, 1000, def.cols.length).setNumberFormat('@'); // keep serials like "00123" as text
  }
  const header = sheet.getRange(1, 1, 1, def.cols.length);
  header.setValues([def.cols.map(headerOf_)]).setFontWeight('bold');
  sheet.setFrozenRows(1);

  const t = { sheet: sheet, def: def, rows: [], index: {}, appends: [], dirty: false, origCount: 0 };
  if (!def.append) {
    const last = sheet.getLastRow();
    if (last > 1) t.rows = sheet.getRange(2, 1, last - 1, def.cols.length).getValues();
    t.origCount = t.rows.length;
    reindex_(t);
  }
  return t;
}

function upsert_(t, def, data) {
  const id = String(data.id || '');
  if (!id) return;
  const row = toRow_(def, data);
  if (t.index[id] !== undefined) {
    // keep existing values for columns the new payload doesn't carry
    const old = t.rows[t.index[id]];
    t.rows[t.index[id]] = row.map(function (v, i) { return v === '' && !(def.cols[i] in data) ? old[i] : v; });
  } else {
    t.index[id] = t.rows.length;
    t.rows.push(row);
  }
  t.dirty = true;
}

function saveTable_(t) {
  const n = t.def.cols.length;
  if (t.dirty) {
    if (t.origCount > t.rows.length) t.sheet.getRange(2, 1, t.origCount, n).clearContent();
    if (t.rows.length) t.sheet.getRange(2, 1, t.rows.length, n).setNumberFormat('@').setValues(t.rows);
  }
  if (t.appends.length) {
    const start = t.sheet.getLastRow() + 1;
    t.sheet.getRange(start, 1, t.appends.length, n).setNumberFormat('@').setValues(t.appends);
  }
}

function toRow_(def, data) {
  return def.cols.map(function (c) {
    if (c === 'changes') return cell_(formatChanges_(data.changes));
    if (c === 'items' || c === 'assigned') return cell_(formatList_(data[c]));
    if (c === 'current' || c === 'proposed') return cell_(formatMap_(data[c]));
    if (c === 'returnDate' && data.returnTbc && !data.returnDate) return 'TBC';   // loan with no return date yet (v5.3)
    if (data.summary && ['total', 'checked', 'discrepancies'].indexOf(c) >= 0) return cell_(data.summary[c]);
    if (data.summary && c === 'notFound') return cell_((data.summary.total || 0) - (data.summary.checked || 0));
    if (data.summary && c === 'notFoundItems') return cell_((data.summary.items || []).filter(function (i) { return !i.checked; })
      .map(function (i) { return i.label + (i.location ? ' @ ' + i.location : ''); }).join('; '));
    if (typeof data[c] === 'string' && ISO_TIME_.test(data[c])) return sgt_(data[c]);
    return cell_(data[c]);
  });
}

// [{qty, name}] -> "2 x SM58; 1 x XLR"   [{label, serialNo}] -> "SM58 #1 (S/N 123); ..."
function formatList_(list) {
  if (!Array.isArray(list)) return list || '';
  return list.map(function (o) {
    if (o && o.qty !== undefined) return o.qty + ' x ' + o.name + (o.accounted === false ? ' (missing)' : '');
    if (o && o.label) return o.label + (o.serialNo ? ' (S/N ' + o.serialNo + ')' : '');
    return JSON.stringify(o);
  }).join('; ');
}

function formatMap_(m) {
  if (!m || typeof m !== 'object') return m || '';
  return Object.keys(m).map(function (k) { return k + ': ' + m[k]; }).join('; ');
}

function formatChanges_(changes) {
  if (!Array.isArray(changes)) return changes || '';
  return changes.map(function (c) { return c.field + ': ' + (c.from || '(blank)') + ' -> ' + (c.to || '(blank)'); }).join('; ');
}

// Stringify, and neutralise anything a spreadsheet would treat as a formula.
function cell_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  return /^[=+\-@]/.test(v) && v !== '-' ? "'" + v : v;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------------ host account: set up / recover
// Sheet menu "Showbase admin" -> "Set up / recover host account…". Creates the host login the first time,
// and afterwards resets its password (e.g. if the host forgot it). Only works for someone who can edit this
// Sheet AND owns / edits the Firebase project - it uses that person's Google credentials, not the app.
// The password is typed into the prompt; it is never stored in this script.
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Showbase admin')
    .addItem('Set up / recover host account…', 'setupOrRecoverHost')
    .addToUi();
}

function setupOrRecoverHost() {
  const ui = SpreadsheetApp.getUi();
  const email = usernameToEmail_(CFG.HOST_USERNAME);
  const r = ui.prompt('Host account: ' + CFG.HOST_USERNAME,
    'New password for "' + CFG.HOST_USERNAME + '" (at least 8 characters).\nSign-in email behind the scenes: ' + email,
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const pw = r.getResponseText();
  if (pw.length < 8) { ui.alert('Use at least 8 characters.'); return; }
  try {
    const msg = hostUpsert_(email, pw);
    ui.alert(msg + '\n\nSign in to the app with:\nUsername: ' + CFG.HOST_USERNAME + '\nPassword: (the one you just typed)');
  } catch (err) {
    ui.alert('Failed: ' + ((err && err.message) || err));
  }
}

function idt_(path, payload) {
  const res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/projects/' + CFG.FIREBASE_PROJECT_ID + path,
    { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: ownerAuth_(), payload: JSON.stringify(payload) });
  const body = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() !== 200) {
    throw new Error((body.error && body.error.message) || ('HTTP ' + res.getResponseCode()) +
      '. Is your Google account an Owner/Editor of the Firebase project, and is Email/Password sign-in enabled?');
  }
  return body;
}

function hostUpsert_(email, pw) {
  const found = (idt_('/accounts:lookup', { email: [email] }).users || [])[0];
  let uid, created = false;
  if (found) {
    uid = found.localId;
    idt_('/accounts:update', { localId: uid, password: pw, disableUser: false, emailVerified: true });
  } else {
    uid = idt_('/accounts', { email: email, password: pw, displayName: CFG.HOST_USERNAME, emailVerified: true }).localId;   // no mailbox: mark verified
    created = true;
  }
  // Make sure the app profile exists and is the active primary Admin (written with your Google
  // credentials, which Firestore treats as an admin, so security rules don't apply here).
  const now = new Date().toISOString();
  const s = v => ({ stringValue: v }), b = v => ({ booleanValue: v });
  const arr = list => ({ arrayValue: { values: list.map(s) } });
  const ROW = ['internalAssetNo', 'qty', 'assetNo', 'serialNo', 'code', 'itemSpace', 'itemLocation', 'condition', 'yearOfPurchase', 'remarks'];
  const fields = {
    email: s(email), role: s('Admin'), status: s('active'), isPrimary: b(true), mustChangePassword: b(false), emailVerified: b(true),
    viewCols: arr(ROW), editCols: arr(['category', 'brand', 'model', 'description'].concat(ROW)),
    viewCats: arr([]), editCats: arr([]), passwordChangedAt: s(now), updatedAt: s(now)   // updatedAt: the app's people list picks up changes by it
  };
  if (created) { fields.displayName = s(CFG.HOST_USERNAME); fields.createdAt = s(now); fields.casualId = s(''); fields.perm = { mapValue: { fields: {} } }; }
  const mask = Object.keys(fields).map(function (k) { return 'updateMask.fieldPaths=' + k; }).join('&');
  const res = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/' + CFG.FIREBASE_PROJECT_ID +
    '/databases/(default)/documents/users/' + uid + '?' + mask,
    { method: 'patch', contentType: 'application/json', muteHttpExceptions: true,
      headers: ownerAuth_(), payload: JSON.stringify({ fields: fields }) });
  if (res.getResponseCode() !== 200) throw new Error('Login is ready, but the app profile could not be saved: ' + res.getContentText());
  console.log((created ? 'Created' : 'Recovered') + ' host account ' + email);
  return created ? 'Host account created and set as primary Admin.' : 'Host password reset. The account is active and still the primary Admin.';
}

// ------------------------------------------------------------------ optional: nightly full snapshot
// Safety net in case a browser was closed before its queued backups were sent.
// Reads Firestore with YOUR Google account (you must be an Owner/Editor of the Firebase project),
// then rewrites the Inventory tab. Run installNightlySnapshot() once from the editor to schedule it.
function nightlySnapshot() {
  const docs = listInventory_();
  applyItems_(SpreadsheetApp.getActiveSpreadsheet(), [{ kind: 'asset', op: 'snapshot', rows: docs }]);
  PropertiesService.getScriptProperties().setProperty('lastSnapshot', new Date().toISOString() + ' (' + docs.length + ' assets)');
}

function installNightlySnapshot() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'nightlySnapshot'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('nightlySnapshot').timeBased().everyDays(1).atHour(3).inTimezone('Asia/Singapore').create();
}

// Whole inventory for a full snapshot. Reads the bundles (about 15 reads for 20,000 assets) once an
// Admin has built them in the app; before that, every asset doc (one read each).
function listInventory_() {
  const bundles = listCollection_('invBundles', 5);   // bundles are big: a few per page
  if (!bundles.length) return listCollection_('inventory');
  const out = [], seen = {};
  bundles.forEach(function (b) {
    Object.keys(b.items || {}).forEach(function (id) {
      if (seen[id]) return;
      seen[id] = true;
      const row = { id: id };
      Object.keys(b.items[id]).forEach(function (k) { row[k] = b.items[id][k]; });
      out.push(row);
    });
  });
  return out;
}

function listCollection_(col, pageSize) {
  const base = 'https://firestore.googleapis.com/v1/projects/' + CFG.FIREBASE_PROJECT_ID +
               '/databases/(default)/documents/' + col + '?pageSize=' + (pageSize || 300);
  const out = [];
  let pageToken = '';
  do {
    const res = UrlFetchApp.fetch(base + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''),
      { headers: ownerAuth_(), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('Firestore read failed: ' + res.getContentText());
    const body = JSON.parse(res.getContentText());
    (body.documents || []).forEach(function (d) {
      const obj = { id: d.name.split('/').pop() };
      Object.keys(d.fields || {}).forEach(function (k) { obj[k] = fromValue_(d.fields[k]); });
      out.push(obj);
    });
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return out;
}

function fromValue_(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return '';
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue_);
  if ('mapValue' in v) {
    const o = {};
    Object.keys(v.mapValue.fields || {}).forEach(function (k) { o[k] = fromValue_(v.mapValue.fields[k]); });
    return o;
  }
  return '';
}
