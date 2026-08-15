/**
 * Variety Fancy — review funnel backend.
 *
 * Replaces server.js for the static (GitHub Pages) deployment. Two jobs:
 *   1. append every star tap and every private complaint to a Google Sheet
 *   2. email the owner the moment a private complaint arrives
 *
 * Paste this into the Apps Script editor attached to the Sheet, then
 * Deploy -> New deployment -> Web app, "Execute as: Me", "Who has access: Anyone".
 * See STATIC_SETUP.md for the click-by-click version.
 *
 * The browser sends Content-Type: text/plain so the request stays a CORS "simple
 * request" — Apps Script cannot answer a preflight OPTIONS, so anything that
 * triggers one never arrives.
 */

// ── Settings ────────────────────────────────────────────────────────────────
// Keep OWNER_EMAIL and REDIRECT_THRESHOLD in step with .env.

var OWNER_EMAIL = 'usmannissam1@gmail.com';
var SHOP_NAME = 'Variety Fancy';
var REDIRECT_THRESHOLD = 4; // ratings at or above this go to Google, never here
var SHEET_NAME = 'events';

var MAX_MESSAGE = 2000;
var MAX_CONTACT = 200;
var MAX_UA = 300;

var HEADERS = ['timestamp', 'type', 'rating', 'message', 'contact', 'userAgent'];

// ── Helpers ─────────────────────────────────────────────────────────────────

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

var NEWLINE = 10;
var DEL = 127;
var C1_END = 159;

/**
 * Replace C0/C1 control characters with spaces, then trim and clamp.
 * Real newlines survive — the message field is free text. Same rule as
 * server.js so both backends store identically shaped data.
 */
function clean(value, maxLength) {
  if (typeof value !== 'string') return '';

  var out = '';
  for (var i = 0; i < value.length; i++) {
    var code = value.charCodeAt(i);
    var isControl = (code < 32 && code !== NEWLINE) || (code >= DEL && code <= C1_END);
    out += isControl ? ' ' : value.charAt(i);
  }

  return out.trim().slice(0, maxLength);
}

function isValidRating(value) {
  return typeof value === 'number' && isFinite(value) && value % 1 === 0 && value >= 1 && value <= 5;
}

/** The sheet, created with a header row the first time it is needed. */
function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ── Web app entry points ────────────────────────────────────────────────────

/** A GET is only ever a human checking the deployment is alive. */
function doGet() {
  return jsonOut({ ok: true, service: 'review-funnel', shop: SHOP_NAME });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ ok: false, error: 'Malformed request.' });
  }

  var type = body.type === 'feedback' ? 'feedback' : 'rating';
  var rating = Number(body.rating);

  if (!isValidRating(rating)) {
    return jsonOut({ ok: false, error: 'Please choose a rating from 1 to 5.' });
  }

  var message = clean(body.message, MAX_MESSAGE);
  var contact = clean(body.contact, MAX_CONTACT);
  var ua = clean(body.ua, MAX_UA);

  if (type === 'feedback') {
    // Mirrors the guard in server.js: the UI never offers the private path to a
    // high rating, so one arriving here means a tampered-with client.
    if (rating >= REDIRECT_THRESHOLD) {
      return jsonOut({ ok: false, error: 'That rating goes to Google, not to private feedback.' });
    }
    if (!message) {
      return jsonOut({ ok: false, error: 'Please tell us what went wrong.' });
    }
  }

  // A lock keeps two simultaneous scans from writing over the same row.
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return jsonOut({ ok: false, error: 'Busy, please try again.' });
  }

  try {
    getSheet().appendRow([new Date(), type, rating, message, contact, ua]);
  } catch (err) {
    return jsonOut({ ok: false, error: 'Could not save that. Please try again.' });
  } finally {
    lock.releaseLock();
  }

  // Best-effort: the complaint is already stored, so a mail failure must not
  // surface to the customer as an error.
  if (type === 'feedback') {
    try {
      notifyOwner(rating, message, contact);
    } catch (err) {
      console.error('Owner email failed: ' + err);
    }
  }

  return jsonOut({ ok: true });
}

function notifyOwner(rating, message, contact) {
  var stars = new Array(rating + 1).join('★') + new Array(5 - rating + 1).join('☆');

  MailApp.sendEmail({
    to: OWNER_EMAIL,
    subject: rating + '★ private feedback — ' + SHOP_NAME,
    body:
      SHOP_NAME + ' — a customer left ' + rating + ' stars privately.\n\n' +
      stars + '\n\n' +
      'What they said:\n' + message + '\n\n' +
      'Contact: ' + (contact || 'none given') + '\n\n' +
      'This did NOT go to your public Google listing.\n' +
      'Received ' + new Date().toString() + '\n',
  });
}
