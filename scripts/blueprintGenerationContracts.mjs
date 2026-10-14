// Quick-mode drafting with a scripted model (P5): the stages assemble a valid
// blueprint; a broken answer is asked again with its problems; a stage that
// keeps failing stops the draft and hands back what exists; the request budget
// is never exceeded; the final pass repairs only what the checks report; and
// rewriting one part leaves every other part exactly as it was.
import assert from "node:assert/strict";
import fs from "node:fs";
import { generateBlueprint, rewriteSection } from "../src/worlds/generation/generateBlueprint.mjs";
import { SOURCE_TEXT_LIMIT, holdsAtOpening } from "../src/worlds/generation/stages.mjs";
import { validateBlueprint } from "../src/worlds/blueprint/validateBlueprint.mjs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { validateWorldPack } from "../src/worlds/validateWorldPack.mjs";
import { TAVERN_RELATIONSHIP_METRICS } from "../src/server/ecology/tavernRelationshipDynamics.mjs";

const fixture = JSON.parse(fs.readFileSync("scripts/fixtures/blueprints/river_town.json", "utf8"));
// The engine's relationship metrics only; anything else is not a feeling it reads.
for (const row of fixture.relationships) {
  row.feelings = Object.fromEntries(Object.entries(row.feelings || {}).filter(([key]) => TAVERN_RELATIONSHIP_METRICS.includes(key)));
  if (!Object.keys(row.feelings).length) row.feelings = { love: 40 };
}
const sizes = Object.fromEntries(fixture.households.map((row) => [row.id, fixture.residents.filter((r) => r.householdId === row.id).length]));
const IDEA = "江边渡口小镇，官船要靠岸，铁匠和药铺都在赶工。";

// A scripted model that answers each stage from the fixture.
function fixtureModel({ broken = new Set(), notJson = new Set(), ghostHousehold = false, rewrite = null } = {}) {
  const calls = [];
  async function callModel(request) {
    calls.push(request);
    const key = `${request.stage}:${calls.filter((row) => row.stage === request.stage).length}`;
    if (notJson.has(key)) throw Object.assign(new Error("not json"), { code: "CHARACTER_STAGE_OUTPUT_INVALID" });
    if (broken.has(key) || broken.has(`${request.stage}:*`)) return { meta: { title: 1 } };
    if (request.stage === "world") {
      const town = structuredClone(fixture.town);
      if (ghostHousehold) town.sites[0].householdId = "ghost_house";
      return { meta: fixture.meta, town, households: fixture.households, householdSizes: sizes };
    }
    if (request.stage === "residents") {
      const id = request.user.match(/householdId: ([a-z0-9_-]+)/u)[1];
      return { residents: fixture.residents.filter((row) => row.householdId === id) };
    }
    if (request.stage === "relationships") return { relationships: fixture.relationships };
    if (request.stage === "opening") return { opening: fixture.opening };
    if (request.stage === "repair") return { sections: { town: fixture.town } };
    if (request.stage === "rewrite") return rewrite(request);
    throw new Error(`unexpected stage ${request.stage}`);
  }
  return { callModel, calls };
}
const progress = [];

// A model that honours the schema it is sent: where that schema asks for a
// { key, value } list, it answers with one.
const isPairList = (schema) => schema?.type === "array" && schema.items?.required?.join() === "key,value";
function answerAs(value, schema) {
  if (value == null || !schema || typeof schema !== "object") return value;
  if (isPairList(schema)) {
    return typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value).map(([key, child]) => ({ key, value: answerAs(child, schema.items.properties.value) })) : value;
  }
  if (Array.isArray(value)) return schema.items ? value.map((row) => answerAs(row, schema.items)) : value;
  if (typeof value === "object" && schema.properties) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, schema.properties[key] ? answerAs(child, schema.properties[key]) : child]));
  }
  return value;
}
/** Paths of objects whose keys are open — structured output cannot express them. */
function openMaps(schema, at = "") {
  if (!schema || typeof schema !== "object") return [];
  if (Array.isArray(schema)) return schema.flatMap((row, index) => openMaps(row, `${at}[${index}]`));
  const here = schema.type === "object" && !schema.properties ? [at || "(root)"] : [];
  return [...here, ...Object.entries(schema).flatMap(([key, child]) => openMaps(child, `${at}.${key}`))];
}

// 1. The happy path: 1 world + 5 households + relationships + opening = 8 calls.
{
  const model = fixtureModel();
  const result = await generateBlueprint({ idea: IDEA, sizeHint: 14 }, { callModel: model.callModel, maxRequests: 20, onProgress: (row) => progress.push(row) });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.requests, 8);
  assert.deepEqual(model.calls.map((row) => row.stage), ["world", "residents", "residents", "residents", "residents", "residents", "relationships", "opening"]);
  assert.ok(model.calls.every((row) => row.schema && row.system && row.user), "every call carries a schema and a prompt");
  assert.match(model.calls[0].user, /江边渡口小镇/u, "the idea reaches the first stage");
  assert.deepEqual(validateBlueprint(result.blueprint).issues, []);
  assert.deepEqual(result.blueprint.residents.map((row) => row.id), fixture.residents.map((row) => row.id));
  const { pack } = compileBlueprint(result.blueprint, { seed: 1 });
  assert.deepEqual(validateWorldPack(pack).issues, [], "the draft compiles into a clean town");
  assert.ok(progress.some((row) => row.event === "stage" && row.stage === "opening") && progress.at(-1).event === "done");
}

// 1b. The model is never sent a map with open keys; it answers such maps as
// { key, value } lists, and the draft comes out exactly as from map answers.
{
  const plain = await generateBlueprint({ idea: IDEA, sizeHint: 14 }, { callModel: fixtureModel().callModel, maxRequests: 20 });
  const model = fixtureModel({ ghostHousehold: true });
  const listed = async (request) => answerAs(await model.callModel(request), request.schema);
  const result = await generateBlueprint({ idea: IDEA, sizeHint: 14 }, { callModel: listed, maxRequests: 20 });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(model.calls.map((row) => row.stage).at(-1), "repair", "the repair stage is covered too");
  for (const call of model.calls) assert.deepEqual(openMaps(call.schema), [], `the ${call.stage} stage asks for no open map`);
  assert.equal(model.calls[0].schema.properties.householdSizes.type, "array");
  assert.deepEqual(result.blueprint, plain.blueprint, "list answers become the same blueprint");
  assert.equal(result.blueprint.relationships.every((row) => !Array.isArray(row.feelings)), true);

  const relation = plain.blueprint.relationships[0];
  const relModel = fixtureModel({ rewrite: () => ({ ...structuredClone(relation), feelings: { love: 70, fear: 20 } }) });
  const rewritten = await rewriteSection(plain.blueprint, `relationships/${relation.from}/${relation.to}`, "",
    { callModel: async (request) => answerAs(await relModel.callModel(request), request.schema) });
  assert.deepEqual(openMaps(relModel.calls[0].schema), []);
  assert.deepEqual(rewritten.blueprint.relationships[0].feelings, { love: 70, fear: 20 });
}

// 2. A broken answer is asked again with its problems.
{
  const model = fixtureModel({ broken: new Set(["world:1"]), notJson: new Set(["relationships:1"]) });
  const result = await generateBlueprint({ idea: IDEA, sizeHint: 14 }, { callModel: model.callModel, maxRequests: 20 });
  assert.equal(result.ok, true);
  assert.equal(result.requests, 10);
  const worldCalls = model.calls.filter((row) => row.stage === "world");
  assert.equal(worldCalls.length, 2);
  assert.doesNotMatch(worldCalls[0].user, /没有通过检查/u);
  assert.match(worldCalls[1].user, /上一次的回答没有通过检查/u, "the second ask lists what was wrong");
  assert.match(model.calls.filter((row) => row.stage === "relationships")[1].user, /不是一个完整合法的 JSON/u);
}

// 3. A stage that keeps failing stops the draft; nothing is filled in by code.
{
  const model = fixtureModel({ broken: new Set(["opening:*"]) });
  const result = await generateBlueprint({ idea: IDEA, sizeHint: 14 }, { callModel: model.callModel, maxRequests: 20 });
  assert.equal(result.ok, false);
  assert.equal(result.stoppedAt, "opening");
  assert.equal(result.code, "GENERATION_STAGE_FAILED");
  assert.equal(model.calls.filter((row) => row.stage === "opening").length, 3, "one ask and two repairs");
  assert.equal(result.blueprint.residents.length, 14, "what was drafted is handed back");
  assert.deepEqual(result.blueprint.opening.deadlines, [], "the missing opening is left empty, not invented");
}

// 3b. A deadline already met at the opening is sent back; one condition still to do is enough.
{
  const opening = structuredClone(fixture.opening);
  const [person, site] = Object.entries(opening.positions)[0];
  opening.deadlines[0] = { ...opening.deadlines[0], conditions: [{ kind: "actor_at", actor: person, siteId: site }] };
  let asked = 0;
  const model = fixtureModel();
  const callModel = async (request) => (request.stage === "opening" && (asked += 1) === 1 ? { opening } : model.callModel(request));
  const result = await generateBlueprint({ idea: IDEA, sizeHint: 14 }, { callModel, maxRequests: 20 });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  const openingCalls = model.calls.filter((row) => row.stage === "opening");
  assert.equal(openingCalls.length, 1, "the second opening ask came after the first was refused");
  assert.match(openingCalls[0].user, /开场时就已经满足了/u);
  assert.equal(holdsAtOpening({ kind: "actor_at", actor: person, siteId: site }, opening), true);
  assert.equal(holdsAtOpening({ kind: "object_ready", object: "x" }, opening), false);
}

// 4. The request budget is never exceeded.
{
  const model = fixtureModel();
  const result = await generateBlueprint({ idea: IDEA, sizeHint: 14 }, { callModel: model.callModel, maxRequests: 4 });
  assert.equal(result.ok, false);
  assert.equal(result.code, "GENERATION_BUDGET_EXCEEDED");
  assert.equal(model.calls.length, 4);
  assert.equal(result.requests, 4);
}

// 5. The final pass repairs only what validateBlueprint reports.
{
  const model = fixtureModel({ ghostHousehold: true });
  const result = await generateBlueprint({ idea: IDEA, sizeHint: 14 }, { callModel: model.callModel, maxRequests: 20 });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  const repair = model.calls.filter((row) => row.stage === "repair");
  assert.equal(repair.length, 1);
  assert.match(repair[0].user, /ghost_house/u, "the repair prompt names the reported problem");
  assert.equal(result.blueprint.town.sites[0].householdId, fixture.town.sites[0].householdId);
}

// 6. Reference text is cut to the limit before it reaches the model.
{
  const model = fixtureModel();
  const sourceText = `${"渡口的故事。".repeat(Math.ceil((SOURCE_TEXT_LIMIT + 5000) / 6))}尾巴不该出现`;
  await generateBlueprint({ idea: IDEA, sourceText, sizeHint: 14 }, { callModel: model.callModel, maxRequests: 20 });
  assert.doesNotMatch(model.calls[0].user, /尾巴不该出现/u);
  assert.ok(model.calls[0].user.length < SOURCE_TEXT_LIMIT + 6000);
}

// 7. Rewriting one part leaves the rest exactly as it was.
{
  const base = structuredClone(fixture);
  const target = base.residents[2];
  const model = fixtureModel({ rewrite: () => ({ ...structuredClone(target), situation: "今早腰伤又犯了，硬撑着开门。" }) });
  const result = await rewriteSection(base, `residents/${target.id}`, "让他更累一点", { callModel: model.callModel });
  assert.equal(result.ok, true);
  assert.equal(result.blueprint.residents[2].situation, "今早腰伤又犯了，硬撑着开门。");
  const strip = (bp) => JSON.stringify({ ...bp, residents: bp.residents.filter((row) => row.id !== target.id) });
  assert.equal(strip(result.blueprint), strip(base), "every other part is unchanged");
  assert.match(model.calls[0].user, /让他更累一点/u);

  const relation = base.relationships[0];
  const relModel = fixtureModel({ rewrite: () => ({ ...structuredClone(relation), label: "父子 / 嘴硬心软" }) });
  const relResult = await rewriteSection(base, `relationships/${relation.from}/${relation.to}`, "", { callModel: relModel.callModel });
  assert.equal(relResult.blueprint.relationships[0].label, "父子 / 嘴硬心软");
  assert.equal(JSON.stringify(relResult.blueprint.relationships.slice(1)), JSON.stringify(base.relationships.slice(1)));

  const idModel = fixtureModel({ rewrite: () => ({ ...structuredClone(target), id: "someone_else" }) });
  const idResult = await rewriteSection(base, `residents/${target.id}`, "", { callModel: idModel.callModel, maxRequests: 3 });
  assert.equal(idResult.ok, false, "a rewrite may not change who it is");
  assert.equal(idModel.calls.length, 3);
  assert.equal(JSON.stringify(idResult.blueprint), JSON.stringify(base));

  await assert.rejects(() => rewriteSection(base, "residents/nobody", "", { callModel: model.callModel }), (error) => error.code === "REWRITE_TARGET_UNKNOWN");
  await assert.rejects(() => rewriteSection(base, "households", "", { callModel: model.callModel }), (error) => error.code === "REWRITE_PATH_INVALID");
}

// 7b. A rewrite must hold together with the catalog and the draft: it is told
// what it may choose from, an invented skill is sent back, a rewrite that keeps
// adding problems is not taken, and problems the part already had do not count.
{
  const base = structuredClone(fixture);
  const target = base.residents[2];
  const invented = { ...structuredClone(target), skills: ["辨识草药"] };
  const issues = validateBlueprint({ ...base, residents: base.residents.map((row) => (row.id === target.id ? invented : row)) }).issues;
  assert.ok(issues.some((row) => row.code === "RESIDENT_SKILL_UNKNOWN" && row.path === "residents[2].skills[0]"), "an unknown skill is reported");

  let asked = 0;
  const fixing = fixtureModel({ rewrite: () => ((asked += 1) === 1 ? invented : { ...structuredClone(target), situation: "学着认药。" }) });
  const fixed = await rewriteSection(base, `residents/${target.id}`, "", { callModel: fixing.callModel });
  assert.equal(fixed.ok, true);
  assert.equal(fixing.calls.length, 2);
  assert.match(fixing.calls[0].user, /技能 skills 只能用这些 id/u, "the rewrite is told which skills exist");
  assert.match(fixing.calls[1].user, /不在目录里/u, "the second ask says what was wrong");
  assert.deepEqual(fixed.blueprint.residents[2].skills, target.skills);

  const stubborn = fixtureModel({ rewrite: () => invented });
  const refused = await rewriteSection(base, `residents/${target.id}`, "", { callModel: stubborn.callModel, maxRequests: 3 });
  assert.equal(refused.ok, false);
  assert.equal(JSON.stringify(refused.blueprint), JSON.stringify(base), "nothing is taken from a rewrite that adds problems");

  const sparse = structuredClone(base);
  sparse.residents[2].desires = [];
  const keepModel = fixtureModel({ rewrite: () => ({ ...structuredClone(sparse.residents[2]), situation: "还没想好要什么。" }) });
  const kept = await rewriteSection(sparse, `residents/${target.id}`, "", { callModel: keepModel.callModel });
  assert.equal(kept.ok, true, "a problem the part already had does not block the rewrite");
  assert.ok(kept.issues.some((row) => row.code === "RESIDENT_DESIRES_EMPTY"), "and it is still reported");
}

console.log("Blueprint generation passed: staged draft, repair loop, honest stop, request budget, final repair, text limit, one-part rewrite.");
