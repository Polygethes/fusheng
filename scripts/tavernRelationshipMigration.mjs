import assert from "node:assert/strict";
import {
  LEGACY_TAVERN_RELATIONSHIP_EDGE_ORDER,
  LEGACY_TAVERN_RELATIONSHIP_VECTORS,
  buildCalibratedTavernRelationships,
} from "../src/server/ecology/tavernRelationshipSeeds.mjs";
import { migrateTavernRelationshipDynamicsV1 } from "../src/state/store.js";

const names = {
  char_xyy_xiezenshi: "谢真石",
  char_xyy_xieheng: "谢恒",
  char_xyy_xiemu: "谢母",
  char_xyy_zhoumin: "周珉",
  char_xyy_luozhao: "洛照",
  char_xyy_yanzhizhong: "严执中",
  char_xyy_chenyan: "陈砚",
};
const characters = Object.entries(names).map(([id, name]) => ({ id, name }));
const legacyRelationships = LEGACY_TAVERN_RELATIONSHIP_EDGE_ORDER.map(([fromCharacterId, toCharacterId], index) => ({
  id: `rel_xiaoyaoyou_${index + 1}`,
  projectId: "proj_xiaoyaoyou",
  fromCharacterId,
  toCharacterId,
  label: "旧序号关系",
  ...structuredClone(LEGACY_TAVERN_RELATIONSHIP_VECTORS[index]),
  misreading: "旧误读",
  unspoken: "旧未言明",
  evidenceIds: [],
}));
legacyRelationships[0].dependence += 3;
legacyRelationships[0].dialogueHistory = [{ eventOutcome: "周珉确实收到一次答复。" }];

const target = {
  worldSetup: { worldDossier: { worldId: "xiaoyaoyou" } },
  characters: structuredClone(characters),
  relationships: structuredClone(legacyRelationships),
  branches: [{
    id: "branch_main",
    snapshot: {
      characters: structuredClone(characters),
      relationships: structuredClone(legacyRelationships),
    },
  }],
};
const calibrated = buildCalibratedTavernRelationships([], characters, "xiaoyaoyou");
const calibratedByDirection = new Map(calibrated.map((relationship) => [
  `${relationship.fromCharacterId}->${relationship.toCharacterId}`,
  relationship,
]));

migrateTavernRelationshipDynamicsV1(target);
assert.equal(target.worldSetup.tavernRelationshipDynamicsVersion, 1);
assert.equal(target.relationships.length, 18);
assert.equal(new Set(target.relationships.map((relationship) => `${relationship.fromCharacterId}->${relationship.toCharacterId}`)).size, 18);
assert.equal(target.branches[0].snapshot.relationships.length, 18, "branch snapshots must migrate with the active state");

const migrated = target.relationships.find((relationship) => (
  relationship.fromCharacterId === "char_xyy_xiezenshi"
  && relationship.toCharacterId === "char_xyy_zhoumin"
));
const calibratedForward = calibratedByDirection.get("char_xyy_xiezenshi->char_xyy_zhoumin");
const calibratedReverse = calibratedByDirection.get("char_xyy_zhoumin->char_xyy_xiezenshi");
const migratedReverse = target.relationships.find((relationship) => (
  relationship.fromCharacterId === "char_xyy_zhoumin"
  && relationship.toCharacterId === "char_xyy_xiezenshi"
));
assert.equal(migrated.dependence, calibratedForward.dependence + 3, "migration must preserve accumulated deltas on top of the corrected baseline");
assert.deepEqual(migrated.dialogueHistory, [{ eventOutcome: "周珉确实收到一次答复。" }]);
assert.equal(migrated.generatedFrom, "tavern-calibrated-directional-seed+preserved-history");
assert.equal(migratedReverse.dependence, calibratedReverse.dependence, "a missing reverse direction must receive its own calibrated baseline");

const once = structuredClone(target);
migrateTavernRelationshipDynamicsV1(target);
assert.deepEqual(target, once, "relationship migration must be idempotent");

console.log("tavernRelationshipMigration:test passed", {
  directions: target.relationships.length,
  preservedDelta: migrated.dependence - calibratedForward.dependence,
  branchDirections: target.branches[0].snapshot.relationships.length,
});
