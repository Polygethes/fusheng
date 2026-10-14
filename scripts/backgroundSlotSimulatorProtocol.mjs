import assert from "node:assert/strict";
import {
  backgroundSlotSchema,
  backgroundSlotSystemPrompt,
  backgroundSlotUserPrompt,
  runBackgroundSlot,
} from "../src/server/pipeline/backgroundSlotSimulator.mjs";

const location = { id: "loc_well", name: "储水区" };
const slot = { label: "清晨", focus: "开工" };
const characters = [
  { id: "char_a", name: "梅拉", identity: "IDENTITY_守水人", currentActivity: "ACTIVITY_核对水位刻痕", goal: "让所有人正视缺水" },
  { id: "char_b", name: "卡里姆", identity: "药师", currentActivity: "晾晒药材", goal: "攒够远行的干粮" },
];
const dayLog = ["DAYLOG_昨夜有人动过水位记号"];
const groundingActions = ["GROUND_梅拉把陶罐排成一列"];

const system = backgroundSlotSystemPrompt();
assert.ok(/过日子|劳动|做事/.test(system), "系统提示必须要求写生活行动");
assert.ok(/不.*对峙|不是.*对峙/.test(system), "系统提示必须排除对峙戏");
assert.ok(/不在场|不得发明/.test(system), "系统提示必须禁止发明人物");

const user = backgroundSlotUserPrompt({ location, slot, characters, groundingActions, dayLog, ui: { userDirective: "", injectedEvent: "" } });
assert.ok(user.includes("储水区") && user.includes("清晨"), "地点与时段必须进入 prompt");
assert.ok(user.includes("IDENTITY_") && user.includes("ACTIVITY_"), "人物身份与当前活动必须进入 prompt");
assert.ok(user.includes("DAYLOG_"), "今天已发生的事必须进入 prompt");
assert.ok(user.includes("GROUND_"), "本地演算的可见动作必须作为底料进入 prompt");

assert.deepEqual(backgroundSlotSchema.required, ["slotText", "carryFacts"]);

// 正常返回
const okResult = await runBackgroundSlot({
  location, slot, characters, groundingActions, dayLog, ui: {},
  runCall: async ({ schemaName }) => {
    assert.equal(schemaName, "character_town_background_slot");
    return {
      parsed: {
        slotText: "梅拉蹲在石槽边补刻水位线，卡里姆把最后一把药材摊上竹匾。",
        carryFacts: ["水位线被补刻了一道新记号", "药材还差半天才干", "多余1", "多余2"],
        characterActivities: [{ characterId: "char_a", activity: "补刻水位线" }],
      },
      meta: { model: "fake-bg" },
    };
  },
});
assert.ok(okResult.slotText.includes("补刻水位线"));
assert.equal(okResult.carryFacts.length, 3, "carryFacts 超过 3 条必须截断");
assert.ok(okResult.carryFacts.every((fact) => typeof fact === "string" && fact.length > 0));
assert.equal(okResult.stage.name, "BackgroundSlot:清晨");
assert.equal(okResult.stage.provider, "openai");
assert.equal(okResult.stage.model, "fake-bg");

// 空返回不炸，交给调用方回退
const emptyResult = await runBackgroundSlot({
  location, slot, characters, groundingActions, dayLog, ui: {},
  runCall: async () => ({ parsed: {}, meta: { model: "fake-bg" } }),
});
assert.equal(emptyResult.slotText, "");
assert.deepEqual(emptyResult.carryFacts, []);

console.log("backgroundSlotSimulatorProtocol:test passed");
