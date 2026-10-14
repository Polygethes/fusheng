import assert from "node:assert/strict";

import {
  applyCharacterSharedActivityResponse,
  canCharacterUseScopedAccessGrant,
  createCharacterSharedActivityProposal,
  createScopedCharacterAccessGrant,
  isConversationTurnTakingOnlyKind,
} from "../src/server/simulation/characterSharedActivity.mjs";
import { validateAgentGeneratedCandidates } from "../src/server/simulation/characterPsychologyTools.mjs";

function candidateWithSharedActivity(sharedActivity) {
  return {
    originAuthority: "character-agent",
    candidateId: `candidate:${sharedActivity.kind || sharedActivity.operation || "ordinary-speech"}`,
    intention: "由人物本人决定是否开口或提出真实共同行动",
    attemptPrimitive: "speak",
    targetHandle: "char:b",
    perceivedPrerequisites: [],
    expectedEffects: [],
    sharedActivity,
  };
}

assert.equal(isConversationTurnTakingOnlyKind("brief_service_conversation"), true);
assert.equal(isConversationTurnTakingOnlyKind("临时问答"), true);
assert.equal(isConversationTurnTakingOnlyKind("controlled_spar"), false);

const conversationAsJointCommitment = validateAgentGeneratedCandidates([
  candidateWithSharedActivity({
    operation: "propose",
    activityId: "activity:wrong-conversation-ledger",
    kind: "brief_service_conversation",
    participantIds: ["char:b"],
  }),
]);
assert.ok(
  conversationAsJointCommitment.errors.some((row) => row.code === "AGENT_CANDIDATE_SHARED_ACTIVITY_TURN_TAKING_ONLY"),
  "ordinary turn-taking must stay in the conversation thread instead of manufacturing negotiated consent",
);

assert.equal(validateAgentGeneratedCandidates([
  candidateWithSharedActivity({ operation: "none", activityId: "", kind: "", participantIds: [] }),
]).valid, true, "ordinary speech remains a freely chosen Character Agent action");

assert.equal(validateAgentGeneratedCandidates([
  candidateWithSharedActivity({
    operation: "propose",
    activityId: "activity:controlled-spar",
    kind: "controlled_spar",
    participantIds: ["char:b"],
  }),
]).valid, true, "a spoken proposal for a real mutual activity remains valid");

assert.throws(
  () => createCharacterSharedActivityProposal({
    activityId: "activity:world-bypass-conversation",
    kind: "service_inquiry",
    initiatorId: "char:a",
    participantIds: ["char:b"],
  }),
  (error) => error.code === "SHARED_ACTIVITY_TURN_TAKING_ONLY",
  "the world ledger must preserve the same ontology even if a caller bypasses Agent candidate validation",
);

const proposal = createCharacterSharedActivityProposal({
  activityId: "activity:mutual-practice",
  kind: "mutual-practice",
  initiatorId: "char:a",
  participantIds: ["char:a", "char:b"],
  requestedZoneId: "courtyard",
  boundaries: { intensity: "controlled", propertyProtection: true },
  sourceActionId: "action:a:propose",
});

assert.equal(proposal.status, "proposed");
assert.equal(proposal.consentByCharacterId["char:a"], "accepted");
assert.equal(proposal.consentByCharacterId["char:b"], "pending");

assert.throws(
  () => applyCharacterSharedActivityResponse(proposal, { responderId: "char:a", response: "accept", sourceActionId: "action:a:accept-for-b" }),
  (error) => error.code === "SHARED_ACTIVITY_RESPONSE_NOT_OWNED",
  "one Character Agent cannot accept for another participant",
);

const accepted = applyCharacterSharedActivityResponse(proposal, {
  responderId: "char:b",
  response: "accept",
  sourceActionId: "action:b:accept",
});
assert.equal(accepted.status, "accepted");
assert.equal(accepted.consentByCharacterId["char:b"], "accepted");

const countered = applyCharacterSharedActivityResponse(proposal, {
  responderId: "char:b",
  response: "counter",
  sourceActionId: "action:b:counter",
  counter: {
    requestedZoneId: "courtyard",
    boundaries: { intensity: "light-contact", propertyProtection: true },
  },
});
assert.equal(countered.status, "countered");
assert.equal(countered.consentByCharacterId["char:b"], "accepted", "the counterer owns and accepts the revised terms");
assert.equal(countered.consentByCharacterId["char:a"], "pending", "a counteroffer must return decision authority to the other participant");
assert.deepEqual(countered.pendingResponseCharacterIds, ["char:a"]);
assert.equal(countered.requestedZoneId, "courtyard");
assert.equal(countered.boundaries.intensity, "light-contact");

assert.throws(
  () => applyCharacterSharedActivityResponse(countered, { responderId: "char:b", response: "accept", sourceActionId: "action:b:accept-own-counter" }),
  (error) => error.code === "SHARED_ACTIVITY_RESPONSE_NOT_OWNED",
  "the counterer may not answer their own counteroffer",
);

const acceptedCounter = applyCharacterSharedActivityResponse(countered, {
  responderId: "char:a",
  response: "accept",
  sourceActionId: "action:a:accept-counter",
});
assert.equal(acceptedCounter.status, "accepted");
assert.deepEqual(acceptedCounter.pendingResponseCharacterIds, []);
assert.equal(acceptedCounter.consentByCharacterId["char:a"], "accepted");
assert.equal(acceptedCounter.consentByCharacterId["char:b"], "accepted");

const grant = createScopedCharacterAccessGrant({
  grantId: "grant:courtyard:pair",
  grantorId: "char:a",
  authorizedGrantorIds: ["char:a"],
  beneficiaryIds: ["char:b"],
  zoneIds: ["courtyard"],
  activity: accepted,
  issuedAtStep: 9,
  expiresAtStep: 15,
});
assert.equal(canCharacterUseScopedAccessGrant(grant, { characterId: "char:b", zoneId: "courtyard", step: 10 }), true);
assert.equal(canCharacterUseScopedAccessGrant(grant, { characterId: "char:b", zoneId: "kitchen", step: 10 }), false);
assert.equal(canCharacterUseScopedAccessGrant(grant, { characterId: "char:b", zoneId: "courtyard", step: 16 }), false);
assert.equal(canCharacterUseScopedAccessGrant(grant, { characterId: "char:c", zoneId: "courtyard", step: 10 }), false);

assert.throws(
  () => createScopedCharacterAccessGrant({
    grantId: "grant:unauthorized",
    grantorId: "char:b",
    authorizedGrantorIds: ["char:a"],
    beneficiaryIds: ["char:b"],
    zoneIds: ["courtyard"],
    activity: accepted,
    issuedAtStep: 9,
    expiresAtStep: 15,
  }),
  (error) => error.code === "SCOPED_ACCESS_GRANTOR_UNAUTHORIZED",
);

console.log("characterSharedActivityContracts:test passed");
