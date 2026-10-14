import { createId } from "../data/seed.js";

const INTERNAL_LANGUAGE = /(?:把(?:欲望|恐惧|羞耻|私欲).{0,12}(?:命名|改名)|自欺|防御|表层理由|私人后台|关系状态|下一步必须|行动候选|这对大家都好|我只是按原则行事|我只是照规矩办|现在不是说这个的时候|先留在|还没盖下最后一道章|没有归属前)/;

function normalizeUtterance(value = "") {
  const line = String(value || "")
    .replace(/[“”"「」]/g, "")
    .replace(/；/g, "。")
    .replace(/\s+/g, " ")
    .trim();
  const actionInventory = (line.match(/、/g) || []).length >= 2 && !/[？?]/.test(line);
  if (!line || INTERNAL_LANGUAGE.test(line) || actionInventory) return "";
  return /[。！？]$/.test(line) ? line : `${line}。`;
}

function uniqueLines(values = []) {
  return [...new Set(values.map(normalizeUtterance).filter(Boolean))];
}

function dialogueCandidates(character = {}, output = {}) {
  const shared = new Set((output.sharedDialogueLines || []).map(normalizeUtterance).filter(Boolean));
  return uniqueLines([
    ...(Array.isArray(character.agentProfile?.dialogueMoves) ? character.agentProfile.dialogueMoves : []),
    ...(Array.isArray(character.defenseLanguage) ? character.defenseLanguage : []),
  ]).filter((line) => !shared.has(line));
}

function hasRuntimeSpeechContext(output = {}) {
  return Boolean(
    String(output.intendedUtterance || "").trim()
    || String(output.conversationObjective || "").trim()
    || String(output.reactionReason || "").trim()
    || String(output.observedUtterance || "").trim()
  );
}

function intentClauseToSpeech(value = "") {
  let clause = String(value || "").trim();
  if (!clause) return "";
  clause = clause
    .replace(/^停止替自己/, "别替我")
    .replace(/^不要替自己/, "别替我")
    .replace(/^别替自己/, "别替我")
    .replace(/^说清他为什么/, "你为什么")
    .replace(/^说清她为什么/, "你为什么")
    .replace(/^说清对方为什么/, "你为什么")
    .replace(/替自己/g, "替我")
    .replace(/自己的/g, "我的")
    .replace(/自己/g, "我")
    .replace(/是否值得/g, "值不值得")
    .replace(/作出可执行的回应/g, "说清楚你打算怎么办")
    .trim();
  if (!clause) return "";
  const command = /^(?:别|不要|先别|停下|放下|让开|听我|把)/.test(clause);
  const question = !command && /为什么|怎么|怎么办|值不值得|答应还是拒绝|是不是|能不能/.test(clause);
  return `${clause.replace(/[。！？]+$/g, "")}${question ? "？" : "。"}`;
}

function runtimeSpeechCandidate(character = {}, output = {}) {
  const intended = normalizeUtterance(output.intendedUtterance || "");
  if (intended) return intended;
  const targetName = String(output.dialogueTargetName || output.targetCharacterName || "").trim();
  let objective = String(output.conversationObjective || "").trim().replace(/[。！？]+$/g, "");
  if (targetName) objective = objective.replace(new RegExp(`^让${targetName}`), "");
  objective = objective
    .replace(new RegExp(`^希望${targetName}`), "")
    .replace(/^希望(?:对方|他|她)/, "")
    .replace(/^希望受影响的人/, "")
    .replace(/^让(?:对方|他|她)/, "")
    .replace(/^让伤者/, "伤者得")
    .replace(/^查清(.+)$/, "$1，我要查清楚")
    .replace(/替他/g, "替我")
    .replace(/替她/g, "替我")
    .replace(/告诉他/g, "告诉我")
    .replace(/告诉她/g, "告诉我")
    .replace(/他的/g, "我的")
    .replace(/她的/g, "我的")
    .replace(/^先听完(.+)，再明确答应或拒绝$/, "先听我把$1说完。再告诉我你答应还是拒绝")
    .replace(/^看见(.+)之后，明确承认或拒绝自己的选择$/, "你已经看见$1了。你认不认可我的选择")
    .replace(/^把请求听完，不用/, "先听我把话说完，别用")
    .replace(/^当面推翻或接受自己的判断/, "你不同意我的判断，就当面说")
    .replace(/^受影响的人说清(.+)改变了什么，并决定留下还是离开$/, "$1到底改变了什么，你说清楚，再决定留不留下");
  const clauses = objective.split(/，|；|并且|并(?=说|问|停|别|不|把|给)/).map(intentClauseToSpeech).filter(Boolean);
  if (clauses.length) {
    const address = targetName ? `${targetName}，` : "";
    return normalizeUtterance(`${address}${clauses.slice(0, 2).join("")}`);
  }
  const reason = intentClauseToSpeech(output.reactionReason || "");
  if (reason) return normalizeUtterance(`${targetName ? `${targetName}，` : ""}${reason}`);
  return "";
}

function runtimeFollowupCandidate(output = {}, observedDecision = null) {
  const heard = normalizeUtterance(observedDecision?.utterance || "");
  if (!heard) return "";
  const targetName = String(output.dialogueTargetName || output.targetCharacterName || "").trim();
  const address = (line) => normalizeUtterance(`${targetName ? `${targetName}，` : ""}${line}`);
  const recent = new Set((output.recentDialogueLines || []).map(normalizeUtterance).filter(Boolean));
  const variant = (values) => {
    const start = stableIndex(`${output.characterId}:${observedDecision?.act || "claim"}`, values.length);
    const rotated = values.slice(start).concat(values.slice(0, start));
    return address(rotated.find((value) => !recent.has(address(value))) || rotated[0]);
  };
  if (/答应还是拒绝|愿不愿意|能不能|是否/.test(heard)) {
    return variant(["我现在不能答应你。", "这件事我不能答应。", "我的回答是不行。", "现在还不行。", "我不会答应。"]);
  }
  if (/谁|哪一位|哪一个|哪个人/.test(heard)) return variant(["我不知道。", "我不能告诉你。", "这件事我不说。", "别再问是谁。"]);
  if (/为什么|凭什么/.test(heard)) {
    const reason = intentClauseToSpeech(output.reactionReason || "");
    return reason ? normalizeUtterance(reason) : "我有我的理由。";
  }
  if (/怎么|怎么办|如何/.test(heard)) return variant(["我还没有想好。", "我现在没有答案。", "这一步我还没决定。", "先让我想清楚。"]);
  if (observedDecision?.act === "condition") return variant([
    "你说的是条件，不是回答。", "这个条件我不接受。", "先回答我的问题。", "别拿条件岔开话。", "我问的不是条件。", "先把刚才那句答完。",
  ]);
  if (observedDecision?.act === "refuse") return variant([
    "那就是拒绝。", "我听见了。你拒绝了。", "好，我知道你的答案了。", "你已经把话说死了。", "那我就当你不答应。", "不用再重复，我听清了。",
  ]);
  return variant([
    "这不是我问的。", "你还没有回答我。", "我说的不是这个。", "别把话岔开。", "先回答刚才那句。", "这句话没有回答我。", "你避开了我的问题。", "我还在等答案。",
  ]);
}

function actionTopic(character = {}, output = {}, observedDecision = null) {
  return String(
    output.dialogueTopic
      || character.agentProfile?.leverageObject
      || output.realtimeLeverageObject
      || output.privateLeverageObject
      || observedDecision?.topic
      || "眼前这件事",
  ).trim();
}

function stableIndex(key = "", length = 1) {
  const size = Math.max(Number(length) || 1, 1);
  let hash = 0;
  for (const char of String(key || "")) hash = (hash * 33 + char.codePointAt(0)) % 104729;
  return hash % size;
}

function voiceCadence(line = "", character = {}) {
  const speech = normalizeUtterance(line);
  if (!speech) return "";
  const fingerprint = [
    character.id,
    character.publicIdentity,
    character.selfMyth,
    character.internalSituation?.repeatedSelfLie,
    character.shameMechanism,
  ].filter(Boolean).join(":");
  const style = stableIndex(fingerprint, 6);
  if (style === 1) return normalizeUtterance(`先等等。${speech}`);
  if (style === 2) return normalizeUtterance(`说吧。${speech}`);
  if (style === 3) return normalizeUtterance(`我只问一遍：${speech}`);
  if (style === 4) return normalizeUtterance(`别绕开。${speech}`);
  if (style === 5) return normalizeUtterance(`你先听我说完。${speech}`);
  return speech;
}

function responseCadence(line = "", character = {}) {
  const speech = normalizeUtterance(line);
  if (!speech) return "";
  const body = speech
    .replace(/^(?:好|行|可以)[，。]*/, "")
    .replace(/^我让一步。/, "");
  const style = stableIndex(`${character.id}:${character.publicIdentity || ""}:response`, 6);
  if (style === 1) return normalizeUtterance(`先说好。${body}`);
  if (style === 2) return normalizeUtterance(`我只答应这一回。${body}`);
  if (style === 3) return normalizeUtterance(`这一步我让。${body}`);
  if (style === 4) return normalizeUtterance(`你别误会。${body}`);
  if (style === 5) return normalizeUtterance(`我听见了。${body}`);
  return speech;
}

function objectiveText(character = {}, output = {}) {
  return String(
    character.agentProfile?.dramaticObjective
      || output.realtimePublicGoal
      || output.privatePublicGoal
      || character.actionLines?.desire
      || character.actionLines?.visible
      || "把事情问清楚",
  )
    .replace(/[。！？]+$/g, "")
    .trim();
}

function classifySpeechAct(line = "") {
  const speech = normalizeUtterance(line);
  if (
    /[？?]$/.test(speech)
    || /(?:为什么|凭什么|怎么|是否|是不是|能不能|可不可以|谁(?:来|会|能|敢|负责)|(?:是|由)谁|哪(?:一位|一个|件|种))/u.test(speech)
  ) return "question";
  if (/^(?:不行|不能|不许|别|休想|我不|没有)/.test(speech)) return "refuse";
  if (/(?:可以|答应|同意).{0,12}(?:但|不过|只要)|(?:先|等).{1,18}(?:再|才)|条件/.test(speech)) return "condition";
  if (/(?:给我|交给|放下|留下|回答|说清楚|让开|退后|住手|必须|得先|需要)/.test(speech)) return "request";
  if (/(?:因为|是|不是|会|不会|已经|没有)/.test(speech)) return "answer";
  return "claim";
}

function fallbackOpening(character = {}, output = {}) {
  const topic = actionTopic(character, output);
  return normalizeUtterance(`${topic}怎么办？`);
}

function freshFallbackLines(character = {}, output = {}) {
  const topic = actionTopic(character, output);
  const address = String(output.dialogueTargetName || "").trim();
  const prefix = address ? `${address}，` : "";
  return uniqueLines([
    `${prefix}先别碰${topic}。`,
    `${prefix}${topic}从哪儿来的？`,
    `${prefix}你拿${topic}做什么？`,
    `${prefix}把${topic}放下，我们再谈。`,
    `${prefix}我不会让你现在带走${topic}。`,
    `${prefix}你先回答：${topic}是谁交给你的？`,
  ].map((line) => voiceCadence(line, character)));
}

function candidateForTurn(character = {}, output = {}, turnIndex = 0, previousOwnDecision = null, observedDecision = null) {
  if (hasRuntimeSpeechContext(output)) {
    const runtimeLine = runtimeSpeechCandidate(character, output);
    const recent = new Set((output.recentDialogueLines || []).map(normalizeUtterance).filter(Boolean));
    if (runtimeLine && runtimeLine !== previousOwnDecision?.utterance && !recent.has(runtimeLine)) return runtimeLine;
    const followup = runtimeFollowupCandidate(output, observedDecision);
    if (followup) return followup;
  }
  const candidates = dialogueCandidates(character, output);
  const recent = new Set((output.recentDialogueLines || []).map(normalizeUtterance).filter(Boolean));
  const unused = candidates.filter((line) => line !== previousOwnDecision?.utterance && !recent.has(line));
  if (unused.length) return unused[turnIndex % unused.length];
  const fallbacks = freshFallbackLines(character, output)
    .filter((line) => line !== previousOwnDecision?.utterance && !recent.has(line));
  if (fallbacks.length) {
    const index = stableIndex(`${output.outputId || output.characterId}:${turnIndex}`, fallbacks.length);
    return fallbacks[index];
  }
  return fallbackOpening(character, output);
}

function responseActFor({ candidate = "", observedDecision = null, output = {}, character = {} } = {}) {
  const ownAct = classifySpeechAct(candidate);
  const observedAct = observedDecision?.act || classifySpeechAct(observedDecision?.utterance || "");
  const tone = String(output.tone || "");
  const boundary = String(character.agentProfile?.responseBoundary || "");
  if (tone === "撤退" || ownAct === "refuse") return "refuse";
  if (tone === "保护") return "protect";
  if (observedAct === "question") return ownAct === "question" ? "question" : "answer";
  if (ownAct === "condition" || boundary || observedAct === "request") return "condition";
  if (ownAct === "question") return "question";
  return ownAct === "claim" ? "answer" : ownAct;
}

function realizeResponse({ candidate = "", act = "answer", observedDecision = null, topic = "眼前这件事", previousOwnDecision = null, character = {}, output = {} } = {}) {
  const ownLine = normalizeUtterance(candidate);
  const observedAct = observedDecision?.act || "claim";
  const observedLine = normalizeUtterance(observedDecision?.utterance || "");
  if (observedAct === "question" && /(?:谁|哪一位|哪一个|哪个人)/.test(observedLine)) {
    if (/(?:^|，)(?:我不知道|我不能说|我不告诉)/.test(ownLine)) return ownLine;
    if (/(?:是我|不是我|由.+(?:来|去)|谁.+都)/.test(ownLine)) return ownLine;
    return normalizeUtterance(`我不知道。${ownLine}`);
  }
  if (observedAct === "question" && /(?:为什么|凭什么)/.test(observedLine) && !/^(?:因为|凭)/.test(ownLine)) {
    return normalizeUtterance(`我有我的理由。${ownLine}`);
  }
  if (observedAct === "question" && /(?:怎么|如何|解释)/.test(observedLine) && classifySpeechAct(ownLine) === "question") {
    return normalizeUtterance(`我现在解释不了。${ownLine}`);
  }
  if (observedAct === "question" && /(?:什么|哪一件|哪一种)/.test(observedLine) && !/(?:是|不是|要|想|没有|不能)/.test(ownLine)) {
    return normalizeUtterance(`我现在不能告诉你。${ownLine}`);
  }
  if (hasRuntimeSpeechContext(output) && ownLine) return ownLine;
  if (previousOwnDecision && ["condition", "protect"].includes(observedAct)) {
    const variants = [
      `可以。先照你说的做，但${topic}得留下。`,
      `行。不过${topic}不能一起带走。`,
      `我让一步。${topic}先别动。`,
      `先按你的办法来。${topic}之后再谈。`,
      `好。${topic}还放在这里。`,
    ];
    const line = variants[stableIndex(`${character.id}:${observedDecision?.turnId}:${output.outputId}`, variants.length)];
    return responseCadence(line, character);
  }
  if (previousOwnDecision && observedAct === "refuse") {
    const variants = [
      `那就先别动${topic}。你把理由说清楚。`,
      `你可以拒绝。${topic}先放下。`,
      `好，你不答应。那就说说${topic}怎么办。`,
    ];
    const line = variants[stableIndex(`${character.id}:${observedDecision?.turnId}:${output.outputId}`, variants.length)];
    return responseCadence(line, character);
  }
  if (act === "refuse" && !/^(?:不行|不能|不许|别|休想|我不)/.test(ownLine)) {
    return normalizeUtterance(`不行。${ownLine}`);
  }
  if (act === "condition" && ownLine) return ownLine;
  if (act === "answer" && ownLine) return ownLine;
  if (act === "question" && ownLine) return ownLine;
  return ownLine || normalizeUtterance(`先说清楚${topic}怎么办。`);
}

export function buildCharacterDialogueDecision({
  character = {},
  target = {},
  output = {},
  observedDecision = null,
  previousOwnDecision = null,
  turnIndex = 0,
} = {}) {
  const decisionOutput = {
    ...output,
    dialogueTopic: previousOwnDecision?.topic || output.dialogueTopic,
    dialogueTargetName: target.name || output.dialogueTargetName || "",
  };
  const provisionalTopic = actionTopic(character, decisionOutput, observedDecision);
  const candidate = candidateForTurn(character, decisionOutput, turnIndex, previousOwnDecision, observedDecision);
  const profileTopic = String(character.agentProfile?.leverageObject || "").trim();
  const topic = profileTopic && String(candidate || "").includes(profileTopic)
    ? profileTopic
    : provisionalTopic;
  const candidateAct = observedDecision
    ? responseActFor({ candidate, observedDecision, output: decisionOutput, character })
    : classifySpeechAct(candidate);
  const shouldAskForExplanation = !hasRuntimeSpeechContext(decisionOutput)
    && !observedDecision
    && candidateAct === "claim"
    && ["求证", "试探"].includes(String(decisionOutput.tone || ""));
  const act = shouldAskForExplanation ? "question" : candidateAct;
  const utterance = observedDecision
    ? realizeResponse({ candidate, act, observedDecision, topic, previousOwnDecision, character, output: decisionOutput })
    : shouldAskForExplanation
      ? normalizeUtterance(`${String(candidate || "").replace(/[。！？]+$/g, "")}。${topic}的事，你怎么解释？`)
      : normalizeUtterance(candidate || fallbackOpening(character, output));
  return {
    turnId: createId("dialogue_turn"),
    generatedBy: "character-agent",
    speakerId: character.id || output.characterId || "",
    speakerName: character.name || output.characterName || character.id || "有人",
    targetId: target.id || output.targetCharacterId || "",
    targetName: target.name || output.targetCharacterName || target.id || "对方",
    act,
    topic,
    proposition: objectiveText(character, decisionOutput),
    boundary: String(character.agentProfile?.responseBoundary || "").trim(),
    utterance,
    observedTurnId: observedDecision?.turnId || "",
    observedUtterance: observedDecision?.utterance || "",
  };
}

export function dialogueDecisionToTurn(decision = {}, turnRole = "turn") {
  return {
    turnId: decision.turnId || createId("dialogue_turn"),
    generatedBy: decision.generatedBy || "character-agent",
    speakerId: decision.speakerId || "",
    speakerName: decision.speakerName || decision.speakerId || "有人",
    targetId: decision.targetId || "",
    targetName: decision.targetName || decision.targetId || "对方",
    act: decision.act || "claim",
    topic: decision.topic || "",
    proposition: decision.proposition || "",
    line: normalizeUtterance(decision.utterance),
    turnRole,
    observedTurnId: decision.observedTurnId || "",
    observedUtterance: decision.observedUtterance || "",
    respondsTo: decision.observedUtterance || "",
  };
}

export function buildAgentDialogueExchange({
  sourceCharacter = {},
  sourceOutput = {},
  responseCharacter = {},
  responseOutput = {},
  conversationPolicy = {},
} = {}) {
  const opening = sourceOutput.dialogueDecision || buildCharacterDialogueDecision({
    character: sourceCharacter,
    target: responseCharacter,
    output: sourceOutput,
  });
  const response = responseOutput.dialogueDecision || buildCharacterDialogueDecision({
    character: responseCharacter,
    target: sourceCharacter,
    output: responseOutput,
    observedDecision: opening,
  });
  const turns = [
    dialogueDecisionToTurn(opening, "claim"),
    dialogueDecisionToTurn(response, "response"),
  ];
  const relationshipMemory = responseOutput.relationshipDialogueMemory || sourceOutput.relationshipDialogueMemory || null;
  const maxTurns = Math.max(2, Math.min(6, Number(conversationPolicy.maxTurns || (relationshipMemory ? 4 : 3))));
  if (maxTurns < 3) return turns;
  const counter = buildCharacterDialogueDecision({
    character: sourceCharacter,
    target: responseCharacter,
    output: sourceOutput,
    observedDecision: response,
    previousOwnDecision: opening,
    turnIndex: 1,
  });
  turns.push(dialogueDecisionToTurn(counter, "counter"));
  if (relationshipMemory && maxTurns >= 4) {
    const followupBase = buildCharacterDialogueDecision({
      character: responseCharacter,
      target: sourceCharacter,
      output: responseOutput,
      observedDecision: counter,
      previousOwnDecision: response,
      turnIndex: 1,
    });
    const memoryObject = String(relationshipMemory.sharedObject || "").trim();
    const followup = {
      ...followupBase,
      utterance: memoryObject && !followupBase.utterance.includes(memoryObject)
        ? normalizeUtterance(`${memoryObject}的事我没忘。${followupBase.utterance}`)
        : followupBase.utterance,
      relationshipMemorySource: relationshipMemory.source || relationshipMemory.relationshipSource || "last-dialogue",
      relationshipMemoryTurn: relationshipMemory.followupTurn || relationshipMemory.finalTurn || "",
    };
    turns.push({
      ...dialogueDecisionToTurn(followup, "turn"),
      relationshipMemorySource: followup.relationshipMemorySource,
      relationshipMemoryTurn: followup.relationshipMemoryTurn,
    });
  }
  return turns;
}
