import assert from "node:assert/strict";
import { defineWorldPack, worldPackDigest, REQUIRED_SECTIONS } from "../src/worlds/worldPack.mjs";
import { loadWorldPack, listWorldPackIds, DEFAULT_WORLD_PACK_ID } from "../src/worlds/registry.mjs";

const minimal = () => Object.fromEntries(REQUIRED_SECTIONS.map((section) => [section, section === "meta" ? { id: "probe" } : {}]));

assert.throws(() => defineWorldPack({ ...minimal(), stage: undefined }), (error) => error.code === "WORLD_PACK_SECTION_MISSING" && /stage/u.test(error.message));
assert.throws(() => defineWorldPack({ ...minimal(), meta: {} }), (error) => error.code === "WORLD_PACK_ID_INVALID");

const pack = defineWorldPack({ ...minimal(), stage: { placeId: "loc_probe", topology: { zones: { a: { id: "a" } } } } });
assert.throws(() => { pack.stage.placeId = "elsewhere"; }, TypeError, "a defined pack is deeply frozen");
assert.throws(() => { pack.stage.topology.zones.a.id = "b"; }, TypeError);

const reordered = defineWorldPack(Object.fromEntries(Object.entries({ ...minimal(), stage: { topology: { zones: { a: { id: "a" } } }, placeId: "loc_probe" } }).reverse()));
assert.equal(worldPackDigest(pack), worldPackDigest(reordered), "digest ignores key order");
assert.notEqual(worldPackDigest(pack), worldPackDigest(defineWorldPack({ ...minimal(), stage: { placeId: "loc_other" } })));

await assert.rejects(() => loadWorldPack("../secrets"), (error) => error.code === "WORLD_PACK_ID_INVALID");
await assert.rejects(() => loadWorldPack("no_such_world"), (error) => error.code === "WORLD_PACK_UNKNOWN");
assert.equal(DEFAULT_WORLD_PACK_ID, "xiaoyaoyou");
assert.ok(listWorldPackIds().includes("xiaoyaoyou"));
const xiaoyaoyou = await loadWorldPack("xiaoyaoyou");
assert.equal(xiaoyaoyou.meta.id, "xiaoyaoyou");
assert.ok(Object.isFrozen(xiaoyaoyou));

console.log("World pack core passed: sections are required, packs are frozen, digests are stable, ids are allow-listed.");
