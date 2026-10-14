import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { applyTavernLifeBundle } from "../src/engine/tavernLifeEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

let state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "day";

let ticks = 0;
let dialogueTicks = 0;
for (let day = 0; day < 14; day += 1) {
  const draft = playNext(state);
  for (const tick of draft.periodSimulation?.ticks || []) {
    ticks += 1;
    if ((tick.sceneInteraction?.agentExchanges || []).some((exchange) => (exchange.dialogueTurns || []).length)) dialogueTicks += 1;
  }
  state = applyTavernLifeBundle(state, draft.updateBundle);
}

const needs = state.characters.flatMap((character) => Object.values(character.lifeState?.needs || {})).filter(Number.isFinite);
const extremeNeeds = needs.filter((value) => value >= 95 || value <= 5);
const memoryCount = state.characterMemories?.length || 0;

assert.ok(dialogueTicks / ticks <= 0.4, `dialogue must remain exceptional over 14 days, got ${dialogueTicks}/${ticks}`);
assert.ok(extremeNeeds.length / Math.max(1, needs.length) < 0.25, `needs must oscillate instead of saturating, got ${extremeNeeds.length}/${needs.length} extremes`);
assert.ok(memoryCount <= 48, `ordinary life memories must consolidate, got ${memoryCount}`);
assert.ok(JSON.stringify(state).length < 2_000_000, "the canonical life state must remain compact without draft snapshots");
assert.ok(state.tavernState.day >= 14, "the tavern clock must advance");

console.log("tavernLifeLongRun:test passed", {
  ticks,
  dialogueTicks,
  dialogueRate: dialogueTicks / ticks,
  extremeNeeds: extremeNeeds.length,
  memoryCount,
  stateSize: JSON.stringify(state).length,
});
