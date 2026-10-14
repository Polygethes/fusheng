import assert from "node:assert/strict";
import {
  createCharacterAgentMemoryState, encodeCharacterPerception,
  normalizeCharacterAgentMemoryState, normalizeSemanticFrame, retrieveCharacterAgentMemory,
} from "../src/engine/characterAgentMemory.js";
import { projectCharacterMemoryForCurrentSituation } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { runCharacterReflectionTurn } from "../src/server/simulation/characterReflectionTurn.mjs";

const OWNER = "char_xyy_luozhao";
// The actual owner-visible receipt shape from turn 15: speech succeeded while
// showing the packed letter failed. Do not infer a successful handover from it.
const actionResult = {
  status: "partial", primitive: "handle", failureCodes: ["OBJECT_NOT_IN_HAND"],
  resolvedEffectKinds: ["speech_emitted", "speech_delivered"], incidentalEffectKinds: [],
  attemptSurfaceKinds: ["object_handling_attempted", "utterance_emitted"],
};
const input = { nowSeconds: 100, delivery: {
  recipientId: OWNER, impactId: "world-event:letter-show", evidenceId: "evidence:own-result",
  directed: true, modality: "proprioception", content: "刚才的动作只完成了一部分。",
  receivedIntensity: 80,
  semanticFrame: { actionResult: { ...actionResult, otherCharacterPrivateState: "must not leak" } },
} };
const before = JSON.stringify(input);
const encoded = encodeCharacterPerception(createCharacterAgentMemoryState(OWNER), input);
assert.deepEqual(encoded.episodes[0].semanticFrame.actionResult, actionResult,
  "encoding must retain the owner-perceived failure and successful speech separately");
assert.equal(JSON.stringify(input), before, "encoding must not mutate the delivery");
const restored = normalizeCharacterAgentMemoryState(JSON.parse(JSON.stringify(encoded)), OWNER);
assert.deepEqual(restored.episodes[0].semanticFrame.actionResult, actionResult);
assert.equal(encodeCharacterPerception(createCharacterAgentMemoryState("another-character"), input).episodes.length, 0);
assert.equal(normalizeSemanticFrame({}).actionResult, undefined, "ordinary memories stay ordinary");

const retrieved = retrieveCharacterAgentMemory(restored, { nowSeconds: 101, lexicalCues: ["OBJECT_NOT_IN_HAND"], limit: 1 });
assert.deepEqual(retrieved.episodes[0].semanticFrame.actionResult, actionResult);
const projected = projectCharacterMemoryForCurrentSituation({
  memoryContext: restored, characterId: OWNER, nowSeconds: 101,
  currentIntention: "回想刚才呈帖的结果", attendedEvidence: [], perceivedCharacters: [],
  knownEntityReferences: [], relationshipContext: [], currentActivities: [], ownCommitments: [], ecologyProfile: {}, limit: 1,
});
assert.deepEqual(projected.episodes[0].semanticFrame.actionResult, actionResult);

const opportunity = {
  schemaVersion: "character-reflection-v1", authority: "character-private-reflection-opportunity",
  ownerCharacterId: OWNER, opportunityId: "reflection-opportunity:letter", sequence: 1,
  status: "due", dueAtSeconds: 101, accumulatedImportance: 1.1,
  sourceMemoryIds: [restored.episodes[0].id], decisionAuthority: "character-agent", selection: null,
};
let reflectionCalls = 0;
await runCharacterReflectionTurn({
  ownerCharacterId: OWNER, agentTurnId: "agent-turn:letter-reflection", nowSeconds: 101,
  pendingOpportunity: opportunity,
  privateState: {
    ownerCharacterId: OWNER, memoryContext: restored,
    reflectionState: {
      schemaVersion: "character-reflection-v1", authority: "character-private-reflection-ledger",
      ownerCharacterId: OWNER, formulaVersion: 1, threshold: 1, accumulatedImportance: 0,
      pendingOpportunity: opportunity, completedOpportunityIds: [], completedOpportunities: [], nextOpportunitySequence: 2,
    },
  },
  runStage: async stageInput => {
    reflectionCalls += 1;
    assert.deepEqual(stageInput.privateContext.memorySlice.episodes[0].semanticFrame.actionResult, actionResult);
    assert.ok(!JSON.stringify(stageInput).includes("must not leak"));
    return { reflection: { ownerAuthority: "character-agent", insights: [] } };
  },
});
assert.equal(reflectionCalls, 1);

// Re-delivering the same receipt can enrich an old coarse episode. It must not
// erase a character's interpretation, fabricate a new event, or duplicate it.
const legacy = structuredClone(restored);
delete legacy.episodes[0].semanticFrame.actionResult;
legacy.episodes[0].interpretations = [{ id: "interpretation:mistaken", summary: "帖已呈", source: "character-agent-appraisal", confidence: 0.8 }];
const enriched = encodeCharacterPerception(legacy, input);
assert.equal(enriched.episodes.length, 1);
assert.deepEqual(enriched.episodes[0].semanticFrame.actionResult, actionResult);
assert.ok(enriched.episodes[0].interpretations.some(row => row.summary === "帖已呈"));
console.log("Action result memory contracts passed: encode, restore, recall, reflection, owner boundary and replay enrichment.");
