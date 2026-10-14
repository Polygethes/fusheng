import {
  completeDurativeWorldProcess,
  durativeWorldProcessProgress,
  startDurativeWorldProcess,
} from "./durativeWorldProcess.mjs";
import { physicalAttemptForSettlement } from "./physicalExpression.mjs";
import { perceptionDistanceLimit, perceivableRoute } from "./worldActionRegistry.mjs";

export const SERVICE_CAPABILITY_VERSION = "service-capability-v1";

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function setOperation(path, value) {
  return { op: "set", path, value: clone(value) };
}

function baseResolution(attempt = {}) {
  return {
    authority: "world-action-registry",
    primitive: clean(attempt.primitive || "use_affordance"),
    status: "failed",
    attemptSurface: [],
    intendedEffects: [],
    resolvedEffects: [],
    failedEffects: [],
    incidentalEffects: [],
    committedFacts: [],
    deliveries: [],
    durationSeconds: 1,
    statePatch: { operations: [] },
  };
}

function placeForActor(state = {}, actor = {}) {
  return state.places?.[clean(actor.placeId)] || null;
}

function offeringFor(place = {}, offeringId = "") {
  return place.institution?.offerings?.[clean(offeringId)] || null;
}

function serviceProcessIsTerminal(process = {}) {
  return ["served", "consumed"].includes(clean(process.metadata?.serviceStatus))
    || ["cancelled", "consumed"].includes(clean(process.status));
}

function serviceAuthorityAllows(actor = {}, offering = {}) {
  const authority = actor.serviceAuthority || {};
  if (clean(offering.category) === "tea") return authority.serveTea === true;
  if (clean(offering.category) === "meal") return authority.serveMeal === true;
  return false;
}

function compatibleVessel(state = {}, actorId = "", offering = {}) {
  const requiredType = clean(offering.vesselType);
  return Object.values(state.objects || {}).find((object) => (
    clean(object?.holderCharacterId) === clean(actorId)
    && clean(object?.state?.vesselType) === requiredType
    && ["", "empty"].includes(clean(object?.state?.contents || "empty"))
  )) || null;
}

function stockAfterReservation(stock = {}, cost = {}) {
  const next = clone(stock || {});
  for (const [resourceId, rawAmount] of Object.entries(cost || {})) {
    const amount = Math.max(0, Number(rawAmount || 0));
    if (Number(next[resourceId] || 0) < amount) return null;
    next[resourceId] = Number(next[resourceId] || 0) - amount;
  }
  return next;
}

function charactersInPlace(state = {}, actor = {}) {
  return Object.values(state.entities || {}).filter((row) => (
    row?.kind === "character"
    && row.present !== false
    && clean(row.id) !== clean(actor.id)
    && clean(row.placeId) === clean(actor.placeId)
  ));
}

function visibleDeliveryRows(state = {}, actor = {}, attempt = {}, {
  eventKind = "service_activity",
  content = "",
  objectId = "",
} = {}) {
  return charactersInPlace(state, actor).filter((recipient) => {
    const place = state.places?.[clean(actor.placeId)] || {};
    return perceptionDistanceLimit(place, "visual") == null
      || perceivableRoute(place, actor.zoneId, recipient.zoneId, "visual") != null;
  }).map((recipient) => ({
    deliveryId: `delivery:${clean(attempt.attemptId)}:${eventKind}:${clean(recipient.id)}`,
    eventKind,
    modality: "visual",
    sourceCharacterId: clean(actor.id),
    sourceObjectId: clean(objectId),
    recipientCharacterId: clean(recipient.id),
    content: clean(content),
    observableAffectiveTexture: clone(attempt.payload?.observableAffectiveTexture || []),
  }));
}

function processPublicProjection(process = {}, nowSeconds = 0) {
  const progress = durativeWorldProcessProgress(process, nowSeconds);
  return {
    processId: clean(process.id),
    kind: clean(process.kind),
    status: clean(process.status),
    offeringId: clean(process.metadata?.offeringId || process.subjectId),
    offeringLabel: clean(process.metadata?.publicLabel || process.metadata?.subjectLabel),
    recipientCharacterId: clean(process.metadata?.recipientCharacterId),
    stationZoneId: clean(process.stationZoneId),
    objectIds: clone(process.objectIds || []),
    attentionMode: clean(process.attentionMode),
    progress: Number(progress.progress || 0),
    remainingSeconds: Number(progress.remainingSeconds || 0),
    serviceStatus: clean(process.metadata?.serviceStatus || process.status),
  };
}

/**
 * Returns world-grounded possibilities, never a selected action. Canonical
 * ids stay server-side; the scene projector replaces them with recipient-safe
 * handles before a Character Agent sees them.
 */
export function listServiceCapabilityAffordances({
  state = {},
  actorId = "",
  recipientCharacterIds = [],
} = {}) {
  const actor = state.entities?.[clean(actorId)];
  if (!actor || actor.kind !== "character" || actor.present === false) return { affordances: [], ownedProcesses: [] };
  const place = placeForActor(state, actor) || {};
  const nowSeconds = Math.max(0, Number(state.nowSeconds || 0));
  const processes = Array.isArray(state.processes) ? state.processes : [];
  const ownedProcesses = processes
    .filter((row) => clean(row.ownerActorId) === clean(actor.id) && clean(row.kind) === "service_preparation")
    .map((row) => processPublicProjection(row, nowSeconds));
  const affordances = [];

  for (const process of processes.filter((row) => (
    clean(row.ownerActorId) === clean(actor.id)
    && clean(row.kind) === "service_preparation"
    && !serviceProcessIsTerminal(row)
  ))) {
    const offering = offeringFor(place, process.metadata?.offeringId || process.subjectId) || {};
    const label = clean(offering.label || process.metadata?.publicLabel || "这份东西");
    if (clean(process.status) === "ready") {
      affordances.push({
        canonicalAffordanceId: `service:finish:${clean(process.id)}`,
        capability: "service",
        operation: "finish_service_preparation",
        processId: clean(process.id),
        offeringId: clean(process.metadata?.offeringId || process.subjectId),
        recipientCharacterId: clean(process.metadata?.recipientCharacterId),
        public: {
          kind: "service_operation",
          operation: "finish_service_preparation",
          label: `把已经到火候的${label}收好`,
          requiredZoneId: clean(process.stationZoneId),
          currentlyExecutable: clean(actor.zoneId) === clean(process.stationZoneId),
          physicalPrerequisites: clean(actor.zoneId) === clean(process.stationZoneId)
            ? [] : [`本人先到${clean(process.stationZoneId)}`],
        },
      });
    }
    if (clean(process.status) === "completed") {
      const recipient = state.entities?.[clean(process.metadata?.recipientCharacterId)];
      affordances.push({
        canonicalAffordanceId: `service:serve:${clean(process.id)}`,
        capability: "service",
        operation: "serve_prepared_service",
        processId: clean(process.id),
        offeringId: clean(process.metadata?.offeringId || process.subjectId),
        recipientCharacterId: clean(process.metadata?.recipientCharacterId),
        public: {
          kind: "service_operation",
          operation: "serve_prepared_service",
          label: `把准备好的${label}交给客人`,
          requiredZoneId: clean(recipient?.zoneId),
          currentlyExecutable: Boolean(recipient) && clean(actor.zoneId) === clean(recipient?.zoneId),
          physicalPrerequisites: Boolean(recipient) && clean(actor.zoneId) === clean(recipient?.zoneId)
            ? [] : ["本人先走到客人所在处"],
        },
      });
    }
  }

  const activeRecipients = new Set(processes.filter((row) => (
    clean(row.kind) === "service_preparation"
    && clean(row.ownerActorId) === clean(actor.id)
    && !serviceProcessIsTerminal(row)
  )).map((row) => clean(row.metadata?.recipientCharacterId)));
  for (const recipientId of unique(recipientCharacterIds)) {
    const recipient = state.entities?.[recipientId];
    if (!recipient || recipient.present === false || clean(recipient.placeId) !== clean(actor.placeId)) continue;
    if (activeRecipients.has(recipientId)) continue;
    for (const [offeringId, offering] of Object.entries(place.institution?.offerings || {})) {
      if (offering.walkInOrderable !== true || !serviceAuthorityAllows(actor, offering)) continue;
      const stationZoneId = clean(offering.preparation?.stationZoneId);
      const vessel = compatibleVessel(state, actor.id, offering);
      const stock = place.serviceCapability?.stock || {};
      const stockAvailable = Boolean(stockAfterReservation(stock, offering.stockCost || {}));
      const atStation = clean(actor.zoneId) === stationZoneId;
      affordances.push({
        canonicalAffordanceId: `service:start:${clean(actor.id)}:${recipientId}:${clean(offeringId)}`,
        capability: "service",
        operation: "start_service_preparation",
        offeringId: clean(offeringId),
        recipientCharacterId: recipientId,
        public: {
          kind: "service_operation",
          operation: "start_service_preparation",
          label: `为眼前这位客人准备${clean(offering.label || offeringId)}`,
          offeringId: clean(offeringId),
          offeringLabel: clean(offering.label || offeringId),
          price: Number(offering.price || 0),
          requiredZoneId: stationZoneId,
          requiredVesselType: clean(offering.vesselType),
          currentlyExecutable: atStation && Boolean(vessel) && stockAvailable,
          physicalPrerequisites: [
            ...(atStation ? [] : [`本人先到${stationZoneId}`]),
            ...(vessel ? [] : [`本人先拿到一只${clean(offering.vesselType)}`]),
            ...(stockAvailable ? [] : ["店内当前库存不足"]),
          ],
        },
      });
    }
  }
  return { affordances, ownedProcesses };
}

export function settleServiceCapabilityAffordance({ state = {}, attempt = {} } = {}) {
  attempt = physicalAttemptForSettlement(attempt);
  const result = baseResolution(attempt);
  const actor = state.entities?.[clean(attempt.actorId)];
  const binding = attempt.payload?.capabilityBinding || {};
  const operation = clean(binding.operation);
  if (!actor || actor.kind !== "character" || actor.present === false) {
    result.failedEffects.push({ code: "SERVICE_ACTOR_NOT_PRESENT", actorId: clean(attempt.actorId) });
    return result;
  }
  if (clean(binding.capability) !== "service") {
    result.failedEffects.push({ code: "SERVICE_CAPABILITY_BINDING_INVALID" });
    return result;
  }
  const place = placeForActor(state, actor) || {};
  const nowSeconds = Math.max(0, Number(state.nowSeconds || 0));
  const visibleAction = clean(attempt.payload?.visibleAction);

  if (operation === "start_service_preparation") {
    const offeringId = clean(binding.offeringId);
    const recipientCharacterId = clean(binding.recipientCharacterId);
    const offering = offeringFor(place, offeringId);
    const recipient = state.entities?.[recipientCharacterId];
    result.intendedEffects.push({ kind: "service_preparation_started", offeringId, recipientCharacterId });
    if (!offering || !recipient || recipient.present === false || clean(recipient.placeId) !== clean(actor.placeId)) {
      result.failedEffects.push({ code: "SERVICE_START_SUBJECT_OR_RECIPIENT_UNAVAILABLE", offeringId, recipientCharacterId });
      return result;
    }
    if (!serviceAuthorityAllows(actor, offering)) {
      result.failedEffects.push({ code: "SERVICE_START_AUTHORITY_MISSING", offeringId });
      return result;
    }
    const stationZoneId = clean(offering.preparation?.stationZoneId);
    if (!stationZoneId || clean(actor.zoneId) !== stationZoneId) {
      result.failedEffects.push({ code: "SERVICE_START_WRONG_ZONE", requiredZoneId: stationZoneId });
      return result;
    }
    const vessel = compatibleVessel(state, actor.id, offering);
    if (!vessel) {
      result.failedEffects.push({ code: "SERVICE_START_VESSEL_REQUIRED", vesselType: clean(offering.vesselType) });
      return result;
    }
    const nextStock = stockAfterReservation(place.serviceCapability?.stock || {}, offering.stockCost || {});
    if (!nextStock) {
      result.failedEffects.push({ code: "SERVICE_START_STOCK_INSUFFICIENT", offeringId });
      return result;
    }
    const heatReady = place.serviceCapability?.stations?.[stationZoneId]?.heatReady !== false;
    const durationSeconds = Math.max(1, Number(heatReady
      ? offering.preparation?.durationSecondsWhenHeatReady
      : offering.preparation?.durationSecondsColdStart) || 1);
    const processId = `process:${clean(attempt.attemptId)}`;
    const started = startDurativeWorldProcess(state.processes || [], {
      id: processId,
      kind: "service_preparation",
      subjectId: offeringId,
      ownerActorId: actor.id,
      stationZoneId,
      objectIds: [vessel.id],
      durationSeconds,
      attentionMode: clean(offering.preparation?.attentionMode || "passive_wait"),
      sourceActionId: clean(attempt.attemptId),
      metadata: {
        sourceEventId: `world-event:${clean(attempt.attemptId)}`,
        offeringId,
        recipientCharacterId,
        publicLabel: clean(offering.label || offeringId),
        serviceStatus: "preparing",
        price: Number(offering.price || 0),
        readyNotice: `${clean(offering.label || offeringId)}已经到了该收火的时候。`,
      },
    }, nowSeconds);
    if (!started.ok) {
      result.failedEffects.push({ code: started.code || "SERVICE_START_PROCESS_FAILED" });
      return result;
    }
    const content = visibleAction || `${clean(actor.name || actor.id)}开始准备${clean(offering.label || offeringId)}。`;
    result.status = "success";
    result.durationSeconds = 2;
    result.attemptSurface.push({ kind: "service_preparation_started", actorId: actor.id, processId, offeringId, recipientCharacterId, visibleAction: content });
    result.committedFacts.push(...result.attemptSurface);
    result.resolvedEffects.push({ kind: "service_preparation_started", processId, offeringId, recipientCharacterId });
    result.deliveries.push(...visibleDeliveryRows(state, actor, attempt, { eventKind: "service_preparation_started", content, objectId: vessel.id }));
    result.statePatch.operations.push(
      setOperation(["processes"], started.processes),
      setOperation(["places", actor.placeId, "serviceCapability", "stock"], nextStock),
      setOperation(["objects", vessel.id, "state", "contents"], {
        kind: "service_in_preparation",
        offeringId,
        processId,
      }),
    );
    return result;
  }

  const processId = clean(binding.processId);
  const process = (state.processes || []).find((row) => clean(row.id) === processId);
  if (!process || clean(process.ownerActorId) !== clean(actor.id)) {
    result.failedEffects.push({ code: "SERVICE_PROCESS_NOT_OWNED", processId });
    return result;
  }
  const offering = offeringFor(place, process.metadata?.offeringId || process.subjectId) || {};
  const vessel = (process.objectIds || []).map((id) => state.objects?.[id]).find(Boolean);

  if (operation === "finish_service_preparation") {
    result.intendedEffects.push({ kind: "service_preparation_finished", processId });
    if (clean(process.status) !== "ready") {
      result.failedEffects.push({ code: "SERVICE_PROCESS_NOT_READY", processId, status: clean(process.status) });
      return result;
    }
    if (clean(actor.zoneId) !== clean(process.stationZoneId)) {
      result.failedEffects.push({ code: "SERVICE_FINISH_WRONG_ZONE", requiredZoneId: clean(process.stationZoneId) });
      return result;
    }
    if (!vessel || clean(vessel.holderCharacterId) !== clean(actor.id)) {
      result.failedEffects.push({ code: "SERVICE_FINISH_VESSEL_NOT_HELD", processId });
      return result;
    }
    const completed = completeDurativeWorldProcess(state.processes || [], processId, nowSeconds, attempt.attemptId);
    if (!completed.ok) {
      result.failedEffects.push({ code: completed.code || "SERVICE_FINISH_PROCESS_FAILED", processId });
      return result;
    }
    completed.process.metadata = { ...completed.process.metadata, serviceStatus: "prepared" };
    const completedProcesses = completed.processes.map((row) => row.id === processId ? completed.process : row);
    const content = visibleAction || `${clean(actor.name || actor.id)}把${clean(offering.label || "东西")}收好，准备端出去。`;
    result.status = "success";
    result.durationSeconds = 3;
    result.attemptSurface.push({ kind: "service_preparation_finished", actorId: actor.id, processId, visibleAction: content });
    result.committedFacts.push(...result.attemptSurface);
    result.resolvedEffects.push({ kind: "service_preparation_finished", processId });
    result.deliveries.push(...visibleDeliveryRows(state, actor, attempt, { eventKind: "service_preparation_finished", content, objectId: vessel.id }));
    result.statePatch.operations.push(
      setOperation(["processes"], completedProcesses),
      setOperation(["objects", vessel.id, "state", "contents"], {
        kind: "prepared_service",
        offeringId: clean(process.metadata?.offeringId || process.subjectId),
        processId,
      }),
    );
    return result;
  }

  if (operation === "serve_prepared_service") {
    const recipientCharacterId = clean(process.metadata?.recipientCharacterId);
    const recipient = state.entities?.[recipientCharacterId];
    result.intendedEffects.push({ kind: "prepared_service_served", processId, recipientCharacterId });
    if (clean(process.status) !== "completed" || clean(process.metadata?.serviceStatus) !== "prepared") {
      result.failedEffects.push({ code: "SERVICE_NOT_READY_TO_SERVE", processId, status: clean(process.status) });
      return result;
    }
    if (!recipient || recipient.present === false || clean(recipient.placeId) !== clean(actor.placeId)
      || clean(recipient.zoneId) !== clean(actor.zoneId)) {
      result.failedEffects.push({ code: "SERVICE_RECIPIENT_NOT_REACHABLE", recipientCharacterId });
      return result;
    }
    if (!vessel || clean(vessel.holderCharacterId) !== clean(actor.id)) {
      result.failedEffects.push({ code: "SERVICE_VESSEL_NOT_HELD", processId });
      return result;
    }
    const servedProcesses = (state.processes || []).map((row) => row.id === processId ? {
      ...clone(row),
      metadata: {
        ...clone(row.metadata || {}),
        serviceStatus: "served",
        servedAtSeconds: nowSeconds,
      },
      revision: Math.max(0, Number(row.revision || 0)) + 1,
    } : clone(row));
    const content = visibleAction || `${clean(actor.name || actor.id)}把${clean(offering.label || "东西")}放到客人面前。`;
    result.status = "success";
    result.durationSeconds = 2;
    result.attemptSurface.push({ kind: "prepared_service_served", actorId: actor.id, processId, recipientCharacterId, visibleAction: content });
    result.committedFacts.push(...result.attemptSurface);
    result.resolvedEffects.push({ kind: "prepared_service_served", processId, recipientCharacterId, objectId: vessel.id });
    result.deliveries.push(...visibleDeliveryRows(state, actor, attempt, { eventKind: "prepared_service_served", content, objectId: vessel.id }));
    result.statePatch.operations.push(
      setOperation(["processes"], servedProcesses),
      setOperation(["objects", vessel.id, "holderCharacterId"], ""),
      setOperation(["objects", vessel.id, "zoneId"], recipient.zoneId),
    );
    return result;
  }

  result.failedEffects.push({ code: "SERVICE_OPERATION_UNKNOWN", operation });
  return result;
}
