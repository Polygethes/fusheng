/** Generic evidence matcher for desire satisfaction. */

function clean(value = "") {
  return String(value || "").trim();
}

function heardBy(action = {}, recipientId = "") {
  return (action.deliveries || []).some((delivery) => (
    delivery.recipientId === recipientId
    && (!delivery.sourceCharacterId || delivery.sourceCharacterId === action.actorId)
    && ["sound", "hearing", "direct_speech"].includes(clean(delivery.modality || delivery.channel).toLowerCase())
  ));
}

function decisionMatches(desire = {}, action = {}) {
  const condition = desire.satisfactionCondition || {};
  const criteria = condition.criteria || {};
  const value = clean(action.decisionValue).toLowerCase();
  const acceptedValues = (criteria.acceptedValues || []).map((item) => clean(item).toLowerCase());
  if (!value || value === "none" || (acceptedValues.length && !acceptedValues.includes(value))) return false;
  if (criteria.topicId && clean(action.decisionTopicId) !== clean(criteria.topicId)) return false;
  return true;
}

function materialEvidenceMatches(desire = {}, action = {}, ownerId = "") {
  const criteria = desire.satisfactionCondition?.criteria || {};
  const requiredTags = (criteria.requiredEvidenceTags || []).map(clean).filter(Boolean);
  if (!requiredTags.length) return false;
  const evidence = action.satisfactionEvidence || {};
  const actualTags = new Set((evidence.tags || []).map(clean).filter(Boolean));
  if (!requiredTags.every((tag) => actualTags.has(tag))) return false;
  if (criteria.actorCharacterId && clean(criteria.actorCharacterId) !== clean(action.actorId)) return false;
  if (criteria.requireOwnerAsBeneficiary !== false
    && !(evidence.beneficiaryActorIds || []).map(clean).includes(clean(ownerId))) return false;
  const requiredObjectIds = (criteria.requiredObjectIds || []).map(clean).filter(Boolean);
  const actualObjectIds = new Set((evidence.objectIds || []).map(clean).filter(Boolean));
  return requiredObjectIds.every((objectId) => actualObjectIds.has(objectId));
}

function effect(desire, action, kind) {
  return {
    driveId: desire.id,
    satisfactionConditionMet: true,
    satisfactionEvidence: {
      verified: true,
      eventId: action.id,
      kind,
      decisionValue: action.decisionValue,
      topicId: action.decisionTopicId || "",
    },
  };
}

export function deriveDesireSatisfactionEffects({ desires = [], action = {}, ownerActorId = "" } = {}) {
  if (action.committed === false || !action.id) return [];
  const ownerId = clean(ownerActorId);
  const effects = [];
  for (const desire of desires || []) {
    if (clean(desire.ownerCharacterId) && clean(desire.ownerCharacterId) !== ownerId) continue;
    const condition = desire.satisfactionCondition || {};
    const criteria = condition.criteria || {};
    if (condition.type === "communicated_decision") {
      const actorId = clean(criteria.actorCharacterId || desire.ownerCharacterId);
      const receiverId = clean(criteria.receiverCharacterId || desire.target?.id);
      if (action.actorId === actorId
        && action.targetCharacterId === receiverId
        && decisionMatches(desire, action)
        && heardBy(action, receiverId)) effects.push(effect(desire, action, "communicated_decision"));
    } else if (condition.type === "received_decision") {
      const receiverId = clean(criteria.receiverCharacterId || desire.ownerCharacterId);
      const speakerId = clean(criteria.speakerCharacterId || desire.target?.id);
      if (ownerId === receiverId
        && action.actorId === speakerId
        && action.targetCharacterId === receiverId
        && decisionMatches(desire, action)
        && heardBy(action, receiverId)) effects.push(effect(desire, action, "received_decision"));
    } else if (materialEvidenceMatches(desire, action, ownerId)) {
      const materialEffect = effect(desire, action, "material_evidence");
      materialEffect.satisfactionEvidence.tags = [...(action.satisfactionEvidence?.tags || [])];
      materialEffect.satisfactionEvidence.objectIds = [...(action.satisfactionEvidence?.objectIds || [])];
      effects.push(materialEffect);
    }
  }
  return effects;
}
