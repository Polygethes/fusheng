import { physicalAttemptForSettlement } from "./physicalExpression.mjs";

function acceptanceFailure(state, actorId, objectId) {
  const actor = state.entities?.[actorId], object = state.objects?.[objectId];
  if (!actor || actor.present === false || actor.kind !== "character") return "DELIVERY_RECIPIENT_UNAVAILABLE";
  if (!object || object.state?.intendedRecipientActorId !== actorId) return "DELIVERY_RECIPIENT_MISMATCH";
  if (object.state.accepted) return "DELIVERY_ALREADY_ACCEPTED";
  if (object.placeId !== actor.placeId || object.zoneId !== actor.zoneId) return "DELIVERY_OUT_OF_REACH";
  if (object.holderCharacterId && object.holderCharacterId !== actorId) return "DELIVERY_STILL_HELD_BY_OTHER";
  return "";
}

export function listDeliveryCapabilityAffordances({ state = {}, actorId = "", perceivedObjectIds = [] } = {}) {
  const visible = new Set(perceivedObjectIds);
  return { ownedProcesses: [], affordances: Object.values(state.objects || {})
    .filter(object => visible.has(object.id) && !acceptanceFailure(state, actorId, object.id))
    .map(object => ({ canonicalAffordanceId: `delivery:accept:${object.id}`, operation: "accept_delivery", objectId: object.id,
      public: { kind: "delivery_operation", operation: "accept_delivery", objectId: object.id,
        label: `核对并确认收下${object.label || "这件交付物"}`, currentlyExecutable: true, expectedDurationSeconds: 10,
        physicalPrerequisites: ["物品已实际交到本人手中或放在面前；本次仅确认这一件物品"] } })) };
}

export function settleDeliveryCapabilityAffordance({ state = {}, attempt: input = {} } = {}) {
  const attempt = physicalAttemptForSettlement(input), binding = attempt.payload?.capabilityBinding || {};
  const result = { authority: "world-action-registry", primitive: attempt.primitive || "use_affordance", status: "failed",
    attemptSurface: [], intendedEffects: [], resolvedEffects: [], failedEffects: [], incidentalEffects: [], committedFacts: [], deliveries: [],
    durationSeconds: 1, statePatch: { operations: [] } };
  const failure = binding.operation !== "accept_delivery" ? "DELIVERY_OPERATION_UNKNOWN" : acceptanceFailure(state, attempt.actorId, binding.objectId);
  if (failure) { result.failedEffects.push({ code: failure }); return result; }
  const actor = state.entities[attempt.actorId], object = state.objects[binding.objectId];
  const fact = { kind: "delivery_accepted", actorId: actor.id, objectId: object.id,
    visibleAction: `${actor.name || "收件人"}核对后确认收下${object.label || "这件交付物"}。` };
  result.status = "success";
  result.durationSeconds = 10;
  result.attemptSurface.push(fact);
  result.committedFacts.push(fact);
  result.resolvedEffects.push({ kind: "delivery_accepted", actorId: actor.id, objectId: object.id });
  result.statePatch.operations.push({ op: "set", path: ["objects", object.id, "state"], value: { ...structuredClone(object.state),
    accepted: true, acceptedByCharacterId: actor.id, acceptedAtSeconds: Number(state.nowSeconds || 0) + result.durationSeconds } });
  for (const observer of Object.values(state.entities || {})) {
    if (observer.id === actor.id || observer.kind !== "character" || observer.present === false || observer.placeId !== actor.placeId || observer.zoneId !== actor.zoneId) continue;
    result.deliveries.push({ deliveryId: `delivery:${attempt.attemptId}:accepted:${observer.id}`, eventKind: "delivery_accepted", modality: "visual",
      sourceCharacterId: actor.id, sourceObjectId: object.id, recipientCharacterId: observer.id, content: fact.visibleAction });
  }
  return result;
}
