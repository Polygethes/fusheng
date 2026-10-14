import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playNext } from "../src/engine/mockEngine.js";

const serialized = JSON.stringify(initialState);
const oldPresetTerms = ["沈闻山", "林澄", "周既明", "陈砚秋", "岐南大学", "文学院", "推荐信", "评奖"];

assert.equal(initialState.project.townId, "town_samsa_apartment", "project should point to the Metamorphosis town");
assert.equal(initialState.town.id, "town_samsa_apartment", "town should be the Samsa apartment pressure field");
assert.ok(initialState.project.title.includes("变形记"), "project title should identify the new prototype");
assert.ok(oldPresetTerms.every((term) => !serialized.includes(term)), "old college preset should be removed from the seed state");

const characterIds = new Set(initialState.characters.map((character) => character.id));
const expectedCharacters = ["char_gregor", "char_grete", "char_father", "char_mother", "char_clerk", "char_lodger"];
assert.deepEqual([...characterIds].sort(), expectedCharacters.sort(), "Metamorphosis seed should expose the core household and outside pressure roles");

const locationIds = new Set(initialState.locations.map((location) => location.id));
for (const id of ["loc_gregor_room", "loc_parlor", "loc_hallway", "loc_office_counter", "loc_lodgers_table"]) {
  assert.ok(locationIds.has(id), `missing Metamorphosis location ${id}`);
}

assert.ok(initialState.relationships.some((rel) => rel.fromCharacterId === "char_grete" && rel.toCharacterId === "char_gregor" && rel.protection > rel.resentment), "Grete should begin as Gregor's protector");
assert.ok(initialState.relationships.some((rel) => rel.fromCharacterId === "char_father" && rel.toCharacterId === "char_gregor" && rel.fear > 40), "father should carry fear toward Gregor");
assert.ok(initialState.characterMemories.some((memory) => memory.characterId === "char_gregor" && /房门|上班|债/.test(memory.content)), "Gregor should start with a door/work/debt memory");

const state = structuredClone(initialState);
state.ui.timeGrain = "day";
state.ui.focusMode = "location";
state.ui.selectedLocationId = "loc_gregor_room";
state.ui.engineMode = "mock";
const draft = playNext(state);

assert.equal(draft.periodSimulation.focus.locationId, "loc_gregor_room", "focused playback should observe Gregor's room");
assert.ok(draft.periodSimulation.ticks.some((tick) => tick.resolution === "focused_scene"), "focused Metamorphosis town should still support scene-level observation");
assert.ok(draft.sceneText.includes("格里高尔") || draft.sceneText.includes("Gregor"), "generated timeline should use the Metamorphosis cast");

console.log("metamorphosisSeed:test passed", {
  town: initialState.town.name,
  characters: initialState.characters.length,
  locations: initialState.locations.length,
  focus: draft.periodSimulation.focus.locationName,
});
