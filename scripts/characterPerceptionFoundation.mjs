import assert from "node:assert/strict";

import {
  compileCharacterFoundation,
  compileValidatedCharacterAnchorRuntime,
  validateCharacterFoundation,
} from "../src/server/ecology/validatedCharacterAnchorRuntime.mjs";
import {
  normalizeWorldSignalFeature,
  projectWorldSignalForObserver,
  validateWorldSignalFeature,
} from "../src/server/simulation/characterPerception.mjs";

function minimalAnchor(overrides = {}) {
  return {
    schemaVersion: 1,
    status: "validated",
    numericCalibrationStatus: "unassigned",
    characterId: "char_test_perceiver",
    stablePsychology: { dispositions: {} },
    dynamicPsychology: { stateVariables: [] },
    epistemics: { knownEntities: [] },
    sceneBindings: [{ sceneId: "scene_test", reasonForPresence: "测试" }],
    desires: [{
      id: "desire_test_notice",
      ownerCharacterId: "char_test_perceiver",
      desiredState: {
        subjectCharacterId: "char_test_perceiver",
        verb: "找到",
        object: "可靠线索",
        observableOutcome: "本人取得一条可追溯证据",
      },
      qualitativeStrength: "medium",
      satisfactionCondition: { requiredEvidence: "取得证据" },
    }],
    inhibitors: [],
    speechPolicy: {},
    relationshipModel: {},
    memoryPolicy: {},
    ...overrides,
  };
}

const legacy = compileCharacterFoundation(minimalAnchor());
assert.equal(legacy.perceptionProfile.schemaVersion, 1, "legacy validated characters must receive an explicit neutral profile");
assert.equal(legacy.perceptionProfile.sensoryChannels.visual.availability, 1);
assert.equal(legacy.perceptionProfile.sensoryChannels.sound.availability, 1);
assert.equal(legacy.perceptionProfile.attention.baselineBudget, 4);
assert.deepEqual(validateCharacterFoundation(legacy), { valid: true, errors: [] });

const authored = compileCharacterFoundation(minimalAnchor({
  perceptionProfile: {
    sensoryChannels: {
      visual: { availability: 0, acuity: 0 },
      sound: { availability: 1, acuity: 0.93, rhythmResolution: 0.9 },
    },
    attention: {
      baselineBudget: 5,
      sensitivityThreshold: 0.16,
      orientingBiases: { rhythm: 0.55 },
    },
    domainDecoders: [{
      id: "decoder:test-rhythm",
      domain: "rhythm",
      competenceRange: [0.78, 0.92],
      evidenceIds: ["author-evidence:test-rhythm"],
    }],
    informationStyle: {
      concealmentNeed: 0.82,
      directInquiry: 0.22,
      patience: 0.76,
    },
  },
}));
assert.equal(authored.perceptionProfile.sensoryChannels.visual.availability, 0);
assert.equal(authored.perceptionProfile.sensoryChannels.sound.rhythmResolution, 0.9);
assert.ok(Math.abs(authored.perceptionProfile.domainDecoders[0].competence - 0.85) < 1e-12);
assert.equal(Object.hasOwn(authored.perceptionProfile.domainDecoders[0], "evidenceIds"), false, "authoring provenance must not enter runtime perception data");
assert.deepEqual(validateCharacterFoundation(authored), { valid: true, errors: [] });

const rangeAuthored = compileCharacterFoundation(minimalAnchor({
  perceptionProfile: {
    attention: {
      baselineBudgetRange: [4, 6],
      sensitivityThresholdRange: [0.14, 0.22],
      distractibilityRange: [0.18, 0.3],
      overloadSensitivityRange: [0.45, 0.65],
      orientingBiases: { sword: [0.6, 0.8], commerce: [-0.3, -0.1] },
    },
    domainDecoders: [{ domain: "sword", competenceRange: [0.78, 0.92] }],
    informationStyle: {
      directInquiryRange: [0.3, 0.5],
      concealmentNeedRange: [0.7, 0.9],
      patienceRange: [0.62, 0.82],
      verificationThresholdRange: [0.8, 0.94],
      socialRiskSensitivityRange: [0.45, 0.65],
      reactionReadingConfidenceRange: [0.5, 0.7],
    },
  },
}));
assert.equal(rangeAuthored.perceptionProfile.attention.baselineBudget, 5);
assert.ok(Math.abs(rangeAuthored.perceptionProfile.attention.sensitivityThreshold - 0.18) < 1e-12);
assert.ok(Math.abs(rangeAuthored.perceptionProfile.attention.orientingBiases.sword - 0.7) < 1e-12);
assert.ok(Math.abs(rangeAuthored.perceptionProfile.attention.orientingBiases.commerce + 0.2) < 1e-12);
assert.ok(Math.abs(rangeAuthored.perceptionProfile.informationStyle.verificationThreshold - 0.87) < 1e-12);
assert.deepEqual(validateCharacterFoundation(rangeAuthored), { valid: true, errors: [] });

const runtime = compileValidatedCharacterAnchorRuntime({
  sceneId: "scene_test",
  characterId: "char_test_perceiver",
  characterFoundation: minimalAnchor({ perceptionProfile: authored.perceptionProfile }),
  memorySeed: { ownerCharacterId: "char_test_perceiver", episodes: [], beliefs: [], commitments: [], impressions: [] },
});
assert.equal(runtime.perceptionProjection.attention.baselineBudget, 5);
assert.ok(runtime.candidatePolicy.parameterSources.includes("characterFoundation.perceptionProfile"));

const invalidProfileFoundation = {
  ...authored,
  perceptionProfile: {
    ...authored.perceptionProfile,
    attention: { ...authored.perceptionProfile.attention, baselineBudget: 99 },
    fixedAction: "每次都直接询问",
  },
};
const invalidProfileReport = validateCharacterFoundation(invalidProfileFoundation);
assert.equal(invalidProfileReport.valid, false);
assert.ok(invalidProfileReport.errors.some((row) => row.code === "FOUNDATION_PERCEPTION_PROFILE_INVALID"));
assert.ok(invalidProfileReport.errors.some((row) => row.code === "FOUNDATION_PERCEPTION_ACTION_LEAK"));

const worldSignal = normalizeWorldSignalFeature({
  signalId: "signal:test-visible-sword",
  sourceEntityId: "char_world_secret_identity",
  sourceZoneId: "hall",
  modality: "visual",
  featureId: "worn_sheathed_sword",
  physicalFeature: "左腰佩着一柄入鞘长剑",
  domainTags: ["weapon", "sword"],
  intensity: 0.8,
  durationSeconds: 4,
});
assert.deepEqual(validateWorldSignalFeature(worldSignal), { valid: true, errors: [] });
const projected = projectWorldSignalForObserver(worldSignal, {
  sourceEntityHandle: "perceived:anonymous-visitor",
});
assert.equal(projected.sourceEntityHandle, "perceived:anonymous-visitor");
assert.equal(Object.hasOwn(projected, "sourceEntityId"), false, "canonical world identity must remain server-only");
assert.doesNotMatch(JSON.stringify(projected), /char_world_secret_identity/u);
assert.equal(projected.physicalFeature, "左腰佩着一柄入鞘长剑");

const invalidWorldSignal = validateWorldSignalFeature({
  ...worldSignal,
  hiddenIntent: "寻找仇人",
  recognizedIdentity: { name: "某人" },
});
assert.equal(invalidWorldSignal.valid, false);
assert.ok(invalidWorldSignal.errors.some((row) => row.code === "WORLD_SIGNAL_HIDDEN_SEMANTIC_LEAK"));

console.log("characterPerceptionFoundation:test passed", {
  legacyBudget: legacy.perceptionProfile.attention.baselineBudget,
  authoredVisualAvailability: authored.perceptionProfile.sensoryChannels.visual.availability,
  projectedSource: projected.sourceEntityHandle,
});
