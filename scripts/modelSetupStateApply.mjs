import assert from "node:assert/strict";
import {
  applyGeneratedSetupWorld,
  getState,
  resetState,
} from "../src/state/store.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

resetState();

const setupWorldPrompt = "赛博朋克海底避难城，氧气被公司征税。";
const setupPeoplePrompt = "潜水员走私者、公司监察官、合成圣女。";
const generated = buildPlayableWorldFromSetup({ setupWorldPrompt, setupPeoplePrompt });
generated.project.title = "模型生成的蓝肺城";
generated.town.name = "蓝肺城";
generated.worldSetup.generatedByModel = true;
generated.worldSetup.modelGeneration = { model: "fake-setup-model", provider: "test-json" };

const applied = applyGeneratedSetupWorld(generated, { setupWorldPrompt, setupPeoplePrompt });
const state = getState();

assert.equal(applied.project.title, "模型生成的蓝肺城");
assert.equal(state.project.title, "模型生成的蓝肺城");
assert.equal(state.town.name, "蓝肺城");
assert.equal(state.worldSetup.generatedByModel, true);
assert.equal(state.worldSetup.modelGeneration.model, "fake-setup-model");
assert.equal(state.ui.setupCompleted, true);
assert.equal(state.ui.activeTab, "observe");
assert.equal(state.ui.setupWorldPrompt, setupWorldPrompt);
assert.equal(state.ui.setupPeoplePrompt, setupPeoplePrompt);
assert.ok(state.branches.length === 1 && state.branches[0].projectId === generated.project.id, "generated setup should reset a fresh main branch");
assert.ok(state.characterPlans.length >= state.characters.length, "generated setup should initialize character plans");

console.log("modelSetupStateApply:test passed", {
  title: state.project.title,
  model: state.worldSetup.modelGeneration.model,
  characters: state.characters.length,
});
