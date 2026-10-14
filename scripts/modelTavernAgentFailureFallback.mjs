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
state.ui.timeGrain = "scene";
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

const draft = await playModelPeriodWithRunners(state, {
  pipelineMode: "live",
  // These contracts are offline by construction: a runner they fail to inject
  // must be named, never replaced by a real provider call.
  runnerPolicy: "strict",
  characterAgentProtocolVersion: 1,
  seedImpacts: [{
    sourceCharacterId: "char_xyy_xiemu",
    sourceZoneId: "counter",
    type: "speech",
    modality: "sound",
    intensity: 90,
    radius: 3,
    directedTargetId: "char_xyy_xieheng",
    content: "谢恒，门口来人了。",
    speechAct: "ask",
  }],
  maxSteps: 2,
  minimumActivationScore: 0,
  runners: {
    async runTavernCausalAgent() {
      throw new Error("simulated remote decision outage");
    },
  },
});

assert.ok(draft.agentDecisionMeta.failures.length >= 2, "each failed remote Agent call must be visible");
assert.ok(
  draft.agentDecisionMeta.failures.every((failure) => /outage/.test(failure.message)),
  "recorded failures must carry the underlying outage, not a generic error",
);
assert.equal(draft.agentDecisionMeta.dialogueTurns, 0, "failure safety must not fabricate speech");
const lifeEvents = draft.updateBundle?.lifeEvents || [];
assert.equal(lifeEvents.length, 0, "the deterministic fallback must not fabricate committed actions either");
assert.ok(draft.pipelineMeta.degradedStages.some((stage) => /DeterministicFallback/.test(stage.name)), "the degraded stage must be named");
assert.equal(typeof draft.novelText, "string", "the world must keep settling through the outage instead of failing");

console.log("modelTavernAgentFailureFallback:test passed", { failures: draft.agentDecisionMeta.failures.length });
