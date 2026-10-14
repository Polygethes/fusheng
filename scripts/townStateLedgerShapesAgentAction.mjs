import assert from "node:assert/strict";
import { characterAgent } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});

const actor = state.characters.find((item) => item.id === "char_xianxia_yanwujie");
const target = state.characters.find((item) => item.id === "char_xianxia_shenheng");
const location = state.locations.find((item) => item.id === "loc_xianxia_contract_gate");
assert.ok(actor && target && location, "fixture should include xianxia gate characters");

state.relationships = [];
state.characterMemories = [];
state.characterPlans = [];
state.ui.activeCharacterIds = [actor.id, target.id];
state.ui.selectedLocationId = location.id;
state.townStateLedger = [{
  id: "ledger_test_contract_gate",
  projectId: state.project.id,
  branchId: state.ui.activeBranchId || state.project.activeBranchId || "branch_main",
  sourceDraftId: "draft_previous_day",
  sourceTickId: "tick_previous_day",
  periodSlot: "上午",
  locationId: location.id,
  locationName: location.name,
  fromCharacterId: target.id,
  fromCharacterName: target.name,
  toCharacterId: actor.id,
  toCharacterName: actor.name,
  object: "灵契",
  kind: "control",
  fact: "灵契被推到众人能看见的位置；阎无咎按住灵契，沈珩递出的手没有落下",
  consequence: "灵契留在四方法契门的见证处，阎无咎必须当场回应，沈珩暂时控制解释权",
  finalTurn: "灵契不进暗账；它还在铜盘，刚才漏掉的名字现在补上。",
  stateKey: "branch_main:loc_xianxia_contract_gate:灵契",
}];

const output = characterAgent({
  state,
  character: actor,
  activeCharacters: [actor, target],
  location,
});

assert.ok(output.townStatePressure, "agent output should expose the current world-state pressure it is reacting to");
assert.match(
  `${output.visibleAction} ${output.desireReason} ${output.townStatePressureSummary}`,
  /灵契|必须当场回应|控制解释权|见证处/,
  `ledger pressure should shape the next agent action, got:\n${JSON.stringify(output, null, 2)}`,
);
assert.equal(output.targetCharacterId, target.id, "ledger pressure should retarget the affected character pair");

console.log("townStateLedgerShapesAgentAction:test passed", {
  tone: output.tone,
  pressure: output.townStatePressureSummary,
});
