// Weather on the body: what reaches a person where they stand, how rain, snow,
// wind, sun and drought change wetness, cold, heat and the illnesses that
// follow, and how the person would put it in words. Rates are per hour.
// Floodwater underfoot soaks a person indoors or out. Being cold is not
// freezing: only in real cold (wind, storm, snow, a blizzard, a fireless house
// in the snow) does a person chilled through begin to freeze, hour by hour,
// until warmth brings them back. A chill turns to fever over a night out, not
// an hour, and goes down slowly once the person is warm.
export const BODY_WEATHER = Object.freeze({
  clear: { wet: 0, chill: 0, coldIndoors: 0, heat: 0, thirst: 0, thirstIndoors: 0 },
  rain: { wet: 3.0, chill: 0, coldIndoors: 0, heat: 0, thirst: 0, thirstIndoors: 0 },
  storm: { wet: 6.0, chill: 0.4, coldIndoors: 0, heat: 0, thirst: 0, thirstIndoors: 0 },
  fog: { wet: 0, chill: 0, coldIndoors: 0, heat: 0, thirst: 0, thirstIndoors: 0 },
  wind: { wet: 0, chill: 0.4, coldIndoors: 0, heat: 0, thirst: 0, thirstIndoors: 0 },
  heat: { wet: 0, chill: 0, coldIndoors: 0, heat: 0.6, thirst: 0.12, thirstIndoors: 0 },
  drought: { wet: 0, chill: 0, coldIndoors: 0, heat: 0.3, thirst: 0.08, thirstIndoors: 0.03 },
  snow: { wet: 0.8, chill: 0.5, coldIndoors: 0.15, heat: 0, thirst: 0, thirstIndoors: 0 },
  blizzard: { wet: 1.2, chill: 1.0, coldIndoors: 0.25, heat: 0, thirst: 0, thirstIndoors: 0 },
});
const clamp = (v) => Math.min(1, Math.max(0, Number.isFinite(Number(v)) ? Number(v) : 0));
// How fast someone chilled through freezes in the weather's full cold (a blizzard out of doors): about four hours to collapse.
export const FREEZING_PER_HOUR = 0.25;
export function weatherExposure({ zoneId = "", sites = [], perceptionEnvironment = {}, perceivedObjects = [], floodedHere = false } = {}) {
  const list = Array.isArray(sites) ? sites : [];
  const zone = String(zoneId || "");
  if (!list.length) return { outdoors: false, weather: "clear", nearFire: false, ...(floodedHere ? { floodedHere: true } : {}) };
  const site = zone.includes("__") ? list.find((row) => row.id === zone.split("__")[0]) : null;
  const outdoors = !zone.includes("__") || (site?.kind !== "building");
  const weather = BODY_WEATHER[perceptionEnvironment?.weather] ? perceptionEnvironment.weather : "clear";
  const nearFire = (perceivedObjects || []).some((row) => row.zoneId === zone && (row.observableState?.lit === true || row.state?.lit === true));
  return { outdoors, weather, nearFire, ...(floodedHere ? { floodedHere: true } : {}) };
}
export function vulnerabilityOf({ child = false, age, body = {} } = {}) {
  let v = 1;
  if (child === true || (Number.isFinite(age) && (age < 14 || age >= 60))) v += 0.5;
  if (Number(body.fatigue) >= 0.6) v += 0.5;
  if (Number.isFinite(Number(body.stamina)) && Number(body.stamina) <= 0.3) v += 0.5;
  return v;
}
export function applyWeatherToBody(body = {}, exposure = {}, seconds = 0, vulnerability = 1) {
  const row = BODY_WEATHER[exposure.weather] || BODY_WEATHER.clear;
  const b = { ...body };
  for (const k of ["wetness", "chill", "heat", "illness", "heatstroke"]) b[k] = clamp(b[k]);
  let left = Math.max(0, seconds);
  const o = exposure.outdoors === true, f = exposure.nearFire === true, flooded = exposure.floodedHere === true;
  while (left > 0) {
    const s = Math.min(300, left); left -= s; const h = s / 3600;
    const { wetness: w, chill: c, heat: ht, illness: i, heatstroke: hs } = b;
    const hy = clamp(b.hypothermia);
    const dw = flooded ? Math.max(4, o ? row.wet : 0) : o && row.wet > 0 ? row.wet : f ? -2 : o && row.heat > 0 ? -1.5 : -0.6;
    const gain = 0.8 * w * (o ? 1 : 0.5) + (o ? row.chill : row.coldIndoors);
    const loss = (f ? 1.5 : (!o && w < 0.2 && row.coldIndoors === 0 ? 0.5 : 0)) + (o && row.heat > 0 ? 1.0 : 0);
    const hgain = o ? row.heat : 0;
    const hloss = (!o ? 0.8 : 0) + (w > 0.3 ? 0.5 : 0) + (o && row.chill > 0 ? 1.0 : 0);
    // A chill deepens into fever more and more slowly; once warm, it eases, slowly.
    const di = (c > 0.5 ? 0.5 * (c - 0.5) * vulnerability * (1 - i) ** 2 : 0) - (c < 0.2 ? 0.03 : 0);
    const cold = o ? row.chill : row.coldIndoors;
    const dhy = c >= 0.85 && cold > 0 && !f ? FREEZING_PER_HOUR * cold * vulnerability : c < 0.5 ? -0.5 : 0;
    const dh = (ht > 0.6 ? 0.6 * (ht - 0.6) * vulnerability : 0) - (ht < 0.3 ? 0.2 : 0);
    b.wetness = clamp(w + dw * h); b.chill = clamp(c + (gain - loss) * h); b.heat = clamp(ht + (hgain - hloss) * h);
    b.illness = clamp(i + di * h); b.heatstroke = clamp(hs + dh * h);
    if (hy > 0 || dhy > 0) b.hypothermia = clamp(hy + dhy * h);
    b.thirst = clamp(Number(b.thirst || 0) + (o ? row.thirst : row.thirstIndoors) * h);
    b.stamina = clamp(Number(b.stamina ?? 1) - (0.1 * i + 0.1 * hs + 0.2 * hy) * h);
    b.energy = b.stamina;
    b.pain = clamp(Number(b.pain || 0) + 0.05 * i * h);
  }
  return b;
}
const LINES = [
  ["wetness", [[0.6, "衣服湿透了，贴在身上"], [0.3, "衣服湿了一片"]]],
  ["chill", [[0.9, "冻得手脚发麻"], [0.7, "冷得直打哆嗦"], [0.4, "身上发冷"]]],
  ["hypothermia", [[0.6, "冻得浑身僵硬，手脚不听使唤"], [0.3, "冷到了骨头里，止不住地发抖"]]],
  ["heat", [[0.7, "热得浑身冒汗，头发昏"], [0.4, "身上燥热"]]],
  ["illness", [[0.6, "发着烧，头重脚轻"], [0.3, "着凉了，鼻子发堵、喉咙发痒"], [0.1, "有点着凉的意思"]]],
  ["heatstroke", [[0.5, "中暑了，眼前发黑、直犯恶心"], [0.2, "有点中暑，头晕"]]],
  ["hunger", [[0.7, "饿得发慌"], [0.5, "有点饿了"]]],
  ["thirst", [[0.7, "渴得厉害"], [0.5, "有点渴了"]]],
  ["fatigue", [[0.75, "累得快撑不住了"], [0.55, "有些乏了"]]],
  ["pain", [[0.5, "身上疼得厉害"], [0.25, "身上有些疼"]]],
];
export function bodyLines(body = {}) {
  return LINES.flatMap(([key, steps]) => { const v = Number(body[key] || 0); const hit = steps.find(([min]) => v >= min); return hit ? [hit[1]] : []; });
}
