import { createId } from "../data/seed.js";
import { auditDraft } from "./depthAuditor.js";
import { buildUpdateBundle } from "./stateUpdater.js";
import { activeInterventionsForState, applyInterventionsToAgentOutput, buildInterventionRelationshipShifts, summarizeIntervention } from "../state/interventions.js";
import { ensureCharacterPlans, getCharacterPlan, summarizePlan } from "../state/intentPlanner.js";
import { buildRelationshipArcFromShift, relationshipArcSummary } from "../state/relationshipArc.js";
import { buildSimulationTick, runSceneInteractionSimulation, enrichAgentOutputWithPrivateSimulation } from "../state/simulationLoop.js";
import { buildAgentDialogueExchange, buildCharacterDialogueDecision } from "./dialogueProtocol.js";
import { buildAgentCognitiveFrame } from "./cognitiveLoop.js";
import { isTavernLifeState, playTavernLifeNext } from "./tavernLifeEngine.js";

function pick(list, fallback = "") {
  if (!Array.isArray(list) || !list.length) return fallback;
  return list[Math.floor(nextDeterministicRandom() * list.length)];
}

// Deterministic randomness for the local engine.  A seeded PRNG keeps every
// contract reproducible (same state sequence, same rolls) while still varying
// between picks inside one draft.  When a test pins Math.random itself, honour
// the override instead — those tests select a specific variant on purpose.
let randomSeedState = 1;
let randomFallbackToNative = false;

function seedDeterministicRandom(seed = "") {
  randomFallbackToNative = !/\[native code\]/.test(String(Math.random));
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  randomSeedState = hash >>> 0 || 1;
}

function nextDeterministicRandom() {
  if (randomFallbackToNative) return Math.random();
  randomSeedState = (randomSeedState + 0x6D2B79F5) >>> 0;
  let t = randomSeedState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function stableVariantIndex(key = "", length = 1) {
  const size = Math.max(Number(length) || 1, 1);
  let hash = 0;
  for (const char of String(key || "")) {
    hash = (hash * 31 + char.codePointAt(0)) % 9973;
  }
  return hash % size;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function deepClone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function sanitizeObservationLine(text = "") {
  return String(text || "")
    .replace(/低精度运行|低精度|后台运行|后台|完整场景|聚焦场景|未被观察的位置|被观察的位置/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStateForMock(input = {}) {
  const fallbackCharacters = [
    {
      id: "char_virtual_a",
      name: "未命名人物A",
      currentState: { desire: 50, shame: 50, rage: 35, selfDeception: 60, revengeImpulse: 30, protectionImpulse: 35, currentSelfLie: "我只是按眼前情况行动。" },
      actionLines: { visible: "维持可被解释的身份", desire: "确认自己仍被看见", defense: "把欲望改名为合理行动" },
      actionVerbs: { visible: ["说明"], hidden: ["确认"] },
      defenseLanguage: ["我只是按原则行事。"],
      shadowActions: ["用体面理由索取回应"],
      nobleActions: ["停止把别人变成自己的证明。"],
      innerCourt: { wants: "being_seen" },
      internalSituation: { repeatedSelfLie: "我没有别的意思。" },
    },
    {
      id: "char_virtual_b",
      name: "未命名人物B",
      currentState: { desire: 42, shame: 45, rage: 40, selfDeception: 52, revengeImpulse: 32, protectionImpulse: 38, currentSelfLie: "我只是要求一个说法。" },
      actionLines: { visible: "要求局面被说清", desire: "确认对方是否把自己特殊化", defense: "把试探改名为公正" },
      actionVerbs: { visible: ["追问"], hidden: ["试探"] },
      defenseLanguage: ["我只是想知道标准。"],
      shadowActions: ["把沉默逼成证词"],
      nobleActions: ["把事实从私人戏剧里拿出来。"],
      innerCourt: { wants: "truth" },
      internalSituation: { repeatedSelfLie: "我只是要公平。" },
    },
  ];
  const characters = Array.isArray(input.characters) && input.characters.length ? input.characters : fallbackCharacters;
  const locations = Array.isArray(input.locations) && input.locations.length ? input.locations : [{
    id: "loc_virtual",
    name: "未命名场所",
    subtext: "场所尚未定义，但人物仍会把缺失解释成压力。",
    powerRule: "空白场所会放大人物的自我解释。",
    likelyEvents: ["一次无法被单义解释的停顿"],
  }];
  const project = { id: "project_virtual", activeBranchId: "branch_main", ...(input.project || {}) };
  const ui = {
    activeBranchId: project.activeBranchId || "branch_main",
    activeCharacterIds: characters.slice(0, 2).map((character) => character.id),
    selectedLocationId: locations[0]?.id || "loc_virtual",
    timeGrain: "scene",
    focusMode: "ambient",
    userDirective: "",
    injectedEvent: "",
    eventImpact: 0,
    ...(input.ui || {}),
  };
  if (!Array.isArray(ui.activeCharacterIds) || !ui.activeCharacterIds.length) ui.activeCharacterIds = characters.slice(0, 2).map((character) => character.id);
  return {
    ...input,
    project,
    ui,
    characters,
    locations,
    relationships: Array.isArray(input.relationships) ? input.relationships : [],
    characterMemories: Array.isArray(input.characterMemories) ? input.characterMemories : [],
    characterPlans: Array.isArray(input.characterPlans) ? input.characterPlans : [],
    interventions: Array.isArray(input.interventions) ? input.interventions : [],
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    rumors: Array.isArray(input.rumors) ? input.rumors : [],
    irreversibleTraces: Array.isArray(input.irreversibleTraces) ? input.irreversibleTraces : [],
    canonEvents: Array.isArray(input.canonEvents) ? input.canonEvents : [],
    draftScenes: Array.isArray(input.draftScenes) ? input.draftScenes : [],
    branches: Array.isArray(input.branches) ? input.branches : [{ id: ui.activeBranchId || "branch_main", name: "主分支", parentId: null }],
  };
}

function getRelationshipsFor(state, characterId, activeIds) {
  return state.relationships.filter((rel) => rel.fromCharacterId === characterId && activeIds.includes(rel.toCharacterId));
}

function getName(state, id) {
  return state.characters.find((character) => character.id === id)?.name || id;
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

function objectBelongsToLocation(object = "", location = {}) {
  const value = String(object || "").trim();
  if (!value) return false;
  return value === locationProp(location) || locationContextText(location).includes(value);
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

function memoryTargetIsInScope(memory = {}, { targetId = "", activeIds = [] } = {}) {
  const memoryTargetId = memory.targetCharacterId || "";
  if (!memoryTargetId) return true;
  if (targetId && memoryTargetId === targetId) return true;
  return activeIds.includes(memoryTargetId);
}

function getPressureMemory(state, characterId, activeIds = [], context = {}) {
  const branchId = state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
  const memories = (state.characterMemories || [])
    .filter((memory) => !memory.branchId || memory.branchId === branchId)
    .filter((memory) => memory.characterId === characterId)
    .filter((memory) => !memory.targetCharacterId || memory.targetCharacterId !== characterId)
    .filter((memory) => memoryTargetIsInScope(memory, { ...context, activeIds }));
  return memories.slice().sort((a, b) => (memoryScore(b) + memoryContextScore(b, context)) - (memoryScore(a) + memoryContextScore(a, context)))[0];
}

function memoryScore(memory) {
  const distortion = { accurate: 0, selective: 16, misremembered: 30, suppressed: 34, fabricated: 42, weaponized: 38 }[memory.type] || 12;
  return Number(memory.heat || 0) + distortion + (100 - Number(memory.reliability ?? 50));
}

function getLocation(state) {
  const locations = Array.isArray(state.locations) ? state.locations : [];
  return locations.find((location) => location.id === state.ui?.selectedLocationId) || locations[0] || { id: "loc_virtual", name: "未命名场所", subtext: "场所尚未定义，但人物仍会把缺失解释成压力。", powerRule: "空白场所会放大人物的自我解释。", likelyEvents: ["一次无法被单义解释的停顿"] };
}

function getOther(activeCharacters, character) {
  return activeCharacters.find((item) => item.id !== character.id) || activeCharacters[0];
}

function relationshipPressureProfile(rel = null) {
  if (!rel) return { dominant: "none", score: 0, rel: null };
  const hostility = Number(rel.resentment || 0) + Number(rel.revenge || 0) + Number(rel.jealousy || 0);
  const protection = Number(rel.protection || 0) + Number(rel.dependence || 0) + Number(rel.love || 0);
  const avoidance = Number(rel.fear || 0) + Number(rel.wantsToEscape || 0) + Number(rel.deception || 0);
  const approach = Number(rel.attraction || 0) + Number(rel.wantsToBeSeen || 0) + Number(rel.dependence || 0);
  const control = Number(rel.power || 0) + Number(rel.deception || 0) * 0.4 + Number(rel.shame || 0) * 0.2;
  const ranked = [
    ["hostility", hostility],
    ["protection", protection],
    ["avoidance", avoidance],
    ["approach", approach],
    ["control", control],
  ].sort((a, b) => b[1] - a[1]);
  return { dominant: ranked[0]?.[0] || "none", score: ranked[0]?.[1] || 0, hostility, protection, avoidance, approach, control, rel };
}

function relationshipIntensityScore(rel = null) {
  if (!rel) return 0;
  const profile = relationshipPressureProfile(rel);
  const arcPressure = Number(rel.relationshipArc?.pressure || 0);
  const arcHistory = Number(rel.relationshipArc?.historyCount || 0);
  return Number(profile.score || 0)
    + Number(rel.resentment || 0) * 0.4
    + Number(rel.fear || 0) * 0.35
    + Number(rel.dependence || 0) * 0.3
    + Number(rel.wantsToBeSeen || 0) * 0.25
    + Number(rel.power || 0) * 0.3
    + arcPressure * 0.35
    + arcHistory * 4;
}

function toneFromRelationshipPressure(profile = {}) {
  if (!profile || profile.score < 95) return "";
  if (profile.dominant === "hostility") return profile.hostility > 145 ? "陷害" : "惩罚";
  if (profile.dominant === "protection") return "保护";
  if (profile.dominant === "avoidance") return "伪装";
  if (profile.dominant === "approach") return "接近";
  if (profile.dominant === "control") return profile.control > 135 ? "陷害" : "伪装";
  return "";
}

function relationshipPressureLine(profile = {}, actor = "有人", target = "对方") {
  if (!profile || profile.dominant === "none") return "";
  const byDominant = {
    hostility: `${actor}和${target}之间的怨意已经压过普通试探，动作开始带着清算。`,
    protection: `${actor}对${target}的保护和依赖升高，动作会先护住人再处理事。`,
    avoidance: `${actor}对${target}的惧意和逃离冲动升高，动作会先遮掩退路。`,
    approach: `${actor}仍想让${target}看见自己，动作会主动靠近一点。`,
    control: `${actor}和${target}之间的解释权开始失衡，动作会先抢回命名权和规矩位置。`,
  };
  return byDominant[profile.dominant] || "";
}

function relationshipDialogueLine(rel = null, actor = "有人", target = "对方") {
  const last = rel?.lastDialogue;
  if (!last) return "";
  const object = last.sharedObject ? `${last.sharedObject}` : "上一件事";
  const place = last.locationName ? `在${last.locationName}` : "";
  const turn = String(last.followupTurn || last.finalTurn || rel.unspoken || "").replace(/[。！？…]+$/g, "");
  const outcome = String(last.eventOutcome || "").replace(/[。！？…]+$/g, "");
  const actReason = String(last.relationshipDialogueAct?.reason || "").trim().replace(/[。！？…]+$/g, "");
  const actKind = String(last.relationshipDialogueAct?.kind || "").trim();
  const actLine = actReason ? `；关系动作${actKind ? `/${actKind}` : ""}：${actReason}` : "";
  return `${actor}和${target}上一轮${place}围绕${object}留下了未结清的话${turn ? `：“${turn}”` : ""}${outcome ? `；结果是${outcome}` : ""}${actLine}。`;
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

function relationshipDialogueHistoryLine(rel = null, actor = "有人", target = "对方") {
  const fullHistory = Array.isArray(rel?.dialogueHistory) ? rel.dialogueHistory.filter(Boolean) : [];
  const history = fullHistory.slice(-3);
  if (history.length < 2) return "";
  const objects = [...new Set(history.map((item) => item.sharedObject).filter(Boolean))].join("、") || "几件东西";
  const places = [...new Set(history.map((item) => item.locationName).filter(Boolean))].join("、");
  const latestTurn = String(history.at(-1)?.followupTurn || history.at(-1)?.finalTurn || "").replace(/[。！？…]+$/g, "");
  return `${actor}和${target}已经连续${fullHistory.length}轮${places ? `在${places}` : ""}围绕${objects}没结清${latestTurn ? `，最新一句压着：“${latestTurn}”` : ""}。`;
}

function toneFromState(character, pressureMemory = null, plan = null, relationshipPressure = null) {
  const { desire, shame, rage, selfDeception, revengeImpulse, protectionImpulse } = character.currentState;
  if (plan?.status === "frozen") return "伪装";
  if (plan?.currentTactic === "self_destroy") return "自毁";
  if (plan?.currentTactic === "betray" || plan?.currentTactic === "plant_evidence") return "陷害";
  if (plan?.currentTactic === "protect") return "保护";
  if (plan?.currentTactic === "approach") return "接近";
  if (plan?.currentTactic === "withdraw" || plan?.currentTactic === "hide_evidence" || plan?.currentTactic === "control") return "伪装";
  if (plan?.currentTactic === "punish") return "惩罚";
  if (pressureMemory) {
    if (pressureMemory.type === "weaponized" || pressureMemory.stance === "revenge") return rage + revengeImpulse > 55 ? "陷害" : "惩罚";
    if (pressureMemory.type === "suppressed") return shame + selfDeception > 110 ? "伪装" : "撤退";
    if (pressureMemory.type === "misremembered" || pressureMemory.type === "fabricated") return "共谋";
    if (pressureMemory.stance === "desire" && desire > 48) return "接近";
    if (pressureMemory.stance === "protection" && protectionImpulse > 42) return "保护";
  }
  const relationshipTone = toneFromRelationshipPressure(relationshipPressure);
  if (relationshipTone) return relationshipTone;
  if (rage + revengeImpulse > desire + protectionImpulse + 20) return "惩罚";
  if (desire > 65 && shame < 58) return "接近";
  if (shame > 62 && selfDeception > 62) return "伪装";
  if (protectionImpulse > 56) return "保护";
  return "试探";
}

function getTownStatePressure(state = {}, characterId = "", activeIds = [], { location = null } = {}) {
  const branchId = state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
  const entries = Array.isArray(state.townStateLedger) ? state.townStateLedger : [];
  return entries
    .map((entry, index) => {
      if (!entry || (entry.branchId && entry.branchId !== branchId)) return null;
      const fromId = entry.fromCharacterId || "";
      const toId = entry.toCharacterId || "";
      const targetCharacterId = fromId === characterId ? toId : toId === characterId ? fromId : "";
      if (!targetCharacterId || !activeIds.includes(targetCharacterId)) return null;
      let score = 100 - index;
      if (location?.id && entry.locationId === location.id) score += 90;
      if (location?.name && entry.locationName === location.name) score += 70;
      if (entry.object && objectBelongsToLocation(entry.object, location)) score += 30;
      if (/必须|不得|失去|欠|控制|留在|扣/.test(entry.consequence || "")) score += 20;
      return { ...entry, targetCharacterId, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)[0] || null;
}

function townStatePressureLine(entry = null, characterName = "有人", targetName = "对方") {
  if (!entry) return "";
  const object = entry.object || "场中物件";
  const locationName = entry.locationName || "场中";
  const consequence = String(entry.consequence || "").trim();
  const roleLine = entry.toCharacterName === characterName
    ? `${characterName}还被${object}留在${locationName}的见证处，不能把${targetName}上一轮留下的话绕过去。`
    : `${characterName}仍握着${object}在${locationName}留下的解释权，${targetName}必须回应。`;
  return [roleLine, consequence].filter(Boolean).join(" ");
}

function toneFromTownStatePressure(entry = null, characterId = "") {
  if (!entry) return "";
  if (entry.kind === "protect") return "保护";
  if (entry.kind === "bargain" || entry.kind === "withdraw") return "伪装";
  if (entry.kind === "accuse" || entry.kind === "punish") return entry.fromCharacterId === characterId ? "惩罚" : "伪装";
  if (entry.kind === "control") return entry.fromCharacterId === characterId ? "惩罚" : "伪装";
  return "";
}

function townStatePressureIsLocal(entry = null, location = {}) {
  if (!entry) return false;
  return Boolean(
    (location?.id && entry.locationId === location.id)
      || (location?.name && entry.locationName === location.name)
      || (entry.object && objectBelongsToLocation(entry.object, location)),
  );
}

function toneFromRelationshipArc(rel = null, characterId = "") {
  const arc = rel?.relationshipArc;
  if (!arc) return "";
  if (arc.kind === "protect") return "保护";
  if (arc.kind === "bargain" || arc.kind === "withdraw") return "伪装";
  if (arc.kind === "accuse" || arc.kind === "punish") return rel?.fromCharacterId === characterId ? "惩罚" : "伪装";
  if (arc.kind === "control") return rel?.fromCharacterId === characterId ? "惩罚" : "伪装";
  return "";
}

function applyTownStatePressureToVisibleAction(base = "", entry = null, character = {}, target = {}, location = {}) {
  if (!entry) return base;
  const object = entry.object || locationProp(location);
  const actorName = character.name || "有人";
  const targetName = target.name || "对方";
  const tail = entry.toCharacterId === character.id
    ? `${actorName}没有先碰${object}，目光落回${entry.locationName || location.name || "场中"}的见证处。`
    : `${actorName}守着${object}，没有让${targetName}越过见证处。`;
  return `${base} ${tail}`.trim();
}

function relationshipOutcomeVisibleTail(rel = null, character = {}, target = {}, location = {}, prop = "") {
  const dialogue = rel?.lastDialogue || null;
  if (!dialogue?.eventOutcome) return "";
  const actorName = character.name || "有人";
  const targetName = target.name || "对方";
  const item = prop || dialogue.sharedObject || locationProp(location);
  const outcome = String(dialogue.eventOutcome || "");
  if (actorOwnsDarkLedgerFailure(outcome, actorName)) {
    return `${actorName}把袖口从${item}旁挪开，暗账没能被${actorName}收回。`;
  }
  if (/价码|旧案/.test(outcome) && /暗账|账册|摊主|界石/.test(outcome) && actorOwnsDarkLedgerFailure(outcome, actorName)) {
    return `${actorName}把${item}压住，没有再把旧案藏回价码里。`;
  }
  if (/没有被写成价码|人被当成|人名/.test(outcome) && (outcome.includes(actorName) || outcome.includes(targetName))) {
    return `${actorName}看了一眼${item}旁的人名，手没有先伸出去。`;
  }
  if (/证词/.test(outcome) && (outcome.includes(actorName) || outcome.includes(targetName))) {
    return `${actorName}看向${item}旁多出的证词，话没有再退回原处。`;
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

function activeSceneProp(location = {}, pressureMemory = null, activeRelationship = null, townStatePressure = null) {
  if (townStatePressureIsLocal(townStatePressure, location)) {
    return townStatePressure.object || locationProp(location);
  }

  const arcObject = activeRelationship?.relationshipArc?.sharedObject || "";
  if (
    arcObject
    && (
      objectBelongsToLocation(arcObject, location)
      || (location?.id && activeRelationship?.relationshipArc?.locationId === location.id)
      || (location?.name && activeRelationship?.relationshipArc?.locationName === location.name)
    )
  ) {
    return arcObject;
  }

  const pressureSource = pressureMemory?.sourceRelationshipShift || {};
  const pressureObject = pressureSource.sharedObject
    || pressureMemory?.memorySharedObject
    || pressureMemory?.relationshipDialogueMemory?.sharedObject
    || "";
  if (
    pressureObject
    && (
      objectBelongsToLocation(pressureObject, location)
      || (location?.id && pressureSource.locationId === location.id)
      || (location?.name && pressureSource.locationName === location.name)
    )
  ) {
    return pressureObject;
  }

  const dialogue = activeRelationship?.lastDialogue || null;
  const dialogueObject = dialogue?.sharedObject || dialogue?.conductorSignal?.object || "";
  if (
    dialogueObject
    && (
      objectBelongsToLocation(dialogueObject, location)
      || (location?.id && dialogue.locationId === location.id)
      || (location?.name && dialogue.locationName === location.name)
    )
  ) {
    return dialogueObject;
  }
  return locationProp(location);
}

function visibleTemplate(character, other, location, tone, pressureMemory = null, plan = null, activeRelationship = null, townStatePressure = null) {
  const verbs = character.actionVerbs?.visible || [];
  const verb = pick(verbs, "说明");
  const visibleLine = character.actionLines?.visible || "维护体面身份";
  const prop = activeSceneProp(location, pressureMemory, activeRelationship, townStatePressure);
  const stageAction = materializeVisibleLine(character, other, visibleLine, location, verb, prop);
  const speechObject = activeRelationship?.relationshipArc?.sharedObject ? prop : character.agentProfile?.leverageObject || prop;
  const spoken = localizeMockSpokenLine(spokenDefenseLine(character, other), location, speechObject);
  const visibleMove = performVisibleVerb(character.name, verb, other.name, location, prop);
  const centralPropMove = `${character.name}把${prop}推到两人中间。`;
  const punitiveMove = visibleMove.includes(`把${prop}推到两人中间`)
    ? visibleMove
    : `${visibleMove} ${centralPropMove}`;
  const options = {
    惩罚: `${punitiveMove} ${character.name}说：“${spoken}”`,
    接近: `${stageAction} ${character.name}说：“${spoken}”`,
    伪装: `${visibleMove} ${character.name}把声音压低。${character.name}说：“${spoken}”`,
    保护: `${character.name}挡在${other.name}身前，把${prop}往外挪开。${character.name}说：“${spoken}”`,
    试探: `${visibleMove} ${character.name}说：“${spoken}”`,
  };
  const base = options[tone] || options.试探;
  const planTail = visiblePlanTail(character, other, location, plan, prop);
  const visibleTownStatePressure = townStatePressureIsLocal(townStatePressure, location) ? townStatePressure : null;
  const townAwareBase = applyTownStatePressureToVisibleAction(base, visibleTownStatePressure, character, other, location);
  const outcomeTail = relationshipOutcomeVisibleTail(activeRelationship, character, other, location, prop);
  const outcomeAwareBase = outcomeTail ? `${townAwareBase} ${outcomeTail}` : townAwareBase;
  if (!pressureMemory) return `${outcomeAwareBase}${planTail}`;
  if (isBlockedRetreatMemory(pressureMemory, plan)) return `${outcomeAwareBase} ${blockedRetreatVisibleTail(character, location, pressureMemory)}${planTail}`;
  return `${outcomeAwareBase} ${character.name}把${prop}又往里推了一点。${planTail}`;
}

function isBlockedRetreatMemory(memory = {}, plan = null) {
  const source = memory.sourceRelationshipShift || {};
  const text = [
    memory.content,
    memory.publicVersion,
    memory.privateVersion,
    memory.retrievalCue,
    memory.distortion,
    source.sharedObject,
    source.eventOutcome,
    source.finalTurn,
    source.followupTurn,
    plan?.currentTactic,
    plan?.shortTerm,
    plan?.hiddenObjective,
  ].filter(Boolean).join(" ");
  return /退路|不能替你写|不能被.*改成退路|不能只把话推回去/.test(text);
}

function blockedRetreatVisibleTail(character, location, memory = {}) {
  const rememberedProp = memory.sourceRelationshipShift?.sharedObject || "";
  const prop = rememberedProp && objectBelongsToLocation(rememberedProp, location)
    ? rememberedProp
    : locationProp(location);
  const name = location?.name || "";
  if (/法契|契门|界石/.test(name)) {
    return `${character.name}把${prop}推回界石边，自己后退到门槛内侧；盖印的人仍被挡在铜盘外。`;
  }
  if (/无咎市|市/.test(name)) {
    return `${character.name}把${prop}推回案台边，自己后退到摊灯外侧；摊主的铜夹仍挡在账页上。`;
  }
  if (/照骨司|镜塔|档案/.test(name)) {
    return `${character.name}把${prop}推回照骨镜下，自己后退到镜光外；案卷还没合上。`;
  }
  if (/归墟|渡/.test(name)) {
    return `${character.name}把${prop}推回水线边，自己后退到石阶内侧；水阵仍压着渡路。`;
  }
  if (/万灵|医坊/.test(name)) {
    return `${character.name}把${prop}推回药炉旁，自己后退到帘影里；庇护牌仍亮着。`;
  }
  return `${character.name}把${prop}推回${interactionSurface(location)}，自己后退半步；旁边的人仍没能把话接走。`;
}

function visiblePlanTail(character, other, location, plan, propOverride = "") {
  if (!plan) return "";
  const name = character?.name || "有人";
  const target = other?.name || "对方";
  const mode = plan.currentTactic || plan.mode;
  const prop = propOverride || locationProp(location);
  const byMode = {
    approach: `随后向${target}靠近半步。`,
    withdraw: `随后后退半步，把${prop}留在原处。`,
    protect: `随后把声音压低，站到${target}近处。`,
    punish: `随后脚步压近半步。`,
    betray: `随后把一句话留给旁边的人听见。`,
    confess: `随后把${prop}推到光里。`,
    hide_evidence: `随后把纸页压到${prop}下面。`,
    plant_evidence: `随后把一张纸压在${prop}旁。`,
    self_destroy: `随后把自己的解释咽回去。`,
    wait: `随后停在原处，手没有离开${prop}。`,
  };
  return ` ${byMode[mode] || `随后把声音压低，脚步停在${target}面前。`}`;
}

function spokenDefenseLine(character, other) {
  const raw = pick(character.defenseLanguage, "");
  const fallback = other?.name ? `${other.name}，先等一下` : "先等一下";
  return ensureSpokenPunctuation(String(raw || fallback)
    .replace(/[“”"「」]/g, "")
    .trim());
}

function ensureSpokenPunctuation(text = "") {
  const cleaned = String(text || "先等一下").trim();
  return /[。！？]$/.test(cleaned) ? cleaned : `${cleaned}。`;
}

function localizeMockSpokenLine(text = "", location = {}, object = "") {
  const locationName = location?.name || "";
  const item = object || locationProp(location);
  const ending = String(text || "").match(/[！？]$/)?.[0] || "";
  if (/万灵|医坊/.test(locationName)) return ensureSpokenPunctuation(`${stripSpokenTail(text)}${ending}`);
  let line = stripSpokenTail(text);
  if (item && item !== "停剑令" && /停剑令|谁先拔剑|破禁/.test(line) && !/停剑|茶楼/.test(locationName)) {
    line = `${item}留在${interactionSurface(location)}，伸来的手先停在明处`;
  }
  line = line
    .replace(/进了医坊/g, `${item}压在${interactionSurface(location)}`)
    .replace(/药炉前不问正邪/g, `${item}亮着时不问正邪`)
    .replace(/庇护牌还亮着/g, `${item}还亮着`)
    .replace(/庇护牌亮着/g, `${item}亮着`)
    .replace(/留在药炉旁/g, `留在${interactionSurface(location)}`)
    .replace(/药炉前/g, interactionSurface(location))
    .replace(/诊床/g, interactionSurface(location));
  return ensureSpokenPunctuation(`${line}${ending}`);
}

function materializeVisibleLine(character, other, line = "", location = {}, verb = "说明", propOverride = "") {
  const name = character?.name || "有人";
  const target = other?.name || "对方";
  const text = String(line || "");
  if (/食物|清理|房间|判断|照护/.test(text)) return `${name}把餐盘放到门边，又把手停在门板上。`;
  if (/保护|阻止|看见/.test(text)) return `${name}扶住门框，低声劝${target}。`;
  if (/秩序|危险|房间/.test(text)) return `${name}把账本按在桌面上，挡住${target}的去路。`;
  if (/解释|职责|履行/.test(text)) return `${name}贴近门缝，先摸到车次表的边角。`;
  if (/纪律|缺勤|上报|公司/.test(text)) return `${name}把怀表合上，把缺勤记录推到灯下。`;
  if (/租金|条件|安静|房间/.test(text)) return `${name}把餐巾折窄，指节敲了敲桌沿。`;
  return performVisibleVerb(name, verb, target, location, propOverride);
}

function localizeVisibleObject(object = "", location = {}) {
  const value = String(object || "").trim();
  if (value === "药炉" && !/万灵|医坊/.test(location?.name || "")) return "庇护牌";
  return value;
}

function comparableVisibleObject(object = "") {
  return String(object || "")
    .replace(/^(?:一只|一张|一枚|一道|一条|一件|那只|那张|那枚|那道|那条|那个|这只|这张|这枚|这道|这条|这个)/, "")
    .trim();
}

function sameVisibleObject(left = "", right = "") {
  const normalizedLeft = comparableVisibleObject(left);
  const normalizedRight = comparableVisibleObject(right);
  return Boolean(
    normalizedLeft
      && normalizedRight
      && (normalizedLeft === normalizedRight || normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)),
  );
}

function verificationAction(name = "有人", target = "对方", location = {}, prop = "凭证") {
  const place = location?.name || "";
  if (/法契|契门|界石/.test(place)) return `${name}扣住${target}面前的${prop}，按到界石前，灵痕亮了一下。`;
  if (/无咎市|市/.test(place)) return `${name}扣住${target}面前的${prop}，按到案台边，摊主的铜夹停了一下。`;
  if (/照骨司|镜塔|档案/.test(place)) return `${name}扣住${target}面前的${prop}，推到照骨镜下，镜面浮出一道浅痕。`;
  if (/归墟|渡/.test(place)) return `${name}扣住${target}面前的${prop}，压到水线边，水阵轻轻一沉。`;
  if (/万灵|医坊/.test(place)) return `${name}扣住${target}面前的${prop}，移到药炉旁，火光压低了一寸。`;
  return `${name}扣住${target}面前的${prop}，推到明处。`;
}

function performVisibleVerb(name = "有人", verb = "说明", target = "对方", location = {}, propOverride = "") {
  const prop = propOverride || locationProp(location);
  if (/验契|验牌|照印/.test(verb)) return verificationAction(name, target, location, prop);
  if (/魔印/.test(verb)) return `${name}把魔印压到${prop}旁，袖口遮住半道黑痕。`;
  if (/扣剑|扣住|护证|逼问|压低剑匣|封案|封渡|摁住|压住|收令|拦住|阻止/.test(verb)) return `${name}扣住${target}面前的${prop}，另一只手拦住${target}。`;
  if (/换符|试价|递毒誓|退到灯影/.test(verb)) return `${name}把一枚符压到${prop}旁，灯影遮住半张脸。`;
  if (/诊脉|藏药|换药炉|关窗/.test(verb)) {
    if (/万灵|医坊/.test(location?.name || "")) return `${name}扣住${target}腕边的庇护牌，把药炉挪近${target}。`;
    return `${name}扣住${target}腕边的庇护牌，把庇护牌压到${interactionSurface(location)}。`;
  }
  if (/点魂灯|领鬼差|开棺|递供词|合上黑伞/.test(verb)) return `${name}点亮魂灯，供词在${target}面前展开。`;
  if (/敲法铃|问供|退牌|按住城令/.test(verb)) return `${name}敲响法铃，把${prop}推到两人中间。`;
  if (/念经/.test(verb)) return `${name}把通关文牒收进袖中，念声停了一拍。`;
  if (/探路/.test(verb)) return `${name}先走到路口，用金箍棒点了点地面。`;
  if (/讨价还价/.test(verb)) return `${name}扶住行李担，把声音压到桌边。`;
  if (/冷笑/.test(verb)) return `${name}笑了一声，把${prop}往身侧拨开。`;
  if (/爬近/.test(verb)) return `${name}贴近门缝，脚步在地板上轻轻擦过。`;
  if (/躲开/.test(verb)) return `${name}往阴影里退了一点。`;
  if (/端来|清理|阻挡|关门|扶住|退后|停住/.test(verb)) return `${name}${verb}到一半，手停在${prop}旁。`;
  if (/说明|解释|劝说|命令|训斥|宣布|追问|要求|问|说|呼唤|哀求|回答|催促/.test(verb)) return `${name}${verb}了一句，手停在${prop}旁。`;
  return `${name}${verb}到一半，手停在${prop}旁。`;
}

function locationProp(location = {}) {
  const name = location?.name || "";
  if (/法契|契门|界石/.test(name)) return "灵契";
  if (/无咎市/.test(name)) return "妖丹盒";
  if (/照骨司|镜塔|档案/.test(name)) return "照骨镜";
  if (/归墟|渡/.test(name)) return "渡令";
  if (/万灵|医坊/.test(name)) return "庇护牌";
  if (/停剑|茶楼/.test(name)) return "停剑令";
  if (/山门|路口/.test(name)) return "通关文牒";
  if (/密林|小路|行李/.test(name)) return "行李担";
  if (/妖洞|洞厅|洞/.test(name)) return "火把";
  if (/破寺|寺院/.test(name)) return "蒲团";
  if (/河|渡|船|桥/.test(name)) return "船桨";
  if (/餐桌|客厅|桌/.test(name)) return "账本";
  if (/房客|出租|空房间/.test(name)) return "餐巾";
  if (/房间|门/.test(name)) return "门边的椅子";
  if (/公司|柜台/.test(name)) return "缺勤记录";
  const inferred = inferLocationPropFromText(location);
  if (inferred) return inferred;
  return "凭证";
}

function inferLocationPropFromText(location = {}) {
  const text = [
    location.name,
    location.visibleUse,
    location.subtext,
    ...(location.likelyEvents || []),
  ].filter(Boolean).join(" ");
  const terms = [
    "氧气计费手环",
    "旧氧气罐",
    "深海鱼皮包",
    "氧气结晶",
    "氧气牌",
    "潮汐闸章",
    "通行章",
    "祈祷记录",
    "庇护记录",
    "鱼人血样",
    "非法鱼人血样",
    "藻类滤芯",
    "欠税名单",
    "配额账本",
    "公司印章",
    "通行证",
    "债契",
    "船票",
    "药剂",
    "护符",
  ];
  const explicit = terms.find((term) => text.includes(term));
  if (explicit) return explicit;
  if (/氧气|配额|呼吸/.test(text)) return "氧气牌";
  if (/潮汐|闸门|水压|出闸/.test(text)) return "潮汐闸章";
  if (/祈祷|舱门|信徒|庇护/.test(text)) return "祈祷记录";
  if (/鱼人|血样/.test(text)) return "鱼人血样";
  if (/藻类|滤芯/.test(text)) return "藻类滤芯";
  if (/税|公司|账/.test(text)) return "配额账本";
  return "";
}

function hiddenTemplate(character, other, tone, pressureMemory = null, plan = null) {
  const hiddenVerb = pick(character.actionVerbs?.hidden, "确认");
  const desireLine = character.actionLines?.desire || "确认自己被对方看见";
  const options = {
    惩罚: `${character.name}想通过让${other.name}停住，确认自己仍能影响对方。`,
    接近: `${character.name}想${hiddenVerb}${other.name}是否也在等待这次回应。`,
    伪装: `${character.name}想把${desireLine}藏进一套不会被追问的理由里。`,
    保护: `${character.name}想保护${other.name}，也想让这种保护证明自己仍有资格靠近。`,
    试探: `${character.name}想${hiddenVerb}：对方听懂的是表面，还是裂缝。`,
  };
  const base = options[tone] || options.试探;
  const planTail = plan ? `；更深的计划是：${plan.hiddenObjective || plan.nextActionBias}` : "";
  if (!pressureMemory) return `${base}${planTail}`;
  return `${base}；真正回流的是记忆：“${pressureMemory.privateVersion || pressureMemory.content || pressureMemory.id}”${planTail}。`;
}

function defenseTemplate(character, tone, pressureMemory = null, plan = null) {
  const sentence = pick(character.defenseLanguage, character.currentState?.currentSelfLie || "我只是按原则行事。");
  const defense = character.actionLines?.defense || "把欲望伪装成原则";
  const prefix = {
    惩罚: "把残忍命名为标准",
    接近: "把靠近命名为帮助",
    伪装: "把恐惧命名为程序",
    保护: "把占有命名为保护",
    试探: "把等待命名为观察",
  }[tone] || defense;
  const memoryTail = pressureMemory ? `；并把“${pressureMemory.publicVersion || pressureMemory.content || pressureMemory.id}”当成体面证词` : "";
  const planTail = plan ? `；中期伪装是：${plan.midTermMask}` : "";
  return `${prefix}；他的自欺句是：“${sentence}”${memoryTail}${planTail}`;
}

function shadowTemplate(character, other, tone, pressureMemory = null, plan = null) {
  const action = pick(character.shadowActions, "用体面理由索取对方回应");
  const options = {
    惩罚: `${character.name}${action}，并从${other.name}的迟疑里获得短暂安全。`,
    接近: `${character.name}${action}，却把这解释成普通关照。`,
    伪装: `${character.name}${action}，留下以后可能被误读的痕迹。`,
    保护: `${character.name}${action}，让${other.name}被迫参与自己的高尚。`,
    试探: `${character.name}${action}，想知道对方是否会继续追问。`,
  };
  const base = options[tone] || options.试探;
  const planTail = plan ? ` 计划的自我破坏点是：${plan.selfSabotage}` : "";
  if (!pressureMemory) return `${base}${planTail}`;
  return `${base} 这段记忆的扭曲机制是：${pressureMemory.distortion || "把旧事写成当前证据"}。${planTail}`;
}

function memoryDistortionAction(memory, character, target) {
  if (!memory) return "";
  const actionByType = {
    weaponized: "把记忆交给场所压力，让它像证据一样伤人",
    suppressed: "把记忆压回体面语言，却让沉默承担攻击",
    misremembered: "把对方的反应改写成自己早已知道的版本",
    fabricated: "把缺失的细节补成一段更适合自我神话的证词",
    selective: "只留下能证明自己没有错的部分",
    accurate: "让准确记忆约束自己，但仍试图保留解释权",
  };
  return `${character.name}${actionByType[memory.type] || actionByType.selective}；${target.name}会被迫回应的不是事实，而是这段记忆的版本。`;
}

export function characterAgent({ state, character, activeCharacters, location }) {
  const other = getOther(activeCharacters, character);
  const activeIds = activeCharacters.map((item) => item.id);
  const relationships = getRelationshipsFor(state, character.id, activeIds);
  const strongest = relationships.sort((a, b) => relationshipIntensityScore(b) - relationshipIntensityScore(a))[0];
  const pressureMemory = getPressureMemory(state, character.id, activeIds, {
    location,
    targetId: strongest?.toCharacterId || other?.id || "",
    activeIds,
  });
  const townStatePressure = getTownStatePressure(state, character.id, activeIds, { location });
  const plan = getCharacterPlan({ ...state, characterPlans: ensureCharacterPlans(state) }, character.id);
  const memoryTarget = pressureMemory?.targetCharacterId && pressureMemory.targetCharacterId !== character.id
    ? activeCharacters.find((item) => item.id === pressureMemory.targetCharacterId)
    : null;
  const townPressureTarget = townStatePressure?.targetCharacterId && townStatePressure.targetCharacterId !== character.id
    ? activeCharacters.find((item) => item.id === townStatePressure.targetCharacterId)
    : null;
  const target = memoryTarget || townPressureTarget || (strongest ? state.characters.find((item) => item.id === strongest.toCharacterId) || other : other);
  const activeRelationship = relationships.find((rel) => rel.toCharacterId === target.id) || strongest || null;
  const relationshipPressure = relationshipPressureProfile(activeRelationship);
  const baseTone = toneFromState(character, pressureMemory, plan, relationshipPressure);
  const townTone = toneFromTownStatePressure(townStatePressure, character.id);
  const arcTone = toneFromRelationshipArc(activeRelationship, character.id);
  const arcPressure = Number(activeRelationship?.relationshipArc?.pressure || 0);
  const tone = townStatePressure && baseTone === "试探" && townTone
    ? townTone
    : arcTone && (baseTone === "试探" || arcPressure >= 60)
      ? arcTone
      : baseTone;
  const visibleAction = visibleTemplate(character, target, location, tone, pressureMemory, plan, activeRelationship, townStatePressure);
  const hiddenAction = hiddenTemplate(character, target, tone, pressureMemory, plan);
  const relationLine = relationshipPressureLine(relationshipPressure, character.name, target.name);
  const relationDialogueLine = relationshipDialogueLine(activeRelationship, character.name, target.name);
  const relationHistoryLine = relationshipDialogueHistoryLine(activeRelationship, character.name, target.name);
  const relationTranscriptLine = relationshipDialogueTranscriptLine(activeRelationship?.lastDialogue);
  const relationHistoryTranscriptLine = relationshipDialogueHistoryTranscriptLine(activeRelationship?.dialogueHistory);
  const relationshipArcLine = relationshipArcSummary(activeRelationship, character.name, target.name);
  const relationshipSummary = [relationLine, relationshipArcLine, relationDialogueLine, relationTranscriptLine, relationHistoryLine, relationHistoryTranscriptLine].filter(Boolean).join(" ");
  const townStatePressureSummary = townStatePressureLine(townStatePressure, character.name, target.name);
  const pressureAwareHiddenAction = [hiddenAction, townStatePressureSummary, relationshipArcLine, relationLine, relationDialogueLine, relationTranscriptLine, relationHistoryLine, relationHistoryTranscriptLine].filter(Boolean).join(" ");
  const defenseAction = defenseTemplate(character, tone, pressureMemory, plan);
  const shadowAction = shadowTemplate(character, target, tone, pressureMemory, plan);
  const possibleNobleAction = pick(character.nobleActions, "承认自己的行动不纯。悄悄降低对他人的伤害。");
  const possibleEvidenceLeft = pick(location.likelyEvents, "一次可以被误读的停顿");

  return {
    characterId: character.id,
    targetCharacterId: target.id,
    tone,
    visibleAction,
    hiddenAction: pressureAwareHiddenAction,
    defenseAction,
    shadowAction,
    surfaceJustification: defenseAction,
    desireReason: pressureAwareHiddenAction,
    unadmittedPleasure: `${character.name}在${target.name}的反应里获得短暂确认，却把这种确认说成场面控制。`,
    selfDeceptionSentence: character.currentState?.currentSelfLie || character.internalSituation?.repeatedSelfLie || "我只是按原则行事。",
    wantsFromOthers: character.agentProfile?.desiredResponse
      || character.internalSituation?.desiredResponse
      || character.innerCourt?.desiredResponse
      || "希望关键的人听完自己的要求，再作出明确回应。",
    desiredEmotionalResponse: tone === "惩罚" ? "迟疑、受伤、继续等待解释" : "注意、追问、轻微动摇",
    possibleHarm: `让${target.name}把自己的反应误认为问题本身。`,
    possibleNobleAction,
    possibleEvidenceLeft: `${location.name}留下：${possibleEvidenceLeft}`,
    memoryInfluence: pressureMemory ? `记忆“${pressureMemory.content || pressureMemory.privateVersion || pressureMemory.id}”以${pressureMemory.type || "selective"}形式回流，迫使行动带上${pressureMemory.stance || "confusion"}压力。` : "",
    memoryUse: pressureMemory ? `${pressureMemory.type || "selective"}/${pressureMemory.stance || "confusion"}：${pressureMemory.publicVersion || pressureMemory.content || pressureMemory.id}` : "",
    memoryDistortionAction: memoryDistortionAction(pressureMemory, character, target),
    relationshipPressure,
    relationshipPressureSummary: relationshipSummary,
    relationshipArcSummary: relationshipArcLine,
    townStatePressure,
    townStatePressureSummary,
    relationshipDialogueMemory: activeRelationship?.lastDialogue || null,
    activeRelationshipId: activeRelationship?.id || null,
    memoryId: pressureMemory?.id || null,
    planId: plan?.id || null,
    planInfluence: plan ? summarizePlan(plan, state) : "",
    planNextAction: plan?.nextActionBias || "",
    planStatus: plan?.status || "none",
  };
}

function enrichWithSimulation(output, simulationTick) {
  const sim = (simulationTick.privateSimulations || []).find((item) => item.characterId === output.characterId);
  const visibility = simulationTick.visibilityLayer?.perCharacter?.find((item) => item.characterId === output.characterId);
  const enriched = enrichAgentOutputWithPrivateSimulation(output, sim);
  return {
    ...enriched,
    simulationTickId: simulationTick.id,
    realtimePublicGoal: sim?.publicGoal || output.visibleAction,
    realtimePrivateDesire: sim?.privateDesire || output.hiddenAction,
    realtimeDefensiveMask: sim?.defensiveMask || output.defenseAction,
    realtimeShadowImpulse: sim?.shadowImpulse || output.shadowAction,
    realtimeNobleImpulse: sim?.nobleImpulse || output.possibleNobleAction,
    realtimeLieToSelf: sim?.selfLie || output.selfDeceptionSentence,
    realtimeLeverageObject: sim?.agentProfile?.leverageObject || enriched.privateLeverageObject || "",
    realtimeActionCandidate: sim?.actionCandidate || output.tone,
    conversationObjective: sim?.conversationObjective || output.conversationObjective || "",
    conversationEndCondition: sim?.conversationEndCondition || output.conversationEndCondition || "",
    reactionReason: sim?.reactionReason || output.reactionReason || "",
    realtimePressure: sim?.contradictionScore || 50,
    realtimeContradictionScore: sim?.contradictionScore || 50,
    visibilityFacts: simulationTick.visibilityLayer?.visibleFacts || [],
    withheldFacts: simulationTick.visibilityLayer?.hiddenFacts || [],
    falseBeliefs: visibility?.falseBeliefs || [],
  };
}

function createAgentOutputIdentity(output, exchangeId, index) {
  return {
    ...output,
    outputId: output.outputId || createId("agent_output"),
    agentExchangeId: exchangeId,
    interactionRole: index === 0 ? "initiator" : "responder",
  };
}

function chooseInteractionSource(outputs = [], output = {}) {
  return outputs.find((item) => item.characterId === output.targetCharacterId)
    || outputs.find((item) => item.targetCharacterId === output.characterId)
    || outputs[outputs.length - 1]
    || null;
}

function extractActionObject(text = "", location = {}) {
  const prop = locationProp(location);
  const candidates = [
    "契牌",
    "毒誓符",
    "魔印",
    "一枚符",
    "符",
    "禁术符箓",
    "庇护牌",
    "药炉",
    prop,
    "铜盘",
    "妖丹盒",
    "照骨镜",
    "剑匣",
    "渡令",
    "界石",
    "停剑令",
    "通关文牒",
    "行李担",
    "账本",
    "车次表",
    "门板",
  ];
  return candidates.find((item) => item && String(text).includes(item)) || prop;
}

function interactionSurface(location = {}) {
  const name = location?.name || "";
  if (/法契|契门|界石/.test(name)) return "铜盘边";
  if (/无咎市|市/.test(name)) return "案台边";
  if (/照骨司|镜塔|档案/.test(name)) return "照骨镜下";
  if (/归墟|渡/.test(name)) return "湿冷的石阶上";
  if (/万灵|医坊/.test(name)) return "药炉旁";
  if (/停剑|茶楼/.test(name)) return "茶盏旁";
  if (/山门|路口/.test(name)) return "石阶上";
  if (/密林|小路|行李/.test(name)) return "行李担旁";
  if (/餐桌|客厅|桌/.test(name)) return "账本旁";
  if (/房间|门/.test(name)) return "门槛边";
  if (/公司|柜台/.test(name)) return "柜台灯下";
  return "桌面边";
}

function stripSpokenTail(text = "") {
  return String(text || "").replace(/[“”"「」]/g, "").replace(/[。！？…]+$/g, "").trim();
}

function localProcedureHoldLine(location = {}, object = "那件东西") {
  const name = location?.name || "";
  if (/法契|契门|界石/.test(name)) return `${object}留给界石`;
  if (/无咎市|市/.test(name)) return `${object}留在案台边`;
  if (/照骨司|镜塔|档案/.test(name)) return `${object}留在镜下`;
  if (/归墟|渡/.test(name)) return `${object}留在水线内`;
  if (/万灵|医坊/.test(name)) return `${object}留在药炉旁`;
  return `${object}留在明处`;
}

function contextualResponseLine(sourceAction = "", baseSpoken = "", sharedObject = "", ownObject = "", location = {}) {
  const source = stripSpokenTail(sourceAction);
  const base = stripSpokenTail(baseSpoken);
  const object = sharedObject || ownObject || "那件东西";
  let answer = "";
  if (/谁.*盖印|盖印.*谁|谁.*签|签.*谁|谁来盖印/.test(source)) {
    answer = `名字先不写，${localProcedureHoldLine(location, object)}`;
  } else if (/盖印|落印|签押/.test(source)) {
    answer = /法契|契门|界石/.test(location?.name || "")
      ? `印先别落，${object}还在两个人中间`
      : `${object}先别收走，话还在两个人中间`;
  } else if (/谁|哪一个|哪位/.test(source)) {
    answer = `名字先不写，${object}压在眼前`;
  } else if (/走|离开|带走|换手/.test(source)) {
    answer = `${object}不走，人也不能被你一句话带走`;
  }
  if (!answer) return ensureSpokenPunctuation(base);
  if (!base || answer.includes(base)) return ensureSpokenPunctuation(answer);
  return ensureSpokenPunctuation(`${answer}。${base}`);
}

function responseActionContextKey(output = {}, sourceOutput = {}, simulationTick = null, location = {}) {
  return [
    simulationTick?.periodSlot,
    simulationTick?.id,
    location?.id || location?.name,
    output.characterId,
    sourceOutput.characterId,
    output.outputId,
    sourceOutput.outputId,
    output.tone,
  ].filter(Boolean).join(":");
}

function periodActionTexture(periodSlot = "") {
  if (/上午/.test(periodSlot)) return "趁门口的灯还亮着，";
  if (/中午/.test(periodSlot)) return "账页翻到空白处时，";
  if (/下午/.test(periodSlot)) return "柜台边停笔以后，";
  if (/傍晚/.test(periodSlot)) return "灯影压到脚边时，";
  if (/夜间|夜里/.test(periodSlot)) return "夜灯照到手背时，";
  return "";
}

function rewriteVisibleActionAsResponse(output, sourceOutput, state, location, simulationTick = null) {
  const actor = getName(state, output.characterId);
  const source = getName(state, sourceOutput.characterId);
  const ownTarget = output.targetCharacterId && output.targetCharacterId !== sourceOutput.characterId
    ? getName(state, output.targetCharacterId)
    : "";
  const object = interactionSharedObject(sourceOutput, location);
  const ownCandidate = output.visibleAction || "";
  const ownObject = localizeVisibleObject(
    output.realtimeLeverageObject || output.privateLeverageObject || extractActionObject(ownCandidate, location),
    location,
  );
  const surface = interactionSurface(location);
  const contextKey = responseActionContextKey(output, sourceOutput, simulationTick, location);
  const periodTexture = periodActionTexture(simulationTick?.periodSlot || "");
  const baseSpoken = output.dialogueDecision?.utterance || spokenDefenseLine(
    state.characters.find((character) => character.id === output.characterId) || { defenseLanguage: [] },
    state.characters.find((character) => character.id === sourceOutput.characterId) || { name: source },
  );
  const localizedBaseSpoken = localizeMockSpokenLine(baseSpoken, location, ownObject || object);
  const spoken = output.dialogueDecision?.utterance
    ? ensureSpokenPunctuation(output.dialogueDecision.utterance)
    : contextualResponseLine(sourceOutput.visibleAction, localizedBaseSpoken, object, ownObject, location);
  if (sameVisibleObject(object, ownObject)) {
    const bySameObjectTone = {
      惩罚: [
        `${actor}${periodTexture}没有接${source}推来的${object}，反手把它重重按回${surface}。`,
        `${actor}${periodTexture}让${source}推来的${object}停在原处，指节压住边缘。`,
        `${actor}${periodTexture}把${source}递来的${object}拨回两人中间，没有让它换手。`,
      ],
      接近: [
        `${actor}${periodTexture}顺着${source}停住的手往前半步，把${object}压到${surface}。`,
        `${actor}${periodTexture}没有避开${source}，伸手按住${object}的另一边。`,
        `${actor}${periodTexture}贴近${object}的边缘，把它推回${surface}。`,
      ],
      伪装: [
        `${actor}${periodTexture}避开${source}的目光，把${object}压到${surface}。`,
        `${actor}${periodTexture}低头整理袖口，指尖却按住${object}。`,
        `${actor}${periodTexture}把话吞回去，指尖仍压着${object}。`,
      ],
      保护: [
        ownTarget
          ? `${actor}${periodTexture}挡在${source}和${ownTarget}之间，把${object}往外推到${surface}。`
          : `${actor}${periodTexture}挡住${source}和${object}之间的空隙，把${object}往外推到${surface}。`,
        ownTarget
          ? `${actor}${periodTexture}挡住${source}伸向${ownTarget}的手，把${object}推到${surface}外沿。`
          : `${actor}${periodTexture}挡住${source}伸向${object}的手，把${object}往外推到${surface}外沿。`,
        ownTarget
          ? `${actor}${periodTexture}把${ownTarget}拦在身后，先按住${object}的边角，再把它挪到${surface}。`
          : `${actor}${periodTexture}先按住${object}的边角，再把它挪到${surface}。`,
      ],
      陷害: [
        `${actor}${periodTexture}等${source}的手离开${object}，才把它压到${surface}。`,
        `${actor}${periodTexture}故意慢了一拍，让${object}露在外面，又没有把它收走。`,
        `${actor}${periodTexture}看着${source}的手停住，才把${object}留在${surface}。`,
      ],
      自毁: [
        `${actor}${periodTexture}按住${source}推来的${object}，没有替自己收回手。`,
        `${actor}${periodTexture}没有替自己遮掩，把${object}压在明处。`,
        `${actor}${periodTexture}把${object}推回两人中间，像是把退路也推了出去。`,
      ],
      共谋: [
        `${actor}${periodTexture}接住${source}留下的${object}，把它并到${surface}。`,
        `${actor}${periodTexture}顺手压住${object}，没有拆开两个人的手。`,
        `${actor}${periodTexture}没有拆开${object}，只把它贴近${surface}。`,
      ],
      撤退: [
        `${actor}${periodTexture}扣住${source}留下的${object}，只把手往自己身前收。`,
        `${actor}${periodTexture}退开半步，${object}仍留在原处。`,
        `${actor}${periodTexture}让${object}停在${surface}，自己只往回挪。`,
      ],
      求证: [
        `${actor}${periodTexture}指着${source}按住的${object}，把它压回两人中间。`,
        `${actor}${periodTexture}把${object}推到光里，指节停在它的边缘。`,
        `${actor}${periodTexture}没有伸手拿走${object}，只把它推到光里。`,
      ],
      试探: [
        `${actor}${periodTexture}先按住${source}推来的${object}，再把它压到${surface}。`,
        `${actor}${periodTexture}碰了一下${object}的边，才把它慢慢推到${surface}。`,
        `${actor}${periodTexture}没有立刻收手，让${object}停在两人中间。`,
      ],
    };
    const variants = bySameObjectTone[output.tone] || bySameObjectTone.试探;
    const action = variants[stableVariantIndex(contextKey, variants.length)];
    return `${action}${actor}说：“${spoken}”`;
  }
  const byTone = {
    惩罚: [
      `${actor}${periodTexture}没有接${source}推来的${object}，反手把${ownObject}扣到${surface}。`,
      `${actor}${periodTexture}让${source}推来的${object}停在原处，把${ownObject}重重按到${surface}。`,
      `${actor}${periodTexture}把${source}递来的${object}拨回两人中间，又把${ownObject}扣在${surface}。`,
    ],
    接近: [
      `${actor}${periodTexture}顺着${source}停住的手往前半步，把${ownObject}压到${surface}。`,
      `${actor}${periodTexture}没有避开${source}，把${ownObject}推近${object}旁。`,
      `${actor}${periodTexture}贴近${object}的边缘，把${ownObject}放到${surface}。`,
    ],
    伪装: [
      `${actor}${periodTexture}避开${source}的目光，把${ownObject}压到${surface}。`,
      `${actor}${periodTexture}低头整理袖口，把${ownObject}推到${surface}。`,
      `${actor}${periodTexture}把话吞回去，指尖却把${ownObject}压住。`,
    ],
    保护: [
      ownTarget
        ? `${actor}${periodTexture}挡在${source}和${ownTarget}之间，把${ownObject}压到${surface}。`
        : `${actor}${periodTexture}挡住${source}和${object}之间的空隙，把${ownObject}往外推到${surface}。`,
      ownTarget
        ? `${actor}${periodTexture}挡住${source}伸向${ownTarget}的手，把${ownObject}推到${surface}外沿。`
        : `${actor}${periodTexture}挡住${source}伸向${object}的手，把${ownObject}往外推到${surface}外沿。`,
      ownTarget
        ? `${actor}${periodTexture}把${ownTarget}拦在身后，先按住${object}，再把${ownObject}挪到${surface}。`
        : `${actor}${periodTexture}先按住${object}的边角，再把${ownObject}挪到${surface}。`,
    ],
    陷害: [
      `${actor}${periodTexture}等${source}的手离开${object}，才把${ownObject}压到${surface}。`,
      `${actor}${periodTexture}故意慢了一拍，让${object}露在外面，再把${ownObject}按到${surface}。`,
      `${actor}${periodTexture}看着${source}的手停住，才把${ownObject}贴到${object}旁。`,
    ],
    自毁: [
      `${actor}${periodTexture}按住${source}推来的${object}，又把自己的${ownObject}留在原处。`,
      `${actor}${periodTexture}没有替自己遮掩，把${object}和${ownObject}一起压在明处。`,
      `${actor}${periodTexture}把${ownObject}推近${object}，像是把退路也推了出去。`,
    ],
    共谋: [
      `${actor}${periodTexture}接住${source}留下的${object}，把${ownObject}并到${surface}。`,
      `${actor}${periodTexture}顺手压住${object}，又把${ownObject}挪到同一侧。`,
      `${actor}${periodTexture}没有拆开两件东西，只把${ownObject}贴近${object}。`,
    ],
    撤退: [
      `${actor}${periodTexture}扣住${source}留下的${object}，只把${ownObject}往自己身前收。`,
      `${actor}${periodTexture}退开半步，把${ownObject}收回身前，${object}仍留在原处。`,
      `${actor}${periodTexture}让${object}停在${surface}，自己只把${ownObject}往回挪。`,
    ],
    求证: [
      `${actor}${periodTexture}指着${source}按住的${object}，把${ownObject}压回两人中间。`,
      `${actor}${periodTexture}把${ownObject}推到${object}旁，指节停在两件东西之间。`,
      `${actor}${periodTexture}没有伸手拿走${object}，只把${ownObject}推到光里。`,
    ],
    试探: [
      `${actor}${periodTexture}先按住${source}推来的${object}，再把${ownObject}压到${surface}。`,
      `${actor}${periodTexture}碰了一下${object}的边，才把${ownObject}慢慢推到${surface}。`,
      `${actor}${periodTexture}没有立刻收手，把${ownObject}放到${object}旁边。`,
    ],
  };
  const variants = byTone[output.tone] || byTone.试探;
  const action = variants[stableVariantIndex(contextKey, variants.length)];
  return `${action}${actor}说：“${spoken}”`;
}

function quotedSpeechFromVisibleAction(text = "") {
  const match = String(text || "").match(/说：“([^”]+)”/);
  return ensureSpokenPunctuation(match?.[1] || "");
}

function visibleProtectedPerson(location = {}) {
  const name = location?.name || "";
  if (/万灵|医坊/.test(name)) return "伤者";
  if (/归墟|渡/.test(name)) return "被追到水线内的人";
  if (/无咎市|市/.test(name)) return "袖口带血的被庇护人";
  if (/法契|契门|界石/.test(name)) return "被扣押的人";
  if (/照骨司|镜塔|档案/.test(name)) return "供词旁的人";
  return "被庇护的人";
}

function localRelationshipObjectForLocation(object = "", location = {}) {
  const value = localizeVisibleObject(object, location);
  if (!value) return locationProp(location);
  if (objectBelongsToLocation(value, location)) return value;
  if (/^(?:灵契|魔印|毒誓符|一枚符|符|庇护牌|魂灯|剑匣)$/.test(value)) return value;
  return locationProp(location);
}

function retargetRelationshipStateVisibleAction(output, sourceOutput, state, location) {
  const actor = getName(state, output.characterId);
  const source = getName(state, sourceOutput.characterId);
  const relationState = output.relationshipState || {};
  const object = localRelationshipObjectForLocation(
    relationState.sharedObject || interactionSharedObject(sourceOutput, location),
    location,
  );
  const surface = interactionSurface(location);
  const protectedPerson = output.targetCharacterId && output.targetCharacterId !== sourceOutput.characterId
    ? getName(state, output.targetCharacterId)
    : visibleProtectedPerson(location);
  const spoken = output.dialogueDecision?.utterance
    || localizeMockSpokenLine(quotedSpeechFromVisibleAction(output.visibleAction), location, object)
    || spokenDefenseLine(
      state.characters.find((character) => character.id === output.characterId) || { defenseLanguage: [] },
      state.characters.find((character) => character.id === sourceOutput.characterId) || { name: source },
    );
  const byKind = {
    protect: `${actor}把${object}按在${surface}，挡住${source}继续靠近${protectedPerson}。`,
    control: `${actor}把${object}推回${surface}，让${source}的手停在见证处。`,
    bargain: `${actor}把${object}压到${surface}，没有让${source}把价码先写完。`,
    withdraw: `${actor}让${object}停在${surface}，自己退到${source}必须追问的位置。`,
    accuse: `${actor}把${object}留在${surface}，逼${source}先回应证据从谁手里来。`,
    unresolved: `${actor}把${object}留在${surface}，接住${source}刚才那一步。`,
  };
  const action = byKind[relationState.kind] || byKind.unresolved;
  return `${action} ${actor}低声说：“${spoken}”`;
}

function responseBoundaryObject(rule = "", character = {}, location = {}) {
  const explicit = String(rule || "")
    .match(/(?:^|[。；，,])([^。；，,]{1,20}?)(?:不能|不得|不可|必须)/)?.[1]
    ?.trim();
  const candidate = explicit && !/^(?:自己|本人|任何人|所有人|人物)$/.test(explicit)
    ? explicit
    : character.agentProfile?.leverageObject || locationProp(location);
  return localizeVisibleObject(candidate, location);
}

function responseBoundaryViolationKind(rule = "", sourceAction = "", object = "") {
  const boundary = String(rule || "");
  const action = String(sourceAction || "");
  const namesObject = !object || action.includes(object);
  if (!namesObject) return "";
  if (
    /(?:不能|不得|不可)[^。；]{0,24}(?:离开|带走|拿走|收走|换手|交出|移出|流出)/.test(boundary)
    && /带走|拿走|收走|取走|押走|拖走|携走|移出|带离|换手/.test(action)
  ) return "keep_present";
  if (
    /(?:不能|不得|不可)[^。；]{0,24}(?:公开|说出|展示|宣读|泄露)/.test(boundary)
    && /公开|说出|展示|宣读|泄露|摊开|念出/.test(action)
  ) return "prevent_disclosure";
  if (
    /(?:必须|需要)[^。；]{0,24}(?:验明|核对|盖印|登记|见证)[^。；]{0,16}(?:之前|以后|后)/.test(boundary)
    && /带走|拿走|收走|取走|押走|拖走|携走|移出|带离|换手/.test(action)
  ) return "require_procedure";
  return "";
}

function buildResponseBoundaryDecision(output, sourceOutput, state, location) {
  const character = state.characters.find((item) => item.id === output.characterId) || {};
  const rule = String(character.agentProfile?.responseBoundary || "").trim();
  if (!rule) return null;
  const object = responseBoundaryObject(rule, character, location);
  const violationKind = responseBoundaryViolationKind(rule, sourceOutput?.visibleAction, object);
  if (!violationKind) return null;
  return {
    kind: "enforce_response_boundary",
    violationKind,
    rule,
    object,
    responderGoal: output.realtimePublicGoal || output.privatePublicGoal || character.agentProfile?.dramaticObjective || "",
    triggeredByMemoryId: output.memoryId || null,
    previousRelationshipOutcome: output.relationshipDialogueMemory?.eventOutcome || "",
    sourceOutputId: sourceOutput?.outputId || "",
  };
}

function enforceResponseBoundaryVisibleAction(decision, output, sourceOutput, state, location) {
  const actor = getName(state, output.characterId);
  const source = getName(state, sourceOutput.characterId);
  const object = decision.object || locationProp(location);
  const surface = interactionSurface(location);
  const spoken = ensureSpokenPunctuation(output.dialogueDecision?.utterance || decision.rule);
  return `${actor}挡住${source}伸向${object}的手，把${object}压回${surface}。${actor}说：“${spoken}”`;
}

function connectOutputToPreviousAgent(output, sourceOutput, state, location, simulationTick = null) {
  if (!sourceOutput) return output;
  const ownCandidateBeforeResponse = output.visibleAction || "";
  const ownPublicGoalBeforeResponse = output.realtimePublicGoal || output.privatePublicGoal || "";
  const ownTargetCharacterIdBeforeResponse = output.targetCharacterId || "";
  const ownTargetNameBeforeResponse = ownTargetCharacterIdBeforeResponse
    ? getName(state, ownTargetCharacterIdBeforeResponse)
    : "";
  const ownObjectBeforeResponse = localizeVisibleObject(
    output.realtimeLeverageObject || output.privateLeverageObject || extractActionObject(ownCandidateBeforeResponse, location),
    location,
  );
  const boundaryDecision = buildResponseBoundaryDecision(output, sourceOutput, state, location);
  const relationshipTargetMatchesSource = output.relationshipState && output.targetCharacterId === sourceOutput.characterId;
  const visibleAction = boundaryDecision
    ? enforceResponseBoundaryVisibleAction(boundaryDecision, output, sourceOutput, state, location)
    : relationshipTargetMatchesSource
      ? output.visibleAction
      : output.relationshipState
        ? retargetRelationshipStateVisibleAction(output, sourceOutput, state, location)
        : rewriteVisibleActionAsResponse(output, sourceOutput, state, location, simulationTick);
  const sharedObject = interactionSharedObject(sourceOutput, location);
  return {
    ...output,
    targetCharacterId: sourceOutput.characterId,
    visibleAction,
    realtimeActionCandidate: visibleAction,
    interactionInput: {
      sourceCharacterId: sourceOutput.characterId,
      sourceOutputId: sourceOutput.outputId,
      sourceTone: sourceOutput.tone,
      observedVisibleAction: sourceOutput.visibleAction,
      observedDialogueTurnId: sourceOutput.dialogueDecision?.turnId || "",
      observedUtterance: sourceOutput.dialogueDecision?.utterance || "",
      ownCandidateBeforeResponse,
      ownPublicGoalBeforeResponse,
      ownObjectBeforeResponse,
      ownTargetCharacterIdBeforeResponse,
      ownTargetNameBeforeResponse,
      sharedObject,
      responseBoundaryBeforeResponse: boundaryDecision?.rule || "",
      boundaryTriggeredByMemoryId: boundaryDecision?.triggeredByMemoryId || null,
    },
    boundaryDecision,
    reactsToOutputId: sourceOutput.outputId,
    responseToCharacterId: sourceOutput.characterId,
    hiddenAction: `${output.hiddenAction}；${getName(state, output.characterId)}临场接住${getName(state, sourceOutput.characterId)}刚刚做出的动作。${boundaryDecision ? ` ${getName(state, output.characterId)}不肯越过自己的边界：${boundaryDecision.rule}` : ""}`,
    possibleEvidenceLeft: sameVisibleObject(sharedObject, extractActionObject(ownCandidateBeforeResponse, location))
      ? `${location.name}留下：${sharedObject}被压在同一处`
      : `${location.name}留下：${sharedObject}和${extractActionObject(ownCandidateBeforeResponse, location)}被压在同一处`,
  };
}

function interactionSharedObject(sourceOutput = {}, location = {}) {
  const locationDefault = locationProp(location);
  const extracted = extractActionObject(sourceOutput.visibleAction, location);
  if (objectBelongsToLocation(extracted, location)) return extracted;
  if (sourceOutput.conductorSignal?.object && objectBelongsToLocation(sourceOutput.conductorSignal.object, location)) {
    return sourceOutput.conductorSignal.object;
  }

  const dialogue = sourceOutput.relationshipDialogueMemory || null;
  const relationshipObject = sourceOutput.relationshipDialogueMemory?.sharedObject
    || sourceOutput.relationshipDialogueMemory?.conductorSignal?.object
    || "";
  if (
    relationshipObject
    && (
      objectBelongsToLocation(relationshipObject, location)
      || (location?.id && dialogue?.locationId === location.id)
      || (location?.name && dialogue?.locationName === location.name)
    )
  ) {
    return relationshipObject;
  }
  if (extracted && extracted !== locationDefault) return extracted;
  return sourceOutput.conductorSignal?.object || extracted || locationDefault;
}

function applyConductorSignalToAgentOutput(output, conductorSignal = null, state = {}, location = {}) {
  if (!conductorSignal?.inWorldClue || output.interactionRole !== "initiator") return output;
  const actorName = getName(state, output.characterId);
  const baseAction = output.visibleAction || `${actorName}停了一下。`;
  const visibleAction = `${ensureNarrativeSentence(conductorSignal.inWorldClue)} ${baseAction}`;
  return {
    ...output,
    visibleAction,
    realtimeActionCandidate: visibleAction,
    hiddenAction: `${output.hiddenAction}；${actorName}先被${conductorSignal.object}旁的变化牵住。`,
    possibleEvidenceLeft: `${output.possibleEvidenceLeft}；${location.name}还留下：${conductorSignal.pressureCue}`,
    conductorSignal: {
      beatId: conductorSignal.beatId,
      delivery: conductorSignal.delivery,
      inWorldClue: conductorSignal.inWorldClue,
      object: conductorSignal.object,
      pressureCue: conductorSignal.pressureCue,
      target: conductorSignal.target,
    },
  };
}

function recentDialogueLinesForCharacter(state = {}, characterId = "") {
  const lines = [];
  for (const relationship of state.relationships || []) {
    if (relationship.fromCharacterId !== characterId && relationship.toCharacterId !== characterId) continue;
    const dialogues = [
      ...(Array.isArray(relationship.dialogueHistory) ? relationship.dialogueHistory : []),
      relationship.lastDialogue,
    ].filter(Boolean);
    for (const dialogue of dialogues) {
      for (const turn of dialogue.dialogueTurns || []) {
        if (turn?.speakerId === characterId && turn?.line) lines.push(turn.line);
      }
    }
  }
  const drafts = Array.isArray(state.draftScenes) ? state.draftScenes.slice(-4) : [];
  for (const draft of drafts) {
    const interactions = [
      draft.sceneInteraction,
      ...(draft.periodSimulation?.ticks || []).map((tick) => tick.sceneInteraction),
    ].filter(Boolean);
    for (const interaction of interactions) {
      for (const exchange of interaction.agentExchanges || []) {
        for (const turn of exchange.dialogueTurns || []) {
          if (turn?.speakerId === characterId && turn?.line) lines.push(turn.line);
        }
      }
    }
  }
  return lines.slice(-24);
}

function sharedDialogueLinesForCast(characters = []) {
  const speakersByLine = new Map();
  for (const character of characters || []) {
    const lines = [
      ...(Array.isArray(character.agentProfile?.dialogueMoves) ? character.agentProfile.dialogueMoves : []),
      ...(Array.isArray(character.defenseLanguage) ? character.defenseLanguage : []),
    ];
    for (const value of lines) {
      const line = String(value || "").replace(/[“”"「」]/g, "").trim();
      if (!line) continue;
      if (!speakersByLine.has(line)) speakersByLine.set(line, new Set());
      speakersByLine.get(line).add(character.id);
    }
  }
  return [...speakersByLine.entries()].filter(([, speakers]) => speakers.size > 1).map(([line]) => line);
}

function runAgentInteractionLoop({ localState, simulationTick, activeCharacters, location, conductorSignal = null }) {
  const exchangeId = createId("exchange");
  const sharedDialogueLines = sharedDialogueLinesForCast(localState.characters || activeCharacters);
  const baseOutputs = activeCharacters.map((character, index) => {
    const base = characterAgent({ state: localState, character, activeCharacters, location });
    const enriched = enrichWithSimulation(base, simulationTick);
    const intervened = applyInterventionsToAgentOutput(enriched, localState);
    const physicalOnly = {
      ...intervened,
      visibleAction: makeActionLineWithoutDialogue(intervened, localState),
    };
    const withIdentity = createAgentOutputIdentity({
      ...physicalOnly,
      dialogueTopic: extractActionObject(physicalOnly.visibleAction || "", location),
      recentDialogueLines: recentDialogueLinesForCharacter(localState, character.id),
      sharedDialogueLines,
    }, exchangeId, index);
    return applyConductorSignalToAgentOutput(withIdentity, conductorSignal, localState, location);
  });
  const cognitiveFrame = buildAgentCognitiveFrame({
    state: localState,
    location,
    activeCharacters,
    privateSimulations: simulationTick.privateSimulations || [],
    agentOutputs: baseOutputs,
  });
  simulationTick.cognitiveFrame = cognitiveFrame;
  const outputsById = new Map(baseOutputs.map((output) => {
    const cognitiveDecision = cognitiveFrame.decisions.find((decision) => decision.characterId === output.characterId) || null;
    const currentActivity = cognitiveFrame.activities.find((activity) => activity.characterId === output.characterId) || null;
    return [output.characterId, {
      ...output,
      cognitiveDecision,
      currentActivity,
      reactionIntent: cognitiveDecision?.reaction || "continue",
      reactionReason: cognitiveDecision?.reason || "",
    }];
  }));
  for (const conversation of cognitiveFrame.conversations) {
    const sourceOutput = outputsById.get(conversation.sourceCharacterId);
    const responseOutput = outputsById.get(conversation.responseCharacterId);
    if (!sourceOutput || !responseOutput) continue;
    const sourceCharacter = localState.characters.find((item) => item.id === conversation.sourceCharacterId) || {};
    const responseCharacter = localState.characters.find((item) => item.id === conversation.responseCharacterId) || {};
    // The deterministic path used to stage a full dialogue exchange here.  It
    // had no generator to constrain, only fixed string banks, so every
    // character spoke in the same clipped register and the authored-looking
    // lines turned out to be one shared fallback array.  A voice is a
    // constraint on generation (see `characterVoiceHabits.mjs`), not a bank of
    // lines, so this path reports the encounter and its consequence and leaves
    // speech to the pipelines that can actually generate it.
    const connectedResponse = connectOutputToPreviousAgent(responseOutput, sourceOutput, localState, location, simulationTick);
    outputsById.set(sourceOutput.characterId, sourceOutput);
    outputsById.set(responseOutput.characterId, {
      ...connectedResponse,
      conversationSharedObjective: conversation.objective,
      conversationEndCondition: conversation.endCondition,
      conversationMaxTurns: conversation.maxTurns,
    });
  }
  // Visible-action templates across this engine append `X说：“…”` built from the
  // same fixed string banks.  Stripping the speech clause at the single point
  // where local outputs converge keeps the deterministic path out of the
  // dialogue business without leaving eight templates to drift back into it.
  return activeCharacters
    .map((character) => outputsById.get(character.id))
    .filter(Boolean)
    .map((output) => {
      const visibleAction = stripStagedSpeech(output.visibleAction, output, localState);
      return visibleAction === output.visibleAction ? output : { ...output, visibleAction };
    });
}

function stripStagedSpeech(value = "", output = {}, state = {}) {
  const raw = String(value || "").trim();
  if (!raw || !/说：[“"]/.test(raw)) return raw;
  // A character enforcing their own responseBoundary is speaking their own
  // authored rule, not a staged bank line; the boundary must survive.
  const boundaryRule = String(output.boundaryDecision?.rule || "").trim();
  if (boundaryRule && raw.includes(boundaryRule)) return raw;
  const withoutSpeech = raw
    .replace(/[^。！？…]*?说：[“"][^”"]*[”"][。！？…]?/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (withoutSpeech) return ensureNarrativeSentence(withoutSpeech);
  const character = (state.characters || []).find((item) => item.id === output.characterId);
  return `${character?.name || output.characterName || output.characterId || "有人"}没有开口。`;
}


function makeLine(action, state) {
  const visible = String(action.visibleAction || "").replace(/\s+/g, " ").trim();
  if (visible) return ensureNarrativeSentence(visible);
  const character = state.characters.find((item) => item.id === action.characterId);
  return `${character?.name || action.characterId}停了一下。`;
}

function makeActionLineWithoutDialogue(action, state) {
  const raw = String(action.visibleAction || "").replace(/\s+/g, " ").trim();
  const withoutSpeech = raw
    .replace(/[^。！？…]*?说：“[^”]*”[。！？…]?/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (withoutSpeech) return ensureNarrativeSentence(withoutSpeech);
  const character = state.characters.find((item) => item.id === action.characterId);
  return `${character?.name || action.characterId}手停在原处。`;
}

function relationshipPairKey(shift = {}) {
  return `${shift.fromCharacterId || ""}->${shift.toCharacterId || ""}`;
}

function dialogueRelationshipPairs(sceneInteraction = null) {
  return new Set((sceneInteraction?.agentRelationshipShifts || [])
    .filter((shift) => shift?.generatedFrom === "agent-dialogue-relationship")
    .map(relationshipPairKey));
}

function ensureNarrativeSentence(text = "") {
  const cleaned = String(text || "").trim();
  if (!cleaned) return "";
  return /[。！？…][”」』）】〕》]?$/.test(cleaned) ? cleaned : `${cleaned}。`;
}

function quoteDialogueLine(text = "") {
  return ensureNarrativeSentence(String(text || "").replace(/[“”"「」]/g, "").trim());
}

function turnSpeakerName(turn = {}, exchange = {}, state = {}) {
  if (turn.speakerName) return turn.speakerName;
  if (turn.speakerId === exchange.sourceCharacterId || turn.speakerId === exchange.actorId) {
    return exchange.sourceCharacterName || exchange.actorName || getName(state, turn.speakerId);
  }
  if (turn.speakerId === exchange.responseCharacterId || turn.speakerId === exchange.targetId) {
    return exchange.responseCharacterName || exchange.targetName || getName(state, turn.speakerId);
  }
  return turn.speakerId ? getName(state, turn.speakerId) : "有人";
}

function bridgeLineFromPreviousExchange(exchange = {}, previousExchange = null, state = {}, fallbackObject = "场中的东西") {
  if (!previousExchange) return "";
  const previousTurns = Array.isArray(previousExchange.dialogueTurns) ? previousExchange.dialogueTurns : [];
  const previousResponse = previousTurns[1] || previousTurns.find((turn) => turn?.speakerId === previousExchange.responseCharacterId || turn?.speakerId === previousExchange.targetId) || previousTurns.at?.(-1);
  if (!previousResponse?.line) return "";
  const currentParticipants = [
    { id: exchange.sourceCharacterId || exchange.actorId, name: exchange.sourceCharacterName || exchange.actorName || getName(state, exchange.sourceCharacterId || exchange.actorId) },
    { id: exchange.responseCharacterId || exchange.targetId, name: exchange.responseCharacterName || exchange.targetName || getName(state, exchange.responseCharacterId || exchange.targetId) },
  ].filter((item) => item.id || item.name);
  const previousParticipantIds = new Set([
    previousExchange.sourceCharacterId || previousExchange.actorId,
    previousExchange.responseCharacterId || previousExchange.targetId,
  ].filter(Boolean));
  const previousParticipantNames = new Set([
    previousExchange.sourceCharacterName || previousExchange.actorName,
    previousExchange.responseCharacterName || previousExchange.targetName,
  ].filter(Boolean));
  const bridgeParticipant = currentParticipants.find((item) => !previousParticipantIds.has(item.id) && !previousParticipantNames.has(item.name)) || currentParticipants[1] || currentParticipants[0] || {};
  const targetName = bridgeParticipant.name || exchange.responseCharacterName || exchange.targetName || getName(state, exchange.responseCharacterId || exchange.targetId);
  const previousSpeaker = turnSpeakerName(previousResponse, previousExchange, state);
  const sharedObject = exchange.sharedObject || fallbackObject;
  const heardLine = String(previousResponse.line || "")
    .replace(/[。！？…]+$/g, "")
    .split(/[；。！？]/)[0]
    .slice(0, 24);
  if (!targetName || !previousSpeaker || targetName === previousSpeaker) return "";
  const targetStake = (exchange.dialogueTurns || [])
    .map((turn) => turn?.line || "")
    .find((line) => /庇护牌|伤者|救命|人名|药炉|价码|旧案|账册|镜|供词|水线|渡令|魂灯/.test(line)) || "";
  if (/庇护牌|伤者|救命|人名|药炉/.test(targetStake)) {
    return `${targetName}听见${previousSpeaker}刚才那句，指尖没有离开庇护牌。`;
  }
  if (/价码|旧案|账册/.test(targetStake)) {
    return `${targetName}接住${previousSpeaker}刚才那句，把价码和${sharedObject}一起留在明处。`;
  }
  if (/镜|供词|案卷|灵痕/.test(targetStake)) {
    return `${targetName}听见${previousSpeaker}那句，镜面还没有把记录合上。`;
  }
  if (/水线|渡令|渡口/.test(targetStake)) {
    return `${targetName}听见${previousSpeaker}那句，水线没有让开。`;
  }
  if (/魂灯|死人|供词/.test(targetStake)) {
    return `${targetName}听见${previousSpeaker}那句，魂灯仍亮在旁边。`;
  }
  return `${targetName}听见${previousSpeaker}刚才那句“${heardLine}”，没有退到场外。`;
}

function observableExchangeLine(exchange = {}, state = {}, fallbackObject = "场中的东西", previousExchange = null) {
  const turns = Array.isArray(exchange.dialogueTurns) ? exchange.dialogueTurns : [];
  if (!turns.length && !exchange.eventOutcome) return "";
  const sourceName = exchange.sourceCharacterName || exchange.actorName || getName(state, exchange.sourceCharacterId || exchange.actorId);
  const targetName = exchange.responseCharacterName || exchange.targetName || getName(state, exchange.responseCharacterId || exchange.targetId);
  const sharedObject = exchange.sharedObject || fallbackObject;
  const bridge = bridgeLineFromPreviousExchange(exchange, previousExchange, state, fallbackObject);
  const interjectionIndex = turns.findIndex((turn) => turn?.turnRole === "third_party_interjection");
  const interjectionBridge = interjectionIndex > 0
    ? `${turnSpeakerName(turns[interjectionIndex], exchange, state)}听见${turnSpeakerName(turns[interjectionIndex - 1], exchange, state)}刚才那句，插进两人的话里。`
    : "";
  const dialogue = turns
    .map((turn) => {
      const line = quoteDialogueLine(turn.line || "");
      if (!line) return "";
      return `${turnSpeakerName(turn, exchange, state)}说：“${line}”`;
    })
    .filter(Boolean)
    .join("");
  return [
    bridge || `${sourceName}和${targetName}停在${sharedObject}旁边。`,
    interjectionBridge,
    dialogue,
    ensureNarrativeSentence(exchange.eventOutcome || ""),
  ].filter(Boolean).join(" ");
}

function observableExchangeLines(sceneInteraction = null, state = {}, fallbackObject = "场中的东西") {
  return (sceneInteraction?.agentExchanges || [])
    .map((exchange, index, exchanges) => observableExchangeLine(exchange, state, fallbackObject, exchanges[index - 1] || null))
    .filter(Boolean);
}

function locationPressureOpening(location = {}, prop = "凭证") {
  const place = location?.name || "";
  if (/法契|契门|界石/.test(place)) return `界石下的铜盘泛着冷光，${prop}旁还空着一枚印位。`;
  if (/无咎市|市/.test(place)) return `摊灯照着账册的空白页，${prop}旁的铜夹半开着。`;
  if (/照骨司|镜塔|档案/.test(place)) return `照骨镜下压着一角封条，${prop}映出一圈浅光。`;
  if (/归墟|渡/.test(place)) return `水线贴着石阶往后退了半寸，${prop}旁的潮气没有散。`;
  if (/万灵|医坊/.test(place)) return `药炉火光低低一跳，${prop}旁的药香压住了血腥气。`;
  if (/停剑|茶楼/.test(place)) return `茶盏轻轻一响，${prop}旁的桌面还留着一圈水痕。`;
  return `${place || "场中"}的光线压低了一寸，${prop}旁没人先伸手。`;
}

function looksLikeMechanicalObjectOpening(event = "", prop = "凭证") {
  const text = String(event || "").trim();
  if (!text) return false;
  const namesObject = prop && text.includes(prop);
  return namesObject && /被(?:破|推到|扣到|压到|留在|押在|按到|截住|封上|扣在)/.test(text);
}

function visibleLocationOpening(location = {}, prop = "凭证") {
  if (location.visibleUse && !looksLikeMechanicalObjectOpening(location.visibleUse, prop)) return ensureNarrativeSentence(location.visibleUse);
  return locationPressureOpening(location, prop);
}

function synthesizeScene({ state, agentOutputs, location, simulationTick = null, sceneInteraction = null }) {
  const activeNames = agentOutputs.map((output) => getName(state, output.characterId));
  const eventDirective = state.ui?.injectedEvent?.trim();
  const activeInterventions = activeInterventionsForState(state);
  const interventionLine = activeInterventions.length ? `操盘干预正在改变人物内在动作：${activeInterventions.map((item) => summarizeIntervention(item, state)).join("；")}。` : "";
  const prop = locationProp(location);
  const directiveLine = eventDirective ? `意外事件先抵达：${eventDirective}。` : visibleLocationOpening(location, prop);
  const surfaceEvent = `${activeNames.join("、") || "几个人"}在${location.name}围着${prop}停住`;
  const exchangeLines = observableExchangeLines(sceneInteraction, state, prop);
  const beats = exchangeLines.length
    ? agentOutputs.map((output) => makeActionLineWithoutDialogue(output, state))
    : agentOutputs.map((output) => makeLine(output, state));
  const sceneTail = exchangeLines.length ? "" : `${prop}没有被立刻收回。`;

  const sceneText = [
    `【${location.name}】`,
    directiveLine,
    interventionLine,
    `${activeNames.join("、") || "几个人"}停在${prop}旁。`,
    ...beats,
    ...exchangeLines,
    sceneTail,
  ].filter(Boolean).join("\n");

  const subtextMatrix = agentOutputs.map((output) => {
    const character = getName(state, output.characterId);
    return {
      speakerId: output.characterId,
      speaker: character,
      line: extractLine(output.visibleAction),
      surface: output.visibleAction,
      hiddenAction: output.hiddenAction,
      speakerWants: output.wantsFromOthers,
      listenerMisreads: `${getName(state, output.targetCharacterId)}可能把这理解成${output.tone === "保护" ? "关照，也可能理解成占有" : output.tone === "惩罚" ? "标准，也可能理解成报复" : "普通交流，也可能理解成信号"}。`,
    };
  });

  const dialoguePairs = dialogueRelationshipPairs(sceneInteraction);
  const genericToneShifts = agentOutputs
    .flatMap((output) => buildRelationshipShift(state, output))
    .filter((shift) => !dialoguePairs.has(relationshipPairKey(shift)));
  const mutationIntentShifts = (sceneInteraction?.relationshipMutationIntents || [])
    .map((item) => ({ fromCharacterId: item.fromCharacterId, toCharacterId: item.toCharacterId, deltas: { deception: 2, wantsToBeSeen: 2, shame: 1 }, misreading: item.mutation, unspoken: item.expectedDelta }))
    .filter((shift) => !dialoguePairs.has(relationshipPairKey(shift)));
  const relationshipShift = [
    ...genericToneShifts,
    ...(sceneInteraction?.agentRelationshipShifts || []),
    ...mutationIntentShifts,
    ...buildInterventionRelationshipShifts(state, agentOutputs.map((output) => output.characterId)),
  ];
  const irreversibleTraces = [
    ...agentOutputs.map((output) => output.possibleEvidenceLeft),
    ...(sceneInteraction?.visibilityFlips || []).map((item) => `可见性翻转：${item.characterName}的盲点可能被暴露——${item.blindSpot}`),
    ...activeInterventions.map((item) => `操盘干预留下痕迹：${summarizeIntervention(item, state)}`),
  ];

  return {
    surfaceEvent,
    sceneText,
    subtextMatrix,
    relationshipShift,
    irreversibleTraces,
    sceneInteraction: sceneInteraction || null,
  };
}

function extractLine(text) {
  if (!text) return "沉默。";
  if (text.length < 32) return text;
  return text.slice(0, 32) + "……";
}

function buildRelationshipShift(state, output) {
  const tone = output.tone;
  const deltasByTone = {
    惩罚: { resentment: 7, shame: 5, wantsToBeSeen: 3, revenge: 4, fear: 2 },
    接近: { attraction: 5, dependence: 4, shame: 3, deception: 2, wantsToBeSeen: 4 },
    伪装: { deception: 6, fear: 2, wantsToEscape: 3, shame: 3 },
    保护: { protection: 7, dependence: 3, wantsToPossess: 3, shame: 2 },
    试探: { wantsToBeSeen: 5, deception: 3, attraction: 2, resentment: 2 },
  };
  const deltas = deltasByTone[tone] || deltasByTone.试探;
  const actor = state.characters.find((item) => item.id === output.characterId);
  const target = state.characters.find((item) => item.id === output.targetCharacterId);
  return [
    {
      fromCharacterId: output.characterId,
      toCharacterId: output.targetCharacterId,
      deltas,
      misreading: `${actor.name}把${target.name}的反应读成自己内心法庭的一部分。`,
      unspoken: output.wantsFromOthers,
    },
    {
      fromCharacterId: output.targetCharacterId,
      toCharacterId: output.characterId,
      deltas: invertDeltas(deltas),
      misreading: `${target.name}开始怀疑${actor.name}的表面行动是否只是一层伪装。`,
      unspoken: output.desiredEmotionalResponse,
    },
  ];
}

function invertDeltas(deltas) {
  const next = {};
  for (const [key, value] of Object.entries(deltas)) {
    if (["resentment", "fear", "shame", "revenge", "deception", "wantsToEscape"].includes(key)) next[key] = clamp(value + 1, -10, 10);
    else next[key] = clamp(Math.ceil(value / 2), -10, 10);
  }
  return next;
}

function isPeriodGrain(grain) {
  return grain === "day" || grain === "week";
}

function periodSlotsForGrain(grain) {
  if (grain === "week") {
    return [
      { label: "周一", focus: "行政桌上多出一份错投材料" },
      { label: "周二", focus: "走廊窗台压着两张不同说法的纸" },
      { label: "周三", focus: "档案柜旁有人停下笔" },
      { label: "周四", focus: "奖章盒被推到会议桌边" },
      { label: "周五", focus: "流程章旁多了一只没收回的手套" },
      { label: "周末", focus: "空教室门缝下露出一张便条" },
    ];
  }
  return [
    { label: "上午", focus: "入口处的灯先亮起来" },
    { label: "中午", focus: "几本账册被翻到空白页" },
    { label: "下午", focus: "柜台边有人停下笔" },
    { label: "傍晚", focus: "门槛上多了两道脚印" },
    { label: "夜间", focus: "夜灯下还压着没收走的凭证" },
  ];
}

function uniqueById(items) {
  const seen = new Set();
  const result = [];
  for (const item of items || []) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
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

function relationshipDialogueFromShift(shift = {}) {
  const dialogueTurns = normalizeDialogueTurnsForRelationship(shift.dialogueTurns);
  const triggeredBy = String(shift.triggeredBy || shift.conductorSignal?.inWorldClue || "").trim();
  const hasDialogueTrace = [
    shift.sharedObject,
    shift.eventOutcome,
    shift.finalTurn,
    shift.followupTurn,
    shift.dialogueTurnCount,
    dialogueTurns.length,
    shift.generatedFrom === "agent-dialogue-relationship" || shift.generatedFrom === "model-agent-dialogue",
  ].some(Boolean);
  if (!hasDialogueTrace) return null;
  return {
    source: shift.generatedFrom || shift.relationshipSource || "relationship-shift",
    relationshipSource: shift.relationshipSource || "",
    sharedObject: shift.sharedObject || "",
    eventOutcome: shift.eventOutcome || shift.unspoken || "",
    finalTurn: shift.finalTurn || "",
    followupTurn: shift.followupTurn || "",
    dialogueTurnCount: Number(shift.dialogueTurnCount || dialogueTurns.length || 0),
    dialogueTurns,
    triggeredBy,
    conductorSignal: shift.conductorSignal || null,
    relationshipDialogueAct: shift.relationshipDialogueAct || null,
    locationId: shift.locationId || "",
    locationName: shift.locationName || "",
    periodSlot: shift.periodSlot || "",
    updatedAt: new Date().toISOString(),
  };
}

function appendRelationshipDialogueHistory(rel, dialogue) {
  if (!dialogue) return;
  const previous = Array.isArray(rel.dialogueHistory) ? rel.dialogueHistory : [];
  const signature = [
    dialogue.sharedObject,
    dialogue.eventOutcome,
    dialogue.finalTurn,
    dialogue.followupTurn,
    dialogue.triggeredBy,
    dialogue.locationId,
    dialogue.periodSlot,
  ].join("|");
  const withoutDuplicate = previous.filter((item) => [
    item.sharedObject,
    item.eventOutcome,
    item.finalTurn,
    item.followupTurn,
    item.triggeredBy,
    item.locationId,
    item.periodSlot,
  ].join("|") !== signature);
  rel.dialogueHistory = [...withoutDuplicate, dialogue].slice(-12);
}

function createLocalRelationship(state, shift = {}) {
  return {
    id: createId("rel"),
    projectId: state.project?.id,
    fromCharacterId: shift.fromCharacterId,
    toCharacterId: shift.toCharacterId,
    love: 10,
    attraction: 10,
    resentment: 10,
    fear: 10,
    dependence: 10,
    power: 10,
    shame: 10,
    jealousy: 0,
    protection: 10,
    revenge: 0,
    deception: 10,
    wantsToBeSeen: 10,
    wantsToPossess: 0,
    wantsToEscape: 10,
    wantsToDestroy: 0,
    misreading: "",
    unspoken: "",
    evidenceIds: [],
  };
}

function applyPeriodBundleToLocalState(state, updateBundle = {}) {
  const next = {
    ...state,
    characters: deepClone(state.characters || []),
    relationships: deepClone(state.relationships || []),
    characterMemories: deepClone(state.characterMemories || []),
    characterPlans: deepClone(state.characterPlans || []),
    townStateLedger: deepClone(state.townStateLedger || []),
    rumors: deepClone(state.rumors || []),
    evidence: deepClone(state.evidence || []),
    irreversibleTraces: deepClone(state.irreversibleTraces || []),
    stateChangeReasons: deepClone(state.stateChangeReasons || []),
  };

  if (Array.isArray(updateBundle.characters)) {
    const patches = new Map(updateBundle.characters.map((patch) => [patch.id, patch]));
    next.characters = next.characters.map((character) => {
      const patch = patches.get(character.id);
      if (!patch) return character;
      return {
        ...character,
        currentState: { ...(character.currentState || {}), ...(patch.currentState || {}) },
        ...(Object.prototype.hasOwnProperty.call(patch, "agentMemory") ? { agentMemory: deepClone(patch.agentMemory) } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "currentActivity") ? { currentActivity: patch.currentActivity } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "previousLocationId") ? { previousLocationId: patch.previousLocationId } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "currentLocationId") ? { currentLocationId: patch.currentLocationId } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "inTransit") ? { inTransit: patch.inTransit } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "lastPresenceDecision") ? { lastPresenceDecision: patch.lastPresenceDecision } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "lastMovementReason") ? { lastMovementReason: patch.lastMovementReason } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "lastPresenceDraftId") ? { lastPresenceDraftId: patch.lastPresenceDraftId } : {}),
      };
    });
  }

  if (Array.isArray(updateBundle.relationships)) {
    for (const shift of updateBundle.relationships) {
      if (!shift?.fromCharacterId || !shift?.toCharacterId) continue;
      let rel = next.relationships.find((item) => item.fromCharacterId === shift.fromCharacterId && item.toCharacterId === shift.toCharacterId);
      if (!rel) {
        rel = createLocalRelationship(next, shift);
        next.relationships.push(rel);
      }
      for (const [key, delta] of Object.entries(shift.deltas || {})) {
        if (typeof rel[key] === "number") rel[key] = clamp(rel[key] + Number(delta), 0, 100);
      }
      if (shift.misreading) rel.misreading = shift.misreading;
      if (shift.unspoken) rel.unspoken = shift.unspoken;
      const lastDialogue = relationshipDialogueFromShift(shift);
      if (lastDialogue) {
        rel.lastDialogue = { ...(rel.lastDialogue || {}), ...lastDialogue };
        appendRelationshipDialogueHistory(rel, rel.lastDialogue);
      }
      const relationshipArc = buildRelationshipArcFromShift(shift, rel.relationshipArc || null);
      if (relationshipArc) rel.relationshipArc = relationshipArc;
    }
  }

  if (Array.isArray(updateBundle.characterMemories)) next.characterMemories.unshift(...deepClone(updateBundle.characterMemories));
  if (Array.isArray(updateBundle.townStateLedger)) next.townStateLedger.unshift(...deepClone(updateBundle.townStateLedger));
  if (Array.isArray(updateBundle.characterPlans)) {
    const patches = new Map(updateBundle.characterPlans.map((patch) => [patch.id || patch.characterId, patch]));
    next.characterPlans = ensureCharacterPlans(next).map((plan) => {
      const patch = patches.get(plan.id) || patches.get(plan.characterId);
      return patch ? { ...plan, ...patch, id: plan.id, characterId: plan.characterId } : plan;
    });
  }
  if (Array.isArray(updateBundle.rumors)) next.rumors.unshift(...deepClone(updateBundle.rumors));
  if (Array.isArray(updateBundle.evidence)) next.evidence.unshift(...deepClone(updateBundle.evidence));
  if (Array.isArray(updateBundle.irreversibleTraces)) next.irreversibleTraces.unshift(...deepClone(updateBundle.irreversibleTraces));
  if (Array.isArray(updateBundle.stateChangeReasons)) next.stateChangeReasons.unshift(...deepClone(updateBundle.stateChangeReasons));
  return next;
}

function buildTickDraftForUpdate(state, tick = {}) {
  return {
    id: tick.id || createId("period_tick_draft"),
    projectId: state.project?.id,
    branchId: state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main",
    createdAt: new Date().toISOString(),
    timeGrain: "period-slot",
    locationId: tick.locationId,
    participantIds: tick.participantIds || [],
    agentOutputs: tick.agentOutputs || [],
    relationshipShift: tick.synthesized?.relationshipShift || tick.sceneInteraction?.agentRelationshipShifts || [],
    irreversibleTraces: tick.synthesized?.irreversibleTraces || [],
    interventionsApplied: (tick.agentOutputs || []).flatMap((output) => output.appliedInterventions || []),
    audit: { safeClosureRisk: 35 },
  };
}

function orderedLocations(state, selectedLocation) {
  const locations = Array.isArray(state.locations) && state.locations.length ? state.locations : [selectedLocation];
  return uniqueById([
    selectedLocation,
    ...locations.filter((location) => location.id !== selectedLocation.id),
  ]);
}

function chooseLocationForSlot(state, locations, slotIndex, focus = null) {
  if (!locations.length) return getLocation({ locations, ui: {} });
  const periodIndex = Math.max(0, (state.canonEvents || []).length);
  const regular = locations[(slotIndex + periodIndex * 5) % locations.length];
  if (focus?.mode === "location") {
    if (slotIndex === 0) return locations.find((location) => location.id === focus.locationId) || regular;
    const nonFocused = locations.filter((location) => location.id !== focus.locationId);
    return nonFocused[(slotIndex - 1 + periodIndex * 3) % Math.max(nonFocused.length, 1)] || regular;
  }
  const byId = new Map((state.characters || []).map((character) => [character.id, character]));
  if (slotIndex === 0) {
    const openingCandidate = openingHotDialogueRelationshipCandidate(state, byId, locations);
    if (openingCandidate?.hotLocation) return openingCandidate.hotLocation;
  }
  return regular;
}

function hotDialogueRelationshipCandidates(state, byId) {
  const candidates = new Map();
  const addCandidate = ({ fromCharacterId, toCharacterId, score = 0, reason = "", sharedObject = "", locationId = "", locationName = "", text = "" }) => {
    if (!fromCharacterId || !toCharacterId || fromCharacterId === toCharacterId) return;
    if (!byId.has(fromCharacterId) || !byId.has(toCharacterId)) return;
    const key = `${fromCharacterId}->${toCharacterId}`;
    const previous = candidates.get(key);
    const next = { fromCharacterId, toCharacterId, score, reason, sharedObject, locationId, locationName, text, key };
    if (!previous || next.score > previous.score) candidates.set(key, next);
  };

  for (const rel of state.relationships || []) {
    if (!rel?.lastDialogue) continue;
    const dialogue = rel.lastDialogue || {};
    addCandidate({
      fromCharacterId: rel.fromCharacterId,
      toCharacterId: rel.toCharacterId,
      score: 140 + relationshipIntensityScore(rel) + Number(rel.lastDialogue.dialogueTurnCount || 0) * 5,
      reason: "relationship-last-dialogue",
      sharedObject: dialogue.sharedObject || "",
      locationId: dialogue.locationId || "",
      locationName: dialogue.locationName || "",
      text: [rel.label, rel.unspoken, rel.misreading, dialogue.locationName, dialogue.sharedObject, dialogue.eventOutcome, dialogue.finalTurn, dialogue.followupTurn].filter(Boolean).join(" "),
    });
  }

  for (const memory of state.characterMemories || []) {
    if (memory?.source !== "agent_dialogue_relationship") continue;
    const sourceShift = memory.sourceRelationshipShift || {};
    addCandidate({
      fromCharacterId: memory.characterId,
      toCharacterId: memory.targetCharacterId,
      score: 110
        + Number(memory.heat || 0)
        + Number(memory.reliability || 0) * 0.2
        + Number(memory.sourceRelationshipShift?.dialogueTurnCount || 0) * 5,
      reason: "dialogue-memory",
      sharedObject: sourceShift.sharedObject || "",
      locationId: sourceShift.locationId || "",
      locationName: sourceShift.locationName || "",
      text: [memory.content, memory.publicVersion, memory.privateVersion, sourceShift.locationName, sourceShift.sharedObject, sourceShift.finalTurn, sourceShift.followupTurn].filter(Boolean).join(" "),
    });
  }

  return [...candidates.values()].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

function hotDialogueRelationshipCandidateForSlot(state, byId, slotIndex) {
  const candidates = hotDialogueRelationshipCandidates(state, byId);
  if (slotIndex >= candidates.length) return null;
  return candidates[slotIndex] || null;
}

function recentOpeningDescriptors(state, limit = 2) {
  const openings = [];
  for (const draft of state.draftScenes || []) {
    const firstTick = draft?.periodSimulation?.ticks?.[0];
    if (!firstTick?.locationId) continue;
    const firstExchange = firstTick.sceneInteraction?.agentExchanges?.[0] || {};
    openings.push({
      locationId: firstTick.locationId,
      sourceCharacterId: firstExchange.sourceCharacterId || firstExchange.actorId || "",
      responseCharacterId: firstExchange.responseCharacterId || firstExchange.targetId || "",
    });
    if (openings.length >= limit) break;
  }
  return openings;
}

function openingCandidateIsCooling(state, candidate = null, hotLocation = null) {
  if (!candidate || !hotLocation?.id) return false;
  const recent = recentOpeningDescriptors(state, 2);
  if (recent.length < 2) return false;
  if (recent.every((opening) => opening.locationId === hotLocation.id)) return true;
  return recent.every((opening) =>
    opening.locationId === hotLocation.id
    && opening.sourceCharacterId === candidate.fromCharacterId
    && opening.responseCharacterId === candidate.toCharacterId
  );
}

function openingHotDialogueRelationshipCandidate(state, byId, locations = []) {
  for (const candidate of hotDialogueRelationshipCandidates(state, byId)) {
    const hotLocation = locationForDialogueRelationshipCandidate(candidate, locations);
    if (!hotLocation) continue;
    if (openingCandidateIsCooling(state, candidate, hotLocation)) continue;
    return { ...candidate, hotLocation };
  }
  return null;
}

function locationForDialogueRelationshipCandidate(candidate = null, locations = []) {
  if (!candidate) return null;
  const ranked = (locations || [])
    .map((location) => ({ location, score: dialogueLocationScore(location, candidate) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.location || null;
}

function dialogueLocationScore(location = {}, candidate = {}) {
  const locationText = [
    location.id,
    location.name,
    location.visibleUse,
    location.hiddenUse,
    location.subtext,
    location.powerRule,
    ...(location.likelyEvents || []),
  ].filter(Boolean).join(" ");
  const candidateText = [candidate.sharedObject, candidate.text].filter(Boolean).join(" ");
  if (!candidateText || !locationText) return 0;
  let score = 0;
  if (candidate.locationId && location.id === candidate.locationId) score += 220;
  if (candidate.locationName && location.name === candidate.locationName) score += 180;
  if (candidate.sharedObject && locationText.includes(candidate.sharedObject)) score += 120;
  if (location.name && candidateText.includes(location.name)) score += 90;
  const anchors = ["灵契", "契牌", "界石", "魔印", "妖丹", "禁术符箓", "庇护牌", "药炉", "照骨镜", "剑匣", "魂灯", "供词", "渡令", "水阵", "停剑令", "茶盏", "通关文牒", "账本", "样品箱", "小提琴"];
  for (const anchor of anchors) {
    if (candidateText.includes(anchor) && locationText.includes(anchor)) score += 35;
  }
  return score;
}

function hotDialogueRelationshipCastForSlot(state, byId, slotIndex, location = null) {
  let candidate = hotDialogueRelationshipCandidateForSlot(state, byId, slotIndex);
  if (slotIndex === 0) {
    const openingCandidate = openingHotDialogueRelationshipCandidate(state, byId, state.locations || []);
    if (openingCandidate?.hotLocation?.id === location?.id) candidate = openingCandidate;
    else candidate = null;
  }
  if (!candidate) return [];
  return [byId.get(candidate.fromCharacterId), byId.get(candidate.toCharacterId)].filter(Boolean);
}

function recentCharacterParticipationCounts(state) {
  const counts = new Map((state.characters || []).map((character) => [character.id, 0]));
  for (const draft of (state.draftScenes || []).slice(0, 8)) {
    for (const tick of draft.periodSimulation?.ticks || []) {
      for (const id of tick.participantIds || []) {
        if (counts.has(id)) counts.set(id, counts.get(id) + 1);
      }
    }
  }
  return counts;
}

function coldCharacterCastForSlot(state, byId, slotIndex) {
  const counts = recentCharacterParticipationCounts(state);
  const periodIndex = Math.max(0, (state.canonEvents || []).length);
  const characters = (state.characters || []).filter((character) => byId.has(character.id));
  const ranked = characters
    .map((character, index) => ({ character, index, count: counts.get(character.id) || 0 }))
    .sort((a, b) => a.count - b.count || ((a.index + periodIndex + slotIndex) % characters.length) - ((b.index + periodIndex + slotIndex) % characters.length));
  return ranked.map((item) => item.character);
}

function chooseCharactersForSlot(state, location, slotIndex, focused = false) {
  const characters = state.characters || [];
  if (characters.length <= 3) return characters;
  const byId = new Map(characters.map((character) => [character.id, character]));
  const relationshipCast = hotDialogueRelationshipCastForSlot(state, byId, slotIndex, location);
  const frequent = (location.frequentCharacters || []).map((id) => byId.get(id)).filter(Boolean);
  const periodIndex = Math.max(0, (state.canonEvents || []).length);
  const rotationStart = (slotIndex + periodIndex * 3) % characters.length;
  const rotated = characters.slice(rotationStart).concat(characters.slice(0, rotationStart));
  const cold = coldCharacterCastForSlot(state, byId, slotIndex).slice(0, 2);
  const targetCount = Math.min(characters.length, 3);
  // Casting priority follows the town's own rule: location affiliation first
  // (who belongs at this place), then hot dialogue pairs, then cold-slot
  // rotation. On the observed stage the location's residents lead; ambient
  // background slots keep the original rotation-fairness order. Manual scene
  // cast never biases the period cast.
  const picked = focused
    ? uniqueById([...frequent, ...relationshipCast, ...cold, ...rotated])
    : slotIndex === 0 && relationshipCast.length
      ? uniqueById([...relationshipCast, ...cold, ...frequent, ...rotated])
      : uniqueById([...cold, ...frequent, ...relationshipCast, ...rotated]);
  return picked.slice(0, targetCount);
}

function normalizeFocusMode(state) {
  return state.ui?.focusMode === "location" ? "location" : "ambient";
}

function buildPeriodFocus(state, selectedLocation) {
  const mode = normalizeFocusMode(state);
  if (mode !== "location") {
    return {
      mode: "ambient",
      locationId: null,
      locationName: null,
      precisionRule: "全镇低精度后台运行；没有地点升格成完整场景。",
    };
  }
  return {
    mode: "location",
    locationId: selectedLocation.id,
    locationName: selectedLocation.name,
    precisionRule: `${selectedLocation.name}升格为聚焦场景；其他地点保持低精度后台运行。`,
  };
}

function isFocusedLocation(focus, location) {
  return focus?.mode === "location" && focus.locationId === location.id;
}

function buildLocalState(state, location, activeCharacters, slot = null) {
  return {
    ...state,
    ui: {
      ...(state.ui || {}),
      activeCharacterIds: activeCharacters.map((character) => character.id),
      selectedLocationId: location.id,
      userDirective: slot?.focus ? `${state.ui?.userDirective || ""}\n本段时间：${slot.label}，${slot.focus}。`.trim() : state.ui?.userDirective || "",
    },
  };
}

function runLowPrecisionBackgroundTick(state, location, activeCharacters, slot = null) {
  const localState = buildLocalState(state, location, activeCharacters, slot);
  const simulationTick = buildSimulationTick(localState);
  simulationTick.periodSlot = slot?.label || "";
  simulationTick.periodSlotFocus = slot?.focus || "";
  const agentOutputs = runAgentInteractionLoop({ localState, simulationTick, activeCharacters, location, conductorSignal: slot?.conductorSignal || null });
  const sceneInteraction = runSceneInteractionSimulation({ state: localState, simulationTick, agentOutputs });
  const actors = agentOutputs.map((output) => getName(localState, output.characterId));
  const highest = simulationTick.contradictionPressureSummary?.highest;
  const prop = locationProp(location);
  const backgroundEvents = [
    `${actors.join("、") || "有人"}在${location.name}短暂停过，${slot?.focus || location.subtext || "场所里只留下几处痕迹"}。`,
    highest ? `${highest.characterName}把手停在${prop}旁，旁人没有听清后半句话。` : `${prop}在${location.name}旁被挪动过一次。`,
  ];
  const irreversibleTraces = backgroundEvents.map((line) => `${slot?.label || "背景"} / ${location.name}：${line}`);
  return {
    localState,
    simulationTick,
    agentOutputs,
    sceneInteraction,
    backgroundEvents,
    synthesized: {
      surfaceEvent: `${slot?.label || "背景"}，${location.name}留下${prop}旁的几处痕迹`,
      sceneText: "",
      subtextMatrix: [],
      relationshipShift: sceneInteraction?.agentRelationshipShifts || [],
      irreversibleTraces,
      sceneInteraction,
    },
  };
}

function runLocalSceneTick(state, location, activeCharacters, slot = null) {
  const localState = buildLocalState(state, location, activeCharacters, slot);
  const simulationTick = buildSimulationTick(localState);
  simulationTick.periodSlot = slot?.label || "";
  simulationTick.periodSlotFocus = slot?.focus || "";
  const agentOutputs = runAgentInteractionLoop({ localState, simulationTick, activeCharacters, location, conductorSignal: slot?.conductorSignal || null });
  const sceneInteraction = runSceneInteractionSimulation({ state: localState, simulationTick, agentOutputs });
  const synthesized = synthesizeScene({ state: localState, agentOutputs, location, simulationTick, sceneInteraction });
  return {
    localState,
    simulationTick,
    agentOutputs,
    sceneInteraction,
    synthesized,
  };
}

function buildSingleSceneDraft(state) {
  const location = getLocation(state);
  const activeCharacters = state.characters.filter((character) => state.ui?.activeCharacterIds?.includes(character.id));
  const safeActive = activeCharacters.length ? activeCharacters : state.characters.slice(0, 2);
  const { simulationTick, agentOutputs, sceneInteraction, synthesized } = runLocalSceneTick(state, location, safeActive);
  const interventionsApplied = agentOutputs.flatMap((output) => output.appliedInterventions || []);
  const draft = {
    id: createId("draft"),
    projectId: state.project.id,
    branchId: state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main",
    createdAt: new Date().toISOString(),
    timeGrain: state.ui?.timeGrain || "scene",
    locationId: location.id,
    participantIds: safeActive.map((character) => character.id),
    userDirective: state.ui?.userDirective || "",
    injectedEvent: state.ui?.injectedEvent || "",
    eventImpact: state.ui?.eventImpact || 0,
    interventionsUsed: activeInterventionsForState(state).map((item) => item.id),
    interventionsApplied,
    simulationMode: "realtime-character-simulation-loop",
    simulationTick,
    visibilityLayer: simulationTick.visibilityLayer,
    privateSimulations: simulationTick.privateSimulations,
    sceneInteraction,
    agentOutputs,
    ...synthesized,
  };
  draft.audit = auditDraft(draft, state);
  draft.updateBundle = buildUpdateBundle(draft, state);
  return draft;
}

function withPeriodMetadata(items, tick) {
  return (items || []).map((item) => ({
    ...item,
    periodSlot: tick.label,
    locationId: tick.locationId,
    locationName: tick.locationName,
  }));
}

function buildPeriodAggregateTick(state, ticks, grain) {
  const privateSimulations = ticks.flatMap((tick) => withPeriodMetadata(tick.simulationTick?.privateSimulations, tick));
  const visibleFacts = ticks.map((tick) => `${tick.label} / ${tick.locationName}：${tick.surfaceEvent}`);
  const hiddenFacts = ticks.map((tick) => `${tick.label} / ${tick.locationName}：${tick.simulationTick?.hiddenPressure || "隐藏压力继续累积"}`);
  const perCharacter = ticks.flatMap((tick) => withPeriodMetadata(tick.simulationTick?.visibilityLayer?.perCharacter, tick));
  const averageContradiction = clamp(privateSimulations.reduce((sum, sim) => sum + Number(sim.contradictionScore || 0), 0) / Math.max(privateSimulations.length, 1));
  const highest = privateSimulations.slice().sort((a, b) => Number(b.contradictionScore || 0) - Number(a.contradictionScore || 0))[0] || null;
  return {
    id: createId("period_tick"),
    createdAt: new Date().toISOString(),
    branchId: state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main",
    grain,
    mode: "town_period_simulation",
    locationId: "town_scope",
    locationName: "全镇",
    activeCharacterIds: (state.characters || []).map((character) => character.id),
    visiblePressure: visibleFacts.join("；"),
    hiddenPressure: hiddenFacts.join("；"),
    visibilityLayer: {
      visibleFacts,
      hiddenFacts,
      perCharacter,
    },
    privateSimulations,
    contradictionPressureSummary: {
      averageContradiction,
      hiddenFactPressure: clamp(hiddenFacts.length * 14 + averageContradiction * 0.65 + Number(state.ui?.eventImpact || 0) * 0.25),
      highest,
    },
  };
}

function buildPeriodInteraction(ticks) {
  return {
    tickId: createId("period_interaction"),
    sceneThesis: "小镇不是生成一场戏，而是在同一段时间里让多个地点、关系和误读并行运转。",
    interactionBeats: ticks.flatMap((tick) => withPeriodMetadata(tick.sceneInteraction?.interactionBeats, tick)),
    misunderstandings: ticks.flatMap((tick) => withPeriodMetadata(tick.sceneInteraction?.misunderstandings, tick)),
    reversals: ticks.flatMap((tick) => (tick.sceneInteraction?.reversals || []).map((line) => `${tick.label} / ${tick.locationName}：${line}`)),
    visibilityFlips: ticks.flatMap((tick) => withPeriodMetadata(tick.sceneInteraction?.visibilityFlips, tick)),
    relationshipMutationIntents: ticks.flatMap((tick) => withPeriodMetadata(tick.sceneInteraction?.relationshipMutationIntents, tick)),
    agentRelationshipShifts: ticks.flatMap((tick) => withPeriodMetadata(tick.sceneInteraction?.agentRelationshipShifts, tick)),
    simulationNotes: [
      "一次播放覆盖完整时间段，而不是只推进当前选中场景。",
      "每个时间段都有自己的地点、参与人物、私人模拟、误读和不可逆痕迹。",
    ],
    periodTicks: ticks.map((tick) => ({
      label: tick.label,
      locationId: tick.locationId,
      locationName: tick.locationName,
      participantIds: tick.participantIds,
      tickId: tick.simulationTick?.id,
    })),
  };
}

function periodBeatAct(index, grain) {
  const dayActs = ["opening", "rising", "pivot", "threshold", "trace"];
  const weekActs = ["opening", "pressure", "pivot", "countermove", "threshold", "trace"];
  const acts = grain === "week" ? weekActs : dayActs;
  return acts[index] || "trace";
}

function periodBeatRequiredActions(index, focused) {
  const required = [
    ["notice", "place_object"],
    ["question", "withhold"],
    ["counter_object", "reply"],
    ["block", "choose"],
    ["leave_trace", "carry_forward"],
  ][index % 5] || ["notice", "leave_trace"];
  return focused ? [...required, "speak_or_answer"] : required;
}

function periodBeatTarget(slot, index, location, grain) {
  const focus = slot?.focus || "一件东西被推到明处";
  const prop = locationProp(location);
  const dayTargets = [
    `让${location.name}里先出现一个会改变站位的${prop}`,
    `让${focus}逼出一次扣留、试探或报价`,
    `让第二个物件或第二个人反压前一个动作`,
    `让门、渡口、柜台或界线迫使人物作出选择`,
    `留下明天必须被处理的证据、传闻或债`,
  ];
  const weekTargets = [
    `让${focus}进入公共视线`,
    `让${location.name}里出现互相矛盾的说法`,
    `让一个旧关系借${prop}重新开口`,
    `让另一方拿出反制物件或旁证`,
    `让城规、门槛或期限压住人物退路`,
    `留下下一轮必须追问的痕迹`,
  ];
  const targets = grain === "week" ? weekTargets : dayTargets;
  return targets[index % targets.length];
}

function buildPeriodConductorSignal({ grain, slot, index, location }) {
  const object = locationProp(location);
  const clue = String(slot?.focus || `${object}被推到光里`).trim();
  const pressureCues = [
    `${object}被推到众人能看见的位置`,
    `空白账页把${object}旁的话逼短`,
    `另一件东西贴着${object}压下来`,
    `门槛和界线让${object}不能被悄悄带走`,
    `${object}留下明天必须追问的痕迹`,
  ];
  return {
    beatId: `period_beat_${grain}_${index + 1}`,
    delivery: "in_world_clue",
    inWorldClue: clue,
    object,
    pressureCue: pressureCues[index % pressureCues.length],
    target: periodBeatTarget(slot, index, location, grain),
  };
}

function periodBeatCompletionCriteria(slot, location, focused) {
  const prop = locationProp(location);
  const base = [
    `至少一名人物对${prop}做出可见动作`,
    `${location.name}留下可被他人误读或追查的证据`,
  ];
  return focused
    ? [...base, "出现一轮回应、追问或对白"]
    : [...base, `${slot?.focus || "远处变化"}留下脚步、物件或传闻`];
}

function periodBeatFallbackEscalation(slot, location) {
  const prop = locationProp(location);
  return [
    `让${slot?.focus || prop}被挪到${location.name}的公共位置`,
    `让旁观者、账册或门口声响带来相反线索`,
    `让${prop}变成不可收回的痕迹`,
  ];
}

function conductorEvidenceFromExchange(exchange = {}, state = {}, location = {}) {
  const sourceName = exchange.sourceCharacterName || exchange.actorName || getName(state, exchange.sourceCharacterId || exchange.actorId);
  const targetName = exchange.responseCharacterName || exchange.targetName || getName(state, exchange.responseCharacterId || exchange.targetId);
  const turnNames = (exchange.dialogueTurns || [])
    .map((turn) => turnSpeakerName(turn, exchange, state))
    .filter(Boolean);
  const speakers = [...new Set([sourceName, targetName, ...turnNames].filter(Boolean))].join("、") || "有人";
  const sharedObject = exchange.sharedObject || locationProp(location);
  const outcome = ensureNarrativeSentence(exchange.eventOutcome || `${sharedObject}没有被立刻收回。`);
  return `${location.name}对白证据：${speakers}围着${sharedObject}回应；${outcome}`;
}

function buildConductorEvidence({
  state,
  slot,
  location,
  agentOutputs = [],
  sceneInteraction = null,
  synthesized = {},
  backgroundEvents = [],
}) {
  const evidence = [];
  evidence.push(`${slot?.label || "此刻"} / ${location.name}：${synthesized.surfaceEvent || slot?.focus || "有人停住"}`);

  for (const exchange of (sceneInteraction?.agentExchanges || []).slice(0, 2)) {
    evidence.push(conductorEvidenceFromExchange(exchange, state, location));
  }

  for (const output of (agentOutputs || []).slice(0, 2)) {
    const actorName = getName(state, output.characterId);
    const action = stripLeadingActorName(extractLine(output.visibleAction), actorName);
    evidence.push(`${location.name}动作证据：${actorName}${action ? `，${action}` : "停了一下。"}`);
  }

  for (const line of (backgroundEvents || []).slice(0, 2)) {
    evidence.push(`${location.name}远处证据：${ensureNarrativeSentence(line)}`);
  }

  for (const trace of (synthesized.irreversibleTraces || []).slice(0, 1)) {
    evidence.push(`${location.name}痕迹证据：${trace}`);
  }

  return [...new Set(evidence.filter(Boolean))];
}

function buildPeriodConductorBeat({
  state,
  grain,
  slot,
  index,
  location,
  activeCharacters,
  focused,
  agentOutputs,
  sceneInteraction,
  synthesized,
  backgroundEvents,
  signal = null,
}) {
  const evidence = buildConductorEvidence({
    state,
    slot,
    location,
    agentOutputs,
    sceneInteraction,
    synthesized,
    backgroundEvents,
  });
  return {
    id: `period_beat_${grain}_${index + 1}`,
    act: periodBeatAct(index, grain),
    label: slot.label,
    locationId: location.id,
    locationName: location.name,
    target: periodBeatTarget(slot, index, location, grain),
    targetTickRange: [index + 1, index + 1],
    involvedCharacters: activeCharacters.map((character) => character.id),
    requiredActionTypes: periodBeatRequiredActions(index, focused),
    preconditions: index === 0 ? [] : [`前一时段已经在城中留下可追踪痕迹`],
    completionCriteria: periodBeatCompletionCriteria(slot, location, focused),
    fallbackEscalation: periodBeatFallbackEscalation(slot, location),
    forbiddenOutcomes: ["用解释替代行动", "让所有人物无代价离场", "把城规当作结论而不是压力"],
    priority: index < 2 ? "must" : "should",
    budget: focused ? 2 : 1,
    signal,
    escalationLevel: 0,
    completed: evidence.length > 0,
    completionEvidence: evidence.slice(0, 3),
    evidence,
  };
}

function buildConductorProgress(ticks) {
  const completedBeatIds = ticks
    .filter((tick) => tick.conductorBeat?.completed)
    .map((tick) => tick.conductorBeat.id);
  const failedBeatIds = ticks
    .filter((tick) => tick.conductorBeat && !tick.conductorBeat.completed)
    .map((tick) => tick.conductorBeat.id);
  return {
    template: "town_period_conductor",
    totalBeats: ticks.length,
    completedBeatIds,
    failedBeatIds,
    currentBeatIndex: ticks.length,
    injectionBudget: Math.max(2, Math.ceil(ticks.length / 3)),
    injectionUsed: 0,
    escalationHistory: ticks
      .filter((tick) => tick.conductorBeat?.fallbackEscalation?.length)
      .map((tick) => ({
        beatId: tick.conductorBeat.id,
        level: tick.conductorBeat.escalationLevel || 0,
        hint: tick.conductorBeat.fallbackEscalation[0],
      })),
  };
}

function draftLevelInterventionRecords(state = {}, existing = []) {
  const byId = new Set((existing || []).map((item) => item?.id).filter(Boolean));
  const records = [...(existing || [])];
  for (const item of activeInterventionsForState(state)) {
    if (!item?.id || byId.has(item.id)) continue;
    records.push({
      id: item.id,
      type: item.type,
      action: item.action || item.type,
      intensity: Number(item.intensity || 50),
      instruction: item.instruction || item.payload || "未写明的操盘意图",
      characterId: item.targetCharacterId || "",
      targetCharacterId: item.secondaryCharacterId || "",
      persistence: item.persistence || "next_play",
      source: "period-draft",
    });
  }
  return records;
}

function buildTownStateChanges(ticks) {
  return ticks.map((tick) => {
    const highest = tick.simulationTick?.contradictionPressureSummary?.highest;
    const pressure = highest ? `${highest.characterName}留下的停顿改变了旁人的站位` : "几个人的脚步在同一处停过";
    return `${tick.label}，${tick.locationName}：${pressure}；${tick.surfaceEvent}`;
  });
}

function buildOffscreenActions(ticks, state) {
  const offscreenTicks = ticks.filter((tick) => tick.resolution !== "focused_scene");
  const actions = offscreenTicks.flatMap((tick) => (tick.agentOutputs || []).map((output) => {
    const character = getName(state, output.characterId);
    const action = stripLeadingActorName(extractLine(output.visibleAction), character);
    return `${tick.label}，${character}在${tick.locationName}，${action || "停了一下。"}`;
  }));
  return actions.slice(0, Math.max(2, ticks.length));
}

function stripLeadingActorName(text = "", actorName = "") {
  const cleaned = String(text || "").trim();
  const name = String(actorName || "").trim();
  if (!cleaned || !name || !cleaned.startsWith(name)) return cleaned;
  return cleaned.slice(name.length).replace(/^[，,。；;\s]+/, "").trim();
}

function compactTickText(tick) {
  const slotFocus = (tick.slotFocus && [
    tick.surfaceEvent,
    ...(tick.backgroundEvents || []),
    ...(tick.agentOutputs || []).map((output) => output.visibleAction || ""),
  ].some((line) => String(line || "").includes(tick.slotFocus)))
    ? ""
    : tick.slotFocus || "";
  if (tick.resolution === "background") {
    return [
      `【${tick.label} · ${tick.locationName}】`,
      slotFocus,
      tick.surfaceEvent,
      ...(tick.backgroundEvents || []).slice(0, 2).map((line) => `- ${line}`),
    ].filter(Boolean).join("\n");
  }
  const outputLines = (tick.agentOutputs || []).slice(0, 2).map((output) => `- ${output.visibleAction}`);
  const trace = (tick.synthesized?.irreversibleTraces || [])[0];
  return [
    `【${tick.label} · ${tick.locationName}】`,
    slotFocus,
    tick.surfaceEvent,
    ...outputLines,
    trace || "",
  ].filter(Boolean).join("\n");
}

function buildPeriodSceneText({ grain, ticks, townStateChanges, offscreenActions, state, focus }) {
  const title = grain === "week" ? "【小镇一周运转】" : "【小镇一日运转】";
  const directive = state.ui?.userDirective ? `起始要求：${sanitizeObservationLine(state.ui.userDirective)}` : "";
  const injected = state.ui?.injectedEvent ? `启动事件：${state.ui.injectedEvent}` : "启动事件：没有外来的传令，城里照常开门。";
  const interventions = activeInterventionsForState(state);
  const interventionLine = interventions.length
    ? `操盘干预：${interventions.map((item) => summarizeIntervention(item, state)).join("；")}。`
    : "";
  const focusLine = focus?.mode === "location"
    ? `观察焦点：${focus.locationName}。这里被盯紧，别处只留下脚步、物件和传闻。`
    : "观察焦点：无。整座小镇只留下脚步、物件和传闻。";
  return [
    title,
    `${injected}`,
    focusLine,
    interventionLine,
    directive,
    "这一轮覆盖整座小镇的设定时间段。",
    "",
    ...ticks.map((tick) => compactTickText(tick)),
    "",
    "【城中变化】",
    ...townStateChanges.slice(0, 6).map((line) => `- ${line}`),
    "",
    "【别处留下的动作】",
    ...offscreenActions.slice(0, 6).map((line) => `- ${line}`),
  ].filter((line) => line !== "").join("\n");
}

function buildPeriodDraft(state) {
  const grain = state.ui?.timeGrain || "day";
  const configuredLocation = getLocation(state);
  const selectedLocation = state.ui?.focusMode === "location" ? configuredLocation : (state.locations?.[0] || configuredLocation);
  const locations = orderedLocations(state, selectedLocation);
  const focus = buildPeriodFocus(state, selectedLocation);
  const slots = periodSlotsForGrain(grain);
  let evolvingState = deepClone(state);
  const ticks = [];
  for (const [index, slot] of slots.entries()) {
    const location = chooseLocationForSlot(evolvingState, locations, index, focus);
    const focused = isFocusedLocation(focus, location);
    const activeCharacters = chooseCharactersForSlot(evolvingState, location, index, focused);
    const conductorSignal = buildPeriodConductorSignal({ grain, slot, index, location });
    const directedSlot = { ...slot, conductorSignal };
    const { simulationTick, agentOutputs, sceneInteraction, synthesized, backgroundEvents } = focused
      ? runLocalSceneTick(evolvingState, location, activeCharacters, directedSlot)
      : runLowPrecisionBackgroundTick(evolvingState, location, activeCharacters, directedSlot);
    const conductorBeat = buildPeriodConductorBeat({
      state: evolvingState,
      grain,
      slot: directedSlot,
      index,
      location,
      activeCharacters,
      focused,
      agentOutputs,
      sceneInteraction,
      synthesized,
      backgroundEvents,
      signal: conductorSignal,
    });
    const tick = {
      id: createId("period_slot"),
      order: index + 1,
      label: slot.label,
      slotFocus: slot.focus,
      resolution: focused ? "focused_scene" : "background",
      precision: focused ? "scene" : "low",
      locationId: location.id,
      locationName: location.name,
      participantIds: activeCharacters.map((character) => character.id),
      simulationTick,
      sceneInteraction,
      agentOutputs,
      backgroundEvents: backgroundEvents || [],
      surfaceEvent: synthesized.surfaceEvent,
      sceneText: focused ? synthesized.sceneText : "",
      synthesized,
      conductorBeat,
    };
    ticks.push(tick);
    const tickUpdateBundle = buildUpdateBundle(buildTickDraftForUpdate(evolvingState, tick), evolvingState);
    evolvingState = applyPeriodBundleToLocalState(evolvingState, tickUpdateBundle);
  }
  const participantIds = (state.characters || []).map((character) => character.id);
  const periodSimulationTick = buildPeriodAggregateTick(state, ticks, grain);
  const periodInteraction = buildPeriodInteraction(ticks);
  const townStateChanges = buildTownStateChanges(ticks);
  const offscreenActions = buildOffscreenActions(ticks, state);
  const agentOutputs = ticks.flatMap((tick) => withPeriodMetadata(tick.agentOutputs, tick));
  const interventionsApplied = draftLevelInterventionRecords(
    state,
    agentOutputs.flatMap((output) => output.appliedInterventions || []),
  );
  const subtextMatrix = ticks.flatMap((tick) => withPeriodMetadata(tick.synthesized?.subtextMatrix, tick));
  const relationshipShift = ticks.flatMap((tick) => withPeriodMetadata(tick.synthesized?.relationshipShift, tick));
  const irreversibleTraces = [
    ...ticks.flatMap((tick) => (tick.synthesized?.irreversibleTraces || []).map((trace) => `${tick.label} / ${tick.locationName}：${trace}`)),
    ...townStateChanges.map((line) => `镇级痕迹：${line}`),
  ];
  const draft = {
    id: createId("draft"),
    projectId: state.project.id,
    branchId: state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main",
    createdAt: new Date().toISOString(),
    timeGrain: grain,
    locationId: selectedLocation.id,
    participantIds,
    userDirective: state.ui?.userDirective || "",
    injectedEvent: state.ui?.injectedEvent || "",
    eventImpact: state.ui?.eventImpact || 0,
    interventionsUsed: activeInterventionsForState(state).map((item) => item.id),
    interventionsApplied,
    simulationMode: "town-period-simulation-loop",
    simulationTick: periodSimulationTick,
    visibilityLayer: periodSimulationTick.visibilityLayer,
    privateSimulations: periodSimulationTick.privateSimulations,
    sceneInteraction: periodInteraction,
    agentOutputs,
    surfaceEvent: `${grain === "week" ? "一周" : "一天"}内，小镇在${ticks.length}个时间段和${new Set(ticks.map((tick) => tick.locationId)).size}个地点持续运转`,
    sceneText: buildPeriodSceneText({ grain, ticks, townStateChanges, offscreenActions, state, focus }),
    subtextMatrix,
    relationshipShift,
    irreversibleTraces,
    periodSimulation: {
      id: createId("period"),
      duration: grain,
      focus,
      tickCount: ticks.length,
      startedAt: new Date().toISOString(),
      locationIds: [...new Set(ticks.map((tick) => tick.locationId))],
      participantIds,
      townStateChanges,
      offscreenActions,
      conductorProgress: buildConductorProgress(ticks),
      ticks,
    },
  };
  draft.audit = auditDraft(draft, state);
  draft.updateBundle = buildUpdateBundle(draft, state);
  return draft;
}

export function playNext(state) {
  state = normalizeStateForMock(state);
  seedDeterministicRandom([
    state.project?.id,
    state.draftScenes?.length,
    state.ui?.selectedLocationId,
    state.ui?.timeGrain,
    state.ui?.focusMode,
    state.simulationTick?.id,
  ].join("|"));
  if (isTavernLifeState(state)) return playTavernLifeNext(state);
  if (isPeriodGrain(state.ui?.timeGrain)) return buildPeriodDraft(state);
  return buildSingleSceneDraft(state);
}
