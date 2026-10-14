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
  id: "draft_stage_beat_process",
  createdAt: "2026-06-29T01:00:00.000Z",
  locationId: "loc_gregor_room",
  participantIds: ["char_gregor", "char_grete", "char_father"],
  periodSimulation: {
    ticks: [
      {
        id: "tick_room",
        label: "清晨",
        resolution: "focused_scene",
        locationId: "loc_gregor_room",
        locationName: "格里高尔房间",
        participantIds: ["char_gregor", "char_grete"],
        agentOutputs: [
          {
            characterId: "char_gregor",
            targetCharacterId: "char_grete",
            visibleAction: "格里高尔贴近门缝，低声说：“我马上就好。”",
          },
          {
            characterId: "char_grete",
            targetCharacterId: "char_gregor",
            visibleAction: "格蕾特把手放在门板上，没有推门。",
          },
        ],
      },
      {
        id: "tick_table",
        label: "上午",
        resolution: "background",
        locationId: "loc_parlor",
        locationName: "客厅与家庭餐桌",
        participantIds: ["char_grete", "char_father"],
        agentOutputs: [
          {
            characterId: "char_father",
            targetCharacterId: "char_grete",
            visibleAction: "父亲把账本合上，说：“先别喊他。”",
          },
        ],
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
assert.ok(events[0].beats.length >= 4, "focused ticks should be broken into concrete stage beats");
assert.ok(events[0].beats.some((beat) => beat.type === "action" && beat.actorId === "char_gregor"), "Gregor should have a concrete action beat");
assert.ok(events[0].beats.some((beat) => beat.type === "dialogue" && beat.speakerId === "char_gregor" && beat.text.includes("我马上就好")), "quoted speech should become a dialogue beat");
assert.ok(events[0].beats.some((beat) => beat.type === "action" && beat.actorId === "char_grete"), "another participant should also receive a visible action beat");
assert.ok(events[1].beats.some((beat) => beat.actorId === "char_father" || beat.speakerId === "char_father"), "later ticks should preserve their active character beat");

const html = renderApp(state);
assert.ok(html.includes('data-stage-process="true"'), "observer stage should include the current event process");
assert.ok(html.includes('data-stage-beat='), "stage process should render individual beats");
assert.ok(html.includes('data-stage-action='), "stage process should expose action beats");
assert.ok(html.includes('data-stage-dialogue='), "stage process should expose dialogue beats and speech bubbles");
assert.ok(html.includes('data-stage-speaker="char_father"'), "current tick dialogue should be attached to the speaking actor");
assert.ok(html.includes('data-observer-prose="true"'), "observer stream should render the same events as prose");
assert.ok(!html.includes('data-observer-beats="true"'), "observer stream should not show beat-level tables under each event");
assert.ok(html.includes("先别喊他"), "dialogue should be visible as dramatic speech, not hidden in a summary");
assert.ok(!/低精度|后台运行|私人模拟|行动候选|自主计划/.test(html), "observer UI must not leak engine language");

console.log("stageBeatProcess:test passed", {
  events: events.length,
  firstBeats: events[0].beats.length,
});
