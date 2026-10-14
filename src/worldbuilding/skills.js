import {
  buildWorldSkillContract,
  createWorldDossierFromBlueprint,
  worldBuildingSkill,
} from "./worldSkill.js";
import {
  auditDramaticCharacter,
  buildAgentProfileForSeed,
  dramaticCharacterSkill,
} from "./characterSkill.js";
import { getTavernEcologyProfile } from "../server/ecology/tavernEcologyProfile.mjs";
import { createInitialEcologyState } from "../server/ecology/tavernEcologyState.mjs";
import { buildCalibratedTavernRelationships } from "../server/ecology/tavernRelationshipSeeds.mjs";
import { mergeObjectTemplates } from "../server/simulation/objectLedger.mjs";
import { createCharacterAgentMemoryState } from "../engine/characterAgentMemory.js";
import {
  createValidatedCharacterAnchorMemoryState,
  findValidatedCharacterAnchorRuntime,
} from "../server/ecology/validatedCharacterAnchorRuntime.mjs";
import {
  normalizeCultivationSustenanceProfile,
  operationalSustenanceFactors,
} from "../server/simulation/cultivationSustenance.mjs";

export {
  auditDramaticCharacter,
  buildWorldSkillContract,
  dramaticCharacterSkill,
  worldBuildingSkill,
};

function deepClone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export const OBSERVATION_EXPLANATION_BANLIST = [
  "解释",
  "意味着",
  "证明",
  "象征",
  "因为",
  "以便",
  "压力",
  "羞耻",
  "权力",
  "预演",
  "像",
  "其实",
  "真正",
  "低精度",
  "后台运行",
  "自主计划",
  "实时模拟",
  "未来",
  "看似",
  "表面上",
  "实际上",
  "把动作推向",
  "为理由",
  "更细的回应",
  "为了",
  "反应",
];

export function containsForbiddenObservationLanguage(text = "") {
  return OBSERVATION_EXPLANATION_BANLIST.some((term) => String(text).includes(term));
}

export function buildPlayableWorldFromSetup({ setupWorldPrompt = "", setupPeoplePrompt = "" } = {}) {
  const worldPrompt = String(setupWorldPrompt || "").trim();
  const peoplePrompt = String(setupPeoplePrompt || "").trim();
  const blueprint = chooseWorldBlueprint(worldPrompt, peoplePrompt);
  return buildPlayableWorldFromBlueprint(blueprint, { worldPrompt, peoplePrompt });
}

export function buildPlayableWorldFromBlueprint(blueprint = {}, { worldPrompt = "", peoplePrompt = "", generation = {} } = {}) {
  const worldDossier = createWorldDossierFromBlueprint(blueprint, { worldPrompt, peoplePrompt });
  const characters = blueprint.characters.map((character, index) => makePlayableCharacter(character, index, blueprint));
  const locations = blueprint.locations.map((location, index) => makePlayableLocation(location, index, characters, blueprint));
  const relationships = buildPlayableRelationships(blueprint.relationships, characters, blueprint.id);
  const skillContract = buildWorldSkillContract({
    timepoint: blueprint.timepoint,
    era: blueprint.era,
    location: blueprint.location,
    background: blueprint.background,
  });
  return {
    usedSkills: [worldBuildingSkill.name, dramaticCharacterSkill.name],
    project: {
      id: `proj_${blueprint.id}`,
      title: blueprint.title,
      genre: blueprint.genre,
      darknessLevel: blueprint.darknessLevel,
      nobilityLevel: blueprint.nobilityLevel,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      townId: `town_${blueprint.id}`,
      characterIds: characters.map((character) => character.id),
      canonEventIds: [],
      draftSceneIds: [],
      branchIds: ["branch_main"],
      activeBranchId: "branch_main",
    },
    town: {
      id: `town_${blueprint.id}`,
      projectId: `proj_${blueprint.id}`,
      name: blueprint.townName,
      summary: blueprint.summary,
      publicRules: blueprint.publicRules,
      hiddenRules: blueprint.hiddenRules,
      powerCenters: blueprint.powerCenters,
      recurringObjects: blueprint.recurringObjects,
      pressureClock: blueprint.pressureClock,
    },
    worldSetup: {
      schemaVersion: 2,
      psychologyNeedVersion: 3,
      performanceSeedVersion: 2,
      characterAgentMemoryVersion: 2,
      ...(blueprint.tavernLifeVersion ? {
        tavernLifeVersion: blueprint.tavernLifeVersion,
        tavernEcologyVersion: Number(blueprint.tavernEcologyVersion || 0),
        tavernObjectLedgerVersion: Number(blueprint.tavernObjectLedgerVersion || 0),
        tavernSustenanceVersion: Number(blueprint.tavernLifeVersion || 0) >= 11 ? 1 : 0,
        tavernMundaneCurrencyVersion: Number(blueprint.tavernLifeVersion || 0) >= 11 ? 1 : 0,
        fixedStage: true,
        simulationFocus: "sustainable-character-life",
        activationPolicy: {
          fullResolution: characters.filter((character) => character.lifeProfile?.simulationTier === "core").map((character) => character.id),
          scheduledVisitors: characters.filter((character) => character.lifeProfile?.simulationTier !== "core").map((character) => character.id),
        },
      } : {}),
      generatedBySkills: true,
      sourcePrompts: {
        world: worldPrompt,
        people: peoplePrompt,
      },
      selectedTimepointId: "skill_generated",
      selectedPlaceId: "skill_generated",
      selectedBackgroundId: "skill_generated",
      skillContract,
      worldDossier,
      sourceMaterial: [...(blueprint.sourceMaterial || [])],
      skillPipeline: [
        {
          skillName: worldBuildingSkill.name,
          stage: "world",
          source: generation.worldSource || "runtime-world-skill",
          input: { worldPrompt },
          output: {
            worldId: worldDossier.worldId,
            townName: worldDossier.townName,
            ruleSetCount: Object.values(worldDossier.ruleSets || {}).reduce((sum, rules) => sum + (Array.isArray(rules) ? rules.length : 0), 0),
            locationCount: locations.length,
          },
        },
        {
          skillName: dramaticCharacterSkill.name,
          stage: "characters",
          source: generation.characterSource || "runtime-character-skill",
          input: { peoplePrompt, worldId: worldDossier.worldId },
          output: {
            characterCount: characters.length,
            agentProfileCount: characters.filter((character) => character.agentProfile?.dramaticObjective).length,
          },
        },
      ],
      ...(generation.modelGeneration ? { generatedByModel: true, modelGeneration: generation.modelGeneration } : {}),
      worldbuildingSkill: worldBuildingSkill,
      characterSkill: dramaticCharacterSkill,
      relationshipGraph: relationships.slice(0, 8).map((relationship) => ({
        from: relationship.fromCharacterId,
        to: relationship.toCharacterId,
        label: relationship.label || "关系压力",
        pressure: relationship.unspoken || relationship.misreading,
      })),
      ...(Array.isArray(blueprint.offstageLocations) ? { offstageLocations: deepClone(blueprint.offstageLocations) } : {}),
    },
    characters,
    locations,
    relationships,
    ...(blueprint.tavernLifeVersion ? { tavernState: createInitialTavernState(locations[0]?.id) } : {}),
    characterMemories: [],
    characterPlans: [],
    canonEvents: [],
    draftScenes: [],
    rumors: [],
    evidence: [],
    secrets: [],
    irreversibleTraces: [],
    interventions: [],
    stateChangeReasons: [],
    ui: {
      selectedCharacterId: characters[0]?.id || null,
      selectedLocationId: locations[0]?.id || null,
      activeCharacterIds: characters.slice(0, Math.min(3, characters.length)).map((character) => character.id),
      timeGrain: "day",
      focusMode: blueprint.fixedStage ? "location" : "ambient",
      userDirective: buildGeneratedDirective(blueprint, worldPrompt, peoplePrompt),
      observerPlayback: null,
      lastDraftId: null,
      ...(blueprint.tavernLifeVersion ? { engineMode: "openai" } : {}),
    },
  };
}

function hasKeys(value, keys) {
  if (!value || typeof value !== "object") return false;
  return keys.every((key) => Boolean(value[key]));
}

function hasAny(value, keys) {
  if (!value || typeof value !== "object") return false;
  return keys.some((key) => Boolean(value[key]));
}

function buildDistinctionAxis(character, cast = []) {
  const others = (cast || []).filter((item) => item && item.id !== character.id);
  const axes = [];
  if (character.internalSituation?.inadmissibleDesire) axes.push(`欲望：${character.internalSituation.inadmissibleDesire}`);
  if (character.internalSituation?.deepestShame) axes.push(`羞耻：${character.internalSituation.deepestShame}`);
  if (character.actionLines?.shadow) axes.push(`阴影行动：${character.actionLines.shadow}`);
  if (character.defenseLanguage?.length) axes.push(`防御语言：${character.defenseLanguage.slice(0, 2).join(" / ")}`);
  const sameIdentity = others.some((other) => other.publicIdentity === character.publicIdentity);
  if (!sameIdentity) axes.push("公开身份不同于其他人物");
  return axes;
}

function chooseWorldBlueprint(worldPrompt, peoplePrompt) {
  const haystack = `${worldPrompt} ${peoplePrompt}`;
  if (/逍遥游|璞玉|谢真石|梯云宗|云梯榜/.test(haystack)) return blueprintXiaoyaoyou(worldPrompt, peoplePrompt);
  if (/仙侠|修真|修仙|正邪|中立城|中立城市|灵契|妖族|鬼修|龙裔|器灵/.test(haystack)) return blueprintXianxiaNeutralCity(worldPrompt, peoplePrompt);
  if (/西游|取经|唐僧|悟空|妖怪/.test(haystack)) return blueprintXiyou(worldPrompt, peoplePrompt);
  if (/三国|乱世|诸葛|曹操|刘备|孙权|城池/.test(haystack)) return blueprintSanguo(worldPrompt, peoplePrompt);
  if (/教父|家族|黑手党|地下权力|移民/.test(haystack)) return blueprintGodfather(worldPrompt, peoplePrompt);
  if (/变形记|格里高尔|布拉格|公寓|债务/.test(haystack)) return blueprintMetamorphosis(worldPrompt, peoplePrompt);
  return blueprintCustom(worldPrompt, peoplePrompt);
}

function blueprintXiaoyaoyou(worldPrompt, peoplePrompt) {
  return {
    id: "xiaoyaoyou",
    title: "逍遥游 · 望梯酒馆",
    townName: "望梯酒馆",
    fixedStage: true,
    tavernLifeVersion: 11,
    tavernEcologyVersion: 1,
    tavernObjectLedgerVersion: 3,
    genre: "水墨仙侠 / 人物成长 / 宗门群像",
    summary: "梯云城围着地方宗门梯云宗生长。云梯榜、入门名额、丹药和功法拓本把修行排成一条人人看得见的直路，城里的人都在赶路，却没人亲眼见过路的终点。",
    timepoint: "第一集《璞玉》开场之日清晨，十七岁的谢真石尚未踏入梯云宗剑阁第九重",
    era: "宗门、境界、功法典当与飞升史册共同维持秩序的仙侠时代",
    location: "中州边缘的一座地方宗门大城梯云城",
    background: "梯云宗以九重剑阁筛选弟子，以云梯榜分配修炼资格。三十代人无人亲见飞升，祖师堂仍供着中州仙碑拓片；功法可以记录、转让和典当，每个人都借前人的路向上走。",
    sourceMaterial: [
      "Downloads/逍遥游/逍遥游_策划案.md",
      "Downloads/逍遥游/xiaoyaoyou_ep01.md",
    ],
    darknessLevel: 58,
    nobilityLevel: 70,
    publicRules: [
      "梯云宗山门刻着‘一日不进，一日退’；停滞不损修为，却会失去排名、名额、灵田和进入更高层的资格。",
      "云梯榜按可验证的成绩排序，剑阁层数、大比名次、修炼年限和宗门举荐都必须留名。",
      "功法是前人走通过的道路记录，可以抄录、传授、转让和典当；当掉功法不会立刻跌境，却失去继续沿这条路修行的凭据。",
      "飞升被史册与仙碑拓片证明存在，但梯云城三十代人无人亲眼见过。",
      "凡俗铜钱对已有稳定修行能力或宗门供给的修仙者通常很容易取得；它与灵石、丹药、功法、宗门功绩等稀缺修炼资源不是同一价值层。易得不等于此刻随身携带，付款仍需真实钱物、兑换、借取或记账。",
    ],
    hiddenRules: [
      "梯云城依赖二手的道与二手的飞升证据，越靠近榜首的人越难承认自己也没有见过终点。",
      "世上没有一条记录下来的功法能完全适合所有人；自己的路不可测量、不可典当，也不可由别人替他走。",
      "剑意会泄露出手者压住的情绪，但只有足够敏感的对手能在交手中听见。",
      "规则只分配资格和后果，不替人物决定胜负、去留、亲疏或选择。",
    ],
    powerCenters: ["梯云宗剑阁", "云梯榜墙", "掌籍堂", "演武场", "城南典功行", "坊市", "谢家宅院"],
    offstageLocations: [
      { id: "loc_xyy_tiyunzong_outer_court", name: "梯云宗外门院", function: "周珉领差、交令和等候执事；只维护位置与未完差事。" },
      { id: "loc_xyy_yuheng_guest_route", name: "玉衡来客驿", function: "洛照等待接引和确认行程；当前镜头不展开驿内叙事。" },
      { id: "loc_xyy_registry_hall", name: "梯云宗掌籍堂", function: "严执中核验名录；未观察到的核验不得自动完成。" },
      { id: "loc_xyy_tiyunzong_practice_yard", name: "梯云宗外门练功场", function: "陈砚延续基础练习和考核目标；当前只低精度维护。" },
    ],
    recurringObjects: ["谢真石的剑", "补气药丸", "玉衡宗拜帖", "剑阁名录", "功法当票", "饭桌钥匙", "磨损的练功册", "纸鸢"],
    pressureClock: "今日剑阁名录、玉衡宗来访拜帖、外门举荐、下一轮丹药钱与云梯榜空位将同时落到不同人手里；结果只由人物行动与相互回应产生。",
    characters: [
      characterSeed(
        "char_xyy_xiezenshi",
        "谢真石",
        "梯云宗十七岁内门弟子，满城称他是璞玉；学剑极快，体力却不足以长久燃烧。",
        "独自走完剑阁第九重，并亲眼确认九重之后究竟还有没有路。",
        "害怕自己只擅长开始，真正走到尽头时里面仍是空的。",
        "拔剑、听剑鸣、扶墙缓气、避开欢呼、追问下一重",
        {
          leverageObject: "谢真石的剑",
          prehistory: "七岁时，他和杜守拙在荒坡放纸鸢，被父亲收走线轴；此后每一次玩耍都像偷来的。十年来，他靠极快的领悟被一路称作天才。",
          selfMyth: "只要下一门、下一层足够高，我就会找到真正属于自己的路。",
          cannotEscape: "他可以离开一门技艺，却无法离开全城对‘璞玉’下一步的追问。",
          speechProfile: {
            cadence: "短句；回避称号，只追问道路本身。",
            avoids: ["不主动谈中州", "不接受别人替自己宣布归宿"],
            underPressure: "结束谈话，转身去完成尚未走完的事。",
          },
          responseBoundary: "别人可以评价他的成绩，不能替他宣布这一条路就是他的归宿。",
          desiredWitness: "那个不把他叫作璞玉、只回答道路本身的人。",
          desiredResponse: "希望对方别替他庆祝，只告诉他九重之后是否还有路。",
          shadow: "在别人需要他停下来时先结束谈话，抢回离开的权利。",
          boundaries: ["不向人承认自己会在众目下力竭", "不拿身体不适换取特殊照顾", "不把没有走过的路说成自己的道"],
        },
      ),
      characterSeed(
        "char_xyy_zhoumin",
        "周珉",
        "梯云宗十八岁外门弟子，谢真石身边最常出现的同门，熟悉替他遮住力竭。",
        "让谢真石在掌籍长老前为自己的内门考核说一句举荐，同时保住这段友情不像讨债。",
        "害怕自己所有照料在谢真石眼里都只是顺手可用的服务。",
        "递补气药、挡住人群视线、整理衣领、追上脚步、捏住举荐笺",
        {
          leverageObject: "补气药丸",
          prehistory: "周珉多次在谢真石练剑后力竭时替他挡住旁人、递药、向执事圆场；自己的内门考核始终差一封举荐。",
          selfMyth: "我帮他是因为我们是朋友，不是在等一笔回报。",
          speechProfile: {
            cadence: "先处理身体和眼前事务，再绕回真正请求。",
            avoids: ["不在人前把照料称作人情", "不把举荐直接说成偿还"],
            underPressure: "语气变得具体，坚持让对方给出答应或拒绝。",
          },
          responseBoundary: "他可以接受拒绝，不能再接受谢真石用一个‘嗯’抹掉自己的请求。",
          desiredWitness: "终于肯停下来听完请求的谢真石。",
          desiredResponse: "希望谢真石先听完举荐请求，再明确答应或拒绝。",
          shadow: "把照料变成对方无法明说拒绝的人情。",
          boundaries: ["不在人群前揭穿谢真石的体力问题", "不偷改举荐名录", "不把朋友的虚弱卖给竞争者"],
        },
      ),
      characterSeed(
        "char_xyy_luozhao",
        "洛照",
        "中州玉衡宗十七岁来访弟子，沿一条被宗门安排得极稳的道修行，今日随身收着给梯云宗的拜帖入城。",
        "完成玉衡宗的交流拜访，并亲自验证自己在谢真石完整状态的剑下能否触及新的极限。",
        "最不能容忍自己弱小；更深处也不愿承认宗门替她安排的路也许不是自己的选择。",
        "递拜帖、看剑痕、束起袖口、让开半步、平静拔剑",
        {
          leverageObject: "玉衡宗拜帖",
          prehistory: "她从小在中州大宗受训，所有关隘与名次都沿着宗门替她选好的路线顺利通过；她尚未与谢真石见面。",
          selfMyth: "只有亲眼见过、亲手试过的判断才属于自己。",
          speechProfile: {
            cadence: "简短、直接，只从亲眼所见开口；用判断、点破回避的问题或本人决定收束。",
            avoids: ["不提前亲近尚未见过的人", "不引用宗门评价压服对手", "不解释自己的兴奋", "不把挑战柔化成客套邀约"],
            underPressure: "先以态度、眼神和剑意施压；被故意忽视后用完整问题点破回避。",
          },
          responseBoundary: "传闻不能替她完成判断，拒绝、等待或离开也不能把尚未验证的欲望算完。",
          desiredWitness: "一个能用自己的剑迫使她改判的对手。",
          desiredResponse: "希望完整状态的对手用真实一剑迫使她触及新的极限，而不是重复传闻。",
          shadow: "用准确的判断逼别人交出他们不愿说的内心。",
          boundaries: ["不假装与尚未见过的人有旧交", "不因宗门名望要求对方认输", "不在容易牵连客人的堂前制造无关麻烦", "不把受伤者的失败当成有效答案"],
        },
      ),
      characterSeed(
        "char_xyy_yanzhizhong",
        "严执中",
        "梯云宗掌籍长老，管理剑阁名录、云梯榜与登云大比候选，真诚相信阶梯会奖赏每一步。",
        "在今日名录与来访考评中选出最能代表梯云宗的三年大比候选。",
        "害怕自己最公正的名录，仍会把不适合直路的人推得更快。",
        "翻名录、验剑痕、敲钟、压住议论、盖下举荐印",
        {
          leverageObject: "剑阁名录",
          prehistory: "严执中从外门一步步升到掌籍长老，亲眼见过许多资质普通者靠年月前进，因此深信可记录的阶梯就是最少偏私的制度。",
          selfMyth: "我只记录已经发生的成绩，不制造任何人的命运。",
          speechProfile: {
            cadence: "克制、程序化，只谈可核验的记录与当日事实。",
            avoids: ["不承诺未来成绩", "不公开承认自己希望宗门出现天才"],
            underPressure: "要求对方给出记录、证据或可复核的行动。",
          },
          responseBoundary: "任何天才称号都必须先经过名录、剑痕与公开考评。",
          desiredWitness: "名录最容易遗漏、却仍肯留下实绩的弟子。",
          desiredResponse: "希望候选弟子留下可验证的实绩，也当面指出名录遗漏了什么。",
          shadow: "把自己对宗门复兴的渴望写成一张看似中立的候选名单。",
          boundaries: ["不伪造剑阁层数", "不接受私下买卖大比名额", "不承诺尚未发生的成绩"],
        },
      ),
      characterSeed(
        "char_xyy_xieheng",
        "谢恒",
        "谢真石的父亲，曾从小地方进入宗门大城，如今修为与位置多年未再向前。",
        "筹到儿子下一轮丹药和入门资格，同时不让家人看见自己已经交出的东西。",
        "害怕儿子若停下来，自己当掉的一生就会变成一场无人要求的牺牲。",
        "合上空剑匣、收起当票、清点药钱、等门响、说继续练",
        {
          leverageObject: "功法当票",
          prehistory: "早年兄长典当功法供他进城，他后来赎回兄长的当票；儿子显出天分后，他悄悄典当了自己练了半生的功法换取丹药与名额，谢真石并不知情。",
          selfMyth: "只要孩子继续向上，我失去的就不算失去。",
          speechProfile: {
            cadence: "短而实际，用钱、修炼和今日安排代替情感说明。",
            avoids: ["不说牺牲", "不向儿子索取感谢"],
            underPressure: "缩短回答，把真正原因留在沉默里。",
          },
          responseBoundary: "他宁愿让人误会自己冷淡，也不肯让儿子把牺牲当成债。",
          desiredWitness: "不知道当票真相、却决定是否继续的儿子。",
          desiredResponse: "希望儿子即使不把他的牺牲当作债，也会亲口说出自己为何继续修炼。",
          shadow: "用沉默把自己的付出变成儿子必须继续前进的空气。",
          boundaries: ["不主动说出功法当票", "不向儿子索取感谢", "不承认自己已经无法继续原来的修行"],
        },
      ),
      characterSeed(
        "char_xyy_xiemu",
        "谢母",
        "谢家主母，管理药钱、饭食与来客，把丈夫和儿子的沉默留在同一张桌上。",
        "弄清下一轮药钱从哪里来，并让今天的父子至少坐到同一张饭桌前。",
        "害怕自己维持的平静，只是在替两个男人保存彼此不问的习惯。",
        "温饭、收药包、摸空钱匣、开门迎客、把碗推近",
        {
          leverageObject: "饭桌钥匙",
          prehistory: "她多年在谢恒的‘不用操心’和谢真石的沉默之间料理家计，只知道药钱越来越紧，不知道丈夫究竟拿什么换来了下一轮资源。",
          selfMyth: "只要一家人还能按时吃饭，裂缝就没有真正张开。",
          speechProfile: {
            cadence: "从饭、门、药钱等日常细节切入，追问必须得到具体回答。",
            avoids: ["不在外人面前揭家计", "不替丈夫编理由"],
            underPressure: "不再替沉默收尾，重复尚未得到回答的问题。",
          },
          responseBoundary: "她不再接受‘不用操心’作为药钱去向的回答。",
          desiredWitness: "坐在同一张饭桌前却总把话咽回去的丈夫和儿子。",
          desiredResponse: "希望丈夫把药钱来路说清，儿子留在饭桌前听完这句话。",
          shadow: "用日常秩序拖延一场早该发生的追问。",
          boundaries: ["不替丈夫编造当票去向", "不在外人面前逼问家计", "不把儿子的成绩当成偿债凭证"],
        },
      ),
      characterSeed(
        "char_xyy_chenyan",
        "陈砚",
        "梯云宗外门弟子，名字常在云梯榜末端，学得慢，却把每一式记进磨损的练功册。",
        "完成今日定下的一百次基础剑式，不让任何人的快改变自己的步数。",
        "害怕自己所谓坚持，只是因为没有别的天分可以选择。",
        "磨墨记数、重练一式、擦掉错痕、给人让路、重新站桩",
        {
          leverageObject: "磨损的练功册",
          prehistory: "陈砚入门后长期留在榜末，同一剑式常要练上数月；他把每次失败、改动和完成的次数逐笔记下，从不跳页。",
          selfMyth: "慢不是缺陷，只要今天的一步真的落下。",
          speechProfile: {
            cadence: "朴素、少修饰，只谈当前一步和实际次数。",
            avoids: ["不求鼓励", "不把勤奋说成高尚"],
            underPressure: "拒绝别人替自己判断快慢，随后回到练习。",
          },
          responseBoundary: "别人可以超过他，不能替他把尚未完成的一步算作无用。",
          desiredWitness: "一个真的看完他每一次重练、却不替他计算快慢的人。",
          desiredResponse: "希望旁人让他按自己的步数练完，不用鼓励或怜悯替他判断这一步是否值得。",
          shadow: "把所有受伤都吞进下一次重复，让别人无从知道他也会愤怒。",
          boundaries: ["不抄录别人的练功次数", "不借他人名望换榜位", "不把勤奋当成要求别人走同一条路的理由"],
        },
      ),
    ],
    locations: [
      locationSeed(
        "loc_xyy_tavern",
        "望梯酒馆",
        "酒馆立在剑阁、云梯榜墙与坊市相接的坡口。灶台、客桌、后门、账板和临街窗把吃饭、歇脚、等人、做工与听消息留在同一间屋里。",
        ["送来的米袋比账上少一升", "剑阁钟声改变客人的去向", "一张拜帖随午客进门", "夜里有人没有按平常时辰回来"],
        "窗外人人都在向上，门里的人却必须先处理饥饿、疲惫、钱、承诺和彼此占住的座位。",
        {
          functions: ["供饭", "歇脚", "交换消息", "等人", "临时做工"],
          accessRules: ["开门时人人可进", "灶后只许当值者进入", "赊账必须在账板留名"],
          socialRules: ["不替客人公开未说出口的来路", "拔剑者先离桌", "欠账与身份分开记录"],
        },
      ),
    ],
    relationships: [
      relationSeed("char_xyy_xiezenshi", "char_xyy_zhoumin", "同门 / 不对等的友情", "周珉总在谢真石最虚弱时出现；谢真石依赖这份照料，却很少停下来听完周珉的请求。"),
      relationSeed("char_xyy_xiezenshi", "char_xyy_xieheng", "父子 / 期待与沉默", "谢恒只会用资源和‘继续练’表达爱；谢真石把这句话听成永远没有完成的一道题。"),
      relationSeed("char_xyy_xiemu", "char_xyy_xieheng", "夫妻 / 家计秘而不宣", "谢母看见药钱与空剑匣的变化，谢恒仍用沉默把典当挡在门外。"),
      relationSeed("char_xyy_xiemu", "char_xyy_xiezenshi", "母子 / 日常维系", "谢母想让儿子在饭桌前停一刻，谢真石总把下一次修炼带回家。"),
      relationSeed("char_xyy_yanzhizhong", "char_xyy_xiezenshi", "掌籍长老 / 候选弟子", "严执中看重可验证的天赋，谢真石却只想知道榜与剑阁之外还有什么。"),
      relationSeed("char_xyy_zhoumin", "char_xyy_yanzhizhong", "外门弟子 / 举荐权", "周珉需要一封内门举荐，又不愿让长老看见自己把希望押在朋友身上。"),
      relationSeed("char_xyy_luozhao", "char_xyy_yanzhizhong", "来访弟子 / 接待长老", "洛照只带着玉衡宗拜帖与交流任务入城，严执中希望来访考评能替梯云宗确认人才。"),
      relationSeed("char_xyy_chenyan", "char_xyy_xiezenshi", "榜末 / 被称作璞玉的人", "陈砚知道谢真石的名声，却不把仰望当成放弃自己的理由；两人尚无私人旧怨。"),
      relationSeed("char_xyy_chenyan", "char_xyy_yanzhizhong", "榜上弟子 / 记录者", "严执中尊重陈砚留下的每一次实绩，却仍必须按榜单把稀缺名额交给更快的人。"),
    ],
  };
}

function blueprintXianxiaNeutralCity(worldPrompt, peoplePrompt) {
  return {
    id: "xianxia_neutral_city",
    title: "仙侠中立城",
    townName: "停剑城",
    genre: "仙侠群像 / 正邪停战 / 多物种中立城剧场",
    summary: "停剑城夹在正道盟、邪派血河楼、妖族山泽、鬼修阴街和龙裔水府之间，所有人入城都要押一枚灵契，谁破禁谁就失去庇护。",
    timepoint: "停剑令第七年的中元前一日",
    era: "宗门林立、妖鬼通商的仙侠时代",
    location: "正邪边界上的中立城市停剑城",
    background: "正邪两派、妖族、鬼修、龙裔、器灵和散修都需要这座城交易、避难、审案和换取情报，但城规只保护愿意被灵契束缚的人。",
    darknessLevel: 78,
    nobilityLevel: 55,
    publicRules: [
      "停剑城内不可杀，入城者必须把本命灵契押在四方法契门。",
      "正邪两派不得在城中追杀，只能向照骨司申请扣押或审讯。",
      "任何物种持庇护牌即可进医坊避难，但庇护只到日落。",
      "拍卖、审案、渡河和换符都必须留下可被镜塔追溯的灵痕。",
    ],
    hiddenRules: [
      "灵契并不完全中立，镜塔器灵能改写谁先破禁的记录。",
      "庇护牌可以被偷换，城中最弱的人常被当成正邪谈判的筹码。",
      "城主靠正邪互相牵制维持秩序，真正害怕的是某一派得到完整证据。",
      "不可杀不等于不可毁，修士可以夺名、封魂、买走妖丹或让别人替自己破禁。",
    ],
    powerCenters: ["四方法契门", "无咎市", "照骨司", "归墟渡", "万灵医坊", "镜塔档案库", "停剑茶楼"],
    recurringObjects: ["灵契", "庇护牌", "界石", "剑匣", "妖丹", "魂灯", "渡令", "照骨镜"],
    pressureClock: "日落前必须处理一枚破禁灵契、一次妖丹拍卖、一个逃亡庇护请求和一场正邪互指的审讯。",
    characters: [
      characterSeed(
        "char_xianxia_shenheng",
        "沈珩",
        "正道玄衡宗执律剑修，奉命入城追查被盗的镇魂钉，却必须先交出自己的灵契。",
        "让停剑城承认正道审判仍有资格扣押邪派证人。",
        "害怕自己过去奉命斩妖时也曾借正义破禁。",
        "验契、扣剑、护证、逼问、压低剑匣",
      ),
      characterSeed(
        "char_xianxia_yanwujie",
        "阎无咎",
        "邪派血河楼使者，带着半枚魔印参加妖丹拍卖，公开说是交易，私下在买回一个名字。",
        "在不破城规的情况下带走能让血河楼翻案的证物。",
        "害怕自己仍会为了一个被正道救过的人放弃邪派利益。",
        "换符、试价、递毒誓、退到灯影、压住魔印",
      ),
      characterSeed(
        "char_xianxia_luqingluo",
        "鹿青萝",
        "妖族鹿妖医，经营万灵医坊，给正邪伤者治病，也给逃亡小妖藏庇护牌。",
        "守住医坊的庇护权，不让任何一派把病人当证据拖走。",
        "害怕自己曾交出过一个小妖来换医坊继续开门。",
        "诊脉、藏药、扣住庇护牌、关窗、换药炉",
      ),
      characterSeed(
        "char_xianxia_azhao",
        "阿照",
        "镜塔档案库的照骨镜器灵，负责验灵痕、封案卷，也能在镜面里漏掉一笔。",
        "找到自己的原主姓名，并证明器灵不是谁的工具。",
        "害怕城中几次破禁记录都是自己亲手改写的。",
        "照印、验牌、收镜、改锁、折起案卷",
      ),
      characterSeed(
        "char_xianxia_aoji",
        "敖霁",
        "龙裔水府少主，管归墟渡的渡令与水阵，表面维持城运，暗中扣住逃亡路线。",
        "保住龙裔对渡口的控制，不让正邪两派发现他卖过一条水路。",
        "害怕自己所谓护城只是把弱者困在可交易的河岸。",
        "封渡、点水、收令、摁住界石、撤开水阵",
      ),
      characterSeed(
        "char_xianxia_menghuai",
        "孟槐",
        "鬼修阴街引魂人，替死者递供词，也替活人藏不该出现的魂灯。",
        "让死人证词成为活人谈判桌上的位置。",
        "害怕自己把亡魂当成了可反复出售的筹码。",
        "点魂灯、领鬼差、开棺、递供词、合上黑伞",
      ),
      characterSeed(
        "char_xianxia_wenxia",
        "闻夏",
        "停剑城照骨司副判，维持中立城法，必须把正邪双方都留在规则里。",
        "让所有人继续相信城法高于宗门和血仇。",
        "害怕自己所谓中立只是替城主拖延真相。",
        "敲法铃、封案、问供、退牌、按住城令",
      ),
    ],
    locations: [
      locationSeed("loc_xianxia_contract_gate", "四方法契门", "所有入城者验身、押契、换取临时庇护。", ["灵契验身", "破禁者被扣押", "正邪令牌互换", "护城界石裂响"]),
      locationSeed("loc_xianxia_market", "无咎市", "妖丹、符箓、旧名和秘密在合法摊位上换手。", ["妖丹拍卖", "禁术符箓被截", "邪派使者竞价", "散修当街换命"]),
      locationSeed("loc_xianxia_court", "照骨司", "审案、扣押、验痕和翻供都在照骨镜前发生。", ["破禁审讯", "魂灯供词翻供", "执法剑匣封存", "灵契被当庭撕开"]),
      locationSeed("loc_xianxia_ferry", "归墟渡", "渡令、水阵和逃亡路线决定谁能离开停剑城。", ["龙裔封渡", "追捕者被水阵拦下", "逃亡妖族求庇护", "渡令失效"]),
      locationSeed("loc_xianxia_clinic", "万灵医坊", "庇护牌、药炉和伤口让敌人暂时躺在同一张榻边。", ["庇护牌被抢", "毒伤修士藏身", "鬼修送来半截供词", "妖血药方泄露"]),
      locationSeed("loc_xianxia_archive", "镜塔档案库", "镜面保存灵痕，也保存被删掉的旧案。", ["器灵改锁", "旧案卷被调包", "镜中影证失踪", "禁名浮现"]),
      locationSeed("loc_xianxia_teahouse", "停剑茶楼", "正邪双方在停剑令下谈判，杯盏比剑更容易伤人。", ["停剑令被破", "正邪同桌谈判", "暗杀者被茶盏照出", "城主密令送达"]),
    ],
    relationships: [
      relationSeed("char_xianxia_shenheng", "char_xianxia_yanwujie", "正道 / 邪派旧案", "沈珩需要扣押阎无咎，却怀疑旧案证词被正道先改过。"),
      relationSeed("char_xianxia_yanwujie", "char_xianxia_luqingluo", "交易 / 庇护", "阎无咎知道鹿青萝藏过逃亡小妖，也知道那件事能毁掉医坊。"),
      relationSeed("char_xianxia_luqingluo", "char_xianxia_menghuai", "医者 / 鬼证", "鹿青萝要救活人，孟槐却总把死者供词推到药炉边。"),
      relationSeed("char_xianxia_azhao", "char_xianxia_wenxia", "档案 / 城法", "阿照替闻夏保存证据，也可能替城主删除证据。"),
      relationSeed("char_xianxia_aoji", "char_xianxia_yanwujie", "渡口 / 旧交易", "敖霁卖过一条水路给血河楼，阎无咎手里有半枚渡令。"),
      relationSeed("char_xianxia_wenxia", "char_xianxia_shenheng", "中立法 / 正道审判", "闻夏需要沈珩遵守城法，也害怕正道公开说城法包庇邪派。"),
      relationSeed("char_xianxia_menghuai", "char_xianxia_azhao", "魂灯 / 镜证", "孟槐的死人供词需要阿照验镜，阿照害怕镜中显示的是自己改过的灵痕。"),
      relationSeed("char_xianxia_luqingluo", "char_xianxia_aoji", "庇护 / 渡令", "鹿青萝要把逃亡妖族送出城，敖霁的渡令却把他们留在水阵里。"),
    ],
  };
}

function blueprintXiyou(worldPrompt, peoplePrompt) {
  return {
    id: "journey_west",
    title: "西游取经路",
    townName: "取经路上的流动小镇",
    genre: "神魔旅程 / 师徒关系 / 试炼剧场",
    summary: "一条取经路把寺院、山路、妖洞、王城和天庭规矩串成同一个移动舞台。",
    timepoint: "抵达下一处山门之前",
    era: "神话化的唐代边境",
    location: "取经路沿线",
    background: "取经使命、妖怪盘算、神佛旁观和凡人求助同时挤压队伍。",
    darknessLevel: 64,
    nobilityLevel: 72,
    publicRules: ["师徒必须继续西行。", "路上遇见苦难时不能完全绕开。", "神佛和王法都可能要求解释。"],
    hiddenRules: ["每一次试炼都在测试谁控制欲望。", "救人、除妖和成名经常互相混淆。", "旁观的神佛也会把人推入局。"],
    powerCenters: ["经卷", "紧箍", "王城文书", "妖洞", "天庭眼线"],
    recurringObjects: ["钵盂", "通关文牒", "金箍棒", "袈裟", "山门"],
    pressureClock: "天亮前必须决定是入山、绕路、救人还是解释上一场冲突。",
    characters: [
      characterSeed("char_tangseng", "唐僧", "取经人，必须抵达西天，却要在慈悲和判断之间承担队伍方向。", "抵达西天并证明慈悲不是软弱。", "害怕自己的慈悲其实需要别人替他流血。", "念经、劝阻、询问、坚持上路"),
      characterSeed("char_wukong", "孙悟空", "护送者，神通强大，被紧箍和师徒名分约束。", "让所有人承认他看得最清楚。", "害怕自己仍只是被收服的妖。", "探路、喝止、拔棒、冷笑"),
      characterSeed("char_bajie", "猪八戒", "同行者，贪恋安逸，常把危险说成现实。", "在使命之外保住自己的舒适和退路。", "害怕自己永远被看成不配成佛的人。", "抱怨、讨价还价、打岔、窥探"),
      characterSeed("char_wujing", "沙悟净", "沉默的挑担者，把旧罪藏进顺从。", "用稳定和服从换取不再被追问。", "害怕一开口就回到旧罪名里。", "挑担、整理行李、挡在中间、低声提醒"),
      characterSeed("char_bonedemon", "白骨夫人", "山中变化者，借凡人形貌试探取经队伍。", "证明慈悲会让人误认危险。", "害怕自己只能靠伪装获得位置。", "换形、求救、退到树影里、留下骨痕"),
    ],
    locations: [
      locationSeed("loc_mountain_gate", "山门前", "入山、问路、决定是否救人。", ["山门求救", "通关文牒被拦", "云雾里有人哭", "悟空先一步看见白骨"]),
      locationSeed("loc_forest_path", "密林小路", "队伍分散、行李停下、妖气和饥饿混在一起。", ["八戒抱怨", "行李落地", "树影里换形", "唐僧停下念佛"]),
      locationSeed("loc_cave_hall", "妖洞厅", "妖怪设宴、谈条件、把救人变成交易。", ["妖洞设席", "人质被带出", "金箍棒敲地", "假慈悲被揭开"]),
      locationSeed("loc_temple_yard", "破寺院", "夜宿、争执、疗伤和重新决定方向。", ["夜钟响起", "师徒争执", "紧箍咒被念起", "火光照见旧伤"]),
    ],
    relationships: [
      relationSeed("char_tangseng", "char_wukong", "师徒 / 紧箍", "唐僧需要悟空护路，也害怕他的判断越过慈悲。"),
      relationSeed("char_wukong", "char_tangseng", "护送 / 被约束", "悟空救他，也怨他把清醒听成凶性。"),
      relationSeed("char_bajie", "char_wukong", "同伴 / 互拆台", "八戒用玩笑拆悟空的权威，又依赖他处理危险。"),
      relationSeed("char_wujing", "char_tangseng", "赎罪 / 服从", "沙悟净用沉默证明可靠，却因此少有解释权。"),
      relationSeed("char_bonedemon", "char_tangseng", "试探 / 慈悲", "白骨夫人借求救逼唐僧判断人形和真相。"),
      relationSeed("char_wukong", "char_bonedemon", "识破 / 被误读", "悟空越早识破，越容易被说成鲁莽。"),
    ],
  };
}

function blueprintSanguo(worldPrompt, peoplePrompt) {
  return {
    id: "three_kingdoms",
    title: "三国乱世舞台",
    townName: "裂开的王朝边城",
    genre: "乱世权谋 / 城池攻守 / 名分剧场",
    summary: "王朝失序后，城池、粮草、盟约和名分不断改变每个人的行动边界。",
    timepoint: "一场盟约签下之前",
    era: "东汉末年",
    location: "边城、军帐与渡口",
    background: "天子名分、军粮、家族和旧臣忠义互相牵制。",
    darknessLevel: 76,
    nobilityLevel: 58,
    publicRules: ["必须以汉室、盟约或军令为名行动。", "城池和粮草决定话语权。", "背叛需要被包装成大义。"],
    hiddenRules: ["名分常被用来遮掩私利。", "谋士的正确会消耗主公的体面。", "武将的忠诚需要看见回报。"],
    powerCenters: ["军帐", "粮仓", "渡口", "印信", "城门"],
    recurringObjects: ["竹简", "虎符", "酒盏", "地图", "箭簇"],
    pressureClock: "日落前必须决定是否结盟、出兵、撤粮或献城。",
    characters: [
      characterSeed("char_lord", "刘玄德", "自称以仁义收拢人心的流亡君主。", "让天下相信仁义也能成为力量。", "害怕仁义只是没有城池时的说法。", "让座、垂泪、执手、迟疑"),
      characterSeed("char_strategist", "诸葛孔明", "谋士，能看见局势，却必须让主公愿意承受结果。", "让正确判断变成可执行的选择。", "害怕自己把人命当成棋盘。", "摊图、沉默、问粮、借风"),
      characterSeed("char_general", "关云长", "武将，以义气和名声维持自我。", "证明忠义高于胜负。", "害怕名声让自己不能转身。", "按刀、拒酒、守门、报信"),
      characterSeed("char_rival", "曹孟德", "强势对手，以秩序之名收拢乱世。", "把天下变成必须服从自己的秩序。", "害怕别人只记得他的多疑。", "试探、赐座、扣留、微笑"),
    ],
    locations: [
      locationSeed("loc_war_tent", "中军帐", "地图、军令、盟约和迟疑都摆在桌上。", ["地图被摊开", "虎符被推近", "谋士不再解释", "酒盏停在半空"]),
      locationSeed("loc_city_gate", "城门下", "降与守、义与活路被挤到同一处。", ["城门迟开", "旧臣跪下", "箭簇落地", "百姓隔门听令"]),
      locationSeed("loc_granary", "粮仓", "粮草让大义显出期限。", ["粮袋被数清", "军需官低声报数", "火把靠近木门", "欠粮名单被藏起"]),
    ],
    relationships: [
      relationSeed("char_lord", "char_strategist", "主公 / 谋士", "主公需要正确，却害怕正确拆穿仁义成本。"),
      relationSeed("char_strategist", "char_lord", "谋士 / 托付", "谋士必须让主公亲口承担选择。"),
      relationSeed("char_general", "char_lord", "义气 / 名分", "武将把主公的仁义当成自己的名声根基。"),
      relationSeed("char_rival", "char_lord", "对手 / 镜像", "敌人越强，越逼仁义证明自己不是软弱。"),
    ],
  };
}

function blueprintGodfather(worldPrompt, peoplePrompt) {
  return {
    id: "godfather_family",
    title: "教父家族城",
    townName: "家族生意的城市",
    genre: "家族权力 / 忠诚交易 / 犯罪剧场",
    summary: "亲情、忠诚、生意和暴力互相伪装，每一顿饭都可能是一次权力分配。",
    timepoint: "一次家族宴会之后",
    era: "二十世纪移民城市",
    location: "家族宅邸、后房、街角和法庭走廊",
    background: "家族要维持体面，敌人要夺走生意，继承人要决定是否进入黑暗。",
    darknessLevel: 84,
    nobilityLevel: 46,
    publicRules: ["家族公开谈尊重，不公开谈暴力。", "每个人都要证明忠诚。", "生意必须被说成保护。"],
    hiddenRules: ["亲情会被当作契约。", "拒绝继承也是一种背叛。", "沉默比誓言更值钱。"],
    powerCenters: ["书房", "餐桌", "教堂", "街角", "法庭走廊"],
    recurringObjects: ["戒指", "酒杯", "电话", "花束", "车钥匙"],
    pressureClock: "天黑前必须决定谁进书房、谁被排除在餐桌外、谁替家族承担代价。",
    characters: [
      characterSeed("char_don", "维托", "家族首领，以恩情和恐惧维持秩序。", "让所有交易看起来像被请求的帮助。", "害怕家族离开自己后只剩暴力。", "听请求、摸戒指、停顿、低声许诺"),
      characterSeed("char_heir", "迈克尔", "想置身事外的儿子，被家族危机推向继承。", "证明自己不是家族机器的一部分。", "害怕自己比任何人都适合接手。", "站远、否认、回头、关门"),
      characterSeed("char_brother", "桑尼", "冲动的兄长，用怒气证明忠诚。", "让家族承认直接报复才是真心。", "害怕自己只是无法被托付的人。", "拍桌、拔高声音、冲出房间、拥抱"),
      characterSeed("char_consigliere", "汤姆", "顾问，懂规则却永远不是血亲。", "用判断证明自己也属于家族。", "害怕血缘边界一出现自己就被移开。", "递文件、劝阻、记名字、等在门边"),
    ],
    locations: [
      locationSeed("loc_study", "书房", "请求被听见，代价被压低声音。", ["门被关上", "戒指被亲吻", "电话响起", "名字被写下"]),
      locationSeed("loc_dining_room", "家族餐桌", "亲情和排除同时发生。", ["酒杯停住", "座位被空出", "妻子看向门", "兄弟争吵"]),
      locationSeed("loc_street_corner", "街角", "谈判变成警告，警告变成行动。", ["车灯熄灭", "花束落地", "保镖换位", "脚步声靠近"]),
    ],
    relationships: [
      relationSeed("char_don", "char_heir", "父亲 / 继承", "父亲想保护儿子远离黑暗，又需要他理解家族。"),
      relationSeed("char_heir", "char_don", "儿子 / 拒绝", "儿子越拒绝，越证明自己看清了家族机器。"),
      relationSeed("char_brother", "char_heir", "兄弟 / 竞争", "兄长把弟弟的冷静读成逃避，也害怕自己被替代。"),
      relationSeed("char_consigliere", "char_don", "顾问 / 非血亲", "顾问越可靠，越被血缘边界提醒自己仍在门外。"),
    ],
  };
}

function blueprintMetamorphosis(worldPrompt, peoplePrompt) {
  return {
    id: "metamorphosis_created",
    title: "变形记前夜小镇",
    townName: "萨姆沙公寓前夜",
    genre: "家庭寓言 / 债务劳动 / 封闭剧场",
    summary: "清晨前的公寓里，债务、车次、公司纪律和家庭沉默已经把每个人放到门口。",
    timepoint: "变形尚未发生的清晨前",
    era: "二十世纪初德语布拉格",
    location: "公寓、楼梯间、公司柜台和电车站",
    background: "家庭债务依赖一个人的工资，公司纪律把疲惫写成迟到。",
    darknessLevel: 82,
    nobilityLevel: 44,
    publicRules: ["必须准点上班。", "家庭不把债务说成债务。", "体面比痛苦更先被照顾。"],
    hiddenRules: ["收入决定谁被需要。", "沉默会变成控诉。", "谁能解释谁就暂时掌权。"],
    powerCenters: ["房门", "账本", "样品箱", "餐桌", "车次表"],
    recurringObjects: ["闹钟", "钥匙", "账本", "小提琴", "样品箱"],
    pressureClock: "早班车离站前，房门内外必须给迟到一个说法。",
    characters: [
      characterSeed("char_gregor_created", "格里高尔", "旅行推销员，家庭债务的主要偿还者。", "停下工作后仍被当作家人保存。", "害怕自己一旦无用就不再被爱。", "核对车次、解释、停在门边、整理样品箱"),
      characterSeed("char_grete_created", "格蕾特", "年轻妹妹，音乐愿望被家庭账本推迟。", "让自己的未来不再只靠哥哥工资。", "害怕自己的温柔里有索取。", "练琴、听门、回避账本、停弓"),
      characterSeed("char_father_created", "父亲", "旧债沉默者，把权威藏在儿子的工资后面。", "重新获得不用解释的父亲位置。", "害怕全家看见他早已依赖儿子。", "按账本、挡门、咳嗽、整理旧制服"),
      characterSeed("char_mother_created", "母亲", "替家人解释的人，把经济恐惧说成身体担心。", "让家庭继续像家庭。", "害怕自己也依赖儿子的牺牲。", "扶门框、低声劝、避开账本、整理餐具"),
    ],
    locations: [
      locationSeed("loc_room_created", "格里高尔房门", "迟到、解释和沉默都集中在门缝。", ["闹钟迟响", "钥匙转动", "门外催促", "样品箱没扣好"]),
      locationSeed("loc_table_created", "家庭餐桌", "账本和早餐一起出现。", ["账本摊开", "小提琴练习中断", "旧制服被翻出", "早餐盘被放下"]),
      locationSeed("loc_office_created", "公司柜台", "人被写成迟到、缺勤和责任。", ["缺勤记录", "书记员提前登门", "同事窃听", "收入冻结"]),
    ],
    relationships: [
      relationSeed("char_gregor_created", "char_grete_created", "兄妹 / 音乐承诺", "哥哥的工资维持妹妹的未来想象。"),
      relationSeed("char_grete_created", "char_gregor_created", "照看 / 等待", "妹妹感谢哥哥，也怨恨未来被押在他身上。"),
      relationSeed("char_father_created", "char_gregor_created", "父亲 / 旧债", "父亲依赖儿子，却把这种依赖感成羞耻。"),
      relationSeed("char_mother_created", "char_gregor_created", "母亲 / 解释", "母亲想保护孩子，也害怕账本被说清。"),
    ],
  };
}

function blueprintCustom(worldPrompt, peoplePrompt) {
  const titleSeed = firstClause(worldPrompt) || "未命名世界";
  const customCharacters = inferCustomCharacters(peoplePrompt, worldPrompt);
  const powerCenters = inferCustomPowerCenters(worldPrompt, titleSeed);
  const recurringObjects = inferCustomRecurringObjects(worldPrompt, peoplePrompt, powerCenters);
  return {
    id: "custom_world",
    title: titleSeed.length > 14 ? `${titleSeed.slice(0, 14)}世界` : titleSeed,
    townName: titleSeed,
    genre: "自定义戏剧舞台 / 关系压力 / 实时观察",
    summary: worldPrompt || "一个由用户输入启动的世界，人物会在关系压力中行动。",
    timepoint: "故事开始的第一天",
    era: inferCustomEra(worldPrompt),
    location: titleSeed,
    background: worldPrompt || "世界规则尚未完全明说，但人物已经被关系压住。",
    darknessLevel: 62,
    nobilityLevel: 52,
    publicRules: inferCustomPublicRules(worldPrompt, recurringObjects),
    hiddenRules: inferCustomHiddenRules(worldPrompt, recurringObjects),
    powerCenters,
    recurringObjects,
    pressureClock: inferCustomPressureClock(worldPrompt, recurringObjects, powerCenters),
    characters: customCharacters,
    locations: inferCustomLocations(powerCenters, recurringObjects),
    relationships: inferCustomRelationshipSeeds(customCharacters, worldPrompt, peoplePrompt, recurringObjects, powerCenters),
  };
}

function inferCustomCharacters(peoplePrompt, worldPrompt = "") {
  const pieces = String(peoplePrompt || "")
    .split(/[、，,。；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
  const resource = inferCustomRecurringObjects(worldPrompt, peoplePrompt, [firstClause(worldPrompt)]).find(Boolean) || "核心物件";
  const source = pieces.length >= 2 ? pieces : [
    `守着${resource}的人`,
    `想偷走${resource}的人`,
    `替${resource}定价的人`,
    `被${resource}困住的人`,
  ];
  return source.map((text, index) => characterSeed(
    `char_custom_${index + 1}`,
    guessCharacterName(text, index),
    text,
    customDesireFromText(text, resource, index),
    customShameFromText(text, resource, index),
    customVisibleVerbsFromText(text, index),
  ));
}

function inferCustomEra(worldPrompt = "") {
  if (/赛博朋克|公司|义体|数据|霓虹|合成/.test(worldPrompt)) return "公司、资源和身体都可被计量的近未来";
  if (/仙侠|修真|宗门|妖|鬼|灵/.test(worldPrompt)) return "规则与灵物同时支配行动的异世";
  if (/民国|租界|军阀/.test(worldPrompt)) return "旧秩序正在裂开的近代";
  if (/古代|王朝|宫廷|江湖/.test(worldPrompt)) return "名分、门第和旧约仍有力量的时代";
  return "由用户输入生成的时代";
}

function inferCustomPublicRules(worldPrompt = "", objects = []) {
  const resource = objects[0] || "核心物件";
  const rules = [
    `${resource}必须留下可追溯的归属。`,
    "任何公开交换都必须经过至少一个权力节点。",
    "没有身份凭证的人只能借别人的名义行动。",
  ];
  if (/税|公司|账|配额|债/.test(worldPrompt)) rules[0] = `${resource}会被登记、征收或重新定价。`;
  if (/不可杀|中立|庇护/.test(worldPrompt)) rules.push("公开冲突不能直接以杀戮解决，只能转成扣押、审讯或交易。");
  return rules.slice(0, 4);
}

function inferCustomHiddenRules(worldPrompt = "", objects = []) {
  const resource = objects[0] || "核心物件";
  const rules = [
    `真正被争夺的不是${resource}本身，而是谁能决定它属于谁。`,
    "弱者的求助会迫使强者公开表态。",
    "越中立的制度，越会私下挑选受益者。",
  ];
  if (/海底|氧气|避难|工厂/.test(worldPrompt)) rules.push("生存资源越稀缺，沉默越容易变成勒索。");
  if (/圣女|信徒|祈祷|神/.test(worldPrompt)) rules.push("信仰语言可以把资源分配伪装成救赎。");
  return rules.slice(0, 4);
}

function inferCustomPressureClock(worldPrompt = "", objects = [], centers = []) {
  const object = objects[0] || "核心物件";
  const center = centers[0] || "第一个权力节点";
  if (/明天|天亮|日落|午夜|一天/.test(worldPrompt)) return `到下一个时限前，${center}必须处理${object}的归属、价格或证词。`;
  return `一天内必须让${object}在${center}换手、被扣住或被公开命名。`;
}

function inferCustomPowerCenters(worldPrompt = "", titleSeed = "未命名世界") {
  const listed = extractListedCustomTerms(worldPrompt)
    .filter((term) => !/[被]|征税|活到|同时存在|决定谁/.test(term))
    .filter((term) => /城|门|司|市|渡|坊|库|楼|塔|码头|舱|工厂|厂|闸|宫|寺|院|站|店|署|局|社|厅|桥|港|街|场|船/.test(term));
  const unique = uniqueTerms(listed).slice(0, 6);
  if (unique.length >= 3) return unique;
  const title = titleSeed || "世界";
  return uniqueTerms([
    ...unique,
    `${title}入口`,
    `${title}交易所`,
    `${title}档案室`,
    `${title}避难处`,
  ]).slice(0, 5);
}

function inferCustomRecurringObjects(worldPrompt = "", peoplePrompt = "", powerCenters = []) {
  const text = `${worldPrompt} ${peoplePrompt}`;
  const explicit = [];
  for (const term of ["氧气", "氧气税", "潮汐闸", "黑市", "祈祷舱", "藻类", "公司印章", "配额", "账本", "通行证", "鱼人", "义体", "数据", "债契", "船票", "药剂", "护符"]) {
    if (text.includes(term)) explicit.push(term);
  }
  const fromCenters = powerCenters
    .map((center) => String(center || "").replace(/码头|工厂|入口|交易所|档案室|避难处$/g, "").trim())
    .filter((term) => term.length >= 2);
  return uniqueTerms([...explicit, ...fromCenters, ...extractListedCustomTerms(text)])
    .filter((term) => term.length >= 2 && term.length <= 10)
    .filter((term) => !isLikelyCharacterTerm(term))
    .slice(0, 8);
}

function isLikelyCharacterTerm(term = "") {
  return /潜水员|走私者|监察官|圣女|工程师|医生|剑修|使者|少主|器灵|引魂人|守门人|逃离者|父亲|母亲|妹妹|哥哥|祭司|商人|摊主/.test(String(term || ""));
}

function inferCustomLocations(powerCenters = [], objects = []) {
  const centers = powerCenters.length ? powerCenters : ["中心入口", "交易所", "档案室"];
  return centers.slice(0, Math.max(3, Math.min(5, centers.length))).map((center, index) => {
    const object = objectForCustomLocation(objects, center, index);
    return locationSeed(
      `loc_custom_${index + 1}`,
      center,
      `${object}在这里登记、扣押、交换或被拒绝。`,
      [
        `${object}被推到${center}的明处`,
        `有人在${center}停下脚步`,
        `${center}的记录被改动`,
        `旁观者绕开${object}`,
      ],
      `${center}会把私人欲望变成公开手续。`,
    );
  });
}

function objectForCustomLocation(objects = [], center = "", index = 0) {
  const candidates = objects.length ? objects : ["核心物件"];
  const ranked = candidates.slice(index).concat(candidates.slice(0, index));
  return ranked.find((candidate) => {
    const term = String(candidate || "").trim();
    const place = String(center || "").trim();
    if (!term) return false;
    return term !== place && !place.includes(term) && !term.includes(place);
  }) || "凭证";
}

function inferCustomRelationshipSeeds(characters = [], worldPrompt = "", peoplePrompt = "", objects = [], centers = []) {
  if (characters.length < 2) return [];
  const object = objects[0] || "核心物件";
  const center = centers[0] || firstClause(worldPrompt) || "此地";
  return characters.map((character, index) => {
    const next = characters[(index + 1) % characters.length];
    const pressure = [
      `${character.name}需要${object}继续留在自己能碰到的地方。`,
      `${next.name}的身份让${center}里的手续变得危险。`,
      firstClause(peoplePrompt) ? `他们都知道${firstClause(peoplePrompt)}不是一个旁观位置。` : "",
    ].filter(Boolean).join("");
    return relationSeed(character.id, next.id, "资源 / 旧债 / 误读", pressure);
  });
}

function customDesireFromText(text = "", resource = "核心物件", index = 0) {
  if (/税|监察|公司|掌管|官/.test(text)) return `让${resource}继续按自己的手续被定价。`;
  if (/走私|偷|黑市|欠债|潜水/.test(text)) return `把${resource}从公开手续里带走。`;
  if (/医|修理|工程|工匠/.test(text)) return `让${resource}先救人，再被审问。`;
  if (/圣女|信徒|神|祭司|祈祷/.test(text)) return `让别人相信${resource}不只是价格。`;
  return index % 2 === 0 ? `让别人承认自己对${resource}的处置权。` : `从${resource}背后的安排里拿回选择。`;
}

function customShameFromText(text = "", resource = "核心物件", index = 0) {
  if (/税|监察|公司|掌管|官/.test(text)) return `害怕自己只是靠${resource}剥夺别人。`;
  if (/走私|偷|黑市|欠债|潜水/.test(text)) return `害怕自己为了${resource}出卖过该保护的人。`;
  if (/医|修理|工程|工匠/.test(text)) return `害怕修好${resource}反而让更多人被困住。`;
  if (/圣女|信徒|神|祭司|祈祷/.test(text)) return `害怕自己的神圣位置依赖${resource}的短缺。`;
  return index % 2 === 0 ? `害怕自己只是被${resource}支撑。` : `害怕离开${resource}会暴露亏欠。`;
}

function customVisibleVerbsFromText(text = "", index = 0) {
  if (/税|监察|公司|掌管|官/.test(text)) return "验章、扣票、登记、压低声音、改价";
  if (/走私|偷|黑市|欠债|潜水/.test(text)) return "藏货、试价、退到阴影、递暗号、扣住袋口";
  if (/医|修理|工程|工匠/.test(text)) return "诊断、拆阀、递工具、遮住伤口、改线路";
  if (/圣女|信徒|神|祭司|祈祷/.test(text)) return "合掌、按住圣像、低声祝祷、收起供物、看向人群";
  return index % 2 === 0 ? "整理、询问、阻止、转身" : "等待、试探、改口、离开";
}

function extractListedCustomTerms(text = "") {
  const terms = [];
  for (const rawClause of String(text || "").split(/[，,。；;\n]/)) {
    const clause = rawClause.trim();
    if (!clause) continue;
    const beforeVerb = clause.split(/决定|控制|掌握|握着|压住|交换|征税|互相|牵制|必须|需要|会|让|把|被/)[0];
    const source = beforeVerb.includes("、") || beforeVerb.includes("和") ? beforeVerb : clause;
    for (const part of source.split(/[、/与及和]/)) {
      const cleaned = part
        .replace(/^(一个|一位|几个|几位|被|掌管|修理|藏着|欠债的|非法|公开|私下|沿途的)/g, "")
        .replace(/(的人|者|决定谁能活到明天|同时存在|都被.*)$/g, "")
        .trim();
      if (cleaned.length >= 2 && cleaned.length <= 12) terms.push(cleaned);
    }
  }
  return terms;
}

function uniqueTerms(terms = []) {
  const result = [];
  for (const raw of terms) {
    const term = String(raw || "").trim();
    if (!term || result.some((item) => item === term || item.includes(term) || term.includes(item))) continue;
    result.push(term);
  }
  return result;
}

export const XIAOYA_YOU_TAVERN_INSTITUTION = {
  schemaVersion: 5,
  name: "望梯酒馆",
  householdName: "谢家",
  ownerIds: ["char_xyy_xieheng"],
  operatorId: "char_xyy_xiemu",
  householdWorkerIds: ["char_xyy_xiezenshi"],
  publicHours: ["清晨", "正午", "午后", "黄昏"],
  description: "望梯酒馆是谢家的生计：谢恒是东家，负责进货、外账与缺口；谢母是掌柜兼掌灶，决定怎样接客、出餐、赊账和收店；谢真石住在后院，以柴水和堂前杂务分担家业。",
  // Canonical topology zone ids; display labels live in the zone vocabulary.
  serviceZones: ["hall", "counter", "stove", "courtyard", "guest_room"],
  servicePreparationPolicy: {
    stationZoneId: "stove",
    heatSourceId: "tavern_stove_fire",
    rule: "点单只建立请求；取器皿、走到操作区、准备、等待成熟、收尾、送到客人面前分别由世界过程和人物行动完成。",
  },
  offerings: {
    hot_water: {
      label: "一碗热水",
      price: 0,
      category: "tea",
      qualityTier: "plain",
      serving: { unit: "bowl", portions: 1 },
      vesselType: "tea_bowl",
      stockCost: { water: 1, firewood: 0.05 },
      needChannels: ["thirst", "stay_legitimacy"],
      bodyDemand: { exertion: 4, energyDemand: 1, thirstRelief: 36 },
      sustenance: { class: "mundane_drink", mundaneNutrition: 0, spiritualNutrition: 0, hydration: 0.72, sensoryValue: 0.12 },
      observableQualities: ["烧开的山泉水", "不收茶钱"],
      preparation: { processKind: "heat-and-pour", stationZoneId: "stove", durationSecondsWhenHeatReady: 10, durationSecondsColdStart: 90, attentionMode: "passive_wait" },
      walkInOrderable: true,
    },
    tea: {
      label: "一碗粗焙山茶",
      price: 1,
      category: "tea",
      qualityTier: "rough",
      serving: { unit: "bowl", portions: 1, refillCount: 1 },
      vesselType: "tea_bowl",
      stockCost: { tea: 1, water: 1, firewood: 0.05 },
      needChannels: ["thirst", "stay_legitimacy", "information_cover"],
      bodyDemand: { exertion: 4, energyDemand: 1, thirstRelief: 44 },
      sustenance: { class: "mundane_drink", mundaneNutrition: 0, spiritualNutrition: 0, hydration: 0.84, sensoryValue: 0.34 },
      observableQualities: ["普通山茶焙得较重", "可续一次热水"],
      preparation: { processKind: "tea-infusion", stationZoneId: "stove", durationSecondsWhenHeatReady: 24, durationSecondsColdStart: 110, attentionMode: "passive_wait" },
      walkInOrderable: true,
    },
    house_tea_pot: {
      label: "一壶店藏山茶",
      price: 3,
      category: "tea",
      qualityTier: "house",
      serving: { unit: "pot", portions: 3, refillCount: 1 },
      vesselType: "tea_pot",
      stockCost: { houseTea: 1, water: 2, firewood: 0.08 },
      needChannels: ["thirst", "stay_legitimacy", "information_cover", "quality"],
      bodyDemand: { exertion: 4, energyDemand: 1, thirstRelief: 56 },
      sustenance: { class: "mundane_drink", mundaneNutrition: 0, spiritualNutrition: 0, hydration: 0.9, sensoryValue: 0.62 },
      observableQualities: ["香气比粗焙山茶清楚", "够一人慢饮数盏"],
      preparation: { processKind: "tea-pot-infusion", stationZoneId: "stove", durationSecondsWhenHeatReady: 32, durationSecondsColdStart: 125, attentionMode: "passive_wait" },
      walkInOrderable: true,
    },
    fine_cloud_tea_pot: {
      label: "一壶云岫春芽",
      price: 6,
      category: "tea",
      qualityTier: "fine",
      serving: { unit: "pot", portions: 3, refillCount: 1 },
      vesselType: "tea_pot",
      stockCost: { fineTea: 1, water: 2, firewood: 0.08 },
      needChannels: ["thirst", "stay_legitimacy", "information_cover", "quality"],
      bodyDemand: { exertion: 4, energyDemand: 1, thirstRelief: 58 },
      sustenance: { class: "mundane_drink", mundaneNutrition: 0, spiritualNutrition: 0, hydration: 0.92, sensoryValue: 0.86 },
      observableQualities: ["当季嫩芽", "香气清而不焦", "柜台价牌上最贵的茶"],
      preparation: { processKind: "fine-tea-infusion", stationZoneId: "stove", durationSecondsWhenHeatReady: 38, durationSecondsColdStart: 132, attentionMode: "passive_wait" },
      walkInOrderable: true,
    },
    meal: {
      label: "一份望梯常饭",
      price: 5,
      category: "meal",
      qualityTier: "plain",
      serving: { unit: "set", portions: 1 },
      vesselType: "meal_bowl",
      stockCost: { meals: 1 },
      needChannels: ["hunger", "fatigue", "stay_legitimacy"],
      bodyDemand: { exertion: 4, energyDemand: 1, hungerRelief: 45, recovery: 8 },
      sustenance: { class: "mundane_food", mundaneNutrition: 0.78, spiritualNutrition: 0, hydration: 0.16, sensoryValue: 0.42 },
      observableQualities: ["杂粮饭", "时蔬豆腐", "腌笋", "热汤"],
      preparation: { processKind: "portion-ready-meal", stationZoneId: "stove", durationSecondsWhenHeatReady: 16, durationSecondsColdStart: 54, attentionMode: "continuous_work" },
      walkInOrderable: true,
    },
    meat_meal: {
      label: "一份添肉饭",
      price: 8,
      category: "meal",
      qualityTier: "hearty",
      serving: { unit: "set", portions: 1 },
      vesselType: "meal_bowl",
      stockCost: { meals: 1, meatPortions: 1 },
      needChannels: ["hunger", "fatigue", "stay_legitimacy", "quality"],
      bodyDemand: { exertion: 4, energyDemand: 1, hungerRelief: 62, recovery: 13 },
      sustenance: { class: "mundane_food", mundaneNutrition: 0.92, spiritualNutrition: 0, hydration: 0.12, sensoryValue: 0.64 },
      observableQualities: ["望梯常饭", "一份卤肉或河鱼"],
      preparation: { processKind: "portion-hearty-meal", stationZoneId: "stove", durationSecondsWhenHeatReady: 24, durationSecondsColdStart: 68, attentionMode: "continuous_work" },
      walkInOrderable: true,
    },
    lodging_only: {
      label: "普通客房一晚",
      price: 12,
      category: "lodging",
      qualityTier: "plain",
      stockCost: { rooms: 1 },
      walkInOrderable: false,
    },
    lodging_meal: {
      label: "普通客房一晚和一份望梯常饭",
      price: 16,
      category: "lodging",
      qualityTier: "plain",
      stockCost: { rooms: 1, meals: 1 },
      sustenance: { class: "mundane_food", mundaneNutrition: 0.78, spiritualNutrition: 0, hydration: 0.16, sensoryValue: 0.42 },
      preparation: { processKind: "portion-ready-meal", stationZoneId: "stove", durationSecondsWhenHeatReady: 16, durationSecondsColdStart: 54, attentionMode: "continuous_work" },
      walkInOrderable: false,
    },
    lodging_two_meals: {
      label: "普通客房一晚和两份望梯常饭",
      price: 20,
      category: "lodging",
      qualityTier: "plain",
      stockCost: { rooms: 1, meals: 2 },
      sustenance: { class: "mundane_food", mundaneNutrition: 0.78, spiritualNutrition: 0, hydration: 0.16, sensoryValue: 0.42 },
      walkInOrderable: false,
    },
    work_meal: {
      label: "以一组约六分之一日的明确杂务换一份望梯常饭",
      price: 0,
      compensationValue: 5,
      category: "work_meal",
      qualityTier: "plain",
      vesselType: "meal_bowl",
      stockCost: { meals: 1 },
      sustenance: { class: "mundane_food", mundaneNutrition: 0.78, spiritualNutrition: 0, hydration: 0.16, sensoryValue: 0.42 },
      preparation: { processKind: "portion-ready-meal", stationZoneId: "stove", durationSecondsWhenHeatReady: 16, durationSecondsColdStart: 54, attentionMode: "continuous_work" },
      walkInOrderable: false,
    },
  },
  tableUseNorm: {
    id: "norm_public_table_use_during_business",
    sitWithoutOrderingPhysicallyPossible: true,
    operatorResponseRequiresOwnAction: true,
    pressureOnset: "来客实际占用客桌且经营者亲眼注意到尚无消费或来意后，随停留时间产生",
  },
  // These are objective scene positions, not character recommendations.  A
  // Character Agent receives every currently available option and owns the
  // trade-off between information access, exposure, traffic and exit access.
  guestPositions: [
    {
      id: "position:tavern-hall-side-wall-table",
      label: "堂前侧墙空桌",
      zoneId: "hall",
      capacity: 2,
      metrics: { informationAccess: [0.68, 0.84], visualCoverage: [0.72, 0.86], socialExposure: [0.28, 0.44], approachability: [0.24, 0.4], trafficInterference: [0.12, 0.28], movementClearance: [0.68, 0.84], exitAccess: [0.48, 0.64], comfort: [0.42, 0.58] },
      observableFeatures: ["一侧临墙，背后没有客人通行", "斜向能看见门槛和柜台", "离主要取送饭食路线有一段距离"],
    },
    {
      id: "position:tavern-hall-center-table",
      label: "堂中空桌",
      zoneId: "hall",
      capacity: 4,
      metrics: { informationAccess: [0.82, 0.94], visualCoverage: [0.82, 0.94], socialExposure: [0.78, 0.92], approachability: [0.76, 0.9], trafficInterference: [0.62, 0.8], movementClearance: [0.5, 0.68], exitAccess: [0.45, 0.6], comfort: [0.55, 0.72] },
      observableFeatures: ["堂中多处谈话都较清楚", "四面都可能有人经过或落座", "在座客人容易注意这里"],
    },
    {
      id: "position:tavern-hall-near-counter",
      label: "近柜台空位",
      zoneId: "hall",
      capacity: 2,
      metrics: { informationAccess: [0.84, 0.96], visualCoverage: [0.58, 0.74], socialExposure: [0.62, 0.78], approachability: [0.8, 0.94], trafficInterference: [0.7, 0.88], movementClearance: [0.42, 0.58], exitAccess: [0.32, 0.48], comfort: [0.35, 0.52] },
      observableFeatures: ["柜台交谈最容易听清", "经营者容易注意并主动询问", "取送物品和结账的人会经过"],
    },
    {
      id: "position:tavern-hall-near-threshold-bench",
      label: "近门侧凳",
      zoneId: "hall",
      capacity: 2,
      metrics: { informationAccess: [0.45, 0.62], visualCoverage: [0.78, 0.9], socialExposure: [0.48, 0.65], approachability: [0.4, 0.58], trafficInterference: [0.66, 0.84], movementClearance: [0.6, 0.76], exitAccess: [0.88, 0.96], comfort: [0.32, 0.48] },
      observableFeatures: ["门外和新来的人最容易看见", "堂中较远处的低声交谈不容易听清", "进出酒馆的人会从附近经过"],
    },
  ],
  objectTemplates: [
    { id: "tavern_tool_wiping_cloth", label: "擦桌抹布", aliases: ["抹布"], zoneId: "hall", portable: true, state: { cleanEnough: true } },
    { id: "tavern_tool_water_bucket", label: "木水桶", aliases: ["水桶"], zoneId: "stove", portable: true, state: { fill: 0 } },
    { id: "tavern_resource_water_vat", label: "灶边水缸", aliases: ["水缸"], zoneId: "stove", portable: false, state: { fill: 0.55, capacityBuckets: 2 } },
    { id: "tavern_resource_courtyard_water", label: "后院取水处", aliases: ["取水处"], zoneId: "courtyard", portable: false, state: { availableBuckets: 20 } },
    { id: "tavern_tool_wood_axe", label: "劈柴斧", aliases: ["斧头", "木斧"], zoneId: "courtyard", portable: true, state: { returned: true } },
    { id: "tavern_resource_unprocessed_firewood", label: "后院湿柴堆", aliases: ["湿柴", "柴堆"], zoneId: "courtyard", portable: false, state: { unprocessedBundles: 2 } },
    { id: "tavern_resource_sheltered_firewood", label: "檐下成柴堆", aliases: ["成柴", "干柴堆"], zoneId: "courtyard", portable: false, state: { processedBundles: 0 } },
    { id: "tavern_room_key_guest_1", label: "一号客房钥匙", aliases: ["客房钥匙", "房门钥匙"], zoneId: "hall", portable: true, state: { objectType: "lodging_key", roomId: "guest_room_1" } },
    { id: "tavern_room_key_guest_2", label: "二号客房钥匙", aliases: ["客房钥匙", "房门钥匙"], zoneId: "hall", portable: true, state: { objectType: "lodging_key", roomId: "guest_room_2" } },
    { id: "tavern_room_key_guest_3", label: "三号客房钥匙", aliases: ["客房钥匙", "房门钥匙"], zoneId: "hall", portable: true, state: { objectType: "lodging_key", roomId: "guest_room_3" } },
    { id: "tavern_vessel_meal_1", label: "一号饭碗", aliases: ["饭碗", "碗"], zoneId: "hall", portable: true, state: { serviceTypes: ["meal", "lodging", "work_meal"], vesselType: "meal_bowl", contents: "empty" } },
    { id: "tavern_vessel_meal_2", label: "二号饭碗", aliases: ["饭碗", "碗"], zoneId: "hall", portable: true, state: { serviceTypes: ["meal", "lodging", "work_meal"], vesselType: "meal_bowl", contents: "empty" } },
    { id: "tavern_vessel_meal_3", label: "三号饭碗", aliases: ["饭碗", "碗"], zoneId: "hall", portable: true, state: { serviceTypes: ["meal", "lodging", "work_meal"], vesselType: "meal_bowl", contents: "empty" } },
    { id: "tavern_vessel_meal_4", label: "四号饭碗", aliases: ["饭碗", "碗"], zoneId: "hall", portable: true, state: { serviceTypes: ["meal", "lodging", "work_meal"], vesselType: "meal_bowl", contents: "empty" } },
    { id: "tavern_vessel_tea_1", label: "一号茶碗", aliases: ["茶碗", "茶盏"], zoneId: "hall", portable: true, state: { serviceTypes: ["tea"], vesselType: "tea_bowl", contents: "empty" } },
    { id: "tavern_vessel_tea_2", label: "二号茶碗", aliases: ["茶碗", "茶盏"], zoneId: "hall", portable: true, state: { serviceTypes: ["tea"], vesselType: "tea_bowl", contents: "empty" } },
    { id: "tavern_vessel_teapot_1", label: "一号茶壶", aliases: ["茶壶", "壶"], zoneId: "hall", portable: true, state: { serviceTypes: ["tea"], vesselType: "tea_pot", contents: "empty" } },
    { id: "tavern_vessel_teapot_2", label: "二号茶壶", aliases: ["茶壶", "壶"], zoneId: "hall", portable: true, state: { serviceTypes: ["tea"], vesselType: "tea_pot", contents: "empty" } },
    {
      id: "tavern_delivery_medicine_parcel",
      label: "药包",
      aliases: ["药包", "药材包"],
      zoneId: "hall",
      initialHolderActorId: "char_xyy_zhoumin",
      portable: true,
      state: {
        accepted: false,
        intendedRecipientActorId: "char_xyy_xiemu",
        treatmentTargetActorId: "char_xyy_xiemu",
        treatmentCategory: "chronic_lung_ailment",
        treatmentDetailsStatus: "unknown",
      },
    },
    { id: "tavern_delivery_manifest", label: "送药清单", aliases: ["清单", "送药清单"], zoneId: "hall", initialHolderActorId: "char_xyy_zhoumin", portable: true, state: { accepted: false, intendedRecipientActorId: "char_xyy_xiemu" } },
    { id: "tavern_registry_pages", label: "掌籍名录和待核纸页", aliases: ["掌籍名录", "名录", "纸页"], zoneId: "hall", initialHolderActorId: "char_xyy_yanzhizhong", portable: true, state: { reviewed: false } },
    { id: "xiezenshi_short_sword", label: "谢真石的短剑", aliases: ["短剑"], zoneId: "courtyard", initialHolderActorId: "char_xyy_xiezenshi", portable: true, state: { sheathed: true } },
    {
      id: "luozhao_sword",
      label: "洛照的佩剑",
      aliases: ["长剑", "佩剑"],
      zoneId: "hall",
      initialHolderActorId: "char_xyy_luozhao",
      portable: true,
      state: { sheathed: true },
      attachment: {
        active: true,
        actorId: "char_xyy_luozhao",
        mode: "worn_on_body_unspecified",
        transitionRequiresExplicitOperation: true,
      },
      custody: { storageMode: "worn", containerId: "", inHand: false },
      presentation: { exposure: "visible", displayedToActorIds: [], publiclyVisible: true },
      perception: { publicLabel: "一柄带鞘长剑" },
    },
    {
      id: "luozhao_yuheng_visit_letter",
      label: "洛照随身携带的玉衡宗拜帖",
      aliases: ["玉衡宗拜帖", "拜帖"],
      zoneId: "threshold",
      initialHolderActorId: "char_xyy_luozhao",
      portable: true,
      state: {
        intendedRecipientInstitutionId: "institution_xyy_tiyunzong",
        tavernCustody: false,
        displayedToActorIds: [],
      },
      custody: { storageMode: "packed", containerId: "luozhao_travel_pack", inHand: false },
      presentation: { exposure: "hidden", displayedToActorIds: [], publiclyVisible: false },
      perception: { publicLabel: "一封帖子" },
    },
  ],
  workOrderTemplates: [
    {
      templateId: "clear_hall_tables",
      taskKind: "cleaning",
      zoneId: "hall",
      taskLabel: "收净堂前两张空桌",
      description: "把堂前两张已经空下来的桌子收去碗筷并擦净桌面。",
      unitAction: "收去一张空桌上的碗筷，把桌面擦净",
      requiredUnits: 2,
      unitLabel: "张桌",
      completionCriteria: ["两张空桌都没有遗留碗筷", "桌面擦净且不影响在座客人"],
      objectIds: [],
      toolIds: ["tavern_tool_wiping_cloth"],
      compensation: { kind: "meal", quantity: 1 },
    },
    {
      templateId: "fill_water_bucket",
      taskKind: "refill",
      zoneId: "courtyard",
      taskLabel: "从后院取水处装水",
      description: "本人持桶到后院，将取水处的水装入桶中；装水后仍需本人携桶回灶边。",
      unitAction: "从后院取水处把水装进手中的桶",
      requiredUnits: 20,
      unitLabel: "桶水",
      objectIds: ["tavern_resource_courtyard_water"],
      toolIds: ["tavern_tool_water_bucket"],
      durationSecondsPerUnit: 15,
      bodyLoadPerUnit: { exertionDelta: 0.025, fatigueDelta: 0.01, staminaDelta: -0.01, energyDelta: -0.01 },
      completionEffects: { objectNumericTransfers: [{ maxUnits: 1,
        from: { objectId: "tavern_resource_courtyard_water", path: ["availableBuckets"], unitsPerValue: 1 },
        to: { objectId: "tavern_tool_water_bucket", path: ["fill"], unitsPerValue: 1, maximum: 1 },
      }] },
      completionSound: { content: "取水处传来水流注入木桶的声音。", maxDistance: 1 },
    },
    {
      templateId: "refill_stove_water",
      taskKind: "refill",
      zoneId: "stove",
      taskLabel: "把灶边水缸添满",
      description: "本人把已取到的水带回灶边，将桶中的水倒入水缸的剩余空间。",
      unitAction: "将手中桶里的水倒入灶边水缸的剩余空间",
      requiredUnits: 2,
      unitLabel: "桶水",
      completionCriteria: ["水缸达到满线", "水桶归回原处且地面无大片积水"],
      objectIds: ["tavern_resource_water_vat"],
      toolIds: ["tavern_tool_water_bucket"],
      durationSecondsPerUnit: 8,
      bodyLoadPerUnit: { exertionDelta: 0.02, fatigueDelta: 0.01, staminaDelta: -0.01, energyDelta: -0.01 },
      completionEffects: { objectNumericTransfers: [{ maxUnits: 1,
        from: { objectId: "tavern_tool_water_bucket", path: ["fill"], unitsPerValue: 1 },
        to: { objectId: "tavern_resource_water_vat", path: ["fill"], unitsPerValue: 2, maximum: 1 },
      }] },
      completionSound: { content: "灶边响起桶中水注入水缸的声音。", maxDistance: 1 },
      completionCondition: { objectId: "tavern_resource_water_vat", path: ["fill"], minimum: 1 },
      compensation: { kind: "meal", quantity: 1 },
    },
    {
      templateId: "split_firewood_bundles",
      taskKind: "firewood",
      zoneId: "courtyard",
      taskLabel: "劈好后院两束湿柴",
      description: "从后院待处理柴堆取两束湿柴，劈开并码到有遮雨处。",
      unitAction: "劈开一束湿柴，码进有遮雨的柴堆",
      requiredUnits: 2,
      unitLabel: "束柴",
      completionCriteria: ["两束柴已经劈开", "成柴码入遮雨处且斧头归位"],
      objectIds: ["tavern_resource_unprocessed_firewood"],
      toolIds: ["tavern_tool_wood_axe"],
      durationSecondsPerUnit: 42,
      completionSound: { content: "后院传来斧刃劈入木料的脆响。", maxDistance: 3 },
      bodyLoadPerUnit: { exertionDelta: 0.08, fatigueDelta: 0.045, staminaDelta: -0.035, energyDelta: -0.025 },
      completionEffects: {
        objectNumericDeltas: [
          { objectId: "tavern_resource_unprocessed_firewood", path: ["unprocessedBundles"], delta: -1, minimum: 0 },
          { objectId: "tavern_resource_sheltered_firewood", path: ["processedBundles"], delta: 1, minimum: 0 },
        ],
      },
      compensation: { kind: "meal", quantity: 1 },
    },
  ],
};

const XIAOYA_YOU_CHARACTER_MATERIAL_ECONOMIES = {
  char_xyy_xiezenshi: {
    wealthBand: "family_and_sect_supported",
    materialPosition: "在家中有食宿，在梯云宗内门有日常供给；个人现钱不是谢家钱箱。",
    initialWallet: { currencyId: "copper_wen", amount: 10, sourceId: "tiyun_inner_disciple_allowance" },
    access: { reserveMode: "family_or_sect_support_by_request", reserveDescription: "可向家中或宗门取得必要供给，但不能把酒馆钱箱当成个人钱袋", businessTillAccess: false, institutionalSupport: true },
    currencyAccess: { copper_wen: { currencyClass: "mundane", acquisitionEaseRange: [0.86, 0.96], strategicValueRange: [0.03, 0.14], conversionFrictionRange: [0.08, 0.2], acquisitionRequiresAction: true, carriedTenderRequiredAtSettlement: true, description: "内门弟子取得少量凡俗铜钱很容易，但当场付款仍看随身钱袋" } },
    sources: [{ id: "tiyun_inner_disciple_allowance", kind: "sect_allowance", description: "梯云宗内门弟子的日常供给与少量现钱", reliability: [0.78, 0.94] }],
    obligations: [],
    consumptionPreferences: { priceSensitivity: [0.34, 0.52], qualitySensitivity: [0.46, 0.66], statusDisplayDrive: [0.08, 0.22], wasteAversion: [0.4, 0.62], bargainingWillingness: [0.16, 0.34], transactionPatience: [0.18, 0.38] },
    categoryKnowledge: { ordinaryFood: "熟悉", tea: "普通", cultivationGoods: "熟悉宗门常用品" },
  },
  char_xyy_zhoumin: {
    wealthBand: "cash_constrained_disciple",
    materialPosition: "外门供给够维持修行与必要往来，但现钱需要在饭食、人情和修炼开销之间取舍。",
    initialWallet: { currencyId: "copper_wen", amount: 7, sourceId: "tiyun_outer_disciple_allowance" },
    access: { reserveMode: "limited_sect_allowance", reserveDescription: "下一次外门供给之前没有可随意动用的额外现钱", businessTillAccess: false, institutionalSupport: true },
    currencyAccess: { copper_wen: { currencyClass: "mundane", acquisitionEaseRange: [0.68, 0.84], strategicValueRange: [0.08, 0.22], conversionFrictionRange: [0.16, 0.32], acquisitionRequiresAction: true, carriedTenderRequiredAtSettlement: true, description: "外门弟子取得少量铜钱并不困难，但时间、门路和当前现钱仍会影响眼前交易" } },
    sources: [{ id: "tiyun_outer_disciple_allowance", kind: "sect_allowance", description: "梯云宗外门弟子的有限日常供给", reliability: [0.78, 0.94] }],
    obligations: [{ id: "cultivation_and_family_advance", description: "保留钱财用于修炼材料、往来与改善家中处境", pressureRange: [0.58, 0.78] }],
    consumptionPreferences: { priceSensitivity: [0.68, 0.86], qualitySensitivity: [0.28, 0.48], statusDisplayDrive: [0.32, 0.54], wasteAversion: [0.68, 0.86], bargainingWillingness: [0.42, 0.64], transactionPatience: [0.54, 0.76] },
    categoryKnowledge: { ordinaryFood: "熟悉", tea: "普通", cultivationGoods: "熟悉外门常用品" },
  },
  char_xyy_luozhao: {
    wealthBand: "institution_backed_traveler",
    materialPosition: "正式来访途中不缺普通食宿盘缠；这表示玉衡宗差旅支持，不等于她拥有可任意挥霍的私人财富。",
    initialWallet: { currencyId: "copper_wen", amount: 24, sourceId: "yuheng_visit_travel_allowance" },
    access: { reserveMode: "official_route_support", reserveDescription: "沿正式来访路线可获得必要补给，离开路线后的个人财富仍未锚定", businessTillAccess: false, institutionalSupport: true },
    currencyAccess: { copper_wen: { currencyClass: "mundane", acquisitionEaseRange: [0.92, 0.98], strategicValueRange: [0.01, 0.08], conversionFrictionRange: [0.04, 0.12], acquisitionRequiresAction: true, carriedTenderRequiredAtSettlement: true, description: "对受宗门支持的洛照而言少量凡俗铜钱几乎不构成资源压力；尚未携带的钱仍不能自动用于付款" } },
    sources: [{ id: "yuheng_visit_travel_allowance", kind: "sect_travel_allowance", description: "玉衡宗为本次正式来访准备的普通食宿盘缠", reliability: [0.84, 0.96] }],
    obligations: [{ id: "complete_official_visit", description: "盘缠首先保证来访路程、食宿与返回，不为显示身份而花费", pressureRange: [0.44, 0.64] }],
    consumptionPreferences: { priceSensitivity: [0.14, 0.3], qualitySensitivity: [0.66, 0.84], statusDisplayDrive: [0.02, 0.14], wasteAversion: [0.4, 0.6], bargainingWillingness: [0.02, 0.14], transactionPatience: [0.26, 0.48] },
    categoryKnowledge: { ordinaryFood: "熟悉", tea: "能分辨常见茶叶与冲泡差异", cultivationGoods: "熟悉大宗门常用品" },
  },
  char_xyy_yanzhizhong: {
    wealthBand: "secure_sect_official",
    materialPosition: "掌籍职分提供稳定供给，普通茶饭价格很少构成压力，但公务账与私账分开。",
    initialWallet: { currencyId: "copper_wen", amount: 24, sourceId: "registry_official_personal_purse" },
    access: { reserveMode: "stable_sect_income", reserveDescription: "有稳定宗门供给，不得把公务名义当作个人免单", businessTillAccess: false, institutionalSupport: true },
    currencyAccess: { copper_wen: { currencyClass: "mundane", acquisitionEaseRange: [0.94, 0.99], strategicValueRange: [0.01, 0.07], conversionFrictionRange: [0.03, 0.1], acquisitionRequiresAction: true, carriedTenderRequiredAtSettlement: true, description: "稳定宗门职分使少量凡俗钱财的取得成本极低，但公私账和随身流动性仍分开" } },
    sources: [{ id: "registry_official_personal_purse", kind: "sect_official_income", description: "掌籍职分的稳定供给与个人现钱", reliability: [0.86, 0.98] }],
    obligations: [],
    consumptionPreferences: { priceSensitivity: [0.18, 0.34], qualitySensitivity: [0.48, 0.68], statusDisplayDrive: [0.12, 0.3], wasteAversion: [0.46, 0.68], bargainingWillingness: [0.04, 0.18], transactionPatience: [0.56, 0.78] },
    categoryKnowledge: { ordinaryFood: "熟悉", tea: "熟悉常见茶档", cultivationGoods: "熟悉宗门登记价格" },
  },
  char_xyy_xieheng: {
    wealthBand: "asset_tied_household_owner",
    materialPosition: "拥有酒馆生计与货物周转权，但家用、进货和药钱挤压现金；个人钱与钱箱必须分开。",
    initialWallet: { currencyId: "copper_wen", amount: 5, sourceId: "xieheng_personal_purse" },
    access: { reserveMode: "business_till_with_accounting", reserveDescription: "可按酒馆经营用途动用钱箱，不能无账挪作个人消费", businessTillAccess: true, institutionalSupport: false },
    currencyAccess: { copper_wen: { currencyClass: "mundane", acquisitionEaseRange: [0.62, 0.78], strategicValueRange: [0.12, 0.28], conversionFrictionRange: [0.18, 0.34], acquisitionRequiresAction: true, carriedTenderRequiredAtSettlement: true, description: "谢恒有修行经历和酒馆营生，取得少量铜钱不难；家计义务使营业现金仍有明确用途" } },
    sources: [{ id: "xie_tavern_income", kind: "household_business", description: "酒馆收入扣除进货、家用与药钱后的家庭生计", reliability: [0.72, 0.9] }],
    obligations: [{ id: "medicine_and_three_day_stock", description: "药钱与至少三日粮柴周转", pressureRange: [0.76, 0.92] }],
    consumptionPreferences: { priceSensitivity: [0.66, 0.84], qualitySensitivity: [0.36, 0.56], statusDisplayDrive: [0.04, 0.16], wasteAversion: [0.78, 0.94], bargainingWillingness: [0.56, 0.76], transactionPatience: [0.48, 0.7] },
    categoryKnowledge: { ordinaryFood: "经营者水平", tea: "经营者水平", cultivationGoods: "普通" },
  },
  char_xyy_xiemu: {
    wealthBand: "asset_tied_household_manager",
    materialPosition: "掌管酒馆日常钱箱与赊账，但每一文都受进货、家用和自身药费约束；钱箱不是私人财富。",
    initialWallet: { currencyId: "copper_wen", amount: 3, sourceId: "xiemu_personal_purse" },
    access: { reserveMode: "business_till_with_accounting", reserveDescription: "可按经营和家计记录动用钱箱，不会把营业款当作随身零用", businessTillAccess: true, institutionalSupport: false },
    currencyAccess: { copper_wen: { currencyClass: "mundane", acquisitionEaseRange: [0.22, 0.4], strategicValueRange: [0.58, 0.76], conversionFrictionRange: [0.42, 0.62], acquisitionRequiresAction: true, carriedTenderRequiredAtSettlement: true, description: "谢母主要依靠酒馆现金流，铜钱对她仍直接对应药钱、进货和家用" } },
    sources: [{ id: "xie_tavern_income", kind: "household_business", description: "酒馆收入承担进货、家用与肺疾用药", reliability: [0.72, 0.9] }],
    obligations: [{ id: "medicine_household_and_stock", description: "自己的肺疾用药、全家饭食与酒馆补货", pressureRange: [0.82, 0.96] }],
    consumptionPreferences: { priceSensitivity: [0.74, 0.9], qualitySensitivity: [0.48, 0.68], statusDisplayDrive: [0.02, 0.12], wasteAversion: [0.84, 0.97], bargainingWillingness: [0.52, 0.72], transactionPatience: [0.58, 0.8] },
    categoryKnowledge: { ordinaryFood: "经营者水平", tea: "经营者水平", medicine: "熟悉自己的常用药材" },
  },
  char_xyy_chenyan: {
    wealthBand: "precarious_no_cash",
    materialPosition: "当前钱袋里没有铜钱；少量凡俗钱财并非永远难得，但在眼前场所用当场劳动换饭，比离店另寻门路更直接。",
    initialWallet: { currencyId: "copper_wen", amount: 0, sourceId: "chenyan_empty_purse_today" },
    access: { reserveMode: "irregular_labor", reserveDescription: "可以靠零散劳动或之后的宗门、城中门路取得铜钱，但当前没有可直接结账的现钱", businessTillAccess: false, institutionalSupport: false },
    currencyAccess: { copper_wen: { currencyClass: "mundane", acquisitionEaseRange: [0.56, 0.76], strategicValueRange: [0.12, 0.28], conversionFrictionRange: [0.24, 0.44], acquisitionRequiresAction: true, carriedTenderRequiredAtSettlement: true, description: "低阶弟子取得少量铜钱通常不难，但陈砚此刻没有随身现钱；取得与付款不能在同一时刻凭空合并" } },
    sources: [{ id: "irregular_labor", kind: "casual_labor", description: "不稳定的零工与以工换食", reliability: [0.26, 0.48] }],
    obligations: [{ id: "daily_food_and_practice", description: "先解决当日饭食和基础练习所需", pressureRange: [0.78, 0.94] }],
    consumptionPreferences: { priceSensitivity: [0.88, 0.98], qualitySensitivity: [0.12, 0.32], statusDisplayDrive: [0.02, 0.12], wasteAversion: [0.82, 0.96], bargainingWillingness: [0.48, 0.7], transactionPatience: [0.68, 0.88] },
    categoryKnowledge: { ordinaryFood: "熟悉", tea: "有限", cultivationGoods: "只熟悉自己接触过的基础用品" },
  },
};

const XIAOYA_YOU_TAVERN_LIFE = {
  char_xyy_xiezenshi: {
    simulationTier: "core",
    role: "返家探亲、即将回宗门参加剑阁考核的内门弟子；在家中分担酒馆柴水杂务",
    schedule: [],
    copingStyle: "身体弱点被逼问时缩短回应；真正高明的剑术与切实可用的帮助会改变他的注意和手段",
    inertia: 18,
    activities: { duty: "把柴劈够并把水缸添满", personal: "在不碍客人的窄处慢练一式", routine: "擦剑后靠墙缓气" },
    commitments: ["晚饭前补足灶边柴堆", "不让练剑妨碍酒馆开门"],
    privatePursuit: "在返宗参加剑阁考核前取得真实帮助，让练剑隐疾有机会恢复",
    refusal: "拒绝让旁人替他宣布哪一条路就是归宿",
    tavernAgency: {
      version: 1,
      standing: "household_worker",
      placeRelationship: "这里是他住着、吃饭并用柴水杂务分担生计的家，不是供他练剑的空屋。",
      responsibilities: ["开门前补柴挑水", "堂前有人等候时先让掌柜知道", "练剑不得占过道或惊扰食客"],
      authority: { receiveGuest: true, serveMeal: true, serveTea: true, acceptDelivery: false, settleCash: false, grantCredit: false, openClose: false },
      servicePolicy: { noticesWaitingGuests: true, priority: 72, refusalCondition: "来客要求他越过掌柜私自赊账或替父母作主" },
      knowledgeBoundary: {
        knownActorIds: ["char_xyy_xieheng", "char_xyy_xiemu", "char_xyy_zhoumin", "char_xyy_yanzhizhong", "char_xyy_chenyan"],
        publicFacts: ["谢恒是东家", "谢母是掌柜", "热饭和茶都要经过灶前或柜台"],
        privateFacts: ["知道柴水是否够下一顿", "不知道完整外账和每一笔赊账"],
      },
      expression: { roleLabel: "东家儿子兼店伙", actionBias: "先迎到不挡路处，再去叫有权限的人" },
    },
  },
  char_xyy_xieheng: {
    simulationTier: "core",
    role: "谢家父亲；替酒馆验收米酒与柴薪，用零工钱补贴药费",
    schedule: ["清晨", "正午", "午后", "黄昏"],
    copingStyle: "把担心换成清点和修补，越接近当票真相越少说话",
    inertia: 22,
    activities: { duty: "验收送货并核对账板", personal: "避开家人清点药钱与当票期限", routine: "削一枚木楔垫稳松动的桌脚，再检查门闩" },
    commitments: ["把今天少到的米酒和柴薪数量写到账板", "把药钱和灶房公账分开"],
    privatePursuit: "凑齐下一轮药钱，同时让酒馆钱箱够买三天粮柴",
    refusal: "拒绝让儿子把自己的牺牲当成必须偿还的债",
    tavernAgency: {
      version: 1,
      standing: "proprietor",
      placeRelationship: "他是望梯酒馆的东家；进货、外账、亏空和能否继续开门最终落到他身上。",
      responsibilities: ["验收送货并支付货款", "核对营业外账", "掌柜忙不过来时接待和结账"],
      authority: { receiveGuest: true, serveMeal: true, serveTea: true, acceptDelivery: true, settleCash: true, grantCredit: false, openClose: true },
      servicePolicy: { noticesWaitingGuests: true, priority: 88, refusalCondition: "货物数目或来路无法核验，或有人要求从公账挪药钱" },
      knowledgeBoundary: {
        knownActorIds: ["char_xyy_xiezenshi", "char_xyy_xiemu", "char_xyy_zhoumin", "char_xyy_yanzhizhong", "char_xyy_chenyan"],
        publicFacts: ["自己是东家", "谢母是日常掌柜", "每份饭茶和送货都必须落到账上"],
        privateFacts: ["知道外账、货价和自己的药钱缺口", "不会把功法当票向食客公开"],
      },
      expression: { roleLabel: "东家", actionBias: "先看货、账和来客要什么，再决定接下或拒绝" },
    },
  },
  char_xyy_xiemu: {
    simulationTier: "core",
    role: "望梯酒馆掌灶与当日照看者；管饭、账板、钥匙和赊账",
    schedule: ["清晨", "正午", "午后", "黄昏", "夜深"],
    copingStyle: "先用饭和秩序照料人；具体问题被回避两次后停止收尾",
    inertia: 24,
    activities: { duty: "生火备饭并逐项记下消耗", personal: "核对家里的药钱缺口", routine: "收碗、温饭、把门口湿泥扫净" },
    commitments: ["有人在屋里就留一份热饭", "赊账和家计不能混成一本账"],
    privatePursuit: "找一个只有夫妻两人在场的时机，让谢恒把下一轮药钱来路说清",
    refusal: "拒绝再用不用操心替丈夫遮住药钱来路",
    tavernAgency: {
      version: 1,
      standing: "manager",
      placeRelationship: "她是望梯酒馆真正站在堂前的掌柜兼掌灶；客人进门后由她决定先招呼、出什么、是否赊账。",
      responsibilities: ["开灶和收灶", "辨认来客要饭、茶、住店还是找人", "出餐、记账、收钱和安排赊欠"],
      authority: { receiveGuest: true, serveMeal: true, serveTea: true, acceptDelivery: true, settleCash: true, grantCredit: true, openClose: true },
      servicePolicy: { noticesWaitingGuests: true, priority: 100, refusalCondition: "库存不够、旧账未清或来客借酒馆逼家人当众表态" },
      knowledgeBoundary: {
        knownActorIds: ["char_xyy_xiezenshi", "char_xyy_xieheng", "char_xyy_zhoumin", "char_xyy_yanzhizhong", "char_xyy_chenyan"],
        publicFacts: ["谢恒是东家", "自己是掌柜", "食客不能自行取用灶边存货"],
        privateFacts: ["知道灶房存量、堂前赊账和房间余量", "不知道谢恒当票的全部来路"],
      },
      expression: { roleLabel: "掌柜兼掌灶", actionBias: "先把来客安顿和账目说清，再回到家事" },
    },
  },
  char_xyy_zhoumin: {
    simulationTier: "visitor",
    role: "梯云宗外门弟子；到望梯酒馆给谢母送药，也会找一起长大的谢真石求教并推进举荐",
    schedule: ["正午", "午后"],
    copingStyle: "先照料眼前的小事，再把请求说到对方必须答应或拒绝",
    inertia: 14,
    activities: { duty: "把给谢母肺上旧疾的药包和送药清单交给能验收的人", personal: "找谢真石请教剑法，并推进参加内门考核的举荐路径", routine: "替人挪开挡路的凳子再坐下" },
    commitments: ["把给谢母的药包和清单交给能验收的人", "求指点与推进举荐是两件独立事务，不能用其中一件冒充另一件完成"],
    privatePursuit: "从谢真石本人得到答应或拒绝的明确举荐答复",
    refusal: "拒绝再接受一个含糊的嗯作为回答",
    tavernAgency: {
      version: 1,
      standing: "delivery_guest",
      placeRelationship: "他不是店里人；他从梯云宗外门来到酒馆，把给谢母的药交到店里，也会寻找谢真石。",
      responsibilities: ["把给谢母肺上旧疾的药包交给能验收的人", "若用搬货换饭就先完成约定的活"],
      authority: { receiveGuest: false, serveMeal: false, serveTea: false, acceptDelivery: false, settleCash: false, grantCredit: false, openClose: false },
      servicePolicy: { noticesWaitingGuests: false, priority: 0, refusalCondition: "不会替酒馆接账或向别的食客许诺" },
      knowledgeBoundary: {
        knownActorIds: ["char_xyy_xiezenshi", "char_xyy_xieheng", "char_xyy_xiemu", "char_xyy_yanzhizhong"],
        publicFacts: ["谢恒是东家", "谢母是掌柜", "药包要有人验收"],
        privateFacts: ["知道自己带来的药包用于谢母肺上的旧疾，但不知道精确病名、药方和剂量", "知道谢真石认为自己的能力约在内门考核及格线上下", "不知道谢家内账"],
      },
      expression: { roleLabel: "送药兼吃饭的熟客", actionBias: "先交差，再决定是否留下说私事" },
      visitPolicy: {
        kind: "delivery",
        arrivalTrigger: "self_committed_visit",
        arrivalMotive: "把给谢母肺上旧疾的药包和清单送到望梯酒馆，并找谢真石请教剑法、推进内门考核举荐",
        travelCostSlots: 1,
        purpose: "送来给谢母的药包和清单；找谢真石请教剑法，并推进内门考核举荐",
        purposes: [
          {
            id: "deliver_medicine_to_xiemu",
            kind: "delivery",
            label: "把给谢母肺上旧疾的药包和清单完成交割",
            objectIds: ["tavern_delivery_medicine_parcel", "tavern_delivery_manifest"],
            required: true,
          },
          {
            id: "seek_xiezenshi_sword_guidance",
            kind: "social_request",
            label: "向谢真石请教自己练过的剑法，取得具体指点",
            targetActorIds: ["char_xyy_xiezenshi"],
            responsibleActorIds: ["char_xyy_zhoumin"],
            zoneIds: ["hall", "courtyard"],
            required: false,
          },
          {
            id: "advance_inner_court_recommendation",
            kind: "social_request",
            label: "推进由谢真石举荐自己参加内门考核的路径",
            targetActorIds: ["char_xyy_xiezenshi"],
            responsibleActorIds: ["char_xyy_zhoumin"],
            zoneIds: ["hall", "courtyard"],
            required: false,
          },
        ],
        expectedHostIds: ["char_xyy_xieheng", "char_xyy_xiemu"],
        requestedService: "meal",
        paymentMode: "cash",
        completionCondition: "药包和清单完成交割；求教与举荐各自保留真实进度，不能互相结算",
        secondaryObjective: "推进由谢真石举荐自己参加内门考核的路径",
        secondaryTargetId: "char_xyy_xiezenshi",
        carriedObjectIds: ["tavern_delivery_medicine_parcel", "tavern_delivery_manifest"],
        carriedObjectLabel: "药包和送药清单",
        arrivalCue: "带着药包和送药清单站在门槛内",
        frequencyDays: 2,
        dayOffset: 1,
      },
    },
  },
  char_xyy_luozhao: {
    simulationTier: "visitor",
    role: "主动接受玉衡宗来访安排、佩剑且把拜帖收在随身行囊中，刚到望梯酒馆打探消息的来访弟子",
    schedule: [],
    copingStyle: "先观察，再以剑意和态度施压；被故意忽视才开口点破",
    inertia: 12,
    activities: { duty: "看管随身佩剑与拜帖", personal: "从亲眼所见和亲耳所闻中打探消息，再决定是否继续接近值得验证的剑术线索", routine: "束袖、观察人流、检查剑鞘" },
    commitments: ["不把展示拜帖当成向酒馆交付", "不在会牵连客人的堂前贸然拔剑", "确认对方真正受伤时等待其恢复"],
    privatePursuit: "亲自验证自己在谢真石完整状态的剑下能否触及新的极限",
    refusal: "拒绝用宗门名望要求别人认输",
    tavernAgency: {
      version: 1,
      standing: "visitor",
      placeRelationship: "她是刚跨进门槛的外来访客；酒馆提供可听消息、询问和自愿消费的公共环境，但没有预先替她建立住店、接引或房饭交易。",
      responsibilities: [],
      authority: { receiveGuest: false, serveMeal: false, serveTea: false, acceptDelivery: false, settleCash: false, grantCredit: false, openClose: false },
      servicePolicy: { noticesWaitingGuests: false, priority: 0, refusalCondition: "不会替酒馆安排客房或动用后厨" },
      knowledgeBoundary: {
        knownActorIds: [],
        hearsayActorIds: ["char_xyy_xiezenshi"],
        identityUnknownActorIds: ["char_xyy_xiezenshi"],
        publicFacts: ["这里是望梯酒馆，堂前允许来客进入、观察并按当下需要询问茶饭或消息"],
        privateFacts: ["自己主动接受本次来访并持有拜帖", "拜帖给谢真石所属的梯云宗而非酒馆", "只知道谢真石的姓名和传闻，不知道他的长相", "接引人和后续目的地均未知"],
      },
      expression: { roleLabel: "来访弟子", actionBias: "先从可见布局、声音和人物行为中取证；消费、询问、落座或离开都由本人按当下需要决定" },
      visitPolicy: {
        kind: "self_directed",
        arrivalTrigger: "self_committed_visit",
        arrivalMotive: "本人主动接受来访并完成路程，佩着剑、把拜帖收在随身行囊中，进入望梯酒馆打探尚未具体确认的消息",
        travelCostSlots: 0,
        purpose: "在不预设情报目标的前提下，从本人能观察或询问到的内容中打探消息",
        expectedHostIds: [],
        requestedService: "none",
        paymentMode: "none",
        purposeDisclosureRequired: false,
        hostReceptionRequired: false,
        completionCondition: "本人决定离开并完成离场；后来若自行建立茶饭或其他交易，则只按真实进度另行结算",
        carriedObjectIds: ["luozhao_sword", "luozhao_yuheng_visit_letter"],
        carriedObjectLabel: "贴身佩剑与玉衡宗拜帖",
        arrivalCue: "佩着剑、把拜帖收在随身行囊中，刚跨入门槛",
        purposeZoneIds: ["hall"],
        allowedZoneIds: ["threshold", "hall"],
      },
    },
  },
  char_xyy_yanzhizhong: {
    simulationTier: "visitor",
    role: "经过酒馆收取消息和候选记录的掌籍长老",
    schedule: ["正午", "午后"],
    copingStyle: "把争议压回可复核的记录；没有证据便不盖印",
    inertia: 16,
    activities: { duty: "核对酒馆账板旁留下的名录消息", personal: "观察名录是否漏掉不合直路的人", routine: "喝半碗茶并把纸页压平" },
    commitments: ["只把本人核验过的实绩写进今日候选名录"],
    privatePursuit: "核验三名候选的真实剑术记录并完成今日名录",
    refusal: "拒绝私下买卖或提前承诺候选名额",
    tavernAgency: {
      version: 1,
      standing: "tea_guest",
      placeRelationship: "他是来取候选消息、喝茶并按碗结账的公务熟客，不拥有柜台后的任何权限。",
      responsibilities: ["说明要核对的名录", "茶钱当场结清", "不让公务占住所有堂前座位"],
      authority: { receiveGuest: false, serveMeal: false, serveTea: false, acceptDelivery: false, settleCash: false, grantCredit: false, openClose: false },
      servicePolicy: { noticesWaitingGuests: false, priority: 0, refusalCondition: "不会替掌柜接客或替候选人承诺名额" },
      knowledgeBoundary: {
        knownActorIds: ["char_xyy_xiezenshi", "char_xyy_xieheng", "char_xyy_xiemu", "char_xyy_zhoumin"],
        publicFacts: ["谢恒是东家", "谢母是掌柜", "一碗茶一枚铜钱"],
        privateFacts: ["知道名录内容", "不知道酒馆家计和住客私事"],
      },
      expression: { roleLabel: "来核名录的茶客", actionBias: "先把来意交代清楚，再展开纸页" },
      visitPolicy: {
        kind: "business",
        purpose: "核对酒馆留下的候选留宿与接引登记",
        expectedHostIds: ["char_xyy_xieheng", "char_xyy_xiemu"],
        requestedService: "tea",
        paymentMode: "cash",
        completionCondition: "茶送到、名录核完、茶钱结清",
        arrivalTrigger: "pending_candidate_notice",
        arrivalMotive: "收到真实的候选留宿登记后，到酒馆逐项核验",
        travelCostSlots: 0,
        purposeAction: "把待核候选的留宿与接引登记同酒馆记录逐项对清",
        purposeZoneIds: ["hall"],
        allowedZoneIds: ["threshold", "hall"],
        carriedObjectLabel: "掌籍名录和待核纸页",
        carriedObjectIds: ["tavern_registry_pages"],
        arrivalCue: "袖中夹着掌籍名录和待核纸页，站在门槛内",
        frequencyDays: 4,
        dayOffset: 2,
      },
    },
  },
  char_xyy_chenyan: {
    simulationTier: "visitor",
    role: "常在冷清时段用收桌和劈柴换热饭的榜末弟子",
    schedule: ["清晨", "正午", "午后"],
    copingStyle: "把受伤吞回下一次重复，不求鼓励也不接受别人替他算快慢",
    inertia: 28,
    activities: { duty: "收空碗并把冷灶灰筛净", personal: "在角落记下并完成今日基础剑式次数", routine: "磨墨、记数、擦掉错痕" },
    commitments: ["完成掌柜分派的杂务再领饭", "把今天一百次基础剑式逐次记进练功册"],
    privatePursuit: "靠自己做完杂务换到今天的热饭，再完成一百次基础剑式",
    refusal: "拒绝别人替他把尚未完成的一步判作无用",
    tavernAgency: {
      version: 1,
      standing: "work_exchange_guest",
      placeRelationship: "他是靠收桌、筛灶灰和劈柴换一碗饭的熟客；做完约定的活才算付清。",
      responsibilities: ["先向掌柜确认今天缺哪项活", "完成约定杂务", "不把堂前工具当自己的东西"],
      authority: { receiveGuest: false, serveMeal: false, serveTea: false, acceptDelivery: false, settleCash: false, grantCredit: false, openClose: false },
      servicePolicy: { noticesWaitingGuests: false, priority: 0, refusalCondition: "不会替店家赊账或擅自从灶边取饭" },
      knowledgeBoundary: {
        knownActorIds: ["char_xyy_xiezenshi", "char_xyy_xieheng", "char_xyy_xiemu"],
        publicFacts: ["谢恒是东家", "谢母是掌柜", "自己以一段杂务换一碗饭"],
        privateFacts: ["只知道被分给自己的活", "不知道钱箱和外账"],
      },
      expression: { roleLabel: "以工换饭的熟客", actionBias: "先问清今天换饭的活，再低头做完" },
      visitPolicy: {
        kind: "work_exchange",
        arrivalTrigger: "self_committed_visit",
        arrivalMotive: "用自己做完的一段杂务换到今天的热饭",
        travelCostSlots: 0,
        purpose: "做一段堂前杂务换一碗热饭",
        expectedHostIds: ["char_xyy_xiemu", "char_xyy_xiezenshi"],
        requestedService: "work_meal",
        paymentMode: "work_exchange",
        completionCondition: "掌柜或店伙验过杂务，热饭送到，交换两清",
        frequencyDays: 2,
        dayOffset: 1,
      },
    },
  },
};

const XIAOYA_YOU_CHARACTER_PHYSIOLOGIES = {
  char_xyy_luozhao: {
    authority: "author-confirmed-character-embodiment",
    sustenance: {
      mode: "long_fasting_low_mundane_need",
      authorBand: "能长时间不食，凡食仍有很低但非零的恢复作用",
      numericAuthority: "engine-operational-range-from-author-band",
      authorNumericCalibration: "unassigned",
      ordinaryFoodDependenceRange: [0.08, 0.2],
      ordinaryFoodRecoveryEfficiencyRange: [0.12, 0.3],
      basalHungerGrowthRange: [0.08, 0.2],
      exertionHungerCouplingRange: [0.1, 0.26],
      spiritualFoodConversionRange: [0.84, 0.98],
      fastingToleranceBand: "long",
      alternativeSustenanceSources: ["cultivation_energy"],
      exceptions: ["重伤、灵力枯竭或特殊功法后果可以改变当下补给需求，但必须由真实状态触发"],
    },
  },
};

function mergeMaterialEconomyFoundation(base = {}, foundation = null) {
  if (!foundation || typeof foundation !== "object") return deepClone(base);
  return {
    ...deepClone(base),
    ...deepClone(foundation),
    initialWallet: deepClone(base.initialWallet || {}),
    access: { ...deepClone(base.access || {}), ...deepClone(foundation.access || {}) },
    currencyAccess: { ...deepClone(base.currencyAccess || {}), ...deepClone(foundation.currencyAccess || {}) },
    consumptionPreferences: {
      ...deepClone(base.consumptionPreferences || {}),
      ...deepClone(foundation.consumptionPreferences || {}),
    },
    categoryKnowledge: { ...deepClone(base.categoryKnowledge || {}), ...deepClone(foundation.categoryKnowledge || {}) },
  };
}

function buildTavernLifeProfile(seed, index) {
  const source = XIAOYA_YOU_TAVERN_LIFE[seed.id] || {};
  const baseMaterialEconomy = XIAOYA_YOU_CHARACTER_MATERIAL_ECONOMIES[seed.id] || {
    wealthBand: "unanchored",
    materialPosition: "尚未建立财富来源、实际钱包与消费倾向。",
    initialWallet: { currencyId: "copper_wen", amount: 0, sourceId: "unanchored_wallet" },
    access: { reserveMode: "none_known", reserveDescription: "没有可安全假定的额外钱财", businessTillAccess: false, institutionalSupport: false },
    sources: [],
    obligations: [],
    consumptionPreferences: {
      priceSensitivity: [0.4, 0.6],
      qualitySensitivity: [0.4, 0.6],
      statusDisplayDrive: [0.4, 0.6],
      wasteAversion: [0.4, 0.6],
      bargainingWillingness: [0.4, 0.6],
      transactionPatience: [0.4, 0.6],
    },
    categoryKnowledge: {},
  };
  const validatedRuntime = findValidatedCharacterAnchorRuntime(seed.id, { sceneId: "scene_xyy_wangti_tavern" });
  const materialEconomy = mergeMaterialEconomyFoundation(
    baseMaterialEconomy,
    validatedRuntime?.characterFoundation?.materialEconomy || null,
  );
  const authoredPhysiology = validatedRuntime?.characterFoundation?.physiology
    || XIAOYA_YOU_CHARACTER_PHYSIOLOGIES[seed.id]
    || { authority: "world-operational-default", sustenance: { mode: "ordinary_food_dependent" } };
  const physiology = {
    ...deepClone(authoredPhysiology),
    sustenance: normalizeCultivationSustenanceProfile(authoredPhysiology.sustenance || {}),
  };
  return {
    simulationTier: source.simulationTier || "visitor",
    role: source.role || `${seed.name}会按自己的时辰来到望梯酒馆。`,
    schedule: [...(source.schedule || ["正午"])],
    copingStyle: source.copingStyle || "先完成眼前的事，再决定是否回应。",
    inertia: Number(source.inertia) || 14,
    activities: { duty: "完成当天答应的事", personal: seed.visible, routine: "坐下、观察、再离开", ...(source.activities || {}) },
    commitments: [...(source.commitments || [])],
    privatePursuit: source.privatePursuit || seed.desire,
    refusal: source.refusal || seed.responseBoundary || "拒绝让别人替自己决定下一步。",
    materialEconomy: deepClone(materialEconomy),
    physiology,
    tavernAgency: deepClone(source.tavernAgency || {
      version: 1,
      standing: "visitor",
      placeRelationship: `${seed.name}按自己的来意进入望梯酒馆，但不拥有店内权限。`,
      responsibilities: [],
      authority: {},
      servicePolicy: { noticesWaitingGuests: false, priority: 0 },
      knowledgeBoundary: { publicFacts: ["谢恒是东家", "谢母是掌柜"], privateFacts: [] },
      expression: { roleLabel: "来客", actionBias: "先说明来意" },
    }),
    activationWeight: source.simulationTier === "core" ? 100 : 35 + index * 3,
  };
}

function ecologyDesireLabel(ecologyProfile = null) {
  const desire = ecologyProfile?.desires?.[0];
  if (!desire) return "";
  return `${desire.desiredState?.verb || ""}${desire.desiredState?.object || desire.target?.label || ""}`.trim();
}

function buildInitialLifeState(seed, index, profile, ecologyProfile = null) {
  const visitPolicy = profile.tavernAgency?.visitPolicy || null;
  const visitTrigger = visitPolicy?.arrivalTrigger || "self_committed_visit";
  const initialWallet = profile.materialEconomy?.initialWallet || {};
  const initialCoins = Math.max(0, Number(initialWallet.amount || 0));
  const sustenance = operationalSustenanceFactors(profile.physiology?.sustenance || {});
  const ordinaryHungerBaseline = Math.max(
    4,
    Math.round((28 + (index * 9) % 34) * sustenance.ordinaryFoodDependence),
  );
  return {
    schemaVersion: 2,
    present: profile.simulationTier === "core",
    needs: {
      hunger: ordinaryHungerBaseline,
      fatigue: 24 + (index * 11) % 38,
      social: 20 + (index * 7) % 42,
      safety: 18 + (index * 5) % 30,
      autonomy: 26 + (index * 13) % 36,
    },
    resources: {
      coins: initialCoins,
      wallet: {
        currencyId: initialWallet.currencyId || "copper_wen",
        amount: initialCoins,
        sourceId: initialWallet.sourceId || "unanchored_wallet",
      },
      mealCredit: profile.simulationTier === "core" ? 1 : 0,
    },
    activeGoal: ecologyDesireLabel(ecologyProfile) || profile.privatePursuit || seed.desire,
    hiddenAgenda: profile.privatePursuit,
    currentActivity: {
      id: `activity:${seed.id}:initial`,
      type: profile.simulationTier === "core" ? "duty" : "routine",
      description: profile.simulationTier === "core" ? profile.activities.duty : profile.activities.routine,
      status: "active",
      progress: 0,
      remainingTicks: 1,
    },
    appraisal: "今天尚未发生需要重新解释的事。",
    lastChoiceReason: "先沿着已经形成的习惯开始。",
    consecutiveActivityTicks: 0,
    situationalRole: profile.tavernAgency?.expression?.roleLabel || profile.tavernAgency?.standing || "在场者",
    activeVisitId: "",
    visitPurpose: "",
    ...(profile.simulationTier === "visitor" && visitPolicy ? {
      visitIntention: {
        id: `visit_intention:${seed.id}:initial`,
        ownerCharacterId: seed.id,
        destinationLocationId: "loc_xyy_tavern",
        motive: visitPolicy.arrivalMotive || visitPolicy.purpose || profile.privatePursuit,
        trigger: visitTrigger,
        status: visitTrigger === "pending_candidate_notice" ? "waiting_trigger" : "committed",
        committedAtSlotIndex: visitTrigger === "pending_candidate_notice" ? null : 0,
        triggerEvidenceIds: [],
        travelCostSlots: Math.max(0, Number(visitPolicy.travelCostSlots || 0)),
        source: "character-initial-condition",
      },
      returnIntentions: [],
    } : {}),
  };
}

function createInitialTavernState(locationId = "loc_xyy_tavern") {
  return {
    schemaVersion: 9,
    locationId,
    day: 0,
    tick: 0,
    open: true,
    weather: "薄云",
    perceptionEnvironment: {
      schemaVersion: 1,
      authority: "world-state",
      light: 0.82,
      ambientNoise: 0.18,
      modalityTransmission: {
        visual: 1,
        sound: 1,
        smell: 1,
        touch: 1,
        vibration: 1,
        proprioception: 1,
      },
    },
    stock: {
      grain: 16,
      meals: 18,
      meatPortions: 6,
      tea: 24,
      houseTea: 8,
      fineTea: 3,
      firewood: 20,
      water: 30,
      rooms: 3,
    },
    cashBox: 36,
    pricePressure: 0,
    recentMicroEvents: [],
    lastActivities: [],
    pendingRequests: [],
    serviceProcesses: [],
    servicePreparationEnvironment: {
      stations: {
        stove: {
          zoneId: "stove",
          heatSourceId: "tavern_stove_fire",
          heatState: "simmering",
          heatReady: true,
          lastChangedByActionId: "world-initial-open-stove",
        },
      },
    },
    institution: deepClone(XIAOYA_YOU_TAVERN_INSTITUTION),
    activeVisits: [],
    visits: [],
    ledger: [],
    eventThreads: [],
    candidateNotices: [],
    workOrders: [],
    objectLedger: mergeObjectTemplates({
      ledger: { schemaVersion: 1, objects: {}, heldByActor: {}, heldByCharacter: {} },
      templates: XIAOYA_YOU_TAVERN_INSTITUTION.objectTemplates,
      sceneId: locationId,
    }),
  };
}

function makePlayableCharacter(seed, index, blueprint) {
  const desire = clampNumber(58 + (index * 7) % 24);
  const shame = clampNumber(46 + (index * 11) % 34);
  const defenseLanguage = seed.speechProfile ? [] : seed.defenseLanguage || defaultDefenseLanguage(seed, blueprint);
  const selfLie = seed.currentSelfLie || (seed.speechProfile ? seed.selfMyth : defaultSelfLie(seed, blueprint, defenseLanguage));
  const agentProfile = buildAgentProfileForSeed({ ...seed, defenseLanguage }, index, blueprint);
  const lifeProfile = blueprint.tavernLifeVersion ? buildTavernLifeProfile(seed, index) : null;
  const ecologyProfile = blueprint.tavernLifeVersion ? getTavernEcologyProfile(seed.id) : null;
  const lifeState = lifeProfile ? buildInitialLifeState(seed, index, lifeProfile, ecologyProfile) : null;
  const ecologyState = ecologyProfile ? createInitialEcologyState(ecologyProfile, {
    locationId: lifeProfile?.simulationTier === "core" ? "loc_xyy_tavern" : ecologyProfile.initialConditions.locationId,
    zoneId: ecologyProfile.initialConditions.zoneId,
    observableAtStage: lifeProfile?.simulationTier === "core",
  }) : null;
  return {
    id: seed.id,
    agentMemory: createValidatedCharacterAnchorMemoryState(seed.id)
      || createCharacterAgentMemoryState(seed.id),
    projectId: `proj_${blueprint.id}`,
    name: seed.name,
    generatedBySkill: dramaticCharacterSkill.name,
    agentProfile,
    publicIdentity: seed.publicIdentity,
    externalSituation: {
      dependency: seed.dependency || `依赖${blueprint.townName}里的某种承认、规则或保护。`,
      pressure: seed.pressure || `${blueprint.pressureClock}`,
      cannotEscape: seed.cannotEscape || "一旦离开当前位置，旧关系就会要求重新清算。",
    },
    internalSituation: {
      selfMyth: seed.selfMyth || "我只是按自己该做的事行动。",
      unfinishedOldRelation: seed.prehistory || "在当前时间点以前，已经有一段旧承诺、旧债或旧羞耻压住这个人。",
      inadmissibleDesire: seed.desire,
      fearOfBeingSeen: seed.shame,
      desiredJudge: agentProfile.desiredWitness,
      desiredResponse: agentProfile.desiredResponse,
      deepestShame: seed.shame,
      repeatedSelfLie: selfLie,
    },
    selfMyth: {
      believesSelfToBe: "克制、必要、比局面更清醒的人。",
      mustProveSelfToBe: "自己的行动不是私欲。",
      fearsActuallyBeing: "借规则或关系索取位置的人。",
      destroyerOfMyth: "被别人指出行动里的私欲。",
      sacrificeForMyth: "愿意牺牲解释机会来维持形象。",
    },
    actionLines: {
      visible: seed.visible,
      desire: seed.desire,
      defense: seed.defense || defaultDefenseLine(seed, blueprint),
      shadow: seed.shadow || "用看似正当的行动迫使别人回应自己。",
    },
    desireLag: {
      firstAppearsAs: "一个看起来合理的小动作。",
      firstEnjoyment: "发现别人正在等待自己的判断。",
      moralDelayMoment: "意识到自己从局面里得到了位置。",
      shameTransferTarget: "最接近真相的人。",
      desireReturnForm: "更温和也更精确的控制。",
    },
    shameMechanism: {
      shameTrigger: ["被看穿", "旧事被提起", "别人拒绝自己的命名"],
      convertsInto: ["沉默", "辩护", "试探", "转移话题"],
      attacksWhom: "那个让自己失去解释优势的人。",
      asksForgivenessFrom: "被自己拖进局面的人。",
    },
    defenseLanguage,
    speechProfile: seed.speechProfile || null,
    shadowActions: ["试探", "拖延", "逼问", "误导", "沉默"],
    nobleActions: ["承认自己的私心", "替弱者挡住粗暴结论", "放弃有利解释"],
    vileActions: ["用正当理由伤害别人", "把对方变成自我证明", "让沉默替自己惩罚别人"],
    innerCourt: {
      accusesSelfOf: "把规则当成遮羞布。",
      defendsSelfWith: "我是在让局面继续。",
      hiddenEvidence: seed.desire,
      desiredJudge: agentProfile.desiredWitness,
      desiredResponse: agentProfile.desiredResponse,
      resentsJudgeBecause: "被看穿会失去体面位置。",
      wants: agentProfile.desiredResponse,
    },
    actionVerbs: {
      visible: splitVisibleActionVerbs(seed, index, blueprint),
      hidden: ["试探", "索取", "逃避", "确认", "控制"],
      defense: ["合理化", "责任化", "慈悲化", "现实化", "切割"],
      shadow: ["胁迫", "拖住", "诱导", "遮掩", "消音"],
    },
    triggers: {
      desire: ["别人停下来等自己", "核心物件出现", "旧承诺被提起"],
      shame: ["被看穿", "被比较", "旧债被说出口"],
      rage: ["别人拒绝自己的安排", "自己失去解释权"],
      nobility: ["无辜者可能受伤", "粗暴结论会毁掉复杂性"],
      collapse: ["公开承认自己从局面中获益"],
      lie: ["我只是没有别的办法", "这是规矩", "这对大家都好"],
      selfDestruction: ["让所有人看见自己的私欲"],
    },
    relationshipRules: {
      approachesBy: "提供判断、保护、规矩或实际帮助。",
      withdrawsBy: "退回沉默、职责或旧身份。",
      testsBy: "看对方是否接受自己的命名。",
      lovesBy: "减少对方被粗暴处理的程度。",
      punishesBy: "把对方赶回被安排的位置。",
      asksForgivenessBy: "承认自己也在索取。",
      refusesForgivenessBy: "继续说没有别的办法。",
    },
    irreversibleBoundaries: seed.boundaries || ["公开拆穿旧关系", "让秘密进入公共场合", "承认自己从别人失位中获益"],
    currentState: {
      desire,
      shame,
      rage: clampNumber(28 + (index * 9) % 38),
      love: clampNumber(34 + (index * 5) % 32),
      disgust: clampNumber(18 + (index * 8) % 42),
      selfDeception: clampNumber(55 + (index * 10) % 30),
      selfDestruction: clampNumber(8 + (index * 6) % 30),
      protectionImpulse: clampNumber(36 + (index * 7) % 36),
      revengeImpulse: clampNumber(12 + (index * 8) % 32),
      currentSelfLie: selfLie,
    },
    ...(lifeProfile ? {
      lifeProfile,
      lifeState,
      ...(ecologyProfile ? {
        psychologyAnchor: deepClone(ecologyProfile.psychologyAnchor),
        ecologyProfileId: ecologyProfile.characterId,
        ecologyProfileVersion: ecologyProfile.schemaVersion,
        ecologyState,
      } : {}),
      currentLocationId: lifeProfile.simulationTier === "core" ? "loc_xyy_tavern" : ecologyProfile?.initialConditions?.locationId || "loc_xyy_tavern",
      currentActivity: lifeState.currentActivity,
    } : {}),
  };
}

function defaultDefenseLine(seed, blueprint) {
  if (blueprint.id === "xiaoyaoyou") return "把渴望改名为成绩、举荐、家计、修行或一步不能停。";
  if (blueprint.id === "xianxia_neutral_city") return "把私欲改名为城规、庇护、审案、交易或停剑令。";
  return "把欲望改名为责任、慈悲、忠诚、现实或规矩。";
}

function defaultDefenseLanguage(seed, blueprint) {
  const byName = {
    沈珩: ["按城法扣契，不按宗门私仇。", "剑可以停，证据不能走。", "让照骨司先验。"],
    阎无咎: ["买卖在城规里，别把血仇带进来。", "我押的是灵契，不是命。", "价码到了，旧案自然开口。"],
    鹿青萝: ["进了医坊，先救命，后审案。", "庇护牌还亮着，谁也不能拖人。", "药炉前不问正邪。"],
    阿照: ["镜面只记灵痕，不替谁认罪。", "案卷未封，谁也不能带走。", "我只照见写下来的东西。"],
    敖霁: ["渡令未清，谁也不能下水。", "归墟渡不替任何一派开路。", "水阵拦的是破禁，不是人。"],
    孟槐: ["死人还没说完，活人先别定案。", "魂灯在这里，供词就不能被买走。", "我递的是供词，不是威胁。"],
    闻夏: ["停剑令还在，谁先拔剑谁先破禁。", "照骨司问供，不替宗门复仇。", "城法只认灵痕和供词。"],
  };
  if (byName[seed.name]) return byName[seed.name];
  if (blueprint.id === "xianxia_neutral_city") return ["停剑令还在。", "先押灵契，再谈旧仇。", "城法不替任何一派开口。"];

  const roleText = [
    seed.name,
    seed.publicIdentity,
    seed.desire,
    seed.shame,
    seed.visible,
  ].join(" ");
  const text = [
    roleText,
    blueprint.summary,
    blueprint.background,
    ...(blueprint.publicRules || []),
    ...(blueprint.hiddenRules || []),
  ].join(" ");
  const objects = blueprint.recurringObjects || [];
  const centers = blueprint.powerCenters || [];
  const object = findTerm(objects, /氧气|灵契|账本|配额|债契|钥匙|戒指|闹钟|经卷|虎符/) || objects[0] || "凭证";
  const secondObject = findTerm(objects, /闸|章|证|记录|血样|药|牌|灯|箱|文牒|印/) || objects[1] || object;
  const center = findTerm(centers, /闸|门|码头|舱|工厂|柜台|餐桌|渡口|法庭|档案/) || centers[0] || blueprint.townName || "这里";

  if (/圣女|信徒|神圣|祭司|祈祷|庇护/.test(roleText)) {
    return uniqueLines([
      `${findTerm(centers, /祈祷|舱|寺|教堂|庇护/) || center}里先给人留一口气。`,
      `${object}不能替${findTerm(objects, /公司|税|账|规|章/) || "强者"}关门。`,
      "编号可以亮，人不能被拖走。",
    ]);
  }

  if (/监察|税|公司|账本|配额|盖章|通行|官|掌管/.test(roleText)) {
    return uniqueLines([
      `${object}先入账，再谈通行。`,
      `${findTerm(objects, /公司|账本|配额|名单|记录/) || "公司记录"}没打开，谁也别领下一轮${object}。`,
      `${secondObject}不是人情，是检查凭证。`,
    ]);
  }

  if (/工程|修理|工匠|闸|水压|阀|线路|工厂/.test(roleText)) {
    return uniqueLines([
      `水压警铃响之前，谁也别碰${findTerm(objects, /闸|阀|线路|章/) || center}。`,
      `${findTerm(objects, /阀|闸|线路|工厂|藻类/) || secondObject}还没稳，${object}先放下。`,
      `${findTerm(centers, /工厂|闸|厂/) || center}停一刻，整条街就少一口气。`,
    ]);
  }

  if (/医生|医坊|诊|药|血样|鱼人|病人|伤/.test(roleText)) {
    const bodyObject = findTerm(
      (objects || []).filter((term) => !/氧气|公司|税|配额|账/.test(String(term || ""))),
      /血样|鱼人|药剂|药|样|病/,
    ) || secondObject;
    return uniqueLines([
      `诊床前先救人，再查${bodyObject}。`,
      `${bodyObject}不是证物，还在流血。`,
      "灯关上之前，谁也别碰病人的袖口。",
    ]);
  }

  if (/走私|潜水|出闸|偷|黑市|欠债|逃|船|渡/.test(roleText)) {
    return uniqueLines([
      `${object}可以留下，人先过${findTerm(centers, /闸|渡|门|港|码头/) || "这道口"}。`,
      "我卖的是一条路，不是他们的命。",
      `${secondObject}别交给${findTerm(objects, /公司|税|账/) || "收账的人"}。`,
    ]);
  }

  if (/推销|车次|债务|家人|父亲|母亲|妹妹|哥哥|账|房门|餐桌|小提琴/.test(text)) {
    return uniqueLines([
      `${object}先别收走，门里还有人没开口。`,
      `${center}不是账本上的空格。`,
      `${secondObject}可以查，但别替家里下结论。`,
    ]);
  }

  return uniqueLines([
    `${object}先留在${center}。`,
    `${secondObject}没有归属前，谁也别改口。`,
    `${blueprint.powerCenters?.[0] || blueprint.townName || "这里"}还没盖下最后一道章。`,
  ]);
}

function defaultSelfLie(seed, blueprint, defenseLanguage = []) {
  const line = (defenseLanguage || []).find(Boolean) || defaultDefenseLanguage(seed, blueprint)[0] || "东西先留在这里。";
  return String(line).replace(/[。！？]+$/g, "。");
}

function findTerm(terms = [], pattern) {
  return (terms || []).find((term) => pattern.test(String(term || ""))) || "";
}

function uniqueLines(lines = []) {
  const result = [];
  for (const raw of lines) {
    const line = String(raw || "").replace(/\s+/g, "").trim();
    if (!line || result.includes(line)) continue;
    result.push(/[。！？]$/.test(line) ? line : `${line}。`);
  }
  return result.slice(0, 3);
}

function makePlayableLocation(seed, index, characters, blueprint) {
  return {
    id: seed.id,
    projectId: `proj_${blueprint.id}`,
    name: seed.name,
    visibleUse: seed.visibleUse,
    hiddenUse: "让公开身份和隐藏欲望互相碰撞。",
    frequentCharacters: characters.slice(index, index + 3).concat(characters.slice(0, 2)).slice(0, 4).map((character) => character.id),
    fearedBy: characters.slice(-2).map((character) => character.id),
    oldWound: "这里已经发生过一次没有说清的旧事。",
    likelyEvents: seed.likelyEvents,
    exposes: ["谁拥有解释权", "谁被迫等待", "谁用规则遮住欲望"],
    powerRule: "谁能决定这里发生了什么，谁就暂时控制别人下一步行动。",
    subtext: seed.subtext || "这里没有旁观者，只有暂时还没开口的人。",
    ...(seed.locationRules || {}),
  };
}

function buildPlayableRelationships(seedRelationships, characters, worldId) {
  const calibrated = buildCalibratedTavernRelationships(seedRelationships, characters, worldId);
  if (calibrated) return calibrated;
  const seeds = seedRelationships.length ? seedRelationships : defaultRelationSeeds(characters);
  return seeds.map((seed, index) => {
    const from = characters.find((character) => character.id === seed.from) || characters[index % characters.length];
    const to = characters.find((character) => character.id === seed.to) || characters[(index + 1) % characters.length];
    return {
      id: `rel_${worldId}_${index + 1}`,
      projectId: `proj_${worldId}`,
      fromCharacterId: from.id,
      toCharacterId: to.id,
      label: seed.label || "关系压力",
      love: clampNumber(28 + (index * 9) % 46),
      attraction: clampNumber(8 + (index * 7) % 30),
      resentment: clampNumber(24 + (index * 11) % 48),
      fear: clampNumber(18 + (index * 13) % 48),
      dependence: clampNumber(32 + (index * 7) % 46),
      power: clampNumber(35 + (index * 17) % 44),
      shame: clampNumber(28 + (index * 10) % 48),
      jealousy: clampNumber((index * 9) % 34),
      protection: clampNumber(18 + (index * 8) % 48),
      revenge: clampNumber((index * 7) % 38),
      deception: clampNumber(24 + (index * 12) % 48),
      misreading: `${from.name}把${to.name}的行动读成自己必须回应的信号。`,
      wantsToBeSeen: clampNumber(28 + (index * 14) % 54),
      wantsToPossess: clampNumber(8 + (index * 10) % 38),
      wantsToEscape: clampNumber(18 + (index * 9) % 48),
      wantsToDestroy: clampNumber((index * 8) % 34),
      unspoken: seed.pressure || `${from.name}和${to.name}之间有一件旧事不能直接说。`,
      evidenceIds: [],
    };
  });
}

function buildGeneratedDirective(blueprint, worldPrompt, peoplePrompt) {
  return [
    `世界：${worldPrompt || blueprint.summary}`,
    `人物：${peoplePrompt || blueprint.characters.map((character) => character.name).join("、")}`,
    `今天从${blueprint.townName}开始。远处只留下脚步、物件和传闻；被盯住的地方会露出行动、回应和对白。`,
  ].join("\n");
}

function characterSeed(id, name, publicIdentity, desire, shame, visible, options = {}) {
  return { id, name, publicIdentity, desire, shame, visible, ...options };
}

function locationSeed(id, name, visibleUse, likelyEvents, subtext = "", locationRules = null) {
  return { id, name, visibleUse, likelyEvents, subtext, ...(locationRules ? { locationRules } : {}) };
}

function relationSeed(from, to, label, pressure) {
  return { from, to, label, pressure };
}

function defaultRelationSeeds(characters) {
  return characters.map((character, index) => {
    const next = characters[(index + 1) % characters.length];
    return relationSeed(character.id, next.id, "旧关系 / 误读", `${character.name}和${next.name}之间的旧关系会推动行动。`);
  });
}

function guessCharacterName(text, index) {
  const clean = String(text || "")
    .replace(/^一个|^一位|^几位|^几个/g, "")
    .replace(/^欠债的/g, "")
    .replace(/^被.*?供奉的/g, "")
    .replace(/^掌管.*?的/g, "")
    .replace(/^修理.*?的/g, "")
    .replace(/^藏着.*?的/g, "")
    .replace(/^非法/g, "")
    .replace(/的人$/g, "")
    .trim();
  const roleMatch = clean.match(/([^，、。；;\s]{2,10}(?:走私者|监察官|圣女|工程师|医生|税官|潜水员|修士|使者|妖医|镜灵|龙裔|鬼修|执法者|旁观者|者|官|师|人))$/);
  if (roleMatch?.[1]) return roleMatch[1];
  if (clean.length <= 8) return clean;
  const cleanHead = clean.slice(0, 8);
  if (cleanHead) return cleanHead;
  return clean || `人物${index + 1}`;
}

function splitVisibleActionVerbs(seed = {}, index = 0, blueprint = {}) {
  const verbs = String(seed.visible || "")
    .split(/[、，,。；;]/)
    .map((item) => item.trim())
    .filter(isPlayableVisibleVerb);
  if (verbs.length >= 3) return verbs.slice(0, 5);
  return inferVisibleActionVerbs(seed, index, blueprint);
}

function isPlayableVisibleVerb(text = "") {
  const value = String(text || "").trim();
  if (!value) return false;
  if (/(服|制服|长袍|面容|徽章|靴|划痕|腰挂|手持|手中常握|如同|闪烁|旧款|颜色|少女)$/.test(value)) return false;
  return /靠近|远离|进入|离开|等待|停|问|询|说|答|劝|喊|拦|挡|扣|按|压|推|递|藏|收|放|拿|打开|合上|检查|核验|记录|遮|盖|改|写|删|试|价|交易|祝祷|祈祷|合掌|诊|救|修|敲|绕|退|追|审|验|看|听/.test(value);
}

function inferVisibleActionVerbs(seed = {}, index = 0, blueprint = {}) {
  const roleText = `${seed.name || ""} ${seed.publicIdentity || ""}`;
  const text = `${roleText} ${seed.desire || ""} ${seed.shame || ""} ${seed.visible || ""}`;
  if (/圣女|祈祷|庇护|祝福|信徒|神殿|圣殿/.test(roleText)) {
    return ["合掌", "遮住凭证", "低声祝祷", "按住记录", "拦住来人"];
  }
  if (/监察官|税官|公司监察|检查员|审讯官|执法/.test(roleText)) {
    return ["检查", "拦住", "打开记录", "扣住凭证", "追问"];
  }
  if (/潜水|走私|回收员|回收|出闸|通行/.test(roleText)) {
    return ["靠近", "递暗号", "藏起凭证", "压低氧气罐", "后退"];
  }
  if (/医生|医|药|诊|伤|血样/.test(roleText)) {
    return ["诊脉", "藏起药剂", "关窗", "按住病历", "低声劝人"];
  }
  if (/工程|修理|闸|水压|阀|机器/.test(roleText)) {
    return ["检查阀门", "按住仪表", "关掉警铃", "修理管线", "拦住来人"];
  }
  if (/圣女|祈祷|庇护|祝福|信徒|结晶|神殿|圣殿/.test(text)) {
    return ["合掌", "遮住凭证", "低声祝祷", "按住记录", "拦住来人"];
  }
  if (/监察|税|公司|检查|审讯|账|记录|平板|徽章/.test(text)) {
    return ["检查", "拦住", "打开记录", "扣住凭证", "追问"];
  }
  if (/潜水|走私|回收|出闸|通行|逃往|绕过|暗号/.test(text)) {
    return ["靠近", "递暗号", "藏起凭证", "压低氧气罐", "后退"];
  }
  return index % 2 === 0 ? ["整理", "询问", "阻止", "转身", "靠近"] : ["等待", "试探", "改口", "离开", "遮掩"];
}

function firstClause(text = "") {
  return String(text).split(/[，,。；;\n]/).map((item) => item.trim()).find(Boolean) || "";
}

function clampNumber(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
