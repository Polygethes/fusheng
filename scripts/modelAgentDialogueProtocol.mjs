import assert from "node:assert/strict";
import * as pipeline from "../src/server/pipeline/openaiPipeline.mjs";

assert.equal(typeof pipeline.buildModelAgentDialogueProtocol, "function", "model route should expose the agent dialogue protocol builder");
assert.equal(typeof pipeline.applyAgentDialogueProtocolToScene, "function", "model route should expose the scene dialogue lock");

const {
  applyAgentDialogueProtocolToScene,
  buildModelAgentDialogueProtocol,
} = pipeline;

const compact = {
  activeCharacters: [
    {
      id: "char_a",
      name: "甲",
      actionLines: { desire: "查清账册的来路" },
      agentProfile: {
        dramaticObjective: "查清账册的来路",
        leverageObject: "账册",
        dialogueMoves: ["把账册给我，我要核对来路。"],
      },
    },
    {
      id: "char_b",
      name: "乙",
      actionLines: { desire: "护送病人离开" },
      agentProfile: {
        dramaticObjective: "护送病人离开",
        leverageObject: "担架",
        dialogueMoves: ["病人得先离开。"],
        responseBoundary: "病人没有脱离危险前不得被扣留。",
      },
    },
  ],
};

const privateSimulations = [
  {
    characterId: "char_a",
    characterName: "甲",
    targetCharacterId: "char_b",
    targetCharacterName: "乙",
    tone: "求证",
    publicGoal: "查清账册的来路",
    privateDesire: "证明账册没有被调换",
    agentProfile: compact.activeCharacters[0].agentProfile,
  },
  {
    characterId: "char_b",
    characterName: "乙",
    targetCharacterId: "char_a",
    targetCharacterName: "甲",
    tone: "保护",
    publicGoal: "护送病人离开",
    privateDesire: "不让病人死在闸口",
    agentProfile: compact.activeCharacters[1].agentProfile,
  },
];

const protocol = buildModelAgentDialogueProtocol(compact, privateSimulations);
const opening = protocol.privateSimulations[0].dialogueDecision;
const response = protocol.privateSimulations[1].dialogueDecision;
const protocolExchange = protocol.agentExchanges[0];

assert.equal(opening.generatedBy, "character-agent");
assert.equal(response.generatedBy, "character-agent");
assert.equal(response.observedTurnId, opening.turnId);
assert.equal(response.observedUtterance, opening.utterance);
assert.ok(protocolExchange.dialogueTurns.length >= 3);

const modelScene = {
  sceneText: "共享场景模型写了一段正文。",
  agentExchanges: [{
    sourceCharacterId: "char_a",
    sourceCharacterName: "甲",
    responseCharacterId: "char_b",
    responseCharacterName: "乙",
    sharedObject: "账册",
    dialogueTurns: [
      { speakerId: "char_a", line: "这是场景模型另写的第一句。" },
      { speakerId: "char_b", line: "这是场景模型另写的第二句。" },
    ],
    eventOutcome: "闸门暂时没有关闭。",
    relationshipDeltas: [],
  }],
};

const locked = applyAgentDialogueProtocolToScene(modelScene, protocol.agentExchanges);
assert.deepEqual(
  locked.agentExchanges[0].dialogueTurns,
  protocolExchange.dialogueTurns,
  "shared scene must preserve character-agent turns instead of replacing their words",
);
assert.equal(locked.agentExchanges[0].eventOutcome, "闸门暂时没有关闭。", "scene model should still own physical outcomes");

console.log("modelAgentDialogueProtocol:test passed", {
  turns: locked.agentExchanges[0].dialogueTurns.map((turn) => turn.line),
});
