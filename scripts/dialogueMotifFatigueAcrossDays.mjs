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

const spokenLines = [];
for (let day = 0; day < 3; day += 1) {
  const draft = playNext(getState());
  spokenLines.push(...(draft.periodSimulation?.ticks || []).flatMap((tick) =>
    (tick.sceneInteraction?.agentExchanges || []).flatMap((exchange) =>
      (exchange.dialogueTurns || []).map((turn) => turn.line || "").filter(Boolean)
    )
  ));
  recordObservedDraft(draft);
}

const motifCounts = {
  "先留": spokenLines.filter((line) => line.includes("先留")).length,
  "还在": spokenLines.filter((line) => line.includes("还在")).length,
  "门刚开时": spokenLines.filter((line) => line.includes("门刚开时")).length,
  "账页翻到这里": spokenLines.filter((line) => line.includes("账页翻到这里")).length,
  "日影偏过去": spokenLines.filter((line) => line.includes("日影偏过去")).length,
  "灯影压下来": spokenLines.filter((line) => line.includes("灯影压下来")).length,
  "夜灯亮着": spokenLines.filter((line) => line.includes("夜灯亮着")).length,
};
const temporalMotifTotal = ["门刚开时", "账页翻到这里", "日影偏过去", "灯影压下来", "夜灯亮着"]
  .reduce((total, motif) => total + motifCounts[motif], 0);

assert.ok(spokenLines.length >= 50, "three observed days should expose enough dialogue to detect motif fatigue");
assert.ok(
  motifCounts["先留"] <= 10,
  `visible dialogue should not be dominated by the stock retention motif:\n${JSON.stringify({
    total: spokenLines.length,
    motifCounts,
    samples: spokenLines.filter((line) => line.includes("先留")).slice(0, 12),
  }, null, 2)}`,
);
assert.ok(
  temporalMotifTotal <= 24,
  `visible dialogue should not lean on repeated stock time-texture phrases:\n${JSON.stringify({
    total: spokenLines.length,
    temporalMotifTotal,
    motifCounts,
    samples: spokenLines.filter((line) => /门刚开时|账页翻到这里|日影偏过去|灯影压下来|夜灯亮着/.test(line)).slice(0, 16),
  }, null, 2)}`,
);

console.log("dialogueMotifFatigueAcrossDays:test passed", {
  total: spokenLines.length,
  temporalMotifTotal,
  motifCounts,
});
