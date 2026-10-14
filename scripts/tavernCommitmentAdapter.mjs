import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyVisitObjectiveTransition,
  ensureVisitObjectiveGraph,
  syncLegacyVisitFieldsFromGraph,
} from "../src/server/pipeline/tavernCommitmentAdapter.mjs";
import { normalizeCommitmentGraph } from "../src/server/simulation/commitmentGraph.mjs";

function evidence(id, actionType, actorId, zoneId, objectIds = [], targetActorIds = []) {
  return { id, actionType, actorId, zoneId, objectIds, targetActorIds };
}

function objectiveId(state, role) {
  return state.visit.objectiveGraph.metadata.objectiveIds[role];
}

function purposeId(state, index = 0) {
  return state.visit.objectiveGraph.metadata.objectiveIds.purposes[index];
}

function advance(state, targetObjectiveId, transition, actionEvidence) {
  const result = applyVisitObjectiveTransition({
    visit: state.visit,
    workOrders: state.workOrders,
    sceneConfig: state.sceneConfig,
    objectiveId: targetObjectiveId,
    transition,
    evidence: actionEvidence,
  });
  assert.equal(result.ok, true, `${transition} should succeed: ${JSON.stringify(result.violations)}`);
  return { ...state, visit: result.visit, lastResult: result };
}

function reject(state, targetObjectiveId, transition, actionEvidence, code) {
  const before = state.visit.objectiveGraph;
  const result = applyVisitObjectiveTransition({
    visit: state.visit,
    workOrders: state.workOrders,
    sceneConfig: state.sceneConfig,
    objectiveId: targetObjectiveId,
    transition,
    evidence: actionEvidence,
  });
  assert.equal(result.ok, false, `${transition} should fail`);
  assert.ok(result.violations.some((row) => row.code === code), `${code} missing from ${JSON.stringify(result.violations)}`);
  assert.deepEqual(result.graph, before, "rejected adapter transition must preserve the graph");
}

function persist(state) {
  const serialized = JSON.stringify(state.visit.objectiveGraph);
  const restored = JSON.parse(serialized);
  assert.deepEqual(normalizeCommitmentGraph(restored), state.visit.objectiveGraph);
  assert.deepEqual(normalizeCommitmentGraph(state.visit.objectiveGraph), state.visit.objectiveGraph);
}

const adapterSource = readFileSync(new URL("../src/server/pipeline/tavernCommitmentAdapter.mjs", import.meta.url), "utf8");
for (const forbidden of [
  "field_specialist",
  "dispatch_unit",
  "manuscript_team",
  "collection_unit",
  "char_",
]) assert.equal(adapterSource.includes(forbidden), false, `adapter logic must not contain fixture or fixed actor id: ${forbidden}`);

const maintenanceVisit = {
  id: "visit-maintenance-exchange",
  visitorId: "field_specialist",
  expectedHostIds: ["dispatch_unit", "intake_unit"],
  purpose: "deliver a replacement module and complete assigned maintenance",
  purposeStatus: "undisclosed",
  purposeDisclosureStatus: "undisclosed",
  kind: "maintenance_exchange",
  businessPurposes: [{
    id: "module-handover",
    kind: "delivery",
    label: "hand over the replacement module",
    required: true,
    requiredBeforeService: true,
    responsibleActorIds: ["intake_unit"],
    targetActorIds: ["field_specialist"],
    zoneIds: ["intake_bay"],
    objectIds: ["replacement_module"],
  }],
  requestedService: "supply_allocation",
  paymentMode: "work_exchange",
  workStatus: "unassigned",
  serviceStatus: "pending",
  paymentStatus: "unsettled",
  deliveryStatus: "pending",
  allowedZoneIds: ["entry_gate", "intake_bay", "assignment_desk", "machine_floor", "issue_counter"],
  stage: "waiting",
};

const maintenanceOrders = [
  {
    id: "retired-order",
    status: "closed",
    priority: 100,
    zoneId: "machine_floor",
    taskLabel: "retired task",
    description: "must never be selected",
    requiredUnits: 1,
    completionCriteria: ["obsolete"],
    objectIds: ["retired_device"],
    toolIds: ["retired_tool"],
    compensation: { kind: "none" },
  },
  {
    id: "align-drive-assembly",
    status: "open",
    priority: 80,
    zoneId: "machine_floor",
    taskLabel: "align the drive assembly",
    description: "align two couplings and record the final tolerance",
    requiredUnits: 2,
    completionCriteria: ["both couplings aligned", "tolerance entered in the inspection sheet"],
    objectIds: ["drive_assembly"],
    toolIds: ["alignment_gauge"],
    responsibleActorIds: ["work_coordinator"],
    verifierActorIds: ["quality_unit"],
    compensation: {
      kind: "supply_allocation",
      actorIds: ["inventory_unit"],
      zoneIds: ["issue_counter"],
      objectIds: ["supply_case"],
    },
  },
];

const maintenanceConfig = {
  disclosureZoneIds: ["entry_gate"],
  receptionZoneIds: ["intake_bay"],
  workAgreementZoneIds: ["assignment_desk"],
  serviceActorIds: ["inventory_unit"],
  serviceZoneIds: ["issue_counter"],
  serviceObjectIdsByType: { supply_allocation: ["supply_case"] },
  paymentActorIds: ["inventory_unit"],
  paymentZoneIds: ["issue_counter"],
};

const unavailableGraph = ensureVisitObjectiveGraph({
  visit: maintenanceVisit,
  workOrders: maintenanceOrders.filter((order) => order.status !== "open"),
  sceneConfig: maintenanceConfig,
});
const unavailableWorkId = unavailableGraph.metadata.objectiveIds.workExchange;
assert.equal(
  unavailableGraph.objectives.find((row) => row.id === unavailableWorkId)?.metadata.workOrderUnavailable,
  true,
  "work exchange must remain explicitly blocked when no concrete open order exists",
);
const unavailableOffer = applyVisitObjectiveTransition({
  visit: syncLegacyVisitFieldsFromGraph(maintenanceVisit, unavailableGraph),
  workOrders: maintenanceOrders.filter((order) => order.status !== "open"),
  sceneConfig: maintenanceConfig,
  objectiveId: unavailableWorkId,
  transition: "offer",
  evidence: evidence("unavailable-offer", "offer", "dispatch_unit", "assignment_desk", [], ["field_specialist"]),
});
assert.equal(unavailableOffer.ok, false);
assert.ok(unavailableOffer.violations.some((row) => row.code === "VISIT_OPEN_WORK_ORDER_REQUIRED"));

let maintenanceGraph = ensureVisitObjectiveGraph({
  visit: maintenanceVisit,
  workOrders: maintenanceOrders,
  sceneConfig: maintenanceConfig,
});
assert.deepEqual(
  maintenanceGraph.objectives.map((row) => row.kind),
  ["disclosure", "reception", "delivery", "work_exchange", "service", "payment"],
  "adapter must create explicit visit objectives",
);
assert.equal(maintenanceGraph.metadata.workOrderSelection.workOrderId, "align-drive-assembly", "only a concrete open order may be selected");
assert.deepEqual(
  ensureVisitObjectiveGraph({ visit: maintenanceVisit, workOrders: maintenanceOrders, sceneConfig: maintenanceConfig }),
  maintenanceGraph,
  "fresh adaptation must be deterministic",
);
let maintenance = {
  visit: syncLegacyVisitFieldsFromGraph(maintenanceVisit, maintenanceGraph),
  workOrders: maintenanceOrders,
  sceneConfig: maintenanceConfig,
};
assert.equal(maintenance.visit.workExchange.workOrderId, "align-drive-assembly");
assert.equal(maintenance.visit.workExchange.zoneId, "machine_floor");
assert.equal(maintenance.visit.workExchange.requiredUnits, 2);
assert.deepEqual(maintenance.visit.workExchange.objectIds, ["drive_assembly"]);
assert.deepEqual(maintenance.visit.workExchange.toolIds, ["alignment_gauge"]);
assert.equal(maintenance.visit.workExchange.agreement.status, "unoffered");
assert.equal(maintenance.visit.workStatus, "unassigned");

maintenance = advance(
  maintenance,
  objectiveId(maintenance, "disclosure"),
  "disclose",
  evidence("maintenance-disclose", "disclose", "field_specialist", "entry_gate", [], ["dispatch_unit"]),
);
assert.equal(maintenance.visit.purposeStatus, "declared");
assert.equal(
  maintenance.visit.objectiveGraph.objectives.find((row) => row.kind === "delivery").disclosure.status,
  "disclosed",
  "declaring the visit must expose its declared business purpose",
);
maintenance = advance(
  maintenance,
  objectiveId(maintenance, "reception"),
  "receive",
  evidence("maintenance-receive", "receive", "dispatch_unit", "intake_bay", [], ["field_specialist"]),
);
assert.equal(maintenance.visit.hostId, "dispatch_unit");
maintenance = advance(
  maintenance,
  purposeId(maintenance),
  "deliver",
  evidence("maintenance-delivery", "deliver", "intake_unit", "intake_bay", ["replacement_module"], ["field_specialist"]),
);
assert.equal(maintenance.visit.deliveryStatus, "accepted");

const maintenanceWorkId = objectiveId(maintenance, "workExchange");
maintenance = advance(
  maintenance,
  maintenanceWorkId,
  "offer",
  evidence("maintenance-offer", "offer", "work_coordinator", "assignment_desk", [], ["field_specialist"]),
);
assert.equal(maintenance.visit.workExchange.agreement.status, "offered");
assert.equal(maintenance.visit.workExchange.agreement.acceptedByActorId, "");
assert.equal(maintenance.visit.workExchange.execution.status, "not_started");
assert.equal(maintenance.visit.workStatus, "offered");
assert.equal(maintenance.visit.stage, "work_offered");
assert.notEqual(maintenance.visit.stage, "work_assigned", "offer must not silently become acceptance");
reject(
  maintenance,
  maintenanceWorkId,
  "execute",
  evidence("maintenance-execute-too-early", "execute", "field_specialist", "machine_floor", ["drive_assembly", "alignment_gauge"]),
  "TRANSITION_NOT_ALLOWED",
);
maintenance = advance(
  maintenance,
  maintenanceWorkId,
  "accept",
  evidence("maintenance-accept", "accept", "field_specialist", "assignment_desk"),
);
assert.equal(maintenance.visit.workExchange.agreement.status, "accepted");
assert.equal(maintenance.visit.workExchange.agreement.acceptedByActorId, "field_specialist");
assert.equal(maintenance.visit.workStatus, "assigned");
assert.equal(maintenance.visit.stage, "work_assigned");
maintenance = advance(
  maintenance,
  maintenanceWorkId,
  "execute",
  evidence("maintenance-execute", "execute", "field_specialist", "machine_floor", ["drive_assembly", "alignment_gauge"]),
);
maintenance = advance(
  maintenance,
  maintenanceWorkId,
  "submit",
  evidence("maintenance-submit", "submit", "field_specialist", "machine_floor", ["drive_assembly", "alignment_gauge"]),
);
maintenance = advance(
  maintenance,
  maintenanceWorkId,
  "verify",
  evidence("maintenance-verify", "verify", "quality_unit", "machine_floor", ["drive_assembly", "alignment_gauge"]),
);
reject(
  maintenance,
  objectiveId(maintenance, "service"),
  "serve",
  evidence("maintenance-serve-outside-link", "serve", "inventory_unit", "issue_counter", ["supply_case"], ["field_specialist"]),
  "VISIT_OBJECTIVE_MANAGED_BY_LINKED_TRANSITION",
);
maintenance = advance(
  maintenance,
  maintenanceWorkId,
  "compensate",
  evidence("maintenance-compensate", "compensate", "inventory_unit", "issue_counter", ["supply_case"], ["field_specialist"]),
);
assert.equal(maintenance.visit.workExchange.compensation.status, "delivered");
assert.equal(maintenance.visit.serviceStatus, "served");
assert.equal(maintenance.visit.paymentStatus, "work_settled");
assert.equal(maintenance.visit.workStatus, "verified");
assert.equal(maintenance.visit.stage, "completed");
assert.deepEqual(maintenance.lastResult.workOrderPatch, { id: "align-drive-assembly", status: "completed" });
persist(maintenance);

const archiveVisit = {
  id: "visit-archive-exchange",
  visitorId: "manuscript_team",
  expectedHostIds: ["collection_unit"],
  purpose: "inspect a manuscript batch and negotiate a transcription exchange",
  purposeStatus: "undisclosed",
  kind: "research_exchange",
  businessPurposes: [
    {
      id: "inspect-batch",
      kind: "business",
      label: "inspect the manuscript batch",
      required: true,
      requiredBeforeService: true,
      responsibleActorIds: ["manuscript_team"],
      targetActorIds: ["collection_unit"],
      zoneIds: ["review_room"],
      objectIds: ["manuscript_batch"],
    },
    {
      id: "ask-catalogue-question",
      kind: "social_request",
      label: "ask a separate catalogue question",
      required: false,
      responsibleActorIds: ["manuscript_team"],
      targetActorIds: ["catalogue_unit"],
      zoneIds: ["review_room"],
    },
  ],
  requestedService: "research_access",
  paymentMode: "work_exchange",
  workStatus: "unassigned",
  serviceStatus: "pending",
  paymentStatus: "unsettled",
  allowedZoneIds: ["archive_entry", "review_room", "scriptorium", "credential_desk"],
  stage: "waiting",
};

const archiveOrders = [
  {
    id: "ineligible-transcription-order",
    status: "open",
    priority: 99,
    eligibleVisitorIds: ["another_team"],
    zoneId: "scriptorium",
    taskLabel: "transcribe an unrelated batch",
    description: "not available to this visitor",
    requiredUnits: 8,
    completionCriteria: ["eight folios completed"],
    objectIds: ["unrelated_batch"],
    toolIds: ["writing_set"],
    compensation: { kind: "research_access", objectIds: ["access_credential"] },
  },
  {
    id: "index-three-folios",
    status: "open",
    priority: 64,
    eligibleVisitorIds: ["manuscript_team"],
    zoneId: "scriptorium",
    taskLabel: "index three folios",
    description: "record headings and shelf marks for three folios",
    requiredUnits: 3,
    completionCriteria: ["three headings recorded", "three shelf marks checked"],
    objectIds: ["folio_set"],
    toolIds: ["index_sheet"],
    responsibleActorIds: ["collection_unit"],
    verifierActorIds: ["catalogue_unit"],
    compensation: {
      kind: "research_access",
      actorIds: ["credential_unit"],
      zoneIds: ["credential_desk"],
      objectIds: ["access_credential"],
    },
  },
];

const archiveConfig = {
  disclosureZoneIds: ["archive_entry"],
  receptionZoneIds: ["review_room"],
  workAgreementZoneIds: ["review_room"],
  serviceActorIds: ["credential_unit"],
  serviceZoneIds: ["credential_desk"],
};

let archiveGraph = ensureVisitObjectiveGraph({ visit: archiveVisit, workOrders: archiveOrders, sceneConfig: archiveConfig });
assert.equal(archiveGraph.metadata.workOrderSelection.workOrderId, "index-three-folios", "eligibility must be data-driven");
assert.equal(archiveGraph.metadata.objectiveIds.purposes.length, 2, "every supplied business purpose must become its own objective");
let archive = {
  visit: syncLegacyVisitFieldsFromGraph(archiveVisit, archiveGraph),
  workOrders: archiveOrders,
  sceneConfig: archiveConfig,
};
archive = advance(
  archive,
  objectiveId(archive, "disclosure"),
  "disclose",
  evidence("archive-disclose", "disclose", "manuscript_team", "archive_entry", [], ["collection_unit"]),
);
archive = advance(
  archive,
  objectiveId(archive, "reception"),
  "receive",
  evidence("archive-receive", "receive", "collection_unit", "review_room", [], ["manuscript_team"]),
);
archive = advance(
  archive,
  purposeId(archive, 0),
  "perform",
  evidence("archive-inspect", "perform", "manuscript_team", "review_room", ["manuscript_batch"], ["collection_unit"]),
);
const archiveWorkId = objectiveId(archive, "workExchange");
archive = advance(
  archive,
  archiveWorkId,
  "offer",
  evidence("archive-offer", "offer", "collection_unit", "review_room", [], ["manuscript_team"]),
);
assert.equal(archive.visit.workExchange.agreement.status, "offered");
assert.equal(archive.visit.workExchange.agreement.acceptedByActorId, "");
assert.equal(archive.visit.workExchange.execution.status, "not_started");
archive = advance(
  archive,
  archiveWorkId,
  "refuse",
  evidence("archive-refuse", "refuse", "manuscript_team", "review_room"),
);
assert.equal(archive.visit.workExchange.agreement.status, "refused");
assert.equal(archive.visit.workStatus, "refused");
assert.notEqual(archive.visit.stage, "completed");
assert.deepEqual(archive.lastResult.workOrderPatch, { id: "index-three-folios", status: "open" });
persist(archive);

console.log("tavernCommitmentAdapter:test passed (2 data-driven visit/work-order fixtures; offer remains distinct from accept)");
