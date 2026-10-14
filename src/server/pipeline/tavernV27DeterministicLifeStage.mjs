import { createTavernV27FixtureStageRunner } from "./tavernV27FixtureStage.mjs";

export const TAVERN_V27_DETERMINISTIC_LIFE_STAGE_VERSION = "tavern-v27-deterministic-life-stage-v1";

function clean(value = "") {
  return String(value ?? "").trim();
}

function finitePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function activePlanProjection(input = {}) {
  return input.privateContext?.livedSituation?.activePlanProjection
    || input.situationalGrounding?.activePlanProjection
    || null;
}

function worldNowSeconds(input = {}) {
  return Math.max(0, Number(
    input.worldProjection?.nowSeconds
    ?? activePlanProjection(input)?.nowSeconds
    ?? input.situationalGrounding?.scene?.elapsedSeconds
    ?? 0,
  ));
}

function duePlanStep(input = {}) {
  const projection = activePlanProjection(input) || {};
  return (projection.duePlanSteps || []).find((row, index, rows) => (
    clean(row?.planStepId)
    && rows.findIndex((candidate) => clean(candidate?.planStepId) === clean(row.planStepId)) === index
  )) || null;
}

function planStepNumber(step = {}) {
  const match = clean(step?.planStepId).match(/:step:(\d+)$/u);
  return match ? Math.max(1, Number(match[1])) : 1;
}

function currentEvidence(input = {}) {
  return input.worldProjection?.evidence || [];
}

function directedQuestion(input = {}) {
  return [...currentEvidence(input)].reverse().find((row) => (
    clean(row?.eventKind || row?.actionKind) === "speech"
    && row?.directed === true
    && clean(row?.speechAct) === "ask"
  )) || null;
}

function sourceHandle(question = {}, input = {}) {
  const sourceActionId = clean(question.sourceActionId || question.provenance?.sourceActionId);
  const matchingPublicTurn = [...(input.worldProjection?.discourseContext?.recentPublicTurns || [])]
    .reverse()
    .find((row) => sourceActionId && clean(row?.sourceActionId) === sourceActionId);
  if (clean(matchingPublicTurn?.speakerId)) return clean(matchingPublicTurn.speakerId);
  const rawSourceId = clean(
    question.perceivedSourceCharacterId
    || question.sourceEntityHandle
    || question.sourceCharacterId,
  );
  const perceived = (input.worldProjection?.perceivedCharacters || []).find((row) => (
    clean(row?.id) === rawSourceId
    || clean(row?.recognizedIdentity?.characterId) === rawSourceId
  ));
  if (clean(perceived?.id)) return clean(perceived.id);
  const permitted = new Set((input.referenceContract?.perceivedTargetHandles || []).map(clean));
  return permitted.has(rawSourceId) ? rawSourceId : "";
}

function perceivedTargets(input = {}) {
  return [...(input.worldProjection?.perceivedCharacters || [])]
    .map((row) => clean(row?.id))
    .filter((id) => id && id !== clean(input.characterId))
    .sort();
}

function availableDestination(input = {}) {
  const currentZoneId = clean(input.worldProjection?.scene?.zoneId);
  const candidates = (input.worldProjection?.actionFeasibilities || [])
    .filter((row) => clean(row?.bindingKind) === "place")
    .filter((row) => clean(row?.targetHandle) && clean(row.targetHandle) !== currentZoneId)
    .filter((row) => row?.directAttempt?.currentlyAttemptable !== false)
    .filter((row) => !(
      row?.socialAccess?.permissionRequiredByNorm === true
      && row?.socialAccess?.permissionCurrentlyGranted === false
    ))
    .sort((left, right) => clean(left.targetHandle).localeCompare(clean(right.targetHandle)));
  return clean(candidates[0]?.targetHandle);
}

function activityPrimitive(stepNumber, characterOrdinal) {
  if (stepNumber % 4 === 2) return "speak";
  if (stepNumber % 4 === 3) return "move";
  return (stepNumber + characterOrdinal) % 2 === 0 ? "practice" : "rest";
}

function dayPlanPrimitive(activityType = "") {
  const type = clean(activityType);
  if (["rest", "sleep", "recovery"].includes(type)) return "rest";
  if (["practice", "study", "training"].includes(type)) return "practice";
  if (["move", "errand", "change_place"].includes(type)) return "move";
  if (["social", "social_time", "conversation"].includes(type)) return "speak";
  return "";
}

function continuationFor({ characterId, stepNumber, primitive, minimumDelaySeconds }) {
  return {
    intentionId: `deterministic-life:${encodeURIComponent(clean(characterId))}:step:${stepNumber}`,
    triggerType: "elapsed_without_progress",
    intendedPrimitive: primitive,
    targetHandle: "",
    linkedSourceIds: [],
    minimumDelaySeconds,
    triggerThreshold: 0.5,
    maxDeferrals: 0,
    privatePurpose: "在自己定下的下一段生活时间到来时，重新看一眼处境，再决定是否仍这样做。",
  };
}

function quietPlan({ continuationIntentions = [], privateBasis = "" } = {}) {
  return {
    intention: "先把下一次重新考虑的时机留给自己",
    primitive: "none",
    targetId: "",
    utterance: "",
    visibleAction: "",
    texture: [],
    privateBasis: clean(privateBasis || "眼前没有非做不可的新事，他只保留下一次思考的时间。"),
    continuationIntentions,
  };
}

/**
 * A deterministic, data-driven stage provider for structural long-run tests.
 * It is not a prose-quality oracle: it exercises the production Character
 * Agent protocol, private plan clock, dialogue lineage, reflection and world
 * settlement without prescribing an action script in the world runtime.
 */
export function createTavernV27DeterministicLifeStageRunner({
  horizonSeconds = 86_400,
  cadenceSeconds = 21_600,
  staggerSeconds = 300,
} = {}) {
  const horizon = finitePositive(horizonSeconds, 86_400);
  const cadence = Math.min(86_400, finitePositive(cadenceSeconds, 21_600));
  const stagger = Math.max(0, Number(staggerSeconds || 0));
  const totalSteps = Math.max(1, Math.ceil(horizon / cadence));
  function ordinal(characterId) {
    let hash = 2166136261;
    for (const character of clean(characterId)) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash % 7;
  }

  function nextContinuation(input, currentStepNumber = 0) {
    const nextStepNumber = currentStepNumber + 1;
    if (nextStepNumber > totalSteps) return [];
    const characterOrdinal = ordinal(input.characterId);
    return [continuationFor({
      characterId: input.characterId,
      stepNumber: nextStepNumber,
      primitive: activityPrimitive(nextStepNumber, characterOrdinal),
      minimumDelaySeconds: Math.max(1, cadence - (characterOrdinal * stagger)),
    })];
  }

  function dayPlanFor(input = {}) {
    const sourceId = (input.referenceContract?.ownedSourceIds || [])[0];
    const zoneHandles = input.referenceContract?.allowedZoneHandles || [];
    const characterOrdinal = ordinal(input.characterId);
    const starts = [0, 14_400, 28_800, 43_200, 57_600, 79_200];
    const ends = [10_800, 25_200, 39_600, 54_000, 68_400, 86_400];
    const activities = characterOrdinal % 2 === 0
      ? ["rest", "social_time", "move", "practice", "rest", "social_time"]
      : ["practice", "social_time", "move", "rest", "practice", "social_time"];
    return {
      ownerAuthority: "character-agent",
      planBlocks: starts.map((relativeStartSeconds, index) => ({
        relativeStartSeconds,
        relativeEndSeconds: ends[index],
        activityType: activities[index],
        desiredZoneHandle: clean(zoneHandles[index % Math.max(1, zoneHandles.length)]),
        privatePurpose: `根据本人当下的生活依据，为第 ${index + 1} 段时间留下一个可重新判断的粗安排。`,
        sourceIds: [sourceId],
      })),
    };
  }

  function planForTurn(input = {}) {
    const characterOrdinal = ordinal(input.characterId);
    const question = directedQuestion(input);
    const projectedPlan = activePlanProjection(input) || {};
    // The fixture authors a real wait for its already-chosen next opportunity.
    // The runtime must not infer this intention from a repeated `none` action.
    const quiet = options => {
      const now = worldNowSeconds(input);
      const planHorizon = projectedPlan.dayPlanHorizonEndsAtSeconds;
      if (Number.isFinite(planHorizon) && planHorizon <= now) return quietPlan(options);
      // An already-due owned plan has its own queued thought opportunity.
      // This fixture declines to renew its wait while that opportunity is due.
      if ((projectedPlan.activePlanSteps || []).some(row => Number(row.dueAtSeconds) <= now)) return quietPlan(options);
      const future = (projectedPlan.activePlanSteps || []).map(row => Number(row.dueAtSeconds)).filter(value => Number.isFinite(value) && value > now);
      if (Number.isFinite(planHorizon) && planHorizon > now) future.push(planHorizon);
      const delay = future.length ? Math.min(...future) - now : cadence;
      return { ...quietPlan(options), primitive: "wait", waitCondition: {
        condition: "new_evidence", maximumSeconds: Math.max(1, Math.min(86400, delay)), interruptOnDirectSpeech: true,
      } };
    };
    const maturePlan = duePlanStep(input);
    const earlySatisfiedSpeechPlan = question
      ? (projectedPlan.activePlanSteps || []).find((row) => clean(row?.intendedPrimitive) === "speak") || null
      : null;
    const currentPlan = maturePlan || earlySatisfiedSpeechPlan;
    const currentStepNumber = currentPlan ? planStepNumber(currentPlan) : 0;
    const continuationIntentions = maturePlan
      ? clean(maturePlan.planKind) === "day-plan" ? [] : nextContinuation(input, currentStepNumber)
      : earlySatisfiedSpeechPlan ? nextContinuation(input, currentStepNumber) : [];
    if (question) {
      const targetId = sourceHandle(question, input);
      return {
        intention: "先回应刚刚真正问到自己身上的话",
        primitive: "speak",
        targetId,
        utterance: "还顺当。我先把手边这一步做完。",
        speechAct: "answer",
        speechFunctions: ["answer", "respond"],
        visibleAction: "",
        texture: [],
        privateBasis: "这句话确实问到了本人；先给出当下能负责的回答，不替对方继续说。",
        continuationIntentions,
      };
    }

    if (!currentPlan) {
      if (currentEvidence(input).length) return quiet({
        privateBasis: "新动静已被看见，但还不足以打断本人尚未到期的安排。",
      });
      return quiet({
        continuationIntentions: nextContinuation(input, 0),
        privateBasis: "清晨只由本人先留下一次稍后再决定的机会；世界没有替他指定第一步。",
      });
    }

    const intendedPrimitive = clean(currentPlan.intendedPrimitive)
      || dayPlanPrimitive(currentPlan.activityType)
      || activityPrimitive(currentStepNumber, characterOrdinal);
    if (intendedPrimitive === "speak") {
      const targetId = perceivedTargets(input)[0] || "";
      if (!targetId) return quiet({
        continuationIntentions,
        privateBasis: "原本想开口，但眼前没有真实可说话的人；本人改为安静并保留下一次安排。",
      });
      return {
        intention: "在一天走到这里时，主动问问眼前的人近况",
        primitive: "speak",
        targetId,
        utterance: "这会儿还顺当吗？",
        speechAct: "ask",
        speechFunctions: ["ask", "initiate"],
        visibleAction: "",
        texture: [],
        privateBasis: "到了本人先前留出的交谈时机，眼前也确有一个可以问的人。",
        continuationIntentions,
      };
    }

    if (intendedPrimitive === "move") {
      const destinationId = availableDestination(input);
      if (!destinationId) return {
        ...quiet({
          continuationIntentions,
          privateBasis: "原本想换个地方，但此刻没有本人已知且可尝试的合适路线，因此改为原处歇一会。",
        }),
        intention: "路线不合适，先在原处歇一会",
        primitive: "rest",
        visibleAction: "他没有硬闯，只在原处缓了缓。",
      };
      return {
        intention: "按眼下真正可走的路线换到近旁空间",
        primitive: "move",
        destinationId,
        utterance: "",
        visibleAction: "他收住手边动作，沿着近旁通路换了个位置。",
        texture: [{ channel: "pace", modality: "visual", feature: "步子平稳，没有催促旁人" }],
        privateBasis: "原先留下的是换个地方的打算；现在仍有真实可走的相邻路线。",
        continuationIntentions,
      };
    }

    if (intendedPrimitive === "practice") return {
      intention: "用这一段空当做一点自己的功课",
      primitive: "practice",
      targetId: "",
      utterance: "",
      visibleAction: "他在原处收束心神，练了一阵自己的功课。",
      texture: [{ channel: "posture", modality: "visual", feature: "动作有节制，没有妨碍旁人" }],
      privateBasis: "这是本人先前给日常功课留出的时间，眼下没有更急的现实打断。",
      continuationIntentions,
    };

    return {
      intention: "让身体在这一段时间真正歇下来",
      primitive: "rest",
      targetId: "",
      utterance: "",
      visibleAction: "他在原处松了松肩背，安静歇了一阵。",
      texture: [{ channel: "posture", modality: "visual", feature: "肩背慢慢松下来" }],
      privateBasis: "这是本人先前留给休息的时段，眼前没有更急的现实打断。",
      continuationIntentions,
    };
  }

  const runner = createTavernV27FixtureStageRunner({ planForTurn });
  return async function runDeterministicLifeStage(input, options = {}) {
    if (options.stage === "character_day_planning") return {
      dayPlan: dayPlanFor(input),
      stage: {
        name: `TavernV27DeterministicLife:character_day_planning:${clean(input.characterId)}`,
        provider: "local-deterministic-life-fixture",
        elapsedMs: 0,
      },
    };
    return runner(input, options);
  };
}
