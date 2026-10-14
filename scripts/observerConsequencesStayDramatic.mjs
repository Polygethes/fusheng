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
const prose = buildObservationEvents(draft, state)
  .filter((event) => event.locationId === state.ui.selectedLocationId)
  .map((event) => event.text || "")
  .join("\n");

assert.ok(prose, "the complete-day observer should render prose");
assert.doesNotMatch(
  prose,
  /临时控制|临时见证权|不能只凭|若要审讯|必须从[^。；]+重新开口|再加码的人先|这次见证/,
  `observer prose should not expose adjudication language, got:\n${prose}`,
);
assert.match(
  prose,
  /(?:手|脚步|指尖)[^。；]{0,18}(?:停住|停在)|(?:写下|记下|按住|挡在)/,
  "observer prose should show a visible consequence instead of explaining control state",
);

console.log("observerConsequencesStayDramatic:test passed", {
  sample: prose.split("\n")[0],
});
