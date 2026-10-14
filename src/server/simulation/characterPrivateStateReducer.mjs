import {
  advanceCharacterAgentMemory,
  applyCharacterCognitiveAppraisal,
  applyCharacterLocationBeliefUpdate,
  applyCharacterPrivateEntityModelUpdate,
  applyCharacterSourceKnowledgeBeliefUpdate,
  createCharacterAgentMemoryState,
  encodeCharacterPerception,
  normalizeCharacterAgentMemoryState,
} from "../../engine/characterAgentMemory.js";
import {
  mergeCharacterRecentOwnActions,
  seedCharacterOwnedOperationMemory,
} from "./characterOperationalContinuity.mjs";
import { advanceCharacterPsychologyCarryover } from "./characterPsychologyTools.mjs";
import { advanceCharacterReflectionOpportunity } from "./characterReflection.mjs";
import { applySettledCharacterActionPhysiology } from "./characterPhysiologyContinuity.mjs";
import { advanceCharacterConversationContinuity } from "./characterConversationContinuity.mjs";
import { isFirsthandRelationshipEvidence } from "./characterRelationshipEvidence.mjs";

export const CHARACTER_PRIVATE_STATE_REDUCER_VERSION = "character-private-state-reducer-v1";

const REQUIRED_STAGED_ACCEPTED_STAGES = Object.freeze([
  "subjective_appraisal_accepted",
  "agent_candidates_accepted",
  "agent_choice_accepted",
  "agent_expression_plan_accepted",
  "agent_realization_accepted",
]);
const REQUIRED_ATOMIC_ACCEPTED_STAGES = Object.freeze([
  "subjective_appraisal_accepted",
  "agent_candidates_accepted",
  "agent_choice_accepted",
  "agent_turn_commit_accepted",
]);

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function clamp01(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
}

function applyObjectiveBodyLoads(previousBody = {}, effects = [], ownerCharacterId = "") {
  const loads = (effects || []).filter((row) => (
    clean(row?.kind) === "body_load_applied"
    && clean(row?.targetActorId) === clean(ownerCharacterId)
  ));
  if (!loads.length) return { changed: false, body: clone(previousBody || {}), appliedLoads: [] };
  const body = clone(previousBody || {});
  const fields = ["hunger", "thirst", "pain", "exertion", "fatigue", "stamina", "energy"];
  for (const load of loads) {
    for (const field of fields) {
      const delta = Number(load?.[`${field}Delta`]);
      if (!Number.isFinite(delta) || delta === 0) continue;
      body[field] = clamp01(Number(body[field] || 0) + delta, Number(body[field] || 0));
    }
  }
  return { changed: true, body, appliedLoads: clone(loads) };
}

function fail(code, message, evidence = {}) {
  const error = new Error(message);
  error.code = code;
  error.evidence = clone(evidence);
  return error;
}

function confidenceBand(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "medium";
  if (numeric < 0.34) return "low";
  if (numeric < 0.67) return "medium";
  return "high";
}

function assertAcceptedSession(ownerCharacterId, session = {}) {
  if (clean(session.characterId) !== ownerCharacterId) {
    throw fail("CHARACTER_PRIVATE_REDUCER_OWNER_MISMATCH", "Accepted Character Agent session belongs to another owner.", {
      ownerCharacterId,
      sessionCharacterId: clean(session.characterId),
    });
  }
  if (!clean(session.agentTurnId)) {
    throw fail("CHARACTER_PRIVATE_REDUCER_TURN_ID_REQUIRED", "Accepted Character Agent session requires agentTurnId.");
  }
  if (clean(session.phase) !== "ready_for_world_resolution") {
    throw fail("CHARACTER_PRIVATE_REDUCER_SESSION_NOT_READY", "Only a complete Character Agent turn may update private state.", {
      phase: clean(session.phase),
    });
  }
  const accepted = new Set((session.history || []).map((row) => clean(row?.stage)));
  const requiredStages = clean(session.submissionMode) === "atomic"
    ? REQUIRED_ATOMIC_ACCEPTED_STAGES
    : REQUIRED_STAGED_ACCEPTED_STAGES;
  const missing = requiredStages.filter((stage) => !accepted.has(stage));
  if (missing.length) {
    throw fail("CHARACTER_PRIVATE_REDUCER_STAGE_HISTORY_INCOMPLETE", "Character Agent turn is missing accepted stages.", { missing });
  }
}

function evidenceOwner(record = {}) {
  return clean(record.recipientCharacterId || record.recipientId || record.characterId);
}

function normalizeEvidenceRecords(ownerCharacterId, records = []) {
  const output = [];
  for (const source of records || []) {
    const evidenceId = clean(source?.evidenceId);
    if (!evidenceId) continue;
    const owner = evidenceOwner(source);
    if (owner && owner !== ownerCharacterId) {
      throw fail("CHARACTER_PRIVATE_REDUCER_EVIDENCE_OWNER_MISMATCH", "Evidence belongs to another Character Agent.", {
        ownerCharacterId,
        evidenceOwner: owner,
        evidenceId,
      });
    }
    output.push({ ...clone(source), evidenceId, recipientCharacterId: ownerCharacterId });
  }
  return output;
}

function evidenceAliasIndex(records = []) {
  const aliases = new Map();
  for (const record of records) {
    for (const alias of unique([
      record.evidenceId,
      record.deliveryId,
      record.eventId,
      record.impactId,
      record.objectiveEventId,
      record.id,
    ])) aliases.set(alias, record.evidenceId);
  }
  return aliases;
}

function resolveEvidenceReferences(references = [], aliasIndex, field) {
  return unique(references).map((reference) => {
    const evidenceId = aliasIndex.get(reference);
    if (!evidenceId) {
      throw fail("CHARACTER_PRIVATE_REDUCER_EVIDENCE_NOT_OWNED", "Private transition references evidence that was not delivered to this Character Agent.", {
        field,
        reference,
      });
    }
    return evidenceId;
  });
}

function recursiveEvidenceReferences(value, path = "appraisal", output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    value.forEach((row, index) => recursiveEvidenceReferences(row, `${path}[${index}]`, output));
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (Array.isArray(child) && /(evidence|impact)ids$/iu.test(key)) {
      for (const reference of child) output.push({ reference: clean(reference), field: childPath });
    } else recursiveEvidenceReferences(child, childPath, output);
  }
  return output;
}

function cognitiveAppraisalForMemory(appraisal = {}) {
  return {
    noticedEvidenceIds: unique(appraisal.noticedEvidenceIds),
    interpretations: (appraisal.interpretations || []).map((row) => ({
      evidenceIds: unique(row?.evidenceIds),
      meaning: clean(row?.meaning),
      confidenceBand: clean(row?.confidenceBand) || confidenceBand(row?.confidence),
    })),
    beliefOperations: (appraisal.beliefOperations || []).map((row) => ({
      proposition: clean(row?.proposition),
      operation: clean(row?.operation),
      confidenceBand: clean(row?.confidenceBand) || confidenceBand(row?.confidence),
      sourceEvidenceIds: unique(row?.sourceEvidenceIds),
      reasoningMode: clean(row?.reasoningMode),
    })),
  };
}

export function encodeNoticedEvidence(memoryState, record, ownerCharacterId, nowSeconds) {
  const impactId = clean(record.impactId || record.eventId || record.objectiveEventId || record.evidenceId);
  return encodeCharacterPerception(memoryState, {
    impact: {
      id: impactId,
      objectiveEventId: clean(record.objectiveEventId || record.eventId || impactId),
      sourceCharacterId: clean(record.sourceCharacterId),
      type: clean(record.eventKind || record.type),
      modality: clean(record.modality),
      content: clean(record.content),
      topic: clean(record.topic),
      semanticFrame: clone(record.semanticFrame || {}),
    },
    delivery: {
      ...clone(record),
      id: clean(record.deliveryId || record.evidenceId),
      evidenceId: record.evidenceId,
      impactId,
      objectiveEventId: clean(record.objectiveEventId || record.eventId || impactId),
      recipientId: ownerCharacterId,
      perceivedSourceCharacterId: clean(record.perceivedSourceCharacterId || record.sourceCharacterId),
      sourceEntityHandle: clean(record.sourceEntityHandle || record.sourceCharacterId),
      identityKnown: record.identityKnown !== false,
      directed: record.directed === true,
      receivedIntensity: Number(record.receivedIntensity || 0),
      personalRelevance: Number(record.personalRelevance || 0),
      semanticFrame: clone(record.semanticFrame || {}),
      provenance: clone(record.provenance || {}),
    },
    provenance: clone(record.provenance || {}),
    encodingContext: clone(record.encodingContext || {
      attention: 0.72,
      goalRelevance: Math.max(0, Math.min(1, Number(record.personalRelevance || 50) / 100)),
      surprise: 0.3,
      emotionalArousal: 0.3,
      selfRelevance: Math.max(0, Math.min(1, Number(record.personalRelevance || 50) / 100)),
      relationshipRelevance: clean(record.sourceCharacterId) ? 0.45 : 0.1,
      fatigue: 0,
      cognitiveLoad: 0.2,
    }),
    interpretation: clean(record.content),
    nowSeconds,
    worldDay: Math.max(0, Number(record.worldDay || 0)),
    locationId: clean(record.locationId || record.placeId),
    zoneId: clean(record.recipientZoneId || record.zoneId),
  });
}

function knownCanonicalEntityHandles(evidenceRecords = []) {
  return unique((evidenceRecords || []).flatMap((record) => {
    if (record?.identityKnown === false) return [];
    return [record?.sourceCharacterId, record?.perceivedSourceCharacterId];
  })).filter((handle) => /^char_/u.test(handle));
}

function applySpecializedMemoryUpdates(
  memory,
  appraisal,
  allowedEvidenceIds,
  allowedCanonicalEntityHandles,
  nowSeconds,
) {
  let next = memory;
  const steps = [
    ["entityModelUpdates", applyCharacterPrivateEntityModelUpdate],
    ["locationBeliefUpdates", applyCharacterLocationBeliefUpdate],
    ["sourceKnowledgeBeliefUpdates", applyCharacterSourceKnowledgeBeliefUpdate],
  ];
  for (const [field, applyUpdate] of steps) {
    for (const update of appraisal[field] || []) {
      const result = applyUpdate(next, update, {
        allowedEvidenceIds,
        allowedCanonicalEntityHandles,
        nowSeconds,
      });
      if (!result.valid) {
        const evidenceViolation = (result.violations || []).some((row) => /EVIDENCE_NOT_OWNED$/u.test(clean(row?.code)));
        throw fail(
          evidenceViolation
            ? "CHARACTER_PRIVATE_REDUCER_EVIDENCE_NOT_OWNED"
            : "CHARACTER_PRIVATE_REDUCER_SPECIALIZED_UPDATE_REJECTED",
          evidenceViolation
            ? "A specialized private belief update used evidence outside this Character Agent's ownership."
            : "A specialized private belief update violated its character-owned handle contract.", {
          field,
          violations: clone(result.violations || []),
          },
        );
      }
      next = result.memory;
    }
  }
  return next;
}

function selectedEvaluation(session = {}, candidateId = "") {
  const source = session.candidateEvaluation || {};
  const rows = Array.isArray(source)
    ? source
    : source.evaluations || source.candidateEvaluations || source.results || [];
  return clone(rows.find((row) => clean(row?.candidateId) === candidateId) || {});
}

function relationshipTransition({
  ownerCharacterId,
  previousRelationshipContext = [],
  appraisal = {},
  policy = {},
  evidenceRecords = [],
  aliasIndex,
  noticedEvidenceIds = [],
  nowSeconds = 0,
} = {}) {
  const context = clone(previousRelationshipContext || []);
  const targetCharacterId = clean(appraisal.targetCharacterId);
  const changeMode = clean(appraisal.changeMode || "none");
  if (changeMode === "none") return context;
  if (!targetCharacterId || targetCharacterId === ownerCharacterId) {
    throw fail("CHARACTER_PRIVATE_REDUCER_RELATIONSHIP_TARGET_INVALID", "Private relationship appraisal requires another target Character.");
  }
  const sourceEvidenceIds = resolveEvidenceReferences(appraisal.sourceImpactIds || [], aliasIndex, "relationshipAppraisal.sourceImpactIds");
  const noticed = new Set(noticedEvidenceIds);
  if (sourceEvidenceIds.some((id) => !noticed.has(id))) {
    throw fail("CHARACTER_PRIVATE_REDUCER_RELATIONSHIP_SOURCE_NOT_NOTICED", "Relationship appraisal may use only evidence this Character Agent noticed.", {
      sourceEvidenceIds,
    });
  }
  const metricIds = new Set(unique(policy.metricIds));
  const deltaByStrength = { low: 1, medium: 3, high: 6, ...(policy.deltaByStrength || {}) };
  for (const change of appraisal.dimensionChanges || []) {
    if (!metricIds.has(clean(change?.metric))) {
      throw fail("CHARACTER_PRIVATE_REDUCER_RELATIONSHIP_METRIC_INVALID", "Relationship appraisal uses a metric outside the active relationship policy.", {
        metric: clean(change?.metric),
      });
    }
  }
  if (changeMode === "retained") {
    const recordByEvidence = new Map(evidenceRecords.map((row) => [row.evidenceId, row]));
    const firsthand = sourceEvidenceIds.some((id) => {
      const row = recordByEvidence.get(id) || {};
      return isFirsthandRelationshipEvidence(row, targetCharacterId);
    });
    if (!firsthand) {
      throw fail("CHARACTER_PRIVATE_REDUCER_RELATIONSHIP_FIRSTHAND_REQUIRED", "A retained relationship change requires firsthand evidence about the target.");
    }
  }
  let row = context.find((item) => (
    clean(item?.fromCharacterId) === ownerCharacterId
    && clean(item?.toCharacterId) === targetCharacterId
  ));
  if (!row) {
    row = {
      id: `relationship:${ownerCharacterId}:${targetCharacterId}`,
      fromCharacterId: ownerCharacterId,
      toCharacterId: targetCharacterId,
    };
    context.push(row);
  }
  const historyRow = {
    ownerAuthority: "character-agent",
    agentTurnId: clean(appraisal.agentTurnId),
    targetCharacterId,
    sourceEvidenceIds,
    changeMode,
    dimensionChanges: clone(appraisal.dimensionChanges || []),
    reason: clean(appraisal.reason),
    atSeconds: Math.max(0, Number(nowSeconds || 0)),
  };
  row.privateAppraisalHistory = [...(row.privateAppraisalHistory || []), historyRow].slice(-12);
  if (changeMode === "retained") {
    for (const change of appraisal.dimensionChanges || []) {
      const metric = clean(change.metric);
      const magnitude = Number(deltaByStrength[clean(change.strengthBand)] || 0);
      const direction = clean(change.direction) === "decrease" ? -1 : 1;
      row[metric] = Math.max(0, Math.min(100, Number(row[metric] || 0) + direction * magnitude));
    }
  }
  return context;
}

function conversationThreadStates(previous = {}, appraisals = [], agentTurnId = "", nowSeconds = 0) {
  const output = clone(previous || {});
  for (const appraisal of appraisals || []) {
    const threadId = clean(appraisal.threadId || appraisal.id);
    if (!threadId) continue;
    output[threadId] = {
      ...(output[threadId] || {}),
      ...clone(appraisal),
      ownerAuthority: "character-agent",
      lastAppraisedAtAgentTurnId: agentTurnId,
      lastAppraisedAtSeconds: Math.max(0, Number(nowSeconds || 0)),
    };
  }
  return output;
}

function appendExperiencedConversationTurns(previous = [], additions = []) {
  const byId = new Map((previous || []).flatMap((row) => {
    const id = clean(row?.id);
    return id ? [[id, clone(row)]] : [];
  }));
  for (const row of additions || []) {
    const id = clean(row?.id);
    if (id) byId.set(id, clone(row));
  }
  return [...byId.values()]
    .sort((left, right) => Number(left.occurredAtSeconds || 0) - Number(right.occurredAtSeconds || 0))
    .slice(-16);
}

function incomingExperiencedConversationTurns(ownerCharacterId, evidenceRecords = [], noticedEvidenceIds = [], nowSeconds = 0) {
  const noticed = new Set(unique(noticedEvidenceIds));
  return (evidenceRecords || []).flatMap((row) => {
    if (!noticed.has(clean(row?.evidenceId)) || clean(row?.eventKind || row?.type) !== "speech" || !clean(row?.content)) return [];
    const provenance = row.provenance && typeof row.provenance === "object" ? row.provenance : {};
    const sourceActionId = clean(row.sourceActionId || provenance.sourceActionId);
    const sourceThreadId = clean(
      row.sourceThreadId
      || row.conversationThreadHandle
      || provenance.sourceThreadId,
    );
    const responseToTurnId = clean(row.responseToTurnId || provenance.responseToTurnId);
    const sourceHandle = clean(
      row.sourceEntityHandle
      || row.perceivedSourceCharacterId
      || row.sourceCharacterId
      || "unresolved_speaker",
    );
    return [{
      id: sourceActionId || `public-turn:${clean(row.evidenceId)}`,
      authority: "recipient-experienced-literal-history",
      sourceActionId,
      sourceThreadId,
      responseToTurnId,
      threadId: sourceThreadId || `thread:${ownerCharacterId}:${sourceHandle}`,
      speakerId: sourceHandle,
      addresseeId: row.directed === true ? ownerCharacterId : "",
      utterance: clean(row.content),
      speechAct: clean(row.speechAct || "inform"),
      speechFunctions: unique(row.speechFunctions || []),
      directed: row.directed === true,
      evidenceId: clean(row.evidenceId),
      provenance: clone(provenance),
      occurredAtSeconds: Math.max(0, Number(row.occurredAtSeconds ?? nowSeconds ?? 0)),
      truthStatus: "literal-public-content-not-automatically-verified",
    }];
  });
}

function advanceNoticedSpeechConversationState(
  ownerCharacterId,
  previousConversationState,
  evidenceRecords = [],
  noticedEvidenceIds = [],
  nowSeconds = 0,
) {
  const noticed = new Set(unique(noticedEvidenceIds));
  let conversationState = clone(previousConversationState || null);
  for (const row of evidenceRecords || []) {
    if (
      !noticed.has(clean(row?.evidenceId))
      || clean(row?.eventKind || row?.type) !== "speech"
      || !clean(row?.content)
    ) continue;
    const provenance = row.provenance && typeof row.provenance === "object" ? row.provenance : {};
    const sourceActionId = clean(row.sourceActionId || provenance.sourceActionId);
    const sourceThreadId = clean(
      row.sourceThreadId
      || row.conversationThreadHandle
      || provenance.sourceThreadId,
    );
    const sourceParticipantHandle = clean(
      row.sourceEntityHandle
      || row.perceivedSourceCharacterId
      || row.sourceCharacterId,
    );
    if (!sourceActionId || !sourceThreadId || !sourceParticipantHandle) continue;
    conversationState = advanceCharacterConversationContinuity({
      ownerCharacterId,
      conversationState,
      experience: {
        kind: "noticed_speech_delivery",
        runtimeRecord: {
          authority: "runtime-noticed-speech-delivery",
          deliveryId: clean(row.deliveryId || row.evidenceId),
          recipientCharacterId: ownerCharacterId,
          noticed: true,
          eventKind: "speech",
          sourceParticipantHandle,
          directed: row.directed === true,
          content: clean(row.content),
          speechAct: clean(row.speechAct || "inform"),
          occurredAtSeconds: Math.max(0, Number(row.occurredAtSeconds ?? nowSeconds ?? 0)),
          threadStatus: "open",
          resumable: true,
          provenance: {
            sourceActionId,
            sourceThreadId,
            responseToTurnId: clean(row.responseToTurnId || provenance.responseToTurnId),
          },
        },
      },
      nowSeconds,
    }).conversationState;
  }
  return conversationState;
}

function outgoingExperiencedConversationTurn(ownerCharacterId, pendingAttempt = {}, worldOutcome = {}, surfaceRows = [], nowSeconds = 0) {
  const speech = actualSpeechFromSurface(surfaceRows);
  if (!speech) return null;
  const speechDelivery = (worldOutcome.deliveries || []).find((row) => (
    clean(row?.eventKind) === "speech"
    && clean(row?.sourceCharacterId) === clean(ownerCharacterId)
  )) || null;
  const emittedSurface = (surfaceRows || []).find((row) => clean(row?.kind) === "utterance_emitted") || null;
  const provenanceSource = speechDelivery?.provenance || emittedSurface?.provenance;
  const provenance = provenanceSource && typeof provenanceSource === "object" ? provenanceSource : {};
  const sourceActionId = clean(provenance.sourceActionId || worldOutcome.actionAttemptId);
  const sourceThreadId = clean(provenance.sourceThreadId);
  const responseToTurnId = clean(provenance.responseToTurnId);
  const targetHandle = clean(
    pendingAttempt.selectedCandidate?.targetHandle
    || pendingAttempt.actionAttempt?.targetCharacterId,
  );
  return {
    id: sourceActionId || `public-turn:${clean(worldOutcome.actionAttemptId)}`,
    authority: "recipient-experienced-literal-history",
    sourceActionId,
    sourceThreadId,
    responseToTurnId,
    threadId: sourceThreadId || (targetHandle ? `thread:${ownerCharacterId}:${targetHandle}` : `thread:${ownerCharacterId}:public`),
    speakerId: ownerCharacterId,
    addresseeId: targetHandle,
    utterance: speech,
    speechAct: clean(pendingAttempt.utterance?.speechAct || "inform"),
    speechFunctions: unique(pendingAttempt.utterance?.speechFunctions || []),
    directed: Boolean(targetHandle),
    evidenceId: "",
    provenance: clone(provenance),
    occurredAtSeconds: Math.max(0, Number(nowSeconds || 0)),
    truthStatus: "literal-public-content-not-automatically-verified",
  };
}

function advanceSettledSpeechConversationState({
  ownerCharacterId,
  previousConversationState,
  pendingAttempt,
  worldOutcome,
  outgoingTurn,
  nowSeconds,
} = {}) {
  if (
    !outgoingTurn
    || !clean(outgoingTurn.utterance)
    || !clean(outgoingTurn.sourceActionId)
    || !clean(outgoingTurn.sourceThreadId)
  ) return clone(previousConversationState || null);
  const disposition = clean(pendingAttempt?.communicationPlan?.threadDisposition || "none");
  const closesForSelf = ["settle", "refuse", "close_for_self"].includes(disposition);
  const intendedParticipantHandles = unique([
    ...(pendingAttempt?.communicationPlan?.intendedAudienceCharacterIds || []),
    pendingAttempt?.actionAttempt?.targetCharacterId,
  ]).filter((handle) => handle !== clean(ownerCharacterId));
  const targetParticipantHandles = intendedParticipantHandles.length
    ? intendedParticipantHandles
    : unique(clean(pendingAttempt?.selectedCandidate?.actionBinding?.kind) === "character"
      ? [pendingAttempt?.selectedCandidate?.targetHandle]
      : [])
      .filter((handle) => handle !== clean(ownerCharacterId));
  const actualRecipientParticipantHandles = unique((worldOutcome?.deliveries || [])
    .filter((row) => (
      clean(row?.eventKind) === "speech"
      && clean(row?.sourceCharacterId) === clean(ownerCharacterId)
    ))
    .map((row) => pendingAttempt?.participantHandleByCharacterId?.[clean(row?.recipientCharacterId)]))
    .filter((handle) => handle !== clean(ownerCharacterId));
  return advanceCharacterConversationContinuity({
    ownerCharacterId,
    conversationState: previousConversationState,
    experience: {
      kind: "settled_outgoing_speech",
      runtimeRecord: {
        authority: "world-settled-outgoing-speech",
        settlementId: clean(worldOutcome.outcomeId),
        actorCharacterId: ownerCharacterId,
        outcomeStatus: "settled",
        eventKind: "speech",
        content: clean(outgoingTurn.utterance),
        speechAct: clean(outgoingTurn.speechAct || "inform"),
        targetParticipantHandles,
        actualRecipientParticipantHandles,
        occurredAtSeconds: Math.max(0, Number(outgoingTurn.occurredAtSeconds ?? nowSeconds ?? 0)),
        threadStatus: closesForSelf ? "closed" : "open",
        resumable: !closesForSelf,
        provenance: {
          sourceActionId: clean(outgoingTurn.sourceActionId),
          sourceThreadId: clean(outgoingTurn.sourceThreadId),
          responseToTurnId: clean(outgoingTurn.responseToTurnId),
        },
      },
    },
    nowSeconds,
  }).conversationState;
}

function settleOwnConversationThreadStates(
  previous = {},
  pendingAttempt = {},
  worldOutcome = {},
  outgoingTurn = null,
  nowSeconds = 0,
) {
  const output = clone(previous || {});
  if (!outgoingTurn) return output;
  const disposition = clean(pendingAttempt.communicationPlan?.threadDisposition || "none");
  if (disposition === "none" || disposition === "open_new") return output;
  const threadId = clean(outgoingTurn.threadId);
  if (!threadId) return output;
  const closesForSelf = ["settle", "refuse", "close_for_self"].includes(disposition);
  output[threadId] = {
    ...(output[threadId] || {}),
    id: threadId,
    ownerAuthority: "character-agent",
    status: closesForSelf ? "closed_for_self" : "open",
    selfClosure: closesForSelf ? "closed_for_self" : "open",
    responseNeed: closesForSelf ? "none" : clean(output[threadId]?.responseNeed || "low"),
    lastOwnDisposition: disposition,
    lastOwnTurnId: clean(outgoingTurn.id),
    lastUpdatedAtSeconds: Math.max(0, Number(nowSeconds || 0)),
  };
  return output;
}

function retainedImmediateSelfEvidenceAfterTurn(previous = [], noticedEvidenceIds = []) {
  const noticed = new Set(unique(noticedEvidenceIds));
  return (previous || []).filter((row) => !noticed.has(clean(row?.evidenceId))).map(clone).slice(-24);
}

function retainImmediateSelfEvidence(previous = [], worldOutcome = {}, ownerCharacterId = "", nowSeconds = 0) {
  const byEvidenceId = new Map((previous || []).flatMap((row) => {
    const evidenceId = clean(row?.evidenceId);
    return evidenceId ? [[evidenceId, clone(row)]] : [];
  }));
  for (const row of worldOutcome.deliveries || []) {
    const recipientId = clean(row?.recipientCharacterId || row?.recipientId);
    const eventKind = clean(row?.eventKind);
    if (recipientId !== ownerCharacterId || !["observation_result", "listening_result", "own_action_result"].includes(eventKind)) continue;
    const deliveryId = clean(row.deliveryId || row.id) || `delivery:${clean(worldOutcome.eventId)}:${ownerCharacterId}:${eventKind}`;
    const evidenceId = clean(row.evidenceId) || `evidence:${deliveryId}`;
    byEvidenceId.set(evidenceId, {
      ...clone(row),
      id: deliveryId,
      deliveryId,
      evidenceId,
      eventId: clean(worldOutcome.eventId),
      objectiveEventId: clean(worldOutcome.eventId),
      recipientId: ownerCharacterId,
      recipientCharacterId: ownerCharacterId,
      characterId: ownerCharacterId,
      occurredAtSeconds: Math.max(0, Number(nowSeconds || 0)),
      retainedFromImmediateEmbodiedBeat: true,
    });
  }
  return [...byEvidenceId.values()].slice(-24);
}

export function reduceCharacterPrivateTurn({
  ownerCharacterId = "",
  previousPrivateState = {},
  acceptedSession = {},
  ownedEvidenceRecords = [],
  ownedParticipantHandleByCharacterId = {},
  nowSeconds = 0,
  relationshipPolicy = {},
} = {}) {
  const ownerId = clean(ownerCharacterId);
  if (!ownerId || (clean(previousPrivateState.ownerCharacterId) && clean(previousPrivateState.ownerCharacterId) !== ownerId)) {
    throw fail("CHARACTER_PRIVATE_REDUCER_OWNER_MISMATCH", "Private state owner does not match the Character Agent.", {
      ownerCharacterId: ownerId,
      privateStateOwner: clean(previousPrivateState.ownerCharacterId),
    });
  }
  assertAcceptedSession(ownerId, acceptedSession);
  const transitionId = `private-turn:${acceptedSession.agentTurnId}`;
  const evidenceRecords = normalizeEvidenceRecords(ownerId, ownedEvidenceRecords);
  const aliasIndex = evidenceAliasIndex(evidenceRecords);
  const appraisal = clone(acceptedSession.subjectiveAppraisal || {});
  const noticedEvidenceIds = resolveEvidenceReferences(
    appraisal.noticedEvidenceIds || [],
    aliasIndex,
    "subjectiveAppraisal.noticedEvidenceIds",
  );
  const noticedSet = new Set(noticedEvidenceIds);
  const appraisalReferences = recursiveEvidenceReferences({
    interpretations: appraisal.interpretations || [],
    beliefOperations: appraisal.beliefOperations || [],
    entityModelUpdates: appraisal.entityModelUpdates || [],
    locationBeliefUpdates: appraisal.locationBeliefUpdates || [],
    sourceKnowledgeBeliefUpdates: appraisal.sourceKnowledgeBeliefUpdates || [],
    threadAppraisals: appraisal.threadAppraisals || [],
    relationshipAppraisal: appraisal.relationshipAppraisal || {},
    priorActionOutcomeAppraisal: appraisal.priorActionOutcomeAppraisal || {},
    desireGroundings: appraisal.desireGroundings || [],
    generatedCandidates: acceptedSession.generatedCandidates || [],
    automaticCommunicationImpulse: acceptedSession.agentChoice?.automaticCommunicationImpulse || {},
    communicationPlan: acceptedSession.finalDecision?.communicationPlan || {},
  });
  const appraisedEvidenceIds = unique(appraisalReferences.map(({ reference, field }) => {
    const evidenceId = resolveEvidenceReferences([reference], aliasIndex, field)[0];
    if (!noticedSet.has(evidenceId)) {
      throw fail("CHARACTER_PRIVATE_REDUCER_APPRAISAL_SOURCE_NOT_NOTICED", "Private appraisal used evidence that the Character Agent did not report noticing.", {
        field,
        evidenceId,
      });
    }
    return evidenceId;
  }));

  let memory = normalizeCharacterAgentMemoryState(
    previousPrivateState.memoryContext || createCharacterAgentMemoryState(ownerId),
    ownerId,
  );
  memory = advanceCharacterAgentMemory(memory, { nowSeconds });
  const reflectionPreviousMemory = clone(memory);
  const recordByEvidenceId = new Map(evidenceRecords.map((row) => [row.evidenceId, row]));
  for (const evidenceId of noticedEvidenceIds) {
    memory = encodeNoticedEvidence(memory, recordByEvidenceId.get(evidenceId), ownerId, nowSeconds);
  }
  const cognitive = applyCharacterCognitiveAppraisal(
    memory,
    cognitiveAppraisalForMemory({ ...appraisal, noticedEvidenceIds }),
    { allowedEvidenceIds: noticedEvidenceIds, nowSeconds },
  );
  if (!cognitive.valid) {
    throw fail("CHARACTER_PRIVATE_REDUCER_EVIDENCE_NOT_OWNED", "Character cognitive appraisal failed its evidence ownership contract.", {
      violations: clone(cognitive.violations || []),
    });
  }
  memory = applySpecializedMemoryUpdates(
    cognitive.memory,
    appraisal,
    noticedEvidenceIds,
    knownCanonicalEntityHandles(evidenceRecords),
    nowSeconds,
  );
  const reflectionTransition = advanceCharacterReflectionOpportunity({
    ownerCharacterId: ownerId,
    previousMemoryState: reflectionPreviousMemory,
    nextMemoryState: memory,
    reflectionState: previousPrivateState.reflectionState || null,
    nowSeconds,
  });

  const selectedCandidateId = clean(acceptedSession.agentChoice?.selectedCandidateId || acceptedSession.finalDecision?.selectedCandidateId);
  const selectedCandidate = clone((acceptedSession.generatedCandidates || [])
    .find((row) => clean(row?.candidateId) === selectedCandidateId) || {});
  const previousEcology = clone(previousPrivateState.ecologyState || {});
  const psychology = advanceCharacterPsychologyCarryover({
    previous: clone(previousEcology.characterPsychologyV2State || {}),
    snapshot: clone(acceptedSession.psychologySnapshot || {}),
    regulationOutcome: clone(acceptedSession.regulationOutcome || {}),
    profile: clone(acceptedSession.privateContext?.profile || {}),
    objectiveOutcome: null,
    selectedCandidate,
    selectedEvaluation: selectedEvaluation(acceptedSession, selectedCandidateId),
    agentChoice: clone(acceptedSession.agentChoice || {}),
    worldTimeSeconds: Math.max(0, Number(nowSeconds || 0)),
  });
  const relationshipAppraisal = {
    ...clone(appraisal.relationshipAppraisal || {}),
    agentTurnId: acceptedSession.agentTurnId,
  };
  const relationshipContext = relationshipTransition({
    ownerCharacterId: ownerId,
    previousRelationshipContext: previousPrivateState.relationshipContext || [],
    appraisal: relationshipAppraisal,
    policy: relationshipPolicy,
    evidenceRecords,
    aliasIndex,
    noticedEvidenceIds,
    nowSeconds,
  });

  const attemptId = `action-attempt:${acceptedSession.agentTurnId}`;
  const hasAttempt = clean(acceptedSession.finalDecision?.actionAttempt?.primitive)
    && clean(acceptedSession.finalDecision?.actionAttempt?.primitive) !== "none";
  const pendingAttemptContinuityById = clone(previousPrivateState.pendingAttemptContinuityById || {});
  if (hasAttempt) pendingAttemptContinuityById[attemptId] = {
    ownerAuthority: "character-agent",
    actionAttemptId: attemptId,
    sourceAgentTurnId: acceptedSession.agentTurnId,
    selectedCandidateId,
    selectedCandidate,
    actionAttempt: clone(acceptedSession.finalDecision.actionAttempt || {}),
    utterance: clone(acceptedSession.finalDecision.utterance || {}),
    communicationPlan: clone(acceptedSession.finalDecision.communicationPlan || {}),
    embodiedIntent: clone(acceptedSession.finalDecision.embodiedIntent || {}),
    realizedSpeechHabitIds: clone(acceptedSession.finalDecision.realizedSpeechHabitIds || []),
    participantHandleByCharacterId: clone(ownedParticipantHandleByCharacterId || {}),
  };
  const appliedPrivateTransitionIds = unique([
    ...(previousPrivateState.appliedPrivateTransitionIds || []),
    transitionId,
  ]).slice(-64);
  const retainedImmediateSelfEvidence = retainedImmediateSelfEvidenceAfterTurn(
    previousPrivateState.retainedImmediateSelfEvidence,
    noticedEvidenceIds,
  );
  const experiencedConversationTurns = appendExperiencedConversationTurns(
    previousPrivateState.experiencedConversationTurns,
    incomingExperiencedConversationTurns(ownerId, evidenceRecords, noticedEvidenceIds, nowSeconds),
  );
  const conversationState = advanceNoticedSpeechConversationState(
    ownerId,
    previousPrivateState.conversationState,
    evidenceRecords,
    noticedEvidenceIds,
    nowSeconds,
  );
  return {
    schemaVersion: CHARACTER_PRIVATE_STATE_REDUCER_VERSION,
    authority: "character-private-state-reducer",
    ownerCharacterId: ownerId,
    transitionId,
    privateStatePatch: {
      memoryContext: memory,
      reflectionState: reflectionTransition.reflectionState,
      relationshipContext,
      conversationThreadStates: conversationThreadStates(
        previousPrivateState.conversationThreadStates,
        appraisal.threadAppraisals,
        acceptedSession.agentTurnId,
        nowSeconds,
      ),
      ecologyState: {
        ...previousEcology,
        characterPsychologyV2State: psychology,
      },
      lastAgentTurnId: acceptedSession.agentTurnId,
      lastSelectedCandidateId: selectedCandidateId,
      lastRelationshipAppraisal: relationshipAppraisal,
      appliedPrivateTransitionIds,
      pendingAttemptContinuityById,
      retainedImmediateSelfEvidence,
      experiencedConversationTurns,
      conversationState,
    },
    receiptTransitions: {
      authority: "character-agent",
      noticedEvidenceIds,
      appraisedEvidenceIds,
      consumedEvidenceIds: [],
    },
    diagnostics: {
      memoryEpisodeCount: memory.episodes.length,
      appraisedEvidenceCount: appraisedEvidenceIds.length,
      relationshipChangeMode: clean(relationshipAppraisal.changeMode || "none"),
      reflectionOpportunityId: clean(reflectionTransition.dueOpportunity?.opportunityId),
      conversationAnchorCount: Number(conversationState?.threads?.length || 0),
    },
  };
}

function assertWorldOutcome(ownerCharacterId, previousPrivateState = {}, worldOutcome = {}) {
  if (!ownerCharacterId
    || (clean(previousPrivateState.ownerCharacterId) && clean(previousPrivateState.ownerCharacterId) !== ownerCharacterId)) {
    throw fail("CHARACTER_PRIVATE_REDUCER_OWNER_MISMATCH", "Private state owner does not match the Character Agent.", {
      ownerCharacterId,
      privateStateOwner: clean(previousPrivateState.ownerCharacterId),
    });
  }
  if (clean(worldOutcome.authority) !== "world-resolution") {
    throw fail("CHARACTER_PRIVATE_OUTCOME_AUTHORITY_INVALID", "Only world resolution may update objective outcome continuity.");
  }
  if (clean(worldOutcome.actorId) !== ownerCharacterId) {
    throw fail("CHARACTER_PRIVATE_OUTCOME_OWNER_MISMATCH", "World outcome belongs to another Character Actor.", {
      ownerCharacterId,
      outcomeActorId: clean(worldOutcome.actorId),
    });
  }
  const outcomeId = clean(worldOutcome.outcomeId);
  const actionAttemptId = clean(worldOutcome.actionAttemptId);
  if (!outcomeId) {
    throw fail("CHARACTER_PRIVATE_OUTCOME_ID_REQUIRED", "World outcome requires outcomeId.");
  }
  if (!actionAttemptId) {
    throw fail("CHARACTER_PRIVATE_OUTCOME_ATTEMPT_ID_REQUIRED", "World outcome requires actionAttemptId.");
  }
  return { outcomeId, actionAttemptId };
}

function appliedOutcomeRecord(previousPrivateState = {}, outcomeId = "") {
  const record = (previousPrivateState.appliedPrivateOutcomeRecords || [])
    .find((row) => clean(row?.outcomeId) === outcomeId);
  if (record) return record;
  return (previousPrivateState.appliedPrivateOutcomeIds || []).includes(outcomeId)
    ? { outcomeId, actionAttemptId: "" }
    : null;
}

function outcomeSurfaceRows(worldOutcome = {}, ownerCharacterId = "") {
  return (worldOutcome.attemptSurface || [])
    .filter((row) => clean(row?.actorId) === ownerCharacterId)
    .map(clone);
}

function actualSpeechFromSurface(surfaceRows = []) {
  return clean(surfaceRows.find((row) => (
    clean(row?.kind) === "utterance_emitted" && clean(row?.utterance)
  ))?.utterance);
}

function actualVisibleActionFromSurface(surfaceRows = []) {
  return unique(surfaceRows.map((row) => row?.visibleAction)).join("；");
}

function surfaceSummary(surfaceRows = [], speech = "", visibleAction = "") {
  if (clean(speech)) return clean(speech);
  if (clean(visibleAction)) return clean(visibleAction);
  return surfaceRows.map((row) => {
    const kind = clean(row?.kind);
    const anchor = clean(
      row?.targetCharacterId
      || row?.objectId
      || row?.positionId
      || row?.destinationId
      || row?.toZoneId
      || row?.targetId,
    );
    const operation = clean(row?.operation);
    return [kind, anchor, operation].filter(Boolean).join(":");
  }).filter(Boolean).join("；");
}

function idsFromObjectiveRows(rows = [], keys = []) {
  return unique((rows || []).flatMap((row) => keys.map((key) => row?.[key])));
}

function settledOwnEvent({
  ownerCharacterId,
  pendingAttempt,
  worldOutcome,
  surfaceRows,
  nowSeconds,
} = {}) {
  if (!surfaceRows.length) return null;
  const speech = actualSpeechFromSurface(surfaceRows);
  const visibleAction = actualVisibleActionFromSurface(surfaceRows);
  const summary = surfaceSummary(surfaceRows, speech, visibleAction);
  const speechDeliveryProvenance = (worldOutcome.deliveries || []).find((row) => (
    clean(row?.eventKind) === "speech"
    && clean(row?.sourceCharacterId) === clean(ownerCharacterId)
  ))?.provenance;
  const speechSurfaceProvenance = surfaceRows.find((row) => clean(row?.kind) === "utterance_emitted")?.provenance;
  const speechProvenance = speech ? clone(speechDeliveryProvenance || speechSurfaceProvenance || {}) : {};
  const resultRows = [
    ...(worldOutcome.resolvedEffects || []),
    ...(worldOutcome.failedEffects || []),
    ...(worldOutcome.incidentalEffects || []),
  ];
  const counterpartyIds = idsFromObjectiveRows(surfaceRows, ["targetCharacterId"])
    .filter((id) => id !== ownerCharacterId);
  const objectIds = unique([
    ...idsFromObjectiveRows(surfaceRows, ["objectId", "sourceObjectId", "positionId"]),
    ...idsFromObjectiveRows(resultRows, ["objectId", "sourceObjectId", "positionId"]),
  ]);
  const destinationId = clean(surfaceRows.find((row) => (
    clean(row?.destinationId || row?.toZoneId)
  ))?.destinationId || surfaceRows.find((row) => clean(row?.toZoneId))?.toZoneId);
  return {
    schemaVersion: 1,
    authority: "objective-settlement-provenance",
    id: `settled-operation:${clean(worldOutcome.actionAttemptId)}`,
    actionId: clean(worldOutcome.actionAttemptId),
    worldOutcomeId: clean(worldOutcome.outcomeId),
    objectiveEventId: clean(worldOutcome.eventId),
    actorId: ownerCharacterId,
    kind: clean(surfaceRows[0]?.kind || worldOutcome.primitive || "interact"),
    actionType: clean(worldOutcome.primitive || "interact"),
    status: clean(worldOutcome.status || "settled"),
    summary,
    visibleAction,
    speech,
    speechAct: speech ? clean(pendingAttempt?.utterance?.speechAct || "none") : "none",
    speechFunctions: speech ? unique(pendingAttempt?.utterance?.speechFunctions || []) : [],
    sourceActionId: clean(speechProvenance.sourceActionId),
    sourceThreadId: clean(speechProvenance.sourceThreadId),
    responseToTurnId: clean(speechProvenance.responseToTurnId),
    provenance: speech ? speechProvenance : {},
    zoneId: clean(surfaceRows.find((row) => clean(row?.zoneId))?.zoneId || destinationId),
    objectIds,
    counterpartyIds,
    participantIds: unique([ownerCharacterId, ...counterpartyIds]),
    sharedWithActorIds: counterpartyIds,
    occurredAtSeconds: Math.max(0, Number(nowSeconds || 0)),
    objectiveSurface: clone(surfaceRows),
  };
}

function appendSettledEvent(previous = [], event = null) {
  const rows = clone(previous || []);
  if (!event) return rows;
  const actionId = clean(event.actionId);
  if (rows.some((row) => clean(row?.actionId) === actionId || clean(row?.id) === clean(event.id))) return rows;
  return [...rows, clone(event)].slice(-64);
}

function appendCommittedSpeechHabitUsage(history = [], {
  ownerCharacterId,
  pendingAttempt,
  worldOutcome,
  actualSpeech,
} = {}) {
  const rows = clone(history || []);
  const pendingSpeech = clean(pendingAttempt?.utterance?.literalSpeech);
  const realizedHabitIds = unique(pendingAttempt?.realizedSpeechHabitIds || []);
  const actionId = clean(worldOutcome.actionAttemptId);
  const committedSpeech = Boolean(
    clean(worldOutcome.primitive) === "speak"
    && clean(actualSpeech)
    && pendingSpeech
    && clean(actualSpeech) === pendingSpeech,
  );
  if (!committedSpeech || !realizedHabitIds.length || rows.some((row) => clean(row?.actionId) === actionId)) return rows;
  return [...rows, {
    actionId,
    characterId: ownerCharacterId,
    committed: true,
    turnIndex: Math.max(0, Math.round(Number(worldOutcome.worldVersion || 0))),
    realizedHabitIds,
  }].slice(-32);
}

function sanitizedPendingObjectiveOutcome(worldOutcome = {}, surfaceRows = []) {
  const speech = actualSpeechFromSurface(surfaceRows);
  const visibleAction = actualVisibleActionFromSurface(surfaceRows);
  return {
    authority: "world-resolution",
    outcomeId: clean(worldOutcome.outcomeId),
    actionAttemptId: clean(worldOutcome.actionAttemptId),
    sourceAgentTurnId: clean(worldOutcome.agentTurnId),
    status: clean(worldOutcome.status),
    committed: surfaceRows.length > 0,
    visibleOutcome: surfaceSummary(surfaceRows, speech, visibleAction),
    failureCodes: unique((worldOutcome.failedEffects || []).map((row) => row?.code)),
    requiresCharacterAppraisal: true,
    inferredSatisfaction: null,
    inferredFrustration: null,
    inferredRelationshipChange: null,
    inferredIdentityRevision: null,
  };
}

/**
 * Apply only objective consequences that already happened to the same Actor.
 * The result preserves them as future private evidence; it never decides what
 * the person felt, believed, wanted, or became because of the outcome.
 */
/**
 * Performance-mode private transition. Everything the character was shown is
 * remembered, their own stated thought becomes the current intention, and the
 * attempt they chose is registered so its world outcome can be applied. No
 * appraisal, belief or relationship change is inferred on their behalf.
 */
export function reduceCharacterPerformanceTurn({
  ownerCharacterId = "",
  previousPrivateState = {},
  agentTurnId = "",
  ownedEvidenceRecords = [],
  actionAttempt = null,
  thought = "",
  ownedParticipantHandleByCharacterId = {},
  nowSeconds = 0,
} = {}) {
  const ownerId = clean(ownerCharacterId);
  if (!ownerId || (clean(previousPrivateState.ownerCharacterId) && clean(previousPrivateState.ownerCharacterId) !== ownerId)) {
    throw fail("CHARACTER_PRIVATE_REDUCER_OWNER_MISMATCH", "Private state owner does not match the Character Agent.", {
      ownerCharacterId: ownerId,
      privateStateOwner: clean(previousPrivateState.ownerCharacterId),
    });
  }
  const turnId = clean(agentTurnId);
  const transitionId = `private-turn:${turnId}`;
  const evidenceRecords = normalizeEvidenceRecords(ownerId, ownedEvidenceRecords);
  const noticedEvidenceIds = unique(evidenceRecords.map((row) => row.evidenceId));
  let memory = normalizeCharacterAgentMemoryState(
    previousPrivateState.memoryContext || createCharacterAgentMemoryState(ownerId),
    ownerId,
  );
  memory = advanceCharacterAgentMemory(memory, { nowSeconds });
  for (const record of evidenceRecords) memory = encodeNoticedEvidence(memory, record, ownerId, nowSeconds);

  const attemptId = `action-attempt:${turnId}`;
  const pendingAttemptContinuityById = clone(previousPrivateState.pendingAttemptContinuityById || {});
  const primitive = clean(actionAttempt?.primitive);
  if (primitive && primitive !== "none") {
    const utterance = clean(actionAttempt.payload?.utterance);
    pendingAttemptContinuityById[attemptId] = {
      ownerAuthority: "character-agent",
      actionAttemptId: attemptId,
      sourceAgentTurnId: turnId,
      selectedCandidateId: "",
      selectedCandidate: { intention: clean(thought) },
      actionAttempt: clone(actionAttempt),
      utterance: utterance
        ? { text: utterance, speechAct: clean(actionAttempt.payload?.speechAct || "inform"), speechFunctions: clone(actionAttempt.payload?.speechFunctions || []) }
        : {},
      communicationPlan: {},
      embodiedIntent: {},
      realizedSpeechHabitIds: [],
      participantHandleByCharacterId: clone(ownedParticipantHandleByCharacterId || {}),
    };
  }
  return {
    schemaVersion: CHARACTER_PRIVATE_STATE_REDUCER_VERSION,
    authority: "character-private-state-reducer",
    ownerCharacterId: ownerId,
    transitionId,
    privateStatePatch: {
      memoryContext: memory,
      ...(clean(thought) ? { currentIntention: clean(thought) } : {}),
      lastAgentTurnId: turnId,
      appliedPrivateTransitionIds: unique([...(previousPrivateState.appliedPrivateTransitionIds || []), transitionId]).slice(-64),
      pendingAttemptContinuityById,
      retainedImmediateSelfEvidence: retainedImmediateSelfEvidenceAfterTurn(previousPrivateState.retainedImmediateSelfEvidence, noticedEvidenceIds),
      experiencedConversationTurns: appendExperiencedConversationTurns(
        previousPrivateState.experiencedConversationTurns,
        incomingExperiencedConversationTurns(ownerId, evidenceRecords, noticedEvidenceIds, nowSeconds),
      ),
      conversationState: advanceNoticedSpeechConversationState(ownerId, previousPrivateState.conversationState, evidenceRecords, noticedEvidenceIds, nowSeconds),
    },
    receiptTransitions: {
      authority: "character-agent",
      noticedEvidenceIds,
      appraisedEvidenceIds: [],
      consumedEvidenceIds: [],
    },
  };
}

export function reduceCharacterPrivateWorldOutcome({
  ownerCharacterId = "",
  previousPrivateState = {},
  worldOutcome = {},
  nowSeconds = 0,
} = {}) {
  const ownerId = clean(ownerCharacterId);
  const { outcomeId, actionAttemptId } = assertWorldOutcome(ownerId, previousPrivateState, worldOutcome);
  const alreadyApplied = appliedOutcomeRecord(previousPrivateState, outcomeId);
  if (alreadyApplied) {
    if (clean(alreadyApplied.actionAttemptId) && clean(alreadyApplied.actionAttemptId) !== actionAttemptId) {
      throw fail("CHARACTER_PRIVATE_OUTCOME_ID_COLLISION", "An outcome id was already applied to another action attempt.", {
        outcomeId,
        previousActionAttemptId: clean(alreadyApplied.actionAttemptId),
        actionAttemptId,
      });
    }
    return {
      schemaVersion: CHARACTER_PRIVATE_STATE_REDUCER_VERSION,
      authority: "character-private-state-reducer",
      ownerCharacterId: ownerId,
      transitionId: `private-outcome:${outcomeId}`,
      idempotent: true,
      privateStatePatch: {},
      diagnostics: { outcomeId, actionAttemptId, alreadyApplied: true },
    };
  }

  const pendingAttempts = clone(previousPrivateState.pendingAttemptContinuityById || {});
  const pendingAttempt = pendingAttempts[actionAttemptId];
  if (!pendingAttempt || clean(pendingAttempt.actionAttemptId) !== actionAttemptId) {
    throw fail("CHARACTER_PRIVATE_OUTCOME_ATTEMPT_UNKNOWN", "World outcome does not match this Actor's pending private attempt.", {
      ownerCharacterId: ownerId,
      actionAttemptId,
    });
  }
  if (clean(worldOutcome.agentTurnId)
    && clean(pendingAttempt.sourceAgentTurnId)
    && clean(worldOutcome.agentTurnId) !== clean(pendingAttempt.sourceAgentTurnId)) {
    throw fail("CHARACTER_PRIVATE_OUTCOME_TURN_MISMATCH", "World outcome belongs to another Character Agent turn.", {
      outcomeAgentTurnId: clean(worldOutcome.agentTurnId),
      pendingAgentTurnId: clean(pendingAttempt.sourceAgentTurnId),
    });
  }

  const surfaceRows = outcomeSurfaceRows(worldOutcome, ownerId);
  const event = settledOwnEvent({
    ownerCharacterId: ownerId,
    pendingAttempt,
    worldOutcome,
    surfaceRows,
    nowSeconds,
  });
  const settledInteractionEvents = appendSettledEvent(previousPrivateState.settledInteractionEvents, event);
  const recentOwnActions = mergeCharacterRecentOwnActions({
    characterId: ownerId,
    settledInteractionEvents,
    runtimeActions: [],
  });
  let memoryContext = normalizeCharacterAgentMemoryState(
    previousPrivateState.memoryContext || createCharacterAgentMemoryState(ownerId),
    ownerId,
  );
  const reflectionPreviousMemory = clone(memoryContext);
  if (event) {
    memoryContext = seedCharacterOwnedOperationMemory(memoryContext, {
      characterId: ownerId,
      settledInteractionEvents: [event],
      nowSeconds,
      worldDay: Math.floor(Math.max(0, Number(nowSeconds || 0)) / 86400),
      locationId: clean(event.placeId),
      zoneId: clean(event.zoneId),
    });
  }
  const reflectionTransition = advanceCharacterReflectionOpportunity({
    ownerCharacterId: ownerId,
    previousMemoryState: reflectionPreviousMemory,
    nextMemoryState: memoryContext,
    reflectionState: previousPrivateState.reflectionState || null,
    nowSeconds,
  });

  const previousEcology = clone(previousPrivateState.ecologyState || {});
  const previousPsychology = clone(previousEcology.characterPsychologyV2State || {});
  const pendingObjectiveOutcome = sanitizedPendingObjectiveOutcome(worldOutcome, surfaceRows);
  // Action physiology is the generic cost/recovery of a successfully settled
  // primitive. Objective world effects remain authoritative and are applied
  // afterwards, while basal wall-clock change is owned by the runtime sync.
  const actionPhysiologyEcology = applySettledCharacterActionPhysiology({
    ecologyState: previousEcology,
    actionOutcome: worldOutcome,
  });
  const actionPhysiologyApplied = JSON.stringify(actionPhysiologyEcology.body || {})
    !== JSON.stringify(previousEcology.body || {});
  const bodyTransition = applyObjectiveBodyLoads(
    actionPhysiologyEcology.body || {},
    worldOutcome.resolvedEffects || [],
    ownerId,
  );
  const voiceHabitUsage = appendCommittedSpeechHabitUsage(previousEcology.voiceHabitUsage, {
    ownerCharacterId: ownerId,
    pendingAttempt,
    worldOutcome,
    actualSpeech: actualSpeechFromSurface(surfaceRows),
  });
  const nextEcology = {
    ...actionPhysiologyEcology,
    ...(bodyTransition.changed ? { body: bodyTransition.body } : {}),
    voiceHabitUsage,
    characterPsychologyV2State: {
      ...previousPsychology,
      pendingObjectiveOutcome,
      forbiddenInference: {
        ...(previousPsychology.forbiddenInference || {}),
        desireSatisfactionNotInferred: true,
        frustrationNotInferred: true,
        relationshipChangeNotInferred: true,
        identityRevisionNotInferred: true,
      },
    },
    lastOutcome: {
      outcomeId,
      actionAttemptId,
      status: clean(worldOutcome.status),
      worldVersion: Number(worldOutcome.worldVersion || 0),
    },
  };

  delete pendingAttempts[actionAttemptId];
  const appliedPrivateOutcomeIds = unique([
    ...(previousPrivateState.appliedPrivateOutcomeIds || []),
    outcomeId,
  ]).slice(-64);
  const appliedPrivateOutcomeRecords = [
    ...(previousPrivateState.appliedPrivateOutcomeRecords || []).filter((row) => clean(row?.outcomeId) !== outcomeId),
    { outcomeId, actionAttemptId },
  ].slice(-64);
  const retainedImmediateSelfEvidence = retainImmediateSelfEvidence(
    previousPrivateState.retainedImmediateSelfEvidence,
    worldOutcome,
    ownerId,
    nowSeconds,
  );
  const experiencedConversationTurns = appendExperiencedConversationTurns(
    previousPrivateState.experiencedConversationTurns,
    [outgoingExperiencedConversationTurn(ownerId, pendingAttempt, worldOutcome, surfaceRows, nowSeconds)].filter(Boolean),
  );
  const outgoingConversationTurn = outgoingExperiencedConversationTurn(
    ownerId,
    pendingAttempt,
    worldOutcome,
    surfaceRows,
    nowSeconds,
  );
  const nextConversationThreadStates = settleOwnConversationThreadStates(
    previousPrivateState.conversationThreadStates,
    pendingAttempt,
    worldOutcome,
    outgoingConversationTurn,
    nowSeconds,
  );
  const conversationState = advanceSettledSpeechConversationState({
    ownerCharacterId: ownerId,
    previousConversationState: previousPrivateState.conversationState,
    pendingAttempt,
    worldOutcome,
    outgoingTurn: outgoingConversationTurn,
    nowSeconds,
  });
  return {
    schemaVersion: CHARACTER_PRIVATE_STATE_REDUCER_VERSION,
    authority: "character-private-state-reducer",
    ownerCharacterId: ownerId,
    transitionId: `private-outcome:${outcomeId}`,
    idempotent: false,
    privateStatePatch: {
      memoryContext,
      reflectionState: reflectionTransition.reflectionState,
      settledInteractionEvents,
      recentOwnActions,
      ecologyState: nextEcology,
      pendingAttemptContinuityById: pendingAttempts,
      appliedPrivateOutcomeIds,
      appliedPrivateOutcomeRecords,
      retainedImmediateSelfEvidence,
      experiencedConversationTurns,
      conversationThreadStates: nextConversationThreadStates,
      conversationState,
      lastOutcome: {
        outcomeId,
        eventId: clean(worldOutcome.eventId),
        actionAttemptId,
        agentTurnId: clean(worldOutcome.agentTurnId),
        primitive: clean(worldOutcome.primitive),
        status: clean(worldOutcome.status),
        worldVersion: Number(worldOutcome.worldVersion || 0),
        attemptSurface: clone(surfaceRows),
        resolvedEffects: clone(worldOutcome.resolvedEffects || []),
        failedEffects: clone(worldOutcome.failedEffects || []),
      },
    },
    diagnostics: {
      outcomeId,
      actionAttemptId,
      settledOwnEventCreated: Boolean(event),
      committedSpeechHabitRecorded: voiceHabitUsage.length > (previousEcology.voiceHabitUsage || []).length,
      actionPhysiologyApplied,
      physiologyCompositionOrder: "action_specific_then_objective_effects",
      objectiveBodyLoadsApplied: bodyTransition.appliedLoads.length,
      conversationAnchorCount: Number(conversationState?.threads?.length || 0),
      privateInferenceApplied: false,
    },
  };
}
