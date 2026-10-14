import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  prepareTavernCausalSlot,
  TAVERN_CAUSAL_DAY_SLOTS,
} from "../src/server/pipeline/tavernCausalEconomy.mjs";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";

const IDS = {
  mother: "char_xyy_xiemu",
  father: "char_xyy_xieheng",
  son: "char_xyy_xiezenshi",
  zhou: "char_xyy_zhoumin",
};

const failures = [];
const passes = [];

function check(condition, contract, evidence = "") {
  if (condition) passes.push(contract);
  else failures.push({ contract, evidence });
}

function baseState() {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  state.ui.timeGrain = "scene";
  state.ui.engineMode = "openai";
  for (const character of state.characters || []) {
    if ([IDS.mother, IDS.father, IDS.son].includes(character.id)) character.lifeState.present = true;
  }
  return state;
}

function decision(overrides = {}) {
  return {
    candidateId: "",
    actionType: "pass",
    speechAct: "none",
    targetCharacterId: "",
    speech: "",
    visibleAction: "",
    moveToZoneId: "",
    affordanceId: "",
    informationSourceImpactId: "",
    commitmentAction: "none",
    commitmentTopic: "",
    privateReason: "Phase 59 确定性空间与物件探针。",
    ...overrides,
  };
}

function directedActivation(actorId, sourceZoneId) {
  return [{
    id: `phase59:activate:${actorId}:${sourceZoneId}`,
    sourceCharacterId: "world:phase59-probe",
    sourceZoneId,
    type: "institution",
    modality: "memory",
    intensity: 100,
    radius: 0,
    directedTargetId: actorId,
    content: "只用于激活确定性测试人物。",
    topic: "Phase 59 硬门控",
  }];
}

async function runProbe(state, {
  actorId,
  characterIds,
  positions,
  proposedDecision,
  captureInput,
  slotId,
}) {
  return runTavernCausalScene(state, {
    characterIds,
    positions,
    seedImpacts: directedActivation(actorId, positions[actorId]),
    slotContext: { day: 3, slotId, slotLabel: "午后", slotBaseId: "afternoon" },
    maxSteps: 1,
    minimumActivationScore: 0,
    async runAgent(input) {
      captureInput?.(structuredClone(input));
      const candidate = input.privateActionCandidates.find((item) => (
        item.feasible && item.actionKind === "handle_environment_event"
      )) || input.privateActionCandidates.find((item) => item.feasible) || null;
      return { decision: decision({
        ...proposedDecision,
        candidateId: proposedDecision?.candidateId || candidate?.candidateId || "",
      }) };
    },
  });
}

async function caseSilentRemoteHostIsNotPerceived() {
  const state = baseState();
  const zhou = state.characters.find((character) => character.id === IDS.zhou);
  zhou.lifeState.present = true;
  zhou.currentLocationId = "loc_xyy_tavern";
  state.tavernState.activeVisits = [{
    id: "phase59:visit:zhou",
    visitorId: IDS.zhou,
    visitorName: "周珉",
    kind: "delivery",
    purpose: "送来药包和清单，并在交割后找谢真石问举荐答复",
    expectedHostIds: [IDS.father, IDS.mother],
    requestedService: "meal",
    paymentMode: "cash",
    completionCondition: "药包验收、饭钱结清，并决定是否见谢真石",
    purposeStatus: "undisclosed",
    purposeDisclosureStatus: "undisclosed",
    purposeZoneIds: ["hall"],
    allowedZoneIds: ["threshold", "hall"],
    carriedObjectLabel: "药包和清单",
    arrivalCue: "带着药包和清单站在门槛内",
    stage: "waiting",
    hostId: "",
  }];
  let captured = null;
  await runProbe(state, {
    actorId: IDS.zhou,
    characterIds: [IDS.zhou, IDS.father, IDS.mother],
    positions: { [IDS.zhou]: "threshold", [IDS.father]: "courtyard", [IDS.mother]: "hall" },
    slotId: "phase59:silent-remote-host",
    proposedDecision: decision(),
    captureInput(input) { captured = input; },
  });
  const perceivedFather = captured?.perceivedCharacters?.find((row) => row.id === IDS.father) || null;
  const declaration = captured?.availableAffordances?.find((row) => row.type === "declare_visit_purpose") || null;
  check(
    !perceivedFather && declaration?.targetCharacterId !== IDS.father,
    "沉默的后院人物不能仅因声学连通进入访客感知，也不能成为 declare_visit_purpose 对象",
    JSON.stringify({
      perceivedFather,
      declaration: declaration ? {
        id: declaration.id,
        targetCharacterId: declaration.targetCharacterId,
        moveToZoneId: declaration.moveToZoneId,
      } : null,
      perceivedCharacters: captured?.perceivedCharacters || [],
    }),
  );
}

async function caseCrossZoneSpeechUsesAcousticPropagation() {
  const state = baseState();
  const result = await runProbe(state, {
    actorId: IDS.father,
    characterIds: [IDS.father, IDS.mother],
    positions: { [IDS.father]: "courtyard", [IDS.mother]: "hall" },
    slotId: "phase59:cross-zone-speech",
    proposedDecision: decision({
      actionType: "speak",
      speechAct: "inform",
      targetCharacterId: IDS.mother,
      speech: "他娘，账先放着，我收完后院的柴再过去。",
    }),
  });
  const spokenAction = (result.actions || []).find((action) => (
    action.actorId === IDS.father
    && action.targetCharacterId === IDS.mother
    && Boolean(action.speech)
  ));
  const speechImpactIds = new Set((spokenAction?.impactFactors || [])
    .filter((impact) => impact.type === "speech")
    .map((impact) => impact.id));
  const acousticDelivery = (result.deliveries || []).find((delivery) => (
    delivery.recipientId === IDS.mother && speechImpactIds.has(delivery.impactId)
  ));
  const claimCodes = (result.decisions || []).flatMap((entry) => (
    entry.decision?.claimAnnotations || []
  )).map((violation) => violation.code);
  check(
    Boolean(spokenAction && acousticDelivery)
      && claimCodes.includes("DIALOGUE_TARGET_OUT_OF_RANGE"),
    "人物可以从相邻区域开口；世界按声学路径决定是否传到目标，并把非面对面普通音量保留为表达诊断",
    JSON.stringify({
      actorZoneId: spokenAction?.actorZoneId,
      targetCharacterId: spokenAction?.targetCharacterId,
      speech: spokenAction?.speech,
      acousticDelivery,
      claimCodes,
    }),
  );
}

async function caseThresholdAndHallShareConversationalSpace() {
  const state = baseState();
  const result = await runProbe(state, {
    actorId: IDS.father,
    characterIds: [IDS.father, IDS.mother],
    positions: { [IDS.father]: "hall", [IDS.mother]: "threshold" },
    slotId: "phase59:threshold-hall-conversation",
    proposedDecision: decision({
      actionType: "speak",
      speechAct: "inform",
      targetCharacterId: IDS.mother,
      speech: "他娘，门边风凉，先往里站一步。",
    }),
  });
  const spokenAction = (result.actions || []).find((action) => (
    action.actorId === IDS.father
    && action.targetCharacterId === IDS.mother
    && Boolean(action.speech)
  ));
  const claimCodes = (result.decisions || []).flatMap((entry) => (
    entry.decision?.claimAnnotations || []
  )).map((violation) => violation.code);
  const delivery = (result.deliveries || []).find((row) => (
    row.recipientId === IDS.mother
    && row.provenance?.sourceActionId === spokenAction?.id
  ));
  check(
    Boolean(spokenAction && delivery)
      && !claimCodes.includes("DIALOGUE_TARGET_OUT_OF_RANGE"),
    "门槛与堂前由世界拓扑标成同一自然交谈范围时，普通音量应能传达且不能被另一套距离规则误判",
    JSON.stringify({ spokenAction, delivery, claimCodes }),
  );
}

async function caseVisibleMovementCannotBypassMoveCommit() {
  const state = baseState();
  const result = await runProbe(state, {
    actorId: IDS.son,
    characterIds: [IDS.son],
    positions: { [IDS.son]: "courtyard" },
    slotId: "phase59:uncommitted-visible-move",
    proposedDecision: decision({
      actionType: "act",
      visibleAction: "谢真石从后院起身，朝堂前走去。",
      moveToZoneId: "",
    }),
  });
  const smuggledMove = (result.actions || []).find((action) => /朝堂前走去|进入堂前/.test(action.visibleAction || ""));
  const violationCodes = (result.decisions || []).flatMap((entry) => [
    ...(entry.decision?.actionAttemptFailures || []),
    ...(entry.decision?.semanticViolations || []),
  ]).map((violation) => violation.code);
  check(
    !smuggledMove
      && result.sceneRuntime?.agents?.[IDS.son]?.zoneId === "courtyard"
      && violationCodes.includes("VISIBLE_ACTION_DESTINATION_UNCOMMITTED"),
    "visibleAction 声称跨区移动时必须有匹配的 moveToZoneId，否则公开动作必须拒绝且位置不变",
    JSON.stringify({
      smuggledMove,
      runtimeZoneId: result.sceneRuntime?.agents?.[IDS.son]?.zoneId,
      violationCodes,
    }),
  );
}

async function caseLegalMoveCommitsOnePositionEverywhere() {
  const state = baseState();
  const result = await runProbe(state, {
    actorId: IDS.son,
    characterIds: [IDS.son],
    positions: { [IDS.son]: "courtyard" },
    slotId: "phase59:legal-move",
    proposedDecision: decision({
      actionType: "move",
      visibleAction: "谢真石从后院起身，朝堂前走去。",
      moveToZoneId: "hall",
    }),
  });
  const patch = (result.characterPatches || []).find((row) => row.id === IDS.son) || null;
  const next = structuredClone(state);
  next.tavernState = {
    ...(result.tavernState || next.tavernState || {}),
    sceneRuntime: structuredClone(result.sceneRuntime || {}),
  };
  if (patch) {
    const character = next.characters.find((row) => row.id === IDS.son);
    character.ecologyState = structuredClone(patch.ecologyState || character.ecologyState || null);
    character.lifeState = { ...(character.lifeState || {}), ...(patch.lifeState || {}) };
  }
  const nextSlot = TAVERN_CAUSAL_DAY_SLOTS.find((slot) => slot.id === "dusk");
  const prepared = prepareTavernCausalSlot(next, { day: 3, slot: nextSlot });
  const runtimeZoneId = result.sceneRuntime?.agents?.[IDS.son]?.zoneId || "";
  const ecologyZoneId = patch?.ecologyState?.presence?.zoneId || "";
  const nextSlotZoneId = prepared.positions?.[IDS.son] || "";
  check(
    runtimeZoneId === "hall" && ecologyZoneId === "hall" && nextSlotZoneId === "hall",
    "合法移动必须以同一次原子提交同步 sceneRuntime、人物 ecology presence 和下一时段位置",
    JSON.stringify({ runtimeZoneId, ecologyZoneId, nextSlotZoneId }),
  );
}

async function caseUnownedBowlCannotBePutDown() {
  const state = baseState();
  const bowlId = "phase59_unowned_rice_bowl";
  state.tavernState.objectLedger = {
    schemaVersion: 2,
    objects: {
      [bowlId]: {
        id: bowlId,
        label: "饭碗",
        aliases: ["碗筷"],
        holderActorId: IDS.mother,
        sceneId: "loc_xyy_tavern",
        zoneId: "hall",
        portable: true,
        custody: { storageMode: "in_hand", containerId: "", inHand: true },
        presentation: { exposure: "visible", displayedToActorIds: [], publiclyVisible: true },
      },
    },
  };
  const result = await runProbe(state, {
    actorId: IDS.son,
    characterIds: [IDS.son],
    positions: { [IDS.son]: "hall" },
    slotId: "phase59:unowned-bowl",
    proposedDecision: decision({
      actionType: "act",
      visibleAction: "谢真石放下手里的碗筷，朝灶边看了一眼。",
      actionAttempt: {
        primitive: "place",
        objectId: bowlId,
        targetCharacterId: "",
        destinationId: "",
        affordanceId: "",
      },
    }),
  });
  const impossibleObjectAction = (result.actions || []).find((action) => /放下.*碗筷|碗筷.*放下/.test(action.visibleAction || ""));
  const violationCodes = (result.decisions || []).flatMap((entry) => [
    ...(entry.decision?.actionAttemptFailures || []),
    ...(entry.decision?.semanticViolations || []),
  ]).map((violation) => violation.code);
  const worldFailureCodes = (result.actions || []).flatMap((action) => action.worldResolution?.failureCodes || []);
  check(
    !impossibleObjectAction && [...violationCodes, ...worldFailureCodes].includes("OBJECT_NOT_POSSESSED"),
    "人物尝试放下不属于自己的具体饭碗时，世界必须抑制成功结果并留下 OBJECT_NOT_POSSESSED 尝试审计",
    JSON.stringify({ impossibleObjectAction, violationCodes, worldFailureCodes }),
  );
}

const cases = [
  ["silent remote host", caseSilentRemoteHostIsNotPerceived],
  ["cross-zone acoustic speech", caseCrossZoneSpeechUsesAcousticPropagation],
  ["threshold-hall conversational space", caseThresholdAndHallShareConversationalSpace],
  ["uncommitted visible movement", caseVisibleMovementCannotBypassMoveCommit],
  ["legal movement position commit", caseLegalMoveCommitsOnePositionEverywhere],
  ["unowned bowl", caseUnownedBowlCannotBePutDown],
];

for (const [label, run] of cases) {
  try {
    await run();
  } catch (error) {
    failures.push({
      contract: `${label} fixture 必须能够运行到断言`,
      evidence: error?.stack || String(error),
    });
  }
}

if (failures.length) {
  console.error("tavernPhase59SpatialObjects: RED", {
    passed: passes.length,
    failed: failures.length,
  });
  for (const [index, failure] of failures.entries()) {
    console.error(`${index + 1}. ${failure.contract}`);
    if (failure.evidence) console.error(`   ${failure.evidence}`);
  }
  process.exitCode = 1;
} else {
  console.log("tavernPhase59SpatialObjects:test passed", { contracts: passes.length });
}
