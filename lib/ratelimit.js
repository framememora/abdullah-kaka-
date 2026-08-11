// Minimal in-memory, per-IP rate limiter.
//
// Enough to stop one bored person spamming the owner's WhatsApp from the counter.
// State is per-process and resets on restart, which is the right trade here — no
// Redis to run for a single shop.

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_HITS = 5;

const hits = new Map(); // ip -> { count, resetAt }

// Sweep expired entries so the map cannot grow without bound.
// .unref() so this timer never keeps the process alive on its own.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) {
    if (entry.resetAt <= now) hits.delete(ip);
  }
}, WINDOW_MS).unref();

export function rateLimit(req, res, next) {
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  const entry = hits.get(ip);

  if (!entry || entry.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  entry.count += 1;
  if (entry.count > MAX_HITS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      ok: false,
      error: "Thanks — we've already got your feedback. Please try again in a few minutes.",
    });
  }

  return next();
}
