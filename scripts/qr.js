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
import QRCode from 'qrcode';

import { config } from '../config.js';

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
      heading: 'Rate us on Google',
      sub: 'Scan with your phone camera — it takes 5 seconds',
    }
  : {
      url: config.publicUrl,
      out: 'qr',
      heading: 'How did we do?',
      sub: 'Scan with your phone camera — it takes 5 seconds',
    };

const url = arg('url', preset.url);
const outName = arg('out', preset.out);
const heading = arg('heading', preset.heading);
const sub = arg('sub', preset.sub);

// High error correction: a counter QR gets smudged, scratched and partly covered
// by a till roll. 'H' tolerates ~30% damage and still scans.
const OPTIONS = { errorCorrectionLevel: 'H', margin: 2, color: { dark: '#000000', light: '#ffffff' } };

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function tableTent(shopName, brandColor, dataUri, target, cta, subtitle) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(shopName)} — counter card</title>
    <style>
      @page { size: A5; margin: 0; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        background: #eceff3;
        display: grid;
        place-items: center;
        min-height: 100vh;
      }
      .tent {
        width: 148mm;
        height: 210mm;
        background: #fff;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 16mm 12mm;
        border-top: 10mm solid ${escapeHtml(brandColor)};
      }
      h1 { font-size: 30pt; margin: 0 0 3mm; letter-spacing: -0.02em; }
      .stars { font-size: 26pt; color: #fbbc04; letter-spacing: 5px; margin-bottom: 8mm; }
      .qr { width: 82mm; height: 82mm; }
      .cta { font-size: 19pt; font-weight: 600; margin-top: 8mm; }
      .sub { font-size: 12pt; color: #5f6672; margin-top: 2mm; }
      .hint { font-size: 8pt; color: #9aa1ab; margin-top: 10mm; word-break: break-all; }
      @media print {
        body { background: #fff; min-height: 0; }
        .tent { border-top-color: ${escapeHtml(brandColor)}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    </style>
  </head>
  <body>
    <div class="tent">
      <h1>${escapeHtml(shopName)}</h1>
      <div class="stars">★★★★★</div>
      <img class="qr" src="${dataUri}" alt="QR code linking to the rating page" />
      <div class="cta">${escapeHtml(cta)}</div>
      <div class="sub">${escapeHtml(subtitle)}</div>
      <div class="hint">${escapeHtml(target)}</div>
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

  await QRCode.toFile(pngPath, url, { ...OPTIONS, type: 'png', width: 1024 });
  await QRCode.toFile(svgPath, url, { ...OPTIONS, type: 'svg' });

  const dataUri = await QRCode.toDataURL(url, { ...OPTIONS, width: 900 });
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
