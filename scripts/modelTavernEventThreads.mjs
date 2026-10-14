import assert from "node:assert/strict";
import { playTavernCausalSceneWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";
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

let opened = false;
let answeredWithTranscript = false;
const draft = await playTavernCausalSceneWithRunners(state, {
  characterAgentProtocolVersion: 1,
  pipelineMode: "live",
  characterIds: ["char_xyy_xieheng", "char_xyy_xiemu"],
  positions: { char_xyy_xieheng: "hall", char_xyy_xiemu: "hall" },
  seedImpacts: [{
    id: "impact_event_thread_rice",
    sourceCharacterId: "world:rice-count",
    sourceZoneId: "hall",
    type: "resource",
    modality: "visual",
    intensity: 100,
    radius: 0,
    directedTargetId: "char_xyy_xieheng",
    content: "米缸见底，今晚出餐前必须核清余量。",
    topic: "今晚的米是否够用",
  }],
  slotContext: { day: 1, slotId: "day-1-dusk", slotLabel: "黄昏", slotBaseId: "dusk" },
  maxSteps: 4,
  minimumActivationScore: 0,
  runners: {
    async runTavernCausalAgent(input) {
      if (!opened && input.agent.id === "char_xyy_xieheng" && input.perceivedCharacters.some((item) => item.id === "char_xyy_xiemu")) {
        const candidate = input.privateActionCandidates.find((item) => (
          item.feasible && item.actionKind === "handle_environment_event"
        ));
        assert.ok(candidate, JSON.stringify(input.privateActionCandidates.map((item) => ({ id: item.candidateId, target: item.targetCharacterId, realization: item.realization }))));
        opened = true;
        return {
          decision: {
            candidateId: candidate.candidateId,
            actionType: "speak",
            speechAct: "ask",
            targetCharacterId: "char_xyy_xiemu",
            speech: "他娘，米缸的数目我还没记；今晚要是再来两桌，够不够？",
            visibleAction: "谢恒放下账板，朝谢母抬了抬眼",
            moveToZoneId: "",
            affordanceId: "",
            informationSourceImpactId: "",
            commitmentAction: "open",
            commitmentTopic: "今晚的米是否够用",
            privateReason: "外账和灶房存量不能各算各的。",
          },
          stage: { name: "CausalAgent:open", provider: "test", model: "fake", elapsedMs: 0 },
        };
      }
      const addressed = (input.perceivedImpacts || []).find((impact) => (
        impact.sourceCharacterId === "char_xyy_xieheng"
        && impact.provenance?.sourceActionId
        && /米|今晚/.test(`${impact.content || ""} ${impact.topic || ""}`)
      ));
      if (!answeredWithTranscript && addressed && input.agent.id === "char_xyy_xiemu") {
        const candidate = input.privateActionCandidates.find((item) => (
          item.feasible
          && item.targetCharacterId === "char_xyy_xieheng"
          && item.realization?.responseSourceImpactId === addressed.impactId
        ));
        assert.ok(candidate, JSON.stringify({
          activation: input.activation,
          openConversationThreads: input.openConversationThreads,
          candidates: input.privateActionCandidates.map((item) => ({
            id: item.candidateId,
            target: item.targetCharacterId,
            feasible: item.feasible,
            realization: item.realization,
          })),
        }));
        answeredWithTranscript = true;
        return {
          decision: {
            candidateId: candidate.candidateId,
            actionType: "speak",
            speechAct: "answer",
            targetCharacterId: "char_xyy_xieheng",
            speech: "他爹，只照现在的碗数，灶上的米够；再添两桌，我就得把账板上的缺口记出来。",
            visibleAction: "谢母看了一眼米缸，手指在缸沿比了个数",
            moveToZoneId: "",
            affordanceId: "",
            informationSourceImpactId: "",
            commitmentAction: "none",
            commitmentTopic: "今晚的米是否够用",
            privateReason: "给实数，不替他把进货决定也做了。",
          },
          stage: { name: "CausalAgent:answer", provider: "test", model: "fake", elapsedMs: 0 },
        };
      }
      return {
        decision: {
          candidateId: input.privateActionCandidates.find((item) => item.feasible)?.candidateId || "",
          actionType: "pass", speechAct: "none", targetCharacterId: "", speech: "", visibleAction: "",
          moveToZoneId: "", affordanceId: "", informationSourceImpactId: "", commitmentAction: "none", commitmentTopic: "",
          privateReason: "继续手里的事。",
        },
        stage: { name: "CausalAgent:quiet", provider: "test", model: "fake", elapsedMs: 0 },
      };
    },
  },
});

assert.equal(opened, true);
assert.equal(answeredWithTranscript, true, "the addressed Agent must see the prior public turn before deciding");
const threads = draft.updateBundle?.tavernState?.eventThreads || [];
assert.ok(threads.length, `public Agent choices must create a persistent event thread: ${JSON.stringify({ actions: draft.causalScene.actions, decisions: draft.causalScene.decisions }, null, 2)}`);
const thread = threads.find((item) => item.topic === "今晚的米是否够用");
assert.ok(thread, JSON.stringify(threads));
assert.deepEqual(new Set(thread.participantIds), new Set(["char_xyy_xieheng", "char_xyy_xiemu"]));
assert.ok(thread.turns?.length >= 2);
assert.equal(thread.participantStates.char_xyy_xiemu.selfClosure, "closed_for_self", "the answerer may regard her own response as complete");
assert.equal(thread.participantStates.char_xyy_xieheng.processingStatus, "awaiting_delivery", "physical propagation cannot manufacture the asker's conscious uptake or verdict");
assert.equal(thread.status, "open", "a concrete answer is still not permission to manufacture the asker's satisfaction");
assert.equal(thread.nextObligationCharacterId, "char_xyy_xieheng", "the first speaker keeps an appraisal opportunity once his own attention takes up the answer, not a forced acknowledgement line");

console.log("modelTavernEventThreads:test passed", { topic: thread.topic, turns: thread.turns.length });
