import assert from "node:assert/strict";
import { runDialoguePsychology } from "../src/server/pipeline/dialoguePsychology.mjs";

const compact = {
  selectedLocation: { id: "tower", name: "梯云宗剑阁" },
  activeCharacters: [
    { id: "xie", name: "谢真石", publicIdentity: "梯云宗弟子" },
    { id: "zhou", name: "周珉", publicIdentity: "外门弟子" },
  ],
};
const privateSimulations = [
  { characterId: "xie", characterName: "谢真石", privateDesire: "确认九重以后还有没有路", targetCharacterId: "zhou" },
  { characterId: "zhou", characterName: "周珉", privateDesire: "让谢真石听完自己的请求", targetCharacterId: "xie" },
];
const sceneInteraction = {
  agentExchanges: [{ dialogueTurns: [
    { speakerId: "xie", speakerName: "谢真石", targetId: "zhou", targetName: "周珉", line: "九重还没走完。" },
    { speakerId: "zhou", speakerName: "周珉", targetId: "xie", targetName: "谢真石", line: "药先含着，别嚼。" },
    { speakerId: "xie", speakerName: "谢真石", targetId: "zhou", targetName: "周珉", line: "让我自己走完。" },
  ] }],
};

const updates = [];
const result = await runDialoguePsychology(compact, privateSimulations, sceneInteraction, {
  callModel: async ({ user }) => {
    const isXie = user.includes("确认九重以后");
    return {
      parsed: { moments: isXie ? [
        { spokenLine: "九重还没走完。", heardLine: "", speakerName: "", interpretation: "他们已经在替我庆祝。", feeling: "烦躁里有一点发虚", bodyResponse: "握剑的手出了汗。", privateThought: "别现在给我名字。", selfLie: "我只是在专心。", nextImpulse: "进第九重。" },
        { spokenLine: "让我自己走完。", heardLine: "药先含着，别嚼。", speakerName: "周珉", interpretation: "他又看见我撑不住。", feeling: "感激立刻变成恼怒", bodyResponse: "药丸抵在舌下。", privateThought: "别在这里照顾我。", selfLie: "我不需要这颗药。", nextImpulse: "避开他的手。" },
      ] : [
        { spokenLine: "药先含着，别嚼。", heardLine: "九重还没走完。", speakerName: "谢真石", interpretation: "他又要把自己烧空。", feeling: "担心里压着不耐烦", bodyResponse: "手心攥住药瓶。", privateThought: "这次你得听我说完。", selfLie: "我只是在递药。", nextImpulse: "挡住巷口。" },
      ] },
      meta: { model: "fixture" },
    };
  },
  onUpdate: async (reaction) => updates.push(reaction),
});

assert.equal(result.reactions.length, 3, "one model call per character may return multiple speaking moments");
assert.equal(updates.length, 3, "every speaking-moment thought should stream independently");
assert.deepEqual(result.reactions.filter((reaction) => reaction.characterId === "xie").map((reaction) => reaction.spokenLine), ["九重还没走完。", "让我自己走完。"]);
assert.deepEqual(result.reactions.filter((reaction) => reaction.characterId === "xie").map((reaction) => reaction.privateThought), ["别现在给我名字。", "别在这里照顾我。"]);

console.log("dialoguePsychologySpeakingMoments:test passed");
