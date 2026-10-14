// Who things belong to, as the world records it and as each person knows it.
// What stands in a household's home belongs to the household; what someone
// carried in is theirs. Taking what belongs to someone else is a fact the world
// settles like any other; whether it is borrowing or stealing is for people to
// judge. An owner knows their own things wherever they see them; anyone who
// knows the household knows what lies in its house is theirs; a thing in a
// stranger's hand is just a thing. An owner standing where something belongs
// sees when it is gone. Giving away one's own makes it the other's.
const clean = (value) => String(value ?? "").trim();
const siteOf = (zoneId = "") => clean(zoneId).split("__")[0];

export const ownersOf = (object = {}) => (Array.isArray(object.ownerIds) ? object.ownerIds.map(clean).filter(Boolean) : []);

/**
 * Whose it is, as `observerId` would say it: "你家的", "你的", "石守田家的",
 * "宝大川的", or "" (no one's, or they cannot tell).
 */
export function ownershipNote(state = {}, observerId = "", object = {}) {
  const owners = ownersOf(object);
  if (!owners.length) return "";
  const household = owners.length > 1 || Boolean(clean(object.homeZoneId));
  if (owners.includes(clean(observerId))) return household ? "你家的" : "你的";
  // Only what lies in its owners' house plainly belongs to them; in a hand, or out in the street, it is just a thing.
  const atHome = household && !clean(object.holderCharacterId) && siteOf(object.zoneId) === siteOf(object.homeZoneId);
  if (!atHome) return "";
  const observer = state.entities?.[clean(observerId)] || {};
  const known = owners.find((id) => !Array.isArray(observer.knownActorIds) || observer.knownActorIds.includes(id));
  const name = clean(state.entities?.[known]?.name);
  return name ? `${name}家的` : "";
}

/** The fact of someone taking what belongs to others, or null when it is their own or no one's. */
export function takenFromOthers(object = {}, actorId = "") {
  const owners = ownersOf(object);
  if (!owners.length || owners.includes(clean(actorId))) return null;
  return { kind: "took_others_property", actorId: clean(actorId), objectId: clean(object.id), ownerIds: owners };
}

/** Giving one's own to someone outside the owners makes it theirs: the new `ownerIds`, or null. */
export function ownersAfterGiving(object = {}, giverId = "", receiverId = "") {
  const owners = ownersOf(object);
  if (!owners.includes(clean(giverId)) || !clean(receiverId) || owners.includes(clean(receiverId))) return null;
  return [clean(receiverId)];
}

/** What an owner standing where their things belong sees is gone: [{ objectId, label }]. */
export function missingHere(state = {}, ownerId = "") {
  const owner = state.entities?.[clean(ownerId)];
  if (!owner || owner.present === false) return [];
  return Object.values(state.objects || {}).filter((object) => {
    if (clean(object.homeZoneId) !== clean(owner.zoneId) || !ownersOf(object).includes(owner.id)) return false;
    if (clean(object.holderCharacterId) === owner.id) return false;
    const holder = state.entities?.[clean(object.holderCharacterId)];
    const here = holder ? holder.present !== false && clean(holder.zoneId) === clean(owner.zoneId) : clean(object.zoneId) === clean(owner.zoneId);
    return !here;
  }).map((object) => ({ objectId: clean(object.id), label: clean(object.label) }));
}
