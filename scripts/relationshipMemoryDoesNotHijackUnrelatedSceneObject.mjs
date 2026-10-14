import assert from "node:assert/strict";
import { characterAgent } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});

const shen = state.characters.find((item) => item.id === "char_xianxia_shenheng");
const yan = state.characters.find((item) => item.id === "char_xianxia_yanwujie");
const lu = state.characters.find((item) => item.id === "char_xianxia_luqingluo");
const gate = state.locations.find((item) => item.name === "四方法契门");
const market = state.locations.find((item) => item.name === "无咎市");
assert.ok(shen && yan && lu && gate && market, "fixture should expose xianxia characters and locations");

state.relationships = [];
state.characterMemories = [{
  id: "mem_shen_yan_contract_gate_should_not_leak",
  projectId: state.project.id,
  branchId: "branch_main",
  characterId: shen.id,
  targetCharacterId: yan.id,
  type: "weaponized",
  stance: "revenge",
  content: "关系对话记忆：沈珩记住了阎无咎在四方法契门的回应，灵契没有从场中消失。",
  privateVersion: "阎无咎把符压到铜盘边，没有让灵契离开。",
  retrievalCue: "四方法契门 / 灵契 / 铜盘",
  source: "agent_dialogue_relationship",
  sourceRelationshipShift: {
    generatedFrom: "agent-dialogue-relationship",
    sharedObject: "灵契",
    locationId: gate.id,
    locationName: gate.name,
    dialogueTurnCount: 4,
    finalTurn: "灵契先留在铜盘里。",
    followupTurn: "你扣的是灵契，还是血河楼的翻案证物？",
  },
  reliability: 35,
  heat: 100,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}];

const output = characterAgent({
  state,
  character: shen,
  activeCharacters: [shen, lu],
  location: market,
});

assert.equal(output.targetCharacterId, lu.id, "agent should aim at the character present in the current scene");
assert.notEqual(
  output.memoryId,
  "mem_shen_yan_contract_gate_should_not_leak",
  "a relationship memory about an absent target should not drive this scene",
);
assert.doesNotMatch(
  output.visibleAction,
  /灵契|铜盘/,
  `unrelated gate memory should not hijack market props, got:\n${output.visibleAction}`,
);
assert.match(
  output.visibleAction,
  /妖丹盒|禁术符箓|案台/,
  `market scene should use market-visible objects, got:\n${output.visibleAction}`,
);

console.log("relationshipMemoryDoesNotHijackUnrelatedSceneObject:test passed", {
  target: output.targetCharacterId,
  memoryId: output.memoryId,
  visibleAction: output.visibleAction,
});
