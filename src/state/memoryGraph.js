export const memoryTypeOptions = [
  ["accurate", "准确记忆"],
  ["selective", "选择性记忆"],
  ["misremembered", "误记"],
  ["suppressed", "压抑"],
  ["fabricated", "篡改"],
  ["weaponized", "武器化记忆"],
];

export const memoryStanceOptions = [
  ["self_defense", "自辩"],
  ["self_accusation", "自控"],
  ["desire", "欲望"],
  ["revenge", "报复"],
  ["protection", "保护"],
  ["confusion", "混乱"],
];

// v0.8 compatibility labels for the newer accuracy/visibility vocabulary.
export const memoryAccuracyOptions = [
  ["accurate", "相对准确"],
  ["selective", "选择性记忆"],
  ["distorted", "扭曲记忆"],
  ["invented", "伪造/想象"],
  ["suppressed", "被压抑"],
];
export const memoryVisibilityOptions = [
  ["private", "私人"],
  ["shared", "共享"],
  ["rumor", "谣言化"],
  ["evidence", "证据化"],
];

export function memoryTypeLabel(type) {
  return Object.fromEntries(memoryTypeOptions)[type] || Object.fromEntries(memoryAccuracyOptions)[type] || type || "记忆";
}

export function memoryStanceLabel(stance) {
  return Object.fromEntries(memoryStanceOptions)[stance] || stance || "立场";
}

export function memoryAccuracyLabel(value) {
  return Object.fromEntries(memoryAccuracyOptions)[value] || memoryTypeLabel(value);
}

export function memoryVisibilityLabel(value) {
  return Object.fromEntries(memoryVisibilityOptions)[value] || value || "私人";
}

export function memoryReliabilityLabel(value) {
  const score = Number(value || 0);
  if (score >= 80) return "高可信";
  if (score >= 55) return "部分可信";
  if (score >= 30) return "不稳定";
  return "危险记忆";
}

export function normalizeMemory(memory = {}) {
  const type = memory.type || accuracyToType(memory.accuracy);
  const stance = memory.stance || inferStance(memory);
  const reliability = Number(memory.reliability ?? reliabilityFromModern(memory));
  const heat = Number(memory.heat ?? memory.emotionalCharge ?? 50);
  const content = memory.content || memory.text || memory.privateVersion || "未命名记忆";
  return {
    ...memory,
    type,
    stance,
    content,
    publicVersion: memory.publicVersion || (memory.visibility ? `可见性：${memoryVisibilityLabel(memory.visibility)}` : ""),
    privateVersion: memory.privateVersion || memory.text || "",
    distortion: memory.distortion || buildModernDistortion(memory),
    reliability: clamp(reliability, 0, 100),
    heat: clamp(heat, 0, 100),
  };
}

export function getCharacterMemories(state, characterId) {
  return (state.characterMemories || [])
    .filter((memory) => !characterId || memory.characterId === characterId)
    .map(normalizeMemory)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
}

export function summarizeMemory(memory, state = {}) {
  const normalized = normalizeMemory(memory);
  const character = lookupName(state, normalized.characterId);
  const target = lookupName(state, normalized.targetCharacterId);
  const targetPart = normalized.targetCharacterId ? ` → ${target}` : "";
  return `${character}${targetPart} · ${memoryTypeLabel(normalized.type)}/${memoryStanceLabel(normalized.stance)} · ${normalized.content || normalized.privateVersion || "未命名记忆"}`;
}

export function buildMemoryConflictSummary(state, characterId) {
  const memories = getCharacterMemories(state, characterId);
  const distorted = memories.filter((memory) => ["misremembered", "suppressed", "fabricated", "weaponized"].includes(memory.type));
  const protective = memories.filter((memory) => memory.stance === "protection");
  const revenge = memories.filter((memory) => memory.stance === "revenge");
  const desire = memories.filter((memory) => memory.stance === "desire");
  return {
    total: memories.length,
    distorted: distorted.length,
    protective: protective.length,
    revenge: revenge.length,
    desire: desire.length,
    mostUnreliable: memories.slice().sort((a, b) => Number(a.reliability || 0) - Number(b.reliability || 0))[0] || null,
  };
}

export function buildMemoryTimeline(state, characterId) {
  return getCharacterMemories(state, characterId).map((memory) => ({
    ...memory,
    text: memory.content || memory.privateVersion,
    accuracy: typeToAccuracy(memory.type),
    visibility: memory.visibility || (memory.type === "weaponized" ? "evidence" : "private"),
    emotionalCharge: memory.heat,
    desireBias: memory.desireBias ?? (memory.stance === "desire" ? 75 : 45),
    shameBias: memory.shameBias ?? (["self_accusation", "self_defense"].includes(memory.stance) ? 70 : 40),
    risk: memoryRisk(memory),
    tone: memoryTone(memory),
    characterName: lookupName(state, memory.characterId),
    targetName: memory.targetCharacterId ? lookupName(state, memory.targetCharacterId) : "",
    sourceLabel: describeMemorySource(state, memory),
  }));
}

export function memoryRisk(memoryInput) {
  const memory = normalizeMemory(memoryInput);
  const unreliability = 100 - Number(memory.reliability || 50);
  const heat = Number(memory.heat || memory.emotionalCharge || 0);
  const typeRisk = { accurate: 4, selective: 18, misremembered: 32, suppressed: 38, fabricated: 48, weaponized: 52 }[memory.type] || 20;
  const stanceRisk = { revenge: 30, desire: 18, protection: 14, self_defense: 18, self_accusation: 24, confusion: 16 }[memory.stance] || 12;
  return clamp((unreliability * 0.45) + (heat * 0.35) + typeRisk + stanceRisk, 0, 100);
}

export function memoryTone(memoryInput) {
  const memory = normalizeMemory(memoryInput);
  if (memory.type === "suppressed") return "压抑";
  if (memory.type === "fabricated") return "篡改";
  if (memory.type === "weaponized") return "武器化";
  if (memory.stance === "desire") return "欲望";
  if (memory.stance === "revenge") return "报复";
  if (memory.stance === "protection") return "保护";
  return "暧昧";
}

export function buildEvidenceGraph(state, options = {}) {
  const focusCharacterId = options.focusCharacterId || state.ui?.graphFocusCharacterId || state.ui?.memoryCharacterId || null;
  const nodes = [];
  const edges = [];
  const addNode = (id, type, label, meta = {}) => {
    if (!id || nodes.some((node) => node.id === id)) return;
    nodes.push({ id, type, label: label || id, ...meta });
  };
  const addEdge = (from, to, type, label, meta = {}) => {
    if (!from || !to) return;
    edges.push({ id: `${from}->${to}:${type}:${edges.length}`, from, to, type, label: label || type, ...meta });
  };
  const canonByDraftId = new Map((state.canonEvents || []).filter((event) => event.sourceDraftId).map((event) => [event.sourceDraftId, event]));
  const ensureDraftOrCanon = (draftId) => {
    if (!draftId) return null;
    const canon = canonByDraftId.get(draftId);
    if (canon) return canon.id;
    addNode(draftId, "draft", "未入正史草稿", { subtitle: draftId, rawId: draftId });
    return draftId;
  };

  for (const character of state.characters || []) {
    if (focusCharacterId && character.id !== focusCharacterId && !hasRelationshipOrMemory(state, focusCharacterId, character.id)) continue;
    addNode(character.id, "character", character.name, { subtitle: character.publicIdentity, rawId: character.id, heat: Number(character.currentState?.selfDeception || 0) });
  }

  for (const event of state.canonEvents || []) {
    addNode(event.id, "canon", event.title || event.surfaceEvent || "正史事件", { subtitle: event.summary || event.acceptedAt || "", rawId: event.id });
    for (const characterId of event.participantIds || []) addEdge(event.id, characterId, "involves", "牵连人物");
  }

  for (const evidence of state.evidence || []) {
    addNode(evidence.id, "evidence", evidence.content || evidence.type || "证据", { subtitle: evidence.canBeMisreadAs || evidence.type || "", rawId: evidence.id });
    if (evidence.ownerCharacterId) addEdge(evidence.id, evidence.ownerCharacterId, "owned_by", "持有/制造");
    if (evidence.sourceDraftId) addEdge(evidence.id, ensureDraftOrCanon(evidence.sourceDraftId), canonByDraftId.has(evidence.sourceDraftId) ? "points_to" : "from_draft", canonByDraftId.has(evidence.sourceDraftId) ? "指向正史" : "来自草稿");
  }

  for (const rumor of state.rumors || []) {
    addNode(rumor.id, "rumor", rumor.content || "谣言", { subtitle: rumor.distortion || "", rawId: rumor.id });
    if (rumor.sourceDraftId) addEdge(rumor.id, ensureDraftOrCanon(rumor.sourceDraftId), canonByDraftId.has(rumor.sourceDraftId) ? "distorts" : "from_scene", canonByDraftId.has(rumor.sourceDraftId) ? "扭曲正史" : "源自场景");
  }

  for (const trace of state.irreversibleTraces || []) {
    addNode(trace.id, "trace", trace.content || "不可逆痕迹", { subtitle: trace.createdAt || "", rawId: trace.id });
    for (const characterId of trace.participantIds || []) addEdge(trace.id, characterId, "marks", "标记人物");
  }

  for (const rawMemory of state.characterMemories || []) {
    const memory = normalizeMemory(rawMemory);
    addNode(memory.id, "memory", memory.content || memory.privateVersion || "记忆", { subtitle: `${memoryTypeLabel(memory.type)} / ${memoryStanceLabel(memory.stance)}`, rawId: memory.id, heat: memoryRisk(memory) });
    addEdge(memory.id, memory.characterId, "remembered_by", "被谁记住");
    if (memory.targetCharacterId) addEdge(memory.id, memory.targetCharacterId, "about", "关于谁");
    if (memory.sourceCanonEventId) addEdge(memory.id, memory.sourceCanonEventId, "from_canon", "来自正史");
    if (memory.sourceDraftId) addEdge(memory.id, ensureDraftOrCanon(memory.sourceDraftId), canonByDraftId.has(memory.sourceDraftId) ? "remembers_event" : "from_draft", canonByDraftId.has(memory.sourceDraftId) ? "记忆来源" : "来自草稿");
    if (memory.sourceEvidenceId) addEdge(memory.id, memory.sourceEvidenceId, "from_evidence", "来自证据");
    if (memory.sourceRumorId) addEdge(memory.id, memory.sourceRumorId, "from_rumor", "来自谣言");
    if (memory.sourceId) addEdge(memory.id, memory.sourceId, sourceLabel(memory.sourceType), sourceLabel(memory.sourceType));
  }

  for (const link of state.evidenceLinks || []) addEdge(link.fromId, link.toId, "operator_link", link.label || "操盘链接", { risk: link.risk });

  const filteredEdges = edges.filter((edge) => !focusCharacterId || edge.from === focusCharacterId || edge.to === focusCharacterId || edgeConnectsFocus(edges, edge, focusCharacterId));
  const visibleNodeIds = new Set(filteredEdges.flatMap((edge) => [edge.from, edge.to]));
  if (focusCharacterId) visibleNodeIds.add(focusCharacterId);
  const visibleNodes = focusCharacterId ? nodes.filter((node) => visibleNodeIds.has(node.id)) : nodes;
  const graphEdges = focusCharacterId ? filteredEdges : edges;
  return {
    nodes: visibleNodes,
    edges: graphEdges,
    links: graphEdges,
    stats: {
      characters: visibleNodes.filter((node) => node.type === "character").length,
      canon: visibleNodes.filter((node) => node.type === "canon").length,
      evidence: visibleNodes.filter((node) => node.type === "evidence").length,
      rumors: visibleNodes.filter((node) => node.type === "rumor").length,
      memories: visibleNodes.filter((node) => node.type === "memory").length,
      traces: visibleNodes.filter((node) => node.type === "trace").length,
      edges: graphEdges.length,
      nodeCount: visibleNodes.length,
      linkCount: graphEdges.length,
      highRisk: visibleNodes.filter((node) => Number(node.heat || 0) >= 70).length,
    },
  };
}

export function describeSource(state, sourceType, sourceId) {
  if (!sourceId) return "无来源";
  const label = sourceLabel(sourceType);
  const item = findSourceItem(state, sourceType, sourceId);
  return `${label}：${item?.title || item?.surfaceEvent || item?.content || item?.summary || sourceId}`;
}

function describeMemorySource(state, memory) {
  if (memory.sourceCanonEventId) return describeSource(state, "canon", memory.sourceCanonEventId);
  if (memory.sourceDraftId) return describeSource(state, "draft", memory.sourceDraftId);
  if (memory.sourceEvidenceId) return describeSource(state, "evidence", memory.sourceEvidenceId);
  if (memory.sourceRumorId) return describeSource(state, "rumor", memory.sourceRumorId);
  return describeSource(state, memory.sourceType, memory.sourceId);
}

function findSourceItem(state, sourceType, sourceId) {
  const map = { canon: state.canonEvents, draft: state.draftScenes, evidence: state.evidence, rumor: state.rumors, secret: state.secrets };
  return (map[sourceType] || []).find((item) => item.id === sourceId);
}

function sourceLabel(sourceType) {
  const labels = { canon: "正史", draft: "草稿", evidence: "证据", rumor: "谣言", secret: "秘密", manual: "手动" };
  return labels[sourceType] || sourceType || "来源";
}

function hasRelationshipOrMemory(state, focusId, otherId) {
  return (state.relationships || []).some((rel) => (rel.fromCharacterId === focusId && rel.toCharacterId === otherId) || (rel.fromCharacterId === otherId && rel.toCharacterId === focusId))
    || (state.characterMemories || []).some((memory) => (memory.characterId === focusId && memory.targetCharacterId === otherId) || (memory.characterId === otherId && memory.targetCharacterId === focusId));
}

function edgeConnectsFocus(edges, edge, focusId) {
  return edges.some((candidate) => (candidate.from === focusId && (candidate.to === edge.from || candidate.to === edge.to)) || (candidate.to === focusId && (candidate.from === edge.from || candidate.from === edge.to)));
}

function accuracyToType(accuracy) {
  return { accurate: "accurate", selective: "selective", distorted: "misremembered", invented: "fabricated", suppressed: "suppressed" }[accuracy] || "selective";
}
function typeToAccuracy(type) {
  return { accurate: "accurate", selective: "selective", misremembered: "distorted", fabricated: "invented", weaponized: "distorted", suppressed: "suppressed" }[type] || "selective";
}
function inferStance(memory) {
  if (Number(memory.desireBias || 0) > Number(memory.shameBias || 0) + 12) return "desire";
  if (Number(memory.shameBias || 0) > Number(memory.desireBias || 0) + 12) return "self_accusation";
  return "confusion";
}
function reliabilityFromModern(memory) {
  return Number(memory.reliability ?? (memory.accuracy === "accurate" ? 75 : memory.accuracy === "selective" ? 58 : 42));
}
function buildModernDistortion(memory) {
  if (!memory.accuracy && !memory.visibility) return "";
  return `这段记忆以“${memoryAccuracyLabel(memory.accuracy)} / ${memoryVisibilityLabel(memory.visibility)}”形式影响人物。`;
}
function lookupName(state, id) {
  return (state.characters || []).find((character) => character.id === id)?.name || id || "未知";
}
function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}
