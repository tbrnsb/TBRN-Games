/**
 * Generate the paper, grain, halftone and paper-craft props used by the kit.
 * Everything is original and generated locally; no external assets.
 *
 * Run: node scripts/generate-assets.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const root = process.cwd();
const paperDir = join(root, "client", "assets", "paper");
const propDir = join(root, "client", "assets", "props");
mkdirSync(paperDir, { recursive: true });
mkdirSync(propDir, { recursive: true });

const papers = {
  cream: "#F4EBD9",
  newsprint: "#E7E0CC",
  kraft: "#C8A26B",
  butter: "#FBE7A1",
  mint: "#D9F0E8",
  "pale-pink": "#FBD9E3",
  chalkboard: "#2C4A3E",
  blueprint: "#1F4E9C",
  felt: "#0F5C3F",
  night: "#1E1B3A",
};

const SIZE = 512;
let seed = 0x9e3779b9;
function rand() {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 0xffffffff;
}

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

async function makePaper(name, hex) {
  const [br, bg, bb] = hexToRgb(hex);
  const dark = (br + bg + bb) / 3 < 90;
  const amount = dark ? 4 : 7;
  const data = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      // Fine grain, plus a slow fibre wave so the paper is not flat noise.
      const wave = Math.sin(x * 0.055 + Math.sin(y * 0.021) * 2.1) * 1.6;
      const n = (rand() - 0.5) * amount * 2 + wave;
      data[i] = Math.max(0, Math.min(255, br + n));
      data[i + 1] = Math.max(0, Math.min(255, bg + n));
      data[i + 2] = Math.max(0, Math.min(255, bb + n));
      data[i + 3] = 255;
    }
  }
  // Fibres: short, low-contrast horizontal and vertical strands.
  for (let f = 0; f < 900; f++) {
    const x0 = Math.floor(rand() * SIZE);
    const y0 = Math.floor(rand() * SIZE);
    const len = 3 + Math.floor(rand() * 14);
    const vertical = rand() < 0.28;
    const delta = (rand() - 0.5) * (dark ? 5 : 8);
    for (let k = 0; k < len; k++) {
      const x = vertical ? x0 : (x0 + k) % SIZE;
      const y = vertical ? (y0 + k) % SIZE : y0;
      const i = (y * SIZE + x) * 4;
      data[i] = Math.max(0, Math.min(255, data[i] + delta));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + delta));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + delta));
    }
  }
  await sharp(data, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .webp({ quality: 84, effort: 5 })
    .toFile(join(paperDir, `${name}.webp`));
}

for (const [name, hex] of Object.entries(papers)) await makePaper(name, hex);

// Warm tabletop wood: flat base with slow grain, no gradient fill.
async function makeWood(name, hex, dark) {
  const [br, bg, bb] = hexToRgb(hex);
  const data = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const grain = Math.sin(y * 0.18 + Math.sin(x * 0.013) * 3.2) * (dark ? 4 : 7);
      const n = (rand() - 0.5) * (dark ? 5 : 8) + grain;
      data[i] = Math.max(0, Math.min(255, br + n));
      data[i + 1] = Math.max(0, Math.min(255, bg + n));
      data[i + 2] = Math.max(0, Math.min(255, bb + n));
      data[i + 3] = 255;
    }
  }
  for (let f = 0; f < 240; f++) {
    const y0 = Math.floor(rand() * SIZE);
    const x0 = Math.floor(rand() * SIZE);
    const len = 20 + Math.floor(rand() * 120);
    const delta = (rand() - 0.5) * (dark ? 8 : 12);
    for (let k = 0; k < len; k++) {
      const x = (x0 + k) % SIZE;
      const i = (y0 * SIZE + x) * 4;
      data[i] = Math.max(0, Math.min(255, data[i] + delta));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + delta));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + delta));
    }
  }
  await sharp(data, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .webp({ quality: 84, effort: 5 })
    .toFile(join(paperDir, `${name}.webp`));
}
await makeWood("wood", "#6B4428", false);
await makeWood("wood-dark", "#3A2418", true);


// Fixed grain overlay: alpha noise over transparent; CSS uses multiply.
const grain = Buffer.alloc(SIZE * SIZE * 4);
for (let i = 0; i < grain.length; i += 4) {
  grain[i] = 12;
  grain[i + 1] = 10;
  grain[i + 2] = 8;
  grain[i + 3] = Math.floor(rand() * 20);
}
await sharp(grain, { raw: { width: SIZE, height: SIZE, channels: 4 } })
  .webp({ quality: 82, effort: 5 })
  .toFile(join(paperDir, "grain.webp"));

// Halftone tile (black, transparent); tinting happens with opacity/blend.
const dot = 7;
const dots = [];
for (let y = 0; y < 64; y += dot) {
  for (let x = 0; x < 64; x += dot) {
    const ox = (Math.floor(y / dot) % 2) * (dot / 2);
    dots.push(`<circle cx="${x + ox + dot / 2}" cy="${y + dot / 2}" r="1.8" />`);
  }
}
writeFileSync(
  join(paperDir, "halftone.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><g fill="#1D1B26">${dots.join("")}</g></svg>\n`,
);

const props = {
  "tape.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="48" viewBox="0 0 180 48">
    <path d="M4 10 176 6 174 40 6 43Z" fill="#E9D7A8" opacity=".92"/>
    <path d="M4 10 176 6 174 40 6 43Z" fill="none" stroke="#C9B27A" stroke-width="1.5" stroke-dasharray="7 4"/>
    <path d="M12 17 168 14M10 31 170 28" stroke="#FFF6DE" stroke-width="2" opacity=".55"/>
  </svg>`,
  "pin.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <circle cx="17" cy="15" r="9" fill="#F0453A" stroke="#1D1B26" stroke-width="2.5"/>
    <circle cx="14" cy="12" r="2.6" fill="#FFD8D3"/>
    <path d="M21 23 30 34" stroke="#1D1B26" stroke-width="3" stroke-linecap="round"/>
  </svg>`,
  "paperclip.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="78" viewBox="0 0 34 78">
    <path d="M26 17v39a11 11 0 0 1-22 0V13a8 8 0 0 1 16 0v39a4.5 4.5 0 0 1-9 0V20" fill="none" stroke="#7C8494" stroke-width="3.4" stroke-linecap="round"/>
  </svg>`,
  "stamp.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="110" viewBox="0 0 220 110">
    <rect x="8" y="8" width="204" height="94" rx="6" fill="none" stroke="#1D1B26" stroke-width="5"/>
    <rect x="17" y="17" width="186" height="76" rx="3" fill="none" stroke="#1D1B26" stroke-width="2" stroke-dasharray="9 5"/>
  </svg>`,
  "coffee-ring.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">
    <circle cx="75" cy="75" r="54" fill="none" stroke="#9B6A3E" stroke-width="6" opacity=".42"/>
    <circle cx="75" cy="75" r="58" fill="none" stroke="#9B6A3E" stroke-width="2" opacity=".22"/>
    <path d="M31 62c18-16 51-22 82-9" fill="none" stroke="#9B6A3E" stroke-width="8" opacity=".14"/>
  </svg>`,
  "torn-edge.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="36" viewBox="0 0 600 36">
    <path d="M0 0h600v18c-18-9-31 8-49-2s-35 9-53-1-38 8-55-2-41 10-58-1-38 10-56-1-39 11-57 0-35 10-53-1-41 9-58-1-38 9-56 0-37 9-55-1-39 8-55-2Z" fill="#1D1B26"/>
  </svg>`,
  "star.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
    <path d="m40 4 9 23 24 2-18 16 6 24-21-12-21 12 6-24L7 29l24-2Z" fill="#FFC21A" stroke="#1D1B26" stroke-width="3" stroke-linejoin="round"/>
  </svg>`,
  "scribble.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="24" viewBox="0 0 240 24">
    <path d="M4 17c24-13 38 4 61-5s34 8 56-2 31 7 53-2 35 6 62-3" fill="none" stroke="#F0453A" stroke-width="4" stroke-linecap="round"/>
  </svg>`,
  "arrow.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="70" viewBox="0 0 120 70">
    <path d="M112 12C86 8 46 16 24 44" fill="none" stroke="#1D1B26" stroke-width="5" stroke-linecap="round"/>
    <path d="M20 43 12 58l18-4" fill="none" stroke="#1D1B26" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  "fold.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
    <path d="M2 2h58l18 18v58H2Z" fill="#F4EBD9" stroke="#1D1B26" stroke-width="2"/>
    <path d="M60 2v18h18Z" fill="#D8C9A8" stroke="#1D1B26" stroke-width="2"/>
  </svg>`,
};

for (const [name, svg] of Object.entries(props)) writeFileSync(join(propDir, name), `${svg}\n`);
console.log(`[assets] ${Object.keys(papers).length} papers, grain, halftone, ${Object.keys(props).length} props`);
