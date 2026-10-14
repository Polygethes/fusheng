// 《借星》world pack — 藏星谷 · 顾家, the morning 小满 leaves home.
// Beacon: src/worlds/jiexing/beacon/ (世界观设定集 v0.4, 第一集 v1.2).
// See README.md for the stage choice, provisional details and protected canon.
import { defineWorldPack } from "../worldPack.mjs";
import { TAVERN_RELATIONSHIP_METRICS } from "../../server/ecology/tavernRelationshipDynamics.mjs";
import { ABAO, HESHAO, HUAISHAN, JIEXING_CAST, QINGHE, XIAOMAN } from "./cast.mjs";
import { JIEXING_LAYOUT } from "./layout.mjs";

const PLACE = "loc_jx_gu_home";
const visible = { exposure: "visible", displayedToActorIds: [], publiclyVisible: true };
const hidden = { exposure: "hidden", displayedToActorIds: [], publiclyVisible: false };
const object = (id, label, zoneId, state, extra = {}) => ({ id, label, zoneId, portable: true, state, presentation: visible, ...extra });

const metrics = (values) => Object.fromEntries(TAVERN_RELATIONSHIP_METRICS.map((id) => [id, values[id] ?? 0]));
const relation = (fromCharacterId, toCharacterId, label, values, extra) => ({ fromCharacterId, toCharacterId, label, metrics: metrics(values), ...extra });
const positionMetrics = { informationAccess: [0.5, 0.7], visualCoverage: [0.5, 0.7], socialExposure: [0.3, 0.5], approachability: [0.4, 0.6],
  trafficInterference: [0.2, 0.4], movementClearance: [0.5, 0.7], exitAccess: [0.5, 0.7], comfort: [0.4, 0.6] };

export default defineWorldPack({
  meta: {
    id: "jiexing",
    title: "借星 · 藏星谷顾家",
    language: "zh-Hans",
    source: ["借星_世界观设定集_v0.4.docx", "借星_第一集_v1.2.docx"],
    provisional: [
      "何嫂与“丫丫”之名：信标只写“被大人牵着的一个小女孩”（场景九）",
      "开场时刻定为离家当天卯时三刻，介于第一集场景十与十一之间",
      "辰时前须从石桥动身才能赶上青岚渡午时接引舟（场景十“今天中午”推出的期限）",
      "物件数值：北侧阵纹 3 段、丫丫黑纹 3 道、行囊 4 样",
      "人物技能 id（sword_affinity、array_craft、medicine 等）",
    ],
  },
  stage: {
    placeId: PLACE,
    name: "藏星谷 · 顾家",
    householdName: "顾家",
    sceneId: "scene:jx:gu-home:departure-morning",
    defaultWorldId: "world:jx:gu-home",
    topology: {
      schemaVersion: 1,
      locationId: PLACE,
      defaultZoneId: "yard",
      responsibilityRules: [],
      zones: {
        xm_room: { id: "xm_room", label: "小满房间", closed: false },
        main_room: { id: "main_room", label: "堂屋", closed: false },
        kitchen: { id: "kitchen", label: "灶间", closed: false },
        clinic: { id: "clinic", label: "药房", closed: false },
        yard: { id: "yard", label: "院子", closed: false },
        lane: { id: "lane", label: "篱笆外村道", closed: false },
        bridge: { id: "bridge", label: "石桥 · 村口", closed: false },
        array_eye: { id: "array_eye", label: "谷口阵眼", closed: false },
      },
      edges: [
        { from: "xm_room", to: "main_room", move: 1, sound: 1.5, visual: 1.5, conversation: true },
        { from: "main_room", to: "kitchen", move: 1, sound: 1, visual: 1.25, conversation: true },
        { from: "main_room", to: "clinic", move: 1, sound: 1.25, visual: 1.25, conversation: true },
        { from: "main_room", to: "yard", move: 1, sound: 1, visual: 1, conversation: true },
        { from: "clinic", to: "yard", move: 1, sound: 1.25, visual: 1.25 },
        { from: "yard", to: "lane", move: 1, sound: 1, visual: 1, conversation: true },
        { from: "lane", to: "bridge", move: 1, sound: 1.5, visual: 1 },
        { from: "lane", to: "array_eye", move: 3, sound: Infinity, visual: 2.5 },
      ],
    },
    perceptionEnvironment: { schemaVersion: 1, authority: "world-state", light: 0.7, ambientNoise: 0.22,
      modalityTransmission: { visual: 1, sound: 1, smell: 1, touch: 1, vibration: 1, proprioception: 1 } },
    sceneCast: [XIAOMAN, HUAISHAN, QINGHE, ABAO, HESHAO],
    scenePositions: { [XIAOMAN]: "xm_room", [HUAISHAN]: "main_room", [QINGHE]: "clinic", [ABAO]: "lane", [HESHAO]: "clinic" },
    dayCast: [XIAOMAN, HUAISHAN],
  },
  clock: {
    startLabel: "卯时三刻",
    defaultPacingMode: "scene",
    // Beats sized for a household morning: a look or a listen takes half a
    // minute, crossing a room a quarter, speech carries a natural pause.
    // Passing glances are noticed but wake nobody; reflection at most every
    // ten story minutes.
    sceneTimePolicy: {
      observationSeconds: 30, listeningSeconds: 30, moveSeconds: 15, speechCharactersPerSecond: 4, speechPauseSeconds: 6,
      defaultRestSeconds: 180, ambientGesturesWake: false, reflectionMinIntervalSeconds: 600,
    },
  },
  cast: JIEXING_CAST,
  relationships: [
    relation(XIAOMAN, HUAISHAN, "父子 / 想被爹看见自己能帮上忙", { love: 72, fear: 30, shame: 58, wantsToBeSeen: 78, dependence: 60, resentment: 14, protection: 40, wantsToEscape: 18, power: 20 },
      { addressingRule: "小满对顾怀山只称爹。", allowedAddresses: ["爹"], misreading: "把爹的训斥都听成“你只会闯祸”，看不见他手上的伤也是为了挡在自己前面。", unspoken: "我想帮你守阵，可我连它怎么转都不知道。", pressure: "爹嘴上数落，手上替他挡住一切；他越想证明自己，越容易闯祸。" }),
    relation(HUAISHAN, XIAOMAN, "父子 / 严里带疼", { love: 82, protection: 85, fear: 55, power: 60, shame: 26, dependence: 20 },
      { addressingRule: "顾怀山叫儿子小满，生气时连名带姓叫顾小满。", allowedAddresses: ["小满", "顾小满"], misreading: "还把他当成两年前那个躲床底的孩子。", unspoken: "我教不了你，这比你闯的祸更让我难受。", pressure: "接引符已经续上了印，他还没想好怎么开口。" }),
    relation(XIAOMAN, QINGHE, "母子 / 依恋", { love: 85, dependence: 70, protection: 30, wantsToBeSeen: 40, fear: 22 },
      { addressingRule: "小满对陆青禾只称娘。", allowedAddresses: ["娘"], unspoken: "我梦见你和房子一起没了。", pressure: "离家意味着离开娘做的饭和她的手。" }),
    relation(QINGHE, XIAOMAN, "母子 / 看穿他硬撑", { love: 88, protection: 78, power: 40, dependence: 15 },
      { addressingRule: "陆青禾叫儿子小满。", allowedAddresses: ["小满"], unspoken: "这回该让你自己走出去了。", pressure: "她要守病人，只能送到归云岭。" }),
    relation(HUAISHAN, QINGHE, "夫妻 / 一起扛事", { love: 76, dependence: 60, protection: 60, power: 35 },
      { addressingRule: "顾怀山叫妻子青禾。", allowedAddresses: ["青禾"], unspoken: "你送他，我守谷口——我其实也想送。", pressure: "两人都走不开，只能分开守。" }),
    relation(QINGHE, HUAISHAN, "夫妻 / 替他拿主意", { love: 74, protection: 55, power: 55, dependence: 40 },
      { addressingRule: "陆青禾叫丈夫怀山。", allowedAddresses: ["怀山"], unspoken: "你那双手得先养好。", pressure: "丈夫还在犹豫，她已经定了。" }),
    relation(XIAOMAN, ABAO, "玩伴 / 打赌斗嘴", { love: 60, wantsToBeSeen: 50, dependence: 30, protection: 30 },
      { addressingRule: "小满叫阿宝。", allowedAddresses: ["阿宝"], pressure: "阿宝是最后一个能说上玩笑话的人。" }),
    relation(ABAO, XIAOMAN, "玩伴 / 嘴上不饶人", { love: 62, fear: 10, wantsToBeSeen: 30, dependence: 35 },
      { addressingRule: "阿宝叫小满，赌气时叫顾大剑仙。", allowedAddresses: ["小满", "顾大剑仙"], misreading: "以为小满还是不敢出谷。", pressure: "他还不知道小满可能要走。" }),
    relation(HESHAO, XIAOMAN, "邻里 / 疑心", { fear: 30, resentment: 35, love: 20 },
      { addressingRule: "何嫂叫小满。", allowedAddresses: ["小满"], misreading: "把昨夜黑暗里看见的一个影子当成了答案。", pressure: "女儿躺在他家药房里。" }),
    relation(HESHAO, QINGHE, "病家 / 感激", { love: 50, dependence: 80, power: 10 },
      { addressingRule: "何嫂称陆青禾为陆大夫。", allowedAddresses: ["陆大夫"], pressure: "只有陆大夫的药能压住黑纹。" }),
    relation(XIAOMAN, HESHAO, "邻里 / 愧疚", { shame: 70, fear: 40, love: 25 },
      { addressingRule: "小满称何嫂。", allowedAddresses: ["何嫂"], unspoken: "丫丫是因为我才病的吗？", pressure: "她的女儿手臂上的黑纹，可能是自己昨夜闯的祸。" }),
    relation(QINGHE, HESHAO, "医者 / 安抚", { protection: 65, love: 35 },
      { addressingRule: "陆青禾称何嫂。", allowedAddresses: ["何嫂"], pressure: "要让母亲稳住，孩子才好治。" }),
    relation(HUAISHAN, HESHAO, "邻里 / 愧对", { shame: 45, protection: 40, love: 25 },
      { addressingRule: "顾怀山称何嫂。", allowedAddresses: ["何嫂"], unspoken: "阵是我守的，出了事该我担。", pressure: "她迟早会问昨夜的事。" }),
  ],
  relationshipMetrics: TAVERN_RELATIONSHIP_METRICS,
  objects: [
    object("jx_old_sword", "旧剑", "xm_room", { sheathed: true }, { aliases: ["剑", "生锈短剑"], initialHolderActorId: XIAOMAN, operations: ["draw", "sheathe"] }),
    object("jx_star_chart", "手绘星图", "xm_room", { missingStarMarked: true }, { aliases: ["星图"], initialHolderActorId: XIAOMAN }),
    object("jx_sword_manual", "破剑谱", "xm_room", {}, { aliases: ["剑谱"] }),
    object("jx_red_kite", "贴着飞行符的红纸鸢", "xm_room", { flightTalismanAttached: true }, { aliases: ["纸鸢", "风筝"] }),
    object("jx_travel_bundle", "包袱", "xm_room", { packedItems: 0, capacity: 4 }, { aliases: ["行囊"] }),
    object("jx_guide_talisman", "青色接引符", "main_room", { sectSealRenewed: true, issuedBy: "天阙剑宗", intendedRecipientActorId: XIAOMAN },
      { aliases: ["接引符", "玉符"], initialHolderActorId: HUAISHAN, presentation: hidden }),
    object("jx_carving_knife", "刻刀", "main_room", {}, { aliases: ["刀"], initialHolderActorId: HUAISHAN }),
    object("jx_cracked_array_disk", "裂开的阵盘", "main_room", { crackDepth: 2 }, { aliases: ["阵盘"] }),
    object("jx_array_flags", "一捆阵旗", "main_room", { intactFlags: 6, brokenFlags: 2 }, { aliases: ["阵旗"] }),
    object("jx_north_array_line", "谷口北侧阵纹", "array_eye", { litSegments: 0, requiredSegments: 3 }, { aliases: ["阵纹", "北侧阵纹"], portable: false }),
    object("jx_medicine_chest", "药箱", "clinic", {}, { aliases: ["药箱"] }),
    object("jx_patient_yaya", "药榻上昏睡的丫丫", "clinic", { blackMarks: 3, asleep: true },
      { aliases: ["丫丫", "小女孩"], portable: false, perception: { publicLabel: "药榻上昏睡的小女孩，手臂缠着药布" } }),
    object("jx_new_coat", "新缝的外衣", "clinic", {}, { aliases: ["外衣"] }),
    object("jx_pill_case", "丹瓶匣（三只丹瓶）", "clinic", { bottles: 3 }, { aliases: ["丹瓶", "药瓶"] }),
    object("jx_porridge_pot", "粥锅", "kitchen", { cookedPortions: 0 }, { aliases: ["锅"], portable: false }),
    object("jx_water_gourd", "水壶", "kitchen", { fill: 1 }, { aliases: ["水壶"] }),
    object("jx_dry_rations", "干粮", "kitchen", {}, { aliases: ["干粮"] }),
  ],
  positions: [
    { id: "position:jx:clinic-bedside-stool", label: "药榻边的矮凳", zoneId: "clinic", capacity: 1, metrics: positionMetrics, observableFeatures: ["挨着药榻", "能看见丫丫的手臂和药布"] },
    { id: "position:jx:main-table-bench", label: "堂屋桌边长凳", zoneId: "main_room", capacity: 3, metrics: positionMetrics, observableFeatures: ["桌上摊着裂开的阵盘", "能看见院门"] },
    { id: "position:jx:bridge-railing", label: "石桥栏边", zoneId: "bridge", capacity: 2, metrics: positionMetrics, observableFeatures: ["桥下溪水", "望得见去归云岭的山路"] },
  ],
  work: [
    { templateId: "repair_north_array_line", taskKind: "array_repair", zoneId: "array_eye", taskLabel: "补谷口北侧阵纹",
      description: "用刻刀把北侧阵石上熄灭的阵纹一段段重刻，让它重新亮起。", unitAction: "重刻一段熄灭的阵纹",
      requiredUnits: 3, unitLabel: "段阵纹", requiredSkillIds: ["array_craft"], requiredSkillLabel: "阵法",
      completionCriteria: ["三段阵纹都亮起", "护阵光幕不再透风"], objectIds: ["jx_north_array_line"], toolIds: ["jx_carving_knife"],
      durationSecondsPerUnit: 240, bodyLoadPerUnit: { exertionDelta: 0.05, fatigueDelta: 0.04, staminaDelta: -0.03, energyDelta: -0.03 },
      completionEffects: { objectNumericDeltas: [{ objectId: "jx_north_array_line", path: ["litSegments"], delta: 1, maximum: 3 }] },
      completionSound: { content: "谷口传来刻刀刮过阵石的细响。", maxDistance: 1 } },
    { templateId: "change_yaya_dressing", taskKind: "treatment", zoneId: "clinic", taskLabel: "给丫丫换药",
      description: "揭开旧药布，敷新药，把手臂上的黑纹压下去一道。", unitAction: "给丫丫换一次药",
      requiredUnits: 3, unitLabel: "次药", requiredSkillIds: ["medicine"], requiredSkillLabel: "医术",
      completionCriteria: ["黑纹退下去", "新药布缠好"], objectIds: ["jx_patient_yaya"], toolIds: ["jx_medicine_chest"],
      durationSecondsPerUnit: 120, bodyLoadPerUnit: { exertionDelta: 0.02, fatigueDelta: 0.02, staminaDelta: -0.01, energyDelta: -0.01 },
      completionEffects: { objectNumericDeltas: [{ objectId: "jx_patient_yaya", path: ["blackMarks"], delta: -1, minimum: 0 }] },
      completionSound: { content: "药房里传来揭开药布和捣药的轻响。", maxDistance: 1 } },
    { templateId: "pack_travel_bundle", taskKind: "packing", zoneId: "xm_room", taskLabel: "收拾出门的包袱",
      description: "把衣服、干粮、水壶或剑谱中的一样收进包袱。", unitAction: "往包袱里收一样出门要带的东西",
      requiredUnits: 4, unitLabel: "样东西", completionCriteria: ["衣服、干粮、水壶、剑谱都收进包袱"],
      objectIds: ["jx_travel_bundle"], toolIds: [], durationSecondsPerUnit: 45,
      completionEffects: { objectNumericDeltas: [{ objectId: "jx_travel_bundle", path: ["packedItems"], delta: 1, maximum: 4 }] },
      completionSound: { content: "小满房里窸窸窣窣地响。", maxDistance: 1 } },
    { templateId: "cook_porridge", taskKind: "cooking", zoneId: "kitchen", taskLabel: "熬一锅早粥",
      description: "生火添水下米，熬出一家人的早粥。", unitAction: "熬好一锅粥",
      requiredUnits: 1, unitLabel: "锅粥", completionCriteria: ["粥熬好"], objectIds: ["jx_porridge_pot"], toolIds: [],
      durationSecondsPerUnit: 360, bodyLoadPerUnit: { exertionDelta: 0.02, fatigueDelta: 0.01, staminaDelta: -0.01, energyDelta: -0.01 },
      completionEffects: { objectNumericDeltas: [{ objectId: "jx_porridge_pot", path: ["cookedPortions"], delta: 5, maximum: 5 }] },
      completionSound: { content: "灶间飘出米粥的香气，锅盖噗噗地跳。", maxDistance: 2 } },
  ],
  social: {
    facts: [
      { factId: "social-fact:jx:gu-household", kind: "ownership_claim", claimantId: "household:顾家", entityId: PLACE, topic: "这座院子是顾家的家", sourceEvidenceIds: [] },
      { factId: "social-fact:jx:clinic-open", kind: "public_access_declaration", entityId: PLACE, topic: "村里有人病了可以来药房找陆青禾", affectedActorIds: [], sourceEvidenceIds: [] },
      { factId: "social-fact:jx:array-custody", kind: "ownership_claim", claimantId: HUAISHAN, entityId: "jx_north_array_line", topic: "谷口藏山阵由顾怀山看守维护", sourceEvidenceIds: [] },
    ],
    boundaries: [
      { id: "social-boundary:jx:household-rooms", zoneIds: ["xm_room", "main_room", "kitchen"], exemptActorIds: [XIAOMAN, HUAISHAN, QINGHE],
        claimantIds: [HUAISHAN, QINGHE], permissionRequiredByNorm: true, possibleResponseTags: ["owner_may_notice", "owner_may_object"], evidenceIds: ["social-fact:jx:gu-household"] },
      { id: "social-boundary:jx:array-eye", zoneIds: ["array_eye"], exemptActorIds: [HUAISHAN], claimantIds: [HUAISHAN],
        permissionRequiredByNorm: true, possibleResponseTags: ["owner_may_notice", "owner_may_object"], evidenceIds: ["social-fact:jx:array-custody"] },
    ],
  },
  agenda: {
    items: [
      { id: "jx-yaya-dressing", kind: "treatment_due", placeId: PLACE, label: "丫丫的药一刻钟内要换", due: { atSeconds: 900 }, warningLeadSeconds: 300,
        source: "jx_ep01_scene10_clinic", responsibleActorIds: [QINGHE], knownByActorIds: [QINGHE, HESHAO],
        delayConsequence: "过了时辰不换药，黑纹会重新爬上来；换药必须真的揭布敷药，说一声不算。",
        conditions: [{ objectId: "jx_patient_yaya", stateKey: "blackMarks", maximum: 2 }] },
      { id: "jx-departure-to-guiyun", kind: "departure", placeId: PLACE, label: "辰时前从石桥动身去归云岭", due: { atSeconds: 1800 }, warningLeadSeconds: 600,
        source: "jx_ep01_scene10_noon_ferry", responsibleActorIds: [HUAISHAN, QINGHE], knownByActorIds: [HUAISHAN, QINGHE],
        delayConsequence: "过了辰时才动身，到归云岭再穿云墙就赶不上青岚渡午时的接引舟；要再向渡口传讯另约，未必还有船。孩子去不去由他自己说，时辰不等人。",
        conditions: [
          { kind: "actor_zone", actorId: XIAOMAN, zoneId: "bridge" },
          { kind: "object_holder", objectId: "jx_guide_talisman", holderId: XIAOMAN },
          { kind: "actor_zone", actorId: QINGHE, zoneId: "bridge" },
        ] },
    ],
  },
  mysteries: [
    { id: "mystery:jx:star-loss", label: "星辰为何一颗颗消失：熄灭、被遮蔽、位移，还是被借走" },
    { id: "mystery:jx:dream-nature", label: "小满的梦是必然的未来、可能的未来，还是剑感知到的别处灾变" },
    { id: "mystery:jx:parents-knowledge", label: "父母当年的世乱与今日失星是否同一场灾难，他们究竟知道多少" },
    { id: "mystery:jx:old-sword", label: "旧剑为何对失星格外敏感" },
    { id: "mystery:jx:valley-exposed", label: "昨夜山谷短暂暴露，是否被外人察觉" },
  ],
  report: {
    renderer: "pack-metrics",
    metrics: [
      { label: "北侧阵纹", objectId: "jx_north_array_line", stateKey: "litSegments", unit: "段", target: 3 },
      { label: "丫丫黑纹", objectId: "jx_patient_yaya", stateKey: "blackMarks", unit: "道", target: 0 },
      { label: "行囊", objectId: "jx_travel_bundle", stateKey: "packedItems", unit: "样", target: 4 },
      { label: "早粥", objectId: "jx_porridge_pot", stateKey: "cookedPortions", unit: "碗" },
      { label: "接引符", objectId: "jx_guide_talisman", kind: "holder" },
      { label: "红纸鸢", objectId: "jx_red_kite", kind: "holder" },
    ],
  },
  layout: JIEXING_LAYOUT,
});
