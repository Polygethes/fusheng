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

state = getState();
assert.ok(
  state.characterMemories.some((memory) => memory.source === "agent_dialogue_relationship"),
  "accepted first scene should leave relationship-dialogue memories",
);

const secondDraft = playNext(state);
const secondDialogue = (secondDraft.sceneInteraction?.agentExchanges || [])
  .flatMap((exchange) => exchange.dialogueTurns || [])
  .map((turn) => turn.line)
  .join("\n");

assert.match(
  secondDialogue,
  /刚才|上次|上一轮|还在|还压|又压|记得|没有忘/,
  "second scene dialogue should show that characters remember the previous exchange, not reset to first-contact bargaining",
);
assert.match(
  secondDialogue,
  /灵契|魔印|庇护牌|照骨镜|渡令|魂灯/,
  "memory-driven dialogue should still name the concrete contested object",
);

console.log("relationshipMemoryChangesDialogue:test passed", {
  sampleDialogue: secondDialogue.split("\n").slice(0, 4),
});
