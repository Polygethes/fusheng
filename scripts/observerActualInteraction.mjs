import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildObservationEvents } from "../src/ui/render.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

state.ui.timeGrain = "day";
state.ui.focusMode = "location";
state.ui.selectedLocationId = "loc_xianxia_contract_gate";
state.ui.activeTab = "observe";

const draft = playNext(state);
const events = buildObservationEvents(draft, state);
const actionEvents = events.filter((event) => event.movementSource === "period-tick");
const focusedEvents = actionEvents.filter((event) => event.locationId === state.ui.selectedLocationId);
const firstText = focusedEvents[0]?.text || "";
const allText = actionEvents.map((event) => event.text).join("\n");

assert.ok(firstText, "first observation event should exist");
assert.ok(!/要[^。；]{0,40}、[^。；]{0,40}、[^。；]{0,40}/.test(allText), "goals should read as dramatic intent, not long verb lists");
assert.ok(/沈珩.*扣住.*阎无咎/.test(firstText), "first event should show one character acting on another");
assert.ok(/阎无咎.*(压|递|挡|推|按住|挪到).*铜盘/.test(firstText), "first event should show the second character responding in the same exchange");
assert.ok(/守门人.*(印|盖印)|铜盘.*停|契牌.*扣/.test(firstText), "interaction should change the shared object or rule state");
assert.ok(!/同一件事里|停在试探和退让之间；阎无咎绷着一层慌。灵契和界石/.test(firstText), "event prose should not stop at abstract collision wording");
for (const event of focusedEvents) {
  assert.ok(/面前|压到|压在|按到|扣住|挡住|挡在|推近|挪开|露在外面|摁住|悬在|响了一声|停在/.test(event.text), `event should contain a concrete exchange or object change: ${event.time}`);
}

console.log("observerActualInteraction:test passed", {
  sample: firstText,
});
