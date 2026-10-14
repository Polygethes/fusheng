function actorIdentity(entity = {}) {
  return String(entity?.actorId || entity?.characterId || entity?.id || "").trim();
}

function observationSourceIdentity(observation = {}) {
  return String(
    observation?.sourceActorId
      || observation?.sourceEntityId
      || observation?.sourceCharacterId
      || "",
  ).trim();
}

function physicalSceneIdentity(sceneId = "", locationId = "") {
  const declaredSceneId = String(sceneId || "").trim();
  const declaredLocationId = String(locationId || "").trim();
  return {
    id: declaredSceneId || declaredLocationId,
    consistent: !(declaredSceneId && declaredLocationId && declaredSceneId !== declaredLocationId),
  };
}

function recentSoundFrom(observations = [], sourceEntityId = "", nowSeconds = 0, maxAgeSeconds = 120) {
  if (!sourceEntityId) return false;
  return (observations || []).some((observation) => {
    if (observationSourceIdentity(observation) !== sourceEntityId || observation?.modality !== "sound") return false;
    const observedAt = Number(observation.deliveredAtSeconds ?? observation.createdAtSeconds ?? nowSeconds);
    return Math.max(0, Number(nowSeconds || 0) - observedAt) <= Math.max(0, Number(maxAgeSeconds || 0));
  });
}

export function perceiveEntity({
  observer = {},
  subject = {},
  routeFor = () => null,
  observations = [],
  nowSeconds = 0,
  visualRange = 2,
  soundMemorySeconds = 120,
} = {}) {
  const observerId = actorIdentity(observer);
  const subjectId = actorIdentity(subject);
  if (!observer?.present || !subject?.present || (observerId && subjectId && observerId === subjectId)) return null;
  const visualRoute = routeFor(observer.zoneId, subject.zoneId, "visual");
  const canSee = Boolean(visualRoute && Number(visualRoute.distance) <= Number(visualRange));
  const actualSound = recentSoundFrom(observations, subjectId, nowSeconds, soundMemorySeconds);
  const soundRoute = actualSound ? routeFor(subject.zoneId, observer.zoneId, "sound") : null;
  const canHear = Boolean(actualSound && soundRoute);
  if (!canSee && !canHear) return null;
  return {
    canSee,
    canHear,
    visualRoute,
    soundRoute,
    mode: canSee ? (canHear ? "visible-and-audible" : "visible") : "audible-only",
  };
}

export function conversationalSpeechAllowed({
  sourceSceneId = "",
  targetSceneId = "",
  sourceLocationId = "",
  targetLocationId = "",
  sourceZoneId = "",
  targetZoneId = "",
  vocalMode = "conversational",
  routeFor = () => null,
  callOutRange = 3,
} = {}) {
  const sourceScene = physicalSceneIdentity(sourceSceneId, sourceLocationId);
  const targetScene = physicalSceneIdentity(targetSceneId, targetLocationId);
  if (!sourceScene.consistent || !targetScene.consistent) return false;
  // A caller scoped to a single scene may omit both identities for backwards
  // compatibility. Once either side declares a scene, both sides must declare
  // the same one; identical local zone names never bridge two scenes.
  if (sourceScene.id || targetScene.id) {
    if (!sourceScene.id || !targetScene.id || sourceScene.id !== targetScene.id) return false;
  }
  if (!sourceZoneId || !targetZoneId) return false;
  if (sourceZoneId === targetZoneId) return true;
  const route = routeFor(sourceZoneId, targetZoneId, "sound");
  if (vocalMode !== "call_out") return Boolean(route?.conversational === true);
  return Boolean(route && Number(route.distance) <= Math.max(1, Number(callOutRange || 3)));
}
