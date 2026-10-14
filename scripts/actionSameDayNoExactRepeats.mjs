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
  setupPeoplePrompt: "正道修士、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});
setUi({ timeGrain: "day", focusMode: "ambient", activeTab: "observe", engineMode: "mock" });

const firstDraft = playNext(getState());
recordObservedDraft(firstDraft);
const secondDraft = playNext(getState());

const actions = (secondDraft.periodSimulation?.ticks || [])
  .flatMap((tick) => (tick.agentOutputs || []).map((output) => ({
    actorId: output.characterId,
    action: normalizeActionSkeleton(output.visibleAction),
    slot: tick.label,
    locationName: tick.locationName,
  })))
  .filter((item) => item.action.length >= 12);

const byAction = new Map();
for (const item of actions) {
  const bucket = byAction.get(item.action) || [];
  bucket.push(item);
  byAction.set(item.action, bucket);
}

const repeated = [...byAction.entries()]
  .filter(([, items]) => items.length > 1)
  .map(([action, items]) => ({
    action,
    count: items.length,
    actors: [...new Set(items.map((item) => item.actorId))],
    where: items.map((item) => `${item.slot}/${item.locationName}/${item.actorId}`),
  }));

assert.equal(
  repeated.length,
  0,
  `same-day agent visible actions should not repeat exact action skeletons:\n${JSON.stringify(repeated, null, 2)}`,
);

console.log("actionSameDayNoExactRepeats:test passed", {
  actions: actions.length,
  uniqueActions: byAction.size,
});

function normalizeActionSkeleton(text = "") {
  return String(text || "")
    .replace(/[^。！？；]*?说：“[^”]*”[。！？；]?/g, "")
    .replace(/\s+/g, "")
    .replace(/[。！？；]+$/g, "")
    .trim();
}
