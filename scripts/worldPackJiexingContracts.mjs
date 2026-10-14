import assert from "node:assert/strict";
import jiexing from "../src/worlds/jiexing/pack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { captureFirstStage } from "../src/worlds/worldSmoke.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { getTavernEcologyProfile } from "../src/server/ecology/tavernEcologyProfile.mjs";
import { validateWorldPack } from "../src/worlds/validateWorldPack.mjs";

assert.deepEqual(validateWorldPack(jiexing).issues, []);
const state = buildPlayableWorldFromPack(jiexing);
assert.equal(state.characters.length, 5);
for (const character of state.characters) {
  assert.equal(getTavernEcologyProfile(character), character.ecologyProfile, `${character.name} uses the pack-authored profile`);
  assert.ok(character.agentMemory.episodes.length >= 3, `${character.name} remembers last night`);
}

const instance = createWorldRuntimeV27(state, { worldPack: jiexing, pacingMode: "scene" });
const world = instance.coordinator.worldState;
assert.deepEqual(Object.fromEntries(Object.values(world.entities).map((row) => [row.id, row.zoneId])), { ...jiexing.stage.scenePositions });
assert.equal(world.places.loc_jx_gu_home.name, "藏星谷 · 顾家");
assert.equal(world.objects.jx_guide_talisman.holderCharacterId, "char_jx_guhuaishan");
assert.equal(world.objects.jx_guide_talisman.presentation.exposure, "hidden");
assert.deepEqual(world.entities.char_jx_guxiaoman.skills, ["sword_affinity", "flight", "star_pulling"]);
assert.equal(world.entities.char_jx_abao.skills, undefined, "a person without skills carries no skills field");
for (const actor of instance.runtime.actors.values()) await actor.close?.();

const stageText = async (id) => JSON.stringify((await captureFirstStage(jiexing, state, id, false)).captured.input);
const xiaoman = await stageText("char_jx_guxiaoman");
const huaishan = await stageText("char_jx_guhuaishan");
assert.ok(huaishan.includes("辰时前从石桥动身去归云岭"), "the father knows the departure time");
assert.ok(!xiaoman.includes("辰时前从石桥动身去归云岭"), "小满 does not know the departure has been arranged");
assert.ok(!xiaoman.includes("青色接引符"), "the renewed token in his father's sleeve is unseen");
assert.ok(xiaoman.includes("scene:jx:gu-home:departure-morning"), "the stage identifies the 借星 scene, not the tavern");
assert.ok(!xiaoman.includes("望梯酒馆") && !huaishan.includes("望梯酒馆"), "no tavern name leaks into 借星 prompts");

console.log("借星 world pack passed: authored profiles and memories load; private arrangements and hidden objects stay private.");
