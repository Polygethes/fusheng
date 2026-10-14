// World objects drawn with their live, settled state. Objects in someone's
// hands are drawn by the director next to that character instead.
import { O, T, R, D, circ, oval, text } from "./pixel.js";
import { P } from "./tiles.js";
import { iconForObject } from "./sprites.js";

const px = (v) => Math.round(v * T);
const num = (value, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

const DRAWERS = {
  vat(c, x, y, o, spec) {
    const fill = num(o.state?.[spec.fill?.stateKey || "fill"]);
    oval(c, x + 8, y + 15, 9, 3, "rgba(10,6,12,.45)");
    for (let i = 0; i < 16; i++) { const wv = Math.round(8 * Math.sin(Math.PI * (i + 3) / 21)); R(c, x + 8 - wv - 1, y + i, wv * 2 + 3, 1, O); R(c, x + 8 - wv, y + i, wv * 2 + 1, 1, i < 3 ? "#46584a" : "#344a3c"); if (wv > 3) R(c, x + 8 - wv + 2, y + i, 2, 1, "#5a7a62"); }
    oval(c, x + 8, y + 1, 7, 2, O); oval(c, x + 8, y + 1, 6, 1, "#22303a");
    if (fill > 0) { oval(c, x + 8, y + 1, Math.max(2, Math.round(6 * Math.min(1, fill))), 1, P.w1); D(c, x + 6, y + 1, P.w3); }
  },
  bucket(c, x, y, o, spec) {
    const fill = num(o.state?.[spec.fill?.stateKey || "fill"]);
    R(c, x, y + 2, 11, 10, O); R(c, x + 1, y + 3, 9, 8, "#8a6440"); R(c, x + 1, y + 5, 9, 1, "#5a5a64"); R(c, x + 1, y + 9, 9, 1, "#5a5a64");
    oval(c, x + 5, y + 3, 4, 1, fill > 0 ? P.w2 : "#3a2a20"); R(c, x + 1, y, 9, 1, "#5a5a64");
  },
  well(c, x, y) { R(c, x, y + 2, 28, 18, O); R(c, x + 1, y + 3, 26, 16, P.st1); for (let yy = y + 5; yy < y + 19; yy += 4) R(c, x + 1, yy, 26, 1, P.st0); oval(c, x + 14, y + 6, 10, 4, O); oval(c, x + 14, y + 6, 9, 3, P.w0); D(c, x + 11, y + 5, P.w3); R(c, x + 2, y - 8, 2, 12, "#5a3e28"); R(c, x + 24, y - 8, 2, 12, "#5a3e28"); R(c, x + 2, y - 9, 24, 2, "#6a4a30"); },
  axe(c, x, y) { for (let i = 0; i < 9; i++) { R(c, x + 12 + Math.floor(i / 3), y - 6 + i, 2, 1, O); D(c, x + 12 + Math.floor(i / 3), y - 6 + i, "#8a6440"); } R(c, x + 6, y + 0, 8, 5, O); R(c, x + 7, y + 1, 6, 3, "#b8c0c8"); R(c, x + 7, y + 1, 6, 1, "#e8eef2"); },
  logpile(c, x, y, o, spec) {
    const count = Math.round(num(o.state?.[spec.count?.stateKey]) * (spec.count?.per || 1));
    const spots = [[0, 8], [14, 8], [7, 2], [21, 2]].slice(0, Math.min(4, count));
    for (const [dx, dy] of spots) { const lx = x + dx, ly = y + dy; R(c, lx - 1, ly - 1, 15, 9, O); R(c, lx, ly, 13, 7, "#5a3a26"); R(c, lx, ly, 13, 2, "#7a5236"); R(c, lx + 3, ly + 3, 4, 1, "#3e2618"); circ(c, lx + 13, ly + 3, 4, O); circ(c, lx + 13, ly + 3, 3, "#d0a870"); circ(c, lx + 13, ly + 3, 2, "#b08850"); D(c, lx + 13, ly + 3, "#7a5636"); }
  },
  bundles(c, x, y, o, spec) {
    const done = Math.round(num(o.state?.[spec.count?.stateKey])), slots = spec.count?.slots || 2;
    for (let i = 0; i < slots; i++) {
      const bx = x + i * 18, by = y;
      if (i < done) { R(c, bx, by + 1, 15, 13, O); for (let r2 = 0; r2 < 3; r2++) for (let c2 = 0; c2 < 3; c2++) { const qx = bx + 1 + c2 * 4 + (r2 % 2 ? 2 : 0), qy = by + 2 + r2 * 4; if (qx > bx + 12) continue; R(c, qx, qy, 4, 4, O); R(c, qx, qy, 3, 3, "#d8b07a"); D(c, qx, qy, "#f0d098"); D(c, qx + 2, qy + 2, "#a07a48"); } R(c, bx + 1, by + 7, 13, 1, P.r1); }
      else { for (let k = 0; k < 15; k += 2) { D(c, bx + k, by + 13, "#6a5a50"); D(c, bx + k, by + 1, "#6a5a50"); } for (let k = 1; k < 13; k += 2) { D(c, bx, by + 1 + k, "#6a5a50"); D(c, bx + 14, by + 1 + k, "#6a5a50"); } }
    }
  },
  kite(c, x, y) { R(c, x + 4, y - 4, 1, 1, O); R(c, x + 2, y - 3, 5, 1, O); R(c, x, y - 2, 9, 5, O); R(c, x + 1, y - 2, 7, 4, P.r2); R(c, x + 2, y - 2, 2, 2, "#f08a6a"); R(c, x + 2, y + 3, 5, 1, O); D(c, x + 4, y + 4, "#e8c160"); R(c, x + 3, y, 3, 1, "#e8c160"); for (let i = 0; i < 5; i++) D(c, x + 5 + (i % 2), y + 5 + i, "#e8c160"); },
  bundle(c, x, y, o, spec) {
    const packed = Math.round(num(o.state?.[spec.count?.stateKey])), size = 4 + packed;
    R(c, x, y + 10 - size, 6 + packed * 2, size + 2, O); R(c, x + 1, y + 11 - size, 4 + packed * 2, size, "#8a6a8a"); R(c, x + 1, y + 11 - size, 4 + packed * 2, 1, "#a888a8");
    if (packed > 0) { D(c, x + 3 + packed, y + 9 - size, O); D(c, x + 3 + packed, y + 10 - size, "#e8c160"); }
  },
  book(c, x, y) { R(c, x, y, 8, 6, O); R(c, x + 1, y + 1, 6, 4, "#a89060"); R(c, x + 1, y + 1, 1, 4, "#6a5030"); },
  "array-disk"(c, x, y, o) { circ(c, x + 6, y + 4, 5, O); circ(c, x + 6, y + 4, 4, "#7a6a50"); circ(c, x + 6, y + 4, 2, "#5a4a38"); D(c, x + 6, y + 4, num(o.state?.crackDepth) > 0 ? "#2a2020" : "#8fd0ff"); for (let i = 0; i < Math.min(4, num(o.state?.crackDepth) * 2); i++) D(c, x + 3 + i, y + 2 + (i % 2), "#1a1010"); },
  "flag-bundle"(c, x, y, o) { for (let i = 0; i < 4; i++) { R(c, x + i * 3, y, 1, 14, "#6a5a4a"); R(c, x + i * 3 + 1, y + 1, 3, 3, i < num(o.state?.brokenFlags) ? "#6a4040" : "#3e8aa0"); } R(c, x - 1, y + 8, 12, 2, "#b8a080"); },
  pot(c, x, y, o, spec, t) { const done = num(o.state?.[spec.count?.stateKey || "cookedPortions"]); oval(c, x + 7, y + 3, 7, 3, O); oval(c, x + 7, y + 3, 6, 2, done > 0 ? "#e8e0c8" : "#3a3a40"); R(c, x + 1, y + 4, 13, 4, "#2a2a30"); if (done > 0 && Math.floor(t * 3) % 2) { D(c, x + 5, y - 2, "#d8d8e0"); D(c, x + 9, y - 4, "#d8d8e0"); } },
  gourd(c, x, y) { circ(c, x + 3, y + 5, 3, O); circ(c, x + 3, y + 5, 2, "#c0a050"); circ(c, x + 3, y + 1, 2, O); D(c, x + 3, y + 1, "#c0a050"); },
  rations(c, x, y) { R(c, x, y + 2, 7, 5, O); R(c, x + 1, y + 3, 5, 3, "#d8c090"); D(c, x + 2, y + 4, "#a08050"); },
  chest(c, x, y) { R(c, x, y, 13, 9, O); R(c, x + 1, y + 1, 11, 7, "#8a5a34"); R(c, x + 1, y + 1, 11, 2, "#b07a4a"); R(c, x + 5, y + 4, 3, 2, "#e8c160"); },
  patient(c, x, y, o, spec, t) {
    const marks = Math.round(num(o.state?.[spec.marks?.stateKey || "blackMarks"]));
    const bx = x + 2, by = y + 3, breath = Math.floor(t * 1.2) % 2;
    R(c, bx + 1, by, 10, 7, O); R(c, bx + 2, by + 1, 8, 5, "#f0c8a8"); R(c, bx + 2, by + 1, 8, 2, "#2e2428"); D(c, bx + 4, by + 4, "#3a2a2a"); D(c, bx + 7, by + 4, "#3a2a2a");
    R(c, bx, by + 7, 12, 17, O); R(c, bx + 1, by + 8 - breath, 10, 15 + breath, "#6a8ab0"); R(c, bx + 1, by + 8 - breath, 10, 2, "#8aaad0");
    R(c, bx + 8, by + 10, 4, 6, O); R(c, bx + 9, by + 11, 2, 4, "#efe6d8");
    for (let i = 0; i < marks; i++) D(c, bx + 9 + (i % 2), by + 11 + i, "#1a1018");
  },
  cloth(c, x, y) { R(c, x, y, 12, 5, O); R(c, x + 1, y + 1, 10, 3, "#5a8a7a"); R(c, x + 1, y + 1, 10, 1, "#7aaa9a"); },
  pills(c, x, y) { R(c, x, y + 1, 11, 6, O); R(c, x + 1, y + 2, 9, 4, "#6a4a30"); for (const [i, col] of [[0, "#d0605a"], [1, "#5aa8d0"], [2, "#7ac06a"]]) { R(c, x + 2 + i * 3, y - 2, 2, 4, O); D(c, x + 2 + i * 3, y - 1, col); } },
  "array-line"(c, x, y, o, spec, t) {
    const lit = Math.round(num(o.state?.[spec.segments?.stateKey || "litSegments"])), of = spec.segments?.of || 3;
    for (let i = 0; i < of; i++) {
      const sx = x + i * 14, sy = y + (i % 2) * 3;
      R(c, sx, sy, 11, 9, O); R(c, sx + 1, sy + 1, 9, 7, P.st1); R(c, sx + 1, sy + 1, 9, 1, P.st3);
      const glow = i < lit ? (Math.floor(t * 2 + i) % 2 ? "#a8e8ff" : "#7ad0ff") : "#3a3a48";
      R(c, sx + 3, sy + 3, 5, 1, glow); R(c, sx + 5, sy + 2, 1, 4, glow); D(c, sx + 3, sy + 5, glow); D(c, sx + 7, sy + 5, glow);
    }
  },
  generic(c, x, y, o) { c.drawImage(iconForObject(o.id, o.label), x, y); },
  fixture() {},
};

/** Draw resting objects. `held` lists object ids currently shown in someone's hands. */
export function drawObjects(c, layout, objects, t, held = new Set()) {
  for (const [id, spec] of Object.entries(layout.objects || {})) {
    const o = objects[id];
    if (!o || held.has(id)) continue;
    if (o.holder) {
      if (spec.restsOn && id) continue; // a carried tool is not on its block
      continue; // carried objects travel with their holder
    }
    let at = spec.at;
    if (o.zoneId && spec.zoneId && o.zoneId !== spec.zoneId) at = null; // moved elsewhere: drawn at the zone's drop spot
    if (!at) {
      const drop = layout.spots?.[o.zoneId]?.[0];
      if (!drop) continue;
      at = [drop[0] + 0.55, drop[1] + 0.35];
      c.drawImage(iconForObject(id, o.label, spec.drawer), px(at[0]), px(at[1]));
      continue;
    }
    (DRAWERS[spec.drawer] || DRAWERS.generic)(c, px(at[0]), px(at[1]), { id, ...o }, spec, t);
  }
  for (const [id, o] of Object.entries(objects || {})) {
    if (!o || layout.objects?.[id] || held.has(id) || o.holder || !o.zoneId) continue;
    const drop = layout.spots?.[o.zoneId]?.[0];
    if (!drop) continue;
    const at = [drop[0] + 0.55, drop[1] + 0.35];
    c.drawImage(iconForObject(id, o.label), px(at[0]), px(at[1]));
  }
}

/** Labels for objects the operator may want to locate (shown on hover/selection only). */
export function objectLabel(c, layout, id, label) {
  const spec = layout.objects?.[id];
  if (!spec?.at) return;
  text(c, label, px(spec.at[0]) + 6, px(spec.at[1]) - 10, "#f1e6cf", O, "c");
}
