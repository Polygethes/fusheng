// Eating and drinking, and water moving between the things that hold it.
// A person drinks from what they hold, from a jar or pot beside them, from a
// well or straight from the stream; eats what has been cooked; fills the
// bucket in their hand from a jar, a well or the stream; pours what they hold
// into a jar or into someone's bucket. Water is counted in 份 (a bucket's
// load); a drink takes a quarter of one. A well or a stream never runs dry.
// The body is eased through the world's own body load, so the person feels it
// at their next beat like any other settled fact.
const clean = (value) => String(value ?? "").trim();
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const r2 = (value) => Math.round(value * 100) / 100;

export const SUSTAIN_ACTS = Object.freeze(["drink", "eat", "fill", "pour"]);
/** What one drink takes from a jar or bucket, in 份. */
export const SIP = 0.25;
export const DRINK_RELIEF = 0.6;
export const MEAL_RELIEF = 0.6;
const STREAM_REACH = 1;

const outdoorsIn = (place = {}, zoneId = "") => {
  const id = clean(zoneId);
  if (!id.includes("__")) return true;
  return clean((place.sites || []).find((row) => clean(row.id) === id.split("__")[0])?.kind) !== "building";
};
const placeOf = (state, person) => state.places?.[clean(person?.placeId)] || {};

/** Whether `object` is held by, or lies within reach of, `person`. */
function within(state = {}, person = {}, object = {}) {
  const holderId = clean(object.holderCharacterId);
  if (holderId) {
    if (holderId === clean(person.id)) return true;
    const holder = state.entities?.[holderId];
    return Boolean(holder) && holder.present !== false && clean(holder.zoneId) === clean(person.zoneId);
  }
  return clean(object.zoneId) === clean(person.zoneId);
}
const heldBy = (object = {}, personId = "") => clean(object.holderCharacterId) === clean(personId);

/** A thing that holds water: it records both how much it holds and how much it can. */
export const isVessel = (object = {}) => Number.isFinite(Number(object.state?.water)) && num(object.state?.capacity) > 0;
const isWell = (object = {}) => clean(object.state?.source) === "well";
/** What there is to drink in it: { key: "water" | "tea", amount, need }, or null. */
function drinkIn(object = {}) {
  if (isVessel(object) && num(object.state.water) >= SIP) return { key: "water", amount: num(object.state.water), need: SIP };
  if (num(object.state?.tea) >= 1) return { key: "tea", amount: num(object.state.tea), need: 1 };
  return null;
}

/** Whether the person stands on open ground right at the stream. */
export function streamHere(state = {}, personId = "") {
  const person = state.entities?.[clean(personId)];
  if (!person) return false;
  const place = placeOf(state, person);
  const zone = place.topology?.zones?.[clean(person.zoneId)];
  return Boolean(zone) && Number.isFinite(Number(zone.waterDistance)) && Number(zone.waterDistance) <= STREAM_REACH && outdoorsIn(place, person.zoneId);
}

/** Open water where the person stands, as they would notice it: "溪水就在跟前", "井就在这儿", or "". */
export function waterHere(state = {}, personId = "") {
  const person = state.entities?.[clean(personId)];
  if (!person) return "";
  if (Object.values(state.objects || {}).some((object) => isWell(object) && within(state, person, object))) return "井就在这儿";
  return streamHere(state, personId) ? "溪水就在跟前" : "";
}

const fail = (code) => ({ ok: false, code });

/**
 * The settled act, without side effects:
 * { ok, code, objectPatches: [[objectId, field, value]], bodyLoad, surfaceText, durationSeconds }.
 * `objectPatches` set one field of an object's `state`; `bodyLoad` is null or
 * { thirstDelta } / { hungerDelta }; `surfaceText` is what onlookers see the person do, without the subject.
 */
export function sustenanceOutcome({ state = {}, actorId = "", act = "", objectId = "" } = {}) {
  const actor = state.entities?.[clean(actorId)];
  if (!SUSTAIN_ACTS.includes(act)) return fail("SUSTAIN_ACT_UNKNOWN");
  if (!actor) return fail("SUSTAIN_ACTOR_UNKNOWN");
  const objects = Object.values(state.objects || {});
  const named = clean(objectId) ? state.objects?.[clean(objectId)] : null;
  const prefix = { drink: "DRINK", eat: "EAT", fill: "FILL", pour: "POUR" }[act];
  if (clean(objectId) && !named) return fail(`${prefix}_TARGET_UNKNOWN`);
  if (named && !within(state, actor, named)) return fail(`${prefix}_TARGET_NOT_HERE`);
  const label = (object) => clean(object?.label) || "东西";

  if (act === "drink") {
    // What they name, else what they hold, else a jar or pot beside them, else a well, else the stream.
    const reachable = objects.filter((object) => within(state, actor, object));
    const from = named
      || reachable.find((object) => heldBy(object, actor.id) && drinkIn(object))
      || reachable.find((object) => !object.holderCharacterId && drinkIn(object))
      || reachable.find(isWell);
    if (from && isWell(from)) return { ok: true, code: "", objectPatches: [], bodyLoad: { thirstDelta: -DRINK_RELIEF }, surfaceText: "从井里打上水来，喝了几口。", durationSeconds: 90 };
    if (from) {
      const liquid = drinkIn(from);
      if (!liquid) return fail("DRINK_NOTHING_TO_DRINK");
      return { ok: true, code: "", objectPatches: [[from.id, liquid.key, r2(liquid.amount - liquid.need)]], bodyLoad: { thirstDelta: -DRINK_RELIEF },
        surfaceText: liquid.key === "tea" ? `从${label(from)}里倒了一碗茶喝。` : `从${label(from)}里舀水喝了几口。`, durationSeconds: 30 };
    }
    if (streamHere(state, actor.id)) return { ok: true, code: "", objectPatches: [], bodyLoad: { thirstDelta: -DRINK_RELIEF }, surfaceText: "蹲在溪边捧水喝了几口。", durationSeconds: 45 };
    return fail("DRINK_NO_WATER_HERE");
  }

  if (act === "eat") {
    const food = named || objects.find((object) => within(state, actor, object) && num(object.state?.meals) >= 1);
    if (!food || num(food.state?.meals) < 1) return fail("EAT_NOTHING_TO_EAT");
    return { ok: true, code: "", objectPatches: [[food.id, "meals", num(food.state.meals) - 1]], bodyLoad: { hungerDelta: -MEAL_RELIEF },
      surfaceText: `盛了一碗${label(food)}上的饭吃了。`, durationSeconds: 600 };
  }

  if (act === "fill") {
    // Into the vessel in their own hands, from a jar beside them, a well, or the stream.
    const into = named || objects.find((object) => heldBy(object, actor.id) && isVessel(object));
    if (!into) return fail("FILL_NOT_HELD");
    if (!isVessel(into)) return fail("FILL_NOT_A_VESSEL");
    if (!heldBy(into, actor.id)) return fail("FILL_NOT_HELD");
    const space = r2(num(into.state.capacity) - num(into.state.water));
    if (space <= 0) return fail("FILL_ALREADY_FULL");
    const jar = objects.find((object) => object.id !== into.id && !object.holderCharacterId && within(state, actor, object) && isVessel(object) && num(object.state.water) > 0);
    if (jar) {
      const moved = r2(Math.min(space, num(jar.state.water)));
      return { ok: true, code: "", objectPatches: [[into.id, "water", r2(num(into.state.water) + moved)], [jar.id, "water", r2(num(jar.state.water) - moved)]],
        bodyLoad: null, surfaceText: `从${label(jar)}里舀水装进${label(into)}。`, durationSeconds: 60 };
    }
    const well = objects.find((object) => isWell(object) && within(state, actor, object));
    if (well || streamHere(state, actor.id)) {
      return { ok: true, code: "", objectPatches: [[into.id, "water", num(into.state.capacity)]], bodyLoad: null,
        surfaceText: well ? `从井里打上一${label(into).slice(-1)}水。` : `在溪里打了一${label(into).slice(-1)}水。`, durationSeconds: well ? 120 : 60 };
    }
    return fail("FILL_NO_WATER_HERE");
  }

  // pour: what they hold, into a jar beside them or a vessel in someone's hands here.
  if (!named) return fail("POUR_TARGET_UNKNOWN");
  if (!isVessel(named)) return fail("POUR_TARGET_NOT_A_VESSEL");
  const from = objects.find((object) => object.id !== named.id && heldBy(object, actor.id) && isVessel(object) && num(object.state.water) > 0);
  if (!from) return fail("POUR_NOTHING_IN_HAND");
  const space = r2(num(named.state.capacity) - num(named.state.water));
  if (space <= 0) return fail("POUR_TARGET_FULL");
  const moved = r2(Math.min(space, num(from.state.water)));
  return { ok: true, code: "", objectPatches: [[from.id, "water", r2(num(from.state.water) - moved)], [named.id, "water", r2(num(named.state.water) + moved)]],
    bodyLoad: null, surfaceText: `把${label(from)}里的水倒进${label(named)}。`, durationSeconds: 30 };
}

export const SUSTAIN_FAILURES = Object.freeze({
  SUSTAIN_ACT_UNKNOWN: "不知道要做什么",
  DRINK_TARGET_UNKNOWN: "没有这个东西", DRINK_TARGET_NOT_HERE: "那东西不在身边", DRINK_NOTHING_TO_DRINK: "里面没有能喝的", DRINK_NO_WATER_HERE: "身边没有水",
  EAT_TARGET_UNKNOWN: "没有这个东西", EAT_TARGET_NOT_HERE: "那东西不在身边", EAT_NOTHING_TO_EAT: "没有做好的饭",
  FILL_TARGET_UNKNOWN: "没有这个东西", FILL_TARGET_NOT_HERE: "那东西不在身边", FILL_NOT_HELD: "手里没有拿着能装水的东西", FILL_NOT_A_VESSEL: "那东西装不了水",
  FILL_ALREADY_FULL: "已经装满了", FILL_NO_WATER_HERE: "这里没有水可打",
  POUR_TARGET_UNKNOWN: "没说倒进哪里", POUR_TARGET_NOT_HERE: "那东西不在身边", POUR_TARGET_NOT_A_VESSEL: "那东西装不了水",
  POUR_NOTHING_IN_HAND: "手里没有装着水的东西", POUR_TARGET_FULL: "已经满了",
});
