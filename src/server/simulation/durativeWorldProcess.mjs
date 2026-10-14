function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "", max = 220) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function finiteNonNegative(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : fallback;
}

export const DURATIVE_WORLD_PROCESS_STATUSES = Object.freeze([
  "active",
  "interrupted",
  "ready",
  "completed",
  "cancelled",
]);

export function normalizeDurativeWorldProcess(raw = {}) {
  const status = DURATIVE_WORLD_PROCESS_STATUSES.includes(raw.status) ? raw.status : "active";
  const durationSeconds = Math.max(1, finiteNonNegative(raw.durationSeconds, 1));
  const accumulatedSeconds = Math.min(durationSeconds, finiteNonNegative(raw.accumulatedSeconds, 0));
  const activeStartedAtSeconds = status === "active"
    ? finiteNonNegative(raw.activeStartedAtSeconds, finiteNonNegative(raw.startedAtSeconds, 0))
    : null;
  const remainingSeconds = Math.max(0, durationSeconds - accumulatedSeconds);
  const readyAtSeconds = status === "active"
    ? finiteNonNegative(raw.readyAtSeconds, activeStartedAtSeconds + remainingSeconds)
    : null;
  return {
    schemaVersion: 1,
    id: clean(raw.id, 180),
    kind: clean(raw.kind || "world_process", 120),
    subjectId: clean(raw.subjectId, 180),
    ownerActorId: clean(raw.ownerActorId, 180),
    stationZoneId: clean(raw.stationZoneId, 120),
    objectIds: [...new Set((raw.objectIds || []).map((row) => clean(row, 180)).filter(Boolean))],
    attentionMode: ["passive_wait", "continuous_work"].includes(raw.attentionMode)
      ? raw.attentionMode
      : "passive_wait",
    status,
    durationSeconds,
    accumulatedSeconds,
    startedAtSeconds: finiteNonNegative(raw.startedAtSeconds, activeStartedAtSeconds || 0),
    activeStartedAtSeconds,
    readyAtSeconds,
    interruptedAtSeconds: status === "interrupted" ? finiteNonNegative(raw.interruptedAtSeconds, 0) : null,
    completedAtSeconds: status === "completed" ? finiteNonNegative(raw.completedAtSeconds, 0) : null,
    cancelledAtSeconds: status === "cancelled" ? finiteNonNegative(raw.cancelledAtSeconds, 0) : null,
    sourceActionId: clean(raw.sourceActionId, 180),
    completionActionId: clean(raw.completionActionId, 180),
    interruptionActionIds: [...new Set((raw.interruptionActionIds || []).map((row) => clean(row, 180)).filter(Boolean))],
    resumeActionIds: [...new Set((raw.resumeActionIds || []).map((row) => clean(row, 180)).filter(Boolean))],
    metadata: clone(raw.metadata || {}),
    revision: Math.max(0, Math.floor(finiteNonNegative(raw.revision, 0))),
  };
}

export function durativeWorldProcessProgress(raw = {}, nowSeconds = 0) {
  const process = normalizeDurativeWorldProcess(raw);
  const now = finiteNonNegative(nowSeconds, 0);
  const activeElapsed = process.status === "active"
    ? Math.max(0, Math.min(process.durationSeconds - process.accumulatedSeconds, now - process.activeStartedAtSeconds))
    : 0;
  const elapsedSeconds = Math.min(process.durationSeconds, process.accumulatedSeconds + activeElapsed);
  const remainingSeconds = Math.max(0, process.durationSeconds - elapsedSeconds);
  return {
    elapsedSeconds,
    remainingSeconds,
    progress: process.durationSeconds > 0 ? elapsedSeconds / process.durationSeconds : 1,
  };
}

export function refreshDurativeWorldProcesses(rawProcesses = [], nowSeconds = 0) {
  const now = finiteNonNegative(nowSeconds, 0);
  return (rawProcesses || []).map((raw) => {
    const process = normalizeDurativeWorldProcess(raw);
    if (process.status !== "active" || now < Number(process.readyAtSeconds || Infinity)) return process;
    return {
      ...process,
      status: "ready",
      accumulatedSeconds: process.durationSeconds,
      activeStartedAtSeconds: null,
      readyAtSeconds: null,
      revision: process.revision + 1,
    };
  });
}

export function startDurativeWorldProcess(rawProcesses = [], spec = {}, nowSeconds = 0) {
  const now = finiteNonNegative(nowSeconds, 0);
  if (!clean(spec.id, 180)) return { ok: false, code: "PROCESS_ID_REQUIRED", processes: clone(rawProcesses || []) };
  const refreshed = refreshDurativeWorldProcesses(rawProcesses, now);
  if (refreshed.some((row) => row.id === spec.id && !["completed", "cancelled"].includes(row.status))) {
    return { ok: false, code: "PROCESS_ALREADY_EXISTS", processes: refreshed };
  }
  const process = normalizeDurativeWorldProcess({
    ...clone(spec),
    status: "active",
    accumulatedSeconds: 0,
    startedAtSeconds: now,
    activeStartedAtSeconds: now,
    readyAtSeconds: now + Math.max(1, finiteNonNegative(spec.durationSeconds, 1)),
    revision: 0,
  });
  return { ok: true, process, processes: [...refreshed, process] };
}

export function interruptDurativeWorldProcess(rawProcesses = [], processId = "", nowSeconds = 0, actionId = "") {
  const now = finiteNonNegative(nowSeconds, 0);
  const refreshed = refreshDurativeWorldProcesses(rawProcesses, now);
  const index = refreshed.findIndex((row) => row.id === processId);
  if (index < 0) return { ok: false, code: "PROCESS_NOT_FOUND", processes: refreshed };
  const process = refreshed[index];
  if (process.status !== "active") return { ok: false, code: "PROCESS_NOT_ACTIVE", processes: refreshed, process };
  const progress = durativeWorldProcessProgress(process, now);
  const next = {
    ...process,
    status: "interrupted",
    accumulatedSeconds: progress.elapsedSeconds,
    activeStartedAtSeconds: null,
    readyAtSeconds: null,
    interruptedAtSeconds: now,
    interruptionActionIds: [...new Set([...(process.interruptionActionIds || []), clean(actionId, 180)].filter(Boolean))],
    revision: process.revision + 1,
  };
  const processes = [...refreshed];
  processes[index] = next;
  return { ok: true, process: next, processes };
}

export function resumeDurativeWorldProcess(rawProcesses = [], processId = "", nowSeconds = 0, actionId = "") {
  const now = finiteNonNegative(nowSeconds, 0);
  const refreshed = refreshDurativeWorldProcesses(rawProcesses, now);
  const index = refreshed.findIndex((row) => row.id === processId);
  if (index < 0) return { ok: false, code: "PROCESS_NOT_FOUND", processes: refreshed };
  const process = refreshed[index];
  if (process.status !== "interrupted") return { ok: false, code: "PROCESS_NOT_INTERRUPTED", processes: refreshed, process };
  const remainingSeconds = Math.max(0, process.durationSeconds - process.accumulatedSeconds);
  const next = {
    ...process,
    status: remainingSeconds <= 0 ? "ready" : "active",
    activeStartedAtSeconds: remainingSeconds <= 0 ? null : now,
    readyAtSeconds: remainingSeconds <= 0 ? null : now + remainingSeconds,
    interruptedAtSeconds: null,
    resumeActionIds: [...new Set([...(process.resumeActionIds || []), clean(actionId, 180)].filter(Boolean))],
    revision: process.revision + 1,
  };
  const processes = [...refreshed];
  processes[index] = next;
  return { ok: true, process: next, processes };
}

export function completeDurativeWorldProcess(rawProcesses = [], processId = "", nowSeconds = 0, actionId = "") {
  const now = finiteNonNegative(nowSeconds, 0);
  const refreshed = refreshDurativeWorldProcesses(rawProcesses, now);
  const index = refreshed.findIndex((row) => row.id === processId);
  if (index < 0) return { ok: false, code: "PROCESS_NOT_FOUND", processes: refreshed };
  const process = refreshed[index];
  if (process.status !== "ready") return { ok: false, code: "PROCESS_NOT_READY", processes: refreshed, process };
  const next = {
    ...process,
    status: "completed",
    accumulatedSeconds: process.durationSeconds,
    completedAtSeconds: now,
    completionActionId: clean(actionId, 180),
    revision: process.revision + 1,
  };
  const processes = [...refreshed];
  processes[index] = next;
  return { ok: true, process: next, processes };
}
