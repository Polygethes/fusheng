export const TAVERN_RELATIONSHIP_SEED_VERSION = 1;

export const TAVERN_RELATIONSHIP_VECTOR_FIELDS = Object.freeze([
  "love",
  "attraction",
  "resentment",
  "fear",
  "dependence",
  "power",
  "shame",
  "jealousy",
  "protection",
  "revenge",
  "deception",
  "wantsToBeSeen",
  "wantsToPossess",
  "wantsToEscape",
  "wantsToDestroy",
]);

const IDS = Object.freeze({
  xiezenshi: "char_xyy_xiezenshi",
  xieheng: "char_xyy_xieheng",
  xiemu: "char_xyy_xiemu",
  zhoumin: "char_xyy_zhoumin",
  luozhao: "char_xyy_luozhao",
  yanzhizhong: "char_xyy_yanzhizhong",
  chenyan: "char_xyy_chenyan",
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function directedKey(fromCharacterId, toCharacterId) {
  return `${fromCharacterId}->${toCharacterId}`;
}

function addressRule(allowedAddresses, addressingRule) {
  return { allowedAddresses, addressingRule };
}

const TAVERN_DIRECTED_ADDRESS_RULES = deepFreeze({
  [directedKey(IDS.xiezenshi, IDS.zhoumin)]: addressRule(["周珉", "周兄"], "同门之间称周珉或周兄，不使用家人、长老或店家称谓。"),
  [directedKey(IDS.zhoumin, IDS.xiezenshi)]: addressRule(["真石", "真石兄", "谢兄"], "同门之间称真石、真石兄或谢兄，不使用谢叔、爹等长辈称谓。"),
  [directedKey(IDS.xiezenshi, IDS.xieheng)]: addressRule(["爹"], "父子家人关系：谢真石对谢恒只称爹。"),
  [directedKey(IDS.xieheng, IDS.xiezenshi)]: addressRule(["真石", "儿子"], "父子家人关系：谢恒对谢真石称真石或儿子。"),
  [directedKey(IDS.xiemu, IDS.xieheng)]: addressRule(["当家的", "他爹", "谢恒"], "夫妻家人关系：谢母私下可称当家的或他爹，需要直呼时称谢恒。"),
  [directedKey(IDS.xieheng, IDS.xiemu)]: addressRule(["他娘", "掌柜"], "夫妻家人关系：谢恒私下称他娘，处理店务时可称掌柜。"),
  [directedKey(IDS.xiemu, IDS.xiezenshi)]: addressRule(["真石", "孩子", "儿子"], "母子家人关系：谢母对谢真石称真石、孩子或儿子。"),
  [directedKey(IDS.xiezenshi, IDS.xiemu)]: addressRule(["娘"], "母子家人关系：谢真石对谢母只称娘。"),
  [directedKey(IDS.yanzhizhong, IDS.xiezenshi)]: addressRule(["谢真石", "真石"], "长老对候选弟子称谢真石或真石。"),
  [directedKey(IDS.xiezenshi, IDS.yanzhizhong)]: addressRule(["严长老"], "弟子对掌籍长老称严长老。"),
  [directedKey(IDS.zhoumin, IDS.yanzhizhong)]: addressRule(["严长老"], "外门弟子对掌籍长老称严长老。"),
  [directedKey(IDS.yanzhizhong, IDS.zhoumin)]: addressRule(["周珉"], "掌籍长老对外门弟子称周珉。"),
  [directedKey(IDS.luozhao, IDS.yanzhizhong)]: addressRule(["严长老"], "来访弟子对接待长老称严长老。"),
  [directedKey(IDS.yanzhizhong, IDS.luozhao)]: addressRule(["洛照", "洛姑娘", "洛道友"], "接待长老对来访弟子称洛照、洛姑娘或洛道友。"),
  [directedKey(IDS.chenyan, IDS.xiezenshi)]: addressRule(["真石", "真石哥", "谢师兄"], "外门同辈对谢真石称真石、真石哥或谢师兄。"),
  [directedKey(IDS.xiezenshi, IDS.chenyan)]: addressRule(["陈砚", "陈师弟"], "谢真石对陈砚称陈砚或陈师弟。"),
  [directedKey(IDS.chenyan, IDS.yanzhizhong)]: addressRule(["严长老"], "榜上弟子对掌籍长老称严长老。"),
  [directedKey(IDS.yanzhizhong, IDS.chenyan)]: addressRule(["陈砚", "陈师弟"], "掌籍长老对陈砚称陈砚或陈师弟。"),
});

export function getTavernAddressingRule(fromCharacterId, toCharacterId) {
  const rule = TAVERN_DIRECTED_ADDRESS_RULES[directedKey(fromCharacterId, toCharacterId)];
  return rule
    ? { addressingRule: rule.addressingRule, allowedAddresses: [...rule.allowedAddresses] }
    : { addressingRule: "", allowedAddresses: [] };
}

function vector({
  love,
  attraction,
  resentment,
  fear,
  dependence,
  power,
  shame,
  jealousy,
  protection,
  revenge,
  deception,
  wantsToBeSeen,
  wantsToPossess,
  wantsToEscape,
  wantsToDestroy,
}) {
  return {
    love,
    attraction,
    resentment,
    fear,
    dependence,
    power,
    shame,
    jealousy,
    protection,
    revenge,
    deception,
    wantsToBeSeen,
    wantsToPossess,
    wantsToEscape,
    wantsToDestroy,
  };
}

function edge(fromCharacterId, toCharacterId, label, misreading, unspoken, values) {
  return { fromCharacterId, toCharacterId, label, misreading, unspoken, ...values };
}

export const TAVERN_CALIBRATED_RELATIONSHIP_SEEDS = deepFreeze([
  edge(
    IDS.xiezenshi,
    IDS.zhoumin,
    "同门 / 接受照料却回避请求",
    "谢真石容易把周珉的照料当作无需特别回应的默契，因此低估那封举荐对周珉有多重要。",
    "我确实依赖你在我力竭时留下，但我不愿让这份依赖替我决定举荐。",
    vector({ love: 50, attraction: 2, resentment: 12, fear: 5, dependence: 62, power: 32, shame: 48, jealousy: 2, protection: 44, revenge: 0, deception: 24, wantsToBeSeen: 28, wantsToPossess: 4, wantsToEscape: 30, wantsToDestroy: 0 }),
  ),
  edge(
    IDS.zhoumin,
    IDS.xiezenshi,
    "同门 / 照料、友情与未获回应",
    "周珉会把谢真石的沉默读成自己的请求不够重要，而不只是谢真石不善回应。",
    "我想让你亲口答应或拒绝，也想知道我们的友情不是只有我在维持。",
    vector({ love: 64, attraction: 3, resentment: 28, fear: 10, dependence: 52, power: 24, shame: 36, jealousy: 8, protection: 82, revenge: 2, deception: 18, wantsToBeSeen: 78, wantsToPossess: 8, wantsToEscape: 16, wantsToDestroy: 0 }),
  ),

  edge(
    IDS.xiezenshi,
    IDS.xieheng,
    "父子 / 把父亲的沉默听成要求",
    "谢真石把父亲每一句实际安排都听成继续向上的命令，很难看见其中也有恐惧和爱。",
    "我想自己决定走哪条路，却仍想听你说一次为什么希望我继续。",
    vector({ love: 58, attraction: 0, resentment: 34, fear: 20, dependence: 56, power: 22, shame: 52, jealousy: 0, protection: 28, revenge: 3, deception: 22, wantsToBeSeen: 66, wantsToPossess: 2, wantsToEscape: 42, wantsToDestroy: 0 }),
  ),
  edge(
    IDS.xieheng,
    IDS.xiezenshi,
    "父亲 / 以资源表达爱与期待",
    "谢恒会把儿子的继续修炼读成自己牺牲有意义，因而低估儿子被期待压住的程度。",
    "我想护住你的路，却不敢让你知道我为这条路交出了什么。",
    vector({ love: 78, attraction: 0, resentment: 8, fear: 48, dependence: 64, power: 66, shame: 54, jealousy: 0, protection: 86, revenge: 0, deception: 52, wantsToBeSeen: 34, wantsToPossess: 18, wantsToEscape: 26, wantsToDestroy: 0 }),
  ),

  edge(
    IDS.xiemu,
    IDS.xieheng,
    "妻子 / 照料与追问家计",
    "谢母会把谢恒的沉默读成不信任自己，而不完全知道他也在避免把牺牲变成家人的债。",
    "我想和你一起承担药钱，但前提是你把钱的来路告诉我。",
    vector({ love: 62, attraction: 18, resentment: 34, fear: 31, dependence: 56, power: 45, shame: 28, jealousy: 2, protection: 68, revenge: 1, deception: 10, wantsToBeSeen: 72, wantsToPossess: 10, wantsToEscape: 18, wantsToDestroy: 0 }),
  ),
  edge(
    IDS.xieheng,
    IDS.xiemu,
    "丈夫 / 依赖掌柜却隐瞒代价",
    "谢恒会把谢母的追问读成自己即将失去对牺牲的解释权，因此越被问越退回沉默。",
    "我知道这个家靠你维持，也正因为这样，我更不敢让你看见当票。",
    vector({ love: 68, attraction: 22, resentment: 12, fear: 38, dependence: 63, power: 46, shame: 62, jealousy: 1, protection: 72, revenge: 0, deception: 70, wantsToBeSeen: 30, wantsToPossess: 8, wantsToEscape: 48, wantsToDestroy: 0 }),
  ),

  edge(
    IDS.xiemu,
    IDS.xiezenshi,
    "母亲 / 日常照料与担心",
    "谢母容易把谢真石离开饭桌理解为又在逃避家人，也可能低估他确实需要独处和恢复。",
    "我想让你吃饱、歇够，也想让你肯在家里说一句真实感受。",
    vector({ love: 84, attraction: 0, resentment: 8, fear: 42, dependence: 48, power: 58, shame: 20, jealousy: 0, protection: 88, revenge: 0, deception: 6, wantsToBeSeen: 54, wantsToPossess: 14, wantsToEscape: 8, wantsToDestroy: 0 }),
  ),
  edge(
    IDS.xiezenshi,
    IDS.xiemu,
    "儿子 / 接受照料却藏起疲惫",
    "谢真石会把母亲的追问读成又一种停下来的要求，因此用杂务和短句避开她真正的担心。",
    "我依赖你给我的饭和安静，却不想用自己的力竭换取特殊照顾。",
    vector({ love: 72, attraction: 0, resentment: 10, fear: 12, dependence: 68, power: 18, shame: 46, jealousy: 0, protection: 52, revenge: 0, deception: 28, wantsToBeSeen: 38, wantsToPossess: 2, wantsToEscape: 36, wantsToDestroy: 0 }),
  ),

  edge(
    IDS.yanzhizhong,
    IDS.xiezenshi,
    "掌籍长老 / 尚待核验的候选",
    "严执中会把谢真石对道路的追问读成天才对现有阶梯的不耐烦，而非对阶梯本身的真实怀疑。",
    "我想亲眼核验你的实绩，也需要知道名录是否正在漏掉你的真正问题。",
    vector({ love: 22, attraction: 0, resentment: 7, fear: 28, dependence: 46, power: 76, shame: 32, jealousy: 0, protection: 44, revenge: 0, deception: 12, wantsToBeSeen: 42, wantsToPossess: 18, wantsToEscape: 10, wantsToDestroy: 0 }),
  ),
  edge(
    IDS.xiezenshi,
    IDS.yanzhizhong,
    "候选弟子 / 向制度索要道路答案",
    "谢真石会把严执中的核验读成又一次要把自己固定在名录里，因而忽略长老也可能在寻找制度遗漏。",
    "我需要你告诉我榜和剑阁之外还有什么，而不是再宣布我该走到第几层。",
    vector({ love: 16, attraction: 0, resentment: 24, fear: 36, dependence: 42, power: 20, shame: 48, jealousy: 1, protection: 12, revenge: 2, deception: 18, wantsToBeSeen: 58, wantsToPossess: 2, wantsToEscape: 38, wantsToDestroy: 0 }),
  ),

  edge(
    IDS.zhoumin,
    IDS.yanzhizhong,
    "外门弟子 / 需要举荐权的看见",
    "周珉会把长老的程序化核验读成自己仍不够格，也因此更想隐藏自己把希望押在谢真石身上。",
    "我想让你看见我已经能进内门，但不想让你把我只看成等朋友举荐的人。",
    vector({ love: 12, attraction: 0, resentment: 18, fear: 54, dependence: 78, power: 12, shame: 58, jealousy: 8, protection: 8, revenge: 1, deception: 28, wantsToBeSeen: 76, wantsToPossess: 2, wantsToEscape: 32, wantsToDestroy: 0 }),
  ),
  edge(
    IDS.yanzhizhong,
    IDS.zhoumin,
    "掌籍长老 / 有待核验的外门弟子",
    "严执中会把周珉的迟疑读成缺少实绩信心，而不完全知道他在保护友情不变成讨债。",
    "我愿意核验你留下的实绩，但不会用朋友的人情替你补齐名录。",
    vector({ love: 14, attraction: 0, resentment: 6, fear: 10, dependence: 22, power: 82, shame: 12, jealousy: 0, protection: 24, revenge: 0, deception: 8, wantsToBeSeen: 24, wantsToPossess: 4, wantsToEscape: 5, wantsToDestroy: 0 }),
  ),

  edge(
    IDS.luozhao,
    IDS.yanzhizhong,
    "来访弟子 / 正式接待关系",
    "洛照会把严执中的周全接待读成宗门程序，不会因此假定两人已有私人信任。",
    "我会完成拜访礼数，但对梯云宗弟子的判断要由我亲眼完成。",
    vector({ love: 10, attraction: 0, resentment: 5, fear: 7, dependence: 28, power: 42, shame: 12, jealousy: 0, protection: 8, revenge: 0, deception: 6, wantsToBeSeen: 18, wantsToPossess: 0, wantsToEscape: 10, wantsToDestroy: 0 }),
  ),
  edge(
    IDS.yanzhizhong,
    IDS.luozhao,
    "接待长老 / 借来访核验宗门",
    "严执中会把洛照的克制读成中州大宗的评判，而不一定看见她也在怀疑被安排好的路。",
    "我需要你的来访留下真实判断，但不能把宗门复兴的期待塞进你的结论。",
    vector({ love: 12, attraction: 0, resentment: 5, fear: 22, dependence: 45, power: 55, shame: 24, jealousy: 4, protection: 26, revenge: 0, deception: 10, wantsToBeSeen: 52, wantsToPossess: 6, wantsToEscape: 8, wantsToDestroy: 0 }),
  ),

  edge(
    IDS.chenyan,
    IDS.xiezenshi,
    "榜末弟子 / 对天才保持距离的关注",
    "陈砚会把谢真石的轻松领悟读成自己永远追不上的速度，但仍拒绝把比较当成放弃的理由。",
    "我想按自己的步数走完，不需要你鼓励，也不想被你的名声替我定义。",
    vector({ love: 24, attraction: 0, resentment: 14, fear: 12, dependence: 16, power: 18, shame: 34, jealousy: 26, protection: 12, revenge: 1, deception: 6, wantsToBeSeen: 32, wantsToPossess: 0, wantsToEscape: 18, wantsToDestroy: 0 }),
  ),
  edge(
    IDS.xiezenshi,
    IDS.chenyan,
    "天才弟子 / 尚无私交的同门",
    "谢真石可能把陈砚的反复练习只看成勤奋，尚未真正理解那种慢速坚持对陈砚意味着什么。",
    "我知道你一直在练，但我们尚没有足够共同经历让我替你评价这条路。",
    vector({ love: 12, attraction: 0, resentment: 5, fear: 4, dependence: 8, power: 38, shame: 12, jealousy: 0, protection: 18, revenge: 0, deception: 4, wantsToBeSeen: 10, wantsToPossess: 0, wantsToEscape: 8, wantsToDestroy: 0 }),
  ),

  edge(
    IDS.chenyan,
    IDS.yanzhizhong,
    "榜末弟子 / 想让记录看见真实步数",
    "陈砚会把长老按榜分配名额读成对自己缓慢的否定，即使严执中确实尊重每一次可验证实绩。",
    "我想让你看见我真实完成的每一步，并给我一次按规矩参加考核的机会。",
    vector({ love: 18, attraction: 0, resentment: 22, fear: 52, dependence: 72, power: 10, shame: 64, jealousy: 6, protection: 8, revenge: 1, deception: 8, wantsToBeSeen: 84, wantsToPossess: 2, wantsToEscape: 28, wantsToDestroy: 0 }),
  ),
  edge(
    IDS.yanzhizhong,
    IDS.chenyan,
    "记录者 / 尊重实绩但掌握名额",
    "严执中会把陈砚持续留下记录读成可靠，却仍可能低估制度把慢的人挡在机会之外的程度。",
    "我尊重你没有跳过的每一步，也必须确认名额是否能由这些实绩承担。",
    vector({ love: 26, attraction: 0, resentment: 5, fear: 14, dependence: 18, power: 84, shame: 18, jealousy: 0, protection: 46, revenge: 0, deception: 5, wantsToBeSeen: 36, wantsToPossess: 4, wantsToEscape: 5, wantsToDestroy: 0 }),
  ),
]);

export const LEGACY_TAVERN_RELATIONSHIP_EDGE_ORDER = deepFreeze([
  [IDS.xiezenshi, IDS.zhoumin],
  [IDS.xiezenshi, IDS.xieheng],
  [IDS.xiemu, IDS.xieheng],
  [IDS.xiemu, IDS.xiezenshi],
  [IDS.yanzhizhong, IDS.xiezenshi],
  [IDS.zhoumin, IDS.yanzhizhong],
  [IDS.luozhao, IDS.yanzhizhong],
  [IDS.chenyan, IDS.xiezenshi],
  [IDS.chenyan, IDS.yanzhizhong],
]);

export const LEGACY_TAVERN_RELATIONSHIP_VECTORS = deepFreeze([
  vector({ love: 28, attraction: 8, resentment: 24, fear: 18, dependence: 32, power: 35, shame: 28, jealousy: 0, protection: 18, revenge: 0, deception: 24, wantsToBeSeen: 28, wantsToPossess: 8, wantsToEscape: 18, wantsToDestroy: 0 }),
  vector({ love: 37, attraction: 15, resentment: 35, fear: 31, dependence: 39, power: 52, shame: 38, jealousy: 9, protection: 26, revenge: 7, deception: 36, wantsToBeSeen: 42, wantsToPossess: 18, wantsToEscape: 27, wantsToDestroy: 8 }),
  vector({ love: 46, attraction: 22, resentment: 46, fear: 44, dependence: 46, power: 69, shame: 48, jealousy: 18, protection: 34, revenge: 14, deception: 48, wantsToBeSeen: 56, wantsToPossess: 28, wantsToEscape: 36, wantsToDestroy: 16 }),
  vector({ love: 55, attraction: 29, resentment: 57, fear: 57, dependence: 53, power: 42, shame: 58, jealousy: 27, protection: 42, revenge: 21, deception: 60, wantsToBeSeen: 70, wantsToPossess: 38, wantsToEscape: 45, wantsToDestroy: 24 }),
  vector({ love: 64, attraction: 36, resentment: 68, fear: 22, dependence: 60, power: 59, shame: 68, jealousy: 2, protection: 50, revenge: 28, deception: 24, wantsToBeSeen: 30, wantsToPossess: 10, wantsToEscape: 54, wantsToDestroy: 32 }),
  vector({ love: 73, attraction: 13, resentment: 31, fear: 35, dependence: 67, power: 76, shame: 30, jealousy: 11, protection: 58, revenge: 35, deception: 36, wantsToBeSeen: 44, wantsToPossess: 20, wantsToEscape: 63, wantsToDestroy: 6 }),
  vector({ love: 36, attraction: 20, resentment: 42, fear: 48, dependence: 74, power: 49, shame: 40, jealousy: 20, protection: 18, revenge: 4, deception: 48, wantsToBeSeen: 58, wantsToPossess: 30, wantsToEscape: 24, wantsToDestroy: 14 }),
  vector({ love: 45, attraction: 27, resentment: 53, fear: 61, dependence: 35, power: 66, shame: 50, jealousy: 29, protection: 26, revenge: 11, deception: 60, wantsToBeSeen: 72, wantsToPossess: 40, wantsToEscape: 33, wantsToDestroy: 22 }),
  vector({ love: 54, attraction: 34, resentment: 64, fear: 26, dependence: 42, power: 39, shame: 60, jealousy: 4, protection: 34, revenge: 18, deception: 24, wantsToBeSeen: 32, wantsToPossess: 12, wantsToEscape: 42, wantsToDestroy: 30 }),
]);

function pairKey(left, right) {
  return [String(left || ""), String(right || "")].sort().join("<->");
}

function shortId(characterId) {
  return String(characterId || "").replace(/^char_xyy_/, "");
}

function numericVector(source) {
  return Object.fromEntries(TAVERN_RELATIONSHIP_VECTOR_FIELDS.map((field) => [field, Number(source[field])]));
}

export function matchesLegacyTavernRelationshipSeed(relationship, index) {
  if (!relationship || !Number.isInteger(index) || index < 0 || index >= LEGACY_TAVERN_RELATIONSHIP_VECTORS.length) return false;
  const [expectedFrom, expectedTo] = LEGACY_TAVERN_RELATIONSHIP_EDGE_ORDER[index];
  if (relationship.fromCharacterId !== expectedFrom || relationship.toCharacterId !== expectedTo) return false;
  const expected = LEGACY_TAVERN_RELATIONSHIP_VECTORS[index];
  return TAVERN_RELATIONSHIP_VECTOR_FIELDS.every((field) => Number(relationship[field]) === expected[field]);
}

export function buildCalibratedTavernRelationships(seedRelationships = [], characters = [], worldId = "") {
  if (String(worldId) !== "xiaoyaoyou") return null;
  const characterById = new Map((characters || []).filter((character) => character?.id).map((character) => [character.id, character]));
  const missingIds = [...new Set(TAVERN_CALIBRATED_RELATIONSHIP_SEEDS.flatMap((seed) => [seed.fromCharacterId, seed.toCharacterId]))]
    .filter((characterId) => !characterById.has(characterId));
  if (missingIds.length) {
    const error = new TypeError(`Missing Xiaoyaoyou tavern relationship characters: ${missingIds.join(", ")}`);
    error.code = "TAVERN_RELATIONSHIP_CHARACTER_MISSING";
    error.characterIds = missingIds;
    throw error;
  }

  const sourceSeedByPair = new Map((seedRelationships || []).filter(Boolean).map((seed) => [
    pairKey(seed.from || seed.fromCharacterId, seed.to || seed.toCharacterId),
    seed,
  ]));
  return TAVERN_CALIBRATED_RELATIONSHIP_SEEDS.map((seed) => {
    const from = characterById.get(seed.fromCharacterId);
    const to = characterById.get(seed.toCharacterId);
    const sourceSeed = sourceSeedByPair.get(pairKey(seed.fromCharacterId, seed.toCharacterId)) || {};
    return {
      id: `rel_${worldId}_${shortId(seed.fromCharacterId)}_to_${shortId(seed.toCharacterId)}`,
      projectId: `proj_${worldId}`,
      schemaVersion: TAVERN_RELATIONSHIP_SEED_VERSION,
      generatedFrom: "tavern-calibrated-directional-seed",
      fromCharacterId: seed.fromCharacterId,
      toCharacterId: seed.toCharacterId,
      fromCharacterName: from.name || shortId(seed.fromCharacterId),
      toCharacterName: to.name || shortId(seed.toCharacterId),
      label: seed.label,
      ...getTavernAddressingRule(seed.fromCharacterId, seed.toCharacterId),
      ...numericVector(seed),
      misreading: seed.misreading,
      unspoken: seed.unspoken,
      sourceSeedLabel: sourceSeed.label || "",
      sourceSeedPressure: sourceSeed.pressure || "",
      evidenceIds: [],
    };
  });
}
