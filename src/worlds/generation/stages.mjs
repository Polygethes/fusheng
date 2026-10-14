// The five stages of a quick-mode draft (spec §3, P5): world and town, the
// residents of each household (at most four per call), relationships, the
// opening, and a final pass that repairs only what validateBlueprint reports.
// Each stage has a schema the model must answer in, a prompt, and checks that
// tie its answer to what earlier stages produced.
import { SITE_TYPES, SKILLS, COLOR_PALETTES, APPEARANCE_STYLES } from "../catalog/index.mjs";
import { WORLD_SECTION_SCHEMA, SITES_SECTION_SCHEMA, RESIDENTS_SECTION_SCHEMA, RELATIONSHIPS_SECTION_SCHEMA, OPENING_SECTION_SCHEMA, BLUEPRINT_SCHEMA } from "../blueprint/schema.mjs";
import { checkAgainstSchema } from "../blueprint/schemaCheck.mjs";
import { TAVERN_RELATIONSHIP_METRICS } from "../../server/ecology/tavernRelationshipDynamics.mjs";

export const SIZE_PLANS = Object.freeze({
  small: Object.freeze({ residents: 6, households: [3, 4], label: "小（约 6 人）" }),
  medium: Object.freeze({ residents: 12, households: [4, 5], label: "中（约 12 人）" }),
  large: Object.freeze({ residents: 20, households: [5, 6], label: "大（约 20 人）" }),
});
export const RESIDENTS_PER_CALL = 4;
export const SOURCE_TEXT_LIMIT = 30000;

const list = (value) => (Array.isArray(value) ? value : []);
const clean = (value) => String(value ?? "").trim();

/** Resolve "small" | "medium" | "large" | a number into { residents, households: [min, max] }. */
export function sizePlan(sizeHint = "medium") {
  if (SIZE_PLANS[sizeHint]) return SIZE_PLANS[sizeHint];
  const residents = Math.max(4, Math.min(30, Math.round(Number(sizeHint) || 12)));
  const low = Math.max(2, Math.round(residents / 4));
  return { residents, households: [low, Math.min(8, low + 1)], label: `约 ${residents} 人` };
}

// ── catalog brief for prompts ──────────────────────────────────────────────
export function catalogBrief() {
  const skillName = (id) => SKILLS[id]?.name || id;
  const sites = Object.entries(SITE_TYPES).map(([type, def]) => {
    const rooms = list(def.rooms || def.zones).map((row) => row.label).filter(Boolean).join("、");
    const work = list(def.work).map((row) => `${row.taskLabel}${list(row.requiredSkillIds).length ? `（要${list(row.requiredSkillIds).map(skillName).join("、")}）` : ""}`).join("；");
    return `- ${type}：${def.label}（${def.kind === "building" ? "建筑" : "室外"}${rooms ? `；${rooms}` : ""}${work ? `；活计：${work}` : ""}）`;
  }).join("\n");
  const skills = Object.values(SKILLS).map((row) => `${row.id}=${row.name}`).join("，");
  const colors = Object.entries(COLOR_PALETTES).map(([key, values]) => `${key}：${values.join(" ")}`).join("\n");
  return { sites, skills, colors, styles: APPEARANCE_STYLES.join("、") };
}

// ── stage schemas ──────────────────────────────────────────────────────────
export const WORLD_STAGE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["meta", "town", "households", "householdSizes"],
  properties: {
    meta: WORLD_SECTION_SCHEMA.properties.meta,
    town: WORLD_SECTION_SCHEMA.properties.town,
    households: SITES_SECTION_SCHEMA.properties.households,
    householdSizes: { type: "object", additionalProperties: { type: "integer", minimum: 1, maximum: 6 } },
  },
};
export const RESIDENTS_STAGE_SCHEMA = RESIDENTS_SECTION_SCHEMA;
export const RELATIONSHIPS_STAGE_SCHEMA = RELATIONSHIPS_SECTION_SCHEMA;
export const OPENING_STAGE_SCHEMA = OPENING_SECTION_SCHEMA;
const SECTION_KEYS = ["meta", "town", "households", "residents", "relationships", "opening"];
export const REPAIR_STAGE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["sections"],
  properties: { sections: { type: "object", additionalProperties: false, properties: Object.fromEntries(SECTION_KEYS.map((key) => [key, BLUEPRINT_SCHEMA.properties[key]])) } },
};

// ── the shape the model answers in ─────────────────────────────────────────
// Structured output cannot describe a map whose keys are open (householdSizes,
// feelings, positions, an object's state). Wherever the blueprint has one, the
// model is asked for a list of { key, value } pairs instead, and its answer is
// turned back into the blueprint's shape before any check sees it.
const SCALAR_SCHEMA = { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] };
const isOpenMap = (schema) => schema?.type === "object" && !schema.properties && schema.additionalProperties !== false;
const mapValueSchema = (schema) => (schema.additionalProperties && typeof schema.additionalProperties === "object" ? schema.additionalProperties : null);

/** The schema as the model sees it: every open map becomes a list of { key, value }. */
export function modelSchema(schema) {
  if (Array.isArray(schema)) return schema.map(modelSchema);
  if (!schema || typeof schema !== "object") return schema;
  if (isOpenMap(schema)) {
    const value = mapValueSchema(schema) ? modelSchema(mapValueSchema(schema)) : SCALAR_SCHEMA;
    return { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "value"],
      properties: { key: { type: "string", maxLength: 48 }, value } } };
  }
  return Object.fromEntries(Object.entries(schema).map(([key, child]) => [key, modelSchema(child)]));
}

/** A model answer back in the blueprint's shape; anything already map-shaped is left as it is. */
export function fromModelShape(value, schema) {
  if (value == null || !schema || typeof schema !== "object") return value;
  if (isOpenMap(schema)) {
    if (!Array.isArray(value)) return value;
    const valueSchema = mapValueSchema(schema);
    return Object.fromEntries(value.filter((row) => row && typeof row === "object" && typeof row.key === "string")
      .map((row) => [row.key, valueSchema ? fromModelShape(row.value, valueSchema) : row.value]));
  }
  if (Array.isArray(value)) return schema.items ? value.map((row) => fromModelShape(row, schema.items)) : value;
  if (typeof value === "object" && schema.properties) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, schema.properties[key] ? fromModelShape(child, schema.properties[key]) : child]));
  }
  return value;
}

// ── checks that tie a stage to what came before ───────────────────────────
const schemaIssues = (value, schema) => checkAgainstSchema(value, schema, "").map((row) => ({ path: row.path, message: row.message }));

export function checkWorldStage(output, { plan }) {
  const issues = schemaIssues(output, WORLD_STAGE_SCHEMA);
  if (issues.length) return issues;
  const add = (path, message) => issues.push({ path, message });
  const siteIds = new Set();
  output.town.sites.forEach((site, index) => {
    if (!SITE_TYPES[site.type]) add(`town.sites[${index}].type`, `地点类型 ${site.type} 不在目录里。`);
    if (siteIds.has(site.id)) add(`town.sites[${index}].id`, `地点 id ${site.id} 重复了。`);
    siteIds.add(site.id);
  });
  const [low, high] = plan.households;
  if (output.households.length < low || output.households.length > high) add("households", `要 ${low}–${high} 户。`);
  const householdIds = new Set();
  output.households.forEach((row, index) => {
    if (householdIds.has(row.id)) add(`households[${index}].id`, `户 id ${row.id} 重复了。`);
    householdIds.add(row.id);
    if (!siteIds.has(row.siteId)) add(`households[${index}].siteId`, `户的住处 ${row.siteId} 不在 town.sites 里。`);
  });
  const sizes = output.householdSizes || {};
  for (const id of householdIds) if (!Number.isInteger(sizes[id])) add(`householdSizes.${id}`, `写出 ${id} 有几口人。`);
  for (const id of Object.keys(sizes)) if (!householdIds.has(id)) add(`householdSizes.${id}`, `${id} 不是上面的户。`);
  const total = [...householdIds].reduce((sum, id) => sum + (Number(sizes[id]) || 0), 0);
  if (total !== plan.residents) add("householdSizes", `各户人数加起来要正好 ${plan.residents} 人，现在是 ${total} 人。`);
  return issues;
}

export function checkResidentsStage(output, { world, batch, earlier = [] }) {
  const issues = schemaIssues(output, RESIDENTS_STAGE_SCHEMA);
  if (issues.length) return issues;
  const add = (path, message) => issues.push({ path, message });
  const siteIds = new Set(world.town.sites.map((row) => row.id));
  const taken = new Set(earlier.map((row) => row.id));
  if (output.residents.length !== batch.count) add("residents", `这一批要正好 ${batch.count} 人，现在是 ${output.residents.length} 人。`);
  output.residents.forEach((row, index) => {
    const at = `residents[${index}]`;
    if (taken.has(row.id)) add(`${at}.id`, `人物 id ${row.id} 已经用过了。`);
    taken.add(row.id);
    if (row.householdId !== batch.householdId) add(`${at}.householdId`, `这一批的人都属于 ${batch.householdId}。`);
    if (!siteIds.has(row.workSiteId)) add(`${at}.workSiteId`, `${row.workSiteId} 不在 town.sites 里。`);
    row.skills.forEach((skill, k) => { if (!SKILLS[skill]) add(`${at}.skills[${k}]`, `技能 ${skill} 不在目录里。`); });
    row.routine.forEach((block, k) => { if (!siteIds.has(block.siteId)) add(`${at}.routine[${k}].siteId`, `${block.siteId} 不在 town.sites 里。`); });
  });
  return issues;
}

export function checkRelationshipsStage(output, { residents }) {
  const issues = schemaIssues(output, RELATIONSHIPS_STAGE_SCHEMA);
  if (issues.length) return issues;
  const add = (path, message) => issues.push({ path, message });
  const ids = new Set(residents.map((row) => row.id));
  const seen = new Set();
  output.relationships.forEach((row, index) => {
    if (!ids.has(row.from)) add(`relationships[${index}].from`, `${row.from} 不是居民。`);
    if (!ids.has(row.to)) add(`relationships[${index}].to`, `${row.to} 不是居民。`);
    if (row.from === row.to) add(`relationships[${index}]`, "关系不能指向自己。");
    for (const key of Object.keys(row.feelings || {})) if (!TAVERN_RELATIONSHIP_METRICS.includes(key)) add(`relationships[${index}].feelings.${key}`, `感情维度 ${key} 不认识，只能用 ${TAVERN_RELATIONSHIP_METRICS.join("、")}。`);
    seen.add(row.from); seen.add(row.to);
  });
  for (const row of residents) if (!seen.has(row.id)) add("relationships", `${row.name}（${row.id}）至少要有一条关系。`);
  return issues;
}

/** Whether a deadline condition is already true in the opening as written. */
export function holdsAtOpening(condition = {}, opening = {}) {
  if (condition.kind === "actor_at") return Boolean(condition.actor) && opening.positions?.[condition.actor] === condition.siteId;
  if (condition.kind === "object_holder") {
    return Boolean(condition.holder) && (opening.objects || []).some((object) => object.name === condition.object && object.holder === condition.holder);
  }
  return false;
}

export function checkOpeningStage(output, { world, residents }) {
  const issues = schemaIssues(output, OPENING_STAGE_SCHEMA);
  if (issues.length) return issues;
  const add = (path, message) => issues.push({ path, message });
  const siteIds = new Set(world.town.sites.map((row) => row.id));
  const ids = new Set(residents.map((row) => row.id));
  const opening = output.opening;
  for (const [person, site] of Object.entries(opening.positions)) {
    if (!ids.has(person)) add(`opening.positions.${person}`, `${person} 不是居民。`);
    if (!siteIds.has(site)) add(`opening.positions.${person}`, `${site} 不在 town.sites 里。`);
  }
  const names = new Set(opening.objects.map((row) => row.name));
  opening.objects.forEach((row, index) => {
    if (row.siteId && !siteIds.has(row.siteId)) add(`opening.objects[${index}].siteId`, `${row.siteId} 不在 town.sites 里。`);
    if (row.holder && !ids.has(row.holder)) add(`opening.objects[${index}].holder`, `${row.holder} 不是居民。`);
    if (row.madeAt && !siteIds.has(row.madeAt)) add(`opening.objects[${index}].madeAt`, `${row.madeAt} 不在 town.sites 里。`);
  });
  if (!opening.deadlines.length) add("opening.deadlines", "至少要有一个时限。");
  opening.deadlines.forEach((row, index) => {
    for (const person of [...row.responsible, ...row.knownBy]) if (!ids.has(person)) add(`opening.deadlines[${index}]`, `${person} 不是居民。`);
    row.conditions.forEach((condition, k) => {
      if (condition.object && !names.has(condition.object)) add(`opening.deadlines[${index}].conditions[${k}].object`, `物件“${condition.object}”不在 opening.objects 里。`);
    });
    // A deadline already met when the town opens asks nothing of anyone.
    if (row.conditions.length && row.conditions.every((condition) => holdsAtOpening(condition, opening))) {
      add(`opening.deadlines[${index}].conditions`, `时限“${row.label}”开场时就已经满足了：换成要有人去做点什么才能达成的条件。`);
    }
  });
  return issues;
}

/** Split households into calls of at most RESIDENTS_PER_CALL people. */
export function residentBatches(world) {
  const batches = [];
  for (const household of world.households) {
    let left = Number(world.householdSizes?.[household.id]) || 0;
    while (left > 0) {
      const count = Math.min(RESIDENTS_PER_CALL, left);
      batches.push({ householdId: household.id, householdName: household.name, count });
      left -= count;
    }
  }
  return batches;
}

/** Assemble the blueprint from the stage answers produced so far. */
export function assembleBlueprint({ world, residents = [], relationships = [], opening = null } = {}) {
  return {
    blueprintVersion: 1,
    meta: structuredClone(world.meta),
    town: structuredClone(world.town),
    households: structuredClone(world.households),
    residents: structuredClone(residents),
    relationships: structuredClone(relationships),
    opening: opening ? structuredClone(opening) : { situation: "", positions: {}, objects: [], deadlines: [], mysteries: [], events: [], visitors: [] },
  };
}

export const clip = (text = "", limit = SOURCE_TEXT_LIMIT) => clean(text).slice(0, limit);
