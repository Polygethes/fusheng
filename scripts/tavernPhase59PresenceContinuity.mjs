import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  prepareTavernCausalSlot,
  TAVERN_CAUSAL_DAY_SLOTS,
} from "../src/server/pipeline/tavernCausalEconomy.mjs";
import { buildTavernSceneRuntime } from "../src/server/pipeline/tavernCausalScene.mjs";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const father = state.characters.find((character) => character.id === "char_xyy_xieheng");
const son = state.characters.find((character) => character.id === "char_xyy_xiezenshi");

father.lifeState.present = false;
father.currentLocationId = "loc_market_warehouse";
father.ecologyState = {
  ...(father.ecologyState || {}),
  presence: {
    ...(father.ecologyState?.presence || {}),
    locationId: "loc_market_warehouse",
    zoneId: "loading_yard",
    observableAtStage: false,
  },
};
son.lifeState.present = true;
son.currentLocationId = "loc_xyy_tavern";

const dawn = TAVERN_CAUSAL_DAY_SLOTS.find((slot) => slot.id === "dawn");
const dawnPrepared = prepareTavernCausalSlot(state, { day: 1, slot: dawn });
const dawnFather = dawnPrepared.state.characters.find((character) => character.id === father.id);
assert.equal(dawnFather.lifeState.present, false, "a morning schedule must not teleport an offstage resident back into the scene");
assert.equal(dawnFather.currentLocationId, "loc_market_warehouse");
assert.ok(!dawnPrepared.characterIds.includes(father.id));

const afternoon = TAVERN_CAUSAL_DAY_SLOTS.find((slot) => slot.id === "afternoon");
const afternoonPrepared = prepareTavernCausalSlot(state, { day: 1, slot: afternoon });
const afternoonSon = afternoonPrepared.state.characters.find((character) => character.id === son.id);
assert.equal(afternoonSon.lifeState.present, true, "a resident must not vanish merely because the next slot is absent from a schedule hint");
assert.ok(afternoonPrepared.characterIds.includes(son.id));

const defaultRuntime = buildTavernSceneRuntime(dawnPrepared.state);
assert.ok(!defaultRuntime.activeCharacterIds.includes(father.id), "default scene assembly must use committed presence, not a core-cast whitelist");

console.log("tavernPhase59PresenceContinuity:test passed", {
  absentResident: father.id,
  continuousResident: son.id,
  activeAtDawn: dawnPrepared.characterIds,
});
