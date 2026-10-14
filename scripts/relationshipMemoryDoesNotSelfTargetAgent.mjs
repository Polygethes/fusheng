import assert from "node:assert/strict";
import { characterAgent } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族医者、鬼修引魂人、龙裔渡口守卫、器灵档案官、城中执法者。",
});

const shen = state.characters.find((item) => item.id === "char_xianxia_shenheng");
const lu = state.characters.find((item) => item.id === "char_xianxia_luqingluo");
assert.ok(shen && lu, "test characters should exist");

state.ui.activeCharacterIds = [lu.id, shen.id];
state.ui.selectedLocationId = "loc_xianxia_contract_gate";
state.relationships = [];
state.characterMemories = [{
  id: "mem_other_person_about_lu",
  projectId: state.project.id,
  branchId: state.project.activeBranchId,
  characterId: shen.id,
  targetCharacterId: lu.id,
  type: "weaponized",
  stance: "revenge",
  content: "关系对话记忆：沈珩记住了鹿青萝在四方法契门的回应，灵契没有从场中消失。",
  publicVersion: "灵契还在界石旁。",
  privateVersion: "沈珩把鹿青萝的庇护听成对正道扣押权的拦阻。",
  reliability: 50,
  heat: 100,
  source: "agent_dialogue_relationship",
  sourceRelationshipShift: {
    sharedObject: "灵契",
    locationId: "loc_xianxia_contract_gate",
    locationName: "四方法契门",
    finalTurn: "名字先不写，灵契留给界石；解释权不能由你替我落印。",
    followupTurn: "名字先不写，灵契留给界石；解释权不能由你替我落印。",
    eventOutcome: "鹿青萝把灵契留在界石前。",
  },
}];

const output = characterAgent({
  state,
  character: lu,
  activeCharacters: [lu, shen],
  location: state.locations.find((item) => item.id === "loc_xianxia_contract_gate"),
});

assert.notEqual(output.targetCharacterId, lu.id, "an agent must not target itself through another character's memory");
assert.doesNotMatch(
  output.visibleAction,
  /自己挡在自己|挡在鹿青萝身前|挡住鹿青萝和|站到鹿青萝近处/,
  `visible action should not stage a fake self-interaction, got:\n${output.visibleAction}`,
);
assert.equal(output.memoryId, null, "another character's private relationship memory should not be read as this agent's memory");

console.log("relationshipMemoryDoesNotSelfTargetAgent:test passed", {
  target: output.targetCharacterId,
  visibleAction: output.visibleAction,
});
