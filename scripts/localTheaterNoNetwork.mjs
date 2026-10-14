import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playNext } from "../src/engine/playService.js";

const state = structuredClone(initialState);
state.ui.engineMode = "local";
state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";

let fetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  fetchCalls += 1;
  throw new Error("local theater mode must not call fetch");
};

try {
  const draft = await playNext(state);
  const exchanges = [
    ...(draft.sceneInteraction?.agentExchanges || []),
    ...(draft.periodSimulation?.ticks || []).flatMap((tick) => tick.sceneInteraction?.agentExchanges || []),
  ];
  const dialogueTurns = exchanges.flatMap((exchange) => exchange.dialogueTurns || []);
  const periodTicks = draft.periodTicks || draft.sceneInteraction?.periodTicks || draft.periodSimulation?.ticks || [];
  const relationshipUpdates = draft.updateBundle?.relationships || [];
  const relationshipShift = draft.relationshipShift || [];

  assert.equal(fetchCalls, 0, "local theater mode should not call fetch");
  assert.match(draft.provider || draft.engine?.provider || "", /local|mock|browser/i, "provider should identify local/browser mock");
  assert.ok(exchanges.length || periodTicks.length, "draft should include local scene exchanges or period ticks");
  assert.ok(dialogueTurns.length >= 2, "local theater should include agent dialogue inside scene exchanges");
  assert.ok(relationshipUpdates.length || relationshipShift.length, "draft should include relationship updates or shifts");

  console.log("localTheaterNoNetwork:test passed", {
    provider: draft.provider || draft.engine?.provider,
    exchanges: exchanges.length,
    dialogueTurns: dialogueTurns.length,
    periodTicks: periodTicks.length,
    relationshipUpdates: relationshipUpdates.length,
    relationshipShift: relationshipShift.length,
  });
} finally {
  globalThis.fetch = originalFetch;
}
