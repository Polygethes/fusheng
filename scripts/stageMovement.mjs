import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { buildObservationEvents, renderApp } from "../src/ui/render.js";

const state = structuredClone(initialState);
state.ui.activeTab = "observe";
state.ui.timeGrain = "day";
state.ui.focusMode = "location";
state.ui.selectedLocationId = "loc_gregor_room";
state.ui.showObserverStage = true;

const draft = {
  id: "draft_stage_movement",
  createdAt: "2026-06-29T01:00:00.000Z",
  locationId: "loc_gregor_room",
  participantIds: ["char_gregor", "char_grete"],
  periodSimulation: {
    ticks: [
      {
        id: "tick_room",
        label: "清晨",
        resolution: "focused_scene",
        locationId: "loc_gregor_room",
        locationName: "格里高尔房间",
        participantIds: ["char_gregor", "char_grete"],
        agentOutputs: [{ characterId: "char_gregor", targetCharacterId: "char_grete", visibleAction: "格里高尔贴近门缝，低声说：“我马上就好。”" }],
      },
      {
        id: "tick_table",
        label: "上午",
        resolution: "background",
        locationId: "loc_parlor",
        locationName: "客厅与家庭餐桌",
        participantIds: ["char_grete", "char_father"],
        agentOutputs: [{ characterId: "char_grete", targetCharacterId: "char_father", visibleAction: "格蕾特把早餐盘放到桌沿。" }],
      },
    ],
  },
};

state.draftScenes = [draft];
state.ui.observerPlayback = {
  draftId: draft.id,
  visibleCount: 2,
  totalCount: 2,
  status: "complete",
};

const events = buildObservationEvents(draft, state);
assert.equal(events[0].locationId, "loc_gregor_room", "observation event should expose the source location id");
assert.deepEqual(events[0].participantIds, ["char_gregor", "char_grete"], "observation event should expose participants for staging");
assert.equal(events[1].sourceTickId, "tick_table", "observation event should keep the source tick id for movement provenance");

const html = renderApp(state);

assert.ok(html.includes('data-observer-stage="true"'), "observer window should include an event-driven stage map");
assert.ok(html.includes('data-stage-event-source="tick_table"'), "stage actors should point to the tick that moved them");
assert.ok(html.includes('data-movement-source="observation-event"'), "stage actor movement should be driven by observation events");
assert.ok(html.includes('data-stage-location="loc_parlor"'), "stage actors should be placed at the current event location");
assert.ok(html.includes('data-pixel-person="true"'), "stage actors should render as pixel people");
assert.ok(html.includes('pixel-person-head'), "stage pixel people should include head parts");
assert.ok(html.includes('pixel-person-body'), "stage pixel people should include body parts");
assert.ok(!html.includes('plan-route-'), "observer stage should not rely on looping CSS route animations");

console.log("stageMovement:test passed", {
  events: events.length,
  visibleActors: (html.match(/data-stage-actor=/g) || []).length,
});
