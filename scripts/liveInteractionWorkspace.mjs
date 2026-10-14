import assert from "node:assert/strict";
import { renderApp } from "../src/ui/render.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族医者、鬼修、龙裔与器灵。",
});
state.ui.setupCompleted = true;
state.ui.activeTab = "reality";
state.ui.engineMode = "openai";
state.ui.livePerformance = {
  runId: "run_live",
  status: "running",
  phase: "interaction",
  label: "四方法契门 · 正在交锋",
  locationName: "四方法契门",
  agents: [
    { characterId: "char_xianxia_shenheng", characterName: "沈珩", status: "acting" },
    { characterId: "char_xianxia_yanwujie", characterName: "阎无咎", status: "responding" },
  ],
  events: [
    {
      id: "live_action_1",
      type: "action",
      actorId: "char_xianxia_shenheng",
      actorName: "沈珩",
      targetId: "char_xianxia_yanwujie",
      targetName: "阎无咎",
      text: "沈珩把契牌扣在铜盘边，没有让阎无咎收回魔印。",
      privateDesire: "这句绝不能出现在现实空间",
    },
    {
      id: "live_dialogue_1",
      type: "dialogue",
      speakerId: "char_xianxia_yanwujie",
      speakerName: "阎无咎",
      targetId: "char_xianxia_shenheng",
      targetName: "沈珩",
      line: "你要名字，就先把扣住的契牌还给我。",
      respondsTo: "名字写明白再说。",
    },
  ],
};

const html = renderApp(state);
assert.match(html, /data-live-performance="true"/, "reality should expose a dedicated live performance state");
assert.match(html, /沈珩把契牌扣在铜盘边/, "visible action should appear while the model is still running");
assert.match(html, /阎无咎/, "the responding character should be visible");
assert.match(html, /你要名字，就先把扣住的契牌还给我/, "dialogue should appear turn by turn");
assert.match(html, /回答沈珩/, "the interaction should make the response target explicit using the current reply label");
assert.doesNotMatch(html, /这句绝不能出现在现实空间/, "private fields must never render in reality");
assert.match(html, /演出中/, "the play control should show a live running state");

state.ui.livePerformance.status = "interrupted";
state.ui.livePerformance.phase = "interrupted";
state.ui.livePerformance.label = "连接中断 · 现场已保留";
state.ui.lastPlayError = "实时连接中断，已保留当前场景。";
const interruptedHtml = renderApp(state);
assert.match(interruptedHtml, /data-live-performance="true"/, "an interrupted stream must keep the live surface mounted");
assert.match(interruptedHtml, /沈珩把契牌扣在铜盘边/, "partial visible action must survive a terminal stream failure");
assert.match(interruptedHtml, /你要名字，就先把扣住的契牌还给我/, "partial dialogue must survive a terminal stream failure");
assert.match(interruptedHtml, /现场已保留/, "the observer should state that the partial scene remains available");

console.log("liveInteractionWorkspace:test passed");
