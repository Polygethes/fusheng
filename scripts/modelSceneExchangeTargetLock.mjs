import assert from "node:assert/strict";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";

const privateSimulations = [
  {
    characterId: "char_a",
    characterName: "沈珩",
    targetCharacterId: "char_c",
    targetCharacterName: "鹿青萝",
    defensiveMask: "庇护牌先留在场中。",
    agentProfile: { leverageObject: "灵契", dialogueMoves: ["灵契先留下。", "证据不能走。"] },
  },
  {
    characterId: "char_b",
    characterName: "阎无咎",
    targetCharacterId: "char_a",
    targetCharacterName: "沈珩",
    defensiveMask: "我押的是灵契，不是命。",
    agentProfile: { leverageObject: "魔印", dialogueMoves: ["我押的是灵契，不是命。"] },
  },
  {
    characterId: "char_c",
    characterName: "鹿青萝",
    targetCharacterId: "char_a",
    targetCharacterName: "沈珩",
    defensiveMask: "药炉前不问正邪。",
    agentProfile: { leverageObject: "庇护牌", dialogueMoves: ["药炉前不问正邪。"] },
  },
];

const parsed = {
  agentExchanges: [
    {
      sourceCharacterId: "char_a",
      responseCharacterId: "char_b",
      sourceCharacterName: "沈珩",
      responseCharacterName: "阎无咎",
      sharedObject: "灵契",
      eventOutcome: "沈珩把灵契推向阎无咎。",
      dialogueTurns: [
        {
          speakerId: "char_a",
          speakerName: "沈珩",
          targetId: "char_b",
          targetName: "阎无咎",
          line: "灵契先留下。",
          turnRole: "claim",
        },
        {
          speakerId: "char_b",
          speakerName: "阎无咎",
          targetId: "char_a",
          targetName: "沈珩",
          line: "我押的是灵契，不是命。",
          turnRole: "response",
        },
      ],
      relationshipDeltas: [
        {
          fromCharacterId: "char_a",
          toCharacterId: "char_b",
          deltas: { wantsToBeSeen: 2 },
          misreading: "沈珩误把阎无咎的回应当成挑战。",
          unspoken: "错目标。",
        },
      ],
      generatedFrom: "model-agent-dialogue",
    },
  ],
  relationshipShift: [
    {
      fromCharacterId: "char_a",
      toCharacterId: "char_b",
      deltas: { resentment: 9 },
      misreading: "顶层关系变化仍把阎无咎写成目标。",
      unspoken: "这会污染没有发生的关系。",
    },
  ],
};

const normalized = normalizeSceneInteraction(parsed, privateSimulations, { perCharacter: [] });
const exchange = normalized.agentExchanges[0];

assert.equal(exchange.responseCharacterId, "char_c", "scene exchange should keep the private simulation's locked target");
assert.equal(exchange.responseCharacterName, "鹿青萝", "scene exchange response name should match the locked target");
assert.match(exchange.eventOutcome, /鹿青萝/, "event outcome should be retargeted to the locked character");
assert.doesNotMatch(exchange.eventOutcome, /阎无咎/, "event outcome should not keep the stale model target name");
assert.equal(exchange.dialogueTurns[0].targetId, "char_c", "claim turn should target the locked character");
assert.equal(exchange.dialogueTurns[1].speakerId, "char_c", "response turn should come from the locked character");
assert.ok(
  normalized.relationshipShift.every((shift) => shift.toCharacterId !== "char_b" && shift.fromCharacterId !== "char_b"),
  "model relationship shifts should not preserve stale model exchange target ids",
);
assert.ok(
  normalized.relationshipShift.some((shift) => shift.fromCharacterId === "char_a" && shift.toCharacterId === "char_c"),
  "model relationship shifts should point at the locked exchange pair",
);

console.log("modelSceneExchangeTargetLock:test passed", {
  responseCharacterId: exchange.responseCharacterId,
  turns: exchange.dialogueTurns,
  shifts: normalized.relationshipShift,
});
