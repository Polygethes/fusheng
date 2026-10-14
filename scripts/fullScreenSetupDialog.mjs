import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { renderApp } from "../src/ui/render.js";

const worldHtml = renderApp(initialState);

assert.ok(worldHtml.includes('data-setup-dialog="true"'), "initial setup should render as a fullscreen dialog");
assert.ok(worldHtml.includes('role="dialog"'), "setup should use dialog semantics");
assert.ok(worldHtml.includes('data-setup-step="world"'), "first setup step should be world creation");
assert.ok(worldHtml.includes("望梯酒馆今天承受什么外界压力？"), "first step should frame the fixed tavern through outside pressure");
assert.ok(worldHtml.includes('data-key="setupWorldPrompt"'), "first step should provide one world prompt input");
assert.ok(worldHtml.includes("《逍遥游》") && worldHtml.includes("望梯酒馆"), "empty input should stay inside the focused Xiaoyaoyou tavern");
assert.ok(!worldHtml.includes("《变形记》") && !worldHtml.includes("《西游记》") && !worldHtml.includes("《三国》") && !worldHtml.includes("《教父》"), "the focused product should not advertise unrelated world presets");
assert.ok(worldHtml.includes("继续"), "world step should advance without exposing backend structure");
assert.ok(!worldHtml.includes('class="topbar"'), "fullscreen setup should hide the app topbar");
assert.ok(!worldHtml.includes('class="tabs"'), "fullscreen setup should hide normal app tabs");
assert.ok(!worldHtml.includes('data-observer-window="true"'), "observation window should not exist during setup");
assert.ok(!worldHtml.includes('data-relationship-graph="true"'), "relationship graph should wait until character creation");
assert.ok(!worldHtml.includes("Skill") && !worldHtml.includes("底层规则") && !worldHtml.includes("规则组"), "setup should not expose backend skills or rule scaffolding");

const characterState = structuredClone(initialState);
characterState.ui.setupStep = "characters";
const characterHtml = renderApp(characterState);

assert.ok(characterHtml.includes('data-setup-step="characters"'), "second setup step should be character creation");
assert.ok(characterHtml.includes("哪些人会在这里过自己的日子？"), "second step should ask who lives through the tavern day");
assert.ok(characterHtml.includes('data-key="setupPeoplePrompt"'), "second step should provide one people prompt input");
assert.ok(!characterHtml.includes('data-relationship-graph="true"'), "character creation should not render a backend relationship graph in setup");
assert.ok(!characterHtml.includes("Skill") && !characterHtml.includes("人物边界"), "character creation should not expose backend character skill");
assert.ok(!characterHtml.includes('data-observer-window="true"'), "observation window should still be hidden while creating characters");

const launchState = structuredClone(initialState);
launchState.ui.setupStep = "launch";
const launchHtml = renderApp(launchState);

assert.ok(launchHtml.includes('data-setup-step="launch"'), "final setup step should confirm launch");
assert.ok(launchHtml.includes("进入世界"), "final step should explicitly launch the world");
assert.ok(!launchHtml.includes("Skill") && !launchHtml.includes("底层规则"), "final step should not summarize backend skills");

console.log("fullScreenSetupDialog:test passed", {
  defaultStep: initialState.ui.setupStep,
});
