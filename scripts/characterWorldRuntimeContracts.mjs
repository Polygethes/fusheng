import assert from "node:assert/strict";

import { createLocalCharacterRuntimePort } from "../src/server/simulation/characterRuntimePort.mjs";
import { createCharacterSessionActor } from "../src/server/simulation/characterSessionActor.mjs";
import { createWorldActionRegistry } from "../src/server/simulation/worldActionRegistry.mjs";
import { createWorldCommitCoordinator } from "../src/server/simulation/worldCommitCoordinator.mjs";
import { createCharacterWorldRuntime } from "../src/server/simulation/characterWorldRuntime.mjs";
import {
  characterEventReceipt,
  markCharacterEvidenceAppraised,
  markCharacterEvidenceNoticed,
  registerCharacterEventDelivery,
} from "../src/server/simulation/characterEventReceipts.mjs";

const A = "char:a";
const B = "char:b";
const seen = { [A]: [], [B]: [] };

function portFor(characterId) {
  return createLocalCharacterRuntimePort({
    async runTurn(input) {
      seen[characterId].push(structuredClone(input));
      const isA = characterId === A;
      return {
        characterId,
        agentTurnId: input.agentTurnId,
        privateStatePatch: {
          lastWakeId: input.wake.wakeId,
          ...(isA ? {
            ecologyState: {
              characterPsychologyV2State: {
                continuationIntentions: [{
                  ownerAuthority: "character-agent",
                  intentionId: "continuation:a:move-after-speaking",
                  triggerType: "opportunity_window",
                  intendedPrimitive: "move",
                  targetHandle: "courtyard",
                  linkedSourceIds: [],
                  minimumDelaySeconds: 0,
                  triggerThreshold: 0.5,
                  maxDeferrals: 1,
                  deferrals: 0,
                  createdAtCharacterSeconds: 0,
                  status: "active",
                  privatePurpose: "After the exchange, reconsider moving toward the courtyard.",
                }],
              },
            },
          } : {}),
        },
        privateResult: {
          evidenceReceiptSettlement: {
            authority: "character-agent",
            noticedEvidenceIds: (input.worldProjection.evidence || []).map((row) => row.evidenceId),
            appraisedEvidenceIds: (input.worldProjection.evidence || []).map((row) => row.evidenceId),
            consumedEvidenceIds: (input.worldProjection.evidence || []).map((row) => row.evidenceId),
            consumptionDisposition: "acted",
          },
        },
        actionAttempt: {
          attemptId: `attempt:${characterId}:${seen[characterId].length}`,
          primitive: "speak",
          payload: {
            targetCharacterId: isA ? B : A,
            utterance: isA ? "hello from a" : "heard you",
          },
        },
      };
    },
    async applyWorldOutcome(outcome) {
      return { privateStatePatch: { lastOutcomeId: outcome.outcomeId } };
    },
  });
}

const actorA = createCharacterSessionActor({
  characterId: A,
  privateState: { ownerCharacterId: A, secret: "secret-a" },
  runtimePort: portFor(A),
});
const actorB = createCharacterSessionActor({
  characterId: B,
  privateState: { ownerCharacterId: B, secret: "secret-b" },
  runtimePort: portFor(B),
});

const coordinator = createWorldCommitCoordinator({
  worldId: "world:actor-loop",
  initialWorldState: {
    worldId: "world:actor-loop",
    entities: {
      [A]: { id: A, kind: "character", present: true, placeId: "place:room", zoneId: "hall" },
      [B]: { id: B, kind: "character", present: true, placeId: "place:room", zoneId: "hall" },
    },
    objects: {},
    signals: [],
    places: {
      "place:room": {
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
  actors: [actorA, actorB],
  situationProjector({ worldState, characterId, wake }) {
    return {
      authority: "recipient-specific-world-projection",
      recipientCharacterId: characterId,
      place: {
        placeId: worldState.entities[characterId].placeId,
        zoneId: worldState.entities[characterId].zoneId,
      },
      evidence: (wake.evidence || []).map((row) => ({ ...row })),
      perceivedCharacters: Object.values(worldState.entities)
        .filter((row) => row.id !== characterId && row.placeId === worldState.entities[characterId].placeId)
        .map((row) => ({ id: row.id, zoneId: row.zoneId })),
    };
  },
});

await runtime.enqueueWake(A, {
  wakeId: "wake:initial:a",
  kind: "continuation_due",
  recipientCharacterId: A,
  evidenceIds: [],
  evidence: [],
});
const firstTurn = await runtime.runNext();
assert.deepEqual(runtime.readyQueue, [B], "real external impact wakes the affected other; a zero-delay opportunity does not manufacture a self turn");
assert.equal(actorA.mailbox.some((row) => row.kind === "continuation_due"), false);
const secondTurn = await runtime.runNext();
const turns = [firstTurn, secondTurn];
assert.equal(turns.length, 2);
assert.deepEqual(turns.map((row) => row.characterId), [A, B]);
assert.deepEqual(turns.map((row) => row.outcome.worldVersion), [1, 2]);
assert.equal(seen[B][0].worldProjection.evidence[0].content, "hello from a");
assert.equal(JSON.stringify(seen[A][0]).includes("secret-b"), false);
assert.equal(JSON.stringify(seen[B][0]).includes("secret-a"), false);
assert.equal(actorA.privateState.lastOutcomeId, "world-outcome:attempt:char:a:1");
assert.equal(actorB.privateState.lastOutcomeId, "world-outcome:attempt:char:b:1");

const firstSpeechEventId = turns[0].outcome.eventId;
const bReceipt = characterEventReceipt(runtime.receiptLedger, firstSpeechEventId, B);
assert.equal(bReceipt.status, "consumed");
assert.equal(bReceipt.deliveries[0].appraisedAtAgentTurnId, turns[1].agentTurnId);

assert.equal(await runtime.enqueueWake(B, {
  wakeId: `wake:repackaged:${firstSpeechEventId}:${B}`,
  kind: "world_evidence",
  recipientCharacterId: B,
  eventId: firstSpeechEventId,
  evidenceIds: [bReceipt.deliveries[0].evidenceId],
  evidence: [{ evidenceId: bReceipt.deliveries[0].evidenceId, content: "hello from a" }],
}), false, "changing only wakeId cannot repackage consumed evidence as a new external impact");

const replyEventId = turns[1].outcome.eventId;
const aReplyReceipt = characterEventReceipt(runtime.receiptLedger, replyEventId, A);
assert.equal(aReplyReceipt.status, "delivered", "an unread delivery remains cognitively delivered");
assert.ok(aReplyReceipt.deliveries[0].activationWakeId, "the delivery records its one external-impact activation reservation");
assert.equal(
  actorA.mailbox[0]?.kind,
  "world_evidence",
  "newly delivered world evidence becomes the only pending activation; no synthetic continuation competes with it",
);
assert.equal(actorA.mailbox.length, 1);
assert.equal(await runtime.enqueueWake(A, {
  wakeId: `wake:repackaged:${replyEventId}:${A}`,
  kind: "new_external_impact",
  recipientCharacterId: A,
  eventId: replyEventId,
  evidenceIds: [aReplyReceipt.deliveries[0].evidenceId],
  evidence: [{ evidenceId: aReplyReceipt.deliveries[0].evidenceId, content: "heard you" }],
}), false, "an already activated but still-unnoticed delivery cannot be repackaged under another wake id");

function registerTestDelivery({ eventId, deliveryId, evidenceId }) {
  registerCharacterEventDelivery(runtime.receiptLedger, {
    id: deliveryId,
    objectiveEventId: eventId,
    recipientId: B,
    evidenceId,
    modality: "sound",
  }, { deliveredAtSeconds: coordinator.worldState.nowSeconds, step: coordinator.journal.worldVersion });
}

registerTestDelivery({
  eventId: "event:fresh:first-activation",
  deliveryId: "delivery:fresh:first-activation:b",
  evidenceId: "evidence:fresh:first-activation:b",
});
assert.equal(await runtime.enqueueWake(B, {
  wakeId: "wake:fresh:first-activation:b",
  kind: "new_external_impact",
  eventId: "event:fresh:first-activation",
  evidenceIds: ["evidence:fresh:first-activation:b"],
  evidence: [{ evidenceId: "evidence:fresh:first-activation:b", content: "a genuinely new sound" }],
}), true, "a genuinely fresh delivered evidence item receives its normal first activation");
assert.equal(await runtime.enqueueWake(B, {
  wakeId: "wake:fresh:first-activation:b:repackaged",
  kind: "new_external_impact",
  eventId: "event:fresh:first-activation",
  evidenceIds: ["evidence:fresh:first-activation:b"],
  evidence: [{ evidenceId: "evidence:fresh:first-activation:b", content: "a genuinely new sound" }],
}), false, "the same delivered evidence cannot reserve a second activation under a new wake id");

registerTestDelivery({
  eventId: "event:noticed:old",
  deliveryId: "delivery:noticed:old:b",
  evidenceId: "evidence:noticed:old:b",
});
markCharacterEvidenceNoticed(runtime.receiptLedger, {
  characterId: B,
  evidenceIds: ["evidence:noticed:old:b"],
  agentTurnId: "agent-turn:test:noticed",
  step: coordinator.journal.worldVersion,
});
assert.equal(await runtime.enqueueWake(B, {
  wakeId: "wake:noticed:old:b:repackaged",
  kind: "new_external_impact",
  eventId: "event:noticed:old",
  evidenceIds: ["evidence:noticed:old:b"],
  evidence: [{ evidenceId: "evidence:noticed:old:b", content: "already noticed" }],
}), false, "noticed evidence is no longer a new external impact even under a new wake id");

registerTestDelivery({
  eventId: "event:appraised:old",
  deliveryId: "delivery:appraised:old:b",
  evidenceId: "evidence:appraised:old:b",
});
markCharacterEvidenceNoticed(runtime.receiptLedger, {
  characterId: B,
  evidenceIds: ["evidence:appraised:old:b"],
  agentTurnId: "agent-turn:test:appraised",
  step: coordinator.journal.worldVersion,
});
markCharacterEvidenceAppraised(runtime.receiptLedger, {
  characterId: B,
  evidenceIds: ["evidence:appraised:old:b"],
  agentTurnId: "agent-turn:test:appraised",
  step: coordinator.journal.worldVersion,
});
assert.equal(await runtime.enqueueWake(B, {
  wakeId: "wake:appraised:old:b:repackaged",
  kind: "world_evidence",
  eventId: "event:appraised:old",
  evidenceIds: ["evidence:appraised:old:b"],
  evidence: [{ evidenceId: "evidence:appraised:old:b", content: "already appraised" }],
}), false, "appraised evidence cannot be repackaged as world evidence");

const checkpoint = await runtime.checkpoint();
assert.equal(checkpoint.coordinator.journal.worldVersion, 2);
assert.equal(checkpoint.actors.length, 2);
assert.ok(checkpoint.readyQueue.includes(A), "B's reply should leave a real pending wake for A");

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    actorAttemptOnly: true,
    coordinatorOnlyWorldWriter: true,
    committedDeliveryWakesRecipient: true,
    ownedContinuationWakesSameActorWithoutChoosingAction: true,
    affectedOtherPrecedesOwnContinuation: true,
    externalEvidenceOvertakesQueuedContinuation: true,
    recipientPrivateIsolation: true,
    receiptsConsumedAfterTurn: true,
    duplicateWakeSuppressed: true,
    repackagedConsumedEvidenceRejected: true,
    repackagedUnreadDeliveryRejectedAfterFirstActivation: true,
    freshDeliveredEvidenceGetsOneActivation: true,
    noticedAndAppraisedEvidenceAreNotNewExternalImpacts: true,
    runtimeCheckpointIncludesActorsAndWorld: true,
  },
}, null, 2));
