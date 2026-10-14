import assert from "node:assert/strict";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";

const privateSimulations = [
  {
    characterId: "char_shen",
    characterName: "沈珩",
    targetCharacterId: "char_yan",
    targetCharacterName: "阎无咎",
    agentProfile: {
      leverageObject: "灵契",
      dialogueMoves: ["按城法扣契，不按宗门私仇。", "剑可以停，证据不能走。"],
    },
    defensiveMask: "按城法扣契，不按宗门私仇。",
    memoryLine: "沈珩和阎无咎上一轮围绕灵契留下未结清的话：“你要谁替你盖印”；结果是沈珩把灵契推向阎无咎，守门人没有盖印。",
    relationshipDialogueMemory: {
      sharedObject: "灵契",
      finalTurn: "证据不能走。",
      followupTurn: "你要谁替你盖印？",
      dialogueTurnCount: 4,
    },
  },
  {
    characterId: "char_yan",
    characterName: "阎无咎",
    targetCharacterId: "char_shen",
    targetCharacterName: "沈珩",
    agentProfile: {
      leverageObject: "魔印",
      dialogueMoves: ["我押的是灵契，不是命。", "价码到了，旧案自然开口。"],
    },
    defensiveMask: "我押的是灵契，不是命。",
    memoryLine: "阎无咎和沈珩上一轮围绕灵契留下未结清的话：“你要谁替你盖印”；结果是沈珩把灵契推向阎无咎，守门人没有盖印。",
    relationshipDialogueMemory: {
      sharedObject: "灵契",
      finalTurn: "证据不能走。",
      followupTurn: "你要谁替你盖印？",
      dialogueTurnCount: 4,
    },
  },
];

const normalized = normalizeSceneInteraction({}, privateSimulations, { perCharacter: [] });
const turns = normalized.agentExchanges[0]?.dialogueTurns || [];

assert.ok(turns.length >= 4, `new relationship dialogue memory should trigger a fourth turn, got ${turns.length}`);
assert.equal(turns[3].speakerId, "char_yan", "fourth turn should come from the responder");
assert.equal(turns[3].turnRole, "turn", "fourth turn should remain an open continuation");
assert.match(turns[3].line, /灵契|魔印|盖印|改口|还在/, "fourth turn should carry the remembered relationship object or line");
assert.ok(
  normalized.relationshipShift.some((shift) => shift.followupTurn === turns[3].line),
  "relationship shift should persist the new relationship-memory followup line",
);

const parsedThreeTurnScene = {
  agentExchanges: [
    {
      sourceCharacterId: "char_shen",
      responseCharacterId: "char_yan",
      sourceCharacterName: "沈珩",
      responseCharacterName: "阎无咎",
      sharedObject: "灵契",
      eventOutcome: "沈珩把灵契留在铜盘边，阎无咎没有拿走。",
      dialogueTurns: [
        {
          speakerId: "char_shen",
          speakerName: "沈珩",
          targetId: "char_yan",
          targetName: "阎无咎",
          line: "按城法扣契，不按宗门私仇。",
          turnRole: "claim",
        },
        {
          speakerId: "char_yan",
          speakerName: "阎无咎",
          targetId: "char_shen",
          targetName: "沈珩",
          line: "我押的是灵契，不是命。",
          turnRole: "response",
        },
        {
          speakerId: "char_shen",
          speakerName: "沈珩",
          targetId: "char_yan",
          targetName: "阎无咎",
          line: "剑可以停，证据不能走。",
          turnRole: "counter",
        },
      ],
      relationshipDeltas: [
        {
          fromCharacterId: "char_shen",
          toCharacterId: "char_yan",
          deltas: { resentment: 2 },
          misreading: "沈珩把阎无咎的回应记成拖延。",
          unspoken: "证据不能走。",
        },
      ],
      generatedFrom: "model-agent-dialogue",
    },
  ],
};

const parsedNormalized = normalizeSceneInteraction(parsedThreeTurnScene, privateSimulations, { perCharacter: [] });
const parsedTurns = parsedNormalized.agentExchanges[0]?.dialogueTurns || [];

assert.ok(parsedTurns.length >= 4, `parsed three-turn model exchange should be continued to a fourth turn, got ${parsedTurns.length}`);
assert.equal(parsedTurns[3].speakerId, "char_yan", "parsed three-turn exchange should add responder follow-up");
assert.match(parsedTurns[3].line, /灵契|盖印|还在/, "parsed fourth turn should use the remembered relationship material");

console.log("modelSceneRelationshipDialogueFollowup:test passed", {
  turns,
  parsedTurns,
});
