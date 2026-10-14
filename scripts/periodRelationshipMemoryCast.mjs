import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

const shen = state.characters.find((item) => item.id === "char_xianxia_shenheng");
const meng = state.characters.find((item) => item.id === "char_xianxia_menghuai");
assert.ok(shen && meng, "test characters should exist");

state.relationships.push({
  id: "rel_recent_dialogue_far_pair",
  projectId: state.project.id,
  fromCharacterId: shen.id,
  toCharacterId: meng.id,
  label: "未结清供词 / 灵契",
  resentment: 92,
  wantsToBeSeen: 78,
  fear: 30,
  dependence: 10,
  protection: 0,
  revenge: 48,
  deception: 22,
  wantsToEscape: 12,
  unspoken: "沈珩还没决定孟槐的供词能不能进照骨司。",
  misreading: "沈珩把孟槐的魂灯听成对城法的挑衅。",
  lastDialogue: {
    source: "agent-dialogue-relationship",
    relationshipSource: "agent-exchange",
    sharedObject: "魂灯",
    eventOutcome: "孟槐把魂灯留在灵契旁，沈珩没有让守门人盖印。",
    finalTurn: "死人还没说完，活人先别定案。",
    followupTurn: "你要先扣魂灯，还是先扣我的名字？",
    dialogueTurnCount: 4,
    updatedAt: new Date().toISOString(),
  },
});

state.characterMemories.push({
  id: "mem_recent_dialogue_far_pair",
  projectId: state.project.id,
  branchId: "branch_main",
  characterId: shen.id,
  targetCharacterId: meng.id,
  type: "weaponized",
  stance: "revenge",
  content: "关系对话记忆：沈珩记住了孟槐在四方法契门的回应，魂灯没有从场中消失。",
  privateVersion: "孟槐把魂灯留在灵契旁；追问：你要先扣魂灯，还是先扣我的名字？",
  source: "agent_dialogue_relationship",
  sourceRelationshipShift: {
    generatedFrom: "agent-dialogue-relationship",
    sharedObject: "魂灯",
    dialogueTurnCount: 4,
    finalTurn: "死人还没说完，活人先别定案。",
    followupTurn: "你要先扣魂灯，还是先扣我的名字？",
    relationshipSource: "agent-exchange",
  },
  reliability: 58,
  heat: 96,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.activeTab = "observe";

const draft = playNext(state);
const togetherTick = draft.periodSimulation?.ticks?.find((tick) =>
  tick.participantIds?.includes(shen.id) && tick.participantIds?.includes(meng.id)
);

assert.ok(
  togetherTick,
  "a hot unresolved dialogue memory should pull both characters into at least one period tick",
);

const outputUsingMemory = (togetherTick.agentOutputs || []).find((output) =>
  output.characterId === shen.id && output.targetCharacterId === meng.id
);
assert.ok(outputUsingMemory, "relationship-memory cast should let the remembering agent act toward the remembered target");
assert.match(
  `${outputUsingMemory.relationshipDialogueMemory?.followupTurn || ""} ${outputUsingMemory.memoryInfluence || ""}`,
  /扣魂灯|名字|魂灯/,
  "the selected agent output should still carry the unresolved dialogue memory",
);

console.log("periodRelationshipMemoryCast:test passed", {
  tick: togetherTick.label,
  location: togetherTick.locationName,
  participants: togetherTick.participantIds,
  memoryUse: outputUsingMemory.memoryInfluence || outputUsingMemory.relationshipDialogueMemory?.followupTurn,
});
