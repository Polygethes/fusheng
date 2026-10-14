import assert from "node:assert/strict";

import { createCharacterAgentMemoryState } from "../src/engine/characterAgentMemory.js";
import {
  advanceCharacterReflectionOpportunity,
  settleCharacterReflectionOpportunity,
} from "../src/server/simulation/characterReflection.mjs";

const OWNER = "char_reflection_owner";
const OTHER = "char_reflection_other";

function episode(id, importance, atSeconds = 0) {
  return {
    id,
    ownerCharacterId: OWNER,
    kind: "episodic_perception",
    objectiveEventId: `event:${id}`,
    sourceImpactId: `impact:${id}`,
    sourceImpactIds: [`impact:${id}`],
    evidenceIds: [`evidence:${id}`],
    perceivedAt: { seconds: atSeconds, worldDay: 0, locationId: "town", zoneId: "square" },
    perception: { modality: "vision", content: id, topic: id, fragments: [] },
    semanticFrame: {
      id: `frame:${id}`,
      kind: "observation",
      predicate: "notice",
      topicId: id,
      lexicalAnchors: [id],
      importance,
    },
    source: { kind: "firsthand", confidence: 0.9 },
    retentionStrength: 0.8,
    accessibility: 0.8,
    importance,
    retrievalCues: [id],
    interpretations: [],
    status: "active",
  };
}

function memory(episodes = [], beliefs = []) {
  return {
    ...createCharacterAgentMemoryState(OWNER),
    episodes,
    beliefs,
  };
}

const policy = { threshold: 1, maxSourceMemoryIds: 12 };
let reflectionState = null;

let advanced = advanceCharacterReflectionOpportunity({
  ownerCharacterId: OWNER,
  previousMemoryState: memory(),
  nextMemoryState: memory([episode("episode:one", 0.6, 10)]),
  reflectionState,
  nowSeconds: 10,
  policy,
});
reflectionState = advanced.reflectionState;
assert.equal(advanced.dueOpportunity, null, "importance below the threshold must remain private accumulation");
assert.equal(reflectionState.accumulatedImportance, 0.6);

advanced = advanceCharacterReflectionOpportunity({
  ownerCharacterId: OWNER,
  previousMemoryState: memory([episode("episode:one", 0.6, 10)]),
  nextMemoryState: memory([episode("episode:one", 0.6, 10)]),
  reflectionState,
  nowSeconds: 11,
  policy,
});
reflectionState = advanced.reflectionState;
assert.equal(reflectionState.accumulatedImportance, 0.6, "reapplying an episode must not count its importance twice");

advanced = advanceCharacterReflectionOpportunity({
  ownerCharacterId: OWNER,
  previousMemoryState: memory([episode("episode:one", 0.6, 10)]),
  nextMemoryState: memory([episode("episode:one", 0.8, 10)]),
  reflectionState,
  nowSeconds: 12,
  policy,
});
reflectionState = advanced.reflectionState;
assert.equal(reflectionState.accumulatedImportance, 0.8, "later importance growth must count only the positive delta");

const thresholdMemory = memory([
  episode("episode:one", 0.8, 10),
  episode("episode:two", 0.3, 13),
]);
advanced = advanceCharacterReflectionOpportunity({
  ownerCharacterId: OWNER,
  previousMemoryState: memory([episode("episode:one", 0.8, 10)]),
  nextMemoryState: thresholdMemory,
  reflectionState,
  nowSeconds: 13,
  policy,
});
reflectionState = advanced.reflectionState;
assert.equal(advanced.dueOpportunity?.status, "due");
assert.deepEqual(advanced.dueOpportunity?.sourceMemoryIds, ["episode:one", "episode:two"]);
assert.deepEqual(
  advanced.dueOpportunity?.sourceMemorySnapshots?.map((row) => row.id),
  ["episode:one", "episode:two"],
  "a due reflection must freeze its bounded owner-private source slice before durable memory compaction can evict it",
);
assert.equal(reflectionState.accumulatedImportance, 0);

const pendingId = advanced.dueOpportunity.opportunityId;
const repeated = advanceCharacterReflectionOpportunity({
  ownerCharacterId: OWNER,
  previousMemoryState: thresholdMemory,
  nextMemoryState: thresholdMemory,
  reflectionState,
  nowSeconds: 14,
  policy,
});
assert.equal(repeated.dueOpportunity.opportunityId, pendingId, "an unsettled opportunity must remain stable across replay");

assert.throws(() => settleCharacterReflectionOpportunity({
  ownerCharacterId: OWNER,
  memoryState: thresholdMemory,
  reflectionState,
  opportunityId: pendingId,
  submission: {
    ownerAuthority: "character-agent",
    insights: [{ proposition: "偷看别人的记忆", sourceMemoryIds: ["episode:not-owned"] }],
  },
  nowSeconds: 15,
}), (error) => error?.code === "CHARACTER_REFLECTION_SOURCE_NOT_OWNED");
assert.equal(reflectionState.pendingOpportunity.opportunityId, pendingId, "an invalid submission must not consume the opportunity");

assert.throws(() => settleCharacterReflectionOpportunity({
  ownerCharacterId: OWNER,
  memoryState: thresholdMemory,
  reflectionState,
  opportunityId: pendingId,
  submission: { ownerAuthority: "character-agent", insights: [], worldPatch: { weather: "rain" } },
  nowSeconds: 15,
}), (error) => error?.code === "CHARACTER_REFLECTION_WORLD_WRITE_FORBIDDEN");

assert.throws(() => settleCharacterReflectionOpportunity({
  ownerCharacterId: OWNER,
  memoryState: memory([], [{
    id: "belief:foreign-owner",
    ownerCharacterId: OTHER,
    kind: "belief",
    proposition: "另一个角色的私有判断",
  }]),
  reflectionState: {
    ownerCharacterId: OWNER,
    threshold: 1,
    pendingOpportunity: {
      ownerCharacterId: OWNER,
      opportunityId: "reflection-opportunity:foreign-belief",
      status: "due",
      sourceMemoryIds: ["belief:foreign-owner"],
      sourceMemorySnapshots: [],
    },
  },
  opportunityId: "reflection-opportunity:foreign-belief",
  submission: {
    ownerAuthority: "character-agent",
    insights: [{
      proposition: "不得借用另一个角色的私有判断",
      sourceMemoryIds: ["belief:foreign-owner"],
    }],
  },
  nowSeconds: 15,
}), (error) => error?.code === "CHARACTER_REFLECTION_MEMORY_OWNER_MISMATCH");

const emptySettlement = settleCharacterReflectionOpportunity({
  ownerCharacterId: OWNER,
  memoryState: thresholdMemory,
  reflectionState,
  opportunityId: pendingId,
  submission: { ownerAuthority: "character-agent", insights: [] },
  nowSeconds: 15,
});
assert.equal(emptySettlement.settlement.insightCount, 0);
assert.equal(emptySettlement.reflectionState.pendingOpportunity, null, "zero insights must still consume a valid opportunity");
assert.equal(emptySettlement.memoryState.beliefs.length, thresholdMemory.beliefs.length);

advanced = advanceCharacterReflectionOpportunity({
  ownerCharacterId: OWNER,
  previousMemoryState: thresholdMemory,
  nextMemoryState: memory([...thresholdMemory.episodes, episode("episode:three", 1, 16)]),
  reflectionState: emptySettlement.reflectionState,
  nowSeconds: 16,
  policy,
});
assert.notEqual(advanced.dueOpportunity.opportunityId, pendingId, "a later threshold crossing must create a new opportunity");

const insightSettlement = settleCharacterReflectionOpportunity({
  ownerCharacterId: OWNER,
  memoryState: memory([...thresholdMemory.episodes, episode("episode:three", 1, 16)]),
  reflectionState: advanced.reflectionState,
  opportunityId: advanced.dueOpportunity.opportunityId,
  submission: {
    ownerAuthority: "character-agent",
    insights: [{
      proposition: "我总在热闹之后寻找安静",
      sourceMemoryIds: ["episode:three"],
      confidence: 0.72,
      importance: 0.8,
      semanticFrame: {
        kind: "reflection_insight",
        predicate: "seek",
        topicId: "quiet_after_crowds",
        lexicalAnchors: ["安静", "热闹"],
      },
    }],
  },
  nowSeconds: 17,
});
const insight = insightSettlement.memoryState.beliefs.find((row) => row.kind === "reflection_insight");
assert.equal(insight.ownerCharacterId, OWNER);
assert.deepEqual(insight.sourceMemoryIds, ["episode:three"]);
assert.equal(insight.sourceReflectionOpportunityId, advanced.dueOpportunity.opportunityId);
assert.equal(insight.reasoningMode, "inference");
assert.equal(insightSettlement.settlement.worldChanged, false);

const noRecursiveReflection = advanceCharacterReflectionOpportunity({
  ownerCharacterId: OWNER,
  previousMemoryState: insightSettlement.memoryState,
  nextMemoryState: insightSettlement.memoryState,
  reflectionState: insightSettlement.reflectionState,
  nowSeconds: 18,
  policy,
});
assert.equal(noRecursiveReflection.dueOpportunity, null, "reflection beliefs must not recursively add episode importance");
assert.equal(noRecursiveReflection.reflectionState.accumulatedImportance, 0);

const ACCOUNTED_LEDGER_PROBE_SIZE = 300;
const accountedImportanceByMemoryId = Object.fromEntries(
  Array.from({ length: ACCOUNTED_LEDGER_PROBE_SIZE }, (_, index) => [
    `episode:ledger:${index + 1}`,
    0.7,
  ]),
);
const reintroducedAccountedEpisode = advanceCharacterReflectionOpportunity({
  ownerCharacterId: OWNER,
  previousMemoryState: memory(),
  nextMemoryState: memory([episode("episode:ledger:1", 0.9, 20)]),
  reflectionState: {
    ownerCharacterId: OWNER,
    accumulatedImportance: 0,
    accountedImportanceByMemoryId,
  },
  nowSeconds: 20,
  policy: { threshold: 1000 },
});
assert.equal(
  Object.keys(reintroducedAccountedEpisode.reflectionState.accountedImportanceByMemoryId).length,
  ACCOUNTED_LEDGER_PROBE_SIZE,
  "the importance high-water map is a semantic idempotency ledger, so it must not be lossy-tail-trimmed",
);
assert.equal(
  reintroducedAccountedEpisode.reflectionState.accumulatedImportance,
  0.2,
  "an episode reintroduced after leaving memory may contribute only importance above its retained high-water mark",
);

console.log("character reflection opportunity contracts passed");
