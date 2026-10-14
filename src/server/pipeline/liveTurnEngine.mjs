import { createId } from "../../data/seed.js";
import { callOpenAIJson } from "./responseClient.mjs";

export const liveTurnSchema = {
  type: "object",
  additionalProperties: false,
  required: ["speech", "action", "moveIntent", "innerNote"],
  properties: {
    speech: { type: "string", description: "台词原文；空字符串表示沉默" },
    action: { type: "string", description: "他人可见的一个具体动作；可为空" },
    moveIntent: { type: "string", enum: ["stay", "leave", "pass"] },
    exitReason: { type: "string" },
    destinationId: { type: "string" },
    innerNote: { type: "string", description: "只进入本人心理工作区的一句内心活动" },
  },
};

function clip(value = "", max = 400) {
  return String(value || "").slice(0, max);
}

export function livePrivateCard(sim = {}, character = {}) {
  return {
    // 我是谁
    characterName: sim.characterName,
    identity: character.externalSituation || "",
    innerState: character.internalSituation || "",
    speechProfile: character.speechProfile || null,
    // 我此刻在做什么
    currentActivity: sim.currentActivity || "",
    // 我此刻想要什么、怕什么
    tone: sim.tone,
    publicGoal: sim.publicGoal,
    privateDesire: sim.privateDesire,
    hiddenFear: sim.agentProfile?.hiddenFear || "",
    selfLie: sim.selfLie,
    whatTheyWantFromOthers: sim.whatTheyWantFromOthers,
    whatTheyRefuseToAdmit: sim.whatTheyRefuseToAdmit,
    conversationObjective: sim.conversationObjective || "",
    reactionReason: sim.reactionReason || "",
    // 我记得什么、瞒着什么
    memoryLine: clip(sim.memoryLine),
    relationshipDialogueTranscript: clip(sim.relationshipDialogueTranscript),
    falseBeliefs: (sim.falseBeliefs || []).slice(0, 2),
    withheldFacts: (sim.withheldFacts || []).slice(0, 2),
    planNextAction: sim.planNextAction,
    // 去留倾向
    pressure: sim.pressure,
    presenceIntent: sim.presenceIntent,
    exitUrgency: sim.exitUrgency,
    exitTrigger: sim.exitTrigger,
    desiredDestinationId: sim.desiredDestinationId,
  };
}

export function liveTurnSystemPrompt(sim = {}) {
  return `你是 Character Town 中人物「${sim.characterName}」的表演 Agent。你不是在完成任务，你是一个正在过自己日子的人。现在轮到你行动一次。
你只知道自己的内心和场景里公开发生的事，不知道任何其他人的想法。

这一回合你可以：
- 继续或推进你手上的事（currentActivity），说不说话都行；
- 对刚才发生的事做出反应：回答、拒绝、追问、打断、岔开话题，或保持沉默（speech 留空）；
- 做一件此刻的你真实会做的身体动作（action）：干活、吃喝、修补、走近、背过身去——不要为了戏剧性硬找道具，不写心理；
- 当留下的代价大于你想要的东西时离开（moveIntent="leave"），给出 exitReason 和 destinationId；
- 无话可说也无事可做时选 moveIntent="pass"。

说话规则：
- 台词要像你这个人嘴里说出来的话：按 speechProfile 的腔调；可以短，可以糙，可以答非所问地回避。
- 若开口，必须接住最近一轮的具体内容，不许自说自话，不许复述别人的话。
- 不要旁白、不要总结、不要解释动机；内心话只写进 innerNote。
- 只输出 JSON。`;
}

function transcriptLines(turns = []) {
  if (!turns.length) return "（还没有人开口，你是第一个行动的人。）";
  return turns.map((turn) => {
    const action = turn.action ? `（${turn.action}）` : "";
    const line = turn.line || turn.speech || "";
    const left = turn.moveIntent === "leave" ? "【已离开】" : "";
    return `${turn.speakerName}${action}${left}：${line || "（沉默）"}`;
  }).join("\n");
}

export function liveTurnUserPrompt({ compact = {}, sim = {}, turns = [] } = {}) {
  const character = (compact.activeCharacters || []).find((item) => item.id === sim.characterId) || {};
  return `场景：${compact.selectedLocation?.name || "未知场所"}（${compact.ui?.timeGrain || "scene"}）
操盘指令：${compact.ui?.userDirective || "无"}
注入事件：${compact.ui?.injectedEvent || "无"}
公开可见事实：
${JSON.stringify(compact.visibleFacts || [], null, 2)}

你是谁、此刻的处境（仅你可见）：
${JSON.stringify(livePrivateCard(sim, character), null, 2)}

到目前为止的公开转录：
${transcriptLines(turns)}

现在轮到你。生成本回合 JSON。`;
}

export function liveTurnModel() {
  return process.env.CHARACTER_TOWN_LIVE_TURN_MODEL || "";
}

export async function defaultRunTurn({ system, user, schema, schemaName, signal }) {
  return callOpenAIJson({ system, user, schema, schemaName, schemaHintMode: "compact", model: liveTurnModel() || undefined, signal });
}

function normalizeLine(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function classifyLiveAct(line = "") {
  if (!line) return "silence";
  if (/[？?]$/.test(line)) return "question";
  if (/^(不|没|别|休想|不行|不可能)/.test(line)) return "refuse";
  return "claim";
}

function normalizeLiveTurn(parsed = {}, sim = {}, turns = [], spoken = new Set()) {
  const lastOther = [...turns].reverse().find((turn) => turn.speakerId !== sim.characterId && turn.line) || null;
  const rawSpeech = normalizeLine(parsed.speech || "");
  const line = rawSpeech && !spoken.has(rawSpeech) ? rawSpeech : "";
  const moveIntent = ["stay", "leave", "pass"].includes(parsed.moveIntent) ? parsed.moveIntent : "stay";
  return {
    turnId: createId("dialogue_turn"),
    generatedBy: "character-agent-model",
    speakerId: sim.characterId || "",
    speakerName: sim.characterName || sim.characterId || "有人",
    targetId: lastOther?.speakerId || sim.targetCharacterId || "",
    targetName: lastOther?.speakerName || sim.targetCharacterName || "对方",
    act: classifyLiveAct(line),
    topic: normalizeLine(sim.conversationObjective || sim.publicGoal || "").split(/[，。；！？,]/)[0].slice(0, 16),
    proposition: sim.publicGoal || "",
    line,
    turnRole: turns.some((turn) => turn.line) ? "response" : "claim",
    observedTurnId: lastOther?.turnId || "",
    observedUtterance: lastOther?.line || "",
    respondsTo: lastOther?.line || "",
    action: normalizeLine(parsed.action || ""),
    moveIntent,
    exitReason: normalizeLine(parsed.exitReason || ""),
    destinationId: String(parsed.destinationId || "").trim(),
    innerNote: normalizeLine(parsed.innerNote || ""),
  };
}

export async function runLiveTurnLoop(compact, privateSimulations = [], {
  signal,
  onTurn,
  runTurn = defaultRunTurn,
  maxTurns = 12,
} = {}) {
  const startedAt = Date.now();
  const simsById = new Map(privateSimulations.map((sim) => [sim.characterId, sim]));
  const order = privateSimulations
    .slice()
    .sort((a, b) => Number(b.pressure || 0) - Number(a.pressure || 0))
    .map((sim) => sim.characterId);
  const turns = [];
  const departed = new Set();
  const spoken = new Set();
  let consecutivePasses = 0;
  let cursor = 0;
  let model = "";
  while (turns.length < maxTurns) {
    const present = order.filter((id) => !departed.has(id));
    if (present.length < 2) break;
    if (consecutivePasses >= present.length) break;
    const sim = simsById.get(present[cursor % present.length]);
    cursor += 1;
    const { parsed, meta } = await runTurn({
      system: liveTurnSystemPrompt(sim),
      user: liveTurnUserPrompt({ compact, sim, turns }),
      schema: liveTurnSchema,
      schemaName: "character_town_live_turn",
      signal,
    });
    model = meta?.model || model;
    const turn = normalizeLiveTurn(parsed, sim, turns, spoken);
    turns.push(turn);
    if (turn.line) spoken.add(turn.line);
    if (turn.moveIntent === "leave") departed.add(sim.characterId);
    consecutivePasses = (turn.line || turn.action) ? 0 : consecutivePasses + 1;
    if (typeof onTurn === "function") await onTurn(turn);
  }
  return {
    turns,
    departures: [...departed],
    stage: {
      name: "AgentDialogue:LiveTurnLoop",
      provider: "openai",
      model,
      elapsedMs: Date.now() - startedAt,
      turnCount: turns.length,
    },
  };
}

export function publicLiveTurn(turn = {}) {
  const { innerNote, ...visible } = turn;
  return visible;
}

export function liveProtocolFromTurns(compact = {}, privateSimulations = [], loopResult = {}) {
  const allTurns = loopResult.turns || [];
  const dialogueTurns = allTurns.filter((turn) => turn.line).map(publicLiveTurn);
  const agentExchanges = dialogueTurns.length >= 2
    ? [{
        sourceCharacterId: dialogueTurns[0].speakerId,
        sourceCharacterName: dialogueTurns[0].speakerName,
        responseCharacterId: dialogueTurns[1].speakerId,
        responseCharacterName: dialogueTurns[1].speakerName,
        sharedObject: dialogueTurns[0].topic || "",
        dialogueTurns,
      }]
    : [];
  const augmented = privateSimulations.map((sim) => {
    const own = allTurns.filter((turn) => turn.speakerId === sim.characterId);
    const ownSpoken = own.filter((turn) => turn.line).map(publicLiveTurn);
    const leaveTurn = own.find((turn) => turn.moveIntent === "leave") || null;
    const lastNote = [...own].reverse().find((turn) => turn.innerNote)?.innerNote || "";
    return {
      ...sim,
      dialogueDecision: ownSpoken[0] || null,
      dialogueExchangeTurns: ownSpoken,
      cognitiveDecision: {
        reaction: leaveTurn ? "leave" : ownSpoken.length ? (ownSpoken[0].turnRole === "claim" ? "talk" : "respond") : "continue",
        reason: lastNote,
      },
      ...(leaveTurn ? {
        presenceIntent: "leave",
        exitUrgency: Math.max(Number(sim.exitUrgency || 0), 0.8),
        exitReason: leaveTurn.exitReason || sim.exitReason || "",
        desiredDestinationId: leaveTurn.destinationId || sim.desiredDestinationId || "",
      } : {}),
    };
  });
  return { privateSimulations: augmented, agentExchanges };
}
