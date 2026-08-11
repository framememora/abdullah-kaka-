// Generates the counter QR code and a print-ready table tent.
//
//   npm run qr
//
// Encodes PUBLIC_URL from .env — set that to the URL a customer's phone can
// actually reach, not localhost, before printing anything.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

import { config } from '../config.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, '..', 'public');

const url = config.publicUrl;

// High error correction: a counter QR gets smudged, scratched and partly covered
// by a till roll. 'H' tolerates ~30% damage and still scans.
const OPTIONS = { errorCorrectionLevel: 'H', margin: 2, color: { dark: '#000000', light: '#ffffff' } };

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function tableTent(shopName, brandColor, dataUri, target) {
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
      <div class="cta">How did we do?</div>
      <div class="sub">Scan with your phone camera — it takes 5 seconds</div>
      <div class="hint">${escapeHtml(target)}</div>
    </div>
  </body>
</html>
`;
}

async function main() {
  if (/localhost|127\.0\.0\.1/.test(url)) {
    console.warn(
      '\n  ⚠  PUBLIC_URL is still a localhost address.\n' +
        '     A QR code with this URL will not work on a customer phone.\n' +
        '     Set PUBLIC_URL in .env to your real public address before printing.\n',
    );
  }

  await fs.mkdir(PUBLIC_DIR, { recursive: true });

  const pngPath = path.join(PUBLIC_DIR, 'qr.png');
  const svgPath = path.join(PUBLIC_DIR, 'qr.svg');
  const tentPath = path.join(PUBLIC_DIR, 'table-tent.html');

  await QRCode.toFile(pngPath, url, { ...OPTIONS, type: 'png', width: 1024 });
  await QRCode.toFile(svgPath, url, { ...OPTIONS, type: 'svg' });

  const dataUri = await QRCode.toDataURL(url, { ...OPTIONS, width: 900 });
  await fs.writeFile(tentPath, tableTent(config.shop.name, config.shop.brandColor, dataUri, url), 'utf8');

  console.log(`
  QR code generated.

  Encoded URL   ${url}
                ^ scan-test this on a real phone before printing

  qr.png        ${pngPath}
                1024px, high error correction — for digital use or a printer

  qr.svg        ${svgPath}
                vector — give this to a print shop for large formats

  table-tent    ${tentPath}
                open in a browser and print at A5 for a ready-made counter card
`);
}

main().catch((err) => {
  console.error('  ✗ Could not generate the QR code:', err.message);
  process.exit(1);
});
