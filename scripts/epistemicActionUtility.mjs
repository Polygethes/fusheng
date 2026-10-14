import assert from "node:assert/strict";

import {
  evaluateQuestionPresuppositions,
  generateEpistemicActionCandidates,
  scoreEpistemicActionCandidates,
  valueInformationLocation,
} from "../src/server/simulation/epistemicActionUtility.mjs";

const TARGET = "known:target";
const INNKEEPER = "perceived:innkeeper";
const TAVERN = "location:tavern";

function beliefs({ targetAtTavern = 0.08, innkeeperKnowsTarget = 0.55, priorPresence = 0 } = {}) {
  return {
    hypotheses: [
      { id: "candidate:a", probability: 0.25 },
      { id: "candidate:b", probability: 0.25 },
      { id: "candidate:c", probability: 0.25 },
      { id: "candidate:d", probability: 0.25 },
    ],
    locationBeliefs: [{
      subjectHandle: TARGET,
      locations: [{ locationHandle: TAVERN, likelihood: targetAtTavern }],
      unknownMass: Math.max(0, 1 - targetAtTavern),
    }],
    sourceKnowledgeBeliefs: [{ sourceHandle: INNKEEPER, subjectHandle: TARGET, likelihood: innkeeperKnowsTarget }],
    priorPresenceBeliefs: [{ subjectHandle: TARGET, locationHandle: TAVERN, likelihood: priorPresence }],
  };
}

const stillHereQuestion = {
  candidateId: "ask:is-still-here",
  primitive: "ask_direct",
  targetHandle: INNKEEPER,
  informationGoal: "locate target",
  presuppositions: [
    { kind: "target_at_location", subjectHandle: TARGET, locationHandle: TAVERN, minimumLikelihood: 0.45 },
    { kind: "prior_presence", subjectHandle: TARGET, locationHandle: TAVERN, minimumLikelihood: 0.5 },
    { kind: "source_knows_subject", sourceHandle: INNKEEPER, subjectHandle: TARGET, minimumLikelihood: 0.35 },
  ],
  expectedPosteriors: [
    { probability: 0.5, distribution: [0.82, 0.06, 0.06, 0.06] },
    { probability: 0.5, distribution: [0.06, 0.3133, 0.3133, 0.3134] },
  ],
  disclosurePayload: 0.92,
  reactionDiagnosticity: 0.32,
  goalProgress: 0.85,
  controlValue: 0.65,
  socialCost: 0.1,
  timeCost: 0.08,
  uncertaintyRisk: 0.12,
  feasible: true,
};

const noClueAssessment = evaluateQuestionPresuppositions({
  questionPlan: stillHereQuestion,
  beliefState: beliefs(),
});
const supportedAssessment = evaluateQuestionPresuppositions({
  questionPlan: stillHereQuestion,
  beliefState: beliefs({ targetAtTavern: 0.72, priorPresence: 0.88 }),
});
assert.ok(noClueAssessment.mismatch > 0.5, "‘还在不在’ must expose its unsupported location and prior-presence assumptions");
assert.ok(supportedAssessment.mismatch < noClueAssessment.mismatch, "owned location evidence must lower the same question's presupposition cost");
assert.equal(noClueAssessment.blocked, false, "presupposition mismatch is a private cost, not speech censorship");

const broadSwordQuestion = {
  candidateId: "ask:any-sword-user",
  primitive: "ask_indirect",
  targetHandle: INNKEEPER,
  informationGoal: "find a rumored swordsman",
  presuppositions: [
    { kind: "source_knows_subject", sourceHandle: INNKEEPER, subjectHandle: TARGET, minimumLikelihood: 0.25 },
  ],
  expectedPosteriors: [
    { probability: 0.8, distribution: [0.28, 0.24, 0.24, 0.24] },
    { probability: 0.2, distribution: [0.15, 0.2833, 0.2833, 0.2834] },
  ],
  descriptorBaseRate: 0.82,
  disclosurePayload: 0.22,
  reactionDiagnosticity: 0.5,
  goalProgress: 0.25,
  controlValue: 0.35,
  socialCost: 0.08,
  timeCost: 0.12,
  uncertaintyRisk: 0.62,
  feasible: true,
};
const listenQuietly = {
  candidateId: "observe:listen",
  primitive: "listen",
  targetHandle: "",
  informationGoal: "collect local references without disclosing target",
  expectedInformationGain: 0.26,
  disclosurePayload: 0,
  reactionDiagnosticity: 0.12,
  goalProgress: 0.24,
  controlValue: 0.42,
  socialCost: 0.02,
  timeCost: 0.3,
  uncertaintyRisk: 0.35,
  feasible: true,
};

const secretive = scoreEpistemicActionCandidates({
  actorProfile: {
    informationStyle: {
      concealmentNeed: 0.95,
      directInquiry: 0.2,
      patience: 0.82,
      socialRiskSensitivity: 0.75,
    },
  },
  beliefState: beliefs(),
  candidates: [stillHereQuestion, broadSwordQuestion, listenQuietly],
  context: { urgency: 0.12 },
});
const urgentDirect = scoreEpistemicActionCandidates({
  actorProfile: {
    informationStyle: {
      concealmentNeed: 0.08,
      directInquiry: 0.96,
      patience: 0.08,
      socialRiskSensitivity: 0.12,
    },
  },
  beliefState: beliefs({ targetAtTavern: 0.76, priorPresence: 0.82, innkeeperKnowsTarget: 0.8 }),
  candidates: [stillHereQuestion, broadSwordQuestion, listenQuietly],
  context: { urgency: 0.92 },
});

const secretiveById = new Map(secretive.evaluations.map((row) => [row.candidateId, row]));
const urgentById = new Map(urgentDirect.evaluations.map((row) => [row.candidateId, row]));
assert.ok(
  secretiveById.get("ask:any-sword-user").expectedInformationGain < secretiveById.get("ask:is-still-here").expectedInformationGain,
  "a high-base-rate sword descriptor must carry less information than a discriminating question",
);
assert.equal(secretiveById.get("ask:any-sword-user").feasible, true, "a low-information question remains available for concealment, probing or error");
assert.equal(secretive.selection.pool[0].candidateId, "observe:listen", "a patient secretive person must be able to prefer silent evidence gathering over inquiry");
assert.notEqual(secretive.selection.pool[0].candidateId, urgentDirect.selection.pool[0].candidateId, "personality, evidence and current urgency must change epistemic ranking");
assert.equal(secretive.selection.authority, "character-agent");
assert.equal(secretive.selection.selectedCandidateId, null, "the mathematical tool must not choose the public action");
assert.equal(urgentDirect.selection.selectedCandidateId, null, "even a strong direct-query ranking remains advisory");
assert.ok(
  urgentById.get("ask:is-still-here").score > secretiveById.get("ask:is-still-here").score,
  "reliable location evidence and urgency should make direct inquiry more competitive without creating a rule",
);

const lowLocationValue = valueInformationLocation({
  beliefState: beliefs(),
  subjectHandle: TARGET,
  locationHandle: TAVERN,
  informationValue: 0.8,
  otherNeedFit: 0,
  travelCost: 0.25,
  timeCost: 0.2,
  exposureCost: 0.15,
});
const mealAndInformationValue = valueInformationLocation({
  beliefState: beliefs(),
  subjectHandle: TARGET,
  locationHandle: TAVERN,
  informationValue: 0.8,
  otherNeedFit: 0.72,
  travelCost: 0.1,
  timeCost: 0.12,
  exposureCost: 0.08,
});
assert.ok(mealAndInformationValue.score > lowLocationValue.score, "a tavern may be worth entering for another need without revealing that the target is there");
assert.equal(lowLocationValue.worldTruthUsed, false, "location value must use owned belief rather than canonical target position");

const claimProbeCandidates = generateEpistemicActionCandidates({
  informationGoal: { goalId: "verify-rumor", subjectHandle: TARGET, descriptors: [] },
  currentLocationHandle: TAVERN,
  perceivedSources: [{ handle: INNKEEPER }],
  availableAffordances: [{ id: "ask:innkeeper", epistemicPrimitive: "ask", targetHandle: INNKEEPER }],
  beliefState: {
    ...beliefs(),
    claimBeliefs: [{
      beliefId: "belief:owned-rumor",
      subjectHandle: TARGET,
      claimSummary: "听过一条尚未证实的目标人物传闻",
      confidence: 0.52,
      confidenceBand: "uncertain",
      sourceStatus: "hearsay",
      basisEvidenceIds: ["evidence:owned-hearsay"],
    }],
  },
});
const claimProbe = claimProbeCandidates.find((row) => row.primitive === "ask_claim_reaction");
assert.ok(claimProbe, "an owned uncertain claim must become a direct reaction-probe option");
assert.equal(claimProbe.ownedClaimReference.truthStatus, "character-owned-unverified-claim");
assert.equal(claimProbe.ownedClaimReference.beliefId, "belief:owned-rumor");
assert.equal(claimProbe.ownedClaimReference.basisEvidenceIds.includes("evidence:owned-hearsay"), true);
assert.equal(Object.hasOwn(claimProbe, "speech"), false, "the tool exposes a claim, not a prewritten question");

console.log("epistemicActionUtility:test passed", {
  noClueMismatch: noClueAssessment.mismatch,
  supportedMismatch: supportedAssessment.mismatch,
  secretiveTop: secretive.selection.pool[0].candidateId,
  urgentTop: urgentDirect.selection.pool[0].candidateId,
});
