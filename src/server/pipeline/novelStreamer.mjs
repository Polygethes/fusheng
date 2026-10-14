import { callOpenAITextStream } from "./responseClient.mjs";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueBy(items, keyFor) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFor(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dialogueSemanticKey(line = "") {
  return clean(line).replace(/[“”"「」『』，,。！？!?；;：:\s]/g, "");
}

function isBackendDialogue(line = "") {
  return /(?:第?\s*\d+|几|多)\s*轮|上一轮|本轮|未结清|把话推回去|继续(?:追问|回应)上一句/.test(String(line || ""));
}

export function buildCanonicalSceneSource(compact = {}, sceneInteraction = {}) {
  const actions = uniqueBy((sceneInteraction.interactionBeats || []).map((beat) => ({
    actorId: beat.actorId || "",
    actorName: beat.actorName || "",
    targetId: beat.targetId || "",
    targetName: beat.targetName || "",
    text: clean(beat.beat || beat.visibleBeat || beat.responseBeat),
  })).filter((item) => item.text), (item) => item.text);

  const dialogue = uniqueBy((sceneInteraction.agentExchanges || []).flatMap((exchange, exchangeIndex) =>
    (exchange.dialogueTurns || []).map((turn, turnIndex) => ({
      order: `${exchangeIndex + 1}.${turnIndex + 1}`,
      speakerId: turn.speakerId || "",
      speakerName: turn.speakerName || "",
      targetId: turn.targetId || "",
      targetName: turn.targetName || "",
      line: clean(turn.line),
      respondsTo: clean(turn.respondsTo),
      sharedObject: clean(exchange.sharedObject),
    }))
  ).filter((item) => item.line && !isBackendDialogue(item.line)), (item) => `${item.speakerId || item.speakerName}|${dialogueSemanticKey(item.line)}`);

  const outcomes = uniqueBy((sceneInteraction.agentExchanges || []).map((exchange) => ({
    sourceCharacterName: exchange.sourceCharacterName || "",
    responseCharacterName: exchange.responseCharacterName || "",
    sharedObject: clean(exchange.sharedObject),
    text: clean(exchange.eventOutcome),
  })).filter((item) => item.text), (item) => item.text);

  const departures = uniqueBy((sceneInteraction.presenceChanges || [])
    .filter((change) => change.decision === "leave" || change.decision === "blocked")
    .map((change) => ({
      characterId: change.characterId || "",
      characterName: change.characterName || "",
      decision: change.decision || "",
      afterTurn: Number(change.departureAfterTurn || 0),
      trigger: clean(change.trigger),
      destinationId: change.destinationId || "",
      destinationName: change.destinationName || "",
      text: clean(change.visibleDeparture),
    })).filter((item) => item.text), (item) => `${item.characterId}|${item.decision}|${item.text}`);

  const aftermath = uniqueBy((sceneInteraction.remainingCastAftermath || []).map((item) => ({
    characterIds: Array.isArray(item.characterIds) ? item.characterIds : [],
    beat: clean(item.beat),
    dialogue: clean(item.dialogue),
  })).filter((item) => item.beat || item.dialogue), (item) => `${item.beat}|${item.dialogue}`);

  return {
    location: compact.selectedLocation?.name || "场中",
    participants: (compact.activeCharacters || []).map((character) => ({
      id: character.id,
      name: character.name,
      visibleIdentity: character.publicIdentity || "",
    })),
    opening: clean(sceneInteraction.surfaceEvent),
    actions,
    dialogue,
    outcomes,
    departures,
    aftermath,
  };
}

function writerSystemPrompt() {
  return `你是正在现场书写的中文小说叙述者。输入是已经由人物代理实际产生的公开行动、对白和结果；你的职责只是把它们写成一段正在发生的小说正文，不能替人物决定新结果。

写作规则：
- 只写读者能看见、听见的事：空间、动作、表情、声音、对白、物件变化和直接后果。
- 禁止解释人物动机、心理、设定、规则意义和关系数值；心理内容属于另一个私密空间。
- 不写标题、时间标签、角色标签、项目符号、总结、点评或幕后术语。
- 对白必须自然嵌入动作，每句输入对白最多出现一次；不得把同一句换个说法再重复。
- 如果 dialogue 非空，正文必须原样写出其中至少连续两句台词，不能把整场交流改写成纯动作。
- 同一个动作或物件状态只写一次。若结构化输入有语义重叠，合并成一个具体瞬间。
- 不要逐项机械覆盖输入；选择足以让冲突成立的细节，但不能丢掉公开对白的因果顺序和最后后果。
- departures 是真实发生的在场状态变化，必须写进正文。人物一旦离开，此后不能再发言、做动作或被写成仍在屋内。
- aftermath 必须发生在离场之后，写出留下者如何追、拦、转向彼此、处理遗留物或改变当前行动；不要解释后台分数。
- 使用连贯、有节奏的现代中文小说散文。避免“他看向她”“气氛紧张”“陷入沉默”等空泛填充。
- 直接开始正文，不要说明你将如何写。`;
}

function dialogueRetentionSuffix(source = {}, novelText = "") {
  if (!Array.isArray(source.dialogue) || source.dialogue.length < 2) return "";
  if (/[“「『"][^”」』"]+[”」』"]/.test(String(novelText || ""))) return "";
  const lines = source.dialogue.slice(0, 3).map((turn, index) => {
    const verb = index === 0 ? "说" : index === 1 ? "答道" : "接着说";
    return `${turn.speakerName || "有人"}${verb}：“${String(turn.line || "").replace(/[“”"「」『』]/g, "")}”`;
  });
  return lines.length ? `\n\n${lines.join("\n\n")}` : "";
}

function writerUserPrompt(source) {
  return `把下面这份唯一的公开现场记录写成小说正文。它已经去除重复通道；不要再引用其他版本。

${JSON.stringify(source, null, 2)}`;
}

export async function streamSceneNovel(compact, sceneInteraction, {
  signal,
  callStream = callOpenAITextStream,
  onDelta,
} = {}) {
  const source = buildCanonicalSceneSource(compact, sceneInteraction);
  let novelText = "";
  try {
    const { text, meta } = await callStream({
      system: writerSystemPrompt(),
      user: writerUserPrompt(source),
      signal,
      onDelta: async (delta) => {
        novelText += delta;
        await onDelta?.(delta);
      },
    });
    novelText = String(text || novelText || "");
    const retentionSuffix = dialogueRetentionSuffix(source, novelText);
    if (retentionSuffix) {
      novelText += retentionSuffix;
      await onDelta?.(retentionSuffix);
    }
    return {
      novelText,
      degraded: false,
      failure: "",
      stage: {
        name: "NovelStreamer",
        provider: meta?.provider || "model",
        model: meta?.model || "",
        elapsedMs: meta?.elapsedMs || 0,
        usage: meta?.usage || null,
      },
    };
  } catch (error) {
    if (!novelText.trim()) {
      novelText = String(sceneInteraction?.sceneText || sceneInteraction?.surfaceEvent || "").trim();
      if (!novelText) throw error;
      await onDelta?.(novelText);
    }
    return {
      novelText,
      degraded: true,
      failure: error?.message || String(error),
      stage: {
        name: "NovelStreamer:Degraded",
        provider: "model-partial",
        model: "",
        elapsedMs: 0,
        usage: null,
      },
    };
  }
}
