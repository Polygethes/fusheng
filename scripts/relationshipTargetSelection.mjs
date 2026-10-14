import assert from "node:assert/strict";
import { characterAgent } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

function neutralize(character) {
  return {
    ...character,
    currentState: {
      ...(character.currentState || {}),
      desire: 35,
      shame: 30,
      rage: 15,
      selfDeception: 30,
      revengeImpulse: 5,
      protectionImpulse: 10,
      love: 10,
    },
  };
}

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});
state.characters = state.characters.map(neutralize);
state.characterMemories = [];
state.characterPlans = [];
state.relationships = [];

const actor = state.characters.find((item) => item.id === "char_xianxia_shenheng");
const decoy = state.characters.find((item) => item.id === "char_xianxia_yanwujie");
const protectedTarget = state.characters.find((item) => item.id === "char_xianxia_luqingluo");
const activeCharacters = [actor, decoy, protectedTarget];

state.relationships = [
  {
    id: "rel_decoy_visible",
    fromCharacterId: actor.id,
    toCharacterId: decoy.id,
    attraction: 0,
    resentment: 0,
    wantsToBeSeen: 16,
    fear: 0,
    dependence: 0,
    protection: 0,
    revenge: 0,
    deception: 0,
    wantsToEscape: 0,
  },
  {
    id: "rel_protective_target",
    fromCharacterId: actor.id,
    toCharacterId: protectedTarget.id,
    attraction: 0,
    resentment: 0,
    wantsToBeSeen: 0,
    fear: 8,
    dependence: 64,
    protection: 92,
    love: 12,
    revenge: 0,
    deception: 0,
    wantsToEscape: 0,
  },
];

const output = characterAgent({
  state,
  character: actor,
  activeCharacters,
  location: state.locations.find((item) => item.id === "loc_xianxia_contract_gate"),
});

assert.equal(
  output.targetCharacterId,
  protectedTarget.id,
  "agent should target the strongest evolved relationship, including protection/dependence/fear, not only attraction/resentment/wantsToBeSeen",
);
assert.equal(output.relationshipPressure?.dominant, "protection", "selected relationship should expose its dominant protection pressure");
assert.equal(output.tone, "保护", "strong protective relationship should change the agent's action tone");

console.log("relationshipTargetSelection:test passed", {
  target: output.targetCharacterId,
  dominant: output.relationshipPressure?.dominant,
  tone: output.tone,
});
