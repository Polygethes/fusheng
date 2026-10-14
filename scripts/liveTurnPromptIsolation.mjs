import assert from "node:assert/strict";
import {
  liveTurnSchema,
  livePrivateCard,
  liveTurnSystemPrompt,
  liveTurnUserPrompt,
  liveTurnModel,
} from "../src/server/pipeline/liveTurnEngine.mjs";

const compact = {
  selectedLocation: { id: "loc_a", name: "储水区" },
  ui: { timeGrain: "scene", userDirective: "", injectedEvent: "" },
  visibleFacts: ["水位线比昨天低一指"],
  activeCharacters: [
    {
      id: "char_a", name: "梅拉",
      externalSituation: "IDENTITY_储水区的守水人，三代人守着这片陶罐",
      internalSituation: "对水位的焦虑压过了所有别的念头",
      speechProfile: { cadence: "CADENCE_短句，先陈述事实再逼问", avoidance: "从不直接求人" },
    },
    { id: "char_b", name: "卡里姆" },
  ],
};
const simA = {
  characterId: "char_a", characterName: "梅拉",
  targetCharacterId: "char_b", targetCharacterName: "卡里姆",
  tone: "施压", publicGoal: "让所有人正视缺水", privateDesire: "SECRET_A_逼卡里姆表态",
  defensiveMask: "冷静", selfLie: "我只是在陈述事实",
  whatTheyWantFromOthers: "承认危机", whatTheyRefuseToAdmit: "自己也害怕",
  falseBeliefs: ["卡里姆囤了水"], withheldFacts: ["水样已经变味"],
  planNextAction: "把水位线指给所有人看", memoryLine: "三天前的争执",
  currentActivity: "ACTIVITY_蹲在石槽边核对水位刻痕",
  conversationObjective: "让卡里姆当众说清楚水的去向",
  pressure: 0.8, presenceIntent: "stay", exitUrgency: 0.1,
  agentProfile: { dramaticObjective: "逼出表态", hiddenFear: "被无视", leverageObject: "LEVERAGE_陶罐" },
};

const card = livePrivateCard(simA, compact.activeCharacters[0]);
assert.equal(card.characterName, "梅拉");
assert.ok(card.privateDesire.includes("SECRET_A"), "私人卡片必须包含本人私欲");
assert.ok(String(card.identity).includes("IDENTITY_"), "卡片必须包含人物身份处境");
assert.ok(String(card.currentActivity).includes("ACTIVITY_"), "卡片必须包含此刻在做的事");
assert.ok(JSON.stringify(card.speechProfile || "").includes("CADENCE_"), "卡片必须包含说话腔调");
assert.ok(!JSON.stringify(card).includes("LEVERAGE_"), "杠杆道具不得再进入卡片");
assert.ok(!JSON.stringify(card).includes("dramaticObjective"), "戏剧目标术语不得再进入卡片");

const transcript = [
  { turnId: "t1", speakerId: "char_b", speakerName: "卡里姆", line: "水的事明天再说。", action: "把肉条塞进帆布袋", moveIntent: "stay" },
];
const user = liveTurnUserPrompt({ compact, sim: simA, turns: transcript });
assert.ok(user.includes("SECRET_A"), "本人私人状态必须进入 prompt");
assert.ok(!user.includes("SECRET_B"), "其他角色的私人状态绝不进入 prompt");
assert.ok(user.includes("水的事明天再说。"), "公开转录必须进入 prompt");
assert.ok(user.includes("把肉条塞进帆布袋"), "可见动作必须进入 prompt");
assert.ok(user.includes("储水区"), "场所必须进入 prompt");
assert.ok(user.includes("IDENTITY_"), "身份处境必须进入 prompt");
assert.ok(user.includes("ACTIVITY_"), "当前活动必须进入 prompt");
assert.ok(!user.includes("LEVERAGE_"), "杠杆道具不得进入 prompt");

const emptyUser = liveTurnUserPrompt({ compact, sim: simA, turns: [] });
assert.ok(/第一个|还没有人/.test(emptyUser), "空转录要提示首发身份");

const system = liveTurnSystemPrompt(simA);
assert.ok(system.includes("梅拉"));
assert.ok(/回应|接住/.test(system), "系统提示必须要求回应上一轮");
assert.ok(/leave/.test(system), "系统提示必须说明可以离开");
assert.ok(/过自己|手上的事|日子/.test(system), "系统提示必须以活人而非任务框定人物");
assert.ok(!/拿起、挡住|递出/.test(system), "系统提示不得再用道具动词做示例");
assert.ok(/沉默|不说话|说不说话/.test(system), "系统提示必须允许沉默");

assert.deepEqual(liveTurnSchema.required, ["speech", "action", "moveIntent", "innerNote"]);
assert.deepEqual(liveTurnSchema.properties.moveIntent.enum, ["stay", "leave", "pass"]);

const originalModel = process.env.CHARACTER_TOWN_LIVE_TURN_MODEL;
try {
  process.env.CHARACTER_TOWN_LIVE_TURN_MODEL = "deepseek-v4";
  assert.equal(liveTurnModel(), "deepseek-v4", "台词模型开关必须读取环境变量");
  delete process.env.CHARACTER_TOWN_LIVE_TURN_MODEL;
  assert.equal(liveTurnModel(), "", "未设置时回落默认模型");
} finally {
  if (originalModel === undefined) delete process.env.CHARACTER_TOWN_LIVE_TURN_MODEL;
  else process.env.CHARACTER_TOWN_LIVE_TURN_MODEL = originalModel;
}

console.log("liveTurnPromptIsolation:test passed");
