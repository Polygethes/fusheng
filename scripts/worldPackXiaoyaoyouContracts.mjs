import assert from "node:assert/strict";
import xiaoyaoyou from "../src/worlds/xiaoyaoyou/pack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { xiaoyaoyouSeed } from "./captureWorldStateGolden.mjs";
import { tavernOpeningAgenda, TAVERN_SCENE_CHARACTER_IDS } from "../src/server/pipeline/tavernSceneConfiguration.mjs";
import { XIAOYA_YOU_TAVERN_INSTITUTION } from "../src/worldbuilding/skills.js";

const withoutClock = (value) => JSON.parse(JSON.stringify(value, (key, field) => (["createdAt", "updatedAt"].includes(key) ? "<clock>" : field)));

assert.deepEqual(withoutClock(buildPlayableWorldFromPack(xiaoyaoyou)), withoutClock(xiaoyaoyouSeed()),
  "the xiaoyaoyou pack builds the same playable world as the authored setup");
assert.equal(xiaoyaoyou.stage.placeId, "loc_xyy_tavern");
assert.deepEqual(xiaoyaoyou.objects, XIAOYA_YOU_TAVERN_INSTITUTION.objectTemplates, "objects reference the institution data");
assert.deepEqual(xiaoyaoyou.work, XIAOYA_YOU_TAVERN_INSTITUTION.workOrderTemplates);
assert.deepEqual(tavernOpeningAgenda(TAVERN_SCENE_CHARACTER_IDS, { openingAfterSeconds: 900 }), [{
  id: "tavern-opening-preparation", kind: "opening_preparation", placeId: "loc_xyy_tavern",
  label: "开门前的柴水准备", dueAtSeconds: 900, warningAtSeconds: 600,
  status: "pending", warned: false, source: "configurable_scene_opening_schedule",
  responsibleActorIds: ["char_xyy_xiezenshi", "char_xyy_xieheng", "char_xyy_xiemu"],
  delayConsequence: "柴水未齐会记为营业准备延误；到时仍须实际完成，答应或描述做完不能抵账。",
  conditions: [{ objectId: "tavern_resource_sheltered_firewood", stateKey: "processedBundles", minimum: 2 },
    { objectId: "tavern_resource_water_vat", stateKey: "fill", minimum: 1 }],
}], "the data-driven opening agenda matches the former hand-written one");
assert.throws(() => tavernOpeningAgenda(TAVERN_SCENE_CHARACTER_IDS, { openingAfterSeconds: 10 }), (error) => error.code === "TAVERN_OPENING_TIME_INVALID");

console.log("Xiaoyaoyou world pack passed: playable world, institution data and opening agenda are unchanged.");
