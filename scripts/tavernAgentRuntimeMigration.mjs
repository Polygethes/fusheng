import assert from "node:assert/strict";
import { getState, importState } from "../src/state/store.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const v2 = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
v2.worldSetup.tavernLifeVersion = 2;
v2.ui.engineMode = "local";
v2.tavernState.schemaVersion = 2;
v2.tavernState.day = 6;
v2.tavernState.cashBox = 23;
v2.tavernState.activeVisits = [
  {
    id: "visit_keep",
    visitorId: "char_xyy_chenyan",
    stage: "received",
    hostId: "char_xyy_xiemu",
    purposeStatus: "declared",
    purposeDeclaredByActionId: "legacy_public_declaration",
  },
  {
    id: "visit_unverified_waiting",
    visitorId: "char_xyy_yanzhizhong",
    visitorName: "严执中",
    kind: "business",
    purpose: "核对酒馆留下的候选留宿与接引登记",
    stage: "waiting",
    hostId: "",
  },
];
const orphanLuo = v2.characters.find((character) => character.id === "char_xyy_luozhao");
delete orphanLuo.lifeProfile.simulationTier;
orphanLuo.lifeState.present = true;
orphanLuo.lifeState.activeVisitId = "visit_missing";
v2.tavernState.sceneRuntime = {
  activeCharacterIds: ["char_xyy_xiemu", "char_xyy_luozhao"],
  agents: {
    char_xyy_xiemu: { characterId: "char_xyy_xiemu", present: true, zoneId: "counter" },
    char_xyy_luozhao: { characterId: "char_xyy_luozhao", present: true, zoneId: "guest_room" },
  },
};
v2.tavernState.eventThreads = [{
  id: "thread_keep",
  topic: "陈砚的工是否验完",
  status: "open",
  participantIds: ["char_xyy_chenyan", "char_xyy_xiemu"],
  nextObligationCharacterId: "char_xyy_xiemu",
  turns: [],
}];
const legacyKnownActorId = "char_legacy_family_friend";
const staleMother = v2.characters.find((character) => character.id === "char_xyy_xiemu");
staleMother.lifeProfile.tavernAgency.knowledgeBoundary.knownActorIds = [legacyKnownActorId];
v2.branches = [{
  id: "branch_main",
  title: "主线",
  snapshot: {
    characters: structuredClone(v2.characters),
    relationships: structuredClone(v2.relationships),
    tavernState: structuredClone(v2.tavernState),
  },
}];
v2.project.activeBranchId = "branch_main";
v2.ui.activeBranchId = "branch_main";

importState(JSON.stringify(v2));
const migrated = getState();

assert.equal(migrated.worldSetup.tavernLifeVersion, 11, "existing v2 taverns must receive the current Agent-runtime migration once");
assert.equal(migrated.ui.engineMode, "openai", "the migrated existing tavern must stop silently running rule preview");
assert.equal(migrated.tavernState.day, 6, "runtime migration must preserve the lived day");
assert.equal(migrated.tavernState.cashBox, 23, "runtime migration must preserve material state");
assert.equal(migrated.tavernState.activeVisits?.[0]?.id, "visit_keep", "runtime migration must preserve active visits");
assert.equal(migrated.tavernState.eventThreads?.[0]?.id, "thread_keep", "runtime migration must preserve unfinished public business");
assert.equal(migrated.branches[0].snapshot.tavernState.eventThreads?.[0]?.id, "thread_keep");
assert.equal(migrated.tavernState.schemaVersion, 9, "the runtime schema must preserve the current economy and work-order boundaries");
assert.equal(migrated.tavernState.institution.schemaVersion, 5);
assert.equal(migrated.tavernState.institution.offerings.fine_cloud_tea_pot.price, 6);
assert.ok(migrated.characters.every((character) => character.lifeProfile?.materialEconomy?.wealthBand));
assert.ok(Array.isArray(migrated.tavernState.candidateNotices), "v4 migration must provide the event-driven candidate notice ledger");
assert.equal(migrated.tavernState.activeVisits?.[0]?.purposeStatus, "declared", "an in-progress legacy visit must not forget a purpose already known before migration");
assert.equal(
  migrated.tavernState.activeVisits?.find((visit) => visit.id === "visit_unverified_waiting")?.purposeStatus,
  "undisclosed",
  "a legacy waiting visit without a public declaration action must return to undisclosed instead of granting unexplained knowledge",
);
assert.equal(migrated.characters.find((character) => character.id === "char_xyy_luozhao")?.lifeState?.present, false, "orphan legacy visitors must be removed from the tavern");
assert.ok(!migrated.tavernState.sceneRuntime?.agents?.char_xyy_luozhao, "orphan visitor runtime positions must not survive v5 migration");
assert.ok(migrated.tavernState.activeVisits?.[0]?.allowedZoneIds?.length, "legacy visits must receive explicit zone permissions");
const migratedMotherKnownIds = migrated.characters.find((character) => character.id === "char_xyy_xiemu")
  ?.lifeProfile?.tavernAgency?.knowledgeBoundary?.knownActorIds || [];
assert.ok(migratedMotherKnownIds.includes(legacyKnownActorId), "v9 must preserve identities learned in the lived save");
assert.ok(migratedMotherKnownIds.includes("char_xyy_chenyan"), "v9 must union newly authored identity knowledge into the lived save");
const branchMotherKnownIds = migrated.branches[0].snapshot.characters
  .find((character) => character.id === "char_xyy_xiemu")
  ?.lifeProfile?.tavernAgency?.knowledgeBoundary?.knownActorIds || [];
assert.ok(branchMotherKnownIds.includes(legacyKnownActorId) && branchMotherKnownIds.includes("char_xyy_chenyan"),
  "v9 must apply the same non-destructive identity union inside branch snapshots");

const deliberateRulePreview = structuredClone(migrated);
deliberateRulePreview.ui.engineMode = "local";
importState(JSON.stringify(deliberateRulePreview));
assert.equal(getState().ui.engineMode, "local", "after the one-time v4 upgrade, an explicit rule-preview choice must remain respected");

console.log("tavernAgentRuntimeMigration:test passed", {
  version: migrated.worldSetup.tavernLifeVersion,
  engineMode: migrated.ui.engineMode,
    day: migrated.tavernState.day,
});
