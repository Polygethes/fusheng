import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

const { getState, importState } = await import("../src/state/store.js");

const autoState = structuredClone(initialState);
autoState.ui.engineMode = "auto";
importState(JSON.stringify(autoState));
assert.equal(getState().ui.engineMode, "local", "stored auto mode should migrate to local theater by default");

const openaiState = structuredClone(initialState);
openaiState.ui.engineMode = "openai";
importState(JSON.stringify(openaiState));
assert.equal(getState().ui.engineMode, "openai", "explicit real-model mode should be preserved");

console.log("localTheaterMigratesAutoMode:test passed");
