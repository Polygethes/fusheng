export const COMMITMENT_GRAPH_SCHEMA_VERSION = 1;

export const TASK_STAGES = Object.freeze([
  "pending",
  "offered",
  "accepted",
  "refused",
  "executing",
  "submitted",
  "verified",
  "rework",
  "compensated",
]);

export const TASK_TRANSITIONS = Object.freeze([
  "offer",
  "accept",
  "refuse",
  "execute",
  "submit",
  "verify",
  "rework",
  "compensate",
]);

const TASK_STAGE_SET = new Set(TASK_STAGES);
const TASK_TRANSITION_SET = new Set(TASK_TRANSITIONS);
const OBJECTIVE_STATUS_SET = new Set([
  "pending",
  "active",
  "completed",
  "refused",
  "deferred",
  "cancelled",
]);
const DISCLOSURE_MODE_SET = new Set(["private", "restricted", "public"]);
const DISCLOSURE_STATUS_SET = new Set(["undisclosed", "disclosed"]);
const TERMINAL_OBJECTIVE_STATUSES = new Set(["completed", "refused", "cancelled"]);
const RESPONSE_TRANSITIONS = new Set(["accept", "refuse"]);
const FULFILLMENT_TRANSITIONS = new Set(["execute", "submit", "verify", "rework", "compensate", "complete"]);

const TASK_STAGE_TRANSITIONS = Object.freeze({
  pending: ["offer"],
  offered: ["accept", "refuse"],
  accepted: ["execute"],
  refused: [],
  executing: ["execute", "submit"],
  submitted: ["verify", "rework"],
  verified: ["compensate"],
  rework: ["execute"],
  compensated: [],
});

function text(value = "", max = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function finite(value, fallback = 0, min = 0, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function uniqueStrings(value = []) {
  const rows = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
  return [...new Set(rows.map((item) => text(item, 160)).filter(Boolean))];
}

function jsonValue(value, fallback) {
  try {
    const serialized = JSON.stringify(value);
    return serialized == null ? fallback : JSON.parse(serialized);
  } catch {
    return fallback;
  }
}

function normalizeLocation(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const allowedZoneIds = uniqueStrings(source.allowedZoneIds || source.zoneIds);
  return {
    allowedZoneIds,
    interactionZoneIds: uniqueStrings(source.interactionZoneIds?.length ? source.interactionZoneIds : allowedZoneIds),
    executionZoneIds: uniqueStrings(source.executionZoneIds?.length ? source.executionZoneIds : allowedZoneIds),
    verificationZoneIds: uniqueStrings(source.verificationZoneIds?.length ? source.verificationZoneIds : source.executionZoneIds?.length ? source.executionZoneIds : allowedZoneIds),
  };
}

function normalizeDisclosure(input = {}, responsibleActorIds = []) {
  const source = typeof input === "string" ? { mode: input } : input && typeof input === "object" ? input : {};
  const mode = DISCLOSURE_MODE_SET.has(source.mode) ? source.mode : "private";
  const disclosedToActorIds = uniqueStrings(source.disclosedToActorIds);
  const status = mode === "public" || source.status === "disclosed" || disclosedToActorIds.length
    ? "disclosed"
    : DISCLOSURE_STATUS_SET.has(source.status) ? source.status : "undisclosed";
  return {
    mode,
    status,
    ownerActorIds: uniqueStrings(source.ownerActorIds?.length ? source.ownerActorIds : responsibleActorIds),
    disclosedToActorIds,
    evidenceIds: uniqueStrings(source.evidenceIds),
    requiredBeforeAction: Boolean(source.requiredBeforeAction),
  };
}

function normalizeRequirement(input = {}, defaults = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const choose = (key) => uniqueStrings(Array.isArray(source[key]) ? source[key] : defaults[key]);
  return {
    actorIds: choose("actorIds"),
    zoneIds: choose("zoneIds"),
    objectIds: choose("objectIds"),
    targetActorIds: choose("targetActorIds"),
    targetMode: source.targetMode === "all" ? "all" : defaults.targetMode === "all" ? "all" : "any",
  };
}

function normalizeEvidence(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    id: text(source.id, 180),
    actionType: text(source.actionType || source.type, 80),
    actorId: text(source.actorId, 160),
    objectiveId: text(source.objectiveId, 180),
    zoneId: text(source.zoneId, 160),
    objectIds: uniqueStrings(source.objectIds),
    targetActorIds: uniqueStrings(source.targetActorIds),
    observedByActorIds: uniqueStrings(source.observedByActorIds),
    facts: uniqueStrings(source.facts),
    sequence: finite(source.sequence, 0, 0, Number.MAX_SAFE_INTEGER),
    metadata: jsonValue(source.metadata || {}, {}),
  };
}

function normalizeEvent(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    id: text(source.id, 200),
    objectiveId: text(source.objectiveId, 180),
    transition: text(source.transition, 80),
    evidenceId: text(source.evidenceId, 180),
    actorId: text(source.actorId, 160),
    fromTaskStage: text(source.fromTaskStage, 80),
    toTaskStage: text(source.toTaskStage, 80),
    fromObjectiveStatus: text(source.fromObjectiveStatus, 80),
    toObjectiveStatus: text(source.toObjectiveStatus, 80),
    sequence: finite(source.sequence, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

function normalizeCompensation(input = {}, responsibleActorIds = [], location = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const required = source.required !== false;
  return {
    kind: text(source.kind || "exchange", 100),
    required,
    status: required
      ? source.status === "delivered" ? "delivered" : "pending"
      : "not_required",
    actorIds: uniqueStrings(source.actorIds?.length ? source.actorIds : responsibleActorIds),
    beneficiaryActorIds: uniqueStrings(source.beneficiaryActorIds),
    zoneIds: uniqueStrings(source.zoneIds?.length ? source.zoneIds : location.interactionZoneIds),
    objectIds: uniqueStrings(source.objectIds),
    evidenceId: text(source.evidenceId, 180),
  };
}

function normalizeTask(input = {}, objective = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const stage = TASK_STAGE_SET.has(source.stage) ? source.stage : "pending";
  const offerToActorIds = uniqueStrings(source.offerToActorIds?.length ? source.offerToActorIds : objective.targetActorIds);
  const executorActorIds = uniqueStrings(source.executorActorIds?.length ? source.executorActorIds : offerToActorIds);
  const verifierActorIds = uniqueStrings(source.verifierActorIds?.length ? source.verifierActorIds : objective.responsibleActorIds);
  const compensation = normalizeCompensation(source.compensation, objective.responsibleActorIds, objective.location);
  const requiredObjectIds = uniqueStrings(source.requiredObjectIds?.length ? source.requiredObjectIds : objective.objectIds);
  const requirements = source.preconditions && typeof source.preconditions === "object" ? source.preconditions : {};
  const defaults = {
    offer: {
      actorIds: objective.responsibleActorIds,
      zoneIds: objective.location.interactionZoneIds,
      objectIds: [],
      targetActorIds: offerToActorIds,
      targetMode: source.offerTargetMode === "all" ? "all" : "any",
    },
    accept: { actorIds: offerToActorIds, zoneIds: objective.location.interactionZoneIds, objectIds: [], targetActorIds: [] },
    refuse: { actorIds: offerToActorIds, zoneIds: objective.location.interactionZoneIds, objectIds: [], targetActorIds: [] },
    execute: { actorIds: executorActorIds, zoneIds: objective.location.executionZoneIds, objectIds: requiredObjectIds, targetActorIds: [] },
    submit: { actorIds: executorActorIds, zoneIds: objective.location.executionZoneIds, objectIds: requiredObjectIds, targetActorIds: [] },
    verify: { actorIds: verifierActorIds, zoneIds: objective.location.verificationZoneIds, objectIds: requiredObjectIds, targetActorIds: [] },
    rework: { actorIds: verifierActorIds, zoneIds: objective.location.verificationZoneIds, objectIds: requiredObjectIds, targetActorIds: [] },
    compensate: {
      actorIds: compensation.actorIds,
      zoneIds: compensation.zoneIds,
      objectIds: compensation.objectIds,
      targetActorIds: compensation.beneficiaryActorIds,
      targetMode: "any",
    },
  };
  return {
    stage,
    offerToActorIds,
    offeredToActorIds: uniqueStrings(source.offeredToActorIds),
    offeredByActorId: text(source.offeredByActorId, 160),
    acceptedByActorId: text(source.acceptedByActorId, 160),
    executorActorIds,
    verifierActorIds,
    requiredObjectIds,
    currentCycle: finite(source.currentCycle, 0, 0, Number.MAX_SAFE_INTEGER),
    currentCycleEvidenceIds: uniqueStrings(source.currentCycleEvidenceIds),
    executionEvidenceIds: uniqueStrings(source.executionEvidenceIds),
    submissionEvidenceIds: uniqueStrings(source.submissionEvidenceIds),
    verificationEvidenceIds: uniqueStrings(source.verificationEvidenceIds),
    reworkEvidenceIds: uniqueStrings(source.reworkEvidenceIds),
    transitionEvidenceIds: Object.fromEntries(TASK_TRANSITIONS.map((transition) => [
      transition,
      uniqueStrings(source.transitionEvidenceIds?.[transition]),
    ])),
    compensation,
    preconditions: Object.fromEntries(TASK_TRANSITIONS.map((transition) => [
      transition,
      normalizeRequirement(requirements[transition], defaults[transition]),
    ])),
  };
}

function objectiveStatusForTask(task, fallback = "pending") {
  if (!task) return OBJECTIVE_STATUS_SET.has(fallback) ? fallback : "pending";
  if (task.stage === "compensated") return "completed";
  if (task.stage === "verified" && task.compensation?.required === false) return "completed";
  if (task.stage === "refused") return "refused";
  if (task.stage === "pending") return "pending";
  return "active";
}

function normalizeObjective(input = {}, index = 0) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const id = text(source.id, 180) || `objective:${index + 1}`;
  const responsibleActorIds = uniqueStrings(source.responsibleActorIds || source.ownerActorIds);
  const targetActorIds = uniqueStrings(source.targetActorIds);
  const location = normalizeLocation(source.location);
  const objectIds = uniqueStrings(source.objectIds);
  const base = {
    id,
    kind: text(source.kind || "objective", 100),
    label: text(source.label || id, 240),
    description: text(source.description, 500),
    required: source.required !== false,
    priority: finite(source.priority, 50),
    urgency: finite(source.urgency, 0),
    responsibleActorIds,
    targetActorIds,
    location,
    objectIds,
    dependsOn: uniqueStrings(source.dependsOn).filter((dependencyId) => dependencyId !== id),
    dependencySatisfiedStatuses: uniqueStrings(source.dependencySatisfiedStatuses?.length ? source.dependencySatisfiedStatuses : ["completed"]),
    disclosure: normalizeDisclosure(source.disclosure, responsibleActorIds),
    completionEvidenceIds: uniqueStrings(source.completionEvidenceIds),
    metadata: jsonValue(source.metadata || {}, {}),
  };
  const hasTask = Boolean(source.task && typeof source.task === "object") || base.kind === "task";
  const task = hasTask ? normalizeTask(source.task || {}, base) : null;
  return {
    ...base,
    status: objectiveStatusForTask(task, source.status),
    task,
  };
}

export function normalizeCommitmentGraph(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const objectiveIds = new Set();
  const objectives = [];
  for (const [index, row] of (Array.isArray(source.objectives) ? source.objectives : []).entries()) {
    const objective = normalizeObjective(row, index);
    if (objectiveIds.has(objective.id)) continue;
    objectiveIds.add(objective.id);
    objectives.push(objective);
  }
  const evidenceIds = new Set();
  const evidence = [];
  for (const row of (Array.isArray(source.evidence) ? source.evidence : [])) {
    const normalized = normalizeEvidence(row);
    if (!normalized.id || evidenceIds.has(normalized.id)) continue;
    evidenceIds.add(normalized.id);
    evidence.push(normalized);
  }
  const eventIds = new Set();
  const events = [];
  for (const row of (Array.isArray(source.events) ? source.events : [])) {
    const normalized = normalizeEvent(row);
    if (!normalized.id || eventIds.has(normalized.id)) continue;
    eventIds.add(normalized.id);
    events.push(normalized);
  }
  return {
    schemaVersion: COMMITMENT_GRAPH_SCHEMA_VERSION,
    id: text(source.id, 180) || "commitment-graph",
    revision: finite(source.revision, 0, 0, Number.MAX_SAFE_INTEGER),
    objectives,
    evidence,
    events,
    metadata: jsonValue(source.metadata || {}, {}),
  };
}

function objectiveById(graph, objectiveId) {
  return graph.objectives.find((objective) => objective.id === objectiveId) || null;
}

function dependencyState(graph, objective) {
  const rows = objective.dependsOn.map((dependencyId) => objectiveById(graph, dependencyId));
  const missingIds = objective.dependsOn.filter((dependencyId) => !rows.some((row) => row?.id === dependencyId));
  const incompleteIds = rows
    .filter((row) => row && !objective.dependencySatisfiedStatuses.includes(row.status))
    .map((row) => row.id);
  return {
    satisfied: missingIds.length === 0 && incompleteIds.length === 0,
    missingIds,
    incompleteIds,
  };
}

function actorKnowsObjective(objective, actorId) {
  if (!actorId) return true;
  if (objective.disclosure.mode === "public") return true;
  if (objective.responsibleActorIds.includes(actorId) || objective.disclosure.ownerActorIds.includes(actorId)) return true;
  return objective.disclosure.disclosedToActorIds.includes(actorId);
}

function subset(required = [], available = []) {
  const values = new Set(available);
  return required.every((item) => values.has(item));
}

function targetRequirementSatisfied(requirement, targetActorIds) {
  if (!requirement.targetActorIds.length) return true;
  const actual = new Set(targetActorIds);
  return requirement.targetMode === "all"
    ? requirement.targetActorIds.every((actorId) => actual.has(actorId))
    : requirement.targetActorIds.some((actorId) => actual.has(actorId));
}

function generalRequirement(objective, transition) {
  if (transition === "disclose") return {
    actorIds: objective.disclosure.ownerActorIds.length ? objective.disclosure.ownerActorIds : objective.responsibleActorIds,
    zoneIds: objective.location.interactionZoneIds,
    objectIds: [],
    targetActorIds: [],
    targetMode: "any",
  };
  return {
    actorIds: objective.responsibleActorIds,
    zoneIds: objective.location.allowedZoneIds,
    objectIds: objective.objectIds,
    targetActorIds: [],
    targetMode: "any",
  };
}

function requirementFor(objective, transition) {
  const requirement = objective.task?.preconditions?.[transition] || generalRequirement(objective, transition);
  if (!objective.task) return requirement;
  if (["accept", "refuse"].includes(transition) && objective.task.offeredToActorIds.length) return {
    ...requirement,
    actorIds: [...objective.task.offeredToActorIds],
  };
  if (["execute", "submit"].includes(transition) && objective.task.acceptedByActorId) return {
    ...requirement,
    actorIds: objective.task.executorActorIds.includes(objective.task.acceptedByActorId)
      ? [objective.task.acceptedByActorId]
      : [...objective.task.executorActorIds],
  };
  return requirement;
}

function allowedTransitions(objective) {
  if (TERMINAL_OBJECTIVE_STATUSES.has(objective.status)) return [];
  const transitions = objective.task
    ? [...(TASK_STAGE_TRANSITIONS[objective.task.stage] || [])]
    : ["complete"];
  if (objective.disclosure.status === "undisclosed") transitions.unshift("disclose");
  return [...new Set(transitions)];
}

function preconditionViolations(graph, objective, transition, evidence) {
  const violations = [];
  const requirement = requirementFor(objective, transition);
  const dependencies = dependencyState(graph, objective);
  if (transition !== "disclose" && !dependencies.satisfied) violations.push({
    code: "DEPENDENCIES_UNSATISFIED",
    message: "The objective has unresolved dependencies.",
    evidence: dependencies,
  });
  if (transition !== "disclose" && objective.disclosure.requiredBeforeAction && objective.disclosure.status !== "disclosed" && transition !== "offer") {
    violations.push({
      code: "DISCLOSURE_REQUIRED",
      message: "The objective must be disclosed before this transition.",
      evidence: { objectiveId: objective.id },
    });
  }
  if (!evidence?.id) violations.push({ code: "ACTION_EVIDENCE_REQUIRED", message: "Every transition requires uniquely identified action evidence.", evidence: {} });
  if (!evidence?.actorId) violations.push({ code: "ACTION_ACTOR_REQUIRED", message: "Action evidence must identify its actor.", evidence: {} });
  if (evidence?.actionType !== transition) violations.push({
    code: "ACTION_TYPE_MISMATCH",
    message: "Action evidence does not match the requested transition.",
    evidence: { expected: transition, actual: evidence?.actionType || "" },
  });
  if (evidence?.objectiveId && evidence.objectiveId !== objective.id) violations.push({
    code: "ACTION_OBJECTIVE_MISMATCH",
    message: "Action evidence belongs to a different objective.",
    evidence: { expected: objective.id, actual: evidence.objectiveId },
  });
  if (evidence?.id && graph.evidence.some((row) => row.id === evidence.id)) violations.push({
    code: "ACTION_EVIDENCE_ALREADY_USED",
    message: "One action cannot advance the graph twice.",
    evidence: { evidenceId: evidence.id },
  });
  if (requirement.actorIds.length && evidence?.actorId && !requirement.actorIds.includes(evidence.actorId)) violations.push({
    code: "ACTOR_NOT_ELIGIBLE",
    message: "The action actor is not eligible for this transition.",
    evidence: { actorId: evidence.actorId, eligibleActorIds: requirement.actorIds },
  });
  if (requirement.zoneIds.length && !requirement.zoneIds.includes(evidence?.zoneId || "")) violations.push({
    code: "ZONE_PRECONDITION_FAILED",
    message: "The action occurred outside an allowed zone.",
    evidence: { zoneId: evidence?.zoneId || "", allowedZoneIds: requirement.zoneIds },
  });
  const missingObjectIds = requirement.objectIds.filter((objectId) => !evidence?.objectIds?.includes(objectId));
  if (missingObjectIds.length) violations.push({
    code: "OBJECT_PRECONDITION_FAILED",
    message: "Required objects are absent from the action evidence.",
    evidence: { missingObjectIds, requiredObjectIds: requirement.objectIds },
  });
  if (!targetRequirementSatisfied(requirement, evidence?.targetActorIds || [])) violations.push({
    code: "TARGET_PRECONDITION_FAILED",
    message: "The action did not reach the required target actor or actors.",
    evidence: { requiredTargetActorIds: requirement.targetActorIds, targetMode: requirement.targetMode },
  });
  if (transition === "disclose" && objective.disclosure.mode !== "public" && !evidence?.targetActorIds?.length) violations.push({
    code: "DISCLOSURE_RECIPIENT_REQUIRED",
    message: "A non-public disclosure must identify at least one recipient.",
    evidence: { disclosureMode: objective.disclosure.mode },
  });
  if (transition === "submit" && !objective.task?.currentCycleEvidenceIds.length) violations.push({
    code: "EXECUTION_EVIDENCE_REQUIRED",
    message: "A task cannot be submitted without execution evidence from the current cycle.",
    evidence: { currentCycle: objective.task?.currentCycle || 0 },
  });
  return violations;
}

function appendUnique(rows, value) {
  return value && !rows.includes(value) ? [...rows, value] : [...rows];
}

function applyDisclosure(objective, evidence) {
  const recipients = evidence.targetActorIds;
  objective.disclosure.disclosedToActorIds = uniqueStrings([
    ...objective.disclosure.disclosedToActorIds,
    ...recipients,
  ]);
  objective.disclosure.evidenceIds = appendUnique(objective.disclosure.evidenceIds, evidence.id);
  objective.disclosure.status = "disclosed";
}

function applyTaskTransition(objective, transition, evidence) {
  const task = objective.task;
  task.transitionEvidenceIds[transition] = appendUnique(task.transitionEvidenceIds[transition], evidence.id);
  if (transition === "offer") {
    task.stage = "offered";
    task.offeredByActorId = evidence.actorId;
    task.offeredToActorIds = task.offerToActorIds.filter((actorId) => evidence.targetActorIds.includes(actorId));
    applyDisclosure(objective, evidence);
  } else if (transition === "accept") {
    task.stage = "accepted";
    task.acceptedByActorId = evidence.actorId;
    if (!task.executorActorIds.length) task.executorActorIds = [evidence.actorId];
  } else if (transition === "refuse") {
    task.stage = "refused";
  } else if (transition === "execute") {
    task.stage = "executing";
    task.currentCycleEvidenceIds = appendUnique(task.currentCycleEvidenceIds, evidence.id);
    task.executionEvidenceIds = appendUnique(task.executionEvidenceIds, evidence.id);
  } else if (transition === "submit") {
    task.stage = "submitted";
    task.submissionEvidenceIds = appendUnique(task.submissionEvidenceIds, evidence.id);
  } else if (transition === "verify") {
    task.stage = "verified";
    task.verificationEvidenceIds = appendUnique(task.verificationEvidenceIds, evidence.id);
  } else if (transition === "rework") {
    task.stage = "rework";
    task.currentCycle += 1;
    task.currentCycleEvidenceIds = [];
    task.reworkEvidenceIds = appendUnique(task.reworkEvidenceIds, evidence.id);
  } else if (transition === "compensate") {
    task.stage = "compensated";
    task.compensation.status = "delivered";
    task.compensation.evidenceId = evidence.id;
  }
  objective.status = objectiveStatusForTask(task, objective.status);
}

export function applyCommitmentTransition(inputGraph = {}, request = {}) {
  const graph = normalizeCommitmentGraph(inputGraph);
  const transition = text(request.transition, 80);
  const objectiveId = text(request.objectiveId, 180);
  const objective = objectiveById(graph, objectiveId);
  const evidence = normalizeEvidence(request.evidence || request.actionEvidence || {});
  if (!objective) return {
    ok: false,
    graph,
    violations: [{ code: "OBJECTIVE_NOT_FOUND", message: "The requested objective does not exist.", evidence: { objectiveId } }],
  };
  const supportedTransition = transition === "disclose"
    || transition === "complete"
    || TASK_TRANSITION_SET.has(transition);
  if (!supportedTransition || !allowedTransitions(objective).includes(transition)) return {
    ok: false,
    graph,
    violations: [{
      code: "TRANSITION_NOT_ALLOWED",
      message: "The requested transition is not available from the current state.",
      evidence: { transition, objectiveStatus: objective.status, taskStage: objective.task?.stage || "" },
    }],
  };
  const violations = preconditionViolations(graph, objective, transition, evidence);
  if (violations.length) return { ok: false, graph, violations };

  const fromTaskStage = objective.task?.stage || "";
  const fromObjectiveStatus = objective.status;
  if (transition === "disclose") applyDisclosure(objective, evidence);
  else if (transition === "complete") {
    objective.status = "completed";
    objective.completionEvidenceIds = appendUnique(objective.completionEvidenceIds, evidence.id);
  } else applyTaskTransition(objective, transition, evidence);
  evidence.objectiveId = objective.id;
  evidence.sequence = graph.events.length + 1;
  graph.evidence.push(evidence);
  const event = {
    id: `commitment-event:${evidence.id}`,
    objectiveId: objective.id,
    transition,
    evidenceId: evidence.id,
    actorId: evidence.actorId,
    fromTaskStage,
    toTaskStage: objective.task?.stage || "",
    fromObjectiveStatus,
    toObjectiveStatus: objective.status,
    sequence: graph.events.length + 1,
  };
  graph.events.push(event);
  graph.revision += 1;
  return { ok: true, graph: normalizeCommitmentGraph(graph), event: normalizeEvent(event), violations: [] };
}

function contextPreconditions(objective, transition, context = {}) {
  const requirement = requirementFor(objective, transition);
  const blockers = [];
  if (context.actorId && requirement.actorIds.length && !requirement.actorIds.includes(context.actorId)) blockers.push("actor");
  if (context.zoneId && requirement.zoneIds.length && !requirement.zoneIds.includes(context.zoneId)) blockers.push("zone");
  if (Array.isArray(context.objectIds) && !subset(requirement.objectIds, context.objectIds)) blockers.push("objects");
  if (Array.isArray(context.perceivedActorIds) && requirement.targetActorIds.length) {
    const perceived = new Set(context.perceivedActorIds);
    const targetReady = requirement.targetMode === "all"
      ? requirement.targetActorIds.every((actorId) => perceived.has(actorId))
      : requirement.targetActorIds.some((actorId) => perceived.has(actorId));
    if (!targetReady) blockers.push("target");
  }
  return blockers;
}

export function getActionableObjectives(inputGraph = {}, context = {}) {
  const graph = normalizeCommitmentGraph(inputGraph);
  const actorId = text(context.actorId, 160);
  return graph.objectives.flatMap((objective) => {
    if (!actorKnowsObjective(objective, actorId)) return [];
    const dependencies = dependencyState(graph, objective);
    const nextTransitions = allowedTransitions(objective).filter((transition) => {
      if (transition !== "disclose" && !dependencies.satisfied) return false;
      if (transition !== "disclose" && objective.disclosure.requiredBeforeAction && objective.disclosure.status !== "disclosed" && transition !== "offer") return false;
      return contextPreconditions(objective, transition, context).length === 0;
    });
    if (!nextTransitions.length) return [];
    return [{
      objectiveId: objective.id,
      label: objective.label,
      kind: objective.kind,
      status: objective.status,
      taskStage: objective.task?.stage || "",
      priority: objective.priority,
      urgency: objective.urgency,
      nextTransitions,
      responsibleActorIds: [...objective.responsibleActorIds],
      targetActorIds: [...objective.targetActorIds],
      zoneIds: uniqueStrings(nextTransitions.flatMap((transition) => requirementFor(objective, transition).zoneIds)),
      objectIds: uniqueStrings(nextTransitions.flatMap((transition) => requirementFor(objective, transition).objectIds)),
    }];
  });
}

function obligationForTransition(graph, objective, transition) {
  const requirement = requirementFor(objective, transition);
  const dependencies = dependencyState(graph, objective);
  const response = RESPONSE_TRANSITIONS.has(transition);
  const fulfillment = FULFILLMENT_TRANSITIONS.has(transition);
  const directTargetBonus = response ? 24 : 0;
  const stageBonus = {
    disclose: 7,
    offer: 10,
    accept: 22,
    refuse: 22,
    execute: 14,
    submit: 18,
    verify: 20,
    rework: 20,
    compensate: 24,
    complete: 16,
  }[transition] || 0;
  const unblocks = graph.objectives.filter((candidate) => candidate.dependsOn.includes(objective.id)).length;
  const blocked = transition !== "disclose" && !dependencies.satisfied;
  const score = Math.max(0, Math.round(
    objective.priority
    + objective.urgency * 0.35
    + (objective.required ? 12 : 0)
    + directTargetBonus
    + stageBonus
    + unblocks * 5
    - (blocked ? 55 : 0),
  ));
  return {
    id: `obligation:${objective.id}:${transition}`,
    objectiveId: objective.id,
    objectiveLabel: objective.label,
    transition,
    obligationType: response ? "response" : fulfillment ? "fulfillment" : "coordination",
    owedByActorIds: [...requirement.actorIds],
    owedToActorIds: transition === "offer" || transition === "disclose"
      ? [...requirement.targetActorIds]
      : transition === "accept" || transition === "refuse"
        ? uniqueStrings([objective.task?.offeredByActorId])
        : [...objective.targetActorIds],
    zoneIds: [...requirement.zoneIds],
    objectIds: [...requirement.objectIds],
    actionable: !blocked,
    blockedByObjectiveIds: uniqueStrings([...dependencies.missingIds, ...dependencies.incompleteIds]),
    responsePriority: response ? score : 0,
    fulfillmentPriority: fulfillment ? score : 0,
    priorityScore: score,
  };
}

export function getPendingObligations(inputGraph = {}, context = {}) {
  const graph = normalizeCommitmentGraph(inputGraph);
  const actorId = text(context.actorId, 160);
  const rows = [];
  for (const objective of graph.objectives) {
    if (TERMINAL_OBJECTIVE_STATUSES.has(objective.status)) continue;
    const transitions = allowedTransitions(objective);
    for (const transition of transitions) {
      if (transition === "disclose" && objective.task?.stage === "pending") continue;
      const row = obligationForTransition(graph, objective, transition);
      if (actorId && !row.owedByActorIds.includes(actorId)) continue;
      rows.push(row);
    }
  }
  return rows.sort((a, b) => b.priorityScore - a.priorityScore || a.id.localeCompare(b.id));
}

export function rankCommitmentPriorities(inputGraph = {}, context = {}) {
  return getPendingObligations(inputGraph, context).map((row, index) => ({
    ...row,
    rank: index + 1,
  }));
}
