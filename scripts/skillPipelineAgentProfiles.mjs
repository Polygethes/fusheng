import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

assert.deepEqual(
  state.worldSetup.skillPipeline?.map((step) => step.skillName),
  ["世界建立 Skill", "戏剧人物 Skill"],
  "world setup should record a two-step runtime skill pipeline",
);

assert.ok(
  state.worldSetup.worldDossier?.ruleSets?.publicRules?.length >= 3,
  "world skill should leave a runnable world dossier with public rule sets",
);

for (const character of state.characters) {
  assert.equal(character.generatedBySkill, "戏剧人物 Skill", `${character.name} should be created by the character skill`);
  assert.ok(character.agentProfile?.dramaticObjective, `${character.name} should carry an agent dramatic objective`);
  assert.ok(character.agentProfile?.leverageObject, `${character.name} should carry a concrete leverage object`);
  assert.ok(character.agentProfile?.hiddenFear, `${character.name} should carry a hidden fear`);
  assert.ok(character.agentProfile?.dialogueMoves?.length >= 3, `${character.name} should carry multiple dialogue moves`);
}

state.ui.timeGrain = "scene";
state.ui.focusMode = "focused";
state.ui.activeTab = "observe";
state.ui.activeCharacterIds = state.characters.slice(0, 3).map((character) => character.id);
state.ui.selectedLocationId = state.locations[0].id;

const draft = playNext(state);
const privateSimulations = draft.simulationTick?.privateSimulations || draft.privateSimulations || [];
assert.ok(privateSimulations.length >= 2, "a scene tick should run multiple private character agents");

for (const sim of privateSimulations) {
  assert.ok(sim.agentProfile?.dramaticObjective, `${sim.characterName} private simulation should read the agent profile`);
  assert.ok(
    sim.actionCandidate.includes(sim.agentProfile.leverageObject)
      || sim.defensiveMask.includes(sim.agentProfile.leverageObject)
      || sim.publicGoal.includes(sim.agentProfile.leverageObject),
    `${sim.characterName} should act through their leverage object, not only through generic intention text`,
  );
}

console.log("skillPipelineAgentProfiles:test passed", {
  pipeline: state.worldSetup.skillPipeline.map((step) => step.skillName),
  sampleAgent: state.characters[0].agentProfile,
});
