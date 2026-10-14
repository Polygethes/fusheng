import assert from "node:assert/strict";
import { characterAgent } from "../src/engine/mockEngine.js";
import { buildSimulationTick } from "../src/state/simulationLoop.js";
import { compactState } from "../src/server/pipeline/context.mjs";
import { buildPrivateSimulationUserPrompt } from "../src/server/pipeline/privateSimulator.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});

const shen = state.characters.find((item) => item.id === "char_xianxia_shenheng");
const yan = state.characters.find((item) => item.id === "char_xianxia_yanwujie");
const aoji = state.characters.find((item) => item.id === "char_xianxia_aoji");
const gate = state.locations.find((item) => item.name === "四方法契门");
const ferry = state.locations.find((item) => item.name === "归墟渡");
assert.ok(shen && yan && aoji && gate && ferry, "fixture should expose xianxia characters and locations");

state.relationships = [];
state.ui.timeGrain = "scene";
state.ui.focusMode = "location";
state.ui.selectedLocationId = gate.id;
state.ui.activeCharacterIds = [shen.id, yan.id];

const hotUnrelatedMemory = {
  id: "mem_hot_unrelated_ferry",
  projectId: state.project.id,
  branchId: "branch_main",
  characterId: shen.id,
  targetCharacterId: aoji.id,
  type: "weaponized",
  stance: "revenge",
  content: "关系对话记忆：沈珩记住了敖霁在归墟渡的回应，渡令没有从场中消失。",
  privateVersion: "敖霁把渡令压回岸上；追问：你扣的是渡令，还是龙裔的退路？",
  retrievalCue: "归墟渡 / 渡令 / 水阵压回岸上",
  source: "agent_dialogue_relationship",
  sourceRelationshipShift: {
    generatedFrom: "agent-dialogue-relationship",
    sharedObject: "渡令",
    locationId: ferry.id,
    locationName: ferry.name,
    triggeredBy: "水阵在岸边亮了一下。",
    dialogueTurnCount: 4,
    finalTurn: "渡令先停，水阵不开。",
    followupTurn: "你扣的是渡令，还是龙裔的退路？",
  },
  reliability: 45,
  heat: 100,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const sceneRelevantMemory = {
  id: "mem_scene_relevant_contract_gate",
  projectId: state.project.id,
  branchId: "branch_main",
  characterId: shen.id,
  targetCharacterId: yan.id,
  type: "selective",
  stance: "self_defense",
  content: "关系对话记忆：沈珩记住了阎无咎在四方法契门的回应，灵契没有从场中消失。",
  privateVersion: "界石忽然照出两道相互缠住的灵痕；阎无咎把符压到铜盘边，没有让灵契离开。",
  retrievalCue: "四方法契门 / 灵契 / 界石忽然照出两道相互缠住的灵痕。",
  source: "agent_dialogue_relationship",
  sourceRelationshipShift: {
    generatedFrom: "agent-dialogue-relationship",
    sharedObject: "灵契",
    locationId: gate.id,
    locationName: gate.name,
    triggeredBy: "界石忽然照出两道相互缠住的灵痕。",
    dialogueTurnCount: 4,
    finalTurn: "灵契先留在铜盘里。",
    followupTurn: "你扣的是灵契，还是血河楼的翻案证物？",
  },
  reliability: 82,
  heat: 54,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

state.characterMemories = [hotUnrelatedMemory, sceneRelevantMemory];

const tick = buildSimulationTick(state);
const shenPrivateSimulation = tick.privateSimulations.find((sim) => sim.characterId === shen.id);
assert.equal(
  shenPrivateSimulation?.sourceMemoryId,
  sceneRelevantMemory.id,
  "private simulation should retrieve the memory matching current location, object, and target over a hotter unrelated memory",
);
assert.match(
  `${shenPrivateSimulation?.memoryDialogueEcho || ""} ${shenPrivateSimulation?.whatTheyRefuseToAdmit || ""}`,
  /四方法契门|灵契|界石/,
  "private simulation should carry the scene-relevant memory cue forward",
);

const output = characterAgent({
  state,
  character: shen,
  activeCharacters: [shen, yan],
  location: gate,
});
assert.equal(output.memoryId, sceneRelevantMemory.id, "local agent output should use the scene-relevant memory");
assert.equal(output.targetCharacterId, yan.id, "memory retrieval should keep the agent aimed at the scene target");
assert.match(
  `${output.memoryInfluence || ""} ${output.memoryUse || ""}`,
  /四方法契门|灵契|界石/,
  "agent output should expose the relevant memory cue, not the unrelated ferry memory",
);

const compact = compactState(state);
const compactShen = compact.activeCharacters.find((character) => character.id === shen.id);
const prompt = buildPrivateSimulationUserPrompt({ compact, character: compactShen, targetId: yan.id });
assert.ok(
  prompt.indexOf(sceneRelevantMemory.id) >= 0 && prompt.indexOf(hotUnrelatedMemory.id) >= 0,
  "model prompt fixture should contain both competing memories",
);
assert.ok(
  prompt.indexOf(sceneRelevantMemory.id) < prompt.indexOf(hotUnrelatedMemory.id),
  "model prompt should rank the scene-relevant memory before the hotter unrelated memory",
);

console.log("memoryRetrievalCuePrioritizesScene:test passed", {
  selectedMemory: shenPrivateSimulation.sourceMemoryId,
  agentMemory: output.memoryId,
});
