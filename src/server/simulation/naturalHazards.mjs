// What the water does to people. When the stream comes down in a deluge,
// anyone standing at the water's edge may be swept away — taken by the flood,
// gone from the valley — and anyone standing in the floodwater further up may
// be knocked off their feet. A strong body holds on better; someone lying on
// the ground cannot hold on at all. Each person draws once, at the moment the
// deluge arrives, from a number fixed by the event and the person, so the same
// world always plays out the same way. Each onlooker is told it in their own
// terms: a name they know, a stranger's look.
import { healthOf, healthStep, wound } from "./characterHealth.mjs";
import { rollFor, powerOf, personFor } from "./confrontation.mjs";
import { zoneFlooded } from "./worldEnvironment.mjs";
import { perceivableRoute } from "./worldActionRegistry.mjs";

// How near open water (in map tiles) a deluge can take a person off their feet and away.
export const SWEPT_WITHIN = 1;
const KNOCKED_DOWN_WOUND = 0.08;
const clean = (value) => String(value ?? "").trim();
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** The chance the current takes this person off the bank: the weak and the fallen go more easily. */
export function sweepChance(entity = {}, nowSeconds = 0) {
  if (healthOf(entity).state === "down") return 1;
  return clamp(0.85 - 0.4 * powerOf(entity, nowSeconds), 0.3, 0.95);
}

/** The chance someone standing in floodwater away from the edge is knocked off their feet. */
export function knockChance(entity = {}, nowSeconds = 0) {
  return clamp(0.25 - 0.15 * powerOf(entity, nowSeconds), 0.05, 0.25);
}

// What the observer's caption says, with the name (the observer sees everyone).
export const HAZARD_CAPTION = Object.freeze({
  swept_away: (name) => `${name}被山洪卷走了，转眼就没了踪影。`,
  kept_footing: (name) => `${name}在洪水里站不稳，死死抓住了东西，才没被卷走。`,
  knocked_down: (name) => `${name}被大水冲倒在水里，又挣扎着站了起来。`,
});
const FELT = Object.freeze({
  kept_footing: "山洪冲上岸来，你被冲得站不稳，死死抓住身边的东西，才没被卷走。",
  knocked_down: "大水冲过来，把你冲倒在水里，呛了好几口水，才挣扎着站起来。",
});
const SEEN = Object.freeze({
  swept_away: (who) => `${who}被山洪卷走了，转眼就没了踪影。`,
  kept_footing: (who) => `${who}在洪水里站不稳，差点被卷走。`,
  knocked_down: (who) => `${who}被大水冲倒在水里，又挣扎着站了起来。`,
});

/**
 * What a deluge arriving does to the people in its water, as world fact to
 * fold into the environment event: { operations, deliveries, resolvedEffects,
 * hazards: [{ characterId, outcome }], goneIds }. Nothing unless this change
 * is the stream coming down in a deluge.
 */
export function floodHazards({ state = {}, place = {}, environment = {}, changes = [], eventId = "" } = {}) {
  const result = { operations: [], deliveries: [], resolvedEffects: [], hazards: [], goneIds: [] };
  if (!(changes || []).some((row) => row.level === "stream" && row.to === "deluge")) return result;
  const now = Number(state.nowSeconds || 0);
  const people = Object.values(state.entities || {}).filter((row) => row?.kind === "character" && row.present !== false
    && clean(row.placeId) === clean(place.id) && healthOf(row).state !== "dead");
  for (const person of people) {
    const zone = place.topology?.zones?.[clean(person.zoneId)] || {};
    if (!zoneFlooded(environment, zone)) continue;
    const roll = rollFor(`${clean(eventId)}:${person.id}`);
    let outcome = "";
    if (Number(zone.waterDistance) <= SWEPT_WITHIN) outcome = roll < sweepChance(person, now) ? "swept_away" : "kept_footing";
    else if (healthOf(person).state !== "down" && roll < knockChance(person, now)) outcome = "knocked_down";
    if (!outcome) continue;
    result.hazards.push({ characterId: person.id, outcome });
    result.resolvedEffects.push({ kind: "flood_hazard", characterId: person.id, outcome });
    if (outcome === "swept_away") {
      const { downSinceSeconds, ...before } = healthOf(person);
      const health = { ...before, wounds: 1, woundsAtSeconds: now, state: "dead", cause: "swept_away", diedAtSeconds: now };
      result.operations.push({ op: "set", path: ["entities", person.id, "health"], value: health });
      result.operations.push({ op: "set", path: ["entities", person.id, "present"], value: false });
      result.resolvedEffects.push({ kind: "health_changed", actorId: person.id, event: "died", state: "dead", cause: "swept_away" });
      result.goneIds.push(person.id);
    } else if (outcome === "knocked_down") {
      const health = healthStep({ health: wound(healthOf(person), KNOCKED_DOWN_WOUND, now, "flood"), body: {}, nowSeconds: now }).health;
      result.operations.push({ op: "set", path: ["entities", person.id, "health"], value: health });
    }
    if (FELT[outcome]) result.deliveries.push({ deliveryId: `delivery:${clean(eventId)}:flood:${person.id}:${person.id}`, eventKind: "flood_hazard",
      modality: "bodily", sourceCharacterId: person.id, recipientCharacterId: person.id, directed: true, urgent: true, occurredAtSeconds: now, content: FELT[outcome] });
    for (const viewer of people) {
      if (viewer.id === person.id || healthOf(viewer).state === "down") continue;
      if (perceivableRoute(place, person.zoneId, viewer.zoneId, "visual") == null) continue;
      result.deliveries.push({ deliveryId: `delivery:${clean(eventId)}:flood:${person.id}:${viewer.id}`, eventKind: "flood_hazard",
        modality: "visual", sourceCharacterId: person.id, recipientCharacterId: viewer.id, directed: false, urgent: true, occurredAtSeconds: now,
        content: SEEN[outcome](personFor(state, viewer.id, person.id)) });
    }
  }
  // The water's news is not told to someone it has just taken.
  result.deliveries = result.deliveries.filter((row) => !result.goneIds.includes(row.recipientCharacterId));
  return result;
}
