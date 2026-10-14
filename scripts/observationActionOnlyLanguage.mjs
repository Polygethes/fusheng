import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playNext } from "../src/engine/mockEngine.js";
import { buildObservationEvents } from "../src/ui/render.js";
import { OBSERVATION_EXPLANATION_BANLIST } from "../src/worldbuilding/skills.js";

const state = structuredClone(initialState);
state.ui.engineMode = "mock";
state.ui.activeTab = "observe";
state.ui.timeGrain = "day";
state.ui.focusMode = "location";
state.ui.selectedLocationId = "loc_lodgers_table";

const draft = playNext(state);
const events = buildObservationEvents(draft, state);
const feedText = events.map((event) => `${event.location} ${event.kind} ${event.text}`).join("\n");

assert.ok(events.length >= 5, "observation should still produce a town-wide event feed");
assert.ok(/[“”]/.test(feedText), "observation language should include novel-like dialogue marks");

for (const term of OBSERVATION_EXPLANATION_BANLIST) {
  assert.ok(!feedText.includes(term), `observation feed should forbid explanatory language: ${term}\n${feedText}`);
}

assert.ok(!/因为|意味着|证明|象征|以便|像/.test(feedText), "observation feed should show action and speech, not interpretation");
assert.ok(!feedText.includes("发生了"), "observation feed should avoid placeholder event wording");
assert.ok(!feedText.includes("你听见了吗？"), "fallback dialogue should be characterful instead of one repeated placeholder line");
assert.ok(!/设证|当前动作|没有说破|自主计划/.test(feedText), "observation feed should translate plan terms into visible stage behavior");
assert.ok(!/手边的门缝|门缝又往里推|推.*门缝/.test(feedText), "observation feed should not assign impossible object actions");
assert.ok(!/空房间与餐桌[\s\S]{0,180}门、车次和钥匙/.test(feedText), "dining-table events should not inherit door-and-commute collision wording");
assert.ok(!/先别[^。！？；]{0,12}先放一边|不能[^。！？；]{0,12}先放一边/.test(feedText), "dialogue should not concatenate two imperatives around a misparsed object anchor");
assert.ok(/说|问|看|拿|停|放|推|擦|敲|走/.test(feedText), "observation feed should be built from visible action and speech");

console.log("observationActionOnlyLanguage:test passed", {
  events: events.length,
  sample: events[0]?.text,
});
