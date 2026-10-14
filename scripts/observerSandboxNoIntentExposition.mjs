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
const firstPeriodText = events.find((event) => event.movementSource === "period-tick")?.text || "";

assert.ok(firstPeriodText, "sandbox period event should exist");
assert.ok(/沈珩.*扣住.*阎无咎|阎无咎.*扣住.*沈珩/.test(firstPeriodText), "period prose should foreground one character acting on another");
assert.ok(/阎无咎.*(挡住|按住|压到|推到).*灵契|沈珩.*(挡住|按住|压到|推到).*灵契/.test(firstPeriodText), "period prose should show the response as an action on the same object");
assert.ok(/说：“[^”]+”/.test(firstPeriodText), "period prose should preserve live dialogue");
assert.ok(/灵契.*(留在|压到|被推|没有落到|没有被).*?(两人中间|铜盘|场中)|铜盘.*(悬|停|压|亮)/.test(firstPeriodText), "period prose should end with an object/rule state change");
assert.ok(!/以[^。；]{1,30}身份|守着|盯着[^。；]{1,40}(资格|证物|庇护权|控制|位置)|要[^。；]{0,40}、[^。；]{0,40}、/.test(firstPeriodText), "period prose should not expose setup intent, identity labels, or verb-list goals before the event");

console.log("observerSandboxNoIntentExposition:test passed", {
  sample: firstPeriodText,
});
