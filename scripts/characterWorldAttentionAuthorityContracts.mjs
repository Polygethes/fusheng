import assert from "node:assert/strict";

import {
  characterEventEvidenceRecords,
  createCharacterEventReceiptLedger,
  registerCharacterEventDelivery,
} from "../src/server/simulation/characterEventReceipts.mjs";
import { createLocalCharacterRuntimePort } from "../src/server/simulation/characterRuntimePort.mjs";
import { createCharacterSessionActor } from "../src/server/simulation/characterSessionActor.mjs";
import { createCharacterWorldRuntime } from "../src/server/simulation/characterWorldRuntime.mjs";
import { createWorldActionRegistry } from "../src/server/simulation/worldActionRegistry.mjs";
import { createWorldCommitCoordinator } from "../src/server/simulation/worldCommitCoordinator.mjs";

const CHARACTER_ID = "char:attention-owner";
const EVENT_ID = "event:attention-layers";
const evidenceIds = {
  delivered: "evidence:delivered-only",
  noticed: "evidence:noticed-only",
  appraised: "evidence:appraised-not-consumed",
  consumed: "evidence:explicitly-consumed",
};

const ledger = createCharacterEventReceiptLedger();
for (const [index, evidenceId] of Object.values(evidenceIds).entries()) {
  registerCharacterEventDelivery(ledger, {
    id: `delivery:attention:${index + 1}`,
    objectiveEventId: EVENT_ID,
    recipientId: CHARACTER_ID,
    evidenceId,
    modality: "visual",
  }, { deliveredAtSeconds: 0, step: 0 });
}

const actor = createCharacterSessionActor({
  characterId: CHARACTER_ID,
  privateState: { ownerCharacterId: CHARACTER_ID },
  runtimePort: createLocalCharacterRuntimePort({
    async runTurn(input) {
      return {
        characterId: CHARACTER_ID,
        agentTurnId: input.agentTurnId,
        privateResult: {
          evidenceReceiptSettlement: {
            authority: "character-agent",
            noticedEvidenceIds: [evidenceIds.noticed, evidenceIds.appraised, evidenceIds.consumed],
            appraisedEvidenceIds: [evidenceIds.appraised, evidenceIds.consumed],
            consumedEvidenceIds: [evidenceIds.consumed],
            consumptionDisposition: "acted",
          },
        },
      };
    },
  }),
});

const coordinator = createWorldCommitCoordinator({
  worldId: "world:attention-authority",
  initialWorldState: {
    worldId: "world:attention-authority",
    entities: {
      [CHARACTER_ID]: {
        id: CHARACTER_ID,
        kind: "character",
        present: true,
        placeId: "place:room",
        zoneId: "hall",
      },
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
  actors: [actor],
  receiptLedger: ledger,
  situationProjector({ characterId, wake }) {
    return {
      authority: "recipient-specific-world-projection",
      recipientCharacterId: characterId,
      evidence: structuredClone(wake.evidence || []),
    };
  },
});

await runtime.enqueueWake(CHARACTER_ID, {
  wakeId: "wake:attention-layers",
  kind: "world_evidence",
  eventId: EVENT_ID,
  evidenceIds: Object.values(evidenceIds),
  evidence: Object.values(evidenceIds).map((evidenceId) => ({ evidenceId, content: evidenceId })),
});

const turn = await runtime.runNext();
assert.ok(turn, "the Character Agent should receive one thinking opportunity");

const statuses = Object.fromEntries(
  characterEventEvidenceRecords(runtime.receiptLedger, CHARACTER_ID, Object.values(evidenceIds))
    .map((row) => [row.evidenceId, row.status]),
);
assert.equal(statuses[evidenceIds.delivered], "delivered", "mere delivery must not become private attention");
assert.equal(statuses[evidenceIds.noticed], "noticed", "the Agent may notice without forming an appraisal");
assert.equal(statuses[evidenceIds.appraised], "appraised", "an appraisal must not be treated as consumed");
assert.equal(statuses[evidenceIds.consumed], "consumed", "only explicit Agent settlement may consume evidence");

const FAILURE_CHARACTER_ID = "char:attention-before-world-failure";
const FAILURE_EVENT_ID = "event:attention-before-world-failure";
const FAILURE_EVIDENCE_ID = "evidence:attention-before-world-failure";
const failureLedger = createCharacterEventReceiptLedger();
registerCharacterEventDelivery(failureLedger, {
  id: "delivery:attention-before-world-failure",
  objectiveEventId: FAILURE_EVENT_ID,
  recipientId: FAILURE_CHARACTER_ID,
  evidenceId: FAILURE_EVIDENCE_ID,
  modality: "sound",
}, { deliveredAtSeconds: 0, step: 0 });
let failureTurnCalls = 0;
const failureActor = createCharacterSessionActor({
  characterId: FAILURE_CHARACTER_ID,
  privateState: { ownerCharacterId: FAILURE_CHARACTER_ID },
  runtimePort: createLocalCharacterRuntimePort({
    async runTurn(input) {
      failureTurnCalls += 1;
      return {
        characterId: FAILURE_CHARACTER_ID,
        agentTurnId: input.agentTurnId,
        privateStatePatch: { privatelyProcessedWakeId: input.wake.wakeId },
        privateResult: {
          evidenceReceiptSettlement: {
            authority: "character-agent",
            noticedEvidenceIds: [FAILURE_EVIDENCE_ID],
            appraisedEvidenceIds: [FAILURE_EVIDENCE_ID],
            consumedEvidenceIds: [],
          },
        },
        actionAttempt: { primitive: "injected_world_failure", payload: {} },
      };
    },
  }),
});
const failureRegistry = createWorldActionRegistry();
failureRegistry.register("injected_world_failure", () => {
  const error = new Error("injected world resolution failure");
  error.code = "INJECTED_WORLD_RESOLUTION_FAILURE";
  throw error;
});
const failureCoordinator = createWorldCommitCoordinator({
  worldId: "world:attention-before-world-failure",
  initialWorldState: {
    worldId: "world:attention-before-world-failure",
    entities: {
      [FAILURE_CHARACTER_ID]: {
        id: FAILURE_CHARACTER_ID,
        kind: "character",
        present: true,
        placeId: "place:room",
        zoneId: "hall",
      },
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
  actionRegistry: failureRegistry,
});
const failureRuntime = createCharacterWorldRuntime({
  coordinator: failureCoordinator,
  actors: [failureActor],
  receiptLedger: failureLedger,
  situationProjector({ characterId, wake }) {
    return {
      authority: "recipient-specific-world-projection",
      recipientCharacterId: characterId,
      evidence: structuredClone(wake.evidence || []),
    };
  },
});
await failureRuntime.enqueueWake(FAILURE_CHARACTER_ID, {
  wakeId: "wake:attention-before-world-failure",
  kind: "world_evidence",
  eventId: FAILURE_EVENT_ID,
  evidenceIds: [FAILURE_EVIDENCE_ID],
  evidence: [{ evidenceId: FAILURE_EVIDENCE_ID, content: "a perceived warning" }],
});
await assert.rejects(
  () => failureRuntime.runNext(),
  (error) => error?.code === "INJECTED_WORLD_RESOLUTION_FAILURE",
);
const failureStatus = characterEventEvidenceRecords(
  failureRuntime.receiptLedger,
  FAILURE_CHARACTER_ID,
  [FAILURE_EVIDENCE_ID],
)[0]?.status;
assert.equal(failureStatus, "appraised", "private attention must settle before an external world action can fail");
assert.equal(failureActor.privateState.privatelyProcessedWakeId, "wake:attention-before-world-failure");
await assert.rejects(() => failureRuntime.runNext(), { code: "INJECTED_WORLD_RESOLUTION_FAILURE" }, "resume retries the preserved world outbox without thinking again");
assert.equal(failureTurnCalls, 1, "world failure must not repeat the Character Agent turn");

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    deliveryIsNotAttention: true,
    attentionLayersAreAgentOwned: true,
    unconsumedEvidenceSurvivesTheTurn: true,
    privateAppraisalSurvivesWorldFailure: true,
    failedWorldActionDoesNotRepeatThought: true,
  },
}, null, 2));
