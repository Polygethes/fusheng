import assert from "node:assert/strict";

import { scoreActionCandidates } from "../src/server/simulation/actionUtility.mjs";

const actor = {
  id: "actor_arbitration_probe",
  traits: { conscientiousness: 0.7 },
  state: { fatigue: 0.1, hunger: 0.1, arousal: 0.35 },
};

const blockedCommitment = scoreActionCandidates({
  actor,
  candidates: [
    {
      id: "blocked_high_tier_commitment",
      priorityClass: "commitment_obligation",
      obligationPriority: 1,
      feasible: false,
      hardGates: [{ id: "verifier-present", passed: false }],
      factors: { duty: 1, commitmentPressure: 1 },
    },
    {
      id: "feasible_personal_desire",
      factors: { desire: 0.9, opportunity: 0.9 },
    },
  ],
});

assert.equal(
  blockedCommitment.selectedCandidateId,
  "feasible_personal_desire",
  "a blocked high-tier commitment must never hide a feasible desire",
);
assert.equal(blockedCommitment.ranked[0].candidateId, "feasible_personal_desire");
assert.equal(blockedCommitment.ranked[1].feasible, false);
assert.ok(blockedCommitment.ranked[1].factorLedger.length, "blocked candidates must retain their factor ledger");

const allBlocked = scoreActionCandidates({
  actor,
  candidates: [
    { id: "blocked_a", priorityClass: "commitment_obligation", feasible: false },
    { id: "blocked_b", priorityClass: "response_obligation", feasible: false },
  ],
});
assert.equal(allBlocked.selectedCandidateId, null, "all-infeasible candidate sets must select null");

const waitVersusDesire = scoreActionCandidates({
  actor,
  candidates: [
    {
      id: "wait_for_absent_verifier",
      priorityClass: "commitment_obligation",
      obligationPriority: 1,
      waitingOnly: true,
      factors: { duty: 0.1, commitmentPressure: 0.1 },
    },
    {
      id: "ask_present_friend",
      factors: { desire: 1, opportunity: 1, relationshipPull: 0.6 },
    },
  ],
});
const waitingRow = waitVersusDesire.ranked.find((row) => row.candidateId === "wait_for_absent_verifier");
assert.equal(waitingRow.priorityTier, 0, "waiting without a visible world change belongs to the ordinary tier");
assert.equal(waitVersusDesire.selectedCandidateId, "ask_present_friend", "an ordinary desire may beat an ordinary waiting action by score");

const pendingRequest = {
  id: "request_direct_answer",
  requesterId: "actor_waiting_friend",
  responderId: actor.id,
  status: "awaiting",
};
const responsePriority = scoreActionCandidates({
  actor,
  candidates: [
    {
      id: "answer_direct_request",
      priorityClass: "response_obligation",
      respondsToRequestId: pendingRequest.id,
      targetActorId: pendingRequest.requesterId,
      factors: { commitmentPressure: 0.1 },
    },
    { id: "strong_private_desire", factors: { desire: 1, opportunity: 1 } },
  ],
  context: { pendingInteractions: [pendingRequest] },
});
assert.equal(responsePriority.selectedCandidateId, "answer_direct_request", "a delivered face-to-face response obligation must still outrank desire");

console.log("causalKernelArbitrationInversion:test passed", {
  selectedFeasible: blockedCommitment.selectedCandidateId,
  allBlocked: allBlocked.selectedCandidateId,
  waitingTier: waitingRow.priorityTier,
  response: responsePriority.selectedCandidateId,
});
