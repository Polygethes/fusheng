const SUPPORTED_OPERATION_TYPES = new Set([
  "pickup",
  "transfer",
  "place",
  "move",
  "update_state",
  "consume",
  "attach",
  "detach",
  "take_out",
  "store",
  "show",
  "hide",
  "draw",
  "sheathe",
  "transfer_attempt",
]);

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value || "").trim();
}

function rowsFromObjects(objects = {}) {
  return Array.isArray(objects) ? objects : Object.values(objects || {});
}

function actorIdOf(actor = {}) {
  return clean(actor.id || actor.actorId || actor.characterId);
}

function objectHolder(object = {}) {
  return clean(object.holderActorId || object.heldByActorId || object.ownerActorId || object.initialHolderActorId);
}

function canonicalAttachment(rawAttachment, holderActorId = "") {
  if (!rawAttachment || typeof rawAttachment !== "object" || Array.isArray(rawAttachment)) return null;
  const active = rawAttachment.active === true;
  return {
    ...clone(rawAttachment),
    active,
    actorId: active ? clean(rawAttachment.actorId || rawAttachment.attachedToActorId || holderActorId) : "",
    mode: active ? clean(rawAttachment.mode || rawAttachment.carryMode) : clean(rawAttachment.mode || "detached"),
    transitionRequiresExplicitOperation: rawAttachment.transitionRequiresExplicitOperation !== false,
  };
}

function canonicalCustody(raw = {}, state = {}, attachment = null, holderActorId = "") {
  const supplied = raw.custody && typeof raw.custody === "object" && !Array.isArray(raw.custody)
    ? raw.custody
    : {};
  const explicitInHand = supplied.inHand ?? raw.inHand ?? state.inHand;
  const storageMode = clean(
    supplied.storageMode
      || raw.storageMode
      || state.storageMode
      || (attachment?.active ? "worn" : explicitInHand === true ? "in_hand" : holderActorId ? "carried" : "placed"),
  );
  return {
    storageMode,
    containerId: clean(supplied.containerId || raw.containerId || state.containerId),
    inHand: explicitInHand === true || storageMode === "in_hand",
  };
}

/** Use the settlement defaults when projecting an owner's own possessions. */
export function objectCustodyForOwner(object = {}) {
  const holderActorId = clean(object.holderCharacterId || objectHolder(object));
  return canonicalCustody(object, object.state || {},
    canonicalAttachment(object.attachment || object.state?.attachment, holderActorId), holderActorId);
}

function canonicalPresentation(raw = {}, state = {}, custody = {}) {
  const supplied = raw.presentation && typeof raw.presentation === "object" && !Array.isArray(raw.presentation)
    ? raw.presentation
    : {};
  const displayedToActorIds = [...new Set((supplied.displayedToActorIds || raw.displayedToActorIds || state.displayedToActorIds || [])
    .map(clean)
    .filter(Boolean))];
  const exposure = clean(
    supplied.exposure
      || raw.exposure
      || state.exposure
      || (displayedToActorIds.length ? "displayed" : custody.inHand ? "visible" : custody.storageMode === "packed" ? "hidden" : "covered"),
  );
  return {
    exposure,
    displayedToActorIds,
    publiclyVisible: ["visible", "displayed"].includes(exposure),
  };
}

function canonicalObject(raw = {}) {
  const id = clean(raw.id || raw.objectId);
  const holderActorId = objectHolder(raw);
  const state = clone(raw.state || {});
  const attachment = canonicalAttachment(raw.attachment || state.attachment, holderActorId);
  const custody = canonicalCustody(raw, state, attachment, holderActorId);
  const presentation = canonicalPresentation(raw, state, custody);
  delete state.attachment;
  return {
    ...clone(raw),
    id,
    label: clean(raw.label || raw.name || id),
    aliases: [...new Set([...(raw.aliases || []), raw.label, raw.name].map(clean).filter(Boolean))],
    holderActorId,
    sceneId: clean(raw.sceneId || raw.location?.sceneId),
    zoneId: clean(raw.zoneId || raw.location?.zoneId),
    portable: raw.portable !== false,
    state,
    custody,
    presentation,
    ...(attachment ? { attachment } : {}),
  };
}

function rebuildIndexes(ledger = {}) {
  const heldByActor = {};
  for (const object of Object.values(ledger.objects || {})) {
    if (!object.holderActorId) continue;
    heldByActor[object.holderActorId] ||= [];
    if (!heldByActor[object.holderActorId].includes(object.id)) heldByActor[object.holderActorId].push(object.id);
  }
  for (const ids of Object.values(heldByActor)) ids.sort();
  ledger.heldByActor = heldByActor;
  // Temporary compatibility mirror for adapters that still use characterId.
  ledger.heldByCharacter = clone(heldByActor);
  return ledger;
}

export function normalizeObjectLedger(input = {}) {
  const objects = {};
  for (const raw of rowsFromObjects(input.objects)) {
    const object = canonicalObject(raw);
    if (!object.id || objects[object.id]) continue;
    objects[object.id] = object;
  }
  // A legacy reverse index may be the only surviving ownership evidence.
  const legacyIndexes = { ...(input.heldByCharacter || {}), ...(input.heldByActor || {}) };
  for (const [holderActorId, ids] of Object.entries(legacyIndexes)) {
    for (const objectId of ids || []) {
      if (objects[objectId] && !objects[objectId].holderActorId) objects[objectId].holderActorId = holderActorId;
    }
  }
  return rebuildIndexes({
    schemaVersion: Math.max(2, Number(input.schemaVersion || 2)),
    objects,
  });
}

/**
 * Object ownership is not object visibility.  This is the single public
 * projection boundary used by scene adapters before another actor can receive
 * an object as sensory evidence.
 */
export function objectVisibleToObserver(object = {}, observerActorId = "", { defaultVisible = false } = {}) {
  if (object.presentation?.exposure === "hidden") return false;
  const displayedToActorIds = object.presentation?.displayedToActorIds || [];
  return (object.presentation?.publiclyVisible ?? defaultVisible) === true
    || (observerActorId && displayedToActorIds.includes(observerActorId));
}

/**
 * Canonical labels may contain an owner name, institutional meaning, or other
 * metadata that a glance cannot reveal.  A scene author may provide an
 * explicit public appearance; otherwise an undisclosed visible object stays
 * generic until it is deliberately shown.
 */
export function objectPublicPerceptionLabel(object = {}) {
  const explicit = clean(object.perception?.publicLabel || object.publicAppearanceLabel);
  if (explicit) return explicit;
  if (object.presentation?.exposure === "displayed") return clean(object.label) || "一件展示出来的物件";
  return "一件可见的随身物件";
}

/**
 * Add scene-declared objects without overwriting any object that has already
 * moved, changed holder, or changed state. This lets a scene adapter compile
 * its inventory from data while the ledger remains the sole runtime truth.
 */
export function mergeObjectTemplates({ ledger = {}, templates = [], sceneId = "" } = {}) {
  const normalized = normalizeObjectLedger(ledger);
  for (const raw of templates || []) {
    const object = canonicalObject({
      ...(raw || {}),
      sceneId: raw?.sceneId || sceneId,
    });
    if (!object.id || normalized.objects[object.id]) continue;
    normalized.objects[object.id] = object;
  }
  return rebuildIndexes(normalized);
}

function topologyZones(topology = {}) {
  if (Array.isArray(topology.zones)) return new Map(topology.zones.map((zone) => [clean(zone.id || zone.zoneId), zone]));
  return new Map(Object.entries(topology.zones || {}).map(([id, zone]) => [id, { id, ...(zone || {}) }]));
}

function violation(code, operationIndex, message, evidence = {}) {
  return { code, operationIndex, message, evidence };
}

function actorMap(actors = []) {
  return new Map((actors || []).map((actor) => [actorIdOf(actor), actor]).filter(([id]) => id));
}

function validateAndApplyOne(ledger, operation = {}, index, actors, zones) {
  const type = clean(operation.type).toLowerCase();
  const objectId = clean(operation.objectId);
  const actorId = clean(operation.actorId || operation.characterId);
  const object = ledger.objects?.[objectId];
  const actor = actors.get(actorId);
  if (!SUPPORTED_OPERATION_TYPES.has(type)) return violation("OBJECT_OPERATION_UNSUPPORTED", index, "Unsupported object operation.", { type });
  if (!object) return violation("OBJECT_UNKNOWN", index, "The referenced object does not exist.", { objectId });
  if (!actor || actor.present === false) return violation("OBJECT_ACTOR_UNAVAILABLE", index, "The acting person is not present.", { actorId });

  const actorSceneId = clean(actor.sceneId || actor.location?.sceneId);
  const actorZoneId = clean(actor.zoneId || actor.location?.zoneId);
  const declaredSceneId = clean(operation.sceneId || actorSceneId);
  const targetZoneId = clean(operation.toZoneId || operation.zoneId || actorZoneId);
  if (!actorSceneId || !actorZoneId) {
    return violation("OBJECT_ACTOR_LOCATION_UNKNOWN", index, "Physical object operations require the actor's current scene and zone.", {
      actorId,
      actorSceneId,
      actorZoneId,
    });
  }
  const actorZone = zones.get(actorZoneId);
  const actorZoneSceneId = clean(actorZone?.sceneId);
  if (actorZoneSceneId && actorZoneSceneId !== actorSceneId) {
    return violation("OBJECT_ACTOR_ZONE_SCENE_MISMATCH", index, "The actor's zone does not belong to the actor's declared scene.", {
      actorId,
      actorSceneId,
      actorZoneId,
      actorZoneSceneId,
    });
  }
  if (declaredSceneId && actorSceneId && declaredSceneId !== actorSceneId) {
    return violation("OBJECT_ACTOR_WRONG_SCENE", index, "The actor is not in the declared scene.", { actorSceneId, declaredSceneId });
  }
  if (targetZoneId && zones.size && !zones.has(targetZoneId)) {
    return violation("OBJECT_ZONE_UNKNOWN", index, "The target zone does not exist.", { targetZoneId });
  }
  const targetZoneSceneId = clean(zones.get(targetZoneId)?.sceneId);
  if (targetZoneSceneId && declaredSceneId && targetZoneSceneId !== declaredSceneId) {
    return violation("OBJECT_TARGET_ZONE_WRONG_SCENE", index, "The target zone does not belong to the declared scene.", {
      declaredSceneId,
      targetZoneId,
      targetZoneSceneId,
    });
  }

  if (["place", "move", "transfer", "transfer_attempt", "consume", "take_out", "store", "show", "hide", "draw", "sheathe"].includes(type) && object.holderActorId !== actorId) {
    return violation("OBJECT_NOT_POSSESSED", index, "The actor cannot manipulate an object held by somebody else or by nobody.", {
      objectId,
      actorId,
      actualHolderActorId: object.holderActorId,
    });
  }

  if (["place", "transfer", "transfer_attempt", "consume"].includes(type) && object.attachment?.active === true) {
    return violation("OBJECT_ATTACHED_TO_ACTOR", index, "An attached object must be explicitly detached before it can be placed, transferred, or consumed.", {
      objectId,
      actorId,
      attachment: clone(object.attachment),
    });
  }

  if (["attach", "detach"].includes(type) && object.holderActorId !== actorId) {
    return violation("OBJECT_NOT_POSSESSED", index, "Attachment transitions require the actor to possess the object.", {
      objectId,
      actorId,
      actualHolderActorId: object.holderActorId,
    });
  }

  if (type === "pickup") {
    if (!object.portable) return violation("OBJECT_NOT_PORTABLE", index, "The object is not portable.", { objectId });
    if (object.holderActorId) return violation("OBJECT_ALREADY_HELD", index, "The object already has a holder.", { objectId, holderActorId: object.holderActorId });
    if ((object.sceneId && actorSceneId && object.sceneId !== actorSceneId) || (object.zoneId && actorZoneId && object.zoneId !== actorZoneId)) {
      return violation("OBJECT_OUT_OF_REACH", index, "The actor and object are not co-located.", { objectSceneId: object.sceneId, objectZoneId: object.zoneId, actorSceneId, actorZoneId });
    }
    object.holderActorId = actorId;
    object.sceneId = actorSceneId || object.sceneId;
    object.zoneId = actorZoneId || object.zoneId;
    object.custody = { storageMode: "in_hand", containerId: "", inHand: true };
    object.presentation = { exposure: "visible", displayedToActorIds: [], publiclyVisible: true };
  } else if (["transfer", "transfer_attempt"].includes(type)) {
    if (type === "transfer_attempt" && object.custody?.inHand !== true) {
      return violation("OBJECT_NOT_IN_HAND", index, "Transfer is only an attempt until the holder explicitly takes the object into hand.", {
        objectId,
        storageMode: object.custody?.storageMode || "",
        containerId: object.custody?.containerId || "",
      });
    }
    const toHolderActorId = clean(operation.toHolderActorId);
    const receiver = actors.get(toHolderActorId);
    if (!receiver || receiver.present === false) return violation("OBJECT_RECEIVER_UNAVAILABLE", index, "The receiver is not present.", { toHolderActorId });
    const receiverSceneId = clean(receiver.sceneId || receiver.location?.sceneId);
    const receiverZoneId = clean(receiver.zoneId || receiver.location?.zoneId);
    if (!receiverSceneId || !receiverZoneId) {
      return violation("OBJECT_RECEIVER_LOCATION_UNKNOWN", index, "Transfer requires the receiver's current scene and zone.", {
        toHolderActorId,
        receiverSceneId,
        receiverZoneId,
      });
    }
    const receiverZoneSceneId = clean(zones.get(receiverZoneId)?.sceneId);
    if (receiverZoneSceneId && receiverZoneSceneId !== receiverSceneId) {
      return violation("OBJECT_RECEIVER_ZONE_SCENE_MISMATCH", index, "The receiver's zone does not belong to the receiver's declared scene.", {
        toHolderActorId,
        receiverSceneId,
        receiverZoneId,
        receiverZoneSceneId,
      });
    }
    if (actorSceneId !== receiverSceneId || actorZoneId !== receiverZoneId) {
      return violation("OBJECT_TRANSFER_NOT_COLOCATED", index, "Transfer requires both people in the same zone.", { actorSceneId, actorZoneId, receiverSceneId, receiverZoneId });
    }
    object.holderActorId = toHolderActorId;
    object.sceneId = receiverSceneId;
    object.zoneId = receiverZoneId;
    object.custody = { storageMode: "in_hand", containerId: "", inHand: true };
    object.presentation = { exposure: "visible", displayedToActorIds: [toHolderActorId], publiclyVisible: true };
  } else if (type === "take_out") {
    if (object.custody?.inHand === true) {
      return violation("OBJECT_ALREADY_IN_HAND", index, "The object is already in the holder's hand.", { objectId });
    }
    if (object.attachment?.active === true) {
      return violation("OBJECT_ATTACHED_TO_ACTOR", index, "A worn or fixed object must be detached or drawn through its explicit transition.", {
        objectId,
        attachment: clone(object.attachment),
      });
    }
    object.custody = { storageMode: "in_hand", containerId: "", inHand: true };
    object.presentation = { exposure: "visible", displayedToActorIds: [], publiclyVisible: true };
  } else if (type === "store") {
    if (object.custody?.inHand !== true) {
      return violation("OBJECT_NOT_IN_HAND", index, "Storing an object requires it to be in the holder's hand first.", { objectId });
    }
    if (object.attachment?.active === true) {
      return violation("OBJECT_ATTACHED_TO_ACTOR", index, "A worn or fixed object must be detached before it can be stored.", { objectId });
    }
    const storageMode = clean(operation.storageMode || "packed");
    if (!["packed", "pocketed", "wrapped", "carried"].includes(storageMode)) {
      return violation("OBJECT_STORAGE_MODE_INVALID", index, "Storing requires a concrete carried storage mode.", { objectId, storageMode });
    }
    object.custody = {
      storageMode,
      containerId: clean(operation.containerId || operation.containerObjectId),
      inHand: false,
    };
    object.presentation = { exposure: "hidden", displayedToActorIds: [], publiclyVisible: false };
  } else if (type === "show") {
    if (object.custody?.inHand !== true) {
      return violation("OBJECT_NOT_IN_HAND", index, "Showing an object requires the holder to take it into hand first.", { objectId });
    }
    const displayTargets = Array.isArray(operation.displayedToActorIds)
      ? operation.displayedToActorIds
      : [operation.targetActorId];
    const displayedToActorIds = [...new Set(displayTargets
      .map(clean)
      .filter(Boolean))];
    for (const targetActorId of displayedToActorIds) {
      const target = actors.get(targetActorId);
      const targetSceneId = clean(target?.sceneId || target?.location?.sceneId);
      const targetZoneId = clean(target?.zoneId || target?.location?.zoneId);
      if (!target || target.present === false || targetSceneId !== actorSceneId || targetZoneId !== actorZoneId) {
        return violation("OBJECT_DISPLAY_TARGET_NOT_COLOCATED", index, "An object can only be shown to a present person in the same zone.", {
          objectId,
          targetActorId,
          actorSceneId,
          actorZoneId,
          targetSceneId,
          targetZoneId,
        });
      }
    }
    object.presentation = {
      exposure: "displayed",
      displayedToActorIds,
      publiclyVisible: displayedToActorIds.length === 0,
    };
  } else if (type === "hide") {
    object.presentation = { exposure: "hidden", displayedToActorIds: [], publiclyVisible: false };
  } else if (type === "draw") {
    if (object.state?.sheathed === false) {
      return violation("OBJECT_ALREADY_DRAWN", index, "The weapon is already drawn.", { objectId });
    }
    if (object.attachment?.transitionRequiresExplicitOperation !== false && !clean(operation.affordanceId) && operation.explicitPrimitive !== "draw") {
      return violation("OBJECT_ATTACHMENT_TRANSITION_NOT_EXPLICIT", index, "Drawing requires an explicit world primitive or committed affordance.", { objectId });
    }
    object.state = { ...(object.state || {}), sheathed: false };
    if (object.attachment) object.attachment = {
      ...object.attachment,
      active: false,
      actorId: "",
      previousMode: clean(object.attachment.mode || "worn"),
      mode: "drawn",
    };
    object.custody = { storageMode: "in_hand", containerId: "", inHand: true };
    object.presentation = { exposure: "visible", displayedToActorIds: [], publiclyVisible: true };
  } else if (type === "sheathe") {
    if (object.state?.sheathed !== false || object.custody?.inHand !== true) {
      return violation("OBJECT_NOT_DRAWN_IN_HAND", index, "Sheathing requires a drawn weapon in the holder's hand.", { objectId });
    }
    if (object.attachment?.transitionRequiresExplicitOperation !== false && !clean(operation.affordanceId) && operation.explicitPrimitive !== "sheathe") {
      return violation("OBJECT_ATTACHMENT_TRANSITION_NOT_EXPLICIT", index, "Sheathing requires an explicit world primitive or committed affordance.", { objectId });
    }
    object.state = { ...(object.state || {}), sheathed: true };
    object.attachment = {
      ...(object.attachment || {}),
      active: true,
      actorId,
      mode: clean(operation.attachmentMode || object.attachment?.previousMode || "worn"),
      transitionRequiresExplicitOperation: object.attachment?.transitionRequiresExplicitOperation !== false,
    };
    object.custody = { storageMode: "worn", containerId: "", inHand: false };
    object.presentation = {
      exposure: clean(operation.exposure || "visible"),
      displayedToActorIds: [],
      publiclyVisible: clean(operation.exposure || "visible") === "visible",
    };
  } else if (type === "place") {
    if (actorSceneId && declaredSceneId && actorSceneId !== declaredSceneId) return violation("OBJECT_ACTOR_WRONG_SCENE", index, "The actor is in another scene.");
    if (actorZoneId && targetZoneId && actorZoneId !== targetZoneId) {
      return violation("OBJECT_PLACE_OUT_OF_REACH", index, "An object can only be placed in the actor's current zone.", { actorZoneId, targetZoneId });
    }
    object.holderActorId = "";
    object.sceneId = actorSceneId || declaredSceneId || object.sceneId;
    object.zoneId = targetZoneId || actorZoneId || object.zoneId;
    object.custody = { storageMode: "placed", containerId: "", inHand: false };
    object.presentation = { exposure: "visible", displayedToActorIds: [], publiclyVisible: true };
  } else if (type === "move") {
    if (actorZoneId && targetZoneId && actorZoneId !== targetZoneId) {
      return violation("OBJECT_MOVE_OUT_OF_REACH", index, "A held object can only move to the actor's current committed zone.", {
        objectId,
        actorZoneId,
        targetZoneId,
      });
    }
    object.sceneId = actorSceneId || declaredSceneId || object.sceneId;
    object.zoneId = targetZoneId || actorZoneId || object.zoneId;
  } else if (type === "update_state") {
    const statePatch = clone(operation.patch || operation.statePatch || {});
    if (Object.hasOwn(statePatch, "attachment") || Object.hasOwn(statePatch, "attachedToActorId")) {
      return violation("OBJECT_ATTACHMENT_PATCH_FORBIDDEN", index, "Attachment cannot be changed through a generic state patch; use attach or detach.", { objectId });
    }
    const expectedHolderActorId = clean(operation.fromHolderActorId || operation.requiredHolderActorId);
    if (expectedHolderActorId && object.holderActorId !== expectedHolderActorId) {
      return violation("OBJECT_WRONG_HOLDER", index, "Object state change requires the declared holder.", { expectedHolderActorId, actualHolderActorId: object.holderActorId });
    }
    if (object.holderActorId && object.holderActorId !== actorId) {
      return violation("OBJECT_NOT_POSSESSED", index, "An actor cannot change the state of an object held by somebody else.", {
        objectId,
        actorId,
        actualHolderActorId: object.holderActorId,
      });
    }
    if (!object.holderActorId
      && ((object.sceneId && actorSceneId && object.sceneId !== actorSceneId)
        || (object.zoneId && actorZoneId && object.zoneId !== actorZoneId))) {
      return violation("OBJECT_OUT_OF_REACH", index, "Object state changes require the actor and object to be co-located.", {
        objectSceneId: object.sceneId,
        objectZoneId: object.zoneId,
        actorSceneId,
        actorZoneId,
      });
    }
    object.state = { ...(object.state || {}), ...statePatch };
  } else if (type === "detach") {
    if (object.attachment?.active !== true) {
      return violation("OBJECT_NOT_ATTACHED", index, "The object is not currently attached to an actor.", { objectId });
    }
    if (clean(object.attachment.actorId) !== actorId) {
      return violation("OBJECT_ATTACHMENT_ACTOR_MISMATCH", index, "The object is attached to a different actor.", {
        objectId,
        actorId,
        attachedToActorId: clean(object.attachment.actorId),
      });
    }
    if (object.attachment.transitionRequiresExplicitOperation !== false && !clean(operation.affordanceId)) {
      return violation("OBJECT_ATTACHMENT_TRANSITION_NOT_EXPLICIT", index, "Detaching a worn or fixed object requires an explicit committed affordance.", { objectId });
    }
    object.attachment = {
      ...object.attachment,
      active: false,
      actorId: "",
      previousMode: clean(object.attachment.mode),
      mode: "detached",
    };
    object.custody = { storageMode: "in_hand", containerId: "", inHand: true };
    object.presentation = { exposure: "visible", displayedToActorIds: [], publiclyVisible: true };
  } else if (type === "attach") {
    if (object.attachment?.active === true) {
      return violation("OBJECT_ALREADY_ATTACHED", index, "The object is already attached to an actor.", { objectId });
    }
    const attachmentMode = clean(operation.attachmentMode || operation.mode);
    if (!attachmentMode) {
      return violation("OBJECT_ATTACHMENT_MODE_MISSING", index, "Attaching an object requires a concrete attachment mode.", { objectId });
    }
    if (object.attachment?.transitionRequiresExplicitOperation !== false && !clean(operation.affordanceId)) {
      return violation("OBJECT_ATTACHMENT_TRANSITION_NOT_EXPLICIT", index, "Attaching an object requires an explicit committed affordance.", { objectId });
    }
    object.attachment = {
      ...(object.attachment || {}),
      active: true,
      actorId,
      mode: attachmentMode,
      transitionRequiresExplicitOperation: object.attachment?.transitionRequiresExplicitOperation !== false,
    };
    object.custody = { storageMode: "worn", containerId: "", inHand: false };
    object.presentation = { exposure: "visible", displayedToActorIds: [], publiclyVisible: true };
  } else if (type === "consume") {
    delete ledger.objects[objectId];
  }
  rebuildIndexes(ledger);
  return null;
}

function evaluateOperations({ ledger = {}, operations = [], actors = [], topology = {} } = {}) {
  const next = normalizeObjectLedger(ledger);
  const actorsById = actorMap(actors);
  const zones = topologyZones(topology);
  const violations = [];
  for (let index = 0; index < (operations || []).length; index += 1) {
    const error = validateAndApplyOne(next, operations[index], index, actorsById, zones);
    if (error) {
      violations.push(error);
      break;
    }
  }
  return { ok: violations.length === 0, violations, next };
}

export function validateObjectOperations(input = {}) {
  const result = evaluateOperations(input);
  return { ok: result.ok, valid: result.ok, violations: result.violations };
}

export function applyObjectOperations(input = {}) {
  const original = normalizeObjectLedger(input.ledger || {});
  const result = evaluateOperations({ ...input, ledger: original });
  return {
    ok: result.ok,
    applied: result.ok,
    ledger: result.ok ? result.next : original,
    violations: result.violations,
  };
}

export function validatePossessionClaims({ ledger = {}, actorId = "", claims = [] } = {}) {
  const normalized = normalizeObjectLedger(ledger);
  const heldObjects = (normalized.heldByActor?.[actorId] || []).map((id) => normalized.objects[id]).filter(Boolean);
  const violations = [];
  for (const claim of claims || []) {
    if (claim.requiresPossession === false) continue;
    const alias = clean(claim.objectAlias || claim.label);
    const matchingHeldObject = heldObjects.find((object) => [object.label, ...(object.aliases || [])].some((value) => clean(value) === alias));
    if (!matchingHeldObject) violations.push(violation(
      "OBJECT_NOT_POSSESSED",
      Number(claim.claimIndex || 0),
      "The visible action claims manipulation of an object the actor does not hold.",
      { actorId, objectAlias: alias, heldObjectIds: heldObjects.map((object) => object.id) },
    ));
  }
  return { ok: violations.length === 0, valid: violations.length === 0, violations };
}

/** Validate that concrete task objects/tools exist and are physically usable. */
export function validateObjectAccess({
  ledger = {},
  actor = {},
  objectIds = [],
  sceneId = "",
  zoneId = "",
  topology = {},
} = {}) {
  const normalized = normalizeObjectLedger(ledger);
  const actorId = actorIdOf(actor);
  const actorSceneId = clean(actor.sceneId || actor.location?.sceneId);
  const actorZoneId = clean(actor.zoneId || actor.location?.zoneId);
  const declaredSceneId = clean(sceneId);
  const declaredZoneId = clean(zoneId);
  const zones = topologyZones(topology);
  const requiredObjectIds = [...new Set((objectIds || []).map(clean).filter(Boolean))];
  const violations = [];

  if (!requiredObjectIds.length) return { ok: true, valid: true, violations };
  if (!actorId || actor.present === false) {
    violations.push(violation("OBJECT_ACTOR_UNAVAILABLE", 0, "Object access requires a present acting person.", { actorId }));
    return { ok: false, valid: false, violations };
  }
  if (!actorSceneId || !actorZoneId) {
    violations.push(violation(
      "OBJECT_ACTOR_LOCATION_UNKNOWN",
      0,
      "Object access requires the actor's committed scene and zone; call-site declarations cannot substitute for missing actor state.",
      { actorId, actorSceneId, actorZoneId, declaredSceneId, declaredZoneId },
    ));
    return { ok: false, valid: false, violations };
  }
  if (declaredSceneId && declaredSceneId !== actorSceneId) {
    violations.push(violation("OBJECT_ACTOR_WRONG_SCENE", 0, "The actor is not in the declared access scene.", {
      actorId,
      actorSceneId,
      declaredSceneId,
    }));
    return { ok: false, valid: false, violations };
  }
  if (declaredZoneId && declaredZoneId !== actorZoneId) {
    violations.push(violation("OBJECT_ACTOR_WRONG_ZONE", 0, "The actor is not in the declared access zone.", {
      actorId,
      actorZoneId,
      declaredZoneId,
    }));
    return { ok: false, valid: false, violations };
  }
  if (zones.size && !zones.has(actorZoneId)) {
    violations.push(violation("OBJECT_ACTOR_ZONE_UNKNOWN", 0, "The actor's current zone does not exist in the supplied topology.", {
      actorId,
      actorSceneId,
      actorZoneId,
    }));
    return { ok: false, valid: false, violations };
  }
  const actorZoneSceneId = clean(zones.get(actorZoneId)?.sceneId || zones.get(actorZoneId)?.locationId);
  if (actorZoneSceneId && actorZoneSceneId !== actorSceneId) {
    violations.push(violation("OBJECT_ACTOR_ZONE_SCENE_MISMATCH", 0, "The actor's zone does not belong to the actor's declared scene.", {
      actorId,
      actorSceneId,
      actorZoneId,
      actorZoneSceneId,
    }));
    return { ok: false, valid: false, violations };
  }

  for (const objectId of requiredObjectIds) {
    const object = normalized.objects[objectId];
    if (!object) {
      violations.push(violation("OBJECT_UNKNOWN", 0, "A required task object does not exist in the scene ledger.", { objectId }));
      continue;
    }
    const objectSceneId = clean(object.sceneId || object.location?.sceneId);
    const objectZoneId = clean(object.zoneId || object.location?.zoneId);
    if (objectZoneId && zones.size && !zones.has(objectZoneId)) {
      violations.push(violation("OBJECT_ZONE_UNKNOWN", 0, "A required object's zone does not exist in the supplied topology.", {
        objectId,
        objectSceneId,
        objectZoneId,
      }));
      continue;
    }
    const objectZoneSceneId = clean(zones.get(objectZoneId)?.sceneId || zones.get(objectZoneId)?.locationId);
    if (objectSceneId && objectZoneSceneId && objectSceneId !== objectZoneSceneId) {
      violations.push(violation("OBJECT_ZONE_SCENE_MISMATCH", 0, "A required object's zone does not belong to its declared scene.", {
        objectId,
        objectSceneId,
        objectZoneId,
        objectZoneSceneId,
      }));
      continue;
    }
    if (object.holderActorId) {
      if (object.holderActorId !== actorId) {
        violations.push(violation("OBJECT_HELD_BY_OTHER", 0, "A required object is held by another actor.", {
          objectId,
          actorId,
          actualHolderActorId: object.holderActorId,
        }));
        continue;
      }
    }
    if ((objectSceneId && objectSceneId !== actorSceneId)
      || (objectZoneId && objectZoneId !== actorZoneId)) {
      violations.push(violation("OBJECT_OUT_OF_REACH", 0, "A required object is not in the actor's current scene and zone.", {
        objectId,
        objectSceneId,
        objectZoneId,
        actorSceneId,
        actorZoneId,
      }));
    }
  }
  return { ok: violations.length === 0, valid: violations.length === 0, violations };
}

/** Keep every held object attached to its holder after an atomic actor move. */
export function relocateHeldObjects({ ledger = {}, actorId = "", sceneId = "", zoneId = "" } = {}) {
  const normalized = normalizeObjectLedger(ledger);
  const holderId = clean(actorId);
  for (const objectId of normalized.heldByActor?.[holderId] || []) {
    const object = normalized.objects[objectId];
    if (!object) continue;
    if (sceneId) object.sceneId = clean(sceneId);
    if (zoneId) object.zoneId = clean(zoneId);
  }
  return rebuildIndexes(normalized);
}
