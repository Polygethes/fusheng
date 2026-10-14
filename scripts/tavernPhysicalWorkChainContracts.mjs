import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernWorldRuntimeV27, projectTavernSituationV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

const XIE = "char_xyy_xiezenshi", ZHOU = "char_xyy_zhoumin";
const BUCKET = "tavern_tool_water_bucket", VAT = "tavern_resource_water_vat", WATER = "tavern_resource_courtyard_water";
const seed = buildPlayableWorldFromSetup({ setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。", setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。" });
const instance = createTavernWorldRuntimeV27(seed, { characterIds: [XIE, ZHOU], positions: { [XIE]: "stove", [ZHOU]: "hall" } });
const world = () => instance.coordinator.worldState;
let seq = 0;
const submit = (primitive, payload, actorId = XIE) => instance.coordinator.submitActionAttempt({ attemptId: `physical-chain:${++seq}`,
  expectedWorldVersion: instance.coordinator.journal.worldVersion, actorId, primitive, payload });
function binding(operation, template) {
  const surface = projectTavernSituationV27({ worldState: world(), characterId: XIE });
  const affordance = surface.availableAffordances.find(row => row.kind === "work_operation" && row.operation === operation && row.workTemplateId === template);
  assert.ok(affordance, `${operation} ${template} is a reachable work possibility`);
  return surface.recipientPrivateBindings.affordanceBindingByHandle[affordance.id];
}
const work = (operation, template) => submit("use_affordance", { capabilityBinding: binding(operation, template), visibleAction: "AUDIT_ONLY_水和柴全部做完" });
await submit("handle", { objectId: BUCKET, operation: "take" });
const emptyPour = await work("start_work_unit", "refill_stove_water");
assert.equal(emptyPour.status, "failed", "an empty held bucket cannot start successful water work");
assert.ok(emptyPour.failedEffects.some(row => row.code === "WORK_TRANSFER_SOURCE_EMPTY"));
assert.equal(world().objects[VAT].state.fill, 0.55);
assert.equal((await submit("move", { destinationId: "counter" })).status, "success");
assert.equal((await submit("move", { destinationId: "hall" })).status, "success");
assert.equal((await submit("move", { destinationId: "courtyard" })).status, "success");
const sourceBefore = world().objects[WATER].state.availableBuckets;
assert.equal((await work("start_work_unit", "fill_water_bucket")).status, "success");
await instance.coordinator.advanceWorldProcesses({ allowTimeAdvance: true });
const drawn = await work("finish_work_unit", "fill_water_bucket");
assert.equal(drawn.status, "success");
assert.equal(world().objects[BUCKET].state.fill, 1);
assert.equal(world().objects[WATER].state.availableBuckets, sourceBefore - 1);
assert.equal((await submit("move", { destinationId: "hall" })).status, "success");
assert.equal((await submit("move", { destinationId: "counter" })).status, "success");
assert.equal((await submit("move", { destinationId: "stove" })).status, "success");
assert.equal(world().objects[BUCKET].zoneId, "stove", "water is carried with the held bucket");
assert.equal((await work("start_work_unit", "refill_stove_water")).status, "success");
await instance.coordinator.advanceWorldProcesses({ allowTimeAdvance: true });
const poured = await work("finish_work_unit", "refill_stove_water");
assert.equal(poured.status, "success");
assert.equal(world().objects[VAT].state.fill, 1);
assert.ok(Math.abs(world().objects[BUCKET].state.fill - 0.1) < 1e-9, "pouring only the missing 0.9 bucket conserves water");
assert.ok(poured.resolvedEffects.some(row => row.kind === "work_sound_emitted"));
assert.ok(!JSON.stringify(poured).includes("AUDIT_ONLY"));
assert.ok(!projectTavernSituationV27({ worldState: world(), characterId: XIE }).availableAffordances.some(row => row.workTemplateId === "refill_stove_water" && row.operation === "start_work_unit"),
  "a full vat is complete by objective water level, even when filled in fewer than two pours");

// A single place operation must not also move the separate manifest named in prose.
const parcel = "tavern_delivery_medicine_parcel", manifest = "tavern_delivery_manifest";
const placed = await submit("handle", { objectId: parcel, operation: "place", visibleAction: "药包和清单都摆好了。" }, ZHOU);
assert.equal(placed.status, "success");
assert.equal(world().objects[parcel].holderCharacterId, "");
assert.equal(world().objects[manifest].holderCharacterId, ZHOU);
assert.equal(world().objects[parcel].state.accepted, false, "placement is not recipient acceptance");
await submit("handle", { objectId: manifest, operation: "place" }, ZHOU);
assert.equal(world().objects[manifest].holderCharacterId, "");
const cup = "tavern_vessel_tea_1";
await submit("interact", { targetKind: "object", targetId: cup, visibleAction: "把茶倒满。" }, ZHOU);
assert.equal(world().objects[cup].state.contents, "empty");
const drank = await submit("handle", { objectId: cup, operation: "consume" }, ZHOU);
assert.equal(drank.status, "failed", "tea requires actual preparation and serving");
console.log("Physical work chain contracts passed: empty source refusal, water conservation, carry, audible completion, independent parcel and manifest, no invented tea.");
