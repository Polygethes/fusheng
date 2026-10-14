import assert from "node:assert/strict";
import {
  applyCommitmentTransition,
  getActionableObjectives,
  getPendingObligations,
  normalizeCommitmentGraph,
  rankCommitmentPriorities,
} from "../src/server/simulation/commitmentGraph.mjs";

function action(id, actionType, actorId, zoneId, objectIds = [], targetActorIds = []) {
  return { id, actionType, actorId, zoneId, objectIds, targetActorIds };
}

function advance(graph, objectiveId, transition, evidence) {
  const result = applyCommitmentTransition(graph, { objectiveId, transition, evidence });
  assert.equal(result.ok, true, `${objectiveId}:${transition} should succeed: ${JSON.stringify(result.violations)}`);
  return result.graph;
}

function reject(graph, objectiveId, transition, evidence, code) {
  const result = applyCommitmentTransition(graph, { objectiveId, transition, evidence });
  assert.equal(result.ok, false, `${objectiveId}:${transition} should be rejected`);
  assert.ok(result.violations.some((violation) => violation.code === code), `${code} missing from ${JSON.stringify(result.violations)}`);
  assert.deepEqual(result.graph, normalizeCommitmentGraph(graph), "a rejected transition must not mutate the graph");
  return result;
}

function assertRoundTrip(graph) {
  const serialized = JSON.stringify(graph);
  const restored = JSON.parse(serialized);
  assert.deepEqual(normalizeCommitmentGraph(restored), graph, "normalized graph must survive JSON persistence");
  assert.deepEqual(normalizeCommitmentGraph(graph), graph, "normalization must be idempotent");
}

const stationSeed = {
  id: "polar-station-commitments",
  metadata: { fixture: "remote-research-station" },
  objectives: [
    {
      id: "restore-relay-array",
      kind: "work_exchange",
      label: "restore the relay array in exchange for a reserved power cell",
      required: true,
      priority: 84,
      urgency: 72,
      responsibleActorIds: ["operations_unit"],
      targetActorIds: ["field_technician"],
      location: {
        allowedZoneIds: ["operations_hub", "relay_field", "supply_lock"],
        interactionZoneIds: ["operations_hub"],
        executionZoneIds: ["relay_field"],
        verificationZoneIds: ["relay_field"],
      },
      objectIds: ["relay_array", "diagnostic_case"],
      disclosure: { mode: "restricted", requiredBeforeAction: true },
      task: {
        offerToActorIds: ["field_technician"],
        executorActorIds: ["field_technician"],
        verifierActorIds: ["quality_unit"],
        compensation: {
          kind: "reserved_supply",
          actorIds: ["logistics_unit"],
          beneficiaryActorIds: ["field_technician"],
          zoneIds: ["supply_lock"],
          objectIds: ["power_cell"],
        },
        preconditions: {
          offer: {
            actorIds: ["operations_unit"],
            zoneIds: ["operations_hub"],
            objectIds: ["work_order"],
            targetActorIds: ["field_technician"],
          },
        },
      },
    },
    {
      id: "release-forecast-packet",
      kind: "objective",
      label: "release the corrected forecast packet",
      priority: 58,
      responsibleActorIds: ["science_unit"],
      targetActorIds: ["regional_network"],
      location: { allowedZoneIds: ["analysis_room"] },
      objectIds: ["forecast_packet"],
      dependsOn: ["restore-relay-array"],
      disclosure: { mode: "public" },
    },
  ],
};

let station = normalizeCommitmentGraph(stationSeed);
assertRoundTrip(station);
assert.equal(station.objectives.length, 2, "multi-objective graph must preserve both objectives");
assert.deepEqual(station.objectives[0].responsibleActorIds, ["operations_unit"]);
assert.deepEqual(station.objectives[0].targetActorIds, ["field_technician"]);
assert.deepEqual(station.objectives[1].dependsOn, ["restore-relay-array"]);

const blockedRelease = getPendingObligations(station).find((row) => row.objectiveId === "release-forecast-packet");
assert.equal(blockedRelease?.actionable, false, "dependent objective must remain blocked");
assert.deepEqual(blockedRelease?.blockedByObjectiveIds, ["restore-relay-array"]);
assert.equal(
  getActionableObjectives(station, {
    actorId: "science_unit",
    zoneId: "analysis_room",
    objectIds: ["forecast_packet"],
  }).some((row) => row.objectiveId === "release-forecast-packet"),
  false,
);

reject(station, "restore-relay-array", "offer", {}, "ACTION_EVIDENCE_REQUIRED");
reject(
  station,
  "restore-relay-array",
  "offer",
  action("station-offer-wrong-zone", "offer", "operations_unit", "relay_field", ["work_order"], ["field_technician"]),
  "ZONE_PRECONDITION_FAILED",
);
reject(
  station,
  "restore-relay-array",
  "offer",
  action("station-offer-missing-order", "offer", "operations_unit", "operations_hub", [], ["field_technician"]),
  "OBJECT_PRECONDITION_FAILED",
);

station = advance(
  station,
  "restore-relay-array",
  "offer",
  action("station-offer", "offer", "operations_unit", "operations_hub", ["work_order"], ["field_technician"]),
);
const offeredStationTask = station.objectives.find((row) => row.id === "restore-relay-array");
assert.equal(offeredStationTask.task.stage, "offered");
assert.equal(offeredStationTask.disclosure.status, "disclosed");
assert.deepEqual(offeredStationTask.disclosure.disclosedToActorIds, ["field_technician"]);

const responseRows = rankCommitmentPriorities(station, { actorId: "field_technician" });
assert.deepEqual(responseRows.map((row) => row.transition).sort(), ["accept", "refuse"]);
assert.ok(responseRows.every((row) => row.obligationType === "response" && row.responsePriority > 0));
assert.deepEqual(
  getActionableObjectives(station, {
    actorId: "field_technician",
    zoneId: "operations_hub",
    objectIds: [],
  })[0]?.nextTransitions.sort(),
  ["accept", "refuse"],
);

reject(
  station,
  "restore-relay-array",
  "accept",
  action("station-accept-wrong-actor", "accept", "quality_unit", "operations_hub"),
  "ACTOR_NOT_ELIGIBLE",
);
station = advance(
  station,
  "restore-relay-array",
  "accept",
  action("station-accept", "accept", "field_technician", "operations_hub"),
);

reject(
  station,
  "restore-relay-array",
  "execute",
  action("station-execute-wrong-zone", "execute", "field_technician", "operations_hub", ["relay_array", "diagnostic_case"]),
  "ZONE_PRECONDITION_FAILED",
);
reject(
  station,
  "restore-relay-array",
  "execute",
  action("station-execute-missing-tool", "execute", "field_technician", "relay_field", ["relay_array"]),
  "OBJECT_PRECONDITION_FAILED",
);
station = advance(
  station,
  "restore-relay-array",
  "execute",
  action("station-execute-1", "execute", "field_technician", "relay_field", ["relay_array", "diagnostic_case"]),
);
station = advance(
  station,
  "restore-relay-array",
  "submit",
  action("station-submit-1", "submit", "field_technician", "relay_field", ["relay_array", "diagnostic_case"]),
);
station = advance(
  station,
  "restore-relay-array",
  "rework",
  action("station-rework", "rework", "quality_unit", "relay_field", ["relay_array", "diagnostic_case"]),
);
assert.equal(station.objectives[0].task.currentCycle, 1);
assert.deepEqual(station.objectives[0].task.currentCycleEvidenceIds, []);
reject(
  station,
  "restore-relay-array",
  "execute",
  action("station-execute-1", "execute", "field_technician", "relay_field", ["relay_array", "diagnostic_case"]),
  "ACTION_EVIDENCE_ALREADY_USED",
);
station = advance(
  station,
  "restore-relay-array",
  "execute",
  action("station-execute-2", "execute", "field_technician", "relay_field", ["relay_array", "diagnostic_case"]),
);
station = advance(
  station,
  "restore-relay-array",
  "submit",
  action("station-submit-2", "submit", "field_technician", "relay_field", ["relay_array", "diagnostic_case"]),
);
station = advance(
  station,
  "restore-relay-array",
  "verify",
  action("station-verify", "verify", "quality_unit", "relay_field", ["relay_array", "diagnostic_case"]),
);
reject(
  station,
  "restore-relay-array",
  "compensate",
  action("station-compensate-missing-item", "compensate", "logistics_unit", "supply_lock", [], ["field_technician"]),
  "OBJECT_PRECONDITION_FAILED",
);
station = advance(
  station,
  "restore-relay-array",
  "compensate",
  action("station-compensate", "compensate", "logistics_unit", "supply_lock", ["power_cell"], ["field_technician"]),
);
assert.equal(station.objectives[0].status, "completed");
assert.equal(station.objectives[0].task.stage, "compensated");
assert.equal(station.objectives[0].task.compensation.status, "delivered");

const releaseActionable = getActionableObjectives(station, {
  actorId: "science_unit",
  zoneId: "analysis_room",
  objectIds: ["forecast_packet"],
});
assert.deepEqual(releaseActionable.map((row) => row.objectiveId), ["release-forecast-packet"]);
station = advance(
  station,
  "release-forecast-packet",
  "complete",
  action("station-release", "complete", "science_unit", "analysis_room", ["forecast_packet"], ["regional_network"]),
);
assert.equal(station.objectives[1].status, "completed");
assertRoundTrip(station);

const archiveSeed = {
  id: "media-archive-commitments",
  metadata: { fixture: "collection-digitization" },
  objectives: [
    {
      id: "digitize-map-plates",
      kind: "task",
      label: "digitize a map-plate collection in exchange for a research credential",
      priority: 76,
      urgency: 44,
      responsibleActorIds: ["archive_coordinator"],
      targetActorIds: ["contractor_alpha", "contractor_beta"],
      location: {
        allowedZoneIds: ["planning_room", "scanner_lab", "credential_office"],
        interactionZoneIds: ["planning_room"],
        executionZoneIds: ["scanner_lab"],
        verificationZoneIds: ["scanner_lab"],
      },
      objectIds: ["plate_collection", "scanner_console"],
      disclosure: { mode: "restricted" },
      task: {
        offerToActorIds: ["contractor_alpha", "contractor_beta"],
        executorActorIds: ["contractor_alpha", "contractor_beta"],
        verifierActorIds: ["catalogue_unit"],
        compensation: {
          kind: "credential",
          actorIds: ["credential_unit"],
          beneficiaryActorIds: ["contractor_alpha", "contractor_beta"],
          zoneIds: ["credential_office"],
          objectIds: ["research_credential"],
        },
      },
    },
    {
      id: "clear-publication-rights",
      kind: "objective",
      label: "clear publication rights for the new index",
      required: true,
      priority: 68,
      responsibleActorIds: ["rights_unit"],
      targetActorIds: ["rights_holder_unit"],
      location: { allowedZoneIds: ["rights_room"], interactionZoneIds: ["rights_room"] },
      objectIds: ["license_record"],
      dependsOn: ["digitize-map-plates"],
      disclosure: { mode: "restricted", requiredBeforeAction: true },
    },
  ],
};

let archive = normalizeCommitmentGraph(archiveSeed);
assertRoundTrip(archive);
archive = advance(
  archive,
  "digitize-map-plates",
  "offer",
  action("archive-offer", "offer", "archive_coordinator", "planning_room", [], ["contractor_beta"]),
);
assert.deepEqual(archive.objectives[0].task.offeredToActorIds, ["contractor_beta"], "one target from a multi-target objective may receive the offer");
reject(
  archive,
  "digitize-map-plates",
  "accept",
  action("archive-accept-unoffered", "accept", "contractor_alpha", "planning_room"),
  "ACTOR_NOT_ELIGIBLE",
);
archive = advance(
  archive,
  "digitize-map-plates",
  "accept",
  action("archive-accept", "accept", "contractor_beta", "planning_room"),
);
archive = advance(
  archive,
  "digitize-map-plates",
  "execute",
  action("archive-execute", "execute", "contractor_beta", "scanner_lab", ["plate_collection", "scanner_console"]),
);
archive = advance(
  archive,
  "digitize-map-plates",
  "submit",
  action("archive-submit", "submit", "contractor_beta", "scanner_lab", ["plate_collection", "scanner_console"]),
);
archive = advance(
  archive,
  "digitize-map-plates",
  "verify",
  action("archive-verify", "verify", "catalogue_unit", "scanner_lab", ["plate_collection", "scanner_console"]),
);
archive = advance(
  archive,
  "digitize-map-plates",
  "compensate",
  action("archive-compensate", "compensate", "credential_unit", "credential_office", ["research_credential"], ["contractor_beta"]),
);

const rightsBeforeDisclosure = getActionableObjectives(archive, {
  actorId: "rights_unit",
  zoneId: "rights_room",
  objectIds: ["license_record"],
});
assert.deepEqual(rightsBeforeDisclosure[0]?.nextTransitions, ["disclose"], "required disclosure must precede fulfillment");
reject(
  archive,
  "clear-publication-rights",
  "disclose",
  action("rights-disclose-no-recipient", "disclose", "rights_unit", "rights_room"),
  "DISCLOSURE_RECIPIENT_REQUIRED",
);
archive = advance(
  archive,
  "clear-publication-rights",
  "disclose",
  action("rights-disclose", "disclose", "rights_unit", "rights_room", [], ["rights_holder_unit"]),
);
archive = advance(
  archive,
  "clear-publication-rights",
  "complete",
  action("rights-complete", "complete", "rights_unit", "rights_room", ["license_record"], ["rights_holder_unit"]),
);
assert.ok(archive.objectives.every((objective) => objective.status === "completed"));
assert.equal(getPendingObligations(archive).length, 0);
assertRoundTrip(archive);

const rescueSeed = {
  id: "flood-rescue-commitments",
  metadata: { fixture: "municipal-rescue-duty" },
  objectives: [
    {
      id: "evacuate-pump-room",
      kind: "task",
      label: "evacuate an injured technician from the flooded pump room",
      required: true,
      priority: 96,
      urgency: 100,
      responsibleActorIds: ["rescue_coordinator"],
      targetActorIds: ["rescue_swimmer"],
      location: {
        allowedZoneIds: ["incident_post", "pump_room", "triage_zone"],
        interactionZoneIds: ["incident_post"],
        executionZoneIds: ["pump_room"],
        verificationZoneIds: ["triage_zone"],
      },
      objectIds: ["rescue_sling"],
      disclosure: { mode: "restricted" },
      task: {
        offerToActorIds: ["rescue_swimmer"],
        executorActorIds: ["rescue_swimmer"],
        verifierActorIds: ["triage_lead"],
        compensation: {
          kind: "public_duty",
          required: false,
        },
        preconditions: {
          verify: {
            actorIds: ["triage_lead"],
            zoneIds: ["triage_zone"],
            objectIds: ["rescue_sling"],
          },
        },
      },
    },
  ],
};

let rescue = normalizeCommitmentGraph(rescueSeed);
assert.equal(rescue.objectives[0].task.compensation.required, false);
assert.equal(rescue.objectives[0].task.compensation.status, "not_required");
assertRoundTrip(rescue);
rescue = advance(
  rescue,
  "evacuate-pump-room",
  "offer",
  action("rescue-offer", "offer", "rescue_coordinator", "incident_post", [], ["rescue_swimmer"]),
);
rescue = advance(
  rescue,
  "evacuate-pump-room",
  "accept",
  action("rescue-accept", "accept", "rescue_swimmer", "incident_post"),
);
rescue = advance(
  rescue,
  "evacuate-pump-room",
  "execute",
  action("rescue-execute", "execute", "rescue_swimmer", "pump_room", ["rescue_sling"]),
);
rescue = advance(
  rescue,
  "evacuate-pump-room",
  "submit",
  action("rescue-submit", "submit", "rescue_swimmer", "pump_room", ["rescue_sling"]),
);
rescue = advance(
  rescue,
  "evacuate-pump-room",
  "verify",
  action("rescue-verify", "verify", "triage_lead", "triage_zone", ["rescue_sling"]),
);
assert.equal(rescue.objectives[0].task.stage, "verified", "verification remains the terminal material stage");
assert.equal(rescue.objectives[0].status, "completed", "a non-compensated duty must complete on verification");
assert.equal(rescue.objectives[0].task.compensation.status, "not_required");
assert.equal(getPendingObligations(rescue).length, 0, "no fictional payment obligation may remain after a duty is verified");
assert.equal(getActionableObjectives(rescue, { actorId: "rescue_coordinator" }).length, 0);
reject(
  rescue,
  "evacuate-pump-room",
  "compensate",
  action("rescue-fictional-payment", "compensate", "rescue_coordinator", "incident_post", [], ["rescue_swimmer"]),
  "TRANSITION_NOT_ALLOWED",
);
assertRoundTrip(rescue);

console.log("commitmentGraphGeneralization:test passed (3 unrelated fixtures, conditional compensation, evidence-gated task lifecycle, persistence, idempotence)");
