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

const causalInputs = [];
const draft = await playModelPeriodWithRunners(state, {
  pipelineMode: "live",
  // These contracts are offline by construction: a runner they fail to inject
  // must be named, never replaced by a real provider call.
  runnerPolicy: "strict",
  // The tavern world now runs the causal scene runtime; the contract targets
  // the Character Agent's own input context on the legacy causal protocol.
  characterAgentProtocolVersion: 1,
  runners: {
    async runTavernCausalAgent(input) {
      causalInputs.push(structuredClone(input));
      return {
        decision: { actionType: "pass", speechAct: "none", utterance: "", privateReason: "继续手里的事。" },
        stage: { name: "CausalAgent:test", provider: "test", model: "fake", elapsedMs: 0 },
      };
    },
    async runTavernAgentDecision(input) {
      return {
        decision: {
          chosenActionType: input.opportunity.defaultActionType,
          speechAct: "none", addresseeId: "", utterance: "", privateReason: "继续手里的事。", desiredResponse: "",
          threadAction: "none", threadTopic: "", threadStake: "",
        },
        stage: { name: `TavernAgentDecision:${input.agent.name}`, provider: "test", model: "fake", elapsedMs: 0 },
      };
    },
  },
});

assert.equal(causalInputs.length, 30, "every causal activation must capture the agent input context");
assert.ok(causalInputs.every((input) => input.institution?.ownerIds?.length), "the agent context needs the shared ownership facts");
assert.ok(
  causalInputs.every((input) => input.agent?.standing && input.agent?.privateState?.sceneRole?.placeRelationship),
  "the agent context needs the Agent's stable role contract",
);
assert.ok(
  causalInputs.every((input) => {
    const boundary = input.agent?.privateState?.sceneRole?.knowledgeBoundary || {};
    const knownLimit = [boundary.publicFacts, boundary.privateFacts, boundary.knownActorIds, boundary.hearsayActorIds, boundary.identityUnknownActorIds]
      .some((list) => Array.isArray(list) && list.length > 0);
    return Boolean(boundary) && knownLimit;
  }),
  "the agent context needs explicit knowledge limits",
);
assert.ok(
  causalInputs.every((input) => (input.materialFacts || []).some((fact) => fact.visitId)),
  "a host or visitor context must include the relevant active visit, not the whole private world",
);
assert.ok(draft.periodSimulation.ticks.every((tick) => tick.novelText), "witness prose remains downstream of canonical Agent facts");

console.log("modelTavernAgentContext:test passed", { calls: causalInputs.length });
