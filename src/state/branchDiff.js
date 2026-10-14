const COLLECTIONS = [
  ["characters", "人物"],
  ["relationships", "关系"],
  ["canonEvents", "正史"],
  ["draftScenes", "草稿"],
  ["rumors", "谣言"],
  ["evidence", "证据"],
  ["secrets", "秘密"],
  ["irreversibleTraces", "不可逆痕迹"],
  ["characterPlans", "角色计划"],
  ["interventions", "操盘干预"],
  ["stateChangeReasons", "状态理由"],
];

const CHARACTER_METRICS = [
  "desire",
  "shame",
  "rage",
  "love",
  "disgust",
  "selfDeception",
  "selfDestruction",
  "protectionImpulse",
  "revengeImpulse",
];

const RELATIONSHIP_METRICS = [
  "love",
  "attraction",
  "resentment",
  "fear",
  "dependence",
  "power",
  "shame",
  "jealousy",
  "protection",
  "revenge",
  "deception",
  "wantsToBeSeen",
  "wantsToPossess",
  "wantsToEscape",
  "wantsToDestroy",
];

function deepClone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function getBranchById(state, branchId) {
  return (state.branches || []).find((branch) => branch.id === branchId) || null;
}

export function getActiveBranchId(state) {
  return state.ui?.activeBranchId || state.project?.activeBranchId || state.branches?.[0]?.id || "branch_main";
}

export function getSnapshotForBranch(state, branchId) {
  const activeBranchId = getActiveBranchId(state);
  if (!branchId || branchId === activeBranchId) {
    return createSnapshotFromState(state);
  }
  const branch = getBranchById(state, branchId);
  if (!branch?.snapshot) return emptySnapshot();
  return normalizeSnapshot(branch.snapshot);
}

export function createSnapshotFromState(state) {
  return normalizeSnapshot({
    characters: state.characters,
    relationships: state.relationships,
    canonEvents: state.canonEvents,
    draftScenes: state.draftScenes,
    rumors: state.rumors,
    evidence: state.evidence,
    secrets: state.secrets,
    irreversibleTraces: state.irreversibleTraces,
    characterPlans: state.characterPlans,
    interventions: state.interventions,
    stateChangeReasons: state.stateChangeReasons,
  });
}

function emptySnapshot() {
  return normalizeSnapshot({});
}

function normalizeSnapshot(snapshot = {}) {
  const normalized = {};
  for (const [key] of COLLECTIONS) {
    normalized[key] = deepClone(Array.isArray(snapshot[key]) ? snapshot[key] : []);
  }
  return normalized;
}

function byId(items = []) {
  return new Map((items || []).filter(Boolean).map((item) => [String(item.id), item]));
}

function relationshipKey(rel) {
  return `${rel.fromCharacterId || "?"}->${rel.toCharacterId || "?"}`;
}

function byRelationship(items = []) {
  return new Map((items || []).filter(Boolean).map((item) => [relationshipKey(item), item]));
}

function getName(snapshot, id) {
  return (snapshot.characters || []).find((character) => character.id === id)?.name || id || "未知人物";
}

function numberDelta(baseValue, compareValue) {
  const before = Number(baseValue || 0);
  const after = Number(compareValue || 0);
  return {
    before,
    after,
    delta: after - before,
    abs: Math.abs(after - before),
  };
}

function summarizeCollection(baseItems = [], compareItems = []) {
  const base = byId(baseItems);
  const compare = byId(compareItems);
  const added = [];
  const removed = [];
  const retained = [];
  for (const [id, item] of compare) {
    if (!base.has(id)) added.push(item);
    else retained.push(item);
  }
  for (const [id, item] of base) {
    if (!compare.has(id)) removed.push(item);
  }
  return { added, removed, retained };
}

function collectionLabel(key) {
  return COLLECTIONS.find(([id]) => id === key)?.[1] || key;
}

function titleOf(item) {
  return item?.title || item?.name || item?.content || item?.summary || item?.surfaceEvent || item?.id || "未命名";
}

function compareCharacters(baseSnapshot, compareSnapshot) {
  const base = byId(baseSnapshot.characters);
  const compare = byId(compareSnapshot.characters);
  const ids = new Set([...base.keys(), ...compare.keys()]);
  const changes = [];

  for (const id of ids) {
    const before = base.get(id);
    const after = compare.get(id);
    if (!before && after) {
      changes.push({ id, name: after.name || id, type: "added", score: 100, metrics: [], note: "比较分支新增人物。" });
      continue;
    }
    if (before && !after) {
      changes.push({ id, name: before.name || id, type: "removed", score: 100, metrics: [], note: "比较分支移除人物。" });
      continue;
    }
    const metrics = CHARACTER_METRICS
      .map((key) => ({ key, ...numberDelta(before.currentState?.[key], after.currentState?.[key]) }))
      .filter((item) => item.delta !== 0)
      .sort((a, b) => b.abs - a.abs);
    const notes = [];
    if ((before.currentState?.currentSelfLie || "") !== (after.currentState?.currentSelfLie || "")) {
      notes.push(`自欺句：${before.currentState?.currentSelfLie || "无"} → ${after.currentState?.currentSelfLie || "无"}`);
    }
    if ((before.actionLines?.shadow || "") !== (after.actionLines?.shadow || "")) {
      notes.push("阴影行动线发生文本变化。");
    }
    if (metrics.length || notes.length) {
      changes.push({
        id,
        name: after.name || before.name || id,
        type: "changed",
        score: metrics.reduce((sum, item) => sum + item.abs, 0) + notes.length * 8,
        metrics,
        note: notes.join("；"),
      });
    }
  }

  return changes.sort((a, b) => b.score - a.score);
}

function compareRelationships(baseSnapshot, compareSnapshot) {
  const base = byRelationship(baseSnapshot.relationships);
  const compare = byRelationship(compareSnapshot.relationships);
  const ids = new Set([...base.keys(), ...compare.keys()]);
  const changes = [];

  for (const key of ids) {
    const before = base.get(key);
    const after = compare.get(key);
    if (!before && after) {
      changes.push({ key, type: "added", title: formatRel(compareSnapshot, after), score: 100, metrics: [], note: "比较分支新增关系。" });
      continue;
    }
    if (before && !after) {
      changes.push({ key, type: "removed", title: formatRel(baseSnapshot, before), score: 100, metrics: [], note: "比较分支移除关系。" });
      continue;
    }
    const metrics = RELATIONSHIP_METRICS
      .map((metricKey) => ({ key: metricKey, ...numberDelta(before[metricKey], after[metricKey]) }))
      .filter((item) => item.delta !== 0)
      .sort((a, b) => b.abs - a.abs);
    const notes = [];
    if ((before.misreading || "") !== (after.misreading || "")) {
      notes.push(`误读：${before.misreading || "无"} → ${after.misreading || "无"}`);
    }
    if ((before.unspoken || "") !== (after.unspoken || "")) {
      notes.push(`未说出口：${before.unspoken || "无"} → ${after.unspoken || "无"}`);
    }
    if (metrics.length || notes.length) {
      changes.push({
        key,
        type: "changed",
        title: formatRel(compareSnapshot, after),
        score: metrics.reduce((sum, item) => sum + item.abs, 0) + notes.length * 10,
        metrics,
        note: notes.join("；"),
      });
    }
  }
  return changes.sort((a, b) => b.score - a.score);
}

function formatRel(snapshot, rel) {
  return `${getName(snapshot, rel.fromCharacterId)} → ${getName(snapshot, rel.toCharacterId)}`;
}

function compareList(baseItems, compareItems, label) {
  const summary = summarizeCollection(baseItems, compareItems);
  return {
    label,
    added: summary.added.map((item) => ({ id: item.id, title: titleOf(item), item })),
    removed: summary.removed.map((item) => ({ id: item.id, title: titleOf(item), item })),
    retainedCount: summary.retained.length,
  };
}

function computeStats(baseSnapshot, compareSnapshot) {
  return COLLECTIONS.map(([key, label]) => {
    const baseCount = (baseSnapshot[key] || []).length;
    const compareCount = (compareSnapshot[key] || []).length;
    return {
      key,
      label,
      baseCount,
      compareCount,
      delta: compareCount - baseCount,
    };
  });
}

function strongestCharacterShift(characterDiffs) {
  const changed = characterDiffs.find((item) => item.type === "changed" && item.metrics.length);
  if (!changed) return null;
  const metric = changed.metrics[0];
  return `${changed.name} 的 ${metricLabel(metric.key)} ${metric.delta > 0 ? "+" : ""}${metric.delta}`;
}

function strongestRelationshipShift(relationshipDiffs) {
  const changed = relationshipDiffs.find((item) => item.type === "changed" && item.metrics.length);
  if (!changed) return null;
  const metric = changed.metrics[0];
  return `${changed.title} 的 ${metricLabel(metric.key)} ${metric.delta > 0 ? "+" : ""}${metric.delta}`;
}

export function computeBranchDiff(state, baseBranchId, compareBranchId) {
  const activeBranchId = getActiveBranchId(state);
  const baseId = baseBranchId || activeBranchId;
  const compareId = compareBranchId || (state.branches || []).find((branch) => branch.id !== baseId)?.id || baseId;
  const baseBranch = getBranchById(state, baseId);
  const compareBranch = getBranchById(state, compareId);
  const baseSnapshot = getSnapshotForBranch(state, baseId);
  const compareSnapshot = getSnapshotForBranch(state, compareId);
  const stats = computeStats(baseSnapshot, compareSnapshot);
  const characterDiffs = compareCharacters(baseSnapshot, compareSnapshot);
  const relationshipDiffs = compareRelationships(baseSnapshot, compareSnapshot);
  const listDiffs = {
    canonEvents: compareList(baseSnapshot.canonEvents, compareSnapshot.canonEvents, "正史"),
    evidence: compareList(baseSnapshot.evidence, compareSnapshot.evidence, "证据"),
    rumors: compareList(baseSnapshot.rumors, compareSnapshot.rumors, "谣言"),
    secrets: compareList(baseSnapshot.secrets, compareSnapshot.secrets, "秘密"),
    irreversibleTraces: compareList(baseSnapshot.irreversibleTraces, compareSnapshot.irreversibleTraces, "不可逆痕迹"),
    interventions: compareList(baseSnapshot.interventions, compareSnapshot.interventions, "操盘干预"),
    stateChangeReasons: compareList(baseSnapshot.stateChangeReasons, compareSnapshot.stateChangeReasons, "状态理由"),
  };
  const summaryBullets = [
    strongestCharacterShift(characterDiffs),
    strongestRelationshipShift(relationshipDiffs),
    listDiffs.canonEvents.added.length ? `比较分支新增 ${listDiffs.canonEvents.added.length} 条正史。` : null,
    listDiffs.irreversibleTraces.added.length ? `比较分支新增 ${listDiffs.irreversibleTraces.added.length} 条不可逆痕迹。` : null,
    listDiffs.evidence.added.length ? `比较分支新增 ${listDiffs.evidence.added.length} 条证据。` : null,
    listDiffs.interventions?.added.length ? `比较分支新增 ${listDiffs.interventions.added.length} 条操盘干预。` : null,
    listDiffs.stateChangeReasons?.added.length ? `比较分支新增 ${listDiffs.stateChangeReasons.added.length} 条状态变化理由。` : null,
  ].filter(Boolean);

  return {
    base: { id: baseId, title: baseBranch?.title || baseId, snapshot: baseSnapshot },
    compare: { id: compareId, title: compareBranch?.title || compareId, snapshot: compareSnapshot },
    stats,
    characterDiffs,
    relationshipDiffs,
    listDiffs,
    summaryBullets,
    changedCharacterCount: characterDiffs.length,
    changedRelationshipCount: relationshipDiffs.length,
    totalAddedCanon: listDiffs.canonEvents.added.length,
    totalAddedEvidence: listDiffs.evidence.added.length,
    totalAddedRumors: listDiffs.rumors.added.length,
    totalAddedTraces: listDiffs.irreversibleTraces.added.length,
    totalAddedInterventions: listDiffs.interventions?.added.length || 0,
    totalAddedStateReasons: listDiffs.stateChangeReasons?.added.length || 0,
  };
}

export function metricLabel(key) {
  const labels = {
    desire: "欲望",
    shame: "羞耻",
    rage: "愤怒",
    love: "爱",
    disgust: "厌恶",
    selfDeception: "自欺",
    selfDestruction: "自毁",
    protectionImpulse: "保护冲动",
    revengeImpulse: "报复冲动",
    attraction: "吸引",
    resentment: "怨恨",
    fear: "恐惧",
    dependence: "依赖",
    power: "权力",
    jealousy: "嫉妒",
    protection: "保护",
    revenge: "报复",
    deception: "欺骗",
    wantsToBeSeen: "被看见",
    wantsToPossess: "占有",
    wantsToEscape: "逃离",
    wantsToDestroy: "毁掉",
  };
  return labels[key] || collectionLabel(key) || key;
}
