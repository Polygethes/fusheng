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
const { playNext } = await import("../src/engine/playService.js");

resetState();
applySetupWorld({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修沈珩、邪派血河楼使者阎无咎、鹿妖医鹿青萝。",
});

const state = getState();
const shen = state.characters.find((character) => character.name === "沈珩");
const yan = state.characters.find((character) => character.name === "阎无咎");
const gate = state.locations.find((location) => location.id === "loc_xianxia_contract_gate" || /法契|契门|界石/.test(location.name || ""));
assert.ok(shen && yan && gate, "fixture should expose 沈珩、阎无咎 and contract gate");

setUi({
  engineMode: "local",
  timeGrain: "scene",
  focusMode: "location",
  selectedLocationId: gate.id,
  activeCharacterIds: [shen.id, yan.id],
  activeTab: "observe",
});

const rememberedDialogue = {
  source: "agent-dialogue-relationship",
  relationshipSource: "agent-exchange",
  sharedObject: "灵契",
  locationId: gate.id,
  locationName: gate.name,
  eventOutcome: "沈珩把价码和旧案分开说到界石面前，阎无咎没能把话收回暗账。",
  finalTurn: "价码和旧案分开说。",
  followupTurn: "暗账没能收回，下一句就不能再按买卖说。",
  dialogueTurnCount: 4,
  relationshipDialogueAct: {
    kind: "bargain",
    reason: "阎无咎把旧案推成价码，沈珩把暗账推到界石面前。",
  },
  dialogueTurns: [
    { speakerId: shen.id, speakerName: shen.name, targetId: yan.id, targetName: yan.name, line: "灵契压在铜盘，旧案的价不能替证据收场。", turnRole: "claim" },
    { speakerId: yan.id, speakerName: yan.name, targetId: shen.id, targetName: shen.name, line: "你把价码和旧案分开说，血河楼就只剩暗账。", turnRole: "response" },
    { speakerId: shen.id, speakerName: shen.name, targetId: yan.id, targetName: yan.name, line: "那就让暗账也照一次界石。", turnRole: "counter" },
    { speakerId: yan.id, speakerName: yan.name, targetId: shen.id, targetName: shen.name, line: "暗账没能收回，下一句就不能再按买卖说。", turnRole: "turn" },
  ],
};

const preparedState = getState();
preparedState.relationships = preparedState.relationships.map((relationship) => {
  if (
    (relationship.fromCharacterId === shen.id && relationship.toCharacterId === yan.id)
    || (relationship.fromCharacterId === yan.id && relationship.toCharacterId === shen.id)
  ) {
    return {
      ...relationship,
      deception: Math.max(Number(relationship.deception || 0), 45),
      power: Math.max(Number(relationship.power || 0), 45),
      lastDialogue: rememberedDialogue,
      dialogueHistory: [rememberedDialogue, rememberedDialogue],
    };
  }
  return relationship;
});

const second = await playNext(preparedState);
const shenAction = second.agentOutputs?.find((output) => output.characterId === shen.id)?.visibleAction || "";
const yanAction = second.agentOutputs?.find((output) => output.characterId === yan.id)?.visibleAction || "";

assert.match(
  `${shenAction}\n${yanAction}`,
  /暗账|旧案|价码/,
  "second local play should carry the prior unresolved bargain/dark-ledger outcome",
);
assert.doesNotMatch(
  shenAction,
  /暗账没能被沈珩收回/,
  `outcome tail should not assign Yan's failed dark-ledger recovery to Shen, got:\n${shenAction}`,
);
assert.doesNotMatch(
  yanAction,
  /暗账没能被沈珩收回/,
  `Yan action should not describe Shen as the failed dark-ledger owner, got:\n${yanAction}`,
);

console.log("localTheaterOutcomeBelongsToActor:test passed", {
  shenAction,
  yanAction,
});
