function requireFunction(value, label) {
  if (typeof value !== "function") throw new Error(`NPC activity loop requires ${label}.`);
  return value;
}

function normalizeDelay(value) {
  const delay = Number(value);
  return Number.isFinite(delay) && delay >= 0 ? delay : 1800;
}

export function npcActivityIntervalMs(speed) {
  return speed === "fast" ? 200 : 2100;
}

/**
 * Sequential, cooperatively-stoppable activity loop for the tavern UI.
 *
 * `runOnce` owns one complete authoritative world turn. Stopping never aborts
 * an in-flight commit; it only prevents that turn from scheduling a successor.
 * `setIntervalMs` replaces a pending wait, or updates the delay to use after
 * the current turn. It never restarts an in-flight turn.
 */
export function createNpcActivityLoop({
  runOnce,
  intervalMs = 1800,
  clock = globalThis,
  onStateChange = null,
  onError = null,
} = {}) {
  const execute = requireFunction(runOnce, "runOnce");
  const schedule = requireFunction(clock?.setTimeout?.bind(clock), "clock.setTimeout");
  const cancel = requireFunction(clock?.clearTimeout?.bind(clock), "clock.clearTimeout");
  let delayMs = normalizeDelay(intervalMs);
  let running = false;
  let inFlight = false;
  let disposed = false;
  let timerId = null;
  let timerGeneration = 0;
  let epoch = 0;
  let completedTurns = 0;

  function snapshot() {
    return {
      running,
      inFlight,
      scheduled: timerId !== null,
      completedTurns,
      disposed,
    };
  }

  function publish() {
    if (typeof onStateChange === "function") onStateChange(snapshot());
  }

  function clearScheduledTurn() {
    timerGeneration += 1;
    if (timerId === null) return;
    cancel(timerId);
    timerId = null;
  }

  function scheduleNext(localEpoch, notify = true) {
    if (!running || disposed || localEpoch !== epoch) return;
    const localTimerGeneration = ++timerGeneration;
    timerId = schedule(() => {
      // A cancelled callback may already be queued. It must not consume the
      // replacement timer or start an extra turn after a speed change.
      if (localTimerGeneration !== timerGeneration) return;
      timerId = null;
      if (!running || disposed || localEpoch !== epoch) return;
      void runTurn(localEpoch);
    }, delayMs);
    if (notify) publish();
  }

  function setIntervalMs(value) {
    const nextDelayMs = normalizeDelay(value);
    if (disposed || nextDelayMs === delayMs) return snapshot();
    delayMs = nextDelayMs;
    if (timerId !== null) {
      clearScheduledTurn();
      // Re-arm a pending wait immediately. In-flight turns keep their commit
      // boundary and will use the new delay once they finish. Activity state
      // is unchanged, so UI subscribers do not need another notification.
      scheduleNext(epoch, false);
    }
    return snapshot();
  }

  async function runTurn(localEpoch) {
    if (!running || disposed || localEpoch !== epoch || inFlight) return;
    inFlight = true;
    publish();
    try {
      await execute();
      completedTurns += 1;
    } catch (error) {
      if (localEpoch === epoch) {
        running = false;
        clearScheduledTurn();
        if (typeof onError === "function") onError(error);
      }
    } finally {
      inFlight = false;
      publish();
    }
    if (running && !disposed && localEpoch !== epoch) {
      void runTurn(epoch);
      return;
    }
    scheduleNext(localEpoch);
  }

  function start() {
    if (disposed) throw new Error("NPC activity loop has been disposed.");
    if (running) return snapshot();
    running = true;
    epoch += 1;
    clearScheduledTurn();
    publish();
    void runTurn(epoch);
    return snapshot();
  }

  function stop() {
    running = false;
    epoch += 1;
    clearScheduledTurn();
    publish();
    return snapshot();
  }

  function dispose() {
    if (disposed) return snapshot();
    stop();
    disposed = true;
    publish();
    return snapshot();
  }

  return { start, stop, dispose, snapshot, setIntervalMs };
}
