import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { generatePlayableWorldFromModelSetup } from "../src/server/pipeline/setupGenerator.mjs";

const state = await generatePlayableWorldFromModelSetup({
  setupWorldPrompt: "赛博朋克海底避难城，氧气被公司征税。",
  setupPeoplePrompt: "潜水员走私者、公司监察官、合成圣女。",
  callModel: async () => ({
    meta: { model: "fake-costume-visible-model", provider: "test-json" },
    parsed: {
      world: {
        id: "deep_breath_city",
        title: "深渊堡",
        townName: "深渊堡",
        summary: "深渊堡用氧气税、监察站和圣女厅分配生存。",
        timepoint: "氧气税新规第三周",
        era: "近未来赛博朋克",
        location: "太平洋海底避难城",
        background: "海底公司控制氧气，走私、监察和庇护互相牵制。",
        publicRules: ["所有氧气罐必须缴税。", "监察官可以临检氧气容器。"],
        hiddenRules: ["圣女厅会隐藏无法缴税的人。"],
        powerCenters: ["气泡市场", "第七监察站", "圣女厅"],
        recurringObjects: ["氧气计费手环", "深海鱼皮包", "氧气结晶"],
        pressureClock: "公司大清查开始前，至少有一件氧气凭证会换手。",
      },
      characters: [
        {
          id: "char_diver",
          name: "莫尔",
          publicIdentity: "深海回收员，暗中替人绕过氧气税。",
          desire: "攒够通行钱离开深渊堡。",
          shame: "曾经为氧气出卖过同伴。",
          visible: "旧潜水服，腰挂多种氧气瓶改装工具，靴底嵌着盐白色划痕",
          defenseLanguage: ["我只是做合法回收。", "氧气计费手环可以查，人先别扣。", "我没本事动公司的账。"],
        },
        {
          id: "char_inspector",
          name: "绮拉",
          publicIdentity: "掌管氧气税的公司监察官。",
          desire: "抓到走私网背后的高层。",
          shame: "曾误判无辜者导致其窒息。",
          visible: "整洁的办公制服，胸前徽章闪烁，手持数据平板",
          defenseLanguage: ["我只是执行公司规定。", "记录要先打开。", "配合检查，事情会简单很多。"],
        },
        {
          id: "char_saint",
          name: "伊芙",
          publicIdentity: "被信徒供奉的合成圣女。",
          desire: "让圣女厅庇护缴不起税的人。",
          shame: "害怕自己的神圣来自公司协议。",
          visible: "蓝色长袍，面容如同少女，手中常握氧气结晶",
          defenseLanguage: ["我的祝福不属于公司。", "氧气结晶先留下。", "我只为受苦的人祈祷。"],
        },
      ],
      locations: [
        {
          id: "loc_market",
          name: "气泡市场",
          visibleUse: "氧气计费手环、旧氧气罐和深海鱼皮包在这里换手。",
          likelyEvents: ["监察官临检", "氧气计费手环被扣", "深海鱼皮包被推到柜台边"],
        },
        {
          id: "loc_checkpoint",
          name: "第七监察站",
          visibleUse: "数据平板和氧气税账在这里被核验。",
          likelyEvents: ["氧气税账被打开", "通行记录被删改"],
        },
        {
          id: "loc_chapel",
          name: "圣女厅",
          visibleUse: "氧气结晶和祈祷记录在这里被藏起。",
          likelyEvents: ["氧气结晶发亮", "祈祷记录被盖住"],
        },
      ],
      relationships: [
        { from: "char_diver", to: "char_inspector", label: "走私 / 临检", pressure: "莫尔过去给过绮拉线索，绮拉怀疑他仍在隐藏更大的路线。" },
        { from: "char_inspector", to: "char_saint", label: "监察 / 庇护", pressure: "绮拉需要圣女厅的记录，伊芙知道绮拉曾误判无辜者。" },
        { from: "char_saint", to: "char_diver", label: "庇护 / 利用", pressure: "伊芙曾藏过莫尔，现在需要莫尔把缴不起税的人带出市场。" },
      ],
    },
  }),
});

const invalidActionFragments = /旧潜水服|腰挂多种氧气瓶改装工具|靴底嵌着盐白色划痕|整洁的办公制服|胸前徽章闪烁|手持数据平板|蓝色长袍|面容如同少女|手中常握氧气结晶/;
const actorVerbs = state.characters.flatMap((character) => character.actionVerbs?.visible || []);
const verbsByName = Object.fromEntries(state.characters.map((character) => [character.name, (character.actionVerbs?.visible || []).join("、")]));

assert.ok(actorVerbs.length >= state.characters.length * 3, `generated characters should have playable visible verbs, got: ${actorVerbs.join("、")}`);
assert.doesNotMatch(
  actorVerbs.join("\n"),
  invalidActionFragments,
  `costume and prop descriptions should not be used as action verbs, got:\n${actorVerbs.join("\n")}`,
);
assert.match(verbsByName["莫尔"], /递暗号|藏起凭证|压低氧气罐|后退/, `diver-smuggler should get smuggling movement verbs, got: ${verbsByName["莫尔"]}`);
assert.match(verbsByName["绮拉"], /检查|打开记录|扣住凭证|追问/, `inspector should get inspection verbs, got: ${verbsByName["绮拉"]}`);
assert.match(verbsByName["伊芙"], /合掌|遮住凭证|低声祝祷|按住记录|拦住来人/, `saint should get sanctuary verbs, got: ${verbsByName["伊芙"]}`);
assert.notEqual(verbsByName["莫尔"], verbsByName["绮拉"], "different dramatic roles should not collapse into the same visible action verbs");
assert.notEqual(verbsByName["绮拉"], verbsByName["伊芙"], "inspector and saint should keep distinct visible action verbs");

state.ui.timeGrain = "scene";
state.ui.focusMode = "focused";
state.ui.activeTab = "observe";
state.ui.selectedLocationId = "loc_market";
state.ui.activeCharacterIds = ["char_diver", "char_inspector", "char_saint"];

const draft = playNext(state);
const text = [draft.surfaceEvent, draft.sceneText].join("\n");

assert.doesNotMatch(
  text,
  /旧潜水服到一半|腰挂多种氧气瓶改装工具到一半|靴底嵌着盐白色划痕到一半|整洁的办公制服到一半|胸前徽章闪烁到一半|手持数据平板到一半|蓝色长袍到一半|面容如同少女到一半|手中常握氧气结晶到一半/,
  `scene prose should not turn costume fragments into actions, got:\n${text}`,
);
assert.doesNotMatch(text, /妖丹盒/, `model-generated cyberpunk market should not inherit xianxia generic props, got:\n${text}`);
assert.match(text, /氧气计费手环|旧氧气罐|深海鱼皮包|氧气结晶/, `scene prose should use model-generated oxygen economy props, got:\n${text}`);
assert.match(
  text,
  /靠近|停住|询问|检查|递|扣住|压到|遮住|推到|拦住/,
  `scene prose should contain playable actions, got:\n${text}`,
);
assert.match(text, /说：“/, `scene prose should still include dialogue, got:\n${text}`);

console.log("modelSetupCostumeVisibleDoesNotBecomeAction:test passed", {
  verbs: actorVerbs,
  sample: text.slice(0, 500),
});
