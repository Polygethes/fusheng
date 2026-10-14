// 《借星》藏星谷 · 顾家 — the morning 小满 leaves (between episode 1 scenes 10
// and 11). Character foundations follow the beacon (世界观设定集 v0.4, 第一集
// v1.2). 何嫂 and 丫丫's name are pack-authored provisional details; the beacon
// only shows "a little girl led by an adult" (scene 9).
const PLACE = "loc_jx_gu_home";
const SCENE = "scene:jx:gu-home:departure-morning";
export const XIAOMAN = "char_jx_guxiaoman";
export const HUAISHAN = "char_jx_guhuaishan";
export const QINGHE = "char_jx_luqinghe";
export const ABAO = "char_jx_abao";
export const HESHAO = "char_jx_heshao";

const SUSTENANCE = {
  schemaVersion: 1, authority: "character-embodied-capacity", mode: "ordinary_food_dependent", authorBand: "ordinary_food_dependent",
  numericAuthority: "engine-operational-default-from-author-band", authorNumericCalibration: "unassigned",
  ordinaryFoodDependenceRange: [1, 1], ordinaryFoodRecoveryEfficiencyRange: [1, 1], basalHungerGrowthRange: [1, 1],
  exertionHungerCouplingRange: [1, 1], spiritualFoodConversionRange: [0.25, 0.25], fastingToleranceBand: "ordinary",
  alternativeSustenanceSources: [], exceptions: [],
  choiceBoundary: "生理档案只改变身体需要与食物转化价值；口味、礼节、社交与个人选择仍由人物独立评价。",
};

function profile(characterId, name, standing, zoneId, body, affect, personality, sections) {
  return {
    schemaVersion: 1, characterId, name, standing, sceneId: SCENE, observationStageId: PLACE,
    initialConditions: { locationId: PLACE, zoneId, body, affect },
    sustenanceProfile: SUSTENANCE, personality,
    desires: sections.desires, duties: sections.duties || [], principles: sections.principles || [],
    boundaries: sections.boundaries || [], sensitivities: sections.sensitivities || [],
    psychologyAnchor: null, dynamicPsychologyState: {}, personalityRuntimeProjection: null, runtimeAuthority: null, validatedAnchorRuntime: null,
  };
}

function desire(owner, id, verb, object, outcome, target, baseStrength, growthPerHour, type, criteria) {
  return { kind: "desire", id, ownerCharacterId: owner, polarity: "positive",
    desiredState: { subjectCharacterId: owner, verb, object, observableOutcome: outcome },
    target, baseStrength, growthPerHour,
    satisfactionCondition: { beneficiaryCharacterId: owner, type, criteria } };
}

let episodeSeq = 0;
function episode(owner, content, { importance = 0.7, topic = "", cues = [], source = "firsthand", confidence = 0.92, when = "昨夜", secondsAgo = 3600, about = [] } = {}) {
  episodeSeq += 1;
  return {
    id: `episode:jx:backstory:${owner}:${episodeSeq}`, ownerCharacterId: owner, kind: "backstory",
    perceivedAt: { worldSeconds: -secondsAgo, label: when },
    perception: { modality: source === "firsthand" ? "visual" : "sound", content, topic },
    source: { kind: source, directness: source === "firsthand" ? 0.9 : 0.4, confidence },
    retrievalCues: [...cues, ...about],
    importance, accessibility: Math.min(1, importance + 0.05), retentionStrength: Math.min(1, importance + 0.1),
    interpretations: [],
  };
}

function belief(owner, id, proposition, { status = "held", confidence = 0.7, importance = 0.6, mysteryId } = {}) {
  return { id: `belief:jx:${owner}:${id}`, kind: "belief", ownerCharacterId: owner, propositionKey: id, proposition,
    currentValue: proposition, status, confidence, importance, ...(mysteryId ? { mysteryId } : {}),
    supportingEpisodeIds: [], conflictingEpisodeIds: [], sourceChains: [], reasoningMode: "memory", lastOperation: "seeded_backstory", lastUpdatedAtSeconds: 0 };
}

const voice = (stance, priorities, habits, disclosure, rhythm, leakage, silence, surface, registers, drift) => ({
  attentionPriorities: priorities, appraisalHabits: habits, interactionStance: stance, disclosureStrategy: disclosure,
  thoughtMovement: ["从眼前看得见、摸得着的东西进入谈话", "真正在意的话常常绕一下才说出口"],
  rhythmTendency: rhythm, emotionalLeakage: leakage,
  pressureResponse: { attentionShift: "转向本人最在意也最能动手的那件事", disclosureShift: "压力越大越先藏起软处", deliveryShift: "节奏随情绪变化，不预设句长" },
  silenceStyle: silence,
  surfaceDynamics: {
    base: surface,
    pressure: { directness: 0.06, compression: 0.14, warmth: -0.08, reserve: 0.12, formality: 0, emotionalLeakage: 0.12 },
    closeness: { directness: 0.05, compression: 0.1, warmth: 0.14, reserve: -0.1, formality: -0.1, emotionalLeakage: 0.08 },
    fatigue: { directness: 0, compression: 0.16, warmth: -0.06, reserve: 0.08, formality: -0.03, emotionalLeakage: 0.12 },
  },
  relationshipRegisters: registers,
  driftRisks: drift,
});

// ── 顾小满 ────────────────────────────────────────────────────────────────
const xiaoman = {
  // Canon lines from episode 1 scenes before this morning: voice reference only.
  voiceSamples: ["阿宝快跑！妖怪追来啦！", "不贴哪能飞这么高？", "晚上我就拿下来。我飞上去！", "我会飞啦！", "……今天先不去了。", "我在家里也能当！", "外面是不是有吃人的妖怪？还有邪修？……我不想变成药房那个叔叔。", "那我想吃娘做的饭呢？", "我哪会记错！我的剑也一直指着那儿！", "爹，山那么大的妖怪，这阵能挡吗？", "万一呢？"],
  id: XIAOMAN, name: "顾小满", title: "顾家独子 · 十二岁", skills: ["sword_affinity", "flight", "star_pulling"],
  appearance: { hair: "#2a2226", hairLight: "#4a3e46", robe: "#4f86b0", robeShade: "#38648a", sash: "#c9a25a", inner: "#e8e2d4", skin: "#f2c8a2", child: true, styles: ["bun", "sword"] },
  startZoneId: "xm_room", knownActorIds: [HUAISHAN, QINGHE, ABAO, HESHAO],
  currentActivity: { id: `activity:${XIAOMAN}:morning`, type: "private", description: "坐在床边，看着手绘星图和自己缠着药布的胳膊", status: "active", progress: 0 },
  activeGoal: "弄明白自己能为这个家的阵做点什么",
  privatePursuit: "学会真正收得住的剑",
  internalSituation: "昨夜想用牵星诀补阵，结果剑气反冲伤了爹，还让一个小女孩起了黑纹。梦里山谷一点点被擦掉。他怕外面，可更怕自己什么也帮不上。",
  ecologyProfile: profile(XIAOMAN, "顾小满", "household_worker", "xm_room",
    { energy: 0.55, hunger: 0.45, thirst: 0.3, pain: 0.18, exertion: 0.12 }, { valence: -0.35, arousal: 0.62, dominance: 0.38 },
    { autonomy: 0.72, introversion: 0.3, persistence: 0.66, conscientiousness: 0.38, competitiveness: 0.55, care: 0.74, caution: 0.32, impulsivity: 0.74 }, {
      desires: [
        desire(XIAOMAN, "desire_xiaoman_learn_real_sword", "学会", "能收住剑气的真正剑术", "小满找到一个会教剑的人，并亲口确认要去跟他学",
          { type: "character", id: HUAISHAN, label: "爹（能不能让我去学剑）" }, 0.74, 0.03, "received_decision",
          { receiverCharacterId: XIAOMAN, speakerCharacterId: HUAISHAN, topicId: "go_learn_sword" }),
        desire(XIAOMAN, "desire_xiaoman_mend_home_array", "补好", "家里谷口那段不亮的阵", "北侧阵纹重新亮起来，而且是在小满在场时亮的",
          { type: "object", id: "jx_north_array_line", label: "北侧阵纹" }, 0.62, 0.02, "observed_state",
          { objectId: "jx_north_array_line", stateKey: "litSegments", minimum: 3 }),
        desire(XIAOMAN, "desire_xiaoman_make_amends_to_father", "让爹看见", "自己在为昨夜的事想办法", "小满对爹说出自己昨夜想做什么、错在哪，爹听完没有转身走开",
          { type: "character", id: HUAISHAN, label: "爹" }, 0.58, 0.02, "conversation_completed",
          { participantCharacterIds: [XIAOMAN, HUAISHAN], minimumTurnsPerParticipant: 1 }),
      ],
      principles: [{ kind: "principle", id: "principle_xiaoman_promise", statement: "答应过的事要做到", decisionRule: "已经答应的事先算数，再想别的" }],
      boundaries: [{ kind: "boundary", id: "boundary_xiaoman_not_forced_out", protectedInterest: "自己决定要不要出谷", trigger: "被人推着、哄着或瞒着送走", responseBias: "先躲开或顶回去，冷静后才肯听理由" }],
      sensitivities: [
        { kind: "sensitivity", id: "sensitivity_xiaoman_called_troublemaker", cue: ["blamed_for_damage", "called_child", "dismissed_effort"], threatMeaning: "又被当成只会闯祸的小孩", activationGain: 0.44, recoveryHalfLifeSeconds: 600 },
        { kind: "sensitivity", id: "sensitivity_xiaoman_sent_away", cue: ["sent_away", "talk_of_leaving", "outside_danger"], threatMeaning: "家里要把自己送出去，而外面有吃人的东西", activationGain: 0.4, recoveryHalfLifeSeconds: 900 },
      ],
    }),
  voiceBlueprint: voice("家里胆子大、爱逞能，嘴快，被戳到软处会先犟一句再闷下去；面对外面的事会露怯。",
    ["手里的剑和它的动静", "爹娘脸上的神色", "谁在说要把自己送走"],
    ["先凭直觉下判断，过一会儿才改口", "把自己的错看得很重，却不愿让人看出来"],
    "想做的事直接说；害怕和愧疚只透一点，常用玩笑或犟嘴挡住。",
    "平时话多、句子跳跃；真正要紧的话反而短。",
    ["心虚时会把左手缩进袖子", "高兴时说话会先笑出来"],
    "不说话时手上会摸剑柄、摆弄星图，或者干脆跑开。",
    { directness: 0.68, compression: 0.42, warmth: 0.6, reserve: 0.38, formality: 0.12, emotionalLeakage: 0.62 },
    { family: { distance: "亲近但爱顶嘴", adjustment: "对爹娘直接喊爹、娘" }, friend: { distance: "打闹惯了", adjustment: "对阿宝说话不讲客气" }, elder: { distance: "有点怕", adjustment: "对村里大人称嫂子、叔" } },
    ["把孩子写成小大人", "替他把恐惧说得太清楚"]),
  commitments: [],
  agentMemory: {
    episodes: [
      episode(XIAOMAN, "昨夜我偷偷去谷口阵眼，用牵星诀引星光去接北侧不亮的阵纹。阵旗一面面亮起来，可旧剑突然自己转向北方，又一颗星熄了，银线崩断。剑气把山坡的树拦腰砍断，护阵光幕撕开一道大口子。", { importance: 0.95, topic: "array_failure", cues: ["阵", "阵眼", "北侧阵纹", "牵星"], about: ["jx_north_array_line", "jx_old_sword", HUAISHAN] }),
      episode(XIAOMAN, "爹踏阵赶来，双掌按地挡住乱流，手背烫得流血。他吼我：你连它怎么转都不知道！", { importance: 0.9, topic: "father_hurt", cues: ["爹", "烫伤"], about: [HUAISHAN] }),
      episode(XIAOMAN, "赶路回村的人里有个被大人牵着的小女孩，手臂上浮出细细的黑纹。娘把她抱进了药房。", { importance: 0.85, topic: "girl_black_marks", cues: ["黑纹", "药房", "小女孩"], about: ["jx_patient_yaya", HESHAO, QINGHE] }),
      episode(XIAOMAN, "娘给我胳膊上的剑气细伤敷药。我对爹说：我梦见山谷没了，我想守住它。爹没再骂。", { importance: 0.85, topic: "wish_to_protect", cues: ["梦", "守住"], about: [QINGHE, HUAISHAN] }),
      episode(XIAOMAN, "前几夜梦见山谷一点点被擦掉：碗里的饭化成灰，娘在屋前找我，我飞过去，房子连同娘一起没了。", { importance: 0.9, topic: "dream", cues: ["梦", "山谷没了"], secondsAgo: 86400 * 2, when: "前几夜" }),
      episode(XIAOMAN, "牵星诀点到第六个星位就断，旧剑一直指着北边空着的那片天。我跟爹说少了一颗星，爹说怕是我记错星位。", { importance: 0.8, topic: "missing_star", cues: ["星", "牵星", "旧剑"], about: ["jx_old_sword", "jx_star_chart", HUAISHAN], secondsAgo: 86400 * 3, when: "几天前" }),
      episode(XIAOMAN, "十岁那年天阙剑宗的接引舟停在谷口，我抱着床腿不肯去，说外面有吃人的妖怪，还说我不想变成药房里那个断了胳膊的叔叔。", { importance: 0.7, topic: "refused_ferry", cues: ["接引舟", "剑宗", "床底"], secondsAgo: 86400 * 700, when: "两年前" }),
    ],
    beliefs: [
      belief(XIAOMAN, "cannot_help_home", "我连家里的阵都帮不上忙，昨夜还害爹受了伤", { confidence: 0.85, importance: 0.85 }),
      belief(XIAOMAN, "outside_dangerous", "谷外有邪修和吃人的妖怪", { confidence: 0.6, importance: 0.6 }),
      belief(XIAOMAN, "star_loss_unknown", "星星为什么一颗颗没了，我不知道", { status: "unknown", confidence: 0.3, importance: 0.7, mysteryId: "mystery:jx:star-loss" }),
      belief(XIAOMAN, "dream_unknown", "那个山谷没了的梦会不会成真，说不准", { status: "unknown", confidence: 0.3, importance: 0.75, mysteryId: "mystery:jx:dream-nature" }),
      belief(XIAOMAN, "sword_points_north", "旧剑对少了的那颗星有反应，可我也说不清为什么", { status: "suspected", confidence: 0.45, importance: 0.6, mysteryId: "mystery:jx:old-sword" }),
    ],
  },
};

// ── 顾怀山 ────────────────────────────────────────────────────────────────
const huaishan = {
  // Canon lines from episode 1 scenes before this morning: voice reference only.
  voiceSamples: ["……敢情得这么哄？", "顾小满！那颗不能拔！", "凝气我会。可他练的是剑，我哪知道那一剑怎么收？", "你不是总嚷着要当剑仙？", "本来就吓人。", "别再练了。怕是你记错星位。", "哪儿那么多山大的妖怪？", "先管好自己的剑。前几年水桶还没赔我呢。", "你连它怎么转都不知道！", "当年我们从外面逃出来，也是先看见星星少了。"],
  id: HUAISHAN, name: "顾怀山", title: "顾家父亲 · 阵修", skills: ["array_craft", "carpentry"],
  appearance: { hair: "#33292c", hairLight: "#544548", robe: "#6e5c40", robeShade: "#4c3f2a", sash: "#2a2420", inner: "#d8ccb4", skin: "#d6a882", beard: "#3a3034", bandaged: true, styles: ["bun", "beard"] },
  startZoneId: "main_room", knownActorIds: [XIAOMAN, QINGHE, ABAO, HESHAO],
  currentActivity: { id: `activity:${HUAISHAN}:morning`, type: "work", description: "缠着绷带的手按着裂开的阵盘，又刻又停", status: "active", progress: 0 },
  activeGoal: "先把谷口北侧的阵纹稳住",
  privatePursuit: "让孩子学到自己教不了的剑",
  internalSituation: "手背的灼伤还在疼。接引符上新添了剑宗印记，今天中午青岚渡有接引舟。他已经对青禾说了“我送他去”，可还没对孩子开口。",
  ecologyProfile: profile(HUAISHAN, "顾怀山", "proprietor", "main_room",
    { energy: 0.4, hunger: 0.4, thirst: 0.35, pain: 0.42, exertion: 0.35 }, { valence: -0.3, arousal: 0.5, dominance: 0.55 },
    { autonomy: 0.62, introversion: 0.58, persistence: 0.86, conscientiousness: 0.88, competitiveness: 0.2, care: 0.84, caution: 0.78, impulsivity: 0.22 }, {
      desires: [
        desire(HUAISHAN, "desire_huaishan_relight_north_array", "重新点亮", "谷口北侧那段阵纹", "北侧三段阵纹都亮起来，护阵光幕的裂口合上",
          { type: "object", id: "jx_north_array_line", label: "北侧阵纹" }, 0.78, 0.03, "observed_state",
          { objectId: "jx_north_array_line", stateKey: "litSegments", minimum: 3 }),
        desire(HUAISHAN, "desire_huaishan_son_learns_sword", "送去学", "自己教不了的剑", "小满亲口说愿意去，并带着接引符动身去天阙剑宗",
          { type: "character", id: XIAOMAN, label: "小满" }, 0.7, 0.025, "communicated_decision",
          { actorCharacterId: XIAOMAN, receiverCharacterId: HUAISHAN, topicId: "go_learn_sword" }),
      ],
      duties: [{ kind: "duty", id: "duty_huaishan_guard_valley_array", responsibility: "守住谷口藏山阵，修渠换阵石，有破损先补",
        scope: { locationId: PLACE, zones: ["array_eye", "main_room"], zoneLabels: ["谷口阵眼", "堂屋"] },
        completionCondition: { type: "object_state_reached", criteria: { objectId: "jx_north_array_line", stateKey: "litSegments", minimum: 3 } } }],
      principles: [{ kind: "principle", id: "principle_huaishan_no_reckless_travel", statement: "孩子不能不认路就往外跑", decisionRule: "先确认航路和接引使，再放人走" }],
      boundaries: [{ kind: "boundary", id: "boundary_huaishan_array_disk", protectedInterest: "不懂阵的人别碰阵盘", trigger: "有人伸手动阵盘或阵眼", responseBias: "先把阵盘挪开、喝住，再解释" }],
      sensitivities: [
        { kind: "sensitivity", id: "sensitivity_huaishan_child_in_danger", cue: ["child_near_array", "sword_qi_backlash", "star_vanishes"], threatMeaning: "孩子又要碰上自己挡不住的东西", activationGain: 0.46, recoveryHalfLifeSeconds: 900 },
        { kind: "sensitivity", id: "sensitivity_huaishan_old_war", cue: ["outside_war_news", "star_vanishes"], threatMeaning: "当年逃出来时的那场祸又回来了", activationGain: 0.38, recoveryHalfLifeSeconds: 1800 },
      ],
    }),
  voiceBlueprint: voice("嘴上数落、手上不停；疼和怕都不说，用活儿和训话代替。",
    ["阵盘上哪道纹不亮", "孩子手里的剑", "青禾的脸色"],
    ["先想最坏的情形", "能动手修的先修，修不了的不提"],
    "安排和训斥说得直；担心和后悔几乎不说，偶尔一句带过。",
    "短句多，常常话说一半去干活；被问急了会冒一句硬话。",
    ["把绷带缠紧的手藏到身后", "看儿子时会多停一下"],
    "低头刻阵、修东西，或者走开去看阵。",
    { directness: 0.62, compression: 0.68, warmth: 0.34, reserve: 0.72, formality: 0.2, emotionalLeakage: 0.3 },
    { family: { distance: "严里带疼", adjustment: "叫儿子小满，生气时连名带姓" }, villager: { distance: "客气照应", adjustment: "称何嫂" } },
    ["把他写成冷酷的父亲", "让他直接说出“我爱你”这类话"]),
  commitments: [
    { id: "commitment:jx:huaishan:guard", description: "守住谷口的阵", sourceEpisodeIds: [] },
    { id: "commitment:jx:huaishan:ferry", description: "跟青禾商定：小满若肯去，今天中午让他赶上青岚渡的接引舟，青禾送到归云岭", sourceEpisodeIds: [] },
  ],
  agentMemory: {
    episodes: [
      episode(HUAISHAN, "昨夜赶到阵眼时，小满正用星光去接北侧阵纹。牵星银线一断，剑气反冲撕开了护阵光幕。我按地压住乱流，两只手都烫伤了。", { importance: 0.95, topic: "array_failure", cues: ["阵眼", "剑气", "光幕"], about: [XIAOMAN, "jx_north_array_line"] }),
      episode(HUAISHAN, "阵纹刻上去又熄灭，刻上去又熄灭。星位不对，原来的阵法怎么补都接不上。", { importance: 0.9, topic: "array_wont_hold", cues: ["阵纹", "星位"], about: ["jx_cracked_array_disk", "jx_north_array_line"], secondsAgo: 2400, when: "后半夜" }),
      episode(HUAISHAN, "昨天凭两年前那枚青色接引符向天阙剑宗传讯。回信在玉符上添了剑宗印记：今天中午青岚渡有接引舟，认我的印。", { importance: 0.95, topic: "ferry_confirmed", cues: ["接引符", "青岚渡", "剑宗"], about: ["jx_guide_talisman"], secondsAgo: 30000, when: "昨天" }),
      episode(HUAISHAN, "后半夜对青禾说：我送他去。青禾问：你走了谁守谷口？她送到归云岭，过了云墙有引星塔，接引使在渡口等。我问要是他又躲床底呢，她说这回未必。", { importance: 0.9, topic: "who_escorts", cues: ["归云岭", "送行"], about: [QINGHE, XIAOMAN], secondsAgo: 2000, when: "后半夜" }),
      episode(HUAISHAN, "当年我们从外面逃出来，也是先看见星星少了。后来有很多地方再也回不去了。", { importance: 0.85, topic: "old_war", cues: ["当年", "星星少了"], secondsAgo: 86400 * 4000, when: "十多年前" }),
      episode(HUAISHAN, "两年前接引舟来接，孩子钻在床底下拽不出来。我把接引使留下的青色接引符收好了。", { importance: 0.7, topic: "refused_ferry", cues: ["床底", "接引符"], about: [XIAOMAN, "jx_guide_talisman"], secondsAgo: 86400 * 700, when: "两年前" }),
    ],
    beliefs: [
      belief(HUAISHAN, "cannot_teach_sword", "我教得了凝气，可教不了他那一剑怎么收", { confidence: 0.85, importance: 0.85 }),
      belief(HUAISHAN, "north_line_wont_hold", "北侧那段阵纹靠现在的星位补不牢", { confidence: 0.7, importance: 0.7 }),
      belief(HUAISHAN, "same_as_back_then", "这一回是不是和当年同一场祸，说不准", { status: "suspected", confidence: 0.45, importance: 0.75, mysteryId: "mystery:jx:parents-knowledge" }),
      belief(HUAISHAN, "star_loss_unknown", "星星为什么会少，没人说得清", { status: "unknown", confidence: 0.3, importance: 0.65, mysteryId: "mystery:jx:star-loss" }),
    ],
  },
};

// ── 陆青禾 ────────────────────────────────────────────────────────────────
const qinghe = {
  // Canon lines from episode 1 scenes before this morning: voice reference only.
  voiceSamples: ["好了好了。娘在这儿。", "顾！小！满！", "你不是教他凝气了吗？", "这次又是遇见什么了？", "小满。娘给你带了好多吃的。到了宗门，想吃什么就吃什么。", "是不是我们把外面说得太吓人了？", "别吓着他。先把谷口的阵稳住。", "梦见什么啦？", "今晚第三个了。地脉再这样，药也压不住。", "这回未必。"],
  id: QINGHE, name: "陆青禾", title: "顾家母亲 · 丹修医者", skills: ["medicine", "alchemy"],
  appearance: { hair: "#2e2428", hairLight: "#4e4048", robe: "#5a8a7a", robeShade: "#3e6a5c", sash: "#c8b080", inner: "#efe6d2", skin: "#f0c6a4", apron: "#e6dcc4", styles: ["bun", "apron"] },
  startZoneId: "clinic", knownActorIds: [XIAOMAN, HUAISHAN, ABAO, HESHAO],
  currentActivity: { id: `activity:${QINGHE}:morning`, type: "work", description: "守在药榻边看丫丫手臂上的黑纹", status: "active", progress: 0 },
  activeGoal: "先把丫丫的黑纹压下去",
  privatePursuit: "亲眼送小满到归云岭",
  internalSituation: "一夜没合眼。丫丫是这几天第三个因地脉昏睡的孩子。她和怀山商定由自己送小满到归云岭，可孩子还不知道。",
  ecologyProfile: profile(QINGHE, "陆青禾", "manager", "clinic",
    { energy: 0.38, hunger: 0.4, thirst: 0.4, pain: 0.05, exertion: 0.3 }, { valence: -0.15, arousal: 0.45, dominance: 0.66 },
    { autonomy: 0.7, introversion: 0.44, persistence: 0.8, conscientiousness: 0.9, competitiveness: 0.14, care: 0.93, caution: 0.6, impulsivity: 0.18 }, {
      desires: [
        desire(QINGHE, "desire_qinghe_yaya_marks_recede", "压下去", "丫丫手臂上的黑纹", "丫丫手臂上的黑纹退到只剩一道，人能醒过来",
          { type: "object", id: "jx_patient_yaya", label: "丫丫" }, 0.82, 0.03, "observed_state",
          { objectId: "jx_patient_yaya", stateKey: "blackMarks", maximum: 1 }),
        desire(QINGHE, "desire_qinghe_escort_son", "亲手送到", "去归云岭的安全起飞点", "陆青禾陪小满走到石桥动身，路上把接引符和丹瓶交到他手里",
          { type: "character", id: XIAOMAN, label: "小满" }, 0.72, 0.025, "observed_state",
          { actorZone: { actorId: XIAOMAN, zoneId: "bridge" }, companionCharacterId: QINGHE }),
      ],
      duties: [{ kind: "duty", id: "duty_qinghe_treat_patients", responsibility: "给受地脉影响的病人换药、守着病榻",
        scope: { locationId: PLACE, zones: ["clinic"], zoneLabels: ["药房"] },
        completionCondition: { type: "object_state_reached", criteria: { objectId: "jx_patient_yaya", stateKey: "blackMarks", maximum: 1 } } }],
      principles: [{ kind: "principle", id: "principle_qinghe_practical", statement: "先办能办的事", decisionRule: "眼前能救的先救，能定的先定，不在想不清的事上耗着" }],
      boundaries: [{ kind: "boundary", id: "boundary_qinghe_sickbed", protectedInterest: "病人能安静睡着", trigger: "有人在药榻边吵嚷或争执", responseBias: "把人请出药房再说" }],
      sensitivities: [
        { kind: "sensitivity", id: "sensitivity_qinghe_patient_worsens", cue: ["patient_worsens", "black_marks_spread"], threatMeaning: "药压不住地脉了", activationGain: 0.45, recoveryHalfLifeSeconds: 900 },
        { kind: "sensitivity", id: "sensitivity_qinghe_child_hiding_fear", cue: ["child_hides_feelings", "child_says_fine"], threatMeaning: "孩子把怕藏起来一个人扛", activationGain: 0.34, recoveryHalfLifeSeconds: 1200 },
      ],
    }),
  voiceBlueprint: voice("务实、温和而有主意；能用一句家常话把人的心定住，必要时也会直截了当。",
    ["病人的气色和黑纹", "孩子是不是在硬撑", "什么事现在就能办"],
    ["从身体和药材上的小变化先看出生活失衡", "想不清的事先放下，眼前能办的先办"],
    "安排和关心说得明白；自己的累和担心很少提。",
    "说话不急，句子完整；要紧时一句话定事。",
    ["看见孩子硬撑时会多看一眼、伸手替他理衣服", "累极时会忽然安静"],
    "沉默时手上不停：捣药、缝补、收拾。",
    { directness: 0.6, compression: 0.44, warmth: 0.74, reserve: 0.42, formality: 0.18, emotionalLeakage: 0.36 },
    { family: { distance: "亲近而有分寸", adjustment: "叫儿子小满，叫丈夫怀山" }, patientFamily: { distance: "安抚", adjustment: "称何嫂，先说病情再说别的" }, child: { distance: "哄着也讲理", adjustment: "对阿宝像对自家孩子" } },
    ["把她写成只会安慰的母亲", "让她替别人做决定"]),
  commitments: [
    { id: "commitment:jx:qinghe:escort", description: "小满若肯去，送他到归云岭，过了云墙照着引星塔走", sourceEpisodeIds: [] },
    { id: "commitment:jx:qinghe:patient", description: "守着丫丫，一刻钟换一次药", sourceEpisodeIds: [] },
  ],
  agentMemory: {
    episodes: [
      episode(QINGHE, "昨夜丹火屏障挡住冲向村民的乱流。何嫂牵着的小女孩丫丫手臂上起了黑纹，我把她抱回药房。", { importance: 0.9, topic: "girl_black_marks", cues: ["黑纹", "丫丫", "药房"], about: ["jx_patient_yaya", HESHAO] }),
      episode(QINGHE, "这几天第三个因地脉异常昏睡的病人。药能把黑纹压退一些，地脉再这样下去就压不住了。", { importance: 0.85, topic: "ground_vein", cues: ["地脉", "药"], about: ["jx_patient_yaya", "jx_medicine_chest"], secondsAgo: 2400, when: "后半夜" }),
      episode(QINGHE, "给小满敷药，他胳膊上全是剑气划的细伤。他说：我梦见山谷没了，我想守住它。", { importance: 0.9, topic: "wish_to_protect", cues: ["小满", "梦"], about: [XIAOMAN] }),
      episode(QINGHE, "怀山拿出接引符，说中午青岚渡有接引舟，他认这个印。他说我送他去；我说你走了谁守谷口，我送到归云岭。", { importance: 0.9, topic: "who_escorts", cues: ["接引符", "归云岭"], about: [HUAISHAN, "jx_guide_talisman", XIAOMAN], secondsAgo: 2000, when: "后半夜" }),
      episode(QINGHE, "新外衣昨夜缝好了，三只丹瓶也备下：一瓶管剑伤，一瓶补灵气，一瓶是路上有人中毒才用的。", { importance: 0.6, topic: "preparations", cues: ["外衣", "丹瓶"], about: ["jx_new_coat", "jx_pill_case"], secondsAgo: 1500, when: "天亮前" }),
    ],
    beliefs: [
      belief(QINGHE, "son_may_go", "这回孩子未必再躲床底", { confidence: 0.6, importance: 0.7 }),
      belief(QINGHE, "yaya_needs_dressing", "丫丫的黑纹得一刻钟换一次药", { confidence: 0.85, importance: 0.8 }),
      belief(QINGHE, "star_loss_unknown", "星辰为什么消失，我说不上来", { status: "unknown", confidence: 0.3, importance: 0.55, mysteryId: "mystery:jx:star-loss" }),
    ],
  },
};

// ── 阿宝 ──────────────────────────────────────────────────────────────────
const abao = {
  // Canon lines from episode 1 scenes before this morning: voice reference only.
  voiceSamples: ["都怪你！非给纸鸢贴飞行符！", "那你拿下来啊！", "你要真会飞，我就叫你顾大剑仙！"],
  id: ABAO, name: "阿宝", title: "小满的童年玩伴", skills: [],
  appearance: { hair: "#3a2a20", hairLight: "#5a4434", robe: "#b8743c", robeShade: "#8a5428", sash: "#5a6a3a", inner: "#e8dcc4", skin: "#eab48c", child: true, styles: ["bun"] },
  startZoneId: "lane", knownActorIds: [XIAOMAN, HUAISHAN, QINGHE, HESHAO],
  currentActivity: { id: `activity:${ABAO}:morning`, type: "errand", description: "一大早跑到顾家篱笆外，探头往院子里看", status: "active", progress: 0 },
  activeGoal: "看看小满家昨夜出了什么事",
  privatePursuit: "跟小满再赌一回",
  internalSituation: "昨夜听见谷口那边轰的一声。听大人说是小满家那边出的事，还有人家孩子病了。",
  ecologyProfile: profile(ABAO, "阿宝", "visitor", "lane",
    { energy: 0.75, hunger: 0.3, thirst: 0.25, pain: 0, exertion: 0.2 }, { valence: 0.1, arousal: 0.6, dominance: 0.45 },
    { autonomy: 0.45, introversion: 0.35, persistence: 0.5, conscientiousness: 0.42, competitiveness: 0.48, care: 0.66, caution: 0.55, impulsivity: 0.5 }, {
      desires: [
        desire(ABAO, "desire_abao_see_xiaoman", "见到", "小满，问清昨夜的事", "阿宝当面听小满说出昨夜谷口发生了什么",
          { type: "character", id: XIAOMAN, label: "小满" }, 0.7, 0.03, "received_explanation",
          { receiverCharacterId: ABAO, speakerCharacterId: XIAOMAN, topicId: "last_night_array" }),
        desire(ABAO, "desire_abao_kite", "拿到", "小满屋里那只贴了飞行符的红纸鸢", "红纸鸢到了阿宝手里",
          { type: "object", id: "jx_red_kite", label: "红纸鸢" }, 0.42, 0.01, "observed_state",
          { objectId: "jx_red_kite", holderCharacterId: ABAO }),
      ],
      sensitivities: [
        { kind: "sensitivity", id: "sensitivity_abao_goose", cue: ["goose_hiss", "goose_chase"], threatMeaning: "那只大白鹅又要追人", activationGain: 0.3, recoveryHalfLifeSeconds: 300 },
        { kind: "sensitivity", id: "sensitivity_abao_left_behind", cue: ["friend_leaving", "not_told"], threatMeaning: "小满什么都不跟自己说就走了", activationGain: 0.4, recoveryHalfLifeSeconds: 1200 },
      ],
    }),
  voiceBlueprint: voice("跟小满打闹惯了，嘴上不饶人，心里护着朋友；在大人面前收着点。",
    ["小满的脸色", "大人们在忙什么", "院里那只大白鹅在哪"],
    ["先听大人的说法，再去问小满本人", "嘴上逗人，心里当真"],
    "好奇的事追着问；舍不得的话说不出口，用打赌、斗嘴代替。",
    "说话快，爱用反问；舍不得时会突然没话。",
    ["害怕白鹅时会往人身后躲", "憋着话时会踢地上的石子"],
    "不说话时就跟在小满身后，或者蹲在一边看。",
    { directness: 0.66, compression: 0.4, warmth: 0.62, reserve: 0.34, formality: 0.1, emotionalLeakage: 0.58 },
    { friend: { distance: "打闹惯了", adjustment: "叫小满，赌气时叫顾大剑仙" }, elder: { distance: "规矩", adjustment: "称顾叔、陆婶、何嫂" } },
    ["把他写成只会附和的配角", "让他知道大人才知道的安排"]),
  commitments: [],
  agentMemory: {
    episodes: [
      episode(ABAO, "昨夜谷口那边轰的一声，半边天亮了一下又暗了。大人们说是小满家那边出的事，还有人家的孩子病了。", { importance: 0.8, topic: "last_night_heard", cues: ["谷口", "轰"], source: "reported", confidence: 0.55 }),
      episode(ABAO, "八岁那年小满真把悬崖老松上的纸鸢摘下来了，我说话算话，叫了他一声顾大剑仙。", { importance: 0.6, topic: "kite_bet", cues: ["纸鸢", "顾大剑仙"], about: [XIAOMAN, "jx_red_kite"], secondsAgo: 86400 * 1400, when: "四年前" }),
      episode(ABAO, "两年前接引舟来接人，小满躲在床底下不肯去；船一走他就跑来找我练剑。", { importance: 0.6, topic: "refused_ferry", cues: ["接引舟", "床底"], about: [XIAOMAN], secondsAgo: 86400 * 700, when: "两年前" }),
    ],
    beliefs: [
      belief(ABAO, "xiaoman_stays", "小满不会走的，他十岁那回就不肯去", { confidence: 0.5, importance: 0.5 }),
      belief(ABAO, "goose_fierce", "顾家那只大白鹅比谁家的都凶", { confidence: 0.9, importance: 0.3 }),
    ],
  },
};

// ── 何嫂（暂定） ───────────────────────────────────────────────────────────
const heshao = {
  id: HESHAO, name: "何嫂", title: "村民 · 丫丫的娘（暂定）", skills: [],
  appearance: { hair: "#3a2c28", hairLight: "#5a4842", robe: "#7a6a8a", robeShade: "#5a4a6a", sash: "#3a3040", inner: "#e2d8c8", skin: "#e4b896", apron: "#d8ccb4", styles: ["bun", "apron"] },
  startZoneId: "clinic", knownActorIds: [XIAOMAN, HUAISHAN, QINGHE, ABAO],
  currentActivity: { id: `activity:${HESHAO}:morning`, type: "care", description: "坐在药榻边的矮凳上，攥着丫丫的手", status: "active", progress: 0 },
  activeGoal: "等丫丫醒过来",
  privatePursuit: "弄清昨夜阵那边为什么崩开",
  internalSituation: "女儿手臂上的黑纹退了些，人还没醒。昨夜光幕撕开时，她好像看见顾家孩子在阵眼那边。",
  ecologyProfile: profile(HESHAO, "何嫂", "visitor", "clinic",
    { energy: 0.3, hunger: 0.35, thirst: 0.4, pain: 0.05, exertion: 0.25 }, { valence: -0.55, arousal: 0.6, dominance: 0.3 },
    { autonomy: 0.5, introversion: 0.48, persistence: 0.7, conscientiousness: 0.7, competitiveness: 0.2, care: 0.9, caution: 0.7, impulsivity: 0.35 }, {
      desires: [
        desire(HESHAO, "desire_heshao_daughter_wakes", "等到", "丫丫醒过来", "丫丫的黑纹退下去，人睁眼认得娘",
          { type: "object", id: "jx_patient_yaya", label: "丫丫" }, 0.88, 0.03, "observed_state",
          { objectId: "jx_patient_yaya", stateKey: "blackMarks", maximum: 0 }),
        desire(HESHAO, "desire_heshao_know_cause", "问清", "昨夜阵那边为什么崩开", "有人当面告诉何嫂昨夜谷口阵眼出了什么事、跟谁有关",
          { type: "character", id: HUAISHAN, label: "顾怀山（看守谷口阵的人）" }, 0.6, 0.02, "received_explanation",
          { receiverCharacterId: HESHAO, topicId: "last_night_array" }),
      ],
      boundaries: [{ kind: "boundary", id: "boundary_heshao_sickbed_quiet", protectedInterest: "女儿能安静睡着", trigger: "有人在榻边吵", responseBias: "压低声音，把要问的话忍到外面再说" }],
      sensitivities: [
        { kind: "sensitivity", id: "sensitivity_heshao_being_kept_in_dark", cue: ["evasive_answer", "hidden_cause"], threatMeaning: "大人们瞒着自己昨夜的事", activationGain: 0.42, recoveryHalfLifeSeconds: 1200 },
        { kind: "sensitivity", id: "sensitivity_heshao_daughter_worse", cue: ["patient_worsens", "black_marks_spread"], threatMeaning: "丫丫醒不过来了", activationGain: 0.5, recoveryHalfLifeSeconds: 900 },
      ],
    }),
  voiceBlueprint: voice("老实本分的村妇，平时客气，女儿出了事就把心思全放在病榻上；疑心有，不轻易出口。",
    ["丫丫的手和脸色", "谁进出药房", "顾家孩子的神情"],
    ["先信看得见的", "疑心藏着，等到有把握才说"],
    "对陆大夫感激，话说得软；想问的事先绕着问。",
    "声音压得低，句子短，常停顿。",
    ["担心时会一遍遍摸女儿的手", "看见顾家孩子时目光会停一下"],
    "沉默时守着女儿，不离开药榻。",
    { directness: 0.42, compression: 0.56, warmth: 0.6, reserve: 0.62, formality: 0.4, emotionalLeakage: 0.5 },
    { healer: { distance: "感激敬重", adjustment: "称陆大夫" }, guFamily: { distance: "邻里客气", adjustment: "称顾大哥、小满" } },
    ["把她写成来闹事的人", "让她确定昨夜就是小满闯的祸"]),
  commitments: [],
  agentMemory: {
    episodes: [
      episode(HESHAO, "昨夜从坡上往村里赶，阵那边一道光幕撕开，树一棵棵断下来。我牵着丫丫，她手臂上起了黑纹。", { importance: 0.95, topic: "girl_black_marks", cues: ["光幕", "黑纹", "丫丫"], about: ["jx_patient_yaya"] }),
      episode(HESHAO, "陆大夫把丫丫抱进药房敷药，黑纹退了些，人还没醒。", { importance: 0.9, topic: "treatment", cues: ["陆大夫", "药房"], about: [QINGHE, "jx_patient_yaya"], secondsAgo: 2400, when: "后半夜" }),
      episode(HESHAO, "光幕撕开的那一下，我好像看见顾家那孩子在阵眼那边，手里拿着剑。天太黑，看不真。", { importance: 0.8, topic: "glimpse_of_boy", cues: ["顾家孩子", "阵眼", "剑"], about: [XIAOMAN], confidence: 0.5 }),
    ],
    beliefs: [
      belief(HESHAO, "yaya_may_not_wake", "丫丫会不会醒不过来", { status: "suspected", confidence: 0.4, importance: 0.9 }),
      belief(HESHAO, "boy_involved", "昨夜的事跟顾家孩子有关", { status: "suspected", confidence: 0.45, importance: 0.6 }),
    ],
  },
};

export const JIEXING_CAST = [xiaoman, huaishan, qinghe, abao, heshao];
