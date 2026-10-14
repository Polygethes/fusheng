import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  normalizeTavernCharacterDecision,
  runTavernCausalScene,
  tavernCausalAgentDecisionSchema,
} from "../src/server/pipeline/tavernCausalScene.mjs";

const ZHOU = "char_xyy_zhoumin";
const DESIRE = "desire_zhoumin_become_inner_court_disciple";
const PRESSURE = "state_zhoumin_status_failure_pressure";

assert.ok(
  tavernCausalAgentDecisionSchema.required.includes("postChoiceContinuity"),
  "the live Character Agent contract must require a pending continuity proposal",
);
assert.deepEqual(
  tavernCausalAgentDecisionSchema.properties.postChoiceContinuity.required,
  ["phase", "choiceSignificance", "actionMemory", "desireContinuity", "dynamicStateContinuity", "selfNarrative"],
);

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
let startingPressure = null;
let chosenCandidateId = "";
let committedPublicEvent = null;
const result = await runTavernCausalScene(state, {
  allowOrphanVisitors: true,
  characterIds: [ZHOU],
  positions: { [ZHOU]: "hall" },
  seedImpacts: [{
    sourceCharacterId: "world:continuity-integration-probe",
    sourceZoneId: "hall",
    type: "institution",
    modality: "sound",
    intensity: 100,
    radius: 0,
    directedTargetId: ZHOU,
    content: "一个与内门道路有关的机会刚刚没有形成任何实际进展。",
  }],
  maxSteps: 1,
  minimumActivationScore: 0,
  onEvent(event) {
    if (event.type === "causal_action_committed") committedPublicEvent = structuredClone(event);
  },
  async runAgent(input) {
    const selected = input.privateActionCandidates.find((candidate) => candidate.feasible && candidate.driveId === DESIRE)
      || input.privateActionCandidates.find((candidate) => candidate.feasible);
    chosenCandidateId = selected?.candidateId || "";
    startingPressure = input.agent.privateState.ecologyState.dynamicPsychology[PRESSURE];
    return {
      decision: {
        candidateId: chosenCandidateId,
        actionType: "act",
        speechAct: "none",
        targetCharacterId: "",
        speech: "",
        visibleAction: "周珉在原地站直，朝堂前看了一眼。",
        moveToZoneId: "",
        affordanceId: "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        decisionValue: "none",
        semanticFrameId: "",
        semanticRoleBindings: {},
        privateReason: "这一步没有取得内门进展，目标仍然存在。",
        postChoiceContinuity: {
          phase: "pending_world_resolution",
          choiceSignificance: "ordinary",
          actionMemory: { mode: "none", content: "", basisIds: [] },
          desireContinuity: [{
            desireId: DESIRE,
            status: "remains_unresolved",
            pressureDirection: "increase",
            strengthBand: "low",
            settlementCondition: "action_committed",
            reason: "没有取得成为内门弟子的真实进展。",
            basisIds: [DESIRE, chosenCandidateId],
          }],
          dynamicStateContinuity: [{
            stateId: PRESSURE,
            direction: "increase",
            strengthBand: "low",
            settlementCondition: "action_committed",
            linkedDesireId: "",
            reason: "机会没有形成进展，失败压力略微上升。",
            basisIds: [PRESSURE, chosenCandidateId],
          }],
          selfNarrative: {
            mode: "none",
            proposedClaim: "",
            replacesClaimIds: [],
            significanceBand: "low",
            permanenceBand: "low",
            basisIds: [],
            consolidationStatus: "not_applicable",
          },
        },
      },
    };
  },
});

assert.ok(chosenCandidateId);
if (result.actions.length !== 1) {
  console.error(JSON.stringify({
    stopReason: result.stopReason,
    decisions: result.decisions,
    chosenCandidateId,
  }, null, 2));
}
assert.equal(result.actions.length, 1);
assert.equal(result.actions[0].committed, true);
assert.equal(result.actions[0].postChoiceContinuity.phase, "pending_world_resolution");
assert.equal(result.actions[0].continuitySettlement.status, "settled");
assert.ok(committedPublicEvent);
assert.equal(Object.hasOwn(committedPublicEvent.action, "privateReason"), false);
assert.equal(Object.hasOwn(committedPublicEvent.action, "postChoiceContinuity"), false);
assert.equal(Object.hasOwn(committedPublicEvent.action, "postChoiceContinuityAuthority"), false);
assert.equal(Object.hasOwn(committedPublicEvent.action, "continuitySettlement"), false);
assert.ok(committedPublicEvent.publicRuntime.actions.every((action) => !Object.hasOwn(action, "postChoiceContinuity")));
assert.equal(result.privateSceneRuntime.continuitySettlements.length, 1);
assert.equal(result.privateSceneRuntime.continuitySettlements[0].actionId, result.actions[0].id);
const zhouPatch = result.characterPatches.find((patch) => patch.id === ZHOU);
assert.ok(zhouPatch);
assert.ok(zhouPatch.ecologyState.desires[DESIRE].frustration > 0);
assert.ok(zhouPatch.ecologyState.dynamicPsychology[PRESSURE] > startingPressure);
assert.equal(zhouPatch.agentMemory.selfNarrative.versions.length, 0, "an ordinary unresolved step must not rewrite identity");

// Private psychological annexes are not world actions. A malformed cognition,
// relationship, communication or continuity proposal must be isolated and
// audited without erasing an independently feasible outward choice.
let isolatedPublicEvent = null;
const isolated = await runTavernCausalScene(buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
}), {
  allowOrphanVisitors: true,
  characterIds: [ZHOU],
  positions: { [ZHOU]: "hall" },
  seedImpacts: [{
    sourceCharacterId: "world:private-proposal-isolation-probe",
    sourceZoneId: "hall",
    type: "institution",
    modality: "sound",
    intensity: 100,
    radius: 0,
    directedTargetId: ZHOU,
    content: "堂前传来一声与内门考核有关的钟响。",
  }],
  maxSteps: 1,
  minimumActivationScore: 0,
  onEvent(event) {
    if (event.type === "causal_action_committed") isolatedPublicEvent = structuredClone(event);
  },
  async runAgent(input) {
    const selected = input.privateActionCandidates.find((candidate) => candidate.feasible && candidate.driveId === DESIRE)
      || input.privateActionCandidates.find((candidate) => candidate.feasible);
    assert.ok(selected);
    return {
      decision: {
        candidateId: selected.candidateId,
        actionType: "act",
        speechAct: "none",
        targetCharacterId: "",
        speech: "",
        visibleAction: "周珉抬头听了一下钟声。",
        moveToZoneId: "",
        affordanceId: "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        decisionValue: "none",
        semanticFrameId: "",
        semanticRoleBindings: {},
        privateReason: "先听清是什么动静。",
        cognitiveAppraisal: {
          noticedEvidenceIds: ["invented:evidence"],
          interpretations: [],
          beliefOperations: [],
          entityModelUpdates: [],
          locationBeliefUpdates: [],
          sourceKnowledgeBeliefUpdates: [],
          threadAppraisals: [],
        },
        communicationPlan: {
          goal: "none",
          tactic: "silence",
          disclosure: "withhold",
          epistemicRelation: "not_applicable",
          intendedAudienceCharacterIds: [],
          desiredEffect: "",
          threadDisposition: "none",
          epistemicActionCandidateId: "",
          presuppositionStance: "not_applicable",
          epistemicBasisEvidenceIds: ["invented:communication-evidence"],
        },
        relationshipAppraisal: {
          phase: "pending_perception_appraisal",
          targetCharacterId: "char_not_perceived",
          sourceImpactIds: ["impact_not_perceived"],
          changeMode: "retained",
          dimensionChanges: [{ dimension: "trust", direction: "increase", magnitude: 0.2 }],
          reason: "这是一条故意无效的测试提案。",
        },
        postChoiceContinuity: {
          phase: "pending_world_resolution",
          choiceSignificance: "ordinary",
          actionMemory: {
            mode: "encode_if_committed",
            content: "一条带有未知依据的测试记忆。",
            basisIds: ["invented:continuity-basis"],
          },
          desireContinuity: [],
          dynamicStateContinuity: [],
          selfNarrative: {
            mode: "none",
            proposedClaim: "",
            replacesClaimIds: [],
            significanceBand: "low",
            permanenceBand: "low",
            basisIds: [],
            consolidationStatus: "not_applicable",
          },
        },
      },
    };
  },
});

assert.equal(isolated.actions.length, 1, "a malformed private annex must not erase the outward action");
const isolatedAction = isolated.actions[0];
assert.equal(isolatedAction.committed, true);
assert.equal(isolatedAction.postChoiceContinuityAuthority, "character-agent:rejected");
assert.equal(isolatedAction.cognitiveAppraisalAuthority, "character-agent:rejected");
assert.equal(isolatedAction.communicationPlanAuthority, "character-agent:rejected");
assert.equal(isolatedAction.relationshipAppraisalAuthority, "character-agent:rejected");
assert.equal(isolatedAction.continuitySettlement.status, "proposal_rejected");
assert.deepEqual(new Set(isolatedAction.privateProposalDiagnostics.map((row) => row.code)), new Set([
  "CHARACTER_CONTINUITY_PROPOSAL_INVALID",
  "CHARACTER_RELATIONSHIP_APPRAISAL_INVALID",
  "COGNITIVE_EVIDENCE_NOT_OWNED",
  "COMMUNICATION_EPISTEMIC_EVIDENCE_NOT_OWNED",
]));
assert.ok(isolatedPublicEvent);
assert.equal(Object.hasOwn(isolatedPublicEvent.action, "privateProposalDiagnostics"), false);
assert.equal(Object.hasOwn(isolatedPublicEvent.action, "continuitySettlement"), false);

// The executable affordance id and evidence already supporting an owned
// memory belief are both legitimate private bases. This is the exact class of
// reference used by Luo Zhao's rejected payment turn.
const paymentCandidateId = "affordance:pay_cash:test_visit";
const paymentAffordanceId = "pay_cash:test_visit";
const rememberedEvidenceId = "memory-owned-payment-evidence";
const normalizedPayment = normalizeTavernCharacterDecision({
  candidateId: paymentCandidateId,
  actionType: "interact",
  speechAct: "none",
  targetCharacterId: "char_xyy_xiezenshi",
  speech: "",
  visibleAction: "周珉递出三枚铜钱。",
  affordanceId: paymentAffordanceId,
  privateReason: "结清眼前的账。",
  communicationPlan: {
    goal: "none",
    tactic: "silence",
    disclosure: "withhold",
    epistemicRelation: "not_applicable",
    intendedAudienceCharacterIds: [],
    desiredEffect: "",
    threadDisposition: "none",
    epistemicActionCandidateId: "",
    presuppositionStance: "not_applicable",
    epistemicBasisEvidenceIds: [rememberedEvidenceId],
  },
  postChoiceContinuity: {
    phase: "pending_world_resolution",
    choiceSignificance: "ordinary",
    actionMemory: {
      mode: "encode_if_committed",
      content: "已经付过这笔钱。",
      basisIds: [paymentCandidateId, paymentAffordanceId],
    },
    desireContinuity: [{
      desireId: DESIRE,
      status: "unaffected",
      pressureDirection: "stable",
      strengthBand: "low",
      settlementCondition: "action_committed",
      reason: "结账不改变内门目标。",
      basisIds: [paymentCandidateId, paymentAffordanceId],
    }],
    dynamicStateContinuity: [],
    selfNarrative: {
      mode: "none",
      proposedClaim: "",
      replacesClaimIds: [],
      significanceBand: "low",
      permanenceBand: "low",
      basisIds: [],
      consolidationStatus: "not_applicable",
    },
  },
}, {
  agent: {
    id: ZHOU,
    name: "周珉",
    privateState: {
      ecologyState: {
        desires: { [DESIRE]: {} },
        dynamicPsychology: {},
      },
    },
    memoryContext: {
      beliefs: [{
        supportingEvidenceIds: [rememberedEvidenceId],
        provenance: { evidenceIds: [rememberedEvidenceId] },
      }],
    },
  },
  scene: { zoneId: "hall", zoneLabel: "堂前" },
  perceivedCharacters: [{ id: "char_xyy_xiezenshi", name: "谢真石" }],
  reachableZones: [],
  privateActionCandidates: [{
    candidateId: paymentCandidateId,
    feasible: true,
    driveId: DESIRE,
    actionKind: "interact",
    targetCharacterId: "char_xyy_xiezenshi",
    realization: { affordanceId: paymentAffordanceId },
  }],
  availableAffordances: [{
    id: paymentAffordanceId,
    type: "pay_cash",
    targetCharacterId: "char_xyy_xiezenshi",
  }],
  materialFacts: [],
  perceivedImpacts: [],
  perceptionMemory: [],
}, state, {});
assert.equal(normalizedPayment.candidateId, paymentCandidateId);
assert.equal(normalizedPayment.affordanceId, paymentAffordanceId);
assert.equal(normalizedPayment.postChoiceContinuityAuthority, "character-agent");
assert.equal(normalizedPayment.communicationPlanAuthority, "character-agent");
assert.deepEqual(normalizedPayment.privateProposalDiagnostics, []);
assert.deepEqual(normalizedPayment.semanticViolations, []);

console.log("tavernPostChoiceContinuityIntegration:test passed", {
  actionId: result.actions[0].id,
  desireId: DESIRE,
  pressureBefore: startingPressure,
  pressureAfter: zhouPatch.ecologyState.dynamicPsychology[PRESSURE],
  settlement: result.actions[0].continuitySettlement.status,
  isolatedActionId: isolatedAction.id,
  isolatedDiagnostics: isolatedAction.privateProposalDiagnostics.map((row) => row.code),
});
