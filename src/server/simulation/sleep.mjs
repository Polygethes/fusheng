// Day and night, and sleep. A town's clock runs from the hour it opened; each
// person is told the time of day and whether it is light in their own terms
// (时辰 in a town that counts by them, hours elsewhere). Staying awake makes a
// person sleepy, faster at night; sleep eases it, best in a bed. A person who
// lies down sleeps until rested by day, or through the night until morning
// once rested enough, or until someone speaks to them or something urgent
// reaches them. Sleepiness is kept as a value at a moment and worked out
// forward from there, so it only changes in the world when someone falls
// asleep or wakes.
const clean = (value) => String(value ?? "").trim();
const clamp01 = (value) => Math.min(1, Math.max(0, value));

const BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
const DIGITS = ["十二", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一"];
/** Sleepiness gained per hour awake, by day and at night (22:00–06:00). */
export const AWAKE_PER_HOUR = Object.freeze({ day: 0.04, night: 0.07 });
/** Sleepiness shed per hour asleep, by where one lies. */
export const REST_PER_HOUR = Object.freeze({ bed: 0.12, indoors: 0.09, outdoors: 0.07 });
export const RESTED = 0.05;
export const MORNING_RESTED = 0.3;
export const MAX_SLEEP_SECONDS = 12 * 3600;
const NIGHT_FROM = 22 * 60, MORNING = 6 * 60;
const STEP = 300;

/** The minute of the day (0–1439, may be fractional) the town opened at, or null when it keeps no clock. */
export function startClockMinutes(state = {}) {
  const match = /^(\d{1,2}):(\d{2})$/u.exec(clean(state.worldPackMeta?.startClock));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
/** The minute of the day at `atSeconds` (fractional), or null. */
export function minuteOfDay(state = {}, atSeconds = Number(state.nowSeconds || 0)) {
  const start = startClockMinutes(state);
  if (start === null) return null;
  return (((start + Number(atSeconds || 0) / 60) % 1440) + 1440) % 1440;
}
export const isNight = (minute) => minute >= NIGHT_FROM || minute < MORNING;

/** Whether it is light: "天黑着", "天蒙蒙亮", "天亮着", "天快黑了". */
export function lightAt(minute) {
  if (minute < 5 * 60) return "天黑着";
  if (minute < 6.5 * 60) return "天蒙蒙亮";
  if (minute < 17.5 * 60) return "天亮着";
  if (minute < 19 * 60) return "天快黑了";
  return "天黑着";
}

/** The hour as people say it: "半夜十二点半", "凌晨三点", "晚上七点". */
export function hourWords(minute) {
  const hour = Math.floor(minute / 60) % 24;
  const part = hour < 1 ? "半夜" : hour < 5 ? "凌晨" : hour < 8 ? "早上" : hour < 11 ? "上午" : hour < 13 ? "中午" : hour < 18 ? "下午" : hour < 23 ? "晚上" : "半夜";
  return `${part}${DIGITS[hour % 12]}点${minute % 60 >= 30 ? "半" : ""}`;
}

/** The 时辰: "子时初" (23:00–23:59), "子时正" (00:00–00:59), … */
export function shichenWords(minute) {
  const shifted = (Math.floor(minute) + 60) % 1440;
  return `${BRANCHES[Math.floor(shifted / 120)]}时${shifted % 120 < 60 ? "初" : "正"}`;
}

/** "现在是戌时初（晚上七点），天黑着。" — or "现在是晚上七点，天黑着。" in a town that does not count by 时辰; "" with no clock. */
export function timeOfDayText(state = {}, atSeconds = Number(state.nowSeconds || 0)) {
  const minute = minuteOfDay(state, atSeconds);
  if (minute === null) return "";
  const shichen = /[子丑寅卯辰巳午未申酉戌亥]时/u.test(clean(state.worldPackMeta?.clockLabel));
  return `现在是${shichen ? `${shichenWords(minute)}（${hourWords(minute)}）` : hourWords(minute)}，${lightAt(minute)}。`;
}

/** How sleepy someone is at the town's opening, as if they had been up since six that morning. */
export function openingSleep(state = {}) {
  const start = startClockMinutes(state);
  if (start === null) return { sleepiness: 0.2, atSeconds: 0, asleep: false };
  const since = ((start - MORNING) % 1440 + 1440) % 1440;
  const day = Math.min(since, NIGHT_FROM - MORNING), night = Math.max(0, since - (NIGHT_FROM - MORNING));
  return { sleepiness: Math.round(clamp01((day * AWAKE_PER_HOUR.day + night * AWAKE_PER_HOUR.night) / 60) * 1000) / 1000, atSeconds: 0, asleep: false };
}

const sleepOf = (entity = {}) => entity.sleep || { sleepiness: 0.2, atSeconds: 0, asleep: false };
export const isAsleep = (entity = {}) => entity?.sleep?.asleep === true;

function rateAt(state, sleep, atSeconds) {
  if (sleep.asleep) return -(REST_PER_HOUR[clean(sleep.where)] ?? REST_PER_HOUR.indoors);
  const minute = minuteOfDay(state, atSeconds);
  return minute !== null && isNight(minute) ? AWAKE_PER_HOUR.night : AWAKE_PER_HOUR.day;
}

/** Sleepiness (0–1) of `entity` at `atSeconds`, worked forward from the last recorded value. */
export function sleepinessAt(state = {}, entity = {}, atSeconds = Number(state.nowSeconds || 0)) {
  const sleep = sleepOf(entity);
  let value = Number(sleep.sleepiness || 0);
  for (let t = Number(sleep.atSeconds || 0); t < atSeconds; t += STEP) {
    const span = Math.min(STEP, atSeconds - t);
    value = clamp01(value + rateAt(state, sleep, t) * span / 3600);
  }
  return Math.round(value * 1000) / 1000;
}

/** What the person feels of it: "" or a line for 【你的身子】. */
export function sleepinessLine(value = 0) {
  if (value >= 0.95) return "困得眼皮直打架，随时会睡着";
  if (value >= 0.8) return "困得直打哈欠";
  if (value >= 0.6) return "有些困了";
  return "";
}

/** Where someone lies down: "bed" in a bedroom, "outdoors" in the open, else "indoors". */
export function sleepPlace(state = {}, entity = {}) {
  const zoneId = clean(entity.zoneId);
  const place = state.places?.[clean(entity.placeId)] || {};
  const label = clean(place.topology?.zones?.[zoneId]?.label);
  if (/bedroom|room_\d/u.test(zoneId) || /卧房|客房|厢房/u.test(label)) return "bed";
  if (!zoneId.includes("__")) return "outdoors";
  return clean((place.sites || []).find((row) => clean(row.id) === zoneId.split("__")[0])?.kind) === "building" ? "indoors" : "outdoors";
}

/** When a sleeper wakes of themselves: rested by day, morning once rested enough, or after twelve hours. Null when awake. */
export function wakeAtSeconds(state = {}, entity = {}) {
  const sleep = sleepOf(entity);
  if (!sleep.asleep) return null;
  const since = Number(sleep.sinceSeconds ?? sleep.atSeconds ?? 0);
  const limit = since + MAX_SLEEP_SECONDS;
  const start = startClockMinutes(state);
  let value = Number(sleep.sleepiness || 0);
  for (let t = Number(sleep.atSeconds || 0); t < limit; t += STEP) {
    const minute = minuteOfDay(state, t);
    const night = minute !== null && isNight(minute);
    if (!night && value <= RESTED && t > since) return t;
    // The first stroke of morning, worked out exactly, when rested enough by then.
    if (start !== null && night && minute < MORNING && minute + STEP / 60 >= MORNING) {
      const morning = t + (MORNING - minute) * 60;
      const atMorning = clamp01(value - REST_PER_HOUR[clean(sleep.where)] * (morning - t) / 3600);
      if (atMorning <= MORNING_RESTED && morning > since) return Math.round(morning);
    }
    value = clamp01(value + rateAt(state, sleep, t) * Math.min(STEP, limit - t) / 3600);
  }
  return limit;
}

/** The next moment any sleeper wakes, or null. */
export function nextWakeBoundary(state = {}) {
  const now = Number(state.nowSeconds || 0);
  const times = sleepers(state).map((row) => wakeAtSeconds(state, row)).filter((at) => Number.isFinite(at) && at > now);
  return times.length ? Math.min(...times) : null;
}
const sleepers = (state) => Object.values(state.entities || {}).filter((row) => row?.kind === "character" && row.present !== false && isAsleep(row))
  .sort((a, b) => clean(a.id).localeCompare(clean(b.id)));

/** The first sleeper whose waking is due by now: { personId }, or null. */
export function dueWaking(state = {}) {
  const now = Number(state.nowSeconds || 0);
  const row = sleepers(state).find((entity) => wakeAtSeconds(state, entity) <= now);
  return row ? { personId: row.id } : null;
}

/** The new `sleep` value for someone lying down now. */
export function fallAsleep(state = {}, entity = {}, nowSeconds = Number(state.nowSeconds || 0)) {
  return { sleepiness: sleepinessAt(state, entity, nowSeconds), atSeconds: nowSeconds, asleep: true, sinceSeconds: nowSeconds, where: sleepPlace(state, entity) };
}

/** The new `sleep` value for someone waking now. */
export function wakeUp(state = {}, entity = {}, nowSeconds = Number(state.nowSeconds || 0)) {
  return { sleepiness: sleepinessAt(state, entity, nowSeconds), atSeconds: nowSeconds, asleep: false };
}

const sleptFor = (seconds) => {
  const hours = seconds / 3600;
  return hours >= 1 ? `睡了${hours >= 2 ? `${Math.round(hours)}个钟头` : "一个多钟头"}` : "打了个盹";
};

/**
 * A sleeper waking of themselves, as world fact: { operations, deliveries, resolvedEffects, caption }.
 * They are told they woke, how long they slept and the time of day; the caption names them (it is for the observer).
 */
export function wakingOutcome({ state = {}, personId = "", eventId = "" } = {}) {
  const now = Number(state.nowSeconds || 0);
  const person = state.entities?.[clean(personId)] || {};
  const slept = now - Number(person.sleep?.sinceSeconds ?? now);
  return {
    operations: [{ op: "set", path: ["entities", person.id, "sleep"], value: wakeUp(state, person, now) }],
    deliveries: [{ deliveryId: `delivery:${clean(eventId)}:${person.id}`, eventKind: "woke", modality: "proprioception", sourceCharacterId: person.id,
      recipientCharacterId: person.id, directed: true, urgent: true, content: `你醒了，${sleptFor(slept)}。${timeOfDayText(state, now)}` }],
    resolvedEffects: [{ kind: "woke", actorId: person.id, cause: "rested" }],
    caption: `${clean(person.name)}醒了。`,
  };
}

/**
 * Sleepers that what is being settled wakes: anyone asleep spoken to directly, or reached by something urgent.
 * { operations, resolvedEffects }, to fold into the same commit.
 */
export function rousedBy(state = {}, deliveries = [], nowSeconds = Number(state.nowSeconds || 0)) {
  const out = { operations: [], resolvedEffects: [] };
  const seen = new Set();
  for (const row of deliveries || []) {
    const id = clean(row.recipientCharacterId || row.recipientId);
    const person = state.entities?.[id];
    if (!person || seen.has(id) || !isAsleep(person) || id === clean(row.sourceCharacterId)) continue;
    if (row.directed !== true && row.urgent !== true) continue;
    seen.add(id);
    out.operations.push({ op: "set", path: ["entities", id, "sleep"], value: wakeUp(state, person, nowSeconds) });
    out.resolvedEffects.push({ kind: "woke", actorId: id, cause: "roused", byCharacterId: clean(row.sourceCharacterId) });
  }
  return out;
}
