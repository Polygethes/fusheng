import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const dialogueHistory = [
  {
    sharedObject: "妖丹盒",
    finalTurn: "妖丹盒先别进账，旧案价码还没说完。",
    followupTurn: "妖丹盒先别进账，旧案价码还没说完。",
    eventOutcome: "妖丹盒被留在账册边。",
    dialogueTurnCount: 4,
    dialogueTurns: [
      { speakerId: "char_shen", speakerName: "沈珩", targetId: "char_yan", targetName: "阎无咎", line: "妖丹盒先留在案台。", turnRole: "claim" },
      { speakerId: "char_yan", speakerName: "阎无咎", targetId: "char_shen", targetName: "沈珩", line: "旧案价码还没说完。", turnRole: "turn" },
    ],
    relationshipDialogueAct: {
      kind: "bargain",
      reason: "阎无咎把妖丹盒重新命名为旧案和价码的筹码。",
    },
  },
  {
    sharedObject: "妖丹盒",
    finalTurn: "妖丹盒贴到账册边；谁加条件，摊主先记谁的手。",
    followupTurn: "妖丹盒贴到账册边；谁加条件，摊主先记谁的手。",
    eventOutcome: "阎无咎没有让摊主落笔。",
    dialogueTurnCount: 4,
    dialogueTurns: [
      { speakerId: "char_shen", speakerName: "沈珩", targetId: "char_yan", targetName: "阎无咎", line: "我先答证据；妖丹盒留在案台。", turnRole: "counter" },
      { speakerId: "char_yan", speakerName: "阎无咎", targetId: "char_shen", targetName: "沈珩", line: "谁加条件，摊主先记谁的手。", turnRole: "turn" },
    ],
    relationshipDialogueAct: {
      kind: "bargain",
      reason: "阎无咎把妖丹盒重新命名为旧案和价码的筹码。",
    },
  },
];

const source = {
  characterId: "char_shen",
  characterName: "沈珩",
  targetCharacterId: "char_yan",
  targetCharacterName: "阎无咎",
  tone: "惩罚",
  defensiveMask: "按城法扣契，不按宗门私仇。",
  agentProfile: {
    leverageObject: "妖丹盒",
    publicIdentity: "正道玄衡宗执律剑修",
    dramaticObjective: "让停剑城承认正道审判扣押邪派证人的资格",
    dialogueMoves: ["按城法扣契，不按宗门私仇。", "剑可以停，证据不能走。"],
  },
  memorySource: "agent_dialogue_relationship",
  memorySharedObject: "妖丹盒",
  relationshipDialogueHistory: dialogueHistory,
  relationshipHistoryCount: dialogueHistory.length,
  relationshipDialogueMemory: dialogueHistory.at(-1),
};

const target = {
  characterId: "char_yan",
  characterName: "阎无咎",
  targetCharacterId: "char_shen",
  targetCharacterName: "沈珩",
  tone: "伪装",
  defensiveMask: "我押的是灵契，不是命。",
  agentProfile: {
    leverageObject: "魔印",
    publicIdentity: "邪派血河楼使者",
    dramaticObjective: "带走能让血河楼翻案的证物",
    dialogueMoves: ["我押的是灵契，不是命。", "价码到了，旧案自然开口。"],
  },
  memorySource: "agent_dialogue_relationship",
  memorySharedObject: "妖丹盒",
  relationshipDialogueHistory: dialogueHistory,
  relationshipHistoryCount: dialogueHistory.length,
  relationshipDialogueMemory: dialogueHistory.at(-1),
};

const scene = runSceneInteractionSimulation({
  state: { characters: [] },
  simulationTick: {
    id: "tick_pressure_state_change",
    locationId: "loc_market",
    locationName: "无咎市",
    visiblePressure: "摊主把账册翻到空白页，铜夹压着妖丹盒。",
    privateSimulations: [source, target],
  },
  agentOutputs: [
    {
      outputId: "out_shen",
      characterId: "char_shen",
      targetCharacterId: "char_yan",
      visibleAction: "沈珩把妖丹盒压到账册边，没有让摊主落笔，目光停在阎无咎手上。",
    },
    {
      outputId: "out_yan",
      characterId: "char_yan",
      targetCharacterId: "char_shen",
      visibleAction: "阎无咎把妖丹盒收回身前，沈珩的手停在案台外。",
      interactionInput: {
        sourceCharacterId: "char_shen",
        sourceOutputId: "out_shen",
        observedVisibleAction: "沈珩把妖丹盒压到账册边，没有让摊主落笔，目光停在阎无咎手上。",
        sharedObject: "妖丹盒",
      },
    },
  ],
});

const exchange = scene.agentExchanges[0] || {};
const turns = exchange.dialogueTurns || [];
const outcome = exchange.eventOutcome || "";

assert.ok(
  turns.length >= 5,
  `fixture should create a high-pressure fifth turn before resolving the outcome, got:\n${turns.map((turn) => `${turn.speakerName}:${turn.line}`).join("\n")}`,
);
assert.match(
  outcome,
  /被迫|让步|失去退路|临时控制|保护债|旧案价码|摊主记下/,
  `multi-round relationship pressure should resolve into a changed playable state, not static object retention. Outcome:\n${outcome}\nTurns:\n${turns.map((turn) => `${turn.speakerName}:${turn.line}`).join("\n")}`,
);
assert.doesNotMatch(
  outcome,
  /关系状态|下一步|后台|private|simulation|actionCandidate|currentConstraint/,
  `state-changing outcome must stay in-world, got:\n${outcome}`,
);

console.log("relationshipPressureResolvesIntoStateChange:test passed", {
  turns: turns.map((turn) => turn.line),
  outcome,
});
