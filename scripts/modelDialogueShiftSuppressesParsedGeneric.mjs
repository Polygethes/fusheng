import assert from "node:assert/strict";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";

const privateSimulations = [
  {
    characterId: "char_shen",
    characterName: "沈珩",
    targetCharacterId: "char_yan",
    targetCharacterName: "阎无咎",
    tone: "试探",
    defensiveMask: "那你要谁替你盖印？",
    agentProfile: {
      leverageObject: "灵契",
      dialogueMoves: ["那你要谁替你盖印？", "剑可以停，证据不能走。"],
    },
  },
  {
    characterId: "char_yan",
    characterName: "阎无咎",
    targetCharacterId: "char_shen",
    targetCharacterName: "沈珩",
    tone: "撤退",
    defensiveMask: "我押的是灵契，不是命。",
    agentProfile: {
      leverageObject: "毒誓符",
      dialogueMoves: ["我押的是灵契，不是命。", "旧案开口前，谁也别替我签。"],
    },
  },
];

const normalized = normalizeSceneInteraction({
  agentExchanges: [{
    sourceCharacterId: "char_shen",
    responseCharacterId: "char_yan",
    sourceCharacterName: "沈珩",
    responseCharacterName: "阎无咎",
    sharedObject: "灵契",
    generatedFrom: "model-agent-dialogue",
    eventOutcome: "阎无咎没有接走灵契，把灵契留给界石；盖印的人停在铜盘外。",
    dialogueTurns: [
      { speakerId: "char_shen", targetId: "char_yan", line: "那你要谁替你盖印？", turnRole: "claim" },
      { speakerId: "char_yan", targetId: "char_shen", line: "名字先不写，盖印的人也先别进来。", turnRole: "response" },
      { speakerId: "char_shen", targetId: "char_yan", line: "界石可以等，名字不能替你写。", turnRole: "counter" },
    ],
    relationshipDeltas: [
      {
        fromCharacterId: "char_shen",
        toCharacterId: "char_yan",
        deltas: { resentment: 3, wantsToBeSeen: 3 },
        misreading: "沈珩把阎无咎借界石留下灵契听成对自己审判权的挑战。",
        unspoken: "界石可以等，名字不能替你写。",
      },
      {
        fromCharacterId: "char_yan",
        toCharacterId: "char_shen",
        deltas: { power: 3, deception: 2, wantsToEscape: 1 },
        misreading: "阎无咎把沈珩逼到铜盘前的开口听成必须借城规夺回解释权。",
        unspoken: "名字先不写。",
      },
    ],
  }],
  relationshipShift: [
    {
      fromCharacterId: "char_shen",
      toCharacterId: "char_yan",
      deltas: { attraction: 6 },
      misreading: "模型额外泛化：沈珩觉得阎无咎在靠近。",
      unspoken: "泛化吸引。",
    },
    {
      fromCharacterId: "char_yan",
      toCharacterId: "char_shen",
      deltas: { protection: 6 },
      misreading: "模型额外泛化：阎无咎觉得沈珩在保护。",
      unspoken: "泛化保护。",
    },
  ],
}, privateSimulations, { perCharacter: [] });

const byPair = normalized.relationshipShift.reduce((map, shift) => {
  const key = `${shift.fromCharacterId}->${shift.toCharacterId}`;
  map.set(key, [...(map.get(key) || []), shift]);
  return map;
}, new Map());

for (const [pair, shifts] of byPair.entries()) {
  assert.equal(
    shifts.length,
    1,
    `model exchange pair ${pair} should keep only dialogue-derived shift, got ${JSON.stringify(shifts, null, 2)}`,
  );
  assert.equal(shifts[0].generatedFrom, "model-agent-dialogue", `pair ${pair} should keep model-agent-dialogue shift`);
}

assert.doesNotMatch(
  JSON.stringify(normalized.relationshipShift),
  /泛化/,
  "generic parsed relationshipShift should not survive when the same pair has agentExchanges relationshipDeltas",
);

console.log("modelDialogueShiftSuppressesParsedGeneric:test passed", {
  shifts: normalized.relationshipShift.map((shift) => ({
    from: shift.fromCharacterId,
    to: shift.toCharacterId,
    generatedFrom: shift.generatedFrom,
    deltas: shift.deltas,
  })),
});
