# Free hosting runbook — GitHub Pages + Google Apps Script

The static deployment. No server to pay for, nothing to keep awake, no cold starts.
GitHub Pages serves the rating page; a Google Apps Script web app stores feedback in a
Sheet and emails you when someone is unhappy.

Total cost: ₹0/month. Follow these in order — steps 5 onward need the URLs from earlier
steps.

> The Express app (`npm start`) still works and is unchanged. This is an additional way
> to deploy the same funnel, not a replacement for local development.

---

## 1. Create the Sheet and its script

1. Go to <https://sheets.google.com> and create a blank spreadsheet. Name it
   `Variety Fancy — reviews`.
2. In that sheet: **Extensions → Apps Script**. A code editor opens in a new tab.
3. Delete whatever is in `Code.gs` and paste the entire contents of
   `scripts/apps-script/Code.gs` from this repo.
4. Check the settings block at the top — `OWNER_EMAIL` is where complaint emails go, and
   `REDIRECT_THRESHOLD` must match `REDIRECT_THRESHOLD` in `.env` (currently `4`).
5. Click the **save** icon.

## 2. Deploy it as a web app

1. **Deploy → New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Set:
   - **Execute as:** Me
   - **Who has access:** **Anyone** ← must be "Anyone", not "Anyone with a Google account".
     Customers are not signed in.
4. **Deploy**. Google asks you to authorise it — it needs permission to write to the Sheet
   and send mail as you. Click through the "unverified app" warning (it is your own script:
   *Advanced → Go to ... (unsafe)*).
5. Copy the **Web app URL**. It ends in `/exec`.

> Every time you edit `Code.gs` you must **Deploy → Manage deployments → edit → New version**
> for the change to reach the live URL. Saving alone does nothing.

## 3. Point the build at it

In `.env`:

```
APPS_SCRIPT_URL=https://script.google.com/macros/s/AKfy...your-id.../exec
```

Sanity-check it from a terminal — this should reply `{"ok":true,...}`:

```bash
curl -sL "$APPS_SCRIPT_URL"
```

## 4. Push the code to GitHub

The repo must be **public** — GitHub Pages on a private repo needs a paid plan.

Nothing secret is committed: `.gitignore` excludes `.env` and `data/`, and only
`publicConfig` (`config.js:131`) is baked into the built page.

```bash
git add -A
git commit -m "Add static GitHub Pages deployment"
```

Then create the repo. If you have the GitHub CLI:

```bash
gh repo create variety-fancy-reviews --public --source=. --push
```

If you do not (it is not installed here), make it on <https://github.com/new> instead —
name it `variety-fancy-reviews`, set it **Public**, and add no README, .gitignore or
licence, so the repo starts empty. Then:

```bash
git remote add origin https://github.com/<your-username>/variety-fancy-reviews.git
git push -u origin main
```

## 5. Turn on Pages

In the repo on github.com: **Settings → Pages**

- **Source:** Deploy from a branch
- **Branch:** `main`, folder **`/docs`**
- **Save**

Wait about a minute, then reload. It shows your live URL, of the form
`https://<your-username>.github.io/variety-fancy-reviews/`

## 6. Build and publish the site

Put that URL in `.env` (keep the trailing slash off):

```
PUBLIC_URL=https://<your-username>.github.io/variety-fancy-reviews
```

Then:

```bash
npm run build
git add -A && git commit -m "Build static site" && git push
```

Give Pages a minute, then open the URL on your computer. It should say **Variety Fancy**.

## 7. Make the cards

```bash
npm run qr           # the funnel card  → public/qr.png, qr.svg, qr-table-tent.html
npm run qr:google    # the plain card   → public/google.png, google.svg, google-table-tent.html
```

`npm run qr` **refuses to run** against `localhost` or a `192.168.x.x` address — that is the
exact mistake that made the first card unusable, so it is now a hard stop rather than a
warning.

Open either `*-table-tent.html` in a browser and print at A5.

**Before printing a stack: scan the QR with a phone on mobile data, with wifi turned off.**
That is the only test that proves a customer standing at your counter can reach it.

---

## The two cards

| Card | Scans to | Needs hosting? |
|---|---|---|
| **Funnel** (`qr.png`) | Your rating page: 4–5★ → Google, 1–3★ → private form | Yes — steps 1–6 |
| **Plain** (`google.png`) | Straight to your Google review page | No — works today, forever |

The plain card is the fallback. If Pages or the Apps Script ever break, put it on the
counter and you are still collecting Google reviews.

## Where your feedback lands

- **Private complaints (1–3★)** — emailed to `usmannissam1@gmail.com` within seconds, and
  appended to the Sheet.
- **Every star tap, including the ones that went to Google** — a row in the Sheet, so you
  can see the real distribution rather than only the unhappy ones.

The Sheet replaces the `/admin` dashboard for this deployment. Select the `rating` column
and Google Sheets will chart the distribution for you.

## If something breaks

| Symptom | Cause |
|---|---|
| Page says "Unable to load" | The baked config is missing — rerun `npm run build` and push |
| Page 404s | Pages is pointed at the wrong branch/folder, or `docs/` was not committed |
| No email arrives | The deployment was never re-versioned after an edit, or Gmail's 100/day quota is spent |
| Feedback missing from the Sheet | `APPS_SCRIPT_URL` in the built page is stale — rebuild and push |
| Styling missing | An absolute `/styles.css` path crept back in; the build guards against this and will fail loudly |

## What is not in this deployment

- **The `/admin` dashboard.** The Sheet replaces it. `admin.html` and the admin API still
  work under `npm start`.
- **WhatsApp alerts.** `lib/whatsapp.js` is written and ready, but Meta's Cloud API cannot
  send *from* a number that is already on regular WhatsApp — it needs a separate spare
  number, business verification, and an approved template. +91 9995878853 stays the intended
  recipient if that is ever set up. Email covers it until then.
- **Server-side rate limiting.** `lib/ratelimit.js` only applies to the Express app. The
  Apps Script URL is visible in the page source and can be POSTed to by anyone; the
  validation in `Code.gs` and Google's own quotas keep the worst case to junk rows in a
  Sheet.
