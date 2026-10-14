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

const draft = playNext(getState());
const exchanges = (draft.periodSimulation?.ticks || [])
  .flatMap((tick) => tick.sceneInteraction?.agentExchanges || []);
assert.ok(exchanges.length >= 5, "fixture should produce multiple agent exchanges in a town day");

const ledger = draft.updateBundle?.townStateLedger || [];
assert.ok(Array.isArray(ledger), "update bundle should expose a townStateLedger array");
assert.ok(
  ledger.length >= exchanges.length,
  `each visible agent exchange should settle into a world-state ledger entry, got ${ledger.length} for ${exchanges.length} exchanges`,
);

const ledgerText = ledger.map((entry) => [
  entry.kind,
  entry.object,
  entry.fromCharacterName,
  entry.toCharacterName,
  entry.locationName,
  entry.fact,
  entry.consequence,
].filter(Boolean).join(" ")).join("\n");

assert.match(ledgerText, /灵契|妖丹盒|庇护牌|照骨镜|渡令|魂灯|停剑令|铜盘|界石/, "ledger should carry concrete world objects");
assert.match(ledgerText, /沈珩|阎无咎|鹿青萝|阿照|敖霁|孟槐|闻夏/, "ledger should name the involved characters");
assert.match(ledgerText, /交给|留在|扣住|压回|失去|欠|不得|必须|控制|改口|转入|带走/, "ledger should record a changed playable fact, not only summarize mood");
assert.doesNotMatch(ledgerText, /关系状态|下一步|后台|simulation|private|这轮关系/, "ledger should stay in-world");

recordObservedDraft(draft);
const after = getState();
assert.ok(
  after.townStateLedger?.some((entry) => entry.sourceDraftId === draft.id),
  "recording observed playback should persist townStateLedger entries into current state",
);

console.log("periodInteractionStateLedger:test passed", {
  exchanges: exchanges.length,
  ledgerEntries: ledger.length,
});
