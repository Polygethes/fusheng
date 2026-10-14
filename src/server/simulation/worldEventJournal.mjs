import { createHash } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";

export const WORLD_EVENT_JOURNAL_SCHEMA_VERSION = 1;
export const WORLD_EVENT_SCHEMA_VERSION = 1;

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalValue(value));
}

function fail(code, message, evidence = {}) {
  const error = new Error(message);
  error.code = code;
  error.evidence = clone(evidence);
  return error;
}

function envelopeWithoutIntegrity(event = {}) {
  const { integrity: _integrity, ...body } = event;
  return body;
}

function digestForEvent(event = {}) {
  return createHash("sha256")
    .update(canonicalStringify(envelopeWithoutIntegrity(event)))
    .digest("hex");
}

function validateEventIntegrity(event = {}) {
  if (event.integrity?.algorithm !== "sha256" || !clean(event.integrity?.digest)) {
    throw fail("WORLD_EVENT_INTEGRITY_MISSING", "Committed world event is missing its integrity digest.", {
      eventId: event.eventId,
    });
  }
  const actual = digestForEvent(event);
  if (actual !== event.integrity.digest) {
    throw fail("WORLD_EVENT_INTEGRITY_MISMATCH", "Committed world event no longer matches its integrity digest.", {
      eventId: event.eventId,
      expected: event.integrity.digest,
      actual,
    });
  }
}

function validateCommittedEvent(event = {}, {
  worldId,
  expectedVersion,
  previousEventIds = new Set(),
} = {}) {
  if (Number(event.schemaVersion) !== WORLD_EVENT_SCHEMA_VERSION) {
    throw fail("WORLD_EVENT_SCHEMA_UNSUPPORTED", "Unsupported committed world event schema.", {
      eventId: event.eventId,
      schemaVersion: event.schemaVersion,
    });
  }
  if (!clean(event.eventId)) throw fail("WORLD_EVENT_ID_REQUIRED", "Committed world event requires eventId.");
  if (!clean(event.type)) throw fail("WORLD_EVENT_TYPE_REQUIRED", "Committed world event requires type.", { eventId: event.eventId });
  if (worldId && event.worldId !== worldId) {
    throw fail("WORLD_EVENT_WORLD_MISMATCH", "Committed world event belongs to another world.", {
      eventId: event.eventId,
      expectedWorldId: worldId,
      actualWorldId: event.worldId,
    });
  }
  if (Number.isFinite(Number(expectedVersion)) && Number(event.worldVersion) !== Number(expectedVersion)) {
    throw fail("WORLD_EVENT_VERSION_NON_MONOTONIC", "World event version must advance by exactly one.", {
      eventId: event.eventId,
      expectedVersion,
      actualVersion: event.worldVersion,
    });
  }
  for (const parentId of event.causalParentEventIds || []) {
    if (!previousEventIds.has(parentId)) {
      throw fail("WORLD_EVENT_CAUSAL_PARENT_MISSING", "World event cites a causal parent that has not been committed.", {
        eventId: event.eventId,
        parentId,
      });
    }
  }
  validateEventIntegrity(event);
  return true;
}

function adoptCommittedEvent(journal, rawEvent) {
  const event = clone(rawEvent);
  const eventIds = new Set(journal.events.map((row) => row.eventId));
  if (eventIds.has(event.eventId)) {
    throw fail("WORLD_EVENT_ID_DUPLICATE", "World event id has already been committed.", { eventId: event.eventId });
  }
  validateCommittedEvent(event, {
    worldId: journal.worldId,
    expectedVersion: journal.worldVersion + 1,
    previousEventIds: eventIds,
  });
  const committed = deepFreeze(event);
  journal.events.push(committed);
  journal.worldVersion = committed.worldVersion;
  return committed;
}

export function createWorldEventJournal({ worldId = "", events = [] } = {}) {
  const normalizedWorldId = clean(worldId) || clean(events[0]?.worldId);
  if (!normalizedWorldId) throw fail("WORLD_EVENT_WORLD_ID_REQUIRED", "World event journal requires worldId.");
  const journal = {
    schemaVersion: WORLD_EVENT_JOURNAL_SCHEMA_VERSION,
    worldId: normalizedWorldId,
    worldVersion: 0,
    events: [],
  };
  for (const event of events || []) adoptCommittedEvent(journal, event);
  return journal;
}

export function appendWorldEvent(journal = {}, input = {}) {
  if (!journal || Number(journal.schemaVersion) !== WORLD_EVENT_JOURNAL_SCHEMA_VERSION) {
    throw fail("WORLD_EVENT_JOURNAL_INVALID", "appendWorldEvent requires a valid journal.");
  }
  const eventId = clean(input.eventId) || `world_event:${journal.worldId}:${journal.worldVersion + 1}`;
  if (journal.events.some((event) => event.eventId === eventId)) {
    throw fail("WORLD_EVENT_ID_DUPLICATE", "World event id has already been committed.", { eventId });
  }
  const nextVersion = journal.worldVersion + 1;
  if (input.worldVersion != null && Number(input.worldVersion) !== nextVersion) {
    throw fail("WORLD_EVENT_VERSION_NON_MONOTONIC", "World event version must advance by exactly one.", {
      eventId,
      expectedVersion: nextVersion,
      actualVersion: input.worldVersion,
    });
  }
  if (input.worldId && clean(input.worldId) !== journal.worldId) {
    throw fail("WORLD_EVENT_WORLD_MISMATCH", "World event belongs to another world.", {
      eventId,
      expectedWorldId: journal.worldId,
      actualWorldId: input.worldId,
    });
  }
  const previousEventIds = new Set(journal.events.map((event) => event.eventId));
  const causalParentEventIds = [...new Set((input.causalParentEventIds || []).map(clean).filter(Boolean))];
  for (const parentId of causalParentEventIds) {
    if (!previousEventIds.has(parentId)) {
      throw fail("WORLD_EVENT_CAUSAL_PARENT_MISSING", "World event cites a causal parent that has not been committed.", {
        eventId,
        parentId,
      });
    }
  }
  if (!clean(input.type)) throw fail("WORLD_EVENT_TYPE_REQUIRED", "World event requires type.", { eventId });
  const body = {
    schemaVersion: WORLD_EVENT_SCHEMA_VERSION,
    eventId,
    worldId: journal.worldId,
    worldVersion: nextVersion,
    occurredAtSeconds: Math.max(0, Number(input.occurredAtSeconds || 0)),
    committedAt: clean(input.committedAt) || new Date().toISOString(),
    type: clean(input.type),
    actorId: clean(input.actorId),
    placeId: clean(input.placeId),
    zoneId: clean(input.zoneId),
    causalParentEventIds,
    actionAttemptId: clean(input.actionAttemptId),
    publicPayload: clone(input.publicPayload || {}),
    privatePayloadRefs: [...new Set((input.privatePayloadRefs || []).map(clean).filter(Boolean))],
    statePatch: clone(input.statePatch || {}),
  };
  const event = {
    ...body,
    integrity: {
      algorithm: "sha256",
      digest: digestForEvent(body),
    },
  };
  return adoptCommittedEvent(journal, event);
}

export function validateWorldEventJournal(journal = {}) {
  const issues = [];
  try {
    if (Number(journal.schemaVersion) !== WORLD_EVENT_JOURNAL_SCHEMA_VERSION) {
      throw fail("WORLD_EVENT_JOURNAL_SCHEMA_UNSUPPORTED", "Unsupported world event journal schema.");
    }
    const worldId = clean(journal.worldId);
    if (!worldId) throw fail("WORLD_EVENT_WORLD_ID_REQUIRED", "World event journal requires worldId.");
    const previousEventIds = new Set();
    let expectedVersion = 1;
    for (const event of journal.events || []) {
      if (previousEventIds.has(event.eventId)) {
        throw fail("WORLD_EVENT_ID_DUPLICATE", "World event id appears more than once.", { eventId: event.eventId });
      }
      validateCommittedEvent(event, { worldId, expectedVersion, previousEventIds });
      previousEventIds.add(event.eventId);
      expectedVersion += 1;
    }
    if (Number(journal.worldVersion) !== expectedVersion - 1) {
      throw fail("WORLD_EVENT_VERSION_NON_MONOTONIC", "Journal worldVersion does not match its committed events.", {
        journalWorldVersion: journal.worldVersion,
        expectedWorldVersion: expectedVersion - 1,
      });
    }
  } catch (error) {
    issues.push({
      code: error.code || "WORLD_EVENT_JOURNAL_INVALID",
      message: error.message,
      evidence: clone(error.evidence || {}),
    });
  }
  return {
    valid: issues.length === 0,
    issues,
    worldId: clean(journal.worldId),
    worldVersion: Number(journal.worldVersion || 0),
    eventCount: Array.isArray(journal.events) ? journal.events.length : 0,
  };
}

function assertValidJournal(journal) {
  const result = validateWorldEventJournal(journal);
  if (!result.valid) {
    const issue = result.issues[0];
    throw fail(issue.code, issue.message, issue.evidence);
  }
  return result;
}

export function serializeWorldEventJournalJsonl(journal = {}) {
  assertValidJournal(journal);
  if (!journal.events.length) return "";
  return `${journal.events.map((event) => canonicalStringify(event)).join("\n")}\n`;
}

export function parseWorldEventJournalJsonl(source = "", {
  worldId = "",
  recoverTrailingPartial = true,
} = {}) {
  const nonEmptyLines = String(source || "")
    .split(/\r?\n/)
    .map((line, index) => ({ line, index }))
    .filter((entry) => entry.line.trim());
  const firstParsedWorldId = (() => {
    try {
      return nonEmptyLines.length ? clean(JSON.parse(nonEmptyLines[0].line).worldId) : "";
    } catch {
      return "";
    }
  })();
  const journal = createWorldEventJournal({ worldId: clean(worldId) || firstParsedWorldId });
  let recoveredTrailingLineCount = 0;
  for (let position = 0; position < nonEmptyLines.length; position += 1) {
    const entry = nonEmptyLines[position];
    const isLast = position === nonEmptyLines.length - 1;
    let event;
    try {
      event = JSON.parse(entry.line);
    } catch (cause) {
      if (isLast && recoverTrailingPartial) {
        recoveredTrailingLineCount = 1;
        break;
      }
      throw fail("WORLD_EVENT_JSONL_CORRUPT", "World event JSONL contains an invalid non-tail record.", {
        lineNumber: entry.index + 1,
        cause: cause.message,
      });
    }
    try {
      adoptCommittedEvent(journal, event);
    } catch (error) {
      if (isLast && recoverTrailingPartial) {
        recoveredTrailingLineCount = 1;
        break;
      }
      throw error;
    }
  }
  return { journal, recoveredTrailingLineCount };
}

export function replayWorldEvents(events = [], reducer, initialState, { worldId = "" } = {}) {
  if (typeof reducer !== "function") throw fail("WORLD_EVENT_REDUCER_REQUIRED", "World event replay requires a reducer.");
  if (!events.length) return clone(initialState);
  const journal = createWorldEventJournal({ worldId: clean(worldId) || clean(events[0]?.worldId), events });
  let state = clone(initialState);
  for (const event of journal.events) state = reducer(state, event);
  return state;
}

export async function appendWorldEventJsonl(filePath, event = {}) {
  if (!clean(filePath)) throw fail("WORLD_EVENT_FILE_PATH_REQUIRED", "World event JSONL append requires a file path.");
  validateEventIntegrity(event);
  await appendFile(filePath, `${canonicalStringify(event)}\n`, "utf8");
}

export async function loadWorldEventJournalJsonl(filePath, {
  worldId = "",
  recoverTrailingPartial = true,
} = {}) {
  let source = "";
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!source && !clean(worldId)) {
    throw fail("WORLD_EVENT_WORLD_ID_REQUIRED", "Loading an empty or missing journal requires worldId.");
  }
  return parseWorldEventJournalJsonl(source, { worldId, recoverTrailingPartial });
}
