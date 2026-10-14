import {
  applyCommitmentTransition,
  normalizeCommitmentGraph,
} from "../simulation/commitmentGraph.mjs";

export const VISIT_COMMITMENT_ADAPTER_VERSION = 1;

function text(value = "", max = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function uniqueStrings(value = []) {
  const rows = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
  return [...new Set(rows.map((item) => text(item, 180)).filter(Boolean))];
}

function finite(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function objectiveId(visitId, kind, suffix = "") {
  return `visit:${visitId}:${kind}${suffix ? `:${suffix}` : ""}`;
}

function terminalVisit(visit = {}) {
  return ["completed", "refused", "abandoned"].includes(visit.stage);
}

function completedStatus(done) {
  return done ? "completed" : "pending";
}

function declared(visit = {}) {
  return visit.purposeStatus === "declared" || visit.purposeDisclosureStatus === "declared";
}

function union(...rows) {
  return uniqueStrings(rows.flat());
}

function normalizeWorkOrder(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const compensation = source.compensation && typeof source.compensation === "object"
    ? source.compensation
    : { kind: text(source.compensation || "exchange") };
  return {
    id: text(source.id, 180),
    status: text(source.status || "open", 80),
    priority: finite(source.priority, 0, 0, 100),
    zoneId: text(source.zoneId, 160),
    taskLabel: text(source.taskLabel || source.description || source.id, 240),
    description: text(source.description || source.taskLabel, 600),
    unitAction: text(source.unitAction || source.description || source.taskLabel, 400),
    requiredUnits: finite(source.requiredUnits, 1, 0, Number.MAX_SAFE_INTEGER),
    completionCriteria: uniqueStrings(source.completionCriteria),
    objectIds: uniqueStrings(source.objectIds),
    toolIds: uniqueStrings(source.toolIds),
    responsibleActorIds: uniqueStrings(source.responsibleActorIds),
    verifierActorIds: uniqueStrings(source.verifierActorIds),
    eligibleVisitorIds: uniqueStrings(source.eligibleVisitorIds),
    compensation: {
      kind: text(compensation.kind || "exchange", 120),
      label: text(compensation.label, 240),
      actorIds: uniqueStrings(compensation.actorIds),
      zoneIds: uniqueStrings(compensation.zoneIds),
      objectIds: uniqueStrings(compensation.objectIds),
    },
  };
}

function workOrderIsEligible(order, visit) {
  return order.id
    && order.status === "open"
    && (!order.eligibleVisitorIds.length || order.eligibleVisitorIds.includes(visit.visitorId));
}

function selectWorkOrder(visit = {}, workOrders = []) {
  const normalized = (Array.isArray(workOrders) ? workOrders : []).map(normalizeWorkOrder);
  const existingId = text(visit.workExchange?.workOrderId || visit.workOrderId, 180);
  const existing = normalized.find((order) => order.id === existingId && workOrderIsEligible(order, visit));
  if (existing) return existing;
  return normalized
    .filter((order) => workOrderIsEligible(order, visit))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0] || null;
}

function purposeRows(visit = {}, sceneConfig = {}) {
  const supplied = Array.isArray(visit.businessPurposes)
    ? visit.businessPurposes
    : Array.isArray(visit.purposes) ? visit.purposes : [];
  if (supplied.length) return supplied.map((row, index) => ({ ...row, sourceIndex: index }));
  const rows = [];
  const kind = text(visit.kind || "business", 100);
  const workOnly = kind === "work_exchange" && !visit.secondaryObjective;
  if (visit.purpose && !workOnly) rows.push({
    id: "primary",
    kind,
    label: visit.purpose,
    objectIds: visit.businessObjectIds || [],
    zoneIds: visit.purposeZoneIds || sceneConfig.businessZoneIds || [],
    sourceIndex: 0,
  });
  if (visit.secondaryObjective) rows.push({
    id: "secondary",
    kind: "social_request",
    label: visit.secondaryObjective,
    targetActorIds: uniqueStrings([visit.secondaryTargetId]),
    responsibleActorIds: uniqueStrings([visit.visitorId]),
    required: false,
    sourceIndex: rows.length,
  });
  return rows;
}

function purposeStatus(visit, purpose = {}) {
  if (purpose.status) return purpose.status;
  // A completed hospitality transaction does not complete a visitor's
  // optional personal pursuit.  Keep that objective open (or explicitly
  // cancelled) until the corresponding personal loop itself changes state.
  if (purpose.kind === "social_request") {
    const loop = (visit.personalOpenLoops || []).find((row) => (
      row.sourceId === purpose.id
      || (purpose.id === "secondary" && row.sourceId === "secondaryObjective")
      || (
        (purpose.targetActorIds || []).includes(row.targetCharacterId)
        && text(row.desire, 240) === text(purpose.label, 240)
      )
    ));
    if (loop?.status === "resolved") return "completed";
    if (loop?.status === "abandoned_by_choice") return "cancelled";
    return "pending";
  }
  if (terminalVisit(visit)) return "completed";
  if (purpose.kind === "delivery") return completedStatus(visit.deliveryStatus === "accepted");
  if (purpose.kind === "lodging") return completedStatus(visit.lodgingStatus === "assigned");
  if (purpose.kind === "business") return completedStatus(visit.businessStatus === "done");
  return "pending";
}

function purposeResponsibleActorIds(visit, purpose, sceneConfig) {
  if (purpose.responsibleActorIds?.length) return uniqueStrings(purpose.responsibleActorIds);
  const configured = sceneConfig.purposeResponsibleActorIdsByKind?.[purpose.kind];
  if (configured?.length) return uniqueStrings(configured);
  if (["delivery", "lodging"].includes(purpose.kind)) return uniqueStrings(visit.expectedHostIds);
  return uniqueStrings([visit.visitorId]);
}

function purposeTargetActorIds(visit, purpose) {
  if (purpose.targetActorIds?.length) return uniqueStrings(purpose.targetActorIds);
  if (purpose.targetCharacterId) return uniqueStrings([purpose.targetCharacterId]);
  const responsible = purposeResponsibleActorIds(visit, purpose, {});
  return responsible.includes(visit.visitorId)
    ? uniqueStrings(visit.expectedHostIds)
    : uniqueStrings([visit.visitorId]);
}

function purposeObjectives(visit, sceneConfig, receptionId) {
  return purposeRows(visit, sceneConfig).map((purpose, index) => {
    const suffix = text(purpose.id || purpose.kind || `purpose-${index + 1}`, 120);
    const responsibleActorIds = purposeResponsibleActorIds(visit, purpose, sceneConfig);
    const targetActorIds = purpose.targetActorIds?.length || purpose.targetCharacterId
      ? purposeTargetActorIds(visit, purpose)
      : responsibleActorIds.includes(visit.visitorId)
        ? uniqueStrings(visit.expectedHostIds)
        : uniqueStrings([visit.visitorId]);
    return {
      id: objectiveId(visit.id, "purpose", suffix),
      kind: text(purpose.kind || "business", 100),
      label: text(purpose.label || purpose.description || visit.purpose || suffix, 240),
      description: text(purpose.description || purpose.label, 600),
      required: purpose.required !== false,
      priority: finite(purpose.priority, 72, 0, 100),
      urgency: finite(purpose.urgency, 40, 0, 100),
      status: purposeStatus(visit, purpose),
      responsibleActorIds,
      targetActorIds,
      location: {
        allowedZoneIds: uniqueStrings(purpose.zoneIds?.length ? purpose.zoneIds : visit.purposeZoneIds?.length ? visit.purposeZoneIds : sceneConfig.businessZoneIds),
      },
      objectIds: uniqueStrings(purpose.objectIds?.length ? purpose.objectIds : index === 0 ? visit.businessObjectIds : []),
      dependsOn: uniqueStrings([receptionId, ...(purpose.dependsOn || [])]),
      disclosure: {
        mode: declared(visit) ? "public" : "restricted",
        status: declared(visit) ? "disclosed" : "undisclosed",
        disclosedToActorIds: declared(visit) ? union(visit.expectedHostIds, targetActorIds) : [],
      },
      completionEvidenceIds: uniqueStrings(purpose.completionEvidenceIds),
      metadata: {
        adapterRole: "business-purpose",
        sourcePurposeId: text(purpose.id || "", 180),
        requiredBeforeService: Boolean(purpose.requiredBeforeService),
      },
    };
  });
}

function workTaskStage(visit = {}) {
  const agreementStatus = visit.workExchange?.agreement?.status;
  const executionStatus = visit.workExchange?.execution?.status;
  const verificationStatus = visit.workExchange?.verification?.status;
  const compensationStatus = visit.workExchange?.compensation?.status;
  if (compensationStatus === "delivered" || visit.paymentStatus === "work_settled") return "compensated";
  if (verificationStatus === "verified" || visit.workStatus === "verified") return "verified";
  if (verificationStatus === "rework") return "rework";
  if (executionStatus === "submitted" || visit.workStatus === "done") return "submitted";
  if (executionStatus === "in_progress") return "executing";
  if (agreementStatus === "refused" || visit.workStatus === "refused") return "refused";
  if (agreementStatus === "accepted" || visit.workStatus === "assigned") return "accepted";
  if (agreementStatus === "offered" || visit.workStatus === "offered") return "offered";
  return "pending";
}

function taskTransitionEvidence(visit = {}, transition) {
  return uniqueStrings(visit.workExchange?.transitionEvidenceIds?.[transition]);
}

function workObjective(visit, sceneConfig, workOrder, dependencies) {
  if (!workOrder) {
    const assignerActorIds = uniqueStrings(sceneConfig.workAssignerActorIds?.length ? sceneConfig.workAssignerActorIds : visit.expectedHostIds);
    const interactionZoneIds = uniqueStrings(
      sceneConfig.workAgreementZoneIds?.length
        ? sceneConfig.workAgreementZoneIds
        : sceneConfig.receptionZoneIds?.length ? sceneConfig.receptionZoneIds : visit.allowedZoneIds,
    );
    return {
      id: objectiveId(visit.id, "work", "unavailable"),
      kind: "work_exchange",
      label: "await a concrete open work order",
      description: "No open work order is currently available; an abstract task cannot be offered.",
      required: true,
      priority: 88,
      urgency: 60,
      responsibleActorIds: assignerActorIds,
      targetActorIds: uniqueStrings([visit.visitorId]),
      location: {
        allowedZoneIds: interactionZoneIds,
        interactionZoneIds,
        executionZoneIds: [],
        verificationZoneIds: [],
      },
      objectIds: [],
      dependsOn: uniqueStrings(dependencies),
      disclosure: { mode: "restricted", status: "undisclosed" },
      task: {
        stage: "pending",
        offerToActorIds: uniqueStrings([visit.visitorId]),
        executorActorIds: uniqueStrings([visit.visitorId]),
        verifierActorIds: assignerActorIds,
        compensation: {
          kind: "unavailable",
          actorIds: assignerActorIds,
          beneficiaryActorIds: uniqueStrings([visit.visitorId]),
          zoneIds: interactionZoneIds,
          objectIds: [],
        },
      },
      metadata: {
        adapterRole: "work-exchange",
        workOrderId: "",
        workOrderStatus: "unavailable",
        workOrderUnavailable: true,
        requiredUnits: 0,
        completionCriteria: [],
        taskObjectIds: [],
        toolIds: [],
        taskZoneId: "",
      },
    };
  }
  const assignerActorIds = uniqueStrings(
    workOrder.responsibleActorIds.length
      ? workOrder.responsibleActorIds
      : sceneConfig.workAssignerActorIds?.length ? sceneConfig.workAssignerActorIds : visit.expectedHostIds,
  );
  const verifierActorIds = uniqueStrings(workOrder.verifierActorIds.length ? workOrder.verifierActorIds : assignerActorIds);
  const compensationActorIds = uniqueStrings(
    workOrder.compensation.actorIds.length
      ? workOrder.compensation.actorIds
      : sceneConfig.compensationActorIds?.length ? sceneConfig.compensationActorIds : assignerActorIds,
  );
  const interactionZoneIds = uniqueStrings(
    sceneConfig.workAgreementZoneIds?.length
      ? sceneConfig.workAgreementZoneIds
      : sceneConfig.receptionZoneIds?.length ? sceneConfig.receptionZoneIds : visit.allowedZoneIds,
  );
  const compensationZoneIds = uniqueStrings(
    workOrder.compensation.zoneIds.length
      ? workOrder.compensation.zoneIds
      : sceneConfig.compensationZoneIds?.length ? sceneConfig.compensationZoneIds : interactionZoneIds,
  );
  const stage = workTaskStage(visit);
  return {
    id: objectiveId(visit.id, "work", workOrder.id),
    kind: "work_exchange",
    label: workOrder.taskLabel,
    description: workOrder.description,
    required: true,
    priority: 88,
    urgency: 60,
    responsibleActorIds: assignerActorIds,
    targetActorIds: uniqueStrings([visit.visitorId]),
    location: {
      allowedZoneIds: union(interactionZoneIds, [workOrder.zoneId], compensationZoneIds),
      interactionZoneIds,
      executionZoneIds: uniqueStrings([workOrder.zoneId]),
      verificationZoneIds: uniqueStrings([workOrder.zoneId]),
    },
    objectIds: union(workOrder.objectIds, workOrder.toolIds),
    dependsOn: uniqueStrings(dependencies),
    disclosure: {
      mode: "restricted",
      status: stage === "pending" ? "undisclosed" : "disclosed",
      disclosedToActorIds: stage === "pending" ? [] : uniqueStrings([visit.visitorId]),
    },
    task: {
      stage,
      offerToActorIds: uniqueStrings([visit.visitorId]),
      offeredToActorIds: stage === "pending" ? [] : uniqueStrings([visit.visitorId]),
      offeredByActorId: text(visit.workExchange?.agreement?.offeredByActorId || visit.workAssignedBy, 180),
      acceptedByActorId: text(visit.workExchange?.agreement?.acceptedByActorId || (stage !== "pending" && stage !== "offered" ? visit.visitorId : ""), 180),
      executorActorIds: uniqueStrings([visit.visitorId]),
      verifierActorIds,
      requiredObjectIds: union(workOrder.objectIds, workOrder.toolIds),
      currentCycle: finite(visit.workExchange?.execution?.cycle, 0),
      currentCycleEvidenceIds: uniqueStrings(visit.workExchange?.execution?.currentCycleEvidenceIds),
      executionEvidenceIds: uniqueStrings(visit.workExchange?.execution?.evidenceIds),
      submissionEvidenceIds: uniqueStrings(visit.workExchange?.execution?.submissionEvidenceIds),
      verificationEvidenceIds: uniqueStrings(visit.workExchange?.verification?.evidenceIds),
      reworkEvidenceIds: uniqueStrings(visit.workExchange?.verification?.reworkEvidenceIds),
      transitionEvidenceIds: Object.fromEntries([
        "offer", "accept", "refuse", "execute", "submit", "verify", "rework", "compensate",
      ].map((transition) => [transition, taskTransitionEvidence(visit, transition)])),
      compensation: {
        kind: workOrder.compensation.kind,
        actorIds: compensationActorIds,
        beneficiaryActorIds: uniqueStrings([visit.visitorId]),
        zoneIds: compensationZoneIds,
        objectIds: workOrder.compensation.objectIds,
        status: stage === "compensated" ? "delivered" : "pending",
        evidenceId: text(visit.workExchange?.compensation?.evidenceId, 180),
      },
    },
    metadata: {
      adapterRole: "work-exchange",
      workOrderId: workOrder.id,
      workOrderStatus: workOrder.status,
      requiredUnits: workOrder.requiredUnits,
      unitAction: workOrder.unitAction,
      completionCriteria: [...workOrder.completionCriteria],
      taskObjectIds: [...workOrder.objectIds],
      toolIds: [...workOrder.toolIds],
      taskZoneId: workOrder.zoneId,
    },
  };
}

function isWorkExchange(visit = {}) {
  return visit.paymentMode === "work_exchange"
    || visit.requestedService === "work_meal"
    || Boolean(visit.workExchange);
}

function serviceObjective(visit, sceneConfig, receptionId, workId, purposeObjectivesRows) {
  const requestedService = text(visit.requestedService || "none", 120);
  if (!requestedService || requestedService === "none") return null;
  const serviceId = objectiveId(visit.id, "service", requestedService);
  const purposeDependencies = purposeObjectivesRows
    .filter((objective) => objective.metadata?.requiredBeforeService)
    .map((objective) => objective.id);
  return {
    id: serviceId,
    kind: "service",
    label: text(visit.serviceLabel || requestedService, 240),
    required: true,
    priority: 74,
    urgency: 48,
    status: completedStatus(visit.serviceStatus === "served" || visit.workExchange?.compensation?.status === "delivered"),
    responsibleActorIds: uniqueStrings(sceneConfig.serviceActorIds?.length ? sceneConfig.serviceActorIds : visit.expectedHostIds),
    targetActorIds: uniqueStrings([visit.visitorId]),
    location: { allowedZoneIds: uniqueStrings(sceneConfig.serviceZoneIds?.length ? sceneConfig.serviceZoneIds : visit.allowedZoneIds) },
    objectIds: uniqueStrings(sceneConfig.serviceObjectIdsByType?.[requestedService] || []),
    dependsOn: uniqueStrings([receptionId, ...purposeDependencies]),
    disclosure: { mode: declared(visit) ? "public" : "restricted", status: declared(visit) ? "disclosed" : "undisclosed" },
    metadata: {
      adapterRole: "service",
      requestedService,
      ...(workId ? { satisfiedByObjectiveId: workId, satisfiedByTransition: "compensate" } : {}),
    },
  };
}

function paymentObjective(visit, sceneConfig, serviceId, workId) {
  const mode = text(visit.paymentMode || "cash", 100);
  const settled = ["paid", "credit", "work_settled"].includes(visit.paymentStatus);
  return {
    id: objectiveId(visit.id, "payment", mode),
    kind: "payment",
    label: text(visit.paymentLabel || mode, 240),
    required: true,
    priority: 70,
    urgency: 42,
    status: completedStatus(settled),
    responsibleActorIds: union([visit.visitorId], sceneConfig.paymentActorIds || []),
    targetActorIds: uniqueStrings(visit.expectedHostIds),
    location: { allowedZoneIds: uniqueStrings(sceneConfig.paymentZoneIds?.length ? sceneConfig.paymentZoneIds : visit.allowedZoneIds) },
    objectIds: uniqueStrings(sceneConfig.paymentObjectIdsByMode?.[mode] || []),
    dependsOn: uniqueStrings([serviceId]),
    disclosure: { mode: declared(visit) ? "public" : "restricted", status: declared(visit) ? "disclosed" : "undisclosed" },
    metadata: {
      adapterRole: "payment",
      paymentMode: mode,
      ...(workId ? { satisfiedByObjectiveId: workId, satisfiedByTransition: "compensate" } : {}),
    },
  };
}

export function ensureVisitObjectiveGraph({ visit = {}, workOrders = [], sceneConfig = {} } = {}) {
  if (visit.objectiveGraph?.objectives) return normalizeCommitmentGraph(visit.objectiveGraph);
  const visitId = text(visit.id, 180) || "unidentified-visit";
  const disclosureId = objectiveId(visitId, "disclosure");
  const receptionId = objectiveId(visitId, "reception");
  const purposeObjectiveRows = purposeObjectives({ ...visit, id: visitId }, sceneConfig, receptionId);
  const chosenWorkOrder = isWorkExchange(visit) ? selectWorkOrder(visit, workOrders) : null;
  const workDependencies = [receptionId, ...purposeObjectiveRows.filter((row) => row.metadata?.requiredBeforeService).map((row) => row.id)];
  const work = isWorkExchange(visit) ? workObjective({ ...visit, id: visitId }, sceneConfig, chosenWorkOrder, workDependencies) : null;
  const service = serviceObjective({ ...visit, id: visitId }, sceneConfig, receptionId, work?.id || "", purposeObjectiveRows);
  const payment = paymentObjective({ ...visit, id: visitId }, sceneConfig, service?.id || receptionId, work?.id || "");
  const objectives = [
    {
      id: disclosureId,
      kind: "disclosure",
      label: text(visit.purpose || "disclose visit purpose", 240),
      required: true,
      priority: 100,
      urgency: 72,
      status: completedStatus(declared(visit)),
      responsibleActorIds: uniqueStrings([visit.visitorId]),
      targetActorIds: uniqueStrings(visit.expectedHostIds),
      location: { allowedZoneIds: uniqueStrings(sceneConfig.disclosureZoneIds?.length ? sceneConfig.disclosureZoneIds : sceneConfig.receptionZoneIds?.length ? sceneConfig.receptionZoneIds : visit.allowedZoneIds) },
      objectIds: uniqueStrings(sceneConfig.disclosureObjectIds || []),
      disclosure: {
        mode: declared(visit) ? "public" : "restricted",
        status: declared(visit) ? "disclosed" : "undisclosed",
        disclosedToActorIds: declared(visit) ? uniqueStrings(visit.expectedHostIds) : [],
      },
      metadata: { adapterRole: "disclosure" },
    },
    {
      id: receptionId,
      kind: "reception",
      label: text(sceneConfig.receptionLabel || "receive the declared visit", 240),
      required: true,
      priority: 94,
      urgency: 66,
      status: completedStatus(Boolean(visit.hostId || visit.receivedBy)),
      responsibleActorIds: uniqueStrings(visit.expectedHostIds),
      targetActorIds: uniqueStrings([visit.visitorId]),
      location: { allowedZoneIds: uniqueStrings(sceneConfig.receptionZoneIds?.length ? sceneConfig.receptionZoneIds : visit.allowedZoneIds) },
      objectIds: [],
      dependsOn: [disclosureId],
      disclosure: { mode: "public", status: "disclosed" },
      metadata: { adapterRole: "reception" },
    },
    ...purposeObjectiveRows,
    ...(work ? [work] : []),
    ...(service ? [service] : []),
    ...(payment ? [payment] : []),
  ];
  return normalizeCommitmentGraph({
    id: `visit-objective-graph:${visitId}`,
    objectives,
    metadata: {
      adapterVersion: VISIT_COMMITMENT_ADAPTER_VERSION,
      visitId,
      objectiveIds: {
        disclosure: disclosureId,
        reception: receptionId,
        purposes: purposeObjectiveRows.map((row) => row.id),
        workExchange: work?.id || "",
        service: service?.id || "",
        payment: payment?.id || "",
      },
      workOrderSelection: chosenWorkOrder ? {
        status: "selected",
        workOrderId: chosenWorkOrder.id,
      } : {
        status: isWorkExchange(visit) ? "unavailable" : "not_required",
        workOrderId: "",
      },
    },
  });
}

function evidenceActorId(graph, evidenceIds = []) {
  const wanted = new Set(evidenceIds);
  return [...graph.evidence].reverse().find((row) => wanted.has(row.id))?.actorId || "";
}

function workMirror(graph) {
  const workId = graph.metadata?.objectiveIds?.workExchange || "";
  const objective = graph.objectives.find((row) => row.id === workId) || null;
  if (!objective?.task) return null;
  const task = objective.task;
  const stage = task.stage;
  const agreementStatus = stage === "pending"
    ? "unoffered"
    : stage === "offered" ? "offered"
      : stage === "refused" ? "refused" : "accepted";
  const executionStatus = stage === "rework"
    ? "rework_required"
    : stage === "executing" ? "in_progress"
      : ["submitted", "verified", "compensated"].includes(stage) ? "submitted" : "not_started";
  const verificationStatus = stage === "rework"
    ? "rework"
    : ["verified", "compensated"].includes(stage) ? "verified" : "pending";
  return {
    workOrderId: text(objective.metadata?.workOrderId, 180),
    taskLabel: objective.label,
    description: objective.description,
    zoneId: text(objective.metadata?.taskZoneId, 160),
    requiredUnits: finite(objective.metadata?.requiredUnits, 1),
    unitAction: text(objective.metadata?.unitAction, 400),
    completionCriteria: uniqueStrings(objective.metadata?.completionCriteria),
    objectIds: uniqueStrings(objective.metadata?.taskObjectIds),
    toolIds: uniqueStrings(objective.metadata?.toolIds),
    agreement: {
      status: agreementStatus,
      taskId: text(objective.metadata?.workOrderId, 180),
      description: objective.description,
      assignedTo: task.offerToActorIds[0] || "",
      assignedBy: task.offeredByActorId,
      zoneIds: [...objective.location.executionZoneIds],
      objectIds: uniqueStrings(objective.metadata?.taskObjectIds),
      toolIds: uniqueStrings(objective.metadata?.toolIds),
      completionCriteria: uniqueStrings(objective.metadata?.completionCriteria),
      offerActionId: task.transitionEvidenceIds.offer[0] || "",
      acceptedActionId: task.transitionEvidenceIds.accept[0] || "",
      offeredByActorId: task.offeredByActorId,
      offeredToActorIds: [...task.offeredToActorIds],
      acceptedByActorId: task.acceptedByActorId,
      offerEvidenceIds: [...task.transitionEvidenceIds.offer],
      acceptEvidenceIds: [...task.transitionEvidenceIds.accept],
      refuseEvidenceIds: [...task.transitionEvidenceIds.refuse],
    },
    execution: {
      status: executionStatus,
      requiredUnits: finite(objective.metadata?.requiredUnits, 1),
      cycle: task.currentCycle,
      currentCycleEvidenceIds: [...task.currentCycleEvidenceIds],
      evidenceIds: [...task.executionEvidenceIds],
      submissionEvidenceIds: [...task.submissionEvidenceIds],
    },
    verification: {
      status: verificationStatus,
      verifiedByActorId: evidenceActorId(graph, task.verificationEvidenceIds),
      evidenceIds: [...task.verificationEvidenceIds],
      reworkEvidenceIds: [...task.reworkEvidenceIds],
    },
    compensation: {
      kind: task.compensation.kind,
      status: task.compensation.status,
      actorIds: [...task.compensation.actorIds],
      beneficiaryActorIds: [...task.compensation.beneficiaryActorIds],
      zoneIds: [...task.compensation.zoneIds],
      objectIds: [...task.compensation.objectIds],
      evidenceId: task.compensation.evidenceId,
    },
    transitionEvidenceIds: clone(task.transitionEvidenceIds),
  };
}

function legacyWorkStatus(workExchange) {
  const agreement = workExchange?.agreement?.status;
  if (!workExchange) return "not_required";
  if (["pending", "unoffered"].includes(agreement)) return "unassigned";
  if (agreement === "offered") return "offered";
  if (agreement === "refused") return "refused";
  if (workExchange.verification.status === "verified") return "verified";
  if (workExchange.execution.status === "submitted") return "done";
  return "assigned";
}

function purposeObjectiveByKind(graph, kind) {
  return graph.objectives.find((row) => row.metadata?.adapterRole === "business-purpose" && row.kind === kind) || null;
}

export function syncLegacyVisitFieldsFromGraph(inputVisit = {}, inputGraph = {}) {
  const graph = normalizeCommitmentGraph(inputGraph);
  const visit = clone(inputVisit || {});
  const ids = graph.metadata?.objectiveIds || {};
  const disclosure = graph.objectives.find((row) => row.id === ids.disclosure);
  const reception = graph.objectives.find((row) => row.id === ids.reception);
  const service = graph.objectives.find((row) => row.id === ids.service);
  const payment = graph.objectives.find((row) => row.id === ids.payment);
  const workExchange = workMirror(graph);
  const purposeObjectivesRows = graph.objectives.filter((row) => row.metadata?.adapterRole === "business-purpose");
  const personalPurposeBySourceId = new Map(
    purposeObjectivesRows
      .filter((row) => row.kind === "social_request" && row.metadata?.sourcePurposeId)
      .map((row) => [row.metadata.sourcePurposeId, row]),
  );
  visit.personalOpenLoops = (visit.personalOpenLoops || []).map((loop) => {
    const objective = personalPurposeBySourceId.get(loop.sourceId);
    if (!objective) return loop;
    if (objective.status === "completed") return {
      ...loop,
      status: "resolved",
      resolutionEvidenceIds: uniqueStrings([...(loop.resolutionEvidenceIds || []), ...(objective.completionEvidenceIds || [])]),
    };
    if (objective.status === "cancelled") return {
      ...loop,
      status: "abandoned_by_choice",
      resolutionEvidenceIds: uniqueStrings([...(loop.resolutionEvidenceIds || []), ...(objective.completionEvidenceIds || [])]),
    };
    return loop;
  });
  const requiredObjectives = graph.objectives.filter((row) => row.required);
  const allRequiredComplete = requiredObjectives.length > 0 && requiredObjectives.every((row) => row.status === "completed");
  visit.objectiveGraph = graph;
  visit.objectives = graph.objectives.map((objective) => ({
    ...clone(objective),
    evidenceActionIds: uniqueStrings([
      ...(objective.completionEvidenceIds || []),
      ...Object.values(objective.task?.transitionEvidenceIds || {}).flat(),
    ]),
  }));
  visit.purposeStatus = disclosure?.status === "completed" ? "declared" : "undisclosed";
  visit.purposeDisclosureStatus = visit.purposeStatus;
  visit.declaredPurpose = visit.purposeStatus === "declared" ? (visit.declaredPurpose || visit.purpose || "") : "";
  if (reception?.status === "completed") {
    const actorId = evidenceActorId(graph, reception.completionEvidenceIds);
    visit.hostId = actorId || visit.hostId || visit.receivedBy || "";
    visit.receivedBy = visit.hostId;
  } else {
    visit.hostId = "";
    visit.receivedBy = "";
  }
  visit.businessStatus = purposeObjectivesRows.some((row) => row.kind === "business")
    ? purposeObjectivesRows.filter((row) => row.kind === "business").every((row) => row.status === "completed") ? "done" : "pending"
    : visit.businessStatus || "not_required";
  const delivery = purposeObjectiveByKind(graph, "delivery");
  visit.deliveryStatus = delivery ? delivery.status === "completed" ? "accepted" : "pending" : visit.deliveryStatus || "not_required";
  const lodging = purposeObjectiveByKind(graph, "lodging");
  visit.lodgingStatus = lodging ? lodging.status === "completed" ? "assigned" : "pending" : visit.lodgingStatus || "not_required";
  visit.serviceStatus = service ? service.status === "completed" ? "served" : "pending" : visit.serviceStatus || "pending";
  if (payment) visit.paymentStatus = payment.status === "completed"
    ? workExchange ? "work_settled" : visit.paymentStatus === "credit" ? "credit" : "paid"
    : workExchange ? "unsettled" : "unpaid";
  if (workExchange) {
    visit.workExchange = workExchange;
    visit.workStatus = legacyWorkStatus(workExchange);
  } else {
    delete visit.workExchange;
    visit.workStatus = visit.workStatus || "not_required";
  }
  if (allRequiredComplete) visit.stage = "completed";
  else if (workExchange?.verification.status === "rework") visit.stage = "work_rework";
  else if (workExchange?.execution.status === "submitted") visit.stage = "work_done";
  else if (workExchange?.agreement.status === "accepted") visit.stage = "work_assigned";
  else if (workExchange?.agreement.status === "offered") visit.stage = "work_offered";
  else if (reception?.status === "completed") visit.stage = "received";
  else visit.stage = "waiting";
  visit.objectiveSummary = {
    required: requiredObjectives.length,
    completed: requiredObjectives.filter((row) => row.status === "completed").length,
    pendingObjectiveIds: requiredObjectives.filter((row) => row.status !== "completed").map((row) => row.id),
  };
  return visit;
}

function adapterTransition(objective, transition) {
  if (objective?.task) return transition;
  const aliases = {
    disclosure: new Set(["disclose", "complete"]),
    reception: new Set(["receive", "complete"]),
    service: new Set(["serve", "complete"]),
    payment: new Set(["pay", "settle", "complete"]),
    delivery: new Set(["deliver", "accept_delivery", "complete"]),
    lodging: new Set(["assign", "assign_lodging", "complete"]),
    business: new Set(["perform", "complete"]),
    social_request: new Set(["request", "complete"]),
  };
  return aliases[objective?.kind]?.has(transition) ? "complete" : transition;
}

function applyAdapterSideEffects(inputGraph, sourceObjective, transition, evidence) {
  const graph = clone(inputGraph);
  if (sourceObjective.kind === "disclosure" && transition === "complete") {
    for (const objective of graph.objectives || []) {
      if (!["disclosure", "business-purpose", "service", "payment"].includes(objective.metadata?.adapterRole || objective.kind)) continue;
      objective.disclosure.status = "disclosed";
      objective.disclosure.disclosedToActorIds = union(
        objective.disclosure.disclosedToActorIds,
        evidence.targetActorIds,
      );
      objective.disclosure.evidenceIds = union(objective.disclosure.evidenceIds, [evidence.id]);
    }
  }
  if (transition === "compensate") {
    for (const objective of graph.objectives || []) {
      if (objective.metadata?.satisfiedByObjectiveId !== sourceObjective.id
        || objective.metadata?.satisfiedByTransition !== transition) continue;
      objective.status = "completed";
      objective.completionEvidenceIds = uniqueStrings([...(objective.completionEvidenceIds || []), evidence.id]);
    }
  }
  return normalizeCommitmentGraph(graph);
}

export function applyVisitObjectiveTransition({
  visit = {},
  workOrders = [],
  sceneConfig = {},
  objectiveId: requestedObjectiveId = "",
  transition: requestedTransition = "",
  evidence = {},
} = {}) {
  const graph = ensureVisitObjectiveGraph({ visit, workOrders, sceneConfig });
  const objective = graph.objectives.find((row) => row.id === requestedObjectiveId) || null;
  if (!objective) return {
    ok: false,
    graph,
    visit: syncLegacyVisitFieldsFromGraph(visit, graph),
    violations: [{ code: "VISIT_OBJECTIVE_NOT_FOUND", message: "The visit objective does not exist.", evidence: { objectiveId: requestedObjectiveId } }],
  };
  if (objective.metadata?.workOrderUnavailable) return {
    ok: false,
    graph,
    visit: syncLegacyVisitFieldsFromGraph(visit, graph),
    violations: [{
      code: "VISIT_OPEN_WORK_ORDER_REQUIRED",
      message: "A work exchange cannot be offered until the environment provides a concrete open work order.",
      evidence: { objectiveId: objective.id },
    }],
  };
  if (objective.metadata?.satisfiedByObjectiveId) return {
    ok: false,
    graph,
    visit: syncLegacyVisitFieldsFromGraph(visit, graph),
    violations: [{
      code: "VISIT_OBJECTIVE_MANAGED_BY_LINKED_TRANSITION",
      message: "This objective is settled by its linked source objective and cannot be advanced independently.",
      evidence: {
        objectiveId: objective.id,
        sourceObjectiveId: objective.metadata.satisfiedByObjectiveId,
        sourceTransition: objective.metadata.satisfiedByTransition,
      },
    }],
  };
  const transition = adapterTransition(objective, requestedTransition);
  const actionEvidence = {
    ...clone(evidence || {}),
    actionType: transition,
    objectiveId: objective.id,
    metadata: {
      ...(clone(evidence?.metadata || {})),
      visitTransition: requestedTransition,
    },
  };
  const result = applyCommitmentTransition(graph, {
    objectiveId: objective.id,
    transition,
    evidence: actionEvidence,
  });
  if (!result.ok) return {
    ...result,
    visit: syncLegacyVisitFieldsFromGraph(visit, result.graph),
    visitTransition: requestedTransition,
    graphTransition: transition,
  };
  const linkedGraph = applyAdapterSideEffects(result.graph, objective, transition, actionEvidence);
  const syncedVisit = syncLegacyVisitFieldsFromGraph(visit, linkedGraph);
  return {
    ...result,
    graph: linkedGraph,
    visit: syncedVisit,
    visitTransition: requestedTransition,
    graphTransition: transition,
    workOrderPatch: syncedVisit.workExchange ? {
      id: syncedVisit.workExchange.workOrderId,
      status: syncedVisit.workExchange.agreement.status === "refused"
        ? "open"
        : syncedVisit.workExchange.compensation.status === "delivered" ? "completed" : syncedVisit.workExchange.agreement.status,
    } : null,
  };
}
