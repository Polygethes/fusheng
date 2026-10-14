import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { renderApp } from "../src/ui/render.js";

const state = structuredClone(initialState);
state.ui.setupCompleted = true;
state.ui.activeTab = "reality";
state.ui.engineMode = "openai";

const html = renderApp(state);
assert.match(html, /data-engine-mode="openai"/, "reality workspace should expose a DeepSeek mode control");
assert.match(html, /DeepSeek/, "DeepSeek should be named in the user-facing control");
assert.match(html, /V4 Flash/, "the exact default model should be visible in the reality workspace");
assert.match(html, /真实模型/, "the active provider should be visible in the workspace status");

state.ui.lastPlayError = "模型返回的 JSON 不完整";
const errorHtml = renderApp(state);
assert.match(errorHtml, /DeepSeek 调用失败/, "remote failures should remain visible in the workspace");
assert.match(errorHtml, /模型返回的 JSON 不完整/, "the actual remote error should be readable without a transient alert");

console.log("deepseekWorkspaceControl:test passed");
