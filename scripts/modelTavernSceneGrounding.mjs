import assert from "node:assert/strict";
import { playWithOpenAIPipeline } from "../src/server/pipeline/openaiPipeline.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

process.env.DEEPSEEK_API_KEY = "test-key-not-used";
const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "scene";

let dramaticCalls = 0;
const activations = [];
const draft = await playWithOpenAIPipeline(state, {
  pipelineMode: "live",
  // Offline by construction: every runner the causal scene touches is either
  // injected here as a deterministic fake or must be named when missing.
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
    async runPrivateSimulators() { dramaticCalls += 1; throw new Error("must not run"); },
    async runSceneInteractionSimulator() { dramaticCalls += 1; throw new Error("must not run"); },
  },
});

assert.ok(activations.length >= 1, "the causal scene must resolve through real agent activations");
assert.equal(dramaticCalls, 0, "the model must not run a second hidden dramatic simulation");
assert.equal(draft.locationId, "loc_xyy_tavern");
assert.equal(typeof draft.novelText, "string", "scene prose must exist downstream of the causal ledger");
assert.match(draft.pipelineMeta?.pipeline || "", /CausalAgentScene.*Commit/, "the causal scene pipeline must be the prose source");

console.log("modelTavernSceneGrounding:test passed", { activations: activations.length });
