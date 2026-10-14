import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { createCharacterAgentMemoryState, encodeCharacterPerception } from "../src/engine/characterAgentMemory.js";

const LUO = "char_xyy_luozhao", XIE = "char_xyy_xiezenshi", LETTER = "luozhao_yuheng_visit_letter";
const seed = buildPlayableWorldFromSetup({ setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。", setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。" });
let primitive = "show";
const instance = createTavernWorldRuntimeV27(seed, {
  characterIds: [LUO, XIE], positions: { [LUO]: "hall", [XIE]: "hall" },
  runStage: createTavernV27FixtureStageRunner({ planForTurn: input => ({
    intention: "处理自己的拜帖", primitive, objectId: LETTER,
    targetId: ["show", "transfer"].includes(primitive) ? input.worldProjection.perceivedCharacters.find(row => row.id !== LUO)?.id : "",
    utterance: primitive === "show" ? "请过目。" : "", visibleAction: "", texture: [], privateBasis: "由本人决定如何处理拜帖。",
  }) }),
});
async function act(name) {
  await instance.runtime.enqueueWake(LUO, { wakeId: `feedback:${name}`, kind: "opportunity_window", evidenceIds: [], evidence: [] });
  return instance.runtime.runNext({ characterId: LUO });
}
try {
  const failed = await act("packed-show");
  assert.equal(failed.outcome.status, "partial");
  assert.deepEqual(failed.outcome.failedEffects.map(row => row.code), ["OBJECT_NOT_IN_HAND"]);
  const receipt = failed.outcome.deliveries.find(row => row.eventKind === "own_action_result");
  assert.match(receipt.content, /话已经说出/);
  assert.match(receipt.content, /展示未完成/);
  assert.match(receipt.content, /尚未拿在手中/);
  assert.match(receipt.content, /仍收在自己的/);
  assert.equal(receipt.recipientCharacterId, LUO);
  assert.equal(failed.outcome.deliveries.filter(row => row.eventKind === "own_action_result").length, 1);
  assert.equal(instance.coordinator.worldState.objects[LETTER].custody.inHand, false);
  const memory = encodeCharacterPerception(createCharacterAgentMemoryState(LUO), { nowSeconds: 1,
    delivery: { ...receipt, recipientId: LUO, impactId: "failed-show", evidenceId: receipt.deliveryId } });
  assert.match(memory.episodes[0].perception.content, /展示未完成/);
  assert.equal(memory.episodes[0].semanticFrame.actionResult.status, "partial");
  primitive = "take_out";
  assert.equal((await act("take-out")).outcome.status, "success");
  assert.equal(instance.coordinator.worldState.objects[LETTER].custody.inHand, true);
  primitive = "show";
  assert.equal((await act("show-in-hand")).outcome.status, "success");
  assert.equal(instance.coordinator.worldState.objects[LETTER].holderCharacterId, LUO, "showing is not transferring");
  primitive = "transfer";
  assert.equal((await act("transfer")).outcome.status, "success");
  assert.equal(instance.coordinator.worldState.objects[LETTER].holderCharacterId, XIE);
  console.log("Action feedback passed: failed packed show, separate speech receipt, owner memory, explicit take-out, display and actual transfer.");
} finally {
  for (const actor of instance.runtime.actors.values()) await actor.close();
}
