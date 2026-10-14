import { callOpenAIJson } from "./responseClient.mjs";

export const backgroundSlotSchema = {
  type: "object",
  additionalProperties: false,
  required: ["slotText", "carryFacts"],
  properties: {
    slotText: { type: "string", description: "这个时段的叙事段落，2-4句，只写在场人物真实做的事和可见结果" },
    carryFacts: { type: "array", items: { type: "string" }, description: "会影响今天后续时段的事实，0-3条白话" },
    characterActivities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          characterId: { type: "string" },
          activity: { type: "string" },
        },
      },
    },
    dialogueTurns: {
      type: "array",
      description: "只复述 canonicalDialogueTurns 中人物 Agent 已经说出口的原话；不得新增台词",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["speakerId", "targetId", "line"],
        properties: {
          speakerId: { type: "string" },
          targetId: { type: "string" },
          line: { type: "string" },
        },
      },
    },
  },
};

export function backgroundSlotSystemPrompt({ allowDialogue = false, preserveCanonicalDialogue = false } = {}) {
  return `你是 Character Town 的时段记录者。你写的是小镇上的人在过日子：劳动、移动、吃喝、修补、偶遇、做事出岔子。

硬规则：
- 只写在场人物；不得发明不在场的人。
- 场所经营契约、人物身份、权限、知识边界、来访目的与事务阶段都是受保护事实；不得把食客写成店伙，不得让来客自行取用饭茶，不得把未结算写成已经两清。
- 接待、验货、出餐、结账、以工换饭、请求和拒绝的行动者与对象不可互换；写到这些事件时，同一句必须清楚保留正确的人名与对象。
- 每个人只能依据自己的 Agent 上下文行动；不得把其他人物的私密事实、完整角色定义或全局账目塞进他的认知。
- 写人各自真实在做的事和留下的可见结果；这不是对峙戏，不要制造输入中没有的冲突、谈判或结果。
- 每个时段围绕一个最清楚的互动或变化组织，不要按人物名单逐项报动作台账。优先写“什么促成了接触—谁对谁说了什么—来访、请求、账目或关系因此走到哪一步”。
- 不写内心独白、不写心理分析；一切通过可见的动作与痕迹表达。
- 如果今天已发生的事与这个时段有关，让它自然影响人物的行动；已经完成的柴水、饭茶、验收或结算不得再次写成刚刚完成，同一活动延续时要写成继续、收尾或等待结果。
- 不把后台工单标题、验收标准原文或“经手人”“办理”等流程词塞进叙事；只写人具体看见、动手、说话与点头的样子。
- ${preserveCanonicalDialogue
    ? "输入已经给出人物 Agent 真正说出口的 canonicalDialogueTurns；必须逐字、逐人、逐对象保留，slotText 必须包含完全相同的话，不得改写或添加台词。"
    : allowDialogue
      ? "输入已经给出一项请求或拒绝意图；你只能替这些已决意图写自然口语，不能改变行动者、目标、决定或后果。dialogueTurns 最多两句，slotText 必须包含完全相同的话。"
      : "本时段没有已决谈话意图；dialogueTurns 必须为空，不得让人物开口。"}
- slotText 2-4 句；carryFacts 是会影响今天后续时段的事实，0-3 条，白话短句。
- 不得机械拼接输入片段；每句话必须主谓完整，避免“自己的在”“自己的于”、重复介词、重复助词或悬空的动作宾语。
- 只输出 JSON。`;
}

function ensureSentence(text = "") {
  const value = String(text || "").trim();
  if (!value) return "";
  return /[。！？!?]$/.test(value) ? value : `${value}。`;
}

function uniqueText(items = []) {
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
}

function hasMalformedWitnessText(text = "") {
  return /自己的(?:在|于|送来|做一段|住一晚|收取)|守着自己的[^。！？]{0,100}(?:等|待)回应|(?:在|把|将){2,}|的的|了了|undefined|\[object Object\]/.test(String(text || ""));
}

function repeatsCanonicalDialogue(text = "", turns = []) {
  return (turns || []).some((turn) => {
    const line = String(turn?.line || "").trim();
    if (!line) return false;
    const first = String(text || "").indexOf(line);
    return first >= 0 && String(text || "").indexOf(line, first + line.length) >= 0;
  });
}

function backendNarrativeLiterals(lifeEvents = []) {
  const literals = [];
  for (const event of lifeEvents || []) {
    if (event?.taskLabel) literals.push(String(event.taskLabel).trim());
    const criteria = Array.isArray(event?.completionCriteria) ? event.completionCriteria : [];
    literals.push(...criteria.map((criterion) => String(criterion || "").trim()));
    if (criteria.length) literals.push(criteria.map((criterion) => String(criterion || "").trim()).filter(Boolean).join("、"));
  }
  return uniqueText(literals);
}

function hasBackendNarrativeLeak(text = "", lifeEvents = []) {
  const value = String(text || "");
  if (/经手人|办理/u.test(value)) return true;
  return backendNarrativeLiterals(lifeEvents).some((literal) => (
    literal && (
      value.includes(`“${literal}”`)
      || value.includes(`\"${literal}\"`)
      || value.includes(`'${literal}'`)
    )
  ));
}

const PROTECTED_ACTOR_TARGET_TYPES = new Set([
  "receive_guest", "accept_delivery", "serve_guest", "settle_visit", "perform_exchange",
  "perform_visit_business", "attempt_secondary_objective", "refuse_service", "request", "refuse",
]);

function preservesProtectedActorTargets(text = "", lifeEvents = []) {
  const sentences = String(text || "").split(/(?<=[。！？!?])/).map((sentence) => sentence.trim()).filter(Boolean);
  return (lifeEvents || [])
    .filter((event) => PROTECTED_ACTOR_TARGET_TYPES.has(event.activityType) && event.characterName && event.targetCharacterName)
    .every((event) => sentences.some((sentence) => sentence.includes(event.characterName) && sentence.includes(event.targetCharacterName)));
}

function canonicalFallbackText({ groundingActions = [], lifeEvents = [], dialogueTurns = [], canonicalConsequences = [] } = {}) {
  const involvedIds = new Set(dialogueTurns.flatMap((turn) => [turn.speakerId, turn.targetId]).filter(Boolean));
  const eventActions = (lifeEvents || [])
    .filter((event) => event.activityType !== "speak")
    .filter((event) => event.targetCharacterId || event.consequence || event.socialIntent || involvedIds.has(event.characterId) || involvedIds.has(event.targetCharacterId))
    .map((event) => event.visibleAction || event.description);
  const actions = uniqueText(eventActions.length ? eventActions : groundingActions).slice(0, 4).map(ensureSentence);
  const speech = dialogueTurns.map((turn) => ensureSentence(`${turn.speakerName}对${turn.targetName}说：“${turn.line}”`));
  const consequences = uniqueText(canonicalConsequences).slice(0, 1).map(ensureSentence);
  return [...actions, ...speech, ...consequences].filter(Boolean).join("");
}

export function backgroundSlotUserPrompt({ location = {}, slot = {}, characters = [], groundingActions = [], lifeEvents = [], socialIntents = [], canonicalDialogueTurns = [], canonicalConsequences = [], dayLog = [], ui = {} } = {}) {
  return `时段：${slot.label || "此刻"}（${slot.focus || ""}）
地点：${location.name || "未知场所"}
场所经营契约（受保护，不得改写）：
${JSON.stringify(location.institution || {}, null, 2)}
操盘指令：${ui.userDirective || "无"}
注入事件：${ui.injectedEvent || "无"}

在场人物的 Agent 上下文（一次只按该人物自己的身份、权限、知识边界和相关来访理解；不得拼接成共享全知角色卡）：
${JSON.stringify(characters, null, 2)}

今天到目前为止已发生的事：
${JSON.stringify(dayLog, null, 2)}

本地演算给出的可见动作底料（可改写、不可矛盾）：
${JSON.stringify(groundingActions, null, 2)}

已决人物行动与来访阶段（受保护，不得改变行动者、对象、来意、服务或结算）：
${JSON.stringify(lifeEvents, null, 2)}

已决社会意图（只能措辞，不得改变决定）：
${JSON.stringify(socialIntents, null, 2)}

人物 Agent 已经真正说出口的原话（优先级最高，必须逐字保留）：
${JSON.stringify(canonicalDialogueTurns, null, 2)}

已经发生的物质或关系后果：
${JSON.stringify(canonicalConsequences, null, 2)}

写出这个时段的 slotText、carryFacts 与 dialogueTurns。`;
}

async function defaultRunCall({ system, user, schema, schemaName, signal }) {
  return callOpenAIJson({ system, user, schema, schemaName, schemaHintMode: "compact", signal });
}

export async function runBackgroundSlot({
  location = {},
  slot = {},
  characters = [],
  groundingActions = [],
  lifeEvents = [],
  socialIntents = [],
  canonicalDialogueTurns = [],
  canonicalConsequences = [],
  dayLog = [],
  ui = {},
  runCall = defaultRunCall,
  signal,
} = {}) {
  const startedAt = Date.now();
  const hasCanonicalDialogue = canonicalDialogueTurns.length > 0;
  const { parsed, meta } = await runCall({
    system: backgroundSlotSystemPrompt({ allowDialogue: hasCanonicalDialogue, preserveCanonicalDialogue: hasCanonicalDialogue }),
    user: backgroundSlotUserPrompt({ location, slot, characters, groundingActions, lifeEvents, socialIntents, canonicalDialogueTurns, canonicalConsequences, dayLog, ui }),
    schema: backgroundSlotSchema,
    schemaName: "character_town_background_slot",
    signal,
  });
  const carryFacts = (Array.isArray(parsed?.carryFacts) ? parsed.carryFacts : [])
    .map((fact) => String(fact || "").trim())
    .filter(Boolean)
    .slice(0, 3);
  const characterActivities = (Array.isArray(parsed?.characterActivities) ? parsed.characterActivities : [])
    .map((item) => ({ characterId: String(item?.characterId || ""), activity: String(item?.activity || "").trim() }))
    .filter((item) => item.characterId && item.activity);
  const characterById = new Map((characters || []).map((character) => [String(character.id || ""), character]));
  const canonicalTurns = (Array.isArray(canonicalDialogueTurns) ? canonicalDialogueTurns : [])
    .map((turn) => {
      const speakerId = String(turn?.speakerId || "");
      const targetId = String(turn?.targetId || turn?.addresseeId || "");
      const line = String(turn?.line || "").trim();
      const speaker = characterById.get(speakerId);
      const target = characterById.get(targetId);
      if (!speakerId || !targetId || !line || !speaker || !target) return null;
      return {
        ...turn,
        speakerId,
        speakerName: turn.speakerName || speaker.name || speakerId,
        targetId,
        targetName: turn.targetName || target.name || targetId,
        addresseeId: targetId,
        line,
      };
    })
    .filter(Boolean);
  const dialogueTurns = canonicalTurns;
  let slotText = String(parsed?.slotText || "").trim();
  if (slotText && (
    hasMalformedWitnessText(slotText)
    || repeatsCanonicalDialogue(slotText, canonicalTurns)
    || !preservesProtectedActorTargets(slotText, lifeEvents)
    || hasBackendNarrativeLeak(slotText, lifeEvents)
  )) {
    slotText = canonicalFallbackText({ groundingActions, lifeEvents, dialogueTurns, canonicalConsequences });
  }
  for (const turn of dialogueTurns) {
    if (!slotText.includes(turn.line)) slotText = `${slotText}${slotText ? " " : ""}${turn.speakerName}说：“${turn.line}”`;
  }
  return {
    slotText,
    carryFacts,
    characterActivities,
    dialogueTurns,
    stage: {
      name: `BackgroundSlot:${slot.label || "背景"}`,
      provider: "openai",
      model: meta?.model || "",
      elapsedMs: Date.now() - startedAt,
    },
  };
}
