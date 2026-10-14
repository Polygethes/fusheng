// Quick-mode drafting (spec §3, P5): one idea (and optional reference text)
// becomes a WorldBlueprint in a handful of model calls. Every stage is
// checked; a failing answer is asked again with the list of problems (at most
// twice); if it still fails, drafting stops and hands back what it has, so
// the review page can take over. Nothing is invented by code: an empty or
// broken stage is reported, never filled in.
import { validateBlueprint } from "../blueprint/validateBlueprint.mjs";
import { checkAgainstSchema } from "../blueprint/schemaCheck.mjs";
import { BLUEPRINT_SCHEMA } from "../blueprint/schema.mjs";
import {
  sizePlan, residentBatches, assembleBlueprint, clip, modelSchema, fromModelShape,
  WORLD_STAGE_SCHEMA, RESIDENTS_STAGE_SCHEMA, RELATIONSHIPS_STAGE_SCHEMA, OPENING_STAGE_SCHEMA, REPAIR_STAGE_SCHEMA,
  checkWorldStage, checkResidentsStage, checkRelationshipsStage, checkOpeningStage,
} from "./stages.mjs";
import { worldPrompt, residentsPrompt, relationshipsPrompt, openingPrompt, repairPrompt, rewritePrompt, rewriteReference } from "./prompts.mjs";

export const STAGE_RETRIES = 2;
export const REPAIR_ROUNDS = 2;

function fail(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

/** Calls the model within a request budget; a reply that is not JSON counts as a failed answer. */
function budgetedCaller(callModel, maxRequests, onProgress) {
  let used = 0;
  return {
    get used() { return used; },
    async ask(request) {
      if (used >= maxRequests) throw fail("GENERATION_BUDGET_EXCEEDED", `已经用完授权的 ${maxRequests} 次请求。`);
      used += 1;
      onProgress?.({ event: "request", stage: request.stage, label: request.label, request: used, maxRequests });
      try {
        // The model answers open maps as { key, value } lists; checks see the blueprint's shape.
        return { output: fromModelShape(await callModel({ ...request, schema: modelSchema(request.schema) }), request.schema) };
      } catch (error) {
        if (error.code === "CHARACTER_STAGE_OUTPUT_INVALID" || error instanceof SyntaxError) {
          return { output: null, issues: [{ path: "", message: "回答不是一个完整合法的 JSON 对象。" }] };
        }
        throw error;
      }
    },
  };
}

async function runStage(caller, { stage, label, schema, prompt, check }) {
  let issues = [];
  for (let attempt = 0; attempt <= STAGE_RETRIES; attempt += 1) {
    const { system, user } = prompt(issues);
    const reply = await caller.ask({ stage, label, system, user, schema, attempt });
    issues = reply.issues || check(reply.output);
    if (!issues.length) return reply.output;
  }
  throw fail("GENERATION_STAGE_FAILED", `「${label}」这一段改了 ${STAGE_RETRIES} 次仍没有通过检查。`, { stage, issues });
}

/**
 * @returns {Promise<{ ok, blueprint, issues, requests, stoppedAt? }>}
 */
export async function generateBlueprint({ idea = "", sourceText = "", sizeHint = "medium" } = {}, { callModel, maxRequests = 20, onProgress } = {}) {
  if (typeof callModel !== "function") throw fail("GENERATION_MODEL_REQUIRED", "需要一个模型调用函数。");
  const plan = sizePlan(sizeHint);
  const text = clip(sourceText);
  const caller = budgetedCaller(callModel, maxRequests, onProgress);
  const parts = { world: null, residents: [], relationships: [], opening: null };
  const partial = () => (parts.world ? assembleBlueprint(parts) : null);
  const stopped = (error) => ({ ok: false, blueprint: partial(), issues: error.issues || [{ path: "", message: error.message }],
    requests: caller.used, stoppedAt: error.stage || null, code: error.code });
  try {
    onProgress?.({ event: "stage", stage: "world", label: "世界与小镇" });
    parts.world = await runStage(caller, { stage: "world", label: "世界与小镇", schema: WORLD_STAGE_SCHEMA,
      prompt: (issues) => worldPrompt({ idea, sourceText: text, plan, issues }), check: (output) => checkWorldStage(output, { plan }) });
    for (const batch of residentBatches(parts.world)) {
      const label = `居民：${batch.householdName}（${batch.count} 人）`;
      onProgress?.({ event: "stage", stage: "residents", label });
      const reply = await runStage(caller, { stage: "residents", label, schema: RESIDENTS_STAGE_SCHEMA,
        prompt: (issues) => residentsPrompt({ idea, sourceText: text, world: parts.world, batch, earlier: parts.residents, issues }),
        check: (output) => checkResidentsStage(output, { world: parts.world, batch, earlier: parts.residents }) });
      parts.residents.push(...reply.residents);
    }
    onProgress?.({ event: "stage", stage: "relationships", label: "关系" });
    parts.relationships = (await runStage(caller, { stage: "relationships", label: "关系", schema: RELATIONSHIPS_STAGE_SCHEMA,
      prompt: (issues) => relationshipsPrompt({ world: parts.world, residents: parts.residents, issues }),
      check: (output) => checkRelationshipsStage(output, { residents: parts.residents }) })).relationships;
    onProgress?.({ event: "stage", stage: "opening", label: "开场" });
    parts.opening = (await runStage(caller, { stage: "opening", label: "开场", schema: OPENING_STAGE_SCHEMA,
      prompt: (issues) => openingPrompt({ world: parts.world, residents: parts.residents, relationships: parts.relationships, issues }),
      check: (output) => checkOpeningStage(output, { world: parts.world, residents: parts.residents }) })).opening;
  } catch (error) {
    if (["GENERATION_STAGE_FAILED", "GENERATION_BUDGET_EXCEEDED"].includes(error.code)) return stopped(error);
    throw error;
  }

  // Final pass: repair only what the blueprint checks report.
  let blueprint = assembleBlueprint(parts);
  let issues = validateBlueprint(blueprint).issues;
  for (let round = 1; issues.length && round <= REPAIR_ROUNDS; round += 1) {
    onProgress?.({ event: "stage", stage: "repair", label: `修整（第 ${round} 轮，${issues.length} 个问题）` });
    let reply;
    try {
      reply = await caller.ask({ stage: "repair", label: "修整", schema: REPAIR_STAGE_SCHEMA, ...repairPrompt({ blueprint, issues }) });
    } catch (error) {
      if (error.code === "GENERATION_BUDGET_EXCEEDED") return { ok: false, blueprint, issues, requests: caller.used, stoppedAt: "repair", code: error.code };
      throw error;
    }
    const sections = reply.output?.sections;
    if (!sections || checkAgainstSchema(reply.output, REPAIR_STAGE_SCHEMA, "").length) continue;
    const next = { ...structuredClone(blueprint), ...structuredClone(sections) };
    const nextIssues = validateBlueprint(next).issues;
    if (nextIssues.length < issues.length) { blueprint = next; issues = nextIssues; }
  }
  onProgress?.({ event: "done", ok: issues.length === 0, issues: issues.length, requests: caller.used });
  return { ok: issues.length === 0, blueprint, issues, requests: caller.used };
}

// ── rewrite one part ───────────────────────────────────────────────────────
const PART_SCHEMAS = {
  meta: BLUEPRINT_SCHEMA.properties.meta,
  town: BLUEPRINT_SCHEMA.properties.town,
  opening: BLUEPRINT_SCHEMA.properties.opening,
  resident: BLUEPRINT_SCHEMA.properties.residents.items,
  relationship: BLUEPRINT_SCHEMA.properties.relationships.items,
};

/**
 * Locate one rewritable part: "meta", "town", "opening", "residents/<id>" or
 * "relationships/<from>/<to>". Returns { kind, label, get, set }.
 */
export function locatePart(blueprint, sectionPath = "") {
  const [head, a, b] = String(sectionPath).split("/");
  if (["meta", "town", "opening"].includes(head) && !a) {
    return { kind: head, path: head, label: { meta: "世界", town: "小镇", opening: "开场" }[head], get: (bp) => bp[head], set: (bp, value) => { bp[head] = value; } };
  }
  if (head === "residents" && a) {
    const index = blueprint.residents.findIndex((row) => row.id === a);
    if (index < 0) throw fail("REWRITE_TARGET_UNKNOWN", `没有居民 ${a}。`);
    return { kind: "resident", path: `residents[${index}]`, label: `居民 ${blueprint.residents[index].name}`, get: (bp) => bp.residents[index], set: (bp, value) => { bp.residents[index] = value; }, id: a };
  }
  if (head === "relationships" && a && b) {
    const index = blueprint.relationships.findIndex((row) => row.from === a && row.to === b);
    if (index < 0) throw fail("REWRITE_TARGET_UNKNOWN", `没有 ${a} 到 ${b} 的关系。`);
    return { kind: "relationship", path: `relationships[${index}]`, label: `关系 ${a}→${b}`, get: (bp) => bp.relationships[index], set: (bp, value) => { bp.relationships[index] = value; }, from: a, to: b };
  }
  throw fail("REWRITE_PATH_INVALID", "只能重写 meta、town、opening、residents/<id> 或 relationships/<from>/<to>。");
}

/**
 * Rewrite exactly one part; every other part stays byte-for-byte the same.
 * @returns {Promise<{ ok, blueprint, issues, requests }>}
 */
export async function rewriteSection(blueprint, sectionPath, instruction = "", { callModel, maxRequests = 3 } = {}) {
  if (typeof callModel !== "function") throw fail("GENERATION_MODEL_REQUIRED", "需要一个模型调用函数。");
  const part = locatePart(blueprint, sectionPath);
  const schema = PART_SCHEMAS[part.kind];
  const caller = budgetedCaller(callModel, maxRequests);
  // Problems the part already had are the player's to keep or fix; a rewrite may not add new ones.
  const ownIssues = (bp) => validateBlueprint(bp).issues.filter((row) => {
    const at = String(row.path || "");
    return at === part.path || at.startsWith(`${part.path}.`) || at.startsWith(`${part.path}[`);
  });
  const known = new Set(ownIssues(blueprint).map((row) => `${row.code}|${row.path}`));
  const reference = rewriteReference(part.kind, blueprint);
  let issues = [];
  for (let attempt = 0; attempt <= STAGE_RETRIES && caller.used < maxRequests; attempt += 1) {
    const prompt = rewritePrompt({ blueprint, target: part.label, current: part.get(blueprint), instruction, reference });
    const reply = await caller.ask({ stage: "rewrite", label: part.label, schema, system: prompt.system,
      user: issues.length ? `${prompt.user}\n\n【上一次的回答没有通过检查】\n${issues.map((row) => `- ${row.path}：${row.message}`).join("\n")}` : prompt.user });
    issues = reply.issues || checkAgainstSchema(reply.output, schema, "").map((row) => ({ path: row.path, message: row.message }));
    if (!issues.length && part.kind === "resident" && reply.output.id !== part.id) issues = [{ path: "id", message: `id 必须保持 ${part.id}。` }];
    if (!issues.length && part.kind === "relationship" && (reply.output.from !== part.from || reply.output.to !== part.to)) issues = [{ path: "from/to", message: "from 和 to 不能变。" }];
    if (issues.length) continue;
    const next = structuredClone(blueprint);
    part.set(next, reply.output);
    issues = ownIssues(next).filter((row) => !known.has(`${row.code}|${row.path}`)).map((row) => ({ path: row.path, message: row.message }));
    if (issues.length) continue;
    return { ok: true, blueprint: next, issues: validateBlueprint(next).issues, requests: caller.used };
  }
  return { ok: false, blueprint, issues, requests: caller.used };
}
