import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

const {
  applySetupWorld,
  exportState,
  getState,
  importState,
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
setUi({
  activeTab: "observe",
  engineMode: "local",
  focusMode: "location",
  selectedLocationId: "loc_xianxia_contract_gate",
  timeGrain: "day",
});

const sourceState = getState();
const draft = playNext(sourceState);
const focusedBeforeReload = buildObservationEvents(draft, sourceState)
  .find((event) => event.locationId === sourceState.ui.selectedLocationId);

assert.match(
  focusedBeforeReload?.text || "",
  /说：“/,
  `fixture must contain focused agent dialogue before persistence, got:\n${focusedBeforeReload?.text || ""}`,
);

recordObservedDraft(draft);
const persisted = exportState();
importState(persisted);

const reloadedState = getState();
const reloadedDraft = reloadedState.draftScenes.find((item) => item.id === draft.id);
const focusedAfterReload = buildObservationEvents(reloadedDraft, reloadedState)
  .find((event) => event.locationId === reloadedState.ui.selectedLocationId);
const reloadedFocusedTick = reloadedDraft?.periodSimulation?.ticks
  ?.find((tick) => tick.locationId === reloadedState.ui.selectedLocationId);

assert.ok(reloadedDraft, "the observed draft should survive persistence");
assert.ok(
  reloadedFocusedTick?.sceneInteraction?.agentExchanges?.length,
  "the persisted focused tick must retain its resolved agent exchanges",
);
assert.match(
  focusedAfterReload?.text || "",
  /说：“/,
  `focused observer dialogue must survive reload, got:\n${focusedAfterReload?.text || ""}`,
);

console.log("focusedDialogueSurvivesReload:test passed", {
  before: focusedBeforeReload.text,
  after: focusedAfterReload.text,
});
