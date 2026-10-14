// Observer feed: the settled world history of one run, as stage frames.
//
// Every public fact comes from the world journal — who moved where, what was
// actually said and who received it, which object really changed, which
// attempt failed and why. A character's intention is attached only as a
// private annotation; it never moves anything on the stage.
import { applyWorldStatePatch } from "../simulation/worldActionRegistry.mjs";
import { buildTavernWorldStateV27 } from "../pipeline/tavernWorldRuntimeV27.mjs";
import { buildPlayableWorldFromPack } from "../../worlds/buildPlayableWorldFromPack.mjs";
import { FAILURE_LABELS } from "../simulation/settledSimulationReport.mjs";
import { environmentView } from "../simulation/worldEnvironmentEvents.mjs";
import { STAGE_NEWS } from "../simulation/worldEnvironment.mjs";
import { HAZARD_CAPTION } from "../simulation/naturalHazards.mjs";
import { healthOf } from "../simulation/characterHealth.mjs";

const clean = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

const HANDLE_KIND = { take: "pickup", pickup: "pickup", take_out: "take_out", show: "show", transfer: "transfer", place: "place",
  store: "store", hide: "hide", draw: "draw", sheathe: "sheathe", consume: "consume" };

function objectView(object = {}) {
  return { label: clean(object.label), holder: clean(object.holderCharacterId), zoneId: clean(object.zoneId),
    hidden: object.presentation?.exposure === "hidden", state: structuredClone(object.state || {}) };
}

function snapshot(state = {}) {
  return {
    nowSeconds: Number(state.nowSeconds || 0),
    entities: Object.fromEntries(Object.values(state.entities || {}).filter((row) => row.kind === "character")
      .map((row) => {
        const state = healthOf(row).state;
        return [row.id, { name: clean(row.name), zoneId: clean(row.zoneId), present: row.present !== false, ...(state !== "well" ? { condition: state } : {}) }];
      })),
    objects: Object.fromEntries(Object.values(state.objects || {}).filter((row) => row.kind !== "position")
      .map((row) => [row.id, objectView(row)])),
    agenda: list(state.temporalAgenda).map((row) => ({ id: row.id, label: row.label, dueAtSeconds: row.dueAtSeconds, status: row.status })),
    weather: clean(Object.values(state.places || {}).find((row) => row?.perceptionEnvironment?.weather)?.perceptionEnvironment?.weather),
    environment: environmentView(Object.values(state.places || {}).find((row) => row?.environment)?.environment || null),
  };
}

function diff(before, after) {
  const changes = { entities: {}, objects: {} };
  for (const [id, row] of Object.entries(after.entities)) {
    const prior = before.entities[id] || {};
    const entityChanged = prior.zoneId !== row.zoneId || prior.present !== row.present;
    const conditionChanged = (prior.condition || "well") !== (row.condition || "well");
    if (entityChanged || conditionChanged) {
      changes.entities[id] = {
        zoneId: row.zoneId,
        present: row.present,
        ...(conditionChanged ? { condition: row.condition || "well" } : {}),
      };
    }
  }
  for (const [id, row] of Object.entries(after.objects)) {
    const prior = before.objects[id];
    if (!prior || JSON.stringify(prior) !== JSON.stringify(row)) changes.objects[id] = row;
  }
  return changes;
}

function initialWorldState(save, pack) {
  const checkpoint = save.checkpoint || {};
  const final = checkpoint.coordinator?.worldState || {};
  const characterIds = list(checkpoint.actors).map((row) => row.characterId);
  const pacingMode = final.timePolicy?.mode || "day";
  const opening = list(final.temporalAgenda).find((row) => row.source === "configurable_scene_opening_schedule");
  return buildTavernWorldStateV27(buildPlayableWorldFromPack(pack), {
    worldPack: pack, characterIds, worldId: checkpoint.coordinator?.worldId,
    positions: pacingMode === "scene" ? pack.stage.scenePositions : {},
    pacingMode, openingAfterSeconds: opening?.dueAtSeconds ?? 900,
  });
}

// How a blow, a shove or a grab reads to the observer, who knows everyone's name.
const CONFRONT_CAPTION = {
  hit: (a, t) => `${a}一拳打在${t}身上。`, felled: (a, t) => `${a}把${t}打倒在地。`, killed: (a, t) => `${a}下了重手，${t}再也没动。`,
  missed: (a, t) => `${a}朝${t}挥拳，没打中。`, pushed_back: (a, t) => `${a}推了${t}一把，${t}退了几步。`, knocked_down: (a, t) => `${a}把${t}推倒在地。`,
  stood_firm: (a, t) => `${a}推了${t}一把，没推动。`, seized: (a, t) => `${a}一把抓住了${t}。`, slipped_free: (a, t) => `${a}伸手去抓${t}，被挣开了。`,
};
function confrontCaption(row = {}, before = {}) {
  const name = (id) => clean(before.entities?.[clean(id)]?.name) || "有人";
  return CONFRONT_CAPTION[clean(row.outcome)]?.(name(row.actorId), name(row.targetCharacterId)) || clean(row.visibleAction);
}

function actionFrame(event, payload, before, after) {
  const surface = list(payload.attemptSurface);
  const resolved = list(payload.resolvedEffects);
  const primitive = clean(payload.primitive);
  const handled = surface.find((row) => row.kind === "object_handling_attempted");
  const workStart = resolved.find((row) => row.kind === "work_unit_started");
  const workDone = resolved.find((row) => row.kind === "work_unit_completed") || surface.find((row) => row.kind === "work_unit_completed");
  const spoken = resolved.some((row) => row.kind === "speech_emitted") ? surface.find((row) => row.kind === "utterance_emitted") : null;
  const moved = surface.find((row) => row.kind === "movement_attempted");
  const gesture = surface.find((row) => row.kind === "gesture_performed" && clean(row.visibleAction));
  // A body action keeps its own kind even when words travel with it; the
  // utterance stays on the frame either way.
  const confronted = surface.find((row) => row.kind === "confrontation");
  const wedding = resolved.find((row) => row.kind === "married"), asked = resolved.find((row) => row.kind === "proposal_made");
  const offered = resolved.find((row) => row.kind === "exchange_offered"), swapped = resolved.find((row) => row.kind === "exchanged");
  const pursued = resolved.find((row) => row.kind === "pursued");
  const pursuit = surface.find((row) => row.kind === "pursuit_attempted");
  const thing = (id) => clean(before.objects[clean(id)]?.label);
  const sustainAttempted = surface.find((row) => row.kind === "sustenance_attempted");
  const sustainDone = surface.find((row) => row.kind === "sustenance_done");
  const nameIn = (id) => clean(before.entities[clean(id)]?.name);
  const sleepCaption = (primitive === "sleep" && payload.status === "success") ? `${nameIn(payload.actorId || event.actorId)}躺下睡了。` : "";
  const sustainCaption = sustainDone ? `${nameIn(payload.actorId || event.actorId)}${clean(sustainDone.visibleAction)}` : "";
  const marriageCaption = wedding ? `${nameIn(wedding.actorId)}和${nameIn(wedding.targetCharacterId)}结为夫妻。`
    : asked ? `${nameIn(asked.actorId)}向${nameIn(asked.targetCharacterId)}求亲。` : "";
  const exchangeCaption = offered ? `${nameIn(offered.actorId)}想拿${thing(offered.giveObjectId)}换${nameIn(offered.targetCharacterId)}的${thing(offered.wantObjectId)}。`
    : swapped ? `${nameIn(swapped.actorId)}和${nameIn(swapped.targetCharacterId)}换了东西：${thing(swapped.wantObjectId)}换${thing(swapped.giveObjectId)}。` : "";
  const pursueCaption = pursuit ? (pursued?.reached
    ? `${nameIn(pursuit.actorId)}追上${nameIn(pursuit.targetCharacterId)}。${confronted ? confrontCaption(confronted, before) : ""}`
    : `${nameIn(pursuit.actorId)}朝${nameIn(pursuit.targetCharacterId)}追了过去。`) : "";
  const took = resolved.find((row) => row.kind === "took_others_property");
  const kind = primitive === "move" ? "move"
    : primitive === "pursue" ? "pursue"
    : primitive === "handle" ? HANDLE_KIND[clean(handled?.operation)] || "handle"
      : workDone ? "work_done" : workStart ? "work_start"
        : primitive === "confront" ? "confront"
        : primitive === "marriage" ? "marriage"
        : primitive === "exchange" ? "exchange"
        : primitive === "sustain" ? "sustain"
        : primitive === "sleep" ? "sleep"
        : spoken ? "speak"
          : primitive === "use_affordance" ? "use"
            : ["observe", "listen", "rest", "wait", "gesture", "interact"].includes(primitive) ? primitive : primitive || "action";
  const recipients = [...new Set(list(payload.deliveries).map((row) => clean(row.recipientCharacterId)).filter(Boolean))];
  return {
    eventId: event.eventId, worldVersion: event.worldVersion, worldSeconds: Number(event.occurredAtSeconds || 0),
    type: "action", kind, primitive, status: clean(payload.status), actorId: clean(payload.actorId || event.actorId),
    agentTurnId: clean(payload.agentTurnId),
    fromZone: before.entities[clean(payload.actorId)]?.zoneId || "", toZone: after.entities[clean(payload.actorId)]?.zoneId || clean(moved?.toZoneId),
    targetCharacterId: clean(pursuit?.targetCharacterId || offered?.targetCharacterId || swapped?.targetCharacterId || wedding?.targetCharacterId || asked?.targetCharacterId || confronted?.targetCharacterId || spoken?.targetCharacterId || handled?.targetCharacterId || list(payload.failedEffects).find((r) => r.targetCharacterId)?.targetCharacterId || list(payload.deliveries).find((row) => row.directed)?.recipientCharacterId),
    ...(confronted ? { outcome: clean(confronted.outcome), act: clean(confronted.act) } : {}),
    objectId: clean(handled?.objectId || sustainAttempted?.objectId || workStart?.workTemplateId && ""),
    workTemplateId: clean(workStart?.workTemplateId || workDone?.workTemplateId),
    utterance: clean(spoken?.utterance),
    vocalMode: clean(spoken?.vocalMode),
    perceivedBy: recipients,
    caption: sleepCaption || sustainCaption || marriageCaption || exchangeCaption || pursueCaption || (confronted ? confrontCaption(confronted, before) : clean(gesture?.visibleAction || surface.find((row) => row.kind === "work_unit_started")?.visibleAction)),
    failureCodes: list(payload.failedEffects).map((row) => clean(row.code)).filter(Boolean),
    failureLabels: list(payload.failedEffects).map((row) => FAILURE_LABELS[clean(row.code)] || clean(row.code)).filter(Boolean),
    targetId: clean(surface.find((row) => row.targetId)?.targetId || payload.targetId),
    targetKind: clean(surface.find((row) => row.targetKind)?.targetKind),
    ...(took ? { ownerIds: list(took.ownerIds), ownerNames: list(took.ownerIds).map((id) => clean(before.entities[id]?.name)).filter(Boolean) } : {}),
    changes: diff(before, after),
  };
}

function worldEventCaption(payload = {}, state = {}) {
  const kind = clean(payload.worldEvent?.kind);
  if (kind === "weather") {
    const fact = list(payload.committedFacts).find((row) => row.kind === "weather_changed");
    return `天色变了：${clean(fact?.label || payload.worldEvent?.weather)}。`;
  }
  if (kind === "object") {
    const fact = list(payload.committedFacts).find((row) => row.kind === "object_appeared");
    const zoneId = clean(fact?.zoneId || payload.worldEvent?.zoneId);
    const label = clean(fact?.label || payload.worldEvent?.label);
    const place = Object.values(state.places || {}).find((row) => row?.topology?.zones?.[zoneId]) || Object.values(state.places || {})[0];
    const zoneName = clean(place?.topology?.zones?.[zoneId]?.label || zoneId);
    return `${zoneName}多了一样东西：${label}。`;
  }
  if (kind === "message") {
    const toId = clean(payload.worldEvent?.toCharacterId);
    const personName = clean(state.entities?.[toId]?.name || toId);
    return `有人给${personName}捎来口信。`;
  }
  if (kind === "accident") {
    return clean(payload.worldEvent?.description);
  }
  if (kind === "urge") {
    const toId = clean(payload.worldEvent?.toCharacterId);
    return `给${clean(state.entities?.[toId]?.name || toId)}授意：${clean(payload.worldEvent?.text)}`;
  }
  return clean(payload.worldEvent?.description);
}

/**
 * @returns {{ worldPackId, placeId, initial, frames, settledCount, replayConsistent, finalSeconds }}
 */
export function buildObserverFeed(save = {}, pack = {}) {
  const checkpoint = save.checkpoint || {};
  const events = [...list(checkpoint.coordinator?.journal?.events)].sort((a, b) => a.worldVersion - b.worldVersion);
  const turns = list(save.settledTurns);
  const turnById = new Map(turns.map((row) => [clean(row.agentTurnId), row]));
  let state = initialWorldState(save, pack);
  const initial = snapshot(state);
  const worldFrames = [];
  for (const event of events) {
    const before = snapshot(state);
    try { state = applyWorldStatePatch(state, event.statePatch || {}); } catch { /* keep the prior state; the payload still carries the facts */ }
    const after = snapshot(state);
    const payload = event.publicPayload || {};
    if (event.type === "action_resolved") {
      const frame = actionFrame(event, payload, before, after);
      const turn = turnById.get(frame.agentTurnId);
      if (turn?.intention) frame.intention = { private: true, text: clean(turn.intention) };
      if (turn?.inner?.length) frame.inner = { private: true, items: structuredClone(turn.inner) };
      if (Array.isArray(turn?.body)) frame.body = { private: true, lines: structuredClone(turn.body) };
      if (turn?.turnKind === "own_plan_step") frame.ownPlanStep = true;
      worldFrames.push(frame);
    } else if (event.type === "world_process_ready") {
      worldFrames.push({ eventId: event.eventId, worldVersion: event.worldVersion, worldSeconds: Number(event.occurredAtSeconds || after.nowSeconds),
        type: "world", kind: "process_ready", actorIds: list(payload.deliveries).map((row) => clean(row.recipientCharacterId)).filter(Boolean),
        caption: clean(list(payload.deliveries)[0]?.content), changes: diff(before, after) });
    } else if (event.type === "world_event") {
      worldFrames.push({ eventId: event.eventId, worldVersion: event.worldVersion, worldSeconds: Number(event.occurredAtSeconds || after.nowSeconds),
        type: "world", kind: "world_event", source: clean(payload.source) || "player", worldEventKind: clean(payload.worldEvent?.kind),
        actorIds: list(payload.deliveries).map((row) => clean(row.recipientCharacterId)).filter(Boolean),
        caption: worldEventCaption(payload, state), changes: diff(before, after),
        ...(payload.worldEvent?.kind === "weather" ? { weather: clean(list(payload.committedFacts).find((row) => row.kind === "weather_changed")?.weather || payload.worldEvent?.weather) } : {}) });
    } else if (event.type === "world_environment_changed") {
      worldFrames.push({ eventId: event.eventId, worldVersion: event.worldVersion, worldSeconds: Number(event.occurredAtSeconds || after.nowSeconds),
        type: "world", kind: "environment",
        actorIds: [...new Set(list(payload.deliveries).map((row) => clean(row.recipientCharacterId)).filter(Boolean))],
        environmentChanges: clone(payload.environmentChanges), environment: clone(payload.environment),
        hazards: clone(payload.hazards || []),
        caption: list(payload.environmentChanges).map((row) => STAGE_NEWS[row.level]?.[row.to] || "").join("")
          + list(payload.hazards).map((row) => HAZARD_CAPTION[row.outcome]?.(clean(before.entities?.[row.characterId]?.name)) || "").join(""),
        changes: diff(before, after) });
    } else if (event.type === "world_life_event") {
      worldFrames.push({ eventId: event.eventId, worldVersion: event.worldVersion, worldSeconds: Number(event.occurredAtSeconds || after.nowSeconds),
        type: "world", kind: "life", lifeEvent: clean(payload.lifeEvent), personId: clean(payload.personId),
        actorIds: [...new Set(list(payload.deliveries).map((row) => clean(row.recipientCharacterId)).filter(Boolean))],
        caption: clean(payload.caption), changes: diff(before, after) });
    } else if (event.type === "world_sleep_event") {
      worldFrames.push({ eventId: event.eventId, worldVersion: event.worldVersion, worldSeconds: Number(event.occurredAtSeconds || after.nowSeconds),
        type: "world", kind: "woke", personId: clean(payload.personId), actorIds: [clean(payload.personId)].filter(Boolean),
        caption: clean(payload.caption), changes: diff(before, after) });
    } else if (/deadline/u.test(event.type)) {
      for (const change of list(payload.deadlineEvents)) {
        worldFrames.push({ eventId: event.eventId, worldVersion: event.worldVersion, worldSeconds: Number(event.occurredAtSeconds || after.nowSeconds),
          type: "world", kind: "deadline", deadlineId: change.deadline?.id, label: clean(change.deadline?.label), status: clean(change.deadline?.status),
          change: clean(change.kind), changes: diff(before, after) });
      }
    } else {
      worldFrames.push({ eventId: event.eventId, worldVersion: event.worldVersion, worldSeconds: Number(event.occurredAtSeconds || after.nowSeconds),
        type: "world", kind: "clock", changes: diff(before, after) });
    }
  }
  // Private maintenance turns (day planning, reflection) change nothing in the
  // world; they appear in settlement order between the world events.
  const frames = [];
  const byTurn = new Map(worldFrames.filter((row) => row.agentTurnId).map((row) => [row.agentTurnId, row]));
  const emitted = new Set();
  let cursor = 0;
  const emitUntil = (frame) => {
    while (cursor < worldFrames.length) {
      const next = worldFrames[cursor++];
      if (!emitted.has(next)) { frames.push(next); emitted.add(next); }
      if (next === frame) return;
    }
  };
  for (const turn of turns) {
    const world = byTurn.get(clean(turn.agentTurnId));
    if (world) { emitUntil(world); continue; }
    frames.push({ type: "private", kind: turn.turnKind === "reflection" ? "reflection" : "planning", actorId: clean(turn.characterId),
      agentTurnId: clean(turn.agentTurnId), worldSeconds: frames.at(-1)?.worldSeconds ?? 0,
      intention: turn.intention ? { private: true, text: clean(turn.intention) } : null });
  }
  emitUntil(null);
  frames.forEach((frame, index) => { frame.seq = index + 1; });

  const final = snapshot(checkpoint.coordinator?.worldState || {});
  const replayConsistent = Object.entries(final.entities).every(([id, row]) => state.entities?.[id]?.zoneId === row.zoneId)
    && Object.entries(final.objects).every(([id, row]) => JSON.stringify(objectView(state.objects?.[id] || {})) === JSON.stringify(row));
  return { worldPackId: pack.meta?.id, placeId: pack.stage?.placeId, initial, frames, settledCount: turns.length,
    replayConsistent, finalSeconds: final.nowSeconds };
}
