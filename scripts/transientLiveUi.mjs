import assert from "node:assert/strict";

const originalLocalStorage = globalThis.localStorage;
let writes = 0;
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => { writes += 1; },
};

try {
  const store = await import(`../src/state/store.js?transient-live-ui=${Date.now()}`);
  let renders = 0;
  store.subscribe(() => { renders += 1; });
  assert.equal(typeof store.setTransientUi, "function", "store should expose an ephemeral UI update path");

  store.setTransientUi({
    livePerformance: {
      runId: "run_test",
      status: "running",
      events: [{ type: "dialogue", line: "一句正在发生的话。" }],
    },
  });
  assert.equal(writes, 0, "each streamed line must not serialize the whole world to localStorage");
  assert.equal(renders, 1, "a transient update should still rerender the workspace");
  assert.equal(store.getState().ui.livePerformance.runId, "run_test");

  store.setUi({ lastPlayError: "persisted control" });
  assert.equal(writes, 1, "ordinary UI state should keep the existing persistence behavior");
  console.log("transientLiveUi:test passed", { writes, renders });
} finally {
  if (originalLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalLocalStorage;
}
