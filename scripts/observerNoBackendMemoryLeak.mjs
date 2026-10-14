import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildObservationEvents } from "../src/ui/render.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

state.ui = {
  ...(state.ui || {}),
  timeGrain: "day",
  focusMode: "location",
  selectedLocationId: "loc_xianxia_contract_gate",
  activeTab: "observe",
  engineMode: "mock",
};

const draft = playNext(state);
const events = buildObservationEvents(draft, state);
const feedText = events
  .filter((event) => event.locationId === state.ui.selectedLocationId)
  .map((event) => event.text)
  .join("\n");

for (const forbidden of [
  /上一轮/,
  /上次/,
  /\d+\s*轮/,
  /这轮关系/,
  /形成保护债/,
  /保护债/,
  /关系状态/,
  /必须先回答/,
  /接住.+那一步/,
  /欠下的话/,
  /未结清/,
  /拖了刚才/,
  /拖了上一轮/,
  /拖了几次/,
  /拖了\d+\s*轮/,
]) {
  assert.doesNotMatch(feedText, forbidden, `observation prose should hide backend memory wording: ${forbidden}\n${feedText}`);
}

assert.match(feedText, /[“”]/, "observation prose should still contain dialogue");
assert.match(feedText, /扣|压|推|挡|留|问|说/, "observation prose should still show visible action");

console.log("observerNoBackendMemoryLeak:test passed", {
  events: events.length,
  sample: events[0]?.text,
});
