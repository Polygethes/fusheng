import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { buildObservationEvents } from "../src/ui/render.js";

const state = structuredClone(initialState);
state.characters = [
  { id: "char_tang", name: "唐僧" },
  { id: "char_wukong", name: "孙悟空" },
];
state.locations = [
  { id: "loc_gate", name: "山门前", likelyEvents: ["山门求救"] },
  { id: "loc_forest", name: "密林小路", likelyEvents: ["行李落地"] },
];

const draft = {
  id: "draft_generic_wording",
  locationId: "loc_gate",
  participantIds: ["char_tang", "char_wukong"],
  periodSimulation: {
    ticks: [
      {
        id: "tick_gate",
        label: "清晨",
        resolution: "focused_scene",
        locationId: "loc_gate",
        locationName: "山门前",
        participantIds: ["char_tang", "char_wukong"],
        agentOutputs: [],
      },
      {
        id: "tick_forest",
        label: "上午",
        resolution: "background",
        locationId: "loc_forest",
        locationName: "密林小路",
        participantIds: ["char_wukong"],
        agentOutputs: [],
      },
    ],
  },
};

const events = buildObservationEvents(draft, state);
const feedText = events.flatMap((event) => [event.text, ...(event.beats || []).map((beat) => beat.text)]).join("\n");

assert.ok(!/前前|里里|边边|旁旁|上上/.test(feedText), "generic visible occurrences should not duplicate location suffixes");
assert.ok(!feedText.includes("发生了"), "generic visible occurrences should still read as visible action");
assert.ok(feedText.includes("山门前，"), "front-of-place wording should stay natural");
assert.ok(feedText.includes("密林小路里，"), "inside-place wording should stay natural");

console.log("genericObservationWording:test passed", {
  events: events.length,
  sample: events[0]?.beats?.[0]?.text,
});
