import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  createTavernWorldRuntimeV27,
  projectTavernSituationV27,
} from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

const XIE = "char_xyy_xiezenshi";
const LUO = "char_xyy_luozhao";
const TEAPOT = "tavern_vessel_teapot_1";

const sourceState = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const instance = createTavernWorldRuntimeV27(sourceState, {
  characterIds: [XIE, LUO],
  positions: { [XIE]: "hall", [LUO]: "hall" },
  worldId: "world:test:v27-service-capability",
});

function projection(characterId, wake = {}) {
  return projectTavernSituationV27({
    worldState: instance.coordinator.worldState,
    worldVersion: instance.coordinator.journal.worldVersion,
    characterId,
    wake,
  });
}

async function submit(actorId, primitive, payload) {
  const version = instance.coordinator.journal.worldVersion;
  return instance.coordinator.submitActionAttempt({
    attemptId: `attempt:test:service:${version + 1}`,
    actorId,
    primitive,
    expectedWorldVersion: version,
    payload,
  });
}

const initial = projection(XIE);
const fineStart = initial.availableAffordances.find((row) => (
  row.kind === "service_operation"
  && row.operation === "start_service_preparation"
  && row.offeringId === "fine_cloud_tea_pot"
));
assert.ok(fineStart, "a qualified worker sees the objective possibility of preparing each real offering");
assert.equal(fineStart.currentlyExecutable, false, "the world exposes missing physical prerequisites instead of silently performing them");
assert.match(fineStart.id, /^perceived_affordance:/);
assert.match(fineStart.recipientEntityHandle, /^perceived_entity:/);
assert.equal(JSON.stringify(fineStart).includes(LUO), false, "the affordance does not leak an unknown customer's canonical identity");

await submit(XIE, "handle", {
  objectId: TEAPOT,
  operation: "take",
  visibleAction: "谢真石从柜后取下一只茶壶。",
});
await submit(XIE, "move", {
  destinationId: "counter",
  visibleAction: "谢真石提着茶壶绕到柜台后。",
});
await submit(XIE, "move", {
  destinationId: "stove",
  visibleAction: "谢真石提着茶壶从柜台后转到灶边。",
});
assert.equal(instance.coordinator.worldState.objects[TEAPOT].zoneId, "stove", "carried objects move with their holder");

const atStove = projection(XIE);
const executableStart = atStove.availableAffordances.find((row) => (
  row.kind === "service_operation"
  && row.operation === "start_service_preparation"
  && row.offeringId === "fine_cloud_tea_pot"
));
assert.equal(executableStart.currentlyExecutable, true);
const startBinding = atStove.recipientPrivateBindings.affordanceBindingByHandle[executableStart.id];
const fineTeaBefore = Number(instance.coordinator.worldState.places.loc_xyy_tavern.serviceCapability.stock.fineTea);
const started = await submit(XIE, "use_affordance", {
  affordanceId: startBinding.canonicalAffordanceId,
  capabilityBinding: startBinding,
  visibleAction: "谢真石取了春芽入壶，提起灶上的水。",
});
assert.equal(started.status, "success");
let process = instance.coordinator.worldState.processes[0];
assert.equal(process.status, "active");
assert.equal(process.metadata.offeringId, "fine_cloud_tea_pot");
assert.equal(process.metadata.recipientCharacterId, LUO);
assert.equal(process.metadata.serviceStatus, "preparing");
assert.equal(
  Number(instance.coordinator.worldState.places.loc_xyy_tavern.serviceCapability.stock.fineTea),
  fineTeaBefore - 1,
  "stock is reserved by a real preparation action",
);
assert.equal(instance.coordinator.worldState.objects[TEAPOT].state.contents.kind, "service_in_preparation");

const readyEvent = await instance.coordinator.advanceWorldProcesses({ allowTimeAdvance: true });
assert.ok(readyEvent);
process = instance.coordinator.worldState.processes[0];
assert.equal(process.status, "ready");
assert.ok(instance.coordinator.worldState.nowSeconds >= process.startedAtSeconds + process.durationSeconds);
const readyProjection = projection(XIE, {
  processIds: [process.id],
  evidence: readyEvent.deliveries,
});
assert.equal(readyProjection.ownedWorldProcesses[0].status, "ready");
const finish = readyProjection.availableAffordances.find((row) => row.operation === "finish_service_preparation");
assert.ok(finish);
const finishBinding = readyProjection.recipientPrivateBindings.affordanceBindingByHandle[finish.id];
const finished = await submit(XIE, "use_affordance", {
  affordanceId: finishBinding.canonicalAffordanceId,
  capabilityBinding: finishBinding,
  visibleAction: "谢真石揭盖看过茶色，把壶从火边提开。",
});
assert.equal(finished.status, "success");
process = instance.coordinator.worldState.processes[0];
assert.equal(process.status, "completed");
assert.equal(process.metadata.serviceStatus, "prepared");
assert.equal(instance.coordinator.worldState.objects[TEAPOT].state.contents.kind, "prepared_service");

await submit(XIE, "move", {
  destinationId: "counter",
  visibleAction: "谢真石端着茶壶从灶边回到柜台后。",
});
await submit(XIE, "move", {
  destinationId: "hall",
  visibleAction: "谢真石端着茶壶绕出柜台，回到堂前。",
});
const deliveryProjection = projection(XIE);
const serve = deliveryProjection.availableAffordances.find((row) => row.operation === "serve_prepared_service");
assert.ok(serve);
assert.equal(serve.currentlyExecutable, true);
const serveBinding = deliveryProjection.recipientPrivateBindings.affordanceBindingByHandle[serve.id];
const served = await submit(XIE, "use_affordance", {
  affordanceId: serveBinding.canonicalAffordanceId,
  capabilityBinding: serveBinding,
  visibleAction: "谢真石把茶壶和一只茶盏放到客人手边。",
});
assert.equal(served.status, "success");
process = instance.coordinator.worldState.processes[0];
assert.equal(process.metadata.serviceStatus, "served");
assert.equal(instance.coordinator.worldState.objects[TEAPOT].holderCharacterId, "");
assert.equal(instance.coordinator.worldState.objects[TEAPOT].zoneId, "hall");

console.log("tavernV27ServiceCapabilityContracts:test passed", {
  offering: "fine_cloud_tea_pot",
  processStages: ["active", "ready", "completed", "served"],
  actionSelectionAuthority: "character-agent",
  objectiveSettlementAuthority: "world",
});
