import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const simulationTick = {
  id: "tick_agent_outcome_contract_gate",
  locationId: "loc_xianxia_contract_gate",
  locationName: "四方法契门",
  visiblePressure: "入门者必须把本命物放在界石边。",
  privateSimulations: [
    {
      characterId: "char_a",
      characterName: "甲",
      privateDesire: "让乙承认杯里的水被换过。",
      defensiveMask: "我只问杯子。",
      shadowImpulse: "把乙困在桌边。",
    },
    {
      characterId: "char_b",
      characterName: "乙",
      privateDesire: "保住红绳里的名字。",
      defensiveMask: "绳子在，话才算数。",
      shadowImpulse: "把杯子从证据里挪走。",
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
    visibleAction: "乙没有接甲推来的青瓷杯，把红绳压到杯沿旁。乙说：“绳子在，话才算数。”",
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

assert.ok(exchange, "simulation should produce an agent exchange");
assert.match(exchange.eventOutcome, /青瓷杯/, "outcome should preserve the initiating agent's concrete object");
assert.match(exchange.eventOutcome, /红绳/, "outcome should preserve the responding agent's concrete object");
assert.doesNotMatch(exchange.eventOutcome, /契牌|毒誓符|守门人|符失效/, "world shell should not inject a location-template result");
assert.ok(exchange.worldBoundary, "world rule should be recorded as boundary/context, not as the outcome");
assert.equal(exchange.outcomeSource, "agent-actions", "outcome should declare that it was derived from agent actions");

console.log("eventOutcomeFromAgents:test passed", {
  outcome: exchange.eventOutcome,
  boundary: exchange.worldBoundary,
});
