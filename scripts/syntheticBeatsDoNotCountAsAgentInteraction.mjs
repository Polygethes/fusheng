import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { auditSimulationTick, buildSimulationTick, runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const state = structuredClone(initialState);
state.ui.engineMode = "mock";
state.ui.activeCharacterIds = ["char_shen", "char_lin"];
state.ui.injectedEvent = "一封被删掉的修订记录突然出现在第三方邮箱里。";
state.ui.eventImpact = 72;

const tick = buildSimulationTick(state);
const interaction = runSceneInteractionSimulation({ state, simulationTick: tick, agentOutputs: [] });

assert.equal(interaction.agentExchanges.length, 0, "no agent outputs should mean no real agent exchanges");
assert.ok(interaction.interactionBeats.length >= 1, "ambient simulation may still describe low-fidelity synthetic pressure");
assert.ok(
  interaction.interactionBeats.every((beat) => beat.outcomeSource === "synthetic-private-simulation"),
  `synthetic beats should be explicitly marked, got:\n${JSON.stringify(interaction.interactionBeats, null, 2)}`,
);

const audit = auditSimulationTick({ ...tick, interaction });

assert.ok(
  audit.unscriptedCollisionScore < 30,
  `synthetic private-simulation beats must not count as real agent collision, got ${audit.unscriptedCollisionScore}`,
);
assert.ok(
  audit.realtimeSimulationScore < 45,
  `a tick without real agent exchange should not receive a strong realtime score, got ${audit.realtimeSimulationScore}`,
);
assert.equal(
  audit.shouldRegenerate,
  true,
  "a focused scene with no real agent exchange should be marked for regeneration/escalation",
);

console.log("syntheticBeatsDoNotCountAsAgentInteraction:test passed", {
  beats: interaction.interactionBeats.length,
  score: audit.realtimeSimulationScore,
  collision: audit.unscriptedCollisionScore,
});
