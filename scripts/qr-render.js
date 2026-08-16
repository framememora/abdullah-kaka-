// Renders a QR code from its raw module matrix, so the card can carry the brand
// colour and a centre badge that the qrcode package's own SVG/PNG writers cannot
// produce.
//
// The badge is safe because every code here is generated at error-correction
// level H, which reconstructs up to ~30% of lost modules. The knockout below
// covers a little over 3% of the symbol and sits dead centre, away from the
// three finder patterns and the timing rows a scanner locks onto first.

import QRCode from 'qrcode';
import { PNG } from 'pngjs';

const QUIET_ZONE = 4; // modules; 4 is the spec minimum and what scanners expect

/** Five-pointed star as polygon points, centred on (cx, cy). */
function starPoints(cx, cy, outer) {
  const inner = outer * 0.382; // classic pentagram ratio
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/**
 * Build the geometry shared by both output formats.
 * Returns the module matrix plus the badge circle in MODULE units, so the SVG
 * and the PNG cannot drift apart.
 */
export async function buildSymbol(url) {
  const qr = await QRCode.create(url, { errorCorrectionLevel: 'H' });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const total = size + QUIET_ZONE * 2;

  const centre = total / 2;
  const badgeRadius = size * 0.115; // ~3.3% of the symbol area
  const starRadius = badgeRadius * 0.62;

  const isDark = (row, col) => data[row * size + col] === 1;

  return { size, total, centre, badgeRadius, starRadius, isDark };
}

export async function toSvg(url, { dark = '#000000', light = '#ffffff', badge = true } = {}) {
  const { size, total, centre, badgeRadius, starRadius, isDark } = await buildSymbol(url);

  // One path for every dark module beats one <rect> each: a 57-module symbol is
  // ~1500 rects, and print shops choke on the resulting file.
  let d = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isDark(r, c)) continue;
      d += `M${c + QUIET_ZONE} ${r + QUIET_ZONE}h1v1h-1z`;
    }
  }

  const star = starPoints(centre, centre, starRadius)
    .map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`)
    .join(' ');

  const badgeMarkup = badge
    ? `
  <circle cx="${centre}" cy="${centre}" r="${badgeRadius.toFixed(3)}" fill="${light}"/>
  <circle cx="${centre}" cy="${centre}" r="${(badgeRadius * 0.86).toFixed(3)}" fill="${dark}"/>
  <polygon points="${star}" fill="${light}"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QR code">
  <rect width="${total}" height="${total}" fill="${light}"/>
  <path d="${d}" fill="${dark}"/>${badgeMarkup}
</svg>
`;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

export async function toPngBuffer(url, { dark = '#000000', light = '#ffffff', width = 1024, badge = true } = {}) {
  const { total, centre, badgeRadius, starRadius, isDark } = await buildSymbol(url);

  // Snap to a whole number of pixels per module. A fractional scale produces
  // uneven module widths, which is exactly what makes a printed code fail to
  // scan at an angle.
  const scale = Math.max(1, Math.floor(width / total));
  const px = total * scale;

  const [dr, dg, db] = hexToRgb(dark);
  const [lr, lg, lb] = hexToRgb(light);

  const png = new PNG({ width: px, height: px });
  const star = starPoints(centre * scale, centre * scale, starRadius * scale);
  const badgeR = badgeRadius * scale;
  const ringR = badgeRadius * 0.86 * scale;
  const cx = centre * scale;
  const cy = centre * scale;

  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const idx = (px * y + x) << 2;

      const moduleCol = Math.floor(x / scale) - QUIET_ZONE;
      const moduleRow = Math.floor(y / scale) - QUIET_ZONE;
      let on =
        moduleRow >= 0 &&
        moduleCol >= 0 &&
        moduleRow < total - QUIET_ZONE * 2 &&
        moduleCol < total - QUIET_ZONE * 2 &&
        isDark(moduleRow, moduleCol);

      if (badge) {
        // Sample at the pixel centre so the circle edge lands where the SVG puts it.
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= badgeR) on = false;
        if (dist <= ringR) on = true;
        if (pointInPolygon(x + 0.5, y + 0.5, star)) on = false;
      }

      png.data[idx] = on ? dr : lr;
      png.data[idx + 1] = on ? dg : lg;
      png.data[idx + 2] = on ? db : lb;
      png.data[idx + 3] = 255;
    }
  }

  return PNG.sync.write(png);
}
