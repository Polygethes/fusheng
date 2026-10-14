import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { findValidatedCharacterAnchorRuntime } from "../src/server/ecology/validatedCharacterAnchorRuntime.mjs";
import { getTavernEcologyProfile } from "../src/server/ecology/tavernEcologyProfile.mjs";
import { createInitialEcologyState } from "../src/server/ecology/tavernEcologyState.mjs";
import { createTavernCharacterAgentV2Session } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import {
  TAVERN_SCENE_TOPOLOGY,
  buildTavernSceneRuntime,
  deliverImpactFactor,
  deriveImpactFactorsFromAction,
  normalizeTavernCharacterDecision,
  publicCommittedAction,
  selectNextCausalAgent,
  settleFreeActionAttempt,
  tavernMovementOptionsForActor,
  updateRuntimeConversationLocks,
} from "../src/server/pipeline/tavernCausalScene.mjs";
import {
  applyCharacterSharedActivityResponse,
  createCharacterSharedActivityProposal,
  createScopedCharacterAccessGrant,
} from "../src/server/simulation/characterSharedActivity.mjs";

const LUO = "char_xyy_luozhao";
const XIE = "char_xyy_xiezenshi";
const DESIRE = "desire_luozhao_test_own_limit_against_xiezenshi";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.tavernState.activeVisits = [{
  id: "visit:luo:v24",
  visitorId: LUO,
  stage: "purpose_declared",
  purposeStatus: "declared",
  allowedZoneIds: ["threshold", "hall"],
}];

const anchor = findValidatedCharacterAnchorRuntime(LUO);
assert.ok(anchor, "Luo Zhao's validated foundation must be available");

function v2Input(step) {
  return {
    scene: { id: "scene:v24:world", step, elapsedSeconds: 30, zoneId: "hall", zoneLabel: "堂前" },
    agent: {
      id: LUO,
      name: "洛照",
      psychologyAnchor: anchor.psychologyAnchor,
      privateState: { ecologyProfile: anchor.ecologyProjection, ecologyState: {} },
      relationshipContext: [],
      memoryContext: {},
    },
    perceivedCharacters: [{ id: XIE, name: "谢真石", zoneId: "hall", identityKnown: true }],
    perceivedImpacts: [],
    perceivedObjects: [],
    availableAffordances: [],
    reachableZones: [
      { id: "hall", label: "堂前" },
      { id: "threshold", label: "门槛" },
      {
        id: "courtyard",
        label: "后院",
        physicalAccess: { physicallyAttemptable: true, targetEffectCurrentlyPossible: true, barrier: null },
        socialAccess: {
          permissionRequiredByNorm: true,
          permissionCurrentlyGranted: false,
          violationPhysicallyPossible: true,
          evidenceIds: ["social-fact:visit-scope:visit:luo:v24"],
        },
      },
    ],
    socialContext: {
      directParticipantIds: [LUO, XIE],
      thirdPartyObserverIds: [],
      audienceExposure: 0,
      place: { placeId: "loc_xyy_tavern", zoneId: "hall", publicAccess: true },
      socialFacts: [{
        factId: "social-fact:visit-scope:visit:luo:v24",
        kind: "access_claim",
        subjectId: LUO,
        entityId: "loc_xyy_tavern",
        sourceEvidenceIds: ["social-fact:visit-scope:visit:luo:v24"],
      }],
      interpretationAuthority: "character-agent",
    },
  };
}

const session4 = createTavernCharacterAgentV2Session(v2Input(4));
const session5 = createTavernCharacterAgentV2Session(v2Input(5));
assert.notEqual(session4.agentTurnId, session5.agentTurnId, "scene step, not elapsed second alone, must distinguish Agent turns");
const projectedDesire = session4.privateContext.desires.find((row) => row.desireId === DESIRE);
assert.equal(projectedDesire.satisfactionCondition.type, "valid_firsthand_exchange");
assert.ok(projectedDesire.terminalExperience.includes("有效攻防"));
assert.ok(projectedDesire.nonSubstitutableConditions.some((row) => row.includes("单独演示")));
assert.ok(session4.privateContext.profile.domainValuation.martial.goalProgress > 1);

const xieAnchor = findValidatedCharacterAnchorRuntime(XIE);
const xieProfile = getTavernEcologyProfile(XIE);
const xieState = createInitialEcologyState(xieProfile);
const xieInput = v2Input(4);
xieInput.agent = {
  id: XIE,
  name: "谢真石",
  psychologyAnchor: xieAnchor.psychologyAnchor,
  privateState: { ecologyProfile: xieProfile, ecologyState: xieState },
  relationshipContext: [],
  memoryContext: {},
};
xieInput.perceivedCharacters = [{ id: LUO, name: "洛照", zoneId: "hall", identityKnown: true }];
const xieSession = createTavernCharacterAgentV2Session(xieInput);
const conditionalObservation = xieSession.privateContext.desires
  .find((row) => row.desireId === "desire_xiezenshi_continue_observing_verified_high_skill");
assert.equal(conditionalObservation.activationMode, "cue_gated");
assert.equal(conditionalObservation.previousActivation, 0.12);
assert.ok(conditionalObservation.potentialStrength > conditionalObservation.previousActivation);
assert.ok(conditionalObservation.activationDoesNotCount.includes("只听见对方提出过招"));

const runtime = {
  id: "runtime:v24:world",
  locationId: "loc_xyy_tavern",
  topology: TAVERN_SCENE_TOPOLOGY,
  elapsedSeconds: 30,
  step: 4,
  agents: {
    [LUO]: { characterId: LUO, characterName: "洛照", role: "访客", standing: "visitor", zoneId: "hall", present: true },
    [XIE]: { characterId: XIE, characterName: "谢真石", role: "酒馆帮工", standing: "household_worker", zoneId: "hall", present: true },
  },
  sharedActivities: [],
  accessGrants: [],
};

const productionMovementOptions = tavernMovementOptionsForActor(state, runtime, LUO, "hall");
const productionCourtyardOption = productionMovementOptions.find((row) => row.id === "courtyard");
assert.ok(productionCourtyardOption, "an adjacent courtyard remains visible even outside the visit's social scope");
assert.equal(productionCourtyardOption.physicalAccess.targetEffectCurrentlyPossible, true);
assert.equal(productionCourtyardOption.socialAccess.permissionCurrentlyGranted, false);

const persistedIntrusionState = structuredClone(state);
persistedIntrusionState.tavernState.sceneRuntime = {
  agents: { [LUO]: { zoneId: "courtyard" } },
};
const persistedIntrusionRuntime = buildTavernSceneRuntime(persistedIntrusionState, {
  characterIds: [LUO],
  topology: TAVERN_SCENE_TOPOLOGY,
});
assert.equal(
  persistedIntrusionRuntime.agents[LUO].zoneId,
  "courtyard",
  "runtime rebuild must preserve a committed intrusion instead of teleporting the visitor into allowedZoneIds",
);

const normalizationInput = {
  ...v2Input(4),
  privateActionCandidates: [{
    candidateId: "candidate:try-courtyard",
    label: "尝试去后院",
    feasible: true,
    targetCharacterId: "",
    realization: { mode: "move", allowSpeech: true, allowedSpeechActs: [] },
  }],
  recentOwnActions: [],
  openConversationThreads: [],
  ownCommitments: [],
  materialFacts: [],
  perceptionFrame: {},
};
const normalizedAttempt = normalizeTavernCharacterDecision({
  candidateId: "candidate:try-courtyard",
  actionType: "move",
  speechAct: "none",
  targetCharacterId: "",
  speech: "",
  visibleAction: "洛照朝后院门走去",
  moveToZoneId: "courtyard",
  commitmentAction: "none",
  commitmentTopic: "",
  decisionValue: "none",
  cognitiveAppraisal: { noticedEvidenceIds: [], interpretations: [], beliefOperations: [], threadAppraisals: [] },
  communicationPlan: {
    goal: "none",
    tactic: "silence",
    disclosure: "withhold",
    epistemicRelation: "not_applicable",
    intendedAudienceCharacterIds: [],
    desiredEffect: "",
    threadDisposition: "none",
  },
  utterance: { literalSpeech: "", vocalMode: "conversational" },
  embodiedIntent: { manner: "径直", posture: "持剑贴身", intendedGesture: "洛照朝后院门走去" },
  actionAttempt: { primitive: "move", objectId: "", targetCharacterId: "", destinationId: "courtyard", affordanceId: "" },
  privateReason: "想换到不妨碍堂前的地方。",
}, normalizationInput, state, runtime);

assert.equal(normalizedAttempt.actionType, "move", `an unreachable move remains an attempted move, not pass: ${JSON.stringify(normalizedAttempt)}`);
assert.equal(normalizedAttempt.actionAttempt.destinationId, "courtyard");
assert.equal(normalizedAttempt.actionAttemptFailures.some((row) => row.code === "ACTION_ATTEMPT_DESTINATION_UNREACHABLE"), false);

const intrusionAction = {
  id: "action:v24:unpermitted-move",
  actorId: LUO,
  actorName: "洛照",
  actorZoneId: "hall",
  targetCharacterId: "",
  actionType: normalizedAttempt.actionType,
  speech: "",
  visibleAction: normalizedAttempt.visibleAction,
  moveToZoneId: normalizedAttempt.moveToZoneId,
  actionAttempt: normalizedAttempt.actionAttempt,
  actionAttemptFailures: normalizedAttempt.actionAttemptFailures,
  committed: true,
};
intrusionAction.worldResolution = settleFreeActionAttempt(state, runtime, intrusionAction);
assert.equal(intrusionAction.worldResolution.status, "success", "social permission cannot erase an open physical route");
assert.equal(intrusionAction.worldResolution.movementCommitted, true);
assert.ok(intrusionAction.worldResolution.committedFacts.some((row) => row.kind === "social_boundary_crossed_without_permission"));

const failedAction = {
  id: "action:v24:failed-non-adjacent-move",
  actorId: LUO,
  actorName: "洛照",
  actorZoneId: "hall",
  targetCharacterId: "",
  actionType: "move",
  speech: "",
  visibleAction: "洛照试着径直往楼上客房去",
  moveToZoneId: "",
  actionAttempt: { primitive: "move", objectId: "", targetCharacterId: "", destinationId: "guest_room", affordanceId: "" },
  actionAttemptFailures: [],
  committed: true,
};
failedAction.worldResolution = settleFreeActionAttempt(state, runtime, failedAction);
assert.equal(failedAction.worldResolution.status, "failed");
assert.ok(failedAction.worldResolution.failureCodes.includes("MOVEMENT_DESTINATION_NOT_ADJACENT"));
assert.ok(failedAction.worldResolution.committedFacts.some((row) => row.kind === "movement_attempted"));
const failureImpacts = deriveImpactFactorsFromAction(state, runtime, failedAction);
const failureFeedback = failureImpacts.find((row) => row.type === "action_feedback");
assert.ok(failureFeedback, "world failure must become actor-directed perceptible evidence");
const failureDeliveries = deliverImpactFactor(state, runtime, failureFeedback);
assert.deepEqual(failureDeliveries.map((row) => row.recipientId), [LUO]);

const proposal = createCharacterSharedActivityProposal({
  activityId: "activity:v24:mutual-test",
  kind: "mutual-test",
  initiatorId: XIE,
  participantIds: [LUO],
  requestedZoneId: "courtyard",
  sourceActionId: "action:v24:proposal",
});
const accepted = applyCharacterSharedActivityResponse(proposal, {
  responderId: LUO,
  response: "accept",
  sourceActionId: "action:v24:accept",
});

const luoProposal = createCharacterSharedActivityProposal({
  activityId: "activity:v24:luo-proposes-mutual-test",
  kind: "mutual-test",
  initiatorId: LUO,
  participantIds: [XIE],
  requestedZoneId: "courtyard",
  sourceActionId: "action:v24:luo-proposal",
});
const xieCounter = applyCharacterSharedActivityResponse(luoProposal, {
  responderId: XIE,
  response: "counter",
  sourceActionId: "action:v24:xie-counter",
  counter: {
    requestedZoneId: "courtyard",
    boundaries: { intensity: "controlled", propertyProtection: true, harmLimit: "stop-on-yield", note: "" },
  },
});
assert.equal(xieCounter.consentByCharacterId[LUO], "pending");
assert.equal(xieCounter.consentByCharacterId[XIE], "accepted");

const schedulingRuntime = structuredClone(runtime);
schedulingRuntime.sharedActivities = [xieCounter];
schedulingRuntime.actions = [];
schedulingRuntime.impacts = [{
  id: "impact:v24:xie-counter",
  causedByActionId: "action:v24:xie-counter",
  sourceCharacterId: XIE,
  directedTargetId: LUO,
  type: "speech",
  modality: "sound",
  content: "谢真石提出调整条件。",
  topic: "共同活动反提议",
  intensity: 90,
  sourceZoneId: "hall",
  committed: true,
}];
schedulingRuntime.agents[LUO].inbox = [{
  id: "delivery:v24:xie-counter-to-luo",
  impactId: "impact:v24:xie-counter",
  recipientId: LUO,
  impactScore: 90,
  processedAtStep: null,
}];
schedulingRuntime.agents[XIE].inbox = [];
schedulingRuntime.requestLocks = [{
  id: "request:v24:original-proposal",
  threadId: "thread:v24:mutual-test",
  requesterId: LUO,
  responderId: XIE,
  status: "awaiting",
  latestActionId: "action:v24:luo-proposal",
  openedAtStep: 3,
  attempts: 0,
}];
const nextAfterCounter = selectNextCausalAgent(schedulingRuntime, { state, minimumScore: 0 });
assert.equal(nextAfterCounter.characterId, LUO, "a counteroffer schedules the other participant who now owns the decision");
assert.equal(nextAfterCounter.sharedActivityId, xieCounter.activityId);

updateRuntimeConversationLocks(schedulingRuntime, {
  id: "action:v24:xie-counter",
  actorId: XIE,
  targetCharacterId: LUO,
  speech: "换到后院，收着力道，如何？",
  speechAct: "negotiate",
  speechFunctions: ["negotiate"],
  threadDisposition: "counter",
  communicationPlan: { tactic: "redirect", goal: "obtain_information" },
  communicationPlanAuthority: "character-agent",
  sourceThreadId: "thread:v24:mutual-test",
  sharedActivity: {
    operation: "respond",
    activityId: xieCounter.activityId,
    response: "counter",
  },
});
assert.equal(schedulingRuntime.requestLocks[0].status, "resolved", "the original proposal is answered by the counteroffer");
assert.ok(schedulingRuntime.requestLocks.some((row) => (
  row.requesterId === XIE && row.responderId === LUO && row.status === "awaiting"
)), "the revised proposal creates a response obligation in the opposite direction");

const acceptedCounter = applyCharacterSharedActivityResponse(xieCounter, {
  responderId: LUO,
  response: "accept",
  sourceActionId: "action:v24:luo-accepts-counter",
});
assert.equal(acceptedCounter.status, "accepted");
const grant = createScopedCharacterAccessGrant({
  grantId: "grant:v24:courtyard",
  grantorId: XIE,
  authorizedGrantorIds: [XIE],
  beneficiaryIds: [LUO],
  zoneIds: ["courtyard"],
  activity: accepted,
  issuedAtStep: 4,
  expiresAtStep: 8,
});
runtime.sharedActivities = [accepted];
runtime.accessGrants = [grant];
const grantedMove = {
  id: "action:v24:granted-move",
  actorId: LUO,
  actorName: "洛照",
  actorZoneId: "hall",
  actionAttempt: { primitive: "move", objectId: "", targetCharacterId: "", destinationId: "courtyard", affordanceId: "" },
  actionAttemptFailures: [],
  visibleAction: "洛照随谢真石朝后院走去",
};
grantedMove.worldResolution = settleFreeActionAttempt(state, runtime, grantedMove);
assert.equal(grantedMove.worldResolution.status, "success", "accepted scoped access satisfies the social boundary on an already open route");
assert.equal(grantedMove.worldResolution.movementCommitted, true);
assert.equal(grantedMove.worldResolution.committedFacts.some((row) => row.kind === "social_boundary_crossed_without_permission"), false);

const twoPersonSpeech = {
  id: "action:v24:two-person-speech",
  actorId: LUO,
  actorName: "洛照",
  actorZoneId: "hall",
  targetCharacterId: XIE,
  actionType: "speak",
  speechAct: "ask",
  speechFunctions: ["ask"],
  speech: "后院？",
  visibleAction: "",
  committed: true,
  worldResolution: { status: "success", failureCodes: [], violations: [] },
};
const speechImpact = deriveImpactFactorsFromAction(state, runtime, twoPersonSpeech).find((row) => row.type === "speech");
assert.deepEqual(speechImpact.thirdPartyObserverIds, []);
assert.equal(speechImpact.publicness, 0, "the addressed participant is not a third-party audience");
assert.equal(Object.hasOwn(speechImpact, "venueNormPressure"), false,
  "the world must not attach one venue pressure to every character");
assert.deepEqual(speechImpact.socialFactIds, [],
  "an action without referenced social facts must not invent a norm");

const publicAction = publicCommittedAction({
  ...twoPersonSpeech,
  goalPreservation: { privateBasis: "private" },
  speechRealizationPlan: { privatePlan: true },
  sharedActivity: { operation: "respond", activityId: accepted.activityId, boundaries: { private: true } },
  sharedActivityResolution: { status: "success", activity: accepted, accessGrant: grant },
});
assert.equal(Object.hasOwn(publicAction, "goalPreservation"), false);
assert.equal(Object.hasOwn(publicAction, "speechRealizationPlan"), false);
assert.equal(Object.hasOwn(publicAction, "sharedActivity"), false);
assert.equal(publicAction.sharedActivityTransition.activityStatus, "accepted");

console.log(JSON.stringify({
  status: "passed",
  version: "tavern-character-agent-v2.4-world-contract",
  checks: {
    authoredTerminalDesireProjected: true,
    conditionalDesireStartsLatent: true,
    nonSubstitutableContactProjected: true,
    monotonicAgentTurnIdentity: true,
    unpermittedOpenRouteRemainsAttemptable: true,
    committedIntrusionSurvivesRuntimeRebuild: true,
    failedAttemptBecomesDirectedFeedback: true,
    scopedConsentSatisfiesSocialBoundary: true,
    counterofferReturnsDecisionAuthority: true,
    counterofferSchedulesDecisionOwner: true,
    counterofferSupersedesOriginalRequest: true,
    participantNotCountedAsAudience: true,
    venueNormAuthorityRemovedFromWorld: true,
    privateChoiceReasoningNotPublished: true,
  },
}, null, 2));
