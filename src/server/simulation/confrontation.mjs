// Laying hands on someone: a shove, a blow, a grab. The world settles it by
// who is stronger (age, wounds, a working body), what is in the hand, and a
// fixed draw for this attempt; the result is a fact — a miss, a stumble, a
// fall, a wound, someone held fast — that the target feels and onlookers see.
// Each person is told it in their own terms: a name for someone they know,
// how the person looks for a stranger, "你" for themselves.
import { healthOf, healthStep, wound, woundsNow } from "./characterHealth.mjs";

export const CONFRONT_ACTS = Object.freeze(["strike", "shove", "grab"]);
const LABOURING_SKILLS = new Set(["hunting", "woodcutting", "smithing", "farming", "carpentry"]);
const WEAPON = /剑|刀|斧|锄|镰|叉|棍|棒|杖|锤/u;
const BLADE = /剑|刀|斧|镰/u;
const clean = (value) => String(value ?? "").trim();
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** A fixed number in [0, 1) for this attempt: the same attempt always draws the same. */
export function rollFor(attemptId = "") {
  let x = 2166136261;
  for (const ch of String(attemptId)) x = Math.imul(x ^ ch.codePointAt(0), 16777619);
  x = Math.imul(x ^ (x >>> 15), 2246822507);
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
}

/** How hard a person can push or hit: a grown body, less for a child or the old, less still when hurt. */
export function powerOf(entity = {}, nowSeconds = 0) {
  const age = { child: 0.4, old: 0.6 }[clean(entity.ageGroup)] ?? 1;
  const labour = (entity.skills || []).some((id) => LABOURING_SKILLS.has(clean(id))) ? 1.15 : 1;
  return age * labour * (1 - 0.6 * woundsNow(healthOf(entity), nowSeconds));
}

/** What the person has in hand to hit with, if anything: { id, label, blade }. */
export function weaponInHand(state = {}, actorId = "") {
  // Only what is actually in the hand: a sword at the side or a hoe carried along is not a weapon yet.
  const row = Object.values(state.objects || {}).find((object) => clean(object.holderCharacterId) === clean(actorId)
    && object.custody?.inHand === true && object.state?.sheathed !== true && WEAPON.test(clean(object.label)));
  return row ? { id: row.id, label: clean(row.label), blade: BLADE.test(clean(row.label)) } : null;
}

/** How `observerId` would name `personId`: "你", a known name, else how they look, else "有人". */
export function personFor(state = {}, observerId = "", personId = "") {
  if (clean(observerId) === clean(personId)) return "你";
  const person = state.entities?.[clean(personId)] || {};
  const observer = state.entities?.[clean(observerId)] || {};
  const knows = !Array.isArray(observer.knownActorIds) || observer.knownActorIds.includes(clean(personId));
  if (knows && clean(person.name)) return clean(person.name);
  // A stranger by how they look, the first part of it ("浑身湿透的年轻男人，手上缠着…" reads as the man, not his hands).
  return clean(clean((person.publicSignalFeatures || []).find((row) => row.featureId === "look")?.physicalFeature).split(/[，,]/u)[0]) || "有人";
}

/**
 * The settled confrontation, without side effects: { ok, code, outcome, health, held, surfaceText, tell(observerId) }.
 * `roll` is in [0, 1); lower is better for the one who acts.
 */
export function confrontationOutcome({ state = {}, actorId = "", targetId = "", act = "", roll = 0.5, nowSeconds = Number(state.nowSeconds || 0) } = {}) {
  const actor = state.entities?.[clean(actorId)], target = state.entities?.[clean(targetId)];
  if (!CONFRONT_ACTS.includes(act)) return { ok: false, code: "CONFRONT_ACT_UNKNOWN" };
  if (!target || target.kind !== "character" || target.present === false || target.id === actor?.id) return { ok: false, code: "CONFRONT_TARGET_UNKNOWN" };
  if (clean(target.placeId) !== clean(actor?.placeId) || clean(target.zoneId) !== clean(actor?.zoneId)) return { ok: false, code: "CONFRONT_TARGET_NOT_HERE" };
  const targetHealth = healthOf(target);
  const lying = ["down", "dead"].includes(targetHealth.state);
  const edge = powerOf(actor, nowSeconds) - powerOf(target, nowSeconds);
  const held = clean(target.heldBy) === clean(actor.id);
  const weapon = act === "strike" ? weaponInHand(state, actor.id) : null;
  let outcome, health = null, heldBy;
  if (act === "strike") {
    const chance = lying ? 0.95 : clamp(0.55 + 0.3 * edge + (held ? 0.3 : 0), 0.1, 0.95);
    if (roll < chance) {
      const severity = 0.1 * powerOf(actor, nowSeconds) + (weapon ? (weapon.blade ? 0.35 : 0.2) : 0);
      const step = targetHealth.state === "dead" ? { health: targetHealth, event: "" }
        : healthStep({ health: wound(targetHealth, severity, nowSeconds, weapon?.blade ? "blade" : "blow"), body: {}, nowSeconds });
      health = step.health;
      outcome = step.event === "died" ? "killed" : step.event === "collapsed" ? "felled" : "hit";
    } else outcome = "missed";
  } else if (act === "shove") {
    if (lying) return { ok: false, code: "CONFRONT_TARGET_DOWN" };
    if (roll < clamp(0.6 + 0.35 * edge, 0.1, 0.95)) {
      const falls = edge > 0.3;
      if (falls) health = healthStep({ health: wound(targetHealth, 0.03, nowSeconds, "fall"), body: {}, nowSeconds }).health;
      outcome = falls ? "knocked_down" : "pushed_back";
      if (held || clean(actor.heldBy) === clean(target.id)) heldBy = "";
    } else outcome = "stood_firm";
  } else {
    if (lying) return { ok: false, code: "CONFRONT_TARGET_DOWN" };
    if (roll < clamp(0.5 + 0.35 * edge, 0.1, 0.9)) { outcome = "seized"; heldBy = clean(actor.id); } else outcome = "slipped_free";
  }
  const freedActor = act !== "grab" && ["pushed_back", "knocked_down", "hit", "felled"].includes(outcome) && clean(actor.heldBy) === clean(target.id);
  const tool = weapon ? weapon.label : "";
  const other = (t) => (t === "你" ? "你" : "对方"); // the second mention of the same person
  const lines = {
    hit: (a, t) => (tool ? `${a}抡起${tool}${weapon.blade ? "砍" : "砸"}在了${t}身上。` : `${a}一拳打在了${t}身上。`),
    felled: (a, t) => `${a}${tool ? `抡起${tool}` : "一拳"}${weapon?.blade ? "砍" : "打"}下去，${t}一头栽倒在地，一动不动。`,
    killed: (a, t) => `${a}${tool ? `抡起${tool}` : "又一下"}${weapon?.blade ? "砍" : "打"}在倒地的${t}身上，${other(t)}再也没动。`,
    missed: (a, t) => `${a}朝${t}${tool ? `抡起${tool}` : "打了一拳"}，没打中。`,
    pushed_back: (a, t) => `${a}猛地推了${t}一把，${other(t)}踉跄着退了几步。`,
    knocked_down: (a, t) => `${a}一把把${t}推倒在地。`,
    stood_firm: (a, t) => `${a}推了${t}一把，${other(t)}站稳了没动。`,
    seized: (a, t) => `${a}一把抓住了${t}。`,
    slipped_free: (a, t) => `${a}伸手去抓${t}，被${other(t)}挣开了。`,
  };
  const tell = (observerId) => lines[outcome](personFor(state, observerId, actor.id), personFor(state, observerId, target.id));
  return { ok: true, outcome, health, ...(heldBy !== undefined ? { heldBy } : {}), freedActor, weapon, tell, surfaceText: tell(actor.id) };
}

/** Who is holding this person fast right now ("" when nobody): the holder must still be there, on their feet. */
export function movementHeldBy(state = {}, personId = "") {
  const person = state.entities?.[clean(personId)];
  const holder = state.entities?.[clean(person?.heldBy)];
  if (!person || !holder || holder.present === false) return "";
  if (clean(holder.placeId) !== clean(person.placeId) || clean(holder.zoneId) !== clean(person.zoneId)) return "";
  if (["down", "dead"].includes(healthOf(holder).state)) return "";
  return holder.id;
}
