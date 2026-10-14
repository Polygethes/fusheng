import assert from "node:assert/strict";

import {
  tavernCharacterAgentV2OutputSchemaForStage,
  tavernCharacterAgentV2SystemPrompt,
  tavernCharacterAgentV2UserPrompt,
} from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { projectTavernSituationV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import {
  computeCharacterActionFeasibilityAssessment,
  evaluateCharacterAgentCandidates,
  validateAgentGeneratedCandidates,
} from "../src/server/simulation/characterPsychologyTools.mjs";
import { createWorldActionRegistry } from "../src/server/simulation/worldActionRegistry.mjs";
import { createWorldCommitCoordinator } from "../src/server/simulation/worldCommitCoordinator.mjs";

const ACTOR = "char:test:actor";
const worldState = {
  worldId: "world:test:action-feasibility",
  worldVersion: 0,
  nowSeconds: 0,
  entities: {
    [ACTOR]: {
      id: ACTOR,
      kind: "character",
      name: "测试人物",
      present: true,
      placeId: "place:test",
      zoneId: "hall",
    },
    "char:test:hidden-owner": {
      id: "char:test:hidden-owner",
      kind: "character",
      name: "不可见的东家",
      present: true,
      placeId: "place:test",
      zoneId: "private-room",
    },
  },
  objects: {
    "object:local-cup": {
      id: "object:local-cup",
      kind: "object",
      label: "手边的杯子",
      placeId: "place:test",
      zoneId: "hall",
      portable: true,
      presentation: { publiclyVisible: true, exposure: "visible" },
    },
    "object:remote-axe": {
      id: "object:remote-axe",
      kind: "object",
      label: "后院的斧子",
      placeId: "place:test",
      zoneId: "courtyard",
      portable: true,
      presentation: { publiclyVisible: true, exposure: "visible" },
    },
  },
  signals: [],
  processes: [],
  sharedActivities: [],
  socialFacts: [],
  places: {
    "place:test": {
      id: "place:test",
      name: "测试地点",
      topology: {
        zones: {
          hall: { id: "hall", label: "堂前" },
          courtyard: { id: "courtyard", label: "后院" },
          "private-room": { id: "private-room", label: "内室" },
        },
        edges: [{ from: "hall", to: "courtyard", move: 1, visual: 1, sound: 1 }],
      },
      socialBoundaries: [{
        id: "social-boundary:test:work-area",
        zoneIds: ["courtyard"],
        permissionRequiredByNorm: true,
        evidenceIds: ["social-fact:test:ownership"],
        claimantIds: ["char:test:hidden-owner", "household:test"],
        possibleResponseTags: ["owner_may_notice", "owner_may_object"],
      }],
      accessGrants: [],
      institution: {},
      perceptionEnvironment: {},
    },
  },
};

const projection = projectTavernSituationV27({
  worldState,
  worldVersion: 0,
  characterId: ACTOR,
  wake: { kind: "opportunity_window", evidence: [] },
});

assert.equal(projection.place.zoneId, "hall");
assert.ok(projection.perceivedObjects.some((row) => row.id === "object:remote-axe"));

const local = projection.actionFeasibilities.find((row) => row.targetHandle === "object:local-cup");
const remote = projection.actionFeasibilities.find((row) => row.targetHandle === "object:remote-axe");
const courtyardMove = projection.actionFeasibilities.find((row) => (
  row.bindingKind === "place" && row.targetHandle === "courtyard"
));
assert.ok(local, "a perceived local object needs a recipient-specific feasibility surface");
assert.ok(remote, "a perceived remote object needs a recipient-specific feasibility surface");
assert.ok(courtyardMove, "a perceived movement option needs its own physical and social feasibility surface");
assert.equal(courtyardMove.directAttempt.currentlyAttemptable, true);
assert.equal(courtyardMove.socialAccess.permissionRequiredByNorm, true);
assert.equal(courtyardMove.socialAccess.permissionCurrentlyGranted, false);
assert.equal(courtyardMove.socialAccess.violationPhysicallyPossible, true);
assert.equal(
  courtyardMove.socialAccess.claimantIds.includes("char:test:hidden-owner"),
  false,
  "recipient-specific social pressure must not reveal an unseen claimant's canonical identity",
);
assert.ok(courtyardMove.socialAccess.claimantIds.includes("household:test"));
assert.equal(local.perceivedSpatialRelation, "co_located");
assert.equal(local.directManipulation.status, "currently_attemptable");
assert.equal(local.directManipulation.currentlyAttemptable, true);
assert.deepEqual(local.directManipulation.missingConditionIds, []);

assert.equal(remote.perceivedSpatialRelation, "visible_remote");
assert.equal(remote.directManipulation.status, "requires_prerequisite");
assert.equal(remote.directManipulation.currentlyAttemptable, false);
assert.deepEqual(remote.directManipulation.missingConditionIds, ["co_located_with_target"]);
assert.equal(remote.knownPrerequisiteOptions.length, 1);
assert.deepEqual(
  {
    primitive: remote.knownPrerequisiteOptions[0].primitive,
    destinationId: remote.knownPrerequisiteOptions[0].destinationId,
    currentlyAttemptable: remote.knownPrerequisiteOptions[0].currentlyAttemptable,
  },
  { primitive: "move", destinationId: "courtyard", currentlyAttemptable: true },
);
assert.equal(remote.knownPrerequisiteOptions[0].socialAccess.permissionRequiredByNorm, true);
assert.equal(remote.selection, null, "the world must not choose the movement prerequisite for the Character Agent");

assert.equal(
  projection.availableAffordances.some((row) => row.kind === "perceived_object"),
  false,
  "seeing an object is a reference, not an executable world affordance",
);
assert.ok(
  projection.perceivedReferences.some((row) => row.kind === "object" && row.targetHandle === "object:remote-axe"),
  "visible targets remain referenceable after affordances and perception are separated",
);

const candidateContext = {
  knownTargetHandles: ["object:remote-axe", "courtyard"],
  knownTargetHandlesByKind: {
    object: ["object:remote-axe"],
    place: ["courtyard"],
  },
  actionFeasibilities: [remote, courtyardMove],
  requireActionFeasibilityHandling: true,
};
const baseCandidate = {
  originAuthority: "character-agent",
  candidateId: "candidate:test",
  intention: "取得后院的斧子",
  attemptPrimitive: "pickup",
  targetHandle: "object:remote-axe",
  actionBinding: {
    kind: "object",
    targetCharacterId: "",
    objectId: "object:remote-axe",
    destinationId: "",
    positionId: "",
    affordanceId: "",
  },
  perceivedPrerequisites: [],
};

const unacknowledgedBoundaryMove = validateAgentGeneratedCandidates([{
  ...baseCandidate,
  candidateId: "candidate:unacknowledged-boundary-move",
  intention: "走进后院看一眼",
  attemptPrimitive: "move",
  targetHandle: "courtyard",
  actionBinding: {
    kind: "place",
    targetCharacterId: "",
    objectId: "",
    destinationId: "courtyard",
    positionId: "",
    affordanceId: "",
  },
  feasibilityHandling: {
    surfaceId: "",
    relationToGoal: "exploratory",
    stance: "not_applicable",
    privateReason: "",
  },
}], candidateContext);
assert.equal(unacknowledgedBoundaryMove.valid, false);
assert.ok(
  unacknowledgedBoundaryMove.errors.some((row) => row.code === "AGENT_CANDIDATE_RELEVANT_FEASIBILITY_OMITTED"),
  "a movement candidate may not hide a known physical/social route surface by calling feasibility irrelevant",
);

const honestBoundaryMove = {
  ...baseCandidate,
  candidateId: "candidate:deliberate-boundary-move",
  intention: "明知是别人家的工作区，仍走进后院确认动静",
  attemptPrimitive: "move",
  targetHandle: "courtyard",
  actionBinding: {
    kind: "place",
    targetCharacterId: "",
    objectId: "",
    destinationId: "courtyard",
    positionId: "",
    affordanceId: "",
  },
  domains: ["observation"],
  expectedEffects: [],
  desireRelations: [],
  criterionUses: [],
  epistemicHandling: {
    positionIds: [],
    mode: "not_relevant",
    errorIfWrong: 0,
    actionReversibility: 0.9,
    learningDuringAction: 0,
    delayCost: 0,
    privateReason: "",
  },
  sharedActivity: {
    operation: "none",
    activityId: "",
    kind: "",
    participantIds: [],
    requestedZoneId: "",
    response: "none",
    boundaries: { intensity: "", propertyProtection: false, harmLimit: "", note: "" },
  },
  factorInputs: {
    emotionCompatibility: 0.5,
    valueAndSelfImage: 0.5,
    relationshipMeaning: 0,
    informationGain: 0.7,
    habitAndIntentionContinuity: 0.4,
    bodyCost: 0.1,
    threatAndNormCost: 0.05,
    exposureAndRelationshipRisk: 0.05,
    opportunityAndSwitchingCost: 0.1,
    uncertaintyCost: 0.2,
  },
  timingIntent: "now",
  uncertainty: 0.2,
  feasibilityHandling: {
    surfaceId: courtyardMove?.feasibilityId || "feasibility:place:courtyard:move",
    relationToGoal: "direct_attempt",
    stance: "deliberate_attempt",
    privateReason: "我知道这一步会越过别人家的工作区边界，仍决定承担可能被看见或阻止的后果。",
  },
};
const boundaryMoveValidation = validateAgentGeneratedCandidates([honestBoundaryMove], candidateContext);
assert.equal(boundaryMoveValidation.valid, true, "the Character may still choose a deliberate social-boundary violation");
const boundaryAssessment = computeCharacterActionFeasibilityAssessment({
  candidate: honestBoundaryMove,
  actionFeasibilities: [remote, courtyardMove],
  profile: {
    personality: { caution: 0.72, selfControl: 0.86, impulsivity: 0.2 },
    domainValuation: { social: { exposureAndRelationshipRisk: 0.63 } },
  },
});
assert.equal(boundaryAssessment.selection, null);
assert.equal(boundaryAssessment.socialAccessAssessment.permissionConflict, true);
assert.ok(boundaryAssessment.socialAccessAssessment.perceivedNormFriction >= 0.7);
assert.ok(boundaryAssessment.socialAccessAssessment.perceivedExposureRisk >= 0.4);
const impulsiveBoundaryAssessment = computeCharacterActionFeasibilityAssessment({
  candidate: honestBoundaryMove,
  actionFeasibilities: [remote, courtyardMove],
  profile: {
    personality: { caution: 0.08, selfControl: 0.12, impulsivity: 0.92 },
    stableDispositionProjection: { socialApprovalNeed: { level: 0.05 } },
  },
});
assert.ok(
  boundaryAssessment.socialAccessAssessment.perceivedNormFriction
    > impulsiveBoundaryAssessment.socialAccessAssessment.perceivedNormFriction,
  "the same known boundary creates different inner friction for differently weighted personalities",
);
const sociallyCalibratedEvaluation = evaluateCharacterAgentCandidates({
  agentTurnId: "agent-turn:social-feasibility-calibration",
  candidates: [honestBoundaryMove],
  snapshot: {
    authority: "character-private-psychology-tool",
    agentTurnId: "agent-turn:social-feasibility-calibration",
    desireActivations: [],
    epistemicPositions: [],
    uncertainty: 0,
  },
  profile: {
    personality: { caution: 0.72, selfControl: 0.86, impulsivity: 0.2 },
    stableDispositionProjection: { socialApprovalNeed: { level: 0.09 } },
    domainValuation: { social: { exposureAndRelationshipRisk: 0.63 } },
  },
  state: {},
  outcomeFeedback: {},
  candidateValidationContext: candidateContext,
});
const calibratedBoundaryRow = sociallyCalibratedEvaluation.evaluations[0];
assert.ok(
  calibratedBoundaryRow.factorVector.find((row) => row.id === "threatAndNormCost").value >= 0.7,
  "objective access information must calibrate the private norm cost even when the candidate under-reports it",
);
assert.equal(calibratedBoundaryRow.actionFeasibilityAssessment.selection, null);
const hiddenSkip = validateAgentGeneratedCandidates([{
  ...baseCandidate,
  feasibilityHandling: {
    surfaceId: remote.feasibilityId,
    relationToGoal: "direct_attempt",
    stance: "follow",
    privateReason: "照着当前条件直接拿。",
  },
}], candidateContext);
assert.equal(hiddenSkip.valid, false);
assert.ok(hiddenSkip.errors.some((row) => row.code === "AGENT_CANDIDATE_KNOWN_PREREQUISITE_SKIPPED"));

const deliberateAttempt = validateAgentGeneratedCandidates([{
  ...baseCandidate,
  feasibilityHandling: {
    surfaceId: remote.feasibilityId,
    relationToGoal: "direct_attempt",
    stance: "deliberate_attempt",
    privateReason: "我怀疑自己对距离的判断，仍要伸手确认；失败由世界保留。",
  },
}], candidateContext);
assert.equal(deliberateAttempt.valid, true, "a Character may knowingly act against perceived feasibility");

const prerequisiteStep = validateAgentGeneratedCandidates([{
  ...baseCandidate,
  candidateId: "candidate:approach-axe",
  intention: "先去后院靠近斧子",
  attemptPrimitive: "move",
  targetHandle: "courtyard",
  actionBinding: {
    kind: "place",
    targetCharacterId: "",
    objectId: "",
    destinationId: "courtyard",
    positionId: "",
    affordanceId: "",
  },
  feasibilityHandling: {
    surfaceId: remote.feasibilityId,
    relationToGoal: "prerequisite_step",
    stance: "deliberate_attempt",
    privateReason: "当前只先满足与目标同区的物理条件，也知道这一步会越过尚未获准的社会边界；拿取仍要等移动结果后再决定。",
  },
}], candidateContext);
assert.equal(prerequisiteStep.valid, true, "the Character may own a feasible first step without precommitting the next action");
const prerequisiteAssessment = computeCharacterActionFeasibilityAssessment({
  candidate: prerequisiteStep.valid ? {
    ...baseCandidate,
    attemptPrimitive: "move",
    actionBinding: { kind: "place", destinationId: "courtyard" },
    feasibilityHandling: {
      surfaceId: remote.feasibilityId,
      relationToGoal: "prerequisite_step",
      stance: "deliberate_attempt",
    },
  } : {},
  actionFeasibilities: [remote, courtyardMove],
});
const deliberateAssessment = computeCharacterActionFeasibilityAssessment({
  candidate: {
    ...baseCandidate,
    feasibilityHandling: {
      surfaceId: remote.feasibilityId,
      relationToGoal: "direct_attempt",
      stance: "deliberate_attempt",
    },
  },
  actionFeasibilities: [remote],
});
assert.equal(prerequisiteAssessment.selection, null);
assert.ok(prerequisiteAssessment.feasibilitySupport > deliberateAssessment.feasibilitySupport);
assert.ok(deliberateAssessment.perceivedFailureRisk > prerequisiteAssessment.perceivedFailureRisk);

const easyButUnrelated = {
  ...baseCandidate,
  candidateId: "candidate:easy-but-unrelated",
  intention: "顺手拿起身边的杯子",
  attemptPrimitive: "pickup",
  targetHandle: "object:local-cup",
  actionBinding: {
    kind: "object",
    targetCharacterId: "",
    objectId: "object:local-cup",
    destinationId: "",
    positionId: "",
    affordanceId: "",
  },
  domains: ["ordinary"],
  expectedEffects: [],
  desireRelations: [],
  criterionUses: [],
  epistemicHandling: {
    positionIds: [],
    mode: "not_relevant",
    errorIfWrong: 0,
    actionReversibility: 1,
    learningDuringAction: 0,
    delayCost: 0,
    privateReason: "",
  },
  sharedActivity: {
    operation: "none",
    activityId: "",
    kind: "",
    participantIds: [],
    requestedZoneId: "",
    response: "none",
    boundaries: { intensity: "", propertyProtection: false, harmLimit: "", note: "" },
  },
  factorInputs: {},
  timingIntent: "now",
  uncertainty: 0,
  feasibilityHandling: {
    surfaceId: local.feasibilityId,
    relationToGoal: "unrelated",
    stance: "follow",
    privateReason: "杯子就在手边，但容易做到不等于值得去做。",
  },
};
const equallyUnrelatedWithoutFeasibilityBonus = {
  ...easyButUnrelated,
  candidateId: "candidate:unrelated-no-surface",
  intention: "保持原处",
  attemptPrimitive: "none",
  targetHandle: "",
  actionBinding: {
    kind: "none",
    targetCharacterId: "",
    objectId: "",
    destinationId: "",
    positionId: "",
    affordanceId: "",
  },
  feasibilityHandling: {
    surfaceId: "",
    relationToGoal: "unrelated",
    stance: "not_applicable",
    privateReason: "",
  },
};
const feasibilityIsNotReward = evaluateCharacterAgentCandidates({
  agentTurnId: "agent-turn:feasibility-is-not-reward",
  candidates: [easyButUnrelated, equallyUnrelatedWithoutFeasibilityBonus],
  snapshot: {
    authority: "character-private-psychology-tool",
    agentTurnId: "agent-turn:feasibility-is-not-reward",
    desireActivations: [],
    epistemicPositions: [],
    uncertainty: 0,
  },
  profile: {},
  state: {},
  outcomeFeedback: {},
  candidateValidationContext: {
    knownTargetHandles: ["object:local-cup"],
    knownTargetHandlesByKind: { object: ["object:local-cup"] },
    actionFeasibilities: [local],
    requireActionFeasibilityHandling: true,
  },
});
const easyEvaluation = feasibilityIsNotReward.evaluations.find((row) => row.candidateId === easyButUnrelated.candidateId);
const neutralEvaluation = feasibilityIsNotReward.evaluations.find((row) => row.candidateId === equallyUnrelatedWithoutFeasibilityBonus.candidateId);
assert.ok(
  easyEvaluation.expectedUtility <= neutralEvaluation.expectedUtility,
  "physical attemptability may lower failure risk, but must not become an independent positive reward for an unrelated action",
);
assert.equal(
  easyEvaluation.factorVector.some((row) => row.id === "feasibilitySupport" && row.polarity === "positive"),
  false,
  "feasibility support belongs to risk assessment rather than desire utility",
);

const candidateSchema = tavernCharacterAgentV2OutputSchemaForStage({
  phase: "awaiting_agent_candidates",
  referenceContract: {
    perceivedActionFeasibilityIds: [remote.feasibilityId],
    perceivedTargetHandles: ["object:remote-axe", "courtyard"],
    perceivedTargetHandlesByBindingKind: candidateContext.knownTargetHandlesByKind,
    ownedEpistemicPositionIds: ["epistemic:test:axe-location"],
  },
});
assert.ok(candidateSchema.properties.candidates.items.required.includes("feasibilityHandling"));
const feasibilityBranches = candidateSchema.properties.candidates.items.properties.feasibilityHandling.anyOf;
assert.equal(feasibilityBranches.length, 2);
assert.deepEqual(feasibilityBranches[0].properties.surfaceId.enum, [""]);
assert.deepEqual(feasibilityBranches[0].properties.stance.enum, ["not_applicable"]);
assert.deepEqual(feasibilityBranches[1].properties.surfaceId.enum, [remote.feasibilityId]);
assert.ok(!feasibilityBranches[1].properties.stance.enum.includes("not_applicable"));
const bindingBranches = candidateSchema.properties.candidates.items.properties.actionBinding.anyOf;
const placeBranch = bindingBranches.find((branch) => branch.properties.kind.enum[0] === "place");
assert.deepEqual(placeBranch.properties.destinationId.enum, ["courtyard"]);
assert.deepEqual(placeBranch.properties.affordanceId.enum, [""]);

const candidatePrompt = tavernCharacterAgentV2SystemPrompt({ phase: "awaiting_agent_candidates" });
const candidateUserPrompt = tavernCharacterAgentV2UserPrompt({
  phase: "awaiting_agent_candidates",
  worldProjection: {
    actionFeasibilities: [remote],
  },
  referenceContract: {
    perceivedActionFeasibilityIds: [remote.feasibilityId],
    perceivedTargetHandles: ["object:remote-axe", "courtyard"],
    perceivedTargetHandlesByBindingKind: candidateContext.knownTargetHandlesByKind,
    ownedEpistemicPositionIds: ["epistemic:test:axe-location"],
  },
});
const choicePrompt = tavernCharacterAgentV2SystemPrompt({ phase: "awaiting_agent_choice_and_regulation" });
assert.match(candidatePrompt, /prerequisite_step/);
assert.match(candidatePrompt, /收到本步客观结果后重新考虑/);
assert.match(candidateUserPrompt, /当前候选阶段的短索引与必填心理工具形状/);
const candidateIndex = JSON.parse(candidateUserPrompt.split("当前候选阶段的短索引与必填心理工具形状：\n")[1]
  .split("\n每一个候选都必须")[0]);
assert.deepEqual(candidateIndex.actionBindingByKind.place, ["courtyard"]);
assert.match(candidateUserPrompt, /"knownPrerequisiteOptions"/);
assert.match(candidateUserPrompt, /"socialAccess"/);
assert.match(candidateUserPrompt, /物理上能走不等于已经获得许可/);
assert.match(candidateUserPrompt, /每一个候选都必须完整填写 feasibilityHandling 与 epistemicHandling/);
assert.match(candidateUserPrompt, /通常只生成 3 至 4 个/);
assert.match(candidateUserPrompt, /当前原子 move 绑定到那个真实可达地点/);
assert.deepEqual(candidateIndex.epistemicPositionId, ["epistemic:test:axe-location"]);
assert.match(candidateUserPrompt, /其余 mode 必须至少逐字引用一个 epistemicPositionId/);
assert.match(candidateUserPrompt, /不得翻译、缩写或猜造 ID/);
assert.match(choicePrompt, /own_action_settled/);
assert.match(choicePrompt, /只保证再次思考，不预选下一动作/);

const choiceUserPrompt = tavernCharacterAgentV2UserPrompt({
  phase: "awaiting_agent_choice_and_regulation",
  generatedCandidates: [{
    candidateId: "candidate:test:move",
    desireRelations: [{ desireId: "desire:test:home-duty" }],
  }],
});
assert.match(choiceUserPrompt, /当前选择阶段的候选—欲望对应索引/);
const choiceIndex = JSON.parse(choiceUserPrompt.split("当前选择阶段的候选—欲望对应索引：\n")[1]
  .split("\n先选择 candidateId")[0]);
assert.deepEqual(choiceIndex.selectableCandidates, [{ candidateId: "candidate:test:move", relatedDesireIds: ["desire:test:home-duty"] }]);
assert.match(choiceUserPrompt, /preservedDesireIds 只能取自所选 candidateId/);

const staleCoordinator = createWorldCommitCoordinator({
  worldId: worldState.worldId,
  initialWorldState: worldState,
  actionRegistry: createWorldActionRegistry(),
});
const interveningMove = await staleCoordinator.submitActionAttempt({
  attemptId: "attempt:actor-leaves-observed-cup",
  actorId: ACTOR,
  primitive: "move",
  expectedWorldVersion: 0,
  payload: { destinationId: "courtyard" },
});
assert.equal(interveningMove.status, "success");
const staleDirectAttempt = await staleCoordinator.submitActionAttempt({
  attemptId: "attempt:pickup-from-stale-feasibility",
  actorId: ACTOR,
  primitive: "handle",
  expectedWorldVersion: 0,
  payload: { objectId: "object:local-cup", operation: "pickup" },
});
assert.equal(local.directManipulation.currentlyAttemptable, true, "the old recipient projection remains an observation, not a guarantee");
assert.equal(staleDirectAttempt.status, "failed");
assert.equal(staleDirectAttempt.revalidatedFromWorldVersion, 0);
assert.ok(staleDirectAttempt.failedEffects.some((row) => row.code === "HANDLE_OBJECT_NOT_REACHABLE"));

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    perceivedAndReachableAreDifferent: true,
    localManipulationIsAttemptable: true,
    remoteManipulationRequiresApproach: true,
    prerequisiteOptionDoesNotSelect: true,
    perceivedReferencesAreNotAffordances: true,
    knownPrerequisiteCannotBeSilentlySkipped: true,
    deliberateMistakeRemainsCharacterOwned: true,
    prerequisiteStepRemainsCharacterOwned: true,
    providerReferencesAreBound: true,
    providerBindingFieldsAreMutuallyExclusive: true,
    providerFeasibilityCitationAndStanceAreCoupled: true,
    psychologyToolCalculatesWithoutSelecting: true,
    physicalEaseIsNotIndependentReward: true,
    movementCarriesKnownSocialAccess: true,
    knownBoundaryCannotBeHiddenAsIrrelevant: true,
    personalityShapesSocialFrictionWithoutSelecting: true,
    deliberateBoundaryViolationRemainsCharacterOwned: true,
    conditionalPlanWaitsForWorldOutcome: true,
    worldRevalidatesStaleFeasibility: true,
  },
}, null, 2));
