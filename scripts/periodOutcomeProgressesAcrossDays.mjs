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
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});
setUi({ timeGrain: "day", focusMode: "ambient", activeTab: "observe", engineMode: "mock" });

const outcomes = new Map();
for (let day = 1; day <= 6; day += 1) {
  const draft = playNext(getState());
  for (const tick of draft.periodSimulation?.ticks || []) {
    for (const exchange of tick.sceneInteraction?.agentExchanges || []) {
      const outcome = String(exchange.eventOutcome || "").replace(/\s+/g, " ").trim();
      if (outcome.length < 16) continue;
      const existing = outcomes.get(outcome) || [];
      existing.push({
        day,
        period: tick.period || "",
        locationName: tick.locationName || "",
        pair: `${exchange.sourceCharacterName || exchange.actorName || exchange.sourceCharacterId || ""}->${exchange.responseCharacterName || exchange.targetName || exchange.responseCharacterId || ""}`,
      });
      outcomes.set(outcome, existing);
    }
  }
  recordObservedDraft(draft);
}

const repeated = [...outcomes.entries()]
  .filter(([, hits]) => hits.length >= 3)
  .map(([outcome, hits]) => ({ count: hits.length, outcome, hits }));
const backendPhrases = [...outcomes.keys()].filter((outcome) =>
  /这轮关系|形成保护债|保护债|必须先回答|关系状态|下一步|后台|simulation/.test(outcome)
);

assert.deepEqual(
  repeated,
  [],
  `cross-day event outcomes should show accumulating consequences instead of exact repeated endings:\n${JSON.stringify(repeated, null, 2)}`,
);
assert.deepEqual(
  backendPhrases,
  [],
  `event outcomes should stay observable and novelistic, not explain relationship mechanics:\n${backendPhrases.join("\n")}`,
);

console.log("periodOutcomeProgressesAcrossDays:test passed", {
  outcomeCount: outcomes.size,
});
