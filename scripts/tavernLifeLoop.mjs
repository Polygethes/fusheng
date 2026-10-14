import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "day";

const before = new Map(state.characters.map((character) => [character.id, structuredClone(character.lifeState.needs)]));
const draft = playNext(state);
const ticks = draft.periodSimulation?.ticks || [];

assert.equal(ticks.length, 5, "one tavern day needs five lived time slots");
assert.ok(ticks.every((tick) => tick.locationId === "loc_xyy_tavern"), "the camera must never leave the tavern");
assert.ok(ticks.every((tick) => Array.isArray(tick.lifeEvents) && tick.lifeEvents.length), "each slot needs resolved activities");

const dialogueTicks = ticks.filter((tick) => (tick.sceneInteraction?.agentExchanges || []).some((exchange) => (exchange.dialogueTurns || []).length)).length;
assert.ok(dialogueTicks <= 2, `ordinary life must dominate the day, got dialogue in ${dialogueTicks}/5 slots`);
assert.ok(ticks.some((tick) => !(tick.sceneInteraction?.agentExchanges || []).length), "at least one slot must remain quiet");

const activityTypes = new Set(ticks.flatMap((tick) => tick.lifeEvents.map((event) => event.activityType)));
assert.ok(activityTypes.size >= 4, `the tavern needs varied activities, got ${[...activityTypes].join(", ")}`);
assert.ok(activityTypes.has("eat") || activityTypes.has("drink") || activityTypes.has("rest"), "someone must answer a bodily need");
assert.ok(activityTypes.has("duty") || activityTypes.has("maintain"), "someone must keep the tavern running");

assert.ok(draft.updateBundle?.tavernState, "material tavern state must persist");
assert.ok((draft.updateBundle?.characters || []).every((patch) => patch.lifeState?.needs), "need changes must persist per character");
assert.ok((draft.updateBundle?.characters || []).some((patch) => {
  const oldNeeds = before.get(patch.id) || {};
  return Object.entries(patch.lifeState.needs).some(([key, value]) => Number(value) < Number(oldNeeds[key]));
}), "at least one chosen activity must actually satisfy a need");

console.log("tavernLifeLoop:test passed", {
  dialogueTicks,
  activityTypes: [...activityTypes],
  stock: draft.updateBundle.tavernState.stock,
});
