export const dramaticCharacterSkill = {
  name: "戏剧人物 Skill",
  purpose: "把人物设定成能在场上行动、误读、隐藏、越界和改变的人，而不是普通身份标签。",
  minimumFields: [
    "publicIdentity",
    "externalSituation",
    "internalSituation",
    "selfMyth",
    "actionLines",
    "prehistory",
    "boundaries",
    "distinctionAxis",
    "relationshipPressure",
    "relationalNeed",
  ],
  checkpoints: [
    "戏剧行动：人物必须有表面行动、欲望行动、防御行动和阴影行动。",
    "人物边界：人物知道什么、不能承认什么、绝不越过什么边界。",
    "前史：只写当前时间点以前的旧债、旧承诺、旧羞耻和旧关系。",
    "区分轴：每个人都要有不同的欲望、羞耻、防御语言和行动动词。",
    "关系压力：人物不是孤立心理，而是在他人目光和误读里行动。",
    "关系所求：分别写清人物想被谁看见，以及希望对方具体怎样回应。",
  ],
  forbiddenDefaults: [
    "只用身份区分人物",
    "所有人共享同一种创伤",
    "用未来剧情替代前史",
    "用解释替代可表演动作",
  ],
};

export function auditDramaticCharacter(character, cast = []) {
  if (!character) return { score: 0, missing: ["character"], distinctionAxis: [] };
  const checks = [
    ["publicIdentity", Boolean(character.publicIdentity)],
    ["externalSituation", hasKeys(character.externalSituation, ["dependency", "pressure", "cannotEscape"])],
    ["internalSituation", hasKeys(character.internalSituation, ["selfMyth", "inadmissibleDesire", "fearOfBeingSeen"])],
    ["selfMyth", hasKeys(character.selfMyth, ["believesSelfToBe", "fearsActuallyBeing"])],
    ["actionLines", hasKeys(character.actionLines, ["visible", "desire", "defense", "shadow"])],
    ["prehistory", hasAny(character.internalSituation, ["unfinishedOldRelation"]) || Boolean(character.oldWound)],
    ["boundaries", Array.isArray(character.irreversibleBoundaries) && character.irreversibleBoundaries.length > 0],
    ["distinctionAxis", buildDistinctionAxis(character, cast).length >= 3],
    ["relationshipPressure", Boolean(character.relationshipRules) || Boolean(character.innerCourt?.desiredJudge)],
    ["relationalNeed", Boolean(character.agentProfile?.desiredResponse || character.internalSituation?.desiredResponse)],
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([name]) => name);
  return {
    score: Math.round(((checks.length - missing.length) / checks.length) * 100),
    missing,
    distinctionAxis: buildDistinctionAxis(character, cast),
  };
}

export function buildAgentProfileForSeed(seed = {}, index = 0, blueprint = {}) {
  const leverageObject = inferLeverageObject(seed, index, blueprint);
  const dialogueMoves = seed.speechProfile ? [] : normalizeDialogueMoves(seed.defenseLanguage, leverageObject, blueprint);
  const desiredWitness = inferDesiredWitness(seed, leverageObject, index);
  const desiredResponse = inferDesiredResponse(seed, leverageObject, index);
  return {
    generatedBySkill: dramaticCharacterSkill.name,
    worldId: blueprint.id || "custom_world",
    publicIdentity: seed.publicIdentity || "未命名人物",
    dramaticObjective: seed.desire || "让别人承认自己的位置。",
    hiddenFear: seed.shame || "害怕失去解释权。",
    leverageObject,
    dialogueMoves,
    speechProfile: seed.speechProfile || null,
    responseBoundary: inferResponseBoundary(seed, leverageObject, blueprint),
    desiredWitness,
    desiredResponse,
    relationshipHook: `${seed.name || "这个人"}会通过${leverageObject}确认${desiredWitness}是否会给出这样的回应：${desiredResponse}`,
    distinctionAxis: [
      `目标：${seed.desire || "索取位置"}`,
      `恐惧：${seed.shame || "失去解释权"}`,
      `物件：${leverageObject}`,
      `话术：${dialogueMoves[0] || "先把东西留下"}`,
      `关系所求：${desiredResponse}`,
    ],
  };
}

function inferDesiredWitness(seed = {}, leverageObject = "手边的东西", index = 0) {
  if (seed.desiredWitness || seed.desiredJudge) return seed.desiredWitness || seed.desiredJudge;
  const fallbacks = [
    `那个愿意越过${leverageObject}听完自己要求的人。`,
    "最有权拒绝自己、却仍愿意当面回答的人。",
    "不会沿用传闻替自己下结论的人。",
    "被自己的选择直接影响、也最可能反抗的人。",
  ];
  return fallbacks[index % fallbacks.length];
}

function inferDesiredResponse(seed = {}, leverageObject = "手边的东西", index = 0) {
  if (seed.desiredResponse) return completeSentence(seed.desiredResponse);
  const fallbacks = [
    `希望对方看见${leverageObject}之后，明确承认或拒绝自己的选择。`,
    "希望对方把请求听完，不用沉默、客套或规矩把它抹掉。",
    "希望对方当面推翻或接受自己的判断，而不是重复旁人的说法。",
    `希望受影响的人说清${leverageObject}改变了什么，并决定留下还是离开。`,
  ];
  return fallbacks[index % fallbacks.length];
}

function completeSentence(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  return /[。！？]$/.test(text) ? text : `${text}。`;
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
  if (character.agentProfile?.leverageObject) axes.push(`行动物件：${character.agentProfile.leverageObject}`);
  const sameIdentity = others.some((other) => other.publicIdentity === character.publicIdentity);
  if (!sameIdentity) axes.push("公开身份不同于其他人物");
  return axes;
}

function inferLeverageObject(seed = {}, index = 0, blueprint = {}) {
  const byName = {
    沈珩: "灵契",
    阎无咎: "魔印",
    鹿青萝: "庇护牌",
    阿照: "照骨镜",
    敖霁: "渡令",
    孟槐: "魂灯",
    闻夏: "城令",
    格里高尔: "车次表",
    格蕾特: "小提琴",
    父亲: "账本",
    母亲: "餐具",
    唐僧: "通关文牒",
    孙悟空: "金箍棒",
    猪八戒: "行李担",
    沙悟净: "担子",
    白骨夫人: "人形",
  };
  if (seed.leverageObject) return seed.leverageObject;
  if (byName[seed.name]) return byName[seed.name];
  const objects = blueprint.recurringObjects || ["钥匙", "纸条", "杯子", "灯"];
  return objects[index % objects.length] || "手边的东西";
}

function normalizeDialogueMoves(lines = [], leverageObject = "手边的东西", blueprint = {}) {
  const cleaned = (Array.isArray(lines) ? lines : [])
    .map((line) => String(line || "").replace(/[“”"「」]/g, "").trim())
    .filter(Boolean)
    .slice(0, 3);
  const fallback = blueprint.id === "xianxia_neutral_city"
    ? [`${leverageObject}先留下。`, "规矩还没盖印。", "人可以退，证不能走。"]
    : [`${leverageObject}先放下。`, "现在先别改口。", "话还没说完。"];
  return [...cleaned, ...fallback].slice(0, 3);
}

function inferResponseBoundary(seed = {}, leverageObject = "手边的东西", blueprint = {}) {
  if (seed.responseBoundary) return seed.responseBoundary;
  if (blueprint.id === "xianxia_neutral_city") return `${leverageObject}不能在未验明之前离开场中。`;
  if (/变形记|metamorphosis/.test(`${blueprint.id || ""} ${blueprint.title || ""}`)) return `${leverageObject}不能替人物提前知道变形之后的事。`;
  return `${leverageObject}必须迫使别人给出可见回应。`;
}
