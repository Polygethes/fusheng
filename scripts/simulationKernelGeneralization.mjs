/**
 * Phase 59 generic simulation-kernel RED.
 *
 * This probe deliberately knows nothing about any production story, venue, or
 * character. It uses two synthetic scene topologies and replaceable actor ids
 * to make sure the kernel owns the causal rules while a scene adapter owns the
 * setting data.
 *
 * Expected generic interfaces:
 *   actionUtility.mjs
 *     scoreActionCandidates({ actor, candidates, context })
 *   eventPropagation.mjs
 *     propagateImpact({ impact, actors, topology, relationships, observations })
 *   objectLedger.mjs
 *     normalizeObjectLedger(ledger)
 *     validateObjectOperations({ ledger, operations, actors, topology })
 *     applyObjectOperations({ ledger, operations, actors, topology })
 *   interactionScheduler.mjs
 *     latestAwaitingInteraction(...)
 *     interactionBudgetAllows(...)
 *
 * Missing modules/exports are collected as named REDs. A missing capability
 * therefore does not hide the remaining failures behind an import crash.
 */

const failures = [];
const passes = [];

function check(condition, contract, evidence = {}) {
  if (condition) passes.push(contract);
  else failures.push({ contract, evidence });
}

async function loadCapability(relativePath, requiredExports) {
  let module;
  try {
    module = await import(relativePath);
  } catch (error) {
    failures.push({
      contract: `通用内核必须提供 ${relativePath}`,
      evidence: {
        code: "MODULE_MISSING",
        message: String(error?.message || error),
        requiredExports,
      },
    });
    return null;
  }
  const missingExports = requiredExports.filter((name) => typeof module?.[name] !== "function");
  if (missingExports.length) {
    failures.push({
      contract: `${relativePath} 必须公开约定的通用接口`,
      evidence: {
        code: "EXPORT_MISSING",
        missingExports,
        availableExports: Object.keys(module || {}).sort(),
      },
    });
    return null;
  }
  return module;
}

const [actionUtility, eventPropagation, objectLedger, interactionScheduler, spatialPerception] = await Promise.all([
  loadCapability("../src/server/simulation/actionUtility.mjs", ["scoreActionCandidates"]),
  loadCapability("../src/server/simulation/eventPropagation.mjs", ["propagateImpact"]),
  loadCapability("../src/server/simulation/objectLedger.mjs", [
    "normalizeObjectLedger",
    "validateObjectOperations",
    "applyObjectOperations",
    "validateObjectAccess",
  ]),
  loadCapability("../src/server/simulation/interactionScheduler.mjs", [
    "latestAwaitingInteraction",
    "interactionBudgetAllows",
  ]),
  loadCapability("../src/server/simulation/spatialPerception.mjs", ["perceiveEntity", "conversationalSpeechAllowed"]),
]);

const OBSERVATORY_SCENE = "scene_mountain_observatory";
const FERRY_SCENE = "scene_river_ferry";

const ACTORS = {
  scout: "agent_lantern_scout",
  keeper: "agent_star_keeper",
  courier: "agent_river_courier",
  ferrymaster: "agent_ferrymaster",
};

const topology = {
  scenes: [
    { id: OBSERVATORY_SCENE, label: "mountain observatory" },
    { id: FERRY_SCENE, label: "river ferry" },
  ],
  zones: [
    { id: "observatory_roof", sceneId: OBSERVATORY_SCENE },
    { id: "instrument_room", sceneId: OBSERVATORY_SCENE },
    { id: "archive_vault", sceneId: OBSERVATORY_SCENE },
    { id: "ferry_deck", sceneId: FERRY_SCENE },
    { id: "ferry_cabin", sceneId: FERRY_SCENE },
  ],
  edges: [
    {
      fromZoneId: "observatory_roof",
      toZoneId: "instrument_room",
      distance: 1,
      modes: ["movement", "visual", "sound"],
      bidirectional: true,
    },
    {
      fromZoneId: "instrument_room",
      toZoneId: "archive_vault",
      distance: 1,
      modes: ["movement", "sound"],
      bidirectional: true,
    },
    {
      fromZoneId: "ferry_deck",
      toZoneId: "ferry_cabin",
      distance: 1,
      modes: ["movement", "sound"],
      bidirectional: true,
    },
  ],
};

function actor(id, sceneId, zoneId, overrides = {}) {
  return {
    id,
    actorId: id,
    present: true,
    sceneId,
    zoneId,
    traits: {},
    state: {},
    weights: {},
    ...overrides,
  };
}

function rankedRows(result) {
  const rows = Array.isArray(result)
    ? result
    : result?.ranked || result?.evaluations || result?.candidates || [];
  return [...rows].sort((left, right) => {
    const leftRank = Number(left?.rank);
    const rightRank = Number(right?.rank);
    if (Number.isFinite(leftRank) && Number.isFinite(rightRank)) return leftRank - rightRank;
    return scoreOf(right) - scoreOf(left);
  });
}

function candidateId(row) {
  return String(row?.candidateId || row?.id || row?.actionId || "");
}

function scoreOf(row) {
  for (const value of [row?.score, row?.utility, row?.activationScore, row?.total]) {
    if (Number.isFinite(Number(value))) return Number(value);
  }
  return Number.NaN;
}

function factorRows(row) {
  if (Array.isArray(row?.factorLedger)) return row.factorLedger;
  if (Array.isArray(row?.factors)) return row.factors;
  if (Array.isArray(row?.factorTrace)) return row.factorTrace;
  return [];
}

function factorFor(row, id) {
  return factorRows(row).find((factor) => (
    [factor?.id, factor?.key, factor?.factorId].map(String).includes(id)
  )) || null;
}

function contributionOf(factor) {
  for (const value of [factor?.contribution, factor?.weightedValue, factor?.score]) {
    if (Number.isFinite(Number(value))) return Number(value);
  }
  return Number.NaN;
}

async function checkSharedMathematicalActionUtility() {
  if (!actionUtility) return;

  const candidates = [
    {
      id: "climb_external_ladder",
      targetActorId: "",
      factors: {
        desire: 0.95,
        duty: 0.15,
        opportunity: 0.90,
        relationshipPull: 0.05,
        traumaDrive: 0.05,
        commitmentPressure: 0,
        safetyCost: 0.65,
        bodyCost: 0.50,
        environmentFriction: 0.35,
        socialInhibition: 0.05,
      },
    },
    {
      id: "calibrate_sextant",
      targetActorId: "",
      factors: {
        desire: 0.35,
        duty: 0.95,
        opportunity: 0.65,
        relationshipPull: 0,
        traumaDrive: 0,
        commitmentPressure: 0,
        safetyCost: 0.05,
        bodyCost: 0.12,
        environmentFriction: 0.10,
        socialInhibition: 0,
      },
    },
    {
      id: "sleep_in_archive",
      targetActorId: "",
      factors: {
        desire: 0.45,
        duty: 0.02,
        opportunity: 0.75,
        relationshipPull: 0,
        traumaDrive: 0,
        commitmentPressure: 0,
        safetyCost: 0,
        bodyCost: -0.60,
        environmentFriction: 0.05,
        socialInhibition: 0.15,
      },
    },
  ];

  const explorer = actor(ACTORS.scout, OBSERVATORY_SCENE, "observatory_roof", {
    traits: { impulsivity: 0.80, conscientiousness: 0.25, caution: 0.20 },
    state: { fatigue: 0.10, hunger: 0.10, arousal: 0.55, traumaActivation: 0.05 },
    weights: {
      desire: 1.50,
      duty: 0.25,
      opportunity: 0.90,
      relationshipPull: 0.40,
      traumaDrive: 0.80,
      commitmentPressure: 1.20,
      safetyCost: 0.30,
      bodyCost: 0.25,
      environmentFriction: 0.35,
      socialInhibition: 0.25,
    },
  });
  const exhaustedKeeper = actor(ACTORS.keeper, OBSERVATORY_SCENE, "instrument_room", {
    traits: { impulsivity: 0.10, conscientiousness: 0.95, caution: 0.85 },
    state: { fatigue: 0.82, hunger: 0.35, arousal: 0.20, traumaActivation: 0.05 },
    weights: {
      desire: 0.45,
      duty: 1.50,
      opportunity: 0.50,
      relationshipPull: 0.35,
      traumaDrive: 0.40,
      commitmentPressure: 1.50,
      safetyCost: 1.20,
      bodyCost: 1.10,
      environmentFriction: 0.80,
      socialInhibition: 0.55,
    },
  });

  const commonContext = {
    sceneId: OBSERVATORY_SCENE,
    atmosphere: { stormRisk: 0.45, privacy: 0.70, crowding: 0.05 },
    relationships: [],
    pendingInteractions: [],
  };
  const explorerResult = await actionUtility.scoreActionCandidates({
    actor: explorer,
    candidates: structuredClone(candidates),
    context: commonContext,
  });
  const keeperResult = await actionUtility.scoreActionCandidates({
    actor: exhaustedKeeper,
    candidates: structuredClone(candidates),
    context: commonContext,
  });
  const explorerRows = rankedRows(explorerResult);
  const keeperRows = rankedRows(keeperResult);

  check(
    candidateId(explorerRows[0]) === "climb_external_ladder"
      && candidateId(keeperRows[0]) === "calibrate_sextant",
    "同一数学行动函数必须因人物权重与当前身体状态不同而改变候选排序",
    {
      explorer: explorerRows.map((row) => ({ id: candidateId(row), score: scoreOf(row) })),
      keeper: keeperRows.map((row) => ({ id: candidateId(row), score: scoreOf(row) })),
    },
  );
  check(
    Boolean(explorerResult?.formulaVersion || explorerResult?.version)
      && explorerRows.every((row) => Number.isFinite(scoreOf(row)) && factorRows(row).length >= 4),
    "行动效用必须返回可审计公式版本、总分与逐因子贡献，不能只返回模型挑选结果",
    {
      formulaVersion: explorerResult?.formulaVersion || explorerResult?.version || "",
      rows: explorerRows.map((row) => ({
        id: candidateId(row),
        score: scoreOf(row),
        factors: factorRows(row),
      })),
    },
  );
}

async function checkRelationshipBuffersTraumaWithoutErasingIt() {
  if (!actionUtility) return;

  const triggeredActor = actor(ACTORS.scout, OBSERVATORY_SCENE, "instrument_room", {
    traits: { impulsivity: 0.92, attachmentSensitivity: 0.80, caution: 0.20 },
    state: { fatigue: 0.20, hunger: 0.10, arousal: 0.90, traumaActivation: 0.90 },
    weights: {
      desire: 0.80,
      duty: 0.30,
      opportunity: 0.55,
      relationshipPull: 0.60,
      traumaDrive: 1.35,
      commitmentPressure: 1.20,
      safetyCost: 0.35,
      bodyCost: 0.30,
      environmentFriction: 0.20,
      socialInhibition: 0.25,
      relationshipHarmCost: 1.10,
    },
  });
  const confrontation = [{
    id: "confront_target_now",
    targetActorId: ACTORS.keeper,
    factors: {
      desire: 0.70,
      duty: 0,
      opportunity: 0.85,
      relationshipPull: 0,
      traumaDrive: 0.90,
      commitmentPressure: 0,
      safetyCost: 0.20,
      bodyCost: 0.15,
      environmentFriction: 0.05,
      socialInhibition: 0.10,
      relationshipHarmCost: 0.70,
    },
  }];
  const baseContext = {
    sceneId: OBSERVATORY_SCENE,
    atmosphere: { privacy: 0.80, crowding: 0.05 },
    pendingInteractions: [],
  };

  const strangerResult = await actionUtility.scoreActionCandidates({
    actor: triggeredActor,
    candidates: structuredClone(confrontation),
    context: {
      ...baseContext,
      relationships: [{
        fromActorId: ACTORS.scout,
        toActorId: ACTORS.keeper,
        closeness: 0.02,
        trust: 0.02,
        care: 0.02,
        conflict: 0.20,
      }],
    },
  });
  const closeResult = await actionUtility.scoreActionCandidates({
    actor: triggeredActor,
    candidates: structuredClone(confrontation),
    context: {
      ...baseContext,
      relationships: [{
        fromActorId: ACTORS.scout,
        toActorId: ACTORS.keeper,
        closeness: 0.92,
        trust: 0.86,
        care: 0.90,
        conflict: 0.20,
      }],
    },
  });
  const calmResult = await actionUtility.scoreActionCandidates({
    actor: {
      ...triggeredActor,
      state: { ...triggeredActor.state, traumaActivation: 0.03, arousal: 0.20 },
    },
    candidates: structuredClone(confrontation),
    context: {
      ...baseContext,
      relationships: [{
        fromActorId: ACTORS.scout,
        toActorId: ACTORS.keeper,
        closeness: 0.92,
        trust: 0.86,
        care: 0.90,
        conflict: 0.20,
      }],
    },
  });
  const noRelationshipResult = await actionUtility.scoreActionCandidates({
    actor: triggeredActor,
    candidates: structuredClone(confrontation),
    context: { ...baseContext, relationships: [] },
  });
  const reverseOnlyResult = await actionUtility.scoreActionCandidates({
    actor: triggeredActor,
    candidates: structuredClone(confrontation),
    context: {
      ...baseContext,
      relationships: [{
        fromActorId: ACTORS.keeper,
        toActorId: ACTORS.scout,
        closeness: 0.99,
        trust: 0.99,
        care: 0.99,
      }],
    },
  });

  const strangerRow = rankedRows(strangerResult)[0];
  const closeRow = rankedRows(closeResult)[0];
  const calmRow = rankedRows(calmResult)[0];
  const strangerTrauma = contributionOf(factorFor(strangerRow, "traumaDrive"));
  const closeTrauma = contributionOf(factorFor(closeRow, "traumaDrive"));
  const calmTrauma = contributionOf(factorFor(calmRow, "traumaDrive"));

  check(
    Number.isFinite(strangerTrauma)
      && Number.isFinite(closeTrauma)
      && Number.isFinite(calmTrauma)
      && strangerTrauma > closeTrauma
      && closeTrauma > calmTrauma
      && closeTrauma > 0,
    "亲密关系必须缓冲创伤触发的行动推动，但不能把仍在发生的触发直接清零",
    {
      strangerTrauma,
      closeTrauma,
      calmTrauma,
      strangerFactors: factorRows(strangerRow),
      closeFactors: factorRows(closeRow),
      calmFactors: factorRows(calmRow),
    },
  );
  check(
    scoreOf(rankedRows(noRelationshipResult)[0]) === scoreOf(rankedRows(reverseOnlyResult)[0]),
    "有向关系不能反向借用；只有 B→A 时不得改变 A 对 B 的行动效用",
    {
      noRelationship: rankedRows(noRelationshipResult)[0],
      reverseOnly: rankedRows(reverseOnlyResult)[0],
    },
  );
}

function deliveriesFrom(result) {
  if (Array.isArray(result)) return result;
  return result?.deliveries || result?.observations || result?.receivedImpacts || [];
}

function deliveryTarget(delivery) {
  return String(
    delivery?.targetActorId
      || delivery?.receiverActorId
      || delivery?.observerActorId
      || delivery?.actorId
      || "",
  );
}

function provenanceText(delivery) {
  return JSON.stringify({
    sourceImpactId: delivery?.sourceImpactId,
    provenance: delivery?.provenance,
    chain: delivery?.provenanceChain,
    mode: delivery?.mode || delivery?.deliveryMode,
    kind: delivery?.kind || delivery?.impactKind,
  });
}

async function checkImpactDistanceAndRumorRelay() {
  if (!eventPropagation) return;

  const directActors = [
    actor(ACTORS.scout, OBSERVATORY_SCENE, "observatory_roof"),
    actor(ACTORS.keeper, OBSERVATORY_SCENE, "instrument_room"),
    actor(ACTORS.courier, FERRY_SCENE, "ferry_deck"),
    actor(ACTORS.ferrymaster, FERRY_SCENE, "ferry_cabin"),
  ];
  const directImpact = {
    id: "impact_warning_bell",
    sourceActorId: ACTORS.scout,
    sourceSceneId: OBSERVATORY_SCENE,
    sourceZoneId: "observatory_roof",
    kind: "direct_event",
    modality: "sound",
    intensity: 0.90,
    radius: 1,
    content: "the warning bell rang once",
    createdAtSeconds: 100,
    provenance: { kind: "direct_observation", rootImpactId: "impact_warning_bell" },
  };
  const directResult = await eventPropagation.propagateImpact({
    impact: directImpact,
    actors: directActors,
    topology,
    relationships: [],
    observations: [],
  });
  const directDeliveries = deliveriesFrom(directResult);
  const keeperDelivery = directDeliveries.find((delivery) => deliveryTarget(delivery) === ACTORS.keeper);
  const crossSceneLeak = directDeliveries.find((delivery) => (
    [ACTORS.courier, ACTORS.ferrymaster].includes(deliveryTarget(delivery))
  ));

  check(
    Boolean(keeperDelivery) && !crossSceneLeak,
    "近距离影响可以直接传播，但不能仅因同时存在就跨场景泄漏",
    {
      deliveries: directDeliveries,
      expectedNearActor: ACTORS.keeper,
      forbiddenCrossSceneActors: [ACTORS.courier, ACTORS.ferrymaster],
    },
  );

  const lowBondObserver = "agent_low_bond_observer";
  const relationshipResult = await eventPropagation.propagateImpact({
    impact: { ...directImpact, id: "impact_relationship_scale", radius: 2 },
    actors: [
      actor(ACTORS.scout, OBSERVATORY_SCENE, "observatory_roof"),
      actor(ACTORS.keeper, OBSERVATORY_SCENE, "instrument_room"),
      actor(lowBondObserver, OBSERVATORY_SCENE, "instrument_room"),
    ],
    topology,
    relationships: [
      { fromActorId: ACTORS.keeper, toActorId: ACTORS.scout, closeness: 95 },
      { fromActorId: lowBondObserver, toActorId: ACTORS.scout, closeness: 5 },
    ],
    observations: [],
  });
  const relationshipDeliveries = deliveriesFrom(relationshipResult);
  const highBond = relationshipDeliveries.find((delivery) => deliveryTarget(delivery) === ACTORS.keeper);
  const lowBond = relationshipDeliveries.find((delivery) => deliveryTarget(delivery) === lowBondObserver);
  check(
    highBond?.relationshipSalience > lowBond?.relationshipSalience + 0.15
      && highBond?.impactScore > lowBond?.impactScore,
    "0..100 关系强度必须保留差异并真实改变同距离影响权重",
    { highBond, lowBond },
  );

  const relayActors = [
    actor(ACTORS.scout, OBSERVATORY_SCENE, "observatory_roof"),
    actor(ACTORS.keeper, FERRY_SCENE, "ferry_deck"),
    actor(ACTORS.courier, FERRY_SCENE, "ferry_cabin"),
  ];
  const rumorImpact = {
    id: "impact_warning_bell_relay",
    sourceActorId: ACTORS.keeper,
    sourceSceneId: FERRY_SCENE,
    sourceZoneId: "ferry_deck",
    kind: "rumor",
    modality: "speech",
    intensity: 0.62,
    radius: 1,
    content: "the keeper says the mountain bell rang",
    createdAtSeconds: 420,
    provenance: {
      kind: "rumor",
      sourceImpactId: directImpact.id,
      rootImpactId: directImpact.id,
      chain: [ACTORS.scout, ACTORS.keeper],
      reliability: 0.72,
    },
  };
  const relayResult = await eventPropagation.propagateImpact({
    impact: rumorImpact,
    actors: relayActors,
    topology,
    relationships: [],
    observations: directDeliveries,
  });
  const relayDeliveries = deliveriesFrom(relayResult);
  const courierDelivery = relayDeliveries.find((delivery) => deliveryTarget(delivery) === ACTORS.courier);
  const courierProvenance = provenanceText(courierDelivery);

  check(
    Boolean(courierDelivery)
      && courierProvenance.includes(directImpact.id)
      && /rumor/i.test(courierProvenance),
    "跨场景事实只有经第三人重新发出传闻影响后才能传播，并必须保留来源链与传闻属性",
    {
      relayDeliveries,
      expectedActor: ACTORS.courier,
      expectedRootImpactId: directImpact.id,
      courierProvenance,
    },
  );
}

function operationSucceeded(result) {
  if (typeof result?.ok === "boolean") return result.ok;
  if (typeof result?.valid === "boolean") return result.valid;
  if (typeof result?.applied === "boolean") return result.applied;
  return !(result?.violations || result?.errors || []).length;
}

function resultLedger(result, fallback) {
  return result?.ledger || result?.objectLedger || result?.nextLedger || result?.state || fallback;
}

function objectFrom(ledger, objectId) {
  const source = ledger?.objects;
  if (Array.isArray(source)) return source.find((object) => object?.id === objectId) || null;
  return source?.[objectId] || null;
}

function objectHolder(object) {
  return String(object?.holderActorId || object?.heldByActorId || object?.ownerActorId || "");
}

function objectZone(object) {
  return String(object?.zoneId || object?.location?.zoneId || "");
}

function heldObjectIds(ledger, actorId) {
  const direct = ledger?.heldByActor?.[actorId] || ledger?.heldByCharacter?.[actorId];
  if (Array.isArray(direct)) return direct;
  const source = Array.isArray(ledger?.objects) ? ledger.objects : Object.values(ledger?.objects || {});
  return source.filter((object) => objectHolder(object) === actorId).map((object) => object.id);
}

async function checkObjectOwnershipAndMovementStayCanonical() {
  if (!objectLedger) return;

  const reachableObjectId = "object_observatory_sky_chart";
  const reachLedger = objectLedger.normalizeObjectLedger({
    schemaVersion: 1,
    objects: [{
      id: reachableObjectId,
      label: "observatory sky chart",
      holderActorId: "",
      sceneId: OBSERVATORY_SCENE,
      zoneId: "instrument_room",
      portable: true,
    }],
  });
  const pickup = (actorId) => ({
    type: "pickup",
    objectId: reachableObjectId,
    actorId,
    sceneId: OBSERVATORY_SCENE,
    zoneId: "instrument_room",
  });
  const reachActors = [
    { id: "entity_location_unknown", present: true },
    actor(ACTORS.keeper, OBSERVATORY_SCENE, "instrument_room"),
    actor(ACTORS.scout, OBSERVATORY_SCENE, "observatory_roof"),
    actor(ACTORS.courier, FERRY_SCENE, "ferry_deck"),
  ];
  const unknownAccess = objectLedger.validateObjectAccess({
    ledger: reachLedger,
    actor: reachActors[0],
    objectIds: [reachableObjectId],
    sceneId: OBSERVATORY_SCENE,
    zoneId: "instrument_room",
    topology,
  });
  const mismatchedActorAccess = objectLedger.validateObjectAccess({
    ledger: reachLedger,
    actor: actor("entity_scene_zone_mismatch", OBSERVATORY_SCENE, "ferry_deck"),
    objectIds: [reachableObjectId],
    topology,
  });
  const mismatchedObjectAccess = objectLedger.validateObjectAccess({
    ledger: objectLedger.normalizeObjectLedger({
      objects: [{
        id: "object_scene_zone_mismatch",
        label: "misfiled field case",
        sceneId: OBSERVATORY_SCENE,
        zoneId: "ferry_deck",
        portable: true,
      }],
    }),
    actor: reachActors[1],
    objectIds: ["object_scene_zone_mismatch"],
    topology,
  });
  const crossSceneAccess = objectLedger.validateObjectAccess({
    ledger: reachLedger,
    actor: reachActors[3],
    objectIds: [reachableObjectId],
    topology,
  });
  const colocatedAccess = objectLedger.validateObjectAccess({
    ledger: reachLedger,
    actor: reachActors[1],
    objectIds: [reachableObjectId],
    topology,
  });
  check(
    unknownAccess.valid === false
      && unknownAccess.violations[0]?.code === "OBJECT_ACTOR_LOCATION_UNKNOWN"
      && mismatchedActorAccess.valid === false
      && mismatchedActorAccess.violations[0]?.code === "OBJECT_ACTOR_ZONE_SCENE_MISMATCH"
      && mismatchedObjectAccess.valid === false
      && mismatchedObjectAccess.violations[0]?.code === "OBJECT_ZONE_SCENE_MISMATCH",
    "物件访问必须使用人物已提交的位置，且人物和物件的区域都必须属于各自声明的场景",
    { unknownAccess, mismatchedActorAccess, mismatchedObjectAccess },
  );
  check(
    crossSceneAccess.valid === false
      && crossSceneAccess.violations.some((entry) => entry.code === "OBJECT_OUT_OF_REACH")
      && colocatedAccess.valid === true,
    "通用物件访问必须拒绝跨场景对象，同时保留同场同区的合法访问",
    { crossSceneAccess, colocatedAccess },
  );
  const unknownLocationResult = objectLedger.applyObjectOperations({
    ledger: reachLedger,
    operations: [pickup("entity_location_unknown")],
    actors: reachActors,
    topology,
  });
  const crossSceneResult = objectLedger.applyObjectOperations({
    ledger: reachLedger,
    operations: [pickup(ACTORS.courier)],
    actors: reachActors,
    topology,
  });
  const crossZoneResult = objectLedger.applyObjectOperations({
    ledger: reachLedger,
    operations: [pickup(ACTORS.scout)],
    actors: reachActors,
    topology,
  });
  const colocatedResult = objectLedger.applyObjectOperations({
    ledger: reachLedger,
    operations: [pickup(ACTORS.keeper)],
    actors: reachActors,
    topology,
  });
  check(
    !operationSucceeded(unknownLocationResult)
      && unknownLocationResult?.violations?.[0]?.code === "OBJECT_ACTOR_LOCATION_UNKNOWN"
      && !objectHolder(objectFrom(resultLedger(unknownLocationResult, reachLedger), reachableObjectId)),
    "人物缺少当前场景或区域时，操作声明不能代替人物位置来绕过物理校验",
    { unknownLocationResult },
  );
  check(
    !operationSucceeded(crossSceneResult)
      && crossSceneResult?.violations?.[0]?.code === "OBJECT_ACTOR_WRONG_SCENE"
      && !operationSucceeded(crossZoneResult)
      && crossZoneResult?.violations?.[0]?.code === "OBJECT_OUT_OF_REACH",
    "跨场景或跨区域的人物不能隔空拿取物件",
    { crossSceneResult, crossZoneResult },
  );
  check(
    operationSucceeded(colocatedResult)
      && objectHolder(objectFrom(resultLedger(colocatedResult, reachLedger), reachableObjectId)) === ACTORS.keeper,
    "人物与物件同场同区且位置完整时，合法物理操作仍应通过",
    { colocatedResult },
  );

  const objectId = "object_brass_astrolabe";
  const initialInput = {
    schemaVersion: 1,
    objects: [{
      id: objectId,
      label: "brass astrolabe",
      holderActorId: ACTORS.keeper,
      sceneId: OBSERVATORY_SCENE,
      zoneId: "instrument_room",
      portable: true,
      state: { calibrated: false },
    }],
  };
  const initial = objectLedger.normalizeObjectLedger(structuredClone(initialInput));
  const colocatedActors = [
    actor(ACTORS.keeper, OBSERVATORY_SCENE, "instrument_room"),
    actor(ACTORS.scout, OBSERVATORY_SCENE, "instrument_room"),
    actor(ACTORS.courier, FERRY_SCENE, "ferry_deck"),
  ];
  const transferOperation = {
    type: "transfer",
    objectId,
    actorId: ACTORS.keeper,
    fromHolderActorId: ACTORS.keeper,
    toHolderActorId: ACTORS.scout,
    sceneId: OBSERVATORY_SCENE,
    zoneId: "instrument_room",
  };
  const transferValidation = objectLedger.validateObjectOperations({
    ledger: initial,
    operations: [transferOperation],
    actors: colocatedActors,
    topology,
  });
  const transferResult = objectLedger.applyObjectOperations({
    ledger: initial,
    operations: [transferOperation],
    actors: colocatedActors,
    topology,
  });
  const afterTransfer = resultLedger(transferResult, initial);
  const transferredObject = objectFrom(afterTransfer, objectId);

  check(
    operationSucceeded(transferValidation)
      && operationSucceeded(transferResult)
      && objectHolder(transferredObject) === ACTORS.scout
      && !heldObjectIds(afterTransfer, ACTORS.keeper).includes(objectId)
      && heldObjectIds(afterTransfer, ACTORS.scout).filter((id) => id === objectId).length === 1,
    "可携物转交后必须只有一个持有人，旧持有人的索引必须同步清除",
    {
      transferValidation,
      transferResult,
      transferredObject,
      heldByKeeper: heldObjectIds(afterTransfer, ACTORS.keeper),
      heldByScout: heldObjectIds(afterTransfer, ACTORS.scout),
    },
  );

  const movedActors = colocatedActors.map((row) => (
    row.id === ACTORS.scout
      ? { ...row, zoneId: "observatory_roof" }
      : row
  ));
  const placeOperation = {
    type: "place",
    objectId,
    actorId: ACTORS.scout,
    fromHolderActorId: ACTORS.scout,
    toHolderActorId: "",
    sceneId: OBSERVATORY_SCENE,
    toZoneId: "observatory_roof",
  };
  const placeResult = objectLedger.applyObjectOperations({
    ledger: afterTransfer,
    operations: [placeOperation],
    actors: movedActors,
    topology,
  });
  const afterPlace = resultLedger(placeResult, afterTransfer);
  const placedObject = objectFrom(afterPlace, objectId);
  check(
    operationSucceeded(placeResult)
      && !objectHolder(placedObject)
      && objectZone(placedObject) === "observatory_roof"
      && !heldObjectIds(afterPlace, ACTORS.scout).includes(objectId),
    "人物携物移动后放置物件，物件位置、持有人和反向索引必须原子一致",
    {
      placeResult,
      placedObject,
      heldByScout: heldObjectIds(afterPlace, ACTORS.scout),
    },
  );

  const invalidOperation = {
    type: "place",
    objectId,
    actorId: ACTORS.courier,
    fromHolderActorId: ACTORS.courier,
    toHolderActorId: "",
    sceneId: FERRY_SCENE,
    toZoneId: "ferry_deck",
  };
  const invalidValidation = objectLedger.validateObjectOperations({
    ledger: afterPlace,
    operations: [invalidOperation],
    actors: movedActors,
    topology,
  });
  const invalidResult = objectLedger.applyObjectOperations({
    ledger: afterPlace,
    operations: [invalidOperation],
    actors: movedActors,
    topology,
  });
  const afterInvalid = resultLedger(invalidResult, afterPlace);
  const invalidCodes = JSON.stringify([
    ...(invalidValidation?.violations || invalidValidation?.errors || []),
    ...(invalidResult?.violations || invalidResult?.errors || []),
  ]);
  check(
    !operationSucceeded(invalidValidation)
      && !operationSucceeded(invalidResult)
      && objectZone(objectFrom(afterInvalid, objectId)) === "observatory_roof"
      && !objectHolder(objectFrom(afterInvalid, objectId))
      && /OBJECT_NOT_POSSESSED|NOT_HOLDER|WRONG_HOLDER/i.test(invalidCodes),
    "未持有物件且身处另一场景的人不能放置它；失败操作不能改变物件真值",
    {
      invalidValidation,
      invalidResult,
      objectAfterInvalid: objectFrom(afterInvalid, objectId),
      invalidCodes,
    },
  );

  check(
    objectHolder(objectFrom(initial, objectId)) === ACTORS.keeper
      && objectZone(objectFrom(initial, objectId)) === "instrument_room",
    "物件账本操作必须返回新状态，不能回写污染输入快照",
    { initialObjectAfterAllOperations: objectFrom(initial, objectId) },
  );
}

async function checkPendingCommitmentGetsResponsePriority() {
  if (!interactionScheduler) return;

  const pendingRequest = {
    id: "request_weather_reading",
    requesterId: ACTORS.scout,
    responderId: ACTORS.keeper,
    status: "awaiting",
    topic: "storm reading",
    openedAtStep: 7,
    sourceActionId: "action_ask_weather",
    priority: 100,
  };
  const requests = [
    {
      id: "request_old_resolved",
      requesterId: ACTORS.courier,
      responderId: ACTORS.keeper,
      status: "resolved",
      openedAtStep: 3,
    },
    pendingRequest,
  ];
  const selected = interactionScheduler.latestAwaitingInteraction(requests, {
    participantAvailable: () => true,
    requestHasDelivery: () => true,
  });
  const followupAllowed = interactionScheduler.interactionBudgetAllows({
    ordinarySteps: 1,
    baseStepBudget: 1,
    followupSteps: 0,
    maxFollowupSteps: 2,
    hasAwaitingInteraction: true,
  });
  check(
    selected?.id === pendingRequest.id && followupAllowed,
    "未回应的承诺请求必须越过普通步数边界，获得同一交互时刻的回应机会",
    { selected, followupAllowed },
  );

  if (!actionUtility) return;
  const keeper = actor(ACTORS.keeper, OBSERVATORY_SCENE, "instrument_room", {
    traits: { conscientiousness: 0.75, impulsivity: 0.15 },
    state: { fatigue: 0.35, hunger: 0.10, arousal: 0.40, traumaActivation: 0 },
    weights: {
      desire: 1,
      duty: 0.80,
      opportunity: 0.65,
      relationshipPull: 0.45,
      traumaDrive: 0.50,
      commitmentPressure: 1.25,
      safetyCost: 0.60,
      bodyCost: 0.55,
      environmentFriction: 0.40,
      socialInhibition: 0.30,
    },
  });
  const ranked = rankedRows(await actionUtility.scoreActionCandidates({
    actor: keeper,
    candidates: [
      {
        id: "answer_weather_request",
        targetActorId: ACTORS.scout,
        respondsToRequestId: pendingRequest.id,
        priorityClass: "response_obligation",
        factors: {
          desire: 0.25,
          duty: 0.55,
          opportunity: 0.80,
          relationshipPull: 0.30,
          traumaDrive: 0,
          commitmentPressure: 0.55,
          safetyCost: 0,
          bodyCost: 0.05,
          environmentFriction: 0,
          socialInhibition: 0.05,
        },
      },
      {
        id: "inspect_new_comet",
        targetActorId: "",
        factors: {
          desire: 0.98,
          duty: 0.70,
          opportunity: 0.95,
          relationshipPull: 0,
          traumaDrive: 0,
          commitmentPressure: 0,
          safetyCost: 0,
          bodyCost: 0.05,
          environmentFriction: 0,
          socialInhibition: 0,
        },
      },
    ],
    context: {
      sceneId: OBSERVATORY_SCENE,
      atmosphere: { urgency: 0.55, privacy: 0.70 },
      relationships: [],
      pendingInteractions: [pendingRequest],
    },
  }));
  check(
    candidateId(ranked[0]) === "answer_weather_request",
    "已送达且正等待回应的请求必须形成回应优先级，不能被更高的普通欲望分数吞掉",
    { ranking: ranked.map((row) => ({ id: candidateId(row), score: scoreOf(row), factors: factorRows(row) })) },
  );

  const obligationOrder = rankedRows(await actionUtility.scoreActionCandidates({
    actor: keeper,
    candidates: [
      {
        id: "answer_direct_request",
        targetActorId: ACTORS.scout,
        respondsToRequestId: pendingRequest.id,
        priorityClass: "response_obligation",
        factors: { desire: 0.05, commitmentPressure: 0.25 },
      },
      {
        id: "finish_accepted_calibration",
        priorityClass: "commitment_obligation",
        obligationPriority: 0.82,
        factors: { desire: 0.10, duty: 0.30, commitmentPressure: 0.55 },
      },
      {
        id: "inspect_unassigned_alarm",
        priorityClass: "responsibility_obligation",
        obligationPriority: 1,
        factors: { desire: 1, duty: 1, opportunity: 1 },
      },
      {
        id: "follow_private_curiosity",
        factors: { desire: 1, duty: 1, opportunity: 1 },
      },
    ],
    context: {
      sceneId: OBSERVATORY_SCENE,
      pendingInteractions: [pendingRequest],
    },
  }));
  check(
    obligationOrder.map(candidateId).join(",") === [
      "answer_direct_request",
      "finish_accepted_calibration",
      "inspect_unassigned_alarm",
      "follow_private_curiosity",
    ].join(","),
    "统一公式必须稳定遵守：当面回应 > 已接受承诺 > 尚未接手的职责 > 私人欲望",
    { order: obligationOrder.map((row) => ({ id: candidateId(row), priorityTier: row.priorityTier, score: scoreOf(row) })) },
  );
}

async function checkSpatialPerceptionUsesGenericActorIdentity() {
  if (!spatialPerception) return;

  const routeFor = (fromZoneId, toZoneId, mode) => {
    if (mode === "visual" && fromZoneId === toZoneId) return { distance: 0, mode };
    if (
      mode === "sound"
      && fromZoneId === "archive_vault"
      && toZoneId === "instrument_room"
    ) return { distance: 1, mode };
    return null;
  };

  const genericVisible = spatialPerception.perceiveEntity({
    observer: { id: "entity_roof_observer", present: true, zoneId: "observatory_roof" },
    subject: { actorId: "agent_roof_subject", present: true, zoneId: "observatory_roof" },
    routeFor,
  });
  check(
    genericVisible?.canSee === true,
    "只有 id 或 actorId 的不同实体仍必须互相可见，不能因都缺少 characterId 被误判为同一人",
    { genericVisible },
  );

  const sourceFieldCases = [
    ["sourceActorId", "agent_archive_bell"],
    ["sourceEntityId", "entity_archive_bell"],
    ["sourceCharacterId", "legacy_archive_bell"],
  ];
  const auditoryResults = sourceFieldCases.map(([sourceField, sourceId]) => spatialPerception.perceiveEntity({
    observer: { actorId: "agent_instrument_listener", present: true, zoneId: "instrument_room" },
    subject: { id: sourceId, present: true, zoneId: "archive_vault" },
    observations: [{
      id: `observation_${sourceField}`,
      [sourceField]: sourceId,
      modality: "sound",
      deliveredAtSeconds: 90,
    }],
    nowSeconds: 100,
    routeFor,
  }));
  check(
    auditoryResults.every((result) => result?.canHear === true && result?.mode === "audible-only"),
    "声音来源必须统一识别 sourceActorId、sourceEntityId 与 sourceCharacterId",
    { sourceFieldCases, auditoryResults },
  );

  const crossSceneSameZoneSpeech = spatialPerception.conversationalSpeechAllowed({
    sourceSceneId: OBSERVATORY_SCENE,
    targetSceneId: FERRY_SCENE,
    sourceZoneId: "shared_hall",
    targetZoneId: "shared_hall",
    routeFor: () => ({ distance: 0 }),
  });
  const oneSidedSceneSpeech = spatialPerception.conversationalSpeechAllowed({
    sourceLocationId: OBSERVATORY_SCENE,
    sourceZoneId: "shared_hall",
    targetZoneId: "shared_hall",
    routeFor: () => ({ distance: 0 }),
  });
  const sameSceneSameZoneSpeech = spatialPerception.conversationalSpeechAllowed({
    sourceLocationId: OBSERVATORY_SCENE,
    targetLocationId: OBSERVATORY_SCENE,
    sourceZoneId: "shared_hall",
    targetZoneId: "shared_hall",
    routeFor: () => ({ distance: 0 }),
  });
  check(
    crossSceneSameZoneSpeech === false
      && oneSidedSceneSpeech === false
      && sameSceneSameZoneSpeech === true,
    "同名区域不能跨场景通话；一旦声明场景，双方必须具有一致的场景身份",
    { crossSceneSameZoneSpeech, oneSidedSceneSpeech, sameSceneSameZoneSpeech },
  );
}

await checkSharedMathematicalActionUtility();
await checkRelationshipBuffersTraumaWithoutErasingIt();
await checkImpactDistanceAndRumorRelay();
await checkObjectOwnershipAndMovementStayCanonical();
await checkPendingCommitmentGetsResponsePriority();
await checkSpatialPerceptionUsesGenericActorIdentity();

if (failures.length) {
  console.error("simulationKernelGeneralization:test failed");
  console.error(JSON.stringify({ passed: passes.length, failed: failures.length, failures }, null, 2));
  process.exit(1);
}

console.log("simulationKernelGeneralization:test passed", {
  passed: passes.length,
  scenes: [OBSERVATORY_SCENE, FERRY_SCENE],
  actorIds: Object.values(ACTORS),
});
