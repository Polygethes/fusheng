import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { renderApp } from "../src/ui/render.js";

const state = structuredClone(initialState);
state.ui.setupCompleted = true;
state.ui.activeTab = "reality";

const html = renderApp(state);
const primarySpaces = [...html.matchAll(/data-primary-space="([^"]+)"/g)].map((match) => match[1]);

assert.deepEqual(
  primarySpaces,
  ["psychology", "reality", "story"],
  "the app shell should expose exactly three ordered primary workspaces",
);
assert.match(html, /心理空间/, "primary navigation should name the psychology workspace");
assert.match(html, /现实空间/, "primary navigation should name the reality workspace");
assert.match(html, /故事空间/, "primary navigation should name the story workspace");
assert.ok(!html.includes('class="tabs"'), "the legacy thirteen-tab dashboard navigation should be removed");
assert.ok(html.includes('data-reality-space="true"'), "reality should render the live observation surface");

console.log("threeSpaceWorkspace:test passed", { primarySpaces });
