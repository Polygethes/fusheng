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
const actionText = buildObservationEvents(draft, state)
  .filter((event) => event.movementSource === "period-tick")
  .map((event) => event.text || "")
  .join("\n");
const quotedLines = [...actionText.matchAll(/说：“([^”]+)”/g)].map((match) => match[1]);
const cueLeak = quotedLines.find((line) =>
  /^(灯亮了|账页翻开了|笔停下了|门槛有脚印了|凭证还压在灯下|纸页露出来了|手套还没收走|动静已经露出来了)[，,]/.test(line)
);

assert.ok(quotedLines.length >= 8, "day observation should contain spoken dialogue");
assert.equal(cueLeak, undefined, `conductor clue should not be spoken as character dialogue: ${cueLeak}`);
assert.ok(
  quotedLines.some((line) => /灵契|妖丹盒|照骨镜|渡令|庇护牌/.test(line)),
  "dialogue should still stay grounded in scene objects after removing cue leakage",
);

console.log("observerDialogueNoConductorCue:test passed", {
  sample: quotedLines.slice(0, 6),
});
