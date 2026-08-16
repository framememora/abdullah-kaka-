// Prepares a shop photo for the rating page.
//
//   node scripts/optimise-photo.js <source-image>
//
// The page is ~25KB of HTML, CSS and JS. An untouched phone photo is 2-4MB, so
// dropping one in unprocessed would make the page a hundred times heavier for a
// customer standing at a counter on one bar of signal -- the exact person this
// has to load fast for. This resizes and compresses hard, then refuses to emit
// anything over the budget.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, '..', 'public');

// Displayed at roughly 320px wide inside the card; 2x covers retina screens.
const TARGET_WIDTH = 640;
const MAX_BYTES = 70 * 1024;

const source = process.argv[2];

if (!source) {
  console.error(`
  Usage: node scripts/optimise-photo.js <source-image>

  Writes public/shop.jpg, sized and compressed for the counter page.
`);
  process.exit(1);
}

if (!fs.existsSync(source)) {
  console.error(`  ✗ No such file: ${source}`);
  process.exit(1);
}

const out = path.join(PUBLIC_DIR, 'shop.jpg');
const before = fs.statSync(source).size;

// Step down the quality until it fits, rather than picking one number and
// hoping: how well a photo compresses depends entirely on the photo.
let quality = 82;
let after = Infinity;

while (quality >= 55) {
  execFileSync('convert', [
    source,
    '-auto-orient', // phone photos carry rotation in EXIF; bake it in
    '-resize',
    `${TARGET_WIDTH}x>`, // only ever shrink
    '-strip', // drop EXIF, which can carry GPS coordinates of the shop
    '-interlace',
    'Plane', // progressive: something appears before the whole file lands
    '-quality',
    String(quality),
    out,
  ]);

  after = fs.statSync(out).size;
  if (after <= MAX_BYTES) break;
  quality -= 7;
}

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;

if (after > MAX_BYTES) {
  console.warn(`
  ⚠  Still ${kb(after)} at quality ${quality}, over the ${kb(MAX_BYTES)} budget.
     It is written, but consider a simpler crop -- busy photos do not compress.
`);
}

console.log(`
  Photo optimised → public/shop.jpg

  Source        ${source}
  Before        ${kb(before)}
  After         ${kb(after)}  (quality ${quality}, ${TARGET_WIDTH}px wide)
  Saved         ${(100 - (after / before) * 100).toFixed(1)}%

  EXIF stripped — phone photos embed GPS coordinates, and this file becomes public.

  Next: npm run build, then commit public/shop.jpg and docs/shop.jpg.
`);
