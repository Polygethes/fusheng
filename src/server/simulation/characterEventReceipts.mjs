export const CHARACTER_EVENT_RECEIPT_LEDGER_SCHEMA_VERSION = 1;
export const CHARACTER_EVENT_RECEIPT_SCHEMA_VERSION = 1;

const STATUS_ORDER = Object.freeze({
  undelivered: 0,
  delivered: 1,
  noticed: 2,
  appraised: 3,
  consumed: 4,
  expired: 5,
});

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function fail(code, message, evidence = {}) {
  const error = new Error(message);
  error.code = code;
  error.evidence = clone(evidence);
  return error;
}

function normalizeDelivery(delivery = {}) {
  const eventId = clean(delivery.objectiveEventId || delivery.eventId || delivery.impactId);
  const characterId = clean(delivery.recipientId || delivery.characterId);
  const deliveryId = clean(delivery.id || delivery.deliveryId);
  const evidenceId = clean(
    delivery.evidenceId
    || delivery.noticedEvidenceId
    || delivery.noticedProjection?.evidenceId,
  );
  if (!eventId) throw fail("CHARACTER_EVENT_RECEIPT_EVENT_ID_REQUIRED", "Event delivery requires objective event id.");
  if (!characterId) throw fail("CHARACTER_EVENT_RECEIPT_CHARACTER_ID_REQUIRED", "Event delivery requires recipient character id.");
  if (!deliveryId) throw fail("CHARACTER_EVENT_RECEIPT_DELIVERY_ID_REQUIRED", "Event delivery requires delivery id.");
  if (!evidenceId) throw fail("CHARACTER_EVENT_RECEIPT_EVIDENCE_ID_REQUIRED", "Event delivery requires recipient evidence id.");
  return { eventId, characterId, deliveryId, evidenceId };
}

function assertLedger(ledger = {}) {
  if (Number(ledger.schemaVersion) !== CHARACTER_EVENT_RECEIPT_LEDGER_SCHEMA_VERSION || !Array.isArray(ledger.receipts)) {
    throw fail("CHARACTER_EVENT_RECEIPT_LEDGER_INVALID", "A valid Character event receipt ledger is required.");
  }
  return ledger;
}

function receiptKey(eventId, characterId) {
  return `${eventId}\u0000${characterId}`;
}

function findReceipt(ledger, eventId, characterId) {
  const key = receiptKey(eventId, characterId);
  return ledger.receipts.find((receipt) => receipt.key === key) || null;
}

function summarizeReceipt(receipt) {
  const rows = receipt.deliveries || [];
  if (!rows.length) return "undelivered";
  if (rows.every((row) => row.status === "expired")) return "expired";
  const active = rows.filter((row) => row.status !== "expired");
  return active.reduce((leastAdvanced, row) => (
    STATUS_ORDER[row.status] < STATUS_ORDER[leastAdvanced] ? row.status : leastAdvanced
  ), active[0].status);
}

function refreshReceipt(receipt, { step = null, agentTurnId = "" } = {}) {
  receipt.status = summarizeReceipt(receipt);
  if (step != null && Number.isFinite(Number(step))) receipt.lastUpdatedAtStep = Number(step);
  if (clean(agentTurnId)) receipt.lastUpdatedAtAgentTurnId = clean(agentTurnId);
  return receipt;
}

function deliveryRecordForEvidence(ledger, characterId, evidenceId) {
  for (const receipt of ledger.receipts) {
    if (receipt.characterId !== characterId) continue;
    const delivery = receipt.deliveries.find((row) => (
      row.evidenceId === evidenceId || (row.evidenceIds || []).includes(evidenceId)
    ));
    if (delivery) return { receipt, delivery };
  }
  return null;
}

function transitionDelivery(record, status, {
  agentTurnId = "",
  step = null,
  disposition = "",
} = {}) {
  const previous = record.status || "undelivered";
  if (!(status in STATUS_ORDER)) throw fail("CHARACTER_EVENT_RECEIPT_STATUS_INVALID", "Unknown Character event receipt status.", { status });
  if (STATUS_ORDER[status] < STATUS_ORDER[previous]) {
    throw fail("CHARACTER_EVENT_RECEIPT_BACKWARD_TRANSITION", "Character event receipt cannot move backward.", {
      deliveryId: record.deliveryId,
      evidenceId: record.evidenceId,
      previous,
      attempted: status,
    });
  }
  if (status === previous) return record;
  record.status = status;
  const turnId = clean(agentTurnId);
  const numericStep = Number.isFinite(Number(step)) ? Number(step) : null;
  if (status === "noticed") {
    record.noticedAtAgentTurnId = turnId;
    record.noticedAtStep = numericStep;
  }
  if (status === "appraised") {
    record.noticedAtAgentTurnId ||= turnId;
    record.noticedAtStep ??= numericStep;
    record.appraisedAtAgentTurnId = turnId;
    record.appraisedAtStep = numericStep;
  }
  if (status === "consumed") {
    record.consumedAtAgentTurnId = turnId;
    record.consumedAtStep = numericStep;
    record.consumptionDisposition = clean(disposition) || "acted_or_explicitly_deferred";
  }
  if (status === "expired") {
    record.expiredAtStep = numericStep;
    record.expirationReason = clean(disposition) || "expired";
  }
  return record;
}

function transitionEvidenceRows(ledger, {
  characterId = "",
  evidenceIds = [],
  status,
  agentTurnId = "",
  step = null,
  disposition = "",
} = {}) {
  assertLedger(ledger);
  const ownerId = clean(characterId);
  const ids = [...new Set((evidenceIds || []).map(clean).filter(Boolean))];
  if (!ownerId) throw fail("CHARACTER_EVENT_RECEIPT_CHARACTER_ID_REQUIRED", "Receipt transition requires characterId.");
  const changedReceipts = new Set();
  for (const evidenceId of ids) {
    const row = deliveryRecordForEvidence(ledger, ownerId, evidenceId);
    if (!row) {
      throw fail("CHARACTER_EVENT_RECEIPT_EVIDENCE_UNKNOWN", "Character cannot settle an event evidence id that was not delivered to them.", {
        characterId: ownerId,
        evidenceId,
      });
    }
    if (status === "consumed" && STATUS_ORDER[row.delivery.status] < STATUS_ORDER.appraised) {
      throw fail("CHARACTER_EVENT_RECEIPT_CONSUME_BEFORE_APPRAISAL", "Evidence must be appraised before it is consumed.", {
        characterId: ownerId,
        evidenceId,
        currentStatus: row.delivery.status,
      });
    }
    transitionDelivery(row.delivery, status, { agentTurnId, step, disposition });
    changedReceipts.add(row.receipt);
  }
  for (const receipt of changedReceipts) refreshReceipt(receipt, { step, agentTurnId });
  return [...changedReceipts].map(clone);
}

export function createCharacterEventReceiptLedger({ receipts = [] } = {}) {
  const ledger = {
    schemaVersion: CHARACTER_EVENT_RECEIPT_LEDGER_SCHEMA_VERSION,
    receipts: [],
  };
  for (const receipt of receipts || []) {
    const next = clone(receipt);
    if (!clean(next.eventId) || !clean(next.characterId)) {
      throw fail("CHARACTER_EVENT_RECEIPT_INVALID", "Persisted Character event receipt requires eventId and characterId.");
    }
    next.schemaVersion = CHARACTER_EVENT_RECEIPT_SCHEMA_VERSION;
    next.key = receiptKey(next.eventId, next.characterId);
    next.deliveries = (Array.isArray(next.deliveries) ? next.deliveries : []).map((delivery) => ({
      ...delivery,
      evidenceIds: [...new Set([delivery.evidenceId, ...(delivery.evidenceIds || [])].filter(Boolean))],
    }));
    refreshReceipt(next);
    ledger.receipts.push(next);
  }
  return ledger;
}

export function registerCharacterEventDelivery(ledger = {}, deliveryInput = {}, {
  deliveredAtSeconds = null,
  step = null,
} = {}) {
  assertLedger(ledger);
  const delivery = normalizeDelivery(deliveryInput);
  let receipt = findReceipt(ledger, delivery.eventId, delivery.characterId);
  if (!receipt) {
    receipt = {
      schemaVersion: CHARACTER_EVENT_RECEIPT_SCHEMA_VERSION,
      key: receiptKey(delivery.eventId, delivery.characterId),
      eventId: delivery.eventId,
      characterId: delivery.characterId,
      status: "undelivered",
      deliveries: [],
      createdAtStep: Number.isFinite(Number(step)) ? Number(step) : null,
      lastUpdatedAtStep: Number.isFinite(Number(step)) ? Number(step) : null,
      lastUpdatedAtAgentTurnId: "",
    };
    ledger.receipts.push(receipt);
  }
  const existing = receipt.deliveries.find((row) => row.deliveryId === delivery.deliveryId);
  if (existing) {
    existing.evidenceIds = [...new Set([
      existing.evidenceId,
      ...(existing.evidenceIds || []),
      delivery.evidenceId,
      clean(deliveryInput.rawEvidenceId),
    ].filter(Boolean))];
    return clone(refreshReceipt(receipt, { step }));
  }
  receipt.deliveries.push({
    deliveryId: delivery.deliveryId,
    evidenceId: delivery.evidenceId,
    evidenceIds: [...new Set([delivery.evidenceId, clean(deliveryInput.rawEvidenceId)].filter(Boolean))],
    modality: clean(deliveryInput.modality),
    status: "delivered",
    deliveredAtSeconds: Number.isFinite(Number(deliveredAtSeconds)) ? Number(deliveredAtSeconds) : null,
    deliveredAtStep: Number.isFinite(Number(step)) ? Number(step) : null,
    activationWakeId: "",
    activationEnqueuedAtStep: null,
    noticedAtAgentTurnId: "",
    noticedAtStep: null,
    appraisedAtAgentTurnId: "",
    appraisedAtStep: null,
    consumedAtAgentTurnId: "",
    consumedAtStep: null,
    consumptionDisposition: "",
  });
  return clone(refreshReceipt(receipt, { step }));
}

export function characterEventReceipt(ledger = {}, eventId = "", characterId = "") {
  assertLedger(ledger);
  return clone(findReceipt(ledger, clean(eventId), clean(characterId)));
}

export function characterEventEvidenceRecords(ledger = {}, characterId = "", evidenceIds = []) {
  assertLedger(ledger);
  const ownerId = clean(characterId);
  const requested = new Set((evidenceIds || []).map(clean).filter(Boolean));
  const rows = [];
  for (const receipt of ledger.receipts) {
    if (receipt.characterId !== ownerId) continue;
    for (const delivery of receipt.deliveries || []) {
      const aliases = [...new Set([delivery.evidenceId, ...(delivery.evidenceIds || [])].filter(Boolean))];
      const matchedEvidenceId = requested.size
        ? aliases.find((evidenceId) => requested.has(evidenceId)) || ""
        : delivery.evidenceId;
      if (requested.size && !matchedEvidenceId) continue;
      rows.push({
        eventId: receipt.eventId,
        characterId: receipt.characterId,
        receiptStatus: receipt.status,
        ...clone(delivery),
        evidenceId: matchedEvidenceId || delivery.evidenceId,
      });
    }
  }
  return rows;
}

/**
 * Reserve the one new-external-impact wake that a physical delivery may
 * create.  Cognitive receipt status and scheduling idempotency are separate:
 * an Agent may leave evidence at `delivered`, but changing only the wake id
 * must not turn that same old delivery into a second external stimulus.
 *
 * Returning false is an ordinary stale/duplicate-wake rejection.  The caller
 * may retry the same wake id after a crash between reservation and mailbox
 * insertion, but another wake id cannot claim the same delivery.
 */
export function reserveCharacterEvidenceWake(ledger = {}, {
  characterId = "",
  evidenceIds = [],
  wakeId = "",
  step = null,
} = {}) {
  assertLedger(ledger);
  const ownerId = clean(characterId);
  const id = clean(wakeId);
  const requestedIds = [...new Set((evidenceIds || []).map(clean).filter(Boolean))];
  if (!ownerId || !id || !requestedIds.length) return false;

  const records = [];
  const seenDeliveries = new Set();
  for (const evidenceId of requestedIds) {
    const row = deliveryRecordForEvidence(ledger, ownerId, evidenceId);
    if (!row) return false;
    const key = `${row.receipt.key}\u0000${row.delivery.deliveryId}`;
    if (seenDeliveries.has(key)) continue;
    seenDeliveries.add(key);
    records.push(row.delivery);
  }
  if (!records.length || records.some((record) => (
    record.status !== "delivered"
    || (clean(record.activationWakeId) && clean(record.activationWakeId) !== id)
  ))) return false;

  const numericStep = Number.isFinite(Number(step)) ? Number(step) : null;
  for (const record of records) {
    record.activationWakeId ||= id;
    record.activationEnqueuedAtStep ??= numericStep;
  }
  return true;
}

export function markCharacterEvidenceNoticed(ledger = {}, input = {}) {
  return transitionEvidenceRows(ledger, { ...input, status: "noticed" });
}

export function markCharacterEvidenceAppraised(ledger = {}, input = {}) {
  return transitionEvidenceRows(ledger, { ...input, status: "appraised" });
}

export function markCharacterEvidenceConsumed(ledger = {}, input = {}) {
  return transitionEvidenceRows(ledger, { ...input, status: "consumed" });
}

export function recordCharacterEvidencePresentation(ledger, { characterId, agentTurnId, presentedEvidenceIds = [], expiredEvidenceIds = [], expirationReason = "not_presented_during_transient_perception", step = null } = {}) {
  assertLedger(ledger);
  for (const evidenceId of presentedEvidenceIds) {
    const row = deliveryRecordForEvidence(ledger, characterId, evidenceId);
    if (!row) continue; // Retained private evidence may no longer be in this receipt window.
    row.delivery.presentedAtAgentTurnId ||= clean(agentTurnId);
    row.delivery.presentedAtStep ??= step;
  }
  const registeredExpiredIds = expiredEvidenceIds.filter(id => deliveryRecordForEvidence(ledger, characterId, id));
  if (registeredExpiredIds.length) transitionEvidenceRows(ledger, { characterId, agentTurnId, evidenceIds: registeredExpiredIds,
    status: "expired", disposition: expirationReason, step });
}

export function deliveryQualifiesAsNewExternalImpact(ledger = {}, deliveryInput = {}) {
  assertLedger(ledger);
  let delivery;
  try {
    delivery = normalizeDelivery(deliveryInput);
  } catch {
    return deliveryInput.processedAtStep == null;
  }
  const receipt = findReceipt(ledger, delivery.eventId, delivery.characterId);
  const record = receipt?.deliveries.find((row) => (
    row.deliveryId === delivery.deliveryId
    || row.evidenceId === delivery.evidenceId
    || (row.evidenceIds || []).includes(delivery.evidenceId)
  ));
  if (!record) return deliveryInput.processedAtStep == null;
  return ["delivered", "noticed"].includes(record.status);
}

export function freshEventDeliveriesForCharacter(ledger = {}, characterId = "", deliveries = []) {
  assertLedger(ledger);
  const ownerId = clean(characterId);
  return (deliveries || []).filter((delivery) => (
    clean(delivery.recipientId || delivery.characterId) === ownerId
    && deliveryQualifiesAsNewExternalImpact(ledger, delivery)
  ));
}
