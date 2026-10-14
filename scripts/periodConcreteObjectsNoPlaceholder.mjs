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
  recordObservedDraft,
  resetState,
  setUi,
} = await import("../src/state/store.js");
const { playNext } = await import("../src/engine/mockEngine.js");

resetState();
applySetupWorld({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖医、镜灵、龙裔、鬼修、器灵和城中执法者都被中立城规矩暂时压住。",
});
setUi({ timeGrain: "day", focusMode: "ambient", activeTab: "observe", engineMode: "mock" });

const leaked = [];
for (let day = 1; day <= 3; day += 1) {
  const draft = playNext(getState());
  for (const tick of draft.periodSimulation?.ticks || []) {
    for (const exchange of tick.sceneInteraction?.agentExchanges || []) {
      const texts = [
        ...(exchange.dialogueTurns || []).map((turn) => ({ speaker: turn.speakerName || "", text: turn.line || "" })),
        { speaker: "OUTCOME", text: exchange.eventOutcome || "" },
      ];
      for (const item of texts) {
        if (/另一件东西|这件东西|原来的东西|那件东西/.test(item.text)) {
          leaked.push({ day, locationName: tick.locationName, ...item });
        }
        if (/([^\s，。；！？、]{2,8})和\1都(?:别动|要留给|别急着换手)/.test(item.text)) {
          leaked.push({ day, locationName: tick.locationName, ...item });
        }
      }
    }
  }
  recordObservedDraft(draft);
}

assert.deepEqual(
  leaked,
  [],
  `dialogue and outcomes should name concrete stage objects instead of placeholders or self-pairs:\n${JSON.stringify(leaked.slice(0, 12), null, 2)}`,
);

console.log("periodConcreteObjectsNoPlaceholder:test passed");
