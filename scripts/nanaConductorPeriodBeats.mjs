import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

state.ui.engineMode = "mock";
state.ui.timeGrain = "day";
state.ui.focusMode = "location";
state.ui.activeTab = "observe";
state.ui.selectedLocationId = state.locations.find((location) => /四方法契门/.test(location.name))?.id || state.locations[0]?.id;
state.ui.userDirective = "让停剑城自己运转一天，每个时段都要有可观察的推进，不要只罗列动作。";

const draft = playNext(state);
const period = draft.periodSimulation;
const ticks = period?.ticks || [];

assert.ok(period, "day playback should create period simulation");
assert.ok(ticks.length >= 5, "day playback should contain a full sequence of town ticks");

for (const tick of ticks) {
  const beat = tick.conductorBeat;
  assert.ok(beat, `${tick.label} / ${tick.locationName} should carry an internal conductor beat`);
  assert.ok(beat.id && beat.target, "conductor beat should name the current dramatic task");
  assert.ok(Array.isArray(beat.requiredActionTypes) && beat.requiredActionTypes.length >= 1, "conductor beat should require observable action types");
  assert.ok(Array.isArray(beat.completionCriteria) && beat.completionCriteria.length >= 1, "conductor beat should define completion evidence");
  assert.ok(Array.isArray(beat.fallbackEscalation) && beat.fallbackEscalation.length >= 2, "conductor beat should define escalation options");
  assert.ok(Array.isArray(beat.evidence) && beat.evidence.length >= 1, "conductor beat should record evidence from the actual tick");
  assert.ok(
    beat.evidence.some((line) => String(line).includes(tick.locationName)),
    "conductor evidence should be grounded in the tick location",
  );
}

const focusedTick = ticks.find((tick) => tick.resolution === "focused_scene");
assert.ok(focusedTick, "selected location should receive at least one focused scene tick");
const focusedEvidence = (focusedTick.conductorBeat?.evidence || []).join("\n");
const focusedExchange = focusedTick.sceneInteraction?.agentExchanges?.[0];
if (focusedExchange) {
  const speakerNames = new Set((focusedExchange.dialogueTurns || []).map((turn) => turn.speakerName).filter(Boolean));
  assert.ok(
    [...speakerNames].some((name) => focusedEvidence.includes(name)) || focusedEvidence.includes(focusedExchange.eventOutcome),
    "focused conductor evidence should cite the actual exchange or outcome",
  );
}

assert.ok(period.conductorProgress, "period simulation should expose internal conductor progress");
assert.equal(period.conductorProgress.totalBeats, ticks.length, "conductor progress should track every period beat");
assert.ok(Array.isArray(period.conductorProgress.completedBeatIds), "conductor progress should expose completed beat ids");

const observationText = draft.sceneText || "";
assert.ok(
  !/conductor|BeatTracker|completionCriteria|fallbackEscalation|targetTickRange|current_beat|director-as-conductor|节拍|完成条件|后台|低精度|私人模拟/i.test(observationText),
  "observer prose should not leak conductor internals",
);

console.log("nanaConductorPeriodBeats:test passed", {
  ticks: ticks.length,
  firstBeat: ticks[0]?.conductorBeat?.target,
  focused: focusedTick?.locationName,
});
