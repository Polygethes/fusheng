import { classifyV27TurnKind } from "../engine/v27TurnPresentation.js";
import {
  TAVERN_NAVIGATION_MAP,
  buildTavernPatrolRoute,
  doesTavernSegmentCrossObstacle,
  parseTavernRoute,
  planTavernRoute,
  serializeTavernRoute,
  tavernAnchorFor,
  tavernRouteLength,
} from "./tavernNavigation.js";

export const INK_TAVERN_ASSETS = Object.freeze({
  background: "/assets/ink-tavern/tavern-topdown-v2.png",
  characters: Object.freeze({
    char_xyy_xiezenshi: "/assets/ink-tavern/xiezenshi-npc.png",
    char_xyy_luozhao: "/assets/ink-tavern/luozhao-npc.png",
    char_xyy_zhoumin: "/assets/ink-tavern/zhoumin-npc.png",
  }),
});

export const INK_TAVERN_ZONE_LAYOUT = Object.freeze({
  threshold: Object.freeze({ label: "门槛", x: 23.2, y: 84 }),
  hall: Object.freeze({ label: "堂前", x: 47, y: 77 }),
  counter: Object.freeze({ label: "柜台", x: 47, y: 51.5 }),
  stove: Object.freeze({ label: "灶边", x: 71.5, y: 57.5 }),
  courtyard: Object.freeze({ label: "后院", x: 36.5, y: 15 }),
  stairs: Object.freeze({ label: "楼梯口", x: 71.5, y: 47.5 }),
  guest_room: Object.freeze({ label: "楼上客房", x: 66.5, y: 15.5 }),
});

const MAINTENANCE_TURN_KINDS = new Set(["day_planning", "reflection"]);
const DEFAULT_ZONE_ID = "hall";
const DEFAULT_IDLE_CAPTION = "人物尚未开始行动。这里的位置与话语只读取世界公开结算。";
const OUTCOME_STATUS_LABELS = Object.freeze({
  success: "世界已结算",
  settled: "世界已结算",
  partial: "部分结算",
  failed: "尝试未发生",
  quiet: "暂无公开变化",
});
const ACTION_TYPE_LABELS = Object.freeze({
  speak: "说话",
  observe: "观察",
  gesture: "动作",
  move: "移动",
  interact: "交互",
  use_affordance: "使用物件",
  take_out: "取出物件",
  act: "行动",
  leave: "离开",
  rest: "休息",
  practice: "练习",
  pass: "停留",
  none: "停留",
});
const NO_ACTION_PULSE_TYPES = new Set(["move", "maintenance", "pass", "none"]);

function clean(value = "") {
  return String(value ?? "").trim();
}

function hasTavernActionMotion(actionType = "") {
  const normalized = clean(actionType);
  return Boolean(normalized && !NO_ACTION_PULSE_TYPES.has(normalized));
}

function escapeHtml(value = "") {
  return clean(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function characterIdFor(row = {}) {
  return clean(row.characterId || row.id);
}

function realizationFor(turn = {}) {
  const publicRealization = turn.publicRealization && typeof turn.publicRealization === "object"
    ? turn.publicRealization
    : {};
  return {
    actionType: clean(turn.actionType || publicRealization.actionType),
    targetCharacterId: clean(turn.targetCharacterId || publicRealization.targetCharacterId),
    speech: clean(turn.speech || publicRealization.speech),
    visibleAction: clean(turn.visibleAction || publicRealization.visibleAction),
  };
}

function publicOutcomeFor(turn = {}) {
  return turn.outcome && typeof turn.outcome === "object" ? turn.outcome : {};
}

function publicEffectsForTurn(turn = {}) {
  const outcome = publicOutcomeFor(turn);
  return [
    ...(Array.isArray(outcome.resolvedEffects) ? outcome.resolvedEffects : []),
    ...(Array.isArray(outcome.committedFacts) ? outcome.committedFacts : []),
  ];
}

function movementForTurn(turn = {}) {
  const outcome = publicOutcomeFor(turn);
  if (clean(outcome.status) === "failed") return null;
  const actorId = characterIdFor(turn);
  const effects = publicEffectsForTurn(turn);
  const movement = effects.find((effect) => clean(effect?.kind) === "actor_movement"
    && (!actorId || !clean(effect?.actorId) || clean(effect.actorId) === actorId));
  if (!movement) return null;
  const fromZoneId = clean(movement.fromZoneId);
  const toZoneId = clean(movement.toZoneId);
  if (!INK_TAVERN_ZONE_LAYOUT[fromZoneId] || !INK_TAVERN_ZONE_LAYOUT[toZoneId]) return null;
  return {
    actorId: clean(movement.actorId || actorId),
    fromZoneId,
    toZoneId,
    durationSeconds: Math.max(0, Number(movement.durationSeconds || outcome.durationSeconds) || 0),
  };
}

function occupiedPositionForTurn(turn = {}) {
  const outcome = publicOutcomeFor(turn);
  if (clean(outcome.status) === "failed") return null;
  const actorId = characterIdFor(turn);
  const occupied = publicEffectsForTurn(turn).find((effect) => clean(effect?.kind) === "position_occupied"
    && (!actorId || !clean(effect?.actorId) || clean(effect.actorId) === actorId));
  const positionId = clean(occupied?.positionId);
  if (!positionId || !TAVERN_NAVIGATION_MAP.positionHotspots[positionId]) return null;
  return {
    actorId: clean(occupied.actorId || actorId),
    positionId,
    durationSeconds: Math.max(0, Number(occupied.durationSeconds || outcome.durationSeconds) || 0),
  };
}

function isMaintenanceTurn(turn = {}) {
  return MAINTENANCE_TURN_KINDS.has(classifyV27TurnKind(turn));
}

function latestTurnByCharacter(turns = []) {
  const latest = new Map();
  for (const turn of Array.isArray(turns) ? turns : []) {
    const characterId = characterIdFor(turn);
    if (characterId) latest.set(characterId, turn);
  }
  return latest;
}

function shortStableHash(value = "") {
  const hash = [...String(value ?? "")].reduce((total, character) => (
    (total * 33 + (character.codePointAt(0) || 0)) >>> 0
  ), 5381);
  return hash.toString(36);
}

export function tavernPresentationKeyForTurn(turn = {}) {
  const explicit = clean(
    turn.agentTurnId
      || turn.turnId
      || turn.actionId
      || turn.outcome?.worldEventId
      || turn.outcome?.eventId
      || turn.eventId,
  );
  if (explicit) return explicit;
  const realization = realizationFor(turn);
  const publicSignature = JSON.stringify({
    characterId: characterIdFor(turn),
    turnKind: clean(turn.turnKind),
    actionType: realization.actionType,
    speech: realization.speech,
    visibleAction: realization.visibleAction,
    outcomeStatus: clean(turn.outcome?.status),
    durationSeconds: Math.max(0, Number(turn.outcome?.durationSeconds) || 0),
    effects: publicEffectsForTurn(turn).map((effect) => ({
      kind: clean(effect?.kind),
      actorId: clean(effect?.actorId),
      fromZoneId: clean(effect?.fromZoneId),
      toZoneId: clean(effect?.toZoneId),
      positionId: clean(effect?.positionId),
    })),
  });
  return `public-turn:${shortStableHash(publicSignature)}`;
}

function latestMotionByCharacter(turns = []) {
  const latest = new Map();
  (Array.isArray(turns) ? turns : []).forEach((turn, index) => {
    const movement = movementForTurn(turn);
    const occupiedPosition = occupiedPositionForTurn(turn);
    const characterId = characterIdFor(turn);
    if (!characterId || (!movement && !occupiedPosition)) return;
    latest.set(characterId, {
      turn,
      index,
      movement,
      occupiedPosition,
      presentationKey: tavernPresentationKeyForTurn(turn),
    });
  });
  return latest;
}

function safeZoneId(value = "") {
  const zoneId = clean(value);
  return INK_TAVERN_ZONE_LAYOUT[zoneId] ? zoneId : DEFAULT_ZONE_ID;
}

const persistentPoseSlots = new Map();

function poseBucketFor(actor = {}) {
  const positionId = clean(actor.positionId);
  return positionId ? `position:${positionId}` : `zone:${safeZoneId(actor.zoneId)}`;
}

function poseCapacityFor(actor = {}) {
  const positionId = clean(actor.positionId);
  if (positionId) return Math.max(1, TAVERN_NAVIGATION_MAP.positionHotspots[positionId]?.length || 1);
  return Math.max(1, TAVERN_NAVIGATION_MAP.zoneAnchors[safeZoneId(actor.zoneId)]?.length || 1);
}

function preferredPoseSlot(characterId = "", capacity = 1) {
  return Number.parseInt(shortStableHash(characterId), 36) % Math.max(1, capacity);
}

function assignStablePoseSlots(actorRows = []) {
  const rows = (Array.isArray(actorRows) ? actorRows : []).map((actor) => ({ ...actor }));
  const groups = new Map();
  rows.filter((actor) => actor.present !== false).forEach((actor) => {
    const bucket = poseBucketFor(actor);
    const group = groups.get(bucket) || [];
    group.push(actor);
    groups.set(bucket, group);
  });

  for (const [bucket, actors] of groups) {
    const capacity = poseCapacityFor(actors[0]);
    const used = new Set();
    const unassigned = [];
    actors.sort((left, right) => clean(left.characterId).localeCompare(clean(right.characterId)));
    for (const actor of actors) {
      const remembered = persistentPoseSlots.get(clean(actor.characterId));
      if (remembered?.bucket === bucket && remembered.slot < capacity && !used.has(remembered.slot)) {
        actor.positionOffset = remembered.slot;
        used.add(remembered.slot);
      } else {
        unassigned.push(actor);
      }
    }
    for (const actor of unassigned) {
      const preferred = preferredPoseSlot(actor.characterId, capacity);
      let slot = preferred;
      for (let offset = 0; offset < capacity && used.has(slot); offset += 1) {
        slot = (preferred + offset + 1) % capacity;
      }
      if (used.has(slot)) slot = actors.indexOf(actor);
      actor.positionOffset = slot;
      used.add(slot);
      persistentPoseSlots.set(clean(actor.characterId), { bucket, slot });
    }
  }
  return rows;
}

export function classifyInkTavernTime(nowSeconds = 0) {
  const secondsPerDay = 24 * 60 * 60;
  const numeric = Number(nowSeconds);
  const wrapped = ((Number.isFinite(numeric) ? numeric : 0) % secondsPerDay + secondsPerDay) % secondsPerDay;
  const hour = wrapped / 3600;
  if (hour >= 21 || hour < 5) return "night";
  if (hour < 10) return "dawn";
  if (hour < 14) return "noon";
  if (hour < 18) return "afternoon";
  return "dusk";
}

export function formatInkTavernTime(nowSeconds = 0) {
  const numeric = Math.max(0, Number(nowSeconds) || 0);
  const day = Math.floor(numeric / 86400) + 1;
  const seconds = numeric % 86400;
  const hour = Math.floor(seconds / 3600);
  const minute = Math.floor((seconds % 3600) / 60);
  return `第 ${day} 日 · ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function buildInkTavernActorStates(observation = {}) {
  const characters = Array.isArray(observation.characters) ? observation.characters : [];
  const turns = Array.isArray(observation.turns) ? observation.turns : [];
  const latestByCharacter = latestTurnByCharacter(turns);
  const latestMotion = latestMotionByCharacter(turns);
  const readyQueue = new Set((observation.readyQueue || []).map((value) => clean(value)).filter(Boolean));

  return assignStablePoseSlots(characters.map((character) => {
    const characterId = characterIdFor(character);
    const zoneId = safeZoneId(character.zoneId);
    const turn = latestByCharacter.get(characterId) || null;
    const maintenance = turn ? isMaintenanceTurn(turn) : false;
    const realization = turn ? realizationFor(turn) : {};
    const motionRecord = latestMotion.get(characterId) || null;
    const movement = motionRecord?.movement || null;
    const occupiedPosition = motionRecord?.occupiedPosition || null;
    const movementCommitted = Boolean(movement && movement.toZoneId === zoneId);
    const positionId = clean(character.positionId || occupiedPosition?.positionId);
    const positionCommitted = Boolean(occupiedPosition && occupiedPosition.positionId === positionId);
    const motionCommitted = movementCommitted || positionCommitted;
    return {
      characterId,
      name: clean(character.name || characterId || "人物"),
      present: character.present !== false,
      placeId: clean(character.placeId),
      zoneId,
      positionId,
      previousZoneId: movementCommitted ? movement.fromZoneId : zoneId,
      movementCommitted,
      positionCommitted,
      motionCommitted,
      motionPresentationKey: clean(motionRecord?.presentationKey),
      motionIsLatestTurn: Boolean(motionRecord && motionRecord.turn === turn),
      durationSeconds: Math.max(0, Number(movement?.durationSeconds || occupiedPosition?.durationSeconds) || 0),
      speech: maintenance ? "" : clean(realization.speech),
      actionType: maintenance ? "maintenance" : clean(realization.actionType),
      visibleAction: maintenance ? "" : clean(realization.visibleAction),
      targetCharacterId: maintenance ? "" : clean(realization.targetCharacterId),
      outcomeStatus: clean(turn?.outcome?.status || "quiet"),
      isReady: readyQueue.has(characterId),
      isMaintenance: maintenance,
      positionOffset: 0,
      orientationTargetId: clean(character.orientationTargetId),
      listeningTargetId: clean(character.listeningTargetId),
      assetPath: INK_TAVERN_ASSETS.characters[characterId] || "",
    };
  }).filter((actor) => actor.characterId));
}

function cloneActorState(actor = {}) {
  return { ...actor };
}

function frameActorStates(characterRows = [], positions = new Map(), activeTurn = null) {
  const activeId = characterIdFor(activeTurn || {});
  const activeTurnKey = activeTurn ? tavernPresentationKeyForTurn(activeTurn) : "";
  const maintenance = activeTurn ? isMaintenanceTurn(activeTurn) : false;
  const realization = activeTurn ? realizationFor(activeTurn) : {};
  const movement = activeTurn ? movementForTurn(activeTurn) : null;
  const occupiedPosition = activeTurn ? occupiedPositionForTurn(activeTurn) : null;
  const actors = characterRows.map((character) => {
    const characterId = characterIdFor(character);
    const recorded = positions.get(characterId) || {};
    const zoneId = safeZoneId(recorded.zoneId || character.zoneId);
    const positionId = clean(Object.hasOwn(recorded, "positionId") ? recorded.positionId : character.positionId);
    const isCurrent = activeId === characterId;
    const movementCommitted = isCurrent && Boolean(movement);
    const positionCommitted = isCurrent && Boolean(occupiedPosition);
    return {
      characterId,
      name: clean(character.name || characterId || "人物"),
      present: character.present !== false,
      zoneId,
      positionId,
      previousZoneId: movementCommitted ? movement.fromZoneId : zoneId,
      movementCommitted,
      positionCommitted,
      motionCommitted: movementCommitted || positionCommitted,
      motionPresentationKey: isCurrent ? activeTurnKey : "",
      motionIsLatestTurn: isCurrent,
      durationSeconds: Math.max(0, Number(movement?.durationSeconds || occupiedPosition?.durationSeconds) || 0),
      speech: isCurrent && !maintenance ? realization.speech : "",
      actionType: isCurrent
        ? (maintenance ? "maintenance" : realization.actionType)
        : "",
      visibleAction: isCurrent && !maintenance ? realization.visibleAction : "",
      targetCharacterId: isCurrent && !maintenance ? realization.targetCharacterId : "",
      outcomeStatus: isCurrent ? clean(activeTurn?.outcome?.status || "quiet") : "",
      isReady: false,
      isMaintenance: isCurrent && maintenance,
      isCurrent,
      presentationKey: isCurrent ? activeTurnKey : "",
      positionOffset: 0,
      assetPath: INK_TAVERN_ASSETS.characters[characterId] || "",
    };
  }).filter((actor) => actor.characterId);
  return assignStablePoseSlots(actors);
}

export function buildInkTavernPlaybackFrames(observation = {}) {
  const characterRows = Array.isArray(observation.characters) ? observation.characters : [];
  const turns = Array.isArray(observation.turns) ? observation.turns : [];
  const positions = new Map(characterRows.map((row) => [characterIdFor(row), {
    zoneId: safeZoneId(row.zoneId),
    positionId: clean(row.positionId),
  }]));

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const movement = movementForTurn(turns[index]);
    const occupiedPosition = occupiedPositionForTurn(turns[index]);
    if (movement?.actorId) positions.set(movement.actorId, { zoneId: movement.fromZoneId, positionId: "" });
    else if (occupiedPosition?.actorId) {
      const current = positions.get(occupiedPosition.actorId) || { zoneId: DEFAULT_ZONE_ID, positionId: "" };
      positions.set(occupiedPosition.actorId, { ...current, positionId: "" });
    }
  }

  const frames = [{
    index: 0,
    turnKey: "",
    actors: frameActorStates(characterRows, positions),
    currentCharacterId: "",
    speech: "",
    visibleAction: "",
    outcomeStatus: "quiet",
  }];

  turns.forEach((turn, turnIndex) => {
    const movement = movementForTurn(turn);
    const occupiedPosition = occupiedPositionForTurn(turn);
    if (movement?.actorId) positions.set(movement.actorId, { zoneId: movement.toZoneId, positionId: "" });
    if (occupiedPosition?.actorId) {
      const current = positions.get(occupiedPosition.actorId) || { zoneId: DEFAULT_ZONE_ID, positionId: "" };
      positions.set(occupiedPosition.actorId, { ...current, positionId: occupiedPosition.positionId });
    }
    const realization = realizationFor(turn);
    const maintenance = isMaintenanceTurn(turn);
    frames.push({
      index: turnIndex + 1,
      turnKey: tavernPresentationKeyForTurn(turn),
      actors: frameActorStates(characterRows, positions, turn),
      currentCharacterId: characterIdFor(turn),
      speech: maintenance ? "" : realization.speech,
      visibleAction: maintenance ? "" : realization.visibleAction,
      outcomeStatus: clean(turn?.outcome?.status || "quiet"),
      maintenance,
    });
  });

  if (!turns.length) {
    frames[0].actors = buildInkTavernActorStates(observation).map(cloneActorState);
  } else {
    const authoritativePositions = new Map(characterRows.map((row) => [characterIdFor(row), {
      zoneId: safeZoneId(row.zoneId),
      positionId: clean(row.positionId),
    }]));
    const lastFrame = frames.at(-1);
    lastFrame.actors = assignStablePoseSlots(lastFrame.actors.map((actor) => {
      const authoritative = authoritativePositions.get(actor.characterId) || {};
      const authoritativeZoneId = safeZoneId(authoritative.zoneId || actor.zoneId);
      const motionMismatch = actor.motionCommitted === true && authoritativeZoneId !== actor.zoneId;
      return {
        ...actor,
        zoneId: authoritativeZoneId,
        positionId: clean(Object.hasOwn(authoritative, "positionId") ? authoritative.positionId : actor.positionId),
        ...(motionMismatch ? {
          previousZoneId: authoritativeZoneId,
          movementCommitted: false,
          positionCommitted: false,
          motionCommitted: false,
        } : {}),
      };
    }));
  }
  return frames;
}

function actorPlacement(actor = {}) {
  const zoneId = safeZoneId(actor.zoneId);
  const previousZoneId = actor.movementCommitted === true
    ? safeZoneId(actor.previousZoneId)
    : zoneId;
  const slot = Math.max(0, Number(actor.positionOffset) || 0);
  const anchor = tavernAnchorFor({
    zoneId,
    positionId: clean(actor.positionId),
    actorId: actor.characterId,
    slot,
  });
  const route = actor.motionCommitted === true
    ? planTavernRoute({
      fromZoneId: previousZoneId,
      toZoneId: zoneId,
      positionId: clean(actor.positionId),
      actorId: actor.characterId,
      slot,
    })
    : [anchor];
  const endpoint = route.at(-1) || anchor;
  const routeLength = tavernRouteLength(route);
  const worldDurationWeight = Math.min(420, Math.max(0, Number(actor.durationSeconds) || 0) * 6);
  const routeDurationMs = Math.round(Math.max(620, Math.min(2400, routeLength * 34 + worldDurationWeight)));
  return {
    zoneId,
    previousZoneId,
    positionId: clean(actor.positionId),
    nodeId: endpoint.nodeId || anchor.nodeId,
    x: Number(endpoint.x),
    y: Number(endpoint.y),
    route,
    routeDurationMs,
  };
}

function stageMarkup({
  actors = [],
  clockLabel = "尚未起时",
  timeOfDay = "night",
  latestLine = "",
  caption = DEFAULT_IDLE_CAPTION,
  outcomeStatus = "quiet",
  worldVersion = 0,
  activityRunning = false,
} = {}) {
  const zoneMarkup = Object.entries(INK_TAVERN_ZONE_LAYOUT).map(([zoneId, zone]) => `
    <span class="ink-tavern-zone" data-zone="${escapeHtml(zoneId)}" style="--zone-x:${zone.x}%;--zone-y:${zone.y}%">${escapeHtml(zone.label)}</span>`).join("");
  const actorRows = (Array.isArray(actors) ? actors : [])
    .map((actor) => actorMarkup(actor, { activityRunning }))
    .join("");
  const safeStatus = clean(outcomeStatus) || "quiet";
  const safeWorldVersion = Math.max(0, Number(worldVersion) || 0);
  return `
    <header class="ink-tavern-stage-head">
      <div>
        <p>人物正在这里生活</p>
        <h3 id="ink-tavern-stage-title">望梯客栈</h3>
      </div>
      <div class="ink-tavern-stage-clock" data-stage-clock>${escapeHtml(clockLabel)}</div>
    </header>
    <div class="ink-tavern-scene" data-stage-scene data-projection="${TAVERN_NAVIGATION_MAP.projection}" data-navigation="walkable-graph" data-time-of-day="${escapeHtml(timeOfDay)}" data-world-version="${safeWorldVersion}">
      <img class="ink-tavern-backdrop" src="${INK_TAVERN_ASSETS.background}" alt="" draggable="false" />
      <div class="ink-tavern-paper-grain" aria-hidden="true"></div>
      <div class="ink-tavern-zones" aria-hidden="true">${zoneMarkup}</div>
      <div class="ink-tavern-actors" data-stage-actors>${actorRows}</div>
      <div class="ink-tavern-latest-line" data-stage-line aria-live="polite"${latestLine ? "" : " hidden"}>${escapeHtml(latestLine)}</div>
    </div>
    <footer class="ink-tavern-stage-caption" data-stage-caption data-outcome="${escapeHtml(safeStatus)}" aria-live="polite">${escapeHtml(caption)}</footer>`;
}

function facingForRoute(route = []) {
  const points = Array.isArray(route) ? route : [];
  for (let index = points.length - 1; index > 0; index -= 1) {
    const horizontal = Number(points[index].x) - Number(points[index - 1].x);
    const vertical = Number(points[index].y) - Number(points[index - 1].y);
    if (Math.abs(horizontal) < 0.01 && Math.abs(vertical) < 0.01) continue;
    if (Math.abs(horizontal) >= Math.abs(vertical)) return horizontal < 0 ? "west" : "east";
    return vertical < 0 ? "north" : "south";
  }
  return "south";
}

function actorMarkup(actor = {}, { activityRunning = false } = {}) {
  const placement = actorPlacement(actor);
  const isActing = hasTavernActionMotion(actor.actionType);
  const isPatrolling = activityRunning === true
    && actor.present !== false
    && !clean(actor.positionId)
    && actor.isMaintenance !== true;
  const patrolRoute = isPatrolling
    ? buildTavernPatrolRoute({
      zoneId: placement.zoneId,
      actorId: actor.characterId,
      startNodeId: placement.nodeId,
    })
    : [];
  const patrolDurationMs = Math.round(Math.max(3600, Math.min(9200, tavernRouteLength(patrolRoute) * 125)));
  const classNames = [
    "ink-tavern-actor",
    actor.isCurrent === true ? "is-current" : "",
    actor.speech ? "is-speaking" : "",
    actor.motionCommitted === true ? "is-moving" : "",
    isActing ? "is-acting" : "",
    isPatrolling && patrolRoute.length > 1 ? "is-patrolling" : "",
    actor.isReady === true ? "is-ready" : "",
    actor.isMaintenance === true ? "is-maintaining" : "",
  ].filter(Boolean).join(" ");
  const actorName = clean(actor.name || actor.characterId || "人物");
  const speech = clean(actor.speech);
  const asset = actor.assetPath
    ? `<img class="ink-tavern-sprite" src="${escapeHtml(actor.assetPath)}" alt="" draggable="false" />`
    : `<span class="ink-tavern-fallback-mark">${escapeHtml([...actorName][0] || "人")}</span>`;
  const zoneLabel = INK_TAVERN_ZONE_LAYOUT[placement.zoneId]?.label || placement.zoneId;
  const ariaLabel = [actorName, `位于${zoneLabel}`, speech ? `说：${speech}` : ""].filter(Boolean).join("，");
  const actionLabel = clean(actor.visibleAction)
    || (ACTION_TYPE_LABELS[actor.actionType] ? `${ACTION_TYPE_LABELS[actor.actionType]}` : "正在观察四周");
  const authoritativeRoute = serializeTavernRoute(placement.route);
  const serializedPatrol = serializeTavernRoute(patrolRoute);
  const facing = facingForRoute(actor.motionCommitted === true ? placement.route : patrolRoute);
  const actorStyle = [
    `--actor-x:${placement.x}%`,
    `--actor-y:${placement.y}%`,
    `--actor-depth:${Math.round(placement.y * 10)}`,
  ].join(";");
  const movementSource = actor.motionCommitted === true ? ' data-movement-source="observation"' : "";
  const presentationKey = clean(actor.presentationKey);
  const movementKey = actor.motionCommitted === true
    ? clean(actor.motionPresentationKey || presentationKey)
    : "";
  const localMotion = isPatrolling && patrolRoute.length > 1 ? "patrol" : "anchored";
  return `
    <div class="${classNames}" data-stage-actor data-character="${escapeHtml(actor.characterId)}" data-zone="${escapeHtml(placement.zoneId)}" data-position="${escapeHtml(placement.positionId)}" data-previous-zone="${escapeHtml(placement.previousZoneId)}" data-outcome="${escapeHtml(actor.outcomeStatus || "quiet")}" data-sprite-kind="npc" data-local-motion="${localMotion}" data-facing="${facing}" data-route="${escapeHtml(authoritativeRoute)}" data-idle-route="${escapeHtml(serializedPatrol)}" data-route-duration="${placement.routeDurationMs}" data-patrol-duration="${patrolDurationMs}" data-presentation-key="${escapeHtml(presentationKey)}" data-movement-key="${escapeHtml(movementKey)}"${movementSource} style="${actorStyle}" aria-label="${escapeHtml(ariaLabel)}"${actor.present === false ? " hidden" : ""}>
      <div class="ink-tavern-local-motion">
        <button type="button" class="ink-tavern-figure" data-action="inspect-tavern-actor" aria-expanded="false" aria-label="查看${escapeHtml(actorName)}的公开状态">
          <span class="ink-tavern-action-motion">
            <span class="ink-tavern-gait-motion">${asset}</span>
          </span>
          <span class="ink-tavern-actor-name">${escapeHtml(actorName)}</span>
          <span class="ink-tavern-speech" data-actor-speech${speech ? "" : " hidden"}>${speech ? `“${escapeHtml(speech)}”` : ""}</span>
          <span class="ink-tavern-actor-inspector" data-actor-inspector hidden><strong>${escapeHtml(actorName)}</strong><span>${escapeHtml(zoneLabel)} · ${escapeHtml(actionLabel)}</span></span>
        </button>
      </div>
    </div>`;
}

function outcomeCaption(frame = {}) {
  const active = frame.actors?.find((actor) => actor.characterId === frame.currentCharacterId);
  if (!active) return "人物停留在世界已结算的位置。";
  if (active.isMaintenance) return `${active.name}正在安静整理自己的安排，没有新增公开世界事实。`;
  if (active.outcomeStatus === "failed") return `${active.name}的尝试没有改变所在位置。`;
  if (active.visibleAction) return active.visibleAction;
  if (active.speech) return `${active.name}开口说话。`;
  return `${active.name}保持观察，世界没有新增可见变化。`;
}

function outcomeStatusLabel(turn = null) {
  const outcome = publicOutcomeFor(turn || {});
  return clean(outcome.label) || OUTCOME_STATUS_LABELS[clean(outcome.status)] || "暂无公开变化";
}

function latestActionCaption(frame = {}) {
  const active = frame.actors?.find((actor) => actor.characterId === frame.currentCharacterId);
  if (!active) return outcomeCaption(frame);
  if (active.isMaintenance) return outcomeCaption(frame);
  if (active.visibleAction) return active.visibleAction;
  if (active.speech) return `${active.name}开口说话。`;
  const actionLabel = ACTION_TYPE_LABELS[active.actionType] || clean(active.actionType);
  return actionLabel ? `${active.name}：${actionLabel}。` : outcomeCaption(frame);
}

function sanitizeInitialCharacters(initialCharacters = []) {
  return (Array.isArray(initialCharacters) ? initialCharacters : [])
    .map((character) => {
      if (!character || typeof character !== "object" || Array.isArray(character)) return null;
      const characterId = characterIdFor(character);
      if (!characterId) return null;
      return {
        characterId,
        name: clean(character.name || characterId),
        present: character.present !== false,
        placeId: clean(character.placeId),
        zoneId: safeZoneId(character.zoneId),
        positionId: clean(character.positionId),
        orientationTargetId: clean(character.orientationTargetId),
        listeningTargetId: clean(character.listeningTargetId),
      };
    })
    .filter(Boolean);
}

/**
 * Render the final public world projection without requiring a DOM controller.
 * The returned string is the inside of an `.ink-tavern-stage` container.
 */
export function renderInkTavernStageMarkup(observation = null, options = {}) {
  const normalizedOptions = Array.isArray(options) ? { initialCharacters: options } : (options || {});
  const hasObservation = Boolean(observation && typeof observation === "object" && !Array.isArray(observation));
  const publicObservation = hasObservation
    ? observation
    : {
      nowSeconds: 0,
      worldVersion: 0,
      readyQueue: [],
      characters: sanitizeInitialCharacters(normalizedOptions.initialCharacters),
      turns: [],
    };
  const turns = Array.isArray(publicObservation.turns) ? publicObservation.turns : [];
  const latestTurn = turns.at(-1) || null;
  const currentCharacterId = latestTurn ? characterIdFor(latestTurn) : "";
  const presentationKey = latestTurn ? tavernPresentationKeyForTurn(latestTurn) : "";
  const actors = buildInkTavernActorStates(publicObservation).map((actor) => {
    const isCurrent = Boolean(currentCharacterId && actor.characterId === currentCharacterId);
    return {
      ...actor,
      isCurrent,
      presentationKey: isCurrent ? presentationKey : "",
      speech: isCurrent ? actor.speech : "",
      actionType: isCurrent ? actor.actionType : "",
      visibleAction: isCurrent ? actor.visibleAction : "",
      targetCharacterId: isCurrent ? actor.targetCharacterId : "",
      isMaintenance: isCurrent && actor.isMaintenance === true,
    };
  });
  const frame = {
    actors,
    currentCharacterId,
    outcomeStatus: clean(latestTurn?.outcome?.status || "quiet"),
  };
  const activeActor = actors.find((actor) => actor.characterId === currentCharacterId) || null;
  const outcomeStatus = clean(latestTurn?.outcome?.status || "quiet");
  const actionCaption = latestTurn ? latestActionCaption(frame) : "";
  const caption = hasObservation
    ? `${outcomeStatusLabel(latestTurn)} · ${actionCaption || "人物停留在世界已结算的位置。"}`
    : clean(normalizedOptions.idleCaption) || DEFAULT_IDLE_CAPTION;
  return stageMarkup({
    actors,
    clockLabel: hasObservation ? formatInkTavernTime(publicObservation.nowSeconds) : "尚未起时",
    timeOfDay: hasObservation ? classifyInkTavernTime(publicObservation.nowSeconds) : "night",
    latestLine: activeActor?.speech ? `${activeActor.name}：“${activeActor.speech}”` : "",
    caption,
    outcomeStatus,
    worldVersion: publicObservation.worldVersion,
    activityRunning: normalizedOptions.activityRunning === true,
  });
}

function syncElementAttributes(current, next) {
  const nextNames = new Set(next.getAttributeNames());
  for (const name of current.getAttributeNames()) {
    if (!nextNames.has(name)) current.removeAttribute(name);
  }
  for (const name of nextNames) {
    const value = next.getAttribute(name);
    if (current.getAttribute(name) !== value) current.setAttribute(name, value);
  }
}

function syncTextElement(currentRoot, nextRoot, selector) {
  const current = currentRoot.querySelector(selector);
  const next = nextRoot.querySelector(selector);
  if (!current || !next) return;
  syncElementAttributes(current, next);
  if (current.textContent !== next.textContent) current.textContent = next.textContent;
}

const actorAnimations = new WeakMap();

function reducedMotionRequested() {
  return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

function routeKeyframes(route = []) {
  const points = Array.isArray(route) ? route : [];
  const total = tavernRouteLength(points);
  let travelled = 0;
  return points.map((point, index) => {
    if (index > 0) travelled += Math.hypot(
      Number(point.x) - Number(points[index - 1].x),
      Number(point.y) - Number(points[index - 1].y),
    );
    return {
      transform: `translate3d(${Number(point.x)}%, ${Number(point.y)}%, 0)`,
      offset: total > 0 ? travelled / total : index / Math.max(1, points.length - 1),
    };
  });
}

function currentActorPose(node) {
  if (!node?.isConnected || typeof globalThis.getComputedStyle !== "function") return null;
  const scene = node.closest?.("[data-stage-scene]") || node.parentElement;
  const bounds = scene?.getBoundingClientRect?.();
  if (!bounds?.width || !bounds?.height) return null;
  const transform = globalThis.getComputedStyle(node).transform;
  const matrix3d = clean(transform).match(/^matrix3d\(([^)]+)\)$/u)?.[1]
    ?.split(",").map(Number);
  const matrix2d = clean(transform).match(/^matrix\(([^)]+)\)$/u)?.[1]
    ?.split(",").map(Number);
  const translateX = matrix3d?.length === 16 ? matrix3d[12] : matrix2d?.length === 6 ? matrix2d[4] : NaN;
  const translateY = matrix3d?.length === 16 ? matrix3d[13] : matrix2d?.length === 6 ? matrix2d[5] : NaN;
  if (!Number.isFinite(translateX) || !Number.isFinite(translateY)) return null;
  const point = { x: translateX / bounds.width * 100, y: translateY / bounds.height * 100 };
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

function connectRouteFromPose(route = [], pose = null) {
  const points = Array.isArray(route) ? route : [];
  if (!pose || points.length < 1) return points;
  const candidates = points
    .map((point, index) => ({
      point,
      index,
      distance: Math.hypot(Number(point.x) - Number(pose.x), Number(point.y) - Number(pose.y)),
    }))
    .filter(({ point }) => !doesTavernSegmentCrossObstacle(pose, point))
    .sort((left, right) => left.distance - right.distance || left.index - right.index);
  const join = candidates[0];
  if (!join) return points;
  if (join.distance < 0.08) return points.slice(join.index);
  return [{ x: Number(pose.x), y: Number(pose.y) }, ...points.slice(join.index)];
}

function startActorAnimation(node, route, {
  key,
  durationMs,
  mode,
  iterations = 1,
} = {}) {
  const points = Array.isArray(route) ? route : [];
  const previous = actorAnimations.get(node);
  previous?.animation?.cancel?.();
  if (points.length < 2 || reducedMotionRequested() || typeof node.animate !== "function") {
    actorAnimations.set(node, {
      animation: null,
      key,
      mode: "settled",
      lastMovementKey: mode === "movement" ? clean(key).replace(/^movement:/u, "") : clean(previous?.lastMovementKey),
    });
    node.classList.remove("is-walking");
    return null;
  }
  const animation = node.animate(routeKeyframes(points), {
    duration: Math.max(180, Number(durationMs) || 900),
    easing: "linear",
    fill: "none",
    iterations,
  });
  const state = {
    animation,
    key,
    mode,
    lastMovementKey: mode === "movement" ? clean(key).replace(/^movement:/u, "") : clean(previous?.lastMovementKey),
  };
  actorAnimations.set(node, state);
  node.classList.add("is-walking");
  if (iterations === 1) {
    animation.finished.then(() => {
      if (actorAnimations.get(node) !== state) return;
      actorAnimations.set(node, { ...state, animation: null, mode: "settled" });
      node.classList.remove("is-walking");
      if (node.dataset.localMotion === "patrol") syncActorMotion(node, { forcePatrol: true });
    }).catch(() => {});
  }
  return animation;
}

function syncActorMotion(node, { forceMovement = false, forcePatrol = false, fromPose = null } = {}) {
  let current = actorAnimations.get(node);
  if (current?.animation?.playState === "running") node.classList.add("is-walking");
  const movementKey = clean(node.dataset.movementKey);
  const route = parseTavernRoute(node.dataset.route);
  if (movementKey && forceMovement && current?.lastMovementKey !== movementKey) {
    startActorAnimation(node, connectRouteFromPose(route, fromPose), {
      key: `movement:${movementKey}`,
      durationMs: Number(node.dataset.routeDuration),
      mode: "movement",
    });
    return;
  }
  if (movementKey && !current) {
    current = {
      animation: null,
      key: `settled:${movementKey}`,
      mode: "settled",
      lastMovementKey: movementKey,
    };
    actorAnimations.set(node, current);
  }
  if (node.dataset.localMotion === "patrol") {
    const patrolRoute = parseTavernRoute(node.dataset.idleRoute);
    const patrolKey = `patrol:${clean(node.dataset.character)}:${clean(node.dataset.zone)}:${clean(node.dataset.idleRoute)}`;
    if (current?.key === patrolKey && !forcePatrol) {
      current.animation?.play?.();
      node.classList.add("is-walking");
      return;
    }
    if (current?.mode === "movement" && current.animation?.playState === "running" && !forcePatrol) return;
    startActorAnimation(node, patrolRoute, {
      key: patrolKey,
      durationMs: Number(node.dataset.patrolDuration),
      mode: "patrol",
      iterations: Infinity,
    });
    return;
  }
  if (current?.mode === "patrol") {
    current.animation?.pause?.();
    node.classList.remove("is-walking");
  }
}

function syncActorElement(current, next) {
  const inspectorButton = current.querySelector('[data-action="inspect-tavern-actor"]');
  const inspectorWasOpen = inspectorButton?.getAttribute("aria-expanded") === "true";
  const previousMovementKey = clean(current.dataset.movementKey);
  const previousPresentationKey = clean(current.dataset.presentationKey);
  const nextMovementKey = clean(next.dataset.movementKey);
  const nextPresentationKey = clean(next.dataset.presentationKey);
  const replayMovement = Boolean(nextMovementKey && previousMovementKey !== nextMovementKey);
  const previousPose = replayMovement ? currentActorPose(current) : null;
  const replayAction = Boolean(
    previousPresentationKey
    && nextPresentationKey
    && previousPresentationKey !== nextPresentationKey
    && current.classList.contains("is-acting")
    && next.classList.contains("is-acting"),
  );

  syncElementAttributes(current, next);
  syncTextElement(current, next, ".ink-tavern-actor-name");
  syncTextElement(current, next, "[data-actor-speech]");
  const currentInspector = current.querySelector("[data-actor-inspector]");
  const nextInspector = next.querySelector("[data-actor-inspector]");
  if (currentInspector && nextInspector) {
    syncElementAttributes(currentInspector, nextInspector);
    if (currentInspector.innerHTML !== nextInspector.innerHTML) currentInspector.innerHTML = nextInspector.innerHTML;
  }
  if (inspectorWasOpen) {
    inspectorButton.setAttribute("aria-expanded", "true");
    if (currentInspector) currentInspector.hidden = false;
  }

  const currentGait = current.querySelector(".ink-tavern-gait-motion");
  const nextGait = next.querySelector(".ink-tavern-gait-motion");
  if (currentGait && nextGait && currentGait.innerHTML !== nextGait.innerHTML) {
    currentGait.innerHTML = nextGait.innerHTML;
  }

  if (replayAction) {
    if (replayAction) current.classList.remove("is-acting");
    void current.offsetWidth;
    if (replayAction) current.classList.add("is-acting");
  }
  syncActorMotion(current, { forceMovement: replayMovement, fromPose: previousPose });
}

/**
 * Reconcile a newly rendered stage into the existing stage without replacing
 * actor nodes. This keeps in-zone wandering continuous and prevents an already
 * presented world movement from replaying on unrelated UI updates.
 */
export function reconcileInkTavernStageDom(currentRoot, nextRoot) {
  if (!currentRoot || !nextRoot) return currentRoot || nextRoot || null;

  syncElementAttributes(currentRoot, nextRoot);
  syncTextElement(currentRoot, nextRoot, "[data-stage-clock]");
  syncTextElement(currentRoot, nextRoot, "[data-stage-line]");
  syncTextElement(currentRoot, nextRoot, "[data-stage-caption]");

  const currentScene = currentRoot.querySelector("[data-stage-scene]");
  const nextScene = nextRoot.querySelector("[data-stage-scene]");
  if (currentScene && nextScene) syncElementAttributes(currentScene, nextScene);

  const currentActors = currentRoot.querySelector("[data-stage-actors]");
  const nextActors = nextRoot.querySelector("[data-stage-actors]");
  if (!currentActors || !nextActors) return currentRoot;

  const existing = new Map(
    [...currentActors.querySelectorAll("[data-stage-actor][data-character]")]
      .map((node) => [clean(node.dataset.character), node]),
  );
  const activeIds = new Set();
  [...nextActors.querySelectorAll("[data-stage-actor][data-character]")].forEach((nextActor, index) => {
    const characterId = clean(nextActor.dataset.character);
    if (!characterId) return;
    activeIds.add(characterId);
    const actor = existing.get(characterId) || nextActor.cloneNode(true);
    if (existing.has(characterId)) syncActorElement(actor, nextActor);
    else syncActorMotion(actor);
    const currentAtIndex = currentActors.children[index] || null;
    if (currentAtIndex !== actor) currentActors.insertBefore(actor, currentAtIndex);
  });
  for (const [characterId, actor] of existing) {
    if (!activeIds.has(characterId)) actor.remove();
  }
  return currentRoot;
}

function applyActorPlacement(node, actor = {}) {
  const previousZoneId = clean(node.dataset.zone);
  const previousPose = previousZoneId ? currentActorPose(node) : null;
  const placement = actorPlacement(actor);
  node.style.setProperty("--actor-x", `${placement.x}%`);
  node.style.setProperty("--actor-y", `${placement.y}%`);
  node.style.setProperty("--actor-depth", String(Math.round(placement.y * 10)));
  node.dataset.zone = placement.zoneId;
  node.dataset.position = placement.positionId;
  node.dataset.previousZone = placement.previousZoneId;
  node.dataset.outcome = actor.outcomeStatus || "quiet";
  node.dataset.spriteKind = "npc";
  node.dataset.route = serializeTavernRoute(placement.route);
  node.dataset.routeDuration = String(placement.routeDurationMs);
  const presentationKey = clean(actor.presentationKey);
  node.dataset.presentationKey = presentationKey;
  node.dataset.movementKey = actor.motionCommitted === true ? presentationKey : "";
  node.dataset.facing = facingForRoute(placement.route);
  if (actor.motionCommitted === true) node.dataset.movementSource = "observation";
  else delete node.dataset.movementSource;
  node.classList.toggle("is-current", actor.isCurrent === true);
  node.classList.toggle("is-speaking", Boolean(actor.speech));
  node.classList.toggle("is-moving", actor.motionCommitted === true);
  node.classList.toggle("is-acting", hasTavernActionMotion(actor.actionType));
  node.classList.toggle("is-ready", actor.isReady === true);
  node.classList.toggle("is-maintaining", actor.isMaintenance === true);
  node.hidden = actor.present === false;
  const speechNode = node.querySelector("[data-actor-speech]");
  if (speechNode) {
    speechNode.textContent = actor.speech ? `“${actor.speech}”` : "";
    speechNode.hidden = !actor.speech;
  }
  const zoneLabel = INK_TAVERN_ZONE_LAYOUT[actor.zoneId]?.label || actor.zoneId;
  const actionLabel = clean(actor.visibleAction)
    || (ACTION_TYPE_LABELS[actor.actionType] ? ACTION_TYPE_LABELS[actor.actionType] : "正在观察四周");
  const inspector = node.querySelector("[data-actor-inspector]");
  if (inspector) {
    const nameNode = inspector.querySelector("strong");
    const detailNode = inspector.querySelector("span");
    if (nameNode) nameNode.textContent = clean(actor.name || actor.characterId || "人物");
    if (detailNode) detailNode.textContent = `${zoneLabel} · ${actionLabel}`;
  }
  node.setAttribute("aria-label", [actor.name, `位于${zoneLabel}`, actor.speech ? `说：${actor.speech}` : ""].filter(Boolean).join("，"));
  syncActorMotion(node, { forceMovement: actor.motionCommitted === true, fromPose: previousPose });
}

export function createInkTavernStageController(root, { frameDurationMs = 900 } = {}) {
  if (!root) throw new Error("Ink tavern stage requires a root element.");
  root.innerHTML = stageMarkup();
  root.dataset.stageState = "idle";
  const sceneNode = root.querySelector("[data-stage-scene]");
  const actorsNode = root.querySelector("[data-stage-actors]");
  const clockNode = root.querySelector("[data-stage-clock]");
  const lineNode = root.querySelector("[data-stage-line]");
  const captionNode = root.querySelector("[data-stage-caption]");
  const actorNodes = new Map();
  let playbackToken = 0;
  let lastPresentedTurnKey = "";

  function ensureActorNode(actor) {
    let node = actorNodes.get(actor.characterId);
    if (node) return node;
    actorsNode.insertAdjacentHTML("beforeend", actorMarkup(actor));
    node = actorsNode.lastElementChild;
    actorNodes.set(actor.characterId, node);
    return node;
  }

  function renderFrame(frame, observation) {
    const activeIds = new Set();
    for (const actor of frame.actors || []) {
      activeIds.add(actor.characterId);
      applyActorPlacement(ensureActorNode(actor), {
        ...actor,
        presentationKey: clean(actor.presentationKey),
      });
    }
    for (const [characterId, node] of actorNodes) {
      if (!activeIds.has(characterId)) node.hidden = true;
    }
    const active = frame.actors?.find((actor) => actor.characterId === frame.currentCharacterId);
    lineNode.textContent = active?.speech ? `${active.name}：“${active.speech}”` : "";
    lineNode.hidden = !active?.speech;
    captionNode.textContent = outcomeCaption(frame);
    root.dataset.worldVersion = String(observation.worldVersion || 0);
    root.dataset.currentTurn = String(frame.index || 0);
    root.dataset.currentTurnKey = clean(frame.turnKey);
  }

  async function show(observation = {}, { replay = true } = {}) {
    const token = ++playbackToken;
    const frames = buildInkTavernPlaybackFrames(observation);
    const turns = Array.isArray(observation.turns) ? observation.turns : [];
    root.dataset.totalTurns = String(turns.length);
    const turnKeys = turns.map((turn) => tavernPresentationKeyForTurn(turn));
    const previousTurnIndex = lastPresentedTurnKey ? turnKeys.lastIndexOf(lastPresentedTurnKey) : -1;
    const startIndex = replay
      ? lastPresentedTurnKey
        ? previousTurnIndex >= 0 ? previousTurnIndex + 2 : Math.max(0, frames.length - 1)
        : 0
      : Math.max(0, frames.length - 1);
    const playbackFrames = replay ? frames.slice(startIndex) : [frames.at(-1)];
    const usableFrames = playbackFrames.length ? playbackFrames : [frames.at(-1)];
    sceneNode.dataset.timeOfDay = classifyInkTavernTime(observation.nowSeconds);
    clockNode.textContent = formatInkTavernTime(observation.nowSeconds);
    root.dataset.stageState = usableFrames.length > 1 ? "running" : "settled";

    for (let index = 0; index < usableFrames.length; index += 1) {
      if (token !== playbackToken) return;
      renderFrame(usableFrames[index], observation);
      if (index < usableFrames.length - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, frameDurationMs));
      }
    }
    if (token !== playbackToken) return;
    root.dataset.stageState = "settled";
    lastPresentedTurnKey = turnKeys.at(-1) || lastPresentedTurnKey;
  }

  function seek(observation = {}, frameIndex = 0) {
    playbackToken += 1;
    const frames = buildInkTavernPlaybackFrames(observation);
    const totalTurns = Math.max(0, frames.length - 1);
    const requestedIndex = Number.isFinite(Number(frameIndex)) ? Math.trunc(Number(frameIndex)) : 0;
    const clampedIndex = Math.max(0, Math.min(totalTurns, requestedIndex));
    sceneNode.dataset.timeOfDay = classifyInkTavernTime(observation.nowSeconds);
    clockNode.textContent = formatInkTavernTime(observation.nowSeconds);
    root.dataset.totalTurns = String(totalTurns);
    renderFrame(frames[clampedIndex], observation);
    root.dataset.stageState = "settled";
  }

  function setStatus(state, message = "") {
    playbackToken += 1;
    root.dataset.stageState = clean(state || "idle");
    if (message) captionNode.textContent = clean(message);
  }

  return {
    show,
    seek,
    setStatus,
    snapshot() {
      return {
        stageState: root.dataset.stageState,
        worldVersion: Number(root.dataset.worldVersion || 0),
        currentTurn: Number(root.dataset.currentTurn || 0),
        currentTurnKey: clean(root.dataset.currentTurnKey),
        totalTurns: Number(root.dataset.totalTurns || 0),
      };
    },
  };
}
