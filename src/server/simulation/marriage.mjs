// Marriage. Two grown people who have no living husband or wife and are not
// kin may marry: one asks, face to face; the other says yes, face to face.
// Then it is a fact: each is the other's spouse, whoever saw it knows, and
// each holds the other as husband or wife in their own memory of the people
// they know (taken up at their next beat). Couples a town starts
// with are read from how its people are bound ("夫妻", "老伴"); kin from the
// same ("祖孙", "兄妹" — but "邻里姐妹" is friendship). An offer stands for three days.
import { healthOf } from "./characterHealth.mjs";
import { personFor } from "./confrontation.mjs";

export const MARRIAGE_ACTS = Object.freeze(["propose", "accept"]);
export const PROPOSAL_STANDS_SECONDS = 3 * 24 * 3600;
const SPOUSE_LABEL = /夫妻|丈夫|妻子|夫君|娘子|老伴|媳妇|相公|发妻|结发/u;
// Kin only when the bond names it first: "祖孙", "父女", "亲兄妹" are kin; "邻里姐妹" is a friendship.
const KIN_LABEL = /^亲?(祖孙|爷孙|奶孙|父子|父女|母子|母女|兄弟|姐妹|兄妹|姐弟|叔侄|姑侄|舅甥|姨甥|堂兄|堂弟|堂姐|堂妹|表兄|表弟|表姐|表妹|骨肉)/u;
const clean = (value) => String(value ?? "").trim();

/** The couples a town starts with, from how its people are bound: { [id]: spouseId }. */
export function spousesFromRelationships(relationships = []) {
  const spouses = {};
  for (const row of relationships || []) {
    if (!SPOUSE_LABEL.test(clean(row.label))) continue;
    const a = clean(row.fromCharacterId), b = clean(row.toCharacterId);
    if (a && b && a !== b) { spouses[a] ||= b; spouses[b] ||= a; }
  }
  return spouses;
}

/** This person's husband or wife unless they have died ("" when unmarried or widowed); a spouse away from here is still a spouse. */
export function livingSpouse(state = {}, personId = "") {
  const spouseId = clean(state.entities?.[clean(personId)]?.spouseId);
  if (!spouseId) return "";
  const spouse = state.entities?.[spouseId];
  return spouse && healthOf(spouse).state === "dead" ? "" : spouseId;
}

/** Who is kin to whom in a town as it starts, from how its people are bound: { [id]: [kinIds] }. */
export function kinFromRelationships(relationships = []) {
  const kin = {};
  for (const row of relationships || []) {
    if (!KIN_LABEL.test(clean(row.label))) continue;
    const a = clean(row.fromCharacterId), b = clean(row.toCharacterId);
    if (!a || !b || a === b) continue;
    for (const [x, y] of [[a, b], [b, a]]) { kin[x] ||= []; if (!kin[x].includes(y)) kin[x].push(y); }
  }
  return kin;
}

export const isKin = (state = {}, a = "", b = "") => (state.entities?.[clean(a)]?.kinIds || []).includes(clean(b))
  || (state.entities?.[clean(b)]?.kinIds || []).includes(clean(a));
const grown = (entity = {}) => clean(entity.ageGroup) !== "child";

/** Whether `actorId` may ask `targetId` to marry them now: { ok, code? }. */
export function proposalCheck(state = {}, actorId = "", targetId = "") {
  const actor = state.entities?.[clean(actorId)], target = state.entities?.[clean(targetId)];
  if (!target || target.kind !== "character" || target.present === false || target.id === actor?.id) return { ok: false, code: "MARRY_TARGET_UNKNOWN" };
  if (clean(target.placeId) !== clean(actor?.placeId) || clean(target.zoneId) !== clean(actor?.zoneId)) return { ok: false, code: "MARRY_TARGET_NOT_HERE" };
  if (["down", "dead"].includes(healthOf(target).state)) return { ok: false, code: "MARRY_TARGET_DOWN" };
  if (!grown(actor) || !grown(target)) return { ok: false, code: "MARRY_NOT_GROWN" };
  if (livingSpouse(state, actor.id) || livingSpouse(state, target.id)) return { ok: false, code: "MARRY_ALREADY_MARRIED" };
  if (isKin(state, actor.id, target.id)) return { ok: false, code: "MARRY_KIN" };
  return { ok: true };
}

/** Whether someone has asked `personId` to marry them and the offer still stands. */
export function proposalStands(state = {}, proposerId = "", personId = "") {
  const offer = state.entities?.[clean(proposerId)]?.proposal;
  return clean(offer?.toCharacterId) === clean(personId) && Number(state.nowSeconds || 0) - Number(offer?.atSeconds || 0) <= PROPOSAL_STANDS_SECONDS;
}

/**
 * The settled act, without side effects: { ok, code?, act, wedding, entityPatches: [[id, field, value]],
 * tell(observerId), surfaceText }.
 */
export function marriageOutcome({ state = {}, actorId = "", targetId = "", act = "" } = {}) {
  const actor = state.entities?.[clean(actorId)];
  if (!MARRIAGE_ACTS.includes(act)) return { ok: false, code: "MARRY_ACT_UNKNOWN" };
  if (act === "accept" && !proposalStands(state, targetId, actorId)) return { ok: false, code: "MARRY_NO_PROPOSAL" };
  const check = proposalCheck(state, actorId, targetId);
  if (!check.ok) return check;
  const now = Number(state.nowSeconds || 0);
  const other = (t) => (t === "你" ? "你" : "对方");
  if (act === "propose") {
    const lines = (a, t) => `${a}郑重地向${t}求亲。`;
    const tell = (observerId) => lines(personFor(state, observerId, actor.id), personFor(state, observerId, targetId));
    return { ok: true, act, wedding: false, entityPatches: [[actor.id, "proposal", { toCharacterId: clean(targetId), atSeconds: now }]], tell, surfaceText: tell(actor.id) };
  }
  const tell = (observerId) => {
    const a = personFor(state, observerId, actor.id), t = personFor(state, observerId, targetId);
    if (a === "你") return `你答应了${t}的求亲，从此和${other(t)}结为夫妻。`;
    if (t === "你") return `${a}答应了你的求亲，从此你们结为夫妻。`;
    return `${a}答应了${t}的求亲，两人当众结为夫妻。`;
  };
  return { ok: true, act, wedding: true, tell, surfaceText: tell(actor.id),
    entityPatches: [[actor.id, "spouseId", clean(targetId)], [clean(targetId), "spouseId", actor.id], [clean(targetId), "proposal", null], [actor.id, "proposal", null]] };
}

/**
 * A person's own memory of the people they know, once the world says they are
 * married: the row for their spouse now reads "夫妻" (what it read before is
 * kept), or a new row if they had none. null when the memory already says so.
 */
export function rememberMarriage(relationshipContext = [], ownerId = "", spouse = null, nowSeconds = 0) {
  const spouseId = clean(spouse?.characterId);
  if (!spouseId) return null;
  const rows = structuredClone(relationshipContext || []);
  const row = rows.find((item) => clean(item.toCharacterId) === spouseId);
  if (row && SPOUSE_LABEL.test(clean(row.label))) return null;
  if (!row && !clean(spouse.name)) return null;
  if (row) Object.assign(row, { formerLabel: clean(row.label), label: "夫妻", marriedAtSeconds: nowSeconds });
  else rows.push({ fromCharacterId: clean(ownerId), toCharacterId: spouseId, toCharacterName: clean(spouse.name), label: "夫妻",
    allowedAddresses: [], addressingRule: "", metrics: {}, unspoken: "", misreading: "", pressure: "", marriedAtSeconds: nowSeconds,
    authority: "character-owned-relationship-memory" });
  return rows;
}
