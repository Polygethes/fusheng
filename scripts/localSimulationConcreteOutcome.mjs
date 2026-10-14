import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const simulationTick = {
  id: "tick_local_touch_outcome",
  locationId: "loc_table",
  locationName: "停剑茶楼",
  visiblePressure: "桌上的物件会决定谁能继续说话。",
  privateSimulations: [
    {
      characterId: "char_a",
      characterName: "甲",
      privateDesire: "让乙承认茶盏被换过。",
      defensiveMask: "我只是问茶。",
      shadowImpulse: "把乙留在桌边。",
    },
    {
      characterId: "char_b",
      characterName: "乙",
      privateDesire: "不让甲拿走红绳。",
      defensiveMask: "我只是听见了。",
      shadowImpulse: "把茶盏从证据里移开。",
    },
  ],
};

const agentOutputs = [
  {
    outputId: "out_a",
    characterId: "char_a",
    targetCharacterId: "char_b",
    visibleAction: "甲把青瓷杯推到乙面前，杯沿还沾着水。甲说：“先看杯口。”",
  },
  {
    outputId: "out_b",
    characterId: "char_b",
    targetCharacterId: "char_a",
    visibleAction: "乙看向甲，手指停在红绳旁。乙说：“我只是听见了。”",
    interactionInput: {
      sourceCharacterId: "char_a",
      sourceOutputId: "out_a",
      observedVisibleAction: "甲把青瓷杯推到乙面前，杯沿还沾着水。甲说：“先看杯口。”",
      sharedObject: "青瓷杯",
    },
  },
];

const scene = runSceneInteractionSimulation({
  state: { characters: [] },
  simulationTick,
  agentOutputs,
});

const exchange = scene.agentExchanges[0];
const outcome = exchange?.eventOutcome || "";

assert.ok(exchange, "local simulation should produce an agent exchange");
assert.match(outcome, /甲|乙/, `local event outcome should name the characters, got: ${outcome}`);
assert.match(outcome, /青瓷杯/, `local event outcome should preserve the source object, got: ${outcome}`);
assert.match(outcome, /红绳|手指|停|旁/, `local event outcome should include visible response staging, got: ${outcome}`);
assert.doesNotMatch(
  outcome,
  /原来的方向|下一步|绕不开它|这一步/,
  `local event outcome should not expose abstract template language, got: ${outcome}`,
);

console.log("localSimulationConcreteOutcome:test passed", {
  outcome,
});
