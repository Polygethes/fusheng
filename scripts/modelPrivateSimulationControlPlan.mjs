import assert from "node:assert/strict";
import {
  buildPrivateSimulationUserPrompt,
  normalizePrivateSimulation,
  privateSimulationToAgentOutput,
} from "../src/server/pipeline/privateSimulator.mjs";
import { compactState } from "../src/server/pipeline/context.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

const shen = state.characters.find((item) => item.id === "char_xianxia_shenheng");
const yan = state.characters.find((item) => item.id === "char_xianxia_yanwujie");

state.ui.activeCharacterIds = [shen.id, yan.id];
state.ui.selectedLocationId = "loc_xianxia_contract_gate";
state.characterPlans = [
  {
    id: "plan_yan_control_from_dialogue",
    projectId: state.project.id,
    branchId: state.project.activeBranchId,
    characterId: yan.id,
    targetCharacterId: shen.id,
    status: "active",
    mode: "control",
    modeLabel: "控局计划",
    currentTactic: "control",
    nextActionBias: "伪装",
    pressure: 76,
    heat: 72,
    risk: 66,
    progress: 24,
    shortTerm: "阎无咎下一步要从沈珩手里夺回解释权：关系变化来自未结清对话：名字先不写。",
    shortTermPlan: "阎无咎下一步要从沈珩手里夺回解释权：关系变化来自未结清对话：名字先不写。",
    immediateObjective: "借界石、盖印人和灵契，把沈珩逼回城规流程里。",
    hiddenObjective: "让沈珩承认名字和盖印不能由玄衡宗替停剑城决定。",
    plannedActionVerb: "夺回解释权",
    disguisedAs: "按城法复核。",
    shadowProfit: "阎无咎获得短暂收益：沈珩被迫解释自己是否越过城规。",
    riskIfExposed: "一旦被看穿，沈珩会直接把控局识别成拖延和设局。",
    planLog: [],
  },
];

const compact = compactState(state);
const compactYan = compact.activeCharacters.find((character) => character.id === yan.id);
const prompt = buildPrivateSimulationUserPrompt({
  compact,
  character: compactYan,
  targetId: shen.id,
});
const sim = normalizePrivateSimulation({}, compact, compactYan, shen.id);
const output = privateSimulationToAgentOutput(sim);

assert.match(
  prompt,
  /当前自主计划压力/,
  "private simulator prompt should turn the active plan into an explicit pressure block, not leave it buried in JSON",
);
assert.match(
  prompt,
  /控局计划|currentTactic.*control/,
  "private simulator prompt should name the control tactic for the model",
);
assert.equal(sim.tone, "伪装", `control plans should bias fallback private simulation tone to 伪装, got ${sim.tone}`);
assert.match(
  sim.actionCandidate,
  /解释权|界石|盖印|灵契|名字/,
  "control-plan fallback action should use the concrete rule/object from the plan",
);
assert.match(
  `${output.planInfluence} ${output.planNextAction} ${output.visibleAction}`,
  /解释权|界石|盖印|灵契|名字/,
  "agent output should carry the control plan into visible next action material",
);

console.log("modelPrivateSimulationControlPlan:test passed", {
  tone: sim.tone,
  actionCandidate: sim.actionCandidate,
  planInfluence: output.planInfluence,
});
