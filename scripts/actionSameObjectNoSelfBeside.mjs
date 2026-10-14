import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。城中不可杀，入城者必须把本命灵契押在四方法契门。",
  setupPeoplePrompt: "正道执律剑修、邪派血河楼使者、妖医、照骨镜器灵、龙裔水府少主、鬼修引魂人都在城中，各自带着前史、旧案和不可公开的目的。",
});

state.ui.timeGrain = "day";
state.ui.focusMode = "location";
state.ui.selectedLocationId = state.locations[0]?.id;

const draft = playNext(state);
const actionText = [
  draft.sceneText,
  ...(draft.agentOutputs || []).map((output) => output.visibleAction || ""),
  ...(draft.periodSimulation?.ticks || []).flatMap((tick) => [
    tick.sceneText || "",
    ...(tick.agentOutputs || []).map((output) => output.visibleAction || ""),
  ]),
].filter(Boolean).join("\n");

assert.doesNotMatch(
  actionText,
  /把([^，。；\s]{1,16})(?:贴到|推到|推近|放到|压到)\1旁/,
  "visible actions must not place an object beside itself",
);
assert.doesNotMatch(
  actionText,
  /把([^，。；\s]{1,16})和\1一起/,
  "visible actions must not pair an object with itself",
);
assert.doesNotMatch(
  actionText,
  /它和(?:灵契|妖丹盒|照骨镜|渡令|庇护牌)/,
  "dialogue must not pair a pronoun with the object it points to",
);
assert.doesNotMatch(
  actionText,
  /([^，。；\s]{1,12})的(?:边角|边缘)和\1/,
  "dialogue must not pair an object's part with the same object",
);
assert.doesNotMatch(
  actionText,
  /(?:灵契|妖丹盒|照骨镜|渡令|庇护牌|符)(?:慢慢|轻轻|重重)/,
  "object names must not absorb action adverbs",
);

console.log("actionSameObjectNoSelfBeside:test passed", {
  sample: actionText.match(/.{0,30}(?:说：“|把).{0,90}/)?.[0] || actionText.slice(0, 160),
});
