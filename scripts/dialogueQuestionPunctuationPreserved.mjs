import assert from "node:assert/strict";
import { buildAgentDialogueExchange, buildCharacterDialogueDecision } from "../src/engine/dialogueProtocol.js";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const sourceCharacter = {
  id: "char_wen",
  name: "闻夏",
  agentProfile: { leverageObject: "妖丹盒", dialogueMoves: ["妖丹盒是谁放在案台上的？"] },
};
const targetCharacter = {
  id: "char_shen",
  name: "沈珩",
  agentProfile: { leverageObject: "灵契", dialogueMoves: ["我不知道。灵契是我带来的。"] },
};

const source = {
  characterId: "char_wen",
  characterName: "闻夏",
  targetCharacterId: "char_shen",
  targetCharacterName: "沈珩",
  tone: "伪装",
};

const target = {
  characterId: "char_shen",
  characterName: "沈珩",
  targetCharacterId: "char_wen",
  targetCharacterName: "闻夏",
  tone: "惩罚",
  agentProfile: {
    publicIdentity: "正道玄衡宗执律剑修",
    dramaticObjective: "审判扣押证人",
  },
};

const sourceOutput = {
  outputId: "out_wen_1",
  characterId: "char_wen",
  targetCharacterId: "char_shen",
  tone: "伪装",
  visibleAction: "闻夏把妖丹盒压到案台边，挡住沈珩伸来的手。",
};
sourceOutput.dialogueDecision = buildCharacterDialogueDecision({
  character: sourceCharacter,
  target: targetCharacter,
  output: sourceOutput,
});
const targetOutput = {
  outputId: "out_shen_1",
  characterId: "char_shen",
  targetCharacterId: "char_wen",
  tone: "惩罚",
  visibleAction: "沈珩把灵契压到妖丹盒旁。",
};
targetOutput.dialogueDecision = buildCharacterDialogueDecision({
  character: targetCharacter,
  target: sourceCharacter,
  output: targetOutput,
  observedDecision: sourceOutput.dialogueDecision,
});
targetOutput.dialogueExchangeTurns = buildAgentDialogueExchange({
  sourceCharacter,
  sourceOutput,
  responseCharacter: targetCharacter,
  responseOutput: targetOutput,
});
targetOutput.interactionInput = {
  sourceCharacterId: "char_wen",
  sourceOutputId: "out_wen_1",
  observedVisibleAction: sourceOutput.visibleAction,
  sharedObject: "妖丹盒",
};

const scene = runSceneInteractionSimulation({
  state: { characters: [] },
  simulationTick: {
    id: "tick_question_1",
    periodSlot: "上午",
    locationId: "loc_market",
    locationName: "无咎市",
    visiblePressure: "摊主停住笔，妖丹盒压在案台。",
    privateSimulations: [source, target],
  },
  agentOutputs: [sourceOutput, targetOutput],
});

const lines = scene.agentExchanges?.[0]?.dialogueTurns?.map((turn) => turn.line || "") || [];

assert.doesNotMatch(
  lines.join("\n"),
  /(?:吗|呢)。/,
  `question wording should not be flattened by voice preservation:\n${lines.join("\n")}`,
);
assert.ok(
  lines.some((line) => /[？?]$/.test(line)),
  `the response should still include a real question mark:\n${lines.join("\n")}`,
);

console.log("dialogueQuestionPunctuationPreserved:test passed", { lines });
