import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "day";
const draft = playNext(state);
const eventIds = new Set(draft.periodSimulation.ticks.flatMap((tick) => (tick.lifeEvents || []).map((event) => event.id)));

assert.ok(draft.narrativeSignals?.length, "latent story must be detected after simulation");
assert.ok(draft.narrativeSignals.every((signal) => eventIds.has(signal.sourceEventId)), "the narrative layer cannot invent a signal without a lived event");
assert.ok(draft.narrativeSignals.some((signal) => signal.type === "boundary" || signal.type === "world-pressure"));
assert.ok(draft.narrativeSignals.length <= 12, "story extraction must stay selective");

console.log("tavernNarrativeDetector:test passed", { signals: draft.narrativeSignals.map((signal) => signal.type) });
