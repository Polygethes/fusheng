import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { buildSimulationTick, runSceneInteractionSimulation, auditSimulationTick } from "../src/state/simulationLoop.js";
import { playNext } from "../src/engine/mockEngine.js";

const state = structuredClone(initialState);
state.ui.engineMode = "mock";
state.ui.activeCharacterIds = ["char_shen", "char_lin"];
state.ui.injectedEvent = "一封被删掉的修订记录突然出现在第三方邮箱里。";
state.ui.eventImpact = 72;

const tick = buildSimulationTick(state);
assert.ok(tick.id.startsWith("tick_"), "tick id should be generated");
assert.equal(tick.privateSimulations.length, 2, "two active characters should receive private simulations");
assert.ok(tick.privateSimulations.every((sim) => sim.privateDesire && sim.defensiveMask && sim.shadowImpulse), "private simulations should expose desire/mask/shadow");
assert.ok(tick.visibilityLayer?.perCharacter?.length >= 2, "visibility layer should be per character");
assert.ok(tick.contradictionPressureSummary, "tick should summarize contradiction pressure");

const interaction = runSceneInteractionSimulation({ state, simulationTick: tick, agentOutputs: [] });
assert.ok(interaction.misunderstandings.length >= 2, "scene interaction should produce misunderstandings");
assert.ok(interaction.interactionBeats.length >= 2, "scene interaction should produce action beats");

const simAudit = auditSimulationTick({ ...tick, interaction });
assert.ok(typeof simAudit.realtimeSimulationScore === "number");
assert.ok(simAudit.realtimeSimulationScore > 30, "simulation score should be meaningful");

const draft = playNext(state);
assert.ok(draft.simulationTick, "draft should preserve simulation tick");
assert.ok(draft.privateSimulations?.length >= 2, "draft should preserve private simulations");
assert.ok(draft.agentOutputs.every((output) => output.realtimePrivateDesire || output.privateDesire), "agent outputs should carry private simulation fields");
assert.ok(typeof draft.audit.realtimeSimulationScore === "number", "audit should include realtime simulation score");
assert.ok(draft.updateBundle.stateChangeReasons.some((item) => item.kind === "private_simulation"), "state reasons should record private simulation");
console.log("realtimeSimulation:test passed", { tickId: tick.id, score: simAudit.realtimeSimulationScore, draftId: draft.id });
