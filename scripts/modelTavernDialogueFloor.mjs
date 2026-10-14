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
  if (["char_xyy_xiemu", "char_xyy_xieheng", "char_xyy_chenyan"].includes(character.id)) {
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
      char_xyy_chenyan: { ...(state.tavernState?.sceneRuntime?.agents?.char_xyy_chenyan || {}), zoneId: "hall" },
    },
  },
};

let speakCount = 0;
const draft = await playModelPeriodWithRunners(state, {
  pipelineMode: "live",
  // These contracts are offline by construction: a runner they fail to inject
  // must be named, never replaced by a real provider call.
  runnerPolicy: "strict",
  characterAgentProtocolVersion: 1,
  seedImpactsBySlot: {
    "day-1-dawn": [{
      sourceCharacterId: "char_xyy_xieheng",
      sourceZoneId: "hall",
      type: "speech",
      modality: "sound",
      intensity: 88,
      radius: 3,
      directedTargetId: "char_xyy_xiemu",
      content: "他娘，账对完没有？",
      speechAct: "ask",
      topic: "核对账目",
    }],
  },
  maxStepsPerSlot: 4,
  runners: {
    async runTavernCausalAgent(input) {
      const target = (input.perceivedCharacters || []).find((row) => row.id !== input.agent.id);
      const candidate = (input.privateActionCandidates || []).find((item) => item.feasible);
      // Dialogue stays an Agent choice: speak while somebody stands in front
      // of the character and the day has not already heard enough, pass
      // otherwise.
      if (target && speakCount < 4) {
        speakCount += 1;
        const isMother = input.agent?.id === "char_xyy_xiemu";
        return {
          decision: {
            candidateId: candidate?.candidateId || "",
            actionType: "speak",
            speechAct: isMother ? "answer" : "ask",
            targetCharacterId: target.id,
            vocalMode: "conversational",
            visibleAction: `${input.agent?.name}朝${target.name}那边抬了抬眼。`,
            utterance: {
              literalSpeech: isMother
                ? `${target.name}，账对完了，你先歇着。`
                : `${target.name}，他娘，账对完没有？`,
              vocalMode: "conversational",
            },
            actionAttempt: { primitive: "none", targetCharacterId: target.id },
            commitmentAction: isMother ? "fulfill" : "open",
            commitmentTopic: "核对账目",
            privateReason: "回应眼前的人。",
            relationshipAppraisal: { phase: "pending_perception_appraisal", targetCharacterId: target.id, sourceImpactIds: [], changeMode: "none", dimensionChanges: [], reason: "" },
          },
          stage: { name: "CausalAgent:test", provider: "test", model: "fake", elapsedMs: 0 },
        };
      }
      return {
        decision: { actionType: "pass", speechAct: "none", privateReason: "继续手里的事。" },
        stage: { name: "CausalAgent:test", provider: "test", model: "fake", elapsedMs: 0 },
      };
    },
  },
});

const ticks = draft.periodSimulation?.ticks || [];
const dialogueTicks = ticks.filter((tick) => (tick.sceneInteraction?.agentExchanges || []).some((exchange) => (exchange.dialogueTurns || []).length >= 1));
const turns = ticks.flatMap((tick) => tick.sceneInteraction?.agentExchanges || []).flatMap((exchange) => exchange.dialogueTurns || []);

assert.ok(dialogueTicks.length >= 1, `a model-driven ordinary day must not pass with zero speech, got ${dialogueTicks.length}/${ticks.length}`);
assert.ok(turns.every((turn) => turn.generatedBy === "causal-character-agent"), "spoken turns must carry the causal agent provenance");
assert.ok(turns.some((turn) => turn.respondsTo), "the day must contain a real addressed response, not only unrelated first lines");
const threads = draft.updateBundle?.tavernState?.eventThreads || [];
assert.ok(
  threads.some((thread) => Array.isArray(thread.participantIds) && thread.participantIds.length >= 2 && thread.topic),
  "an exchange must open a shared unfinished-business thread with its topic",
);
assert.ok(
  /未得到回答|依次完成/.test(draft.surfaceEvent || ""),
  `the period must surface either its completion or the concrete unresolved request, got: ${draft.surfaceEvent}`,
);
assert.ok((draft.agentDecisionMeta?.decisions || 0) > 0, "the causal activations must be visible in the decision meta");

console.log("modelTavernDialogueFloor:test passed", {
  dialogueTicks: dialogueTicks.length,
  turns: turns.length,
  threads: threads.length,
});
