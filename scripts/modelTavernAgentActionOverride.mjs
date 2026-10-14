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

const mother = "char_xyy_xiemu";
const father = "char_xyy_xieheng";
// The causal period casts only characters whose presence the last committed
// movement left in the tavern — mark both present and seed the scene runtime's
// stored zones, which is how the runtime itself remembers where people stand.
for (const character of state.characters || []) {
  if ([mother, father].includes(character.id)) {
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
      [mother]: { ...(state.tavernState?.sceneRuntime?.agents?.[mother] || {}), zoneId: "counter" },
      [father]: { ...(state.tavernState?.sceneRuntime?.agents?.[father] || {}), zoneId: "hall" },
    },
  },
};
const dutyUtterance = "东家的外账和送货缺口，我先记到账上。";
const dutyVisibleAction = "谢恒把外账册翻到今天的页，先把送货缺口记到账上。";
const causalInputs = [];
const draft = await playModelPeriodWithRunners(state, {
  pipelineMode: "live",
  // These contracts are offline by construction: a runner they fail to inject
  // must be named, never replaced by a real provider call.
  runnerPolicy: "strict",
  // The causal runtime is the tavern world's scene authority; the model's own
  // duty choice is exercised through the causal agent runner.
  characterAgentProtocolVersion: 1,
  seedImpactsBySlot: {
    "day-1-dawn": [{
      sourceCharacterId: mother,
      sourceZoneId: "counter",
      type: "speech",
      modality: "sound",
      intensity: 92,
      radius: 3,
      directedTargetId: father,
      content: "谢恒，东家的外账和送货缺口今天要处理。",
      speechAct: "ask",
      topic: "账目与送货",
    }],
  },
  maxStepsPerSlot: 4,
  runners: {
    async runTavernCausalAgent(input) {
      causalInputs.push(structuredClone(input));
      const isFatherWithDuty = input.agent?.id === father
        && (input.privateActionCandidates || []).some((item) => item.feasible && item.actionKind === "respond_to_impact");
      const candidate = (input.privateActionCandidates || []).find((item) => item.feasible);
      return {
        decision: {
          candidateId: candidate?.candidateId || "",
          actionType: isFatherWithDuty ? "speak" : "pass",
          speechAct: isFatherWithDuty ? "inform" : "none",
          targetCharacterId: isFatherWithDuty ? mother : "",
          vocalMode: isFatherWithDuty ? "call_out" : "",
          visibleAction: isFatherWithDuty ? dutyVisibleAction : "",
          utterance: isFatherWithDuty
            ? { literalSpeech: dutyUtterance, vocalMode: "call_out" }
            : { literalSpeech: "", vocalMode: "conversational" },
          actionAttempt: { primitive: "none", targetCharacterId: isFatherWithDuty ? mother : "" },
          commitmentAction: "open",
          commitmentTopic: "外账与送货",
          privateReason: isFatherWithDuty ? "先把店里的外账和送货缺口处理掉。" : "继续手里的事。",
          relationshipAppraisal: { phase: "pending_perception_appraisal", targetCharacterId: "", sourceImpactIds: [], changeMode: "none", dimensionChanges: [], reason: "" },
        },
        stage: { name: "CausalAgent:test", provider: "test", model: "fake", elapsedMs: 0 },
      };
    },
  },
});

const dutyCalls = causalInputs.filter((input) => input.agent?.id === father);
assert.ok(dutyCalls.length, "the target Agent must be activated by the directed duty request");
assert.ok(
  dutyCalls.some((input) => (input.privateActionCandidates || []).some((item) => item.feasible)),
  "the target Agent must receive feasible work candidates in the causal scene",
);

const lifeEvents = draft.updateBundle?.lifeEvents || [];
const dutyEvent = lifeEvents.find((event) => event.characterId === father);
assert.ok(dutyEvent, "the chosen duty must be replayed into a canonical life event");
assert.equal(dutyEvent.activityType, "speak", "the causal action type must be preserved into the canonical record");
assert.match(`${dutyEvent.dialogue || ""}${dutyEvent.visibleAction || ""}`, /外账|送货/, "the replayed action must retain the grounded duty content");

console.log("modelTavernAgentActionOverride:test passed", {
  activityType: dutyEvent.activityType,
  causalInputs: causalInputs.length,
});
