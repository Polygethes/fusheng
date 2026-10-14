import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const dialogueHistory = [
  {
    sharedObject: "灵契",
    finalTurn: "我先答证据；灵契留在铜盘，谁碰过它谁站出来。",
    followupTurn: "我先答证据；灵契留在铜盘，谁碰过它谁站出来。",
    eventOutcome: "灵契被留在两人中间。",
    dialogueTurns: [
      { speakerId: "char_shen", speakerName: "沈珩", targetId: "char_yan", targetName: "阎无咎", line: "灵契先留铜盘。", turnRole: "claim" },
      { speakerId: "char_yan", speakerName: "阎无咎", targetId: "char_shen", targetName: "沈珩", line: "你问的是证据，还是想买我的命？", turnRole: "response" },
      { speakerId: "char_shen", speakerName: "沈珩", targetId: "char_yan", targetName: "阎无咎", line: "我先答证据；灵契留在铜盘，谁碰过它谁站出来。", turnRole: "counter" },
    ],
  },
  {
    sharedObject: "灵契",
    finalTurn: "你刚才问到证据，人就不能跟着灵契被拖走。",
    followupTurn: "你刚才问到证据，人就不能跟着灵契被拖走。",
    eventOutcome: "阎无咎把灵契压回铜盘边。",
    dialogueTurns: [
      { speakerId: "char_shen", speakerName: "沈珩", targetId: "char_yan", targetName: "阎无咎", line: "上一轮的规矩还没结清，灵契今天仍要留在铜盘。", turnRole: "claim" },
      { speakerId: "char_yan", speakerName: "阎无咎", targetId: "char_shen", targetName: "沈珩", line: "灵契要留在铜盘，你问的是证据，还是想买我的命？", turnRole: "response" },
      { speakerId: "char_shen", speakerName: "沈珩", targetId: "char_yan", targetName: "阎无咎", line: "我不答私账；灵契压在铜盘，界石记完再说人情。", turnRole: "counter" },
      { speakerId: "char_yan", speakerName: "阎无咎", targetId: "char_shen", targetName: "沈珩", line: "你刚才问到证据，人就不能跟着灵契被拖走。", turnRole: "turn" },
    ],
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
    leverageObject: "灵契",
    dialogueMoves: ["按城法扣契，不按宗门私仇。", "剑可以停，证据不能走。"],
  },
  memorySource: "agent_dialogue_relationship",
  memorySharedObject: "灵契",
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
    dialogueMoves: ["我押的是灵契，不是命。", "价码到了，旧案自然开口。"],
  },
  memorySource: "agent_dialogue_relationship",
  memorySharedObject: "灵契",
  relationshipDialogueHistory: dialogueHistory,
  relationshipHistoryCount: dialogueHistory.length,
  relationshipDialogueMemory: dialogueHistory.at(-1),
};

const scene = runSceneInteractionSimulation({
  state: { characters: [] },
  simulationTick: {
    id: "tick_third_round_pressure",
    locationId: "loc_gate",
    locationName: "四方法契门",
    visiblePressure: "界石照着灵契，守门人的印停在铜盘外。",
    privateSimulations: [source, target],
  },
  agentOutputs: [
    {
      outputId: "out_shen",
      characterId: "char_shen",
      targetCharacterId: "char_yan",
      visibleAction: "沈珩扣住阎无咎面前的灵契，另一只手拦住守门人的印。",
    },
    {
      outputId: "out_yan",
      characterId: "char_yan",
      targetCharacterId: "char_shen",
      visibleAction: "阎无咎没有接沈珩推来的灵契，把魔印压到铜盘边。",
      interactionInput: {
        sourceCharacterId: "char_shen",
        sourceOutputId: "out_shen",
        observedVisibleAction: "沈珩扣住阎无咎面前的灵契，另一只手拦住守门人的印。",
        sharedObject: "灵契",
      },
    },
  ],
});

const exchange = scene.agentExchanges[0] || {};
const turns = exchange.dialogueTurns || [];
const fifthTurn = turns[4] || null;

assert.ok(
  turns.length >= 5,
  `two unresolved prior exchanges should push the third exchange into a fifth free turn, got ${turns.length}:\n${turns.map((turn) => turn.line).join("\n")}`,
);
assert.equal(fifthTurn?.speakerId, "char_shen", "the fifth turn should let the initiator answer the responder's fourth turn");
assert.equal(fifthTurn?.respondsTo, turns[3]?.line, "the fifth turn should respond to the immediately previous turn");
assert.match(fifthTurn?.line || "", /灵契|界石|铜盘|证据|名字|退路/, "the fifth turn should stay in the same concrete stakes");
assert.ok(
  (scene.agentRelationshipShifts || []).some((shift) => shift.dialogueTurnCount >= 5 && shift.finalTurn === fifthTurn.line),
  "relationship shifts should remember the fifth turn as the latest relationship pressure",
);

console.log("thirdRoundRelationshipPressureContinuesDialogue:test passed", {
  turns: turns.map((turn) => turn.line),
});
