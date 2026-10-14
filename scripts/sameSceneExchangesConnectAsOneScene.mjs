import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

const {
  applySetupWorld,
  getState,
  resetState,
  setUi,
} = await import("../src/state/store.js");
const { playNext } = await import("../src/engine/mockEngine.js");

resetState();
applySetupWorld({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});
let state = getState();
setUi({
  timeGrain: "scene",
  focusMode: "focused",
  activeTab: "observe",
  engineMode: "mock",
  selectedLocationId: state.locations[0].id,
  activeCharacterIds: state.characters.slice(0, 3).map((character) => character.id),
});
state = getState();

const draft = playNext(state);
const text = draft.sceneText || "";
const exchanges = draft.sceneInteraction?.agentExchanges || [];

assert.ok(exchanges.length >= 2, "test setup should produce at least two same-scene exchanges");

const first = exchanges[0];
const second = exchanges[1];
const secondTarget = second.responseCharacterName || second.targetName || second.dialogueTurns?.[1]?.speakerName || "";
const previousSpeaker = first.dialogueTurns?.[1]?.speakerName || first.responseCharacterName || first.targetName || "";

assert.ok(secondTarget, "second exchange should have a visible target");
assert.ok(previousSpeaker, "first exchange should have a visible responding speaker");
assert.match(
  text,
  new RegExp(`${secondTarget}[^。！？\\n]{0,36}(?:听见|接住|打断|插进|刚才|前一句)[^。！？\\n]{0,48}${previousSpeaker}|${secondTarget}[^。！？\\n]{0,48}(?:听见|接住|打断|插进|刚才|前一句)`),
  `second same-scene exchange should be written as a continuation of the previous dialogue, got:\n${text}`,
);
assert.doesNotMatch(
  text,
  new RegExp(`${second.sourceCharacterName || "沈珩"}和${secondTarget}停在${second.sharedObject || "灵契"}旁边。\\s*${second.sourceCharacterName || "沈珩"}说`),
  `second exchange should not reopen as an isolated pair scene, got:\n${text}`,
);

console.log("sameSceneExchangesConnectAsOneScene:test passed", {
  first: `${first.sourceCharacterName}->${first.responseCharacterName}`,
  second: `${second.sourceCharacterName}->${second.responseCharacterName}`,
  sceneText: text,
});
