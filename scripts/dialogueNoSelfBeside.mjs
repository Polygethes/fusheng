import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildObservationEvents } from "../src/ui/render.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.activeTab = "observe";

const draft = playNext(state);
const events = buildObservationEvents(draft, state);
const text = events.map((event) => event.text || "").join("\n");

assert.doesNotMatch(text, /把([^，。；\s]{1,12})留在\1旁/, "dialogue should not say an object is left beside itself");
assert.doesNotMatch(text, /([^，。；\s]{1,12})也得留在这里。[^。]*\1不能离开这里/, "dialogue should avoid repetitive same-object bargaining");

console.log("dialogueNoSelfBeside:test passed", {
  sample: events.find((event) => /说：“/.test(event.text || ""))?.text || "",
});
