import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const relationshipMemory = {
  sharedObject: "灵契",
  finalTurn: "灵契一进账，旧案就被别人开价。",
  followupTurn: "灵契一进账，旧案就被别人开价。",
  eventOutcome: "灵契被留在案台边。",
  dialogueTurns: [
    { speakerId: "char_yan", speakerName: "阎无咎", targetId: "char_lu", targetName: "鹿青萝", line: "灵契一进账，旧案就被别人开价。", turnRole: "claim" },
    { speakerId: "char_lu", speakerName: "鹿青萝", targetId: "char_yan", targetName: "阎无咎", line: "庇护牌旁边还有人。", turnRole: "response" },
  ],
};

const source = {
  characterId: "char_yan",
  characterName: "阎无咎",
  targetCharacterId: "char_lu",
  targetCharacterName: "鹿青萝",
  tone: "伪装",
  defensiveMask: "价码到了，旧案自然开口。",
  privateDesire: "让灵契先留在案台边，但不让鹿青萝把人从价码里拆出来。",
  agentProfile: {
    publicIdentity: "邪派血河楼使者",
    dramaticObjective: "守着带走能让血河楼翻案的证物",
    leverageObject: "灵契",
    dialogueMoves: ["价码到了，旧案自然开口。", "我押的是灵契，不是命。"],
  },
  memorySource: "agent_dialogue_relationship",
  memorySharedObject: "灵契",
  relationshipHistoryCount: 2,
  relationshipDialogueHistory: [relationshipMemory, relationshipMemory],
  relationshipDialogueMemory: relationshipMemory,
};

const target = {
  characterId: "char_lu",
  characterName: "鹿青萝",
  targetCharacterId: "char_yan",
  targetCharacterName: "阎无咎",
  tone: "保护",
  defensiveMask: "庇护牌亮着时不问正邪。",
  privateDesire: "不让灵契的价码盖过案台旁的伤者。",
  agentProfile: {
    publicIdentity: "妖族鹿妖医",
    dramaticObjective: "守着医坊的庇护权",
    leverageObject: "庇护牌",
    dialogueMoves: ["庇护牌亮着时不问正邪。"],
  },
  memorySource: "agent_dialogue_relationship",
  memorySharedObject: "灵契",
  relationshipHistoryCount: 2,
  relationshipDialogueHistory: [relationshipMemory, relationshipMemory],
  relationshipDialogueMemory: relationshipMemory,
};

const scene = runSceneInteractionSimulation({
  state: { characters: [] },
  simulationTick: {
    id: "tick_repeat_object_2",
    periodSlot: "上午",
    locationId: "loc_market",
    locationName: "无咎市",
    visiblePressure: "摊主的账册翻在案台边，灵契还没有进账。",
    privateSimulations: [source, target],
  },
  agentOutputs: [
    {
      outputId: "out_yan",
      characterId: "char_yan",
      targetCharacterId: "char_lu",
      characterName: "阎无咎",
      visibleAction: "阎无咎把灵契压到案台边。阎无咎说：“价码到了，旧案自然开口。”",
    },
    {
      outputId: "out_lu",
      characterId: "char_lu",
      targetCharacterId: "char_yan",
      characterName: "鹿青萝",
      visibleAction: "鹿青萝把庇护牌压到案台边。鹿青萝说：“庇护牌亮着时不问正邪。”",
      interactionInput: {
        sourceCharacterId: "char_yan",
        sourceOutputId: "out_yan",
        observedVisibleAction: "阎无咎把灵契压到案台边。阎无咎说：“价码到了，旧案自然开口。”",
        sharedObject: "灵契",
      },
    },
  ],
});

const lines = (scene.agentExchanges?.[0]?.dialogueTurns || []).map((turn) => turn.line || "");
assert.ok(lines.length >= 3, `local scene should produce dialogue turns, got:\n${JSON.stringify(scene.agentExchanges, null, 2)}`);

for (const line of lines) {
  assert.doesNotMatch(
    line,
    /(灵契|庇护牌|魔印|妖丹盒|照骨镜|渡令|魂灯)[^；。！？]{0,28}[；。！？]\1/u,
    `dialogue should not start adjacent clauses with the same object name:\n${lines.join("\n")}`,
  );
}

console.log("dialogueNoRepeatedObjectOpening:test passed", { lines });
