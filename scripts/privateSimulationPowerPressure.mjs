import assert from "node:assert/strict";
import { simulatePrivateCharacter } from "../src/state/simulationLoop.js";
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

function buildState(relPatch = {}) {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
    setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
  });
  state.characters = state.characters.map(neutralize);
  state.characterMemories = [];
  state.characterPlans = [];
  state.ui.activeCharacterIds = ["char_xianxia_shenheng", "char_xianxia_yanwujie"];
  state.ui.selectedLocationId = "loc_xianxia_contract_gate";

  const actor = state.characters.find((item) => item.id === "char_xianxia_shenheng");
  const target = state.characters.find((item) => item.id === "char_xianxia_yanwujie");
  state.relationships = [
    {
      id: "rel_private_control_pressure",
      fromCharacterId: actor.id,
      toCharacterId: target.id,
      attraction: 0,
      resentment: 8,
      fear: 0,
      dependence: 0,
      protection: 0,
      revenge: 0,
      deception: 20,
      wantsToBeSeen: 0,
      wantsToEscape: 0,
      ...relPatch,
    },
  ];
  return state;
}

function run(relPatch = {}) {
  const state = buildState(relPatch);
  const actor = state.characters.find((item) => item.id === "char_xianxia_shenheng");
  const target = state.characters.find((item) => item.id === "char_xianxia_yanwujie");
  const location = state.locations.find((item) => item.id === "loc_xianxia_contract_gate");
  return simulatePrivateCharacter({
    state,
    character: actor,
    activeCharacters: [actor, target],
    location,
    visibilityLayer: { perCharacter: [] },
  });
}

function runTargetSelection() {
  const state = buildState({ power: 96 });
  const actor = state.characters.find((item) => item.id === "char_xianxia_shenheng");
  const controlTarget = state.characters.find((item) => item.id === "char_xianxia_yanwujie");
  const temptingTarget = state.characters.find((item) => item.id === "char_xianxia_luqingluo");
  state.ui.activeCharacterIds = [actor.id, controlTarget.id, temptingTarget.id];
  state.relationships.push({
    id: "rel_private_attraction_decoy",
    fromCharacterId: actor.id,
    toCharacterId: temptingTarget.id,
    attraction: 74,
    resentment: 0,
    fear: 0,
    dependence: 0,
    protection: 0,
    revenge: 0,
    deception: 0,
    wantsToBeSeen: 46,
    wantsToEscape: 0,
    power: 0,
  });
  const location = state.locations.find((item) => item.id === "loc_xianxia_contract_gate");
  return simulatePrivateCharacter({
    state,
    character: actor,
    activeCharacters: [actor, controlTarget, temptingTarget],
    location,
    visibilityLayer: { perCharacter: [] },
  });
}

const baseline = run({ power: 0 });
const controlling = run({ power: 96 });
const selected = runTargetSelection();

assert.ok(
  ["伪装", "陷害"].includes(controlling.tone),
  `power-heavy relationship should push private simulation toward control, got ${controlling.tone}`,
);
assert.match(
  [
    controlling.whatTheyRefuseToAdmit,
    controlling.memoryTension,
    controlling.actionCandidate,
    controlling.planTension,
  ].join(" "),
  /解释权|控制|规矩|命名/,
  "private simulation should carry control/explanation pressure into the next action context",
);
assert.ok(
  controlling.contradictionScore > baseline.contradictionScore,
  `control pressure should increase contradiction score, baseline=${baseline.contradictionScore}, controlling=${controlling.contradictionScore}`,
);
assert.equal(
  selected.targetCharacterId,
  "char_xianxia_yanwujie",
  `power-heavy relationship should win private target selection, got ${selected.targetCharacterName}`,
);
assert.match(
  selected.planTension,
  /阎无咎/,
  "private plan context should follow the same power-selected target",
);

console.log("privateSimulationPowerPressure:test passed", {
  baselineTone: baseline.tone,
  controllingTone: controlling.tone,
  baselineScore: baseline.contradictionScore,
  controllingScore: controlling.contradictionScore,
  selectedTarget: selected.targetCharacterName,
});
