# QR Review System

A counter QR code that turns happy customers into public Google reviews and unhappy
customers into a private message to you.

Customer scans → sees five stars →

- **4 or 5 stars** → sent straight to your Google review page to post publicly
- **1, 2 or 3 stars** → a private feedback box that WhatsApps you directly

---

## Read this first: review gating

Showing the Google link **only** to customers who tapped 4–5 stars is called *review
gating*, and it breaks
[Google's review policy](https://support.google.com/contributionpolicy/answer/7400114).
Google does enforce it. Businesses caught doing it have had review counts wiped and their
Business Profile penalised. Competitors and customers do report it.

This system supports both behaviours through one setting, `REVIEW_MODE`:

| Mode | Behaviour | Policy |
|---|---|---|
| `gated` | Only ratings ≥ threshold ever see the Google link. | Violates Google's policy |
| `compliant` | Low ratings get the private form **first**, then are still offered the Google link on the thank-you screen. | Allowed |

`compliant` keeps most of the commercial benefit: you hear the complaint first and get a
chance to fix it, and many customers who feel heard either don't post or post something
softer. It just doesn't *block* anyone from reviewing.

Default is `gated` because that is what was asked for. Changing it is one word in `.env`.

---

## Setup

### 1. Install

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
```

### 2. Point it at your Google listing

Find your **Place ID** at
[Google's Place ID finder](https://developers.google.com/maps/documentation/places/web-service/place-id),
then in `.env`:

```ini
GOOGLE_PLACE_ID=ChIJ....
```

Or paste a full review link instead (from Google Business Profile → *Ask for reviews*):

```ini
GOOGLE_REVIEW_URL=https://g.page/r/XXXXXXXX/review
```

Also set `SHOP_NAME`, `BRAND_COLOR`, and a real `ADMIN_TOKEN`.

### 3. Run it

```bash
npm start
```

- Rating page — <http://localhost:3000>
- Dashboard — <http://localhost:3000/admin>

The server refuses to start if the config is wrong, and tells you exactly what is
missing. A QR code already glued to a counter is much harder to fix than a boot error.

### 4. Put it on the internet

Customers' phones cannot reach `localhost`. Deploy to any host that runs Node (Railway,
Render, Fly, a VPS), then set `PUBLIC_URL` in `.env` to the real HTTPS address.

### 5. Print the QR code

```bash
npm run qr
```

Writes three files into `public/`:

| File | Use |
|---|---|
| `qr.png` | 1024px, high error correction — digital use or an office printer |
| `qr.svg` | vector — hand this to a print shop for large formats |
| `table-tent.html` | open in a browser, print at A5 — a ready-made counter card |

**Scan-test it on a real phone before printing 500 copies.**

---

## WhatsApp alerts

Alerts use the **Meta WhatsApp Cloud API**. Until it's configured, set
`WHATSAPP_PROVIDER=none` — alerts print to the server console and everything else works
normally. Feedback is never lost either way: it is written to disk before any send is
attempted, and the dashboard is the durable record.

### The 24-hour rule

The Cloud API only allows free-form messages within 24 hours of a customer messaging
you. An alert to the owner is business-initiated, so it **must** use a pre-approved
message template. There is no way around this.

### Setup

1. Create an app at [developers.facebook.com](https://developers.facebook.com) and add
   the **WhatsApp** product.
2. From *WhatsApp → API Setup*, copy the **Phone number ID** into `META_PHONE_NUMBER_ID`.
3. **Generate a permanent token.** The token shown on the API Setup page expires in 24
   hours — a very common trap. Create one via *Business Settings → System Users → Generate
   token* with the `whatsapp_business_messaging` permission, and put it in
   `META_ACCESS_TOKEN`.
4. While in test mode, add the owner's number as a verified recipient on the API Setup
   page, and set `WHATSAPP_TO` to it (E.164, e.g. `+923001234567`).
5. Create a message template under *WhatsApp Manager → Message templates*:
   - **Category:** Utility
   - **Name:** `low_rating_alert`
   - **Body**, with exactly three variables:

     ```
     New {{1}}-star feedback: "{{2}}" - contact: {{3}}
     ```

   Approval usually takes minutes. Put the name in `META_TEMPLATE_NAME`.
6. Set `WHATSAPP_PROVIDER=meta` and restart.

If a send fails, the reason appears in the server log and on the dashboard next to the
message. Common codes are translated into plain English — expired token, unapproved
template, wrong parameter count.

---

## Configuration

All settings live in `.env`. See `.env.example` for the annotated list.

| Key | Default | Notes |
|---|---|---|
| `REDIRECT_THRESHOLD` | `4` | Ratings ≥ this go to Google |
| `REVIEW_MODE` | `gated` | `gated` or `compliant` — see above |
| `SHOP_NAME`, `SHOP_TAGLINE`, `SHOP_LOGO_URL`, `BRAND_COLOR` | — | Branding on the rating page |
| `ADMIN_TOKEN` | — | Dashboard password. Required, min 8 chars |
| `PUBLIC_URL` | localhost | The URL encoded into the QR code |
| `WHATSAPP_PROVIDER` | `none` | `none` or `meta` |

---

## Dashboard

`/admin`, unlocked with `ADMIN_TOKEN`. Shows total scans, average rating, the star
distribution, how many went to Google vs. into private feedback, and every private
message with its WhatsApp delivery status.

Star taps are logged even when they redirect away to Google — otherwise the dashboard
would only ever show you unhappy customers.

---

## How it works

```
config.js         validates .env at boot, refuses to start on bad config
server.js         Express app and API routes
lib/store.js      append-only JSONL event log
lib/whatsapp.js   Meta Cloud API sender
lib/ratelimit.js  per-IP throttle on feedback submissions
public/           rating page (index.html, app.js, styles.css) + admin.html
scripts/qr.js     QR + printable table tent generator
data/events.jsonl created at runtime
```

| Endpoint | Purpose |
|---|---|
| `GET /api/config` | Public branding + threshold for the rating page |
| `POST /api/rating` | Star-tap telemetry (sent via `sendBeacon`) |
| `POST /api/feedback` | Private feedback: stored, then WhatsApp attempted |
| `GET /api/admin/events` | Bearer-token protected stats + feedback |

### Design notes

- **Feedback is saved before it is sent.** The customer gets a success response as soon as
  the message is on disk. A WhatsApp outage can never lose a complaint or show the
  customer an error.
- **The redirect is synchronous.** `location.href` is assigned inside the tap handler
  with no `await` or animation delay first, because mobile Safari only reliably permits
  navigation within the user gesture.
- **Server-side threshold check.** A private submission at or above the threshold is
  rejected — the UI never offers that path, so it means a tampered client.
- **Rate limited** to 5 submissions per IP per 10 minutes, so nobody can stand at the
  counter spamming your phone.

---

## Data and privacy

`data/events.jsonl` stores each rating and each feedback message, with a timestamp, the
client IP and user agent. The IP is there for abuse triage only. If you operate somewhere
with GDPR or similar obligations, note that this is personal data: mention it in your
privacy notice, and delete old records on whatever schedule your policy sets. The file is
plain JSONL, one record per line, so pruning it is trivial.

Back it up. It is the only copy.

### Scale

A flat file is the right call for one counter — greppable, backup-able, no database to
run. If you grow to thousands of scans a day, or add locations, move `lib/store.js` to
SQLite; nothing outside that file needs to change.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Server won't start | Read the message — it names the exact `.env` key |
| QR scans to a dead page | `PUBLIC_URL` is still localhost. Fix it, re-run `npm run qr` |
| Google link opens the listing but not the review box | Wrong Place ID. Use `GOOGLE_REVIEW_URL` with the link from Business Profile instead |
| WhatsApp never arrives | Check the dashboard badge. Expired token, or template not approved |
| `401` on the dashboard | `ADMIN_TOKEN` mismatch |
