import assert from "node:assert/strict";

import {
  CHARACTER_VOICE_HABIT_TOOL_VERSION,
  buildCharacterSpeechHabitPressureTool,
  compileCharacterVoiceFoundation,
  projectCharacterSpeechHabitSurface,
  recordCommittedSpeechHabitUse,
} from "../src/server/simulation/characterVoiceHabits.mjs";

function habit({ id, fn, baseline, modulators = [], repeatSensitivity = "medium" }) {
  return {
    id,
    kind: "discourse",
    function: fn,
    description: `${id} 的人物私有言语习惯`,
    baseline: { qualitativeLevel: baseline },
    modulators,
    realizationChannels: ["attention", "opening_move", "turn_yield"],
    fatigue: { repeatSensitivity, cooldownTurns: 4, minimumPressure: "low" },
  };
}

const luoFoundation = compileCharacterVoiceFoundation({
  schemaVersion: 1,
  numericStatus: "engine-operational-default-from-author-qualitative-anchor",
  habits: [
    habit({
      id: "luo_evidence_before_claim",
      fn: "evidence_first",
      baseline: "very_high",
      modulators: [
        { signal: "topic", matches: ["martial", "identity"], direction: "increase", strength: "high" },
        { signal: "relationship", matches: ["prospective_opponent"], direction: "increase", strength: "medium" },
        { signal: "motiveAlignment", direction: "increase", strength: "high" },
      ],
    }),
    habit({
      id: "luo_silence_to_observe",
      fn: "functional_silence",
      baseline: "high",
      modulators: [
        { signal: "turnMode", matches: ["self_initiated"], direction: "increase", strength: "medium" },
        { signal: "topic", matches: ["social_maintenance"], direction: "increase", strength: "low" },
      ],
    }),
    habit({
      id: "luo_close_irrelevant_exchange",
      fn: "close_exchange",
      baseline: "high",
      modulators: [{ signal: "topic", matches: ["irrelevant_social"], direction: "increase", strength: "high" }],
    }),
  ],
  relationshipRegisters: {
    prospective_opponent: { description: "平等审视", habitAdjustments: { luo_evidence_before_claim: "increase" } },
    stranger: { description: "低披露", habitAdjustments: { luo_close_irrelevant_exchange: "increase" } },
  },
  topicRegisters: {
    martial: { description: "剑术证据优先", attentionTargets: ["落脚", "呼吸", "收势"] },
  },
});

const xieFoundation = compileCharacterVoiceFoundation({
  schemaVersion: 1,
  numericStatus: "engine-operational-default-from-author-qualitative-anchor",
  habits: [
    habit({
      id: "xie_direct_martial_evaluation",
      fn: "precise_evaluation",
      baseline: "high",
      modulators: [{ signal: "topic", matches: ["martial"], direction: "increase", strength: "very_high" }],
    }),
    habit({
      id: "xie_deflect_weakness_question",
      fn: "deflect",
      baseline: "medium",
      modulators: [
        { signal: "topic", matches: ["own_weakness"], direction: "increase", strength: "very_high" },
        { signal: "relationship", matches: ["father"], direction: "increase", strength: "high" },
        { signal: "publicExposure", direction: "increase", strength: "high" },
      ],
    }),
    habit({
      id: "xie_familiar_ellipsis",
      fn: "shared_context_ellipsis",
      baseline: "high",
      modulators: [{ signal: "closeness", direction: "increase", strength: "high" }],
    }),
  ],
  relationshipRegisters: {
    father: { description: "遇到弱处时防守", habitAdjustments: { xie_deflect_weakness_question: "increase" } },
    close_peer: { description: "默认共享前情", habitAdjustments: { xie_familiar_ellipsis: "increase" } },
  },
  topicRegisters: {
    martial: { description: "具体剑术判断", attentionTargets: ["动作", "发力", "落脚"] },
    own_weakness: { description: "暴露阻力很高", attentionTargets: ["是否被看出", "是否必须承认"] },
  },
});

assert.equal(CHARACTER_VOICE_HABIT_TOOL_VERSION, "character-voice-habit-tool-v1");
assert.equal(luoFoundation.habits.length, 3);
assert.equal(JSON.stringify(luoFoundation).includes("literalSpeech"), false);
assert.equal(JSON.stringify(luoFoundation).includes("candidateLines"), false);

assert.throws(
  () => compileCharacterVoiceFoundation({
    schemaVersion: 1,
    habits: [{ ...habit({ id: "bad", fn: "answer", baseline: "high" }), fixedPhrases: ["照着说"] }],
  }),
  (error) => error.code === "CHARACTER_VOICE_FOUNDATION_INVALID"
    && error.issues.some((row) => row.code === "VOICE_HABIT_LITERAL_TEMPLATE_FORBIDDEN"),
  "a voice foundation must describe a tendency rather than store a catchphrase",
);

const sharedContext = {
  topicTags: ["martial"],
  relationshipTags: ["prospective_opponent"],
  affectTags: ["excitement"],
  bodyTags: [],
  venueTags: ["public_room"],
  turnMode: "answer",
  publicExposure: 0.12,
  closeness: 0.18,
  tension: 0.24,
  arousal: 0.68,
  fatigue: 0.08,
  motiveAlignment: 0.92,
  disclosurePressure: 0.62,
  inhibitionPressure: 0.34,
};

const luoTool = buildCharacterSpeechHabitPressureTool({
  characterId: "char_xyy_luozhao",
  foundation: luoFoundation,
  context: sharedContext,
  recentCommittedSpeech: [],
});
const xieTool = buildCharacterSpeechHabitPressureTool({
  characterId: "char_xyy_xiezenshi",
  foundation: xieFoundation,
  context: { ...sharedContext, relationshipTags: ["close_peer"] },
  recentCommittedSpeech: [],
});

assert.equal(luoTool.authority, "character-private-speech-habit-tool");
assert.equal(luoTool.selection, null, "the mathematical tool must not choose a speech habit");
assert.equal(Object.hasOwn(luoTool, "literalSpeech"), false);
assert.equal(Object.hasOwn(luoTool, "candidateLines"), false);
assert.ok(luoTool.habitPressures.luo_evidence_before_claim.value > luoTool.habitPressures.luo_close_irrelevant_exchange.value);
assert.ok(xieTool.habitPressures.xie_direct_martial_evaluation.value > xieTool.habitPressures.xie_deflect_weakness_question.value);

const xieWeaknessTool = buildCharacterSpeechHabitPressureTool({
  characterId: "char_xyy_xiezenshi",
  foundation: xieFoundation,
  context: {
    ...sharedContext,
    topicTags: ["own_weakness"],
    relationshipTags: ["father"],
    publicExposure: 0.86,
    motiveAlignment: 0.72,
  },
  recentCommittedSpeech: [],
});
assert.ok(
  xieWeaknessTool.habitPressures.xie_deflect_weakness_question.value
    > xieTool.habitPressures.xie_deflect_weakness_question.value,
  "relationship, topic and public exposure should change the same person's habit pressure",
);

let usage = [];
usage = recordCommittedSpeechHabitUse(usage, {
  actionId: "action:voice:1",
  characterId: "char_xyy_luozhao",
  committed: true,
  turnIndex: 1,
  realizedHabitIds: ["luo_evidence_before_claim"],
  literalSpeech: "PRIVATE_LITERAL_MUST_NOT_BE_RECORDED",
}, { foundation: luoFoundation });
usage = recordCommittedSpeechHabitUse(usage, {
  actionId: "action:voice:2",
  characterId: "char_xyy_luozhao",
  committed: false,
  turnIndex: 2,
  realizedHabitIds: ["luo_evidence_before_claim"],
}, { foundation: luoFoundation });
usage = recordCommittedSpeechHabitUse(usage, {
  actionId: "action:voice:3",
  characterId: "char_xyy_luozhao",
  committed: true,
  turnIndex: 3,
  realizedHabitIds: ["luo_evidence_before_claim"],
}, { foundation: luoFoundation });
assert.equal(usage.length, 2, "uncommitted drafts must not enter speech-habit memory");
assert.equal(JSON.stringify(usage).includes("PRIVATE_LITERAL"), false, "usage memory stores habit provenance, never the line itself");

const fatiguedLuoTool = buildCharacterSpeechHabitPressureTool({
  characterId: "char_xyy_luozhao",
  foundation: luoFoundation,
  context: { ...sharedContext, turnIndex: 4 },
  recentCommittedSpeech: usage,
});
assert.ok(
  fatiguedLuoTool.habitPressures.luo_evidence_before_claim.value
    < luoTool.habitPressures.luo_evidence_before_claim.value,
  "recent repetition should create fatigue",
);
assert.ok(fatiguedLuoTool.habitPressures.luo_evidence_before_claim.value > 0, "fatigue is not a ban");

const surface = projectCharacterSpeechHabitSurface(fatiguedLuoTool);
assert.equal(surface.authority, "character-private-speech-habit-surface");
assert.equal(Object.hasOwn(surface, "factorLedger"), false);
assert.equal(JSON.stringify(surface).includes("PRIVATE_LITERAL"), false);
assert.equal(surface.selection, null);

const medicFoundation = compileCharacterVoiceFoundation({
  schemaVersion: 1,
  habits: [habit({
    id: "medic_clear_instruction_under_danger",
    fn: "warn",
    baseline: "high",
    modulators: [{ signal: "venue", matches: ["mountain_rescue"], direction: "increase", strength: "high" }],
  })],
});
const medicTool = buildCharacterSpeechHabitPressureTool({
  characterId: "character:field-medic",
  foundation: medicFoundation,
  context: { ...sharedContext, topicTags: ["rescue"], venueTags: ["mountain_rescue"] },
});
assert.ok(medicTool.habitPressures.medic_clear_instruction_under_danger.value > 0.5, "the tool must not depend on tavern or xianxia characters");

console.log(JSON.stringify({
  status: "passed",
  version: CHARACTER_VOICE_HABIT_TOOL_VERSION,
  checks: {
    fixedPhrasesForbidden: true,
    characterOwnsHabitChoice: true,
    relationshipTopicStateModulatePressure: true,
    twoCharactersRemainDistinct: true,
    committedUseOnly: true,
    literalSpeechNotStoredInHabitMemory: true,
    repetitionFatigueIsNotProhibition: true,
    realizationSurfaceRedactsFactorLedger: true,
    nonTavernGenerality: true,
  },
}, null, 2));
