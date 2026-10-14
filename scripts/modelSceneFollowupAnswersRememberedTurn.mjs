import assert from "node:assert/strict";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";

const rememberedTurn = "你要谁替你盖印？";

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
    memorySource: "agent_dialogue_relationship",
    relationshipDialogueMemory: {
      sharedObject: "灵契",
      finalTurn: "证据不能走。",
      followupTurn: rememberedTurn,
      dialogueTurnCount: 4,
    },
  },
  {
    characterId: "char_yan",
    characterName: "阎无咎",
    targetCharacterId: "char_shen",
    targetCharacterName: "沈珩",
    tone: "伪装",
    agentProfile: {
      leverageObject: "魔印",
      dialogueMoves: ["我押的是灵契，不是命。", "价码到了，旧案自然开口。"],
    },
    defensiveMask: "我押的是灵契，不是命。",
    memorySource: "agent_dialogue_relationship",
    relationshipDialogueMemory: {
      sharedObject: "灵契",
      finalTurn: "证据不能走。",
      followupTurn: rememberedTurn,
      dialogueTurnCount: 4,
    },
  },
];

const normalized = normalizeSceneInteraction({}, privateSimulations, { perCharacter: [] });
const exchange = normalized.agentExchanges[0] || {};
const fourthTurn = exchange.dialogueTurns?.[3]?.line || "";
const responderShift = normalized.relationshipShift.find((shift) =>
  shift.fromCharacterId === "char_yan" && shift.toCharacterId === "char_shen"
);

assert.ok(fourthTurn, "relationship memory should create a fourth turn");
assert.doesNotMatch(
  fourthTurn,
  /你要谁替你盖印/,
  "fourth turn should answer the remembered question instead of repeating it verbatim",
);
assert.match(
  fourthTurn,
  /灵契|盖印|铜盘|界石|印|契/,
  "fourth turn should still use the remembered object or rule pressure",
);
assert.match(
  exchange.eventOutcome || "",
  /界石|盖印|铜盘|灵契/,
  "event outcome should turn the fourth response into a concrete changed scene state",
);
assert.doesNotMatch(
  exchange.eventOutcome || "",
  /没有按原来的方向接走它/,
  "event outcome should not remain a generic placeholder after a concrete fourth response",
);
assert.ok(
  Number(responderShift?.deltas?.power || 0) >= 2,
  "responder should gain relationship power by moving the dispute to the boundary rule",
);
assert.match(
  responderShift?.misreading || "",
  /界石|盖印|铜盘/,
  "relationship misreading should name the concrete rule object changed by the fourth response",
);

console.log("modelSceneFollowupAnswersRememberedTurn:test passed", {
  fourthTurn,
  eventOutcome: exchange.eventOutcome,
  responderShift,
});
