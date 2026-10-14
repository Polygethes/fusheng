import { createId } from "../../data/seed.js";
import { getTavernEcologyProfile } from "../ecology/tavernEcologyProfile.mjs";
import {
  applyVisitObjectiveTransition,
  ensureVisitObjectiveGraph,
  syncLegacyVisitFieldsFromGraph,
} from "./tavernCommitmentAdapter.mjs";
import {
  applyObjectOperations,
  mergeObjectTemplates,
  normalizeObjectLedger,
  objectPublicPerceptionLabel,
  objectVisibleToObserver,
  relocateHeldObjects,
  validateObjectAccess,
} from "../simulation/objectLedger.mjs";
import {
  buildSituatedServiceChoiceTool,
  compileSituatedServiceAffordances,
} from "../simulation/situatedServiceChoice.mjs";
import {
  consumeOfferingStock,
  normalizeMaterialEconomyProfile,
  offeringCurrentlyAvailable,
  offeringServiceKind,
  serviceBodyDemand,
  serviceNeedChannels,
} from "../simulation/materialEconomy.mjs";
import {
  normalizeCultivationSustenanceProfile,
  normalizeOfferingSustenance,
  operationalSustenanceFactors,
} from "../simulation/cultivationSustenance.mjs";
import {
  completeDurativeWorldProcess,
  interruptDurativeWorldProcess,
  refreshDurativeWorldProcesses,
  resumeDurativeWorldProcess,
  startDurativeWorldProcess,
} from "../simulation/durativeWorldProcess.mjs";

const TAVERN_LOCATION_ID = "loc_xyy_tavern";

export const TAVERN_CAUSAL_DAY_SLOTS = [
  { id: "dawn", label: "清晨" },
  { id: "noon", label: "正午" },
  { id: "afternoon", label: "午后" },
  { id: "dusk", label: "黄昏" },
  { id: "night", label: "夜深" },
];

const TERMINAL_VISIT_STAGES = new Set(["completed", "refused", "abandoned"]);
const COMMITTED_ZONE_PROVENANCE_AUTHORITY = "world-movement-commit";
const OFFERING_FALLBACKS = {
  meal: { label: "一份常饭", price: 5, category: "meal", vesselType: "meal_bowl", stockCost: { meals: 1 } },
  tea: { label: "一碗粗茶", price: 1, category: "tea", vesselType: "tea_bowl", stockCost: { tea: 1, water: 1 } },
  lodging_meal: { label: "一晚客房和一份常饭", price: 16, category: "lodging", stockCost: { rooms: 1, meals: 1 } },
  work_meal: { label: "以一段杂务换一份常饭", price: 0, category: "work_meal", vesselType: "meal_bowl", stockCost: { meals: 1 } },
};

const VISIT_ZONE_DEFAULTS = {
  business: { allowed: ["threshold", "hall"], purpose: ["hall"] },
  delivery: { allowed: ["threshold", "hall", "counter"], purpose: ["hall", "counter"] },
  lodging: { allowed: ["threshold", "hall", "stairs", "guest_room"], purpose: ["hall", "stairs", "guest_room"] },
  work_exchange: { allowed: ["threshold", "hall", "stove", "courtyard"], purpose: ["hall", "stove", "courtyard"] },
  self_directed: { allowed: ["threshold", "hall"], purpose: ["hall"] },
  visit: { allowed: ["threshold", "hall"], purpose: ["hall"] },
};

export function tavernRestoredVisitorZone({
  visit = null,
  storedAgent = {},
  fallbackZoneId = "threshold",
} = {}) {
  const storedZoneId = storedAgent?.zoneId || "";
  if (!visit || !storedZoneId) return storedZoneId || fallbackZoneId;
  const disclosureRequired = visit.purposeDisclosureRequired !== false;
  const purposeDeclared = visit.purposeStatus === "declared"
    || visit.purposeDisclosureStatus === "declared";
  if (!disclosureRequired || purposeDeclared || storedZoneId === fallbackZoneId) return storedZoneId;

  const provenance = storedAgent.zoneProvenance || {};
  const committedMovement = provenance.authority === COMMITTED_ZONE_PROVENANCE_AUTHORITY
    && Boolean(provenance.sourceActionId)
    && provenance.toZoneId === storedZoneId;
  return committedMovement ? storedZoneId : fallbackZoneId;
}

// This belongs to the tavern adapter, not to the mathematical kernel. The
// kernel consumes explicit body demand and never guesses physiology from an
// action name.
const TAVERN_AFFORDANCE_BODY_DEMAND = Object.freeze({
  enter_self_directed_visit: { exertion: 18, energyDemand: 8 },
  approach_reception: { exertion: 18, energyDemand: 8 },
  move_to_hall: { exertion: 18, energyDemand: 8 },
  approach_waiting_guest: { exertion: 18, energyDemand: 8 },
  approach_work_zone: { exertion: 24, energyDemand: 12 },
  move_to_lodging_key_pool: { exertion: 20, energyDemand: 10 },
  perform_work: { exertion: 52, energyDemand: 24 },
  submit_work: { exertion: 12, energyDemand: 5 },
  verify_work: { exertion: 18, energyDemand: 7 },
  consume_service: { exertion: 4, energyDemand: 1, hungerRelief: 45 },
  request_service: { exertion: 2, energyDemand: 1 },
  take_guest_seat: { exertion: 4, energyDemand: 1, recovery: 4 },
  approach_service_vessel: { exertion: 18, energyDemand: 8 },
  approach_service_station: { exertion: 18, energyDemand: 8 },
  start_service_preparation: { exertion: 14, energyDemand: 6 },
  interrupt_service_preparation: { exertion: 4, energyDemand: 2 },
  resume_service_preparation: { exertion: 8, energyDemand: 3 },
  finish_service_preparation: { exertion: 10, energyDemand: 4 },
  approach_service_delivery: { exertion: 18, energyDemand: 8 },
  serve_guest: { exertion: 16, energyDemand: 7 },
  serve_work_meal: { exertion: 16, energyDemand: 7 },
});

function deepClone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function text(value = "", max = 220) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function characterById(state, characterId) {
  return (state.characters || []).find((character) => character.id === characterId) || null;
}

function agencyFor(character = {}) {
  return character.lifeProfile?.tavernAgency || {};
}

function authorityFor(character = {}) {
  return agencyFor(character).authority || {};
}

function isVisitor(character = {}) {
  return character.lifeProfile?.simulationTier === "visitor"
    || Boolean(character.lifeProfile?.tavernAgency?.visitPolicy);
}

function isSelfDirectedVisit(visit = {}) {
  return visit.selfDirected === true || visit.kind === "self_directed";
}

function unresolvedEcologyVisitLoops(character = {}, visit = {}) {
  const profile = getTavernEcologyProfile(character.id);
  const desireStates = character.ecologyState?.desires || {};
  return (profile?.desires || []).flatMap((desire) => {
    const state = desireStates[desire.id] || {};
    const satisfaction = Number(state.satisfaction || 0);
    const pressure = Number(state.strength ?? desire.baseStrength ?? 0) + Number(state.frustration || 0);
    if (satisfaction >= 1 || pressure < 0.35) return [];
    const desiredState = desire.desiredState || {};
    return [{
      id: `personal_loop:${visit.id || character.id}:desire:${desire.id}`,
      sourceId: desire.id,
      ownerCharacterId: character.id,
      targetCharacterId: desire.target?.type === "character" ? desire.target.id : "",
      desire: `${desiredState.verb || "推进"}${desiredState.object || desire.target?.label || "未完成的目标"}`,
      status: "open",
      resolutionEvidenceIds: [],
    }];
  });
}

function institutionOperatorId(state = {}) {
  const configured = state.tavernState?.institution?.operatorId || "";
  if (configured && characterById(state, configured)) return configured;
  return (state.characters || []).find((character) => {
    const authority = authorityFor(character);
    return authority.receiveGuest || authority.assignWork || authority.acceptPayment || authority.manageLedger;
  })?.id || "";
}

function pendingCandidateNotices(state = {}) {
  return (state.tavernState?.candidateNotices || []).filter((notice) => notice.status === "pending");
}

function causalSlotIndex(day = 1, slot = TAVERN_CAUSAL_DAY_SLOTS[0]) {
  const slotOffset = Math.max(0, TAVERN_CAUSAL_DAY_SLOTS.findIndex((row) => row.id === slot.id));
  return Math.max(0, (Number(day || 1) - 1) * TAVERN_CAUSAL_DAY_SLOTS.length + slotOffset);
}

function ensureVisitIntention(state = {}, character = {}, day = 1, slot = TAVERN_CAUSAL_DAY_SLOTS[0]) {
  const policy = agencyFor(character).visitPolicy || {};
  character.lifeState = character.lifeState || {};
  const trigger = policy.arrivalTrigger || "self_committed_visit";
  const nowSlotIndex = causalSlotIndex(day, slot);
  let intention = character.lifeState.visitIntention;
  if (!intention) {
    intention = {
      id: `visit_intention:${character.id}:legacy`,
      ownerCharacterId: character.id,
      destinationLocationId: TAVERN_LOCATION_ID,
      motive: policy.arrivalMotive || policy.purpose || character.lifeProfile?.privatePursuit || "到酒馆办自己的事",
      trigger,
      status: trigger === "pending_candidate_notice" ? "waiting_trigger" : "committed",
      // A legacy save did not contain an owned intention.  Treat migration as
      // the moment it becomes explicit instead of pretending it was committed
      // at world slot zero and teleporting every old visitor into the tavern.
      committedAtSlotIndex: trigger === "pending_candidate_notice" ? null : nowSlotIndex,
      triggerEvidenceIds: [],
      travelCostSlots: Math.max(0, Number(policy.travelCostSlots || 0)),
      source: "legacy-state-migration",
    };
    character.lifeState.visitIntention = intention;
  }
  if (intention.status === "waiting_trigger" && trigger === "pending_candidate_notice") {
    const notices = pendingCandidateNotices(state);
    if (notices.length) {
      intention.status = "committed";
      intention.committedAtSlotIndex = nowSlotIndex;
      intention.triggerEvidenceIds = notices.map((notice) => notice.id);
    }
  }
  const committedAtSlotIndex = Number(intention.committedAtSlotIndex);
  const travelCostSlots = Math.max(0, Number(intention.travelCostSlots || 0));
  const elapsedTravelSlots = Number.isFinite(committedAtSlotIndex)
    ? Math.max(0, nowSlotIndex - committedAtSlotIndex)
    : 0;
  const ready = ["committed", "traveling"].includes(intention.status)
    && Number.isFinite(committedAtSlotIndex)
    && elapsedTravelSlots >= travelCostSlots;
  if (!ready && intention.status === "committed" && Number.isFinite(committedAtSlotIndex)) intention.status = "traveling";
  intention.observedAtSlotIndex = nowSlotIndex;
  intention.travelElapsedSlots = elapsedTravelSlots;
  return { ready, intention, nowSlotIndex, elapsedTravelSlots, travelCostSlots };
}

function bindTriggeredVisitObjects(state = {}, visit = {}, character = {}) {
  const policy = agencyFor(character).visitPolicy || {};
  if (policy.arrivalTrigger !== "pending_candidate_notice") return true;
  const notices = state.tavernState?.candidateNotices || [];
  const existingIds = new Set(notices.map((notice) => notice.id));
  const boundIds = (visit.businessObjectIds || []).filter((id) => existingIds.has(id));
  if (boundIds.length) {
    visit.businessObjectIds = boundIds;
    return true;
  }
  const pending = notices.filter((notice) => notice.status === "pending");
  if (!pending.length) return false;
  const names = [...new Set(pending.map((notice) => notice.candidateName).filter(Boolean))];
  visit.businessObjectIds = pending.map((notice) => notice.id);
  visit.purpose = `核对${names.join("、") || "待核来客"}的候选留宿与接引登记`;
  visit.purposeAction = `把${names.join("、") || "待核来客"}的留宿与接引登记同酒馆记录逐项对清`;
  return true;
}

function offeringFor(state, requestedService = "meal") {
  return state.tavernState?.institution?.offerings?.[requestedService]
    || OFFERING_FALLBACKS[requestedService]
    || OFFERING_FALLBACKS.meal;
}

function normalCashServiceEntries(state = {}) {
  const offerings = state.tavernState?.institution?.offerings || OFFERING_FALLBACKS;
  return Object.entries(offerings).filter(([offeringId, offering]) => (
    offering
    && offering.walkInOrderable !== false
    && ["tea", "meal"].includes(offeringServiceKind(offering, offeringId))
    && Number.isFinite(Number(offering.price))
  ));
}

function serviceCurrentlyAvailable(state = {}, offeringId = "") {
  const offering = offeringFor(state, offeringId);
  return offeringCurrentlyAvailable(state.tavernState?.stock || {}, offering, offeringId);
}

function perceivedServiceOperatorIds(state = {}, runtime = {}, actorId = "", perceivedCharacterIds = []) {
  const actorZoneId = runtime.agents?.[actorId]?.zoneId || "";
  const perceived = new Set(perceivedCharacterIds || []);
  return (state.characters || []).filter((character) => {
    if (!perceived.has(character.id)) return false;
    const agent = runtime.agents?.[character.id];
    const authority = authorityFor(character);
    return agent?.present
      && agent.zoneId === actorZoneId
      && (authority.serveTea || authority.serveMeal || authority.receiveGuest);
  }).map((character) => character.id);
}

function guestPositionRows(tavern = {}) {
  return (tavern.institution?.guestPositions || []).filter((position) => (
    position?.id && position?.zoneId
  ));
}

function ensureGuestPositionOccupancy(tavern = {}) {
  tavern.guestPositionOccupancy = tavern.guestPositionOccupancy && typeof tavern.guestPositionOccupancy === "object"
    ? tavern.guestPositionOccupancy
    : {};
  for (const position of guestPositionRows(tavern)) {
    const current = tavern.guestPositionOccupancy[position.id];
    tavern.guestPositionOccupancy[position.id] = Array.isArray(current)
      ? [...new Set(current.filter(Boolean))]
      : [];
  }
  return tavern.guestPositionOccupancy;
}

function availableGuestPositions(tavern = {}, actorId = "", zoneId = "") {
  const occupancy = tavern.guestPositionOccupancy || {};
  return guestPositionRows(tavern).filter((position) => {
    if (position.zoneId !== zoneId || position.available === false) return false;
    const occupants = occupancy[position.id] || [];
    return occupants.includes(actorId) || occupants.length < Math.max(1, Number(position.capacity || 1));
  });
}

function actorGuestPositionId(tavern = {}, actorId = "") {
  const occupancy = tavern.guestPositionOccupancy || {};
  return Object.entries(occupancy).find(([, actorIds]) => actorIds.includes(actorId))?.[0] || "";
}

function releaseGuestPosition(tavern = {}, actorId = "") {
  const occupancy = ensureGuestPositionOccupancy(tavern);
  for (const positionId of Object.keys(occupancy)) {
    occupancy[positionId] = occupancy[positionId].filter((candidateId) => candidateId !== actorId);
  }
}

function occupyGuestPosition(tavern = {}, actorId = "", positionId = "") {
  const position = guestPositionRows(tavern).find((row) => row.id === positionId);
  if (!position) return false;
  const occupancy = ensureGuestPositionOccupancy(tavern);
  const occupants = occupancy[positionId] || [];
  if (!occupants.includes(actorId) && occupants.length >= Math.max(1, Number(position.capacity || 1))) return false;
  releaseGuestPosition(tavern, actorId);
  occupancy[positionId] = [...new Set([...(occupancy[positionId] || []), actorId])];
  return true;
}

export function buildTavernSituatedServiceChoice(state = {}, runtime = {}, actorId = "", perceivedCharacterIds = []) {
  const visit = (state.tavernState?.activeVisits || []).find((row) => (
    row.visitorId === actorId && isSelfDirectedVisit(row)
  ));
  const actorZoneId = runtime.agents?.[actorId]?.zoneId || "";
  if (!visit || actorZoneId !== "hall" || (visit.requestedService && visit.requestedService !== "none")) return null;
  const operatorActorIds = perceivedServiceOperatorIds(state, runtime, actorId, perceivedCharacterIds);
  if (!operatorActorIds.length) return null;
  const actor = characterById(state, actorId) || {};
  const body = actor.ecologyState?.body || {};
  const coins = Math.max(0, Number(actor.lifeState?.resources?.coins || 0));
  const economicContext = normalizeMaterialEconomyProfile(
    actor.lifeProfile?.materialEconomy || {},
    actor.lifeState?.resources || {},
  );
  const ecologyProfile = getTavernEcologyProfile(actor) || {};
  const sustenanceContext = normalizeCultivationSustenanceProfile(
    actor.lifeProfile?.physiology?.sustenance
      || ecologyProfile.sustenanceProfile
      || {},
  );
  const sustenanceFactors = operationalSustenanceFactors(sustenanceContext);
  const rawHunger = Math.max(0, Math.min(1, Number(body.hunger || 0)));
  const choice = {
    actorId,
    operatorActorIds,
    bodyNeeds: {
      hunger: rawHunger,
      effectiveOrdinaryFoodNeed: rawHunger * sustenanceFactors.ordinaryFoodDependence,
      thirst: Math.max(0, Math.min(1, Number(body.thirst || 0))),
      fatigue: Math.max(0, Math.min(1, Number(body.fatigue || body.exertion || 0))),
    },
    ownedTender: [{ id: `resource:${actorId}:copper-coins`, currencyId: "copper_wen", amount: coins }],
    economicContext,
    sustenanceContext,
    offers: normalCashServiceEntries(state).map(([offeringId, offering]) => ({
      id: offeringId,
      label: offering.label,
      category: offeringServiceKind(offering, offeringId),
      qualityTier: offering.qualityTier || "unspecified",
      serving: deepClone(offering.serving || {}),
      observableQualities: [...(offering.observableQualities || [])],
      available: serviceCurrentlyAvailable(state, offeringId),
      price: { amount: Number(offering.price || 0), currencyId: "copper_wen", currencyClass: "mundane", knownToActor: true },
      needChannels: serviceNeedChannels(offering, offeringId),
      bodyDemand: serviceBodyDemand(offering, offeringId),
      sustenance: normalizeOfferingSustenance(offering, offeringId),
    })),
    tableUseNorm: deepClone(state.tavernState?.institution?.tableUseNorm || {
      id: "norm_public_table_use_during_business",
      sitWithoutOrderingPhysicallyPossible: true,
      operatorResponseRequiresOwnAction: true,
      pressureOnset: "来客实际占用客桌且经营者亲眼注意到尚无消费或来意后，随停留时间产生",
    }),
    currentTransactionState: "none",
    guestPositionOptions: availableGuestPositions(state.tavernState || {}, actorId, actorZoneId).map((position) => ({
      id: position.id,
      label: position.label,
      zoneId: position.zoneId,
      capacity: Math.max(1, Number(position.capacity || 1)),
      metrics: deepClone(position.metrics || {}),
      observableFeatures: [...(position.observableFeatures || [])],
    })),
  };
  return {
    ...choice,
    requestAffordances: compileSituatedServiceAffordances(choice),
    tool: buildSituatedServiceChoiceTool(),
  };
}

function serviceObjectType(tavern = {}, requestedService = "meal") {
  const offering = tavern.institution?.offerings?.[requestedService] || OFFERING_FALLBACKS[requestedService] || {};
  return offeringServiceKind(offering, requestedService);
}

function availableServiceVessel(tavern = {}, requestedService = "meal", zoneId = "hall") {
  const ledger = normalizeObjectLedger(tavern.objectLedger || {});
  const offering = tavern.institution?.offerings?.[requestedService] || OFFERING_FALLBACKS[requestedService] || {};
  const serviceType = serviceObjectType(tavern, requestedService);
  const vesselType = offering.vesselType || "";
  return Object.values(ledger.objects || {}).find((object) => (
    !object.holderActorId
    && (!object.zoneId || object.zoneId === zoneId)
    && (object.state?.serviceTypes || []).includes(serviceType)
    && (!vesselType || object.state?.vesselType === vesselType)
    && (object.state?.contents || "empty") === "empty"
    && !object.state?.servedToActorId
  )) || null;
}

function tavernProcessClockSeconds(runtime = {}) {
  const day = Number(runtime.slotContext?.day ?? runtime.macroDay ?? 1);
  const slotId = runtime.slotContext?.slotBaseId || runtime.slotContext?.slotId || "dawn";
  const slot = TAVERN_CAUSAL_DAY_SLOTS.find((row) => row.id === slotId) || TAVERN_CAUSAL_DAY_SLOTS[0];
  return causalSlotIndex(day, slot) * 4 * 60 * 60 + Math.max(0, Number(runtime.elapsedSeconds || 0));
}

function refreshTavernServiceProcesses(tavern = {}, runtime = {}) {
  tavern.serviceProcesses = refreshDurativeWorldProcesses(
    Array.isArray(tavern.serviceProcesses) ? tavern.serviceProcesses : [],
    tavernProcessClockSeconds(runtime),
  );
  for (const process of tavern.serviceProcesses) {
    const visit = (tavern.activeVisits || []).find((row) => row.id === process.subjectId);
    if (!visit) continue;
    visit.serviceProcessId = process.id;
    if (process.status === "active") visit.servicePreparationStatus = "preparing";
    else if (process.status === "interrupted") visit.servicePreparationStatus = "interrupted";
    else if (process.status === "ready") visit.servicePreparationStatus = "ready_for_finish";
    else if (process.status === "completed" && process.metadata?.deliveryStatus !== "delivered") visit.servicePreparationStatus = "prepared";
  }
  return tavern.serviceProcesses;
}

function serviceProcessForVisit(tavern = {}, visit = {}) {
  return (tavern.serviceProcesses || []).find((process) => (
    process.subjectId === visit.id
    && process.metadata?.deliveryStatus !== "delivered"
    && !["cancelled"].includes(process.status)
  )) || null;
}

function servicePreparationSpec(tavern = {}, requestedService = "meal") {
  const offering = tavern.institution?.offerings?.[requestedService] || OFFERING_FALLBACKS[requestedService] || OFFERING_FALLBACKS.meal;
  const kind = offeringServiceKind(offering, requestedService);
  const configured = offering.preparation || {};
  const stationZoneId = configured.stationZoneId
    || tavern.institution?.servicePreparationPolicy?.stationZoneId
    || "stove";
  const station = tavern.servicePreparationEnvironment?.stations?.[stationZoneId] || {};
  const heatReady = station.heatReady !== false && ["simmering", "hot", "ready", "lit"].includes(station.heatState || "ready");
  const defaultReady = kind === "tea" ? 24 : 16;
  const defaultCold = kind === "tea" ? 110 : 54;
  return {
    processKind: text(configured.processKind || `${kind}-preparation`, 120),
    stationZoneId,
    attentionMode: configured.attentionMode === "continuous_work" ? "continuous_work" : "passive_wait",
    durationSeconds: Math.max(1, Number(
      heatReady
        ? configured.durationSecondsWhenHeatReady ?? defaultReady
        : configured.durationSecondsColdStart ?? defaultCold,
    ) || defaultReady),
    heatReady,
    heatSourceId: station.heatSourceId || tavern.institution?.servicePreparationPolicy?.heatSourceId || "",
  };
}

function serviceVesselCandidates(tavern = {}, requestedService = "meal") {
  const ledger = normalizeObjectLedger(tavern.objectLedger || {});
  const offering = tavern.institution?.offerings?.[requestedService] || OFFERING_FALLBACKS[requestedService] || {};
  const serviceType = serviceObjectType(tavern, requestedService);
  const vesselType = offering.vesselType || "";
  return Object.values(ledger.objects || {}).filter((object) => (
    (object.state?.serviceTypes || []).includes(serviceType)
    && (!vesselType || object.state?.vesselType === vesselType)
    && (object.state?.contents || "empty") === "empty"
    && !object.state?.servedToActorId
    && !object.state?.preparedForVisitId
  ));
}

function serviceProcessAffordances({
  state = {},
  runtime = {},
  actor = {},
  actorRuntime = {},
  visit = {},
  visitorName = "来客",
  actorName = "经手人",
  finalServeType = "serve_guest",
} = {}) {
  const tavern = state.tavernState || {};
  refreshTavernServiceProcesses(tavern, runtime);
  const requestedService = finalServeType === "serve_work_meal" ? "work_meal" : (visit.requestedService || "meal");
  const offering = offeringFor(state, requestedService);
  const serviceKind = offeringServiceKind(offering, requestedService);
  const authority = authorityFor(actor);
  const canPrepare = serviceKind === "tea"
    ? authority.serveTea
    : authority.serveMeal;
  if (!canPrepare) return [];
  const process = serviceProcessForVisit(tavern, visit);
  const station = servicePreparationSpec(tavern, requestedService);
  const actorZoneId = actorRuntime.zoneId || "";
  const visitorZoneId = visitTargetZone(runtime, visit);
  const vesselCandidates = serviceVesselCandidates(tavern, requestedService);
  const heldVessel = vesselCandidates.find((object) => object.holderActorId === actor.id);
  const localVessel = vesselCandidates.find((object) => !object.holderActorId && object.zoneId === actorZoneId);
  const stationVessel = vesselCandidates.find((object) => !object.holderActorId && object.zoneId === station.stationZoneId);
  const remoteVessel = vesselCandidates.find((object) => !object.holderActorId);
  const rows = [];

  if (!process) {
    if (!serviceCurrentlyAvailable(state, requestedService)) return rows;
    const selectedVessel = heldVessel || localVessel || (actorZoneId === station.stationZoneId ? stationVessel : null);
    if (!selectedVessel && remoteVessel && remoteVessel.zoneId !== actorZoneId) {
      const nextZoneId = nextZoneToward(runtime, actorZoneId, remoteVessel.zoneId);
      if (nextZoneId) rows.push(affordance({
        id: `approach_service_vessel:${visit.id}:${remoteVessel.id}:${nextZoneId}`,
        type: "approach_service_vessel",
        label: `去取准备${offering.label}要用的${remoteVessel.label}`,
        visitId: visit.id,
        moveToZoneId: nextZoneId,
        offeringId: requestedService,
        offering,
        processId: `service_process:${visit.id}`,
        stationZoneId: station.stationZoneId,
        finalServeType,
        actionType: "move",
        allowSpeech: true,
        canonicalVisibleAction: `${actorName}朝${runtime.topology?.zones?.[nextZoneId]?.label || nextZoneId}走去，先取准备${offering.label}要用的器皿。`,
        authoritativeFact: `${offering.label}已经有人点下，但经手人手边还没有合用的空器皿。`,
      }));
      return rows;
    }
    if (actorZoneId === station.stationZoneId && selectedVessel) {
      rows.push(affordance({
        id: `start_service_preparation:${visit.id}:${selectedVessel.id}`,
        type: "start_service_preparation",
        label: `开始准备${offering.label}`,
        visitId: visit.id,
        targetCharacterId: "",
        requiredZoneId: station.stationZoneId,
        objectIds: [selectedVessel.id],
        offeringId: requestedService,
        offering,
        processId: `service_process:${visit.id}`,
        processKind: station.processKind,
        stationZoneId: station.stationZoneId,
        durationSeconds: station.durationSeconds,
        attentionMode: station.attentionMode,
        finalServeType,
        actionType: "interact",
        allowSpeech: true,
        canonicalVisibleAction: serviceKind === "tea"
          ? `${actorName}取过${selectedVessel.label}，在灶边舀水投茶，开始等茶味散开。`
          : `${actorName}取过${selectedVessel.label}，在灶边开始盛配${offering.label}。`,
        authoritativeFact: `${offering.label}已经有人点下，但尚未开始准备。`,
      }));
      return rows;
    }
    const nextZoneId = nextZoneToward(runtime, actorZoneId, station.stationZoneId);
    if (!nextZoneId) return rows;
    const canStartOnArrival = nextZoneId === station.stationZoneId && Boolean(selectedVessel);
    rows.push(affordance({
      id: `${canStartOnArrival ? "start_service_preparation" : "approach_service_station"}:${visit.id}:${nextZoneId}${selectedVessel ? `:${selectedVessel.id}` : ""}`,
      type: canStartOnArrival ? "start_service_preparation" : "approach_service_station",
      label: canStartOnArrival ? `拿器皿去灶边开始准备${offering.label}` : `去灶边准备${offering.label}`,
      visitId: visit.id,
      targetCharacterId: "",
      moveToZoneId: nextZoneId,
      objectIds: selectedVessel ? [selectedVessel.id] : [],
      offeringId: requestedService,
      offering,
      processId: `service_process:${visit.id}`,
      processKind: station.processKind,
      stationZoneId: station.stationZoneId,
      durationSeconds: station.durationSeconds,
      attentionMode: station.attentionMode,
      finalServeType,
      actionType: "move",
      allowSpeech: true,
      canonicalVisibleAction: selectedVessel
        ? `${actorName}拿起${selectedVessel.label}，转身朝${runtime.topology?.zones?.[nextZoneId]?.label || nextZoneId}走去。`
        : `${actorName}转身朝${runtime.topology?.zones?.[nextZoneId]?.label || nextZoneId}走去，准备处理刚点下的${offering.label}。`,
      authoritativeFact: `${offering.label}已经有人点下，但必须到${runtime.topology?.zones?.[station.stationZoneId]?.label || station.stationZoneId}实际准备。`,
    }));
    return rows;
  }

  if (process.ownerActorId !== actor.id) return rows;
  if (process.status === "active") {
    if (process.attentionMode === "continuous_work") rows.push(affordance({
      id: `interrupt_service_preparation:${process.id}`,
      type: "interrupt_service_preparation",
      label: `暂时停下${offering.label}的准备`,
      visitId: visit.id,
      targetCharacterId: "",
      processId: process.id,
      offeringId: requestedService,
      offering,
      actionType: "act",
      allowSpeech: true,
      canonicalVisibleAction: `${actorName}把手里的准备动作停在能接着做的位置。`,
      authoritativeFact: `${offering.label}仍在准备中；主动停下会保留已完成的进度，但不会让它自行完成。`,
    }));
    return rows;
  }

  if (process.status === "interrupted") {
    if (actorZoneId !== process.stationZoneId) {
      const nextZoneId = nextZoneToward(runtime, actorZoneId, process.stationZoneId);
      if (nextZoneId) rows.push(affordance({
        id: `approach_service_station:${process.id}:${nextZoneId}`,
        type: "approach_service_station",
        label: `回灶边继续准备${offering.label}`,
        visitId: visit.id,
        targetCharacterId: "",
        moveToZoneId: nextZoneId,
        processId: process.id,
        offeringId: requestedService,
        offering,
        stationZoneId: process.stationZoneId,
        actionType: "move",
        allowSpeech: true,
        canonicalVisibleAction: `${actorName}朝${runtime.topology?.zones?.[nextZoneId]?.label || nextZoneId}走去，准备接着做停下的${offering.label}。`,
        authoritativeFact: `${offering.label}的准备已经中断，必须回到操作位置后才能继续。`,
      }));
    } else rows.push(affordance({
      id: `resume_service_preparation:${process.id}`,
      type: "resume_service_preparation",
      label: `接着准备${offering.label}`,
      visitId: visit.id,
      targetCharacterId: "",
      processId: process.id,
      offeringId: requestedService,
      offering,
      actionType: "interact",
      allowSpeech: true,
      canonicalVisibleAction: `${actorName}回到刚才停下的步骤，接着准备${offering.label}。`,
      authoritativeFact: `${offering.label}保留了中断前的进度，尚未完成。`,
    }));
    return rows;
  }

  if (process.status === "ready") {
    if (actorZoneId !== process.stationZoneId) {
      const nextZoneId = nextZoneToward(runtime, actorZoneId, process.stationZoneId);
      if (nextZoneId) rows.push(affordance({
        id: `approach_service_station:${process.id}:${nextZoneId}`,
        type: "approach_service_station",
        label: `回灶边收好已经到火候的${offering.label}`,
        visitId: visit.id,
        targetCharacterId: "",
        moveToZoneId: nextZoneId,
        processId: process.id,
        offeringId: requestedService,
        offering,
        stationZoneId: process.stationZoneId,
        actionType: "move",
        allowSpeech: true,
        canonicalVisibleAction: `${actorName}闻见火候已到，转身朝${runtime.topology?.zones?.[nextZoneId]?.label || nextZoneId}走去。`,
        authoritativeFact: `${offering.label}已经到火候，但尚未收尾装好。`,
      }));
    } else rows.push(affordance({
      id: `finish_service_preparation:${process.id}`,
      type: "finish_service_preparation",
      label: `把到火候的${offering.label}收好`,
      visitId: visit.id,
      targetCharacterId: "",
      requiredZoneId: process.stationZoneId,
      objectIds: [...process.objectIds],
      processId: process.id,
      offeringId: requestedService,
      offering,
      finalServeType,
      actionType: "interact",
      allowSpeech: true,
      canonicalVisibleAction: serviceKind === "tea"
        ? `${actorName}揭开器皿看过茶色，把到火候的${offering.label}收好。`
        : `${actorName}把盛配好的${offering.label}收稳，准备端出去。`,
      authoritativeFact: `${offering.label}的时间已经走完，仍需人物亲手收尾后才成为可送出的成品。`,
    }));
    return rows;
  }

  if (process.status === "completed") {
    const preparedVessel = process.objectIds
      .map((objectId) => tavern.objectLedger?.objects?.[objectId])
      .find(Boolean) || null;
    const carriedServiceLabel = preparedVessel
      ? `${preparedVessel.label}里的${offering.label}`
      : offering.label;
    if (actorZoneId !== visitorZoneId) {
      const nextZoneId = nextZoneToward(runtime, actorZoneId, visitorZoneId);
      if (nextZoneId) rows.push(affordance({
        id: `approach_service_delivery:${process.id}:${nextZoneId}`,
        type: "approach_service_delivery",
        label: `把准备好的${offering.label}送向${visitorName}`,
        visitId: visit.id,
        targetCharacterId: "",
        moveToZoneId: nextZoneId,
        objectIds: [...process.objectIds],
        processId: process.id,
        offeringId: requestedService,
        offering,
        finalServeType,
        actionType: "move",
        allowSpeech: true,
        canonicalVisibleAction: `${actorName}端着${carriedServiceLabel}，朝${runtime.topology?.zones?.[nextZoneId]?.label || nextZoneId}走去。`,
        authoritativeFact: `${offering.label}已经准备好，但还没有送到${visitorName}面前。`,
      }));
    } else rows.push(affordance({
      id: `${finalServeType}:${visit.id}:${process.id}`,
      type: finalServeType,
      label: `把准备好的${offering.label}交给${visitorName}`,
      visitId: visit.id,
      targetCharacterId: visit.visitorId,
      requiredZoneId: visitorZoneId,
      objectIds: [...process.objectIds],
      processId: process.id,
      offeringId: requestedService,
      offering,
      finalServeType,
      actionType: "interact",
      allowSpeech: true,
      canonicalVisibleAction: `${actorName}把${carriedServiceLabel}放到${visitorName}面前。`,
      authoritativeFact: `${offering.label}已经准备好，但尚未交付。`,
    }));
  }
  return rows;
}

export function nextTavernServiceProcessReadyAtElapsedSeconds(state = {}, runtime = {}) {
  const tavern = state.tavernState || {};
  refreshTavernServiceProcesses(tavern, runtime);
  const activeReadyTimes = (tavern.serviceProcesses || [])
    .filter((process) => process.status === "active" && Number.isFinite(Number(process.readyAtSeconds)))
    .map((process) => Number(process.readyAtSeconds));
  if (!activeReadyTimes.length) return null;
  const nowWorldSeconds = tavernProcessClockSeconds(runtime);
  const delta = Math.max(0, Math.min(...activeReadyTimes) - nowWorldSeconds);
  return Number(runtime.elapsedSeconds || 0) + delta;
}

function availableLodgingKey(tavern = {}, actorId = "") {
  const ledger = normalizeObjectLedger(tavern.objectLedger || {});
  return Object.values(ledger.objects || {}).find((object) => (
    (object.state?.objectType === "lodging_key" || Boolean(object.state?.roomId))
    && (!object.holderActorId || object.holderActorId === actorId)
    && !object.state?.assignedVisitId
  )) || null;
}

function lodgingKeyObjectsForVisit(tavern = {}, visit = {}) {
  const ledger = normalizeObjectLedger(tavern.objectLedger || {});
  const explicitIds = new Set(visit.lodgingKeyObjectIds || []);
  return Object.values(ledger.objects || {}).filter((object) => (
    (object.state?.objectType === "lodging_key" || Boolean(object.state?.roomId))
    && (explicitIds.has(object.id) || object.state?.assignedVisitId === visit.id)
  ));
}

function lodgingKeyStillOwed(object = {}, visit = {}) {
  return object.holderActorId === visit.visitorId
    || object.state?.assignedVisitId === visit.id
    || object.state?.assignedActorId === visit.visitorId;
}

function lodgingKeyPoolZone(objects = [], visit = {}) {
  return objects.find((object) => object.state?.keyPoolZoneId)?.state?.keyPoolZoneId
    || visit.lodgingKeyReturnZoneId
    || "hall";
}

function coLocatedKeyReturnOperatorId(state = {}, runtime = {}, visit = {}, zoneId = "") {
  const candidates = [...new Set([
    visit.hostId,
    institutionOperatorId(state),
    ...(state.characters || []).filter((character) => {
      const authority = authorityFor(character);
      return authority.receiveGuest || authority.manageLedger || authority.acceptPayment || authority.settleCash;
    }).map((character) => character.id),
  ].filter(Boolean))];
  return candidates.find((characterId) => (
    characterId !== visit.visitorId
    && runtime.agents?.[characterId]?.present
    && runtime.agents?.[characterId]?.zoneId === zoneId
  )) || "";
}

function ensureTavernWorkOrders(tavern = {}, day = 1) {
  tavern.workOrders = Array.isArray(tavern.workOrders) ? tavern.workOrders : [];
  const existingIds = new Set(tavern.workOrders.map((order) => order.id));
  for (const template of tavern.institution?.workOrderTemplates || []) {
    const id = `work-order:${Number(day || 1)}:${template.templateId || template.taskKind || "task"}`;
    if (existingIds.has(id)) continue;
    tavern.workOrders.push({
      id,
      templateId: template.templateId || "",
      taskKind: template.taskKind || "task",
      taskLabel: template.taskLabel || template.description || "完成一项具体杂务",
      description: template.description || template.taskLabel || "",
      unitAction: template.unitAction || template.description || template.taskLabel || "",
      zoneId: template.zoneId || "hall",
      requiredUnits: Math.max(1, Number(template.requiredUnits || 1)),
      completedUnits: 0,
      unitLabel: template.unitLabel || "项",
      completionCriteria: [...(template.completionCriteria || [])],
      objectIds: [...(template.objectIds || [])],
      toolIds: [...(template.toolIds || [])],
      compensation: deepClone(template.compensation || { kind: "meal", quantity: 1 }),
      status: "open",
      day: Number(day || 1),
      offeredVisitId: "",
      assignedActorId: "",
      evidenceActionIds: [],
    });
  }
  tavern.workOrders = tavern.workOrders.slice(-24);
  return tavern.workOrders;
}

function ensureTavernObjectInventory(tavern = {}) {
  tavern.objectLedger = mergeObjectTemplates({
    ledger: tavern.objectLedger || {},
    templates: tavern.institution?.objectTemplates || [],
    sceneId: tavern.locationId || TAVERN_LOCATION_ID,
  });
  return tavern.objectLedger;
}

function runtimeObjectActors(runtime = {}) {
  return Object.values(runtime.agents || {}).map((agent) => ({
    characterId: agent.characterId,
    present: agent.present !== false,
    sceneId: TAVERN_LOCATION_ID,
    zoneId: agent.zoneId || "",
  }));
}

function workOrderObjectsExist(tavern = {}, order = {}) {
  const ledger = normalizeObjectLedger(tavern.objectLedger || {});
  return [...(order.objectIds || []), ...(order.toolIds || [])].every((objectId) => {
    const object = ledger.objects?.[objectId];
    if (!object) return false;
    if (object.holderActorId) return false;
    return (!object.sceneId || object.sceneId === (tavern.locationId || TAVERN_LOCATION_ID))
      && (!object.zoneId || object.zoneId === order.zoneId);
  });
}

function reconcileWorkOrderObjectBindings(tavern = {}) {
  for (const order of tavern.workOrders || []) {
    if (!["open", "blocked_missing_objects"].includes(order.status)) continue;
    const ready = workOrderObjectsExist(tavern, order);
    order.status = ready ? "open" : "blocked_missing_objects";
    order.blockedReason = ready ? "" : "required_scene_objects_unavailable";
  }
}

function ensureVisitState(visit = {}) {
  const next = visit;
  next.selfDirected = isSelfDirectedVisit(next);
  next.purposeDisclosureRequired = typeof next.purposeDisclosureRequired === "boolean"
    ? next.purposeDisclosureRequired
    : !next.selfDirected;
  next.hostReceptionRequired = typeof next.hostReceptionRequired === "boolean"
    ? next.hostReceptionRequired
    : !next.selfDirected;
  const workExchange = next.paymentMode === "work_exchange" || next.requestedService === "work_meal";
  const noService = !next.requestedService || next.requestedService === "none";
  const zoneDefaults = VISIT_ZONE_DEFAULTS[next.kind] || VISIT_ZONE_DEFAULTS.visit;
  const purposeStatus = ["undisclosed", "declared"].includes(next.purposeStatus)
    ? next.purposeStatus
    : ["undisclosed", "declared"].includes(next.purposeDisclosureStatus)
      ? next.purposeDisclosureStatus
      : "undisclosed";
  next.stage = next.stage || "waiting";
  next.purposeStatus = purposeStatus;
  next.purposeDisclosureStatus = purposeStatus;
  next.declaredPurpose = purposeStatus === "declared" ? (next.declaredPurpose || next.purpose || "") : "";
  next.businessStatus = next.businessStatus || (next.kind === "business" ? "pending" : "not_required");
  next.purposeAction = next.purposeAction || (next.kind === "business" ? next.purpose || "办完来访事务" : "");
  next.purposeZoneIds = [...new Set(next.purposeZoneIds?.length ? next.purposeZoneIds : zoneDefaults.purpose)];
  next.allowedZoneIds = [...new Set(next.allowedZoneIds?.length ? next.allowedZoneIds : zoneDefaults.allowed)];
  next.businessObjectIds = [...new Set(next.businessObjectIds || [])];
  next.carriedObjectIds = [...new Set(next.carriedObjectIds || [])];
  next.purposes = (Array.isArray(next.purposes) ? next.purposes : []).map((purpose, index) => ({
    ...deepClone(purpose || {}),
    id: purpose?.id || `purpose-${index + 1}`,
    targetActorIds: [...new Set(purpose?.targetActorIds || (purpose?.targetCharacterId ? [purpose.targetCharacterId] : []))],
    responsibleActorIds: [...new Set(purpose?.responsibleActorIds || [])],
    objectIds: [...new Set(purpose?.objectIds || [])],
    zoneIds: [...new Set(purpose?.zoneIds || [])],
  }));
  next.arrivalCue = next.arrivalCue || "带着随身物件站在门槛内";
  next.carriedObjectLabel = next.carriedObjectLabel || "随身物件";
  next.workStatus = next.workStatus || (workExchange ? "unassigned" : "not_required");
  next.serviceRequestStatus = next.serviceRequestStatus
    || (noService ? "not_requested" : "requested");
  next.serviceStatus = next.serviceStatus || (noService ? "not_required" : next.servedOffering ? "served" : "pending");
  next.servicePreparationStatus = next.servicePreparationStatus
    || (noService ? "not_required" : next.serviceStatus === "served" ? "delivered" : "not_started");
  next.serviceProcessId = next.serviceProcessId || "";
  next.serviceConsumptionStatus = next.serviceConsumptionStatus
    || (noService ? "not_required" : next.serviceStatus === "served" ? "legacy_untracked" : "not_served");
  next.servedObjectIds = [...new Set(next.servedObjectIds || [])];
  next.paymentStatus = next.paymentStatus || (noService ? "not_required" : workExchange ? "unsettled" : "unpaid");
  next.deliveryStatus = next.deliveryStatus || (next.kind === "delivery" ? "pending" : "not_required");
  next.lodgingStatus = next.lodgingStatus || (next.requestedService === "lodging_meal" ? "pending" : "not_required");
  next.lodgingKeyObjectIds = [...new Set(next.lodgingKeyObjectIds || [])];
  const personalOpenLoops = Array.isArray(next.personalOpenLoops) ? next.personalOpenLoops : [];
  for (const purpose of next.purposes.filter((row) => row.kind === "social_request")) {
    const desire = purpose.label || purpose.description || "";
    const targetCharacterId = purpose.targetActorIds?.[0] || purpose.targetCharacterId || "";
    if (!desire || personalOpenLoops.some((loop) => loop.sourceId === purpose.id)) continue;
    personalOpenLoops.push({
      id: `personal_loop:${next.id || next.visitorId}:purpose:${purpose.id}`,
      sourceId: purpose.id,
      ownerCharacterId: next.visitorId,
      targetCharacterId,
      desire,
      status: "open",
      resolutionEvidenceIds: [],
    });
  }
  const legacySecondaryAlreadyRepresented = personalOpenLoops.some((loop) => (
    loop.sourceId === "secondaryObjective"
    || (
      loop.targetCharacterId === (next.secondaryTargetId || "")
      && loop.desire === next.secondaryObjective
    )
  ));
  if (next.secondaryObjective && !legacySecondaryAlreadyRepresented) {
    personalOpenLoops.push({
      id: `personal_loop:${next.id || next.visitorId}:secondary`,
      sourceId: "secondaryObjective",
      ownerCharacterId: next.visitorId,
      targetCharacterId: next.secondaryTargetId || "",
      desire: next.secondaryObjective,
      status: "open",
      resolutionEvidenceIds: [],
    });
  }
  next.personalOpenLoops = personalOpenLoops.map((loop) => ({
    ...loop,
    status: ["open", "deferred", "resolved", "abandoned_by_choice"].includes(loop.status) ? loop.status : "open",
    resolutionEvidenceIds: [...new Set(loop.resolutionEvidenceIds || [])],
  }));
  next.seatingPositionId = next.seatingPositionId || "";
  next.serviceTransactionStatus = next.serviceTransactionStatus || (next.selfDirected ? "not_required" : "open");
  next.departureEligible = next.selfDirected || Boolean(next.departureEligible);
  next.departureDue = Boolean(next.departureDue);
  return next;
}

function tavernCommitmentSceneConfig(visit = {}) {
  return {
    disclosureZoneIds: ["threshold", "hall"],
    receptionZoneIds: ["hall"],
    businessZoneIds: visit.purposeZoneIds?.length ? [...visit.purposeZoneIds] : ["hall"],
    workAssignerActorIds: [...(visit.expectedHostIds || [])],
    workAgreementZoneIds: ["hall"],
    serviceActorIds: [...(visit.expectedHostIds || [])],
    serviceZoneIds: ["hall", "counter", "stove"],
    paymentActorIds: [...(visit.expectedHostIds || [])],
    paymentZoneIds: ["hall", "counter"],
    compensationActorIds: [...(visit.expectedHostIds || [])],
    compensationZoneIds: ["hall"],
  };
}

function ensureVisitCommitments(state = {}, rawVisit = {}) {
  const visit = ensureVisitState(rawVisit);
  if (isSelfDirectedVisit(visit)) {
    const visitor = characterById(state, visit.visitorId);
    const privatePursuit = text(visitor?.lifeProfile?.privatePursuit || visitor?.lifeState?.activeGoal, 220);
    if (privatePursuit && !(visit.personalOpenLoops || []).some((row) => row.sourceId === "privatePursuit")) {
      visit.personalOpenLoops.push({
        id: `personal_loop:${visit.id || visit.visitorId}:private-pursuit`,
        sourceId: "privatePursuit",
        ownerCharacterId: visit.visitorId,
        targetCharacterId: "",
        desire: privatePursuit,
        status: "open",
        resolutionEvidenceIds: [],
      });
    }
    for (const loop of unresolvedEcologyVisitLoops(visitor || {}, visit)) {
      if (!(visit.personalOpenLoops || []).some((row) => row.sourceId === loop.sourceId)) {
        visit.personalOpenLoops.push(loop);
      }
    }
    refreshVisitStage(visit);
    return visit;
  }
  const existingGraph = visit.objectiveGraph;
  const graphIds = existingGraph?.metadata?.objectiveIds || {};
  const graphDisclosure = (existingGraph?.objectives || []).find((objective) => objective.id === graphIds.disclosure);
  const graphReception = (existingGraph?.objectives || []).find((objective) => objective.id === graphIds.reception);
  const legacyStateIsAhead = Number(existingGraph?.revision || 0) === 0 && (
    (visitPurposeIsPublic(visit) && graphDisclosure?.status !== "completed")
    || (Boolean(visit.hostId || visit.receivedBy) && graphReception?.status !== "completed")
    || (["assigned", "done", "verified", "offered", "refused"].includes(visit.workStatus) && visit.workExchange?.agreement?.status === "unoffered")
  );
  if (legacyStateIsAhead) delete visit.objectiveGraph;
  const graph = ensureVisitObjectiveGraph({
    visit,
    workOrders: state.tavernState?.workOrders || [],
    sceneConfig: tavernCommitmentSceneConfig(visit),
  });
  Object.assign(visit, syncLegacyVisitFieldsFromGraph(visit, graph));
  ensureVisitState(visit);
  refreshVisitStage(visit);
  return visit;
}

function refreshVisitStage(visit) {
  ensureVisitState(visit);
  if (["refused", "abandoned"].includes(visit.stage)) {
    visit.serviceTransactionStatus = visit.stage;
    visit.departureEligible = true;
    return visit.stage;
  }
  if (visit.stage === "completed" && visit.serviceConsumptionStatus !== "pending") {
    visit.serviceTransactionStatus = "completed";
    visit.departureEligible = true;
    return visit.stage;
  }
  if (isSelfDirectedVisit(visit)) {
    const hasServiceTransaction = Boolean(visit.requestedService && visit.requestedService !== "none");
    const serviceDelivered = visit.serviceStatus === "served";
    const serviceConsumed = ["consumed", "legacy_untracked"].includes(visit.serviceConsumptionStatus);
    const paymentDone = ["paid", "credit", "work_settled"].includes(visit.paymentStatus);
    if (!hasServiceTransaction) {
      visit.stage = "self_directed";
      visit.serviceTransactionStatus = "not_required";
      visit.departureEligible = true;
    } else if (serviceDelivered && serviceConsumed && paymentDone) {
      visit.stage = "self_directed";
      visit.serviceTransactionStatus = "completed";
      visit.departureEligible = true;
    } else {
      visit.stage = serviceDelivered ? "self_directed_service_served" : "self_directed_service_requested";
      visit.serviceTransactionStatus = "open";
      visit.departureEligible = false;
    }
    visit.departureDue = false;
    return visit.stage;
  }
  const workExchange = visit.paymentMode === "work_exchange" || visit.requestedService === "work_meal";
  const deliveryDone = visit.deliveryStatus === "not_required" || visit.deliveryStatus === "accepted";
  const serviceDelivered = visit.serviceStatus === "served" || !visit.requestedService || visit.requestedService === "none";
  const serviceConsumed = ["consumed", "legacy_untracked"].includes(visit.serviceConsumptionStatus)
    || !visit.requestedService
    || visit.requestedService === "none";
  const serviceDone = serviceDelivered && serviceConsumed;
  const lodgingDone = visit.lodgingStatus === "not_required" || visit.lodgingStatus === "assigned";
  const businessDone = visit.businessStatus === "not_required" || visit.businessStatus === "done";
  const paymentDone = !visit.requestedService || visit.requestedService === "none"
    ? true
    : workExchange ? visit.paymentStatus === "work_settled" : ["paid", "credit"].includes(visit.paymentStatus);
  if (deliveryDone && serviceDone && lodgingDone && businessDone && paymentDone) visit.stage = "completed";
  else if (workExchange && visit.workStatus === "refused") visit.stage = "refused";
  else if (workExchange && visit.workStatus === "verified") visit.stage = "work_verified";
  else if (workExchange && visit.workStatus === "done") visit.stage = "work_done";
  else if (workExchange && visit.workStatus === "assigned") visit.stage = "work_assigned";
  else if (workExchange && visit.workStatus === "offered") visit.stage = "work_offered";
  else if (businessDone && visit.kind === "business") visit.stage = "business_done";
  else if (serviceDone) visit.stage = "served";
  else if (deliveryDone && visit.kind === "delivery") visit.stage = "business_done";
  else if (visit.hostId) visit.stage = "received";
  else visit.stage = "waiting";
  visit.serviceTransactionStatus = visit.stage === "completed" ? "completed" : "open";
  visit.departureEligible = visit.stage === "completed";
  return visit.stage;
}

function addLedgerEntry(tavern, entry) {
  if ((tavern.ledger || []).some((candidate) => candidate.visitId === entry.visitId && candidate.type === entry.type)) return;
  tavern.ledger = [...(tavern.ledger || []), {
    id: createId("tavern_ledger"),
    ...deepClone(entry),
  }].slice(-48);
}

function visitTargetZone(runtime, visit) {
  return runtime.agents?.[visit.visitorId]?.zoneId || "hall";
}

function actorCanPerceiveVisit(runtime, actorId, visit, perceivedCharacterIds = []) {
  if (actorId === visit.visitorId) return true;
  if (actorId === visit.hostId) return true;
  if (perceivedCharacterIds.length) return perceivedCharacterIds.includes(visit.visitorId);
  return Boolean(runtime.agents?.[visit.visitorId]?.present);
}

function sameZone(runtime, actorId, visit) {
  return runtime.agents?.[actorId]?.zoneId === visitTargetZone(runtime, visit);
}

function visitPurposeIsPublic(visit = {}) {
  return ensureVisitState(visit).purposeStatus === "declared";
}

function purposeDisclosureTerms(visit = {}) {
  if (visit.kind === "business") return ["核", "名录", "登记", "候选", "记录"];
  if (visit.kind === "delivery") return ["送", "药包", "清单", "货"];
  if (visit.paymentMode === "work_exchange" || visit.requestedService === "work_meal") return ["换饭", "杂务", "做活", "干活"];
  if (/lodging|room/u.test(visit.requestedService || "") || visit.kind === "lodging") return ["住", "歇脚", "留宿", "客房", "房间"];
  if (/meal|food/u.test(visit.requestedService || "")) return ["饭", "吃"];
  if (/tea|water/u.test(visit.requestedService || "")) return ["茶", "水", "喝"];
  return text(visit.purpose, 120).split(/[，。；、\s]/).filter((term) => term.length >= 2).slice(0, 5);
}

export function tavernVisitPurposeSpeechIsConcrete(visitOrAffordance = {}, speech = "") {
  const line = text(speech, 220);
  const terms = visitOrAffordance.requiredPurposeTerms?.length
    ? visitOrAffordance.requiredPurposeTerms
    : purposeDisclosureTerms(visitOrAffordance);
  return Boolean(line && terms.some((term) => line.includes(term)));
}

function nextZoneToward(runtime = {}, fromZoneId = "", toZoneId = "") {
  if (!fromZoneId || !toZoneId || fromZoneId === toZoneId) return "";
  const edges = runtime.topology?.edges || [];
  const neighbors = (zoneId) => edges.flatMap((edge) => {
    if (!Number.isFinite(Number(edge.move))) return [];
    if (edge.from === zoneId) return [edge.to];
    if (edge.to === zoneId) return [edge.from];
    return [];
  });
  const queue = [{ zoneId: fromZoneId, firstStep: "" }];
  const seen = new Set([fromZoneId]);
  while (queue.length) {
    const current = queue.shift();
    for (const neighbor of neighbors(current.zoneId)) {
      if (seen.has(neighbor)) continue;
      const firstStep = current.firstStep || neighbor;
      if (neighbor === toZoneId) return firstStep;
      seen.add(neighbor);
      queue.push({ zoneId: neighbor, firstStep });
    }
  }
  return "";
}

function affordance(input = {}) {
  return {
    id: input.id,
    type: input.type,
    label: input.label,
    visitId: input.visitId,
    targetCharacterId: input.targetCharacterId || "",
    requiredZoneId: input.requiredZoneId || "",
    actionType: input.actionType || "interact",
    moveToZoneId: input.moveToZoneId || "",
    objectiveId: input.objectiveId || "",
    priorityClass: input.priorityClass || "",
    obligationPriority: Math.max(0, Math.min(1, Number(input.obligationPriority || 0))),
    commitmentPressure: Math.max(0, Math.min(100, Number(input.commitmentPressure || 0))),
    waitingOnly: input.waitingOnly === true,
    taskId: input.taskId || "",
    taskZoneId: input.taskZoneId || "",
    roomId: input.roomId || "",
    offeringId: input.offeringId || "",
    offering: deepClone(input.offering || null),
    price: deepClone(input.price || input.offering?.price || null),
    paymentCapacity: deepClone(input.paymentCapacity || null),
    needChannels: [...new Set(input.needChannels || input.offering?.needChannels || [])],
    seatingPositionId: input.seatingPositionId || "",
    position: deepClone(input.position || null),
    processId: input.processId || "",
    processKind: input.processKind || "",
    stationZoneId: input.stationZoneId || "",
    durationSeconds: Math.max(0, Number(input.durationSeconds || 0)),
    attentionMode: input.attentionMode || "",
    finalServeType: input.finalServeType || "",
    keyPoolZoneId: input.keyPoolZoneId || "",
    returnMode: input.returnMode || "",
    requiredUnits: Math.max(0, Number(input.requiredUnits || 0)),
    completedUnits: Math.max(0, Number(input.completedUnits || 0)),
    completionCriteria: [...new Set(input.completionCriteria || [])],
    objectIds: [...new Set(input.objectIds || [])],
    toolIds: [...new Set(input.toolIds || [])],
    bodyDemand: deepClone(input.bodyDemand || TAVERN_AFFORDANCE_BODY_DEMAND[input.type] || { exertion: 12, energyDemand: 4 }),
    requiresSpeech: Boolean(input.requiresSpeech),
    allowSpeech: input.allowSpeech !== false,
    allowedSpeechActs: [...new Set(input.allowedSpeechActs || [])],
    requiredPurposeTerms: [...new Set(input.requiredPurposeTerms || [])],
    canonicalVisibleAction: input.canonicalVisibleAction || "",
    authoritativeFact: input.authoritativeFact || "",
  };
}

function workUnitVisibleAction({ visitorName = "来客", work = {}, workOrder = {}, completedUnits = 0, requiredUnits = 1 } = {}) {
  const unitLabel = workOrder.unitLabel || "项";
  const unitAction = text(work.unitAction || work.description || `做完一${unitLabel}眼前的活`)
    .replace(/[。！？!?]+$/u, "");
  const nextUnit = Math.max(1, Number(completedUnits || 0) + 1);
  const totalUnits = Math.max(1, Number(requiredUnits || 1));
  if (nextUnit === 1 || totalUnits === 1) return `${visitorName}${unitAction}。`;
  if (nextUnit >= totalUnits) return `${visitorName}又${unitAction}，把这轮的活收了尾。`;
  return `${visitorName}接着${unitAction}，眼下做到第${nextUnit}${unitLabel}。`;
}

export function tavernPublicVisitPresenceCue(state = {}, visit = {}, {
  observerActorId = "",
  zoneId = "",
  zoneLabel = "",
  noticedObjectIds = null,
} = {}) {
  const ledger = normalizeObjectLedger(state.tavernState?.objectLedger || {});
  const noticedObjectIdSet = noticedObjectIds == null
    ? null
    : new Set([...(noticedObjectIds || [])].filter(Boolean));
  const heldObjects = Object.values(ledger.objects || {}).filter((object) => (
    object.holderActorId === visit.visitorId
    && objectVisibleToObserver(object, observerActorId)
    && (noticedObjectIdSet == null || noticedObjectIdSet.has(object.id))
  ));
  const worn = heldObjects.filter((object) => object.attachment?.active === true);
  const inHand = heldObjects.filter((object) => object.attachment?.active !== true && object.custody?.inHand === true);
  const otherwiseVisible = heldObjects.filter((object) => (
    object.attachment?.active !== true && object.custody?.inHand !== true
  ));
  const appearances = [
    worn.length ? `佩着${worn.map(objectPublicPerceptionLabel).join("、")}` : "",
    inHand.length ? `手里拿着${inHand.map(objectPublicPerceptionLabel).join("、")}` : "",
    otherwiseVisible.length ? `带着${otherwiseVisible.map(objectPublicPerceptionLabel).join("、")}` : "",
  ].filter(Boolean);
  const effectiveZoneId = zoneId || "threshold";
  const seatedPosition = guestPositionRows(state.tavernState || {}).find((row) => row.id === visit.seatingPositionId);
  const position = seatedPosition
    ? `坐在${seatedPosition.label}`
    : effectiveZoneId === "threshold"
    ? "站在门槛内"
    : effectiveZoneId === "hall"
      ? "留在堂前"
      : `留在${zoneLabel || effectiveZoneId || "原处"}`;
  return [...appearances, position].join("，");
}

function tavernVisitSettledInteractionEvents(state = {}, rawVisit = {}) {
  const visit = ensureVisitState(deepClone(rawVisit));
  const tavern = state.tavernState || {};
  const ledger = normalizeObjectLedger(tavern.objectLedger || {});
  const visitorId = visit.visitorId || "";
  const visitorName = visit.visitorName || characterById(state, visitorId)?.name || "来客";
  const events = [];
  const found = new Set();
  const add = (event = {}) => {
    const actorId = event.actorId || "";
    const kind = event.kind || event.actionType || "interaction";
    const actionId = event.actionId || "";
    const id = event.id || `settled-operation:tavern:${visit.id || visitorId}:${kind}:${actorId}:${actionId || "state"}`;
    if (!actorId || found.has(id)) return;
    found.add(id);
    const counterpartyIds = [...new Set(event.counterpartyIds || [visitorId].filter((value) => value && value !== actorId))];
    const sharedWithActorIds = [...new Set(event.sharedWithActorIds || counterpartyIds)];
    events.push({
      authority: "tavern-objective-settlement",
      status: "settled",
      visitId: visit.id || "",
      zoneId: event.zoneId || "",
      objectIds: [...new Set(event.objectIds || [])],
      counterpartyIds,
      sharedWithActorIds,
      participantIds: [...new Set([actorId, ...counterpartyIds, ...sharedWithActorIds, visitorId].filter(Boolean))],
      ...deepClone(event),
      id,
      actorId,
      kind,
      actionType: event.actionType || kind,
      actionId,
    });
  };

  const servedObjects = (visit.servedObjectIds || []).map((objectId) => ledger.objects?.[objectId]).filter(Boolean);
  const servedByRows = servedObjects.map((object) => ({
    actorId: object.state?.servedByActorId || "",
    actionId: object.state?.servedByActionId || "",
    objectId: object.id,
    zoneId: object.zoneId || "",
  })).filter((row) => row.actorId);
  if (visit.servedBy && !servedByRows.some((row) => row.actorId === visit.servedBy)) {
    const process = serviceProcessForVisit(tavern, visit);
    servedByRows.push({
      actorId: visit.servedBy,
      actionId: process?.metadata?.deliveredByActionId || "",
      objectId: visit.servedObjectIds?.[0] || "",
      zoneId: ledger.objects?.[visit.servedObjectIds?.[0]]?.zoneId || "",
    });
  }
  for (const row of servedByRows) {
    const actorName = characterById(state, row.actorId)?.name || row.actorId;
    const offering = offeringFor(state, visit.servedOffering || visit.requestedService);
    add({
      kind: "service_delivery",
      actionType: "serve_guest",
      actorId: row.actorId,
      actionId: row.actionId,
      objectIds: [row.objectId].filter(Boolean),
      zoneId: row.zoneId,
      counterpartyIds: [visitorId],
      summary: `${actorName}已经亲手把${offering.label}交给${visitorName}`,
      topic: offering.label,
      objectLabel: offering.label,
    });
  }
  if (visit.serviceRequestedByActionId && visitorId) add({
    kind: "service_request",
    actionType: "request_service",
    actorId: visitorId,
    actionId: visit.serviceRequestedByActionId,
    counterpartyIds: [visit.hostId].filter(Boolean),
    summary: `${visitorName}已经提出${offeringFor(state, visit.requestedService).label}的请求`,
    topic: offeringFor(state, visit.requestedService).label,
  });
  if (visit.serviceConsumedBy && visit.serviceConsumedByActionId) add({
    kind: "service_consumption",
    actionType: "consume_service",
    actorId: visit.serviceConsumedBy,
    actionId: visit.serviceConsumedByActionId,
    counterpartyIds: [visit.servedBy].filter(Boolean),
    objectIds: [...(visit.servedObjectIds || [])],
    summary: `${visitorName}已经吃用完${offeringFor(state, visit.requestedService).label}`,
    topic: offeringFor(state, visit.requestedService).label,
  });
  if (visit.receivedBy) add({
    kind: "reception",
    actionType: "receive_guest",
    actorId: visit.receivedBy,
    counterpartyIds: [visitorId],
    summary: `${characterById(state, visit.receivedBy)?.name || visit.receivedBy}已经接下${visitorName}这次来访的经手事务`,
    topic: "来客接待",
  });
  if (visit.deliveryAcceptedBy) add({
    kind: "delivery_acceptance",
    actionType: "accept_delivery",
    actorId: visit.deliveryAcceptedBy,
    actionId: visit.deliveryAcceptedActionId || "",
    counterpartyIds: [visitorId],
    objectIds: [...(visit.businessObjectIds || [])],
    summary: `${characterById(state, visit.deliveryAcceptedBy)?.name || visit.deliveryAcceptedBy}已经验收${visitorName}带来的货物和清单`,
    topic: "货物验收",
  });
  if (visit.roomAssignedBy) add({
    kind: "lodging_assignment",
    actionType: "assign_lodging",
    actorId: visit.roomAssignedBy,
    actionId: visit.roomAssignedActionId || "",
    counterpartyIds: [visitorId],
    objectIds: [...(visit.lodgingKeyObjectIds || [])],
    summary: `${characterById(state, visit.roomAssignedBy)?.name || visit.roomAssignedBy}已经把客房和钥匙交代给${visitorName}`,
    topic: "客房安排",
  });
  if (visit.businessCompletedBy) add({
    kind: "visit_business",
    actionType: "perform_visit_business",
    actorId: visit.businessCompletedBy,
    actionId: visit.businessCompletedActionId || "",
    counterpartyIds: [visitorId],
    objectIds: [...(visit.businessObjectIds || [])],
    summary: `${characterById(state, visit.businessCompletedBy)?.name || visit.businessCompletedBy}已经办完${visitorName}这次来访的登记事务`,
    topic: "来访事务",
  });
  if (visit.workAssignedBy) add({
    kind: "work_assignment",
    actionType: "assign_work",
    actorId: visit.workAssignedBy,
    counterpartyIds: [visitorId],
    summary: `${characterById(state, visit.workAssignedBy)?.name || visit.workAssignedBy}已经向${visitorName}提出${visit.workExchange?.taskLabel || "杂务"}的范围和条件`,
    topic: visit.workExchange?.taskLabel || "杂务安排",
  });
  if (visit.workCompletedBy) add({
    kind: "work_submission",
    actionType: "submit_work",
    actorId: visit.workCompletedBy,
    counterpartyIds: [visit.workAssignedBy || visit.hostId].filter(Boolean),
    summary: `${visitorName}已经提交${visit.workExchange?.taskLabel || "杂务"}的完成结果`,
    topic: visit.workExchange?.taskLabel || "杂务提交",
  });
  const visitLedger = (tavern.ledger || []).filter((entry) => entry.visitId === visit.id);
  for (const entry of visitLedger.filter((row) => ["sale", "credit", "work_exchange"].includes(row.type))) add({
    id: `settled-operation:tavern:${visit.id}:payment_settlement:${entry.id || entry.actorId}`,
    kind: "payment_settlement",
    actionType: entry.type === "work_exchange" ? "settle_work_exchange" : "settle_cash",
    actorId: entry.actorId,
    actionId: entry.actionId || "",
    counterpartyIds: [entry.counterpartyId || visitorId].filter(Boolean),
    summary: entry.description || `${visitorName}这次消费的账已经处理`,
    topic: "账目结算",
  });
  if (visit.settledBy && !events.some((event) => event.kind === "payment_settlement" && event.actorId === visit.settledBy)) add({
    kind: "payment_settlement",
    actionType: "settle_cash",
    actorId: visit.settledBy,
    counterpartyIds: [visitorId],
    summary: `${visitorName}这次消费的账已经由${characterById(state, visit.settledBy)?.name || visit.settledBy}处理`,
    topic: "账目结算",
  });
  return events;
}

/** Recipient-specific settled interaction provenance for active visits. */
export function tavernSettledInteractionEvents(state = {}, actorId = "") {
  const observerId = actorId || "";
  const events = (state.tavernState?.activeVisits || []).flatMap((visit) => (
    tavernVisitSettledInteractionEvents(state, visit)
  ));
  return events.filter((event) => !observerId || event.participantIds.includes(observerId));
}

function tavernVisitOperationalVisibility(state = {}, visit = {}, actorId = "") {
  const ownVisit = actorId === visit.visitorId;
  const host = actorId === visit.hostId || actorId === visit.receivedBy;
  const expectedHost = (visit.expectedHostIds || []).includes(actorId);
  const institution = state.tavernState?.institution || {};
  const publicInstitutionWorker = visitPurposeIsPublic(visit) && new Set([
    ...(institution.ownerIds || []),
    institution.operatorId,
    ...(institution.householdWorkerIds || []),
  ].filter(Boolean)).has(actorId);
  const events = tavernVisitSettledInteractionEvents(state, visit);
  const ownsKind = (...kinds) => events.some((event) => event.actorId === actorId && kinds.includes(event.kind));
  const process = serviceProcessForVisit(state.tavernState || {}, visit);
  return {
    all: ownVisit || host,
    service: ownVisit || host || expectedHost || publicInstitutionWorker || ownsKind("service_request", "service_delivery", "service_consumption") || process?.ownerActorId === actorId,
    payment: ownVisit || host || expectedHost || publicInstitutionWorker || ownsKind("payment_settlement"),
    delivery: ownVisit || host || expectedHost || publicInstitutionWorker || ownsKind("delivery_acceptance"),
    lodging: ownVisit || host || expectedHost || publicInstitutionWorker || ownsKind("lodging_assignment"),
    business: ownVisit || host || expectedHost || publicInstitutionWorker || ownsKind("visit_business"),
    work: ownVisit || host || expectedHost || publicInstitutionWorker || ownsKind("work_assignment", "work_submission"),
  };
}

export function tavernCausalMaterialFacts(
  state = {},
  runtime = {},
  actorId = "",
  perceivedCharacterIds = [],
  noticedObjectIds = null,
) {
  return (state.tavernState?.activeVisits || []).map((rawVisit) => {
    const visit = ensureVisitCommitments(state, deepClone(rawVisit));
    const visitorRuntime = runtime.agents?.[visit.visitorId];
    if (!visitorRuntime?.present) return null;
    const operationalParticipant = tavernVisitSettledInteractionEvents(state, visit)
      .some((event) => event.participantIds.includes(actorId));
    if (!actorCanPerceiveVisit(runtime, actorId, visit, perceivedCharacterIds)
      && actorId !== visit.hostId
      && !operationalParticipant
      && !(visit.expectedHostIds || []).includes(actorId)) return null;
    const ownVisit = actorId === visit.visitorId;
    const publicPurpose = visitPurposeIsPublic(visit);
    // A person may publicly order tea while keeping a different personal aim
    // private. Being the service host grants access to the transaction that
    // happened with that host; it does not reveal the visitor's undisclosed
    // purpose, personal loops, or purpose-specific route.
    const purposeFactsVisible = ownVisit || publicPurpose;
    const operationalVisibility = tavernVisitOperationalVisibility(state, visit, actorId);
    const operationalFactsVisible = Object.values(operationalVisibility).some(Boolean);
    const refreshedStage = refreshVisitStage(visit);
    const publicArrivalCue = tavernPublicVisitPresenceCue(state, visit, {
      observerActorId: actorId,
      zoneId: visitorRuntime.zoneId,
      zoneLabel: runtime.topology?.zones?.[visitorRuntime.zoneId]?.label || "",
      noticedObjectIds,
    });
    const seatingPosition = guestPositionRows(state.tavernState || {}).find((row) => row.id === visit.seatingPositionId) || null;
    const requestedService = operationalVisibility.service ? visit.requestedService : "unknown";
    const settledInteractionEvents = tavernVisitSettledInteractionEvents(state, visit)
      .filter((event) => event.participantIds.includes(actorId));
    return {
      visitId: visit.id,
      visitorId: visit.visitorId,
      visitorName: visit.visitorName,
      purpose: purposeFactsVisible ? visit.purpose : "尚未说明",
      purposeStatus: visit.purposeStatus,
      arrivalCue: ownVisit ? visit.arrivalCue : publicArrivalCue,
      purposeAction: purposeFactsVisible ? visit.purposeAction : "",
      purposeZoneIds: purposeFactsVisible ? [...visit.purposeZoneIds] : [],
      allowedZoneIds: ownVisit ? [...visit.allowedZoneIds] : [],
      requestedService,
      serviceRequestStatus: operationalVisibility.service ? visit.serviceRequestStatus : "unknown",
      seatingPositionId: ownVisit ? visit.seatingPositionId || "" : "",
      seatingPosition: seatingPosition ? (ownVisit
        ? deepClone(seatingPosition)
        : { id: "", label: seatingPosition.label, zoneId: seatingPosition.zoneId }) : null,
      offeringLabel: operationalVisibility.service && requestedService && requestedService !== "none"
        ? offeringFor(state, requestedService).label
        : "",
      price: operationalVisibility.service
        ? requestedService && requestedService !== "none"
          ? Number(offeringFor(state, requestedService).price || 0)
          : 0
        : null,
      currency: "枚铜钱",
      paymentMode: operationalVisibility.payment ? visit.paymentMode : "unknown",
      stage: operationalVisibility.all ? refreshedStage : "present",
      hostId: operationalVisibility.all ? visit.hostId || "" : "",
      workStatus: operationalVisibility.work ? visit.workStatus : "unknown",
      serviceStatus: operationalVisibility.service ? visit.serviceStatus : "unknown",
      servicePreparationStatus: operationalVisibility.service ? visit.servicePreparationStatus || "not_started" : "unknown",
      serviceProcess: operationalVisibility.service ? (() => {
        const process = serviceProcessForVisit(state.tavernState || {}, visit);
        if (!process) return null;
        return {
          id: process.id,
          kind: process.kind,
          ownerActorId: process.ownerActorId,
          stationZoneId: process.stationZoneId,
          status: process.status,
          durationSeconds: process.durationSeconds,
          readyAtSeconds: process.readyAtSeconds,
          objectIds: [...process.objectIds],
        };
      })() : null,
      paymentStatus: operationalVisibility.payment ? visit.paymentStatus : "unknown",
      deliveryStatus: operationalVisibility.delivery ? visit.deliveryStatus : "unknown",
      lodgingStatus: operationalVisibility.lodging ? visit.lodgingStatus : "unknown",
      businessStatus: operationalVisibility.business ? visit.businessStatus : "unknown",
      serviceTransactionStatus: operationalVisibility.all ? visit.serviceTransactionStatus : "unknown",
      departureEligible: operationalVisibility.all ? visit.departureEligible : null,
      personalOpenLoops: ownVisit
        ? deepClone((visit.personalOpenLoops || []).filter((loop) => ["open", "deferred"].includes(loop.status)))
        : [],
      objectiveSummary: purposeFactsVisible ? deepClone(visit.objectiveSummary || {}) : {},
      workExchange: operationalVisibility.work ? deepClone(visit.workExchange || null) : null,
      departureDue: operationalVisibility.all ? visit.departureDue : null,
      settledInteractionEvents: deepClone(settledInteractionEvents),
      authoritativeFact: operationalFactsVisible ? [
        operationalVisibility.all ? `${visit.visitorName || "来客"}的事务阶段为${refreshedStage}` : "",
        operationalVisibility.delivery && visit.deliveryStatus === "accepted" ? "货物已经验收" : "",
        operationalVisibility.service && visit.servicePreparationStatus === "preparing" ? `${offeringFor(state, requestedService).label}正在准备，尚未交付` : "",
        operationalVisibility.service && visit.servicePreparationStatus === "prepared" ? `${offeringFor(state, requestedService).label}已经准备好，尚未交付` : "",
        operationalVisibility.service && visit.serviceStatus === "served" ? `${offeringFor(state, requestedService).label}已经交付` : "",
        operationalVisibility.lodging && visit.lodgingStatus === "assigned" ? "客房和钥匙已经交代" : "",
        operationalVisibility.business && visit.businessStatus === "done" ? "来访公务已经按登记条目核完" : "",
        operationalVisibility.payment && ["paid", "credit", "work_settled"].includes(visit.paymentStatus) ? "账已经结清" : "",
      ].filter(Boolean).join("；") : `${visit.visitorName || "来客"}${publicArrivalCue}；来意尚未说明。`,
    };
  }).filter(Boolean);
}

export function listTavernCausalAffordances(state = {}, runtime = {}, actorId = "", perceivedCharacterIds = []) {
  const actor = characterById(state, actorId);
  const actorRuntime = runtime.agents?.[actorId];
  if (!actor || !actorRuntime?.present) return [];
  refreshTavernServiceProcesses(state.tavernState || {}, runtime);
  const authority = authorityFor(actor);
  const result = [];
  for (const rawVisit of state.tavernState?.activeVisits || []) {
    const visit = ensureVisitCommitments(state, rawVisit);
    refreshVisitStage(visit);
    if (!runtime.agents?.[visit.visitorId]?.present) continue;
    if (!actorCanPerceiveVisit(runtime, actorId, visit, perceivedCharacterIds)) continue;
    const visitorZoneId = visitTargetZone(runtime, visit);
    const coLocated = sameZone(runtime, actorId, visit);
    const expectedHost = !(visit.expectedHostIds || []).length || (visit.expectedHostIds || []).includes(actorId);
    const actorName = actor.name || actorId;
    const visitorName = visit.visitorName || runtime.agents?.[visit.visitorId]?.characterName || "来客";
    const purposeDeclared = visitPurposeIsPublic(visit);
    const actorZoneId = actorRuntime.zoneId;
    const hostRuntime = runtime.agents?.[visit.hostId];
    const perceivedIds = new Set(perceivedCharacterIds || []);
    const expectedHostIds = visit.expectedHostIds || [];
    const coLocatedExpectedHostId = expectedHostIds.find((id) => (
      perceivedIds.has(id)
      && runtime.agents?.[id]?.present
      && runtime.agents?.[id]?.zoneId === actorZoneId
    )) || "";
    const entryZoneId = actorId === visit.visitorId && actorZoneId === "threshold" && visit.allowedZoneIds.includes("hall") ? "hall" : "";
    const expectedHostAtEntryId = entryZoneId ? expectedHostIds.find((id) => (
      perceivedIds.has(id)
      && runtime.agents?.[id]?.present
      && runtime.agents?.[id]?.zoneId === entryZoneId
    )) || "" : "";
    const visibleExpectedHostId = coLocatedExpectedHostId || expectedHostAtEntryId;
    const declareMoveToZoneId = !coLocatedExpectedHostId && expectedHostAtEntryId ? entryZoneId : "";

    if (isSelfDirectedVisit(visit) && actorId === visit.visitorId) {
      if (entryZoneId) result.push(affordance({
        id: `enter_self_directed_visit:${visit.id}`,
        type: "enter_self_directed_visit",
        label: "按本人判断进入堂前",
        visitId: visit.id,
        actionType: "move",
        moveToZoneId: entryZoneId,
        canonicalVisibleAction: `${visitorName}越过门槛，进入堂前。`,
        authoritativeFact: `${visitorName}物理上可以进入对来客开放的堂前，不需要先虚构住店、接引或强制披露事务。`,
      }));
      if (actorZoneId === "hall") {
        const currentPositionId = actorGuestPositionId(state.tavernState || {}, actorId);
        for (const position of availableGuestPositions(state.tavernState || {}, actorId, actorZoneId)) {
          if (position.id === currentPositionId) continue;
          result.push(affordance({
            id: `take_guest_seat:${visit.id}:${position.id}`,
            type: "take_guest_seat",
            label: `到${position.label}落座`,
            visitId: visit.id,
            seatingPositionId: position.id,
            position,
            actionType: "act",
            canonicalVisibleAction: `${visitorName}走到${position.label}坐下，随身佩带的物件仍跟着本人。`,
            authoritativeFact: `${position.label}当前有可用位置；坐下只改变实际位置与在场条件，不会自动点单、付款、获得消息或完成私人目的。`,
          }));
        }
        const serviceChoice = buildTavernSituatedServiceChoice(state, runtime, actorId, perceivedCharacterIds);
        for (const request of serviceChoice?.requestAffordances || []) {
          if (request.type !== "request_service") continue;
          for (const operatorId of request.targetActorIds || []) {
            const operatorName = runtime.agents?.[operatorId]?.characterName || "酒馆经手人";
            result.push(affordance({
              id: `request_service:${visit.id}:${request.offeringId}:${operatorId}`,
              type: "request_service",
              label: `向${operatorName}点${request.offering?.label || request.offeringId}`,
              visitId: visit.id,
              targetCharacterId: operatorId,
              offeringId: request.offeringId,
              offering: request.offering,
              price: request.offering?.price,
              paymentCapacity: request.paymentCapacity,
              needChannels: request.offering?.needChannels,
              bodyDemand: request.offering?.bodyDemand,
              actionType: "interact",
              requiresSpeech: true,
              allowedSpeechActs: ["ask", "inform", "offer"],
              canonicalVisibleAction: `${visitorName}面向${operatorName}提出一项点单请求。`,
              authoritativeFact: `这只会打开一项待${operatorName}回应的服务请求；不会自动上茶饭、扣钱、结账或完成${visitorName}的私人目的。`,
            }));
          }
        }
      }
      const serviceOpen = visit.serviceTransactionStatus === "open"
        || Boolean(visit.requestedService && visit.requestedService !== "none" && visit.serviceTransactionStatus !== "completed");
      if (!serviceOpen) result.push(affordance({
        id: `leave_visit:${visit.id}`,
        type: "leave_visit",
        label: "由本人决定离开酒馆",
        visitId: visit.id,
        actionType: "leave",
        canonicalVisibleAction: `${visitorName}收好随身物件，从望梯酒馆离开。`,
        authoritativeFact: "人物当前没有未结服务事务；可以继续停留、另行发起真实交易，也可以自行离开。",
      }));
      if (!visit.requestedService || visit.requestedService === "none") continue;
    }

    if (TERMINAL_VISIT_STAGES.has(visit.stage)) {
      if (actorId === visit.visitorId && (visit.departureEligible || visit.departureDue)) {
        const lodgingKeys = lodgingKeyObjectsForVisit(state.tavernState, visit);
        const outstandingKeys = lodgingKeys.filter((object) => lodgingKeyStillOwed(object, visit));
        const missingAssignedKey = visit.lodgingStatus === "assigned" && visit.keyDelivered && lodgingKeys.length === 0;
        if (outstandingKeys.length) {
          const returnableKeys = outstandingKeys.filter((object) => (
            object.holderActorId === actorId
            || (!object.holderActorId && object.zoneId === actorZoneId)
          ));
          if (returnableKeys.length === outstandingKeys.length) {
            const returnOperatorId = coLocatedKeyReturnOperatorId(state, runtime, visit, actorZoneId);
            const poolZoneId = lodgingKeyPoolZone(outstandingKeys, visit);
            if (returnOperatorId || actorZoneId === poolZoneId) result.push(affordance({
              id: `return_lodging_key:${visit.id}:${outstandingKeys.map((object) => object.id).join("+")}`,
              type: "return_lodging_key",
              label: returnOperatorId ? "把客房钥匙交还经营者" : "把客房钥匙挂回可用钥匙池",
              visitId: visit.id,
              targetCharacterId: returnOperatorId,
              requiredZoneId: actorZoneId,
              objectIds: outstandingKeys.map((object) => object.id),
              returnMode: returnOperatorId ? "operator" : "pool",
              keyPoolZoneId: poolZoneId,
              actionType: "interact",
              canonicalVisibleAction: returnOperatorId
                ? `${visitorName}把客房钥匙当面交还给${runtime.agents?.[returnOperatorId]?.characterName || "柜台里接钥匙的人"}。`
                : `${visitorName}把客房钥匙挂回${runtime.topology?.zones?.[poolZoneId]?.label || "原来的钥匙池"}。`,
              authoritativeFact: "客房钥匙仍绑定本次入住；归还并解除占用后才能离店。",
            }));
            else {
              const nextZoneId = nextZoneToward(runtime, actorZoneId, poolZoneId);
              if (nextZoneId) result.push(affordance({
                id: `move_to_lodging_key_pool:${visit.id}:${nextZoneId}`,
                type: "move_to_lodging_key_pool",
                label: `去${runtime.topology?.zones?.[poolZoneId]?.label || "钥匙池"}归还客房钥匙`,
                visitId: visit.id,
                actionType: "move",
                moveToZoneId: nextZoneId,
                canonicalVisibleAction: `${visitorName}带着客房钥匙朝${runtime.topology?.zones?.[nextZoneId]?.label || nextZoneId}走去，准备归还后再离店。`,
                authoritativeFact: "客房钥匙尚未归还，不能带着钥匙离店。",
              }));
            }
          }
        } else if (!missingAssignedKey) result.push(affordance({
          id: `leave_visit:${visit.id}`,
          type: "leave_visit",
          label: "办完事务后离店",
          visitId: visit.id,
          actionType: "leave",
          canonicalVisibleAction: lodgingKeys.length
            ? `${visitorName}确认客房钥匙已经归还，收好随身物件，从望梯酒馆离开。`
            : `${visitorName}收好随身物件，从望梯酒馆离开。`,
          authoritativeFact: lodgingKeys.length
            ? "该次来访已经完成，客房钥匙也已归还，可以离店。"
            : "该次来访已经完成，可以离店。",
        }));
      }
      continue;
    }

    if (actorId === visit.visitorId && visit.purposeDisclosureRequired !== false && !purposeDeclared && visibleExpectedHostId) result.push(affordance({
      id: `declare_visit_purpose:${visit.id}`,
      type: "declare_visit_purpose",
      label: `向酒馆经手人说明：${visit.purpose}`,
      visitId: visit.id,
      targetCharacterId: visibleExpectedHostId,
      actionType: "speak",
      moveToZoneId: declareMoveToZoneId,
      requiresSpeech: true,
      allowedSpeechActs: ["greet", "inform", "ask"],
      requiredPurposeTerms: purposeDisclosureTerms(visit),
      canonicalVisibleAction: declareMoveToZoneId
        ? `${visitorName}越过门槛走进堂前，朝能接待自己的人开口。`
        : `${visitorName}站在原处，朝能接待自己的人开口。`,
      authoritativeFact: `${visitorName}尚未亲口说明本次来意。`,
    }));

    if (actorId === visit.visitorId && visit.purposeDisclosureRequired !== false && !purposeDeclared && !visibleExpectedHostId && entryZoneId) result.push(affordance({
      id: `approach_reception:${visit.id}`,
      type: "approach_reception",
      label: "从门槛进入堂前寻找可当面接待的人",
      visitId: visit.id,
      actionType: "move",
      moveToZoneId: entryZoneId,
      canonicalVisibleAction: `${visitorName}越过门槛走进堂前，先找能当面接待的人。`,
      authoritativeFact: `${visitorName}尚未遇到能当面说明来意的经手人。`,
    }));

    if (actorId === visit.visitorId && purposeDeclared && actorZoneId === "threshold" && visit.allowedZoneIds.includes("hall")) result.push(affordance({
      id: `move_to_hall:${visit.id}`,
      type: "move_to_hall",
      label: "从门槛进入堂前继续办事",
      visitId: visit.id,
      targetCharacterId: visit.hostId || visibleExpectedHostId,
      actionType: "move",
      moveToZoneId: "hall",
      canonicalVisibleAction: `${visitorName}越过门槛走进堂前。`,
      authoritativeFact: `${visitorName}已经说明来意，但仍站在门槛。`,
    }));

    if (authority.receiveGuest && expectedHost && visit.stage === "waiting" && !coLocated && visitorZoneId !== "threshold") {
      const nextZoneId = nextZoneToward(runtime, actorZoneId, visitorZoneId);
      if (nextZoneId) result.push(affordance({
        id: `approach_waiting_guest:${visit.id}`,
        type: "approach_waiting_guest",
        label: `走近正在等候的${visitorName}`,
        visitId: visit.id,
        targetCharacterId: visit.visitorId,
        actionType: "move",
        moveToZoneId: nextZoneId,
        canonicalVisibleAction: `${actorName}停下手里的事，从${runtime.topology?.zones?.[actorZoneId]?.label || "原处"}朝${runtime.topology?.zones?.[nextZoneId]?.label || nextZoneId}走去。`,
        authoritativeFact: purposeDeclared
          ? `${visitorName}已说明来意，但经手人还没有走到能当面交谈的地方。`
          : `${visitorName}已经进店，但还没有遇到能当面说明来意的经手人。`,
      }));
    }

    if (authority.receiveGuest && expectedHost && visit.stage === "waiting" && purposeDeclared && coLocated) result.push(affordance({
      id: `receive_guest:${visit.id}`,
      type: "receive_guest",
      label: `当面回应${visitorName}已经说明的来意`,
      visitId: visit.id,
      targetCharacterId: visit.visitorId,
      requiredZoneId: visitorZoneId,
      actionType: "speak",
      requiresSpeech: true,
      allowedSpeechActs: ["greet", "ask", "inform", "offer", "refuse"],
      canonicalVisibleAction: `${actorName}停下手里的事，在${runtime.topology?.zones?.[visitorZoneId]?.label || "近前"}面向${visitorName}。`,
      authoritativeFact: `${visitorName}已说明来意，仍在等酒馆经手人当面回应。`,
    }));

    if (actorId === visit.visitorId
      && visit.kind === "business"
      && purposeDeclared
      && visit.hostId
      && visit.businessStatus === "pending"
      && visit.purposeZoneIds.includes(actorZoneId)
      && hostRuntime?.present
      && hostRuntime.zoneId === actorZoneId) result.push(affordance({
      id: `perform_visit_business:${visit.id}`,
      type: "perform_visit_business",
      label: visit.purposeAction || `办完${visit.purpose}`,
      visitId: visit.id,
      targetCharacterId: visit.hostId,
      requiredZoneId: actorZoneId,
      objectIds: visit.businessObjectIds,
      actionType: "interact",
      canonicalVisibleAction: `${visitorName}在堂前桌上摊开${visit.carriedObjectLabel || "带来的纸页"}，逐项与酒馆留下的登记对照，并在已核条目旁落下记号。`,
      authoritativeFact: `${visit.purpose}尚未核完。`,
    }));

    if (visit.kind === "delivery" && visit.hostId && visit.deliveryStatus === "pending" && authority.acceptDelivery && coLocated) result.push(affordance({
      id: `accept_delivery:${visit.id}`,
      type: "accept_delivery",
      label: `验收${visitorName}带来的货物`,
      visitId: visit.id,
      targetCharacterId: visit.visitorId,
      requiredZoneId: visitorZoneId,
      objectIds: visit.carriedObjectIds,
      actionType: "interact",
      canonicalVisibleAction: `${actorName}当着${visitorName}的面逐项对过货物和清单，验收后才收进柜台。`,
      authoritativeFact: "这份货物尚未验收。",
    }));

    if (purposeDeclared && visit.requestedService === "lodging_meal" && visit.hostId === actorId && visit.lodgingStatus === "pending" && authority.receiveGuest && coLocated) {
      const lodgingKey = availableLodgingKey(state.tavernState, actorId);
      if (lodgingKey) result.push(affordance({
        id: `assign_lodging:${visit.id}:${lodgingKey.id}`,
        type: "assign_lodging",
        label: `向${visitorName}交代${lodgingKey.state?.roomId || "客房"}并交钥匙`,
        visitId: visit.id,
        targetCharacterId: visit.visitorId,
        requiredZoneId: visitorZoneId,
        objectIds: [lodgingKey.id],
        roomId: lodgingKey.state?.roomId || "",
        keyPoolZoneId: lodgingKey.state?.keyPoolZoneId || lodgingKey.zoneId || actorZoneId,
        actionType: "interact",
        canonicalVisibleAction: `${actorName}把${lodgingKey.label}交到${visitorName}手中，当面说明房间位置和留宿安排。`,
        authoritativeFact: "客房位置和钥匙尚未交付。",
      }));
    }

    const workExchange = visit.paymentMode === "work_exchange" || visit.requestedService === "work_meal";
    const work = workExchange ? visit.workExchange : null;
    const workObjectiveId = visit.objectiveGraph?.metadata?.objectiveIds?.workExchange || "";
    const workObjectiveRow = (visit.objectiveGraph?.objectives || []).find((objective) => objective.id === workObjectiveId) || null;
    const workOrder = (state.tavernState?.workOrders || []).find((order) => order.id === work?.workOrderId) || null;
    const agreementStatus = work?.agreement?.status || "";
    const taskZoneId = work?.zoneId || workOrder?.zoneId || "";
    const completedUnits = Math.max(0, Number(workOrder?.completedUnits || 0));
    const requiredUnits = Math.max(1, Number(work?.execution?.requiredUnits || work?.requiredUnits || workOrder?.requiredUnits || 1));
    if (work && workOrder && visit.hostId === actorId && agreementStatus === "unoffered" && coLocated && (authority.serveMeal || authority.receiveGuest)) result.push(affordance({
      id: `assign_work:${visit.id}:${workOrder.id}`,
      type: "assign_work",
      label: `提出“${work.taskLabel}”换一碗热饭`,
      visitId: visit.id,
      objectiveId: workObjectiveId,
      taskId: workOrder.id,
      taskZoneId,
      requiredUnits,
      completedUnits,
      completionCriteria: work.completionCriteria,
      objectIds: work.objectIds,
      toolIds: work.toolIds,
      targetCharacterId: visit.visitorId,
      requiredZoneId: visitorZoneId,
      actionType: "speak",
      requiresSpeech: true,
      allowedSpeechActs: ["offer", "negotiate", "inform"],
      canonicalVisibleAction: `${actorName}指着眼前要收拾的地方，把要做多少、做完后怎么看当面说给${visitorName}。`,
      authoritativeFact: `${work.description}完成${requiredUnits}${workOrder.unitLabel || "项"}并通过验收，才换一碗热饭。`,
    }));
    if (work && agreementStatus === "offered" && actorId === visit.visitorId && coLocated) {
      const assignerId = work.agreement.assignedBy || work.agreement.offeredByActorId || visit.hostId;
      result.push(affordance({
        id: `accept_work:${visit.id}:${work.workOrderId}`,
        type: "accept_work",
        label: `明确接受“${work.taskLabel}”换饭`,
        visitId: visit.id,
        objectiveId: workObjectiveId,
        taskId: work.workOrderId,
        taskZoneId,
        targetCharacterId: assignerId,
        requiredZoneId: actorZoneId,
        actionType: "speak",
        requiresSpeech: true,
        allowedSpeechActs: ["answer", "inform", "negotiate"],
        canonicalVisibleAction: `${visitorName}顺着对方所指看过要动手的地方，当面给出答复。`,
        authoritativeFact: "任务已经提出，但来客尚未接受。",
      }));
      result.push(affordance({
        id: `refuse_work:${visit.id}:${work.workOrderId}`,
        type: "refuse_work",
        label: `明确拒绝“${work.taskLabel}”换饭`,
        visitId: visit.id,
        objectiveId: workObjectiveId,
        taskId: work.workOrderId,
        taskZoneId,
        targetCharacterId: assignerId,
        requiredZoneId: actorZoneId,
        actionType: "speak",
        requiresSpeech: true,
        allowedSpeechActs: ["refuse", "answer", "negotiate"],
        canonicalVisibleAction: `${visitorName}没有动工具，留在原处当面说明自己不接这项活。`,
        authoritativeFact: "任务已经提出，但来客可以接受、拒绝或另谈条件。",
      }));
    }
    if (work && agreementStatus === "accepted" && actorId === visit.visitorId && taskZoneId && actorZoneId !== taskZoneId) {
      const nextZoneId = nextZoneToward(runtime, actorZoneId, taskZoneId);
      if (nextZoneId) result.push(affordance({
        id: `approach_work_zone:${visit.id}:${work.workOrderId}:${nextZoneId}`,
        type: "approach_work_zone",
        label: `去${runtime.topology?.zones?.[taskZoneId]?.label || taskZoneId}做已经接受的${work.taskLabel}`,
        visitId: visit.id,
        objectiveId: workObjectiveId,
        taskId: work.workOrderId,
        taskZoneId,
        actionType: "move",
        moveToZoneId: nextZoneId,
        canonicalVisibleAction: `${visitorName}从${runtime.topology?.zones?.[actorZoneId]?.label || actorZoneId}朝${runtime.topology?.zones?.[nextZoneId]?.label || nextZoneId}走去，去做已经接下的活。`,
        authoritativeFact: `已经接受的任务必须在${runtime.topology?.zones?.[taskZoneId]?.label || taskZoneId}完成。`,
      }));
    }
    if (work && ["accepted"].includes(agreementStatus) && actorId === visit.visitorId && actorZoneId === taskZoneId && completedUnits < requiredUnits) result.push(affordance({
      id: `perform_work:${visit.id}:${work.workOrderId}:${completedUnits + 1}`,
      type: "perform_work",
      label: `${work.taskLabel}（${completedUnits + 1}/${requiredUnits}）`,
      visitId: visit.id,
      objectiveId: workObjectiveId,
      taskId: work.workOrderId,
      taskZoneId,
      requiredZoneId: taskZoneId,
      requiredUnits,
      completedUnits,
      completionCriteria: work.completionCriteria,
      objectIds: work.objectIds,
      toolIds: work.toolIds,
      actionType: "act",
      canonicalVisibleAction: workUnitVisibleAction({
        visitorName,
        work,
        workOrder,
        completedUnits,
        requiredUnits,
      }),
      authoritativeFact: `这项活要求完成${requiredUnits}${workOrder.unitLabel || "项"}，当前完成${completedUnits}${workOrder.unitLabel || "项"}。`,
    }));
    if (work && agreementStatus === "accepted" && actorId === visit.visitorId && work.execution?.status === "in_progress" && completedUnits >= requiredUnits) result.push(affordance({
      id: `submit_work:${visit.id}:${work.workOrderId}`,
      type: "submit_work",
      label: `请经手人验收${work.taskLabel}`,
      visitId: visit.id,
      objectiveId: workObjectiveId,
      taskId: work.workOrderId,
      taskZoneId,
      requiredZoneId: taskZoneId,
      objectIds: work.objectIds,
      toolIds: work.toolIds,
      targetCharacterId: workObjectiveRow?.task?.verifierActorIds?.find((id) => runtime.agents?.[id]?.present && runtime.agents?.[id]?.zoneId === taskZoneId) || "",
      actionType: "speak",
      requiresSpeech: true,
      allowedSpeechActs: ["inform", "ask"],
      waitingOnly: true,
      canonicalVisibleAction: `${visitorName}停下手里的活，把收拾好的地方留在原处，等能检查的人来看一遍。`,
      authoritativeFact: "工作数量已经完成，但尚未提交给经手人验收。",
    }));
    const verifierIds = workObjectiveRow?.task?.verifierActorIds || [];
    if (work
      && work.execution?.status === "submitted"
      && work.verification?.status !== "verified"
      && verifierIds.includes(actorId)
      && actorZoneId === taskZoneId) result.push(affordance({
      id: `verify_work:${visit.id}:${work.workOrderId}`,
      type: "verify_work",
      label: `按标准验收${work.taskLabel}`,
      visitId: visit.id,
      objectiveId: workObjectiveId,
      taskId: work.workOrderId,
      taskZoneId,
      requiredZoneId: taskZoneId,
      targetCharacterId: visit.visitorId,
      completionCriteria: work.completionCriteria,
      objectIds: work.objectIds,
      toolIds: work.toolIds,
      actionType: "interact",
      canonicalVisibleAction: `${actorName}逐处看过做完的活，确认没有遗漏后点了点头。`,
      authoritativeFact: "工作已经提交，尚待按原先说定的标准验收。",
    }));
    const compensationActorIds = workObjectiveRow?.task?.compensation?.actorIds || [];
    if (work
      && work.verification?.status === "verified"
      && work.compensation?.status !== "delivered"
      && compensationActorIds.includes(actorId)) result.push(...serviceProcessAffordances({
      state,
      runtime,
      actor,
      actorRuntime,
      visit,
      visitorName,
      actorName,
      finalServeType: "serve_work_meal",
    }));

    const deliveryReady = visit.deliveryStatus === "not_required" || visit.deliveryStatus === "accepted";
    if ((purposeDeclared || isSelfDirectedVisit(visit))
      && !workExchange
      && visit.hostId === actorId
      && deliveryReady
      && !["served", "not_required"].includes(visit.serviceStatus)) result.push(...serviceProcessAffordances({
      state,
      runtime,
      actor,
      actorRuntime,
      visit,
      visitorName,
      actorName,
      finalServeType: "serve_guest",
    }));

    if (actorId === visit.visitorId && visit.serviceStatus === "served" && visit.serviceConsumptionStatus === "pending") {
      const servedObjects = (visit.servedObjectIds || []).map((objectId) => state.tavernState?.objectLedger?.objects?.[objectId]).filter((object) => (
        object
        && !object.holderActorId
        && object.zoneId === actorZoneId
        && object.state?.servedToActorId === actorId
        && object.state?.contents !== "empty"
      ));
      if (servedObjects.length) {
        const offering = offeringFor(state, visit.requestedService);
        const serviceKind = offeringServiceKind(offering, visit.requestedService);
        const servedLabel = offering.label;
        result.push(affordance({
          id: `consume_service:${visit.id}:${servedObjects[0].id}`,
          type: "consume_service",
          label: `把已经送到面前的${servedLabel}吃用完`,
          visitId: visit.id,
          requiredZoneId: actorZoneId,
          objectIds: [servedObjects[0].id],
          actionType: "act",
          canonicalVisibleAction: serviceKind === "tea"
            ? `${visitorName}端起${servedObjects[0].label}饮用${servedLabel}，用完后把空器皿放回桌面。`
            : `${visitorName}坐在原处把${servedObjects[0].label}里的饭吃完，再把空碗放回桌面。`,
          authoritativeFact: `${servedLabel}已经交付但尚未吃用完。`,
          offeringId: visit.requestedService,
          offering,
          bodyDemand: serviceBodyDemand(offering, visit.requestedService),
        }));
      }
    }

    const lodgingReady = visit.lodgingStatus === "not_required" || visit.lodgingStatus === "assigned";
    const businessReady = visit.businessStatus === "not_required" || visit.businessStatus === "done";
    const readyToSettle = !workExchange && visit.serviceStatus === "served" && deliveryReady && lodgingReady && businessReady && visit.paymentStatus === "unpaid" && coLocated;
    const price = Number(offeringFor(state, visit.requestedService).price || 0);
    const visitor = characterById(state, visit.visitorId);
    const visitorCoins = Number(visitor?.lifeState?.resources?.coins || 0);
    if (readyToSettle && actorId === visit.visitorId && visitorCoins >= price) result.push(affordance({
      id: `pay_cash:${visit.id}`,
      type: "pay_cash",
      label: `支付${price}枚铜钱`,
      visitId: visit.id,
      targetCharacterId: visit.hostId || "",
      requiredZoneId: visitorZoneId,
      actionType: "interact",
      canonicalVisibleAction: `${visitorName}取出${price}枚铜钱，当面交给柜台里收账的人。`,
      authoritativeFact: `本次服务尚有${price}枚铜钱未结。`,
    }));
    if (readyToSettle && actorId !== visit.visitorId && authority.settleCash && (visitorCoins >= price || authority.grantCredit)) result.push(affordance({
      id: `settle_cash:${visit.id}`,
      type: "settle_cash",
      label: `结清${visitorName}的${price}枚铜钱`,
      visitId: visit.id,
      targetCharacterId: visit.visitorId,
      requiredZoneId: visitorZoneId,
      actionType: "interact",
      canonicalVisibleAction: visitorCoins >= price
        ? `${actorName}从${visitorName}手里接过${price}枚铜钱，当面点清后收入钱箱。`
        : `${actorName}把${visitorName}欠下的${price}枚铜钱单独记入赊账。`,
      authoritativeFact: `本次服务尚有${price}枚铜钱未结。`,
    }));
  }
  return result.map((row) => {
    const visit = (state.tavernState?.activeVisits || []).find((candidate) => candidate.id === row.visitId);
    if (!visit) return row;
    const objectiveId = objectiveIdForAffordancePriority(visit, row);
    const objective = (visit.objectiveGraph?.objectives || []).find((candidate) => candidate.id === objectiveId);
    const lifecyclePriority = {
      approach_service_vessel: 0.62,
      approach_service_station: 0.62,
      start_service_preparation: 0.66,
      resume_service_preparation: 0.68,
      finish_service_preparation: 0.7,
      approach_service_delivery: 0.68,
      consume_service: 0.74,
      return_lodging_key: 0.72,
      move_to_lodging_key_pool: 0.72,
      leave_visit: 0.72,
    }[row.type] || 0;
    const graphPriority = objective
      ? (Number(objective.priority || 0) * 0.7 + Number(objective.urgency || 0) * 0.3) / 100
      : 0;
    const obligationPriority = Math.max(lifecyclePriority, graphPriority);
    if (obligationPriority <= 0) return row;
    return {
      ...row,
      objectiveId: row.objectiveId || objectiveId,
      priorityClass: "commitment_obligation",
      obligationPriority: Math.max(0, Math.min(1, obligationPriority)),
      commitmentPressure: Math.round(Math.max(0, Math.min(1, obligationPriority)) * 100),
    };
  });
}

function objectiveAndTransitionForAffordance(visit = {}, current = {}) {
  const ids = visit.objectiveGraph?.metadata?.objectiveIds || {};
  const purposes = visit.objectiveGraph?.objectives?.filter((objective) => objective.metadata?.adapterRole === "business-purpose") || [];
  const byPurposeKind = (kind) => purposes.find((objective) => objective.kind === kind)?.id || "";
  const direct = {
    declare_visit_purpose: [ids.disclosure, "disclose"],
    receive_guest: [ids.reception, "receive"],
    perform_visit_business: [byPurposeKind("business"), "perform"],
    accept_delivery: [byPurposeKind("delivery"), "deliver"],
    assign_lodging: [byPurposeKind("lodging"), "assign"],
    assign_work: [current.objectiveId || ids.workExchange, "offer"],
    accept_work: [current.objectiveId || ids.workExchange, "accept"],
    refuse_work: [current.objectiveId || ids.workExchange, "refuse"],
    perform_work: [current.objectiveId || ids.workExchange, "execute"],
    submit_work: [current.objectiveId || ids.workExchange, "submit"],
    verify_work: [current.objectiveId || ids.workExchange, "verify"],
    serve_work_meal: [current.objectiveId || ids.workExchange, "compensate"],
    serve_guest: [ids.service, "serve"],
    pay_cash: [ids.payment, "pay"],
    settle_cash: [ids.payment, "settle"],
  }[current.type] || [];
  return { objectiveId: direct[0] || "", transition: direct[1] || "" };
}

function objectiveIdForAffordancePriority(visit = {}, current = {}) {
  const ids = visit.objectiveGraph?.metadata?.objectiveIds || {};
  const serviceProcessObjectiveId = visit.paymentMode === "work_exchange" || visit.requestedService === "work_meal"
    ? ids.workExchange
    : ids.service;
  const movementObjectiveId = {
    approach_reception: ids.disclosure,
    move_to_hall: ids.reception,
    approach_waiting_guest: visitPurposeIsPublic(visit) ? ids.reception : ids.disclosure,
    approach_work_zone: current.objectiveId || ids.workExchange,
    approach_service_vessel: serviceProcessObjectiveId,
    approach_service_station: serviceProcessObjectiveId,
    start_service_preparation: serviceProcessObjectiveId,
    resume_service_preparation: serviceProcessObjectiveId,
    finish_service_preparation: serviceProcessObjectiveId,
    approach_service_delivery: serviceProcessObjectiveId,
  }[current.type] || "";
  return movementObjectiveId || objectiveAndTransitionForAffordance(visit, current).objectiveId;
}

function prepareAffordanceObjectTransaction(state = {}, runtime = {}, visit = {}, action = {}, current = {}) {
  const tavern = state.tavernState || {};
  const ledger = normalizeObjectLedger(tavern.objectLedger || {});
  const actors = runtimeObjectActors(runtime);
  const actor = actors.find((row) => row.characterId === action.actorId) || null;
  const requiredObjectIds = [...new Set([...(current.objectIds || []), ...(current.toolIds || [])])];
  const workObjectTypes = new Set(["perform_work", "submit_work", "verify_work"]);
  if (workObjectTypes.has(current.type)) {
    const access = validateObjectAccess({
      ledger,
      actor,
      objectIds: requiredObjectIds,
      sceneId: TAVERN_LOCATION_ID,
      zoneId: actor?.zoneId || current.requiredZoneId,
    });
    if (!access.ok) return { ok: false, violations: access.violations };
  }

  const operations = [];
  if (current.type === "assign_lodging") {
    for (const objectId of current.objectIds || []) {
      const object = ledger.objects?.[objectId];
      if (!object) return { ok: false, violations: [{ code: "OBJECT_UNKNOWN", evidence: { objectId } }] };
      if (!object.holderActorId) operations.push({ type: "pickup", objectId, actorId: action.actorId });
      else if (object.holderActorId !== action.actorId) return { ok: false, violations: [{ code: "OBJECT_HELD_BY_OTHER", evidence: { objectId, holderActorId: object.holderActorId } }] };
      operations.push({ type: "transfer", objectId, actorId: action.actorId, toHolderActorId: visit.visitorId });
      operations.push({
        type: "update_state",
        objectId,
        actorId: visit.visitorId,
        patch: {
          assignedVisitId: visit.id,
          assignedActorId: visit.visitorId,
          keyPoolZoneId: current.keyPoolZoneId || object.state?.keyPoolZoneId || object.zoneId || actor?.zoneId || "hall",
          returnedVisitId: "",
          returnedByActionId: "",
          returnedToActorId: "",
        },
      });
    }
  } else if (current.type === "return_lodging_key") {
    for (const objectId of current.objectIds || []) {
      const object = ledger.objects?.[objectId];
      if (!object || !lodgingKeyStillOwed(object, visit)) {
        return { ok: false, violations: [{ code: "LODGING_KEY_NOT_OWED", evidence: { objectId, visitId: visit.id } }] };
      }
      if (!object.holderActorId) operations.push({ type: "pickup", objectId, actorId: action.actorId });
      else if (object.holderActorId !== action.actorId) {
        return { ok: false, violations: [{ code: "LODGING_KEY_HELD_BY_OTHER", evidence: { objectId, holderActorId: object.holderActorId } }] };
      }
      operations.push({
        type: "update_state",
        objectId,
        actorId: action.actorId,
        patch: {
          assignedVisitId: "",
          assignedActorId: "",
          returnedVisitId: visit.id,
          returnedByActionId: action.id,
          returnedToActorId: current.returnMode === "operator" ? current.targetCharacterId : "key_pool",
        },
      });
      if (current.returnMode === "operator") operations.push({
        type: "transfer",
        objectId,
        actorId: action.actorId,
        toHolderActorId: current.targetCharacterId,
      });
      else operations.push({
        type: "place",
        objectId,
        actorId: action.actorId,
        zoneId: current.keyPoolZoneId || actor?.zoneId,
      });
    }
  } else if (current.type === "accept_delivery") {
    for (const objectId of current.objectIds || []) {
      const object = ledger.objects?.[objectId];
      if (!object || object.holderActorId !== visit.visitorId) {
        return { ok: false, violations: [{ code: "DELIVERY_OBJECT_NOT_CARRIED", evidence: { objectId, holderActorId: object?.holderActorId || "" } }] };
      }
      operations.push({ type: "transfer", objectId, actorId: visit.visitorId, toHolderActorId: action.actorId });
    }
  } else if (current.type === "perform_work") {
    for (const objectId of current.toolIds || []) {
      const object = ledger.objects?.[objectId];
      if (object && !object.holderActorId) operations.push({ type: "pickup", objectId, actorId: action.actorId });
    }
    for (const objectId of requiredObjectIds) operations.push({
      type: "update_state",
      objectId,
      actorId: action.actorId,
      patch: { lastUsedActionId: action.id, lastUsedByActorId: action.actorId },
    });
  } else if (current.type === "submit_work") {
    for (const objectId of current.toolIds || []) {
      if (ledger.objects?.[objectId]?.holderActorId === action.actorId) {
        operations.push({ type: "place", objectId, actorId: action.actorId, zoneId: actor?.zoneId || current.requiredZoneId });
      }
    }
  } else if (current.type === "verify_work") {
    for (const objectId of requiredObjectIds) operations.push({
      type: "update_state",
      objectId,
      actorId: action.actorId,
      patch: { lastVerifiedActionId: action.id, lastVerifiedByActorId: action.actorId },
    });
  } else if (["approach_service_station", "start_service_preparation"].includes(current.type)) {
    for (const objectId of current.objectIds || []) {
      const object = ledger.objects?.[objectId];
      if (!object) return { ok: false, violations: [{ code: "OBJECT_UNKNOWN", evidence: { objectId } }] };
      if (object.holderActorId && object.holderActorId !== action.actorId) {
        return { ok: false, violations: [{ code: "SERVICE_VESSEL_HELD_BY_OTHER", evidence: { objectId, holderActorId: object.holderActorId } }] };
      }
      if (!object.holderActorId) {
        if (object.zoneId !== actor?.zoneId) {
          return { ok: false, violations: [{ code: "SERVICE_VESSEL_NOT_AT_ACTOR", evidence: { objectId, objectZoneId: object.zoneId, actorZoneId: actor?.zoneId || "" } }] };
        }
        operations.push({ type: "pickup", objectId, actorId: action.actorId });
      }
      if (current.type === "start_service_preparation") operations.push({
        type: "update_state",
        objectId,
        actorId: action.actorId,
        patch: {
          preparingForVisitId: visit.id,
          preparationProcessId: current.processId,
          preparationStartedByActionId: action.id,
        },
      });
    }
  } else if (current.type === "finish_service_preparation") {
    const process = (tavern.serviceProcesses || []).find((row) => row.id === current.processId);
    if (!process || process.status !== "ready") {
      return { ok: false, violations: [{ code: "SERVICE_PROCESS_NOT_READY", evidence: { processId: current.processId, status: process?.status || "missing" } }] };
    }
    for (const objectId of current.objectIds || []) {
      const object = ledger.objects?.[objectId];
      if (!object || object.holderActorId !== action.actorId) {
        return { ok: false, violations: [{ code: "SERVICE_VESSEL_NOT_HELD_BY_OPERATOR", evidence: { objectId, holderActorId: object?.holderActorId || "" } }] };
      }
      operations.push({
        type: "update_state",
        objectId,
        actorId: action.actorId,
        patch: {
          contents: current.offeringId || visit.requestedService || "prepared_service",
          preparingForVisitId: "",
          preparedForVisitId: visit.id,
          preparationProcessId: current.processId,
          preparationFinishedByActionId: action.id,
        },
      });
    }
  } else if (current.type === "approach_service_delivery") {
    for (const objectId of current.objectIds || []) {
      const object = ledger.objects?.[objectId];
      if (!object || object.holderActorId !== action.actorId || object.state?.preparedForVisitId !== visit.id) {
        return { ok: false, violations: [{ code: "PREPARED_SERVICE_NOT_CARRIED", evidence: { objectId, holderActorId: object?.holderActorId || "", visitId: visit.id } }] };
      }
    }
  } else if (["serve_guest", "serve_work_meal"].includes(current.type)) {
    const process = (tavern.serviceProcesses || []).find((row) => row.id === current.processId);
    if (!process || process.status !== "completed" || process.metadata?.deliveryStatus === "delivered") {
      return { ok: false, violations: [{ code: "PREPARED_SERVICE_PROCESS_UNAVAILABLE", evidence: { processId: current.processId, status: process?.status || "missing" } }] };
    }
    for (const objectId of current.objectIds || []) {
      const object = ledger.objects?.[objectId];
      if (!object
        || object.holderActorId !== action.actorId
        || object.state?.preparedForVisitId !== visit.id
        || object.state?.contents === "empty") {
        return { ok: false, violations: [{ code: "PREPARED_SERVICE_VESSEL_UNAVAILABLE", evidence: { objectId, actorZoneId: actor?.zoneId || "", holderActorId: object?.holderActorId || "" } }] };
      }
      operations.push({
        type: "update_state",
        objectId,
        actorId: action.actorId,
        patch: {
          preparedForVisitId: "",
          servedVisitId: visit.id,
          servedToActorId: visit.visitorId,
          servedByActorId: action.actorId,
          servedByActionId: action.id,
        },
      });
      operations.push({ type: "place", objectId, actorId: action.actorId, zoneId: actor.zoneId });
    }
  } else if (current.type === "consume_service") {
    for (const objectId of current.objectIds || []) {
      const object = ledger.objects?.[objectId];
      if (!object
        || object.holderActorId
        || object.zoneId !== actor?.zoneId
        || object.state?.servedToActorId !== action.actorId
        || object.state?.contents === "empty") {
        return { ok: false, violations: [{ code: "SERVED_OBJECT_UNAVAILABLE", evidence: { objectId, actorId: action.actorId } }] };
      }
      operations.push({ type: "pickup", objectId, actorId: action.actorId });
      operations.push({
        type: "update_state",
        objectId,
        actorId: action.actorId,
        patch: {
          contents: "empty",
          servedVisitId: "",
          servedToActorId: "",
          consumedByActorId: action.actorId,
          consumedByActionId: action.id,
        },
      });
      operations.push({ type: "place", objectId, actorId: action.actorId, zoneId: actor.zoneId });
    }
  }

  const applied = applyObjectOperations({
    ledger,
    operations,
    actors,
    topology: runtime.topology || {},
  });
  return { ...applied, operations };
}

function applyVisitAffordanceTransition(state = {}, runtime = {}, visit = {}, action = {}, current = {}) {
  const { objectiveId, transition } = objectiveAndTransitionForAffordance(visit, current);
  if (!objectiveId || !transition) return { ok: true, visit };
  const result = applyVisitObjectiveTransition({
    visit,
    workOrders: state.tavernState?.workOrders || [],
    sceneConfig: tavernCommitmentSceneConfig(visit),
    objectiveId,
    transition,
    evidence: {
      id: action.id,
      actorId: action.actorId,
      zoneId: action.moveToZoneId || runtime.agents?.[action.actorId]?.zoneId || current.requiredZoneId || "",
      objectIds: [...new Set([...(current.objectIds || []), ...(current.toolIds || [])])],
      targetActorIds: (action.targetCharacterId || current.targetCharacterId)
        ? [action.targetCharacterId || current.targetCharacterId]
        : [],
      facts: [current.authoritativeFact, action.speech, action.visibleAction].filter(Boolean),
    },
  });
  if (!result.ok) return result;
  Object.assign(visit, result.visit);
  if (result.workOrderPatch?.id) {
    const order = (state.tavernState?.workOrders || []).find((candidate) => candidate.id === result.workOrderPatch.id);
    if (order) {
      order.status = result.workOrderPatch.status;
      order.offeredVisitId = ["open", "completed"].includes(order.status) ? "" : visit.id;
      order.assignedActorId = order.status === "open" ? "" : visit.visitorId;
      order.evidenceActionIds = [...new Set([...(order.evidenceActionIds || []), action.id])];
    }
  }
  return result;
}

export function applyTavernCausalAffordance(state = {}, runtime = {}, action = {}, selectedAffordance = {}, perceivedCharacterIds = []) {
  const actorId = action.actorId;
  const currentPerceivedIds = perceivedCharacterIds.length
    ? perceivedCharacterIds
    : selectedAffordance.targetCharacterId ? [selectedAffordance.targetCharacterId] : [];
  const current = listTavernCausalAffordances(state, runtime, actorId, currentPerceivedIds).find((item) => item.id === selectedAffordance.id);
  if (!current) return null;
  const tavern = state.tavernState;
  const visit = (tavern.activeVisits || []).find((item) => item.id === current.visitId);
  const actor = characterById(state, actorId);
  const visitor = characterById(state, visit?.visitorId);
  if (!visit || !actor || !visitor) return null;
  ensureVisitState(visit);
  if (current.requiresSpeech && !text(action.speech)) return null;
  if (current.type === "declare_visit_purpose" && !tavernVisitPurposeSpeechIsConcrete(current, action.speech)) return null;
  if (current.moveToZoneId && action.moveToZoneId !== current.moveToZoneId) return null;
  if (current.type === "start_service_preparation" && !serviceCurrentlyAvailable(state, current.offeringId || visit.requestedService)) return null;
  if (["pay_cash", "settle_cash"].includes(current.type)) {
    const price = Number(offeringFor(state, visit.requestedService).price || 0);
    const coins = Number(visitor.lifeState?.resources?.coins || 0);
    if (coins < price && !authorityFor(actor).grantCredit) return null;
  }
  const objectTransaction = prepareAffordanceObjectTransaction(state, runtime, visit, action, current);
  if (!objectTransaction.ok) return null;
  const transitionResult = applyVisitAffordanceTransition(state, runtime, visit, action, current);
  if (!transitionResult.ok) return null;
  tavern.objectLedger = objectTransaction.ledger;
  const actorName = actor.name || actorId;
  const visitorName = visit.visitorName || visitor.name || visit.visitorId;
  let consequence = "";
  const resourceDelta = {};

  if (current.type === "request_service") {
    visit.requestedService = current.offeringId;
    visit.requestedOffering = deepClone(current.offering || offeringFor(state, current.offeringId));
    visit.serviceRequestStatus = "requested";
    visit.serviceRequestedByActionId = action.id;
    visit.serviceStatus = "pending";
    visit.servicePreparationStatus = "not_started";
    visit.serviceProcessId = "";
    visit.serviceConsumptionStatus = "not_served";
    visit.paymentMode = "cash";
    visit.paymentStatus = "unpaid";
    visit.serviceTransactionStatus = "open";
    visit.hostId = current.targetCharacterId;
    visit.receivedBy = current.targetCharacterId;
    consequence = `${visitorName}已向${runtime.agents?.[current.targetCharacterId]?.characterName || "酒馆经手人"}提出${current.offering?.label || offeringFor(state, current.offeringId).label}请求；请求已被听见，但尚未上茶饭、扣钱或完成私人来意。`;
  } else if (current.type === "take_guest_seat") {
    if (!occupyGuestPosition(tavern, actorId, current.seatingPositionId)) return null;
    visit.seatingPositionId = current.seatingPositionId;
    visit.seatedByActionId = action.id;
    consequence = `${visitorName}已经在${current.position?.label || "堂前客位"}坐下；这只改变位置、视听与社会暴露条件。`;
  } else if (current.type === "declare_visit_purpose") {
    visit.purposeStatus = "declared";
    visit.purposeDisclosureStatus = "declared";
    visit.declaredPurpose = visit.purpose;
    visit.purposeDeclaredByActionId = action.id;
    consequence = `${visitorName}已经亲口向在场经手人说明来意；之后可依据这次公开说明接待，不能假装仍不知道。`;
  } else if (current.type === "receive_guest") {
    visit.hostId = actorId;
    visit.receivedBy = actorId;
    consequence = `${actorName}成为这次来访的经手人；${visitorName}不再处于无人招呼的等待状态。`;
  } else if (["approach_reception", "move_to_hall", "approach_waiting_guest", "move_to_lodging_key_pool"].includes(current.type)) {
    consequence = `${actorName}正在按本次来访的公开动线靠近办事位置；尚未发生新的交付或公务结果。`;
  } else if (current.type === "approach_service_vessel") {
    consequence = `${actorName}正在去取准备${current.offering?.label || "这项服务"}所需的器皿；成品尚未出现。`;
  } else if (current.type === "approach_service_station") {
    consequence = `${actorName}正在去实际操作${current.offering?.label || "这项服务"}的位置；准备尚未开始或仍处于中断状态。`;
  } else if (current.type === "start_service_preparation") {
    const offeringId = current.offeringId || visit.requestedService || "meal";
    const offering = offeringFor(state, offeringId);
    const started = startDurativeWorldProcess(tavern.serviceProcesses || [], {
      id: current.processId || `service_process:${visit.id}`,
      kind: current.processKind || "service-preparation",
      subjectId: visit.id,
      ownerActorId: actorId,
      stationZoneId: current.stationZoneId || action.moveToZoneId || runtime.agents?.[actorId]?.zoneId || "stove",
      objectIds: [...(current.objectIds || [])],
      durationSeconds: Math.max(1, Number(current.durationSeconds || 1)),
      attentionMode: current.attentionMode || "passive_wait",
      sourceActionId: action.id,
      metadata: {
        offeringId,
        offeringLabel: offering.label,
        visitId: visit.id,
        finalServeType: current.finalServeType || "serve_guest",
        deliveryStatus: "not_delivered",
      },
    }, tavernProcessClockSeconds(runtime));
    if (!started.ok) return null;
    const stockDelta = consumeOfferingStock(tavern.stock || {}, offering, offeringId);
    if (!stockDelta) return null;
    tavern.serviceProcesses = started.processes;
    Object.assign(resourceDelta, stockDelta);
    visit.serviceProcessId = started.process.id;
    visit.serviceStatus = "preparing";
    visit.servicePreparationStatus = "preparing";
    visit.servicePreparationStartedByActionId = action.id;
    consequence = `${actorName}已经实际开始准备${offering.label}；过程需要${started.process.durationSeconds}秒，期间尚未形成可交付的茶饭。`;
  } else if (current.type === "interrupt_service_preparation") {
    const interrupted = interruptDurativeWorldProcess(
      tavern.serviceProcesses || [],
      current.processId,
      tavernProcessClockSeconds(runtime),
      action.id,
    );
    if (!interrupted.ok) return null;
    tavern.serviceProcesses = interrupted.processes;
    visit.serviceStatus = "preparing";
    visit.servicePreparationStatus = "interrupted";
    consequence = `${actorName}暂时停下了${current.offering?.label || "这项服务"}的准备；已经完成的进度保留，成品仍未出现。`;
  } else if (current.type === "resume_service_preparation") {
    const resumed = resumeDurativeWorldProcess(
      tavern.serviceProcesses || [],
      current.processId,
      tavernProcessClockSeconds(runtime),
      action.id,
    );
    if (!resumed.ok) return null;
    tavern.serviceProcesses = resumed.processes;
    visit.serviceStatus = "preparing";
    visit.servicePreparationStatus = resumed.process.status === "ready" ? "ready_for_finish" : "preparing";
    consequence = `${actorName}接着做中断的${current.offering?.label || "这项服务"}；它从原有进度继续，而不是重新瞬间完成。`;
  } else if (current.type === "finish_service_preparation") {
    const completed = completeDurativeWorldProcess(
      tavern.serviceProcesses || [],
      current.processId,
      tavernProcessClockSeconds(runtime),
      action.id,
    );
    if (!completed.ok) return null;
    tavern.serviceProcesses = completed.processes.map((process) => process.id === current.processId ? {
      ...process,
      metadata: { ...(process.metadata || {}), outputReady: true, deliveryStatus: "not_delivered" },
    } : process);
    visit.serviceStatus = "prepared";
    visit.servicePreparationStatus = "prepared";
    visit.servicePreparedByActionId = action.id;
    consequence = `${current.offering?.label || "这项服务"}已经由${actorName}实际收尾成为可送出的成品，但还没有交到${visitorName}面前。`;
  } else if (current.type === "approach_service_delivery") {
    consequence = `${actorName}正端着准备好的${current.offering?.label || "茶饭"}走向${visitorName}；移动发生了，交付尚未发生。`;
  } else if (current.type === "perform_visit_business") {
    visit.businessStatus = "done";
    visit.businessCompletedBy = actorId;
    visit.businessCompletedActionId = action.id;
    const objectIds = new Set(visit.businessObjectIds || []);
    for (const notice of tavern.candidateNotices || []) {
      if (!objectIds.has(notice.id)) continue;
      notice.status = "reviewed";
      notice.reviewedBy = actorId;
      notice.reviewedActionId = action.id;
      notice.reviewedDay = Number(action.day ?? tavern.day ?? 0);
    }
    consequence = `${visitorName}已把本次带来的候选登记与酒馆记录逐项核完；这项公务不得再次伪装成尚未开始。`;
  } else if (current.type === "assign_lodging") {
    visit.lodgingStatus = "assigned";
    visit.roomAssignedBy = actorId;
    visit.keyDelivered = true;
    visit.keyReturnStatus = "outstanding";
    visit.lodgingKeyObjectIds = [...new Set(current.objectIds || [])];
    visit.roomId = current.roomId || tavern.objectLedger?.objects?.[current.objectIds?.[0]]?.state?.roomId || "";
    visit.lodgingKeyReturnZoneId = current.keyPoolZoneId || tavern.objectLedger?.objects?.[current.objectIds?.[0]]?.state?.keyPoolZoneId || "hall";
    const noticePolicy = agencyFor(visitor).visitPolicy?.candidateNotice;
    if (noticePolicy && !(tavern.candidateNotices || []).some((notice) => notice.sourceVisitId === visit.id)) {
      tavern.candidateNotices = [...(tavern.candidateNotices || []), {
        id: createId("candidate_notice"),
        status: "pending",
        candidateId: visitor.id,
        candidateName: visitor.name,
        sourceVisitId: visit.id,
        sourceActionId: action.id,
        recordKind: noticePolicy.recordKind || "候选留宿与接引登记",
        reason: noticePolicy.reason || `${visitor.name}持宗门凭证在望梯酒馆留宿等接引`,
        createdDay: Number(action.day ?? tavern.day ?? 0),
        createdSlot: action.slotLabel || "",
      }].slice(-24);
    }
    consequence = `${visitorName}已经拿到客房钥匙并知道房间位置；不得再把客房安排说成尚未交代。`;
  } else if (current.type === "return_lodging_key") {
    visit.keyReturnStatus = "returned";
    visit.keyReturnedByActionId = action.id;
    visit.keyReturnedToActorId = current.returnMode === "operator" ? current.targetCharacterId : "key_pool";
    consequence = current.returnMode === "operator"
      ? `${visitorName}已把客房钥匙当面交还经营者；对应客房重新进入可分配状态。`
      : `${visitorName}已把客房钥匙挂回可用钥匙池；对应客房重新进入可分配状态。`;
  } else if (current.type === "accept_delivery") {
    visit.deliveryStatus = "accepted";
    visit.deliveryAcceptedBy = actorId;
    consequence = `${visitorName}带来的货物和清单已经由${actorName}验收，之后不得再次询问是否交接。`;
  } else if (current.type === "assign_work") {
    visit.workAssignedBy = actorId;
    consequence = `${actorName}已经把“${visit.workExchange?.taskLabel || current.label}”的范围、数量和验收条件当面提出；${visitorName}尚未接受。`;
  } else if (current.type === "accept_work") {
    consequence = `${visitorName}已经明确接受“${visit.workExchange?.taskLabel || current.label}”换饭；任务范围从此锁定，追加工作必须重新取得同意。`;
  } else if (current.type === "refuse_work") {
    consequence = `${visitorName}已经明确拒绝这项换饭工作；该工单重新开放，不能把拒绝写成已经派活。`;
  } else if (current.type === "perform_work") {
    const order = (tavern.workOrders || []).find((candidate) => candidate.id === current.taskId);
    if (order) order.completedUnits = Math.min(Number(order.requiredUnits || 1), Number(order.completedUnits || 0) + 1);
    consequence = `${visitorName}完成了“${visit.workExchange?.taskLabel || current.label}”的第${Number(order?.completedUnits || 1)}${order?.unitLabel || "项"}；只有达到${Number(order?.requiredUnits || current.requiredUnits || 1)}${order?.unitLabel || "项"}后才能提交验收。`;
  } else if (current.type === "submit_work") {
    visit.workCompletedBy = actorId;
    consequence = `${visitorName}已经把完成的“${visit.workExchange?.taskLabel || current.label}”提交验收；尚未取得验收结果。`;
  } else if (current.type === "verify_work") {
    consequence = `${actorName}已按先前锁定的标准验收“${visit.workExchange?.taskLabel || current.label}”；饭仍未交付。`;
  } else if (current.type === "serve_work_meal") {
    visit.serviceStatus = "served";
    visit.servicePreparationStatus = "delivered";
    visit.serviceConsumptionStatus = "pending";
    visit.servedOffering = "work_meal";
    visit.servedObjectIds = [...new Set(current.objectIds || [])];
    const process = (tavern.serviceProcesses || []).find((row) => row.id === current.processId);
    if (process) process.metadata = { ...(process.metadata || {}), deliveryStatus: "delivered", deliveredByActionId: action.id };
    addLedgerEntry(tavern, {
      type: "work_exchange",
      day: Number(action.day ?? tavern.day ?? 0),
      slot: action.slotLabel || "",
      visitId: visit.id,
      actorId,
      counterpartyId: visit.visitorId,
      amount: 0,
      description: `${visitorName}完成杂务，换得一碗热饭`,
    });
    consequence = `${visitorName}的工作此前已经验收；现在热饭也已当面交付，以工换饭才真正两清。`;
  } else if (current.type === "serve_guest") {
    const service = visit.requestedService || "meal";
    const offering = offeringFor(state, service);
    visit.serviceStatus = "served";
    visit.servicePreparationStatus = "delivered";
    visit.serviceConsumptionStatus = "pending";
    visit.servedOffering = service;
    visit.servedBy = actorId;
    visit.servedObjectIds = [...new Set(current.objectIds || [])];
    const process = (tavern.serviceProcesses || []).find((row) => row.id === current.processId);
    if (process) process.metadata = { ...(process.metadata || {}), deliveryStatus: "delivered", deliveredByActionId: action.id };
    consequence = `${offering.label}已经由${actorName}交给${visitorName}；不得再次询问是否端饭或上茶。`;
  } else if (current.type === "consume_service") {
    visit.serviceConsumptionStatus = "consumed";
    visit.serviceConsumedByActionId = action.id;
    visit.serviceConsumedBy = actorId;
    consequence = `${visitorName}已经把面前的${offeringFor(state, visit.requestedService).label}吃用完，并把空器皿留在原处；不得再写成尚未吃到。`;
  } else if (["pay_cash", "settle_cash"].includes(current.type)) {
    const price = Number(offeringFor(state, visit.requestedService).price || 0);
    const coins = Number(visitor.lifeState?.resources?.coins || 0);
    if (coins >= price) {
      visitor.lifeState.resources.coins = coins - price;
      if (visitor.lifeState.resources.wallet) visitor.lifeState.resources.wallet.amount = coins - price;
      tavern.cashBox = Number(tavern.cashBox || 0) + price;
      visit.paymentStatus = "paid";
      visit.settledBy = actorId;
      resourceDelta.cashBox = price;
      resourceDelta.coins = -price;
      consequence = `${visitorName}的${price}枚铜钱已经当面点清并收入钱箱；这笔钱不得再次收取。`;
      addLedgerEntry(tavern, {
        type: "sale",
        day: Number(action.day ?? tavern.day ?? 0),
        slot: action.slotLabel || "",
        visitId: visit.id,
        actorId,
        counterpartyId: visit.visitorId,
        amount: price,
        description: consequence,
      });
    } else if (authorityFor(actor).grantCredit) {
      visit.paymentStatus = "credit";
      visit.settledBy = actorId;
      consequence = `${visitorName}欠下的${price}枚铜钱已经单独记入赊账；不得再把它说成尚未处理。`;
      addLedgerEntry(tavern, {
        type: "credit",
        day: Number(action.day ?? tavern.day ?? 0),
        slot: action.slotLabel || "",
        visitId: visit.id,
        actorId,
        counterpartyId: visit.visitorId,
        amount: 0,
        description: consequence,
      });
    } else return null;
  } else if (current.type === "leave_visit") {
    const unresolvedPersonalOpenLoops = [
      ...(visit.personalOpenLoops || [])
        .filter((loop) => ["open", "deferred"].includes(loop.status)),
      ...unresolvedEcologyVisitLoops(visitor, visit),
    ].reduce((rows, loop) => (
      rows.some((row) => row.sourceId === loop.sourceId)
        ? rows
        : [...rows, deepClone(loop)]
    ), []);
    visit.departedByOwnAction = true;
    visit.departureChoice = "character-agent";
    visit.unresolvedPersonalOpenLoopsAtDeparture = unresolvedPersonalOpenLoops;
    visit.departedDay = Number(tavern.day || 0);
    releaseGuestPosition(tavern, actorId);
    tavern.activeVisits = (tavern.activeVisits || []).filter((item) => item.id !== visit.id);
    tavern.visits = [...(tavern.visits || []), deepClone(visit)].slice(-24);
    visitor.lifeState.present = false;
    visitor.lifeState.activeVisitId = "";
    visitor.lifeState.returnIntentions = Array.isArray(visitor.lifeState.returnIntentions)
      ? visitor.lifeState.returnIntentions
      : [];
    if (unresolvedPersonalOpenLoops.length) {
      const returnIntention = {
        id: `return_intention:${visit.id}`,
        sourceVisitId: visit.id,
        ownerCharacterId: visit.visitorId,
        destinationLocationId: TAVERN_LOCATION_ID,
        motive: unresolvedPersonalOpenLoops.map((loop) => loop.desire).filter(Boolean).join("；"),
        targetCharacterIds: [...new Set(unresolvedPersonalOpenLoops.map((loop) => loop.targetCharacterId).filter(Boolean))],
        unresolvedPersonalLoopIds: unresolvedPersonalOpenLoops.map((loop) => loop.id),
        status: "open_uncommitted",
        createdDay: Number(tavern.day || 0),
        createdBy: "character-agent-departure-choice",
      };
      visitor.lifeState.returnIntentions = [
        ...visitor.lifeState.returnIntentions.filter((row) => row.sourceVisitId !== visit.id),
        returnIntention,
      ].slice(-8);
      visitor.lifeState.visitIntention = {
        ...(visitor.lifeState.visitIntention || {}),
        status: "return_open",
        activeVisitId: "",
        returnIntentionId: returnIntention.id,
      };
    } else if (visitor.lifeState.visitIntention) {
      visitor.lifeState.visitIntention.status = "completed";
      visitor.lifeState.visitIntention.activeVisitId = "";
    }
    consequence = `${visitorName}已经离店，不再属于堂前在场者。`;
  }

  if (current.type !== "leave_visit") {
    refreshVisitStage(visit);
    visit.lastMaterialActionId = action.id;
    visit.lastMaterialConsequence = consequence;
  }
  const satisfactionTags = [`affordance:${current.type}`];
  if (current.type === "consume_service") {
    satisfactionTags.push("service_consumed", `service:${serviceObjectType(state.tavernState || {}, visit.requestedService)}`);
    if (visit.paymentStatus === "work_settled") satisfactionTags.push("payment:work_settled");
  }
  return {
    affordance: current,
    consequence,
    resourceDelta,
    objectOperations: deepClone(objectTransaction.operations || []),
    satisfactionEvidence: {
      tags: satisfactionTags,
      beneficiaryActorIds: [visit.visitorId],
      subjectActorIds: [action.actorId],
      objectIds: [...new Set(current.objectIds || [])],
      visitId: visit.id,
    },
    targetCharacterId: current.targetCharacterId || visit.visitorId,
    visitStage: current.type === "leave_visit" ? "departed" : visit.stage,
  };
}

function createVisit(state, character, day, slotLabel, arrival = {}) {
  const policy = agencyFor(character).visitPolicy || {};
  const notices = policy.arrivalTrigger === "pending_candidate_notice" ? pendingCandidateNotices(state) : [];
  const noticeNames = [...new Set(notices.map((notice) => notice.candidateName).filter(Boolean))];
  const purpose = notices.length
    ? `核对${noticeNames.join("、") || "待核来客"}的候选留宿与接引登记`
    : policy.purpose || `${character.name}有一件要在酒馆办完的事`;
  return ensureVisitState({
    id: createId("tavern_visit"),
    visitorId: character.id,
    visitorName: character.name,
    situationalRole: agencyFor(character).expression?.roleLabel || agencyFor(character).standing || "来客",
    purpose,
    kind: policy.kind || "visit",
    selfDirected: policy.kind === "self_directed" || policy.selfDirected === true,
    purposeDisclosureRequired: typeof policy.purposeDisclosureRequired === "boolean"
      ? policy.purposeDisclosureRequired
      : policy.kind !== "self_directed",
    hostReceptionRequired: typeof policy.hostReceptionRequired === "boolean"
      ? policy.hostReceptionRequired
      : policy.kind !== "self_directed",
    expectedHostIds: [...(policy.expectedHostIds || [])],
    requestedService: policy.requestedService || "tea",
    paymentMode: policy.paymentMode || "cash",
    completionCondition: policy.completionCondition || "来意得到回应并把账结清",
    purposes: deepClone(policy.purposes || policy.businessPurposes || []),
    secondaryObjective: policy.secondaryObjective || "",
    secondaryTargetId: policy.secondaryTargetId || "",
    purposeStatus: "undisclosed",
    businessStatus: (policy.kind || "visit") === "business" ? "pending" : "not_required",
    purposeAction: notices.length
      ? `把${noticeNames.join("、") || "待核来客"}的留宿与接引登记同酒馆记录逐项对清`
      : policy.purposeAction || policy.purpose || "办完来访事务",
    purposeZoneIds: [...(policy.purposeZoneIds || [])],
    allowedZoneIds: [...(policy.allowedZoneIds || [])],
    businessObjectIds: notices.map((notice) => notice.id),
    carriedObjectIds: [...(policy.carriedObjectIds || [])],
    carriedObjectLabel: policy.carriedObjectLabel || "随身物件",
    arrivalCue: policy.arrivalCue || "带着随身物件站在门槛内",
    stage: "waiting",
    hostId: "",
    arrivedDay: day,
    arrivedSlot: slotLabel,
    arrivalCause: {
      intentionId: arrival.intention?.id || "",
      motive: arrival.intention?.motive || policy.arrivalMotive || purpose,
      trigger: arrival.intention?.trigger || policy.arrivalTrigger || "self_committed_visit",
      triggerEvidenceIds: [...(arrival.intention?.triggerEvidenceIds || [])],
      committedAtSlotIndex: arrival.intention?.committedAtSlotIndex ?? null,
      arrivedAtSlotIndex: arrival.nowSlotIndex ?? null,
      travelCostSlots: Number(arrival.travelCostSlots || 0),
      travelElapsedSlots: Number(arrival.elapsedTravelSlots || 0),
    },
  });
}

function slotTrigger(slot, managerId) {
  const triggers = {
    dawn: { content: "天光越过门槛，到了望梯酒馆开门接客的时辰。", type: "institution", intensity: 64 },
    noon: { content: "堂前到了正午饭点，灶边的热饭和在场来客都需要有人照看。", type: "resource", intensity: 68 },
    afternoon: { content: "午后的堂前换了一拨脚步声，未办完的来客事务仍留在原处。", type: "institution", intensity: 58 },
    dusk: { content: "天色压到门外，住店、晚饭和当日账目必须在收灶前说清。", type: "institution", intensity: 70 },
    night: { content: "堂前客声渐止，到了收灶、关门并确认谁仍留宿的时辰。", type: "institution", intensity: 74 },
  };
  const trigger = triggers[slot.id] || triggers.afternoon;
  return {
    sourceCharacterId: `world:macro-${slot.id}`,
    sourceZoneId: "hall",
    type: trigger.type,
    modality: "sound",
    intensity: trigger.intensity,
    radius: 3,
    directedTargetId: managerId || "",
    content: trigger.content,
    topic: `${slot.label}酒馆职责`,
  };
}

export function prepareTavernCausalSlot(inputState = {}, {
  day = 1,
  slot = TAVERN_CAUSAL_DAY_SLOTS[0],
  resume = false,
} = {}) {
  const state = deepClone(inputState);
  const tavern = state.tavernState || (state.tavernState = {});
  tavern.activeVisits = Array.isArray(tavern.activeVisits) ? tavern.activeVisits.map((visit) => ensureVisitState(visit)) : [];
  tavern.visits = Array.isArray(tavern.visits) ? tavern.visits : [];
  tavern.ledger = Array.isArray(tavern.ledger) ? tavern.ledger : [];
  tavern.serviceProcesses = Array.isArray(tavern.serviceProcesses) ? tavern.serviceProcesses : [];
  tavern.servicePreparationEnvironment = tavern.servicePreparationEnvironment && typeof tavern.servicePreparationEnvironment === "object"
    ? tavern.servicePreparationEnvironment
    : { stations: { stove: { zoneId: "stove", heatState: "simmering", heatReady: true } } };
  tavern.candidateNotices = Array.isArray(tavern.candidateNotices) ? tavern.candidateNotices : [];
  ensureGuestPositionOccupancy(tavern);
  ensureTavernObjectInventory(tavern);
  ensureTavernWorkOrders(tavern, day);
  reconcileWorkOrderObjectBindings(tavern);
  tavern.activeVisits = tavern.activeVisits.map((visit) => ensureVisitCommitments(state, visit));
  const characterIndex = new Map((state.characters || []).map((character) => [character.id, character]));
  const abandonedVisits = [];
  tavern.activeVisits = tavern.activeVisits.filter((visit) => {
    const visitor = characterIndex.get(visit.visitorId);
    if (!visitor || bindTriggeredVisitObjects(state, visit, visitor)) return true;
    abandonedVisits.push({
      ...deepClone(visit),
      stage: "abandoned",
      abandonmentReason: "来访所依赖的候选登记不存在，不能让旧日程把人物留在酒馆。",
      departedDay: Number(day || 0),
      departedSlot: slot.label,
    });
    if (visitor.lifeState) {
      visitor.lifeState.activeVisitId = "";
      visitor.lifeState.present = false;
    }
    return false;
  });
  if (abandonedVisits.length) tavern.visits = [...tavern.visits, ...abandonedVisits].slice(-24);
  const positions = {};
  const seedImpacts = [];
  const managerId = institutionOperatorId(state);
  const arrivals = [];

  for (const character of state.characters || []) {
    character.lifeState = character.lifeState || {};
    if (!isVisitor(character)) {
      // A schedule is an intention/cue, never a teleport command. Residents
      // remain where the last committed movement left them; another scene can
      // therefore share the same location truth without this adapter reviving
      // or dismissing them at a macro-slot boundary.
      const present = character.lifeState.present === true;
      if (present) character.currentLocationId = TAVERN_LOCATION_ID;
      if (character.ecologyState?.presence && present) {
        character.ecologyState.presence.locationId = TAVERN_LOCATION_ID;
        character.ecologyState.presence.observableAtStage = true;
      } else if (character.ecologyState?.presence) {
        character.ecologyState.presence.observableAtStage = false;
      }
      continue;
    }
    const arrival = ensureVisitIntention(state, character, day, slot);
    let visit = tavern.activeVisits.find((item) => item.visitorId === character.id);
    if (arrival.ready && !visit) {
      visit = createVisit(state, character, day, slot.label, arrival);
      tavern.activeVisits.push(visit);
      arrival.intention.status = "in_visit";
      arrival.intention.activeVisitId = visit.id;
      arrival.intention.arrivedAtSlotIndex = arrival.nowSlotIndex;
      character.lifeState.activeVisitId = visit.id;
      character.lifeState.visitPurpose = visit.purpose;
      character.lifeState.situationalRole = visit.situationalRole;
      character.lifeState.present = true;
      character.currentLocationId = TAVERN_LOCATION_ID;
      if (character.ecologyState?.presence) {
        character.ecologyState.presence.locationId = TAVERN_LOCATION_ID;
        character.ecologyState.presence.zoneId = "threshold";
        character.ecologyState.presence.observableAtStage = true;
      }
      tavern.objectLedger = relocateHeldObjects({
        ledger: tavern.objectLedger,
        actorId: character.id,
        sceneId: TAVERN_LOCATION_ID,
        zoneId: "threshold",
      });
      positions[character.id] = "threshold";
      arrivals.push(character.id);
      seedImpacts.push({
        publicEvent: true,
        publicEventKind: "arrival",
        sourceCharacterId: character.id,
        sourceZoneId: "threshold",
        type: "physical",
        modality: "sound",
        intensity: 82,
        radius: 3,
        directedTargetId: visit.expectedHostIds.find((id) => state.characters?.some((item) => item.id === id && item.lifeState?.present)) || managerId,
        content: `${character.name}推门进入望梯酒馆。`,
        topic: "来客到场",
      });
    } else if (visit) {
      arrival.intention.status = "in_visit";
      arrival.intention.activeVisitId = visit.id;
      refreshVisitStage(visit);
      character.lifeState.present = true;
      character.currentLocationId = TAVERN_LOCATION_ID;
      if (character.ecologyState?.presence) {
        character.ecologyState.presence.locationId = TAVERN_LOCATION_ID;
        character.ecologyState.presence.observableAtStage = true;
      }
    } else {
      character.lifeState.present = false;
      const offstageLocationId = getTavernEcologyProfile(character)?.initialConditions?.locationId
        || character.ecologyState?.presence?.locationId
        || character.currentLocationId;
      if (offstageLocationId && offstageLocationId !== TAVERN_LOCATION_ID) character.currentLocationId = offstageLocationId;
      if (character.ecologyState?.presence) {
        character.ecologyState.presence.locationId = character.currentLocationId || offstageLocationId || "";
        character.ecologyState.presence.observableAtStage = false;
        character.ecologyState.presence.arrivedAtSecond = null;
      }
    }
  }

  tavern.activeVisits = tavern.activeVisits.map((visit) => ensureVisitCommitments(state, visit));
  const presentActorIds = new Set((state.characters || []).filter((character) => character.lifeState?.present).map((character) => character.id));
  for (const positionId of Object.keys(tavern.guestPositionOccupancy || {})) {
    tavern.guestPositionOccupancy[positionId] = tavern.guestPositionOccupancy[positionId]
      .filter((actorId) => presentActorIds.has(actorId));
  }
  const storedAgents = tavern.sceneRuntime?.agents || {};
  for (const character of state.characters || []) {
    if (!character.lifeState?.present) continue;
    if (positions[character.id] || !storedAgents[character.id]?.zoneId) continue;
    const visit = tavern.activeVisits.find((item) => item.visitorId === character.id);
    if (!visit) {
      positions[character.id] = storedAgents[character.id].zoneId;
      continue;
    }
    const storedAgent = storedAgents[character.id];
    const restoredZoneId = tavernRestoredVisitorZone({ visit, storedAgent });
    positions[character.id] = restoredZoneId;
    if (restoredZoneId !== storedAgent.zoneId) {
      storedAgent.zoneId = restoredZoneId;
      storedAgent.zoneProvenance = {
        schemaVersion: 1,
        authority: "visit-lifecycle-restore",
        sourceVisitId: visit.id || "",
        toZoneId: restoredZoneId,
      };
      if (storedAgent.ecologyState?.presence) storedAgent.ecologyState.presence.zoneId = restoredZoneId;
      if (character.ecologyState?.presence) character.ecologyState.presence.zoneId = restoredZoneId;
      tavern.objectLedger = relocateHeldObjects({
        ledger: tavern.objectLedger,
        actorId: character.id,
        sceneId: TAVERN_LOCATION_ID,
        zoneId: restoredZoneId,
      });
    }
  }
  const characterIds = (state.characters || [])
    .filter((character) => character.lifeState?.present)
    .sort((a, b) => {
      const aCore = a.lifeProfile?.simulationTier === "core" ? 0 : 1;
      const bCore = b.lifeProfile?.simulationTier === "core" ? 0 : 1;
      const aUrgent = tavern.activeVisits.some((visit) => visit.visitorId === a.id && !TERMINAL_VISIT_STAGES.has(visit.stage)) ? 0 : 1;
      const bUrgent = tavern.activeVisits.some((visit) => visit.visitorId === b.id && !TERMINAL_VISIT_STAGES.has(visit.stage)) ? 0 : 1;
      return aCore - bCore || aUrgent - bUrgent;
    })
    .map((character) => character.id);
  if (!resume) seedImpacts.unshift(slotTrigger(slot, characterIds.includes(managerId) ? managerId : characterIds[0] || ""));
  return {
    state,
    characterIds,
    positions,
    seedImpacts,
    arrivals,
    slotContext: {
      day,
      slotId: `day-${day}-${slot.id}`,
      slotLabel: slot.label,
      slotBaseId: slot.id,
    },
  };
}
