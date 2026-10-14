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

const dayOne = playNext(getState());
recordObservedDraft(dayOne);
const dayTwo = playNext(getState());

const pressuredOutputIds = new Set(
  (dayTwo.agentOutputs || [])
    .filter((output) => output.townStatePressureSummary)
    .map((output) => output.outputId)
    .filter(Boolean),
);
assert.ok(pressuredOutputIds.size > 0, "second day should have agents reacting to prior town-state facts");

const pressuredExchanges = (dayTwo.periodSimulation?.ticks || [])
  .flatMap((tick) => (tick.sceneInteraction?.agentExchanges || []).map((exchange) => ({ tick, exchange })))
  .filter(({ exchange }) => pressuredOutputIds.has(exchange.sourceOutputId) || pressuredOutputIds.has(exchange.responseOutputId));

assert.ok(pressuredExchanges.length > 0, "prior town-state pressure should be visible inside scene exchanges");

const withoutObligationReply = pressuredExchanges
  .filter(({ exchange }) => !(exchange.dialogueTurns || []).some((turn) =>
    turn.turnRole === "state_reply"
      && /我(?:先)?答|我不答|除非|只要|先让|不能|可以|要么|价码|证词|名字|交代/.test(turn.line || "")
      && /灵契|妖丹盒|庇护牌|照骨镜|渡令|魂灯|停剑令|铜盘|界石|药炉|符/.test(turn.line || "")
  ))
  .map(({ tick, exchange }) => ({
    locationName: tick.locationName,
    source: exchange.sourceCharacterName || exchange.actorName,
    response: exchange.responseCharacterName || exchange.targetName,
    turns: (exchange.dialogueTurns || []).map((turn) => `${turn.turnRole}:${turn.speakerName}:${turn.line}`),
  }));

assert.deepEqual(
  withoutObligationReply,
  [],
  `each exchange touched by prior town-state pressure should include a concrete obligation reply:\n${JSON.stringify(withoutObligationReply.slice(0, 4), null, 2)}`,
);

console.log("townStateLedgerCreatesDialogueObligation:test passed", {
  pressuredExchanges: pressuredExchanges.length,
});
