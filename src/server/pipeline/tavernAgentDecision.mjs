import { createId } from "../../data/seed.js";
import { callOpenAIJson } from "./responseClient.mjs";

const SPEECH_ACTS = new Set([
  "none", "greet", "acknowledge", "ask", "answer", "offer", "refuse",
  "negotiate", "warn", "gossip", "confide", "change_subject",
]);
const THREAD_ACTIONS = new Set(["none", "open", "advance", "defer", "close"]);
const RESPONSE_SEEKING_ACTS = new Set(["ask", "offer", "negotiate"]);
const SPEECH_ACT_ALIASES = new Map([
  ["address", "acknowledge"], ["speech", "acknowledge"], ["statement", "acknowledge"],
  ["say", "acknowledge"], ["inform", "acknowledge"], ["notify", "acknowledge"],
  ["confirm", "acknowledge"], ["agree", "acknowledge"], ["question", "ask"],
  ["inquire", "ask"], ["query", "ask"], ["reply", "answer"], ["respond", "answer"],
  ["response", "answer"], ["propose", "offer"], ["promise", "offer"],
  ["decline", "refuse"], ["deny", "refuse"], ["reject", "refuse"],
  ["bargain", "negotiate"], ["threaten", "warn"], ["chat", "gossip"],
  ["disclose", "confide"], ["redirect", "change_subject"],
]);
const THREAD_ACTION_ALIASES = new Map([
  ["start", "open"], ["begin", "open"], ["create", "open"],
  ["continue", "advance"], ["progress", "advance"], ["delay", "defer"],
  ["postpone", "defer"], ["resolve", "close"],
  ["finish", "close"], ["complete", "close"], ["end", "close"],
]);

export const tavernAgentDecisionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "chosenActionType", "speechAct", "addresseeId", "utterance", "privateReason",
    "desiredResponse", "threadAction", "threadTopic", "threadStake",
  ],
  properties: {
    chosenActionType: { type: "string", description: "必须原样选择 candidateActions 中的一个 type" },
    speechAct: {
      type: "string",
      enum: [...SPEECH_ACTS],
      description: "这一刻不说话就选 none；说话时选最贴近意图的一项",
    },
    addresseeId: { type: "string", description: "只可填写 presentCharacters 中另一人的 id；不说话时为空" },
    utterance: { type: "string", description: "人物真正说出口的一句自然口语；不说话时为空" },
    privateReason: { type: "string", description: "只供此 Agent 使用的简短取舍原因，不会公开给其他人" },
    desiredResponse: { type: "string", description: "希望对方作何回应；没有则为空" },
    threadAction: {
      type: "string",
      enum: [...THREAD_ACTIONS],
      description: "是否公开发起、推进、明确延期或结束一个尚未解决的事务",
    },
    threadTopic: { type: "string", description: "公开事务的具体主题；没有则为空" },
    threadStake: { type: "string", description: "这件事若不解决会造成什么实际影响；没有则为空" },
  },
};

export function tavernAgentDecisionSystemPrompt() {
  return `你不是替全场写戏的作者。你是一个正在望梯酒馆里过日子的人，只决定自己这一刻怎么做、是否对眼前某个人说一句话。

硬规则：
- chosenActionType 只能从 offered candidateActions 的 type 中选择；不能发明动作、库存变化、成交、服务阶段或世界结果。
- 你只知道自己的 privateState、受保护的 contextManifest、眼前可见的人和 publicTranscript。不能读取或猜测别人的内心、秘密、完整角色设定。
- relationshipContext 只列你与眼前人物之间可公开确认的关系和称谓边界。说话时必须符合夫妻、父子、母子、熟客、东家等真实关系，不能把家人叫成陌生客人的称谓。
- 人物可以沉默，也可以一边继续手里的事一边开口。接待、点单、问价、验货、催促、推辞、闲聊和回应都可以自然发生。
- interactionObligation.required 为 true 时，眼前已经有人把一个公开动作交给你：你必须对指定对象说出回答、拒绝、追问、招呼或明确延期，speechAct 不能是 none；这不是强迫戏剧，而是人物对已经发生的社会接触作出选择。
- 如果未解决事务明确把下一步交给你，而且发起人仍在场，你必须给出回答、拒绝、追问或明确延期；这仍不代表物质问题已经解决。
- 只有真实在场的人才能成为 addressee。没有明确对象时 speechAct 必须是 none，utterance 和 addresseeId 必须为空。
- utterance 是一句可以直接被其他人听见的口语，不写动作说明、心理解释、引号或旁白。
- “嗯”“好”“知道了”“我明白了”以及只多一个称谓的同类空确认，不是有效台词。要回答就必须说清自己听见了什么、接受或拒绝什么、接下来会做什么。
- 直接问答只承接当前时段中自己确实听见的原句。跨时段只能沿仍然开放的 event thread 继续，并围绕该 thread 的具体 topic 回应；不能把一天前面任何未答句自动粘到当前话上。
- threadAction 必须反映这句话之后的真实状态：问题已经说清就 close；明确说改日、晚些或某个时间再谈就 defer；只有这句话又提出了一个需要对方具体回答的新问题、协商或要约时才 advance。普通回答不能要求对方再说“好”来确认，禁止确认的确认。
- todayCooledTopics 中的事务今天已经结束或明确延期；除非 interactionObligation 是一项全新的 canonical request，否则不得主动重开、换句话再问或把它继续塞进当前台词。
- 不能替东家、掌柜或来客越权作主；不能把来客写成店伙，不能让客人自行取饭茶，不能把尚未完成的交易说成已两清。
- threadAction 只记录人物已经通过公开话语制造的未完成事务。普通寒暄不必开 thread；回答也不等于问题已经解决。
- 回答旧话时必须以此刻的 canonical visit stage、chosenAction 和 completionCondition 为准。已经完成的以工换饭、验收、付款或服务不得被一句新话倒退成“还要再做一次才算数”；若人物另提未来的事，必须明确与本次交易分开。
- privateReason 可以诚实，但其他 Agent 永远看不到它。只输出 JSON。`;
}

export function tavernAgentDecisionUserPrompt(input = {}) {
  return `当前时段：${input.slot?.label || "此刻"}（第${input.day || 1}日）
地点：${input.location?.name || "望梯酒馆"}

你的 Agent：
${JSON.stringify(input.agent || {}, null, 2)}

这次可选择的行动（只能选其中一个 type）：
${JSON.stringify(input.opportunity || {}, null, 2)}

这次必须处理的公开互动义务：
${JSON.stringify(input.interactionObligation || { required: false }, null, 2)}

你眼前可见的人（只有公开事实）：
${JSON.stringify(input.presentCharacters || [], null, 2)}

今天已经公开发生的说话：
${JSON.stringify(input.publicTranscript || [], null, 2)}

仍未解决的公开事务：
${JSON.stringify(input.eventThreads || [], null, 2)}

今天已经结束或延期、不得再主动重开的事务：
${JSON.stringify(input.todayCooledTopics || [], null, 2)}

此刻已经公开发生的行动与外界变化：
${JSON.stringify(input.publicSituation || [], null, 2)}

受保护的个人上下文来源：
${JSON.stringify(input.contextManifest || {}, null, 2)}

场所经营契约：
${JSON.stringify(input.institution || {}, null, 2)}

决定这一刻自己的行动和一句话。`;
}

async function defaultRunCall({ system, user, schema, schemaName, signal }) {
  return callOpenAIJson({ system, user, schema, schemaName, schemaHintMode: "compact", signal });
}

export async function runTavernAgentDecision(input = {}, { runCall = defaultRunCall, signal } = {}) {
  const startedAt = Date.now();
  const { parsed, meta } = await runCall({
    system: tavernAgentDecisionSystemPrompt(),
    user: tavernAgentDecisionUserPrompt(input),
    schema: tavernAgentDecisionSchema,
    schemaName: "character_town_tavern_agent_decision",
    signal,
  });
  return {
    decision: parsed || {},
    stage: {
      name: `TavernAgentDecision:${input.agent?.name || input.agent?.id || "unknown"}`,
      provider: "openai",
      model: meta?.model || "",
      elapsedMs: Date.now() - startedAt,
    },
  };
}

function deepClone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function tickKey(tick = {}) {
  return `${Number(tick.day || 0)}:${String(tick.slotId || tick.id || "")}`;
}

function characterById(state, characterId) {
  return (state.characters || []).find((character) => character.id === characterId) || null;
}

function addressingRuleFor(label = "") {
  if (/夫妻/.test(label)) return "使用夫妻或家人之间的称谓与语气，不得把对方称作陌生掌柜、客官或旁姓长辈。";
  if (/父子|母子|父女|母女/.test(label)) return "使用亲子家庭语境，不得把父母或子女称作陌生东家、掌柜、客官或旁姓长辈。";
  if (/兄弟|姐妹|兄妹|姐弟/.test(label)) return "使用手足或家人语境，不得把对方当作陌生来客。";
  if (/熟客|旧识|同门|师徒/.test(label)) return "称谓应体现已认识的关系，不得退化成第一次见面的客套话。";
  return "按这段公开关系和双方当下身份选择称谓，不额外猜测私密心理。";
}

function relationshipContextFor(state, characterId, presentCharacters = []) {
  const presentIds = new Set((presentCharacters || []).map((character) => character.id).filter(Boolean));
  return (state.relationships || [])
    .filter((relationship) => relationship.fromCharacterId === characterId || relationship.toCharacterId === characterId)
    .map((relationship) => {
      const otherCharacterId = relationship.fromCharacterId === characterId
        ? relationship.toCharacterId
        : relationship.fromCharacterId;
      if (!presentIds.has(otherCharacterId)) return null;
      const other = characterById(state, otherCharacterId) || {};
      return {
        otherCharacterId,
        otherCharacterName: other.name || otherCharacterId,
        label: relationship.label || "已有关系",
        addressingRule: addressingRuleFor(relationship.label || ""),
        publicPressure: {
          closeness: Math.round((Number(relationship.love || 0) + Number(relationship.dependence || 0) + Number(relationship.protection || 0)) / 3),
          tension: Math.round((Number(relationship.resentment || 0) + Number(relationship.fear || 0) + Number(relationship.shame || 0)) / 3),
          power: Number(relationship.power || 0),
        },
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function publicCharacter(output = {}, character = {}) {
  const presenceAction = output.actionType === "arrive";
  return {
    id: character.id || output.characterId || "",
    name: character.name || output.characterName || output.characterId || "",
    identity: character.lifeProfile?.role || character.externalSituation || "",
    situationalRole: output.situationalRole || character.lifeState?.situationalRole || "在场者",
    currentActivity: presenceAction
      ? output.chosenAction || "刚刚进门"
      : character.lifeState?.currentActivity?.description || character.currentActivity?.description || "",
    visibleAction: presenceAction ? output.visibleAction || "" : "",
  };
}

function ownPrivateState(state, tick, output) {
  const character = characterById(state, output.characterId) || {};
  const simulation = (tick.privateSimulations || []).find((item) => item.characterId === output.characterId) || {};
  return {
    currentNeeds: deepClone(simulation.currentNeeds || character.lifeState?.needs || {}),
    currentActivity: deepClone(simulation.currentActivity || character.lifeState?.currentActivity || character.currentActivity || null),
    activeGoal: simulation.activeGoal || character.lifeState?.activeGoal || character.lifeProfile?.commitments?.[0] || "",
    hiddenAgenda: simulation.hiddenAgenda || character.lifeProfile?.privatePursuit || "",
    appraisal: simulation.appraisal || "",
    reactionIntent: simulation.reactionIntent || "continue",
    conversationObjective: simulation.conversationObjective || "",
    perceivedVisit: deepClone(simulation.perceivedVisit || output.perceivedVisit || null),
    speechProfile: deepClone(character.speechProfile || {}),
  };
}

function activationScore(state, tick, output, transcript = [], threads = []) {
  const event = (tick.lifeEvents || []).find((item) => item.characterId === output.characterId && item.decisionOpportunity?.id === output.decisionOpportunity?.id)
    || (tick.lifeEvents || []).find((item) => item.characterId === output.characterId)
    || {};
  const addressed = Boolean(unansweredTurnFor(transcript, output.characterId));
  const owesMove = threads.some((thread) => thread.status === "open" && thread.nextObligationCharacterId === output.characterId);
  const expectedHost = (output.perceivedVisit?.expectedHostIds || []).includes(output.characterId);
  const character = characterById(state, output.characterId) || {};
  const servicePriority = Number(output.agency?.servicePolicy?.priority || character.lifeProfile?.tavernAgency?.servicePolicy?.priority || 0);
  const dutyStanding = ["proprietor", "manager", "household_worker"].includes(output.agency?.standing) ? 35 : 0;
  const canonicalSocialObligation = output.socialIntent && output.targetCharacterId ? 420 : 0;
  return canonicalSocialObligation
    + (addressed ? 320 : 0)
    + (owesMove ? 260 : 0)
    + (expectedHost ? 120 : 0)
    + Number(event.salience || 0)
    + servicePriority * 0.5
    + dutyStanding;
}

function answeredTurnIds(transcript = [], characterId = "") {
  return new Set((transcript || [])
    .filter((turn) => turn.speakerId === characterId && turn.respondsTo)
    .map((turn) => turn.respondsTo));
}

function turnRequiresResponse(turn = {}) {
  if (!turn?.addresseeId || !turn?.speakerId) return false;
  if (RESPONSE_SEEKING_ACTS.has(turn.speechAct || turn.act || "")) return true;
  return /[？?]\s*$/.test(String(turn.line || ""));
}

function explicitlyDefers(line = "") {
  return /(?:稍等|稍后|晚些|晚点|回头|改日|明[早日]|过些日子|等[^，。！？!?]{0,18}(?:再|后|散|完|走))/.test(String(line || ""));
}

function unansweredTurnFor(transcript = [], characterId = "", { slotId = "", allowCrossSlot = false } = {}) {
  const answered = answeredTurnIds(transcript, characterId);
  return [...(transcript || [])].reverse().find((turn) => (
    turn.addresseeId === characterId
    && turnRequiresResponse(turn)
    && !answered.has(turn.turnId)
    && (allowCrossSlot || !slotId || turn.slotId === slotId)
  )) || null;
}

function interactionObligationFor(output = {}, opportunity = {}, transcript = [], threads = [], tick = {}) {
  const characterId = output.characterId || opportunity.characterId || "";
  if (output.socialIntent && output.targetCharacterId) {
    const refusing = output.socialIntent.kind === "refusal" || output.actionType === "refuse";
    return {
      required: true,
      kind: refusing ? "canonical-refusal" : "canonical-request",
      addresseeId: output.targetCharacterId,
      topic: output.socialIntent.topic || output.chosenAction || "公开请求",
      requestId: output.socialIntent.requestId || "",
      visitId: output.perceivedVisit?.visitId || "",
      allowedSpeechActs: refusing ? ["refuse", "warn", "negotiate"] : ["ask", "offer", "negotiate", "confide"],
    };
  }
  const currentSlotId = tick.slotId || tick.id || "";
  const addressedTurn = unansweredTurnFor(transcript, characterId, { slotId: currentSlotId });
  if (addressedTurn) {
    const sourceThread = [...threads].reverse().find((thread) => (
      thread.status === "open"
      && (thread.turns || []).some((turn) => turn.turnId === addressedTurn.turnId)
    )) || null;
    return {
      required: true,
      kind: "addressed-turn",
      addresseeId: addressedTurn.speakerId,
      topic: sourceThread?.topic || addressedTurn.line,
      currentActionType: output.actionType || opportunity.defaultActionType || "",
      visitId: output.perceivedVisit?.visitId || "",
      visitStage: output.perceivedVisit?.stage || "",
      completionCondition: output.perceivedVisit?.completionCondition || "",
      sourceTurnId: addressedTurn.turnId || "",
      sourceLine: addressedTurn.line || "",
      sourceSpeakerId: addressedTurn.speakerId || "",
      sourceSlotId: addressedTurn.slotId || "",
      sourceSlotLabel: addressedTurn.slotLabel || addressedTurn.slotId || "",
      threadId: sourceThread?.id || "",
      requestId: addressedTurn.socialRequestId || "",
      allowedSpeechActs: ["answer", "acknowledge", "ask", "refuse", "negotiate", "change_subject"],
    };
  }
  const owedThread = [...threads].reverse().find((thread) => thread.status === "open" && thread.nextObligationCharacterId === characterId);
  if (owedThread) {
    const presentIds = new Set(tick.participantIds || []);
    const otherId = (owedThread.participantIds || []).find((id) => id && id !== characterId && presentIds.has(id)) || "";
    if (!otherId) return { required: false, kind: "none", addresseeId: "", topic: "", allowedSpeechActs: [] };
    const sourceTurn = [...(owedThread.turns || [])].reverse().find((turn) => turn.addresseeId === characterId)
      || [...(owedThread.turns || [])].reverse().find(Boolean)
      || null;
    return {
      required: true,
      kind: "event-thread",
      addresseeId: otherId,
      topic: owedThread.topic || "未完成事务",
      stake: owedThread.stake || "",
      threadId: owedThread.id || "",
      sourceTurnId: sourceTurn?.turnId || "",
      sourceLine: sourceTurn?.line || "",
      sourceSpeakerId: sourceTurn?.speakerId || otherId,
      sourceSlotId: sourceTurn?.slotId || owedThread.lastAdvancedSlot || owedThread.openedSlot || "",
      sourceSlotLabel: sourceTurn?.slotLabel || sourceTurn?.slotId || owedThread.lastAdvancedSlot || owedThread.openedSlot || "",
      allowedSpeechActs: ["answer", "acknowledge", "ask", "refuse", "negotiate", "warn", "change_subject"],
    };
  }
  const visit = output.perceivedVisit || null;
  const candidateTypes = new Set((opportunity.candidateActions || []).map((candidate) => candidate.type));
  if (visit?.stage === "waiting"
    && (visit.expectedHostIds || []).includes(characterId)
    && candidateTypes.has("receive_guest")) {
    return {
      required: true,
      kind: "waiting-guest",
      addresseeId: visit.visitorId || output.targetCharacterId || "",
      topic: visit.purpose || "来客的来意",
      stake: visit.completionCondition || "来客会继续等待",
      visitId: visit.visitId || "",
      allowedSpeechActs: ["greet", "acknowledge", "ask", "offer", "refuse"],
    };
  }
  return { required: false, kind: "none", addresseeId: "", topic: "", allowedSpeechActs: [] };
}

function unwrapDecision(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const directKeys = [
    "character_town_tavern_agent_decision",
    "tavernAgentDecision",
    "tavern_agent_decision",
    "decision",
    "result",
    "output",
  ];
  for (const key of directKeys) {
    const nested = raw[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested;
  }
  const entries = Object.entries(raw);
  if (entries.length === 1) {
    const nested = entries[0][1];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested;
  }
  return raw;
}

function canonicalEnumValue(value, allowed, aliases) {
  const token = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (allowed.has(token)) return token;
  return aliases.get(token) || "none";
}

function isBareAcknowledgement(value = "") {
  const stripped = String(value || "")
    .trim()
    .replace(/^[“”"「」『』]+|[“”"「」『』]+$/g, "")
    .replace(/^[^，,。！？!?]{1,6}[，,]\s*/u, "")
    .replace(/[，,。！？!?；;：:\s]/g, "");
  return /^(?:嗯|哦|好|行|可以|好吧|行吧|嗯好|知道了|我知道了|明白了|我明白了|懂了|我懂了)$/.test(stripped);
}

function normalizeDecision(raw = {}, opportunity = {}, presentCharacters = [], interactionObligation = {}) {
  raw = unwrapDecision(raw);
  const candidates = Array.isArray(opportunity.candidateActions) ? opportunity.candidateActions : [];
  const offered = new Set(candidates.map((candidate) => String(candidate.type || "")).filter(Boolean));
  const requestedAction = String(raw.chosenActionType || "");
  const chosenActionType = offered.has(requestedAction) ? requestedAction : String(opportunity.defaultActionType || candidates[0]?.type || "");
  const chosenCandidate = candidates.find((candidate) => String(candidate.type || "") === chosenActionType) || null;
  const speechAct = canonicalEnumValue(raw.speechAct, SPEECH_ACTS, SPEECH_ACT_ALIASES);
  const addresseeId = String(raw.addresseeId || "");
  const allowedAddressees = new Set((presentCharacters || []).map((item) => item.id).filter((id) => id && id !== opportunity.characterId));
  const utterance = String(raw.utterance || "").trim().replace(/^[“”"「」『』]+|[“”"「」『』]+$/g, "").slice(0, 180);
  const obligationRequired = Boolean(interactionObligation?.required);
  const matchesRequiredTarget = !obligationRequired || addresseeId === interactionObligation.addresseeId;
  const allowedSpeechActs = new Set(interactionObligation?.allowedSpeechActs || []);
  const matchesRequiredAct = !obligationRequired || !allowedSpeechActs.size || allowedSpeechActs.has(speechAct);
  const bareAcknowledgement = isBareAcknowledgement(utterance);
  const structurallySpeakable = speechAct !== "none" && utterance && allowedAddressees.has(addresseeId) && matchesRequiredTarget && matchesRequiredAct;
  const canSpeak = structurallySpeakable && !bareAcknowledgement;
  let threadAction = canonicalEnumValue(raw.threadAction, THREAD_ACTIONS, THREAD_ACTION_ALIASES);
  if (!canSpeak) threadAction = "none";
  const seeksResponse = canSpeak && (RESPONSE_SEEKING_ACTS.has(speechAct) || /[？?]\s*$/.test(utterance));
  const obligationTopic = (["event-thread", "canonical-request", "canonical-refusal"].includes(interactionObligation?.kind)
    || (interactionObligation?.kind === "addressed-turn" && interactionObligation?.threadId))
    ? String(interactionObligation.topic || "").trim()
    : "";
  return {
    chosenActionType,
    speechAct: canSpeak ? speechAct : "none",
    addresseeId: canSpeak ? addresseeId : "",
    utterance: canSpeak ? utterance : "",
    privateReason: String(raw.privateReason || "").trim().slice(0, 220),
    desiredResponse: seeksResponse ? String(raw.desiredResponse || "").trim().slice(0, 160) : "",
    threadAction,
    threadTopic: threadAction === "none" ? "" : (obligationTopic || String(raw.threadTopic || "").trim()).slice(0, 120),
    threadStake: threadAction === "none" ? "" : String(raw.threadStake || "").trim().slice(0, 180),
    visitId: chosenCandidate?.visitId || "",
    speechRejectionReason: structurallySpeakable && bareAcknowledgement ? "bare-acknowledgement" : "",
  };
}

function matchingThread(threads, decision, speakerId) {
  if (decision.responseThreadId) {
    const sourced = threads.find((thread) => thread.id === decision.responseThreadId);
    return sourced?.participantIds?.includes(speakerId) && sourced?.participantIds?.includes(decision.addresseeId)
      ? sourced
      : null;
  }
  return threads.find((thread) => thread.status === "open"
    && thread.participantIds?.includes(speakerId)
    && thread.participantIds?.includes(decision.addresseeId)
    && (!decision.threadTopic || thread.topic === decision.threadTopic)) || null;
}

function applyThreadDecision(threads, decision, turn, tick) {
  if (!turn) return;
  let thread = matchingThread(threads, decision, turn.speakerId);
  if (thread && decision.responseThreadId && explicitlyDefers(turn.line)) {
    thread.lastAdvancedDay = tick.day;
    thread.lastAdvancedSlot = tick.slotId || tick.id || "";
    thread.status = "deferred";
    thread.nextObligationCharacterId = "";
    thread.resumeAfterDay = Number(tick.day || 1) + 1;
    thread.deferredSlot = tick.slotId || tick.id || "";
    thread.turns = [...(thread.turns || []), {
      turnId: turn.turnId,
      speakerId: turn.speakerId,
      addresseeId: turn.addresseeId,
      line: turn.line,
      day: tick.day,
      slotId: tick.slotId || tick.id || "",
      slotLabel: tick.label || tick.slotId || tick.id || "",
      action: "defer",
    }].slice(-12);
    return;
  }
  if (decision.threadAction === "none") {
    if (thread && decision.responseThreadId && thread.status === "open" && thread.nextObligationCharacterId === turn.speakerId) {
      thread.lastAdvancedDay = tick.day;
      thread.lastAdvancedSlot = tick.slotId || tick.id || "";
      thread.nextObligationCharacterId = turnRequiresResponse(turn) ? turn.addresseeId : "";
      thread.turns = [...(thread.turns || []), {
        turnId: turn.turnId,
        speakerId: turn.speakerId,
        addresseeId: turn.addresseeId,
        line: turn.line,
        day: tick.day,
        slotId: tick.slotId || tick.id || "",
        slotLabel: tick.label || tick.slotId || tick.id || "",
        action: "answer",
      }].slice(-12);
    }
    return;
  }
  if (!thread && decision.threadAction === "open") {
    thread = {
      id: createId("tavern_thread"),
      topic: decision.threadTopic || turn.line,
      stake: decision.threadStake || "需要有人给出下一步回应。",
      participantIds: [turn.speakerId, turn.addresseeId],
      status: "open",
      openedDay: tick.day,
      openedSlot: tick.slotId || tick.id || "",
      lastAdvancedDay: tick.day,
      lastAdvancedSlot: tick.slotId || tick.id || "",
      nextObligationCharacterId: turn.addresseeId,
      resolutionCondition: decision.desiredResponse || "对方给出具体回应",
      turns: [],
      visitId: turn.visitId || "",
    };
    threads.push(thread);
  }
  if (!thread) return;
  thread.topic = thread.topic || decision.threadTopic || turn.line;
  thread.stake = decision.threadStake || thread.stake;
  thread.lastAdvancedDay = tick.day;
  thread.lastAdvancedSlot = tick.slotId || tick.id || "";
  const needsResponse = turnRequiresResponse(turn);
  if (decision.threadAction === "close") {
    thread.status = "resolved";
    thread.nextObligationCharacterId = "";
    thread.resolvedDay = tick.day;
    thread.resolvedSlot = tick.slotId || tick.id || "";
  } else if (decision.threadAction === "defer") {
    thread.status = "deferred";
    thread.nextObligationCharacterId = "";
    thread.resumeAfterDay = Number(tick.day || 1) + 1;
    thread.deferredSlot = tick.slotId || tick.id || "";
  } else {
    thread.status = "open";
    thread.nextObligationCharacterId = needsResponse ? turn.addresseeId : "";
    if (needsResponse) thread.resolutionCondition = decision.desiredResponse || thread.resolutionCondition || "对方给出具体回应";
  }
  thread.turns = [...(thread.turns || []), {
    turnId: turn.turnId,
    speakerId: turn.speakerId,
    addresseeId: turn.addresseeId,
    line: turn.line,
    day: tick.day,
    slotId: tick.slotId || tick.id || "",
    slotLabel: tick.label || tick.slotId || tick.id || "",
    action: decision.threadAction,
  }].slice(-12);
}

function publicTurn(state, tick, decision) {
  if (!decision.utterance || !decision.addresseeId) return null;
  const speaker = characterById(state, decision.characterId) || {};
  const target = characterById(state, decision.addresseeId) || {};
  const hasResponseSource = Boolean(decision.responseSourceTurnId);
  return {
    turnId: createId("tavern_agent_turn"),
    generatedBy: "tavern-agent-model",
    speakerId: decision.characterId,
    speakerName: speaker.name || decision.characterId,
    targetId: decision.addresseeId,
    targetName: target.name || decision.addresseeId,
    addresseeId: decision.addresseeId,
    addresseeName: target.name || decision.addresseeId,
    speechAct: decision.speechAct,
    act: decision.speechAct,
    line: decision.utterance,
    actionType: decision.chosenActionType,
    visitId: decision.visitId || "",
    interactionKind: decision.interactionKind || "",
    turnRole: decision.interactionKind === "event-thread" ? "thread-continuation" : hasResponseSource ? "response" : "initiative",
    observedTurnId: decision.responseSourceTurnId || "",
    respondsTo: decision.responseSourceTurnId || "",
    responseSourceLine: decision.responseSourceLine || "",
    responseSourceSpeakerId: decision.responseSourceSpeakerId || "",
    responseSourceSlotId: decision.responseSourceSlotId || "",
    responseSourceSlotLabel: decision.responseSourceSlotLabel || "",
    responseThreadId: decision.responseThreadId || "",
    responseTopic: decision.responseTopic || "",
    socialRequestId: decision.socialRequestId || "",
    desiredResponse: decision.desiredResponse,
    day: tick.day,
    slotId: tick.slotId || tick.id || "",
    slotLabel: tick.label || tick.slotId || tick.id || "",
    witnessIds: [...new Set(tick.participantIds || [])],
  };
}

export async function runTavernAgentDecisionPeriod(state = {}, probeDraft = {}, {
  runDecision = runTavernAgentDecision,
  signal,
  maxAgentsPerTick = 3,
  maxFollowupsPerTick = 2,
} = {}) {
  const decisionOverrides = {};
  const decisionsByTick = {};
  const publicTranscript = [];
  const stages = [];
  const failures = [];
  const participationByTick = {};
  const settledSocialRequestIds = new Set();
  const threads = deepClone(state.tavernState?.eventThreads || []).slice(-12);
  const location = (state.locations || []).find((item) => item.id === probeDraft.locationId) || state.locations?.[0] || {};

  for (const tick of probeDraft.periodSimulation?.ticks || []) {
    const decisionOutputs = (tick.agentOutputs || []).filter((output) => !(
      output.socialIntent?.kind === "refusal"
      && settledSocialRequestIds.has(output.socialIntent.requestId)
    ));
    const presentOutputs = decisionOutputs.filter((output) => output.present !== false && output.decisionOpportunity?.candidateActions?.length);
    const presentCharacters = [...new Map(presentOutputs.map((output) => [
      output.characterId,
      publicCharacter(output, characterById(state, output.characterId) || {}),
    ])).values()];
    const ranked = presentOutputs
      .map((output, index) => ({ output, index, score: activationScore(state, tick, output, publicTranscript, threads) }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const activated = [];
    const activatedCharacterIds = new Set();
    for (const item of ranked) {
      if (activatedCharacterIds.has(item.output.characterId)) continue;
      activated.push(item.output);
      activatedCharacterIds.add(item.output.characterId);
      if (activated.length >= Math.max(1, Number(maxAgentsPerTick || 3))) break;
    }
    const allPresentOutputs = decisionOutputs.filter((output) => output.present !== false && output.characterId);
    const allPresentById = new Map(allPresentOutputs.map((output) => [output.characterId, output]));
    const activatedIds = new Set(activated.map((output) => output.characterId));
    const trace = {
      day: tick.day,
      slotId: tick.slotId || tick.id || "",
      slotLabel: tick.label || tick.slotId || tick.id || "",
      presentCharacterIds: [...allPresentById.keys()],
      presentCharacterNames: [...allPresentById.values()].map((output) => output.characterName || characterById(state, output.characterId)?.name || output.characterId),
      activatedAgentIds: [...activatedIds],
      activatedAgentNames: activated.map((output) => output.characterName || characterById(state, output.characterId)?.name || output.characterId),
      followupAgentIds: [],
      followupAgentNames: [],
      completedAgentIds: [],
      failedAgentIds: [],
      ruleOnlyCharacterIds: [...allPresentById.keys()].filter((characterId) => !activatedIds.has(characterId)),
      ruleOnlyCharacterNames: [...allPresentById.values()].filter((output) => !activatedIds.has(output.characterId)).map((output) => output.characterName || characterById(state, output.characterId)?.name || output.characterId),
      witness: { scheduled: false, ran: false, provider: "", stage: "", degraded: false },
    };
    participationByTick[tickKey(tick)] = trace;

    const decideForOutput = async (output, { followup = false } = {}) => {
      const opportunity = deepClone(output.decisionOpportunity);
      if (!opportunity?.candidateActions?.length) return null;
      const character = characterById(state, output.characterId) || {};
      const alreadyAnswered = answeredTurnIds(publicTranscript, output.characterId);
      const visibleTranscript = publicTranscript.filter((turn) => (
        turn.speakerId === output.characterId
        || turn.addresseeId === output.characterId
        || (turn.witnessIds || []).includes(output.characterId)
      )).filter((turn) => !(turn.addresseeId === output.characterId && alreadyAnswered.has(turn.turnId)));
      const interactionObligation = interactionObligationFor(output, opportunity, visibleTranscript, threads, tick);
      if (followup && interactionObligation.kind !== "addressed-turn") return null;
      const currentEventIndex = (tick.lifeEvents || []).findIndex((event) => event.decisionOpportunity?.id === opportunity.id);
      const priorPublicEvents = currentEventIndex >= 0 ? (tick.lifeEvents || []).slice(0, currentEventIndex) : [];
      const relationshipContext = relationshipContextFor(state, output.characterId, presentCharacters);
      const contextManifest = deepClone(output.contextManifest || { targetAgentId: output.characterId, items: [] });
      contextManifest.items = [...(contextManifest.items || []), {
        id: "agent.public-relationships",
        sourceKind: "relationship-ledger",
        scope: "agent",
        priority: 95,
        protected: true,
        inclusionReason: "称谓、熟悉度和公开关系压力必须属于当前人物自己的上下文",
        content: deepClone(relationshipContext),
      }];
      const input = {
        day: tick.day,
        slot: { id: tick.slotId || tick.id || "", label: tick.label || "", focus: tick.slotFocus || "" },
        location: { id: location.id || probeDraft.locationId || "", name: location.name || probeDraft.locationName || "望梯酒馆" },
        institution: deepClone(probeDraft.updateBundle?.tavernState?.institution || state.tavernState?.institution || {}),
        agent: {
          id: output.characterId,
          name: output.characterName || character.name || output.characterId,
          identity: character.lifeProfile?.role || character.externalSituation || "",
          situationalRole: output.situationalRole || character.lifeState?.situationalRole || "在场者",
          agency: deepClone(output.agency || character.lifeProfile?.tavernAgency || {}),
          relationshipContext,
          privateState: ownPrivateState(state, tick, output),
        },
        opportunity,
        interactionObligation: deepClone(interactionObligation),
        presentCharacters: deepClone(presentCharacters),
        publicTranscript: deepClone(visibleTranscript.slice(-12)),
        eventThreads: deepClone(threads.filter((thread) => (
          thread.status === "open"
          && thread.nextObligationCharacterId
          && (thread.participantIds || []).includes(output.characterId)
        )).slice(-8)),
        todayCooledTopics: deepClone(threads.filter((thread) => (
          ["resolved", "deferred"].includes(thread.status)
          && Number(thread.lastAdvancedDay || thread.resolvedDay || 0) === Number(tick.day || 0)
          && (thread.participantIds || []).includes(output.characterId)
        )).map((thread) => ({
          threadId: thread.id,
          topic: thread.topic,
          status: thread.status,
          participantIds: thread.participantIds,
          resumeAfterDay: thread.resumeAfterDay || null,
        })).slice(-8)),
        publicSituation: priorPublicEvents.map((event) => ({
          characterId: event.characterId || "",
          characterName: event.characterName || "",
          activityType: event.activityType || "",
          visibleAction: event.visibleAction || event.description || "",
          consequence: event.consequence || "",
        })).filter((event) => event.visibleAction).slice(-12),
        contextManifest,
      };
      try {
        const result = await runDecision(input, { signal });
        const normalizedDecision = normalizeDecision(result?.decision || result || {}, opportunity, presentCharacters, interactionObligation);
        const reopensCooledTopic = !interactionObligation.required && normalizedDecision.threadTopic && threads.some((thread) => (
          ["resolved", "deferred"].includes(thread.status)
          && Number(thread.lastAdvancedDay || thread.resolvedDay || 0) === Number(tick.day || 0)
          && (thread.participantIds || []).includes(output.characterId)
          && (thread.participantIds || []).includes(normalizedDecision.addresseeId)
          && thread.topic === normalizedDecision.threadTopic
        ));
        if (reopensCooledTopic) {
          normalizedDecision.speechAct = "none";
          normalizedDecision.addresseeId = "";
          normalizedDecision.utterance = "";
          normalizedDecision.desiredResponse = "";
          normalizedDecision.threadAction = "none";
          normalizedDecision.threadTopic = "";
          normalizedDecision.threadStake = "";
          normalizedDecision.speechRejectionReason = "same-day-topic-cooldown";
        }
        const decision = {
          ...normalizedDecision,
          characterId: output.characterId,
          opportunityId: opportunity.id,
          tickKey: tickKey(tick),
          interactionKind: interactionObligation.kind || "",
          responseSourceTurnId: interactionObligation.sourceTurnId || "",
          responseSourceLine: interactionObligation.sourceLine || "",
          responseSourceSpeakerId: interactionObligation.sourceSpeakerId || "",
          responseSourceSlotId: interactionObligation.sourceSlotId || "",
          responseSourceSlotLabel: interactionObligation.sourceSlotLabel || "",
          responseThreadId: interactionObligation.threadId || "",
          responseTopic: interactionObligation.kind === "event-thread" ? interactionObligation.topic || "" : "",
          socialRequestId: interactionObligation.requestId || "",
        };
        decisionOverrides[opportunity.id] = {
          chosenActionType: decision.chosenActionType,
          privateReason: decision.privateReason,
        };
        const turn = publicTurn(state, tick, decision);
        if (turn && !publicTranscript.some((item) => item.speakerId === turn.speakerId && item.line === turn.line && item.slotId === turn.slotId)) {
          publicTranscript.push(turn);
          applyThreadDecision(threads, decision, turn, tick);
          if (interactionObligation.kind === "addressed-turn" && interactionObligation.requestId) {
            settledSocialRequestIds.add(interactionObligation.requestId);
          }
        }
        decisionsByTick[decision.tickKey] = [...(decisionsByTick[decision.tickKey] || []), { ...decision, turn }];
        trace.completedAgentIds.push(output.characterId);
        if (followup) {
          trace.followupAgentIds.push(output.characterId);
          trace.followupAgentNames.push(output.characterName || character.name || output.characterId);
        }
        if (result?.stage) stages.push(result.stage);
        return { decision, turn };
      } catch (error) {
        const failure = {
          characterId: output.characterId,
          characterName: output.characterName || character.name || output.characterId,
          opportunityId: opportunity.id,
          error: error?.message || String(error),
        };
        failures.push(failure);
        trace.failedAgentIds.push(output.characterId);
        if (followup) {
          trace.followupAgentIds.push(output.characterId);
          trace.followupAgentNames.push(output.characterName || character.name || output.characterId);
        }
        stages.push({
          name: `TavernAgentDecision:${failure.characterName}:DeterministicFallback`,
          provider: "deterministic-kernel",
          elapsedMs: 0,
          error: failure.error,
        });
        return null;
      }
    };

    for (const output of activated) {
      await decideForOutput(output);
    }

    const handledFollowupTurnIds = new Set();
    for (let followupIndex = 0; followupIndex < Math.max(0, Number(maxFollowupsPerTick || 0)); followupIndex += 1) {
      const slotId = tick.slotId || tick.id || "";
      const pendingTurn = [...publicTranscript].reverse().find((turn) => {
        if (turn.slotId !== slotId || !turnRequiresResponse(turn) || handledFollowupTurnIds.has(turn.turnId)) return false;
        const targetOutput = allPresentById.get(turn.addresseeId);
        if (!targetOutput?.decisionOpportunity?.candidateActions?.length) return false;
        return !answeredTurnIds(publicTranscript, turn.addresseeId).has(turn.turnId);
      });
      if (!pendingTurn) break;
      const targetOutput = allPresentById.get(pendingTurn.addresseeId);
      const followupResult = await decideForOutput(targetOutput, { followup: true });
      if (followupResult?.turn?.respondsTo === pendingTurn.turnId) {
        handledFollowupTurnIds.add(pendingTurn.turnId);
      }
    }

    trace.followupAgentIds = [...new Set(trace.followupAgentIds)];
    trace.followupAgentNames = [...new Set(trace.followupAgentNames)];
    trace.completedAgentIds = [...new Set(trace.completedAgentIds)];
    trace.failedAgentIds = [...new Set(trace.failedAgentIds)];
    const ranAgentIds = new Set([...trace.activatedAgentIds, ...trace.followupAgentIds]);
    trace.ruleOnlyCharacterIds = [...allPresentById.keys()].filter((characterId) => !ranAgentIds.has(characterId));
    trace.ruleOnlyCharacterNames = [...allPresentById.values()]
      .filter((output) => !ranAgentIds.has(output.characterId))
      .map((output) => output.characterName || characterById(state, output.characterId)?.name || output.characterId);
  }

  return {
    decisionOverrides,
    decisionsByTick,
    eventThreads: threads.slice(-12),
    publicTranscript: publicTranscript.slice(-24),
    participationByTick,
    settledSocialRequestIds: [...settledSocialRequestIds],
    stages,
    failures,
  };
}

function relationshipDeltasForAct(act) {
  if (["answer", "acknowledge", "offer", "greet"].includes(act)) return { dependence: 1, wantsToBeSeen: 1, protection: act === "offer" ? 1 : 0 };
  if (["refuse", "warn"].includes(act)) return { resentment: 1, fear: act === "warn" ? 1 : 0, wantsToEscape: 1 };
  if (["ask", "negotiate"].includes(act)) return { wantsToBeSeen: 2, power: act === "negotiate" ? 1 : 0 };
  if (["gossip", "confide"].includes(act)) return { dependence: 1, deception: act === "gossip" ? 1 : 0 };
  return { wantsToBeSeen: 1 };
}

function agentExchangeForTurns(tick, turns) {
  if (!turns.length) return [];
  return [{
    id: createId("tavern_agent_exchange"),
    generatedFrom: "tavern-agent-model",
    sourceCharacterId: turns[0].speakerId,
    sourceCharacterName: turns[0].speakerName,
    responseCharacterId: turns[0].targetId,
    responseCharacterName: turns[0].targetName,
    sharedObject: "当下公开事务",
    dialogueTurns: turns,
    eventOutcome: `${tick.label || "这一刻"}，这些话已经被在场者听见，尚未自动改变库存、权限或交易结果。`,
  }];
}

export function applyTavernAgentDecisionResult(draft = {}, result = {}, state = {}) {
  const relationshipShifts = [];
  const memories = [];
  const speechEvents = [];
  const threadSignals = [];
  const allExchanges = [];

  for (const tick of draft.periodSimulation?.ticks || []) {
    tick.agentParticipation = deepClone(result.participationByTick?.[tickKey(tick)] || {
      day: tick.day,
      slotId: tick.slotId || tick.id || "",
      slotLabel: tick.label || "",
      presentCharacterIds: [...(tick.participantIds || [])],
      presentCharacterNames: (tick.participantIds || []).map((characterId) => characterById(state, characterId)?.name || characterId),
      activatedAgentIds: [],
      activatedAgentNames: [],
      completedAgentIds: [],
      failedAgentIds: [],
      ruleOnlyCharacterIds: [...(tick.participantIds || [])],
      ruleOnlyCharacterNames: (tick.participantIds || []).map((characterId) => characterById(state, characterId)?.name || characterId),
      witness: { scheduled: false, ran: false, provider: "", stage: "", degraded: false },
    });
    const decisions = result.decisionsByTick?.[tickKey(tick)] || [];
    const turns = decisions.map((decision) => decision.turn).filter(Boolean);
    tick.canonicalDialogueTurns = turns;
    if (turns.length) {
      tick.sceneInteraction = {
        ...(tick.sceneInteraction || {}),
        agentExchanges: agentExchangeForTurns(tick, turns),
      };
      tick.synthesized = { ...(tick.synthesized || {}), sceneInteraction: tick.sceneInteraction };
      if (tick.simulationTick) tick.simulationTick.sceneInteraction = tick.sceneInteraction;
      allExchanges.push(...tick.sceneInteraction.agentExchanges);
      const spokenText = turns.map((turn) => `${turn.speakerName}对${turn.targetName}说：“${turn.line}”`).join(" ");
      if (!turns.every((turn) => String(tick.novelText || tick.sceneText || "").includes(turn.line))) {
        tick.novelText = `${tick.novelText || tick.sceneText || ""}${tick.novelText || tick.sceneText ? " " : ""}${spokenText}`.trim();
        tick.sceneText = tick.novelText;
        tick.synthesized = { ...(tick.synthesized || {}), sceneText: tick.sceneText };
      }
    }

    for (const decision of decisions) {
      const event = (tick.lifeEvents || []).find((item) => item.decisionOpportunity?.id === decision.opportunityId);
      const output = (tick.agentOutputs || []).find((item) => item.decisionOpportunity?.id === decision.opportunityId);
      if (event) {
        event.decisionSource = "tavern-agent-model";
        event.modelDecisionReason = decision.privateReason;
      }
      if (output) {
        output.decisionSource = "tavern-agent-model";
        output.modelDecisionReason = decision.privateReason;
      }
      if (!decision.turn) continue;
      const turn = decision.turn;
      speechEvents.push({
        id: createId("tavern_speech_event"),
        characterId: turn.speakerId,
        characterName: turn.speakerName,
        targetCharacterId: turn.targetId,
        targetCharacterName: turn.targetName,
        activityType: "speak",
        description: turn.line,
        visibleAction: `${turn.speakerName}对${turn.targetName}说：“${turn.line}”`,
        reason: decision.privateReason,
        salience: decision.threadAction === "none" ? 48 : 68,
        present: true,
        generatedBy: "tavern-agent-model",
        turnId: turn.turnId,
        day: tick.day,
        slotId: tick.slotId || tick.id || "",
      });
      relationshipShifts.push({
        id: createId("tavern_dialogue_shift"),
        fromCharacterId: turn.speakerId,
        toCharacterId: turn.targetId,
        deltas: relationshipDeltasForAct(turn.speechAct),
        unspoken: decision.privateReason,
        generatedFrom: "agent-dialogue-relationship",
        relationshipSource: "tavern-agent-model",
        dialogueTurns: [turn],
        dialogueTurnCount: 1,
        finalTurn: turn.line,
        visitId: turn.visitId || "",
        interactionKind: turn.interactionKind || "",
        eventOutcome: `${turn.targetName}已经听见这句话，但如何回应仍由对方决定。`,
        locationId: draft.locationId || "",
        locationName: draft.locationName || "望梯酒馆",
        periodSlot: tick.label || "",
      });
      if (decision.threadAction !== "none") {
        threadSignals.push({
          id: createId("narrative_signal"),
          type: decision.threadAction === "close"
            ? "event-thread-resolved"
            : decision.threadAction === "defer" ? "event-thread-deferred" : "event-thread",
          sourceTurnId: turn.turnId,
          day: tick.day,
          periodLabel: tick.label || "",
          characterId: turn.speakerId,
          targetCharacterId: turn.targetId,
          description: decision.threadTopic || turn.line,
          stake: decision.threadStake || "",
          whyInteresting: decision.threadAction === "close"
            ? "人物用公开回应结束了一项持续事务。"
            : decision.threadAction === "defer"
              ? "人物明确约定改日再谈，这项事务不会在今天反复追问。"
              : "一句公开的话把实际问题交给了另一个人，下一步仍未完成。",
        });
        memories.push({
          id: createId("mem_tavern_dialogue"),
          projectId: state.project?.id,
          characterId: turn.speakerId,
          targetCharacterId: turn.targetId,
          createdAt: new Date().toISOString(),
          day: tick.day,
          type: "direct",
          stance: decision.speechAct === "refuse" ? "boundary" : "unfinished-business",
          reliability: 96,
          heat: decision.threadAction === "close" ? 48 : 62,
          content: `${turn.speakerName}曾对${turn.targetName}说：“${turn.line}”`,
          publicVersion: turn.line,
          privateVersion: decision.privateReason || turn.line,
          sourceTurnId: turn.turnId,
          source: "tavern-agent-model",
        });
      }
    }
    if (speechEvents.length) {
      const thisTickEvents = speechEvents.filter((event) => event.day === tick.day && event.slotId === (tick.slotId || tick.id || ""));
      tick.lifeEvents = [...(tick.lifeEvents || []), ...thisTickEvents];
    }
  }

  draft.sceneInteraction = { ...(draft.sceneInteraction || {}), agentExchanges: allExchanges };
  if (draft.simulationTick) draft.simulationTick.sceneInteraction = draft.sceneInteraction;
  draft.agentOutputs = (draft.periodSimulation?.ticks || []).flatMap((tick) => (tick.agentOutputs || []).map((output) => ({ ...output, periodLabel: tick.label })));
  draft.relationshipShift = [...(draft.relationshipShift || []), ...relationshipShifts];
  draft.narrativeSignals = [...(draft.narrativeSignals || []), ...threadSignals].slice(-18);
  if (draft.periodSimulation) draft.periodSimulation.narrativeSignals = deepClone(draft.narrativeSignals);
  draft.agentDecisionMeta = {
    decisions: Object.values(result.decisionsByTick || {}).flat().length,
    dialogueTurns: result.publicTranscript?.length || 0,
    failures: deepClone(result.failures || []),
    participationByTick: deepClone(result.participationByTick || {}),
  };
  draft.agentParticipation = (draft.periodSimulation?.ticks || []).map((tick) => deepClone(tick.agentParticipation || {}));
  draft.updateBundle = {
    ...(draft.updateBundle || {}),
    tavernState: {
      ...(draft.updateBundle?.tavernState || {}),
      eventThreads: deepClone(result.eventThreads || []).slice(-12),
    },
    relationships: [...(draft.updateBundle?.relationships || []), ...relationshipShifts],
    characterMemories: [...(draft.updateBundle?.characterMemories || []), ...memories],
    lifeEvents: [...(draft.updateBundle?.lifeEvents || []), ...speechEvents],
    stateChangeReasons: [
      ...(draft.updateBundle?.stateChangeReasons || []),
      ...threadSignals.map((signal) => `${signal.periodLabel} / ${signal.description}：${signal.stake || "等待下一步回应"}`),
    ].slice(-48),
  };
  return draft;
}
