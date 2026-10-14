// Crisp words over the pixel stage. The scene is painted at low resolution and
// scaled up, which smears small Chinese glyphs; labels are drawn here at the
// screen's real resolution in the 12px pixel font, each font pixel a whole
// number of screen pixels, and nudged apart so a bubble never sits on an icon
// or on another bubble.
import { O } from "./pixel.js";

// The browser draws canvas text with soft edges (macOS thickens glyphs), so
// each line is drawn once at the font's own 12px, cut to hard pixels, and
// scaled up by a whole number.
const FONT = `12px "Fusion Pixel 12", "PingFang SC", monospace`;
const BASELINE = 11; // a Chinese glyph's ink sits on sprite rows 1–11
const SPRITE_HEIGHT = 16; // room for an outline and for g / y below the line
const scratch = document.createElement("canvas");
scratch.width = 1024;
scratch.height = SPRITE_HEIGHT;
const sx = scratch.getContext("2d", { willReadFrequently: true });
const sprites = new Map();
document.fonts?.addEventListener?.("loadingdone", () => sprites.clear()); // drop lines drawn in a fallback font

const rgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

function textWidth(text) {
  sx.font = FONT;
  return Math.ceil(sx.measureText(text).width);
}

function lineSprite(text, ink, outline) {
  const key = `${text}|${ink}|${outline || ""}`;
  if (sprites.has(key)) return sprites.get(key);
  if (sprites.size > 600) sprites.clear(); // typed speech makes a new line every letter
  const w = Math.min(scratch.width, textWidth(text) + 2);
  sx.clearRect(0, 0, scratch.width, SPRITE_HEIGHT);
  sx.textBaseline = "alphabetic";
  sx.fillStyle = "#fff";
  sx.fillText(text, 1, BASELINE);
  const alpha = sx.getImageData(0, 0, w, SPRITE_HEIGHT).data;
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < SPRITE_HEIGHT && alpha[(y * w + x) * 4 + 3] > 200;
  const sprite = document.createElement("canvas");
  sprite.width = w;
  sprite.height = SPRITE_HEIGHT;
  const pixels = new ImageData(w, SPRITE_HEIGHT);
  const paint = (x, y, [r, g, b]) => { const at = (y * w + x) * 4; pixels.data.set([r, g, b, 255], at); };
  if (outline) {
    const edge = rgb(outline);
    for (let y = 0; y < SPRITE_HEIGHT; y++) for (let x = 0; x < w; x++) {
      if (!on(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1], [-1, -1]].some(([dx, dy]) => on(x + dx, y + dy))) paint(x, y, edge);
    }
  }
  const fill = rgb(ink);
  for (let y = 0; y < SPRITE_HEIGHT; y++) for (let x = 0; x < w; x++) if (on(x, y)) paint(x, y, fill);
  sprite.getContext("2d").putImageData(pixels, 0, 0);
  sprites.set(key, sprite);
  return sprite;
}

const STYLE = {
  speech: { fill: "#f4e6c8", shade: "#d8c4a0", ink: "#2b1d1a" },
  gesture: { fill: "rgba(22,16,30,0.86)", ink: "#d8d0e8" },
  fail: { fill: "#5a1616", ink: "#ffd0c0" },
  pop: { ink: "#e8c160", outline: true },
  name: { ink: "#e8dcc8", outline: true },
  nameSelected: { ink: "#e8c160", outline: true },
};

export function createLabelLayer(stage) {
  const layer = document.createElement("canvas");
  layer.className = "stage-labels";
  layer.setAttribute("aria-hidden", "true");
  stage.insertAdjacentElement("afterend", layer);
  const ctx = layer.getContext("2d");
  let scale = 1, unit = 3;

  function fit(sceneWidth) {
    const dpr = window.devicePixelRatio || 1;
    const width = stage.clientWidth, height = stage.clientHeight;
    scale = (width / Math.max(1, sceneWidth)) * dpr;
    // One font pixel on screen: 3 on Retina, where a label is 18px tall.
    unit = Math.max(1, Math.round(1.5 * dpr));
    layer.style.left = `${stage.offsetLeft}px`;
    layer.style.top = `${stage.offsetTop}px`;
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
    layer.width = Math.round(width * dpr);
    layer.height = Math.round(height * dpr);
  }

  const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

  // Speech wraps to a bubble of at most four lines; when a long line is still
  // being typed, the bubble shows its latest four lines so every word appears.
  // Widths are in font pixels.
  function wrap(text, maxWidth) {
    const lines = [];
    let line = "";
    for (const ch of text) {
      if (line && textWidth(line + ch) > maxWidth) { lines.push(line); line = ""; }
      line += ch;
    }
    if (line) lines.push(line);
    if (lines.length <= 4) return lines;
    const tail = lines.slice(-4);
    tail[0] = `…${tail[0].slice(1)}`;
    return tail;
  }

  function measure(label) {
    const u = unit, style = STYLE[label.kind] || STYLE.gesture;
    const lines = label.kind === "speech" ? wrap(label.text, Math.min(layer.width * 0.42 / u, textWidth("一".repeat(15)))) : [label.text];
    const width = Math.max(...lines.map(textWidth)) * u;
    const padX = style.fill ? 4 * u : u, padY = style.fill ? 2 * u : 0;
    const lineHeight = 13 * u;
    const w = width + padX * 2, h = lineHeight * lines.length - 2 * u + padY * 2;
    const tail = label.kind === "speech" ? 3 * u : u;
    const cx = Math.round(label.x * scale), ay = Math.round(label.y * scale);
    const x = Math.max(u, Math.min(layer.width - w - u, Math.round(cx - w / 2)));
    const y = label.below ? ay : ay - h - tail;
    return { label, style, cx, x, y, w, h, tail, padX, padY, lines, lineHeight };
  }

  function place(box, placed) {
    for (let tries = 0; tries < 16; tries++) {
      const rect = [box.x - unit, box.y - unit, box.w + unit * 2, box.h + unit * 2];
      const hit = placed.find((other) => overlaps(rect, other));
      if (!hit) break;
      box.y = box.label.below ? hit[1] + hit[3] + unit : hit[1] - box.h - unit * 2;
    }
    box.y = Math.max(unit, Math.min(layer.height - box.h - unit, box.y));
    placed.push([box.x - unit, box.y - unit, box.w + unit * 2, box.h + unit * 2]);
  }

  function drawBox(box) {
    const u = unit, { style, x, y, w, h } = box;
    if (style.fill) {
      ctx.fillStyle = O;
      ctx.fillRect(x - u, y, w + 2 * u, h);
      ctx.fillRect(x, y - u, w, h + 2 * u);
      ctx.fillStyle = style.fill;
      ctx.fillRect(x, y, w, h);
      if (style.shade) { ctx.fillStyle = style.shade; ctx.fillRect(x, y + h - u, w, u); }
      if (box.label.kind === "speech") {
        const tx = Math.max(x + 2 * u, Math.min(x + w - 3 * u, box.cx));
        ctx.fillStyle = O;
        ctx.fillRect(tx - 2 * u, y + h, 5 * u, u);
        ctx.fillRect(tx - u, y + h + u, 3 * u, u);
        ctx.fillRect(tx, y + h + 2 * u, u, u);
        ctx.fillStyle = style.shade;
        ctx.fillRect(tx - u, y + h, 3 * u, u);
      }
    }
    const tx = x + box.padX;
    box.lines.forEach((line, index) => {
      // Sprite row 1 is the top of the ink, so the sprite starts one font pixel higher.
      const ty = y + box.padY + index * box.lineHeight - u;
      const sprite = lineSprite(line, style.ink, style.outline ? O : null);
      ctx.drawImage(sprite, tx - u, ty, sprite.width * u, sprite.height * u);
    });
  }

  function draw(labels = [], avoid = []) {
    ctx.clearRect(0, 0, layer.width, layer.height);
    ctx.imageSmoothingEnabled = false;
    const placed = avoid.map(([x, y, w, h]) => [Math.round(x * scale), Math.round(y * scale), Math.round(w * scale), Math.round(h * scale)]);
    const boxes = [...labels].filter((row) => row.text).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9)).map(measure);
    for (const box of boxes) place(box, placed);
    for (const box of boxes.reverse()) drawBox(box);
  }

  return { fit, draw, element: layer };
}
