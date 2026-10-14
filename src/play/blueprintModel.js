// Pure helpers behind the creation pages (P6): a starting blueprint for a
// chosen genre, adding and removing places, households, residents and
// relationships while every reference stays consistent, the personality
// sliders, and the cost estimate. No DOM — node contracts test them directly,
// and the review page shows validateBlueprint's findings, never silent fixes.
import { SITE_TYPES, SKILLS, COLOR_PALETTES, APPEARANCE_STYLES } from "../worlds/catalog/index.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));
const list = (value) => (Array.isArray(value) ? value : []);

export const GENRES = Object.freeze({
  古风: { genre: "古风小镇", tone: "温情", startDay: "立秋前三日", startClock: "07:00", startLabel: "辰时初", town: "柳溪镇",
    sites: [["home", "张家"], ["home", "李家"], ["herb_shop", "回春堂"], ["smithy", "铁匠铺"], ["square", "镇中广场"], ["well", "老井"], ["market", "早市"], ["forest", "后山竹林"]] },
  现代: { genre: "现代小镇", tone: "温情", startDay: "九月初的周六", startClock: "08:00", startLabel: "早上八点", town: "青禾镇",
    sites: [["home", "林家"], ["home", "周家"], ["shop", "街角小卖部"], ["inn", "老街民宿"], ["clinic", "镇卫生所"], ["square", "文化广场"], ["market", "菜市场"], ["river_bank", "河堤"]] },
  奇幻: { genre: "奇幻小镇", tone: "奇异而温暖", startDay: "收获月第三日", startClock: "07:00", startLabel: "晨钟之后", town: "月苔镇",
    sites: [["home", "灯匠家"], ["home", "牧羊人家"], ["herb_shop", "药草师小屋"], ["smithy", "符文铁铺"], ["temple", "古树神龛"], ["square", "石环广场"], ["well", "许愿井"], ["forest", "迷雾林"]] },
  自定义: { genre: "", tone: "", startDay: "", startClock: "07:00", startLabel: "", town: "", sites: [] },
});

export function uniqueId(prefix, taken) {
  const used = new Set(taken);
  for (let n = 1; ; n += 1) if (!used.has(`${prefix}_${n}`)) return `${prefix}_${n}`;
}

export function blankBlueprint(genreName = "古风", { id = "my_town", seed = 1 } = {}) {
  const genre = GENRES[genreName] || GENRES.自定义;
  const bp = {
    blueprintVersion: 1,
    meta: { id, title: genre.town, premise: "", genre: genre.genre, tone: genre.tone, language: "zh-Hans",
      startDay: genre.startDay, startClock: genre.startClock, startLabel: genre.startLabel, seed },
    town: { name: genre.town, terrain: { river: null, forest: null, hills: null, fields: null }, sites: [] },
    households: [], residents: [], relationships: [],
    opening: { situation: "", positions: {}, objects: [], deadlines: [], mysteries: [], events: [], visitors: [] },
  };
  let next = bp;
  for (const [type, name] of genre.sites) next = addSite(next, type, name).blueprint;
  return next;
}

// ── places ────────────────────────────────────────────────────────────────
export function addSite(blueprint, type, name = "") {
  if (!SITE_TYPES[type]) throw Object.assign(new Error(`没有 ${type} 这种地点。`), { code: "SITE_TYPE_UNKNOWN" });
  const bp = clone(blueprint);
  const id = uniqueId(type, bp.town.sites.map((row) => row.id));
  bp.town.sites.push({ id, name: name || SITE_TYPES[type].label.split(/[ /]/u)[0], type });
  return { blueprint: bp, id };
}

/** Every place in the blueprint that points at this site, as review-page paths. */
export function siteReferences(blueprint, siteId) {
  const paths = [];
  list(blueprint.households).forEach((row, i) => { if (row.siteId === siteId) paths.push(`households[${i}].siteId`); });
  list(blueprint.residents).forEach((row, i) => {
    if (row.workSiteId === siteId) paths.push(`residents[${i}].workSiteId`);
    list(row.routine).forEach((block, k) => { if (block.siteId === siteId) paths.push(`residents[${i}].routine[${k}].siteId`); });
  });
  for (const [person, site] of Object.entries(blueprint.opening?.positions || {})) if (site === siteId) paths.push(`opening.positions.${person}`);
  list(blueprint.opening?.objects).forEach((row, i) => {
    if (row.siteId === siteId) paths.push(`opening.objects[${i}].siteId`);
    if (row.madeAt === siteId) paths.push(`opening.objects[${i}].madeAt`);
  });
  list(blueprint.opening?.deadlines).forEach((row, i) => list(row.conditions).forEach((c, k) => { if (c.siteId === siteId) paths.push(`opening.deadlines[${i}].conditions[${k}].siteId`); }));
  return paths;
}

/** A place can be removed only when nothing points at it; the page lists what does. */
export function removeSite(blueprint, siteId) {
  const references = siteReferences(blueprint, siteId);
  if (references.length) return { ok: false, blueprint, references };
  const bp = clone(blueprint);
  bp.town.sites = bp.town.sites.filter((row) => row.id !== siteId);
  return { ok: true, blueprint: bp, references: [] };
}

// ── households and residents ──────────────────────────────────────────────
export function addHousehold(blueprint, { name = "", siteId = "" } = {}) {
  const bp = clone(blueprint);
  const id = uniqueId("household", bp.households.map((row) => row.id));
  bp.households.push({ id, name: name || "新的一户", siteId });
  return { blueprint: bp, id };
}

export function removeHousehold(blueprint, householdId) {
  const members = list(blueprint.residents).filter((row) => row.householdId === householdId).map((row) => row.id);
  if (members.length) return { ok: false, blueprint, members };
  const bp = clone(blueprint);
  bp.households = bp.households.filter((row) => row.id !== householdId);
  return { ok: true, blueprint: bp, members: [] };
}

const pick = (values, n) => values[((n % values.length) + values.length) % values.length];

export function newResident(blueprint, householdId) {
  const id = uniqueId("resident", list(blueprint.residents).map((row) => row.id));
  const n = list(blueprint.residents).length;
  const home = list(blueprint.households).find((row) => row.id === householdId)?.siteId || "";
  return {
    id, name: "", age: 30, role: "", householdId, workSiteId: home,
    appearance: { skin: pick(COLOR_PALETTES.skin, n), hair: pick(COLOR_PALETTES.hair, n * 2 + 1), robe: pick(COLOR_PALETTES.robe, n * 3 + 2),
      sash: pick(COLOR_PALETTES.sash, n + 3), styles: [], child: false },
    personality: Object.fromEntries(PERSONALITY_SLIDERS.map((row) => [row.key, 0.5])),
    skills: [], speech: { style: "", samples: [] }, situation: "",
    desires: [], principles: [], boundaries: [], routine: [], memories: [], secrets: [],
  };
}

export function addResident(blueprint, householdId) {
  const bp = clone(blueprint);
  const resident = newResident(bp, householdId);
  bp.residents.push(resident);
  return { blueprint: bp, id: resident.id };
}

/** Removes a resident and every place that names them: relationships, positions, deadlines, holders. */
export function removeResident(blueprint, residentId) {
  const bp = clone(blueprint);
  bp.residents = bp.residents.filter((row) => row.id !== residentId);
  bp.relationships = bp.relationships.filter((row) => row.from !== residentId && row.to !== residentId);
  delete bp.opening.positions[residentId];
  for (const object of bp.opening.objects) if (object.holder === residentId) object.holder = null;
  for (const deadline of bp.opening.deadlines) {
    deadline.responsible = deadline.responsible.filter((id) => id !== residentId);
    deadline.knownBy = deadline.knownBy.filter((id) => id !== residentId);
    deadline.conditions = deadline.conditions.filter((c) => c.holder !== residentId && c.actor !== residentId);
  }
  return bp;
}

export function updateResident(blueprint, residentId, patch = {}) {
  const bp = clone(blueprint);
  const index = bp.residents.findIndex((row) => row.id === residentId);
  if (index < 0) throw Object.assign(new Error(`没有居民 ${residentId}。`), { code: "RESIDENT_UNKNOWN" });
  bp.residents[index] = { ...bp.residents[index], ...clone(patch), id: residentId };
  return bp;
}

// ── relationships ─────────────────────────────────────────────────────────
export const RELATIONSHIP_PRESETS = Object.freeze([
  { label: "父子 / 母女 / 亲人", feelings: { love: 70, protection: 60 } },
  { label: "夫妻", feelings: { love: 70, dependence: 40 } },
  { label: "老邻居", feelings: { love: 30 } },
  { label: "生意往来", feelings: { dependence: 30 } },
  { label: "师徒", feelings: { protection: 40, wantsToBeSeen: 40 } },
  { label: "暗中爱慕", feelings: { attraction: 60, wantsToBeSeen: 50 } },
  { label: "旧怨", feelings: { resentment: 60 } },
  { label: "互相较劲", feelings: { jealousy: 40, power: 30 } },
]);

export function setRelationship(blueprint, from, to, patch = {}) {
  if (from === to) throw Object.assign(new Error("关系不能指向自己。"), { code: "RELATIONSHIP_SELF" });
  const bp = clone(blueprint);
  const index = bp.relationships.findIndex((row) => row.from === from && row.to === to);
  const base = index >= 0 ? bp.relationships[index] : { from, to, label: "", address: [], feelings: {}, unspoken: "", misreading: "" };
  const next = { ...base, ...clone(patch), from, to };
  if (index >= 0) bp.relationships[index] = next; else bp.relationships.push(next);
  return bp;
}

export function removeRelationship(blueprint, from, to) {
  const bp = clone(blueprint);
  bp.relationships = bp.relationships.filter((row) => !(row.from === from && row.to === to));
  return bp;
}

// ── personality sliders ───────────────────────────────────────────────────
// Each trait is shown as a slider between what its two ends mean in words.
export const PERSONALITY_SLIDERS = Object.freeze([
  { key: "introversion", low: "外向、有话就说", high: "话少、心事往里收" },
  { key: "autonomy", low: "习惯听人安排", high: "凡事有自己的主意" },
  { key: "persistence", low: "容易泄气", high: "认准了的事不撒手" },
  { key: "conscientiousness", low: "做事马虎随性", high: "做事仔细有章法" },
  { key: "competitiveness", low: "不爱和人争", high: "好胜、不服输" },
  { key: "care", low: "对人淡漠", high: "心软，见不得人受苦" },
  { key: "caution", low: "胆子大、不太想后果", high: "谨慎多虑" },
  { key: "impulsivity", low: "沉得住气", high: "性子急，想到就做" },
]);
export const sliderValue = (personality = {}, key) => Math.round(Math.max(0, Math.min(1, Number(personality[key] ?? 0.5))) * 100);
export function setSlider(personality = {}, key, value) {
  return { ...personality, [key]: Math.round(Math.max(0, Math.min(100, Number(value) || 0))) / 100 };
}

export const SKILL_CHOICES = Object.freeze(Object.values(SKILLS).map((row) => ({ id: row.id, name: row.name })));
export const STYLE_CHOICES = Object.freeze([...APPEARANCE_STYLES]);
export const PALETTES = COLOR_PALETTES;

// ── cost estimate (spec §12) ──────────────────────────────────────────────
export const DEFAULT_CALL_TOKENS = Object.freeze({ input: 4000, output: 300 });

/** Drafting a world: about 6 + ⌈residents / 4⌉ calls. */
export function estimateDraftCalls(residents = 12) {
  return 6 + Math.ceil(Math.max(1, Number(residents) || 1) / 4);
}

/**
 * Running a town for some game hours: one schedule per resident per day plus
 * the beats where something actually happens to them. Always an estimate.
 */
export function estimateRun({ residents = 12, gameHours = 8, beatsPerResidentHour = 0.5, tokens = DEFAULT_CALL_TOKENS } = {}) {
  const people = Math.max(1, Number(residents) || 1);
  const hours = Math.max(1, Number(gameHours) || 1);
  const schedules = people * Math.max(1, Math.ceil(hours / 24));
  const beats = Math.ceil(people * hours * beatsPerResidentHour);
  const calls = schedules + beats;
  const input = Number(tokens?.input) > 0 ? Number(tokens.input) : DEFAULT_CALL_TOKENS.input;
  const output = Number(tokens?.output) > 0 ? Number(tokens.output) : DEFAULT_CALL_TOKENS.output;
  const totalTokens = calls * (input + output);
  return { calls, schedules, beats, totalTokens, text: `约 ${calls} 次调用、约 ${Math.max(1, Math.round(totalTokens / 10000))} 万 token` };
}
