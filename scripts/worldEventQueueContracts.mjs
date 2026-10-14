// 天意 for a running world (P6.6b): queued lines are settled once, in order,
// before the next turn; a line still being written waits; a rejected event is
// recorded with its problems and changes nothing; the page sees each event
// with its result. Unexpected failures are not swallowed.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, appendFile, writeFile, rm } from "node:fs/promises";
import { createWorldEventQueue, listWorldEvents, WORLD_EVENT_QUEUE_FILE } from "../src/server/simulation/worldEventQueue.mjs";

const dir = await mkdtemp(path.join(os.tmpdir(), "world-event-queue-"));
const queue = path.join(dir, WORLD_EVENT_QUEUE_FILE);
const applied = [];
const runtime = {
  async applyWorldEvent(event) {
    if (event.kind === "boom") throw Object.assign(new Error("invalid"), { code: "WORLD_EVENT_INVALID", evidence: { issues: [{ field: "kind", message: "只能是天气、东西出现、口信或小意外。" }] } });
    if (event.kind === "crash") throw Object.assign(new Error("disk full"), { code: "EIO" });
    applied.push(event);
    return { worldVersion: 10 + applied.length, nowSeconds: 600, deliveries: [{ recipientCharacterId: "a" }, { recipientCharacterId: "b" }] };
  },
};
const logged = [];
const worldEvents = createWorldEventQueue({ dir, runtime, log: (row) => logged.push(row) });
const line = (eventId, event) => `${JSON.stringify({ eventId, receivedAt: "2026-10-10T12:00:00Z", event })}\n`;

try {
  // Nothing queued yet.
  assert.equal(await worldEvents.applyQueued(), 0);
  assert.deepEqual(await listWorldEvents(dir), []);

  // Two events, one still being written.
  await writeFile(queue, line("e1", { kind: "weather", weather: "rain" }) + line("e2", { kind: "message", toCharacterId: "a", text: "官船到了" }) + "{\"eventId\":\"e3\",\"ev");
  assert.equal(await worldEvents.applyQueued(), 2);
  assert.deepEqual(applied.map((row) => row.kind), ["weather", "message"]);
  assert.deepEqual((await listWorldEvents(dir)).map((row) => [row.eventId, row.status, row.delivered]), [["e1", "applied", 2], ["e2", "applied", 2]]);

  // Each line is settled once; the rest of the half-written line arrives later.
  assert.equal(await worldEvents.applyQueued(), 0);
  await appendFile(queue, "ent\":{\"kind\":\"weather\",\"weather\":\"fog\"}}\n");
  assert.equal(await worldEvents.applyQueued(), 1);
  assert.equal(applied.at(-1).weather, "fog");

  // A rejected event changes nothing and says why; an unreadable line is recorded too.
  await appendFile(queue, line("e4", { kind: "boom" }) + "not json\n");
  assert.equal(await worldEvents.applyQueued(), 0);
  assert.equal(applied.length, 3);
  const listed = await listWorldEvents(dir);
  assert.deepEqual(listed.map((row) => row.status), ["applied", "applied", "applied", "rejected"]);
  assert.match(listed.at(-1).message, /只能是天气/u);
  assert.deepEqual(logged.map((row) => row.event), ["world_event_applied", "world_event_applied", "world_event_applied", "world_event_rejected"]);

  // A new event shows as queued until the runner reaches it.
  await appendFile(queue, line("e5", { kind: "weather", weather: "clear" }));
  assert.equal((await listWorldEvents(dir)).at(-1).status, "queued");

  // Anything other than a refused event is a real failure, not a silent skip.
  await appendFile(queue, line("e6", { kind: "crash" }));
  await worldEvents.applyQueued().then(() => assert.fail("a crash must surface"), (error) => assert.equal(error.code, "EIO"));
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("World event queue passed: settled once and in order, partial lines wait, refusals recorded with reasons, real failures surface.");
