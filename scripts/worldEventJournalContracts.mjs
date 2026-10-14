import assert from "node:assert/strict";
import { mkdtemp, appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  appendWorldEvent,
  appendWorldEventJsonl,
  createWorldEventJournal,
  loadWorldEventJournalJsonl,
  parseWorldEventJournalJsonl,
  replayWorldEvents,
  serializeWorldEventJournalJsonl,
  validateWorldEventJournal,
} from "../src/server/simulation/worldEventJournal.mjs";

const journal = createWorldEventJournal({ worldId: "world:test" });
const mutablePayload = { action: "push-door", nested: { force: 0.4 } };
const attempt = appendWorldEvent(journal, {
  eventId: "event:attempt:1",
  type: "action_attempted",
  occurredAtSeconds: 2,
  committedAt: "2026-07-23T12:00:00.000Z",
  actorId: "character:a",
  placeId: "place:house",
  zoneId: "threshold",
  publicPayload: mutablePayload,
  statePatch: { attempts: { "attempt:1": "started" } },
});
mutablePayload.nested.force = 1;

assert.equal(attempt.worldVersion, 1);
assert.equal(attempt.publicPayload.nested.force, 0.4, "journal events must own immutable copies of committed input");
assert.ok(Object.isFrozen(attempt));

const outcome = appendWorldEvent(journal, {
  eventId: "event:outcome:1",
  type: "action_resolved",
  occurredAtSeconds: 3,
  committedAt: "2026-07-23T12:00:01.000Z",
  actorId: "character:a",
  placeId: "place:house",
  zoneId: "threshold",
  causalParentEventIds: [attempt.eventId],
  actionAttemptId: "attempt:1",
  publicPayload: { status: "partial", visibleSurface: "门板震了一下" },
  privatePayloadRefs: ["private://character:a/turn:1"],
  statePatch: { attempts: { "attempt:1": "partial" }, door: { vibration: 0.2 } },
});

assert.equal(outcome.worldVersion, 2);
assert.equal(journal.worldVersion, 2);
assert.equal(validateWorldEventJournal(journal).valid, true);

assert.throws(() => appendWorldEvent(journal, {
  eventId: "event:outcome:1",
  type: "duplicate",
}), (error) => error.code === "WORLD_EVENT_ID_DUPLICATE");
assert.throws(() => appendWorldEvent(journal, {
  eventId: "event:bad-parent",
  type: "bad_parent",
  causalParentEventIds: ["event:missing"],
}), (error) => error.code === "WORLD_EVENT_CAUSAL_PARENT_MISSING");
assert.throws(() => appendWorldEvent(journal, {
  eventId: "event:bad-version",
  worldVersion: 9,
  type: "bad_version",
}), (error) => error.code === "WORLD_EVENT_VERSION_NON_MONOTONIC");

function applyPatch(state, event) {
  const next = structuredClone(state);
  for (const [key, value] of Object.entries(event.statePatch || {})) {
    next[key] = { ...(next[key] || {}), ...structuredClone(value) };
  }
  next.appliedEventIds.push(event.eventId);
  return next;
}

const replayed = replayWorldEvents(journal.events, applyPatch, {
  attempts: {},
  door: {},
  appliedEventIds: [],
});
assert.deepEqual(replayed, {
  attempts: { "attempt:1": "partial" },
  door: { vibration: 0.2 },
  appliedEventIds: ["event:attempt:1", "event:outcome:1"],
});

const encoded = serializeWorldEventJournalJsonl(journal);
const decoded = parseWorldEventJournalJsonl(encoded);
assert.equal(decoded.recoveredTrailingLineCount, 0);
assert.equal(decoded.journal.worldVersion, 2);
assert.equal(serializeWorldEventJournalJsonl(decoded.journal), encoded);

const recovered = parseWorldEventJournalJsonl(`${encoded}{"eventId":"partial`, {
  recoverTrailingPartial: true,
});
assert.equal(recovered.journal.worldVersion, 2);
assert.equal(recovered.recoveredTrailingLineCount, 1, "only the corrupt tail record may be discarded");

const lines = encoded.trimEnd().split("\n");
assert.throws(() => parseWorldEventJournalJsonl([
  lines[0],
  "{not-json}",
  lines[1],
].join("\n"), { recoverTrailingPartial: true }), (error) => error.code === "WORLD_EVENT_JSONL_CORRUPT");

const tampered = JSON.parse(lines[0]);
tampered.publicPayload.action = "rewritten-after-commit";
assert.throws(() => parseWorldEventJournalJsonl(`${JSON.stringify(tampered)}\n${lines[1]}\n`, {
  recoverTrailingPartial: false,
}), (error) => error.code === "WORLD_EVENT_INTEGRITY_MISMATCH");

const tempDirectory = await mkdtemp(join(tmpdir(), "gtown-world-journal-"));
const journalPath = join(tempDirectory, "world.jsonl");
try {
  await appendWorldEventJsonl(journalPath, attempt);
  await appendWorldEventJsonl(journalPath, outcome);
  const loaded = await loadWorldEventJournalJsonl(journalPath, { worldId: "world:test" });
  assert.equal(loaded.journal.worldVersion, 2);
  assert.equal(loaded.recoveredTrailingLineCount, 0);

  await appendFile(journalPath, "{\"eventId\":\"unfinished", "utf8");
  const recoveredFile = await loadWorldEventJournalJsonl(journalPath, {
    worldId: "world:test",
    recoverTrailingPartial: true,
  });
  assert.equal(recoveredFile.journal.worldVersion, 2);
  assert.equal(recoveredFile.recoveredTrailingLineCount, 1);
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

console.log(JSON.stringify({
  status: "passed",
  checks: {
    monotonicWorldVersion: true,
    immutableCommittedEnvelope: true,
    causalParentValidation: true,
    integrityDetection: true,
    deterministicReplay: true,
    jsonlRoundTrip: true,
    corruptTailRecovery: true,
    corruptMiddleRejected: true,
    localAppendAndLoad: true,
  },
}, null, 2));
