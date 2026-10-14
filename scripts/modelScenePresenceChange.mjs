import assert from "node:assert/strict";
import { buildSceneInteractionUserPrompt, normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";

const compact = {
  selectedLocation: { id: "hall", name: "法契门" },
  availableLocations: [{ id: "hall", name: "法契门" }, { id: "alley", name: "后巷" }],
  activeCharacters: [
    { id: "shen", name: "沈珩" },
    { id: "yan", name: "阎无咎" },
    { id: "lu", name: "鹿青萝" },
  ],
  relationships: [{ fromCharacterId: "yan", toCharacterId: "shen", fear: 82, wantsToEscape: 88 }],
};
const simulations = [
  { characterId: "shen", characterName: "沈珩", targetCharacterId: "yan", targetCharacterName: "阎无咎", pressure: 58, presenceIntent: "stay", exitUrgency: 12, exitResistance: 70 },
  { characterId: "yan", characterName: "阎无咎", targetCharacterId: "shen", targetCharacterName: "沈珩", pressure: 92, tone: "撤退", presenceIntent: "leave", exitUrgency: 94, exitResistance: 20, exitTrigger: "沈珩说出证人的真名。", exitReason: "魔印将被照见。", desiredDestinationId: "alley" },
  { characterId: "lu", characterName: "鹿青萝", targetCharacterId: "yan", targetCharacterName: "阎无咎", pressure: 64, presenceIntent: "stay", exitUrgency: 24, exitResistance: 68 },
];
const parsed = {
  surfaceEvent: "证人的真名落在铜盘上。",
  sceneText: "阎无咎退向后巷。",
  interactionBeats: [],
  agentExchanges: [{
    sourceCharacterId: "shen",
    sourceCharacterName: "沈珩",
    responseCharacterId: "yan",
    responseCharacterName: "阎无咎",
    sharedObject: "魔印",
    dialogueTurns: [
      { speakerId: "shen", speakerName: "沈珩", targetId: "yan", targetName: "阎无咎", line: "证人叫闻夏。", turnRole: "claim" },
      { speakerId: "yan", speakerName: "阎无咎", targetId: "shen", targetName: "沈珩", line: "你认错人了。", turnRole: "response" },
      { speakerId: "lu", speakerName: "鹿青萝", targetId: "yan", targetName: "阎无咎", line: "你的手在抖。", turnRole: "counter" },
      { speakerId: "yan", speakerName: "阎无咎", targetId: "lu", targetName: "鹿青萝", line: "我还会回来。", turnRole: "turn" },
    ],
    eventOutcome: "阎无咎推门离开。",
    relationshipDeltas: [],
  }],
  presenceChanges: [{
    characterId: "yan",
    characterName: "阎无咎",
    decision: "leave",
    departureAfterTurn: 2,
    destinationId: "alley",
    destinationName: "后巷",
    trigger: "沈珩说出证人的真名。",
    visibleDeparture: "阎无咎撞开侧门，退进后巷。",
  }],
  remainingCastAftermath: [{
    characterIds: ["shen", "lu"],
    beat: "侧门合上后，鹿青萝把魔印推回沈珩面前。",
    dialogue: "鹿青萝说：“现在轮到你解释名字从哪里来。”",
  }],
};

const normalized = normalizeSceneInteraction(parsed, simulations, { perCharacter: [] }, compact);
assert.equal(normalized.presenceChanges[0].decision, "leave");
assert.equal(normalized.presenceChanges[0].destinationId, "alley");
assert.deepEqual(normalized.presentAtEndIds.sort(), ["lu", "shen"]);
assert.ok(!normalized.agentExchanges[0].dialogueTurns.some((turn) => turn.line === "我还会回来。"), "a departed agent cannot speak after its departure turn");
assert.match(normalized.remainingCastAftermath[0].beat, /鹿青萝把魔印推回沈珩/);
assert.ok(!normalized.remainingCastAftermath[0].dialogue.includes("阎无咎说"), "aftermath belongs to the remaining cast");
assert.match(normalized.sceneText, /撞开侧门/, "the public scene fallback must visibly include the departure");
assert.match(normalized.sceneText, /鹿青萝把魔印推回沈珩/, "the public scene fallback must continue with those left behind");
const prompt = buildSceneInteractionUserPrompt({ compact, privateSimulations: simulations, visibilityLayer: { perCharacter: [] } });
assert.match(prompt, /离场/, "the shared scene model must be told to stage executable departures");
assert.match(prompt, /离开后/, "the shared scene model must continue with the remaining cast");
assert.match(prompt, /后巷/, "the model must see valid destinations");

console.log("modelScenePresenceChange:test passed", {
  presentAtEndIds: normalized.presentAtEndIds,
  turns: normalized.agentExchanges[0].dialogueTurns.length,
});
