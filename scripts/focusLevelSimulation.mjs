import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playNext } from "../src/engine/mockEngine.js";
import { buildObservationEvents } from "../src/ui/render.js";

function baseDayState() {
  const state = structuredClone(initialState);
  state.ui.engineMode = "mock";
  state.ui.timeGrain = "day";
  state.ui.selectedLocationId = "loc_gregor_room";
  state.ui.userDirective = "把公寓当成大型戏剧舞台；没有观察的位置只低精度运行。";
  state.ui.injectedEvent = "公司书记员提前来到公寓门口。";
  state.ui.eventImpact = 64;
  return state;
}

const ambientState = baseDayState();
ambientState.ui.focusMode = "ambient";
const ambientDraft = playNext(ambientState);
const ambientPeriod = ambientDraft.periodSimulation;

assert.ok(ambientPeriod, "ambient day playback should still build a period simulation");
assert.ok(ambientPeriod.focus, "period simulation should expose focus metadata");
assert.equal(ambientPeriod.focus.mode, "ambient", "ambient playback should declare ambient focus mode");
assert.ok(ambientPeriod.ticks.length >= 4, "ambient playback should keep the whole town running");
assert.ok(ambientPeriod.ticks.every((tick) => tick.resolution === "background"), "unfocused town ticks should stay low precision");
assert.ok(ambientPeriod.ticks.every((tick) => !tick.sceneText), "background ticks should not expand into full scenes");
assert.match(ambientDraft.sceneText, /脚步|物件|痕迹|传闻|短暂停过/, "ambient timeline should read as distant visible traces");
assert.ok(!/低精度|后台运行|后台动作|表面执行|聚焦场景/.test(ambientDraft.sceneText), "ambient timeline should not expose engine language");

const focusedState = baseDayState();
focusedState.ui.focusMode = "location";
const focusedDraft = playNext(focusedState);
const focusedPeriod = focusedDraft.periodSimulation;
const focusedTicks = focusedPeriod.ticks.filter((tick) => tick.resolution === "focused_scene");
const backgroundTicks = focusedPeriod.ticks.filter((tick) => tick.resolution === "background");

assert.equal(focusedPeriod.focus.mode, "location", "focused playback should declare location focus mode");
assert.equal(focusedPeriod.focus.locationId, "loc_gregor_room", "focused playback should use selected location as the observed stage area");
assert.ok(focusedTicks.length >= 1, "observed location should receive at least one scene-level tick");
assert.ok(focusedTicks.every((tick) => tick.locationId === "loc_gregor_room"), "only the observed location should become scene-level");
assert.ok(focusedTicks.every((tick) => tick.sceneText && tick.simulationTick && tick.sceneInteraction), "focused ticks should have full scene simulation");
assert.ok(backgroundTicks.length >= 2, "non-observed places should continue running in the background");
assert.ok(backgroundTicks.every((tick) => !tick.sceneText), "non-observed ticks should remain compressed");
assert.match(focusedDraft.sceneText, /格里高尔房间/, "focused timeline should include the observed location");
assert.match(focusedDraft.sceneText, /说：“|停在|扣住|压到|推到/, "focused timeline should contain scene-level action or dialogue");
assert.ok(!/低精度|后台运行|后台动作|表面执行|聚焦场景/.test(focusedDraft.sceneText), "focused timeline should not expose engine language");

const focusedObservationEvents = buildObservationEvents(focusedDraft, focusedState);
const focusedLocationEvents = focusedObservationEvents.filter((event) => event.locationId === focusedState.ui.selectedLocationId);
const backgroundObservationEvents = focusedObservationEvents.filter((event) => event.locationId !== focusedState.ui.selectedLocationId);
assert.ok(
  focusedLocationEvents.some((event) => /说：“/.test(event.text || "")),
  "the selected location should expose scene-level dialogue",
);
assert.ok(
  backgroundObservationEvents.every((event) => !/说：“/.test(event.text || "")),
  `unobserved locations must remain low-detail prose without dialogue:\n${backgroundObservationEvents.map((event) => `${event.location}: ${event.text}`).join("\n")}`,
);
assert.ok(
  backgroundObservationEvents.every((event) => !(event.beats || []).some((beat) => beat.type === "dialogue")),
  `unobserved locations must not carry hidden dialogue beats that the observer can append:\n${backgroundObservationEvents.map((event) => `${event.location}: ${(event.beats || []).map((beat) => beat.type).join(",")}`).join("\n")}`,
);

console.log("focusLevelSimulation:test passed", {
  ambientTicks: ambientPeriod.ticks.length,
  focusedTicks: focusedTicks.length,
  backgroundTicks: backgroundTicks.length,
  focusLocation: focusedPeriod.focus.locationId,
});
