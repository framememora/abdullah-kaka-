/**
 * Variety Fancy — review funnel backend.
 *
 * Replaces server.js for the static (GitHub Pages) deployment. One job: email
 * the owner the moment a private complaint arrives.
 *
 * Email is the only destination. Nothing is stored anywhere else, so star taps
 * that go to Google are not recorded at all and there is no rating distribution
 * to look at later — the inbox is the whole record.
 *
 * Paste this into a standalone Apps Script project (script.google.com -> New
 * project), then Deploy -> New deployment -> Web app, "Execute as: Me",
 * "Who has access: Anyone". See STATIC_SETUP.md for the click-by-click version.
 *
 * The browser sends Content-Type: text/plain so the request stays a CORS "simple
 * request" — Apps Script cannot answer a preflight OPTIONS, so anything that
 * triggers one never arrives.
 */

// ── Settings ────────────────────────────────────────────────────────────────
// Keep OWNER_EMAIL and REDIRECT_THRESHOLD in step with .env.

var OWNER_EMAIL = 'abdullakhana633@gmail.com';
var SHOP_NAME = 'Variety Fancy';
var REDIRECT_THRESHOLD = 4; // ratings at or above this go to Google, never here

var MAX_MESSAGE = 2000;
var MAX_CONTACT = 200;
var MAX_UA = 300;

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
 * server.js so both backends handle identically shaped data.
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

  // Star taps have nowhere to go now that the sheet is gone. Acknowledge and
  // drop, rather than emailing every tap -- that would exhaust the ~100/day
  // quota and bury the complaints that actually need reading.
  if (type !== 'feedback') {
    return jsonOut({ ok: true });
  }

  // Mirrors the guard in server.js: the UI never offers the private path to a
  // high rating, so one arriving here means a tampered-with client.
  if (rating >= REDIRECT_THRESHOLD) {
    return jsonOut({ ok: false, error: 'That rating goes to Google, not to private feedback.' });
  }

  var message = clean(body.message, MAX_MESSAGE);
  var contact = clean(body.contact, MAX_CONTACT);

  if (!message) {
    return jsonOut({ ok: false, error: 'Please tell us what went wrong.' });
  }

  // The mail IS the record. When it was a best-effort notification alongside a
  // sheet row, swallowing a failure was right; now a swallowed failure loses the
  // complaint outright while the customer is told it was received. So the send
  // must succeed before this reports success.
  try {
    notifyOwner(rating, message, contact);
  } catch (err) {
    console.error('Owner email failed: ' + err);
    return jsonOut({ ok: false, error: 'Could not send that. Please try again.' });
  }

  return jsonOut({ ok: true });
}

function notifyOwner(rating, message, contact) {
  var stars = new Array(rating + 1).join('*') + new Array(5 - rating + 1).join('-');

  MailApp.sendEmail({
    to: OWNER_EMAIL,
    subject: rating + ' star private feedback - ' + SHOP_NAME,
    body:
      SHOP_NAME + ' - a customer left ' + rating + ' stars privately.\n\n' +
      stars + '\n\n' +
      'What they said:\n' + message + '\n\n' +
      'Contact: ' + (contact || 'none given') + '\n\n' +
      'This did NOT go to your public Google listing.\n' +
      'Received ' + new Date().toString() + '\n',
  });
}
