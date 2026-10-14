import assert from "node:assert/strict";
import { playModelPeriodWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "day";

let dramaticCalls = 0;
const activations = [];
// This contract is offline by construction: a runner it fails to inject must
// be named, never replaced by a real provider call.
const draft = await playModelPeriodWithRunners(state, {
  pipelineMode: "live",
  runnerPolicy: "strict",
  characterAgentProtocolVersion: 1,
  runners: {
    async runTavernCausalAgent(input) {
      activations.push(input.agent?.name);
      return {
        decision: { actionType: "pass", speechAct: "none", privateReason: "继续手里的事。" },
        stage: { name: "CausalAgent:test", provider: "test", model: "fake", elapsedMs: 0 },
      };
    },
    async runPrivateSimulators() { dramaticCalls += 1; throw new Error("tavern life must resolve before prose"); },
    async runSceneInteractionSimulator() { dramaticCalls += 1; throw new Error("model cannot author tavern facts"); },
  },
});

assert.ok(activations.length >= 5, "the causal kernel must resolve every slot through real agent activations");
assert.equal(dramaticCalls, 0, "the model must not run a second hidden dramatic simulation");
assert.ok((draft.periodSimulation?.ticks || []).every((tick) => tick.locationId === "loc_xyy_tavern"));
assert.ok(draft.updateBundle?.tavernState, "canonical material state must come from the life kernel");
assert.match(draft.pipelineMeta?.pipeline || "", /CausalAgentScene.*CanonicalActionLedger/, "prose must be downstream of the causal scene ledger");

console.log("modelTavernActivityGrounding:test passed", { activations: activations.length });
