# Client onboarding runbook

This app is single-tenant: one running instance serves exactly one business
(`config.js` loads one `.env`, `lib/store.js` writes one `data/events.jsonl`).
There is no shared multi-client dashboard. Every new client means a new
deployment, start to finish. Follow this checklist each time.

For what each setting means and why, see `README.md` — this file is just the
repeatable steps.

## 1. Collect from the client before you touch anything

- **Business name**, tagline, logo URL, brand hex color.
- **Google Place ID** or a full **review link** (from their Google Business
  Profile → *Ask for reviews*). Place ID finder:
  <https://developers.google.com/maps/documentation/places/web-service/place-id>
- **A WhatsApp number** to receive low-rating alerts (E.164 format, e.g.
  `+923001234567`) — theirs or yours, their call.
- **`gated` or `compliant`?** Tell them plainly: `gated` (only 4–5★ ever see
  the Google link) is what most people assume they want, but it violates
  Google's review policy and Google does enforce it — wiped review counts,
  penalized profiles. `compliant` still intercepts low ratings privately
  first, but eventually offers the Google link to everyone, so it can't be
  characterized as gating. Get their choice in writing; it's their listing at
  risk, not yours.

## 2. Deploy a fresh instance

Each client gets their own hosting instance (Railway, Render, Fly, a VPS —
whichever you use) and their own subdomain or domain, e.g.
`reviews.clientbusiness.com`. Do not point two clients at the same running
process — there's nowhere in the code to separate their data.

```bash
git clone <this repo> client-<name>
cd client-<name>
npm install
cp .env.example .env
```

## 3. Fill in `.env` for this client

| Key | Set to |
|---|---|
| `SHOP_NAME`, `SHOP_TAGLINE`, `SHOP_LOGO_URL`, `BRAND_COLOR` | their branding |
| `GOOGLE_PLACE_ID` or `GOOGLE_REVIEW_URL` | from step 1 |
| `REVIEW_MODE` | their informed choice from step 1 |
| `REDIRECT_THRESHOLD` | `4` unless they ask otherwise |
| `ADMIN_TOKEN` | a **fresh, unique** secret, 8+ chars — never reuse a token across clients |
| `WHATSAPP_PROVIDER` | `none` to start, or `meta` if already set up (see README's WhatsApp section) |
| `WHATSAPP_TO` | their number from step 1, if `meta` |
| `PUBLIC_URL` | the real `https://` domain this instance will run on — **not** `localhost` or a LAN IP |

The server refuses to boot if anything required is missing or still a
placeholder (`config.js` checks this) — read the error, it names the exact
key.

## 4. Generate and print the QR code

Only after `PUBLIC_URL` is the real live domain:

```bash
npm run qr
```

This writes `public/qr.png`, `public/qr.svg`, and `public/table-tent.html`.
**Scan-test `qr.png` on a real phone, off your own wifi, before printing
anything.** Hand `table-tent.html` (print at A5) or `qr.svg` (vector, for a
print shop) to the client.

## 5. Verify end-to-end before calling it live

- Scan → tap 4 or 5 stars → confirm it lands on the client's real Google
  review page.
- Scan → tap 1, 2, or 3 stars → submit feedback → confirm it appears at
  `/admin` and (if `WHATSAPP_PROVIDER=meta`) the WhatsApp alert arrives.
- If `REVIEW_MODE=compliant`, confirm the thank-you screen after a low rating
  still offers the Google link.

## 6. Hand off to the client

Give them two things: their dashboard URL (`https://<their-domain>/admin`)
and their `ADMIN_TOKEN`. Tell them, in these words: *"Go to that address,
paste this into the 'Admin token' box like a password, click Sign in."*
There's no username and no separate accounts — one shared token for the whole
dashboard. It logs them out when they close the browser tab, so they'll paste
it in again next time they check.
