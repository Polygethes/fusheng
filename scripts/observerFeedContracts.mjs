import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import xiaoyaoyou from "../src/worlds/xiaoyaoyou/pack.mjs";
import jiexing from "../src/worlds/jiexing/pack.mjs";
import { buildObserverFeed } from "../src/server/observer/observerFeed.mjs";
import { createFreshWorldSave } from "../src/worlds/freshWorld.mjs";

const save = JSON.parse(readFileSync(new URL("../sim-runs/2026-09-21-fresh-10/world-save.json", import.meta.url), "utf8"));
const events = save.checkpoint.coordinator.journal.events;
const feed = buildObserverFeed(save, xiaoyaoyou);

assert.equal(feed.replayConsistent, true, "replaying the journal from the pack-built opening reproduces the saved world");
const privateTurns = save.settledTurns.filter((row) => !events.some((event) => event.publicPayload?.agentTurnId === row.agentTurnId));
const deadlineFrames = events.filter((event) => /deadline/u.test(event.type)).reduce((sum, event) => sum + (event.publicPayload?.deadlineEvents?.length || 0), 0);
assert.equal(feed.frames.length, events.length - events.filter((event) => /deadline/u.test(event.type)).length + deadlineFrames + privateTurns.length,
  "every world event and every private turn appears exactly once");
assert.deepEqual(feed.frames.map((row) => row.seq), feed.frames.map((_, index) => index + 1));

const spokenTexts = new Set(events.flatMap((event) => (event.publicPayload?.resolvedEffects || []).some((row) => row.kind === "speech_emitted")
  ? (event.publicPayload.attemptSurface || []).filter((row) => row.kind === "utterance_emitted").map((row) => row.utterance) : []));
const speeches = feed.frames.filter((row) => row.kind === "speak");
assert.ok(speeches.length > 0 && speeches.every((row) => spokenTexts.has(row.utterance)), "speech bubbles only show words that were actually emitted");
assert.equal(speeches[0].utterance, save.settledTurns.find((row) => row.index === 9).speech);
assert.ok(speeches.every((row) => row.perceivedBy.length > 0), "every utterance names who actually received it");
assert.ok(feed.frames.every((row) => !row.intention || row.intention.private === true), "intentions are always marked private");

const failed = feed.frames.find((row) => row.status === "failed");
assert.ok(failed && failed.failureCodes.includes("OBJECT_NOT_IN_HAND"), "a failed attempt keeps its reason");
assert.deepEqual(failed.changes.objects, {}, "a failed attempt moves nothing");

for (const frame of feed.frames.filter((row) => row.kind === "move" && row.status === "success")) {
  assert.equal(frame.changes.entities[frame.actorId]?.zoneId, frame.toZone, "a move frame carries the settled destination");
}
const pickup = feed.frames.find((row) => row.kind === "pickup" && row.status === "success");
assert.ok(Object.values(pickup.changes.objects).some((row) => row.holder === pickup.actorId), "a pickup shows the object in the actor's hands");

const fresh = (await createFreshWorldSave(jiexing, { runId: "observer-probe" })).save;
const freshFeed = buildObserverFeed(fresh, jiexing);
assert.equal(freshFeed.frames.length, 0);
assert.equal(freshFeed.replayConsistent, true);
assert.equal(freshFeed.initial.entities.char_jx_guxiaoman.zoneId, "xm_room");
assert.equal(freshFeed.initial.objects.jx_guide_talisman.hidden, true, "the observer marks the hidden token as hidden");

console.log("Observer feed passed: frames replay the settled journal exactly; words, receivers, failures and object changes come only from the world.");
