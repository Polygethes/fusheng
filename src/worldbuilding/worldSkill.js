export const worldBuildingSkill = {
  name: "世界建立 Skill",
  purpose: "把用户输入的时代、地点和背景转成一个可以运行的小镇，而不是一段静态设定。",
  requiredFields: [
    "timepoint",
    "era",
    "location",
    "background",
    "baseRules",
    "ruleSets",
    "boundaries",
    "simulationClock",
    "visibilityPolicy",
    "forbiddenKnowledge",
  ],
  checkpoints: [
    "底层规则：这个世界最稳定、最难违背的交换方式是什么。",
    "规则组：公开规则、隐藏规则、惩罚规则和例外规则必须分开。",
    "边界：地理边界、社会边界、心理边界和信息边界必须明确。",
    "运行方式：时间粒度、地点轮转、后台事件和聚焦升格必须可执行。",
    "禁止预知：世界只能知道当前时间点以前的事实。",
  ],
  ruleSets: [
    "publicRules",
    "hiddenRules",
    "punishmentRules",
    "exceptionRules",
    "visibilityRules",
  ],
};

export function buildWorldSkillContract(input = {}) {
  return {
    skillName: worldBuildingSkill.name,
    input,
    requiredFields: [...worldBuildingSkill.requiredFields],
    requiredRuleSets: [...worldBuildingSkill.ruleSets],
    outputShape: {
      timepoint: input.timepoint || "",
      era: input.era || "",
      location: input.location || "",
      background: input.background || "",
      baseRules: [],
      ruleSets: {
        publicRules: [],
        hiddenRules: [],
        punishmentRules: [],
        exceptionRules: [],
        visibilityRules: [],
      },
      boundaries: {
        geographic: "",
        social: "",
        psychological: "",
        informational: "",
      },
      simulationClock: {
        defaultGrain: "day",
        backgroundPrecision: "low",
        focusPrecision: "scene",
      },
      forbiddenKnowledge: [],
    },
  };
}

export function createWorldDossierFromBlueprint(blueprint = {}, { worldPrompt = "", peoplePrompt = "" } = {}) {
  const publicRules = [...(blueprint.publicRules || [])];
  const hiddenRules = [...(blueprint.hiddenRules || [])];
  const likelyEvents = (blueprint.locations || []).flatMap((location) => location.likelyEvents || []);
  return {
    generatedBySkill: worldBuildingSkill.name,
    worldId: blueprint.id || "custom_world",
    title: blueprint.title || blueprint.townName || "未命名世界",
    townName: blueprint.townName || blueprint.title || "未命名小镇",
    genre: blueprint.genre || "戏剧沙盘",
    sourcePrompts: {
      world: String(worldPrompt || ""),
      people: String(peoplePrompt || ""),
    },
    timepoint: blueprint.timepoint || "故事开始的第一天",
    era: blueprint.era || "由用户输入决定的时代",
    location: blueprint.location || "由用户输入决定的地点",
    background: blueprint.background || blueprint.summary || "",
    baseRules: publicRules.slice(0, 3),
    ruleSets: {
      publicRules,
      hiddenRules,
      punishmentRules: [
        "破坏公开规则的人会失去可见庇护、解释权或通行权。",
        "被抓住的违例必须留下可被他人利用的证据。",
      ],
      exceptionRules: [
        "救命、避难、审讯和交易会暂时覆盖私人恩怨。",
        "弱者的庇护请求会迫使强者公开表态。",
      ],
      visibilityRules: [
        "未聚焦地点只记录谁接近、谁离开、什么物件换手。",
        "聚焦地点升格为一场戏，必须出现行动、回应、对话和关系位移。",
      ],
    },
    boundaries: {
      geographic: `${blueprint.townName || "小镇"}由${(blueprint.powerCenters || []).slice(0, 3).join("、") || "几个关键地点"}围住，离开需要通过规则节点。`,
      social: "公开身份决定一个人能进入哪里，旧债和关系决定他会被谁拦住。",
      psychological: "人物不能直接承认自己从局面里索取位置。",
      informational: "证据、谣言、契约、供词或账本会决定谁拥有解释权。",
    },
    simulationClock: {
      defaultGrain: "day",
      backgroundPrecision: "low",
      focusPrecision: "scene",
      pressureClock: blueprint.pressureClock || "一天内必须有东西换手，有人改口，有关系失衡。",
    },
    visibilityPolicy: {
      unfocused: "只保留低精度事件痕迹。",
      focused: "展开为可观察的一场戏。",
    },
    forbiddenKnowledge: [
      "不得预知当前时间点之后的剧情。",
      "不得让人物知道自己还没有发现的秘密。",
      "不得用世界规则替人物决定结果。",
    ],
    runnablePressure: {
      powerCenters: [...(blueprint.powerCenters || [])],
      recurringObjects: [...(blueprint.recurringObjects || [])],
      likelyEvents,
    },
  };
}
