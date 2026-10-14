import {
  normalizeCharacterAgentMemoryState,
  normalizeSemanticFrame,
} from "../../engine/characterAgentMemory.js";

export const CHARACTER_REFLECTION_VERSION = "character-reflection-v1";

const DEFAULT_THRESHOLD = 4;
const DEFAULT_MAX_SOURCE_MEMORY_IDS = 24;
const MAX_INSIGHTS_PER_OPPORTUNITY = 5;

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function stablePart(value = "") {
  return clean(value).replace(/[^\p{L}\p{N}:._-]+/gu, "_") || "unknown";
}

function clamp01(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
}

function rounded(value) {
  return Math.round(Math.max(0, Number(value || 0)) * 1e9) / 1e9;
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function fail(code, message, evidence = {}) {
  const error = new Error(message);
  error.code = code;
  error.evidence = clone(evidence);
  return error;
}

function reflectionPolicy(input = {}, fallbackThreshold = DEFAULT_THRESHOLD) {
  const threshold = Number(input.threshold ?? fallbackThreshold);
  const maxSourceMemoryIds = Math.floor(Number(input.maxSourceMemoryIds || DEFAULT_MAX_SOURCE_MEMORY_IDS));
  return {
    threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_THRESHOLD,
    maxSourceMemoryIds: Number.isFinite(maxSourceMemoryIds) && maxSourceMemoryIds > 0
      ? Math.min(64, maxSourceMemoryIds)
      : DEFAULT_MAX_SOURCE_MEMORY_IDS,
  };
}

function assertOwner(ownerCharacterId, memoryState = {}, reflectionState = null) {
  const owner = clean(ownerCharacterId);
  if (!owner) throw fail("CHARACTER_REFLECTION_OWNER_REQUIRED", "Character reflection requires an owner.");
  for (const [field, claimedOwner] of [
    ["memoryState", memoryState?.ownerCharacterId],
    ["reflectionState", reflectionState?.ownerCharacterId],
  ]) {
    if (clean(claimedOwner) && clean(claimedOwner) !== owner) {
      throw fail("CHARACTER_REFLECTION_OWNER_MISMATCH", "Reflection state belongs to another Character.", {
        field,
        ownerCharacterId: owner,
        claimedOwnerCharacterId: clean(claimedOwner),
      });
    }
  }
  for (const record of [
    ...(memoryState?.episodes || []),
    ...(memoryState?.beliefs || []),
  ]) {
    if (clean(record?.ownerCharacterId) && clean(record.ownerCharacterId) !== owner) {
      throw fail("CHARACTER_REFLECTION_MEMORY_OWNER_MISMATCH", "Reflection cannot account another Character's memory.", {
        ownerCharacterId: owner,
        memoryId: clean(record?.id),
      });
    }
  }
  return owner;
}

function sourceMemoryRecords(memoryState = {}) {
  return [
    ...(memoryState.episodes || []),
    ...(memoryState.beliefs || []),
  ];
}

function normalizeOpportunitySourceSnapshots(source = [], ownerCharacterId = "", sourceMemoryIds = []) {
  const allowedIds = new Set(unique(sourceMemoryIds));
  const byId = new Map();
  for (const row of Array.isArray(source) ? source : []) {
    const memoryId = clean(row?.id);
    if (!memoryId || !allowedIds.has(memoryId) || byId.has(memoryId)) continue;
    const claimedOwner = clean(row?.ownerCharacterId);
    if (claimedOwner && claimedOwner !== ownerCharacterId) {
      throw fail(
        "CHARACTER_REFLECTION_MEMORY_OWNER_MISMATCH",
        "A reflection opportunity cannot retain another Character's memory snapshot.",
        { ownerCharacterId, memoryId, claimedOwnerCharacterId: claimedOwner },
      );
    }
    byId.set(memoryId, { ...clone(row), ownerCharacterId });
  }
  return unique(sourceMemoryIds).flatMap((memoryId) => (
    byId.has(memoryId) ? [byId.get(memoryId)] : []
  ));
}

function availableOpportunitySourceSnapshots(memoryState = {}, ownerCharacterId = "", sourceMemoryIds = []) {
  return normalizeOpportunitySourceSnapshots(
    sourceMemoryRecords(memoryState),
    ownerCharacterId,
    sourceMemoryIds,
  );
}

function normalizePendingOpportunity(source = null, ownerCharacterId = "", policy = {}) {
  if (!source) return null;
  const pending = clone(source);
  pending.sourceMemoryIds = unique(pending.sourceMemoryIds).slice(-policy.maxSourceMemoryIds);
  pending.sourceMemorySnapshots = normalizeOpportunitySourceSnapshots(
    pending.sourceMemorySnapshots,
    ownerCharacterId,
    pending.sourceMemoryIds,
  );
  return pending;
}

function normalizeReflectionState(input, ownerCharacterId, policy) {
  const source = input || {};
  return {
    schemaVersion: CHARACTER_REFLECTION_VERSION,
    authority: "character-private-reflection-ledger",
    ownerCharacterId,
    formulaVersion: 1,
    threshold: policy.threshold,
    accumulatedImportance: rounded(source.accumulatedImportance),
    accumulationSourceMemoryIds: unique(source.accumulationSourceMemoryIds).slice(-policy.maxSourceMemoryIds),
    // This is an idempotency high-water ledger, not a diagnostic journal. An
    // episode can leave the bounded memory window and later be reintroduced by
    // replay; forgetting its accounted importance would count it twice. Keep
    // the full map until there is an exact tombstone/epoch compaction design.
    accountedImportanceByMemoryId: Object.fromEntries(
      Object.entries(source.accountedImportanceByMemoryId || {})
        .map(([memoryId, importance]) => [clean(memoryId), clamp01(importance, 0)])
        .filter(([memoryId]) => memoryId),
    ),
    pendingOpportunity: normalizePendingOpportunity(source.pendingOpportunity, ownerCharacterId, policy),
    completedOpportunityIds: unique(source.completedOpportunityIds).slice(-64),
    completedOpportunities: clone(source.completedOpportunities || []).slice(-32),
    nextOpportunitySequence: Math.max(1, Math.floor(Number(source.nextOpportunitySequence || 1))),
    lastAdvancedAtSeconds: Math.max(0, Number(source.lastAdvancedAtSeconds || 0)),
  };
}

function hydratePendingOpportunitySourceSnapshots(state, memoryState, policy) {
  if (!state.pendingOpportunity) return;
  const sourceMemoryIds = unique(state.pendingOpportunity.sourceMemoryIds)
    .slice(-policy.maxSourceMemoryIds);
  const frozenById = new Map(normalizeOpportunitySourceSnapshots(
    state.pendingOpportunity.sourceMemorySnapshots,
    state.ownerCharacterId,
    sourceMemoryIds,
  ).map((row) => [clean(row.id), row]));
  for (const row of availableOpportunitySourceSnapshots(
    memoryState,
    state.ownerCharacterId,
    sourceMemoryIds,
  )) {
    const memoryId = clean(row.id);
    if (!frozenById.has(memoryId)) frozenById.set(memoryId, row);
  }
  state.pendingOpportunity.sourceMemoryIds = sourceMemoryIds;
  state.pendingOpportunity.sourceMemorySnapshots = sourceMemoryIds.flatMap((memoryId) => (
    frozenById.has(memoryId) ? [clone(frozenById.get(memoryId))] : []
  ));
}

function materializeOpportunity(state, nowSeconds, policy, memoryState = {}) {
  if (state.pendingOpportunity || state.accumulatedImportance < policy.threshold) return;
  const sequence = state.nextOpportunitySequence;
  state.nextOpportunitySequence += 1;
  const sourceMemoryIds = unique(state.accumulationSourceMemoryIds).slice(-policy.maxSourceMemoryIds);
  state.pendingOpportunity = {
    schemaVersion: CHARACTER_REFLECTION_VERSION,
    authority: "character-private-reflection-opportunity",
    ownerCharacterId: state.ownerCharacterId,
    opportunityId: `reflection-opportunity:${stablePart(state.ownerCharacterId)}:${sequence}`,
    sequence,
    status: "due",
    dueAtSeconds: Math.max(0, Number(nowSeconds || 0)),
    accumulatedImportance: rounded(state.accumulatedImportance),
    sourceMemoryIds,
    // A due opportunity can wait behind objective events. Freeze only this
    // bounded owner-private slice so normal durable-memory eviction cannot
    // turn an already-created thought opportunity into a fatal dangling id.
    sourceMemorySnapshots: availableOpportunitySourceSnapshots(
      memoryState,
      state.ownerCharacterId,
      sourceMemoryIds,
    ),
    decisionAuthority: "character-agent",
    selection: null,
  };
  state.accumulatedImportance = 0;
  state.accumulationSourceMemoryIds = [];
}

/**
 * Account only positive importance deltas in newly owned episodic memories.
 * The result is a private thought opportunity, never an action or world event.
 */
export function advanceCharacterReflectionOpportunity({
  ownerCharacterId = "",
  previousMemoryState = {},
  nextMemoryState = {},
  reflectionState = null,
  nowSeconds = 0,
  policy: policyInput = {},
} = {}) {
  const owner = assertOwner(ownerCharacterId, nextMemoryState, reflectionState);
  assertOwner(owner, previousMemoryState, null);
  const policy = reflectionPolicy(policyInput, reflectionState?.threshold);
  const previousMemory = normalizeCharacterAgentMemoryState(previousMemoryState, owner);
  const nextMemory = normalizeCharacterAgentMemoryState(nextMemoryState, owner);
  const state = normalizeReflectionState(reflectionState, owner, policy);
  const previousImportance = new Map((previousMemory.episodes || []).map((episode) => [
    clean(episode.id),
    clamp01(episode.importance, 0),
  ]));

  for (const episode of nextMemory.episodes || []) {
    const memoryId = clean(episode?.id);
    if (!memoryId || clean(episode?.status || "active") !== "active") continue;
    const current = clamp01(episode.importance, 0);
    const alreadyAccounted = Math.max(
      clamp01(state.accountedImportanceByMemoryId[memoryId], 0),
      clamp01(previousImportance.get(memoryId), 0),
    );
    const delta = rounded(Math.max(0, current - alreadyAccounted));
    state.accountedImportanceByMemoryId[memoryId] = Math.max(alreadyAccounted, current);
    if (delta <= 0) continue;
    state.accumulatedImportance = rounded(state.accumulatedImportance + delta);
    state.accumulationSourceMemoryIds = unique([
      ...state.accumulationSourceMemoryIds,
      memoryId,
    ]).slice(-policy.maxSourceMemoryIds);
  }

  state.lastAdvancedAtSeconds = Math.max(state.lastAdvancedAtSeconds, Number(nowSeconds || 0));
  hydratePendingOpportunitySourceSnapshots(state, nextMemory, policy);
  materializeOpportunity(state, nowSeconds, policy, nextMemory);
  return {
    schemaVersion: CHARACTER_REFLECTION_VERSION,
    ownerCharacterId: owner,
    reflectionState: clone(state),
    dueOpportunity: clone(state.pendingOpportunity),
    worldChanged: false,
  };
}

function assertNoWorldWrite(value = {}, path = "submission") {
  if (!value || typeof value !== "object") return;
  const forbidden = new Set([
    "worldPatch",
    "worldState",
    "statePatch",
    "entities",
    "worldJournal",
    "worldMutation",
    "actionAttempt",
    "utterance",
    "relationshipDelta",
    "relationshipDeltas",
  ]);
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) {
      throw fail("CHARACTER_REFLECTION_WORLD_WRITE_FORBIDDEN", "Reflection cannot write the world, public speech, or another Character's relationship state.", {
        field: `${path}.${key}`,
      });
    }
    if (child && typeof child === "object") assertNoWorldWrite(child, `${path}.${key}`);
  }
}

/**
 * Settle one due opportunity with Character-authored subjective insights.
 * Source ownership is validated here; the caller never needs to reproduce it.
 */
export function settleCharacterReflectionOpportunity({
  ownerCharacterId = "",
  memoryState = {},
  reflectionState = {},
  opportunityId = "",
  submission = {},
  nowSeconds = 0,
} = {}) {
  const owner = assertOwner(ownerCharacterId, memoryState, reflectionState);
  const policy = reflectionPolicy({}, reflectionState?.threshold);
  const state = normalizeReflectionState(reflectionState, owner, policy);
  const expectedOpportunityId = clean(state.pendingOpportunity?.opportunityId);
  if (!expectedOpportunityId || expectedOpportunityId !== clean(opportunityId)) {
    throw fail("CHARACTER_REFLECTION_OPPORTUNITY_NOT_DUE", "Reflection submission does not match the Character's due opportunity.", {
      opportunityId: clean(opportunityId),
      expectedOpportunityId,
    });
  }
  if (clean(submission?.ownerAuthority) !== "character-agent") {
    throw fail("CHARACTER_REFLECTION_AUTHORITY_INVALID", "Only the Character Agent may author private reflection insights.");
  }
  assertNoWorldWrite(submission);
  const insights = Array.isArray(submission.insights) ? submission.insights : [];
  if (insights.length > MAX_INSIGHTS_PER_OPPORTUNITY) {
    throw fail("CHARACTER_REFLECTION_INSIGHT_LIMIT_EXCEEDED", "A reflection opportunity may settle at most five insights.", {
      count: insights.length,
    });
  }

  const memory = normalizeCharacterAgentMemoryState(memoryState, owner);
  const frozenSourceMemories = normalizeOpportunitySourceSnapshots(
    state.pendingOpportunity.sourceMemorySnapshots,
    owner,
    state.pendingOpportunity.sourceMemoryIds,
  );
  const ownedMemoryIds = new Set([
    ...(memory.episodes || []).map((row) => clean(row.id)),
    ...(memory.beliefs || []).map((row) => clean(row.id)),
    ...frozenSourceMemories.map((row) => clean(row.id)),
  ].filter(Boolean));
  const opportunitySources = new Set(unique(state.pendingOpportunity.sourceMemoryIds));
  const normalizedInsights = insights.map((source, index) => {
    const proposition = clean(source?.proposition);
    if (!proposition) {
      throw fail("CHARACTER_REFLECTION_PROPOSITION_REQUIRED", "Every reflection insight requires a proposition.", { index });
    }
    const sourceMemoryIds = unique(source?.sourceMemoryIds);
    const unknownSourceMemoryIds = sourceMemoryIds.filter((memoryId) => (
      !ownedMemoryIds.has(memoryId) || !opportunitySources.has(memoryId)
    ));
    if (!sourceMemoryIds.length || unknownSourceMemoryIds.length) {
      throw fail("CHARACTER_REFLECTION_SOURCE_NOT_OWNED", "Reflection insight cites memory outside this Character's due opportunity.", {
        index,
        unknownSourceMemoryIds,
      });
    }
    const semanticFrame = normalizeSemanticFrame({
      kind: "reflection_insight",
      predicate: "reflect",
      topicId: `reflection:${index + 1}`,
      lexicalAnchors: [proposition],
      importance: clamp01(source?.importance, 0.65),
      ...clone(source?.semanticFrame || {}),
    });
    const beliefId = `belief:reflection:${stablePart(owner)}:${stablePart(expectedOpportunityId)}:${index + 1}`;
    const sourceRecords = [
      ...(memory.episodes || []),
      ...frozenSourceMemories,
    ].filter((row, index, rows) => (
      rows.findIndex((candidate) => clean(candidate?.id) === clean(row?.id)) === index
    ));
    const supportingEpisodeIds = sourceMemoryIds.filter((memoryId) => (
      sourceRecords.some((episode) => clean(episode.id) === memoryId)
    ));
    const sourceEvidenceIds = unique(sourceRecords
      .filter((episode) => supportingEpisodeIds.includes(clean(episode.id)))
      .flatMap((episode) => episode.evidenceIds || []));
    return {
      id: beliefId,
      kind: "reflection_insight",
      ownerCharacterId: owner,
      propositionKey: `reflection::${expectedOpportunityId}::${index + 1}`,
      proposition,
      currentValue: proposition,
      semanticFrame,
      confidence: clamp01(source?.confidence, 0.65),
      importance: clamp01(source?.importance, 0.65),
      status: "supported",
      reasoningMode: "inference",
      lastOperation: "reflect",
      sourceMemoryIds,
      supportingEpisodeIds,
      conflictingEpisodeIds: [],
      sourceEvidenceIds,
      sourceChains: [{
        kind: "reflection",
        ownerCharacterId: owner,
        sourceReflectionOpportunityId: expectedOpportunityId,
        sourceMemoryIds,
      }],
      sourceReflectionOpportunityId: expectedOpportunityId,
      lastUpdatedAtSeconds: Math.max(0, Number(nowSeconds || 0)),
    };
  });

  for (const insight of normalizedInsights) {
    const existingIndex = memory.beliefs.findIndex((row) => clean(row.id) === insight.id);
    if (existingIndex >= 0) memory.beliefs[existingIndex] = insight;
    else memory.beliefs.push(insight);
  }
  const settledMemory = normalizeCharacterAgentMemoryState(memory, owner);
  const completed = {
    opportunityId: expectedOpportunityId,
    sourceMemoryIds: unique(state.pendingOpportunity.sourceMemoryIds),
    insightIds: normalizedInsights.map((row) => row.id),
    insightCount: normalizedInsights.length,
    settledAtSeconds: Math.max(0, Number(nowSeconds || 0)),
  };
  state.completedOpportunityIds = unique([
    ...state.completedOpportunityIds,
    expectedOpportunityId,
  ]).slice(-64);
  state.completedOpportunities = [...state.completedOpportunities, completed].slice(-32);
  state.pendingOpportunity = null;
  state.lastAdvancedAtSeconds = Math.max(state.lastAdvancedAtSeconds, completed.settledAtSeconds);
  materializeOpportunity(state, nowSeconds, policy, settledMemory);

  return {
    schemaVersion: CHARACTER_REFLECTION_VERSION,
    ownerCharacterId: owner,
    memoryState: settledMemory,
    reflectionState: clone(state),
    settlement: {
      authority: "character-private-reflection-settlement",
      ...clone(completed),
      worldChanged: false,
      actionAttempt: null,
    },
  };
}
