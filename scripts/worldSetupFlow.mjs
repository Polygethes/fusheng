import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { renderApp } from "../src/ui/render.js";

assert.equal(initialState.ui.activeTab, "setup", "the default surface should be the town-building flow");
assert.ok(initialState.worldSetup, "seed state should include explicit world setup choices");

const html = renderApp(initialState);

assert.ok(html.includes('data-world-setup="true"'), "setup tab should render a dedicated world-building surface");
assert.ok(html.includes('data-setup-dialog="true"'), "setup should start as a fullscreen creation dialog");
assert.ok(html.includes('data-setup-step="world"'), "setup should start on world creation");
assert.ok(html.includes("你想建立什么样的世界？"), "world step should ask the player what world they want");
assert.ok(html.includes('data-key="setupWorldPrompt"'), "world step should provide a single natural-language input");
assert.ok(html.includes("《变形记》") && html.includes("《西游记》") && html.includes("《三国》") && html.includes("《教父》"), "world step should offer literary presets when empty");
assert.ok(html.includes("继续"), "world step should advance to character creation");

assert.ok(!html.includes('data-relationship-graph="true"'), "world step should not show the relationship graph yet");
assert.ok(!html.includes("世界建立 Skill") && !html.includes("底层规则"), "world step should not expose backend skill scaffolding");

const futureKnowledge = ["照护者", "送食物", "清理房间", "哥哥已经听不懂了", "怪物", "变形后", "必须摆脱"];
for (const term of futureKnowledge) {
  assert.ok(!html.includes(term), `world setup step should not leak future knowledge: ${term}`);
}

const characterState = structuredClone(initialState);
characterState.ui.setupStep = "characters";
const characterHtml = renderApp(characterState);

assert.ok(characterHtml.includes('data-setup-step="characters"'), "character creation should be its own setup step");
assert.ok(characterHtml.includes("这个世界有什么样的人？"), "character step should ask the player who lives in the world");
assert.ok(characterHtml.includes('data-key="setupPeoplePrompt"'), "character step should provide a single natural-language input");
assert.ok(!characterHtml.includes('data-relationship-graph="true"'), "character setup should not show a backend graph");
assert.ok(!characterHtml.includes("戏剧人物 Skill") && !characterHtml.includes("人物边界"), "character step should not expose backend character skill");

const launchState = structuredClone(initialState);
launchState.ui.setupStep = "launch";
const launchHtml = renderApp(launchState);

assert.ok(launchHtml.includes('data-setup-step="launch"'), "launch confirmation should be the final setup step");
assert.ok(launchHtml.includes("进入世界"), "launch confirmation should open the world");

console.log("worldSetupFlow:test passed", {
  activeTab: initialState.ui.activeTab,
  setupOptions: initialState.worldSetup.worldOptions?.length || 0,
});
