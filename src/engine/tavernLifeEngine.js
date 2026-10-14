import { createId } from "../data/seed.js";
import { auditDraft } from "./depthAuditor.js";
import {
  appraiseOfferingSustenance,
  operationalSustenanceFactors,
} from "../server/simulation/cultivationSustenance.mjs";

const TAVERN_LOCATION_ID = "loc_xyy_tavern";
const DAY_SLOTS = [
  { id: "dawn", label: "清晨", focus: "开门、生火与第一批去处" },
  { id: "noon", label: "正午", focus: "饭、送货与短暂歇脚" },
  { id: "afternoon", label: "午后", focus: "零工、等待与未完成的私事" },
  { id: "dusk", label: "黄昏", focus: "回返、结账与错过的承诺" },
  { id: "night", label: "夜深", focus: "收灶、留下与没有回来的人" },
];

const NEED_KEYS = ["hunger", "fatigue", "social", "safety", "autonomy"];

const TAVERN_INSTITUTION = {
  schemaVersion: 2,
  name: "望梯酒馆",
  householdName: "谢家",
  ownerIds: ["char_xyy_xieheng"],
  operatorId: "char_xyy_xiemu",
  householdWorkerIds: ["char_xyy_xiezenshi"],
  publicHours: ["清晨", "正午", "午后", "黄昏"],
  description: "望梯酒馆是谢家的生计：谢恒是东家，谢母是掌柜兼掌灶，谢真石住在后院并以柴水与堂前杂务分担家业。",
  offerings: {
    meal: { label: "一碗热饭", price: 2 },
    tea: { label: "一碗热茶", price: 1 },
    lodging_meal: { label: "一晚客房和一顿热饭", price: 5 },
    work_meal: { label: "以堂前杂务换一碗热饭", price: 0 },
  },
};

function deepClone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function clamp(value, min = 10, max = 90) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}

function stableHash(value = "") {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function stableJitter(key, size = 11) {
  return stableHash(key) % Math.max(1, size);
}

function initialTavernState() {
  return {
    schemaVersion: 3,
    locationId: TAVERN_LOCATION_ID,
    day: 0,
    tick: 0,
    open: true,
    weather: "薄云",
    perceptionEnvironment: {
      schemaVersion: 1,
      authority: "world-state",
      light: 0.82,
      ambientNoise: 0.18,
      modalityTransmission: { visual: 1, sound: 1, smell: 1, touch: 1, vibration: 1, proprioception: 1 },
    },
    stock: { grain: 16, meals: 18, tea: 24, firewood: 20, water: 30 },
    cashBox: 36,
    pricePressure: 0,
    recentMicroEvents: [],
    lastActivities: [],
    pendingRequests: [],
    institution: deepClone(TAVERN_INSTITUTION),
    activeVisits: [],
    visits: [],
    ledger: [],
    eventThreads: [],
  };
}

function normalizedNeeds(lifeState = {}) {
  const source = lifeState.needs || {};
  return {
    hunger: clamp(source.hunger ?? 40),
    fatigue: clamp(source.fatigue ?? 35),
    social: clamp(source.social ?? 30),
    safety: clamp(source.safety ?? 25),
    autonomy: clamp(source.autonomy ?? 40),
  };
}

function normalizedLifeState(character = {}) {
  const profile = character.lifeProfile || {};
  const source = character.lifeState || {};
  const coins = Math.max(0, Number(source.resources?.coins) || 0);
  const profileWallet = profile.materialEconomy?.initialWallet || {};
  return {
    schemaVersion: 3,
    present: source.present ?? profile.simulationTier === "core",
    needs: normalizedNeeds(source),
    resources: {
      coins,
      wallet: {
        currencyId: source.resources?.wallet?.currencyId || profileWallet.currencyId || "copper_wen",
        amount: coins,
        sourceId: source.resources?.wallet?.sourceId || profileWallet.sourceId || "unanchored_wallet",
      },
      mealCredit: Math.max(0, Number(source.resources?.mealCredit) || 0),
    },
    activeGoal: source.activeGoal || profile.commitments?.[0] || profile.activities?.duty || "完成今天答应的事",
    hiddenAgenda: source.hiddenAgenda || profile.privatePursuit || "保留自己的下一步",
    currentActivity: source.currentActivity || character.currentActivity || {
      type: "routine",
      description: profile.activities?.routine || "坐下观察屋里的动静",
      progress: 0,
      remainingTicks: 0,
    },
    appraisal: source.appraisal || "今天尚未发生需要重新解释的事。",
    lastChoiceReason: source.lastChoiceReason || "先沿着已经形成的习惯开始。",
    consecutiveActivityTicks: Math.max(0, Number(source.consecutiveActivityTicks) || 0),
    situationalRole: source.situationalRole || profile.tavernAgency?.expression?.roleLabel || profile.tavernAgency?.standing || "在场者",
    activeVisitId: source.activeVisitId || "",
    visitPurpose: source.visitPurpose || "",
  };
}

function driftNeeds(needs, { present }, profile = {}) {
  const sustenance = operationalSustenanceFactors(profile.physiology?.sustenance || {});
  return {
    hunger: clamp(needs.hunger + (present ? 6 : 4) * sustenance.basalHungerGrowth),
    fatigue: clamp(needs.fatigue + (present ? 4 : 2)),
    social: clamp(needs.social + (present ? 2 : 1)),
    safety: clamp(needs.safety + (present ? 1 : 0)),
    autonomy: clamp(needs.autonomy + (present ? 2 : 1)),
  };
}

function isScheduled(profile = {}, label = "", day = 1) {
  if (!(profile.schedule || []).includes(label)) return false;
  const visitPolicy = profile.tavernAgency?.visitPolicy;
  if (!visitPolicy) return true;
  const frequencyDays = Math.max(1, Number(visitPolicy.frequencyDays) || 1);
  const dayOffset = Math.max(1, Number(visitPolicy.dayOffset) || 1);
  return ((Number(day) - dayOffset) % frequencyDays + frequencyDays) % frequencyDays === 0;
}

function agencyFor(character = {}) {
  return character.lifeProfile?.tavernAgency || {};
}

function offeringForTavern(tavern = {}, requestedService = "meal") {
  return tavern.institution?.offerings?.[requestedService]
    || TAVERN_INSTITUTION.offerings[requestedService]
    || { label: requestedService, price: 0, category: "service", stockCost: {} };
}

function offeringKind(offering = {}, requestedService = "") {
  if (offering.category) return offering.category;
  if (/tea|water/u.test(requestedService)) return "tea";
  if (/meal|food/u.test(requestedService)) return "meal";
  if (/lodging|room/u.test(requestedService)) return "lodging";
  return "service";
}

function offeringStockCost(offering = {}, requestedService = "") {
  if (offering.stockCost && typeof offering.stockCost === "object") return offering.stockCost;
  const kind = offeringKind(offering, requestedService);
  if (kind === "tea") return { tea: 1, water: 1 };
  if (["meal", "lodging", "work_meal"].includes(kind)) return { meals: 1 };
  return {};
}

function canProvideOffering(tavern = {}, offering = {}, requestedService = "") {
  return Object.entries(offeringStockCost(offering, requestedService)).every(([stockId, amount]) => (
    Number(tavern.stock?.[stockId] || 0) >= Number(amount || 0)
  ));
}

function activeVisitById(tavern, visitId) {
  return (tavern.activeVisits || []).find((visit) => visit.id === visitId) || null;
}

function activeVisitForCharacter(tavern, characterId) {
  return (tavern.activeVisits || []).find((visit) => visit.visitorId === characterId) || null;
}

function pendingVisitForHost(character, tavern) {
  const authority = agencyFor(character).authority || {};
  if (!authority.receiveGuest) return null;
  return (tavern.activeVisits || []).find((visit) => {
    if (["completed", "abandoned", "refused"].includes(visit.stage)) return false;
    const expected = Array.isArray(visit.expectedHostIds) ? visit.expectedHostIds : [];
    if (visit.stage === "waiting") return expected.includes(character.id) || !expected.length;
    if (visit.stage === "received" && visit.kind === "delivery") return Boolean(authority.acceptDelivery) && !visit.deliveryAccepted;
    if (["received", "work_done", "delivery_received"].includes(visit.stage)) {
      if (visit.paymentMode === "work_exchange" && visit.stage !== "work_done") return false;
      const kind = offeringKind(offeringForTavern(tavern, visit.requestedService), visit.requestedService);
      if (["meal", "work_meal", "lodging"].includes(kind)) return Boolean(authority.serveMeal);
      if (kind === "tea") return Boolean(authority.serveTea);
    }
    if (["served", "business_done", "personal_attempted"].includes(visit.stage)) return Boolean(authority.settleCash);
    return false;
  }) || null;
}

function hospitalityCandidate(character, lifeState, tavern) {
  const visit = pendingVisitForHost(character, tavern);
  if (visit) {
    if (visit.stage === "waiting") {
      return {
        type: "receive_guest",
        description: `认出来客${visit.visitorName}的来意并上前招呼`,
        score: 220 + Number(agencyFor(character).servicePolicy?.priority || 0),
        reason: `${agencyFor(character).expression?.roleLabel || character.name}把等候的来客视为自己必须回应的责任。`,
        duration: 0,
        visitId: visit.id,
      };
    }
    if (visit.stage === "received" && visit.kind === "delivery" && !visit.deliveryAccepted) {
      return {
        type: "accept_delivery",
        description: `当面验收${visit.visitorName}带来的药包和清单`,
        score: 245,
        reason: "送来的东西只有经过有权限的人验收，才算真正交到谢家手里。",
        duration: 0,
        visitId: visit.id,
      };
    }
    if (["received", "work_done", "delivery_received"].includes(visit.stage)) {
      const offering = offeringForTavern(tavern, visit.requestedService);
      return {
        type: "serve_guest",
        description: `按${visit.visitorName}这次的来意备好${offering.label || visit.requestedService}`,
        score: 235,
        reason: "已经接下的来客不能只停在一句招呼上，服务必须落到具体东西和账目。",
        duration: 0,
        visitId: visit.id,
      };
    }
    if (["served", "business_done", "personal_attempted"].includes(visit.stage)) {
      return {
        type: "settle_visit",
        description: `同${visit.visitorName}把这次饭茶或住店的账结清`,
        score: 230,
        reason: "出过的饭茶必须落到钱、赊账或以工抵偿中的一种结果。",
        duration: 0,
        visitId: visit.id,
      };
    }
  }

  const ownVisit = activeVisitForCharacter(tavern, character.id);
  if (!ownVisit || ["completed", "abandoned", "refused"].includes(ownVisit.stage)) return null;
  if (ownVisit.stage === "received" && ownVisit.paymentMode === "work_exchange") {
    return {
      type: "perform_exchange",
      description: character.lifeProfile?.activities?.duty || "完成与掌柜说定的堂前杂务",
      score: 250,
      reason: "这顿饭不是自行取用，而要先完成已经说定的交换。",
      duration: 0,
      visitId: ownVisit.id,
    };
  }
  if (ownVisit.stage === "served" && ownVisit.kind === "business") {
    return {
      type: "perform_visit_business",
      description: "在茶尚热时把带来的名录逐项核完",
      score: 252,
      reason: `喝茶只是这次来店的一部分，真正来意是${ownVisit.purpose}。`,
      duration: 0,
      visitId: ownVisit.id,
    };
  }
  if (ownVisit.stage === "served" && ownVisit.secondaryObjective && ownVisit.secondaryTargetId) {
    return {
      type: "attempt_secondary_objective",
      description: ownVisit.secondaryObjective,
      score: 254,
      reason: "饭和送货账可以结清，但人物自己的来意不能被交易流程抹掉。",
      duration: 0,
      visitId: ownVisit.id,
    };
  }
  return {
    type: "wait_for_service",
    description: ownVisit.stage === "served" ? "留在柜台前等掌柜把账目结清" : "在不挡路的位置等负责的人回应来意",
    score: 215,
    reason: `这次进门是为了${ownVisit.purpose}，事情尚未完成。`,
    duration: 0,
    visitId: ownVisit.id,
  };
}

function characterRelationshipPressure(state, characterId, presentIds) {
  const related = (state.relationships || []).filter((relationship) => (
    (relationship.fromCharacterId === characterId && presentIds.includes(relationship.toCharacterId))
    || (relationship.toCharacterId === characterId && presentIds.includes(relationship.fromCharacterId))
  ));
  if (!related.length) return 0;
  return Math.max(...related.map((relationship) => (
    Number(relationship.resentment || 0)
    + Number(relationship.dependence || 0)
    + Number(relationship.wantsToBeSeen || 0)
  ) / 3));
}

function uniqueCandidateTypes(candidates = []) {
  const byType = new Map();
  for (const candidate of candidates) {
    const type = String(candidate?.type || "");
    if (!type) continue;
    const current = byType.get(type);
    if (!current || (candidate.continued && !current.continued) || (!current.continued && Number(candidate.score || 0) > Number(current.score || 0))) {
      byType.set(type, candidate);
    }
  }
  return [...byType.values()];
}

function activityCandidates(character, lifeState, tavern, context) {
  const profile = character.lifeProfile || {};
  const needs = lifeState.needs;
  const tierBonus = profile.simulationTier === "core" ? 18 : 6;
  const dutyPressureBonus = character.id === "char_xyy_xiemu" && tavern.stock.meals < 8 && tavern.stock.grain >= 2
    ? 52
    : character.id === "char_xyy_xieheng" && tavern.stock.grain < 8 && tavern.cashBox >= 2
      ? 48
      : character.id === "char_xyy_xiezenshi" && tavern.stock.firewood < 8
        ? 42
        : 0;
  const candidates = [];
  const hospitality = hospitalityCandidate(character, lifeState, tavern);
  if (hospitality) candidates.push(hospitality);
  if (profile.simulationTier === "visitor") {
    if (!hospitality) {
      candidates.push({
        type: "prepare_to_leave",
        description: "把这次来店的东西收拢好，等走时不落下东西",
        score: 190,
        reason: "这次来意已经有了结果，留下来不再自动产生新的饭茶或权限。",
        duration: 0,
      });
    }
    return uniqueCandidateTypes(candidates);
  }
  const current = lifeState.currentActivity || {};
  if (Number(current.remainingTicks) > 0 && current.description) {
    candidates.push({
      type: current.type || "continue",
      description: current.description,
      score: 46 + Number(profile.inertia || 12) + Math.min(12, lifeState.consecutiveActivityTicks * 3),
      reason: "这件事还没做完，已经形成的动作比新念头更有分量。",
      duration: Math.max(0, Number(current.remainingTicks) - 1),
      continued: true,
    });
  }
  if (tavern.stock.meals > 0 && (lifeState.resources.coins > 0 || lifeState.resources.mealCredit > 0 || profile.simulationTier === "core")) {
    const mealOffering = offeringForTavern(tavern, "meal");
    const mealAppraisal = appraiseOfferingSustenance({
      sustenanceProfile: profile.physiology?.sustenance || {},
      bodyState: { hunger: Number(needs.hunger || 0) / 100 },
      offering: mealOffering,
      offeringId: "meal",
    });
    candidates.push({
      type: "eat",
      description: "坐到灶边把一碗热饭吃完",
      score: needs.hunger * 1.72 * mealAppraisal.ordinaryFoodDependence,
      reason: mealAppraisal.ordinaryFoodDependence < 0.35
        ? "凡食的身体收益很低；是否吃仍要同口味、习惯和眼前事务一起比较。"
        : "饥饿已经挤过了手头事务。",
      duration: 0,
    });
  }
  if (tavern.stock.tea > 0 && tavern.stock.water > 0) {
    candidates.push({ type: "drink", description: "倒半碗热茶，慢慢喝完", score: 25 + needs.fatigue * 0.72 + needs.social * 0.18, reason: "需要一小段不必立刻回应别人的停顿。", duration: 0 });
  }
  candidates.push({ type: "rest", description: "退到不挡路的墙边歇一阵", score: needs.fatigue * 1.62, reason: "身体的疲惫已经降低了继续做事的把握。", duration: 0 });
  candidates.push({
    type: "duty",
    description: profile.activities?.duty || "完成今天答应的杂务",
    score: 40 + tierBonus + dutyPressureBonus + (context.slotIndex <= 1 ? 9 : 0),
    reason: profile.commitments?.[0] ? `先兑现承诺：${profile.commitments[0]}` : "这件事今天必须有人完成。",
    duration: 1,
  });
  candidates.push({
    type: "personal",
    description: profile.activities?.personal || "处理一件不愿公开说明的私事",
    score: 30 + needs.autonomy * 1.16 + (context.slotIndex >= 2 ? 8 : 0),
    reason: `给自己的目标留出一点行动：${profile.privatePursuit || lifeState.hiddenAgenda}`,
    duration: 1,
  });
  const stockLow = character.id === "char_xyy_xiemu"
    ? tavern.stock.water < 10 || tavern.stock.firewood < 6
    : character.id === "char_xyy_xieheng"
      ? tavern.stock.water < 10
      : character.id === "char_xyy_xiezenshi"
        ? tavern.stock.water < 10 || tavern.stock.firewood < 6
        : false;
  candidates.push({
    type: "maintain",
    description: profile.simulationTier === "core" ? "检查灶火、水缸和门闩；削木楔垫稳松动的桌脚" : "把用过的桌面和挡路的凳子归回原处",
    score: 25 + tierBonus + (stockLow ? 48 : 0),
    reason: stockLow ? "酒馆的存量已经会妨碍下一顿饭。" : "把共享空间恢复到下一个人还能使用的状态。",
    duration: 0,
  });
  candidates.push({
    type: "observe",
    description: "一边做手上的小事，一边留意门口和屋里的人",
    score: 22 + context.relationshipPressure * 0.42 + needs.social * 0.3,
    reason: "关系压力值得留意，但还不足以强迫一场谈话。",
    duration: 0,
  });
  return uniqueCandidateTypes(candidates);
}

function decisionOpportunityId(day, slotId, characterId) {
  return `${Number(day) || 0}:${slotId || "slot"}:${characterId || "character"}`;
}

function publicCandidate(candidate = {}) {
  return {
    type: candidate.type || "",
    description: candidate.description || "",
    reason: candidate.reason || "",
    score: Number(candidate.score || 0),
    duration: Number(candidate.duration || 0),
    visitId: candidate.visitId || "",
  };
}

function selectCandidate(character, candidates, context, override = null) {
  const scored = candidates
    .map((candidate) => ({
      ...candidate,
      resolvedScore: candidate.score + stableJitter(`${context.day}:${context.slotIndex}:${character.id}:${candidate.type}`, 13),
    }))
    .sort((a, b) => b.resolvedScore - a.resolvedScore);
  const requestedType = String(override?.chosenActionType || "");
  const requested = requestedType ? scored.find((candidate) => candidate.type === requestedType) : null;
  if (!requested) return { ...scored[0], decisionSource: "deterministic-kernel", modelDecisionReason: "" };
  return {
    ...requested,
    decisionSource: "tavern-agent-model",
    modelDecisionReason: String(override?.privateReason || "").trim(),
  };
}

function applyNeedDelta(needs, delta = {}) {
  const next = { ...needs };
  for (const key of NEED_KEYS) next[key] = clamp(Number(next[key]) + Number(delta[key] || 0));
  return next;
}

function activityEffects(activity, character, lifeState, tavern) {
  const needDelta = { hunger: 0, fatigue: 0, social: 0, safety: 0, autonomy: 0 };
  const resourceDelta = { grain: 0, meals: 0, tea: 0, firewood: 0, water: 0, cashBox: 0, coins: 0, mealCredit: 0 };
  switch (activity.type) {
    case "eat":
      {
        const mealAppraisal = appraiseOfferingSustenance({
          sustenanceProfile: character.lifeProfile?.physiology?.sustenance || {},
          bodyState: { hunger: Number(lifeState.needs?.hunger || 0) / 100 },
          offering: offeringForTavern(tavern, "meal"),
          offeringId: "meal",
        });
        needDelta.hunger = -34 * mealAppraisal.recoveryEfficiency;
        needDelta.fatigue = -4 * mealAppraisal.recoveryEfficiency;
      }
      resourceDelta.meals = -1;
      if (lifeState.resources.mealCredit > 0) resourceDelta.mealCredit = -1;
      else if (character.lifeProfile?.simulationTier !== "core" && lifeState.resources.coins > 0) {
        resourceDelta.coins = -1;
        resourceDelta.cashBox = 1;
      }
      break;
    case "drink":
      needDelta.fatigue = -9;
      needDelta.social = -5;
      resourceDelta.tea = -1;
      resourceDelta.water = -1;
      break;
    case "rest":
      needDelta.fatigue = -31;
      needDelta.safety = -4;
      break;
    case "duty":
      needDelta.fatigue = 5;
      needDelta.autonomy = 3;
      needDelta.safety = -5;
      if (character.id === "char_xyy_xiezenshi") resourceDelta.firewood = 3;
      if (character.id === "char_xyy_xieheng" && tavern.cashBox >= 2) {
        resourceDelta.grain = 3;
        resourceDelta.cashBox = -2;
      }
      if (character.id === "char_xyy_xiemu" && tavern.stock.grain >= 2 && tavern.stock.firewood >= 1 && tavern.stock.water >= 1) {
        resourceDelta.grain = -2;
        resourceDelta.meals = 2;
        resourceDelta.firewood = -1;
        resourceDelta.water = -1;
      }
      break;
    case "personal":
      needDelta.autonomy = -29;
      needDelta.fatigue = 6;
      break;
    case "maintain":
      needDelta.safety = -18;
      needDelta.autonomy = -6;
      resourceDelta.water = character.lifeProfile?.simulationTier === "core" && tavern.stock.water < 30 ? 2 : 0;
      break;
    case "observe":
      needDelta.social = -8;
      needDelta.safety = -3;
      break;
    default:
      break;
  }
  tavern.stock.grain = Math.max(0, Math.min(24, tavern.stock.grain + resourceDelta.grain));
  tavern.stock.meals = Math.max(0, Math.min(24, tavern.stock.meals + resourceDelta.meals));
  tavern.stock.tea = Math.max(0, Math.min(30, tavern.stock.tea + resourceDelta.tea));
  tavern.stock.firewood = Math.max(0, Math.min(30, tavern.stock.firewood + resourceDelta.firewood));
  tavern.stock.water = Math.max(0, Math.min(40, tavern.stock.water + resourceDelta.water));
  tavern.cashBox = Math.max(0, Math.min(200, tavern.cashBox + resourceDelta.cashBox));
  lifeState.resources.coins = Math.max(0, lifeState.resources.coins + resourceDelta.coins);
  if (lifeState.resources.wallet) lifeState.resources.wallet.amount = lifeState.resources.coins;
  lifeState.resources.mealCredit = Math.max(0, lifeState.resources.mealCredit + resourceDelta.mealCredit);
  lifeState.needs = applyNeedDelta(lifeState.needs, needDelta);
  return { needDelta, resourceDelta };
}

function addLedgerEntry(tavern, entry) {
  tavern.ledger = [...(tavern.ledger || []), {
    id: createId("tavern_ledger"),
    ...entry,
  }].slice(-48);
}

function hospitalityEffects(activity, character, lifeState, workingCharacters, tavern, context) {
  const visit = activeVisitById(tavern, activity.visitId);
  if (!visit) return null;
  const guest = workingCharacters.find((item) => item.id === visit.visitorId);
  const guestState = guest?.lifeState;
  const offering = offeringForTavern(tavern, visit.requestedService);
  const deliveredLabel = visit.requestedService === "work_meal" ? "一碗热饭" : offering.label;
  const base = {
    activityType: activity.type,
    needDelta: {},
    resourceDelta: {},
    targetCharacterId: visit.visitorId,
    targetCharacterName: visit.visitorName,
    visitId: visit.id,
    visitPurpose: visit.purpose,
    situationalRole: agencyFor(character).expression?.roleLabel || agencyFor(character).standing || "店里人",
    expectedHostIds: [...(visit.expectedHostIds || [])],
    requestedService: visit.requestedService,
    paymentMode: visit.paymentMode,
    completionCondition: visit.completionCondition,
    secondaryObjective: visit.secondaryObjective || "",
    secondaryTargetId: visit.secondaryTargetId || "",
    salience: 72,
  };

  if (activity.type === "receive_guest") {
    visit.stage = "received";
    visit.hostId = character.id;
    visit.receivedDay = context.day;
    visit.receivedSlot = context.slot.label;
    const wording = visit.kind === "lodging"
      ? `${character.name}从柜台后迎出来，问清${visit.visitorName}要住一晚并等接引，把客房和晚饭的安排逐项说清。`
      : visit.kind === "work_exchange"
        ? `${character.name}招呼${visit.visitorName}到灶前，问清他要以杂务换饭，当面说定今天该做哪一项活。`
        : visit.kind === "delivery"
          ? `${character.name}迎住${visit.visitorName}，先问清药包从哪里来、清单交给谁，没有让送货人只把东西扔在墙边。`
          : `${character.name}上前招呼${visit.visitorName}，问明来意和所要的${offering.label}。`;
    return { ...base, visibleAction: wording, consequence: `${visit.visitorName}的来意已由${character.name}接下，事务进入“已接待”阶段。` };
  }

  if (activity.type === "accept_delivery") {
    visit.stage = "delivery_received";
    visit.deliveryAccepted = true;
    visit.hostId = character.id;
    addLedgerEntry(tavern, {
      type: "delivery",
      day: context.day,
      slot: context.slot.label,
      visitId: visit.id,
      actorId: character.id,
      counterpartyId: visit.visitorId,
      description: `${character.name}按清单验收${visit.visitorName}送来的药包`,
    });
    return {
      ...base,
      visibleAction: `${character.name}当着${visit.visitorName}的面拆开药包、逐项对过清单，验收后才把东西收入柜台内。`,
      consequence: "药包已有验收人和账目来源，不再是墙边来历不明的物品。",
    };
  }

  if (activity.type === "perform_exchange") {
    visit.stage = "work_done";
    visit.workCompletedBy = character.id;
    lifeState.needs = applyNeedDelta(lifeState.needs, { fatigue: 9, autonomy: 2 });
    return {
      ...base,
      targetCharacterId: visit.hostId || visit.expectedHostIds?.[0] || "",
      targetCharacterName: workingCharacters.find((item) => item.id === (visit.hostId || visit.expectedHostIds?.[0]))?.name || "掌柜",
      needDelta: { fatigue: 9, autonomy: 2 },
      visibleAction: `${character.name}按刚才说定的活收齐空碗、筛净冷灶灰，再把工具放回原处等店里验看。`,
      consequence: "以工换饭中的“工”已经完成，下一步应由有权限的人出饭并记账。",
      salience: 66,
    };
  }

  if (activity.type === "serve_guest") {
    const serviceKind = offeringKind(offering, visit.requestedService);
    const canServe = canProvideOffering(tavern, offering, visit.requestedService);
    if (!canServe) {
      visit.stage = "refused";
      visit.outcome = `库存不足，未能提供${offering.label}`;
      return {
        ...base,
        activityType: "refuse_service",
        visibleAction: `${character.name}当面告诉${visit.visitorName}${offering.label}已经出不来，没有用沉默让人继续等。`,
        consequence: visit.outcome,
        salience: 78,
      };
    }
    const resourceDelta = {};
    for (const [stockId, amount] of Object.entries(offeringStockCost(offering, visit.requestedService))) {
      tavern.stock[stockId] = Number(tavern.stock[stockId] || 0) - Number(amount || 0);
      resourceDelta[stockId] = -Number(amount || 0);
    }
    if (["meal", "lodging", "work_meal"].includes(serviceKind)) {
      if (guestState) {
        const mealAppraisal = appraiseOfferingSustenance({
          sustenanceProfile: guest?.lifeProfile?.physiology?.sustenance || {},
          bodyState: { hunger: Number(guestState.needs?.hunger || 0) / 100 },
          offering,
          offeringId: visit.requestedService,
        });
        guestState.needs = applyNeedDelta(guestState.needs, {
          hunger: -34 * mealAppraisal.recoveryEfficiency,
          fatigue: -4 * mealAppraisal.recoveryEfficiency,
        });
      }
      base.resourceDelta = resourceDelta;
    } else if (serviceKind === "tea") {
      if (guestState) guestState.needs = applyNeedDelta(guestState.needs, { fatigue: -9, social: -5 });
      base.resourceDelta = resourceDelta;
    }
    visit.stage = "served";
    visit.servedOffering = offering.label;
    visit.servedBy = character.id;
    return {
      ...base,
      visibleAction: visit.requestedService === "lodging_meal"
        ? `${character.name}把客房钥匙交给${visit.visitorName}，又把${offering.label}中的热饭端到她面前。`
        : `${character.name}把${deliveredLabel}端到${visit.visitorName}面前，送到桌边才算出餐。`,
      consequence: `${deliveredLabel}已由${character.name}交付给${visit.visitorName}，库存发生了真实扣减。`,
    };
  }

  if (activity.type === "perform_visit_business") {
    visit.stage = "business_done";
    visit.businessOutcome = "带来的名录已逐项核完";
    return {
      ...base,
      targetCharacterId: visit.hostId || visit.expectedHostIds?.[0] || "",
      targetCharacterName: workingCharacters.find((item) => item.id === (visit.hostId || visit.expectedHostIds?.[0]))?.name || "店里人",
      visibleAction: `${character.name}把茶碗放在手边，逐页核过带来的名录和酒馆账板旁留下的候选消息，核完才把纸页重新压齐。`,
      consequence: visit.businessOutcome,
      salience: 68,
    };
  }

  if (activity.type === "attempt_secondary_objective") {
    const target = workingCharacters.find((item) => item.id === visit.secondaryTargetId);
    visit.stage = "personal_attempted";
    visit.personalOutcome = target?.lifeState?.present
      ? `${visit.visitorName}已经把请求交到${target.name}面前，答复仍未发生`
      : `${target?.name || "要找的人"}不在堂前，请求尚未交出`;
    return {
      ...base,
      targetCharacterId: target?.id || visit.secondaryTargetId,
      targetCharacterName: target?.name || "要找的人",
      visibleAction: target?.lifeState?.present
        ? `${character.name}吃完饭没有立刻走，走到${target.name}能正面回应的位置，把举荐笺压在两人之间的桌角。`
        : `${character.name}吃完饭仍在堂前找了一圈，没有见到要找的人，只得把举荐笺重新收回袖中。`,
      consequence: visit.personalOutcome,
      socialIntent: target?.lifeState?.present ? {
        kind: "request",
        requestId: `${visit.id}_secondary_objective`,
        topic: visit.secondaryObjective,
        requesterId: visit.visitorId,
        responderId: target.id,
      } : null,
      salience: 76,
    };
  }

  if (activity.type === "settle_visit") {
    const price = Math.max(0, Number(offering.price) || 0);
    let ledgerType = visit.paymentMode === "work_exchange" ? "work_exchange" : "sale";
    let description = "";
    if (visit.paymentMode === "work_exchange") {
      description = `${visit.visitorName}以已完成的堂前杂务抵清这碗热饭`;
    } else if (guestState && guestState.resources.coins >= price) {
      guestState.resources.coins -= price;
      if (guestState.resources.wallet) guestState.resources.wallet.amount = guestState.resources.coins;
      tavern.cashBox += price;
      description = `${visit.visitorName}支付${price}枚铜钱，${character.name}收入钱箱`;
    } else if (agencyFor(character).authority?.grantCredit) {
      ledgerType = "credit";
      description = `${character.name}把${visit.visitorName}欠下的${price}枚铜钱记入赊账`;
    } else {
      visit.stage = "refused";
      visit.outcome = `无法结清${price}枚铜钱且未获准赊账`;
      return {
        ...base,
        activityType: "refuse_service",
        visibleAction: `${character.name}把账板推到${visit.visitorName}面前，明确这笔${price}枚铜钱的账不能含糊带过。`,
        consequence: visit.outcome,
        salience: 78,
      };
    }
    visit.stage = "completed";
    visit.settledBy = character.id;
    visit.outcome = [description, visit.businessOutcome, visit.personalOutcome, visit.completionCondition].filter(Boolean).join("；");
    addLedgerEntry(tavern, {
      type: ledgerType,
      day: context.day,
      slot: context.slot.label,
      visitId: visit.id,
      actorId: character.id,
      counterpartyId: visit.visitorId,
      amount: ledgerType === "sale" ? price : 0,
      description,
    });
    return {
      ...base,
      visibleAction: ledgerType === "work_exchange"
        ? `${character.name}验过${visit.visitorName}做完的杂务，在账板上记下一笔“以工换饭”，把这次交换划清。`
        : ledgerType === "credit"
          ? `${character.name}把${visit.visitorName}的名字和${price}枚铜钱写进赊账，没有混入谢家的家计。`
          : `${character.name}从${visit.visitorName}手里接过${price}枚铜钱，当面点清后收入钱箱。`,
      consequence: visit.outcome,
      resourceDelta: ledgerType === "sale" ? { cashBox: price, coins: -price } : {},
      salience: 74,
    };
  }

  if (activity.type === "wait_for_service") {
    return {
      ...base,
      targetCharacterId: visit.hostId || visit.expectedHostIds?.[0] || "",
      targetCharacterName: workingCharacters.find((item) => item.id === (visit.hostId || visit.expectedHostIds?.[0]))?.name || "负责的人",
      visibleAction: `${character.name}没有去碰柜台后的饭茶，只在不挡路的位置守着自己的${visit.purpose}等回应。`,
      consequence: `这次来访仍停在“${visit.stage}”，尚未满足完成条件。`,
      salience: 48,
    };
  }

  return null;
}

function activityAppraisal(character, activity, lifeState) {
  if (["receive_guest", "accept_delivery", "serve_guest", "settle_visit"].includes(activity.type)) return `${character.name}把来客当成店里必须完成的一件具体事务，而不是房间里多出来的人。`;
  if (["perform_exchange", "wait_for_service"].includes(activity.type)) return `${character.name}按自己进门时说定的来意判断事情是否已经完成。`;
  if (activity.type === "personal") return `${character.name}把这段时间看作自己从安排里抢回的一小块地方。`;
  if (activity.type === "duty" || activity.type === "maintain") return `${character.name}确认眼前的秩序暂时还能维持，但代价是自己的事继续往后。`;
  if (["eat", "drink", "rest"].includes(activity.type)) return `${character.name}承认身体先于体面发出了要求。`;
  if (activity.type === "observe") return `${character.name}注意到关系里的压力，却没有把注意直接变成发问。`;
  return lifeState.appraisal || `${character.name}仍按原来的理解继续。`;
}

function visitSnapshot(visit = {}) {
  if (!visit?.id) return null;
  return {
    visitId: visit.id,
    visitorId: visit.visitorId,
    visitorName: visit.visitorName,
    situationalRole: visit.situationalRole,
    purpose: visit.purpose,
    kind: visit.kind,
    expectedHostIds: [...(visit.expectedHostIds || [])],
    requestedService: visit.requestedService,
    paymentMode: visit.paymentMode,
    completionCondition: visit.completionCondition,
    stage: visit.stage,
    hostId: visit.hostId || "",
    outcome: visit.outcome || "",
  };
}

function archiveVisit(tavern, visit) {
  tavern.activeVisits = (tavern.activeVisits || []).filter((item) => item.id !== visit.id);
  tavern.visits = [...(tavern.visits || []).filter((item) => item.id !== visit.id), deepClone(visit)].slice(-24);
}

function createVisit(character, lifeState, tavern, context) {
  const agency = agencyFor(character);
  const policy = agency.visitPolicy || {};
  const visit = {
    id: createId("tavern_visit"),
    visitorId: character.id,
    visitorName: character.name,
    situationalRole: agency.expression?.roleLabel || agency.standing || "来客",
    purpose: policy.purpose || `${character.name}有一件必须在酒馆办完的事`,
    kind: policy.kind || "visit",
    expectedHostIds: [...(policy.expectedHostIds || [])],
    requestedService: policy.requestedService || "tea",
    paymentMode: policy.paymentMode || "cash",
    completionCondition: policy.completionCondition || "来意得到回应并把账结清",
    secondaryObjective: policy.secondaryObjective || "",
    secondaryTargetId: policy.secondaryTargetId || "",
    stage: "waiting",
    hostId: "",
    servedOffering: "",
    outcome: "",
    arrivedDay: context.day,
    arrivedSlot: context.slot.label,
    arrivedTick: tavern.tick,
  };
  tavern.activeVisits = [...(tavern.activeVisits || []), visit].slice(-6);
  lifeState.activeVisitId = visit.id;
  lifeState.visitPurpose = visit.purpose;
  lifeState.situationalRole = visit.situationalRole;
  return visit;
}

function resolvePresenceEvent(character, lifeState, scheduled, tavern, context) {
  if (character.lifeProfile?.simulationTier !== "visitor") return null;
  const existingVisit = activeVisitById(tavern, lifeState.activeVisitId) || activeVisitForCharacter(tavern, character.id);
  const arriving = scheduled && !lifeState.present;
  const visitResolved = !existingVisit || ["completed", "abandoned", "refused"].includes(existingVisit.stage);
  const departing = !scheduled && lifeState.present && visitResolved;
  if (!arriving && !departing) return null;
  lifeState.present = arriving;
  let visit = existingVisit;
  if (arriving) visit = createVisit(character, lifeState, tavern, context);
  if (departing && visit) {
    if (!visit.outcome) {
      visit.stage = ["completed", "refused"].includes(visit.stage) ? visit.stage : "abandoned";
      visit.outcome = visit.stage === "completed"
        ? `完成：${visit.completionCondition}`
        : visit.stage === "refused"
          ? "酒馆明确拒绝了这次服务"
          : `未完成便离开：${visit.completionCondition}`;
    }
    visit.departedDay = context.day;
    visit.departedSlot = context.slot.label;
    visit.departedTick = tavern.tick;
    archiveVisit(tavern, visit);
  }
  const visitPurpose = visit?.purpose || lifeState.visitPurpose;
  lifeState.currentActivity = {
    type: arriving ? "arrive" : "depart",
    description: arriving ? `带着“${visitPurpose}”的来意进门，先等负责的人招呼` : `在这次来意有了结果后收好东西离店`,
    progress: 100,
    remainingTicks: 0,
  };
  lifeState.lastChoiceReason = arriving ? `在${context.slot.label}来，是为了${visitPurpose}。` : `这次进门的完成条件是：${visit?.completionCondition || "来意得到回应"}。`;
  lifeState.appraisal = arriving ? `${character.name}知道自己是来客，先等东家、掌柜或店伙回应。` : `${character.name}按这次交易或来意的结果离开。`;
  const snapshot = visitSnapshot(visit) || {};
  if (departing) {
    lifeState.activeVisitId = "";
    lifeState.visitPurpose = "";
  }
  return {
    activityType: arriving ? "arrive" : "depart",
    description: lifeState.currentActivity.description,
    reason: lifeState.lastChoiceReason,
    needDelta: {},
    resourceDelta: {},
    appraisal: lifeState.appraisal,
    salience: arriving ? 58 : 52,
    visitId: snapshot.visitId || "",
    visitPurpose: snapshot.purpose || visitPurpose,
    situationalRole: snapshot.situationalRole || lifeState.situationalRole,
    expectedHostIds: snapshot.expectedHostIds || [],
    requestedService: snapshot.requestedService || "",
    paymentMode: snapshot.paymentMode || "",
    completionCondition: snapshot.completionCondition || "",
    visitOutcome: departing ? snapshot.outcome || visit?.outcome || "" : "",
  };
}

function worldPressureFor(day, slotIndex, tavern, injectedEvent = "") {
  const injected = String(injectedEvent || "").trim();
  if (slotIndex === 0 && injected) {
    const bounded = injected.slice(0, 180);
    tavern.externalPressure = bounded;
    return {
      type: "injected-pressure",
      description: `门外有人带来一条尚未核实的说法：“${bounded}”`,
      consequence: "这句话只改变屋里的人对风险的估计；它不是事实，也没有替任何人决定结果",
      salience: 72,
      canonicalTruth: false,
    };
  }
  if (slotIndex !== (day + 1) % DAY_SLOTS.length) return null;
  const cycle = day % 4;
  if (cycle === 1) {
    tavern.weather = "细雨";
    tavern.stock.firewood = Math.max(0, tavern.stock.firewood - 2);
    return { type: "weather", description: "细雨把门口和新送到的柴都打湿了", consequence: "可用柴薪少了两束，进门的人更不愿立刻离开", salience: 58 };
  }
  if (cycle === 2) {
    tavern.stock.grain = Math.max(0, tavern.stock.grain - 3);
    tavern.pricePressure = Math.min(20, tavern.pricePressure + 3);
    return { type: "supply", description: "午前送来的米袋比账上少了一截", consequence: "可用生米少了三份，接下来能出的热饭和下一次进货价都受影响", salience: 70 };
  }
  if (cycle === 3) {
    return { type: "news", description: "剑阁方向的钟声比平常早了一刻", consequence: "原本缓慢的客流忽然改了去向，但没人知道结果", salience: 62 };
  }
  tavern.stock.tea = Math.max(0, tavern.stock.tea - 2);
  return { type: "delivery", description: "茶商只留下半包旧茶便匆匆去追云梯榜的消息", consequence: "茶叶少了两份，账板上多出一笔待核的差额", salience: 66 };
}

function buildInterpretiveMemory(character, pressure, day, slot) {
  return {
    id: createId("life_memory"),
    characterId: character.id,
    branchId: "branch_main",
    type: "interpreted-event",
    createdAt: new Date().toISOString(),
    day,
    content: `${slot.label}，${pressure.description}；${pressure.consequence}。`,
    event: pressure.description,
    interpretation: pressure.type === "supply"
      ? `${character.name}把短缺理解为下一顿饭会逼人暴露谁有余钱、谁在赊账。`
      : `${character.name}把这次变化理解为原有日程不再完全可靠。`,
    confidence: pressure.type === "news" ? 46 : 78,
    salience: pressure.salience,
    retrievalCue: `${pressure.type}:${TAVERN_LOCATION_ID}`,
  };
}

function relationPressure(relationship = {}) {
  return (
    Number(relationship.resentment || 0)
    + Number(relationship.dependence || 0)
    + Number(relationship.wantsToBeSeen || 0)
    + Number(relationship.shame || 0)
  ) / 4;
}

function bestPresentRelationship(state, characterId, presentIds = []) {
  return (state.relationships || [])
    .filter((relationship) => (
      (relationship.fromCharacterId === characterId && presentIds.includes(relationship.toCharacterId))
      || (relationship.toCharacterId === characterId && presentIds.includes(relationship.fromCharacterId))
    ))
    .map((relationship) => ({
      relationship,
      targetCharacterId: relationship.fromCharacterId === characterId ? relationship.toCharacterId : relationship.fromCharacterId,
      pressure: relationPressure(relationship),
    }))
    .sort((a, b) => b.pressure - a.pressure)[0] || null;
}

function socialMemory({ owner, target, request, outcome, day, slot }) {
  return {
    id: createId("life_memory"),
    characterId: owner.id,
    targetCharacterId: target.id,
    branchId: "branch_main",
    type: "interpreted-event",
    createdAt: new Date().toISOString(),
    day,
    content: `${slot.label}，${request.requesterName}把“${request.topic}”摆到${request.targetName}面前；${outcome}。`,
    event: `${request.requesterName}提出请求，${request.targetName}没有照做`,
    interpretation: `${owner.name}把这次拒绝理解为：这段关系不能再靠含糊和惯性维持原样。`,
    confidence: 82,
    salience: 76,
    retrievalCue: `refusal:${request.requesterId}:${request.targetId}`,
  };
}

function socialRelationshipShift(request, activityType) {
  if (activityType === "request") {
    return {
      fromCharacterId: request.requesterId,
      toCharacterId: request.targetId,
      deltas: { wantsToBeSeen: 2, resentment: 1, dependence: 1 },
      misreading: `${request.requesterName}开始怀疑${request.targetName}会不会继续用拖延代替回答。`,
      unspoken: request.topic,
      generatedFrom: "tavern-life-social-choice",
    };
  }
  return {
    fromCharacterId: request.requesterId,
    toCharacterId: request.targetId,
    deltas: { resentment: 2, dependence: -2, wantsToEscape: 1 },
    misreading: `${request.requesterName}把${request.targetName}的拒绝理解成关系中旧有位置仍比自己的请求重要。`,
    unspoken: `${request.targetName}拒绝的不是所有关系，而是这一次被安排的行动。`,
    generatedFrom: "tavern-life-social-choice",
  };
}

function resolveSocialConsequence(state, workingCharacters, tavern, { day, slotIndex, slot, settledSocialRequestIds = [] }, memories, relationshipShifts) {
  tavern.pendingRequests = Array.isArray(tavern.pendingRequests) ? tavern.pendingRequests.slice(-4) : [];
  const settledIds = new Set(settledSocialRequestIds || []);
  tavern.pendingRequests = tavern.pendingRequests.filter((request) => !settledIds.has(request.id));
  const present = workingCharacters.filter((character) => character.lifeState?.present);
  const presentIds = present.map((character) => character.id);
  const pending = tavern.pendingRequests.find((request) => request.createdTick < tavern.tick && presentIds.includes(request.targetId));
  if (pending) {
    const target = present.find((character) => character.id === pending.targetId);
    const requester = workingCharacters.find((character) => character.id === pending.requesterId);
    if (!target || !requester) return null;
    tavern.pendingRequests = tavern.pendingRequests.filter((request) => request.id !== pending.id);
    target.lifeState.needs = applyNeedDelta(target.lifeState.needs, { autonomy: -12, social: 4 });
    target.lifeState.appraisal = `${target.name}把边界放在维持表面和气之前。`;
    const outcome = `${target.name}没有按请求行动，也没有让沉默替自己算作答应`;
    const event = {
      id: createId("life_social_event"),
      characterId: target.id,
      characterName: target.name,
      targetCharacterId: requester.id,
      targetCharacterName: requester.name,
      activityType: "refuse",
      description: `${target.name}停下片刻，明确不照${requester.name}提出的方式行动，随后回到自己的事上`,
      visibleAction: `${target.name}停下手里的动作，正面看了${requester.name}一眼，没有照请求去做，随后把手重新放回原来的事上。`,
      reason: target.lifeProfile?.refusal || "这次请求越过了自己不能交出去的边界。",
      needDelta: { autonomy: -12, social: 4 },
      resourceDelta: {},
      appraisal: target.lifeState.appraisal,
      salience: 76,
      socialIntent: { kind: "refusal", requestId: pending.id, topic: pending.topic, requesterId: requester.id, responderId: target.id },
    };
    relationshipShifts.push(socialRelationshipShift(pending, "refuse"));
    memories.push(socialMemory({ owner: requester, target, request: pending, outcome, day, slot }));
    return event;
  }

  if (slotIndex !== (day + 1) % DAY_SLOTS.length || tavern.pendingRequests.length >= 4) return null;
  const candidates = present
    .map((character) => {
      const privatePursuit = character.lifeProfile?.privatePursuit || character.lifeState?.hiddenAgenda || "";
      const namedTarget = present.find((other) => other.id !== character.id && privatePursuit.includes(other.name));
      return {
        character,
        relation: namedTarget
          ? { targetCharacterId: namedTarget.id, pressure: 100, generatedFrom: "named-agent-objective" }
          : bestPresentRelationship(state, character.id, presentIds),
        score: Number(character.lifeState?.needs?.autonomy || 0)
          + Number(character.lifeState?.needs?.social || 0)
          + (character.lifeProfile?.simulationTier === "core" ? 16 : 0)
          + (namedTarget ? 40 : 0)
          + stableJitter(`${day}:${character.id}:social-request`, 17),
      };
    })
    .filter((candidate) => candidate.relation?.targetCharacterId)
    .sort((a, b) => b.score - a.score);
  const chosen = candidates[0];
  if (!chosen) return null;
  const requester = chosen.character;
  const target = present.find((character) => character.id === chosen.relation.targetCharacterId);
  if (!target) return null;
  const topic = requester.lifeProfile?.privatePursuit || requester.lifeState?.hiddenAgenda || requester.lifeState?.activeGoal || "一件迟迟没有回答的事";
  const request = {
    id: `tavern_request_${day}_${slot.id}_${requester.id}_${target.id}`,
    requesterId: requester.id,
    requesterName: requester.name,
    targetId: target.id,
    targetName: target.name,
    topic,
    createdDay: day,
    createdSlot: slot.label,
    createdTick: tavern.tick,
  };
  tavern.pendingRequests.push(request);
  requester.lifeState.needs = applyNeedDelta(requester.lifeState.needs, { social: -10, autonomy: -8, safety: 4 });
  requester.lifeState.appraisal = `${requester.name}不再把这件事只留在自己的安排里，关系因此有了被拒绝的风险。`;
  relationshipShifts.push(socialRelationshipShift(request, "request"));
  return {
    id: createId("life_social_event"),
    characterId: requester.id,
    characterName: requester.name,
    targetCharacterId: target.id,
    targetCharacterName: target.name,
    activityType: "request",
    description: `${requester.name}停下手里的事，把关于“${topic}”的请求明确交给${target.name}`,
    visibleAction: `${requester.name}停下手里的事，走到${target.name}能正面回应的位置，没有再用杂务把请求绕过去。`,
    reason: `私下目标已经积累到值得承担被拒绝的风险：${topic}`,
    needDelta: { social: -10, autonomy: -8, safety: 4 },
    resourceDelta: {},
    appraisal: requester.lifeState.appraisal,
    salience: 70,
    socialIntent: { kind: "request", requestId: request.id, topic, requesterId: requester.id, responderId: target.id },
  };
}

function visibleActionFor(character, activity) {
  if (activity.visibleAction) return activity.visibleAction;
  if (activity.activityType === "arrive") return `${character.name}作为${activity.situationalRole || "来客"}推门进来，为了${activity.visitPurpose || "一件具体来意"}等东家、掌柜或店伙招呼。`;
  if (activity.activityType === "depart") return `${character.name}带着“${activity.visitOutcome || "这次来意尚未完成"}”的结果收好东西，从望梯酒馆离开。`;
  return `${character.name}${activity.description.replace(/^把|^在|^坐到|^退到|^倒/, (prefix) => prefix === "把" ? "把" : prefix)}。`;
}

function lifeEventFromPresence(character, lifeState, presenceEvent, context) {
  const opportunityId = decisionOpportunityId(context.day, context.slot.id, character.id);
  return {
    id: createId("life_event"),
    characterId: character.id,
    characterName: character.name,
    ...presenceEvent,
    perceivedVisit: presenceEvent.visitId ? visitSnapshot(activeVisitById(context.tavern, presenceEvent.visitId)) : null,
    visibleAction: visibleActionFor(character, presenceEvent),
    present: lifeState.present,
    decisionSource: "deterministic-kernel",
    decisionOpportunity: {
      id: opportunityId,
      day: context.day,
      slotId: context.slot.id,
      slotLabel: context.slot.label,
      characterId: character.id,
      defaultActionType: presenceEvent.activityType,
      candidateActions: [publicCandidate({ type: presenceEvent.activityType, description: presenceEvent.description, reason: presenceEvent.reason, score: 300 })],
    },
  };
}

function resolveCharacterEvent(state, character, workingCharacter, workingCharacters, tavern, context, presentIds) {
  const profile = character.lifeProfile || {};
  const lifeState = workingCharacter.lifeState;
  if (!context.needsAlreadyDrifted) lifeState.needs = driftNeeds(lifeState.needs, lifeState, profile);
  if (!context.presenceAlreadyResolved) {
    const scheduled = isScheduled(profile, context.slot.label, context.day);
    const presenceEvent = resolvePresenceEvent(character, lifeState, scheduled, tavern, context);
    if (presenceEvent) return lifeEventFromPresence(character, lifeState, presenceEvent, { ...context, tavern });
  }
  if (!lifeState.present) return null;
  const relationshipPressure = characterRelationshipPressure(state, character.id, presentIds);
  const candidates = activityCandidates(character, lifeState, tavern, { ...context, relationshipPressure });
  const opportunityId = decisionOpportunityId(context.day, context.slot.id, character.id);
  const decisionOverride = context.decisionOverrides?.[opportunityId] || null;
  const candidate = selectCandidate(character, candidates, context, decisionOverride);
  const perceivedVisit = candidate.visitId ? visitSnapshot(activeVisitById(tavern, candidate.visitId)) : null;
  const hospitality = candidate.visitId
    ? hospitalityEffects(candidate, character, lifeState, workingCharacters, tavern, context)
    : null;
  const effects = hospitality || activityEffects(candidate, character, lifeState, tavern);
  const continuedSame = candidate.continued || candidate.description === lifeState.currentActivity?.description;
  lifeState.currentActivity = {
    type: effects.activityType || candidate.type,
    description: candidate.description,
    progress: candidate.duration > 0 ? 50 : 100,
    remainingTicks: candidate.duration,
  };
  lifeState.consecutiveActivityTicks = continuedSame ? lifeState.consecutiveActivityTicks + 1 : 1;
  lifeState.lastChoiceReason = candidate.reason;
  lifeState.appraisal = activityAppraisal(character, { ...candidate, type: effects.activityType || candidate.type }, lifeState);
  return {
    id: createId("life_event"),
    characterId: character.id,
    characterName: character.name,
    activityType: effects.activityType || candidate.type,
    description: candidate.description,
    reason: candidate.reason,
    visibleAction: visibleActionFor(character, { ...candidate, ...effects, activityType: effects.activityType || candidate.type }),
    needDelta: effects.needDelta,
    resourceDelta: effects.resourceDelta,
    appraisal: lifeState.appraisal,
    salience: effects.salience || (["personal", "duty"].includes(candidate.type) ? 44 : 30),
    present: true,
    targetCharacterId: effects.targetCharacterId || "",
    targetCharacterName: effects.targetCharacterName || "",
    visitId: effects.visitId || candidate.visitId || "",
    perceivedVisit,
    visitPurpose: effects.visitPurpose || "",
    situationalRole: effects.situationalRole || lifeState.situationalRole,
    expectedHostIds: effects.expectedHostIds || [],
    requestedService: effects.requestedService || "",
    paymentMode: effects.paymentMode || "",
    completionCondition: effects.completionCondition || "",
    consequence: effects.consequence || "",
    socialIntent: effects.socialIntent || null,
    decisionSource: candidate.decisionSource,
    modelDecisionReason: candidate.modelDecisionReason,
    decisionOpportunity: {
      id: opportunityId,
      day: context.day,
      slotId: context.slot.id,
      slotLabel: context.slot.label,
      characterId: character.id,
      defaultActionType: selectCandidate(character, candidates, context).type,
      candidateActions: candidates.map(publicCandidate),
    },
  };
}

function contextItem(id, content, options = {}) {
  return {
    id,
    sourceKind: options.sourceKind || "runtime",
    scope: options.scope || "agent",
    priority: Number(options.priority || 50),
    protected: Boolean(options.protected),
    inclusionReason: options.inclusionReason || "与当前决定直接相关",
    content,
  };
}

function relevantVisitForAgent(character, event, tavern) {
  if (event.visitId) return activeVisitById(tavern, event.visitId)
    || (tavern.visits || []).find((visit) => visit.id === event.visitId)
    || null;
  if (character.lifeProfile?.simulationTier === "visitor") return activeVisitForCharacter(tavern, character.id);
  return (tavern.activeVisits || []).find((visit) => (
    visit.hostId === character.id || (visit.expectedHostIds || []).includes(character.id)
  )) || null;
}

function buildAgentContextManifest(character, event, tavern) {
  const agency = agencyFor(character);
  const visit = event.perceivedVisit || relevantVisitForAgent(character, event, tavern);
  const items = [
    contextItem("agent.identity", `${character.name}此刻在望梯酒馆的身份是“${agency.expression?.roleLabel || agency.standing || "在场者"}”；${agency.placeRelationship || "与酒馆有明确关系"}`, {
      sourceKind: "agent-contract",
      priority: 100,
      protected: true,
      inclusionReason: "身份决定能做什么，也决定不能替谁作主",
    }),
    contextItem("agent.responsibilities", (agency.responsibilities || []).join("；") || "没有店内职责", {
      sourceKind: "agent-contract",
      priority: 96,
      protected: true,
      inclusionReason: "职责是行动候选的首要来源",
    }),
    contextItem("agent.authority", JSON.stringify(agency.authority || {}), {
      sourceKind: "agent-contract",
      priority: 98,
      protected: true,
      inclusionReason: "防止来客自行取货或无权限者替掌柜结账",
    }),
    contextItem("agent.knowledge-boundary", `可知：${(agency.knowledgeBoundary?.publicFacts || []).join("；")}；私有限制：${(agency.knowledgeBoundary?.privateFacts || []).join("；")}`, {
      sourceKind: "agent-contract",
      priority: 94,
      protected: true,
      inclusionReason: "当前 Agent 不能读取别人的完整角色卡和私密心理",
    }),
    contextItem("agent.current-obligation", event.reason || character.lifeState?.lastChoiceReason || "沿当前职责继续", {
      sourceKind: "canonical-runtime",
      priority: 99,
      protected: true,
      inclusionReason: "这是本轮已决行动的直接原因",
    }),
  ];
  if (visit) {
    const visitContext = visit.visitId ? visit : visitSnapshot(visit);
    items.push(contextItem("scene.active-visit", JSON.stringify(visitContext), {
      sourceKind: "visit-contract",
      scope: "visit",
      priority: 100,
      protected: true,
      inclusionReason: "来意、接待人、服务、结算和完成条件必须连续",
    }));
  }
  return {
    schemaVersion: 1,
    targetAgentId: character.id,
    compositionMode: "agent-swap",
    forbidCrossAgentPrivateContext: true,
    items,
  };
}

function tickNarrative(slot, lifeEvents, pressure, tavern) {
  const characterEvents = lifeEvents.filter((event) => event.characterId);
  const selected = characterEvents
    .slice()
    .sort((a, b) => Number(b.salience || 0) - Number(a.salience || 0))
    .slice(0, 4)
    .sort((a, b) => characterEvents.indexOf(a) - characterEvents.indexOf(b));
  const actions = selected.map((event) => event.visibleAction.replace(/[。]+$/g, ""));
  const pressureLine = pressure ? `${pressure.description}，${pressure.consequence}` : "门外的脚步照常经过，没有一件事强迫所有人停下";
  const institutionLine = tavern.tick === 1
    ? `${tavern.institution?.name || "望梯酒馆"}是${tavern.institution?.householdName || "谢家"}的生计：谢恒是东家，谢母是掌柜兼掌灶，谢真石在店里担柴水和堂前杂务。`
    : "";
  return `${institutionLine}${slot.label}，${pressureLine}。${actions.join("；")}。`;
}

function buildTick(state, workingCharacters, tavern, day, slot, slotIndex, memories, relationshipShifts, options = {}) {
  tavern.open = (tavern.institution?.publicHours || []).includes(slot.label);
  const pressure = worldPressureFor(day, slotIndex, tavern, state.ui?.injectedEvent || "");
  if (pressure) {
    tavern.recentMicroEvents.push({ day, slot: slot.label, ...pressure });
    tavern.recentMicroEvents = tavern.recentMicroEvents.slice(-12);
    if (pressure.type === "injected-pressure") {
      for (const character of workingCharacters.filter((item) => item.lifeState?.present)) {
        character.lifeState.needs = applyNeedDelta(character.lifeState.needs, { safety: 8, autonomy: 3 });
      }
    }
  }
  const lifeEvents = [];
  const presenceCharacterIds = new Set();
  for (const sourceCharacter of state.characters || []) {
    const workingCharacter = workingCharacters.find((character) => character.id === sourceCharacter.id);
    if (!workingCharacter?.lifeProfile) continue;
    workingCharacter.lifeState.needs = driftNeeds(
      workingCharacter.lifeState.needs,
      workingCharacter.lifeState,
      sourceCharacter.lifeProfile || {},
    );
    const scheduled = isScheduled(sourceCharacter.lifeProfile || {}, slot.label, day);
    const presenceEvent = resolvePresenceEvent(sourceCharacter, workingCharacter.lifeState, scheduled, tavern, { day, slotIndex, slot });
    if (!presenceEvent) continue;
    presenceCharacterIds.add(sourceCharacter.id);
    lifeEvents.push(lifeEventFromPresence(sourceCharacter, workingCharacter.lifeState, presenceEvent, { day, slotIndex, slot, tavern }));
  }
  const presentIds = workingCharacters.filter((character) => character.lifeState.present).map((character) => character.id);
  for (const sourceCharacter of state.characters || []) {
    const workingCharacter = workingCharacters.find((character) => character.id === sourceCharacter.id);
    if (!workingCharacter?.lifeProfile || presenceCharacterIds.has(sourceCharacter.id)) continue;
    const event = resolveCharacterEvent(state, sourceCharacter, workingCharacter, workingCharacters, tavern, {
      day,
      slotIndex,
      slot,
      needsAlreadyDrifted: true,
      presenceAlreadyResolved: true,
      decisionOverrides: options.decisionOverrides || {},
    }, presentIds);
    if (event) lifeEvents.push(event);
  }
  const socialEvent = resolveSocialConsequence(state, workingCharacters, tavern, {
    day,
    slotIndex,
    slot,
    settledSocialRequestIds: options.settledSocialRequestIds || [],
  }, memories, relationshipShifts);
  if (socialEvent) {
    const socialOpportunityId = `${decisionOpportunityId(day, slot.id, socialEvent.characterId)}:social:${socialEvent.activityType}`;
    socialEvent.present = true;
    socialEvent.decisionSource = "deterministic-kernel";
    socialEvent.decisionOpportunity = {
      id: socialOpportunityId,
      day,
      slotId: slot.id,
      slotLabel: slot.label,
      characterId: socialEvent.characterId,
      defaultActionType: socialEvent.activityType,
      candidateActions: [publicCandidate({
        type: socialEvent.activityType,
        description: socialEvent.description,
        reason: socialEvent.reason,
        score: Number(socialEvent.salience || 70) + 220,
      })],
    };
    lifeEvents.push(socialEvent);
  }
  if (pressure) {
    lifeEvents.unshift({
      id: createId("world_event"),
      characterId: null,
      characterName: "",
      activityType: "world",
      pressureType: pressure.type,
      canonicalTruth: pressure.canonicalTruth !== false,
      description: pressure.description,
      visibleAction: pressure.description,
      reason: "世界只改变条件，不替任何人选择。",
      consequence: pressure.consequence,
      appraisal: "同一变化会被不同的人解释成不同的风险。",
      salience: pressure.salience,
    });
    if (pressure.salience >= 65) {
      const witness = workingCharacters.find((character) => character.lifeProfile?.simulationTier === "core" && character.lifeState.present);
      if (witness) memories.push(buildInterpretiveMemory(witness, pressure, day, slot));
    }
  }
  tavern.tick += 1;
  tavern.lastActivities = lifeEvents.filter((event) => event.characterId).slice(-12).map((event) => ({
    day,
    slot: slot.label,
    characterId: event.characterId,
    activityType: event.activityType,
    description: event.description,
  }));
  const agentOutputs = lifeEvents.filter((event) => event.characterId).map((event) => {
    const person = workingCharacters.find((character) => character.id === event.characterId) || {};
    const agency = agencyFor(person);
    const perceivedVisit = event.perceivedVisit || visitSnapshot(relevantVisitForAgent(person, event, tavern));
    return {
      characterId: event.characterId,
      characterName: event.characterName,
      visibleAction: event.visibleAction,
      chosenAction: event.description,
      actionType: event.activityType,
      present: event.present !== false,
      privateReason: event.reason,
      appraisal: event.appraisal,
      locationId: TAVERN_LOCATION_ID,
      situationalRole: event.situationalRole || person.lifeState?.situationalRole || agency.expression?.roleLabel || agency.standing || "在场者",
      agency: deepClone(agency),
      knowledgeBoundary: deepClone(agency.knowledgeBoundary || {}),
      perceivedVisit: deepClone(perceivedVisit),
      targetCharacterId: event.targetCharacterId || perceivedVisit?.visitorId || "",
      targetCharacterName: event.targetCharacterName || perceivedVisit?.visitorName || "",
      socialIntent: deepClone(event.socialIntent || null),
      contextManifest: buildAgentContextManifest(person, event, tavern),
      decisionOpportunity: deepClone(event.decisionOpportunity || null),
      decisionSource: event.decisionSource || "deterministic-kernel",
      modelDecisionReason: event.modelDecisionReason || "",
    };
  });
  const privateSimulations = lifeEvents.filter((event) => event.characterId).map((event) => {
    const person = workingCharacters.find((character) => character.id === event.characterId);
    return {
      characterId: event.characterId,
      characterName: event.characterName,
      currentActivity: person?.lifeState.currentActivity,
      currentNeeds: person?.lifeState.needs,
      activeGoal: person?.lifeState.activeGoal,
      hiddenAgenda: person?.lifeState.hiddenAgenda,
      appraisal: event.appraisal,
      reactionIntent: "continue",
      conversationObjective: "",
      situationalRole: person?.lifeState?.situationalRole || person?.lifeProfile?.tavernAgency?.expression?.roleLabel || "在场者",
      perceivedVisit: deepClone(event.perceivedVisit || visitSnapshot(relevantVisitForAgent(person || {}, event, tavern))),
      contextManifest: buildAgentContextManifest(person || {}, event, tavern),
    };
  });
  const sceneText = tickNarrative(slot, lifeEvents, pressure, tavern);
  const sceneInteraction = {
    locationId: TAVERN_LOCATION_ID,
    agentExchanges: [],
    socialIntents: lifeEvents.map((event) => event.socialIntent).filter(Boolean),
    concreteOutcome: lifeEvents.map((event) => event.consequence || event.description).slice(0, 4).join("；"),
    directorAuthoredOutcome: false,
  };
  return {
    id: createId("tavern_tick"),
    slotId: slot.id,
    order: slotIndex + 1,
    label: slot.label,
    slotFocus: slot.focus,
    executionMode: "deterministic-life-kernel",
    resolution: "lived-activity",
    precision: "life",
    locationId: TAVERN_LOCATION_ID,
    locationName: "望梯酒馆",
    participantIds: agentOutputs.map((output) => output.characterId),
    decisionOpportunities: lifeEvents.map((event) => event.decisionOpportunity).filter(Boolean).map(deepClone),
    lifeEvents,
    privateSimulations,
    agentOutputs,
    sceneInteraction,
    surfaceEvent: sceneInteraction.concreteOutcome,
    sceneText,
    novelText: sceneText,
    visibilityLayer: { publicActions: agentOutputs.map((output) => output.visibleAction), hiddenFieldsExcluded: true },
    simulationTick: {
      id: createId("simulation_tick"),
      locationId: TAVERN_LOCATION_ID,
      participantIds: agentOutputs.map((output) => output.characterId),
      privateSimulations,
      visibilityLayer: { publicActions: agentOutputs.map((output) => output.visibleAction) },
      sceneInteraction,
    },
    synthesized: { surfaceEvent: sceneInteraction.concreteOutcome, sceneText, relationshipShift: [], irreversibleTraces: [] },
  };
}

export function isTavernLifeState(state = {}) {
  return Number(state.worldSetup?.tavernLifeVersion) >= 1
    || (state.worldSetup?.worldDossier?.worldId === "xiaoyaoyou" && state.locations?.some((location) => location.id === TAVERN_LOCATION_ID));
}

function detectNarrativeSignals(ticks = []) {
  const signals = [];
  for (const tick of ticks) {
    for (const event of tick.lifeEvents || []) {
      let type = "";
      let whyInteresting = "";
      if (event.activityType === "refuse") {
        type = "boundary";
        whyInteresting = "一个稳定边界第一次变成了可见行动，并会改变关系的下一步。";
      } else if (event.activityType === "request") {
        type = "desire-risk";
        whyInteresting = "私下目标离开内心，开始承担被拒绝的风险。";
      } else if (["accept_delivery", "serve_guest", "settle_visit", "refuse_service"].includes(event.activityType)) {
        type = "hospitality-consequence";
        whyInteresting = "人物的场所职责已经落到一次有对象、有存量、有账目的真实事务。";
      } else if (event.activityType === "world" && Number(event.salience || 0) >= 60) {
        type = "world-pressure";
        whyInteresting = "外界条件发生变化，但人物尚未给出同一种解释。";
      }
      if (!type) continue;
      signals.push({
        id: createId("narrative_signal"),
        type,
        sourceEventId: event.id,
        day: tick.day,
        periodLabel: tick.label,
        characterId: event.characterId || null,
        targetCharacterId: event.targetCharacterId || null,
        description: event.consequence || event.description,
        whyInteresting,
      });
    }
  }
  return signals.slice(-12);
}

export function playTavernLifeNext(inputState = {}, options = {}) {
  const state = deepClone(inputState);
  const defaults = initialTavernState();
  const tavern = {
    ...defaults,
    ...(state.tavernState || {}),
    schemaVersion: 2,
    stock: { ...defaults.stock, ...(state.tavernState?.stock || {}) },
    institution: { ...defaults.institution, ...(state.tavernState?.institution || {}) },
    activeVisits: Array.isArray(state.tavernState?.activeVisits) ? deepClone(state.tavernState.activeVisits).slice(-6) : [],
    visits: Array.isArray(state.tavernState?.visits) ? deepClone(state.tavernState.visits).slice(-24) : [],
    ledger: Array.isArray(state.tavernState?.ledger) ? deepClone(state.tavernState.ledger).slice(-48) : [],
    eventThreads: Array.isArray(state.tavernState?.eventThreads) ? deepClone(state.tavernState.eventThreads).slice(-12) : [],
  };
  const workingCharacters = (state.characters || []).map((character) => ({
    ...deepClone(character),
    lifeState: normalizedLifeState(character),
  }));
  const memories = [];
  const relationshipShifts = [];
  const ticks = [];
  const grain = state.ui?.timeGrain || "day";
  if (grain === "scene" || grain === "beat") {
    const slotIndex = tavern.tick % DAY_SLOTS.length;
    const day = tavern.day + 1;
    const tick = buildTick(state, workingCharacters, tavern, day, DAY_SLOTS[slotIndex], slotIndex, memories, relationshipShifts, options);
    tick.day = day;
    tick.order = 1;
    ticks.push(tick);
    if (slotIndex === DAY_SLOTS.length - 1) tavern.day = day;
  } else {
    const dayCount = grain === "week" ? 7 : 1;
    for (let dayOffset = 0; dayOffset < dayCount; dayOffset += 1) {
      const day = tavern.day + dayOffset + 1;
      for (const [slotIndex, slot] of DAY_SLOTS.entries()) {
        const tick = buildTick(state, workingCharacters, tavern, day, slot, slotIndex, memories, relationshipShifts, options);
        tick.day = day;
        tick.order = ticks.length + 1;
        if (dayCount > 1) {
          tick.label = `第${dayOffset + 1}日·${slot.label}`;
          tick.sceneText = `第${dayOffset + 1}日，${tick.sceneText}`;
          tick.novelText = tick.sceneText;
          tick.synthesized = { ...(tick.synthesized || {}), sceneText: tick.sceneText };
        }
        ticks.push(tick);
      }
    }
    tavern.day += dayCount;
  }
  const participantIds = [...new Set(ticks.flatMap((tick) => tick.participantIds))];
  const agentOutputs = ticks.flatMap((tick) => tick.agentOutputs.map((output) => ({ ...output, periodLabel: tick.label })));
  const privateSimulations = ticks.flatMap((tick) => tick.privateSimulations.map((simulation) => ({ ...simulation, periodLabel: tick.label })));
  const novelText = ticks.map((tick) => tick.novelText).filter(Boolean).join("\n\n");
  const narrativeSignals = detectNarrativeSignals(ticks);
  const sceneInteraction = {
    locationId: TAVERN_LOCATION_ID,
    agentExchanges: [],
    concreteOutcome: `望梯酒馆完成了${ticks.length}个时段的开门、吃饭、做工、等待与离场。`,
    directorAuthoredOutcome: false,
  };
  const updateBundle = {
    tavernState: deepClone(tavern),
    characters: workingCharacters.map((character) => ({
      id: character.id,
      currentLocationId: TAVERN_LOCATION_ID,
      currentActivity: deepClone(character.lifeState.currentActivity),
      lifeState: deepClone(character.lifeState),
    })),
    characterMemories: memories,
    relationships: relationshipShifts,
    lifeEvents: ticks.flatMap((tick) => tick.lifeEvents),
    stateChangeReasons: ticks.flatMap((tick) => tick.lifeEvents.filter((event) => event.characterId).map((event) => `${tick.label} / ${event.characterName}：${event.description}`)).slice(-36),
    consumedInjectedEvent: Boolean(String(state.ui?.injectedEvent || "").trim()),
  };
  const pipelineMeta = {
    mode: "tavern-life-period",
    pipelineMode: "deterministic",
    provider: "deterministic-kernel",
    model: "deterministic-tavern-life-kernel",
    pipeline: "TavernLifeKernel→ConsequenceLedger→NarrativeDetector",
    stages: [{ name: "TavernLifeKernel", provider: "deterministic-kernel", elapsedMs: 0 }],
    repaired: false,
    elapsedMs: 0,
  };
  const simulationTick = {
    id: createId("tavern_period_tick"),
    locationId: TAVERN_LOCATION_ID,
    participantIds,
    privateSimulations,
    visibilityLayer: { publicActions: agentOutputs.map((output) => output.visibleAction), hiddenFieldsExcluded: true },
    sceneInteraction,
  };
  const draft = {
    id: createId("draft"),
    projectId: state.project?.id,
    branchId: state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main",
    createdAt: new Date().toISOString(),
    provider: "deterministic-tavern-life",
    timeGrain: state.ui?.timeGrain || "day",
    locationId: TAVERN_LOCATION_ID,
    participantIds,
    userDirective: state.ui?.userDirective || "",
    injectedEvent: state.ui?.injectedEvent || "",
    simulationMode: "tavern-life-kernel",
    simulationTick,
    visibilityLayer: simulationTick.visibilityLayer,
    privateSimulations,
    sceneInteraction,
    agentOutputs,
    surfaceEvent: sceneInteraction.concreteOutcome,
    sceneText: novelText,
    novelText,
    subtextMatrix: [],
    relationshipShift: [],
    irreversibleTraces: memories.map((memory) => memory.content),
    narrativeSignals,
    periodSimulation: {
      id: createId("tavern_period"),
      duration: state.ui?.timeGrain || "day",
      focus: { mode: "location", locationId: TAVERN_LOCATION_ID, locationName: "望梯酒馆" },
      tickCount: ticks.length,
      startedAt: new Date().toISOString(),
      locationIds: [TAVERN_LOCATION_ID],
      participantIds,
      narrativeSignals,
      ticks,
    },
    pipelineMeta,
    engineMeta: pipelineMeta,
    updateBundle,
  };
  draft.audit = auditDraft(draft, state);
  return draft;
}

export function applyTavernLifeBundle(inputState = {}, bundle = {}) {
  const next = deepClone(inputState);
  if (bundle.tavernState) next.tavernState = deepClone(bundle.tavernState);
  const patches = new Map((bundle.characters || []).map((patch) => [patch.id, patch]));
  next.characters = (next.characters || []).map((character) => {
    const patch = patches.get(character.id);
    if (!patch) return character;
    return {
      ...character,
      currentLocationId: patch.currentLocationId || character.currentLocationId || TAVERN_LOCATION_ID,
      currentActivity: deepClone(patch.currentActivity || character.currentActivity),
      lifeState: { ...(character.lifeState || {}), ...(deepClone(patch.lifeState) || {}) },
    };
  });
  for (const shift of bundle.relationships || []) {
    const relationship = (next.relationships || []).find((item) => item.fromCharacterId === shift.fromCharacterId && item.toCharacterId === shift.toCharacterId);
    if (!relationship) continue;
    for (const [key, delta] of Object.entries(shift.deltas || {})) {
      if (typeof relationship[key] === "number") relationship[key] = Math.max(0, Math.min(100, relationship[key] + Number(delta || 0)));
    }
    if (shift.misreading) relationship.misreading = shift.misreading;
    if (shift.unspoken) relationship.unspoken = shift.unspoken;
  }
  const memoryById = new Map();
  for (const memory of [...(next.characterMemories || []), ...(bundle.characterMemories || [])]) {
    if (memory?.id) memoryById.set(memory.id, memory);
  }
  next.characterMemories = [...memoryById.values()].slice(-48);
  next.stateChangeReasons = [...(next.stateChangeReasons || []), ...(bundle.stateChangeReasons || [])].slice(-80);
  if (bundle.consumedInjectedEvent && next.ui) next.ui.injectedEvent = "";
  return next;
}
