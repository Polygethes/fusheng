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
  setupPeoplePrompt: "正道修士、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});
let state = getState();
setUi({
  timeGrain: "scene",
  focusMode: "focused",
  activeTab: "observe",
  engineMode: "mock",
  selectedLocationId: state.locations[0].id,
  activeCharacterIds: state.characters.slice(0, 3).map((character) => character.id),
});
state = getState();

const byName = new Map(state.characters.map((character) => [character.name, character.id]));
const luId = byName.get("鹿青萝");
const yanId = byName.get("阎无咎");

assert.ok(luId && yanId, "xianxia setup should include 鹿青萝 and 阎无咎");

const firstDraft = playNext(state);
const firstOverheardMemory = (firstDraft.updateBundle?.characterMemories || []).find((memory) =>
  memory.characterId === luId
    && memory.targetCharacterId === yanId
    && memory.sourceRelationshipShift?.relationshipSource === "overheard-dialogue"
);
assert.ok(firstOverheardMemory, "first draft should create 鹿青萝→阎无咎 overheard memory");

saveDraft(firstDraft);
acceptDraft(firstDraft.id, firstDraft.updateBundle);
state = getState();

const persistedOverheardMemory = (state.characterMemories || []).find((memory) =>
  memory.characterId === luId
    && memory.targetCharacterId === yanId
    && memory.sourceRelationshipShift?.relationshipSource === "overheard-dialogue"
);
assert.ok(persistedOverheardMemory, "accepted state should persist the overheard memory");

const secondDraft = playNext(state);
const luOutput = (secondDraft.agentOutputs || []).find((output) => output.characterId === luId);
const luPrivateSim = (secondDraft.privateSimulations || secondDraft.simulationTick?.privateSimulations || []).find((sim) => sim.characterId === luId);

assert.ok(luOutput, "second draft should include 鹿青萝 agent output");
assert.equal(
  luOutput.targetCharacterId,
  yanId,
  `overheard memory should redirect 鹿青萝's next visible action toward 阎无咎, got target=${luOutput.targetCharacterId}:\n${JSON.stringify({
    visibleAction: luOutput.visibleAction,
    memoryInfluence: luOutput.memoryInfluence,
    memoryUse: luOutput.memoryUse,
    privateTarget: luPrivateSim?.targetCharacterId,
    privateMemorySource: luPrivateSim?.memorySource,
    privateMemoryEcho: luPrivateSim?.memoryDialogueEcho,
  }, null, 2)}`,
);
assert.equal(
  luPrivateSim?.targetCharacterId,
  yanId,
  "private simulation should also aim 鹿青萝 at the overheard speaker",
);
assert.match(
  `${luOutput.memoryInfluence || ""} ${luOutput.memoryUse || ""} ${luPrivateSim?.memoryTension || ""} ${luPrivateSim?.memoryDialogueEcho || ""}`,
  /阎无咎|听见|旁听|刚才|overheard-dialogue/,
  "next action should explicitly carry the overheard memory pressure",
);

console.log("overheardMemoryRedirectsNextAction:test passed", {
  firstMemory: persistedOverheardMemory.privateVersion,
  nextVisibleAction: luOutput.visibleAction,
  nextMemoryUse: luOutput.memoryInfluence || luOutput.memoryUse,
});
