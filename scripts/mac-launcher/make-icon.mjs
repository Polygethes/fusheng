// Draws the desktop launcher's icon — a lit house at dusk, a resident at the
// door, a moon — as 32×32 pixel art, scales it with hard edges and writes a
// macOS .iconset (PNG files only; `iconutil` turns it into .icns).
//   node scripts/mac-launcher/make-icon.mjs <out.iconset>
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const N = 32;
const PALETTE = {
  ".": null,             // transparent (outside the rounded tile)
  n: [27, 24, 46],       // night sky
  m: [44, 38, 70],       // sky, lower
  s: [241, 230, 207],    // star / moon light
  y: [232, 193, 96],     // moon, lit window
  Y: [255, 224, 140],    // window glow core
  r: [150, 64, 52],      // roof
  R: [112, 44, 38],      // roof shade
  w: [214, 196, 160],    // wall
  W: [176, 156, 122],    // wall shade
  d: [92, 60, 40],       // door
  g: [64, 104, 64],      // grass
  G: [46, 80, 50],       // grass shade
  p: [90, 74, 62],       // path
  k: [40, 32, 30],       // hair / outline
  f: [232, 196, 160],    // face
  b: [86, 120, 170],     // robe
  B: [60, 88, 132],      // robe shade
};

// 32 rows × 32 columns.
const ART = [
  "................................",
  "...nnnnnnnnnnnnnnnnnnnnnnnnnn...",
  "..nnnnnnnnnnnnnnnnnnnnnnnnnnnn..",
  ".nnnnsnnnnnnnnnnnnnnnnnyyynnnnn.",
  ".nnnnnnnnnnnnnnnsnnnnnyyyyynnnn.",
  ".nnnnnnnnnnnnnnnnnnnnnyyyyynnnn.",
  ".nnnnnnnnnsnnnnnnnnnnnyyyyynnnn.",
  ".nnnnnnnnnnnnnnnnnnnnnnyyynnnnn.",
  ".nnsnnnnnnnnnnnnnnnnnnnnnnnnnnn.",
  ".nnnnnnnnnnnnrrnnnnnnnnnnnsnnnn.",
  ".nnnnnnnnnnnrrrrnnnnnnnnnnnnnnn.",
  ".mmmmmmmmmmrrrrrrmmmmmmmmmmmmmm.",
  ".mmmmmmmmmrrrrrrrrmmmmmmmmmmmmm.",
  ".mmmmmmmmrrrrrrrrrrmmmmmmmmmmmm.",
  ".mmmmmmmrrrrrrrrrrrrmmmmmmmmmmm.",
  ".mmmmmmRRRRRRRRRRRRRRmmmmmmmmmm.",
  ".mmmmmmmwwwwwwwwwwwwmmmmmmmmmmm.",
  ".mmmmmmmwYYwwwwwwYYwmmmmmmmmmmm.",
  ".mmmmmmmwYyWwwwwwyYwmmmmkkkmmmm.",
  ".mmmmmmmwyyWwwwwwyywmmmkkkkkmmm.",
  ".mmmmmmmwWWWwddwwWWwmmmmfffmmmm.",
  ".mmmmmmmwwwwwddwwwwwmmmmfffmmmm.",
  ".mmmmmmmwwwwwddwwwwwmmmbbbbbmmm.",
  ".gggggggWWWWWddWWWWWgggbbbbbggg.",
  ".gggggggggggppppgggggggbBbBbggg.",
  ".gGggggggggppppppgggggggbbbgggg.",
  ".ggggGggggppppppppggggggkgkgggg.",
  ".ggggggggppppppppppggGgggggGggg.",
  ".gggGgggppppppppppppggggggggggg.",
  "..ggggggppppppppppppgggggGgggg..",
  "...ggggppppppppppppppgggggggg...",
  "................................",
];

function rgbaAt(x, y) {
  const ch = ART[y][x];
  const color = PALETTE[ch === "." ? "." : ch];
  if (ch === "." ) return [0, 0, 0, 0];
  if (!color) throw new Error(`unknown pixel ${ch} at ${x},${y}`);
  return [...color, 255];
}

function crcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC = crcTable();
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// macOS icons leave a margin around the tile: 100 of 1024 on each side.
const MARGIN = 100 / 1024;

/** One PNG of `size`×`size`, each art pixel a hard-edged block inside the margin. */
function png(size) {
  const inset = Math.round(size * MARGIN);
  const inner = size - inset * 2;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const ax = Math.floor(((x - inset) * N) / inner), ay = Math.floor(((y - inset) * N) / inner);
      const [r, g, b, a] = ax < 0 || ay < 0 || ax >= N || ay >= N ? [0, 0, 0, 0] : rgbaAt(ax, ay);
      raw.set([r, g, b, a], row + 1 + x * 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const out = process.argv[2];
if (!out || !out.endsWith(".iconset")) throw new Error("usage: make-icon.mjs <out.iconset>");
for (const row of ART) if (row.length !== N) throw new Error(`art row is ${row.length} wide, not ${N}: ${row}`);
if (ART.length !== N) throw new Error(`art is ${ART.length} rows, not ${N}`);
fs.mkdirSync(out, { recursive: true });
for (const base of [16, 32, 128, 256, 512]) {
  fs.writeFileSync(path.join(out, `icon_${base}x${base}.png`), png(base));
  fs.writeFileSync(path.join(out, `icon_${base}x${base}@2x.png`), png(base * 2));
}
console.log(`wrote ${out}`);
