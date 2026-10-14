import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

const {
  applySetupWorld,
  applyUpdateBundle,
  getState,
  resetState,
} = await import("../src/state/store.js");

resetState();
applySetupWorld({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

let state = getState();
const shen = state.characters.find((item) => item.id === "char_xianxia_shenheng");
const aoji = state.characters.find((item) => item.id === "char_xianxia_aoji");
assert.ok(shen && aoji, "test characters should exist");

applyUpdateBundle({
  relationships: [{
    fromCharacterId: shen.id,
    toCharacterId: aoji.id,
    deltas: { resentment: 5 },
    generatedFrom: "agent-dialogue-relationship",
    relationshipSource: "agent-exchange",
    sharedObject: "铜铃",
    eventOutcome: "铜铃留在两人中间。",
    finalTurn: "铃声停了，话还没完。",
    followupTurn: "你记住的是城规，还是我刚才的停顿？",
    dialogueTurnCount: 4,
    locationId: "loc_xianxia_ferry",
    locationName: "归墟渡",
    periodSlot: "上午",
  }],
});

applyUpdateBundle({
  relationships: [{
    fromCharacterId: shen.id,
    toCharacterId: aoji.id,
    deltas: { wantsToBeSeen: 4 },
    generatedFrom: "agent-dialogue-relationship",
    relationshipSource: "agent-exchange",
    sharedObject: "渡令",
    eventOutcome: "渡令被压回湿冷的石阶。",
    finalTurn: "人可以退，渡令不走。",
    followupTurn: "你刚才问的是城规，现在渡令先别换手。",
    dialogueTurnCount: 4,
    locationId: "loc_xianxia_ferry",
    locationName: "归墟渡",
    periodSlot: "中午",
  }],
});

state = getState();
const rel = state.relationships.find((item) => item.fromCharacterId === shen.id && item.toCharacterId === aoji.id);
assert.ok(rel, "relationship should exist");
assert.equal(rel.lastDialogue?.sharedObject, "渡令", "lastDialogue should still point to the latest dialogue");
assert.ok(Array.isArray(rel.dialogueHistory), "relationship should keep dialogueHistory");
assert.equal(rel.dialogueHistory.length, 2, "relationship should append dialogue history instead of overwriting it");
assert.deepEqual(
  rel.dialogueHistory.map((item) => item.sharedObject),
  ["铜铃", "渡令"],
  "dialogueHistory should preserve chronological order",
);
assert.equal(
  rel.dialogueHistory[0].followupTurn,
  "你记住的是城规，还是我刚才的停顿？",
  "earlier unresolved turn should remain available to future agents",
);

console.log("relationshipDialogueHistoryPersistence:test passed", {
  history: rel.dialogueHistory.map((item) => `${item.periodSlot}:${item.sharedObject}:${item.followupTurn}`),
});
