import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "赛博朋克海底避难城，氧气被公司征税，潮汐闸、黑市码头和祈祷舱互相牵制。",
  setupPeoplePrompt: "潜水员走私者、公司监察官、合成圣女、老工程师、黑市医生。",
});

state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.activeTab = "observe";

const draft = playNext(state);
const text = draft.sceneText || "";
const generatedLocationEvents = state.locations.flatMap((location) => location.likelyEvents || []).join("\n");

assert.match(text, /赛博朋克海底避难城|氧气|潮汐闸|黑市码头|祈祷舱/, "generated directive should still carry the user-created world into observation");
assert.match(text, /潜水员走私者|公司监察官|合成圣女|老工程师|黑市医生/, "generated directive should still carry the cast into observation");
assert.doesNotMatch(
  text,
  /Skill|世界建立|戏剧人物|世界档案|低精度|后台运行|聚焦地点升格|升格为一场戏|未被观察|被观察|模型|simulation/i,
  `generated setup directive should not leak backend construction terms into observation text, got:\n${text}`,
);
assert.doesNotMatch(text, /没有显式事件|压力自然流动/, "period opening should read like observation prose, not simulation status");
assert.doesNotMatch(text, /私人解释|当事人在半公开|没有被看见|程序与档案/, "period slot focus should describe visible traces instead of abstract analysis");
assert.doesNotMatch(
  generatedLocationEvents,
  /([\u4e00-\u9fa5A-Za-z0-9]{2,12})被推到\1的明处/,
  `generated location events should not repeat the same place/object around 明处, got:\n${generatedLocationEvents}`,
);
for (const name of ["潜水员走私者", "公司监察官", "合成圣女", "老工程师", "黑市医生"]) {
  assert.doesNotMatch(
    text,
    new RegExp(`${name}在[^\\n。；]*${name}`),
    `offscreen action prose should not repeat the actor name in a spliced sentence: ${name}`,
  );
}

console.log("generatedDirectiveNoBackendLanguage:test passed", {
  sample: text.slice(0, 360),
});
