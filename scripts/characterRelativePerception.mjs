import assert from "node:assert/strict";

import {
  buildCharacterPerceptionFrame,
  decodeNoticedEvidence,
  normalizeCharacterPerceptionProfile,
  projectNoticedPhysicalFeature,
  receiveSignalCandidates,
} from "../src/server/simulation/characterPerception.mjs";

const signals = [
  {
    signalId: "signal:robe-color",
    sourceEntityHandle: "perceived:traveler",
    modality: "visual",
    featureId: "robe_color_blue",
    physicalFeature: "外袍呈深蓝色",
    domainTags: ["clothing"],
    intensity: 0.78,
  },
  {
    signalId: "signal:scabbard-wear",
    sourceEntityHandle: "perceived:traveler",
    modality: "visual",
    featureId: "scabbard_wear_near_mouth",
    physicalFeature: "剑鞘口一侧有反复摩擦留下的浅痕",
    domainTags: ["weapon", "sword"],
    intensity: 0.72,
  },
  {
    signalId: "signal:footstep-rhythm",
    sourceEntityHandle: "perceived:traveler",
    modality: "sound",
    featureId: "footstep_even_three_beat",
    physicalFeature: "脚步以稳定的三拍间隔接近",
    domainTags: ["gait", "rhythm"],
    intensity: 0.66,
  },
  {
    signalId: "signal:metal-position",
    sourceEntityHandle: "perceived:traveler",
    modality: "sound",
    featureId: "metal_rub_left_hip",
    physicalFeature: "金属与衣料的摩擦声来自左胯附近",
    domainTags: ["weapon", "spatial-audio"],
    intensity: 0.6,
  },
  {
    signalId: "signal:coin-pouch",
    sourceEntityHandle: "perceived:traveler",
    modality: "visual",
    featureId: "coin_pouch_well_filled",
    physicalFeature: "腰侧钱袋坠得饱满",
    domainTags: ["commerce", "payment"],
    intensity: 0.63,
  },
];

const environment = {
  light: 0.78,
  ambientNoise: 0.2,
  modalityTransmission: { visual: 0.95, sound: 0.9 },
};

const neutralSighted = normalizeCharacterPerceptionProfile({
  sensoryChannels: {
    visual: { availability: 1, acuity: 0.72 },
    sound: { availability: 1, acuity: 0.55 },
  },
  attention: { baselineBudget: 3, sensitivityThreshold: 0.25 },
});
const trainedBlindListener = normalizeCharacterPerceptionProfile({
  sensoryChannels: {
    visual: { availability: 0, acuity: 0 },
    sound: { availability: 1, acuity: 0.96, rhythmResolution: 0.95, sourceLocalization: 0.92 },
  },
  attention: {
    baselineBudget: 4,
    sensitivityThreshold: 0.16,
    orientingBiases: { sound: 0.3, rhythm: 0.45, "spatial-audio": 0.4 },
  },
  domainDecoders: [
    { domain: "rhythm", competenceRange: [0.82, 0.95] },
    { domain: "spatial-audio", competenceRange: [0.8, 0.93] },
  ],
});

const sightedReceived = receiveSignalCandidates({ signals, profile: neutralSighted, environment });
const blindReceived = receiveSignalCandidates({ signals, profile: trainedBlindListener, environment });

assert.ok(sightedReceived.some((row) => row.modality === "visual"), "a sighted observer may receive visual features");
assert.ok(blindReceived.some((row) => row.modality === "sound"), "a blind listener may receive actual sound features");
assert.equal(blindReceived.some((row) => row.modality === "visual"), false, "blindness must remove visual reception rather than rewrite it as prose");
assert.ok(blindReceived.some((row) => row.featureId === "footstep_even_three_beat"), "trained hearing may preserve rhythm evidence");
assert.ok(blindReceived.every((row) => !row.physicalFeature.includes("深蓝")), "visual color must never reach the blind observer");

const swordSpecialist = normalizeCharacterPerceptionProfile({
  sensoryChannels: neutralSighted.sensoryChannels,
  attention: {
    baselineBudget: 2,
    sensitivityThreshold: 0.2,
    orientingBiases: { weapon: 0.72, sword: 0.78, commerce: -0.35 },
  },
  domainDecoders: [{ domain: "sword", competenceRange: [0.86, 0.96] }],
});
const innkeeper = normalizeCharacterPerceptionProfile({
  sensoryChannels: neutralSighted.sensoryChannels,
  attention: {
    baselineBudget: 2,
    sensitivityThreshold: 0.2,
    orientingBiases: { commerce: 0.72, payment: 0.65, clothing: 0.2, sword: -0.2 },
  },
  domainDecoders: [{ domain: "commerce", competenceRange: [0.78, 0.9] }],
});

const swordFrame = buildCharacterPerceptionFrame({
  signals,
  profile: swordSpecialist,
  environment,
  attentionContext: { goalDomains: ["sword"], desireDomains: ["weapon"] },
  seed: "same-scene:sword",
});
const innkeeperFrame = buildCharacterPerceptionFrame({
  signals,
  profile: innkeeper,
  environment,
  attentionContext: { goalDomains: ["commerce"], dutyDomains: ["payment"] },
  seed: "same-scene:innkeeper",
});

assert.ok(swordFrame.noticedEvidence.some((row) => row.featureId === "scabbard_wear_near_mouth"), "sword expertise and desire should foreground weapon evidence");
assert.ok(innkeeperFrame.noticedEvidence.some((row) => row.featureId === "coin_pouch_well_filled"), "innkeeping duty should foreground payment evidence");
assert.notDeepEqual(
  swordFrame.noticedEvidence.map((row) => row.featureId),
  innkeeperFrame.noticedEvidence.map((row) => row.featureId),
  "the same reachable scene must not become one shared conscious evidence list",
);

const hypotheses = [{
  hypothesisId: "hypothesis:fast-draw-practice",
  domain: "sword",
  proposition: "此人可能反复练过贴近鞘口的快速出剑",
  supportingFeatureIds: ["scabbard_wear_near_mouth"],
  baseDiagnosticity: 0.72,
}];
const expertDecode = decodeNoticedEvidence({
  noticedEvidence: swordFrame.noticedEvidence,
  profile: swordSpecialist,
  hypothesisCatalog: hypotheses,
});
const noviceDecode = decodeNoticedEvidence({
  noticedEvidence: swordFrame.noticedEvidence,
  profile: neutralSighted,
  hypothesisCatalog: hypotheses,
});
assert.ok(expertDecode[0]?.confidence > noviceDecode[0]?.confidence, "profession must deepen an uncertain inference rather than reveal a world fact");
assert.equal(expertDecode[0]?.status, "hypothesis", "professional decoding must remain a hypothesis");

const rested = buildCharacterPerceptionFrame({
  signals,
  profile: normalizeCharacterPerceptionProfile({
    sensoryChannels: neutralSighted.sensoryChannels,
    attention: { baselineBudget: 5, sensitivityThreshold: 0.18, overloadSensitivity: 0.8 },
  }),
  environment,
  bodyState: { fatigue: 0.05, pain: 0.02, cognitiveLoad: 0.05 },
  seed: "same-person:rested",
});
const exhausted = buildCharacterPerceptionFrame({
  signals,
  profile: normalizeCharacterPerceptionProfile({
    sensoryChannels: neutralSighted.sensoryChannels,
    attention: { baselineBudget: 5, sensitivityThreshold: 0.18, overloadSensitivity: 0.8 },
  }),
  environment,
  bodyState: { fatigue: 0.92, pain: 0.55, cognitiveLoad: 0.82 },
  seed: "same-person:exhausted",
});
assert.ok(rested.attentionTrace.effectiveBudget > exhausted.attentionTrace.effectiveBudget, "current body and cognitive state must reduce available attention");
assert.ok(rested.noticedEvidence.length >= exhausted.noticedEvidence.length, "the same person may notice fewer details while exhausted");
assert.ok(exhausted.attentionTrace.uncertaintyPenalty > rested.attentionTrace.uncertaintyPenalty, "overload must raise uncertainty rather than create supernatural sensitivity");
assert.equal(Object.hasOwn(swordFrame, "selectedPublicAction"), false, "private perception must not select a public behavior");

const exactDirectedObservation = "对方把余光依次落向你的手、肩胯与持剑侧空间。";
const lowFidelityObservation = projectNoticedPhysicalFeature({
  physicalFeature: exactDirectedObservation,
  modality: "visual",
  domainTags: ["directed", "observe", "action:observe"],
  fidelity: 0.25,
  ambiguity: 0.77,
});
assert.notEqual(lowFidelityObservation, exactDirectedObservation, "low-fidelity perception must not retain narrator-exact visual detail");
assert.equal(/手|肩胯|持剑侧/u.test(lowFidelityObservation), false, "unseen body-part detail must not leak through a vague percept");
assert.match(lowFidelityObservation, /留意你/u, "a directed observation may preserve only the coarse fact that attention was felt");
assert.equal(projectNoticedPhysicalFeature({
  physicalFeature: exactDirectedObservation,
  modality: "visual",
  domainTags: ["directed", "observe", "action:observe"],
  fidelity: 0.86,
  ambiguity: 0.12,
}), exactDirectedObservation, "clear perception may preserve the actual visible detail");
assert.equal(projectNoticedPhysicalFeature({
  physicalFeature: "你打算一直装作没看见？",
  modality: "sound",
  fidelity: 0.25,
  ambiguity: 0.77,
}), "你打算一直装作没看见？", "visual coarsening must not silently rewrite literal speech");

console.log("characterRelativePerception:test passed", {
  blindModalities: [...new Set(blindReceived.map((row) => row.modality))],
  swordNoticed: swordFrame.noticedEvidence.map((row) => row.featureId),
  innkeeperNoticed: innkeeperFrame.noticedEvidence.map((row) => row.featureId),
  restedBudget: rested.attentionTrace.effectiveBudget,
  exhaustedBudget: exhausted.attentionTrace.effectiveBudget,
  lowFidelityObservation,
});
