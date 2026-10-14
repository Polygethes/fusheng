import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修沈珩、邪派血河楼使者阎无咎、鹿妖医鹿青萝。",
});

const shen = state.characters.find((character) => character.name === "沈珩");
const yan = state.characters.find((character) => character.name === "阎无咎");
const gate = state.locations.find((location) => /法契|契门/.test(location.name)) || state.locations[0];
assert.ok(shen && yan && gate, "test setup needs 沈珩, 阎无咎 and a contract gate");

const rememberedDialogue = {
  source: "agent-dialogue-relationship",
  relationshipSource: "agent-exchange",
  sharedObject: "灵契",
  locationId: gate.id,
  locationName: gate.name,
  eventOutcome: "沈珩把旧案的价说到界石面前，阎无咎没能把话收回暗账。",
  finalTurn: "旧案的价不能替证据收场；价码和旧案分开说。",
  followupTurn: "暗账没能收回，下一句就不能再按买卖说。",
  dialogueTurnCount: 4,
  relationshipDialogueAct: {
    kind: "bargain",
    reason: "阎无咎试图把旧案改成价码，沈珩把暗账推到界石面前。",
  },
  dialogueTurns: [
    { speakerId: shen.id, speakerName: shen.name, targetId: yan.id, targetName: yan.name, line: "灵契压在铜盘，旧案的价不能替证据收场。", turnRole: "claim" },
    { speakerId: yan.id, speakerName: yan.name, targetId: shen.id, targetName: shen.name, line: "你把价码和旧案分开说，血河楼就只剩暗账。", turnRole: "response" },
    { speakerId: shen.id, speakerName: shen.name, targetId: yan.id, targetName: yan.name, line: "那就让暗账也照一次界石。", turnRole: "counter" },
    { speakerId: yan.id, speakerName: yan.name, targetId: shen.id, targetName: shen.name, line: "暗账没能收回，下一句就不能再按买卖说。", turnRole: "turn" },
  ],
};

state.relationships = state.relationships.map((relationship) => {
  if (
    (relationship.fromCharacterId === shen.id && relationship.toCharacterId === yan.id)
    || (relationship.fromCharacterId === yan.id && relationship.toCharacterId === shen.id)
  ) {
    return {
      ...relationship,
      resentment: Math.max(Number(relationship.resentment || 0), 40),
      deception: Math.max(Number(relationship.deception || 0), 45),
      power: Math.max(Number(relationship.power || 0), 45),
      lastDialogue: rememberedDialogue,
      dialogueHistory: [rememberedDialogue, rememberedDialogue],
    };
  }
  return relationship;
});

state.ui.timeGrain = "scene";
state.ui.focusMode = "focused";
state.ui.selectedLocationId = gate.id;
state.ui.activeCharacterIds = [shen.id, yan.id];

const draft = playNext(state);
const lines = (draft.sceneInteraction?.agentExchanges || [])
  .flatMap((exchange) => exchange.dialogueTurns || [])
  .map((turn) => turn.line || "")
  .filter(Boolean);

assert.ok(lines.length >= 4, "scene should produce a dialogue exchange");
assert.ok(
  lines.some((line) => /暗账|没能收回/.test(line)),
  `relationship memory should surface the specific remembered consequence, got:\n${lines.join("\n")}`,
);
assert.doesNotMatch(
  lines.join("\n"),
  /(?:^|[。！？；])它(?:压进|压在|还在|没有离开|不离|不能|也不会)/,
  `remembered-object dialogue should name the concrete object instead of using a vague pronoun:\n${lines.join("\n")}`,
);

console.log("relationshipMemorySpecificConsequenceDialogue:test passed", {
  lines,
});
