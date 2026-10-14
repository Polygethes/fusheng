import assert from "node:assert/strict";

import {
  createCharacterAgentMemoryState,
  encodeCharacterPerception,
  reconstructCharacterAgentMemory,
} from "../src/engine/characterAgentMemory.js";

const OWNER = "char_test_recaller";
const SOURCE = "char_test_source";

const impact = {
  id: "impact:recall:promise",
  objectiveEventId: "event:recall:promise",
  sourceCharacterId: SOURCE,
  type: "speech",
  modality: "sound",
  content: "我明早把药送到后门。",
  topic: "送药约定",
  semanticFrame: {
    id: "frame:recall:promise",
    kind: "communication",
    predicate: "promise_delivery",
    topicId: "medicine-delivery",
    roles: { speaker: SOURCE, addressee: OWNER },
    object: { id: "medicine", label: "药" },
    lexicalAnchors: ["明早", "药", "后门"],
    importance: 0.76,
  },
  provenance: { kind: "firsthand", speakerCharacterId: SOURCE },
};

const encoded = encodeCharacterPerception(createCharacterAgentMemoryState(OWNER), {
  impact,
  delivery: {
    id: "evidence:recall:promise",
    evidenceId: "evidence:recall:promise",
    impactId: impact.id,
    objectiveEventId: impact.objectiveEventId,
    recipientId: OWNER,
    sourceCharacterId: SOURCE,
    perceivedSourceCharacterId: SOURCE,
    identityKnown: true,
    modality: "sound",
    content: impact.content,
    topic: impact.topic,
    directed: true,
    receivedIntensity: 94,
    personalRelevance: 62,
    impactScore: 148,
    semanticFrame: impact.semanticFrame,
    provenance: impact.provenance,
  },
  beliefMode: "deferred",
  nowSeconds: 20,
  worldDay: 1,
  locationId: "loc_test_tavern",
  zoneId: "hall",
  encodingContext: {
    attention: 0.92,
    goalRelevance: 0.84,
    surprise: 0.3,
    emotionalArousal: 0.4,
    selfRelevance: 0.82,
    relationshipRelevance: 0.55,
    fatigue: 0.1,
    cognitiveLoad: 0.1,
  },
});

const originalTrace = structuredClone(encoded.experienceTraces[0]);
const cues = {
  nowSeconds: 3600,
  characterIds: [SOURCE],
  topicIds: ["medicine-delivery"],
  predicates: ["promise_delivery"],
  lexicalCues: ["药", "明早"],
  limit: 4,
};

const clearRecall = reconstructCharacterAgentMemory(encoded, cues, {
  profile: {
    cueSensitivity: 0.9,
    sourceSensitivity: 0.94,
    sourceConfusionRate: 0.04,
    interferenceSensitivity: 0.35,
    suppressionSensitivity: 0.4,
  },
  context: {
    fatigue: 0.05,
    cognitiveLoad: 0.08,
    emotionalArousal: 0.25,
    goalCongruence: 0.86,
    interference: 0.03,
    rehearsal: 0.2,
  },
});

assert.equal(clearRecall.memory.recallInstances.length, 1);
assert.equal(clearRecall.memory.episodes[0].retrievalCount, 1);
assert.deepEqual(clearRecall.memory.experienceTraces[0], originalTrace, "recall must not rewrite the original experience trace");
assert.equal(clearRecall.memory.beliefs.length, 0, "remembering evidence must not silently turn it into belief");
const clearInstance = clearRecall.memoryContext.recallInstances[0];
assert.equal(clearInstance.sourceEpisodeIds[0], encoded.episodes[0].id);
assert.equal(clearInstance.sourceTraceIds[0], encoded.experienceTraces[0].id);
assert.equal(clearInstance.sourceAttribution.status, "identified");
assert.equal(clearRecall.memoryContext.episodes[0].perception.content, clearInstance.rememberedContent);
assert.equal(Object.hasOwn(clearRecall.memoryContext, "experienceTraces"), false, "the Character Agent recall view must not expose an exact immutable trace replay");

const strainedRecall = reconstructCharacterAgentMemory(encoded, cues, {
  profile: {
    cueSensitivity: 0.55,
    sourceSensitivity: 0.22,
    sourceConfusionRate: 0.9,
    interferenceSensitivity: 0.95,
    affectBiasSensitivity: 0.9,
    beliefBiasSensitivity: 0.9,
    suppressionSensitivity: 0.85,
  },
  context: {
    fatigue: 0.95,
    cognitiveLoad: 0.92,
    emotionalArousal: 0.82,
    goalCongruence: 0.2,
    currentBeliefBias: 0.78,
    currentAffectBias: 0.74,
    interference: 0.88,
    suppression: 0.65,
  },
});

const strainedInstance = strainedRecall.memoryContext.recallInstances[0];
assert.ok(strainedInstance.reconstruction.fidelity < clearInstance.reconstruction.fidelity, "the same engram must reconstruct differently under a different current state");
assert.ok(strainedInstance.reconstruction.sourceClarity < clearInstance.reconstruction.sourceClarity);
assert.ok(strainedInstance.reconstruction.distortionPressure > clearInstance.reconstruction.distortionPressure);
assert.notEqual(strainedInstance.detailBand, "vivid");
assert.ok(strainedInstance.distortionFlags.includes("source_uncertain"));
assert.deepEqual(strainedRecall.memory.experienceTraces[0], originalTrace, "even a distorted recall must preserve the encoded sensory trace");

const repeatedRecall = reconstructCharacterAgentMemory(clearRecall.memory, { ...cues, nowSeconds: 3700 }, {
  profile: { rumination: 0.9 },
  context: { rehearsal: 0.45, goalCongruence: 0.8 },
});
assert.equal(repeatedRecall.memory.episodes[0].retrievalCount, 2);
assert.equal(repeatedRecall.memory.recallInstances.length, 2, "different retrieval moments must remain separate recall instances");
assert.notEqual(repeatedRecall.memory.recallInstances[0].id, repeatedRecall.memory.recallInstances[1].id);
assert.deepEqual(repeatedRecall.memory.experienceTraces[0], originalTrace);

console.log("characterAgentMemoryRecall:test passed", {
  clear: {
    detailBand: clearInstance.detailBand,
    fidelity: clearInstance.reconstruction.fidelity,
    sourceClarity: clearInstance.reconstruction.sourceClarity,
  },
  strained: {
    detailBand: strainedInstance.detailBand,
    fidelity: strainedInstance.reconstruction.fidelity,
    sourceClarity: strainedInstance.reconstruction.sourceClarity,
    flags: strainedInstance.distortionFlags,
  },
  recallInstances: repeatedRecall.memory.recallInstances.length,
});
