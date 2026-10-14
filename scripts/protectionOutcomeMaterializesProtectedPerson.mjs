import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const protectMemory = {
  sharedObject: "庇护牌",
  finalTurn: "庇护牌压在案台边，先护住人；证物不能替伤口开价。",
  followupTurn: "庇护牌压在案台边，先护住人；证物不能替伤口开价。",
  eventOutcome: "鹿青萝把庇护牌压在案台边，阎无咎没有把人交出去。",
  dialogueTurnCount: 4,
  relationshipDialogueAct: {
    kind: "protect",
    reason: "鹿青萝把庇护牌重新命名为救命和保护的边界。",
  },
  dialogueTurns: [
    { speakerId: "char_yan", speakerName: "阎无咎", targetId: "char_lu", targetName: "鹿青萝", line: "妖丹盒先别进账。", turnRole: "claim" },
    { speakerId: "char_lu", speakerName: "鹿青萝", targetId: "char_yan", targetName: "阎无咎", line: "庇护牌压在案台边，先护住人。", turnRole: "response" },
  ],
};

const source = {
  characterId: "char_yan",
  characterName: "阎无咎",
  targetCharacterId: "char_lu",
  targetCharacterName: "鹿青萝",
  tone: "伪装",
  defensiveMask: "我押的是灵契，不是命。",
  privateDesire: "不让旧案价码被鹿青萝拆开。",
  agentProfile: {
    publicIdentity: "邪派血河楼使者",
    dramaticObjective: "带走能让血河楼翻案的证物",
    leverageObject: "妖丹盒",
    dialogueMoves: ["我押的是灵契，不是命。"],
  },
  memorySource: "agent_dialogue_relationship",
  memorySharedObject: "庇护牌",
  relationshipHistoryCount: 2,
  relationshipDialogueHistory: [protectMemory, protectMemory],
  relationshipDialogueMemory: protectMemory,
};

const target = {
  characterId: "char_lu",
  characterName: "鹿青萝",
  targetCharacterId: "char_yan",
  targetCharacterName: "阎无咎",
  tone: "保护",
  defensiveMask: "庇护牌压在案台边，先救命，后审案。",
  privateDesire: "不让案台边的人被写进价码。",
  agentProfile: {
    publicIdentity: "妖族鹿妖医",
    dramaticObjective: "守住医坊的庇护权",
    leverageObject: "庇护牌",
    dialogueMoves: ["庇护牌压在案台边，先救命，后审案。"],
  },
  memorySource: "agent_dialogue_relationship",
  memorySharedObject: "庇护牌",
  relationshipHistoryCount: 2,
  relationshipDialogueHistory: [protectMemory, protectMemory],
  relationshipDialogueMemory: protectMemory,
};

const scene = runSceneInteractionSimulation({
  state: { characters: [] },
  simulationTick: {
    id: "tick_protection_materializes_person",
    locationId: "loc_market",
    locationName: "无咎市",
    visiblePressure: "摊主的账册翻开，庇护牌被推到案台边。",
    privateSimulations: [source, target],
  },
  agentOutputs: [
    {
      outputId: "out_yan",
      characterId: "char_yan",
      targetCharacterId: "char_lu",
      characterName: "阎无咎",
      visibleAction: "阎无咎把妖丹盒压到账册边。阎无咎说：“旧案价码还没说完。”",
    },
    {
      outputId: "out_lu",
      characterId: "char_lu",
      targetCharacterId: "char_yan",
      characterName: "鹿青萝",
      visibleAction: "鹿青萝把庇护牌压到案台边。鹿青萝说：“庇护牌压在案台边，先救命，后审案。”",
      interactionInput: {
        sourceCharacterId: "char_yan",
        sourceOutputId: "out_yan",
        observedVisibleAction: "阎无咎把妖丹盒压到账册边。阎无咎说：“旧案价码还没说完。”",
        sharedObject: "妖丹盒",
      },
    },
  ],
});

const exchange = scene.agentExchanges?.[0] || {};
const outcome = exchange.eventOutcome || "";

assert.match(outcome, /保护债|救命|先回答/, `fixture should produce a protection outcome, got:\n${outcome}`);
assert.match(
  outcome,
  /伤者|被庇护的人|袖口|血痕|跪在|喘息/,
  `protection outcome should materialize a visible protected person, not only an abstract “人”, got:\n${outcome}`,
);
assert.doesNotMatch(
  outcome,
  /关系状态|下一步|后台|private|simulation|actionCandidate|currentConstraint/,
  `protection outcome must stay in-world, got:\n${outcome}`,
);

console.log("protectionOutcomeMaterializesProtectedPerson:test passed", {
  outcome,
  turns: (exchange.dialogueTurns || []).map((turn) => turn.line),
});
