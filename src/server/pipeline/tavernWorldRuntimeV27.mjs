import { restoreProgressRecords } from "../simulation/simulationIntegrity.mjs";
import { createEnvironment } from "../simulation/worldEnvironment.mjs";
import { listDeliveryCapabilityAffordances, settleDeliveryCapabilityAffordance } from "../simulation/deliveryCapability.mjs";
import { characterTimePolicy } from "../simulation/characterTimePolicy.mjs";
import { projectWorldTemporalContext } from "../simulation/worldTemporalAgenda.mjs";
import XIAOYAOYOU_WORLD_PACK from "../../worlds/xiaoyaoyou/pack.mjs";
import { worldPackDigest } from "../../worlds/worldPack.mjs";
import { instantiateWorldAgenda } from "../../worlds/worldAgenda.mjs";
import { getTavernEcologyProfile } from "../ecology/tavernEcologyProfile.mjs";
import { createInitialEcologyState } from "../ecology/tavernEcologyState.mjs";
import { deriveCharacterSocialContext } from "../simulation/characterSocialContext.mjs";
import { createLocalCharacterRuntimePort } from "../simulation/characterRuntimePort.mjs";
import {
  createCharacterSessionActor,
  restoreCharacterSessionActor,
} from "../simulation/characterSessionActor.mjs";
import { createCharacterWorldRuntime } from "../simulation/characterWorldRuntime.mjs";
import { characterExecutionAuditRecord } from "../simulation/characterTurnExecution.mjs";
import { runCharacterDayPlanningTurn } from "../simulation/characterDayPlanningTurn.mjs";
import { projectAdjacentMovementOptions } from "../simulation/placeMovementBoundary.mjs";
import { createWorldActionRegistry, perceivableRoute } from "../simulation/worldActionRegistry.mjs";
import { objectVisibleToObserver, objectCustodyForOwner } from "../simulation/objectLedger.mjs";
import { observeObjectPhysicalState, describeObjectPhysicalState } from "../simulation/objectPhysicalObservation.mjs";
import { PHYSICAL_ACTION_RULE } from "../simulation/physicalActionContract.mjs";
import { createWorldCommitCoordinator } from "../simulation/worldCommitCoordinator.mjs";
import {
  considerCharacterDayPlanStep,
  projectCharacterLifeContinuityForOwner,
} from "../simulation/characterLifeContinuity.mjs";
import { advanceCharacterPhysiologyTo } from "../simulation/characterPhysiologyContinuity.mjs";
import { nameFormsByCharacter, learnNamesFromTurns } from "./learnedNames.mjs";
import { weatherExposure, vulnerabilityOf, bodyLines } from "../simulation/weatherOnBody.mjs";
import { perceivedConditions } from "../simulation/perceivableConditions.mjs";
import { ownershipNote, missingHere } from "../simulation/property.mjs";
import { waterHere } from "../simulation/sustenance.mjs";
import { movementHindrance } from "../simulation/movementHindrance.mjs";
import { observableCondition } from "../simulation/characterHealth.mjs";
import { woundedPhysiology, runBodyBeat } from "./characterBodyBeat.mjs";
import { spousesFromRelationships, kinFromRelationships, livingSpouse, proposalStands, rememberMarriage } from "../simulation/marriage.mjs";
import { standingOffers } from "../simulation/exchange.mjs";
import { sexOf, pregnancyAtStart, bearingCouple, conceptionFor, pregnancyFelt, pregnancyLook } from "../simulation/lifeCycle.mjs";
import { openingSleep, startClockMinutes, timeOfDayText, sleepinessAt, sleepinessLine, isAsleep } from "../simulation/sleep.mjs";
import { updateTemper, temperLines } from "../simulation/temper.mjs";
import { growBonds, noteBonds } from "../simulation/bonds.mjs";
import { runCharacterReflectionTurn } from "../simulation/characterReflectionTurn.mjs";
import { settleCharacterReflectionOpportunity } from "../simulation/characterReflection.mjs";
import {
  advanceCharacterConversationContinuity,
  projectOwnedConversationAnchors,
  resolveOwnedConversationAnchor,
} from "../simulation/characterConversationContinuity.mjs";
import { createWorldCapabilityRegistry } from "../simulation/worldCapabilityRegistry.mjs";
import {
  projectPerceivedActionFeasibilities,
  projectPerceivedReferences,
} from "../simulation/actionFeasibility.mjs";
import { buildCharacterPerceptionFrame } from "../simulation/characterPerception.mjs";
import {
  listServiceCapabilityAffordances,
  settleServiceCapabilityAffordance,
} from "../simulation/serviceCapability.mjs";
import {
  buildWorkCapabilityStateFromTemplates,
  listWorkCapabilityAffordances,
  settleWorkCapabilityAffordance,
} from "../simulation/workCapability.mjs";
import {
  reduceCharacterPrivateTurn,
  reduceCharacterPerformanceTurn,
  reduceCharacterPrivateWorldOutcome,
} from "../simulation/characterPrivateStateReducer.mjs";
import { TAVERN_RELATIONSHIP_METRICS } from "../ecology/tavernRelationshipDynamics.mjs";
import {
  bridgeTavernCharacterAgentV2ResultForWorld,
  runTavernCharacterAgentTurnV2,
  runTavernCharacterAgentV2Stage,
  tavernCharacterAgentV2OutputSchemaForStage,
} from "./tavernCharacterAgentV2.mjs";
import { buildTavernVoiceContract } from "./tavernCharacterVoice.mjs";
import {
  PERFORMANCE_PHASE,
  PERFORMANCE_PROTOCOL_VERSION,
  buildPerformanceStage,
  lowerPerformanceOutput,
  performanceContinuations,
  performanceIntention,
  silentPayload,
  validatePerformanceOutput,
  applyInnerChanges,
  emptyInnerLedger,
} from "./characterPerformanceTurn.mjs";
import {
  ownPlanStepDecision,
  markPlanStep, closeEndedPlanSteps,
  walkContinuation,
  OWN_PLAN_STEP_TURN_KIND,
  OWN_PLAN_STEP_VERSION,
} from "./characterOwnPlanStep.mjs";
import {
  SCHEDULE_PHASE,
  SCHEDULE_PROTOCOL_VERSION,
  buildScheduleStage,
  validateScheduleOutput,
  lowerScheduleOutput,
  parseClock,
} from "./characterScheduleTurn.mjs";
import {
  buildCharacterEpistemicBeliefState,
  retrieveCharacterAgentMemory,
} from "../../engine/characterAgentMemory.js";

export const TAVERN_WORLD_RUNTIME_V27_VERSION = "tavern-world-runtime-v2.7-testable-vertical";
export const TAVERN_V27_DEFAULT_CHARACTER_IDS = Object.freeze([
  "char_xyy_xiezenshi",
  "char_xyy_luozhao",
]);

const LOCATION_ID = XIAOYAOYOU_WORLD_PACK.stage.placeId;
const packDigests = new WeakMap();
function digestOf(pack) {
  if (!packDigests.has(pack)) packDigests.set(pack, worldPackDigest(pack));
  return packDigests.get(pack);
}
const OBJECT_ACTIONS = new Set([
  "interact", "use_affordance", "pickup", "take_out", "show", "hide", "store",
  "draw", "sheathe", "transfer", "place", "consume",
]);

const TAVERN_CAPABILITY_REGISTRY = createWorldCapabilityRegistry()
  .register("delivery", { listAffordances: listDeliveryCapabilityAffordances, settleAttempt: settleDeliveryCapabilityAffordance })
  .register("service", {
    listAffordances: listServiceCapabilityAffordances,
    settleAttempt: settleServiceCapabilityAffordance,
  })
  .register("work", {
    listAffordances: listWorkCapabilityAffordances,
    settleAttempt: settleWorkCapabilityAffordance,
  });

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").trim();
}

const CHARACTER_FORBIDDEN_CONVERSATION_LINEAGE_KEYS = new Set([
  "conversationThreadHandle", "lineageBinding", "parentTurnId", "responseToTurnId",
  "sourceActionId", "sourceThreadId", "threadId", "worldThreadId",
]);

function projectWithoutRawConversationLineage(value) {
  if (Array.isArray(value)) return value.map(projectWithoutRawConversationLineage);
  if (!value || typeof value !== "object") return clone(value);
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => (
    CHARACTER_FORBIDDEN_CONVERSATION_LINEAGE_KEYS.has(key)
      ? []
      : [[key, projectWithoutRawConversationLineage(child)]]
  )));
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function opaqueHash(value = "") {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function perceivedEntityHandle(ownerId = "", entityId = "") {
  return `perceived_entity:${opaqueHash(`${clean(ownerId)}|${clean(entityId)}`)}`;
}

function perceivedObjectHandle(ownerId = "", objectId = "") {
  return `perceived_object:${opaqueHash(`${clean(ownerId)}|${clean(objectId)}`)}`;
}

function perceivedAffordanceHandle(ownerId = "", affordanceId = "") {
  return `perceived_affordance:${opaqueHash(`${clean(ownerId)}|${clean(affordanceId)}`)}`;
}

function perceivedProcessHandle(ownerId = "", processId = "") {
  return `owned_process:${opaqueHash(`${clean(ownerId)}|${clean(processId)}`)}`;
}

function knownEntityHandle(ownerId = "", entityId = "") {
  return `known_entity:${opaqueHash(`${clean(ownerId)}|${clean(entityId)}`)}`;
}

function fail(code, message, evidence = {}) {
  const error = new Error(message);
  error.code = code;
  error.evidence = clone(evidence);
  return error;
}

function characterById(state = {}, characterId = "") {
  return (state.characters || []).find((row) => clean(row?.id) === clean(characterId)) || null;
}

function publicRole(character = {}) {
  return clean(character.lifeProfile?.role || character.externalSituation || character.publicIdentity?.role || "在场者");
}

function publicStanding(character = {}) {
  const profile = getTavernEcologyProfile(character);
  return clean(profile?.standing || character.lifeProfile?.tavernAgency?.standing || "visitor");
}

function relationshipContextFor(state = {}, ownerId = "") {
  return (state.relationships || []).filter((row) => clean(row.fromCharacterId) === clean(ownerId)).map((row) => ({
    ...clone(row),
    authority: "character-owned-relationship-memory",
  }));
}

function privateStateForCharacter(state = {}, character = {}, zoneId = "hall", placeId = LOCATION_ID) {
  const ecologyProfile = getTavernEcologyProfile(character, { defaultZoneId: zoneId });
  if (!ecologyProfile) throw fail("TAVERN_V27_ECOLOGY_PROFILE_MISSING", "Character has no ecology profile.", { characterId: character.id });
  const ecologyState = character.ecologyState?.characterId === character.id
    ? clone(character.ecologyState)
    : createInitialEcologyState(ecologyProfile, {
      locationId: placeId,
      zoneId,
      observableAtStage: true,
    });
  ecologyState.presence = {
    ...(ecologyState.presence || {}),
    locationId: placeId,
    zoneId,
    observableAtStage: true,
  };
  const sourceActivity = character.lifeState?.currentActivity || {};
  const currentActivity = {
    authority: "character-owned-current-activity",
    activityId: clean(sourceActivity.id || `activity:${character.id}:current`),
    ownerCharacterId: character.id,
    type: clean(sourceActivity.type || "routine"),
    description: clean(
      sourceActivity.description
      || character.lifeProfile?.activities?.routine
      || "继续手边正在做的事",
    ),
    status: clean(sourceActivity.status || "active"),
    progress: Math.max(0, Number(sourceActivity.progress || 0)),
  };
  return {
    ownerCharacterId: character.id,
    characterName: character.name,
    role: publicRole(character),
    standing: publicStanding(character),
    responsibilityRoleIds: unique(
      ecologyProfile.validatedAnchorRuntime?.presenceProjection?.responsibilityRoleIds || [],
    ),
    currentIntention: clean(
      ecologyState.currentIntention?.label
      || character.lifeState?.activeGoal
      || character.lifeProfile?.privatePursuit
      || "继续眼下的生活",
    ),
    currentActivities: [currentActivity],
    ecologyProfile: clone(ecologyProfile),
    ecologyState,
    physiologyState: {
      schemaVersion: "character-physiology-clock-v1",
      lastWorldSyncSeconds: 0,
    },
    psychologyAnchor: clone(character.psychologyAnchor || ecologyProfile.psychologyAnchor || null),
    memoryContext: clone(character.agentMemory || {}),
    relationshipContext: relationshipContextFor(state, character.id),
    ownCommitments: clone(character.lifeProfile?.commitments || []),
    recentOwnActions: [],
    settledInteractionEvents: [],
    lastOutcome: null,
  };
}

function buildCurrentResponsibilitySurface({ privateState = {}, projection = {} } = {}) {
  const acceptedRoleIds = unique(privateState.responsibilityRoleIds || []);
  const activeDutyContracts = (privateState.ecologyProfile?.duties || []).map((row) => ({
    dutyId: clean(row?.id || row?.dutyId),
    description: clean(row?.responsibility || row?.description || row?.label),
    scope: clone(row?.scope || null),
    completion: clone(row?.completionCondition || row?.completion || null),
    authority: clean(row?.runtimeProjection?.source || "character-foundation-or-scene-role-contract"),
  })).filter((row) => row.dutyId || row.description);
  const serviceByRecipient = new Map();
  for (const affordance of projection.availableAffordances || []) {
    if (clean(affordance?.kind) !== "service_operation") continue;
    const recipientEntityHandle = clean(affordance.recipientEntityHandle);
    if (!recipientEntityHandle) continue;
    const prior = serviceByRecipient.get(recipientEntityHandle) || {
      cueId: `responsibility-cue:service:${recipientEntityHandle}`,
      kind: "role-relevant-service-opportunity",
      recipientEntityHandle,
      supportingAffordanceIds: [],
      observableBasis: "本人在当前地点具有可用于眼前在场者的服务能力",
      requiredResponse: false,
    };
    prior.supportingAffordanceIds.push(clean(affordance.id));
    serviceByRecipient.set(recipientEntityHandle, prior);
  }
  const workCues = (acceptedRoleIds.length || activeDutyContracts.length
    ? projection.availableAffordances || []
    : []).filter((row) => clean(row?.kind) === "work_operation").map((row) => ({
    cueId: `responsibility-cue:work:${clean(row.id)}`,
    kind: "available-duty-work",
    supportingAffordanceIds: [clean(row.id)],
    workTemplateId: clean(row.workTemplateId),
    remainingUnits: Number(row.remainingUnits || 0),
    requiredResponse: false,
  }));
  return {
    authority: "character-private-role-and-duty-grounding",
    acceptedRoleIds,
    activeDutyContracts,
    objectiveOpportunityCues: [...serviceByRecipient.values(), ...workCues],
    selection: { authority: "character-agent", selectedCandidateId: null },
    rule: "A role, duty, perceived person, service opportunity, or available job can create private pressure, but none forces greeting, service, speech, or interruption; the Character Agent may respond, continue, defer, delegate, ignore, or leave.",
  };
}

function mergeSharedActivityUnderstandings(privateRows = [], projectedRows = []) {
  const byId = new Map();
  for (const row of [...(privateRows || []), ...(projectedRows || [])]) {
    const activityId = clean(row?.activityId);
    if (!activityId) continue;
    byId.set(activityId, clone(row));
  }
  return [...byId.values()];
}

function publicCharacterEntity(character = {}, zoneId = "hall", placeId = LOCATION_ID) {
  const tavernAuthority = character.lifeProfile?.tavernAgency?.authority
    || character.lifeState?.tavernAgency?.authority
    || {};
  return {
    id: character.id,
    kind: "character",
    name: character.name,
    present: true,
    placeId,
    zoneId,
    ...(Array.isArray(character.skills) && character.skills.length ? { skills: [...character.skills] } : {}),
    role: publicRole(character),
    standing: publicStanding(character),
    publicSignalFeatures: clone(character.lifeState?.publicSignalFeatures || character.publicSignalFeatures || []),
    // Author identity summaries may contain reputation, frailty or purpose.
    // They are not optical facts and must never become an observation result.
    // Keep identity stable and location authoritative in `zoneId`. A cached
    // sentence such as "X is in the hall" becomes false as soon as X moves.
    publicDescription: clean(character.name),
    serviceAuthority: {
      serveTea: tavernAuthority.serveTea === true,
      serveMeal: tavernAuthority.serveMeal === true,
      settleCash: tavernAuthority.settleCash === true,
    },
  };
}

function worldObjectsFromTavern(state = {}, placeId = LOCATION_ID, defaultZoneId = "hall") {
  const templates = state.tavernState?.institution?.objectTemplates || [];
  return Object.fromEntries(templates.filter((row) => clean(row?.id)).map((row) => [row.id, {
    ...clone(row),
    id: row.id,
    kind: "object",
    placeId,
    zoneId: clean(row.zoneId || defaultZoneId),
    holderCharacterId: clean(row.initialHolderActorId),
    presentation: clone(row.presentation || {
      exposure: "visible",
      displayedToActorIds: [],
      publiclyVisible: true,
    }),
  }]));
}

/**
 * Guest positions become neutral, occupiable world things — not merely an
 * institutional description. A character can perceive them, bind an action to
 * them, and the world can settle actually taking or releasing one.
 */
function worldPositionsFromTavern(state = {}, placeId = LOCATION_ID, defaultZoneId = "hall") {
  const positions = state.tavernState?.institution?.guestPositions || [];
  return Object.fromEntries(positions.filter((row) => clean(row?.id)).map((row) => [row.id, {
    id: row.id,
    kind: "position",
    label: clean(row.label || row.id),
    placeId,
    zoneId: clean(row.zoneId || defaultZoneId),
    portable: false,
    capacity: Math.max(1, Number(row.capacity || 1)),
    occupantCharacterIds: [],
    observableFeatures: clone(row.observableFeatures || []),
    presentation: { exposure: "visible", displayedToActorIds: [], publiclyVisible: true },
  }]));
}

export function buildTavernWorldStateV27(state = {}, {
  worldPack = XIAOYAOYOU_WORLD_PACK,
  characterIds = worldPack.stage.dayCast || TAVERN_V27_DEFAULT_CHARACTER_IDS,
  positions = {},
  worldId = worldPack.stage.defaultWorldId || `world:${worldPack.meta.id}:v27`,
  pacingMode = "day",
  openingAfterSeconds = 900,
} = {}) {
  const placeId = worldPack.stage.placeId;
  const defaultZoneId = clean(worldPack.stage.topology?.defaultZoneId || "hall");
  const entities = {};
  for (const characterId of unique(characterIds)) {
    const character = characterById(state, characterId);
    if (!character) throw fail("TAVERN_V27_CHARACTER_UNKNOWN", "Tavern v2.7 character is missing.", { characterId });
    entities[characterId] = publicCharacterEntity(character, clean(positions[characterId] || defaultZoneId), placeId);
  }
  // A town's people carry who they know and how old they look (a child, the old, a grown body).
  if (worldPack.stage.sites) {
    // The couples and kin a town starts with, read from how its people are bound.
    const spouses = spousesFromRelationships(worldPack.relationships || []);
    const kin = kinFromRelationships(worldPack.relationships || []);
    for (const characterId of Object.keys(entities)) {
      const character = characterById(state, characterId);
      const known = character.lifeProfile?.knownActorIds ?? character.lifeState?.knownActorIds ?? [];
      const age = character.age;
      const isChild = character.appearance?.child === true || (Number.isFinite(age) && age < 14);
      const isOld = Number.isFinite(age) && age >= 60;
      const castRow = (worldPack.cast || []).find((row) => row.id === characterId) || {};
      entities[characterId].knownActorIds = [...known];
      entities[characterId].ageGroup = isChild ? "child" : isOld ? "old" : "adult";
      entities[characterId].spouseId = spouses[characterId] || "";
      entities[characterId].kinIds = kin[characterId] || [];
      entities[characterId].sex = sexOf(castRow);
      entities[characterId].age = Number(castRow.age) || 0;
      entities[characterId].sleep = openingSleep({ worldPackMeta: { startClock: worldPack.clock?.startClock } });
      if (castRow.pregnancyWeeks) {
        entities[characterId].pregnancy = pregnancyAtStart(castRow.pregnancyWeeks, spouses[characterId] || "");
      }
    }
    // Each couple who could have a child draws the day once.
    for (const [id, spouseId] of Object.entries(spouses)) {
      const couple = bearingCouple({ entities }, id, spouseId);
      if (couple && couple.motherId === id && !entities[id].pregnancy) entities[id].conception = conceptionFor(couple.motherId, couple.fatherId, 0);
    }
  }
  const objects = {
    ...worldObjectsFromTavern(state, placeId, defaultZoneId),
    ...worldPositionsFromTavern(state, placeId, defaultZoneId),
  };
  for (const object of Object.values(objects)) {
    const holder = entities[clean(object.holderCharacterId)];
    if (holder) object.zoneId = holder.zoneId;
  }
  return {
    schemaVersion: TAVERN_WORLD_RUNTIME_V27_VERSION,
    worldId,
    worldVersion: 0,
    nowSeconds: 0,
    timePolicy: { ...characterTimePolicy(pacingMode), ...(pacingMode === "scene" ? clone(worldPack.clock?.sceneTimePolicy || {}) : {}) },
    temporalAgenda: pacingMode === "scene"
      ? instantiateWorldAgenda(worldPack.agenda.items || [], characterIds, { openingAfterSeconds, placeId })
      : [],
    entities,
    objects,
    signals: [],
    processes: [],
    sharedActivities: [],
    socialFacts: clone(worldPack.social.facts || []),
    places: {
      [placeId]: {
        id: placeId,
        name: worldPack.stage.name,
        topology: clone(worldPack.stage.topology),
        socialBoundaries: clone(worldPack.social.boundaries || []),
        accessGrants: [],
        institution: clone(state.tavernState?.institution || {}),
        perceptionEnvironment: clone(state.tavernState?.perceptionEnvironment || {}),
        ...(worldPack.stage.sites ? {
          sites: clone(worldPack.stage.sites),
          startClock: clean(worldPack.clock?.startClock),
          environment: createEnvironment({
            weather: clean(state.tavernState?.perceptionEnvironment?.weather) || "clear",
            nowSeconds: 0,
            levels: worldPack.stage.environment?.levels || {},
          }),
        } : {}),
        serviceCapability: {
          stock: clone(state.tavernState?.stock || {}),
          stations: clone(state.tavernState?.servicePreparationEnvironment?.stations || {}),
        },
        workCapability: buildWorkCapabilityStateFromTemplates(
          state.tavernState?.institution?.workOrderTemplates || [],
        ),
      },
    },
    worldPackMeta: {
      id: worldPack.meta.id,
      digest: digestOf(worldPack),
      ...(worldPack.stage.sceneId ? { sceneId: worldPack.stage.sceneId, clockLabel: worldPack.clock?.startLabel || "" } : {}),
      ...(worldPack.stage.sites && worldPack.clock?.startClock ? { startClock: worldPack.clock.startClock } : {}),
      relationshipMetrics: clone(worldPack.relationshipMetrics || []),
      report: clone(worldPack.report || {}),
    },
  };
}

function visibleCharacterEntities(worldState = {}, owner = {}) {
  const place = worldState.places?.[owner.placeId] || {};
  return Object.values(worldState.entities || {}).filter((row) => (
    row.kind === "character"
    && row.present !== false
    && row.id !== owner.id
    && row.placeId === owner.placeId
    && perceivableRoute(place, owner.zoneId, row.zoneId, "visual") != null
  ));
}

function safeCharacterSignalFeatures(row = {}) {
  return (row.publicSignalFeatures || []).flatMap((feature, index) => {
    if (!feature || typeof feature !== "object" || Array.isArray(feature)) return [];
    const physicalFeature = clean(feature.physicalFeature);
    const modality = clean(feature.modality || "visual");
    if (!physicalFeature || !["visual", "sound", "smell", "touch", "vibration"].includes(modality)) return [];
    const forbidden = ["canonicalLabel", "hiddenIntent", "recognizedIdentity", "relationshipMeaning", "skillLevel", "worldConclusion"];
    if (forbidden.some((key) => Object.hasOwn(feature, key))) return [];
    return [{
      signalId: `surface:${clean(row.id)}:${clean(feature.featureId || index + 1)}`,
      modality,
      featureId: clean(feature.featureId || `surface-${index + 1}`),
      physicalFeature,
      domainTags: unique(feature.domainTags || []),
      intensity: Math.max(0, Math.min(1, Number(feature.intensity ?? 0.65))),
    }];
  });
}

function perceivedCharacters(worldState = {}, owner = {}, visibleEntities = visibleCharacterEntities(worldState, owner)) {
  const topology = worldState.places?.[owner.placeId]?.topology || {};
  return visibleEntities.map((row) => {
    const lookFeature = (row.publicSignalFeatures || []).find((feature) => feature.featureId === "look");
    const fallbackDesc = `${clean(topology.zones?.[row.zoneId]?.label || row.zoneId)}有一人`;
    const observableDescription = clean(lookFeature?.physicalFeature) || fallbackDesc;
    return {
      id: perceivedEntityHandle(owner.id, row.id),
      entityHandle: perceivedEntityHandle(owner.id, row.id),
      name: "",
      identityKnown: false,
      zoneId: row.zoneId,
      zoneLabel: clean(topology.zones?.[row.zoneId]?.label || row.zoneId),
      observableDescription,
      observableCondition: [observableCondition(row.health), pregnancyLook(row, Number(worldState.nowSeconds || 0)), isAsleep(row) ? "睡着了" : ""].filter(Boolean).join("，"),
      publicSignalFeatures: safeCharacterSignalFeatures(row),
      ...(proposalStands(worldState, row.id, owner.id) ? { proposedToYou: true } : {}),
      ...(() => {
        const offer = standingOffers(worldState, owner.id).find((entry) => entry.fromId === row.id);
        return offer ? { offerToYou: { give: clean(worldState.objects?.[offer.giveObjectId]?.label), want: clean(worldState.objects?.[offer.wantObjectId]?.label) } } : {};
      })(),
    };
  });
}

function anonymousObjectLabel(object = {}) {
  return clean(
    object.perception?.publicLabel
    || object.aliases?.at?.(-1)
    || (object.kind === "position" ? object.label : "一件可见物件"),
  );
}

function perceivedObjects(worldState = {}, owner = {}, visibleCharacterIds = [], entityHandleByCharacterId = new Map()) {
  const place = worldState.places?.[owner.placeId] || {};
  const visiblePeople = new Set([owner.id, ...visibleCharacterIds]);
  return Object.values(worldState.objects || {}).flatMap((object) => {
    if (object.placeId !== owner.placeId) return [];
    const selfOwned = clean(object.holderCharacterId) === owner.id;
    const heldByVisiblePerson = object.holderCharacterId && visiblePeople.has(object.holderCharacterId);
    const exposed = objectVisibleToObserver(object, owner.id, { defaultVisible: true });
    const stationaryVisible = !object.holderCharacterId
      && perceivableRoute(place, owner.zoneId, object.zoneId, "visual") != null
      && exposed;
    if (!selfOwned && !(heldByVisiblePerson && exposed) && !stationaryVisible) return [];
    const otherHeld = Boolean(object.holderCharacterId) && !selfOwned;
    const ownCustody = selfOwned ? objectCustodyForOwner(object) : null;
    const projectedObjectId = otherHeld ? perceivedObjectHandle(owner.id, object.id) : object.id;
    const observableState = observeObjectPhysicalState(object, owner);
    return [{
      id: projectedObjectId,
      objectHandle: projectedObjectId,
      kind: clean(object.kind || "object"),
      label: otherHeld ? anonymousObjectLabel(object) : clean(object.perception?.publicLabel || object.label || object.id),
      zoneId: object.zoneId,
      holderEntityHandle: selfOwned
        ? owner.id
        : clean(entityHandleByCharacterId.get(clean(object.holderCharacterId))),
      portable: object.portable !== false,
      observableState,
      observableStateDescription: describeObjectPhysicalState(observableState),
      presentation: {
        ...clone(object.presentation || {}),
        displayedToActorIds: (object.presentation?.displayedToActorIds || []).map(characterId => (
          characterId === owner.id ? owner.id : clean(entityHandleByCharacterId.get(characterId))
        )).filter(Boolean),
      },
      // Who occupies a seat is publicly visible world state.
      ...(object.kind === "position" ? {
        capacity: Math.max(1, Number(object.capacity || 1)),
        occupantCharacterIds: (object.occupantCharacterIds || []).map((characterId) => (
          clean(characterId) === owner.id
            ? owner.id
            : clean(entityHandleByCharacterId.get(clean(characterId)))
        )).filter(Boolean),
        observableFeatures: clone(object.observableFeatures || []),
      } : {}),
      ...(selfOwned ? {
        custody: ownCustody, state: clone(object.state || {}),
        handlingState: ownCustody.inHand ? "已拿在自己手中。"
          : ownCustody.storageMode === "packed" ? "仍收在自己的行囊或容器里，尚未拿在手中。"
            : "由自己随身携带或佩戴，尚未拿在手中。",
      } : {}),
      ...(object.kind !== "position" && ownershipNote(worldState, owner.id, object) ? { ownedAs: ownershipNote(worldState, owner.id, object) } : {}),
    }];
  });
}

function observerRows(worldState = {}, owner = {}, visibleCharacters = []) {
  const place = worldState.places?.[owner.placeId] || {};
  return visibleCharacters.map((row) => ({
    characterId: row.id,
    noticeProbability: row.zoneId === owner.zoneId ? 0.94
      : perceivableRoute(place, owner.zoneId, row.zoneId, "visual") != null ? 0.68 : 0,
    modalities: ["visual", "sound"],
  }));
}

function publicOfferings(place = {}) {
  return Object.entries(place.institution?.offerings || {}).map(([id, row]) => ({
    id,
    label: clean(row.label || id),
    category: clean(row.category),
    price: Number(row.price || 0),
    qualityTier: clean(row.qualityTier),
    observableQualities: clone(row.observableQualities || []),
    preparation: clone(row.preparation || null),
  }));
}

function publicInstitution(place = {}) {
  const source = place.institution || {};
  return {
    id: clean(source.id),
    name: clean(source.name || place.name || "望梯酒馆"),
    householdName: clean(source.householdName),
    publicHours: clone(source.publicHours || []),
    offerings: Object.fromEntries(publicOfferings(place).map((row) => [row.id, row])),
    tableUseNorm: clone(source.tableUseNorm || null),
    guestPositions: (source.guestPositions || []).map((row) => ({
      id: row.id,
      label: row.label,
      zoneId: row.zoneId,
      capacity: row.capacity,
      observableFeatures: clone(row.observableFeatures || []),
    })),
  };
}

export function projectTavernSituationV27({
  worldState = {},
  worldVersion = 0,
  characterId = "",
  wake = {},
} = {}) {
  const owner = worldState.entities?.[characterId];
  if (!owner) throw fail("TAVERN_V27_PROJECTION_OWNER_UNKNOWN", "Cannot project an unknown tavern character.", { characterId });
  const place = worldState.places?.[owner.placeId] || {};
  const visibleEntities = visibleCharacterEntities(worldState, owner);
  const entityHandleByCharacterId = new Map(visibleEntities.map((row) => [
    clean(row.id),
    perceivedEntityHandle(owner.id, row.id),
  ]));
  const characters = perceivedCharacters(worldState, owner, visibleEntities);
  const objects = perceivedObjects(
    worldState,
    owner,
    visibleEntities.map((row) => row.id),
    entityHandleByCharacterId,
  );
  const entityHandleByCanonicalId = Object.fromEntries(entityHandleByCharacterId);
  const characterIdByEntityHandle = Object.fromEntries(
    [...entityHandleByCharacterId].map(([canonicalId, handle]) => [handle, canonicalId]),
  );
  const recipientSharedActivities = (worldState.sharedActivities || []).filter((activity) => (
    (activity.participantIds || []).includes(owner.id)
    && (activity.communicatedToCharacterIds || []).includes(owner.id)
  ));
  for (const activity of recipientSharedActivities) {
    for (const participantId of activity.participantIds || []) {
      const canonicalId = clean(participantId);
      if (!canonicalId || canonicalId === owner.id) continue;
      const handle = clean(entityHandleByCanonicalId[canonicalId] || perceivedEntityHandle(owner.id, canonicalId));
      entityHandleByCanonicalId[canonicalId] = handle;
      characterIdByEntityHandle[handle] = canonicalId;
    }
  }
  const identitySurfaceByCanonicalId = Object.fromEntries(visibleEntities.map((row) => [row.id, {
    characterId: row.id,
    name: clean(row.name),
    role: clean(row.role),
    standing: clean(row.standing),
  }]));
  const objectIdByObjectHandle = Object.fromEntries(Object.values(worldState.objects || {}).map((object) => {
    const selfOwned = clean(object.holderCharacterId) === owner.id;
    const otherHeld = Boolean(object.holderCharacterId) && !selfOwned;
    const handle = otherHeld ? perceivedObjectHandle(owner.id, object.id) : object.id;
    return [handle, object.id];
  }));
  const rawReachableZones = projectAdjacentMovementOptions({
    topology: place.topology || {},
    fromZoneId: owner.zoneId,
    actorId: owner.id,
    socialBoundaries: place.socialBoundaries || [],
    accessGrants: place.accessGrants || [],
    step: worldVersion,
  });
  const reachableZones = rawReachableZones.map((row) => ({
    ...clone(row),
    socialAccess: {
      ...clone(row.socialAccess || {}),
      claimantIds: unique((row.socialAccess?.claimantIds || []).flatMap((claimantId) => {
        const canonicalId = clean(claimantId);
        const entity = worldState.entities?.[canonicalId];
        if (entity?.kind !== "character") return canonicalId ? [canonicalId] : [];
        if (canonicalId === owner.id) return [owner.id];
        const perceivedHandle = clean(entityHandleByCanonicalId[canonicalId]);
        return perceivedHandle ? [perceivedHandle] : [];
      })),
    },
  }));
  const actionFeasibilities = projectPerceivedActionFeasibilities({
    characterId: owner.id,
    actorPlaceId: owner.placeId,
    actorZoneId: owner.zoneId,
    perceivedObjects: objects,
    reachableZones,
    worldVersion,
  });
  const perceivedReferences = projectPerceivedReferences({
    perceivedCharacters: characters,
    perceivedObjects: objects,
    reachableZones,
  });
  const socialContext = deriveCharacterSocialContext({
    actorId: owner.id,
    directParticipantIds: unique((wake.evidence || []).flatMap((row) => [
      owner.id,
      entityHandleByCanonicalId[clean(row.sourceCharacterId)],
    ])),
    potentialObservers: observerRows(worldState, owner, characters),
    place: {
      placeId: owner.placeId,
      zoneId: owner.zoneId,
      publicAccess: ["threshold", "hall", "stairs"].includes(owner.zoneId),
    },
    socialFacts: clone(worldState.socialFacts || []),
  });
  const capabilitySurface = TAVERN_CAPABILITY_REGISTRY.project({
    state: worldState,
    actorId: owner.id,
    recipientCharacterIds: visibleEntities.map((row) => row.id),
    perceivedObjectIds: objects.map(row => objectIdByObjectHandle[row.id] || row.id),
  });
  const affordanceBindingByHandle = {};
  const capabilityAffordances = capabilitySurface.affordances.map((row) => {
    const handle = perceivedAffordanceHandle(owner.id, row.canonicalAffordanceId);
    const { public: publicSurface, ...serverBinding } = row;
    affordanceBindingByHandle[handle] = clone(serverBinding);
    const recipientHandle = clean(entityHandleByCanonicalId[clean(row.recipientCharacterId)]);
    return {
      id: handle,
      ...clone(publicSurface || {}),
      attemptPrimitive: "use_affordance",
      actionBinding: { kind: "affordance", affordanceId: handle },
      recipientEntityHandle: recipientHandle,
    };
  });
  const ownedWorldProcesses = capabilitySurface.ownedProcesses.map((row) => ({
    id: perceivedProcessHandle(owner.id, row.processId),
    capability: clean(row.capability),
    kind: clean(row.kind),
    status: clean(row.status),
    offeringId: clean(row.offeringId),
    offeringLabel: clean(row.offeringLabel),
    workTemplateId: clean(row.workTemplateId),
    workLabel: clean(row.workLabel),
    recipientEntityHandle: clean(entityHandleByCanonicalId[clean(row.recipientCharacterId)]),
    stationZoneId: clean(row.stationZoneId),
    objectIds: clone(row.objectIds || []),
    attentionMode: clean(row.attentionMode),
    progress: Number(row.progress || 0),
    remainingSeconds: Number(row.remainingSeconds || 0),
    serviceStatus: clean(row.serviceStatus),
  }));
  const sharedActivityCharacterHandle = (characterId = "") => (
    clean(characterId) === owner.id
      ? owner.id
      : clean(entityHandleByCanonicalId[clean(characterId)] || perceivedEntityHandle(owner.id, characterId))
  );
  const sharedActivities = recipientSharedActivities
    .map((activity) => {
      const projected = clone(activity);
      delete projected.communicatedToCharacterIds;
      projected.participantIds = (activity.participantIds || []).map(sharedActivityCharacterHandle).filter(Boolean);
      projected.initiatorId = sharedActivityCharacterHandle(activity.initiatorId);
      projected.consentByCharacterId = Object.fromEntries(
        Object.entries(activity.consentByCharacterId || {}).map(([characterId, consent]) => [
          sharedActivityCharacterHandle(characterId),
          consent,
        ]),
      );
      for (const field of ["startedByCharacterId", "completedByCharacterId", "withdrawnByCharacterId"]) {
        if (clean(activity[field])) projected[field] = sharedActivityCharacterHandle(activity[field]);
      }
      return projected;
    });
  return {
    authority: "recipient-specific-world-projection",
    recipientCharacterId: owner.id,
    worldVersion,
    nowSeconds: Number(worldState.nowSeconds || 0),
    timePolicy: clone(worldState.timePolicy || characterTimePolicy()),
    temporalContext: projectWorldTemporalContext(worldState, owner, objects.map(row => objectIdByObjectHandle[row.id] || row.id)),
    place: {
      placeId: owner.placeId,
      placeName: clean(place.name || "望梯酒馆"),
      ...(worldState.worldPackMeta?.sceneId ? { sceneId: worldState.worldPackMeta.sceneId, clockLabel: worldState.worldPackMeta.clockLabel || "" } : {}),
      zoneId: owner.zoneId,
      zoneLabel: clean(place.topology?.zones?.[owner.zoneId]?.label || owner.zoneId),
    },
    evidence: clone(wake.evidence || []),
    perceivedCharacters: characters,
    perceivedObjects: objects,
    perceivedConditions: perceivedConditions({ place, zoneId: owner.zoneId }),
    marriage: {
      grown: clean(worldState.entities?.[owner.id]?.ageGroup) !== "child",
      spouse: livingSpouse(worldState, owner.id) ? { characterId: livingSpouse(worldState, owner.id), name: clean(worldState.entities?.[livingSpouse(worldState, owner.id)]?.name) } : null,
    },
    missingHere: missingHere(worldState, owner.id).map((row) => row.label),
    waterHere: waterHere(worldState, owner.id),
    selfHealth: clone(worldState.entities?.[owner.id]?.health || null),
    selfPregnancy: pregnancyFelt(worldState.entities?.[owner.id] || {}, Number(worldState.nowSeconds || 0)),
    timeOfDay: timeOfDayText(worldState),
    clockStartMinutes: startClockMinutes(worldState),
    // A town's people know each other: their names, under the handle they would be heard by, even out of sight.
    knownNamesByHandle: Array.isArray(owner.knownActorIds)
      ? Object.fromEntries(owner.knownActorIds.map((id) => worldState.entities?.[clean(id)]).filter((row) => row?.kind === "character" && clean(row.name))
        .map((row) => [perceivedEntityHandle(owner.id, row.id), clean(row.name)]))
      : {},
    selfSleepiness: worldState.entities?.[owner.id]?.sleep ? sleepinessLine(sleepinessAt(worldState, worldState.entities[owner.id])) : "",
    sleepiness: worldState.entities?.[owner.id]?.sleep ? sleepinessAt(worldState, worldState.entities[owner.id]) : 0,
    movementNotes: Object.fromEntries(reachableZones.map((row) => [row.id, movementHindrance(place, row.id).note]).filter(([, note]) => note)),
    perceivedReferences,
    actionFeasibilities,
    reachableZones,
    socialContext,
    materialFacts: {
      physicalActionRule: PHYSICAL_ACTION_RULE,
      publicOfferings: publicOfferings(place),
      perceivedObjectIds: objects.map((row) => row.id),
      perceptionEnvironment: clone(place.perceptionEnvironment || {}),
    },
    availableAffordances: [
      ...reachableZones.filter((row) => row.physicalAccess?.physicallyAttemptable).map((row) => ({
        id: `route:${owner.zoneId}:${row.id}`,
        kind: "physical_route",
        destinationId: row.id,
        physicalAccess: clone(row.physicalAccess),
        socialAccess: clone(row.socialAccess),
      })),
      ...objects.filter((row) => row.kind === "position").map((row) => ({
        id: row.id,
        kind: "occupiable_position",
        positionId: row.id,
        zoneId: row.zoneId,
        capacity: Math.max(1, Number(row.capacity || 1)),
        remainingCapacity: Math.max(0, Math.max(1, Number(row.capacity || 1)) - (row.occupantCharacterIds || []).length),
        occupantCharacterIds: clone(row.occupantCharacterIds || []),
      })),
      ...capabilityAffordances,
    ],
    ownedWorldProcesses,
    sharedActivities,
    institution: publicInstitution(place),
    recipientPrivateBindings: {
      visibility: "server-only-never-forward-to-character",
      entityHandleByCanonicalId,
      characterIdByEntityHandle,
      identitySurfaceByCanonicalId,
      objectIdByObjectHandle,
      affordanceBindingByHandle,
    },
  };
}

function primaryEvidence(wake = {}) {
  return (wake.evidence || [])[0] || null;
}

const OBSERVATION_ATTENTION_TAG_RULES = Object.freeze([
  ["sword", /sword|剑法|剑招|佩剑|剑器|出剑|剑鞘/u],
  ["weapon", /weapon|martial|blade|sword|刀|枪|剑|斧|兵器|武器|持握|握法/u],
  ["movement", /movement|gait|step|motion|动作|举止|步法|落脚|移动|身法|出手|控制/u],
  ["body", /body|breath|fatigue|pain|injur|身体|呼吸|气息|疲|乏|伤|疼|状态/u],
  ["activity", /activity|work|service|practice|doing|动作|正在|工作|杂务|练习|练剑|劈柴|添火|招待/u],
  ["appearance", /appearance|clothing|robe|dress|穿着|衣着|衣袍|样貌|外貌|气质/u],
  ["position", /position|location|stance|位置|站位|坐姿|去向|所在|门口|堂前|后院/u],
  ["social", /social|response|attention|gaze|回应|态度|目光|视线|交涉|戒备/u],
]);

export function observationAttentionTagsFromCharacterChoice(bridge = {}) {
  const selected = bridge.selectedCandidate || {};
  const source = [
    ...(selected.domains || []),
    selected.intention,
    selected.timingIntent,
    ...(selected.expectedEffects || []).map((row) => row?.direction),
  ].map((row) => clean(row)).filter(Boolean).join(" ");
  const tags = OBSERVATION_ATTENTION_TAG_RULES
    .filter(([, pattern]) => pattern.test(source))
    .map(([tag]) => tag);
  return unique(tags).slice(0, 5);
}

function privateIdentityKnown({ privateState = {}, characterRecord = {}, canonicalId = "", entityHandle = "" } = {}) {
  const ownerId = clean(privateState.ownerCharacterId || characterRecord.id);
  const knowledge = characterRecord.lifeProfile?.tavernAgency?.knowledgeBoundary
    || characterRecord.lifeState?.tavernAgency?.knowledgeBoundary
    || {};
  const explicitlyUnknown = new Set(knowledge.identityUnknownActorIds || []);
  const explicitlyKnown = new Set([
    ...(knowledge.knownActorIds || []),
    ...(characterRecord.lifeState?.knownActorIds || []),
    ...(characterRecord.lifeProfile?.knownActorIds || []),
  ]);
  if (explicitlyKnown.has(canonicalId) && !explicitlyUnknown.has(canonicalId)) return true;
  // A name heard from the person themselves, or said to their face, in a one-call beat.
  if ((privateState.learnedNames || []).some((row) => clean(row?.characterId) === canonicalId)) return true;
  if ((privateState.relationshipContext || []).some((row) => (
    clean(row.toCharacterId || row.otherCharacterId) === canonicalId
  ))) return true;
  const knownEntity = (privateState.psychologyAnchor?.epistemics?.knownEntities || [])
    .find((row) => clean(row.entityId) === canonicalId);
  if (knownEntity?.recognizesIdentity === true) return true;
  if ((privateState.recognizedIdentityBindings || []).some((row) => (
    clean(row.entityHandle) === entityHandle
    && clean(row.characterId) === canonicalId
    && clean(row.status || "confirmed") === "confirmed"
  ))) return true;
  const expectedKnownHandle = knownEntityHandle(ownerId, canonicalId);
  return (privateState.memoryContext?.privateEntityModels || []).some((model) => (
    clean(model.perceivedEntityHandle) === entityHandle
    && (model.identityCandidates || []).some((candidate) => (
      [canonicalId, expectedKnownHandle].includes(clean(candidate.knownEntityHandle))
      && clean(candidate.status) === "supported"
      && clean(candidate.confidenceBand) === "high"
    ))
  ));
}

function projectPrivateKnownEntityReferences({ projection = {}, privateState = {}, characterRecord = {}, ownerId = "" } = {}) {
  const bindings = projection.recipientPrivateBindings || {};
  const anchor = privateState.psychologyAnchor || characterRecord.psychologyAnchor || {};
  const knowledge = characterRecord.lifeProfile?.tavernAgency?.knowledgeBoundary
    || characterRecord.lifeState?.tavernAgency?.knowledgeBoundary
    || {};
  const explicitlyUnknown = new Set(knowledge.identityUnknownActorIds || []);
  const rowsByCanonicalId = new Map();
  const register = (canonicalId = "", patch = {}) => {
    const id = clean(canonicalId);
    if (!id || id === clean(ownerId)) return;
    const previous = rowsByCanonicalId.get(id) || {
      knowsName: false,
      recognizesIdentity: false,
      basis: "",
    };
    rowsByCanonicalId.set(id, {
      knowsName: previous.knowsName || patch.knowsName === true,
      recognizesIdentity: previous.recognizesIdentity || patch.recognizesIdentity === true,
      basis: clean(previous.basis || patch.basis),
    });
  };
  for (const row of anchor.epistemics?.knownEntities || []) {
    register(row?.entityId, {
      knowsName: row?.knowsName === true,
      recognizesIdentity: row?.recognizesIdentity === true,
      basis: row?.basis,
    });
  }
  for (const canonicalId of knowledge.knownActorIds || []) {
    register(canonicalId, {
      knowsName: true,
      recognizesIdentity: !explicitlyUnknown.has(canonicalId),
      basis: "known_person",
    });
  }
  for (const canonicalId of knowledge.hearsayActorIds || []) {
    register(canonicalId, { knowsName: true, recognizesIdentity: false, basis: "hearsay" });
  }
  for (const relationship of privateState.relationshipContext || []) {
    register(relationship?.toCharacterId || relationship?.otherCharacterId, {
      knowsName: true,
      recognizesIdentity: true,
      basis: "relationship_memory",
    });
  }
  return [...rowsByCanonicalId.entries()].map(([canonicalId, row]) => ({
    knownEntityHandle: knownEntityHandle(ownerId, canonicalId),
    knownName: row.knowsName
      ? clean(bindings.identitySurfaceByCanonicalId?.[canonicalId]?.name)
      : "",
    recognizesAppearance: row.recognizesIdentity === true && !explicitlyUnknown.has(canonicalId),
    knowledgeBasis: clean(row.basis || "private_memory"),
  }));
}

function projectPerceivedCharactersForAgent(projection = {}, privateState = {}, characterRecord = {}) {
  const bindings = projection.recipientPrivateBindings || {};
  return (projection.perceivedCharacters || []).map((row) => {
    const canonicalId = clean(bindings.characterIdByEntityHandle?.[row.id]);
    const identityKnown = privateIdentityKnown({
      privateState,
      characterRecord,
      canonicalId,
      entityHandle: row.id,
    });
    // Known only by a name once heard: that name, and nothing of who they are.
    const heard = identityKnown && !privateIdentityKnown({
      privateState: { ...privateState, learnedNames: [] },
      characterRecord,
      canonicalId,
      entityHandle: row.id,
    }) ? (privateState.learnedNames || []).find((entry) => clean(entry?.characterId) === canonicalId) : null;
    const identity = heard ? { name: clean(heard.name) }
      : identityKnown ? bindings.identitySurfaceByCanonicalId?.[canonicalId] || {} : {};
    return {
      ...clone(row),
      identityKnown,
      name: identityKnown ? clean(identity.name) : "",
      role: identityKnown ? clean(identity.role) : "",
      standing: identityKnown ? clean(identity.standing) : "",
      ...(identityKnown ? {
        recognizedIdentity: {
          characterId: canonicalId,
          name: clean(identity.name),
        },
      } : {}),
    };
  });
}

function semanticPerceptionDomains(values = []) {
  const joined = values
    .map((value) => typeof value === "string" ? value : JSON.stringify(value || {}))
    .join(" ")
    .toLowerCase();
  const tags = [];
  const add = (tag, pattern) => { if (pattern.test(joined)) tags.push(tag); };
  add("sword", /sword|blade|剑|剑法|剑招|佩剑/u);
  add("weapon", /weapon|blade|sword|刀|枪|剑|兵器/u);
  add("movement", /move|step|walk|run|动作|步法|走|来|进入|离开/u);
  add("service", /serve|guest|tea|meal|lodg|客|茶|饭|酒|住店|招呼/u);
  add("body", /body|fatigue|pain|injur|身体|疲|乏|伤|疼|呼吸/u);
  add("economic", /coin|price|pay|钱|价|账|铜钱/u);
  add("relationship", /friend|family|father|mother|朋友|家人|父|母|关系/u);
  return unique(tags);
}

function buildDeliveredPerceptionFrame({
  evidence = [],
  perceivedCharacters = [],
  perceivedObjects = [],
  privateState = {},
  characterId = "",
  environment = {},
} = {}) {
  const signalToEvidenceId = new Map();
  const signals = [];
  for (const row of evidence || []) {
    const evidenceId = clean(row.evidenceId);
    if (!evidenceId) continue;
    const sourceHandle = clean(row.sourceEntityHandle);
    const evidenceSignalStem = `signal:${opaqueHash(evidenceId)}`;
    const baseSignalId = `${evidenceSignalStem}:event`;
    signalToEvidenceId.set(baseSignalId, evidenceId);
    signals.push({
      signalId: baseSignalId,
      sourceEntityHandle: sourceHandle,
      modality: clean(row.modality || "visual"),
      featureId: `event:${clean(row.eventKind || row.type || "change")}`,
      physicalFeature: clean(row.content),
      domainTags: unique([
        clean(row.eventKind || row.type),
        ...(row.directed === true ? ["directed"] : []),
        ...semanticPerceptionDomains([row.content, row.topic]),
      ]),
      intensity: row.directed === true ? 0.96 : 0.76,
      transmissionFactor: 1,
      occurredAtSeconds: Number(row.occurredAtSeconds || 0),
    });
    // Stable people and held objects already have their own background
    // projection. They are not new events for every fresh speech delivery.
    for (const [index, texture] of (row.observableAffectiveTexture || []).entries()) {
      const physicalFeature = clean(texture?.feature);
      if (!physicalFeature) continue;
      const signalId = `${evidenceSignalStem}:affect:${opaqueHash(clean(texture.channel || index + 1))}`;
      signalToEvidenceId.set(signalId, evidenceId);
      signals.push({
        signalId,
        sourceEntityHandle: sourceHandle,
        modality: clean(texture.modality || row.modality || "visual"),
        featureId: `affect:${clean(texture.channel || index + 1)}`,
        physicalFeature,
        domainTags: unique(["affective-surface", clean(texture.channel)]),
        intensity: 0.68,
        transmissionFactor: 1,
        occurredAtSeconds: Number(row.occurredAtSeconds || 0),
      });
    }
  }
  const perceptionProfile = privateState.psychologyAnchor?.perceptionProfile
    || privateState.psychologyAnchor?.perceptionPolicy
    || {};
  const currentActivities = privateState.currentActivities || [];
  const desireRows = Object.values(privateState.ecologyState?.desires || {});
  const frame = buildCharacterPerceptionFrame({
    signals,
    profile: perceptionProfile,
    environment,
    bodyState: privateState.ecologyState?.body || {},
    attentionContext: {
      goalDomains: semanticPerceptionDomains([privateState.currentIntention]),
      desireDomains: semanticPerceptionDomains(desireRows),
      dutyDomains: semanticPerceptionDomains(currentActivities.filter((row) => row.type === "duty")),
      relationshipDomains: semanticPerceptionDomains(privateState.relationshipContext || []),
      deliberateFocusDomains: unique((evidence || []).flatMap((row) => (
        row.semanticFrame?.observationResult?.attentionTags || []
      ))),
    },
    seed: `${characterId}:${privateState.lastAgentTurnId || "initial"}`,
    maxEvidence: 8,
  });
  return {
    schemaVersion: frame.schemaVersion,
    formulaVersion: frame.formulaVersion,
    authority: frame.authority,
    noticedEvidence: (frame.noticedEvidence || []).map((row) => ({
      ...clone(row),
      evidenceId: clean(signalToEvidenceId.get(row.sourceSignalIds?.[0]) || row.evidenceId),
      physicalFeature: clean(row.noticedFeature),
    })),
    interpretations: clone(frame.interpretations || []),
    attentionState: clone(frame.attentionTrace || {}),
    deferredEvidenceIds: unique((frame.attentionTrace?.deferredDirectedSignalIds || []).map(id => signalToEvidenceId.get(id))),
  };
}

function recentByTimestamp(rows = [], limit = 4) {
  return [...(rows || [])]
    .sort((left, right) => Number(
      right?.lastUpdatedAtSeconds
      ?? right?.updatedAtSeconds
      ?? right?.perceivedAt?.seconds
      ?? 0,
    ) - Number(
      left?.lastUpdatedAtSeconds
      ?? left?.updatedAtSeconds
      ?? left?.perceivedAt?.seconds
      ?? 0,
    ))
    .slice(0, limit)
    .map(clone);
}

function projectEpisodeForCurrentRecall(episode = {}) {
  const perception = episode.perception || {};
  const source = episode.source || {};
  return {
    id: clean(episode.id),
    ownerCharacterId: clean(episode.ownerCharacterId),
    kind: clean(episode.kind),
    evidenceIds: clone((episode.evidenceIds || []).slice(-12)),
    perceivedAt: clone(episode.perceivedAt || {}),
    perception: {
      modality: clean(perception.modality),
      modalities: clone(perception.modalities || []),
      content: clean(perception.content),
      topic: clean(perception.topic),
      sourceCharacterId: clean(perception.sourceCharacterId),
      sourceEntityHandle: clean(perception.sourceEntityHandle),
      identityKnown: perception.identityKnown === true,
      detailBand: clean(perception.detailBand),
    },
    semanticFrame: clone(episode.semanticFrame || null),
    source: {
      kind: clean(source.kind),
      immediateSourceCharacterId: clean(source.immediateSourceCharacterId),
      sourceEntityHandle: clean(source.sourceEntityHandle),
      identityKnown: source.identityKnown === true,
      speakerCharacterId: clean(source.speakerCharacterId),
      claimedOriginalSourceId: clean(source.claimedOriginalSourceId),
      characterChain: clone((source.characterChain || []).slice(-8)),
      directness: Number(source.directness || 0),
      confidence: Number(source.confidence || 0),
    },
    interpretations: clone((episode.interpretations || []).slice(-2).map((row) => ({
      atSeconds: Number(row?.atSeconds || 0),
      summary: clean(row?.summary),
      confidence: Number(row?.confidence || 0),
      source: clean(row?.source),
    }))),
    accessibility: Number(episode.accessibility || 0),
    retentionStrength: Number(episode.retentionStrength || 0),
    importance: Number(episode.importance || 0),
  };
}

function projectBeliefForCurrentRecall(belief = {}) {
  return {
    id: clean(belief.id),
    kind: clean(belief.kind),
    ownerCharacterId: clean(belief.ownerCharacterId),
    propositionKey: clean(belief.propositionKey),
    proposition: clean(belief.proposition),
    currentValue: clean(belief.currentValue),
    status: clean(belief.status),
    confidence: Number(belief.confidence || 0),
    importance: Number(belief.importance || 0),
    semanticFrame: clone(belief.semanticFrame || null),
    sourceMemoryIds: clone((belief.sourceMemoryIds || []).slice(-24)),
    sourceReflectionOpportunityId: clean(belief.sourceReflectionOpportunityId),
    supportingEpisodeIds: clone((belief.supportingEpisodeIds || []).slice(-8)),
    conflictingEpisodeIds: clone((belief.conflictingEpisodeIds || []).slice(-8)),
    sourceEvidenceIds: clone((belief.sourceEvidenceIds || []).slice(-12)),
    reasoningMode: clean(belief.reasoningMode),
    lastOperation: clean(belief.lastOperation),
    lastUpdatedAtSeconds: Number(belief.lastUpdatedAtSeconds || 0),
  };
}

function projectPrivateEntityModelForCurrentRecall(model = {}) {
  return {
    id: clean(model.id),
    ownerCharacterId: clean(model.ownerCharacterId),
    perceivedEntityHandle: clean(model.perceivedEntityHandle),
    hypotheses: clone(model.hypotheses || []),
    identityCandidates: clone(model.identityCandidates || []),
    affectiveResponse: clone(model.affectiveResponse || {}),
    attentionPriority: Number(model.attentionPriority || 0),
    contradictions: clone((model.contradictions || []).slice(-4)),
    firstObservedAtSeconds: Number(model.firstObservedAtSeconds || 0),
    lastUpdatedAtSeconds: Number(model.lastUpdatedAtSeconds || 0),
  };
}

/**
 * Project durable private memory into the small, fallible slice this Character
 * can use in the present situation. The complete memory remains on the actor;
 * this function neither mutates it nor chooses what the Character should do.
 */
export function projectCharacterMemoryForCurrentSituation({
  memoryContext = {},
  characterId = "",
  nowSeconds = 0,
  currentIntention = "",
  attendedEvidence = [],
  perceivedCharacters = [],
  knownEntityReferences = [],
  relationshipContext = [],
  currentActivities = [],
  ownCommitments = [],
  ecologyProfile = {},
  limit = 8,
} = {}) {
  const durable = clone(memoryContext || {});
  const evidenceFrames = (attendedEvidence || []).map((row) => row?.semanticFrame || {});
  const relevantHandles = new Set(unique([
    ...(attendedEvidence || []).flatMap((row) => [row?.sourceEntityHandle, row?.sourceCharacterId]),
    ...(perceivedCharacters || []).map((row) => row?.id),
    ...(knownEntityReferences || []).flatMap((row) => [row?.knownEntityHandle, row?.recognizedCharacterId]),
    ...(relationshipContext || []).flatMap((row) => [row?.otherCharacterId, row?.toCharacterId, row?.recognizedCharacterId]),
  ]));
  const lexicalCues = unique([
    currentIntention,
    ...(attendedEvidence || []).flatMap((row) => [row?.content, row?.topic]),
    ...(currentActivities || []).map((row) => row?.description || row?.label),
    ...(ownCommitments || []).map((row) => row?.topic || row?.description || row?.label),
    ...(ecologyProfile?.desires || []).map((row) => row?.want || row?.label || row?.desire),
  ]).slice(0, 20);
  const retrieved = retrieveCharacterAgentMemory(durable, {
    nowSeconds,
    limit: Math.max(1, Math.min(12, Number(limit || 8))),
    sourceImpactId: clean(attendedEvidence?.[0]?.impactId || attendedEvidence?.[0]?.evidenceId),
    characterIds: [...relevantHandles],
    topicIds: unique([
      ...(attendedEvidence || []).map((row) => row?.topic),
      ...evidenceFrames.map((frame) => frame?.topicId),
    ]),
    predicates: unique(evidenceFrames.map((frame) => frame?.predicate)),
    lexicalCues,
  });
  const commitmentById = new Map();
  for (const row of [
    ...(durable.commitments || []).filter((commitment) => clean(commitment?.status) !== "resolved"),
    ...(retrieved.commitments || []),
  ]) {
    const id = clean(row?.id);
    if (id && !commitmentById.has(id)) commitmentById.set(id, clone(row));
  }
  const relevantOrRecent = (rows = [], handleFields = [], rowLimit = 4) => {
    const matching = (rows || []).filter((row) => handleFields.some((field) => relevantHandles.has(clean(row?.[field]))));
    return recentByTimestamp(matching.length ? matching : rows, rowLimit);
  };
  const privateEntityModels = relevantOrRecent(
    durable.privateEntityModels,
    ["perceivedEntityHandle"],
    6,
  ).map(projectPrivateEntityModelForCurrentRecall);
  const locationBeliefs = relevantOrRecent(
    durable.locationBeliefs,
    ["subjectHandle"],
    6,
  );
  const sourceKnowledgeBeliefs = relevantOrRecent(
    durable.sourceKnowledgeBeliefs,
    ["sourceHandle", "subjectHandle"],
    6,
  );
  const selfNarrative = {
    currentClaims: clone(durable.selfNarrative?.currentClaims || []),
    pendingCandidates: clone((durable.selfNarrative?.pendingCandidates || []).slice(-4)),
    versions: clone((durable.selfNarrative?.versions || []).slice(-2)),
  };
  return {
    schemaVersion: durable.schemaVersion || retrieved.schemaVersion,
    ownerCharacterId: clean(durable.ownerCharacterId || retrieved.ownerCharacterId || characterId),
    retrievedAtSeconds: Number(nowSeconds || 0),
    episodes: (retrieved.episodes || []).map(projectEpisodeForCurrentRecall),
    beliefs: (retrieved.beliefs || []).map(projectBeliefForCurrentRecall),
    commitments: [...commitmentById.values()].slice(0, 10),
    impressions: clone((retrieved.impressions || []).slice(-4)),
    privateEntityModels,
    locationBeliefs,
    sourceKnowledgeBeliefs,
    selfNarrative,
    retrievalTrace: clone((retrieved.retrievalTrace || []).map((row) => ({
      episodeId: clean(row?.episodeId),
      score: Number(row?.score || 0),
      cueMatch: Number(row?.cueMatch || 0),
    }))),
    contextProjection: {
      authority: "character-private-memory-retrieval-tool",
      selection: null,
      durableCounts: {
        episodes: Number(durable.episodes?.length || 0),
        beliefs: Number(durable.beliefs?.length || 0),
        commitments: Number(durable.commitments?.length || 0),
      },
      projectedCounts: {
        episodes: Number(retrieved.episodes?.length || 0),
        beliefs: Number(retrieved.beliefs?.length || 0),
        commitments: Number(commitmentById.size),
      },
    },
  };
}

export function buildTavernCharacterAgentInputV27(context = {}, characterRecord = {}) {
  const projection = context.worldProjection || {};
  const privateState = context.privateContext || {};
  const bindings = projection.recipientPrivateBindings || {};
  const projectedCharacters = projectPerceivedCharactersForAgent(projection, privateState, characterRecord);
  const knownEntityReferences = projectPrivateKnownEntityReferences({
    projection,
    privateState,
    characterRecord,
    ownerId: context.characterId,
  });
  // Whoever the owner knows by name, under the handle they are seen or heard by: a voice keeps its name out of sight.
  const knownNamesByHandle = { ...(projection.knownNamesByHandle || {}) };
  for (const canonicalId of Object.keys(bindings.identitySurfaceByCanonicalId || {})) {
    const known = knownEntityReferences.find((row) => row.knownEntityHandle === knownEntityHandle(context.characterId, canonicalId));
    if (clean(known?.knownName)) knownNamesByHandle[perceivedEntityHandle(context.characterId, canonicalId)] = clean(known.knownName);
  }
  for (const row of privateState.learnedNames || []) {
    const handle = perceivedEntityHandle(context.characterId, clean(row.characterId));
    if (clean(row.name) && !knownNamesByHandle[handle]) knownNamesByHandle[handle] = clean(row.name);
  }
  for (const row of privateState.relationshipContext || []) {
    const handle = perceivedEntityHandle(context.characterId, clean(row.toCharacterId));
    if (clean(row.toCharacterName) && !knownNamesByHandle[handle]) knownNamesByHandle[handle] = clean(row.toCharacterName);
  }
  const projectedCharacterByHandle = new Map(projectedCharacters.map((row) => [row.id, row]));
  // The host froze the receipt-ledger scope settlement will accept for this
  // turn. Retained self-evidence the ledger already expired must not be
  // offered as a citable reference, or the Agent gets allowed to cite an id
  // that settlement then rejects.
  const hostReceiptScope = Array.isArray(context.hostReceiptEvidenceIds)
    ? new Set(context.hostReceiptEvidenceIds.map(clean).filter(Boolean))
    : null;
  const retainedSelfEvidence = (privateState.retainedImmediateSelfEvidence || []).filter((row) => {
    if (!hostReceiptScope) return true;
    const evidenceId = clean(row?.evidenceId || (row?.deliveryId ? `evidence:${row.deliveryId}` : ""));
    return Boolean(evidenceId) && hostReceiptScope.has(evidenceId);
  });
  const rawEvidenceById = new Map();
  for (const row of [
    ...(projection.evidence || []),
    ...retainedSelfEvidence,
  ]) {
    const evidenceId = clean(row?.evidenceId || (row?.deliveryId ? `evidence:${row.deliveryId}` : ""));
    if (evidenceId && !rawEvidenceById.has(evidenceId)) rawEvidenceById.set(evidenceId, { ...clone(row), evidenceId });
  }
  const conversationLineageByEvidenceId = new Map();
  const evidence = [...rawEvidenceById.values()].map((row) => {
    const canonicalSourceId = clean(row.sourceCharacterId);
    const sourceEntityHandle = clean(
      row.sourceEntityHandle
      || bindings.entityHandleByCanonicalId?.[canonicalSourceId]
      || (canonicalSourceId ? perceivedEntityHandle(context.characterId, canonicalSourceId) : ""),
    );
    const perceivedSource = projectedCharacterByHandle.get(sourceEntityHandle) || {};
    const identityKnown = perceivedSource.identityKnown === true;
    const sourceName = clean(bindings.identitySurfaceByCanonicalId?.[canonicalSourceId]?.name);
    const isLiteralSpeech = clean(row.eventKind) === "speech";
    const anonymizedContent = !identityKnown && sourceName && !isLiteralSpeech
      ? clean(row.content).split(sourceName).join(row.directed === true ? "对方" : "那人")
      : clean(row.content);
    const observableAffectiveTexture = (row.observableAffectiveTexture || []).map((texture) => ({
      ...clone(texture),
      feature: !identityKnown && sourceName
        ? clean(texture?.feature).split(sourceName).join(row.directed === true ? "对方" : "那人")
        : clean(texture?.feature),
    }));
    const speechAct = clean(row.speechAct || (clean(row.eventKind) === "speech" ? "inform" : "none"));
    const speechFunctions = unique(row.speechFunctions || (speechAct !== "none" ? [speechAct] : []));
    const provenance = row.provenance && typeof row.provenance === "object"
      ? row.provenance
      : {};
    const sourceActionId = clean(row.sourceActionId || provenance.sourceActionId);
    const sourceThreadId = clean(
      row.sourceThreadId
      || row.conversationThreadHandle
      || provenance.sourceThreadId,
    );
    const responseToTurnId = clean(row.responseToTurnId || provenance.responseToTurnId);
    conversationLineageByEvidenceId.set(clean(row.evidenceId), {
      deliveryId: clean(row.deliveryId || row.evidenceId),
      sourceActionId,
      sourceThreadId,
      responseToTurnId,
    });
    return {
      impactId: clean(row.eventId || row.evidenceId),
      evidenceId: clean(row.evidenceId),
      perceivedSourceCharacterId: identityKnown ? clean(perceivedSource.recognizedIdentity?.characterId) : "",
      sourceCharacterId: identityKnown ? clean(perceivedSource.recognizedIdentity?.characterId) : "",
      sourceEntityHandle,
      identityKnown,
      provenance: { kind: clean(provenance.kind) },
      modality: clean(row.modality),
      type: clean(row.eventKind || context.wake?.kind || "world_evidence"),
      content: anonymizedContent,
      topic: clean(row.topic),
      directed: row.directed === true,
      speechAct,
      speechFunctions,
      actionKind: clean(row.eventKind),
      observableAffectiveTexture,
      semanticFrame: clone(row.semanticFrame || {}),
      occurredAtSeconds: Number(row.occurredAtSeconds ?? projection.nowSeconds ?? 0),
    };
  });
  const perceptionFrame = buildDeliveredPerceptionFrame({
    evidence,
    perceivedCharacters: projectedCharacters,
    perceivedObjects: projection.perceivedObjects || [],
    privateState,
    characterId: context.characterId,
    environment: projection.materialFacts?.perceptionEnvironment || {},
  });
  const noticedEvidenceIds = new Set(
    (perceptionFrame.noticedEvidence || []).map((row) => clean(row.evidenceId)),
  );
  // What a person deliberately looked at or listened for is what they attended to; it is never lost to salience.
  const attendedEvidence = evidence.filter((row) => noticedEvidenceIds.has(clean(row.evidenceId))
    || ["observation_result", "listening_result"].includes(clean(row.type)));
  let projectedConversationState = clone(privateState.conversationState || null);
  for (const row of attendedEvidence) {
    const lineage = conversationLineageByEvidenceId.get(clean(row.evidenceId)) || {};
    if (
      clean(row.type) !== "speech"
      || !clean(row.content)
      || !clean(lineage.sourceActionId)
      || !clean(lineage.sourceThreadId)
      || !clean(row.sourceEntityHandle || row.sourceCharacterId)
    ) continue;
    projectedConversationState = advanceCharacterConversationContinuity({
      ownerCharacterId: context.characterId,
      conversationState: projectedConversationState,
      experience: {
        kind: "noticed_speech_delivery",
        runtimeRecord: {
          authority: "runtime-noticed-speech-delivery",
          deliveryId: clean(lineage.deliveryId || row.evidenceId),
          recipientCharacterId: context.characterId,
          noticed: true,
          eventKind: "speech",
          sourceParticipantHandle: clean(row.sourceEntityHandle || row.sourceCharacterId),
          directed: row.directed === true,
          content: clean(row.content),
          speechAct: clean(row.speechAct || "inform"),
          occurredAtSeconds: Number(row.occurredAtSeconds || projection.nowSeconds || 0),
          threadStatus: "open",
          resumable: true,
          provenance: {
            sourceActionId: clean(lineage.sourceActionId),
            sourceThreadId: clean(lineage.sourceThreadId),
            responseToTurnId: clean(lineage.responseToTurnId),
          },
        },
      },
      nowSeconds: Number(projection.nowSeconds || 0),
    }).conversationState;
  }
  const conversationAnchors = projectOwnedConversationAnchors({
    ownerCharacterId: context.characterId,
    conversationState: projectedConversationState,
    nowSeconds: Number(projection.nowSeconds || 0),
  });
  const first = primaryEvidence({ evidence: attendedEvidence });
  const currentConversationTurns = attendedEvidence.flatMap((row) => {
    if (clean(row.type) !== "speech" || !clean(row.content)) return [];
    const sourceHandle = clean(row.sourceEntityHandle || row.sourceCharacterId || "unresolved_speaker");
    return [{
      id: `conversation_surface:${opaqueHash(`${context.characterId}|${clean(row.evidenceId)}`)}`,
      authority: "recipient-experienced-literal-history",
      speakerId: sourceHandle,
      addresseeId: row.directed === true ? context.characterId : "",
      utterance: clean(row.content),
      speechAct: clean(row.speechAct || "inform"),
      speechFunctions: clone(row.speechFunctions || []),
      directed: row.directed === true,
      evidenceId: clean(row.evidenceId),
      occurredAtSeconds: Number(row.occurredAtSeconds || projection.nowSeconds || 0),
      truthStatus: "literal-public-content-not-automatically-verified",
    }];
  });
  const durableConversationTurnSurfaces = (privateState.experiencedConversationTurns || [])
    .filter((row) => clean(row?.utterance))
    .map((row) => ({
      id: `conversation_surface:${opaqueHash(`${context.characterId}|${clean(row.evidenceId || row.id)}`)}`,
      authority: "recipient-experienced-literal-history",
      speakerId: clean(row.speakerId),
      addresseeId: clean(row.addresseeId),
      utterance: clean(row.utterance),
      speechAct: clean(row.speechAct || "inform"),
      speechFunctions: clone(row.speechFunctions || []),
      directed: row.directed === true,
      evidenceId: clean(row.evidenceId),
      occurredAtSeconds: Number(row.occurredAtSeconds || 0),
      truthStatus: "literal-public-content-not-automatically-verified",
    }));
  const recentPublicTurnsById = new Map([
    ...durableConversationTurnSurfaces,
    ...currentConversationTurns,
  ].flatMap((row) => clean(row?.id) ? [[clean(row.id), clone(row)]] : []));
  const recentPublicTurns = [...recentPublicTurnsById.values()]
    .sort((left, right) => Number(left.occurredAtSeconds || 0) - Number(right.occurredAtSeconds || 0))
    .slice(-12);
  const relationContext = (privateState.relationshipContext || []).flatMap((row) => {
    const canonicalId = clean(row.toCharacterId || row.otherCharacterId);
    const handle = clean(bindings.entityHandleByCanonicalId?.[canonicalId]);
    const person = projectedCharacterByHandle.get(handle);
    if (!person?.identityKnown) return [];
    return [{
      ...clone(row),
      otherCharacterId: handle,
      toCharacterId: handle,
      recognizedCharacterId: canonicalId,
    }];
  });
  const targetId = clean(first?.sourceEntityHandle || projectedCharacters?.[0]?.id);
  const canonicalVoiceTargetId = clean(
    bindings.characterIdByEntityHandle?.[targetId]
    || first?.sourceCharacterId,
  );
  const voiceContract = buildTavernVoiceContract({
    ...clone(characterRecord),
    psychologyAnchor: clone(privateState.psychologyAnchor || characterRecord.psychologyAnchor || null),
    ecologyProfile: clone(privateState.ecologyProfile || null),
  }, {
    targetCharacterId: canonicalVoiceTargetId,
    relationshipContext: clone(privateState.relationshipContext || []),
  });
  const memoryContext = projectCharacterMemoryForCurrentSituation({
    memoryContext: privateState.memoryContext || {},
    characterId: context.characterId,
    nowSeconds: Number(projection.nowSeconds || 0),
    currentIntention: privateState.currentIntention,
    attendedEvidence,
    perceivedCharacters: projectedCharacters,
    knownEntityReferences,
    relationshipContext: relationContext,
    currentActivities: privateState.currentActivities || [],
    ownCommitments: privateState.ownCommitments || [],
    ecologyProfile: privateState.ecologyProfile || {},
  });
  const recentOwnActions = clone((privateState.recentOwnActions || []).slice(-8));
  const settledInteractionEvents = projectWithoutRawConversationLineage(
    (privateState.settledInteractionEvents || []).slice(-12),
  );
  const currentResponsibilities = buildCurrentResponsibilitySurface({
    privateState,
    projection: {
      ...projection,
      availableAffordances: projection.availableAffordances || [],
    },
  });
  const activePlanProjection = projectCharacterLifeContinuityForOwner(privateState, {
    nowSeconds: Number(projection.nowSeconds || 0),
    planStepIds: context.wake?.planStepIds || [],
  });
  const sharedActivityUnderstandings = mergeSharedActivityUnderstandings(
    privateState.sharedActivityUnderstandings || [],
    projection.sharedActivities || [],
  );
  return {
    agentTurnId: context.agentTurnId,
    scene: {
      id: projection.place?.sceneId || "scene:xyy:tavern:v27",
      step: Number(context.expectedWorldVersion || 0),
      locationId: projection.place?.placeId || LOCATION_ID,
      locationName: projection.place?.placeName || "望梯酒馆",
      elapsedSeconds: Number(projection.nowSeconds || 0),
      characterElapsedSeconds: Number(
        privateState.ecologyState?.elapsedSeconds
        ?? projection.nowSeconds
        ?? 0,
      ),
      zoneId: projection.place?.zoneId || "hall",
      zoneLabel: projection.place?.zoneLabel || "堂前",
      slotId: "continuous-runtime",
      slotLabel: "同一连续时刻",
      day: 0,
    },
    agent: {
      id: context.characterId,
      name: clean(characterRecord.name || privateState.characterName || context.characterId),
      role: clean(privateState.role || publicRole(characterRecord)),
      standing: clean(privateState.standing || publicStanding(characterRecord)),
      currentIntention: clean(privateState.currentIntention || "继续眼下的生活"),
      currentResponsibilities: clone(currentResponsibilities),
      attentionTargetId: targetId,
      privateState: {
        ownerCharacterId: context.characterId,
        ecologyProfile: clone(privateState.ecologyProfile || null),
        ecologyState: clone(privateState.ecologyState || null),
      },
      psychologyAnchor: clone(privateState.psychologyAnchor || null),
      perceptionProfile: clone(
        privateState.psychologyAnchor?.perceptionProfile
        || privateState.psychologyAnchor?.perceptionPolicy
        || {},
      ),
      relationshipContext: clone(relationContext),
      knownEntityReferences: clone(knownEntityReferences),
      voiceContract,
      expressionProtocol: {
        authority: "runtime-expression-interface",
        publicDescriptionLanguage: "zh-Hans",
        rule: "This language serializes observable action and affect descriptions for the world interface; it does not become a language the Character can speak.",
      },
      memoryContext,
    },
    activation: first ? {
      impactId: first.impactId,
      sourceCharacterId: first.sourceCharacterId,
      sourceEntityHandle: first.sourceEntityHandle,
      identityKnown: first.identityKnown,
      evidenceId: first.evidenceId,
      type: first.type,
      modality: first.modality,
      directed: first.directed,
      content: first.content,
      topic: first.topic,
      speechAct: first.speechAct,
      speechFunctions: clone(first.speechFunctions),
      actionKind: first.actionKind,
      responseSourceLine: "",
      responseSourceSlotId: "",
      responseSourceSlotLabel: "",
    } : null,
    choiceAuthority: {
      owner: "character-agent",
      mathematicsRole: "private-psychological-state-and-evaluation-after-subjective-appraisal",
      worldRole: "facts-affordances-feasibility-consequences",
      rule: "the character appraises, generates, chooses and realizes; the world only settles the submitted attempt",
    },
    relationshipAppraisalContract: {
      owner: "character-agent",
      metricIds: clone(TAVERN_RELATIONSHIP_METRICS),
      rule: "public evidence does not automatically rewrite a relationship",
    },
    privateActionCandidates: clone(privateState.privateActionCandidates || []),
    perceptionFrame,
    perceivedImpacts: attendedEvidence,
    perceptionMemory: [],
    perceivedCharacters: clone(projectedCharacters),
    epistemicBeliefState: buildCharacterEpistemicBeliefState(memoryContext),
    epistemicDecisionSupport: {
      authority: "character-private-epistemic-tool",
      evaluations: [],
      selection: { authority: "character-agent", selectedCandidateId: null, pool: [] },
    },
    temporalContext: clone(projection.temporalContext || {}),
    ownTimeExperience: clone(projection.ownTimeExperience || {}),
    materialFacts: clone(projection.materialFacts || {}),
    perceivedConditions: clone(projection.perceivedConditions || []),
    marriage: clone(projection.marriage || null),
    missingHere: clone(projection.missingHere || []),
    waterHere: projection.waterHere || "",
    selfHealth: clone(projection.selfHealth || null),
    selfPregnancy: clean(projection.selfPregnancy),
    timeOfDay: clean(projection.timeOfDay),
    clockStartMinutes: projection.clockStartMinutes ?? null,
    knownNamesByHandle,
    selfSleepiness: clean(projection.selfSleepiness),
    sleepiness: Number(projection.sleepiness || 0),
    movementNotes: clone(projection.movementNotes || {}),
    settledInteractionEvents,
    discourseContext: {
      currentEvidence: attendedEvidence.map((row) => ({
        evidenceId: row.evidenceId,
        sourceCharacterId: row.sourceCharacterId,
        sourceEntityHandle: row.sourceEntityHandle,
        content: row.content,
      })),
      recentOwnActions,
      settledSharedEvents: settledInteractionEvents,
      speakerOwnedActs: recentOwnActions,
      recentPublicTurns,
      anchorIds: unique([
        ...recentPublicTurns.map((row) => row.id),
        ...settledInteractionEvents.map((row) => row.id),
      ]),
    },
    conversationAnchors,
    socialContext: clone(projection.socialContext || {}),
    currentResponsibilities: clone(currentResponsibilities),
    sharedActivities: clone(sharedActivityUnderstandings),
    ongoingOwnActivities: clone(privateState.currentActivities || []),
    activePlanProjection,
    accessGrants: clone(projection.reachableZones?.flatMap((row) => row.socialAccess?.matchingGrantIds || []) || []),
    recentFailedAttempts: [],
    perceivedObjects: clone(projection.perceivedObjects || []),
    perceivedReferences: clone(projection.perceivedReferences || []),
    actionFeasibilities: clone(projection.actionFeasibilities || []),
    availableAffordances: clone(projection.availableAffordances || []),
    serviceChoice: null,
    serviceChoiceTool: null,
    recentOwnActions,
    reachableZones: clone(projection.reachableZones || []),
    ownCommitments: clone(privateState.ownCommitments || []),
    ownedWorldProcesses: clone(projection.ownedWorldProcesses || []),
    activationCause: {
      type: clean(context.wake?.causeType || context.wake?.kind),
      continuationIntentionIds: clone(context.wake?.continuationIntentionIds || []),
      planStepIds: clone(context.wake?.planStepIds || []),
      processIds: clone(context.wake?.processIds || []),
      settledOwnAction: projectWithoutRawConversationLineage(context.wake?.settledOwnAction || null),
    },
    openConversationThreads: conversationAnchors.anchors.map((row) => ({
      ...clone(row),
      id: clean(row.anchorHandle),
      turns: [],
    })),
    institution: clone(projection.institution || {}),
  };
}

export function lowerTavernV27WorldAttempt(bridge = {}) {
  const decision = bridge.rawDecision || {};
  const source = decision.actionAttempt || {};
  const primitive = clean(source.primitive || "none");
  const binding = source.actionBinding && typeof source.actionBinding === "object"
    ? source.actionBinding
    : decision.actionBinding && typeof decision.actionBinding === "object"
      ? decision.actionBinding
      : {};
  const bindingKind = clean(binding.kind);
  const boundTargetId = bindingKind === "character"
    ? clean(binding.targetCharacterId)
    : bindingKind === "object"
      ? clean(binding.objectId)
      : bindingKind === "place"
        ? clean(binding.destinationId)
        : bindingKind === "position"
          ? clean(binding.positionId)
          : "";
  const inferredTargetKind = bindingKind || (
    clean(source.targetCharacterId) ? "character"
      : clean(source.objectId) ? "object"
        : clean(source.destinationId) ? "place"
          : clean(source.positionId) ? "position"
            : clean(source.affordanceId) ? "affordance"
              : "none"
  );
  const shared = {
    waitCondition: clone(source.waitCondition),
    contactOperation: clean(source.contactOperation),
    visibleAction: clean(decision.visibleAction || decision.embodiedIntent?.intendedGesture),
    bodyActions: clone(decision.bodyActions || decision.embodiedIntent?.bodyActions || []),
    observableAffectiveTexture: clone(decision.observableAffectiveTexture || []),
    utterance: clean(decision.speech || decision.utterance?.literalSpeech),
    speechTargetCharacterId: clean(
      decision.speechTargetCharacterId
      || (clean(decision.speech || decision.utterance?.literalSpeech)
        ? source.targetCharacterId || decision.targetCharacterId
        : ""),
    ),
    speechAct: clean(decision.speechAct || decision.utterance?.speechAct || "none"),
    speechFunctions: unique(decision.speechFunctions || decision.utterance?.speechFunctions || []),
    vocalMode: clean(decision.utterance?.vocalMode) === "call_out" ? "call_out" : "conversational",
    provenance: {
      sourceActionId: clean(decision.sourceActionId),
      sourceThreadId: clean(decision.sourceThreadId),
      responseToTurnId: clean(decision.responseToTurnId),
    },
    sharedActivity: clone(decision.sharedActivity || null),
  };
  if (primitive === "none") return null;
  if (primitive === "speak") return {
    primitive: "speak",
    payload: {
      ...shared,
      utterance: clean(decision.speech || decision.utterance?.literalSpeech),
      targetCharacterId: clean(source.targetCharacterId || decision.targetCharacterId),
    },
  };
  if (primitive === "observe" || primitive === "listen") return {
    primitive,
    payload: {
      ...shared,
      // The chosen typed binding owns the physical target. The expression
      // audience is deliberately excluded: listening at a door is not
      // listening to the last person addressed in the hall.
      targetKind: inferredTargetKind,
      targetId: boundTargetId || clean(
        source.targetCharacterId
        || source.objectId
        || source.destinationId
        || source.positionId
        || source.affordanceId
        || decision.targetCharacterId,
      ),
      ...(primitive === "observe"
        ? { attentionTags: observationAttentionTagsFromCharacterChoice(bridge) }
        : {}),
    },
  };
  if (primitive === "move") return {
    primitive: "move",
    payload: {
      ...shared,
      destinationId: clean(source.destinationId || decision.moveToZoneId),
      positionId: clean(source.positionId || (bindingKind === "position" ? binding.positionId : "")),
    },
  };
  if (primitive === "interact" && ["place", "character"].includes(inferredTargetKind)) return {
    primitive: "interact",
    payload: {
      ...shared,
      targetKind: inferredTargetKind,
      targetId: boundTargetId || clean(
        source.targetCharacterId
        || source.destinationId
        || decision.targetCharacterId,
      ),
    },
  };
  if (primitive === "use_affordance" && bridge.serverWorldBinding?.capabilityBinding) return {
    primitive: "use_affordance",
    payload: {
      ...shared,
      affordanceId: clean(source.affordanceId),
      capabilityBinding: clone(bridge.serverWorldBinding.capabilityBinding),
    },
  };
  if (OBJECT_ACTIONS.has(primitive)) return {
    primitive: "handle",
    payload: {
      ...shared,
      objectId: clean(source.objectId) || clean(source.positionId) || clean(source.affordanceId),
      operation: primitive === "pickup" ? "take" : primitive,
      targetCharacterId: clean(source.targetCharacterId || decision.targetCharacterId),
      destinationId: clean(source.destinationId),
      originalPrimitive: primitive,
    },
  };
  return {
    primitive,
    payload: {
      ...shared,
      targetCharacterId: clean(source.targetCharacterId || decision.targetCharacterId),
      destinationId: clean(source.destinationId || decision.moveToZoneId),
      objectId: clean(source.objectId),
    },
  };
}

/**
 * Convert one Character-authored opaque anchor choice into the only lineage
 * pair the world may receive. The pair is resolved against that Actor's
 * server-private state and cannot be supplied or mixed by the Character.
 */
export function resolveTavernV27ConversationSelectionForWorld({
  bridge = {},
  ownerCharacterId = "",
  conversationState = null,
} = {}) {
  const output = clone(bridge || {});
  const decision = output.rawDecision || {};
  const preboundLineage = {
    sourceActionId: clean(decision.sourceActionId),
    sourceThreadId: clean(decision.sourceThreadId),
    responseToTurnId: clean(decision.responseToTurnId),
  };
  if (Object.values(preboundLineage).some(Boolean)) {
    throw fail(
      "TAVERN_V27_RAW_CONVERSATION_LINEAGE_FORBIDDEN",
      "A Character may choose an opaque conversation anchor, but may not submit world lineage.",
      { ownerCharacterId: clean(ownerCharacterId), preboundLineage },
    );
  }
  const selection = decision.conversationAnchorSelection || {};
  const anchorHandle = clean(selection.anchorHandle);
  const mode = clean(selection.mode || "none");
  const targetParticipantHandle = clean(selection.targetParticipantHandle);
  const literalSpeech = clean(decision.speech || decision.utterance?.literalSpeech);
  const speechTargetHandle = clean(decision.speechTargetCharacterId);

  if (mode === "none") {
    if (anchorHandle || targetParticipantHandle) {
      throw fail(
        "TAVERN_V27_CONVERSATION_SELECTION_INCONSISTENT",
        "A none conversation selection may not carry an anchor or target.",
      );
    }
    decision.sourceActionId = "";
    decision.sourceThreadId = "";
    decision.responseToTurnId = "";
    decision.conversationLineageAuthority = literalSpeech
      ? "server-authorized-new-conversation-thread"
      : "server-authorized-no-conversation-lineage";
    output.rawDecision = decision;
    return output;
  }

  if (!literalSpeech) {
    throw fail(
      "TAVERN_V27_CONVERSATION_SELECTION_WITHOUT_SPEECH",
      "Only an actual public speech attempt may resolve a conversation anchor.",
    );
  }
  if (!anchorHandle || !targetParticipantHandle || !["reply", "continue"].includes(mode)) {
    throw fail(
      "TAVERN_V27_CONVERSATION_SELECTION_INCOMPLETE",
      "Conversation continuation requires one opaque anchor, allowed mode, and participant target.",
    );
  }
  if (!speechTargetHandle || speechTargetHandle !== targetParticipantHandle) {
    throw fail(
      "TAVERN_V27_CONVERSATION_SPEECH_TARGET_MISMATCH",
      "The selected conversation participant must be the actual intended speech target.",
      { speechTargetHandle, targetParticipantHandle },
    );
  }
  const resolution = resolveOwnedConversationAnchor({
    ownerCharacterId,
    conversationState,
    anchorHandle,
    mode,
    targetParticipantHandle,
  });
  decision.sourceActionId = "";
  decision.sourceThreadId = clean(resolution.lineageBinding?.sourceThreadId);
  decision.responseToTurnId = clean(resolution.lineageBinding?.responseToTurnId);
  decision.conversationLineageAuthority = clean(resolution.authority);
  output.rawDecision = decision;
  return output;
}

function canonicalizeTavernV27BridgeForWorld(bridge = {}, projection = {}) {
  const bindings = projection.recipientPrivateBindings || {};
  const characterIdFor = (value) => clean(bindings.characterIdByEntityHandle?.[clean(value)] || value);
  const objectIdFor = (value) => clean(bindings.objectIdByObjectHandle?.[clean(value)] || value);
  const output = clone(bridge || {});
  const decision = output.rawDecision || {};
  decision.targetCharacterId = characterIdFor(decision.targetCharacterId);
  decision.speechTargetCharacterId = characterIdFor(decision.speechTargetCharacterId);
  if (decision.actionAttempt) {
    decision.actionAttempt.targetCharacterId = characterIdFor(decision.actionAttempt.targetCharacterId);
    decision.actionAttempt.objectId = objectIdFor(decision.actionAttempt.objectId);
    const binding = decision.actionAttempt.actionBinding;
    if (binding?.kind === "character") binding.targetCharacterId = characterIdFor(binding.targetCharacterId);
    if (binding?.kind === "object") binding.objectId = objectIdFor(binding.objectId);
    if (binding?.kind === "affordance") {
      const affordanceHandle = clean(binding.affordanceId || decision.actionAttempt.affordanceId);
      const capabilityBinding = clone(bindings.affordanceBindingByHandle?.[affordanceHandle] || null);
      if (capabilityBinding) {
        output.serverWorldBinding = { capabilityBinding };
        binding.affordanceId = clean(capabilityBinding.canonicalAffordanceId);
        decision.actionAttempt.affordanceId = clean(capabilityBinding.canonicalAffordanceId);
      }
    }
  }
  if (decision.communicationPlan?.intendedAudienceCharacterIds) {
    decision.communicationPlan.intendedAudienceCharacterIds = decision.communicationPlan.intendedAudienceCharacterIds
      .map(characterIdFor)
      .filter(Boolean);
  }
  if (decision.sharedActivity?.participantIds) {
    decision.sharedActivity.participantIds = decision.sharedActivity.participantIds.map(characterIdFor).filter(Boolean);
  }
  output.rawDecision = decision;
  return output;
}

// The body is advanced under the conditions recorded at the previous beat
// (outdoors or in, the weather, a fire nearby): that is where the person spent
// the time in between. A beat may record the conditions it starts in.
function syncCharacterPrivatePhysiology(privateState = {}, targetWorldSeconds = 0, { nextExposure = undefined, vulnerability = 1 } = {}) {
  const prior = clone(privateState || {});
  const targetBoundary = Math.max(0, Number(targetWorldSeconds || 0));
  const recordedBoundary = Number(prior.physiologyState?.lastWorldSyncSeconds);
  const legacyElapsedSeconds = Math.max(0, Number(prior.ecologyState?.elapsedSeconds || 0));
  const previousBoundary = Number.isFinite(recordedBoundary)
    ? Math.max(0, recordedBoundary)
    : Math.min(targetBoundary, legacyElapsedSeconds);
  const synchronized = advanceCharacterPhysiologyTo({
    ecologyState: prior.ecologyState || {},
    lastWorldSyncSeconds: previousBoundary,
    targetWorldSeconds: Math.max(previousBoundary, targetBoundary),
    exposure: prior.physiologyState?.lastExposure || null,
    vulnerability,
  });
  const physiologyState = {
    ...clone(prior.physiologyState || {}),
    schemaVersion: "character-physiology-clock-v1",
    lastWorldSyncSeconds: synchronized.lastWorldSyncSeconds,
    ...(nextExposure !== undefined ? { lastExposure: clone(nextExposure) } : {}),
  };
  return {
    privateState: {
      ...prior,
      ecologyState: synchronized.ecologyState,
      physiologyState,
    },
    privateStatePatch: {
      ecologyState: synchronized.ecologyState,
      physiologyState,
    },
  };
}

function dayPlanningZoneHandles(projection = {}) {
  return unique([
    projection.place?.zoneId,
    ...(projection.reachableZones || []).map((row) => row?.id),
    ...(projection.actionFeasibilities || [])
      .filter((row) => clean(row?.bindingKind) === "place")
      .map((row) => row?.targetHandle),
  ]);
}

function considerDueDayPlanFromWake(privateState = {}, wake = {}, ownerCharacterId = "", nowSeconds = 0) {
  if (clean(wake.causeType || wake.kind) !== "plan_due") return null;
  const plannedIds = new Set((privateState.lifePlanState?.steps || [])
    .filter((row) => clean(row?.status) === "planned")
    .map((row) => clean(row?.planStepId))
    .filter(Boolean));
  const planStepId = (wake.planStepRefs || [])
    .map((row) => clean(row?.planStepId || row))
    .find((id) => plannedIds.has(id))
    || (wake.planStepIds || []).map(clean).find((id) => plannedIds.has(id));
  if (!planStepId) return null;
  return considerCharacterDayPlanStep({
    ownerCharacterId,
    lifePlanState: privateState.lifePlanState,
    planStepId,
    nowSeconds,
  });
}

function privateReducerEvidenceRecordsForTurn(canonicalInput = {}, turnContext = {}) {
  const rawByEvidenceId = new Map((turnContext.worldProjection?.evidence || []).flatMap((row) => {
    const evidenceId = clean(row?.evidenceId || (row?.deliveryId ? `evidence:${row.deliveryId}` : ""));
    return evidenceId ? [[evidenceId, row]] : [];
  }));
  return (canonicalInput.perceivedImpacts || []).map((row) => {
    const raw = rawByEvidenceId.get(clean(row?.evidenceId)) || {};
    return {
      ...clone(row),
      deliveryId: clean(raw.deliveryId || raw.id || row.evidenceId),
      recipientCharacterId: turnContext.characterId,
      eventKind: clean(row.actionKind || row.type || raw.eventKind),
      provenance: clone(raw.provenance || {}),
    };
  });
}

function createCharacterPort({
  characterRecord,
  runStage,
  onStageAccepted,
  onStageRejected,
  maxStageProtocolRepairs = 0,
  characterAgentCallMode = "standard",
  onExecutionCheckpoint,
  placeMap = {},
  nameForms = new Map(),
} = {}) {
  return createLocalCharacterRuntimePort({
    async runTurn(context, runtimeSession = {}) {
      const adapterState = runtimeSession.adapterState || {};
      let inFlight = adapterState.inFlightTurn;
      if (inFlight?.agentTurnId === context.agentTurnId) context = clone(inFlight.context);
      else {
        inFlight = { agentTurnId: context.agentTurnId, context: clone(context), executionCheckpoint: null };
        runtimeSession.updateAdapterState?.({ ...adapterState, inFlightTurn: inFlight });
        if (onExecutionCheckpoint) await onExecutionCheckpoint({ phase: "turn_context_prepared", agentTurnId: context.agentTurnId });
      }
      const nowSeconds = Math.max(0, Number(context.worldProjection?.nowSeconds || 0));
      const nextExposure = weatherExposure({
        zoneId: context.worldProjection?.place?.zoneId,
        sites: placeMap.sites || [],
        perceptionEnvironment: context.worldProjection?.materialFacts?.perceptionEnvironment,
        perceivedObjects: context.worldProjection?.perceivedObjects,
        floodedHere: (context.worldProjection?.perceivedConditions || []).some((row) => row.kind === "flood_here"),
      });
      const vulnerability = vulnerabilityOf({
        child: characterRecord.appearance?.child === true,
        age: characterRecord.age,
        body: context.privateContext?.ecologyState?.body || {},
      });
      const physiology = woundedPhysiology(syncCharacterPrivatePhysiology(context.privateContext, nowSeconds, { nextExposure, vulnerability }), context.worldProjection?.selfHealth, nowSeconds);
      const turnContext = {
        ...context,
        privateContext: physiology.privateState,
      };
      // The body before the mind: collapsing, coming round, dying or lying unconscious is not a decision.
      const bodyBeat = runBodyBeat({ turnContext, physiology, nowSeconds });
      if (bodyBeat) return bodyBeat;

      const wakeKind = clean(turnContext.wake?.causeType || turnContext.wake?.kind);
      const executionOptions = { checkpoint: inFlight.executionCheckpoint, schemaForInput: tavernCharacterAgentV2OutputSchemaForStage,
        async onCheckpoint(executionCheckpoint) {
          inFlight = { ...inFlight, executionCheckpoint };
          runtimeSession.updateAdapterState?.({ ...adapterState, inFlightTurn: inFlight });
          if (onExecutionCheckpoint) await onExecutionCheckpoint({ phase: executionCheckpoint.status, agentTurnId: context.agentTurnId, auditRecord: characterExecutionAuditRecord(executionCheckpoint) });
        } };
      const beatMode = characterAgentCallMode === "performance" || characterAgentCallMode === "hybrid";
      if (wakeKind === "day_planning_due" && beatMode && placeMap.sites?.length) {
        return runScheduleBeat({ turnContext, characterRecord, physiology, runStage, onStageAccepted, onStageRejected, maxStageProtocolRepairs, placeMap, nowSeconds });
      }
      if (wakeKind === "day_planning_due") {
        const planningPrivateState = {
          ...turnContext.privateContext,
          currentResponsibilities: buildCurrentResponsibilitySurface({
            privateState: turnContext.privateContext,
            projection: turnContext.worldProjection,
          }),
        };
        const planningTurn = await runCharacterDayPlanningTurn({
          executionOptions,
          ownerCharacterId: turnContext.characterId,
          agentTurnId: turnContext.agentTurnId,
          privateState: planningPrivateState,
          nowSeconds,
          availableZoneHandles: dayPlanningZoneHandles(turnContext.worldProjection),
          timePolicy: turnContext.worldProjection.timePolicy || characterTimePolicy(),
          temporalContext: turnContext.worldProjection.temporalContext,
          runStage,
          onStageAccepted,
          onStageRejected,
          maxStageProtocolRepairs,
        });
        return {
          characterId: turnContext.characterId,
          agentTurnId: turnContext.agentTurnId,
          privateStatePatch: {
            ...physiology.privateStatePatch,
            ...planningTurn.privateStatePatch,
          },
          actionAttempt: null,
          privateResult: {
            turnKind: "day_planning",
            submissionMode: "day_planning",
            executionMode: "private-day-planning",
            dayPlanningCompleted: true,
            stages: clone(planningTurn.stages || []),
            acceptedStageHistory: [{ stage: "character_day_planning_accepted" }],
          },
        };
      }
      if (wakeKind === "reflection_due" && !beatMode) {
        const reflectionTurn = await runCharacterReflectionTurn({
          executionOptions,
          ownerCharacterId: turnContext.characterId,
          agentTurnId: turnContext.agentTurnId,
          privateState: turnContext.privateContext,
          pendingOpportunity: turnContext.privateContext?.reflectionState?.pendingOpportunity || null,
          nowSeconds,
          runStage,
          onStageAccepted,
          onStageRejected,
          maxStageProtocolRepairs,
        });
        return {
          characterId: turnContext.characterId,
          agentTurnId: turnContext.agentTurnId,
          privateStatePatch: {
            ...physiology.privateStatePatch,
            ...reflectionTurn.privateStatePatch,
          },
          actionAttempt: null,
          privateResult: {
            turnKind: "reflection",
            submissionMode: "reflection",
            executionMode: "private-reflection",
            reflectionCompleted: true,
            stages: clone(reflectionTurn.stages || []),
            acceptedStageHistory: [{ stage: "character_reflection_accepted" }],
          },
        };
      }
      if (beatMode && placeMap.sites?.length) {
        // The day a written schedule covered is over (a night's sleep ran out at
        // 05:00): with nothing new to answer, the next schedule comes first.
        const writtenPlan = turnContext.privateContext?.lifePlanState;
        const quietWake = !(turnContext.wake?.evidenceIds || []).length && !(turnContext.wake?.evidence || []).length;
        if (quietWake && writtenPlan?.source === "day_schedule" && Number(writtenPlan.horizonEndsAtSeconds) <= nowSeconds) {
          return runScheduleBeat({ turnContext, characterRecord, physiology, runStage, onStageAccepted, onStageRejected, maxStageProtocolRepairs, placeMap, nowSeconds });
        }
        const own = runOwnPlanStep({ turnContext, characterRecord, physiology, placeMap, nowSeconds });
        if (own && !own.handover) return own;
        if (own?.handover) {
          // The plan step is finished; the character takes this beat for themselves.
          const handed = { ...turnContext, privateContext: { ...turnContext.privateContext, lifePlanState: own.handover } };
          const result = await runPerformanceBeat({ turnContext: handed, characterRecord, physiology, runStage, onStageAccepted, onStageRejected, maxStageProtocolRepairs, placeMap, nameForms,
            reconsider: wakeKind === "reflection_due" ? turnContext.privateContext?.reflectionState?.pendingOpportunity || null : null,
            hybrid: characterAgentCallMode === "hybrid" });
          return { ...result, privateStatePatch: { lifePlanState: own.handover, ...result.privateStatePatch } };
        }
      }
      if (beatMode) {
        // A due reflection or execution review becomes a beat in which the
        // character is asked to stop and reconsider; they still act for themselves.
        return runPerformanceBeat({ turnContext, characterRecord, physiology, runStage, onStageAccepted, onStageRejected, maxStageProtocolRepairs, placeMap, nameForms,
          reconsider: wakeKind === "reflection_due" ? turnContext.privateContext?.reflectionState?.pendingOpportunity || null : null,
          hybrid: characterAgentCallMode === "hybrid" });
      }
      const canonicalInput = {
        ...buildTavernCharacterAgentInputV27(turnContext, characterRecord),
        // v2.7 keeps the private choice/math-tool exchange, then lets the same
        // Character Agent commit action and speech holistically. Legacy scene
        // pipelines may continue to request staged expression explicitly.
        submissionMode: "atomic",
      };
      const privateReducerEvidenceRecords = privateReducerEvidenceRecordsForTurn(canonicalInput, turnContext);
      const result = await runTavernCharacterAgentTurnV2(canonicalInput, {
        runStage,
        onStageAccepted,
        onStageRejected,
        maxStageProtocolRepairs,
        characterAgentCallMode,
        executionCheckpoint: inFlight.executionCheckpoint,
        async onExecutionCheckpoint(executionCheckpoint) {
          inFlight = { ...inFlight, executionCheckpoint };
          runtimeSession.updateAdapterState?.({ ...adapterState, inFlightTurn: inFlight });
          if (onExecutionCheckpoint) await onExecutionCheckpoint({ phase: executionCheckpoint.status, agentTurnId: context.agentTurnId, auditRecord: characterExecutionAuditRecord(executionCheckpoint) });
        },
      });
      const characterBridge = bridgeTavernCharacterAgentV2ResultForWorld(result, canonicalInput);
      const privateTransition = reduceCharacterPrivateTurn({
        ownerCharacterId: turnContext.characterId,
        previousPrivateState: turnContext.privateContext,
        acceptedSession: result.session,
        ownedEvidenceRecords: privateReducerEvidenceRecords,
        ownedParticipantHandleByCharacterId: clone(
          turnContext.worldProjection?.recipientPrivateBindings?.entityHandleByCanonicalId || {},
        ),
        nowSeconds,
        relationshipPolicy: {
          metricIds: TAVERN_RELATIONSHIP_METRICS,
          deltaByStrength: { low: 1, medium: 3, high: 6 },
        },
      });
      const conversationResolvedBridge = resolveTavernV27ConversationSelectionForWorld({
        bridge: characterBridge,
        ownerCharacterId: turnContext.characterId,
        conversationState: privateTransition.privateStatePatch.conversationState
          || turnContext.privateContext?.conversationState
          || null,
      });
      const bridge = canonicalizeTavernV27BridgeForWorld(
        conversationResolvedBridge,
        context.worldProjection,
      );
      const actionAttempt = lowerTavernV27WorldAttempt(bridge);
      if (actionAttempt) {
        actionAttempt.attemptId = `action-attempt:${turnContext.agentTurnId}`;
        if (clean(actionAttempt.payload?.utterance)) {
          actionAttempt.payload.provenance = {
            ...clone(actionAttempt.payload.provenance || {}),
            sourceActionId: actionAttempt.attemptId,
            sourceThreadId: clean(actionAttempt.payload.provenance?.sourceThreadId)
              || `live_thread:${actionAttempt.attemptId}`,
            responseToTurnId: clean(actionAttempt.payload.provenance?.responseToTurnId),
          };
        }
      }
      const dayPlanConsideration = considerDueDayPlanFromWake(
        turnContext.privateContext,
        turnContext.wake,
        turnContext.characterId,
        nowSeconds,
      );
      return {
        characterId: turnContext.characterId,
        agentTurnId: turnContext.agentTurnId,
        privateStatePatch: {
          ...physiology.privateStatePatch,
          ...privateTransition.privateStatePatch,
          ...(dayPlanConsideration ? { lifePlanState: dayPlanConsideration.lifePlanState } : {}),
        },
        actionAttempt,
        privateResult: {
          protocolVersion: result.protocolVersion,
          submissionMode: clean(result.session?.submissionMode || canonicalInput.submissionMode || "staged"),
          executionMode: clean(result.executionMode),
          protocolRepairAttempts: Math.max(0, Number(result.protocolRepairAttempts || 0)),
          stages: clone(result.stages || []),
          acceptedStageHistory: clone(result.session?.history || []),
          evidenceReceiptSettlement: clone(privateTransition.receiptTransitions),
          evidencePresentation: {
            presentedEvidenceIds: unique((canonicalInput.perceivedImpacts || []).map(row => row.evidenceId)),
            expiredEvidenceIds: unique((context.wake?.evidence || []).filter(row => {
              const id = clean(row.evidenceId);
              return id && !(canonicalInput.perceivedImpacts || []).some(presented => clean(presented.evidenceId) === id)
                && !(canonicalInput.perceptionFrame?.deferredEvidenceIds || []).includes(id)
                && clean(row.eventKind) !== "own_action_result";
            }).map(row => row.evidenceId)),
            expirationReason: "not_presented_during_transient_perception",
          },
          privateTransitionDiagnostics: clone(privateTransition.diagnostics),
          dayPlanConsideration: clone(dayPlanConsideration?.consideration || null),
          decision: clone(result.decision || {}),
          agentChoice: clone(result.session?.agentChoice || {}),
          worldBridge: {
            rawDecision: clone(bridge.rawDecision || {}),
            selectedCandidate: clone(bridge.selectedCandidate || null),
            selectedEvaluation: clone(bridge.selectedEvaluation || null),
          },
        },
      };
    },
    async applyWorldOutcome(outcome, { characterId, privateContext } = {}) {
      const previousWorldTime = Math.max(0, Number(
        privateContext?.physiologyState?.lastWorldSyncSeconds
        ?? privateContext?.ecologyState?.characterPsychologyV2State?.lastCharacterElapsedSeconds
        ?? 0,
      ));
      const explicitOutcomeTime = Number(outcome.occurredAtSeconds);
      const outcomeTime = Number.isFinite(explicitOutcomeTime)
        ? Math.max(previousWorldTime, explicitOutcomeTime)
        : previousWorldTime + Math.max(0, Number(outcome.durationSeconds || 0));
      const physiology = syncCharacterPrivatePhysiology(privateContext, outcomeTime, { vulnerability: vulnerabilityOf({
        child: characterRecord?.appearance?.child === true,
        age: characterRecord?.age,
        body: privateContext?.ecologyState?.body || {},
      }) });
      const privateTransition = reduceCharacterPrivateWorldOutcome({
        ownerCharacterId: clean(characterId || characterRecord?.id),
        previousPrivateState: physiology.privateState,
        worldOutcome: outcome,
        nowSeconds: outcomeTime,
      });
      return {
        idempotent: privateTransition.idempotent,
        privateStatePatch: {
          ...physiology.privateStatePatch,
          ...privateTransition.privateStatePatch,
        },
        privateResult: {
          privateOutcomeTransitionId: privateTransition.transitionId,
          privateOutcomeDiagnostics: clone(privateTransition.diagnostics || {}),
        },
      };
    },
  });
}

/**
 * Performance mode: one model call per beat with a compact, prose-first
 * context. The world settles the resulting attempt exactly as in the staged
 * protocol; a malformed answer is repaired by the same character or the
 * character is suspended — nothing is substituted.
 */
/** Zone names and walkable edges of a place, for the performance prompt's map. */
function placeMapFor(place = {}) {
  const topology = place?.topology || {};
  return {
    zoneLabels: Object.fromEntries(Object.entries(topology.zones || {}).map(([id, zone]) => [id, clean(zone?.label || id)])),
    zoneEdges: (topology.edges || []).map((edge) => [clean(edge.from), clean(edge.to)]).filter(([from, to]) => from && to),
    ...(Array.isArray(place?.sites) ? {
      sites: clone(place.sites),
      startClock: clean(place.startClock),
      work: (place.institution?.workOrderTemplates || []).map((row) => ({ templateId: clean(row.templateId), taskLabel: clean(row.taskLabel), zoneId: clean(row.zoneId),
        requiredSkillIds: [...(row.requiredSkillIds || [])], durationSecondsPerUnit: Number(row.durationSecondsPerUnit || 60) })),
    } : {}),
  };
}

async function runPerformanceBeat({ turnContext: givenContext, characterRecord, physiology, runStage, onStageAccepted, onStageRejected, maxStageProtocolRepairs, placeMap = {}, nameForms = new Map(), reconsider = null, hybrid = false }) {
  let turnContext = givenContext;
  const innerLedger = hybrid ? (turnContext.privateContext?.innerLedger || emptyInnerLedger()) : null;
  let canonicalInput = buildTavernCharacterAgentInputV27(turnContext, characterRecord);
  // A stranger's name is learned by hearing it said in front of them.
  const worldIdOf = (handle) => clean(turnContext.worldProjection?.recipientPrivateBindings?.characterIdByEntityHandle?.[clean(handle)]);
  const heardTurns = (canonicalInput.discourseContext?.recentPublicTurns || [])
    .map((row) => ({ speakerId: worldIdOf(row.speakerId), utterance: clean(row.utterance) }))
    .filter((row) => row.speakerId && row.speakerId !== clean(turnContext.characterId));
  const seen = (canonicalInput.perceivedCharacters || []).map((row) => ({ id: worldIdOf(row.entityHandle || row.id), known: row.identityKnown === true }))
    .filter((row) => row.id);
  const newlyLearned = learnNamesFromTurns({ turns: heardTurns, visibleIds: seen.map((row) => row.id), formsById: nameForms,
    knownIds: seen.filter((row) => row.known).map((row) => row.id), learned: turnContext.privateContext?.learnedNames || [] });
  const learnedNames = newlyLearned.length ? [...(turnContext.privateContext?.learnedNames || []),
    ...newlyLearned.map((row) => ({ ...row, learnedAtSeconds: Math.max(0, Number(turnContext.worldProjection?.nowSeconds || 0)) }))] : null;
  if (learnedNames) {
    turnContext = { ...turnContext, privateContext: { ...turnContext.privateContext, learnedNames } };
    canonicalInput = buildTavernCharacterAgentInputV27(turnContext, characterRecord);
  }
  // A marriage the world has settled is known to both: each now holds the other as husband or wife.
  const married = rememberMarriage(turnContext.privateContext?.relationshipContext || [], turnContext.characterId,
    turnContext.worldProjection?.marriage?.spouse, Math.max(0, Number(turnContext.worldProjection?.nowSeconds || 0)));
  if (married) {
    turnContext = { ...turnContext, privateContext: { ...turnContext.privateContext, relationshipContext: married } };
    canonicalInput = buildTavernCharacterAgentInputV27(turnContext, characterRecord);
  }
  // Whoever really dealt with them since their last beat: met, marked, or owed.
  const grown = growBonds(turnContext.privateContext?.relationshipContext || [], {
    ownerId: turnContext.characterId,
    impacts: canonicalInput.perceivedImpacts || [],
    people: (canonicalInput.perceivedCharacters || []).filter((row) => row.identityKnown === true)
      .map((row) => ({ id: clean(row.recognizedIdentity?.characterId), name: clean(row.name) })),
    applied: turnContext.privateContext?.bondEvidenceIds || [],
    nowSeconds: Math.max(0, Number(turnContext.worldProjection?.nowSeconds || 0)),
  });
  turnContext = { ...turnContext, privateContext: { ...turnContext.privateContext, bondEvidenceIds: grown.applied,
    ...(grown.changed ? { relationshipContext: grown.rows } : {}) } };
  if (grown.changed) canonicalInput = buildTavernCharacterAgentInputV27(turnContext, characterRecord);
  // What has worn on them since their last beat, and how it sits with a body in want.
  const temperNowSeconds = Math.max(0, Number(turnContext.worldProjection?.nowSeconds || 0));
  const temper = updateTemper(turnContext.privateContext?.temper, {
    impacts: canonicalInput.perceivedImpacts || [],
    nowSeconds: temperNowSeconds,
    nameOf: (id) => clean((canonicalInput.perceivedCharacters || []).find((row) => clean(row.recognizedIdentity?.characterId) === clean(id))?.name),
  });
  turnContext = { ...turnContext, privateContext: { ...turnContext.privateContext, temper } };
  canonicalInput = { ...canonicalInput, temperLines: temperLines(temper, {
    body: turnContext.privateContext?.ecologyState?.body || {}, sleepiness: Number(canonicalInput.sleepiness || 0), nowSeconds: temperNowSeconds }) };
  // The names of things once seen, so "看了看水缸" still reads so after walking away.
  const objectLabels = { ...(turnContext.privateContext?.seenObjectLabels || {}) };
  for (const row of canonicalInput.perceivedObjects || []) if (clean(row.id) && clean(row.label) && !clean(row.holderEntityHandle)) objectLabels[clean(row.id)] = clean(row.label);
  const seenObjectLabels = Object.fromEntries(Object.entries(objectLabels).slice(-80));
  const { stageInput, table } = buildPerformanceStage({ canonicalInput, projection: turnContext.worldProjection, characterRecord, objectLabels: seenObjectLabels,
    wake: turnContext.wake, clockLabel: clean(turnContext.worldProjection?.place?.clockLabel), zoneLabels: placeMap.zoneLabels, zoneEdges: placeMap.zoneEdges,
    sites: placeMap.sites || [], knownSiteIds: characterRecord.knownSiteIds || [],
    reconsiderNote: reconsider ? clean(reconsider.executionReviewReason) || "停下来想一想这一阵子的事，再决定接下来怎么做。" : "",
    hybrid: hybrid ? { ledger: innerLedger, reconsider: Boolean(reconsider) } : null });
  const maxCalls = 1 + Math.max(0, Number(maxStageProtocolRepairs || 0));
  let output = null, issues = [], calls = 0;
  while (calls < maxCalls) {
    calls += 1;
    const input = issues.length ? { ...stageInput, protocolRepairFeedback: { issues } } : stageInput;
    try {
      const result = await runStage(input);
      output = result?.performance ?? result?.output ?? null;
      issues = validatePerformanceOutput(output, table);
    } catch (error) {
      if (error.code !== "CHARACTER_STAGE_OUTPUT_INVALID") throw error;
      issues = error.issues?.length ? error.issues : [{ code: "PERFORMANCE_OUTPUT_INVALID", path: "output", message: "返回一个完整合法的 JSON 对象。" }];
    }
    if (!issues.length) { await onStageAccepted?.({ phase: PERFORMANCE_PHASE, characterId: turnContext.characterId, agentTurnId: turnContext.agentTurnId }); break; }
    await onStageRejected?.({ phase: PERFORMANCE_PHASE, characterId: turnContext.characterId, agentTurnId: turnContext.agentTurnId, issues });
  }
  if (issues.length) {
    throw Object.assign(new Error("This beat exhausted its repair budget. No substitute decision was made."), { code: "CHARACTER_MODEL_SUSPENDED", issues });
  }
  const lowered = lowerPerformanceOutput(output, table);
  const actionAttempt = { ...lowered, attemptId: `action-attempt:${turnContext.agentTurnId}` };
  if (clean(actionAttempt.payload?.utterance)) {
    actionAttempt.payload.provenance = { sourceActionId: actionAttempt.attemptId, sourceThreadId: `live_thread:${actionAttempt.attemptId}`, responseToTurnId: "" };
  }
  const nowSeconds = Math.max(0, Number(turnContext.worldProjection?.nowSeconds || 0));
  const inner = hybrid ? applyInnerChanges(innerLedger, output.inner, table, { nowSeconds }) : null;
  // What they wrote down about someone this beat stays with that bond.
  // A feeling's person is the one the ledger now holds it about.
  const noted = inner ? noteBonds(turnContext.privateContext?.relationshipContext || [], { ownerId: turnContext.characterId, nowSeconds,
    notes: inner.changes.map((change) => ({ ...change, aboutId: change.aboutId || inner.ledger.feelings.find((row) => row.aboutName === change.aboutName && row.text === change.text)?.aboutId || "" })) }) : null;
  const thought = clean(output.thought);
  const privateTransition = reduceCharacterPerformanceTurn({
    ownerCharacterId: turnContext.characterId,
    previousPrivateState: turnContext.privateContext,
    agentTurnId: turnContext.agentTurnId,
    ownedEvidenceRecords: privateReducerEvidenceRecordsForTurn(canonicalInput, turnContext),
    actionAttempt,
    thought: performanceIntention(output, table),
    ownedParticipantHandleByCharacterId: clone(turnContext.worldProjection?.recipientPrivateBindings?.entityHandleByCanonicalId || {}),
    nowSeconds,
  });
  const dayPlanConsideration = considerDueDayPlanFromWake(turnContext.privateContext, turnContext.wake, turnContext.characterId, nowSeconds);
  // The reconsideration opportunity is settled by this beat; no insight is
  // written on the character's behalf.
  const reflectionSettlement = reconsider?.opportunityId ? settleCharacterReflectionOpportunity({
    ownerCharacterId: turnContext.characterId,
    memoryState: privateTransition.privateStatePatch.memoryContext,
    reflectionState: turnContext.privateContext?.reflectionState || {},
    opportunityId: reconsider.opportunityId,
    submission: { ownerAuthority: "character-agent", insights: [] },
    nowSeconds,
  }) : null;
  const ecologyState = clone(physiology.privateStatePatch.ecologyState || turnContext.privateContext?.ecologyState || {});
  const chosenZone = clean(output.do?.type) === "move" ? table.zones.find((row) => row.id === clean(output.do?.target)) : null;
  const walkTarget = placeMap.sites?.length && chosenZone && chosenZone.path?.length > 1 ? clean(chosenZone.path.at(-1)) : "";
  ecologyState.characterPsychologyV2State = {
    ...(ecologyState.characterPsychologyV2State || {}),
    continuationIntentions: performanceContinuations(actionAttempt, turnContext.agentTurnId, nowSeconds, walkTarget),
  };
  const finalRelationshipContext = noted?.changed
    ? noted.rows
    : (grown.changed || married)
      ? turnContext.privateContext.relationshipContext
      : null;
  return {
    characterId: turnContext.characterId,
    agentTurnId: turnContext.agentTurnId,
    privateStatePatch: {
      ...physiology.privateStatePatch,
      ...privateTransition.privateStatePatch,
      ecologyState,
      ...(reflectionSettlement ? { memoryContext: reflectionSettlement.memoryState, reflectionState: reflectionSettlement.reflectionState } : {}),
      ...(dayPlanConsideration ? { lifePlanState: dayPlanConsideration.lifePlanState } : {}),
      ...(inner ? { innerLedger: inner.ledger } : {}),
      ...(learnedNames ? { learnedNames } : {}),
      ...(finalRelationshipContext ? { relationshipContext: finalRelationshipContext } : {}),
      bondEvidenceIds: turnContext.privateContext.bondEvidenceIds,
      temper,
      seenObjectLabels,
    },
    actionAttempt,
    privateResult: {
      protocolVersion: PERFORMANCE_PROTOCOL_VERSION,
      turnKind: "action",
      submissionMode: "performance",
      executionMode: hybrid ? "hybrid-beat" : "performance-beat",
      body: bodyLines(ecologyState.body || {}),
      ...(inner?.changes.length ? { innerChanges: inner.changes } : {}),
      ...(reflectionSettlement ? { reflectionCompleted: true } : {}),
      protocolRepairAttempts: calls - 1,
      stages: [{ name: `performance:${PERFORMANCE_PHASE}` }],
      acceptedStageHistory: [{ stage: "performance_beat_accepted" }],
      evidenceReceiptSettlement: clone(privateTransition.receiptTransitions),
      evidencePresentation: {
        presentedEvidenceIds: unique((canonicalInput.perceivedImpacts || []).map((row) => row.evidenceId)),
        expiredEvidenceIds: unique((turnContext.wake?.evidence || []).filter((row) => {
          const id = clean(row.evidenceId);
          return id && !(canonicalInput.perceivedImpacts || []).some((presented) => clean(presented.evidenceId) === id)
            && !(canonicalInput.perceptionFrame?.deferredEvidenceIds || []).includes(id)
            && clean(row.eventKind) !== "own_action_result";
        }).map((row) => row.evidenceId)),
        expirationReason: "not_presented_during_transient_perception",
      },
      decision: { privateDecisionBasis: thought, performance: clone(output) },
      worldBridge: { rawDecision: { speech: clean(output.say?.text), visibleAction: clean(output.gesture), targetCharacterId: clean(actionAttempt.payload?.speechTargetCharacterId) },
        selectedCandidate: { intention: thought }, selectedEvaluation: null },
    },
  };
}

/**
 * The world carries out the next step of a town resident's own plan — a hop
 * of a walk they chose or wrote down, starting the job they planned, or
 * settling in to rest or sleep — while nothing new has reached them. No model
 * call; the turn is recorded as theirs ("按自己的日程"). Returns null when the
 * character should take a real beat, or { handover } when their plan step is
 * finished and the beat goes back to them.
 */
function runOwnPlanStep({ turnContext, characterRecord, physiology, placeMap = {}, nowSeconds = 0 }) {
  const privateContext = turnContext.privateContext || {};
  const canonicalInput = buildTavernCharacterAgentInputV27(turnContext, characterRecord);
  const { table } = buildPerformanceStage({ canonicalInput, projection: turnContext.worldProjection, characterRecord, wake: turnContext.wake,
    zoneLabels: placeMap.zoneLabels, zoneEdges: placeMap.zoneEdges, sites: placeMap.sites || [], knownSiteIds: characterRecord.knownSiteIds || [] });
  const ecologyState = clone(physiology.privateStatePatch.ecologyState || privateContext.ecologyState || {});
  const writtenPlan = closeEndedPlanSteps(privateContext.lifePlanState, nowSeconds);
  const decision = ownPlanStepDecision({
    wake: turnContext.wake,
    lifePlanState: writtenPlan,
    continuationIntentions: ecologyState.characterPsychologyV2State?.continuationIntentions || [],
    hereZoneId: clean(canonicalInput.scene?.zoneId),
    zoneEdges: placeMap.zoneEdges || [],
    deadlines: canonicalInput.temporalContext?.deadlines || [],
    recentTurns: canonicalInput.discourseContext?.recentPublicTurns || [],
    selfId: turnContext.characterId,
    nowSeconds,
    startableWorkTemplateIds: table.work.filter((row) => row.operation === "start_work_unit" && row.executable).map((row) => row.templateId),
  });
  if (!decision) return null;
  if (decision.kind === "handover") return { handover: markPlanStep(writtenPlan, decision.step.planStepId, "done", nowSeconds) };
  let lifePlanState = writtenPlan;
  let attempt;
  const continuations = [];
  if (decision.kind === "walk") {
    attempt = { primitive: "move", payload: { ...silentPayload(), destinationId: decision.nextHop, positionId: "" } };
    if (decision.step) lifePlanState = markPlanStep(lifePlanState, decision.step.planStepId, "in_progress", nowSeconds);
    continuations.push(walkContinuation(decision, nowSeconds));
  } else if (decision.kind === "start_work") {
    const row = table.work.find((w) => w.operation === "start_work_unit" && w.executable && w.templateId === decision.step.activity.workTemplateId);
    attempt = lowerPerformanceOutput({ thought: "", say: { to: "", text: "", loud: false }, do: { type: "work", target: row.key, person: "", minutes: 0 }, gesture: "" }, table);
    lifePlanState = markPlanStep(lifePlanState, decision.step.planStepId, "done", nowSeconds);
  } else {
    attempt = { primitive: "wait", payload: { ...silentPayload(), targetCharacterId: "",
      waitCondition: { condition: "new_evidence", maximumSeconds: decision.waitSeconds, interruptOnDirectSpeech: true } } };
    // The block stays under way until its end: when a wait runs out early,
    // the resident settles in again rather than losing the block.
    lifePlanState = markPlanStep(lifePlanState, decision.step.planStepId, "in_progress", nowSeconds);
  }
  ecologyState.characterPsychologyV2State = { ...(ecologyState.characterPsychologyV2State || {}), continuationIntentions: continuations };
  const step = decision.step || null;
  const purpose = `按自己的打算：${step ? clean(step.privatePurpose) : "接着走自己选的路"}`;
  const actionAttempt = { ...attempt, attemptId: `action-attempt:${turnContext.agentTurnId}` };
  // Register the attempt in the character's private state exactly as a beat
  // does, so the world's outcome finds its pending attempt when it returns.
  const privateTransition = reduceCharacterPerformanceTurn({
    ownerCharacterId: turnContext.characterId,
    previousPrivateState: privateContext,
    agentTurnId: turnContext.agentTurnId,
    ownedEvidenceRecords: [],
    actionAttempt,
    thought: purpose,
    ownedParticipantHandleByCharacterId: clone(turnContext.worldProjection?.recipientPrivateBindings?.entityHandleByCanonicalId || {}),
    nowSeconds,
  });
  return {
    characterId: turnContext.characterId,
    agentTurnId: turnContext.agentTurnId,
    privateStatePatch: { ...physiology.privateStatePatch, ...privateTransition.privateStatePatch, ecologyState, ...(lifePlanState ? { lifePlanState } : {}) },
    actionAttempt,
    privateResult: {
      protocolVersion: OWN_PLAN_STEP_VERSION,
      turnKind: OWN_PLAN_STEP_TURN_KIND,
      submissionMode: OWN_PLAN_STEP_TURN_KIND,
      executionMode: "world-follows-own-plan",
      stages: [],
      acceptedStageHistory: [{ stage: "own_plan_step" }],
      ownPlanStep: { source: decision.source || "day_schedule", kind: decision.kind, planStepId: clean(step?.planStepId), siteId: clean(step?.siteId), target: clean(decision.target) },
      evidenceReceiptSettlement: clone(privateTransition.receiptTransitions),
      decision: { privateDecisionBasis: purpose },
    },
  };
}

/**
 * A town resident's day-schedule beat: one call, validated and repaired by
 * the same character, written into their private life plan. Nothing is
 * substituted if the character cannot produce a valid schedule.
 */
async function runScheduleBeat({ turnContext, characterRecord, physiology, runStage, onStageAccepted, onStageRejected, maxStageProtocolRepairs, placeMap = {}, nowSeconds = 0 }) {
  const canonicalInput = buildTavernCharacterAgentInputV27(turnContext, characterRecord);
  const { stageInput, table } = buildScheduleStage({ characterRecord, canonicalInput, sites: placeMap.sites || [], knownSiteIds: characterRecord.knownSiteIds || [],
    work: placeMap.work || [], startClockSeconds: parseClock(placeMap.startClock) ?? 0, nowSeconds });
  const maxCalls = 1 + Math.max(0, Number(maxStageProtocolRepairs || 0));
  let output = null, issues = [], calls = 0;
  while (calls < maxCalls) {
    calls += 1;
    const input = issues.length ? { ...stageInput, protocolRepairFeedback: { issues } } : stageInput;
    try {
      const result = await runStage(input);
      output = result?.schedule ?? result?.output ?? null;
      issues = validateScheduleOutput(output, table);
    } catch (error) {
      if (error.code !== "CHARACTER_STAGE_OUTPUT_INVALID") throw error;
      issues = error.issues?.length ? error.issues : [{ code: "SCHEDULE_OUTPUT_INVALID", path: "output", message: "返回一个完整合法的 JSON 对象。" }];
    }
    if (!issues.length) { await onStageAccepted?.({ phase: SCHEDULE_PHASE, characterId: turnContext.characterId, agentTurnId: turnContext.agentTurnId }); break; }
    await onStageRejected?.({ phase: SCHEDULE_PHASE, characterId: turnContext.characterId, agentTurnId: turnContext.agentTurnId, issues });
  }
  if (issues.length) {
    throw Object.assign(new Error("This schedule exhausted its repair budget. No substitute schedule was written."), { code: "CHARACTER_MODEL_SUSPENDED", issues });
  }
  const previous = turnContext.privateContext?.lifePlanState || null;
  const lifePlanState = lowerScheduleOutput(output, table, {
    ownerCharacterId: turnContext.characterId,
    agentTurnId: turnContext.agentTurnId,
    previousRevision: clean(previous?.ownerCharacterId) === clean(turnContext.characterId) ? previous.revision : 0,
    dayIndex: Number.isFinite(Number(turnContext.wake?.dayIndex)) ? Number(turnContext.wake.dayIndex) : Math.floor(nowSeconds / 86400),
  });
  return {
    characterId: turnContext.characterId,
    agentTurnId: turnContext.agentTurnId,
    privateStatePatch: { ...physiology.privateStatePatch, lifePlanState },
    actionAttempt: null,
    privateResult: {
      protocolVersion: SCHEDULE_PROTOCOL_VERSION,
      turnKind: "day_planning",
      submissionMode: "day_planning",
      executionMode: "performance-day-schedule",
      dayPlanningCompleted: true,
      protocolRepairAttempts: calls - 1,
      stages: [{ name: `schedule:${SCHEDULE_PHASE}` }],
      acceptedStageHistory: [{ stage: "day_schedule_accepted" }],
      decision: { privateDecisionBasis: clean(output.thought).slice(0, 160), schedule: clone(output) },
    },
  };
}

function unsupportedPrimitiveResolver({ state, attempt }) {
  const actor = state.entities?.[attempt.actorId];
  return {
    authority: "world-action-registry",
    primitive: attempt.primitive,
    status: "failed",
    attemptSurface: [{
      kind: "unmigrated_action_attempted",
      actorId: attempt.actorId,
      primitive: attempt.primitive,
      visibleAction: clean(attempt.payload?.visibleAction),
    }],
    intendedEffects: [],
    resolvedEffects: [],
    failedEffects: [{ code: "ACTION_PRIMITIVE_NOT_YET_MIGRATED", primitive: attempt.primitive }],
    incidentalEffects: [],
    committedFacts: [{
      kind: "unmigrated_action_attempted",
      actorId: attempt.actorId,
      primitive: attempt.primitive,
      placeId: clean(actor?.placeId),
      zoneId: clean(actor?.zoneId),
      visibleAction: clean(attempt.payload?.visibleAction),
    }],
    deliveries: [],
    durationSeconds: 1,
    statePatch: { operations: [] },
  };
}

function tavernActionRegistry() {
  const registry = createWorldActionRegistry();
  // Unknown historical primitives remain explicit failed attempts. The
  // Character protocol no longer lowers free-form `act` into a gesture.
  registry.register("act", unsupportedPrimitiveResolver);
  registry.register("use_affordance", (context) => TAVERN_CAPABILITY_REGISTRY.settle(context));
  return registry;
}

export function createTavernWorldRuntimeV27(state = {}, {
  worldPack = XIAOYAOYOU_WORLD_PACK,
  characterIds,
  positions = {},
  worldId = worldPack.stage.defaultWorldId || `world:${worldPack.meta.id}:v27`,
  checkpoint = null,
  enableDayPlanning = false,
  pacingMode,
  openingAfterSeconds = 900,
  runStage = runTavernCharacterAgentV2Stage,
  onStageAccepted,
  onStageRejected,
  maxStageProtocolRepairs = 2,
  characterAgentCallMode = "three-call",
  onExecutionCheckpoint,
} = {}) {
  const mode = checkpoint?.coordinator?.worldState?.timePolicy?.mode || pacingMode || "day";
  const ids = unique(checkpoint?.actors?.map(row => row.characterId) || characterIds
    || (mode === "scene" ? worldPack.stage.sceneCast : worldPack.stage.dayCast || TAVERN_V27_DEFAULT_CHARACTER_IDS));
  const initialPositions = mode === "scene" ? { ...(worldPack.stage.scenePositions || {}), ...positions } : positions;
  if (!ids.length) throw fail("TAVERN_V27_CHARACTERS_REQUIRED", "Tavern v2.7 requires at least one character.");
  const worldState = buildTavernWorldStateV27(state, { worldPack, characterIds: ids, positions: initialPositions, worldId, pacingMode: mode, openingAfterSeconds });
  const coordinator = createWorldCommitCoordinator({
    worldId,
    initialWorldState: worldState,
    actionRegistry: tavernActionRegistry(),
    checkpoint: checkpoint?.coordinator || null,
  });
  const actorCheckpointById = new Map((checkpoint?.actors || []).map((row) => [row.characterId, row]));
  const nameForms = worldPack ? nameFormsByCharacter(worldPack) : new Map();
  const actors = ids.map((characterId) => {
    const character = characterById(state, characterId);
    const port = createCharacterPort({
      characterRecord: character,
      runStage,
      onStageAccepted,
      onStageRejected,
      maxStageProtocolRepairs,
      characterAgentCallMode,
      onExecutionCheckpoint,
      placeMap: placeMapFor(worldState.places?.[worldState.entities[characterId]?.placeId]),
      nameForms,
    });
    const saved = actorCheckpointById.get(characterId);
    return saved
      ? restoreCharacterSessionActor(saved, { runtimePort: port })
      : createCharacterSessionActor({
        characterId,
        privateState: privateStateForCharacter(state, character, worldState.entities[characterId].zoneId, worldState.entities[characterId].placeId),
        runtimePort: port,
      });
  });
  const runtime = createCharacterWorldRuntime({
    coordinator,
    actors,
    receiptLedger: checkpoint?.receiptLedger || null,
    readyQueue: checkpoint?.readyQueue || [],
    situationProjector: projectTavernSituationV27,
    enableDayPlanning,
    prioritizeEvidenceWakes: Boolean(worldPack.stage?.sites),
    onExecutionCheckpoint,
    completedTurnRecords: restoreProgressRecords(checkpoint?.completedTurnRecords || [], checkpoint?.coordinator?.outcomes || []),
  });
  return {
    schemaVersion: TAVERN_WORLD_RUNTIME_V27_VERSION,
    sourceState: state,
    worldPackId: worldPack.meta.id,
    characterIds: ids,
    runtime,
    coordinator,
  };
}

export const createWorldRuntimeV27 = createTavernWorldRuntimeV27;

function publicOutcome(outcome = {}) {
  return outcome ? {
    outcomeId: outcome.outcomeId,
    eventId: outcome.eventId,
    actorId: outcome.actorId,
    primitive: outcome.primitive,
    status: outcome.status,
    worldVersion: outcome.worldVersion,
    revalidatedFromWorldVersion: outcome.revalidatedFromWorldVersion,
    attemptSurface: clone(outcome.attemptSurface || []),
    resolvedEffects: clone(outcome.resolvedEffects || []),
    failedEffects: clone(outcome.failedEffects || []),
    incidentalEffects: clone(outcome.incidentalEffects || []),
    committedFacts: clone(outcome.committedFacts || []),
    deliveries: clone(outcome.deliveries || []),
    durationSeconds: Number(outcome.durationSeconds || 0),
  } : null;
}

const ACCEPTED_STAGED_STAGE_MARKERS = Object.freeze([
  "subjective_appraisal_accepted",
  "agent_candidates_accepted",
  "agent_choice_accepted",
  "agent_expression_plan_accepted",
  "agent_realization_accepted",
]);

const ACCEPTED_ATOMIC_STAGE_MARKERS = Object.freeze([
  "subjective_appraisal_accepted",
  "agent_candidates_accepted",
  "agent_choice_accepted",
  "agent_turn_commit_accepted",
]);

const STAGED_INVOCATION_KINDS = Object.freeze([
  "subjective_appraisal",
  "agent_candidates",
  "agent_choice_and_regulation",
  "agent_expression_planning",
  "agent_realization",
]);

const ATOMIC_INVOCATION_KINDS = Object.freeze([
  "subjective_appraisal",
  "agent_candidates",
  "agent_choice_and_regulation",
  "agent_turn_commit",
]);

/**
 * Completion follows the submission mode and accepted transitions, never the
 * raw invocation count: an in-turn repair re-runs one stage without changing
 * how many causal stages the Character Agent completed.
 */
function observerSubmissionMode(privateResult = {}) {
  const history = (privateResult.acceptedStageHistory || []).map((row) => clean(row?.stage));
  const invocationKinds = (privateResult.stages || [])
    .map((row) => clean(row?.name).split(":").at(-1))
    .filter(Boolean);
  const explicit = clean(privateResult.submissionMode);
  if (explicit === "day_planning" || clean(privateResult.turnKind) === "day_planning") return "day_planning";
  if (explicit === "reflection" || clean(privateResult.turnKind) === "reflection") return "reflection";
  if (["atomic", "staged"].includes(explicit)) return explicit;
  if (clean(privateResult.executionMode) === "atomic-commit"
    || history.includes("agent_turn_commit_accepted")
    || invocationKinds.includes("agent_turn_commit")) return "atomic";
  return "staged";
}

function characterAgentCompletion(privateResult = {}) {
  const submissionMode = observerSubmissionMode(privateResult);
  if (submissionMode === "day_planning") return {
    submissionMode,
    acceptedStageCount: privateResult.dayPlanningCompleted === true ? 1 : 0,
    expectedAcceptedStageCount: 1,
    completed: privateResult.dayPlanningCompleted === true,
  };
  if (submissionMode === "reflection") return {
    submissionMode,
    acceptedStageCount: privateResult.reflectionCompleted === true ? 1 : 0,
    expectedAcceptedStageCount: 1,
    completed: privateResult.reflectionCompleted === true,
  };
  const acceptedMarkers = submissionMode === "atomic"
    ? ACCEPTED_ATOMIC_STAGE_MARKERS
    : ACCEPTED_STAGED_STAGE_MARKERS;
  const invocationKinds = submissionMode === "atomic"
    ? ATOMIC_INVOCATION_KINDS
    : STAGED_INVOCATION_KINDS;
  const history = (privateResult.acceptedStageHistory || []).map((row) => clean(row?.stage));
  let acceptedStageCount = 0;
  if (history.length) {
    acceptedStageCount = acceptedMarkers.filter((marker) => history.includes(marker)).length;
  } else {
    // Older records only kept invocation entries; distinct stage kinds still
    // count each repaired stage once.
    const actualKinds = new Set((privateResult.stages || [])
      .map((row) => clean(row?.name).split(":").at(-1))
      .filter(Boolean));
    acceptedStageCount = invocationKinds.filter((kind) => actualKinds.has(kind)).length;
  }
  return {
    submissionMode,
    acceptedStageCount,
    expectedAcceptedStageCount: acceptedMarkers.length,
    completed: acceptedStageCount === acceptedMarkers.length,
  };
}

export function projectTavernV27TurnForObserver(turn = {}, characterCatalog = []) {
  const character = (characterCatalog || []).find((row) => row.id === turn.characterId) || {};
  const privateResult = turn.privateResult || {};
  const decision = privateResult.worldBridge?.rawDecision || {};
  const stageInvocations = (privateResult.stages || []).length;
  const completion = characterAgentCompletion(privateResult);
  return {
    characterId: turn.characterId,
    characterName: clean(character.name || turn.characterId),
    agentTurnId: turn.agentTurnId,
    wakeKind: clean(turn.wake?.kind),
    turnKind: clean(privateResult.turnKind || "action"),
    submissionMode: completion.submissionMode,
    characterAgentCompleted: completion.completed,
    acceptedStageCount: completion.acceptedStageCount,
    expectedAcceptedStageCount: completion.expectedAcceptedStageCount,
    // Deprecated compatibility field: only staged turns can truthfully be
    // described as having completed the historical five-stage protocol.
    fiveStageAgentCompleted: completion.submissionMode === "staged" && completion.completed,
    protocolRepairCount: Number.isFinite(Number(privateResult.protocolRepairAttempts))
      ? Math.max(0, Number(privateResult.protocolRepairAttempts || 0))
      : Math.max(0, stageInvocations - completion.acceptedStageCount),
    stageNames: (privateResult.stages || []).map((row) => clean(row.name)),
    publicRealization: {
      actionType: clean(decision.actionType),
      targetCharacterId: clean(decision.targetCharacterId),
      speech: (turn.outcome?.resolvedEffects || []).some(row => row.kind === "speech_emitted") ? clean(decision.speech) : "",
      visibleAction: unique((turn.outcome?.attemptSurface || []).map(row => row.visibleAction)).join("；"),
      observableAffectiveTexture: clone((turn.outcome?.attemptSurface || []).flatMap(row => row.observableAffectiveTexture || [])),
    },
    authoredExpressionDraft: { visibility: "audit-only-unverified-not-a-world-fact", bodyDelta: clean(decision.visibleAction),
      affectiveDeltas: clone(decision.observableAffectiveTexture || []) },
    observerOnlyPsychology: {
      visibility: "observer-only-never-returned-to-character-context",
      selectedIntention: clean(privateResult.worldBridge?.selectedCandidate?.intention),
      privateDecisionBasis: clean(privateResult.decision?.privateDecisionBasis),
      automaticCommunicationImpulse: clone(privateResult.agentChoice?.automaticCommunicationImpulse || null),
    },
    outcome: publicOutcome(turn.outcome),
  };
}

export function projectTavernWorldRuntimeV27ForObserver(instance = {}, turns = []) {
  const worldState = instance.coordinator?.worldState || {};
  const characters = instance.sourceState?.characters || [];
  return {
    schemaVersion: TAVERN_WORLD_RUNTIME_V27_VERSION,
    authority: "observer-projection-one-way-only",
    worldVersion: instance.coordinator?.journal?.worldVersion || 0,
    nowSeconds: Number(worldState.nowSeconds || 0),
    readyQueue: instance.runtime?.readyQueue || [],
    characters: Object.values(worldState.entities || {}).map((row) => ({
      id: row.id,
      name: row.name,
      present: row.present !== false,
      placeId: row.placeId,
      zoneId: row.zoneId,
      positionId: clean(row.positionId),
      orientationTargetId: clean(row.orientationTargetId),
      listeningTargetId: clean(row.listeningTargetId),
      listeningTargetKind: clean(row.listeningTargetKind),
    })),
    objects: Object.values(worldState.objects || {}).filter((row) => {
      const holder = clean(row.holderCharacterId);
      const holderPresent = !holder || worldState.entities?.[holder]?.present !== false && Boolean(worldState.entities?.[holder]);
      return holderPresent
        && row.presentation?.publiclyVisible !== false
        && clean(row.presentation?.exposure || "visible") !== "hidden";
    }).map((row) => ({
      id: row.id,
      label: clean(row.perception?.publicLabel || row.label || row.id),
      kind: clean(row.kind),
      placeId: clean(row.placeId),
      zoneId: worldState.entities?.[row.holderCharacterId]?.zoneId || row.zoneId,
      holderCharacterId: row.holderCharacterId,
      occupantCharacterIds: clone(row.occupantCharacterIds || []),
    })),
    turns: turns.map((turn) => projectTavernV27TurnForObserver(turn, characters)),
    eventCount: instance.coordinator?.journal?.events?.length || 0,
  };
}
