import assert from "node:assert/strict";
import { compactState } from "../src/server/pipeline/context.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

state.ui.activeCharacterIds = state.characters.slice(0, 3).map((character) => character.id);
state.ui.selectedLocationId = state.locations[0].id;

const compact = compactState(state);
const shen = compact.activeCharacters.find((character) => character.name === "沈珩");
const yan = compact.activeCharacters.find((character) => character.name === "阎无咎");

assert.ok(shen?.agentProfile, "model compact context should preserve the character skill agent profile");
assert.equal(shen.agentProfile.generatedBySkill, "戏剧人物 Skill", "agent profile should identify the character skill source");
assert.equal(shen.agentProfile.leverageObject, "灵契", "model prompt context should include沈珩's concrete leverage object");
assert.match(shen.agentProfile.dramaticObjective, /正道审判|扣押|邪派证人/, "model context should include the character's dramatic objective");

assert.ok(yan?.agentProfile?.dialogueMoves?.some((line) => /灵契|魔印|价码|旧案/.test(line)), "model context should preserve character-specific dialogue moves");

const serialized = JSON.stringify(compact.activeCharacters);
assert.ok(serialized.includes("agentProfile"), "active character payload sent to model should contain agentProfile");
assert.ok(serialized.includes("responseBoundary"), "active character payload should include response boundary from the character skill");

console.log("modelContextAgentProfile:test passed", {
  activeCharacters: compact.activeCharacters.map((character) => ({
    name: character.name,
    leverageObject: character.agentProfile?.leverageObject,
  })),
});
