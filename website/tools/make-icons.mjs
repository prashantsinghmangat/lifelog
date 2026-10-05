/**
 * Generates the raster icons the SVG favicon can't cover (Safari's
 * apple-touch-icon, and the maskable PWA icons).
 *
 *   node website/tools/make-icons.mjs
 *
 * Pure Node — no image library. The mark is geometry only (rounded square
 * plus an L), so it rasterises exactly without a font.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'img');

const TEAL = [0x1f, 0x4e, 0x4b, 255];
const WHITE = [0xff, 0xff, 0xff, 255];
const CLEAR = [0, 0, 0, 0];

/* ----------------------------------------------------------------- PNG ---- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------- draw ---- */
/** Signed distance to a rounded rectangle, for cheap 1px antialiasing. */
function roundedRectSdf(px, py, x, y, w, h, r) {
  const cx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const cy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  const ax = Math.max(cx, 0);
  const ay = Math.max(cy, 0);
  return Math.min(Math.max(cx, cy), 0) + Math.hypot(ax, ay) - r;
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    Math.round(a[3] + (b[3] - a[3]) * t),
  ];
}

/**
 * @param {number} size   square edge in px
 * @param {number} radius corner radius as a fraction of the edge (0 = square)
 * @param {number} inset  padding around the mark as a fraction of the edge
 */
function renderIcon(size, radius, inset) {
  const buf = Buffer.alloc(size * size * 4);
  const pad = size * inset;
  const box = size - pad * 2;
  const r = box * radius;

  // The L, in units of the box: stem + foot.
  const stemX = pad + box * 0.30, stemY = pad + box * 0.24;
  const stemW = box * 0.13, stemH = box * 0.52;
  const footW = box * 0.27, footH = box * 0.13;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      let colour = CLEAR;

      const d = roundedRectSdf(px, py, pad, pad, box, box, r);
      if (d < 1) colour = mix(CLEAR, TEAL, Math.min(1, Math.max(0, 1 - d)));

      const inStem = px >= stemX && px < stemX + stemW && py >= stemY && py < stemY + stemH;
      const inFoot = px >= stemX && px < stemX + footW && py >= stemY + stemH - footH && py < stemY + stemH;
      if (inStem || inFoot) colour = WHITE;

      const i = (y * size + x) * 4;
      buf[i] = colour[0]; buf[i + 1] = colour[1]; buf[i + 2] = colour[2]; buf[i + 3] = colour[3];
    }
  }
  return encodePng(size, size, buf);
}

/* ---------------------------------------------------------------- main ---- */
mkdirSync(OUT, { recursive: true });

const targets = [
  // Safari pins this one on the home screen; it must not be transparent,
  // so the mark fills the whole tile.
  { file: 'apple-touch-icon.png', size: 180, radius: 0.0,  inset: 0 },
  { file: 'icon-192.png',         size: 192, radius: 0.22, inset: 0 },
  { file: 'icon-512.png',         size: 512, radius: 0.22, inset: 0 },
  // Maskable: Android crops to its own shape, so keep the mark inside 80%.
  { file: 'icon-maskable-512.png', size: 512, radius: 0.0, inset: 0 },
];

for (const t of targets) {
  writeFileSync(join(OUT, t.file), renderIcon(t.size, t.radius, t.inset));
  console.log('wrote', t.file, `(${t.size}x${t.size})`);
}
