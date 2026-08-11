// Loads and validates configuration from .env / the process environment.
// Anything invalid is fatal at boot: a QR code already glued to a counter is much
// harder to fix than a server that refuses to start.

try {
  process.loadEnvFile(); // Node >= 20.6, no dotenv needed
} catch {
  // No .env file. Fine — the host may supply real environment variables.
}

const problems = [];

function str(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v.trim();
}

// ── Shop identity ────────────────────────────────────────────────────────────
const shop = {
  name: str('SHOP_NAME', 'Our Shop'),
  tagline: str('SHOP_TAGLINE', 'How was your visit today?'),
  logoUrl: str('SHOP_LOGO_URL'),
  brandColor: str('BRAND_COLOR', '#1a73e8'),
};

if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(shop.brandColor)) {
  problems.push(`BRAND_COLOR must be a hex colour like #1a73e8 (got "${shop.brandColor}")`);
}

// ── Google review destination ────────────────────────────────────────────────
const placeId = str('GOOGLE_PLACE_ID');
const reviewUrlOverride = str('GOOGLE_REVIEW_URL');

let googleReviewUrl = '';
if (reviewUrlOverride) {
  googleReviewUrl = reviewUrlOverride;
  if (!/^https:\/\//i.test(googleReviewUrl)) {
    problems.push('GOOGLE_REVIEW_URL must start with https://');
  }
} else if (placeId) {
  googleReviewUrl = `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
} else {
  problems.push(
    'Set GOOGLE_PLACE_ID (or GOOGLE_REVIEW_URL) in .env — without it there is nowhere to send happy customers.\n' +
      '  Find your Place ID: https://developers.google.com/maps/documentation/places/web-service/place-id',
  );
}

// ── Funnel behaviour ─────────────────────────────────────────────────────────
const threshold = Number.parseInt(str('REDIRECT_THRESHOLD', '4'), 10);
if (!Number.isInteger(threshold) || threshold < 1 || threshold > 5) {
  problems.push(`REDIRECT_THRESHOLD must be a whole number from 1 to 5 (got "${str('REDIRECT_THRESHOLD')}")`);
}

const reviewMode = str('REVIEW_MODE', 'gated').toLowerCase();
if (!['gated', 'compliant'].includes(reviewMode)) {
  problems.push(`REVIEW_MODE must be "gated" or "compliant" (got "${reviewMode}")`);
}

// ── WhatsApp ─────────────────────────────────────────────────────────────────
const whatsapp = {
  provider: str('WHATSAPP_PROVIDER', 'none').toLowerCase(),
  to: str('WHATSAPP_TO').replace(/\D/g, ''), // Meta wants digits only, no "+"
  phoneNumberId: str('META_PHONE_NUMBER_ID'),
  accessToken: str('META_ACCESS_TOKEN'),
  templateName: str('META_TEMPLATE_NAME'),
  templateLang: str('META_TEMPLATE_LANG', 'en'),
};

if (!['none', 'meta'].includes(whatsapp.provider)) {
  problems.push(`WHATSAPP_PROVIDER must be "none" or "meta" (got "${whatsapp.provider}")`);
}

if (whatsapp.provider === 'meta') {
  const missing = [
    ['WHATSAPP_TO', whatsapp.to],
    ['META_PHONE_NUMBER_ID', whatsapp.phoneNumberId],
    ['META_ACCESS_TOKEN', whatsapp.accessToken],
    ['META_TEMPLATE_NAME', whatsapp.templateName],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length) {
    problems.push(
      `WHATSAPP_PROVIDER=meta needs: ${missing.join(', ')}.\n` +
        '  Not ready yet? Set WHATSAPP_PROVIDER=none — alerts print to this console instead\n' +
        '  and every other part of the system keeps working.',
    );
  }
}

// ── Server ───────────────────────────────────────────────────────────────────
const port = Number.parseInt(str('PORT', '3000'), 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  problems.push(`PORT must be a valid port number (got "${str('PORT')}")`);
}

const adminToken = str('ADMIN_TOKEN');
if (!adminToken) {
  problems.push('ADMIN_TOKEN is required — it is the password for the /admin dashboard.');
} else if (adminToken === 'change-me-please') {
  problems.push('ADMIN_TOKEN is still the example value. Set a real secret in .env.');
} else if (adminToken.length < 8) {
  problems.push('ADMIN_TOKEN must be at least 8 characters.');
}

const publicUrl = str('PUBLIC_URL', `http://localhost:${port}`).replace(/\/+$/, '');

// ── Bail out loudly ──────────────────────────────────────────────────────────
if (problems.length) {
  console.error('\n  Configuration problems found in .env:\n');
  for (const p of problems) console.error(`  ✗ ${p}\n`);
  console.error('  Copy .env.example to .env and fill it in, then try again.\n');
  process.exit(1);
}

export const config = Object.freeze({
  shop: Object.freeze(shop),
  googleReviewUrl,
  threshold,
  reviewMode,
  whatsapp: Object.freeze(whatsapp),
  port,
  adminToken,
  publicUrl,
});

// The subset that is safe to hand to the browser. Everything the client needs,
// nothing it shouldn't see — no tokens, no admin password, no phone numbers.
export const publicConfig = Object.freeze({
  shopName: shop.name,
  tagline: shop.tagline,
  logoUrl: shop.logoUrl,
  brandColor: shop.brandColor,
  threshold,
  reviewMode,
  googleReviewUrl,
});
