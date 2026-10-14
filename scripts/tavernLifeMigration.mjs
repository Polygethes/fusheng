import assert from "node:assert/strict";
import { applyGeneratedSetupWorld, getState, importState } from "../src/state/store.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const generated = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
applyGeneratedSetupWorld(generated, {
  setupWorldPrompt: generated.worldSetup.sourcePrompts.world,
  setupPeoplePrompt: generated.worldSetup.sourcePrompts.people,
});

const legacy = getState();
legacy.project.title = "逍遥游 · 梯云城";
legacy.town.name = "梯云城";
delete legacy.worldSetup.tavernLifeVersion;
delete legacy.worldSetup.tavernEcologyVersion;
delete legacy.worldSetup.fixedStage;
delete legacy.tavernState;
legacy.locations = [
  { id: "loc_xyy_sword_tower", name: "梯云宗剑阁" },
  { id: "loc_xyy_square", name: "剑阁前广场" },
];
legacy.ui.focusMode = "ambient";
legacy.ui.selectedLocationId = "loc_xyy_sword_tower";
legacy.characters = legacy.characters.map((character) => {
  const copy = structuredClone(character);
  delete copy.lifeProfile;
  delete copy.lifeState;
  delete copy.ecologyProfileId;
  delete copy.ecologyProfileVersion;
  delete copy.ecologyState;
  copy.currentLocationId = "loc_xyy_sword_tower";
  return copy;
});
legacy.branches = legacy.branches.map((branch) => ({
  ...branch,
  snapshot: {
    ...(branch.snapshot || {}),
    characters: structuredClone(legacy.characters),
    tavernState: null,
  },
}));

importState(JSON.stringify(legacy));
const migrated = getState();

assert.equal(migrated.project.title, "逍遥游 · 望梯酒馆");
assert.equal(migrated.town.name, "望梯酒馆");
assert.equal(migrated.worldSetup.tavernLifeVersion, 11);
assert.equal(migrated.worldSetup.tavernMaterialEconomyVersion, 1);
assert.equal(migrated.worldSetup.tavernEcologyVersion, 1);
assert.equal(migrated.locations.length, 1);
assert.equal(migrated.locations[0].id, "loc_xyy_tavern");
assert.equal(migrated.ui.focusMode, "location");
assert.equal(migrated.ui.engineMode, "openai");
assert.equal(migrated.ui.selectedLocationId, "loc_xyy_tavern");
assert.ok(migrated.tavernState?.stock?.meals > 0);
assert.equal(migrated.tavernState?.schemaVersion, 9);
assert.equal(migrated.tavernState?.institution?.schemaVersion, 5);
assert.equal(migrated.tavernState?.institution?.offerings?.fine_cloud_tea_pot?.price, 6);
assert.equal(migrated.tavernState?.stock?.fineTea, 3);
assert.equal(migrated.tavernState?.institution?.operatorId, "char_xyy_xiemu");
assert.deepEqual(migrated.tavernState?.eventThreads, []);
assert.deepEqual(migrated.tavernState?.candidateNotices, []);
assert.ok(migrated.characters.every((character) => (
  character.lifeState?.needs
  && (
    character.lifeProfile?.schedule?.length
    || character.lifeProfile?.simulationTier === "core"
    || character.lifeProfile?.tavernAgency?.visitPolicy?.kind === "self_directed"
  )
)));
assert.ok(migrated.characters.every((character) => character.lifeProfile?.tavernAgency?.standing));
assert.ok(migrated.characters.every((character) => character.lifeProfile?.materialEconomy?.wealthBand));
assert.ok(migrated.characters.every((character) => character.lifeState?.resources?.wallet?.sourceId));
assert.equal(migrated.characters.find((character) => character.id === "char_xyy_luozhao")?.lifeState?.resources?.coins, 24);
assert.equal(migrated.characters.find((character) => character.id === "char_xyy_chenyan")?.lifeState?.resources?.coins, 0);
assert.ok(migrated.characters.find((character) => character.id === "char_xyy_xiemu")
  ?.lifeProfile?.tavernAgency?.knowledgeBoundary?.knownActorIds?.includes("char_xyy_chenyan"),
"v9 migration must persist explicitly authored identity knowledge");
assert.ok(migrated.characters.every((character) => character.ecologyProfileId && character.ecologyState?.body));
assert.ok(migrated.characters.every((character) => !Object.hasOwn(character, "ecologyProfile")));
assert.ok(migrated.characters.filter((character) => character.lifeProfile.simulationTier === "core")
  .every((character) => character.currentLocationId === "loc_xyy_tavern" && character.ecologyState.presence.observableAtStage));
assert.ok(migrated.characters.filter((character) => character.lifeProfile.simulationTier === "visitor")
  .every((character) => character.currentLocationId !== "loc_xyy_tavern" && !character.ecologyState.presence.observableAtStage));
assert.ok(migrated.branches.every((branch) => branch.snapshot?.tavernState));

console.log("tavernLifeMigration:test passed", {
  title: migrated.project.title,
  location: migrated.locations[0].name,
  branchCount: migrated.branches.length,
});
