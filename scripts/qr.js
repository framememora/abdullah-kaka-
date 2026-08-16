// Generates a counter QR code and a print-ready table tent.
//
//   npm run qr                      the funnel card — encodes PUBLIC_URL
//   npm run qr -- --google          the plain card — straight to the Google review page
//   npm run qr -- --url <url> --out <name> --heading <text> --sub <text>
//
// Encodes a URL a customer's phone can actually reach — not localhost, not a LAN
// address. The guard below refuses to run for either.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

import { config } from '../config.js';
import { toSvg, toPngBuffer } from './qr-render.js';

/** Read a rendered PNG back and return the URL it actually encodes, or null. */
function decodePng(buffer) {
  const png = PNG.sync.read(buffer);
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return result ? result.data : null;
}

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, '..', 'public');

// ── Arguments ────────────────────────────────────────────────────────────────

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}

const wantsGoogle = process.argv.includes('--google');

// Two cards get printed: the funnel (scan → rate → split) and a plain one that
// goes straight to Google, which keeps working even if the funnel is ever retired.
const preset = wantsGoogle
  ? {
      url: config.googleReviewUrl,
      out: 'google',
      // Sits directly under the code, so it reads as an instruction rather than
      // a question -- the customer is already looking at the QR by then.
      heading: 'Scan to rate us on Google',
      sub: 'Point your phone camera — takes 5 seconds',
    }
  : {
      url: config.publicUrl,
      out: 'qr',
      heading: 'Scan to rate us',
      sub: 'Point your phone camera — takes 5 seconds',
    };

const url = arg('url', preset.url);
const outName = arg('out', preset.out);
const heading = arg('heading', preset.heading);
const sub = arg('sub', preset.sub);

// High error correction: a counter QR gets smudged, scratched and partly covered
// by a till roll. 'H' tolerates ~30% damage and still scans -- which is also what
// makes the centre badge in qr-render.js safe.
//
// Black on white deliberately, not the brand colour: these get printed on
// whatever the local shop has, and a light-running inkjet costs contrast the
// scanner needs. The badge is free; the colour would not be.
const DARK = '#000000';
const LIGHT = '#ffffff';

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

/**
 * A5 counter card, built to be recognised rather than read.
 *
 * Two things are borrowed from the UPI standees every Indian counter already
 * has, because a customer has learned what those mean:
 *   - corner brackets framing the code, which say "point your camera here"
 *     without needing a language;
 *   - the code on a white panel, never on the colour. That keeps black-on-white
 *     contrast whatever the brand colour is, and contrast is what decides
 *     whether a printed code scans at all.
 *
 * The code prints at 74mm against a ~25mm minimum, so it reads at arm's length
 * across a counter instead of making someone lean in.
 */
function tableTent(shopName, brandColor, dataUri, target, cta, subtitle) {
  const displayTarget = target.replace(/^https?:\/\//, '');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(shopName)} — counter card</title>
    <style>
      @page { size: A5; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body {
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        -webkit-font-smoothing: antialiased;
        background: #eceff3;
        display: grid;
        place-items: center;
        min-height: 100vh;
      }
      .card {
        width: 148mm;
        height: 210mm;
        background: #14161a;
        color: #fff;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: space-between;
        text-align: center;
        padding: 14mm 10mm 10mm;
      }
      .kicker {
        font-size: 9pt; letter-spacing: .32em; text-transform: uppercase;
        color: #fbbc04; margin-bottom: 4mm;
      }
      .name { font-size: 26pt; font-weight: 700; letter-spacing: .01em; line-height: 1.05; }
      .stars { font-size: 14pt; color: #fbbc04; letter-spacing: 4px; margin-top: 4mm; }
      .panel {
        background: #fff;
        border-radius: 4mm;
        padding: 7mm;
      }
      /* Bracket corners drawn from the panel, so they never overlap the code's
         quiet zone -- covering that is a common way to make a card unscannable. */
      .frame { position: relative; padding: 4mm; }
      .frame::before, .frame::after, .frame > i {
        content: ''; position: absolute; width: 9mm; height: 9mm;
        border: 1.6mm solid #14161a;
      }
      .frame::before { top: 0; left: 0; border-right: 0; border-bottom: 0; border-radius: 3mm 0 0 0; }
      .frame::after { top: 0; right: 0; border-left: 0; border-bottom: 0; border-radius: 0 3mm 0 0; }
      .frame > i.bl { bottom: 0; left: 0; border-right: 0; border-top: 0; border-radius: 0 0 0 3mm; }
      .frame > i.br { bottom: 0; right: 0; border-left: 0; border-top: 0; border-radius: 0 0 3mm 0; }
      .qr { display: block; width: 74mm; height: 74mm; }
      .cta { font-size: 20pt; font-weight: 700; }
      .sub { font-size: 11pt; color: #a7adb8; margin-top: 2mm; }
      .foot { font-size: 8pt; color: #6d747f; letter-spacing: .04em; }
      @media print {
        body { background: #fff; min-height: 0; display: block; }
        /* Without this the browser helpfully drops the background to save ink,
           and the card prints as white with white text on it. */
        .card { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div>
        <div class="kicker">Tell us how we did</div>
        <div class="name">${escapeHtml(shopName)}</div>
        <div class="stars">★★★★★</div>
      </div>

      <div class="panel">
        <div class="frame"><i class="bl"></i><i class="br"></i>
          <img class="qr" src="${dataUri}" alt="QR code linking to ${escapeHtml(displayTarget)}" />
        </div>
      </div>

      <div>
        <div class="cta">${escapeHtml(cta)}</div>
        <div class="sub">${escapeHtml(subtitle)}</div>
      </div>

      <div class="foot">${escapeHtml(displayTarget)}</div>
    </div>
  </body>
</html>
`;
}

/**
 * Addresses that resolve on the dev machine but nowhere a customer stands.
 * A LAN IP is the exact mistake that produced the first unusable card, so this
 * is a hard stop rather than a warning.
 */
function unreachableReason(target) {
  let host;
  try {
    host = new URL(target).hostname;
  } catch {
    return `"${target}" is not a valid URL.`;
  }

  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return 'it points at localhost — only this machine can open it.';
  }
  if (host.endsWith('.local')) {
    return 'a .local hostname only resolves on the same network.';
  }
  if (/^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return `${host} is a private LAN address — it only works on the same wifi, and breaks when the IP changes.`;
  }
  return null;
}

async function main() {
  const reason = unreachableReason(url);
  if (reason) {
    console.error(
      `\n  ✗ Refusing to generate a QR code for ${url}\n` +
        `    ${reason}\n\n` +
        '    A card printed with this address is dead the moment it leaves the shop.\n' +
        '    Set PUBLIC_URL in .env to the live https:// address first.\n',
    );
    process.exit(1);
  }

  await fs.mkdir(PUBLIC_DIR, { recursive: true });

  const pngPath = path.join(PUBLIC_DIR, `${outName}.png`);
  const svgPath = path.join(PUBLIC_DIR, `${outName}.svg`);
  const tentPath = path.join(PUBLIC_DIR, `${outName}-table-tent.html`);

  const style = { dark: DARK, light: LIGHT, badge: true };

  const pngBuffer = await toPngBuffer(url, { ...style, width: 1024 });
  await fs.writeFile(pngPath, pngBuffer);
  await fs.writeFile(svgPath, await toSvg(url, style), 'utf8');

  // Read the finished pixels back and confirm they still carry the right URL.
  // A badge that quietly broke the symbol would otherwise only surface after a
  // stack of cards had been printed.
  const decoded = decodePng(pngBuffer);
  if (decoded !== url) {
    throw new Error(
      `the generated code decodes to ${decoded ? `"${decoded}"` : 'nothing'}, not "${url}" — refusing to write an unscannable card`,
    );
  }

  const dataUri = `data:image/png;base64,${pngBuffer.toString('base64')}`;
  await fs.writeFile(
    tentPath,
    tableTent(config.shop.name, config.shop.brandColor, dataUri, url, heading, sub),
    'utf8',
  );

  console.log(`
  ${wantsGoogle ? 'Plain Google card' : 'Funnel card'} generated.

  Encoded URL   ${url}
                ^ scan-test this on a real phone, on mobile data, before printing

  ${outName}.png${' '.repeat(Math.max(1, 12 - outName.length))}${pngPath}
                1024px, high error correction — for digital use or a printer

  ${outName}.svg${' '.repeat(Math.max(1, 12 - outName.length))}${svgPath}
                vector — give this to a print shop for large formats

  table-tent    ${tentPath}
                open in a browser and print at A5 for a ready-made counter card
`);
}

main().catch((err) => {
  console.error('  ✗ Could not generate the QR code:', err.message);
  process.exit(1);
});
