import assert from "node:assert/strict";

import { normalizeSemanticFrame } from "../src/engine/characterAgentMemory.js";
import { projectCharacterMemoryForCurrentSituation } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

const OWNER = "char:test:owner";
const TARGET = "perceived_entity:test:target";

function episode(index, { relevant = false } = {}) {
  const topic = relevant ? "剑术求证" : `无关旧事${index}`;
  return {
    id: `episode:test:${index}`,
    ownerCharacterId: OWNER,
    kind: "experienced_event",
    evidenceIds: [`evidence:test:${index}`],
    perceivedAt: { seconds: index + 1 },
    perception: {
      content: relevant ? "那人问起后院是否可以试剑。" : `很久以前的无关杂事${index}。`,
      topic,
      sourceCharacterId: relevant ? TARGET : `perceived_entity:test:irrelevant:${index}`,
    },
    semanticFrame: normalizeSemanticFrame({
      id: `frame:test:${index}`,
      predicate: relevant ? "request_spar" : "unrelated_event",
      topicId: relevant ? "sword_exchange" : `unrelated_topic_${index}`,
      roles: { actor: relevant ? TARGET : `perceived_entity:test:irrelevant:${index}` },
      lexicalAnchors: relevant ? ["试剑", "后院"] : [`旧事${index}`],
    }),
    accessibility: 0.82,
    retentionStrength: 0.78,
    importance: relevant ? 0.92 : 0.35,
    source: { sourceEntityHandle: relevant ? TARGET : "", confidence: 0.8 },
    revisionHistory: Array.from({ length: 12 }, (_, revision) => ({
      revision,
      payload: `episode-history-${index}-${revision}`,
    })),
  };
}

const durableMemory = {
  schemaVersion: 2,
  ownerCharacterId: OWNER,
  episodes: [episode(0, { relevant: true }), ...Array.from({ length: 48 }, (_, index) => episode(index + 1))],
  beliefs: Array.from({ length: 40 }, (_, index) => ({
    id: `belief:test:${index}`,
    ownerCharacterId: OWNER,
    propositionKey: `unrelated::${index}`,
    proposition: `无关认识${index}`,
    currentValue: "adopt",
    confidence: 0.6,
    status: "supported",
    semanticFrame: normalizeSemanticFrame({ predicate: "unrelated_belief", topicId: `unrelated_topic_${index}` }),
    supportingEpisodeIds: [`episode:test:${index + 1}`],
    lastUpdatedAtSeconds: index + 1,
    revisionHistory: Array.from({ length: 10 }, (_, revision) => ({
      revision,
      payload: `belief-history-${index}-${revision}`,
    })),
  })),
  commitments: [{
    id: "commitment:test:open",
    ownerCharacterId: OWNER,
    status: "open",
    topic: "稍后给对方一个答复",
    counterpartyCharacterId: TARGET,
    sourceEpisodeIds: ["episode:test:0"],
    updatedAtSeconds: 1,
  }],
  impressions: [],
  privateEntityModels: [
    {
      id: "private-entity:test:target",
      ownerCharacterId: OWNER,
      perceivedEntityHandle: TARGET,
      hypotheses: [{ proposition: "可能是来求证剑术的人", confidence: 0.56 }],
      attentionPriority: 0.9,
      lastUpdatedAtSeconds: 4,
      historicalSnapshots: Array.from({ length: 8 }, (_, revision) => ({ revision, payload: `entity-history-${revision}` })),
    },
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `private-entity:test:irrelevant:${index}`,
      ownerCharacterId: OWNER,
      perceivedEntityHandle: `perceived_entity:test:irrelevant:${index}`,
      attentionPriority: 0.2,
      lastUpdatedAtSeconds: index + 10,
    })),
  ],
  locationBeliefs: [],
  sourceKnowledgeBeliefs: [],
  experienceTraces: Array.from({ length: 64 }, (_, index) => ({ id: `trace:test:${index}`, payload: "不应进入当轮上下文" })),
  recallInstances: [],
  selfNarrative: {
    currentClaims: [{ id: "self-claim:test", claim: "我会亲自决定是否应战", confidence: 0.8 }],
    pendingCandidates: [],
    versions: [],
  },
  lastAdvancedAtSeconds: 100,
};

const before = JSON.stringify(durableMemory);
const projected = projectCharacterMemoryForCurrentSituation({
  memoryContext: durableMemory,
  characterId: OWNER,
  nowSeconds: 120,
  currentIntention: "弄清对方为何问起试剑",
  attendedEvidence: [{
    impactId: "impact:test:current",
    sourceEntityHandle: TARGET,
    content: "后院能用么？",
    topic: "剑术求证",
    semanticFrame: normalizeSemanticFrame({ predicate: "request_spar", topicId: "sword_exchange", lexicalAnchors: ["试剑"] }),
  }],
  perceivedCharacters: [{ id: TARGET }],
  currentActivities: [{ description: "照看眼下的堂前" }],
  ownCommitments: [],
  ecologyProfile: { desires: [{ desireId: "desire:test", label: "判断对方的剑" }] },
  limit: 6,
});

assert.equal(JSON.stringify(durableMemory), before, "current recall projection must not mutate durable Character memory");
assert.ok(projected.episodes.length <= 6, "one turn receives a bounded episode slice");
assert.ok(projected.episodes.some((row) => row.id === "episode:test:0"), "current cues retrieve the older relevant episode");
assert.ok(projected.commitments.some((row) => row.id === "commitment:test:open"), "an unresolved owned commitment survives projection");
assert.equal(projected.privateEntityModels.length, 1, "current-person models displace unrelated person dossiers");
assert.equal(projected.privateEntityModels[0].perceivedEntityHandle, TARGET);
assert.equal(projected.selfNarrative.currentClaims[0].id, "self-claim:test", "the current self-model survives situational retrieval");
assert.equal(Object.hasOwn(projected, "experienceTraces"), false, "raw experience traces stay in durable private storage");
assert.equal(projected.episodes.some((row) => Object.hasOwn(row, "revisionHistory")), false, "episode revision ledgers stay in durable memory");
assert.equal(projected.beliefs.some((row) => Object.hasOwn(row, "revisionHistory")), false, "belief revision ledgers stay in durable memory");
assert.equal(projected.privateEntityModels.some((row) => Object.hasOwn(row, "historicalSnapshots")), false, "entity-model history stays in durable memory");
assert.equal(projected.contextProjection.selection, null, "memory retrieval informs the Character and does not select an action");
assert.ok(JSON.stringify(projected).length < JSON.stringify(durableMemory).length * 0.35, "the current context is materially smaller than durable memory");

console.log(JSON.stringify({
  status: "passed",
  durableBytes: JSON.stringify(durableMemory).length,
  projectedBytes: JSON.stringify(projected).length,
  projectedEpisodeCount: projected.episodes.length,
  checks: {
    durableMemoryUnchanged: true,
    relevantRecallRetained: true,
    unresolvedCommitmentRetained: true,
    currentEntityModelRetained: true,
    selfNarrativeRetained: true,
    durableRevisionLedgersOmittedFromTurnContext: true,
    actionAuthorityRemainsCharacterOwned: true,
  },
}, null, 2));
