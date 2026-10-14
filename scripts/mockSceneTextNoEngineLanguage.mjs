import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { generatePlayableWorldFromModelSetup } from "../src/server/pipeline/setupGenerator.mjs";

const state = await generatePlayableWorldFromModelSetup({
  setupWorldPrompt: "赛博朋克海底避难城，氧气被公司征税，潮汐闸、黑市码头和祈祷舱互相牵制。",
  setupPeoplePrompt: "潜水员走私者、公司监察官、合成圣女。",
  callModel: async () => ({
    meta: { model: "fake-scene-text-model", provider: "test-json" },
    parsed: {
      world: {
        id: "oxygen_gate_city",
        title: "氧潮城",
        townName: "氧潮城",
        summary: "氧潮城用氧气牌、潮汐闸章和祈祷记录分配生存。",
        timepoint: "换潮前一小时",
        era: "近未来海底公司城",
        location: "氧潮城",
        background: "公司税务、祈祷庇护和黑市走私都围绕氧气配额互相卡住。",
        publicRules: ["居民必须登记氧气牌。", "潮汐闸只认通行章。"],
        hiddenRules: ["祈祷记录可以改写欠税名单。"],
        powerCenters: ["潮汐闸", "黑市码头", "祈祷舱"],
        recurringObjects: ["氧气牌", "潮汐闸章", "祈祷记录", "鱼人血样"],
        pressureClock: "换潮前必须决定谁还能领取下一轮氧气。",
      },
      characters: [
        {
          id: "char_diver",
          name: "潜水员走私者",
          publicIdentity: "欠债的潜水员走私者，替人绕过潮汐闸。",
          desire: "把欠税者送出氧潮城。",
          shame: "害怕自己卖过同伴的路线。",
          visible: "藏牌、试价、下潜、递暗号",
          defenseLanguage: ["氧气牌可以留下，人先过闸。", "我卖的是一条路，不是他们的命。", "潮汐闸章别交给公司。"],
        },
        {
          id: "char_inspector",
          name: "公司监察官",
          publicIdentity: "掌管氧气税的公司监察官。",
          desire: "把所有氧气配额收回账本。",
          shame: "害怕母亲也在欠税名单上。",
          visible: "验牌、盖章、扣税、问供",
          defenseLanguage: ["潮汐闸章先验章，再谈庇护。", "欠税名单不能离开税务所。", "祈祷记录不是人情，是通行手续。"],
        },
        {
          id: "char_saint",
          name: "合成圣女",
          publicIdentity: "被信徒供奉的合成圣女。",
          desire: "让祈祷舱保住欠税者。",
          shame: "害怕自己的神圣来自公司协议。",
          visible: "合掌、记录祈祷、遮住编号",
          defenseLanguage: ["祈祷舱里先给人留一口气。", "祈祷记录不能替公司关门。", "编号可以亮，人不能被拖走。"],
        },
      ],
      locations: [
        {
          id: "loc_gate",
          name: "潮汐闸",
          visibleUse: "通行章、氧气牌、闸门和水压在这里卡住。",
          likelyEvents: ["通行章被扣", "潮汐闸短暂失灵", "氧气牌被推回闸门边"],
        },
        {
          id: "loc_pier",
          name: "黑市码头",
          visibleUse: "氧气牌和鱼人血样在这里换手。",
          likelyEvents: ["氧气牌试价", "鱼人血样外露"],
        },
        {
          id: "loc_pod",
          name: "祈祷舱",
          visibleUse: "祈祷记录在舱门上留下雾气。",
          likelyEvents: ["祈祷记录被改", "欠税者跪在舱门前"],
        },
      ],
      relationships: [
        { from: "char_diver", to: "char_inspector", label: "走私 / 税务", pressure: "走私者需要出闸，监察官握着旧账。" },
        { from: "char_inspector", to: "char_saint", label: "税务 / 庇护", pressure: "监察官要祈祷记录，圣女知道他的母亲欠税。" },
      ],
    },
  }),
});

state.ui.timeGrain = "scene";
state.ui.focusMode = "focused";
state.ui.activeTab = "observe";
state.ui.selectedLocationId = "loc_gate";
state.ui.activeCharacterIds = ["char_diver", "char_inspector", "char_saint"];

const draft = playNext(state);
const rawText = [draft.surfaceEvent, draft.sceneText].filter(Boolean).join("\n");

assert.doesNotMatch(
  rawText,
  /实时模拟|私人后台|私人模拟|不是预写剧情|行动候选|没有说出真正|误读生成|反向变化|由私人模拟|可见场所|后台运行|低精度/,
  `raw draft scene text should be observable prose, got:\n${rawText}`,
);
assert.doesNotMatch(
  rawText,
  /试探了局面|挡开了局面|按住了局面|放近了局面|抽离了局面|设下了局面/,
  `raw draft scene text should not label actions as abstract situation moves, got:\n${rawText}`,
);
assert.doesNotMatch(rawText, /。”。|。”。/, `raw draft scene text should not double-punctuate quoted dialogue, got:\n${rawText}`);
assert.match(draft.surfaceEvent, /潮汐闸/, `surface event should name the visible place, got: ${draft.surfaceEvent}`);
assert.match(
  rawText,
  /氧气牌|潮汐闸章|通行章|祈祷记录/,
  `raw draft scene text should use world-specific objects, got:\n${rawText}`,
);
assert.match(rawText, /说：“/, `raw draft scene text should carry dialogue from the agent exchange, got:\n${rawText}`);
assert.match(
  rawText,
  /扣住|压到|推到|挡住|递到|留在|停在/,
  `raw draft scene text should show observable action and object movement, got:\n${rawText}`,
);

console.log("mockSceneTextNoEngineLanguage:test passed", {
  surfaceEvent: draft.surfaceEvent,
  sample: rawText.slice(0, 500),
});
