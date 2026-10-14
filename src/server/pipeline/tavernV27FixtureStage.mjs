/**
 * Deterministic four-stage atomic fixture for the local v2.7 plumbing demo.
 *
 * This is deliberately not a character-quality oracle. It exercises the same
 * four-stage atomic protocol, Actor mailbox, world settlement and sensory feedback
 * without sending project data to an external model.
 */

export const TAVERN_V27_FIXTURE_STAGE_VERSION = "tavern-v27-four-stage-atomic-local-fixture-v1";

const XIE_ZHENSHI = "char_xyy_xiezenshi";
const LUO_ZHAO = "char_xyy_luozhao";

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function planFor(stageInput = {}) {
  const evidence = stageInput.worldProjection?.evidence || [];
  const content = evidence.map((row) => clean(row.content)).join(" ");
  const recentSpeech = (stageInput.worldProjection?.discourseContext?.recentPublicTurns || [])
    .map((row) => clean(row.utterance))
    .join(" ");
  const affordances = stageInput.worldProjection?.affordances || [];
  const ownedWorldProcesses = stageInput.worldProjection?.ownedWorldProcesses || [];
  const zoneId = clean(stageInput.worldProjection?.scene?.zoneId || "hall");
  const perceivedObjects = stageInput.worldProjection?.perceivedObjects || [];
  const holdsTeapot = perceivedObjects.some((row) => (
    clean(row.id) === "tavern_vessel_teapot_1"
    && clean(row.holderEntityHandle) === clean(stageInput.characterId)
  ));
  const perceivedIds = (stageInput.worldProjection?.perceivedCharacters || []).map((row) => row.id);
  const otherId = perceivedIds.find((id) => id !== stageInput.characterId)
    || (stageInput.characterId === XIE_ZHENSHI ? LUO_ZHAO : XIE_ZHENSHI);

  if (stageInput.characterId === XIE_ZHENSHI) {
    const finishAffordance = affordances.find((row) => (
      row.operation === "finish_service_preparation" && row.currentlyExecutable === true
    ));
    if (finishAffordance) return {
      intention: "亲手把已经到火候的茶收好",
      primitive: "use_affordance",
      affordanceId: clean(finishAffordance.id),
      utterance: "",
      visibleAction: "谢真石揭开壶盖看过茶色，把茶壶从火边提开。",
      texture: [{ channel: "objectHandling", modality: "visual", feature: "先看茶色再离火，动作没有停顿" }],
      privateBasis: "茶已经到了火候，他决定把答应客人的事做完。",
      continueAfterSettlement: true,
      nextPrimitive: "move",
    };

    const serveAffordance = affordances.find((row) => (
      row.operation === "serve_prepared_service" && row.currentlyExecutable === true
    ));
    if (serveAffordance) return {
      intention: "把已经沏好的茶真正送到客人手边",
      primitive: "use_affordance",
      affordanceId: clean(serveAffordance.id),
      targetId: otherId,
      utterance: "茶好了。",
      visibleAction: "谢真石把茶壶稳稳放到客人手边。",
      texture: [{ channel: "objectHandling", modality: "visual", feature: "壶底落桌很轻，没有溅出茶水" }],
      privateBasis: "这项服务只有实际交到客人手边才算完成。",
    };

    const completedProcess = ownedWorldProcesses.find((row) => (
      row.status === "completed" && row.serviceStatus !== "served"
    ));
    if (completedProcess && zoneId === "stove") return {
      intention: "端着沏好的茶先回到柜台后",
      primitive: "move",
      destinationId: "counter",
      utterance: "",
      visibleAction: "谢真石提稳茶壶，从灶边往柜台后走。",
      texture: [{ channel: "objectHandling", modality: "visual", feature: "手腕托稳壶身，步子没有晃" }],
      privateBasis: "茶已经沏好，还没有送到客人面前。",
      continueAfterSettlement: true,
      nextPrimitive: "move",
    };
    if (completedProcess && zoneId === "counter") return {
      intention: "把沏好的茶端回堂前",
      primitive: "move",
      destinationId: "hall",
      utterance: "",
      visibleAction: "谢真石端着茶壶绕出柜台，回到堂前。",
      texture: [{ channel: "posture", modality: "visual", feature: "一只手托着壶底，避开桌角" }],
      privateBasis: "客人在堂前，茶还没有交付。",
      continueAfterSettlement: true,
      nextPrimitive: "use_affordance",
    };

    const startAffordance = affordances.find((row) => (
      row.operation === "start_service_preparation"
      && row.offeringId === "fine_cloud_tea_pot"
      && row.currentlyExecutable === true
    )) || affordances.find((row) => (
      row.operation === "start_service_preparation" && row.currentlyExecutable === true
    ));
    if (holdsTeapot && !ownedWorldProcesses.length && zoneId === "stove" && startAffordance) return {
      intention: "用手里的壶开始沏客人点的茶",
      primitive: "use_affordance",
      affordanceId: clean(startAffordance.id),
      utterance: "",
      visibleAction: "谢真石取了茶叶入壶，提起灶上的水。",
      texture: [{ channel: "objectHandling", modality: "visual", feature: "投茶和注水一气呵成" }],
      privateBasis: "器皿、灶火和茶叶都已经到手，现在才真正开始沏茶。",
    };
    if (holdsTeapot && !ownedWorldProcesses.length && zoneId === "hall") return {
      intention: "拿着茶壶绕到柜台后",
      primitive: "move",
      destinationId: "counter",
      utterance: "",
      visibleAction: "谢真石提着茶壶绕到柜台后。",
      texture: [{ channel: "pace", modality: "sound", feature: "脚步没有拖延" }],
      privateBasis: "茶壶已经拿到，灶边才是能沏茶的地方。",
      continueAfterSettlement: true,
      nextPrimitive: "move",
    };
    if (holdsTeapot && !ownedWorldProcesses.length && zoneId === "counter") return {
      intention: "从柜台后转到灶边",
      primitive: "move",
      destinationId: "stove",
      utterance: "",
      visibleAction: "谢真石提着茶壶从柜台后转到灶边。",
      texture: [{ channel: "objectHandling", modality: "visual", feature: "茶壶一直提在手里，没有随处搁下" }],
      privateBasis: "还差到灶边这一步，到了才能动火沏茶。",
      continueAfterSettlement: true,
      nextPrimitive: "use_affordance",
    };
    const activeProcess = ownedWorldProcesses.find((row) => row.status === "active");
    if (activeProcess) return {
      intention: "让壶里的茶继续走火候，手边暂不另起一步",
      primitive: "none",
      utterance: "",
      visibleAction: "",
      texture: [],
      privateBasis: "茶已经在沏，火候没到之前不需要反复动它。",
    };
  }

  if (stageInput.characterId === XIE_ZHENSHI
    && !ownedWorldProcesses.length
    && /来壶好茶/u.test(`${content} ${recentSpeech}`)) {
    return {
      intention: "先把客人点的茶壶取出来",
      primitive: "take_out",
      objectId: "tavern_vessel_teapot_1",
      targetId: otherId,
      utterance: "",
      visibleAction: "谢真石转身从柜后取下一只茶壶。",
      texture: [{ channel: "posture", modality: "visual", feature: "动作熟练，没有停下来另作解释" }],
      privateBasis: "这是已经听清的点单，先做眼前这一步。",
      continueAfterSettlement: true,
      nextPrimitive: "move",
    };
  }

  if (stageInput.characterId === LUO_ZHAO && /要些什么/u.test(content)) {
    return {
      intention: "把自己要的茶说清",
      primitive: "speak",
      targetId: otherId,
      utterance: "来壶好茶。",
      visibleAction: "",
      texture: [],
      privateBasis: "先完成眼前交易，再继续观察这里的人。",
    };
  }

  if (stageInput.characterId === LUO_ZHAO && evidence.some((row) => (
    clean(row.eventKind || row.actionKind) === "observation_result"
  ))) {
    return {
      intention: "暂时保持观察，不制造新的公开动作",
      primitive: "none",
      targetId: otherId,
      utterance: "",
      visibleAction: "",
      texture: [],
      privateBasis: "眼前证据还不够，她先不把判断说出口。",
    };
  }

  if (stageInput.characterId === LUO_ZHAO && evidence.some(row => clean(row.eventKind || row.actionKind || row.type) === "object_handling")) {
    return {
      intention: "继续看清眼前这个人的动作",
      primitive: "observe",
      targetId: otherId,
      utterance: "",
      visibleAction: "洛照的目光在谢真石的手腕与落脚处停了一瞬。",
      texture: [{ channel: "gaze", modality: "visual", feature: "视线集中在手腕与落脚处" }],
      privateBasis: "她先取自己真正关心的动作证据，不急着解释来意。",
    };
  }

  if (stageInput.characterId === LUO_ZHAO && (evidence.some(row => ["prepared_service_served", "service_preparation_started", "service_preparation_finished"].includes(clean(row.eventKind || row.actionKind || row.type)))
    || /柜台|灶边|准备|茶色|茶壶|茶叶|注水|入壶/u.test(content))) {
    return {
      intention: "让店里把已经开始的事做完，自己继续留意",
      primitive: "none",
      targetId: otherId,
      utterance: "",
      visibleAction: "",
      texture: [{ channel: "gaze", modality: "visual", feature: "目光随着茶壶移动片刻，又落回堂前" }],
      privateBasis: "对方正在做她刚点的茶，没有新的问题需要她立刻插话。",
    };
  }

  return {
    intention: stageInput.characterId === XIE_ZHENSHI ? "先问清客人眼下要什么" : "回应眼前的人",
    primitive: "speak",
    targetId: otherId,
    utterance: stageInput.characterId === XIE_ZHENSHI ? "客官，要些什么？" : "嗯。",
    visibleAction: "",
    texture: [],
    privateBasis: "眼前出现了需要本人回应的具体人和事。",
  };
}

function conversationAnchorSelectionForPlan(stageInput = {}, plan = {}, speaking = false) {
  const requestedDisposition = clean(plan.postTurnDisposition);
  const postTurnDisposition = speaking
    ? (["keep_resumable", "close_for_self"].includes(requestedDisposition)
      ? requestedDisposition
      : "keep_resumable")
    : "no_thread";
  const none = {
    anchorHandle: "",
    mode: "none",
    targetParticipantHandle: "",
    postTurnDisposition,
  };
  const requestedMode = clean(plan.conversationMode);
  const targetParticipantHandle = clean(plan.conversationTargetHandle || plan.targetId);
  if (!speaking || requestedMode === "none" || !targetParticipantHandle) return none;
  const anchors = stageInput.expressionMoment?.conversationAnchors?.anchors || [];
  const requestedHandle = clean(plan.conversationAnchorHandle);
  const compatible = anchors.filter((row) => (
    (row.participantHandles || []).map(clean).includes(targetParticipantHandle)
  ));
  const supportsMode = (row, mode) => {
    if (!(row?.allowedModes || []).map(clean).includes(mode)) return false;
    if (mode !== "reply") return true;
    const parent = (row.recentTurns || []).at(-1) || {};
    return clean(parent.direction) === "incoming"
      && clean(parent.speakerHandle) === targetParticipantHandle;
  };
  const selected = requestedHandle
    ? compatible.find((row) => clean(row.anchorHandle) === requestedHandle)
    : compatible.find((row) => requestedMode && supportsMode(row, requestedMode))
      || compatible.find((row) => supportsMode(row, "reply"))
      || compatible.find((row) => supportsMode(row, "continue"));
  if (!selected) return none;
  const allowedModes = (selected.allowedModes || []).map(clean);
  const mode = requestedMode && supportsMode(selected, requestedMode)
    ? requestedMode
    : supportsMode(selected, "reply")
      ? "reply"
      : allowedModes.includes("continue")
        ? "continue"
        : "none";
  return mode === "none" ? none : {
    anchorHandle: clean(selected.anchorHandle),
    mode,
    targetParticipantHandle,
    postTurnDisposition,
  };
}

function privateDayPlanFor(stageInput = {}) {
  const sourceId = (stageInput.referenceContract?.ownedSourceIds || []).map(clean).find(Boolean);
  if (!sourceId) {
    const error = new Error("The local day-planning fixture requires one Character-owned source.");
    error.code = "TAVERN_V27_FIXTURE_DAY_PLAN_SOURCE_REQUIRED";
    throw error;
  }
  const zoneHandles = (stageInput.referenceContract?.allowedZoneHandles || []).map(clean).filter(Boolean);
  const nearTerm = stageInput.horizon?.granularity === "near_term_blocks";
  const starts = nearTerm ? [0, 300, 600, 900] : [0, 14_400, 28_800, 43_200, 57_600, 79_200];
  const ends = nearTerm ? [240, 540, 840, 1140] : [10_800, 25_200, 39_600, 54_000, 68_400, 86_400];
  const activities = stageInput.characterId === XIE_ZHENSHI
    ? ["prepare", "serve", "rest", "maintain", "practice", "social_time"]
    : ["observe", "travel", "rest", "practice", "maintain", "social_time"];
  return {
    ownerAuthority: "character-agent",
    planBlocks: starts.map((relativeStartSeconds, index) => ({
      relativeStartSeconds,
      relativeEndSeconds: ends[index],
      activityType: activities[index],
      desiredZoneHandle: zoneHandles[index % Math.max(1, zoneHandles.length)] || "",
      privatePurpose: `由本人根据当前生活依据，为接下来一天的第 ${index + 1} 个粗时段保留重新判断的安排。`,
      sourceIds: [sourceId],
    })),
  };
}

export function createTavernV27FixtureStageRunner({ planForTurn = planFor } = {}) {
  if (typeof planForTurn !== "function") {
    throw new TypeError("createTavernV27FixtureStageRunner requires planForTurn to be a function.");
  }
  const plans = new Map();

  return async function runFixtureStage(stageInput, { stage } = {}) {
    if (stage === "subjective_appraisal_and_candidates") {
      const appraisal = await runFixtureStage(stageInput, { stage: "subjective_appraisal" });
      const candidates = await runFixtureStage(stageInput, { stage: "agent_candidates" });
      return { appraisalAndCandidates: { appraisal: appraisal.appraisal, candidates: candidates.candidates },
        stage: { name: `TavernV27Fixture:${stageInput.characterId}:subjective_appraisal_and_candidates`, provider: "local-fixture", elapsedMs: 0 } };
    }
    if (stage === "character_day_planning") return {
      dayPlan: privateDayPlanFor(stageInput),
      stage: {
        name: `TavernV27Fixture:character_day_planning:${stageInput.characterId}`,
        provider: "local-fixture",
        elapsedMs: 0,
      },
    };
    if (stage === "character_reflection") return {
      reflection: {
        ownerAuthority: "character-agent",
        insights: [],
      },
      stage: {
        name: `TavernV27Fixture:character_reflection:${stageInput.characterId}`,
        provider: "local-fixture",
        elapsedMs: 0,
      },
    };
    const plan = plans.get(stageInput.agentTurnId) || planForTurn(stageInput);
    plans.set(stageInput.agentTurnId, plan);
    const evidenceIds = (stageInput.worldProjection?.evidence || []).map((row) => row.evidenceId).filter(Boolean);
    const perceivedTargetHandles = new Set((stageInput.referenceContract?.perceivedTargetHandles || [])
      .map((value) => clean(value))
      .filter(Boolean));
    const unresolvedEpistemicStatuses = new Set(["unknown", "provisional", "suspended"]);
    const carriedEpistemicPositions = (stageInput.privateContext?.state?.priorRegulationCarryover?.epistemicPositions || [])
      .filter((position) => (
        unresolvedEpistemicStatuses.has(clean(position?.status))
        && perceivedTargetHandles.has(clean(position?.subjectHandle))
      ))
      .map((position) => ({
        ...clone(position),
        basisEvidenceIds: [],
        basisPsychologicalSourceIds: clone(position?.basisPsychologicalSourceIds || []),
        privateReason: clean(position?.privateReason)
          || "保留上一轮仍未解决的工作认识；本轮没有足够新证据改变它。",
      }));
    const candidateId = `fixture-candidate:${stageInput.agentTurnId}`;
    const impulseId = `fixture-impulse:${stageInput.agentTurnId}`;
    const speaking = Boolean(clean(plan.utterance));
    const speechAct = speaking
      ? clean(plan.speechAct || (/[？?]\s*$/u.test(clean(plan.utterance)) ? "ask" : "inform"))
      : "none";
    const speechFunctions = speaking
      ? [...new Set((plan.speechFunctions?.length ? plan.speechFunctions : [speechAct]).map(clean).filter(Boolean))]
      : [];
    const acting = clean(plan.primitive) !== "none";
    const separateAction = !["none", "speak"].includes(clean(plan.primitive));
    const hasNonverbalDelta = separateAction || Boolean(plan.bodyActions?.length);

    if (stage === "subjective_appraisal") return {
      appraisal: {
        ownerAuthority: "character-agent",
        appraisalId: `fixture-appraisal:${stageInput.agentTurnId}`,
        agentTurnId: stageInput.agentTurnId,
        eventId: clean(evidenceIds[0] || `fixture-wake:${stageInput.agentTurnId}`),
        noticedEvidenceIds: clone(evidenceIds),
        interpretations: evidenceIds.length ? [{
          evidenceIds: clone(evidenceIds),
          meaning: "眼前出现了本人可以直接回应的公开事实",
          confidence: 0.9,
        }] : [],
        beliefOperations: [],
        epistemicPositions: carriedEpistemicPositions,
        relevanceLinks: [],
        desireGroundings: [],
        appraisalAxes: {
          selfRelevance: 0.72,
          goalCongruence: 0.36,
          novelty: 0.08,
          expectedness: 0.42,
          opportunityValue: 0.32,
          threat: 0.04,
          controllability: 0.9,
          changeability: 0.82,
          certaintyDelta: 0.18,
          normCompatibility: 0.76,
          selfImageCongruence: 0.72,
          publicExposure: 0.28,
          relationshipMeaning: {
            affiliation: 0.08,
            status: 0,
            trust: 0.04,
            rejection: 0,
            care: 0,
            betrayal: 0,
          },
        },
        uncertainty: evidenceIds.length ? 0.08 : 0.18,
        alternativesConsidered: ["继续原事", "回应眼前事实"],
        entityModelUpdates: [],
        locationBeliefUpdates: [],
        sourceKnowledgeBeliefUpdates: [],
        threadAppraisals: [],
        relationshipAppraisal: {
          phase: "pending_perception_appraisal",
          targetCharacterId: "",
          sourceImpactIds: [],
          changeMode: "none",
          dimensionChanges: [],
          reason: "",
        },
        priorActionOutcomeAppraisal: {
          ownerAuthority: "character-agent",
          sourceAgentTurnId: clean(stageInput.privateContext?.priorActionOutcomeContext?.pendingSourceAgentTurnId),
          status: stageInput.privateContext?.priorActionOutcomeContext?.hasPendingAgentAction ? "unclear" : "no_prior_action",
          noticedOutcomeEvidenceIds: [],
          perceivedInformationGain: 0,
          perceivedGoalProgress: 0,
          perceivedCost: 0,
          unexpectedness: 0,
          stillUnresolved: Boolean(stageInput.privateContext?.priorActionOutcomeContext?.hasPendingAgentAction),
          summary: stageInput.privateContext?.priorActionOutcomeContext?.hasPendingAgentAction
            ? "上一动作的主观结果还没有足够证据确认。"
            : "",
        },
      },
      stage: { name: `TavernV27Fixture:appraisal:${stageInput.characterId}`, provider: "local-fixture", elapsedMs: 0 },
    };

    const actionBinding = clean(plan.affordanceId)
      ? { kind: "affordance", targetCharacterId: "", objectId: "", destinationId: "", positionId: "", affordanceId: clean(plan.affordanceId) }
      : clean(plan.objectId)
      ? { kind: "object", targetCharacterId: "", objectId: clean(plan.objectId), destinationId: "", positionId: "", affordanceId: "" }
      : clean(plan.destinationId)
        ? { kind: "place", targetCharacterId: "", objectId: "", destinationId: clean(plan.destinationId), positionId: "", affordanceId: "" }
        : acting && clean(plan.targetId) && plan.primitive !== "speak"
          ? { kind: "character", targetCharacterId: clean(plan.targetId), objectId: "", destinationId: "", positionId: "", affordanceId: "" }
          : { kind: "none", targetCharacterId: "", objectId: "", destinationId: "", positionId: "", affordanceId: "" };
    const actionFeasibilities = stageInput.worldProjection?.actionFeasibilities || [];
    const objectFeasibility = actionFeasibilities.find((row) => clean(row?.targetHandle) === clean(plan.objectId)) || null;
    const placeFeasibility = clean(plan.destinationId)
      ? actionFeasibilities.find((row) => (
        clean(row?.bindingKind) === "place"
        && clean(row?.targetHandle) === clean(plan.destinationId)
      )) || null
      : null;
    const prerequisiteFeasibility = !objectFeasibility && !placeFeasibility && clean(plan.destinationId)
      ? actionFeasibilities.find((row) => (row.knownPrerequisiteOptions || []).some((option) => (
        clean(option?.primitive) === clean(plan.primitive)
        && clean(option?.destinationId) === clean(plan.destinationId)
      ))) || null
      : null;
    const lacksSocialPermission = (socialAccess = {}) => (
      socialAccess?.permissionRequiredByNorm === true
      && socialAccess?.permissionCurrentlyGranted === false
    );
    const feasibilityHandling = objectFeasibility
      ? {
        surfaceId: clean(objectFeasibility.feasibilityId),
        relationToGoal: "direct_attempt",
        stance: objectFeasibility.directManipulation?.currentlyAttemptable === false ? "deliberate_attempt" : "follow",
        privateReason: objectFeasibility.directManipulation?.currentlyAttemptable === false
          ? "本人知道当前前提尚未满足，但这个确定性夹具只保留原计划供世界验证。"
          : "当前感知条件支持直接尝试，仍由世界按提交瞬间状态复核。",
      }
      : placeFeasibility
        ? {
          surfaceId: clean(placeFeasibility.feasibilityId),
          relationToGoal: "direct_attempt",
          stance: lacksSocialPermission(placeFeasibility.socialAccess)
            || placeFeasibility.directAttempt?.currentlyAttemptable === false
            ? "deliberate_attempt"
            : "follow",
          privateReason: lacksSocialPermission(placeFeasibility.socialAccess)
            ? "这个确定性夹具保留原计划，并明确让世界结算尚未获准的社会边界后果。"
            : "当前路线表面支持这一原子移动，仍由世界按提交瞬间状态复核。",
        }
      : prerequisiteFeasibility
        ? {
          surfaceId: clean(prerequisiteFeasibility.feasibilityId),
          relationToGoal: "prerequisite_step",
          stance: lacksSocialPermission((prerequisiteFeasibility.knownPrerequisiteOptions || []).find((option) => (
            clean(option?.primitive) === clean(plan.primitive)
            && clean(option?.destinationId) === clean(plan.destinationId)
          ))?.socialAccess) ? "deliberate_attempt" : "follow",
          privateReason: "当前动作只满足本人目标所需的一个已知前置条件；若路线带有社会冲突，夹具明确承担后果，后续仍须重新决定。",
        }
        : { surfaceId: "", relationToGoal: "unrelated", stance: "not_applicable", privateReason: "" };

    if (stage === "agent_candidates") return {
      candidates: {
        ownerAuthority: "character-agent",
        agentTurnId: stageInput.agentTurnId,
        candidates: [{
          originAuthority: "character-agent",
          candidateId,
          intention: plan.intention,
          attemptPrimitive: plan.primitive,
          targetHandle: clean(plan.affordanceId || plan.targetId),
          actionBinding,
          feasibilityHandling,
          perceivedPrerequisites: clone(evidenceIds),
          domains: [speaking ? "relationship" : "general"],
          expectedEffects: [],
          desireRelations: [],
          criterionUses: [],
          epistemicHandling: {
            positionIds: [],
            mode: "not_relevant",
            errorIfWrong: 0,
            actionReversibility: 1,
            learningDuringAction: 0,
            delayCost: 0,
            privateReason: "",
          },
          sharedActivity: clone(plan.sharedActivity || {
            operation: "none",
            activityId: "",
            kind: "",
            participantIds: [],
            requestedZoneId: "",
            response: "none",
            boundaries: { intensity: "", propertyProtection: false, harmLimit: "", note: "" },
          }),
          factorInputs: {
            emotionCompatibility: 0.72,
            valueAndSelfImage: 0.68,
            relationshipMeaning: 0.42,
            informationGain: plan.primitive === "observe" ? 0.72 : 0.18,
            habitAndIntentionContinuity: 0.7,
            bodyCost: 0.04,
            threatAndNormCost: 0.04,
            exposureAndRelationshipRisk: 0.06,
            opportunityAndSwitchingCost: 0.08,
            uncertaintyCost: 0.08,
          },
          timingIntent: acting ? "immediate" : "hold",
          uncertainty: 0.08,
        }],
      },
      stage: { name: `TavernV27Fixture:candidates:${stageInput.characterId}`, provider: "local-fixture", elapsedMs: 0 },
    };

    if (stage === "agent_choice_and_regulation") return {
      choice: {
        ownerAuthority: "character-agent",
        agentTurnId: stageInput.agentTurnId,
        selectedCandidateId: candidateId,
        regulationChoice: {
          ownerAuthority: "character-agent",
          regulationChoiceId: `fixture-regulation:${stageInput.agentTurnId}`,
          agentTurnId: stageInput.agentTurnId,
          strategies: [{ strategy: acting ? "express" : "tolerate", targetEmotionIds: [], effort: 0.08, contextFit: 0.9 }],
          acceptedCosts: [],
        },
        goalPreservation: {
          preservedDesireIds: [],
          transformedDimensions: acting ? ["manner"] : ["timing"],
          terminalExperiencePreserved: true,
          acceptedDelay: !acting,
          acceptedResidualFrustration: !acting ? 0.08 : 0,
          privateBasis: plan.privateBasis,
        },
        automaticCommunicationImpulse: {
          ownerAuthority: "character-agent",
          impulseId,
          mode: speaking ? "speech" : acting ? "nonverbal" : "none",
          triggerEvidenceIds: clone(evidenceIds),
          discourseAnchorIds: [],
          motiveSourceIds: [],
          perceivedTurnDemand: speaking ? "眼前的人需要得到一句能够继续行动的话" : "眼前只需要一个实际动作",
          feltTendency: speaking ? "直接给出眼下最少而足够的信息" : acting ? "先动手处理" : "先不说",
          urgency: acting ? 0.42 : 0.12,
          disclosurePressure: speaking ? 0.48 : 0.04,
          inhibitionPressure: speaking ? 0.12 : 0.32,
          conflict: { present: false, opposingSourceIds: [], description: "" },
        },
        continuationIntentions: Array.isArray(plan.continuationIntentions)
          ? plan.continuationIntentions.slice(0, 3).map((row, index) => ({
            ownerAuthority: "character-agent",
            intentionId: clean(row.intentionId || `fixture-continuation:${stageInput.agentTurnId}:${index + 1}`),
            triggerType: clean(row.triggerType || "elapsed_without_progress"),
            intendedPrimitive: clean(row.intendedPrimitive || "none"),
            targetHandle: clean(row.targetHandle),
            linkedSourceIds: clone(row.linkedSourceIds || []),
            minimumDelaySeconds: Math.max(0, Number(row.minimumDelaySeconds || 0)),
            triggerThreshold: Number(row.triggerThreshold ?? 0.5),
            maxDeferrals: Math.max(0, Number(row.maxDeferrals ?? 2)),
            privatePurpose: clean(row.privatePurpose),
          }))
          : plan.continueAfterSettlement ? [{
          ownerAuthority: "character-agent",
          intentionId: `fixture-continuation:${stageInput.agentTurnId}`,
          triggerType: "own_action_settled",
          intendedPrimitive: clean(plan.nextPrimitive || "interact"),
          targetHandle: "",
          linkedSourceIds: [],
          minimumDelaySeconds: 0,
          triggerThreshold: 0.5,
          maxDeferrals: 2,
          privatePurpose: "等眼前这一步得到客观结果，再由本人决定事务的下一步。",
          }] : [],
        privateDecisionBasis: plan.privateBasis,
      },
      stage: { name: `TavernV27Fixture:choice:${stageInput.characterId}`, provider: "local-fixture", elapsedMs: 0 },
    };

    if (stage === "agent_turn_commit") {
      const liveEmotions = stageInput.expressionMoment?.innerContinuity?.affectiveResidue?.liveEmotions || [];
      const materialEmotionIds = liveEmotions
        .filter((row) => ["low", "medium", "high", "very_high"].includes(clean(row?.intensity)))
        .map((row) => clean(row?.emotionId))
        .filter(Boolean);
      return {
        turnCommit: {
          ownerAuthority: "character-agent",
          agentTurnId: stageInput.agentTurnId,
          conversationAnchorSelection: conversationAnchorSelectionForPlan(stageInput, plan, speaking),
          privateExpressionTrace: {
            affectiveInfluence: {
              sourceEmotionIds: materialEmotionIds,
              mode: materialEmotionIds.length
                ? "contained_privately"
                : "no_live_influence",
              primaryChannelId: materialEmotionIds.length
                ? (stageInput.expressionMoment?.innerContinuity?.affectiveResidue?.possibleLeakageChannels || [])[0]?.channelId || "gaze"
                : "",
              privateBasis: "结构夹具只记录人物已处理的情绪去向，不预写公开微动作。",
            },
          },
          actionAttempt: {
            ...(plan.waitCondition ? { waitCondition: clone(plan.waitCondition) } : {}),
            primitive: plan.primitive,
            objectId: clean(plan.objectId),
            targetCharacterId: clean(plan.targetId),
            destinationId: clean(plan.destinationId),
            positionId: clean(plan.positionId),
            affordanceId: clean(plan.affordanceId),
          },
          publicExpression: {
            mode: speaking ? (hasNonverbalDelta ? "mixed" : "speech") : hasNonverbalDelta ? "nonverbal" : "silence",
            audienceCharacterIds: speaking && plan.targetId ? [plan.targetId] : [],
            timing: speaking && !separateAction ? "standalone" : separateAction ? "during_action" : "silence",
            utterance: {
              literalSpeech: plan.utterance,
              vocalMode: clean(plan.vocalMode) === "call_out" ? "call_out" : "conversational",
            },
            bodyDelta: plan.visibleAction,
            bodyActions: clone(plan.bodyActions || []),
            affectiveDeltas: [],
          },
        },
        stage: { name: `TavernV27Fixture:commit:${stageInput.characterId}`, provider: "local-fixture", elapsedMs: 0 },
      };
    }

    if (stage === "agent_expression_planning") return {
      expressionPlan: {
        ownerAuthority: "character-agent",
        sourceImpulseId: impulseId,
        impulseTransformation: {
          treatment: acting ? "express" : "withhold",
          privateBasis: plan.privateBasis,
        },
        mode: speaking ? "mixed" : acting ? "nonverbal" : "silence",
        actionIntent: acting ? plan.visibleAction || plan.intention : "保持原处，不追加公开动作",
        publicStance: {
          interactionMove: speaking ? (String(plan.utterance).includes("？") ? "ask" : "respond") : acting ? "none" : "silence",
          releasedMeaning: speaking ? clean(plan.intention) : "",
          audienceCharacterIds: speaking && plan.targetId ? [plan.targetId] : [],
          disclosure: speaking ? "partial" : "withhold",
          epistemicRelation: speaking ? "believes" : "not_applicable",
          intendedEffect: speaking ? "让对方接住眼前这一步" : "",
          threadDisposition: speaking ? "open_new" : "none",
          sharedContextAnchorIds: [],
          sharedContextTreatment: "not_applicable",
        },
        nonverbalUndertone: plan.texture.map((row) => row.feature).join("；"),
        privateRemainderPresent: true,
        relationshipStance: "只按眼前关系所需处理",
        timing: acting ? "during_action" : "silence",
        turnYield: speaking ? "yield" : acting ? "hold" : "not_applicable",
      },
      stage: { name: `TavernV27Fixture:expression:${stageInput.characterId}`, provider: "local-fixture", elapsedMs: 0 },
    };

    if (stage === "agent_realization") return {
      realization: {
        ownerAuthority: "character-agent",
        agentTurnId: stageInput.agentTurnId,
        emotionHandling: [{ channel: speaking ? "voice" : "posture", handling: acting ? "expressed" : "masked", basis: "只保留本轮公开可感知的部分" }],
        realizedSpeechHabitIds: [],
        surfaceRealization: {
          timing: acting ? "during_action" : "silence",
          affectiveTexture: clone(plan.texture),
          relationshipRegister: "眼前具体关系",
          appliedVoiceParameters: {
            directness: 0.68,
            compression: 0.62,
            warmth: stageInput.characterId === LUO_ZHAO ? 0.16 : 0.42,
            reserve: stageInput.characterId === LUO_ZHAO ? 0.78 : 0.48,
            formality: 0.32,
            emotionalLeakage: 0.28,
          },
          intentionalDepartureReason: "",
        },
        embodiedIntent: {
          automaticReaction: acting ? plan.visibleAction : "没有新增动作",
          chosenRegulation: acting ? "只做眼前需要的那一步" : "先压住新的表达",
          manner: acting ? "动作连在当前场面里" : "保持原处",
          posture: "仍在当前区域",
          intendedGesture: plan.visibleAction,
          bodyActions: clone(plan.bodyActions || []),
        },
        utterance: {
          literalSpeech: plan.utterance,
          vocalMode: clean(plan.vocalMode) === "call_out" ? "call_out" : "conversational",
          speechAct: speaking ? (String(plan.utterance).includes("？") ? "ask" : "inform") : "none",
          speechFunctions: speaking ? [String(plan.utterance).includes("？") ? "ask" : "inform"] : [],
        },
        actionAttempt: {
          ...(plan.waitCondition ? { waitCondition: clone(plan.waitCondition) } : {}),
          primitive: plan.primitive,
          objectId: clean(plan.objectId),
          targetCharacterId: clean(plan.targetId),
          destinationId: clean(plan.destinationId),
          affordanceId: clean(plan.affordanceId),
        },
      },
      stage: { name: `TavernV27Fixture:realization:${stageInput.characterId}`, provider: "local-fixture", elapsedMs: 0 },
    };

    throw new Error(`Unsupported fixture stage: ${stage}`);
  };
}
