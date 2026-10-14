/** Recipient-safe model context assembly for one persistent character. */

export const CHARACTER_CONTEXT_ASSEMBLER_VERSION = "character-context-assembler-v1";

const FORBIDDEN_WORLD_AUTHORITY_KEYS = new Set([
  "globalWorldState",
  "worldState",
  "worldJournal",
  "worldEventJournal",
  "journal",
  "otherCharacterPrivateStates",
  "serverIdentityMap",
  "canonicalIdentityMap",
  "directorInstruction",
  "writerInstruction",
  "selectedAction",
]);

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function fail(code, message, evidence = {}) {
  const error = new Error(message);
  error.code = code;
  error.evidence = clone(evidence);
  return error;
}

function findForbiddenKey(value, path = "projection", seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_WORLD_AUTHORITY_KEYS.has(key)) return childPath;
    const nested = findForbiddenKey(child, childPath, seen);
    if (nested) return nested;
  }
  return null;
}

export function assembleCharacterTurnContext({
  characterId = "",
  agentTurnId = "",
  wake = {},
  worldVersion = 0,
  situationProjection = {},
  privateState = {},
  rememberedContext = {},
  receiptEvidenceIds = null,
} = {}) {
  const ownerId = clean(characterId);
  if (!ownerId) throw fail("CHARACTER_CONTEXT_CHARACTER_ID_REQUIRED", "Character context requires a character id.");
  if (!clean(agentTurnId)) throw fail("CHARACTER_CONTEXT_TURN_ID_REQUIRED", "Character context requires an Agent turn id.");
  if (clean(wake.recipientCharacterId) && clean(wake.recipientCharacterId) !== ownerId) {
    throw fail("CHARACTER_CONTEXT_WAKE_RECIPIENT_MISMATCH", "Wake belongs to another character.", {
      characterId: ownerId,
      recipientCharacterId: wake.recipientCharacterId,
    });
  }
  if (clean(situationProjection.authority) !== "recipient-specific-world-projection") {
    throw fail("CHARACTER_CONTEXT_PROJECTION_AUTHORITY_INVALID", "Situation projection must already be recipient-specific.");
  }
  if (clean(situationProjection.recipientCharacterId)
    && clean(situationProjection.recipientCharacterId) !== ownerId) {
    throw fail("CHARACTER_CONTEXT_PROJECTION_RECIPIENT_MISMATCH", "Situation projection belongs to another character.");
  }
  const forbiddenPath = findForbiddenKey(situationProjection);
  if (forbiddenPath) {
    throw fail("CHARACTER_CONTEXT_FORBIDDEN_WORLD_AUTHORITY", "Recipient context contains forbidden global world authority.", {
      path: forbiddenPath,
    });
  }
  if (clean(privateState.ownerCharacterId) && clean(privateState.ownerCharacterId) !== ownerId) {
    throw fail("CHARACTER_CONTEXT_PRIVATE_OWNER_MISMATCH", "Private state belongs to another character.");
  }
  const version = Math.max(0, Math.floor(Number(worldVersion || 0)));
  return {
    schemaVersion: CHARACTER_CONTEXT_ASSEMBLER_VERSION,
    authority: "character-context-assembler",
    agentTurnId: clean(agentTurnId),
    characterId: ownerId,
    expectedWorldVersion: version,
    wake: clone(wake),
    worldProjection: {
      ...clone(situationProjection),
      recipientCharacterId: ownerId,
    },
    privateContext: clone(privateState),
    rememberedContext: clone(rememberedContext || {}),
    // The host froze which evidence ids the receipt ledger still accepts for
    // this turn. Input construction must not offer retained self-evidence
    // outside this scope, or the Agent could cite an id that settlement will
    // reject as expired. Null means the host supplied no ledger scope.
    hostReceiptEvidenceIds: Array.isArray(receiptEvidenceIds)
      ? receiptEvidenceIds.map(clean).filter(Boolean)
      : null,
    actionSubmissionContract: {
      authority: "character-agent-submits-attempt-only",
      expectedWorldVersion: version,
      directWorldWriteAllowed: false,
    },
  };
}
