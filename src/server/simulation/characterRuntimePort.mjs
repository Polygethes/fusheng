/** Replaceable runtime port for one Character Agent session. */

export const CHARACTER_RUNTIME_PORT_VERSION = "character-runtime-port-v1";

const MAX_RUNTIME_MESSAGES = 256;

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

export function assertCharacterRuntimePort(port = {}) {
  for (const method of ["openSession", "enqueueWake", "runTurn", "applyWorldOutcome", "checkpoint", "closeSession"]) {
    if (typeof port?.[method] !== "function") {
      throw fail("CHARACTER_RUNTIME_PORT_INVALID", `Character runtime port is missing ${method}.`, { method });
    }
  }
  return port;
}

function assertNoWorldWrite(result = {}) {
  for (const key of ["worldPatch", "worldState", "statePatch", "committedEvent", "worldMutation"]) {
    if (Object.hasOwn(result || {}, key)) {
      throw fail("CHARACTER_RUNTIME_WORLD_WRITE_FORBIDDEN", "Character runtime attempted to write objective world state.", { key });
    }
  }
}

function boundedRuntimeMessages(messages = []) {
  return clone(Array.isArray(messages) ? messages : []).slice(-MAX_RUNTIME_MESSAGES);
}

function appendRuntimeMessage(session, message = {}) {
  session.messages = [...session.messages, clone(message)].slice(-MAX_RUNTIME_MESSAGES);
}

export function createLocalCharacterRuntimePort({
  runTurn,
  applyWorldOutcome = async () => ({}),
} = {}) {
  if (typeof runTurn !== "function") {
    throw fail("CHARACTER_RUNTIME_RUN_TURN_REQUIRED", "Local character runtime requires a turn function.");
  }
  const sessions = new Map();
  let sequence = 0;

  function sessionFor(handle = {}) {
    const session = sessions.get(clean(handle.sessionId));
    if (!session || session.closed) throw fail("CHARACTER_RUNTIME_SESSION_UNKNOWN", "Character runtime session is not open.");
    return session;
  }

  return assertCharacterRuntimePort({
    version: CHARACTER_RUNTIME_PORT_VERSION,
    async openSession(input = {}) {
      const characterId = clean(input.characterId);
      if (!characterId) throw fail("CHARACTER_RUNTIME_CHARACTER_ID_REQUIRED", "Opening a character session requires characterId.");
      const sessionId = `character-session:${characterId}:${++sequence}`;
      sessions.set(sessionId, {
        sessionId,
        characterId,
        messages: boundedRuntimeMessages(input.runtimeCheckpoint?.messages),
        adapterState: clone(input.runtimeCheckpoint?.adapterState || {}),
        closed: false,
      });
      return Object.freeze({ sessionId, characterId });
    },
    async enqueueWake(handle, wake = {}) {
      const session = sessionFor(handle);
      if (clean(wake.recipientCharacterId) && clean(wake.recipientCharacterId) !== session.characterId) {
        throw fail("CHARACTER_RUNTIME_WAKE_RECIPIENT_MISMATCH", "Runtime wake belongs to another character.");
      }
      appendRuntimeMessage(session, { kind: "wake", value: wake });
    },
    async runTurn(handle, input = {}) {
      const session = sessionFor(handle);
      if (clean(input.characterId) !== session.characterId) {
        throw fail("CHARACTER_RUNTIME_TURN_CHARACTER_MISMATCH", "Runtime turn belongs to another character.");
      }
      const result = await runTurn(clone(input), {
        sessionId: session.sessionId,
        characterId: session.characterId,
        adapterState: clone(session.adapterState),
        updateAdapterState(next) { session.adapterState = clone(next); },
      });
      assertNoWorldWrite(result);
      appendRuntimeMessage(session, { kind: "turn_result", agentTurnId: input.agentTurnId });
      return clone(result || {});
    },
    async applyWorldOutcome(handle, outcome = {}, context = {}) {
      const session = sessionFor(handle);
      if (clean(outcome.actorId) && clean(outcome.actorId) !== session.characterId) {
        throw fail("CHARACTER_RUNTIME_OUTCOME_ACTOR_MISMATCH", "World outcome belongs to another character.");
      }
      const privateContext = clone(context.privateContext || {});
      if (clean(privateContext.ownerCharacterId) && clean(privateContext.ownerCharacterId) !== session.characterId) {
        throw fail("CHARACTER_RUNTIME_OUTCOME_PRIVATE_OWNER_MISMATCH", "Outcome private context belongs to another character.");
      }
      const result = await applyWorldOutcome(clone(outcome), {
        sessionId: session.sessionId,
        characterId: session.characterId,
        adapterState: clone(session.adapterState),
        // This is a detached snapshot. The adapter may calculate a patch from
        // it but cannot mutate the Actor's live private state.
        privateContext,
      });
      assertNoWorldWrite(result);
      appendRuntimeMessage(session, { kind: "world_outcome", outcomeId: clean(outcome.outcomeId) });
      return clone(result || {});
    },
    async finalizeTurn(handle, agentTurnId) {
      const session = sessionFor(handle);
      if (session.adapterState.inFlightTurn?.agentTurnId === agentTurnId) delete session.adapterState.inFlightTurn;
    },
    async checkpoint(handle) {
      const session = sessionFor(handle);
      return {
        version: CHARACTER_RUNTIME_PORT_VERSION,
        characterId: session.characterId,
        messages: clone(session.messages),
        adapterState: clone(session.adapterState),
      };
    },
    async closeSession(handle) {
      const session = sessionFor(handle);
      session.closed = true;
    },
  });
}
