// When the weather's work becomes visible — the stream over its banks, snow up
// to the ankle — who notices, and when the world must stop to settle it.
import { environmentChangesAt, floodRadius, nextEnvironmentChangeAt, settleEnvironmentStages, STAGE_NEWS, zoneFlooded } from "./worldEnvironment.mjs";

const clean = (value) => String(value ?? "").trim();
// Same rule as worldEvents' zoneIsOutdoor, kept here so the clock does not import the action registry.
const outdoorsIn = (place = {}, zoneId = "") => {
  const id = clean(zoneId);
  if (!id.includes("__")) return true;
  return clean((place.sites || []).find((row) => clean(row.id) === id.split("__")[0])?.kind) !== "building";
};
// How many tiles from open water a person out of doors notices the stream change.
const STREAM_RANGE = Object.freeze({ high: 8, flood: 12, normal: 8, low: 8 });

const placesWithEnvironment = (state = {}) => Object.values(state.places || {}).filter((place) => place?.environment);

/** The earliest moment after now at which any place's environment changes stage, or null. */
export function nextWorldEnvironmentBoundary(state = {}) {
  const now = Math.max(0, Number(state.nowSeconds || 0));
  const times = placesWithEnvironment(state).map((place) => nextEnvironmentChangeAt(place.environment, now)).filter((at) => Number.isFinite(at) && at > now);
  return times.length ? Math.min(...times) : null;
}

/** The first place whose environment has changed stage by now: { place, changes, environment } (environment settled), or null. */
export function dueEnvironmentChange(state = {}) {
  const now = Math.max(0, Number(state.nowSeconds || 0));
  for (const place of placesWithEnvironment(state)) {
    const changes = environmentChangesAt(place.environment, now);
    if (changes.length) return { place, changes, environment: settleEnvironmentStages(place.environment, now) };
  }
  return null;
}

/** Who notices each change, and what they notice. */
export function environmentDeliveries(state = {}, place = {}, changes = [], environment = {}, eventId = "") {
  const now = Math.max(0, Number(state.nowSeconds || 0));
  const zones = place.topology?.zones || {};
  const people = Object.values(state.entities || {}).filter((row) => row?.kind === "character" && row.present !== false && clean(row.placeId) === clean(place.id));
  const deliveries = [];
  for (const change of changes) {
    const content = STAGE_NEWS[change.level]?.[change.to];
    if (!content) continue;
    for (const person of people) {
      const zone = zones[clean(person.zoneId)] || {};
      const outdoors = outdoorsIn(place, person.zoneId);
      const underWater = change.level === "stream" && zoneFlooded(environment, zone);
      const notices = change.level !== "stream" ? outdoors
        : change.to === "deluge" || underWater || (outdoors && Number(zone.waterDistance) <= (STREAM_RANGE[change.to] ?? 8));
      if (!notices) continue;
      deliveries.push({ deliveryId: `delivery:${eventId}:${change.level}:${person.id}`, recipientCharacterId: person.id,
        eventKind: "environment_changed", modality: change.to === "deluge" && !outdoors ? "sound" : "visual",
        directed: false, urgent: underWater || change.to === "deluge", occurredAtSeconds: now,
        content: underWater ? `${content}水漫到了你脚下。` : content });
    }
  }
  return deliveries;
}

/** What the stage needs to draw it: stages and how far the water has spread. */
export function environmentView(environment = null) {
  return environment ? { stages: { ...environment.stages }, floodRadius: floodRadius(environment) } : null;
}
