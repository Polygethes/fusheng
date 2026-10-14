const REL_METRICS = [
  "love", "attraction", "resentment", "fear", "dependence", "power", "shame", "jealousy",
  "protection", "revenge", "deception", "wantsToBeSeen", "wantsToPossess", "wantsToEscape", "wantsToDestroy",
];

export function characterName(state, id) {
  return (state.characters || []).find((character) => character.id === id)?.name || id || "未知人物";
}

export function metricLabel(key) {
  return {
    love: "爱", attraction: "吸引", resentment: "怨恨", fear: "恐惧", dependence: "依赖", power: "权力",
    shame: "羞耻", jealousy: "嫉妒", protection: "保护", revenge: "报复", deception: "欺骗",
    wantsToBeSeen: "被看见", wantsToPossess: "占有", wantsToEscape: "逃离", wantsToDestroy: "毁掉",
    desire: "欲望", rage: "愤怒", selfDeception: "自欺", selfDestruction: "自毁", protectionImpulse: "保护冲动", revengeImpulse: "报复冲动",
  }[key] || key;
}

export function buildRelationshipTimeline(state, fromId, toId) {
  const from = fromId || state.ui?.timelinePairFromId || state.characters?.[0]?.id;
  const to = toId || state.ui?.timelinePairToId || state.characters?.find((item) => item.id !== from)?.id || state.characters?.[0]?.id;
  const events = chronological(state.canonEvents || []);
  const items = [];

  for (const event of events) {
    const draft = findDraft(state, event.sourceDraftId);
    const pairShifts = (event.relationshipShift || []).filter((shift) => isPairShift(shift, from, to));
    const agentOutputs = (event.replay?.agentOutputs || draft?.agentOutputs || []).filter((output) =>
      output.characterId === from || output.characterId === to || output.targetCharacterId === from || output.targetCharacterId === to
    );
    const reasonItems = (state.stateChangeReasons || []).filter((reason) =>
      reason.sourceDraftId === event.sourceDraftId && reason.kind === "relationship_shift" &&
      includesBothNames(reason.relationshipLabel || "", characterName(state, from), characterName(state, to))
    );
    const evidence = (state.evidence || []).filter((item) => item.sourceDraftId === event.sourceDraftId);
    const rumors = (state.rumors || []).filter((item) => item.sourceDraftId === event.sourceDraftId);
    const traces = (state.irreversibleTraces || []).filter((item) => item.sourceDraftId === event.sourceDraftId);

    if (!pairShifts.length && !agentOutputs.length && !reasonItems.length && !evidence.length && !rumors.length && !traces.length) continue;
    items.push({
      id: event.id,
      type: "canon_event",
      at: event.acceptedAt,
      title: event.title || event.summary || "未命名正史",
      locationId: event.locationId,
      participants: event.participantIds || [],
      summary: event.summary || draft?.sceneText || "",
      pairShifts,
      agentOutputs,
      reasons: reasonItems,
      evidence,
      rumors,
      traces,
      sourceDraftId: event.sourceDraftId,
      acceptedParts: event.acceptedParts || {},
      canRewind: Boolean(event.preAcceptSnapshot || event.snapshotBefore),
    });
  }

  return {
    fromId: from,
    toId: to,
    label: `${characterName(state, from)} ↔ ${characterName(state, to)}`,
    current: {
      forward: findRelationship(state, from, to),
      reverse: findRelationship(state, to, from),
    },
    items,
    stats: summarizeTimeline(items),
  };
}

export function buildInnerCourtReplay(state, characterId) {
  const id = characterId || state.ui?.timelineCharacterId || state.ui?.selectedCharacterId || state.characters?.[0]?.id;
  const character = (state.characters || []).find((item) => item.id === id);
  const events = chronological(state.canonEvents || []);
  const items = [];

  for (const event of events) {
    const draft = findDraft(state, event.sourceDraftId);
    const output = (event.replay?.agentOutputs || draft?.agentOutputs || []).find((item) => item.characterId === id);
    const reasons = (state.stateChangeReasons || []).filter((reason) => reason.sourceDraftId === event.sourceDraftId && reason.characterId === id);
    if (!output && !reasons.length) continue;
    const targetName = characterName(state, output?.targetCharacterId);
    items.push({
      id: `${event.id}_${id}`,
      canonEventId: event.id,
      at: event.acceptedAt,
      title: event.title || event.summary || "未命名正史",
      surfaceEvent: event.replay?.surfaceEvent || draft?.surfaceEvent || event.title || "未命名事件",
      targetName,
      tone: output?.tone || reasons[0]?.tone || "状态",
      visibleAction: output?.visibleAction || "未记录显性动作。",
      hiddenAction: output?.hiddenAction || "未记录隐藏动作。",
      defenseAction: output?.defenseAction || "未记录防御动作。",
      shadowAction: output?.shadowAction || "未记录阴影动作。",
      surfaceJustification: output?.surfaceJustification || output?.defenseAction || "未记录表层理由。",
      desireReason: output?.desireReason || output?.hiddenAction || "未记录欲望理由。",
      shameReason: output?.shameReason || "羞耻未被模型单独命名。",
      powerReason: output?.powerReason || "权力理由未被模型单独命名。",
      selfDeceptionReason: output?.selfDeceptionReason || output?.selfDeceptionSentence || "未记录自欺理由。",
      unadmittedPleasure: output?.unadmittedPleasure || output?.desiredEmotionalResponse || "未记录不愿承认的快感。",
      postActionSelfPunishment: output?.postActionSelfPunishment || "未记录事后自我惩罚。",
      wantsFromOthers: output?.wantsFromOthers || "未记录索取。",
      reasons,
      canRewind: Boolean(event.preAcceptSnapshot || event.snapshotBefore),
    });
  }

  return {
    characterId: id,
    characterName: character?.name || id || "未知人物",
    innerCourt: character?.innerCourt || {},
    selfMyth: character?.internalSituation?.selfMyth || character?.selfMyth?.believesSelfToBe || "未记录自我神话。",
    currentState: character?.currentState || {},
    items,
    stats: summarizeCourt(items),
  };
}

export function buildUndoPreview(state, canonEventId) {
  const event = (state.canonEvents || []).find((item) => item.id === canonEventId);
  if (!event) return null;
  const before = event.preAcceptSnapshot || event.snapshotBefore;
  const after = event.postAcceptSnapshot || event.snapshotAfter;
  return {
    id: event.id,
    title: event.title || event.summary || event.id,
    canRewind: Boolean(before),
    removedCanonCount: before ? Math.max(0, (state.canonEvents || []).length - ((before.canonEvents || []).length)) : 1,
    characterDeltaCount: before && after ? countChangedCharacters(before.characters || [], after.characters || []) : 0,
    relationshipDeltaCount: before && after ? countChangedRelationships(before.relationships || [], after.relationships || []) : 0,
  };
}

function chronological(items) {
  return [...items].sort((a, b) => String(a.acceptedAt || a.createdAt || "").localeCompare(String(b.acceptedAt || b.createdAt || "")));
}
function findDraft(state, draftId) { return (state.draftScenes || []).find((draft) => draft.id === draftId); }
function findRelationship(state, fromId, toId) { return (state.relationships || []).find((rel) => rel.fromCharacterId === fromId && rel.toCharacterId === toId) || null; }
function isPairShift(shift, fromId, toId) { return (shift.fromCharacterId === fromId && shift.toCharacterId === toId) || (shift.fromCharacterId === toId && shift.toCharacterId === fromId); }
function includesBothNames(text, a, b) { return text.includes(a) && text.includes(b); }
function summarizeTimeline(items) {
  return {
    eventCount: items.length,
    evidenceCount: items.reduce((sum, item) => sum + item.evidence.length, 0),
    rumorCount: items.reduce((sum, item) => sum + item.rumors.length, 0),
    traceCount: items.reduce((sum, item) => sum + item.traces.length, 0),
    shiftCount: items.reduce((sum, item) => sum + item.pairShifts.length, 0),
  };
}
function summarizeCourt(items) {
  return {
    actionCount: items.length,
    punitiveCount: items.filter((item) => /惩罚|陷害|背叛|自毁/.test(item.tone)).length,
    approachCount: items.filter((item) => /接近|保护|共谋|求证/.test(item.tone)).length,
    rewindableCount: items.filter((item) => item.canRewind).length,
  };
}
function countChangedCharacters(a, b) {
  const bMap = new Map(b.map((item) => [item.id, item]));
  return a.filter((item) => JSON.stringify(item.currentState || {}) !== JSON.stringify(bMap.get(item.id)?.currentState || {})).length;
}
function countChangedRelationships(a, b) {
  const bMap = new Map(b.map((item) => [`${item.fromCharacterId}->${item.toCharacterId}`, item]));
  return a.filter((item) => {
    const other = bMap.get(`${item.fromCharacterId}->${item.toCharacterId}`);
    if (!other) return true;
    return REL_METRICS.some((key) => Number(item[key] || 0) !== Number(other[key] || 0));
  }).length;
}
