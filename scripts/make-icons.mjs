// Generates the app icons (PNG + SVG) without any dependency. Run: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [0x1f, 0x3a, 0x5f];
const FG = [0xff, 0xff, 0xff];
const ACC = [0xf2, 0xc1, 0x4e];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Full-bleed square icon (iOS rounds the corners itself). */
function pixel(x, y, s) {
  const u = x / s, v = y / s;
  // speech bubble: rounded rect 0.2..0.8 x 0.22..0.68, tail at bottom left
  const inRect = (l, t, r, b, rad) => {
    const cx = Math.min(Math.max(u, l + rad), r - rad), cy = Math.min(Math.max(v, t + rad), b - rad);
    return (u - cx) ** 2 + (v - cy) ** 2 <= rad * rad;
  };
  const bubble = inRect(0.18, 0.22, 0.82, 0.66, 0.1);
  const tail = v >= 0.6 && v <= 0.8 && u >= 0.3 && u <= 0.44 && (u - 0.3) <= (0.8 - v) * 0.7;
  if (bubble || tail) {
    // three dots in the bubble
    for (const dx of [0.36, 0.5, 0.64]) if ((u - dx) ** 2 + (v - 0.44) ** 2 <= 0.045 ** 2) return ACC;
    return FG;
  }
  return BG;
}

function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192));
writeFileSync("public/icons/icon-512.png", png(512));
writeFileSync("public/icons/apple-touch-icon.png", png(180));
writeFileSync(
  "public/icons/icon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#1f3a5f"/><rect x="18" y="22" width="64" height="44" rx="10" fill="#fff"/><path d="M30 60 L44 60 L30 80 Z" fill="#fff"/><circle cx="36" cy="44" r="4.5" fill="#f2c14e"/><circle cx="50" cy="44" r="4.5" fill="#f2c14e"/><circle cx="64" cy="44" r="4.5" fill="#f2c14e"/></svg>\n`,
);
console.log("icons written");
