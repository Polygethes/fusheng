import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { applyTavernLifeBundle } from "../src/engine/tavernLifeEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

let state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "day";

const socialEvents = [];
const shifts = [];
let visibleSocialConsequences = 0;
for (let day = 0; day < 7; day += 1) {
  const draft = playNext(state);
  for (const tick of draft.periodSimulation.ticks) {
    const tickSocial = (tick.lifeEvents || []).filter((event) => ["request", "refuse", "avoid", "assist"].includes(event.activityType));
    socialEvents.push(...tickSocial);
    visibleSocialConsequences += tickSocial.filter((event) => String(tick.sceneText || "").includes(event.characterName)).length;
  }
  shifts.push(...(draft.updateBundle.relationships || []));
  state = applyTavernLifeBundle(state, draft.updateBundle);
}

assert.ok(socialEvents.some((event) => event.activityType === "request"), "a private goal must eventually become a request");
assert.ok(socialEvents.some((event) => event.activityType === "refuse"), "a boundary must eventually become a refusal");
assert.ok(socialEvents.every((event) => event.targetCharacterId && event.reason), "social action needs a real target and reason");
assert.ok(shifts.length >= 2, "social actions must alter durable multi-dimensional relationships");
assert.ok(visibleSocialConsequences >= 2, "salient requests and refusals must remain visible after narrative compression");
assert.ok(shifts.some((shift) => Object.values(shift.deltas || {}).some((delta) => Number(delta) < 0)), "a refusal must be allowed to reduce dependence or closeness");
assert.ok((state.characterMemories || []).some((memory) => memory.type === "interpreted-event" && memory.targetCharacterId), "social consequences need interpreted, relational memory");
assert.ok((state.tavernState.pendingRequests || []).length <= 4, "unanswered requests must stay bounded");

for (const character of state.characters.filter((character) => character.lifeProfile?.simulationTier === "core")) {
  assert.ok(character.lifeProfile.activities?.routine, `${character.name} must know what to do without a protagonist`);
  assert.ok(character.lifeProfile.refusal, `${character.name} must have a refusal boundary`);
  assert.ok(character.lifeProfile.privatePursuit, `${character.name} must pursue something privately`);
}

console.log("tavernSocialConsequences:test passed", {
  socialTypes: [...new Set(socialEvents.map((event) => event.activityType))],
  shiftCount: shifts.length,
  memoryCount: state.characterMemories.length,
});
