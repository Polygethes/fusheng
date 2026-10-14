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
const { buildObservationEvents } = await import("../src/ui/render.js");

resetState();
applySetupWorld({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});
setUi({ timeGrain: "day", focusMode: "ambient", activeTab: "observe", engineMode: "mock" });

const firstDraft = playNext(getState());
recordObservedDraft(firstDraft);
const secondDraft = playNext(getState());

const memoryRichExchanges = (secondDraft.periodSimulation?.ticks || [])
  .flatMap((tick) => {
    const sims = tick.simulationTick?.privateSimulations || [];
    return (tick.sceneInteraction?.agentExchanges || []).map((exchange) => {
      const exchangeSims = sims.filter((sim) =>
        [exchange.sourceCharacterId, exchange.responseCharacterId].includes(sim.characterId)
      );
      return { tick, exchange, exchangeSims };
    });
  })
  .filter(({ exchangeSims }) => exchangeSims.some((sim) =>
    sim.relationshipDialogueMemory || Number(sim.relationshipHistoryCount || 0) >= 2
  ));

assert.ok(memoryRichExchanges.length > 0, "second day should include exchanges with carried relationship history");

const staleSloganPattern = /按城法[^。！？]{0,40}不按宗门私仇|买卖在城规里，别把血仇带进来|我押的是灵契，不是命|价码到了，旧案自然开口|让照骨司先验|庇护牌还亮着，谁也不能拖人|庇护牌亮着时不问正邪|庇护牌亮着，先救命，后审案|药炉前不问正邪|进了医坊，先救命，后审案|镜面只记灵痕，不替谁认罪|我只照见写下来的东西/;
const stale = memoryRichExchanges.filter(({ exchange }) =>
  staleSloganPattern.test((exchange.dialogueTurns || []).map((turn) => turn.line).join(" "))
);

assert.equal(
  stale.length,
  0,
  `relationship-history exchanges should speak from remembered pressure, not replay seed slogans:\n${JSON.stringify(stale.slice(0, 5).map(({ tick, exchange, exchangeSims }) => ({
    slot: tick.label,
    locationName: tick.locationName,
    history: exchangeSims.map((sim) => ({
      characterName: sim.characterName,
      historyCount: sim.relationshipHistoryCount,
      remembered: sim.relationshipDialogueMemory?.sharedObject,
    })),
    turns: (exchange.dialogueTurns || []).map((turn) => `${turn.speakerName}: ${turn.line}`),
  })), null, 2)}`,
);

const observerEvents = buildObservationEvents(secondDraft, getState())
  .filter((event) => event.movementSource === "period-tick");
const staleObserverEvents = observerEvents.filter((event) => staleSloganPattern.test(event.text || ""));

assert.equal(
  staleObserverEvents.length,
  0,
  `observer outcomes must not reintroduce seed slogans removed from agent dialogue:\n${JSON.stringify(staleObserverEvents.slice(0, 5).map((event) => ({
    time: event.time,
    location: event.location,
    text: event.text,
  })), null, 2)}`,
);

const turnManagementPattern = /上一轮|连续\d+轮|第\d+轮|刚才那句话(?:落在明处|说完)|把上一句说完|把刚才没说完的话补上|把没说完的那句接上/;
const turnManaged = memoryRichExchanges.filter(({ exchange }) =>
  turnManagementPattern.test((exchange.dialogueTurns || []).map((turn) => turn.line).join(" "))
);

assert.equal(
  turnManaged.length,
  0,
  `remembered dialogue must name story-world pressure rather than simulation turns:\n${JSON.stringify(turnManaged.slice(0, 5).map(({ tick, exchange }) => ({
    slot: tick.label,
    locationName: tick.locationName,
    turns: (exchange.dialogueTurns || []).map((turn) => `${turn.speakerName}: ${turn.line}`),
  })), null, 2)}`,
);

const mirrored = memoryRichExchanges.filter(({ exchange }) => {
  const turns = exchange.dialogueTurns || [];
  return turns.some((turn, index) => {
    const previous = turns[index - 1];
    return previous
      && previous.speakerId !== turn.speakerId
      && String(previous.line || "").replace(/[，。！？；：\s]/g, "") === String(turn.line || "").replace(/[，。！？；：\s]/g, "");
  });
});

assert.equal(
  mirrored.length,
  0,
  `relationship-history exchanges should not mirror the same line across speakers:\n${JSON.stringify(mirrored.slice(0, 5).map(({ tick, exchange }) => ({
    slot: tick.label,
    locationName: tick.locationName,
    turns: (exchange.dialogueTurns || []).map((turn) => `${turn.speakerName}: ${turn.line}`),
  })), null, 2)}`,
);

console.log("secondDayRelationshipDialogueUsesHistory:test passed", {
  checked: memoryRichExchanges.length,
});
