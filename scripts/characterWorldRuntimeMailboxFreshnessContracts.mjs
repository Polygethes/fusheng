import assert from "node:assert/strict";

import { createLocalCharacterRuntimePort } from "../src/server/simulation/characterRuntimePort.mjs";
import { createCharacterSessionActor } from "../src/server/simulation/characterSessionActor.mjs";
import {
  markCharacterEvidenceAppraised,
  markCharacterEvidenceNoticed,
  registerCharacterEventDelivery,
} from "../src/server/simulation/characterEventReceipts.mjs";
import { createWorldActionRegistry } from "../src/server/simulation/worldActionRegistry.mjs";
import { createWorldCommitCoordinator } from "../src/server/simulation/worldCommitCoordinator.mjs";
import { createCharacterWorldRuntime } from "../src/server/simulation/characterWorldRuntime.mjs";

const CHARACTER_ID = "char:mailbox-owner";
const OLD_EVIDENCE_ID = "evidence:self-observation:old";
const FRESH_EVIDENCE_ID = "evidence:external-gesture:fresh";
const seenWakes = [];

const actor = createCharacterSessionActor({
  characterId: CHARACTER_ID,
  privateState: {
    ownerCharacterId: CHARACTER_ID,
    ecologyState: {
      characterPsychologyV2State: {
        continuationIntentions: [{
          ownerAuthority: "character-agent",
          intentionId: "continuation:current",
          triggerType: "own_action_settled",
          status: "active",
        }],
      },
    },
  },
  runtimePort: createLocalCharacterRuntimePort({
    async runTurn(input) {
      seenWakes.push(structuredClone(input.wake));
      const evidenceIds = (input.worldProjection.evidence || []).map((row) => row.evidenceId);
      return {
        characterId: CHARACTER_ID,
        agentTurnId: input.agentTurnId,
        privateStatePatch: {},
        privateResult: {
          evidenceReceiptSettlement: {
            authority: "character-agent",
            noticedEvidenceIds: evidenceIds,
            appraisedEvidenceIds: evidenceIds,
            consumedEvidenceIds: [],
            consumptionDisposition: "explicitly_deferred",
          },
        },
        actionAttempt: null,
      };
    },
  }),
});

const coordinator = createWorldCommitCoordinator({
  worldId: "world:mailbox-freshness",
  initialWorldState: {
    worldId: "world:mailbox-freshness",
    entities: {
      [CHARACTER_ID]: {
        id: CHARACTER_ID,
        kind: "character",
        present: true,
        placeId: "place:test",
        zoneId: "hall",
      },
    },
    objects: {},
    signals: [],
    places: {
      "place:test": {
        topology: { zones: { hall: { id: "hall" } }, edges: [] },
        socialBoundaries: [],
        accessGrants: [],
      },
    },
  },
  actionRegistry: createWorldActionRegistry(),
});

const runtime = createCharacterWorldRuntime({
  coordinator,
  actors: [actor],
  situationProjector({ characterId, wake }) {
    return {
      authority: "recipient-specific-world-projection",
      recipientCharacterId: characterId,
      place: { placeId: "place:test", zoneId: "hall" },
      evidence: structuredClone(wake.evidence || []),
      perceivedCharacters: [],
    };
  },
});

function registerDelivery({ eventId, deliveryId, evidenceId }) {
  registerCharacterEventDelivery(runtime.receiptLedger, {
    id: deliveryId,
    objectiveEventId: eventId,
    recipientId: CHARACTER_ID,
    evidenceId,
    modality: "visual",
  }, { deliveredAtSeconds: 0, step: 0 });
}

registerDelivery({
  eventId: "event:self-observation:old",
  deliveryId: "delivery:self-observation:old",
  evidenceId: OLD_EVIDENCE_ID,
});
await runtime.enqueueWake(CHARACTER_ID, {
  wakeId: "wake:self-observation:old",
  kind: "world_evidence",
  eventId: "event:self-observation:old",
  evidenceIds: [OLD_EVIDENCE_ID],
  evidence: [{ evidenceId: OLD_EVIDENCE_ID, content: "old self observation" }],
});

// Reproduce the Phase 93 cross-path condition: the evidence is appraised as
// retained/self evidence while its original wake remains in the mailbox.
markCharacterEvidenceNoticed(runtime.receiptLedger, {
  characterId: CHARACTER_ID,
  evidenceIds: [OLD_EVIDENCE_ID],
  agentTurnId: "agent-turn:bypass:1",
  step: 0,
});
markCharacterEvidenceAppraised(runtime.receiptLedger, {
  characterId: CHARACTER_ID,
  evidenceIds: [OLD_EVIDENCE_ID],
  agentTurnId: "agent-turn:bypass:1",
  step: 0,
});

registerDelivery({
  eventId: "event:external-gesture:fresh",
  deliveryId: "delivery:external-gesture:fresh",
  evidenceId: FRESH_EVIDENCE_ID,
});
await runtime.enqueueWake(CHARACTER_ID, {
  wakeId: "wake:external-gesture:fresh",
  kind: "world_evidence",
  eventId: "event:external-gesture:fresh",
  evidenceIds: [FRESH_EVIDENCE_ID],
  evidence: [{ evidenceId: FRESH_EVIDENCE_ID, content: "fresh external gesture" }],
});

await runtime.enqueueWake(CHARACTER_ID, {
  wakeId: "wake:continuation:stale",
  kind: "continuation_due",
  continuationIntentionIds: ["continuation:obsolete"],
  evidenceIds: [],
  evidence: [],
});
await runtime.enqueueWake(CHARACTER_ID, {
  wakeId: "wake:continuation:current",
  kind: "continuation_due",
  continuationIntentionIds: ["continuation:current"],
  evidenceIds: [],
  evidence: [],
});

const turn = await runtime.runNext();

assert.equal(
  turn.wake.wakeId,
  "wake:external-gesture:fresh",
  "an already-appraised stale wake must be pruned before a genuinely fresh external impact is selected",
);
assert.deepEqual(
  seenWakes[0].evidenceIds,
  [FRESH_EVIDENCE_ID],
  "historical evidence may remain in memory but must not re-enter the current noticed-evidence settlement",
);
assert.equal(
  actor.mailbox.some((wake) => wake.wakeId === "wake:self-observation:old"),
  false,
  "settled evidence invalidates every pending mailbox wake that still carries it",
);
assert.equal(
  actor.mailbox.some((wake) => wake.wakeId === "wake:continuation:stale"),
  false,
  "continuations no longer owned by the character's active private intentions are garbage-collected",
);
assert.equal(
  actor.mailbox.some((wake) => wake.wakeId === "wake:continuation:current"),
  true,
  "a still-active continuation remains available without being selected for the character",
);

const EARLIER_OWN_RESULT = "evidence:own-result:earlier";
const LATER_DIRECT_SPEECH = "evidence:direct-speech:later";
for (const [eventId, deliveryId, evidenceId] of [
  ["event:own-result:earlier", "delivery:own-result:earlier", EARLIER_OWN_RESULT],
  ["event:direct-speech:later", "delivery:direct-speech:later", LATER_DIRECT_SPEECH],
]) registerDelivery({ eventId, deliveryId, evidenceId });

await runtime.enqueueWake(CHARACTER_ID, {
  wakeId: "wake:own-result:earlier",
  kind: "world_evidence",
  eventId: "event:own-result:earlier",
  evidenceIds: [EARLIER_OWN_RESULT],
  evidence: [{ evidenceId: EARLIER_OWN_RESULT, eventKind: "own_action_result", content: "earlier own result" }],
});
await runtime.enqueueWake(CHARACTER_ID, {
  wakeId: "wake:direct-speech:later",
  kind: "world_evidence",
  eventId: "event:direct-speech:later",
  evidenceIds: [LATER_DIRECT_SPEECH],
  evidence: [{ evidenceId: LATER_DIRECT_SPEECH, eventKind: "speech", directed: true, content: "later direct speech" }],
});

const currentTurn = await runtime.runNext();
assert.deepEqual(
  currentTurn.wake.sourceWakeIds,
  ["wake:own-result:earlier", "wake:direct-speech:later"],
  "one thought opportunity must retain every causal wake id it coalesces",
);
assert.deepEqual(
  seenWakes[1].evidenceIds,
  [EARLIER_OWN_RESULT, LATER_DIRECT_SPEECH],
  "the Character Agent must see every fresh delivery available at the current world version, not answer an older wake before a newer addressed line",
);
assert.equal(
  actor.mailbox.some((wake) => ["wake:own-result:earlier", "wake:direct-speech:later"].includes(wake.wakeId)),
  false,
  "all coalesced wakes settle atomically only after the Character Agent turn succeeds",
);

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    staleAppraisedEvidenceWakePruned: true,
    freshExternalEvidenceRunsFirst: true,
    historicalEvidenceNotRenoticed: true,
    obsoleteContinuationPruned: true,
    activeContinuationPreserved: true,
    currentFreshDeliveriesCoalesced: true,
  },
}, null, 2));
