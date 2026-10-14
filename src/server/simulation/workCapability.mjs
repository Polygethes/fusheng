import {
  completeDurativeWorldProcess,
  durativeWorldProcessProgress,
  resumeDurativeWorldProcess,
  startDurativeWorldProcess,
} from "./durativeWorldProcess.mjs";

import { physicalAttemptForSettlement } from "./physicalExpression.mjs";
import { perceivableRoute } from "./worldActionRegistry.mjs";

export const WORK_CAPABILITY_VERSION = "work-capability-v1";

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, finite(value, minimum)));
}

function setOperation(path, value) {
  return { op: "set", path, value: clone(value) };
}

function baseResolution(attempt = {}) {
  return {
    authority: "world-action-registry",
    primitive: clean(attempt.primitive || "use_affordance"),
    status: "failed",
    attemptSurface: [],
    intendedEffects: [],
    resolvedEffects: [],
    failedEffects: [],
    incidentalEffects: [],
    committedFacts: [],
    deliveries: [],
    durationSeconds: 1,
    statePatch: { operations: [] },
  };
}

function placeForActor(state = {}, actor = {}) {
  return state.places?.[clean(actor.placeId)] || null;
}

function definitionFor(place = {}, templateId = "") {
  return place.workCapability?.definitions?.[clean(templateId)] || null;
}

function progressFor(place = {}, templateId = "") {
  const row = place.workCapability?.progress?.[clean(templateId)] || {};
  return {
    completedUnits: Math.max(0, Math.floor(finite(row.completedUnits, 0))),
  };
}

function inFlightUnits(state = {}, templateId = "") {
  return (state.processes || []).filter((row) => (
    clean(row.kind) === "work_unit"
    && clean(row.metadata?.workTemplateId) === clean(templateId)
    && ["active", "interrupted", "ready"].includes(clean(row.status))
  )).length;
}

function remainingUnits(state, place, definition) {
  const condition = definition.completionCondition;
  if (condition && numericPathValue(state.objects?.[condition.objectId]?.state, condition.path) >= condition.minimum) return 0;
  return Math.max(0, Number(definition.requiredUnits || 1) - progressFor(place, definition.templateId).completedUnits - inFlightUnits(state, definition.templateId));
}

function heldRequiredTools(state = {}, actorId = "", definition = {}) {
  const required = unique(definition.toolIds || []);
  const held = new Set(Object.values(state.objects || {})
    .filter((row) => clean(row?.holderCharacterId) === clean(actorId) && row.custody?.inHand !== false)
    .map((row) => clean(row.id)));
  return {
    required,
    missing: required.filter((id) => !held.has(id)),
  };
}

function numericPathValue(root = {}, path = []) {
  let cursor = root;
  for (const segment of path || []) cursor = cursor?.[clean(segment)];
  return finite(cursor, 0);
}

function changedObjectState(state = {}, effect = {}) {
  const objectId = clean(effect.objectId);
  const object = state.objects?.[objectId];
  const path = (effect.path || []).map(clean).filter(Boolean);
  if (!object || !path.length) return { ok: false, code: "WORK_RESOURCE_EFFECT_INVALID", objectId };
  const previous = numericPathValue(object.state || {}, path);
  const minimum = finite(effect.minimum, -Number.MAX_SAFE_INTEGER);
  const maximum = finite(effect.maximum, Number.MAX_SAFE_INTEGER);
  const next = clamp(previous + finite(effect.delta, 0), minimum, maximum);
  if (next !== previous + finite(effect.delta, 0)) {
    return { ok: false, code: "WORK_RESOURCE_EFFECT_OUT_OF_RANGE", objectId, previous, delta: finite(effect.delta, 0) };
  }
  const nextState = clone(object.state || {});
  let cursor = nextState;
  for (const segment of path.slice(0, -1)) {
    if (!cursor[segment] || typeof cursor[segment] !== "object") cursor[segment] = {};
    cursor = cursor[segment];
  }
  cursor[path.at(-1)] = next;
  return { ok: true, objectId, previous, next, nextState };
}

function resourceChanges(state, definition) {
  const working = { ...state, objects: { ...state.objects } };
  const changes = [];
  const apply = effect => {
    const changed = changedObjectState(working, effect);
    if (changed.ok) {
      working.objects[changed.objectId] = { ...working.objects[changed.objectId], state: changed.nextState };
      changes.push(changed);
    }
    return changed;
  };
  for (const effect of definition.completionEffects?.objectNumericDeltas || []) {
    const changed = apply(effect);
    if (!changed.ok) return changed;
  }
  for (const transfer of definition.completionEffects?.objectNumericTransfers || []) {
    const from = transfer.from || {}, to = transfer.to || {};
    const source = working.objects[from.objectId], destination = working.objects[to.objectId];
    const sourceScale = Number(from.unitsPerValue ?? 1), destinationScale = Number(to.unitsPerValue ?? 1);
    if (!source || !destination || from.objectId === to.objectId || !(sourceScale > 0) || !(destinationScale > 0)
      || !(Number(transfer.maxUnits) > 0)) return { ok: false, code: "WORK_RESOURCE_EFFECT_INVALID" };
    const available = numericPathValue(source.state, from.path) * sourceScale;
    const capacity = (Number(to.maximum ?? 1) - numericPathValue(destination.state, to.path)) * destinationScale;
    if (!(available > 1e-9)) return { ok: false, code: "WORK_TRANSFER_SOURCE_EMPTY", objectId: from.objectId };
    if (!(capacity > 1e-9)) return { ok: false, code: "WORK_TRANSFER_DESTINATION_FULL", objectId: to.objectId };
    const amount = Math.min(Number(transfer.maxUnits), available, capacity);
    for (const effect of [{ ...from, delta: -amount / sourceScale, minimum: 0 },
      { ...to, delta: amount / destinationScale, minimum: 0 }]) {
      const changed = apply(effect);
      if (!changed.ok) return changed;
    }
  }
  // A finished step can leave a thing in a state: the stove lit, the pot refilled.
  for (const effect of definition.completionEffects?.objectStateSets || []) {
    const objectId = clean(effect.objectId);
    const object = working.objects[objectId];
    const path = (effect.path || []).map(clean).filter(Boolean);
    if (!object || !path.length || !["boolean", "number", "string"].includes(typeof effect.value)) return { ok: false, code: "WORK_RESOURCE_EFFECT_INVALID", objectId };
    const nextState = clone(object.state || {});
    let cursor = nextState;
    for (const segment of path.slice(0, -1)) {
      if (!cursor[segment] || typeof cursor[segment] !== "object") cursor[segment] = {};
      cursor = cursor[segment];
    }
    const previous = cursor[path.at(-1)];
    cursor[path.at(-1)] = effect.value;
    working.objects[objectId] = { ...object, state: nextState };
    changes.push({ ok: true, objectId, previous, next: effect.value, nextState });
  }
  return { ok: true, changes };
}

function charactersWhoCanSee(state = {}, actor = {}) {
  return Object.values(state.entities || {}).filter((row) => (
    row?.kind === "character"
    && row.present !== false
    && clean(row.id) !== clean(actor.id)
    && clean(row.placeId) === clean(actor.placeId)
    && perceivableRoute(placeForActor(state, actor) || {}, actor.zoneId, row.zoneId, "visual") != null
  ));
}

function settleWorkSound(result, state, actor, attempt, definition, processId) {
  const sound = definition.completionSound;
  if (!sound?.content) return;
  const signalId = `signal:${attempt.attemptId}:work`;
  const signal = { signalId, kind: "work_sound", modality: "sound", sourceCharacterId: actor.id,
    placeId: actor.placeId, zoneId: actor.zoneId, sourceProcessId: processId, content: sound.content,
    emittedAtSeconds: Number(state.nowSeconds || 0) + result.durationSeconds,
    audibleUntilSeconds: Number(state.nowSeconds || 0) + result.durationSeconds + 3 };
  result.statePatch.operations.push({ op: "append", path: ["signals"], value: signal });
  result.resolvedEffects.push({ kind: "work_sound_emitted", signalId, sourceProcessId: processId });
  for (const recipient of Object.values(state.entities || {})) {
    if (recipient.kind !== "character" || recipient.present === false || recipient.id === actor.id || recipient.placeId !== actor.placeId) continue;
    const distance = perceivableRoute(placeForActor(state, actor) || {}, actor.zoneId, recipient.zoneId, "sound");
    if (distance == null || distance > sound.maxDistance) continue;
    result.deliveries.push({ deliveryId: `delivery:${signalId}:${recipient.id}`, eventKind: "work_sound", modality: "sound",
      signalId, sourceCharacterId: actor.id, recipientCharacterId: recipient.id, sourceProcessId: processId, content: sound.content });
  }
}

function visibleDeliveries(state = {}, actor = {}, attempt = {}, eventKind = "work_activity", content = "") {
  return charactersWhoCanSee(state, actor).map((recipient) => ({
    deliveryId: `delivery:${clean(attempt.attemptId)}:${eventKind}:${clean(recipient.id)}`,
    eventKind,
    modality: "visual",
    sourceCharacterId: clean(actor.id),
    recipientCharacterId: clean(recipient.id),
    content: clean(content),
    observableAffectiveTexture: clone(attempt.payload?.observableAffectiveTexture || []),
  }));
}

function publicProcess(process = {}, nowSeconds = 0) {
  const progress = durativeWorldProcessProgress(process, nowSeconds);
  return {
    processId: clean(process.id),
    kind: clean(process.kind),
    status: clean(process.status),
    workTemplateId: clean(process.metadata?.workTemplateId || process.subjectId),
    workLabel: clean(process.metadata?.publicLabel),
    stationZoneId: clean(process.stationZoneId),
    objectIds: clone(process.objectIds || []),
    attentionMode: clean(process.attentionMode),
    progress: Number(progress.progress || 0),
    remainingSeconds: Number(progress.remainingSeconds || 0),
  };
}

// Capability is settled by the world, not by the plot: work that needs a
// skill the person lacks fails without changing anything.
function missingSkills(state = {}, actorId = "", definition = {}) {
  const held = new Set(state.entities?.[clean(actorId)]?.skills || []);
  return (definition.requiredSkillIds || []).filter((id) => !held.has(id));
}

export function buildWorkCapabilityStateFromTemplates(templates = []) {
  const definitions = {};
  const progress = {};
  for (const source of templates || []) {
    const templateId = clean(source?.templateId);
    if (!templateId) continue;
    definitions[templateId] = {
      templateId,
      workKind: clean(source.taskKind || "work"),
      zoneId: clean(source.zoneId),
      taskLabel: clean(source.taskLabel || source.description || templateId),
      unitAction: clean(source.unitAction || source.description || source.taskLabel || templateId),
      requiredUnits: Math.max(1, Math.floor(finite(source.requiredUnits, 1))),
      unitLabel: clean(source.unitLabel || "项"),
      objectIds: unique(source.objectIds || []),
      toolIds: unique(source.toolIds || []),
      durationSecondsPerUnit: Math.max(1, finite(source.durationSecondsPerUnit, 30)),
      bodyLoadPerUnit: {
        exertionDelta: clamp(finite(source.bodyLoadPerUnit?.exertionDelta, 0), 0, 1),
        fatigueDelta: clamp(finite(source.bodyLoadPerUnit?.fatigueDelta, 0), 0, 1),
        staminaDelta: clamp(finite(source.bodyLoadPerUnit?.staminaDelta, 0), -1, 1),
        energyDelta: clamp(finite(source.bodyLoadPerUnit?.energyDelta, 0), -1, 1),
      },
      completionEffects: {
        objectNumericDeltas: clone(source.completionEffects?.objectNumericDeltas || []),
        objectNumericTransfers: clone(source.completionEffects?.objectNumericTransfers || []),
        ...(source.completionEffects?.objectStateSets?.length ? { objectStateSets: clone(source.completionEffects.objectStateSets) } : {}),
      },
      completionSound: source.completionSound ? { content: clean(source.completionSound.content), maxDistance: Math.max(0, finite(source.completionSound.maxDistance, 1)) } : null,
      completionCondition: clone(source.completionCondition || null),
      ...(source.requiredSkillIds?.length ? {
        requiredSkillIds: unique(source.requiredSkillIds),
        requiredSkillLabel: clean(source.requiredSkillLabel || source.requiredSkillIds.join("、")),
      } : {}),
    };
    progress[templateId] = { completedUnits: 0 };
  }
  return { schemaVersion: 1, definitions, progress };
}

export function listWorkCapabilityAffordances({ state = {}, actorId = "" } = {}) {
  const actor = state.entities?.[clean(actorId)];
  if (!actor || actor.kind !== "character" || actor.present === false) return { affordances: [], ownedProcesses: [] };
  const place = placeForActor(state, actor) || {};
  const nowSeconds = Math.max(0, finite(state.nowSeconds, 0));
  const ownedProcesses = (state.processes || [])
    .filter((row) => clean(row.ownerActorId) === clean(actor.id) && clean(row.kind) === "work_unit")
    .map((row) => publicProcess(row, nowSeconds));
  const affordances = [];

  for (const process of (state.processes || []).filter((row) => (
    clean(row.ownerActorId) === clean(actor.id)
    && clean(row.kind) === "work_unit"
    && clean(row.status) === "ready"
  ))) {
    const definition = definitionFor(place, process.metadata?.workTemplateId || process.subjectId) || {};
    const tools = heldRequiredTools(state, actor.id, definition);
    const currentlyExecutable = clean(actor.zoneId) === clean(process.stationZoneId) && tools.missing.length === 0;
    affordances.push({
      canonicalAffordanceId: `work:finish:${clean(process.id)}`,
      operation: "finish_work_unit",
      processId: clean(process.id),
      workTemplateId: clean(process.metadata?.workTemplateId || process.subjectId),
      public: {
        kind: "work_operation",
        operation: "finish_work_unit",
        workTemplateId: clean(process.metadata?.workTemplateId || process.subjectId),
        label: `收好这一${clean(definition.unitLabel || "项")}${clean(definition.taskLabel || "工作")}`,
        requiredZoneId: clean(process.stationZoneId),
        currentlyExecutable,
        physicalPrerequisites: [
          ...(clean(actor.zoneId) === clean(process.stationZoneId) ? [] : [`本人先到${clean(process.stationZoneId)}`]),
          ...tools.missing.map((id) => `本人先拿到${clean(state.objects?.[id]?.label || id)}`),
        ],
      },
    });
  }

  for (const process of (state.processes || []).filter((row) => (
    clean(row.ownerActorId) === clean(actor.id)
    && clean(row.kind) === "work_unit"
    && clean(row.status) === "interrupted"
  ))) {
    const definition = definitionFor(place, process.metadata?.workTemplateId || process.subjectId) || {};
    const tools = heldRequiredTools(state, actor.id, definition);
    const currentlyExecutable = clean(actor.zoneId) === clean(process.stationZoneId) && tools.missing.length === 0;
    if (!currentlyExecutable) continue;
    affordances.push({
      canonicalAffordanceId: `work:resume:${clean(process.id)}`,
      operation: "resume_work_unit",
      processId: clean(process.id),
      workTemplateId: clean(process.metadata?.workTemplateId || process.subjectId),
      public: {
        kind: "work_operation",
        operation: "resume_work_unit",
        workTemplateId: clean(process.metadata?.workTemplateId || process.subjectId),
        label: `接着${clean(definition.unitAction || definition.taskLabel || "做方才的工作")}`,
        requiredZoneId: clean(process.stationZoneId),
        currentlyExecutable: true,
        physicalPrerequisites: [],
      },
    });
  }

  const actorHasOpenWork = (state.processes || []).some((row) => (
    clean(row.ownerActorId) === clean(actor.id)
    && clean(row.kind) === "work_unit"
    && ["active", "interrupted", "ready"].includes(clean(row.status))
  ));
  for (const definition of Object.values(place.workCapability?.definitions || {})) {
    if (actorHasOpenWork) continue;
    const remaining = remainingUnits(state, place, definition);
    if (remaining <= 0) continue;
    const tools = heldRequiredTools(state, actor.id, definition);
    const resourcesAvailable = resourceChanges(state, definition).ok;
    const lackingSkills = missingSkills(state, actor.id, definition);
    const currentlyExecutable = !actorHasOpenWork && clean(actor.zoneId) === clean(definition.zoneId) && tools.missing.length === 0
      && resourcesAvailable && lackingSkills.length === 0;
    affordances.push({
      canonicalAffordanceId: `work:start:${clean(definition.templateId)}`,
      operation: "start_work_unit",
      workTemplateId: clean(definition.templateId),
      public: {
        kind: "work_operation",
        operation: "start_work_unit",
        workTemplateId: clean(definition.templateId),
        label: clean(definition.unitAction || definition.taskLabel),
        requiredZoneId: clean(definition.zoneId),
        remainingUnits: remaining,
        expectedDurationSeconds: Number(definition.durationSecondsPerUnit),
        timingMeaning: "一个完整工作单位；开始后持续到过程就绪、被打断或出现实际新情况，再决定收尾或改做别的。",
        unitLabel: clean(definition.unitLabel),
        currentlyExecutable,
        physicalPrerequisites: [
          ...(actorHasOpenWork ? ["本人先处理正在进行的工作"] : []),
          ...(clean(actor.zoneId) === clean(definition.zoneId) ? [] : [`本人先到${clean(definition.zoneId)}`]),
          ...tools.missing.map((id) => `本人先拿到${clean(state.objects?.[id]?.label || id)}`),
          ...(resourcesAvailable ? [] : ["需要可用的物料和容器余量"]),
          ...(lackingSkills.length ? [`需要${clean(definition.requiredSkillLabel || lackingSkills.join("、"))}的功底（本人未掌握）`] : []),
        ],
      },
    });
  }
  return { affordances, ownedProcesses };
}

export function settleWorkCapabilityAffordance({ state = {}, attempt = {} } = {}) {
  attempt = physicalAttemptForSettlement(attempt);
  const result = baseResolution(attempt);
  const actor = state.entities?.[clean(attempt.actorId)];
  const binding = attempt.payload?.capabilityBinding || {};
  const operation = clean(binding.operation);
  if (!actor || actor.kind !== "character" || actor.present === false) {
    result.failedEffects.push({ code: "WORK_ACTOR_NOT_PRESENT", actorId: clean(attempt.actorId) });
    return result;
  }
  if (clean(binding.capability) !== "work") {
    result.failedEffects.push({ code: "WORK_CAPABILITY_BINDING_INVALID" });
    return result;
  }
  const place = placeForActor(state, actor) || {};
  const nowSeconds = Math.max(0, finite(state.nowSeconds, 0));
  const visibleAction = clean(attempt.payload?.visibleAction);

  if (operation === "start_work_unit") {
    const templateId = clean(binding.workTemplateId);
    const definition = definitionFor(place, templateId);
    result.intendedEffects.push({ kind: "work_unit_started", workTemplateId: templateId });
    if (!definition) {
      result.failedEffects.push({ code: "WORK_DEFINITION_UNKNOWN", workTemplateId: templateId });
      return result;
    }
    if (clean(actor.zoneId) !== clean(definition.zoneId)) {
      result.failedEffects.push({ code: "WORK_WRONG_ZONE", requiredZoneId: clean(definition.zoneId) });
      return result;
    }
    const lackingSkills = missingSkills(state, actor.id, definition);
    if (lackingSkills.length) {
      result.failedEffects.push({ code: "WORK_SKILL_MISSING", skillIds: lackingSkills });
      return result;
    }
    const tools = heldRequiredTools(state, actor.id, definition);
    if (tools.missing.length) {
      result.failedEffects.push({ code: "WORK_REQUIRED_TOOL_NOT_HELD", toolIds: tools.missing });
      return result;
    }
    const openOwned = (state.processes || []).find((row) => (
      clean(row.ownerActorId) === clean(actor.id)
      && clean(row.kind) === "work_unit"
      && ["active", "interrupted", "ready"].includes(clean(row.status))
    ));
    if (openOwned) {
      result.failedEffects.push({ code: "WORK_ACTOR_ALREADY_ENGAGED", processId: clean(openOwned.id) });
      return result;
    }
    const remaining = remainingUnits(state, place, definition);
    if (remaining <= 0) {
      result.failedEffects.push({ code: "WORK_UNITS_ALREADY_COMPLETE", workTemplateId: templateId });
      return result;
    }
    const checked = resourceChanges(state, definition);
    if (!checked.ok) {
      result.failedEffects.push({ code: checked.code, objectId: checked.objectId });
      return result;
    }
    const processId = `process:${clean(attempt.attemptId)}`;
    const started = startDurativeWorldProcess(state.processes || [], {
      id: processId,
      kind: "work_unit",
      subjectId: templateId,
      ownerActorId: actor.id,
      stationZoneId: clean(definition.zoneId),
      objectIds: unique([...(definition.objectIds || []), ...(definition.toolIds || [])]),
      durationSeconds: Math.max(1, finite(definition.durationSecondsPerUnit, 30)),
      attentionMode: "continuous_work",
      sourceActionId: clean(attempt.attemptId),
      metadata: {
        sourceEventId: `world-event:${clean(attempt.attemptId)}`,
        workTemplateId: templateId,
        publicLabel: clean(definition.taskLabel || templateId),
        unitAction: clean(definition.unitAction || definition.taskLabel || templateId),
        unitLabel: clean(definition.unitLabel || "项"),
        readyNotice: `这一${clean(definition.unitLabel || "项")}${clean(definition.taskLabel || "工作")}已经做到可以收尾。`,
      },
    }, nowSeconds);
    if (!started.ok) {
      result.failedEffects.push({ code: started.code || "WORK_START_PROCESS_FAILED" });
      return result;
    }
    const content = visibleAction || `${clean(actor.name || actor.id)}开始${clean(definition.unitAction || definition.taskLabel)}。`;
    result.status = "success";
    result.durationSeconds = 2;
    result.attemptSurface.push({ kind: "work_unit_started", actorId: actor.id, processId, workTemplateId: templateId, zoneId: actor.zoneId, visibleAction: content });
    result.committedFacts.push(...result.attemptSurface);
    result.resolvedEffects.push({ kind: "work_unit_started", processId, workTemplateId: templateId });
    result.deliveries.push(...visibleDeliveries(state, actor, attempt, "work_unit_started", content));
    result.statePatch.operations.push(setOperation(["processes"], started.processes));
    return result;
  }

  if (operation === "finish_work_unit") {
    const processId = clean(binding.processId);
    const process = (state.processes || []).find((row) => clean(row.id) === processId);
    if (!process || clean(process.ownerActorId) !== clean(actor.id) || clean(process.kind) !== "work_unit") {
      result.failedEffects.push({ code: "WORK_PROCESS_NOT_OWNED", processId });
      return result;
    }
    const templateId = clean(process.metadata?.workTemplateId || process.subjectId);
    const definition = definitionFor(place, templateId);
    if (!definition) {
      result.failedEffects.push({ code: "WORK_DEFINITION_UNKNOWN", workTemplateId: templateId });
      return result;
    }
    if (clean(process.status) !== "ready") {
      result.failedEffects.push({ code: "WORK_PROCESS_NOT_READY", processId, status: clean(process.status) });
      return result;
    }
    if (clean(actor.zoneId) !== clean(process.stationZoneId)) {
      result.failedEffects.push({ code: "WORK_WRONG_ZONE", requiredZoneId: clean(process.stationZoneId) });
      return result;
    }
    const tools = heldRequiredTools(state, actor.id, definition);
    if (tools.missing.length) {
      result.failedEffects.push({ code: "WORK_REQUIRED_TOOL_NOT_HELD", toolIds: tools.missing });
      return result;
    }
    const checked = resourceChanges(state, definition);
    if (!checked.ok) {
      result.failedEffects.push({ code: checked.code, objectId: checked.objectId });
      return result;
    }
    const objectChanges = checked.changes;
    const completed = completeDurativeWorldProcess(state.processes || [], processId, nowSeconds, attempt.attemptId);
    if (!completed.ok) {
      result.failedEffects.push({ code: completed.code || "WORK_COMPLETE_PROCESS_FAILED", processId });
      return result;
    }
    const previousProgress = progressFor(place, templateId);
    const nextProgress = {
      ...clone(place.workCapability?.progress || {}),
      [templateId]: { completedUnits: previousProgress.completedUnits + 1 },
    };
    const bodyLoad = clone(definition.bodyLoadPerUnit || {});
    const content = `${clean(actor.name || actor.id)}完成了这一步：${clean(definition.unitAction || definition.taskLabel)}。`;
    result.status = "success";
    result.durationSeconds = 3;
    result.attemptSurface.push({ kind: "work_unit_completed", actorId: actor.id, processId, workTemplateId: templateId, zoneId: actor.zoneId, visibleAction: content });
    result.committedFacts.push(...result.attemptSurface);
    result.resolvedEffects.push(
      { kind: "work_unit_completed", processId, workTemplateId: templateId, completedUnits: previousProgress.completedUnits + 1 },
      { kind: "body_load_applied", targetActorId: actor.id, sourceProcessId: processId, ...bodyLoad },
      ...objectChanges.map((row) => ({ kind: "object_resource_changed", objectId: row.objectId, previousValue: row.previous, nextValue: row.next })),
    );
    result.deliveries.push(...visibleDeliveries(state, actor, attempt, "work_unit_completed", content));
    result.statePatch.operations.push(
      setOperation(["processes"], completed.processes),
      setOperation(["places", actor.placeId, "workCapability", "progress"], nextProgress),
      ...objectChanges.map((row) => setOperation(["objects", row.objectId, "state"], row.nextState)),
    );
    settleWorkSound(result, state, actor, attempt, definition, processId);
    return result;
  }

  if (operation === "resume_work_unit") {
    const processId = clean(binding.processId);
    const process = (state.processes || []).find((row) => clean(row.id) === processId);
    if (!process || clean(process.ownerActorId) !== clean(actor.id) || clean(process.kind) !== "work_unit") {
      result.failedEffects.push({ code: "WORK_PROCESS_NOT_OWNED", processId });
      return result;
    }
    const templateId = clean(process.metadata?.workTemplateId || process.subjectId);
    const definition = definitionFor(place, templateId);
    if (!definition) {
      result.failedEffects.push({ code: "WORK_DEFINITION_UNKNOWN", workTemplateId: templateId });
      return result;
    }
    if (clean(process.status) !== "interrupted") {
      result.failedEffects.push({ code: "WORK_PROCESS_NOT_INTERRUPTED", processId, status: clean(process.status) });
      return result;
    }
    if (clean(actor.zoneId) !== clean(process.stationZoneId)) {
      result.failedEffects.push({ code: "WORK_WRONG_ZONE", requiredZoneId: clean(process.stationZoneId) });
      return result;
    }
    const tools = heldRequiredTools(state, actor.id, definition);
    if (tools.missing.length) {
      result.failedEffects.push({ code: "WORK_REQUIRED_TOOL_NOT_HELD", toolIds: tools.missing });
      return result;
    }
    const resumed = resumeDurativeWorldProcess(state.processes || [], processId, nowSeconds, attempt.attemptId);
    if (!resumed.ok) {
      result.failedEffects.push({ code: resumed.code || "WORK_RESUME_PROCESS_FAILED", processId });
      return result;
    }
    const content = visibleAction || `${clean(actor.name || actor.id)}接着${clean(definition.unitAction || definition.taskLabel)}。`;
    result.status = "success";
    result.durationSeconds = 2;
    result.attemptSurface.push({ kind: "work_unit_resumed", actorId: actor.id, processId, workTemplateId: templateId, zoneId: actor.zoneId, visibleAction: content });
    result.committedFacts.push(...result.attemptSurface);
    result.resolvedEffects.push({ kind: "work_unit_resumed", processId, workTemplateId: templateId });
    result.deliveries.push(...visibleDeliveries(state, actor, attempt, "work_unit_resumed", content));
    result.statePatch.operations.push(setOperation(["processes"], resumed.processes));
    return result;
  }

  result.failedEffects.push({ code: "WORK_OPERATION_UNKNOWN", operation });
  return result;
}
