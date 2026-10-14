import assert from "node:assert/strict";
import { listWorldPackIds, loadWorldPack } from "../src/worlds/registry.mjs";
import { runWorldSmoke, unsatisfiableSchemaPaths } from "../src/worlds/worldSmoke.mjs";

for (const id of listWorldPackIds()) {
  const pack = await loadWorldPack(id);
  const report = await runWorldSmoke(pack);
  assert.deepEqual(report.issues, [], `world pack ${id} passes the reachability smoke`);
  assert.equal(report.authority, "reachability-smoke-not-character-behavior");
  assert.equal(report.stages.length, pack.stage.sceneCast.length * 2, "every character prepares a planning and an action stage");
  assert.ok(report.deadlines.length > 0 && report.deadlines.every((row) => row.status === "fulfilled"), `${id} deadlines are reachable in time`);
}

const xiaoyaoyou = structuredClone(await loadWorldPack("xiaoyaoyou"));
xiaoyaoyou.work = xiaoyaoyou.work.filter((row) => row.templateId !== "split_firewood_bundles");
const broken = await runWorldSmoke(xiaoyaoyou, { stages: false });
assert.ok(broken.issues.some((row) => row.code === "SMOKE_DEADLINE_UNREACHABLE"), "a deadline without a work route is unreachable");

assert.deepEqual(unsatisfiableSchemaPaths({ type: "array", minItems: 1, maxItems: 0 }), ["schema (minItems 1 > maxItems 0)"]);
assert.deepEqual(unsatisfiableSchemaPaths({ type: "object", properties: { a: { type: "array", minItems: 0, maxItems: 2 } } }), []);

console.log("World smoke passed: every pack's characters prepare satisfiable stages and every deadline is reachable through real settlement.");
