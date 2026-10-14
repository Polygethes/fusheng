import assert from "node:assert/strict";

import {
  normalizeSemanticFrame,
  retrieveCharacterAgentMemory,
} from "../src/engine/characterAgentMemory.js";
import { projectCharacterMemoryForCurrentSituation } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

const OWNER = "char:test:stored-cue-owner";
const STORED_CUE = "雨后木牌";

function episode(id, perceivedAtSeconds, retrievalCues) {
  return {
    id,
    ownerCharacterId: OWNER,
    kind: "episodic_perception",
    evidenceIds: [`evidence:${id}`],
    perceivedAt: { seconds: perceivedAtSeconds },
    perception: {
      modality: "visual",
      content: "一件没有额外语义提示的旧事。",
      topic: "普通旧事",
      sourceCharacterId: "",
    },
    semanticFrame: normalizeSemanticFrame({
      id: `frame:${id}`,
      kind: "observation",
      predicate: "notice_old_event",
      topicId: "ordinary_old_event",
      object: { id: `object:${id}`, label: "普通物件" },
      lexicalAnchors: [],
      importance: 0.5,
    }),
    retrievalCues,
    accessibility: 0.5,
    retentionStrength: 0.5,
    importance: 0.5,
    retrievalCount: 0,
  };
}

const cueRelevantEpisode = episode("episode:test:stored-cue-relevant", 1, [STORED_CUE]);
const newerDistractor = episode("episode:test:newer-distractor", 2, ["无关线索"]);
const durableMemory = {
  schemaVersion: 2,
  ownerCharacterId: OWNER,
  experienceTraces: [],
  episodes: [cueRelevantEpisode, newerDistractor],
  beliefs: [],
  commitments: [],
  impressions: [],
  privateEntityModels: [],
  locationBeliefs: [],
  sourceKnowledgeBeliefs: [],
  recallInstances: [],
  selfNarrative: { currentClaims: [], versions: [], pendingCandidates: [] },
  lastAdvancedAtSeconds: 10,
  lastEncodedAtSeconds: 2,
};

const before = JSON.stringify(durableMemory);
const retrieved = retrieveCharacterAgentMemory(durableMemory, {
  nowSeconds: 10,
  lexicalCues: [STORED_CUE],
  limit: 2,
});

assert.equal(
  retrieved.episodes[0]?.id,
  cueRelevantEpisode.id,
  "a cue stored on an episode must outrank a newer otherwise-equal distractor",
);
const relevantTrace = retrieved.retrievalTrace.find((row) => row.episodeId === cueRelevantEpisode.id);
const distractorTrace = retrieved.retrievalTrace.find((row) => row.episodeId === newerDistractor.id);
assert.ok(
  Number(relevantTrace?.cueMatch || 0) > Number(distractorTrace?.cueMatch || 0),
  "the retrieval trace must expose the stored-cue match instead of hiding the ranking cause",
);
assert.equal(retrieved.ownerCharacterId, OWNER, "retrieval remains scoped to the owning Character memory");
assert.equal(JSON.stringify(durableMemory), before, "retrieval must not mutate durable private memory");

const projected = projectCharacterMemoryForCurrentSituation({
  memoryContext: durableMemory,
  characterId: OWNER,
  nowSeconds: 10,
  currentIntention: STORED_CUE,
  attendedEvidence: [],
  perceivedCharacters: [],
  knownEntityReferences: [],
  relationshipContext: [],
  currentActivities: [],
  ownCommitments: [],
  ecologyProfile: {},
  limit: 2,
});

assert.equal(
  projected.episodes[0]?.id,
  cueRelevantEpisode.id,
  "the v2.7 bounded memory projection must preserve stored-cue ranking",
);
assert.equal(projected.ownerCharacterId, OWNER, "the projected memory slice remains owner-private");
assert.equal(projected.contextProjection.selection, null, "retrieval may inform the Character but must not select an action");
assert.equal(JSON.stringify(durableMemory), before, "projection must not mutate durable private memory");

console.log("character stored retrieval cues contract passed");
