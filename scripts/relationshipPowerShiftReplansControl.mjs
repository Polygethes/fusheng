import assert from "node:assert/strict";
import { buildUpdateBundle } from "../src/engine/stateUpdater.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

const shen = state.characters.find((item) => item.id === "char_xianxia_shenheng");
const yan = state.characters.find((item) => item.id === "char_xianxia_yanwujie");

state.characterPlans = [
  {
    id: "plan_yan_control",
    projectId: state.project.id,
    branchId: state.project.activeBranchId,
    characterId: yan.id,
    targetCharacterId: shen.id,
    status: "active",
    mode: "wait",
    modeLabel: "等待计划",
    currentTactic: "wait",
    nextActionBias: "试探",
    pressure: 48,
    heat: 45,
    risk: 35,
    progress: 0,
    shortTerm: "阎无咎先等待沈珩露出漏洞。",
    shortTermPlan: "阎无咎先等待沈珩露出漏洞。",
    plannedActionVerb: "等待",
    planLog: [],
  },
];

const draft = {
  id: "draft_power_shift_control",
  projectId: state.project.id,
  branchId: state.project.activeBranchId,
  locationId: "loc_xianxia_contract_gate",
  participantIds: [shen.id, yan.id],
  agentOutputs: [],
  irreversibleTraces: [],
  relationshipShift: [
    {
      generatedFrom: "model-agent-dialogue",
      relationshipSource: "model-agent-exchange",
      fromCharacterId: yan.id,
      toCharacterId: shen.id,
      deltas: { power: 3, deception: 2, wantsToEscape: 1 },
      misreading: "阎无咎把沈珩逼到铜盘前的开口听成必须借城规夺回解释权。",
      unspoken: "名字先不写。",
      sharedObject: "灵契",
      eventOutcome: "阎无咎没有接走灵契，把灵契留给界石；盖印的人停在铜盘外，名字没有写进盘边。",
      dialogueTurnCount: 3,
      finalTurn: "界石可以等，名字不能替你写。",
      followupTurn: "",
      dialogueTurns: [
        { speakerId: shen.id, speakerName: shen.name, targetId: yan.id, targetName: yan.name, line: "那你要谁替你盖印。", turnRole: "claim" },
        { speakerId: yan.id, speakerName: yan.name, targetId: shen.id, targetName: shen.name, line: "名字先不写，盖印的人也先别进来。", turnRole: "response" },
        { speakerId: shen.id, speakerName: shen.name, targetId: yan.id, targetName: yan.name, line: "界石可以等，名字不能替你写。", turnRole: "counter" },
      ],
    },
  ],
  audit: { safeClosureRisk: 35 },
};

const bundle = buildUpdateBundle(draft, state);
const planPatch = bundle.characterPlans.find((item) => item.id === "plan_yan_control");

assert.ok(planPatch, "relationship power shift should update the existing pair plan");
assert.equal(planPatch.targetCharacterId, shen.id, "plan should stay aimed at the dialogue counterpart");
assert.equal(planPatch.currentTactic, "control", `power shift should become a control tactic, got ${planPatch.currentTactic}`);
assert.equal(planPatch.nextActionBias, "伪装", "control tactic should make the next action mask itself as procedure");
assert.match(
  `${planPatch.shortTerm} ${planPatch.immediateObjective} ${planPatch.hiddenObjective}`,
  /解释权|界石|盖印|名字|灵契/,
  "control plan should carry the concrete rule/object that changed the relationship",
);
assert.doesNotMatch(
  `${planPatch.shortTerm} ${planPatch.immediateObjective}`,
  /解释权沈珩|解释权[^，。：；]*char_/,
  "control plan prose should not glue the verb directly onto the target name",
);
assert.match(
  `${planPatch.shortTerm} ${planPatch.immediateObjective}`,
  /沈珩.*解释权|解释权.*沈珩/,
  "control plan prose should name who the explanation-control move is aimed at",
);

console.log("relationshipPowerShiftReplansControl:test passed", {
  tactic: planPatch.currentTactic,
  nextActionBias: planPatch.nextActionBias,
  shortTerm: planPatch.shortTerm,
});
