import assert from "node:assert/strict";
import {
  buildTavernVoiceContract,
  validateTavernVoiceRealization,
} from "../src/server/pipeline/tavernCharacterVoice.mjs";

const samples = [
  ["char_xyy_xiezenshi", "谢真石", "剑还没试过，我自己去。"],
  ["char_xyy_zhoumin", "周珉", "药我交了，举荐的事今晚给我个答复。"],
  ["char_xyy_luozhao", "洛照", "传闻不算，我要亲眼试他的剑。"],
  ["char_xyy_yanzhizhong", "严执中", "名录第三页无日期，这一项暂留未决。"],
  ["char_xyy_xieheng", "谢恒", "米酒少两坛，今日先记到账上。"],
  ["char_xyy_xiemu", "谢母", "饭在灶上，你先把这两张桌收净。"],
  ["char_xyy_chenyan", "陈砚", "堂前两张桌做完了，您验过我再吃饭。"],
];

const genericRows = samples.map(([characterId, characterName]) => {
  const voiceContract = buildTavernVoiceContract({ id: characterId, name: characterName });
  return validateTavernVoiceRealization({
    characterId,
    voiceContract,
    speech: "这一步办妥了。",
    speechAct: "inform",
  });
});

assert.ok(genericRows.every((row) => Number.isFinite(row.identityScore)));
assert.ok(genericRows.every((row) => row.identityPassed === false));
assert.ok(genericRows.every((row) => row.accepted === true));
assert.ok(genericRows.every((row) => (
  row.diagnosticFindings.some((violation) => violation.code === "VOICE_IDENTITY_TOO_GENERIC")
)));

const distinctiveRows = samples.map(([characterId, characterName, speech]) => {
  const voiceContract = buildTavernVoiceContract({ id: characterId, name: characterName });
  return validateTavernVoiceRealization({
    characterId,
    voiceContract,
    speech,
    speechAct: "inform",
  });
});

assert.ok(distinctiveRows.every((row) => row.accepted === true));
assert.ok(distinctiveRows.every((row) => (
  Number.isFinite(row.diagnostics?.components?.situatedContent)
  && Number.isFinite(row.diagnostics?.components?.pragmaticFit)
  && Number.isFinite(row.diagnostics?.components?.relationshipFit)
  && Number.isFinite(row.diagnostics?.components?.interactionContinuity)
  && Number.isFinite(row.diagnostics?.components?.nonGenericity)
  && Number.isFinite(row.diagnostics?.genericPenalty)
)));
assert.ok(distinctiveRows.some((row) => row.identityPassed === true));
const genericAverage = genericRows.reduce((sum, row) => sum + row.identityScore, 0) / genericRows.length;
const distinctiveAverage = distinctiveRows.reduce((sum, row) => sum + row.identityScore, 0) / distinctiveRows.length;
assert.ok(distinctiveAverage > genericAverage, "character-grounded lines should produce stronger voice telemetry on average");

const noSignatureWordContract = {
  schemaVersion: 3,
  characterId: "synthetic_bookkeeper",
  characterName: "账房",
  voiceFormation: {
    surfaceFreedom: "不设目标字数、分句数、固定句型或必用词。",
  },
  telemetry: {
    minimumContextualCoherence: 0.46,
  },
  activeContext: {},
};
const noPreferredLexiconResult = validateTavernVoiceRealization({
  characterId: "synthetic_bookkeeper",
  voiceContract: noSignatureWordContract,
  speech: "三枚铜钱已经记到账册。",
  speechAct: "inform",
  contextTopics: ["三枚铜钱", "账册"],
});
assert.equal(Object.hasOwn(noPreferredLexiconResult.diagnostics.evidence, "preferredHits"), false);
assert.equal(Object.hasOwn(noPreferredLexiconResult.diagnostics.components, "sentenceRhythm"), false);
assert.equal(noPreferredLexiconResult.identityPassed, true);
assert.equal(noPreferredLexiconResult.accepted, true);

const hardGateContract = buildTavernVoiceContract({ id: "char_xyy_xiemu", name: "谢母" });
const hardGateResult = validateTavernVoiceRealization({
  characterId: "char_xyy_xiemu",
  voiceContract: hardGateContract,
  speech: "饭在灶上，请慢用。",
  speechAct: "inform",
});
assert.equal(hardGateResult.accepted, true);
assert.ok(hardGateResult.diagnosticFindings.some((violation) => violation.code === "GENERIC_SERVICE_REGISTER"));

console.log("tavernPhase59VoiceIdentity:test passed", {
  genericScores: genericRows.map((row) => row.identityScore),
  distinctiveScores: distinctiveRows.map((row) => row.identityScore),
  noPreferredLexiconScore: noPreferredLexiconResult.identityScore,
});
