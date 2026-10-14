import { assessSimulationIntegrity, restoreProgressRecords } from "./simulationIntegrity.mjs";
import { SUSTAIN_FAILURES } from "./sustenance.mjs";
import { EXCHANGE_FAILURES } from "./exchange.mjs";
import { PURSUIT_FAILURES } from "./pursuit.mjs";
const EFFECT_LABELS = {
  speech_emitted: "话语已发出", speech_delivered: "话语已投递",
  actor_movement: "人物已移动", actor_resting: "人物休息",
  object_transferred: "物品已转交", object_handled: "物品操作已结算",
  work_unit_started: "工作步骤已开始", work_unit_completed: "工作步骤已完成", work_sound_emitted: "劳动声音已产生",
  delivery_accepted: "交付物已由收件人验收",
  actor_wait_registered: "等待条件已登记", prepared_service_served: "服务物品已端送",
};
export const FAILURE_LABELS = {
  OBJECT_NOT_IN_HAND: "物品尚未拿在手中",
  OBJECT_NOT_HELD: "未持有该物品",
  MOVE_BLOCKED_BY_FLOOD: "水太深，过不去",
  MOVE_HELD: "被人抓着，挣不脱",
  CONFRONT_TARGET_NOT_HERE: "对方不在身边",
  CONFRONT_TARGET_DOWN: "对方已经倒在地上",
  MARRY_TARGET_UNKNOWN: "没有这个人",
  MARRY_TARGET_NOT_HERE: "对方不在身边",
  MARRY_TARGET_DOWN: "对方倒在地上",
  MARRY_NOT_GROWN: "还没成年",
  MARRY_ALREADY_MARRIED: "已经成过家了",
  MARRY_KIN: "是亲人，不能成亲",
  MARRY_NO_PROPOSAL: "对方没有向你求过亲",
  ...SUSTAIN_FAILURES,
  ...EXCHANGE_FAILURES,
  ...PURSUIT_FAILURES,
};
const text = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll("|", "\\|").replace(/\r?\n/gu, " ");

export function compactSettledTurnRecord(turn, { characterName = turn.characterId, index } = {}) {
  const outcome = turn.outcome || {};
  const effects = [...new Set((outcome.resolvedEffects || []).map(row => row.kind))];
  return { index, agentTurnId: turn.agentTurnId, characterId: turn.characterId, characterName,
    turnKind: turn.privateResult?.turnKind || "action", wakeKind: turn.wake?.kind || "",
    // Private: shown to the operator as an intention, never as a settled fact.
    intention: String(turn.privateResult?.worldBridge?.selectedCandidate?.intention || turn.privateResult?.decision?.privateDecisionBasis || "").trim().slice(0, 240),
    speech: effects.includes("speech_emitted") ? (outcome.committedFacts || []).filter(row => row.kind === "utterance_emitted").map(row => row.utterance || "").join("\n") : "",
    visibleAction: [...new Set((outcome.attemptSurface || []).map(row => row.visibleAction).filter(Boolean))].join("；"),
    hasWorldAttempt: Boolean(turn.actionAttempt), hasWorldOutcome: Boolean(turn.outcome),
    outcome: { primitive: outcome.primitive || "", status: outcome.status || "", worldVersion: outcome.worldVersion ?? null },
    movementDestination: (outcome.resolvedEffects || []).find(row => row.kind === "actor_movement")?.toZoneId || "",
    resolvedEffectKinds: effects, failureCodes: [...new Set((outcome.failedEffects || []).map(row => row.code).filter(Boolean))],
    ...(turn.privateResult?.innerChanges?.length ? { inner: structuredClone(turn.privateResult.innerChanges) } : {}),
    ...(Array.isArray(turn.privateResult?.body) ? { body: [...turn.privateResult.body] } : {}) };
}

export function reconcileSettledTurnRecords(checkpoint = {}, existing = []) {
  const byId = new Map(existing.filter(row => row.agentTurnId).map(row => [row.agentTurnId, structuredClone(row)]));
  for (const record of checkpoint.completedTurnRecords || []) {
    if (byId.has(record.agentTurnId)) continue;
    if (record.publicSummary) byId.set(record.agentTurnId, { ...structuredClone(record.publicSummary), recoveredFromCheckpoint: true });
  }
  return [...existing.filter(row => !row.agentTurnId), ...byId.values()].map((row, index) => ({ ...row, index: index + 1 }));
}

export function summarizeSettledSimulation({ checkpoint = {}, turns = [], requestedTurns = null, calls = [], runtimeError = null, running = false } = {}) {
  const state = checkpoint.coordinator?.worldState || {};
  const objects = state.objects || {};
  const effects = (checkpoint.coordinator?.journal?.events || []).flatMap(row => row.publicPayload?.resolvedEffects || []);
  const actors = (checkpoint.actors || []).map(row => ({ characterId: row.characterId, status: row.executionControl?.status || "active",
    waiting: row.executionControl?.waiting || null, reason: row.executionControl?.reason || null, urgentBlocks: row.executionControl?.urgentBlocks || 0 }));
  const integrity = assessSimulationIntegrity({ actors: checkpoint.actors || [], records: checkpoint.completedTurnRecords?.length ? restoreProgressRecords(checkpoint.completedTurnRecords, checkpoint.coordinator?.outcomes || []) : turns });
  const stopReason = integrity?.stopReason || (runtimeError ? "runtime_error" : requestedTurns != null && turns.filter(row => row.turnKind !== "own_plan_step").length >= requestedTurns ? "turn_limit_reached"
    : running ? null : actors.some(row => row.status === "suspended_model_error") ? "suspended_model_error"
      : actors.some(row => row.status === "stalled") ? "stalled" : "waiting");
  const objectState = id => objects[id]?.state || {};
  const parcel = id => objects[id] ? { holderCharacterId: objects[id].holderCharacterId || "", zoneId: objects[id].zoneId || "", accepted: objectState(id).accepted === true } : null;
  // A world pack names its own objective metrics; older saves have none and keep the tavern summary.
  const packReport = state.worldPackMeta?.report || null;
  const metrics = (packReport?.metrics || []).map(metric => {
    const object = objects[metric.objectId];
    const value = metric.kind === "holder"
      ? (object?.holderCharacterId ? state.entities?.[object.holderCharacterId]?.name || object.holderCharacterId : "无人持有")
      : object?.state?.[metric.stateKey] ?? null;
    return { label: metric.label, value, unit: metric.unit || "", target: metric.target ?? null };
  });
  return { stopReason, integrity, qualityVerdict: "not_evaluated", modelCallCountMeaning: "stage_invocations_not_provider_attestation", scenarioComplete: null, scenarioCompletionEvaluated: false,
    worldElapsedSeconds: Number(state.nowSeconds || 0), pacingMode: state.timePolicy?.mode || "day",
    timeConstraints: (state.temporalAgenda || []).map(row => ({ id: row.id, label: row.label, dueAtSeconds: row.dueAtSeconds, status: row.status,
      delayedSeconds: Math.max(0, Number(row.resolvedAtSeconds ?? state.nowSeconds ?? 0) - row.dueAtSeconds) })),
    completedWorkStepsScope: "checkpoint_world_history",
    completionMeaning: "A turn budget ends a run; it does not establish the characters' goals or the scenario's completion.",
    counts: { characterDecisions: turns.filter(row => row.turnKind !== "own_plan_step").length, ownPlanSteps: turns.filter(row => row.turnKind === "own_plan_step").length,
      actionDecisions: turns.filter(row => row.turnKind === "action").length,
      privateMaintenance: turns.filter(row => !["action", "own_plan_step"].includes(row.turnKind)).length,
      modelCalls: calls.length, rejectedCalls: calls.filter(row => row.accepted === false || row.validation === "rejected").length,
      worldAttempts: turns.filter(row => row.hasWorldAttempt).length,
      success: turns.filter(row => row.outcome?.status === "success").length,
      partial: turns.filter(row => row.outcome?.status === "partial").length, failed: turns.filter(row => row.outcome?.status === "failed").length,
      completedWorkSteps: effects.filter(row => row.kind === "work_unit_completed").length },
    objectiveState: {
      firewood: { unprocessedBundles: objectState("tavern_resource_unprocessed_firewood").unprocessedBundles ?? null,
        processedBundles: objectState("tavern_resource_sheltered_firewood").processedBundles ?? null },
      water: { vatFill: objectState("tavern_resource_water_vat").fill ?? null, bucketFill: objectState("tavern_tool_water_bucket").fill ?? null,
        sourceBuckets: objectState("tavern_resource_courtyard_water").availableBuckets ?? null },
      parcel: parcel("tavern_delivery_medicine_parcel"), manifest: parcel("tavern_delivery_manifest"),
      vessels: Object.values(objects).filter(row => row.state?.vesselType).map(row => ({ id: row.id, contents: row.state.contents, holderCharacterId: row.holderCharacterId || "" })),
      sharedActivities: (Array.isArray(state.sharedActivities) ? state.sharedActivities : Object.values(state.sharedActivities || {})).map(row => ({ id: row.id || row.activityId, status: row.status })),
      ...(packReport ? { metrics } : {}),
    }, reportRenderer: packReport?.renderer || "legacy-tavern", actors };
}

export function describeSettledTurn(turn) {
  if (turn.turnKind === "reflection") return "私人反思，没有公开行动";
  if (turn.turnKind !== "action") return "私人维护回合，没有公开行动";
  const status = turn.outcome?.status;
  if (!status) return "没有世界行动结算";
  const statusLabel = { success: "成功", partial: "部分成功", failed: "失败" }[status] || status;
  const failures = [...new Set(turn.failureCodes || [])].map(code => FAILURE_LABELS[code] || code);
  const effects = [...new Set(turn.resolvedEffectKinds || [])].map(kind => EFFECT_LABELS[kind] || kind);
  return [`结算：${statusLabel}`, failures.length ? `失败原因：${failures.join("、")}` : "",
    effects.length ? `生效部分：${effects.join("、")}` : ""].filter(Boolean).join("；");
}

// Public chronology comes exclusively from settled summaries. In particular,
// intentions, rejected drafts and private reflections cannot supply dialogue.
export function renderSettledSimulationReport(turns, provenance = {}, summary = null) {
  const lines = ["# 模拟结算记录", "", `已结算 ${turns.length} 个人物回合。模型来源：${text(provenance.kind || "未记录")}。`, "",
    "下表依据世界结算列出公开对白和结果。意图、拒绝稿和私人信念不作为已发生的行为。",
    provenance.runPurpose === "rehearsal" || ["fixture", "external-unverified"].includes(provenance.kind) ? "排练或来源未验证：不能作为真实模型叙事测试通过的证据。" : "API 来源记录不等于叙事质量验收；继承历史需单独核验。", "",
    "| 回合 | 人物 | 已结算对白 | 结果 |", "|---|---|---|---|"];
  for (const turn of turns) {
    const speech = turn.turnKind === "action" && turn.resolvedEffectKinds?.includes("speech_emitted") ? turn.speech : "";
    lines.push(`| ${text(turn.index)} | ${text(turn.characterName || turn.characterId)} | ${text(speech || "—")} | ${text(describeSettledTurn(turn))} |`);
  }
  if (summary) lines.push("", `停止原因：${text(summary.stopReason || "运行中")}。没有据回合数判定剧情完成。`, "",
    `本报告人物决策 ${summary.counts.characterDecisions} 次；世界行动成功 ${summary.counts.success}、部分成功 ${summary.counts.partial}、失败 ${summary.counts.failed}；存档累计实际完成工作步骤 ${summary.counts.completedWorkSteps}。`);
  if (summary && summary.reportRenderer === "pack-metrics") lines.push("", ...(summary.objectiveState.metrics || []).map(row =>
    `${text(row.label)}：${text(row.value ?? "未知")}${row.unit ? ` ${text(row.unit)}` : ""}${row.target != null ? `（目标 ${text(row.target)}）` : ""}`));
  else if (summary) lines.push("",
    `柴：未加工 ${summary.objectiveState.firewood.unprocessedBundles ?? "未知"} 束，成柴 ${summary.objectiveState.firewood.processedBundles ?? "未知"} 束。水缸：${summary.objectiveState.water.vatFill ?? "未知"}；桶：${summary.objectiveState.water.bucketFill ?? "未知"}。`, "",
    `药包验收：${summary.objectiveState.parcel?.accepted ? "已记录" : "未记录"}；清单验收：${summary.objectiveState.manifest?.accepted ? "已记录" : "未记录"}。`);
  if (summary?.worldElapsedSeconds != null) lines.push("", `故事时间已推进 ${text(summary.worldElapsedSeconds)} 秒。`,
    ...(summary.timeConstraints || []).map(row => `时间事项：${text(row.label)}；期限 ${text(row.dueAtSeconds)} 秒，状态 ${text(row.status)}，超时 ${text(row.delayedSeconds)} 秒。`));
  return lines.join("\n") + "\n";
}
