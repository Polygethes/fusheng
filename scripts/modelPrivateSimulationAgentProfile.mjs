import assert from "node:assert/strict";
import * as privateSimulator from "../src/server/pipeline/privateSimulator.mjs";
import { compactState } from "../src/server/pipeline/context.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

assert.equal(
  typeof privateSimulator.normalizePrivateSimulation,
  "function",
  "private simulator should expose normalization so model output can be tested without API calls",
);

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});
state.ui.activeCharacterIds = state.characters.slice(0, 2).map((character) => character.id);
state.ui.selectedLocationId = state.locations[0].id;

const compact = compactState(state);
const shen = compact.activeCharacters.find((character) => character.name === "沈珩");
const yan = compact.activeCharacters.find((character) => character.name === "阎无咎");

const sim = privateSimulator.normalizePrivateSimulation({}, compact, shen, yan.id);

assert.ok(sim.agentProfile, "normalized model private simulation should preserve the character agent profile");
assert.equal(sim.agentProfile.leverageObject, "灵契", "normalized private simulation should retain the character's leverage object");
assert.match(sim.publicGoal, /灵契|正道审判|扣押|邪派证人/, "fallback public goal should be grounded in the agent profile");
assert.match(sim.privateDesire, /正道审判|扣押|邪派证人/, "fallback private desire should use the dramatic objective");
assert.match(sim.defensiveMask, /城法|灵契|宗门|私仇|证据/, "fallback defensive mask should use character-specific dialogue moves");
assert.match(sim.actionCandidate, /灵契/, "fallback action candidate should act through the leverage object");

const output = privateSimulator.privateSimulationToAgentOutput(sim);
assert.match(output.visibleAction, /灵契/, "agent output derived from private simulation should keep the leverage object visible");
assert.match(`${output.realtimePublicGoal} ${output.realtimePrivateDesire}`, /正道审判|扣押|邪派证人/, "agent output should preserve profile-driven objective");

console.log("modelPrivateSimulationAgentProfile:test passed", {
  character: sim.characterName,
  leverageObject: sim.agentProfile.leverageObject,
  actionCandidate: sim.actionCandidate,
});
