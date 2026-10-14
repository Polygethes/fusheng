import assert from "node:assert/strict";
import { createWorldActionRegistry } from "../src/server/simulation/worldActionRegistry.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { renderBodyActions } from "../src/server/simulation/physicalExpression.mjs";

// Minimized from Luna turn 7: the accepted listen carried this literal body
// expression, yet only the actor received a listening result.
const bodyActions = [{ kind: "turn_head", direction: "left", amplitude: "small", speed: "normal" }];
const body = renderBodyActions(bodyActions);
const character = (id, zoneId, placeId = "tavern") => ({ id, kind: "character", present: true, placeId, zoneId });
const state = {
  nowSeconds: 1,
  entities: { xie: character("xie", "yard"), zhou: character("zhou", "yard"),
    luo: character("luo", "hall"), hidden: character("hidden", "room"),
    elsewhere: character("elsewhere", "yard", "elsewhere") },
  places: { tavern: { topology: { zones: { yard: {}, hall: {}, room: {} }, edges: [
    { from: "yard", to: "hall", visual: 1, sound: 1 },
    { from: "yard", to: "room", visual: 0, sound: 1 },
  ] } } },
  signals: [{ signalId: "call", kind: "speech", modality: "sound", sourceCharacterId: "zhou",
    placeId: "tavern", zoneId: "yard", emittedAtSeconds: 0, audibleUntilSeconds: 10, utterance: "真石兄，等我一下。" }],
};
const registry = createWorldActionRegistry();
const settle = (primitive, payload = {}, world = state) => registry.settle({ state: world,
  attempt: { attemptId: `attention:${primitive}`, actorId: "xie", primitive,
    payload: { targetId: "zhou", targetKind: "character", visibleAction: "动作草稿不公开", bodyActions, ...payload } } });
for (const primitive of ["listen", "observe"]) {
  const result = await settle(primitive);
  const visual = result.deliveries.filter(row => row.modality === "visual" && row.recipientCharacterId !== "xie");
  assert.deepEqual(visual.map(row => row.recipientCharacterId).sort(), ["luo", "zhou"],
    `${primitive}: deliver the authored body through sight routes only`);
  assert.ok(visual.every(row => row.content === body));
  assert.ok(result.committedFacts.some(row => row.visibleAction === body));
  assert.equal(result.primitive, primitive, "the Character's selected attention action remains primary");
  const silent = await settle(primitive, { visibleAction: "", bodyActions: [] });
  assert.ok(!silent.deliveries.some(row => row.recipientCharacterId !== "xie"), "private attention invents no public gesture");
  const failed = await settle(primitive, { targetId: "missing" });
  assert.ok(!failed.deliveries.some(row => row.recipientCharacterId !== "xie"), "a rejected attention attempt does not emit an assumed body result");
  const absent = structuredClone(state); absent.entities.xie.present = false;
  assert.equal((await settle(primitive, {}, absent)).deliveries.length, 0);
}
const quiet = structuredClone(state); quiet.signals = [];
const noSound = await settle("listen", {}, quiet);
assert.equal(noSound.status, "partial");
assert.equal(noSound.deliveries.filter(row => row.content === body).length, 2, "not hearing a sound does not erase a real turn of the face");
const gesture = await settle("gesture");
assert.equal(gesture.deliveries.filter(row => row.content === body).length, 2, "existing gesture delivery is not duplicated");
const speaking = await settle("listen", { utterance: "我在听。" });
assert.equal(speaking.deliveries.filter(row => row.modality === "visual" && row.content === body).length, 2);
assert.ok(speaking.resolvedEffects.some(row => row.kind === "speech_emitted"));
assert.ok(!speaking.deliveries.some(row => row.recipientCharacterId === "hidden" && row.modality === "visual"));

// Verify the production bridge, coordinator and recipient actor inbox as well.
const XIE = "char_xyy_xiezenshi", ZHOU = "char_xyy_zhoumin";
const seed = buildPlayableWorldFromSetup({ setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。", setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。" });
const instance = createTavernWorldRuntimeV27(seed, { characterIds: [XIE, ZHOU], positions: { [XIE]: "hall", [ZHOU]: "hall" },
  runStage: createTavernV27FixtureStageRunner({ planForTurn: input => ({
    intention: "先听清周珉的来意", primitive: "listen",
    targetId: input.worldProjection.perceivedCharacters.find(row => row.id !== XIE)?.id,
    visibleAction: "动作草稿不公开", bodyActions, utterance: "", texture: [], privateBasis: "本人决定先听。",
  }) }),
});
try {
  await instance.runtime.enqueueWake(XIE, { wakeId: "attention:full-chain", kind: "opportunity_window", evidenceIds: [], evidence: [] });
  const result = await instance.runtime.runNext({ characterId: XIE });
  const delivery = result.outcome.deliveries.find(row => row.recipientCharacterId === ZHOU && row.modality === "visual");
  assert.equal(delivery?.content, body, "the body must survive the real Character-to-world bridge");
  const checkpoint = await instance.runtime.checkpoint();
  assert.ok(JSON.stringify(checkpoint.actors.find(row => row.characterId === ZHOU)).includes(body), "the recipient actor must actually receive the body evidence");
} finally {
  for (const actor of instance.runtime.actors.values()) await actor.close();
}
console.log("Attention expression contracts passed: exact authored body, visible recipients, quiet listening, absent/failed guards, no invented or duplicate gesture.");
