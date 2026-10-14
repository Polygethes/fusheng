import assert from "node:assert/strict";

import {
  CHARACTER_VOICE_RESPONSIBILITIES_VERSION,
  VOICE_SURFACE_KEYS,
  buildCharacterVoiceResponsibilities,
  resolveCharacterVoiceRegisterId,
} from "../src/server/simulation/characterVoiceResponsibilities.mjs";

const voiceContract = {
  characterId: "character:portable",
  characterName: "这个名字不得参与计算",
  personalityVoice: {
    attentionPriorities: ["脚步与呼吸", "物件是否被动过"],
    appraisalHabits: ["区分亲见与传闻"],
    interactionStance: "本字段不应原样落进声音表面",
    emotionalLeakage: ["真正吃惊时起声会慢半拍"],
  },
  expressionTendencies: {
    rhythmTendency: "本字段不应作为字面写作指令下发",
    pressureResponse: { deliveryShift: "本字段不应原样落进声音表面" },
  },
  relationshipRegisters: {
    close_peer: { distance: "熟近", adjustment: "替对方把茶端过去" },
    stranger: { distance: "疏远", adjustment: "询问来意" },
  },
  voiceFormation: {
    parameterModel: {
      base: {
        directness: 0.66,
        compression: 0.48,
        warmth: 0.38,
        reserve: 0.7,
        formality: 0.42,
        emotionalLeakage: 0.3,
      },
      pressure: {
        directness: 0.08,
        compression: 0.12,
        warmth: -0.06,
        reserve: 0.1,
        formality: 0.02,
        emotionalLeakage: 0.16,
      },
      closeness: {
        directness: 0.04,
        compression: 0.08,
        warmth: 0.14,
        reserve: -0.12,
        formality: -0.08,
        emotionalLeakage: 0.06,
      },
      fatigue: {
        directness: 0,
        compression: 0.1,
        warmth: -0.04,
        reserve: 0.06,
        formality: -0.02,
        emotionalLeakage: 0.08,
      },
    },
  },
  serviceMenu: ["最贵的茶", "热饭"],
  actionCandidates: ["端茶", "拔剑"],
  factJudgment: "对方一定是谢真石",
  literalSpeech: "来壶好茶。",
};

const voiceFoundation = {
  authority: "character-voice-foundation",
  habits: [
    {
      id: "evidence_attention",
      kind: "attention",
      function: "先注意可以亲自核验的细节",
      description: "注意是认知输入，不是台词或动作",
      baseline: { operationalValue: 0.78 },
      realizationChannels: ["attention"],
    },
    {
      id: "measured_pacing",
      kind: "rhythm",
      function: "压力下仍尽量保持节奏完整",
      description: "语言习惯只提供压力，不提供句子",
      baseline: { operationalValue: 0.62 },
      realizationChannels: ["pacing", "pause"],
    },
  ],
  relationshipRegisters: {
    close_peer: { attentionTargets: ["对方未说完的停顿"] },
  },
  topicRegisters: {
    martial: { attentionTargets: ["落脚", "呼吸"] },
  },
};

const input = {
  voiceContract,
  voiceFoundation,
  cognitiveState: {
    noticedEvidenceIds: ["evidence:footwork:1"],
    activeAttentionTargets: ["落脚"],
    uncertainty: 0.28,
    selectedActionId: "PRIVATE_ACTION_MUST_NOT_REACH_SURFACE",
    factJudgment: "PRIVATE_FACT_JUDGMENT_MUST_NOT_REACH_SURFACE",
  },
  roleSkillProfile: {
    domainIds: ["martial_observation"],
    attentionLenses: ["重心转换", "呼吸与发力是否同步"],
    terminologyPrecision: 0.82,
    proceduralFluency: 0.76,
    audienceAdaptation: 0.44,
    serviceMenu: ["茶", "酒", "住宿"],
    recommendedAction: "先试一招",
  },
  regulationOutcome: {
    remainingControl: 0.68,
    regulationCost: 0.24,
    residualEmotion: [
      { emotionId: "interest", value: 0.72 },
      { emotionId: "wariness", value: 0.36 },
    ],
    channelLeakagePressures: {
      voiceOnset: 0.58,
      prosody: 0.46,
      tempo: 0.32,
      pause: 0.42,
      gaze: 0.86,
      gesture: 0.74,
    },
    chosenExpressionStrategy: "PRIVATE_STRATEGY_MUST_NOT_REACH_SURFACE",
  },
  context: {
    pressure: 0.64,
    closeness: 0.72,
    fatigue: 0.2,
    relationshipRegisterId: "close_peer",
    venueServiceMenu: ["茶", "热饭"],
    selectedAction: "serve_tea",
    knownFact: "对方已经付钱",
  },
};

const before = structuredClone(input);
const result = buildCharacterVoiceResponsibilities(input);
assert.deepEqual(input, before, "responsibility separation must be a pure projection");

assert.equal(CHARACTER_VOICE_RESPONSIBILITIES_VERSION, "character-voice-responsibilities-v1");
assert.equal(result.schemaVersion, 1);
assert.equal(result.authority, "character-private-voice-responsibility-separation");
assert.equal(Object.hasOwn(result, "runtimeConnected"), false, "a pure builder must not publish stale wiring status");
assert.equal(result.selection, null);

assert.deepEqual(result.cognitiveAttention.noticedEvidenceIds, ["evidence:footwork:1"]);
assert.deepEqual(result.cognitiveAttention.activeAttentionTargets, ["落脚"]);
assert.ok(result.cognitiveAttention.stableAttentionPriorities.includes("脚步与呼吸"));
assert.ok(result.cognitiveAttention.foundationAttentionTargets.includes("呼吸"));
assert.equal(Object.hasOwn(result.cognitiveAttention, "factJudgment"), false);
assert.equal(Object.hasOwn(result.cognitiveAttention, "selectedActionId"), false);

assert.deepEqual(result.roleSkill.domainIds, ["martial_observation"]);
assert.deepEqual(result.roleSkill.attentionLenses, ["重心转换", "呼吸与发力是否同步"]);
assert.equal(result.roleSkill.terminologyPrecision.value, 0.82);
assert.equal(Object.hasOwn(result.roleSkill, "serviceMenu"), false);
assert.equal(Object.hasOwn(result.roleSkill, "recommendedAction"), false);

assert.equal(result.emotionalRegulation.remainingControl.value, 0.68);
assert.equal(result.emotionalRegulation.voiceChannelLeakage.voiceOnset.value, 0.58);
assert.equal(Object.hasOwn(result.emotionalRegulation.voiceChannelLeakage, "gaze"), false);
assert.equal(Object.hasOwn(result.emotionalRegulation, "chosenExpressionStrategy"), false);

assert.deepEqual(Object.keys(result.voiceSurface).sort(), [...VOICE_SURFACE_KEYS].sort());
assert.deepEqual(Object.keys(result.voiceSurface).sort(), [
  "emotionalLeakageTendency",
  "register",
  "relationshipDistance",
  "rhythm",
  "wording",
]);
assert.equal(result.voiceSurface.relationshipDistance.registerId, "close_peer");
assert.equal(result.voiceSurface.relationshipDistance.distanceLabel, "familiar");
assert.equal(result.voiceSurface.wording.technicalPrecision.value, 0.79);
assert.equal(result.voiceSurface.emotionalLeakageTendency.voiceOnset.value, 0.58);
assert.equal(Object.hasOwn(result.voiceSurface.emotionalLeakageTendency, "gaze"), false);

const surfaceText = JSON.stringify(result.voiceSurface);
for (const forbidden of [
  "最贵的茶",
  "热饭",
  "端茶",
  "拔剑",
  "对方一定是谢真石",
  "来壶好茶",
  "PRIVATE_ACTION",
  "PRIVATE_FACT_JUDGMENT",
  "PRIVATE_STRATEGY",
  "替对方把茶端过去",
  "询问来意",
]) {
  assert.equal(surfaceText.includes(forbidden), false, `voice surface leaked forbidden semantic content: ${forbidden}`);
}
for (const forbiddenKey of [
  "serviceMenu",
  "affordance",
  "action",
  "candidate",
  "fact",
  "judgment",
  "speech",
  "utterance",
  "line",
  "selection",
]) {
  assert.equal(surfaceText.toLowerCase().includes(forbiddenKey.toLowerCase()), false, `voice surface leaked forbidden key family: ${forbiddenKey}`);
}

assert.deepEqual(result.boundary, {
  cognitionMayNoticeButNotChooseAction: true,
  roleSkillMayShapePrecisionButNotSupplyFacts: true,
  regulationMayShapeLeakageButNotChooseExpression: true,
  surfaceMayShapeDeliveryButNotSupplyMeaning: true,
  mayNotReadServiceMenusOrAffordances: true,
  mayNotJudgeWorldFacts: true,
  mayNotSelectActions: true,
  mayNotWriteLiteralSpeech: true,
});

const renamed = buildCharacterVoiceResponsibilities({
  ...structuredClone(input),
  voiceContract: { ...structuredClone(voiceContract), characterName: "完全不同的名字" },
});
assert.deepEqual(
  renamed,
  result,
  "identical authored traits and state must not change merely because the character name changes",
);

const colder = buildCharacterVoiceResponsibilities({
  ...structuredClone(input),
  context: { ...structuredClone(input.context), closeness: 0.08, relationshipRegisterId: "stranger" },
});
assert.notDeepEqual(colder.voiceSurface.relationshipDistance, result.voiceSurface.relationshipDistance);
assert.notEqual(colder.voiceSurface.wording.warmth.value, result.voiceSurface.wording.warmth.value);
assert.deepEqual(
  colder.cognitiveAttention.stableAttentionPriorities,
  result.cognitiveAttention.stableAttentionPriorities,
  "relationship distance may alter surface delivery without rewriting stable attention",
);

const sharedNumericModel = structuredClone(voiceContract.voiceFormation.parameterModel);
const warmVoice = buildCharacterVoiceResponsibilities({
  voiceContract: {
    personalityVoice: {
      interactionStance: "温和、体贴，熟人面前不端正式架子",
      emotionalLeakage: ["关心变强时，语气会先软下来"],
    },
    expressionTendencies: {
      rhythmTendency: "平静时允许自然铺垫，需要时也能完整展开",
    },
    relationshipRegisters: {
      close_peer: { distance: "熟近", adjustment: "默认默契，允许省略共享前情" },
    },
    driftRisks: ["不要把体贴写成现代客服口吻"],
    voiceFormation: { parameterModel: sharedNumericModel },
  },
  regulationOutcome: input.regulationOutcome,
  context: { pressure: 0.3, closeness: 0.6, fatigue: 0.1, relationshipRegisterId: "close_peer" },
});
const coolVoice = buildCharacterVoiceResponsibilities({
  voiceContract: {
    personalityVoice: {
      interactionStance: "冷静、克制、精确，不靠寒暄拉近距离",
      emotionalLeakage: ["真正吃惊时，起声会短暂停住"],
    },
    expressionTendencies: {
      rhythmTendency: "通常简练而冷静，判断复杂时可以说完整",
    },
    relationshipRegisters: {
      close_peer: { distance: "保留距离", adjustment: "礼数完整，语域保持正式" },
    },
    driftRisks: ["不要把克制写成僵硬电报句"],
    voiceFormation: { parameterModel: sharedNumericModel },
  },
  regulationOutcome: input.regulationOutcome,
  context: { pressure: 0.3, closeness: 0.6, fatigue: 0.1, relationshipRegisterId: "close_peer" },
});
assert.deepEqual(
  warmVoice.voiceSurface.wording.directness,
  coolVoice.voiceSurface.wording.directness,
  "the comparison intentionally shares the same numeric parameter model",
);
assert.notDeepEqual(warmVoice.voiceSurface.wording.toneTags, coolVoice.voiceSurface.wording.toneTags);
assert.notDeepEqual(warmVoice.voiceSurface.rhythm.tendencyTags, coolVoice.voiceSurface.rhythm.tendencyTags);
assert.notDeepEqual(warmVoice.voiceSurface.register.surfaceAdjustmentTags, coolVoice.voiceSurface.register.surfaceAdjustmentTags);
assert.equal(Object.hasOwn(warmVoice.voiceSurface.rhythm, "authoredTendency"), false);
assert.equal(Object.hasOwn(coolVoice.voiceSurface.rhythm, "authoredTendency"), false);
assert.equal(Object.hasOwn(warmVoice.voiceSurface.emotionalLeakageTendency, "stableConditions"), false);
assert.equal(Object.hasOwn(coolVoice.voiceSurface.emotionalLeakageTendency, "stableConditions"), false);
assert.equal(Object.hasOwn(warmVoice.voiceSurface.wording, "driftAvoidances"), false);
assert.equal(Object.hasOwn(coolVoice.voiceSurface.wording, "driftAvoidances"), false);

const registerContract = {
  relationshipRegisters: {
    family: { distance: "熟近", adjustment: "家常省略" },
    closePeer: { distance: "熟悉", adjustment: "允许共享前情省略" },
    prospectiveOpponent: { distance: "平等审视", adjustment: "语气保持直接" },
    stranger: { distance: "疏远", adjustment: "保持低披露" },
  },
};
assert.equal(resolveCharacterVoiceRegisterId({ voiceContract: registerContract }), "stranger");
assert.equal(resolveCharacterVoiceRegisterId({
  voiceContract: registerContract,
  candidateDomains: ["martial"],
}), "prospectiveOpponent", "martial relevance may select a delivery register without confirming an opponent identity");
assert.equal(resolveCharacterVoiceRegisterId({
  voiceContract: registerContract,
  relationship: { label: "一起长大的好友", publicPressure: { closeness: 0.84 } },
  candidateDomains: ["martial"],
}), "closePeer", "an established relationship register takes precedence over a topical opponent tint");
assert.equal(resolveCharacterVoiceRegisterId({
  voiceContract: registerContract,
  relationship: { label: "家人", allowedAddresses: ["娘"], publicPressure: { closeness: 0.9 } },
}), "family");

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    existingVoiceShapesSeparated: true,
    pureProjectionNoMutation: true,
    cognitionDoesNotChooseAction: true,
    roleSkillDoesNotSupplyFactsOrMenus: true,
    regulationDoesNotChooseExpression: true,
    voiceSurfaceHasOnlyFiveDeliveryResponsibilities: true,
    noLiteralSpeechOrSemanticActionLeakage: true,
    noCharacterNameHardcoding: true,
    sameNumbersStillKeepDistinctNonLiteralVoiceTendencies: true,
    pureBuilderPublishesNoStaleWiringStatus: true,
    genericRelationshipRegisterFallbacks: true,
  },
}, null, 2));
