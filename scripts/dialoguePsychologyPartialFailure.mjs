import assert from "node:assert/strict";
import { runDialoguePsychology } from "../src/server/pipeline/dialoguePsychology.mjs";

const compact = {
  selectedLocation: { id: "gate", name: "四方法契门" },
  activeCharacters: [{ id: "a", name: "甲" }, { id: "b", name: "乙" }],
};
const simulations = [
  { characterId: "a", characterName: "甲", privateDesire: "A_PRIVATE", targetCharacterId: "b" },
  { characterId: "b", characterName: "乙", privateDesire: "B_PRIVATE", targetCharacterId: "a" },
];
const scene = {
  agentExchanges: [{ dialogueTurns: [
    { speakerId: "a", speakerName: "甲", targetId: "b", targetName: "乙", line: "把门打开。" },
    { speakerId: "b", speakerName: "乙", targetId: "a", targetName: "甲", line: "你先退后。" },
  ] }],
};
const updates = [];

const result = await runDialoguePsychology(compact, simulations, scene, {
  callModel: async ({ user }) => {
    if (user.includes("B_PRIVATE")) throw new TypeError("fetch failed");
    return {
      parsed: {
        heardLine: "你先退后。",
        speakerName: "乙",
        interpretation: "他在拖延。",
        feeling: "恼怒里夹着迟疑",
        bodyResponse: "手指压紧门把。",
        privateThought: "门后还有谁？",
        selfLie: "我只是确认安全。",
        nextImpulse: "追问门后的人。",
      },
      meta: { model: "fixture", provider: "test" },
    };
  },
  onUpdate: async (reaction) => updates.push(reaction),
});

assert.equal(result.reactions.length, 1, "one failed private agent must not erase another agent's reaction");
assert.equal(result.reactions[0].characterId, "a");
assert.equal(result.failures.length, 1);
assert.equal(result.failures[0].characterId, "b");
assert.equal(result.failures[0].error, "fetch failed");
assert.equal(updates.length, 1);

console.log("dialoguePsychologyPartialFailure:test passed", { reactions: result.reactions.length, failures: result.failures.length });
