import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernWorldRuntimeV27, projectTavernSituationV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";

const XIE = "char_xyy_xiezenshi", LUO = "char_xyy_luozhao", SWORD = "xiezenshi_short_sword";
const seed = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
function plan(primitive, extra = {}) {
  return { primitive, objectId: SWORD, intention: "处理自己的短剑", visibleAction: "谢真石动了动短剑。", utterance: "", texture: [], privateBasis: "检查随身物品。", ...extra };
}
async function close(instance) { for (const actor of instance.runtime.actors.values()) await actor.close(); }
async function act(instance, characterId, suffix) {
  await instance.runtime.enqueueWake(characterId, { wakeId: `review:${suffix}`, kind: "opportunity_window", evidenceIds: [], evidence: [] });
  return instance.runtime.runNext({ characterId });
}
for (const primitive of ["draw", "hide", "place", "store", "transfer", "show", "sheathe"]) {
  const preparedSeed = structuredClone(seed);
  if (!["draw", "hide"].includes(primitive)) {
    const object = preparedSeed.tavernState.institution.objectTemplates.find(row => row.id === SWORD);
    object.attachment = { active: false, mode: "drawn", transitionRequiresExplicitOperation: true };
    object.state.sheathed = false;
    object.custody = { storageMode: "in_hand", containerId: "", inHand: true };
  }
  const instance = createTavernWorldRuntimeV27(preparedSeed, {
    characterIds: [XIE, LUO, "char_xyy_zhoumin"], positions: { [XIE]: "hall", [LUO]: "hall", char_xyy_zhoumin: "hall" },
    runStage: createTavernV27FixtureStageRunner({ planForTurn: input => plan(primitive, {
      targetId: primitive === "transfer" || primitive === "show"
        ? input.worldProjection.perceivedCharacters.find(row => row.id !== XIE)?.id : "",
    }) }),
  });
  try {
    const object = instance.coordinator.worldState.objects[SWORD];
    const before = structuredClone(object);
    const turn = await act(instance, XIE, primitive);
    assert.equal(turn.outcome.status, "success", `${primitive}: ${JSON.stringify(turn.outcome.failedEffects)}`);
    const after = instance.coordinator.worldState.objects[SWORD];
    assert.notDeepEqual(after, before, `${primitive} must settle a real object transition`);
    if (primitive === "draw") { assert.equal(after.state.sheathed, false); assert.equal(after.custody.inHand, true); }
    if (primitive === "hide" || primitive === "store") assert.equal(after.presentation.publiclyVisible, false);
    if (primitive === "store") assert.equal(after.custody.storageMode, "packed");
    if (primitive === "place") { assert.equal(after.holderCharacterId, ""); assert.equal(after.custody.storageMode, "placed"); }
    if (primitive === "transfer") assert.equal(after.holderCharacterId, LUO);
    if (primitive === "show") {
      assert.equal(after.presentation.exposure, "displayed");
      const worldState = instance.coordinator.worldState;
      for (const recipient of [LUO, "char_xyy_zhoumin"]) {
        const projection = projectTavernSituationV27({ worldState, worldVersion: 1, characterId: recipient, wake: {} });
        assert.equal(projection.perceivedObjects.some(row => row.label === "短剑"), recipient === LUO,
          "targeted display must be visible to its recipient, and private to other observers");
        for (const payload of [{ targetId: XIE }, { targetId: XIE, attentionTags: ["sword"] }, { targetId: SWORD }, {}]) {
          const outcome = await instance.coordinator.submitActionAttempt({
            attemptId: `observe:${recipient}:${JSON.stringify(payload)}`, actorId: recipient,
            expectedWorldVersion: instance.coordinator.journal.worldVersion, primitive: "observe", payload,
          });
          assert.equal(outcome.deliveries.some(row => row.eventKind === "observation_result" && row.content.includes("短剑")), recipient === LUO);
        }
      }
    }
    if (primitive === "sheathe") { assert.equal(after.state.sheathed, true); assert.equal(after.attachment.active, true); }
  } finally { await close(instance); }
}

// Failed attempts must leave real possession intact. A placed object can then
// be picked up by somebody else, without resurrecting the seed holder alias.
const physical = createTavernWorldRuntimeV27(seed, { characterIds: [XIE, LUO], runStage: createTavernV27FixtureStageRunner() });
try {
  let sequence = 0;
  const handle = (actorId, operation, extra = {}) => physical.coordinator.submitActionAttempt({
    attemptId: `review:object-boundary:${++sequence}`, actorId,
    expectedWorldVersion: physical.coordinator.journal.worldVersion,
    primitive: "handle", payload: { objectId: SWORD, operation, ...extra },
  });
  const before = physical.coordinator.worldState.objects[SWORD];
  const unsupported = await handle(XIE, "teleport");
  assert(unsupported.failedEffects.some(row => row.code === "HANDLE_OPERATION_UNSUPPORTED"));
  const unavailableHand = await handle(XIE, "transfer", { targetCharacterId: LUO });
  assert(unavailableHand.failedEffects.some(row => row.code === "OBJECT_NOT_IN_HAND"));
  assert.deepEqual(physical.coordinator.worldState.objects[SWORD], before);
  assert.equal((await handle(XIE, "draw")).status, "success");
  assert.equal((await handle(XIE, "place")).status, "success");
  assert.equal((await handle(LUO, "take_out")).status, "success");
  assert.equal(physical.coordinator.worldState.objects[SWORD].holderCharacterId, LUO);
  assert.equal((await handle(XIE, "take")).status, "failed");
  assert.equal(physical.coordinator.worldState.objects[SWORD].holderCharacterId, LUO);
} finally { await close(physical); }

for (const vocalMode of ["conversational", "call_out"]) {
  const utterance = "灶边传来的声音";
  const instance = createTavernWorldRuntimeV27(seed, {
    characterIds: [XIE, LUO], positions: { [XIE]: "stove", [LUO]: "hall" },
    runStage: createTavernV27FixtureStageRunner({ planForTurn: ({ characterId }) => characterId === XIE
      ? plan("speak", { objectId: "", utterance, vocalMode })
      : plan("listen", { objectId: "" }) }),
  });
  try {
    const spoken = await act(instance, XIE, `speak:${vocalMode}`);
    const listened = await act(instance, LUO, `listen:${vocalMode}`);
    const direct = spoken.outcome.deliveries.filter(row => row.recipientCharacterId === LUO && row.eventKind === "speech");
    const recovered = listened.outcome.deliveries.filter(row => row.eventKind === "listening_result");
    if (vocalMode === "conversational") {
      assert.equal(direct.length, 0);
      assert.equal(recovered.length, 0, "Listening must not bypass the volume/distance boundary");
      assert(listened.outcome.failedEffects.some(row => row.code === "LISTEN_NO_AUDIBLE_SIGNAL"));
    } else {
      assert.equal(direct[0]?.content, utterance);
      assert.equal(recovered[0]?.content, utterance);
    }
  } finally { await close(instance); }
}
console.log("review world object transitions and hearing contracts passed");
