// Static scene layer built from a world pack's pixel layout: floors, walls,
// doors and furniture. Animated pieces (fire, water, flags, goose, canopies)
// are returned separately for the per-frame pass.
import { O, T, R, D, circ, oval, rng, canvas, text } from "./pixel.js";
import { walkableTiles, doorOnEdge } from "../worlds/layoutGeometry.mjs";

export const P = {
  fl0: "#4a2c1e", fl1: "#6e4430", fl2: "#835437", fl3: "#986442", flH: "#b07a4e",
  pl0: "#a8927a", pl1: "#cdb894", pl2: "#e2d1aa", b0: "#2c1c18", b1: "#4c3024", b2: "#6c4634", b3: "#8a5c42",
  rf0: "#262633", rf1: "#3a3b4c", rf2: "#555a70", rf3: "#727a92",
  st0: "#45414b", st1: "#5f5a66", st2: "#78737f", st3: "#948e9a",
  d0: "#5a4636", d1: "#6c5642", d2: "#7d654d", d3: "#90775c",
  g0: "#2a4a30", g1: "#386339", g2: "#4d8044", g3: "#6ba052", g4: "#8cc070",
  br0: "#4e2622", br1: "#713629", br2: "#8f4a37",
  f0: "#fff4b0", f1: "#ffd060", f2: "#ff9030", f3: "#d84a2a",
  w0: "#1f3b54", w1: "#2f5a7a", w2: "#4f88aa", w3: "#8ec2d8",
  r0: "#6a1a22", r1: "#a8322e", r2: "#d65a44", gold: "#e8c160", gold2: "#b08a38",
};

const px = (v) => Math.round(v * T);

// ── floors ────────────────────────────────────────────────────────────────
function woodFloor(g, x0, y0, w, h, r) {
  for (let y = y0; y < y0 + h; y += 4) {
    let x = x0 - Math.floor(r() * 24);
    while (x < x0 + w) {
      const len = 20 + Math.floor(r() * 22), col = [P.fl2, P.fl2, P.fl3, P.fl1][Math.floor(r() * 4)];
      const xa = Math.max(x, x0), xb = Math.min(x + len, x0 + w);
      if (xb > xa) {
        R(g, xa, y, xb - xa, 3, col); R(g, xa, y + 3, xb - xa, 1, P.fl0);
        if (r() < 0.5) R(g, xa, y, xb - xa, 1, col === P.fl1 ? P.fl2 : P.flH);
        for (let i = 0; i < 3; i++) { const gx = xa + Math.floor(r() * (xb - xa)), gl = 2 + Math.floor(r() * 4); R(g, gx, y + 1 + Math.floor(r() * 2), Math.min(gl, xb - gx), 1, P.fl1); }
        if (r() < 0.15) D(g, xa + Math.floor(r() * (xb - xa)), y + 1, P.fl0);
        if (x + len < x0 + w) R(g, x + len, y, 1, 3, P.fl0);
      }
      x += len + 1;
    }
  }
}
function noise(g, x0, y0, w, h, r, cols, weights) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const v = r(); let acc = 0, i = 0;
    for (; i < weights.length; i++) { acc += weights[i]; if (v < acc) break; }
    D(g, x, y, cols[Math.min(i, cols.length - 1)]);
  }
}
function tufts(g, x0, y0, w, h, r, density, flowers) {
  for (let i = 0; i < (w * h) / density; i++) { const tx = x0 + Math.floor(r() * w), ty = y0 + Math.floor(r() * h); D(g, tx, ty, P.g3); D(g, tx - 1, ty + 1, P.g2); D(g, tx + 1, ty + 1, P.g2); }
  for (let i = 0; i < (w * h) / flowers; i++) { const fx = x0 + Math.floor(r() * w), fy = y0 + Math.floor(r() * h); D(g, fx, fy, ["#e8d070", "#e07a8a", "#f0f0f0", "#a8a0e8"][Math.floor(r() * 4)]); D(g, fx, fy + 1, P.g0); }
}
const FLOORS = {
  wood: woodFloor,
  earth(g, x, y, w, h, r) { noise(g, x, y, w, h, r, ["#5c4a3a", "#6a5644", "#76604c", "#4e3e30"], [0.3, 0.4, 0.2, 0.1]); for (let yy = y + 7; yy < y + h; yy += 16) R(g, x, yy, w, 1, "#54432f"); },
  dirt(g, x, y, w, h, r) { noise(g, x, y, w, h, r, [P.d0, P.d3, P.d1, P.d2], [0.06, 0.06, 0.38, 0.5]); for (let i = 0; i < (w * h) / 90; i++) { const sx = x + Math.floor(r() * w), sy = y + Math.floor(r() * h); D(g, sx, sy, P.st2); D(g, sx + 1, sy, P.st1); } },
  stone(g, x0, y0, w, h, r) {
    for (let y = y0; y < y0 + h; y += 8) for (let x = x0 - ((y - y0) / 8 % 2 ? 4 : 0); x < x0 + w; x += 8) {
      const xa = Math.max(x, x0), xb = Math.min(x + 8, x0 + w);
      R(g, xa, y, xb - xa, 8, P.st0); R(g, xa + 1, y + 1, xb - xa - 1, 6, [P.st1, P.st2][Math.floor(r() * 2)]); R(g, xa + 1, y + 1, Math.max(0, xb - xa - 2), 1, P.st3);
    }
  },
  grass(g, x, y, w, h, r) { noise(g, x, y, w, h, r, [P.g0, P.g1, P.g2], [0.25, 0.5, 0.25]); tufts(g, x, y, w, h, r, 40, 260); },
  meadow(g, x, y, w, h, r) { noise(g, x, y, w, h, r, [P.g1, P.g2, P.g3], [0.3, 0.5, 0.2]); tufts(g, x, y, w, h, r, 30, 90); },
  hill(g, x, y, w, h, r) {
    noise(g, x, y, w, h, r, [P.g0, P.g1, "#47704a"], [0.35, 0.45, 0.2]); tufts(g, x, y, w, h, r, 50, 400);
    for (let i = 0; i < (w * h) / 220; i++) { const sx = x + Math.floor(r() * w), sy = y + Math.floor(r() * h); oval(g, sx, sy, 3, 2, O); oval(g, sx, sy, 2, 1, P.st2); D(g, sx - 1, sy - 1, P.st3); }
  },
  path(g, x, y, w, h, r) { noise(g, x, y, w, h, r, ["#8a7458", "#9c8664", "#7a6650", "#a89070"], [0.35, 0.35, 0.15, 0.15]); for (let i = 0; i < (w * h) / 70; i++) D(g, x + Math.floor(r() * w), y + Math.floor(r() * h), P.st1); },
  water(g, x, y, w, h, r) { noise(g, x, y, w, h, r, [P.w1, P.w0, P.w2], [0.6, 0.25, 0.15]); R(g, x, y, w, 1, "#6a8a6a"); R(g, x, y + h - 1, w, 1, "#2a4a3a"); },
  herbs(g, x, y, w, h, r) {
    noise(g, x, y, w, h, r, ["#4a3828", "#3e2e20"], [0.6, 0.4]);
    for (let yy = y + 3; yy < y + h; yy += 6) for (let xx = x + 2; xx < x + w - 1; xx += 4) { D(g, xx, yy, P.g3); D(g, xx - 1, yy + 1, P.g2); D(g, xx + 1, yy + 1, P.g2); D(g, xx, yy + 1, P.g1); if (r() < 0.3) D(g, xx, yy - 1, "#c8e0a0"); }
  },
};

// ── walls ─────────────────────────────────────────────────────────────────
function plaster(g, x, y, w, h, r) { R(g, x, y, w, h, P.pl1); for (let i = 0; i < (w * h) / 14; i++) D(g, x + Math.floor(r() * w), y + Math.floor(r() * h), r() < 0.5 ? P.pl0 : P.pl2); }
function post(g, x, y, h) { R(g, x, y, 4, h, P.b1); R(g, x, y, 1, h, P.b2); R(g, x + 3, y, 1, h, P.b0); }
const WALLS = {
  "interior-back"(g, x, y, w, h, r, wall) {
    R(g, x, y, w, 8, P.b0); for (let xx = x; xx < x + w; xx += 6) R(g, xx, y + 2, 4, 1, "#3a2620"); R(g, x, y + 7, w, 1, P.b2);
    plaster(g, x, y + 8, w, h - 8, r); R(g, x, y + 8, w, 4, P.b1); R(g, x, y + 8, w, 1, P.b2); R(g, x, y + 11, w, 1, P.b0);
    R(g, x, y + h - 12, w, 12, P.b1); R(g, x, y + h - 12, w, 1, P.b3); for (let xx = x + 2; xx < x + w; xx += 7) R(g, xx, y + h - 11, 1, 11, P.b0); R(g, x, y + h - 1, w, 1, "#1e1214");
    for (const p of wall.posts || []) post(g, px(p), y + 8, h - 8);
  },
  top(g, x, y, w, h, r, wall) {
    R(g, x, y, w, h, P.b0); for (let yy = y; yy < y + h; yy += 4) R(g, x, yy, w, 1, "#25171a");
    if (wall.edge === "r") R(g, x + w - 2, y, 2, h, P.b2); else if (wall.edge === "l") R(g, x, y, 2, h, P.b2);
    else if (wall.edge === "t") R(g, x, y, w, 2, P.b2); else { R(g, x, y, w, 1, P.b2); R(g, x, y + h - 1, w, 1, P.b1); }
  },
  partition(g, x, y, w, h) {
    if (h > w) { R(g, x + 5, y - 4, 6, h + 4, P.b0); R(g, x + 5, y - 4, 1, h + 4, P.b2); R(g, x + 10, y - 4, 1, h + 4, P.b1); }
    else { R(g, x, y + 2, w, 4, P.b0); R(g, x, y + 2, w, 1, P.b2); R(g, x, y + 6, w, 8, P.pl1); R(g, x, y + 6, w, 1, P.pl2); R(g, x, y + 12, w, 2, P.b1); R(g, x, y + 14, w, 1, "#1e1214"); }
  },
  "courtyard-wall"(g, x, y, w, h, r) {
    for (let xx = x; xx < x + w; xx += 6) for (let yy = y; yy < y + 14; yy += 4) { const off = ((yy - y) / 4) % 2 ? 3 : 0; R(g, xx + off, yy, 6, 4, P.rf1); R(g, xx + off, yy, 6, 1, P.rf3); R(g, xx + off + 5, yy, 1, 4, P.rf0); D(g, xx + off + 2, yy + 1, P.rf2); }
    R(g, x, y + 14, w, 2, P.rf0); plaster(g, x, y + 16, w, h - 16, r); R(g, x, y + h - 4, w, 4, P.st1); R(g, x, y + h - 4, w, 1, P.st2);
  },
  "fence-bamboo"(g, x, y, w, h) { for (let xx = x; xx < x + w; xx += 4) { R(g, xx, y, 3, h, "#5a8a3a"); R(g, xx, y, 1, h, "#86b05a"); for (let yy = y + 8; yy < y + h; yy += 14) R(g, xx, yy, 3, 1, "#3a5a28"); } R(g, x, y + 28, w, 2, "#3a2a1a"); R(g, x, y + h - 30, w, 2, "#3a2a1a"); },
  "fence-wood"(g, x, y, w, h) {
    const vertical = h > w;
    if (vertical) { R(g, x + 6, y, 1, h, "#5a3e28"); R(g, x + 9, y, 1, h, "#5a3e28"); for (let yy = y + 1; yy < y + h; yy += 6) { R(g, x + 5, yy, 6, 5, "#6a4a30"); R(g, x + 5, yy, 6, 1, "#b08a5c"); R(g, x + 5, yy, 1, 5, "#8a6440"); } }
    else { R(g, x, y + 7, w, 2, "#5a3e28"); R(g, x, y + 11, w, 2, "#5a3e28"); for (let xx = x; xx < x + w; xx += 4) { R(g, xx, y + 3, 3, 12, O); R(g, xx, y + 4, 2, 10, "#8a6440"); D(g, xx, y + 4, "#b08a5c"); } }
  },
};

// ── doors ─────────────────────────────────────────────────────────────────
const DOORS = {
  "opening"(g, [cx, cy]) { /* interior opening between rooms: nothing drawn on floor */ },
  door(g, [cx, cy]) { const x = cx * T, y = cy * T; R(g, x, y, 16, 16, P.fl1); R(g, x, y, 16, 2, P.b1); R(g, x - 1, y - 2, 3, 18, P.b1); R(g, x + 14, y - 2, 3, 18, P.b1); R(g, x + 2, y + 2, 4, 13, "#7a4c30"); R(g, x + 2, y + 2, 1, 13, "#9a6440"); },
  curtain(g, [cx, cy]) { const x = cx * T, y = cy * T; R(g, x, y - 2, 16, 2, P.b1); for (let i = 0; i < 16; i += 2) R(g, x + i, y, 2, 9 + (i % 4 ? 1 : 0), i % 4 ? "#3e5a8a" : "#4e6a9a"); R(g, x, y + 3, 16, 1, "#e8e0d0"); },
  gate(g, [cx, cy]) { const x = cx * T, y = cy * T; R(g, x + 5, y - 3, 6, 4, O); R(g, x + 6, y - 2, 4, 2, "#8a6440"); R(g, x + 1, y + 2, 3, 12, "#8a6440"); R(g, x + 1, y + 2, 1, 12, "#b08a5c"); },
  "path-up"(g, [cx, cy]) { const x = cx * T, y = cy * T; for (let i = 0; i < 4; i++) { R(g, x + 1, y + i * 4, 14, 3, P.st2); R(g, x + 1, y + i * 4, 14, 1, P.st3); R(g, x + 1, y + i * 4 + 3, 14, 1, P.st0); } },
};

// ── props ─────────────────────────────────────────────────────────────────
function table(g, x, y, w) { R(g, x + 1, y + 12, w - 2, 3, "rgba(10,6,12,.45)"); R(g, x, y + 2, w, 8, O); R(g, x + 1, y + 3, w - 2, 6, P.b3); R(g, x + 1, y + 3, w - 2, 1, "#a87452"); R(g, x + 1, y + 9, w - 2, 3, P.b1); R(g, x, y + 9, 1, 4, O); R(g, x + w - 1, y + 9, 1, 4, O); R(g, x + 2, y + 12, 2, 3, P.b0); R(g, x + w - 4, y + 12, 2, 3, P.b0); }
function bench(g, x, y, w) { R(g, x, y, w, 4, O); R(g, x + 1, y + 1, w - 2, 2, P.b2); R(g, x + 1, y + 1, w - 2, 1, P.b3); R(g, x + 2, y + 4, 1, 2, P.b0); R(g, x + w - 3, y + 4, 1, 2, P.b0); }
function teaset(g, x, y) { oval(g, x + 2, y + 2, 2, 2, O); oval(g, x + 2, y + 2, 1, 1, "#6a86a0"); D(g, x + 1, y + 1, "#a8c4d8"); R(g, x + 5, y + 2, 2, 2, O); D(g, x + 5, y + 2, "#d8d0c0"); R(g, x + 8, y + 3, 2, 2, O); D(g, x + 8, y + 3, "#d8d0c0"); }
function jar(g, x, y, big) { const w = big ? 7 : 5, h = big ? 9 : 7; R(g, x, y + 1, w, h, O); R(g, x + 1, y + 1, w - 2, h - 1, "#5c4130"); R(g, x + 1, y + 2, 1, h - 3, "#7a5840"); R(g, x + 1, y, w - 2, 1, O); R(g, x + 2, y + 1, w - 4, 1, "#3e2c22"); R(g, x + 1, y + Math.floor(h / 2), w - 2, 2, P.r1); D(g, x + Math.floor(w / 2), y + Math.floor(h / 2), P.gold); }
export function lanternSprite(g, x, y) { R(g, x - 1, y - 6, 1, 4, O); R(g, x - 3, y - 2, 7, 9, O); R(g, x - 2, y - 1, 5, 7, P.r2); R(g, x - 2, y - 1, 1, 7, P.r1); R(g, x - 2, y + 2, 5, 1, P.r1); R(g, x - 2, y - 2, 5, 1, P.gold); R(g, x - 2, y + 6, 5, 1, P.gold); D(g, x, y + 8, P.gold); D(g, x, y + 9, P.r1); }

const PROPS = {
  stairwell(g, x, y, w, h, r, prop) { R(g, x, y, w, h, "#110d16"); R(g, x, y, w, 2, "#000"); for (let i = 0; i < 5; i++) R(g, x + 4 + i * 9, y + 4, 2, h - 4, "#1d1622"); if (prop.label) { R(g, x + 6, y + 2, w - 12, 12, O); R(g, x + 7, y + 3, w - 14, 10, "#2a2032"); text(g, prop.label, x + w / 2, y + 2, "#8f80a2", null, "c"); } },
  stairs(g, x, y, w, h) { const steps = Math.round(h / 8); for (let i = 0; i < steps; i++) { const yy = y + h - 8 - i * 8; R(g, x + 2, yy, w - 4, 6, P.fl3); R(g, x + 2, yy, w - 4, 1, P.flH); R(g, x + 2, yy + 6, w - 4, 2, P.fl0); R(g, x + 2, yy, w - 4, 8, `rgba(10,6,16,${i * 0.11})`); } R(g, x, y + 8, 3, h - 8, P.b1); R(g, x, y + 8, 1, h - 8, P.b2); R(g, x + w - 3, y + 8, 3, h - 8, P.b1); },
  scroll(g, x, y) { R(g, x, y, 15, 24, O); R(g, x + 1, y + 1, 13, 2, "#3a2418"); R(g, x + 2, y + 3, 11, 18, "#e8dcc0"); R(g, x + 1, y + 21, 13, 2, "#3a2418"); for (let i = 0; i < 5; i++) R(g, x + 3 + i, y + 16 - i, 1, i + 1, "#6a6a7a"); for (let i = 0; i < 4; i++) R(g, x + 8 + i, y + 17 - i, 1, i + 1, "#4a4a5a"); D(g, x + 10, y + 6, P.r1); },
  window(g, x, y, w, h) { R(g, x, y, w, h, O); R(g, x + 2, y + 2, w - 4, h - 4, "#1e2740"); for (let xx = x + 2; xx < x + w - 2; xx += 5) R(g, xx, y + 2, 1, h - 4, P.b1); for (let yy = y + 2; yy < y + h - 2; yy += 5) R(g, x + 2, yy, w - 4, 1, P.b1); R(g, x - 2, y + h, w + 4, 2, P.b2); R(g, x - 2, y + h + 2, w + 4, 1, P.b0); },
  lantern(g, x, y) { lanternSprite(g, x, y); },
  "hanging-lantern"(g, x, y) { lanternSprite(g, x, y); },
  banner(g, x, y, w, h, r, prop) { R(g, x, y, 15, 26, O); R(g, x + 1, y + 1, 13, 23, P.r1); R(g, x + 1, y + 1, 2, 23, P.r0); R(g, x + 1, y + 1, 13, 1, P.gold); for (let xx = x + 1; xx < x + 14; xx += 2) { D(g, xx, y + 24, P.r1); D(g, xx + 1, y + 25, P.r1); } if (prop.text) text(g, prop.text, x + 8, y + 7, P.gold, null, "c"); },
  plant(g, x, y) { R(g, x + 2, y + 8, 9, 9, O); R(g, x + 3, y + 9, 7, 7, "#9a5a3a"); R(g, x + 3, y + 9, 7, 1, "#c07a4a"); for (const [lx, ly] of [[6, 0], [3, 3], [9, 3], [5, -3], [8, -2], [1, 0], [11, 1]]) { R(g, x + lx - 1, y + ly - 1, 4, 4, O); } for (const [lx, ly] of [[6, 0], [3, 3], [9, 3], [5, -3], [8, -2], [1, 0], [11, 1]]) { R(g, x + lx, y + ly, 2, 2, P.g2); D(g, x + lx, y + ly, P.g3); } },
  shelf(g, x, y, w) { R(g, x, y + 9, w, 3, P.b2); R(g, x, y + 9, w, 1, P.b3); R(g, x, y + 12, w, 1, P.b0); jar(g, x + 2, y); jar(g, x + 10, y); R(g, x + 20, y + 5, 6, 4, O); R(g, x + 21, y + 5, 4, 3, "#d8d0c0"); if (w > 34) jar(g, x + w - 12, y - 1, true); },
  chimney(g, x, y, w, h) { R(g, x, y, 10, h, P.br1); for (let yy = y; yy < y + h; yy += 4) { R(g, x, yy + 3, 10, 1, P.br0); D(g, x + 3 + ((yy - y) % 8 ? 2 : 0), yy + 1, P.br0); } R(g, x, y, 1, h, P.br2); },
  rug(g, x, y, w, h) { R(g, x, y, w, h, O); R(g, x + 1, y + 1, w - 2, h - 2, "#6a2630"); R(g, x + 2, y + 2, w - 4, h - 4, P.gold2); R(g, x + 3, y + 3, w - 6, h - 6, "#7e2e36"); for (let xx = x + 6; xx < x + w - 6; xx += 8) { D(g, xx + 3, y + 6, P.gold); D(g, xx + 2, y + 7, P.gold); D(g, xx + 4, y + 7, P.gold); D(g, xx + 3, y + 8, P.gold); D(g, xx + 3, y + 11, "#a8483e"); } },
  table(g, x, y, w, h, r, prop) { bench(g, x, y - 6, w); table(g, x, y, w); bench(g, x, y + 17, w); if ((prop.items || []).includes("teaset")) teaset(g, x + 9, y + 3); },
  bench(g, x, y, w) { bench(g, x, y, w); },
  counter(g, x, y, w, h, r, prop) {
    R(g, x - 1, y - 1, w + 2, 18, O); R(g, x, y, w, 7, "#8a4e34"); R(g, x, y, w, 1, "#b06a44"); R(g, x, y + 7, w, 9, "#5a3022");
    for (let xx = x; xx < x + w; xx += 16) { R(g, xx + 2, y + 9, 12, 5, "#4a2618"); R(g, xx + 2, y + 9, 12, 1, "#6a3a28"); }
    if ((prop.items || []).includes("abacus")) { R(g, x + 4, y + 1, 9, 5, O); R(g, x + 5, y + 2, 7, 3, "#3a2418"); for (let i = 0; i < 3; i++) { D(g, x + 6 + i * 2, y + 2, P.r2); D(g, x + 6 + i * 2, y + 4, P.gold); } }
    if ((prop.items || []).includes("ledger")) { R(g, x + 17, y + 1, 8, 5, O); R(g, x + 18, y + 2, 6, 3, "#efe6cc"); R(g, x + 21, y + 2, 1, 3, "#b8a888"); }
  },
  "oil-lamp"(g, x, y) { R(g, x, y, 5, 7, O); R(g, x + 1, y + 2, 3, 4, "#c0a050"); D(g, x + 2, y - 1, P.f1); D(g, x + 2, y - 2, P.f0); },
  "wine-jars"(g, x, y) { jar(g, x, y); jar(g, x + 7, y + 2); },
  stove(g, x, y, w, h) {
    const top = y + 6;
    R(g, x - 1, top - 1, w + 2, h + 2 - 6, O); R(g, x, top, w, h - 6, P.br1);
    for (let yy = top + 3; yy < top + h - 6; yy += 4) { R(g, x, yy, w, 1, P.br0); for (let xx = x + ((yy - top) % 8 ? 0 : 4); xx < x + w; xx += 8) D(g, xx, yy + 1, P.br0); }
    R(g, x, top, w, 5, "#5a3a32"); R(g, x, top, w, 1, "#7a5246");
    const holes = Math.max(1, Math.floor(w / 22));
    for (let i = 0; i < holes; i++) { const cx = x + Math.round((i + 0.5) * w / holes); oval(g, cx, top + 2, 6, 2, O); oval(g, cx, top + 2, 5, 1, "#2a2a30"); D(g, cx - 1, top + 1, "#5a5a64"); }
    R(g, x + (w >> 1) - 7, top + h - 17, 14, 10, O); R(g, x + (w >> 1) - 6, top + h - 16, 12, 9, "#160c0c");
  },
  shed(g, x, y, w, h) { R(g, x, y, w, h - 2, "#3a2a20"); for (let xx = x + 2; xx < x + w; xx += 5) R(g, xx, y + 10, 1, h - 12, "#2a1e18"); for (let xx = x; xx < x + w; xx += 6) { R(g, xx, y, 5, 9, P.rf1); R(g, xx, y, 5, 1, P.rf3); R(g, xx + 5, y, 1, 9, P.rf0); } R(g, x, y + 9, w, 2, P.rf0); R(g, x + 1, y + 11, 2, h - 13, P.b1); R(g, x + w - 3, y + 11, 2, h - 13, P.b1); },
  "chopping-block"(g, x, y) { oval(g, x + 8, y + 10, 8, 3, "rgba(10,6,12,.5)"); R(g, x, y, 17, 10, O); R(g, x + 1, y + 1, 15, 9, "#5a3a26"); for (let xx = x + 2; xx < x + 16; xx += 3) R(g, xx, y + 3, 1, 6, "#3e2618"); oval(g, x + 8, y, 8, 3, O); oval(g, x + 8, y, 7, 2, "#c8a070"); oval(g, x + 8, y, 4, 1, "#a07a48"); D(g, x + 8, y, "#7a5636"); },
  tree(g, x, y, w, h) { const tx = x + (w >> 1) - 5, ty = y + h - 26; R(g, tx, ty, 10, 26, O); R(g, tx + 1, ty, 8, 25, "#5a3e2a"); R(g, tx + 2, ty, 2, 25, "#7a5638"); oval(g, tx + 5, ty + 26, 8, 2, "rgba(10,6,12,.5)"); },
  willow(g, x, y, w, h) { const tx = x + (w >> 1) - 3, ty = y + h - 22; R(g, tx, ty, 7, 22, O); R(g, tx + 1, ty, 5, 21, "#5a4630"); R(g, tx + 2, ty, 1, 21, "#7a6040"); },
  "street-door"(g, x, y, w) { R(g, x, y, w, 16, "#121626"); R(g, x, y, w, 5, P.st2); R(g, x, y, w, 1, P.st3); R(g, x, y + 4, w, 1, P.st0); R(g, x - 4, y - 2, 4, 18, P.b1); R(g, x + w, y - 2, 4, 18, P.b1); },
  shrine(g, x, y, w) { R(g, x, y + 10, w, 12, O); R(g, x + 1, y + 11, w - 2, 4, "#7a3a2a"); R(g, x + 1, y + 11, w - 2, 1, "#9a5a3a"); R(g, x + 2, y + 15, 2, 6, "#5a2a1e"); R(g, x + w - 4, y + 15, 2, 6, "#5a2a1e"); R(g, x + (w >> 1) - 3, y + 6, 6, 5, O); R(g, x + (w >> 1) - 2, y + 7, 4, 3, "#c8a050"); D(g, x + (w >> 1), y + 4, "#d8d0c0"); D(g, x + (w >> 1), y + 2, "#a8a0a0"); },
  bed(g, x, y, w, h) { R(g, x, y, w, h, O); R(g, x + 1, y + 1, w - 2, h - 2, "#7a5a3e"); R(g, x + 2, y + 2, w - 4, h - 4, "#3e5a8a"); R(g, x + 2, y + 2, w - 4, 5, "#e8e0cc"); R(g, x + 2, y + 9, w - 4, 1, "#2e4a7a"); for (let yy = y + 12; yy < y + h - 3; yy += 4) R(g, x + 3, yy, w - 6, 1, "#4e6a9a"); },
  desk(g, x, y, w) { table(g, x, y, w); R(g, x + 3, y + 3, 5, 4, O); R(g, x + 4, y + 4, 3, 2, "#efe6cc"); D(g, x + 10, y + 4, "#2a2a30"); },
  "water-jar"(g, x, y) { R(g, x, y + 2, 11, 12, O); R(g, x + 1, y + 2, 9, 11, "#4a5a50"); R(g, x + 1, y + 3, 2, 9, "#6a8070"); oval(g, x + 5, y + 2, 5, 2, O); oval(g, x + 5, y + 2, 4, 1, P.w1); D(g, x + 4, y + 2, P.w3); },
  cabinet(g, x, y, w, h) { R(g, x, y - 8, w, h + 8, O); R(g, x + 1, y - 7, w - 2, h + 6, "#6a4a30"); for (let yy = y - 6; yy < y + h - 2; yy += 5) for (let xx = x + 2; xx < x + w - 3; xx += 5) { R(g, xx, yy, 4, 4, "#8a6440"); D(g, xx + 1, yy + 2, P.gold); } },
  sickbed(g, x, y, w, h) { R(g, x, y, w, h, O); R(g, x + 1, y + 1, w - 2, h - 2, "#8a6a4a"); R(g, x + 2, y + 2, w - 4, h - 4, "#c8b890"); R(g, x + 2, y + 2, w - 4, 4, "#e8dcc0"); },
  stool(g, x, y) { R(g, x + 3, y + 2, 9, 6, O); R(g, x + 4, y + 3, 7, 3, "#8a6440"); R(g, x + 4, y + 3, 7, 1, "#b08a5c"); R(g, x + 4, y + 6, 1, 3, P.b0); R(g, x + 10, y + 6, 1, 3, P.b0); },
  "drying-rack"(g, x, y, w) { R(g, x, y, 2, 16, "#6a4a30"); R(g, x + w - 2, y, 2, 16, "#6a4a30"); R(g, x, y + 2, w, 2, "#8a6440"); for (let xx = x + 3; xx < x + w - 3; xx += 4) { R(g, xx, y + 4, 2, 6, ["#7a9a4a", "#a0884a", "#5a8a4a"][(xx >> 2) % 3]); D(g, xx, y + 10, "#4a6a3a"); } },
  woodpile(g, x, y, w) { for (let i = 0; i < Math.floor(w / 6); i++) for (let j = 0; j < 2; j++) { circ(g, x + 4 + i * 6 + (j ? 3 : 0), y + 8 - j * 5, 3, O); circ(g, x + 4 + i * 6 + (j ? 3 : 0), y + 8 - j * 5, 2, "#c09a6a"); D(g, x + 4 + i * 6 + (j ? 3 : 0), y + 8 - j * 5, "#8a6440"); } },
  mountains(g, x, y, w, h) { const layers = [["#3a4a5e", 0.55], ["#4a5e6e", 0.35]]; layers.forEach(([col, k], li) => { for (let xx = x; xx < x + w; xx++) { const hh = Math.round(h * (k + 0.25 * Math.sin((xx + li * 37) / 9) + 0.12 * Math.sin((xx + li * 11) / 3.7))); R(g, xx, y + h - hh, 1, hh, col); } }); },
  "stone-bridge"(g, x, y, w, h) { R(g, x - 2, y - 1, w + 4, h + 2, O); R(g, x - 1, y, w + 2, h, P.st1); for (let yy = y + 2; yy < y + h; yy += 5) R(g, x - 1, yy, w + 2, 1, P.st0); R(g, x - 1, y, 2, h, P.st3); R(g, x + w - 1, y, 2, h, P.st3); for (let yy = y + 1; yy < y + h; yy += 6) { D(g, x - 2, yy, P.st3); D(g, x + w + 1, yy, P.st3); } },
  "array-flag"() {},
  goose() {},
};
const ANIMATED = new Set(["array-flag", "goose", "stove", "lantern", "hanging-lantern"]);
const CANOPY = new Set(["tree", "willow"]);

function drawCanopy(c, prop) {
  const x = px(prop.at[0]), y = px(prop.at[1]), w = px(prop.w || 2), h = px(prop.h || 3), r = rng(Math.round(x * 7 + y));
  const blob = (bx, by, rad, cols) => { circ(c, bx, by, rad + 1, O); circ(c, bx, by, rad, cols[0]); circ(c, bx - 2, by - 2, rad - 3, cols[1]); for (let i = 0; i < rad * 2; i++) { const a = r() * 6.28, d = r() * rad * 0.8; D(c, bx + Math.cos(a) * d, by + Math.sin(a) * d, r() < 0.5 ? cols[2] : cols[3]); } };
  if (prop.kind === "willow") {
    const cx = x + (w >> 1), cy = y + 10;
    blob(cx, cy, 11, ["#4a7a3a", "#6a9a4a", "#8cc070", "#2a4a30"]);
    for (let i = -12; i <= 12; i += 3) { const len = 12 + Math.round(6 * Math.abs(Math.sin(i))); for (let j = 0; j < len; j++) D(c, cx + i + Math.round(Math.sin(j / 3) * 1), cy + 4 + j, j % 3 ? "#5a8a42" : "#7aaa52"); }
    return;
  }
  const cx = x + (w >> 1), cy = y + Math.round(h * 0.4), size = Math.max(9, Math.round(w / 3.5));
  for (const [dx, dy, k] of [[-0.35, 0.1, 0.9], [0.35, 0.05, 0.85], [0, -0.25, 0.95], [0.4, 0.35, 0.7], [-0.4, 0.4, 0.65]]) blob(cx + dx * w, cy + dy * h, Math.round(size * k), [P.g1, P.g2, P.g3, P.g0]);
}

/**
 * @returns {{ bg, overlay, walkable:Set<string>, animated:Array, water:Array, width, height }}
 */
export function buildScene(layout) {
  const { cols, rows } = layout.grid;
  const width = cols * T, height = rows * T;
  const [bg, g] = canvas(width, height);
  const [overlay, o] = canvas(width, height);
  const r = rng(11);
  R(g, 0, 0, width, height, "#0e0c12");
  const water = [];
  for (const floor of layout.floors || []) {
    const [c0, r0, w, h] = floor.rect;
    (FLOORS[floor.material] || FLOORS.dirt)(g, c0 * T, r0 * T, w * T, h * T, r);
    if (floor.material === "water") water.push(floor.rect);
  }
  for (const wall of layout.walls || []) {
    const [c0, r0, w, h] = wall.rect;
    (WALLS[wall.style] || WALLS.top)(g, c0 * T, r0 * T, w * T, h * T, r, wall);
  }
  for (const door of layout.doors || []) for (const tile of door.tiles) DOORS[door.style]?.(g, tile);
  const animated = [];
  for (const prop of layout.props || []) {
    if (CANOPY.has(prop.kind)) { PROPS[prop.kind](g, px(prop.at[0]), px(prop.at[1]), px(prop.w || 2), px(prop.h || 3), r, prop); drawCanopy(o, prop); continue; }
    if (ANIMATED.has(prop.kind)) animated.push(prop);
    if (prop.kind === "stove" || prop.kind === "lantern" || prop.kind === "hanging-lantern") PROPS[prop.kind](g, px(prop.at[0]), px(prop.at[1]), px(prop.w || 1), px(prop.h || 1), r, prop);
    else if (!ANIMATED.has(prop.kind)) (PROPS[prop.kind] || (() => {}))(g, px(prop.at[0]), px(prop.at[1]), px(prop.w || 1), px(prop.h || 1), r, prop);
  }
  const roofLabels = [];
  for (const roof of layout.roofs || []) {
    const [rc, rr, rw, rh] = roof.rect;
    const rx = rc * T, ry = rr * T, w = rw * T, h = rh * T;
    // Find if there is a door on the boundary of this building
    const doorEdgeInfo = doorOnEdge(roof.rect, layout.doors);
    const wallEdge = doorEdgeInfo?.edge || null;
    const doorTile = doorEdgeInfo?.tile || null;

    // Draw roof covering the lot except the door edge row/col which is drawn as wall with door
    let roofX = rx, roofY = ry, roofW = w, roofH = h;
    if (wallEdge === "bottom") {
      roofH = h - T;
      WALLS.top(g, rx, ry + h - T, w, T, r, { edge: "b" });
      DOORS.door(g, doorTile);
    } else if (wallEdge === "top") {
      roofY = ry + T;
      roofH = h - T;
      WALLS.top(g, rx, ry, w, T, r, { edge: "t" });
      DOORS.door(g, doorTile);
    } else if (wallEdge === "left") {
      roofX = rx + T;
      roofW = w - T;
      WALLS.top(g, rx, ry, T, h, r, { edge: "l" });
      DOORS.door(g, doorTile);
    } else if (wallEdge === "right") {
      roofW = w - T;
      WALLS.top(g, rx + w - T, ry, T, h, r, { edge: "r" });
      DOORS.door(g, doorTile);
    }

    // Roof tiles: horizontal stripes of shingles with ridge
    R(g, roofX, roofY, roofW, roofH, P.rf1);
    for (let yy = roofY; yy < roofY + roofH; yy += 4) {
      const col = [P.rf0, P.rf2, P.rf1][Math.floor((yy - roofY) / 4) % 3];
      R(g, roofX, yy, roofW, 3, col);
      R(g, roofX, yy + 3, roofW, 1, P.rf0);
    }
    // Ridge on top
    R(g, roofX, roofY, roofW, 3, P.rf3);
    R(g, roofX, roofY + 3, roofW, 1, P.rf0);
    if (roof.label) roofLabels.push({ x: roofX + Math.round(roofW / 2), y: roofY - 8, text: roof.label });
  }
  const walkable = walkableTiles(layout);
  return { bg, overlay, walkable, animated, water, width, height, roofLabels };
}

// ── animated props ────────────────────────────────────────────────────────
// propLit(prop) says whether a stove's fire is burning; unknown means it is.
export function drawAnimatedProps(c, scene, t, propLit = () => true) {
  for (const [c0, r0, w, h] of scene.water) {
    for (let i = 0; i < (w * h) * 3; i++) {
      const x = c0 * T + ((i * 37 + Math.floor(t * 9) * 5) % (w * T)), y = r0 * T + ((i * 53) % (h * T));
      if ((i + Math.floor(t * 2)) % 5 === 0) R(c, x, y, 3, 1, P.w3);
    }
  }
  for (const prop of scene.animated) {
    const x = px(prop.at[0]), y = px(prop.at[1]);
    if (prop.kind === "stove" && propLit(prop)) {
      const w = px(prop.w || 2), top = y + 6, fx = x + (w >> 1) - 5, fy = top + px(prop.h || 1) - 13, f = Math.floor(t * 8) % 3;
      R(c, fx, fy, 10, 6, P.f3); R(c, fx + 1, fy + 1 - (f === 1 ? 1 : 0), 8, 5, P.f2); R(c, fx + 2, fy + 2 - (f === 2 ? 1 : 0), 6, 4, P.f1); R(c, fx + 3 + (f % 2), fy + 3, 3, 3, P.f0);
    }
    if (prop.kind === "array-flag") {
      const sway = Math.round(Math.sin(t * 2.4 + x) * 1.5);
      R(c, x, y, 2, 18, O); R(c, x, y, 1, 18, "#6a5a4a");
      R(c, x + 2, y + 1 + (sway > 0 ? 1 : 0), 8 + sway, 6, O); R(c, x + 2, y + 2, 7 + sway, 4, "#3e8aa0"); D(c, x + 5, y + 3, "#d8f0f8"); R(c, x + 2, y + 6, 7 + sway, 1, "#2a6a80");
    }
    if (prop.kind === "goose") {
      const phase = (t * 0.25 + x) % 6, gx = x + Math.round(Math.sin(phase) * 10), gy = y + Math.round(Math.cos(phase * 0.7) * 3), facing = Math.cos(phase) > 0 ? 1 : -1, peck = Math.floor(t * 3 + x) % 9 === 0;
      oval(c, gx, gy + 7, 5, 2, "rgba(10,6,12,.35)");
      R(c, gx - 5, gy, 10, 7, O); R(c, gx - 4, gy + 1, 8, 5, "#f4f2ea"); R(c, gx - 4, gy + 4, 8, 2, "#d8d6ce");
      const hx = gx + facing * 4, hy = gy - (peck ? 0 : 6);
      R(c, hx - 1, hy, 3, 7, O); R(c, hx, hy + 1, 1, 5, "#f4f2ea"); R(c, hx - 1 + (facing > 0 ? 2 : -1), hy + 1, 2, 2, O); D(c, hx + (facing > 0 ? 2 : -1), hy + 1, "#f0a030"); D(c, hx, hy + 1, O);
      D(c, gx - 2, gy + 7, "#f0a030"); D(c, gx + 2, gy + 7, "#f0a030");
    }
  }
}
