// Client for the v2.7 world runtime.
//
// The v2.7 runtime differs from the legacy play pipeline in who decides what:
// the character completes its configured submission protocol and commits an attempt, and the world
// only settles whether it happened and who could perceive it.  Its result is
// therefore not a scene draft — there is no narrated scene to accept as canon —
// so it is surfaced as its own observation rather than folded into the draft
// shape the legacy renderer expects.
//
// The local run uses a fixture stage and calls no provider.  The model run
// spends real provider requests and is gated on an explicit per-run
// authorization, mirroring the server-side contract.

import { classifyV27TurnKind } from "./v27TurnPresentation.js";

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error("v2.7 运行时返回了无法解析的响应。");
  }
  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.error || `v2.7 运行时返回 ${response.status}。`);
    error.code = payload?.code || "";
    error.failure = payload?.failure || null;
    error.providerRequestBudget = payload?.providerRequestBudget || null;
    error.sessionRef = normalizeV27SessionRef(payload?.sessionRef, {
      sessionRevision: payload?.sessionRevision,
      worldVersion: payload?.worldVersion,
    });
    throw error;
  }
  return payload;
}

export async function fetchV27Status() {
  const response = await fetch("/api/v27/tavern/status");
  if (!response.ok) throw new Error("无法确认 v2.7 运行时状态。");
  return response.json();
}

function createV27CommandId(operation) {
  const suffix = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  return `v27:${operation}:${suffix}`;
}

export function v27RuntimeIdForWorld({ runtimeInstanceId = "" } = {}) {
  const instanceId = String(runtimeInstanceId || "").trim();
  if (!instanceId) throw new Error("v2.7 运行时需要独立的世界实例标识。");
  return `tavern-v27:${instanceId}`;
}

export function prepareV27LocalCommand({ sessionRef = null } = {}) {
  const pending = sessionRef?.pendingCommand || null;
  if (pending?.commandId) {
    const operation = String(pending.operation || "").trim();
    const expectedRevision = Number(pending.expectedRevision);
    if (!["start", "continue"].includes(operation)
      || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error("保存中的 v2.7 命令引用无效。");
    }
    const hasSession = Boolean(String(sessionRef?.sessionId || "").trim());
    const currentRevision = Number(sessionRef?.sessionRevision ?? 0);
    if (!Number.isInteger(currentRevision) || currentRevision < 0
      || (operation === "start" && expectedRevision !== 0)
      || (operation === "continue" && (!hasSession || expectedRevision > currentRevision))) {
      throw new Error("保存中的 v2.7 命令与当前会话游标不一致。");
    }
    return {
      operation,
      commandId: String(pending.commandId),
      expectedRevision,
      timestamp: String(pending.timestamp || pending.createdAt || new Date().toISOString()),
    };
  }
  const operation = sessionRef?.sessionId ? "continue" : "start";
  const currentRevision = Number(sessionRef?.sessionRevision ?? 0);
  if (!Number.isInteger(currentRevision) || currentRevision < 0) {
    throw new Error("v2.7 会话 revision 必须是非负整数。");
  }
  return {
    operation,
    commandId: createV27CommandId(operation),
    expectedRevision: operation === "continue"
      ? currentRevision
      : 0,
    timestamp: new Date().toISOString(),
  };
}

// Local structural run: Character-Agent protocol, world settlement, perception
// delivery and receipts, with no external model call and no claim about
// dialogue or character quality. The browser owns only an opaque reference;
// the world and every Character Actor checkpoint stay on the server.
export async function runV27LocalObservation({
  projectId = "",
  branchId = "",
  runtimeId = "",
  sessionRef = null,
  commandId = "",
} = {}) {
  const cleanProjectId = String(projectId || "").trim();
  const cleanBranchId = String(branchId || "").trim();
  const cleanRuntimeId = String(runtimeId || "").trim();
  if (!cleanProjectId || !cleanBranchId || !cleanRuntimeId) {
    throw new Error("v2.7 持久回合需要当前项目、分支与运行时标识。");
  }
  if (sessionRef?.runtimeId && String(sessionRef.runtimeId) !== cleanRuntimeId) {
    throw new Error("v2.7 会话引用不属于当前世界运行时。");
  }
  if (sessionRef?.projectId && String(sessionRef.projectId) !== cleanProjectId) {
    throw new Error("v2.7 会话引用不属于当前项目。");
  }
  if (sessionRef?.branchId && String(sessionRef.branchId) !== cleanBranchId) {
    throw new Error("v2.7 会话引用不属于当前分支。");
  }
  const currentRevision = Number(sessionRef?.sessionRevision ?? 0);
  if (!Number.isInteger(currentRevision) || currentRevision < 0) {
    throw new Error("v2.7 会话 revision 必须是非负整数。");
  }
  const prepared = commandId
    ? {
      operation: sessionRef?.pendingCommand?.operation || (sessionRef?.sessionId ? "continue" : "start"),
      commandId: String(commandId).trim(),
      expectedRevision: sessionRef?.pendingCommand?.expectedRevision
        ?? (sessionRef?.sessionId ? currentRevision : 0),
    }
    : prepareV27LocalCommand({ sessionRef });
  const operation = prepared.operation;
  const payload = await postJson(`/api/v27/tavern/session/${operation}`, {
    projectId: cleanProjectId,
    branchId: cleanBranchId,
    runtimeId: cleanRuntimeId,
    sessionId: String(sessionRef?.sessionId || "").trim(),
    commandId: prepared.commandId,
    expectedRevision: prepared.expectedRevision,
  });
  const normalized = normalizeV27Observation({
    // Keep the historical mode token for stored-client compatibility. Turn
    // completion itself is now described by submissionMode and
    // characterAgentCompleted, never by this transport label.
    mode: "local-five-stage-fixture-persistent",
    externalModelCalled: false,
    authorQualityVerdict: "not_claimed",
    explanation: "连续人物回合由服务端持久世界会话恢复；本地夹具未调用外部模型。",
    sessionRef: {
      ...(payload.sessionRef || {}),
      sessionRevision: payload.sessionRevision,
      worldVersion: payload.worldVersion,
    },
    runtime: {
      ...(payload.observation || {}),
      worldVersion: payload.worldVersion ?? payload.observation?.worldVersion ?? 0,
    },
  });
  if (!normalized.sessionRef
    || normalized.sessionRef.runtimeId !== cleanRuntimeId
    || normalized.sessionRef.projectId !== cleanProjectId
    || normalized.sessionRef.branchId !== cleanBranchId) {
    throw new Error("v2.7 运行时返回了不属于当前项目、分支或实例的会话引用。");
  }
  if (payload.staleReplay === true) {
    return {
      ...normalized,
      staleReplay: true,
      resultSessionRevision: Number(payload.resultSessionRevision || 0),
      turns: [],
      explanation: "旧命令的迟到响应已被丢弃；会话游标已对齐到当前版本。",
    };
  }
  return normalized;
}

// Model run: consumes the per-run provider budget.  `authorizationAcknowledged`
// must be a deliberate act by the author, not a default.
export async function runV27ModelObservation({ authorizationAcknowledged = false, maxTurns } = {}) {
  const payload = await postJson("/api/v27/tavern/model-run", {
    authorizationAcknowledged,
    ...(maxTurns ? { maxTurns } : {}),
  });
  return normalizeV27Observation(payload);
}

export function mergeV27ObservationHistory(previous, next, { maxTurns = 80 } = {}) {
  if (!next) return previous || null;
  const previousSessionId = String(previous?.sessionRef?.sessionId || "");
  const nextSessionId = String(next?.sessionRef?.sessionId || "");
  if (!previousSessionId || previousSessionId !== nextSessionId) return next;
  const byTurnId = new Map();
  for (const turn of [...(previous?.turns || []), ...(next?.turns || [])]) {
    const turnId = String(turn?.agentTurnId || "").trim();
    const fallback = `${turn?.characterId || "unknown"}:${turn?.index || 0}:${turn?.actionType || "none"}`;
    byTurnId.set(turnId || fallback, turn);
  }
  const limit = Math.max(1, Number(maxTurns || 80));
  const turns = [...byTurnId.values()].slice(-limit).map((turn, index) => ({
    ...turn,
    index: index + 1,
  }));
  return { ...next, turns };
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  // The world bridge already treats placeholder tokens as empty; the observer
  // must not reintroduce them as if they were content.
  return /^(无|没有|none|n\/a)$/i.test(text) ? "" : text;
}

const PUBLIC_SCENE_EFFECT_TEXT_FIELDS = Object.freeze([
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

const PUBLIC_SCENE_EFFECT_NUMBER_FIELDS = Object.freeze([
  "durationSeconds",
  "progress",
  "remainingSeconds",
  "remainingUnits",
  "quantity",
  "soundDistance",
]);

const PUBLIC_SCENE_EFFECT_BOOLEAN_FIELDS = Object.freeze([
  "directed",
  "overheard",
  "completed",
  "active",
]);

const PUBLIC_SCENE_EFFECT_ID_ARRAY_FIELDS = Object.freeze([
  "participantIds",
  "objectIds",
  "occupantCharacterIds",
]);

function normalizePublicSceneEffect(raw = null) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const kind = String(raw.kind || "").trim();
  if (!kind) return null;
  const normalized = { kind };
  for (const field of PUBLIC_SCENE_EFFECT_TEXT_FIELDS) {
    if (field === "kind" || !Object.hasOwn(raw, field)) continue;
    const value = String(raw[field] ?? "").trim();
    if (value) normalized[field] = value;
  }
  for (const field of PUBLIC_SCENE_EFFECT_NUMBER_FIELDS) {
    if (!Object.hasOwn(raw, field)) continue;
    const value = Number(raw[field]);
    if (Number.isFinite(value)) normalized[field] = value;
  }
  for (const field of PUBLIC_SCENE_EFFECT_BOOLEAN_FIELDS) {
    if (typeof raw[field] === "boolean") normalized[field] = raw[field];
  }
  for (const field of PUBLIC_SCENE_EFFECT_ID_ARRAY_FIELDS) {
    if (!Array.isArray(raw[field])) continue;
    normalized[field] = raw[field]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
  }
  return normalized;
}

function normalizePublicSceneEffects(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map(normalizePublicSceneEffect)
    .filter(Boolean);
}

function normalizePublicSceneOutcome(outcome = null) {
  const worldVersion = Number(outcome?.worldVersion);
  const durationSeconds = Number(outcome?.durationSeconds);
  return {
    primitive: String(outcome?.primitive || "").trim(),
    worldVersion: Number.isFinite(worldVersion) && worldVersion >= 0 ? worldVersion : 0,
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds >= 0 ? durationSeconds : 0,
    resolvedEffects: normalizePublicSceneEffects(outcome?.resolvedEffects),
    committedFacts: normalizePublicSceneEffects(outcome?.committedFacts),
  };
}

function normalizeOutcome(outcome) {
  const publicSceneOutcome = normalizePublicSceneOutcome(outcome);
  if (!outcome) {
    return {
      status: "quiet",
      label: "没有新增世界事实",
      detail: "人物保持沉默或继续观察。",
      ...publicSceneOutcome,
    };
  }
  const failedCodes = (outcome.failedEffects || []).map((row) => row.code).filter(Boolean).join("、");
  if (outcome.status === "failed") {
    return {
      status: "failed",
      label: "尝试留下，目标失败",
      detail: failedCodes || "目标效果没有发生",
      ...publicSceneOutcome,
    };
  }
  if (outcome.status === "partial") {
    return {
      status: "partial",
      label: "动作发生，目标只到了一部分",
      detail: `${failedCodes || "部分目标效果没有发生"} · 世界版本 ${outcome.worldVersion}`,
      ...publicSceneOutcome,
    };
  }
  return {
    status: "settled",
    label: "世界已接住动作",
    detail: `世界版本 ${outcome.worldVersion} · ${outcome.durationSeconds || 0} 秒`,
    ...publicSceneOutcome,
  };
}

function finiteRatio(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeObserverOnlyPsychology(raw = null) {
  if (!raw || raw.visibility !== "observer-only-never-returned-to-character-context") return null;
  const impulse = raw.automaticCommunicationImpulse && typeof raw.automaticCommunicationImpulse === "object"
    ? raw.automaticCommunicationImpulse
    : null;
  const conflictDescription = normalizeText(impulse?.conflict?.description);
  const automaticCommunicationImpulse = impulse
    ? {
      mode: normalizeText(impulse.mode),
      perceivedTurnDemand: normalizeText(impulse.perceivedTurnDemand),
      feltTendency: normalizeText(impulse.feltTendency),
      urgency: finiteRatio(impulse.urgency),
      disclosurePressure: finiteRatio(impulse.disclosurePressure),
      inhibitionPressure: finiteRatio(impulse.inhibitionPressure),
      conflict: {
        present: impulse.conflict?.present === true,
        description: conflictDescription,
      },
    }
    : null;
  const normalized = {
    visibility: "observer-only-never-returned-to-character-context",
    selectedIntention: normalizeText(raw.selectedIntention),
    privateDecisionBasis: normalizeText(raw.privateDecisionBasis),
    automaticCommunicationImpulse,
  };
  return normalized.selectedIntention
    || normalized.privateDecisionBasis
    || automaticCommunicationImpulse?.feltTendency
    || conflictDescription
    ? normalized
    : null;
}

export function normalizeV27Observation(payload = {}) {
  const runtime = payload.runtime || {};
  const sessionRef = normalizeV27SessionRef(payload.sessionRef, {
    sessionRevision: payload.sessionRevision,
    worldVersion: runtime.worldVersion,
  });
  const turns = (runtime.turns || []).map((turn, index) => {
    const realization = turn.publicRealization || {};
    const legacyFiveStageCompleted = turn.fiveStageAgentCompleted === true || turn.fiveStageCompleted === true;
    const submissionMode = String(turn.submissionMode || (legacyFiveStageCompleted ? "staged" : ""));
    const characterAgentCompleted = turn.characterAgentCompleted === true
      || (submissionMode === "staged" && legacyFiveStageCompleted);
    return {
      index: index + 1,
      characterId: String(turn.characterId || ""),
      characterName: String(turn.characterName || ""),
      agentTurnId: String(turn.agentTurnId || ""),
      wakeKind: String(turn.wakeKind || ""),
      turnKind: classifyV27TurnKind({ ...turn, submissionMode }),
      submissionMode,
      characterAgentCompleted,
      acceptedStageCount: Number(turn.acceptedStageCount || 0),
      expectedAcceptedStageCount: Number(turn.expectedAcceptedStageCount || 0),
      // Deprecated staged-only compatibility field.
      fiveStageCompleted: submissionMode === "staged" && legacyFiveStageCompleted,
      protocolRepairCount: Number(turn.protocolRepairCount || 0),
      actionType: String(realization.actionType || ""),
      targetCharacterId: String(realization.targetCharacterId || ""),
      speech: normalizeText(realization.speech),
      visibleAction: normalizeText(realization.visibleAction),
      affectiveTexture: (realization.observableAffectiveTexture || [])
        .map((row) => normalizeText(row?.feature))
        .filter(Boolean),
      observerOnlyPsychology: normalizeObserverOnlyPsychology(turn.observerOnlyPsychology),
      outcome: normalizeOutcome(turn.outcome),
    };
  });
  return {
    mode: String(payload.mode || ""),
    model: String(payload.model || ""),
    externalModelCalled: payload.externalModelCalled === true,
    authorQualityVerdict: String(payload.authorQualityVerdict || ""),
    explanation: String(payload.explanation || ""),
    worldVersion: Number(runtime.worldVersion || 0),
    nowSeconds: Number(runtime.nowSeconds || 0),
    eventCount: Number(runtime.eventCount || 0),
    schemaVersion: String(runtime.schemaVersion || ""),
    stageInvocations: Number(payload.stageInvocations || 0),
    providerRequestBudget: payload.providerRequestBudget || null,
    protocolRepairEvents: payload.protocolRepairEvents || [],
    sessionRef,
    characters: (runtime.characters || []).map((row) => ({
      characterId: String(row.characterId || row.id || ""),
      name: String(row.name || ""),
      present: row.present !== false,
      placeId: String(row.placeId || ""),
      zoneId: String(row.zoneId || ""),
      positionId: String(row.positionId || ""),
      orientationTargetId: String(row.orientationTargetId || ""),
      listeningTargetId: String(row.listeningTargetId || ""),
      listeningTargetKind: String(row.listeningTargetKind || ""),
    })),
    objects: (runtime.objects || []).map((row) => ({
      id: String(row.id || row.objectId || ""),
      kind: String(row.kind || ""),
      label: String(row.label || ""),
      placeId: String(row.placeId || ""),
      zoneId: String(row.zoneId || ""),
      holderCharacterId: String(row.holderCharacterId || ""),
      occupantCharacterIds: (row.occupantCharacterIds || [])
        .map((characterId) => String(characterId || "").trim())
        .filter(Boolean),
    })),
    readyQueue: (runtime.readyQueue || []).map((row) => String(row || "")).filter(Boolean),
    turns,
    completedAt: new Date().toISOString(),
  };
}

function normalizeV27SessionRef(rawSessionRef = null, fallback = {}) {
  if (!rawSessionRef?.sessionId) return null;
  const sessionRevision = Number(rawSessionRef.sessionRevision ?? fallback.sessionRevision ?? 0);
  const worldVersion = Number(rawSessionRef.worldVersion ?? fallback.worldVersion ?? 0);
  if (!Number.isInteger(sessionRevision) || sessionRevision < 0
    || !Number.isInteger(worldVersion) || worldVersion < 0) return null;
  return {
    runtimeId: String(rawSessionRef.runtimeId || "tavern-v27"),
    projectId: String(rawSessionRef.projectId || ""),
    branchId: String(rawSessionRef.branchId || ""),
    sessionId: String(rawSessionRef.sessionId || ""),
    sessionRevision,
    worldVersion,
  };
}
