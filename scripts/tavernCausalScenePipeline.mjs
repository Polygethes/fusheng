import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { playModelPeriodWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";
import { renderApp } from "../src/ui/render.js";
import { applyGeneratedSetupWorld, applyUpdateBundle, exportState, getState, importState, saveDraft } from "../src/state/store.js";

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
const mother = "char_xyy_xiemu";
const father = "char_xyy_xieheng";
const son = "char_xyy_xiezenshi";
const privateMarkers = {
  [mother]: "PRIVATE_MOTHER_CAUSAL",
  [father]: "PRIVATE_FATHER_CAUSAL",
  [son]: "PRIVATE_SON_CAUSAL",
};
for (const character of state.characters) {
  if (privateMarkers[character.id]) character.lifeState.hiddenAgenda = privateMarkers[character.id];
}
const macroBefore = { day: state.tavernState.day, tick: state.tavernState.tick };
let oldSchedulerCalls = 0;
const calls = [];
const events = [];
let motherHandledDoor = false;
let fatherAnsweredMother = false;

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
  characterIds: [mother, father, son],
  positions: { [mother]: "counter", [father]: "hall", [son]: "courtyard" },
  seedImpacts: [{
    sourceCharacterId: "world:tavern-door",
    sourceZoneId: "threshold",
    type: "physical",
    modality: "sound",
    intensity: 90,
    radius: 3,
    content: "门外有人敲了两下门。",
  }],
  maxSteps: 7,
  onProgress(event) { events.push(structuredClone(event)); },
  runners: {
    async runTavernAgentDecision() {
      oldSchedulerCalls += 1;
      throw new Error("the pre-authored tavern scheduler must not run in scene mode");
    },
    async runTavernCausalAgent(input) {
      calls.push(structuredClone(input));
      const serialized = JSON.stringify(input);
      const usesValidatedFoundation = input.agent.privateState?.selfModel?.authority
        === "validated-character-foundation-and-owned-memory-only";
      if (usesValidatedFoundation) {
        assert.equal(input.agent.psychologyAnchor?.characterId, input.agent.id);
        assert.equal(input.agent.psychologyAnchor?.runtimeSurface, "character-foundation");
      } else {
        assert.ok(serialized.includes(privateMarkers[input.agent.id] || input.agent.privateState.hiddenAgenda));
      }
      for (const [id, marker] of Object.entries(privateMarkers)) {
        if (usesValidatedFoundation || id !== input.agent.id) {
          assert.ok(!serialized.includes(marker), "legacy or another Agent's private state leaked into this activation");
        }
      }
      const isMotherDoorWake = input.agent.id === mother
        && /门外有人敲了两下门/.test(input.activation?.content || "")
        && !motherHandledDoor;
      if (isMotherDoorWake) {
        const candidate = input.privateActionCandidates.find((item) => item.actionKind === "handle_environment_event" && item.feasible);
        assert.ok(candidate, "the mother must receive the perceived door event as an Agent-owned option");
        motherHandledDoor = true;
        return { decision: {
        candidateId: candidate.candidateId,
        actionType: "speak", speechAct: "ask", targetCharacterId: father,
        vocalMode: "call_out",
        speech: "当家的，门口有人，你去看一眼。",
        visibleAction: "谢母停下拨算盘，朝门槛抬了抬下巴",
        moveToZoneId: "", informationSourceImpactId: "",
        commitmentAction: "open", commitmentTopic: "查看门外来人",
        privateReason: "PRIVATE_DECISION_MOTHER",
        relationshipAppraisal: noRelationshipAppraisal(),
      }, stage: { name: "CausalAgent:mother", provider: "test", elapsedMs: 1 } };
      }
      const isFatherReplyWake = input.agent.id === father
        && input.activation?.sourceCharacterId === mother
        && /当家的，门口有人，你去看一眼/.test(input.activation?.content || "")
        && !fatherAnsweredMother;
      if (isFatherReplyWake) {
        const candidate = input.privateActionCandidates.find((item) => item.targetCharacterId === mother && item.feasible);
        assert.ok(candidate, "the father must receive the mother's directed request as an Agent-owned option");
        fatherAnsweredMother = true;
        return { decision: {
        candidateId: candidate.candidateId,
        actionType: "move", speechAct: "answer", targetCharacterId: mother,
        vocalMode: "call_out",
        speech: "门口我先去看，你守着柜台。",
        visibleAction: "谢恒放下手里的东西，朝门槛走去",
        moveToZoneId: "threshold", informationSourceImpactId: "",
        commitmentAction: "fulfill", commitmentTopic: "查看门外来人",
        privateReason: "PRIVATE_DECISION_FATHER",
        relationshipAppraisal: {
          phase: "pending_perception_appraisal",
          targetCharacterId: mother,
          sourceImpactIds: [input.activation.impactId],
          changeMode: "retained",
          dimensionChanges: [{ metric: "dependence", direction: "increase", strengthBand: "low" }],
          reason: "我听见她把这件事交给我，愿意把这次配合略微记在心里。",
        },
      }, stage: { name: "CausalAgent:father", provider: "test", elapsedMs: 1 } };
      }
      const passCandidate = input.privateActionCandidates.find((item) => item.feasible) || null;
      return { decision: {
        candidateId: passCandidate?.candidateId || "",
        actionType: "pass", speechAct: "none", targetCharacterId: "", speech: "", visibleAction: "",
        moveToZoneId: "", informationSourceImpactId: "", commitmentAction: "none", commitmentTopic: "",
        privateReason: "PRIVATE_DECISION_PASS",
      }, stage: { name: "CausalAgent:pass", provider: "test", elapsedMs: 1 } };
    },
  },
});

assert.equal(oldSchedulerCalls, 0, "scene/beat must bypass deterministic full-scene pre-authorship");
const motherCallIndex = calls.findIndex((input) => (
  input.agent.id === mother && /门外有人敲了两下门/.test(input.activation?.content || "")
));
const fatherReplyCallIndex = calls.findIndex((input, index) => (
  index > motherCallIndex
  && input.agent.id === father
  && input.activation?.sourceCharacterId === mother
  && /当家的，门口有人，你去看一眼/.test(input.activation?.content || "")
));
assert.ok(motherCallIndex >= 0, "the door impact must eventually activate the mother even if another Agent moves first");
assert.ok(fatherReplyCallIndex > motherCallIndex, "the mother's committed request must activate the father afterwards");
assert.equal(draft.pipelineMeta.mode, "model-tavern-causal-scene");
assert.match(draft.pipelineMeta.pipeline, /Action→Impact→SpatialPropagation→PrivateAppraisal→NextAgent/);
assert.ok(draft.causalScene.actions.length >= 2);
const motherRequest = draft.causalScene.actions.find((action) => (
  action.actorId === mother
  && action.targetCharacterId === father
  && /当家的，门口有人，你去看一眼/.test(action.speech || "")
));
const fatherReply = draft.causalScene.actions.find((action) => (
  action.actorId === father
  && action.targetCharacterId === mother
  && /门口我先去看，你守着柜台/.test(action.speech || "")
));
assert.ok(motherRequest, "the mother must own the request addressed to the father");
assert.ok(fatherReply, "the father must own the answer addressed back to the mother");
const motherRequestImpact = draft.causalScene.impacts.find((impact) => (
  impact.causedByActionId === motherRequest.id
  && impact.directedTargetId === father
));
assert.ok(motherRequestImpact, "the mother's request must produce a directed impact for the father");
assert.equal(
  fatherReply.causalParentImpactId,
  motherRequestImpact.id,
  "the father's answer must bind to the impact delivered from the mother's committed request",
);
assert.ok(draft.causalScene.deliveries.length >= 2);
assert.equal(draft.causalScene.macroTimeAdvanced, false);
assert.deepEqual({ day: draft.updateBundle.tavernState.day, tick: draft.updateBundle.tavernState.tick }, macroBefore);
assert.equal(draft.updateBundle.tavernState.sceneRuntime.agents[father].zoneId, "threshold");
assert.ok(draft.updateBundle.relationships.some((shift) => (
  shift.sourceImpactId
  && shift.generatedFrom === "character-agent-owned-appraisal"
  && shift.fromCharacterId === father
  && shift.toCharacterId === mother
)), "the recipient Character Agent's explicit appraisal must update only his own stance");
assert.ok(!draft.updateBundle.relationships.some((shift) => shift.generatedFrom === "agent-dialogue-relationship"), "the legacy speaker-to-listener relationship fallback must stay disabled");
assert.ok(draft.updateBundle.characterMemories.some((memory) => memory.characterId === father && /门口有人/.test(memory.content)));
assert.ok(events.some((event) => event.type === "impact_delivered"));
assert.ok(events.some((event) => event.type === "causal_agent_activated"));
assert.ok(events.some((event) => event.type === "action"));
const streamedAnswer = events.find((event) => event.type === "dialogue" && /门口我先去看/.test(event.line || ""));
assert.ok(streamedAnswer?.respondsTo && /门口有人/.test(streamedAnswer.responseSourceLine), "the immediate reply must point to the actual prior line");
const redirectedTurn = draft.sceneInteraction.agentExchanges[0].dialogueTurns.find((turn) => /码好灶边柴薪|把灶边那捆柴/.test(`${turn.responseTopic} ${turn.line}`));
if (redirectedTurn) assert.equal(redirectedTurn.respondsTo, "", "an impact-caused turn toward a third person is a new address, not a reply to that third person");
for (const turn of draft.sceneInteraction.agentExchanges[0].dialogueTurns.filter((item) => item.respondsTo)) {
  assert.equal(turn.targetId, turn.responseSourceSpeakerId, "a marked reply must point back to the speaker of the cited source turn");
}
assert.ok(events.some((event) => event.type === "novel_delta"));
assert.ok(draft.observerPsychology.some((entry) => entry.privateReason === "PRIVATE_DECISION_MOTHER"), "the human observer should retain the real Agent decision reason");
assert.ok(!JSON.stringify({
  novelText: draft.novelText,
  actions: draft.causalScene.actions,
  impacts: draft.causalScene.impacts,
  deliveries: draft.causalScene.deliveries,
  updateBundle: draft.updateBundle,
}).includes("PRIVATE_DECISION_"), "private decision reasons must not enter public world facts or persisted Agent-readable runtime");

const observed = {
  ...state,
  draftScenes: [draft],
  ui: {
    ...state.ui,
    lastDraftId: draft.id,
    observerPlayback: { draftId: draft.id, visibleCount: 3, totalCount: 3, status: "complete" },
  },
};
const html = renderApp(observed);
assert.match(html, /场景因果链/);
assert.match(html, /影响抵达/);
assert.match(html, /下一位：谢恒/);
assert.match(html, /门口我先去看，你守着柜台/);

applyGeneratedSetupWorld(state, state.worldSetup?.sourcePrompts || {});
saveDraft(draft);
applyUpdateBundle(draft.updateBundle);
const serialized = exportState();
assert.ok(serialized.includes("PRIVATE_DECISION_MOTHER"), "observer-only decision reasons must survive refresh");
assert.ok(serialized.length < 2_000_000, `a causal scene snapshot must stay safely below browser storage limits: ${serialized.length}`);
importState(serialized);


const restored = getState();
const restoredDraft = restored.draftScenes.find((item) => item.id === draft.id);
assert.equal(restoredDraft.causalScene.elapsedSeconds, draft.causalScene.elapsedSeconds);
assert.equal(
  restoredDraft.causalScene.actions.find((action) => action.actorId === father)?.speech,
  "门口我先去看，你守着柜台。",
);
assert.ok(
  restoredDraft.causalScene.activations.some((activation) => (
    activation.characterId === father && activation.sourceImpactId === motherRequestImpact.id
  )),
  "the restored activation ledger must preserve the father's request-triggered turn",
);
assert.equal(restoredDraft.observerPsychology[0].actionId, draft.causalScene.actions[0].id);
assert.equal(restored.tavernState.sceneRuntime.agents[father].zoneId, "threshold");

console.log("tavernCausalScenePipeline:test passed", {
  activations: calls.map((input) => input.agent.name),
  actions: draft.causalScene.actions.length,
  deliveries: draft.causalScene.deliveries.length,
  elapsedSeconds: draft.causalScene.elapsedSeconds,
  snapshotBytes: serialized.length,
});
