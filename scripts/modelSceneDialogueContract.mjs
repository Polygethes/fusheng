import assert from "node:assert/strict";
import { sceneInteractionSchema } from "../src/server/pipeline/schemas.mjs";
import * as sceneModule from "../src/server/pipeline/sceneInteractionSimulator.mjs";

assert.ok(
  sceneInteractionSchema.required.includes("agentExchanges"),
  "model scene interaction schema should require structured agent exchanges",
);

assert.ok(
  sceneInteractionSchema.properties.agentExchanges?.items?.properties?.dialogueTurns,
  "agent exchanges should include explicit dialogue turns",
);

assert.equal(
  typeof sceneModule.normalizeSceneInteraction,
  "function",
  "scene interaction normalization should be testable without API calls",
);

const privateSimulations = [
  {
    characterId: "char_shen",
    characterName: "沈珩",
    targetCharacterId: "char_yan",
    targetCharacterName: "阎无咎",
    agentProfile: {
      leverageObject: "灵契",
      dialogueMoves: ["按城法扣契，不按宗门私仇。", "剑可以停，证据不能走。"],
      dramaticObjective: "扣押邪派证人。",
    },
    publicGoal: "验契并扣住灵契。",
    privateDesire: "逼阎无咎交出旧案证物。",
    defensiveMask: "按城法扣契，不按宗门私仇。",
    shadowImpulse: "借城法留下人。",
  },
  {
    characterId: "char_yan",
    characterName: "阎无咎",
    targetCharacterId: "char_shen",
    targetCharacterName: "沈珩",
    agentProfile: {
      leverageObject: "魔印",
      dialogueMoves: ["我押的是灵契，不是命。", "价码到了，旧案自然开口。"],
      dramaticObjective: "带走翻案证物。",
    },
    publicGoal: "换符并试价。",
    privateDesire: "带走能让血河楼翻案的证物。",
    defensiveMask: "我押的是灵契，不是命。",
    shadowImpulse: "把证据从正道审判里挪走。",
  },
];

const normalized = sceneModule.normalizeSceneInteraction({}, privateSimulations, { perCharacter: [] });
const exchange = normalized.agentExchanges?.[0];

assert.ok(exchange, "normalization should create a fallback agent exchange");
assert.ok(exchange.dialogueTurns?.length >= 3, "fallback model exchange should include A -> B -> A dialogue turns");
assert.ok(exchange.dialogueTurns.some((turn) => turn.speakerId === "char_shen"), "dialogue should include the initiating agent");
assert.ok(exchange.dialogueTurns.some((turn) => turn.speakerId === "char_yan"), "dialogue should include the responding agent");
assert.match(exchange.dialogueTurns.map((turn) => turn.line).join("\n"), /灵契|魔印|城法|旧案/, "dialogue should use concrete agent-profile objects and motives");
assert.ok(exchange.relationshipDeltas?.length >= 2, "exchange should carry relationship deltas derived from dialogue");
assert.ok(normalized.agentRelationshipShifts?.length >= 2, "normalized scene should expose dialogue-derived relationship shifts");
assert.ok(normalized.relationshipShift?.some((shift) => shift.generatedFrom === "model-agent-dialogue"), "relationshipShift should include model dialogue-derived shifts");

console.log("modelSceneDialogueContract:test passed", {
  turns: exchange.dialogueTurns,
  shifts: normalized.agentRelationshipShifts.length,
});
