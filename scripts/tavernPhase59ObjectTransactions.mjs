import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  applyTavernCausalAffordance,
  listTavernCausalAffordances,
  prepareTavernCausalSlot,
  TAVERN_CAUSAL_DAY_SLOTS,
} from "../src/server/pipeline/tavernCausalEconomy.mjs";
import { normalizeObjectLedger } from "../src/server/simulation/objectLedger.mjs";

const IDS = {
  mother: "char_xyy_xiemu",
  father: "char_xyy_xieheng",
  chen: "char_xyy_chenyan",
  zhou: "char_xyy_zhoumin",
  luo: "char_xyy_luozhao",
};

const REQUIRED_SCENE_OBJECT_IDS = [
  "tavern_tool_wiping_cloth",
  "tavern_tool_water_bucket",
  "tavern_resource_water_vat",
  "tavern_tool_wood_axe",
  "tavern_resource_unprocessed_firewood",
  "tavern_room_key_guest_1",
  "tavern_room_key_guest_2",
  "tavern_room_key_guest_3",
  "tavern_delivery_medicine_parcel",
  "tavern_delivery_manifest",
];

const ZHOU_PURPOSE_IDS = [
  "deliver_medicine_to_xiemu",
  "seek_xiezenshi_sword_guidance",
  "advance_inner_court_recommendation",
];

const failures = [];
const passes = [];

function check(label, fn) {
  try {
    const value = fn();
    passes.push(label);
    return value;
  } catch (error) {
    failures.push({ label, message: error.message });
    return null;
  }
}

function newWorld() {
  return buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
}

function slot(id) {
  const row = TAVERN_CAUSAL_DAY_SLOTS.find((candidate) => candidate.id === id);
  assert.ok(row, `unknown slot ${id}`);
  return row;
}

function topology() {
  return {
    zones: {
      threshold: { id: "threshold", label: "门槛" },
      hall: { id: "hall", label: "堂前" },
      counter: { id: "counter", label: "柜台" },
      stove: { id: "stove", label: "灶边" },
      courtyard: { id: "courtyard", label: "后院" },
      stairs: { id: "stairs", label: "楼梯口" },
      guest_room: { id: "guest_room", label: "客房" },
    },
    edges: [
      { from: "threshold", to: "hall", move: 1 },
      { from: "hall", to: "counter", move: 1 },
      { from: "counter", to: "stove", move: 1 },
      { from: "hall", to: "courtyard", move: 1 },
      { from: "hall", to: "stairs", move: 1 },
      { from: "stairs", to: "guest_room", move: 1 },
    ],
  };
}

function runtimeAt(entries = {}) {
  const names = {
    [IDS.mother]: "谢母",
    [IDS.father]: "谢恒",
    [IDS.chen]: "陈砚",
    [IDS.zhou]: "周珉",
    [IDS.luo]: "洛照",
  };
  return {
    topology: topology(),
    agents: Object.fromEntries(Object.entries(entries).map(([characterId, zoneId]) => [characterId, {
      characterId,
      characterName: names[characterId] || characterId,
      present: true,
      zoneId,
    }])),
  };
}

function clone(value) {
  return structuredClone(value);
}

function ledgerOf(state) {
  return normalizeObjectLedger(state.tavernState?.objectLedger || {});
}

function replaceLedger(state, mutator) {
  const ledger = ledgerOf(state);
  mutator(ledger.objects);
  state.tavernState.objectLedger = normalizeObjectLedger({
    ...ledger,
    heldByActor: {},
    heldByCharacter: {},
  });
}

function setVisitReceived(visit, hostId) {
  visit.purposeStatus = "declared";
  visit.purposeDisclosureStatus = "declared";
  visit.declaredPurpose = visit.purpose;
  visit.hostId = hostId;
  visit.receivedBy = hostId;
  visit.stage = "received";
}

function listFor(scenario, actorId) {
  return listTavernCausalAffordances(
    scenario.state,
    scenario.runtime,
    actorId,
    Object.keys(scenario.runtime.agents).filter((id) => id !== actorId),
  ).filter((row) => row.visitId === scenario.visit.id);
}

function applySelected(scenario, actorId, selected, { speech = "", id = "" } = {}) {
  const actionId = id || `phase59_object_tx:${scenario.name}:${++scenario.sequence}:${selected.type}`;
  return applyTavernCausalAffordance(
    scenario.state,
    scenario.runtime,
    {
      id: actionId,
      actorId,
      targetCharacterId: selected.targetCharacterId,
      moveToZoneId: selected.moveToZoneId,
      speech,
      visibleAction: selected.canonicalVisibleAction,
      day: 1,
      slotLabel: "同一场",
    },
    selected,
    Object.keys(scenario.runtime.agents).filter((candidate) => candidate !== actorId),
  );
}

function take(scenario, actorId, type, speech = "") {
  const available = listFor(scenario, actorId);
  const selected = available.find((row) => row.type === type);
  assert.ok(selected, `${scenario.name}: missing ${type}; available=[${available.map((row) => row.type).join(", ")}]`);
  const actionId = `phase59_object_tx:${scenario.name}:${++scenario.sequence}:${type}`;
  const result = applySelected(scenario, actorId, selected, { speech, id: actionId });
  assert.ok(result, `${scenario.name}: ${type} was listed but rejected at apply`);
  if (selected.moveToZoneId) scenario.runtime.agents[actorId].zoneId = selected.moveToZoneId;
  return { selected, result, actionId };
}

function buildAcceptedWorkScenario(name) {
  const prepared = prepareTavernCausalSlot(newWorld(), { day: 1, slot: slot("dawn") });
  const visit = prepared.state.tavernState.activeVisits.find((row) => row.visitorId === IDS.chen);
  assert.ok(visit, `${name}: missing Chen work-exchange visit`);
  setVisitReceived(visit, IDS.mother);
  const scenario = {
    name,
    state: prepared.state,
    visit,
    runtime: runtimeAt({ [IDS.mother]: "hall", [IDS.chen]: "hall" }),
    sequence: 0,
  };
  take(scenario, IDS.mother, "assign_work", "陈砚，把说定的这项活做完，验过便给你一碗饭。");
  take(scenario, IDS.chen, "accept_work", "成，就照这项活说定的范围做。");
  const taskZoneId = visit.workExchange?.zoneId;
  assert.ok(taskZoneId, `${name}: accepted work has no task zone`);
  scenario.runtime.agents[IDS.chen].zoneId = taskZoneId;
  scenario.runtime.agents[IDS.mother].zoneId = taskZoneId;
  const perform = listFor(scenario, IDS.chen).find((row) => row.type === "perform_work");
  assert.ok(perform, `${name}: legal accepted task has no perform_work`);
  assert.ok(perform.toolIds?.length, `${name}: work order must bind a concrete tool`);
  scenario.perform = perform;
  scenario.toolId = perform.toolIds[0];
  scenario.order = scenario.state.tavernState.workOrders.find((row) => row.id === perform.taskId);
  assert.ok(scenario.order, `${name}: work order missing`);
  return scenario;
}

function assertRejectedPerformWithoutMutation(scenario, mutateLedger) {
  mutateLedger(scenario);
  const ledgerBefore = clone(ledgerOf(scenario.state));
  const unitsBefore = Number(scenario.order.completedUnits || 0);
  const revisionBefore = Number(scenario.visit.objectiveGraph?.revision || 0);
  // Listing may keep the task visible as an intention, but the authoritative
  // apply boundary must re-check the live ledger rather than trusting a stale
  // affordance compiled before the object changed.
  listFor(scenario, IDS.chen);
  const result = applySelected(scenario, IDS.chen, scenario.perform, {
    id: `phase59_object_tx:${scenario.name}:rejected_perform`,
  });
  assert.equal(result, null, "stale perform_work must also fail at the authoritative apply boundary");
  assert.deepEqual(ledgerOf(scenario.state), ledgerBefore, "failed object transaction changed the ledger");
  assert.equal(Number(scenario.order.completedUnits || 0), unitsBefore, "failed perform advanced work units");
  assert.equal(Number(scenario.visit.objectiveGraph?.revision || 0), revisionBefore, "failed perform advanced the commitment graph");
}

function buildLodgingScenario(name) {
  const prepared = prepareTavernCausalSlot(newWorld(), { day: 1, slot: slot("afternoon") });
  const visit = prepared.state.tavernState.activeVisits.find((row) => row.visitorId === IDS.luo);
  assert.ok(visit, `${name}: missing Luo lodging visit`);
  // Luo Zhao's canonical runtime visit is now self-directed. This fixture is
  // deliberately testing the generic lodging transaction, so construct that
  // situation explicitly instead of mutating whichever purpose her profile
  // happens to generate today.
  Object.assign(visit, {
    purpose: "住一晚等接引，并在堂前吃一顿热饭",
    kind: "lodging",
    selfDirected: false,
    purposeDisclosureRequired: true,
    hostReceptionRequired: true,
    expectedHostIds: [IDS.mother],
    requestedService: "lodging_meal",
    paymentMode: "cash",
    serviceStatus: "pending",
    serviceConsumptionStatus: "not_served",
    lodgingStatus: "pending",
    deliveryStatus: "not_required",
    workStatus: "not_required",
    paymentStatus: "unpaid",
    purposes: [],
    personalOpenLoops: [],
  });
  delete visit.objectiveGraph;
  delete visit.commitmentGraph;
  setVisitReceived(visit, IDS.mother);
  return {
    name,
    state: prepared.state,
    visit,
    runtime: runtimeAt({ [IDS.mother]: "hall", [IDS.luo]: "hall" }),
    sequence: 0,
  };
}

function markVisitReadyToDepart(visit) {
  for (const objective of visit.objectiveGraph?.objectives || []) objective.status = "completed";
  visit.serviceStatus = "served";
  visit.serviceConsumptionStatus = "consumed";
  visit.paymentStatus = "paid";
  visit.stage = "completed";
  visit.departureDue = true;
}

function buildDeliveryScenario(name) {
  const prepared = prepareTavernCausalSlot(newWorld(), { day: 1, slot: slot("noon") });
  const visit = prepared.state.tavernState.activeVisits.find((row) => row.visitorId === IDS.zhou);
  assert.ok(visit, `${name}: missing Zhou delivery visit`);
  setVisitReceived(visit, IDS.mother);
  return {
    name,
    state: prepared.state,
    visit,
    runtime: runtimeAt({ [IDS.mother]: "hall", [IDS.zhou]: "hall" }),
    sequence: 0,
  };
}

check("new world seeds every work tool/resource, room key, medicine parcel, and manifest", () => {
  const state = newWorld();
  const ledger = ledgerOf(state);
  for (const objectId of REQUIRED_SCENE_OBJECT_IDS) {
    const object = ledger.objects[objectId];
    assert.ok(object, `missing seeded object ${objectId}`);
    assert.equal(object.sceneId, "loc_xyy_tavern", `${objectId} is not bound to the tavern scene`);
    assert.ok(object.zoneId, `${objectId} has no physical zone`);
  }
  const medicineParcel = ledger.objects.tavern_delivery_medicine_parcel;
  assert.equal(medicineParcel.holderActorId, IDS.zhou);
  assert.equal(ledger.objects.tavern_delivery_manifest.holderActorId, IDS.zhou);
  assert.equal(medicineParcel.state?.intendedRecipientActorId, IDS.mother, "medicine parcel lost its intended recipient");
  assert.equal(medicineParcel.state?.treatmentTargetActorId, IDS.mother, "delivery holder was confused with the patient");
  assert.equal(medicineParcel.state?.treatmentCategory, "chronic_lung_ailment", "confirmed chronic lung purpose is missing");
  assert.equal(medicineParcel.state?.treatmentDetailsStatus, "unknown", "unknown diagnosis or prescription must not be invented");
});

check("Zhou's delivery, guidance request, and recommendation path stay independently trackable", () => {
  const scenario = buildDeliveryScenario("zhou-independent-purposes");
  const purposeRows = (scenario.visit.objectiveGraph?.objectives || [])
    .filter((objective) => objective.metadata?.adapterRole === "business-purpose");
  assert.deepEqual(
    purposeRows.map((objective) => objective.metadata?.sourcePurposeId),
    ZHOU_PURPOSE_IDS,
    "one visit purpose was merged into or lost behind another",
  );
  assert.deepEqual(
    scenario.visit.personalOpenLoops.map((loop) => loop.sourceId),
    ZHOU_PURPOSE_IDS.slice(1),
    "each personal purpose must retain its own unresolved state",
  );
});

check("perform_work rejects a missing tool without changing ledger or work progress", () => {
  const scenario = buildAcceptedWorkScenario("missing-tool");
  assertRejectedPerformWithoutMutation(scenario, () => {
    replaceLedger(scenario.state, (objects) => { delete objects[scenario.toolId]; });
  });
});

check("perform_work rejects a tool in another zone", () => {
  const scenario = buildAcceptedWorkScenario("remote-tool");
  assertRejectedPerformWithoutMutation(scenario, () => {
    replaceLedger(scenario.state, (objects) => {
      objects[scenario.toolId].holderActorId = "";
      objects[scenario.toolId].zoneId = scenario.runtime.agents[IDS.chen].zoneId === "courtyard" ? "hall" : "courtyard";
    });
  });
});

check("perform_work rejects a tool held by another person", () => {
  const scenario = buildAcceptedWorkScenario("borrowed-tool");
  assertRejectedPerformWithoutMutation(scenario, () => {
    replaceLedger(scenario.state, (objects) => {
      objects[scenario.toolId].holderActorId = IDS.mother;
      objects[scenario.toolId].zoneId = scenario.runtime.agents[IDS.mother].zoneId;
    });
  });
});

check("legal work picks up its tool, records concrete use evidence, and returns it on submit", () => {
  const scenario = buildAcceptedWorkScenario("legal-work");
  const origin = clone(ledgerOf(scenario.state).objects[scenario.toolId]);
  assert.ok(origin, "task tool is not in the ledger");
  assert.equal(origin.holderActorId, "", "legal fixture expects a scene tool awaiting pickup");
  assert.equal(origin.zoneId, scenario.runtime.agents[IDS.chen].zoneId, "task tool is not in the work zone");

  const requiredUnits = Number(scenario.visit.workExchange?.execution?.requiredUnits || 1);
  let firstExecution = null;
  for (let index = 0; index < requiredUnits; index += 1) {
    const execution = take(scenario, IDS.chen, "perform_work");
    if (!firstExecution) firstExecution = execution;
    const tool = ledgerOf(scenario.state).objects[scenario.toolId];
    assert.equal(tool.holderActorId, IDS.chen, `tool was not held by worker after unit ${index + 1}`);
    assert.equal(tool.state?.lastUsedActionId, execution.actionId, `unit ${index + 1} did not write tool-use evidence`);
    const graphEvidence = scenario.visit.objectiveGraph?.evidence?.find((row) => row.id === execution.actionId);
    assert.ok(graphEvidence?.objectIds?.includes(scenario.toolId), `unit ${index + 1} graph evidence omitted its tool`);
  }
  assert.ok(firstExecution.result.objectOperations?.some((row) => row.type === "pickup" && row.objectId === scenario.toolId));

  const submission = take(
    scenario,
    IDS.chen,
    "submit_work",
    "活已经照说定的数量做完了，请按原来的标准验看。",
  );
  assert.ok(submission.result.objectOperations?.some((row) => row.type === "place" && row.objectId === scenario.toolId));
  const returnedTool = ledgerOf(scenario.state).objects[scenario.toolId];
  assert.equal(returnedTool.holderActorId, "", "submitted work left the shared tool in the worker's possession");
  assert.equal(returnedTool.sceneId, origin.sceneId);
  assert.equal(returnedTool.zoneId, origin.zoneId, "submitted work did not return the tool to its physical home zone");
});

check("assign_lodging atomically transfers the real room key from host handling to guest", () => {
  const scenario = buildLodgingScenario("lodging-transfer");
  const keyId = "tavern_room_key_guest_1";
  const selected = listFor(scenario, IDS.mother).find((row) => row.type === "assign_lodging");
  assert.ok(selected, "assign_lodging unavailable");
  assert.deepEqual(selected.objectIds, [keyId]);
  const result = applySelected(scenario, IDS.mother, selected, { id: "phase59_object_tx:lodging:assign" });
  assert.ok(result, "assign_lodging failed with a valid co-located key");
  assert.ok(result.objectOperations?.some((row) => row.actorId === IDS.mother && row.objectId === keyId));
  assert.ok(result.objectOperations?.some((row) => (
    row.type === "transfer" && row.objectId === keyId && row.actorId === IDS.mother && row.toHolderActorId === IDS.luo
  )));
  const key = ledgerOf(scenario.state).objects[keyId];
  assert.equal(key.holderActorId, IDS.luo);
  assert.equal(key.zoneId, "hall");
  assert.equal(scenario.visit.keyDelivered, true);
});

check("a lodging guest must physically return the assigned key before departure", () => {
  const scenario = buildLodgingScenario("lodging-key-return");
  const assignment = take(scenario, IDS.mother, "assign_lodging");
  const keyId = assignment.selected.objectIds[0];
  markVisitReadyToDepart(scenario.visit);

  const beforeReturn = listFor(scenario, IDS.luo);
  assert.equal(beforeReturn.some((row) => row.type === "leave_visit"), false, "guest could leave while still holding the room key");
  const returnAffordance = beforeReturn.find((row) => row.type === "return_lodging_key");
  assert.ok(returnAffordance, "completed lodging visit did not require the key to be returned");
  assert.equal(returnAffordance.returnMode, "operator");

  const returned = applySelected(scenario, IDS.luo, returnAffordance, { id: "phase59_object_tx:lodging:return-to-operator" });
  assert.ok(returned, "physical key return was rejected");
  const keyAfterReturn = ledgerOf(scenario.state).objects[keyId];
  assert.equal(keyAfterReturn.holderActorId, IDS.mother, "returned key did not reach the co-located operator");
  assert.equal(keyAfterReturn.state?.assignedVisitId, "", "returned key remained reserved by the departed visit");
  assert.equal(keyAfterReturn.state?.assignedActorId, "", "returned key remained assigned to the guest");
  assert.equal(keyAfterReturn.state?.returnedVisitId, scenario.visit.id);
  assert.equal(scenario.visit.keyReturnStatus, "returned");

  const afterReturn = listFor(scenario, IDS.luo);
  assert.ok(afterReturn.some((row) => row.type === "leave_visit"), "departure did not unlock after the ledger recorded the return");
  take(scenario, IDS.luo, "leave_visit");
  assert.equal(scenario.state.tavernState.activeVisits.some((visit) => visit.id === scenario.visit.id), false);
  assert.equal(ledgerOf(scenario.state).objects[keyId].holderActorId, IDS.mother, "departure made the returned key disappear or move back by magic");
});

check("multiple lodging visits reserve different physical rooms instead of sharing one fixed key", () => {
  const scenario = buildLodgingScenario("multi-lodging");
  const first = take(scenario, IDS.mother, "assign_lodging");
  assert.deepEqual(first.selected.objectIds, ["tavern_room_key_guest_1"]);

  const secondGuestId = "agent_second_lodging_guest";
  const firstGuest = scenario.state.characters.find((character) => character.id === IDS.luo);
  scenario.state.characters.push({
    ...clone(firstGuest),
    id: secondGuestId,
    name: "季遥",
    lifeState: { ...clone(firstGuest.lifeState || {}), present: true, activeVisitId: "visit_second_lodging" },
  });
  scenario.runtime.agents[secondGuestId] = {
    characterId: secondGuestId,
    characterName: "季遥",
    present: true,
    zoneId: "hall",
  };
  const secondVisit = {
    ...clone(scenario.visit),
    id: "visit_second_lodging",
    visitorId: secondGuestId,
    visitorName: "季遥",
    lodgingStatus: "pending",
    keyDelivered: false,
    roomId: "",
    lodgingKeyObjectIds: [],
    stage: "received",
  };
  delete secondVisit.objectiveGraph;
  delete secondVisit.commitmentGraph;
  scenario.state.tavernState.activeVisits.push(secondVisit);
  const available = listTavernCausalAffordances(
    scenario.state,
    scenario.runtime,
    IDS.mother,
    [IDS.luo, secondGuestId],
  );
  const second = available.find((row) => row.visitId === secondVisit.id && row.type === "assign_lodging");
  assert.ok(second, "second lodging visit has no remaining physical room key");
  assert.deepEqual(second.objectIds, ["tavern_room_key_guest_2"]);
  const applied = applyTavernCausalAffordance(
    scenario.state,
    scenario.runtime,
    {
      id: "phase59_object_tx:multi-lodging:second",
      actorId: IDS.mother,
      targetCharacterId: secondGuestId,
      speech: "",
      visibleAction: second.canonicalVisibleAction,
      day: 1,
      slotLabel: "同一场",
    },
    second,
    [IDS.luo, secondGuestId],
  );
  assert.ok(applied);
  assert.equal(ledgerOf(scenario.state).objects.tavern_room_key_guest_2.holderActorId, secondGuestId);
  assert.equal(secondVisit.roomId, "guest_room_2");

  markVisitReadyToDepart(secondVisit);
  scenario.runtime.agents[IDS.mother].zoneId = "counter";
  const secondGuestDepartureActions = listTavernCausalAffordances(
    scenario.state,
    scenario.runtime,
    secondGuestId,
    [IDS.mother, IDS.luo],
  ).filter((row) => row.visitId === secondVisit.id);
  assert.equal(secondGuestDepartureActions.some((row) => row.type === "leave_visit"), false);
  const poolReturn = secondGuestDepartureActions.find((row) => row.type === "return_lodging_key");
  assert.ok(poolReturn, "second guest could not return the key to its physical pool");
  assert.equal(poolReturn.returnMode, "pool");
  const poolReturnResult = applyTavernCausalAffordance(
    scenario.state,
    scenario.runtime,
    {
      id: "phase59_object_tx:multi-lodging:return-second-key",
      actorId: secondGuestId,
      targetCharacterId: "",
      speech: "",
      visibleAction: poolReturn.canonicalVisibleAction,
      day: 2,
      slotLabel: "清晨",
    },
    poolReturn,
    [IDS.mother, IDS.luo],
  );
  assert.ok(poolReturnResult);
  const ledgerAfterPoolReturn = ledgerOf(scenario.state);
  assert.equal(ledgerAfterPoolReturn.objects.tavern_room_key_guest_1.holderActorId, IDS.luo, "returning room two's key disturbed room one's occupancy");
  assert.equal(ledgerAfterPoolReturn.objects.tavern_room_key_guest_2.holderActorId, "");
  assert.equal(ledgerAfterPoolReturn.objects.tavern_room_key_guest_2.zoneId, "hall");
  assert.equal(ledgerAfterPoolReturn.objects.tavern_room_key_guest_2.state?.assignedVisitId, "");

  const thirdGuestId = "agent_third_lodging_guest";
  scenario.state.characters.push({
    ...clone(firstGuest),
    id: thirdGuestId,
    name: "闻秋",
    lifeState: { ...clone(firstGuest.lifeState || {}), present: true, activeVisitId: "visit_third_lodging" },
  });
  scenario.runtime.agents[thirdGuestId] = {
    characterId: thirdGuestId,
    characterName: "闻秋",
    present: true,
    zoneId: "hall",
  };
  scenario.runtime.agents[IDS.mother].zoneId = "hall";
  const thirdVisit = {
    ...clone(scenario.visit),
    id: "visit_third_lodging",
    visitorId: thirdGuestId,
    visitorName: "闻秋",
    lodgingStatus: "pending",
    keyDelivered: false,
    keyReturnStatus: "",
    keyReturnedByActionId: "",
    keyReturnedToActorId: "",
    roomId: "",
    lodgingKeyObjectIds: [],
    lodgingKeyReturnZoneId: "",
    serviceStatus: "pending",
    serviceConsumptionStatus: "not_served",
    paymentStatus: "unpaid",
    departureDue: false,
    stage: "received",
  };
  delete thirdVisit.objectiveGraph;
  delete thirdVisit.commitmentGraph;
  scenario.state.tavernState.activeVisits.push(thirdVisit);
  const thirdAssignment = listTavernCausalAffordances(
    scenario.state,
    scenario.runtime,
    IDS.mother,
    [IDS.luo, secondGuestId, thirdGuestId],
  ).find((row) => row.visitId === thirdVisit.id && row.type === "assign_lodging");
  assert.ok(thirdAssignment, "a physically returned key was not reusable for a later guest");
  assert.deepEqual(thirdAssignment.objectIds, ["tavern_room_key_guest_2"], "occupied room one was reused instead of returned room two");
  const thirdApplied = applyTavernCausalAffordance(
    scenario.state,
    scenario.runtime,
    {
      id: "phase59_object_tx:multi-lodging:third",
      actorId: IDS.mother,
      targetCharacterId: thirdGuestId,
      speech: "",
      visibleAction: thirdAssignment.canonicalVisibleAction,
      day: 2,
      slotLabel: "清晨",
    },
    thirdAssignment,
    [IDS.luo, secondGuestId, thirdGuestId],
  );
  assert.ok(thirdApplied);
  assert.equal(ledgerOf(scenario.state).objects.tavern_room_key_guest_2.holderActorId, thirdGuestId);
  assert.equal(thirdVisit.roomId, "guest_room_2");
});

check("accept_delivery atomically transfers parcel and manifest from visitor to host", () => {
  const scenario = buildDeliveryScenario("delivery-transfer");
  const objectIds = ["tavern_delivery_medicine_parcel", "tavern_delivery_manifest"];
  assert.deepEqual(scenario.visit.carriedObjectIds, objectIds);
  const selected = listFor(scenario, IDS.mother).find((row) => row.type === "accept_delivery");
  assert.ok(selected, "accept_delivery unavailable");
  assert.deepEqual(selected.objectIds, objectIds);
  const result = applySelected(scenario, IDS.mother, selected, { id: "phase59_object_tx:delivery:accept" });
  assert.ok(result, "accept_delivery failed with both carried objects present");
  for (const objectId of objectIds) {
    assert.ok(result.objectOperations?.some((row) => (
      row.type === "transfer" && row.objectId === objectId && row.actorId === IDS.zhou && row.toHolderActorId === IDS.mother
    )));
    assert.equal(ledgerOf(scenario.state).objects[objectId].holderActorId, IDS.mother);
  }
  const transferredParcel = ledgerOf(scenario.state).objects.tavern_delivery_medicine_parcel;
  assert.equal(transferredParcel.state?.intendedRecipientActorId, IDS.mother);
  assert.equal(transferredParcel.state?.treatmentTargetActorId, IDS.mother);
  assert.equal(transferredParcel.state?.treatmentCategory, "chronic_lung_ailment");
  assert.equal(scenario.visit.deliveryStatus, "accepted");
});

check("a failed multi-object delivery transaction is all-or-nothing", () => {
  const scenario = buildDeliveryScenario("delivery-atomic-failure");
  const selected = listFor(scenario, IDS.mother).find((row) => row.type === "accept_delivery");
  assert.ok(selected, "valid delivery affordance missing before corruption");
  replaceLedger(scenario.state, (objects) => {
    objects.tavern_delivery_manifest.holderActorId = IDS.father;
  });
  const before = clone(ledgerOf(scenario.state));
  const result = applySelected(scenario, IDS.mother, selected, { id: "phase59_object_tx:delivery:reject" });
  assert.equal(result, null, "delivery succeeded although one required object was not carried by the visitor");
  assert.deepEqual(ledgerOf(scenario.state), before, "failed delivery partially transferred one of its objects");
  assert.equal(scenario.visit.deliveryStatus, "pending", "failed delivery advanced visit state");
});

if (failures.length) {
  console.error("tavernPhase59ObjectTransactions:test RED", {
    passed: passes.length,
    failures,
  });
  process.exitCode = 1;
} else {
  console.log("tavernPhase59ObjectTransactions:test passed", {
    passed: passes.length,
    contracts: passes,
  });
}
