import assert from "node:assert/strict";
import { runDialoguePsychology } from "../src/server/pipeline/dialoguePsychology.mjs";

const compact = {
  selectedLocation: { id: "gate", name: "四方法契门" },
  activeCharacters: [
    { id: "shen", name: "沈珩", publicIdentity: "执律剑修" },
    { id: "yan", name: "阎无咎", publicIdentity: "血河楼使者" },
  ],
};
const privateSimulations = [
  { characterId: "shen", characterName: "沈珩", privateDesire: "PRIVATE_SHEN", defensiveMask: "冷静", targetCharacterId: "yan" },
  { characterId: "yan", characterName: "阎无咎", privateDesire: "PRIVATE_YAN", defensiveMask: "讥笑", targetCharacterId: "shen" },
];
const sceneInteraction = {
  agentExchanges: [{
    dialogueTurns: [
      { speakerId: "shen", speakerName: "沈珩", targetId: "yan", targetName: "阎无咎", line: "把契牌留下。" },
      { speakerId: "yan", speakerName: "阎无咎", targetId: "shen", targetName: "沈珩", line: "你先说是谁要我的命。" },
    ],
  }],
};

let activeCalls = 0;
let maxActiveCalls = 0;
const prompts = [];
const updates = [];
const callModel = async ({ user }) => {
  prompts.push(user);
  activeCalls += 1;
  maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
  await new Promise((resolve) => setTimeout(resolve, 20));
  activeCalls -= 1;
  const isShen = user.includes("PRIVATE_SHEN");
  return {
    parsed: {
      heardLine: isShen ? "你先说是谁要我的命。" : "把契牌留下。",
      speakerName: isShen ? "阎无咎" : "沈珩",
      interpretation: isShen ? "他在拖时间。" : "他已经认定我有罪。",
      feeling: isShen ? "警惕" : "愤怒里夹着惧意",
      bodyResponse: isShen ? "拇指抵住剑格。" : "魔印在掌心发热。",
      privateThought: isShen ? "他在等谁来？" : "不能让他看出我怕。",
      selfLie: isShen ? "我只是在执法。" : "这不过是一桩买卖。",
      nextImpulse: isShen ? "追问幕后的人。" : "用半句真话换回契牌。",
    },
    meta: { model: "fixture" },
  };
};

const result = await runDialoguePsychology(compact, privateSimulations, sceneInteraction, {
  callModel,
  onUpdate: async (update) => updates.push(update),
});

assert.equal(maxActiveCalls, 2, "independent character reactions should run concurrently");
assert.equal(result.reactions.length, 2, "every present character should receive a current reaction");
assert.equal(updates.length, 2, "each private reaction should be streamable to the psychology workspace");
assert.ok(prompts.every((prompt) => prompt.includes("把契牌留下。") && prompt.includes("你先说是谁要我的命。")), "each agent should know the public transcript");
assert.ok(prompts.some((prompt) => prompt.includes("PRIVATE_SHEN") && !prompt.includes("PRIVATE_YAN")), "Shen's prompt must contain only Shen's private state");
assert.ok(prompts.some((prompt) => prompt.includes("PRIVATE_YAN") && !prompt.includes("PRIVATE_SHEN")), "Yan's prompt must contain only Yan's private state");

console.log("dialoguePsychologyIsolation:test passed", { maxActiveCalls, reactions: result.reactions.length });
