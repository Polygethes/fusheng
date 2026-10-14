import assert from "node:assert/strict";
import { playModelPeriodWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";
import { renderApp } from "../src/ui/render.js";
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
state.ui.setupCompleted = true;
state.ui.activeTab = "reality";
state.branches = [{ id: "branch_main", title: "主线", snapshot: {} }];

const mother = "char_xyy_xiemu";
const father = "char_xyy_xieheng";
let legacySchedulerCalls = 0;
let legacyWitnessCalls = 0;
const causalInputs = [];
const progressEvents = [];

function noRelationshipAppraisal() {
  return {
    phase: "pending_perception_appraisal",
    targetCharacterId: "",
    sourceImpactIds: [],
    changeMode: "none",
    dimensionChanges: [],
    reason: "",
  };
}

const draft = await playModelPeriodWithRunners(state, {
  pipelineMode: "live",
  characterAgentProtocolVersion: 1,
  characterIds: [mother, father],
  positions: { [mother]: "counter", [father]: "hall" },
  slotContext: { day: 1, slotId: "morning", slotLabel: "清晨" },
  seedImpacts: [{
    sourceCharacterId: "world:tavern-door",
    sourceZoneId: "threshold",
    type: "physical",
    modality: "sound",
    intensity: 90,
    radius: 3,
    content: "门外有人敲了两下门。",
  }],
  maxSteps: 2,
  minimumActivationScore: 0,
  onProgress(event) {
    progressEvents.push(structuredClone(event));
  },
  runners: {
    async runTavernAgentDecision() {
      legacySchedulerCalls += 1;
      throw new Error("the legacy tavern scheduler must not run in a causal scene");
    },
    async runBackgroundSlot() {
      legacyWitnessCalls += 1;
      throw new Error("the legacy Activity Witness must not run in a causal scene");
    },
    async runTavernCausalAgent(input) {
      causalInputs.push(structuredClone(input));
      if (causalInputs.length === 1) {
        assert.equal(input.agent.id, mother, "the manager must react first to the tavern door");
        const candidate = input.privateActionCandidates.find((item) => (
          item.feasible && item.actionKind === "handle_environment_event"
        ));
        assert.ok(candidate);
        return {
          decision: {
            candidateId: candidate.candidateId,
            actionType: "speak",
            speechAct: "inform",
            targetCharacterId: father,
            vocalMode: "call_out",
            speech: "他爹，门口敲得急，你去看一眼；我守着柜台。",
            visibleAction: "谢母停下拨算盘，朝门槛抬了抬下巴。",
            moveToZoneId: "",
            affordanceId: "",
            informationSourceImpactId: "",
            commitmentAction: "open",
            commitmentTopic: "查看门外来人",
            privateReason: "自己守着柜台，让离门近的人去看。",
            relationshipAppraisal: noRelationshipAppraisal(),
          },
          stage: { name: "CausalAgent:mother", provider: "test", model: "fake", elapsedMs: 0 },
        };
      }
      assert.equal(input.agent.id, father, "the actual addressee must receive the next activation");
      const candidate = input.privateActionCandidates.find((item) => (
        item.feasible && item.targetCharacterId === mother
      ));
      assert.ok(candidate);
      return {
        decision: {
          candidateId: candidate.candidateId,
          actionType: "move",
          speechAct: "answer",
          targetCharacterId: mother,
          vocalMode: "call_out",
          speech: "他娘，我先去看；门外来的是谁，回头我再记到堂前账上。",
          visibleAction: "谢恒放下手里的东西，朝门槛走去。",
          moveToZoneId: "threshold",
          affordanceId: "",
          informationSourceImpactId: "",
          commitmentAction: "defer",
          commitmentTopic: "查看门外来人",
          privateReason: "先接下她的请求，查看后再把实情告诉她。",
          relationshipAppraisal: {
            phase: "pending_perception_appraisal",
            targetCharacterId: mother,
            sourceImpactIds: [input.activation.impactId],
            changeMode: "retained",
            dimensionChanges: [{ metric: "dependence", direction: "increase", strengthBand: "low" }],
            reason: "我听见她把这件事交给我，于是把这次配合略微记在自己的判断里。",
          },
        },
        stage: { name: "CausalAgent:father", provider: "test", model: "fake", elapsedMs: 0 },
      };
    },
  },
});

assert.equal(legacySchedulerCalls, 0, "the old Agent scheduler must stay outside the causal scene");
assert.equal(legacyWitnessCalls, 0, "the old Activity Witness runner must not run");
assert.deepEqual(causalInputs.map((input) => input.agent.id), [mother, father]);
assert.ok(causalInputs[1]?.activation?.sourceActionId, `the answer must be activated by the delivered causal action: ${JSON.stringify({ activation: causalInputs[1]?.activation, actions: draft.causalScene.actions, decisions: draft.causalScene.decisions }, null, 2)}`);
assert.ok(progressEvents.some((event) => event.type === "dialogue" && /门口敲得急/.test(event.line || "")), "canonical speech must stream as a visible interaction event");
assert.ok(progressEvents.some((event) => event.type === "dialogue" && event.respondsTo && (event.responseSourceLine || event.responseTopic)), "a streamed response must carry its visible source line or thread topic");
const requestAction = draft.causalScene.actions.find((action) => action.actorId === mother && action.targetCharacterId === father && /门口敲得急/.test(action.speech || ""));
assert.ok(requestAction, "the deterministic causal request must be committed");
const relationshipShift = draft.updateBundle.relationships.find((shift) => (
  shift.generatedFrom === "character-agent-owned-appraisal"
  && shift.fromCharacterId === father
  && shift.toCharacterId === mother
  && shift.sourceActionId === requestAction.id
));
assert.ok(relationshipShift, "the listener's stance changes only after his Character Agent explicitly appraises the received request");
assert.ok(relationshipShift.sourceImpactId, "the relationship shift must retain its delivered impact source");
assert.ok(requestAction.impactFactors.some((impact) => impact.id === relationshipShift.sourceImpactId), "sourceImpactId must belong to the source action");
const relationshipDelivery = draft.causalScene.deliveries.find((delivery) => delivery.impactId === relationshipShift.sourceImpactId);
assert.equal(relationshipDelivery?.recipientId, father, "the relationship evidence must have reached the listener");
assert.equal(relationshipDelivery?.sourceCharacterId, mother, "the relationship evidence must originate from the speaker");
assert.equal(relationshipDelivery?.provenance?.sourceActionId, requestAction.id, "delivery provenance and shift sourceActionId must identify the same action");
assert.ok(!draft.updateBundle.relationships.some((shift) => (
  shift.sourceActionId === requestAction.id
  && shift.fromCharacterId === mother
  && shift.toCharacterId === father
)), "one perceived request must not fabricate the reverse speaker-to-listener change");
assert.ok(!draft.updateBundle.relationships.some((shift) => shift.generatedFrom === "agent-dialogue-relationship"), "the legacy relationship fallback must stay unused");
assert.ok(draft.updateBundle.tavernState.eventThreads.some((thread) => thread.topic === "查看门外来人"), "the same interaction must persist unfinished business");
assert.equal(draft.agentParticipation?.length, 1, "the causal scene must persist one participation trace");
assert.deepEqual(draft.agentParticipation[0].activatedAgentIds, [mother, father]);
assert.equal(draft.agentParticipation[0].witness?.ran, false, "participation must record that Activity Witness did not run");

const observedState = {
  ...state,
  draftScenes: [draft],
  ui: { ...state.ui, lastDraftId: draft.id, observerPlayback: { draftId: draft.id, visibleCount: 5, totalCount: 5, status: "complete" } },
};
const html = renderApp(observedState);
assert.match(html, /门口敲得急，你去看一眼/);
assert.match(html, /关系推进/);
assert.match(html, /查看门外来人/);
assert.match(html, /本轮 Agent 参与/);
assert.match(html, /人物 Agent：/);
assert.match(html, /场景整理：未调用/);
assert.doesNotMatch(html, /场景整理：Activity Witness/);
assert.match(html, /场景因果链/);
assert.match(html, /影响抵达/);
assert.match(html, /接着[\s\S]*查看门外来人|承接[\s\S]*门口有人/);

console.log("modelTavernRuntimeVisibility:test passed", {
  dialogueEvents: progressEvents.filter((event) => event.type === "dialogue").length,
  relationshipShifts: draft.updateBundle.relationships.length,
  relationshipSource: `${relationshipShift.sourceActionId}/${relationshipShift.sourceImpactId}`,
});
