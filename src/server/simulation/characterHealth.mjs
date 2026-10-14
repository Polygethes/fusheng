// Life and death. A person's wounds are world fact (blows, falls, floods put
// them there); fever, heatstroke, cold, thirst and hunger are their own body.
// Whichever is worse decides how they are: well, hurt, badly hurt, down
// (collapsed, unconscious) or dead. Someone down who stays in crisis dies;
// someone whose crisis eases comes round. Wounds mend slowly with time.
// Others see a person lying still; only a closer look tells breath from none.
export const HEALTH_STATES = Object.freeze(["well", "hurt", "badly_hurt", "down", "dead"]);
export const COLLAPSE_AT = 0.9;
export const COME_ROUND_BELOW = 0.6;
export const DIE_AFTER_DOWN_SECONDS = 2 * 3600;
export const WOUNDS_MEND_PER_HOUR = 0.01;

const clamp = (value) => Math.min(1, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0));
const clean = (value) => String(value ?? "").trim();

export function healthOf(entity = {}) {
  const health = entity?.health || {};
  return { wounds: clamp(health.wounds), woundsAtSeconds: Number(health.woundsAtSeconds) || 0, state: HEALTH_STATES.includes(health.state) ? health.state : "well",
    ...(Number.isFinite(Number(health.downSinceSeconds)) ? { downSinceSeconds: Number(health.downSinceSeconds) } : {}),
    ...(clean(health.cause) ? { cause: clean(health.cause) } : {}),
    ...(Number.isFinite(Number(health.diedAtSeconds)) ? { diedAtSeconds: Number(health.diedAtSeconds) } : {}) };
}

/** Wounds as they stand now, having mended since they were last recorded. The dead do not mend. */
export function woundsNow(health = {}, nowSeconds = 0) {
  if (health.state === "dead") return clamp(health.wounds);
  const hours = Math.max(0, (Number(nowSeconds) || 0) - (Number(health.woundsAtSeconds) || 0)) / 3600;
  return clamp(clamp(health.wounds) - WOUNDS_MEND_PER_HOUR * hours);
}

/** New wounds on top of the old: severity adds, never beyond 1. */
export function wound(health = {}, severity = 0, nowSeconds = 0, cause = "") {
  const current = woundsNow(health, nowSeconds);
  return { ...health, wounds: clamp(current + clamp(severity)), woundsAtSeconds: Number(nowSeconds) || 0, ...(clean(cause) ? { cause: clean(cause) } : {}) };
}

/** The worst thing the body itself is going through: { level, cause }. */
export function bodyCrisis(body = {}) {
  const rows = [
    [clamp(body.illness), "fever"],
    [clamp(body.heatstroke), "heatstroke"],
    [clamp(body.hypothermia), "cold"], // freezing, not merely being cold: it builds up only in real cold
    // Thirst and hunger wear a person down to their knees but do not kill: the world has no sure way yet to eat and drink.
    [clamp(body.thirst) >= 1 ? 0.85 : 0, "thirst"],
    [clamp(body.hunger) >= 1 ? 0.8 : 0, "hunger"],
  ];
  const [level, cause] = rows.reduce((best, row) => (row[0] > best[0] ? row : best), [0, ""]);
  return { level, cause };
}

const stateForSeverity = (severity) => (severity >= 0.6 ? "badly_hurt" : severity >= 0.3 ? "hurt" : "well");

/**
 * One step of a person's health at `nowSeconds`, from the world's record and
 * their body: { health, event } where event is "collapsed", "came_round",
 * "died" or "" (no visible change of state).
 */
export function healthStep({ health: given = {}, body = {}, nowSeconds = 0 } = {}) {
  const health = healthOf({ health: given });
  if (health.state === "dead") return { health, event: "" };
  const now = Number(nowSeconds) || 0;
  const wounds = woundsNow(health, now);
  const crisis = bodyCrisis(body);
  const severity = Math.max(wounds, crisis.level);
  const cause = wounds >= crisis.level ? (health.cause || "wounds") : crisis.cause;
  const base = { ...health, wounds, woundsAtSeconds: now };
  if (health.state === "down") {
    const downFor = now - (health.downSinceSeconds ?? now);
    if (wounds >= 1 || (severity >= COLLAPSE_AT && downFor >= DIE_AFTER_DOWN_SECONDS)) {
      return { health: { ...base, state: "dead", cause, diedAtSeconds: now }, event: "died" };
    }
    if (severity < COME_ROUND_BELOW) {
      const { downSinceSeconds, ...rest } = base;
      return { health: { ...rest, state: stateForSeverity(severity) }, event: "came_round" };
    }
    return { health: base, event: "" };
  }
  if (severity >= COLLAPSE_AT || wounds >= 0.85) return { health: { ...base, state: "down", downSinceSeconds: now, cause }, event: "collapsed" };
  return { health: { ...base, state: stateForSeverity(severity) }, event: "" };
}

// How someone who is unwell looks, by what is wrong with them: wounds show as wounds, a fever as a fever.
const LOOKS = {
  badly_hurt: { wounds: "伤得很重，站都站不稳", fever: "病得很重，站都站不稳", heatstroke: "中了暑，站都站不稳",
    cold: "冻得脸色发青，站都站不稳", thirst: "渴得嘴唇干裂，站都站不稳", hunger: "饿得站都站不稳" },
  hurt: { wounds: "身上带着伤", fever: "脸色发红，像在发烧", heatstroke: "满脸通红，像是中了暑",
    cold: "冻得直打哆嗦", thirst: "嘴唇干裂", hunger: "脸色蜡黄，没什么力气" },
};

/** How the person looks to others: at a glance, or on a closer look. "" when nothing shows. */
export function observableCondition(health = {}, { examined = false } = {}) {
  const { state, cause = "" } = healthOf({ health });
  if (state === "dead") return examined ? "倒在地上，已经没了气息" : "倒在地上，一动不动";
  if (state === "down") return examined ? "倒在地上，还有气，昏过去了" : "倒在地上，一动不动";
  const looks = LOOKS[state];
  return looks ? looks[cause in looks ? cause : "wounds"] : "";
}

/** The change as it happened to the named person (their own record, the observer's caption). */
export function healthNews(event = "", name = "") {
  if (event === "collapsed") return `${name}身子一软，倒在了地上。`;
  if (event === "came_round") return `${name}慢慢醒了过来。`;
  return "";
}

/**
 * What onlookers notice. No name: whether they know who it is is their own
 * knowledge, shown where they see the people around them. A death is not
 * announced; it shows only as stillness, and a closer look tells.
 */
export function onlookerNews(event = "") {
  if (event === "collapsed") return "有人身子一软，倒在了地上。";
  if (event === "came_round") return "倒在地上的人慢慢醒了过来。";
  return "";
}

/** The body as wounds make it feel: pain at least as bad as the wounds, strength capped by them. */
export function bodyWithWounds(body = {}, wounds = 0) {
  const w = clamp(wounds);
  if (w <= 0) return body;
  return { ...body, pain: Math.max(clamp(body.pain), clamp(w * 0.9)), stamina: Math.min(clamp(body.stamina ?? 1), clamp(1 - w * 0.6)) };
}
