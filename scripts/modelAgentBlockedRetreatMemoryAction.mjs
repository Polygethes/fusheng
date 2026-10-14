import assert from "node:assert/strict";
import { compactState, normalizeAgentOutput, calibrateAgentOutputWithMemory } from "../src/server/pipeline/context.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

const shen = state.characters.find((item) => item.id === "char_xianxia_shenheng");
const yan = state.characters.find((item) => item.id === "char_xianxia_yanwujie");
assert.ok(shen && yan, "test characters should exist");

state.ui.focusMode = "location";
state.ui.activeCharacterIds = [yan.id, shen.id];
state.ui.selectedLocationId = "loc_xianxia_contract_gate";
state.characterPlans = [];
state.relationships = [{
  id: "rel_model_blocked_retreat",
  projectId: state.project.id,
  fromCharacterId: yan.id,
  toCharacterId: shen.id,
  resentment: 6,
  fear: 58,
  deception: 42,
  wantsToEscape: 76,
  misreading: "阎无咎把沈珩压回界石前的最后一句听成自己的退路被堵住。",
  unspoken: "灵契没能改成退路。",
  lastDialogue: {
    source: "model-agent-dialogue",
    relationshipSource: "model-agent-exchange",
    sharedObject: "灵契",
    eventOutcome: "沈珩把最后一句压回界石前，阎无咎没能把灵契改成退路；盖印的人仍停在铜盘外。",
    finalTurn: "界石还照着灵契，名字不能替你写，证据也不能被你改成退路。",
    followupTurn: "界石还照着灵契，名字不能替你写，证据也不能被你改成退路。",
    dialogueTurnCount: 5,
    locationId: "loc_xianxia_contract_gate",
    locationName: "四方法契门",
    updatedAt: "2026-07-07T08:00:00.000Z",
  },
}];
state.characterMemories = [{
  id: "mem_model_blocked_retreat",
  projectId: state.project.id,
  branchId: state.project.activeBranchId,
  characterId: yan.id,
  targetCharacterId: shen.id,
  type: "suppressed",
  stance: "self_defense",
  content: "关系对话记忆：阎无咎记住沈珩把灵契压回界石前。",
  publicVersion: "灵契仍在铜盘里，名字没有写。",
  privateVersion: "阎无咎把沈珩压回界石前的最后一句听成自己的退路被堵住。沈珩把最后一句压回界石前，阎无咎没能把灵契改成退路。",
  distortion: "阎无咎会把这段记忆压成体面退让，实际是在寻找另一条退路。",
  reliability: 54,
  heat: 96,
  source: "agent_dialogue_relationship",
  retrievalCue: "四方法契门 / 灵契 / withdraw / 退路被堵住",
  sourceRelationshipShift: {
    generatedFrom: "model-agent-dialogue",
    sharedObject: "灵契",
    locationId: "loc_xianxia_contract_gate",
    locationName: "四方法契门",
    finalTurn: "界石还照着灵契，名字不能替你写，证据也不能被你改成退路。",
    followupTurn: "界石还照着灵契，名字不能替你写，证据也不能被你改成退路。",
    eventOutcome: "沈珩把最后一句压回界石前，阎无咎没能把灵契改成退路；盖印的人仍停在铜盘外。",
  },
}];

const compact = compactState(state);
const character = compact.activeCharacters.find((item) => item.id === yan.id);
const target = compact.activeCharacters.find((item) => item.id === shen.id);
const rawModelOutput = {
  characterId: yan.id,
  targetCharacterId: shen.id,
  tone: "试探",
  visibleAction: "阎无咎把魔印压到袖口下，低声说价码到了。",
  hiddenAction: "他想保住证物。",
  defenseAction: "把旧案说成一笔交易。",
  memoryInfluence: "",
};

const normalized = normalizeAgentOutput(rawModelOutput, yan.id, shen.id, {
  targetCharacterName: shen.name,
});
const calibrated = calibrateAgentOutputWithMemory(normalized, { compact, character, target });

assert.ok(["伪装", "撤退"].includes(calibrated.tone), `model-path memory calibration should push concealment or withdrawal, got ${calibrated.tone}`);
assert.match(
  calibrated.visibleAction,
  /退路|后退|门槛|界线|不盖印|不让.*盖印|退到.*界石|退到.*铜盘/,
  `model-path blocked retreat memory should become a visible action, got:\n${calibrated.visibleAction}`,
);
assert.match(
  `${calibrated.memoryInfluence || ""} ${calibrated.memoryUse || ""} ${calibrated.memoryDistortionAction || ""} ${calibrated.desireReason || ""}`,
  /退路被堵住|没能.*改成退路|agent_dialogue_relationship|寻找另一条退路/,
  "model-path memory pressure should remain available to downstream scene interaction",
);

console.log("modelAgentBlockedRetreatMemoryAction:test passed", {
  tone: calibrated.tone,
  visibleAction: calibrated.visibleAction,
});
