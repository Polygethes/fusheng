import { nextWorldTemporalBoundary, resolveWorldTemporalAgenda, temporalDeadlineDeliveries } from "./worldTemporalAgenda.mjs";
import { dueEnvironmentChange, environmentDeliveries, environmentView } from "./worldEnvironmentEvents.mjs";
import { dueLifeEvent, lifeEventOutcome } from "./lifeCycle.mjs";
import { dueWaking, wakingOutcome, rousedBy } from "./sleep.mjs";
import { floodHazards } from "./naturalHazards.mjs";
import { validateWorldEvent, settleWorldEvent } from "./worldEvents.mjs";
import {
  appendWorldEvent,
  createWorldEventJournal,
  validateWorldEventJournal,
} from "./worldEventJournal.mjs";
import { applyWorldStatePatch } from "./worldActionRegistry.mjs";
import { refreshDurativeWorldProcesses } from "./durativeWorldProcess.mjs";
import { submissionDigest } from "./characterTurnExecution.mjs";
import { observeObjectPhysicalState, describeObjectPhysicalState } from "./objectPhysicalObservation.mjs";

export const WORLD_COMMIT_COORDINATOR_VERSION = "world-commit-coordinator-v1";

const PRIVATE_PAYLOAD_KEYS = new Set([
  "privateReason",
  "privateDecisionBasis",
  "psychology",
  "psychologySnapshot",
  "regulationChoice",
  "worldPatch",
  "worldState",
  "statePatch",
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

function ownActionResultDelivery({ attempt = {}, resolution = {}, eventId = "", occurredAtSeconds = 0, worldState = {}, settledWorldState = {} } = {}) {
  const status = clean(resolution.status || "failed");
  const failureCodes = unique((resolution.failedEffects || []).map((row) => row?.code));
  const resolvedEffectKinds = unique((resolution.resolvedEffects || []).map((row) => row?.kind));
  const incidentalEffectKinds = unique((resolution.incidentalEffects || []).map((row) => row?.kind));
  const attemptSurfaceKinds = unique((resolution.attemptSurface || []).map((row) => row?.kind));
  const baseContent = status === "success"
    ? "刚才的动作已经落定。"
    : status === "partial"
      ? "刚才的动作只完成了一部分。"
      : "刚才的动作没有完成。";
  const handling = (resolution.attemptSurface || []).find(row => row.kind === "object_handling_attempted");
  const objectFailureCodes = unique((resolution.failedEffects || [])
    .filter(row => handling && (row.objectId === handling.objectId
      || (!row.objectId && /^(OBJECT_|TRANSFER_|STORAGE_|CONTAINER_)/u.test(clean(row.code)))))
    .map(row => row.code));
  const operation = clean(handling?.operation);
  const workStarted = resolvedEffectKinds.includes("work_unit_started");
  const workCompleted = resolvedEffectKinds.includes("work_unit_completed");
  const deliveryAccepted = resolvedEffectKinds.includes("delivery_accepted");
  const observer = settledWorldState.entities?.[attempt.actorId] || {};
  const objectIds = unique([handling?.objectId, ...(resolution.resolvedEffects || []).map(row => row.objectId)]);
  const observedObjects = objectIds.flatMap(objectId => {
    const object = settledWorldState.objects?.[objectId];
    // Other people's objects use recipient-specific opaque handles in the
    // scene projection; do not reveal their canonical identities here.
    if (object?.holderCharacterId && object.holderCharacterId !== attempt.actorId) return [];
    const state = observeObjectPhysicalState(object, observer);
    return Object.keys(state).length ? [{ objectId, label: clean(object.perception?.publicLabel || object.label || "目标物品"),
      state, description: describeObjectPhysicalState(state) }] : [];
  });
  const resourceChanges = observedObjects.flatMap(row => {
    const before = observeObjectPhysicalState(worldState.objects?.[row.objectId], worldState.entities?.[attempt.actorId]);
    return Object.keys(row.state).filter(field => Object.hasOwn(before, field) && before[field] !== row.state[field])
      .map(field => ({ objectId: row.objectId, field, before: before[field], after: row.state[field] }));
  });
  const operationLabel = ({ show: "展示", transfer: "递交", take_out: "取出", pickup: "拿起",
    place: "放下", store: "收起", hide: "藏起", draw: "拔出", sheathe: "收回" })[operation] || "物品操作";
  const details = [];
  if (resolvedEffectKinds.includes("speech_emitted")) details.push("话已经说出。");
  if (handling && !objectFailureCodes.length && ["touch", "interact"].includes(operation)
    && resolvedEffectKinds.includes("object_handled") && !(resolution.statePatch?.operations || []).length) {
    details.push("本次仅触碰了目标物品，没有启动工作，也没有改变物料、容器内容或交付状态。");
  }
  if (workStarted) details.push("已经开始这一单位工作，尚未完成；需要等到过程就绪再收尾。");
  if (workCompleted) details.push("这一单位工作已经实际完成。");
  if (deliveryAccepted) details.push("已实际核对并验收本次指定的这一件物品。");
  if (handling && !objectFailureCodes.length && ["place", "transfer"].includes(operation)) {
    details.push("只移动了本次指定的这一件物品；递交或放下不等于收件人验收。");
  }
  for (const row of observedObjects) details.push(`${row.label}当前可见状态：${row.description}。`);
  for (const row of resourceChanges) details.push(`${observedObjects.find(object => object.objectId === row.objectId)?.label || "目标物品"}实际变化：${describeObjectPhysicalState({ [row.field]: row.before })} → ${describeObjectPhysicalState({ [row.field]: row.after })}。`);
  if (handling && objectFailureCodes.length) {
    const object = worldState.objects?.[handling.objectId];
    // A failed attempt must not reveal another holder's hidden inventory.
    const ownObject = object?.holderCharacterId === attempt.actorId;
    const label = ownObject ? clean(object.label) || "物品" : "目标物品";
    details.push(`${label}的${operationLabel}未完成。`);
    if (objectFailureCodes.includes("OBJECT_NOT_IN_HAND")) {
      details.push("物品尚未拿在手中，不能直接展示或递交。");
      if (ownObject && object.custody?.storageMode === "packed") details.push("它仍收在自己的行囊或容器里。");
    }
    if (objectFailureCodes.includes("OBJECT_NOT_HELD")) details.push("自己没有持有该物品。");
  }
  if (failureCodes.includes("MOVE_BLOCKED_BY_FLOOD")) details.push("前面淹了水，水太深，过不去。");
  if (failureCodes.includes("MOVE_HELD")) details.push("被人抓着，挣不脱。");
  const content = [baseContent, ...details].join("");
  return {
    deliveryId: `delivery:${eventId}:${clean(attempt.actorId)}:own-action-result`,
    eventKind: "own_action_result",
    modality: "proprioception",
    sourceCharacterId: clean(attempt.actorId),
    recipientCharacterId: clean(attempt.actorId),
    content,
    directed: true,
    occurredAtSeconds: Math.max(0, Number(occurredAtSeconds || 0)),
    semanticFrame: {
      actionResult: {
        status,
        primitive: clean(attempt.primitive),
        failureCodes,
        resolvedEffectKinds,
        incidentalEffectKinds,
        attemptSurfaceKinds,
        workStarted,
        workCompleted,
        deliveryAccepted,
        resourceChanges,
        observedObjects,
      },
    },
  };
}

function fail(code, message, evidence = {}) {
  const error = new Error(message);
  error.code = code;
  error.evidence = clone(evidence);
  return error;
}

function forbiddenPayloadPath(value, path = "payload", seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (PRIVATE_PAYLOAD_KEYS.has(key)) return childPath;
    const nested = forbiddenPayloadPath(child, childPath, seen);
    if (nested) return nested;
  }
  return "";
}

function normalizeAttempt(input = {}) {
  const attemptId = clean(input.attemptId || input.actionAttemptId);
  const actorId = clean(input.actorId || input.characterId);
  const primitive = clean(input.primitive || input.actionKind);
  if (!attemptId) throw fail("WORLD_ACTION_ATTEMPT_ID_REQUIRED", "Action attempt requires attemptId.");
  if (!actorId) throw fail("WORLD_ACTION_ACTOR_ID_REQUIRED", "Action attempt requires actorId.");
  if (!primitive) throw fail("WORLD_ACTION_PRIMITIVE_REQUIRED", "Action attempt requires primitive.");
  const payload = clone(input.payload || {});
  const forbiddenPath = forbiddenPayloadPath(payload);
  if (forbiddenPath) {
    throw fail("WORLD_ACTION_PRIVATE_PAYLOAD_FORBIDDEN", "Action attempt payload contains private or world-authority data.", { path: forbiddenPath });
  }
  return {
    attemptId,
    actorId,
    primitive,
    expectedWorldVersion: Math.max(0, Math.floor(Number(input.expectedWorldVersion || 0))),
    agentTurnId: clean(input.agentTurnId),
    causalParentEventIds: [...new Set((input.causalParentEventIds || []).map(clean).filter(Boolean))],
    payload,
  };
}

export function createWorldCommitCoordinator({
  worldId = "",
  initialWorldState = {},
  actionRegistry,
  checkpoint = null,
} = {}) {
  const resolvedWorldId = clean(worldId || checkpoint?.worldId || initialWorldState?.worldId);
  if (!resolvedWorldId) throw fail("WORLD_COORDINATOR_WORLD_ID_REQUIRED", "World coordinator requires worldId.");
  if (!actionRegistry || typeof actionRegistry.settle !== "function") {
    throw fail("WORLD_COORDINATOR_ACTION_REGISTRY_REQUIRED", "World coordinator requires an action registry.");
  }
  const journal = checkpoint?.journal?.events
    ? createWorldEventJournal({ worldId: resolvedWorldId, events: checkpoint.journal.events })
    : createWorldEventJournal({ worldId: resolvedWorldId });
  if (!validateWorldEventJournal(journal).valid) throw fail("WORLD_COORDINATOR_JOURNAL_INVALID", "World coordinator checkpoint journal is invalid.");
  let worldState = clone(checkpoint?.worldState || initialWorldState || {});
  const outcomes = new Map((checkpoint?.outcomes || []).map((outcome) => [clean(outcome.actionAttemptId), clone(outcome)]));
  const attemptDigests = new Map(checkpoint?.attemptDigests || []);
  const pending = new Map();
  let queue = Promise.resolve();

  async function commitAttempt(attempt) {
    if (outcomes.has(attempt.attemptId)) return clone(outcomes.get(attempt.attemptId));
    const baseVersion = journal.worldVersion;
    const resolution = await actionRegistry.settle({ state: worldState, attempt });
    const actor = worldState.entities?.[attempt.actorId] || {};
    const nextWorldVersion = baseVersion + 1;
    const outcomeId = `world-outcome:${attempt.attemptId}`;
    const eventId = `world-event:${attempt.attemptId}`;
    const durationSeconds = Math.max(0, Number(resolution.durationSeconds || 0));
    const nowSeconds = Math.max(0, Number(worldState.nowSeconds || 0)) + durationSeconds;
    const revalidatedFromWorldVersion = attempt.expectedWorldVersion === baseVersion
      ? null
      : attempt.expectedWorldVersion;
    const statePatch = clone(resolution.statePatch || { operations: [] });
    statePatch.operations = [
      ...(statePatch.operations || []),
      { op: "set", path: ["entities", attempt.actorId, "lastSettledPrimitive"], value: attempt.primitive },
      { op: "set", path: ["nowSeconds"], value: nowSeconds },
    ];
    // Whoever asleep is spoken to directly, or reached by something urgent, wakes in the same settlement.
    const roused = rousedBy(worldState, resolution.deliveries || [], nowSeconds);
    statePatch.operations.push(...roused.operations);
    const settledWorldState = applyWorldStatePatch(worldState, statePatch);
    const outcome = {
      authority: "world-resolution",
      schemaVersion: WORLD_COMMIT_COORDINATOR_VERSION,
      outcomeId,
      eventId,
      actionAttemptId: attempt.attemptId,
      agentTurnId: attempt.agentTurnId,
      actorId: attempt.actorId,
      primitive: attempt.primitive,
      expectedWorldVersion: attempt.expectedWorldVersion,
      revalidatedFromWorldVersion,
      evaluatedAgainstWorldVersion: baseVersion,
      worldVersion: nextWorldVersion,
      status: resolution.status,
      attemptSurface: clone(resolution.attemptSurface || []),
      intendedEffects: clone(resolution.intendedEffects || []),
      resolvedEffects: clone([...(resolution.resolvedEffects || []), ...roused.resolvedEffects]),
      failedEffects: clone(resolution.failedEffects || []),
      incidentalEffects: clone(resolution.incidentalEffects || []),
      committedFacts: clone(resolution.committedFacts || []),
      deliveries: clone([
        ...(resolution.deliveries || []),
        ...((resolution.deliveries || []).some((row) => (
          clean(row?.eventKind) === "own_action_result"
          && clean(row?.recipientCharacterId || row?.recipientId) === clean(attempt.actorId)
        )) ? [] : [ownActionResultDelivery({ attempt, resolution, eventId, occurredAtSeconds: nowSeconds, worldState, settledWorldState })]),
      ]),
      durationSeconds,
    };
    appendWorldEvent(journal, {
      eventId,
      type: "action_resolved",
      occurredAtSeconds: nowSeconds,
      actorId: attempt.actorId,
      placeId: clean(actor.placeId),
      zoneId: clean(actor.zoneId),
      causalParentEventIds: attempt.causalParentEventIds,
      actionAttemptId: attempt.attemptId,
      publicPayload: clone(outcome),
      privatePayloadRefs: attempt.agentTurnId ? [`private://character/${attempt.actorId}/turn/${attempt.agentTurnId}`] : [],
      statePatch,
    });
    worldState = settledWorldState;
    worldState.worldVersion = journal.worldVersion;
    outcomes.set(attempt.attemptId, clone(outcome));
    return clone(outcome);
  }

  /**
   * Materialize objective durative-process readiness without choosing what
   * any character does next. When allowed, the world clock may advance to the
   * nearest already-scheduled process boundary; the owner only receives a new
   * thought opportunity plus the objective ready fact.
   */
  async function commitTemporalAgenda() {
    const due = dueEnvironmentChange(worldState);
    if (due) {
      const nextWorldVersion = journal.worldVersion + 1;
      const eventId = `world-event:environment:${nextWorldVersion}`;
      // The water takes or knocks down whoever stands in it when the deluge comes.
      const hazards = floodHazards({ state: worldState, place: due.place, environment: due.environment, changes: due.changes, eventId });
      const deliveries = [
        ...environmentDeliveries(worldState, due.place, due.changes, due.environment, eventId).filter((row) => !hazards.goneIds.includes(row.recipientCharacterId)),
        ...hazards.deliveries,
      ];
      const publicPayload = { authority: "world-environment-resolution", eventId, worldVersion: nextWorldVersion,
        nowSeconds: worldState.nowSeconds, status: "success", placeId: due.place.id,
        environmentChanges: clone(due.changes), environment: environmentView(due.environment), deliveries,
        resolvedEffects: hazards.resolvedEffects,
        hazards: hazards.hazards };
      const statePatch = { operations: [{ op: "set", path: ["places", due.place.id, "environment"], value: due.environment }, ...hazards.operations] };
      appendWorldEvent(journal, { eventId, type: "world_environment_changed", occurredAtSeconds: worldState.nowSeconds,
        actorId: "", placeId: due.place.id, zoneId: "", causalParentEventIds: [], actionAttemptId: "",
        publicPayload, privatePayloadRefs: [], statePatch });
      worldState = applyWorldStatePatch(worldState, statePatch);
      worldState.worldVersion = journal.worldVersion;
      return clone(publicPayload);
    }
    // A life's turn: conceiving, labour, a birth — settled when it comes due.
    const life = dueLifeEvent(worldState);
    if (life) {
      const nextWorldVersion = journal.worldVersion + 1;
      const eventId = `world-event:life:${nextWorldVersion}`;
      const outcome = lifeEventOutcome({ state: worldState, kind: life.kind, personId: life.personId, eventId });
      const publicPayload = { authority: "world-life-resolution", eventId, worldVersion: nextWorldVersion, nowSeconds: worldState.nowSeconds, status: "success",
        lifeEvent: life.kind, personId: life.personId, caption: outcome.caption, resolvedEffects: outcome.resolvedEffects, deliveries: outcome.deliveries };
      const statePatch = { operations: outcome.operations };
      appendWorldEvent(journal, { eventId, type: "world_life_event", occurredAtSeconds: worldState.nowSeconds,
        actorId: "", placeId: clean(worldState.entities?.[life.personId]?.placeId), zoneId: "", causalParentEventIds: [], actionAttemptId: "",
        publicPayload, privatePayloadRefs: [], statePatch });
      worldState = applyWorldStatePatch(worldState, statePatch);
      worldState.worldVersion = journal.worldVersion;
      return clone(publicPayload);
    }
    // A sleeper waking of themselves: rested, or morning come.
    const waking = dueWaking(worldState);
    if (waking) {
      const nextWorldVersion = journal.worldVersion + 1;
      const eventId = `world-event:sleep:${nextWorldVersion}`;
      const outcome = wakingOutcome({ state: worldState, personId: waking.personId, eventId });
      const publicPayload = { authority: "world-sleep-resolution", eventId, worldVersion: nextWorldVersion, nowSeconds: worldState.nowSeconds, status: "success",
        sleepEvent: "woke", personId: waking.personId, caption: outcome.caption, resolvedEffects: outcome.resolvedEffects, deliveries: outcome.deliveries };
      const statePatch = { operations: outcome.operations };
      appendWorldEvent(journal, { eventId, type: "world_sleep_event", occurredAtSeconds: worldState.nowSeconds,
        actorId: "", placeId: clean(worldState.entities?.[waking.personId]?.placeId), zoneId: "", causalParentEventIds: [], actionAttemptId: "",
        publicPayload, privatePayloadRefs: [], statePatch });
      worldState = applyWorldStatePatch(worldState, statePatch);
      worldState.worldVersion = journal.worldVersion;
      return clone(publicPayload);
    }
    const { agenda, changes } = resolveWorldTemporalAgenda(worldState);
    if (!changes.length) return null;
    const nextWorldVersion = journal.worldVersion + 1;
    const eventId = `world-event:deadline:${nextWorldVersion}`;
    const operations = [{ op: "set", path: ["temporalAgenda"], value: agenda }];
    for (const { deadline } of changes) if (deadline.kind === "opening_preparation") {
      operations.push({ op: "set", path: ["places", deadline.placeId, "openingReadiness"], value: {
        deadlineId: deadline.id, dueAtSeconds: deadline.dueAtSeconds,
        status: deadline.status === "overdue" ? "delayed" : deadline.status === "fulfilled_late" ? "ready_late" : deadline.status === "fulfilled" ? "ready" : "preparing",
        resolvedAtSeconds: deadline.resolvedAtSeconds ?? null,
      } });
    }
    const publicPayload = { authority: "world-temporal-resolution", eventId, worldVersion: nextWorldVersion,
      nowSeconds: worldState.nowSeconds, status: "success", deadlineEvents: clone(changes),
      deliveries: changes.flatMap(change => temporalDeadlineDeliveries(worldState, change, eventId)) };
    const statePatch = { operations };
    appendWorldEvent(journal, { eventId, type: changes.length === 1 ? changes[0].kind : "world_deadlines_updated",
      occurredAtSeconds: worldState.nowSeconds, actorId: "", placeId: "", zoneId: "", causalParentEventIds: [], actionAttemptId: "", publicPayload,
      privatePayloadRefs: [], statePatch });
    worldState = applyWorldStatePatch(worldState, statePatch);
    worldState.worldVersion = journal.worldVersion;
    return clone(publicPayload);
  }

  async function commitWorldEvent(event = {}) {
    const issues = validateWorldEvent(worldState, event);
    if (issues.length) throw fail("WORLD_EVENT_INVALID", "This world event cannot be settled here.", { issues });
    const nextWorldVersion = journal.worldVersion + 1;
    const eventId = `world-event:player:${nextWorldVersion}`;
    const { operations, facts, deliveries } = settleWorldEvent(worldState, event, { eventId });
    const roused = rousedBy(worldState, deliveries, worldState.nowSeconds);
    operations.push(...roused.operations);
    const publicPayload = { authority: "player-world-event", source: "player", eventId, worldVersion: nextWorldVersion,
      nowSeconds: worldState.nowSeconds, status: "success", worldEvent: clone(event), committedFacts: facts, deliveries,
      resolvedEffects: roused.resolvedEffects };
    const statePatch = { operations };
    appendWorldEvent(journal, { eventId, type: "world_event", occurredAtSeconds: worldState.nowSeconds, actorId: "", placeId: "",
      zoneId: clean(event.zoneId), causalParentEventIds: [], actionAttemptId: "", publicPayload, privatePayloadRefs: [], statePatch });
    worldState = applyWorldStatePatch(worldState, statePatch);
    worldState.worldVersion = journal.worldVersion;
    return clone(publicPayload);
  }

  async function commitWorldProcessReadiness({ allowTimeAdvance = false } = {}) {
    const processes = Array.isArray(worldState.processes) ? worldState.processes : [];
    const active = processes.filter((row) => (
      clean(row?.status || "active") === "active"
      && Number.isFinite(Number(row?.readyAtSeconds))
    ));
    if (!active.length) return null;
    const currentNow = Math.max(0, Number(worldState.nowSeconds || 0));
    const nearestReadyAt = Math.min(...active.map((row) => Number(row.readyAtSeconds)));
    if (!allowTimeAdvance && nearestReadyAt > currentNow) return null;
    const temporalBoundary = nextWorldTemporalBoundary(worldState);
    if (allowTimeAdvance && temporalBoundary != null && temporalBoundary < nearestReadyAt) return commitWorldClockAdvance({ targetSeconds: temporalBoundary });
    const targetNow = allowTimeAdvance ? Math.max(currentNow, nearestReadyAt) : currentNow;
    const refreshed = refreshDurativeWorldProcesses(processes, targetNow);
    const previousById = new Map(processes.map((row) => [clean(row?.id), row]));
    const newlyReady = refreshed.filter((row) => (
      clean(row?.status) === "ready"
      && clean(previousById.get(clean(row?.id))?.status || "active") === "active"
    ));
    if (!newlyReady.length) return null;

    const nextWorldVersion = journal.worldVersion + 1;
    const processIds = unique(newlyReady.map((row) => row.id));
    const eventId = `world-event:process-ready:${nextWorldVersion}:${processIds.join("+")}`;
    const statePatch = {
      operations: [
        { op: "set", path: ["processes"], value: refreshed },
        { op: "set", path: ["nowSeconds"], value: targetNow },
      ],
    };
    const deliveries = newlyReady.flatMap((process) => {
      const recipientCharacterId = clean(process.ownerActorId);
      if (!recipientCharacterId) return [];
      const label = clean(process.metadata?.publicLabel || process.metadata?.subjectLabel || process.kind || "手边的事");
      return [{
        deliveryId: `delivery:${eventId}:${recipientCharacterId}:${clean(process.id)}`,
        eventKind: "owned_process_ready",
        modality: "temporal",
        recipientCharacterId,
        processId: clean(process.id),
        content: clean(process.metadata?.readyNotice || `${label}已经到了需要下一步的时候。`),
        directed: true,
        occurredAtSeconds: targetNow,
      }];
    });
    const publicPayload = {
      authority: "world-process-resolution",
      eventId,
      worldVersion: nextWorldVersion,
      status: "success",
      nowSeconds: targetNow,
      processIds,
      readyProcesses: newlyReady.map((row) => ({
        processId: clean(row.id),
        kind: clean(row.kind),
        ownerActorId: clean(row.ownerActorId),
        subjectId: clean(row.subjectId),
        stationZoneId: clean(row.stationZoneId),
        status: "ready",
      })),
      deliveries,
    };
    const committedEventIds = new Set((journal.events || []).map((row) => clean(row?.eventId)));
    const causalParentEventIds = unique(newlyReady.flatMap((row) => [
      row.metadata?.sourceEventId,
      row.metadata?.causalParentEventId,
    ])).filter((parentEventId) => committedEventIds.has(parentEventId));
    appendWorldEvent(journal, {
      eventId,
      type: "world_process_ready",
      occurredAtSeconds: targetNow,
      actorId: "",
      placeId: "",
      zoneId: "",
      causalParentEventIds,
      actionAttemptId: "",
      publicPayload,
      privatePayloadRefs: [],
      statePatch,
    });
    worldState = applyWorldStatePatch(worldState, statePatch);
    worldState.worldVersion = journal.worldVersion;
    return clone(publicPayload);
  }

  async function commitWorldClockAdvance({ targetSeconds = 0 } = {}) {
    const currentNow = Math.max(0, Number(worldState.nowSeconds || 0));
    const pendingDeadline = await commitTemporalAgenda();
    if (pendingDeadline) return pendingDeadline;
    const temporalBoundary = nextWorldTemporalBoundary(worldState);
    const requestedTarget = Math.min(Math.max(currentNow, Number(targetSeconds || 0)), temporalBoundary ?? Infinity);
    if (requestedTarget <= currentNow) return null;
    const activeProcesses = (worldState.processes || []).filter((row) => (
      clean(row?.status || "active") === "active"
      && Number.isFinite(Number(row?.readyAtSeconds))
    ));
    const nearestProcessAt = activeProcesses.length
      ? Math.min(...activeProcesses.map((row) => Number(row.readyAtSeconds)))
      : null;
    // Never jump over an objective process boundary to service a private
    // deadline. The process becomes public first; Character wakes are then
    // ordered by the normal mailbox rules.
    if (nearestProcessAt != null && nearestProcessAt <= requestedTarget) {
      return commitWorldProcessReadiness({ allowTimeAdvance: true });
    }

    const nextWorldVersion = journal.worldVersion + 1;
    const eventId = `world-event:clock-advanced:${nextWorldVersion}`;
    const statePatch = {
      operations: [{ op: "set", path: ["nowSeconds"], value: requestedTarget }],
    };
    const publicPayload = {
      authority: "world-clock-resolution",
      eventId,
      worldVersion: nextWorldVersion,
      status: "success",
      nowSeconds: requestedTarget,
      deliveries: [],
    };
    appendWorldEvent(journal, {
      eventId,
      type: "world_clock_advanced",
      occurredAtSeconds: requestedTarget,
      actorId: "",
      placeId: "",
      zoneId: "",
      causalParentEventIds: [],
      actionAttemptId: "",
      publicPayload,
      privatePayloadRefs: [],
      statePatch,
    });
    worldState = applyWorldStatePatch(worldState, statePatch);
    worldState.worldVersion = journal.worldVersion;
    return await commitTemporalAgenda() || clone(publicPayload);
  }

  const coordinator = {
    schemaVersion: WORLD_COMMIT_COORDINATOR_VERSION,
    worldId: resolvedWorldId,
    actionRegistry,
    get journal() { return journal; },
    get worldState() { return clone(worldState); },
    submitActionAttempt(input = {}) {
      let attempt;
      try {
        attempt = normalizeAttempt(input);
        const { expectedWorldVersion, ...identity } = attempt;
        const digest = submissionDigest(identity);
        if (attemptDigests.has(attempt.attemptId) && attemptDigests.get(attempt.attemptId) !== digest) {
          throw fail("WORLD_ACTION_IDEMPOTENCY_CONFLICT", "The action key already identifies different content.");
        }
        if (outcomes.has(attempt.attemptId) && !attemptDigests.has(attempt.attemptId)) {
          throw fail("WORLD_ACTION_REPLAY_UNVERIFIABLE", "This historical action has no saved request fingerprint; retrieve its outcome instead of resubmitting.");
        }
        attemptDigests.set(attempt.attemptId, digest);
      } catch (error) {
        return Promise.reject(error);
      }
      if (outcomes.has(attempt.attemptId)) return Promise.resolve(clone(outcomes.get(attempt.attemptId)));
      if (pending.has(attempt.attemptId)) return pending.get(attempt.attemptId).then(clone);
      const work = queue.then(() => commitAttempt(attempt));
      queue = work.catch(() => undefined);
      pending.set(attempt.attemptId, work);
      work.finally(() => pending.delete(attempt.attemptId)).catch(() => undefined);
      return work.then(clone);
    },
    advanceWorldTemporalAgenda() {
      const work = queue.then(() => commitTemporalAgenda());
      queue = work.catch(() => undefined);
      return work.then(clone);
    },
    applyWorldEvent(event = {}) {
      const work = queue.then(() => commitWorldEvent(event));
      queue = work.catch(() => undefined);
      return work.then(clone);
    },
    advanceWorldProcesses({ allowTimeAdvance = false } = {}) {
      const work = queue.then(() => commitWorldProcessReadiness({ allowTimeAdvance }));
      queue = work.catch(() => undefined);
      return work.then(clone);
    },
    advanceWorldClockTo({ targetSeconds = 0 } = {}) {
      const work = queue.then(() => commitWorldClockAdvance({ targetSeconds }));
      queue = work.catch(() => undefined);
      return work.then(clone);
    },
    checkpoint() {
      return {
        schemaVersion: WORLD_COMMIT_COORDINATOR_VERSION,
        worldId: resolvedWorldId,
        journal: clone(journal),
        worldState: clone(worldState),
        outcomes: [...outcomes.values()].map(clone),
        attemptDigests: [...attemptDigests],
      };
    },
  };
  return coordinator;
}
