// Builds the static site that GitHub Pages serves.
//
//   npm run build
//
// The customer-facing flow needs no server: the branding is baked into the page at
// build time (replacing the /api/config round-trip) and both the star telemetry and
// the private feedback go to a Google Apps Script web app.
//
// Source of truth is still .env + config.js. Only publicConfig is baked in — it is
// the vetted subset (config.js:131), so ADMIN_TOKEN and the Meta credentials cannot
// leak into a public repo through this path.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config, publicConfig } from '../config.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, '..', 'public');
const DOCS_DIR = path.join(ROOT, '..', 'docs');

const endpoint = (process.env.APPS_SCRIPT_URL ?? '').trim();

// Without an endpoint every complaint would be POSTed to /api/feedback, 404 on
// Pages, and be swallowed by the client's optimistic fallback. Refuse to build a
// site that silently loses feedback.
if (!endpoint) {
  console.error(`
  ✗ APPS_SCRIPT_URL is not set in .env

    The static site has no server, so private feedback has nowhere to go without it.
    Deploy the Apps Script web app first (see STATIC_SETUP.md), then put its /exec
    URL in .env:

      APPS_SCRIPT_URL=https://script.google.com/macros/s/AKfy.../exec
`);
  process.exit(1);
}

if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpoint)) {
  console.warn(`
  ⚠  APPS_SCRIPT_URL does not look like a deployed web app URL:
       ${endpoint}
     Expected https://script.google.com/macros/s/<id>/exec
     A /dev URL only works while you are signed in — it will fail for customers.
`);
}

function configScript(cfg) {
  // JSON.stringify escapes quotes, but "</script>" inside a string would still end
  // the block early. Escaping the slash is the standard defence.
  const json = JSON.stringify(cfg, null, 2).replace(/<\//g, '<\\/');
  return `    <script>\n      window.SHOP_CONFIG = ${json};\n    </script>\n`;
}

async function main() {
  const [indexHtml, appJs, stylesCss] = await Promise.all([
    fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8'),
    fs.readFile(path.join(PUBLIC_DIR, 'app.js'), 'utf8'),
    fs.readFile(path.join(PUBLIC_DIR, 'styles.css'), 'utf8'),
  ]);

  const baked = { ...publicConfig, endpoint };

  // Pages serves a project site from a subpath (user.github.io/repo/), so every
  // absolute asset path would 404. Relative paths work at either depth.
  let html = indexHtml
    .replace('href="/styles.css"', 'href="./styles.css"')
    .replace('src="/app.js"', 'src="./app.js"')
    .replace('<title>Rate your visit</title>', `<title>Rate ${escapeHtml(config.shop.name)}</title>`);

  if (html.includes('href="/') || html.includes('src="/')) {
    throw new Error('An absolute asset path survived the rewrite — it would 404 under a Pages subpath.');
  }

  html = html.replace('    <script src="./app.js"></script>', `${configScript(baked)}    <script src="./app.js"></script>`);

  if (!html.includes('window.SHOP_CONFIG')) {
    throw new Error('Could not inject the baked config — the <script src="./app.js"> tag was not found.');
  }

  await fs.mkdir(DOCS_DIR, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(DOCS_DIR, 'index.html'), html, 'utf8'),
    fs.writeFile(path.join(DOCS_DIR, 'app.js'), appJs, 'utf8'),
    fs.writeFile(path.join(DOCS_DIR, 'styles.css'), stylesCss, 'utf8'),
    // Stops Pages running the output through Jekyll, which would drop any file
    // or folder whose name begins with an underscore.
    fs.writeFile(path.join(DOCS_DIR, '.nojekyll'), '', 'utf8'),
  ]);

  const localhostWarning = /localhost|127\.0\.0\.1/.test(config.publicUrl)
    ? '\n  ⚠  PUBLIC_URL is still localhost — set it to the Pages URL before running "npm run qr".\n'
    : '';

  console.log(`
  Static site built → docs/

  Shop          ${config.shop.name}
  Mode          ${config.reviewMode} (${config.threshold}★ and above go to Google)
  Feedback to   ${endpoint}
  Google URL    ${config.googleReviewUrl}
  Pages URL     ${config.publicUrl}
${localhostWarning}
  Preview it:   npx http-server docs -p 8080
  Then commit docs/ and push — Pages serves whatever is in that folder.
`);
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

main().catch((err) => {
  console.error('  ✗ Static build failed:', err.message);
  process.exit(1);
});
