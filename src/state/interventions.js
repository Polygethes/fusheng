const TYPE_LABELS = {
  lock_motivation: "锁定动机",
  lock_relationship: "锁定关系方向",
  force_misread: "强制误读",
  force_action: "强制行动",
  event_impact: "事件冲击",
  force_silence: "强制沉默",
  force_protect: "强制保护",
  force_betray: "强制陷害/背叛",
  force_confession: "强制承认",
};

const ACTION_TONE = {
  force_action: "试探",
  force_silence: "伪装",
  force_protect: "保护",
  force_betray: "陷害",
  force_confession: "求证",
  lock_motivation: "试探",
  lock_relationship: "共谋",
  force_misread: "伪装",
  event_impact: "自毁",
};

export function interventionTypeLabel(type) {
  return TYPE_LABELS[type] || type || "干预";
}

export function interventionTypes() {
  return Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }));
}

export function activeInterventionsForState(state = {}) {
  return (state.interventions || []).filter((item) => item && item.enabled !== false && item.consumed !== true);
}

export function interventionsForPair(state = {}, fromCharacterId, toCharacterId) {
  return activeInterventionsForState(state).filter((item) => {
    if (item.scope === "global") return true;
    if (item.targetCharacterId === fromCharacterId && (!item.secondaryCharacterId || item.secondaryCharacterId === toCharacterId)) return true;
    if (item.secondaryCharacterId === fromCharacterId && item.targetCharacterId === toCharacterId) return true;
    return false;
  });
}

export function summarizeIntervention(item = {}, state = {}) {
  const source = getName(state, item.targetCharacterId) || "全局";
  const target = getName(state, item.secondaryCharacterId);
  const pair = target ? `${source} → ${target}` : source;
  const intensity = Number(item.intensity || 50);
  const body = item.instruction || item.payload || "无具体说明";
  return `${interventionTypeLabel(item.type)} · ${pair} · 强度 ${intensity}：${body}`;
}

export function interventionPromptBlock(state = {}) {
  const active = activeInterventionsForState(state);
  if (!active.length) return "无";
  return active.map((item) => summarizeIntervention(item, state)).join("\n");
}

export function applyInterventionsToAgentOutput(output, state = {}) {
  const interventions = interventionsForPair(state, output.characterId, output.targetCharacterId);
  if (!interventions.length) return output;
  const next = { ...output };
  const notes = [];
  for (const intervention of interventions) {
    const instruction = intervention.instruction || intervention.payload || "未写明的操盘意图";
    const label = interventionTypeLabel(intervention.type);
    notes.push(`${label}(${Number(intervention.intensity || 50)})：${instruction}`);
    if (ACTION_TONE[intervention.type]) next.tone = ACTION_TONE[intervention.type];
    if (intervention.type === "lock_motivation") {
      next.hiddenAction = `被操盘手锁定的内在动机牵引：${instruction}；原本的隐藏动作仍在下面抵抗：${output.hiddenAction}`;
      next.desireReason = `操盘手锁定：${instruction}`;
      next.selfDeceptionReason = `${output.selfDeceptionReason || output.defenseAction}；但他/她必须把“${instruction}”伪装成体面理由。`;
    }
    if (intervention.type === "lock_relationship") {
      next.wantsFromOthers = `操盘手锁定关系方向：${instruction}`;
      next.desiredEmotionalResponse = `希望对方按“${instruction}”的方向回应，同时又误读这个回应。`;
    }
    if (intervention.type === "force_misread") {
      next.defenseAction = `${output.defenseAction}；本轮必须把对方行动误读为：${instruction}`;
      next.selfDeceptionSentence = `这不是误读，这是事实：${instruction}`;
      next.possibleHarm = `${output.possibleHarm}；误读会迫使对方为“${instruction}”辩解。`;
    }
    if (intervention.type === "force_action") {
      next.visibleAction = `${output.visibleAction}；但本轮必须做出操盘手指定动作：${instruction}`;
      next.surfaceJustification = `把指定动作解释成必要选择：${instruction}`;
    }
    if (intervention.type === "event_impact") {
      next.shadowAction = `${output.shadowAction}；意外事件冲击后，他/她把“${instruction}”转化为新的阴影动作。`;
      next.possibleEvidenceLeft = `${output.possibleEvidenceLeft}；操盘事件留下二级痕迹：${instruction}`;
    }
    if (intervention.type === "force_silence") {
      next.visibleAction = `${output.visibleAction}；关键处选择沉默，不解释“${instruction}”。`;
      next.hiddenAction = `沉默不是空白，而是把“${instruction}”扣在对方身上。`;
      next.possibleEvidenceLeft = `一次被记录的沉默：${instruction}`;
    }
    if (intervention.type === "force_protect") {
      next.visibleAction = `${output.visibleAction}；同时做出保护动作：${instruction}`;
      next.shadowAction = `保护被污染：${instruction}；其中藏着占有、索取或自我证明。`;
      next.possibleNobleAction = `保护对方，但不允许保护变成净化：${instruction}`;
    }
    if (intervention.type === "force_betray") {
      next.visibleAction = `${output.visibleAction}；在看似合理的动作里埋入陷害/背叛：${instruction}`;
      next.shadowAction = `把伤害伪装成必要：${instruction}`;
      next.unadmittedPleasure = `看见对方被“${instruction}”牵住的一瞬间。`;
    }
    if (intervention.type === "force_confession") {
      next.visibleAction = `${output.visibleAction}；不得不承认某个不能安全解释的事实：${instruction}`;
      next.hiddenAction = `承认本身仍在索取对方反应：${instruction}`;
      next.postActionSelfPunishment = `承认之后又试图撤回或重新命名：${instruction}`;
    }
  }
  next.interventionNotes = [...(output.interventionNotes || []), ...notes];
  next.appliedInterventions = [
    ...(output.appliedInterventions || []),
    ...interventions.map((item) => ({
      id: item.id,
      type: item.type,
      action: item.action || item.type,
      intensity: Number(item.intensity || 50),
      instruction: item.instruction || item.payload || "未写明的操盘意图",
      characterId: item.targetCharacterId || output.characterId,
      targetCharacterId: item.secondaryCharacterId || output.targetCharacterId,
      persistence: item.persistence || "next_play",
    })),
  ];
  return next;
}

export function buildInterventionRelationshipShifts(state = {}, participantIds = []) {
  const shifts = [];
  for (const intervention of activeInterventionsForState(state)) {
    const a = intervention.targetCharacterId;
    const b = intervention.secondaryCharacterId;
    if (!a || !participantIds.includes(a)) continue;
    if (b && !participantIds.includes(b)) continue;
    const scale = Math.max(1, Math.round(Math.max(1, Math.min(100, Number(intervention.intensity || 50))) / 18));
    const base = deltasForType(intervention.type, scale);
    if (b) {
      shifts.push({
        fromCharacterId: a,
        toCharacterId: b,
        deltas: base,
        misreading: `操盘手干预使${getName(state, a)}把${getName(state, b)}推向“${intervention.instruction || interventionTypeLabel(intervention.type)}”。`,
        unspoken: summarizeIntervention(intervention, state),
        interventionId: intervention.id,
      });
      shifts.push({
        fromCharacterId: b,
        toCharacterId: a,
        deltas: reciprocalDeltas(base),
        misreading: `${getName(state, b)}感到对方的动作不像自然发生，而像被某种隐藏压力推了一下。`,
        unspoken: `回应操盘干预：${intervention.instruction || interventionTypeLabel(intervention.type)}`,
        interventionId: intervention.id,
      });
    }
  }
  return shifts;
}

function deltasForType(type, scale) {
  const templates = {
    lock_motivation: { wantsToBeSeen: scale + 2, deception: scale, shame: scale },
    lock_relationship: { dependence: scale + 2, attraction: scale, wantsToPossess: scale },
    force_misread: { deception: scale + 3, resentment: scale + 2, fear: scale },
    force_action: { power: scale + 2, shame: scale, wantsToBeSeen: scale },
    event_impact: { fear: scale + 2, resentment: scale, wantsToEscape: scale },
    force_silence: { deception: scale + 2, resentment: scale + 2, shame: scale },
    force_protect: { protection: scale + 3, dependence: scale, wantsToPossess: scale },
    force_betray: { revenge: scale + 3, resentment: scale + 3, deception: scale + 2 },
    force_confession: { shame: scale + 3, wantsToBeSeen: scale + 2, fear: scale },
  };
  return templates[type] || { deception: scale, wantsToBeSeen: scale };
}

function reciprocalDeltas(deltas) {
  const next = {};
  for (const [key, value] of Object.entries(deltas)) {
    if (["protection", "attraction", "dependence"].includes(key)) next[key] = Math.max(1, Math.ceil(value / 2));
    else next[key] = Math.min(10, value + 1);
  }
  return next;
}

function getName(state, id) {
  return (state.characters || []).find((character) => character.id === id)?.name || id || "";
}

export function interventionReasonNotes(state = {}, draft = {}) {
  const appliedIds = new Set((draft.interventionsApplied || []).map((item) => item.id));
  const active = activeInterventionsForState(state).filter((item) => !appliedIds.size || appliedIds.has(item.id));
  return active.map((item) => ({
    id: `reason_${item.id}`,
    projectId: state.project?.id || "project",
    branchId: draft.branchId || state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main",
    createdAt: new Date().toISOString(),
    kind: "operator_intervention",
    sourceDraftId: draft.id,
    interventionId: item.id,
    reason: `操盘手干预生效：${summarizeIntervention(item, state)}。该干预必须转成可表演行动，并污染人物的高尚、恶意或防御理由。`,
    deltaSummary: `强度 ${Number(item.intensity || 50)}`,
  }));
}
