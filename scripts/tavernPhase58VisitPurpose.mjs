import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  applyTavernCausalAffordance,
  listTavernCausalAffordances,
  prepareTavernCausalSlot,
  tavernCausalMaterialFacts,
  TAVERN_CAUSAL_DAY_SLOTS,
} from "../src/server/pipeline/tavernCausalEconomy.mjs";
import {
  buildTavernSceneRuntime,
  runTavernCausalScene,
} from "../src/server/pipeline/tavernCausalScene.mjs";

const IDS = {
  mother: "char_xyy_xiemu",
  father: "char_xyy_xieheng",
  yan: "char_xyy_yanzhizhong",
};

const failures = [];
const passes = [];

function check(condition, contract, evidence = "") {
  if (condition) passes.push(contract);
  else failures.push({ contract, evidence });
}

function visitIn(state) {
  return (state.tavernState?.activeVisits || []).find((visit) => visit.visitorId === IDS.yan) || null;
}

function runtimeFor(state, positions) {
  return buildTavernSceneRuntime(state, {
    characterIds: [IDS.mother, IDS.yan],
    positions,
    slotContext: { day: 2, slotId: "phase58:noon", slotLabel: "正午", slotBaseId: "noon" },
  });
}

function affordanceTypes(state, actorId, positions) {
  const runtime = runtimeFor(state, positions);
  const perceivedCharacterIds = Object.keys(runtime.agents || {}).filter((id) => id !== actorId);
  return listTavernCausalAffordances(state, runtime, actorId, perceivedCharacterIds).map((item) => item.type);
}

const base = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
base.ui.timeGrain = "day";
base.ui.engineMode = "openai";
const noon = TAVERN_CAUSAL_DAY_SLOTS.find((slot) => slot.id === "noon");
const noCausePrepared = prepareTavernCausalSlot(base, { day: 2, slot: noon });
check(
  !visitIn(noCausePrepared.state),
  "没有待核候选登记时，严执中的日程窗口不得凭空生成到访",
  JSON.stringify(noCausePrepared.arrivals || []),
);
const orphanVisitState = structuredClone(base);
orphanVisitState.tavernState.activeVisits = [{
  id: "phase58:orphan-yan-visit",
  visitorId: IDS.yan,
  visitorName: "严执中",
  kind: "business",
  purpose: "核对酒馆留下的候选留宿与接引登记",
  purposeStatus: "declared",
  stage: "waiting",
  businessObjectIds: [],
}];
orphanVisitState.tavernState.sceneRuntime = {
  agents: { [IDS.yan]: { characterId: IDS.yan, present: true, zoneId: "courtyard" } },
};
const orphanVisitPrepared = prepareTavernCausalSlot(orphanVisitState, { day: 2, slot: noon });
check(
  !visitIn(orphanVisitPrepared.state)
    && !orphanVisitPrepared.characterIds.includes(IDS.yan)
    && orphanVisitPrepared.state.characters.find((character) => character.id === IDS.yan)?.lifeState?.present === false,
  "没有真实候选登记对象的旧严执中 visit 必须中止，不能脱离事务原因永久在场",
  JSON.stringify({
    visit: visitIn(orphanVisitPrepared.state),
    characterIds: orphanVisitPrepared.characterIds,
    position: orphanVisitPrepared.positions[IDS.yan] || "",
  }),
);
const missingTierVisitorState = structuredClone(base);
const legacyYan = missingTierVisitorState.characters.find((character) => character.id === IDS.yan);
delete legacyYan.lifeProfile.simulationTier;
delete legacyYan.lifeProfile.tavernAgency.visitPolicy;
legacyYan.lifeProfile.agency = {
  standing: "registry_visitor",
  visitPolicy: { purposeKind: "business" },
};
legacyYan.lifeState.present = true;
missingTierVisitorState.tavernState.activeVisits = [];
const missingTierRuntime = buildTavernSceneRuntime(missingTierVisitorState, {
  characterIds: [IDS.mother, IDS.yan],
  positions: { [IDS.mother]: "hall", [IDS.yan]: "hall" },
});
check(
  !missingTierRuntime.agents[IDS.yan],
  "访客身份必须来自显式通用 agency 数据而非固定姓名；没有 activeVisit 就不能入场",
  JSON.stringify(Object.keys(missingTierRuntime.agents || {})),
);
base.tavernState.candidateNotices = [{
  id: "candidate_notice_phase58_luozhao",
  status: "pending",
  candidateId: "char_xyy_luozhao",
  candidateName: "洛照",
  sourceVisitId: "visit_phase58_luozhao",
  recordKind: "候选留宿与接引登记",
  reason: "洛照持玉衡宗拜帖在望梯酒馆留宿等接引",
  createdDay: 1,
  createdSlot: "黄昏",
}];

const prepared = prepareTavernCausalSlot(base, { day: 2, slot: noon });
const initialVisit = visitIn(prepared.state);

check(Boolean(initialVisit), "fixture: 严执中在第2日正午形成 business activeVisit");
if (!initialVisit) {
  console.error("tavernPhase58VisitPurpose: fixture failed; no Yan Zhizhong visit was created");
  process.exitCode = 1;
} else {
  const purpose = initialVisit.purpose;
  const hostIds = [IDS.father, IDS.mother];
  const initialRuntime = buildTavernSceneRuntime(prepared.state, {
    characterIds: prepared.characterIds,
    positions: prepared.positions,
    slotContext: prepared.slotContext,
  });

  // RED 1: a visit policy is private intent until the visitor actually states it.
  // Expected hosts may know that someone arrived, but not the exact policy string.
  const leakedHostFacts = hostIds.flatMap((hostId) => (
    tavernCausalMaterialFacts(prepared.state, initialRuntime, hostId)
      .filter((fact) => JSON.stringify(fact).includes(purpose))
      .map((fact) => ({ hostId, fact }))
  ));
  check(
    leakedHostFacts.length === 0,
    "来意未说明前，店家 materialFacts 不得包含完整 visit purpose",
    JSON.stringify(leakedHostFacts),
  );

  const passive = await runTavernCausalScene(prepared.state, {
    characterIds: prepared.characterIds,
    positions: prepared.positions,
    seedImpacts: prepared.seedImpacts,
    slotContext: prepared.slotContext,
    maxSteps: 1,
    minimumActivationScore: 999,
    async runAgent() {
      throw new Error("minimumActivationScore=999 时不应调用 Agent");
    },
  });
  const hostDeliveryIds = new Set((passive.deliveries || [])
    .filter((delivery) => hostIds.includes(delivery.recipientId))
    .map((delivery) => delivery.impactId));
  const leakedHostImpacts = (passive.impacts || []).filter((impact) => (
    hostDeliveryIds.has(impact.id) && JSON.stringify(impact).includes(purpose)
  ));
  check(
    leakedHostImpacts.length === 0,
    "来意未说明前，抵达店家的 impacts 不得泄漏完整 visit purpose",
    JSON.stringify(leakedHostImpacts.map((impact) => ({ id: impact.id, topic: impact.topic, content: impact.content }))),
  );

  // A hidden seed impact is not enough: the arrival must be marked as a public
  // event, emitted as an arrival action, or included in an explicit publicEvents ledger.
  const publicArrivalRows = [
    ...(passive.publicEvents || []),
    ...(passive.actions || []).filter((action) => action.actionType === "arrive"),
    ...(passive.impacts || []).filter((impact) => impact.publicEvent === true),
  ];
  const hasPublicArrival = publicArrivalRows.some((row) => (
    (row.actorId === IDS.yan || row.sourceCharacterId === IDS.yan || row.characterId === IDS.yan)
    && /严执中/.test(`${row.content || ""} ${row.visibleAction || ""} ${row.surfaceEvent || ""}`)
    && /推门|进门|进入|来到/.test(`${row.content || ""} ${row.visibleAction || ""} ${row.surfaceEvent || ""}`)
  ));
  check(
    hasPublicArrival,
    "严执中到场必须留下可进入正文的公开 arrival 事件证据",
    `publicEvents=${passive.publicEvents?.length || 0}, arrivalActions=${(passive.actions || []).filter((action) => action.actionType === "arrive").length}, publicImpacts=${(passive.impacts || []).filter((impact) => impact.publicEvent === true).length}`,
  );

  const ongoingState = structuredClone(prepared.state);
  const ongoingVisit = visitIn(ongoingState);
  Object.assign(ongoingVisit, {
    purposeStatus: "declared",
    purposeDisclosureStatus: "declared",
    declaredPurpose: ongoingVisit.purpose,
    purposeDeclaredByActionId: "phase58:prior-public-declaration",
    hostId: "",
    stage: "waiting",
  });
  const ongoing = await runTavernCausalScene(ongoingState, {
    characterIds: [IDS.mother, IDS.yan],
    positions: { [IDS.mother]: "hall", [IDS.yan]: "hall" },
    seedImpacts: [],
    slotContext: { day: 2, slotId: "phase58:ongoing-visit", slotLabel: "午后", slotBaseId: "afternoon" },
    maxSteps: 1,
    minimumActivationScore: 999,
    async runAgent() {
      throw new Error("minimumActivationScore=999 时不应调用 Agent");
    },
  });
  const ongoingContext = (ongoing.publicEvents || []).find((event) => (
    event.sourceCharacterId === IDS.yan && event.kind === "active_visit_context"
  ));
  check(
    Boolean(ongoingContext)
      && /严执中/.test(ongoingContext?.surfaceEvent || "")
      && /候选留宿与接引登记/.test(ongoingContext?.surfaceEvent || "")
      && /堂前/.test(ongoingContext?.surfaceEvent || ""),
    "跨场仍在办理的来访必须公开展示人物、地点和具体事务，不能只剩无因动作",
    JSON.stringify(ongoing.publicEvents || []),
  );

  // RED 2: receiving a declared visitor must be a visible interaction, not an
  // abstract state-changing sentence. Silence must not commit hostId.
  const receiveState = structuredClone(prepared.state);
  const receiveVisit = visitIn(receiveState);
  receiveVisit.purposeStatus = "declared";
  receiveVisit.declaredPurpose = receiveVisit.purpose;
  receiveVisit.hostId = "";
  receiveVisit.stage = "waiting";
  const receiveRuntime = runtimeFor(receiveState, { [IDS.mother]: "hall", [IDS.yan]: "hall" });
  const receive = listTavernCausalAffordances(receiveState, receiveRuntime, IDS.mother, [IDS.yan])
    .find((item) => item.type === "receive_guest");
  check(Boolean(receive), "fixture: 已说明来意且同区时掌柜获得 receive_guest affordance");
  if (receive) {
    check(
      !/能正面回应的位置|接下了这次来意/.test(receive.canonicalVisibleAction || ""),
      "receive_guest 的可见动作不得使用“接下了来意”一类抽象结果句",
      receive.canonicalVisibleAction,
    );
    const silentResult = applyTavernCausalAffordance(receiveState, receiveRuntime, {
      id: "phase58:silent-receive",
      actorId: IDS.mother,
      actorName: "谢母",
      actionType: "act",
      speechAct: "none",
      speech: "",
      visibleAction: receive.canonicalVisibleAction || "",
      slotLabel: "正午",
    }, receive);
    check(
      silentResult == null && !receiveVisit.hostId,
      "receive_guest 必须有对方可观察到的招呼；沉默动作不得写入 hostId",
      `result=${JSON.stringify(silentResult)}, hostId=${receiveVisit.hostId || "<empty>"}`,
    );
  }

  // RED 3: a business visitor needs explicit, stateful affordances for the
  // purpose handshake, public movement, and the actual business task.
  const undeclaredState = structuredClone(prepared.state);
  const undeclaredVisit = visitIn(undeclaredState);
  undeclaredVisit.purposeStatus = "undisclosed";
  undeclaredVisit.businessStatus = "pending";
  undeclaredVisit.hostId = "";
  undeclaredVisit.stage = "waiting";
  const undeclaredTypes = affordanceTypes(
    undeclaredState,
    IDS.yan,
    { [IDS.mother]: "hall", [IDS.yan]: "threshold" },
  );
  check(
    undeclaredTypes.includes("declare_visit_purpose"),
    "严执中在门槛必须获得 declare_visit_purpose affordance",
    `types=${undeclaredTypes.join(",") || "<none>"}`,
  );
  const undeclaredRuntime = runtimeFor(undeclaredState, { [IDS.mother]: "hall", [IDS.yan]: "threshold" });
  const declareAffordance = listTavernCausalAffordances(undeclaredState, undeclaredRuntime, IDS.yan, [IDS.mother])
    .find((item) => item.type === "declare_visit_purpose");
  const vacuousDeclaration = applyTavernCausalAffordance(undeclaredState, undeclaredRuntime, {
    id: "phase58:vacuous-purpose",
    actorId: IDS.yan,
    actorName: "严执中",
    actionType: "speak",
    speechAct: "inform",
    speech: "掌柜的，我进来了。",
    visibleAction: declareAffordance?.canonicalVisibleAction || "",
    moveToZoneId: declareAffordance?.moveToZoneId || "",
    slotLabel: "正午",
  }, declareAffordance || {});
  check(
    vacuousDeclaration == null && visitIn(undeclaredState)?.purposeStatus === "undisclosed",
    "只有寒暄或报到、不含具体目的的台词不得把来意改成 declared",
    `result=${JSON.stringify(vacuousDeclaration)}, purposeStatus=${visitIn(undeclaredState)?.purposeStatus}`,
  );

  // The same rule must survive the complete Agent -> normalization -> commit
  // path.  Otherwise a rejected line can still smuggle the canonical movement
  // into the public scene and make the visit appear to advance.
  const normalizedDeclarationState = structuredClone(prepared.state);
  const normalizedVisit = visitIn(normalizedDeclarationState);
  Object.assign(normalizedVisit, {
    purposeStatus: "undisclosed",
    declaredPurpose: "",
    businessStatus: "pending",
    hostId: "",
    stage: "waiting",
  });
  const normalizedDeclaration = await runTavernCausalScene(normalizedDeclarationState, {
    characterIds: [IDS.mother, IDS.yan],
    positions: { [IDS.mother]: "hall", [IDS.yan]: "threshold" },
    seedImpacts: [{
      id: "phase58:vacuous-purpose-probe",
      sourceCharacterId: "world:arrival",
      sourceZoneId: "threshold",
      type: "institution",
      modality: "sound",
      intensity: 100,
      radius: 0,
      directedTargetId: IDS.yan,
      content: "严执中刚跨进酒馆门槛，尚未向店家说明来意。",
      topic: "来访报到",
    }],
    slotContext: { day: 2, slotId: "phase58:vacuous-purpose", slotLabel: "正午", slotBaseId: "noon" },
    maxSteps: 1,
    minimumActivationScore: 0,
    async runAgent(input) {
      const selected = input.availableAffordances.find((item) => item.type === "declare_visit_purpose");
      return { decision: {
        actionType: selected?.actionType || "speak",
        speechAct: "inform",
        targetCharacterId: selected?.targetCharacterId || IDS.mother,
        speech: "掌柜的，我进来了。",
        visibleAction: "",
        moveToZoneId: selected?.moveToZoneId || "hall",
        affordanceId: selected?.id || "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        privateReason: "确定性探针：只报到，不说核对哪一项登记。",
      } };
    },
  });
  const leakedDeclarationAction = (normalizedDeclaration.actions || []).find((action) => (
    action.actorId === IDS.yan
    && (action.affordanceType === "declare_visit_purpose" || action.moveToZoneId === "hall")
  ));
  check(
    !leakedDeclarationAction && visitIn(normalizedDeclarationState)?.purposeStatus === "undisclosed",
    "空泛报到经过完整 Agent 链路后也不得提交说明来意动作或推进位置",
    JSON.stringify({
      action: leakedDeclarationAction || null,
      purposeStatus: visitIn(normalizedDeclarationState)?.purposeStatus,
      positions: normalizedDeclaration.positions || null,
    }),
  );

  const undeclaredFreeMoveState = structuredClone(prepared.state);
  const freeMoveVisit = visitIn(undeclaredFreeMoveState);
  Object.assign(freeMoveVisit, {
    purposeStatus: "undisclosed",
    declaredPurpose: "",
    hostId: "",
    stage: "waiting",
  });
  const undeclaredFreeMove = await runTavernCausalScene(undeclaredFreeMoveState, {
    characterIds: [IDS.mother, IDS.yan],
    positions: { [IDS.mother]: "hall", [IDS.yan]: "threshold" },
    seedImpacts: [{
      id: "phase58:undeclared-free-move",
      sourceCharacterId: "world:threshold",
      sourceZoneId: "threshold",
      type: "physical",
      modality: "memory",
      intensity: 100,
      radius: 0,
      directedTargetId: IDS.yan,
      content: "严执中刚到门槛，还没有向经手人说明来意。",
      topic: "尚未报明来意",
    }],
    slotContext: { day: 2, slotId: "phase58:undeclared-free-move", slotLabel: "正午", slotBaseId: "noon" },
    maxSteps: 1,
    minimumActivationScore: 0,
    async runAgent() {
      return { decision: {
        actionType: "move",
        speechAct: "none",
        targetCharacterId: "",
        speech: "",
        visibleAction: "严执中夹着名录越过门槛，直接走进堂前。",
        moveToZoneId: "hall",
        affordanceId: "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        privateReason: "确定性探针：不说明来意，试图用普通移动绕过 declare_visit_purpose。",
      } };
    },
  });
  check(
    !(undeclaredFreeMove.actions || []).some((action) => action.moveToZoneId === "hall")
      && visitIn(undeclaredFreeMoveState)?.purposeStatus === "undisclosed",
    "来意未公开的访客不得用普通 move 绕过 declare_visit_purpose 进入堂前",
    JSON.stringify(undeclaredFreeMove.actions || []),
  );

  const undeclaredMicroMoveState = structuredClone(undeclaredFreeMoveState);
  const undeclaredMicroMove = await runTavernCausalScene(undeclaredMicroMoveState, {
    characterIds: [IDS.mother, IDS.yan],
    positions: { [IDS.mother]: "hall", [IDS.yan]: "threshold" },
    seedImpacts: [{
      id: "phase58:undeclared-micro-move",
      sourceCharacterId: "world:threshold",
      sourceZoneId: "threshold",
      type: "physical",
      modality: "memory",
      intensity: 100,
      radius: 0,
      directedTargetId: IDS.yan,
      content: "严执中仍在门槛，尚未说明来意。",
      topic: "尚未报明来意",
    }],
    slotContext: { day: 2, slotId: "phase58:undeclared-micro-move", slotLabel: "正午", slotBaseId: "noon" },
    maxSteps: 1,
    minimumActivationScore: 0,
    async runAgent() {
      return { decision: {
        actionType: "act",
        speechAct: "none",
        targetCharacterId: IDS.mother,
        speech: "",
        visibleAction: "严执中向前走了两步，站定注视。",
        moveToZoneId: "",
        affordanceId: "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        privateReason: "确定性探针：把移动藏进 visibleAction，试图绕过说明来意。",
      } };
    },
  });
  check(
    !(undeclaredMicroMove.actions || []).some((action) => action.actorId === IDS.yan),
    "来意未公开时，把移动藏进 visibleAction 也不得提交‘向前两步、站定注视’",
    JSON.stringify(undeclaredMicroMove.actions || []),
  );

  const invalidStoredZoneState = structuredClone(prepared.state);
  const invalidStoredVisit = visitIn(invalidStoredZoneState);
  Object.assign(invalidStoredVisit, {
    purposeStatus: "undisclosed",
    purposeDisclosureStatus: "undisclosed",
    declaredPurpose: "",
    hostId: "",
    stage: "waiting",
  });
  invalidStoredZoneState.tavernState.sceneRuntime = {
    agents: { [IDS.yan]: { characterId: IDS.yan, present: true, zoneId: "courtyard" } },
  };
  const invalidStoredPrepared = prepareTavernCausalSlot(invalidStoredZoneState, { day: 2, slot: noon });
  check(
    invalidStoredPrepared.positions[IDS.yan] === "threshold",
    "恢复旧场景位置时，未说明来意的严执中必须回到门槛，后院位置不得复活",
    JSON.stringify(invalidStoredPrepared.positions),
  );
  const invalidStoredRuntime = buildTavernSceneRuntime(invalidStoredZoneState, {
    characterIds: [IDS.mother, IDS.yan],
    positions: { [IDS.mother]: "hall" },
  });
  check(
    invalidStoredRuntime.agents[IDS.yan]?.zoneId === "threshold",
    "单场模式直接恢复 sceneRuntime 时也必须校验访客区域；未说明来意的严执中不能从旧存档复活在后院",
    JSON.stringify(invalidStoredRuntime.agents[IDS.yan] || null),
  );

  const targetLockState = structuredClone(prepared.state);
  const targetLockVisit = visitIn(targetLockState);
  Object.assign(targetLockVisit, {
    purposeStatus: "undisclosed",
    declaredPurpose: "",
    businessStatus: "pending",
    hostId: "",
    stage: "waiting",
    expectedHostIds: [IDS.mother],
  });
  const targetLockResult = await runTavernCausalScene(targetLockState, {
    characterIds: [IDS.father, IDS.mother, IDS.yan],
    positions: { [IDS.father]: "hall", [IDS.mother]: "hall", [IDS.yan]: "threshold" },
    seedImpacts: [{
      id: "phase58:affordance-target-probe",
      sourceCharacterId: IDS.father,
      sourceZoneId: "hall",
      type: "institution",
      modality: "sound",
      intensity: 100,
      radius: 0,
      directedTargetId: IDS.yan,
      content: "谢恒正在堂前翻看账板。",
      topic: "经手人目标锁定",
    }],
    slotContext: { day: 2, slotId: "phase58:target-lock", slotLabel: "正午", slotBaseId: "noon" },
    maxSteps: 1,
    minimumActivationScore: 0,
    async runAgent(input) {
      const selected = input.availableAffordances.find((item) => item.type === "declare_visit_purpose");
      return { decision: {
        actionType: selected?.actionType || "speak",
        speechAct: "inform",
        targetCharacterId: IDS.father,
        speech: "我来核洛照的留宿与接引登记。",
        visibleAction: "",
        moveToZoneId: selected?.moveToZoneId || "hall",
        affordanceId: selected?.id || "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        privateReason: "确定性探针：模型把状态机动作错指给另一个在场人物。",
      } };
    },
  });
  const targetLockedAction = (targetLockResult.actions || []).find((action) => action.affordanceType === "declare_visit_purpose");
  const wrongTargetAction = (targetLockResult.actions || []).find((action) => (
    action.affordanceType === "declare_visit_purpose" && action.targetCharacterId !== IDS.mother
  ));
  check(
    !wrongTargetAction && (!targetLockedAction || targetLockedAction.targetCharacterId === IDS.mother),
    "选择 authoritative affordance 后，错误对象必须被拒绝或规范成唯一经手人",
    JSON.stringify({ action: targetLockedAction || null, decisions: targetLockResult.decisions || [] }),
  );

  const prematureServiceState = structuredClone(prepared.state);
  const prematureVisit = visitIn(prematureServiceState);
  Object.assign(prematureVisit, {
    kind: "lodging",
    purpose: "住一晚并要一碗热饭",
    requestedService: "lodging_meal",
    purposeStatus: "declared",
    declaredPurpose: "住一晚并要一碗热饭",
    serviceStatus: "pending",
    lodgingStatus: "pending",
    businessStatus: "not_required",
    paymentStatus: "unpaid",
    hostId: "",
    stage: "waiting",
    expectedHostIds: [IDS.mother],
  });
  const prematureService = await runTavernCausalScene(prematureServiceState, {
    characterIds: [IDS.mother, IDS.yan],
    positions: { [IDS.mother]: "hall", [IDS.yan]: "hall" },
    seedImpacts: [{
      id: "phase58:premature-service-probe",
      sourceCharacterId: IDS.yan,
      sourceZoneId: "hall",
      type: "social",
      modality: "sound",
      intensity: 100,
      radius: 0,
      directedTargetId: IDS.mother,
      content: "来客已经当面问了热饭和客房。",
      topic: "住店接待",
    }],
    slotContext: { day: 2, slotId: "phase58:premature-service", slotLabel: "黄昏", slotBaseId: "dusk" },
    maxSteps: 1,
    minimumActivationScore: 0,
    async runAgent(input) {
      const selected = input.availableAffordances.find((item) => item.type === "receive_guest");
      const selectedCandidate = input.privateActionCandidates.find((candidate) => candidate.realization?.affordanceId === selected?.id);
      return { decision: {
        candidateId: selectedCandidate?.candidateId || "",
        actionType: selected?.actionType || "speak",
        speechAct: "offer",
        targetCharacterId: IDS.yan,
        speech: "二楼靠东那间空着，床铺是干净的。你先上楼去，饭好了我给你端到屋里。",
        visibleAction: "",
        moveToZoneId: "",
        affordanceId: selected?.id || "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        privateReason: "确定性探针：只接待便抢跑尚未执行的房饭状态。",
      } };
    },
  });
  const prematureSpeechAction = (prematureService.actions || []).find((action) => (
    action.actorId === IDS.mother && /二楼靠东|饭好了.*端到屋里/.test(action.speech || "")
  ));
  const prematureResultVisit = visitIn(prematureService);
  const prematureClaimCodes = new Set(prematureSpeechAction?.claimAnnotations?.map((row) => row.code) || []);
  check(
    Boolean(prematureSpeechAction)
      && prematureResultVisit?.hostId === IDS.mother
      && prematureResultVisit?.lodgingStatus === "pending"
      && prematureResultVisit?.serviceStatus === "pending"
      && prematureClaimCodes.has("MATERIAL_LODGING_NOT_ASSIGNED")
      && prematureClaimCodes.has("MATERIAL_SERVICE_PROMISE_UNTRACKED"),
    "receive_guest 可以说出抢跑的房饭承诺，但只能提交接待，不能把客房或饭食说成已经交付",
    JSON.stringify({ action: prematureSpeechAction || null, visit: prematureResultVisit }),
  );

  const prematurePaymentState = structuredClone(prematureServiceState);
  const prematurePaymentVisit = visitIn(prematurePaymentState);
  Object.assign(prematurePaymentVisit, {
    hostId: IDS.mother,
    stage: "received",
    purposeStatus: "declared",
    serviceStatus: "pending",
    lodgingStatus: "pending",
    paymentStatus: "unpaid",
  });
  const prematurePayment = await runTavernCausalScene(prematurePaymentState, {
    characterIds: [IDS.mother, IDS.yan],
    positions: { [IDS.mother]: "hall", [IDS.yan]: "hall" },
    seedImpacts: [{
      id: "phase58:premature-payment-probe",
      sourceCharacterId: IDS.mother,
      sourceZoneId: "hall",
      type: "speech",
      modality: "sound",
      intensity: 100,
      radius: 0,
      directedTargetId: IDS.yan,
      content: "房饭合计五枚铜钱。",
      topic: "房饭报价",
    }],
    slotContext: { day: 2, slotId: "phase58:premature-payment", slotLabel: "黄昏", slotBaseId: "dusk" },
    maxSteps: 2,
    minimumActivationScore: 0,
    async runAgent(input) {
      if (input.agent.id !== IDS.yan) return { decision: {
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
        privateReason: "让真实付款人自己决定是否递钱。",
      } };
      return { decision: {
        actionType: "act",
        speechAct: "none",
        targetCharacterId: IDS.mother,
        speech: "",
        visibleAction: "严执中从钱袋里数出五枚铜钱，放在桌面上朝谢母推过去。",
        moveToZoneId: "",
        affordanceId: "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        privateReason: "确定性探针：付款 affordance 尚未开放，却用自由动作制造已交钱事实。",
      } };
    },
  });
  const unbackedCoinAction = (prematurePayment.actions || []).find((action) => /铜钱/.test(action.visibleAction || ""));
  check(
    !unbackedCoinAction && visitIn(prematurePaymentState)?.paymentStatus === "unpaid",
    "没有 pay_cash/settle_cash affordance 时，不得用自由动作制造递钱或桌上放钱事实",
    JSON.stringify(unbackedCoinAction || null),
  );

  const repeatedPaymentState = structuredClone(prematurePaymentState);
  const repeatedPaymentVisit = visitIn(repeatedPaymentState);
  Object.assign(repeatedPaymentVisit, {
    stage: "completed",
    serviceStatus: "served",
    lodgingStatus: "assigned",
    paymentStatus: "paid",
    hostId: IDS.mother,
  });
  const repeatedPayment = await runTavernCausalScene(repeatedPaymentState, {
    characterIds: [IDS.mother, IDS.yan],
    positions: { [IDS.mother]: "hall", [IDS.yan]: "hall" },
    seedImpacts: [{
      id: "phase58:repeated-payment-probe",
      sourceCharacterId: "world:cash-box",
      sourceZoneId: "hall",
      type: "resource",
      modality: "visual",
      intensity: 100,
      radius: 0,
      directedTargetId: IDS.mother,
      content: "五枚铜钱已经由付款动作点清入账。",
      topic: "已结清房饭钱",
    }],
    slotContext: { day: 2, slotId: "phase58:repeated-payment", slotLabel: "夜深", slotBaseId: "night" },
    maxSteps: 1,
    minimumActivationScore: 0,
    async runAgent() {
      return { decision: {
        actionType: "act",
        speechAct: "none",
        targetCharacterId: IDS.yan,
        speech: "",
        visibleAction: "谢母将洛照放在柜面上的五枚铜钱收进钱箱。",
        moveToZoneId: "",
        affordanceId: "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        privateReason: "确定性探针：付款已经入账后又重复收一次。",
      } };
    },
  });
  check(
    !(repeatedPayment.actions || []).some((action) => /收进钱箱/.test(action.visibleAction || "")),
    "paymentStatus=paid 后不得再次公开收钱或把同一笔铜钱收入钱箱",
    JSON.stringify(repeatedPayment.actions || []),
  );

  const actorSwapState = structuredClone(prematurePaymentState);
  const actorSwap = await runTavernCausalScene(actorSwapState, {
    characterIds: [IDS.mother, IDS.yan],
    positions: { [IDS.mother]: "hall", [IDS.yan]: "hall" },
    seedImpacts: [{
      id: "phase58:visible-actor-probe",
      sourceCharacterId: IDS.yan,
      sourceZoneId: "hall",
      type: "social",
      modality: "sound",
      intensity: 100,
      radius: 0,
      directedTargetId: IDS.mother,
      content: "严执中在堂前等候。",
      topic: "可见动作主体",
    }],
    slotContext: { day: 2, slotId: "phase58:visible-actor", slotLabel: "黄昏", slotBaseId: "dusk" },
    maxSteps: 1,
    minimumActivationScore: 0,
    async runAgent() {
      return { decision: {
        actionType: "act",
        speechAct: "none",
        targetCharacterId: IDS.yan,
        speech: "",
        visibleAction: "严执中从钱袋里数出五枚铜钱，放在桌面上。",
        moveToZoneId: "",
        affordanceId: "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        privateReason: "确定性探针：谢母 Agent 试图替严执中写身体动作。",
      } };
    },
  });
  check(
    !(actorSwap.actions || []).some((action) => /严执中从钱袋/.test(action.visibleAction || "")),
    "人物 Agent 不得用 visibleAction 替另一个在场人物实施身体动作",
    JSON.stringify(actorSwap.actions || []),
  );

  const repairState = structuredClone(prematureServiceState);
  const repairVisit = visitIn(repairState);
  Object.assign(repairVisit, {
    hostId: "",
    stage: "waiting",
    purposeStatus: "declared",
    serviceStatus: "pending",
    lodgingStatus: "pending",
    paymentStatus: "unpaid",
  });
  let repairCalls = 0;
  let repairFeedbackSeen = null;
  const repairedReception = await runTavernCausalScene(repairState, {
    characterIds: [IDS.mother, IDS.yan],
    positions: { [IDS.mother]: "hall", [IDS.yan]: "hall" },
    seedImpacts: [{
      id: "phase58:voice-repair-probe",
      sourceCharacterId: IDS.yan,
      sourceZoneId: "hall",
      type: "speech",
      modality: "sound",
      intensity: 100,
      radius: 0,
      directedTargetId: IDS.mother,
      content: "来客问热饭和客房的价钱。",
      topic: "住店接待",
    }],
    slotContext: { day: 2, slotId: "phase58:voice-repair", slotLabel: "黄昏", slotBaseId: "dusk" },
    maxSteps: 1,
    minimumActivationScore: 0,
    async runAgent(input) {
      repairCalls += 1;
      const selected = input.availableAffordances.find((item) => item.type === "receive_guest");
      const selectedCandidate = input.privateActionCandidates.find((candidate) => candidate.realization?.affordanceId === selected?.id);
      if (input.repairFeedback) repairFeedbackSeen = structuredClone(input.repairFeedback);
      return {
        stage: { name: `Phase58RepairProbe:${repairCalls}`, provider: "openai", model: "test-openai" },
        decision: {
          candidateId: selectedCandidate?.candidateId || "",
          actionType: selected?.actionType || "speak",
          speechAct: "inform",
          targetCharacterId: IDS.yan,
          speech: repairCalls === 1 ? "热饭两文，客房一夜五文，一并五文。" : "客房加一顿热饭，一共五枚铜钱。",
          visibleAction: "",
          moveToZoneId: "",
          affordanceId: selected?.id || "",
          informationSourceImpactId: "",
          commitmentAction: "none",
          commitmentTopic: "",
          privateReason: "第一次故意给出分项与合计矛盾的报价，第二次依据错误码重说统一总价。",
        },
      };
    },
  });
  const repairedVisit = (repairedReception.tavernState?.activeVisits || []).find((visit) => visit.visitorId === IDS.yan) || null;
  check(
    repairCalls === 1
      && repairFeedbackSeen === null
      && (repairedReception.actions || []).some((action) => (
        action.affordanceType === "receive_guest"
        && action.speech === "热饭两文，客房一夜五文，一并五文。"
        && (action.claimAnnotations || []).some((violation) => violation.code === "MATERIAL_PRICE_ARITHMETIC_CONTRADICTION")
      ))
      && repairedVisit?.hostId === IDS.mother
      && repairedVisit?.lodgingStatus === "pending"
      && repairedVisit?.serviceStatus === "pending"
      && repairedVisit?.paymentStatus === "unpaid",
    "矛盾报价应作为人物真实台词保留并标注，但不能触发强制重说或凭空结算住宿、饭食与账款",
    JSON.stringify({ repairCalls, repairFeedbackSeen, actions: repairedReception.actions || [] }),
  );

  const declaredThresholdState = structuredClone(undeclaredState);
  const declaredThresholdVisit = visitIn(declaredThresholdState);
  declaredThresholdVisit.purposeStatus = "declared";
  declaredThresholdVisit.declaredPurpose = declaredThresholdVisit.purpose;
  declaredThresholdVisit.hostId = IDS.mother;
  declaredThresholdVisit.stage = "received";
  const thresholdTypes = affordanceTypes(
    declaredThresholdState,
    IDS.yan,
    { [IDS.mother]: "hall", [IDS.yan]: "threshold" },
  );
  check(
    thresholdTypes.includes("move_to_hall"),
    "已说明来意的严执中必须通过 move_to_hall affordance 进入堂前",
    `types=${thresholdTypes.join(",") || "<none>"}`,
  );

  const hallBusinessState = structuredClone(declaredThresholdState);
  const hallBusinessVisit = visitIn(hallBusinessState);
  hallBusinessVisit.businessStatus = "pending";
  const hallTypes = affordanceTypes(
    hallBusinessState,
    IDS.yan,
    { [IDS.mother]: "hall", [IDS.yan]: "hall" },
  );
  check(
    hallTypes.includes("perform_visit_business"),
    "严执中到堂前后必须获得 perform_visit_business affordance",
    `types=${hallTypes.join(",") || "<none>"}`,
  );

  // RED 4: tea and payment cannot erase the actual business completion gate.
  const paidTeaState = structuredClone(hallBusinessState);
  const paidTeaVisit = visitIn(paidTeaState);
  Object.assign(paidTeaVisit, {
    stage: "received",
    serviceStatus: "served",
    paymentStatus: "paid",
    deliveryStatus: "not_required",
    lodgingStatus: "not_required",
    businessStatus: "pending",
    departureDue: true,
  });
  const paidTeaRuntime = runtimeFor(paidTeaState, { [IDS.mother]: "hall", [IDS.yan]: "hall" });
  const paidTeaAffordances = listTavernCausalAffordances(paidTeaState, paidTeaRuntime, IDS.yan, [IDS.mother]);
  check(
    paidTeaVisit.stage !== "completed",
    "businessStatus=pending 时，茶已送且钱已付也不得把 activeVisit 标记 completed",
    `stage=${paidTeaVisit.stage}, businessStatus=${paidTeaVisit.businessStatus}`,
  );
  check(
    !paidTeaAffordances.some((item) => item.type === "leave_visit"),
    "公务未完成时不得向严执中开放 leave_visit affordance",
    `types=${paidTeaAffordances.map((item) => item.type).join(",") || "<none>"}`,
  );

  // RED 5: route reachability alone must not grant a tea guest access to the
  // household courtyard. This is a controlled, model-free forced proposal.
  const movementState = structuredClone(undeclaredState);
  const movementResult = await runTavernCausalScene(movementState, {
    characterIds: [IDS.yan],
    positions: { [IDS.yan]: "threshold" },
    seedImpacts: [{
      id: "phase58:movement-probe",
      sourceCharacterId: "world:movement-probe",
      sourceZoneId: "threshold",
      type: "institution",
      modality: "sound",
      intensity: 96,
      radius: 0,
      directedTargetId: IDS.yan,
      content: "门内有人走动。",
      topic: "到场后的下一步",
    }],
    slotContext: { day: 2, slotId: "phase58:movement", slotLabel: "正午", slotBaseId: "noon" },
    maxSteps: 1,
    minimumActivationScore: 0,
    async runAgent() {
      return { decision: {
        actionType: "move",
        speechAct: "none",
        targetCharacterId: "",
        speech: "",
        visibleAction: "严执中从门槛径直走向谢家后院。",
        moveToZoneId: "courtyard",
        affordanceId: "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        privateReason: "确定性探针：强行提出无邀请的后院移动。",
      } };
    },
  });
  const courtyardMove = (movementResult.actions || []).find((action) => action.moveToZoneId === "courtyard");
  check(
    !courtyardMove,
    "严执中从门槛强提 courtyard 必须被区域权限规则拒绝",
    courtyardMove ? JSON.stringify({ visibleAction: courtyardMove.visibleAction, moveToZoneId: courtyardMove.moveToZoneId }) : "",
  );

  const terminalState = structuredClone(hallBusinessState);
  const terminalVisit = visitIn(terminalState);
  Object.assign(terminalVisit, {
    stage: "completed",
    purposeStatus: "declared",
    purposeDisclosureStatus: "declared",
    purposeDeclaredByActionId: "phase58:terminal-purpose",
    businessStatus: "done",
    serviceStatus: "served",
    serviceConsumptionStatus: "consumed",
    paymentStatus: "paid",
    deliveryStatus: "not_required",
    lodgingStatus: "not_required",
    departureDue: false,
  });
  for (const objective of terminalVisit.objectiveGraph?.objectives || []) {
    if (objective.required !== false) objective.status = "completed";
  }
  terminalVisit.objectives = structuredClone(terminalVisit.objectiveGraph?.objectives || []);
  const terminalStayed = await runTavernCausalScene(terminalState, {
    characterIds: [IDS.mother, IDS.yan],
    positions: { [IDS.mother]: "hall", [IDS.yan]: "hall" },
    maxSteps: 1,
    minimumActivationScore: 0,
    async runAgent(input) {
      const selectedCandidate = input.privateActionCandidates.find((candidate) => (
        candidate.feasible && !candidate.realization?.affordanceId
      ));
      return { decision: {
        candidateId: selectedCandidate?.candidateId || "",
        actionType: "act",
        speechAct: "none",
        targetCharacterId: selectedCandidate?.targetCharacterId || "",
        speech: "",
        visibleAction: "严执中在堂前又站定看了一阵。",
        moveToZoneId: "",
        affordanceId: "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        privateReason: "交易办完不等于人物必须立刻离开；本人选择再观察片刻。",
      } };
    },
  });
  check(
    (terminalStayed.actions || []).some((action) => action.actorId === IDS.yan && action.affordanceType !== "leave_visit")
      && (terminalStayed.publicEvents || []).some((event) => event.sourceCharacterId === IDS.yan && /交割和账目已经办清.*仍留在/.test(event.surfaceEvent || "")),
    "来访交易完成后，世界只能公开交易事实；人物仍可自行选择观察而不是被强制离店",
    JSON.stringify({ actions: terminalStayed.actions || [], publicEvents: terminalStayed.publicEvents || [] }),
  );

  const terminalLeaveState = structuredClone(terminalState);
  const terminalLeave = await runTavernCausalScene(terminalLeaveState, {
    characterIds: [IDS.mother, IDS.yan],
    positions: { [IDS.mother]: "hall", [IDS.yan]: "hall" },
    maxSteps: 1,
    minimumActivationScore: 0,
    async runAgent(input) {
      const selected = input.availableAffordances.find((item) => item.type === "leave_visit");
      const selectedCandidate = input.privateActionCandidates.find((candidate) => candidate.realization?.affordanceId === selected?.id);
      return { decision: selected ? {
        candidateId: selectedCandidate?.candidateId || "",
        actionType: selected.actionType,
        speechAct: "none",
        targetCharacterId: "",
        speech: "",
        visibleAction: "",
        moveToZoneId: "",
        affordanceId: selected.id,
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        privateReason: "名录、茶钱和公务都已办完，收好纸页离店。",
      } : { candidateId: "", actionType: "pass", speechAct: "none", targetCharacterId: "", speech: "", visibleAction: "", moveToZoneId: "", affordanceId: "", informationSourceImpactId: "", commitmentAction: "none", commitmentTopic: "", privateReason: "没有离店动作。" } };
    },
  });
  check(
    (terminalLeave.actions || []).some((action) => action.actorId === IDS.yan && action.affordanceType === "leave_visit")
      && !(terminalLeave.tavernState.activeVisits || []).some((visit) => visit.visitorId === IDS.yan),
    "事务完成的严执中必须能够用 leave_visit 真正离场并移出 activeVisits",
    JSON.stringify({ actions: terminalLeave.actions || [], activeVisits: terminalLeave.tavernState.activeVisits || [] }),
  );
}

if (failures.length) {
  console.error(`tavernPhase58VisitPurpose: RED (${failures.length} contracts currently violated)`);
  failures.forEach((failure, index) => {
    console.error(`${index + 1}. ${failure.contract}`);
    if (failure.evidence) console.error(`   evidence: ${failure.evidence}`);
  });
  console.error(`Passing fixture/contracts: ${passes.length}`);
  process.exitCode = 1;
} else {
  console.log(`tavernPhase58VisitPurpose:test passed (${passes.length} contracts)`);
}
