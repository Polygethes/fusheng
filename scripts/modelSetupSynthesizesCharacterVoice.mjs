import assert from "node:assert/strict";
import { generatePlayableWorldFromModelSetup } from "../src/server/pipeline/setupGenerator.mjs";

const generated = await generatePlayableWorldFromModelSetup({
  setupWorldPrompt: "赛博朋克海底避难城，氧气被公司征税，潮汐闸、黑市码头和祈祷舱互相牵制。",
  setupPeoplePrompt: "潜水员走私者、公司监察官、合成圣女、老工程师、黑市医生。",
  callModel: async () => ({
    meta: { model: "fake-voice-model", provider: "test-json" },
    parsed: {
      world: {
        id: "oxygen_city_voice",
        title: "氧潮城",
        townName: "氧潮城",
        summary: "氧潮城用氧气牌、潮汐闸章和祈祷记录分配生存。",
        timepoint: "换潮前一小时",
        era: "近未来海底公司城",
        location: "氧潮城",
        background: "公司税务、祈祷庇护和黑市走私都围绕氧气配额互相卡住。",
        publicRules: ["居民必须登记氧气牌。", "潮汐闸只认通行章。"],
        hiddenRules: ["祈祷记录可以改写欠税名单。", "黑市医生知道公司藏起了鱼人血样。"],
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
        },
        {
          id: "char_inspector",
          name: "公司监察官",
          publicIdentity: "掌管氧气税的公司监察官。",
          desire: "把所有氧气配额收回账本。",
          shame: "害怕母亲也在欠税名单上。",
          visible: "验牌、盖章、扣税、问供",
        },
        {
          id: "char_saint",
          name: "合成圣女",
          publicIdentity: "被信徒供奉的合成圣女。",
          desire: "让祈祷舱保住欠税者。",
          shame: "害怕自己的神圣来自公司协议。",
          visible: "合掌、记录祈祷、遮住编号",
        },
      ],
      locations: [
        { id: "loc_gate", name: "潮汐闸", visibleUse: "通行章和水压在这里卡住。", likelyEvents: ["通行章被扣", "水压警铃响起"] },
        { id: "loc_pier", name: "黑市码头", visibleUse: "氧气牌和鱼人血样在这里换手。", likelyEvents: ["氧气牌试价", "鱼人血样外露"] },
        { id: "loc_pod", name: "祈祷舱", visibleUse: "庇护记录在舱门上留下雾气。", likelyEvents: ["祈祷记录被改", "欠税者跪在舱门前"] },
      ],
      relationships: [
        { from: "char_diver", to: "char_inspector", label: "走私 / 税务", pressure: "走私者需要出闸，监察官握着旧账。" },
        { from: "char_inspector", to: "char_saint", label: "税务 / 庇护", pressure: "监察官要祈祷记录，圣女知道他的母亲欠税。" },
      ],
    },
  }),
});

const genericLines = /我只是照规矩办|这对大家都好|现在不是说这个的时候|先等一下|话还没说完/;
const voices = generated.characters.map((character) => ({
  name: character.name,
  defenseLanguage: character.defenseLanguage || [],
  dialogueMoves: character.agentProfile?.dialogueMoves || [],
}));

for (const voice of voices) {
  assert.ok(voice.defenseLanguage.length >= 3, `${voice.name} should get at least three character-specific defense lines`);
  assert.ok(voice.dialogueMoves.length >= 3, `${voice.name} should carry dialogue moves into agentProfile`);
  assert.doesNotMatch(voice.defenseLanguage.join("\n"), genericLines, `${voice.name} should not use generic fallback defenses`);
  assert.match(
    voice.defenseLanguage.join("\n"),
    /氧气|潮汐|祈祷|欠税|通行|血样|鱼人|闸|舱|牌|章/,
    `${voice.name} should speak through world-specific objects and pressures`,
  );
}

assert.notEqual(
  voices[0].defenseLanguage.join("|"),
  voices[1].defenseLanguage.join("|"),
  "different characters should not share the same synthesized voice",
);
assert.notEqual(
  voices[1].defenseLanguage.join("|"),
  voices[2].defenseLanguage.join("|"),
  "different roles should produce distinct defense language",
);
const saintVoice = voices.find((voice) => voice.name === "合成圣女")?.defenseLanguage.join("\n") || "";
assert.match(saintVoice, /祈祷舱|编号|人不能被拖走/, "sacred/refuge roles should speak from prayer and shelter, not tax office procedure");
assert.doesNotMatch(saintVoice, /欠税名单不能离开税务所/, "sacred/refuge role voice should not be misclassified as a tax inspector");

console.log("modelSetupSynthesizesCharacterVoice:test passed", voices);
