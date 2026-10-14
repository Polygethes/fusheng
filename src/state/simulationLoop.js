import { createId } from "../data/seed.js";
import { ensureCharacterPlans, getCharacterPlan, summarizePlan } from "./intentPlanner.js";
import { activeInterventionsForState, summarizeIntervention } from "./interventions.js";

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}

function getName(state, id) {
  return (state.characters || []).find((character) => character.id === id)?.name || id || "未知人物";
}

export function getActiveCharacters(state) {
  const ids = state.ui?.activeCharacterIds?.length ? state.ui.activeCharacterIds : (state.characters || []).slice(0, 2).map((character) => character.id);
  const set = new Set(ids);
  const selected = (state.characters || []).filter((character) => set.has(character.id));
  return selected.length ? selected : (state.characters || []).slice(0, 2);
}

export function getSelectedLocation(state) {
  const id = state.ui?.selectedLocationId || state.locations?.[0]?.id;
  return (state.locations || []).find((location) => location.id === id) || (state.locations || [])[0] || {
    id: "loc_virtual",
    name: "未命名场所",
    subtext: "空白场所会把人物的自我解释放大。",
    powerRule: "没有明确规则时，人物会把缺口当成自己的舞台。",
    likelyEvents: ["一次无人能准确解释的停顿"],
  };
}

function scoreRelationship(rel) {
  if (!rel) return 0;
  return Number(rel.attraction || 0) + Number(rel.resentment || 0) + Number(rel.wantsToBeSeen || 0) + Number(rel.deception || 0) + Number(rel.revenge || 0) + Number(rel.protection || 0) + Number(rel.power || 0);
}

function strongestRelationship(state, characterId, activeIds = []) {
  return (state.relationships || [])
    .filter((rel) => rel.fromCharacterId === characterId)
    .filter((rel) => !activeIds.length || activeIds.includes(rel.toCharacterId))
    .sort((a, b) => scoreRelationship(b) - scoreRelationship(a))[0] || null;
}

function memoryHeat(memory) {
  const typeWeight = { accurate: 0, selective: 12, misremembered: 20, suppressed: 24, fabricated: 28, weaponized: 26 }[memory?.type] || 8;
  return Number(memory?.heat || 0) + typeWeight + (100 - Number(memory?.reliability ?? 55)) / 2;
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

function memoryTargetIsInScope(memory = {}, characterId = "", { targetId = "", activeIds = [] } = {}) {
  const memoryTargetId = memory.targetCharacterId || "";
  if (!memoryTargetId) return true;
  if (memoryTargetId === characterId) return true;
  if (targetId && memoryTargetId === targetId) return true;
  return activeIds.includes(memoryTargetId);
}

function relevantMemories(state, characterId, activeIds = [], context = {}) {
  const branchId = state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
  return (state.characterMemories || [])
    .filter((memory) => !memory.branchId || memory.branchId === branchId)
    .filter((memory) => memory.characterId === characterId || memory.targetCharacterId === characterId || activeIds.includes(memory.targetCharacterId))
    .filter((memory) => memoryTargetIsInScope(memory, characterId, { ...context, activeIds }))
    .sort((a, b) => (memoryHeat(b) + memoryContextScore(b, context)) - (memoryHeat(a) + memoryContextScore(a, context)));
}

function overheardMemoryTarget(state, character, activeIds = [], location = null) {
  const branchId = state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
  const candidates = (state.characterMemories || [])
    .filter((memory) => !memory.branchId || memory.branchId === branchId)
    .filter((memory) => memory.characterId === character.id)
    .filter((memory) => memory.targetCharacterId && memory.targetCharacterId !== character.id && activeIds.includes(memory.targetCharacterId))
    .filter((memory) => memory.sourceRelationshipShift?.relationshipSource === "overheard-dialogue")
    .map((memory) => ({
      memory,
      score: memoryHeat(memory) + memoryContextScore(memory, { location, activeIds }) + 60,
    }))
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.memory || null;
}

function primaryTarget(state, character, activeCharacters, location = null) {
  const activeIds = activeCharacters.map((item) => item.id).filter((id) => id !== character.id);
  const overheardMemory = overheardMemoryTarget(state, character, activeIds, location);
  if (overheardMemory?.targetCharacterId) {
    return activeCharacters.find((item) => item.id === overheardMemory.targetCharacterId)
      || state.characters.find((item) => item.id === overheardMemory.targetCharacterId);
  }
  const rel = strongestRelationship(state, character.id, activeIds);
  if (rel?.toCharacterId) return activeCharacters.find((item) => item.id === rel.toCharacterId) || state.characters.find((item) => item.id === rel.toCharacterId);
  return activeCharacters.find((item) => item.id !== character.id) || activeCharacters[0] || character;
}

function characterKnownFacts(state, character, activeCharacters, memories) {
  const activeNames = activeCharacters.filter((item) => item.id !== character.id).map((item) => item.name).join("、") || "自己";
  const recentRumor = (state.rumors || [])[0];
  const recentEvidence = (state.evidence || [])[0];
  return [
    `${character.name}知道本轮场景里还有：${activeNames}。`,
    recentRumor ? `${character.name}知道或听说过谣言：${recentRumor.content || recentRumor.title || recentRumor.id}` : `${character.name}没有稳定谣言可依赖。`,
    recentEvidence ? `${character.name}知道存在一条可被误读的证据：${recentEvidence.title || recentEvidence.content || recentEvidence.id}` : `${character.name}暂时缺少硬证据，只能使用表情、停顿和措辞。`,
    memories[0] ? `${character.name}携带高热记忆：${memories[0].privateVersion || memories[0].content || memories[0].id}` : `${character.name}没有显式记忆，只能让自我神话替代记忆。`,
  ];
}

function characterBlindSpots(character, memories) {
  const lie = character.currentState?.currentSelfLie || character.internalSituation?.repeatedSelfLie || "我只是按原则行事。";
  const memory = memories[0];
  return [
    `${character.name}最可能把“${lie}”当成事实。`,
    memory ? `${character.name}会把这段${memory.type || "selective"}记忆当成当前判断，而不承认它已被${memory.distortion || "自我神话"}扭曲。` : `${character.name}会把缺失记忆补成适合自己的证词。`,
  ];
}

export function buildVisibilityLayer(state, activeCharacters = getActiveCharacters(state), location = getSelectedLocation(state)) {
  const activeIds = activeCharacters.map((character) => character.id);
  const activeInterventions = activeInterventionsForState(state);
  const visibleFacts = [
    `地点：${location.name}`,
    `场所表层用途：${location.surfaceUse || location.subtext || "未定义"}`,
    state.ui?.injectedEvent ? `注入意外：${state.ui.injectedEvent}` : "本轮没有显式意外，沉默本身会成为意外。",
    activeInterventions.length ? `操盘干预可见压力：${activeInterventions.map((item) => summarizeIntervention(item, state)).join("；")}` : "没有显式操盘干预。",
  ];
  const hiddenFacts = [
    `场所潜规则：${location.powerRule || "谁掌握解释权，谁就能让别人先开口。"}`,
    ...(state.secrets || []).slice(0, 3).map((secret) => `秘密：${secret.content || secret.title || secret.id}`),
    ...(state.irreversibleTraces || []).slice(0, 3).map((trace) => `不可逆痕迹：${trace.content || trace.title || trace}`),
  ];
  const perCharacter = activeCharacters.map((character) => {
    const target = primaryTarget(state, character, activeCharacters, location);
    const memories = relevantMemories(state, character.id, activeIds, { location, targetId: target?.id || "", activeIds });
    const rel = (state.relationships || []).find((item) => item.fromCharacterId === character.id && item.toCharacterId === target?.id);
    return {
      characterId: character.id,
      characterName: character.name,
      targetCharacterId: target?.id || character.id,
      targetCharacterName: target?.name || character.name,
      knownFacts: characterKnownFacts(state, character, activeCharacters, memories),
      blindSpots: characterBlindSpots(character, memories),
      falseBeliefs: [
        `${character.name}可能误以为${target?.name || "对方"}的反应主要是在回应自己。`,
        rel?.misreading || `${character.name}还没有稳定误读，于是更容易临场发明误读。`,
      ],
      secretLevers: [
        character.innerCourt?.hiddenEvidence || "没有明确隐藏证据。",
        character.triggers?.collapse?.[0] || "被剥夺解释权。",
      ],
    };
  });
  return { visibleFacts, hiddenFacts, perCharacter };
}

function inferPrivateTone(character, rel, memory, plan) {
  const st = character.currentState || {};
  if (plan?.status === "frozen") return "伪装";
  if (plan?.currentTactic === "self_destroy") return "自毁";
  if (plan?.currentTactic === "plant_evidence" || plan?.currentTactic === "betray") return "陷害";
  if (plan?.currentTactic === "protect") return "保护";
  if (plan?.currentTactic === "punish") return "惩罚";
  if (plan?.currentTactic === "control") return "伪装";
  if (memory?.type === "weaponized" || memory?.stance === "revenge") return "惩罚";
  if (memory?.type === "suppressed") return "撤退";
  const control = relationshipControlPressure(rel);
  if (control > 130) return "陷害";
  if (control > 80) return "伪装";
  if (Number(st.desire || 0) + Number(rel?.attraction || 0) + Number(rel?.wantsToBeSeen || 0) > 150) return "接近";
  if (Number(st.revengeImpulse || 0) + Number(st.rage || 0) > 90) return "惩罚";
  if (Number(st.protectionImpulse || 0) + Number(rel?.protection || 0) > 90) return "保护";
  return "试探";
}

function relationshipControlPressure(rel = null) {
  if (!rel) return 0;
  return Number(rel.power || 0) + Number(rel.deception || 0) * 0.4 + Number(rel.shame || 0) * 0.2;
}

function relationshipControlPressureLine(rel = null, actorName = "有人", targetName = "对方") {
  if (relationshipControlPressure(rel) <= 80) return "";
  return `${actorName}和${targetName}之间的解释权开始失衡，${actorName}会先把动作退回规矩和命名权里。`;
}

function contradictionScore(character, rel, memory, plan) {
  const st = character.currentState || {};
  return clamp(
    Number(st.desire || 0) * 0.18 + Number(st.shame || 0) * 0.16 + Number(st.selfDeception || 0) * 0.16 +
    Number(st.revengeImpulse || 0) * 0.12 + Number(st.protectionImpulse || 0) * 0.1 + Number(rel?.deception || 0) * 0.1 +
    Number(rel?.power || 0) * 0.12 +
    memoryHeat(memory) * 0.12 + Number(plan?.pressure || 0) * 0.16
  );
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

function relationshipDialogueActLine(dialogue = null) {
  const act = dialogue?.relationshipDialogueAct;
  const reason = String(act?.reason || "").trim();
  if (!reason) return "";
  const kind = String(act?.kind || "").trim();
  return `关系动作${kind ? `/${kind}` : ""}：${reason}`;
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
    eventOutcome: dialogue.eventOutcome || "",
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

function relationshipDialogueHistoryTranscriptLine(history = []) {
  const recent = Array.isArray(history) ? history : [];
  if (recent.length < 2) return "";
  const lines = recent
    .map((dialogue) => relationshipDialogueTranscriptLine(dialogue))
    .filter(Boolean);
  return lines.length ? `连续关系对白：${lines.join(" ")}` : "";
}

function recentDialogueLinesForCharacter(state, characterId) {
  if (!characterId) return [];
  const lines = [];
  const pushTurn = (turn) => {
    if (!turn || turn.speakerId !== characterId || !turn.line) return;
    lines.push(String(turn.line));
  };
  for (const rel of state.relationships || []) {
    for (const dialogue of rel.dialogueHistory || []) {
      (dialogue.dialogueTurns || []).forEach(pushTurn);
      if ((rel.fromCharacterId === characterId || rel.toCharacterId === characterId) && dialogue.followupTurn) {
        lines.push(String(dialogue.followupTurn));
      }
    }
    const last = rel.lastDialogue || null;
    if (last) {
      (last.dialogueTurns || []).forEach(pushTurn);
      if ((rel.fromCharacterId === characterId || rel.toCharacterId === characterId) && last.followupTurn) {
        lines.push(String(last.followupTurn));
      }
    }
  }
  for (const memory of state.characterMemories || []) {
    if (memory.characterId !== characterId && memory.targetCharacterId !== characterId) continue;
    const shift = memory.sourceRelationshipShift || {};
    (shift.dialogueTurns || []).forEach(pushTurn);
    if (shift.followupTurn) lines.push(String(shift.followupTurn));
    if (shift.finalTurn) lines.push(String(shift.finalTurn));
  }
  return [...new Set(lines.filter(Boolean))].slice(-24);
}

export function simulatePrivateCharacter({ state, character, activeCharacters, location, visibilityLayer }) {
  const activeIds = activeCharacters.map((item) => item.id);
  const target = primaryTarget(state, character, activeCharacters, location);
  const rel = (state.relationships || []).find((item) => item.fromCharacterId === character.id && item.toCharacterId === target?.id) || null;
  const memory = relevantMemories(state, character.id, activeIds, { location, targetId: target?.id || "", activeIds })[0] || null;
  const relationshipDialogueMemory = rel?.lastDialogue || null;
  // Recall-only view of the pair's last exchange: what the two of them said to
  // each other belongs to both, whichever way the relationship record points.
  // Deliberately NOT fed into tone, relationship state or history — those keep
  // the directional view — so only speech recall becomes direction-free.
  const pairDialogueMemory = relationshipDialogueMemory
    || ((state.relationships || []).find((item) => (
      item.fromCharacterId === target?.id && item.toCharacterId === character.id
    ))?.lastDialogue || null);
  const relationshipDialogueHistoryAll = Array.isArray(rel?.dialogueHistory) ? rel.dialogueHistory.filter(Boolean) : [];
  const relationshipDialogueHistory = relationshipDialogueHistoryAll.slice(-3);
  const plan = getCharacterPlan({ ...state, characterPlans: ensureCharacterPlans(state) }, character.id);
  const tone = inferPrivateTone(character, rel, memory, plan);
  const score = contradictionScore(character, rel, memory, plan);
  const agentProfile = character.agentProfile || null;
  const leverageObject = agentProfile?.leverageObject || "";
  const memorySharedObject = memory?.sourceRelationshipShift?.sharedObject || relationshipDialogueMemory?.sharedObject || "";
  const memoryLine = memory?.privateVersion || memory?.content || memory?.id || "";
  const relationshipMemoryLine = relationshipDialogueMemory
    ? [
        `${relationshipDialogueMemory.sharedObject || "那件东西"}上次已经留在场中；${relationshipDialogueMemory.followupTurn || relationshipDialogueMemory.finalTurn || relationshipDialogueMemory.eventOutcome || ""}`,
        relationshipDialogueActLine(relationshipDialogueMemory),
      ].filter(Boolean).join(" ")
    : "";
  const relationshipState = relationshipStateFromDialogue(rel, character.name, target?.name || "对方");
  const relationshipStateText = relationshipStateLine(relationshipState);
  const relationshipDialogueTranscript = relationshipDialogueTranscriptLine(relationshipDialogueMemory);
  const relationshipDialogueHistoryTranscript = relationshipDialogueHistoryTranscriptLine(relationshipDialogueHistory);
  const controlPressureLine = relationshipControlPressureLine(rel, character.name, target?.name || "对方");
  const selfLie = character.currentState?.currentSelfLie || character.internalSituation?.repeatedSelfLie || "我只是按原则行事。";
  const publicGoal = agentProfile?.dramaticObjective
    ? `${character.actionLines?.visible || "维持表面身份"}，用${leverageObject || "手边物件"}推进：${agentProfile.dramaticObjective}`
    : character.actionLines?.visible || "维持表面身份。";
  const privateDesire = agentProfile?.dramaticObjective || character.actionLines?.desire || character.internalSituation?.inadmissibleDesire || "想被看见。";
  const defensiveMask = agentProfile?.dialogueMoves?.[0] || character.actionLines?.defense || `把欲望改名为：“${selfLie}”。`;
  const shadowImpulse = character.actionLines?.shadow || "用体面语言索取对方反应。";
  const nobleImpulse = (character.nobleActions || [])[0] || "在关键时刻减少他人伤害。";
  const leveragePhrase = leverageObject ? `借${leverageObject}` : "用一个普通动作";
  const candidateByTone = {
    惩罚: `${character.name}会${leveragePhrase}压住${target?.name || "对方"}，让对方先怀疑自己。`,
    接近: `${character.name}会${leveragePhrase}制造一个正当理由靠近${target?.name || "对方"}。`,
    伪装: `${character.name}会把${leverageObject || "动作"}退回程序，让真正意图躲进规则。`,
    保护: `${character.name}会先护住${leverageObject || target?.name || "对方"}，再让这种保护成为关系债。`,
    撤退: `${character.name}会把${leverageObject || "显性动作"}留在场中，自己撤到别人必须追问的位置。`,
    自毁: `${character.name}会把${leverageObject || "解释权"}交出去，让自己失去退路。`,
    陷害: `${character.name}会移动${leverageObject || "一条证据"}，让别人替自己命名这段关系。`,
    试探: `${character.name}会${leveragePhrase}试探${target?.name || "对方"}是否听懂裂缝。`,
  };
  const visibility = (visibilityLayer?.perCharacter || []).find((item) => item.characterId === character.id);
  const baseActionCandidate = candidateByTone[tone] || candidateByTone.试探;
  const actionCandidate = relationshipState
    ? `${baseActionCandidate} ${relationshipStateText}`
    : baseActionCandidate;
  const conversationObjective = character.agentProfile?.desiredResponse
    || character.internalSituation?.desiredResponse
    || character.innerCourt?.desiredResponse
    || privateDesire;
  return {
    id: createId("privsim"),
    characterId: character.id,
    characterName: character.name,
    agentProfile,
    targetCharacterId: target?.id || character.id,
    targetCharacterName: target?.name || character.name,
    tone,
    publicGoal,
    privateDesire,
    defensiveMask,
    shadowImpulse,
    nobleImpulse,
    selfLie,
    actionCandidate,
    conversationObjective,
    conversationEndCondition: character.agentProfile?.responseBoundary
      || "对方作出明确回应、明确拒绝，或其中一人决定离开。",
    reactionReason: relationshipStateText
      || `${target?.name || "对方"}的行动正在妨碍${character.name}推进自己的当前目标。`,
    whatTheyWantFromOthers: character.agentProfile?.desiredResponse
      || character.internalSituation?.desiredResponse
      || character.innerCourt?.desiredResponse
      || "希望关键的人听完自己的要求，再作出明确回应。",
	    whatTheyRefuseToAdmit: memory
	      ? `这段记忆正在替他/她选择动作：${[memoryLine, relationshipStateText].filter(Boolean).join(" ")}`
	      : relationshipDialogueMemory
	        ? `上一轮没结清的话正在替他/她选择动作：${[relationshipMemoryLine, relationshipStateText, relationshipDialogueTranscript].filter(Boolean).join(" ")}`
	        : controlPressureLine || privateDesire,
    riskTheyWillCreate: `${target?.name || "对方"}可能把这个动作误读成${tone === "保护" ? "保护，也可能是占有" : tone === "惩罚" ? "标准，也可能是报复" : "普通互动，也可能是信号"}。`,
    planTension: plan ? summarizePlan(plan, state) : "没有显式计划，人物会把临场冲动伪装成自然反应。",
	    memoryTension: memory
	      ? `${memory.type || "selective"}/${memory.stance || "confusion"}：${[memory.publicVersion || memory.content || memory.id, relationshipStateText].filter(Boolean).join(" ")}`
	      : relationshipDialogueMemory
	        ? `relationship-last-dialogue：${[relationshipMemoryLine, relationshipStateText, relationshipDialogueTranscript].filter(Boolean).join(" ")}`
	        : controlPressureLine || "没有显式记忆压力。",
    memorySource: memory?.source || (relationshipDialogueMemory ? "agent_dialogue_relationship" : ""),
    memorySharedObject,
    pairDialogueMemory,
    relationshipState,
    relationshipDialogueMemory,
    relationshipDialogueTranscript,
    relationshipDialogueHistory,
    relationshipDialogueHistoryTranscript,
    recentDialogueLines: recentDialogueLinesForCharacter(state, character.id),
    relationshipHistoryCount: relationshipDialogueHistoryAll.length,
    memoryDialogueEcho: memory?.source === "agent_dialogue_relationship" || relationshipDialogueMemory
      ? `${memorySharedObject || "那件东西"}上次已经留在场中；${[memoryLine || relationshipMemoryLine, relationshipStateText, relationshipDialogueTranscript, relationshipDialogueHistoryTranscript].filter(Boolean).join(" ")}`
      : "",
    visibilityBlindSpot: visibility?.blindSpots?.[0] || "盲点未定义。",
    contradictionScore: score,
    locationId: location.id,
    locationName: location.name,
    sourcePlanId: plan?.id || null,
    sourceMemoryId: memory?.id || null,
    simulationReason: `私人模拟先于场景合成：${character.name}不是执行剧情，而是在${location.name}中把${privateDesire}伪装成${defensiveMask}。`,
  };
}

export function buildSimulationTick(state) {
  const location = getSelectedLocation(state);
  const activeCharacters = getActiveCharacters(state);
  const visibilityLayer = buildVisibilityLayer(state, activeCharacters, location);
  const privateSimulations = activeCharacters.map((character) => simulatePrivateCharacter({ state, character, activeCharacters, location, visibilityLayer }));
  const averageContradiction = clamp(privateSimulations.reduce((sum, item) => sum + Number(item.contradictionScore || 0), 0) / Math.max(privateSimulations.length, 1));
  const hiddenFactPressure = clamp((visibilityLayer.hiddenFacts || []).length * 14 + (state.ui?.eventImpact || 0) * 0.35 + averageContradiction * 0.55);
  return {
    id: createId("tick"),
    createdAt: new Date().toISOString(),
    branchId: state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main",
    grain: state.ui?.timeGrain || "scene",
    mode: "tick_based_realtime",
    locationId: location.id,
    locationName: location.name,
    activeCharacterIds: activeCharacters.map((character) => character.id),
    visiblePressure: visibilityLayer.visibleFacts.join("；"),
    hiddenPressure: visibilityLayer.hiddenFacts.join("；"),
    visibilityLayer,
    privateSimulations,
    contradictionPressureSummary: {
      averageContradiction,
      hiddenFactPressure,
      highest: privateSimulations.slice().sort((a, b) => b.contradictionScore - a.contradictionScore)[0] || null,
    },
  };
}

function reciprocalMisread(state, source, target) {
  return `${target.characterName}可能把${source.characterName}的“${source.actionCandidate}”读成${source.tone === "惩罚" ? "标准，也可能读成报复" : source.tone === "保护" ? "善意，也可能读成占有" : "普通互动，也可能读成召唤"}。`;
}

function extractQuotedSpeech(text = "") {
  const matches = [...String(text || "").matchAll(/[“"「『]([^”"」』]+)[”"」』]/g)];
  return (matches[0]?.[1] || "").trim();
}

function normalizeDialogueLine(text = "") {
  const cleaned = String(text || "")
    .replace(/[“”"「」『』]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const deduped = collapseRepeatedObjectOpenings(collapseAdjacentDialogueFragments(cleaned));
  return /[。！？…]$/.test(deduped) ? deduped : `${deduped}。`;
}

function normalizeQuestionLine(text = "") {
  const line = normalizeDialogueLine(text);
  if (!line) return "";
  return /[？?]$/.test(line) ? line : `${line.replace(/[。！…]+$/g, "")}？`;
}

function pairedObjectsPhrase(left = "", right = "", fallback = "这件东西") {
  const first = normalizeOutcomeObject(left) || normalizeOutcomeObject(fallback) || "这件东西";
  const second = normalizeOutcomeObject(right) || first;
  return sameOutcomeObject(first, second) ? first : `${first}和${second}`;
}

function collapseRepeatedObjectOpenings(text = "") {
  return String(text || "").replace(
    /(灵契|庇护牌|魔印|妖丹盒|照骨镜|渡令|魂灯|停剑令|契牌|符|符箓)([^。！？；]{0,28})([；。！？])(灵契|庇护牌|魔印|妖丹盒|照骨镜|渡令|魂灯|停剑令|契牌|符|符箓)([^。！？；]{1,})/g,
    (match, firstObject, middle, punctuation, repeatedObject, following) => {
      if (firstObject !== repeatedObject) return match;
      if (/^(?:压进|压在|压回|推到|推回|扣在|按在|放在|留在|留给|停在|照在|挨着|贴着|没有离开|不离|不能|还在|先压)/.test(following)) {
        return match;
      }
      return `${firstObject}${middle}${punctuation}它${following}`;
    },
  );
}

function collapseAdjacentDialogueFragments(text = "") {
  return String(text || "")
    .replace(/([，,。！？；;])([^，,。！？；;]{3,18})([。！？；;])\2([，,。！？；;])/g, "$1$2$4")
    .replace(/^([^，,。！？；;]{3,18})([。！？；;])\1([，,。！？；;])/, "$1$3");
}

function fallbackDialogueLine({ speakerName = "有人", targetName = "对方", locationName = "", sharedObject = "", role = "source" } = {}) {
  if (/法契|契门|界石/.test(locationName)) {
    return role === "source" ? "印可以等，契牌不能离盘。" : "我押符，不把命交出去。";
  }
  if (/无咎市|市/.test(locationName)) {
    return role === "source" ? "先验货，再谈价。" : "价可以试，禁名别写进账。";
  }
  if (/照骨司|镜塔|档案/.test(locationName)) {
    return role === "source" ? "镜面照灵痕，不听空口。" : "牌在这里，供词不能改。";
  }
  if (/归墟|渡/.test(locationName)) {
    return role === "source" ? "渡令先停，水阵不开。" : "人能过，追杀不能过。";
  }
  if (/万灵|医坊/.test(locationName)) {
    return role === "source" ? "药炉前先救命。" : "牌扣在这儿，谁也别拖人。";
  }
  if (/停剑|茶楼/.test(locationName)) {
    return role === "source" ? "剑不上桌，话可以上桌。" : "令牌放下，再谈规矩。";
  }
  const object = sharedObject || "这件东西";
  return role === "source" ? `${targetName}，${object}压在这里。` : `${speakerName}只认眼前这一件。`;
}

const DIALOGUE_ANCHORS = [
  "青瓷杯",
  "杯口",
  "红绳",
  "绳子",
  "城法",
  "城规",
  "宗门",
  "私仇",
  "血仇",
  "证据",
  "照骨司",
  "灵契",
  "契牌",
  "符",
  "旧案",
  "价码",
  "药炉",
  "救命",
  "审案",
  "正邪",
  "庇护牌",
  "镜面",
  "灵痕",
  "认罪",
  "案卷",
  "渡令",
  "水阵",
  "破禁",
  "供词",
  "魂灯",
  "威胁",
];

function dialogueAnchor(text = "", fallback = "") {
  const cleaned = String(text || "")
    .replace(/[“”"「」『』]/g, "")
    .replace(/[。！？…]+$/g, "")
    .trim();
  const direct = DIALOGUE_ANCHORS.find((anchor) => cleaned.includes(anchor));
  if (direct) return direct;
  const clause = cleaned
    .split(/[，,；;。！？、\s]+/)
    .map((part) => part
      .replace(/^(?:你说|先|再|就|只|按|让|别|不|我|你|他|她|它|这|那)/, "")
      .replace(/(?:先别|不能|不得|不可|不要|不许|先放|先留|先压|还在|已经|没有).*$/u, "")
      .trim())
    .find((part) => part.length >= 2 && part.length <= 8);
  return clause || normalizeOutcomeObject(fallback) || "这件事";
}

function trimSpokenSentence(text = "") {
  return String(text || "")
    .replace(/[。！？…]+$/g, "")
    .trim();
}

function lineMentions(text = "", terms = []) {
  return terms.filter(Boolean).some((term) => String(text || "").includes(term));
}

function stableVariantIndex(key = "", length = 1) {
  const size = Math.max(Number(length) || 1, 1);
  let hash = 0;
  for (const char of String(key || "")) {
    hash = (hash * 31 + char.codePointAt(0)) % 9973;
  }
  return hash % size;
}

function dialogueMemoryPrefix(sim = {}, object = "") {
  // Recall reads the pair's last exchange in both directions: a character keeps
  // their own memory of what was said even when the relationship record points
  // the other way.
  const recallMemory = sim?.pairDialogueMemory || sim?.relationshipDialogueMemory || null;
  if (sim?.memorySource !== "agent_dialogue_relationship" && !recallMemory) return "";
  const item = normalizeOutcomeObject(sim.memorySharedObject || object) || "那件东西";
  // The remembered consequence itself is the strongest memory surface: the
  // character recalls what actually happened last time, not just that the
  // object was present. The two sides of one exchange must not recite the same
  // sentence: whoever closed the remembered exchange recalls their own closing
  // words, the other side recalls the outcome (what actually happened).
  const rememberedTurns = Array.isArray(recallMemory?.dialogueTurns) ? recallMemory.dialogueTurns : [];
  const lastRememberedSpeaker = rememberedTurns.at(-1)?.speakerId || "";
  const iClosedTheExchange = Boolean(lastRememberedSpeaker && sim?.characterId && lastRememberedSpeaker === sim.characterId);
  const rememberedConsequence = normalizeDialogueLine(
    iClosedTheExchange
      ? recallMemory?.followupTurn || recallMemory?.finalTurn || ""
      : recallMemory?.eventOutcome || recallMemory?.followupTurn || "",
  );
  if (rememberedConsequence) {
    const condensed = rememberedConsequence.replace(/[。！？…]+$/g, "").trim();
    const firstClause = condensed.split(/[，；,;]/)[0]?.trim() || "";
    const core = condensed.length <= 24 ? condensed : firstClause;
    if (core && core.length <= 24 && core.length >= 4) return `我记得${core}`;
  }
  const key = `${sim?.characterId || ""}:${sim?.characterName || ""}:${sim?.targetCharacterId || ""}:${item}`;
  const byTone = {
    惩罚: [`上次${item}已经压在这里`, `我记得${item}没有离开`, `${item}上次就压在两人中间`],
    保护: [`刚才${item}没有被带走`, `我记得${item}还留在能救人的地方`, `上次${item}没有交出去`],
    撤退: [`我记得${item}还没离场`, `上次${item}留在原处，人却退开了`, `刚才${item}替谁挡了一步`],
    伪装: [`按刚才的记录，${item}还在原处`, `${item}上次没有完成交割`, `我记得${item}还缺一个印`],
    陷害: [`上次${item}已经露过面`, `刚才${item}不是自己走到这里的`, `${item}上次已经沾了别人的手`],
    接近: [`刚才${item}把我们留在一处`, `我记得${item}让话没有断`, `上次${item}停在你我之间`],
    自毁: [`上次${item}没有替我挡住什么`, `刚才${item}已经把退路压薄了`, `我记得${item}没有替任何人开脱`],
  };
  if (byTone[sim?.tone]) {
    const choices = byTone[sim.tone];
    return choices[stableVariantIndex(key, choices.length)];
  }
  const variants = [
    `刚才${item}还在这里`,
    `上次${item}已经留在场中`,
    `我记得${item}没有离开`,
    `${item}上次就压在两人中间`,
  ];
  return variants[stableVariantIndex(key, variants.length)];
}

function applyDialogueMemoryToSpeech(speech = "", sim = {}, object = "") {
  const normalized = normalizeDialogueLine(speech);
  const prefix = dialogueMemoryPrefix(sim, object);
  if (!normalized || !prefix) return normalized;
  const recalledCore = prefix.replace(/^我记得/, "");
  if (recalledCore && normalized.includes(recalledCore)) return normalized;
  if (/刚才|上次|上一轮|记得|没有忘|还在/.test(normalized)) return normalized;
  return normalizeDialogueLine(`${prefix}。${trimSpokenSentence(normalized)}`);
}

function isContractProcedureObject(text = "") {
  return /灵契|契牌|毒誓符|魔印|符|铜盘|界石|盖印/.test(String(text || ""));
}

function visibleHoldPhrase(item = "这件东西", locationName = "") {
  if (/渡令|水阵/.test(item)) return `${item}停在岸上`;
  if (/药炉|庇护牌/.test(item)) {
    if (/万灵|医坊/.test(locationName)) return `${item}扣在药炉旁`;
    if (/归墟|渡/.test(locationName)) return `${item}停在水线内`;
    if (/无咎市|市/.test(locationName)) return `${item}先压到案台边`;
    if (/法契|契门|界石/.test(locationName)) return `${item}先压到铜盘边`;
    return `${item}先压到明处`;
  }
  if (isContractProcedureObject(item)) return `${item}先压到盘边`;
  if (/无咎市|市/.test(locationName)) return `${item}先压到案台边`;
  if (/照骨司|镜塔|档案/.test(locationName)) return `${item}照在镜下`;
  if (/归墟|渡/.test(locationName)) return `${item}停在水线内`;
  if (/法契|契门|界石/.test(locationName)) return `${item}先压到铜盘边`;
  if (/停剑|茶楼/.test(locationName)) return `${item}先放到桌面`;
  return `${item}先压到明处`;
}

function localInstitutionSurface(locationName = "") {
  if (/法契|契门|界石/.test(locationName)) return "铜盘";
  if (/无咎市|市/.test(locationName)) return "案台";
  if (/照骨司|镜塔|档案/.test(locationName)) return "镜下";
  if (/归墟|渡/.test(locationName)) return "水线";
  if (/万灵|医坊/.test(locationName)) return "药炉旁";
  if (/停剑|茶楼/.test(locationName)) return "桌面";
  return "明处";
}

function localSceneObjectForLocation(locationName = "") {
  if (/法契|契门|界石/.test(locationName)) return "灵契";
  if (/无咎市|市/.test(locationName)) return "妖丹盒";
  if (/照骨司|镜塔|档案/.test(locationName)) return "照骨镜";
  if (/归墟|渡/.test(locationName)) return "渡令";
  if (/万灵|医坊/.test(locationName)) return "庇护牌";
  if (/停剑|茶楼/.test(locationName)) return "停剑令";
  return "凭证";
}

function localPressureObjectForLocation(locationName = "", anchor = "") {
  const normalizedAnchor = normalizeOutcomeObject(anchor);
  const candidates = /法契|契门|界石/.test(locationName)
    ? ["界石光", "铜盘边的冷光", "契牌"]
    : /无咎市|市/.test(locationName)
      ? ["铜夹", "账页", "摊主的笔"]
      : /照骨司|镜塔|档案/.test(locationName)
        ? ["封条", "案卷", "镜下的灵痕"]
        : /归墟|渡/.test(locationName)
          ? ["水痕", "渡令", "湿冷石阶"]
          : /万灵|医坊/.test(locationName)
            ? ["药碗", "庇护牌", "炉火"]
            : /停剑|茶楼/.test(locationName)
              ? ["茶盏", "停剑令", "桌面令牌"]
              : ["见证物", "旁边的记号"];
  return candidates.find((item) => normalizeOutcomeObject(item) !== normalizedAnchor) || candidates[0] || "见证物";
}

function localRecordSurface(locationName = "") {
  if (/法契|契门|界石/.test(locationName)) return "界石";
  if (/无咎市|市/.test(locationName)) return "账册";
  if (/照骨司|镜塔|档案/.test(locationName)) return "案卷";
  if (/归墟|渡/.test(locationName)) return "水阵";
  if (/万灵|医坊/.test(locationName)) return "药册";
  return "记录";
}

function localizeDistrictBoundText(text = "", { locationName = "", object = "" } = {}) {
  let line = String(text || "");
  if (!line) return "";
  const item = localizeSceneObject(object || localSceneObjectForLocation(locationName), locationName) || localSceneObjectForLocation(locationName);
  const surface = localInstitutionSurface(locationName);
  const witness = localWitnessName(locationName);
  const record = localRecordSurface(locationName);
  if (!/无咎市|市/.test(locationName)) {
    line = line
      .replace(/妖丹盒/g, item)
      .replace(/案台/g, surface)
      .replace(/账册|账页/g, record)
      .replace(/摊主/g, witness)
      .replace(/进账/g, `留在${surface}`);
  }
  if (!/归墟|渡/.test(locationName)) {
    line = line
      .replace(/水阵/g, witness)
      .replace(/水线/g, surface)
      .replace(/渡令/g, item)
      .replace(/渡口/g, surface)
      .replace(/潮痕/g, surface)
      .replace(/不离岸/g, `不离${surface}`)
      .replace(/过岸/g, `越过${surface}`)
      .replace(/岸上|岸边/g, `${surface}外`)
      .replace(/开渡/g, "放人")
      .replace(/水路/g, "退路");
  }
  if (!/照骨司|镜塔|档案/.test(locationName)) {
    line = line
      .replace(/照骨镜/g, witness)
      .replace(/案卷/g, record)
      .replace(/镜下/g, surface);
  }
  if (!/法契|契门|界石/.test(locationName)) {
    line = line
      .replace(/铜盘/g, surface)
      .replace(/界石/g, witness)
      .replace(/契牌/g, item);
  }
  return line;
}

function localProcedureAction(locationName = "", item = "这件东西") {
  const object = normalizeOutcomeObject(item) || "这件东西";
  if (/法契|契门|界石/.test(locationName)) return `${object}压进铜盘`;
  if (/无咎市|市/.test(locationName)) return `${object}推上案台`;
  if (/照骨司|镜塔|档案/.test(locationName)) return `${object}先照镜下`;
  if (/归墟|渡/.test(locationName)) return `${object}先停水线`;
  if (/万灵|医坊/.test(locationName)) return `${object}先扣庇护牌旁`;
  if (/停剑|茶楼/.test(locationName)) return `${object}先上桌面`;
  return `${object}压到明处`;
}

function localizeInstitutionalSpeech(text = "", { locationName = "", object = "", sourceObject = "", responseObject = "" } = {}) {
  let line = normalizeDialogueLine(text);
  if (!line) return "";
  const item = localizeSceneObject(normalizeOutcomeObject(object || responseObject || sourceObject), locationName) || "这件东西";
  const isGate = /法契|契门|界石/.test(locationName);
  const isClinic = /万灵|医坊/.test(locationName);
  const surface = localInstitutionSurface(locationName);
  const procedure = localProcedureAction(locationName, item);
  line = localizeDistrictBoundText(line, { locationName, object: item });

  if (!isGate) {
    line = line
      .replace(/按城法扣契/g, `按城法，${procedure}`)
      .replace(/扣契/g, procedure)
      .replace(/留给界石/g, `留在${surface}`)
      .replace(/贴着界石/g, `压在${surface}`)
      .replace(/界石还照着/g, `${surface}还压着`)
      .replace(/过界石/g, `越过${surface}`)
      .replace(/铜盘/g, surface)
      .replace(/盘边/g, `${surface}边`)
      .replace(/桌面/g, surface)
      .replace(/盖印/g, /无咎市|市/.test(locationName) ? "记账" : /归墟|渡/.test(locationName) ? "封渡" : /照骨司|镜塔|档案/.test(locationName) ? "照验" : "写名")
      .replace(/落印/g, /无咎市|市/.test(locationName) ? "落账" : /归墟|渡/.test(locationName) ? "落渡令" : /照骨司|镜塔|档案/.test(locationName) ? "落镜证" : "写名");
  } else {
    line = line.replace(/桌面/g, surface);
  }

  if (!isClinic) {
    const protectionSurface = /归墟|渡/.test(locationName)
      ? "水线内"
      : /无咎市|市/.test(locationName)
        ? "案台边"
        : /法契|契门|界石/.test(locationName)
          ? "铜盘边"
          : /照骨司|镜塔|档案/.test(locationName)
            ? "镜下"
            : "明处";
    line = line
      .replace(/药炉前不问正邪/g, "庇护牌亮着时不问正邪")
      .replace(/进了医坊/g, "庇护牌亮着")
      .replace(/留在药炉旁/g, `留在${protectionSurface}`)
      .replace(/药炉前/g, `${protectionSurface}`)
      .replace(/诊床/g, protectionSurface)
      .replace(/伤者/g, protectedPersonShortPhrase(locationName));
  }

  line = line.replace(/名字写清楚再写名/g, "名字写清楚再伸手");

  return normalizeDialogueLine(line);
}

function staleDefenseSloganLine(text = "") {
  return /按城法[^。！？]{0,40}不按宗门私仇|买卖在城规里，别把血仇带进来|我押的是灵契，不是命|价码到了，旧案自然开口|让照骨司先验|剑可以停，证据不能走|庇护牌还亮着，谁也不能拖人|庇护牌亮着时不问正邪|庇护牌亮着，先救命，后审案|药炉前不问正邪|进了医坊，先救命，后审案|镜面只记灵痕，不替谁认罪|我只照见写下来的东西/.test(String(text || ""));
}

function relationshipHistoryCountForSpeech(...sims) {
  return Math.max(...sims.map((sim) => Number(sim?.relationshipHistoryCount || sim?.relationshipDialogueHistory?.length || 0)), 0);
}

function relationshipMemoryForSpeech(...sims) {
  return sims
    .map((sim) => sim?.relationshipDialogueMemory)
    .find(Boolean) || null;
}

function rememberedObjectForSpeech({ speakerSim = {}, otherSim = {}, fallback = "" } = {}) {
  return normalizeOutcomeObject(
    speakerSim.relationshipDialogueMemory?.sharedObject
      || speakerSim.memorySharedObject
      || otherSim.relationshipDialogueMemory?.sharedObject
      || otherSim.memorySharedObject
      || fallback,
  ) || "那件东西";
}

function memoryPressurePhrase(memory = null) {
  const text = [
    memory?.followupTurn,
    memory?.finalTurn,
    memory?.eventOutcome,
    memory?.relationshipDialogueAct?.reason,
  ].filter(Boolean).join(" ");
  if (/拖走|救命|护住|庇护|伤者|人先于/.test(text)) return "上次人和证物被绑在一起";
  if (/价码|进账|买|押|旧案|交易/.test(text)) return "上次的价码没有结清";
  if (/解释权|名字|写|改口|规矩|城规/.test(text)) return "上次没人肯把名字写清";
  if (/退路|退半步|不交|不换手|不能只把话推回去/.test(text)) return "上次的退路被堵在场中";
  if (/水线|渡令|岸|追来/.test(text)) return "上次那道水线没有放人";
  if (/镜|供词|案卷|灵痕/.test(text)) return "上次那份供词没有定名";
  return "上次留下的东西还在场中";
}

function characterVoicePressurePhrase({ speakerSim = {}, currentItem = "这件东西", rememberedItem = "那件东西", surface = "明处", pressure = "上一轮的话没有结清", locationName = "", contextKey = "" } = {}) {
  const voiceText = [
    speakerSim?.characterName,
    speakerSim?.agentProfile?.publicIdentity,
    speakerSim?.agentProfile?.dramaticObjective,
    speakerSim?.privateDesire,
    speakerSim?.publicGoal,
  ].filter(Boolean).join(" ");
  const periodTexture = periodTexturePhrase(contextKey);
  if (/沈珩|执律|玄衡|正道|证据|扣押/.test(voiceText)) {
    if (/价码|进账|旧案|交易/.test(pressure)) return `${currentItem}不能先变成价码，证据要留到${surface}`;
    if (/人和证物|护住|救命|庇护/.test(pressure)) return `${currentItem}旁边的人先站稳，${periodTexture}证据才算数`;
    return `${rememberedItem}上次没过${surface}，证据还在原处`;
  }
  if (/阎无咎|血河|翻案|魔印|旧案|交易|价码/.test(voiceText)) {
    if (/解释权|规矩|改口/.test(pressure)) return `${currentItem}一进账，旧案就会被别人改价`;
    return `${currentItem}一进账，旧案就被别人开价`;
  }
  if (/鹿青萝|鹿妖|妖医|医坊|庇护|伤者|救命/.test(voiceText)) {
    if (/价码|进账|旧案|交易/.test(pressure)) return `${currentItem}旁边还有人，账册别先写人名`;
    return `${currentItem}旁边还有人，庇护牌不能只替证物亮`;
  }
  if (/阿照|器灵|照骨镜|镜塔|案卷|供词|灵痕/.test(voiceText)) {
    return `${currentItem}的影子还在镜里，案卷不能替谁闭眼`;
  }
  if (/敖霁|龙裔|水府|渡口|渡令|水阵/.test(voiceText)) {
    if (/归墟|渡/.test(locationName)) return `${currentItem}还压着水线，岸上的人别替水阵发令`;
    return `${currentItem}还压在${surface}，追来的人别借${localWitnessName(locationName)}发令`;
  }
  if (/孟槐|鬼修|阴街|魂灯|供词|死人/.test(voiceText)) {
    return `${currentItem}旁边还有没说完的供词，活人先别定价`;
  }
  return pressure;
}

function memoryRewriteLineByRole({ line = "", role = "claim", currentItem = "这件东西", rememberedItem = "那件东西", surface = "明处", countText = "上一轮", pressure = "上一轮的话没有结清", voicePressure = "", contextKey = "" } = {}) {
  const pressureLine = voicePressure || pressure;
  const periodTexture = periodTexturePhrase(contextKey);
  const pick = (variants) => variants[stableVariantIndex(`${contextKey}:${role}:${currentItem}:${rememberedItem}:${surface}:${pressureLine}`, variants.length)];
  if (/买卖|价码|押的是|旧案|血仇|命/.test(line)) {
    if (role === "response") return pick([
      `${pressureLine}；${currentItem}不进账，价码也不能替你收场。`,
      `${currentItem}还没入账；旧案要开口，先别拿${pressureLine}当价签。`,
      `${currentItem}还在${surface}，价码慢一步，命不能替账页补空。`,
    ]);
    if (role === "counter") return pick([
      `${currentItem}还在账册外，旧案要开口也别从我的命上开。`,
      `${currentItem}上次没进账页，旧案要说话也先离开价码。`,
      `${currentItem}又压在${surface}，旧案开价的手要留在账册边。`,
    ]);
    return pick([
      `${pressureLine}；先别让${currentItem}进账，谈价以前把旧账摊开。`,
      `${currentItem}上次还贴着${surface}，${periodTexture}旧案要谈，就别让账册替人开口。`,
      `${currentItem}没过账页；${periodTexture}想改价的人把旧账的缺口补上。`,
    ]);
  }
  if (/庇护|救命|药炉|正邪|拖人|医坊/.test(line)) {
    if (role === "response") return pick([
      `${pressureLine}；${currentItem}先压在${surface}，人名不跟着证物走。`,
      `${currentItem}还在${surface}，伤者的名字不能跟着证物换手。`,
      `${currentItem}刚才没动，人先站稳，账册不能替伤口收人。`,
    ]);
    if (role === "counter") return pick([
      `${currentItem}还可以留，人不能被写进账册。`,
      `${currentItem}还在${surface}，人不能跟它一起被带走。`,
      `${currentItem}上次没走，伤口先别被案卷盖住。`,
    ]);
    return pick([
      `${rememberedItem}还压在${surface}；${currentItem}也别离开，先把人从价码里拆出来。`,
      `${currentItem}旁边还有人，刚才那笔账不能替伤口说话。`,
      `${currentItem}还留在${surface}，要问正邪也等人喘过这口气。`,
    ]);
  }
  if (/镜面|照见|灵痕|认罪|案卷/.test(line)) {
    if (role === "response") return pick([
      `${pressureLine}；${currentItem}先别移开，我只记谁在这里改口。`,
      `${currentItem}还照在${surface}，换名字的人先被记录照见。`,
      `${currentItem}刚才没离镜下，供词要改也先露出原句。`,
    ]);
    return pick([
      `${rememberedItem}上次照不出退路；${currentItem}留在${surface}，这一句只记改口的痕迹。`,
      `${currentItem}的影子上次还没散，${surface}先记手，再记话。`,
      `刚才那份案卷还开着，${currentItem}不动，名字也别动。`,
    ]);
  }
  if (/按城法|宗门|私仇|照骨司|证据不能走|剑可以停/.test(line)) {
    if (role === "response") return pick([
      `${pressureLine}；你又把规矩推到我面前，${currentItem}压在${surface}。`,
      `${currentItem}还在${surface}，规矩可以说，人情不能替它盖过去。`,
      `${currentItem}刚才没离开，城法要落字，就从这只手开始。`,
    ]);
    if (role === "counter") return pick([
      `${currentItem}还留在${surface}，这次别让规矩替你回答。`,
      `${currentItem}又压在${surface}，借规矩退后的手先把名字交出来。`,
      `${currentItem}上次没离${surface}，城法只认眼前这一步。`,
    ]);
    return pick([
      `${rememberedItem}还压在${surface}；我不再把这句退回规矩，${currentItem}也压在${surface}。`,
      `${currentItem}又压到${surface}，宗门的话慢一步，证据先说。`,
      `刚才那条规矩还没说完，${currentItem}今天仍要留在${surface}。`,
    ]);
  }
  return pick([
    `${rememberedItem}上次没有离场；${currentItem}压回${surface}，把上次留下的缺口补上。`,
    `${currentItem}还压在${surface}，刚才漏掉的话这次不能跳过。`,
    `${rememberedItem}上次没有替谁收场，${currentItem}今天也别急着换手。`,
  ]);
}

function coldStartSceneSpeechRewrite(text = "", { object = "", locationName = "", role = "claim" } = {}) {
  const line = normalizeDialogueLine(text);
  if (!line || !staleDefenseSloganLine(line)) return line;
  const item = normalizeOutcomeObject(object) || "这件东西";
  const surface = localInstitutionSurface(locationName);
  const gate = /法契|契门|界石/.test(locationName);
  const market = /无咎市|市/.test(locationName);
  const ferry = /归墟|渡/.test(locationName);
  const archive = /照骨司|镜塔|档案/.test(locationName);
  const clinic = /万灵|医坊/.test(locationName);

  if (/买卖|价码|押的是|旧案|血仇|命/.test(line)) {
    if (role === "response") return normalizeDialogueLine(`${item}先别入账；旧案要开口，就别把人命写成价码。`);
    return normalizeDialogueLine(`${item}压在${surface}，价码慢一步，伸向它的手先留在明处。`);
  }
  if (/庇护|救命|药炉|正邪|拖人|医坊/.test(line)) {
    if (clinic) return normalizeDialogueLine(`${item}留在药炉旁，伤者先喘过这口气，案子等门外的人敲第二下。`);
    if (market) return normalizeDialogueLine(`${item}压在案台边，人名先不进账册。`);
    if (ferry) return normalizeDialogueLine(`${item}留在水线内，追来的人先停岸上。`);
    return normalizeDialogueLine(`${item}留在${surface}，先护住人，再问这件东西归谁。`);
  }
  if (/镜面|照见|灵痕|认罪|案卷|照骨司/.test(line)) {
    if (gate) return normalizeDialogueLine(`${item}先压在铜盘里；碰过${item}的人站到界石前。`);
    if (market) return normalizeDialogueLine(`${item}摊到案台上；账册先空着，手印比价码先说话。`);
    if (ferry) return normalizeDialogueLine(`${item}停在水线内；水阵先认痕迹，不认谁的口供。`);
    return normalizeDialogueLine(`${item}留在${surface}，供词先别替人改口。`);
  }
  if (/按城法|宗门|私仇|证据不能走|剑可以停|停剑令|破禁|水阵|渡令/.test(line)) {
    if (role === "response") return normalizeDialogueLine(`${item}还在${surface}，你要规矩，就把手从它旁边拿开。`);
    if (gate) return normalizeDialogueLine(`${item}压进铜盘，宗门的人退到门槛外。`);
    if (market) return normalizeDialogueLine(`${item}推上案台，宗门的名号别写进账页。`);
    if (ferry) return normalizeDialogueLine(`${item}先停水线，追来的人不许借规矩过岸。`);
    return normalizeDialogueLine(`${item}压在${surface}，规矩只管眼前这一件。`);
  }
  return normalizeDialogueLine(`${item}压在${surface}，这句话别照旧说。`);
}

function visibleSurfaceLine({ item = "这件东西", locationName = "", role = "claim" } = {}) {
  const object = normalizeOutcomeObject(item) || "这件东西";
  const surface = localInstitutionSurface(locationName);
  if (/法契|契门|界石/.test(locationName)) {
    if (role === "response") return `${object}还压在铜盘里；你要拿走，先让界石照你的手。`;
    return `${object}压在铜盘里，伸来的手先被界石照见。`;
  }
  if (/无咎市|市/.test(locationName)) {
    if (role === "response") return `${object}贴着账册边；你要拿走，摊主先记你的手印。`;
    return `${object}贴到账册边，伸来的手让摊主先停笔。`;
  }
  if (/归墟|渡/.test(locationName)) {
    if (role === "response") return `${object}还在水线内；你往后退，水阵也不会替你开路。`;
    return `${object}压在水线里，伸来的手让水阵先沉一下。`;
  }
  if (/照骨司|镜塔|档案/.test(locationName)) {
    return `${object}留在镜下，改口的人先被镜面记住。`;
  }
  if (/万灵|医坊/.test(locationName)) {
    return `${object}留在药炉旁，伸来的手先越过伤者。`;
  }
  return `${object}留在${surface}，伸来的手会先被旁观者看见。`;
}

function detemplateDialogueLine(text = "", { object = "", locationName = "", role = "claim", contextKey = "" } = {}) {
  const line = normalizeDialogueLine(text);
  if (!line) return "";
  const item = normalizeOutcomeObject(object) || dialogueAnchor(line, object) || "这件东西";
  const surface = localInstitutionSurface(locationName);
  const witness = localWitnessName(locationName);
  const pick = (variants) => variants[stableVariantIndex(`${contextKey}:${role}:${item}:${surface}`, variants.length)];

  if (/价码先别改，[^。！？]+谁加条件谁先写名/.test(line)) {
    if (/无咎市|市/.test(locationName)) return normalizeDialogueLine(`${item}贴到账册边；加价的手留在摊主笔下。`);
    if (/法契|契门|界石/.test(locationName)) return normalizeDialogueLine(`${item}压回铜盘；加条件的手先被界石照见。`);
    if (/归墟|渡/.test(locationName)) return normalizeDialogueLine(`${item}压到水线内；多出来的条件先被水阵拦住。`);
    if (/照骨司|镜塔|档案/.test(locationName)) return normalizeDialogueLine(`${item}留在镜下；新添的条件先进案卷。`);
    if (/万灵|医坊/.test(locationName)) return normalizeDialogueLine(`${item}留在药炉旁；加条件的人先看见伤者。`);
    return normalizeDialogueLine(`${item}留在${surface}；多出来的条件先暴露在旁观者面前。`);
  }
  if (/下一句先写清楚/.test(line)) {
    return normalizeDialogueLine(pick([
      `${item}别收回去，${surface}前还少一个名字。`,
      `${item}还在${surface}，把证人的本名补上。`,
      `${item}压着没动，${witness}还没记下旧案的价。`,
    ]));
  }
  if (/谁要带走，先把名字写清楚/.test(line)) {
    return normalizeDialogueLine(visibleSurfaceLine({ item, locationName, role }));
  }
  if (/贴着规矩走，不贴着谁的袖口走/.test(line)) {
    return normalizeDialogueLine(`${item}压在${surface}边，袖口里的手先亮出来。`);
  }
  if (/解释权不能由你替我写完/.test(line)) {
    return normalizeDialogueLine(pick([
      `${item}压在${surface}；你要改口，就当着它改。`,
      `${item}还压在${surface}；你要改名，就把刚才那句也留下。`,
      `${item}不离${surface}；解释要换人，先把手摊开。`,
    ]));
  }
  if (/这次你不能只把话推回去/.test(line)) {
    return normalizeDialogueLine(pick([
      `${item}已经留在场中；你退一步，${witness}还看着${item}，退路不跟你走。`,
      `${item}还没离开${surface}；你把话往后撤，${witness}还会记住这一步。`,
      `${item}压在${surface}；退路可以往后，${witness}不能跟着后退。`,
    ]));
  }
  return line;
}

function memoryAwareSpeechRewrite(text = "", { speakerSim = {}, otherSim = {}, object = "", locationName = "", role = "claim", contextKey = "" } = {}) {
  const line = normalizeDialogueLine(text);
  const historyCount = relationshipHistoryCountForSpeech(speakerSim, otherSim);
  const memory = relationshipMemoryForSpeech(speakerSim, otherSim);
  if (!line) return "";
  // A remembered-consequence clause is the character's own recall of what
  // happened last time. Responsive-line assembly and the stale-slogan rewrite
  // may move or replace surrounding text, so the clause is extracted from
  // wherever it sits, kept as the line's opening, and only the remainder is
  // rewritten.
  const rememberedMatch = line.match(/我记得[^。；！？]{4,32}[。；]/u);
  if (rememberedMatch) {
    const clause = rememberedMatch[0].trim();
    const rest = normalizeDialogueLine(line.replace(clause, ""));
    const rewrittenRest = rest
      ? memoryAwareSpeechRewrite(rest, { speakerSim, otherSim, object, locationName, role, contextKey })
      : "";
    return detemplateDialogueLine([clause, rewrittenRest].filter(Boolean).join(""), { object, locationName, role, contextKey });
  }
  if (!staleDefenseSloganLine(line)) return detemplateDialogueLine(line, { object, locationName, role, contextKey });
  if (!memory && historyCount < 2) {
    return detemplateDialogueLine(coldStartSceneSpeechRewrite(line, { object, locationName, role }), { object, locationName, role, contextKey });
  }

  const currentItem = normalizeOutcomeObject(object) || memory?.sharedObject || "这件东西";
  const rememberedItem = rememberedObjectForSpeech({ speakerSim, otherSim, fallback: currentItem });
  const surface = localInstitutionSurface(locationName);
  const countText = historyCount >= 2 ? `${historyCount}轮` : "上一轮";
  const pressure = memoryPressurePhrase(memory);
  return detemplateDialogueLine(memoryRewriteLineByRole({
    line,
    role,
    currentItem,
    rememberedItem,
    surface,
    countText,
    pressure,
    voicePressure: characterVoicePressurePhrase({
      speakerSim,
      currentItem,
      rememberedItem,
      surface,
      pressure,
      locationName,
      contextKey,
    }),
    contextKey,
  }), { object: currentItem, locationName, role, contextKey });
}

function groundedOpeningPrefix({ speakerSim = {}, locationName = "", object = "这件东西" } = {}) {
  const profileText = [
    speakerSim?.agentProfile?.publicIdentity,
    speakerSim?.agentProfile?.dramaticObjective,
    speakerSim?.privateDesire,
    speakerSim?.publicGoal,
  ].filter(Boolean).join(" ");
  if (/无咎市|市/.test(locationName)) {
    if (/审判|扣押|证人|正道|执律/.test(profileText)) return `${object}先扣在案台上，价码和证据分开说`;
    if (/翻案|血河楼|魔印|交易|买回|价码/.test(profileText)) return `${object}先别进账，价码没定前旧案不开口`;
    if (/医坊|庇护|病人|伤者|救命/.test(profileText)) return `${object}别离开案台，人也不能被当成价码`;
    return `${object}先摆到案台上`;
  }
  if (/归墟|渡/.test(locationName)) {
    if (/水府|龙裔|渡口|水路|渡令/.test(profileText)) return `${object}停在岸上，水阵不能替谁开路`;
    return `${object}先停在岸边，追来的人不能越线`;
  }
  if (/万灵|医坊/.test(locationName)) {
    return `${object}扣在药炉旁，人不能跟着证物走`;
  }
  if (/照骨司|镜塔|档案/.test(locationName)) {
    return `${object}先照在镜下，供词不能替人改口`;
  }
  if (/法契|契门|界石/.test(locationName)) {
    return `${object}压进铜盘里`;
  }
  return `${object}压到明处`;
}

function groundOpeningDialogueLine({ speech = "", speakerSim = {}, locationName = "", sourceObject = "", sharedObject = "" } = {}) {
  const normalized = normalizeDialogueLine(speech);
  const object = normalizeOutcomeObject(sourceObject || sharedObject) || "这件东西";
  if (!normalized || !object) return normalized;
  if (lineMentions(normalized, [object])) return normalized;
  const prefix = groundedOpeningPrefix({ speakerSim, locationName, object });
  if (!prefix) return normalized;
  return normalizeDialogueLine(`${prefix}。${trimSpokenSentence(normalized)}`);
}

function localProtectionLine(locationName = "", object = "这件东西", sourceItem = "原来的东西") {
  if (/万灵|医坊/.test(locationName)) return `${object}留在药炉旁，先救人；伤者不能跟着${sourceItem}被拖走。`;
  if (/归墟|渡/.test(locationName)) return `${object}留在水线内，先护住人；${sourceItem}不能被推过岸。`;
  if (/无咎市|市/.test(locationName)) return `${object}压在案台边，先护住人；${sourceItem}不能被写成价码。`;
  if (/法契|契门|界石/.test(locationName)) return `${object}压在铜盘边，先护住人；${sourceItem}不能替人定罪。`;
  if (/照骨司|镜塔|档案/.test(locationName)) return `${object}留在镜下，先护住人；${sourceItem}不能被改成供词。`;
  return `${object}留在明处，先护住人；${sourceItem}不能被带走。`;
}

function protectedPersonVisiblePhrase(locationName = "") {
  if (/万灵|医坊/.test(locationName)) return "伤者在药炉旁喘了一口气";
  if (/归墟|渡/.test(locationName)) return "被追到水线内的人扶住湿冷石阶";
  if (/无咎市|市/.test(locationName)) return "袖口露着血痕的被庇护人往后缩了一步";
  if (/法契|契门|界石/.test(locationName)) return "被扣押的人站在界石光外";
  if (/照骨司|镜塔|档案/.test(locationName)) return "供词旁的人名还没有被镜面吞掉";
  return "被庇护的人停在众人看得见的位置";
}

function protectedPersonShortPhrase(locationName = "") {
  if (/万灵|医坊/.test(locationName)) return "伤者";
  if (/归墟|渡/.test(locationName)) return "被追到水线内的人";
  if (/无咎市|市/.test(locationName)) return "袖口带血的人";
  if (/法契|契门|界石/.test(locationName)) return "被扣押的人";
  if (/照骨司|镜塔|档案/.test(locationName)) return "供词旁的人";
  return "被庇护的人";
}

function localProtectionOutcome(locationName = "", targetName = "对方", responseObject = "另一件东西", sourceName = "有人", sourceObject = "这件东西") {
  if (/万灵|医坊/.test(locationName)) return `${targetName}没有把${responseObject}拿离药炉，${sourceName}推来的${sourceObject}被挡在诊床外；伤者仍留在医坊里。`;
  if (/归墟|渡/.test(locationName)) return `${targetName}没有把${responseObject}交出水线，${sourceName}推来的${sourceObject}被挡在岸边；追来的人仍停在界线外。`;
  if (/无咎市|市/.test(locationName)) return `${targetName}没有把${responseObject}交给摊主，${sourceName}推来的${sourceObject}被挡在案台外；账册没有写下那个人名。`;
  if (/法契|契门|界石/.test(locationName)) return `${targetName}没有把${responseObject}交进铜盘，${sourceName}推来的${sourceObject}被挡在门槛内；守门人的印没有落下。`;
  if (/照骨司|镜塔|档案/.test(locationName)) return `${targetName}没有把${responseObject}交到镜下，${sourceName}推来的${sourceObject}被挡在案卷外；供词没有盖住人名。`;
  return `${targetName}没有把${responseObject}交出去，${sourceName}推来的${sourceObject}停在旁边；旁观者没有立刻接手。`;
}

function comparableDialogueLine(text = "") {
  return String(text || "")
    .replace(/[“”"「」『』，,。！？；;：:\s]/g, "")
    .trim();
}

function mirroredDialogueLine(a = "", b = "") {
  const left = comparableDialogueLine(a);
  const right = comparableDialogueLine(b);
  return Boolean(left && right && left === right);
}

function divergentFollowupDialogueLine({ sourceObject = "", responseObject = "", targetSim = {}, locationName = "" } = {}) {
  const sourceItem = normalizeOutcomeObject(sourceObject) || "这件东西";
  const responseItem = normalizeOutcomeObject(responseObject) || sourceItem;
  if (targetSim?.tone === "保护" || /庇护|医坊|救命|保护/.test(`${targetSim?.privateDesire || ""} ${targetSim?.defensiveMask || ""}`)) {
    if (/无咎市|市/.test(locationName)) return normalizeDialogueLine(`${responseItem}我来压住，人名不进账；${sourceItem}也别替谁定价。`);
    if (/归墟|渡/.test(locationName)) return normalizeDialogueLine(`${responseItem}我来挡住，追来的人不能越过水线。`);
    if (/法契|契门|界石/.test(locationName)) return normalizeDialogueLine(`${responseItem}我来挡住，印别先落在人身上。`);
    if (/万灵|医坊/.test(locationName)) return normalizeDialogueLine(`${responseItem}我来守着，先救人，后问罪。`);
    return normalizeDialogueLine(`${responseItem}我来挡住，人留下。`);
  }
  if (/无咎市|市/.test(locationName)) return normalizeDialogueLine(`${responseItem}先别收走，账册上少写一笔，话才有得谈。`);
  if (/归墟|渡/.test(locationName)) return normalizeDialogueLine(`${responseItem}先别过水线，我还没说谁能走。`);
  return normalizeDialogueLine(`${responseItem}先别收走，我还没认这一步。`);
}

function responsivePrefixForAnchor({ anchor = "", sourceObject = "", responseObject = "", locationName = "" } = {}) {
  const sameObject = responseObject && sourceObject && responseObject === sourceObject;
  const responseItem = responseObject && !sameObject ? responseObject : sourceObject || anchor || "眼前这件物";
  if (sameObject) {
    if (/城法|城规|宗门|私仇|血仇/.test(anchor)) return `${anchor}要算数，${sourceObject}先压在原处`;
    if (/证据|照骨司|镜面|灵痕|认罪|案卷/.test(anchor)) return `${anchor}可以验，${sourceObject}不能离开${localInstitutionSurface(locationName)}`;
    if (/渡令|水阵|破禁/.test(anchor)) return `${sourceObject}停在岸上，水线不开`;
    if (/庇护牌|药炉|救命|审案|正邪/.test(anchor)) return localProtectionLine(locationName, sourceObject, sourceObject);
    return `${sourceObject}可以看，但不能带走`;
  }
  if (/城法|城规|宗门|私仇|血仇/.test(anchor)) {
    return isContractProcedureObject(sourceObject)
      ? `${anchor}若算数，${visibleHoldPhrase(responseItem, locationName)}`
      : `${anchor}若算数，${visibleHoldPhrase(responseItem, locationName)}`;
  }
  if (/证据|旧案|价码/.test(anchor)) return `${anchor}要开口，${responseItem}摆到光里`;
  if (/照骨司|镜面|灵痕|认罪|案卷/.test(anchor)) return `${anchor}可以验，${responseItem}先别移开`;
  if (/灵契|契牌|符/.test(anchor)) {
    return /法契|契门|界石/.test(locationName)
      ? `${anchor}在盘里，${responseItem}也别出门`
      : `${anchor}的账还没清，${visibleHoldPhrase(responseItem, locationName)}`;
  }
  if (/药炉|救命|审案|正邪|庇护牌/.test(anchor)) return `${anchor}可以先办，${responseItem}不能跟着人走`;
  if (/渡令|水阵|破禁/.test(anchor)) return `${anchor}未清，${responseItem}停在岸上`;
  if (/供词|魂灯|威胁/.test(anchor)) return `${anchor}还在，${responseItem}先别换手`;
  return `${anchor || sourceObject}先放一边，${responseItem}压到眼前`;
}

function buildResponsiveDialogueLine({ sourceSpeech = "", targetSpeech = "", sourceObject = "", responseObject = "", locationName = "" } = {}) {
  const base = normalizeDialogueLine(targetSpeech);
  const anchor = dialogueAnchor(sourceSpeech, sourceObject);
  if (lineMentions(base, [anchor])) return base;
  const sourceItem = normalizeOutcomeObject(sourceObject);
  if (sourceItem && lineMentions(base, [sourceItem]) && /可以验|不能离开|不能带走|先留|留在|压在|不交|别交|别带走/.test(base)) return base;
  const prefix = responsivePrefixForAnchor({ anchor, sourceObject, responseObject, locationName });
  return normalizeDialogueLine(`${prefix}。${trimSpokenSentence(base)}`);
}

function buildCounterDialogueLine({ targetSpeech = "", sourceObject = "", responseObject = "", locationName = "" } = {}) {
  const responseItem = responseObject || "这件东西";
  const sourceItem = sourceObject || "原来的东西";
  if (responseItem && sourceItem && responseItem === sourceItem) {
    const reply = String(targetSpeech || "");
    if (/桌面|离开|可以验|不能离开|照骨司|证据|镜面|案卷/.test(reply)) {
      return normalizeDialogueLine(visibleSurfaceLine({ item: sourceItem, locationName, role: "response" }));
    }
    if (/城法|城规|规矩|算数|宗门|私仇|血仇/.test(reply)) {
      return normalizeDialogueLine(`${sourceItem}贴着规矩走，不贴着谁的袖口走。`);
    }
    if (/药炉|救命|庇护|拖走|正邪|审案/.test(reply)) {
      return normalizeDialogueLine(localProtectionLine(locationName, sourceItem, sourceItem));
    }
    if (/渡令|水阵|岸上|水线|破禁/.test(reply)) {
      return normalizeDialogueLine(`${sourceItem}留岸上，水先别开。`);
    }
    if (/押|命|价码|旧案|供词|魂灯/.test(reply)) {
      return normalizeDialogueLine(`${sourceItem}放在这里，旧案开口前谁也别收。`);
    }
    const variants = [
      `${sourceItem}放在光里，手先别伸过去。`,
      `${sourceItem}不离开这里，改口的人就当着它改。`,
      `${sourceItem}留在${localInstitutionSurface(locationName)}边，刚才按住它的手还没收回。`,
    ];
    return normalizeDialogueLine(variants[stableVariantIndex(`${sourceItem}:${reply}`, variants.length)]);
  }
  if (responseItem && String(targetSpeech || "").includes(responseItem)) {
    const reply = String(targetSpeech || "");
    if (/盘边|铜盘|界石|盖印|契|符/.test(reply)) {
      return normalizeDialogueLine(isContractProcedureObject(sourceItem)
        ? `${responseItem}压在盘边，${sourceItem}贴着界石，名字写清楚再盖印。`
        : `${responseItem}压到明处，${sourceItem}留在旁边，名字先别写死。`);
    }
    if (/袖口|遮住|黑痕|藏/.test(reply)) {
      return normalizeDialogueLine(`${responseItem}摆出来，${sourceItem}也别进袖口。`);
    }
    if (/药炉|庇护|诊床|病人|救命/.test(reply)) {
      return normalizeDialogueLine(localProtectionLine(locationName, responseItem, sourceItem));
    }
    if (/渡|水阵|岸|船|闸/.test(reply)) {
      return normalizeDialogueLine(`${responseItem}留岸上，${sourceItem}先别过水线。`);
    }
    if (/账|名单|记录|配额|公司/.test(reply)) {
      return normalizeDialogueLine(`${responseItem}摊到账册边，${sourceItem}先别进名单。`);
    }
    return normalizeDialogueLine(`${responseItem}摆到明处，${sourceItem}别离开桌面。`);
  }
  const anchor = dialogueAnchor(targetSpeech, responseItem);
  if (anchor && anchor !== responseItem && anchor !== sourceItem) {
    return normalizeDialogueLine(`${anchor}可以验，${sourceItem}不能离开这里。`);
  }
  return normalizeDialogueLine(`${responseItem}摆到明处，${sourceItem}别离开桌面。`);
}

function conductorSignalForExchange(sourceOutput = {}, responseOutput = {}) {
  return sourceOutput?.conductorSignal || responseOutput?.conductorSignal || null;
}

function applyConductorSignalToDialogueLine(speech = "", signal = null) {
  const normalized = normalizeDialogueLine(speech);
  if (!signal?.inWorldClue || !signal?.object) return normalized;
  if (normalized.includes(signal.object)) return normalized;
  return normalizeDialogueLine(`${signal.object}先别离开。${trimSpokenSentence(normalized)}`);
}

function hasRelationshipDialogueMemory(...sims) {
  return sims.some((sim) => sim?.memorySource === "agent_dialogue_relationship" || sim?.relationshipDialogueMemory);
}

function relationshipMemoryTurn(...sims) {
  const memory = sims
    .map((sim) => sim?.relationshipDialogueMemory)
    .find(Boolean);
  return memory?.followupTurn || memory?.finalTurn || memory?.eventOutcome || "";
}

function relationshipDialogueActForSim(sim = {}) {
  const latestHistory = Array.isArray(sim.relationshipDialogueHistory) ? sim.relationshipDialogueHistory.at(-1) : null;
  return sim.relationshipDialogueMemory?.relationshipDialogueAct || latestHistory?.relationshipDialogueAct || null;
}

function relationshipActFollowupDialogueLine({ act = null, sourceItem = "", responseItem = "", anchor = "", rememberedTurn = "", locationName = "", contextKey = "" } = {}) {
  if (!act?.kind) return "";
  const currentObject = normalizeOutcomeObject(responseItem || sourceItem || anchor || "那件东西");
  const rawObject = normalizeOutcomeObject(anchor || currentObject);
  const object = /照骨司|封条|审讯|城规|规矩/.test(rawObject)
    ? normalizeOutcomeObject(sourceItem || responseItem || "那件东西")
    : (rawObject === normalizeOutcomeObject(sourceItem) || rawObject === normalizeOutcomeObject(responseItem) ? rawObject : currentObject);
  const remembered = String(rememberedTurn || "");
  const surface = localInstitutionSurface(locationName);
  const periodTexture = periodTexturePhrase(contextKey);
  const protectedPerson = protectedPersonShortPhrase(locationName);
  const pick = (variants) => variants[stableVariantIndex(`${contextKey}:${act.kind}:${object}:${surface}:${remembered}`, variants.length)];
  if (act.kind === "protect") {
    const hasClinicTexture = /药炉|医坊|救命|伤者|庇护|照骨司/.test(`${act.reason || ""} ${remembered}`);
    return normalizeDialogueLine(pick(hasClinicTexture
      ? [
          localProtectionLine(locationName, object, sourceItem),
          `${object}压在${surface}，${periodTexture}人名站稳以前，案子别往前压。`,
          `${object}不动，${protectedPerson}也不动；规矩等人喘过气再进来。`,
        ]
      : [
          `${object}先护住人，规矩等人站稳再说。`,
          `${object}留在${surface}，人先别被证物带走。`,
          `${object}别换手，先看谁会被这一步拖出去。`,
        ]));
  }
  if (act.kind === "control") {
    const gateProcedure = /法契|契门|界石/.test(locationName) && isContractProcedureObject(sourceItem);
    return normalizeDialogueLine(pick(gateProcedure
      ? [
          `名字先不写，${object}留给界石；解释权不能由你替我落印。`,
          `${object}先压铜盘，名字等界石照完再落。`,
          `${object}不离界石，要解释的人先亮手。`,
        ]
      : [
          `${visibleHoldPhrase(object, locationName)}；解释权不能由你替我写完。`,
          `${object}还在${surface}，${periodTexture}想改名的人先把手摊开。`,
          `${object}不离${surface}，${periodTexture}解释权也别先离场。`,
        ]));
  }
  if (act.kind === "withdraw") {
    return normalizeDialogueLine(pick([
      `我退半步，${object}不换手，刚才那句话也不交出去。`,
      `${object}不换手，我退到${surface}边，话先不交。`,
      `我可以退，${object}不能替我退；刚才那句还留着。`,
    ]));
  }
  if (act.kind === "bargain") {
    return normalizeDialogueLine(pick([
      `价码先别改，${object}压在明处，加价的手也留在旁边。`,
      `${object}先压在${surface}，价码要动，名字也要动。`,
      `${object}不进暗账；改价的手也留在旁边。`,
    ]));
  }
  if (act.kind === "accuse") {
    return normalizeDialogueLine(pick([
      `${object}还是证据，${periodTexture}旧案没开口前谁也别带走。`,
      `${object}还压在${surface}，旧案不开口，证据不能被收走。`,
      `${object}先别离场，${periodTexture}旧案说完以后，伸来的手再落下。`,
    ]));
  }
  return "";
}

function buildMemoryFollowupDialogueLine({ counterSpeech = "", sourceObject = "", responseObject = "", sourceSim, targetSim, locationName = "", contextKey = "" } = {}) {
  if (!hasRelationshipDialogueMemory(sourceSim, targetSim)) return "";
  const sourceItem = normalizeOutcomeObject(sourceObject) || "原来的东西";
  const responseItem = normalizeOutcomeObject(responseObject) || sourceItem;
  const rememberedTurn = relationshipMemoryTurn(targetSim, sourceSim);
  const anchor = dialogueAnchor(rememberedTurn || counterSpeech, sourceItem);
  const sameObject = sourceItem === responseItem;
  const relationshipAct = relationshipDialogueActForSim(targetSim) || relationshipDialogueActForSim(sourceSim);
  const actLine = relationshipActFollowupDialogueLine({
    act: relationshipAct,
    sourceItem,
    responseItem,
    anchor,
    rememberedTurn,
    locationName,
    contextKey,
  });
  if (actLine) return actLine;
  if (rememberedTurn) {
    const rememberedClause = trimSpokenSentence(rememberedTurn).slice(0, 18);
    const byRememberedTone = {
      伪装: `你刚才问的是${anchor}，现在名字还不能写死。`,
      惩罚: `你刚才拿${anchor}问我，现在${sourceItem}也别走。`,
      保护: `你刚才问到${anchor}，人就不能跟着${sourceItem}被拖走。`,
      撤退: `你刚才说${rememberedClause}，那我退半步，${responseItem}不交。`,
      陷害: `你刚才提到${anchor}，那就先验谁碰过${responseItem}。`,
      接近: `你刚才问${anchor}，现在别只看${sourceItem}。`,
      自毁: `你刚才问的是${anchor}，那也把这一步算到我头上。`,
    };
    return normalizeDialogueLine(byRememberedTone[targetSim?.tone] || `你刚才问的是${anchor}，现在${responseItem}先别换手。`);
  }
  const byTone = {
    伪装: sameObject
      ? `既然${sourceItem}还在原处，名字先别写死。`
      : `既然${sourceItem}还在原处，${responseItem}先别写进供词。`,
    惩罚: `那就让${sourceItem}留着，改口的人把声音留在明处。`,
    保护: `${sourceItem}可以留，人不能跟着被拖走。`,
    撤退: `那我退半步，${responseItem}不交。`,
    陷害: `${anchor}既然能验，就先验谁碰过${responseItem}。`,
    接近: `那你别只看${sourceItem}，也看我为什么留下。`,
    自毁: `那就把${sourceItem}也算到我头上。`,
  };
  return normalizeDialogueLine(byTone[targetSim?.tone] || `${anchor}还在，${responseItem}先别换手。`);
}

function protectStakesFollowupDialogueLine({ responseObject = "", sourceObject = "", targetSim = {}, locationName = "" } = {}) {
  const item = normalizeOutcomeObject(responseObject || sourceObject) || "那件东西";
  const speakerName = targetSim?.characterName || "";
  const stake = /医坊|药炉|伤者/.test(locationName || "")
    ? `${item}留在药炉旁，伤者的命先于案上的章。`
    : /渡|水线|岸/.test(locationName || "")
      ? `${item}留在水线内，先把人带上岸，再谈过岸的价。`
      : `${item}留在原处，人先于物。`;
  return normalizeDialogueLine(speakerName ? `${speakerName}守着${stake}` : stake);
}

function buildSignalFollowupDialogueLine({ counterSpeech = "", sourceObject = "", responseObject = "", conductorSignal = null, targetSim, locationName = "" } = {}) {
  if (!conductorSignal?.inWorldClue || !conductorSignal?.object) return "";
  const sourceItem = normalizeOutcomeObject(sourceObject || conductorSignal.object) || conductorSignal.object;
  const responseItem = normalizeOutcomeObject(responseObject) || sourceItem;
  const counterAnchor = dialogueAnchor(counterSpeech, sourceItem);
  const contractSurface = isContractProcedureObject(sourceItem) && /法契|契门|界石/.test(locationName);
  const byTone = {
    伪装: contractSurface ? `名字还不能写到我这里。${responseItem}留在铜盘边。` : `名字还不能写到我这里。${responseItem}留在明处。`,
    撤退: contractSurface ? `我退半步；${responseItem}不离盘，${sourceItem}也别过界石。` : `我退半步；${responseItem}不换手，${sourceItem}也别被带走。`,
    保护: `${sourceItem}可以留，人先别动。`,
    惩罚: contractSurface ? `那就让${sourceItem}照着界石，改口的人把名字写到光里。` : `那就让${sourceItem}留在明处，改口的人把话说到众人面前。`,
    陷害: `先验谁碰过${responseItem}，再谈${counterAnchor}。`,
    接近: `别只看${sourceItem}，也看我为什么把${responseItem}留下。`,
    自毁: `这一步算到我头上，${responseItem}不藏。`,
  };
  return normalizeDialogueLine(byTone[targetSim?.tone] || `${responseItem}留在这里，下一句先写清楚。`);
}

function relationshipPressureContinuationDialogueLine({ sourceSim = {}, targetSim = {}, sourceItem = "", responseItem = "", previousSpeech = "", locationName = "", contextKey = "" } = {}) {
  const momentum = relationshipMomentumFromHistory(sourceSim, targetSim);
  if (!momentum || Number(momentum.historyCount || 0) < 2) return "";
  const object = normalizeOutcomeObject(sourceItem || responseItem || momentum.objects?.at?.(-1) || "那件东西");
  const previous = String(previousSpeech || "");
  const surface = localInstitutionSurface(locationName);
  const witness = localWitnessName(locationName);
  const protectedPerson = protectedPersonShortPhrase(locationName);
  const periodTexture = periodTexturePhrase(contextKey);
  const voiceKind = characterVoiceKind(sourceSim);
  const pick = (variants) => variants[stableVariantIndex(`${contextKey}:${object}:${surface}:${previous}`, variants.length)];
  if (/药炉|医坊|救命|伤者|庇护/.test(previous)) {
    return normalizeDialogueLine(pick([
      localProtectionLine(locationName, object, object).replace(/。$/, `，${periodTexture}这一次你要当着${witness}承认人先于案卷。`),
      `${object}还在${surface}，${periodTexture}人名先亮出来，案卷只能排到后面。`,
      `${object}压着没动，${periodTexture}越过${protectedPerson}的人先把刚才那句重说。`,
    ]));
  }
  if (/界石|盖印|铜盘|名字|证据|契/.test(`${previous} ${object}`)) {
    return normalizeDialogueLine(pick([
      /法契|契门|界石/.test(locationName) && isContractProcedureObject(object)
        ? `界石还照着${object}，名字不能替你写，证据也不能被你改成退路。`
        : `${object}还在明处，名字不能替你写，证据也不能被你改成退路。`,
      `${object}压在${surface}，${periodTexture}名字可以迟写，见证不能替你后退。`,
      `${object}没有离开${surface}，${periodTexture}证据不跟退路一起走。`,
    ]));
  }
  if (voiceKind === "shen") {
    return normalizeDialogueLine(pick([
      `${object}压在${surface}；${periodTexture}证据可以等，人不能把退路写成城法。`,
      `${object}还在${surface}，${periodTexture}证据没有退，刚才那句也不能退。`,
      `${object}已经留过${relationshipMemoryCountPhrase(momentum.historyCount)}，${periodTexture}退后的手先把证据放回明处。`,
    ]));
  }
  if (voiceKind === "lu") {
    return normalizeDialogueLine(pick([
      `${object}压在${surface}；${periodTexture}人可以往后站，伤口不能跟着后退。`,
      `${object}还在${surface}，${periodTexture}退路可以慢一步，人先别被带走。`,
      `${object}还留在${surface}，${periodTexture}收场以前，先看人还能不能站稳。`,
    ]));
  }
  return normalizeDialogueLine(pick([
    `${object}还没离开${surface}，${periodTexture}这次你不能只把话推回去。`,
    `${object}还没离开${surface}；你把话往后撤，${witness}还会记住这一步。`,
    `${object}压在${surface}；退路可以往后，${witness}不能跟着后退。`,
  ]));
}

function characterVoiceText(sim = {}) {
  return [
    sim?.characterName,
    sim?.agentProfile?.publicIdentity,
    sim?.agentProfile?.dramaticObjective,
    sim?.agentProfile?.privateWound,
    sim?.agentProfile?.socialMask,
    sim?.privateDesire,
    sim?.publicGoal,
    sim?.defensiveMask,
    sim?.shadowImpulse,
    sim?.tone,
  ].filter(Boolean).join(" ");
}

function characterVoiceKind(sim = {}) {
  const name = String(sim?.characterName || "");
  const identity = [
    sim?.characterName,
    sim?.agentProfile?.publicIdentity,
    sim?.agentProfile?.dramaticObjective,
    sim?.publicGoal,
  ].filter(Boolean).join(" ");
  const fullVoice = characterVoiceText(sim);
  if (/阎无咎/.test(name) || /血河|旧案|价码|翻案|魔印/.test(identity)) return "yan";
  if (/鹿青萝/.test(name) || /鹿妖|妖医|医坊|庇护|伤者|救命|药炉/.test(identity)) return "lu";
  if (/阿照/.test(name) || /镜塔|照骨镜|镜灵|案卷|供词|原主/.test(identity)) return "azhao";
  if (/敖霁/.test(name) || /龙裔|水府|渡口|渡令|水阵|水路/.test(identity)) return "aoji";
  if (/孟槐/.test(name) || /鬼修|引魂|魂灯|死人|阴街/.test(identity)) return "meng";
  if (/沈珩/.test(name) || /玄衡宗|执律|正道|审判|扣押|证据|剑修/.test(identity)) return "shen";
  if (/阎无咎|血河|旧案|价码|翻案|魔印/.test(fullVoice)) return "yan";
  if (/鹿青萝|鹿妖|妖医|医坊|庇护|伤者|救命|药炉/.test(fullVoice)) return "lu";
  if (/阿照|镜塔|照骨镜|镜灵|案卷|供词|原主/.test(fullVoice)) return "azhao";
  if (/敖霁|龙裔|水府|渡口|渡令|水阵|水路/.test(fullVoice)) return "aoji";
  if (/孟槐|鬼修|引魂|魂灯|死人|阴街/.test(fullVoice)) return "meng";
  if (/沈珩|玄衡宗|执律|正道|审判|扣押|证据|剑修/.test(fullVoice)) return "shen";
  return "generic";
}

function preserveCharacterVoiceLine(line = "", sim = {}, object = "", locationName = "") {
  const normalized = normalizeDialogueLine(line);
  if (!normalized) return "";
  const item = normalizeOutcomeObject(object) || "这件东西";
  const surface = localInstitutionSurface(locationName);
  const voiceKind = characterVoiceKind(sim);
  if (item && item !== "这件东西" && normalized.includes(item)) return normalized;
  const voiceChecks = {
    yan: /价码|旧案|进账|暗账|血河|魔印|符|命/,
    lu: /庇护|药炉|伤口|救命|人名|喘过|病|脉/,
    azhao: /镜|案卷|供词|改口|灵痕|照见|记录/,
    aoji: /水阵|渡口|渡令|水线|归墟|潮|岸/,
    meng: /魂灯|供词|死人|阴街|黑伞|活人|鬼/,
    shen: /城法|证据|界石|铜盘|宗门|玄衡|审讯|扣押/,
  };
  if (!voiceChecks[voiceKind] || voiceChecks[voiceKind].test(normalized)) return normalized;
  const prefixes = {
    yan: `${item}不进暗账`,
    lu: `${item}旁边还有伤口`,
    azhao: `${item}照在镜面`,
    aoji: /归墟|渡/.test(locationName) ? `${item}还压着水线` : `${item}还压在${surface}`,
    meng: `${item}旁边还有供词`,
    shen: `${item}留作证据`,
  };
  const voiced = `${prefixes[voiceKind] || `${item}还在${surface}`}；${trimSpokenSentence(normalized)}`;
  return /[？?]$/.test(normalized) ? normalizeQuestionLine(voiced) : normalizeDialogueLine(voiced);
}

function dialogueOpeningState(line = "") {
  const normalized = normalizeDialogueLine(line);
  const match = normalized.match(/^(灵契|停剑令|妖丹盒|照骨镜|渡令|庇护牌|魂灯)(?:先)?(?:压在|留在|还在|贴着|挨着|停在)([^，；。！？]{1,12})([，；。！？]?)(.*)$/u);
  if (!match) return null;
  return {
    object: match[1],
    surface: match[2],
    key: `${match[1]}:${match[2]}`,
    rest: String(match[4] || "").trim(),
    question: /[？?]$/.test(normalized),
  };
}

function rewriteRepeatedTurnOpening(line = "", opening = null, locationName = "") {
  if (!opening?.rest) return normalizeDialogueLine(line);
  const rest = opening.rest.replace(/[。！？]+$/g, "").trim();
  if (!rest) return normalizeDialogueLine(line);
  if (opening.question) return normalizeQuestionLine(`${rest}，${opening.object}还留在${opening.surface}`);
  const witness = localWitnessName(locationName);
  return normalizeDialogueLine(`${witness}看着${opening.object}，${rest}`);
}

function diversifyDialogueTurnOpenings(turns = [], { locationName = "" } = {}) {
  const result = [];
  for (const turn of Array.isArray(turns) ? turns : []) {
    if (!turn?.line) {
      result.push(turn);
      continue;
    }
    const previousOpening = dialogueOpeningState(result.at(-1)?.line || "");
    const currentOpening = dialogueOpeningState(turn.line);
    if (previousOpening?.key && currentOpening?.key && previousOpening.key === currentOpening.key) {
      result.push({
        ...turn,
        line: rewriteRepeatedTurnOpening(turn.line, currentOpening, locationName),
      });
      continue;
    }
    result.push(turn);
  }
  return result;
}

function localWitnessName(locationName = "") {
  if (/法契|契门|界石/.test(locationName)) return "界石";
  if (/无咎市|市/.test(locationName)) return "摊主";
  if (/照骨司|镜塔|档案/.test(locationName)) return "照骨镜";
  if (/归墟|渡/.test(locationName)) return "水阵";
  if (/万灵|医坊/.test(locationName)) return "药炉";
  return "旁观者";
}

function periodTexturePhrase(contextKey = "") {
  const key = String(contextKey || "");
  const locationVariants = [];
  if (/法契|契门|界石/.test(key)) locationVariants.push("界石还亮着，", "铜盘边冷光没退，", "门槛外的人声压低，");
  if (/无咎市|市/.test(key)) locationVariants.push("摊主停住笔，", "铜夹还扣着纸页，", "案台边的人都看着，");
  if (/照骨司|镜塔|档案/.test(key)) locationVariants.push("镜面泛白，", "封条影子压住案卷，", "供词还没落字，");
  if (/归墟|渡/.test(key)) locationVariants.push("水声压到石阶，", "水阵边缘亮了一下，", "岸上的脚步停住，");
  if (/万灵|医坊/.test(key)) locationVariants.push("药气还没散，", "炉火低了一下，", "伤者的呼吸还在，");
  if (/停剑|茶楼/.test(key)) locationVariants.push("茶盏边热气没散，", "桌面上的令牌还冷，", "楼下脚步压低，");

  let slotVariants = [];
  let stockPhrase = "";
  if (/上午/.test(key)) {
    stockPhrase = "门刚开时，";
    slotVariants = ["第一声钟还没散，", "晨光压到物件边，"];
  } else if (/中午/.test(key)) {
    stockPhrase = "账页翻到这里，";
    slotVariants = ["正午的影子缩到桌脚，", "人声在案边停住，"];
  } else if (/下午/.test(key)) {
    stockPhrase = "日影偏过去，";
    slotVariants = ["墨迹还没干，", "窗边的光斜到手背上，"];
  } else if (/傍晚/.test(key)) {
    stockPhrase = "灯影压下来，";
    slotVariants = ["暮色压到门槛，", "最后一盏灯刚被点起，"];
  } else if (/夜间|夜里/.test(key)) {
    stockPhrase = "夜灯亮着，";
    slotVariants = ["夜风把话压低，", "更鼓声隔着街传来，"];
  }
  if (!stockPhrase) return "";
  const variants = [...locationVariants, ...slotVariants, stockPhrase, ""];
  return variants[stableVariantIndex(key, variants.length)] || "";
}

function dialogueQuestionFrame(text = "") {
  return String(text || "")
    .replace(/门刚开时|账页翻到这里|日影偏过去|灯影压下来|夜灯亮着/g, "时刻")
    .replace(/灵契|契牌|妖丹盒|庇护牌|渡令|魂灯|照骨镜|剑匣|魔印|符箓|一枚符|纸页|药炉/g, "物件")
    .replace(/铜盘|案台|水线|岸边|镜下|药炉旁|明处|这里/g, "位置")
    .replace(/界石|摊主|水阵|照骨镜|药炉|旁观者/g, "见证者")
    .replace(/袖口带血的人|被追到水线内的人|伤者|人名|旁边的人/g, "被护住的人")
    .replace(/[，。；：\s]/g, "")
    .trim();
}

function usedQuestionFramesForSpeaker(sim = {}) {
  const lines = [
    ...(Array.isArray(sim.recentDialogueLines) ? sim.recentDialogueLines : []),
    sim.relationshipDialogueMemory?.followupTurn,
    sim.relationshipDialogueMemory?.finalTurn,
    ...(sim.relationshipDialogueMemory?.dialogueTurns || []).map((turn) => turn?.line),
    ...(sim.relationshipDialogueHistory || []).flatMap((dialogue) => [
      dialogue?.followupTurn,
      dialogue?.finalTurn,
      ...(dialogue?.dialogueTurns || []).map((turn) => turn?.line),
    ]),
  ].filter(Boolean);
  return new Set(lines.filter((line) => String(line).includes("还是")).map((line) => dialogueQuestionFrame(line)));
}

function pickFreshQuestionVariant(variants = [], key = "", speakerSim = {}) {
  const choices = variants.filter(Boolean);
  if (!choices.length) return "";
  const usedFrames = usedQuestionFramesForSpeaker(speakerSim);
  const start = stableVariantIndex(key, choices.length);
  for (let offset = 0; offset < choices.length; offset += 1) {
    const candidate = choices[(start + offset) % choices.length];
    if (!usedFrames.has(dialogueQuestionFrame(candidate))) return candidate;
  }
  return choices[start];
}

function questionLineForExchange({ line = "", speakerSim = {}, sourceItem = "", responseItem = "", locationName = "", contextKey = "" } = {}) {
  const normalized = normalizeDialogueLine(line);
  const askedItem = normalizeOutcomeObject(responseItem || sourceItem) || dialogueAnchor(normalized, sourceItem) || "这件东西";
  const otherItem = normalizeOutcomeObject(sourceItem || responseItem) || askedItem;
  const surface = localInstitutionSurface(locationName);
  const witness = localWitnessName(locationName);
  const protectedPerson = protectedPersonShortPhrase(locationName);
  const periodTexture = periodTexturePhrase(contextKey);
  const voiceKind = characterVoiceKind(speakerSim);
  const key = `${contextKey}:${speakerSim?.characterId || speakerSim?.characterName || ""}:${askedItem}:${otherItem}:${locationName}`;
  if (/[？?]$/.test(normalized)) {
    if (/压在这里，你敢让[^，。！？]+记你的手吗/.test(normalized)) {
      const variants = [
        `${askedItem}压在${surface}，${periodTexture}你敢让${witness}记你的手吗？`,
        `${askedItem}不离${surface}，${periodTexture}你的手要不要也留个名？`,
        `${askedItem}还在${surface}，${periodTexture}你敢说这不是袖口里的私账吗？`,
      ];
      return normalizeDialogueLine(variants[stableVariantIndex(key, variants.length)]);
    }
    return normalized;
  }

  let variants = null;
  if (voiceKind === "yan") {
    variants = [
      `${askedItem}进账以前，${periodTexture}你敢把价码和旧案分开说吗？`,
      `${askedItem}要留在${surface}，${periodTexture}你问的是证据，还是想买我的命？`,
      `${askedItem}压到光里以后，${periodTexture}旧案开口的价你敢听吗？`,
      `${askedItem}挨着${surface}，${periodTexture}血河楼的旧名你敢写全吗？`,
      `${askedItem}还没入账，${periodTexture}你要审我，先把谁给价说出来。`,
      `${askedItem}不能只照你宗门的字，${periodTexture}另一半证词你敢不敢听？`,
    ];
  } else if (voiceKind === "lu") {
    variants = [
      `${askedItem}旁边的人你看见了吗，${periodTexture}还是只看见${otherItem}？`,
      `${askedItem}压在${surface}，${periodTexture}你要先救人，还是先给人定罪？`,
      `${askedItem}不离开${surface}，${periodTexture}${protectedPerson}的名字你敢让${witness}记下吗？`,
      `${askedItem}贴着${protectedPerson}的袖口，${periodTexture}你还要把手伸过去吗？`,
      `${askedItem}留给我看脉，${periodTexture}你若要带人，就先把伤口念出来。`,
      `${askedItem}旁边还有一口气，${periodTexture}案子能不能等药炉先响？`,
    ];
  } else if (voiceKind === "azhao") {
    variants = [
      `${askedItem}留在${surface}，${periodTexture}你要改口，还是要我照出原话？`,
      `${askedItem}照到镜下以后，${periodTexture}你认这道灵痕，还是继续换名字？`,
      `${askedItem}还在记录里，${periodTexture}你敢把刚才那句再说一遍吗？`,
      `${askedItem}映在镜面上，${periodTexture}你要删哪一个字？`,
      `${askedItem}旁边的影子没散，${periodTexture}改口的人先入卷。`,
      `${askedItem}已经被照见，${periodTexture}你还要把名字藏到谁后面？`,
    ];
  } else if (voiceKind === "aoji") {
    variants = [
      `${askedItem}还在水线内，${periodTexture}你要过人，还是要过追杀？`,
      `${askedItem}被水阵压住，${periodTexture}你要开渡，还是要借渡口拿人？`,
      `${askedItem}不离岸，${periodTexture}你敢说这不是追杀的路吗？`,
      `${askedItem}沾了归墟水，${periodTexture}谁的令能越过我的阵？`,
      `${askedItem}停在潮痕上，${periodTexture}你带的是人，还是追杀的影子？`,
      `${askedItem}还压着渡口，${periodTexture}你若要过岸，先把来路报给水阵。`,
    ];
  } else if (voiceKind === "meng") {
    variants = [
      `${askedItem}旁边还有供词，${periodTexture}你要听死人，还是只听活人的价？`,
      `${askedItem}压在${surface}，${periodTexture}魂灯亮着的话你敢不敢记？`,
      `${askedItem}不走，${periodTexture}死人的证词能不能上桌？`,
      `${askedItem}照着魂灯，${periodTexture}你要把哪一句埋回土里？`,
      `${askedItem}旁边的阴火没灭，${periodTexture}活人能不能先闭嘴？`,
      `${askedItem}还在黑伞下，${periodTexture}你要问案，先问谁没有回来。`,
    ];
  } else if (voiceKind === "shen") {
    variants = [
      `${askedItem}留在${surface}，${periodTexture}你要它作证，还是要它替你脱身？`,
      `${askedItem}压在这里，${periodTexture}你敢让${witness}记你的手吗？`,
      `${askedItem}不离${surface}，${periodTexture}你认城法，还是认袖口里的私账？`,
      `${askedItem}没有离开${surface}，${periodTexture}玄衡宗的章先不落，你的手先落。`,
      `${askedItem}还在${surface}，${periodTexture}要说清白，就站到${witness}前。`,
      `${askedItem}压住以后，${periodTexture}我问碰过它的人，不问门派。`,
    ];
  }

  const fallback = [
    `${askedItem}留在${surface}，${periodTexture}你要拿走它，还是回答刚才那句？`,
    `${askedItem}还在这里，${periodTexture}你敢把刚才那句说清楚吗？`,
    `${askedItem}没有换手，${periodTexture}你问规矩，还是问退路？`,
    `${askedItem}压在${surface}，${periodTexture}${witness}先记伸来的手。`,
    `${askedItem}停在两人中间，${periodTexture}这句话不能从旁边绕过去。`,
  ];
  const choices = variants || fallback;
  return normalizeQuestionLine(pickFreshQuestionVariant(choices, key, speakerSim));
}

function questionBranches(questionLine = "") {
  const normalized = normalizeDialogueLine(questionLine).replace(/[？?。！]+$/g, "");
  const matches = [...normalized.matchAll(/([^，。；！？]{2,24})，?还是([^，。；！？]{2,24})/g)];
  const match = matches.at(-1);
  if (!match) return null;
  const clean = (part = "") => String(part)
    .replace(/^(?:你|我|他|她|它|这|那)?(?:要|想|先|只|认|问|听|看|说|开|过|把|拿|给|替|借|让|敢|能不能|要不要)*/, "")
    .replace(/^(?:的是|是)/, "")
    .trim();
  const first = clean(match[1]);
  const second = clean(match[2]);
  if (!first || !second) return null;
  return { first, second };
}

function answerBothQuestionBranches(answer = "", questionLine = "") {
  const normalized = normalizeDialogueLine(answer);
  const branches = questionBranches(questionLine);
  if (!normalized || !branches) return normalized;
  const firstKey = branches.first.slice(0, 2);
  const secondKey = branches.second.slice(0, 2);
  const hasFirst = firstKey && normalized.includes(firstKey);
  const hasSecond = secondKey && normalized.includes(secondKey);
  if (hasFirst && hasSecond) return normalized;
  const branchReply = hasFirst
    ? `不是${branches.second}`
    : hasSecond
      ? `${branches.first}也摆到明处`
      : `${branches.first}先摆到明处，不是${branches.second}`;
  return normalizeDialogueLine(`${trimSpokenSentence(normalized)}；${branchReply}`);
}

function answerNamedQuestionTopics(answer = "", questionLine = "") {
  const normalized = normalizeDialogueLine(answer);
  const question = normalizeDialogueLine(questionLine);
  if (!normalized || !question) return normalized;
  const topicRules = [
    {
      match: /旧案[^。！？]*价|价[^。！？]*旧案/,
      required: ["旧案", "价"],
      reply: "旧案的价不能替证据收场",
    },
    {
      match: /价码[^。！？]*旧案|旧案[^。！？]*价码/,
      required: ["价码", "旧案"],
      reply: "价码和旧案分开说",
    },
    {
      match: /另一半证词|证词/,
      required: ["证词"],
      reply: "另一半证词也要留在场中",
    },
    {
      match: /记你的手|手印|谁的手/,
      required: ["手"],
      reply: "伸过来的手也要被看见",
    },
    {
      match: /刚才那句|说清楚/,
      required: ["刚才"],
      reply: "刚才那句不能被收回去",
    },
  ];
  const missingReplies = topicRules
    .filter((rule) => rule.match.test(question))
    .filter((rule) => !rule.required.every((term) => normalized.includes(term)))
    .map((rule) => rule.reply);
  if (!missingReplies.length) return normalized;
  return normalizeDialogueLine(`${trimSpokenSentence(normalized)}；${missingReplies.join("；")}`);
}

function answerLineForQuestion({ line = "", speakerSim = {}, questionLine = "", sourceItem = "", responseItem = "", locationName = "", contextKey = "" } = {}) {
  const normalized = normalizeDialogueLine(line);
  if (!/[？?]$/.test(String(questionLine || "").trim())) return normalized;
  const item = normalizeOutcomeObject(sourceItem || responseItem) || dialogueAnchor(normalized, responseItem) || "这件东西";
  const introducedItem = normalizeOutcomeObject(responseItem) || item;
  const answerItem = introducedItem && introducedItem !== item && !isOutcomeObjectPronoun(introducedItem) ? `${introducedItem}和${item}` : item;
  const surface = localInstitutionSurface(locationName);
  const witness = localWitnessName(locationName);
  const protectedPerson = protectedPersonShortPhrase(locationName);
  const voiceKind = characterVoiceKind(speakerSim);
  const periodTexture = periodTexturePhrase(contextKey);
  const key = `${contextKey}:${speakerSim?.characterId || speakerSim?.characterName || ""}:${item}:${locationName}:${questionLine}`;

  let variants = null;
  if (voiceKind === "yan") {
    variants = [
      `你的审法先停在门外；${item}不能离开${surface}，${periodTexture}旧案才会开口。`,
      `价码先慢一步；${item}留在${surface}，${periodTexture}命不能替你签押。`,
      `血河楼的誓先不进铜盘；${item}压在${surface}，${periodTexture}加价的手先露出来。`,
    ];
  } else if (voiceKind === "lu") {
    variants = [
      `人命先摆在${surface}前；${item}压住不动，${periodTexture}${protectedPerson}不能跟着证物走。`,
      `正邪先停在门外；${item}留在${surface}，${periodTexture}${protectedPerson}先喘过这口气。`,
      `伤口还在这里；${item}可以不动，${periodTexture}人不能被拖出去。`,
    ];
  } else if (voiceKind === "azhao") {
    variants = [
      `镜面先记这一道；${item}留在${surface}，${periodTexture}改口会被照出来。`,
      `罪名先别替谁落下；${item}压在${surface}，${periodTexture}原话留档。`,
      `记录先开着；${item}不离开，${periodTexture}改名的人先进案卷。`,
    ];
  } else if (voiceKind === "aoji") {
    variants = [
      `水线先挡住追杀；${item}留在${surface}，${periodTexture}追杀不能借它过岸。`,
      `宗门急令到这里停住；${item}压在这里，${periodTexture}水阵只拦破禁。`,
      `渡口先记人，不记急令；${item}可以留，${periodTexture}人不能被水路卖出去。`,
    ];
  } else if (voiceKind === "meng") {
    variants = [
      `供词先上桌；${item}留在${surface}，${periodTexture}死人开口以前活人不能收场。`,
      `活人的价先压下；${item}压在这里，${periodTexture}魂灯还没有灭。`,
      `魂灯先照到${surface}；${item}不能被带走，${periodTexture}那句死证也不能被盖住。`,
    ];
  } else if (voiceKind === "shen") {
    variants = [
      `证据先留在${surface}；${answerItem}旁的手摊开，${periodTexture}${witness}再记名字。`,
      `私账先退到${surface}外；${answerItem}压在${surface}，${periodTexture}${witness}记完再说人情。`,
      `城法先压住${surface}；${answerItem}不能离开，名字写清楚再盖印。`,
    ];
  }

  const fallback = [
    `眼前这一步先停住；${item}留在${surface}，${periodTexture}${witness}先记伸来的手。`,
    `退路先放回${surface}；${item}压在这里，${periodTexture}刚才那句不能收回。`,
    `${item}压在${surface}；${periodTexture}${witness}还没记下伸来的手。`,
  ];
  const choices = variants || fallback;
  return answerNamedQuestionTopics(
    answerBothQuestionBranches(choices[stableVariantIndex(key, choices.length)], questionLine),
    questionLine,
  );
}

function differentiateRepeatedSourceClaim({ line = "", sourceSim = {}, targetSim = {}, sourceObject = "", responseObject = "", locationName = "", contextKey = "", sameSceneClaimLines = [] } = {}) {
  const normalized = normalizeDialogueLine(line);
  if (!normalized) return "";
  const usedLines = new Set((sameSceneClaimLines || []).map((item) => normalizeDialogueLine(item)).filter(Boolean));
  if (!usedLines.has(normalized)) return normalized;
  const sourceItem = normalizeOutcomeObject(sourceObject) || "这件东西";
  const responseItem = normalizeOutcomeObject(responseObject) || sourceItem;
  const surface = localInstitutionSurface(locationName);
  const witness = localWitnessName(locationName);
  const protectedPerson = protectedPersonShortPhrase(locationName);
  const targetName = targetSim?.characterName || "对方";
  const voiceKind = characterVoiceKind(targetSim);
  const key = `${contextKey}:${sourceSim?.characterId || sourceSim?.characterName || ""}:${targetName}:${sourceItem}:${responseItem}:${normalized}`;
  const pairedItems = pairedObjectsPhrase(sourceItem, responseItem, sourceItem);
  const pairedItemsReversed = pairedObjectsPhrase(responseItem, sourceItem, responseItem || sourceItem);
  const pairedStay = sameOutcomeObject(sourceItem, responseItem) ? `${pairedItems}别动` : `${pairedItems}都别动`;
  const pairedKeep = sameOutcomeObject(sourceItem, responseItem) ? `${pairedItemsReversed}留给${witness}` : `${pairedItemsReversed}都要留给${witness}`;
  const pairedDoNotTrade = sameOutcomeObject(sourceItem, responseItem) ? `${pairedItems}别急着换手` : `${pairedItems}都别急着换手`;
  let variants = null;
  if (voiceKind === "yan") {
    variants = [
      `${sourceItem}已经在${surface}；旧案和价码分开说，别让${responseItem}替你遮手。`,
      `到你这里，${sourceItem}仍不离${surface}，价码要开，先让${witness}记手。`,
      `${sourceItem}不是给血河楼改价的，${responseItem}也别离开${surface}。`,
    ];
  } else if (voiceKind === "lu") {
    variants = [
      `${responseItem}也压到${surface}边；${protectedPerson}的名字先别被${sourceItem}盖过去。`,
      `我看见${responseItem}，也看见人；${sourceItem}压在${surface}，拖人的手先报名字。`,
      `${responseItem}亮着就先护人，${sourceItem}留给${witness}，案卷慢一步。`,
    ];
  } else if (voiceKind === "azhao") {
    variants = [
      `照骨镜也要记这一句；${sourceItem}留在${surface}，${responseItem}别替名字闭眼。`,
      `${responseItem}先照明，${sourceItem}不离${surface}，改口的人先进案卷。`,
      `到镜前就换说法，${witness}会记住；${pairedStay}。`,
    ];
  } else if (voiceKind === "aoji") {
    variants = [
      `${responseItem}先别过水线，${sourceItem}留在${surface}；追杀不能借规矩换路。`,
      `水阵若要开，也先照见${sourceItem}；${responseItem}别替谁过岸。`,
      `到渡口这一步，${pairedKeep}。`,
    ];
  } else if (voiceKind === "meng") {
    variants = [
      `${responseItem}旁边还有供词；${sourceItem}留在${surface}，死人也要上桌。`,
      `魂灯没灭，${sourceItem}不能替活人收场，${responseItem}也别离开${surface}。`,
      `到你这里，先听供词；${pairedDoNotTrade}。`,
    ];
  }
  const fallback = [
    `到${targetName}这里，${responseItem}也留在${surface}；先说它和${sourceItem}的关系。`,
    `${targetName}的手边也有${responseItem}，${sourceItem}不离${surface}，这一步重新说。`,
    `${sourceItem}刚才已经留住；现在看${responseItem}，伸来的手先被${witness}记下。`,
  ];
  const choices = variants || fallback;
  return normalizeDialogueLine(choices[stableVariantIndex(key, choices.length)]);
}

function townStatePressureDialogueLine({ pressure = null, speakerSim = {}, otherSim = {}, object = "", locationName = "", contextKey = "" } = {}) {
  if (!pressure) return "";
  const item = localizeSceneObject(
    normalizeOutcomeObject(pressure.object || object) || normalizeOutcomeObject(object),
    locationName,
  ) || localSceneObjectForLocation(locationName);
  const surface = localInstitutionSurface(locationName);
  const witness = localWitnessName(locationName);
  const periodTexture = periodTexturePhrase(`${contextKey}:${locationName}:${item}`);
  const otherName = otherSim?.characterName || "对方";
  const voiceKind = characterVoiceKind(speakerSim);
  const protectedPerson = protectedPersonShortPhrase(locationName);
  const variantsByVoice = {
    yan: [
      `宗门价先退到${surface}外；${item}可以留在${surface}，旧案证词先摊开。`,
      `价码先摊到${surface}；${item}不进暗账，除非${witness}先记下改过口的手。`,
      `${item}先别换手；旧案证词摊开，城法也别替你压我。`,
    ],
    lu: [
      `伤口先留在众人面前；${item}不能换走人，除非${otherName}把伤者名字留下。`,
      `门派先停在门外；${item}可以留在${surface}，${protectedPerson}先喘过这口气。`,
      `${item}别急着走；只要药炉还热，人就不能被写成价码。`,
    ],
    azhao: [
      `记录先开在${surface}；${item}可以留在${surface}，改口的人先进案卷。`,
      `我不替谁认罪；${item}可以留，除非${witness}照见刚才那只手。`,
      `${item}先照明；名字交代清楚，案卷先别动。`,
    ],
    aoji: [
      `水线先亮出来；${item}可以停，追来的人不能越界。`,
      `急令先停在水线外；${item}留在${surface}，除非${otherName}先撤开追杀。`,
      `${item}先压住；渡口规矩说完以前，水阵不能开。`,
    ],
    meng: [
      `供词先上桌；${item}不走，死人证词先上桌。`,
      `活人的价先压下；${item}留在${surface}，除非魂灯先照完名字。`,
      `${item}先别收；除非魂灯先照完名字，黑伞别合。`,
    ],
    shen: [
      `证据先留在${surface}；${item}旁的手摊开，${periodTexture}${witness}照完名字再动。`,
      `私账先退到${surface}外；${item}不能离开${surface}，除非${otherName}交代证据来源。`,
      `${item}可以留；城法交代清楚以前，没人越过见证。`,
    ],
    generic: [
      `眼前这一步先停住；${item}留在${surface}，伸来的手先被${witness}记下，名字不能先写。`,
      `退路先放回${surface}；${item}不能换手，除非刚才那句话说清。`,
      `${item}可以留；名字说出来以前，谁也别收场。`,
    ],
  };
  const choices = variantsByVoice[voiceKind] || variantsByVoice.generic;
  return normalizeDialogueLine(choices[stableVariantIndex(`${contextKey}:${speakerSim?.characterId || speakerSim?.characterName}:${item}:${pressure.sourceDraftId || ""}`, choices.length)]);
}

function stateReplyForExchange({ sourceOutput, responseOutput, sourceSim, targetSim, sourceObject = "", responseObject = "", locationName = "", contextKey = "" } = {}) {
  const responsePressure = responseOutput?.townStatePressure || null;
  const sourcePressure = sourceOutput?.townStatePressure || null;
  const pressure = responsePressure || sourcePressure;
  if (!pressure) return null;
  const speakerOutput = responsePressure ? responseOutput : sourceOutput;
  const targetOutput = responsePressure ? sourceOutput : responseOutput;
  const speakerSim = responsePressure ? targetSim : sourceSim;
  const otherSim = responsePressure ? sourceSim : targetSim;
  const object = responsePressure ? (responseObject || sourceObject) : (sourceObject || responseObject);
  const line = townStatePressureDialogueLine({
    pressure,
    speakerSim,
    otherSim,
    object,
    locationName,
    contextKey,
  });
  if (!line) return null;
  return {
    speakerOutput,
    targetOutput,
    speakerSim,
    otherSim,
    pressure,
    line,
  };
}

function classifyDialogueResponseMove({ speech = "", targetSim = {} } = {}) {
  const line = normalizeDialogueLine(speech);
  const motive = [
    targetSim?.tone,
    targetSim?.privateDesire,
    targetSim?.defensiveMask,
    targetSim?.shadowImpulse,
    targetSim?.agentProfile?.dramaticObjective,
  ].filter(Boolean).join(" ");
  if (/[？?]$/.test(line) || /你敢|谁|哪一个|哪一位|是否|还是/.test(line)) return "question";
  if (targetSim?.tone === "撤退" || /拒绝|不交|不再[^。；]{0,8}说|结束盘问|退回|退到|收回袖口|不换手/.test(`${line} ${motive}`)) return "refuse";
  if (targetSim?.tone === "保护" || /护住|保护|庇护|先救|伤者|病人|人命|不能被拖/.test(`${line} ${motive}`)) return "protect";
  if (/价码|买卖|交易|换符|加价|条件|押的是|作价/.test(`${line} ${motive}`)) return "bargain";
  return "challenge";
}

function dialogueContinuationForMove(responseMove = "challenge") {
  // A question or bargain keeps the exchange open by its own nature; a protect
  // act leaves the protected stake unresolved, so it also earns a follow-up
  // beat. Only refusal/challenge closure stops after the counter.
  return responseMove === "question" || responseMove === "bargain" || responseMove === "protect"
    ? "continue"
    : "stop_after_counter";
}

function buildDialogueTurnsForExchange({ sourceOutput, responseOutput, sourceSim, targetSim, simulationTick, sharedObject, conductorSignal = null, sameSceneClaimLines = [] }) {
  const agentTurns = Array.isArray(responseOutput?.dialogueExchangeTurns)
    ? responseOutput.dialogueExchangeTurns.filter((turn) => turn?.line && turn?.speakerId)
    : [];
  if (agentTurns.length >= 2) {
    const responseTurn = agentTurns.find((turn) => turn.turnRole === "response") || agentTurns[1];
    return {
      dialogueTurns: agentTurns.map((turn) => ({
        ...turn,
        triggeredBy: turn.triggeredBy || conductorSignal?.inWorldClue || "",
      })),
      dialogueDecision: {
        generatedBy: "character-agent",
        responseMove: responseTurn?.act || classifyDialogueResponseMove({ speech: responseTurn?.line, targetSim }),
        continuation: agentTurns.length > 2 ? "continue" : "stop_after_response",
        responderGoal: responseOutput?.dialogueDecision?.proposition || targetSim?.privateDesire || responseOutput?.realtimePrivateDesire || "",
        responderTone: targetSim?.tone || responseOutput?.tone || "",
        observedTurnId: responseOutput?.dialogueDecision?.observedTurnId || "",
      },
    };
  }
  const locationName = simulationTick?.locationName || "";
  const exchangeContextKey = [
    simulationTick?.periodSlot,
    simulationTick?.id,
    sourceOutput?.outputId,
    responseOutput?.outputId,
    sourceSim?.characterId || sourceOutput?.characterId,
    targetSim?.characterId || responseOutput?.characterId,
    locationName,
  ].filter(Boolean).join(":");
  const sourceName = sourceSim?.characterName || sourceOutput?.characterName || sourceOutput?.characterId || "有人";
  const targetName = targetSim?.characterName || responseOutput?.characterName || responseOutput?.characterId || "另一个人";
  const sourceObject = localizeSceneObject(
    extractPrimaryObject(sourceOutput?.visibleAction || responseOutput?.interactionInput?.observedVisibleAction || "", sharedObject),
    locationName,
  );
  const responseObject = localizeSceneObject(
    extractResponseObject(responseOutput?.visibleAction || "", sourceObject),
    locationName,
  );
  const baseSourceSpeech = groundOpeningDialogueLine({
    speech: normalizeDialogueLine(
      extractQuotedSpeech(sourceOutput?.visibleAction)
        || sourceSim?.defensiveMask
        || fallbackDialogueLine({ speakerName: sourceName, targetName, locationName, sharedObject, role: "source" }),
    ),
    speakerSim: sourceSim,
    locationName,
    sourceObject,
    sharedObject,
  });
  const sourceSpeech = applyConductorSignalToDialogueLine(
    applyDialogueMemoryToSpeech(baseSourceSpeech, sourceSim, sourceObject),
    conductorSignal,
  );
  const localizedSourceSpeech = differentiateRepeatedSourceClaim({
    line: memoryAwareSpeechRewrite(localizeInstitutionalSpeech(sourceSpeech, {
      locationName,
      object: sourceObject,
      sourceObject,
      responseObject,
    }), {
      speakerSim: sourceSim,
      otherSim: targetSim,
      object: sourceObject,
      locationName,
      role: "claim",
      contextKey: `${exchangeContextKey}:claim`,
    }),
    sourceSim,
    targetSim,
    sourceObject,
    responseObject,
    locationName,
    contextKey: `${exchangeContextKey}:claim`,
    sameSceneClaimLines,
  });
  const baseRawTargetSpeech = normalizeDialogueLine(
    extractQuotedSpeech(responseOutput?.visibleAction)
      || targetSim?.defensiveMask
      || fallbackDialogueLine({ speakerName: targetName, targetName: sourceName, locationName, sharedObject, role: "response" }),
  );
  // The response move must be classified on what the responder actually says
  // this turn, before any remembered-consequence recall is prepended — the
  // memory text can otherwise decide the move on the speaker's behalf.
  const responseMove = classifyDialogueResponseMove({ speech: baseRawTargetSpeech, targetSim });
  const rawTargetSpeech = applyDialogueMemoryToSpeech(baseRawTargetSpeech, targetSim, responseObject || sourceObject);
  const dialogueContinuation = dialogueContinuationForMove(responseMove);
  const targetSpeech = buildResponsiveDialogueLine({
    sourceSpeech: localizedSourceSpeech,
    targetSpeech: rawTargetSpeech,
    sourceObject,
    responseObject,
    locationName,
  });
  const localizedTargetSpeech = memoryAwareSpeechRewrite(localizeInstitutionalSpeech(targetSpeech, {
    locationName,
    object: responseObject || sourceObject,
    sourceObject,
    responseObject,
  }), {
    speakerSim: targetSim,
    otherSim: sourceSim,
    object: responseObject || sourceObject,
    locationName,
    role: "response",
    contextKey: `${exchangeContextKey}:response`,
  });
  const targetQuestionSpeech = localizeInstitutionalSpeech(responseMove === "question" ? questionLineForExchange({
    line: localizedTargetSpeech,
    speakerSim: targetSim,
    sourceItem: sourceObject,
    responseItem: responseObject || sourceObject,
    locationName,
    contextKey: `${exchangeContextKey}:question`,
  }) : localizedTargetSpeech, {
    locationName,
    object: responseObject || sourceObject,
    sourceObject,
    responseObject,
  });
  const counterSpeech = buildCounterDialogueLine({
    targetSpeech: targetQuestionSpeech,
    sourceObject,
    responseObject,
    locationName,
  });
  const localizedCounterSpeech = memoryAwareSpeechRewrite(localizeInstitutionalSpeech(counterSpeech, {
    locationName,
    object: sourceObject,
    sourceObject,
    responseObject,
  }), {
    speakerSim: sourceSim,
    otherSim: targetSim,
    object: sourceObject,
    locationName,
    role: "counter",
    contextKey: `${exchangeContextKey}:counter`,
  });
  const sourceAnswerSpeech = localizeInstitutionalSpeech(answerLineForQuestion({
    line: localizedCounterSpeech,
    speakerSim: sourceSim,
    questionLine: targetQuestionSpeech,
    sourceItem: sourceObject,
    responseItem: responseObject || sourceObject,
    locationName,
    contextKey: `${exchangeContextKey}:answer`,
  }), {
    locationName,
    object: sourceObject,
    sourceObject,
    responseObject,
  });
  const followupSpeech = dialogueContinuation === "continue"
    ? buildMemoryFollowupDialogueLine({
        counterSpeech: sourceAnswerSpeech,
        sourceObject,
        responseObject,
        sourceSim,
        targetSim,
        locationName,
        contextKey: `${exchangeContextKey}:followup`,
      }) || buildSignalFollowupDialogueLine({
        counterSpeech,
        sourceObject,
        responseObject,
        conductorSignal,
        targetSim,
        locationName,
      }) || protectStakesFollowupDialogueLine({
        sourceObject,
        responseObject,
        targetSim,
        locationName,
      })
    : "";
  const localizedFollowupSpeech = memoryAwareSpeechRewrite(localizeInstitutionalSpeech(followupSpeech, {
    locationName,
    object: responseObject || sourceObject,
    sourceObject,
    responseObject,
  }), {
    speakerSim: targetSim,
    otherSim: sourceSim,
    object: responseObject || sourceObject,
    locationName,
    role: "turn",
    contextKey: `${exchangeContextKey}:followup`,
  });
  const distinctFollowupSpeech = mirroredDialogueLine(localizedFollowupSpeech, sourceAnswerSpeech)
    ? divergentFollowupDialogueLine({ sourceObject, responseObject, targetSim, locationName })
    : localizedFollowupSpeech;
  const pressureContinuationSpeech = dialogueContinuation === "continue"
    ? relationshipPressureContinuationDialogueLine({
        sourceSim,
        targetSim,
        sourceItem: sourceObject,
        responseItem: responseObject,
        previousSpeech: distinctFollowupSpeech || sourceAnswerSpeech,
        locationName,
        contextKey: `${exchangeContextKey}:pressure`,
      })
    : "";
  const localizedPressureContinuationSpeech = memoryAwareSpeechRewrite(localizeInstitutionalSpeech(pressureContinuationSpeech, {
    locationName,
    object: sourceObject,
    sourceObject,
    responseObject,
  }), {
    speakerSim: sourceSim,
    otherSim: targetSim,
    object: sourceObject,
    locationName,
    role: "turn",
    contextKey: `${exchangeContextKey}:pressure`,
  });
  const voicedSourceSpeech = preserveCharacterVoiceLine(localizedSourceSpeech, sourceSim, sourceObject, locationName);
  const voicedTargetQuestionSpeech = preserveCharacterVoiceLine(targetQuestionSpeech, targetSim, responseObject || sourceObject, locationName);
  const voicedSourceAnswerSpeech = preserveCharacterVoiceLine(sourceAnswerSpeech, sourceSim, sourceObject, locationName);
  const voicedFollowupSpeech = preserveCharacterVoiceLine(distinctFollowupSpeech, targetSim, responseObject || sourceObject, locationName);
  const voicedPressureContinuationSpeech = preserveCharacterVoiceLine(localizedPressureContinuationSpeech, sourceSim, sourceObject, locationName);
  const stateReply = stateReplyForExchange({
    sourceOutput,
    responseOutput,
    sourceSim,
    targetSim,
    sourceObject,
    responseObject,
    locationName,
    contextKey: `${exchangeContextKey}:state_reply`,
  });
  const voicedStateReplySpeech = stateReply
    ? preserveCharacterVoiceLine(stateReply.line, stateReply.speakerSim, stateReply.pressure?.object || responseObject || sourceObject, locationName)
    : "";
  // Every spoken turn carries its speaker's current proposition — the
  // objective they are actually pursuing this exchange — so downstream
  // readers can verify that speech serves the speaker's own line of pursuit.
  const sourceProposition = sourceSim?.privateDesire || sourceOutput?.conversationObjective || "";
  const targetProposition = targetSim?.privateDesire || responseOutput?.conversationObjective || "";
  const dialogueTurns = [
    voicedSourceSpeech ? {
      speakerId: sourceOutput?.characterId || responseOutput?.interactionInput?.sourceCharacterId || "",
      speakerName: sourceName,
      targetId: responseOutput?.characterId || "",
      targetName,
      line: voicedSourceSpeech,
      turnRole: "claim",
      proposition: sourceProposition,
      triggeredBy: conductorSignal?.inWorldClue || "",
    } : null,
    voicedTargetQuestionSpeech ? {
      speakerId: responseOutput?.characterId || "",
      speakerName: targetName,
      targetId: sourceOutput?.characterId || responseOutput?.interactionInput?.sourceCharacterId || "",
      targetName: sourceName,
      line: voicedTargetQuestionSpeech,
      turnRole: "response",
      proposition: targetProposition,
      respondsTo: voicedSourceSpeech,
      triggeredBy: conductorSignal?.inWorldClue || "",
    } : null,
    voicedSourceAnswerSpeech ? {
      speakerId: sourceOutput?.characterId || responseOutput?.interactionInput?.sourceCharacterId || "",
      speakerName: sourceName,
      targetId: responseOutput?.characterId || "",
      targetName,
      line: voicedSourceAnswerSpeech,
      turnRole: "counter",
      proposition: sourceProposition,
      respondsTo: voicedTargetQuestionSpeech,
    } : null,
    voicedFollowupSpeech ? {
      speakerId: responseOutput?.characterId || "",
      speakerName: targetName,
      targetId: sourceOutput?.characterId || responseOutput?.interactionInput?.sourceCharacterId || "",
      targetName: sourceName,
      line: voicedFollowupSpeech,
      turnRole: "turn",
      proposition: targetProposition,
      respondsTo: voicedSourceAnswerSpeech,
      triggeredBy: conductorSignal?.inWorldClue || "",
    } : null,
    voicedPressureContinuationSpeech ? {
      speakerId: sourceOutput?.characterId || responseOutput?.interactionInput?.sourceCharacterId || "",
      speakerName: sourceName,
      targetId: responseOutput?.characterId || "",
      targetName,
      line: voicedPressureContinuationSpeech,
      turnRole: "turn",
      proposition: sourceProposition,
      respondsTo: voicedFollowupSpeech || voicedSourceAnswerSpeech,
      triggeredBy: conductorSignal?.inWorldClue || "",
    } : null,
    voicedStateReplySpeech ? {
      speakerId: stateReply?.speakerOutput?.characterId || "",
      speakerName: stateReply?.speakerSim?.characterName || stateReply?.speakerOutput?.characterName || stateReply?.speakerOutput?.characterId || "有人",
      targetId: stateReply?.targetOutput?.characterId || "",
      targetName: stateReply?.otherSim?.characterName || stateReply?.targetOutput?.characterName || stateReply?.targetOutput?.characterId || "对方",
      line: voicedStateReplySpeech,
      turnRole: "state_reply",
      proposition: stateReply?.speakerSim?.privateDesire || "",
      respondsTo: voicedPressureContinuationSpeech || voicedFollowupSpeech || voicedSourceAnswerSpeech || voicedTargetQuestionSpeech || voicedSourceSpeech,
      triggeredBy: stateReply?.pressure?.fact || stateReply?.pressure?.consequence || conductorSignal?.inWorldClue || "",
    } : null,
  ].filter(Boolean);
  return {
    dialogueTurns: diversifyDialogueTurnOpenings(dialogueTurns, { locationName }),
    dialogueDecision: {
      responseMove,
      continuation: dialogueContinuation,
      responderGoal: targetSim?.privateDesire || responseOutput?.realtimePrivateDesire || "",
      responderTone: targetSim?.tone || responseOutput?.tone || "",
    },
  };
}

function stripSpeech(text = "") {
  return String(text || "")
    .replace(/[“"「『][^”"」』]+[”"」』]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOutcomeObject(text = "") {
  return String(text || "")
    .replace(/^.*面前的/, "")
    .replace(/^.*推来的/, "")
    .replace(/^(?:一只|一张|一枚|一道|一条|一件|那只|那张|那枚|那道|那条|那个|这只|这张|这枚|这道|这条|这个)/, "")
    .replace(/^(?:自己的|对方的|推来的|留下的)/, "")
    .replace(/(?:慢慢|轻轻|重重|悄悄|先|才|又)$/u, "")
    .replace(/的(?:边角|边缘|边沿|外沿|边|角)$/u, "")
    .replace(/[，,。；;：:\s]+$/g, "")
    .trim();
}

function isOutcomeObjectPronoun(text = "") {
  return /^(?:它|其|这个|那个|这件东西|那件东西|这件物|那件物|这东西|那东西)$/u.test(normalizeOutcomeObject(text));
}

function isInvalidOutcomeObject(text = "") {
  const value = normalizeOutcomeObject(text);
  if (!value) return true;
  return /刚$|刚才|那一步|这一步|上一句|刚才那句/.test(value);
}

function extractMovedObjects(text = "") {
  const body = stripSpeech(text);
  const patterns = [
    /(?:再|又|才)?把([^，。；;]+?)(?:推到|压到|扣到|按到|放到|递到|留在|并到|挪到|挪近|挪开|收回|压回|压住|往外|往自己)/g,
    /(?:扣住|按住|接住|指着)(?:[^，。；;]{0,12}?)(?:面前的|推来的|留下的)?([^，。；;、]+?)(?:，|。|；|再|又|才|$)/g,
  ];
  return patterns
    .flatMap((pattern) => [...body.matchAll(pattern)].map((match) => normalizeOutcomeObject(match[1])))
    .filter((item) => item && item.length <= 16 && !isInvalidOutcomeObject(item));
}

function extractPrimaryObject(text = "", fallback = "") {
  const objects = extractMovedObjects(text);
  return objects.find((object) => object && !isOutcomeObjectPronoun(object))
    || objects[0]
    || normalizeOutcomeObject(fallback)
    || "手边的东西";
}

function extractResponseObject(responseText = "", sourceObject = "") {
  const sourceComparable = normalizeOutcomeObject(sourceObject);
  const objects = extractMovedObjects(responseText);
  return objects.find((object) => object && !isOutcomeObjectPronoun(object) && object !== sourceComparable && !sourceComparable.includes(object) && !object.includes(sourceComparable))
    || objects.find((object) => object && !isOutcomeObjectPronoun(object))
    || (objects.some((object) => isOutcomeObjectPronoun(object)) ? sourceComparable : "")
    || sourceComparable
    || "另一件东西";
}

function localizeSceneObject(object = "", locationName = "") {
  const item = normalizeOutcomeObject(object);
  if (item === "药炉" && !/万灵|医坊/.test(locationName)) return "庇护牌";
  if (/妖丹盒|铜夹|账册|账页|摊主/.test(item) && !/无咎市|市/.test(locationName)) return localSceneObjectForLocation(locationName);
  if (/渡令|水阵|水线/.test(item) && !/归墟|渡/.test(locationName)) return localSceneObjectForLocation(locationName);
  if (/照骨镜|案卷|镜下/.test(item) && !/照骨司|镜塔|档案/.test(locationName)) return localSceneObjectForLocation(locationName);
  if (/^(?:铜盘|界石|契牌)$/.test(item) && !/法契|契门|界石/.test(locationName)) {
    if (/无咎市|市/.test(locationName)) return "妖丹盒";
    if (/归墟|渡/.test(locationName)) return "渡令";
    if (/照骨司|镜塔|档案/.test(locationName)) return "照骨镜";
    if (/万灵|医坊/.test(locationName)) return "庇护牌";
    return "凭证";
  }
  return item;
}

function sameOutcomeObject(left = "", right = "") {
  const normalizedLeft = normalizeOutcomeObject(left);
  const normalizedRight = normalizeOutcomeObject(right);
  return Boolean(
    normalizedLeft
      && normalizedRight
      && (
        isOutcomeObjectPronoun(normalizedLeft)
        || isOutcomeObjectPronoun(normalizedRight)
        || normalizedLeft === normalizedRight
        || normalizedLeft.includes(normalizedRight)
        || normalizedRight.includes(normalizedLeft)
      ),
  );
}

function movementMode(text = "") {
  const body = stripSpeech(text);
  if (/没有接|挡住|往外推开|拦住|避开/.test(body)) return "block";
  if (/压回|推回|收回|往自己身前收|退/.test(body)) return "withdraw";
  if (/接住|按住|扣住/.test(body)) return "hold";
  if (/压到|扣到|推到|放到|递到|并到|留在/.test(body)) return "commit";
  return "touch";
}

function relationshipPressureStateOutcome({
  sourceName = "有人",
  targetName = "另一个人",
  sourceSim = {},
  targetSim = {},
  locationName = "",
  sourceObject = "这件东西",
  responseObject = "另一件东西",
  sharedObject = "",
  dialogueTurns = [],
  signalPrefix = "",
} = {}) {
  const normalizedTurns = Array.isArray(dialogueTurns) ? dialogueTurns : [];
  const momentum = relationshipMomentumFromHistory(sourceSim, targetSim);
  const highPressure = Number(momentum?.historyCount || 0) >= 2 || normalizedTurns.length >= 5;
  if (!highPressure) return "";

  const turnText = normalizedTurns.map((turn) => turn?.line || "").filter(Boolean).join(" ");
  const sourceAct = relationshipDialogueActForSim(sourceSim);
  const targetAct = relationshipDialogueActForSim(targetSim);
  const inferredAct = relationshipDialogueActFromText(turnText, targetName, sharedObject || sourceObject);
  const act = targetAct || sourceAct || inferredAct || null;
  const item = normalizeOutcomeObject(sourceObject || sharedObject) || "这件东西";
  const counterItem = normalizeOutcomeObject(responseObject || sourceObject) || item;
  const surface = localInstitutionSurface(locationName);
  const witness = localWitnessName(locationName);
  const withProgression = (text, actKind = act?.kind || "") => appendRelationshipProgression(text, {
    sourceSim,
    targetSim,
    locationName,
    sourceName,
    targetName,
    item,
    surface,
    actKind,
  });

  if (act?.kind === "protect" || /救命|伤者|药炉|庇护|人不能/.test(turnText)) {
    const protectedPerson = protectedPersonVisiblePhrase(locationName);
    return withProgression(`${signalPrefix}${targetName}把${counterItem}压在${surface}边，${protectedPerson}；${sourceName}伸出的手停在那人身前，旁人都看见${targetName}替人挡了一次。`, "protect");
  }
  if (act?.kind === "bargain" || /价码|进账|旧案|账册|摊主/.test(turnText)) {
    return withProgression(`${signalPrefix}${targetName}把${item}压到${surface}前，${sourceName}只好把旧案价码说到${witness}面前；${sourceName}伸向${item}的手停在半空。`, "bargain");
  }
  if (act?.kind === "control" || /界石|城法|盖印|名字|审讯|解释权/.test(turnText)) {
    return withProgression(`${signalPrefix}${sourceName}把${item}留在${surface}，${targetName}被叫到${witness}前选边；${surface}外的人声低下去。`, "control");
  }
  if (act?.kind === "withdraw" || /退路|退半步|不交|不换手|不能离开/.test(turnText)) {
    return withProgression(`${signalPrefix}${targetName}把${counterItem}留在${surface}，退路被${item}钉住；${sourceName}把最后一句又推回${surface}。`, "withdraw");
  }
  if (act?.kind === "accuse" || /证据|旧案|翻案|追责|审判/.test(turnText)) {
    return withProgression(`${signalPrefix}${sourceName}把${item}留给${witness}，${targetName}的旧案被说到明处；${witness}旁多出一行指认。`, "accuse");
  }
  return withProgression(`${signalPrefix}${item}没有换手，${sourceName}和${targetName}都停在${surface}前；旁观者把最后一句记下来。`);
}

function localRetreatWitnessTail(locationName = "") {
  if (/无咎市|市/.test(locationName)) return "摊主的铜夹停在账页上。";
  if (/归墟|渡/.test(locationName)) return "水阵没有放开渡路。";
  if (/照骨司|镜塔|档案/.test(locationName)) return "照骨镜没有合上那道灵痕。";
  if (/万灵|医坊/.test(locationName)) return "庇护牌仍亮在药炉旁。";
  if (/停剑|茶楼/.test(locationName)) return "茶盏旁的停剑令没有被收回。";
  return "见证物仍压在明处。";
}

function relationshipProgressionMark(count = 0) {
  const marks = ["", "第一道", "第二道", "第三道", "第四道", "第五道", "第六道", "第七道", "第八道", "第九道", "第十道", "第十一道", "第十二道"];
  const index = Math.max(1, Math.min(marks.length - 1, Number(count || 0)));
  return marks[index] || `第${index}道`;
}

function relationshipMemoryCountPhrase(count = 0) {
  const phrases = ["", "一次", "两次", "三次", "四次", "五次", "六次", "七次", "八次", "九次", "十次", "十一次", "十二次"];
  const index = Math.max(1, Math.min(phrases.length - 1, Number(count || 0)));
  return phrases[index] || `${index}次`;
}

function relationshipProgressionTail({
  sourceSim = {},
  targetSim = {},
  locationName = "",
  sourceName = "有人",
  targetName = "另一个人",
  item = "这件东西",
  surface = "明处",
  actKind = "",
} = {}) {
  const momentum = relationshipMomentumFromHistory(sourceSim, targetSim);
  const historyCount = Number(momentum?.historyCount || 0);
  if (historyCount < 2) return "";
  const mark = relationshipProgressionMark(historyCount + 1);
  const object = normalizeOutcomeObject(item) || "凭证";
  if (/无咎市|市/.test(locationName)) {
    return `账页边多出${mark}朱线，摊主把${object}后的价码空出来。`;
  }
  if (/归墟|渡/.test(locationName)) {
    return `水阵边多出${mark}潮痕，渡令被压到更外一格。`;
  }
  if (/照骨司|镜塔|档案/.test(locationName)) {
    return `照骨镜下多出${mark}旁注，案卷不再合回原页。`;
  }
  if (/万灵|医坊/.test(locationName)) {
    return `药炉旁多出${mark}庇护记号，伤者被移到内侧帘后。`;
  }
  if (/停剑|茶楼/.test(locationName)) {
    return `茶盏边多出${mark}停剑印，旁桌的人把话声压低。`;
  }
  if (/法契|契门|界石/.test(locationName)) {
    return `铜盘边多出${mark}刻痕，守门人把${targetName}的名字移进待审格。`;
  }
  if (actKind === "bargain") return `账页边多出${mark}朱线，摊主把${object}后的价码空出来。`;
  if (actKind === "accuse") return `照骨镜下多出${mark}旁注，案卷不再合回原页。`;
  if (actKind === "protect") return `${surface}边多出${mark}庇护记号，被庇护的人退到众人看得见的位置。`;
  if (actKind === "control" || actKind === "withdraw") {
    return `${surface}边多出${mark}刻痕，旁观者把${targetName}的名字记下来。`;
  }
  return `${surface}边多出${mark}记号，${sourceName}和${targetName}不能再把它当作第一次。`;
}

function appendRelationshipProgression(base = "", options = {}) {
  const text = String(base || "").trim();
  if (!text) return "";
  const tail = relationshipProgressionTail(options);
  if (!tail || text.includes(tail)) return text;
  return `${text.replace(/[。！？…]+$/g, "")}；${tail}`;
}

function visibleQuestionAnswerConsequence({
  dialogueTurns = [],
  sourceName = "有人",
  targetName = "另一个人",
  locationName = "",
  sourceObject = "这件东西",
  responseObject = "",
} = {}) {
  const turns = Array.isArray(dialogueTurns) ? dialogueTurns : [];
  const witness = localWitnessName(locationName);
  const surface = localInstitutionSurface(locationName);
  for (let index = 0; index < turns.length - 1; index += 1) {
    const question = String(turns[index]?.line || "");
    const answer = String(turns[index + 1]?.line || "");
    if (!/[？?]$/.test(question) || !answer) continue;
    if (/证据[^？]*还是[^？]*命/.test(question) && /证据/.test(answer) && /命/.test(answer)) {
      return `${targetName}没有被写成价码，${sourceName}把问题退回证据和${witness}`;
    }
    if (/价码[^？]*旧案|旧案[^？]*价码/.test(question) && /价码/.test(answer) && /旧案/.test(answer)) {
      return `${sourceName}把价码和旧案分开说到${witness}面前，${targetName}没能把话收回暗账`;
    }
    if (/旧案[^？]*价|价[^？]*旧案/.test(question) && /旧案/.test(answer) && /价/.test(answer)) {
      return `${sourceName}把旧案的价说到${witness}面前，${targetName}没能把话收回暗账`;
    }
    if (/另一半证词|证词/.test(question) && /证词/.test(answer)) {
      return `另一半证词被留在${surface}，谁也不能只收走${sourceObject}`;
    }
    if (/记你的手|手印|谁的手/.test(question) && /手/.test(answer)) {
      return `${witness}记下伸向${responseObject || sourceObject}的手，旁人不再只看${sourceObject}`;
    }
  }
  return "";
}

function goalConflictText(sim = {}, output = {}) {
  return [
    sim?.privateDesire,
    sim?.defensiveMask,
    sim?.shadowImpulse,
    sim?.agentProfile?.dramaticObjective,
    sim?.agentProfile?.leverageObject,
    output?.visibleAction,
    output?.hiddenAction,
    output?.surfaceJustification,
  ].filter(Boolean).join(" ");
}

function temporaryAuthorityForLocation(locationName = "") {
  if (/万灵|医坊/.test(locationName)) return "医坊临时控制";
  if (/归墟|渡/.test(locationName)) return "渡口临时控制";
  if (/无咎市|市/.test(locationName)) return "案台临时控制";
  if (/法契|契门|界石/.test(locationName)) return "铜盘前的临时见证权";
  if (/照骨司|镜塔|档案/.test(locationName)) return "案卷临时控制";
  if (/停剑|茶楼/.test(locationName)) return "茶桌前的临时见证权";
  return "场面临时控制";
}

function deriveInteractionConsequence({
  sourceName = "有人",
  targetName = "另一个人",
  sourceOutput = {},
  responseOutput = {},
  sourceSim = {},
  targetSim = {},
  locationName = "",
  sourceObject = "这件东西",
  responseObject = "另一件东西",
  sharedObject = "",
  dialogueTurns = [],
  mode = "touch",
} = {}) {
  const sourceGoal = goalConflictText(sourceSim, sourceOutput);
  const targetGoal = goalConflictText(targetSim, responseOutput);
  const sourceVisible = String(sourceOutput?.visibleAction || responseOutput?.interactionInput?.observedVisibleAction || "");
  const responseVisible = String(responseOutput?.visibleAction || "");
  const turnText = (Array.isArray(dialogueTurns) ? dialogueTurns : []).map((turn) => turn?.line || "").join(" ");
  const allSource = `${sourceGoal} ${sourceVisible} ${turnText}`;
  const allTarget = `${targetGoal} ${responseVisible} ${turnText}`;
  const responseBlocks = ["block", "withdraw", "hold", "commit"].includes(mode)
    || /没有接|挡住|压回|按住|扣住|不能|不交|别带走|先救|护住/.test(responseVisible);
  if (!responseBlocks) return "";

  const item = normalizeOutcomeObject(sourceObject || sharedObject) || "这件东西";
  const counterItem = normalizeOutcomeObject(responseObject || item) || item;
  const witness = localWitnessName(locationName);
  const sourceWantsRemoval = /带走|拿走|收走|扣押|扣住|审讯|交给|带回|押走|拖走|逼供|追责/.test(allSource);
  const targetProtects = /护住|保护|庇护|救命|伤者|病人|药炉|医坊|先救|活|不能让/.test(allTarget);
  const targetWithdraws = /不交|不能交|不能走|退路|撤开|藏|遮住|压回/.test(allTarget);
  const bargainPressure = /价码|换符|押|交易|账册|暗账|买卖/.test(`${allSource} ${allTarget}`);
  const controlPressure = /城法|界石|盖印|照骨司|审讯|扣押|案卷|镜|名字|解释权/.test(`${allSource} ${allTarget}`);
  const boundaryDecision = responseOutput?.boundaryDecision;

  if (boundaryDecision?.kind === "enforce_response_boundary") {
    const boundaryItem = normalizeOutcomeObject(boundaryDecision.object || item) || item;
    const boundaryRule = String(boundaryDecision.rule || "").replace(/[。！？…]+$/g, "");
    const boundaryPlace = locationName || witness;
    if (boundaryDecision.violationKind === "prevent_disclosure") {
      return `${sourceName}没能公开${boundaryItem}，${targetName}把${counterItem}扣回${boundaryPlace}；${boundaryRule}`;
    }
    return `${sourceName}没能带走${boundaryItem}，${targetName}把${counterItem}留在${boundaryPlace}；${boundaryRule}`;
  }

  if (sourceWantsRemoval && targetProtects) {
    const protectedPerson = responseOutput?.interactionInput?.ownTargetCharacterIdBeforeResponse
      && responseOutput.interactionInput.ownTargetCharacterIdBeforeResponse !== sourceOutput?.characterId
      ? responseOutput.interactionInput.ownTargetNameBeforeResponse || protectedPersonShortPhrase(locationName)
      : protectedPersonShortPhrase(locationName);
    return `${sourceName}没能带走${item}，${targetName}用${counterItem}护住${protectedPerson}并获得${temporaryAuthorityForLocation(locationName)}；${sourceName}若要审讯，必须先把理由交给${witness}`;
  }
  if (sourceWantsRemoval && controlPressure) {
    return `${sourceName}没能直接带走${item}，${targetName}把${counterItem}留给${witness}作见证；再要审讯，必须从${witness}前重新开口`;
  }
  if (sourceWantsRemoval && targetWithdraws) {
    return `${sourceName}没能把${item}收走，${targetName}暂时扣住${counterItem}；${witness}记下这次拒交`;
  }
  if (bargainPressure) {
    return `${sourceName}没能把${item}直接换走，${targetName}把${counterItem}压给${witness}作价；再加码的人先把名字留在${witness}旁`;
  }
  if (targetProtects) {
    const protectedPerson = responseOutput?.interactionInput?.ownTargetCharacterIdBeforeResponse
      && responseOutput.interactionInput.ownTargetCharacterIdBeforeResponse !== sourceOutput?.characterId
      ? responseOutput.interactionInput.ownTargetNameBeforeResponse || protectedPersonShortPhrase(locationName)
      : protectedPersonShortPhrase(locationName);
    return `${targetName}护住${protectedPerson}，${sourceName}不能绕过${counterItem}继续逼近；${temporaryAuthorityForLocation(locationName)}暂时落到${targetName}手里`;
  }
  if (controlPressure) {
    return `${targetName}获得${temporaryAuthorityForLocation(locationName)}，${sourceName}不能只凭${item}改写这次见证；${witness}把两人的名字并在同一行`;
  }
  return `${sourceName}没能让${item}照原计划换手，${targetName}也欠下一句解释；${witness}记住这次停顿`;
}

function localizeConductorPressureCue(cue = "", { locationName = "", sourceObject = "", responseObject = "" } = {}) {
  const raw = String(cue || "").trim();
  if (!raw) return "";
  const anchor = localizeSceneObject(sourceObject || responseObject || localSceneObjectForLocation(locationName), locationName);
  const pressureObject = localPressureObjectForLocation(locationName, anchor);
  const concrete = raw.replace(/另一件东西|这件东西|那件东西|原来的东西/g, pressureObject);
  return localizeInstitutionalSpeech(concrete, {
    locationName,
    object: anchor,
    sourceObject: anchor,
    responseObject,
  }).replace(/[。！？…]+$/g, "");
}

function buildEventOutcomeForExchange({ sourceOutput, responseOutput, sourceSim, targetSim, simulationTick, sharedObject, conductorSignal = null, dialogueTurns = [] }) {
  const sourceName = sourceSim?.characterName || sourceOutput?.characterName || sourceOutput?.characterId || "有人";
  const targetName = targetSim?.characterName || responseOutput?.characterName || responseOutput?.characterId || "另一个人";
  const sourceText = sourceOutput?.visibleAction || responseOutput?.interactionInput?.observedVisibleAction || "";
  const responseText = responseOutput?.visibleAction || "";
  const sourceObject = localizeSceneObject(extractPrimaryObject(sourceText, sharedObject), simulationTick?.locationName || "");
  const responseObject = localizeSceneObject(extractResponseObject(responseText, sourceObject), simulationTick?.locationName || "");
  const sameObject = sameOutcomeObject(sourceObject, responseObject);
  const contestedObject = sameObject ? sourceObject : responseObject;
  const surface = localInstitutionSurface(simulationTick?.locationName || "");
  const mode = movementMode(responseText);
  const concretePressureCue = localizeConductorPressureCue(conductorSignal?.pressureCue || "", {
    locationName: simulationTick?.locationName || "",
    sourceObject,
    responseObject,
  });
  const signalPrefix = concretePressureCue ? `${concretePressureCue}；` : "";
  const finalDialogueLine = (Array.isArray(dialogueTurns) ? dialogueTurns : []).at?.(-1)?.line || "";
  const answerConsequence = visibleQuestionAnswerConsequence({
    dialogueTurns,
    sourceName,
    targetName,
    locationName: simulationTick?.locationName || "",
    sourceObject,
    responseObject,
  });
  const goalConsequence = deriveInteractionConsequence({
    sourceName,
    targetName,
    sourceOutput,
    responseOutput,
    sourceSim,
    targetSim,
    locationName: simulationTick?.locationName || "",
    sourceObject,
    responseObject,
    sharedObject,
    dialogueTurns,
    mode,
  });
  const withAnswerConsequence = (outcome = "") => {
    const text = String(outcome || "").trim();
    if (!text || !answerConsequence || text.includes(answerConsequence)) return text;
    return `${text.replace(/[。！？…]+$/g, "")}；${answerConsequence}`;
  };
  const withExchangeConsequences = (outcome = "") => {
    const text = withAnswerConsequence(outcome);
    if (!text || !goalConsequence || text.includes(goalConsequence)) return text;
    return `${text.replace(/[。！？…]+$/g, "")}；${goalConsequence}`;
  };
  if (/退路|不能替你写|不能被你改成退路|不能只把话推回去/.test(finalDialogueLine)) {
    const gateProcedure = /法契|契门|界石/.test(simulationTick?.locationName || "") && isContractProcedureObject(sourceObject);
    const retreatOutcome = gateProcedure
      ? `${signalPrefix}${sourceName}把最后一句压回界石前，${targetName}没能把${sourceObject}改成退路；盖印的人仍停在铜盘外。`
      : `${signalPrefix}${sourceName}把最后一句压回${surface}前，${targetName}没能把${sourceObject}改成退路；${localRetreatWitnessTail(simulationTick?.locationName || "")}`;
    return withExchangeConsequences(appendRelationshipProgression(retreatOutcome, {
      sourceSim,
      targetSim,
      locationName: simulationTick?.locationName || "",
      sourceName,
      targetName,
      item: sourceObject,
      surface,
      actKind: "withdraw",
    }));
  }
  const relationshipAct = relationshipDialogueActForSim(targetSim) || relationshipDialogueActForSim(sourceSim);
  const pressureStateOutcome = relationshipPressureStateOutcome({
    sourceName,
    targetName,
    sourceSim,
    targetSim,
    locationName: simulationTick?.locationName || "",
    sourceObject,
    responseObject,
    sharedObject,
    dialogueTurns,
    signalPrefix,
  });
  if (pressureStateOutcome) {
    const outcome = withExchangeConsequences(pressureStateOutcome);
    // A protection outcome must carry its stake, not only the physical block.
    // The stake is whoever spoke it in the exchange ("先救命，后审案" and
    // alike) — echoing the character's own vow keeps the outcome diegetic
    // instead of pasting the relationship-mechanics label onto the world.
    if (relationshipAct?.kind === "protect" && !/保护债|救命|先回答/.test(outcome)) {
      const stakeSentence = (Array.isArray(dialogueTurns) ? dialogueTurns : [])
        .map((turn) => String(turn?.line || ""))
        .flatMap((line) => line.split(/[。；]/))
        .map((sentence) => sentence.trim())
        .find((sentence) => /救命|先回答/.test(sentence) && sentence.length >= 4 && sentence.length <= 30);
      if (stakeSentence) {
        return `${outcome.replace(/[。！？…]+$/g, "")}；${targetName}守着${responseObject}旁的人，${stakeSentence}。`;
      }
      return outcome;
    }
    return outcome;
  }
  if (relationshipAct?.kind === "protect" && /药炉|医坊|救命|伤者|庇护|照骨司/.test(`${relationshipAct.reason || ""} ${sourceText} ${responseText}`)) {
    return withExchangeConsequences(`${signalPrefix}${localProtectionOutcome(simulationTick?.locationName || "", targetName, responseObject, sourceName, sourceObject)}`);
  }
  if (mode === "block") {
    if (sameObject) return withExchangeConsequences(`${signalPrefix}${targetName}没有接${sourceName}递出的${sourceObject}，把${sourceObject}压回${surface}；${sourceObject}被留在两人中间。`);
    return withExchangeConsequences(`${signalPrefix}${targetName}没有接${sourceName}递出的${sourceObject}，把${responseObject}压到旁边；${sourceObject}被留在两人中间。`);
  }
  if (mode === "withdraw") {
    if (sameObject) return withExchangeConsequences(`${signalPrefix}${targetName}把${sourceObject}收回身前，${sourceName}的手停在${surface}外；${sourceObject}没有换到旁人手里。`);
    return withExchangeConsequences(`${signalPrefix}${targetName}把${responseObject}收回身前，${sourceName}推来的${sourceObject}停在原处；${targetName}的手仍压在${responseObject}上。`);
  }
  if (mode === "hold") {
    if (sameObject) return withExchangeConsequences(`${signalPrefix}${targetName}按住${sourceObject}，${sourceName}递出的手没有落下；${sourceObject}仍停在两人之间。`);
    return withExchangeConsequences(`${signalPrefix}${targetName}按住${sourceObject}，又把${responseObject}留在旁边；${sourceName}递出的${sourceObject}没有落到旁人手里。`);
  }
  if (mode === "commit") {
    if (sameObject) return withExchangeConsequences(`${signalPrefix}${targetName}把${sourceObject}压回${surface}，${sourceName}也没有把手收回去；${sourceObject}仍停在两人之间。`);
    return withExchangeConsequences(`${signalPrefix}${targetName}把${responseObject}压到${sourceObject}旁，${sourceName}也没有把${sourceObject}收回去；两件东西一起留在场中。`);
  }
  if (sameObject) return withExchangeConsequences(`${signalPrefix}${sourceName}留下的${sourceObject}停在两人中间；${targetName}伸手碰到它，没有把它收走。`);
  return withExchangeConsequences(`${signalPrefix}${sourceName}留下的${sourceObject}停在两人中间；${targetName}伸手碰到${contestedObject}，没有把它收走。`);
}

function worldBoundaryForTick(simulationTick = {}) {
  return simulationTick.visiblePressure
    || simulationTick.visibilityLayer?.visibleFacts?.join("；")
    || simulationTick.locationName
    || "";
}

function relationshipModeDeltas(mode = "touch", responseTone = "试探") {
  const byMode = {
    block: {
      sourceToTarget: { resentment: 3, wantsToBeSeen: 3, power: -1, deception: 1 },
      targetToSource: { fear: 2, wantsToEscape: 3, power: 2, deception: 2 },
    },
    withdraw: {
      sourceToTarget: { resentment: 2, shame: 2, wantsToBeSeen: 2 },
      targetToSource: { wantsToEscape: 4, deception: 2, fear: 1 },
    },
    hold: {
      sourceToTarget: { wantsToBeSeen: 3, resentment: 2, dependence: 1 },
      targetToSource: { power: 2, fear: 1, deception: 2 },
    },
    commit: {
      sourceToTarget: { dependence: 2, wantsToBeSeen: 2, deception: 1 },
      targetToSource: { power: 1, wantsToBeSeen: 2, deception: 1 },
    },
    touch: {
      sourceToTarget: { wantsToBeSeen: 2, deception: 1 },
      targetToSource: { wantsToBeSeen: 2, fear: 1 },
    },
  };
  const selected = byMode[mode] || byMode.touch;
  if (responseTone === "保护") {
    return {
      sourceToTarget: { ...selected.sourceToTarget, dependence: (selected.sourceToTarget.dependence || 0) + 1 },
      targetToSource: { ...selected.targetToSource, protection: (selected.targetToSource.protection || 0) + 3 },
    };
  }
  if (responseTone === "惩罚" || responseTone === "陷害") {
    return {
      sourceToTarget: { ...selected.sourceToTarget, resentment: (selected.sourceToTarget.resentment || 0) + 2 },
      targetToSource: { ...selected.targetToSource, revenge: (selected.targetToSource.revenge || 0) + 3 },
    };
  }
  return selected;
}

function mergeDeltasKeepingStronger(base = {}, texture = {}) {
  const merged = { ...(base || {}) };
  for (const [key, value] of Object.entries(texture || {})) {
    const current = Number(merged[key] || 0);
    const next = Number(value || 0);
    merged[key] = Math.abs(next) > Math.abs(current) ? next : current;
  }
  return merged;
}

function relationshipDialogueActFromText(text = "", speakerName = "人物", sharedObject = "") {
  const line = String(text || "");
  const object = sharedObject || "场中物件";
  if (/救命|先救|药炉|医坊|不问正邪|人不能|不能被拖|护住|保护|伤者/.test(line)) {
    return {
      kind: "protect",
      deltas: { protection: 4, dependence: 1 },
      reason: `${speakerName}把${object}重新命名为救命和保护的边界。`,
    };
  }
  if (/城规|规矩|界石|盖印|名字|签押|照骨司|审讯|扣押|命名|解释权/.test(line)) {
    return {
      kind: "control",
      deltas: { power: 3, wantsToBeSeen: 1, deception: 1 },
      reason: `${speakerName}用${object}争夺城规、名字或解释权。`,
    };
  }
  if (/不交|不走|不能离开|不换手|退半步|先别动|别带走|撤开|退开/.test(line)) {
    return {
      kind: "withdraw",
      deltas: { wantsToEscape: 3, fear: 1, deception: 1 },
      reason: `${speakerName}把${object}留在场中，同时给自己留退路。`,
    };
  }
  if (/价码|买卖|押的是|押上|毒誓|换符/.test(line)) {
    return {
      kind: "bargain",
      deltas: { deception: 3, power: 1 },
      reason: `${speakerName}把${object}改成交易筹码。`,
    };
  }
  if (/证据不能走|旧案|翻案|审判|追杀|血仇/.test(line)) {
    return {
      kind: "accuse",
      deltas: { resentment: 3, power: 1 },
      reason: `${speakerName}把${object}说成审判、旧案或追责的证据。`,
    };
  }
  return null;
}

function relationshipDialogueActForSpeaker(dialogueTurns = [], speakerId = "", speakerName = "人物", sharedObject = "") {
  const spoken = (dialogueTurns || [])
    .filter((turn) => turn?.speakerId === speakerId)
    .map((turn) => turn.line)
    .filter(Boolean)
    .join(" ");
  return relationshipDialogueActFromText(spoken, speakerName, sharedObject);
}

function relationshipMomentumFromHistory(sourceSim = {}, targetSim = {}) {
  const histories = [sourceSim?.relationshipDialogueHistory, targetSim?.relationshipDialogueHistory]
    .filter(Array.isArray)
    .sort((a, b) => b.length - a.length);
  const history = histories[0] || [];
  const historyCount = Math.max(
    history.length,
    Number(sourceSim?.relationshipHistoryCount || 0),
    Number(targetSim?.relationshipHistoryCount || 0),
  );
  if (historyCount < 2) return null;
  const objects = [...new Set(history.map((item) => item.sharedObject).filter(Boolean))].slice(-3);
  const latest = history.at(-1) || {};
  return {
    historyCount,
    objects,
    latestTurn: latest.followupTurn || latest.finalTurn || "",
    reason: `连续${historyCount}轮围绕${objects.join("、") || "同一组筹码"}没结清，关系变化不再按单次互动计算。`,
  };
}

function applyRelationshipMomentum(deltas = {}, momentum = null, side = "source") {
  if (!momentum) return deltas;
  const boost = Math.min(3, Math.max(1, Number(momentum.historyCount || 0)));
  const next = { ...deltas };
  if (side === "source") {
    next.resentment = (next.resentment || 0) + boost;
    next.wantsToBeSeen = (next.wantsToBeSeen || 0) + boost;
  } else {
    next.fear = (next.fear || 0) + boost;
    next.wantsToEscape = (next.wantsToEscape || 0) + boost;
  }
  return next;
}

function normalizeDialogueTurnsForRelationship(turns = []) {
  return (Array.isArray(turns) ? turns : [])
    .map((turn) => {
      const line = String(turn?.line || "").trim();
      if (!line) return null;
      return {
        speakerId: String(turn?.speakerId || ""),
        speakerName: String(turn?.speakerName || ""),
        targetId: String(turn?.targetId || ""),
        targetName: String(turn?.targetName || ""),
        line,
        turnRole: String(turn?.turnRole || ""),
        respondsTo: String(turn?.respondsTo || ""),
        triggeredBy: String(turn?.triggeredBy || ""),
      };
    })
    .filter(Boolean);
}

function buildRelationshipDeltasForExchange({ sourceOutput, responseOutput, sourceSim, targetSim, dialogueTurns, eventOutcome, sharedObject, conductorSignal = null }) {
  const sourceId = sourceOutput?.characterId || responseOutput?.interactionInput?.sourceCharacterId || "";
  const targetId = responseOutput?.characterId || "";
  if (!sourceId || !targetId || sourceId === targetId) return [];
  const sourceName = sourceSim?.characterName || sourceOutput?.characterName || sourceId;
  const targetName = targetSim?.characterName || responseOutput?.characterName || targetId;
  const thirdPartyId = responseOutput?.interactionInput?.ownTargetCharacterIdBeforeResponse || "";
  const thirdPartyName = responseOutput?.interactionInput?.ownTargetNameBeforeResponse || thirdPartyId;
  const routesProtectionToThirdParty = responseOutput?.tone === "保护"
    && thirdPartyId
    && thirdPartyId !== sourceId
    && thirdPartyId !== targetId
    && (!thirdPartyName || String(eventOutcome || "").includes(`护住${thirdPartyName}`));
  const mode = movementMode(responseOutput?.visibleAction || "");
  const deltas = relationshipModeDeltas(mode, routesProtectionToThirdParty ? "试探" : responseOutput?.tone || "试探");
  const momentum = relationshipMomentumFromHistory(sourceSim, targetSim);
  const firstTurn = dialogueTurns?.[0]?.line || sourceOutput?.visibleAction || "";
  const responseTurn = dialogueTurns?.[1]?.line || responseOutput?.visibleAction || "";
  const counterTurn = dialogueTurns?.[2]?.line || "";
  const continuationTurns = (Array.isArray(dialogueTurns) ? dialogueTurns : []).slice(3).filter((turn) => turn?.line);
  const followupTurn = continuationTurns.at?.(-1)?.line || dialogueTurns?.[3]?.line || "";
  const finalTurn = dialogueTurns?.at?.(-1)?.line || followupTurn || counterTurn || responseTurn || firstTurn;
  const normalizedDialogueTurns = normalizeDialogueTurnsForRelationship(dialogueTurns);
  const sourceDialogueAct = relationshipDialogueActForSpeaker(normalizedDialogueTurns, sourceId, sourceName, sharedObject);
  const targetDialogueAct = relationshipDialogueActForSpeaker(normalizedDialogueTurns, targetId, targetName, sharedObject);
  const targetDialogueActForSource = routesProtectionToThirdParty && targetDialogueAct?.kind === "protect"
    ? null
    : targetDialogueAct;
  const retreatWasBlocked = /退路|不能替你写|不能被.*改成退路|不能只把话推回去/.test(`${eventOutcome || ""} ${finalTurn || ""} ${followupTurn || ""}`);
  const retreatTexture = retreatWasBlocked
    ? {
        sourceToTarget: { wantsToBeSeen: 3, resentment: 3, power: 3, deception: 1 },
        targetToSource: { fear: 3, wantsToEscape: 4, deception: 2, shame: 1 },
        sourceMisreading: `${sourceName}把${targetName}试图把${sharedObject || "那件东西"}改成退路听成对自己判断权的逃避。`,
        targetMisreading: `${targetName}把${sourceName}压回界石前的最后一句听成自己的退路被堵住。`,
      }
    : null;
  const base = {
    generatedFrom: "agent-dialogue-relationship",
    sourceOutputId: sourceOutput?.outputId || responseOutput?.interactionInput?.sourceOutputId || "",
    responseOutputId: responseOutput?.outputId || "",
    dialogueTurnCount: normalizedDialogueTurns.length,
    dialogueTurns: normalizedDialogueTurns,
    eventOutcome,
    sharedObject,
    triggeredBy: conductorSignal?.inWorldClue || "",
    conductorSignal: conductorSignal || null,
    finalTurn,
    followupTurn,
    relationshipSource: "agent-exchange",
  };
  const participantShifts = [
    {
      ...base,
      fromCharacterId: sourceId,
      toCharacterId: targetId,
      deltas: applyRelationshipMomentum(
        mergeDeltasKeepingStronger(
          mergeDeltasKeepingStronger(deltas.sourceToTarget, sourceDialogueAct?.deltas),
          retreatTexture?.sourceToTarget,
        ),
        momentum,
        "source",
      ),
      relationshipMomentum: momentum || undefined,
      relationshipDialogueAct: sourceDialogueAct || undefined,
      misreading: retreatTexture?.sourceMisreading || `${sourceName}把${targetName}的回应“${responseTurn}”${followupTurn ? `和追问“${followupTurn}”` : ""}记成对自己判断权的挑战。`,
      unspoken: counterTurn || eventOutcome,
    },
    {
      ...base,
      fromCharacterId: targetId,
      toCharacterId: sourceId,
      deltas: applyRelationshipMomentum(
        mergeDeltasKeepingStronger(
          mergeDeltasKeepingStronger(deltas.targetToSource, targetDialogueActForSource?.deltas),
          retreatTexture?.targetToSource,
        ),
        momentum,
        "target",
      ),
      relationshipMomentum: momentum || undefined,
      relationshipDialogueAct: targetDialogueActForSource || undefined,
      misreading: retreatTexture?.targetMisreading || `${targetName}把${sourceName}的开口“${firstTurn}”听成必须马上自保的逼近。`,
      unspoken: followupTurn || eventOutcome,
    },
  ];
  if (!routesProtectionToThirdParty) return participantShifts;

  const protectionObject = responseOutput?.interactionInput?.ownObjectBeforeResponse || sharedObject;
  const protectionAct = {
    kind: "protect",
    deltas: { protection: 5, dependence: 2 },
    reason: `${targetName}用${protectionObject || "手边物件"}挡在${sourceName}和${thirdPartyName}之间。`,
  };
  const thirdPartyBase = {
    ...base,
    sharedObject: protectionObject || sharedObject,
    relationshipSource: "agent-third-party-protection",
    relationshipDialogueAct: protectionAct,
  };
  return [
    ...participantShifts,
    {
      ...thirdPartyBase,
      fromCharacterId: targetId,
      toCharacterId: thirdPartyId,
      deltas: { protection: 5, dependence: 2, power: 1 },
      misreading: `${targetName}把${thirdPartyName}留在自己身后的停顿记成默认这份保护。`,
      unspoken: `${targetName}替${thirdPartyName}挡下${sourceName}，也把这次保护变成一笔没有说出口的关系债。`,
    },
    {
      ...thirdPartyBase,
      fromCharacterId: thirdPartyId,
      toCharacterId: targetId,
      deltas: { dependence: 3, fear: 2, wantsToBeSeen: 1, shame: 1 },
      misreading: `${thirdPartyName}把${targetName}的保护同时读成援手和新的控制。`,
      unspoken: `${thirdPartyName}没有立刻拒绝${targetName}挡在身前，也没有承认自己欠下回应。`,
    },
  ];
}

function thirdPartyRelationshipTextureForMove(move = "challenge", fromThirdParty = false) {
  const byMove = {
    protect: fromThirdParty
      ? { protection: 4, dependence: 2, wantsToBeSeen: 1 }
      : { protection: 5, dependence: 3 },
    refuse: fromThirdParty
      ? { wantsToEscape: 4, resentment: 3, fear: 1 }
      : { shame: 3, protection: 2, wantsToPossess: 2 },
    question: fromThirdParty
      ? { wantsToBeSeen: 3, power: 2, fear: 1 }
      : { shame: 2, dependence: 1, power: 1 },
    bargain: fromThirdParty
      ? { deception: 3, power: 2, dependence: 1 }
      : { deception: 2, wantsToPossess: 2, dependence: 1 },
    challenge: fromThirdParty
      ? { resentment: 2, power: 2, wantsToBeSeen: 1 }
      : { shame: 2, power: 1, dependence: 1 },
  };
  return byMove[move] || byMove.challenge;
}

function compressedThirdPartyInterjectionLine(sim = {}, output = {}) {
  const text = [
    sim?.privateDesire,
    sim?.defensiveMask,
    sim?.shadowImpulse,
    sim?.agentProfile?.dramaticObjective,
    sim?.agentProfile?.leverageObject,
    output?.visibleAction,
  ].filter(Boolean).join(" ");
  if (/庇护|救命|伤者|病人|药炉|医坊/.test(text)) return "伤者先归我看。";
  if (/价码|买卖|交易|换符|魔印/.test(text)) return "这笔价算到我头上。";
  if (/照骨镜|案卷|记录|名字|供词/.test(text)) return "把我的名字也记进去。";
  if (/渡令|水线|水阵|追杀/.test(text)) return "水线以内的人由我带走。";
  if (/魂灯|死者|死人|引魂/.test(text)) return "让死者把话说完。";
  const targetName = output?.targetCharacterName || sim?.targetCharacterName || "";
  const variants = [
    "这件事也算我一份。",
    "先听我把话说完。",
    "你们不能替我决定。",
    "这里不只你们两个人。",
    "我也有话要说。",
    "这件事不能绕过我。",
    "别当我没有听见。",
    "我的话还没说。",
  ];
  let hash = 0;
  for (const char of String(sim?.characterId || output?.characterId || sim?.characterName || "")) hash = (hash * 33 + char.codePointAt(0)) % 104729;
  const start = hash % variants.length;
  const rotated = variants.slice(start).concat(variants.slice(0, start));
  const recent = new Set((output?.recentDialogueLines || []).map((line) => normalizeDialogueLine(line)).filter(Boolean));
  const addressed = (line) => `${targetName ? `${targetName}，` : ""}${line}`;
  return addressed(rotated.find((line) => !recent.has(normalizeDialogueLine(addressed(line)))) || rotated[0]);
}

function attachThirdPartyAgentInterjections(beats = [], agentOutputs = [], privateSimulations = []) {
  const outputById = new Map((agentOutputs || []).filter((output) => output?.outputId).map((output) => [output.outputId, output]));
  const outputByCharacterId = new Map((agentOutputs || []).filter((output) => output?.characterId).map((output) => [output.characterId, output]));
  const simByCharacterId = new Map((privateSimulations || []).filter((sim) => sim?.characterId).map((sim) => [sim.characterId, sim]));

  return (beats || []).map((beat) => {
    const responseOutput = outputById.get(beat.responseOutputId);
    const thirdPartyId = responseOutput?.interactionInput?.ownTargetCharacterIdBeforeResponse || "";
    const thirdPartyName = responseOutput?.interactionInput?.ownTargetNameBeforeResponse || simByCharacterId.get(thirdPartyId)?.characterName || thirdPartyId;
    if (!thirdPartyId || thirdPartyId === beat.sourceCharacterId || thirdPartyId === beat.responseCharacterId) return beat;
    if ((beat.dialogueTurns || []).some((turn) => turn?.speakerId === thirdPartyId)) return beat;

    const thirdPartyOutput = outputByCharacterId.get(thirdPartyId);
    const thirdPartyReaction = thirdPartyOutput?.cognitiveDecision?.reaction || thirdPartyOutput?.reactionIntent || "";
    if (!["talk", "respond"].includes(thirdPartyReaction)) return beat;
    const thirdPartyBeat = (beats || []).find((candidate) => (
      candidate !== beat
      && (candidate.dialogueTurns || []).some((turn) => turn?.speakerId === thirdPartyId)
    ));
    const ownTurn = (thirdPartyBeat?.dialogueTurns || []).find((turn) => turn?.speakerId === thirdPartyId);
    const rawOutputLine = normalizeDialogueLine(extractQuotedSpeech(thirdPartyOutput?.visibleAction) || "");
    const expandedLine = normalizeDialogueLine(ownTurn?.line || "");
    const existingThirdPartyLines = (thirdPartyBeat?.dialogueTurns || [])
      .filter((turn) => turn?.speakerId === thirdPartyId)
      .map((turn) => normalizeDialogueLine(turn.line || ""))
      .filter(Boolean);
    const isUnusedLine = (candidate = "") => candidate
      && !staleDefenseSloganLine(candidate)
      && !existingThirdPartyLines.some((existing) => (
        existing === candidate || existing.includes(candidate) || candidate.includes(existing)
      ));
    const line = [
      expandedLine,
      normalizeDialogueLine(thirdPartyOutput?.dialogueDecision?.utterance || ""),
      rawOutputLine,
    ].find(isUnusedLine) || normalizeDialogueLine(compressedThirdPartyInterjectionLine(
      simByCharacterId.get(thirdPartyId) || {},
      thirdPartyOutput || {},
    ));
    if (!thirdPartyOutput?.outputId || !line) return beat;

    const previousTurn = (beat.dialogueTurns || []).at?.(-1) || {};
    const interjection = {
      turnId: createId("dialogue_turn"),
      generatedBy: "character-agent",
      speakerId: thirdPartyId,
      speakerName: thirdPartyName,
      targetId: ownTurn?.targetId || beat.responseCharacterId || beat.sourceCharacterId || "",
      targetName: ownTurn?.targetName || beat.targetName || beat.actorName || "对方",
      line,
      turnRole: "third_party_interjection",
      proposition: simByCharacterId.get(thirdPartyId)?.privateDesire || "",
      respondsTo: previousTurn.line || "",
      observedTurnId: previousTurn.turnId || "",
      observedUtterance: previousTurn.line || "",
      triggeredBy: `${beat.targetName || beat.responseCharacterId || "有人"}把第三方卷入当前行动`,
      sourceOutputId: thirdPartyOutput.outputId,
    };
    const dialogueTurns = [...(beat.dialogueTurns || []), interjection];
    const thirdPartyResponseMove = classifyDialogueResponseMove({
      speech: line,
      targetSim: simByCharacterId.get(thirdPartyId) || {},
    });
    const relationshipDeltas = (beat.relationshipDeltas || []).map((shift) => {
      if (shift.relationshipSource !== "agent-third-party-protection") return shift;
      if (shift.fromCharacterId !== thirdPartyId && shift.toCharacterId !== thirdPartyId) return shift;
      const shiftTurns = normalizeDialogueTurnsForRelationship(dialogueTurns);
      const fromThirdParty = shift.fromCharacterId === thirdPartyId;
      const moveTexture = thirdPartyRelationshipTextureForMove(thirdPartyResponseMove, fromThirdParty);
      return {
        ...shift,
        deltas: mergeDeltasKeepingStronger(shift.deltas, moveTexture),
        dialogueTurns: shiftTurns,
        dialogueTurnCount: shiftTurns.length,
        finalTurn: line,
        followupTurn: line,
        relationshipDialogueAct: fromThirdParty ? {
          kind: thirdPartyResponseMove,
          deltas: moveTexture,
          reason: `${thirdPartyName}用自己的话回应了${beat.targetName || beat.responseCharacterId || "对方"}施加的保护。`,
        } : shift.relationshipDialogueAct,
      };
    });
    return {
      ...beat,
      thirdPartyCharacterId: thirdPartyId,
      thirdPartyCharacterName: thirdPartyName,
      thirdPartyOutputId: thirdPartyOutput.outputId,
      dialogueTurns,
      dialogueDecision: {
        ...(beat.dialogueDecision || {}),
        thirdPartyMove: "interject",
        thirdPartyResponseMove,
      },
      relationshipDeltas,
    };
  });
}

function buildCausalInteractionBeats(agentOutputs = [], privateSimulations = [], simulationTick = {}) {
  const byOutputId = new Map(agentOutputs.filter((output) => output?.outputId).map((output) => [output.outputId, output]));
  const byCharacterId = new Map(privateSimulations.map((sim) => [sim.characterId, sim]));
  const claimLinesBySource = new Map();
  const seenAgentTurnIds = new Set();
  const beats = [];
  for (const output of agentOutputs.filter((candidate) => candidate?.interactionInput?.sourceOutputId)) {
    const sourceOutput = byOutputId.get(output.interactionInput.sourceOutputId);
    const sourceSim = byCharacterId.get(sourceOutput?.characterId);
    const targetSim = byCharacterId.get(output.characterId);
    const actorName = sourceSim?.characterName || sourceOutput?.characterName || sourceOutput?.characterId || output.interactionInput.sourceCharacterId;
    const targetName = targetSim?.characterName || output.characterName || output.characterId;
    const sharedObject = output.interactionInput.sharedObject || "";
    const conductorSignal = conductorSignalForExchange(sourceOutput, output);
    const sourceId = sourceOutput?.characterId || output.interactionInput.sourceCharacterId || "";
    const previousClaimLines = claimLinesBySource.get(sourceId) || [];
    const dialogueResult = buildDialogueTurnsForExchange({
      sourceOutput,
      responseOutput: output,
      sourceSim,
      targetSim,
      simulationTick,
      sharedObject,
      conductorSignal,
      sameSceneClaimLines: previousClaimLines,
    });
    const dialogueTurns = (dialogueResult.dialogueTurns || []).filter((turn) => {
      if (turn.generatedBy !== "character-agent" || !turn.turnId) return true;
      if (seenAgentTurnIds.has(turn.turnId)) return false;
      seenAgentTurnIds.add(turn.turnId);
      return true;
    });
    const dialogueDecision = dialogueResult.dialogueDecision || null;
    const firstClaim = (dialogueTurns || []).find((turn) => turn?.speakerId === sourceId && turn?.turnRole === "claim")?.line;
    if (firstClaim) {
      claimLinesBySource.set(sourceId, [...previousClaimLines, firstClaim]);
    }
    const eventOutcome = buildEventOutcomeForExchange({
      sourceOutput,
      responseOutput: output,
      sourceSim,
      targetSim,
      simulationTick,
      sharedObject,
      conductorSignal,
      dialogueTurns,
    });
    const relationshipDeltas = buildRelationshipDeltasForExchange({
      sourceOutput,
      responseOutput: output,
      sourceSim,
      targetSim,
      dialogueTurns,
      eventOutcome,
      sharedObject,
      conductorSignal,
    });
    beats.push({
      actorId: sourceOutput?.characterId || output.interactionInput.sourceCharacterId,
      actorName,
      targetId: output.characterId,
      targetName,
      beat: `${actorName}先做出动作：${sourceOutput?.visibleAction || output.interactionInput.observedVisibleAction} ${targetName}接住这一拍：${output.visibleAction}`,
      visibleBeat: sourceOutput?.visibleAction || output.interactionInput.observedVisibleAction,
      responseBeat: output.visibleAction,
      privateIntent: sourceSim?.privateDesire || sourceOutput?.privateDesire || "",
      defensiveMask: sourceSim?.defensiveMask || sourceOutput?.defenseAction || "",
      shadowLeak: sourceSim?.shadowImpulse || sourceOutput?.shadowAction || "",
      sourceOutputId: sourceOutput?.outputId || output.interactionInput.sourceOutputId,
      responseOutputId: output.outputId,
      sourceCharacterId: sourceOutput?.characterId || output.interactionInput.sourceCharacterId,
      responseCharacterId: output.characterId,
      observedVisibleAction: output.interactionInput.observedVisibleAction,
      responseVisibleAction: output.visibleAction,
      sharedObject,
      conductorSignal,
      dialogueTurns,
      dialogueDecision,
      eventOutcome,
      relationshipDeltas,
      outcomeSource: "agent-actions",
      worldBoundary: worldBoundaryForTick(simulationTick),
      stateDelta: eventOutcome,
      generatedFrom: "agent-interaction-loop",
    });
  }
  return attachThirdPartyAgentInterjections(beats, agentOutputs, privateSimulations);
}

function participantRecordsForBeat(beat = {}) {
  return [
    {
      id: beat.sourceCharacterId || beat.actorId || "",
      name: beat.actorName || beat.sourceCharacterName || "",
    },
    {
      id: beat.responseCharacterId || beat.targetId || "",
      name: beat.targetName || beat.responseCharacterName || "",
    },
  ].filter((item) => item.id || item.name);
}

function turnSpeakerLabel(turn = {}) {
  return turn?.speakerName || turn?.speakerId || "对方";
}

function overheardRelationshipDeltasForText(text = "") {
  const line = String(text || "");
  if (/庇护牌|伤者|救命|医坊|药炉|人名/.test(line)) {
    return { protection: 3, fear: 1, wantsToBeSeen: 1 };
  }
  if (/价码|旧案|进账|买|血河|命/.test(line)) {
    return { fear: 2, deception: 2, resentment: 1 };
  }
  if (/界石|铜盘|城法|证据|审讯|盖印/.test(line)) {
    return { power: 2, fear: 1, wantsToBeSeen: 1 };
  }
  if (/水线|渡令|水阵|追杀/.test(line)) {
    return { protection: 2, wantsToEscape: 2, fear: 1 };
  }
  if (/魂灯|死人|供词|案卷|镜/.test(line)) {
    return { fear: 1, power: 1, deception: 1 };
  }
  return { wantsToBeSeen: 1, fear: 1 };
}

function buildOverheardRelationshipShifts(causalBeats = [], simulationTick = {}) {
  const shifts = [];
  for (const beat of causalBeats) {
    const turns = Array.isArray(beat.dialogueTurns) ? beat.dialogueTurns : [];
    const interjectionIndex = turns.findIndex((turn) => turn?.turnRole === "third_party_interjection");
    if (interjectionIndex <= 0) continue;
    const interjection = turns[interjectionIndex] || {};
    const addressedTurn = interjection.targetId
      ? turns.find((turn) => turn?.speakerId === interjection.targetId && turn !== interjection)
      : null;
    const heardTurn = addressedTurn || turns[interjectionIndex - 1] || {};
    if (!heardTurn.speakerId || !interjection.speakerId || heardTurn.speakerId === interjection.speakerId) continue;
    const heardLine = String(heardTurn.line || "").trim();
    const stakeLine = String(interjection.line || "").trim();
    const sharedObject = beat.sharedObject || "";
    const dialogueTurns = normalizeDialogueTurnsForRelationship([
      { ...heardTurn, turnRole: "overheard" },
      { ...interjection, respondsTo: heardLine },
    ]);
    shifts.push({
      generatedFrom: "agent-dialogue-relationship",
      relationshipSource: "overheard-dialogue",
      fromCharacterId: interjection.speakerId,
      toCharacterId: heardTurn.speakerId,
      deltas: overheardRelationshipDeltasForText(`${heardLine} ${stakeLine}`),
      sourceOutputId: beat.sourceOutputId || "",
      responseOutputId: beat.responseOutputId || "",
      dialogueTurnCount: dialogueTurns.length,
      dialogueTurns,
      eventOutcome: beat.eventOutcome || "",
      sharedObject,
      locationId: simulationTick.locationId || "",
      locationName: simulationTick.locationName || "",
      triggeredBy: `${interjection.speakerName || interjection.speakerId}听见${heardTurn.speakerName || heardTurn.speakerId}刚才那句`,
      finalTurn: stakeLine,
      followupTurn: stakeLine,
      misreading: `${interjection.speakerName || interjection.speakerId}听见${heardTurn.speakerName || heardTurn.speakerId}说“${heardLine.replace(/[。！？…]+$/g, "")}”，把这句话记成自己必须介入${sharedObject || "眼前这件事"}的理由。`,
      unspoken: `${interjection.speakerName || interjection.speakerId}用“${stakeLine.replace(/[。！？…]+$/g, "")}”接住刚才那句，${sharedObject || "场中筹码"}从此也算进自己的立场。`,
    });
  }
  for (let index = 1; index < causalBeats.length; index += 1) {
    const previous = causalBeats[index - 1] || {};
    const current = causalBeats[index] || {};
    const previousParticipants = participantRecordsForBeat(previous);
    const currentParticipants = participantRecordsForBeat(current);
    const previousIds = new Set(previousParticipants.map((item) => item.id).filter(Boolean));
    const previousNames = new Set(previousParticipants.map((item) => item.name).filter(Boolean));
    const newcomer = currentParticipants.find((item) => !previousIds.has(item.id) && !previousNames.has(item.name));
    if (!newcomer?.id) continue;
    const previousTurns = Array.isArray(previous.dialogueTurns) ? previous.dialogueTurns : [];
    const heardTurn = previousTurns[1] || previousTurns.at?.(-1);
    if (!heardTurn?.speakerId || heardTurn.speakerId === newcomer.id) continue;
    const currentTurns = Array.isArray(current.dialogueTurns) ? current.dialogueTurns : [];
    const currentStakeTurn = currentTurns.find((turn) => turn?.speakerId === newcomer.id)
      || currentTurns.find((turn) => /庇护牌|伤者|救命|价码|旧案|界石|灵契|铜盘/.test(turn?.line || ""))
      || currentTurns[0]
      || {};
    const heardLine = String(heardTurn.line || "").trim();
    const stakeLine = String(currentStakeTurn.line || current.eventOutcome || "").trim();
    const heardSpeaker = turnSpeakerLabel(heardTurn);
    const sharedObject = current.sharedObject || previous.sharedObject || "";
    const dialogueTurns = normalizeDialogueTurnsForRelationship([
      {
        speakerId: heardTurn.speakerId,
        speakerName: heardSpeaker,
        targetId: heardTurn.targetId || "",
        targetName: heardTurn.targetName || "",
        line: heardLine,
        turnRole: "overheard",
      },
      {
        speakerId: newcomer.id,
        speakerName: newcomer.name,
        targetId: heardTurn.speakerId,
        targetName: heardSpeaker,
        line: stakeLine || `${newcomer.name}听见${heardSpeaker}刚才那句，没有退到场外。`,
        turnRole: "interjection",
        respondsTo: heardLine,
      },
    ]);
    shifts.push({
      generatedFrom: "agent-dialogue-relationship",
      relationshipSource: "overheard-dialogue",
      fromCharacterId: newcomer.id,
      toCharacterId: heardTurn.speakerId,
      deltas: overheardRelationshipDeltasForText(`${heardLine} ${stakeLine} ${current.eventOutcome || ""}`),
      sourceOutputId: previous.sourceOutputId || "",
      responseOutputId: current.responseOutputId || "",
      dialogueTurnCount: dialogueTurns.length,
      dialogueTurns,
      eventOutcome: current.eventOutcome || previous.eventOutcome || "",
      sharedObject,
      locationId: simulationTick.locationId || "",
      locationName: simulationTick.locationName || "",
      triggeredBy: `听见${heardSpeaker}刚才那句`,
      finalTurn: stakeLine || dialogueTurns.at(-1)?.line || "",
      followupTurn: stakeLine || "",
      misreading: `${newcomer.name}听见${heardSpeaker}刚才说“${heardLine.replace(/[。！？…]+$/g, "")}”，把这句话记成${heardSpeaker}正在把${sharedObject || "场中筹码"}推向自己必须回应的位置。`,
      unspoken: `${newcomer.name}把“${(stakeLine || sharedObject || "刚才那句").replace(/[。！？…]+$/g, "")}”接到自己手边，关系不再只是旁观。`,
    });
  }
  return shifts;
}

export function runSceneInteractionSimulation({ state, simulationTick, agentOutputs = [] }) {
  const privateSimulations = simulationTick.privateSimulations || [];
  const pairs = [];
  for (const source of privateSimulations) {
    const target = privateSimulations.find((item) => item.characterId === source.targetCharacterId) || privateSimulations.find((item) => item.characterId !== source.characterId);
    if (!target) continue;
    pairs.push({ source, target });
  }
  const causalBeats = buildCausalInteractionBeats(agentOutputs, privateSimulations, simulationTick);
  const interactionBeats = [
    ...causalBeats,
    ...pairs.map(({ source, target }) => ({
      actorId: source.characterId,
      actorName: source.characterName,
      targetId: target.characterId,
      targetName: target.characterName,
      beat: `${source.characterName}带着私人意图进入场景：${source.actionCandidate}；${target.characterName}不会完全按这个意图回应。`,
      privateIntent: source.privateDesire,
      defensiveMask: source.defensiveMask,
      shadowLeak: source.shadowImpulse,
      outcomeSource: "synthetic-private-simulation",
      generatedFrom: "private-simulation-pair",
    })),
  ];
  const misunderstandings = pairs.map(({ source, target }) => ({
    fromCharacterId: target.characterId,
    toCharacterId: source.characterId,
    misunderstanding: reciprocalMisread(state, source, target),
    falseCertainty: `${target.characterName}会以为自己看懂了${source.characterName}，但其实只看懂了${source.characterName}允许外露的那一层。`,
  }));
  const reversals = pairs
    .filter(({ source, target }) => Math.abs(Number(source.contradictionScore || 0) - Number(target.contradictionScore || 0)) < 22 || source.tone !== target.tone)
    .map(({ source, target }) => `${source.characterName}以为自己在${source.tone}，但${target.characterName}的反行动会把它改写成另一种关系压力。`);
  const visibilityFlips = privateSimulations.map((sim) => ({
    characterId: sim.characterId,
    characterName: sim.characterName,
    blindSpot: sim.visibilityBlindSpot,
    possibleExposure: `${sim.characterName}最可能被看穿的不是行为，而是行为背后的自我辩护。`,
  }));
  const relationshipMutationIntents = pairs.map(({ source, target }) => ({
    fromCharacterId: source.characterId,
    toCharacterId: target.characterId,
    mutation: `${source.characterName}的${source.tone}会让${target.characterName}把关系重新命名。`,
    expectedDelta: source.tone === "惩罚" ? "怨恨/羞耻/被看见上升" : source.tone === "保护" ? "保护/占有/依赖同时上升" : "吸引/欺骗/误读上升",
  }));
  const agentRelationshipShifts = [
    ...causalBeats.flatMap((beat) => beat.relationshipDeltas || []),
    ...buildOverheardRelationshipShifts(causalBeats, simulationTick),
  ];
  const simulationNotes = [
    "计划不再被当成剧情脚本，而是人物进入场景前对自己的谎。",
    "场景合成必须让私人意图在对方反应中破裂，而不是按计划机械成功。",
    simulationTick.hiddenPressure ? `隐藏压力：${simulationTick.hiddenPressure}` : "隐藏压力来自场所潜规则。",
  ];
  return {
    tickId: simulationTick.id,
    sceneThesis: "人物不是执行剧情，而是在同一场所中互相撞坏彼此的自我解释。",
    interactionBeats,
    misunderstandings,
    reversals,
    visibilityFlips,
    relationshipMutationIntents,
    agentExchanges: causalBeats,
    agentRelationshipShifts,
    simulationNotes,
  };
}

function observableActionFromRelationshipState(privateSimulation = {}, fallbackVisibleAction = "") {
  const state = privateSimulation.relationshipState || null;
  if (!state) return fallbackVisibleAction;
  const actor = privateSimulation.characterName || privateSimulation.characterId || "有人";
  const target = privateSimulation.targetCharacterName || privateSimulation.targetCharacterId || "对方";
  const locationName = privateSimulation.locationName || state.locationName || "";
  const object = localizeSceneObject(state.sharedObject || privateSimulation.agentProfile?.leverageObject || "手边物件", locationName);
  const surface = localInstitutionSurface(locationName);
  const witness = localWitnessName(locationName);
  const finalTurnLine = state.finalTurn
    ? localizeInstitutionalSpeech(state.finalTurn, { locationName, object, sourceObject: state.sharedObject })
    : "";
  const finalTurn = finalTurnLine ? ` ${actor}低声说：“${finalTurnLine}”` : "";
  const outcomeTail = relationshipOutcomeVisibleTailForSimulation(state, actor, object);
  const withOutcomeTail = (line = "") => {
    const text = String(line || "").trim();
    if (!text || !outcomeTail || text.includes(outcomeTail)) return text;
    if (/[。！？…][”」』）】〕》]?$/.test(text)) return `${text} ${outcomeTail}`;
    return `${text}。 ${outcomeTail}`;
  };
  if (state.kind === "protect") {
    const place = /医坊|药炉/.test(locationName || "") ? "药炉旁" : surface;
    const protectedPerson = protectedPersonShortPhrase(locationName || "");
    return withOutcomeTail(`${actor}把${object}按在${place}，挡住${target}看向${protectedPerson}的路。${finalTurn}`.trim());
  }
  if (state.kind === "control") {
    return withOutcomeTail(`${actor}把${object}推到两人中间，指尖停在见证处，没有让${target}先收回手。${finalTurn}`.trim());
  }
  if (state.kind === "bargain") {
    const outcomeProcedure = relationshipOutcomeProcedureBase(state, actor, object);
    const base = outcomeProcedure
      ? `${outcomeProcedure}，目光停在${target}手上`
      : `${actor}把${object}压到${surface}边，没有让${witness}先记下，目光停在${target}手上`;
    return withOutcomeTail(`${base}。${finalTurn}`.trim());
  }
  if (state.kind === "withdraw") {
    return withOutcomeTail(`${actor}退开半步，却把${object}留在原处，让${target}不得不看见它。${finalTurn}`.trim());
  }
  if (state.kind === "accuse") {
    return withOutcomeTail(`${actor}把${object}推回明处，等${target}先报出名字。${finalTurn}`.trim());
  }
  return withOutcomeTail(fallbackVisibleAction);
}

function relationshipOutcomeProcedureBase(state = {}, actor = "有人", object = "") {
  const outcome = String(state.eventOutcome || "").trim();
  if (!outcome || !object) return "";
  const clauses = outcome
    .split(/[。；]/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const owned = clauses.find((clause) => clause.includes(actor) && clause.includes(object));
  if (!owned || owned.length <= actor.length + object.length) return "";
  return owned.replace(/[。！？…]+$/, "");
}

function relationshipOutcomeVisibleTailForSimulation(state = {}, actor = "有人", object = "这件东西") {
  const outcome = String(state.eventOutcome || "");
  if (!outcome) return "";
  if (actorOwnsDarkLedgerFailure(outcome, actor)) {
    return `${actor}把袖口从${object}旁挪开，暗账没能被${actor}收回。`;
  }
  if (/价码|旧案/.test(outcome) && /暗账|账册|摊主|界石/.test(outcome) && actorOwnsDarkLedgerFailure(outcome, actor)) {
    return `${actor}把${object}压住，没有再把旧案藏回价码里。`;
  }
  if (/没有被写成价码|人被当成|人名/.test(outcome)) {
    return `${actor}看了一眼${object}旁的人名，手没有先伸出去。`;
  }
  if (/证词/.test(outcome)) {
    return `${actor}看向${object}旁多出的证词，话没有再退回原处。`;
  }
  return "";
}

function actorOwnsDarkLedgerFailure(outcome = "", actorName = "") {
  const actor = String(actorName || "").trim();
  if (!actor) return false;
  return String(outcome || "")
    .split(/[，,；;。！？]/)
    .map((clause) => clause.trim())
    .some((clause) => (
      clause.includes(actor)
      && /暗账/.test(clause)
      && (/没能.*收回暗账/.test(clause) || /暗账没能.*收回/.test(clause))
    ));
}

export function enrichAgentOutputWithPrivateSimulation(output, privateSimulation) {
  if (!privateSimulation) return output;
  const visibleAction = observableActionFromRelationshipState(privateSimulation, output.visibleAction);
  return {
    ...output,
    visibleAction,
    privateSimulationId: privateSimulation.id,
    privatePublicGoal: privateSimulation.publicGoal,
    privateDesire: privateSimulation.privateDesire,
    privateDefensiveMask: privateSimulation.defensiveMask,
    privateShadowImpulse: privateSimulation.shadowImpulse,
    privateActionCandidate: privateSimulation.actionCandidate,
    privateLeverageObject: privateSimulation.agentProfile?.leverageObject || "",
    relationshipState: privateSimulation.relationshipState || null,
    privateRefusal: privateSimulation.whatTheyRefuseToAdmit,
    simulationIntent: privateSimulation.simulationReason,
    visibilityBlindSpot: privateSimulation.visibilityBlindSpot,
    contradictionScore: privateSimulation.contradictionScore,
  };
}

export function buildSimulationAudit(draft, state = {}) {
  const privateSims = draft.privateSimulations || draft.simulationTick?.privateSimulations || [];
  const agentOutputs = draft.agentOutputs || [];
  const sceneInteraction = draft.sceneInteraction || {};
  const realAgentExchanges = sceneInteraction.agentExchanges || [];
  const realInteractionBeats = (sceneInteraction.interactionBeats || []).filter((beat) => beat?.outcomeSource === "agent-actions" || beat?.generatedFrom === "agent-interaction-loop");
  const coverage = clamp((privateSims.length ? agentOutputs.filter((out) => out.privateSimulationId || out.privateDesire || out.simulationIntent).length / privateSims.length : 0) * 100);
  const contradictionAverage = clamp(privateSims.reduce((sum, item) => sum + Number(item.contradictionScore || 0), 0) / Math.max(privateSims.length, 1));
  const visibilityTension = clamp(Number(draft.simulationTick?.contradictionPressureSummary?.hiddenFactPressure || 0) + (sceneInteraction.visibilityFlips || []).length * 8);
  const unscriptedCollision = clamp(
    realAgentExchanges.length * 24
      + realInteractionBeats.length * 10
      + (sceneInteraction.agentRelationshipShifts || []).length * 6,
  );
  const planScriptRisk = clamp(100 - unscriptedCollision + (privateSims.every((item) => item.sourcePlanId) ? 6 : 0) - (sceneInteraction.reversals || []).length * 8);
  const directorOverrideRisk = clamp(agentOutputs.length && privateSims.length ? 100 - coverage + (draft.sceneText && /于是|终于|解决|释怀/.test(draft.sceneText) ? 20 : 0) : 65);
  const sceneSimulationScore = clamp(coverage * 0.28 + contradictionAverage * 0.18 + visibilityTension * 0.2 + unscriptedCollision * 0.34);
  const warnings = [];
  const requiredFixes = [];
  if (coverage < 55) {
    warnings.push("角色代理没有充分继承私人模拟，场景可能仍被导演直接安排。 ");
    requiredFixes.push("让每个角色行动显式来自 privateDesire / defensiveMask / shadowImpulse。 ");
  }
  if (unscriptedCollision < 45) {
    warnings.push("人物意图之间缺少实时碰撞，计划可能被机械执行。 ");
    requiredFixes.push("增加至少一处误读、反行动、遮掩或关系反向命名。 ");
  }
  if (planScriptRisk > 65) {
    warnings.push("角色计划有脚本化风险：计划像剧情，不像人物对自己的谎。 ");
    requiredFixes.push("让计划在场景中被别人误读或被人物自己背叛。 ");
  }
  return {
    privateIntentCoverage: coverage,
    contradictionPressureScore: contradictionAverage,
    visibilityTensionScore: visibilityTension,
    unscriptedCollisionScore: unscriptedCollision,
    planScriptRisk,
    directorOverrideRisk,
    sceneSimulationScore,
    warnings,
    requiredFixes,
    shouldRegenerate: coverage < 40 || unscriptedCollision < 30 || planScriptRisk > 82,
  };
}

export function summarizeSimulationTick(tick) {
  if (!tick) return "无模拟 tick。";
  return `SimulationTick ${tick.id} / ${tick.grain} / ${tick.locationName}：私人模拟 ${tick.privateSimulations?.length || 0} 个，平均矛盾压力 ${tick.contradictionPressureSummary?.averageContradiction || 0}。`;
}

export function auditSimulationTick(tick = null) {
  if (!tick) {
    return {
      realtimeSimulationScore: 0,
      realtimeSimulationRisk: 100,
      avgContradiction: 0,
      visibilityScore: 0,
      privateSimulationCount: 0,
      warnings: ["缺少 SimulationTick；人物可能不是实时模拟生成。"],
      requiredFixes: ["先生成私人内心模拟、可见性层和场景互动模拟，再合成场景。"],
      shouldRegenerate: true,
    };
  }
  const privateSims = tick.privateSimulations || [];
  const interaction = tick.interaction || tick.sceneInteraction || {};
  const realAgentExchanges = interaction.agentExchanges || [];
  const realInteractionBeats = (interaction.interactionBeats || []).filter((beat) => beat?.outcomeSource === "agent-actions" || beat?.generatedFrom === "agent-interaction-loop");
  const avgContradiction = tick.contradictionPressureSummary?.averageContradiction ?? clamp(privateSims.reduce((sum, sim) => sum + Number(sim.contradictionScore || 0), 0) / Math.max(privateSims.length, 1));
  const visibilityRows = Array.isArray(tick.visibilityLayer) ? tick.visibilityLayer : (tick.visibilityLayer?.perCharacter || tick.visibilityLayer?.rows || []);
  const visibilityScore = clamp((visibilityRows.length ? 42 : 8) + (visibilityRows.reduce((sum, row) => sum + (row.falseBeliefs?.length || 0) + (row.blindSpots?.length || 0) + (row.hiddenFacts?.length || 0) + (row.cannotSee?.length || 0), 0) * 6));
  const collisionScore = clamp(
    realAgentExchanges.length * 24
      + realInteractionBeats.length * 10
      + (interaction.agentRelationshipShifts || []).length * 6
      + (interaction.irreversibleTrace?.length || 0) * 8,
  );
  const privateIntentScore = clamp(privateSims.filter((sim) => sim.privateDesire && sim.defensiveMask && sim.shadowImpulse).length / Math.max(privateSims.length, 1) * 100);
  const rawRealtimeSimulationScore = clamp(privateIntentScore * 0.35 + visibilityScore * 0.25 + collisionScore * 0.25 + avgContradiction * 0.15);
  const realtimeSimulationScore = collisionScore < 28
    ? Math.min(rawRealtimeSimulationScore, 44)
    : rawRealtimeSimulationScore;
  const realtimeSimulationRisk = clamp(100 - realtimeSimulationScore);
  const warnings = [];
  const requiredFixes = [];
  if (privateIntentScore < 65) {
    warnings.push("私人内心模拟覆盖不足，人物可能仍在执行剧情安排。 ");
    requiredFixes.push("为每个参与人物生成 privateDesire / defensiveMask / shadowImpulse。 ");
  }
  if (visibilityScore < 55) {
    warnings.push("可见性缺口不足，人物知道得太完整，误读会变弱。 ");
    requiredFixes.push("增加谁知道什么、谁误以为什么、谁故意隐藏什么。 ");
  }
  if (collisionScore < 45) {
    warnings.push("场景互动没有充分撞坏人物自我解释。 ");
    requiredFixes.push("增加误读、反行动、遮掩、保护、诱导或关系反向命名。 ");
  }
  return {
    realtimeSimulationScore,
    realtimeSimulationRisk,
    avgContradiction,
    visibilityScore,
    collisionScore,
    unscriptedCollisionScore: collisionScore,
    privateIntentScore,
    privateSimulationCount: privateSims.length,
    warnings,
    requiredFixes,
    shouldRegenerate: realtimeSimulationRisk > 72 || privateIntentScore < 45 || collisionScore < 28,
  };
}
