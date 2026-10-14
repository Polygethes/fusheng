import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

const {
  acceptDraft,
  applySetupWorld,
  getState,
  resetState,
  saveDraft,
  setUi,
} = await import("../src/state/store.js");

resetState();
applySetupWorld({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

let state = getState();
setUi({
  timeGrain: "scene",
  focusMode: "focused",
  activeTab: "observe",
  selectedLocationId: state.locations[0].id,
  activeCharacterIds: state.characters.slice(0, 3).map((character) => character.id),
});

state = getState();
const firstDraft = playNext(state);
saveDraft(firstDraft);
acceptDraft(firstDraft.id, firstDraft.updateBundle);

const secondDraft = playNext(getState());
const memoryLines = (secondDraft.sceneInteraction?.agentExchanges || [])
  .flatMap((exchange) => exchange.dialogueTurns || [])
  .map((turn) => turn.line || "")
  .filter((line) => /刚才|上次|上一轮|记得|没有忘|还在/.test(line));

const memoryPhrases = memoryLines
  .flatMap((line) => [...line.matchAll(/(?:刚才|上次|上一轮|记得|没有忘)[^。！？]*/g)].map((match) => match[0]))
  .filter(Boolean);

assert.ok(memoryPhrases.length >= 2, "second scene should contain multiple memory-shaped dialogue lines");
assert.ok(
  new Set(memoryPhrases).size >= 2,
  `memory dialogue should not repeat one copied prefix for different characters: ${memoryPhrases.join(" | ")}`,
);

console.log("relationshipMemoryVoiceVariety:test passed", {
  memoryPhrases,
});
