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
assert.ok(
  (firstDraft.updateBundle?.characterMemories || []).some((memory) =>
    memory.characterId === luId
      && memory.targetCharacterId === yanId
      && memory.sourceRelationshipShift?.relationshipSource === "overheard-dialogue"
  ),
  "first draft should create 鹿青萝→阎无咎 overheard memory",
);

saveDraft(firstDraft);
acceptDraft(firstDraft.id, firstDraft.updateBundle);
state = getState();

const secondDraft = playNext(state);
const exchanges = secondDraft.sceneInteraction?.agentExchanges || [];
const directExchange = exchanges.find((exchange) => {
  const pair = new Set([exchange.sourceCharacterId, exchange.responseCharacterId]);
  return pair.has(luId) && pair.has(yanId);
});

assert.ok(
  directExchange,
  `second draft should turn overheard memory into a direct 鹿青萝↔阎无咎 exchange, got:\n${JSON.stringify(exchanges.map((exchange) => ({
    sourceCharacterId: exchange.sourceCharacterId,
    responseCharacterId: exchange.responseCharacterId,
    turns: (exchange.dialogueTurns || []).map((turn) => `${turn.speakerName}: ${turn.line}`),
  })), null, 2)}`,
);

const turnSpeakers = new Set((directExchange.dialogueTurns || []).map((turn) => turn.speakerId));
assert.ok(turnSpeakers.has(luId) && turnSpeakers.has(yanId), "direct exchange should include dialogue from both 鹿青萝 and 阎无咎");

const directText = (directExchange.dialogueTurns || []).map((turn) => turn.line).join("\n");
assert.match(
  directText,
  /听见|刚才|旁听|庇护牌|灵契|伤者|价码|旧案/,
  `direct exchange should carry the overheard memory pressure, got:\n${directText}`,
);
assert.doesNotMatch(
  `${directText}\n${directExchange.eventOutcome || ""}`,
  /(?:^|[，。；\s])它(?:上次|留在|被留|压回|不离|还贴|还在|先留|被拖走)|把它(?:压回|收回|留在|推回)|递出的它|推来的它/,
  `direct overheard exchange should name the concrete object instead of using awkward standalone pronoun object:\n${directText}\n${directExchange.eventOutcome || ""}`,
);

assert.match(
  secondDraft.sceneText || "",
  /鹿青萝[^。！？\n]{0,80}阎无咎|阎无咎[^。！？\n]{0,80}鹿青萝/,
  `scene text should visibly stage 鹿青萝 and 阎无咎 together, got:\n${secondDraft.sceneText}`,
);

console.log("overheardMemoryCreatesDirectExchange:test passed", {
  turns: (directExchange.dialogueTurns || []).map((turn) => `${turn.speakerName}: ${turn.line}`),
  sceneText: secondDraft.sceneText,
});
