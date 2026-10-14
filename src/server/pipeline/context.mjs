import { buildMemoryConflictSummary, getCharacterMemories } from "../../state/memoryGraph.js";
import { ensureCharacterPlans, getCharacterPlan } from "../../state/intentPlanner.js";
import { relationshipIntensityScore, retargetTextToLockedTarget } from "./relationshipTargeting.mjs";

export function compactCharacter(character, state = null) {
  const plan = state ? getCharacterPlan({ ...state, characterPlans: ensureCharacterPlans(state) }, character.id) : null;
  return {
    id: character.id,
    name: character.name,
    generatedBySkill: character.generatedBySkill,
    agentProfile: character.agentProfile,
    publicIdentity: character.publicIdentity,
    externalSituation: character.externalSituation,
    internalSituation: character.internalSituation,
    selfMyth: character.selfMyth,
    actionLines: character.actionLines,
    desireLag: character.desireLag,
    shameMechanism: character.shameMechanism,
    defenseLanguage: character.defenseLanguage,
    speechProfile: character.speechProfile || character.agentProfile?.speechProfile || null,
    shadowActions: character.shadowActions,
    nobleActions: character.nobleActions,
    vileActions: character.vileActions,
    innerCourt: character.innerCourt,
    actionVerbs: character.actionVerbs,
    triggers: character.triggers,
    relationshipRules: character.relationshipRules,
    irreversibleBoundaries: character.irreversibleBoundaries,
    currentState: character.currentState,
    currentLocationId: character.currentLocationId || "",
    currentActivity: character.currentActivity || null,
    previousLocationId: character.previousLocationId || "",
    lastPresenceDecision: character.lastPresenceDecision || "",
    lastMovementReason: character.lastMovementReason || "",
    inTransit: character.inTransit === true,
    plan,
  };
}

export function activeCharacterIds(state) {
  const focus = ambientDialogueFocus(state);
  if (focus?.activeCharacterIds?.length) return focus.activeCharacterIds;
  const active = state.ui?.activeCharacterIds?.length ? state.ui.activeCharacterIds : state.characters.slice(0, 2).map((c) => c.id);
  return active.filter((id) => state.characters.some((character) => character.id === id));
}

export function selectedLocation(state) {
  const focus = ambientDialogueFocus(state);
  if (focus?.location) return focus.location;
  const selectedLocationId = state.ui?.selectedLocationId || state.locations?.[0]?.id;
  return state.locations.find((loc) => loc.id === selectedLocationId) || state.locations[0];
}

function ambientDialogueFocus(state = {}) {
  if (state.ui?.focusMode === "location") return null;
  const characters = Array.isArray(state.characters) ? state.characters : [];
  const locations = Array.isArray(state.locations) ? state.locations : [];
  const byCharacterId = new Map(characters.map((character) => [character.id, character]));
  const candidate = (state.relationships || [])
    .filter((rel) => rel?.lastDialogue)
    .filter((rel) => byCharacterId.has(rel.fromCharacterId) && byCharacterId.has(rel.toCharacterId))
    .map((rel) => ({
      rel,
      score: 140 + relationshipIntensityScore(rel) + Number(rel.lastDialogue?.dialogueTurnCount || 0) * 5,
    }))
    .sort((a, b) => b.score - a.score)[0]?.rel;
  if (!candidate) return null;
  const dialogue = candidate.lastDialogue || {};
  const location = locations.find((loc) => dialogue.locationId && loc.id === dialogue.locationId)
    || locations.find((loc) => dialogue.locationName && loc.name === dialogue.locationName)
    || null;
  if (!location) return null;
  const targetCount = Math.max(2, Math.min(characters.length, state.ui?.activeCharacterIds?.length || 3));
  const frequent = (location.frequentCharacters || []).map((id) => byCharacterId.get(id)).filter(Boolean);
  const existing = (state.ui?.activeCharacterIds || []).map((id) => byCharacterId.get(id)).filter(Boolean);
  const picked = uniqueCharacters([
    byCharacterId.get(candidate.fromCharacterId),
    byCharacterId.get(candidate.toCharacterId),
    ...frequent,
    ...existing,
    ...characters,
  ]);
  return {
    location,
    activeCharacterIds: picked.slice(0, targetCount).map((character) => character.id),
    relationshipId: candidate.id,
  };
}

function uniqueCharacters(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

export function compactState(state) {
  const activeIds = activeCharacterIds(state);
  const location = selectedLocation(state);
  return {
    project: state.project,
    town: state.town,
    selectedLocation: location,
    availableLocations: (state.locations || []).map((item) => ({
      id: item.id,
      name: item.name,
      subtext: item.subtext || "",
      powerRule: item.powerRule || "",
    })),
    activeCharacters: state.characters.filter((character) => activeIds.includes(character.id)).map((character) => compactCharacter(character, state)),
    activeCharacterIds: activeIds,
    relationships: state.relationships.filter((rel) => activeIds.includes(rel.fromCharacterId) || activeIds.includes(rel.toCharacterId)),
    recentCanon: (state.canonEvents || []).slice(0, 6),
    recentDrafts: (state.draftScenes || []).slice(0, 4).map((draft) => ({
      id: draft.id,
      surfaceEvent: draft.surfaceEvent,
      provider: draft.provider,
      locationId: draft.locationId,
      participantIds: draft.participantIds,
      sceneExcerpt: draft.sceneText?.slice(0, 700),
    })),
    recentRumors: (state.rumors || []).slice(0, 8),
    recentEvidence: (state.evidence || []).slice(0, 8),
    recentMemories: (state.characterMemories || []).slice(0, 12),
    evidenceLinks: (state.evidenceLinks || []).slice(0, 16),
    activeCharacterMemories: (state.characterMemories || []).filter((memory) => activeIds.includes(memory.characterId) || activeIds.includes(memory.targetCharacterId)).slice(0, 28),
    activeCharacterPlans: ensureCharacterPlans(state).filter((plan) => activeIds.includes(plan.characterId)),
    memoryConflictSummaries: activeIds.map((characterId) => ({
      characterId,
      summary: buildMemoryConflictSummary(state, characterId),
      mostRecentMemories: getCharacterMemories(state, characterId).slice(0, 6),
    })),
    irreversibleTraces: (state.irreversibleTraces || []).slice(0, 10),
    activeInterventions: (state.interventions || []).filter((item) => item && item.enabled !== false && !item.consumed).slice(0, 12),
    stateChangeReasons: (state.stateChangeReasons || []).slice(0, 12),
    ui: {
      timeGrain: state.ui?.timeGrain,
      userDirective: state.ui?.userDirective,
      injectedEvent: state.ui?.injectedEvent,
      eventImpact: state.ui?.eventImpact || 0,
      selectedCharacterId: state.ui?.selectedCharacterId || "",
      activeBranchId: state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main",
    },
  };
}

export function getCharacterName(compact, id) {
  return compact.activeCharacters.find((character) => character.id === id)?.name || id;
}

export function normalizeAgentOutput(output, characterId, targetCharacterId, targetLock = {}) {
  const visibleAction = retargetTextToLockedTarget(output?.visibleAction || "保持表面身份，等待对方先暴露。", {
    targetName: targetLock.targetCharacterName || "",
    forbiddenNames: targetLock.forbiddenTargetNames || [],
  });
  return {
    characterId: output?.characterId || characterId,
    targetCharacterId: targetCharacterId || output?.targetCharacterId || "",
    tone: output?.tone || "试探",
    visibleAction,
    hiddenAction: output?.hiddenAction || "确认对方是否听懂自己的裂缝。",
    defenseAction: output?.defenseAction || "把等待命名为观察。",
    shadowAction: output?.shadowAction || "用沉默索取对方反应。",
    selfDeceptionSentence: output?.selfDeceptionSentence || "我只是按原则行事。",
    wantsFromOthers: output?.wantsFromOthers || "希望对方按自己可控制的方式回应。",
    desiredEmotionalResponse: output?.desiredEmotionalResponse || "追问、迟疑或继续等待解释。",
    possibleHarm: output?.possibleHarm || "让对方把自己的反应误认为问题本身。",
    possibleNobleAction: output?.possibleNobleAction || "承认自己的行动不纯，减少对方伤害。",
    possibleEvidenceLeft: output?.possibleEvidenceLeft || "一次可被误读的沉默。",
    surfaceJustification: output?.surfaceJustification || visibleAction || "表面上只是按规则推进。",
    desireReason: output?.desireReason || output?.hiddenAction || "想被看见。",
    shameReason: output?.shameReason || "害怕欲望被命名。",
    powerReason: output?.powerReason || "需要保留解释权。",
    selfDeceptionReason: output?.selfDeceptionReason || output?.defenseAction || "把欲望改名为原则。",
    unadmittedPleasure: output?.unadmittedPleasure || "对方被自己影响。",
    postActionSelfPunishment: output?.postActionSelfPunishment || "事后反复重读或自我审判。",
    memoryId: output?.memoryId || null,
    memoryInfluence: output?.memoryInfluence || "",
    memoryUse: output?.memoryUse || "",
    memoryDistortionAction: output?.memoryDistortionAction || "",
    planId: output?.planId || null,
    planInfluence: output?.planInfluence || "",
    planNextAction: output?.planNextAction || "",
    planStatus: output?.planStatus || "none",
    realtimePublicGoal: output?.realtimePublicGoal || visibleAction || "维持表面身份。",
    realtimePrivateDesire: output?.realtimePrivateDesire || output?.desireReason || output?.hiddenAction || "想被看见。",
    realtimeDefensiveMask: output?.realtimeDefensiveMask || output?.defenseAction || "把欲望命名为原则。",
    realtimeShadowImpulse: output?.realtimeShadowImpulse || output?.shadowAction || "用体面动作索取反应。",
    realtimeNobleImpulse: output?.realtimeNobleImpulse || output?.possibleNobleAction || "减少伤害，但不索取宽恕。",
    realtimeLieToSelf: output?.realtimeLieToSelf || output?.selfDeceptionSentence || "我只是按原则行事。",
    realtimeActionCandidate: output?.realtimeActionCandidate || output?.tone || "试探",
    realtimePressure: Number(output?.realtimePressure ?? 50),
    realtimeContradictionScore: Number(output?.realtimeContradictionScore ?? 55),
    currentActivity: output?.currentActivity || null,
    reactionIntent: output?.reactionIntent || "continue",
    reactionReason: output?.reactionReason || "",
    conversationObjective: output?.conversationObjective || "",
    conversationEndCondition: output?.conversationEndCondition || "",
    visibilityFacts: Array.isArray(output?.visibilityFacts) ? output.visibilityFacts : [],
    falseBeliefs: Array.isArray(output?.falseBeliefs) ? output.falseBeliefs : [],
    withheldFacts: Array.isArray(output?.withheldFacts) ? output.withheldFacts : [],
  };
}

const BLOCKED_RETREAT_RE = /退路|不能替你写|不能被.*改成退路|不能只把话推回去/;
const VISIBLE_RETREAT_RE = /退路|后退|门槛|界线|不盖印|不让.*盖印|退到.*界石|退到.*铜盘|盖印的人仍/;

function appendUniqueText(base = "", addition = "") {
  const current = String(base || "").trim();
  const extra = String(addition || "").trim();
  if (!extra) return current;
  if (!current) return extra;
  if (current.includes(extra)) return current;
  return `${current} ${extra}`;
}

function relationshipMemoryText(memory = {}) {
  const source = memory.sourceRelationshipShift || {};
  const dialogue = memory.lastDialogue || memory.relationshipDialogueMemory || {};
  return [
    memory.content,
    memory.publicVersion,
    memory.privateVersion,
    memory.distortion,
    memory.retrievalCue,
    memory.source,
    memory.relationshipSource,
    source.sharedObject,
    source.eventOutcome,
    source.finalTurn,
    source.followupTurn,
    source.misreading,
    source.unspoken,
    dialogue.sharedObject,
    dialogue.eventOutcome,
    dialogue.finalTurn,
    dialogue.followupTurn,
    dialogue.misreading,
    dialogue.unspoken,
  ].filter(Boolean).join(" ");
}

function isBlockedRetreatMemory(memory = {}) {
  return BLOCKED_RETREAT_RE.test(relationshipMemoryText(memory));
}

function memoryCandidateScore(memory = {}, characterId = "", targetId = "") {
  let score = Number(memory.heat || 0);
  if (memory.characterId === characterId) score += 140;
  if (memory.targetCharacterId === targetId) score += 80;
  if (memory.source === "agent_dialogue_relationship") score += 50;
  if (memory.sourceRelationshipShift?.generatedFrom) score += 20;
  return score;
}

function relationshipAsMemory(rel = {}, characterId = "", targetId = "") {
  if (!rel?.lastDialogue) return null;
  if (rel.fromCharacterId !== characterId || rel.toCharacterId !== targetId) return null;
  return {
    id: rel.lastDialogue.id || `relationship_${rel.id || characterId}_${targetId}`,
    characterId,
    targetCharacterId: targetId,
    source: rel.lastDialogue.source || rel.relationshipSource || "agent_dialogue_relationship",
    content: rel.unspoken || rel.lastDialogue.followupTurn || rel.lastDialogue.finalTurn || rel.lastDialogue.eventOutcome || "",
    privateVersion: rel.misreading || "",
    publicVersion: rel.lastDialogue.eventOutcome || "",
    distortion: rel.misreading || rel.unspoken || "",
    heat: relationshipIntensityScore(rel),
    relationshipSource: rel.lastDialogue.relationshipSource || rel.relationshipSource || "",
    sourceRelationshipShift: {
      generatedFrom: rel.lastDialogue.source || rel.lastDialogue.relationshipSource || "agent-dialogue-relationship",
      sharedObject: rel.lastDialogue.sharedObject,
      locationId: rel.lastDialogue.locationId,
      locationName: rel.lastDialogue.locationName,
      finalTurn: rel.lastDialogue.finalTurn,
      followupTurn: rel.lastDialogue.followupTurn,
      eventOutcome: rel.lastDialogue.eventOutcome,
      misreading: rel.misreading,
      unspoken: rel.unspoken,
    },
  };
}

function blockedRetreatMemoryForOutput(compact = {}, output = {}) {
  const characterId = output.characterId || "";
  const targetId = output.targetCharacterId || "";
  const memories = (compact.activeCharacterMemories || [])
    .filter((memory) => memory?.characterId === characterId)
    .filter((memory) => !targetId || !memory.targetCharacterId || memory.targetCharacterId === targetId)
    .filter(isBlockedRetreatMemory);
  const relationshipMemories = (compact.relationships || [])
    .map((rel) => relationshipAsMemory(rel, characterId, targetId))
    .filter(Boolean)
    .filter(isBlockedRetreatMemory);
  return [...memories, ...relationshipMemories]
    .sort((a, b) => memoryCandidateScore(b, characterId, targetId) - memoryCandidateScore(a, characterId, targetId))[0] || null;
}

function blockedRetreatObject(memory = {}, compact = {}) {
  return memory.sourceRelationshipShift?.sharedObject
    || memory.relationshipDialogueMemory?.sharedObject
    || memory.lastDialogue?.sharedObject
    || compact.selectedLocation?.recurringObjects?.[0]
    || "这件东西";
}

function blockedRetreatVisibleTail(character = {}, memory = {}, compact = {}) {
  const actorName = character.name || character.characterName || character.id || "此人";
  const object = blockedRetreatObject(memory, compact);
  return `${actorName}把${object}推回界石边，自己后退到门槛内侧；盖印的人仍被挡在铜盘外。`;
}

export function calibrateAgentOutputWithMemory(output = {}, { compact = {}, character = {}, target = {} } = {}) {
  const memory = blockedRetreatMemoryForOutput(compact, output);
  if (!memory) return output;

  const source = memory.sourceRelationshipShift || {};
  const actor = character?.name || output.characterName || output.characterId || "人物";
  const object = blockedRetreatObject(memory, compact);
  const memorySource = memory.source || source.generatedFrom || "agent_dialogue_relationship";
  const pressureLine = memory.privateVersion || memory.distortion || memory.content || source.eventOutcome || source.followupTurn || "";
  const visibleAction = VISIBLE_RETREAT_RE.test(String(output.visibleAction || ""))
    ? output.visibleAction
    : appendUniqueText(output.visibleAction, blockedRetreatVisibleTail(character || output, memory, compact));

  return {
    ...output,
    tone: output.tone === "试探" || !output.tone ? "伪装" : output.tone,
    visibleAction,
    hiddenAction: appendUniqueText(output.hiddenAction, pressureLine),
    desireReason: appendUniqueText(output.desireReason, pressureLine),
    memoryId: output.memoryId || memory.id || null,
    memoryInfluence: appendUniqueText(
      output.memoryInfluence,
      `记忆“${memory.content || memory.publicVersion || memory.id}”以${memory.type || "relationship"}形式回流，迫使${actor}先寻找退路。`,
    ),
    memoryUse: appendUniqueText(
      output.memoryUse,
      `${memorySource}：${memory.publicVersion || source.eventOutcome || memory.content || "上一场关系对话仍未结清"}`,
    ),
    memoryDistortionAction: appendUniqueText(
      output.memoryDistortionAction,
      `${actor}把退路被堵住的记忆压成体面退让，动作转向${object}、门槛和未盖印的位置。`,
    ),
    realtimePublicGoal: visibleAction,
    realtimePrivateDesire: appendUniqueText(output.realtimePrivateDesire, pressureLine),
    realtimeDefensiveMask: appendUniqueText(output.realtimeDefensiveMask, `把寻找另一条退路说成继续按城规谈${object}。`),
    realtimeActionCandidate: visibleAction,
  };
}
