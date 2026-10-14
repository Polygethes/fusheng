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
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});
setUi({ timeGrain: "day", focusMode: "ambient", activeTab: "observe", engineMode: "mock" });

const openings = [];
for (let day = 1; day <= 6; day += 1) {
  const draft = playNext(getState());
  const firstTick = draft.periodSimulation?.ticks?.[0];
  const firstExchange = firstTick?.sceneInteraction?.agentExchanges?.[0] || {};
  openings.push({
    day,
    locationId: firstTick?.locationId || "",
    locationName: firstTick?.locationName || "",
    sourceCharacterId: firstExchange.sourceCharacterId || firstExchange.actorId || "",
    responseCharacterId: firstExchange.responseCharacterId || firstExchange.targetId || "",
    sourceCharacterName: firstExchange.sourceCharacterName || firstExchange.actorName || "",
    responseCharacterName: firstExchange.responseCharacterName || firstExchange.targetName || "",
    sample: firstTick?.surfaceEvent || firstTick?.synthesized?.surfaceEvent || "",
  });
  recordObservedDraft(draft);
}

function longestRun(items, keyFn) {
  let best = 0;
  let current = 0;
  let previous = "";
  for (const item of items) {
    const key = keyFn(item);
    current = key && key === previous ? current + 1 : 1;
    previous = key;
    best = Math.max(best, current);
  }
  return best;
}

const locationRun = longestRun(openings, (item) => item.locationId);
const pairRun = longestRun(openings, (item) => `${item.locationId}:${item.sourceCharacterId}->${item.responseCharacterId}`);
const uniqueOpeningLocations = new Set(openings.map((item) => item.locationId).filter(Boolean));

assert.ok(
  uniqueOpeningLocations.size >= 3,
  `multi-day town openings should move through at least three districts instead of looping one stage:\n${JSON.stringify(openings, null, 2)}`,
);
assert.ok(
  locationRun < 3,
  `opening scene should not stay in the same district for three consecutive days:\n${JSON.stringify(openings, null, 2)}`,
);
assert.ok(
  pairRun < 3,
  `opening scene should not keep the same pair locked in the same first scene for three consecutive days:\n${JSON.stringify(openings, null, 2)}`,
);

console.log("periodOpeningDoesNotStall:test passed", {
  openings,
});
