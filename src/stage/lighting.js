// Time-of-day lighting: an ambient shade per indoor/outdoor region with
// stepped light pools cut out of it, warm glows, and ambient particles.
import { T, D, circ, canvas } from "./pixel.js";

const THEMES = {
  dusk: { indoor: "rgba(22,14,40,.38)", outdoor: "rgba(14,20,52,.5)", glow: 0.07, sun: null },
  dawn: { indoor: "rgba(30,22,46,.30)", outdoor: "rgba(40,50,90,.20)", glow: 0.05, sun: "rgba(255,200,140,.06)" },
};
const INDOOR = new Set(["wood", "earth"]);

export function createLighting(layout, width, height) {
  const theme = THEMES[layout.theme] || THEMES.dusk;
  const [mask, m] = canvas(width, height);
  const [dark, d] = canvas(width, height);
  m.fillStyle = "#000";
  for (const floor of layout.floors || []) if (INDOOR.has(floor.material)) { const [c0, r0, w, h] = floor.rect; m.fillRect(c0 * T, r0 * T, w * T, h * T); }
  for (const wall of layout.walls || []) if (wall.style === "interior-back" || wall.style === "top") { const [c0, r0, w, h] = wall.rect; m.fillRect(c0 * T, r0 * T, w * T, h * T); }
  const motes = (layout.ambient?.motes || []).flatMap(([c0, r0, w, h], k) => Array.from({ length: 12 }, (_, i) => ({ x: (c0 + ((i * 53 + k * 7) % (w * 10)) / 10) * T, y: (r0 + ((i * 37) % (h * 10)) / 10) * T, p: i * 0.7 })));
  const flies = (layout.ambient?.fireflies || []).flatMap(([c0, r0, w, h]) => Array.from({ length: 9 }, (_, i) => ({ x: (c0 + ((i * 41) % (w * 10)) / 10) * T, y: (r0 + ((i * 67) % (h * 10)) / 10) * T, p: i * 1.3 })));
  const birds = (layout.ambient?.birds || []).flatMap(([c0, r0, w]) => Array.from({ length: 3 }, (_, i) => ({ x: c0 * T, w: w * T, y: (r0 + 0.4 + i * 0.5) * T, p: i * 2.1 })));
  const mist = (layout.ambient?.mist || []).map(([c0, r0, w, h]) => ({ x: c0 * T, y: r0 * T, w: w * T, h: h * T }));

  let viewDark = null;
  let viewTint = null;

  // lightOn(light) says whether a light's source is burning (a stove that is
  // out casts no glow); lights without such a source are always on.
  function draw(c, t, { litSegments = 0, view = null, daylight = null, lightOn = () => true } = {}) {
    let outdoorColor = theme.outdoor;
    let indoorColor = theme.indoor;
    let lampAlphaMult = 1;

    if (daylight) {
      if (layout.dayCycle) {
        const [r, g, b, a] = daylight.shade;
        outdoorColor = `rgba(${r},${g},${b},${a})`;
        indoorColor = "rgba(30,22,46,.25)";
        lampAlphaMult = daylight.lamps;
      }
    }

    if (view) {
      const [vx, vy, vw, vh] = view;
      if (!viewDark || viewDark[0].width !== vw || viewDark[0].height !== vh) viewDark = canvas(vw, vh);
      if (!viewTint || viewTint[0].width !== vw || viewTint[0].height !== vh) viewTint = canvas(vw, vh);
      const [, vd] = viewDark;
      const [, vtc] = viewTint;

      vd.globalCompositeOperation = "source-over";
      vd.clearRect(0, 0, vw, vh);
      vd.fillStyle = outdoorColor;
      vd.fillRect(0, 0, vw, vh);

      vd.globalCompositeOperation = "destination-out";
      vd.drawImage(mask, vx, vy, vw, vh, 0, 0, vw, vh);

      vd.globalCompositeOperation = "source-over";
      vtc.globalCompositeOperation = "source-over";
      vtc.clearRect(0, 0, vw, vh);
      vtc.drawImage(mask, vx, vy, vw, vh, 0, 0, vw, vh);
      vtc.globalCompositeOperation = "source-in";
      vtc.fillStyle = indoorColor;
      vtc.fillRect(0, 0, vw, vh);
      vd.drawImage(viewTint[0], 0, 0);

      vd.globalCompositeOperation = "destination-out";
      const flicker = Math.floor(t * 6) % 2;
      for (const light of (layout.lights || []).filter((row) => lightOn(row))) {
        if (light.segments && litSegments <= 0) continue;
        const lx = light.at[0] * T - vx, ly = light.at[1] * T - vy;
        const r = light.r + (light.flicker ? flicker : 0) + (light.segments ? litSegments * 4 : 0);
        if (lx + r < 0 || lx - r > vw || ly + r < 0 || ly - r > vh) continue;
        for (const k of [1, 0.78, 0.56]) {
          vd.globalAlpha = 0.3 * lampAlphaMult;
          circ(vd, lx, ly, Math.round(r * k), "#000");
        }
      }
      vd.globalAlpha = 1;
      vd.globalCompositeOperation = "source-over";
      c.drawImage(viewDark[0], vx, vy);

      c.globalCompositeOperation = "lighter";
      for (const light of (layout.lights || []).filter((row) => lightOn(row))) {
        if (light.segments && litSegments <= 0) continue;
        const lx = light.at[0] * T, ly = light.at[1] * T;
        const r = Math.round((light.r - 6) + (light.flicker ? flicker : 0));
        if (lx + r < vx || lx - r > vx + vw || ly + r < vy || ly - r > vy + vh) continue;
        for (const k of [1, 0.66, 0.4]) {
          c.globalAlpha = theme.glow * lampAlphaMult;
          circ(c, lx, ly, Math.round(r * k), light.color);
        }
      }
      c.globalAlpha = 1;
      c.globalCompositeOperation = "source-over";

      for (const m2 of motes) {
        const x = m2.x + Math.sin(t * 0.4 + m2.p) * 6, y = m2.y + Math.cos(t * 0.3 + m2.p) * 4;
        if (x >= vx && x < vx + vw && y >= vy && y < vy + vh) {
          if (Math.floor(t * 2 + m2.p) % 3) D(c, x, y, "rgba(255,220,160,.55)");
        }
      }
      for (const f of flies) {
        const x = f.x + Math.sin(t * 0.7 + f.p) * 8, y = f.y + Math.sin(t * 0.5 + f.p * 2) * 5;
        if (x >= vx && x < vx + vw && y >= vy && y < vy + vh) {
          if (Math.sin(t * 2.2 + f.p * 3) > 0.2) { D(c, x, y, "#e8ff9a"); D(c, x + 1, y, "rgba(200,255,120,.5)"); }
        }
      }
      for (const b of birds) {
        const x = b.x + ((t * 14 + b.p * 40) % (b.w + 40)) - 20, y = b.y + Math.sin(t * 1.5 + b.p) * 3, wing = Math.floor(t * 6 + b.p) % 2;
        if (x >= vx && x < vx + vw && y >= vy && y < vy + vh) {
          D(c, x, y, "#2a2a38"); D(c, x - 1, y - wing, "#2a2a38"); D(c, x + 1, y - wing, "#2a2a38"); D(c, x - 2, y - 1 + wing, "#2a2a38"); D(c, x + 2, y - 1 + wing, "#2a2a38");
        }
      }
      for (const fog of mist) for (let i = 0; i < 4; i++) {
        const x = fog.x + ((t * 4 + i * 23) % fog.w), y = fog.y + (i * fog.h) / 4;
        if (x + 32 >= vx && x - 16 <= vx + vw && y >= vy && y < vy + vh) {
          c.fillStyle = "rgba(230,236,245,.07)";
          c.fillRect(Math.round(x - 16), Math.round(y), 32, 4);
        }
      }
      if (theme.sun) {
        c.fillStyle = theme.sun;
        for (let i = 0; i < 5; i++) {
          c.save();
          c.globalAlpha = 0.5;
          c.translate(vx + vw - 20 - i * 36, vy - 10);
          c.rotate(0.6);
          c.fillRect(0, 0, 10, vh * 1.4);
          c.restore();
        }
      }
      c.fillStyle = "rgba(8,6,14,.22)";
      c.fillRect(vx, vy, vw, 2);
      c.fillRect(vx, vy + vh - 2, vw, 2);
      c.fillRect(vx, vy, 2, vh);
      c.fillRect(vx + vw - 2, vy, 2, vh);
      return;
    }

    // Full layout rendering (fallback for v1 / whole stage)
    d.globalCompositeOperation = "source-over";
    d.clearRect(0, 0, width, height);
    d.fillStyle = outdoorColor; d.fillRect(0, 0, width, height);
    d.globalCompositeOperation = "destination-out"; d.drawImage(mask, 0, 0);
    d.globalCompositeOperation = "source-over";
    const [tint, tc] = tintCache(width, height);
    tc.globalCompositeOperation = "source-over"; tc.clearRect(0, 0, width, height); tc.drawImage(mask, 0, 0);
    tc.globalCompositeOperation = "source-in"; tc.fillStyle = indoorColor; tc.fillRect(0, 0, width, height);
    d.drawImage(tint, 0, 0);
    d.globalCompositeOperation = "destination-out";
    const flicker = Math.floor(t * 6) % 2;
    for (const light of (layout.lights || []).filter((row) => lightOn(row))) {
      if (light.segments && litSegments <= 0) continue;
      const x = light.at[0] * T, y = light.at[1] * T, r = light.r + (light.flicker ? flicker : 0) + (light.segments ? litSegments * 4 : 0);
      for (const k of [1, 0.78, 0.56]) { d.globalAlpha = 0.3 * lampAlphaMult; circ(d, x, y, Math.round(r * k), "#000"); }
    }
    d.globalAlpha = 1; d.globalCompositeOperation = "source-over";
    c.drawImage(dark, 0, 0);
    c.globalCompositeOperation = "lighter";
    for (const light of (layout.lights || []).filter((row) => lightOn(row))) {
      if (light.segments && litSegments <= 0) continue;
      const x = light.at[0] * T, y = light.at[1] * T, r = Math.round((light.r - 6) + (light.flicker ? flicker : 0));
      for (const k of [1, 0.66, 0.4]) { c.globalAlpha = theme.glow * lampAlphaMult; circ(c, x, y, Math.round(r * k), light.color); }
    }
    c.globalAlpha = 1; c.globalCompositeOperation = "source-over";
    if (theme.sun) { c.fillStyle = theme.sun; for (let i = 0; i < 5; i++) { c.save(); c.globalAlpha = 0.5; c.translate(width - 20 - i * 36, -10); c.rotate(0.6); c.fillRect(0, 0, 10, height * 1.4); c.restore(); } }
    for (const m2 of motes) { const x = m2.x + Math.sin(t * 0.4 + m2.p) * 6, y = m2.y + Math.cos(t * 0.3 + m2.p) * 4; if (Math.floor(t * 2 + m2.p) % 3) D(c, x, y, "rgba(255,220,160,.55)"); }
    for (const f of flies) { const x = f.x + Math.sin(t * 0.7 + f.p) * 8, y = f.y + Math.sin(t * 0.5 + f.p * 2) * 5; if (Math.sin(t * 2.2 + f.p * 3) > 0.2) { D(c, x, y, "#e8ff9a"); D(c, x + 1, y, "rgba(200,255,120,.5)"); } }
    for (const b of birds) { const x = b.x + ((t * 14 + b.p * 40) % (b.w + 40)) - 20, y = b.y + Math.sin(t * 1.5 + b.p) * 3, wing = Math.floor(t * 6 + b.p) % 2; D(c, x, y, "#2a2a38"); D(c, x - 1, y - wing, "#2a2a38"); D(c, x + 1, y - wing, "#2a2a38"); D(c, x - 2, y - 1 + wing, "#2a2a38"); D(c, x + 2, y - 1 + wing, "#2a2a38"); }
    for (const fog of mist) for (let i = 0; i < 4; i++) { const x = fog.x + ((t * 4 + i * 23) % fog.w), y = fog.y + (i * fog.h) / 4; c.fillStyle = "rgba(230,236,245,.07)"; c.fillRect(Math.round(x - 16), Math.round(y), 32, 4); }
    c.fillStyle = "rgba(8,6,14,.22)"; c.fillRect(0, 0, width, 2); c.fillRect(0, height - 2, width, 2); c.fillRect(0, 0, 2, height); c.fillRect(width - 2, 0, 2, height);
  }
  return { draw };
}

let tintCanvas = null;
function tintCache(w, h) {
  if (!tintCanvas || tintCanvas[0].width !== w || tintCanvas[0].height !== h) tintCanvas = canvas(w, h);
  return tintCanvas;
}
