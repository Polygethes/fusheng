// Weather over the outdoor map: rain and a downpour with lightning, drifting
// fog, wind-blown streaks and leaves, heat shimmer, drought dust, snow and a
// blizzard. Everything is drawn in whole map pixels and placed by fixed seeds,
// so the same moment always draws the same picture.
import { WEATHER_IDS } from "../worlds/weatherKinds.mjs";

export const WEATHER_KINDS = WEATHER_IDS;

// The stage asks every animation frame; the answer only changes when the
// cursor moves or frames arrive.
let lastAsked = null;

/** The weather at frames[cursor]: the last weather frame at or before it, else the opening weather. */
export function weatherAt(frames = [], cursor = -1, initialWeather = "") {
  if (lastAsked && lastAsked.frames === frames && lastAsked.length === frames.length && lastAsked.cursor === cursor
    && lastAsked.initialWeather === initialWeather) return lastAsked.result;
  const result = findWeather(frames, cursor, initialWeather);
  lastAsked = { frames, length: frames.length, cursor, initialWeather, result };
  return result;
}

function findWeather(frames, cursor, initialWeather) {
  let found = initialWeather;
  for (let i = Math.min(cursor, frames.length - 1); i >= 0; i -= 1) {
    if (typeof frames[i]?.weather === "string") { found = frames[i].weather; break; }
  }
  return found && WEATHER_KINDS.includes(found) ? found : "clear";
}

// A fixed number in [0, 1) for drop i and a salt: the same every frame.
function seed(i, salt) {
  let x = Math.imul(i + 1, 374761393) ^ Math.imul(salt + 1, 668265263);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const mod = (value, size) => ((value % size) + size) % size;

export function createWeatherLayer() {
  function draw(ctx, view, weather, t) {
    const left = Math.ceil(view[0]), top = Math.ceil(view[1]);
    const right = Math.floor(view[0] + view[2]), bottom = Math.floor(view[1] + view[3]);
    const w = right - left, h = bottom - top;
    if (w <= 0 || h <= 0) return;
    // Every rectangle is cut to the view; whatever is left of it is drawn.
    const rect = (style, x, y, rw, rh) => {
      const x0 = Math.max(left, Math.round(x)), y0 = Math.max(top, Math.round(y));
      const x1 = Math.min(right, Math.round(x) + rw), y1 = Math.min(bottom, Math.round(y) + rh);
      if (x1 <= x0 || y1 <= y0) return;
      ctx.fillStyle = style;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    };
    const shade = (style) => rect(style, left, top, w, h);
    // Rain streaks lean left, one pixel for every four they fall; splashes
    // flash now and then where drops land.
    const rain = (count, slowest, spread) => {
      const span = h + 8;
      for (let i = 0; i < count; i += 1) {
        const fall = mod(seed(i, 3) * span + t * (slowest + spread * seed(i, 2)), span);
        const x = left + mod(Math.round(seed(i, 1) * w - fall / 4), w);
        const y = top - 4 + Math.round(fall);
        rect("rgba(175, 195, 225, 0.55)", x, y, 1, 2);
        rect("rgba(175, 195, 225, 0.55)", x - 1, y + 2, 1, 2);
      }
      for (let i = 0; i < Math.round(count / 6); i += 1) {
        if (mod(t * (0.8 + seed(i, 5)) + seed(i, 6), 1) > 0.18) continue;
        rect("rgba(200, 215, 235, 0.5)", left + Math.floor(seed(i, 7) * (w - 1)), top + Math.floor(seed(i, 8) * h), 2, 1);
      }
    };
    const painters = {
      rain() {
        shade("rgba(20, 28, 45, 0.18)");
        rain(Math.max(200, Math.round((w * h) / 450)), 180, 80);
      },
      storm() {
        shade("rgba(15, 20, 35, 0.28)");
        rain(Math.max(400, Math.round((w * h) / 225)), 260, 100);
        if (mod(t, 7) < 0.12) shade("rgba(255, 255, 255, 0.35)");
      },
      snow() {
        shade("rgba(225, 232, 245, 0.10)");
        const count = Math.max(150, Math.round((w * h) / 700));
        const span = h + 4;
        for (let i = 0; i < count; i += 1) {
          const fall = mod(seed(i, 31) * span + t * (20 + 15 * seed(i, 32)), span);
          const size = i % 2 ? 2 : 1;
          const x = left + Math.floor(seed(i, 33) * w) + Math.round(Math.sin(t * 1.5 + seed(i, 34) * 6.28) * 3);
          rect("rgba(245, 248, 255, 0.85)", x, top - 2 + Math.round(fall), size, size);
        }
      },
      blizzard() {
        shade("rgba(225, 232, 245, 0.25)");
        const count = Math.max(400, Math.round((w * h) / 250));
        const span = h + 4;
        for (let i = 0; i < count; i += 1) {
          const fall = mod(seed(i, 41) * span + t * (90 + 50 * seed(i, 42)), span);
          const x = left + mod(Math.round(seed(i, 43) * w + fall), w);
          rect("rgba(245, 248, 255, 0.8)", x, top - 2 + Math.round(fall), 2, 1);
        }
      },
      heat() {
        shade("rgba(255, 190, 110, 0.10)");
        const span = h + 2;
        for (let i = 0; i < 24; i += 1) {
          const rise = mod(seed(i, 51) * span + t * (6 + 6 * seed(i, 52)), span);
          const x = left + Math.floor(seed(i, 53) * Math.max(1, w - 8)) + Math.round(Math.sin(t * 3 + seed(i, 54) * 6.28) * 2);
          rect("rgba(255, 240, 210, 0.15)", x, bottom - Math.round(rise), 8, 1);
        }
      },
      drought() {
        shade("rgba(190, 150, 80, 0.12)");
        const count = Math.round((w * h) / 3000);
        for (let i = 0; i < count; i += 1) {
          const x = left + mod(Math.round(seed(i, 61) * w + t * (8 + 8 * seed(i, 62))), w);
          const y = top + Math.floor(seed(i, 63) * h) + Math.round(Math.sin(t * 1.2 + seed(i, 64) * 6.28) * 2);
          rect("rgba(210, 180, 120, 0.5)", x, y, 1, 1);
        }
      },
      fog() {
        shade("rgba(205, 212, 225, 0.22)");
        for (let i = 0; i < 6; i += 1) {
          const bandH = 10 + Math.floor(seed(i, 11) * 9);
          const bandW = Math.round(w * (0.5 + 0.4 * seed(i, 12)));
          const x = left - bandW + mod(Math.round(seed(i, 13) * (w + bandW) + t * (3 + 4 * seed(i, 14))), w + bandW);
          rect("rgba(232, 238, 246, 0.10)", x, top + Math.floor(seed(i, 15) * Math.max(1, h - bandH)), bandW, bandH);
        }
      },
      wind() {
        const count = Math.round((w * h) / 2500);
        for (let i = 0; i < count; i += 1) {
          const x = left - 6 + mod(Math.round(seed(i, 21) * (w + 6) + t * (120 + 80 * seed(i, 22))), w + 6);
          rect("rgba(220, 226, 236, 0.25)", x, top + Math.floor(seed(i, 23) * h), 6, 1);
        }
        for (let i = 0; i < Math.round(count / 2); i += 1) {
          const x = left - 2 + mod(Math.round(seed(i, 24) * (w + 2) + t * (40 + 30 * seed(i, 25))), w + 2);
          const y = top + Math.floor(seed(i, 26) * h) + Math.round(Math.sin(t * 2 + seed(i, 27) * 6.28) * 4);
          rect(i % 2 ? "#6a7a3a" : "#8a6a3a", x, y, 2, 2);
        }
      },
    };
    painters[weather]?.();
  }
  return { draw };
}
