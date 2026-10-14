import { callOpenAIJson } from "./responseClient.mjs";

const reactionMomentSchema = {
  type: "object",
  properties: {
    spokenLine: { type: "string" },
    heardLine: { type: "string" },
    speakerName: { type: "string" },
    interpretation: { type: "string" },
    feeling: { type: "string" },
    bodyResponse: { type: "string" },
    privateThought: { type: "string" },
    selfLie: { type: "string" },
    nextImpulse: { type: "string" },
  },
  required: ["spokenLine", "heardLine", "speakerName", "interpretation", "feeling", "bodyResponse", "privateThought", "selfLie", "nextImpulse"],
  additionalProperties: false,
};

const reactionSchema = {
  type: "object",
  properties: {
    moments: {
      type: "array",
      items: reactionMomentSchema,
      minItems: 1,
      maxItems: 6,
    },
  },
  required: ["moments"],
  additionalProperties: false,
};

function systemPrompt(characterName) {
  return `你是${characterName}的私密心理代理。你只处理这个人物的内在反应，不替其他人物解释，也不改写公开场景。

任务：读完当前场所已经公开发生的对白后，为这个人物每一次公开发言写出发言前一瞬真实但未说出口的反应。

约束：
- moments 必须按这个人物公开发言的先后顺序排列，每次发言一项，不能漏掉或增加。
- spokenLine 必须逐字引用这个人物当次说出的公开台词；不要改写。
- heardLine 必须逐字引用促成当次发言的上一句公开台词；人物先开口时填空字符串。
- interpretation 写人物自己的理解，允许误读，禁止全知视角。
- feeling 是具体而矛盾的感受，不要只写“紧张”“复杂”。
- bodyResponse 是尚未必被旁人察觉的身体反应。
- privateThought 必须像此刻脑中真正闪过的一句话，不写心理学解释。
- selfLie 是人物为了继续维持自我形象而告诉自己的话。
- nextImpulse 是下一刻想做的具体事情，不保证真的做出来。
- 不要复述人物设定，不要总结剧情，不要使用“作为”“意味着”“体现了”等分析语言。
- 只返回符合 schema 的 JSON。`;
}

function publicTranscript(sceneInteraction = {}) {
  return (sceneInteraction.agentExchanges || [])
    .flatMap((exchange) => exchange.dialogueTurns || [])
    .map((turn) => ({
      speakerId: turn.speakerId || "",
      speakerName: turn.speakerName || "",
      targetId: turn.targetId || "",
      targetName: turn.targetName || "",
      line: String(turn.line || "").trim(),
    }))
    .filter((turn) => turn.line);
}

function compactCharacterCard(character = {}) {
  return {
    id: character.id || "",
    name: character.name || "",
    publicIdentity: character.publicIdentity || "",
    publicGoal: character.publicGoal || character.currentGoal || "",
    voice: character.voice || character.dialogueStyle || character.actionLines || null,
    boundaries: character.boundaries || character.responseBoundary || null,
  };
}

function compactPrivateState(simulation = {}) {
  return {
    characterId: simulation.characterId || "",
    characterName: simulation.characterName || "",
    targetCharacterId: simulation.targetCharacterId || "",
    targetCharacterName: simulation.targetCharacterName || "",
    publicGoal: simulation.publicGoal || "",
    privateDesire: simulation.privateDesire || "",
    defensiveMask: simulation.defensiveMask || "",
    shadowImpulse: simulation.shadowImpulse || "",
    nobleImpulse: simulation.nobleImpulse || "",
    mistakenBelief: simulation.mistakenBelief || simulation.currentMisreading || "",
    selfLie: simulation.selfLie || "",
    withheldFacts: simulation.withheldFacts || [],
    relationshipDialogueMemory: simulation.relationshipDialogueMemory || null,
  };
}

function reactionUserPrompt(compact, character, simulation, transcript) {
  return `当前地点：${compact.selectedLocation?.name || "场中"}

你负责的人物：
${JSON.stringify(compactCharacterCard(character), null, 2)}

只有这个人物可见的私密状态：
${JSON.stringify(compactPrivateState(simulation), null, 2)}

所有在场者都能听见的当前对白：
${JSON.stringify(transcript, null, 2)}

请按这个人物每次开口的顺序，写出每个发言时刻的内在反应。`;
}

function fallbackHeardTurn(transcript, characterId, spokenLine = "", spokenTurnIndex = -1, proposedHeardLine = "") {
  const spokenKey = speechKey(spokenLine);
  const spokenIndex = Number.isInteger(spokenTurnIndex) && spokenTurnIndex >= 0
    ? spokenTurnIndex
    : spokenKey
    ? transcript.findIndex((turn) => turn.speakerId === characterId && speechKey(turn.line) === spokenKey)
    : -1;
  if (spokenIndex <= 0) return {};
  const priorTurns = transcript.slice(0, spokenIndex);
  const proposedKey = speechKey(proposedHeardLine);
  const proposedPriorTurn = proposedKey
    ? priorTurns.slice().reverse().find((turn) => speechKey(turn.line) === proposedKey)
    : null;
  return proposedPriorTurn
    || priorTurns.slice().reverse().find((turn) => turn.speakerId !== characterId && (!turn.targetId || turn.targetId === characterId))
    || priorTurns.slice().reverse().find((turn) => turn.speakerId !== characterId)
    || priorTurns[priorTurns.length - 1]
    || {};
}

function speechKey(value = "") {
  return String(value || "").replace(/[“”"「」『』，,。！？!?；;：:\s]/g, "").trim();
}

function normalizeReaction(parsed = {}, character = {}, simulation = {}, transcript = [], spokenLine = "", spokenTurnIndex = -1) {
  const ownSpokenLine = String(parsed.spokenLine || spokenLine || "").trim();
  const heard = fallbackHeardTurn(
    transcript,
    character.id || simulation.characterId,
    ownSpokenLine,
    spokenTurnIndex,
    parsed.heardLine,
  );
  return {
    characterId: character.id || simulation.characterId || "",
    characterName: character.name || simulation.characterName || "",
    spokenLine: ownSpokenLine,
    heardLine: String(heard.line || "").trim(),
    speakerName: String(heard.speakerName || "").trim(),
    interpretation: String(parsed.interpretation || simulation.mistakenBelief || "").trim(),
    feeling: String(parsed.feeling || "说不清的戒备里夹着一丝动摇").trim(),
    bodyResponse: String(parsed.bodyResponse || "呼吸在下一句话前停了一瞬。").trim(),
    privateThought: String(parsed.privateThought || simulation.privateDesire || "").trim(),
    selfLie: String(parsed.selfLie || simulation.selfLie || simulation.defensiveMask || "").trim(),
    nextImpulse: String(parsed.nextImpulse || simulation.actionCandidate || simulation.shadowImpulse || "").trim(),
  };
}

function normalizeReactionMoments(parsed = {}, character = {}, simulation = {}, transcript = []) {
  const characterId = character.id || simulation.characterId || "";
  const ownTurns = transcript
    .map((turn, transcriptIndex) => ({ turn, transcriptIndex }))
    .filter((entry) => entry.turn.speakerId === characterId);
  if (!Array.isArray(parsed.moments) || !parsed.moments.length) {
    const latest = ownTurns.at(-1);
    return [normalizeReaction(parsed, character, simulation, transcript, latest?.turn.line || "", latest?.transcriptIndex ?? -1)];
  }
  const unused = new Set(ownTurns.map((_, index) => index));
  const reactions = [];
  for (const moment of parsed.moments) {
    const momentKey = speechKey(moment.spokenLine);
    const turnIndex = ownTurns.findIndex((entry, index) => unused.has(index) && speechKey(entry.turn.line) === momentKey);
    if (turnIndex < 0) continue;
    unused.delete(turnIndex);
    const matched = ownTurns[turnIndex];
    reactions.push(normalizeReaction(moment, character, simulation, transcript, matched.turn.line, matched.transcriptIndex));
  }
  return reactions.length
    ? reactions
    : [normalizeReaction(
      parsed.moments.at(-1) || parsed,
      character,
      simulation,
      transcript,
      ownTurns.at(-1)?.turn.line || "",
      ownTurns.at(-1)?.transcriptIndex ?? -1,
    )];
}

function localFeeling(simulation = {}) {
  const pressure = Number(simulation.pressure || 0);
  const byTone = {
    撤退: "害怕被留下，又恼怒自己先想到逃走。",
    保护: "担心对方受伤，也厌恶这份担心正在暴露自己。",
    惩罚: "怒意里夹着一丝不肯承认的期待。",
    接近: "想靠近，又为这份急切感到难堪。",
    伪装: "表面镇定，心里却在计算哪句话已经露了底。",
    求证: "盼着听见答案，又怕答案真的落下来。",
  };
  return byTone[simulation.tone] || (pressure >= 75
    ? "戒备已经顶到喉咙，仍不肯先显出慌乱。"
    : "戒备里夹着一点不愿承认的动摇。");
}

function localBodyResponse(simulation = {}) {
  const pressure = Number(simulation.pressure || 0);
  if (pressure >= 85) return "呼吸忽然变浅，手指先于念头寻找出口。";
  if (pressure >= 65) return "肩背绷紧了一瞬，手指停在原来的动作上。";
  return "呼吸在下一句话前轻轻停了一拍。";
}

export async function buildLocalDialoguePsychology(compact, privateSimulations = [], sceneInteraction = {}, { onUpdate } = {}) {
  const transcript = publicTranscript(sceneInteraction);
  if (!transcript.length) return { reactions: [], stages: [], failures: [] };
  const reactions = [];
  for (const simulation of privateSimulations) {
    const character = (compact.activeCharacters || []).find((item) => item.id === simulation.characterId) || {
      id: simulation.characterId,
      name: simulation.characterName,
    };
    const ownTurns = transcript
      .map((turn, transcriptIndex) => ({ turn, transcriptIndex }))
      .filter((entry) => entry.turn.speakerId === simulation.characterId);
    const base = {
      interpretation: simulation.falseBeliefs?.[0]
        || simulation.relationshipState?.currentConstraint
        || simulation.defensiveMask
        || "对方正在逼自己先暴露。",
      feeling: localFeeling(simulation),
      bodyResponse: localBodyResponse(simulation),
      privateThought: simulation.privateDesire || simulation.shadowImpulse || "不能先让步。",
      selfLie: simulation.selfLie || simulation.defensiveMask || "我只是按规矩行事。",
      nextImpulse: simulation.actionCandidate || simulation.shadowImpulse || "把手边的东西先按住。",
    };
    const moments = ownTurns.length
      ? ownTurns.map(({ turn, transcriptIndex }) => normalizeReaction(
        { ...base, spokenLine: turn.line },
        character,
        simulation,
        transcript,
        turn.line,
        transcriptIndex,
      ))
      : [normalizeReaction(base, character, simulation, transcript)];
    reactions.push(...moments);
    for (const reaction of moments) await onUpdate?.(reaction);
  }
  return {
    reactions,
    stages: reactions.map((reaction) => ({
      name: `DialoguePsychology:${reaction.characterName || reaction.characterId}:LocalFast`,
      provider: "local",
      model: "private-agent-derived",
      elapsedMs: 0,
      usage: null,
    })),
    failures: [],
  };
}

export async function runDialoguePsychology(compact, privateSimulations, sceneInteraction, {
  signal,
  callModel = callOpenAIJson,
  onUpdate,
} = {}) {
  const transcript = publicTranscript(sceneInteraction);
  if (!transcript.length) return { reactions: [], stages: [], failures: [] };

  const jobs = (privateSimulations || []).map(async (simulation) => {
    const character = (compact.activeCharacters || []).find((item) => item.id === simulation.characterId) || {
      id: simulation.characterId,
      name: simulation.characterName,
    };
    const { parsed, meta } = await callModel({
      system: systemPrompt(character.name || simulation.characterName || "人物"),
      user: reactionUserPrompt(compact, character, simulation, transcript),
      schema: reactionSchema,
      schemaName: "dialogue_psychology_reaction",
      signal,
    });
    const reactions = normalizeReactionMoments(parsed, character, simulation, transcript);
    for (const reaction of reactions) await onUpdate?.(reaction);
    return {
      reactions,
      stage: {
        name: `DialoguePsychology:${character.name || character.id}`,
        provider: meta?.provider || "model",
        model: meta?.model || "",
        elapsedMs: meta?.elapsedMs || 0,
        usage: meta?.usage || null,
      },
    };
  });

  const settled = await Promise.allSettled(jobs);
  const results = settled.filter((item) => item.status === "fulfilled").map((item) => item.value);
  const failures = settled.flatMap((item, index) => {
    if (item.status === "fulfilled") return [];
    const simulation = privateSimulations[index] || {};
    return [{
      characterId: simulation.characterId || "",
      characterName: simulation.characterName || "",
      error: item.reason?.message || String(item.reason),
    }];
  });
  return {
    reactions: results.flatMap((item) => item.reactions),
    stages: results.map((item) => item.stage),
    failures,
  };
}

export { publicTranscript };
