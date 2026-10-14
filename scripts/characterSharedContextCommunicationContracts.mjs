import assert from "node:assert/strict";

import {
  buildCharacterAgentStageInput,
  createCharacterAgentTurnSession,
} from "../src/server/simulation/characterAgentTurnProtocol.mjs";
import { buildCharacterCommunicationNeedSurface } from "../src/server/simulation/characterSharedContext.mjs";

const OWNER = "character:challenger";
const TARGET = "perceived_entity:opponent";
const ACTIVITY = "activity:controlled-spar:test";
const PRIVATE_HARM_TERM = "PRIVATE_HARM_TERM_MUST_NOT_BECOME_WORDING_INPUT";
const PRIVATE_NOTE = "PRIVATE_VENUE_TERM_MUST_NOT_BECOME_WORDING_INPUT";

const selectedCandidate = {
  candidateId: "candidate:propose-spar",
  intention: "直接提出交手，同时把完整安全判断留在自己掌握中。",
  attemptPrimitive: "speak",
  targetHandle: TARGET,
  actionBinding: {
    kind: "none",
    targetCharacterId: "",
    objectId: "",
    destinationId: "",
    positionId: "",
    affordanceId: "",
  },
  domains: ["martial", "social"],
  timingIntent: "现在提出，等待对方回应。",
  sharedActivity: {
    operation: "propose",
    activityId: ACTIVITY,
    kind: "controlled_spar",
    participantIds: [OWNER, TARGET],
    requestedZoneId: "courtyard",
    response: "none",
    boundaries: {
      intensity: "controlled_probe",
      propertyProtection: true,
      harmLimit: PRIVATE_HARM_TERM,
      note: PRIVATE_NOTE,
    },
  },
};

const directSurface = buildCharacterCommunicationNeedSurface({
  selectedAction: selectedCandidate,
  worldProjection: {
    discourseContext: { anchorIds: ["public-turn:previous"] },
    sharedActivities: [],
  },
  automaticCommunicationImpulse: { discourseAnchorIds: ["public-turn:previous"] },
});
assert.equal(directSurface.selection, null);
assert.equal(directSurface.literalSpeech, null);
assert.equal(directSurface.coreTopics[0].semanticRole, "make_activity_recognizable_and_invite_response");
assert.equal(directSurface.coordinationTopics[0].requestedZoneId, "courtyard");
assert.deepEqual(directSurface.privateBoundaryLedger.map((row) => row.field), [
  "intensity",
  "propertyProtection",
  "harmLimit",
  "note",
]);
assert.equal(directSurface.privateBoundaryLedger.every((row) => row.explicitCommunicationPressure === "not_automatically_due_now"), true);
assert.equal(JSON.stringify(directSurface).includes(PRIVATE_HARM_TERM), false);
assert.equal(JSON.stringify(directSurface).includes(PRIVATE_NOTE), false);

const existingSurface = buildCharacterCommunicationNeedSurface({
  selectedAction: selectedCandidate,
  worldProjection: {
    sharedActivities: [{
      activityId: ACTIVITY,
      status: "proposed",
      requestedZoneId: "courtyard",
      boundaries: structuredClone(selectedCandidate.sharedActivity.boundaries),
    }],
  },
});
assert.equal(existingSurface.sharedUnderstandingPresent, true);
assert.equal(existingSurface.coordinationTopics[0].status, "already_shared");
assert.equal(existingSurface.privateBoundaryLedger.every((row) => row.status === "already_shared"), true);

const changedCandidate = structuredClone(selectedCandidate);
changedCandidate.sharedActivity.boundaries.intensity = "full_force";
const changedSurface = buildCharacterCommunicationNeedSurface({
  selectedAction: changedCandidate,
  worldProjection: {
    sharedActivities: [{
      activityId: ACTIVITY,
      status: "accepted",
      requestedZoneId: "courtyard",
      boundaries: structuredClone(selectedCandidate.sharedActivity.boundaries),
    }],
  },
});
assert.equal(
  changedSurface.privateBoundaryLedger.find((row) => row.field === "intensity").explicitCommunicationPressure,
  "elevated",
  "a changed term is surfaced as a pragmatic pressure without the tool writing or selecting speech",
);

const session = createCharacterAgentTurnSession({
  agentTurnId: "agent-turn:shared-context:test",
  characterId: OWNER,
  submissionMode: "atomic",
  worldProjection: {
    authority: "recipient-specific-world-projection",
    scene: { placeId: "place:test", zoneId: "hall" },
    evidence: [],
    perceivedCharacters: [{ id: TARGET }],
    discourseContext: { anchorIds: ["public-turn:previous"] },
    sharedActivities: [],
  },
  privateContext: {
    state: { body: { fatigue: 0.1 } },
    relationships: [],
    voiceContract: {},
  },
});
session.phase = "awaiting_agent_turn_commit";
session.generatedCandidates = [structuredClone(selectedCandidate)];
session.agentChoice = {
  selectedCandidateId: selectedCandidate.candidateId,
  automaticCommunicationImpulse: {
    impulseId: "impulse:shared-context:test",
    discourseAnchorIds: ["public-turn:previous"],
  },
};
session.regulationOutcome = {
  sourceRegulationChoiceId: "regulation:test",
  residualEmotion: [],
  channelLeakagePressures: {},
  remainingControl: 0.8,
  regulationCost: 0.1,
};
session.psychologySnapshot = {
  emotionMixture: [],
  affectSummary: { arousal: 0.3 },
  actionTendencies: {},
  controlCapacity: 0.8,
  cognitiveLoad: 0.2,
  uncertainty: 0.2,
};

const commitInput = buildCharacterAgentStageInput(session);
assert.equal(commitInput.requestedOutput, "character_turn_commit_only");
assert.equal(commitInput.expressionMoment.lockedAction.sharedActivity.kind, "controlled_spar");
assert.equal(commitInput.expressionMoment.lockedAction.sharedActivity.privateBoundaryTermsPresent, true);
assert.equal(Object.hasOwn(commitInput.expressionMoment.lockedAction.sharedActivity, "boundaries"), false, "the full private activity contract must not become a wording checklist");
assert.equal(commitInput.communicationNeedSurface, undefined, "shared-context diagnostics must stop before literal wording");
const serializedCommitInput = JSON.stringify(commitInput);
assert.equal(serializedCommitInput.includes(PRIVATE_HARM_TERM), false);
assert.equal(serializedCommitInput.includes(PRIVATE_NOTE), false);
assert.deepEqual(session.generatedCandidates[0].sharedActivity.boundaries, selectedCandidate.sharedActivity.boundaries, "redacting the expression input must not delete the Character-owned activity understanding");

console.log("characterSharedContextCommunicationContracts:test passed", {
  privateActivityTermsRetained: true,
  publicChecklistPressureRemoved: true,
  actionSelectionAuthority: "character-agent",
  literalSpeechAuthoredByTool: false,
});
