import assert from "node:assert/strict";

import {
  auditCharacterPsychologyToolOutput,
  computeCharacterPsychologySnapshot,
  computeCharacterRegulationOutcome,
} from "../src/server/simulation/characterPsychologyTools.mjs";
import {
  buildTavernAffectiveSpeechRealizationTool,
} from "../src/server/pipeline/tavernCharacterVoice.mjs";

const TURN = "turn:affective-voice:1";
const appraisal = {
  ownerAuthority: "character-agent",
  appraisalId: "appraisal:affective-voice:1",
  agentTurnId: TURN,
  noticedEvidenceIds: ["evidence:1"],
  interpretations: [{ evidenceIds: ["evidence:1"], meaning: "眼前出现了本人真正关心的线索", confidence: 0.8 }],
  relevanceLinks: [{ sourceId: "desire:1", relation: "advances", strength: 0.9, confidence: 0.8 }],
  appraisalAxes: {
    selfRelevance: 0.88,
    goalCongruence: 0.78,
    novelty: 0.72,
    expectedness: -0.48,
    opportunityValue: 0.84,
    threat: 0.32,
    controllability: 0.58,
    changeability: 0.62,
    certaintyDelta: 0.42,
    normCompatibility: 0.2,
    selfImageCongruence: 0.12,
    publicExposure: 0.68,
    relationshipMeaning: {},
  },
  uncertainty: 0.4,
};
const profile = {
  personality: { selfControl: 0.76 },
  emotionResponse: { emotions: { curiosity: { gain: 1.2 }, excitement: { gain: 1.15 } } },
  regulation: { practicedSkill: 0.72, strategySkills: { suppress: 0.7 } },
  leakage: { maskingSkills: { gaze: 0.48, voiceOnset: 0.58, attentionLock: 0.36 } },
};
const state = { mood: { valence: 0.04, arousal: 0.34 }, body: { fatigue: 0.18, instability: 0.06 }, feltSafety: 0.62 };
const snapshot = computeCharacterPsychologySnapshot({
  agentTurnId: TURN,
  appraisal,
  profile,
  state,
  desires: [{ desireId: "desire:1", previousActivation: 0.62, cueMatch: 0.86, urgency: 0.4, frustration: 0.2 }],
});
const regulation = computeCharacterRegulationOutcome({
  agentTurnId: TURN,
  snapshot,
  profile,
  state,
  regulationChoice: {
    ownerAuthority: "character-agent",
    regulationChoiceId: "regulation:affective-voice:1",
    strategies: [{ strategy: "suppress", targetEmotionIds: ["excitement", "anticipation"], effort: 0.66, contextFit: 0.72 }],
  },
});
const voiceContract = {
  voiceFormation: {
    parameterModel: {
      base: { directness: 0.72, compression: 0.54, warmth: 0.24, reserve: 0.68, formality: 0.36, emotionalLeakage: 0.28 },
      pressure: { directness: 0.08, compression: 0.12, warmth: -0.04, reserve: 0.08, formality: 0, emotionalLeakage: 0.16 },
      closeness: { directness: 0.02, compression: 0.04, warmth: 0.12, reserve: -0.08, formality: -0.06, emotionalLeakage: 0.04 },
      fatigue: { directness: 0, compression: 0.12, warmth: -0.04, reserve: 0.06, formality: 0, emotionalLeakage: 0.08 },
    },
  },
  activeContext: { targetCharacterId: "perceived_entity:1" },
};
const args = {
  voiceContract,
  targetCharacterId: "perceived_entity:1",
  relationshipContext: [{ targetCharacterId: "perceived_entity:1", closeness: 0.1, tension: 0.2 }],
  psychologySnapshot: snapshot,
  regulationOutcome: regulation,
  bodyState: state.body,
  agentTurnId: TURN,
};
const before = structuredClone(args);
const result = buildTavernAffectiveSpeechRealizationTool(args);
assert.deepEqual(args, before, "affective voice pressure must not mutate private Agent state");
assert.equal(result.schemaVersion, 2);
assert.equal(result.authority, "character-private-affective-voice-tool");
assert.equal(result.selectionAuthority, "character-agent");
assert.equal(result.payloadAxes.affectiveTexture.independentFromPropositionalLength, true);
assert.equal(Object.prototype.hasOwnProperty.call(result, "expressionStrategy"), false);
assert.equal(Object.prototype.hasOwnProperty.call(result, "literalSpeech"), false);
assert.equal(Object.prototype.hasOwnProperty.call(result, "intendedGesture"), false);
assert.equal(Object.values(result.factorLedger).some((row) => Object.prototype.hasOwnProperty.call(row, "chosenExpressionStrategy")), false);
assert.equal(auditCharacterPsychologyToolOutput(result).valid, true);
assert.ok(result.contextSignals.leakagePeak > 0);
assert.ok(result.parameters.emotionalLeakage.value > voiceContract.voiceFormation.parameterModel.base.emotionalLeakage);

const lowResidue = {
  ...regulation,
  residualEmotion: regulation.residualEmotion.map((row) => ({ ...row, value: row.value * 0.1 })),
  channelLeakagePressures: Object.fromEntries(Object.keys(regulation.channelLeakagePressures).map((key) => [key, 0.02])),
};
const lowResult = buildTavernAffectiveSpeechRealizationTool({ ...args, regulationOutcome: lowResidue });
assert.ok(
  result.parameters.emotionalLeakage.value > lowResult.parameters.emotionalLeakage.value,
  "voice affect must respond to regulation residue rather than a preselected expression mode",
);

assert.throws(
  () => buildTavernAffectiveSpeechRealizationTool({ ...args, psychologySnapshot: {} }),
  (error) => error.code === "TAVERN_AFFECTIVE_VOICE_PSYCHOLOGY_REQUIRED",
);

console.log(JSON.stringify({
  status: "passed",
  checks: {
    psychologyAndRegulationRequired: true,
    noExpressionStrategyInput: true,
    noDialogueOrGestureOutput: true,
    residualAffectShapesVoicePressure: true,
    propositionalAndAffectiveAxesSeparated: true,
    characterAgentKeepsSelectionAuthority: true,
  },
}, null, 2));
