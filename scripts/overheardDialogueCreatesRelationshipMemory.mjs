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
  resetState,
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

const draft = playNext(state);
const byName = new Map(state.characters.map((character) => [character.name, character.id]));
const luId = byName.get("鹿青萝");
const yanId = byName.get("阎无咎");

assert.ok(luId && yanId, "xianxia setup should include 鹿青萝 and 阎无咎");
assert.match(
  draft.sceneText || "",
  /鹿青萝[^。！？\n]{0,40}(?:听见|接住|打断|插进|刚才|前一句)[^。！？\n]{0,60}阎无咎|鹿青萝[^。！？\n]{0,60}(?:听见|接住|打断|插进|刚才|前一句)/,
  "test setup should render 鹿青萝 hearing the previous exchange",
);

const overheardShift = (draft.relationshipShift || []).find((shift) =>
  shift.fromCharacterId === luId
    && shift.toCharacterId !== luId
    && shift.relationshipSource === "overheard-dialogue"
);
const heardCharacter = state.characters.find((character) => character.id === overheardShift?.toCharacterId);

assert.ok(
  overheardShift,
  `hearing a previous line should create a 鹿青萝→阎无咎 relationship shift, got:\n${JSON.stringify((draft.relationshipShift || []).map((shift) => ({
    fromCharacterId: shift.fromCharacterId,
    toCharacterId: shift.toCharacterId,
    generatedFrom: shift.generatedFrom,
    relationshipSource: shift.relationshipSource,
    misreading: shift.misreading,
  })), null, 2)}`,
);
assert.match(overheardShift.misreading || "", new RegExp(`听见|旁听|刚才|${heardCharacter?.name || "人物"}`), "overheard shift should explain the immediately preceding line");
assert.match(overheardShift.unspoken || "", /庇护牌|灵契|伤者|价码|旧案/, "overheard shift should keep the concrete stakes");

const overheardMemory = (draft.updateBundle?.characterMemories || []).find((memory) =>
  memory.characterId === luId
    && memory.targetCharacterId === overheardShift.toCharacterId
    && memory.sourceRelationshipShift?.relationshipSource === "overheard-dialogue"
);

assert.ok(
  overheardMemory,
  `accepted update bundle should turn overheard relationship into memory, got:\n${JSON.stringify((draft.updateBundle?.characterMemories || []).map((memory) => ({
    characterId: memory.characterId,
    targetCharacterId: memory.targetCharacterId,
    source: memory.source,
    relationshipSource: memory.sourceRelationshipShift?.relationshipSource,
    content: memory.content,
  })), null, 2)}`,
);
assert.match(`${overheardMemory.content} ${overheardMemory.privateVersion}`, new RegExp(`鹿青萝|${heardCharacter?.name || "人物"}|听见|旁听|刚才`));

console.log("overheardDialogueCreatesRelationshipMemory:test passed", {
  shift: overheardShift.misreading,
  memory: overheardMemory.privateVersion,
});
