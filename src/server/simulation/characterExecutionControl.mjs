import { submissionDigest } from "./characterTurnExecution.mjs";

export const waitConditionSchema = {
  type: "object", additionalProperties: false,
  required: ["condition", "maximumSeconds", "interruptOnDirectSpeech"],
  properties: {
    condition: { type: "string", enum: ["deadline", "new_evidence", "target_speech", "own_process_ready"] },
    maximumSeconds: { type: "number", minimum: 1, maximum: 86400 },
    interruptOnDirectSpeech: { type: "boolean" },
  },
  description: "仅 wait 使用。本人选择等待条件和最长秒数；target_speech 使用当前绑定的人物，own_process_ready 必须有本人现存过程。到期或条件触发后本人重新决定，不重复调用维持姿态。",
};
const copy = value => structuredClone(value);
// A thought 天意 puts in someone's head, and the turns of life and death around them (someone falls, a blow,
// the water taking someone, a proposal, a birth), are real changes worth deciding again over.
const LIFE_CHANGING_EVENTS = ["urge", "health_changed", "confrontation", "flood_hazard", "marriage", "life_event", "woke"];
export function isExecutionProgressEvidence(row = {}) {
  return ["owned_process_ready", "work_unit_completed", "service_prepared", "delivery_accepted", "world_deadline_warning", "world_deadline_due", ...LIFE_CHANGING_EVENTS].includes(row.eventKind)
    || (row.eventKind === "object_handling" && row.semanticFrame?.objectHandling?.changesState === true);
}
export function validWaitCondition(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === 3 && waitConditionSchema.properties.condition.enum.includes(value.condition)
    && typeof value.maximumSeconds === "number" && Number.isFinite(value.maximumSeconds)
    && value.maximumSeconds >= 1 && value.maximumSeconds <= 86400 && typeof value.interruptOnDirectSpeech === "boolean";
}
export function initialExecutionControl(saved = {}) {
  return { status: "active", waiting: null, maintenanceDeferrals: {}, urgentBlocks: 0,
    repeatedCount: 0, lastFingerprint: "", reviewPending: false, reviewCompleted: false, recentEvidence: [],
    waitTimeouts: 0, waitedSecondsWithoutChange: 0, lastWaitResolution: null, passiveHistory: [], passiveRevisits: 0,
    failureHistory: [], failureRevisits: 0, ...copy(saved) };
}
export function urgentWake(wake = {}) {
  return wake.urgent === true || (wake.evidence || []).some(row => row.urgent === true);
}
export function waitMatchesWake(wait, wake = {}) {
  if (!wait || urgentWake(wake) || (wake.kind === "reflection_due" && wake.executionReview === true)) return true;
  if (wake.kind === "wait_deadline") return Boolean(wait.registeredByAttemptId)
    && wake.wakeId === `wake:wait:${wait.registeredByAttemptId}`;
  const evidence = wake.evidence || [];
  const direct = evidence.some(row => row.eventKind === "speech" && row.directed === true);
  if (wait.interruptOnDirectSpeech && direct) return true;
  if (wait.condition === "new_evidence") return evidence.some(row => !["own_action_result", "observation_result", "listening_result"].includes(row.eventKind));
  if (wait.condition === "target_speech") return evidence.some(row => row.eventKind === "speech" && row.sourceCharacterId === wait.targetCharacterId);
  if (wait.condition === "own_process_ready") return evidence.some(row => row.eventKind === "owned_process_ready" && wait.processIds.includes(row.processId));
  return false;
}
const maintenance = wake => ["reflection_due", "plan_due", "day_planning_due"].includes(wake.causeType || wake.kind);
export function promoteDueMaintenance(actor, maximumDeferrals = 3) {
  if (actor.inFlightWake || actor.pendingTurn || actor.activeTurnId) return;
  const control = actor.executionControl;
  const index = actor.mailbox.findIndex(row => maintenance(row) && (
    control.maintenanceDeferrals[row.wakeId] >= maximumDeferrals
    || (control.reviewPending && row.kind === "reflection_due")
  ));
  if (index <= 0) return;
  if (urgentWake(actor.mailbox[0])) { control.urgentBlocks += 1; return; }
  actor.mailbox.unshift(...actor.mailbox.splice(index, 1));
}
export function recordMaintenanceOpportunity(actor, turn) {
  const control = actor.executionControl;
  if (control.lastMaintenanceTurnId === turn.agentTurnId) return;
  control.lastMaintenanceTurnId = turn.agentTurnId;
  const pending = new Set(actor.mailbox.filter(maintenance).map(row => row.wakeId));
  for (const id of Object.keys(control.maintenanceDeferrals)) if (!pending.has(id)) delete control.maintenanceDeferrals[id];
  if (urgentWake(turn.wake)) return;
  for (const id of pending) control.maintenanceDeferrals[id] = (control.maintenanceDeferrals[id] || 0) + 1;
}

// Only objective material/spatial state and actually delivered semantic evidence
// count here. Clock ticks, new ids and reworded bodily drafts cannot reset a loop.
export function materialStateDigest(state = {}, characterId) {
  const actor = state.entities?.[characterId] || {};
  return submissionDigest({ placeId: actor.placeId, zoneId: actor.zoneId, positionId: actor.positionId,
    objects: Object.values(state.objects || {}).filter(row => (row.placeId === actor.placeId && row.zoneId === actor.zoneId) || row.holderCharacterId === characterId)
      .map(row => ({ id: row.id, holder: row.holderCharacterId, zone: row.zoneId, state: row.state, custody: row.custody })),
    processes: (state.processes || []).filter(row => row.ownerActorId === characterId).map(row => ({ id: row.id, status: row.status, progress: row.progress, completedUnits: row.completedUnits })),
  });
}
export function recordExecutionProgress(actor, turn, { beforeMaterial, afterMaterial, beforeBody = {}, nowSeconds, repeatedWaitReviewLimit = 0 }) {
  const control = actor.executionControl;
  if (control.lastRecordedTurnId === turn.agentTurnId) return;
  control.lastRecordedTurnId = turn.agentTurnId;
  if (turn.privateResult?.turnKind === "reflection") {
    if (control.reviewPending) { control.reviewPending = false; control.reviewCompleted = true; }
    return;
  }
  if (["day_planning", "own_plan_step"].includes(turn.privateResult?.turnKind)) return;
  // A reconsideration settled inside an ordinary beat completes the review;
  // the beat's own action is still accounted for below.
  if (turn.privateResult?.reflectionCompleted && control.reviewPending) { control.reviewPending = false; control.reviewCompleted = true; }
  const primitive = turn.actionAttempt?.primitive || "none";
  if (primitive === "wait" && turn.outcome?.status === "success") {
    const registration = turn.outcome.resolvedEffects.find(row => row.kind === "actor_wait_registered");
    const last = control.lastWaitResolution;
    // Lying unconscious is not waiting on anything: it never counts toward a review of idle waiting.
    const unconscious = turn.privateResult?.turnKind === "body_beat";
    if (last?.timedOut && last.materialUnchanged && !unconscious) {
      control.waitTimeouts += 1;
      control.waitedSecondsWithoutChange += last.elapsedSeconds;
    } else if (last && !last.executionReview) {
      control.waitTimeouts = 0; control.waitedSecondsWithoutChange = 0; control.reviewCompleted = false;
    }
    control.lastWaitResolution = null;
    control.waiting = registration ? { ...copy(registration), startedAtSeconds: nowSeconds, materialDigest: afterMaterial } : null;
    control.repeatedCount = 0;
    if (repeatedWaitReviewLimit > 0 && control.waitTimeouts >= repeatedWaitReviewLimit) {
      if (control.reviewCompleted) {
        control.status = "stalled";
        control.reason = { code: "REPEATED_WAIT_WITHOUT_CHANGE", agentTurnId: turn.agentTurnId, waitTimeouts: control.waitTimeouts,
          waitedSeconds: control.waitedSecondsWithoutChange };
      } else requestExecutionReview(actor, turn, nowSeconds,
        `本人已经等了 ${control.waitedSecondsWithoutChange} 秒，连续 ${control.waitTimeouts} 次期限到达仍没有相关事实变化。请依据真实所见、尚未完成的愿望与时间后果重新判断；继续等待也可以，但不能把承诺或倒计时本身算成完成。`);
    } else control.reviewCompleted = false;
    return;
  }
  const evidenceRows = (turn.wake?.evidence || [])
    .filter(row => !["own_action_result", "observation_result", "listening_result"].includes(row.eventKind));
  const semanticEvidence = evidenceRows
    .map(row => submissionDigest({ source: row.sourceCharacterId, kind: row.eventKind, content: row.content, object: row.sourceObjectId, process: row.processId }));
  const novelEvidence = semanticEvidence.some(key => !control.recentEvidence.includes(key));
  const objectiveChange = evidenceRows.some((row, index) => !control.recentEvidence.includes(semanticEvidence[index])
    && isExecutionProgressEvidence(row));
  control.recentEvidence = [...new Set([...control.recentEvidence, ...semanticEvidence])].slice(-128);
  const body = actor.privateState.ecologyState?.body || {};
  const recovered = ["fatigue", "pain"].some(key => Number(beforeBody[key]) - Number(body[key]) > 0.00001)
    || Number(body.stamina) - Number(beforeBody.stamina) > 0.00001;
  if (beforeMaterial !== afterMaterial || objectiveChange || (turn.outcome?.status === "success" && (primitive === "practice" || (primitive === "rest" && recovered)))) {
    control.repeatedCount = 0; control.lastFingerprint = ""; control.reviewCompleted = false;
    control.waitTimeouts = 0; control.waitedSecondsWithoutChange = 0; control.lastWaitResolution = null;
    control.passiveHistory = []; control.passiveRevisits = 0;
    control.failureHistory = []; control.failureRevisits = 0; return;
  }
  const payload = turn.actionAttempt?.payload || {};
  const fingerprint = submissionDigest({ primitive, target: payload.targetId || payload.targetCharacterId,
    object: payload.objectId, destination: payload.destinationId, operation: payload.operation, affordance: payload.affordanceId,
    status: turn.outcome?.status, effects: (turn.outcome?.resolvedEffects || []).map(row => row.kind).sort(),
    failures: (turn.outcome?.failedEffects || []).map(row => row.code).sort() });
  const contactOnly = primitive === "handle" && ["touch", "interact"].includes(payload.operation);
  const passive = ["observe", "listen", "rest", "none"].includes(primitive) || contactOnly;
  // A failed attempt with identical parameters and identical failure codes is
  // an independent loop: unrelated new conversation cannot clear it, exactly
  // like the passive cycle above. Only changed facts may.
  const failedAction = turn.outcome?.status === "failed";
  if (failedAction) {
    const revisited = control.failureHistory.includes(fingerprint);
    control.failureRevisits = revisited ? control.failureRevisits + 1 : 0;
    if (!revisited) control.reviewCompleted = false;
    control.failureHistory = [...new Set([...control.failureHistory, fingerprint])].slice(-16);
    if (control.failureRevisits >= 3) {
      const failureCodes = (turn.outcome?.failedEffects || []).map(row => row.code).sort();
      if (control.reviewCompleted) {
        control.status = "stalled";
        control.reason = { code: "REPEATED_FAILURE_WITHOUT_CHANGE", agentTurnId: turn.agentTurnId,
          revisits: control.failureRevisits, failureCodes };
        return;
      }
      requestExecutionReview(actor, turn, nowSeconds,
        `本人已经用完全相同的方式连续失败 ${control.failureRevisits + 1} 次${failureCodes.length ? `（失败代码：${failureCodes.join("、")}）` : ""}。旁人的新话语不会改变这些失败前提。请核对动作的真实前提、本人当前位置与结构化参数，由本人决定改变做法、补齐前提，或等待相关事实变化；原样重试只会继续失败。`);
      return;
    }
  }
  if (repeatedWaitReviewLimit > 0 && passive) {
    const revisited = control.passiveHistory.includes(fingerprint);
    control.passiveRevisits = revisited ? control.passiveRevisits + 1 : 0;
    control.passiveHistory = [...new Set([...control.passiveHistory, fingerprint])].slice(-16);
    if (control.passiveRevisits >= 3) {
      if (control.reviewCompleted) {
        control.status = "stalled";
        control.reason = { code: "PASSIVE_CYCLE_WITHOUT_CHANGE", agentTurnId: turn.agentTurnId, revisits: control.passiveRevisits };
      } else requestExecutionReview(actor, turn, nowSeconds, "本人反复看、听、休息或仅触碰物品，没有实际工作进度或身体恢复。旁人的新话语不等于这些事情已经完成。请回看可见物品状态、尚未完成的事情和已经过去的时间，由本人重新决定是否继续这样做。");
      return;
    }
  }
  // New conversation can make another social response useful. It does not
  // erase the independent history of cycling through passive physical acts,
  // nor the record of repeating an identical failed attempt.
  if (novelEvidence && !failedAction && (!passive || repeatedWaitReviewLimit <= 0)) {
    control.repeatedCount = 0; control.lastFingerprint = "";
    return;
  }
  control.repeatedCount = fingerprint === control.lastFingerprint ? control.repeatedCount + 1 : 1;
  if (fingerprint !== control.lastFingerprint) control.reviewCompleted = false;
  control.lastFingerprint = fingerprint;
  if (control.repeatedCount < 3) return;
  if (control.reviewCompleted || control.repeatedCount > 3) {
    control.status = "stalled";
    control.reason = { code: "REPEATED_ACTION_WITHOUT_PROGRESS", agentTurnId: turn.agentTurnId, repeatedCount: control.repeatedCount };
    return;
  }
  requestExecutionReview(actor, turn, nowSeconds, "连续等价行动未带来新证据或相关效果。请只依据本人的真实经历重新判断；程序没有替你指定下一步。");
}

function requestExecutionReview(actor, turn, nowSeconds, reason) {
  actor.executionControl.reviewPending = true;
  const state = actor.privateState.reflectionState || { ownerCharacterId: actor.characterId };
  if (state.pendingOpportunity?.status === "due") { state.pendingOpportunity.executionReviewReason = reason; return; }
  const sources = (actor.privateState.memoryContext?.episodes || []).filter(row => row.id && (!row.ownerCharacterId || row.ownerCharacterId === actor.characterId)).slice(-6);
  const sequence = state.nextOpportunitySequence || 1;
  actor.privateState.reflectionState = { ...state, nextOpportunitySequence: sequence + 1,
    pendingOpportunity: { ownerCharacterId: actor.characterId, opportunityId: `execution-review:${actor.characterId}:${turn.agentTurnId}`,
      sequence, status: "due", dueAtSeconds: nowSeconds, accumulatedImportance: 0, sourceMemoryIds: sources.map(row => row.id),
      sourceMemorySnapshots: copy(sources), decisionAuthority: "character-agent", selection: null,
      executionReviewReason: reason } };
}
