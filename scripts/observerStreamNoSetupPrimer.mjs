import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildObservationEvents } from "../src/ui/render.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});

state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.activeTab = "observe";
state.ui.engineMode = "mock";

const draft = playNext(state);
const events = buildObservationEvents(draft, state);
const streamText = events.map((event) => event.text).join("\n");

assert.ok(events.length >= 5, "a day run should still expose the day's live events");
assert.ok(
  events.every((event) => event.movementSource === "period-tick"),
  `observer stream should not prepend setup/world primer events, got sources:\n${events.map((event) => `${event.time}:${event.movementSource}`).join("\n")}`,
);
assert.doesNotMatch(
  streamText,
  /(?:是正道|是邪派|是妖族|是镜塔|守着停剑城|手边常有|开在正邪|公开规则|隐藏规则)/,
  `observer stream should show live events, not world or character setup prose, got:\n${streamText}`,
);
assert.match(
  events[0]?.time || "",
  /上午|中午|下午|傍晚|夜间|T\+/,
  `first observer event should be an in-world time slot, got ${events[0]?.time}`,
);

console.log("observerStreamNoSetupPrimer:test passed", {
  first: `${events[0]?.time} ${events[0]?.location}`,
  count: events.length,
});
