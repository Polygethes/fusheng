import assert from "node:assert/strict";
import { auditDramaticCharacter } from "../src/worldbuilding/skills.js";
import { generatePlayableWorldFromModelSetup } from "../src/server/pipeline/setupGenerator.mjs";

const calls = [];
const generated = await generatePlayableWorldFromModelSetup({
  setupWorldPrompt: "赛博朋克海底避难城，氧气被公司征税，潮汐闸、黑市码头、祈祷舱和藻类工厂决定谁能活到明天。",
  setupPeoplePrompt: "欠债的潜水员走私者、掌管氧气税的公司监察官、被信徒供奉的合成圣女、修理潮汐闸的老工程师、藏着非法鱼人的黑市医生。",
  callModel: async (payload) => {
    calls.push(payload);
    return {
      meta: {
        model: "fake-setup-model",
        provider: "test-json",
        elapsedMs: 12,
      },
      parsed: {
        world: {
          id: "abyss_oxygen_city",
          title: "蓝肺城",
          townName: "蓝肺城",
          genre: "赛博朋克海底避难城 / 资源税 / 信仰与走私",
          summary: "蓝肺城压在海面以下，公司按呼吸征税，潮汐闸和黑市码头决定谁能离开。",
          timepoint: "氧气税重估当天的清晨",
          era: "近未来海底公司城",
          location: "海底避难城蓝肺城",
          background: "海水、公司税务、信徒祈祷和黑市走私共同控制人的下一口气。",
          darknessLevel: 74,
          nobilityLevel: 46,
          publicRules: [
            "每个居民必须用氧气牌登记每日呼吸配额。",
            "潮汐闸只承认公司监察官盖过的通行章。",
            "祈祷舱可以临时庇护欠税者，但庇护到换潮为止。",
          ],
          hiddenRules: [
            "公司把缺氧写成个人欠债。",
            "合成圣女的祈祷记录能改写氧气账本。",
            "黑市医生知道非法鱼人能在闸门外活下来。",
          ],
          powerCenters: ["潮汐闸", "黑市码头", "祈祷舱", "藻类工厂", "氧气税务所"],
          recurringObjects: ["氧气牌", "潮汐闸章", "祈祷记录", "藻类滤芯", "非法鱼人血样"],
          pressureClock: "换潮前，氧气税务所必须重估配额，欠税者会被从祈祷舱拖出来。",
        },
        characters: [
          {
            id: "char_diver",
            name: "潜水员走私者",
            publicIdentity: "欠债的潜水员走私者，靠替人绕过潮汐闸运送氧气牌还债。",
            desire: "把一批欠税者送出蓝肺城，同时不让公司拿到自己的旧账。",
            shame: "害怕自己曾经为了氧气牌卖掉同伴的出闸路线。",
            visible: "藏牌、试价、下潜、递暗号、扣住氧气瓶",
          },
          {
            id: "char_inspector",
            name: "公司监察官",
            publicIdentity: "掌管氧气税的公司监察官，负责给潮汐闸盖章。",
            desire: "让所有氧气配额重新回到公司账本里。",
            shame: "害怕自己母亲也在欠税名单上。",
            visible: "验牌、盖章、扣税、问供、收走通行章",
          },
          {
            id: "char_saint",
            name: "合成圣女",
            publicIdentity: "被信徒供奉的合成圣女，祈祷声会被写进庇护记录。",
            desire: "证明祈祷舱不是公司税务的附属房间。",
            shame: "害怕自己的神圣来自公司合成协议。",
            visible: "合掌、记录祈祷、遮住编号、递庇护牌、停在舱门",
          },
          {
            id: "char_engineer",
            name: "老工程师",
            publicIdentity: "修理潮汐闸的老工程师，知道闸门什么时候会短暂失灵。",
            desire: "让潮汐闸故障被看成事故，而不是放人逃走。",
            shame: "害怕自己修好的每一次闸门都困住更多人。",
            visible: "拆阀、听水压、递扳手、改线路、关警铃",
          },
          {
            id: "char_doctor",
            name: "黑市医生",
            publicIdentity: "藏着非法鱼人的黑市医生，用血样换取氧气滤芯。",
            desire: "让非法鱼人活过换潮，也让自己别被圣女认出来。",
            shame: "害怕自己把病人当成黑市筹码。",
            visible: "换药、藏血样、关灯、递滤芯、挡住诊床",
          },
        ],
        locations: [
          {
            id: "loc_tide_gate",
            name: "潮汐闸",
            visibleUse: "通行章、闸门、水压和逃亡路线在这里互相卡住。",
            likelyEvents: ["通行章被扣", "潮汐闸短暂失灵", "欠税者被拦下", "水压警铃响起"],
          },
          {
            id: "loc_black_pier",
            name: "黑市码头",
            visibleUse: "氧气牌、血样和走私路线在合法摊位后交换。",
            likelyEvents: ["氧气牌试价", "非法鱼人血样外露", "公司暗哨靠近", "滤芯被调包"],
          },
          {
            id: "loc_prayer_pod",
            name: "祈祷舱",
            visibleUse: "庇护、信徒记录和公司编号在玻璃舱门上留下雾气。",
            likelyEvents: ["庇护记录被改", "合成编号亮起", "欠税者跪在舱门前", "祈祷声被截断"],
          },
          {
            id: "loc_algae_factory",
            name: "藻类工厂",
            visibleUse: "滤芯、氧气产量和工人欠税名单被一起清点。",
            likelyEvents: ["藻类滤芯失窃", "产量记录被划掉", "欠税名单贴出", "氧气管短暂停流"],
          },
        ],
        relationships: [
          {
            from: "char_diver",
            to: "char_inspector",
            label: "走私 / 税务",
            pressure: "潜水员走私者需要出闸，监察官手里有能毁掉他的旧账。",
          },
          {
            from: "char_inspector",
            to: "char_saint",
            label: "税务 / 庇护",
            pressure: "监察官需要圣女交出祈祷记录，圣女知道他母亲也欠氧气税。",
          },
          {
            from: "char_saint",
            to: "char_doctor",
            label: "庇护 / 黑市",
            pressure: "圣女庇护欠税者，医生藏着能证明公司说谎的鱼人血样。",
          },
          {
            from: "char_engineer",
            to: "char_diver",
            label: "闸门 / 出逃",
            pressure: "工程师知道潜水员会利用下一次闸门故障。",
          },
        ],
      },
    };
  },
});

assert.equal(calls.length, 1, "setup generator should call the model once");
assert.match(calls[0].system, /世界建立 Skill/);
assert.match(calls[0].system, /戏剧人物 Skill/);
assert.match(calls[0].user, /赛博朋克海底避难城/);
assert.match(calls[0].user, /公司监察官/);

assert.equal(generated.project.title, "蓝肺城");
assert.equal(generated.town.name, "蓝肺城");
assert.equal(generated.worldSetup.generatedBySkills, true);
assert.equal(generated.worldSetup.generatedByModel, true);
assert.equal(generated.worldSetup.modelGeneration.model, "fake-setup-model");
assert.ok(generated.worldSetup.skillPipeline.some((stage) => stage.source === "model-world-skill"), "world stage should be marked as model-generated");
assert.ok(generated.worldSetup.skillPipeline.some((stage) => stage.source === "model-character-skill"), "character stage should be marked as model-generated");
assert.match(generated.locations.map((location) => location.name).join("、"), /潮汐闸|黑市码头|祈祷舱|藻类工厂/);
assert.match(generated.characters.map((character) => character.name).join("、"), /潜水员走私者|公司监察官|合成圣女|老工程师|黑市医生/);
assert.ok(generated.relationships.some((relationship) => /氧气|旧账|祈祷记录|鱼人/.test(relationship.unspoken)));

for (const character of generated.characters) {
  const audit = auditDramaticCharacter(character, generated.characters);
  assert.ok(audit.score >= 80, `${character.name} should satisfy dramatic-character skill, got ${audit.score}`);
  assert.equal(character.agentProfile.generatedBySkill, "戏剧人物 Skill");
}

console.log("modelSetupWorldGeneration:test passed", {
  title: generated.project.title,
  model: generated.worldSetup.modelGeneration.model,
  characters: generated.characters.map((character) => character.name),
});
