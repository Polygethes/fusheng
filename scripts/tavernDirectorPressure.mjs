import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { applyTavernLifeBundle } from "../src/engine/tavernLifeEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "day";
state.ui.injectedEvent = "谢真石当众承认父亲的牺牲并决定放弃修行";

const draft = playNext(state);
const firstTick = draft.periodSimulation.ticks[0];
const injected = firstTick.lifeEvents.find((event) => event.activityType === "world" && event.pressureType === "injected-pressure");

assert.ok(injected, "operator input must enter as external pressure");
assert.match(injected.description, /尚未核实|传闻|说法/);
assert.equal(injected.canonicalTruth, false, "an injected outcome cannot become canonical truth");
assert.ok(firstTick.lifeEvents.some((event) => event.characterId && event.reason), "characters must still choose their own actions after pressure arrives");
assert.equal(firstTick.sceneInteraction.directorAuthoredOutcome, false);
assert.equal(draft.updateBundle.consumedInjectedEvent, true);

const next = applyTavernLifeBundle(state, draft.updateBundle);
assert.equal(next.ui.injectedEvent, "", "consumed pressure must not repeat forever");
assert.ok(next.tavernState.recentMicroEvents.some((event) => event.type === "injected-pressure"));

console.log("tavernDirectorPressure:test passed", { pressure: injected.description });
