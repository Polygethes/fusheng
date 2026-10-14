import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});

assert.equal(state.worldSetup.worldDossier.worldId, "xiaoyaoyou");
assert.equal(state.worldSetup.tavernLifeVersion, 11, "Xiaoyaoyou must opt into the current causal Agent-runtime tavern life kernel");
assert.equal(state.worldSetup.tavernEcologyVersion, 1, "Xiaoyaoyou must opt into the ecology appraisal kernel");
assert.equal(state.worldSetup.fixedStage, true, "the camera must stay on one stage");
assert.equal(state.locations.length, 1, "the focused product must expose one playable location");
assert.equal(state.locations[0].id, "loc_xyy_tavern");
assert.equal(state.locations[0].name, "望梯酒馆");
assert.equal(state.ui.focusMode, "location");
assert.equal(state.ui.selectedLocationId, "loc_xyy_tavern");
assert.ok(state.tavernState?.stock?.meals > 0, "the tavern needs material stock");

for (const character of state.characters) {
  assert.ok(
    character.lifeProfile?.schedule?.length
      || character.lifeProfile?.simulationTier === "core"
      || character.lifeProfile?.tavernAgency?.visitPolicy?.kind === "self_directed",
    `${character.name} needs a schedule constraint, a core presence, or a self-owned arrival intention`,
  );
  assert.ok(character.lifeProfile?.activities?.duty, `${character.name} needs a grounded duty activity`);
  assert.ok(character.lifeState?.needs, `${character.name} needs dynamic needs`);
  assert.ok(character.lifeProfile?.materialEconomy?.wealthBand, `${character.name} needs a material economy profile`);
  assert.equal(character.lifeState?.resources?.wallet?.amount, character.lifeState?.resources?.coins);
  assert.ok(character.ecologyProfileId, `${character.name} needs a registered ecology profile`);
  assert.ok(character.ecologyState?.body && character.ecologyState?.desires, `${character.name} needs mutable ecology state`);
  assert.equal(Object.hasOwn(character, "ecologyProfile"), false, `${character.name}'s immutable profile must not bloat snapshots`);
  if (character.lifeProfile.simulationTier === "core") {
    assert.equal(character.currentLocationId, "loc_xyy_tavern");
    assert.equal(character.ecologyState.presence.observableAtStage, true);
  } else {
    assert.notEqual(character.currentLocationId, "loc_xyy_tavern", `${character.name} must exist offstage before arriving`);
    assert.equal(character.ecologyState.presence.observableAtStage, false);
    assert.ok(state.worldSetup.offstageLocations.some((location) => location.id === character.currentLocationId));
  }
}

console.log("xiaoyaoyouTavernFocus:test passed", {
  location: state.locations[0].name,
  characters: state.characters.map((character) => character.name),
});
