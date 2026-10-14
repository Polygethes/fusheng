import { initialState, createCharacterFromConcept, createId } from "../data/seed.js";
import { ensureCharacterPlans, createDefaultPlan, buildIntentPlan } from "./intentPlanner.js";
import { buildPlayableWorldFromSetup } from "../worldbuilding/skills.js";
import { buildRelationshipArcFromShift } from "./relationshipArc.js";
import {
  LEGACY_TAVERN_RELATIONSHIP_EDGE_ORDER,
  LEGACY_TAVERN_RELATIONSHIP_VECTORS,
  TAVERN_RELATIONSHIP_VECTOR_FIELDS,
  buildCalibratedTavernRelationships,
  matchesLegacyTavernRelationshipSeed,
} from "../server/ecology/tavernRelationshipSeeds.mjs";
import { mergeObjectTemplates } from "../server/simulation/objectLedger.mjs";
import {
  CHARACTER_AGENT_MEMORY_SCHEMA_VERSION,
  createCharacterAgentMemoryState,
  migrateLegacyCharacterMemories,
  normalizeCharacterAgentMemoryState,
} from "../engine/characterAgentMemory.js";

const STORAGE_KEY = "character-town-observer-state-v12";
const SETUP_FLOW_VERSION = 2;
const V27_RUNTIME_ID = "tavern-v27";
const RUNTIME_SESSION_OPERATIONS = new Set(["start", "continue", "reset"]);
const listeners = new Set();

function deepClone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function storageGet(key) {
  if (typeof localStorage === "undefined" || typeof localStorage.getItem !== "function") return null;
  return localStorage.getItem(key);
}

function storageSet(key, value) {
  if (typeof localStorage === "undefined" || typeof localStorage.setItem !== "function") return;
  localStorage.setItem(key, value);
}

function cleanRuntimeText(value = "") {
  return String(value ?? "").trim();
}

function createRuntimeInstanceId() {
  return createId("runtime-instance");
}

function projectRuntimeInstanceId(project = {}) {
  return cleanRuntimeText(project.runtimeInstanceId || project.runtimeNamespace);
}

function withRuntimeInstance(project = {}, runtimeInstanceId = "") {
  const id = cleanRuntimeText(runtimeInstanceId) || createRuntimeInstanceId();
  const { runtimeNamespace: _legacyRuntimeNamespace, ...rest } = project || {};
  return {
    ...rest,
    runtimeInstanceId: id,
  };
}

function loadInitialState() {
  const raw = storageGet(STORAGE_KEY);
  if (!raw) {
    // An untouched first render owns no server session yet, so it does not need
    // an eager full-world localStorage write. The first durable UI/world/session
    // mutation persists this generated incarnation through emit().
    return migrateState(deepClone(initialState), { dropRuntimeTransport: true });
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.worldSetup?.schemaVersion) {
      const migrated = migrateState(deepClone(initialState), { dropRuntimeTransport: true });
      storageSet(STORAGE_KEY, JSON.stringify(buildLocalPersistenceState(migrated)));
      return migrated;
    }
    const hadRuntimeInstance = Boolean(projectRuntimeInstanceId(parsed.project));
    const migrated = migrateState(parsed, { dropRuntimeTransport: !hadRuntimeInstance });
    if (!hadRuntimeInstance) storageSet(STORAGE_KEY, JSON.stringify(buildLocalPersistenceState(migrated)));
    return migrated;
  } catch (error) {
    console.warn("Failed to parse stored state. Resetting.", error);
    const migrated = migrateState(deepClone(initialState), { dropRuntimeTransport: true });
    try {
      storageSet(STORAGE_KEY, JSON.stringify(buildLocalPersistenceState(migrated)));
    } catch {
      // Preserve the existing reset behavior if browser storage is unavailable.
    }
    return migrated;
  }
}

function ensureBranch(candidate, next) {
  const branches = Array.isArray(candidate.branches) && candidate.branches.length ? candidate.branches : next.branches;
  const activeBranchId = candidate.ui?.activeBranchId || candidate.project?.activeBranchId || branches[0]?.id || "branch_main";
  return { branches, activeBranchId };
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function normalizePendingRuntimeCommand(input, { strict = false } = {}) {
  if (input == null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    if (strict) throw new Error("待决运行命令必须是对象。");
    return null;
  }
  const commandId = cleanRuntimeText(input.commandId);
  const operation = cleanRuntimeText(input.operation);
  const expectedRevision = Number(input.expectedRevision);
  const timestamp = cleanRuntimeText(input.timestamp) || new Date().toISOString();
  if (!commandId || !RUNTIME_SESSION_OPERATIONS.has(operation)
    || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
    if (strict) throw new Error("待决运行命令需要 commandId、有效 operation 与非负 expectedRevision。");
    return null;
  }
  return { commandId, operation, expectedRevision, timestamp };
}

function normalizeRuntimeSessionRow(input = {}, defaults = {}, { strict = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const runtimeId = cleanRuntimeText(input.runtimeId || defaults.runtimeId);
  const projectId = cleanRuntimeText(input.projectId || defaults.projectId);
  const branchId = cleanRuntimeText(input.branchId || defaults.branchId);
  const runtimeInstanceId = cleanRuntimeText(input.runtimeInstanceId || defaults.runtimeInstanceId);
  const sessionId = cleanRuntimeText(input.sessionId);
  const pendingCommand = normalizePendingRuntimeCommand(input.pendingCommand, { strict });
  if (!runtimeId || !projectId || !branchId || !runtimeInstanceId || (!sessionId && !pendingCommand)) {
    if (strict) throw new Error("运行会话引用需要 runtimeId、运行实例，以及 sessionId 或待决命令。");
    return null;
  }
  const hasSessionRevision = Object.hasOwn(input, "sessionRevision");
  const hasWorldVersion = Object.hasOwn(input, "worldVersion");
  const sessionRevision = hasSessionRevision ? Number(input.sessionRevision) : Number(defaults.sessionRevision || 0);
  const worldVersion = hasWorldVersion ? Number(input.worldVersion) : Number(defaults.worldVersion || 0);
  if ((!Number.isInteger(sessionRevision) || sessionRevision < 0)
    || (!Number.isInteger(worldVersion) || worldVersion < 0)) {
    if (strict) throw new Error("运行会话 revision 与世界版本必须是非负整数。");
    return null;
  }
  return {
    runtimeId,
    projectId,
    branchId,
    runtimeInstanceId,
    sessionId,
    sessionRevision,
    worldVersion,
    pendingCommand,
    updatedAt: cleanRuntimeText(input.updatedAt) || new Date().toISOString(),
  };
}

function publicProviderBudget(input = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return {
    maxProviderRequests: nonNegativeInteger(input.maxProviderRequests),
    usedProviderRequests: nonNegativeInteger(input.usedProviderRequests),
    remainingProviderRequests: nonNegativeInteger(input.remainingProviderRequests),
  };
}

function publicObservationSessionRef(input = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const sessionId = cleanRuntimeText(input.sessionId);
  if (!sessionId) return null;
  return {
    runtimeId: cleanRuntimeText(input.runtimeId),
    projectId: cleanRuntimeText(input.projectId),
    branchId: cleanRuntimeText(input.branchId),
    sessionId,
    sessionRevision: nonNegativeInteger(input.sessionRevision),
    worldVersion: nonNegativeInteger(input.worldVersion),
  };
}

const PUBLIC_RUNTIME_SCENE_EFFECT_TEXT_FIELDS = Object.freeze([
  "kind",
  "actorId",
  "sourceCharacterId",
  "targetCharacterId",
  "recipientCharacterId",
  "targetId",
  "targetKind",
  "objectId",
  "sourceObjectId",
  "positionId",
  "placeId",
  "zoneId",
  "fromZoneId",
  "toZoneId",
  "destinationId",
  "holderCharacterId",
  "operation",
  "visibleAction",
  "utterance",
  "vocalMode",
  "signalId",
  "processId",
  "activityId",
  "capability",
  "offeringId",
  "offeringLabel",
  "workTemplateId",
  "workLabel",
  "stationZoneId",
  "status",
  "reason",
  "eventKind",
  "modality",
]);

const PUBLIC_RUNTIME_SCENE_EFFECT_NUMBER_FIELDS = Object.freeze([
  "durationSeconds",
  "progress",
  "remainingSeconds",
  "remainingUnits",
  "quantity",
  "soundDistance",
]);

const PUBLIC_RUNTIME_SCENE_EFFECT_BOOLEAN_FIELDS = Object.freeze([
  "directed",
  "overheard",
  "completed",
  "active",
]);

const PUBLIC_RUNTIME_SCENE_EFFECT_ID_ARRAY_FIELDS = Object.freeze([
  "participantIds",
  "objectIds",
  "occupantCharacterIds",
]);

// Restoring committed turns reads the effect field lists above. Initialize
// them before migration, or a valid persisted world falls back to seed state.
let state = loadInitialState();

function publicRuntimeSceneEffect(input = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const kind = cleanRuntimeText(input.kind);
  if (!kind) return null;
  const output = { kind };
  for (const field of PUBLIC_RUNTIME_SCENE_EFFECT_TEXT_FIELDS) {
    if (field === "kind" || !Object.hasOwn(input, field)) continue;
    const value = cleanRuntimeText(input[field]);
    if (value) output[field] = value;
  }
  for (const field of PUBLIC_RUNTIME_SCENE_EFFECT_NUMBER_FIELDS) {
    if (!Object.hasOwn(input, field)) continue;
    const value = Number(input[field]);
    if (Number.isFinite(value)) output[field] = value;
  }
  for (const field of PUBLIC_RUNTIME_SCENE_EFFECT_BOOLEAN_FIELDS) {
    if (typeof input[field] === "boolean") output[field] = input[field];
  }
  for (const field of PUBLIC_RUNTIME_SCENE_EFFECT_ID_ARRAY_FIELDS) {
    if (!Array.isArray(input[field])) continue;
    output[field] = input[field].map(cleanRuntimeText).filter(Boolean);
  }
  return output;
}

function publicRuntimeSceneEffects(input = []) {
  return (Array.isArray(input) ? input : [])
    .map(publicRuntimeSceneEffect)
    .filter(Boolean);
}

function publicRuntimeOutcome(input = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      status: "quiet",
      label: "",
      detail: "",
      primitive: "",
      worldVersion: 0,
      durationSeconds: 0,
      resolvedEffects: [],
      committedFacts: [],
    };
  }
  const worldVersion = Number(input.worldVersion);
  const durationSeconds = Number(input.durationSeconds);
  return {
    status: cleanRuntimeText(input.status),
    label: cleanRuntimeText(input.label),
    detail: cleanRuntimeText(input.detail),
    primitive: cleanRuntimeText(input.primitive),
    worldVersion: Number.isFinite(worldVersion) && worldVersion >= 0 ? worldVersion : 0,
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds >= 0 ? durationSeconds : 0,
    resolvedEffects: publicRuntimeSceneEffects(input.resolvedEffects),
    committedFacts: publicRuntimeSceneEffects(input.committedFacts),
  };
}

function publicRuntimeCharacter(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const characterId = cleanRuntimeText(input.characterId || input.id);
  if (!characterId) return null;
  return {
    characterId,
    name: cleanRuntimeText(input.name),
    present: input.present !== false,
    placeId: cleanRuntimeText(input.placeId),
    zoneId: cleanRuntimeText(input.zoneId),
    positionId: cleanRuntimeText(input.positionId),
    orientationTargetId: cleanRuntimeText(input.orientationTargetId),
    listeningTargetId: cleanRuntimeText(input.listeningTargetId),
    listeningTargetKind: cleanRuntimeText(input.listeningTargetKind),
  };
}

function publicRuntimeObject(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const id = cleanRuntimeText(input.id || input.objectId);
  if (!id) return null;
  return {
    id,
    kind: cleanRuntimeText(input.kind),
    label: cleanRuntimeText(input.label),
    placeId: cleanRuntimeText(input.placeId),
    zoneId: cleanRuntimeText(input.zoneId),
    holderCharacterId: cleanRuntimeText(input.holderCharacterId),
    occupantCharacterIds: (Array.isArray(input.occupantCharacterIds) ? input.occupantCharacterIds : [])
      .map(cleanRuntimeText)
      .filter(Boolean),
  };
}

function publicRuntimeTurn(input = {}, index = 0) {
  const legacyFiveStageCompleted = input.fiveStageCompleted === true
    || input.fiveStageAgentCompleted === true;
  const submissionMode = cleanRuntimeText(
    input.submissionMode || (legacyFiveStageCompleted ? "staged" : ""),
  );
  const characterAgentCompleted = input.characterAgentCompleted === true
    || (submissionMode === "staged" && legacyFiveStageCompleted);
  return {
    index: nonNegativeInteger(input.index, index + 1),
    characterId: cleanRuntimeText(input.characterId),
    characterName: cleanRuntimeText(input.characterName),
    agentTurnId: cleanRuntimeText(input.agentTurnId),
    wakeKind: cleanRuntimeText(input.wakeKind),
    submissionMode,
    characterAgentCompleted,
    acceptedStageCount: nonNegativeInteger(input.acceptedStageCount),
    expectedAcceptedStageCount: nonNegativeInteger(input.expectedAcceptedStageCount),
    // Historical records may still identify a completed staged turn with this
    // field. Atomic completion must never be rewritten as five-stage success.
    fiveStageCompleted: submissionMode === "staged" && legacyFiveStageCompleted,
    protocolRepairCount: nonNegativeInteger(input.protocolRepairCount),
    actionType: cleanRuntimeText(input.actionType),
    targetCharacterId: cleanRuntimeText(input.targetCharacterId),
    speech: cleanRuntimeText(input.speech),
    visibleAction: cleanRuntimeText(input.visibleAction),
    affectiveTexture: (Array.isArray(input.affectiveTexture) ? input.affectiveTexture : [])
      .map(cleanRuntimeText)
      .filter(Boolean)
      .slice(0, 16),
    outcome: publicRuntimeOutcome(input.outcome),
  };
}

function publicRuntimeObservation(input = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return {
    mode: cleanRuntimeText(input.mode),
    model: cleanRuntimeText(input.model),
    externalModelCalled: input.externalModelCalled === true,
    authorQualityVerdict: cleanRuntimeText(input.authorQualityVerdict),
    explanation: cleanRuntimeText(input.explanation),
    worldVersion: nonNegativeInteger(input.worldVersion),
    nowSeconds: nonNegativeInteger(input.nowSeconds),
    eventCount: nonNegativeInteger(input.eventCount),
    schemaVersion: cleanRuntimeText(input.schemaVersion),
    stageInvocations: nonNegativeInteger(input.stageInvocations),
    providerRequestBudget: publicProviderBudget(input.providerRequestBudget),
    sessionRef: publicObservationSessionRef(input.sessionRef),
    readyQueue: (Array.isArray(input.readyQueue) ? input.readyQueue : [])
      .map(cleanRuntimeText)
      .filter(Boolean),
    characters: (Array.isArray(input.characters) ? input.characters : [])
      .map(publicRuntimeCharacter)
      .filter(Boolean),
    objects: (Array.isArray(input.objects) ? input.objects : [])
      .map(publicRuntimeObject)
      .filter(Boolean),
    turns: (Array.isArray(input.turns) ? input.turns : [])
      .slice(-80)
      .map((turn, index) => publicRuntimeTurn(turn, index)),
    completedAt: cleanRuntimeText(input.completedAt),
  };
}

function normalizeRuntimeObservationRow(input = {}, defaults = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const runtimeId = cleanRuntimeText(input.runtimeId || defaults.runtimeId);
  const projectId = cleanRuntimeText(input.projectId || defaults.projectId);
  const branchId = cleanRuntimeText(input.branchId || defaults.branchId);
  const runtimeInstanceId = cleanRuntimeText(input.runtimeInstanceId || defaults.runtimeInstanceId);
  const observation = publicRuntimeObservation(input.observation ?? input.value ?? null);
  if (!runtimeId || !projectId || !branchId || !runtimeInstanceId || !observation) return null;
  return {
    runtimeId,
    projectId,
    branchId,
    runtimeInstanceId,
    observation,
    updatedAt: cleanRuntimeText(input.updatedAt) || new Date().toISOString(),
  };
}

function runtimeCoordinates(source = state) {
  return {
    projectId: cleanRuntimeText(source.project?.id),
    branchId: cleanRuntimeText(source.ui?.activeBranchId || source.project?.activeBranchId || "branch_main"),
    runtimeInstanceId: projectRuntimeInstanceId(source.project),
  };
}

function isV27RuntimeId(runtimeId = "") {
  const id = cleanRuntimeText(runtimeId);
  return id === V27_RUNTIME_ID || id.startsWith(`${V27_RUNTIME_ID}:`);
}

function v27ObservationFromRows(rows = [], runtimeInstanceId = "") {
  const exactRuntimeId = runtimeInstanceId ? `${V27_RUNTIME_ID}:${runtimeInstanceId}` : "";
  const exact = exactRuntimeId
    ? (rows || []).find((row) => row.runtimeId === exactRuntimeId)
    : null;
  const fallback = (rows || []).find((row) => isV27RuntimeId(row.runtimeId));
  return deepClone((exact || fallback)?.observation || null);
}

function emptyRuntimeClientState() {
  return { schemaVersion: 1, sessions: [], observations: [] };
}

function normalizeBranchRuntimeClientState(source = {}, coordinates = {}, { preserve = true } = {}) {
  if (!preserve) return emptyRuntimeClientState();
  const legacySnapshot = source.snapshot && typeof source.snapshot === "object" ? source.snapshot : {};
  const sourceState = source.runtimeClientState && typeof source.runtimeClientState === "object"
    ? source.runtimeClientState
    : {};
  const sessions = (Array.isArray(sourceState.sessions) ? sourceState.sessions
    : Array.isArray(source.runtimeSessions) ? source.runtimeSessions
      : Array.isArray(legacySnapshot.runtimeSessions) ? legacySnapshot.runtimeSessions : [])
    .map((row) => normalizeRuntimeSessionRow(row, coordinates))
    .filter((row) => row
      && row.projectId === coordinates.projectId
      && row.branchId === coordinates.branchId
      && row.runtimeInstanceId === coordinates.runtimeInstanceId);
  const observations = (Array.isArray(sourceState.observations) ? sourceState.observations
    : Array.isArray(source.runtimeObservations) ? source.runtimeObservations
      : Array.isArray(legacySnapshot.runtimeObservations) ? legacySnapshot.runtimeObservations : [])
    .map((row) => normalizeRuntimeObservationRow(row, coordinates))
    .filter((row) => row
      && row.projectId === coordinates.projectId
      && row.branchId === coordinates.branchId
      && row.runtimeInstanceId === coordinates.runtimeInstanceId);
  return { schemaVersion: 1, sessions, observations };
}

function compactTavernSceneRuntimeForSnapshot(runtime = null) {
  if (!runtime || typeof runtime !== "object") return null;
  return deepClone({
    id: runtime.id || "",
    schemaVersion: Number(runtime.schemaVersion || 1),
    locationId: runtime.locationId || "loc_xyy_tavern",
    macroDay: Number(runtime.macroDay || 0),
    macroTick: Number(runtime.macroTick || 0),
    elapsedSeconds: Number(runtime.elapsedSeconds || 0),
    step: Number(runtime.step || 0),
    activeCharacterIds: [...(runtime.activeCharacterIds || [])],
    agents: Object.fromEntries(Object.entries(runtime.agents || {}).map(([id, agent]) => [id, {
      characterId: agent.characterId || id,
      characterName: agent.characterName || id,
      role: agent.role || "",
      standing: agent.standing || "",
      zoneId: agent.zoneId || "hall",
      zoneProvenance: deepClone(agent.zoneProvenance || null),
      present: Boolean(agent.present),
      currentIntention: agent.currentIntention || "",
      attentionTargetId: agent.attentionTargetId || "",
      currentVisibleActivity: agent.currentVisibleActivity || "",
      perceptionMemory: (agent.perceptionMemory || []).slice(-10).map((delivery) => ({
        impactId: delivery.impactId || "",
        sourceCharacterId: delivery.sourceCharacterId || "",
        type: delivery.type || "",
        modality: delivery.modality || "",
        content: delivery.content || "",
        topic: delivery.topic || "",
        directed: Boolean(delivery.directed),
        provenance: deepClone(delivery.provenance || {}),
      })),
    }])),
    commitments: (runtime.commitments || []).slice(-16),
    requestLocks: (runtime.requestLocks || []).slice(-16).map((lock) => ({
      id: lock.id || "",
      threadId: lock.threadId || "",
      requesterId: lock.requesterId || "",
      responderId: lock.responderId || "",
      sourceActionId: lock.sourceActionId || "",
      sourceImpactId: lock.sourceImpactId || "",
      latestActionId: lock.latestActionId || lock.sourceActionId || "",
      topic: lock.topic || "",
      status: lock.status || "awaiting",
      openedAtStep: Number(lock.openedAtStep || 0),
      attempts: Number(lock.attempts || 0),
      maxAttempts: Number(lock.maxAttempts || 2),
      resolvedByActionId: lock.resolvedByActionId || "",
      resolution: lock.resolution || "",
    })),
    lastActorId: runtime.lastActorId || "",
  });
}

function compactTavernStateForSnapshot(tavernState = null) {
  if (!tavernState || typeof tavernState !== "object") return null;
  return {
    ...deepClone(tavernState),
    ...(tavernState.sceneRuntime ? { sceneRuntime: compactTavernSceneRuntimeForSnapshot(tavernState.sceneRuntime) } : {}),
  };
}

function getBranchSnapshot(source) {
  return {
    characters: deepClone(Array.isArray(source.characters) ? source.characters : []),
    relationships: deepClone(Array.isArray(source.relationships) ? source.relationships : []),
    canonEvents: compactCanonEventsForSnapshot(Array.isArray(source.canonEvents) ? source.canonEvents : []),
    draftScenes: compactDraftScenesForSnapshot(Array.isArray(source.draftScenes) ? source.draftScenes : []),
    rumors: deepClone(Array.isArray(source.rumors) ? source.rumors : []),
    evidence: deepClone(Array.isArray(source.evidence) ? source.evidence : []),
    secrets: deepClone(Array.isArray(source.secrets) ? source.secrets : []),
    characterMemories: deepClone(Array.isArray(source.characterMemories) ? source.characterMemories : []),
    characterPlans: deepClone(Array.isArray(source.characterPlans) ? source.characterPlans : []),
    townStateLedger: deepClone(Array.isArray(source.townStateLedger) ? source.townStateLedger : []),
    interventions: deepClone(Array.isArray(source.interventions) ? source.interventions : []),
    stateChangeReasons: deepClone(Array.isArray(source.stateChangeReasons) ? source.stateChangeReasons : []),
    replayMarkers: deepClone(Array.isArray(source.replayMarkers) ? source.replayMarkers : []),
    irreversibleTraces: deepClone(Array.isArray(source.irreversibleTraces) ? source.irreversibleTraces : []),
    storyRevisions: deepClone(Array.isArray(source.storyRevisions) ? source.storyRevisions : []),
    tavernState: compactTavernStateForSnapshot(source.tavernState),
  };
}

function getCanonSnapshot(source) {
  const snapshot = getBranchSnapshot(source);
  delete snapshot.runtimeSessions;
  delete snapshot.runtimeObservations;
  return snapshot;
}

function withoutRuntimeTransport(snapshot = {}) {
  const cleanSnapshot = deepClone(snapshot || {});
  delete cleanSnapshot.runtimeSessions;
  delete cleanSnapshot.runtimeObservations;
  return cleanSnapshot;
}

function compactCanonEventsForSnapshot(events = []) {
  return (events || []).map((event) => compactCanonEventForSnapshot(event));
}

function compactCanonEventForSnapshot(event = {}) {
  const {
    preAcceptSnapshot,
    postAcceptSnapshot,
    snapshotBefore,
    snapshotAfter,
    replay,
    ...rest
  } = event || {};
  return deepClone({
    ...rest,
    replay: replay ? {
      provider: replay.provider || "",
      surfaceEvent: replay.surfaceEvent || "",
      sceneText: replay.sceneText || "",
      agentOutputs: compactAgentOutputsForSnapshot(replay.agentOutputs || []),
      pipelineMeta: replay.pipelineMeta ? {
        mode: replay.pipelineMeta.mode || "",
        pipelineMode: replay.pipelineMeta.pipelineMode || "",
        provider: replay.pipelineMeta.provider || "",
        model: replay.pipelineMeta.model || "",
        pipeline: replay.pipelineMeta.pipeline || "",
      } : null,
      interventionsApplied: (replay.interventionsApplied || []).slice(-12),
      stateChangeReasons: (replay.stateChangeReasons || []).slice(-24),
    } : null,
  });
}

function compactDraftScenesForSnapshot(drafts = [], { limit = Number.POSITIVE_INFINITY, observerLimit = 175 } = {}) {
  return (drafts || []).slice(0, limit).map((draft) => compactDraftSceneForSnapshot(draft, observerLimit));
}

function compactAgentOutputsForSnapshot(outputs = []) {
  return (outputs || []).map((output) => ({
    outputId: output.outputId || "",
    characterId: output.characterId || "",
    targetCharacterId: output.targetCharacterId || "",
    interactionRole: output.interactionRole || "",
    visibleAction: output.visibleAction || "",
    interactionInput: output.interactionInput ? {
      sourceCharacterId: output.interactionInput.sourceCharacterId || "",
      sourceOutputId: output.interactionInput.sourceOutputId || "",
      sharedObject: output.interactionInput.sharedObject || "",
    } : null,
  }));
}

function compactPrivateSimulationsForSnapshot(simulations = []) {
  return (simulations || []).map((simulation) => ({
    id: simulation.id || simulation.simulationId || "",
    simulationId: simulation.simulationId || simulation.id || "",
    characterId: simulation.characterId || "",
    characterName: simulation.characterName || "",
    targetCharacterId: simulation.targetCharacterId || "",
    publicGoal: simulation.publicGoal || "",
    privateDesire: simulation.privateDesire || "",
    defensiveMask: simulation.defensiveMask || "",
    shadowImpulse: simulation.shadowImpulse || "",
    nobleImpulse: simulation.nobleImpulse || "",
    selfLie: simulation.selfLie || "",
    whatTheyWantFromOthers: simulation.whatTheyWantFromOthers || simulation.wantsFromOthers || "",
    whatTheyRefuseToAdmit: simulation.whatTheyRefuseToAdmit || "",
    riskTheyWillCreate: simulation.riskTheyWillCreate || "",
    mistakenBelief: simulation.mistakenBelief || simulation.currentMisreading || "",
    tone: simulation.tone || "",
    contradictionScore: Number(simulation.contradictionScore || 0),
  }));
}

function compactAgentParticipationForSnapshot(trace = {}) {
  if (!trace || typeof trace !== "object") return null;
  return {
    day: Number(trace.day || 0),
    slotId: trace.slotId || "",
    slotLabel: trace.slotLabel || "",
    presentCharacterIds: [...(trace.presentCharacterIds || [])],
    presentCharacterNames: [...(trace.presentCharacterNames || [])],
    activatedAgentIds: [...(trace.activatedAgentIds || [])],
    activatedAgentNames: [...(trace.activatedAgentNames || [])],
    completedAgentIds: [...(trace.completedAgentIds || [])],
    failedAgentIds: [...(trace.failedAgentIds || [])],
    failedAgentNames: [...(trace.failedAgentNames || [])],
    ruleOnlyCharacterIds: [...(trace.ruleOnlyCharacterIds || [])],
    ruleOnlyCharacterNames: [...(trace.ruleOnlyCharacterNames || [])],
    witness: {
      scheduled: Boolean(trace.witness?.scheduled),
      ran: Boolean(trace.witness?.ran),
      provider: trace.witness?.provider || "",
      stage: trace.witness?.stage || "",
      degraded: Boolean(trace.witness?.degraded),
    },
  };
}

function compactSceneInteractionForSnapshot(sceneInteraction = null) {
  if (!sceneInteraction) return null;
  return {
    agentExchanges: (sceneInteraction.agentExchanges || []).map((exchange) => ({
      sourceOutputId: exchange.sourceOutputId || "",
      responseOutputId: exchange.responseOutputId || "",
      sourceCharacterId: exchange.sourceCharacterId || "",
      sourceCharacterName: exchange.sourceCharacterName || "",
      responseCharacterId: exchange.responseCharacterId || "",
      responseCharacterName: exchange.responseCharacterName || "",
      sharedObject: exchange.sharedObject || "",
      generatedFrom: exchange.generatedFrom || "",
      dialogueTurns: (exchange.dialogueTurns || []).map((turn) => ({
        turnId: turn.turnId || "",
        day: Number(turn.day || 0),
        slotId: turn.slotId || "",
        slotLabel: turn.slotLabel || "",
        speakerId: turn.speakerId || "",
        speakerName: turn.speakerName || "",
        targetId: turn.targetId || "",
        targetName: turn.targetName || "",
        line: turn.line || turn.text || "",
        turnRole: turn.turnRole || "",
        respondsTo: turn.respondsTo || "",
        responseSourceLine: turn.responseSourceLine || "",
        responseSourceSpeakerId: turn.responseSourceSpeakerId || "",
        responseSourceSlotId: turn.responseSourceSlotId || "",
        responseSourceSlotLabel: turn.responseSourceSlotLabel || "",
        responseThreadId: turn.responseThreadId || "",
        responseTopic: turn.responseTopic || "",
        interactionKind: turn.interactionKind || "",
        visitId: turn.visitId || "",
        triggeredBy: turn.triggeredBy || "",
        sourceImpactId: turn.sourceImpactId || "",
        generatedBy: turn.generatedBy || "",
      })),
      eventOutcome: exchange.eventOutcome || "",
    })),
  };
}

function compactCausalSceneForSnapshot(causalScene = null) {
  if (!causalScene || typeof causalScene !== "object") return null;
  return deepClone({
    schemaVersion: Number(causalScene.schemaVersion || 1),
    elapsedSeconds: Number(causalScene.elapsedSeconds || 0),
    stopReason: causalScene.stopReason || "",
    macroTimeAdvanced: Boolean(causalScene.macroTimeAdvanced),
    slotId: causalScene.slotId || "",
    slotLabel: causalScene.slotLabel || "",
    day: Number(causalScene.day || 0),
    unresolvedRequests: deepClone(causalScene.unresolvedRequests || []),
    actions: (causalScene.actions || []).slice(-48).map((action) => {
      const copy = { ...action };
      delete copy.privateReason;
      return copy;
    }),
    impacts: (causalScene.impacts || []).slice(-96),
    deliveries: (causalScene.deliveries || []).slice(-180),
    activations: (causalScene.activations || []).slice(-64),
    sceneRuntime: causalScene.sceneRuntime ? {
      id: causalScene.sceneRuntime.id || "",
      locationId: causalScene.sceneRuntime.locationId || "",
      macroDay: Number(causalScene.sceneRuntime.macroDay || 0),
      macroTick: Number(causalScene.sceneRuntime.macroTick || 0),
      elapsedSeconds: Number(causalScene.sceneRuntime.elapsedSeconds || 0),
      activeCharacterIds: [...(causalScene.sceneRuntime.activeCharacterIds || [])],
      agents: Object.fromEntries(Object.entries(causalScene.sceneRuntime.agents || {}).map(([id, agent]) => [id, {
        characterId: agent.characterId || id,
        characterName: agent.characterName || id,
        zoneId: agent.zoneId || "",
        zoneProvenance: deepClone(agent.zoneProvenance || null),
        present: Boolean(agent.present),
        currentVisibleActivity: agent.currentVisibleActivity || "",
      }])),
      commitments: (causalScene.sceneRuntime.commitments || []).slice(-16),
      requestLocks: (causalScene.sceneRuntime.requestLocks || []).slice(-16),
    } : null,
  });
}

function compactCausalTickTraceForSnapshot(causalScene = null) {
  if (!causalScene || typeof causalScene !== "object") return null;
  return deepClone({
    schemaVersion: Number(causalScene.schemaVersion || 1),
    elapsedSeconds: Number(causalScene.elapsedSeconds || 0),
    stopReason: causalScene.stopReason || "",
    macroTimeAdvanced: Boolean(causalScene.macroTimeAdvanced),
    slotId: causalScene.slotId || "",
    slotLabel: causalScene.slotLabel || "",
    day: Number(causalScene.day || 0),
    unresolvedRequests: deepClone(causalScene.unresolvedRequests || []),
    actions: (causalScene.actions || []).slice(-8).map((action) => {
      const copy = { ...action };
      delete copy.privateReason;
      delete copy.deliveries;
      return copy;
    }),
    activations: (causalScene.activations || []).slice(-10),
  });
}

function compactDialoguePsychologyForSnapshot(reactions = []) {
  return (reactions || []).slice(-24).map((reaction) => ({
    characterId: reaction.characterId || "",
    characterName: reaction.characterName || "",
    heardLine: reaction.heardLine || "",
    speakerName: reaction.speakerName || "",
    interpretation: reaction.interpretation || "",
    feeling: reaction.feeling || "",
    bodyResponse: reaction.bodyResponse || "",
    privateThought: reaction.privateThought || "",
    selfLie: reaction.selfLie || "",
    nextImpulse: reaction.nextImpulse || "",
  }));
}

function compactObserverPsychologyForSnapshot(entries = [], limit = 175) {
  return (entries || []).slice(-limit).map((entry) => {
    const selectedCandidateId = entry.factorTrace?.selectedCandidateId || entry.selectedIntent?.selectedCandidateId || "";
    const rankedCandidates = [...(entry.factorTrace?.candidates || [])].sort((left, right) => (
      Number(right.activationScore || 0) - Number(left.activationScore || 0)
    ));
    const selectedCandidate = rankedCandidates.find((candidate) => candidate.candidateId === selectedCandidateId) || null;
    const factorCandidates = [
      ...(selectedCandidate ? [selectedCandidate] : []),
      ...rankedCandidates.filter((candidate) => candidate !== selectedCandidate),
    ].slice(0, 3).map((candidate) => ({
      candidateId: candidate.candidateId || "",
      label: candidate.label || "",
      feasible: Boolean(candidate.feasible),
      activationScore: Number(candidate.activationScore || 0),
      blockedBy: [...(candidate.blockedBy || [])].slice(0, 4),
      positiveFactors: (candidate.positiveFactors || []).slice(0, candidate.candidateId === selectedCandidateId ? 4 : 0).map((factor) => ({
        label: factor.label || "",
        contribution: Number(factor.contribution || 0),
      })),
      negativeFactors: (candidate.negativeFactors || []).slice(0, candidate.candidateId === selectedCandidateId ? 4 : 0).map((factor) => ({
        label: factor.label || "",
        contribution: Number(factor.contribution || 0),
      })),
    }));
    return ({
    schemaVersion: 1,
    visibility: "observer-only",
    source: "causal-character-agent-decision",
    actionId: entry.actionId || "",
    characterId: entry.characterId || "",
    characterName: entry.characterName || "",
    desire: entry.desire || "",
    currentIntention: entry.currentIntention || "",
    privateReason: entry.privateReason || "",
    formulaReason: entry.formulaReason || "",
    selectedIntent: entry.selectedIntent ? {
      selectedCandidateId: entry.selectedIntent.selectedCandidateId || "",
      label: entry.selectedIntent.label || "",
      actionKind: entry.selectedIntent.actionKind || "",
      targetCharacterId: entry.selectedIntent.targetCharacterId || "",
      activationScore: Number(entry.selectedIntent.activationScore || 0),
    } : null,
    relationshipAppraisal: entry.relationshipAppraisal ? {
      relationshipId: entry.relationshipAppraisal.relationshipId || "",
      fromCharacterId: entry.relationshipAppraisal.fromCharacterId || "",
      toCharacterId: entry.relationshipAppraisal.toCharacterId || "",
      closeness: Number(entry.relationshipAppraisal.closeness || 0),
      tension: Number(entry.relationshipAppraisal.tension || 0),
      trust: Number(entry.relationshipAppraisal.trust || 0),
    } : null,
    copingBias: entry.copingBias ? {
      approach: Number(entry.copingBias.approach || 0),
      avoid: Number(entry.copingBias.avoid || 0),
      assert: Number(entry.copingBias.assert || 0),
      inhibit: Number(entry.copingBias.inhibit || 0),
      repair: Number(entry.copingBias.repair || 0),
      repairNeed: Number(entry.copingBias.repairNeed || 0),
      dominant: entry.copingBias.dominant || "",
    } : null,
    expressionStrategy: entry.expressionStrategy ? {
      mode: entry.expressionStrategy.mode || "",
      directness: entry.expressionStrategy.directness || "",
      warmth: entry.expressionStrategy.warmth || "",
      motive: entry.expressionStrategy.motive || "",
    } : null,
    eventAppraisal: entry.eventAppraisal?.applied ? {
      applied: true,
      impactId: entry.eventAppraisal.impactId || "",
      cueIds: [...(entry.eventAppraisal.cueIds || [])].slice(0, 8),
      affect: entry.eventAppraisal.affect ? {
        before: deepClone(entry.eventAppraisal.affect.before || {}),
        after: deepClone(entry.eventAppraisal.affect.after || {}),
      } : null,
      copingBias: entry.eventAppraisal.copingBias ? { dominant: entry.eventAppraisal.copingBias.dominant || "" } : null,
      sensitivities: (entry.eventAppraisal.sensitivities || []).filter((item) => (item.matchedCueIds || []).length).slice(0, 4).map((item) => ({
        sensitivityId: item.sensitivityId || "",
        threatMeaning: item.threatMeaning || "",
        matchedCueIds: [...(item.matchedCueIds || [])].slice(0, 6),
        after: Number(item.after || 0),
      })),
    } : null,
    factorTrace: entry.factorTrace ? {
      visibility: "observer-only",
      formulaVersion: entry.factorTrace.formulaVersion || "",
      selectedCandidateId,
      candidates: factorCandidates,
    } : null,
    trigger: entry.trigger ? {
      impactId: entry.trigger.impactId || "",
      sourceCharacterId: entry.trigger.sourceCharacterId || "",
      type: entry.trigger.type || "",
      modality: entry.trigger.modality || "",
      content: entry.trigger.content || "",
      topic: entry.trigger.topic || "",
      directed: Boolean(entry.trigger.directed),
    } : null,
    day: Number(entry.day || 0),
    slotId: entry.slotId || "",
    slotLabel: entry.slotLabel || "",
    decidedAtSeconds: Number(entry.decidedAtSeconds || 0),
    });
  });
}

function compactDraftSceneForSnapshot(draft = {}, observerLimit = 175) {
  return deepClone({
    id: draft.id,
    projectId: draft.projectId,
    branchId: draft.branchId,
    createdAt: draft.createdAt,
    provider: draft.provider || draft.engine?.provider || draft.pipelineMeta?.provider || "",
    timeGrain: draft.timeGrain,
    locationId: draft.locationId,
    participantIds: draft.participantIds || [],
    surfaceEvent: draft.surfaceEvent || "",
    sceneText: draft.sceneText || "",
    novelText: draft.novelText || "",
    observerPsychology: compactObserverPsychologyForSnapshot(draft.observerPsychology, observerLimit),
    dialoguePsychology: compactDialoguePsychologyForSnapshot(draft.dialoguePsychology || draft.simulationTick?.dialoguePsychology),
    privateSimulations: compactPrivateSimulationsForSnapshot(draft.privateSimulations || draft.simulationTick?.privateSimulations),
    agentOutputs: compactAgentOutputsForSnapshot(draft.agentOutputs),
    sceneInteraction: compactSceneInteractionForSnapshot(draft.sceneInteraction),
    causalScene: compactCausalSceneForSnapshot(draft.causalScene),
    causalPeriod: draft.causalPeriod ? {
      schemaVersion: Number(draft.causalPeriod.schemaVersion || 1),
      grain: draft.causalPeriod.grain || "",
      slots: deepClone((draft.causalPeriod.slots || []).slice(-35)),
      blockedBy: deepClone(draft.causalPeriod.blockedBy || null),
    } : null,
    agentParticipation: (draft.agentParticipation || []).map((trace) => compactAgentParticipationForSnapshot(trace)).filter(Boolean),
    agentDecisionMeta: draft.agentDecisionMeta ? {
      decisions: Number(draft.agentDecisionMeta.decisions || 0),
      dialogueTurns: Number(draft.agentDecisionMeta.dialogueTurns || 0),
      failures: deepClone(draft.agentDecisionMeta.failures || []),
    } : null,
    pipelineMeta: draft.pipelineMeta ? {
      mode: draft.pipelineMeta.mode || "",
      pipelineMode: draft.pipelineMeta.pipelineMode || "",
      provider: draft.pipelineMeta.provider || "",
      model: draft.pipelineMeta.model || "",
      pipeline: draft.pipelineMeta.pipeline || "",
      degradedStages: deepClone(draft.pipelineMeta.degradedStages || []),
      elapsedMs: Number(draft.pipelineMeta.elapsedMs || 0),
    } : null,
    updateBundle: draft.updateBundle ? {
      tavernState: compactTavernStateForSnapshot(draft.updateBundle.tavernState),
      relationships: deepClone((draft.updateBundle.relationships || []).slice(-80)),
      lifeEvents: deepClone((draft.updateBundle.lifeEvents || []).slice(-120)),
      stateChangeReasons: deepClone((draft.updateBundle.stateChangeReasons || []).slice(-48)),
    } : null,
    relationshipShift: (draft.relationshipShift || []).slice(0, 40),
    irreversibleTraces: (draft.irreversibleTraces || []).slice(0, 40),
    periodSimulation: draft.periodSimulation ? {
      id: draft.periodSimulation.id,
      duration: draft.periodSimulation.duration,
      tickCount: draft.periodSimulation.tickCount,
      locationIds: draft.periodSimulation.locationIds || [],
      participantIds: draft.periodSimulation.participantIds || [],
      townStateChanges: (draft.periodSimulation.townStateChanges || []).slice(0, 12),
      offscreenActions: (draft.periodSimulation.offscreenActions || []).slice(0, 12),
      ticks: (draft.periodSimulation.ticks || []).map((tick) => ({
        id: tick.id,
        day: Number(tick.day || 0),
        slotId: tick.slotId || tick.id || "",
        label: tick.label,
        locationId: tick.locationId,
        locationName: tick.locationName,
        participantIds: tick.participantIds || [],
        resolution: tick.resolution || "",
        surfaceEvent: tick.surfaceEvent || "",
        novelText: tick.novelText || tick.simulationTick?.novelText || "",
        observerPsychology: compactObserverPsychologyForSnapshot(tick.observerPsychology, 48),
        dialoguePsychology: compactDialoguePsychologyForSnapshot(tick.dialoguePsychology || tick.simulationTick?.dialoguePsychology),
        privateSimulations: compactPrivateSimulationsForSnapshot(tick.privateSimulations),
        agentOutputs: compactAgentOutputsForSnapshot(tick.agentOutputs),
        sceneInteraction: compactSceneInteractionForSnapshot(tick.sceneInteraction),
        causalScene: compactCausalTickTraceForSnapshot(tick.causalScene),
        canonicalDialogueTurns: (tick.canonicalDialogueTurns || []).map((turn) => ({ ...turn })),
        agentParticipation: compactAgentParticipationForSnapshot(tick.agentParticipation),
      })),
    } : null,
  });
}

function emptySnapshot() {
  return getBranchSnapshot({});
}

function normalizeSnapshot(snapshot, fallback) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  return {
    characters: deepClone(Array.isArray(source.characters) ? source.characters : fallback.characters),
    relationships: deepClone(Array.isArray(source.relationships) ? source.relationships : fallback.relationships),
    canonEvents: compactCanonEventsForSnapshot(Array.isArray(source.canonEvents) ? source.canonEvents : []),
    draftScenes: compactDraftScenesForSnapshot(Array.isArray(source.draftScenes) ? source.draftScenes : []),
    rumors: deepClone(Array.isArray(source.rumors) ? source.rumors : []),
    evidence: deepClone(Array.isArray(source.evidence) ? source.evidence : []),
    secrets: deepClone(Array.isArray(source.secrets) ? source.secrets : []),
    characterMemories: deepClone(Array.isArray(source.characterMemories) ? source.characterMemories : []),
    characterPlans: deepClone(Array.isArray(source.characterPlans) ? source.characterPlans : []),
    townStateLedger: deepClone(Array.isArray(source.townStateLedger) ? source.townStateLedger : fallback.townStateLedger || []),
    interventions: deepClone(Array.isArray(source.interventions) ? source.interventions : []),
    stateChangeReasons: deepClone(Array.isArray(source.stateChangeReasons) ? source.stateChangeReasons : []),
    replayMarkers: deepClone(Array.isArray(source.replayMarkers) ? source.replayMarkers : []),
    irreversibleTraces: deepClone(Array.isArray(source.irreversibleTraces) ? source.irreversibleTraces : []),
    storyRevisions: deepClone(Array.isArray(source.storyRevisions) ? source.storyRevisions : fallback.storyRevisions || []),
    tavernState: source.tavernState && typeof source.tavernState === "object"
      ? compactTavernStateForSnapshot(source.tavernState)
      : fallback.tavernState && typeof fallback.tavernState === "object"
        ? compactTavernStateForSnapshot(fallback.tavernState)
        : null,
  };
}

function makeLegacyBranchSnapshot(source, branch, activeBranchId) {
  const branchId = branch.id;
  const draftIds = new Set(branch.draftSceneIds || []);
  const canonIds = new Set(branch.canonEventIds || []);
  const draftScenes = (source.draftScenes || []).filter((draft) =>
    draft.branchId === branchId || draftIds.has(draft.id) || (!draft.branchId && branchId === "branch_main")
  );
  const localDraftIds = new Set(draftScenes.map((draft) => draft.id));
  const canonEvents = (source.canonEvents || []).filter((event) =>
    event.branchId === branchId || canonIds.has(event.id) || (!event.branchId && branchId === "branch_main")
  );
  const belongsToBranch = (item) => {
    if (!item || typeof item !== "object") return false;
    if (item.branchId) return item.branchId === branchId;
    if (item.sourceDraftId) return localDraftIds.has(item.sourceDraftId);
    return branchId === activeBranchId;
  };
  return {
    characters: deepClone(source.characters || []),
    relationships: deepClone(source.relationships || []),
    canonEvents: deepClone(canonEvents),
    draftScenes: compactDraftScenesForSnapshot(draftScenes),
    rumors: deepClone((source.rumors || []).filter(belongsToBranch)),
    evidence: deepClone((source.evidence || []).filter(belongsToBranch)),
    secrets: deepClone((source.secrets || []).filter(belongsToBranch)),
    characterMemories: deepClone((source.characterMemories || []).filter((item) => !item.branchId || item.branchId === branchId)),
    characterPlans: deepClone((source.characterPlans || []).filter((item) => !item.branchId || item.branchId === branchId)),
    townStateLedger: deepClone((source.townStateLedger || []).filter((item) => !item.branchId || item.branchId === branchId)),
    interventions: deepClone((source.interventions || []).filter((item) => !item.branchId || item.branchId === branchId)),
    stateChangeReasons: deepClone((source.stateChangeReasons || []).filter(belongsToBranch)),
    replayMarkers: deepClone((source.replayMarkers || []).filter(belongsToBranch)),
    irreversibleTraces: deepClone((source.irreversibleTraces || []).filter(belongsToBranch)),
    storyRevisions: deepClone((source.storyRevisions || []).filter((item) => !item.branchId || item.branchId === branchId)),
    tavernState: compactTavernStateForSnapshot(source.tavernState),
  };
}

function mergeWorldSetup(candidateWorldSetup, nextWorldSetup) {
  const candidate = candidateWorldSetup && typeof candidateWorldSetup === "object" ? candidateWorldSetup : {};
  return {
    ...nextWorldSetup,
    ...candidate,
    worldbuildingSkill: nextWorldSetup.worldbuildingSkill,
    characterSkill: nextWorldSetup.characterSkill,
  };
}

function normalizeEngineMode(value) {
  if (value === "openai") return "openai";
  // v2.7 runs the character-owned runtime instead of the scene
  // pipeline.  It has to survive branch restore and import like any other run
  // mode, or switching branches would silently drop the author back to the
  // legacy engine.
  if (value === "v27") return "v27";
  return "local";
}

function snapshotIds(snapshot) {
  return {
    canonEventIds: (snapshot.canonEvents || []).map((event) => event.id),
    draftSceneIds: (snapshot.draftScenes || []).map((draft) => draft.id),
  };
}

function mergePsychologyNeed(character = {}, freshCharacter = null) {
  if (!freshCharacter) return character;
  return {
    ...character,
    agentProfile: {
      ...(character.agentProfile || {}),
      desiredWitness: freshCharacter.agentProfile?.desiredWitness,
      desiredResponse: freshCharacter.agentProfile?.desiredResponse,
      relationshipHook: freshCharacter.agentProfile?.relationshipHook,
    },
    internalSituation: {
      ...(character.internalSituation || {}),
      desiredJudge: freshCharacter.internalSituation?.desiredJudge,
      desiredResponse: freshCharacter.internalSituation?.desiredResponse,
    },
    innerCourt: {
      ...(character.innerCourt || {}),
      desiredJudge: freshCharacter.innerCourt?.desiredJudge,
      desiredResponse: freshCharacter.innerCourt?.desiredResponse,
      wants: freshCharacter.innerCourt?.desiredResponse,
    },
  };
}

function migrateGeneratedPsychologyNeeds(target) {
  if (!target.worldSetup?.generatedBySkills || Number(target.worldSetup?.psychologyNeedVersion || 0) >= 3) return target;
  const sourcePrompts = target.worldSetup?.sourcePrompts || {};
  const regenerated = buildPlayableWorldFromSetup({
    setupWorldPrompt: sourcePrompts.world || "",
    setupPeoplePrompt: sourcePrompts.people || "",
  });
  const freshById = new Map((regenerated.characters || []).map((character) => [character.id, character]));
  const freshByName = new Map((regenerated.characters || []).map((character) => [character.name, character]));
  const upgradeCharacters = (characters = []) => characters.map((character) => mergePsychologyNeed(
    character,
    freshById.get(character.id) || freshByName.get(character.name) || null,
  ));

  target.characters = upgradeCharacters(target.characters || []);
  target.branches = (target.branches || []).map((branch) => ({
    ...branch,
    snapshot: branch.snapshot ? {
      ...branch.snapshot,
      characters: upgradeCharacters(branch.snapshot.characters || []),
    } : branch.snapshot,
  }));
  target.worldSetup = { ...(target.worldSetup || {}), psychologyNeedVersion: 3 };
  return target;
}

function mergePerformanceSeed(character = {}, freshCharacter = null) {
  if (!freshCharacter) return character;
  return {
    ...character,
    speechProfile: freshCharacter.speechProfile || null,
    defenseLanguage: deepClone(freshCharacter.defenseLanguage || []),
    agentProfile: {
      ...(character.agentProfile || {}),
      speechProfile: freshCharacter.agentProfile?.speechProfile || null,
      dialogueMoves: deepClone(freshCharacter.agentProfile?.dialogueMoves || []),
    },
    internalSituation: {
      ...(character.internalSituation || {}),
      repeatedSelfLie: freshCharacter.internalSituation?.repeatedSelfLie,
    },
    currentState: {
      ...(character.currentState || {}),
      currentSelfLie: freshCharacter.currentState?.currentSelfLie,
    },
  };
}

function migrateGeneratedPerformanceSeeds(target) {
  if (!target.worldSetup?.generatedBySkills || Number(target.worldSetup?.performanceSeedVersion || 0) >= 2) return target;
  const sourcePrompts = target.worldSetup?.sourcePrompts || {};
  const regenerated = buildPlayableWorldFromSetup({
    setupWorldPrompt: sourcePrompts.world || "",
    setupPeoplePrompt: sourcePrompts.people || "",
  });
  const freshById = new Map((regenerated.characters || []).map((character) => [character.id, character]));
  const freshByName = new Map((regenerated.characters || []).map((character) => [character.name, character]));
  const upgradeCharacters = (characters = []) => characters.map((character) => mergePerformanceSeed(
    character,
    freshById.get(character.id) || freshByName.get(character.name) || null,
  ));

  target.characters = upgradeCharacters(target.characters || []);
  target.branches = (target.branches || []).map((branch) => ({
    ...branch,
    snapshot: branch.snapshot ? {
      ...branch.snapshot,
      characters: upgradeCharacters(branch.snapshot.characters || []),
    } : branch.snapshot,
  }));
  target.worldSetup = { ...(target.worldSetup || {}), performanceSeedVersion: 2 };
  return target;
}

function migrateXiaoyaoyouToTavernLife(target) {
  if (target.worldSetup?.worldDossier?.worldId !== "xiaoyaoyou" || Number(target.worldSetup?.tavernLifeVersion || 0) >= 2) return target;
  const sourcePrompts = target.worldSetup?.sourcePrompts || {};
  const fresh = buildPlayableWorldFromSetup({
    setupWorldPrompt: sourcePrompts.world || "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: sourcePrompts.people || "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  const freshById = new Map((fresh.characters || []).map((character) => [character.id, character]));
  const freshByName = new Map((fresh.characters || []).map((character) => [character.name, character]));
  const upgradeCharacters = (characters = []) => characters.map((character) => {
    const seed = freshById.get(character.id) || freshByName.get(character.name);
    if (!seed) return character;
    const previousLife = character.lifeState?.needs ? deepClone(character.lifeState) : {};
    return {
      ...character,
      lifeProfile: deepClone(seed.lifeProfile),
      lifeState: {
        ...deepClone(seed.lifeState),
        ...previousLife,
        schemaVersion: 2,
        needs: { ...(seed.lifeState?.needs || {}), ...(previousLife.needs || {}) },
        resources: { ...(seed.lifeState?.resources || {}), ...(previousLife.resources || {}) },
        situationalRole: previousLife.situationalRole || seed.lifeState?.situationalRole || "在场者",
        activeVisitId: "",
        visitPurpose: "",
      },
      currentActivity: previousLife.currentActivity || character.currentActivity || deepClone(seed.currentActivity),
      previousLocationId: character.currentLocationId || character.previousLocationId || null,
      currentLocationId: "loc_xyy_tavern",
      inTransit: false,
    };
  });

  target.project = { ...(target.project || {}), title: fresh.project.title };
  target.town = { ...(target.town || {}), ...fresh.town, id: target.town?.id || fresh.town.id };
  target.locations = deepClone(fresh.locations);
  target.characters = upgradeCharacters(target.characters || []);
  target.tavernState = target.tavernState && typeof target.tavernState === "object"
    ? {
      ...deepClone(fresh.tavernState),
      ...target.tavernState,
      schemaVersion: 2,
      locationId: "loc_xyy_tavern",
      stock: { ...(fresh.tavernState?.stock || {}), ...(target.tavernState?.stock || {}) },
      institution: deepClone(fresh.tavernState?.institution || {}),
      activeVisits: [],
      visits: Array.isArray(target.tavernState?.visits) ? target.tavernState.visits.slice(-24) : [],
      ledger: Array.isArray(target.tavernState?.ledger) ? target.tavernState.ledger.slice(-48) : [],
      eventThreads: Array.isArray(target.tavernState?.eventThreads) ? target.tavernState.eventThreads.slice(-12) : [],
    }
    : deepClone(fresh.tavernState);
  target.worldSetup = {
    ...(target.worldSetup || {}),
    tavernLifeVersion: 2,
    fixedStage: true,
    simulationFocus: "sustainable-character-life",
    activationPolicy: deepClone(fresh.worldSetup.activationPolicy),
  };
  target.ui = {
    ...(target.ui || {}),
    engineMode: "openai",
    focusMode: "location",
    selectedLocationId: "loc_xyy_tavern",
  };
  target.branches = (target.branches || []).map((branch) => ({
    ...branch,
    snapshot: branch.snapshot ? {
      ...branch.snapshot,
      characters: upgradeCharacters(branch.snapshot.characters || []),
      tavernState: deepClone(target.tavernState),
    } : branch.snapshot,
  }));
  return target;
}

function migrateTavernAgentRuntimeV3(target) {
  if (target.worldSetup?.worldDossier?.worldId !== "xiaoyaoyou" || Number(target.worldSetup?.tavernLifeVersion || 0) >= 3) return target;
  const upgradeTavernState = (tavernState) => {
    if (!tavernState || typeof tavernState !== "object") return tavernState;
    return {
      ...tavernState,
      schemaVersion: 3,
      eventThreads: Array.isArray(tavernState.eventThreads) ? deepClone(tavernState.eventThreads).slice(-12) : [],
    };
  };
  target.tavernState = upgradeTavernState(target.tavernState);
  target.worldSetup = {
    ...(target.worldSetup || {}),
    tavernLifeVersion: 3,
    fixedStage: true,
    simulationFocus: "sustainable-character-life",
  };
  target.ui = {
    ...(target.ui || {}),
    engineMode: "openai",
    focusMode: "location",
    selectedLocationId: "loc_xyy_tavern",
  };
  target.branches = (target.branches || []).map((branch) => ({
    ...branch,
    snapshot: branch.snapshot ? {
      ...branch.snapshot,
      tavernState: upgradeTavernState(branch.snapshot.tavernState),
    } : branch.snapshot,
  }));
  return target;
}

function migrateTavernAgentRuntimeV4(target) {
  if (target.worldSetup?.worldDossier?.worldId !== "xiaoyaoyou" || Number(target.worldSetup?.tavernLifeVersion || 0) >= 4) return target;
  const zoneDefaults = {
    business: { allowed: ["threshold", "hall"], purpose: ["hall"] },
    delivery: { allowed: ["threshold", "hall", "counter"], purpose: ["hall", "counter"] },
    lodging: { allowed: ["threshold", "hall", "stairs", "guest_room"], purpose: ["hall", "stairs", "guest_room"] },
    work_exchange: { allowed: ["threshold", "hall", "stove", "courtyard"], purpose: ["hall", "stove", "courtyard"] },
    visit: { allowed: ["threshold", "hall"], purpose: ["hall"] },
  };
  const upgradeVisit = (visit = {}) => {
    const zones = zoneDefaults[visit.kind] || zoneDefaults.visit;
    const terminal = ["completed", "refused", "abandoned"].includes(visit.stage);
    return {
      ...visit,
      purposeStatus: visit.purposeStatus || visit.purposeDisclosureStatus || "declared",
      purposeDisclosureStatus: visit.purposeDisclosureStatus || visit.purposeStatus || "declared",
      declaredPurpose: visit.declaredPurpose || visit.purpose || "",
      businessStatus: visit.businessStatus || (visit.kind === "business" ? (terminal ? "done" : "pending") : "not_required"),
      purposeAction: visit.purposeAction || (visit.kind === "business" ? visit.purpose || "办完来访事务" : ""),
      purposeZoneIds: [...new Set(visit.purposeZoneIds?.length ? visit.purposeZoneIds : zones.purpose)],
      allowedZoneIds: [...new Set(visit.allowedZoneIds?.length ? visit.allowedZoneIds : zones.allowed)],
      businessObjectIds: [...new Set(visit.businessObjectIds || [])],
      carriedObjectLabel: visit.carriedObjectLabel || "随身物件",
      arrivalCue: visit.arrivalCue || "带着随身物件站在门槛内",
    };
  };
  const upgradeTavernState = (tavernState) => {
    if (!tavernState || typeof tavernState !== "object") return tavernState;
    const activeVisits = (tavernState.activeVisits || []).map(upgradeVisit);
    const visits = (tavernState.visits || []).map(upgradeVisit);
    const candidateNotices = Array.isArray(tavernState.candidateNotices) ? deepClone(tavernState.candidateNotices) : [];
    for (const visit of [...visits, ...activeVisits]) {
      if (visit.kind !== "lodging" || visit.lodgingStatus !== "assigned" || visit.visitorId !== "char_xyy_luozhao") continue;
      if (candidateNotices.some((notice) => notice.sourceVisitId === visit.id)) continue;
      candidateNotices.push({
        id: `candidate_notice_migrated:${visit.id}`,
        status: "pending",
        candidateId: visit.visitorId,
        candidateName: visit.visitorName || "洛照",
        sourceVisitId: visit.id,
        recordKind: "候选留宿与接引登记",
        reason: "持玉衡宗拜帖在望梯酒馆留宿等接引",
        createdDay: Number(visit.arrivedDay || 0),
        createdSlot: visit.arrivedSlot || "",
      });
    }
    return {
      ...tavernState,
      schemaVersion: 4,
      activeVisits,
      visits,
      candidateNotices: candidateNotices.slice(-24),
    };
  };
  target.tavernState = upgradeTavernState(target.tavernState);
  target.worldSetup = {
    ...(target.worldSetup || {}),
    tavernLifeVersion: 4,
    fixedStage: true,
    simulationFocus: "sustainable-character-life",
  };
  target.branches = (target.branches || []).map((branch) => ({
    ...branch,
    snapshot: branch.snapshot ? {
      ...branch.snapshot,
      tavernState: upgradeTavernState(branch.snapshot.tavernState),
    } : branch.snapshot,
  }));
  return target;
}

function migrateTavernAgentRuntimeV5(target) {
  if (target.worldSetup?.worldDossier?.worldId !== "xiaoyaoyou" || Number(target.worldSetup?.tavernLifeVersion || 0) >= 5) return target;
  const upgradeTavernState = (tavernState, characters = []) => {
    if (!tavernState || typeof tavernState !== "object") return tavernState;
    const activeVisits = (tavernState.activeVisits || []).map((visit) => {
      const terminal = ["completed", "refused", "abandoned"].includes(visit.stage);
      const lacksPublicProof = !terminal && !visit.purposeDeclaredByActionId;
      if (!lacksPublicProof) return visit;
      return {
        ...visit,
        purposeStatus: "undisclosed",
        purposeDisclosureStatus: "undisclosed",
        declaredPurpose: "",
        hostId: "",
        receivedBy: "",
        stage: "waiting",
      };
    });
    const visitorIds = new Set((characters || [])
      .filter((character) => character.lifeProfile?.simulationTier === "visitor")
      .map((character) => character.id));
    const activeVisitorIds = new Set(activeVisits.map((visit) => visit.visitorId));
    const sceneAgents = Object.fromEntries(Object.entries(tavernState.sceneRuntime?.agents || {})
      .filter(([characterId]) => !visitorIds.has(characterId) || activeVisitorIds.has(characterId)));
    return {
      ...tavernState,
      schemaVersion: 5,
      activeVisits,
      ...(tavernState.sceneRuntime ? {
        sceneRuntime: {
          ...tavernState.sceneRuntime,
          activeCharacterIds: (tavernState.sceneRuntime.activeCharacterIds || [])
            .filter((characterId) => !visitorIds.has(characterId) || activeVisitorIds.has(characterId)),
          agents: sceneAgents,
        },
      } : {}),
    };
  };
  const repairVisitorPresence = (characters = [], tavernState = {}) => {
    const activeVisitorIds = new Set((tavernState?.activeVisits || []).map((visit) => visit.visitorId));
    return (characters || []).map((character) => {
      if (character.lifeProfile?.simulationTier !== "visitor" || activeVisitorIds.has(character.id)) return character;
      return {
        ...character,
        lifeState: {
          ...(character.lifeState || {}),
          present: false,
          activeVisitId: "",
        },
      };
    });
  };
  target.tavernState = upgradeTavernState(target.tavernState, target.characters || []);
  target.characters = repairVisitorPresence(target.characters || [], target.tavernState);
  target.worldSetup = {
    ...(target.worldSetup || {}),
    tavernLifeVersion: 5,
    fixedStage: true,
    simulationFocus: "sustainable-character-life",
  };
  target.branches = (target.branches || []).map((branch) => ({
    ...branch,
    snapshot: branch.snapshot ? {
      ...branch.snapshot,
      tavernState: upgradeTavernState(branch.snapshot.tavernState, branch.snapshot.characters || target.characters || []),
      characters: repairVisitorPresence(
        branch.snapshot.characters || target.characters || [],
        upgradeTavernState(branch.snapshot.tavernState, branch.snapshot.characters || target.characters || []),
      ),
    } : branch.snapshot,
  }));
  return target;
}

function migrateTavernAgentRuntimeV6(target) {
  if (target.worldSetup?.worldDossier?.worldId !== "xiaoyaoyou" || Number(target.worldSetup?.tavernLifeVersion || 0) >= 6) return target;
  const isVisitor = (character = {}) => character.lifeProfile?.simulationTier === "visitor"
    || Boolean(character.lifeProfile?.tavernAgency?.visitPolicy);
  const upgradeTavernState = (tavernState, characters = []) => {
    if (!tavernState || typeof tavernState !== "object") return tavernState;
    const activeVisits = Array.isArray(tavernState.activeVisits) ? tavernState.activeVisits : [];
    const visitorIds = new Set((characters || []).filter(isVisitor).map((character) => character.id));
    const activeVisitorIds = new Set(activeVisits.map((visit) => visit.visitorId));
    const sceneAgents = Object.fromEntries(Object.entries(tavernState.sceneRuntime?.agents || {})
      .filter(([characterId]) => !visitorIds.has(characterId) || activeVisitorIds.has(characterId)));
    return {
      ...tavernState,
      schemaVersion: 6,
      activeVisits,
      ...(tavernState.sceneRuntime ? {
        sceneRuntime: {
          ...tavernState.sceneRuntime,
          activeCharacterIds: (tavernState.sceneRuntime.activeCharacterIds || [])
            .filter((characterId) => !visitorIds.has(characterId) || activeVisitorIds.has(characterId)),
          agents: sceneAgents,
        },
      } : {}),
    };
  };
  const repairCharacters = (characters = [], tavernState = {}) => {
    const activeVisitorIds = new Set((tavernState?.activeVisits || []).map((visit) => visit.visitorId));
    return (characters || []).map((character) => {
      if (!isVisitor(character) || activeVisitorIds.has(character.id)) return character;
      return {
        ...character,
        lifeState: {
          ...(character.lifeState || {}),
          present: false,
          activeVisitId: "",
        },
      };
    });
  };
  target.tavernState = upgradeTavernState(target.tavernState, target.characters || []);
  target.characters = repairCharacters(target.characters || [], target.tavernState);
  target.worldSetup = {
    ...(target.worldSetup || {}),
    tavernLifeVersion: 6,
    fixedStage: true,
    simulationFocus: "sustainable-character-life",
  };
  target.branches = (target.branches || []).map((branch) => {
    if (!branch.snapshot) return branch;
    const characters = branch.snapshot.characters || target.characters || [];
    const tavernState = upgradeTavernState(branch.snapshot.tavernState, characters);
    return {
      ...branch,
      snapshot: {
        ...branch.snapshot,
        tavernState,
        characters: repairCharacters(characters, tavernState),
      },
    };
  });
  return target;
}

function migrateTavernAgentRuntimeV7(target) {
  if (target.worldSetup?.worldDossier?.worldId !== "xiaoyaoyou" || Number(target.worldSetup?.tavernLifeVersion || 0) >= 7) return target;
  const visitorIds = new Set(["char_xyy_zhoumin", "char_xyy_luozhao", "char_xyy_yanzhizhong", "char_xyy_chenyan"]);
  const isVisitor = (character = {}) => visitorIds.has(character.id)
    || character.lifeProfile?.simulationTier === "visitor"
    || Boolean(character.lifeProfile?.tavernAgency?.visitPolicy);
  const repair = (characters = [], tavernState = {}) => {
    const activeVisitorIds = new Set((tavernState?.activeVisits || []).map((visit) => visit.visitorId));
    const visitorCharacterIds = new Set((characters || []).filter(isVisitor).map((character) => character.id));
    const nextCharacters = (characters || []).map((character) => {
      if (!isVisitor(character) || activeVisitorIds.has(character.id)) return character;
      return { ...character, lifeState: { ...(character.lifeState || {}), present: false, activeVisitId: "" } };
    });
    const nextTavernState = tavernState && typeof tavernState === "object" ? {
      ...tavernState,
      schemaVersion: 7,
      ...(tavernState.sceneRuntime ? {
        sceneRuntime: {
          ...tavernState.sceneRuntime,
          activeCharacterIds: (tavernState.sceneRuntime.activeCharacterIds || [])
            .filter((characterId) => !visitorCharacterIds.has(characterId) || activeVisitorIds.has(characterId)),
          agents: Object.fromEntries(Object.entries(tavernState.sceneRuntime.agents || {})
            .filter(([characterId]) => !visitorCharacterIds.has(characterId) || activeVisitorIds.has(characterId))),
        },
      } : {}),
    } : tavernState;
    return { characters: nextCharacters, tavernState: nextTavernState };
  };
  const top = repair(target.characters || [], target.tavernState || {});
  target.characters = top.characters;
  target.tavernState = top.tavernState;
  target.worldSetup = { ...(target.worldSetup || {}), tavernLifeVersion: 7 };
  target.branches = (target.branches || []).map((branch) => {
    if (!branch.snapshot) return branch;
    const next = repair(branch.snapshot.characters || target.characters || [], branch.snapshot.tavernState || {});
    return { ...branch, snapshot: { ...branch.snapshot, ...next } };
  });
  return target;
}

function migrateTavernAgentRuntimeV8(target) {
  if (target.worldSetup?.worldDossier?.worldId !== "xiaoyaoyou" || Number(target.worldSetup?.tavernLifeVersion || 0) >= 8) return target;
  const fresh = buildPlayableWorldFromSetup({
    setupWorldPrompt: target.worldSetup?.sourcePrompts?.world || "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: target.worldSetup?.sourcePrompts?.people || "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  const freshInstitution = fresh.tavernState?.institution || {};
  const upgradeTavernState = (source = {}) => ({
    ...(source || {}),
    schemaVersion: 8,
    institution: {
      ...deepClone(freshInstitution),
      ...(source?.institution || {}),
      schemaVersion: 3,
      workOrderTemplates: deepClone(
        source?.institution?.workOrderTemplates?.length
          ? source.institution.workOrderTemplates
          : freshInstitution.workOrderTemplates || [],
      ),
    },
    workOrders: Array.isArray(source?.workOrders) ? deepClone(source.workOrders) : [],
    objectLedger: source?.objectLedger && typeof source.objectLedger === "object"
      ? deepClone(source.objectLedger)
      : { schemaVersion: 1, objects: {}, heldByActor: {}, heldByCharacter: {} },
  });
  target.tavernState = upgradeTavernState(target.tavernState || {});
  target.worldSetup = { ...(target.worldSetup || {}), tavernLifeVersion: 8 };
  target.branches = (target.branches || []).map((branch) => (
    !branch.snapshot
      ? branch
      : { ...branch, snapshot: { ...branch.snapshot, tavernState: upgradeTavernState(branch.snapshot.tavernState || {}) } }
  ));
  return target;
}

function migrateTavernAgentRuntimeV9(target) {
  if (target.worldSetup?.worldDossier?.worldId !== "xiaoyaoyou" || Number(target.worldSetup?.tavernLifeVersion || 0) >= 9) return target;
  const fresh = buildPlayableWorldFromSetup({
    setupWorldPrompt: target.worldSetup?.sourcePrompts?.world || "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: target.worldSetup?.sourcePrompts?.people || "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  const authoredKnownActorIds = new Map((fresh.characters || []).map((character) => [
    character.id,
    [...(character.lifeProfile?.tavernAgency?.knowledgeBoundary?.knownActorIds || [])],
  ]));
  const mergeKnownActors = (characters = []) => (characters || []).map((character) => {
    const authored = authoredKnownActorIds.get(character.id) || [];
    if (!authored.length) return character;
    const lifeProfile = character.lifeProfile || {};
    const tavernAgency = lifeProfile.tavernAgency || {};
    const knowledgeBoundary = tavernAgency.knowledgeBoundary || {};
    return {
      ...character,
      lifeProfile: {
        ...lifeProfile,
        tavernAgency: {
          ...tavernAgency,
          knowledgeBoundary: {
            ...knowledgeBoundary,
            knownActorIds: [...new Set([
              ...(knowledgeBoundary.knownActorIds || []),
              ...authored,
            ].filter(Boolean))],
          },
        },
      },
    };
  });
  target.characters = mergeKnownActors(target.characters || []);
  target.worldSetup = { ...(target.worldSetup || {}), tavernLifeVersion: 9 };
  target.branches = (target.branches || []).map((branch) => (
    !branch.snapshot
      ? branch
      : {
        ...branch,
        snapshot: {
          ...branch.snapshot,
          characters: mergeKnownActors(branch.snapshot.characters || target.characters || []),
        },
      }
  ));
  return target;
}

function migrateTavernMaterialEconomyV10(target) {
  if (target.worldSetup?.worldDossier?.worldId !== "xiaoyaoyou" || Number(target.worldSetup?.tavernLifeVersion || 0) >= 10) return target;
  const fresh = buildPlayableWorldFromSetup({
    setupWorldPrompt: target.worldSetup?.sourcePrompts?.world || "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: target.worldSetup?.sourcePrompts?.people || "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  const freshById = new Map((fresh.characters || []).map((character) => [character.id, character]));
  const freshInstitution = fresh.tavernState?.institution || {};
  const freshStock = fresh.tavernState?.stock || {};

  const hasPersonalTransactionHistory = (tavernState = {}, characterId = "") => (
    (tavernState.ledger || []).some((row) => row.counterpartyId === characterId && ["sale", "credit"].includes(row.type))
  );
  const upgradeCharacters = (characters = [], tavernState = {}) => (characters || []).map((character) => {
    const seed = freshById.get(character.id);
    const materialEconomy = seed?.lifeProfile?.materialEconomy;
    if (!materialEconomy) return character;
    const currentResources = character.lifeState?.resources || {};
    const existingWallet = currentResources.wallet;
    const preserveExistingBalance = Boolean(existingWallet?.sourceId)
      || hasPersonalTransactionHistory(tavernState, character.id);
    const amount = preserveExistingBalance
      ? Math.max(0, Number(existingWallet?.amount ?? currentResources.coins ?? 0))
      : Math.max(0, Number(seed.lifeState?.resources?.coins || 0));
    return {
      ...character,
      lifeProfile: {
        ...(character.lifeProfile || {}),
        materialEconomy: deepClone(materialEconomy),
      },
      lifeState: {
        ...(character.lifeState || {}),
        resources: {
          ...currentResources,
          coins: amount,
          wallet: {
            currencyId: existingWallet?.currencyId || materialEconomy.initialWallet?.currencyId || "copper_wen",
            amount,
            sourceId: existingWallet?.sourceId
              || (preserveExistingBalance ? "migrated_balance_after_recorded_transactions" : materialEconomy.initialWallet?.sourceId)
              || "unanchored_wallet",
          },
        },
      },
    };
  });
  const upgradeTavernState = (source = {}) => {
    const existingTemplates = source?.institution?.objectTemplates || [];
    const existingIds = new Set(existingTemplates.map((template) => template.id).filter(Boolean));
    const objectTemplates = [
      ...deepClone(existingTemplates),
      ...deepClone((freshInstitution.objectTemplates || []).filter((template) => !existingIds.has(template.id))),
    ];
    return {
      ...(source || {}),
      schemaVersion: 9,
      stock: { ...deepClone(freshStock), ...(source?.stock || {}) },
      institution: {
        ...deepClone(freshInstitution),
        ...(source?.institution || {}),
        schemaVersion: 5,
        offerings: deepClone(freshInstitution.offerings || {}),
        objectTemplates,
      },
      objectLedger: mergeObjectTemplates({
        ledger: source?.objectLedger || {},
        templates: objectTemplates,
        sceneId: source?.locationId || fresh.tavernState?.locationId || "loc_xyy_tavern",
      }),
    };
  };

  const upgradedTopTavern = upgradeTavernState(target.tavernState || {});
  target.characters = upgradeCharacters(target.characters || [], target.tavernState || {});
  target.tavernState = upgradedTopTavern;
  target.worldSetup = { ...(target.worldSetup || {}), tavernLifeVersion: 10, tavernMaterialEconomyVersion: 1 };
  target.branches = (target.branches || []).map((branch) => {
    if (!branch.snapshot) return branch;
    const priorTavern = branch.snapshot.tavernState || target.tavernState || {};
    return {
      ...branch,
      snapshot: {
        ...branch.snapshot,
        characters: upgradeCharacters(branch.snapshot.characters || target.characters || [], priorTavern),
        tavernState: upgradeTavernState(priorTavern),
      },
    };
  });
  return target;
}

function migrateTavernCultivationSustenanceV11(target) {
  if (target.worldSetup?.worldDossier?.worldId !== "xiaoyaoyou" || Number(target.worldSetup?.tavernLifeVersion || 0) >= 11) return target;
  const fresh = buildPlayableWorldFromSetup({
    setupWorldPrompt: target.worldSetup?.sourcePrompts?.world || "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: target.worldSetup?.sourcePrompts?.people || "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  const freshById = new Map((fresh.characters || []).map((character) => [character.id, character]));
  const upgradeCharacters = (characters = []) => (characters || []).map((character) => {
    const seed = freshById.get(character.id);
    if (!seed?.lifeProfile) return character;
    return {
      ...character,
      lifeProfile: {
        ...(character.lifeProfile || {}),
        physiology: deepClone(seed.lifeProfile.physiology || character.lifeProfile?.physiology || {}),
        materialEconomy: {
          ...deepClone(seed.lifeProfile.materialEconomy || {}),
          ...(character.lifeProfile?.materialEconomy || {}),
          currencyAccess: deepClone(
            seed.lifeProfile.materialEconomy?.currencyAccess
              || character.lifeProfile?.materialEconomy?.currencyAccess
              || {},
          ),
        },
      },
    };
  });
  const upgradeTavernState = (source = {}) => ({
    ...(source || {}),
    institution: {
      ...deepClone(fresh.tavernState?.institution || {}),
      ...(source?.institution || {}),
      offerings: deepClone(fresh.tavernState?.institution?.offerings || source?.institution?.offerings || {}),
    },
  });
  const newPublicRules = fresh.town?.publicRules || [];
  target.town = {
    ...(target.town || {}),
    publicRules: [...new Set([...(target.town?.publicRules || []), ...newPublicRules])],
  };
  target.characters = upgradeCharacters(target.characters || []);
  target.tavernState = upgradeTavernState(target.tavernState || {});
  target.worldSetup = {
    ...(target.worldSetup || {}),
    tavernLifeVersion: 11,
    tavernSustenanceVersion: 1,
    tavernMundaneCurrencyVersion: 1,
  };
  target.branches = (target.branches || []).map((branch) => {
    if (!branch.snapshot) return branch;
    return {
      ...branch,
      snapshot: {
        ...branch.snapshot,
        characters: upgradeCharacters(branch.snapshot.characters || target.characters || []),
        tavernState: upgradeTavernState(branch.snapshot.tavernState || target.tavernState || {}),
      },
    };
  });
  return target;
}

export function migrateCharacterAgentMemoryV1(target) {
  const upgradeCharacters = (characters = [], legacyMemories = []) => (characters || []).map((character) => {
    const source = character.agentMemory || createCharacterAgentMemoryState(character.id);
    const normalized = normalizeCharacterAgentMemoryState(source, character.id);
    const migrated = migrateLegacyCharacterMemories(normalized, legacyMemories, { ownerCharacterId: character.id });
    return { ...character, agentMemory: migrated };
  });
  target.characters = upgradeCharacters(target.characters || [], target.characterMemories || []);
  target.branches = (target.branches || []).map((branch) => {
    if (!branch.snapshot) return branch;
    return {
      ...branch,
      snapshot: {
        ...branch.snapshot,
        characters: upgradeCharacters(
          branch.snapshot.characters || [],
          branch.snapshot.characterMemories || [],
        ),
      },
    };
  });
  target.worldSetup = {
    ...(target.worldSetup || {}),
    characterAgentMemoryVersion: CHARACTER_AGENT_MEMORY_SCHEMA_VERSION,
  };
  return target;
}

function migrateTavernObjectLedgerV1(target) {
  if (target.worldSetup?.worldDossier?.worldId !== "xiaoyaoyou"
    || Number(target.worldSetup?.tavernObjectLedgerVersion || 0) >= 1) return target;
  const fresh = buildPlayableWorldFromSetup({
    setupWorldPrompt: target.worldSetup?.sourcePrompts?.world || "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: target.worldSetup?.sourcePrompts?.people || "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  const freshInstitution = fresh.tavernState?.institution || {};
  const upgradeTavernState = (source = {}) => ({
    ...(source || {}),
    institution: {
      ...deepClone(freshInstitution),
      ...(source?.institution || {}),
      schemaVersion: 4,
      objectTemplates: deepClone(
        source?.institution?.objectTemplates?.length
          ? source.institution.objectTemplates
          : freshInstitution.objectTemplates || [],
      ),
    },
    objectLedger: mergeObjectTemplates({
      ledger: source?.objectLedger || {},
      templates: source?.institution?.objectTemplates?.length
        ? source.institution.objectTemplates
        : freshInstitution.objectTemplates || [],
      sceneId: source?.locationId || fresh.tavernState?.locationId || "loc_xyy_tavern",
    }),
  });
  target.tavernState = upgradeTavernState(target.tavernState || {});
  target.worldSetup = { ...(target.worldSetup || {}), tavernObjectLedgerVersion: 1 };
  target.branches = (target.branches || []).map((branch) => (
    !branch.snapshot
      ? branch
      : { ...branch, snapshot: { ...branch.snapshot, tavernState: upgradeTavernState(branch.snapshot.tavernState || {}) } }
  ));
  return target;
}

function migrateTavernObjectLedgerV2(target) {
  if (target.worldSetup?.worldDossier?.worldId !== "xiaoyaoyou"
    || Number(target.worldSetup?.tavernObjectLedgerVersion || 0) >= 2) return target;
  const fresh = buildPlayableWorldFromSetup({
    setupWorldPrompt: target.worldSetup?.sourcePrompts?.world || "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: target.worldSetup?.sourcePrompts?.people || "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  const freshInstitution = fresh.tavernState?.institution || {};
  const upgradeTavernState = (source = {}) => {
    const existingTemplates = source?.institution?.objectTemplates || [];
    const existingIds = new Set(existingTemplates.map((template) => template.id).filter(Boolean));
    const objectTemplates = [
      ...deepClone(existingTemplates),
      ...deepClone((freshInstitution.objectTemplates || []).filter((template) => !existingIds.has(template.id))),
    ];
    return {
      ...(source || {}),
      institution: {
        ...deepClone(freshInstitution),
        ...(source?.institution || {}),
        schemaVersion: 4,
        objectTemplates,
      },
      objectLedger: mergeObjectTemplates({
        ledger: source?.objectLedger || {},
        templates: objectTemplates,
        sceneId: source?.locationId || fresh.tavernState?.locationId || "loc_xyy_tavern",
      }),
    };
  };
  target.tavernState = upgradeTavernState(target.tavernState || {});
  target.worldSetup = { ...(target.worldSetup || {}), tavernObjectLedgerVersion: 2 };
  target.branches = (target.branches || []).map((branch) => (
    !branch.snapshot
      ? branch
      : { ...branch, snapshot: { ...branch.snapshot, tavernState: upgradeTavernState(branch.snapshot.tavernState || {}) } }
  ));
  return target;
}

function migrateTavernObjectLedgerV3(target) {
  if (target.worldSetup?.worldDossier?.worldId !== "xiaoyaoyou"
    || Number(target.worldSetup?.tavernObjectLedgerVersion || 0) >= 3) return target;
  const fresh = buildPlayableWorldFromSetup({
    setupWorldPrompt: target.worldSetup?.sourcePrompts?.world || "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: target.worldSetup?.sourcePrompts?.people || "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  const freshInstitution = fresh.tavernState?.institution || {};
  const upgradeTavernState = (source = {}) => {
    const existingTemplates = source?.institution?.objectTemplates || [];
    const existingIds = new Set(existingTemplates.map((template) => template.id).filter(Boolean));
    const objectTemplates = [
      ...deepClone(existingTemplates),
      ...deepClone((freshInstitution.objectTemplates || []).filter((template) => !existingIds.has(template.id))),
    ];
    return {
      ...(source || {}),
      institution: {
        ...deepClone(freshInstitution),
        ...(source?.institution || {}),
        schemaVersion: 4,
        objectTemplates,
      },
      objectLedger: mergeObjectTemplates({
        ledger: source?.objectLedger || {},
        templates: objectTemplates,
        sceneId: source?.locationId || fresh.tavernState?.locationId || "loc_xyy_tavern",
      }),
    };
  };
  target.tavernState = upgradeTavernState(target.tavernState || {});
  target.worldSetup = { ...(target.worldSetup || {}), tavernObjectLedgerVersion: 3 };
  target.branches = (target.branches || []).map((branch) => (
    !branch.snapshot
      ? branch
      : { ...branch, snapshot: { ...branch.snapshot, tavernState: upgradeTavernState(branch.snapshot.tavernState || {}) } }
  ));
  return target;
}

function migrateTavernEcologyV1(target) {
  if (target.worldSetup?.worldDossier?.worldId !== "xiaoyaoyou") return target;
  const ecologyNeedsUpgrade = Number(target.worldSetup?.tavernEcologyVersion || 0) < 1
    || (target.characters || []).some((character) => character.ecologyProfile || !character.ecologyProfileId || !character.ecologyState);
  if (!ecologyNeedsUpgrade) return target;
  const sourcePrompts = target.worldSetup?.sourcePrompts || {};
  const fresh = buildPlayableWorldFromSetup({
    setupWorldPrompt: sourcePrompts.world || "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: sourcePrompts.people || "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  const freshById = new Map((fresh.characters || []).map((character) => [character.id, character]));
  const invalidLegacyGoal = /^(?:不|别|勿|未|无|避免|拒绝|不能|不要|不得|应当|应该|必须|短缺|任何候选)/u;
  const upgradeCharacters = (characters = []) => characters.map((character) => {
    const seed = freshById.get(character.id);
    if (!seed?.ecologyProfileId || !seed?.ecologyState) return character;
    const { ecologyProfile: _legacyEcologyProfile, ...compactCharacter } = character;
    const present = Boolean(character.lifeState?.present);
    const previousGoal = String(character.lifeState?.activeGoal || "").trim();
    const useFreshGoal = !previousGoal || invalidLegacyGoal.test(previousGoal)
      || (character.lifeProfile?.commitments || []).includes(previousGoal);
    const currentLocationId = present
      ? "loc_xyy_tavern"
      : character.currentLocationId && character.currentLocationId !== "loc_xyy_tavern"
        ? character.currentLocationId
        : seed.currentLocationId;
    return {
      ...compactCharacter,
      lifeProfile: deepClone(seed.lifeProfile),
      lifeState: {
        ...(character.lifeState || {}),
        activeGoal: useFreshGoal ? seed.lifeState?.activeGoal : previousGoal,
        hiddenAgenda: seed.lifeState?.hiddenAgenda || character.lifeState?.hiddenAgenda || "",
      },
      ecologyProfileId: seed.ecologyProfileId,
      ecologyProfileVersion: seed.ecologyProfileVersion,
      ecologyState: {
        ...deepClone(seed.ecologyState),
        presence: {
          ...deepClone(seed.ecologyState.presence),
          locationId: currentLocationId,
          observableAtStage: present,
          arrivedAtSecond: present ? Number(character.ecologyState?.elapsedSeconds || 0) : null,
        },
      },
      previousLocationId: character.currentLocationId || character.previousLocationId || null,
      currentLocationId,
    };
  });
  const upgradeTavernState = (tavernState = {}) => ({
    ...tavernState,
    sceneRuntime: tavernState.sceneRuntime ? {
      ...tavernState.sceneRuntime,
      agents: Object.fromEntries(Object.entries(tavernState.sceneRuntime.agents || {}).map(([id, agent]) => {
        const seed = freshById.get(id);
        return [id, {
          ...agent,
          currentIntention: seed?.lifeState?.activeGoal || agent.currentIntention || "继续眼下的生活",
        }];
      })),
    } : tavernState.sceneRuntime,
  });
  target.characters = upgradeCharacters(target.characters || []);
  target.tavernState = upgradeTavernState(target.tavernState || {});
  target.worldSetup = {
    ...(target.worldSetup || {}),
    tavernEcologyVersion: 1,
    offstageLocations: deepClone(fresh.worldSetup?.offstageLocations || []),
  };
  target.branches = (target.branches || []).map((branch) => ({
    ...branch,
    snapshot: branch.snapshot ? {
      ...branch.snapshot,
      characters: upgradeCharacters(branch.snapshot.characters || []),
      tavernState: upgradeTavernState(branch.snapshot.tavernState || target.tavernState),
    } : branch.snapshot,
  }));
  return target;
}

export function migrateTavernRelationshipDynamicsV1(target) {
  const worldId = target.worldSetup?.worldDossier?.worldId || target.worldSetup?.worldId || "";
  if (worldId !== "xiaoyaoyou") return target;
  const directionKey = (fromCharacterId, toCharacterId) => `${fromCharacterId}->${toCharacterId}`;
  const legacyIndexByDirection = new Map(LEGACY_TAVERN_RELATIONSHIP_EDGE_ORDER.map(([fromCharacterId, toCharacterId], index) => [
    directionKey(fromCharacterId, toCharacterId),
    index,
  ]));
  const hasDynamicEvidence = (relationship) => Boolean(
    (relationship.evidenceIds || []).length
    || (relationship.dialogueHistory || []).length
    || relationship.lastDialogue
    || relationship.relationshipArc,
  );
  const upgradeRelationships = (relationships = [], characters = []) => {
    const calibrated = buildCalibratedTavernRelationships([], characters, "xiaoyaoyou") || [];
    const calibratedByDirection = new Map(calibrated.map((relationship) => [
      directionKey(relationship.fromCharacterId, relationship.toCharacterId),
      relationship,
    ]));
    const upgraded = [];
    const seen = new Set();
    for (const relationship of relationships || []) {
      const key = directionKey(relationship.fromCharacterId, relationship.toCharacterId);
      if (seen.has(key)) continue;
      seen.add(key);
      const seed = calibratedByDirection.get(key);
      if (!seed) {
        upgraded.push(relationship);
        continue;
      }
      const legacyIndex = legacyIndexByDirection.get(key);
      const legacyId = Number.isInteger(legacyIndex) ? `rel_xiaoyaoyou_${legacyIndex + 1}` : "";
      const legacyFamily = Number.isInteger(legacyIndex) && (
        relationship.id === legacyId
        || matchesLegacyTavernRelationshipSeed(relationship, legacyIndex)
      );
      if (!legacyFamily || String(relationship.generatedFrom || "").startsWith("tavern-calibrated-directional-seed")) {
        upgraded.push({ ...relationship, schemaVersion: Number(relationship.schemaVersion || 1) });
        continue;
      }
      const legacyVector = LEGACY_TAVERN_RELATIONSHIP_VECTORS[legacyIndex];
      const rebasedVector = Object.fromEntries(TAVERN_RELATIONSHIP_VECTOR_FIELDS.map((field) => {
        const accumulatedDelta = Number(relationship[field] || 0) - Number(legacyVector[field] || 0);
        return [field, clamp(Number(seed[field] || 0) + accumulatedDelta, 0, 100)];
      }));
      upgraded.push({
        ...relationship,
        schemaVersion: 1,
        generatedFrom: hasDynamicEvidence(relationship)
          ? "tavern-calibrated-directional-seed+preserved-history"
          : "tavern-calibrated-directional-seed",
        label: seed.label,
        ...rebasedVector,
        misreading: hasDynamicEvidence(relationship) && relationship.misreading ? relationship.misreading : seed.misreading,
        unspoken: hasDynamicEvidence(relationship) && relationship.unspoken ? relationship.unspoken : seed.unspoken,
        sourceSeedLabel: seed.sourceSeedLabel || relationship.label || "",
        sourceSeedPressure: seed.sourceSeedPressure || relationship.unspoken || "",
      });
    }
    for (const seed of calibrated) {
      const key = directionKey(seed.fromCharacterId, seed.toCharacterId);
      if (seen.has(key)) continue;
      seen.add(key);
      upgraded.push(deepClone(seed));
    }
    return upgraded;
  };
  target.relationships = upgradeRelationships(target.relationships || [], target.characters || []);
  target.branches = (target.branches || []).map((branch) => ({
    ...branch,
    snapshot: branch.snapshot ? {
      ...branch.snapshot,
      relationships: upgradeRelationships(
        branch.snapshot.relationships || [],
        branch.snapshot.characters?.length ? branch.snapshot.characters : target.characters || [],
      ),
    } : branch.snapshot,
  }));
  target.worldSetup = {
    ...(target.worldSetup || {}),
    tavernRelationshipDynamicsVersion: 1,
  };
  return target;
}

function migrateState(candidate, {
  freshRuntimeInstance = false,
  dropRuntimeTransport = false,
} = {}) {
  const next = deepClone(initialState);
  const suppliedRuntimeInstanceId = projectRuntimeInstanceId(candidate.project);
  const runtimeInstanceId = freshRuntimeInstance || !suppliedRuntimeInstanceId
    ? createRuntimeInstanceId()
    : suppliedRuntimeInstanceId;
  const preserveRuntimeTransport = !freshRuntimeInstance
    && !dropRuntimeTransport
    && Boolean(suppliedRuntimeInstanceId);
  const { branches: rawBranches, activeBranchId } = ensureBranch(candidate, next);
  const fallback = {
    characters: Array.isArray(candidate.characters) ? candidate.characters : next.characters,
    relationships: Array.isArray(candidate.relationships) ? candidate.relationships : next.relationships,
    storyRevisions: Array.isArray(candidate.storyRevisions) ? candidate.storyRevisions : next.storyRevisions,
    runtimeSessions: Array.isArray(candidate.runtimeSessions) ? candidate.runtimeSessions : [],
    runtimeObservations: Array.isArray(candidate.runtimeObservations) ? candidate.runtimeObservations : [],
    tavernState: candidate.tavernState && typeof candidate.tavernState === "object" ? candidate.tavernState : null,
  };
  const legacySource = {
    characters: Array.isArray(candidate.characters) ? candidate.characters : next.characters,
    relationships: Array.isArray(candidate.relationships) ? candidate.relationships : next.relationships,
    canonEvents: Array.isArray(candidate.canonEvents) ? candidate.canonEvents : next.canonEvents,
    draftScenes: Array.isArray(candidate.draftScenes) ? candidate.draftScenes : next.draftScenes,
    rumors: Array.isArray(candidate.rumors) ? candidate.rumors : next.rumors,
    evidence: Array.isArray(candidate.evidence) ? candidate.evidence : next.evidence,
    secrets: Array.isArray(candidate.secrets) ? candidate.secrets : next.secrets,
    characterMemories: Array.isArray(candidate.characterMemories) ? candidate.characterMemories : next.characterMemories,
    characterPlans: Array.isArray(candidate.characterPlans) ? candidate.characterPlans : next.characterPlans,
    townStateLedger: Array.isArray(candidate.townStateLedger) ? candidate.townStateLedger : [],
    interventions: Array.isArray(candidate.interventions) ? candidate.interventions : [],
    stateChangeReasons: Array.isArray(candidate.stateChangeReasons) ? candidate.stateChangeReasons : [],
    storyRevisions: Array.isArray(candidate.storyRevisions) ? candidate.storyRevisions : [],
    runtimeSessions: Array.isArray(candidate.runtimeSessions) ? candidate.runtimeSessions : [],
    runtimeObservations: Array.isArray(candidate.runtimeObservations) ? candidate.runtimeObservations : [],
    replayMarkers: Array.isArray(candidate.replayMarkers) ? candidate.replayMarkers : [],
    irreversibleTraces: Array.isArray(candidate.irreversibleTraces) ? candidate.irreversibleTraces : next.irreversibleTraces,
    tavernState: candidate.tavernState && typeof candidate.tavernState === "object" ? candidate.tavernState : null,
  };

  const branches = rawBranches.map((branch) => {
    const rawSnapshot = branch.snapshot;
    const snapshot = rawSnapshot
      ? normalizeSnapshot(rawSnapshot, fallback)
      : makeLegacyBranchSnapshot(legacySource, branch, activeBranchId);
    const coordinates = {
      projectId: cleanRuntimeText(candidate.project?.id || next.project?.id),
      branchId: branch.id,
      runtimeInstanceId,
    };
    const runtimeSource = branch.id === activeBranchId
      ? {
        ...branch,
        snapshot: rawSnapshot,
        runtimeSessions: branch.runtimeClientState?.sessions || candidate.runtimeSessions,
        runtimeObservations: branch.runtimeClientState?.observations || candidate.runtimeObservations,
      }
      : { ...branch, snapshot: rawSnapshot };
    const runtimeClientState = normalizeBranchRuntimeClientState(runtimeSource, coordinates, {
      preserve: preserveRuntimeTransport,
    });
    const ids = snapshotIds(snapshot);
    return {
      ...branch,
      stateMode: "isolated",
      snapshotSchemaVersion: 2,
      runtimeClientStateVersion: 1,
      runtimeClientState,
      canonEventIds: ids.canonEventIds,
      draftSceneIds: ids.draftSceneIds,
      snapshot,
      note: branch.note || "独立分支快照。切换分支会恢复该线的人物状态、关系、正史、草稿、谣言、证据和不可逆痕迹。",
    };
  });

  const activeBranch = branches.find((branch) => branch.id === activeBranchId) || branches[0];
  const activeSnapshot = activeBranch?.snapshot || getBranchSnapshot(next);
  const merged = {
    ...next,
    ...candidate,
    runtimeSessions: deepClone(activeBranch?.runtimeClientState?.sessions || []),
    runtimeObservations: deepClone(activeBranch?.runtimeClientState?.observations || []),
    project: {
      ...withRuntimeInstance({ ...next.project, ...candidate.project }, runtimeInstanceId),
      activeBranchId: activeBranch?.id || activeBranchId,
      branchIds: branches.map((branch) => branch.id),
      characterIds: (activeSnapshot.characters || []).map((character) => character.id),
      canonEventIds: (activeSnapshot.canonEvents || []).map((event) => event.id),
      draftSceneIds: (activeSnapshot.draftScenes || []).map((draft) => draft.id),
    },
    town: { ...next.town, ...candidate.town },
    worldSetup: mergeWorldSetup(candidate.worldSetup, next.worldSetup),
    ui: {
      ...next.ui,
      ...candidate.ui,
      activeBranchId: activeBranch?.id || activeBranchId,
      engineMode: normalizeEngineMode(candidate.ui?.engineMode),
      npcActivitySpeed: candidate.ui?.npcActivitySpeed === "fast" ? "fast" : "normal",
      lastDraftId: activeSnapshot.draftScenes?.[0]?.id || null,
      partialAcceptance: { ...next.ui.partialAcceptance, ...(candidate.ui?.partialAcceptance || {}) },
      timelineCharacterId: candidate.ui?.timelineCharacterId || activeSnapshot.characters?.[0]?.id || null,
      timelinePairFromId: candidate.ui?.timelinePairFromId || activeSnapshot.characters?.[0]?.id || null,
      timelinePairToId: candidate.ui?.timelinePairToId || activeSnapshot.characters?.[1]?.id || activeSnapshot.characters?.[0]?.id || null,
      timelineEventId: candidate.ui?.timelineEventId || activeSnapshot.canonEvents?.[0]?.id || null,
      memoryCharacterId: candidate.ui?.memoryCharacterId || activeSnapshot.characters?.[0]?.id || null,
      planCharacterId: candidate.ui?.planCharacterId || candidate.ui?.selectedCharacterId || activeSnapshot.characters?.[0]?.id || null,
      selectedPlanId: candidate.ui?.selectedPlanId || activeSnapshot.characterPlans?.[0]?.id || null,
      graphFocusCharacterId: candidate.ui?.graphFocusCharacterId || candidate.ui?.memoryCharacterId || activeSnapshot.characters?.[0]?.id || null,
      storyWorkspace: {
        ...next.ui.storyWorkspace,
        ...(candidate.ui?.storyWorkspace || {}),
      },
      planDraft: {
        characterId: candidate.ui?.planDraft?.characterId || candidate.ui?.planCharacterId || activeSnapshot.characters?.[0]?.id || null,
        targetCharacterId: candidate.ui?.planDraft?.targetCharacterId || activeSnapshot.characters?.[1]?.id || activeSnapshot.characters?.[0]?.id || null,
        mode: candidate.ui?.planDraft?.mode || "seize_narrative",
        shortTerm: candidate.ui?.planDraft?.shortTerm || "",
        midTermCover: candidate.ui?.planDraft?.midTermCover || "",
        longTermSelfMyth: candidate.ui?.planDraft?.longTermSelfMyth || "",
        operatorNote: candidate.ui?.planDraft?.operatorNote || "",
        priority: Number(candidate.ui?.planDraft?.priority ?? 70),
        heat: Number(candidate.ui?.planDraft?.heat ?? 66),
        locked: Boolean(candidate.ui?.planDraft?.locked || false),
      },
      memoryDraft: {
        characterId: candidate.ui?.memoryDraft?.characterId || activeSnapshot.characters?.[0]?.id || null,
        targetCharacterId: candidate.ui?.memoryDraft?.targetCharacterId || activeSnapshot.characters?.[1]?.id || activeSnapshot.characters?.[0]?.id || null,
        type: candidate.ui?.memoryDraft?.type || "selective",
        stance: candidate.ui?.memoryDraft?.stance || "self_defense",
        content: candidate.ui?.memoryDraft?.content || "",
        publicVersion: candidate.ui?.memoryDraft?.publicVersion || "",
        privateVersion: candidate.ui?.memoryDraft?.privateVersion || "",
        distortion: candidate.ui?.memoryDraft?.distortion || "",
        reliability: Number(candidate.ui?.memoryDraft?.reliability ?? 55),
        heat: Number(candidate.ui?.memoryDraft?.heat ?? 60),
        locked: Boolean(candidate.ui?.memoryDraft?.locked || false),
      },
      interventionDraft: {
        type: "lock_motivation",
        targetCharacterId: activeSnapshot.characters?.[0]?.id || null,
        secondaryCharacterId: activeSnapshot.characters?.[1]?.id || null,
        intensity: 60,
        instruction: "",
        ...((candidate.ui && candidate.ui.interventionDraft) || {}),
      },
    },
    branches,
    storyRevisions: deepClone(Array.isArray(candidate.storyRevisions) ? candidate.storyRevisions : next.storyRevisions),
    ...deepClone(activeSnapshot),
  };
  migrateGeneratedPsychologyNeeds(merged);
  migrateGeneratedPerformanceSeeds(merged);
  migrateXiaoyaoyouToTavernLife(merged);
  migrateTavernAgentRuntimeV3(merged);
  migrateTavernAgentRuntimeV4(merged);
  migrateTavernAgentRuntimeV5(merged);
  migrateTavernAgentRuntimeV6(merged);
  migrateTavernAgentRuntimeV7(merged);
  migrateTavernAgentRuntimeV8(merged);
  migrateTavernAgentRuntimeV9(merged);
  migrateTavernMaterialEconomyV10(merged);
  migrateTavernCultivationSustenanceV11(merged);
  migrateCharacterAgentMemoryV1(merged);
  migrateTavernObjectLedgerV1(merged);
  migrateTavernObjectLedgerV2(merged);
  migrateTavernObjectLedgerV3(merged);
  migrateTavernEcologyV1(merged);
  migrateTavernRelationshipDynamicsV1(merged);
  merged.characterPlans = ensureCharacterPlans(merged);
  merged.branches = (merged.branches || []).map((branch) => {
    const snapshot = branch.snapshot || {};
    const characterPlans = ensureCharacterPlans({ ...merged, ...snapshot, ui: { ...merged.ui, activeBranchId: branch.id }, project: { ...merged.project, activeBranchId: branch.id } });
    return {
      ...branch,
      runtimeClientStateVersion: 1,
      snapshot: withoutRuntimeTransport({ ...snapshot, characterPlans }),
      runtimeClientState: preserveRuntimeTransport
        ? deepClone(branch.runtimeClientState || emptyRuntimeClientState())
        : emptyRuntimeClientState(),
    };
  });
  const migratedActiveBranch = merged.branches.find((branch) => branch.id === (merged.ui.activeBranchId || merged.project.activeBranchId))
    || merged.branches[0];
  merged.runtimeSessions = deepClone(migratedActiveBranch?.runtimeClientState?.sessions || []);
  merged.runtimeObservations = deepClone(migratedActiveBranch?.runtimeClientState?.observations || []);
  if (preserveRuntimeTransport && !merged.runtimeObservations.length && candidate.ui?.v27Observation) {
    const legacySessionId = cleanRuntimeText(candidate.ui.v27Observation?.sessionRef?.sessionId);
    const matchingSession = merged.runtimeSessions.find((row) => (
      row.sessionId && row.sessionId === legacySessionId && isV27RuntimeId(row.runtimeId)
    ));
    const legacyObservation = normalizeRuntimeObservationRow({
      runtimeId: matchingSession?.runtimeId,
      observation: candidate.ui.v27Observation,
    }, {
      projectId: merged.project.id,
      branchId: merged.ui.activeBranchId || merged.project.activeBranchId,
      runtimeInstanceId,
    });
    if (matchingSession && legacyObservation) merged.runtimeObservations = [legacyObservation];
  }
  merged.ui.v27Observation = v27ObservationFromRows(merged.runtimeObservations, runtimeInstanceId);
  merged.ui.v27Running = false;
  merged.ui.npcActivityRunning = false;
  merged.ui.npcActivityStatus = "stopped";
  merged.branches = merged.branches.map((branch) => branch.id === (merged.ui.activeBranchId || merged.project.activeBranchId)
    ? {
      ...branch,
      runtimeClientState: {
        schemaVersion: 1,
        sessions: deepClone(merged.runtimeSessions),
        observations: deepClone(merged.runtimeObservations),
      },
    }
    : branch);
  return normalizeActiveSelections(merged);
}

function normalizeActiveSelections(target = state) {
  const characters = target.characters || [];
  const characterIds = new Set(characters.map((character) => character.id));
  if (!characterIds.has(target.ui.selectedCharacterId)) {
    target.ui.selectedCharacterId = characters[0]?.id || null;
  }
  if (!characterIds.has(target.ui.memoryCharacterId)) {
    target.ui.memoryCharacterId = target.ui.selectedCharacterId || characters[0]?.id || null;
  }
  if (!characterIds.has(target.ui.planCharacterId)) {
    target.ui.planCharacterId = target.ui.selectedCharacterId || characters[0]?.id || null;
  }
  if (!characterIds.has(target.ui.graphFocusCharacterId)) {
    target.ui.graphFocusCharacterId = target.ui.memoryCharacterId || characters[0]?.id || null;
  }
  if (!characterIds.has(target.ui.planCharacterId)) {
    target.ui.planCharacterId = target.ui.memoryCharacterId || characters[0]?.id || null;
  }
  target.ui.planDraft = { ...(target.ui.planDraft || {}), characterId: target.ui.planCharacterId || characters[0]?.id || null };
  target.ui.memoryDraft = { ...(target.ui.memoryDraft || {}), characterId: target.ui.memoryCharacterId || characters[0]?.id || null };
  target.ui.planDraft = { ...(target.ui.planDraft || {}), characterId: target.ui.planCharacterId || characters[0]?.id || null };
  if (!target.characterPlans?.some((plan) => plan.id === target.ui.selectedPlanId)) {
    target.ui.selectedPlanId = target.characterPlans?.find((plan) => plan.characterId === target.ui.planCharacterId)?.id || target.characterPlans?.[0]?.id || null;
  }
  const activeIds = (target.ui.activeCharacterIds || []).filter((id) => characterIds.has(id));
  target.ui.activeCharacterIds = activeIds.length ? activeIds : characters.slice(0, 2).map((character) => character.id);
  if (!target.locations?.some((location) => location.id === target.ui.selectedLocationId)) {
    target.ui.selectedLocationId = target.locations?.[0]?.id || null;
  }
  if (!["world", "characters", "launch"].includes(target.ui.setupStep)) {
    target.ui.setupStep = "world";
  }
  if (target.ui.setupFlowVersion !== SETUP_FLOW_VERSION) {
    target.ui.setupFlowVersion = SETUP_FLOW_VERSION;
    target.ui.setupCompleted = false;
    target.ui.setupStep = "world";
    target.ui.setupWorldPrompt = "";
    target.ui.setupPeoplePrompt = "";
  }
  target.ui.setupCompleted = target.ui.setupCompleted === true;
  if (!target.ui.setupCompleted) {
    target.ui.activeTab = "setup";
  }
  if (!["ambient", "location"].includes(target.ui.focusMode)) {
    target.ui.focusMode = "ambient";
  }
  if (target.worldSetup?.fixedStage) {
    target.ui.focusMode = "location";
    target.ui.selectedLocationId = target.locations?.[0]?.id || target.ui.selectedLocationId || null;
  }
  refreshProjectLists(target);
  return target;
}

function refreshProjectLists(target = state) {
  target.project.characterIds = (target.characters || []).map((character) => character.id);
  target.project.canonEventIds = (target.canonEvents || []).map((event) => event.id);
  target.project.draftSceneIds = (target.draftScenes || []).map((draft) => draft.id);
  target.project.branchIds = (target.branches || []).map((branch) => branch.id);
}

function persistActiveBranchSnapshot() {
  const activeBranchId = state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
  const snapshot = getBranchSnapshot(state);
  const ids = snapshotIds(snapshot);
  state.branches = (state.branches || []).map((branch) => branch.id === activeBranchId
    ? {
      ...branch,
      stateMode: "isolated",
      snapshotSchemaVersion: 2,
      runtimeClientStateVersion: 1,
      snapshot,
      runtimeClientState: {
        schemaVersion: 1,
        sessions: deepClone(state.runtimeSessions || []),
        observations: deepClone(state.runtimeObservations || []),
      },
      canonEventIds: ids.canonEventIds,
      draftSceneIds: ids.draftSceneIds,
      updatedAt: new Date().toISOString(),
    }
    : branch);
}

function sliceList(value, limit) {
  return Array.isArray(value) ? deepClone(value.slice(0, limit)) : [];
}

function compactBranchForLocalPersistence(branch = {}, activeBranchId = "", { draftLimit = 2, observerLimit = 24 } = {}) {
  if (branch.id === activeBranchId) {
    // The active branch is already represented by the top-level state. On
    // reload migrateState rebuilds its snapshot, so storing it twice only
    // wastes the browser quota.
    return { ...deepClone(branch), snapshot: null };
  }
  if (!branch.snapshot || typeof branch.snapshot !== "object") return deepClone(branch);
  const snapshot = branch.snapshot;
  return {
    ...deepClone(branch),
    snapshot: {
      ...deepClone(snapshot),
      canonEvents: compactCanonEventsForSnapshot(snapshot.canonEvents || []).slice(0, 80),
      draftScenes: compactDraftScenesForSnapshot(snapshot.draftScenes || [], { limit: draftLimit, observerLimit }),
      characterMemories: sliceList(snapshot.characterMemories, 120),
      townStateLedger: sliceList(snapshot.townStateLedger, 160),
      stateChangeReasons: sliceList(snapshot.stateChangeReasons, 120),
      irreversibleTraces: sliceList(snapshot.irreversibleTraces, 80),
      replayMarkers: sliceList(snapshot.replayMarkers, 80),
      storyRevisions: sliceList(snapshot.storyRevisions, 24),
      tavernState: compactTavernStateForSnapshot(snapshot.tavernState),
    },
  };
}

export function buildLocalPersistenceState(source = {}, {
  draftLimit = 6,
  observerLimit = 36,
  inactiveBranchDraftLimit = 2,
} = {}) {
  const activeBranchId = source.ui?.activeBranchId || source.project?.activeBranchId || "branch_main";
  const compact = {
    ...deepClone(source),
    canonEvents: compactCanonEventsForSnapshot(source.canonEvents || []).slice(0, 80),
    draftScenes: compactDraftScenesForSnapshot(source.draftScenes || [], { limit: draftLimit, observerLimit }),
    characterMemories: sliceList(source.characterMemories, 160),
    townStateLedger: sliceList(source.townStateLedger, 160),
    stateChangeReasons: sliceList(source.stateChangeReasons, 120),
    irreversibleTraces: sliceList(source.irreversibleTraces, 80),
    replayMarkers: sliceList(source.replayMarkers, 80),
    rumors: sliceList(source.rumors, 120),
    evidence: sliceList(source.evidence, 120),
    secrets: sliceList(source.secrets, 80),
    storyRevisions: sliceList(source.storyRevisions, 24),
    tavernState: compactTavernStateForSnapshot(source.tavernState),
    branches: (source.branches || []).map((branch) => compactBranchForLocalPersistence(branch, activeBranchId, {
      draftLimit: inactiveBranchDraftLimit,
      observerLimit: Math.min(observerLimit, 24),
    })),
    ui: {
      ...(source.ui || {}),
      livePerformance: null,
      lastPlayError: "",
      v27Running: false,
      npcActivityRunning: false,
      npcActivityStatus: "stopped",
    },
  };
  delete compact.ui.saveSlots;
  delete compact.ui.saveSlotsStatus;
  delete compact.ui.saveNameDraft;
  return compact;
}

function restoreBranchSnapshot(branch) {
  const snapshot = normalizeSnapshot(branch.snapshot || emptySnapshot(), {
    characters: state.characters || [],
    relationships: state.relationships || [],
  });
  state.characters = deepClone(snapshot.characters);
  state.relationships = deepClone(snapshot.relationships);
  state.canonEvents = deepClone(snapshot.canonEvents);
  state.draftScenes = deepClone(snapshot.draftScenes);
  state.rumors = deepClone(snapshot.rumors);
  state.evidence = deepClone(snapshot.evidence);
  state.secrets = deepClone(snapshot.secrets);
  state.characterMemories = deepClone(snapshot.characterMemories || []);
  state.characterPlans = ensureCharacterPlans({ ...state, ...snapshot });
  state.townStateLedger = deepClone(snapshot.townStateLedger || []);
  state.interventions = deepClone(snapshot.interventions || []);
  state.stateChangeReasons = deepClone(snapshot.stateChangeReasons || []);
  state.replayMarkers = deepClone(snapshot.replayMarkers || []);
  state.irreversibleTraces = deepClone(snapshot.irreversibleTraces);
  state.storyRevisions = deepClone(snapshot.storyRevisions || []);
  state.runtimeSessions = deepClone(branch.runtimeClientState?.sessions || []);
  state.runtimeObservations = deepClone(branch.runtimeClientState?.observations || []);
  state.ui.v27Observation = v27ObservationFromRows(
    state.runtimeObservations,
    projectRuntimeInstanceId(state.project),
  );
  state.ui.v27Running = false;
  state.ui.npcActivityRunning = false;
  state.ui.npcActivityStatus = "stopped";
  state.tavernState = snapshot.tavernState && typeof snapshot.tavernState === "object"
    ? deepClone(snapshot.tavernState)
    : state.tavernState || null;
  state.ui.lastDraftId = state.draftScenes[0]?.id || null;
  const latestStory = state.storyRevisions[0] || null;
  state.ui.storyWorkspace = latestStory
    ? {
      ...(state.ui.storyWorkspace || {}),
      sourceDraftId: latestStory.sourceDraftId,
      activeRevisionId: latestStory.id,
      title: latestStory.title,
      sourceText: latestStory.sourceText,
      rewriteText: latestStory.text,
      mode: latestStory.mode,
      status: "saved",
    }
    : {
      ...(state.ui.storyWorkspace || {}),
      sourceDraftId: state.ui.lastDraftId,
      activeRevisionId: null,
      title: "",
      sourceText: "",
      rewriteText: "",
      status: "idle",
    };
  refreshProjectLists();
  normalizeActiveSelections();
}

function persist() {
  persistActiveBranchSnapshot();
  state.project.updatedAt = new Date().toISOString();
  const tiers = [
    { draftLimit: 6, observerLimit: 36, inactiveBranchDraftLimit: 2 },
    { draftLimit: 3, observerLimit: 24, inactiveBranchDraftLimit: 1 },
    { draftLimit: 1, observerLimit: 12, inactiveBranchDraftLimit: 0 },
    { draftLimit: 0, observerLimit: 0, inactiveBranchDraftLimit: 0 },
  ];
  const softCharacterLimit = 1_800_000;
  let lastError = null;
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index];
    try {
      const payload = JSON.stringify(buildLocalPersistenceState(state, tier));
      if (payload.length > softCharacterLimit && index < tiers.length - 1) continue;
      storageSet(STORAGE_KEY, payload);
      return;
    } catch (error) {
      lastError = error;
      if (error?.name !== "QuotaExceededError" && !/quota/i.test(String(error?.message || ""))) throw error;
    }
  }
  throw lastError || new Error("无法写入本地状态");
}

function emit() {
  persist();
  const snapshot = getState();
  listeners.forEach((listener) => listener(snapshot));
}

export function getState() {
  return deepClone(state);
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetState() {
  state = migrateState(deepClone(initialState), {
    freshRuntimeInstance: true,
    dropRuntimeTransport: true,
  });
  emit();
}

export function importState(jsonText, { preserveRuntimeIdentity = false } = {}) {
  const parsed = JSON.parse(jsonText);
  state = migrateState(parsed, {
    freshRuntimeInstance: !preserveRuntimeIdentity,
    dropRuntimeTransport: !preserveRuntimeIdentity,
  });
  emit();
}

// The active branch's snapshot duplicates the top-level state, and `importState`
// rebuilds it during migration.  That makes dropping it tempting once a causal
// day carries many impacts, memories and Agent decisions.  It is not the
// default, though: an export is also read directly — by diff tools, archives and
// people — and there the branch the author was standing in would be the one
// branch with no content of its own.
//
// Lossless by default; `{ compact: true }` opts into the smaller, lossy form and
// labels it so a reader can tell.
export function exportState({ compact = false } = {}) {
  persistActiveBranchSnapshot();
  if (!compact) {
    return JSON.stringify(deepClone(state), null, 2);
  }
  const activeBranchId = state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
  const exported = {
    ...deepClone(state),
    activeBranchSnapshotOmitted: true,
    branches: (state.branches || []).map((branch) => (
      branch.id === activeBranchId ? { ...deepClone(branch), snapshot: null } : deepClone(branch)
    )),
  };
  return JSON.stringify(exported, null, 2);
}

export function setUi(patch) {
  if (patch.activeBranchId && patch.activeBranchId !== state.ui.activeBranchId) {
    setActiveBranch(patch.activeBranchId);
    return;
  }
  const { v27Observation: _derivedRuntimeObservation, ...safePatch } = patch || {};
  state.ui = {
    ...state.ui,
    ...safePatch,
    // Public runtime observation is a projection of the active branch ledger.
    // It is never an independent UI-owned truth that a generic patch can
    // overwrite or carry across branches.
    v27Observation: v27ObservationFromRows(
      state.runtimeObservations,
      projectRuntimeInstanceId(state.project),
    ),
  };
  emit();
}

function runtimeRowMatchesCoordinates(row, runtimeId, coordinates) {
  return Boolean(row
    && row.runtimeId === runtimeId
    && row.projectId === coordinates.projectId
    && row.branchId === coordinates.branchId
    && row.runtimeInstanceId === coordinates.runtimeInstanceId);
}

function currentRuntimeSessionRow(runtimeId = "") {
  const id = cleanRuntimeText(runtimeId);
  const coordinates = runtimeCoordinates();
  return (state.runtimeSessions || []).find((row) => runtimeRowMatchesCoordinates(row, id, coordinates)) || null;
}

function assertRuntimeCoordinates(input = {}, runtimeId = "") {
  const coordinates = runtimeCoordinates();
  if (!coordinates.projectId || !coordinates.branchId || !coordinates.runtimeInstanceId) {
    throw new Error("当前世界缺少可持久运行的项目、分支或实例标识。");
  }
  const suppliedProjectId = cleanRuntimeText(input.projectId);
  const suppliedBranchId = cleanRuntimeText(input.branchId);
  const suppliedInstanceId = cleanRuntimeText(input.runtimeInstanceId);
  if ((suppliedProjectId && suppliedProjectId !== coordinates.projectId)
    || (suppliedBranchId && suppliedBranchId !== coordinates.branchId)
    || (suppliedInstanceId && suppliedInstanceId !== coordinates.runtimeInstanceId)) {
    throw new Error("运行会话引用不属于当前项目、分支或世界实例。");
  }
  const id = cleanRuntimeText(runtimeId || input.runtimeId);
  if (!id) throw new Error("运行会话引用必须包含 runtimeId。");
  if (id.startsWith(`${V27_RUNTIME_ID}:`)
    && id !== `${V27_RUNTIME_ID}:${coordinates.runtimeInstanceId}`) {
    throw new Error("v2.7 运行时标识不属于当前世界实例。");
  }
  return { ...coordinates, runtimeId: id };
}

function samePendingCommand(left, right) {
  return Boolean(left && right
    && left.commandId === right.commandId
    && left.operation === right.operation
    && left.expectedRevision === right.expectedRevision);
}

function buildRuntimeSessionRow(input = {}, { resolvedCommandId = "" } = {}) {
  const coordinates = assertRuntimeCoordinates(input, input.runtimeId);
  const existing = currentRuntimeSessionRow(coordinates.runtimeId);
  const hasPendingInput = Object.hasOwn(input, "pendingCommand");
  const incomingPending = hasPendingInput
    ? normalizePendingRuntimeCommand(input.pendingCommand, { strict: input.pendingCommand != null })
    : null;
  const resolvedId = cleanRuntimeText(resolvedCommandId);

  if (existing?.pendingCommand) {
    if (resolvedId) {
      if (resolvedId !== existing.pendingCommand.commandId) {
        throw new Error("返回的命令号不能结算当前待决运行命令。");
      }
      if (incomingPending) {
        throw new Error("结算待决命令时不能同时写入另一条待决命令。");
      }
    } else if (!incomingPending || !samePendingCommand(existing.pendingCommand, incomingPending)) {
      throw new Error("当前仍有未完成的待决命令；只有相同命令或匹配的返回命令号可以继续。");
    }
  } else if (resolvedId && existing) {
    // A duplicate response may arrive after the matching command was already
    // committed. Monotonic cursor and session checks below make that replay
    // harmless, while refusing it outright would strand the client after a
    // response race.
  }

  if (incomingPending && !existing?.pendingCommand) {
    if (incomingPending.operation === "start") {
      if (existing?.sessionId || incomingPending.expectedRevision !== 0) {
        throw new Error("start 待决命令只能从尚未建立的零版本会话开始。");
      }
    } else {
      if (!existing?.sessionId) throw new Error("continue/reset 待决命令需要已有会话。");
      if (incomingPending.expectedRevision !== existing.sessionRevision) {
        throw new Error("待决命令的 expectedRevision 与当前会话版本不一致。");
      }
    }
  }

  const suppliedSessionId = Object.hasOwn(input, "sessionId") ? cleanRuntimeText(input.sessionId) : "";
  if (existing?.sessionId && suppliedSessionId && suppliedSessionId !== existing.sessionId) {
    throw new Error("不能用同一运行引用覆盖另一个 server session 会话。");
  }
  const sessionId = suppliedSessionId || existing?.sessionId || "";
  const sessionRevision = Object.hasOwn(input, "sessionRevision")
    ? Number(input.sessionRevision)
    : Number(existing?.sessionRevision || 0);
  const worldVersion = Object.hasOwn(input, "worldVersion")
    ? Number(input.worldVersion)
    : Number(existing?.worldVersion || 0);
  if (!Number.isInteger(sessionRevision) || sessionRevision < 0
    || !Number.isInteger(worldVersion) || worldVersion < 0) {
    throw new Error("运行会话 revision 与世界版本必须是非负整数。");
  }
  if (existing && sessionRevision < existing.sessionRevision) {
    throw new Error("运行会话 revision 不能回退。");
  }
  if (existing && worldVersion < existing.worldVersion) {
    throw new Error("世界版本不能回退。");
  }
  const advancesCursor = Boolean(existing
    && (sessionRevision > existing.sessionRevision || worldVersion > existing.worldVersion));
  if (advancesCursor && !existing.pendingCommand) {
    throw new Error("运行游标只能由当前待决命令的执行或恢复结果推进。");
  }

  const pendingCommand = resolvedId
    ? null
    : incomingPending || existing?.pendingCommand || null;
  const row = normalizeRuntimeSessionRow({
    ...coordinates,
    sessionId,
    sessionRevision,
    worldVersion,
    pendingCommand,
    updatedAt: cleanRuntimeText(input.updatedAt) || new Date().toISOString(),
  }, coordinates, { strict: true });
  if (!row) throw new Error("运行会话引用需要 sessionId 或待决命令。");
  return row;
}

function replaceRuntimeSessionRow(row) {
  const coordinates = runtimeCoordinates();
  state.runtimeSessions = [
    ...(state.runtimeSessions || []).filter((item) => !runtimeRowMatchesCoordinates(
      item,
      row.runtimeId,
      coordinates,
    )),
    row,
  ];
}

function buildRuntimeObservationRow(runtimeId, observation, sessionRow = null) {
  const coordinates = assertRuntimeCoordinates({}, runtimeId);
  const currentSession = sessionRow || currentRuntimeSessionRow(runtimeId);
  if (!currentSession?.sessionId) {
    throw new Error("公开运行观察必须来自当前分支已经建立的 server session。");
  }
  const sourceRef = observation?.sessionRef;
  if (!sourceRef?.sessionId) throw new Error("公开运行观察缺少来源会话。");
  if (cleanRuntimeText(sourceRef.runtimeId) && cleanRuntimeText(sourceRef.runtimeId) !== runtimeId) {
    throw new Error("公开运行观察不属于当前 runtimeId。");
  }
  if (cleanRuntimeText(sourceRef.projectId) && cleanRuntimeText(sourceRef.projectId) !== coordinates.projectId) {
    throw new Error("公开运行观察不属于当前项目。");
  }
  if (cleanRuntimeText(sourceRef.branchId) && cleanRuntimeText(sourceRef.branchId) !== coordinates.branchId) {
    throw new Error("公开运行观察不属于当前分支。");
  }
  if (cleanRuntimeText(sourceRef.sessionId) !== currentSession.sessionId) {
    throw new Error("公开运行观察不属于当前 server session。");
  }
  const sourceRevision = Number(sourceRef.sessionRevision);
  const sourceWorldVersion = Number(sourceRef.worldVersion ?? observation?.worldVersion);
  if (!Number.isInteger(sourceRevision) || sourceRevision !== currentSession.sessionRevision) {
    throw new Error("公开运行观察的 session revision 与当前游标不一致。");
  }
  if (!Number.isInteger(sourceWorldVersion) || sourceWorldVersion !== currentSession.worldVersion) {
    throw new Error("公开运行观察的世界版本与当前游标不一致。");
  }
  const sanitized = publicRuntimeObservation({
    ...observation,
    worldVersion: currentSession.worldVersion,
    sessionRef: {
      runtimeId,
      projectId: coordinates.projectId,
      branchId: coordinates.branchId,
      sessionId: currentSession.sessionId,
      sessionRevision: currentSession.sessionRevision,
      worldVersion: currentSession.worldVersion,
    },
  });
  return normalizeRuntimeObservationRow({
    ...coordinates,
    runtimeId,
    observation: sanitized,
    updatedAt: new Date().toISOString(),
  }, coordinates);
}

function replaceRuntimeObservationRow(row) {
  const coordinates = runtimeCoordinates();
  state.runtimeObservations = [
    ...(state.runtimeObservations || []).filter((item) => !(
      item.runtimeId === row.runtimeId
      && item.projectId === coordinates.projectId
      && item.branchId === coordinates.branchId
      && item.runtimeInstanceId === coordinates.runtimeInstanceId
    )),
    row,
  ];
  state.ui.v27Observation = v27ObservationFromRows(
    state.runtimeObservations,
    coordinates.runtimeInstanceId,
  );
}

export function getRuntimeSessionRef(runtimeId = "") {
  const id = cleanRuntimeText(runtimeId);
  if (!id) return null;
  const row = currentRuntimeSessionRow(id);
  return row ? deepClone(row) : null;
}

export function setRuntimeSessionRef(input = {}, options = {}) {
  const row = buildRuntimeSessionRow(input, options);
  replaceRuntimeSessionRow(row);
  emit();
  return deepClone(row);
}

export function clearRuntimeSessionRef(runtimeId = "") {
  const id = cleanRuntimeText(runtimeId);
  if (!id) return;
  const coordinates = runtimeCoordinates();
  state.runtimeSessions = (state.runtimeSessions || []).filter((item) => !runtimeRowMatchesCoordinates(
    item,
    id,
    coordinates,
  ));
  state.runtimeObservations = (state.runtimeObservations || []).filter((item) => !(
    item.runtimeId === id
    && item.projectId === coordinates.projectId
    && item.branchId === coordinates.branchId
    && item.runtimeInstanceId === coordinates.runtimeInstanceId
  ));
  state.ui.v27Observation = v27ObservationFromRows(
    state.runtimeObservations,
    coordinates.runtimeInstanceId,
  );
  emit();
}

export function getRuntimeObservation(runtimeId = "") {
  const id = cleanRuntimeText(runtimeId);
  if (!id) return null;
  const coordinates = runtimeCoordinates();
  const row = (state.runtimeObservations || []).find((item) => (
    item.runtimeId === id
    && item.projectId === coordinates.projectId
    && item.branchId === coordinates.branchId
    && item.runtimeInstanceId === coordinates.runtimeInstanceId
  ));
  return row ? deepClone(row.observation) : null;
}

export function setRuntimeObservation(runtimeId = "", observation = null) {
  const row = buildRuntimeObservationRow(cleanRuntimeText(runtimeId), observation);
  replaceRuntimeObservationRow(row);
  emit();
  return deepClone(row.observation);
}

export function commitRuntimeSessionResult(runtimeId, commandId, sessionRef, observation) {
  const id = cleanRuntimeText(runtimeId);
  if (!id || id !== cleanRuntimeText(sessionRef?.runtimeId)) {
    throw new Error("原子运行提交的 runtimeId 与 server session 引用不一致。");
  }
  // Both rows are fully validated before either active projection changes.
  const sessionRow = buildRuntimeSessionRow(sessionRef, { resolvedCommandId: commandId });
  const observationRow = buildRuntimeObservationRow(id, observation, sessionRow);
  replaceRuntimeSessionRow(sessionRow);
  replaceRuntimeObservationRow(observationRow);
  emit();
  return {
    sessionRef: deepClone(sessionRow),
    observation: deepClone(observationRow.observation),
  };
}

export function setTransientUi(patch) {
  const { v27Observation: _derivedRuntimeObservation, ...safePatch } = patch || {};
  state.ui = { ...state.ui, ...safePatch };
  const snapshot = { ...state, ui: { ...state.ui } };
  listeners.forEach((listener) => listener(snapshot));
}

export function updateWorldSetup(patch) {
  state.worldSetup = { ...(state.worldSetup || {}), ...patch };
  emit();
}

export function applySetupWorld({ setupWorldPrompt = "", setupPeoplePrompt = "" } = {}) {
  const generated = buildPlayableWorldFromSetup({ setupWorldPrompt, setupPeoplePrompt });
  return applyGeneratedSetupWorld(generated, { setupWorldPrompt, setupPeoplePrompt });
}

export function applyGeneratedSetupWorld(generated, { setupWorldPrompt = "", setupPeoplePrompt = "" } = {}) {
  const previousUi = state.ui || {};
  const runtimeInstanceId = createRuntimeInstanceId();
  const branch = {
    id: "branch_main",
    projectId: generated.project.id,
    title: "主线",
    parentBranchId: null,
    forkedFromDraftId: null,
    forkedFromCanonEventId: null,
    createdAt: new Date().toISOString(),
    canonEventIds: [],
    draftSceneIds: [],
    stateMode: "isolated",
    snapshotSchemaVersion: 2,
    runtimeClientStateVersion: 1,
    snapshot: emptySnapshot(),
    runtimeClientState: emptyRuntimeClientState(),
    note: "由建构对话生成的新世界主线。",
  };
  state = normalizeActiveSelections({
    ...state,
    project: withRuntimeInstance({
      ...generated.project,
      branchIds: [branch.id],
      activeBranchId: branch.id,
      canonEventIds: [],
      draftSceneIds: [],
    }, runtimeInstanceId),
    town: generated.town,
    worldSetup: generated.worldSetup,
    characters: generated.characters,
    locations: generated.locations,
    relationships: generated.relationships,
    branches: [branch],
    canonEvents: generated.canonEvents,
    draftScenes: generated.draftScenes,
    rumors: generated.rumors,
    evidence: generated.evidence,
    secrets: generated.secrets,
    irreversibleTraces: generated.irreversibleTraces,
    characterMemories: generated.characterMemories,
    characterPlans: generated.characterPlans,
    townStateLedger: generated.townStateLedger || [],
    interventions: generated.interventions,
    stateChangeReasons: generated.stateChangeReasons,
    tavernState: generated.tavernState || null,
    storyRevisions: [],
    runtimeSessions: [],
    runtimeObservations: [],
    ui: {
      ...previousUi,
      ...generated.ui,
      setupFlowVersion: SETUP_FLOW_VERSION,
      setupWorldPrompt,
      setupPeoplePrompt,
      setupCompleted: true,
      activeTab: "observe",
      activeBranchId: branch.id,
      detailMode: previousUi.detailMode || "scene",
      engineMode: generated.worldSetup?.fixedStage ? "openai" : normalizeEngineMode(previousUi.engineMode),
      partialAcceptance: previousUi.partialAcceptance || initialState.ui.partialAcceptance,
      v27Observation: null,
      v27Running: false,
      npcActivityRunning: false,
      npcActivityStatus: "stopped",
    },
  });
  state.characterPlans = ensureCharacterPlans(state);
  emit();
  return getState();
}

export function setPartialAcceptance(key, value) {
  state.ui.partialAcceptance = { ...state.ui.partialAcceptance, [key]: Boolean(value) };
  emit();
}

export function setActiveTab(tab) {
  state.ui.activeTab = tab;
  emit();
}

export function beginNewWorldSetup() {
  const currentTab = state.ui?.activeTab || "reality";
  const returnTab = currentTab === "setup"
    ? state.ui?.setupReturnTab || "reality"
    : currentTab;
  state.ui = {
    ...state.ui,
    activeTab: "setup",
    setupStep: "world",
    setupWorldPrompt: "",
    setupPeoplePrompt: "",
    setupReturnTab: returnTab,
  };
  emit();
}

export function cancelNewWorldSetup() {
  if (!state.ui?.setupCompleted) return;
  const returnTab = state.ui?.setupReturnTab;
  state.ui = {
    ...state.ui,
    activeTab: returnTab && returnTab !== "setup" ? returnTab : "reality",
  };
  emit();
}

function buildStorySourceText(draft) {
  if (!draft) return "";
  if (String(draft.novelText || "").trim()) return String(draft.novelText).trim();
  if (String(draft.sceneText || "").trim()) return String(draft.sceneText).trim();
  const tickText = (draft.periodSimulation?.ticks || [])
    .map((tick) => tick.surfaceEvent || tick.resolution || "")
    .filter(Boolean)
    .join("\n\n");
  return tickText || String(draft.surfaceEvent || "").trim();
}

export function setStoryWorkspace(patch = {}) {
  const current = state.ui.storyWorkspace || {};
  const requestedSourceId = patch.sourceDraftId === undefined ? current.sourceDraftId : patch.sourceDraftId;
  const sourceDraft = state.draftScenes.find((draft) => draft.id === requestedSourceId)
    || state.draftScenes.find((draft) => draft.id === state.ui.lastDraftId)
    || state.draftScenes[0]
    || null;
  const sourceChanged = Boolean(sourceDraft?.id && sourceDraft.id !== current.sourceDraftId);
  const sourceText = patch.sourceText !== undefined
    ? String(patch.sourceText)
    : sourceChanged || !current.sourceText
      ? buildStorySourceText(sourceDraft)
      : current.sourceText;
  const rewriteText = patch.rewriteText !== undefined
    ? String(patch.rewriteText)
    : sourceChanged
      ? sourceText
      : current.rewriteText || sourceText;
  state.ui.storyWorkspace = {
    ...current,
    ...patch,
    sourceDraftId: sourceDraft?.id || requestedSourceId || null,
    sourceText,
    rewriteText,
    status: patch.status || (patch.rewriteText !== undefined ? "editing" : current.status || "idle"),
  };
  emit();
  return deepClone(state.ui.storyWorkspace);
}

export function resetStoryWorkspace(sourceDraftId = null) {
  const sourceDraft = state.draftScenes.find((draft) => draft.id === sourceDraftId)
    || state.draftScenes.find((draft) => draft.id === state.ui.lastDraftId)
    || state.draftScenes[0]
    || null;
  const sourceText = buildStorySourceText(sourceDraft);
  state.ui.storyWorkspace = {
    ...(state.ui.storyWorkspace || {}),
    sourceDraftId: sourceDraft?.id || null,
    activeRevisionId: null,
    title: sourceDraft?.surfaceEvent || "",
    sourceText,
    rewriteText: sourceText,
    status: sourceDraft ? "ready" : "idle",
  };
  emit();
  return deepClone(state.ui.storyWorkspace);
}

export function saveStoryRevision(patch = {}) {
  const workspace = { ...(state.ui.storyWorkspace || {}), ...patch };
  const sourceDraft = state.draftScenes.find((draft) => draft.id === workspace.sourceDraftId)
    || state.draftScenes.find((draft) => draft.id === state.ui.lastDraftId)
    || state.draftScenes[0]
    || null;
  const sourceText = workspace.sourceText || buildStorySourceText(sourceDraft);
  const text = String(workspace.rewriteText || sourceText || "").trim();
  if (!text) return null;
  const revision = {
    id: createId("story"),
    projectId: state.project.id,
    branchId: state.ui.activeBranchId || state.project.activeBranchId || "branch_main",
    sourceDraftId: sourceDraft?.id || workspace.sourceDraftId || null,
    title: String(workspace.title || sourceDraft?.surfaceEvent || "未命名故事").trim(),
    mode: workspace.mode || "close-third",
    sourceText,
    text,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.storyRevisions = [revision, ...(state.storyRevisions || [])].slice(0, 120);
  state.ui.storyWorkspace = {
    ...workspace,
    sourceDraftId: revision.sourceDraftId,
    activeRevisionId: revision.id,
    sourceText,
    rewriteText: text,
    status: "saved",
  };
  emit();
  return deepClone(revision);
}

export function setActiveBranch(branchId) {
  if (branchId === state.ui.activeBranchId) return;
  persistActiveBranchSnapshot();
  const branch = state.branches.find((item) => item.id === branchId);
  if (!branch) return;
  state.ui.activeBranchId = branch.id;
  state.project.activeBranchId = branch.id;
  restoreBranchSnapshot(branch);
  emit();
}

export function createBranchFromDraft(draftId, title = "") {
  const draft = state.draftScenes.find((item) => item.id === draftId);
  if (!draft) return null;
  const parentBranchId = state.ui.activeBranchId || state.project.activeBranchId || "branch_main";
  persistActiveBranchSnapshot();
  const parentBranch = state.branches.find((item) => item.id === parentBranchId);
  const parentSnapshot = parentBranch?.snapshot || getBranchSnapshot(state);
  const branchId = createId("branch");
  const draftCopy = {
    ...deepClone(draft),
    id: createId("draft"),
    branchId,
    forkedFromDraftId: draft.id,
    createdAt: new Date().toISOString(),
  };
  const branchSnapshot = {
    ...deepClone(parentSnapshot),
    draftScenes: [draftCopy],
  };
  const ids = snapshotIds(branchSnapshot);
  const branch = {
    id: branchId,
    projectId: state.project.id,
    title: title || `分支：${(draft.surfaceEvent || "未命名草稿").slice(0, 24)}`,
    parentBranchId,
    forkedFromDraftId: draft.id,
    forkedFromCanonEventId: parentBranch?.canonEventIds?.[0] || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    canonEventIds: ids.canonEventIds,
    draftSceneIds: ids.draftSceneIds,
    stateMode: "isolated",
    snapshotSchemaVersion: 2,
    runtimeClientStateVersion: 1,
    snapshot: branchSnapshot,
    runtimeClientState: emptyRuntimeClientState(),
    note: "从草稿开出的独立状态分支。人物状态、关系、正史、草稿、谣言、证据和不可逆痕迹都会与父分支隔离。",
  };
  state.branches.unshift(branch);
  state.ui.activeBranchId = branch.id;
  state.project.activeBranchId = branch.id;
  restoreBranchSnapshot(branch);
  emit();
  return branch;
}

export function updateProject(patch) {
  const {
    runtimeInstanceId: _immutableRuntimeInstanceId,
    runtimeNamespace: _legacyRuntimeNamespace,
    ...safePatch
  } = patch || {};
  state.project = { ...state.project, ...safePatch, updatedAt: new Date().toISOString() };
  emit();
}

export function updateTown(patch) {
  state.town = { ...state.town, ...patch };
  emit();
}

export function updateLocation(locationId, patch) {
  state.locations = state.locations.map((location) => location.id === locationId ? { ...location, ...patch } : location);
  emit();
}

export function selectCharacter(characterId) {
  state.ui.selectedCharacterId = characterId;
  emit();
}

export function toggleActiveCharacter(characterId) {
  const active = new Set(state.ui.activeCharacterIds || []);
  if (active.has(characterId)) active.delete(characterId);
  else active.add(characterId);
  state.ui.activeCharacterIds = [...active];
  if (state.ui.activeCharacterIds.length === 0) state.ui.activeCharacterIds = [characterId];
  emit();
}

export function updateCharacter(characterId, updater) {
  state.characters = state.characters.map((character) => {
    if (character.id !== characterId) return character;
    const patch = typeof updater === "function" ? updater(deepClone(character)) : updater;
    return { ...character, ...patch };
  });
  normalizeActiveSelections();
  emit();
}

export function updateCharacterNested(characterId, path, value) {
  const parts = path.split(".");
  state.characters = state.characters.map((character) => {
    if (character.id !== characterId) return character;
    const next = deepClone(character);
    let cursor = next;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (!cursor[parts[i]]) cursor[parts[i]] = {};
      cursor = cursor[parts[i]];
    }
    cursor[parts.at(-1)] = value;
    return next;
  });
  emit();
}

export function addCharacter(input) {
  const character = createCharacterFromConcept(input);
  const existingIds = new Set(state.characters.map((item) => item.id));
  if (existingIds.has(character.id)) character.id = createId("char");
  state.characters = [...state.characters, character];
  state.project.characterIds = [...new Set([...state.project.characterIds, character.id])];

  for (const other of state.characters) {
    if (other.id === character.id) continue;
    state.relationships.push(createDefaultRelationship(character.id, other.id));
    state.relationships.push(createDefaultRelationship(other.id, character.id));
  }

  state.ui.selectedCharacterId = character.id;
  state.ui.planCharacterId = character.id;
  const plan = createDefaultPlan(character, state);
  state.characterPlans = [plan, ...(state.characterPlans || [])];
  state.ui.selectedPlanId = plan.id;
  normalizeActiveSelections();
  emit();
}

function createDefaultRelationship(fromCharacterId, toCharacterId) {
  return {
    id: createId("rel"),
    projectId: state.project.id,
    fromCharacterId,
    toCharacterId,
    love: 10,
    attraction: 10,
    resentment: 10,
    fear: 10,
    dependence: 10,
    power: 20,
    shame: 10,
    jealousy: 0,
    protection: 10,
    revenge: 0,
    deception: 10,
    misreading: "尚未形成稳定误读。",
    wantsToBeSeen: 20,
    wantsToPossess: 5,
    wantsToEscape: 10,
    wantsToDestroy: 0,
    unspoken: "",
    evidenceIds: [],
  };
}

export function deleteCharacter(characterId) {
  if (state.characters.length <= 1) return;
  state.characters = state.characters.filter((character) => character.id !== characterId);
  state.relationships = state.relationships.filter((rel) => rel.fromCharacterId !== characterId && rel.toCharacterId !== characterId);
  state.project.characterIds = state.project.characterIds.filter((id) => id !== characterId);
  state.characterPlans = (state.characterPlans || []).filter((plan) => plan.characterId !== characterId);
  state.ui.activeCharacterIds = state.ui.activeCharacterIds.filter((id) => id !== characterId);
  if (!state.ui.activeCharacterIds.length) state.ui.activeCharacterIds = [state.characters[0].id];
  if (state.ui.selectedCharacterId === characterId) state.ui.selectedCharacterId = state.characters[0].id;
  normalizeActiveSelections();
  emit();
}

export function saveDraft(draft) {
  const branchId = draft.branchId || state.ui.activeBranchId || state.project.activeBranchId || "branch_main";
  const nextDraft = { ...draft, branchId };
  const existingIndex = state.draftScenes.findIndex((item) => item.id === nextDraft.id);
  if (existingIndex >= 0) state.draftScenes[existingIndex] = nextDraft;
  else state.draftScenes.unshift(nextDraft);
  state.project.draftSceneIds = [nextDraft.id, ...state.project.draftSceneIds.filter((id) => id !== nextDraft.id)].slice(0, 80);
  state.branches = state.branches.map((branch) => branch.id === branchId
    ? { ...branch, draftSceneIds: [nextDraft.id, ...(branch.draftSceneIds || []).filter((id) => id !== nextDraft.id)].slice(0, 80) }
    : branch);
  state.ui.lastDraftId = nextDraft.id;
  emit();
}

export function recordObservedDraft(draft) {
  if (!draft?.id) return null;
  const branchId = draft.branchId || state.ui.activeBranchId || state.project.activeBranchId || "branch_main";
  const observedDraft = {
    ...draft,
    branchId,
    observedPlaybackCommitted: true,
  };
  saveDraft(observedDraft);
  if (!observedDraft.updateBundle || typeof observedDraft.updateBundle !== "object") return null;
  const existingCanon = state.canonEvents.find((event) =>
    event.sourceDraftId === observedDraft.id && event.acceptedParts?.observedPlayback === true
  );
  if (existingCanon) return existingCanon;
  return acceptDraftWithOptions(observedDraft.id, observedDraft.updateBundle, {
    ...allAcceptanceOptions(),
    observedPlayback: true,
  });
}

export function acceptDraft(draftId, updateBundle, options = null) {
  const selected = options || allAcceptanceOptions();
  return acceptDraftWithOptions(draftId, updateBundle, selected);
}

export function acceptDraftWithOptions(draftId, updateBundle, options) {
  const draft = state.draftScenes.find((item) => item.id === draftId);
  if (!draft) return null;
  const branchId = draft.branchId || state.ui.activeBranchId || state.project.activeBranchId || "branch_main";
  const acceptedParts = { ...allAcceptanceOptions(), ...(options || {}) };
  const preAcceptSnapshot = getBranchSnapshot(state);
  const filteredUpdateBundle = filterUpdateBundle(updateBundle, acceptedParts);
  const canonEvent = {
    id: createId("canon"),
    projectId: state.project.id,
    branchId,
    acceptedAt: new Date().toISOString(),
    title: `${acceptedParts.scene ? "正史" : "状态正史"}：${draft.surfaceEvent || "未命名事件"}`,
    locationId: draft.locationId,
    participantIds: draft.participantIds,
    summary: acceptedParts.scene ? draft.sceneText : "本次只确认部分状态变化，场景文本未被确认为正史。",
    relationshipShift: acceptedParts.relationships ? draft.relationshipShift || [] : [],
    irreversibleTraces: acceptedParts.irreversibleTraces ? draft.irreversibleTraces || [] : [],
    sourceDraftId: draft.id,
    acceptedParts,
    replay: buildReplayPayload(draft, filteredUpdateBundle),
    preAcceptSnapshot,
    postAcceptSnapshot: null,
  };
  state.canonEvents.unshift(canonEvent);
  state.project.canonEventIds = [canonEvent.id, ...state.project.canonEventIds];
  state.branches = state.branches.map((branch) => branch.id === branchId
    ? { ...branch, canonEventIds: [canonEvent.id, ...(branch.canonEventIds || [])] }
    : branch);
  applyUpdateBundle(filteredUpdateBundle);
  const postAcceptSnapshot = getBranchSnapshot(state);
  state.canonEvents = state.canonEvents.map((event) => event.id === canonEvent.id ? { ...event, postAcceptSnapshot } : event);
  state.ui.timelineEventId = canonEvent.id;
  emit();
  return { ...canonEvent, postAcceptSnapshot };
}

function buildReplayPayload(draft, filteredUpdateBundle = {}) {
  return {
    provider: draft.provider || draft.engine?.provider || draft.pipelineMeta?.provider || "unknown",
    surfaceEvent: draft.surfaceEvent || "未命名事件",
    sceneText: draft.sceneText || "",
    agentOutputs: deepClone(draft.agentOutputs || []),
    subtextMatrix: deepClone(draft.subtextMatrix || []),
    audit: deepClone(draft.audit || {}),
    pipelineMeta: deepClone(draft.pipelineMeta || draft.engineMeta || {}),
    interventionsApplied: deepClone(draft.interventionsApplied || []),
    updateBundle: deepClone(filteredUpdateBundle),
    stateChangeReasons: deepClone(filteredUpdateBundle.stateChangeReasons || draft.stateChangeReasons || []),
  };
}

export function undoCanonEvent(canonEventId) {
  const event = state.canonEvents.find((item) => item.id === canonEventId);
  if (!event) return null;
  const branchId = event.branchId || state.ui.activeBranchId || state.project.activeBranchId || "branch_main";
  if (branchId !== (state.ui.activeBranchId || state.project.activeBranchId)) {
    setActiveBranch(branchId);
  }
  const restoredSnapshot = event.preAcceptSnapshot
    ? normalizeSnapshot(event.preAcceptSnapshot, { characters: state.characters, relationships: state.relationships })
    : {
        ...getBranchSnapshot(state),
        canonEvents: state.canonEvents.filter((item) => item.id !== canonEventId),
      };
  const replayMarker = {
    id: createId("replay"),
    projectId: state.project.id,
    branchId,
    createdAt: new Date().toISOString(),
    sourceCanonEventId: event.id,
    sourceDraftId: event.sourceDraftId,
    title: `撤销并等待重演：${event.title || canonEventId}`,
    note: "系统已恢复到该正史被赞同之前。操盘手可以注入新干预，或从源草稿重演另一条命运线。",
    event: deepClone(event),
  };
  restoredSnapshot.replayMarkers = [replayMarker, ...(restoredSnapshot.replayMarkers || [])].slice(0, 80);
  const ids = snapshotIds(restoredSnapshot);
  state.branches = (state.branches || []).map((branch) => branch.id === branchId
    ? {
        ...branch,
        snapshot: deepClone(restoredSnapshot),
        canonEventIds: ids.canonEventIds,
        draftSceneIds: ids.draftSceneIds,
        updatedAt: new Date().toISOString(),
        note: `${branch.note || ""}
已撤销正史：${event.title || canonEventId}`.trim(),
      }
    : branch);
  const restoredBranch = state.branches.find((branch) => branch.id === branchId);
  restoreBranchSnapshot(restoredBranch || {
    id: branchId,
    snapshot: restoredSnapshot,
    runtimeClientState: emptyRuntimeClientState(),
  });
  state.ui.activeBranchId = branchId;
  state.project.activeBranchId = branchId;
  state.ui.lastDraftId = event.sourceDraftId || state.draftScenes?.[0]?.id || null;
  state.ui.timelineEventId = state.canonEvents?.[0]?.id || null;
  state.ui.activeTab = "archive";
  normalizeActiveSelections();
  emit();
  return replayMarker;
}

export function replayCanonEvent(canonEventId) {
  const event = state.canonEvents.find((item) => item.id === canonEventId)
    || (state.replayMarkers || []).find((item) => item.sourceCanonEventId === canonEventId)?.event
    || (state.replayMarkers || []).find((item) => item.id === canonEventId)?.event;
  if (!event) return null;
  state.ui.lastDraftId = event.sourceDraftId || state.ui.lastDraftId;
  state.ui.activeTab = "control";
  state.ui.detailMode = "scene";
  state.ui.userDirective = `从正史事件“${event.title || "未命名事件"}”重新演算。不要复述旧结果；让同一批人物在已改变的操盘条件下走向新的不可逆行动。`;
  emit();
  return event;
}


function allAcceptanceOptions() {
  return {
    scene: true,
    characters: true,
    relationships: true,
    rumors: true,
    evidence: true,
    characterMemories: true,
    characterPlans: true,
    townStateLedger: true,
    irreversibleTraces: true,
    secrets: true,
    stateChangeReasons: true,
    tavernState: true,
  };
}

function filterUpdateBundle(updateBundle = {}, options = {}) {
  return {
    characters: options.characters ? updateBundle.characters || [] : [],
    relationships: options.relationships ? updateBundle.relationships || [] : [],
    rumors: options.rumors ? updateBundle.rumors || [] : [],
    evidence: options.evidence ? updateBundle.evidence || [] : [],
    characterMemories: options.characterMemories !== false && options.memories !== false ? updateBundle.characterMemories || [] : [],
    characterPlans: options.characterPlans !== false ? updateBundle.characterPlans || [] : [],
    townStateLedger: options.townStateLedger !== false ? updateBundle.townStateLedger || [] : [],
    secrets: options.secrets ? updateBundle.secrets || [] : [],
    irreversibleTraces: options.irreversibleTraces ? updateBundle.irreversibleTraces || [] : [],
    stateChangeReasons: options.stateChangeReasons !== false ? updateBundle.stateChangeReasons || [] : [],
    consumedInterventionIds: updateBundle.consumedInterventionIds || [],
    consumedInjectedEvent: Boolean(updateBundle.consumedInjectedEvent),
    tavernState: options.tavernState !== false ? updateBundle.tavernState || null : null,
  };
}

function normalizeDialogueTurnsForRelationship(turns = []) {
  return (Array.isArray(turns) ? turns : [])
    .map((turn) => {
      const line = String(turn?.line || "").trim();
      if (!line) return null;
      return {
        speakerId: String(turn?.speakerId || ""),
        speakerName: String(turn?.speakerName || ""),
        targetId: String(turn?.targetId || ""),
        targetName: String(turn?.targetName || ""),
        line,
        turnRole: String(turn?.turnRole || ""),
        respondsTo: String(turn?.respondsTo || ""),
        triggeredBy: String(turn?.triggeredBy || ""),
      };
    })
    .filter(Boolean);
}

function relationshipDialogueFromShift(shift = {}) {
  const dialogueTurns = normalizeDialogueTurnsForRelationship(shift.dialogueTurns);
  const triggeredBy = String(shift.triggeredBy || shift.conductorSignal?.inWorldClue || "").trim();
  const hasDialogueTrace = [
    shift.sharedObject,
    shift.eventOutcome,
    shift.finalTurn,
    shift.followupTurn,
    shift.dialogueTurnCount,
    dialogueTurns.length,
    shift.generatedFrom === "agent-dialogue-relationship" || shift.generatedFrom === "model-agent-dialogue",
  ].some(Boolean);
  if (!hasDialogueTrace) return null;
  return {
    source: shift.generatedFrom || shift.relationshipSource || "relationship-shift",
    relationshipSource: shift.relationshipSource || "",
    sharedObject: shift.sharedObject || "",
    eventOutcome: shift.eventOutcome || shift.unspoken || "",
    finalTurn: shift.finalTurn || "",
    followupTurn: shift.followupTurn || "",
    dialogueTurnCount: Number(shift.dialogueTurnCount || dialogueTurns.length || 0),
    dialogueTurns,
    triggeredBy,
    conductorSignal: shift.conductorSignal || null,
    relationshipDialogueAct: shift.relationshipDialogueAct || null,
    locationId: shift.locationId || "",
    locationName: shift.locationName || "",
    periodSlot: shift.periodSlot || "",
    updatedAt: new Date().toISOString(),
  };
}

function appendRelationshipDialogueHistory(rel, dialogue) {
  if (!dialogue) return;
  const previous = Array.isArray(rel.dialogueHistory) ? rel.dialogueHistory : [];
  const signature = [
    dialogue.sharedObject,
    dialogue.eventOutcome,
    dialogue.finalTurn,
    dialogue.followupTurn,
    dialogue.triggeredBy,
    dialogue.locationId,
    dialogue.periodSlot,
  ].join("|");
  const withoutDuplicate = previous.filter((item) => [
    item.sharedObject,
    item.eventOutcome,
    item.finalTurn,
    item.followupTurn,
    item.triggeredBy,
    item.locationId,
    item.periodSlot,
  ].join("|") !== signature);
  rel.dialogueHistory = [...withoutDuplicate, dialogue].slice(-12);
}

export function applyUpdateBundle(updateBundle = {}) {
  if (!updateBundle || typeof updateBundle !== "object") return;

  if (Array.isArray(updateBundle.characters)) {
    const patches = new Map(updateBundle.characters.map((patch) => [patch.id, patch]));
    state.characters = state.characters.map((character) => {
      const patch = patches.get(character.id);
      if (!patch) return character;
      return {
        ...character,
        currentState: { ...character.currentState, ...(patch.currentState || {}) },
        ...(patch.lifeState && typeof patch.lifeState === "object" ? { lifeState: { ...(character.lifeState || {}), ...deepClone(patch.lifeState) } } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "ecologyState") ? { ecologyState: deepClone(patch.ecologyState) } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "agentMemory") ? { agentMemory: deepClone(patch.agentMemory) } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "currentActivity") ? { currentActivity: patch.currentActivity } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "previousLocationId") ? { previousLocationId: patch.previousLocationId } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "currentLocationId") ? { currentLocationId: patch.currentLocationId } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "inTransit") ? { inTransit: patch.inTransit } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "lastPresenceDecision") ? { lastPresenceDecision: patch.lastPresenceDecision } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "lastMovementReason") ? { lastMovementReason: patch.lastMovementReason } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "lastPresenceDraftId") ? { lastPresenceDraftId: patch.lastPresenceDraftId } : {}),
      };
    });
  }

  if (Array.isArray(updateBundle.relationships)) {
    for (const shift of updateBundle.relationships) {
      let rel = state.relationships.find((item) => item.fromCharacterId === shift.fromCharacterId && item.toCharacterId === shift.toCharacterId);
      if (!rel) {
        rel = {
          id: createId("rel"), projectId: state.project.id,
          fromCharacterId: shift.fromCharacterId, toCharacterId: shift.toCharacterId,
          love: 10, attraction: 10, resentment: 10, fear: 10, dependence: 10, power: 10, shame: 10, jealousy: 0,
          protection: 10, revenge: 0, deception: 10, wantsToBeSeen: 10, wantsToPossess: 0, wantsToEscape: 10, wantsToDestroy: 0,
          misreading: "", unspoken: "", evidenceIds: [],
        };
        state.relationships.push(rel);
      }
      for (const [key, delta] of Object.entries(shift.deltas || {})) {
        if (typeof rel[key] === "number") rel[key] = clamp(rel[key] + Number(delta), 0, 100);
      }
      if (shift.misreading) rel.misreading = shift.misreading;
      if (shift.unspoken) rel.unspoken = shift.unspoken;
      const lastDialogue = relationshipDialogueFromShift(shift);
      if (lastDialogue) {
        rel.lastDialogue = { ...(rel.lastDialogue || {}), ...lastDialogue };
        appendRelationshipDialogueHistory(rel, rel.lastDialogue);
      }
      const relationshipArc = buildRelationshipArcFromShift(shift, rel.relationshipArc || null);
      if (relationshipArc) rel.relationshipArc = relationshipArc;
    }
  }

  if (Array.isArray(updateBundle.rumors)) state.rumors.unshift(...updateBundle.rumors);
  if (Array.isArray(updateBundle.evidence)) state.evidence.unshift(...updateBundle.evidence);
  if (Array.isArray(updateBundle.characterMemories)) {
    state.characterMemories.unshift(...updateBundle.characterMemories);
    if (state.worldSetup?.fixedStage) {
      const uniqueMemories = new Map();
      for (const memory of state.characterMemories) {
        const key = memory.id || `${memory.characterId || ""}:${memory.day || ""}:${memory.content || ""}`;
        if (!uniqueMemories.has(key)) uniqueMemories.set(key, memory);
      }
      state.characterMemories = [...uniqueMemories.values()].slice(0, 48);
    }
  }
  if (Array.isArray(updateBundle.characterPlans)) {
    const patches = new Map(updateBundle.characterPlans.map((patch) => [patch.id || patch.characterId, patch]));
    state.characterPlans = ensureCharacterPlans(state).map((plan) => {
      const patch = patches.get(plan.id) || patches.get(plan.characterId);
      return patch ? { ...plan, ...patch, id: plan.id, characterId: plan.characterId } : plan;
    });
  }
  if (Array.isArray(updateBundle.townStateLedger)) state.townStateLedger.unshift(...updateBundle.townStateLedger);
  if (Array.isArray(updateBundle.secrets)) state.secrets.unshift(...updateBundle.secrets);
  if (Array.isArray(updateBundle.irreversibleTraces)) state.irreversibleTraces.unshift(...updateBundle.irreversibleTraces);
  if (Array.isArray(updateBundle.stateChangeReasons)) state.stateChangeReasons.unshift(...updateBundle.stateChangeReasons);
  if (Array.isArray(updateBundle.replayMarkers)) state.replayMarkers.unshift(...updateBundle.replayMarkers);
  if (updateBundle.tavernState && typeof updateBundle.tavernState === "object") {
    state.tavernState = deepClone(updateBundle.tavernState);
  }
  if (updateBundle.consumedInjectedEvent) state.ui.injectedEvent = "";
  if (Array.isArray(updateBundle.consumedInterventionIds) && updateBundle.consumedInterventionIds.length) {
    const consumed = new Set(updateBundle.consumedInterventionIds);
    state.interventions = (state.interventions || []).map((item) => (consumed.has(item.id) && item.persistence !== "persistent") ? { ...item, consumed: true, enabled: false } : item);
  }
  state.interventions = (state.interventions || []).filter((item) => item.persistence !== "next_play" || item.consumed !== true);
  refreshProjectLists();
}



export function setMemoryDraft(patch = {}) {
  state.ui.memoryDraft = { ...(state.ui.memoryDraft || {}), ...patch };
  if (patch.characterId) state.ui.memoryCharacterId = patch.characterId;
  if (patch.characterId) state.ui.graphFocusCharacterId = patch.characterId;
  emit();
}

export function addCharacterMemory(input = {}) {
  const branchId = state.ui.activeBranchId || state.project.activeBranchId || "branch_main";
  const draft = { ...(state.ui.memoryDraft || {}), ...input };
  const memory = {
    id: createId("mem"),
    projectId: state.project.id,
    branchId,
    characterId: draft.characterId || state.ui.memoryCharacterId || state.characters[0]?.id || null,
    targetCharacterId: draft.targetCharacterId || null,
    type: draft.type || "selective",
    stance: draft.stance || "self_defense",
    content: String(draft.content || "").trim() || "未命名记忆",
    publicVersion: String(draft.publicVersion || "").trim(),
    privateVersion: String(draft.privateVersion || "").trim(),
    distortion: String(draft.distortion || "").trim(),
    reliability: clamp(Number(draft.reliability ?? 55), 0, 100),
    heat: clamp(Number(draft.heat ?? 60), 0, 100),
    locked: Boolean(draft.locked || false),
    sourceCanonEventId: draft.sourceCanonEventId || null,
    sourceEvidenceId: draft.sourceEvidenceId || null,
    sourceRumorId: draft.sourceRumorId || null,
    sourceTraceId: draft.sourceTraceId || null,
    source: input.source || "operator",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.characterMemories = [memory, ...(state.characterMemories || [])].slice(0, 240);
  state.ui.memoryCharacterId = memory.characterId;
  state.ui.graphFocusCharacterId = memory.characterId;
  state.ui.memoryDraft = { ...(state.ui.memoryDraft || {}), content: "", publicVersion: "", privateVersion: "", distortion: "" };
  emit();
  return memory;
}

export function updateCharacterMemory(memoryId, patch = {}) {
  state.characterMemories = (state.characterMemories || []).map((memory) => memory.id === memoryId
    ? { ...memory, ...patch, reliability: patch.reliability === undefined ? memory.reliability : clamp(Number(patch.reliability), 0, 100), heat: patch.heat === undefined ? memory.heat : clamp(Number(patch.heat), 0, 100), updatedAt: new Date().toISOString() }
    : memory);
  emit();
}

export function deleteCharacterMemory(memoryId) {
  state.characterMemories = (state.characterMemories || []).filter((memory) => memory.id !== memoryId);
  emit();
}

export function mutateCharacterMemory(memoryId, mode = "distort") {
  const patchByMode = {
    distort: { type: "misremembered", stance: "self_defense", reliabilityDelta: -16, heatDelta: 8, note: "记忆被自我神话扭曲。" },
    suppress: { type: "suppressed", stance: "self_accusation", reliabilityDelta: -8, heatDelta: 12, note: "角色试图压下这段记忆。" },
    evidence: { type: "weaponized", stance: "revenge", reliabilityDelta: 6, heatDelta: 10, note: "记忆开始被当成证据使用。" },
    rumor: { type: "misremembered", stance: "confusion", reliabilityDelta: -22, heatDelta: 18, note: "记忆被谣言化。" },
  };
  const rule = patchByMode[mode] || patchByMode.distort;
  state.characterMemories = (state.characterMemories || []).map((memory) => {
    if (memory.id !== memoryId) return memory;
    return {
      ...memory,
      type: rule.type,
      stance: rule.stance,
      reliability: clamp(Number(memory.reliability ?? 55) + rule.reliabilityDelta, 0, 100),
      heat: clamp(Number(memory.heat ?? 60) + rule.heatDelta, 0, 100),
      distortion: `${memory.distortion || ""}${memory.distortion ? "\n" : ""}${rule.note}`.trim(),
      updatedAt: new Date().toISOString(),
    };
  });
  emit();
}

export function createMemoryFromCanonEvent(canonEventId, characterId) {
  const event = state.canonEvents.find((item) => item.id === canonEventId);
  if (!event) return null;
  const rememberedBy = characterId || state.ui.memoryCharacterId || event.participantIds?.[0] || state.characters[0]?.id;
  const targetCharacterId = (event.participantIds || []).find((id) => id !== rememberedBy) || null;
  return addCharacterMemory({
    characterId: rememberedBy,
    targetCharacterId,
    type: "selective",
    stance: "confusion",
    content: `记住正史“${event.title || event.surfaceEvent || canonEventId}”，但还不知道这是证据、借口还是羞耻来源。`,
    publicVersion: "这只是已经发生的事实。",
    privateVersion: event.summary || event.sceneText?.slice(0, 160) || "无法完整说出的事件。",
    distortion: "把正史事件转成可供自辩或自控的私人材料。",
    reliability: 62,
    heat: 58,
    sourceCanonEventId: event.id,
    source: "canon_event",
  });
}

export function setInterventionDraft(patch = {}) {
  state.ui.interventionDraft = { ...(state.ui.interventionDraft || {}), ...patch };
  emit();
}

export function addIntervention(input = {}) {
  const branchId = state.ui.activeBranchId || state.project.activeBranchId || "branch_main";
  const activeIds = state.ui.activeCharacterIds || [];
  const targetCharacterId = input.targetCharacterId || state.ui.interventionDraft?.targetCharacterId || activeIds[0] || state.characters[0]?.id || null;
  const secondaryCharacterId = input.secondaryCharacterId || state.ui.interventionDraft?.secondaryCharacterId || activeIds.find((id) => id !== targetCharacterId) || null;
  const intervention = {
    id: createId("intervention"),
    projectId: state.project.id,
    branchId,
    enabled: input.enabled !== false,
    type: input.type || state.ui.interventionDraft?.type || "lock_motivation",
    targetCharacterId,
    secondaryCharacterId,
    characterId: targetCharacterId,
    targetId: secondaryCharacterId,
    intensity: clamp(Number(input.intensity ?? state.ui.interventionDraft?.intensity ?? 60), 0, 100),
    instruction: String(input.instruction ?? state.ui.interventionDraft?.instruction ?? "").trim() || "未写明的操盘意图",
    persistence: input.persistence || state.ui.interventionDraft?.persistence || "next_play",
    consumed: false,
    createdAt: new Date().toISOString(),
    source: "operator",
  };
  state.interventions = [intervention, ...(state.interventions || [])].slice(0, 80);
  state.ui.interventionDraft = { ...(state.ui.interventionDraft || {}), instruction: "" };
  emit();
  return intervention;
}

export function toggleIntervention(interventionId) {
  state.interventions = (state.interventions || []).map((item) => item.id === interventionId ? { ...item, enabled: item.enabled === false } : item);
  emit();
}

export function deleteIntervention(interventionId) {
  state.interventions = (state.interventions || []).filter((item) => item.id !== interventionId);
  emit();
}

export function clearInterventions() {
  state.interventions = [];
  emit();
}

export function setPlanDraft(patch = {}) {
  state.ui.planDraft = { ...(state.ui.planDraft || {}), ...patch };
  if (patch.characterId) state.ui.planCharacterId = patch.characterId;
  emit();
}

export function addCharacterPlan(input = {}) {
  const draft = { ...(state.ui.planDraft || {}), ...input };
  const character = state.characters.find((item) => item.id === (draft.characterId || state.ui.planCharacterId)) || state.characters[0];
  if (!character) return null;
  const plan = buildIntentPlan(state, character, {
    ...draft,
    source: input.source || "operator",
    status: draft.status || "active",
  });
  state.characterPlans = [plan, ...(state.characterPlans || [])].slice(0, 120);
  state.ui.planCharacterId = plan.characterId;
  state.ui.selectedPlanId = plan.id;
  state.ui.planDraft = { ...(state.ui.planDraft || {}), shortTerm: "", midTermCover: "", longTermSelfMyth: "", operatorNote: "" };
  emit();
  return plan;
}

export function deleteCharacterPlan(planId) {
  state.characterPlans = (state.characterPlans || []).filter((plan) => plan.id !== planId);
  if (state.ui.selectedPlanId === planId) state.ui.selectedPlanId = state.characterPlans?.[0]?.id || null;
  emit();
}

export function selectCharacterPlan(planId) {
  const plan = (state.characterPlans || []).find((item) => item.id === planId);
  if (!plan) return;
  state.ui.selectedPlanId = plan.id;
  state.ui.planCharacterId = plan.characterId;
  emit();
}

export function updateCharacterPlan(planId, patch = {}) {
  state.characterPlans = ensureCharacterPlans(state).map((plan) => plan.id === planId || plan.characterId === planId
    ? { ...plan, ...patch, priority: patch.priority === undefined ? plan.priority : clamp(Number(patch.priority), 0, 100), progress: patch.progress === undefined ? plan.progress : clamp(Number(patch.progress), 0, 100), pressure: patch.pressure === undefined ? plan.pressure : clamp(Number(patch.pressure), 0, 100), risk: patch.risk === undefined ? plan.risk : clamp(Number(patch.risk), 0, 100), updatedAt: new Date().toISOString() }
    : plan);
  emit();
}

export function regenerateCharacterPlan(characterId) {
  const character = state.characters.find((item) => item.id === characterId);
  if (!character) return null;
  const plan = createDefaultPlan(character, state);
  state.characterPlans = ensureCharacterPlans(state).map((item) => item.characterId === characterId ? plan : item);
  emit();
  return plan;
}

export function freezeCharacterPlan(characterId, reason = "操盘手冻结计划。") {
  state.characterPlans = ensureCharacterPlans(state).map((plan) => plan.characterId === characterId
    ? { ...plan, status: plan.status === "frozen" ? "active" : "frozen", operatorLock: plan.status !== "frozen", frozenReason: plan.status === "frozen" ? "" : reason, updatedAt: new Date().toISOString() }
    : plan);
  emit();
}

export function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
