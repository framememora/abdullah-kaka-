/* Customer-facing rating flow.
 *
 * The one critical detail in this file: when a customer taps a high rating we
 * assign location.href *synchronously inside the tap handler*. No await, no
 * setTimeout, no animation first — mobile Safari only treats navigation as
 * user-initiated within the gesture, and anything else risks being swallowed. */

const app = document.getElementById('app');
const starsEl = document.getElementById('stars');
const form = document.getElementById('feedback-form');
const messageEl = document.getElementById('message');
const contactEl = document.getElementById('contact');
const submitBtn = document.getElementById('submit-btn');
const backBtn = document.getElementById('back-btn');
const errorEl = document.getElementById('form-error');
const chosenEl = document.getElementById('chosen-rating');
const googleLink = document.getElementById('google-link');

const STAR_PATH =
  'M12 2.2l2.95 5.98 6.6.96-4.78 4.66 1.13 6.57L12 17.27l-5.9 3.1 1.13-6.57L2.45 9.14l6.6-.96L12 2.2z';

let cfg = null;
let selected = 0;

// ── Boot ────────────────────────────────────────────────────────────────────

async function boot() {
  try {
    const res = await fetch('/api/config');
    cfg = await res.json();
  } catch {
    // The page is useless without config; say so rather than showing dead stars.
    document.getElementById('shop-name').textContent = 'Unable to load';
    document.getElementById('tagline').textContent =
      'Please check your connection and refresh the page.';
    return;
  }

  applyBranding();
  renderStars();
}

function applyBranding() {
  document.documentElement.style.setProperty('--brand', cfg.brandColor);

  const themeColor = document.createElement('meta');
  themeColor.name = 'theme-color';
  themeColor.content = cfg.brandColor;
  document.head.appendChild(themeColor);

  document.getElementById('shop-name').textContent = cfg.shopName;
  document.getElementById('tagline').textContent = cfg.tagline;
  document.title = `Rate ${cfg.shopName}`;

  // Only create the logo element if there is actually a logo to show.
  if (cfg.logoUrl) {
    const img = document.createElement('img');
    img.className = 'logo';
    img.src = cfg.logoUrl;
    img.alt = cfg.shopName;
    // If the URL is wrong, drop the element rather than leaving a broken icon.
    img.addEventListener('error', () => img.remove());
    document.querySelector('[data-screen="rate"]').prepend(img);
  }
}

// ── Stars ───────────────────────────────────────────────────────────────────

function renderStars() {
  for (let value = 1; value <= 5; value += 1) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'star-btn';
    btn.dataset.value = String(value);
    btn.setAttribute('aria-label', value === 1 ? '1 star' : `${value} stars`);
    btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_PATH}" fill="currentColor"/></svg>`;

    btn.addEventListener('click', () => choose(value));
    btn.addEventListener('pointerenter', () => paint(value));
    btn.addEventListener('focus', () => paint(value));

    starsEl.appendChild(btn);
  }

  starsEl.addEventListener('pointerleave', () => paint(selected));
}

/** Light up every star up to `count`. */
function paint(count) {
  for (const btn of starsEl.children) {
    btn.classList.toggle('is-lit', Number(btn.dataset.value) <= count);
  }
}

function choose(rating) {
  selected = rating;
  paint(rating);

  if (rating >= cfg.threshold) {
    // Log the tap without blocking: sendBeacon survives the page teardown that
    // the navigation on the next line is about to cause.
    logRating(rating);
    window.location.href = cfg.googleReviewUrl;
    return;
  }

  chosenEl.textContent = '★'.repeat(rating) + '☆'.repeat(5 - rating);
  logRating(rating);
  show('feedback');
  messageEl.focus();
}

function logRating(rating) {
  const body = JSON.stringify({ rating });
  try {
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon('/api/rating', blob)) return;
  } catch {
    // fall through to fetch
  }
  fetch('/api/rating', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

// ── Screens ─────────────────────────────────────────────────────────────────

function show(screen) {
  app.className = `screen-${screen}`;
  window.scrollTo(0, 0);
}

backBtn.addEventListener('click', () => {
  selected = 0;
  paint(0);
  hideError();
  show('rate');
});

// ── Feedback submission ─────────────────────────────────────────────────────

function showError(text) {
  errorEl.textContent = text;
  errorEl.hidden = false;
}

function hideError() {
  errorEl.hidden = true;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideError();

  const message = messageEl.value.trim();
  if (!message) {
    showError('Please tell us what went wrong.');
    messageEl.focus();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending…';

  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: selected, message, contact: contactEl.value.trim() }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      showError(data.error || 'Something went wrong. Please try again.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send privately';
      return;
    }

    if (cfg.reviewMode === 'compliant') {
      googleLink.href = cfg.googleReviewUrl;
      googleLink.hidden = false;
    }
    show('thanks');
  } catch {
    showError('No connection. Please check your signal and try again.');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send privately';
  }
});

boot();
