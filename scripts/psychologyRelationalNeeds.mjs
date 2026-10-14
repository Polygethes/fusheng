import assert from "node:assert/strict";
import { renderApp } from "../src/ui/render.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { compactState } from "../src/server/pipeline/context.mjs";
import { normalizePrivateSimulation } from "../src/server/pipeline/privateSimulator.mjs";
import { buildVisibilityLayer, simulatePrivateCharacter } from "../src/state/simulationLoop.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于 Downloads 下《逍遥游》策划案与当前版剧本，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚，只写开场前史，不预知后续剧情。",
});

const needs = state.characters.map((character) => character.agentProfile?.desiredResponse || "");
assert.equal(new Set(needs).size, state.characters.length, "every agent needs a distinct desired response from other people");

for (const character of state.characters) {
  const desiredResponse = character.agentProfile?.desiredResponse || "";
  const desiredWitness = character.agentProfile?.desiredWitness || "";
  assert.ok(desiredResponse, `${character.name} needs a concrete desired response`);
  assert.ok(desiredWitness, `${character.name} needs a distinct desired witness`);
  assert.notEqual(desiredResponse, desiredWitness, `${character.name}'s desired response cannot be a person field`);
  assert.doesNotMatch(desiredResponse, /^(recognition|being_seen|最能看穿自己的人。?|一个能维持自我神话的反应。?)$/, `${character.name} must not expose a template token`);
  assert.match(desiredResponse, /[。！？]$/, `${character.name}'s desired response should be a complete Chinese sentence`);

  state.ui.activeTab = "psychology";
  state.ui.selectedCharacterId = character.id;
  const html = renderApp(state);
  const passage = html.match(/<h2>想从别人那里得到<\/h2>\s*<p>([^<]+)<\/p>/)?.[1] || "";
  assert.equal(passage, desiredResponse, `${character.name}'s psychology view should render the desired response, not desiredJudge`);
}

state.ui.activeCharacterIds = state.characters.slice(0, 2).map((character) => character.id);
state.ui.selectedLocationId = state.locations[0].id;
const compact = compactState(state);
for (const character of compact.activeCharacters) {
  const target = compact.activeCharacters.find((item) => item.id !== character.id);
  const simulation = normalizePrivateSimulation({}, compact, character, target.id);
  assert.equal(
    simulation.whatTheyWantFromOthers,
    character.agentProfile.desiredResponse,
    "model fallback psychology should preserve the agent's own relational need",
  );
}

const activeCharacters = state.characters.slice(0, 2);
const location = state.locations[0];
const visibilityLayer = buildVisibilityLayer(state, activeCharacters, location);
for (const character of activeCharacters) {
  const simulation = simulatePrivateCharacter({ state, character, activeCharacters, location, visibilityLayer });
  assert.equal(
    simulation.whatTheyWantFromOthers,
    character.agentProfile.desiredResponse,
    "local character agents should preserve their own relational need",
  );
}

console.log("psychologyRelationalNeeds:test passed", state.characters.map((character) => ({
  name: character.name,
  desiredResponse: character.agentProfile.desiredResponse,
})));
