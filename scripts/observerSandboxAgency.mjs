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
const world = events.find((event) => event.movementSource === "sandbox-world");
const cast = events.find((event) => event.movementSource === "sandbox-cast");
const actionEvents = events.filter((event) => event.movementSource === "period-tick");
const actionText = actionEvents.map((event) => event.text).join("\n");

assert.ok(world, "observation should start with a world sandbox paragraph");
assert.ok(cast, "observation should include a cast sandbox paragraph before action");
assert.match(world.text, /停剑城|中立城市/, "world sandbox should name the playable world");
assert.match(world.text, /灵契|庇护牌|照骨司|无咎市/, "world sandbox should expose the rules and objects agents act through");
assert.match(cast.text, /沈珩|阎无咎|鹿青萝|阿照/, "cast sandbox should name distinct agents");
assert.match(cast.text, /正道|邪派|妖族|器灵|龙裔|鬼修|副判/, "cast sandbox should show agent identities, not just names");
assert.ok(actionEvents.length >= 5, "one play should still produce period action events");

const templatedOpenings = actionEvents.filter((event) =>
  /要[^。]{1,36}；[^。]{1,12}想[^。]{1,36}。[^。]{1,12}(?:绷着一层慌|停在试探和退让之间|压着火气)/.test(event.text)
);
assert.ok(templatedOpenings.length <= 1, "period action prose should not reuse the same intent/state sentence frame across the day");
assert.ok(!/^(上午|中午|下午|傍晚|夜间)，[^。]+要[^。]+；[^。]+想/.test(actionText), "action paragraphs should not all open as planning summaries");
assert.ok(/扣住|压到|封上|截住|拦下|扣到|亮了/.test(actionText), "actions should still be visible in the sandbox");
assert.ok(!/私人模拟|后台运行|低精度|行动候选|运行：|时间压力/.test(events.map((event) => event.text).join("\n")), "sandbox prose should not leak engine language");
assert.ok(!/守着守住|四方法契门正邪两派|医坊的庇护权，不让任何一派把病人当证据拖走，手边常有/.test(events.map((event) => event.text).join("\n")), "sandbox prose should be polished rather than raw setup fields pasted together");

console.log("observerSandboxAgency:test passed", {
  world: world.text,
  cast: cast.text,
  sample: actionEvents[0]?.text,
});
