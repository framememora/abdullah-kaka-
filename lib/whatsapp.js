// Owner alerts over the WhatsApp Cloud API (Meta).
//
// Business-initiated messages outside the 24-hour customer service window MUST use a
// pre-approved template — a plain text message will be rejected. So this always sends
// a template with three body variables: rating, message, contact.
//
// Nothing here is allowed to throw into the request path. The customer's feedback is
// already safely on disk by the time this runs; a failed notification is an operations
// problem, not a customer-facing error.

import { config } from '../config.js';

const GRAPH_VERSION = 'v21.0';
const TIMEOUT_MS = 10_000;
const MAX_PARAM_CHARS = 600;

// Meta rejects template parameters containing newlines, tabs, or 4+ consecutive
// spaces (error 132000). Collapse all whitespace runs to a single space.
function sanitiseParam(value, fallback = '—') {
  const cleaned = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > MAX_PARAM_CHARS ? `${cleaned.slice(0, MAX_PARAM_CHARS - 1)}…` : cleaned;
}

// Meta's error codes are specific and worth surfacing verbatim — guessing at a
// generic "send failed" costs hours.
const KNOWN_ERRORS = {
  190: 'Access token is invalid or expired. Generate a permanent System User token.',
  131047: 'Outside the 24-hour window — this is why an approved template is required.',
  131026: 'Recipient cannot receive messages (not on WhatsApp, or not added as a test recipient).',
  132000: 'Template parameter count/format mismatch — the template must have exactly 3 variables.',
  132001: 'Template does not exist in this language, or is not approved yet.',
  133010: 'Phone number not registered with the Cloud API.',
};

/**
 * @returns {Promise<{ok: boolean, status: string, detail?: string, messageId?: string}>}
 */
export async function sendOwnerAlert({ rating, message, contact }) {
  const { provider, to, phoneNumberId, accessToken, templateName, templateLang } = config.whatsapp;

  if (provider === 'none') {
    console.log(
      `\n  ── New ${rating}★ feedback ──────────────────────────────\n` +
        `  ${message}\n` +
        `  contact: ${contact || '(none given)'}\n` +
        '  (WHATSAPP_PROVIDER=none — not sent. See /admin for the full log.)\n',
    );
    return { ok: false, status: 'disabled' };
  }

  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: templateLang },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: sanitiseParam(rating) },
            { type: 'text', text: sanitiseParam(message) },
            { type: 'text', text: sanitiseParam(contact, 'no contact left') },
          ],
        },
      ],
    },
  };

  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      const err = payload.error ?? {};
      const hint = KNOWN_ERRORS[err.code];
      const detail = [err.message, err.error_data?.details, hint].filter(Boolean).join(' | ') || `HTTP ${res.status}`;
      console.error(`  ✗ WhatsApp alert failed (code ${err.code ?? res.status}): ${detail}`);
      return { ok: false, status: 'failed', detail };
    }

    const messageId = payload.messages?.[0]?.id;
    console.log(`  ✓ WhatsApp alert sent to ${to} (${messageId ?? 'no id returned'})`);
    return { ok: true, status: 'sent', messageId };
  } catch (err) {
    const detail = err.name === 'TimeoutError' ? `No response from Meta within ${TIMEOUT_MS / 1000}s` : err.message;
    console.error(`  ✗ WhatsApp alert failed: ${detail}`);
    return { ok: false, status: 'failed', detail };
  }
}
