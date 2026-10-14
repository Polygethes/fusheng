import assert from "node:assert/strict";

import {
  tavernCharacterCandidatesV2Schema,
  tavernCharacterChoiceV2Schema,
  tavernCharacterAgentV2OutputSchemaForStage,
} from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { buildCharacterCommunicationNeedSurface } from "../src/server/simulation/characterSharedContext.mjs";

const OWNER = "character:speaker";
const TARGET = "perceived_entity:listener";
const PREVIOUS_TURN = "public-turn:listener:1";

assert.equal(
  Object.hasOwn(tavernCharacterCandidatesV2Schema.properties.candidates.items.properties, "disclosureNeed"),
  false,
  "candidate generation must not prewrite a public disclosure brief",
);
assert.equal(
  Object.hasOwn(tavernCharacterChoiceV2Schema.properties.regulationChoice.properties, "intendedPublicEffect"),
  false,
  "emotion regulation must not prewrite a public semantic checklist",
);

const selectedAction = {
  candidateId: "candidate:focus:test",
  attemptPrimitive: "speak",
  targetHandle: TARGET,
  sharedActivity: {
    operation: "propose",
    activityId: "activity:focus:test",
    kind: "controlled_spar",
    participantIds: [OWNER, TARGET],
    requestedZoneId: "courtyard",
    response: "none",
    boundaries: {
      intensity: "controlled_probe",
      propertyProtection: true,
      harmLimit: "private harm term",
      note: "private venue term",
    },
  },
};

const surface = buildCharacterCommunicationNeedSurface({
  selectedAction,
  worldProjection: {
    discourseContext: {
      anchorIds: [PREVIOUS_TURN],
      recentPublicTurns: [{
        id: PREVIOUS_TURN,
        speakerId: TARGET,
        addresseeId: OWNER,
        speechAct: "ask",
        speechFunctions: ["ask"],
        utterance: "找我什么事？",
      }],
    },
    sharedActivities: [],
  },
});

assert.equal(surface.selection, null, "the pragmatic tool must not choose the Character's focus");
assert.deepEqual(surface.topicLedger.map((row) => row.topicId), [
  `discourse_turn:${PREVIOUS_TURN}`,
  "selected_action_core",
  "shared_activity_requested_zone",
  "shared_activity_boundary:intensity",
  "shared_activity_boundary:propertyProtection",
  "shared_activity_boundary:harmLimit",
  "shared_activity_boundary:note",
]);
assert.equal(
  surface.topicLedger.find((row) => row.topicId === "shared_activity_boundary:harmLimit").dueStatus,
  "not_automatically_due_now",
);
assert.equal(JSON.stringify(surface).includes("private harm term"), false);
assert.equal(JSON.stringify(surface).includes("private venue term"), false);

const commitSchema = tavernCharacterAgentV2OutputSchemaForStage({
  phase: "awaiting_agent_turn_commit",
  agentTurnId: "agent-turn:focus:test",
  expressionMoment: {
    lockedAction: {
      primitive: "speak",
      targetCharacterId: TARGET,
      actionBinding: { kind: "character", targetCharacterId: TARGET },
    },
    allowedAudienceCharacterIds: [TARGET],
    innerContinuity: { affectiveResidue: { liveEmotions: [] } },
  },
});
const trace = commitSchema.properties.privateExpressionTrace;
assert.equal(
  Object.hasOwn(trace.properties, "communicationFocus"),
  false,
  "a useful shared-context diagnostic must not become a pre-generation speech focus",
);
assert.deepEqual(trace.required, ["affectiveInfluence"]);
assert.deepEqual(commitSchema.properties.publicExpression.properties.utterance.required, ["literalSpeech", "vocalMode"]);

console.log("characterCommunicationFocusContracts:test passed", {
  prematureDisclosureBriefRemoved: true,
  prematurePublicEffectRemoved: true,
  preGenerationFocusRemoved: true,
  literalSpeechSelectedByTool: false,
});
