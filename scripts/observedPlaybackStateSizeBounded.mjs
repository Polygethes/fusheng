import assert from "node:assert/strict";

const storage = new Map();
const serializedLengths = [];

globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => {
    serializedLengths.push(String(value || "").length);
    storage.set(key, value);
  },
  removeItem: (key) => storage.delete(key),
};

const {
  applySetupWorld,
  getState,
  recordObservedDraft,
  resetState,
  setUi,
} = await import("../src/state/store.js");
const { playNext } = await import("../src/engine/mockEngine.js");

resetState();
applySetupWorld({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});
setUi({ timeGrain: "day", focusMode: "ambient", activeTab: "observe", engineMode: "mock" });

for (let day = 0; day < 4; day += 1) {
  const draft = playNext(getState());
  recordObservedDraft(draft);
}

const state = getState();
const maxSerializedLength = Math.max(...serializedLengths);
const nestedSnapshotEvents = (state.canonEvents || []).flatMap((event) =>
  [
    ...(event.preAcceptSnapshot?.canonEvents || []),
    ...(event.postAcceptSnapshot?.canonEvents || []),
  ].filter((nested) => nested.preAcceptSnapshot || nested.postAcceptSnapshot)
);

assert.ok(
  maxSerializedLength < 1_900_000,
  `observed playback persistence should stay bounded after four days, got ${maxSerializedLength}`,
);
assert.equal(
  nestedSnapshotEvents.length,
  0,
  "canon events embedded inside snapshots should not carry recursive snapshots",
);
assert.ok(state.canonEvents.length >= 4, "four observed days should still produce canon history");
assert.ok(state.characterMemories.length >= 20, "bounded persistence should not remove relationship memories");

console.log("observedPlaybackStateSizeBounded:test passed", {
  maxSerializedLength,
  canonEvents: state.canonEvents.length,
  memories: state.characterMemories.length,
});
