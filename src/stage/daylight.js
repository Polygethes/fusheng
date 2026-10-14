// Day/night cycle calculation: shade color [r, g, b, a] and lamps 0..1 by clock seconds.
const SCHEDULE = [
  { s: 0 * 3600, shade: [14, 20, 52, 0.5], lamps: 1 },
  { s: 5 * 3600, shade: [14, 20, 52, 0.5], lamps: 1 },
  { s: 6.5 * 3600, shade: [60, 40, 80, 0.22], lamps: 0.5 },
  { s: 8 * 3600, shade: [0, 0, 0, 0], lamps: 0 },
  { s: 17 * 3600, shade: [0, 0, 0, 0], lamps: 0 },
  { s: 18.5 * 3600, shade: [90, 40, 30, 0.25], lamps: 0.6 },
  { s: 20 * 3600, shade: [14, 20, 52, 0.5], lamps: 1 },
  { s: 24 * 3600, shade: [14, 20, 52, 0.5], lamps: 1 },
];

export function clockSeconds(str) {
  if (typeof str !== "string") return null;
  const match = str.trim().match(/^(\d{1,2}):(\d{2})$/u);
  if (!match) return null;
  const h = Number(match[1]), m = Number(match[2]);
  if (h < 0 || h >= 24 || m < 0 || m >= 60) return null;
  return h * 3600 + m * 60;
}

export function daylightAt(seconds) {
  const norm = ((Number(seconds) % 86400) + 86400) % 86400;
  let idx = 0;
  while (idx < SCHEDULE.length - 1 && SCHEDULE[idx + 1].s <= norm) idx++;
  const cur = SCHEDULE[idx];
  const nxt = SCHEDULE[idx + 1] || SCHEDULE[idx];
  const span = nxt.s - cur.s;
  const t = span <= 0 ? 0 : (norm - cur.s) / span;

  const r = Math.round(cur.shade[0] + (nxt.shade[0] - cur.shade[0]) * t);
  const g = Math.round(cur.shade[1] + (nxt.shade[1] - cur.shade[1]) * t);
  const b = Math.round(cur.shade[2] + (nxt.shade[2] - cur.shade[2]) * t);
  const a = +(cur.shade[3] + (nxt.shade[3] - cur.shade[3]) * t).toFixed(4);
  const lamps = +(cur.lamps + (nxt.lamps - cur.lamps) * t).toFixed(4);

  return { shade: [r, g, b, a], lamps };
}
