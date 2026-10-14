import assert from "node:assert/strict";
import { createNpcActivityLoop, npcActivityIntervalMs } from "../src/ui/npcActivityLoop.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { renderApp } from "../src/ui/render.js";
import * as store from "../src/state/store.js";

function manualClock() {
  const pending = new Map();
  let sequence = 0;
  return {
    pending,
    setTimeout(callback, delayMs) {
      const id = ++sequence;
      pending.set(id, { callback, delayMs });
      return id;
    },
    clearTimeout(id) { pending.delete(id); },
    next() {
      assert.equal(pending.size, 1, "only one successor may be scheduled");
      const [id, timer] = pending.entries().next().value;
      pending.delete(id);
      timer.callback();
      return timer.delayMs;
    },
    timer() {
      assert.equal(pending.size, 1);
      return pending.values().next().value;
    },
  };
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

assert.equal(npcActivityIntervalMs("normal"), 2100);
assert.equal(npcActivityIntervalMs("fast"), 200);
assert.equal(npcActivityIntervalMs(undefined), 2100);
assert.equal(npcActivityIntervalMs("corrupt-preference"), 2100);

// A speed change during a commit must leave the in-flight work intact.
{
  const clock = manualClock();
  const firstCommit = Promise.withResolvers();
  let calls = 0;
  const loop = createNpcActivityLoop({
    clock, intervalMs: npcActivityIntervalMs("normal"),
    runOnce: () => { calls += 1; return calls === 1 ? firstCommit.promise : Promise.resolve(); },
  });
  loop.start();
  loop.setIntervalMs(npcActivityIntervalMs("fast"));
  loop.start();
  assert.equal(calls, 1);
  assert.equal(clock.pending.size, 0);
  firstCommit.resolve();
  await settle();
  assert.equal(clock.timer().delayMs, 200);

  const cancelledFastTimer = clock.timer();
  loop.setIntervalMs(npcActivityIntervalMs("normal"));
  const normalTimer = clock.timer();
  assert.equal(normalTimer.delayMs, 2100);
  cancelledFastTimer.callback();
  assert.equal(calls, 1);
  assert.equal(clock.timer(), normalTimer, "stale callbacks cannot consume a replacement timer");

  loop.setIntervalMs(npcActivityIntervalMs("fast"));
  const fastTimer = clock.timer();
  loop.setIntervalMs(npcActivityIntervalMs("fast"));
  assert.equal(clock.timer(), fastTimer, "unrelated store updates cannot restart the waiting period");
  normalTimer.callback();
  assert.equal(clock.timer(), fastTimer);
  assert.equal(clock.next(), 200);
  await settle();
  assert.equal(calls, 2);
  const stoppedTimer = clock.timer();
  loop.stop();
  stoppedTimer.callback();
  assert.equal(calls, 2);
  assert.equal(clock.pending.size, 0);
  loop.dispose();
  loop.setIntervalMs(1);
  assert.equal(clock.pending.size, 0);
}

// Stop/restart while a request is settling is still sequential across epochs.
{
  const clock = manualClock();
  const commit = Promise.withResolvers();
  let calls = 0;
  const loop = createNpcActivityLoop({ clock, intervalMs: 2100,
    runOnce: () => { calls += 1; return calls === 1 ? commit.promise : Promise.resolve(); },
  });
  loop.start();
  loop.stop();
  loop.setIntervalMs(200);
  loop.start();
  assert.equal(calls, 1);
  commit.resolve();
  await settle();
  assert.equal(calls, 2);
  assert.equal(clock.timer().delayMs, 200);
  loop.dispose();
}

// A stopped or failed commit must never leave a fast successor running.
for (const fail of [false, true]) {
  const clock = manualClock();
  const commit = Promise.withResolvers();
  const errors = [];
  let calls = 0;
  const loop = createNpcActivityLoop({ clock, intervalMs: 2100,
    runOnce: () => { calls += 1; return commit.promise; }, onError: error => errors.push(error),
  });
  loop.start();
  loop.setIntervalMs(200);
  if (fail) commit.reject(new Error("synthetic commit failure"));
  else { loop.stop(); commit.resolve(); }
  await settle();
  assert.equal(calls, 1);
  assert.equal(clock.pending.size, 0);
  assert.equal(loop.snapshot().running, false);
  assert.equal(loop.snapshot().inFlight, false);
  assert.equal(loop.snapshot().completedTurns, fail ? 0 : 1);
  assert.equal(errors.length, fail ? 1 : 0);
}

const state = buildPlayableWorldFromSetup({ setupWorldPrompt: "逍遥游，望梯酒馆", setupPeoplePrompt: "谢真石、洛照" });
state.ui = { ...state.ui, setupCompleted: true, activeTab: "reality", engineMode: "v27" };
state.branches = [{ id: "branch_main", title: "主线", snapshot: {} }];
for (const speed of [undefined, "normal", "fast"]) {
  state.ui.npcActivitySpeed = speed;
  const html = renderApp(state);
  assert.match(html, /role="group" aria-label="推进速度"/);
  for (const value of ["normal", "fast"]) {
    const selected = (speed === "fast" ? "fast" : "normal") === value;
    assert.match(html, new RegExp(`data-key="npcActivitySpeed" data-value="${value}" aria-pressed="${selected}"`));
  }
}
state.ui.engineMode = "local";
assert.doesNotMatch(renderApp(state), /data-key="npcActivitySpeed"/);

// Speed is a saved UI preference. Old saves remain normal and never auto-run.
for (const speed of [undefined, "fast", "invalid"]) {
  const saved = store.getState();
  saved.ui.npcActivitySpeed = speed;
  saved.ui.npcActivityRunning = true;
  saved.ui.npcActivityStatus = "running";
  saved.ui.v27Running = true;
  store.importState(JSON.stringify(saved));
  const restored = store.getState();
  assert.equal(restored.ui.npcActivitySpeed, speed === "fast" ? "fast" : "normal");
  assert.equal(restored.ui.npcActivityRunning, false);
  assert.equal(restored.ui.npcActivityStatus, "stopped");
  assert.equal(restored.ui.v27Running, false);
}
console.log("NPC speed contracts passed: live switching, stale timers, sequential commits, stop/restart, errors, rendering and saved preference");
