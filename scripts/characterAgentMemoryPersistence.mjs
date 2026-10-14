import assert from "node:assert/strict";
import {
  createCharacterAgentMemoryState,
  encodeCharacterPerception,
  reviseCharacterSelfNarrative,
} from "../src/engine/characterAgentMemory.js";
import {
  applyGeneratedSetupWorld,
  applyUpdateBundle,
  exportState,
  getState,
  importState,
  migrateCharacterAgentMemoryV1,
} from "../src/state/store.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const XIE = "char_xyy_xiezenshi";
const ZHOU = "char_xyy_zhoumin";

const legacy = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
delete legacy.characters.find((character) => character.id === XIE).agentMemory;
legacy.characterMemories = [{
  id: "legacy:ambiguous-recommendation-prose",
  characterId: XIE,
  targetCharacterId: ZHOU,
  type: "heard_information",
  content: "周珉和谢真石之间还有一件举荐的事没说清。",
  reliability: 54,
  heat: 70,
  day: 1,
}];
migrateCharacterAgentMemoryV1(legacy);
const migrated = legacy.characters.find((character) => character.id === XIE).agentMemory;
assert.equal(migrated.schemaVersion, 2);
assert.equal(migrated.episodes.length, 1);
assert.equal(migrated.episodes[0].semanticFrame.kind, "legacy_unstructured");
assert.deepEqual(migrated.episodes[0].semanticFrame.roles, {}, "legacy prose must not fabricate requester or beneficiary roles");
assert.equal(migrated.commitments.length, 0, "legacy prose must not create an authoritative pending commitment");
assert.ok(migrated.episodes[0].source.confidence <= 0.65);

const setup = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
applyGeneratedSetupWorld(setup, setup.worldSetup.sourcePrompts);

const current = createCharacterAgentMemoryState(XIE);
const encoded = encodeCharacterPerception(current, {
  impact: {
    id: "impact:persistence:heard-answer",
    objectiveEventId: "action:persistence:heard-answer",
    sourceCharacterId: ZHOU,
    locationId: "loc_xyy_tavern",
    type: "speech",
    modality: "sound",
    content: "真石，举荐的事我还在等你答复。",
    topic: "举荐答复",
    semanticFrame: {
      id: "frame:persistence:recommendation",
      kind: "social_request",
      predicate: "request_recommendation",
      topicId: "recommendation",
      roles: { requester: ZHOU, requestedActor: XIE, beneficiary: ZHOU },
      object: { id: "inner_sect_assessment", label: "内门举荐" },
      requestedAct: "替周珉举荐",
      lexicalAnchors: ["举荐"],
      importance: 0.88,
    },
    provenance: { kind: "firsthand", speakerCharacterId: ZHOU },
  },
  delivery: {
    id: "delivery:persistence:heard-answer",
    impactId: "impact:persistence:heard-answer",
    recipientId: XIE,
    sourceCharacterId: ZHOU,
    recipientZoneId: "hall",
    modality: "sound",
    content: "真石，举荐的事我还在等你答复。",
    topic: "举荐答复",
    directed: true,
    receivedIntensity: 90,
    personalRelevance: 66,
    impactScore: 150,
    distance: 0,
    semanticFrame: {
      id: "frame:persistence:recommendation",
      kind: "social_request",
      predicate: "request_recommendation",
      topicId: "recommendation",
      roles: { requester: ZHOU, requestedActor: XIE, beneficiary: ZHOU },
      object: { id: "inner_sect_assessment", label: "内门举荐" },
      requestedAct: "替周珉举荐",
      lexicalAnchors: ["举荐"],
      importance: 0.88,
    },
    provenance: { kind: "firsthand", speakerCharacterId: ZHOU },
  },
  nowSeconds: 120,
  worldDay: 1,
  locationId: "loc_xyy_tavern",
  zoneId: "hall",
});
const revised = reviseCharacterSelfNarrative(encoded, {
  id: "self-revision:persistence",
  confirmedChoice: true,
  significance: 0.86,
  claim: "我会自己承担举荐答复带来的后果。",
  semanticFrameId: "frame:persistence:recommendation",
  sourceEpisodeIds: [encoded.episodes[0].id],
  reason: "人物把一次有代价的答复纳入自我认识。",
  nowSeconds: 140,
});
revised.selfNarrative.pendingCandidates.push({
  id: "self-narrative-candidate:persistence",
  mode: "conflict_candidate",
  claim: "这次选择也让我开始怀疑自己过去的解释。",
  status: "pending_repetition_or_story_significance",
  proposedAtSeconds: 145,
  worldSignificance: 0.54,
  sourceEpisodeIds: [encoded.episodes[0].id],
  replacesClaimIds: [],
});
applyUpdateBundle({ characters: [{ id: XIE, agentMemory: revised }] });
const serialized = exportState();
assert.ok(serialized.includes("frame:persistence:recommendation"));
importState(serialized);
const restored = getState();
const restoredMemory = restored.characters.find((character) => character.id === XIE).agentMemory;
assert.equal(restored.worldSetup.characterAgentMemoryVersion, 2);
assert.equal(restoredMemory.ownerCharacterId, XIE);
assert.equal(restoredMemory.episodes.find((episode) => episode.sourceImpactId === "impact:persistence:heard-answer").semanticFrame.roles.beneficiary, ZHOU);
assert.equal(restoredMemory.commitments.find((commitment) => commitment.semanticFrame.id === "frame:persistence:recommendation").status, "open");
assert.equal(restoredMemory.selfNarrative.versions[0].id, "self-revision:persistence");
assert.equal(restoredMemory.selfNarrative.currentClaims[0].claim, "我会自己承担举荐答复带来的后果。");
assert.equal(restoredMemory.selfNarrative.pendingCandidates[0].id, "self-narrative-candidate:persistence");
assert.deepEqual(restoredMemory.selfNarrative.pendingCandidates[0].sourceEpisodeIds, [encoded.episodes[0].id]);

console.log("characterAgentMemoryPersistence:test passed", {
  bytes: serialized.length,
  episodes: restoredMemory.episodes.length,
  beliefs: restoredMemory.beliefs.length,
  commitments: restoredMemory.commitments.length,
});
