import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { config, publicConfig } from './config.js';
import { rateLimit } from './lib/ratelimit.js';
import { appendEvent, markNotified, readEvents } from './lib/store.js';
import { sendOwnerAlert } from './lib/whatsapp.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');

const app = express();

// Correct client IPs when running behind nginx / Cloudflare / a PaaS router.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '16kb' }));
// maxAge 0, not a long cache: express.static still sends ETag/Last-Modified, so
// repeat visits get a cheap 304 rather than a re-download. A long max-age would
// serve stale CSS for an hour after any branding tweak — not worth it on a page
// each customer loads once.
app.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: 0 }));

// ── Helpers ──────────────────────────────────────────────────────────────────

const NEWLINE = 10;
const DEL = 127;
const C1_END = 159;

/**
 * Normalise line endings, replace C0/C1 control characters with spaces (real
 * newlines survive — the message field is free text), then trim and clamp.
 */
function clean(value, maxLength) {
  if (typeof value !== 'string') return '';

  let out = '';
  for (const ch of value.replace(/\r\n?/g, '\n')) {
    const code = ch.codePointAt(0);
    const isControl = (code < 32 && code !== NEWLINE) || (code >= DEL && code <= C1_END);
    out += isControl ? ' ' : ch;
  }

  return out.trim().slice(0, maxLength);
}

function isValidRating(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

function requestMeta(req) {
  return {
    ip: req.ip ?? null,
    ua: clean(req.get('user-agent') ?? '', 300),
  };
}

// ── Public config ────────────────────────────────────────────────────────────

app.get('/api/config', (_req, res) => {
  res.json(publicConfig);
});

// ── Star tap logging ─────────────────────────────────────────────────────────
// Sent with navigator.sendBeacon, including on the taps that immediately navigate
// away to Google. Without this the dashboard would only ever see unhappy customers.

app.post('/api/rating', async (req, res) => {
  const rating = Number(req.body?.rating);

  // Always 204 — this is fire-and-forget telemetry and the client has usually
  // already navigated away by now. Never make the customer wait on it.
  res.status(204).end();

  if (!isValidRating(rating)) return;

  try {
    await appendEvent({
      type: 'rating',
      rating,
      redirected: rating >= config.threshold,
      ...requestMeta(req),
    });
  } catch (err) {
    console.error('  ✗ Could not record rating:', err.message);
  }
});

// ── Private feedback ─────────────────────────────────────────────────────────

app.post('/api/feedback', rateLimit, async (req, res) => {
  const rating = Number(req.body?.rating);
  const message = clean(req.body?.message, 2000);
  const contact = clean(req.body?.contact, 200);

  if (!isValidRating(rating)) {
    return res.status(400).json({ ok: false, error: 'Please choose a rating from 1 to 5.' });
  }

  // A private submission at or above the threshold means the client was tampered
  // with — the UI never offers this path.
  if (rating >= config.threshold) {
    return res.status(400).json({ ok: false, error: 'That rating goes to Google, not to private feedback.' });
  }

  if (!message) {
    return res.status(400).json({ ok: false, error: 'Please tell us what went wrong.' });
  }

  let record;
  try {
    record = await appendEvent({
      type: 'feedback',
      rating,
      message,
      contact: contact || null,
      notified: null,
      ...requestMeta(req),
    });
  } catch (err) {
    console.error('  ✗ Could not save feedback:', err.message);
    return res.status(500).json({ ok: false, error: 'Something went wrong saving that. Please try again.' });
  }

  // Answer the customer now. The feedback is already durable; notifying the owner
  // is best-effort and must never make the customer wait or see an error.
  res.json({ ok: true });

  const result = await sendOwnerAlert({ rating, message, contact });
  try {
    await markNotified(record.id, {
      status: result.status,
      detail: result.detail ?? null,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('  ✗ Could not record notification status:', err.message);
  }
});

// ── Admin ────────────────────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  const a = Buffer.from(token);
  const b = Buffer.from(config.adminToken);

  // Length check first: timingSafeEqual throws on mismatched lengths.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ ok: false, error: 'Invalid admin token.' });
  }
  return next();
}

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.get('/api/admin/events', requireAdmin, async (_req, res) => {
  try {
    const events = await readEvents({ limit: 1000 });

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0;
    let sum = 0;
    let redirected = 0;

    for (const evt of events) {
      // A low rating produces both a 'rating' event and a 'feedback' event; count
      // the rating events only, so the stats show one row per customer.
      if (evt.type !== 'rating' || !isValidRating(evt.rating)) continue;
      distribution[evt.rating] += 1;
      total += 1;
      sum += evt.rating;
      if (evt.redirected) redirected += 1;
    }

    res.json({
      ok: true,
      stats: {
        total,
        average: total ? Number((sum / total).toFixed(2)) : 0,
        distribution,
        redirected,
        private: total - redirected,
      },
      feedback: events.filter((e) => e.type === 'feedback'),
      config: {
        threshold: config.threshold,
        reviewMode: config.reviewMode,
        whatsappProvider: config.whatsapp.provider,
      },
    });
  } catch (err) {
    console.error('  ✗ Could not read events:', err.message);
    res.status(500).json({ ok: false, error: 'Could not read the feedback log.' });
  }
});

// ── Errors ───────────────────────────────────────────────────────────────────

// Malformed JSON bodies arrive here as a SyntaxError from express.json.
app.use((err, _req, res, next) => {
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ ok: false, error: 'Malformed request.' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'That message is too long.' });
  }
  return next(err);
});

// ── Boot ─────────────────────────────────────────────────────────────────────

app.listen(config.port, () => {
  const gating =
    config.reviewMode === 'gated'
      ? `gated — only ${config.threshold}★ and above see the Google link`
      : 'compliant — everyone is offered the Google link, low ratings are asked privately first';

  const whatsappLine =
    config.whatsapp.provider === 'none'
      ? 'disabled (alerts print to this console)'
      : `Meta Cloud API → +${config.whatsapp.to}`;

  console.log(`
  ${config.shop.name} — review system running

  Rating page   http://localhost:${config.port}
  Dashboard     http://localhost:${config.port}/admin
  Public URL    ${config.publicUrl}

  Threshold     ${config.threshold}★ and above go to Google
  Mode          ${gating}
  WhatsApp      ${whatsappLine}

  Run "npm run qr" to generate the counter QR code.
`);
});
