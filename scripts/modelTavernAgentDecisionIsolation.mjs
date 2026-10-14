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
state.ui.engineMode = "openai";

const causalInputs = [];
const draft = await playModelPeriodWithRunners(state, {
  pipelineMode: "live",
  // These contracts are offline by construction: a runner they fail to inject
  // must be named, never replaced by a real provider call.
  runnerPolicy: "strict",
  // The tavern world runs the causal scene runtime; per-Agent decision calls
  // and their isolation contract are exercised on the causal agent runner.
  characterAgentProtocolVersion: 1,
  runners: {
    async runTavernCausalAgent(input) {
      causalInputs.push(structuredClone(input));
      const candidate = (input.privateActionCandidates || []).find((item) => item.feasible);
      return {
        decision: {
          candidateId: candidate?.candidateId || "",
          actionType: "speak",
          speechAct: "inform",
          targetCharacterId: (input.perceivedCharacters || []).find((row) => row.id !== input.agent.id)?.id || "",
          vocalMode: "speak",
          speech: `${input.agent?.name || "有人"}把手里的活先放下，照看眼前的人。`,
          visibleAction: `${input.agent?.name || "有人"}放下手里的活，照看眼前的人。`,
          moveToZoneId: "",
          affordanceId: "",
          informationSourceImpactId: "",
          commitmentAction: "open",
          commitmentTopic: "眼前这件事由谁接手",
          commitmentStake: "没人回应就会耽误手里的事",
          privateReason: "先确认眼前的人有没有听见。",
          relationshipAppraisal: { phase: "pending_perception_appraisal", targetCharacterId: "", sourceImpactIds: [], changeMode: "none", dimensionChanges: [], reason: "" },
        },
        stage: { name: `CausalAgent:${input.agent?.name}`, provider: "test", model: "fake", elapsedMs: 0 },
      };
    },
  },
});

assert.ok(causalInputs.length >= 5, "a day must contain real per-Agent decision calls");
assert.ok(causalInputs.every((call) => call.agent?.id && call.agent?.privateState), "each call needs its own private Agent state");
assert.ok(causalInputs.every((call) => (call.privateActionCandidates || []).length), "the model needs bounded offered actions");

for (const call of causalInputs) {
  const own = { ...call, agent: { ...call.agent, privateState: undefined } };
  const serializedOthers = JSON.stringify(own.perceivedCharacters || []);
  assert.doesNotMatch(serializedOthers, /hiddenAgenda|privateFacts|privatePursuit|innerState/, "other people must remain public-only");
  const inputWithoutOwnPrivateState = JSON.stringify({ ...own, agent: { ...own.agent, privateState: undefined } });
  assert.doesNotMatch(inputWithoutOwnPrivateState, /hiddenAgenda|privatePursuit|innerState/, "nothing outside the acting Agent's own private state may carry private content");
}

const turns = draft.periodSimulation.ticks.flatMap((tick) => tick.sceneInteraction?.agentExchanges || []).flatMap((exchange) => exchange.dialogueTurns || []);
assert.ok(turns.length >= 2, "Agent decisions must become canonical dialogue, not disappear in the witness");
assert.ok(turns.every((turn) => turn.generatedBy === "causal-character-agent"), "canonical dialogue must carry the causal agent provenance");

console.log("modelTavernAgentDecisionIsolation:test passed", { calls: causalInputs.length, turns: turns.length });
