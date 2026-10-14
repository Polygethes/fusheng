import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { auditDramaticCharacter, buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于 Downloads 下《逍遥游》策划案与当前版剧本，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚，只写开场前史，不预知后续剧情。",
});

assert.equal(state.worldSetup.worldDossier.worldId, "xiaoyaoyou", "the source prompt should select the Xiaoyaoyou blueprint");
assert.equal(state.project.title, "逍遥游 · 望梯酒馆", "the project should identify the fixed tavern inside the source world");
assert.match(state.worldSetup.worldDossier.timepoint, /第一集|璞玉|九重|尚未/, "the world must be anchored before the episode-one event");
assert.match(JSON.stringify(state.worldSetup.sourceMaterial), /逍遥游_策划案\.md.*xiaoyaoyou_ep01\.md/s, "the world should record its local source material");

const names = state.characters.map((character) => character.name);
assert.deepEqual(names, ["谢真石", "周珉", "洛照", "严执中", "谢恒", "谢母", "陈砚"], "the opening cast should come from the current episode-one script");
assert.equal(new Set(state.characters.map((character) => character.agentProfile.dramaticObjective)).size, state.characters.length, "every character needs a distinct present objective");
assert.equal(new Set(state.characters.map((character) => character.agentProfile.leverageObject)).size, state.characters.length, "every character needs a distinct leverage object");

for (const character of state.characters) {
  const audit = auditDramaticCharacter(character, state.characters);
  assert.ok(audit.score >= 80, `${character.name} should be a dramatic agent, got ${audit.score}`);
  assert.ok(character.internalSituation.unfinishedOldRelation, `${character.name} needs prehistory at the opening timepoint`);
}

const rules = [...state.town.publicRules, ...state.town.hiddenRules, state.town.pressureClock].join("\n");
for (const term of ["一日不进", "云梯榜", "功法", "典当", "飞升", "二手"]) {
  assert.ok(rules.includes(term), `the runnable world should encode ${term}`);
}

assert.deepEqual(state.locations.map((location) => location.name), ["望梯酒馆"], "the source world now has one fixed playable stage");
assert.deepEqual(state.locations[0].functions, ["供饭", "歇脚", "交换消息", "等人", "临时做工"]);
assert.ok(state.locations[0].accessRules?.length && state.locations[0].socialRules?.length, "the tavern must constrain feasible behavior");
for (const term of ["剑阁", "云梯榜", "坊市", "典功行"]) {
  assert.ok(JSON.stringify(state.town).includes(term), `the outside world pressure should still retain ${term}`);
}

const relations = state.relationships.map((relationship) => {
  const from = state.characters.find((character) => character.id === relationship.fromCharacterId)?.name;
  const to = state.characters.find((character) => character.id === relationship.toCharacterId)?.name;
  return `${from}-${to}:${relationship.label}:${relationship.unspoken}`;
}).join("\n");
assert.match(relations, /谢真石-谢恒.*父子/, "the father-son pressure should exist before the story starts");
assert.match(relations, /谢真石-周珉.*同门/, "the unequal friendship should exist before the story starts");
assert.match(relations, /洛照-严执中.*来访/, "the visiting disciple should be connected institutionally without invented personal history");

const serialized = JSON.stringify(state);
for (const futureSpoiler of ["父亲死", "谢恒死", "公众之死", "家道中落", "远走他乡", "醉飞", "吞噬者", "没人要你还了"]) {
  assert.ok(!serialized.includes(futureSpoiler), `future plot knowledge must not enter the opening world: ${futureSpoiler}`);
}
for (const oldWorld of ["停剑城", "沈珩", "格里高尔", "萨姆沙"]) {
  assert.ok(!serialized.includes(oldWorld), `the new world must not leak a previous preset: ${oldWorld}`);
}

state.ui.focusMode = "location";
state.ui.timeGrain = "day";
const draft = playNext(state);
assert.equal(draft.periodSimulation?.ticks?.length, 5, "the source-grounded town should run a complete local day");
const knownCharacterIds = new Set(state.characters.map((character) => character.id));
for (const tick of draft.periodSimulation.ticks) {
  for (const characterId of tick.participantIds || []) {
    assert.ok(knownCharacterIds.has(characterId), `a running tick must not invent character ${characterId}`);
  }
}
assert.doesNotMatch(JSON.stringify(draft), /停剑城|沈珩|格里高尔/, "running the new town must not reintroduce an old world");

console.log("xiaoyaoyouWorld:test passed", { names, locations: state.locations.map((location) => location.name) });
