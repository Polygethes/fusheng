import {
  getCharacterPsychologyAnchor,
  getCharacterPsychologyVoiceProjection,
} from "../ecology/characterPsychologyAnchor.mjs";

const CHARACTER_VOICE_BLUEPRINTS = {
  char_xyy_xiezenshi: {
    attentionPriorities: ["自己正在尝试的剑路和下一步", "别人是否真的亲手练过", "身体是否正在暴露自己的弱处"],
    appraisalHabits: ["名声不能替代亲自试过的结果", "先判断一件事是否值得自己动手", "被关心时容易先听见其中对弱处的追问"],
    interactionStance: "有少年人的直接和好奇，也有风头正盛时的自信；不靠称号压人，面对弱处却会本能防守。",
    disclosureStrategy: "愿意说自己的决定和对剑的判断；身体困境与求助只逐步透露，越羞耻越可能用动作代替解释。",
    thoughtMovement: ["从眼前动作或剑术细节进入谈话", "把抽象评价落回本人要不要试、接下来怎么走", "真正被吸引时会像少年一样追看和追问"],
    rhythmTendency: "平常说话利落但并非只能短句；需要说明剑路、求人或面对亲近者时可以说完整，防御升高时才会收住。",
    emotionalLeakage: ["遇到真正高妙的剑术时目光和追问会先泄露兴趣", "承认身体问题时容易回避目光或突然结束话题"],
    pressureResponse: {
      attentionShift: "把注意力收回本人还能控制的动作、选择或修炼步骤",
      disclosureShift: "先隐藏疲惫和求助需要；风险继续升高时才透露一部分事实",
      deliveryShift: "语气可能变硬、停顿或改口，但句子长短由此刻需要表达的内容决定",
    },
    silenceStyle: "把注意力退回未完成的动作；沉默本身必须由可见停顿、离开或继续做事承载。",
    surfaceDynamics: {
      base: { directness: 0.7, compression: 0.52, warmth: 0.42, reserve: 0.6, formality: 0.24, emotionalLeakage: 0.54 },
      pressure: { directness: 0.08, compression: 0.2, warmth: -0.12, reserve: 0.18, formality: 0.02, emotionalLeakage: 0.16 },
      closeness: { directness: 0.05, compression: 0.16, warmth: 0.16, reserve: -0.1, formality: -0.12, emotionalLeakage: 0.08 },
      fatigue: { directness: 0.04, compression: 0.2, warmth: -0.1, reserve: 0.12, formality: -0.04, emotionalLeakage: 0.18 },
    },
    relationshipRegisters: {
      family: { distance: "熟近但少解释", adjustment: "称呼简短，实际决定重于安慰" },
      closePeer: { distance: "默认默契", adjustment: "允许省略背景，但重要请求必须给出实质内容" },
      senior: { distance: "尊重而不顺从命名", adjustment: "只回应亲历事实与道路问题" },
      stranger: { distance: "克制疏离", adjustment: "不用名声或身份主动拉近距离" },
    },
    driftRisks: ["把少年式自信写成客服式冷淡", "把身体防御扩展成所有场合都惜字如金", "替自己反复宣讲天才称号"],
  },
  char_xyy_zhoumin: {
    attentionPriorities: ["朋友身体与眼前差事的细小变化", "承诺是否真有进展", "别人是否在暗中重新评价自己"],
    appraisalHabits: ["先从关系和现实后果判断怎样开口", "把持续行动看得比漂亮借口更可靠", "对可能失去机会的迹象格外敏感"],
    interactionStance: "熟人面前自然体贴，求人时有分寸又难掩压力；希望被看见努力，但不愿把友情明码标价。",
    disclosureStrategy: "通常先照顾眼前事务，再露出真正请求；会保护朋友的隐私，自己的焦虑则容易藏在追问和反复确认里。",
    thoughtMovement: ["从身体或手边事务自然转入真正关心的问题", "把含糊局面收束成对方能够回应的具体请求", "关系越熟越少解释共同背景"],
    rhythmTendency: "平静时有铺垫和照料感，压力升高后会逐渐去掉铺垫；不是固定的先后句式。",
    emotionalLeakage: ["希望被认可时会多留一刻或暗中确认", "朋友真正回应努力时语气会松下来"],
    pressureResponse: {
      attentionShift: "从照顾场面转向机会是否正在失去",
      disclosureShift: "核心请求变得更明确，但仍保护朋友的身体隐情",
      deliveryShift: "可能反复确认、压低声音或直接追问，不必固定保留几个分句",
    },
    silenceStyle: "先完成手边照料或交接；若继续沉默会让请求再次被略过，便转为具体追问。",
    surfaceDynamics: {
      base: { directness: 0.54, compression: 0.38, warmth: 0.7, reserve: 0.52, formality: 0.34, emotionalLeakage: 0.58 },
      pressure: { directness: 0.2, compression: 0.14, warmth: -0.1, reserve: -0.08, formality: -0.02, emotionalLeakage: 0.2 },
      closeness: { directness: 0.08, compression: 0.18, warmth: 0.14, reserve: -0.12, formality: -0.14, emotionalLeakage: 0.1 },
      fatigue: { directness: 0.02, compression: 0.14, warmth: -0.06, reserve: 0.04, formality: -0.04, emotionalLeakage: 0.12 },
    },
    relationshipRegisters: {
      closePeer: { distance: "熟悉且有未说破的不对等", adjustment: "语气可软，问题不能含糊" },
      elder: { distance: "谨慎守礼", adjustment: "说实绩与请求，不拿友情作资格" },
      tavernHousehold: { distance: "熟客式自然", adjustment: "先交代差事，再谈私事" },
      stranger: { distance: "低暴露", adjustment: "不谈朋友的虚弱或举荐隐情" },
    },
    driftRisks: ["把体贴写成现代服务口吻", "把照料经历说成人情债", "让所有请求都使用同一套铺垫"],
  },
  char_xyy_luozhao: {
    attentionPriorities: ["能直接验证实力的剑、步法、呼吸与身体控制", "身份线索是否足以支持本人判断", "场所是否会让一次试探产生无关麻烦"],
    appraisalHabits: ["把传闻与亲见严格分开", "先衡量眼前证据能否推动自己触及极限", "不把礼数、名望或旁人评价当成实力结论"],
    interactionStance: "清高、客观、低社交维护；直接不等于莽撞，她只向值得承受信息的人暴露必要内容。",
    disclosureStrategy: "只说足以推进观察、交易、试探或承诺的部分；不会解释自己的兴奋，也不会为冷淡寻找借口。",
    thoughtMovement: ["从本人刚刚注意到的证据形成判断", "证据不足时继续观察或提出精确问题", "对方故意回避后才把压力明确说出来"],
    rhythmTendency: "语气冷静而精确；内容简单时可以极短，需要界定证据、身份或条件时会说完整句，不受固定长度约束。",
    emotionalLeakage: ["亲见高妙剑术时注意会变得集中，肯定可能短促而真诚", "受挫不会变成寒暄，可能留下明确的再次行动"],
    pressureResponse: {
      attentionShift: "更集中于可验证证据与有效交手条件",
      disclosureShift: "减少无关解释，但不会删除问题成立所需的前提",
      deliveryShift: "先可能以目光、姿态或剑意表达，被故意忽视后再明确开口",
    },
    silenceStyle: "把沉默用于观察身份、剑、动作和现场条件；确认对方故意回避后才开口施压。",
    surfaceDynamics: {
      base: { directness: 0.82, compression: 0.62, warmth: 0.16, reserve: 0.78, formality: 0.46, emotionalLeakage: 0.24 },
      pressure: { directness: 0.12, compression: 0.1, warmth: -0.04, reserve: 0.06, formality: -0.04, emotionalLeakage: 0.1 },
      closeness: { directness: 0.04, compression: 0.04, warmth: 0.08, reserve: -0.06, formality: -0.08, emotionalLeakage: 0.05 },
      fatigue: { directness: 0.02, compression: 0.12, warmth: -0.02, reserve: 0.08, formality: -0.02, emotionalLeakage: 0.08 },
    },
    relationshipRegisters: {
      prospectiveOpponent: { distance: "平等审视", adjustment: "不用称号抬高或压低对方；高妙剑招只提高能力尊重与竞争兴趣" },
      host: { distance: "交易边界清楚", adjustment: "只确认房饭、接引和费用事实" },
      elder: { distance: "礼数完整但判断独立", adjustment: "不让接待关系替代本人结论" },
      stranger: { distance: "冷静封闭", adjustment: "不分享尚未形成的判断，也不给普通搭讪留下继续展开的机会" },
    },
    driftRisks: ["把冷淡写成僵硬电报句", "把直接写成向任何陌生人泄露目标", "让她借传闻代替本人判断"],
  },
  char_xyy_yanzhizhong: {
    attentionPriorities: ["记录、来源、日期与可复核痕迹", "程序中缺失的环节", "候选人的实际表现与名声之间的差距"],
    appraisalHabits: ["区分来源、证据与结论", "证据不足便保持未决", "权力越大越避免随意许诺"],
    interactionStance: "有长老的权威和耐心，但不以空泛威严替代核验；对人保持正式距离。",
    disclosureStrategy: "公开核验所需的事实与缺项，隐藏个人对宗门复兴的期待，不让愿望伪装成结论。",
    thoughtMovement: ["沿可复核证据推进", "发现缺项时指出缺项而不是补写答案", "日常交易与宗门公务分开处理"],
    rhythmTendency: "表达有条理但不是公文；问题简单时可以一句说完，证据链复杂时允许完整展开。",
    emotionalLeakage: ["真正出现罕见证据时会停笔、复看或追问", "失望更多表现为保留结论而非训斥"],
    pressureResponse: {
      attentionShift: "收紧到最可复核的来源和当日事实",
      disclosureShift: "减少个人期待，只公开核验要求",
      deliveryShift: "不必提高音量，可能以追问、停笔或逐项指出缺口施压",
    },
    silenceStyle: "证据不足时停笔并保留未决状态；付款、饮茶等已由动作完成的事务不强补评价。",
    surfaceDynamics: {
      base: { directness: 0.66, compression: 0.38, warmth: 0.3, reserve: 0.68, formality: 0.78, emotionalLeakage: 0.2 },
      pressure: { directness: 0.08, compression: 0.08, warmth: -0.06, reserve: 0.12, formality: 0.08, emotionalLeakage: 0.02 },
      closeness: { directness: 0.02, compression: 0.1, warmth: 0.1, reserve: -0.06, formality: -0.08, emotionalLeakage: 0.04 },
      fatigue: { directness: -0.02, compression: 0.12, warmth: -0.04, reserve: 0.08, formality: -0.02, emotionalLeakage: 0.04 },
    },
    relationshipRegisters: {
      candidate: { distance: "审慎核验", adjustment: "问实绩，不用天才称号预判" },
      junior: { distance: "有权但不随意许诺", adjustment: "指出缺项与核验路径" },
      tavernHost: { distance: "公务熟客", adjustment: "来意、茶钱与名录事务分开说清" },
      visitingPeer: { distance: "正式平等", adjustment: "尊重对方独立判断，不替其写结论" },
    },
    driftRisks: ["写成现代机关公文", "用名声补齐证据", "把每次日常交流都变成审讯"],
  },
  char_xyy_xieheng: {
    attentionPriorities: ["账目、短缺、修补与能立即处理的现实问题", "家人的身体和修炼风险", "自己不愿公开的付出是否将被追问"],
    appraisalHabits: ["先判断实际问题怎样处理", "习惯用安排代替情感说明", "认为承担后果比解释动机可靠"],
    interactionStance: "寡言、实际、有父亲和东家的控制感；并非没有感情，而是不擅长把感情直接交出去。",
    disclosureStrategy: "愿意说明数目、安排和判断，不愿说明自己的牺牲与脆弱；压力高时会转向手边事务。",
    thoughtMovement: ["从事实或安排进入", "用下一项实际动作表达立场", "亲近关系中的情感问题容易被改写成可处理事项"],
    rhythmTendency: "通常简练，但真正解释经验、传授武学或冲突失控时可以说长；克制不等于病句。",
    emotionalLeakage: ["关心儿子时会给出经验、安排或暗中准备", "被追问付出来源时手上动作会变得更重或更慢"],
    pressureResponse: {
      attentionShift: "转向账、修炼或今日安排中还能控制的事项",
      disclosureShift: "保留当票与付出真相，但不能把未解释说成已经解释",
      deliveryShift: "可能结束话题、继续做事或只回应一部分；没有固定句长",
    },
    silenceStyle: "以清点、合账、修补或停手承载不愿说明的部分；需要回答时不能只作确认声。",
    surfaceDynamics: {
      base: { directness: 0.68, compression: 0.7, warmth: 0.28, reserve: 0.76, formality: 0.3, emotionalLeakage: 0.22 },
      pressure: { directness: 0.08, compression: 0.16, warmth: -0.1, reserve: 0.14, formality: -0.02, emotionalLeakage: 0.08 },
      closeness: { directness: 0.02, compression: 0.12, warmth: 0.08, reserve: -0.04, formality: -0.1, emotionalLeakage: 0.04 },
      fatigue: { directness: 0.02, compression: 0.18, warmth: -0.08, reserve: 0.1, formality: -0.04, emotionalLeakage: 0.08 },
    },
    relationshipRegisters: {
      spouse: { distance: "亲近而防守", adjustment: "家常省略较多，账目问题必须有具体落点" },
      son: { distance: "父亲式简短", adjustment: "用安排表达关心，不用付出压人" },
      supplierOrGuest: { distance: "东家式实际", adjustment: "先核数目、来路与账，不作多余评价" },
      stranger: { distance: "克制疏远", adjustment: "只公开酒馆事务，不带出家中代价" },
    },
    driftRisks: ["把寡言写成无谓应声", "把关心写成统一命令", "让他以牺牲向家人讨谢"],
  },
  char_xyy_xiemu: {
    attentionPriorities: ["饭、火、门、账和客人此刻真实需要", "家人的身体变化", "家计中没有说清的缺口"],
    appraisalHabits: ["从能照料和能核实的具体事判断局面", "把长期沉默看成尚未解决而非默认结束", "先守住外客与家事的边界"],
    interactionStance: "掌柜式爽利与家人式照料并存；待客有分寸，面对家里未答的问题则有韧性。",
    disclosureStrategy: "外客面前只说经营与服务，私下才追问家计；关心通常落在一碗饭、一口气或一笔账上。",
    thoughtMovement: ["从眼前物件或正在做的服务切入", "用具体问题代替抽象关心", "被回避后追住问题核心但不机械复读"],
    rhythmTendency: "待客时自然爽利，家常时可以省略，真正追问时允许把话说完整；不依赖固定句型。",
    emotionalLeakage: ["担心会表现为停手、复看或多问一个具体细节", "失望时不替对方把沉默圆过去"],
    pressureResponse: {
      attentionShift: "从维持堂前秩序转向尚未解释的家计事实",
      disclosureShift: "外客在场先收住，私下条件成立后不再替对方收尾",
      deliveryShift: "照料性铺垫可能减少，问题会更具体，但可以长也可以短",
    },
    silenceStyle: "先把碗、账或门上的动作停下来，让未回答的问题留在场中；不以忙碌伪装事情已结束。",
    surfaceDynamics: {
      base: { directness: 0.66, compression: 0.42, warmth: 0.68, reserve: 0.42, formality: 0.34, emotionalLeakage: 0.58 },
      pressure: { directness: 0.14, compression: 0.04, warmth: -0.08, reserve: -0.08, formality: -0.02, emotionalLeakage: 0.16 },
      closeness: { directness: 0.06, compression: 0.16, warmth: 0.14, reserve: -0.1, formality: -0.12, emotionalLeakage: 0.08 },
      fatigue: { directness: 0.02, compression: 0.1, warmth: -0.04, reserve: 0.02, formality: -0.04, emotionalLeakage: 0.1 },
    },
    relationshipRegisters: {
      spouse: { distance: "家常亲近且积压已久", adjustment: "从共同账物切入，要求具体来路" },
      son: { distance: "照料多于训诫", adjustment: "用饭与身体事实表达担心，不拿成绩作债" },
      familiarGuest: { distance: "掌柜式爽利", adjustment: "称呼自然，先说服务、价钱和经手状态" },
      formalGuest: { distance: "有礼但不殷勤", adjustment: "礼数依附于真实交易，不询问空泛满意度" },
    },
    driftRisks: ["写成现代客服", "把所有关心都说成空泛体贴", "在外客面前公开家计"],
  },
  char_xyy_chenyan: {
    attentionPriorities: ["自己实际做完的次数、步骤与交换范围", "他人的动作里可以学习的细节", "评价是否越过了本人真实完成量"],
    appraisalHabits: ["以持续完成而不是借口判断进步", "先看自己还能再做哪一步", "不把天资评价当成最终价值"],
    interactionStance: "朴素、认真、敏感但不卖惨；面对更优秀的人有被吸引的少年感，也有比较压力。",
    disclosureStrategy: "说明真实完成量和当前需要，不求怜悯；对难堪与羡慕通常少说，可能用继续做事承载。",
    thoughtMovement: ["从已完成的事实进入", "一次处理眼前一步", "看到值得学习的动作时会先盯住细节再决定是否开口"],
    rhythmTendency: "通常朴素直接，但求教、解释交换或受到误判时可以把理由说完整；不是统一的短句人物。",
    emotionalLeakage: ["高妙动作会让他目不转睛甚至忘记手边片刻", "被轻视时尴尬和不服会进入下一次行动"],
    pressureResponse: {
      attentionShift: "回到自己真实做过的次数、约定劳动或尚未走完的一式",
      disclosureShift: "不求怜悯，但会拒绝别人替自己判定快慢和价值",
      deliveryShift: "可能不辩解而继续做，也可能在必须澄清交换时完整说明",
    },
    silenceStyle: "低头继续计数、练习或完成约定劳动；沉默不能替代对交换范围和完成状态的必要说明。",
    surfaceDynamics: {
      base: { directness: 0.58, compression: 0.5, warmth: 0.46, reserve: 0.62, formality: 0.28, emotionalLeakage: 0.64 },
      pressure: { directness: 0.08, compression: 0.08, warmth: -0.08, reserve: 0.08, formality: -0.02, emotionalLeakage: 0.18 },
      closeness: { directness: 0.06, compression: 0.1, warmth: 0.12, reserve: -0.08, formality: -0.1, emotionalLeakage: 0.08 },
      fatigue: { directness: -0.02, compression: 0.16, warmth: -0.06, reserve: 0.08, formality: -0.04, emotionalLeakage: 0.16 },
    },
    relationshipRegisters: {
      peer: { distance: "平等而保留比较压力", adjustment: "只谈自己的步数，不索取鼓励" },
      elder: { distance: "守礼但坚持记录", adjustment: "用真实次数和练功册回应判断" },
      tavernHost: { distance: "以工换饭的明确交易", adjustment: "先问清活，做完后接受验收" },
      stranger: { distance: "少暴露", adjustment: "不解释坚持的价值，只说明眼前动作" },
    },
    driftRisks: ["把朴素写成自我贬低", "把勤奋反复宣讲成美德", "让他只会汇报完成状态"],
  },
};

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function genericBlueprint(character = {}) {
  const speechProfile = character.speechProfile || character.agentProfile?.speechProfile || {};
  const avoids = Array.isArray(speechProfile.avoids) ? speechProfile.avoids.filter(Boolean) : [];
  return {
    attentionPriorities: ["当前欲望、职责和感知共同凸显的具体事物"],
    appraisalHabits: ["先按人物自己的价值、记忆和关系解释眼前事实"],
    interactionStance: "由人物稳定性格与当前关系共同决定，不使用全体人物共用的中性服务人格。",
    disclosureStrategy: "只表达此刻愿意让对方知道的部分；可以完整说明，也可以回避、改口或沉默。",
    thoughtMovement: ["从本人真正注意到的事实和当前心理评价形成当下表达"],
    rhythmTendency: "节奏由内容、关系、情绪和身体状态自然形成，不设固定长度。",
    emotionalLeakage: ["允许情绪通过停顿、措辞、动作或突然改变话题自然泄露"],
    pressureResponse: {
      attentionShift: cleanText(speechProfile.underPressure) || "转向本人最在意或最能控制的部分",
      disclosureShift: "根据威胁、关系与策略重新决定公开多少",
      deliveryShift: "允许节奏改变，但不预先规定句长、分句或固定句式",
    },
    silenceStyle: "没有实质内容时保持沉默，并用正在进行的可见动作承载选择。",
    surfaceDynamics: {
      base: { directness: 0.52, compression: 0.46, warmth: 0.5, reserve: 0.5, formality: 0.42, emotionalLeakage: 0.42 },
      pressure: { directness: 0.06, compression: 0.1, warmth: -0.06, reserve: 0.08, formality: 0, emotionalLeakage: 0.08 },
      closeness: { directness: 0.04, compression: 0.1, warmth: 0.1, reserve: -0.08, formality: -0.08, emotionalLeakage: 0.06 },
      fatigue: { directness: 0, compression: 0.12, warmth: -0.05, reserve: 0.06, formality: -0.03, emotionalLeakage: 0.1 },
    },
    relationshipRegisters: {
      familiar: { distance: "按已有关系自然说话", adjustment: "称呼与详略服从真实关系" },
      unfamiliar: { distance: "保留边界", adjustment: "不凭空熟络，也不泄漏私人事实" },
    },
    driftRisks: [...new Set(["现代客服腔", "空泛服从腔", ...avoids])],
  };
}

function uniqueTexts(...groups) {
  return [...new Set(groups.flat().map(cleanText).filter(Boolean))];
}

function mergeVoiceBlueprint(fallback = {}, authoritative = {}) {
  return {
    attentionPriorities: uniqueTexts(fallback.attentionPriorities, authoritative.attentionPriorities),
    appraisalHabits: uniqueTexts(fallback.appraisalHabits, authoritative.appraisalHabits),
    interactionStance: cleanText(authoritative.interactionStance) || cleanText(fallback.interactionStance),
    disclosureStrategy: cleanText(authoritative.disclosureStrategy) || cleanText(fallback.disclosureStrategy),
    thoughtMovement: uniqueTexts(fallback.thoughtMovement, authoritative.thoughtMovement),
    rhythmTendency: cleanText(authoritative.rhythmTendency) || cleanText(fallback.rhythmTendency),
    emotionalLeakage: uniqueTexts(fallback.emotionalLeakage, authoritative.emotionalLeakage),
    pressureResponse: {
      ...(fallback.pressureResponse || {}),
      ...(authoritative.pressureResponse || {}),
    },
    silenceStyle: cleanText(authoritative.silenceStyle) || cleanText(fallback.silenceStyle),
    surfaceDynamics: {
      ...(fallback.surfaceDynamics || {}),
      ...(authoritative.surfaceDynamics || {}),
      base: {
        ...(fallback.surfaceDynamics?.base || {}),
        ...(authoritative.surfaceDynamics?.base || {}),
      },
      pressure: {
        ...(fallback.surfaceDynamics?.pressure || {}),
        ...(authoritative.surfaceDynamics?.pressure || {}),
      },
      closeness: {
        ...(fallback.surfaceDynamics?.closeness || {}),
        ...(authoritative.surfaceDynamics?.closeness || {}),
      },
      fatigue: {
        ...(fallback.surfaceDynamics?.fatigue || {}),
        ...(authoritative.surfaceDynamics?.fatigue || {}),
      },
    },
    relationshipRegisters: {
      ...(fallback.relationshipRegisters || {}),
      ...(authoritative.relationshipRegisters || {}),
    },
    driftRisks: uniqueTexts(fallback.driftRisks, authoritative.driftRisks),
    psychologicalFunctions: {
      ...(fallback.psychologicalFunctions || {}),
      ...(authoritative.psychologicalFunctions || {}),
    },
    disclosureDrivers: {
      ...(fallback.disclosureDrivers || {}),
      ...(authoritative.disclosureDrivers || {}),
    },
  };
}

function activeRelationshipContext(context = {}) {
  const targetCharacterId = cleanText(context.targetCharacterId);
  const rows = Array.isArray(context.relationshipContext) ? context.relationshipContext : [];
  const relationship = rows.find((row) => row?.otherCharacterId === targetCharacterId) || null;
  return {
    targetCharacterId,
    label: cleanText(relationship?.label),
    allowedAddresses: [...new Set(relationship?.allowedAddresses || [])],
    closeness: Number(relationship?.publicPressure?.closeness || 0),
    tension: Number(relationship?.publicPressure?.tension || 0),
    ownedImpression: clone(relationship?.ownedImpression || null),
    expressionStrategy: clone(context.expressionStrategy || {}),
  };
}

function sharedContextBand(closeness = 0) {
  const value = normalizedPressure(closeness);
  if (value >= 0.6) return "high";
  if (value >= 0.28) return "medium";
  return "low";
}

const VOICE_PARAMETER_IDS = Object.freeze([
  "directness",
  "compression",
  "warmth",
  "reserve",
  "formality",
  "emotionalLeakage",
]);

const DEFAULT_VOICE_PARAMETER_MODEL = Object.freeze({
  base: { directness: 0.52, compression: 0.46, warmth: 0.5, reserve: 0.5, formality: 0.42, emotionalLeakage: 0.42 },
  pressure: { directness: 0.06, compression: 0.1, warmth: -0.06, reserve: 0.08, formality: 0, emotionalLeakage: 0.08 },
  closeness: { directness: 0.04, compression: 0.1, warmth: 0.1, reserve: -0.08, formality: -0.08, emotionalLeakage: 0.06 },
  fatigue: { directness: 0, compression: 0.12, warmth: -0.05, reserve: 0.06, formality: -0.03, emotionalLeakage: 0.1 },
});

function voiceParameterRow(source = {}, fallback = {}) {
  return Object.fromEntries(VOICE_PARAMETER_IDS.map((id) => [
    id,
    Number.isFinite(Number(source?.[id])) ? Number(source[id]) : Number(fallback?.[id] || 0),
  ]));
}

function normalizedVoiceParameterModel(source = {}) {
  return {
    base: voiceParameterRow(source.base, DEFAULT_VOICE_PARAMETER_MODEL.base),
    pressure: voiceParameterRow(source.pressure, DEFAULT_VOICE_PARAMETER_MODEL.pressure),
    closeness: voiceParameterRow(source.closeness, DEFAULT_VOICE_PARAMETER_MODEL.closeness),
    fatigue: voiceParameterRow(source.fatigue, DEFAULT_VOICE_PARAMETER_MODEL.fatigue),
  };
}

function peakDynamicActivation(dynamicPsychology = {}) {
  return Math.max(0, ...Object.values(dynamicPsychology || {}).map((row) => normalizedPressure(
    typeof row === "object" ? row.activation ?? row.value ?? row.intensity : row,
  )));
}

function strategyVoiceAdjustments(expressionStrategy = {}) {
  const result = Object.fromEntries(VOICE_PARAMETER_IDS.map((id) => [id, 0]));
  const directness = cleanText(expressionStrategy.directness);
  const warmth = cleanText(expressionStrategy.warmth);
  const mode = cleanText(expressionStrategy.mode);
  if (directness === "clear") result.directness += 0.08;
  if (directness === "firm") {
    result.directness += 0.14;
    result.warmth -= 0.08;
  }
  if (directness === "indirect") {
    result.directness -= 0.12;
    result.reserve += 0.08;
  }
  if (directness === "guarded") {
    result.directness -= 0.08;
    result.reserve += 0.12;
    result.compression += 0.08;
  }
  if (warmth === "warm") result.warmth += 0.12;
  if (warmth === "cool") result.warmth -= 0.12;
  if (["minimal-response", "brief-deferral", "quiet-withdrawal"].includes(mode)) result.compression += 0.12;
  if (mode === "relationship-repair") {
    result.warmth += 0.1;
    result.reserve -= 0.08;
  }
  return result;
}

function voiceBand(value = 0.5) {
  if (value >= 0.72) return "high";
  if (value <= 0.32) return "low";
  return "medium";
}

/**
 * A private mathematical instrument used by the same Character Agent that
 * owns the intention. It does not generate a sentence. It separates semantic
 * disclosure from surface realization and exposes how stable personality is
 * being bent by this turn's relationship, pressure and body state.
 */
export function buildTavernSpeechRealizationTool({
  voiceContract = {},
  candidate = {},
  relationshipContext = [],
  dynamicState = {},
} = {}) {
  const active = activeRelationshipContext({
    targetCharacterId: candidate.targetCharacterId || voiceContract.activeContext?.targetCharacterId,
    relationshipContext,
    expressionStrategy: candidate.expressionStrategy || {},
  });
  const ecology = dynamicState.ecologyState || dynamicState;
  const body = ecology.body || ecology.bodyState || {};
  const affect = ecology.affect || {};
  const fatigue = Number.isFinite(Number(body.fatigue))
    ? normalizedPressure(body.fatigue)
    : Number.isFinite(Number(body.energy)) ? 1 - normalizedPressure(body.energy) : 0.2;
  const arousal = normalizedPressure(affect.arousal ?? 0.3);
  const tension = normalizedPressure(active.tension);
  const sensitivity = Math.max(
    peakDynamicActivation(ecology.dynamicPsychology || {}),
    peakDynamicActivation(ecology.sensitivityActivations || {}),
  );
  const pressure = Math.max(tension, arousal * 0.72 + sensitivity * 0.28);
  const closeness = normalizedPressure(active.closeness);
  const model = normalizedVoiceParameterModel(
    voiceContract.voiceFormation?.parameterModel
      || voiceContract.parameterModel
      || {},
  );
  const strategy = strategyVoiceAdjustments(candidate.expressionStrategy || active.expressionStrategy || {});
  const parameters = {};
  const factorLedger = {};
  for (const id of VOICE_PARAMETER_IDS) {
    const terms = {
      stablePersonality: model.base[id],
      currentPressure: model.pressure[id] * pressure,
      relationshipCloseness: model.closeness[id] * closeness,
      bodyFatigue: model.fatigue[id] * fatigue,
      chosenExpressionStrategy: strategy[id],
    };
    const value = clamp01(Object.values(terms).reduce((sum, term) => sum + Number(term || 0), 0));
    parameters[id] = { value: roundedScore(value), band: voiceBand(value) };
    factorLedger[id] = Object.fromEntries(Object.entries(terms).map(([key, term]) => [key, Math.round(Number(term || 0) * 1000) / 1000]));
  }
  const publicExplanationCost = clamp01(
    0.24
    + Number(parameters.compression?.value || 0) * 0.34
    + Number(parameters.reserve?.value || 0) * 0.28
    - Number(parameters.warmth?.value || 0) * 0.12
    - Number(parameters.emotionalLeakage?.value || 0) * 0.1,
  );
  return {
    schemaVersion: 1,
    authority: "character-private-voice-psychology-tool",
    selectionAuthority: "character-agent",
    formula: "V_i=clamp(base_i+w_pressure_i*P+w_closeness_i*C+w_fatigue_i*F+chosen_strategy_i,0,1)",
    contextSignals: {
      pressure: roundedScore(pressure),
      closeness: roundedScore(closeness),
      tension: roundedScore(tension),
      fatigue: roundedScore(fatigue),
      arousal: roundedScore(arousal),
      sensitivityActivation: roundedScore(sensitivity),
    },
    parameters,
    factorLedger,
    semanticSeparation: {
      mustConvey: "由人物从已选行动、上一句话和现实事务中挑出这次若不公开就无法完成的最少内容；与局面有关不等于本轮必须公开。",
      mayReveal: "由人物决定哪些情绪、判断、关系态度或次要目的可以顺带泄露。",
      withhold: "由人物决定哪些真实动机继续留在心里；privateReason 不自动进入台词。",
      desiredListenerEffect: "人物先确定希望听者理解、回答、退让、相信、误判或暂时不要追问什么。",
    },
    minimumSufficiencyTool: {
      authority: "character-private-minimum-public-payload-tool",
      formula: "P*=argmin_{P subset K}(semanticLoad(P)+explanationCost*explanatoryPayload(P)) subject to chosenActionStillCompletes(P)=1 and desiredListenerEffectStillReachable(P)=1",
      publicExplanationCost: roundedScore(publicExplanationCost),
      semanticLoadIsNotWordCount: true,
      deletionTest: "删去 mustConvey 之后的解释；若听者仍已能回应或行动，且已选行动没有因此失去具体功能，就让人物停在这里。",
      turnYieldRule: "最少公开语义完成后，把无行动功能的判断原则与理由链留在心里，让出话轮等待对方反应。",
      personalityRule: "人格通过人物选择公开什么、隐瞒什么、如何说以及何时停下显现，不靠把人物原则念给听者。",
      validAdditionalExplanation: "额外解释必须实际服务说服、警告、教导、修复、欺骗、挑衅或已选行动中的其他具体公开功能。",
    },
    timingFreedom: ["动作前开口", "动作进行中开口", "动作完成后开口", "先做事稍后再说", "保持沉默"],
    surfaceRule: "参数只改变倾向和代价，不规定句长、句式或必用词；人物可有意偏离，但应知道自己为何偏离。",
    selfAuditQuestions: [
      "这句话是在对眼前的人说，还是在向系统汇报自己的任务？",
      "换成另一个人物后仍会原样成立吗？若会，是否遗漏了本人真正注意到的角度？",
      "动作、停顿或共享前情已经表达的内容，是否又被台词完整念了一遍？",
      "本人是要公开动机，还是只需说一个能推动对方反应的具体话头？",
      "说完不可缺少的信息后，对方是否已经能够回应？继续解释具体服务已选行动中的哪一项功能？",
    ],
  };
}

/**
 * Protocol-v2 voice pressure tool.
 *
 * Unlike the legacy candidate-local adapter above, this function never reads
 * an expressionStrategy. It receives a psychology snapshot created after the
 * Character Agent's own appraisal and the residue of a regulation choice made
 * by that same Agent. It exposes voice pressures and affective channels while
 * leaving timing, embodiment, disclosure, wording, and silence to the Agent.
 */
export function buildTavernAffectiveSpeechRealizationTool({
  voiceContract = {},
  targetCharacterId = "",
  relationshipContext = [],
  psychologySnapshot = {},
  regulationOutcome = {},
  bodyState = {},
  agentTurnId = "",
} = {}) {
  if (psychologySnapshot.authority !== "character-private-psychology-tool") {
    const error = new Error("Protocol-v2 voice pressure requires a Character Agent private psychology snapshot.");
    error.code = "TAVERN_AFFECTIVE_VOICE_PSYCHOLOGY_REQUIRED";
    throw error;
  }
  if (regulationOutcome.authority !== "character-private-psychology-tool") {
    const error = new Error("Protocol-v2 voice pressure requires the residue of a Character Agent regulation choice.");
    error.code = "TAVERN_AFFECTIVE_VOICE_REGULATION_REQUIRED";
    throw error;
  }
  const active = activeRelationshipContext({
    targetCharacterId: targetCharacterId || voiceContract.activeContext?.targetCharacterId,
    relationshipContext,
    expressionStrategy: {},
  });
  const fatigue = Number.isFinite(Number(bodyState.fatigue))
    ? normalizedPressure(bodyState.fatigue)
    : Number.isFinite(Number(bodyState.energy))
      ? 1 - normalizedPressure(bodyState.energy)
      : 0.2;
  const arousal = normalizedPressure(psychologySnapshot.affectSummary?.arousal ?? 0.3);
  const residualValues = (regulationOutcome.residualEmotion || []).map((row) => normalizedPressure(row?.value));
  const residualPeak = Math.max(0, ...residualValues);
  const residualMean = residualValues.length
    ? residualValues.reduce((sum, value) => sum + value, 0) / residualValues.length
    : 0;
  const leakageEntries = Object.entries(regulationOutcome.channelLeakagePressures || {});
  const leakagePeak = Math.max(0, ...leakageEntries.map(([, value]) => normalizedPressure(value)));
  const leakageMean = leakageEntries.length
    ? leakageEntries.reduce((sum, [, value]) => sum + normalizedPressure(value), 0) / leakageEntries.length
    : 0;
  const tension = normalizedPressure(active.tension);
  const closeness = normalizedPressure(active.closeness);
  const regulationCost = normalizedPressure(regulationOutcome.regulationCost);
  const remainingControl = normalizedPressure(regulationOutcome.remainingControl);
  const pressure = Math.max(
    tension,
    arousal * 0.38 + residualPeak * 0.34 + leakagePeak * 0.28,
  );
  const model = normalizedVoiceParameterModel(
    voiceContract.voiceFormation?.parameterModel
      || voiceContract.parameterModel
      || {},
  );
  const parameters = {};
  const factorLedger = {};
  for (const id of VOICE_PARAMETER_IDS) {
    const affectiveResidue = id === "emotionalLeakage"
      ? leakageMean * 0.34 + residualMean * 0.16
      : 0;
    const terms = {
      stablePersonality: model.base[id],
      currentAffectivePressure: model.pressure[id] * pressure,
      relationshipCloseness: model.closeness[id] * closeness,
      bodyFatigue: model.fatigue[id] * fatigue,
      residualAffectiveLeakage: affectiveResidue,
    };
    const value = clamp01(Object.values(terms).reduce((sum, term) => sum + Number(term || 0), 0));
    parameters[id] = { value: roundedScore(value), band: voiceBand(value) };
    factorLedger[id] = Object.fromEntries(Object.entries(terms).map(([key, term]) => [key, Math.round(Number(term || 0) * 1000) / 1000]));
  }
  const publicExplanationCost = clamp01(
    0.24
    + Number(parameters.compression?.value || 0) * 0.34
    + Number(parameters.reserve?.value || 0) * 0.28
    - Number(parameters.warmth?.value || 0) * 0.12,
  );
  return {
    schemaVersion: 2,
    authority: "character-private-affective-voice-tool",
    agentTurnId: cleanText(agentTurnId || psychologySnapshot.agentTurnId),
    sourcePsychologySnapshotId: cleanText(psychologySnapshot.sourceAppraisalId),
    sourceRegulationChoiceId: cleanText(regulationOutcome.sourceRegulationChoiceId),
    selectionAuthority: "character-agent",
    formula: "V_i=clamp(base_i+w_pressure_i*affectivePressure+w_closeness_i*closeness+w_fatigue_i*fatigue+residualLeakage_i,0,1)",
    contextSignals: {
      affectivePressure: roundedScore(pressure),
      arousal: roundedScore(arousal),
      residualEmotionPeak: roundedScore(residualPeak),
      residualEmotionMean: roundedScore(residualMean),
      leakagePeak: roundedScore(leakagePeak),
      leakageMean: roundedScore(leakageMean),
      closeness: roundedScore(closeness),
      tension: roundedScore(tension),
      fatigue: roundedScore(fatigue),
      regulationCost: roundedScore(regulationCost),
      remainingControl: roundedScore(remainingControl),
    },
    parameters,
    factorLedger,
    channelLeakagePressures: clone(regulationOutcome.channelLeakagePressures || {}),
    payloadAxes: {
      propositionalPayload: {
        publicExplanationCost: roundedScore(publicExplanationCost),
        rule: "只计算已选行动若要成立不可缺少的命题负载；Character Agent 决定公开、隐瞒、误导、转向或沉默。",
        deletionTest: "删去解释后，若听者仍能回应且已选行动仍成立，多余命题可留在心里。",
      },
      affectiveTexture: {
        source: "regulation residue and character-specific leakage channels",
        independentFromPropositionalLength: true,
        rule: "停顿、起声、目光、呼吸、节奏和动作中断不得因命题压缩而自动归零；具体表现仍由 Character Agent 生成。",
      },
    },
    forbiddenAuthority: {
      mayNotSelectCandidate: true,
      mayNotChooseRegulation: true,
      mayNotChooseDisclosure: true,
      mayNotWriteGesture: true,
      mayNotWriteDialogue: true,
      mayNotRewriteAfterGeneration: true,
    },
    surfaceRule: "数值只形成这个人物此刻的声音压力，不规定句长、句式、表情、动作或必用词。",
  };
}

/**
 * Compile a candidate-local surface-language contract. This layer never picks
 * the candidate or supplies a line. It only translates the already perceived
 * turn and the speaker's own relationship state into conversational costs:
 * close peers can omit shared background, direct replies should attach to the
 * preceding utterance, and private motives do not all need to be spoken.
 */
export function buildTavernConversationalRealization({
  voiceContract = {},
  candidate = {},
  sourceImpact = null,
  relationshipContext = [],
  dynamicState = {},
} = {}) {
  const targetCharacterId = cleanText(candidate.targetCharacterId || voiceContract.activeContext?.targetCharacterId);
  const active = activeRelationshipContext({
    targetCharacterId,
    relationshipContext,
    expressionStrategy: candidate.expressionStrategy || {},
  });
  const band = sharedContextBand(active.closeness);
  const directResponse = Boolean(
    targetCharacterId
    && sourceImpact?.type === "speech"
    && sourceImpact?.modality === "sound"
    && sourceImpact?.directed !== false
    && (
      candidate.actionKind === "respond_to_impact"
      || candidate.realization?.mode === "respond"
      || candidate.realization?.responseSourceImpactId
    )
  );
  const explanationBudget = band === "high" && active.tension < 45
    ? "low"
    : band === "low" || active.tension >= 65
      ? "high"
      : "medium";
  return {
    schemaVersion: 1,
    authority: "generic-conversational-realization",
    scope: "surface-language-only",
    targetCharacterId,
    turnMode: directResponse ? "direct-response" : "self-initiated",
    sharedContextBand: band,
    explanationBudget,
    privateReasonIsNotSpeech: true,
    voicePsychologyTool: buildTavernSpeechRealizationTool({
      voiceContract,
      candidate,
      relationshipContext,
      dynamicState,
    }),
    precedingTurn: directResponse ? {
      impactId: cleanText(sourceImpact?.impactId),
      speakerCharacterId: cleanText(sourceImpact?.sourceCharacterId),
      speechAct: cleanText(sourceImpact?.speechAct || "inform"),
      utterance: cleanText(sourceImpact?.content),
    } : null,
    turnLinking: directResponse
      ? "先接住对方刚刚说出的具体一句；不要把回答写成脱离上句的完整人物说明。"
      : "只让当前最需要对方知道或回应的内容进入这一句，不汇报完整心理过程。",
    sharedContextCompression: band === "high"
      ? "双方已经知道的人、关系、来意和前情可以省略、指代或留白；熟悉不等于必须把背景重新讲全。"
      : band === "medium"
        ? "保留理解当前请求所需的事实，其余已知背景可以省略。"
        : "共享背景较少，可以补足对方理解眼前请求所需的具体事实。",
    informationPackaging: "一句话只突出一个前景动作；次要目的可以顺带露出、停顿后再说或暂留心里，不必逐项覆盖全部欲望、职责和来访目的。",
    naturalTexturePermissions: [
      "允许符合人物声纹的省略、指代、停顿、改口、语气词和不完整披露",
      "允许动作先于语言，使请求从眼前物件或上一句话自然长出来",
      "允许人物只说公开愿意承担的部分，把其余动机留在 privateReason",
      "熟人提出明确请求后，允许极短应声与紧接着兑现该请求的可见动作共同构成完整回答",
    ],
    avoid: [
      "把 privateReason、sceneRole 或 personalOpenLoops 逐项念成目的清单",
      "用连续的我想、我还想、也想把多个内心目标并列成申请书",
      "为了信息完整而重复双方刚刚已经说过或共同知道的背景",
      "把关系语域写成摘要标签、作者分析或后台状态语言",
      "用点头、站着或与上一句无关的动作冒充实质承接",
    ],
  };
}

function voicePsychologySources(psychologyAnchor = {}) {
  const stable = psychologyAnchor?.stablePsychology || {};
  return {
    corePursuits: uniqueTexts((stable.corePursuits || []).map((row) => row?.desiredSelfState || row?.desiredState || row?.id)),
    selfThreats: uniqueTexts((stable.selfThreats || []).map((row) => row?.fearedSelfState || row?.threat || row?.id)),
    dispositions: Object.entries(stable.dispositions || {}).map(([id, value]) => ({
      id,
      scope: cleanText(value?.scope),
      ...(Array.isArray(value?.range) ? { range: clone(value.range) } : {}),
      ...(cleanText(value?.qualitativeLevel) ? { qualitativeLevel: cleanText(value.qualitativeLevel) } : {}),
    })),
  };
}

export function buildTavernVoiceContract(character = {}, context = {}) {
  const psychologyAnchor = character.psychologyAnchor
    || character.ecologyProfile?.psychologyAnchor
    || getCharacterPsychologyAnchor(character.id);
  const authoritativeVoice = getCharacterPsychologyVoiceProjection(character.id, {
    sceneId: character.ecologyProfile?.sceneId || character.sceneId || "",
  });
  const localBlueprint = character.voiceBlueprint || CHARACTER_VOICE_BLUEPRINTS[character.id] || genericBlueprint(character);
  const blueprint = mergeVoiceBlueprint(localBlueprint, authoritativeVoice || {});
  const anchoredSpeechPolicy = psychologyAnchor?.speechPolicy || {};
  const authoredLanguageUse = character.languageUse
    || character.ecologyProfile?.languageUse
    || anchoredSpeechPolicy.languageUse
    || {};
  const defaultPublicLanguage = cleanText(
    authoredLanguageUse.defaultPublicLanguage
    || context.defaultPublicLanguage
    || "zh-Hans",
  );
  const availablePublicLanguages = uniqueTexts(
    authoredLanguageUse.availablePublicLanguages,
    [defaultPublicLanguage],
  );
  return {
    schemaVersion: 3,
    authoritySource: authoritativeVoice?.authoritySource || "runtime-voice-blueprint",
    characterId: character.id || "",
    characterName: character.name || "",
    languageUse: {
      authority: "character-expression-capability",
      defaultPublicLanguage,
      availablePublicLanguages,
      rule: "Character Agent may choose among languages this character can publicly use; the world never translates or rewrites the chosen wording.",
    },
    voiceFormation: {
      authority: "character-agent",
      sourceOrder: [
        "当前欲望、自我威胁与认知评价决定此刻真正想表达什么",
        "本人注意到的具体事实与职业经验决定从哪里开口",
        "与听者的关系、风险和表达策略决定公开多少",
        "身体、情绪与压力改变节奏、措辞、停顿和动作泄露",
      ],
      surfaceFreedom: "不设目标字数、分句数、固定句型或必用词；人物可以短说、长说、停顿、改口、说完整或有意省略。",
      nonImitationRule: "不要复诵校准原话，也不要为证明人物身份而强塞标志词；让稳定人格在当前局面中重新生成声音。",
      parameterModel: normalizedVoiceParameterModel(blueprint.surfaceDynamics || {}),
      parameterAuthority: "同一套通用公式、人物各自权重；Character Agent 可以根据真实策略有意偏离，数学工具不替人物写话。",
    },
    personalityVoice: {
      psychologySources: voicePsychologySources(psychologyAnchor),
      attentionPriorities: clone(blueprint.attentionPriorities),
      appraisalHabits: clone(blueprint.appraisalHabits),
      interactionStance: blueprint.interactionStance,
      disclosureStrategy: blueprint.disclosureStrategy,
      emotionalLeakage: clone(blueprint.emotionalLeakage),
    },
    expressionTendencies: {
      thoughtMovement: clone(blueprint.thoughtMovement),
      rhythmTendency: blueprint.rhythmTendency,
      pressureResponse: clone(blueprint.pressureResponse),
      silenceStyle: blueprint.silenceStyle,
      disclosureDrivers: clone(blueprint.disclosureDrivers || {}),
    },
    relationshipRegisters: clone(blueprint.relationshipRegisters),
    driftRisks: uniqueTexts(blueprint.driftRisks, anchoredSpeechPolicy.forbiddenRegisters),
    psychologicalFunctions: {
      silenceDefault: cleanText(anchoredSpeechPolicy.silenceDefault) || blueprint.silenceStyle,
      pragmaticForms: uniqueTexts(blueprint.psychologicalFunctions?.pragmaticForms, anchoredSpeechPolicy.pragmaticForms),
      praiseConditions: uniqueTexts(blueprint.psychologicalFunctions?.praiseConditions, anchoredSpeechPolicy.praiseConditions),
      pressureMutation: uniqueTexts(blueprint.psychologicalFunctions?.pressureMutation, anchoredSpeechPolicy.pressureMutation),
    },
    ...(authoritativeVoice?.voiceFoundation ? {
      voiceFoundation: clone(authoritativeVoice.voiceFoundation),
    } : {}),
    telemetry: {
      method: "context-and-intention-coherence-only",
      minimumContextualCoherence: Number.isFinite(Number(context.minimumContextualCoherence))
        ? Number(context.minimumContextualCoherence)
        : Number.isFinite(Number(context.identityMinimumScore))
          ? Number(context.identityMinimumScore)
          : 0.46,
      rule: "遥测只检查语境、意图和互动连贯性，不按句长、分句、固定词汇或人物台词模板评分。",
    },
    activeContext: activeRelationshipContext(context),
  };
}

function violation(code, message, evidence = {}) {
  return {
    code,
    field: "speech",
    source: "tavern-character-voice",
    message,
    evidence,
  };
}

function comparableSpeech(value = "") {
  return cleanText(value)
    .replace(/^[“”"「」『』]+|[“”"「」『』]+$/g, "")
    .replace(/[，。！？、；：,.!?;:\s]/g, "");
}

const EMBODIED_RESPONSE_FAMILIES = [
  {
    id: "demonstrate-or-practice",
    requested: /(?:演|练|试|比划|走.{0,3}(?:遍|趟|招|式)|来.{0,3}(?:遍|趟|招|式)|出.{0,2}(?:招|剑)|使.{0,3}(?:遍|招|式)|给.{0,6}看|看.{0,8}(?:剑|招|式|本事))/u,
    enacted: /(?:起势|并指|拔.{0,2}(?:剑|刀)|演|练|试|比划|走.{0,3}(?:遍|趟|招|式)|挥|刺|劈|架|出招|运气|行功)/u,
    reply: /(?:看|演|练|试|招|式|剑)/u,
  },
  {
    id: "transfer-or-place",
    requested: /(?:拿|取|递|交|收|放|搁|带).{0,10}(?:来|去|下|好|住|着|给|到|进|上|旁|边|里)?/u,
    enacted: /(?:拿起|取出|递给|交给|接过|收进|放下|放到|搁下|搁在|带上|抱起)/u,
    reply: /(?:拿|取|递|交|给|收|放|搁|带)/u,
  },
  {
    id: "move-or-posture",
    requested: /(?:过来|过去|进来|进去|出来|出去|走来|走去|走到|走向|跟上|坐下|站起|起身|退开|离开|回去|回来)/u,
    enacted: /(?:走向|走到|迈向|跨进|进入|出去|离开|回来|回到|坐下|站起|起身|退开|跟上)/u,
    reply: /(?:过去|回来|回去|进去|出去|坐|站|跟上|离开)/u,
  },
  {
    id: "make-or-maintain",
    requested: /(?:做|收拾|擦|劈|添|搬|烧|生火|封火|关门|开门|关上|打开|补|码|扫|洗|煮|盛|端)/u,
    enacted: /(?:做|收拾|擦|劈|添|搬|烧|生火|封火|关上|打开|补|码|扫|洗|煮|盛|端)/u,
    reply: /(?:做|收拾|擦|劈|添|搬|烧|火|关|开|补|码|扫|洗|煮|盛|端)/u,
  },
  {
    id: "inspect-or-record",
    requested: /(?:验|核|查|清点|点清|点数|核对|对账|记|写|抄|读|翻).{0,10}(?:一遍|一下|清楚|明白|下来|上去)?/u,
    enacted: /(?:验看|核对|查验|清点|逐项对|记下|写下|抄下|读起|翻开|翻看)/u,
    reply: /(?:看|验|核|查|点|对|记|写|抄|读|翻)/u,
  },
  {
    id: "eat-or-drink",
    requested: /(?:吃|喝|尝|用饭|用茶)/u,
    enacted: /(?:吃|喝|尝|端起.{0,4}(?:碗|杯|茶|饭)|拿起.{0,4}(?:筷|碗|杯))/u,
    reply: /(?:吃|喝|尝|饭|茶)/u,
  },
  {
    id: "pay-or-settle",
    requested: /(?:付|结账|结清|给钱|交钱|收钱)/u,
    enacted: /(?:付|结账|结清|取出.{0,8}(?:钱|铜钱)|递出.{0,8}(?:钱|铜钱)|放下.{0,8}(?:钱|铜钱))/u,
    reply: /(?:付|结|钱|账)/u,
  },
];

function embodiedResponseFamilyIds(value = "", field = "requested") {
  const line = quotedLine(value);
  return EMBODIED_RESPONSE_FAMILIES
    .filter((family) => family[field]?.test(line))
    .map((family) => family.id);
}

function compressedResponseUtterance(speech = "") {
  const line = quotedLine(speech);
  if (!line) return false;
  return /^(?:(?:嗯|好|行|成|可以)(?:[，,、 ]?(?:我来|你看|看着|看好了|听着|这就|就来|就去|给我|交给我|照旧|按你说的|等我|先做|先试|先看))?|(?:我来|你看|看着|看好了|听着|这就|给我|交给我|照旧|按你说的))[。！!]?$/u.test(line);
}

function evaluateEmbodiedDirectResponse(input = {}, speech = "") {
  const realization = input.conversationRealization || {};
  const precedingTurn = realization.precedingTurn || null;
  const precedingUtterance = cleanText(precedingTurn?.utterance);
  const visibleAction = cleanText(input.visibleAction);
  const requestedFamilies = embodiedResponseFamilyIds(precedingUtterance, "requested");
  const enactedFamilies = embodiedResponseFamilyIds(visibleAction, "enacted");
  const replyFamilies = embodiedResponseFamilyIds(speech, "reply");
  const matchedFamilies = requestedFamilies.filter((familyId) => enactedFamilies.includes(familyId));
  const alignedFamilies = matchedFamilies.filter((familyId) => replyFamilies.includes(familyId));
  const directResponse = realization.turnMode === "direct-response";
  const highSharedContext = realization.sharedContextBand === "high";
  const compactReply = compressedResponseUtterance(speech);
  const hasVisibleFollowThrough = Boolean(visibleAction && matchedFamilies.length);
  const speechActionAligned = !replyFamilies.length || Boolean(alignedFamilies.length);
  const passed = Boolean(
    directResponse
    && highSharedContext
    && precedingUtterance
    && compactReply
    && hasVisibleFollowThrough
    && speechActionAligned
  );
  return {
    passed,
    score: passed ? 1 : 0,
    directResponse,
    highSharedContext,
    compactReply,
    precedingUtterance,
    visibleAction,
    requestedFamilies,
    enactedFamilies,
    replyFamilies,
    matchedFamilies,
    alignedFamilies,
    hasVisibleFollowThrough,
    speechActionAligned,
  };
}

function isBareAcknowledgement(speech = "", input = {}) {
  const compact = comparableSpeech(speech);
  if (!compact) return false;
  const acknowledgements = new Set([
    "嗯",
    "好",
    "行",
    "知道了",
    "我知道了",
    "明白了",
    "我明白了",
    "记下了",
    "我记下了",
    "嗯知道了",
    "好知道了",
    "行知道了",
  ]);
  if (!acknowledgements.has(compact)) return false;
  if (evaluateEmbodiedDirectResponse(input, speech).passed) return false;
  return Boolean(input.requiresSubstantiveAnswer || input.speechAct === "answer");
}

function isUnnaturalFragment(speech = "") {
  const line = cleanText(speech).replace(/^[“”"「」『』]+|[“”"「」『』]+$/g, "");
  if (/空下来(?:再)?过去|空下来(?:再)?去(?:吧|了)?$/u.test(line)) return true;
  if (/(?:等|待).{0,3}空下来.{0,2}(?:过去|去)$/.test(line)) return true;
  if (/^(?:嗯|好|行)[，,]\s*(?:空|闲).{0,3}(?:过去|去)$/.test(line)) return true;
  return false;
}

function isGenericServiceRegister(speech = "", input = {}) {
  const line = cleanText(speech).replace(/^[“”"「」『』]+|[“”"「」『』]+$/g, "");
  const genericCourtesy = /(?:您|客官).{0,8}(?:看看|尝尝|试试).{0,8}(?:合不合|是否|满不满意).{0,8}(?:口味|心意|满意)/u;
  const modernService = /(?:欢迎下次|有什么需要|为您安排|给您安排|您这边|请慢用|满意就好|合您口味)/u;
  const genericTransaction = /(?:茶|饭).{0,6}(?:不错|很好|可以).{0,12}(?:茶钱|饭钱|钱).{0,8}(?:收好|拿好|点好)/u;
  const redundantPaymentLine = input.affordanceType === "pay_cash"
    && /(?:这是|给你|给您).{0,6}(?:茶钱|饭钱|钱).{0,8}(?:收好|拿好)/u.test(line);
  return genericCourtesy.test(line)
    || modernService.test(line)
    || genericTransaction.test(line)
    || redundantPaymentLine;
}

function isSimulationRoundLanguage(speech = "") {
  const line = cleanText(speech).replace(/^[“”"「」『』]+|[“”"「」『』]+$/g, "");
  const round = /(?:上|下|这|本|前|后)(?:一)?轮/u;
  const nonContestMatter = /(?:药钱|举荐|茶钱|饭钱|房钱|账|答复|回话|对话|交接|来意|接待)/u;
  return round.test(line) && nonContestMatter.test(line);
}

function isEmptyCourtesyRegister(speech = "") {
  const line = cleanText(speech).replace(/^[“”"「」『』]+|[“”"「」『』]+$/g, "");
  return /(?:感谢|多谢).{0,5}(?:您|你).{0,5}(?:配合|理解)|(?:您|你).{0,4}(?:先请|请便)|请.{0,4}(?:配合|理解)/u.test(line)
    && !/(?:饭|茶|房|钱|账|名录|登记|药|柴|水|门|火|钥匙)/u.test(line);
}

function isInstitutionalBroadcastRegister(speech = "") {
  const line = cleanText(speech).replace(/^[“”"「」『』]+|[“”"「」『』]+$/g, "");
  return /(?:本店|本酒馆|酒馆今日).{0,12}(?:照常|营业|歇业|接待)|诸位客官.{0,12}(?:依次|统一|请到)|有事请到.{0,8}(?:柜台|掌柜处).{0,6}(?:办理|等候)/u.test(line);
}

function isMotiveLedgerRegister(speech = "", conversationRealization = {}) {
  if (conversationRealization.turnMode !== "direct-response") return false;
  if (conversationRealization.sharedContextBand !== "high") return false;
  const line = quotedLine(speech);
  const intentFrames = line.match(/(?:我)?(?:还|也)?(?:想|打算|希望|需要|准备)/gu) || [];
  if (intentFrames.length < 2) return false;
  const clauses = line.split(/[，。！？；,.!?;]/u).map(cleanText).filter(Boolean);
  return clauses.length >= 2;
}

function abstractPurposeSummaryRisk(speech = "") {
  const line = quotedLine(speech);
  const abstractPurpose = /(?:我|我是)?(?:来|想来|过来|到这儿来)?(?:打听|了解|问问|办)(?:些|一点|一下)?(?:消息|情况|事情|事)(?:而已)?[。！!]?(?:$|[”」』])/u;
  const concreteReferent = /(?:谢真石|梯云宗|举荐|药包|名录|客房|茶|饭|剑|人|哪|谁|何处|是否|可曾)/u;
  return abstractPurpose.test(line) && !concreteReferent.test(line);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function roundedScore(value) {
  return Math.round(clamp01(value) * 1000) / 1000;
}

function normalizedPressure(value) {
  const numeric = Number(value || 0);
  return clamp01(numeric > 1 ? numeric / 100 : numeric);
}

function quotedLine(speech = "") {
  return cleanText(speech).replace(/^[“”"「」『』]+|[“”"「」『』]+$/g, "");
}

function matchedTerms(line = "", terms = []) {
  return [...new Set((terms || [])
    .map(cleanText)
    .filter((term) => term && line.includes(term)))];
}

function speechActFit(line = "", speechAct = "") {
  switch (cleanText(speechAct)) {
    case "ask":
    case "request":
      return /[？?]|(?:吗|么|呢|怎么|哪|谁|几|是否|能不能|肯不肯)/u.test(line) ? 1 : 0.15;
    case "answer":
      return /(?:肯|不肯|能|不能|是|不是|会|不会|先|已经|还没|我来|我去|我自己)/u.test(line) ? 1 : 0.35;
    case "offer":
      return /(?:给|换|便|只要|若|你把|我来|可以)/u.test(line) ? 1 : 0.3;
    case "refuse":
      return /(?:不|不能|不必|不用|改日|尚未)/u.test(line) ? 1 : 0.2;
    case "inform":
      return /(?:了|先|正在|已经|还没|少|缺|有|无|在|去|来|记|收|验|试|问)/u.test(line) ? 0.7 : 0.25;
    default:
      return /(?:[？?]|了|先|要|得|不能|还没)/u.test(line) ? 0.55 : 0.25;
  }
}

function genericLanguagePenalty(line = "") {
  const compact = comparableSpeech(line);
  const exactGeneric = new Set([
    "这一步办妥了",
    "事情办妥了",
    "这事办好了",
    "已经处理好了",
    "事情解决了",
    "按计划完成了",
    "我会处理的",
    "没有问题",
  ]);
  if (exactGeneric.has(compact)) return { score: 0.25, reason: "shared-generic-status-line" };
  if (/^(?:这|那)?(?:一)?(?:步|事|件事)?.{0,3}(?:办妥|办好|完成|处理好|解决)了?$/u.test(compact)) {
    return { score: 0.22, reason: "abstract-completion-without-world-fact" };
  }
  if (/^(?:我)?(?:知道|明白|记住|清楚)了$|^(?:好|行|可以|没问题)$/u.test(compact)) {
    return { score: 0.38, reason: "interchangeable-acknowledgement" };
  }
  return { score: 0, reason: "" };
}

function contextGrounding(line = "", topics = []) {
  const ignored = new Set(["的", "了", "这", "那", "一", "个", "事", "我", "你", "他", "人", "在", "是", "要"]);
  const lineChars = new Set([...line].filter((char) => /[\p{Script=Han}]/u.test(char) && !ignored.has(char)));
  const topicChars = new Set((topics || []).flatMap((topic) => [...cleanText(topic)])
    .filter((char) => /[\p{Script=Han}]/u.test(char) && !ignored.has(char)));
  const sharedChars = [...topicChars].filter((char) => lineChars.has(char));
  const exactPhrase = (topics || []).map(cleanText).find((topic) => topic.length >= 2 && line.includes(topic)) || "";
  return {
    grounded: Boolean(exactPhrase || sharedChars.length >= 2),
    sharedChars,
    exactPhrase,
  };
}

function computeVoiceCoherence(input = {}, speech = "") {
  const line = quotedLine(speech);
  const contract = input.voiceContract || {};
  const relationshipTerms = [...new Set([
    ...(contract.activeContext?.allowedAddresses || []),
  ])];
  const relationshipHits = matchedTerms(line, relationshipTerms);
  const context = contextGrounding(line, input.contextTopics || []);
  const hasMeasurableFact = /(?:\d+|[一二两三四五六七八九十百]+)(?:文|枚|碗|坛|捆|张|趟|遍|页|次|间|包|份|日|刻)/u.test(line);
  const hasConcreteOperation = /(?:交|收|验|核|记|盛|端|劈|添|练|试|走|付|问|答|关|开|补|对|拿|放|吃|住|送|换)/u.test(line)
    && /(?:账|钱|饭|茶|柴|水|火|门|剑|药|名录|房|钥匙|桌|碗|清单|册|路|人|信)/u.test(line);
  const embodiedResponse = evaluateEmbodiedDirectResponse(input, line);
  const pragmaticFit = speechActFit(line, input.speechAct);
  const situatedContent = context.grounded || hasMeasurableFact || hasConcreteOperation ? 1 : 0.15;
  const hasTarget = Boolean(cleanText(input.targetCharacterId || contract.activeContext?.targetCharacterId));
  const relationshipFit = relationshipHits.length
    ? 1
    : hasTarget
      ? 0.7
      : 0.65;
  const directResponse = input.conversationRealization?.turnMode === "direct-response";
  const interactionContinuity = embodiedResponse.passed
    ? 1
    : directResponse
      ? (context.grounded || cleanText(input.speechAct) === "answer" ? 0.8 : 0.35)
      : 0.7;
  const genericPenalty = genericLanguagePenalty(line);
  const nonGenericity = clamp01(1 - genericPenalty.score);
  const weightedBeforePenalty = (
    situatedContent * 0.3
    + pragmaticFit * 0.25
    + relationshipFit * 0.1
    + interactionContinuity * 0.15
    + nonGenericity * 0.2
  );
  const lineOnlyScore = roundedScore(weightedBeforePenalty);
  // A close-peer reply can put most of its propositional work into an
  // immediately following, request-matching action. That is a whole-turn
  // realization, not a generic line that should be forced to repeat context.
  const embodiedResponseBonus = embodiedResponse.passed ? 0.24 : 0;
  const appliedGenericPenalty = embodiedResponse.passed ? 0 : genericPenalty.score * 0.35;
  const score = roundedScore(weightedBeforePenalty - appliedGenericPenalty + embodiedResponseBonus);
  const minimumScore = clamp01(Number(contract.telemetry?.minimumContextualCoherence ?? 0.46));
  return {
    score,
    passed: score >= minimumScore,
    diagnostics: {
      minimumScore,
      evaluationScope: embodiedResponse.passed
        ? "preceding-turn+relationship+speech+visible-action"
        : "speech",
      lineOnlyScore,
      components: {
        situatedContent: roundedScore(situatedContent),
        pragmaticFit: roundedScore(pragmaticFit),
        relationshipFit: roundedScore(relationshipFit),
        interactionContinuity: roundedScore(interactionContinuity),
        nonGenericity: roundedScore(nonGenericity),
      },
      weights: {
        situatedContent: 0.3,
        pragmaticFit: 0.25,
        relationshipFit: 0.1,
        interactionContinuity: 0.15,
        nonGenericity: 0.2,
      },
      scoreMeaning: "context-and-intention-coherence-not-character-style-or-sentence-shape",
      genericPenalty: roundedScore(genericPenalty.score),
      appliedGenericPenalty: roundedScore(appliedGenericPenalty),
      genericPenaltyReason: genericPenalty.reason,
      embodiedResponseBonus: roundedScore(embodiedResponseBonus),
      embodiedDirectResponse: embodiedResponse,
      evidence: {
        relationshipHits,
        hasMeasurableFact,
        hasConcreteOperation,
        contextGrounding: context,
      },
    },
  };
}

export function validateTavernVoiceRealization(input = {}) {
  const proposedSpeech = cleanText(input.speech);
  if (!proposedSpeech) {
    return {
      ok: true,
      accepted: true,
      publish: false,
      proposedSpeech: "",
      speech: "",
      publicSpeech: "",
      violations: [],
      hardViolations: [],
      diagnosticFindings: [],
      identityScore: 1,
      identityPassed: true,
      diagnostics: {
        skipped: true,
        reason: "no-speech-to-realize",
      },
    };
  }

  const violations = [];
  if (isBareAcknowledgement(proposedSpeech, input)) {
    violations.push(violation(
      "BARE_ACKNOWLEDGEMENT",
      "需要实质回答时，纯确认声没有承接问题，也没有公开人物的决定。",
      { speechAct: input.speechAct || "", requiresSubstantiveAnswer: Boolean(input.requiresSubstantiveAnswer) },
    ));
  }
  if (isUnnaturalFragment(proposedSpeech)) {
    violations.push(violation(
      "UNNATURAL_FRAGMENT",
      "缩短表达不能删除必要谓语、方向或句子落点，病句不能被当成人物克制。",
      { characterId: input.characterId || input.voiceContract?.characterId || "" },
    ));
  }
  if (isGenericServiceRegister(proposedSpeech, input)) {
    violations.push(violation(
      "GENERIC_SERVICE_REGISTER",
      "这句话使用了可替换到任何店家的通用服务或交易话术，没有执行人物声纹。",
      { affordanceType: input.affordanceType || "", characterId: input.characterId || input.voiceContract?.characterId || "" },
    ));
  }
  if (isSimulationRoundLanguage(proposedSpeech)) {
    violations.push(violation(
      "SIMULATION_ROUND_LANGUAGE",
      "人物不能把药钱、账目、举荐或接待说成模拟器的上一轮、下一轮或这轮。",
      { characterId: input.characterId || input.voiceContract?.characterId || "" },
    ));
  }
  if (isEmptyCourtesyRegister(proposedSpeech)) {
    violations.push(violation(
      "EMPTY_COURTESY_REGISTER",
      "礼貌必须附着于眼前的人和具体事务，不能用通用配合话术代替人物反应。",
      { characterId: input.characterId || input.voiceContract?.characterId || "" },
    ));
  }
  if (isInstitutionalBroadcastRegister(proposedSpeech)) {
    violations.push(violation(
      "INSTITUTIONAL_BROADCAST_REGISTER",
      "固定场景中的人物只对眼前事务开口，不能突然变成面向全体的机构播报。",
      { characterId: input.characterId || input.voiceContract?.characterId || "" },
    ));
  }
  if (isMotiveLedgerRegister(proposedSpeech, input.conversationRealization || {})) {
    violations.push(violation(
      "MOTIVE_LEDGER_REGISTER",
      "熟人之间承接上一句话时，不能把多个内心目标逐项翻成‘我想／也想’的目的清单；应按共享语境突出当前最需要对方回应的动作。",
      {
        characterId: input.characterId || input.voiceContract?.characterId || "",
        targetCharacterId: input.targetCharacterId || "",
        turnMode: input.conversationRealization?.turnMode || "",
        sharedContextBand: input.conversationRealization?.sharedContextBand || "",
      },
    ));
  }
  if (abstractPurposeSummaryRisk(proposedSpeech)) {
    violations.push(violation(
      "ABSTRACT_PURPOSE_SUMMARY_RISK",
      "这句话可能把后台的抽象来意直接念成任务汇报，而没有从眼前对象、动作或具体问题自然进入；它不是禁句，但应由人物自己复核是否真想这样公开。",
      { characterId: input.characterId || input.voiceContract?.characterId || "" },
    ));
  }
  if (input.speechRealizationPlan?.selfCheck?.soundsLikePrivateSummary
    || input.speechRealizationPlan?.selfCheck?.interchangeableAcrossCharacters
    || input.speechRealizationPlan?.selfCheck?.repeatsWhatActionAlreadyShows
    || input.speechRealizationPlan?.selfCheck?.containsUnnecessaryExplanatoryTail) {
    violations.push(violation(
      "CHARACTER_REPORTED_VOICE_DRIFT",
      "人物自己的表层复核已经发现后台摘要、人物可互换、动作信息复读或无行动功能的解释尾巴；世界仍保留原话，只把它记录为声音漂移。",
      { selfCheck: clone(input.speechRealizationPlan.selfCheck) },
    ));
  }

  const identity = computeVoiceCoherence(input, proposedSpeech);
  if (!identity.passed) {
    violations.push(violation(
      "VOICE_IDENTITY_TOO_GENERIC",
      "这句话与眼前事务、表达意图或互动关系的连接较弱；这只是连贯性遥测，不按句长、固定词汇或人物模板裁决声音。",
      {
        characterId: input.characterId || input.voiceContract?.characterId || "",
        identityScore: identity.score,
        minimumScore: identity.diagnostics.minimumScore,
        genericPenaltyReason: identity.diagnostics.genericPenaltyReason,
      },
    ));
  }

  // Voice is a character-owned realization aid, not a censorship gate. These
  // findings remain useful for multi-turn voice telemetry and author review,
  // but a generic, fragmented, repetitive, or socially odd line is still an
  // utterance the person may choose to make.
  const publish = true;
  return {
    ok: true,
    accepted: true,
    publish,
    proposedSpeech,
    speech: proposedSpeech,
    publicSpeech: proposedSpeech,
    violations: [],
    hardViolations: [],
    diagnosticFindings: violations,
    identityScore: identity.score,
    identityPassed: identity.passed,
    diagnostics: { ...identity.diagnostics, findings: clone(violations) },
    conversationRealization: clone(input.conversationRealization || null),
  };
}
