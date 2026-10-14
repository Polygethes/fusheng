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
// The causal period casts only characters whose presence the last committed
// movement left in the tavern — seed the stored scene zones for the residents.
for (const character of state.characters || []) {
  if (["char_xyy_xiemu", "char_xyy_xieheng"].includes(character.id)) {
    character.lifeState = { ...(character.lifeState || {}), present: true };
    character.currentLocationId = "loc_xyy_tavern";
  }
}
state.tavernState = {
  ...(state.tavernState || {}),
  sceneRuntime: {
    ...(state.tavernState?.sceneRuntime || {}),
    agents: {
      ...(state.tavernState?.sceneRuntime?.agents || {}),
      char_xyy_xiemu: { ...(state.tavernState?.sceneRuntime?.agents?.char_xyy_xiemu || {}), zoneId: "counter" },
      char_xyy_xieheng: { ...(state.tavernState?.sceneRuntime?.agents?.char_xyy_xieheng || {}), zoneId: "hall" },
    },
  },
};

const line = "陈砚，你先坐，我把手里的账对完就来。";
let emittedWrappedDecision = false;
const draft = await playModelPeriodWithRunners(state, {
  pipelineMode: "live",
  // These contracts are offline by construction: a runner they fail to inject
  // must be named, never replaced by a real provider call.
  runnerPolicy: "strict",
  characterAgentProtocolVersion: 1,
  maxStepsPerSlot: 4,
  runners: {
    async runTavernCausalAgent(input) {
      const canAddressChenYan = input.agent.id === "char_xyy_xiemu"
        && (input.perceivedCharacters || []).some((character) => character.id === "char_xyy_chenyan");
      const candidate = (input.privateActionCandidates || []).find((item) => item.feasible);
      // The compatibility probe may stay quiet, but it must still exercise a
      // candidate the Character Agent was actually offered.
      const quietCandidate = (input.privateActionCandidates || []).find((item) => item.feasible && item.actionKind === "rest") || candidate;
      if (canAddressChenYan && !emittedWrappedDecision) {
        emittedWrappedDecision = true;
        return {
          decision: {
            // A provider that drifted around the declared schema wraps the
            // decision in the schema name; the pipeline must recover it.
            character_town_tavern_agent_decision: {
              candidateId: candidate?.candidateId || "",
              actionType: "speak",
              speechAct: "statement",
              targetCharacterId: "char_xyy_chenyan",
              utterance: { literalSpeech: line, vocalMode: "conversational" },
              privateReason: "来客已经进门，不能让人误以为没人理会。",
              commitmentAction: "open",
              commitmentTopic: "陈砚以工换饭的来意",
              relationshipAppraisal: { phase: "pending_perception_appraisal", targetCharacterId: "char_xyy_chenyan", sourceImpactIds: [], changeMode: "none", dimensionChanges: [], reason: "" },
            },
          },
          stage: { name: "CausalAgent:wrapped", provider: "test", model: "schema-drift", elapsedMs: 0 },
        };
      }
      return {
        decision: {
          candidateId: quietCandidate?.candidateId || "",
          actionType: "pass",
          speechAct: "none",
          privateReason: "继续当前行动。",
        },
        stage: { name: "CausalAgent:quiet", provider: "test", model: "fake", elapsedMs: 0 },
      };
    },
  },
});

assert.equal(emittedWrappedDecision, true, "fixture must exercise the wrapped DeepSeek response shape");
const turns = draft.periodSimulation.ticks
  .flatMap((tick) => tick.sceneInteraction?.agentExchanges || [])
  .flatMap((exchange) => exchange.dialogueTurns || []);
const recovered = turns.find((turn) => turn.line === line);
assert.ok(recovered, `a recoverable wrapped decision must not be silently converted into silence, got:\n${JSON.stringify(turns, null, 2)}`);
assert.ok(
  (recovered.turnRole || recovered.interactionKind) && recovered.turnRole !== "none",
  `"statement" must recover into a supported public speech act derived from the utterance, got: ${recovered.turnRole}`,
);
const threads = draft.updateBundle?.tavernState?.eventThreads || [];
assert.ok(
  threads.some((thread) => (
    Array.isArray(thread.participantIds)
    && thread.participantIds.includes("char_xyy_xiemu")
    && thread.participantIds.includes("char_xyy_chenyan")
    && thread.topic
  )),
  "commitmentAction open must normalize into an open event thread between the speaker and the addressed guest",
);

console.log("modelTavernDecisionCompatibility:test passed", { line: recovered.line, turnRole: recovered.turnRole });
