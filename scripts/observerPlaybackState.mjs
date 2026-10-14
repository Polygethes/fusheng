import assert from "node:assert/strict";
import { buildInitialObserverPlayback, advanceObserverPlayback } from "../src/ui/observerPlayback.js";

const draft = { id: "draft_live_stream" };
const initial = buildInitialObserverPlayback(draft, 5);

assert.deepEqual(initial, {
  draftId: "draft_live_stream",
  visibleCount: 1,
  totalCount: 5,
  status: "playing",
});

const second = advanceObserverPlayback(initial);
assert.equal(second.visibleCount, 2, "playback should reveal one event at a time");
assert.equal(second.status, "playing", "playback should keep playing before the final event");

const complete = advanceObserverPlayback({ ...second, visibleCount: 4 });
assert.equal(complete.visibleCount, 5, "playback should reveal the final event");
assert.equal(complete.status, "complete", "playback should complete at the final event");

const single = buildInitialObserverPlayback(draft, 1);
assert.equal(single.visibleCount, 1, "single-event playback should show the event immediately");
assert.equal(single.status, "complete", "single-event playback should not start a timer");

const empty = buildInitialObserverPlayback(draft, 0);
assert.equal(empty.visibleCount, 0, "empty playback should reveal nothing");
assert.equal(empty.status, "complete", "empty playback should be complete");

console.log("observerPlaybackState:test passed", {
  initial,
  complete,
});
