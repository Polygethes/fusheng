/**
 * Pure semantic classifier for one proposed public action/speech turn.
 *
 * This module never rewrites prose and never commits world state. Physical
 * action contradictions remain hard violations because visibleAction is a
 * proposed world mutation. Speech contradictions are claim annotations: a
 * person may lie, guess, misremember, tease, evade, or address somebody badly
 * without thereby changing the objective world.
 */

export const SEMANTIC_VIOLATION_CODES = Object.freeze({
  DIALOGUE_TARGET_MISMATCH: "DIALOGUE_TARGET_MISMATCH",
  VISIBLE_ACTION_TARGET_MISMATCH: "VISIBLE_ACTION_TARGET_MISMATCH",
  VISIBLE_ACTION_SOURCE_ZONE_MISMATCH: "VISIBLE_ACTION_SOURCE_ZONE_MISMATCH",
  VISIBLE_ACTION_DESTINATION_UNCOMMITTED: "VISIBLE_ACTION_DESTINATION_UNCOMMITTED",
  UNSUPPORTED_PERCEPTION_CLAIM: "UNSUPPORTED_PERCEPTION_CLAIM",
  UNSUPPORTED_TEMPORAL_CLAIM: "UNSUPPORTED_TEMPORAL_CLAIM",
  MISSING_OPEN_CONVERSATION_SOURCE: "MISSING_OPEN_CONVERSATION_SOURCE",
});

const ANSWER_ACTS = new Set(["answer", "reply", "respond", "response"]);
const HARD_SEMANTIC_CODES = new Set([
  SEMANTIC_VIOLATION_CODES.VISIBLE_ACTION_TARGET_MISMATCH,
  SEMANTIC_VIOLATION_CODES.VISIBLE_ACTION_SOURCE_ZONE_MISMATCH,
  SEMANTIC_VIOLATION_CODES.VISIBLE_ACTION_DESTINATION_UNCOMMITTED,
]);
const SINGLE_CHARACTER_ADDRESS_ALIASES = new Set(["爹", "娘", "哥", "姐", "叔", "伯", "婶", "爷", "奶", "师"]);
const AUDIO_CHANNELS = new Set([
  "hearing", "audio", "auditory", "conversation", "dialogue", "overheard", "direct_speech",
]);
const PERCEPTION_CLAIM_PATTERN = /(?:(?:方才|刚才|刚刚|先前|刚)\s*[^，。！？!?]{0,8}(?:听见|听到)|(?:听见|听到)\s*[^，。！？!?]{0,8}(?:方才|刚才|刚刚|先前))/u;
const ORIENTATION_BEFORE_NAME = /(?:转身|转头|回身|侧身|抬头)?(?:看向|望向|面向|迎向|走向|转向|回望|走到|来到|站到|靠近|盯着|注视|朝|向|往)(?:[^，。！？!?；;]{0,16})$/u;
const TEMPORAL_GROUPS = Object.freeze([
  { key: "next_day", label: "明日/明早", pattern: /明早|明日|明天|翌日/u },
  { key: "previous_day", label: "昨日/昨天", pattern: /昨日|昨天|昨晚|昨夜|昨儿/u },
]);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueStrings(values) {
  return [...new Set(asArray(values).flatMap((value) => asArray(value)).map(cleanText).filter(Boolean))];
}

function candidateShape(candidate = {}) {
  const actorId = cleanText(candidate.actorId || candidate.characterId || candidate.speakerId);
  const dialogueTargetId = cleanText(candidate.addresseeId || candidate.dialogueTargetId || candidate.targetId || candidate.targetCharacterId);
  const actionTargetId = cleanText(candidate.targetCharacterId || candidate.actionTargetId || candidate.targetId || candidate.addresseeId);
  return {
    actorId,
    actorZoneId: cleanText(candidate.actorZoneId || candidate.sourceZoneId),
    moveToZoneId: cleanText(candidate.moveToZoneId || candidate.destinationZoneId || candidate.toZoneId),
    targetId: dialogueTargetId || actionTargetId,
    dialogueTargetId,
    actionTargetId,
    speechAct: cleanText(candidate.speechAct || candidate.act).toLowerCase(),
    utterance: cleanText(candidate.utterance || candidate.line || candidate.spokenLine),
    visibleAction: cleanText(candidate.visibleAction || candidate.actionText),
    conversationId: cleanText(candidate.conversationId || candidate.openConversationId),
    responseToTurnId: cleanText(candidate.responseToTurnId || candidate.sourceTurnId || candidate.respondsTo),
  };
}

function sourceZoneClaim(visibleAction = "", context = {}) {
  const text = cleanText(visibleAction);
  for (const zone of asArray(context.zones)) {
    const id = cleanText(zone.id || zone.zoneId);
    const label = cleanText(zone.label || zone.name);
    for (const alias of uniqueStrings([label, zone.aliases])) {
      if (alias && text.includes(`从${alias}`)) return { id, label: label || alias, alias };
    }
  }
  return null;
}

function destinationZoneClaim(visibleAction = "", context = {}) {
  const text = cleanText(visibleAction);
  for (const zone of asArray(context.zones)) {
    const id = cleanText(zone.id || zone.zoneId);
    const label = cleanText(zone.label || zone.name);
    for (const alias of uniqueStrings([label, zone.aliases])) {
      if (!alias) continue;
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const movementClaim = new RegExp(
        `(?:去往|走向|迈向|走进|进入|来到|回到|退到|跨进|走到)[^，。！？!?；;]{0,12}${escaped}`
        + `|(?:朝|向|往)[^，。！？!?；;]{0,8}${escaped}[^，。！？!?；;]{0,6}(?:走|去|迈|行|挪|靠|奔|跑|跨|进|退)`,
      );
      if (movementClaim.test(text)) return { id, label: label || alias, alias };
    }
  }
  return null;
}

function characterRows(context = {}) {
  if (Array.isArray(context.characters)) return context.characters;
  return Object.entries(context.characters || {}).map(([id, character]) => ({ id, ...(character || {}) }));
}

function aliasIndex(context = {}) {
  const rows = characterRows(context);
  const aliases = [];
  for (const character of rows) {
    const id = cleanText(character.id || character.characterId);
    const name = cleanText(character.name || character.characterName);
    if (!id) continue;
    const values = uniqueStrings([name, character.aliases, character.addressAliases, character.publicAliases]);
    if (/^[\p{Script=Han}]{3,}$/u.test(name)) values.push(name.slice(1));
    for (const alias of uniqueStrings(values)) {
      if (alias.length < 2 && !SINGLE_CHARACTER_ADDRESS_ALIASES.has(alias)) continue;
      aliases.push({ id, name: name || alias, alias });
    }
  }
  return aliases.sort((a, b) => b.alias.length - a.alias.length || a.alias.localeCompare(b.alias));
}

function openingAddress(utterance = "", aliases = []) {
  const text = cleanText(utterance).replace(/^[\s“”"'「」『』【】（(]+/u, "");
  for (const entry of aliases) {
    if (!text.startsWith(entry.alias)) continue;
    const following = text.slice(entry.alias.length, entry.alias.length + 1);
    if (!following || /[\s，,：:！!？?、]/u.test(following)) return entry;
  }
  return null;
}

function orientedCharacters(visibleAction = "", aliases = [], actorId = "") {
  const text = cleanText(visibleAction);
  const found = new Map();
  for (const entry of aliases) {
    if (entry.id === actorId) continue;
    let from = 0;
    while (from < text.length) {
      const index = text.indexOf(entry.alias, from);
      if (index < 0) break;
      const before = text.slice(Math.max(0, index - 28), index);
      if (ORIENTATION_BEFORE_NAME.test(before)) found.set(entry.id, entry);
      from = index + entry.alias.length;
    }
  }
  return [...found.values()];
}

function evidenceIds(candidate = {}, kind = "all") {
  const shared = [candidate.evidenceIds, candidate.sourceIds, candidate.sourceEventIds];
  const scoped = kind === "perception"
    ? [candidate.sourceObservationIds, candidate.perceptionEvidenceIds]
    : [candidate.temporalEvidenceIds, candidate.factSourceIds];
  return new Set(uniqueStrings([...shared, ...scoped]));
}

function recordId(record = {}) {
  return cleanText(record.id || record.observationId || record.factId || record.eventId);
}

function recordContent(record = {}) {
  return cleanText(record.content || record.text || record.description || record.utterance || record.line || record.summary);
}

function idsFromRecord(record = {}, keys = []) {
  return new Set(uniqueStrings(keys.map((key) => record?.[key])));
}

function recordKnownBy(record = {}, actorId = "") {
  if (!actorId) return false;
  if ([record.observerId, record.characterId, record.knowerId, record.sourceCharacterId, record.actorId].some((id) => cleanText(id) === actorId)) {
    return true;
  }
  const explicit = idsFromRecord(record, [
    "observerIds", "knownByCharacterIds", "perceivedByCharacterIds", "witnessCharacterIds", "participantIds",
  ]);
  return explicit.has(actorId);
}

function perceptionClaimAnchors(candidate = {}) {
  const source = cleanText(`${candidate.visibleAction || candidate.actionText || ""} ${candidate.utterance || candidate.line || candidate.spokenLine || ""}`);
  const heard = source.match(/(?:听见|听到)([^，。！？!?]{1,32})/u)?.[1] || "";
  if (!heard) return [];
  const compact = heard.replace(/(?:方才|刚才|刚刚|先前|我|自己|已经|正在|在跟|跟您|跟他|说起|说了|说|的事|一声)/gu, "");
  const anchors = [];
  for (let index = 0; index < compact.length - 1; index += 1) {
    const pair = compact.slice(index, index + 2);
    if (/^[\p{Script=Han}]{2}$/u.test(pair) && !["有人", "他们", "这事", "那个"].includes(pair)) anchors.push(pair);
  }
  return uniqueStrings(anchors);
}

function citedObservationSupportsHearing(candidate = {}, context = {}, actorId = "") {
  const cited = evidenceIds(candidate, "perception");
  if (!cited.size) return false;
  const anchors = perceptionClaimAnchors(candidate);
  return asArray(context.observations).some((observation) => {
    if (!cited.has(recordId(observation)) || !recordKnownBy(observation, actorId)) return false;
    if (!AUDIO_CHANNELS.has(cleanText(observation.channel || observation.modality || observation.type).toLowerCase())) return false;
    if (!anchors.length) return true;
    const content = recordContent(observation);
    return anchors.some((anchor) => content.includes(anchor));
  });
}

function conversationRows(context = {}) {
  return [
    ...asArray(context.openConversations),
    ...asArray(context.conversations),
    ...asArray(context.openConversation),
  ].filter(Boolean);
}

function turnId(turn = {}) {
  return cleanText(turn.id || turn.turnId);
}

function sourceTurnFor(candidate = {}, context = {}) {
  const sourceId = cleanText(candidate.responseToTurnId || candidate.sourceTurnId || candidate.respondsTo);
  if (!sourceId) return null;
  for (const conversation of conversationRows(context)) {
    const turn = asArray(conversation.turns).find((item) => turnId(item) === sourceId);
    if (turn) return { conversation, turn };
  }
  const turn = asArray(context.turns || context.publicTranscript).find((item) => turnId(item) === sourceId);
  return turn ? { conversation: null, turn } : null;
}

function directSourceTurnWasHeard(candidate = {}, context = {}, actorId = "") {
  const source = sourceTurnFor(candidate, context);
  if (!source) return false;
  const addresseeId = cleanText(source.turn.addresseeId || source.turn.targetId || source.turn.targetCharacterId);
  return addresseeId === actorId;
}

function temporalClaims(text = "") {
  return TEMPORAL_GROUPS.filter((group) => group.pattern.test(text));
}

function recordSupportsTemporalGroup(record = {}, group, actorId = "") {
  if (!recordKnownBy(record, actorId)) return false;
  const searchable = `${recordContent(record)} ${uniqueStrings(record.tags).join(" ")}`;
  return group.pattern.test(searchable);
}

function isCited(record = {}, cited = new Set()) {
  return cited.has(recordId(record));
}

function sourceTurnSupportsTemporalGroup(candidate = {}, context = {}, actorId = "", group) {
  const source = sourceTurnFor(candidate, context);
  if (!source) return false;
  const addresseeId = cleanText(source.turn.addresseeId || source.turn.targetId || source.turn.targetCharacterId);
  return addresseeId === actorId && group.pattern.test(recordContent(source.turn));
}

function candidateIntroducesTemporalCommitment(candidate = {}, actorId = "", group) {
  if (group.key !== "next_day") return false;
  return asArray(candidate.newTemporalCommitments).some((commitment) => {
    if (!commitment || typeof commitment !== "object") return false;
    const ownerId = cleanText(commitment.ownerId || commitment.characterId);
    const kind = cleanText(commitment.kind || commitment.type).toLowerCase();
    const introduced = commitment.introducedByActor === true || kind === "new_commitment";
    return ownerId === actorId && introduced && group.pattern.test(recordContent(commitment));
  });
}

function hasTemporalProvenance(candidate = {}, context = {}, actorId = "", group) {
  const cited = evidenceIds(candidate, "temporal");
  const recordCollections = [context.facts, context.observations, context.events];
  if (recordCollections.some((records) => asArray(records).some((record) => (
    isCited(record, cited) && recordSupportsTemporalGroup(record, group, actorId)
  )))) return true;
  if (sourceTurnSupportsTemporalGroup(candidate, context, actorId, group)) return true;
  return candidateIntroducesTemporalCommitment(candidate, actorId, group);
}

function conversationIsOpen(conversation = {}) {
  const status = cleanText(conversation.status || "open").toLowerCase();
  return status === "open" || status === "active" || status === "waiting";
}

function hasOpenAnswerSource(candidate = {}, context = {}, normalized = candidateShape(candidate)) {
  const sourceId = normalized.responseToTurnId;
  if (!sourceId) return false;
  return conversationRows(context).some((conversation) => {
    if (!conversationIsOpen(conversation)) return false;
    const id = cleanText(conversation.id || conversation.conversationId);
    if (normalized.conversationId && id !== normalized.conversationId) return false;
    const participants = idsFromRecord(conversation, ["participantIds", "participants"]);
    if (participants.size && !participants.has(normalized.actorId)) return false;
    if (participants.size && normalized.dialogueTargetId && !participants.has(normalized.dialogueTargetId)) return false;
    const expected = cleanText(conversation.expectedResponderId || conversation.nextSpeakerId);
    if (expected && expected !== normalized.actorId) return false;
    const openTurnIds = idsFromRecord(conversation, ["openTurnIds", "unansweredTurnIds"]);
    if (openTurnIds.size && !openTurnIds.has(sourceId)) return false;
    const turn = asArray(conversation.turns).find((item) => turnId(item) === sourceId);
    if (!turn) return false;
    const addresseeId = cleanText(turn.addresseeId || turn.targetId || turn.targetCharacterId);
    const speakerId = cleanText(turn.speakerId || turn.characterId || turn.actorId);
    if (addresseeId !== normalized.actorId) return false;
    if (normalized.dialogueTargetId && speakerId !== normalized.dialogueTargetId) return false;
    return true;
  });
}

function violation(code, field, message, evidence = {}) {
  return { code, field, message, evidence };
}

export function validateSemanticTurn(candidate = {}, context = {}) {
  const normalized = candidateShape(candidate);
  const aliases = aliasIndex(context);
  const violations = [];

  if (normalized.visibleAction && normalized.actorZoneId) {
    const claimedZone = sourceZoneClaim(normalized.visibleAction, context);
    if (claimedZone?.id && claimedZone.id !== normalized.actorZoneId) {
      violations.push(violation(
        SEMANTIC_VIOLATION_CODES.VISIBLE_ACTION_SOURCE_ZONE_MISMATCH,
        "visibleAction",
        `可见动作声称人物从${claimedZone.label}开始，但人物当前并不在该区域。`,
        { actorId: normalized.actorId, actualZoneId: normalized.actorZoneId, claimedZoneId: claimedZone.id, detectedAlias: claimedZone.alias },
      ));
    }
  }


  if (normalized.visibleAction) {
    const claimedDestination = destinationZoneClaim(normalized.visibleAction, context);
    if (claimedDestination?.id && claimedDestination.id !== normalized.moveToZoneId) {
      violations.push(violation(
        SEMANTIC_VIOLATION_CODES.VISIBLE_ACTION_DESTINATION_UNCOMMITTED,
        "visibleAction",
        `可见动作声称人物走向${claimedDestination.label}，但结构化动作没有提交同一目的地。`,
        {
          actorId: normalized.actorId,
          committedDestinationZoneId: normalized.moveToZoneId,
          claimedDestinationZoneId: claimedDestination.id,
          detectedAlias: claimedDestination.alias,
        },
      ));
    }
  }

  if (normalized.utterance && normalized.dialogueTargetId) {
    const addressed = openingAddress(normalized.utterance, aliases);
    if (addressed && addressed.id !== normalized.dialogueTargetId) {
      violations.push(violation(
        SEMANTIC_VIOLATION_CODES.DIALOGUE_TARGET_MISMATCH,
        "utterance",
        `台词句首称呼的是${addressed.name}，但结构化对话对象不是此人。`,
        { actorId: normalized.actorId, targetId: normalized.dialogueTargetId, detectedCharacterId: addressed.id, detectedAlias: addressed.alias },
      ));
    }
  }

  if (normalized.visibleAction && normalized.actionTargetId) {
    const oriented = orientedCharacters(normalized.visibleAction, aliases, normalized.actorId);
    if (oriented.length && !oriented.some((entry) => entry.id === normalized.actionTargetId)) {
      violations.push(violation(
        SEMANTIC_VIOLATION_CODES.VISIBLE_ACTION_TARGET_MISMATCH,
        "visibleAction",
        `可见动作朝向${oriented.map((entry) => entry.name).join("、")}，但结构化行动对象不是其中任何一人。`,
        { actorId: normalized.actorId, targetId: normalized.actionTargetId, detectedCharacterIds: oriented.map((entry) => entry.id) },
      ));
    }
  }

  const combinedText = `${normalized.visibleAction} ${normalized.utterance}`.trim();
  if (PERCEPTION_CLAIM_PATTERN.test(combinedText)
    && !citedObservationSupportsHearing(candidate, context, normalized.actorId)
    && !directSourceTurnWasHeard(candidate, context, normalized.actorId)) {
    violations.push(violation(
      SEMANTIC_VIOLATION_CODES.UNSUPPORTED_PERCEPTION_CLAIM,
      normalized.utterance ? "utterance" : "visibleAction",
      "人物声称方才听见了某事，但没有引用属于自己的听觉观察或被直接说给自己的原话。",
      { actorId: normalized.actorId, citedEvidenceIds: [...evidenceIds(candidate, "perception")] },
    ));
  }

  for (const group of temporalClaims(combinedText)) {
    if (hasTemporalProvenance(candidate, context, normalized.actorId, group)) continue;
    violations.push(violation(
      SEMANTIC_VIOLATION_CODES.UNSUPPORTED_TEMPORAL_CLAIM,
      normalized.utterance ? "utterance" : "visibleAction",
      `人物提出了${group.label}的既存安排或历史事实，但没有引用自己知道的事实、观察或原话。`,
      { actorId: normalized.actorId, temporalGroup: group.key, citedEvidenceIds: [...evidenceIds(candidate, "temporal")] },
    ));
  }

  if (ANSWER_ACTS.has(normalized.speechAct) && !hasOpenAnswerSource(candidate, context, normalized)) {
    violations.push(violation(
      SEMANTIC_VIOLATION_CODES.MISSING_OPEN_CONVERSATION_SOURCE,
      "responseToTurnId",
      "普通回答必须指向一个仍开放、明确交给当前人物回答的原始话轮。",
      { actorId: normalized.actorId, targetId: normalized.dialogueTargetId, conversationId: normalized.conversationId, responseToTurnId: normalized.responseToTurnId },
    ));
  }

  const hardViolations = violations.filter((row) => HARD_SEMANTIC_CODES.has(row.code));
  const claimAnnotations = violations.filter((row) => !HARD_SEMANTIC_CODES.has(row.code));
  return {
    ok: hardViolations.length === 0,
    violations: hardViolations,
    hardViolations,
    claimAnnotations,
    diagnostics: violations,
    normalized: {
      actorId: normalized.actorId,
      targetId: normalized.targetId,
      dialogueTargetId: normalized.dialogueTargetId,
      actionTargetId: normalized.actionTargetId,
      speechAct: normalized.speechAct,
      moveToZoneId: normalized.moveToZoneId,
    },
  };
}

export class SemanticTurnValidationError extends Error {
  constructor(result) {
    super(`Semantic turn rejected: ${result.violations.map((item) => item.code).join(", ")}`);
    this.name = "SemanticTurnValidationError";
    this.result = result;
  }
}

export function assertSemanticTurn(candidate = {}, context = {}) {
  const result = validateSemanticTurn(candidate, context);
  if (!result.ok) throw new SemanticTurnValidationError(result);
  return result;
}
