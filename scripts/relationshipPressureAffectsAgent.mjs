import assert from "node:assert/strict";
import { characterAgent } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

function neutralize(character) {
  return {
    ...character,
    currentState: {
      ...(character.currentState || {}),
      desire: 45,
      shame: 35,
      rage: 25,
      selfDeception: 35,
      revengeImpulse: 10,
      protectionImpulse: 20,
      love: 20,
    },
  };
}

function baseState() {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
    setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
  });
  state.characters = state.characters.map(neutralize);
  state.characterMemories = [];
  state.characterPlans = [];
  state.ui.activeCharacterIds = ["char_xianxia_shenheng", "char_xianxia_yanwujie"];
  state.ui.selectedLocationId = "loc_xianxia_contract_gate";
  return state;
}

function runWithRelationship(relPatch) {
  const state = baseState();
  const actor = state.characters.find((item) => item.id === "char_xianxia_shenheng");
  const target = state.characters.find((item) => item.id === "char_xianxia_yanwujie");
  state.relationships = [
    {
      id: "rel_test_pressure",
      fromCharacterId: actor.id,
      toCharacterId: target.id,
      attraction: 0,
      resentment: 0,
      fear: 0,
      dependence: 0,
      protection: 0,
      revenge: 0,
      deception: 0,
      wantsToBeSeen: 0,
      wantsToEscape: 0,
      ...relPatch,
    },
  ];
  return characterAgent({
    state,
    character: actor,
    activeCharacters: [actor, target],
    location: state.locations.find((item) => item.id === "loc_xianxia_contract_gate"),
  });
}

const hostile = runWithRelationship({ resentment: 85, revenge: 72, fear: 18 });
assert.ok(["惩罚", "陷害"].includes(hostile.tone), `hostile relationship should push punitive action, got ${hostile.tone}`);
assert.ok(hostile.relationshipPressure?.dominant === "hostility", "hostile output should preserve relationship pressure profile");
assert.match(hostile.desireReason, /怨|报复|清算|关系/, "hidden action should mention relationship pressure, not just generic inner state");

const protective = runWithRelationship({ protection: 88, dependence: 58, resentment: 5 });
assert.equal(protective.tone, "保护", `protective relationship should push protective action, got ${protective.tone}`);
assert.ok(protective.relationshipPressure?.dominant === "protection", "protective output should preserve relationship pressure profile");

const avoidant = runWithRelationship({ fear: 82, wantsToEscape: 78, deception: 50 });
assert.ok(["伪装", "撤退"].includes(avoidant.tone), `avoidant relationship should push concealment/withdrawal, got ${avoidant.tone}`);
assert.ok(avoidant.relationshipPressure?.dominant === "avoidance", "avoidant output should preserve relationship pressure profile");

const controlling = runWithRelationship({ power: 96, deception: 20, resentment: 8 });
assert.ok(["伪装", "陷害"].includes(controlling.tone), `control relationship should push rule/explanation control, got ${controlling.tone}`);
assert.ok(controlling.relationshipPressure?.dominant === "control", "power-heavy relationship should preserve control pressure profile");
assert.match(
  `${controlling.relationshipPressureSummary || ""} ${controlling.desireReason || ""}`,
  /解释权|控制|规矩|命名/,
  "control pressure should be visible to the next agent decision",
);

console.log("relationshipPressureAffectsAgent:test passed", {
  hostile: hostile.tone,
  protective: protective.tone,
  avoidant: avoidant.tone,
  controlling: controlling.tone,
});
