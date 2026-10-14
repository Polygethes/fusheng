import assert from "node:assert/strict";

import {
  characterEventReceipt,
  createCharacterEventReceiptLedger,
  deliveryQualifiesAsNewExternalImpact,
  freshEventDeliveriesForCharacter,
  markCharacterEvidenceAppraised,
  markCharacterEvidenceConsumed,
  markCharacterEvidenceNoticed,
  registerCharacterEventDelivery,
} from "../src/server/simulation/characterEventReceipts.mjs";

const ledger = createCharacterEventReceiptLedger();
const eventId = "event:xie-looks-at-luo";
const luoVisual = {
  id: "delivery:visual:luo",
  objectiveEventId: eventId,
  recipientId: "luo",
  evidenceId: "evidence:visual:luo",
  modality: "visual",
};
const luoSound = {
  id: "delivery:sound:luo",
  objectiveEventId: eventId,
  recipientId: "luo",
  evidenceId: "evidence:sound:luo",
  modality: "sound",
};
const bystanderVisual = {
  id: "delivery:visual:bystander",
  objectiveEventId: eventId,
  recipientId: "bystander",
  evidenceId: "evidence:visual:bystander",
  modality: "visual",
};

registerCharacterEventDelivery(ledger, luoVisual, { deliveredAtSeconds: 3, step: 1 });
registerCharacterEventDelivery(ledger, luoSound, { deliveredAtSeconds: 3, step: 1 });
registerCharacterEventDelivery(ledger, bystanderVisual, { deliveredAtSeconds: 3, step: 1 });

assert.equal(characterEventReceipt(ledger, eventId, "luo").deliveries.length, 2);
assert.equal(characterEventReceipt(ledger, eventId, "bystander").deliveries.length, 1);
assert.equal(deliveryQualifiesAsNewExternalImpact(ledger, luoVisual), true);
assert.equal(deliveryQualifiesAsNewExternalImpact(ledger, bystanderVisual), true);

markCharacterEvidenceNoticed(ledger, {
  characterId: "luo",
  evidenceIds: [luoVisual.evidenceId, luoSound.evidenceId],
  agentTurnId: "turn:luo:1",
  step: 2,
});
assert.equal(deliveryQualifiesAsNewExternalImpact(ledger, luoVisual), true, "noticed but not yet appraised evidence may still wake its first Agent turn");

markCharacterEvidenceAppraised(ledger, {
  characterId: "luo",
  evidenceIds: [luoVisual.evidenceId],
  agentTurnId: "turn:luo:1",
  step: 2,
});
assert.equal(deliveryQualifiesAsNewExternalImpact(ledger, luoVisual), false, "appraised evidence cannot masquerade as a new external impact");
assert.equal(deliveryQualifiesAsNewExternalImpact(ledger, luoSound), true, "another unappraised modality from the same event remains independently fresh");
assert.equal(deliveryQualifiesAsNewExternalImpact(ledger, bystanderVisual), true, "one person's appraisal must not consume another person's evidence");

markCharacterEvidenceAppraised(ledger, {
  characterId: "luo",
  evidenceIds: [luoSound.evidenceId],
  agentTurnId: "turn:luo:1",
  step: 2,
});
assert.deepEqual(freshEventDeliveriesForCharacter(ledger, "luo", [luoVisual, luoSound]), []);
assert.deepEqual(freshEventDeliveriesForCharacter(ledger, "bystander", [bystanderVisual]), [bystanderVisual]);

const appraisalReceipt = characterEventReceipt(ledger, eventId, "luo");
assert.equal(appraisalReceipt.status, "appraised");
assert.equal(appraisalReceipt.obligationStatus, undefined, "sensory receipt must not own conversation or shared-activity resolution");
assert.equal(appraisalReceipt.deliveries.every((row) => row.appraisedAtAgentTurnId === "turn:luo:1"), true);

markCharacterEvidenceConsumed(ledger, {
  characterId: "luo",
  evidenceIds: [luoVisual.evidenceId, luoSound.evidenceId],
  agentTurnId: "turn:luo:1",
  step: 2,
  disposition: "acted_or_explicitly_deferred",
});
assert.equal(characterEventReceipt(ledger, eventId, "luo").status, "consumed");
assert.equal(deliveryQualifiesAsNewExternalImpact(ledger, luoVisual), false);

markCharacterEvidenceConsumed(ledger, {
  characterId: "luo",
  evidenceIds: [luoVisual.evidenceId, luoSound.evidenceId],
  agentTurnId: "turn:luo:1",
  step: 2,
  disposition: "acted_or_explicitly_deferred",
});
assert.equal(characterEventReceipt(ledger, eventId, "luo").status, "consumed", "same-turn receipt settlement is idempotent");

assert.throws(() => markCharacterEvidenceNoticed(ledger, {
  characterId: "luo",
  evidenceIds: [luoVisual.evidenceId],
  agentTurnId: "turn:luo:2",
  step: 3,
}), (error) => error.code === "CHARACTER_EVENT_RECEIPT_BACKWARD_TRANSITION");

registerCharacterEventDelivery(ledger, {
  id: "delivery:new:luo",
  objectiveEventId: "event:new",
  recipientId: "luo",
  evidenceId: "evidence:new:luo",
  modality: "visual",
}, { deliveredAtSeconds: 8, step: 3 });
assert.equal(freshEventDeliveriesForCharacter(ledger, "luo", [
  luoVisual,
  { id: "delivery:new:luo", objectiveEventId: "event:new", recipientId: "luo", evidenceId: "evidence:new:luo" },
]).map((row) => row.id).join(","), "delivery:new:luo");

console.log(JSON.stringify({
  status: "passed",
  checks: {
    perCharacterIsolation: true,
    multiModalEvidenceLifecycle: true,
    appraisedEvidenceIsNotNew: true,
    unresolvedObligationIsSeparate: true,
    consumptionIsIdempotent: true,
    backwardTransitionRejected: true,
    genuinelyNewEventStillWakes: true,
  },
}, null, 2));
