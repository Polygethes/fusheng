// A swap made face to face. Holding out the thing in your hand, you offer it
// for something the other person has on them; they say yes, and the two
// things change hands at once — each becomes the new holder's own when it was
// the giver's to give. An offer stands for an hour, or until either thing is
// no longer where it was. Whether the price is fair is for the two of them.
import { ownersOf } from "./property.mjs";
import { healthOf } from "./characterHealth.mjs";
import { personFor } from "./confrontation.mjs";

const clean = (value) => String(value ?? "").trim();
export const OFFER_SECONDS = 3600;
export const EXCHANGE_ACTS = Object.freeze(["offer", "deal"]);

const label = (object) => clean(object?.label) || "东西";
const inHandOf = (object, personId) => clean(object?.holderCharacterId) === clean(personId) && object.custody?.inHand !== false;
const heldBy = (object, personId) => clean(object?.holderCharacterId) === clean(personId);
/** A child carried in someone's arms is in the world as a thing, but is not one to trade. */
export const isChild = (object = {}) => Array.isArray(object.parentIds) || Number.isFinite(Number(object.bornAtSeconds)) || /婴儿|孩子|娃/u.test(clean(object.label));

/** Offers standing to `personId` now: [{ fromId, giveObjectId, wantObjectId, atSeconds }]. */
export function standingOffers(state = {}, personId = "") {
  const now = Number(state.nowSeconds || 0);
  const person = state.entities?.[clean(personId)];
  return (Array.isArray(person?.offers) ? person.offers : []).filter((row) => {
    if (now - Number(row.atSeconds || 0) > OFFER_SECONDS) return false;
    const give = state.objects?.[clean(row.giveObjectId)], want = state.objects?.[clean(row.wantObjectId)];
    return heldBy(give, row.fromId) && heldBy(want, personId);
  });
}

/**
 * The settled offer or deal, without side effects:
 * { ok, code, entityPatches: [[id, field, value]], objectPatches: [[objectId, object]], surfaceText, tell(observerId) }.
 * `objectId` names the thing wanted (offer); `targetId` the other person.
 */
export function exchangeOutcome({ state = {}, actorId = "", targetId = "", act = "", objectId = "" } = {}) {
  const actor = state.entities?.[clean(actorId)], target = state.entities?.[clean(targetId)];
  const now = Number(state.nowSeconds || 0);
  if (!EXCHANGE_ACTS.includes(act)) return { ok: false, code: "EXCHANGE_ACT_UNKNOWN" };
  if (!target || target.kind !== "character" || target.present === false || target.id === actor?.id) return { ok: false, code: "EXCHANGE_TARGET_UNKNOWN" };
  if (clean(target.placeId) !== clean(actor?.placeId) || clean(target.zoneId) !== clean(actor?.zoneId)) return { ok: false, code: "EXCHANGE_TARGET_NOT_HERE" };
  if (["down", "dead"].includes(healthOf(target).state)) return { ok: false, code: "EXCHANGE_TARGET_DOWN" };

  if (act === "offer") {
    const want = state.objects?.[clean(objectId)];
    if (!want || !heldBy(want, target.id)) return { ok: false, code: "EXCHANGE_NOT_THEIRS" };
    if (isChild(want)) return { ok: false, code: "EXCHANGE_NOT_FOR_TRADE" };
    const give = Object.values(state.objects || {}).find((object) => inHandOf(object, actor.id) && object.portable !== false && !isChild(object));
    if (!give) return { ok: false, code: "EXCHANGE_NOTHING_IN_HAND" };
    const offers = [...standingOffers(state, target.id).filter((row) => row.fromId !== actor.id),
      { fromId: actor.id, giveObjectId: give.id, wantObjectId: want.id, atSeconds: now }];
    const tell = (observerId) => {
      const who = personFor(state, observerId, actor.id), whom = personFor(state, observerId, target.id);
      return observerId === target.id ? `${who}想拿手里的${label(give)}换你的${label(want)}。` : `${who}想拿${label(give)}换${whom}的${label(want)}。`;
    };
    return { ok: true, code: "", entityPatches: [[target.id, "offers", offers]], objectPatches: [], surfaceText: `想拿${label(give)}换对方的${label(want)}。`, tell, giveObjectId: give.id, wantObjectId: want.id };
  }

  // deal: say yes to the standing offer from `targetId`.
  const offer = standingOffers(state, actor.id).find((row) => row.fromId === target.id);
  if (!offer) return { ok: false, code: "EXCHANGE_NO_OFFER" };
  const give = state.objects[offer.giveObjectId], want = state.objects[offer.wantObjectId];
  // A thing that was the giver's own becomes the receiver's; anyone else's stays theirs, and where it belongs.
  const passed = (object, from, to) => {
    const owners = ownersOf(object);
    const { homeZoneId, ownerIds, ...rest } = object;
    const moved = { ...rest, holderCharacterId: to, zoneId: clean(state.entities?.[to]?.zoneId), custody: { ...(object.custody || {}), storageMode: "carried", inHand: true } };
    if (owners.includes(clean(from))) return { ...moved, ownerIds: owners.includes(clean(to)) ? owners : [clean(to)] };
    return { ...moved, ...(ownerIds ? { ownerIds } : {}), ...(homeZoneId ? { homeZoneId } : {}) };
  };
  const remaining = (Array.isArray(actor.offers) ? actor.offers : []).filter((row) => row.fromId !== target.id);
  const tell = (observerId) => {
    const who = personFor(state, observerId, actor.id), whom = personFor(state, observerId, target.id);
    if (observerId === target.id) return `${who}答应了，你用${label(give)}换到了${label(want)}。`;
    return `${who}和${whom}换了东西：${label(want)}换${label(give)}。`;
  };
  return { ok: true, code: "", entityPatches: [[actor.id, "offers", remaining]],
    objectPatches: [[give.id, passed(give, target.id, actor.id)], [want.id, passed(want, actor.id, target.id)]],
    surfaceText: `用${label(want)}换了对方的${label(give)}。`, tell, giveObjectId: give.id, wantObjectId: want.id };
}

export const EXCHANGE_FAILURES = Object.freeze({
  EXCHANGE_ACT_UNKNOWN: "不知道要做什么", EXCHANGE_TARGET_UNKNOWN: "没有这个人", EXCHANGE_TARGET_NOT_HERE: "对方不在身边",
  EXCHANGE_TARGET_DOWN: "对方倒在地上", EXCHANGE_NOT_THEIRS: "那东西不在对方身上", EXCHANGE_NOTHING_IN_HAND: "手里没有拿着能换的东西",
  EXCHANGE_NO_OFFER: "对方没有提出过交换", EXCHANGE_NOT_FOR_TRADE: "人不是拿来换的",
});
