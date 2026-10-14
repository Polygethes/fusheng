/**
 * Same-Character-Agent staged turn protocol.
 *
 * This state machine preserves causal order around the private psychology
 * tools. It does not invoke a model and does not resolve the world. Each stage
 * accepts material authored by the same Character Agent, rejects out-of-order
 * submissions, and never normalizes a failed choice into another action.
 */

import { isFirsthandRelationshipEvidence } from "./characterRelationshipEvidence.mjs";
import {
  CHARACTER_CONTINUATION_TRIGGER_TYPES,
  CHARACTER_PSYCHOLOGY_EMOTION_IDS,
  CHARACTER_PSYCHOLOGY_LEAKAGE_CHANNELS,
  CHARACTER_PSYCHOLOGY_TOOLS_VERSION,
  computeCharacterPsychologySnapshot,
  computeCharacterRegulationOutcome,
  deriveDesireCriterionLedger,
  evaluateCharacterAgentCandidates,
  reconcileCharacterPerceivedOutcome,
  validateAgentGeneratedCandidates,
  validateCharacterAgentDecisionV3,
  validateCharacterSubjectiveAppraisal,
} from "./characterPsychologyTools.mjs";
import {
  buildCharacterVoiceResponsibilities,
  resolveCharacterVoiceRegisterId,
} from "./characterVoiceResponsibilities.mjs";
import {
  buildCharacterCommunicationNeedSurface,
  projectSelectedActionForExpression,
} from "./characterSharedContext.mjs";

import { validatePhysicalExpression } from "./physicalExpression.mjs";
import { validWaitCondition } from "./characterExecutionControl.mjs";
import { projectedReplyTargets } from "./characterConversationContinuity.mjs";

export const CHARACTER_AGENT_TURN_PROTOCOL_VERSION = "character-agent-turn-protocol-v2.10";
export const CHARACTER_AGENT_REFERENCE_CONTRACT_VERSION = "character-agent-reference-contract-v3";
export const CHARACTER_AGENT_SUBMISSION_MODES = Object.freeze(["staged", "atomic"]);
export const CHARACTER_AGENT_TWO_CALL_PHASES = Object.freeze([
  "awaiting_subjective_appraisal_and_candidates",
  "awaiting_agent_choice_and_turn_commit",
]);

const CHARACTER_AGENT_SUBMISSION_MODE_SET = new Set(CHARACTER_AGENT_SUBMISSION_MODES);

const PUBLIC_INTERACTION_MOVES = new Set([
  "none", "initiate", "respond", "ask", "answer", "acknowledge", "offer", "refuse",
  "evade", "counter", "redirect", "mislead", "tease", "warn", "soothe", "close", "silence",
]);
const SHARED_CONTEXT_TREATMENTS = new Set([
  "not_applicable", "accept_as_given", "reopen_to_clarify", "question_memory",
  "challenge_truth", "tease", "deceive", "misremembered", "confabulated",
]);
const AUTOMATIC_COMMUNICATION_IMPULSE_MODES = new Set(["speech", "silence", "nonverbal", "mixed", "none"]);
const IMPULSE_TRANSFORMATIONS = new Set(["express", "mask", "redirect", "delay", "withhold", "blend", "not_applicable"]);
const ATOMIC_PUBLIC_EXPRESSION_MODES = new Set(["speech", "nonverbal", "mixed", "silence"]);
const ATOMIC_EXPRESSION_TIMINGS = new Set(["before_action", "during_action", "after_action", "standalone", "delayed", "silence"]);
const ATOMIC_POST_TURN_DISPOSITIONS = new Set(["no_thread", "keep_resumable", "close_for_self"]);
const ATOMIC_AFFECTIVE_INFLUENCE_MODES = new Set([
  "no_live_influence", "shape_wording", "shape_timing", "shape_action",
  "leak_publicly", "contained_privately", "displaced",
]);

export const CHARACTER_AGENT_TURN_PHASES = Object.freeze([
  "awaiting_subjective_appraisal",
  "awaiting_agent_candidates",
  "awaiting_agent_turn_commit",
  "awaiting_agent_choice_and_regulation",
  "awaiting_agent_expression_planning",
  "awaiting_agent_realization",
  "ready_for_world_resolution",
  "world_resolved",
]);

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clone(value) {
  return structuredClone(value);
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function protocolError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function assertSession(session) {
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    throw protocolError("CHARACTER_AGENT_TURN_SESSION_REQUIRED", "A Character Agent turn session is required.");
  }
  if (session.schemaVersion !== CHARACTER_AGENT_TURN_PROTOCOL_VERSION) {
    throw protocolError("CHARACTER_AGENT_TURN_VERSION_MISMATCH", "Unknown Character Agent turn protocol version.");
  }
}

function assertPhase(session, expected) {
  assertSession(session);
  if (session.phase !== expected) {
    throw protocolError(
      "CHARACTER_AGENT_TURN_PHASE_VIOLATION",
      `Expected phase ${expected}, received ${session.phase}.`,
      { expectedPhase: expected, actualPhase: session.phase },
    );
  }
}

function evidenceIdsFromProjection(worldProjection = {}) {
  return unique([
    ...(worldProjection.evidence || []).map((row) => row?.evidenceId || row?.id),
    ...(worldProjection.perceivedImpacts || []).map((row) => row?.evidenceId || row?.impactId || row?.id),
    ...(worldProjection.perceptionFrame?.noticedEvidence || []).map((row) => row?.evidenceId || row?.id),
  ]);
}

function evidenceRowId(row = {}) {
  return clean(row.evidenceId || row.noticedEvidenceId || row.id || row.impactId);
}

function appraisalEvidenceReferences(value, path = "subjectiveAppraisal", output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    value.forEach((row, index) => appraisalEvidenceReferences(row, `${path}[${index}]`, output));
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (Array.isArray(child) && /(?:evidence)ids$/iu.test(key)) {
      for (const reference of unique(child)) output.push({ reference, path: childPath });
    } else appraisalEvidenceReferences(child, childPath, output);
  }
  return output;
}

/**
 * Stage 1 receives physically delivered evidence candidates. Once the same
 * Character Agent has reported what it actually noticed, every later stage
 * receives only that subset. The unobserved deliveries remain in the private
 * receipt/checkpoint path, but cannot silently influence candidates, choice or
 * realization in this turn.
 */
function noticedWorldProjection(session = {}) {
  const projection = clone(session.worldProjection || {});
  if (!session.subjectiveAppraisal) return projection;
  const noticed = new Set(unique(session.subjectiveAppraisal.noticedEvidenceIds || []));
  const keep = (row) => noticed.has(evidenceRowId(row));
  projection.evidence = (projection.evidence || []).filter(keep);
  projection.perceivedImpacts = (projection.perceivedImpacts || []).filter(keep);
  if (projection.perceptionFrame && typeof projection.perceptionFrame === "object") {
    projection.perceptionFrame.noticedEvidence = (projection.perceptionFrame.noticedEvidence || []).filter(keep);
  }
  if (projection.activation && !keep(projection.activation)) projection.activation = null;
  if (projection.discourseContext && typeof projection.discourseContext === "object") {
    projection.discourseContext.currentEvidence = (projection.discourseContext.currentEvidence || []).filter(keep);
  }
  return projection;
}

function targetHandlesFromProjection(worldProjection = {}) {
  return unique([
    ...(worldProjection.perceivedCharacters || []).map((row) => row?.perceivedEntityHandle || row?.id || row?.handle),
    ...(worldProjection.perceivedObjects || []).map((row) => row?.perceivedObjectHandle || row?.id || row?.handle),
    // Places the character can physically reach and neutral occupiable guest
    // positions are world targets an action may legitimately bind to — not
    // only people and objects.
    ...(worldProjection.reachableZones || []).map((row) => row?.id || row?.zoneId),
    worldProjection.scene?.zoneId,
    ...(worldProjection.institution?.guestPositions || []).map((row) => row?.id),
    ...(worldProjection.affordances || []).map((row) => row?.id),
    ...(worldProjection.ownedWorldProcesses || []).map((row) => row?.id),
  ]);
}

function targetHandlesByBindingKind(worldProjection = {}) {
  const perceivedObjects = worldProjection.perceivedObjects || [];
  return {
    character: characterHandlesFromProjection(worldProjection),
    object: unique(perceivedObjects
      .filter((row) => clean(row?.kind) !== "position")
      .map((row) => row?.perceivedObjectHandle || row?.id || row?.handle)),
    place: unique([
      ...(worldProjection.reachableZones || []).map((row) => row?.id || row?.zoneId),
      worldProjection.scene?.zoneId,
    ]),
    position: unique([
      ...perceivedObjects
        .filter((row) => clean(row?.kind) === "position")
        .map((row) => row?.perceivedObjectHandle || row?.id || row?.handle),
      ...(worldProjection.institution?.guestPositions || []).map((row) => row?.id),
    ]),
    affordance: unique([
      ...(worldProjection.affordances || []).map((row) => row?.id),
      ...(worldProjection.availableAffordances || []).map((row) => row?.id),
    ]),
  };
}

function characterHandlesFromProjection(worldProjection = {}) {
  return unique((worldProjection.perceivedCharacters || [])
    .map((row) => row?.perceivedEntityHandle || row?.id || row?.handle));
}

export function characterAgentOwnedPsychologicalSourceIds(privateContext = {}) {
  return unique([
    ...(privateContext.desires || []).map((row) => row?.desireId || row?.id),
    ...(privateContext.values || []).map((row) => row?.valueId || row?.id),
    ...(privateContext.selfSchemas || []).map((row) => row?.schemaId || row?.id),
    ...(privateContext.relationships || []).map((row) => row?.relationshipId || row?.id),
    ...(privateContext.memoryContext?.episodes || []).map((row) => row?.id),
    ...(privateContext.memoryContext?.beliefs || []).map((row) => row?.id),
    ...(privateContext.memoryContext?.commitments || []).map((row) => row?.id),
  ]);
}

function characterDesireCriterionLedger(privateContext = {}) {
  const desires = privateContext.desires || [];
  const declared = desires.flatMap((desire) => Array.isArray(desire?.criterionLedger) ? desire.criterionLedger : []);
  const derived = deriveDesireCriterionLedger(desires);
  const byId = new Map();
  for (const row of [...derived, ...declared]) {
    const criterionId = clean(row?.criterionId);
    if (!criterionId) continue;
    byId.set(criterionId, clone(row));
  }
  return [...byId.values()];
}

function criterionIdsByDesire(privateContext = {}) {
  const result = {};
  for (const row of characterDesireCriterionLedger(privateContext)) {
    const desireId = clean(row?.desireId);
    const criterionId = clean(row?.criterionId);
    if (!desireId || !criterionId) continue;
    if (!result[desireId]) result[desireId] = [];
    if (!result[desireId].includes(criterionId)) result[desireId].push(criterionId);
  }
  return result;
}

function currentConcernCriterionIds(subjectiveAppraisal = {}) {
  return unique((subjectiveAppraisal.desireGroundings || []).flatMap((grounding) => (
    (grounding?.promotedCriteria || [])
      .filter((promotion) => clean(promotion?.mode) === "current_concern")
      .map((promotion) => promotion?.criterionId)
  )));
}

function buildCharacterAgentReferenceContract(session = {}) {
  const worldProjection = noticedWorldProjection(session);
  const ownedDesireIds = unique((session.privateContext?.desires || []).map((row) => row?.desireId || row?.id));
  const ownedDesireCriterionIds = characterDesireCriterionLedger(session.privateContext).map((row) => row.criterionId);
  const discourseAnchorIds = unique(worldProjection.discourseContext?.anchorIds || []);
  const knownEntityHandles = unique((session.privateContext?.knownEntityReferences || [])
    .map((row) => row?.knownEntityHandle));
  const ownedEpistemicPositionIds = unique((session.subjectiveAppraisal?.epistemicPositions || [])
    .map((row) => row?.positionId));
  const sharedActivityLifecycle = (worldProjection.sharedActivities || []).map((row) => ({
    activityId: clean(row?.activityId),
    kind: clean(row?.kind),
    status: clean(row?.status),
    participantIds: unique(row?.participantIds || []),
    ownConsent: clean(row?.consentByCharacterId?.[session.characterId]),
  })).filter((row) => row.activityId);
  const perceivedActionFeasibilityIds = unique((worldProjection.actionFeasibilities || [])
    .map((row) => row?.feasibilityId));
  return {
    schemaVersion: CHARACTER_AGENT_REFERENCE_CONTRACT_VERSION,
    authority: "character-agent-reference-contract",
    ownedPsychologicalSourceIds: characterAgentOwnedPsychologicalSourceIds(session.privateContext),
    ownedDesireIds,
    ownedDesireCriterionIds,
    currentConcernCriterionIds: currentConcernCriterionIds(session.subjectiveAppraisal || {}),
    ownedEpistemicPositionIds,
    sharedActivityLifecycle,
    perceivedActionFeasibilityIds,
    perceivedEvidenceIds: evidenceIdsFromProjection(worldProjection),
    perceivedTargetHandles: targetHandlesFromProjection(worldProjection),
    perceivedTargetHandlesByBindingKind: targetHandlesByBindingKind(worldProjection),
    perceivedCharacterHandles: characterHandlesFromProjection(worldProjection),
    knownEntityHandles,
    discourseAnchorIds,
    fieldBindings: {
      "relevanceLinks[].sourceId": "ownedPsychologicalSourceIds",
      "desireGroundings[].desireId": "ownedDesireIds",
      "desireGroundings[].activationEvidenceIds[]": "perceivedEvidenceIds",
      "desireGroundings[].activationPsychologicalSourceIds[]": "ownedPsychologicalSourceIds",
      "desireGroundings[].promotedCriteria[].criterionId": "ownedDesireCriterionIds",
      "desireGroundings[].promotedCriteria[].basisEvidenceIds[]": "perceivedEvidenceIds",
      "desireGroundings[].promotedCriteria[].basisPsychologicalSourceIds[]": "ownedPsychologicalSourceIds",
      "expectedEffects[].sourceId": "ownedPsychologicalSourceIds",
      "desireRelations[].desireId": "ownedDesireIds",
      "criterionUses[].desireId": "ownedDesireIds",
      "criterionUses[].criterionId": "currentConcernCriterionIds",
      "interpretations[].evidenceIds": "perceivedEvidenceIds",
      "beliefOperations[].sourceEvidenceIds": "perceivedEvidenceIds",
      "epistemicPositions[].subjectHandle": "perceivedTargetHandles",
      "epistemicPositions[].basisEvidenceIds[]": "perceivedEvidenceIds",
      "epistemicPositions[].basisPsychologicalSourceIds[]": "ownedPsychologicalSourceIds",
      "entityModelUpdates[].perceivedEntityHandle": "perceivedCharacterHandles",
      "entityModelUpdates[].identityCandidates[].knownEntityHandle": "knownEntityHandles",
      "locationBeliefUpdates[].subjectHandle": "perceivedCharacterHandles|knownEntityHandles",
      "sourceKnowledgeBeliefUpdates[].sourceHandle": "perceivedCharacterHandles|knownEntityHandles",
      "sourceKnowledgeBeliefUpdates[].subjectHandle": "knownEntityHandles",
      "priorActionOutcomeAppraisal.noticedOutcomeEvidenceIds[]": "perceivedEvidenceIds",
      "perceivedPrerequisites[]": "perceivedEvidenceIds",
      "feasibilityHandling.surfaceId": "perceivedActionFeasibilityIds",
      "epistemicHandling.positionIds[]": "ownedEpistemicPositionIds",
      "sharedActivity.activityId": "new id for propose, existing sharedActivityLifecycle id for all other operations",
      targetHandle: "perceivedTargetHandles",
      "continuationIntentions[].linkedSourceIds[]": "ownedPsychologicalSourceIds",
      "continuationIntentions[].targetHandle": "perceivedTargetHandles",
      "goalPreservation.preservedDesireIds[]": "ownedDesireIds",
      "automaticCommunicationImpulse.triggerEvidenceIds[]": "perceivedEvidenceIds",
      "automaticCommunicationImpulse.discourseAnchorIds[]": "discourseAnchorIds",
      "automaticCommunicationImpulse.motiveSourceIds[]": "ownedPsychologicalSourceIds",
      "automaticCommunicationImpulse.conflict.opposingSourceIds[]": "ownedPsychologicalSourceIds",
      "regulatedExpressionPlan.publicStance.sharedContextAnchorIds[]": "discourseAnchorIds",
      "turnCommit.privateChoice.goalPreservation.preservedDesireIds[]": "ownedDesireIds",
      "turnCommit.privateChoice.continuationIntentions[].linkedSourceIds[]": "ownedPsychologicalSourceIds",
      "turnCommit.privateChoice.continuationIntentions[].targetHandle": "perceivedTargetHandles",
      "turnCommit.publicExpression.audienceCharacterIds[]": "perceivedCharacterHandles",
    },
    criterionSemantics: {
      currentConcernBlocksAction: false,
      characterMayActWithUncertainty: true,
      rule: "current_concern makes a terminal condition available to candidates; it is not a prerequisite and does not require the Character to resolve it before acting",
    },
    sharedActivitySemantics: {
      ordinaryConversationCreatesActivity: false,
      acceptedActivityMustNotBeRenegotiated: true,
      rule: "Use the existing activity id and its next legal lifecycle operation; do not propose the same live agreement again.",
    },
    worldReferenceRule: "World evidence, affordance, obligation, resource, object, location, and process ids are materials for appraisal, not owned psychological source ids.",
  };
}

function historyEntry(stage, payloadId = "") {
  return { stage, payloadId: clean(payloadId) };
}

function realizationWorldSurface(worldProjection = {}) {
  return {
    authority: "recipient-specific-realization-surface",
    temporalContext: clone(worldProjection.temporalContext || {}),
    ownTimeExperience: clone(worldProjection.ownTimeExperience || {}),
    scene: clone(worldProjection.scene || {}),
    evidence: clone((worldProjection.evidence || []).slice(-8)),
    perceivedImpacts: clone((worldProjection.perceivedImpacts || []).slice(-8)),
    perceivedCharacters: clone(worldProjection.perceivedCharacters || []),
    perceivedObjects: clone(worldProjection.perceivedObjects || []),
    affordances: clone(worldProjection.affordances || []),
    serviceChoice: clone(worldProjection.serviceChoice || null),
    materialFacts: clone(worldProjection.materialFacts || []),
    settledInteractionEvents: clone(worldProjection.settledInteractionEvents || []),
    discourseContext: clone(worldProjection.discourseContext || {}),
    reachableZones: clone(worldProjection.reachableZones || []),
    openConversationThreads: clone((worldProjection.openConversationThreads || []).slice(-6)),
    recentOwnActions: clone((worldProjection.recentOwnActions || []).slice(-4)),
    ownCommitments: clone((worldProjection.ownCommitments || []).slice(-6)),
    institution: clone(worldProjection.institution || {}),
    socialContext: clone(worldProjection.socialContext || {}),
    currentResponsibilities: clone(worldProjection.currentResponsibilities || null),
    sharedActivities: clone(worldProjection.sharedActivities || []),
    ongoingOwnActivities: clone(worldProjection.ongoingOwnActivities || []),
    accessGrants: clone(worldProjection.accessGrants || []),
    recentFailedAttempts: clone(worldProjection.recentFailedAttempts || []),
  };
}

function boundedRelevantMemoryContext(memoryContext = {}) {
  return {
    episodes: clone((memoryContext.episodes || []).slice(-8)),
    beliefs: clone((memoryContext.beliefs || []).slice(-8)),
    commitments: clone((memoryContext.commitments || []).slice(-6)),
    selfNarrative: clone(memoryContext.selfNarrative || null),
  };
}

function characterPreverbalGroundingSurface(session = {}) {
  const worldProjection = session.worldProjection || {};
  const privateContext = session.privateContext || {};
  return {
    authority: "character-private-preverbal-grounding-surface",
    scene: clone(worldProjection.scene || {}),
    evidence: clone((worldProjection.evidence || []).slice(-8)),
    perceivedImpacts: clone((worldProjection.perceivedImpacts || []).slice(-8)),
    perceivedCharacters: clone(worldProjection.perceivedCharacters || []),
    perceivedObjects: clone(worldProjection.perceivedObjects || []),
    materialFacts: clone(worldProjection.materialFacts || []),
    settledInteractionEvents: clone(worldProjection.settledInteractionEvents || []),
    discourseContext: clone(worldProjection.discourseContext || {}),
    openConversationThreads: clone((worldProjection.openConversationThreads || []).slice(-6)),
    recentOwnActions: clone((worldProjection.recentOwnActions || []).slice(-4)),
    ownCommitments: clone((worldProjection.ownCommitments || []).slice(-6)),
    socialContext: clone(worldProjection.socialContext || {}),
    currentResponsibilities: clone(worldProjection.currentResponsibilities || null),
    sharedActivities: clone(worldProjection.sharedActivities || []),
    ongoingOwnActivities: clone(worldProjection.ongoingOwnActivities || []),
    relationshipContext: clone(privateContext.relationships || []),
    bodyState: clone(privateContext.state?.body || {}),
    voiceDisposition: clone(privateContext.voiceContract || {}),
    relevantMemoryContext: boundedRelevantMemoryContext(privateContext.memoryContext || {}),
  };
}

function characterSituationalGrounding(session = {}) {
  const worldProjection = noticedWorldProjection(session);
  const privateContext = session.privateContext || {};
  const lived = privateContext.livedSituation || {};
  return {
    authority: "character-private-situational-grounding",
    temporalContext: clone(worldProjection.temporalContext || {}),
    ownTimeExperience: clone(worldProjection.ownTimeExperience || {}),
    scene: clone(worldProjection.scene || {}),
    role: clean(lived.role),
    standing: clean(lived.standing),
    currentIntention: clean(lived.currentIntention),
    currentResponsibilities: clone(lived.currentResponsibilities || worldProjection.currentResponsibilities || null),
    currentActivities: clone(lived.currentActivities || worldProjection.ongoingOwnActivities || []),
    ownCommitments: clone(lived.ownCommitments || worldProjection.ownCommitments || []),
    recentOwnActions: clone(lived.recentOwnActions || worldProjection.recentOwnActions || []),
    activePlanProjection: clone(lived.activePlanProjection || null),
    relationshipContext: clone(privateContext.relationships || []),
    bodyState: clone(privateContext.state?.body || {}),
    projectionRule: "Existing scene and Character-owned continuity only; this surface does not infer motives, choose actions, or prewrite speech.",
  };
}

function cognitivePrivateContext(privateContext = {}) {
  const { voiceContract: _voiceContract, ...cognitive } = clone(privateContext || {});
  return cognitive;
}

function candidatePrivateContext(privateContext = {}) {
  const source = privateContext || {};
  return {
    authority: "character-private-candidate-context-projection",
    profile: clone(source.profile || {}),
    state: clone(source.state || {}),
    priorActionOutcomeContext: clone(source.priorActionOutcomeContext || {}),
    desires: clone(source.desires || []),
    values: clone(source.values || []),
    selfSchemas: clone(source.selfSchemas || []),
    relationships: clone(source.relationships || []),
    knownEntityReferences: clone(source.knownEntityReferences || []),
    memoryContext: boundedRelevantMemoryContext(source.memoryContext || {}),
    livedSituation: clone(source.livedSituation || {}),
    projectionRule: "The durable private foundation remains on the Character Actor. Candidate generation receives only the appraised situation, operational profile, relevant memory, relationships, and lived responsibilities; this projection does not rewrite or delete durable state.",
  };
}

function choiceAppraisalSurface(appraisal = {}) {
  return {
    ownerAuthority: clean(appraisal.ownerAuthority),
    appraisalId: clean(appraisal.appraisalId),
    agentTurnId: clean(appraisal.agentTurnId),
    desireGroundings: clone(appraisal.desireGroundings || []),
    epistemicPositions: clone(appraisal.epistemicPositions || []),
    appraisalAxes: clone(appraisal.appraisalAxes || {}),
    uncertainty: Number(appraisal.uncertainty || 0),
    threadAppraisals: clone(appraisal.threadAppraisals || []),
    relationshipAppraisal: clone(appraisal.relationshipAppraisal || null),
    priorActionOutcomeAppraisal: clone(appraisal.priorActionOutcomeAppraisal || null),
    authority: "character-private-choice-relevant-appraisal-projection",
    projectionRule: "Interpretation prose and belief-update writebacks remain durable on the Character Actor; choice receives their evaluated pressures and unresolved positions without a second full copy.",
  };
}

function unitValue(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function selectedRelationship(session = {}) {
  const targetId = clean(realizationSelectedAction(session).targetHandle);
  return (session.privateContext?.relationships || []).find((row) => (
    clean(row?.otherCharacterId || row?.toCharacterId || row?.targetCharacterId) === targetId
  )) || null;
}

function atomicVoiceResponsibilityLayers(session = {}) {
  const relationship = selectedRelationship(session);
  const body = session.privateContext?.state?.body || {};
  const emotionPeak = Math.max(0, ...(session.psychologySnapshot?.emotionMixture || [])
    .map((row) => unitValue(row?.value ?? row?.intensity)));
  const tension = unitValue(relationship?.publicPressure?.tension ?? relationship?.tension);
  const voiceContract = session.privateContext?.voiceContract || {};
  const selectedAction = realizationSelectedAction(session);
  const relationshipRegisterId = resolveCharacterVoiceRegisterId({
    voiceContract,
    relationship,
    candidateDomains: selectedAction.domains || [],
  });
  return buildCharacterVoiceResponsibilities({
    voiceContract,
    voiceFoundation: voiceContract.voiceFoundation || {},
    cognitiveState: {
      noticedEvidenceIds: clone(session.subjectiveAppraisal?.noticedEvidenceIds || []),
      activeAttentionTargets: clone(session.subjectiveAppraisal?.activeAttentionTargets || []),
      uncertainty: Number(session.subjectiveAppraisal?.uncertainty || 0),
    },
    roleSkillProfile: {
      competenceModel: clone(session.privateContext?.psychologyAnchor?.competenceModel || {}),
    },
    regulationOutcome: clone(session.regulationOutcome || {}),
    context: {
      pressure: Math.max(
        emotionPeak,
        tension,
        unitValue(session.psychologySnapshot?.affectSummary?.arousal),
      ),
      closeness: unitValue(relationship?.publicPressure?.closeness ?? relationship?.closeness),
      fatigue: unitValue(body.fatigue ?? body.fatigueLoad ?? body.exhaustion),
      relationshipRegisterId,
    },
  });
}

function qualitativeBand(value = 0) {
  const numeric = unitValue(value);
  if (numeric >= 0.78) return "very_high";
  if (numeric >= 0.62) return "high";
  if (numeric >= 0.38) return "medium";
  if (numeric >= 0.18) return "low";
  return "very_low";
}

function qualitativeDimension(dimension = {}) {
  if (clean(dimension?.band)) return clean(dimension.band);
  return qualitativeBand(dimension?.value);
}

function literalTurnSurface(worldProjection = {}) {
  return (worldProjection.discourseContext?.recentPublicTurns || [])
    .filter((row) => clean(row?.utterance))
    .slice(-8)
    .map((row) => ({
      speakerId: clean(row.speakerId),
      addresseeId: clean(row.addresseeId),
      utterance: clean(row.utterance),
      directed: row.directed === true,
      occurredAtSeconds: Number(row.occurredAtSeconds || 0),
    }));
}

function livedRelationshipSurface(session = {}) {
  const targetId = clean(realizationSelectedAction(session).targetHandle);
  const relationship = selectedRelationship(session);
  if (!targetId || !relationship) return null;
  const closeness = relationship?.publicPressure?.closeness
    ?? relationship?.closeness
    ?? relationship?.familiarity;
  const tension = relationship?.publicPressure?.tension ?? relationship?.tension;
  const trust = relationship?.trust;
  return {
    otherCharacterId: targetId,
    label: clean(relationship.label),
    allowedAddresses: unique(relationship.allowedAddresses || []),
    closeness: qualitativeBand(closeness),
    tension: qualitativeBand(tension),
    ...(Number.isFinite(Number(trust)) ? { trust: qualitativeBand(Number(trust) > 1 ? Number(trust) / 100 : trust) } : {}),
  };
}

function activeWantSurface(session = {}) {
  const preserved = new Set(unique(session.agentChoice?.goalPreservation?.preservedDesireIds || []));
  const relevanceBySourceId = new Map((session.subjectiveAppraisal?.relevanceLinks || []).map((row) => [
    clean(row?.sourceId),
    unitValue(row?.strength),
  ]).filter(([sourceId]) => sourceId));
  return (session.subjectiveAppraisal?.desireGroundings || [])
    .filter((row) => !preserved.size || preserved.has(clean(row?.desireId)))
    .filter((row) => ["active", "urgent"].includes(clean(row?.activationState)) || Number(row?.immediatePull || 0) >= 0.2)
    // A durable desire may remain strong without being what this particular
    // moment is about. The wording stage receives only desires the same Agent
    // appraised as materially relevant now; otherwise a remote wound or life
    // goal leaks into ordinary service, self-identification and small talk.
    .filter((row) => {
      const desireId = clean(row?.desireId);
      return !relevanceBySourceId.has(desireId) || Number(relevanceBySourceId.get(desireId) || 0) >= 0.25;
    })
    .slice(0, 4)
    .map((row) => ({
      feltWant: clean(row.feltWant),
      terminalExperience: clean(row.terminalExperience),
    }))
    .filter((row) => row.feltWant || row.terminalExperience);
}

function affectiveResidueSurface(session = {}) {
  const residualEmotion = (session.regulationOutcome?.residualEmotion || [])
    .filter((row) => Number(row?.value || 0) > 0)
    .sort((left, right) => Number(right?.value || 0) - Number(left?.value || 0))
    .slice(0, 5)
    .map((row) => ({
      emotionId: clean(row.emotionId),
      intensity: qualitativeBand(row.value),
    }));
  const channelPressures = Object.entries(session.regulationOutcome?.channelLeakagePressures || {})
    .filter(([, value]) => Number(value || 0) >= 0.08)
    .sort(([, left], [, right]) => Number(right || 0) - Number(left || 0))
    .slice(0, 6)
    .map(([channelId, value]) => ({ channelId, pressure: qualitativeBand(value) }));
  return {
    liveEmotions: residualEmotion,
    possibleLeakageChannels: channelPressures,
    remainingControl: qualitativeBand(session.regulationOutcome?.remainingControl),
    regulationCost: qualitativeBand(session.regulationOutcome?.regulationCost),
  };
}

function voiceDeliverySurface(responsibilities = {}) {
  const surface = responsibilities.voiceSurface || {};
  return {
    wording: {
      directness: qualitativeDimension(surface.wording?.directness),
      compression: qualitativeDimension(surface.wording?.compression),
      warmth: qualitativeDimension(surface.wording?.warmth),
      reserve: qualitativeDimension(surface.wording?.reserve),
      precision: qualitativeDimension(surface.wording?.technicalPrecision),
      toneTags: unique(surface.wording?.toneTags || []),
    },
    rhythm: {
      fatigueDrag: qualitativeDimension(surface.rhythm?.fatigueDrag),
      pauseTendency: qualitativeDimension(surface.rhythm?.pauseTendency),
      tendencyTags: unique(surface.rhythm?.tendencyTags || []),
    },
    relationshipRegister: {
      registerId: clean(surface.relationshipDistance?.registerId),
      distanceLabel: clean(surface.relationshipDistance?.distanceLabel),
      adjustmentTags: unique(surface.register?.surfaceAdjustmentTags || []),
    },
    emotionalLeakage: {
      overall: qualitativeDimension(surface.emotionalLeakageTendency?.overall),
      onset: qualitativeDimension(surface.emotionalLeakageTendency?.voiceOnset),
      prosody: qualitativeDimension(surface.emotionalLeakageTendency?.prosody),
      tempo: qualitativeDimension(surface.emotionalLeakageTendency?.tempo),
      pause: qualitativeDimension(surface.emotionalLeakageTendency?.pause),
    },
  };
}

function characterOwnedExpressionMoment(session = {}, voiceResponsibilities = {}) {
  const worldProjection = noticedWorldProjection(session);
  const lived = session.privateContext?.livedSituation || {};
  const impulse = session.agentChoice?.automaticCommunicationImpulse || {};
  const selectedAction = realizationSelectedAction(session);
  return {
    authority: "character-owned-expression-moment",
    scene: clone(worldProjection.scene || {}),
    livedContinuity: {
      role: clean(lived.role),
      standing: clean(lived.standing),
      currentIntention: clean(lived.currentIntention),
      currentResponsibilities: clone(lived.currentResponsibilities || worldProjection.currentResponsibilities || null),
      currentActivities: clone(lived.currentActivities || worldProjection.ongoingOwnActivities || []),
      ownCommitments: clone(lived.ownCommitments || worldProjection.ownCommitments || []),
      recentOwnActions: clone((lived.recentOwnActions || worldProjection.recentOwnActions || []).slice(-5)),
      bodyState: clone(session.privateContext?.state?.body || {}),
    },
    presentPerception: {
      evidence: clone((worldProjection.evidence || []).slice(-8)),
      perceivedImpacts: clone((worldProjection.perceivedImpacts || []).slice(-8)),
      perceivedCharacters: clone(worldProjection.perceivedCharacters || []),
      perceivedObjects: clone(worldProjection.perceivedObjects || []),
    },
    conversationAnchors: clone(worldProjection.conversationAnchors || {
      authority: "character-private-conversation-anchor-projection",
      anchors: [],
      selection: null,
    }),
    recentLiteralTurns: literalTurnSurface(worldProjection),
    relationshipExperience: livedRelationshipSurface(session),
    innerContinuity: {
      activeWants: activeWantSurface(session),
      preRegulationImpulse: {
        mode: clean(impulse.mode),
        feltTendency: clean(impulse.feltTendency),
        conflictPresent: impulse.conflict?.present === true,
        conflict: clean(impulse.conflict?.description),
      },
      affectiveResidue: affectiveResidueSurface(session),
    },
    voiceDelivery: voiceDeliverySurface(voiceResponsibilities),
    languageUse: clone(session.privateContext?.voiceContract?.languageUse || {}),
    expressionProtocol: clone(session.privateContext?.expressionProtocol || {}),
    lockedAction: {
      primitive: clean(selectedAction.attemptPrimitive),
      targetCharacterId: clean(selectedAction.targetHandle),
      actionBinding: clone(selectedAction.actionBinding || null),
      sharedActivity: clone(selectedAction.sharedActivity || null),
      timingIntent: clean(selectedAction.timingIntent),
    },
    allowedAudienceCharacterIds: characterHandlesFromProjection(worldProjection),
  };
}

function atomicPreverbalGroundingSurface(session = {}) {
  const { voiceDisposition: _voiceDisposition, ...grounding } = characterPreverbalGroundingSurface(session);
  return grounding;
}

function expressionAffectiveContext(snapshot = {}) {
  return {
    authority: "character-private-affective-context",
    emotionMixture: clone(snapshot.emotionMixture || []),
    affectSummary: clone(snapshot.affectSummary || {}),
    actionTendencies: clone(snapshot.actionTendencies || {}),
    controlCapacity: Number(snapshot.controlCapacity || 0),
    cognitiveLoad: Number(snapshot.cognitiveLoad || 0),
    uncertainty: Number(snapshot.uncertainty || 0),
  };
}

function realizationSelectedAction(session = {}, { includeIntention = false } = {}) {
  const selected = session.generatedCandidates.find((row) => row.candidateId === session.agentChoice?.selectedCandidateId) || {};
  return projectSelectedActionForExpression({
    candidateId: clean(selected.candidateId),
    // The candidate's own free-text intention travels into expression
    // planning, where the public move is shaped. It stops before the wording
    // stage: realization inherits the locked primitive, binding and the
    // plan's actionIntent instead of a recitable candidate brief.
    ...(includeIntention ? { intention: clean(selected.intention) } : {}),
    attemptPrimitive: clean(selected.attemptPrimitive),
    targetHandle: clean(selected.targetHandle),
    actionBinding: clone(selected.actionBinding || null),
    domains: unique(selected.domains || []),
    sharedActivity: clone(selected.sharedActivity || null),
    timingIntent: clean(selected.timingIntent),
  });
}

function communicationNeedSurface(session = {}) {
  const selected = session.generatedCandidates.find((row) => row.candidateId === session.agentChoice?.selectedCandidateId) || {};
  return buildCharacterCommunicationNeedSurface({
    characterId: session.characterId,
    selectedAction: selected,
    worldProjection: noticedWorldProjection(session),
    automaticCommunicationImpulse: session.agentChoice?.automaticCommunicationImpulse || {},
  });
}

function realizationRegulationSurface(regulationOutcome = {}) {
  return {
    authority: "character-private-regulation-surface",
    sourceRegulationChoiceId: clean(regulationOutcome.sourceRegulationChoiceId),
    residualEmotion: clone(regulationOutcome.residualEmotion || []),
    channelLeakagePressures: clone(regulationOutcome.channelLeakagePressures || {}),
    remainingControl: Number(regulationOutcome.remainingControl || 0),
    regulationCost: Number(regulationOutcome.regulationCost || 0),
  };
}

function characterAffectiveExpressionSurface(session = {}) {
  const outcome = session.regulationOutcome || {};
  const pressures = outcome.channelLeakagePressures || {};
  const priorCarryover = session.privateContext?.state?.priorRegulationCarryover || {};
  return {
    authority: "character-private-affective-expression-tool",
    channels: CHARACTER_PSYCHOLOGY_LEAKAGE_CHANNELS
      .map((channelId) => ({
        channelId,
        pressure: unitValue(pressures[channelId]),
      }))
      .filter((row) => row.pressure >= 0.08)
      .sort((left, right) => right.pressure - left.pressure)
      .slice(0, 8),
    remainingControl: unitValue(outcome.remainingControl),
    regulationCost: unitValue(outcome.regulationCost),
    reboundPressure: unitValue(priorCarryover.reboundPressure),
    controlDepletion: unitValue(priorCarryover.controlDepletion),
    selection: null,
    rule: "These are post-regulation pressures available to this Character Agent. They do not choose containment, wording, timing, action, public leakage, or silence.",
  };
}

function realizationExpressionSurface(regulatedExpressionPlan = {}) {
  const plan = regulatedExpressionPlan && typeof regulatedExpressionPlan === "object"
    ? regulatedExpressionPlan
    : {};
  const stance = plan.publicStance || {};
  return {
    ownerAuthority: clean(plan.ownerAuthority),
    sourceImpulseId: clean(plan.sourceImpulseId),
    impulseTreatment: clean(plan.impulseTransformation?.treatment || "not_applicable"),
    mode: clean(plan.mode),
    actionIntent: clean(plan.actionIntent),
    publicStance: {
      interactionMove: clean(stance.interactionMove || "none"),
      releasedMeaning: clean(stance.releasedMeaning),
      audienceCharacterIds: unique(stance.audienceCharacterIds || []),
      disclosure: clean(stance.disclosure || "withhold"),
      epistemicRelation: clean(stance.epistemicRelation || "not_applicable"),
      intendedEffect: clean(stance.intendedEffect),
      threadDisposition: clean(stance.threadDisposition || "none"),
      sharedContextAnchorIds: unique(stance.sharedContextAnchorIds || []),
      sharedContextTreatment: clean(stance.sharedContextTreatment || "not_applicable"),
    },
    nonverbalUndertone: clean(plan.nonverbalUndertone),
    privateRemainder: {
      present: plan.privateRemainderPresent === true,
      rule: "Only the existence of private remainder is visible. Do not reconstruct or state its contents.",
    },
    relationshipStance: clean(plan.relationshipStance),
    timing: clean(plan.timing),
    turnYield: clean(plan.turnYield),
  };
}

/** Create one logical turn. `worldProjection` must already be recipient-specific. */
export function createCharacterAgentTurnSession({
  agentTurnId,
  characterId,
  submissionMode = "staged",
  worldProjection = {},
  privateContext = {},
} = {}) {
  if (!clean(agentTurnId)) throw protocolError("CHARACTER_AGENT_TURN_ID_REQUIRED", "Character Agent turn id is required.");
  if (!clean(characterId)) throw protocolError("CHARACTER_AGENT_ID_REQUIRED", "Character id is required.");
  const normalizedSubmissionMode = clean(submissionMode) || "staged";
  if (!CHARACTER_AGENT_SUBMISSION_MODE_SET.has(normalizedSubmissionMode)) {
    throw protocolError(
      "CHARACTER_AGENT_SUBMISSION_MODE_INVALID",
      `Unknown Character Agent submission mode ${normalizedSubmissionMode}.`,
    );
  }
  return {
    schemaVersion: CHARACTER_AGENT_TURN_PROTOCOL_VERSION,
    psychologyToolsVersion: CHARACTER_PSYCHOLOGY_TOOLS_VERSION,
    agentTurnId: clean(agentTurnId),
    characterId: clean(characterId),
    submissionMode: normalizedSubmissionMode,
    phase: "awaiting_subjective_appraisal",
    worldProjection: clone(worldProjection),
    privateContext: clone(privateContext),
    subjectiveAppraisal: null,
    priorActionOutcomeFeedback: null,
    psychologySnapshot: null,
    generatedCandidates: [],
    candidateEvaluation: null,
    agentChoice: null,
    regulationOutcome: null,
    regulatedExpressionPlan: null,
    turnCommit: null,
    publicCommit: null,
    finalDecision: null,
    worldOutcome: null,
    history: [historyEntry("created", agentTurnId)],
  };
}

/** Build the stage-specific private input for the same Character Agent. */
export function buildCharacterAgentStageInput(session) {
  assertSession(session);
  const common = {
    schemaVersion: CHARACTER_AGENT_TURN_PROTOCOL_VERSION,
    agentTurnId: session.agentTurnId,
    characterId: session.characterId,
    submissionMode: session.submissionMode || "staged",
    phase: session.phase,
    choiceAuthority: {
      owner: "character-agent",
      mathematicsRole: "private-psychological-state-and-evaluation",
      worldRole: "recipient-specific-signals-affordances-time-and-consequences",
      rule: "the same Character Agent appraises, generates candidates, chooses regulation, chooses action, embodies and speaks",
    },
    referenceContract: buildCharacterAgentReferenceContract(session),
    situationalGrounding: characterSituationalGrounding(session),
  };
  if (session.phase === "awaiting_subjective_appraisal") {
    return {
      ...common,
      worldProjection: clone(session.worldProjection),
      privateContext: cognitivePrivateContext(session.privateContext),
      requestedOutput: "subjective_appraisal_only",
    };
  }
  if (session.phase === "awaiting_agent_candidates") {
    return {
      ...common,
      worldProjection: noticedWorldProjection(session),
      privateContext: candidatePrivateContext(session.privateContext),
      subjectiveAppraisal: clone(session.subjectiveAppraisal),
      psychologySnapshot: clone(session.psychologySnapshot),
      requestedOutput: "character_generated_candidates_only",
      rule: "world affordances are materials, not a closed candidate menu",
    };
  }
  if (session.phase === "awaiting_agent_turn_commit") {
    const voiceResponsibilities = atomicVoiceResponsibilityLayers(session);
    const {
      referenceContract: _referenceContract,
      situationalGrounding: _situationalGrounding,
      choiceAuthority: _choiceAuthority,
      ...atomicCommon
    } = common;
    return {
      ...atomicCommon,
      actionReferenceOptions: targetHandlesByBindingKind(noticedWorldProjection(session)),
      expressionMoment: characterOwnedExpressionMoment(session, voiceResponsibilities),
      requestedOutput: "character_turn_commit_only",
      rule: "the same Character Agent already chose the action. Live through expressionMoment and submit the literal public beat in this character's own voice. Inner material is felt continuity, not a proposition list. Persistent posture, possession and object state stay in the world and need no restatement",
    };
  }
  if (session.phase === "awaiting_agent_choice_and_regulation") {
    return {
      ...common,
      subjectiveAppraisal: choiceAppraisalSurface(session.subjectiveAppraisal || {}),
      psychologySnapshot: clone(session.psychologySnapshot),
      generatedCandidates: clone(session.generatedCandidates),
      candidateEvaluation: clone(session.candidateEvaluation),
      impulseGroundingSurface: characterPreverbalGroundingSurface(session),
      requestedOutput: "selected_candidate_regulation_and_automatic_impulse_only",
      rule: "predicted tendency is not a command; any owned candidate may be selected, and the automatic communication impulse is this Character Agent's pre-regulation tendency rather than a line of dialogue",
    };
  }
  if (session.phase === "awaiting_agent_expression_planning") {
    return {
      ...common,
      selectedAction: realizationSelectedAction(session, { includeIntention: true }),
      automaticCommunicationImpulse: clone(session.agentChoice?.automaticCommunicationImpulse || null),
      regulationSurface: realizationRegulationSurface(session.regulationOutcome),
      affectiveContext: expressionAffectiveContext(session.psychologySnapshot),
      preverbalGroundingSurface: characterPreverbalGroundingSurface(session),
      communicationNeedSurface: communicationNeedSurface(session),
      requestedOutput: "regulated_expression_plan_only",
      rule: "the same Character Agent now transforms, withholds, redirects, delays or expresses its own automatic impulse after seeing the actual regulation residue; do not write literal dialogue or change the selected action",
    };
  }
  if (session.phase === "awaiting_agent_realization") {
    return {
      ...common,
      worldSurface: realizationWorldSurface(noticedWorldProjection(session)),
      selectedAction: realizationSelectedAction(session),
      regulatedExpressionPlan: realizationExpressionSurface(session.regulatedExpressionPlan || null),
      regulationSurface: realizationRegulationSurface(session.regulationOutcome),
      communicationNeedSurface: communicationNeedSurface(session),
      voiceContract: clone(session.privateContext.voiceContract || {}),
      requestedOutput: "character_realization_only",
      rule: "realize the already chosen public move in this character's body and voice; do not reconstruct or publicly summarize the hidden reasoning that produced it; the world outcome remains unknown",
    };
  }
  if (session.phase === "ready_for_world_resolution") {
    if ((session.submissionMode || "staged") === "atomic") {
      return {
        schemaVersion: CHARACTER_AGENT_TURN_PROTOCOL_VERSION,
        agentTurnId: session.agentTurnId,
        characterId: session.characterId,
        submissionMode: "atomic",
        phase: session.phase,
        publicCommit: clone(session.publicCommit),
        requestedOutput: "world_resolution_only",
      };
    }
    return {
      ...common,
      finalDecision: clone(session.finalDecision),
      requestedOutput: "world_resolution_only",
    };
  }
  return {
    ...common,
    finalDecision: clone(session.finalDecision),
    worldOutcome: clone(session.worldOutcome),
    requestedOutput: "none",
  };
}

/**
 * Build the first optional two-call envelope. Appraisal and candidates remain
 * two causal submissions: the same Character Agent merely authors them in one
 * provider response. The protocol will still validate and apply appraisal
 * before it validates candidates, so unnoticed evidence and unowned sources
 * cannot bypass the normal boundary.
 */
export function buildCharacterAgentAppraisalAndCandidatesStageInput(session) {
  assertPhase(session, "awaiting_subjective_appraisal");
  const input = buildCharacterAgentStageInput(session);
  return {
    ...input,
    phase: CHARACTER_AGENT_TWO_CALL_PHASES[0],
    requestedOutput: "subjective_appraisal_and_character_candidates",
    combinedSubmissionContract: {
      ownerAuthority: "character-agent",
      causalOrder: ["subjective_appraisal", "agent_candidates"],
      candidateEvidenceRule: "Every candidate may use only evidence listed in the sibling appraisal.noticedEvidenceIds.",
      candidateEpistemicRule: "Candidate epistemic position ids may refer only to positions authored in the sibling appraisal.epistemicPositions.",
      candidateCriterionRule: "Candidate criterion uses may refer only to criteria promoted as current_concern in the sibling appraisal.desireGroundings.",
      localValidationOrder: "accept appraisal, compute psychology snapshot, validate candidates, compute candidate evaluation",
      selectionAuthority: "character-agent-in-the-next-provider-call",
    },
  };
}

/**
 * Build the second optional two-call envelope after local candidate scoring.
 * Each candidate gets a bounded expression context so the Character can make
 * one holistic choice/commit without receiving another raw private ledger.
 * The actual regulation outcome is still computed locally from the submitted
 * choice before the paired commit is accepted or reaches world resolution.
 */
export function buildCharacterAgentChoiceAndTurnCommitStageInput(session) {
  assertPhase(session, "awaiting_agent_choice_and_regulation");
  const input = buildCharacterAgentStageInput(session);
  const candidateCommitContexts = (session.generatedCandidates || []).map((candidate) => {
    const candidateSession = {
      ...session,
      agentChoice: {
        selectedCandidateId: clean(candidate?.candidateId),
        goalPreservation: { preservedDesireIds: [] },
        automaticCommunicationImpulse: null,
      },
      regulationOutcome: null,
    };
    return {
      candidateId: clean(candidate?.candidateId),
      selectedAction: realizationSelectedAction(candidateSession),
      expressionMoment: characterOwnedExpressionMoment(
        candidateSession,
        atomicVoiceResponsibilityLayers(candidateSession),
      ),
    };
  });
  return {
    ...input,
    phase: CHARACTER_AGENT_TWO_CALL_PHASES[1],
    requestedOutput: "character_choice_regulation_and_turn_commit",
    worldSurface: realizationWorldSurface(noticedWorldProjection(session)),
    voiceContract: clone(session.privateContext.voiceContract || {}),
    candidateCommitContexts,
    combinedSubmissionContract: {
      ownerAuthority: "character-agent",
      causalOrder: ["agent_choice_and_regulation", "local_regulation_outcome", "agent_turn_commit", "world_resolution"],
      candidateEvaluationAuthority: clean(session.candidateEvaluation?.authority),
      candidateEvaluationSelection: session.candidateEvaluation?.selection ?? null,
      rule: "Choose one owned candidate after reading candidateEvaluation. The local psychology tool then computes regulation residue from this response's regulationChoice before the paired commit is validated. Mathematics evaluates and constrains; it never selects or rewrites the Character's action or words.",
      repairRule: "If choice fails, resubmit {choice, turnCommit}. If choice succeeds but commit fails, that choice is locked: the next phase is awaiting_agent_turn_commit and accepts only the standalone commit object. Always follow the new stage's phase and schema. No rejected public expression is a world event.",
    },
  };
}

/**
 * Working memory is delta-encoded on the wire only. The Character may carry an
 * unchanged prior position forward by id instead of restating it verbatim; that
 * is an explicit retention, not an omission. Expanding here — before any
 * validation — keeps every downstream consumer looking at one complete list, so
 * the "a still-perceived open position may never silently vanish" rule is
 * enforced against the same shape it always was.
 */
const EPISTEMIC_POSITION_FULL_FIELDS = Object.freeze([
  "proposition", "confidence", "status", "workingStance", "relianceScope",
  "basisEvidenceIds", "basisPsychologicalSourceIds", "privateReason",
]);

export function expandRetainedEpistemicPositions(appraisal = {}, priorPositions = [], perceivedTargetHandles = null, currentSourceIds = null) {
  const authored = [...(appraisal?.epistemicPositions || [])];
  if (appraisal.epistemicPositionUpdateMode === "retain_unmentioned") {
    const authoredIds = new Set(authored.map(row => clean(row.positionId)));
    const authoredSlots = new Set(authored.map(row => `${clean(row.domain)}::${clean(row.subjectHandle)}`));
    const perceived = perceivedTargetHandles === null ? null : new Set(perceivedTargetHandles);
    for (const prior of priorPositions) {
      if (perceived && !perceived.has(clean(prior.subjectHandle))) continue;
      if (authoredIds.has(clean(prior.positionId)) || authoredSlots.has(`${clean(prior.domain)}::${clean(prior.subjectHandle)}`)) continue;
      authored.push({ positionId: prior.positionId, domain: prior.domain, subjectHandle: prior.subjectHandle, carriedUnchanged: true });
    }
  }
  if (!authored.some((row) => row?.carriedUnchanged === true)) return appraisal;
  const priorById = new Map(
    (priorPositions || [])
      .map((row) => [clean(row?.positionId), row])
      .filter(([id]) => id),
  );
  const issues = [];
  const expanded = authored.map((row, index) => {
    if (row?.carriedUnchanged !== true) return row;
    const positionId = clean(row?.positionId);
    const prior = priorById.get(positionId);
    if (!prior) {
      issues.push({
        code: "CHARACTER_AGENT_EPISTEMIC_POSITION_CARRIED_UNKNOWN",
        path: `epistemicPositions[${index}].positionId`,
        message: `Position ${positionId} was never carried over, so it cannot be marked carriedUnchanged.`,
      });
      return row;
    }
    if (clean(row?.domain) !== clean(prior?.domain)
      || clean(row?.subjectHandle) !== clean(prior?.subjectHandle)) {
      issues.push({
        code: "CHARACTER_AGENT_EPISTEMIC_POSITION_CARRIED_MISMATCH",
        path: `epistemicPositions[${index}]`,
        message: `Position ${positionId} is carried unchanged but its domain or subject differs from the position it claims to continue.`,
      });
      return row;
    }
    // Hydrate from the prior turn. Anything the Character actually restated
    // still wins, so an accidental partial rewrite cannot be silently
    // overwritten by stale carryover.
    // basisEvidenceIds records evidence used in THIS appraisal. Retention is
    // not a new observation of the prior turn's evidence. Preserve the belief
    // and its owned psychological sources without manufacturing fresh notice.
    // An explicitly restated basis below still goes through normal validation.
    const hydrated = { ...clone(prior), basisEvidenceIds: [] };
    // A bounded memory projection can age out a cited source while retaining
    // the Character's position. Keep its judgment, but do not automatically
    // reintroduce unavailable references into this turn's source contract.
    // The prior journal is untouched; explicitly authored fields below still
    // win and undergo normal validation, including unknown-source rejection.
    if (currentSourceIds !== null) {
      const available = new Set(currentSourceIds);
      hydrated.basisPsychologicalSourceIds = (hydrated.basisPsychologicalSourceIds || [])
        .filter(sourceId => available.has(clean(sourceId)));
    }
    for (const [key, value] of Object.entries(row)) {
      if (key === "carriedUnchanged") continue;
      if (value !== undefined) hydrated[key] = value;
    }
    return hydrated;
  });
  const incomplete = expanded
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row?.carriedUnchanged !== true)
    .filter(({ row }) => EPISTEMIC_POSITION_FULL_FIELDS.some((key) => row?.[key] === undefined));
  for (const { index } of incomplete) {
    issues.push({
      code: "CHARACTER_AGENT_EPISTEMIC_POSITION_INCOMPLETE",
      path: `epistemicPositions[${index}]`,
      message: "A position that is not carried unchanged must state every field in full.",
    });
  }
  if (issues.length) {
    throw protocolError(
      "CHARACTER_AGENT_APPRAISAL_REJECTED",
      "Character Agent carried epistemic positions failed the carryover audit.",
      { issues },
    );
  }
  return {
    ...appraisal,
    epistemicPositions: expanded.map(({ carriedUnchanged, ...rest }) => rest),
  };
}

/** Accept appraisal, then run the private psychology tool before candidates exist. */
export function submitCharacterSubjectiveAppraisal(session, submittedAppraisal) {
  assertPhase(session, "awaiting_subjective_appraisal");
  const appraisal = expandRetainedEpistemicPositions(
    submittedAppraisal,
    session.privateContext.state?.priorRegulationCarryover?.epistemicPositions || [],
    targetHandlesFromProjection(session.worldProjection),
    characterAgentOwnedPsychologicalSourceIds(session.privateContext),
  );
  const desireCriterionLedger = characterDesireCriterionLedger(session.privateContext);
  const validation = validateCharacterSubjectiveAppraisal(appraisal, {
    agentTurnId: session.agentTurnId,
    knownEvidenceIds: evidenceIdsFromProjection(noticedWorldProjection(session)),
    knownTargetHandles: targetHandlesFromProjection(session.worldProjection),
    knownTargetHandlesByBindingKind: targetHandlesByBindingKind(session.worldProjection),
    knownSourceIds: characterAgentOwnedPsychologicalSourceIds(session.privateContext),
    knownDesireIds: (session.privateContext.desires || []).map((row) => row?.desireId || row?.id),
    knownCriterionIds: desireCriterionLedger.map((row) => row.criterionId),
    desireCriterionLedger,
    criterionIdsByDesire: criterionIdsByDesire(session.privateContext),
    desires: session.privateContext.desires || [],
    requireDesireGrounding: true,
    requireEpistemicPositions: true,
    priorEpistemicPositions: clone(
      session.privateContext.state?.priorRegulationCarryover?.epistemicPositions || [],
    ),
    priorActionForecast: session.privateContext.state?.priorRegulationCarryover?.pendingActionForecast || null,
  });
  const relationship = appraisal?.relationshipAppraisal || {};
  const relationshipIssues = [];
  const evidenceReferenceIssues = [];
  const knownAppraisalEvidenceIds = new Set(evidenceIdsFromProjection(session.worldProjection));
  const noticedAppraisalEvidenceIds = new Set(unique(appraisal?.noticedEvidenceIds || []));
  for (const { reference, path } of appraisalEvidenceReferences(appraisal)) {
    if (!knownAppraisalEvidenceIds.has(reference)) {
      evidenceReferenceIssues.push({
        code: "CHARACTER_AGENT_APPRAISAL_EVIDENCE_UNKNOWN",
        path,
        message: `Subjective appraisal references evidence that was not delivered to this Character Agent: ${reference}.`,
      });
    } else if (!noticedAppraisalEvidenceIds.has(reference)) {
      evidenceReferenceIssues.push({
        code: "CHARACTER_AGENT_APPRAISAL_EVIDENCE_NOT_NOTICED",
        path,
        message: `Subjective appraisal may use only evidence this Character Agent reported noticing: ${reference}.`,
      });
    }
  }
  const changeMode = clean(relationship.changeMode || "none");
  const targetCharacterId = clean(relationship.targetCharacterId);
  const dimensionChanges = Array.isArray(relationship.dimensionChanges) ? relationship.dimensionChanges : [];
  const sourceImpactIds = unique(relationship.sourceImpactIds || []);
  const knownRelationshipTargets = new Set(buildCharacterAgentReferenceContract(session).perceivedCharacterHandles || []);
  const knownRelationshipSources = new Set([
    ...(session.worldProjection.evidence || []).flatMap((row) => [
      evidenceRowId(row), row?.impactId, row?.eventId, row?.id,
    ]),
    ...(session.worldProjection.perceivedImpacts || []).flatMap((row) => [
      evidenceRowId(row), row?.impactId, row?.eventId, row?.id,
    ]),
  ].map(clean).filter(Boolean));
  if (changeMode === "none" && dimensionChanges.length) {
    relationshipIssues.push({
      code: "CHARACTER_AGENT_RELATIONSHIP_NONE_WITH_CHANGES",
      path: "relationshipAppraisal.dimensionChanges",
      message: "A no-change relationship appraisal cannot declare relationship dimension changes.",
    });
  }
  if (changeMode !== "none") {
    if (!targetCharacterId || !knownRelationshipTargets.has(targetCharacterId)) {
      relationshipIssues.push({
        code: "CHARACTER_AGENT_RELATIONSHIP_TARGET_REQUIRED",
        path: "relationshipAppraisal.targetCharacterId",
        message: "A provisional or retained relationship appraisal needs one actually perceived target handle.",
      });
    }
    if (!sourceImpactIds.length || sourceImpactIds.some((id) => !knownRelationshipSources.has(id))) {
      relationshipIssues.push({
        code: "CHARACTER_AGENT_RELATIONSHIP_SOURCE_REQUIRED",
        path: "relationshipAppraisal.sourceImpactIds",
        message: "A provisional or retained relationship appraisal needs a source impact this Character actually received.",
      });
    }
    if (!dimensionChanges.length) {
      relationshipIssues.push({
        code: "CHARACTER_AGENT_RELATIONSHIP_CHANGE_REQUIRED",
        path: "relationshipAppraisal.dimensionChanges",
        message: "A provisional or retained relationship appraisal needs at least one explicit relationship dimension change; otherwise use changeMode none and keep the impression in entityModelUpdates.",
      });
    }
    if (changeMode === "retained") {
      const sources = new Set(sourceImpactIds);
      const firsthand = [...(session.worldProjection.evidence || []), ...(session.worldProjection.perceivedImpacts || [])]
        .some(row => [evidenceRowId(row), row.impactId, row.eventId, row.id].some(id => sources.has(clean(id)))
          && isFirsthandRelationshipEvidence(row, targetCharacterId));
      if (!firsthand) relationshipIssues.push({ code: "CHARACTER_AGENT_RELATIONSHIP_FIRSTHAND_REQUIRED",
        path: "relationshipAppraisal.sourceImpactIds", message: "A retained relationship change requires personally received evidence about its perceived target." });
    }
  }
  const appraisalIssues = [...(validation.errors || []), ...relationshipIssues, ...evidenceReferenceIssues];
  if (!validation.valid || relationshipIssues.length || evidenceReferenceIssues.length) {
    throw protocolError(
      "CHARACTER_AGENT_APPRAISAL_REJECTED",
      "Character Agent subjective appraisal failed authority or evidence validation.",
      { issues: appraisalIssues },
    );
  }
  const priorActionOutcomeFeedback = reconcileCharacterPerceivedOutcome({
    appraisal,
    previous: session.privateContext.state?.priorRegulationCarryover || {},
    profile: session.privateContext.profile || {},
    worldProjection: session.worldProjection,
  });
  const psychologySnapshot = computeCharacterPsychologySnapshot({
    agentTurnId: session.agentTurnId,
    appraisal,
    profile: session.privateContext.profile || {},
    state: session.privateContext.state || {},
    desires: session.privateContext.desires || [],
    outcomeFeedback: priorActionOutcomeFeedback,
  });
  return {
    ...clone(session),
    phase: "awaiting_agent_candidates",
    subjectiveAppraisal: clone(appraisal),
    psychologySnapshot,
    priorActionOutcomeFeedback,
    history: [...session.history, historyEntry("subjective_appraisal_accepted", appraisal.appraisalId)],
  };
}

/** Accept only candidates authored by the same Character Agent, then evaluate. */
export function submitCharacterAgentCandidates(session, candidates) {
  assertPhase(session, "awaiting_agent_candidates");
  const desireCriterionLedger = characterDesireCriterionLedger(session.privateContext);
  const candidateValidationContext = {
    agentTurnId: session.agentTurnId,
    supportedAttemptPrimitives: session.worldProjection.supportedAttemptPrimitives,
    availableAffordances: session.worldProjection.affordances || [],
    knownEvidenceIds: evidenceIdsFromProjection(noticedWorldProjection(session)),
    knownTargetHandles: targetHandlesFromProjection(session.worldProjection),
    knownTargetHandlesByKind: targetHandlesByBindingKind(session.worldProjection),
    currentZoneId: clean(session.worldProjection.scene?.zoneId),
    adjacentZoneIds: unique((session.worldProjection.reachableZones || [])
      .filter((row) => clean(row?.physicalAccess?.relation) === "adjacent")
      .map((row) => row?.id || row?.zoneId)),
    knownSourceIds: characterAgentOwnedPsychologicalSourceIds(session.privateContext),
    knownDesireIds: (session.privateContext.desires || []).map((row) => row?.desireId || row?.id),
    knownCriterionIds: desireCriterionLedger.map((row) => row.criterionId),
    criterionIdsByDesire: criterionIdsByDesire(session.privateContext),
    currentConcernCriterionIds: currentConcernCriterionIds(session.subjectiveAppraisal || {}),
    knownEpistemicPositionIds: unique((session.subjectiveAppraisal?.epistemicPositions || []).map((row) => row?.positionId)),
    epistemicPositions: clone(session.subjectiveAppraisal?.epistemicPositions || []),
    characterId: session.characterId,
    sharedActivities: clone(noticedWorldProjection(session).sharedActivities || []),
    actionFeasibilities: clone(noticedWorldProjection(session).actionFeasibilities || []),
    requireActionFeasibilityHandling: (noticedWorldProjection(session).actionFeasibilities || []).length > 0,
    enforceSharedActivityLifecycle: true,
    requireDesireRelations: true,
    requireCriterionUses: true,
    requireEpistemicHandling: true,
  };
  const validation = validateAgentGeneratedCandidates(candidates, candidateValidationContext);
  if (!validation.valid) {
    throw protocolError(
      "CHARACTER_AGENT_CANDIDATES_REJECTED",
      "Character Agent candidates failed authority or source validation.",
      { issues: validation.errors },
    );
  }
  const candidateEvaluation = evaluateCharacterAgentCandidates({
    agentTurnId: session.agentTurnId,
    candidates,
    snapshot: session.psychologySnapshot,
    profile: session.privateContext.profile || {},
    state: session.privateContext.state || {},
    outcomeFeedback: session.priorActionOutcomeFeedback || {},
    candidateValidationContext,
  });
  return {
    ...clone(session),
    phase: "awaiting_agent_choice_and_regulation",
    generatedCandidates: clone(candidates),
    candidateEvaluation,
    history: [...session.history, historyEntry("agent_candidates_accepted", `${candidates.length}`)],
  };
}

function validateAutomaticCommunicationImpulse(session, impulse) {
  const errors = [];
  if (!impulse || typeof impulse !== "object" || Array.isArray(impulse)) {
    return [{ code: "CHARACTER_AGENT_AUTOMATIC_IMPULSE_MISSING", path: "automaticCommunicationImpulse", message: "Choice needs the Character Agent's automatic pre-regulation communication impulse." }];
  }
  if (impulse.ownerAuthority !== "character-agent") {
    errors.push({ code: "CHARACTER_AGENT_AUTOMATIC_IMPULSE_AUTHORITY_INVALID", path: "automaticCommunicationImpulse.ownerAuthority", message: "Only the Character Agent may author its automatic communication impulse." });
  }
  if (!clean(impulse.impulseId)) {
    errors.push({ code: "CHARACTER_AGENT_AUTOMATIC_IMPULSE_ID_MISSING", path: "automaticCommunicationImpulse.impulseId", message: "Automatic communication impulse needs an id." });
  }
  const mode = clean(impulse.mode);
  if (!AUTOMATIC_COMMUNICATION_IMPULSE_MODES.has(mode)) {
    errors.push({ code: "CHARACTER_AGENT_AUTOMATIC_IMPULSE_MODE_INVALID", path: "automaticCommunicationImpulse.mode", message: "Unknown automatic communication impulse mode." });
  }
  const knownEvidenceIds = new Set(evidenceIdsFromProjection(noticedWorldProjection(session)));
  if (!Array.isArray(impulse.triggerEvidenceIds)) {
    errors.push({ code: "CHARACTER_AGENT_AUTOMATIC_IMPULSE_EVIDENCE_MISSING", path: "automaticCommunicationImpulse.triggerEvidenceIds", message: "Automatic impulse needs zero or more actually perceived trigger evidence ids." });
  }
  for (const evidenceId of unique(impulse.triggerEvidenceIds || [])) {
    if (knownEvidenceIds.size && !knownEvidenceIds.has(evidenceId)) {
      errors.push({ code: "CHARACTER_AGENT_AUTOMATIC_IMPULSE_EVIDENCE_UNKNOWN", path: "automaticCommunicationImpulse.triggerEvidenceIds", message: `Unknown perceived evidence ${evidenceId}.` });
    }
  }
  const knownAnchorIds = new Set(buildCharacterAgentReferenceContract(session).discourseAnchorIds || []);
  if (!Array.isArray(impulse.discourseAnchorIds)) {
    errors.push({ code: "CHARACTER_AGENT_AUTOMATIC_IMPULSE_ANCHORS_MISSING", path: "automaticCommunicationImpulse.discourseAnchorIds", message: "Automatic impulse needs zero or more shared-context anchor ids." });
  }
  for (const anchorId of unique(impulse.discourseAnchorIds || [])) {
    if (!knownAnchorIds.has(anchorId)) {
      errors.push({ code: "CHARACTER_AGENT_AUTOMATIC_IMPULSE_ANCHOR_UNKNOWN", path: "automaticCommunicationImpulse.discourseAnchorIds", message: `Unknown discourse anchor ${anchorId}.` });
    }
  }
  const knownSourceIds = new Set(characterAgentOwnedPsychologicalSourceIds(session.privateContext));
  if (!Array.isArray(impulse.motiveSourceIds)) {
    errors.push({ code: "CHARACTER_AGENT_AUTOMATIC_IMPULSE_SOURCES_MISSING", path: "automaticCommunicationImpulse.motiveSourceIds", message: "Automatic impulse needs zero or more Character-owned motive sources." });
  }
  for (const sourceId of unique(impulse.motiveSourceIds || [])) {
    if (knownSourceIds.size && !knownSourceIds.has(sourceId)) {
      errors.push({ code: "CHARACTER_AGENT_AUTOMATIC_IMPULSE_SOURCE_UNKNOWN", path: "automaticCommunicationImpulse.motiveSourceIds", message: `Unknown private motive source ${sourceId}.` });
    }
  }
  if (!clean(impulse.perceivedTurnDemand)) {
    errors.push({ code: "CHARACTER_AGENT_AUTOMATIC_IMPULSE_TURN_DEMAND_MISSING", path: "automaticCommunicationImpulse.perceivedTurnDemand", message: "The Character Agent must identify what this moment seems to demand before regulation." });
  }
  if (mode !== "none" && !clean(impulse.feltTendency)) {
    errors.push({ code: "CHARACTER_AGENT_AUTOMATIC_IMPULSE_TENDENCY_MISSING", path: "automaticCommunicationImpulse.feltTendency", message: "A live impulse needs the Character's felt semantic/affective tendency, not literal dialogue." });
  }
  for (const field of ["urgency", "disclosurePressure", "inhibitionPressure"]) {
    const value = Number(impulse[field]);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      errors.push({ code: "CHARACTER_AGENT_AUTOMATIC_IMPULSE_PRESSURE_INVALID", path: `automaticCommunicationImpulse.${field}`, message: `${field} must be a bounded Character-entered pressure.` });
    }
  }
  const conflict = impulse.conflict;
  if (!conflict || typeof conflict !== "object" || Array.isArray(conflict)) {
    errors.push({ code: "CHARACTER_AGENT_AUTOMATIC_IMPULSE_CONFLICT_MISSING", path: "automaticCommunicationImpulse.conflict", message: "Automatic impulse must say whether opposing tendencies are present." });
  } else {
    if (typeof conflict.present !== "boolean") errors.push({ code: "CHARACTER_AGENT_AUTOMATIC_IMPULSE_CONFLICT_STATE_INVALID", path: "automaticCommunicationImpulse.conflict.present", message: "Impulse conflict state must be boolean." });
    if (!Array.isArray(conflict.opposingSourceIds)) errors.push({ code: "CHARACTER_AGENT_AUTOMATIC_IMPULSE_CONFLICT_SOURCES_MISSING", path: "automaticCommunicationImpulse.conflict.opposingSourceIds", message: "Impulse conflict needs zero or more opposing private sources." });
    for (const sourceId of unique(conflict.opposingSourceIds || [])) {
      if (knownSourceIds.size && !knownSourceIds.has(sourceId)) errors.push({ code: "CHARACTER_AGENT_AUTOMATIC_IMPULSE_CONFLICT_SOURCE_UNKNOWN", path: "automaticCommunicationImpulse.conflict.opposingSourceIds", message: `Unknown opposing private source ${sourceId}.` });
    }
    if (conflict.present === true && !clean(conflict.description)) errors.push({ code: "CHARACTER_AGENT_AUTOMATIC_IMPULSE_CONFLICT_DESCRIPTION_MISSING", path: "automaticCommunicationImpulse.conflict.description", message: "A present conflict needs the Character Agent's private description." });
  }
  if (Object.prototype.hasOwnProperty.call(impulse, "literalSpeech")) {
    errors.push({ code: "CHARACTER_AGENT_AUTOMATIC_IMPULSE_LITERAL_SPEECH_FORBIDDEN", path: "automaticCommunicationImpulse.literalSpeech", message: "Automatic impulse is not a prewritten line." });
  }
  return errors;
}

function validateChoiceAndRegulation(session, choice) {
  const errors = [];
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
    return [{ code: "CHARACTER_AGENT_CHOICE_MISSING", path: "choice", message: "Choice must be an object." }];
  }
  if (choice.ownerAuthority !== "character-agent") {
    errors.push({ code: "CHARACTER_AGENT_CHOICE_AUTHORITY_INVALID", path: "ownerAuthority", message: "Only the Character Agent may choose." });
  }
  if (clean(choice.agentTurnId) !== session.agentTurnId) {
    errors.push({ code: "CHARACTER_AGENT_CHOICE_TURN_MISMATCH", path: "agentTurnId", message: "Choice belongs to another Agent turn." });
  }
  const ids = new Set(session.generatedCandidates.map((row) => clean(row.candidateId)));
  if (!ids.has(clean(choice.selectedCandidateId))) {
    errors.push({ code: "CHARACTER_AGENT_CHOICE_UNKNOWN", path: "selectedCandidateId", message: "Choice must reference an Agent-generated candidate." });
  }
  if (choice.regulationChoice?.ownerAuthority !== "character-agent") {
    errors.push({ code: "CHARACTER_AGENT_REGULATION_AUTHORITY_INVALID", path: "regulationChoice.ownerAuthority", message: "Regulation choice must belong to this Agent." });
  }
  const goalPreservation = choice.goalPreservation;
  const selectedCandidate = session.generatedCandidates.find((row) => clean(row?.candidateId) === clean(choice.selectedCandidateId)) || {};
  if (!goalPreservation || typeof goalPreservation !== "object" || Array.isArray(goalPreservation)) {
    errors.push({ code: "CHARACTER_AGENT_GOAL_PRESERVATION_MISSING", path: "goalPreservation", message: "The Character Agent must account for whether regulation preserves or replaces the selected desire." });
  } else {
    const ownedDesireIds = new Set((session.privateContext.desires || []).map((row) => clean(row?.desireId || row?.id)).filter(Boolean));
    const selectedRelations = new Map((selectedCandidate.desireRelations || []).map((row) => [clean(row?.desireId), row]));
    if (!Array.isArray(goalPreservation.preservedDesireIds)) errors.push({ code: "CHARACTER_AGENT_PRESERVED_DESIRES_MISSING", path: "goalPreservation.preservedDesireIds", message: "Goal preservation must explicitly list zero or more preserved desires." });
    for (const desireId of unique(goalPreservation.preservedDesireIds || [])) {
      if (ownedDesireIds.size && !ownedDesireIds.has(desireId)) errors.push({ code: "CHARACTER_AGENT_PRESERVED_DESIRE_UNKNOWN", path: "goalPreservation.preservedDesireIds", message: `Unknown preserved desire ${desireId}.` });
      const relation = selectedRelations.get(desireId);
      if (!relation) errors.push({ code: "CHARACTER_AGENT_PRESERVED_DESIRE_UNLINKED", path: "goalPreservation.preservedDesireIds", message: `Selected candidate does not declare a relation to preserved desire ${desireId}.` });
      if (goalPreservation.terminalExperiencePreserved === true
        && relation
        && (clean(relation.relation) === "substitute"
          || relation.preservesNonSubstitutableConditions !== true)) {
        errors.push({ code: "CHARACTER_AGENT_GOAL_PRESERVATION_CONTRADICTION", path: "goalPreservation.terminalExperiencePreserved", message: "A substitute or an action that breaks a non-substitutable condition cannot be declared terminal-experience preserving." });
      }
    }
    if (!Array.isArray(goalPreservation.transformedDimensions)) errors.push({ code: "CHARACTER_AGENT_GOAL_TRANSFORMATIONS_MISSING", path: "goalPreservation.transformedDimensions", message: "Goal preservation must name which action dimensions were transformed." });
    if (!clean(goalPreservation.privateBasis)) errors.push({ code: "CHARACTER_AGENT_GOAL_PRESERVATION_BASIS_MISSING", path: "goalPreservation.privateBasis", message: "The Character Agent must privately distinguish shaping a desire from replacing it." });
  }
  if (Object.prototype.hasOwnProperty.call(choice, "worldOutcome")) {
    errors.push({ code: "CHARACTER_AGENT_CHOICE_WORLD_OUTCOME_FORBIDDEN", path: "worldOutcome", message: "Choice cannot pre-commit a world result." });
  }
  if (!clean(choice.privateDecisionBasis)) {
    errors.push({ code: "CHARACTER_AGENT_CHOICE_BASIS_MISSING", path: "privateDecisionBasis", message: "Choice needs a private basis." });
  }
  errors.push(...validateAutomaticCommunicationImpulse(session, choice.automaticCommunicationImpulse));
  if (Object.prototype.hasOwnProperty.call(choice, "preverbalExpressionPlan")) {
    errors.push({ code: "CHARACTER_AGENT_CHOICE_EXPRESSION_PLAN_PREMATURE", path: "preverbalExpressionPlan", message: "Regulated expression planning must wait until the mathematical regulation outcome exists." });
  }
  if (!Array.isArray(choice.continuationIntentions)) {
    errors.push({ code: "CHARACTER_AGENT_CONTINUATION_INTENTIONS_MISSING", path: "continuationIntentions", message: "Choice must explicitly provide zero to three conditional continuation intentions." });
  } else if (choice.continuationIntentions.length > 3) {
    errors.push({ code: "CHARACTER_AGENT_CONTINUATION_INTENTIONS_LIMIT", path: "continuationIntentions", message: "One choice may retain at most three short-term continuation intentions." });
  } else {
    const intentionIds = new Set();
    const sourceIds = new Set(characterAgentOwnedPsychologicalSourceIds(session.privateContext));
    const targetHandles = new Set(targetHandlesFromProjection(session.worldProjection));
    for (const [index, intention] of choice.continuationIntentions.entries()) {
      const path = `continuationIntentions[${index}]`;
      const intentionId = clean(intention?.intentionId);
      if (intention?.ownerAuthority !== "character-agent") errors.push({ code: "CHARACTER_AGENT_CONTINUATION_AUTHORITY_INVALID", path: `${path}.ownerAuthority`, message: "Continuation intentions belong to this Character Agent." });
      if (!intentionId || intentionIds.has(intentionId)) errors.push({ code: "CHARACTER_AGENT_CONTINUATION_ID_INVALID", path: `${path}.intentionId`, message: "Each continuation intention needs a unique id." });
      intentionIds.add(intentionId);
      if (!CHARACTER_CONTINUATION_TRIGGER_TYPES.includes(clean(intention?.triggerType))) errors.push({ code: "CHARACTER_AGENT_CONTINUATION_TRIGGER_INVALID", path: `${path}.triggerType`, message: "Unknown continuation trigger." });
      if (!clean(intention?.intendedPrimitive)) errors.push({ code: "CHARACTER_AGENT_CONTINUATION_PRIMITIVE_MISSING", path: `${path}.intendedPrimitive`, message: "A continuation intention needs an intended action primitive, without forcing future selection." });
      const targetHandle = clean(intention?.targetHandle);
      if (targetHandle && targetHandles.size && !targetHandles.has(targetHandle)) errors.push({ code: "CHARACTER_AGENT_CONTINUATION_TARGET_UNKNOWN", path: `${path}.targetHandle`, message: "Continuation target was not perceived by this Character Agent." });
      for (const sourceId of unique(intention?.linkedSourceIds || [])) {
        if (sourceIds.size && !sourceIds.has(sourceId)) errors.push({ code: "CHARACTER_AGENT_CONTINUATION_SOURCE_UNKNOWN", path: `${path}.linkedSourceIds`, message: `Unknown private source ${sourceId}.` });
      }
    }
  }
  return errors;
}

function legacyInteractionMove(communication = {}, moment = {}, mode = "") {
  if (["silence", "nonverbal"].includes(clean(mode))) return "silence";
  const tactic = clean(communication.tactic);
  const goal = clean(communication.goal);
  if (tactic === "counter_question") return "counter";
  if (["evade", "redirect", "joke"].includes(tactic)) return tactic === "joke" ? "tease" : tactic;
  if (["lie", "bluff"].includes(tactic)) return "mislead";
  if (goal === "obtain_information") return "ask";
  if (goal === "end_exchange") return "close";
  if (goal === "soothe") return "soothe";
  if (goal === "provoke") return "warn";
  if (clean(moment.regulatedOpeningMove || moment.minimumPublicDelta)) return "respond";
  return "none";
}

function normalizeRegulatedExpressionPlan(expression = {}) {
  if (expression.publicStance && typeof expression.publicStance === "object") return clone(expression);
  const communication = expression.communicationPlan || {};
  const moment = expression.speechMoment || {};
  return {
    ownerAuthority: expression.ownerAuthority,
    sourceImpulseId: expression.sourceImpulseId,
    impulseTransformation: clone(expression.impulseTransformation || {}),
    mode: expression.mode,
    actionIntent: expression.actionIntent,
    publicStance: {
      interactionMove: legacyInteractionMove(communication, moment, expression.mode),
      releasedMeaning: clean(moment.regulatedOpeningMove || moment.minimumPublicDelta),
      audienceCharacterIds: unique(communication.intendedAudienceCharacterIds || []),
      disclosure: clean(communication.disclosure || "withhold"),
      epistemicRelation: clean(communication.epistemicRelation || "not_applicable"),
      intendedEffect: clean(communication.desiredEffect),
      threadDisposition: clean(communication.threadDisposition || "none"),
      sharedContextAnchorIds: unique(moment.sharedContext?.anchorIds || []),
      sharedContextTreatment: clean(moment.sharedContext?.treatment || "not_applicable"),
    },
    nonverbalUndertone: clean(expression.nonverbalUndertone),
    privateRemainderPresent: Boolean(
      clean(expression.privacyBoundary)
      || (moment.deferredOrImplied || []).some((row) => clean(row)),
    ),
    relationshipStance: clean(expression.relationshipStance),
    timing: clean(expression.timing),
    turnYield: clean(expression.turnYield),
  };
}

function validateRegulatedExpressionPlan(session, expressionInput) {
  const expression = normalizeRegulatedExpressionPlan(expressionInput);
  const errors = [];
  if (!expression || typeof expression !== "object" || Array.isArray(expression)) {
    return [{ code: "CHARACTER_AGENT_REGULATED_EXPRESSION_PLAN_MISSING", path: "regulatedExpressionPlan", message: "The post-regulation stage needs a Character-Agent-owned expression plan." }];
  }
  if (expression.ownerAuthority !== "character-agent") {
    errors.push({ code: "CHARACTER_AGENT_REGULATED_EXPRESSION_AUTHORITY_INVALID", path: "regulatedExpressionPlan.ownerAuthority", message: "Only the Character Agent may author the regulated expression plan." });
  }
  const expectedImpulseId = clean(session.agentChoice?.automaticCommunicationImpulse?.impulseId);
  if (!clean(expression.sourceImpulseId) || clean(expression.sourceImpulseId) !== expectedImpulseId) {
    errors.push({ code: "CHARACTER_AGENT_REGULATED_EXPRESSION_IMPULSE_MISMATCH", path: "regulatedExpressionPlan.sourceImpulseId", message: "Regulated expression must transform the automatic impulse from the same Agent turn." });
  }
  const transformation = expression.impulseTransformation;
  if (!transformation || typeof transformation !== "object" || Array.isArray(transformation)) {
    errors.push({ code: "CHARACTER_AGENT_IMPULSE_TRANSFORMATION_MISSING", path: "regulatedExpressionPlan.impulseTransformation", message: "The Character Agent must say how regulation changed or retained the automatic impulse." });
  } else {
    if (!IMPULSE_TRANSFORMATIONS.has(clean(transformation.treatment))) errors.push({ code: "CHARACTER_AGENT_IMPULSE_TRANSFORMATION_INVALID", path: "regulatedExpressionPlan.impulseTransformation.treatment", message: "Unknown automatic-impulse transformation." });
    if (!clean(transformation.privateBasis)) errors.push({ code: "CHARACTER_AGENT_IMPULSE_TRANSFORMATION_BASIS_MISSING", path: "regulatedExpressionPlan.impulseTransformation.privateBasis", message: "The Character Agent needs a private account of how regulation shaped the impulse." });
  }
  if (!clean(expression.actionIntent)) {
    errors.push({ code: "CHARACTER_AGENT_REGULATED_ACTION_INTENT_MISSING", path: "regulatedExpressionPlan.actionIntent", message: "The realization stage needs the chosen bodily attempt without its full hidden rationale." });
  }
  const stance = expression.publicStance;
  if (!stance || typeof stance !== "object" || Array.isArray(stance)) {
    errors.push({ code: "CHARACTER_AGENT_PUBLIC_STANCE_MISSING", path: "regulatedExpressionPlan.publicStance", message: "Expression planning needs one compact public stance, not a sentence checklist." });
  } else {
    if (!PUBLIC_INTERACTION_MOVES.has(clean(stance.interactionMove))) errors.push({ code: "CHARACTER_AGENT_PUBLIC_INTERACTION_MOVE_INVALID", path: "regulatedExpressionPlan.publicStance.interactionMove", message: "Unknown public interaction move." });
    if (!Array.isArray(stance.audienceCharacterIds)) errors.push({ code: "CHARACTER_AGENT_PUBLIC_AUDIENCE_MISSING", path: "regulatedExpressionPlan.publicStance.audienceCharacterIds", message: "Public stance needs zero or more physical audience handles." });
    const spoken = ["speech", "mixed"].includes(clean(expression.mode));
    if (spoken && !clean(stance.releasedMeaning)) errors.push({ code: "CHARACTER_AGENT_RELEASED_MEANING_MISSING", path: "regulatedExpressionPlan.publicStance.releasedMeaning", message: "Spoken expression needs one released preverbal meaning, not a prewritten line." });
    const allowedAnchorIds = new Set(buildCharacterAgentReferenceContract(session).discourseAnchorIds || []);
    if (!Array.isArray(stance.sharedContextAnchorIds)) errors.push({ code: "CHARACTER_AGENT_SHARED_CONTEXT_ANCHORS_MISSING", path: "regulatedExpressionPlan.publicStance.sharedContextAnchorIds", message: "Shared context uses zero or more owned discourse anchors." });
    for (const anchorId of unique(stance.sharedContextAnchorIds || [])) {
      if (!allowedAnchorIds.has(anchorId)) errors.push({ code: "CHARACTER_AGENT_SHARED_CONTEXT_ANCHOR_UNKNOWN", path: "regulatedExpressionPlan.publicStance.sharedContextAnchorIds", message: `Unknown discourse anchor ${anchorId}.` });
    }
    if (!SHARED_CONTEXT_TREATMENTS.has(clean(stance.sharedContextTreatment))) errors.push({ code: "CHARACTER_AGENT_SHARED_CONTEXT_TREATMENT_INVALID", path: "regulatedExpressionPlan.publicStance.sharedContextTreatment", message: "Unknown shared-context treatment." });
  }
  if (Object.prototype.hasOwnProperty.call(expressionInput || {}, "literalSpeech")) {
    errors.push({ code: "CHARACTER_AGENT_REGULATED_LITERAL_SPEECH_FORBIDDEN", path: "regulatedExpressionPlan.literalSpeech", message: "Expression planning may shape an opening move but may not prewrite literal dialogue." });
  }
  return errors;
}

function materializeAgentOwnedSpeechPlan(regulatedExpressionPlan = {}, realization = {}) {
  const surface = realization.surfaceRealization || {};
  const nonverbalUndertone = clean(regulatedExpressionPlan.nonverbalUndertone);
  const stance = regulatedExpressionPlan.publicStance || {};
  const releasedMeaning = clean(stance.releasedMeaning);
  return {
    timing: clean(surface.timing || regulatedExpressionPlan.timing) || "silence",
    propositionalPayload: releasedMeaning ? [releasedMeaning] : [],
    affectiveTexture: clone(surface.affectiveTexture || []),
    mayReveal: nonverbalUndertone ? [nonverbalUndertone] : [],
    withhold: regulatedExpressionPlan.privateRemainderPresent === true ? ["private_remainder_present"] : [],
    relationshipRegister: clean(surface.relationshipRegister || regulatedExpressionPlan.relationshipStance),
    appliedVoiceParameters: clone(surface.appliedVoiceParameters || {}),
    intentionalDepartureReason: clean(surface.intentionalDepartureReason),
    intendedListenerEffect: clean(stance.intendedEffect),
    selfCheck: {},
  };
}

function validateRealizationEmotionHandling(session, realization) {
  const errors = [];
  const allowedHandling = new Set(["expressed", "displaced", "masked", "unavailable"]);
  const rows = Array.isArray(realization.emotionHandling) ? realization.emotionHandling : [];
  const handled = new Set();
  for (const [index, row] of rows.entries()) {
    const channel = clean(row?.channel);
    if (!channel) errors.push({ code: "CHARACTER_AGENT_EMOTION_CHANNEL_MISSING", path: `emotionHandling[${index}].channel`, message: "Emotion handling needs a leakage channel." });
    if (channel && handled.has(channel)) errors.push({ code: "CHARACTER_AGENT_EMOTION_CHANNEL_DUPLICATE", path: `emotionHandling[${index}].channel`, message: "A leakage channel may be handled only once." });
    if (channel) handled.add(channel);
    if (!allowedHandling.has(clean(row?.handling))) errors.push({ code: "CHARACTER_AGENT_EMOTION_HANDLING_INVALID", path: `emotionHandling[${index}].handling`, message: "Unknown Character Agent emotion handling choice." });
    if (!clean(row?.basis)) errors.push({ code: "CHARACTER_AGENT_EMOTION_HANDLING_BASIS_MISSING", path: `emotionHandling[${index}].basis`, message: "The Character Agent must state privately how this channel is handled." });
  }
  const highLeakageChannels = Object.entries(session.regulationOutcome?.channelLeakagePressures || {})
    .filter(([, value]) => Number(value) >= 0.6)
    .map(([channel]) => channel);
  const missing = highLeakageChannels.filter((channel) => !handled.has(channel));
  if (missing.length) errors.push({
    code: "CHARACTER_AGENT_HIGH_LEAKAGE_UNHANDLED",
    path: "emotionHandling",
    message: "High residual emotion must be handled by this Character Agent as expressed, displaced, masked, or objectively unavailable.",
    missingChannels: missing,
  });
  return errors;
}

function validateRealizedSpeechHabits(session, realization) {
  const foundation = session.privateContext?.voiceContract?.voiceFoundation;
  const knownIds = new Set((foundation?.habits || []).map((row) => clean(row?.id)).filter(Boolean));
  const provided = realization?.realizedSpeechHabitIds;
  if (!knownIds.size && provided === undefined) return [];
  if (!Array.isArray(provided)) {
    return [{
      code: "CHARACTER_AGENT_REALIZED_SPEECH_HABITS_MISSING",
      path: "realizedSpeechHabitIds",
      message: "The Character Agent must report zero or more speech habits that actually shaped this realization.",
    }];
  }
  const errors = [];
  const seen = new Set();
  for (const [index, habitIdValue] of provided.entries()) {
    const habitId = clean(habitIdValue);
    if (!habitId || seen.has(habitId)) {
      errors.push({
        code: "CHARACTER_AGENT_REALIZED_SPEECH_HABIT_DUPLICATE_OR_EMPTY",
        path: `realizedSpeechHabitIds[${index}]`,
        message: "Realized speech-habit ids must be unique and non-empty.",
      });
      continue;
    }
    seen.add(habitId);
    if (knownIds.size && !knownIds.has(habitId)) errors.push({
      code: "CHARACTER_AGENT_REALIZED_SPEECH_HABIT_UNKNOWN",
      path: `realizedSpeechHabitIds[${index}]`,
      message: `Unknown character speech habit ${habitId}.`,
    });
  }
  return errors;
}

/** Accept an Agent choice, then calculate the residue of its regulation choice. */
export function submitCharacterAgentChoiceAndRegulation(session, choice) {
  assertPhase(session, "awaiting_agent_choice_and_regulation");
  const errors = validateChoiceAndRegulation(session, choice);
  if (errors.length) {
    throw protocolError("CHARACTER_AGENT_CHOICE_REJECTED", "Character Agent choice failed authority validation.", { issues: errors });
  }
  const regulationOutcome = computeCharacterRegulationOutcome({
    agentTurnId: session.agentTurnId,
    snapshot: session.psychologySnapshot,
    profile: session.privateContext.profile || {},
    state: session.privateContext.state || {},
    regulationChoice: choice.regulationChoice,
  });
  return {
    ...clone(session),
    phase: (session.submissionMode || "staged") === "atomic"
      ? "awaiting_agent_turn_commit"
      : "awaiting_agent_expression_planning",
    agentChoice: clone(choice),
    regulationOutcome,
    history: [...session.history, historyEntry("agent_choice_accepted", choice.selectedCandidateId)],
  };
}

/** Accept a post-regulation plan authored by the same Character Agent. */
export function submitCharacterAgentExpressionPlan(session, expressionPlan) {
  assertPhase(session, "awaiting_agent_expression_planning");
  const normalizedExpressionPlan = normalizeRegulatedExpressionPlan(expressionPlan);
  const errors = validateRegulatedExpressionPlan(session, normalizedExpressionPlan);
  if (errors.length) {
    throw protocolError(
      "CHARACTER_AGENT_EXPRESSION_PLAN_REJECTED",
      "Character Agent regulated expression plan failed authority or grounding validation.",
      { issues: errors },
    );
  }
  return {
    ...clone(session),
    phase: "awaiting_agent_realization",
    regulatedExpressionPlan: clone(normalizedExpressionPlan),
    history: [...session.history, historyEntry("agent_expression_plan_accepted", normalizedExpressionPlan.sourceImpulseId)],
  };
}

const REALIZATION_BINDING_ATTEMPT_FIELDS = Object.freeze({
  character: ["targetCharacterId", "targetCharacterId"],
  object: ["objectId", "objectId"],
  place: ["destinationId", "destinationId"],
  position: ["positionId", "positionId"],
  affordance: ["affordanceId", "affordanceId"],
});

/**
 * After choice, the action identity is locked. Realization may shape posture,
 * tone, disclosure and pacing, but may not replace the chosen attempt with a
 * different action or rebind it to a different world anchor.
 */
function validateRealizedActionIdentity(session, realization) {
  const errors = [];
  const attempt = realization.actionAttempt;
  if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) return errors;
  if (realization.embodiedIntent) errors.push(...validatePhysicalExpression({
    bodyActions: realization.embodiedIntent.bodyActions || [],
    affectiveDeltas: realization.surfaceRealization?.affectiveTexture || [], utterance: realization.utterance || {},
  }, clean(attempt.primitive)));
  const supportedPrimitives = session.worldProjection?.supportedAttemptPrimitives;
  if (Array.isArray(supportedPrimitives) && !supportedPrimitives.includes(clean(attempt.primitive))) {
    errors.push({
      code: "CHARACTER_AGENT_REALIZATION_PRIMITIVE_UNSUPPORTED",
      path: "actionAttempt.primitive",
      message: `Unsupported action primitive ${clean(attempt.primitive) || "(empty)"}; supported primitives: ${supportedPrimitives.join(", ")}.`,
    });
  }
  const selected = (session.generatedCandidates || [])
    .find((row) => clean(row?.candidateId) === clean(session.agentChoice?.selectedCandidateId)) || {};
  const chosenPrimitive = clean(selected.attemptPrimitive);
  if (!chosenPrimitive) return errors;
  const realizedPrimitive = clean(attempt.primitive);
  if (realizedPrimitive === "transfer") {
    for (const field of ["objectId", "targetCharacterId"]) if (!clean(attempt[field])) errors.push({
      code: "CHARACTER_AGENT_TRANSFER_REFERENCE_REQUIRED", path: `actionAttempt.${field}`,
      message: "A transfer requires both the perceived object and the recipient. Neither can be inferred from prose." });
  }
  const samePrimitive = realizedPrimitive === chosenPrimitive;
  if (!samePrimitive) {
    errors.push({
      code: "CHARACTER_AGENT_REALIZATION_ACTION_SUBSTITUTED",
      path: "actionAttempt.primitive",
      message: `The Character Agent chose ${chosenPrimitive}; realization may shape it but may not replace it with ${realizedPrimitive || "nothing"}.`,
    });
    return errors;
  }
  const binding = selected.actionBinding;
  const kind = clean(binding?.kind);
  if (binding && typeof binding === "object" && REALIZATION_BINDING_ATTEMPT_FIELDS[kind]) {
    const [bindingField, attemptField] = REALIZATION_BINDING_ATTEMPT_FIELDS[kind];
    const boundAnchor = clean(binding[bindingField]);
    if (boundAnchor && clean(attempt[attemptField]) !== boundAnchor) {
      errors.push({
        code: "CHARACTER_AGENT_REALIZATION_BINDING_BROKEN",
        path: `actionAttempt.${attemptField}`,
        message: `The chosen candidate bound this action to ${boundAnchor}; realization may not rebind it to ${clean(attempt[attemptField]) || "nothing"}.`,
      });
    }
  }
  return errors;
}

function atomicCommunicationGoal(interactionMove = "none") {
  const move = clean(interactionMove);
  if (move === "ask" || move === "counter") return "obtain_information";
  if (move === "close") return "end_exchange";
  if (move === "soothe") return "soothe";
  if (move === "warn") return "provoke";
  return "none";
}

function atomicCommunicationTactic(interactionMove = "none") {
  const move = clean(interactionMove);
  if (["evade", "redirect"].includes(move)) return move;
  if (move === "counter") return "counter_question";
  if (move === "mislead") return "lie";
  if (move === "tease") return "joke";
  if (move === "silence" || move === "none") return "silence";
  return "direct";
}

function observePublicSpeechSemantics(session = {}, literalSpeech = "") {
  const speech = clean(literalSpeech);
  if (!speech) return { speechAct: "none", speechFunctions: [] };
  let speechAct = "inform";
  if (/[?？]\s*$/u.test(speech)) speechAct = "ask";
  else if (/^(?:不必|不用|不劳|不行|不应|不肯|不去|不必了|算了|免了|no\b|don't\b|do not\b)/iu.test(speech)) speechAct = "refuse";
  else if (/^(?:请|要不要|可要|不如|我可以|我来|let me\b|shall we\b|would you like\b)/iu.test(speech)) speechAct = "offer";
  else if (/^(?:小心|当心|别动|住手|莫要|不要再|watch out\b|careful\b|stop\b)/iu.test(speech)) speechAct = "warn";
  else if (/^(?:你好|久仰|幸会|客官|掌柜|早|晚安|hello\b|good morning\b|good evening\b)/iu.test(speech)) speechAct = "greet";
  else {
    const previous = literalTurnSurface(noticedWorldProjection(session)).at(-1);
    if (clean(previous?.addresseeId) === clean(session.characterId)) speechAct = "answer";
  }
  return { speechAct, speechFunctions: [speechAct] };
}

const EMPTY_PUBLIC_DELTA_MARKERS = new Set([
  "无", "没有", "无变化", "没有变化", "无动作", "没有动作", "无可见动作", "不适用", "暂无",
  "none", "no change", "no action", "n/a", "na", "null", "nil",
]);

function normalizePublicDelta(value = "") {
  const text = clean(value);
  const core = text
    .replace(/^[\s（(\[【]+|[\s）)\]】。.．,，!！]+$/gu, "")
    .toLowerCase();
  if (!core || /^[-—–_]+$/u.test(core) || EMPTY_PUBLIC_DELTA_MARKERS.has(core)) return "";
  return text;
}

function publicTextFitsAvailableLanguage(value = "", languageUse = {}) {
  const text = clean(value);
  if (!text) return true;
  const available = unique(languageUse.availablePublicLanguages || []);
  if (!available.length) return true;
  const hasHan = /\p{Script=Han}/u.test(text);
  const hasKana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
  const hasLatin = /\p{Script=Latin}/u.test(text);
  if (!hasHan && !hasKana && !hasLatin) return true;
  if (hasHan && available.some((code) => /^(?:zh|yue|ja)(?:-|$)/iu.test(code))) return true;
  if (hasKana && available.some((code) => /^ja(?:-|$)/iu.test(code))) return true;
  if (hasLatin && available.some((code) => /^(?:en|fr|de|es|pt|it|nl|la|vi|id|ms|tl)(?:-|$)/iu.test(code))) return true;
  return false;
}

function validateAtomicPublicLanguage(session = {}, expression = {}) {
  const languageUse = session.privateContext?.voiceContract?.languageUse || {};
  if (!unique(languageUse.availablePublicLanguages || []).length) return [];
  return publicTextFitsAvailableLanguage(expression.utterance?.literalSpeech, languageUse)
    ? []
    : [{
      code: "CHARACTER_AGENT_PUBLIC_LANGUAGE_UNAVAILABLE",
      path: "publicExpression.utterance.literalSpeech",
      message: "Literal speech must use a language available to this Character; the world will not translate or rewrite it.",
    }];
}

function validateAtomicPublicDescriptionLanguage(session = {}, expression = {}) {
  const publicDescriptionLanguage = clean(
    session.privateContext?.expressionProtocol?.publicDescriptionLanguage,
  );
  if (!publicDescriptionLanguage) return [];
  const languageSurface = { availablePublicLanguages: [publicDescriptionLanguage] };
  const surfaces = [
    ["publicExpression.bodyDelta", expression.bodyDelta],
    ...(expression.affectiveDeltas || []).map((row, index) => [
      `publicExpression.affectiveDeltas[${index}].feature`,
      row?.feature,
    ]),
  ];
  return surfaces.flatMap(([path, value]) => (
    publicTextFitsAvailableLanguage(value, languageSurface)
      ? []
      : [{
        code: "CHARACTER_AGENT_PUBLIC_DESCRIPTION_LANGUAGE_MISMATCH",
        path,
        message: "Observable action and affect descriptions must use the runtime expression protocol language; they are not Character speech.",
      }]
  ));
}

function validateAtomicPublicExpression(session, expression, actionAttempt = {}) {
  if (!expression || typeof expression !== "object" || Array.isArray(expression)) {
    return [{
      code: "CHARACTER_AGENT_PUBLIC_EXPRESSION_MISSING",
      path: "publicExpression",
      message: "An atomic Character Agent commit needs one observable PublicExpression.",
    }];
  }
  const errors = [];
  const forbiddenPrivateFields = [
    "privateDecisionBasis", "privateReason", "regulationChoice", "goalPreservation",
    "automaticCommunicationImpulse", "emotionHandling", "intendedEffect", "releasedMeaning",
  ];
  for (const field of forbiddenPrivateFields) {
    if (Object.prototype.hasOwnProperty.call(expression, field)) errors.push({
      code: "CHARACTER_AGENT_PUBLIC_EXPRESSION_PRIVATE_FIELD",
      path: `publicExpression.${field}`,
      message: `${field} belongs to the Character Agent's private commit trace, not its public expression.`,
    });
  }
  for (const field of ["embodiedIntent", "observableAffectiveTexture"]) {
    if (Object.prototype.hasOwnProperty.call(expression, field)) errors.push({
      code: "CHARACTER_AGENT_PUBLIC_EXPRESSION_LEGACY_SURFACE_FORBIDDEN",
      path: `publicExpression.${field}`,
      message: `${field} is a legacy standing-state surface. Atomic commits publish only current deltas.`,
    });
  }
  const mode = clean(expression.mode);
  if (!ATOMIC_PUBLIC_EXPRESSION_MODES.has(mode)) errors.push({
    code: "CHARACTER_AGENT_PUBLIC_EXPRESSION_MODE_INVALID",
    path: "publicExpression.mode",
    message: "Unknown atomic public-expression mode.",
  });
  if (!ATOMIC_EXPRESSION_TIMINGS.has(clean(expression.timing))) errors.push({
    code: "CHARACTER_AGENT_PUBLIC_EXPRESSION_TIMING_INVALID",
    path: "publicExpression.timing",
    message: "Unknown public-expression timing.",
  });
  if (!Array.isArray(expression.audienceCharacterIds)) {
    errors.push({
      code: "CHARACTER_AGENT_PUBLIC_EXPRESSION_AUDIENCE_MISSING",
      path: "publicExpression.audienceCharacterIds",
      message: "PublicExpression needs zero or more intended physical audience handles.",
    });
  } else {
    const allowedAudienceIds = new Set(characterHandlesFromProjection(noticedWorldProjection(session)));
    for (const audienceId of unique(expression.audienceCharacterIds)) {
      if (allowedAudienceIds.size && !allowedAudienceIds.has(audienceId)) errors.push({
        code: "CHARACTER_AGENT_PUBLIC_EXPRESSION_AUDIENCE_UNKNOWN",
        path: "publicExpression.audienceCharacterIds",
        message: `PublicExpression cites an unperceived audience handle ${audienceId}.`,
      });
    }
  }
  const utterance = expression.utterance;
  if (!utterance || typeof utterance !== "object" || Array.isArray(utterance)) {
    errors.push({
      code: "CHARACTER_AGENT_PUBLIC_EXPRESSION_UTTERANCE_MISSING",
      path: "publicExpression.utterance",
      message: "PublicExpression needs an utterance surface, even when its literal speech is empty.",
    });
  } else {
    for (const semanticField of ["speechAct", "speechFunctions"]) {
      if (Object.prototype.hasOwnProperty.call(utterance, semanticField)) errors.push({
        code: "CHARACTER_AGENT_PUBLIC_SPEECH_SEMANTICS_SELF_CLASSIFICATION_FORBIDDEN",
        path: `publicExpression.utterance.${semanticField}`,
        message: "Atomic literal speech is classified only after generation from the public wording and lived dialogue context.",
      });
    }
    if (typeof utterance.literalSpeech !== "string") errors.push({
      code: "CHARACTER_AGENT_PUBLIC_EXPRESSION_LITERAL_SPEECH_INVALID",
      path: "publicExpression.utterance.literalSpeech",
      message: "Literal speech must be a string and is preserved without language correction.",
    });
    const hasSpeech = Boolean(clean(utterance.literalSpeech));
    if (["speech", "mixed"].includes(mode) && !hasSpeech) errors.push({
      code: "CHARACTER_AGENT_PUBLIC_EXPRESSION_SPEECH_EMPTY",
      path: "publicExpression.utterance.literalSpeech",
      message: "A speech or mixed public expression needs literal speech.",
    });
    if (["silence", "nonverbal"].includes(mode) && hasSpeech) errors.push({
      code: "CHARACTER_AGENT_PUBLIC_EXPRESSION_MODE_CONTRADICTION",
      path: "publicExpression.mode",
      message: "Silence or nonverbal mode cannot also publish literal speech.",
    });
  }
  if (typeof expression.bodyDelta !== "string") {
    errors.push({
      code: "CHARACTER_AGENT_PUBLIC_EXPRESSION_BODY_DELTA_INVALID",
      path: "publicExpression.bodyDelta",
      message: "PublicExpression bodyDelta must be a string; use an empty string when no bodily change occurs.",
    });
  }
  if (!Array.isArray(expression.affectiveDeltas)) {
    errors.push({
      code: "CHARACTER_AGENT_PUBLIC_EXPRESSION_AFFECTIVE_DELTAS_MISSING",
      path: "publicExpression.affectiveDeltas",
      message: "PublicExpression needs zero or more newly observable affective changes.",
    });
  } else {
    if (expression.affectiveDeltas.length > 2) errors.push({
      code: "CHARACTER_AGENT_PUBLIC_EXPRESSION_AFFECTIVE_DELTAS_EXCESSIVE",
      path: "publicExpression.affectiveDeltas",
      message: "One embodied beat may expose at most two salient affective changes.",
    });
    for (const [index, delta] of expression.affectiveDeltas.entries()) {
      if (!delta || typeof delta !== "object" || !clean(delta.feature)) errors.push({
        code: "CHARACTER_AGENT_PUBLIC_EXPRESSION_AFFECTIVE_DELTA_EMPTY",
        path: `publicExpression.affectiveDeltas[${index}]`,
        message: "An affective delta must name a newly observable feature.",
      });
    }
  }
  errors.push(...validateAtomicPublicLanguage(session, expression));
  errors.push(...validateAtomicPublicDescriptionLanguage(session, expression));
  const bodyDelta = normalizePublicDelta(expression.bodyDelta);
  const hasAffectiveDelta = Array.isArray(expression.affectiveDeltas)
    && expression.affectiveDeltas.some((row) => clean(row?.feature));
  const primitive = clean(actionAttempt?.primitive);
  errors.push(...validatePhysicalExpression(expression, primitive));
  const hasBodyAction = Array.isArray(expression.bodyActions) && expression.bodyActions.length > 0;
  const hasPrimaryAction = primitive && !["none", "speak", "act", "gesture"].includes(primitive);
  if (["nonverbal", "mixed"].includes(mode) && !hasBodyAction && !hasAffectiveDelta && !hasPrimaryAction) errors.push({
    code: "CHARACTER_AGENT_PUBLIC_EXPRESSION_NONVERBAL_DELTA_REQUIRED",
    path: "publicExpression.mode",
    message: "Nonverbal or mixed mode requires a supported body operation, physical action or affective cue; prose alone is not an action. Use speech mode for speech alone.",
  });
  return errors;
}

function validateAtomicConversationAnchorSelection(session = {}, commit = {}) {
  const selection = commit.conversationAnchorSelection;
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) return [{
    code: "CHARACTER_AGENT_CONVERSATION_SELECTION_MISSING",
    path: "conversationAnchorSelection",
    message: "An atomic commit must explicitly choose an opaque conversation anchor or none.",
  }];
  const errors = [];
  const anchorHandle = clean(selection.anchorHandle);
  const mode = clean(selection.mode);
  const targetParticipantHandle = clean(selection.targetParticipantHandle);
  const postTurnDisposition = clean(selection.postTurnDisposition);
  const literalSpeech = clean(commit.publicExpression?.utterance?.literalSpeech);
  const audience = unique(commit.publicExpression?.audienceCharacterIds || []);
  if (!ATOMIC_POST_TURN_DISPOSITIONS.has(postTurnDisposition)) errors.push({
    code: "CHARACTER_AGENT_CONVERSATION_DISPOSITION_INVALID",
    path: "conversationAnchorSelection.postTurnDisposition",
    message: "Post-turn disposition must be no_thread, keep_resumable, or close_for_self.",
  });
  if (!literalSpeech && postTurnDisposition && postTurnDisposition !== "no_thread") errors.push({
    code: "CHARACTER_AGENT_CONVERSATION_DISPOSITION_WITHOUT_SPEECH",
    path: "conversationAnchorSelection.postTurnDisposition",
    message: "A turn without emitted speech cannot keep or close a conversation thread.",
  });
  if (literalSpeech && postTurnDisposition === "no_thread") errors.push({
    code: "CHARACTER_AGENT_CONVERSATION_SPEECH_DISPOSITION_REQUIRED",
    path: "conversationAnchorSelection.postTurnDisposition",
    message: "Actual speech must choose whether this Character keeps the resulting thread resumable or closes it for self.",
  });
  if (mode === "none") {
    if (anchorHandle || targetParticipantHandle) errors.push({
      code: "CHARACTER_AGENT_CONVERSATION_NONE_INCONSISTENT",
      path: "conversationAnchorSelection",
      message: "A none selection must leave both the opaque anchor and participant target empty.",
    });
    return errors;
  }
  if (!["reply", "continue"].includes(mode) || !anchorHandle || !targetParticipantHandle) {
    errors.push({
      code: "CHARACTER_AGENT_CONVERSATION_SELECTION_INCOMPLETE",
      path: "conversationAnchorSelection",
      message: "Reply or continue requires one projected opaque anchor and one participant target.",
    });
    return errors;
  }
  if (!literalSpeech) errors.push({
    code: "CHARACTER_AGENT_CONVERSATION_SELECTION_WITHOUT_SPEECH",
    path: "publicExpression.utterance.literalSpeech",
    message: "A conversation continuation requires actual literal speech.",
  });
  if (audience[0] !== targetParticipantHandle) errors.push({
    code: "CHARACTER_AGENT_CONVERSATION_TARGET_MISMATCH",
    path: "conversationAnchorSelection.targetParticipantHandle",
    message: "The selected participant must be the actual intended speech audience.",
  });
  const anchor = (session.worldProjection?.conversationAnchors?.anchors || [])
    .find((row) => clean(row?.anchorHandle) === anchorHandle);
  if (!anchor) {
    errors.push({
      code: "CHARACTER_AGENT_CONVERSATION_ANCHOR_UNKNOWN",
      path: "conversationAnchorSelection.anchorHandle",
      message: "The selected opaque anchor was not projected to this Character.",
    });
    return errors;
  }
  if (!(anchor.allowedModes || []).map(clean).includes(mode)) errors.push({
    code: "CHARACTER_AGENT_CONVERSATION_MODE_NOT_ALLOWED",
    path: "conversationAnchorSelection.mode",
    message: "The selected opaque anchor does not allow this continuation mode.",
  });
  if (!(anchor.participantHandles || []).map(clean).includes(targetParticipantHandle)) errors.push({
    code: "CHARACTER_AGENT_CONVERSATION_TARGET_INCOMPATIBLE",
    path: "conversationAnchorSelection.targetParticipantHandle",
    message: "The selected target is not a participant in this opaque anchor.",
  });
  if (mode === "reply" && !projectedReplyTargets(anchor).includes(targetParticipantHandle)) errors.push({
    code: "CHARACTER_AGENT_CONVERSATION_REPLY_TARGET_MISMATCH",
    path: "conversationAnchorSelection.targetParticipantHandle",
    message: "Reply must address the speaker of this anchor's exact latest incoming turn. Choose your intended continuation explicitly; a group participant is not necessarily that speaker.",
  });
  return errors;
}

function validateAtomicPrivateExpressionTrace(session, trace) {
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) {
    return [{
      code: "CHARACTER_AGENT_PRIVATE_EXPRESSION_TRACE_MISSING",
      path: "privateExpressionTrace",
      message: "An atomic commit needs a Character-owned private expression trace.",
    }];
  }
  const errors = [];
  const influence = trace.affectiveInfluence;
  if (!influence || typeof influence !== "object" || Array.isArray(influence)) {
    errors.push({
      code: "CHARACTER_AGENT_AFFECTIVE_INFLUENCE_MISSING",
      path: "privateExpressionTrace.affectiveInfluence",
      message: "The same Character Agent must privately decide how live post-regulation affect influences this commit.",
    });
  } else {
    const sourceEmotionIds = unique(influence.sourceEmotionIds || []);
    if (influence.sourceEmotionIds !== undefined && !Array.isArray(influence.sourceEmotionIds)) errors.push({
      code: "CHARACTER_AGENT_AFFECTIVE_INFLUENCE_SOURCES_MISSING",
      path: "privateExpressionTrace.affectiveInfluence.sourceEmotionIds",
      message: "Affective influence needs zero or more live emotion ids.",
    });
    if (!ATOMIC_AFFECTIVE_INFLUENCE_MODES.has(clean(influence.mode))) errors.push({
      code: "CHARACTER_AGENT_AFFECTIVE_INFLUENCE_MODE_INVALID",
      path: "privateExpressionTrace.affectiveInfluence.mode",
      message: "Unknown affective-influence mode.",
    });
    const primaryChannelId = clean(influence.primaryChannelId);
    if (!CHARACTER_PSYCHOLOGY_LEAKAGE_CHANNELS.includes(primaryChannelId) && primaryChannelId) errors.push({
      code: "CHARACTER_AGENT_AFFECTIVE_CHANNEL_UNKNOWN",
      path: "privateExpressionTrace.affectiveInfluence.primaryChannelId",
      message: `Unknown affective channel ${primaryChannelId}.`,
    });
    const knownEmotionIds = new Set(CHARACTER_PSYCHOLOGY_EMOTION_IDS);
    for (const emotionId of sourceEmotionIds) {
      if (!knownEmotionIds.has(emotionId)) errors.push({
        code: "CHARACTER_AGENT_AFFECTIVE_INFLUENCE_SOURCE_UNKNOWN",
        path: "privateExpressionTrace.affectiveInfluence.sourceEmotionIds",
        message: `Unknown emotion ${emotionId}.`,
      });
    }
    const liveResidualIds = (session.regulationOutcome?.residualEmotion || [])
      .filter((row) => Number(row?.value || 0) >= 0.18)
      .map((row) => clean(row?.emotionId))
      .filter(Boolean);
    const liveResidualIdSet = new Set(liveResidualIds);
    for (const emotionId of sourceEmotionIds) {
      if (knownEmotionIds.has(emotionId) && !liveResidualIdSet.has(emotionId)) errors.push({
        code: "CHARACTER_AGENT_AFFECTIVE_INFLUENCE_SOURCE_NOT_LIVE",
        path: "privateExpressionTrace.affectiveInfluence.sourceEmotionIds",
        message: `Emotion ${emotionId} is not a material post-regulation residual for this turn.`,
      });
    }
    if (liveResidualIds.length && clean(influence.mode) === "no_live_influence") errors.push({
      code: "CHARACTER_AGENT_AFFECTIVE_INFLUENCE_LIVE_SOURCE_IGNORED",
      path: "privateExpressionTrace.affectiveInfluence.sourceEmotionIds",
      message: "Live post-regulation affect must be acknowledged privately even when the Character contains it completely.",
    });
    const liveLeakageChannels = new Set(Object.entries(
      session.regulationOutcome?.channelLeakagePressures || {},
    )
      .filter(([, value]) => Number(value || 0) >= 0.08)
      .map(([channelId]) => clean(channelId))
      .filter(Boolean));
    if (primaryChannelId && !liveLeakageChannels.has(primaryChannelId)) errors.push({
      code: "CHARACTER_AGENT_AFFECTIVE_CHANNEL_NOT_LIVE",
      path: "privateExpressionTrace.affectiveInfluence.primaryChannelId",
      message: `Affective channel ${primaryChannelId} has no material post-regulation pressure in this turn.`,
    });
    if (sourceEmotionIds.length && clean(influence.mode) !== "no_live_influence" && !primaryChannelId) errors.push({
      code: "CHARACTER_AGENT_AFFECTIVE_CHANNEL_MISSING",
      path: "privateExpressionTrace.affectiveInfluence.primaryChannelId",
      message: "A live affective influence must name the primary real channel this Character is shaping, containing, displacing, or allowing to leak.",
    });
    if (clean(influence.mode) === "no_live_influence" && (sourceEmotionIds.length || primaryChannelId)) errors.push({
      code: "CHARACTER_AGENT_AFFECTIVE_NO_INFLUENCE_CONTRADICTION",
      path: "privateExpressionTrace.affectiveInfluence",
      message: "No-live-influence cannot also cite a live emotion or channel.",
    });
    if (!liveResidualIds.length && clean(influence.mode) !== "no_live_influence") errors.push({
      code: "CHARACTER_AGENT_AFFECTIVE_INFLUENCE_WITHOUT_LIVE_RESIDUE",
      path: "privateExpressionTrace.affectiveInfluence.mode",
      message: "A turn with no material post-regulation residual must use no_live_influence.",
    });
    if (!clean(influence.privateBasis)) errors.push({
      code: "CHARACTER_AGENT_AFFECTIVE_INFLUENCE_BASIS_MISSING",
      path: "privateExpressionTrace.affectiveInfluence.privateBasis",
      message: "The Character Agent must privately distinguish containment from absence of emotion.",
    });
  }
  for (const forbidden of [
    "releasedMeaning", "intendedEffect", "appliedVoiceParameters",
    "realizedSpeechHabitIds", "emotionHandling", "intentionalDepartureReason",
    "relationshipRegister",
  ]) {
    if (Object.prototype.hasOwnProperty.call(trace, forbidden)) errors.push({
      code: "CHARACTER_AGENT_ATOMIC_EXPRESSION_SELF_CERTIFICATION_FORBIDDEN",
      path: `privateExpressionTrace.${forbidden}`,
      message: "Atomic submission must not recreate a proposition plan or self-certify voice parameters, habits, regulation handling, or register after producing the public expression.",
    });
  }
  return errors;
}

function atomicRealizationFromCommit(session, commit) {
  const expression = commit.publicExpression || {};
  const bodyDelta = normalizePublicDelta(expression.bodyDelta);
  const submittedUtterance = expression.utterance || {};
  const literalSpeech = clean(submittedUtterance.literalSpeech);
  const observedSemantics = observePublicSpeechSemantics(session, literalSpeech);
  return {
    ownerAuthority: "character-agent",
    agentTurnId: session.agentTurnId,
    emotionHandling: [],
    realizedSpeechHabitIds: [],
    surfaceRealization: {
      timing: clean(expression.timing) || "silence",
      affectiveTexture: clone(expression.affectiveDeltas || []),
      relationshipRegister: "",
      appliedVoiceParameters: {},
      intentionalDepartureReason: "",
    },
    embodiedIntent: {
      manner: "",
      posture: "",
      intendedGesture: bodyDelta,
      bodyActions: clone(expression.bodyActions || []),
    },
    utterance: {
      literalSpeech,
      vocalMode: clean(submittedUtterance.vocalMode) || "conversational",
      // Public semantic classification happens after literal generation. It
      // keeps older world adapters working without giving a pre-generation
      // label a vote over the Character's wording.
      speechAct: observedSemantics.speechAct,
      speechFunctions: observedSemantics.speechFunctions,
    },
    actionAttempt: clone(commit.actionAttempt || {}),
  };
}

function atomicSpeechRealizationPlan(trace = {}, publicExpression = {}) {
  return {
    timing: clean(publicExpression.timing) || "silence",
    propositionalPayload: [],
    affectiveTexture: clone(publicExpression.affectiveDeltas || []),
    mayReveal: [],
    withhold: [],
    relationshipRegister: "",
    appliedVoiceParameters: {},
    intentionalDepartureReason: "",
    intendedListenerEffect: "",
    selfCheck: {},
  };
}

/**
 * Accept one holistic Character-owned commit after candidate evaluation.
 * The private choice and expression trace remain inside the session. Only the
 * ActionAttempt and observable PublicExpression cross the world boundary.
 */
export function submitCharacterAgentTurnCommit(session, commit) {
  assertPhase(session, "awaiting_agent_turn_commit");
  const errors = [];
  if (!commit || typeof commit !== "object" || Array.isArray(commit)) {
    throw protocolError(
      "CHARACTER_AGENT_TURN_COMMIT_REJECTED",
      "Character Agent atomic commit must be an object.",
      { issues: [{ code: "CHARACTER_AGENT_TURN_COMMIT_MISSING", path: "turnCommit", message: "Atomic turn commit is required." }] },
    );
  }
  if (commit.ownerAuthority !== "character-agent") errors.push({
    code: "CHARACTER_AGENT_TURN_COMMIT_AUTHORITY_INVALID",
    path: "ownerAuthority",
    message: "Only the Character Agent may own an atomic turn commit.",
  });
  if (clean(commit.agentTurnId) !== session.agentTurnId) errors.push({
    code: "CHARACTER_AGENT_TURN_COMMIT_ID_MISMATCH",
    path: "agentTurnId",
    message: "Atomic turn commit belongs to another Agent turn.",
  });
  if (Object.prototype.hasOwnProperty.call(commit, "worldOutcome")) errors.push({
    code: "CHARACTER_AGENT_TURN_COMMIT_WORLD_OUTCOME_FORBIDDEN",
    path: "worldOutcome",
    message: "A Character Agent may submit an attempt, never its objective result.",
  });
  if (Object.prototype.hasOwnProperty.call(commit, "privateChoice")) errors.push({
    code: "CHARACTER_AGENT_TURN_COMMIT_CHOICE_REOPEN_FORBIDDEN",
    path: "privateChoice",
    message: "The Character Agent already chose and received its regulation result; the final commit may not reopen that choice.",
  });
  if (!session.agentChoice || !session.regulationOutcome) errors.push({
    code: "CHARACTER_AGENT_TURN_COMMIT_REGULATION_REQUIRED",
    path: "regulationOutcome",
    message: "The Character Agent must receive its private regulation result before committing action and expression.",
  });
  errors.push(...validateAtomicPrivateExpressionTrace(session, commit.privateExpressionTrace));
  errors.push(...validateAtomicConversationAnchorSelection(session, commit));
  errors.push(...validateAtomicPublicExpression(session, commit.publicExpression, commit.actionAttempt));
  if (commit.actionAttempt?.primitive === "wait" && !validWaitCondition(commit.actionAttempt.waitCondition)) errors.push({
    code: "CHARACTER_AGENT_WAIT_CONDITION_INVALID", path: "actionAttempt.waitCondition",
    message: "Waiting requires the Character's own condition, maximumSeconds from 1 to 86400 and interruptOnDirectSpeech boolean.",
  });
  if (clean(commit.privateExpressionTrace?.affectiveInfluence?.mode) === "leak_publicly"
    && !(commit.publicExpression?.affectiveDeltas || []).some((row) => clean(row?.feature))) {
    errors.push({
      code: "CHARACTER_AGENT_AFFECTIVE_PUBLIC_LEAK_DELTA_MISSING",
      path: "publicExpression.affectiveDeltas",
      message: "When the Character chooses public affective leakage, the PublicExpression must contain the newly observable delta.",
    });
  }
  if (clean(commit.privateExpressionTrace?.affectiveInfluence?.mode) !== "leak_publicly"
    && (commit.publicExpression?.affectiveDeltas || []).some((row) => clean(row?.feature))) {
    errors.push({
      code: "CHARACTER_AGENT_PUBLIC_AFFECTIVE_LEAK_NOT_CHOSEN",
      path: "publicExpression.affectiveDeltas",
      message: "Public affective deltas require this Character Agent to choose public leakage; private containment cannot silently become observable expression.",
    });
  }
  const primaryAffectiveChannel = clean(commit.privateExpressionTrace?.affectiveInfluence?.primaryChannelId);
  for (const [index, delta] of (commit.publicExpression?.affectiveDeltas || []).entries()) {
    if (Number(session.regulationOutcome?.channelLeakagePressures?.[delta.channel] || 0) < 0.08) errors.push({
      code: "CHARACTER_AGENT_AFFECTIVE_CHANNEL_NOT_LIVE", path: `publicExpression.affectiveDeltas[${index}].channel`,
      message: "A public affective cue must use a channel with actual post-regulation pressure, even when copied private channel metadata is omitted.",
    });
  }
  if (clean(commit.privateExpressionTrace?.affectiveInfluence?.mode) === "leak_publicly"
    && primaryAffectiveChannel
    && !(commit.publicExpression?.affectiveDeltas || []).some((row) => clean(row?.channel) === primaryAffectiveChannel)) {
    errors.push({
      code: "CHARACTER_AGENT_PUBLIC_AFFECTIVE_CHANNEL_MISMATCH",
      path: "publicExpression.affectiveDeltas",
      message: "A public affective leak must use the primary channel chosen by this Character Agent.",
    });
  }
  if (!commit.actionAttempt || typeof commit.actionAttempt !== "object" || Array.isArray(commit.actionAttempt)) errors.push({
    code: "CHARACTER_AGENT_ATOMIC_ACTION_ATTEMPT_MISSING",
    path: "actionAttempt",
    message: "Atomic submission needs one ActionAttempt.",
  });
  if (errors.length) {
    throw protocolError(
      "CHARACTER_AGENT_TURN_COMMIT_REJECTED",
      "Character Agent atomic commit failed authority, reference, or privacy validation.",
      { issues: errors },
    );
  }

  const choice = session.agentChoice;
  const regulationOutcome = session.regulationOutcome;
  const validationSession = session;
  const realization = atomicRealizationFromCommit(session, commit);
  const postMathErrors = [
    ...validateRealizedActionIdentity(validationSession, realization),
  ];
  if (postMathErrors.length) {
    throw protocolError(
      "CHARACTER_AGENT_TURN_COMMIT_REJECTED",
      "Character Agent atomic commit failed post-regulation or action-identity validation.",
      { issues: postMathErrors },
    );
  }

  const publicExpression = commit.publicExpression;
  const observedInteractionMove = clean(realization.utterance.speechAct || "none");
  const finalDecision = {
    ownerAuthority: "character-agent",
    schemaVersion: 3,
    agentTurnId: session.agentTurnId,
    generatedCandidates: clone(session.generatedCandidates),
    selectedCandidateId: choice.selectedCandidateId,
    regulationChoice: clone(choice.regulationChoice),
    goalPreservation: clone(choice.goalPreservation),
    emotionHandling: [],
    realizedSpeechHabitIds: [],
    communicationPlan: {
      goal: atomicCommunicationGoal(observedInteractionMove),
      tactic: atomicCommunicationTactic(observedInteractionMove),
      disclosure: "withhold",
      epistemicRelation: "not_applicable",
      intendedAudienceCharacterIds: unique(publicExpression.audienceCharacterIds || []),
      desiredEffect: "",
      threadDisposition: clean(commit.conversationAnchorSelection?.postTurnDisposition),
      epistemicActionCandidateId: "",
      presuppositionStance: "not_applicable",
      epistemicBasisEvidenceIds: [],
      subtext: "",
    },
    speechRealizationPlan: atomicSpeechRealizationPlan({}, publicExpression),
    embodiedIntent: clone(realization.embodiedIntent),
    utterance: clone(realization.utterance),
    actionAttempt: clone(realization.actionAttempt),
    sharedActivity: clone(realizationSelectedAction(session).sharedActivity || null),
    privateDecisionBasis: clean(choice.privateDecisionBasis),
    continuationIntentions: clone(choice.continuationIntentions || []),
  };
  const validation = validateCharacterAgentDecisionV3(finalDecision, {
    candidateIds: session.generatedCandidates.map((row) => row.candidateId),
  });
  if (!validation.valid) {
    throw protocolError(
      "CHARACTER_AGENT_TURN_COMMIT_REJECTED",
      "Character Agent atomic commit failed final decision validation.",
      { issues: validation.errors },
    );
  }
  const publicCommit = {
    authority: "character-agent-public-commit",
    agentTurnId: session.agentTurnId,
    characterId: session.characterId,
    actionAttempt: clone(commit.actionAttempt),
    publicExpression: clone(publicExpression),
  };
  return {
    ...clone(session),
    phase: "ready_for_world_resolution",
    agentChoice: clone(choice),
    regulationOutcome,
    regulatedExpressionPlan: null,
    turnCommit: clone(commit),
    publicCommit,
    finalDecision,
    history: [...session.history, historyEntry("agent_turn_commit_accepted", choice.selectedCandidateId)],
  };
}

/** Accept literal realization untouched; only authority and schema are checked. */
export function submitCharacterAgentRealization(session, realization) {
  assertPhase(session, "awaiting_agent_realization");
  if (!realization || typeof realization !== "object" || Array.isArray(realization)) {
    throw protocolError("CHARACTER_AGENT_REALIZATION_REQUIRED", "Character Agent realization must be an object.");
  }
  if (realization.ownerAuthority !== "character-agent") {
    throw protocolError("CHARACTER_AGENT_REALIZATION_AUTHORITY_INVALID", "Only the Character Agent may realize its choice.");
  }
  if (clean(realization.agentTurnId) !== session.agentTurnId) {
    throw protocolError("CHARACTER_AGENT_REALIZATION_TURN_MISMATCH", "Realization belongs to another Agent turn.");
  }
  const emotionHandlingErrors = validateRealizationEmotionHandling(session, realization);
  const speechHabitErrors = validateRealizedSpeechHabits(session, realization);
  const actionIdentityErrors = validateRealizedActionIdentity(session, realization);
  if (emotionHandlingErrors.length || speechHabitErrors.length || actionIdentityErrors.length) {
    throw protocolError(
      "CHARACTER_AGENT_REALIZATION_CONTRACT_REJECTED",
      "Character Agent realization did not satisfy its affective or listener-facing expression contract.",
      { issues: [...emotionHandlingErrors, ...speechHabitErrors, ...actionIdentityErrors] },
    );
  }
  const publicStance = session.regulatedExpressionPlan.publicStance || {};
  const finalDecision = {
    ownerAuthority: "character-agent",
    schemaVersion: 3,
    agentTurnId: session.agentTurnId,
    generatedCandidates: clone(session.generatedCandidates),
    selectedCandidateId: session.agentChoice.selectedCandidateId,
    regulationChoice: clone(session.agentChoice.regulationChoice),
    goalPreservation: clone(session.agentChoice.goalPreservation),
    emotionHandling: clone(realization.emotionHandling),
    realizedSpeechHabitIds: clone(realization.realizedSpeechHabitIds || []),
    communicationPlan: {
      goal: clean(publicStance.interactionMove) === "ask" ? "obtain_information" : "none",
      tactic: ["evade", "redirect"].includes(clean(publicStance.interactionMove))
        ? clean(publicStance.interactionMove)
        : clean(publicStance.interactionMove) === "mislead" ? "lie" : "direct",
      disclosure: clean(publicStance.disclosure || "withhold"),
      epistemicRelation: clean(publicStance.epistemicRelation || "not_applicable"),
      intendedAudienceCharacterIds: unique(publicStance.audienceCharacterIds || []),
      desiredEffect: clean(publicStance.intendedEffect),
      threadDisposition: clean(publicStance.threadDisposition || "none"),
      epistemicActionCandidateId: "",
      presuppositionStance: "not_applicable",
      epistemicBasisEvidenceIds: [],
      subtext: "",
    },
    speechRealizationPlan: materializeAgentOwnedSpeechPlan(session.regulatedExpressionPlan, realization),
    embodiedIntent: clone(realization.embodiedIntent),
    utterance: clone(realization.utterance),
    actionAttempt: clone(realization.actionAttempt),
    sharedActivity: clone(realizationSelectedAction(session).sharedActivity || null),
    privateDecisionBasis: clean(session.agentChoice.privateDecisionBasis),
    continuationIntentions: clone(session.agentChoice.continuationIntentions || []),
  };
  const validation = validateCharacterAgentDecisionV3(finalDecision, {
    candidateIds: session.generatedCandidates.map((row) => row.candidateId),
  });
  if (!validation.valid) {
    throw protocolError(
      "CHARACTER_AGENT_REALIZATION_REJECTED",
      "Character Agent realization failed authority or schema validation.",
      { issues: validation.errors },
    );
  }
  return {
    ...clone(session),
    phase: "ready_for_world_resolution",
    finalDecision,
    history: [...session.history, historyEntry("agent_realization_accepted", session.agentChoice.selectedCandidateId)],
  };
}

/** Attach a result produced by the world. No psychological update is inferred. */
export function attachCharacterAgentWorldOutcome(session, worldOutcome) {
  assertPhase(session, "ready_for_world_resolution");
  if (!worldOutcome || typeof worldOutcome !== "object" || Array.isArray(worldOutcome)) {
    throw protocolError("CHARACTER_AGENT_WORLD_OUTCOME_REQUIRED", "World outcome must be an object.");
  }
  if (worldOutcome.authority !== "world-resolution") {
    throw protocolError("CHARACTER_AGENT_WORLD_OUTCOME_AUTHORITY_INVALID", "Only world resolution may attach an objective result.");
  }
  return {
    ...clone(session),
    phase: "world_resolved",
    worldOutcome: clone(worldOutcome),
    history: [...session.history, historyEntry("world_outcome_attached", worldOutcome.outcomeId)],
  };
}
