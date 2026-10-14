import assert from "node:assert/strict";

import {
  CHARACTER_LANGUAGE_QUALITY_VERSION,
  buildCharacterLanguageQualityReport,
  observableLanguageSimilarity,
} from "../src/server/evaluation/characterLanguageQuality.mjs";

const PRIVATE_MEMORY_ID = "memory:luo-only:lake-reflection";
const IRRELEVANT_AFFORDANCES = [
  "affordance:test:polish-cup",
  "affordance:test:count-rice",
  "affordance:test:inspect-window",
];

const samples = [
  {
    sampleId: "sample:leak",
    conversationId: "conversation:leak",
    characterId: "character:a",
    turnIndex: 1,
    speechAct: "inform",
    publicMove: "respond",
    utterance: `我按 direct_contact 处理；${PRIVATE_MEMORY_ID} 也记着。`,
    visibleAction: "她停在桌边。",
  },
  {
    sampleId: "sample:repeat:first",
    conversationId: "conversation:repeat",
    characterId: "character:b",
    turnIndex: 1,
    speechAct: "answer",
    publicMove: "answer",
    utterance: "我明早会给你答复。",
  },
  {
    sampleId: "sample:repeat:unmotivated",
    conversationId: "conversation:repeat",
    characterId: "character:b",
    turnIndex: 3,
    speechAct: "answer",
    publicMove: "answer",
    utterance: "我明早会给你答复",
  },
  {
    sampleId: "sample:repeat:motivated",
    conversationId: "conversation:repeat",
    characterId: "character:b",
    turnIndex: 5,
    speechAct: "answer",
    publicMove: "answer",
    utterance: "我明早会给你答复。",
    repetitionMotivation: { intentional: true, basisCode: "listener_did_not_hear" },
  },
  {
    sampleId: "sample:affordance:baseline",
    conversationId: "",
    characterId: "character:c",
    turnIndex: 1,
    speechAct: "inform",
    publicMove: "serve",
    publicTargetRef: "guest:anonymous",
    utterance: "茶在这里。",
    visibleAction: "他把茶盏放稳。",
  },
  {
    sampleId: "sample:affordance:variant",
    conversationId: "",
    characterId: "character:c",
    turnIndex: 1,
    speechAct: "ask",
    publicMove: "challenge",
    publicTargetRef: "guest:anonymous",
    utterance: "去后院比一场？",
    visibleAction: "他按住了剑柄。",
  },
  {
    sampleId: "sample:affordance:stable-baseline",
    conversationId: "",
    characterId: "character:d",
    turnIndex: 1,
    speechAct: "ask",
    publicMove: "ask",
    publicTargetRef: "guest:anonymous",
    utterance: "要茶还是热饭？",
  },
  {
    sampleId: "sample:affordance:stable-variant",
    conversationId: "",
    characterId: "character:d",
    turnIndex: 1,
    speechAct: "ask",
    publicMove: "ask",
    publicTargetRef: "guest:anonymous",
    utterance: "要茶还是热饭？",
  },
];

const report = buildCharacterLanguageQualityReport({
  samples,
  privateIdentifiers: [PRIVATE_MEMORY_ID],
  backendClassifications: ["direct_contact"],
  thresholds: {
    nearRepetition: 0.86,
    affordancePairSimilarity: 0.55,
  },
  pairs: [
    {
      pairId: "pair:affordance:diverged",
      kind: "irrelevant_affordance_enumeration",
      baselineSampleId: "sample:affordance:baseline",
      variantSampleId: "sample:affordance:variant",
      changedInput: { kind: "irrelevant_affordance_enumeration", itemIds: IRRELEVANT_AFFORDANCES },
    },
    {
      pairId: "pair:affordance:stable",
      kind: "irrelevant_affordance_enumeration",
      baselineSampleId: "sample:affordance:stable-baseline",
      variantSampleId: "sample:affordance:stable-variant",
      changedInput: { kind: "irrelevant_affordance_enumeration", itemIds: IRRELEVANT_AFFORDANCES },
    },
  ],
});

assert.equal(report.schemaVersion, CHARACTER_LANGUAGE_QUALITY_VERSION);
assert.equal(report.authority, "observer-only-language-regression-never-runtime-authority");
assert.equal(report.status, "author_review_required");
assert.equal(report.authorAcceptance, "pending");
assert.deepEqual(report.boundary, {
  mayRejectCharacterSpeech: false,
  mayRewriteCharacterSpeech: false,
  maySelectCharacterAction: false,
  mayMutateCharacterOrWorldState: false,
  diagnosticsOnly: true,
});

const codes = report.diagnostics.map((row) => row.code);
assert.ok(codes.includes("BACKEND_CLASSIFICATION_EXPOSED"));
assert.ok(codes.includes("PRIVATE_IDENTIFIER_EXPOSED"));

const repetitions = report.diagnostics.filter((row) => row.code === "UNMOTIVATED_NEAR_REPETITION");
assert.equal(repetitions.length, 1, "an explicitly motivated repetition must not be labelled unmotivated");
assert.equal(repetitions[0].sampleId, "sample:repeat:unmotivated");
assert.ok(repetitions[0].details.similarity >= 0.86);

const divergedPair = report.pairReports.find((row) => row.pairId === "pair:affordance:diverged");
assert.ok(divergedPair);
assert.equal(divergedPair.kind, "irrelevant_affordance_enumeration");
assert.equal(divergedPair.changedInput.itemCount, IRRELEVANT_AFFORDANCES.length);
assert.ok(divergedPair.changedInput.fingerprint);
assert.equal(divergedPair.comparison.publicMoveChanged, true);
assert.equal(divergedPair.comparison.speechActChanged, true);
assert.ok(divergedPair.diagnostics.some((row) => row.code === "IRRELEVANT_AFFORDANCE_PAIR_DIVERGED"));

const stablePair = report.pairReports.find((row) => row.pairId === "pair:affordance:stable");
assert.ok(stablePair);
assert.equal(stablePair.comparison.utteranceSimilarity, 1);
assert.deepEqual(stablePair.diagnostics, []);

assert.ok(observableLanguageSimilarity("我明早会给你答复。", "我明早会给你答复") > 0.99);
assert.ok(observableLanguageSimilarity("茶在这里。", "去后院比一场？") < 0.55);

const serialized = JSON.stringify(report);
assert.equal(serialized.includes(PRIVATE_MEMORY_ID), false, "diagnostics must fingerprint a leaked private id instead of repeating it");
assert.equal(serialized.includes("direct_contact"), false, "diagnostics must not repeat the exposed backend classification");
for (const affordanceId of IRRELEVANT_AFFORDANCES) {
  assert.equal(serialized.includes(affordanceId), false, "paired diagnostics must fingerprint changed affordances instead of publishing them");
}
for (const forbiddenAuthority of ["accepted", "replacementSpeech", "rewrittenSpeech", "suggestedSpeech"]) {
  assert.equal(Object.hasOwn(report, forbiddenAuthority), false);
}

const cleanReport = buildCharacterLanguageQualityReport({
  samples: [{
    sampleId: "sample:clean",
    conversationId: "conversation:clean",
    characterId: "character:clean",
    turnIndex: 1,
    speechAct: "answer",
    publicMove: "answer",
    utterance: "好，我知道了。",
  }],
});
assert.equal(cleanReport.diagnostics.length, 0);
assert.equal(cleanReport.status, "author_review_required", "zero diagnostics still requires author review rather than becoming an automatic pass");
assert.equal(cleanReport.authorAcceptance, "pending");

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    observerOnlyNoRuntimeAuthority: true,
    backendAndPrivateLeakageFingerprinted: true,
    unmotivatedNearRepetitionReported: true,
    motivatedRepetitionNotMislabelled: true,
    irrelevantAffordancePairsRemainDiagnosticOnly: true,
    noSpeechRewriteOrAutomaticAcceptance: true,
  },
}, null, 2));
