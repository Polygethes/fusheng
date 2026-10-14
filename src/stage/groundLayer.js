// What the weather has left on the ground, drawn over the outdoor map under
// the people: floodwater spreading tile by tile from the stream, puddles and
// mud on the paths, snow over everything out of doors, cracks in dry earth.
// Only open ground is drawn on (never water, roofs or indoor floors); every
// rectangle is in whole map pixels, placed by fixed seeds, the same at the
// same moment.
const T = 16;
const GROUND = new Set(["grass", "hill", "meadow", "stone", "dirt", "path", "herbs"]);
const TRODDEN = new Set(["dirt", "path", "stone"]);
const EARTH = new Set(["dirt", "path", "meadow", "grass", "herbs", "hill"]);
const SNOW_ALPHA = { dusting: 0.22, ankle: 0.48, deep: 0.72 };

/** The environment at frames[cursor]: the last frame carrying one at or before it, else the opening one. */
let lastAsked = null;
export function environmentAt(frames = [], cursor = -1, initial = null) {
  if (lastAsked && lastAsked.frames === frames && lastAsked.length === frames.length && lastAsked.cursor === cursor && lastAsked.initial === initial) return lastAsked.result;
  let result = initial || null;
  for (let i = Math.min(cursor, frames.length - 1); i >= 0; i -= 1) if (frames[i]?.environment) { result = frames[i].environment; break; }
  lastAsked = { frames, length: frames.length, cursor, initial, result };
  return result;
}

function seed(i, salt) {
  let x = Math.imul(i + 1, 374761393) ^ Math.imul(salt + 1, 668265263);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** `rect` is the outdoor map's rectangle in tiles ([x, y, w, h]); only tiles inside it are drawn on. */
export function createGroundLayer(layout = {}, rect = null) {
  const [mx, my, mw, mh] = rect || [0, 0, layout.grid?.cols || 0, layout.grid?.rows || 0];
  const inMap = (x, y) => x >= mx && y >= my && x < mx + mw && y < my + mh;
  const material = new Map();
  for (const floor of layout.floors || []) {
    const [x0, y0, w, h] = floor.rect;
    for (let x = x0; x < x0 + w; x += 1) for (let y = y0; y < y0 + h; y += 1) if (inMap(x, y)) material.set(`${x},${y}`, floor.material);
  }
  const roofed = new Set();
  for (const roof of layout.roofs || []) {
    const [x0, y0, w, h] = roof.rect;
    for (let x = x0; x < x0 + w; x += 1) for (let y = y0; y < y0 + h; y += 1) roofed.add(`${x},${y}`);
  }
  const water = [...material].filter(([, kind]) => kind === "water").map(([key]) => key.split(",").map(Number));
  const tiles = [...material].filter(([key, kind]) => GROUND.has(kind) && !roofed.has(key)).map(([key, kind], index) => {
    const [x, y] = key.split(",").map(Number);
    const reach = water.length ? Math.min(...water.map(([wx, wy]) => Math.max(Math.abs(wx - x), Math.abs(wy - y)))) : Infinity;
    return { x, y, kind, index, reach };
  });

  function draw(ctx, view, environment, t) {
    if (!environment?.stages) return;
    const left = Math.ceil(view[0]), top = Math.ceil(view[1]), right = Math.floor(view[0] + view[2]), bottom = Math.floor(view[1] + view[3]);
    const rect = (style, x, y, w, h) => {
      const x0 = Math.max(left, Math.round(x)), y0 = Math.max(top, Math.round(y));
      const x1 = Math.min(right, Math.round(x) + w), y1 = Math.min(bottom, Math.round(y) + h);
      if (x1 <= x0 || y1 <= y0) return;
      ctx.fillStyle = style;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    };
    const { stages, floodRadius = -1 } = environment;
    const visible = tiles.filter(({ x, y }) => (x + 1) * T > left && x * T < right && (y + 1) * T > top && y * T < bottom);
    for (const tile of visible) {
      const px = tile.x * T, py = tile.y * T;
      if (tile.reach <= floodRadius) {
        rect("rgba(62, 98, 128, 0.8)", px, py, T, T);
        const drift = Math.floor((t * (4 + 4 * seed(tile.index, 3)) + seed(tile.index, 4) * T) % 12);
        rect("rgba(170, 200, 225, 0.6)", px + drift, py + 3 + Math.floor(seed(tile.index, 5) * 10), 4, 1);
        continue;
      }
      if (SNOW_ALPHA[stages.snow]) {
        rect(`rgba(240, 244, 250, ${SNOW_ALPHA[stages.snow]})`, px, py, T, T);
        if (seed(tile.index, 6) < 0.3) rect("rgba(255, 255, 255, 0.9)", px + Math.floor(seed(tile.index, 7) * 14), py + Math.floor(seed(tile.index, 8) * 14), 2, 1);
        continue;
      }
      if (TRODDEN.has(tile.kind)) {
        if (stages.ground === "muddy" && seed(tile.index, 9) < 0.2) rect("rgba(60, 42, 28, 0.35)", px + Math.floor(seed(tile.index, 10) * 12), py + Math.floor(seed(tile.index, 11) * 14), 3, 1);
        const puddle = stages.ground === "waterlogged" ? [0.34, 7, 3] : stages.ground === "puddles" ? [0.17, 5, 2] : null;
        if (puddle && seed(tile.index, 12) < puddle[0]) {
          const [, w, h] = puddle, x = px + Math.floor(seed(tile.index, 13) * (T - w)), y = py + Math.floor(seed(tile.index, 14) * (T - h));
          rect("rgba(70, 104, 134, 0.75)", x, y, w, h);
          rect("rgba(180, 205, 228, 0.7)", x + 1, y, 2, 1);
        }
      }
      if (EARTH.has(tile.kind) && (stages.dryness === "dry" || stages.dryness === "parched")) {
        if (stages.dryness === "parched") rect("rgba(200, 170, 90, 0.18)", px, py, T, T);
        const cracks = stages.dryness === "parched" ? 2 : 1;
        for (let k = 0; k < cracks; k += 1) {
          if (seed(tile.index, 15 + k) >= 0.25) continue;
          const x = px + Math.floor(seed(tile.index, 17 + k) * 10), y = py + Math.floor(seed(tile.index, 19 + k) * 12);
          rect("rgba(90, 64, 34, 0.5)", x, y, 3, 1);
          rect("rgba(90, 64, 34, 0.5)", x + 3, y + 1, 1, 2);
          rect("rgba(90, 64, 34, 0.5)", x + 4, y + 3, 3, 1);
        }
      }
    }
  }
  return { draw, tiles };
}
