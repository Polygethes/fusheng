// What the weather leaves in the world over time: how high the stream runs,
// how wet the ground is, how deep the snow lies, how dry the land has gone.
// Each level drifts toward what the current weather pushes it to, at that
// weather's pace; melting snow feeds the stream. Levels are a pure function of
// the levels recorded at `sinceSeconds`, the weather since then and the time
// now, so the world can say where they stand at any moment and when the next
// visible change (a stage: the stream bursting its banks, snow up to the
// ankle) will come, without ticking every minute.
export const ENVIRONMENT_LEVELS = Object.freeze(["stream", "ground", "snow", "dryness"]);
const STEP_SECONDS = 300;
const HORIZON_SECONDS = 2 * 24 * 3600;

// Per weather, per level: [target, speed per hour].
export const ENVIRONMENT_DRIFT = Object.freeze({
  clear: { stream: [0.3, 0.03], ground: [0, 0.06], snow: [0, 0.04], dryness: [0.4, 0.005] },
  rain: { stream: [1, 0.06], ground: [1, 0.12], snow: [0, 0.08], dryness: [0, 0.2] },
  storm: { stream: [1, 0.18], ground: [1, 0.3], snow: [0, 0.12], dryness: [0, 0.3] },
  fog: { stream: [0.3, 0.02], ground: [0.2, 0.02], snow: [0, 0.01], dryness: [0.2, 0.02] },
  wind: { stream: [0.3, 0.03], ground: [0, 0.08], snow: [0, 0.02], dryness: [0.5, 0.01] },
  heat: { stream: [0.25, 0.04], ground: [0, 0.15], snow: [0, 0.15], dryness: [0.7, 0.02] },
  drought: { stream: [0.05, 0.05], ground: [0, 0.1], snow: [0, 0.08], dryness: [1, 0.05] },
  snow: { stream: [0.3, 0.01], ground: [0.3, 0.02], snow: [1, 0.12], dryness: [0, 0.05] },
  blizzard: { stream: [0.3, 0.01], ground: [0.3, 0.03], snow: [1, 0.3], dryness: [0, 0.05] },
});
export const MELT_TO_STREAM = 0.5;
export const DEFAULT_LEVELS = Object.freeze({ stream: 0.3, ground: 0.1, snow: 0, dryness: 0.2 });

// Highest threshold first; a level is in the first stage whose minimum it reaches.
export const ENVIRONMENT_STAGES = Object.freeze({
  stream: [[0.95, "deluge"], [0.75, "flood"], [0.5, "high"], [0.12, "normal"], [0, "low"]],
  ground: [[0.85, "waterlogged"], [0.6, "puddles"], [0.3, "muddy"], [0, "dry"]],
  snow: [[0.7, "deep"], [0.35, "ankle"], [0.05, "dusting"], [0, "none"]],
  dryness: [[0.85, "parched"], [0.6, "dry"], [0, "normal"]],
});

// How far (in map tiles from open water) the stream has spread at each stage.
export const FLOOD_RADIUS = Object.freeze({ deluge: 5, flood: 2 });

const clamp = (value) => Math.min(1, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0));
const levelsOf = (levels = {}) => Object.fromEntries(ENVIRONMENT_LEVELS.map((key) => [key, clamp(levels[key] ?? DEFAULT_LEVELS[key])]));

export function stageOf(level, value) {
  return (ENVIRONMENT_STAGES[level] || []).find(([minimum]) => clamp(value) >= minimum)?.[1] || "";
}
export function stagesOf(levels = {}) {
  return Object.fromEntries(ENVIRONMENT_LEVELS.map((key) => [key, stageOf(key, levels[key])]));
}

export function createEnvironment({ weather = "clear", nowSeconds = 0, levels = {} } = {}) {
  const start = levelsOf(levels);
  return { schemaVersion: 1, weather: ENVIRONMENT_DRIFT[weather] ? weather : "clear", sinceSeconds: Math.max(0, Number(nowSeconds) || 0), levels: start, stages: stagesOf(start) };
}

function drift(levels, weather, seconds) {
  const row = ENVIRONMENT_DRIFT[weather] || ENVIRONMENT_DRIFT.clear;
  const hours = seconds / 3600;
  const next = { ...levels };
  for (const key of ENVIRONMENT_LEVELS) {
    const [target, speed] = row[key];
    const gap = target - levels[key];
    next[key] = clamp(levels[key] + Math.sign(gap) * Math.min(Math.abs(gap), speed * hours));
  }
  const melted = Math.max(0, levels.snow - next.snow);
  next.stream = clamp(next.stream + MELT_TO_STREAM * melted);
  return next;
}

/** The levels at `atSeconds`, stepping from `sinceSeconds` in fixed five-minute steps (the last one partial). */
export function environmentAt(environment = {}, atSeconds = 0) {
  const since = Math.max(0, Number(environment.sinceSeconds) || 0);
  let levels = levelsOf(environment.levels);
  let t = since;
  const end = Math.max(since, Number(atSeconds) || 0);
  while (t + STEP_SECONDS <= end) { levels = drift(levels, environment.weather, STEP_SECONDS); t += STEP_SECONDS; }
  if (end > t) levels = drift(levels, environment.weather, end - t);
  return levels;
}

/** Same stages, levels carried to `nowSeconds`, and from then on the new weather. */
export function rebaseEnvironment(environment = {}, nowSeconds = 0, weather = environment.weather) {
  const now = Math.max(Number(environment.sinceSeconds) || 0, Number(nowSeconds) || 0);
  return { ...environment, schemaVersion: 1, weather: ENVIRONMENT_DRIFT[weather] ? weather : "clear", sinceSeconds: now, levels: environmentAt(environment, now) };
}

/** Stages that differ at `nowSeconds` from the stages last recorded: [{ level, from, to }]. */
export function environmentChangesAt(environment = {}, nowSeconds = 0) {
  const current = stagesOf(environmentAt(environment, nowSeconds));
  return ENVIRONMENT_LEVELS.filter((key) => current[key] !== environment.stages?.[key])
    .map((key) => ({ level: key, from: environment.stages?.[key] || "", to: current[key] }));
}

/** The first five-minute mark after `nowSeconds` (within two days) at which a stage changes, or null. */
export function nextEnvironmentChangeAt(environment = {}, nowSeconds = 0) {
  const since = Math.max(0, Number(environment.sinceSeconds) || 0);
  const now = Math.max(since, Number(nowSeconds) || 0);
  if (environmentChangesAt(environment, now).length) return now;
  let levels = levelsOf(environment.levels);
  for (let t = since + STEP_SECONDS; t <= now + HORIZON_SECONDS; t += STEP_SECONDS) {
    levels = drift(levels, environment.weather, STEP_SECONDS);
    if (t <= now) continue;
    const stages = stagesOf(levels);
    if (ENVIRONMENT_LEVELS.some((key) => stages[key] !== environment.stages?.[key])) return t;
  }
  return null;
}

/** Record the stages as they are at `nowSeconds` (levels carried there too). */
export function settleEnvironmentStages(environment = {}, nowSeconds = 0) {
  const rebased = rebaseEnvironment(environment, nowSeconds);
  return { ...rebased, stages: stagesOf(rebased.levels) };
}

/** How many tiles from open water are under water, or -1 when the stream is within its banks. */
export function floodRadius(environment = {}) {
  return FLOOD_RADIUS[environment.stages?.stream] ?? -1;
}

/** Whether a zone (with its compiled `waterDistance` in tiles) is under water. */
export function zoneFlooded(environment = {}, zone = {}) {
  const distance = Number(zone?.waterDistance);
  return Number.isFinite(distance) && distance <= floodRadius(environment);
}

// What a stage change looks like to those who notice it.
export const STAGE_NEWS = Object.freeze({
  stream: { high: "溪水涨起来了，哗哗地响。", flood: "溪水漫过了岸，岸边一片汪洋。", deluge: "山洪下来了，浑水冲上了路。", normal: "溪水退回了河道。", low: "溪水浅得见了底。" },
  ground: { muddy: "地上泥泞起来了。", puddles: "路上积起了一个个水洼。", waterlogged: "低处积满了水。", dry: "地上干了。" },
  snow: { dusting: "地上落了薄薄一层雪。", ankle: "积雪没过了脚面。", deep: "积雪深得没过了小腿。", none: "雪化完了。" },
  dryness: { dry: "地上干得发白，起了浮土。", parched: "地干裂了口子，草都蔫了。", normal: "地上不那么干了。" },
});
