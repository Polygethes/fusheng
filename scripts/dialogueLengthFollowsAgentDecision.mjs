import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

function simulateExchange({ id, responseLine, responseTone, responseDesire }) {
  const simulationTick = {
    id,
    locationId: "loc_contract_gate",
    locationName: "四方法契门",
    visiblePressure: "界石照着铜盘，退到门槛的人可以拒绝继续说。",
    privateSimulations: [
      {
        characterId: "char_a",
        characterName: "甲",
        targetCharacterId: "char_b",
        targetCharacterName: "乙",
        tone: "试探",
        privateDesire: "拿到青瓷杯，逼乙承认杯里的水被换过。",
        defensiveMask: "杯子留下。",
        shadowImpulse: "把乙困在界石前。",
      },
      {
        characterId: "char_b",
        characterName: "乙",
        targetCharacterId: "char_a",
        targetCharacterName: "甲",
        tone: responseTone,
        privateDesire: responseDesire,
        defensiveMask: responseLine,
        shadowImpulse: "保住红绳里的名字。",
      },
    ],
  };
  const sourceVisibleAction = "甲把青瓷杯推到乙面前。甲说：“杯子留下。”";
  const conductorSignal = {
    beatId: `${id}_beat`,
    delivery: "in_world_clue",
    inWorldClue: "界石忽然亮了一下",
    object: "青瓷杯",
    pressureCue: "杯沿的水痕被界石照亮",
    target: "让双方决定是否继续盘问",
  };
  const agentOutputs = [
    {
      outputId: `${id}_source`,
      characterId: "char_a",
      targetCharacterId: "char_b",
      visibleAction: sourceVisibleAction,
      tone: "试探",
      conductorSignal,
    },
    {
      outputId: `${id}_response`,
      characterId: "char_b",
      targetCharacterId: "char_a",
      visibleAction: `乙退到门槛内，把红绳收回袖口。乙说：“${responseLine}”`,
      tone: responseTone,
      interactionInput: {
        sourceCharacterId: "char_a",
        sourceOutputId: `${id}_source`,
        observedVisibleAction: sourceVisibleAction,
        sharedObject: "青瓷杯",
      },
    },
  ];
  return runSceneInteractionSimulation({ state: { characters: [] }, simulationTick, agentOutputs })
    .agentExchanges[0];
}

const refusal = simulateExchange({
  id: "tick_refusal_stops",
  responseLine: "红绳不交，我也不再往下说。",
  responseTone: "撤退",
  responseDesire: "拒绝交出红绳，退回门槛内结束盘问。",
});
const question = simulateExchange({
  id: "tick_question_continues",
  responseLine: "你敢让界石照你的手吗？",
  responseTone: "试探",
  responseDesire: "逼甲回答谁换过杯里的水。",
});

assert.equal(
  refusal.dialogueTurns?.length,
  3,
  `an explicit refusal and retreat should stop after the initiator's counter, got:\n${JSON.stringify(refusal.dialogueTurns, null, 2)}`,
);
assert.equal(refusal.dialogueDecision?.responseMove, "refuse", "the exchange should record the responder's refusal decision");
assert.equal(refusal.dialogueDecision?.continuation, "stop_after_counter", "refusal should close the spoken exchange without a forced fourth line");
assert.ok(question.dialogueTurns?.length >= 4, "a concrete question should leave room for a fourth turn");
assert.equal(question.dialogueDecision?.responseMove, "question", "the exchange should record that the responder chose to question");
assert.equal(question.dialogueDecision?.continuation, "continue", "a question should keep the exchange open");

console.log("dialogueLengthFollowsAgentDecision:test passed", {
  refusal: refusal.dialogueTurns.map((turn) => `${turn.turnRole}:${turn.line}`),
  question: question.dialogueTurns.map((turn) => `${turn.turnRole}:${turn.line}`),
});
