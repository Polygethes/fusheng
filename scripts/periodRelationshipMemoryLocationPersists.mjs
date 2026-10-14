import assert from "node:assert/strict";
import { buildUpdateBundle } from "../src/engine/stateUpdater.js";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

const shen = state.characters.find((item) => item.id === "char_xianxia_shenheng");
const aoji = state.characters.find((item) => item.id === "char_xianxia_aoji");
assert.ok(shen && aoji, "test characters should exist");

state.relationships.push({
  id: "rel_period_memory_location_persist",
  projectId: state.project.id,
  fromCharacterId: shen.id,
  toCharacterId: aoji.id,
  label: "扣渡令 / 城法",
  resentment: 88,
  wantsToBeSeen: 70,
  fear: 36,
  dependence: 8,
  revenge: 42,
  deception: 18,
  wantsToEscape: 20,
  unspoken: "沈珩还没决定敖霁的渡令是不是破禁证据。",
  misreading: "沈珩把敖霁的水阵听成替血河楼开路。",
  lastDialogue: {
    source: "agent-dialogue-relationship",
    relationshipSource: "agent-exchange",
    sharedObject: "渡令",
    eventOutcome: "敖霁把渡令压回岸上，沈珩没有让水阵撤开。",
    finalTurn: "渡令先停，水阵不开。",
    followupTurn: "你扣的是渡令，还是龙裔的退路？",
    dialogueTurnCount: 4,
    updatedAt: new Date().toISOString(),
  },
});

state.characterMemories.push({
  id: "mem_period_memory_location_persist",
  projectId: state.project.id,
  branchId: "branch_main",
  characterId: shen.id,
  targetCharacterId: aoji.id,
  type: "weaponized",
  stance: "revenge",
  content: "关系对话记忆：沈珩记住了敖霁在归墟渡的回应，渡令没有从场中消失。",
  privateVersion: "敖霁把渡令压回岸上；追问：你扣的是渡令，还是龙裔的退路？",
  source: "agent_dialogue_relationship",
  sourceRelationshipShift: {
    generatedFrom: "agent-dialogue-relationship",
    sharedObject: "渡令",
    dialogueTurnCount: 4,
    finalTurn: "渡令先停，水阵不开。",
    followupTurn: "你扣的是渡令，还是龙裔的退路？",
    relationshipSource: "agent-exchange",
  },
  reliability: 60,
  heat: 98,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.activeTab = "observe";
state.ui.selectedLocationId = "loc_xianxia_contract_gate";

const draft = playNext(state);
const ferryShift = (draft.relationshipShift || []).find((shift) =>
  shift.fromCharacterId === shen.id
  && shift.toCharacterId === aoji.id
  && shift.sharedObject === "渡令"
);

assert.ok(ferryShift, "period draft should produce a relationship shift for the pulled ferry encounter");
assert.equal(ferryShift.locationName, "归墟渡", "relationship shift should carry the period tick location");

const updateBundle = buildUpdateBundle(draft, state);
const ferryMemory = (updateBundle.characterMemories || []).find((memory) =>
  memory.source === "agent_dialogue_relationship"
  && memory.characterId === shen.id
  && memory.targetCharacterId === aoji.id
  && memory.sourceRelationshipShift?.sharedObject === "渡令"
);

assert.ok(ferryMemory, "update bundle should create a dialogue memory for the pulled ferry encounter");
assert.match(ferryMemory.content, /归墟渡/, "dialogue memory should preserve the tick location, not the draft's default location");
assert.doesNotMatch(ferryMemory.content, /四方法契门/, "dialogue memory should not misfile the ferry encounter under the selected/default location");

console.log("periodRelationshipMemoryLocationPersists:test passed", {
  shiftLocation: ferryShift.locationName,
  memory: ferryMemory.content,
});
