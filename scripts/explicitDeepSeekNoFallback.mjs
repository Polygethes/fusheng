import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playNext } from "../src/engine/playService.js";

const originalFetch = globalThis.fetch;
let requestBody = null;
globalThis.fetch = async (_url, options) => {
  requestBody = JSON.parse(options.body);
  throw new Error("remote unavailable");
};

const state = structuredClone(initialState);
state.ui.engineMode = "openai";

await assert.rejects(
  () => playNext(state),
  /remote unavailable/,
  "explicit DeepSeek mode must surface failure instead of returning a local draft",
);
assert.equal(requestBody.allowFallback, false, "server must also be told not to fall back when DeepSeek is explicit");

globalThis.fetch = originalFetch;

console.log("explicitDeepSeekNoFallback:test passed");
