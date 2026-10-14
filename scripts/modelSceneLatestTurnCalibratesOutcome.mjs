import assert from "node:assert/strict";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";

const privateSimulations = [
  {
    characterId: "char_shen",
    characterName: "沈珩",
    targetCharacterId: "char_yan",
    targetCharacterName: "阎无咎",
    agentProfile: {
      leverageObject: "灵契",
      dialogueMoves: ["按城法扣契，不按宗门私仇。", "剑可以停，证据不能走。"],
    },
  },
  {
    characterId: "char_yan",
    characterName: "阎无咎",
    targetCharacterId: "char_shen",
    targetCharacterName: "沈珩",
    agentProfile: {
      leverageObject: "魔印",
      dialogueMoves: ["我押的是灵契，不是命。", "价码到了，旧案自然开口。"],
    },
  },
];

const parsed = {
  agentExchanges: [
    {
      sourceCharacterId: "char_shen",
      responseCharacterId: "char_yan",
      sourceCharacterName: "沈珩",
      responseCharacterName: "阎无咎",
      sharedObject: "灵契",
      eventOutcome: "阎无咎没有接走灵契，把灵契留给界石；盖印的人停在铜盘外。",
      dialogueTurns: [
        { speakerId: "char_shen", targetId: "char_yan", line: "按城法扣契，不按宗门私仇。", turnRole: "claim" },
        { speakerId: "char_yan", targetId: "char_shen", line: "我押的是灵契，不是命。", turnRole: "response" },
        { speakerId: "char_shen", targetId: "char_yan", line: "剑可以停，证据不能走。", turnRole: "counter" },
        { speakerId: "char_yan", targetId: "char_shen", line: "灵契先不换手，你刚才那句话等界石来回。", turnRole: "turn" },
        { speakerId: "char_shen", targetId: "char_yan", line: "界石还照着灵契，名字不能替你写，证据也不能被你改成退路。", turnRole: "turn" },
      ],
      relationshipDeltas: [
        {
          fromCharacterId: "char_shen",
          toCharacterId: "char_yan",
          deltas: { resentment: 2, wantsToBeSeen: 2 },
          misreading: "沈珩把阎无咎的回避听成拖延。",
          unspoken: "证据不能走。",
        },
        {
          fromCharacterId: "char_yan",
          toCharacterId: "char_shen",
          deltas: { fear: 2, wantsToEscape: 2 },
          misreading: "阎无咎把沈珩的追问听成扣押。",
          unspoken: "灵契先不换手。",
        },
      ],
    },
  ],
};

const normalized = normalizeSceneInteraction(parsed, privateSimulations, { perCharacter: [] });
const exchange = normalized.agentExchanges[0] || {};
const text = normalized.sceneText || "";

assert.match(
  exchange.eventOutcome || "",
  /退路|名字不能替你写|证据也不能被你改成退路/,
  `parsed model exchange outcome should be calibrated by the latest free turn, got:\n${exchange.eventOutcome}`,
);
assert.match(
  text,
  /退路|名字不能替你写|证据也不能被你改成退路/,
  `scene text should expose the calibrated latest-turn outcome, got:\n${text}`,
);
assert.ok(
  normalized.relationshipShift.some((shift) => (
    shift.dialogueTurnCount === 5
    && shift.finalTurn === "界石还照着灵契，名字不能替你写，证据也不能被你改成退路。"
    && shift.followupTurn === "界石还照着灵契，名字不能替你写，证据也不能被你改成退路。"
    && /退路|名字不能替你写/.test(shift.eventOutcome || "")
  )),
  `relationship shift should store the calibrated outcome and latest turn, got:\n${JSON.stringify(normalized.relationshipShift, null, 2)}`,
);
assert.ok(
  normalized.relationshipShift.some((shift) => (
    shift.fromCharacterId === "char_yan"
    && shift.toCharacterId === "char_shen"
    && Number(shift.deltas?.wantsToEscape || 0) >= 4
    && /退路/.test(shift.misreading || "")
  )),
  `latest turn should make 阎无咎 remember his retreat was blocked, got:\n${JSON.stringify(normalized.relationshipShift, null, 2)}`,
);

console.log("modelSceneLatestTurnCalibratesOutcome:test passed", {
  eventOutcome: exchange.eventOutcome,
  sceneText: text,
});
