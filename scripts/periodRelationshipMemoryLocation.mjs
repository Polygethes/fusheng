import assert from "node:assert/strict";
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
  id: "rel_recent_dialogue_ferry_object",
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
  id: "mem_recent_dialogue_ferry_object",
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

const draft = playNext(state);
const pairedTick = draft.periodSimulation?.ticks?.find((tick) =>
  tick.participantIds?.includes(shen.id) && tick.participantIds?.includes(aoji.id)
);

assert.ok(pairedTick, "hot unresolved dialogue memory should pull both characters into a period tick");
assert.equal(
  pairedTick.locationId,
  "loc_xianxia_ferry",
  "a hot unresolved dialogue about a ferry object should pull the encounter to the ferry location",
);

const outputUsingMemory = (pairedTick.agentOutputs || []).find((output) =>
  output.characterId === shen.id && output.targetCharacterId === aoji.id
);
assert.ok(outputUsingMemory, "the remembered agent should act toward the remembered target at the pulled location");
assert.match(
  `${outputUsingMemory.memoryInfluence || ""} ${outputUsingMemory.relationshipDialogueMemory?.sharedObject || ""}`,
  /渡令|归墟渡|水阵/,
  "the selected output should carry the unresolved ferry object",
);

console.log("periodRelationshipMemoryLocation:test passed", {
  tick: pairedTick.label,
  location: pairedTick.locationName,
  participants: pairedTick.participantIds,
  memoryUse: outputUsingMemory.memoryInfluence || outputUsingMemory.relationshipDialogueMemory?.sharedObject,
});
