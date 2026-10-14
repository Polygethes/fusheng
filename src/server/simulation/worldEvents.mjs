// Player world events — 天意 (spec §10). The player may change the weather,
// put a thing somewhere, send someone a message, cause a small mishap to an
// object, or give one person a passing thought (授意). The world settles it
// like any other fact: the state changes, and only the people who can
// actually see, hear or are addressed receive evidence of it. Nothing here
// speaks for anyone; a thought is felt only by its one person, who is free
// to act on it or not. Weather needs to know which zones are outdoors, which
// only compiled towns say.
import { perceivableRoute } from "./worldActionRegistry.mjs";
import { WEATHER_KINDS } from "../../worlds/weatherKinds.mjs";
import { rebaseEnvironment } from "./worldEnvironment.mjs";

export const WORLD_EVENT_KINDS = Object.freeze(["weather", "object", "message", "accident", "urge"]);
export const WEATHER = Object.freeze(Object.fromEntries(WEATHER_KINDS.map(({ id, label, content, light, ambientNoise }) => [id, Object.freeze({ label, content, light, ambientNoise })])));
const TEXT_LIMIT = 200;

const clean = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const clone = (value) => JSON.parse(JSON.stringify(value));

function townPlace(state = {}) {
  return Object.values(state.places || {}).find((place) => Array.isArray(place.sites)) || null;
}
/** The place whose zones include this one. */
function placeOfZone(state = {}, zoneId = "") {
  return Object.values(state.places || {}).find((place) => place?.topology?.zones?.[clean(zoneId)]) || null;
}
/** Outdoors: streets, the plaza and outdoor sites; indoors: rooms of a building. */
export function zoneIsOutdoor(place = {}, zoneId = "") {
  const id = clean(zoneId);
  if (!id.includes("__")) return true;
  const site = list(place.sites).find((row) => clean(row.id) === id.split("__")[0]);
  return clean(site?.kind) !== "building";
}
const characters = (state) => Object.values(state.entities || {}).filter((row) => row?.kind === "character" && row.present !== false);

export function validateWorldEvent(state = {}, event = {}) {
  const issues = [];
  const add = (field, message) => issues.push({ field, message });
  if (!Object.keys(state.places || {}).length) return [{ field: "world", message: "这个世界还不支持天意。" }];
  const kind = clean(event.kind);
  if (!WORLD_EVENT_KINDS.includes(kind)) return [{ field: "kind", message: "只能是天气、东西出现、口信、小意外或授意。" }];
  if (kind === "weather") {
    if (!townPlace(state)) {
      add("weather", "这个世界还没标出哪里在屋外，暂时不能改天气。");
    } else if (!WEATHER[clean(event.weather)]) {
      add("weather", `天气只能是${WEATHER_KINDS.map((row) => row.label).join("、")}。`);
    }
  }
  if (kind === "object") {
    if (!clean(event.label) || clean(event.label).length > 24) add("label", "写一个 1–24 字的东西名字。");
    if (!placeOfZone(state, event.zoneId)) add("zoneId", "选一个地方。");
    if (clean(event.description).length > TEXT_LIMIT) add("description", `描述不超过 ${TEXT_LIMIT} 字。`);
  }
  if (kind === "message") {
    const person = state.entities?.[clean(event.toCharacterId)];
    if (person?.kind !== "character" || person.present === false) add("toCharacterId", "选一个在镇上的人。");
    if (!clean(event.text) || clean(event.text).length > TEXT_LIMIT) add("text", `口信写 1–${TEXT_LIMIT} 字。`);
  }
  if (kind === "accident") {
    const object = state.objects?.[clean(event.objectId)];
    if (!object || object.kind === "position") add("objectId", "选一件东西。");
    if (!/^[A-Za-z_][\w]{0,31}$/u.test(clean(event.stateKey))) add("stateKey", "状态名只能用字母、数字和下划线。");
    if (!["string", "number", "boolean"].includes(typeof event.value)) add("value", "状态值只能是文字、数字或真假。");
    if (!clean(event.description) || clean(event.description).length > TEXT_LIMIT) add("description", `写 1–${TEXT_LIMIT} 字，说清看上去发生了什么。`);
  }
  if (kind === "urge") {
    const person = state.entities?.[clean(event.toCharacterId)];
    if (person?.kind !== "character" || person.present === false) add("toCharacterId", "选一个在场的人。");
    if (!clean(event.text) || clean(event.text).length > 100) add("text", "念头写 1–100 字。");
  }
  return issues;
}

/**
 * The settlement of one valid event: state operations, the public facts, and
 * the deliveries to everyone who perceives it.
 */
export function settleWorldEvent(state = {}, event = {}, { eventId = "world-event:player" } = {}) {
  const kind = clean(event.kind);
  const operations = [];
  const facts = [];
  const deliveries = [];
  const deliver = (recipient, row) => deliveries.push({ deliveryId: `delivery:${eventId}:${recipient.id}`, modality: "visual", sourceCharacterId: "",
    recipientCharacterId: recipient.id, provenance: { kind: "player_world_event" }, ...row });
  const seers = (zoneId) => {
    const targetPlace = placeOfZone(state, zoneId);
    if (!targetPlace) return [];
    return characters(state).filter((row) => clean(row.placeId) === clean(targetPlace.id) && perceivableRoute(targetPlace, row.zoneId, zoneId, "visual") != null);
  };

  if (kind === "weather") {
    const place = townPlace(state);
    const weather = WEATHER[clean(event.weather)];
    operations.push({ op: "set", path: ["places", place.id, "perceptionEnvironment"], value: { ...clone(place.perceptionEnvironment || {}),
      weather: clean(event.weather), light: weather.light, ambientNoise: weather.ambientNoise } });
    if (place.environment) operations.push({ op: "set", path: ["places", place.id, "environment"], value: rebaseEnvironment(place.environment, Number(state.nowSeconds || 0), clean(event.weather)) });
    facts.push({ kind: "weather_changed", weather: clean(event.weather), label: weather.label });
    for (const person of characters(state)) {
      if (clean(person.placeId) === clean(place.id) && zoneIsOutdoor(place, person.zoneId)) deliver(person, { eventKind: "weather", content: weather.content });
    }
  }
  if (kind === "object") {
    const targetPlace = placeOfZone(state, event.zoneId);
    const n = Object.keys(state.objects || {}).filter((id) => id.startsWith("world-event-object:")).length + 1;
    const id = `world-event-object:${n}`;
    const label = clean(event.label);
    operations.push({ op: "set", path: ["objects", id], value: { id, label, zoneId: clean(event.zoneId), initialHolderActorId: null, portable: true,
      state: {}, presentation: { exposure: "public" }, kind: "object", placeId: targetPlace?.id || "", holderCharacterId: "",
      perception: { publicLabel: label, description: clean(event.description) }, source: "player_world_event" } });
    facts.push({ kind: "object_appeared", objectId: id, label, zoneId: clean(event.zoneId) });
    const zoneLabel = clean(targetPlace?.topology?.zones?.[clean(event.zoneId)]?.label || event.zoneId);
    for (const person of seers(clean(event.zoneId))) {
      deliver(person, { eventKind: "object_appeared", sourceObjectId: id, content: `${zoneLabel}多了一样东西：${label}。${clean(event.description)}`.trim() });
    }
  }
  if (kind === "message") {
    const person = state.entities[clean(event.toCharacterId)];
    facts.push({ kind: "message_delivered", toCharacterId: person.id });
    deliver(person, { eventKind: "message", modality: "sound", directed: true, content: `有人捎来口信${clean(event.from) ? `（说是${clean(event.from)}托的）` : ""}：${clean(event.text)}` });
  }
  if (kind === "accident") {
    const object = state.objects[clean(event.objectId)];
    operations.push({ op: "set", path: ["objects", object.id, "state", clean(event.stateKey)], value: event.value });
    facts.push({ kind: "object_mishap", objectId: object.id, stateKey: clean(event.stateKey), value: event.value });
    const zoneId = object.holderCharacterId ? state.entities?.[object.holderCharacterId]?.zoneId : object.zoneId;
    const people = new Map(seers(clean(zoneId)).map((row) => [row.id, row]));
    if (object.holderCharacterId && state.entities?.[object.holderCharacterId]) people.set(object.holderCharacterId, state.entities[object.holderCharacterId]);
    for (const person of people.values()) deliver(person, { eventKind: "object_mishap", sourceObjectId: object.id, content: clean(event.description) });
  }
  if (kind === "urge") {
    const person = state.entities[clean(event.toCharacterId)];
    facts.push({ kind: "urge_given", toCharacterId: person.id });
    deliver(person, { eventKind: "urge", modality: "proprioception", content: `你心里忽然冒出一个念头：${clean(event.text)}` });
  }
  return { operations, facts, deliveries };
}
