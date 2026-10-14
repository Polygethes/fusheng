import assert from "node:assert/strict";

import {
  buildTavernSpeechRealizationTool,
  buildTavernVoiceContract,
  validateTavernVoiceRealization,
} from "../src/server/pipeline/tavernCharacterVoice.mjs";
import {
  tavernCausalAgentDecisionSchema,
  tavernCausalAgentSystemPrompt,
} from "../src/server/pipeline/tavernCausalScene.mjs";

const XIE = "char_xyy_xiezenshi";
const LUO = "char_xyy_luozhao";

const xieVoice = buildTavernVoiceContract({ id: XIE, name: "谢真石" });
const luoVoice = buildTavernVoiceContract({ id: LUO, name: "洛照" });

for (const contract of [xieVoice, luoVoice]) {
  assert.equal(Object.hasOwn(contract, "sentenceShape"), false, "voice must not prescribe a sentence shape");
  assert.equal(Object.hasOwn(contract, "preferredLexicon"), false, "voice must not require signature words");
  assert.equal(Object.hasOwn(contract, "identitySignals"), false, "voice must not expose phrase-matching identity rules");
  assert.ok(contract.voiceFormation?.sourceOrder?.length >= 4, "voice formation must expose its causal sources");
  assert.match(contract.voiceFormation?.surfaceFreedom || "", /长短|停顿|完整|省略/u);
  assert.ok(contract.personalityVoice?.attentionPriorities?.length > 0);
  assert.ok(contract.personalityVoice?.appraisalHabits?.length > 0);
  assert.ok(contract.expressionTendencies?.thoughtMovement?.length > 0);
  assert.ok(contract.expressionTendencies?.pressureResponse);
  assert.ok(contract.relationshipRegisters && typeof contract.relationshipRegisters === "object");
}

assert.notDeepEqual(
  xieVoice.personalityVoice,
  luoVoice.personalityVoice,
  "different personalities must produce different voice causes without fixed lines",
);

const luoCalmTool = buildTavernSpeechRealizationTool({
  voiceContract: luoVoice,
  candidate: { targetCharacterId: XIE, expressionStrategy: { mode: "direct-engagement", directness: "clear", warmth: "cool" } },
  relationshipContext: [{ otherCharacterId: XIE, publicPressure: { closeness: 4, tension: 8 } }],
  dynamicState: { body: { fatigue: 0.08 }, affect: { arousal: 0.28 } },
});
const xiePressuredTool = buildTavernSpeechRealizationTool({
  voiceContract: xieVoice,
  candidate: { targetCharacterId: LUO, expressionStrategy: { mode: "minimal-response", directness: "guarded", warmth: "neutral" } },
  relationshipContext: [{ otherCharacterId: LUO, publicPressure: { closeness: 6, tension: 62 } }],
  dynamicState: { body: { fatigue: 0.72 }, affect: { arousal: 0.78 }, sensitivityActivations: { publicScrutiny: { activation: 0.8 } } },
});
assert.equal(luoCalmTool.authority, "character-private-voice-psychology-tool");
assert.match(luoCalmTool.formula, /base_i.+w_pressure_i.+w_closeness_i.+w_fatigue_i/u);
assert.equal(luoCalmTool.minimumSufficiencyTool.authority, "character-private-minimum-public-payload-tool");
assert.match(luoCalmTool.minimumSufficiencyTool.formula, /argmin.+chosenActionStillCompletes/u);
assert.equal(luoCalmTool.minimumSufficiencyTool.semanticLoadIsNotWordCount, true);
assert.match(luoCalmTool.minimumSufficiencyTool.turnYieldRule, /让出话轮/u);
assert.equal(xiePressuredTool.minimumSufficiencyTool.authority, "character-private-minimum-public-payload-tool");
assert.ok(luoCalmTool.parameters.directness.value > luoCalmTool.parameters.warmth.value);
assert.ok(xiePressuredTool.parameters.compression.value > xieVoice.voiceFormation.parameterModel.base.compression);
assert.notDeepEqual(
  luoCalmTool.parameters,
  xiePressuredTool.parameters,
  "the shared formula must preserve character-specific and state-specific weights",
);
assert.equal(tavernCausalAgentDecisionSchema.required.includes("speechRealizationPlan"), true);
assert.equal(
  tavernCausalAgentDecisionSchema.properties.speechRealizationPlan.required.includes("minimumSufficiency"),
  true,
);
assert.equal(
  tavernCausalAgentDecisionSchema.properties.speechRealizationPlan.properties.selfCheck.required.includes("containsUnnecessaryExplanatoryTail"),
  true,
);
assert.deepEqual(
  tavernCausalAgentDecisionSchema.properties.speechRealizationPlan.properties.appliedVoiceParameters.required,
  ["directness", "compression", "warmth", "reserve", "formality", "emotionalLeakage"],
);

const longButSituated = validateTavernVoiceRealization({
  characterId: LUO,
  targetCharacterId: XIE,
  voiceContract: luoVoice,
  speechAct: "inform",
  speech: "我只听过你的名字，还没有亲眼见过你的剑；传闻是真是假，等我看过再说。",
  contextTopics: ["只知道谢真石姓名与剑术传闻", "尚未亲眼验证"],
});
assert.equal(longButSituated.accepted, true);
assert.equal(Object.hasOwn(longButSituated.diagnostics?.components || {}, "sentenceRhythm"), false);
assert.equal(Object.hasOwn(longButSituated.diagnostics?.evidence || {}, "rhythm"), false);

const shortButComplete = validateTavernVoiceRealization({
  characterId: LUO,
  targetCharacterId: XIE,
  voiceContract: luoVoice,
  speechAct: "inform",
  speech: "我会再来。",
  contextTopics: ["未完成的亲自验证"],
});
assert.equal(shortButComplete.accepted, true);
assert.equal(Object.hasOwn(shortButComplete.diagnostics?.components || {}, "sentenceRhythm"), false);

const explanatoryTailPlan = {
  minimumSufficiency: {
    listenerCanRespondAfterMustConvey: true,
    additionalPublicExplanationServesChosenAction: false,
    additionalPublicExplanationPurpose: "",
    explanationsKeptPrivate: ["自己只信亲眼验证，不拿传闻替代判断"],
  },
  selfCheck: {
    soundsLikePrivateSummary: false,
    interchangeableAcrossCharacters: false,
    repeatsWhatActionAlreadyShows: false,
    containsUnnecessaryExplanatoryTail: true,
  },
};
const knownBadExplanatoryTail = validateTavernVoiceRealization({
  characterId: XIE,
  targetCharacterId: LUO,
  voiceContract: xieVoice,
  speechAct: "answer",
  speech: "谢真石就是我。我的剑值不值得看，我说了不算；你也别拿听说当眼见。",
  contextTopics: ["向陌生来客揭示自己的身份"],
  speechRealizationPlan: explanatoryTailPlan,
});
assert.equal(knownBadExplanatoryTail.accepted, true, "voice telemetry must never censor the character's literal speech");
assert.equal(
  knownBadExplanatoryTail.diagnosticFindings.some((finding) => finding.code === "CHARACTER_REPORTED_VOICE_DRIFT"),
  true,
  "the accepted bad sample must expose its unnecessary explanatory tail",
);

const minimalIdentityAnswer = validateTavernVoiceRealization({
  characterId: XIE,
  targetCharacterId: LUO,
  voiceContract: xieVoice,
  speechAct: "answer",
  speech: "谢真石就是我。",
  contextTopics: ["向陌生来客揭示自己的身份"],
  speechRealizationPlan: {
    ...explanatoryTailPlan,
    selfCheck: {
      ...explanatoryTailPlan.selfCheck,
      containsUnnecessaryExplanatoryTail: false,
    },
  },
});
assert.equal(minimalIdentityAnswer.accepted, true);
assert.equal(
  minimalIdentityAnswer.diagnosticFindings.some((finding) => finding.code === "CHARACTER_REPORTED_VOICE_DRIFT"),
  false,
  "the sufficient identity answer must yield the turn without voice drift",
);

const systemPrompt = tavernCausalAgentSystemPrompt({ agent: { name: "洛照", voiceContract: luoVoice } });
assert.match(systemPrompt, /人物怎样形成声音.+人格与当下心理状态先决定/u);
assert.match(systemPrompt, /不设目标字数、分句数/u);
assert.match(systemPrompt, /driftRisks.+不是禁词表/u);
assert.match(systemPrompt, /speechRealizationPlan.+mustConvey.+mayReveal.+withhold.+desiredListenerEffect/u);
assert.match(systemPrompt, /minimumSufficiency.+删除测试/u);
assert.match(systemPrompt, /让出话轮等待对方反应/u);
assert.match(systemPrompt, /展示我的人格、原则或声纹.+不算/u);
assert.match(systemPrompt, /后台目的标签原样念成一句任务汇报/u);
assert.doesNotMatch(systemPrompt, /按 sentenceShape/u);

console.log("tavernVoicePersonalityGeneration:test passed", {
  contracts: [xieVoice.characterId, luoVoice.characterId],
  longLineAccepted: longButSituated.accepted,
  shortLineAccepted: shortButComplete.accepted,
  explanatoryTailDetected: knownBadExplanatoryTail.diagnosticFindings.some((finding) => finding.code === "CHARACTER_REPORTED_VOICE_DRIFT"),
  minimalIdentityAnswerClean: !minimalIdentityAnswer.diagnosticFindings.some((finding) => finding.code === "CHARACTER_REPORTED_VOICE_DRIFT"),
});
