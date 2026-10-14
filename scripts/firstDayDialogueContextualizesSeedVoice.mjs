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
state.ui.engineMode = "mock";

const draft = playNext(state);
const periodEvents = buildObservationEvents(draft, state).filter((event) => event.movementSource === "period-tick");

const seedSloganPattern = /按城法扣契，不按宗门私仇|买卖在城规里，别把血仇带进来|我押的是灵契，不是命|价码到了，旧案自然开口|让照骨司先验|剑可以停，证据不能走|庇护牌还亮着，谁也不能拖人|药炉前不问正邪|进了医坊，先救命，后审案|镜面只记灵痕，不替谁认罪|我只照见写下来的东西|渡令未清，谁也不能下水|水阵拦的是破禁，不是人/;
const staleEvents = periodEvents.filter((event) => seedSloganPattern.test(event.text || ""));

assert.equal(
  staleEvents.length,
  0,
  `first-day observation prose should contextualize seed dialogue instead of replaying slogans:\n${JSON.stringify(staleEvents.slice(0, 5).map((event) => ({
    time: event.time,
    location: event.location,
    text: event.text,
  })), null, 2)}`,
);

const genericSurfaceEvents = periodEvents.filter((event) =>
  !/停剑茶楼/.test(event.location || "")
  && /(?:灵契|契牌|妖丹盒|庇护牌|渡令|魂灯|照骨镜)[^。！？]{0,18}桌面/.test(
    [...String(event.text || "").matchAll(/说：“([^”]+)”/g)].map((match) => match[1]).join(" ")
  )
);

assert.equal(
  genericSurfaceEvents.length,
  0,
  `first-day object handling should use the district surface, not generic table language:\n${JSON.stringify(genericSurfaceEvents.slice(0, 5).map((event) => ({
    time: event.time,
    location: event.location,
    text: event.text,
  })), null, 2)}`,
);

console.log("firstDayDialogueContextualizesSeedVoice:test passed", {
  checked: periodEvents.length,
});
