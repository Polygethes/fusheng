// Going after someone. A chaser covers one stretch of the way in a beat, or
// two when clearly faster than the one they chase (a grown body after a
// child, the whole after the hurt); reaching them, they make a grab, settled
// like any grab. A line called out while walking is heard where the walk
// ends as well as where it began, so shouting after someone you are running
// toward reaches them. Water too deep to wade stops a chase like any walk.
import { powerOf, movementHeldBy } from "./confrontation.mjs";
import { healthOf } from "./characterHealth.mjs";
import { movementHindrance } from "./movementHindrance.mjs";

const clean = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
export const FASTER_BY = 1.25;

/** The zones walked through from one zone to another (excluding the start), or null when there is no way. */
export function routeBetween(place = {}, fromZoneId = "", toZoneId = "") {
  const from = clean(fromZoneId), to = clean(toZoneId);
  if (from === to) return [];
  const zones = place.topology?.zones || {};
  const previous = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const at = queue.shift();
    for (const edge of list(place.topology?.edges)) {
      const next = clean(edge.from) === at ? clean(edge.to) : clean(edge.to) === at ? clean(edge.from) : "";
      if (!next || previous.has(next) || zones[next]?.closed === true) continue;
      previous.set(next, at);
      if (next === to) {
        const path = [to];
        for (let step = at; step && step !== from; step = previous.get(step)) path.unshift(step);
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/**
 * How far a chase gets this beat, without side effects:
 * { ok, code, path: [zoneIds walked], reaches, faster }. `path` may be empty when the two already stand together.
 */
export function pursuitPlan({ state = {}, actorId = "", targetId = "", nowSeconds = Number(state.nowSeconds || 0) } = {}) {
  const actor = state.entities?.[clean(actorId)], target = state.entities?.[clean(targetId)];
  if (!actor) return { ok: false, code: "CHASE_ACTOR_UNKNOWN" };
  if (!target || target.kind !== "character" || target.present === false || target.id === actor.id || healthOf(target).state === "dead") return { ok: false, code: "CHASE_TARGET_UNKNOWN" };
  if (clean(target.placeId) !== clean(actor.placeId)) return { ok: false, code: "CHASE_TARGET_GONE" };
  if (movementHeldBy(state, actor.id)) return { ok: false, code: "MOVE_HELD" };
  const place = state.places?.[clean(actor.placeId)] || {};
  const route = routeBetween(place, actor.zoneId, target.zoneId);
  if (route === null) return { ok: false, code: "CHASE_NO_WAY" };
  if (!route.length) return { ok: true, code: "", path: [], reaches: true, faster: false };
  const faster = powerOf(actor, nowSeconds) >= powerOf(target, nowSeconds) * FASTER_BY;
  const path = [];
  for (const zoneId of route.slice(0, faster ? 2 : 1)) {
    if (movementHindrance(place, zoneId).blocked) break;
    path.push(zoneId);
  }
  if (!path.length) return { ok: false, code: "MOVE_BLOCKED_BY_FLOOD" };
  return { ok: true, code: "", path, reaches: path.at(-1) === clean(target.zoneId), faster };
}

/**
 * One utterance settled twice — where a walk began and where it ended — as
 * one result: whoever could hear it where the walk began does; the one it was
 * said to hears it where the walk ends too (bystanders there are left as they
 * were); it reached its target if it did at either end.
 */
export function mergeSpeechAlong(origin = {}, arrival = {}) {
  const ok = (row) => clean(row.status) === "success";
  const deliveries = new Map();
  for (const row of [...list(origin.deliveries), ...list(arrival.deliveries).filter((entry) => entry.directed === true)]) deliveries.set(`${clean(row.recipientCharacterId)}:${clean(row.eventKind)}`, row);
  const seen = new Set();
  const resolvedEffects = [];
  for (const row of [...list(arrival.resolvedEffects), ...list(origin.resolvedEffects)]) {
    if (seen.has(clean(row.kind))) continue;
    seen.add(clean(row.kind));
    resolvedEffects.push(row);
  }
  const reached = ok(origin) || ok(arrival);
  return { ...arrival, status: reached ? "success" : clean(arrival.status || origin.status), deliveries: [...deliveries.values()], resolvedEffects,
    failedEffects: reached ? [] : list(arrival.failedEffects) };
}

export const PURSUIT_FAILURES = Object.freeze({
  CHASE_ACTOR_UNKNOWN: "不知道是谁在追", CHASE_TARGET_UNKNOWN: "没有这个人", CHASE_TARGET_GONE: "对方已经不在这一带了", CHASE_NO_WAY: "没有路过去",
});
