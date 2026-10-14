import assert from "node:assert/strict";

import {
  applyCharacterLocationBeliefUpdate,
  applyCharacterSourceKnowledgeBeliefUpdate,
  buildCharacterEpistemicBeliefState,
  createCharacterAgentMemoryState,
  normalizeCharacterAgentMemoryState,
} from "../src/engine/characterAgentMemory.js";
import {
  generateEpistemicActionCandidates,
  scoreEpistemicActionCandidates,
} from "../src/server/simulation/epistemicActionUtility.mjs";

const OWNER = "char_test_seeker";
const TARGET = "known:target-swordsman";
const TAVERN = "location:tavern";
const INNKEEPER = "perceived:innkeeper";
const GOSSIP = "noticed:gossip-location";
const DIRECT = "noticed:direct-location-cue";
const CONTRADICTION = "noticed:departure-cue";
const SOURCE_EVIDENCE = "noticed:innkeeper-knows-locals";

const initial = createCharacterAgentMemoryState(OWNER);
assert.deepEqual(initial.locationBeliefs, []);
assert.deepEqual(initial.sourceKnowledgeBeliefs, []);

const gossip = applyCharacterLocationBeliefUpdate(initial, {
  subjectHandle: TARGET,
  locationHandle: TAVERN,
  operation: "revise",
  assertedLikelihood: 0.82,
  sourceReliability: 0.2,
  confidenceBand: "low",
  basisEvidenceIds: [GOSSIP],
  sourceType: "gossip",
}, { allowedEvidenceIds: [GOSSIP], nowSeconds: 10 });
assert.equal(gossip.valid, true);
assert.ok(gossip.belief.currentLikelihood < 0.3, "weak gossip must not become a strong location belief");
assert.equal(gossip.belief.worldTruthUsed, false);

const direct = applyCharacterLocationBeliefUpdate(gossip.memory, {
  subjectHandle: TARGET,
  locationHandle: TAVERN,
  operation: "revise",
  assertedLikelihood: 0.92,
  sourceReliability: 0.96,
  confidenceBand: "high",
  basisEvidenceIds: [DIRECT],
  sourceType: "firsthand",
}, { allowedEvidenceIds: [GOSSIP, DIRECT], nowSeconds: 20 });
assert.equal(direct.valid, true);
assert.ok(direct.belief.currentLikelihood > gossip.belief.currentLikelihood + 0.4, "strong firsthand evidence must revise the private location belief");
const highLikelihood = direct.belief.currentLikelihood;

const contradicted = applyCharacterLocationBeliefUpdate(direct.memory, {
  subjectHandle: TARGET,
  locationHandle: TAVERN,
  operation: "revise",
  assertedLikelihood: 0.04,
  sourceReliability: 0.92,
  confidenceBand: "high",
  basisEvidenceIds: [CONTRADICTION],
  sourceType: "firsthand",
}, { allowedEvidenceIds: [GOSSIP, DIRECT, CONTRADICTION], nowSeconds: 30 });
assert.equal(contradicted.valid, true);
assert.ok(contradicted.belief.currentLikelihood < highLikelihood, "contradictory evidence must lower the current belief");
assert.ok(contradicted.belief.priorPresenceLikelihood >= highLikelihood, "the character may remember that the target was likely here even after believing they left");
assert.ok(contradicted.belief.revisionHistory.length === 3);

const withSourceKnowledge = applyCharacterSourceKnowledgeBeliefUpdate(contradicted.memory, {
  sourceHandle: INNKEEPER,
  subjectHandle: TARGET,
  operation: "revise",
  assertedLikelihood: 0.74,
  sourceReliability: 0.82,
  confidenceBand: "medium",
  basisEvidenceIds: [SOURCE_EVIDENCE],
}, {
  allowedEvidenceIds: [GOSSIP, DIRECT, CONTRADICTION, SOURCE_EVIDENCE],
  nowSeconds: 31,
});
assert.equal(withSourceKnowledge.valid, true);
assert.ok(
  withSourceKnowledge.belief.likelihood > 0.35
    && withSourceKnowledge.belief.likelihood < withSourceKnowledge.update.assertedLikelihood,
  "medium-confidence source evidence should raise a useful but still uncertain private belief",
);

const epistemicBeliefs = buildCharacterEpistemicBeliefState(withSourceKnowledge.memory, {
  hypotheses: [
    { id: "candidate:a", probability: 0.5 },
    { id: "candidate:b", probability: 0.5 },
  ],
});
assert.equal(epistemicBeliefs.locationBeliefs[0].subjectHandle, TARGET);
assert.equal(epistemicBeliefs.sourceKnowledgeBeliefs[0].sourceHandle, INNKEEPER);
assert.ok(epistemicBeliefs.priorPresenceBeliefs[0].likelihood >= highLikelihood);
assert.equal(Object.hasOwn(epistemicBeliefs, "canonicalWorldLocations"), false);

const candidates = generateEpistemicActionCandidates({
  informationGoal: {
    goalId: "goal:locate-target",
    subjectHandle: TARGET,
    descriptors: [{ id: "descriptor:sword-user", baseRate: 0.82 }],
  },
  currentLocationHandle: TAVERN,
  perceivedSources: [{ handle: INNKEEPER, role: "掌柜" }],
  availableAffordances: [
    { id: "affordance:listen", epistemicPrimitive: "listen" },
    { id: "affordance:observe", epistemicPrimitive: "observe", targetHandle: INNKEEPER },
    { id: "affordance:ask", epistemicPrimitive: "ask", targetHandle: INNKEEPER },
    { id: "affordance:wait", epistemicPrimitive: "wait" },
    { id: "affordance:leave", epistemicPrimitive: "leave" },
  ],
  beliefState: epistemicBeliefs,
});
const primitives = new Set(candidates.map((row) => row.primitive));
assert.ok(primitives.has("listen"));
assert.ok(primitives.has("observe"));
assert.ok(primitives.has("ask_source_knowledge"));
assert.ok(primitives.has("ask_current_presence"));
assert.ok(primitives.has("ask_prior_presence"));
assert.ok(primitives.has("wait"));
assert.ok(primitives.has("leave"));
assert.ok(candidates.every((row) => !Object.hasOwn(row, "speech")), "the planner must not prewrite a question or line");
assert.ok(candidates.every((row) => !Object.hasOwn(row, "selected")), "candidate generation must not choose for the Character Agent");
assert.ok(candidates.find((row) => row.primitive === "ask_prior_presence").presuppositions.some((row) => row.kind === "prior_presence"));

const ranked = scoreEpistemicActionCandidates({
  actorProfile: {
    informationStyle: {
      directInquiry: 0.25,
      concealmentNeed: 0.9,
      patience: 0.8,
      verificationThreshold: 0.82,
    },
  },
  beliefState: epistemicBeliefs,
  candidates,
  context: { urgency: 0.15 },
});
assert.equal(ranked.selection.authority, "character-agent");
assert.equal(ranked.selection.selectedCandidateId, null);
assert.ok(ranked.selection.pool.length >= 5);

const unsupported = applyCharacterLocationBeliefUpdate(withSourceKnowledge.memory, {
  subjectHandle: TARGET,
  locationHandle: TAVERN,
  operation: "revise",
  assertedLikelihood: 1,
  sourceReliability: 1,
  confidenceBand: "high",
  basisEvidenceIds: ["noticed:not-owned"],
}, { allowedEvidenceIds: [GOSSIP, DIRECT, CONTRADICTION, SOURCE_EVIDENCE], nowSeconds: 40 });
assert.equal(unsupported.valid, false);
assert.ok(unsupported.violations.some((row) => row.code === "LOCATION_BELIEF_EVIDENCE_NOT_OWNED"));

const restored = normalizeCharacterAgentMemoryState(JSON.parse(JSON.stringify(withSourceKnowledge.memory)), OWNER);
assert.equal(restored.locationBeliefs[0].locations[0].revisionHistory.length, 3);
assert.equal(restored.sourceKnowledgeBeliefs[0].sourceHandle, INNKEEPER);

console.log("characterLocationBeliefPlanning:test passed", {
  gossipLikelihood: gossip.belief.currentLikelihood,
  firsthandLikelihood: highLikelihood,
  contradictedLikelihood: contradicted.belief.currentLikelihood,
  candidateCount: candidates.length,
  topAdvisoryCandidate: ranked.selection.pool[0].candidateId,
});
