import assert from "node:assert/strict";

import {
  applyTavernCausalAffordance,
  listTavernCausalAffordances,
} from "../src/server/pipeline/tavernCausalEconomy.mjs";
import { buildTavernSceneRuntime } from "../src/server/pipeline/tavernCausalScene.mjs";
import {
  interruptDurativeWorldProcess,
  refreshDurativeWorldProcesses,
  resumeDurativeWorldProcess,
  startDurativeWorldProcess,
} from "../src/server/simulation/durativeWorldProcess.mjs";
import {
  buildLuoZhaoTavernBehaviorAcceptanceFixture,
  LUO_ZHAO_BEHAVIOR_ACCEPTANCE_IDS,
} from "./fixtures/luoZhaoTavernBehaviorAcceptanceFixture.mjs";

const ids = LUO_ZHAO_BEHAVIOR_ACCEPTANCE_IDS;

function buildRequestedTeaState({ heatReady = true } = {}) {
  const fixture = buildLuoZhaoTavernBehaviorAcceptanceFixture();
  const state = structuredClone(fixture.state);
  state.tavernState.servicePreparationEnvironment.stations.stove.heatReady = heatReady;
  state.tavernState.servicePreparationEnvironment.stations.stove.heatState = heatReady ? "simmering" : "cold";
  const runtime = buildTavernSceneRuntime(state, {
    characterIds: [ids.xieZhenshi, ids.luo],
    positions: { [ids.xieZhenshi]: "hall", [ids.luo]: "hall" },
    slotContext: fixture.slotContext,
  });
  const request = listTavernCausalAffordances(state, runtime, ids.luo, [ids.xieZhenshi])
    .find((row) => row.type === "request_service" && row.offeringId === "tea");
  assert.ok(request);
  assert.ok(applyTavernCausalAffordance(state, runtime, {
    id: `test:request-tea:${heatReady ? "hot" : "cold"}`,
    actorId: ids.luo,
    speech: "来碗粗茶。",
    visibleAction: "",
  }, request, [ids.xieZhenshi]));
  return { state, runtime };
}

function reachPreparationStart(state, runtime) {
  let affordances = listTavernCausalAffordances(state, runtime, ids.xieZhenshi, [ids.luo]);
  for (let step = 0; step < 4 && !affordances.some((row) => row.type === "start_service_preparation"); step += 1) {
    const approach = affordances.find((row) => row.type === "approach_service_station" || row.type === "approach_service_vessel");
    assert.ok(approach);
    assert.ok(applyTavernCausalAffordance(state, runtime, {
      id: `test:reach-preparation:${step}`,
      actorId: ids.xieZhenshi,
      speech: "",
      visibleAction: "",
      moveToZoneId: approach.moveToZoneId,
    }, approach, [ids.luo]));
    runtime.agents[ids.xieZhenshi].zoneId = approach.moveToZoneId;
    affordances = listTavernCausalAffordances(state, runtime, ids.xieZhenshi, []);
  }
  return affordances.find((row) => row.type === "start_service_preparation") || null;
}

const hot = buildRequestedTeaState({ heatReady: true });
const hotAffordances = listTavernCausalAffordances(hot.state, hot.runtime, ids.xieZhenshi, [ids.luo]);
assert.equal(hotAffordances.some((row) => row.type === "serve_guest"), false);
const hotStart = reachPreparationStart(hot.state, hot.runtime);
assert.ok(hotStart);
assert.ok(hotStart.durationSeconds > 0);

const cold = buildRequestedTeaState({ heatReady: false });
const coldStart = reachPreparationStart(cold.state, cold.runtime);
assert.ok(coldStart);
assert.ok(coldStart.durationSeconds > hotStart.durationSeconds, "cold water must require a longer real process than a simmering kettle");

const teaBefore = Number(hot.state.tavernState.stock.tea);
assert.ok(applyTavernCausalAffordance(hot.state, hot.runtime, {
  id: "test:start-hot-tea-process",
  actorId: ids.xieZhenshi,
  speech: "",
  visibleAction: "",
  moveToZoneId: hotStart.moveToZoneId,
}, hotStart, [ids.luo]));
hot.runtime.agents[ids.xieZhenshi].zoneId = hotStart.moveToZoneId || hot.runtime.agents[ids.xieZhenshi].zoneId;
const visit = hot.state.tavernState.activeVisits.find((row) => row.visitorId === ids.luo);
const process = hot.state.tavernState.serviceProcesses.find((row) => row.subjectId === visit.id);
assert.equal(visit.serviceStatus, "preparing");
assert.equal(Number(hot.state.tavernState.stock.tea), teaBefore - 1, "inputs are reserved by the real start action, not by delivery");
assert.ok(process.readyAtSeconds > process.startedAtSeconds);
assert.equal(listTavernCausalAffordances(hot.state, hot.runtime, ids.xieZhenshi, []).some((row) => row.type === "finish_service_preparation"), false);
hot.runtime.elapsedSeconds += process.durationSeconds - 1;
assert.equal(listTavernCausalAffordances(hot.state, hot.runtime, ids.xieZhenshi, []).some((row) => row.type === "finish_service_preparation"), false);
hot.runtime.elapsedSeconds += 1;
assert.ok(listTavernCausalAffordances(hot.state, hot.runtime, ids.xieZhenshi, []).some((row) => row.type === "finish_service_preparation"));
assert.equal(visit.serviceStatus, "preparing", "time becoming ready must not auto-serve or even auto-finish the vessel");

const started = startDurativeWorldProcess([], {
  id: "generic-process:test",
  kind: "generic-work",
  subjectId: "subject:test",
  ownerActorId: "actor:test",
  durationSeconds: 30,
  attentionMode: "continuous_work",
}, 100);
assert.ok(started.ok);
const interrupted = interruptDurativeWorldProcess(started.processes, "generic-process:test", 112, "action:interrupt");
assert.ok(interrupted.ok);
assert.equal(interrupted.process.status, "interrupted");
assert.equal(interrupted.process.accumulatedSeconds, 12);
assert.equal(refreshDurativeWorldProcesses(interrupted.processes, 200)[0].status, "interrupted", "interrupted work cannot finish merely because time passed");
const resumed = resumeDurativeWorldProcess(interrupted.processes, "generic-process:test", 200, "action:resume");
assert.ok(resumed.ok);
assert.equal(resumed.process.readyAtSeconds, 218);
assert.equal(refreshDurativeWorldProcesses(resumed.processes, 217)[0].status, "active");
assert.equal(refreshDurativeWorldProcesses(resumed.processes, 218)[0].status, "ready");

console.log("tavernDurativeServiceProcess:test passed", {
  hotDurationSeconds: hotStart.durationSeconds,
  coldDurationSeconds: coldStart.durationSeconds,
  interruptionRemainingSeconds: 18,
});
