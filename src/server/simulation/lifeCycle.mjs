// Children. A married woman and man who live under one roof may have a child.
// The world settles when she conceives (a day drawn once for the couple; if
// they are apart that day, it tries again a week later); she knows it herself
// after some weeks, others see it once it shows; forty weeks on her labour
// begins, and six hours later the child is born — a newborn in her arms, not
// yet a person who decides anything. Someone who knows medicine at her side
// makes it easier on her. A town can start with someone already expecting.
import { healthOf, healthStep, wound } from "./characterHealth.mjs";
import { rollFor, personFor } from "./confrontation.mjs";
import { livingSpouse } from "./marriage.mjs";

export const DAY = 86400;
export const WEEK = 7 * DAY;
export const TERM_WEEKS = 40;
export const KNOWN_AT_WEEKS = 6;
export const SHOWS_AT_WEEKS = 20;
export const NEAR_TERM_WEEKS = 36;
export const LABOR_SECONDS = 6 * 3600;
const BEARING_AGES = [16, 45];
const HEALING_SKILLS = new Set(["medicine", "herbalism", "midwifery"]);
const FEMALE = /女|妇|娘|婆|嫂|婶|姑|妹|姐|妻|姥|奶|媪|妪|闺|氏/gu;
const MALE = /男|汉|翁|叔|伯|爷|哥|弟|郎|夫|公|爹|兄|先生|后生|小伙|书生|老头/gu;
const clean = (value) => String(value ?? "").trim();
const lastAt = (pattern, text) => { let at = -1; for (const match of text.matchAll(pattern)) at = match.index; return at; };
const siteOf = (zoneId = "") => clean(zoneId).split("__")[0];

/**
 * "female", "male", or "" when it cannot be told: what the town says, else the
 * head word of how they look ("抱着女儿的男人" is a man), else their name.
 */
export function sexOf(person = {}) {
  if (["female", "male"].includes(person.sex)) return person.sex;
  const look = clean(person.look ?? (person.publicSignalFeatures || []).find((row) => row.featureId === "look")?.physicalFeature).split(/[，,]/u)[0];
  for (const text of [look, clean(person.name)]) {
    const female = lastAt(FEMALE, text), male = lastAt(MALE, text);
    if (female > male) return "female";
    if (male > female) return "male";
  }
  return "";
}

/** { motherId, fatherId } when these two could have a child together, else null. */
export function bearingCouple(state = {}, a = "", b = "") {
  const one = state.entities?.[clean(a)], other = state.entities?.[clean(b)];
  if (!one || !other) return null;
  const mother = sexOf(one) === "female" && sexOf(other) === "male" ? one : sexOf(other) === "female" && sexOf(one) === "male" ? other : null;
  if (!mother) return null;
  const age = Number(mother.age);
  if (!(age >= BEARING_AGES[0] && age <= BEARING_AGES[1])) return null;
  return { motherId: mother.id, fatherId: mother.id === one.id ? other.id : one.id };
}

/** The day a couple's child is conceived, drawn once: 20 to 140 days after `fromSeconds`. */
export function conceptionFor(motherId = "", fatherId = "", fromSeconds = 0) {
  return { atSeconds: fromSeconds + DAY * (20 + Math.floor(rollFor(`conceive:${clean(motherId)}:${clean(fatherId)}:${fromSeconds}`) * 120)), partnerId: clean(fatherId) };
}

/** After a wedding: [motherId, "conception", value] if the two could have a child, else null. */
export function conceptionAfterWedding(state = {}, a = "", b = "", nowSeconds = 0) {
  const couple = bearingCouple(state, a, b);
  return couple ? [couple.motherId, "conception", conceptionFor(couple.motherId, couple.fatherId, nowSeconds)] : null;
}

/** A pregnancy for someone a town starts with already expecting, `weeks` along. */
export function pregnancyAtStart(weeks = 0, fatherId = "") {
  const along = Math.max(0, Math.min(42, Number(weeks) || 0));
  return { sinceSeconds: -Math.round(along * WEEK), dueAtSeconds: Math.max(1800, Math.round((TERM_WEEKS - along) * WEEK)), fatherId: clean(fatherId) };
}

const weeksAlong = (pregnancy = {}, nowSeconds = 0) => (Number(nowSeconds) - Number(pregnancy.sinceSeconds || 0)) / WEEK;

/** What she feels of it herself ("" before she can tell). */
export function pregnancyFelt(entity = {}, nowSeconds = 0) {
  const pregnancy = entity.pregnancy;
  if (!pregnancy) return "";
  if (Number.isFinite(pregnancy.laborSinceSeconds)) return "肚子一阵紧过一阵，孩子就要生了";
  const weeks = weeksAlong(pregnancy, nowSeconds);
  if (weeks >= NEAR_TERM_WEEKS) return "快要临盆了，身子沉得很";
  if (weeks >= KNOWN_AT_WEEKS) return `怀着身孕，${Math.max(1, Math.floor(weeks / 4.3))}个月了`;
  return "";
}

/** What others see of it ("" before it shows). */
export function pregnancyLook(entity = {}, nowSeconds = 0) {
  const pregnancy = entity.pregnancy;
  if (!pregnancy) return "";
  if (Number.isFinite(pregnancy.laborSinceSeconds)) return "捂着肚子，正在生孩子";
  const weeks = weeksAlong(pregnancy, nowSeconds);
  if (weeks >= NEAR_TERM_WEEKS) return "挺着大肚子，快要生了";
  if (weeks >= SHOWS_AT_WEEKS) return "大着肚子";
  return "";
}

const people = (state = {}) => Object.values(state.entities || {}).filter((row) => row?.kind === "character" && row.present !== false && healthOf(row).state !== "dead")
  .sort((x, y) => clean(x.id).localeCompare(clean(y.id)));
function timesOf(row = {}) {
  const pregnancy = row.pregnancy;
  if (pregnancy && Number.isFinite(pregnancy.laborSinceSeconds)) return [["birth", pregnancy.laborSinceSeconds + LABOR_SECONDS]];
  if (pregnancy) return [["labor", Number(pregnancy.dueAtSeconds)]];
  if (row.conception) return [["conception", Number(row.conception.atSeconds)]];
  return [];
}

/** The next time something in a life comes due (conception, labour, birth), or null. */
export function nextLifeBoundary(state = {}) {
  const now = Number(state.nowSeconds || 0);
  const times = people(state).flatMap(timesOf).map(([, at]) => at).filter((at) => Number.isFinite(at) && at > now);
  return times.length ? Math.min(...times) : null;
}

/** The first thing in a life that is due by now: { kind, personId }, or null. */
export function dueLifeEvent(state = {}) {
  const now = Number(state.nowSeconds || 0);
  for (const row of people(state)) for (const [kind, at] of timesOf(row)) if (Number.isFinite(at) && at <= now) return { kind, personId: row.id };
  return null;
}

/**
 * What the due event does, as world fact to commit:
 * { operations, deliveries, resolvedEffects, caption } — the caption names names (it is for the observer).
 */
export function lifeEventOutcome({ state = {}, kind = "", personId = "", eventId = "" } = {}) {
  const now = Number(state.nowSeconds || 0);
  const mother = state.entities?.[clean(personId)];
  const out = { operations: [], deliveries: [], resolvedEffects: [], caption: "" };
  if (!mother) return out;
  const set = (path, value) => out.operations.push({ op: "set", path, value });
  const name = clean(mother.name);
  const onlookers = people(state).filter((row) => row.id !== mother.id && !["down", "dead"].includes(healthOf(row).state)
    && clean(row.placeId) === clean(mother.placeId) && clean(row.zoneId) === clean(mother.zoneId));
  const tell = (row, content, extra = {}) => out.deliveries.push({ deliveryId: `delivery:${clean(eventId)}:life:${row.id}`, eventKind: "life_event", modality: row.id === mother.id ? "bodily" : "visual",
    sourceCharacterId: mother.id, recipientCharacterId: row.id, directed: row.id === mother.id, urgent: true, occurredAtSeconds: now, content, ...extra });
  if (kind === "conception") {
    const partnerId = clean(mother.conception?.partnerId);
    const partner = state.entities?.[partnerId];
    const stillTogether = livingSpouse(state, mother.id) === partnerId && bearingCouple(state, mother.id, partnerId);
    if (!stillTogether) { set(["entities", mother.id, "conception"], null); return out; }
    if (!partner || partner.present === false || siteOf(partner.zoneId) !== siteOf(mother.zoneId) || clean(partner.placeId) !== clean(mother.placeId)) {
      set(["entities", mother.id, "conception"], { ...mother.conception, atSeconds: now + WEEK });
      return out;
    }
    set(["entities", mother.id, "pregnancy"], { sinceSeconds: now, dueAtSeconds: now + TERM_WEEKS * WEEK, fatherId: partnerId });
    set(["entities", mother.id, "conception"], null);
    out.resolvedEffects.push({ kind: "conceived", motherId: mother.id, fatherId: partnerId });
    out.caption = `${name}怀上了孩子。`;
    return out;
  }
  if (kind === "labor") {
    set(["entities", mother.id, "pregnancy"], { ...mother.pregnancy, laborSinceSeconds: now });
    out.resolvedEffects.push({ kind: "labor_began", motherId: mother.id });
    tell(mother, "肚子一阵紧过一阵地疼起来——孩子要生了。");
    for (const row of onlookers) tell(row, `${personFor(state, row.id, mother.id)}捂着肚子疼得直不起腰，像是要生了。`);
    out.caption = `${name}要生了。`;
    return out;
  }
  if (kind === "birth") {
    const fatherId = clean(mother.pregnancy?.fatherId);
    const objectId = `newborn_${mother.id}_${now}`;
    const helped = onlookers.some((row) => (row.skills || []).some((skill) => HEALING_SKILLS.has(clean(skill))));
    set(["objects", objectId], { id: objectId, kind: "object", label: "刚出生的孩子", placeId: mother.placeId, zoneId: mother.zoneId, holderCharacterId: mother.id,
      ownerIds: [mother.id, fatherId].filter(Boolean), portable: true, state: { crying: true }, presentation: { exposure: "public" }, perception: { publicLabel: "刚出生的孩子" },
      custody: { inHand: true, storageMode: "carried" }, bornAtSeconds: now, parentIds: [mother.id, fatherId].filter(Boolean) });
    set(["entities", mother.id, "pregnancy"], null);
    set(["entities", mother.id, "health"], healthStep({ health: wound(healthOf(mother), helped ? 0.1 : 0.25, now, "childbirth"), body: {}, nowSeconds: now }).health);
    const couple = fatherId && livingSpouse(state, mother.id) === fatherId ? bearingCouple(state, mother.id, fatherId) : null;
    set(["entities", mother.id, "conception"], couple ? conceptionFor(mother.id, fatherId, now + 365 * DAY) : null);
    out.resolvedEffects.push({ kind: "born", motherId: mother.id, fatherId, objectId, helped });
    tell(mother, "孩子生下来了，哇哇地哭着。你把孩子抱在了怀里。");
    for (const row of onlookers) tell(row, `${personFor(state, row.id, mother.id)}生下了一个孩子，孩子哇哇地哭着。`);
    out.caption = `${name}生下了一个孩子。`;
    return out;
  }
  return out;
}
