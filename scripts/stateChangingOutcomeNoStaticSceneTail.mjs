import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

const {
  acceptDraft,
  applySetupWorld,
  getState,
  resetState,
  saveDraft,
  setUi,
} = await import("../src/state/store.js");
const { playNext } = await import("../src/engine/mockEngine.js");

resetState();
applySetupWorld({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});

let state = getState();
const market = state.locations.find((location) => /无咎市|市|案台|账/.test(`${location.id} ${location.name} ${location.subtext}`)) || state.locations[0];
const activeIds = ["沈珩", "阎无咎", "鹿青萝"]
  .map((name) => state.characters.find((character) => character.name === name)?.id)
  .filter(Boolean);

setUi({
  timeGrain: "scene",
  focusMode: "focused",
  activeTab: "observe",
  engineMode: "mock",
  selectedLocationId: market.id,
  activeCharacterIds: activeIds,
});

let thirdDraft = null;
for (let index = 0; index < 3; index += 1) {
  state = getState();
  const draft = playNext(state);
  if (index === 2) thirdDraft = draft;
  saveDraft(draft);
  acceptDraft(draft.id, draft.updateBundle);
}

const sceneText = thirdDraft?.sceneText || "";
const stateChangingOutcomes = (thirdDraft?.sceneInteraction?.agentExchanges || [])
  .map((exchange) => exchange.eventOutcome || "")
  .filter((outcome) => /迫使|失去.*退路|临时控制|保护债|没能.*退路/.test(outcome));

assert.ok(
  stateChangingOutcomes.length,
  `fixture should produce at least one state-changing exchange outcome by the third local run, got:\n${sceneText}`,
);
assert.doesNotMatch(
  sceneText,
  /没有被立刻收回。\s*$/,
  `a state-changing scene should end on the playable consequence, not a static object tail:\n${sceneText}`,
);
assert.doesNotMatch(
  sceneText,
  /(?:沈珩|阎无咎|鹿青萝)刚(?:要|和)|刚要留在|刚和/,
  `object extraction should not turn “刚才” or a speaker name into a scene object:\n${sceneText}`,
);

console.log("stateChangingOutcomeNoStaticSceneTail:test passed", {
  outcomes: stateChangingOutcomes,
  tail: sceneText.split("\n").slice(-2),
});
