import { callOpenAIJson } from "./responseClient.mjs";
import { privateSimulationSchema } from "./schemas.mjs";
import {
  forbiddenTargetNames,
  relationshipIntensityScore,
  retargetTextToLockedTarget,
  targetFor,
} from "./relationshipTargeting.mjs";
import { interventionPromptBlock } from "../../state/interventions.js";

function clampNumber(value, fallback = 50) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export { relationshipIntensityScore, targetFor };

function relationshipForPair(compact = {}, characterId = "", targetId = "") {
  return (compact.relationships || []).find((rel) => rel.fromCharacterId === characterId && rel.toCharacterId === targetId) || null;
}

function relationshipDialogueLine(rel = null, actorName = "有人", targetName = "对方") {
  const last = rel?.lastDialogue;
  if (!last) return "";
  const object = last.sharedObject || "上一件事";
  const place = last.locationName ? `在${last.locationName}` : "";
  const turn = String(last.followupTurn || last.finalTurn || rel.unspoken || "").replace(/[。！？…]+$/g, "");
  const outcome = String(last.eventOutcome || "").replace(/[。！？…]+$/g, "");
  const actReason = String(last.relationshipDialogueAct?.reason || "").trim().replace(/[。！？…]+$/g, "");
  const actKind = String(last.relationshipDialogueAct?.kind || "").trim();
  const actLine = actReason ? `；关系动作${actKind ? `/${actKind}` : ""}：${actReason}` : "";
  return `${actorName}和${targetName}上一轮${place}围绕${object}留下未结清的话${turn ? `：“${turn}”` : ""}${outcome ? `；结果是${outcome}` : ""}${actLine}。`;
}

function relationshipStateFromDialogue(rel = null, actorName = "有人", targetName = "对方") {
  const dialogue = rel?.lastDialogue || null;
  if (!dialogue) return null;
  const kind = String(dialogue.relationshipDialogueAct?.kind || "").trim() || "unresolved";
  const object = dialogue.sharedObject || "场中筹码";
  const finalTurn = String(dialogue.followupTurn || dialogue.finalTurn || rel.unspoken || "").replace(/[。！？…]+$/g, "");
  const reason = String(dialogue.relationshipDialogueAct?.reason || rel.unspoken || "").replace(/[。！？…]+$/g, "");
  const historyCount = Array.isArray(rel?.dialogueHistory) ? rel.dialogueHistory.length : 0;
  const byKind = {
    protect: {
      label: `${actorName}和${targetName}之间形成保护债`,
      currentConstraint: `下一步不能只处理${object}，必须先回应人是否会被带走。`,
      nextActionBias: "先护住人，再处理证物、规矩或价码。",
    },
    control: {
      label: `${actorName}和${targetName}正在争夺解释权`,
      currentConstraint: `下一步不能绕过${object}和见证流程，谁命名谁就要先亮手。`,
      nextActionBias: "争夺命名权、盖印流程或规矩解释。",
    },
    bargain: {
      label: `${actorName}和${targetName}之间有未结清价码`,
      currentConstraint: `下一步不能让${object}直接进账，必须先回应旧案、条件或欠下的话。`,
      nextActionBias: "把价码、旧案和上一句未答的话重新摆到明处。",
    },
    withdraw: {
      label: `${actorName}和${targetName}之间的退路被看见`,
      currentConstraint: `下一步不能只后退，${object}和刚才那句话仍要留在场中。`,
      nextActionBias: "退半步，但留下物件、问题或没有交出的解释。",
    },
    accuse: {
      label: `${actorName}和${targetName}之间形成控诉压力`,
      currentConstraint: `下一步不能把${object}收走，必须回应证据、名字或责任。`,
      nextActionBias: "逼对方承认证据、名字或责任的归属。",
    },
  };
  const state = byKind[kind] || {
    label: `${actorName}和${targetName}之间有未结清对白`,
    currentConstraint: `下一步不能假装${object}已经离场，必须接住上一轮留下的话。`,
    nextActionBias: "接住上一轮没有说完的话，再移动物件或关系位置。",
  };
  return {
    kind,
    label: state.label,
    sharedObject: object,
    locationName: dialogue.locationName || "",
    finalTurn,
    reason,
    historyCount,
    currentConstraint: state.currentConstraint,
    nextActionBias: state.nextActionBias,
  };
}

function relationshipStateLine(state = null) {
  if (!state) return "";
  return `关系状态：${state.label}；${state.currentConstraint}${state.finalTurn ? ` 上一句压着：“${state.finalTurn}”。` : ""}${state.reason ? ` 原因：${state.reason}。` : ""}`;
}

function relationshipDialogueTranscriptLine(dialogue = null) {
  const turns = Array.isArray(dialogue?.dialogueTurns) ? dialogue.dialogueTurns.filter(Boolean).slice(-6) : [];
  if (!turns.length) return "";
  const transcript = turns
    .map((turn) => {
      const speaker = turn.speakerName || turn.speakerId || "有人";
      const line = String(turn.line || "").trim();
      return line ? `${speaker}：“${line}”` : "";
    })
    .filter(Boolean)
    .join(" ");
  return transcript ? `上一轮对白全文：${transcript}` : "";
}

function relationshipDialogueHistoryTranscriptLine(history = []) {
  const recent = Array.isArray(history) ? history : [];
  if (recent.length < 2) return "";
  const lines = recent
    .map((dialogue) => relationshipDialogueTranscriptLine(dialogue))
    .filter(Boolean);
  return lines.length ? `连续关系对白：${lines.join(" ")}` : "";
}

function relationshipDialogueHistoryLine(rel = null, actorName = "有人", targetName = "对方") {
  const history = Array.isArray(rel?.dialogueHistory) ? rel.dialogueHistory.filter(Boolean).slice(-3) : [];
  if (history.length < 2) return "";
  const objects = [...new Set(history.map((item) => item.sharedObject).filter(Boolean))].join("、") || "几件东西";
  const places = [...new Set(history.map((item) => item.locationName).filter(Boolean))].join("、");
  const latestTurn = String(history.at(-1)?.followupTurn || history.at(-1)?.finalTurn || "").replace(/[。！？…]+$/g, "");
  return `${actorName}和${targetName}已经连续${history.length}轮${places ? `在${places}` : ""}围绕${objects}没结清${latestTurn ? `，最新一句压着：“${latestTurn}”` : ""}。`;
}

function memoryHeat(memory = {}) {
  const typeWeight = { accurate: 0, selective: 12, misremembered: 20, suppressed: 24, fabricated: 28, weaponized: 26 }[memory.type] || 8;
  return Number(memory.heat || 0) + typeWeight + (100 - Number(memory.reliability ?? 55)) / 2;
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
    location.id,
    location.name,
    location.surfaceUse,
    location.visibleUse,
    location.subtext,
    location.powerRule,
    ...(location.likelyEvents || []),
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

function relevantContextFor(character, compact, targetId = "") {
  const fastMode = compact.pipelineMode === "fast" || compact.pipelineMode === "balanced";
  const activeIds = compact.activeCharacterIds || [];
  const memories = (compact.activeCharacterMemories || [])
    .filter((memory) => memory.characterId === character.id || memory.targetCharacterId === character.id)
    .slice()
    .sort((a, b) => (
      memoryHeat(b) + memoryContextScore(b, { location: compact.selectedLocation, targetId, activeIds })
    ) - (
      memoryHeat(a) + memoryContextScore(a, { location: compact.selectedLocation, targetId, activeIds })
    ))
    .slice(0, fastMode ? 4 : 10);
  const relationships = (compact.relationships || []).filter((rel) => rel.fromCharacterId === character.id || rel.toCharacterId === character.id);
  const memoryConflicts = (compact.memoryConflictSummaries || []).filter((item) => item.characterId === character.id);
  return {
    relationships: fastMode
      ? relationships.sort((a, b) => Number(b.fromCharacterId === targetId || b.toCharacterId === targetId) - Number(a.fromCharacterId === targetId || a.toCharacterId === targetId)).slice(0, 2)
      : relationships,
    memories,
    memoryConflicts: fastMode
      ? memoryConflicts.slice(0, 1).map((item) => ({ ...item, mostRecentMemories: (item.mostRecentMemories || []).slice(0, 2) }))
      : memoryConflicts,
    plans: fastMode
      ? (compact.activeCharacterPlans || []).filter((plan) => plan.characterId === character.id).slice(0, 1)
      : (compact.activeCharacterPlans || []).filter((plan) => plan.characterId === character.id),
    recentCanon: fastMode ? (compact.recentCanon || []).slice(0, 2) : (compact.recentCanon || []),
    recentEvidence: fastMode ? (compact.recentEvidence || []).slice(0, 3) : (compact.recentEvidence || []),
    recentRumors: fastMode ? (compact.recentRumors || []).slice(0, 2) : (compact.recentRumors || []),
    irreversibleTraces: fastMode ? (compact.irreversibleTraces || []).slice(0, 3) : (compact.irreversibleTraces || []),
  };
}

function privatePromptCharacterCard(character = {}, compact = {}) {
  if (compact.pipelineMode !== "fast" && compact.pipelineMode !== "balanced") return character;
  return {
    id: character.id,
    name: character.name,
    publicIdentity: character.publicIdentity,
    agentProfile: character.agentProfile ? {
      dramaticObjective: character.agentProfile.dramaticObjective,
      hiddenFear: character.agentProfile.hiddenFear,
      leverageObject: character.agentProfile.leverageObject,
      dialogueMoves: (character.agentProfile.dialogueMoves || []).slice(0, 3),
      responseBoundary: character.agentProfile.responseBoundary,
      desiredWitness: character.agentProfile.desiredWitness,
      desiredResponse: character.agentProfile.desiredResponse,
    } : null,
    externalSituation: character.externalSituation,
    internalSituation: character.internalSituation,
    selfMyth: character.selfMyth,
    actionLines: character.actionLines,
    desireLag: character.desireLag,
    shameMechanism: character.shameMechanism,
    defenseLanguage: character.defenseLanguage,
    speechProfile: character.speechProfile || character.agentProfile?.speechProfile || null,
    shadowActions: Array.isArray(character.shadowActions) ? character.shadowActions.slice(0, 3) : character.shadowActions,
    nobleActions: Array.isArray(character.nobleActions) ? character.nobleActions.slice(0, 2) : character.nobleActions,
    vileActions: Array.isArray(character.vileActions) ? character.vileActions.slice(0, 2) : character.vileActions,
    actionVerbs: character.actionVerbs,
    triggers: Array.isArray(character.triggers) ? character.triggers.slice(0, 4) : character.triggers,
    relationshipRules: character.relationshipRules,
    irreversibleBoundaries: character.irreversibleBoundaries,
    currentState: character.currentState,
    currentLocationId: character.currentLocationId || "",
    currentActivity: character.currentActivity || null,
    plan: character.plan || null,
  };
}

function characterName(compact = {}, id = "") {
  return (compact.activeCharacters || []).find((character) => character.id === id)?.name || id;
}

function activePlanForPrivate(character = {}, compact = {}) {
  if (character.plan?.id) return character.plan;
  return (compact.activeCharacterPlans || [])
    .find((plan) => plan.characterId === character.id && plan.status !== "completed" && plan.status !== "abandoned")
    || null;
}

function planTone(plan = null) {
  if (!plan) return "";
  if (plan.currentTactic === "control" || plan.mode === "control") return "伪装";
  return plan.nextActionBias || "";
}

function planActionCandidate(plan = null, characterNameText = "有人") {
  if (!plan) return "";
  const objective = String(plan.immediateObjective || plan.planNextAction || plan.shortTerm || plan.shortTermPlan || plan.plannedActionVerb || "").trim();
  if (!objective) return "";
  if (objective.includes(characterNameText)) return objective;
  if (/^[，。：；、]/.test(objective)) return `${characterNameText}${objective}`;
  return `${characterNameText}${objective}`;
}

function planShouldDriveFallbackAction(plan = null) {
  return plan?.currentTactic === "control" || plan?.mode === "control";
}

function planPressureLine(plan = null, compact = {}) {
  if (!plan) return "";
  const actorName = characterName(compact, plan.characterId);
  const targetName = characterName(compact, plan.targetCharacterId);
  const modeLabel = plan.modeLabel || plan.mode || "自主计划";
  const tactic = plan.currentTactic || plan.mode || "未标注";
  return [
    `当前自主计划压力：${actorName} -> ${targetName} / ${modeLabel}`,
    `当前策略：${tactic}；下一动作偏向：${plan.nextActionBias || planTone(plan) || "未标注"}；计划动作：${plan.plannedActionVerb || "未标注"}`,
    `短期：${plan.shortTerm || plan.shortTermPlan || "无"}`,
    `立即目标：${plan.immediateObjective || "无"}`,
    `隐藏目标：${plan.hiddenObjective || "无"}`,
    `伪装：${plan.disguisedAs || plan.midTermCover || plan.midTermMask || "无"}`,
    "本轮必须把这个计划转成行动候选、沉默、物件移动、对话压力或证据处理；不能只把计划当背景资料。",
    tactic === "control"
      ? "控局计划必须争夺解释权、命名权、规矩解释或盖印流程；优先使用场上的具体规则和物件。"
      : "",
  ].filter(Boolean).join("\n");
}

function relationshipDialoguePromptContext({ compact, character, targetId }) {
  const target = (compact.activeCharacters || []).find((item) => item.id === targetId)
    || (compact.activeCharacters || []).find((item) => item.id !== character.id)
    || character;
  const related = (compact.relationships || [])
    .filter((rel) => (
      (rel.fromCharacterId === character.id && rel.toCharacterId === target.id)
      || (rel.fromCharacterId === target.id && rel.toCharacterId === character.id)
    ))
    .filter((rel) => rel?.lastDialogue || Array.isArray(rel?.dialogueHistory));
  if (!related.length) {
    return "关系对白上下文：无显式未结清对白。";
  }
  const lines = related.flatMap((rel) => {
    const actorName = characterName(compact, rel.fromCharacterId);
    const targetName = characterName(compact, rel.toCharacterId);
    const relationshipState = relationshipStateFromDialogue(rel, actorName, targetName);
    return [
      relationshipStateLine(relationshipState),
      relationshipDialogueLine(rel, actorName, targetName),
      relationshipDialogueTranscriptLine(rel.lastDialogue),
      relationshipDialogueHistoryLine(rel, actorName, targetName),
      relationshipDialogueHistoryTranscriptLine(rel.dialogueHistory),
    ].filter(Boolean).map((line) => `- ${line}`);
  });
  return [
    "关系对白上下文：",
    ...lines,
    "本轮必须把这些未结清对白转成动作材料：下一步可以是追问、拒绝、改口、沉默、移动物件、保护证据、设局或退让，但不能只说“想起上一轮”。",
  ].join("\n");
}

export function normalizePrivateSimulation(parsed, compact, character, targetId) {
  const lockedTargetId = targetId || parsed?.targetCharacterId || "";
  const target = compact.activeCharacters.find((item) => item.id === lockedTargetId)
    || compact.activeCharacters.find((item) => item.id === parsed?.targetCharacterId)
    || compact.activeCharacters.find((item) => item.id !== character.id)
    || character;
  const agentProfile = character.agentProfile || null;
  const leverageObject = agentProfile?.leverageObject || "";
  const profileGoal = agentProfile?.dramaticObjective || "";
  const profileMask = agentProfile?.dialogueMoves?.[0] || "";
  const profileDesiredResponse = agentProfile?.desiredResponse
    || character.internalSituation?.desiredResponse
    || character.innerCourt?.desiredResponse
    || "希望关键的人听完自己的要求，再作出明确回应。";
  const plan = activePlanForPrivate(character, compact);
  const planLine = planPressureLine(plan, compact);
  const fallbackPlanTone = planTone(plan);
  const planAction = planActionCandidate(plan, character.name || character.id);
  const fallbackPlanAction = planShouldDriveFallbackAction(plan) ? planAction : "";
  const profileAction = leverageObject
    ? `${character.name || character.id}借${leverageObject}试探${target?.name || target?.id || "对方"}是否接受自己的命名。`
    : "用一个看似普通的动作试探对方是否听懂裂缝。";
  const targetName = target?.name || target?.id || character.id;
  const activeRelationship = relationshipForPair(compact, character.id, target?.id || "");
  const relationshipDialogueMemory = activeRelationship?.lastDialogue || null;
  const relationshipDialogueHistory = Array.isArray(activeRelationship?.dialogueHistory)
    ? activeRelationship.dialogueHistory.filter(Boolean).slice(-3)
    : [];
  const relationshipMemoryLine = relationshipDialogueLine(activeRelationship, character.name || character.id, targetName);
  const relationshipDialogueTranscript = relationshipDialogueTranscriptLine(relationshipDialogueMemory);
  const relationshipHistoryLine = relationshipDialogueHistoryLine(activeRelationship, character.name || character.id, targetName);
  const relationshipDialogueHistoryTranscript = relationshipDialogueHistoryTranscriptLine(relationshipDialogueHistory);
  const relationshipState = relationshipStateFromDialogue(activeRelationship, character.name || character.id, targetName);
  const relationshipStateText = relationshipStateLine(relationshipState);
  const modelMemoryLine = parsed?.memoryLine || parsed?.memoryInfluence || "";
  const staleTargetNames = forbiddenTargetNames(compact, character.id, target?.id || "");
  const actionCandidate = retargetTextToLockedTarget(parsed?.actionCandidate || fallbackPlanAction || profileAction, {
    targetName,
    forbiddenNames: staleTargetNames,
  });
  const stateAwareActionCandidate = relationshipStateText && !actionCandidate.includes(relationshipState.currentConstraint)
    ? `${actionCandidate} ${relationshipStateText}`
    : actionCandidate;
  return {
    characterId: parsed?.characterId || character.id,
    characterName: parsed?.characterName || character.name || character.id,
    agentProfile,
    targetCharacterId: target?.id || character.id,
    targetCharacterName: targetName,
    tone: parsed?.tone || fallbackPlanTone || "试探",
    publicGoal: parsed?.publicGoal || (profileGoal ? `${character.actionLines?.visible || "维持表面身份"}，用${leverageObject || "手边物件"}推进：${profileGoal}` : character.actionLines?.visible) || "维持表面身份。",
    privateDesire: parsed?.privateDesire || profileGoal || character.actionLines?.desire || "想被看见但不能承认。",
    defensiveMask: parsed?.defensiveMask || profileMask || character.actionLines?.defense || "把欲望命名为原则。",
    shadowImpulse: parsed?.shadowImpulse || character.actionLines?.shadow || "用体面动作索取反应。",
    nobleImpulse: parsed?.nobleImpulse || (character.nobleActions || [])[0] || "减少对方承受的伤害。",
    selfLie: parsed?.selfLie || character.currentState?.currentSelfLie || character.internalSituation?.repeatedSelfLie || "我只是按原则行事。",
    actionCandidate: stateAwareActionCandidate,
    whatTheyWantFromOthers: normalizeDesiredResponse(parsed?.whatTheyWantFromOthers || parsed?.wantsFromOthers, profileDesiredResponse),
    whatTheyRefuseToAdmit: parsed?.whatTheyRefuseToAdmit || parsed?.refusesToAdmit || agentProfile?.hiddenFear || "自己需要对方参与自我解释。",
    riskTheyWillCreate: parsed?.riskTheyWillCreate || "把私人欲望转成对方需要承担的关系压力。",
    planId: parsed?.planId || plan?.id || character.plan?.id || "",
    planLine: parsed?.planLine || parsed?.planInfluence || planLine || character.plan?.shortTerm || "",
    planNextAction: parsed?.planNextAction || planAction || "",
    planStatus: parsed?.planStatus || plan?.status || (plan ? "active" : ""),
    memoryId: parsed?.memoryId || "",
    memoryLine: [
      modelMemoryLine,
      relationshipMemoryLine,
      relationshipStateText,
      relationshipDialogueTranscript,
      relationshipHistoryLine,
      relationshipDialogueHistoryTranscript,
    ].filter(Boolean).join(" "),
    memorySource: relationshipDialogueMemory ? "agent_dialogue_relationship" : parsed?.memorySource || "",
    relationshipState,
    relationshipDialogueMemory,
    relationshipDialogueTranscript,
    relationshipDialogueHistory,
    relationshipDialogueHistoryTranscript,
    relationshipHistoryCount: relationshipDialogueHistory.length,
    contradictionScore: clampNumber(parsed?.contradictionScore, 58),
    pressure: clampNumber(parsed?.pressure, 55),
    currentActivity: String(parsed?.currentActivity || character.currentActivity?.description || planAction || stateAwareActionCandidate).trim(),
    activityDurationTicks: Math.max(1, Math.min(12, Math.round(Number(parsed?.activityDurationTicks || character.currentActivity?.remainingTicks || 2)))),
    reactionIntent: ["continue", "talk", "respond", "wait", "leave"].includes(parsed?.reactionIntent)
      ? parsed.reactionIntent
      : (parsed?.presenceIntent === "leave" ? "leave" : "talk"),
    reactionTargetCharacterId: String(parsed?.reactionTargetCharacterId || target?.id || "").trim(),
    reactionReason: String(parsed?.reactionReason || "眼前的人或事件与当前活动发生了直接关系。").trim(),
    conversationObjective: String(parsed?.conversationObjective || `让${targetName}对眼前冲突作出可执行的回应`).trim(),
    conversationEndCondition: String(parsed?.conversationEndCondition || "得到可执行的回答、遭到明确拒绝，或有人决定离开").trim(),
    presenceIntent: parsed?.presenceIntent === "leave" ? "leave" : "stay",
    exitUrgency: clampNumber(parsed?.exitUrgency, parsed?.tone === "撤退" ? 68 : 20),
    exitResistance: clampNumber(parsed?.exitResistance, 55),
    exitTrigger: String(parsed?.exitTrigger || "").trim(),
    exitReason: String(parsed?.exitReason || "").trim(),
    desiredDestinationId: String(parsed?.desiredDestinationId || "").trim(),
    departureMethod: String(parsed?.departureMethod || "").trim(),
    surfaceJustification: parsed?.surfaceJustification || "表面上只是执行角色身份允许的行动。",
    desireReason: parsed?.desireReason || parsed?.privateDesire || "想让对方回应自己的裂缝。",
    shameReason: parsed?.shameReason || "害怕欲望被命名。",
    powerReason: parsed?.powerReason || "需要保留解释权。",
    selfDeceptionReason: parsed?.selfDeceptionReason || parsed?.defensiveMask || "把欲望改名为职责。",
    unadmittedPleasure: parsed?.unadmittedPleasure || "对方被自己的行动影响。",
    postActionSelfPunishment: parsed?.postActionSelfPunishment || "事后反复回看自己的动作并改写理由。",
    falseBeliefs: Array.isArray(parsed?.falseBeliefs) ? parsed.falseBeliefs : [],
    withheldFacts: Array.isArray(parsed?.withheldFacts) ? parsed.withheldFacts : [],
  };
}

function normalizeDesiredResponse(value = "", fallback = "") {
  const text = String(value || "").trim();
  const invalid = /^(recognition|being_seen|被看见。?|希望被看见。?|得到认可。?|希望得到认可。?|最能看穿自己的人。?|一个能维持自我神话的反应。?|得到一个能支撑自我神话的回应。?)$/;
  const selected = !text || invalid.test(text) ? String(fallback || "").trim() : text;
  if (!selected) return "希望关键的人听完自己的要求，再作出明确回应。";
  return /[。！？]$/.test(selected) ? selected : `${selected}。`;
}

function systemPrompt() {
  return `你是 Character Town 的 CharacterPrivateSimulator。你只模拟一个人物的私人后台，不写完整场景，不替整体剧情做安排。

硬规则：
- 先让欲望、羞耻、记忆、计划和自我神话在人物内部相互撕扯，再生成行动候选。
- 输出的是私人模拟，不是公开叙事；其他人物暂时看不见这些内容。
- 每个行动必须至少有表层理由、欲望理由、羞耻理由、权力理由、自欺理由、阴影收益和事后自我惩罚。
- 计划不是剧情；计划是人物进入场景前对自己的谎言。必须说明本轮如何执行、扭曲、背叛或暴露计划。
- 如果有记忆，不能只写“想起”；必须把记忆转成动作、沉默、证据、删改、保存、误读、保护、报复或自毁。
- 人物并不被固定在开场地点。必须独立判断此刻是留下还是离开：欲望、羞耻、恐惧、暴露风险和巨大压力会推高 exitUrgency；依赖、保护、职责、承诺、出口封锁和未完成目标会推高 exitResistance。
- 人物先有 currentActivity，再观察眼前的人和事。reactionIntent 只能从 continue、talk、wait、leave 中选择：同处一地不等于必须交谈；只有观察足以打断当前活动时才选择 talk，并说明 reactionReason、conversationObjective 和 conversationEndCondition。
- 如果别人只是经过、双方行动互不妨碍，或当前活动更紧迫，选择 continue。若资源或路径冲突但没有必要交谈，可以选择 wait。不要为了产出对白而选择 talk。
- 当离开欲望明显超过阻力时，presenceIntent 必须是 leave，并给出触发点、真正理由、可见离场动作和另一个有效地点；想走但受阻时仍填写 leave，让共享场景裁决是否走成。
- 不能为了维持群戏而强迫人物留下，也不能把离开当作抽象心理；离开必须是下一拍可以执行的身体行动。
- 不把人物写成正确答案；高尚里要有污染，恶意里要有爱、恐惧、求救或自毁。
- whatTheyWantFromOthers 必须是人物希望具体对象怎样回应自己的完整句子；不能只写人名、抽象标签、recognition、being_seen 或“被看见”。
- 不写露骨性内容；成人欲望用注意力、等待、语言、权力、证据、误读和关系行动表达。
- 只输出 JSON，严格匹配 schema。`;
}

export function buildPrivateSimulationUserPrompt({ compact, character, targetId }) {
  const target = compact.activeCharacters.find((item) => item.id === targetId) || compact.activeCharacters.find((item) => item.id !== character.id) || character;
  const plan = activePlanForPrivate(character, compact);
  const planContext = planPressureLine(plan, compact) || "当前自主计划压力：无显式计划。";
  return `请为单一人物生成私人内心模拟。

人物：${character.name} / ${character.id}
目标对象：${target.name || target.id}
播放粒度：${compact.ui.timeGrain || "scene"}
场所：${compact.selectedLocation.name} / ${compact.selectedLocation.subtext || compact.selectedLocation.powerRule || ""}
可去地点：${JSON.stringify((compact.availableLocations || []).filter((location) => location.id !== compact.selectedLocation.id), null, 2)}
操盘指令：${compact.ui.userDirective || "无"}
注入事件：${compact.ui.injectedEvent || "无"}
操盘干预：
${interventionPromptBlock({ ...compact, interventions: compact.activeInterventions, characters: compact.activeCharacters })}

${relationshipDialoguePromptContext({ compact, character, targetId: target.id })}

${planContext}

人物卡：
${JSON.stringify(privatePromptCharacterCard(character, compact), null, 2)}

人物相关状态、计划、记忆、证据、谣言：
${JSON.stringify(relevantContextFor(character, compact, target.id), null, 2)}

输出字段必须具体、可表演、可被场景互动模拟器使用。不要写完整场景；只写这个人物此刻的私人后台和行动候选。`;
}

function stripBackendActionLanguage(text = "") {
  return String(text || "")
    .replace(/关系状态：[^。！？]*[。！？]?/g, "")
    .replace(/下一步[^。！？]*[。！？]?/g, "")
    .replace(/currentConstraint[^。！？]*[。！？]?/gi, "")
    .replace(/actionCandidate[^。！？]*[。！？]?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function observableActionFromPrivateSimulation(sim = {}) {
  const actor = sim.characterName || sim.characterId || "有人";
  const target = sim.targetCharacterName || sim.targetCharacterId || "对方";
  const state = sim.relationshipState || null;
  const object = state?.sharedObject || sim.agentProfile?.leverageObject || "手边物件";
  const finalTurn = state?.finalTurn ? ` ${actor}低声说：“${state.finalTurn}。”` : "";
  if (state?.kind === "protect") {
    const place = /医坊|药炉/.test(state.locationName || "") ? "药炉旁" : "身前";
    return `${actor}把${object}按在${place}，挡住${target}看向伤者的路。${finalTurn}`.trim();
  }
  if (state?.kind === "control") {
    return `${actor}把${object}推到两人中间，指尖停在见证处，没有让${target}先收回手。${finalTurn}`.trim();
  }
  if (state?.kind === "bargain") {
    return `${actor}把${object}压到账册边，没有让它直接进账，目光停在${target}手上。${finalTurn}`.trim();
  }
  if (state?.kind === "withdraw") {
    return `${actor}退开半步，却把${object}留在原处，让${target}不得不看见它。${finalTurn}`.trim();
  }
  if (state?.kind === "accuse") {
    return `${actor}把${object}推回明处，等${target}先报出名字。${finalTurn}`.trim();
  }
  const stripped = stripBackendActionLanguage(sim.actionCandidate || "");
  if (stripped && !/关系状态|下一步|后台|private|simulation|actionCandidate|currentConstraint/i.test(stripped)) return stripped;
  return `${actor}把${object}留在两人中间，等${target}先回应。`;
}

export function privateSimulationToAgentOutput(sim = {}) {
  const visibleAction = observableActionFromPrivateSimulation(sim);
  return {
    characterId: sim.characterId || "unknown_character",
    targetCharacterId: sim.targetCharacterId || "unknown_target",
    tone: sim.tone || "试探",
    visibleAction,
    hiddenAction: sim.privateDesire || "想被看见。",
    defenseAction: sim.defensiveMask || "把欲望改名为原则。",
    shadowAction: sim.shadowImpulse || "用体面语言索取回应。",
    selfDeceptionSentence: sim.selfLie || "我只是按原则行事。",
    wantsFromOthers: sim.whatTheyWantFromOthers || sim.wantsFromOthers || "希望对方追问。",
    desiredEmotionalResponse: sim.desiredEmotionalResponse || sim.wantsFromOthers || "追问、迟疑或继续等待解释。",
    possibleHarm: sim.riskTheyWillCreate || sim.riskCreated || "让对方把自己的反应误认为问题本身。",
    possibleNobleAction: sim.nobleImpulse || "减少他人伤害。",
    possibleEvidenceLeft: sim.possibleEvidenceLeft || sim.riskTheyWillCreate || sim.riskCreated || (sim.withheldFacts || [])[0] || "一次可以被误读的沉默。",
    surfaceJustification: sim.surfaceJustification || sim.publicGoal || "表面上只是按规则推进。",
    desireReason: sim.desireReason || sim.privateDesire || "想被看见。",
    shameReason: sim.shameReason || sim.whatTheyRefuseToAdmit || sim.refusesToAdmit || "害怕欲望被命名。",
    powerReason: sim.powerReason || "保留解释权。",
    selfDeceptionReason: sim.selfDeceptionReason || sim.defensiveMask || "把欲望改名为原则。",
    unadmittedPleasure: sim.unadmittedPleasure || "对方被自己影响。",
    postActionSelfPunishment: sim.postActionSelfPunishment || "事后重放并删改这次动作。",
    memoryId: sim.sourceMemoryId || sim.memoryId || null,
    memoryInfluence: sim.memoryTension || sim.memoryInfluence || sim.memoryLine || "",
    planId: sim.sourcePlanId || sim.planId || null,
    planInfluence: sim.planTension || sim.planInfluence || sim.planLine || "",
    planNextAction: sim.planNextAction || sim.actionCandidate || "",
    planStatus: sim.planStatus || (sim.sourcePlanId || sim.planId ? "active" : "implicit"),
    realtimePublicGoal: sim.publicGoal || "维持表面身份。",
    realtimePrivateDesire: sim.privateDesire || "想被看见。",
    realtimeDefensiveMask: sim.defensiveMask || "把欲望改名为原则。",
    realtimeShadowImpulse: sim.shadowImpulse || "用体面语言索取回应。",
    realtimeNobleImpulse: sim.nobleImpulse || "减少他人伤害。",
    realtimeLieToSelf: sim.selfLie || "我只是按原则行事。",
    realtimeActionCandidate: sim.actionCandidate || sim.tone || "试探",
    realtimePressure: Number(sim.pressure ?? 50),
    realtimeContradictionScore: Number(sim.contradictionScore ?? 55),
    currentActivity: sim.currentActivity || sim.actionCandidate || "继续眼前的事",
    activityDurationTicks: Number(sim.activityDurationTicks || 2),
    reactionIntent: sim.reactionIntent || "continue",
    reactionTargetCharacterId: sim.reactionTargetCharacterId || sim.targetCharacterId || "",
    reactionReason: sim.reactionReason || "",
    conversationObjective: sim.conversationObjective || "",
    conversationEndCondition: sim.conversationEndCondition || "",
    presenceIntent: sim.presenceIntent || "stay",
    exitUrgency: Number(sim.exitUrgency ?? 20),
    exitResistance: Number(sim.exitResistance ?? 55),
    exitTrigger: sim.exitTrigger || "",
    exitReason: sim.exitReason || "",
    desiredDestinationId: sim.desiredDestinationId || "",
    departureMethod: sim.departureMethod || "",
    visibilityFacts: Array.isArray(sim.visibilityFacts) ? sim.visibilityFacts : [],
    falseBeliefs: Array.isArray(sim.falseBeliefs) ? sim.falseBeliefs : [],
    withheldFacts: Array.isArray(sim.withheldFacts) ? sim.withheldFacts : [],
  };
}

async function emitAgentProgress(onProgress, event) {
  if (typeof onProgress !== "function") return;
  try {
    await onProgress(event);
  } catch {
    // Progress reporting must never change a character's simulation result.
  }
}

export async function runPrivateSimulators(compact, { signal, onProgress, context = {} } = {}) {
  const characters = compact.activeCharacters || [];
  const groupController = new AbortController();
  const abortFromParent = () => groupController.abort(signal?.reason);
  if (signal?.aborted) abortFromParent();
  else signal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    const results = await Promise.all(characters.map(async (character, index) => {
      const targetId = targetFor(character, compact);
      const startedAt = Date.now();
      await emitAgentProgress(onProgress, {
        type: "agent_thinking",
        characterId: character.id,
        characterName: character.name,
        targetCharacterId: targetId,
        index,
        total: characters.length,
        ...context,
      });
      try {
        const { parsed, meta } = await callOpenAIJson({
          system: systemPrompt(),
          user: buildPrivateSimulationUserPrompt({ compact, character, targetId }),
          schema: privateSimulationSchema,
          schemaName: "character_town_private_simulation",
          schemaHintMode: compact.pipelineMode === "fast" || compact.pipelineMode === "balanced" ? "compact" : "full",
          signal: groupController.signal,
        });
        const simulation = normalizePrivateSimulation(parsed, compact, character, targetId);
        const elapsedMs = Date.now() - startedAt;
        await emitAgentProgress(onProgress, {
          type: "agent_ready",
          characterId: character.id,
          characterName: character.name,
          targetCharacterId: targetId,
          index,
          total: characters.length,
          elapsedMs,
          ...context,
        });
        return {
          simulation,
          agentOutput: privateSimulationToAgentOutput(simulation),
          stage: {
            name: `CharacterPrivateSimulator:${character.name}`,
            provider: "openai",
            model: meta.model,
            elapsedMs,
            responseId: meta.responseId,
          },
        };
      } catch (error) {
        groupController.abort(error);
        await emitAgentProgress(onProgress, {
          type: "agent_failed",
          characterId: character.id,
          characterName: character.name,
          index,
          total: characters.length,
          error: error?.message || String(error),
          ...context,
        });
        throw error;
      }
    }));

    return {
      privateSimulations: results.map((result) => result.simulation),
      agentOutputs: results.map((result) => result.agentOutput),
      stages: results.map((result) => result.stage),
    };
  } finally {
    signal?.removeEventListener("abort", abortFromParent);
  }
}
