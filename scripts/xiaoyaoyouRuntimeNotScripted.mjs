import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于 Downloads 下《逍遥游》策划案与当前版剧本，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const xie = state.characters.find((character) => character.name === "谢真石");
const zhou = state.characters.find((character) => character.name === "周珉");
const tavern = state.locations.find((location) => location.name === "望梯酒馆");
state.ui.timeGrain = "scene";
state.ui.focusMode = "location";
state.ui.selectedLocationId = tavern.id;
state.ui.activeCharacterIds = [xie.id, zhou.id];

const draft = playNext(state);
const turns = (draft.sceneInteraction?.agentExchanges || []).flatMap((exchange) => exchange.dialogueTurns || []);
const performedLines = turns.map((turn) => turn.line).filter(Boolean);
const blueprintLines = state.characters.flatMap((character) => [
  ...(character.defenseLanguage || []),
  ...(character.agentProfile?.dialogueMoves || []),
]);
const serializedWorld = JSON.stringify(state);
for (const prescribedLine of [
  "九重还没走完，先别替我说到中州。",
  "我问的是还有没有下一重。",
  "让我自己把这一剑走完。",
]) {
  assert.ok(!serializedWorld.includes(prescribedLine), `the Xiaoyaoyou world skill must describe a voice, not prescribe dialogue: ${prescribedLine}`);
}
const observableText = [
  draft.sceneText,
  ...(draft.agentOutputs || []).map((output) => output.visibleAction),
].filter(Boolean).join("\n");

assert.ok((draft.periodSimulation?.ticks?.[0]?.lifeEvents || []).length >= 1, "the focused moment must resolve lived activity before prose");
for (const line of performedLines) {
  assert.ok(!blueprintLines.includes(line), `a live line cannot be copied from the world blueprint: ${line}`);
  assert.doesNotMatch(line, /先说好|还放在这里|得留下|不能一起带走/, `a live line cannot use the object-retention response template: ${line}`);
}
for (const blueprintLine of blueprintLines) {
  assert.ok(!observableText.includes(blueprintLine), `a blueprint line cannot leak through visible action or scene prose: ${blueprintLine}`);
}
assert.doesNotMatch(performedLines.join("\n"), /九重还没走完，先别替我说到中州/, "the source path cannot prescribe Xie Zhenshi's words");

const actualActions = (draft.agentOutputs || []).map((output) => output.visibleAction || "").join("\n");
for (const possibility of tavern.likelyEvents || []) {
  if (!actualActions.includes(possibility)) {
    assert.ok(!String(draft.sceneText || "").includes(possibility), `an uncaused location possibility cannot become scene fact: ${possibility}`);
  }
}

console.log("xiaoyaoyouRuntimeNotScripted:test passed", { performedLines, activities: draft.periodSimulation?.ticks?.[0]?.lifeEvents?.map((event) => event.activityType), sceneText: draft.sceneText });
