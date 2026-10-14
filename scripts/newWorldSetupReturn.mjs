import assert from "node:assert/strict";
import * as store from "../src/state/store.js";
import { renderApp } from "../src/ui/render.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const runningWorld = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
runningWorld.ui.activeTab = "reality";
runningWorld.ui.setupCompleted = true;
runningWorld.ui.setupStep = "launch";
runningWorld.ui.setupWorldPrompt = "上一次的世界输入";
runningWorld.ui.setupPeoplePrompt = "上一次的人物输入";

const runningHtml = renderApp(runningWorld);
assert.ok(runningHtml.includes('data-action="open-world-setup"'), "the running town needs an explicit new-world entry");
assert.ok(runningHtml.includes("重开酒馆"), "the entry should describe restarting the fixed tavern");

assert.equal(typeof store.beginNewWorldSetup, "function", "the setup transition should be an explicit state operation");
assert.equal(typeof store.cancelNewWorldSetup, "function", "the current world should be recoverable without rebuilding it");

store.importState(JSON.stringify(runningWorld));
const originalTownName = store.getState().town.name;
store.beginNewWorldSetup();
const setupState = store.getState();

assert.equal(setupState.ui.activeTab, "setup", "new-world action should open setup");
assert.equal(setupState.ui.setupStep, "world", "new-world action should always return to the first question");
assert.equal(setupState.ui.setupWorldPrompt, "", "the first-page literary options require an empty world prompt");
assert.equal(setupState.ui.setupPeoplePrompt, "", "new character creation should start empty");
assert.equal(setupState.ui.setupReturnTab, "reality", "setup should remember where the player came from");
assert.equal(setupState.town.name, originalTownName, "opening setup must not destroy the current town");

const setupHtml = renderApp(setupState);
assert.ok(setupHtml.includes('data-setup-step="world"'), "the first world question should be visible");
assert.ok(setupHtml.includes("《逍遥游》") && setupHtml.includes("望梯酒馆"), "the focused tavern brief should return");
assert.ok(!setupHtml.includes("《变形记》"), "restarting the tavern should not reopen unrelated world presets");
assert.ok(setupHtml.includes('data-action="cancel-world-setup"'), "an existing town needs a way back from fullscreen setup");
assert.ok(setupHtml.includes("返回当前小镇"), "the cancel action should explain that the current town is preserved");

store.cancelNewWorldSetup();
const restored = store.getState();
assert.equal(restored.ui.activeTab, "reality", "cancel should return to the previous town view");
assert.equal(restored.town.name, originalTownName, "cancel should preserve the current town");
assert.equal(restored.ui.setupCompleted, true, "cancel should keep the existing world active");

console.log("newWorldSetupReturn:test passed", { town: restored.town.name, returnTab: restored.ui.activeTab });
