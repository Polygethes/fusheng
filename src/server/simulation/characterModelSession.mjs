/**
 * Character-owned continuity boundary for a conversational model provider.
 *
 * One CharacterModelSession belongs to exactly one character. It keeps the
 * provider conversation alive across protocol stages and later Agent turns;
 * it does not decide actions, validate world facts, or own objective state.
 */

export const CHARACTER_MODEL_PROVIDER_PORT_VERSION = "character-model-provider-port-v1";
export const CHARACTER_MODEL_SESSION_VERSION = "character-model-session-v1";
export const CHARACTER_MODEL_SESSION_POOL_VERSION = "character-model-session-pool-v1";

const MAX_STAGE_JOURNAL_ENTRIES = 256;

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function providerStageOptions(options = {}) {
  const plain = { ...(options || {}) };
  // AbortSignal and request-budget tokens are command-scoped capabilities,
  // not serializable character state.  Cloning either destroys its identity
  // (and may make the budget impossible to verify), so preserve only these
  // explicit handles while cloning ordinary option data.
  delete plain.signal;
  delete plain.requestBudget;
  return {
    ...clone(plain),
    ...(options?.signal ? { signal: options.signal } : {}),
    ...(options?.requestBudget ? { requestBudget: options.requestBudget } : {}),
  };
}

function fail(code, message, evidence = {}) {
  const error = new Error(message);
  error.code = code;
  error.evidence = clone(evidence);
  return error;
}

function checkpointVersion(checkpoint = {}) {
  return clean(checkpoint.schemaVersion || checkpoint.version);
}

function assertCheckpointVersion(checkpoint = {}, expected, code) {
  const actual = checkpointVersion(checkpoint);
  if (actual && actual !== expected) {
    throw fail(code, "Character model session checkpoint version is not supported.", {
      expected,
      actual,
    });
  }
}

function normalizeStageJournal(rows = []) {
  if (!Array.isArray(rows)) {
    throw fail(
      "CHARACTER_MODEL_SESSION_JOURNAL_INVALID",
      "Character model session stage journal must be an array.",
    );
  }
  return rows.map((row, index) => {
    const stageSequence = Number(row?.stageSequence || index + 1);
    const agentTurnId = clean(row?.agentTurnId);
    const phase = clean(row?.phase);
    if (!Number.isInteger(stageSequence) || stageSequence < 1 || !agentTurnId || !phase) {
      throw fail(
        "CHARACTER_MODEL_SESSION_JOURNAL_ENTRY_INVALID",
        "Character model session stage journal contains an invalid entry.",
        { index },
      );
    }
    return { stageSequence, agentTurnId, phase };
  });
}

/**
 * A provider adapter must preserve the conversation named by the handle. The
 * handle itself is opaque apart from its owner and stable conversation id.
 */
export function assertCharacterModelProviderPort(port = {}) {
  for (const method of ["openConversation", "runStage", "checkpointConversation", "closeConversation"]) {
    if (typeof port?.[method] !== "function") {
      throw fail(
        "CHARACTER_MODEL_PROVIDER_PORT_INVALID",
        `Character model provider port is missing ${method}.`,
        { method },
      );
    }
  }
  return port;
}

class CharacterModelSession {
  constructor({ characterId, providerPort, checkpoint = null } = {}) {
    assertCheckpointVersion(
      checkpoint || {},
      CHARACTER_MODEL_SESSION_VERSION,
      "CHARACTER_MODEL_SESSION_CHECKPOINT_VERSION_UNSUPPORTED",
    );
    this.characterId = clean(characterId || checkpoint?.characterId);
    if (!this.characterId) {
      throw fail(
        "CHARACTER_MODEL_SESSION_CHARACTER_REQUIRED",
        "Character model session requires characterId.",
      );
    }
    if (clean(checkpoint?.characterId) && clean(checkpoint.characterId) !== this.characterId) {
      throw fail(
        "CHARACTER_MODEL_SESSION_CHECKPOINT_OWNER_MISMATCH",
        "Character model checkpoint belongs to another character.",
        { characterId: this.characterId, checkpointCharacterId: checkpoint.characterId },
      );
    }
    this.providerPort = assertCharacterModelProviderPort(providerPort);
    this.providerConversationId = clean(checkpoint?.providerConversationId);
    this.providerCheckpoint = clone(checkpoint?.providerCheckpoint ?? null);
    const restoredStageJournal = normalizeStageJournal(checkpoint?.stageJournal || []);
    this.stageSequence = Number(
      checkpoint?.stageSequence ?? restoredStageJournal.at(-1)?.stageSequence ?? 0,
    );
    this.stageJournal = restoredStageJournal.slice(-MAX_STAGE_JOURNAL_ENTRIES);
    if (!Number.isInteger(this.stageSequence) || this.stageSequence < 0) {
      throw fail(
        "CHARACTER_MODEL_SESSION_SEQUENCE_INVALID",
        "Character model session stage sequence must be a non-negative integer.",
      );
    }
    const lastStageSequence = this.stageJournal.at(-1)?.stageSequence || 0;
    if (lastStageSequence > this.stageSequence) {
      throw fail(
        "CHARACTER_MODEL_SESSION_JOURNAL_AHEAD",
        "Character model session journal is ahead of its stage sequence.",
      );
    }
    this.handle = null;
    this.activeStage = null;
    this.closed = false;
  }

  async open() {
    if (this.closed) {
      throw fail(
        "CHARACTER_MODEL_SESSION_CLOSED",
        "Closed character model session cannot be reopened; restore its checkpoint instead.",
        { characterId: this.characterId },
      );
    }
    if (this.handle) return this.snapshot();
    const requestedConversationId = this.providerConversationId;
    const handle = await this.providerPort.openConversation({
      schemaVersion: CHARACTER_MODEL_PROVIDER_PORT_VERSION,
      characterId: this.characterId,
      providerConversationId: requestedConversationId,
      providerCheckpoint: clone(this.providerCheckpoint),
    });
    if (!handle || typeof handle !== "object" || Array.isArray(handle)) {
      throw fail(
        "CHARACTER_MODEL_PROVIDER_HANDLE_INVALID",
        "Model provider returned an invalid conversation handle.",
      );
    }
    const handleCharacterId = clean(handle.characterId);
    const handleConversationId = clean(handle.providerConversationId);
    if (!handleCharacterId || handleCharacterId !== this.characterId) {
      throw fail(
        "CHARACTER_MODEL_PROVIDER_HANDLE_OWNER_MISMATCH",
        "Model provider conversation handle belongs to another character.",
        { characterId: this.characterId, handleCharacterId },
      );
    }
    if (!handleConversationId) {
      throw fail(
        "CHARACTER_MODEL_PROVIDER_CONVERSATION_ID_REQUIRED",
        "Model provider conversation handle requires providerConversationId.",
      );
    }
    if (requestedConversationId && handleConversationId !== requestedConversationId) {
      throw fail(
        "CHARACTER_MODEL_PROVIDER_CONVERSATION_REPLACED",
        "Model provider replaced a restored character conversation instead of resuming it.",
        { requestedConversationId, handleConversationId },
      );
    }
    this.handle = handle;
    this.providerConversationId = handleConversationId;
    return this.snapshot();
  }

  async runStage(input = {}, options = {}) {
    const inputCharacterId = clean(input.characterId);
    const agentTurnId = clean(input.agentTurnId);
    const phase = clean(input.phase);
    if (!inputCharacterId || inputCharacterId !== this.characterId) {
      throw fail(
        "CHARACTER_MODEL_SESSION_STAGE_OWNER_MISMATCH",
        "Character model stage belongs to another character.",
        { characterId: this.characterId, inputCharacterId },
      );
    }
    if (!agentTurnId || !phase) {
      throw fail(
        "CHARACTER_MODEL_SESSION_STAGE_IDENTITY_REQUIRED",
        "Character model stage requires agentTurnId and phase.",
        { agentTurnId, phase },
      );
    }
    if (this.activeStage) {
      throw fail(
        "CHARACTER_MODEL_SESSION_STAGE_ALREADY_ACTIVE",
        "One character model conversation may execute only one stage at a time.",
        { characterId: this.characterId, activeStage: clone(this.activeStage) },
      );
    }
    const nextStageSequence = this.stageSequence + 1;
    this.activeStage = { agentTurnId, phase, stageSequence: nextStageSequence };
    try {
      // Claim the character conversation before the first await. This keeps
      // two concurrent callers from opening or advancing the same private
      // model history at once.
      await this.open();
      const result = await this.providerPort.runStage(
        this.handle,
        clone(input),
        {
          ...providerStageOptions(options),
          authority: "character-model-session",
          characterId: this.characterId,
          providerConversationId: this.providerConversationId,
          stageSequence: nextStageSequence,
        },
      );
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw fail(
          "CHARACTER_MODEL_PROVIDER_STAGE_RESULT_INVALID",
          "Model provider stage result must be an object.",
        );
      }
      if (clean(result.characterId) && clean(result.characterId) !== this.characterId) {
        throw fail(
          "CHARACTER_MODEL_PROVIDER_STAGE_RESULT_OWNER_MISMATCH",
          "Model provider stage result belongs to another character.",
        );
      }
      if (clean(result.providerConversationId)
        && clean(result.providerConversationId) !== this.providerConversationId) {
        throw fail(
          "CHARACTER_MODEL_PROVIDER_CONVERSATION_CHANGED",
          "Model provider changed conversations during a character stage.",
        );
      }
      this.stageSequence = nextStageSequence;
      this.stageJournal = [
        ...this.stageJournal,
        { stageSequence: nextStageSequence, agentTurnId, phase },
      ].slice(-MAX_STAGE_JOURNAL_ENTRIES);
      return clone(result);
    } finally {
      this.activeStage = null;
    }
  }

  snapshot() {
    return {
      schemaVersion: CHARACTER_MODEL_SESSION_VERSION,
      characterId: this.characterId,
      providerConversationId: this.providerConversationId,
      stageSequence: this.stageSequence,
      lastStage: clone(this.stageJournal.at(-1) || null),
      open: Boolean(this.handle),
      active: Boolean(this.activeStage),
      closed: this.closed,
    };
  }

  async checkpoint() {
    if (this.activeStage) {
      throw fail(
        "CHARACTER_MODEL_SESSION_CHECKPOINT_DURING_STAGE",
        "Character model session cannot checkpoint during an active provider stage.",
        { characterId: this.characterId, activeStage: clone(this.activeStage) },
      );
    }
    let providerCheckpoint = clone(this.providerCheckpoint);
    if (this.handle) {
      providerCheckpoint = clone(await this.providerPort.checkpointConversation(this.handle));
      const checkpointCharacterId = clean(providerCheckpoint?.characterId);
      const checkpointConversationId = clean(providerCheckpoint?.providerConversationId);
      if (checkpointCharacterId && checkpointCharacterId !== this.characterId) {
        throw fail(
          "CHARACTER_MODEL_PROVIDER_CHECKPOINT_OWNER_MISMATCH",
          "Model provider checkpoint belongs to another character.",
        );
      }
      if (checkpointConversationId && checkpointConversationId !== this.providerConversationId) {
        throw fail(
          "CHARACTER_MODEL_PROVIDER_CHECKPOINT_CONVERSATION_MISMATCH",
          "Model provider checkpoint belongs to another conversation.",
        );
      }
    }
    return {
      schemaVersion: CHARACTER_MODEL_SESSION_VERSION,
      characterId: this.characterId,
      providerConversationId: this.providerConversationId,
      providerCheckpoint,
      stageSequence: this.stageSequence,
      stageJournal: clone(this.stageJournal),
    };
  }

  async close() {
    if (this.closed) return;
    if (this.activeStage) {
      throw fail(
        "CHARACTER_MODEL_SESSION_CLOSE_DURING_STAGE",
        "Character model session cannot close during an active provider stage.",
      );
    }
    if (this.handle) await this.providerPort.closeConversation(this.handle);
    this.handle = null;
    this.closed = true;
  }
}

export function createCharacterModelSession(input = {}) {
  return new CharacterModelSession(input);
}

export function restoreCharacterModelSession(checkpoint = {}, options = {}) {
  return new CharacterModelSession({
    ...options,
    characterId: checkpoint.characterId,
    checkpoint,
  });
}

class CharacterModelSessionPool {
  constructor({ providerPort, checkpoint = null } = {}) {
    assertCheckpointVersion(
      checkpoint || {},
      CHARACTER_MODEL_SESSION_POOL_VERSION,
      "CHARACTER_MODEL_SESSION_POOL_CHECKPOINT_VERSION_UNSUPPORTED",
    );
    this.providerPort = assertCharacterModelProviderPort(providerPort);
    this.sessions = new Map();
    this.conversationOwnerById = new Map();
    this.closed = false;
    const rows = checkpoint?.sessions || [];
    if (!Array.isArray(rows)) {
      throw fail(
        "CHARACTER_MODEL_SESSION_POOL_CHECKPOINT_INVALID",
        "Character model session pool checkpoint requires a sessions array.",
      );
    }
    for (const row of rows) {
      const characterId = clean(row?.characterId);
      if (!characterId || this.sessions.has(characterId)) {
        throw fail(
          "CHARACTER_MODEL_SESSION_POOL_CHARACTER_DUPLICATE",
          "Character model session pool contains a missing or duplicate character.",
          { characterId },
        );
      }
      const conversationId = clean(row?.providerConversationId);
      const priorOwner = conversationId ? this.conversationOwnerById.get(conversationId) : "";
      if (priorOwner && priorOwner !== characterId) {
        throw fail(
          "CHARACTER_MODEL_SESSION_CONVERSATION_SHARED",
          "Two characters may not share one provider conversation.",
          { conversationId, priorOwner, characterId },
        );
      }
      const session = restoreCharacterModelSession(row, { providerPort: this.providerPort });
      this.sessions.set(characterId, session);
      if (conversationId) this.conversationOwnerById.set(conversationId, characterId);
    }
  }

  assertOpen() {
    if (this.closed) {
      throw fail(
        "CHARACTER_MODEL_SESSION_POOL_CLOSED",
        "Closed character model session pool cannot be used.",
      );
    }
  }

  sessionFor(characterId = "") {
    this.assertOpen();
    const normalizedCharacterId = clean(characterId);
    if (!normalizedCharacterId) {
      throw fail(
        "CHARACTER_MODEL_SESSION_CHARACTER_REQUIRED",
        "Character model session requires characterId.",
      );
    }
    let session = this.sessions.get(normalizedCharacterId);
    if (!session) {
      session = createCharacterModelSession({
        characterId: normalizedCharacterId,
        providerPort: this.providerPort,
      });
      this.sessions.set(normalizedCharacterId, session);
    }
    return session;
  }

  reserveConversation(characterId, providerConversationId) {
    const owner = this.conversationOwnerById.get(providerConversationId);
    if (owner && owner !== characterId) {
      throw fail(
        "CHARACTER_MODEL_SESSION_CONVERSATION_SHARED",
        "Two characters may not share one provider conversation.",
        { providerConversationId, owner, characterId },
      );
    }
    this.conversationOwnerById.set(providerConversationId, characterId);
  }

  async runStage(input = {}, options = {}) {
    const characterId = clean(input.characterId);
    const session = this.sessionFor(characterId);
    const opened = await session.open();
    this.reserveConversation(characterId, opened.providerConversationId);
    return session.runStage(input, options);
  }

  snapshot(characterId = "") {
    if (clean(characterId)) return this.sessionFor(characterId).snapshot();
    return {
      schemaVersion: CHARACTER_MODEL_SESSION_POOL_VERSION,
      closed: this.closed,
      sessions: [...this.sessions.values()].map((session) => session.snapshot()),
    };
  }

  async checkpoint() {
    this.assertOpen();
    const sessions = [];
    for (const session of this.sessions.values()) sessions.push(await session.checkpoint());
    return {
      schemaVersion: CHARACTER_MODEL_SESSION_POOL_VERSION,
      sessions,
    };
  }

  async close() {
    if (this.closed) return;
    for (const session of this.sessions.values()) await session.close();
    this.closed = true;
  }
}

export function createCharacterModelSessionPool(input = {}) {
  return new CharacterModelSessionPool(input);
}

export function restoreCharacterModelSessionPool(checkpoint = {}, options = {}) {
  return new CharacterModelSessionPool({ ...options, checkpoint });
}
