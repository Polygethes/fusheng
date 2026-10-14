import assert from "node:assert/strict";
import { playTavernLifeNext } from "../src/engine/tavernLifeEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "day";

const draft = playTavernLifeNext(state);
const socialEvents = draft.periodSimulation.ticks.flatMap((tick) => (tick.lifeEvents || [])
  .filter((event) => ["request", "refuse"].includes(event.activityType))
  .map((event) => ({ tick, event })));

assert.ok(socialEvents.length >= 1, "fixture must contain at least one canonical request or refusal");
for (const { tick, event } of socialEvents) {
  assert.ok(event.decisionOpportunity?.id, `${event.activityType} must activate the speaking Agent instead of remaining narrator-only`);
  assert.ok((event.decisionOpportunity?.candidateActions || []).some((candidate) => candidate.type === event.activityType));
  const output = (tick.agentOutputs || []).find((item) => item.decisionOpportunity?.id === event.decisionOpportunity.id);
  assert.ok(output, `${event.activityType} decision opportunity must survive into the Agent pipeline`);
  assert.equal(output.targetCharacterId, event.targetCharacterId, "the Agent must receive the public addressee for this social act");
}

console.log("modelTavernSocialIntentOpportunity:test passed", { socialEvents: socialEvents.map(({ event }) => event.activityType) });
