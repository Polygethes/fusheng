import assert from "node:assert/strict";
import { playTavernLifeNext } from "../src/engine/tavernLifeEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "scene";

const draft = playTavernLifeNext(state);
const tick = draft.periodSimulation.ticks[0];
const arrivalIndex = tick.lifeEvents.findIndex((event) => event.characterId === "char_xyy_chenyan" && event.activityType === "arrive");
assert.ok(arrivalIndex >= 0, "the opening fixture must contain Chen Yan's arrival");

const expectedHosts = tick.agentOutputs.filter((output) => ["char_xyy_xiemu", "char_xyy_xiezenshi"].includes(output.characterId));
assert.ok(expectedHosts.length >= 1);
let waitingHostCount = 0;
for (const host of expectedHosts) {
  const visit = host.perceivedVisit;
  if (!visit || visit.stage !== "waiting" || !(visit.expectedHostIds || []).includes(host.characterId)) continue;
  waitingHostCount += 1;
  const candidateTypes = (host.decisionOpportunity?.candidateActions || []).map((candidate) => candidate.type);
  assert.ok(candidateTypes.includes("receive_guest"), `${host.characterName} sees a waiting assigned guest but has no receive_guest affordance`);
  assert.equal(new Set(candidateTypes).size, candidateTypes.length, `${host.characterName}'s action types must be unique and unambiguous`);
  assert.equal(visit.stage, "waiting", `${host.characterName}'s perceived visit snapshot must match the pre-action decision state`);
}
assert.ok(waitingHostCount >= 1, "at least one assigned host must decide from the guest's waiting state in the arrival slot");

const firstHostActionIndex = tick.lifeEvents.findIndex((event) => event.activityType === "receive_guest" && event.visitId);
assert.ok(firstHostActionIndex > arrivalIndex, "arrival must become a shared public fact before a host can receive the guest in the same slot");

console.log("tavernSameTickArrivalReception:test passed", {
  events: tick.lifeEvents.map((event) => `${event.characterName || "world"}:${event.activityType}`),
});
