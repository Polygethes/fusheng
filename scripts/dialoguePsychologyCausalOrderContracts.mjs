import assert from "node:assert/strict";

import {
  buildLocalDialoguePsychology,
  runDialoguePsychology,
} from "../src/server/pipeline/dialoguePsychology.mjs";

const A = "character-a";
const B = "character-b";
const compact = {
  selectedLocation: { id: "room", name: "屋内" },
  activeCharacters: [
    { id: A, name: "甲" },
    { id: B, name: "乙" },
  ],
};
const simulations = [
  { characterId: A, characterName: "甲", privateDesire: "确认乙是否在听", pressure: 20 },
  { characterId: B, characterName: "乙", privateDesire: "弄清甲为何叫自己", pressure: 30 },
];
const sceneInteraction = {
  agentExchanges: [{
    dialogueTurns: [
      { speakerId: A, speakerName: "甲", targetId: B, targetName: "乙", line: "嗯。" },
      { speakerId: B, speakerName: "乙", targetId: A, targetName: "甲", line: "你叫我？" },
      { speakerId: A, speakerName: "甲", targetId: B, targetName: "乙", line: "嗯。" },
    ],
  }],
};

function assertCausalMoments(reactions, label) {
  assert.equal(reactions.length, 3, `${label}: every actual public utterance must have one private moment`);
  const aMoments = reactions.filter((row) => row.characterId === A);
  const bMoment = reactions.find((row) => row.characterId === B);
  assert.equal(aMoments.length, 2, `${label}: duplicate lines are separate utterance moments`);
  assert.equal(aMoments[0].spokenLine, "嗯。");
  assert.equal(aMoments[0].heardLine, "", `${label}: the opening line cannot hear a future reply`);
  assert.equal(aMoments[0].speakerName, "", `${label}: an empty heard line has no speaker`);
  assert.equal(bMoment?.heardLine, "嗯。", `${label}: the reply may hear the earlier opening line`);
  assert.equal(bMoment?.speakerName, "甲");
  assert.equal(aMoments[1].heardLine, "你叫我？", `${label}: the repeated second line must bind to its own prior turn`);
  assert.equal(aMoments[1].speakerName, "乙");
}

const local = await buildLocalDialoguePsychology(compact, simulations, sceneInteraction);
assertCausalMoments(local.reactions, "local fallback");

const modeled = await runDialoguePsychology(compact, simulations, sceneInteraction, {
  async callModel({ system }) {
    if (system.includes("甲")) {
      return {
        parsed: {
          moments: [
            {
              spokenLine: "嗯。",
              heardLine: "你叫我？",
              speakerName: "乙",
              interpretation: "先叫住他。",
              feeling: "平静",
              bodyResponse: "抬眼",
              privateThought: "等他回头。",
              selfLie: "只是随口。",
              nextImpulse: "再确认一次。",
            },
            {
              spokenLine: "嗯。",
              heardLine: "你叫我？",
              speakerName: "乙",
              interpretation: "他已经回头。",
              feeling: "稍松",
              bodyResponse: "点头",
              privateThought: "可以继续。",
              selfLie: "没什么要紧。",
              nextImpulse: "接着说。",
            },
          ],
        },
        meta: { provider: "fixture", model: "causal-order" },
      };
    }
    return {
      parsed: {
        moments: [{
          spokenLine: "你叫我？",
          heardLine: "嗯。",
          speakerName: "甲",
          interpretation: "甲在叫我。",
          feeling: "疑惑",
          bodyResponse: "回头",
          privateThought: "先问清楚。",
          selfLie: "我并不在意。",
          nextImpulse: "等回答。",
        }],
      },
      meta: { provider: "fixture", model: "causal-order" },
    };
  },
});
assertCausalMoments(modeled.reactions, "model normalization");

console.log("dialogue psychology causal order contracts passed");
