import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import xiaoyaoyou from "../src/worlds/xiaoyaoyou/pack.mjs";
import { buildTavernWorldStateV27, createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { GOLDEN_PATH, goldenCases, sortedJson, xiaoyaoyouSeed } from "./captureWorldStateGolden.mjs";

const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8"));
const comparable = (cases) => JSON.parse(JSON.stringify(sortedJson(Object.fromEntries(Object.entries(cases)
  .map(([name, state]) => [name, { ...state, worldPackMeta: undefined }])))));

assert.deepEqual(comparable(goldenCases()), golden, "the default world pack rebuilds the pre-refactor tavern world state");
assert.deepEqual(comparable(goldenCases((state, options) => buildTavernWorldStateV27(state, { ...options, worldPack: xiaoyaoyou }))), golden,
  "an explicit xiaoyaoyou pack rebuilds the same world state");

const scene = goldenCases().scene;
assert.equal(scene.worldPackMeta.id, "xiaoyaoyou");
assert.match(scene.worldPackMeta.digest, /^[0-9a-f]{64}$/u);
assert.deepEqual(scene.worldPackMeta.relationshipMetrics, [...xiaoyaoyou.relationshipMetrics]);
assert.equal(scene.worldPackMeta.report.renderer, "legacy-tavern");

const instance = createWorldRuntimeV27(xiaoyaoyouSeed(), { worldPack: xiaoyaoyou, pacingMode: "scene" });
assert.deepEqual(instance.characterIds, [...xiaoyaoyou.stage.sceneCast], "scene cast comes from the pack");
assert.equal(instance.coordinator.worldState.entities.char_xyy_xiemu.zoneId, "stove");

console.log("World pack runtime equivalence passed: the tavern world state is unchanged when read from the pack.");
