/**
 * Character-owned cognitive memory.
 *
 * World events remain objective in the world/scene layers. This module stores
 * only one character's encoded perception, current belief, and remembered
 * obligation. It never selects an action; it exposes bounded evidence and a
 * psychological influence trace for the Character Agent to use.
 */

export const CHARACTER_AGENT_MEMORY_SCHEMA_VERSION = 2;

const MAX_EPISODES = 96;
const MAX_BELIEFS = 64;
const MAX_COMMITMENTS = 40;
const MAX_IMPRESSIONS = 32;
const MAX_PRIVATE_ENTITY_MODELS = 48;
const MAX_LOCATION_BELIEFS = 40;
const MAX_SOURCE_KNOWLEDGE_BELIEFS = 64;
const MAX_EXPERIENCE_TRACES = 128;
// Recall instances are transient reconstructions, not durable experiences.
// Keep only a compact recent audit window; immutable traces and episodes carry
// long-term continuity without multiplying every retrieval into saved state.
const MAX_RECALL_INSTANCES = 16;
const BELIEF_OPERATIONS = new Set(["adopt", "revise", "doubt", "reject", "suspend"]);
const BELIEF_REASONING_MODES = new Set(["direct", "inference", "rumor", "guess", "confabulation"]);
const CONFIDENCE_BANDS = Object.freeze({ low: 0.28, medium: 0.56, high: 0.84 });
const DEFAULT_RECALL_PROFILE = Object.freeze({
  cueSensitivity: 1,
  rehearsalSensitivity: 1,
  goalCongruenceSensitivity: 1,
  affectBiasSensitivity: 1,
  beliefBiasSensitivity: 1,
  interferenceSensitivity: 1,
  suppressionSensitivity: 1,
  sourceSensitivity: 0.72,
  sourceConfusionRate: 0.14,
  rumination: 0.35,
});
const ROLE_KEYS = [
  "actor",
  "speaker",
  "addressee",
  "requester",
  "requestedActor",
  "beneficiary",
  "ultimateRecipient",
  "owner",
  "target",
  "giver",
  "receiver",
  "buyer",
  "seller",
  "debtor",
  "creditor",
  "witness",
];

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function clean(value, max = 260) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function clamp01(value, fallback = 0) {
  const number = Number(value);
  return Math.max(0, Math.min(1, Number.isFinite(number) ? number : fallback));
}

function logistic(value = 0) {
  return 1 / (1 + Math.exp(-Number(value || 0)));
}

function unique(values = []) {
  return [...new Set((values || []).map((value) => clean(value, 180)).filter(Boolean))];
}

function stablePart(value = "") {
  return clean(value, 180).replace(/[^\p{L}\p{N}:._-]+/gu, "_") || "unknown";
}

function normalizeSelfClaim(input = {}, ownerCharacterId = "", index = 0) {
  const source = typeof input === "string" ? { claim: input } : input || {};
  const claim = clean(source.claim || source.text || source.label, 300);
  return {
    id: clean(source.id || `self-claim:${stablePart(ownerCharacterId)}:${stablePart(claim || index)}`, 260),
    claim,
    confidence: clamp01(source.confidence, 0.72),
    adoptedAtSeconds: Math.max(0, Number(source.adoptedAtSeconds || 0)),
    sourceEpisodeIds: unique(source.sourceEpisodeIds || []).slice(-12),
    semanticFrameId: clean(source.semanticFrameId, 260),
  };
}

function sortedRoleEntries(roles = {}) {
  return Object.entries(roles || {})
    .filter(([, value]) => clean(value))
    .map(([role, value]) => [clean(role, 80), clean(value, 180)])
    .sort(([left], [right]) => left.localeCompare(right));
}

function normalizedRoles(roles = {}) {
  return Object.fromEntries(sortedRoleEntries(roles));
}

function frameObject(input = {}) {
  if (typeof input === "string") return { id: clean(input, 160), label: clean(input, 160) };
  return {
    id: clean(input?.id || input?.objectId, 160),
    label: clean(input?.label || input?.name || input?.description, 180),
  };
}

function normalizePerceivedActionResult(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const strings = value => Array.isArray(value)
    ? unique(value.filter(item => typeof item === "string").map(item => clean(item, 160))).slice(0, 32)
    : [];
  // Retain only the typed, owner-visible receipt. No raw world effects or
  // arbitrary nested fields may cross into Character memory through this field.
  return {
    status: typeof input.status === "string" ? clean(input.status, 80) : "",
    primitive: typeof input.primitive === "string" ? clean(input.primitive, 80) : "",
    failureCodes: strings(input.failureCodes),
    resolvedEffectKinds: strings(input.resolvedEffectKinds),
    incidentalEffectKinds: strings(input.incidentalEffectKinds),
    attemptSurfaceKinds: strings(input.attemptSurfaceKinds),
  };
}

export function normalizeSemanticFrame(input = {}) {
  const actionResult = normalizePerceivedActionResult(input.actionResult);
  const roles = normalizedRoles(input.roles || {});
  const predicate = clean(input.predicate || input.act || input.type || "observe", 120);
  const topicId = clean(input.topicId || input.topic || predicate, 140);
  const object = frameObject(input.object || { id: input.objectId, label: input.objectLabel });
  const roleSignature = sortedRoleEntries(roles).map(([role, value]) => `${role}=${value}`).join("|");
  const generatedId = `frame:${stablePart(predicate)}:${stablePart(topicId)}:${stablePart(object.id || object.label)}:${stablePart(roleSignature)}`;
  return {
    id: clean(input.id || generatedId, 420),
    kind: clean(input.kind || "observation", 80),
    predicate,
    topicId,
    roles,
    object,
    requestedAct: clean(input.requestedAct, 240),
    decisionValue: clean(input.decisionValue || input.outcome || "", 80),
    truthValue: clean(input.truthValue || input.value || "", 120),
    polarity: Number(input.polarity) < 0 ? -1 : 1,
    lexicalAnchors: unique([
      ...(input.lexicalAnchors || input.cues || []),
      ...(actionResult ? [actionResult.primitive, ...actionResult.failureCodes] : []),
    ]),
    importance: clamp01(input.importance, 0.5),
    parentFrameId: clean(input.parentFrameId, 260),
    ...(actionResult ? { actionResult } : {}),
  };
}

export function createCharacterAgentMemoryState(ownerCharacterId = "", options = {}) {
  const owner = clean(ownerCharacterId || options.ownerCharacterId, 180);
  return {
    schemaVersion: CHARACTER_AGENT_MEMORY_SCHEMA_VERSION,
    ownerCharacterId: owner,
    experienceTraces: [],
    episodes: [],
    beliefs: [],
    commitments: [],
    impressions: [],
    privateEntityModels: [],
    locationBeliefs: [],
    sourceKnowledgeBeliefs: [],
    recallInstances: [],
    selfNarrative: {
      currentClaims: (options.selfNarrative?.currentClaims || [])
        .map((claim, index) => normalizeSelfClaim(claim, owner, index))
        .filter((claim) => claim.claim),
      versions: clone(options.selfNarrative?.versions || []),
      pendingCandidates: clone(options.selfNarrative?.pendingCandidates || []).slice(-16),
    },
    lastAdvancedAtSeconds: Math.max(0, Number(options.nowSeconds || 0)),
    lastEncodedAtSeconds: 0,
  };
}

function normalizeSource(input = {}, delivery = {}, impact = {}) {
  const provenance = input.provenance || delivery.provenance || impact.provenance || {};
  const kind = clean(provenance.kind || "firsthand", 60);
  const directness = kind === "firsthand" ? (delivery.directed ? 1 : 0.82) : kind === "gossip" ? 0.38 : 0.58;
  const confidenceBase = {
    firsthand: delivery.directed ? 0.97 : 0.86,
    overheard: 0.76,
    reported: 0.64,
    gossip: 0.5,
    inference: 0.46,
    memory_retrieval: 0.7,
    memory: 0.72,
    self_action: 0.99,
    legacy_summary: 0.48,
  }[kind] ?? 0.58;
  const perceivedSourceCharacterId = Object.hasOwn(delivery, "perceivedSourceCharacterId")
    ? clean(delivery.perceivedSourceCharacterId, 180)
    : clean(delivery.sourceCharacterId || impact.sourceCharacterId, 180);
  const sourceEntityHandle = clean(delivery.sourceEntityHandle || delivery.perceptPacket?.perceivedEntityHandle, 220);
  const chain = unique([
    ...(provenance.sourceCharacterChain || provenance.characterChain || []),
    ...(!provenance.sourceCharacterChain?.length && provenance.claimedOriginalSourceId ? [provenance.claimedOriginalSourceId] : []),
    ...(!provenance.sourceCharacterChain?.length && perceivedSourceCharacterId ? [perceivedSourceCharacterId] : []),
  ]);
  return {
    kind,
    immediateSourceCharacterId: perceivedSourceCharacterId,
    sourceEntityHandle,
    identityKnown: delivery.identityKnown !== false,
    speakerCharacterId: clean(provenance.speakerCharacterId || perceivedSourceCharacterId, 180),
    claimedOriginalSourceId: clean(provenance.claimedOriginalSourceId, 180),
    characterChain: chain,
    sourceActionId: clean(provenance.sourceActionId || impact.causedByActionId, 220),
    sourceImpactIds: unique(provenance.sourceImpactIds || []),
    sourceThreadId: clean(provenance.sourceThreadId, 220),
    suspectedMotive: clean(provenance.suspectedMotive, 180),
    directness: clamp01(provenance.directness, directness),
    confidence: clamp01(provenance.confidence, confidenceBase),
  };
}

function deriveEncodingContext(delivery = {}, supplied = {}) {
  const received = clamp01(Number(delivery.receivedIntensity || 0) / 100, 0.45);
  const relevance = clamp01(Number(delivery.personalRelevance || 0) / 70, delivery.directed ? 0.72 : 0.35);
  return {
    attention: clamp01(supplied.attention, Math.max(0.25, received)),
    goalRelevance: clamp01(supplied.goalRelevance, relevance),
    surprise: clamp01(supplied.surprise, delivery.directed ? 0.28 : 0.42),
    emotionalArousal: clamp01(supplied.emotionalArousal, Math.min(0.8, Number(delivery.impactScore || 0) / 180)),
    selfRelevance: clamp01(supplied.selfRelevance, delivery.directed ? 0.8 : relevance * 0.65),
    relationshipRelevance: clamp01(supplied.relationshipRelevance, relevance * 0.75),
    fatigue: clamp01(supplied.fatigue, 0.2),
    cognitiveLoad: clamp01(supplied.cognitiveLoad, 0.2),
  };
}

/**
 * Weighted encoding formula. All inputs are [0, 1]. Personality/state may
 * supply different values; the shared formula stays common across people.
 */
export function calculateMemoryEncodingStrength(context = {}) {
  const c = deriveEncodingContext({}, context);
  const positive = 0.18
    + c.attention * 0.18
    + c.goalRelevance * 0.17
    + c.surprise * 0.10
    + c.emotionalArousal * 0.13
    + c.selfRelevance * 0.13
    + c.relationshipRelevance * 0.12;
  const resistance = c.fatigue * 0.08 + c.cognitiveLoad * 0.06;
  const strength = clamp01(positive - resistance);
  return {
    strength,
    positive: clamp01(positive),
    resistance: clamp01(resistance),
    factors: c,
    formula: "0.18 + .18*attention + .17*goal + .10*surprise + .13*emotion + .13*self + .12*relationship - .08*fatigue - .06*load",
  };
}

function beliefKey(frame = {}) {
  const normalized = normalizeSemanticFrame(frame);
  const roles = sortedRoleEntries(normalized.roles).map(([role, id]) => `${role}=${id}`).join("|");
  return [normalized.predicate, normalized.topicId, normalized.object.id || normalized.object.label, roles].join("::");
}

function beliefFromEpisode(episode = {}) {
  const frame = normalizeSemanticFrame(episode.semanticFrame || {});
  const sourceConfidence = clamp01(episode.source?.confidence, 0.5);
  const confidence = clamp01(sourceConfidence * (0.62 + clamp01(episode.retentionStrength) * 0.38));
  return {
    id: `belief:${stablePart(episode.ownerCharacterId)}:${stablePart(beliefKey(frame))}`,
    ownerCharacterId: episode.ownerCharacterId,
    propositionKey: beliefKey(frame),
    semanticFrame: frame,
    currentValue: frame.truthValue || frame.decisionValue || (frame.kind === "social_request" ? "requested" : "observed"),
    confidence,
    status: episode.source?.kind === "gossip" || confidence < 0.65 ? "uncertain" : "supported",
    supportingEpisodeIds: [episode.id],
    conflictingEpisodeIds: [],
    sourceChains: [clone(episode.source)],
    lastUpdatedAtSeconds: episode.perceivedAt?.seconds || 0,
  };
}

function mergeBelief(belief = {}, episode = {}) {
  const incoming = beliefFromEpisode(episode);
  const next = clone(belief);
  const conflicts = Boolean(next.currentValue && incoming.currentValue && next.currentValue !== incoming.currentValue);
  const advancesOpenRequest = incoming.semanticFrame?.kind === "social_decision"
    && ["requested", "defer"].includes(next.currentValue)
    && ["accept", "refuse", "defer"].includes(incoming.currentValue);
  if (advancesOpenRequest) {
    next.currentValue = incoming.currentValue;
    next.semanticFrame = incoming.semanticFrame;
    next.confidence = incoming.confidence;
    next.status = episode.source?.kind === "gossip" || incoming.confidence < 0.65 ? "uncertain" : "supported";
    next.supportingEpisodeIds = unique([...(next.supportingEpisodeIds || []), episode.id]);
  } else if (conflicts) {
    next.conflictingEpisodeIds = unique([...(next.conflictingEpisodeIds || []), episode.id]);
    next.status = "contested";
    if (incoming.confidence > Number(next.confidence || 0) + 0.08) {
      next.currentValue = incoming.currentValue;
      next.semanticFrame = incoming.semanticFrame;
      next.confidence = clamp01(incoming.confidence - Math.min(0.18, Number(next.confidence || 0) * 0.18));
    } else {
      next.confidence = clamp01(Number(next.confidence || 0) - incoming.confidence * 0.22);
    }
  } else {
    next.supportingEpisodeIds = unique([...(next.supportingEpisodeIds || []), episode.id]);
    next.confidence = clamp01(1 - (1 - Number(next.confidence || 0)) * (1 - incoming.confidence * 0.45));
    next.status = episode.source?.kind === "gossip" && next.confidence < 0.72 ? "uncertain" : "supported";
  }
  next.sourceChains = [...(next.sourceChains || []), clone(episode.source)].slice(-12);
  next.lastUpdatedAtSeconds = episode.perceivedAt?.seconds || next.lastUpdatedAtSeconds || 0;
  return next;
}

function ownerRoleForFrame(ownerCharacterId = "", frame = {}) {
  const roles = frame.roles || {};
  if (roles.requester === ownerCharacterId) return "requester";
  if (roles.requestedActor === ownerCharacterId) return "requestedActor";
  if (roles.beneficiary === ownerCharacterId) return "beneficiary";
  if (roles.ultimateRecipient === ownerCharacterId) return "ultimateRecipient";
  for (const role of ROLE_KEYS) if (roles[role] === ownerCharacterId) return role;
  return "observer";
}

function commitmentFromEpisode(episode = {}) {
  const frame = normalizeSemanticFrame(episode.semanticFrame || {});
  if (frame.kind !== "social_request") return null;
  const ownerRole = ownerRoleForFrame(episode.ownerCharacterId, frame);
  if (!["requester", "requestedActor", "beneficiary"].includes(ownerRole)) return null;
  const counterpartyCharacterId = ownerRole === "requestedActor"
    ? frame.roles.requester || ""
    : frame.roles.requestedActor || "";
  return {
    id: `commitment:${stablePart(frame.id)}:${stablePart(episode.ownerCharacterId)}`,
    ownerCharacterId: episode.ownerCharacterId,
    ownerRole,
    counterpartyCharacterId,
    beneficiaryCharacterId: frame.roles.beneficiary || "",
    ultimateRecipientCharacterId: frame.roles.ultimateRecipient || "",
    semanticFrame: frame,
    requestedAct: frame.requestedAct,
    topicId: frame.topicId,
    status: ownerRole === "requester" || ownerRole === "beneficiary" ? "awaiting_response" : "open",
    outcome: "",
    sourceEpisodeIds: [episode.id],
    openedAtSeconds: episode.perceivedAt?.seconds || 0,
    updatedAtSeconds: episode.perceivedAt?.seconds || 0,
    importance: Math.max(0.65, frame.importance),
  };
}

function isOpenCommitment(commitment = {}) {
  return !["resolved", "dropped"].includes(commitment.status);
}

function boundedMemoryState(input = {}) {
  const state = input;
  const commitments = [...(state.commitments || [])]
    .sort((left, right) => (
      Number(isOpenCommitment(right)) - Number(isOpenCommitment(left))
      || Number(right.importance || 0) - Number(left.importance || 0)
      || Number(right.updatedAtSeconds || 0) - Number(left.updatedAtSeconds || 0)
    ))
    .slice(0, MAX_COMMITMENTS);
  const protectedEpisodeIds = new Set(commitments
    .filter(isOpenCommitment)
    .flatMap((commitment) => commitment.sourceEpisodeIds || []));
  const episodes = [...(state.episodes || [])]
    .sort((left, right) => (
      Number(Boolean(right.protected || protectedEpisodeIds.has(right.id))) - Number(Boolean(left.protected || protectedEpisodeIds.has(left.id)))
      || Number(right.importance || 0) - Number(left.importance || 0)
      || Number(right.retentionStrength || 0) - Number(left.retentionStrength || 0)
      || Number(right.perceivedAt?.seconds || 0) - Number(left.perceivedAt?.seconds || 0)
    ))
    .slice(0, MAX_EPISODES)
    .sort((left, right) => Number(left.perceivedAt?.seconds || 0) - Number(right.perceivedAt?.seconds || 0));
  const retainedEpisodeIds = new Set(episodes.map((episode) => episode.id));
  const beliefs = [...(state.beliefs || [])]
    .sort((left, right) => (
      Number((right.supportingEpisodeIds || []).some((id) => retainedEpisodeIds.has(id)))
        - Number((left.supportingEpisodeIds || []).some((id) => retainedEpisodeIds.has(id)))
      || Number(right.confidence || 0) - Number(left.confidence || 0)
      || Number(right.lastUpdatedAtSeconds || 0) - Number(left.lastUpdatedAtSeconds || 0)
    ))
    .slice(0, MAX_BELIEFS);
  state.episodes = episodes;
  state.beliefs = beliefs;
  state.commitments = commitments.sort((left, right) => Number(left.updatedAtSeconds || 0) - Number(right.updatedAtSeconds || 0));
  state.impressions = (state.impressions || []).slice(-MAX_IMPRESSIONS);
  state.privateEntityModels = [...(state.privateEntityModels || [])]
    .sort((left, right) => Number(right.lastUpdatedAtSeconds || 0) - Number(left.lastUpdatedAtSeconds || 0))
    .slice(0, MAX_PRIVATE_ENTITY_MODELS);
  state.locationBeliefs = [...(state.locationBeliefs || [])]
    .sort((left, right) => Number(right.lastUpdatedAtSeconds || 0) - Number(left.lastUpdatedAtSeconds || 0))
    .slice(0, MAX_LOCATION_BELIEFS);
  state.sourceKnowledgeBeliefs = [...(state.sourceKnowledgeBeliefs || [])]
    .sort((left, right) => Number(right.lastUpdatedAtSeconds || 0) - Number(left.lastUpdatedAtSeconds || 0))
    .slice(0, MAX_SOURCE_KNOWLEDGE_BELIEFS);
  state.experienceTraces = (state.experienceTraces || []).slice(-MAX_EXPERIENCE_TRACES);
  state.recallInstances = (state.recallInstances || []).slice(-MAX_RECALL_INSTANCES);
  return state;
}

function episodeHasImpact(episode = {}, impactId = "") {
  const expected = clean(impactId, 220);
  return Boolean(expected && (
    episode.sourceImpactId === expected
    || (episode.sourceImpactIds || []).includes(expected)
  ));
}

export function normalizeCharacterAgentMemoryState(input = {}, ownerCharacterId = "") {
  const base = createCharacterAgentMemoryState(ownerCharacterId || input.ownerCharacterId, {
    nowSeconds: input.lastAdvancedAtSeconds,
    selfNarrative: input.selfNarrative,
  });
  const owner = clean(ownerCharacterId || input.ownerCharacterId, 180);
  const normalizeEpisode = (episode = {}) => {
    const perception = clone(episode.perception || {});
    return {
      ...clone(episode),
      ownerCharacterId: owner,
      sourceImpactIds: unique([...(episode.sourceImpactIds || []), episode.sourceImpactId]),
      evidenceIds: unique(episode.evidenceIds || [episode.sourceImpactId]).slice(-12),
      experienceTraceId: clean(episode.experienceTraceId, 260),
      experienceTraceIds: unique(episode.experienceTraceIds || [episode.experienceTraceId]).slice(-12),
      perception: {
        ...perception,
        modalities: unique([...(perception.modalities || []), perception.modality]),
        fragments: clone(perception.fragments || (perception.content ? [{
          modality: perception.modality || "",
          content: perception.content,
          topic: perception.topic || "",
        }] : [])).slice(-6),
      },
      sourceVariants: clone(episode.sourceVariants || []).slice(-4),
      retrievalCues: unique(episode.retrievalCues || []).slice(-32),
      interpretations: clone(episode.interpretations || []).slice(-6),
      semanticFrame: normalizeSemanticFrame(episode.semanticFrame || {}),
      retentionStrength: clamp01(episode.retentionStrength, 0.45),
      accessibility: clamp01(episode.accessibility, 0.45),
      importance: clamp01(episode.importance, 0.5),
      retrievalCount: Math.max(0, Number(episode.retrievalCount || 0)),
    };
  };
  return boundedMemoryState({
    ...base,
    ...clone(input),
    schemaVersion: CHARACTER_AGENT_MEMORY_SCHEMA_VERSION,
    ownerCharacterId: owner,
    experienceTraces: clone(input.experienceTraces || []).filter((trace) => trace?.id).map((trace) => ({
      ...trace,
      evidenceIds: unique(trace.evidenceIds || []).slice(-12),
      sensoryFragments: clone(trace.sensoryFragments || []).slice(-8),
    })),
    episodes: (input.episodes || []).map(normalizeEpisode).filter((episode) => episode.id),
    beliefs: clone(input.beliefs || []).filter((belief) => belief?.id).map((belief) => ({
      ...belief,
      supportingEpisodeIds: unique(belief.supportingEpisodeIds || []).slice(-16),
      conflictingEpisodeIds: unique(belief.conflictingEpisodeIds || []).slice(-16),
      sourceChains: clone(belief.sourceChains || []).slice(-12),
    })),
    commitments: clone(input.commitments || []).filter((commitment) => commitment?.id).map((commitment) => ({
      ...commitment,
      sourceEpisodeIds: unique(commitment.sourceEpisodeIds || []).slice(-12),
    })),
    impressions: clone(input.impressions || []).filter(Boolean).map((impression) => ({
      ...impression,
      sourceEpisodeIds: unique(impression.sourceEpisodeIds || []).slice(-24),
    })),
    privateEntityModels: clone(input.privateEntityModels || []).filter((model) => clean(model?.perceivedEntityHandle, 220)).map((model) => ({
      ...model,
      ownerCharacterId: owner,
      perceivedEntityHandle: clean(model.perceivedEntityHandle, 220),
      noticedEvidenceIds: unique(model.noticedEvidenceIds || []).slice(-48),
      hypotheses: clone(model.hypotheses || []).filter((row) => clean(row?.hypothesisId, 220)).map((row) => ({
        ...row,
        hypothesisId: clean(row.hypothesisId, 220),
        proposition: clean(row.proposition, 360),
        basisEvidenceIds: unique(row.basisEvidenceIds || []).slice(-24),
      })).slice(-32),
      identityCandidates: clone(model.identityCandidates || []).filter((row) => clean(row?.knownEntityHandle, 220)).map((row) => ({
        ...row,
        knownEntityHandle: clean(row.knownEntityHandle, 220),
        basisEvidenceIds: unique(row.basisEvidenceIds || []).slice(-24),
      })).slice(-24),
      affectiveResponse: clone(model.affectiveResponse || {}),
      attentionPriority: clamp01(model.attentionPriority, 0.4),
      contradictions: clone(model.contradictions || []).slice(-16),
      revisionHistory: clone(model.revisionHistory || []).map((row) => ({
        ...row,
        evidenceIds: unique(row.evidenceIds || []).slice(-24),
      })).slice(-24),
      firstObservedAtSeconds: Math.max(0, Number(model.firstObservedAtSeconds || 0)),
      lastUpdatedAtSeconds: Math.max(0, Number(model.lastUpdatedAtSeconds || 0)),
    })),
    locationBeliefs: clone(input.locationBeliefs || []).filter((row) => clean(row?.subjectHandle, 220)).map((row) => ({
      ...row,
      ownerCharacterId: owner,
      subjectHandle: clean(row.subjectHandle, 220),
      locations: clone(row.locations || []).filter((location) => clean(location?.locationHandle, 220)).map((location) => ({
        ...location,
        locationHandle: clean(location.locationHandle, 220),
        currentLikelihood: clamp01(location.currentLikelihood ?? location.likelihood, 0.1),
        priorPresenceLikelihood: clamp01(location.priorPresenceLikelihood, location.currentLikelihood ?? location.likelihood ?? 0.1),
        basisEvidenceIds: unique(location.basisEvidenceIds || []).slice(-32),
        revisionHistory: clone(location.revisionHistory || []).map((revision) => ({
          ...revision,
          basisEvidenceIds: unique(revision.basisEvidenceIds || []).slice(-24),
        })).slice(-32),
        lastUpdatedAtSeconds: Math.max(0, Number(location.lastUpdatedAtSeconds || 0)),
        worldTruthUsed: false,
      })).slice(-24),
      unknownMass: clamp01(row.unknownMass, 1),
      lastUpdatedAtSeconds: Math.max(0, Number(row.lastUpdatedAtSeconds || 0)),
    })),
    sourceKnowledgeBeliefs: clone(input.sourceKnowledgeBeliefs || []).filter((row) => (
      clean(row?.sourceHandle, 220) && clean(row?.subjectHandle, 220)
    )).map((row) => ({
      ...row,
      ownerCharacterId: owner,
      sourceHandle: clean(row.sourceHandle, 220),
      subjectHandle: clean(row.subjectHandle, 220),
      likelihood: clamp01(row.likelihood, 0.1),
      basisEvidenceIds: unique(row.basisEvidenceIds || []).slice(-32),
      revisionHistory: clone(row.revisionHistory || []).map((revision) => ({
        ...revision,
        basisEvidenceIds: unique(revision.basisEvidenceIds || []).slice(-24),
      })).slice(-32),
      lastUpdatedAtSeconds: Math.max(0, Number(row.lastUpdatedAtSeconds || 0)),
      worldTruthUsed: false,
    })),
    recallInstances: clone(input.recallInstances || []).filter((recall) => recall?.id).map((recall) => ({
      ...recall,
      sourceEpisodeIds: unique(recall.sourceEpisodeIds || []).slice(-12),
      sourceTraceIds: unique(recall.sourceTraceIds || []).slice(-12),
    })),
    selfNarrative: {
      ...clone(input.selfNarrative || {}),
      currentClaims: (input.selfNarrative?.currentClaims || [])
        .map((claim, index) => normalizeSelfClaim(claim, owner, index))
        .filter((claim) => claim.claim)
        .slice(-24),
      versions: clone(input.selfNarrative?.versions || []).slice(-16),
      pendingCandidates: clone(input.selfNarrative?.pendingCandidates || [])
        .filter((candidate) => candidate?.id && candidate?.claim)
        .map((candidate) => ({
          ...candidate,
          sourceEpisodeIds: unique(candidate.sourceEpisodeIds || []).slice(-12),
          replacesClaimIds: unique(candidate.replacesClaimIds || []).slice(-8),
        }))
        .slice(-16),
    },
    lastAdvancedAtSeconds: Math.max(0, Number(input.lastAdvancedAtSeconds || 0)),
    lastEncodedAtSeconds: Math.max(0, Number(input.lastEncodedAtSeconds || 0)),
  });
}

export function encodeCharacterPerception(memoryState = {}, input = {}) {
  const ownerCharacterId = clean(memoryState.ownerCharacterId || input.delivery?.recipientId, 180);
  const state = normalizeCharacterAgentMemoryState(memoryState, ownerCharacterId);
  const impact = input.impact || {};
  const delivery = input.delivery || {};
  if (!ownerCharacterId || clean(delivery.recipientId, 180) !== ownerCharacterId) return state;
  const impactId = clean(delivery.impactId || impact.id, 220);
  const evidenceId = clean(delivery.evidenceId || delivery.id || impactId, 240);
  if (!impactId) return state;
  const frame = normalizeSemanticFrame(delivery.semanticFrame || impact.semanticFrame || {});
  const objectiveEventId = clean(impact.objectiveEventId || delivery.objectiveEventId || impact.causedByActionId || impactId, 240);
  const encodingContext = deriveEncodingContext(delivery, input.encodingContext || {});
  const encoding = calculateMemoryEncodingStrength(encodingContext);
  const source = normalizeSource(input, delivery, impact);
  const nowSeconds = Math.max(0, Number(input.nowSeconds ?? delivery.deliveredAtSeconds ?? 0));
  const episodeId = `episode:${stablePart(ownerCharacterId)}:${stablePart(impactId)}`;
  const experienceTraceId = `trace:${stablePart(ownerCharacterId)}:${stablePart(objectiveEventId || impactId)}:${stablePart(evidenceId || impactId)}`;
  const existing = state.episodes.find((episode) => (
    episode.id === episodeId
    || (
      objectiveEventId
      && episode.objectiveEventId === objectiveEventId
      && episode.semanticFrame?.id === frame.id
    )
  ));
  if (existing) {
    if (frame.actionResult) {
      existing.semanticFrame = {
        ...existing.semanticFrame,
        actionResult: clone(frame.actionResult),
        lexicalAnchors: unique([...(existing.semanticFrame?.lexicalAnchors || []), ...frame.lexicalAnchors]),
      };
    }
    const modality = clean(delivery.modality || impact.modality, 80);
    const content = clean(delivery.content || impact.content, 420);
    const topic = clean(delivery.topic || impact.topic, 160);
    existing.sourceImpactIds = unique([...(existing.sourceImpactIds || [existing.sourceImpactId]), impactId]);
    existing.evidenceIds = unique([...(existing.evidenceIds || []), evidenceId]);
    existing.experienceTraceIds = unique([...(existing.experienceTraceIds || [existing.experienceTraceId]), experienceTraceId]).slice(-12);
    existing.perception.modalities = unique([...(existing.perception.modalities || [existing.perception.modality]), modality]);
    existing.perception.fragments = [
      ...(existing.perception.fragments || [{
        modality: existing.perception.modality,
        content: existing.perception.content,
        topic: existing.perception.topic,
      }]),
      { modality, content, topic },
    ].filter((fragment, index, rows) => (
      fragment.content
      && rows.findIndex((row) => row.modality === fragment.modality && row.content === fragment.content) === index
    )).slice(-6);
    if (["sound", "hearing", "direct_speech"].includes(modality) || !existing.perception.content) {
      existing.perception.modality = modality || existing.perception.modality;
      existing.perception.content = content || existing.perception.content;
      existing.perception.topic = topic || existing.perception.topic;
    }
    existing.sourceVariants = [...(existing.sourceVariants || [clone(existing.source)]), clone(source)]
      .filter((variant, index, rows) => rows.findIndex((row) => (
        row.kind === variant.kind
        && row.immediateSourceCharacterId === variant.immediateSourceCharacterId
        && row.sourceActionId === variant.sourceActionId
      )) === index)
      .slice(-4);
    if (source.confidence < Number(existing.source?.confidence ?? 1)) existing.source = source;
    existing.retentionStrength = Math.max(existing.retentionStrength, encoding.strength);
    existing.accessibility = Math.max(
      existing.accessibility,
      clamp01(Number(delivery.receivedIntensity || 0) / 100, 0.5),
      clamp01(encoding.strength * 0.72),
    );
    existing.retrievalCues = unique([
      ...(existing.retrievalCues || []),
      frame.predicate,
      frame.topicId,
      frame.object.id,
      frame.object.label,
      ...Object.values(frame.roles || {}),
      ...frame.lexicalAnchors,
      topic,
    ]);
    const interpretation = clean(input.interpretation || content, 360);
    if (interpretation && !(existing.interpretations || []).some((item) => item.summary === interpretation)) {
      existing.interpretations = [...(existing.interpretations || []), {
        id: `interpretation:${stablePart(existing.id)}:${existing.interpretations?.length || 0}`,
        atSeconds: nowSeconds,
        summary: interpretation,
        confidence: source.confidence,
        source: "reinforcement",
      }].slice(-6);
    }
    existing.lastReinforcedAtSeconds = Math.max(existing.lastReinforcedAtSeconds || 0, nowSeconds);
    if (!state.experienceTraces.some((trace) => trace.id === experienceTraceId)) state.experienceTraces.push({
      id: experienceTraceId,
      ownerCharacterId,
      objectiveEventId,
      evidenceIds: [evidenceId],
      perceivedAt: {
        seconds: nowSeconds,
        worldDay: Math.max(0, Number(input.worldDay || 0)),
        locationId: clean(input.locationId || impact.locationId, 180),
        zoneId: clean(input.zoneId || delivery.recipientZoneId, 120),
      },
      source: clone(source),
      sensoryFragments: [{ modality, content, topic }],
      immutable: true,
    });
    state.lastEncodedAtSeconds = Math.max(state.lastEncodedAtSeconds || 0, nowSeconds);
    return boundedMemoryState(state);
  }

  const importance = Math.max(frame.importance, delivery.directed ? 0.68 : 0.35, encoding.strength * 0.82);
  const initialAccessibility = clamp01(
    encoding.strength * 0.72
      + (delivery.directed ? 0.14 : 0.04)
      + clamp01(Number(delivery.personalRelevance || 0) / 70) * 0.1,
  );
  const episode = {
    id: episodeId,
    ownerCharacterId,
    kind: source.kind === "gossip" ? "reported_episode" : "episodic_perception",
    objectiveEventId: objectiveEventId || clean(source.sourceActionId || impactId, 240),
    sourceImpactId: impactId,
    sourceImpactIds: [impactId],
    evidenceIds: [evidenceId],
    experienceTraceId,
    experienceTraceIds: [experienceTraceId],
    perceivedAt: {
      seconds: nowSeconds,
      worldDay: Math.max(0, Number(input.worldDay || 0)),
      locationId: clean(input.locationId || impact.locationId, 180),
      zoneId: clean(input.zoneId || delivery.recipientZoneId, 120),
    },
    perception: {
      modality: clean(delivery.modality || impact.modality, 80),
      modalities: unique([delivery.modality || impact.modality]),
      content: clean(delivery.content || impact.content, 420),
      topic: clean(delivery.topic || impact.topic, 160),
      sourceCharacterId: Object.hasOwn(delivery, "perceivedSourceCharacterId")
        ? clean(delivery.perceivedSourceCharacterId, 180)
        : clean(delivery.sourceCharacterId || impact.sourceCharacterId, 180),
      sourceEntityHandle: clean(delivery.sourceEntityHandle || delivery.perceptPacket?.perceivedEntityHandle, 220),
      identityKnown: delivery.identityKnown !== false,
      directed: Boolean(delivery.directed),
      receivedIntensity: Math.max(0, Number(delivery.receivedIntensity || 0)),
      distance: Math.max(0, Number(delivery.distance || 0)),
      barriers: clone(delivery.barriers || []),
      fragments: [{
        modality: clean(delivery.modality || impact.modality, 80),
        content: clean(delivery.content || impact.content, 420),
        topic: clean(delivery.topic || impact.topic, 160),
      }],
    },
    semanticFrame: frame,
    source,
    encoding,
    retentionStrength: encoding.strength,
    accessibility: initialAccessibility,
    importance,
    protected: (
      frame.kind === "social_request" && ["requester", "requestedActor", "beneficiary"].includes(ownerRoleForFrame(ownerCharacterId, frame))
    ) || ["identity_commitment", "identity_turn", "major_choice"].includes(frame.kind),
    consolidationLevel: 0,
    retrievalCues: unique([
      frame.predicate,
      frame.topicId,
      frame.object.id,
      frame.object.label,
      ...Object.values(frame.roles || {}),
      ...frame.lexicalAnchors,
      delivery.topic,
    ]),
    emotionAtEncoding: clone(input.emotion || {}),
    desireIdsAtEncoding: unique(input.desireIds || []),
    beliefAtEncoding: clone(input.beliefAtEncoding || []),
    interpretations: [{
      id: `interpretation:${stablePart(episodeId)}:0`,
      atSeconds: nowSeconds,
      summary: clean(input.interpretation || delivery.content || impact.content, 360),
      confidence: source.confidence,
      source: "encoding",
    }],
    retrievalCount: 0,
    lastRetrievedAtSeconds: 0,
    status: "active",
  };

  state.experienceTraces.push({
    id: episode.experienceTraceId,
    ownerCharacterId,
    objectiveEventId: episode.objectiveEventId,
    evidenceIds: [evidenceId],
    perceivedAt: clone(episode.perceivedAt),
    source: clone(source),
    sensoryFragments: clone(episode.perception.fragments),
    immutable: true,
  });
  state.episodes.push(episode);
  if (input.beliefMode !== "deferred") {
    const key = beliefKey(frame);
    const existingBeliefIndex = state.beliefs.findIndex((belief) => belief.propositionKey === key);
    if (existingBeliefIndex >= 0) state.beliefs[existingBeliefIndex] = mergeBelief(state.beliefs[existingBeliefIndex], episode);
    else state.beliefs.push(beliefFromEpisode(episode));
  }

  const commitment = commitmentFromEpisode(episode);
  if (commitment) {
    const index = state.commitments.findIndex((item) => item.id === commitment.id);
    if (index >= 0) {
      state.commitments[index] = {
        ...state.commitments[index],
        sourceEpisodeIds: unique([...(state.commitments[index].sourceEpisodeIds || []), episode.id]),
        updatedAtSeconds: nowSeconds,
      };
    } else state.commitments.push(commitment);
  }
  state.lastEncodedAtSeconds = nowSeconds;
  return boundedMemoryState(state);
}

function normalizedCognitiveAppraisal(input = {}) {
  return {
    noticedEvidenceIds: unique(input.noticedEvidenceIds || []),
    interpretations: (input.interpretations || []).map((row) => ({
      evidenceIds: unique(row?.evidenceIds || []),
      meaning: clean(row?.meaning, 360),
      confidenceBand: Object.hasOwn(CONFIDENCE_BANDS, row?.confidenceBand) ? row.confidenceBand : "medium",
    })).filter((row) => row.meaning),
    beliefOperations: (input.beliefOperations || []).map((row) => ({
      proposition: clean(row?.proposition, 360),
      operation: BELIEF_OPERATIONS.has(row?.operation) ? row.operation : "suspend",
      confidenceBand: Object.hasOwn(CONFIDENCE_BANDS, row?.confidenceBand) ? row.confidenceBand : "medium",
      sourceEvidenceIds: unique(row?.sourceEvidenceIds || []),
      reasoningMode: BELIEF_REASONING_MODES.has(row?.reasoningMode) ? row.reasoningMode : "inference",
    })).filter((row) => row.proposition),
  };
}

/**
 * Applies only the current Character Agent's subjective appraisal. Evidence
 * ids are ownership gates, not truth gates: a character may adopt, reject,
 * doubt, suspend, or even confabulate from evidence they actually received.
 */
export function applyCharacterCognitiveAppraisal(memoryState = {}, appraisalInput = {}, options = {}) {
  const memory = normalizeCharacterAgentMemoryState(memoryState, memoryState.ownerCharacterId);
  const appraisal = normalizedCognitiveAppraisal(appraisalInput);
  const allowedEvidenceIds = new Set(unique(options.allowedEvidenceIds || memory.episodes.flatMap((episode) => episode.evidenceIds || [])));
  const violations = [];
  const validateEvidenceIds = (ids, field) => {
    const unknown = ids.filter((id) => !allowedEvidenceIds.has(id));
    if (unknown.length) violations.push({
      code: "COGNITIVE_EVIDENCE_NOT_OWNED",
      field,
      message: "人物的主观判断引用了没有进入本人感知或记忆的证据。",
      evidence: { unknownEvidenceIds: unknown },
    });
  };
  validateEvidenceIds(appraisal.noticedEvidenceIds, "cognitiveAppraisal.noticedEvidenceIds");
  appraisal.interpretations.forEach((row, index) => validateEvidenceIds(row.evidenceIds, `cognitiveAppraisal.interpretations[${index}].evidenceIds`));
  appraisal.beliefOperations.forEach((row, index) => {
    if (row.reasoningMode !== "confabulation" || row.sourceEvidenceIds.length) {
      validateEvidenceIds(row.sourceEvidenceIds, `cognitiveAppraisal.beliefOperations[${index}].sourceEvidenceIds`);
    }
  });
  if (violations.length) return { valid: false, memory, appraisal, violations };

  const nowSeconds = Math.max(0, Number(options.nowSeconds || memory.lastAdvancedAtSeconds || 0));
  for (const interpretation of appraisal.interpretations) {
    const evidenceSet = new Set(interpretation.evidenceIds);
    for (const episode of memory.episodes) {
      if (!(episode.evidenceIds || []).some((id) => evidenceSet.has(id))) continue;
      episode.interpretations = [...(episode.interpretations || []), {
        id: `interpretation:${stablePart(episode.id)}:${episode.interpretations?.length || 0}`,
        atSeconds: nowSeconds,
        summary: interpretation.meaning,
        confidence: CONFIDENCE_BANDS[interpretation.confidenceBand],
        source: "character-agent-appraisal",
      }].slice(-6);
    }
  }

  for (const operation of appraisal.beliefOperations) {
    const propositionKey = `subjective::${stablePart(operation.proposition)}`;
    const sourceEpisodeIds = memory.episodes.filter((episode) => (
      (episode.evidenceIds || []).some((id) => operation.sourceEvidenceIds.includes(id))
    )).map((episode) => episode.id);
    const confidence = CONFIDENCE_BANDS[operation.confidenceBand];
    const status = operation.operation === "reject"
      ? "rejected"
      : operation.operation === "suspend" ? "suspended"
        : operation.operation === "doubt" ? "uncertain" : "supported";
    const existing = memory.beliefs.find((belief) => belief.propositionKey === propositionKey) || null;
    const belief = {
      id: existing?.id || `belief:${stablePart(memory.ownerCharacterId)}:${stablePart(propositionKey)}`,
      ownerCharacterId: memory.ownerCharacterId,
      propositionKey,
      proposition: operation.proposition,
      semanticFrame: existing?.semanticFrame || normalizeSemanticFrame({
        kind: "subjective_proposition",
        predicate: "believe_proposition",
        topicId: propositionKey,
        roles: { owner: memory.ownerCharacterId },
        object: { id: propositionKey, label: operation.proposition },
      }),
      currentValue: operation.operation === "reject" ? "rejected" : operation.operation,
      confidence,
      status,
      supportingEpisodeIds: status === "supported"
        ? unique([...(existing?.supportingEpisodeIds || []), ...sourceEpisodeIds])
        : unique(existing?.supportingEpisodeIds || []),
      conflictingEpisodeIds: ["rejected", "uncertain", "suspended"].includes(status)
        ? unique([...(existing?.conflictingEpisodeIds || []), ...sourceEpisodeIds])
        : unique(existing?.conflictingEpisodeIds || []),
      sourceEvidenceIds: operation.sourceEvidenceIds,
      sourceChains: sourceEpisodeIds.map((episodeId) => clone(memory.episodes.find((episode) => episode.id === episodeId)?.source || {})),
      reasoningMode: operation.reasoningMode,
      lastOperation: operation.operation,
      lastUpdatedAtSeconds: nowSeconds,
    };
    if (existing) Object.assign(existing, belief);
    else memory.beliefs.push(belief);
  }
  return { valid: true, memory: boundedMemoryState(memory), appraisal, violations: [] };
}

function subjectiveOperationStatus(operation = "") {
  if (operation === "reject") return "rejected";
  if (operation === "doubt") return "uncertain";
  if (operation === "suspend") return "suspended";
  return "supported";
}

function normalizedEntityModelUpdate(input = {}) {
  return {
    perceivedEntityHandle: clean(input.perceivedEntityHandle, 220),
    noticedEvidenceIds: unique(input.noticedEvidenceIds || []),
    hypotheses: (input.hypotheses || []).map((row) => ({
      hypothesisId: clean(row?.hypothesisId, 220),
      proposition: clean(row?.proposition, 360),
      operation: BELIEF_OPERATIONS.has(row?.operation) ? row.operation : "suspend",
      confidenceBand: Object.hasOwn(CONFIDENCE_BANDS, row?.confidenceBand) ? row.confidenceBand : "medium",
      basisEvidenceIds: unique(row?.basisEvidenceIds || []),
    })).filter((row) => row.hypothesisId && row.proposition),
    identityCandidates: (input.identityCandidates || []).map((row) => ({
      knownEntityHandle: clean(row?.knownEntityHandle, 220),
      operation: BELIEF_OPERATIONS.has(row?.operation) ? row.operation : "suspend",
      confidenceBand: Object.hasOwn(CONFIDENCE_BANDS, row?.confidenceBand) ? row.confidenceBand : "medium",
      basisEvidenceIds: unique(row?.basisEvidenceIds || []),
    })).filter((row) => row.knownEntityHandle),
    affectiveResponse: {
      label: clean(input.affectiveResponse?.label, 180),
      valence: Math.max(-1, Math.min(1, Number(input.affectiveResponse?.valence || 0))),
      arousal: clamp01(input.affectiveResponse?.arousal, 0),
    },
    attentionPriority: clamp01(input.attentionPriority, 0.4),
  };
}

function canonicalEntityHandleAllowed(handle = "", options = {}) {
  const normalized = clean(handle, 220);
  if (!/^char_/u.test(normalized)) return true;
  return new Set(unique(options.allowedCanonicalEntityHandles || [])).has(normalized);
}

/**
 * Updates one Character Agent's private model of a currently perceived person.
 * Identity candidates are subjective links and may be wrong. Canonical world
 * identity is deliberately unavailable here, and no relationship is created.
 */
export function applyCharacterPrivateEntityModelUpdate(memoryState = {}, updateInput = {}, options = {}) {
  const memory = normalizeCharacterAgentMemoryState(memoryState, memoryState.ownerCharacterId);
  const update = normalizedEntityModelUpdate(updateInput);
  const violations = [];
  if (!update.perceivedEntityHandle) {
    violations.push({
      code: "PRIVATE_ENTITY_HANDLE_MISSING",
      field: "privateEntityModel.perceivedEntityHandle",
      message: "匿名人物模型必须引用本人当前使用的感知句柄。",
    });
  }
  if (!canonicalEntityHandleAllowed(update.perceivedEntityHandle, options)) {
    violations.push({
      code: "PRIVATE_ENTITY_CANONICAL_ID_FORBIDDEN",
      field: "privateEntityModel.perceivedEntityHandle",
      message: "未确认身份的人物模型不能使用世界 canonical character id。",
    });
  }
  for (const [index, row] of update.identityCandidates.entries()) {
    if (!canonicalEntityHandleAllowed(row.knownEntityHandle, options)) violations.push({
      code: "PRIVATE_ENTITY_CANONICAL_ID_FORBIDDEN",
      field: `privateEntityModel.identityCandidates[${index}].knownEntityHandle`,
      message: "身份候选必须使用人物认识层句柄，不能使用世界 canonical character id。",
    });
  }
  const allowedEvidenceIds = new Set(unique(options.allowedEvidenceIds || memory.episodes.flatMap((episode) => episode.evidenceIds || [])));
  const referencedEvidenceIds = unique([
    ...update.noticedEvidenceIds,
    ...update.hypotheses.flatMap((row) => row.basisEvidenceIds),
    ...update.identityCandidates.flatMap((row) => row.basisEvidenceIds),
  ]);
  const unknownEvidenceIds = referencedEvidenceIds.filter((id) => !allowedEvidenceIds.has(id));
  if (unknownEvidenceIds.length) violations.push({
    code: "PRIVATE_ENTITY_EVIDENCE_NOT_OWNED",
    field: "privateEntityModel.evidence",
    message: "匿名人物判断引用了没有进入本人注意或记忆的证据。",
    evidence: { unknownEvidenceIds },
  });
  if (violations.length) return { valid: false, memory, update, model: null, violations };

  const nowSeconds = Math.max(0, Number(options.nowSeconds || memory.lastAdvancedAtSeconds || 0));
  let model = memory.privateEntityModels.find((row) => row.perceivedEntityHandle === update.perceivedEntityHandle) || null;
  if (!model) {
    model = {
      id: `private-entity:${stablePart(memory.ownerCharacterId)}:${stablePart(update.perceivedEntityHandle)}`,
      ownerCharacterId: memory.ownerCharacterId,
      perceivedEntityHandle: update.perceivedEntityHandle,
      noticedEvidenceIds: [],
      hypotheses: [],
      identityCandidates: [],
      affectiveResponse: {},
      attentionPriority: 0.4,
      contradictions: [],
      revisionHistory: [],
      firstObservedAtSeconds: nowSeconds,
      lastUpdatedAtSeconds: nowSeconds,
    };
    memory.privateEntityModels.push(model);
  }
  model.noticedEvidenceIds = unique([...model.noticedEvidenceIds, ...update.noticedEvidenceIds]).slice(-48);
  for (const hypothesisUpdate of update.hypotheses) {
    const existing = model.hypotheses.find((row) => row.hypothesisId === hypothesisUpdate.hypothesisId) || null;
    const row = {
      hypothesisId: hypothesisUpdate.hypothesisId,
      proposition: hypothesisUpdate.proposition,
      status: subjectiveOperationStatus(hypothesisUpdate.operation),
      lastOperation: hypothesisUpdate.operation,
      confidenceBand: hypothesisUpdate.confidenceBand,
      confidence: CONFIDENCE_BANDS[hypothesisUpdate.confidenceBand],
      basisEvidenceIds: unique([...(existing?.basisEvidenceIds || []), ...hypothesisUpdate.basisEvidenceIds]).slice(-24),
      lastUpdatedAtSeconds: nowSeconds,
    };
    if (existing) Object.assign(existing, row);
    else model.hypotheses.push(row);
  }
  for (const identityUpdate of update.identityCandidates) {
    const existing = model.identityCandidates.find((row) => row.knownEntityHandle === identityUpdate.knownEntityHandle) || null;
    const row = {
      knownEntityHandle: identityUpdate.knownEntityHandle,
      status: subjectiveOperationStatus(identityUpdate.operation),
      lastOperation: identityUpdate.operation,
      confidenceBand: identityUpdate.confidenceBand,
      confidence: CONFIDENCE_BANDS[identityUpdate.confidenceBand],
      basisEvidenceIds: unique([...(existing?.basisEvidenceIds || []), ...identityUpdate.basisEvidenceIds]).slice(-24),
      lastUpdatedAtSeconds: nowSeconds,
    };
    if (existing) Object.assign(existing, row);
    else model.identityCandidates.push(row);
  }
  model.affectiveResponse = update.affectiveResponse;
  model.attentionPriority = update.attentionPriority;
  model.lastUpdatedAtSeconds = nowSeconds;
  model.revisionHistory = [...(model.revisionHistory || []), {
    id: `entity-revision:${stablePart(model.id)}:${nowSeconds}:${model.revisionHistory?.length || 0}`,
    atSeconds: nowSeconds,
    evidenceIds: referencedEvidenceIds,
    hypothesisOperations: update.hypotheses.map((row) => ({ hypothesisId: row.hypothesisId, operation: row.operation })),
    identityOperations: update.identityCandidates.map((row) => ({ knownEntityHandle: row.knownEntityHandle, operation: row.operation })),
  }].slice(-24);
  const next = boundedMemoryState(memory);
  return {
    valid: true,
    memory: next,
    update,
    model: clone(next.privateEntityModels.find((row) => row.id === model.id)),
    violations: [],
  };
}

function confidenceForBand(band = "medium") {
  return CONFIDENCE_BANDS[band] ?? CONFIDENCE_BANDS.medium;
}

function ownedEvidenceViolations(memory, evidenceIds, allowedEvidenceIds, code, field, message) {
  const allowed = new Set(unique(allowedEvidenceIds || memory.episodes.flatMap((episode) => episode.evidenceIds || [])));
  const unknownEvidenceIds = unique(evidenceIds).filter((id) => !allowed.has(id));
  return unknownEvidenceIds.length ? [{ code, field, message, evidence: { unknownEvidenceIds } }] : [];
}

function revisedLikelihood(prior, asserted, sourceReliability, confidenceBand, operation) {
  if (operation === "suspend" || operation === "doubt") return clamp01(prior, 0.1);
  const target = operation === "reject" || operation === "decrease" ? 0 : clamp01(asserted, 0.5);
  const evidenceWeight = clamp01(sourceReliability, 0.5) * confidenceForBand(confidenceBand);
  return clamp01(prior * (1 - evidenceWeight) + target * evidenceWeight, prior);
}

export function applyCharacterLocationBeliefUpdate(memoryState = {}, updateInput = {}, options = {}) {
  const memory = normalizeCharacterAgentMemoryState(memoryState, memoryState.ownerCharacterId);
  const update = {
    subjectHandle: clean(updateInput.subjectHandle, 220),
    locationHandle: clean(updateInput.locationHandle, 220),
    operation: clean(updateInput.operation, 40) || "revise",
    assertedLikelihood: clamp01(updateInput.assertedLikelihood, 0.5),
    sourceReliability: clamp01(updateInput.sourceReliability, 0.5),
    confidenceBand: Object.hasOwn(CONFIDENCE_BANDS, updateInput.confidenceBand) ? updateInput.confidenceBand : "medium",
    basisEvidenceIds: unique(updateInput.basisEvidenceIds || []),
    sourceType: clean(updateInput.sourceType, 80) || "inference",
  };
  const violations = [];
  if (!update.subjectHandle || !update.locationHandle) violations.push({
    code: "LOCATION_BELIEF_HANDLE_MISSING",
    field: "locationBelief",
    message: "地点认识必须包含人物认识层主题句柄和地点句柄。",
  });
  if (!canonicalEntityHandleAllowed(update.subjectHandle, options)) violations.push({
    code: "LOCATION_BELIEF_CANONICAL_ID_FORBIDDEN",
    field: "locationBelief.subjectHandle",
    message: "地点认识不能使用世界 canonical character id。",
  });
  violations.push(...ownedEvidenceViolations(
    memory,
    update.basisEvidenceIds,
    options.allowedEvidenceIds,
    "LOCATION_BELIEF_EVIDENCE_NOT_OWNED",
    "locationBelief.basisEvidenceIds",
    "地点认识引用了没有进入本人注意或记忆的证据。",
  ));
  if (violations.length) return { valid: false, memory, update, belief: null, violations };
  const nowSeconds = Math.max(0, Number(options.nowSeconds || memory.lastAdvancedAtSeconds || 0));
  let subject = memory.locationBeliefs.find((row) => row.subjectHandle === update.subjectHandle) || null;
  if (!subject) {
    subject = {
      id: `location-belief:${stablePart(memory.ownerCharacterId)}:${stablePart(update.subjectHandle)}`,
      ownerCharacterId: memory.ownerCharacterId,
      subjectHandle: update.subjectHandle,
      locations: [],
      unknownMass: 1,
      lastUpdatedAtSeconds: nowSeconds,
    };
    memory.locationBeliefs.push(subject);
  }
  let location = subject.locations.find((row) => row.locationHandle === update.locationHandle) || null;
  if (!location) {
    location = {
      locationHandle: update.locationHandle,
      currentLikelihood: 0.1,
      priorPresenceLikelihood: 0.1,
      status: "uncertain",
      basisEvidenceIds: [],
      revisionHistory: [],
      lastUpdatedAtSeconds: nowSeconds,
      worldTruthUsed: false,
    };
    subject.locations.push(location);
  }
  const prior = clamp01(location.currentLikelihood, 0.1);
  const next = revisedLikelihood(
    prior,
    update.assertedLikelihood,
    update.sourceReliability,
    update.confidenceBand,
    update.operation,
  );
  location.currentLikelihood = next;
  location.priorPresenceLikelihood = Math.max(clamp01(location.priorPresenceLikelihood), prior, next);
  location.status = update.operation === "suspend" ? "suspended"
    : update.operation === "doubt" ? "uncertain"
      : update.operation === "reject" ? "rejected" : "estimated";
  location.basisEvidenceIds = unique([...location.basisEvidenceIds, ...update.basisEvidenceIds]).slice(-32);
  location.lastUpdatedAtSeconds = nowSeconds;
  location.worldTruthUsed = false;
  location.revisionHistory = [...location.revisionHistory, {
    id: `location-revision:${stablePart(subject.id)}:${stablePart(location.locationHandle)}:${nowSeconds}:${location.revisionHistory.length}`,
    atSeconds: nowSeconds,
    operation: update.operation,
    priorLikelihood: prior,
    assertedLikelihood: update.assertedLikelihood,
    posteriorLikelihood: next,
    sourceReliability: update.sourceReliability,
    confidenceBand: update.confidenceBand,
    sourceType: update.sourceType,
    basisEvidenceIds: update.basisEvidenceIds,
  }].slice(-32);
  const totalKnown = subject.locations.reduce((sum, row) => sum + clamp01(row.currentLikelihood), 0);
  subject.unknownMass = clamp01(1 - Math.min(1, totalKnown));
  subject.lastUpdatedAtSeconds = nowSeconds;
  const normalized = boundedMemoryState(memory);
  const normalizedBelief = normalized.locationBeliefs
    .find((row) => row.subjectHandle === update.subjectHandle)?.locations
    .find((row) => row.locationHandle === update.locationHandle) || null;
  return { valid: true, memory: normalized, update, belief: clone(normalizedBelief), violations: [] };
}

export function applyCharacterSourceKnowledgeBeliefUpdate(memoryState = {}, updateInput = {}, options = {}) {
  const memory = normalizeCharacterAgentMemoryState(memoryState, memoryState.ownerCharacterId);
  const update = {
    sourceHandle: clean(updateInput.sourceHandle, 220),
    subjectHandle: clean(updateInput.subjectHandle, 220),
    operation: clean(updateInput.operation, 40) || "revise",
    assertedLikelihood: clamp01(updateInput.assertedLikelihood, 0.5),
    sourceReliability: clamp01(updateInput.sourceReliability, 0.5),
    confidenceBand: Object.hasOwn(CONFIDENCE_BANDS, updateInput.confidenceBand) ? updateInput.confidenceBand : "medium",
    basisEvidenceIds: unique(updateInput.basisEvidenceIds || []),
  };
  const violations = [];
  if (!update.sourceHandle || !update.subjectHandle) violations.push({
    code: "SOURCE_KNOWLEDGE_HANDLE_MISSING",
    field: "sourceKnowledgeBelief",
    message: "信息源认识必须包含感知来源句柄和人物认识层主题句柄。",
  });
  if (!canonicalEntityHandleAllowed(update.sourceHandle, options)
    || !canonicalEntityHandleAllowed(update.subjectHandle, options)) violations.push({
    code: "SOURCE_KNOWLEDGE_CANONICAL_ID_FORBIDDEN",
    field: "sourceKnowledgeBelief",
    message: "信息源认识不能使用世界 canonical character id。",
  });
  violations.push(...ownedEvidenceViolations(
    memory,
    update.basisEvidenceIds,
    options.allowedEvidenceIds,
    "SOURCE_KNOWLEDGE_EVIDENCE_NOT_OWNED",
    "sourceKnowledgeBelief.basisEvidenceIds",
    "信息源认识引用了没有进入本人注意或记忆的证据。",
  ));
  if (violations.length) return { valid: false, memory, update, belief: null, violations };
  const nowSeconds = Math.max(0, Number(options.nowSeconds || memory.lastAdvancedAtSeconds || 0));
  let belief = memory.sourceKnowledgeBeliefs.find((row) => (
    row.sourceHandle === update.sourceHandle && row.subjectHandle === update.subjectHandle
  )) || null;
  if (!belief) {
    belief = {
      id: `source-knowledge:${stablePart(memory.ownerCharacterId)}:${stablePart(update.sourceHandle)}:${stablePart(update.subjectHandle)}`,
      ownerCharacterId: memory.ownerCharacterId,
      sourceHandle: update.sourceHandle,
      subjectHandle: update.subjectHandle,
      likelihood: 0.1,
      basisEvidenceIds: [],
      revisionHistory: [],
      lastUpdatedAtSeconds: nowSeconds,
      worldTruthUsed: false,
    };
    memory.sourceKnowledgeBeliefs.push(belief);
  }
  const prior = clamp01(belief.likelihood, 0.1);
  const next = revisedLikelihood(prior, update.assertedLikelihood, update.sourceReliability, update.confidenceBand, update.operation);
  belief.likelihood = next;
  belief.status = update.operation === "suspend" ? "suspended"
    : update.operation === "doubt" ? "uncertain"
      : update.operation === "reject" ? "rejected" : "estimated";
  belief.basisEvidenceIds = unique([...belief.basisEvidenceIds, ...update.basisEvidenceIds]).slice(-32);
  belief.lastUpdatedAtSeconds = nowSeconds;
  belief.worldTruthUsed = false;
  belief.revisionHistory = [...belief.revisionHistory, {
    id: `source-knowledge-revision:${stablePart(belief.id)}:${nowSeconds}:${belief.revisionHistory.length}`,
    atSeconds: nowSeconds,
    operation: update.operation,
    priorLikelihood: prior,
    assertedLikelihood: update.assertedLikelihood,
    posteriorLikelihood: next,
    sourceReliability: update.sourceReliability,
    confidenceBand: update.confidenceBand,
    basisEvidenceIds: update.basisEvidenceIds,
  }].slice(-32);
  const normalized = boundedMemoryState(memory);
  return {
    valid: true,
    memory: normalized,
    update,
    belief: clone(normalized.sourceKnowledgeBeliefs.find((row) => row.id === belief.id)),
    violations: [],
  };
}

export function buildCharacterEpistemicBeliefState(memoryState = {}, options = {}) {
  const memory = normalizeCharacterAgentMemoryState(memoryState, memoryState.ownerCharacterId);
  const claimSubjectHandles = options.claimSubjectHandlesByBeliefId instanceof Map
    ? options.claimSubjectHandlesByBeliefId
    : new Map(Object.entries(options.claimSubjectHandlesByBeliefId || {}));
  const locationBeliefs = memory.locationBeliefs.map((subject) => ({
    subjectHandle: subject.subjectHandle,
    locations: subject.locations.map((location) => ({
      locationHandle: location.locationHandle,
      likelihood: location.currentLikelihood,
      basisEvidenceIds: [...location.basisEvidenceIds],
      lastUpdatedAtSeconds: location.lastUpdatedAtSeconds,
    })),
    unknownMass: subject.unknownMass,
  }));
  const priorPresenceBeliefs = memory.locationBeliefs.flatMap((subject) => subject.locations.map((location) => ({
    subjectHandle: subject.subjectHandle,
    locationHandle: location.locationHandle,
    likelihood: location.priorPresenceLikelihood,
    basisEvidenceIds: [...location.basisEvidenceIds],
  })));
  return {
    schemaVersion: 1,
    authority: "character-owned-epistemic-state",
    ownerCharacterId: memory.ownerCharacterId,
    hypotheses: clone(options.hypotheses || []),
    locationBeliefs,
    priorPresenceBeliefs,
    sourceKnowledgeBeliefs: memory.sourceKnowledgeBeliefs.map((row) => ({
      sourceHandle: row.sourceHandle,
      subjectHandle: row.subjectHandle,
      likelihood: row.likelihood,
      basisEvidenceIds: [...row.basisEvidenceIds],
      lastUpdatedAtSeconds: row.lastUpdatedAtSeconds,
    })),
    claimBeliefs: memory.beliefs.map((row) => ({
      beliefId: row.id,
      subjectHandle: clean(claimSubjectHandles.get(row.id), 180),
      propositionKey: clean(row.propositionKey, 220),
      claimSummary: clean(row.currentValue || row.claim || row.proposition, 360),
      confidence: clamp01(
        row.confidence,
        /high|verified|certain/u.test(`${row.confidenceBand || ""} ${row.status || ""}`)
          ? 0.82
          : /low|doubt|weak/u.test(`${row.confidenceBand || ""} ${row.status || ""}`)
            ? 0.3
            : 0.56,
      ),
      confidenceBand: clean(row.confidenceBand || row.status, 120),
      sourceStatus: clean(row.sourceType || row.provenance?.kind || row.status, 120),
      basisEvidenceIds: unique([
        ...(row.supportingEvidenceIds || []),
        ...(row.provenance?.evidenceIds || []),
        ...(row.supportingEpisodeIds || []),
      ]).slice(-24),
    })).filter((row) => row.claimSummary),
    privateEntityModels: clone(memory.privateEntityModels),
    worldTruthUsed: false,
  };
}

function semanticCueMatch(recordFrame = {}, cues = {}, storedRetrievalCues = []) {
  const frame = normalizeSemanticFrame(recordFrame);
  let score = 0;
  const cueCharacterIds = new Set(unique(cues.characterIds || []));
  const frameCharacterIds = new Set(Object.values(frame.roles || {}));
  if ([...cueCharacterIds].some((id) => frameCharacterIds.has(id))) score += 0.32;
  if ((cues.topicIds || []).includes(frame.topicId)) score += 0.28;
  if ((cues.predicates || []).includes(frame.predicate)) score += 0.24;
  const lexical = unique(cues.lexicalCues || []);
  const lexicalAnchors = unique([
    ...frame.lexicalAnchors,
    ...(storedRetrievalCues || []),
  ]);
  if (lexical.some((cue) => lexicalAnchors.some((anchor) => anchor.includes(cue) || cue.includes(anchor))
    || frame.object.label.includes(cue))) score += 0.2;
  if (cues.sourceImpactId && cues.sourceImpactId === recordFrame.sourceImpactId) score += 0.45;
  return clamp01(score);
}

function episodeCueMatch(episode = {}, cues = {}) {
  let score = semanticCueMatch(episode.semanticFrame, cues, episode.retrievalCues);
  if (cues.sourceImpactId && episodeHasImpact(episode, cues.sourceImpactId)) score += 0.55;
  const ids = new Set(unique(cues.characterIds || []));
  if (ids.has(episode.perception?.sourceCharacterId)) score += 0.18;
  const lexical = unique(cues.lexicalCues || []);
  const body = `${episode.perception?.content || ""} ${episode.perception?.topic || ""}`;
  if (lexical.some((cue) => body.includes(cue))) score += 0.18;
  return clamp01(score);
}

function normalizeRecallProfile(input = {}) {
  const profile = {};
  for (const [key, fallback] of Object.entries(DEFAULT_RECALL_PROFILE)) {
    profile[key] = clamp01(input[key], fallback);
  }
  return profile;
}

function normalizeRecallContext(input = {}) {
  return {
    fatigue: clamp01(input.fatigue, 0.2),
    cognitiveLoad: clamp01(input.cognitiveLoad, 0.2),
    emotionalArousal: clamp01(input.emotionalArousal, 0.35),
    goalCongruence: clamp01(input.goalCongruence, 0.45),
    currentBeliefBias: clamp01(input.currentBeliefBias, 0.2),
    currentAffectBias: clamp01(input.currentAffectBias, 0.2),
    interference: clamp01(input.interference, 0.18),
    rehearsal: clamp01(input.rehearsal, 0),
    suppression: clamp01(input.suppression, 0),
  };
}

/**
 * Shared recall mathematics. A profile changes sensitivity weights, while the
 * formula and authority boundary stay common across characters. The result is
 * reconstruction pressure, not a globally adjudicated memory sentence.
 */
export function calculateCharacterRecallReconstruction(episode = {}, inputs = {}) {
  const profile = normalizeRecallProfile(inputs.profile || {});
  const context = normalizeRecallContext(inputs.context || {});
  const cueMatch = clamp01(inputs.cueMatch, 0);
  const accessibility = clamp01(episode.accessibility, 0.42);
  const retention = clamp01(episode.retentionStrength, 0.42);
  const consolidation = clamp01(episode.consolidationLevel, 0);
  const sourceConfidence = clamp01(episode.source?.confidence, 0.5);
  const avoidance = clamp01(episode.avoidance, 0);
  const competition = clamp01(episode.competition, 0);
  const rehearsal = clamp01(
    context.rehearsal + Math.min(0.35, Number(episode.retrievalCount || 0) * 0.035 * profile.rumination),
  );
  const interference = clamp01(context.interference + competition * 0.45);
  const suppression = clamp01(context.suppression + avoidance * 0.55);
  const recallLogit = -1.05
    + accessibility * 1.15
    + retention * 0.92
    + cueMatch * 1.35 * profile.cueSensitivity
    + rehearsal * 0.58 * profile.rehearsalSensitivity
    + context.goalCongruence * 0.52 * profile.goalCongruenceSensitivity
    + consolidation * 0.35
    - context.fatigue * 0.62
    - context.cognitiveLoad * 0.58
    - interference * 0.7 * profile.interferenceSensitivity
    - suppression * 0.66 * profile.suppressionSensitivity;
  const recallProbability = clamp01(logistic(recallLogit));
  const fidelityLogit = -0.78
    + retention * 1.2
    + accessibility * 0.45
    + cueMatch * 0.72
    + sourceConfidence * 0.62 * profile.sourceSensitivity
    + consolidation * 0.42
    - context.fatigue * 0.62
    - context.cognitiveLoad * 0.55
    - interference * 0.94 * profile.interferenceSensitivity
    - context.emotionalArousal * 0.18;
  const fidelity = clamp01(logistic(fidelityLogit));
  const sourceClarity = clamp01(
    sourceConfidence * profile.sourceSensitivity
      + fidelity * 0.34
      + cueMatch * 0.16
      - interference * 0.42
      - context.fatigue * 0.18
      - profile.sourceConfusionRate * 0.38,
  );
  const distortionPressure = clamp01(
    (1 - fidelity) * 0.52
      + interference * 0.32 * profile.interferenceSensitivity
      + context.currentBeliefBias * 0.18 * profile.beliefBiasSensitivity
      + context.currentAffectBias * 0.16 * profile.affectBiasSensitivity
      + context.emotionalArousal * 0.08
      + profile.sourceConfusionRate * 0.14,
  );
  const intrusionPressure = clamp01(
    interference * 0.52
      + (1 - fidelity) * 0.28
      + context.currentBeliefBias * 0.12
      + profile.sourceConfusionRate * 0.16,
  );
  const familiarity = clamp01(accessibility + rehearsal * 0.38);
  const subjectiveConfidence = clamp01(
    recallProbability * 0.42
      + fidelity * 0.32
      + familiarity * 0.2
      + context.emotionalArousal * 0.1,
  );
  return {
    recallProbability,
    fidelity,
    sourceClarity,
    distortionPressure,
    intrusionPressure,
    subjectiveConfidence,
    metacognitiveGap: clamp01(Math.abs(subjectiveConfidence - fidelity)),
    factors: {
      cueMatch,
      accessibility,
      retention,
      consolidation,
      sourceConfidence,
      rehearsal,
      interference,
      suppression,
      ...context,
    },
    profile,
    formulaVersion: 1,
    formula: "sigmoid(accessibility + retention + cue + rehearsal + goal + consolidation - fatigue - load - interference - suppression)",
  };
}

function recallDetailBand(fidelity = 0) {
  if (fidelity >= 0.72) return "vivid";
  if (fidelity >= 0.44) return "gist";
  return "fragmentary";
}

function reconstructedContentForEpisode(episode = {}, detailBand = "gist") {
  const fragments = (episode.perception?.fragments || []).filter((fragment) => clean(fragment?.content));
  const appraisalInterpretation = [...(episode.interpretations || [])].reverse().find((row) => row.source === "character-agent-appraisal");
  const latestInterpretation = [...(episode.interpretations || [])].reverse().find((row) => clean(row.summary));
  const exact = clean(fragments.map((fragment) => fragment.content).join("；") || episode.perception?.content, 520);
  const gist = clean(appraisalInterpretation?.summary || latestInterpretation?.summary || episode.perception?.topic || exact, 360);
  if (detailBand === "vivid") return exact || gist;
  if (detailBand === "gist") return gist || exact;
  return clean(gist || exact, 96);
}

function recallSourceAttribution(episode = {}, sourceClarity = 0) {
  const source = episode.source || {};
  if (sourceClarity >= 0.72) return {
    status: source.identityKnown === false ? "anonymous" : "identified",
    characterId: source.identityKnown === false ? "" : clean(source.immediateSourceCharacterId, 180),
    entityHandle: clean(source.sourceEntityHandle, 220),
    kind: clean(source.kind, 80),
  };
  if (sourceClarity >= 0.42) return {
    status: "uncertain",
    characterId: "",
    entityHandle: clean(source.sourceEntityHandle, 220),
    kind: clean(source.kind, 80),
  };
  return { status: "unattributed", characterId: "", entityHandle: "", kind: "uncertain" };
}

function recallEpisodeView(episode = {}, recall = {}) {
  return {
    id: episode.id,
    ownerCharacterId: episode.ownerCharacterId,
    kind: "reconstructed_recall",
    recallInstanceId: recall.id,
    sourceEpisodeIds: [...(recall.sourceEpisodeIds || [])],
    sourceTraceIds: [...(recall.sourceTraceIds || [])],
    perceivedAt: clone(recall.temporalAttribution || {}),
    perception: {
      modality: episode.perception?.modality || "memory",
      modalities: unique(episode.perception?.modalities || []),
      content: recall.rememberedContent,
      topic: recall.rememberedTopic,
      sourceCharacterId: recall.sourceAttribution?.characterId || "",
      sourceEntityHandle: recall.sourceAttribution?.entityHandle || "",
      identityKnown: recall.sourceAttribution?.status === "identified",
      detailBand: recall.detailBand,
    },
    semanticFrame: clone(episode.semanticFrame || null),
    source: clone(recall.sourceAttribution || {}),
    accessibility: Number(episode.accessibility || 0),
    retentionStrength: Number(episode.retentionStrength || 0),
    importance: Number(episode.importance || 0),
    recallQuality: clone(recall.reconstruction || {}),
    distortionFlags: [...(recall.distortionFlags || [])],
    intrusionCandidates: clone(recall.intrusionCandidates || []),
  };
}

export function retrieveCharacterAgentMemory(memoryState = {}, cues = {}) {
  const state = normalizeCharacterAgentMemoryState(memoryState, memoryState.ownerCharacterId);
  const nowSeconds = Math.max(0, Number(cues.nowSeconds || state.lastAdvancedAtSeconds || 0));
  const limit = Math.max(1, Math.min(16, Number(cues.limit || 8)));
  const ranked = state.episodes.map((episode) => {
    const cueMatch = episodeCueMatch(episode, cues);
    const avoidance = clamp01(episode.avoidance || 0);
    const competition = clamp01(episode.competition || 0);
    const score = clamp01(
      Number(episode.accessibility || 0) * 0.42
      + Number(episode.retentionStrength || 0) * 0.18
      + cueMatch * 0.3
      + Number(episode.importance || 0) * 0.1
      - avoidance * 0.16
      - competition * 0.08,
    );
    return { episode, cueMatch, score };
  }).filter((row) => row.score >= 0.18)
    .sort((left, right) => right.score - left.score || Number(right.episode.perceivedAt?.seconds || 0) - Number(left.episode.perceivedAt?.seconds || 0))
    .slice(0, limit);
  const episodeIds = new Set(ranked.map((row) => row.episode.id));
  const frameIds = new Set(ranked.map((row) => row.episode.semanticFrame?.id).filter(Boolean));
  const cueCharacters = new Set(unique(cues.characterIds || []));
  const commitments = state.commitments.filter((commitment) => (
    commitment.status !== "resolved"
    || (commitment.sourceEpisodeIds || []).some((id) => episodeIds.has(id))
  )).filter((commitment) => (
    !cueCharacters.size
    || cueCharacters.has(commitment.counterpartyCharacterId)
    || cueCharacters.has(commitment.beneficiaryCharacterId)
    || frameIds.has(commitment.semanticFrame?.id)
  )).slice(0, limit);
  const beliefs = state.beliefs.filter((belief) => (
    frameIds.has(belief.semanticFrame?.id)
    || (belief.supportingEpisodeIds || []).some((id) => episodeIds.has(id))
    || semanticCueMatch(belief.semanticFrame, cues) > 0
  )).sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0)).slice(0, limit);
  return {
    schemaVersion: CHARACTER_AGENT_MEMORY_SCHEMA_VERSION,
    ownerCharacterId: state.ownerCharacterId,
    retrievedAtSeconds: nowSeconds,
    episodes: ranked.map((row) => clone(row.episode)),
    beliefs: clone(beliefs),
    commitments: clone(commitments),
    impressions: clone(state.impressions.slice(-Math.min(4, limit))),
    selfNarrative: clone(state.selfNarrative),
    retrievalTrace: ranked.map((row) => ({
      episodeId: row.episode.id,
      score: row.score,
      cueMatch: row.cueMatch,
      accessibility: row.episode.accessibility,
      retentionStrength: row.episode.retentionStrength,
    })),
  };
}

/**
 * Creates owner-private recall instances without changing experience traces.
 * The returned memoryContext is safe for the Character Agent: it contains the
 * reconstructed version that came to mind now, not an exact server-side replay.
 */
export function reconstructCharacterAgentMemory(memoryState = {}, cues = {}, options = {}) {
  const memory = normalizeCharacterAgentMemoryState(memoryState, memoryState.ownerCharacterId);
  const retrieved = retrieveCharacterAgentMemory(memory, cues);
  const profile = normalizeRecallProfile(options.profile || {});
  const context = normalizeRecallContext(options.context || {});
  const traceBefore = (memory.experienceTraces || []).map((trace) => JSON.stringify(trace));
  const recalls = [];
  const episodeViews = [];
  for (const [index, retrievedEpisode] of (retrieved.episodes || []).entries()) {
    const episode = memory.episodes.find((row) => row.id === retrievedEpisode.id);
    if (!episode) continue;
    const retrievalTrace = (retrieved.retrievalTrace || []).find((row) => row.episodeId === episode.id) || {};
    const reconstruction = calculateCharacterRecallReconstruction(episode, {
      cueMatch: retrievalTrace.cueMatch,
      profile,
      context,
    });
    const detailBand = recallDetailBand(reconstruction.fidelity);
    const competitors = (retrieved.episodes || []).filter((candidate) => candidate.id !== episode.id).slice(0, 2);
    const intrusionCandidates = reconstruction.intrusionPressure >= 0.34
      ? competitors.map((candidate, competitorIndex) => ({
        episodeId: candidate.id,
        sourceTraceId: clean(candidate.experienceTraceIds?.[0] || candidate.experienceTraceId, 260),
        contentFragment: clean(candidate.perception?.topic || candidate.perception?.content, 120),
        pressure: clamp01(reconstruction.intrusionPressure * (competitorIndex ? 0.62 : 0.84)),
      })).filter((candidate) => candidate.contentFragment)
      : [];
    const sourceAttribution = recallSourceAttribution(episode, reconstruction.sourceClarity);
    const distortionFlags = [
      detailBand !== "vivid" ? "detail_omission" : "",
      reconstruction.sourceClarity < 0.72 ? "source_uncertain" : "",
      reconstruction.fidelity < 0.58 ? "temporal_blur" : "",
      reconstruction.fidelity < 0.48 ? "spatial_blur" : "",
      context.currentAffectBias * profile.affectBiasSensitivity >= 0.45 ? "affect_coloring" : "",
      context.currentBeliefBias * profile.beliefBiasSensitivity >= 0.45 ? "belief_coloring" : "",
      intrusionCandidates.length ? "interference_intrusion" : "",
    ].filter(Boolean);
    const recallNumber = Math.max(0, Number(episode.retrievalCount || 0)) + 1;
    const recall = {
      id: `recall:${stablePart(memory.ownerCharacterId)}:${stablePart(episode.id)}:${Math.max(0, Number(cues.nowSeconds || 0))}:${recallNumber}`,
      ownerCharacterId: memory.ownerCharacterId,
      recalledAtSeconds: Math.max(0, Number(cues.nowSeconds || memory.lastAdvancedAtSeconds || 0)),
      sourceEpisodeIds: [episode.id],
      sourceTraceIds: unique(episode.experienceTraceIds || [episode.experienceTraceId]),
      evidenceIds: unique(episode.evidenceIds || []),
      cueSnapshot: {
        sourceImpactId: clean(cues.sourceImpactId, 220),
        characterIds: unique(cues.characterIds || []),
        topicIds: unique(cues.topicIds || []),
        predicates: unique(cues.predicates || []),
        lexicalCues: unique(cues.lexicalCues || []),
      },
      detailBand,
      rememberedContent: reconstructedContentForEpisode(episode, detailBand),
      rememberedTopic: clean(episode.perception?.topic || episode.semanticFrame?.object?.label, 180),
      sourceAttribution,
      temporalAttribution: reconstruction.fidelity >= 0.58
        ? clone(episode.perceivedAt || {})
        : { worldDay: episode.perceivedAt?.worldDay ?? null, precision: reconstruction.fidelity >= 0.4 ? "day_only" : "uncertain" },
      spatialAttribution: reconstruction.fidelity >= 0.48
        ? { locationId: episode.perceivedAt?.locationId || "", zoneId: episode.perceivedAt?.zoneId || "", precision: "remembered" }
        : { locationId: "", zoneId: "", precision: "uncertain" },
      reconstruction,
      distortionFlags,
      intrusionCandidates,
      immutableExperienceTracePreserved: true,
      visibility: "owner-private",
    };
    recalls.push(recall);
    episodeViews.push(recallEpisodeView(episode, recall));
    episode.retrievalCount = recallNumber;
    episode.lastRetrievedAtSeconds = recall.recalledAtSeconds;
    episode.accessibility = clamp01(Number(episode.accessibility || 0) + 0.035 * (1 - Number(episode.accessibility || 0)));
  }
  memory.recallInstances = [...(memory.recallInstances || []), ...recalls].slice(-MAX_RECALL_INSTANCES);
  for (const [index, trace] of (memory.experienceTraces || []).entries()) {
    if (traceBefore[index] !== JSON.stringify(trace)) throw new Error(`IMMUTABLE_EXPERIENCE_TRACE_MUTATED:${trace.id}`);
  }
  const memoryContext = {
    ...retrieved,
    episodes: episodeViews,
    recallInstances: clone(recalls),
    retrievalTrace: (retrieved.retrievalTrace || []).map((row) => ({
      ...row,
      recallInstanceId: recalls.find((recall) => recall.sourceEpisodeIds.includes(row.episodeId))?.id || "",
    })),
  };
  return { memory: boundedMemoryState(memory), memoryContext };
}

export function memoryInfluenceForCandidate(memoryState = {}, candidate = {}, options = {}) {
  const frame = candidate.semanticFrame ? normalizeSemanticFrame(candidate.semanticFrame) : null;
  const targetCharacterId = clean(candidate.targetCharacterId, 180);
  const cues = {
    nowSeconds: options.nowSeconds,
    sourceImpactId: candidate.sourceImpactId || candidate.causalParentImpactId || "",
    characterIds: targetCharacterId ? [targetCharacterId] : [],
    topicIds: frame?.topicId ? [frame.topicId] : [],
    predicates: frame?.predicate ? [frame.predicate] : [],
    lexicalCues: frame?.lexicalAnchors || [],
    limit: 10,
  };
  const retrieved = retrieveCharacterAgentMemory(memoryState, cues);
  const matchingEpisodes = retrieved.episodes.filter((episode) => (
    (cues.sourceImpactId && episodeHasImpact(episode, cues.sourceImpactId))
    || (frame?.id && episode.semanticFrame?.id === frame.id)
    || (frame?.topicId && episode.semanticFrame?.topicId === frame.topicId)
    || (targetCharacterId && Object.values(episode.semanticFrame?.roles || {}).includes(targetCharacterId))
  ));
  const matchingCommitments = retrieved.commitments.filter((commitment) => (
    commitment.status !== "resolved"
    && (
      (targetCharacterId && [commitment.counterpartyCharacterId, commitment.beneficiaryCharacterId].includes(targetCharacterId))
      || (frame?.id && commitment.semanticFrame?.id === frame.id)
      || (frame?.topicId && commitment.topicId === frame.topicId)
    )
  ));
  const episodePressure = Math.min(0.42, matchingEpisodes.reduce((sum, episode) => sum + Number(episode.accessibility || 0) * 0.24, 0));
  const commitmentPressure = Math.min(0.5, matchingCommitments.reduce((sum, commitment) => sum + Number(commitment.importance || 0.7) * 0.42, 0));
  const beliefPressure = Math.min(0.18, retrieved.beliefs.reduce((sum, belief) => sum + Number(belief.confidence || 0) * 0.08, 0));
  return {
    total: clamp01(episodePressure + commitmentPressure + beliefPressure),
    episodePressure,
    commitmentPressure,
    beliefPressure,
    basisEpisodeIds: matchingEpisodes.map((episode) => episode.id),
    basisBeliefIds: retrieved.beliefs.map((belief) => belief.id),
    basisCommitmentIds: matchingCommitments.map((commitment) => commitment.id),
    explanation: matchingCommitments.length
      ? "当前候选回应了本人记得的未完承诺。"
      : matchingEpisodes.length ? "当前候选与本人可提取的经历直接相关。" : "当前没有可提取记忆为此候选增加压力。",
  };
}

export function advanceCharacterAgentMemory(memoryState = {}, options = {}) {
  const state = normalizeCharacterAgentMemoryState(memoryState, memoryState.ownerCharacterId);
  const nowSeconds = Math.max(Number(state.lastAdvancedAtSeconds || 0), Number(options.nowSeconds || 0));
  const elapsedSeconds = Math.max(0, nowSeconds - Number(state.lastAdvancedAtSeconds || 0));
  const elapsedDays = elapsedSeconds / (24 * 60 * 60);
  const sleepCycles = Math.max(0, Number(options.sleepCycles || 0));
  const openSourceEpisodes = new Set(state.commitments
    .filter((commitment) => commitment.status !== "resolved")
    .flatMap((commitment) => commitment.sourceEpisodeIds || []));
  state.episodes = state.episodes.map((episode) => {
    const next = clone(episode);
    const importance = clamp01(next.importance, 0.5);
    const protectedEpisode = Boolean(next.protected || openSourceEpisodes.has(next.id));
    const accessibilityLambda = protectedEpisode ? 0.035 : 0.11 + (1 - importance) * 0.09;
    const retentionLambda = protectedEpisode ? 0.006 : 0.018 + (1 - importance) * 0.018;
    next.accessibility = clamp01(Number(next.accessibility || 0) * Math.exp(-accessibilityLambda * elapsedDays));
    next.retentionStrength = clamp01(Number(next.retentionStrength || 0) * Math.exp(-retentionLambda * elapsedDays));
    if (sleepCycles > 0 && Number(next.retentionStrength || 0) >= 0.48) {
      const consolidation = Math.min(0.24, sleepCycles * 0.025 * importance);
      next.consolidationLevel = clamp01(Number(next.consolidationLevel || 0) + consolidation);
      next.retentionStrength = clamp01(Number(next.retentionStrength || 0) + consolidation * (1 - Number(next.retentionStrength || 0)));
    }
    return next;
  }).filter((episode) => (
    episode.protected
    || openSourceEpisodes.has(episode.id)
    || Number(episode.retentionStrength || 0) >= 0.12
    || Number(episode.accessibility || 0) >= 0.08
  ));
  const faded = state.episodes.filter((episode) => Number(episode.accessibility || 0) < 0.22 && Number(episode.retentionStrength || 0) >= 0.28);
  const impressionGroups = new Map();
  for (const episode of faded) {
    const key = episode.semanticFrame?.topicId || episode.perception?.sourceCharacterId || "ordinary-life";
    const group = impressionGroups.get(key) || [];
    group.push(episode);
    impressionGroups.set(key, group);
  }
  for (const [key, episodes] of impressionGroups) {
    if (episodes.length < 2) continue;
    const id = `impression:${stablePart(state.ownerCharacterId)}:${stablePart(key)}`;
    const existing = state.impressions.find((impression) => impression.id === id);
    const row = {
      id,
      ownerCharacterId: state.ownerCharacterId,
      topicId: key,
      summary: clean(episodes.map((episode) => episode.perception?.topic || episode.perception?.content).filter(Boolean).join("；"), 360),
      sourceEpisodeIds: episodes.map((episode) => episode.id),
      confidence: clamp01(episodes.reduce((sum, episode) => sum + Number(episode.retentionStrength || 0), 0) / episodes.length),
      updatedAtSeconds: nowSeconds,
    };
    if (existing) Object.assign(existing, row);
    else state.impressions.push(row);
  }
  state.lastAdvancedAtSeconds = nowSeconds;
  return boundedMemoryState(state);
}

export function validateSemanticRoleBinding(actualInput = {}, expectedInput = {}) {
  const actual = normalizeSemanticFrame(actualInput);
  const expected = normalizeSemanticFrame(expectedInput);
  const violations = [];
  for (const [role, expectedCharacterId] of sortedRoleEntries(expected.roles)) {
    const actualCharacterId = actual.roles?.[role] || "";
    if (actualCharacterId === expectedCharacterId) continue;
    violations.push({
      code: "SEMANTIC_ROLE_BINDING_MISMATCH",
      field: `semanticFrame.roles.${role}`,
      message: `社会事件角色 ${role} 必须保持为原记忆中的人物，不能在回答或行动中交换。`,
      evidence: { role, expectedCharacterId, actualCharacterId },
    });
  }
  if (expected.predicate && actual.predicate !== expected.predicate) {
    violations.push({
      code: "SEMANTIC_PREDICATE_MISMATCH",
      field: "semanticFrame.predicate",
      message: "后续回应必须处理原记忆中的同一件事。",
      evidence: { expectedPredicate: expected.predicate, actualPredicate: actual.predicate },
    });
  }
  if (expected.topicId && actual.topicId !== expected.topicId) {
    violations.push({
      code: "SEMANTIC_TOPIC_MISMATCH",
      field: "semanticFrame.topicId",
      message: "后续回应不能把原承诺偷换成另一个话题。",
      evidence: { expectedTopicId: expected.topicId, actualTopicId: actual.topicId },
    });
  }
  return { ok: violations.length === 0, violations, actual, expected };
}

export function applyCharacterMemoryOutcome(memoryState = {}, input = {}) {
  const state = normalizeCharacterAgentMemoryState(memoryState, memoryState.ownerCharacterId);
  const frame = normalizeSemanticFrame(input.frame || {});
  const nowSeconds = Math.max(0, Number(input.nowSeconds || state.lastAdvancedAtSeconds || 0));
  for (const commitment of state.commitments) {
    if (["resolved", "dropped"].includes(commitment.status)) continue;
    if (commitment.semanticFrame?.id !== frame.id
      && commitment.topicId !== frame.topicId
      && commitment.semanticFrame?.predicate !== frame.predicate) continue;
    const validation = validateSemanticRoleBinding(frame, commitment.semanticFrame || {});
    if (!validation.ok) continue;
    if (!frame.decisionValue || !["accept", "refuse", "defer"].includes(frame.decisionValue)) continue;
    commitment.status = frame.decisionValue === "defer" ? "deferred" : "resolved";
    commitment.outcome = frame.decisionValue;
    commitment.outcomeEpisodeId = clean(input.sourceEpisodeId, 240);
    commitment.updatedAtSeconds = nowSeconds;
  }
  return state;
}

/**
 * Records a confirmed identity-changing choice without erasing the person's
 * earlier self-understanding. The story/Character Agent layer supplies the
 * significance judgment; memory only preserves the revision and its evidence.
 */
export function reviseCharacterSelfNarrative(memoryState = {}, input = {}) {
  const state = normalizeCharacterAgentMemoryState(memoryState, memoryState.ownerCharacterId);
  const ownerCharacterId = state.ownerCharacterId;
  const ownedEpisodeIds = new Set(state.episodes.map((episode) => episode.id));
  const sourceEpisodeIds = unique(input.sourceEpisodeIds || []).filter((id) => ownedEpisodeIds.has(id)).slice(-12);
  const claim = normalizeSelfClaim({
    id: input.claimId,
    claim: input.claim,
    confidence: input.confidence,
    adoptedAtSeconds: input.nowSeconds,
    sourceEpisodeIds,
    semanticFrameId: input.semanticFrameId,
  }, ownerCharacterId);
  const significance = clamp01(input.significance, 0);
  if (!input.confirmedChoice || significance < 0.68 || !claim.claim || !sourceEpisodeIds.length) return state;
  if (state.selfNarrative.currentClaims.some((item) => item.claim === claim.claim)) return state;
  const nowSeconds = Math.max(0, Number(input.nowSeconds || state.lastAdvancedAtSeconds || 0));
  const revisionId = clean(
    input.id || `self-revision:${stablePart(ownerCharacterId)}:${stablePart(input.semanticFrameId || claim.id)}:${nowSeconds}`,
    320,
  );
  if (state.selfNarrative.versions.some((version) => version.id === revisionId)) return state;
  const previousClaims = clone(state.selfNarrative.currentClaims || []);
  const replacesClaimIds = new Set(unique([
    ...(input.replacesClaimIds || []),
    input.replacesClaimId,
  ]));
  const retainedClaims = previousClaims.filter((item) => !replacesClaimIds.has(item.id));
  const nextClaims = [...retainedClaims, claim].slice(-24);
  state.selfNarrative.currentClaims = nextClaims;
  state.selfNarrative.versions = [...(state.selfNarrative.versions || []), {
    id: revisionId,
    ownerCharacterId,
    revisedAtSeconds: nowSeconds,
    significance,
    permanence: clamp01(input.permanence, significance),
    semanticFrameId: clean(input.semanticFrameId, 260),
    reason: clean(input.reason, 360),
    previousClaims,
    nextClaims: clone(nextClaims),
    sourceEpisodeIds,
  }].slice(-16);
  const evidenceIds = new Set(sourceEpisodeIds);
  state.episodes = state.episodes.map((episode) => evidenceIds.has(episode.id) ? {
    ...episode,
    protected: true,
    importance: Math.max(Number(episode.importance || 0), significance),
  } : episode);
  return boundedMemoryState(state);
}

export function compactCharacterAgentMemory(memoryState = {}) {
  const state = normalizeCharacterAgentMemoryState(memoryState, memoryState.ownerCharacterId);
  return boundedMemoryState({
    ...state,
    episodes: state.episodes,
    beliefs: state.beliefs,
    commitments: state.commitments,
    impressions: state.impressions,
    privateEntityModels: state.privateEntityModels,
    locationBeliefs: state.locationBeliefs,
    sourceKnowledgeBeliefs: state.sourceKnowledgeBeliefs,
    selfNarrative: {
      currentClaims: (state.selfNarrative?.currentClaims || []).slice(-24),
      versions: (state.selfNarrative?.versions || []).slice(-16),
      pendingCandidates: (state.selfNarrative?.pendingCandidates || []).slice(-16),
    },
  });
}

/**
 * Conservatively imports the old global prose list. Prose is preserved as an
 * unstructured recollection, but no social roles or commitments are inferred
 * from names/word order. Typed authority begins only with new semantic frames.
 */
export function migrateLegacyCharacterMemories(memoryState = {}, legacyRows = [], options = {}) {
  let state = normalizeCharacterAgentMemoryState(memoryState, options.ownerCharacterId || memoryState.ownerCharacterId);
  const ownerCharacterId = state.ownerCharacterId;
  for (const legacy of legacyRows || []) {
    if (!legacy || legacy.characterId !== ownerCharacterId) continue;
    const legacyId = clean(legacy.id || `${legacy.sourceDraftId || "legacy"}:${legacy.content || legacy.privateVersion || "memory"}`, 240);
    const impactId = `legacy:${legacyId}`;
    if (state.episodes.some((episode) => episode.sourceImpactId === impactId)) continue;
    const content = clean(legacy.privateVersion || legacy.content || legacy.publicVersion || "旧记忆摘要", 420);
    const reliability = clamp01(Number(legacy.reliability ?? 48) / 100, 0.48);
    const importance = clamp01(Number(legacy.heat ?? legacy.emotionalCharge ?? 40) / 100, 0.4);
    state = encodeCharacterPerception(state, {
      impact: {
        id: impactId,
        objectiveEventId: clean(legacy.sourceCanonEventId || legacy.sourceDraftId || impactId, 240),
        sourceCharacterId: clean(legacy.targetCharacterId || "legacy:unknown-source", 180),
        locationId: clean(legacy.locationId, 180),
        type: "legacy_memory",
        modality: "memory",
        content,
        topic: clean(legacy.type || "旧记忆", 120),
        semanticFrame: {
          id: `frame:${impactId}`,
          kind: "legacy_unstructured",
          predicate: "legacy_recollection",
          topicId: clean(legacy.type || legacy.stance || legacyId, 140),
          roles: {},
          object: { id: legacyId, label: content },
          lexicalAnchors: [],
          importance,
        },
        provenance: {
          kind: "legacy_summary",
          sourceImpactIds: [],
          confidence: Math.min(0.65, reliability),
        },
      },
      delivery: {
        id: `delivery:${impactId}`,
        impactId,
        recipientId: ownerCharacterId,
        sourceCharacterId: clean(legacy.targetCharacterId || "legacy:unknown-source", 180),
        modality: "memory",
        content,
        topic: clean(legacy.type || "旧记忆", 120),
        directed: true,
        receivedIntensity: Math.max(32, reliability * 100),
        personalRelevance: importance * 70,
        impactScore: Math.max(35, importance * 100),
        distance: 0,
        deliveredAtSeconds: Math.max(0, Number(legacy.atSeconds || 0)),
        semanticFrame: {
          id: `frame:${impactId}`,
          kind: "legacy_unstructured",
          predicate: "legacy_recollection",
          topicId: clean(legacy.type || legacy.stance || legacyId, 140),
          roles: {},
          object: { id: legacyId, label: content },
          lexicalAnchors: [],
          importance,
        },
        provenance: {
          kind: "legacy_summary",
          sourceImpactIds: [],
          confidence: Math.min(0.65, reliability),
        },
      },
      nowSeconds: Math.max(0, Number(legacy.atSeconds || 0)),
      worldDay: Math.max(0, Number(legacy.day || 0)),
      locationId: clean(legacy.locationId, 180),
      encodingContext: {
        attention: reliability,
        goalRelevance: importance,
        surprise: 0,
        emotionalArousal: importance,
        selfRelevance: importance,
        relationshipRelevance: legacy.targetCharacterId ? importance : 0.1,
        fatigue: 0.25,
        cognitiveLoad: 0.2,
      },
      interpretation: content,
    });
  }
  return compactCharacterAgentMemory(state);
}
