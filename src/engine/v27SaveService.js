function clone(value) { return structuredClone(value); }
function identity(ref) { return JSON.stringify([ref.projectId, ref.branchId, ref.runtimeId]); }
function isV27(ref) { return /^tavern-v27(?:-model)?:/u.test(ref?.runtimeId || ""); }
function uniqueId() { return globalThis.crypto.randomUUID(); }

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error || "服务端存档操作失败。");
    error.code = payload?.code;
    throw error;
  }
  return payload;
}

function endpoint(ref, operation) {
  const mode = ref.runtimeId.startsWith("tavern-v27-model:") ? "model-session" : "session";
  return `/api/v27/tavern/${mode}/${operation}`;
}

function sessionRows(state) {
  const rows = (state.branches || []).flatMap(branch => branchRuntime(branch).sessions);
  // Top-level rows are the current active branch's most recent cursor.
  rows.push(...(state.runtimeSessions || []));
  return [...new Map(rows.filter(isV27).map(row => [identity(row), row])).values()];
}

function branchRuntime(branch) {
  return {
    sessions: branch.runtimeClientState?.sessions || branch.snapshot?.runtimeSessions || [],
    observations: branch.runtimeClientState?.observations || branch.snapshot?.runtimeObservations || [],
  };
}

function assertSettled(state) {
  if (state.ui?.v27Running || sessionRows(state).some(row => row.pendingCommand)) {
    throw new Error("请先完成或重试待决人物回合，再保存或读取存档。");
  }
}

/** Freeze complete server checkpoints; the browser stores opaque references only. */
export async function captureV27SaveState(source, { request = postJson } = {}) {
  const state = clone(source);
  assertSettled(state);
  state.runtimeSnapshots = await Promise.all(sessionRows(state).map(async ref => {
    const result = await request(endpoint(ref, "snapshot"), {
      projectId: ref.projectId, branchId: ref.branchId, runtimeId: ref.runtimeId,
      sessionId: ref.sessionId, expectedRevision: ref.sessionRevision,
      commandId: `snapshot:${uniqueId()}`,
    });
    return result.snapshotRef;
  }));
  return state;
}

/**
 * Restore into independent sessions so loading the same save twice is safe.
 * All branches, history and cursors are rebound together before store import.
 */
export async function restoreV27SaveState(source, { request = postJson, instanceIdFactory = uniqueId } = {}) {
  let state = typeof source === "string" ? JSON.parse(source) : clone(source);
  assertSettled(state);
  const rows = sessionRows(state);
  // Older saves can recover only if their exact server generation survives.
  // Never silently bind a stale observation to the latest running world.
  if (!Array.isArray(state.runtimeSnapshots) && rows.length) state = await captureV27SaveState(state, { request });
  const snapshots = new Map((state.runtimeSnapshots || []).map(ref => [identity(ref), ref]));
  const runtimeInstanceId = instanceIdFactory();
  const replacements = new Map();
  await Promise.all(rows.map(async ref => {
    const saved = snapshots.get(identity(ref));
    if (!saved || saved.sessionId !== ref.sessionId || saved.sessionRevision !== ref.sessionRevision
      || saved.worldVersion !== ref.worldVersion) throw new Error("存档缺少对应的服务端快照，无法完整恢复。");
    const runtimeId = `${ref.runtimeId.startsWith("tavern-v27-model:") ? "tavern-v27-model" : "tavern-v27"}:${runtimeInstanceId}`;
    const result = await request(endpoint(ref, "restore"), {
      projectId: ref.projectId, branchId: ref.branchId, runtimeId,
      commandId: `restore:${runtimeInstanceId}`, expectedRevision: 0, snapshotRef: saved,
    });
    replacements.set(identity(ref), {
      ...result.sessionRef, sessionRevision: result.sessionRevision, worldVersion: result.worldVersion,
      runtimeInstanceId, pendingCommand: null, updatedAt: new Date().toISOString(),
    });
  }));
  function rebindSessions(sessions = []) {
    return sessions.filter(isV27).map(row => clone(replacements.get(identity(row))));
  }
  function rebindObservation(observation, replacement) {
    return observation && replacement ? {
      ...clone(observation), sessionRef: clone(replacement), worldVersion: replacement.worldVersion,
    } : null;
  }
  function rebindObservations(observations = []) {
    return observations.filter(row => replacements.has(identity(row))).map(row => {
      const replacement = replacements.get(identity(row));
      return { ...clone(row), runtimeId: replacement.runtimeId, runtimeInstanceId,
        observation: rebindObservation(row.observation, replacement) };
    });
  }
  const activeBefore = (state.branches || []).find(branch => branch.id === (state.ui?.activeBranchId || state.project?.activeBranchId));
  state.runtimeSessions = rebindSessions(state.runtimeSessions || branchRuntime(activeBefore || {}).sessions);
  state.runtimeObservations = rebindObservations(state.runtimeObservations || branchRuntime(activeBefore || {}).observations);
  state.branches = (state.branches || []).map(branch => ({
    ...branch,
    runtimeClientState: {
      schemaVersion: 1,
      sessions: rebindSessions(branchRuntime(branch).sessions),
      observations: rebindObservations(branchRuntime(branch).observations),
    },
  }));
  const active = state.branches.find(branch => branch.id === (state.ui?.activeBranchId || state.project?.activeBranchId));
  if (active) active.runtimeClientState = { schemaVersion: 1, sessions: clone(state.runtimeSessions), observations: clone(state.runtimeObservations) };
  state.project = { ...state.project, runtimeInstanceId };
  state.ui = { ...state.ui, v27Running: false, npcActivityRunning: false, npcActivityStatus: "stopped",
    v27Observation: state.runtimeObservations.find(row => row.runtimeId === `tavern-v27:${runtimeInstanceId}`)?.observation || null };
  delete state.runtimeSnapshots;
  return state;
}
