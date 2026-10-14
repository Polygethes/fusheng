import { createId } from "../data/seed.js";

export const PLAN_STATUS = {
  ACTIVE: "active",
  FROZEN: "frozen",
  COMPLETED: "completed",
  ABANDONED: "abandoned",
};

export const PLAN_MODES = [
  ["approach", "接近计划"],
  ["withdraw", "撤退计划"],
  ["protect", "保护计划"],
  ["punish", "惩罚计划"],
  ["control", "控局计划"],
  ["plant_evidence", "设证计划"],
  ["hide_evidence", "藏证计划"],
  ["confess", "承认计划"],
  ["betray", "背叛计划"],
  ["self_destroy", "自毁计划"],
  ["wait", "等待计划"],
];

export const planTactics = PLAN_MODES;
export const planStatusOptions = [
  [PLAN_STATUS.ACTIVE, "生效"],
  [PLAN_STATUS.FROZEN, "冻结"],
  [PLAN_STATUS.COMPLETED, "完成"],
  [PLAN_STATUS.ABANDONED, "放弃"],
];

export function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}

export function planStatusLabel(status) {
  return planStatusOptions.find(([value]) => value === status)?.[1] || status || "未知";
}

export function tacticLabel(mode) {
  return PLAN_MODES.find(([value]) => value === mode)?.[1] || mode || "计划";
}

export function getCharacterName(state, id) {
  return state.characters?.find((character) => character.id === id)?.name || id || "未知人物";
}

function activeCharacterIds(state) {
  return state.ui?.activeCharacterIds?.length ? state.ui.activeCharacterIds : (state.characters || []).slice(0, 2).map((item) => item.id);
}

function relationshipScore(rel = {}) {
  return Number(rel.attraction || 0) + Number(rel.resentment || 0) + Number(rel.wantsToBeSeen || 0) + Number(rel.revenge || 0) + Number(rel.protection || 0) + Number(rel.deception || 0) + Number(rel.power || 0);
}

function strongestRelationship(state, characterId, activeIds = []) {
  return (state.relationships || [])
    .filter((rel) => rel.fromCharacterId === characterId)
    .filter((rel) => !activeIds.length || activeIds.includes(rel.toCharacterId))
    .sort((a, b) => relationshipScore(b) - relationshipScore(a))[0] || null;
}

function memoryScore(memory = {}) {
  const typeWeight = { accurate: 0, selective: 12, misremembered: 24, suppressed: 28, fabricated: 34, weaponized: 36 }[memory.type] || 10;
  return Number(memory.heat || 0) + typeWeight + (100 - Number(memory.reliability ?? 55)) / 3;
}

function selectedLocation(state = {}) {
  const id = state.ui?.selectedLocationId || state.locations?.[0]?.id;
  return (state.locations || []).find((location) => location.id === id) || (state.locations || [])[0] || null;
}

function memoryContextText(memory = {}) {
  const source = memory.sourceRelationshipShift || {};
  const signal = source.conductorSignal || {};
  return [
    memory.content,
    memory.publicVersion,
    memory.privateVersion,
    memory.retrievalCue,
    source.sharedObject,
    source.locationName,
    source.triggeredBy,
    signal.object,
    signal.inWorldClue,
    signal.pressureCue,
  ].filter(Boolean).join(" ");
}

function locationContextText(location = {}) {
  return [
    location?.id,
    location?.name,
    location?.surfaceUse,
    location?.visibleUse,
    location?.subtext,
    location?.powerRule,
    ...(location?.likelyEvents || []),
  ].filter(Boolean).join(" ");
}

function memoryContextScore(memory = {}, { location = null, targetId = "", activeIds = [] } = {}) {
  const source = memory.sourceRelationshipShift || {};
  const text = memoryContextText(memory);
  const locationText = locationContextText(location);
  let score = 0;
  if (targetId && memory.targetCharacterId === targetId) score += 85;
  else if (memory.targetCharacterId && activeIds.includes(memory.targetCharacterId)) score += 25;
  else if (memory.targetCharacterId && activeIds.length && !activeIds.includes(memory.targetCharacterId)) score -= 35;

  if (location?.id && source.locationId === location.id) score += 90;
  if (location?.name && source.locationName === location.name) score += 80;
  else if (location?.name && text.includes(location.name)) score += 55;

  const sharedObject = source.sharedObject || memory.memorySharedObject || "";
  if (sharedObject && locationText.includes(sharedObject)) score += 25;
  if (sharedObject && text.includes(sharedObject)) score += 10;
  if (source.triggeredBy || source.conductorSignal?.inWorldClue || memory.retrievalCue) score += 8;
  return score;
}

function heatedMemory(state, characterId, context = {}) {
  const branchId = state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
  return (state.characterMemories || [])
    .filter((memory) => memory.characterId === characterId)
    .filter((memory) => !memory.branchId || memory.branchId === branchId)
    .sort((a, b) => (memoryScore(b) + memoryContextScore(b, context)) - (memoryScore(a) + memoryContextScore(a, context)))[0] || null;
}

function defaultTarget(state, characterId) {
  const activeIds = activeCharacterIds(state).filter((id) => id !== characterId);
  const rel = strongestRelationship(state, characterId, activeIds);
  return rel?.toCharacterId || activeIds[0] || (state.characters || []).find((item) => item.id !== characterId)?.id || characterId;
}

function inferDominantMode(character, rel, memory) {
  const st = character.currentState || {};
  if (memory?.type === "weaponized" || memory?.stance === "revenge") return "plant_evidence";
  if (memory?.type === "suppressed" && Number(st.selfDeception || 0) > 60) return "hide_evidence";
  if (memory?.type === "misremembered" || memory?.type === "fabricated") return "plant_evidence";
  if (Number(st.selfDestruction || 0) > 66) return "self_destroy";
  if (Number(st.revengeImpulse || 0) + Number(st.rage || 0) > Number(st.protectionImpulse || 0) + Number(st.love || 0) + 28) return "punish";
  if (Number(st.protectionImpulse || 0) + Number(rel?.protection || 0) > 100) return "protect";
  if (Number(rel?.power || 0) + Number(rel?.deception || 0) * 0.4 > 92) return "control";
  if (Number(st.desire || 0) + Number(rel?.attraction || 0) + Number(rel?.wantsToBeSeen || 0) > 150) return "approach";
  if (Number(st.shame || 0) + Number(rel?.fear || 0) + Number(rel?.wantsToEscape || 0) > 145) return "withdraw";
  return "confess";
}

function planVerb(mode) {
  return { approach: "靠近", withdraw: "撤退", protect: "保护", punish: "惩罚", control: "夺回解释权", betray: "背叛", confess: "承认", hide_evidence: "隐藏", plant_evidence: "设证", self_destroy: "自毁", wait: "等待" }[mode] || "试探";
}

function planTone(mode) {
  return { approach: "接近", withdraw: "伪装", protect: "保护", punish: "惩罚", control: "伪装", betray: "陷害", confess: "求证", hide_evidence: "伪装", plant_evidence: "共谋", self_destroy: "自毁", wait: "试探" }[mode] || "试探";
}

export function buildIntentPlan(state, character, options = {}) {
  const branchId = state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
  const targetCharacterId = options.targetCharacterId || defaultTarget(state, character.id);
  const rel = (state.relationships || []).find((item) => item.fromCharacterId === character.id && item.toCharacterId === targetCharacterId) || null;
  const memory = heatedMemory(state, character.id, {
    location: selectedLocation(state),
    targetId: targetCharacterId,
    activeIds: activeCharacterIds(state),
  });
  const mode = options.mode || inferDominantMode(character, rel, memory);
  const targetName = getCharacterName(state, targetCharacterId);
  const name = character.name || character.id;
  const st = character.currentState || {};
  const heat = clamp(options.heat ?? ((st.desire || 0) * 0.28 + (st.shame || 0) * 0.22 + (st.revengeImpulse || 0) * 0.22 + (st.protectionImpulse || 0) * 0.16 + (memory?.heat || 0) * 0.12 + 20));
  const priority = clamp(options.priority ?? (40 + heat / 2 + (rel ? relationshipScore(rel) / 8 : 0)));
  const pressure = clamp(options.pressure ?? (heat + priority) / 2);
  const risk = clamp(options.risk ?? heat + (mode === "plant_evidence" || mode === "betray" || mode === "self_destroy" ? 18 : 4));
  const verb = planVerb(mode);
  const selfMyth = character.internalSituation?.selfMyth || character.selfMyth?.believesSelfToBe || "我必须保住自己的形象";
  const lie = character.currentState?.currentSelfLie || character.internalSituation?.repeatedSelfLie || "我只是按原则行事。";
  const memoryLine = memory ? `，并把记忆“${memory.content || memory.privateVersion || memory.id}”当成可操作材料` : "";
  const shortTerm = options.shortTerm || options.shortTermPlan || `${name}下一步要${verb}${targetName}：表面上维持当前身份，实际上测试${targetName}是否会按自己需要的方式回应${memoryLine}。`;
  const midTermCover = options.midTermCover || options.midTermMask || `${name}把计划伪装成“${lie}”，让${targetName}无法直接指认这是一种索取、报复或占有。`;
  const longTermSelfMyth = options.longTermSelfMyth || `${name}要继续维护自我神话：“${selfMyth}”；但计划越推进，越会暴露这个神话的裂缝。`;
  return {
    id: options.id || createId("plan"),
    projectId: state.project?.id,
    branchId,
    characterId: character.id,
    targetCharacterId,
    status: options.status || PLAN_STATUS.ACTIVE,
    mode,
    modeLabel: PLAN_MODES.find(([value]) => value === mode)?.[1] || mode,
    currentTactic: options.currentTactic || mode,
    createdAt: options.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    priority,
    pressure,
    risk,
    heat,
    progress: clamp(options.progress ?? 0),
    locked: Boolean(options.locked || false),
    operatorLock: Boolean(options.operatorLock || false),
    source: options.source || "planner",
    shortTerm,
    shortTermPlan: shortTerm,
    midTermCover,
    midTermMask: midTermCover,
    longTermSelfMyth,
    hiddenObjective: options.hiddenObjective || `${name}想从${targetName}那里得到一个能喂养自我神话的反应。`,
    immediateObjective: options.immediateObjective || `${verb}${targetName}，但不让动作被单义识别。`,
    plannedActionVerb: verb,
    nextActionBias: planTone(mode),
    desiredMisreading: options.desiredMisreading || `${targetName}最好把这个动作误读成${mode === "protect" ? "保护" : mode === "approach" ? "专业回应" : mode === "punish" ? "标准" : "普通流程"}。`,
    disguisedAs: options.disguisedAs || lie,
    shadowProfit: options.shadowProfit || `${name}获得短暂收益：${targetName}被迫把注意力放回${name}身上。`,
    nobleCover: options.nobleCover || `${name}仍能说自己是在减少伤害、维护秩序或保护别人。`,
    riskIfExposed: options.riskIfExposed || `一旦被看穿，${name}会失去解释权，${targetName}会得到反行动空间。`,
    evidenceToCreate: options.evidenceToCreate || `${verb}行动留下可被误读的材料或见证。`,
    evidenceToDestroy: options.evidenceToDestroy || (mode === "hide_evidence" ? "删除或改写最能证明自己不纯的痕迹。" : "暂不销毁，先保留可辩解空间。"),
    memoryToRevise: options.memoryToRevise || (memory ? memory.id : null),
    planObstacle: options.planObstacle || `${targetName}也有自己的行动线，可能误读、反击、保护、陷害或拒绝。`,
    selfSabotage: options.selfSabotage || `计划越成功，${name}越可能用更强的自欺把自己推向反效果。`,
    operatorNote: options.operatorNote || "",
    planLog: options.planLog || [],
    lastAdvancedByDraftId: options.lastAdvancedByDraftId || null,
  };
}

export function createDefaultPlan(character, state) {
  return buildIntentPlan(state, character, { source: "default_plan" });
}

export function ensureCharacterPlans(state) {
  const branchId = state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
  const existing = (state.characterPlans || []).filter((plan) => !plan.branchId || plan.branchId === branchId);
  const byCharacter = new Map(existing.filter((plan) => plan.status !== PLAN_STATUS.ABANDONED).map((plan) => [plan.characterId, plan]));
  const plans = [...existing];
  for (const character of state.characters || []) {
    if (byCharacter.has(character.id)) continue;
    plans.push(buildIntentPlan(state, character, { source: "ensure_character_plans" }));
  }
  return plans;
}

export function activePlansForCharacter(state, characterId) {
  const branchId = state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
  return (state.characterPlans || [])
    .filter((plan) => plan.characterId === characterId)
    .filter((plan) => !plan.branchId || plan.branchId === branchId)
    .filter((plan) => plan.status !== PLAN_STATUS.COMPLETED && plan.status !== PLAN_STATUS.ABANDONED)
    .sort((a, b) => planScore(b) - planScore(a));
}

export function planScore(plan) {
  const frozen = plan.status === PLAN_STATUS.FROZEN ? -35 : 0;
  return Number(plan.priority || 50) + Number(plan.heat || plan.pressure || 0) + Number(plan.progress || 0) / 2 + frozen;
}

export function primaryPlanForCharacter(state, characterId) {
  return activePlansForCharacter(state, characterId)[0] || null;
}

export function getCharacterPlan(state, characterId) {
  return primaryPlanForCharacter(state, characterId);
}

export function summarizePlan(plan, state = {}) {
  if (!plan) return "";
  return `${getCharacterName(state, plan.characterId)} 的自主计划：${plan.modeLabel || plan.mode} → ${getCharacterName(state, plan.targetCharacterId)}；短期=${plan.shortTerm || plan.shortTermPlan || "无"}；中期伪装=${plan.midTermCover || plan.midTermMask || "无"}；长期神话=${plan.longTermSelfMyth || "无"}`;
}

export function planInfluenceText(plan, state) {
  if (!plan) return "";
  return [
    `自主计划：${getCharacterName(state, plan.characterId)} → ${getCharacterName(state, plan.targetCharacterId)} / ${plan.modeLabel || tacticLabel(plan.mode)}`,
    `短期：${plan.shortTerm || plan.shortTermPlan}`,
    `中期伪装：${plan.midTermCover || plan.midTermMask}`,
    `长期神话：${plan.longTermSelfMyth}`,
    `阴影收益：${plan.shadowProfit}`,
    `暴露风险：${plan.riskIfExposed}`,
  ].join("\n");
}

export function advancePlanFromOutput(plan, output) {
  if (!plan || !output) return null;
  const matched = output.intentPlanId === plan.id || output.planId === plan.id || (output.tone && output.tone === plan.nextActionBias) || String(output.visibleAction || "").includes(plan.plannedActionVerb || "\u0000") || String(output.hiddenAction || "").includes(plan.plannedActionVerb || "\u0000");
  const progress = clamp(Number(plan.progress || 0) + (matched ? 24 : 10), 0, 100);
  const status = progress >= 100 ? PLAN_STATUS.COMPLETED : plan.status;
  return {
    ...plan,
    progress,
    status,
    pressure: clamp(Number(plan.pressure || plan.heat || 50) + (matched ? 6 : 3)),
    risk: clamp(Number(plan.risk || plan.heat || 40) + (/证据|材料|记录|邮件|修订/.test(output.possibleEvidenceLeft || "") ? 8 : 3)),
    heat: clamp(Number(plan.heat || 50) + (matched ? 5 : 2)),
    updatedAt: new Date().toISOString(),
    lastAdvancedByDraftId: output.sourceDraftId || null,
    lastActionSummary: output.visibleAction || output.hiddenAction || "未记录动作",
    lastPlanResult: matched ? "执行了自主计划" : "偏离计划，但暴露了计划压力",
    planLog: [{ at: new Date().toISOString(), line: matched ? "执行了自主计划" : "偏离计划但暴露计划压力" }, ...(plan.planLog || [])].slice(0, 12),
  };
}

function mergePlanPatches(existing, patches) {
  const byId = new Map((existing || []).map((plan) => [plan.id, plan]));
  for (const patch of patches || []) byId.set(patch.id, { ...(byId.get(patch.id) || {}), ...patch });
  return [...byId.values()];
}

export function advancePlansFromDraft(draft, state) {
  const outputs = draft.agentOutputs || [];
  const patches = [];
  const activePlanIds = new Set();
  for (const output of outputs) {
    const plan = primaryPlanForCharacter(state, output.characterId);
    if (!plan) continue;
    activePlanIds.add(plan.id);
    const next = advancePlanFromOutput(plan, { ...output, sourceDraftId: draft.id });
    if (next) patches.push(next);
  }
  const generated = ensureCharacterPlans({ ...state, characterPlans: mergePlanPatches(state.characterPlans || [], patches) })
    .filter((plan) => !activePlanIds.has(plan.id) && !patches.some((patch) => patch.id === plan.id));
  return [...patches, ...generated];
}

export function auditIntentPlans(state, draft = null) {
  const branchId = state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
  const activeIds = activeCharacterIds(state);
  const plans = ensureCharacterPlans(state).filter((plan) => !plan.branchId || plan.branchId === branchId);
  const activePlans = plans.filter((plan) => activeIds.includes(plan.characterId) && plan.status !== PLAN_STATUS.COMPLETED && plan.status !== PLAN_STATUS.ABANDONED);
  const outputs = draft?.agentOutputs || [];
  const usedIds = new Set(outputs.map((output) => output.intentPlanId || output.planId).filter(Boolean));
  const text = outputs.map((output) => `${output.visibleAction || ""} ${output.hiddenAction || ""} ${output.defenseAction || ""} ${output.shadowAction || ""}`).join("\n");
  let changedAction = 0;
  for (const plan of activePlans) {
    if (usedIds.has(plan.id) || text.includes(plan.plannedActionVerb || "\u0000") || text.includes(plan.modeLabel || "\u0000") || text.includes(plan.shortTerm || "\u0000")) changedAction += 1;
  }
  const withoutPlans = activeIds.filter((id) => !activePlans.some((plan) => plan.characterId === id)).length;
  const frozen = activePlans.filter((plan) => plan.status === PLAN_STATUS.FROZEN).length;
  const pairSet = new Set(activePlans.map((plan) => `${plan.characterId}->${plan.targetCharacterId}`));
  const reciprocal = activePlans.filter((plan) => pairSet.has(`${plan.targetCharacterId}->${plan.characterId}`)).length;
  const planPressureScore = clamp(activePlans.reduce((sum, plan) => sum + Number(plan.heat || plan.pressure || 0) + Number(plan.priority || 0) / 2, 0) / Math.max(1, activePlans.length));
  const planContinuityScore = clamp(activePlans.length ? 100 - withoutPlans * 25 - frozen * 8 : 20);
  const planChangedActionScore = clamp(activePlans.length ? changedAction / activePlans.length * 100 : 0);
  const ignoredPlanRisk = clamp(100 - planChangedActionScore + withoutPlans * 18);
  const planConflictScore = clamp(reciprocal * 28 + activePlans.filter((plan) => ["betray", "punish", "plant_evidence", "self_destroy"].includes(plan.mode)).length * 10);
  const selfMythContinuityScore = clamp(activePlans.filter((plan) => plan.longTermSelfMyth && (plan.midTermCover || plan.midTermMask)).length / Math.max(1, activePlans.length) * 100);
  return {
    activePlanCount: activePlans.length,
    missingPlanCharacterCount: withoutPlans,
    planPressureScore,
    planContinuityScore,
    planChangedActionScore,
    ignoredPlanRisk,
    planConflictScore,
    selfMythContinuityScore,
    highHeatPlans: activePlans.filter((plan) => Number(plan.heat || plan.pressure || 0) > 70).map((plan) => ({ id: plan.id, characterId: plan.characterId, targetCharacterId: plan.targetCharacterId, mode: plan.mode, heat: plan.heat || plan.pressure })),
    warnings: [
      ...(withoutPlans ? [`${withoutPlans} 个参与人物没有自主计划。`] : []),
      ...(ignoredPlanRisk > 60 ? ["人物行动没有明显执行、偏离或反抗自身计划。"] : []),
      ...(selfMythContinuityScore < 50 ? ["计划没有把短期行动连接到长期自我神话。"] : []),
      ...(planConflictScore > 60 ? ["计划之间存在强冲突，适合推进不可逆场景。"] : []),
    ],
  };
}

export function auditPlans(state, draft = null) {
  const audit = auditIntentPlans(state, draft);
  return {
    ...audit,
    planUseScore: audit.planChangedActionScore,
    planRisk: audit.ignoredPlanRisk,
    highPressurePlanCount: (audit.highHeatPlans || []).length,
    frozenPlanCount: (state.characterPlans || []).filter((plan) => plan.status === PLAN_STATUS.FROZEN).length,
  };
}
