import assert from "node:assert/strict";
import { runBackgroundSlot } from "../src/server/pipeline/backgroundSlotSimulator.mjs";

const characters = [
  { id: "a", name: "甲", identity: "掌灶者", currentActivity: "收碗", goal: "问清短缺" },
  { id: "b", name: "乙", identity: "送货者", currentActivity: "核账", goal: "保留来路" },
];
const socialIntents = [{
  kind: "refusal",
  requestId: "req_1",
  topic: "少掉的米",
  requesterId: "a",
  responderId: "b",
}];
const canonicalDialogueTurns = [
  { speakerId: "a", targetId: "b", line: "少掉的米，今天得说清。" },
  { speakerId: "b", targetId: "a", line: "账可以核，这个来路我不说。" },
];

const withIntent = await runBackgroundSlot({
  location: { id: "loc_xyy_tavern", name: "望梯酒馆" },
  slot: { label: "黄昏" },
  characters,
  groundingActions: ["甲把账板放到乙面前。", "乙没有照请求去做。"],
  socialIntents,
  canonicalDialogueTurns,
  runCall: async () => ({
    parsed: {
      slotText: "甲把账板推过去。",
      carryFacts: ["少掉的米仍未说明"],
      dialogueTurns: [
        { speakerId: "a", targetId: "b", line: "少掉的米，今天得说清。" },
        { speakerId: "b", targetId: "a", line: "账可以核，这个来路我不说。" },
      ],
    },
    meta: { model: "fake" },
  }),
});

assert.equal(withIntent.dialogueTurns.length, 2);
assert.ok(withIntent.dialogueTurns.every((turn) => turn.speakerName && turn.targetName));
for (const turn of withIntent.dialogueTurns) assert.ok(withIntent.slotText.includes(turn.line), "witness prose must carry the exact witnessed line");

const repeatedCanonical = await runBackgroundSlot({
  location: { id: "loc_xyy_tavern", name: "望梯酒馆" },
  slot: { label: "清晨" },
  characters,
  groundingActions: ["甲把账板放到乙面前。"],
  lifeEvents: [{
    characterId: "a",
    characterName: "甲",
    targetCharacterId: "b",
    targetCharacterName: "乙",
    activityType: "speak",
    visibleAction: `甲对乙说：“${canonicalDialogueTurns[0].line}”`,
  }],
  canonicalDialogueTurns,
  runCall: async () => ({
    parsed: {
      slotText: `甲对乙说：“${canonicalDialogueTurns[0].line}”乙作答。甲又说：“${canonicalDialogueTurns[0].line}”`,
      carryFacts: [],
      dialogueTurns: canonicalDialogueTurns,
    },
    meta: { model: "fake" },
  }),
});
for (const turn of canonicalDialogueTurns) {
  assert.equal(repeatedCanonical.slotText.split(turn.line).length - 1, 1, "each canonical line must appear exactly once in witness prose");
}

const withoutIntent = await runBackgroundSlot({
  location: { id: "loc_xyy_tavern", name: "望梯酒馆" },
  slot: { label: "清晨" },
  characters,
  groundingActions: ["甲在收碗。"],
  socialIntents: [],
  runCall: async () => ({
    parsed: {
      slotText: "甲在收碗。",
      carryFacts: [],
      dialogueTurns: [{ speakerId: "a", targetId: "b", line: "模型擅自制造一句话。" }],
    },
    meta: { model: "fake" },
  }),
});
assert.equal(withoutIntent.dialogueTurns.length, 0, "a prose witness cannot invent conversation without a canonical social intent");

const malformed = await runBackgroundSlot({
  location: { id: "loc_xyy_tavern", name: "望梯酒馆" },
  slot: { label: "夜深" },
  characters,
  groundingActions: ["乙在堂前喝茶核对名录。"],
  canonicalDialogueTurns: [canonicalDialogueTurns[1]],
  canonicalConsequences: ["名录仍有两项没有核完。"],
  runCall: async () => ({
    parsed: {
      slotText: "乙守着自己的在堂前喝茶，核对名录。",
      carryFacts: [],
      dialogueTurns: canonicalDialogueTurns,
    },
    meta: { model: "fake" },
  }),
});
assert.doesNotMatch(malformed.slotText, /自己的在/, "obviously malformed witness prose must not reach the visible day");
assert.ok(malformed.slotText.includes(canonicalDialogueTurns[1].line), "quality fallback must still preserve the Agent's exact line");

const visitPurposeSplice = await runBackgroundSlot({
  location: { id: "loc_xyy_tavern", name: "望梯酒馆" },
  slot: { label: "午后" },
  characters: [{ id: "d", name: "周珉", identity: "送药客", currentActivity: "等回应" }],
  groundingActions: ["周珉在不挡路的位置等负责的人回应来意。"],
  lifeEvents: [{
    characterId: "d",
    characterName: "周珉",
    activityType: "wait_for_service",
    visibleAction: "周珉在不挡路的位置等负责的人回应来意。",
  }],
  runCall: async () => ({
    parsed: {
      slotText: "周珉只在不挡路的位置守着自己的送来药包和清单，并在交割后找谢真石问举荐答复等回应。",
      carryFacts: [],
      dialogueTurns: [],
    },
    meta: { model: "fake" },
  }),
});
assert.doesNotMatch(visitPurposeSplice.slotText, /守着自己的/, "a visit purpose cannot be spliced into a possessive action phrase");
assert.match(visitPurposeSplice.slotText, /周珉在不挡路的位置等负责的人回应来意/);

const swappedActors = await runBackgroundSlot({
  location: { id: "loc_xyy_tavern", name: "望梯酒馆" },
  slot: { label: "黄昏" },
  characters: [
    ...characters,
    { id: "c", name: "谢母", identity: "掌柜", currentActivity: "出饭" },
    { id: "d", name: "周珉", identity: "送药客", currentActivity: "等饭" },
    { id: "e", name: "谢真石", identity: "店伙", currentActivity: "吃饭" },
  ],
  groundingActions: ["谢母把一碗热饭端到周珉桌前。", "谢真石坐到灶边吃饭。"],
  lifeEvents: [{
    characterId: "c",
    characterName: "谢母",
    targetCharacterId: "d",
    targetCharacterName: "周珉",
    activityType: "serve_guest",
    visibleAction: "谢母把一碗热饭端到周珉桌前。",
    consequence: "热饭由谢母交给周珉。",
  }],
  canonicalConsequences: ["热饭由谢母交给周珉。"],
  runCall: async () => ({
    parsed: {
      slotText: "谢真石把一碗热饭端到周珉桌前。",
      carryFacts: [],
      dialogueTurns: [],
    },
    meta: { model: "fake" },
  }),
});
assert.match(swappedActors.slotText, /谢母[^。！？]*周珉/, "protected hospitality prose must keep the canonical actor and target in the same sentence");
assert.doesNotMatch(swappedActors.slotText, /谢真石把一碗热饭端到周珉/, "a witness cannot swap the canonical server");

console.log("tavernWitnessDialogue:test passed", { lines: withIntent.dialogueTurns.map((turn) => turn.line) });
