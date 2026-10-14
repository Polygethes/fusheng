// Pixel drawing primitives shared by the stage observer.
export const O = "#1b1420";
export const T = 16;

export function rng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(text = "") {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function R(c, x, y, w, h, col) { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
export function D(c, x, y, col) { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), 1, 1); }
export function circ(c, cx, cy, r, col) {
  c.fillStyle = col;
  for (let dy = -r; dy <= r; dy++) { const w = Math.floor(Math.sqrt(r * r - dy * dy)); c.fillRect(Math.round(cx - w), Math.round(cy + dy), w * 2 + 1, 1); }
}
export function oval(c, cx, cy, rx, ry, col) {
  c.fillStyle = col;
  for (let dy = -ry; dy <= ry; dy++) { const w = Math.floor(rx * Math.sqrt(1 - (dy * dy) / (ry * ry || 1))); c.fillRect(Math.round(cx - w), Math.round(cy + dy), w * 2 + 1, 1); }
}

export function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.imageSmoothingEnabled = false; return [c, x]; }

function channels(hex) { const v = parseInt(String(hex).slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
/** Lighten (amount > 0) or darken (amount < 0) a #rrggbb colour. */
export function shade(hex, amount) {
  const [r, g, b] = channels(hex);
  const f = (v) => Math.max(0, Math.min(255, Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount))));
  return `#${[f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// Bitmap-looking text: the 9px pixel font is thresholded to hard edges.
const textCache = new Map();
const [tc, tx] = canvas(640, 16);
export function textSprite(str, col, out) {
  const key = `${str}|${col}|${out}`;
  if (textCache.has(key)) return textCache.get(key);
  tx.clearRect(0, 0, 640, 16);
  tx.font = "9px Boutique, 'PingFang SC', monospace";
  tx.textBaseline = "top";
  tx.fillStyle = "#fff";
  tx.fillText(str, 1, 1);
  const w = Math.min(636, Math.ceil(tx.measureText(str).width) + 2), h = 12;
  const id = tx.getImageData(0, 0, w + 1, h + 1).data;
  const [s, sc] = canvas(w + 2, h + 2);
  const on = (x, y) => x >= 0 && y >= 0 && x <= w && y <= h && id[(y * (w + 1) + x) * 4 + 3] > 110;
  if (out) {
    sc.fillStyle = out;
    for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) if (on(x, y)) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1]]) if (!on(x + dx, y + dy)) sc.fillRect(x + dx + 1, y + dy + 1, 1, 1);
    }
  }
  sc.fillStyle = col;
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) if (on(x, y)) sc.fillRect(x + 1, y + 1, 1, 1);
  textCache.set(key, s);
  return s;
}
export function text(c, str, x, y, col, out = null, align = "l") {
  const s = textSprite(str, col, out);
  const xx = align === "c" ? x - (s.width >> 1) : align === "r" ? x - s.width : x;
  c.drawImage(s, Math.round(xx), Math.round(y));
  return s.width;
}
export function clearTextCache() { textCache.clear(); }
