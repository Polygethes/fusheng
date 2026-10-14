import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

const {
  acceptDraft,
  applySetupWorld,
  applyUpdateBundle,
  getState,
  resetState,
  saveDraft,
  setUi,
} = await import("../src/state/store.js");

resetState();
applySetupWorld({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

let state = getState();
const shen = state.characters.find((item) => item.id === "char_xianxia_shenheng");
const aoji = state.characters.find((item) => item.id === "char_xianxia_aoji");
assert.ok(shen && aoji, "test characters should exist");

applyUpdateBundle({
  relationships: [{
    fromCharacterId: shen.id,
    toCharacterId: aoji.id,
    deltas: { resentment: 30, wantsToBeSeen: 18, revenge: 12 },
    misreading: "沈珩把敖霁的水阵听成替血河楼开路。",
    unspoken: "沈珩还没决定敖霁的渡令是不是破禁证据。",
    generatedFrom: "agent-dialogue-relationship",
    relationshipSource: "agent-exchange",
    sharedObject: "渡令",
    eventOutcome: "敖霁把渡令压回岸上，沈珩没有让水阵撤开。",
    finalTurn: "渡令先停，水阵不开。",
    followupTurn: "你扣的是渡令，还是龙裔的退路？",
    dialogueTurnCount: 4,
  }],
  characterMemories: [{
    id: "mem_accepted_relationship_dialogue_location_seed",
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
  }],
});

setUi({
  timeGrain: "day",
  focusMode: "ambient",
  activeTab: "observe",
  selectedLocationId: "loc_xianxia_contract_gate",
});

state = getState();
const draft = playNext(state);
const pulledShift = (draft.relationshipShift || []).find((shift) =>
  shift.fromCharacterId === shen.id
  && shift.toCharacterId === aoji.id
  && shift.sharedObject === "渡令"
);
assert.ok(pulledShift, "day simulation should produce a pulled relationship shift for the ferry pair");
assert.equal(pulledShift.locationName, "归墟渡", "pulled relationship shift should happen at the ferry");

saveDraft(draft);
const canon = acceptDraft(draft.id, draft.updateBundle);
assert.ok(canon?.id, "draft should be accepted");

state = getState();
const acceptedRelationship = state.relationships.find((rel) =>
  rel.fromCharacterId === shen.id && rel.toCharacterId === aoji.id
);
assert.ok(acceptedRelationship, "accepted state should keep the relationship");
assert.equal(
  acceptedRelationship.lastDialogue?.locationName,
  "归墟渡",
  "accepted relationship lastDialogue should preserve where the dialogue happened",
);
assert.equal(
  acceptedRelationship.lastDialogue?.locationId,
  "loc_xianxia_ferry",
  "accepted relationship lastDialogue should preserve the location id",
);

console.log("acceptedRelationshipDialogueLocation:test passed", {
  lastDialogue: acceptedRelationship.lastDialogue,
});
