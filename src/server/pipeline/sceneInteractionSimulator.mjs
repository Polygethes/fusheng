import { callOpenAIJson } from "./responseClient.mjs";
import { sceneInteractionSchema } from "./schemas.mjs";
import { retargetTextToLockedTarget } from "./relationshipTargeting.mjs";
import { resolvePresenceDecision } from "./presenceResolver.mjs";
import { interventionPromptBlock } from "../../state/interventions.js";

function systemPrompt() {
  return `你是 Character Town 的 SceneInteractionSimulator。你把多个人物的私人模拟与可见性层放进同一场所，实时模拟误读、试探、遮掩、反击、保护、陷害、共谋和关系变形。

硬规则：
- 不准让任何人物只是承受者；每个人都必须用自己的欲望、误信、保护、报复、爱、欺骗或沉默改变场景。
- 场景必须由 privateSimulations + visibilityLayer 生成，不能像预写剧情。
- 地点的 likelyEvents 只是可触发的可能性，不是已经发生的事实；只有人物动作或已注入事件明确造成时才能写入 surfaceEvent、sceneText 或后果。
- 内心必须转成可表演动作、台词、停顿、物件、文件、证据、谣言、删改或沉默。
- 高尚动作必须带污染；恶意动作必须带爱、恐惧、求救或自毁。
- 场景必须留下不可逆痕迹，并至少产生一个误读或可见性翻转。
- 开场名单不是固定演员表。根据每个私人代理的 presenceIntent、exitUrgency、exitResistance 和触发点执行离场：压力与欲望胜过阻力时让人物真的走出当前地点；阻力更强时写成 blocked，而不是假装人物从未想走。
- presenceChanges 必须标出离开发生在第几句之后、可见动作和有效目的地。人物离开后不得再说话或参与动作。
- remainingCastAftermath 必须继续模拟留下者的即时反应：他们会追、拦、松口气、改口、抢走遗留物、改变联盟或把矛头转向彼此，不能用“众人沉默”结束。
- 对话不是场景必需品。只有 privateSimulations 的 cognitiveDecision 选择 talk/respond，且 dialogueExchangeTurns 已由人物 Agent 生成时，才能输出对应 agentExchange。所有人物都选择 continue、wait 或 leave 时，agentExchanges 必须为空。
- privateSimulations 中的 dialogueDecision / dialogueExchangeTurns 是人物 Agent 已经按顺序作出的公开言语行为。必须保留说话人、顺序、言语行为和原话，场景层只模拟伴随动作、打断、离场、误读和后果，不得替人物另写、补写或延长对白。
- 每个获准的 exchange 必须有 eventOutcome、relationshipDeltas。会话在 conversationEndCondition 达成、明确拒绝或有人离开时结束；不得为了凑句数强迫人物继续说。
- 不写露骨性内容；欲望用注意力、等待、语言、证据、权力、误读和关系行动呈现。
- 输出 JSON，严格匹配 schema。`;
}

function dialogueContinuationContext(privateSimulations = []) {
  const lines = [];
  const seen = new Set();
  for (const sim of privateSimulations || []) {
    const speaker = sim?.characterName || sim?.characterId || "人物";
    const target = sim?.targetCharacterName || sim?.targetCharacterId || "对方";
    const object = sim?.relationshipDialogueMemory?.sharedObject || sim?.memorySharedObject || "";
    const transcript = sim?.relationshipDialogueTranscript || "";
    const historyTranscript = sim?.relationshipDialogueHistoryTranscript || "";
    const memoryLine = /上一轮|未结清|对白全文/.test(String(sim?.memoryLine || "")) ? sim.memoryLine : "";
    for (const text of [transcript, historyTranscript, memoryLine].filter(Boolean)) {
      const key = text.replace(/\s+/g, " ").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      lines.push(`- ${speaker} -> ${target}${object ? ` / ${object}` : ""}：${text}`);
    }
  }
  if (!lines.length) return "场景对白续接上下文：无显式未结清对白。";
  return [
    "场景对白续接上下文：",
    ...lines,
    "本轮 agentExchanges.dialogueTurns 必须接住这些未结清对白：让人物用新的台词、停顿、拒绝、追问、改口、移动物件或保护证据回应上一轮，而不是复述上一轮。",
  ].join("\n");
}

function compactSceneSimulation(sim = {}) {
  return {
    characterId: sim.characterId,
    characterName: sim.characterName,
    targetCharacterId: sim.targetCharacterId,
    targetCharacterName: sim.targetCharacterName,
    agentProfile: sim.agentProfile ? {
      dramaticObjective: sim.agentProfile.dramaticObjective,
      hiddenFear: sim.agentProfile.hiddenFear,
      leverageObject: sim.agentProfile.leverageObject,
      dialogueMoves: (sim.agentProfile.dialogueMoves || []).slice(0, 3),
    } : null,
    tone: sim.tone,
    publicGoal: sim.publicGoal,
    privateDesire: sim.privateDesire,
    defensiveMask: sim.defensiveMask,
    shadowImpulse: sim.shadowImpulse,
    nobleImpulse: sim.nobleImpulse,
    selfLie: sim.selfLie,
    actionCandidate: sim.actionCandidate,
    whatTheyWantFromOthers: sim.whatTheyWantFromOthers,
    whatTheyRefuseToAdmit: sim.whatTheyRefuseToAdmit,
    riskTheyWillCreate: sim.riskTheyWillCreate,
    planLine: sim.planLine,
    planNextAction: sim.planNextAction,
    memoryLine: String(sim.memoryLine || "").slice(0, 700),
    relationshipState: sim.relationshipState || null,
    relationshipDialogueTranscript: String(sim.relationshipDialogueTranscript || "").slice(0, 700),
    relationshipDialogueHistoryTranscript: String(sim.relationshipDialogueHistoryTranscript || "").slice(0, 700),
    pressure: sim.pressure,
    contradictionScore: sim.contradictionScore,
    falseBeliefs: (sim.falseBeliefs || []).slice(0, 2),
    withheldFacts: (sim.withheldFacts || []).slice(0, 2),
    presenceIntent: sim.presenceIntent,
    exitUrgency: sim.exitUrgency,
    exitResistance: sim.exitResistance,
    exitTrigger: sim.exitTrigger,
    exitReason: sim.exitReason,
    desiredDestinationId: sim.desiredDestinationId,
    departureMethod: sim.departureMethod,
    currentActivity: sim.currentActivity || null,
    cognitiveDecision: sim.cognitiveDecision || null,
    dialogueDecision: sim.dialogueDecision || null,
    dialogueExchangeTurns: (sim.dialogueExchangeTurns || []).slice(0, 4),
  };
}

function scenePromptSimulations(compact = {}, privateSimulations = []) {
  return compact.pipelineMode === "fast" || compact.pipelineMode === "balanced" ? privateSimulations.map(compactSceneSimulation) : privateSimulations;
}

function scenePromptRecentContext(compact = {}) {
  const fastMode = compact.pipelineMode === "fast" || compact.pipelineMode === "balanced";
  return {
    recentCanon: fastMode ? (compact.recentCanon || []).slice(0, 2) : compact.recentCanon,
    recentEvidence: fastMode ? (compact.recentEvidence || []).slice(0, 4) : compact.recentEvidence,
    recentRumors: fastMode ? (compact.recentRumors || []).slice(0, 3) : compact.recentRumors,
    activeCharacterMemories: fastMode ? (compact.activeCharacterMemories || []).slice(0, 4) : compact.activeCharacterMemories,
    evidenceLinks: fastMode ? (compact.evidenceLinks || []).slice(0, 4) : compact.evidenceLinks,
    irreversibleTraces: fastMode ? (compact.irreversibleTraces || []).slice(0, 4) : compact.irreversibleTraces,
    periodDayLog: compact.periodDayLog || [],
  };
}

export function buildSceneInteractionUserPrompt({ compact, privateSimulations, visibilityLayer }) {
  const promptSimulations = scenePromptSimulations(compact, privateSimulations);
  return `请实时模拟一轮场景互动。

播放粒度：${compact.ui?.timeGrain || "scene"}
场所：${JSON.stringify(compact.selectedLocation, null, 2)}
可去地点：${JSON.stringify((compact.availableLocations || []).filter((location) => location.id !== compact.selectedLocation?.id), null, 2)}
操盘指令：${compact.ui?.userDirective || "无"}
注入事件：${compact.ui?.injectedEvent || "无"}
操盘干预：
${interventionPromptBlock({ ...compact, interventions: compact.activeInterventions, characters: compact.activeCharacters })}

${dialogueContinuationContext(promptSimulations)}

私人模拟 privateSimulations：
${JSON.stringify(promptSimulations, null, 2)}

可见性层 visibilityLayer：
${JSON.stringify(visibilityLayer, null, 2)}

近期正史/证据/谣言/记忆：
${JSON.stringify(scenePromptRecentContext(compact), null, 2)}

输出预算：
- 不要照抄、不要复写 privateSimulations 或 visibilityLayer 的整段字段；只能提炼成动作、台词、误读和结果。
- 除 agentExchanges.dialogueTurns 外，其余数组最多 2 项；agentExchanges 只能对应 privateSimulations 中已有的 dialogueExchangeTurns，不得新增会话。
- subtextMatrix 最多 2 项，每项只写当前场景中真正说出口的一句台词。
- sceneText 写成短场景，不要把后台解释、字段名或完整内心档案搬到正文。
- 离场必须是可执行的身体事件；离开后的余波只属于仍在场的人。不得让已离开人物在 departureAfterTurn 之后继续发言。

请输出完整 scene interaction JSON。sceneText 可以是完整场景或一拍场景，必须具体可表演。若人物 Agent 已生成 dialogueExchangeTurns，agentExchanges 必须逐字带入并围绕它生成动作与结果；若没有，则 sceneText 和 agentExchanges 都不得自行出现人物对白。`;
}

function ensurePunctuation(text = "") {
  const cleaned = String(text || "").replace(/[“”"「」]/g, "").trim();
  if (!cleaned) return "";
  return /[。！？…]$/.test(cleaned) ? cleaned : `${cleaned}。`;
}

function agentObject(sim = {}, fallback = "手边物件") {
  return sim.agentProfile?.leverageObject || fallback;
}

function controlPlanText(sim = {}) {
  return [
    sim.planInfluence,
    sim.planLine,
    sim.planNextAction,
    sim.actionCandidate,
    sim.publicGoal,
  ].filter(Boolean).join(" ");
}

function hasControlPlanPressure(sim = {}) {
  return /控局计划|currentTactic.*control|当前策略：control|夺回解释权|解释权|城规流程/.test(controlPlanText(sim));
}

function controlPlanDialogueLine(sim = {}, index = 0) {
  if (!hasControlPlanPressure(sim)) return "";
  const text = controlPlanText(sim);
  const object = /灵契/.test(text) ? "灵契" : agentObject(sim, "那件东西");
  if (index === 0) return ensurePunctuation(`名字先不写，${object}留给界石；盖印的人先别进来`);
  return ensurePunctuation(`城规先照${object}，解释权不能由你替我写`);
}

function agentDialogueLine(sim = {}, index = 0) {
  const planLine = controlPlanDialogueLine(sim, index);
  if (planLine) return planLine;
  const move = sim.agentProfile?.dialogueMoves?.[index] || sim.defensiveMask || sim.selfLie || "";
  return ensurePunctuation(move || `${agentObject(sim)}先留下`);
}

function hasRelationshipDialogueMemory(...sims) {
  return sims.some((sim) => (
    sim?.memorySource === "agent_dialogue_relationship"
    || sim?.relationshipDialogueMemory
    || (Array.isArray(sim?.relationshipDialogueHistory) && sim.relationshipDialogueHistory.length > 0)
    || Number(sim?.relationshipHistoryCount || 0) > 0
    || /上一轮|上次|未结清|记得|还在/.test(String(sim?.memoryLine || ""))
  ));
}

function latestRelationshipHistoryEntry(sim = {}) {
  return Array.isArray(sim.relationshipDialogueHistory) ? sim.relationshipDialogueHistory.at(-1) || null : null;
}

function relationshipMemorySharedObject(sim = {}) {
  return sim.memorySharedObject
    || sim.relationshipDialogueMemory?.sharedObject
    || latestRelationshipHistoryEntry(sim)?.sharedObject
    || "";
}

function relationshipMemoryTurn(sim = {}) {
  const latestHistory = latestRelationshipHistoryEntry(sim);
  return sim.relationshipDialogueMemory?.followupTurn
    || sim.relationshipDialogueMemory?.finalTurn
    || latestHistory?.followupTurn
    || latestHistory?.finalTurn
    || "";
}

function relationshipDialogueActForSim(sim = {}) {
  return sim.relationshipDialogueMemory?.relationshipDialogueAct
    || latestRelationshipHistoryEntry(sim)?.relationshipDialogueAct
    || null;
}

function relationshipActFollowupLine({ act = null, sourceObject = "", targetObject = "", target = {}, rememberedTurn = "" } = {}) {
  if (!act?.kind) return "";
  const object = targetObject || sourceObject || "那件东西";
  const remembered = String(rememberedTurn || "");
  if (act.kind === "protect") {
    const hasClinicTexture = /药炉|医坊|救命|伤者|庇护|照骨司/.test(`${act.reason || ""} ${remembered}`);
    return ensurePunctuation(hasClinicTexture
      ? `${object}留在药炉旁，先救人；照骨司的封条等伤者喘过来`
      : `${object}先护住人，规矩等人站稳再说`);
  }
  if (act.kind === "control") {
    return ensurePunctuation(`名字先不写，${object}留给界石；解释权不能由你替我落印`);
  }
  if (act.kind === "withdraw") {
    return ensurePunctuation(`我退半步，${object}不换手，刚才那句话也不交出去`);
  }
  if (act.kind === "bargain") {
    return ensurePunctuation(`价码先别改，${object}压在明处，谁加条件谁先写名`);
  }
  if (act.kind === "accuse") {
    return ensurePunctuation(`${object}还是证据，旧案没开口前谁也别带走`);
  }
  return ensurePunctuation(target.defensiveMask || `${object}先留在两个人中间`);
}

function rememberedTurnReply(rememberedTurn = "", sourceObject = "", targetObject = "", target = {}) {
  const object = targetObject || sourceObject || "那件东西";
  const cleaned = String(rememberedTurn || "").replace(/[“”"「」]/g, "").replace(/[。！？…]+$/g, "").trim();
  const tone = target?.tone || "";
  if (!cleaned) return "";
  if (/盖印|印/.test(cleaned)) {
    if (tone === "保护") return `${object}留给界石，盖印的人先别把伤者带走`;
    if (tone === "惩罚") return `盖印的人先退半步，${object}留在铜盘里`;
    if (tone === "撤退") return `印先别落，${object}留在这里，我退到灯影外`;
    return `盖印的人先别进来，${object}留给界石`;
  }
  if (/谁|哪一个|哪位/.test(cleaned)) {
    return `名字先不写，${object}先留在两个人中间`;
  }
  if (/城规|规矩|法/.test(cleaned)) {
    return `城规先照${object}，人暂时别换位置`;
  }
  if (/走|离开|带走/.test(cleaned)) {
    return `${object}不走，人可以先退一步`;
  }
  return `${object}先不换手，你刚才那句话等界石来回`;
}

function immediateQuestionReply(sourceLine = "", targetLine = "", sharedObject = "", target = {}) {
  const cleanedSource = String(sourceLine || "").replace(/[“”"「」]/g, "").replace(/[。！？…]+$/g, "").trim();
  const cleanedTarget = String(targetLine || "").replace(/[“”"「」]/g, "").replace(/[。！？…]+$/g, "").trim();
  const object = agentObject(target, sharedObject || "那件东西");
  const alreadyAnswers = cleanedTarget && (
    (/盖印|谁|名字|签|界石|不写/.test(cleanedTarget) && /盖印|谁|签/.test(cleanedSource))
    || (/走|离开|带走/.test(cleanedTarget) && /走|离开|带走/.test(cleanedSource))
  );
  if (!cleanedSource || alreadyAnswers) return ensurePunctuation(cleanedTarget);
  if (/谁.*盖印|盖印.*谁|谁.*签|签.*谁/.test(cleanedSource)) {
    return ensurePunctuation(`名字先不写，盖印的人也先别进来，${object}留给界石。${cleanedTarget}`);
  }
  if (/盖印|落印|签押/.test(cleanedSource)) {
    return ensurePunctuation(`印先别落，${object}还在两个人中间。${cleanedTarget}`);
  }
  if (/谁|哪一个|哪位/.test(cleanedSource)) {
    return ensurePunctuation(`名字先不写，${object}先留在眼前。${cleanedTarget}`);
  }
  if (/走|离开|带走/.test(cleanedSource)) {
    return ensurePunctuation(`${object}不走，人也不能被你一句话带走。${cleanedTarget}`);
  }
  return ensurePunctuation(cleanedTarget);
}

function immediateCounterReply(targetLine = "", counterLine = "", sharedObject = "", source = {}) {
  const cleanedTarget = String(targetLine || "").replace(/[“”"「」]/g, "").replace(/[。！？…]+$/g, "").trim();
  const cleanedCounter = String(counterLine || "").replace(/[“”"「」]/g, "").replace(/[。！？…]+$/g, "").trim();
  const object = agentObject(source, sharedObject || "那件东西");
  const alreadyAnswers = cleanedCounter && (
    (/名字|盖印|界石|签/.test(cleanedCounter) && /名字|盖印|界石|签/.test(cleanedTarget))
    || (/走|离开|带走/.test(cleanedCounter) && /走|离开|带走/.test(cleanedTarget))
  );
  if (!cleanedTarget || alreadyAnswers) return ensurePunctuation(cleanedCounter);
  if (/名字|盖印|界石|签/.test(cleanedTarget)) {
    return ensurePunctuation(`界石可以等，名字不能替你写；${object}还在盘里。${cleanedCounter}`);
  }
  if (/不走|离开|带走|换手/.test(cleanedTarget)) {
    return ensurePunctuation(`${object}不走，你也别把话撤回灯影里。${cleanedCounter}`);
  }
  return ensurePunctuation(cleanedCounter);
}

function modelMemoryFollowupLine(source = {}, target = {}, sharedObject = "") {
  if (!hasRelationshipDialogueMemory(source, target)) return "";
  const sourceObject = relationshipMemorySharedObject(source) || sharedObject || agentObject(source);
  const targetObject = relationshipMemorySharedObject(target) || agentObject(target, sourceObject);
  const rememberedTurn = relationshipMemoryTurn(target) || relationshipMemoryTurn(source);
  const relationshipAct = relationshipDialogueActForSim(target) || relationshipDialogueActForSim(source);
  const actLine = relationshipActFollowupLine({
    act: relationshipAct,
    sourceObject,
    targetObject,
    target,
    rememberedTurn,
  });
  if (actLine) return actLine;
  if (rememberedTurn) {
    return ensurePunctuation(rememberedTurnReply(rememberedTurn, sourceObject, targetObject, target));
  }
  if (targetObject && targetObject !== sourceObject) {
    return ensurePunctuation(`既然${sourceObject}还在原处，${targetObject}先别写进供词`);
  }
  return ensurePunctuation(`既然${sourceObject}还在原处，谁改口谁先认`);
}

function relationshipTextureFromOutcome(source = {}, target = {}, eventOutcome = "", sharedObject = "") {
  const outcome = String(eventOutcome || "");
  const object = sharedObject || agentObject(source) || agentObject(target) || "那件东西";
  const sourceName = source.characterName || source.characterId;
  const targetName = target.characterName || target.characterId;
  if (/退路|不能替你写|不能被.*改成退路|不能只把话推回去/.test(outcome)) {
    return {
      sourceDeltas: { wantsToBeSeen: 3, resentment: 3, power: 3, deception: 1 },
      targetDeltas: { fear: 3, wantsToEscape: 4, deception: 2, shame: 1 },
      sourceMisreading: `${sourceName}把${targetName}试图把${object}改成退路听成对自己审判权的逃避。`,
      targetMisreading: `${targetName}把${sourceName}压回界石前的最后一句听成自己的退路被堵住。`,
    };
  }
  if (/药炉|医坊|救命|伤者|庇护/.test(outcome)) {
    return {
      sourceDeltas: { protection: 3, dependence: 1, wantsToBeSeen: 1 },
      targetDeltas: { protection: 4, fear: 1, dependence: 1 },
      sourceMisreading: `${sourceName}把${targetName}没有拿走${object}记成暂时承认医坊的保护边界。`,
      targetMisreading: `${targetName}把${sourceName}围绕${object}的坚持听成先救人、后审案的压力。`,
    };
  }
  if (/界石|盖印|铜盘|印没有落/.test(outcome)) {
    return {
      sourceDeltas: { wantsToBeSeen: 3, resentment: 3, power: 1, deception: 1 },
      targetDeltas: { fear: 1, wantsToEscape: 1, deception: 2, power: 3 },
      sourceMisreading: `${sourceName}把${targetName}借界石和盖印规矩留下${object}听成对自己审判权的挑战。`,
      targetMisreading: `${targetName}把${sourceName}逼到铜盘前的开口听成必须借城规夺回解释权。`,
    };
  }
  if (/不换手|不交|留在两人中间|没有接走/.test(outcome)) {
    return {
      sourceDeltas: { wantsToBeSeen: 3, resentment: 2, deception: 1 },
      targetDeltas: { fear: 2, wantsToEscape: 2, deception: 2 },
      sourceMisreading: `${sourceName}把${targetName}没有接走${object}记成对自己判断权的拖延。`,
      targetMisreading: `${targetName}把${sourceName}围绕${object}的开口听成逼近。`,
    };
  }
  return {
    sourceDeltas: { wantsToBeSeen: 3, resentment: 2, deception: 1 },
    targetDeltas: { fear: 2, wantsToEscape: 2, deception: 2 },
    sourceMisreading: `${sourceName}把${targetName}围绕${object}的回应记成对自己判断权的挑战。`,
    targetMisreading: `${targetName}把${sourceName}围绕${object}的开口听成逼近。`,
  };
}

function relationshipDeltasForExchange(source = {}, target = {}, eventOutcome = "", sharedObject = "") {
  const texture = relationshipTextureFromOutcome(source, target, eventOutcome, sharedObject);
  return [
    {
      fromCharacterId: source.characterId || "",
      toCharacterId: target.characterId || "",
      deltas: texture.sourceDeltas,
      misreading: texture.sourceMisreading,
      unspoken: eventOutcome,
    },
    {
      fromCharacterId: target.characterId || "",
      toCharacterId: source.characterId || "",
      deltas: texture.targetDeltas,
      misreading: texture.targetMisreading,
      unspoken: eventOutcome,
    },
  ].filter((shift) => shift.fromCharacterId && shift.toCharacterId && shift.fromCharacterId !== shift.toCharacterId);
}

function relationshipMomentumFromHistory(source = {}, target = {}) {
  const histories = [source?.relationshipDialogueHistory, target?.relationshipDialogueHistory]
    .filter(Array.isArray)
    .sort((a, b) => b.length - a.length);
  const history = histories[0] || [];
  if (history.length < 2) return null;
  const objects = [...new Set(history.map((item) => item.sharedObject).filter(Boolean))].slice(-3);
  const latest = history.at(-1) || {};
  const count = history.length;
  return {
    historyCount: count,
    objects,
    latestTurn: latest.followupTurn || latest.finalTurn || "",
    reason: `连续${count}轮围绕${objects.join("、") || "同一组筹码"}没结清，模型场景关系变化不再按单次互动计算。`,
  };
}

function relationshipPressureContinuationLine({ source = {}, target = {}, sharedObject = "", previousLine = "" } = {}) {
  const momentum = relationshipMomentumFromHistory(source, target);
  if (!momentum || Number(momentum.historyCount || 0) < 3) return "";
  const object = sharedObject || momentum.objects?.at?.(-1) || agentObject(source) || "那件东西";
  const previous = String(previousLine || "");
  if (/药炉|医坊|救命|伤者|庇护/.test(previous)) {
    return ensurePunctuation(`${object}可以留在药炉旁，但这一次你要当面承认人先于案卷`);
  }
  if (/界石|盖印|铜盘|名字|证据|契/.test(`${previous} ${object}`)) {
    return ensurePunctuation(`界石还照着${object}，名字不能替你写，证据也不能被你改成退路`);
  }
  return ensurePunctuation(`${object}还留在原处，这次得有人当面把它说清`);
}

function applyRelationshipMomentum(deltas = {}, momentum = null, side = "source") {
  if (!momentum) return deltas;
  const boost = Math.min(3, Math.max(1, Number(momentum.historyCount || 0)));
  const next = { ...deltas };
  if (side === "source") {
    next.resentment = (next.resentment || 0) + boost;
    next.wantsToBeSeen = (next.wantsToBeSeen || 0) + boost;
  } else {
    next.fear = (next.fear || 0) + boost;
    next.wantsToEscape = (next.wantsToEscape || 0) + boost;
  }
  return next;
}

function applyMomentumToExchangeDeltas(deltas = [], source = {}, target = {}) {
  const momentum = relationshipMomentumFromHistory(source, target);
  if (!momentum) return deltas;
  return (deltas || []).map((shift) => {
    const side = shift.fromCharacterId === source.characterId ? "source" : "target";
    return {
      ...shift,
      deltas: applyRelationshipMomentum(shift.deltas || {}, momentum, side),
      relationshipMomentum: momentum,
    };
  });
}

function eventOutcomeFromFollowup({ source = {}, target = {}, sharedObject = "", followupLine = "" } = {}) {
  const line = String(followupLine || "");
  const object = sharedObject || agentObject(source) || "那件东西";
  const sourceName = source.characterName || source.characterId || "一方";
  const targetName = target.characterName || target.characterId || "另一方";
  if (!line.trim()) return "";
  if (/药炉|救命|伤者|医坊|照骨司|庇护/.test(line)) {
    return `${targetName}没有把${object}拿离药炉，${object}被压回药炉旁；伤者留在医坊里。`;
  }
  if (/退路|不能替你写|不能被你改成退路|不能只把话推回去/.test(line)) {
    return `${sourceName}把最后一句压回界石前，${targetName}没能把${object}改成退路；盖印的人仍停在铜盘外。`;
  }
  if (/界石/.test(line)) {
    return `${targetName}没有接走${object}，把${object}留给界石；盖印的人停在铜盘外。`;
  }
  if (/盖印|印/.test(line)) {
    return `${targetName}把话压回盖印处，${object}仍扣在铜盘边，印没有落下。`;
  }
  if (/铜盘/.test(line)) {
    return `${sourceName}和${targetName}都没有收回手，${object}被留在铜盘里。`;
  }
  if (/不换手|先不换|不交|留/.test(line)) {
    return `${targetName}没有接走${object}，${object}被留在两人中间。`;
  }
  if (/退|半步/.test(line)) {
    return `${targetName}退开半步，${object}留在原处，没有人立刻改口。`;
  }
  return `${targetName}用下一句话改变了${object}的位置，${sourceName}没有得到原来的回应。`;
}

function eventOutcomeFromDialogueTurns({ source = {}, target = {}, sharedObject = "", targetLine = "", counterLine = "" } = {}) {
  const line = `${targetLine || ""} ${counterLine || ""}`;
  const object = sharedObject || agentObject(source) || "那件东西";
  const sourceName = source.characterName || source.characterId || "一方";
  const targetName = target.characterName || target.characterId || "另一方";
  if (!line.trim()) return "";
  if (/界石|盖印|名字|签/.test(line)) {
    return `${targetName}没有接走${object}，把${object}留给界石；盖印的人停在铜盘外，名字没有写进盘边。`;
  }
  if (/不走|离开|带走|换手/.test(line)) {
    return `${targetName}没有接走${object}，${object}被留在两人中间。`;
  }
  return `${sourceName}把${object}推到两人中间；${targetName}没有收走，只把手停在${object}旁边。`;
}

function calibrateOutcomeFromLatestTurn({ eventOutcome = "", source = {}, target = {}, sharedObject = "", dialogueTurns = [] } = {}) {
  const latestLine = (Array.isArray(dialogueTurns) ? dialogueTurns : []).at?.(-1)?.line || "";
  if (!latestLine) return eventOutcome;
  const latestOutcome = eventOutcomeFromFollowup({ source, target, sharedObject, followupLine: latestLine });
  if (!latestOutcome) return eventOutcome;
  if (/退路|不能替你写|不能被你改成退路|不能只把话推回去/.test(latestLine)
    && !/退路|不能替你写|不能被你改成退路|不能只把话推回去/.test(eventOutcome)) {
    return latestOutcome;
  }
  if (/药炉|救命|伤者|医坊|照骨司|庇护/.test(latestLine)
    && !/药炉|救命|伤者|医坊|照骨司|庇护/.test(eventOutcome)) {
    return latestOutcome;
  }
  return eventOutcome;
}

function buildFallbackExchange(source, target) {
  const sharedObject = agentObject(source, agentObject(target));
  const sourceLine = agentDialogueLine(source, 0);
  const targetLine = immediateQuestionReply(sourceLine, agentDialogueLine(target, 0), sharedObject, target);
  const counterLine = immediateCounterReply(targetLine, agentDialogueLine(source, 1) || sourceLine, sharedObject, source);
  const followupLine = modelMemoryFollowupLine(source, target, sharedObject);
  const pressureContinuationLine = relationshipPressureContinuationLine({
    source,
    target,
    sharedObject,
    previousLine: followupLine || counterLine,
  });
  const eventOutcome = eventOutcomeFromFollowup({ source, target, sharedObject, followupLine: pressureContinuationLine || followupLine })
    || eventOutcomeFromDialogueTurns({ source, target, sharedObject, targetLine, counterLine })
    || `${source.characterName}把${sharedObject}推到两人中间；${target.characterName}没有收走，只把手停在${sharedObject}旁边。`;
  const dialogueTurns = [
    {
      speakerId: source.characterId,
      speakerName: source.characterName,
      targetId: target.characterId,
      targetName: target.characterName,
      line: sourceLine,
      turnRole: "claim",
    },
    {
      speakerId: target.characterId,
      speakerName: target.characterName,
      targetId: source.characterId,
      targetName: source.characterName,
      line: targetLine,
      turnRole: "response",
      respondsTo: sourceLine,
    },
    {
      speakerId: source.characterId,
      speakerName: source.characterName,
      targetId: target.characterId,
      targetName: target.characterName,
      line: counterLine,
      turnRole: "counter",
      respondsTo: targetLine,
    },
    followupLine ? {
      speakerId: target.characterId,
      speakerName: target.characterName,
      targetId: source.characterId,
      targetName: source.characterName,
      line: followupLine,
      turnRole: "turn",
      respondsTo: counterLine,
    } : null,
    pressureContinuationLine ? {
      speakerId: source.characterId,
      speakerName: source.characterName,
      targetId: target.characterId,
      targetName: target.characterName,
      line: pressureContinuationLine,
      turnRole: "turn",
      respondsTo: followupLine || counterLine,
    } : null,
  ].filter(Boolean).filter((turn) => turn.speakerId && turn.targetId && turn.line);
  return {
    sourceCharacterId: source.characterId,
    responseCharacterId: target.characterId,
    sourceCharacterName: source.characterName,
    responseCharacterName: target.characterName,
    dialogueTurns,
    eventOutcome,
    relationshipDeltas: relationshipDeltasForExchange(source, target, eventOutcome, sharedObject),
    sharedObject,
    generatedFrom: "model-agent-dialogue",
  };
}

function fallbackAgentExchanges(privateSimulations = []) {
  const exchanges = [];
  const used = new Set();
  for (const source of privateSimulations) {
    const target = privateSimulations.find((sim) => sim.characterId === source.targetCharacterId)
      || privateSimulations.find((sim) => sim.characterId !== source.characterId);
    if (!target) continue;
    const key = [source.characterId, target.characterId].sort().join("<->");
    if (used.has(key)) continue;
    used.add(key);
    exchanges.push(buildFallbackExchange(source, target));
  }
  return exchanges;
}

function stripTerminalPunctuation(text = "") {
  return String(text || "").replace(/[。！？…]+$/g, "").trim();
}

function quoteDialogueLine(line = "") {
  const cleaned = String(line || "").replace(/[“”"「」]/g, "").trim();
  if (!cleaned) return "";
  return /[。！？…]$/.test(cleaned) ? cleaned : `${cleaned}。`;
}

function exchangeTurnSpeakerName(turn = {}, exchange = {}, sourceName = "一方", targetName = "另一方") {
  return turn.speakerName || (turn.speakerId === exchange.sourceCharacterId ? sourceName : targetName);
}

function bridgeLineFromPreviousAgentExchange(exchange = {}, previousExchange = null) {
  if (!previousExchange) return "";
  const previousSourceName = previousExchange.sourceCharacterName || previousExchange.dialogueTurns?.[0]?.speakerName || "一方";
  const previousTargetName = previousExchange.responseCharacterName || previousExchange.dialogueTurns?.[1]?.speakerName || "另一方";
  const previousTurns = Array.isArray(previousExchange.dialogueTurns) ? previousExchange.dialogueTurns : [];
  const previousResponse = previousTurns[1] || previousTurns.at?.(-1);
  if (!previousResponse?.line) return "";
  const currentParticipants = [
    { id: exchange.sourceCharacterId, name: exchange.sourceCharacterName || exchange.dialogueTurns?.[0]?.speakerName },
    { id: exchange.responseCharacterId, name: exchange.responseCharacterName || exchange.dialogueTurns?.[1]?.speakerName },
  ].filter((item) => item.id || item.name);
  const previousParticipantIds = new Set([previousExchange.sourceCharacterId, previousExchange.responseCharacterId].filter(Boolean));
  const previousParticipantNames = new Set([previousSourceName, previousTargetName].filter(Boolean));
  const bridgeParticipant = currentParticipants.find((item) => !previousParticipantIds.has(item.id) && !previousParticipantNames.has(item.name)) || currentParticipants[1] || currentParticipants[0] || {};
  const targetName = bridgeParticipant.name || exchange.responseCharacterName || exchange.dialogueTurns?.[1]?.speakerName || "另一方";
  const previousSpeaker = exchangeTurnSpeakerName(previousResponse, previousExchange, previousSourceName, previousTargetName);
  if (!targetName || !previousSpeaker || targetName === previousSpeaker) return "";
  const object = exchange.sharedObject || "场中的东西";
  const stakeText = (exchange.dialogueTurns || []).map((turn) => turn?.line || "").join(" ");
  const heardLine = stripTerminalPunctuation(previousResponse.line || "").split(/[；。！？]/)[0].slice(0, 24);
  if (/庇护牌|伤者|救命|人名|药炉/.test(stakeText)) return `${targetName}听见${previousSpeaker}刚才那句，指尖没有离开庇护牌。`;
  if (/价码|旧案|账册/.test(stakeText)) return `${targetName}接住${previousSpeaker}刚才那句，把价码和${object}一起留在明处。`;
  if (/镜|供词|案卷|灵痕/.test(stakeText)) return `${targetName}听见${previousSpeaker}那句，镜面还没有把记录合上。`;
  if (/水线|渡令|渡口/.test(stakeText)) return `${targetName}听见${previousSpeaker}那句，水线没有让开。`;
  if (/魂灯|死人/.test(stakeText)) return `${targetName}听见${previousSpeaker}那句，魂灯仍亮在旁边。`;
  return `${targetName}听见${previousSpeaker}刚才那句“${heardLine}”，没有退到场外。`;
}

function sceneTextFromAgentExchange(exchange = {}, previousExchange = null) {
  if (!Array.isArray(exchange?.dialogueTurns) || !exchange.dialogueTurns.length) return "";
  const sourceName = exchange.sourceCharacterName || exchange.dialogueTurns?.[0]?.speakerName || "一方";
  const targetName = exchange.responseCharacterName || exchange.dialogueTurns?.[1]?.speakerName || "另一方";
  const object = exchange.sharedObject || "场中的东西";
  const outcome = stripTerminalPunctuation(exchange.eventOutcome || "");
  const bridge = bridgeLineFromPreviousAgentExchange(exchange, previousExchange);
  const turns = (exchange.dialogueTurns || [])
    .map((turn) => {
      const speaker = exchangeTurnSpeakerName(turn, exchange, sourceName, targetName);
      const line = quoteDialogueLine(turn.line || "");
      return line ? `${speaker}说：“${line}”` : "";
    })
    .filter(Boolean);
  return [
    bridge || `${sourceName}和${targetName}停在${object}旁边。`,
    turns.join(""),
    outcome ? `${outcome}。` : "",
  ].filter(Boolean).join(" ");
}

function sceneTextFromAgentExchanges(agentExchanges = []) {
  return (agentExchanges || [])
    .map((exchange, index, exchanges) => sceneTextFromAgentExchange(exchange, exchanges[index - 1] || null))
    .filter(Boolean)
    .join(" ");
}

function exchangeTextAlreadyCovered(sceneText = "", agentExchanges = []) {
  const text = String(sceneText || "");
  if (!text.trim()) return false;
  return (agentExchanges || []).every((exchange) => {
    const turns = exchange.dialogueTurns || [];
    const requiredLines = [
      turns[0]?.line,
      turns[1]?.line,
      turns.at?.(-1)?.line,
      exchange.eventOutcome,
    ].filter(Boolean);
    return requiredLines.length > 0 && requiredLines.every((line) => text.includes(stripTerminalPunctuation(line)));
  });
}

function mergeSceneTextWithAgentExchanges(sceneText = "", fallbackSceneText = "", agentExchanges = []) {
  const modelText = String(sceneText || "").trim();
  const exchangeText = String(fallbackSceneText || "").trim();
  if (!modelText) return exchangeText;
  if (!exchangeText || exchangeTextAlreadyCovered(modelText, agentExchanges)) return modelText;
  return `${modelText} ${exchangeText}`;
}

function participantNameForId(characterId = "", fallbackSpeaker = {}, fallbackTarget = {}) {
  if (!characterId) return "";
  if (characterId === fallbackSpeaker.characterId) return fallbackSpeaker.characterName || characterId;
  if (characterId === fallbackTarget.characterId) return fallbackTarget.characterName || characterId;
  return characterId;
}

function normalizeDialogueTurn(turn = {}, fallbackSpeaker = {}, fallbackTarget = {}, role = "turn", options = {}) {
  const expectedSpeakerId = fallbackSpeaker.characterId || "";
  const expectedTargetId = fallbackTarget.characterId || "";
  const allowedIds = new Set(options.allowedParticipantIds || []);
  const modelInsideAllowedPair = options.allowAnyLockedPair
    && allowedIds.has(turn.speakerId)
    && allowedIds.has(turn.targetId)
    && turn.speakerId !== turn.targetId;
  const forceExpectedPair = Boolean(options.lockParticipants && !modelInsideAllowedPair);
  const modelUsedExpectedPair = (!turn.speakerId || turn.speakerId === expectedSpeakerId)
    && (!turn.targetId || turn.targetId === expectedTargetId);
  const line = forceExpectedPair && !modelUsedExpectedPair && options.fallbackLine
    ? options.fallbackLine
    : turn.line || options.fallbackLine || "";
  const speakerId = forceExpectedPair ? expectedSpeakerId : turn.speakerId || expectedSpeakerId;
  const targetId = forceExpectedPair ? expectedTargetId : turn.targetId || expectedTargetId;
  return {
    speakerId,
    speakerName: forceExpectedPair
      ? fallbackSpeaker.characterName || expectedSpeakerId
      : participantNameForId(speakerId, fallbackSpeaker, fallbackTarget) || turn.speakerName || speakerId,
    targetId,
    targetName: forceExpectedPair
      ? fallbackTarget.characterName || expectedTargetId
      : participantNameForId(targetId, fallbackSpeaker, fallbackTarget) || turn.targetName || targetId,
    line: ensurePunctuation(line),
    turnRole: turn.turnRole || role,
    ...(turn.respondsTo ? { respondsTo: turn.respondsTo } : {}),
  };
}

function exchangeTurnPair(source = {}, target = {}, index = 0) {
  const respondingSide = index % 2 === 1;
  return respondingSide
    ? { speaker: target, target: source }
    : { speaker: source, target };
}

function exchangeTurnRole(index = 0) {
  if (index === 0) return "claim";
  if (index === 1) return "response";
  if (index === 2) return "counter";
  return "turn";
}

function mergeDeltasKeepingStronger(base = {}, texture = {}) {
  const merged = { ...(base || {}) };
  for (const [key, value] of Object.entries(texture || {})) {
    const current = Number(merged[key] || 0);
    const next = Number(value || 0);
    merged[key] = Math.abs(next) > Math.abs(current) ? next : current;
  }
  return merged;
}

function relationshipDialogueActFromText(text = "", speakerName = "人物", sharedObject = "") {
  const line = String(text || "");
  const object = sharedObject || "场中物件";
  if (/救命|先救|药炉|医坊|不问正邪|人不能|不能被拖|护住|保护|伤者/.test(line)) {
    return {
      kind: "protect",
      deltas: { protection: 4, dependence: 1 },
      reason: `${speakerName}把${object}重新命名为救命和保护的边界。`,
    };
  }
  if (/城规|规矩|界石|盖印|名字|签押|照骨司|审讯|扣押|命名|解释权/.test(line)) {
    return {
      kind: "control",
      deltas: { power: 3, wantsToBeSeen: 1, deception: 1 },
      reason: `${speakerName}用${object}争夺城规、名字或解释权。`,
    };
  }
  if (/不交|不走|不能离开|不换手|退半步|先别动|别带走|撤开|退开/.test(line)) {
    return {
      kind: "withdraw",
      deltas: { wantsToEscape: 3, fear: 1, deception: 1 },
      reason: `${speakerName}把${object}留在场中，同时给自己留退路。`,
    };
  }
  if (/价码|买卖|押的是|押上|毒誓|换符/.test(line)) {
    return {
      kind: "bargain",
      deltas: { deception: 3, power: 1 },
      reason: `${speakerName}把${object}改成交易筹码。`,
    };
  }
  if (/证据不能走|旧案|翻案|审判|追杀|血仇/.test(line)) {
    return {
      kind: "accuse",
      deltas: { resentment: 3, power: 1 },
      reason: `${speakerName}把${object}说成审判、旧案或追责的证据。`,
    };
  }
  return null;
}

function relationshipDialogueActForSpeaker(dialogueTurns = [], speakerId = "", speakerName = "人物", sharedObject = "") {
  const spoken = (dialogueTurns || [])
    .filter((turn) => turn?.speakerId === speakerId)
    .map((turn) => turn.line)
    .filter(Boolean)
    .join(" ");
  return relationshipDialogueActFromText(spoken, speakerName, sharedObject);
}

function calibrateRelationshipShiftFromOutcome(shift = {}, source = {}, target = {}, eventOutcome = "", sharedObject = "", dialogueTurns = []) {
  const texture = relationshipTextureFromOutcome(source, target, eventOutcome, sharedObject);
  const isSourceDirection = shift.fromCharacterId === source.characterId && shift.toCharacterId === target.characterId;
  const isTargetDirection = shift.fromCharacterId === target.characterId && shift.toCharacterId === source.characterId;
  if (!isSourceDirection && !isTargetDirection) return shift;
  const texturedDeltas = isSourceDirection ? texture.sourceDeltas : texture.targetDeltas;
  const texturedMisreading = isSourceDirection ? texture.sourceMisreading : texture.targetMisreading;
  const dialogueAct = isSourceDirection
    ? relationshipDialogueActForSpeaker(dialogueTurns, source.characterId, source.characterName || source.characterId, sharedObject)
    : relationshipDialogueActForSpeaker(dialogueTurns, target.characterId, target.characterName || target.characterId, sharedObject);
  const needsConcreteMisreading = (
    /退路|不能替你写|不能被.*改成退路|不能只把话推回去/.test(String(eventOutcome || ""))
    && !/退路/.test(String(shift.misreading || ""))
  ) || (
    /界石|盖印|铜盘|印没有落/.test(String(eventOutcome || ""))
    && !/界石|盖印|铜盘|城规/.test(String(shift.misreading || ""))
  );
  return {
    ...shift,
    deltas: mergeDeltasKeepingStronger(
      mergeDeltasKeepingStronger(shift.deltas || {}, texturedDeltas),
      dialogueAct?.deltas,
    ),
    relationshipDialogueAct: dialogueAct || shift.relationshipDialogueAct,
    misreading: needsConcreteMisreading ? texturedMisreading : shift.misreading,
  };
}

function normalizeExchangeDeltas(deltas = [], source = {}, target = {}, fallbackDeltas = [], eventOutcome = "", sharedObject = "", dialogueTurns = []) {
  const parsed = Array.isArray(deltas) ? deltas : [];
  const participantIds = new Set([source.characterId, target.characterId].filter(Boolean));
  const allParsedDeltasStayInsideLockedPair = parsed.length > 0 && parsed.every((shift) => (
    participantIds.has(shift.fromCharacterId)
    && participantIds.has(shift.toCharacterId)
    && shift.fromCharacterId !== shift.toCharacterId
  ));
  if (!allParsedDeltasStayInsideLockedPair) return fallbackDeltas;
  const presentDirections = new Set(parsed.map((shift) => `${shift.fromCharacterId}->${shift.toCharacterId}`));
  const missingFallbacks = (fallbackDeltas || []).filter((shift) => (
    participantIds.has(shift.fromCharacterId)
    && participantIds.has(shift.toCharacterId)
    && shift.fromCharacterId !== shift.toCharacterId
    && !presentDirections.has(`${shift.fromCharacterId}->${shift.toCharacterId}`)
  ));
  return [...parsed, ...missingFallbacks].map((shift) =>
    calibrateRelationshipShiftFromOutcome(shift, source, target, eventOutcome, sharedObject, dialogueTurns)
  );
}

function ensureRelationshipMemoryFollowup(turns = [], fallbackTurns = [], source = {}, target = {}) {
  if (!hasRelationshipDialogueMemory(source, target) || !fallbackTurns[3]) return turns;
  let nextTurns = turns;
  if (nextTurns.length < 4) {
    const previousTurn = nextTurns[2] || nextTurns.at?.(-1) || null;
    nextTurns = [
      ...nextTurns,
      {
        ...fallbackTurns[3],
        ...(previousTurn?.line ? { respondsTo: previousTurn.line } : {}),
      },
    ];
  }
  if (fallbackTurns[4] && nextTurns.length < 5) {
    const previousTurn = nextTurns.at?.(-1) || null;
    nextTurns = [
      ...nextTurns,
      {
        ...fallbackTurns[4],
        ...(previousTurn?.line ? { respondsTo: previousTurn.line } : {}),
      },
    ];
  }
  return nextTurns;
}

function forbiddenExchangeNames(privateSimulations = [], source = {}, target = {}) {
  return privateSimulations
    .filter((sim) => sim.characterId && sim.characterId !== source.characterId && sim.characterId !== target.characterId)
    .flatMap((sim) => [sim.characterName, sim.characterId])
    .filter(Boolean);
}

function normalizeAgentExchange(exchange = {}, privateSimulations = []) {
  const source = privateSimulations.find((sim) => sim.characterId === exchange.sourceCharacterId)
    || privateSimulations.find((sim) => sim.characterId === exchange.actorId)
    || privateSimulations[0]
    || {};
  const lockedTarget = privateSimulations.find((sim) => sim.characterId === source.targetCharacterId);
  const target = lockedTarget
    || privateSimulations.find((sim) => sim.characterId === exchange.responseCharacterId)
    || privateSimulations.find((sim) => sim.characterId === exchange.targetId)
    || privateSimulations.find((sim) => sim.characterId !== source.characterId)
    || {};
  const modelTargetId = exchange.responseCharacterId || exchange.targetId || "";
  const modelTargetWasOverridden = Boolean(lockedTarget?.characterId && modelTargetId && modelTargetId !== lockedTarget.characterId);
  const fallback = source.characterId && target.characterId ? buildFallbackExchange(source, target) : null;
  const fallbackTurns = fallback?.dialogueTurns || [];
  const dialogueTurns = (Array.isArray(exchange.dialogueTurns) ? exchange.dialogueTurns : [])
    .map((turn, index) => {
      const pair = exchangeTurnPair(source, target, index);
      return normalizeDialogueTurn(turn, pair.speaker, pair.target, exchangeTurnRole(index), {
        lockParticipants: true,
        allowAnyLockedPair: index >= 3,
        allowedParticipantIds: [source.characterId, target.characterId].filter(Boolean),
        fallbackLine: fallbackTurns[index]?.line || "",
      });
    })
    .filter((turn) => turn.speakerId && turn.targetId && turn.line);
  const lockedDialogueTurns = dialogueTurns.length >= 3
    ? ensureRelationshipMemoryFollowup(dialogueTurns, fallbackTurns, source, target)
    : fallbackTurns;
  const rawEventOutcome = exchange.eventOutcome || fallback?.eventOutcome || "";
  const retargetedEventOutcome = modelTargetWasOverridden
    ? retargetTextToLockedTarget(rawEventOutcome, {
      targetName: target.characterName,
      forbiddenNames: forbiddenExchangeNames(privateSimulations, source, target),
    })
    : rawEventOutcome;
  const sharedObject = exchange.sharedObject || fallback?.sharedObject || "";
  const eventOutcome = calibrateOutcomeFromLatestTurn({
    eventOutcome: retargetedEventOutcome,
    source,
    target,
    sharedObject,
    dialogueTurns: lockedDialogueTurns,
  });
  const lockedRelationshipDeltas = normalizeExchangeDeltas(
    exchange.relationshipDeltas,
    source,
    target,
    fallback?.relationshipDeltas || [],
    eventOutcome,
    sharedObject,
    lockedDialogueTurns,
  );
  const momentumRelationshipDeltas = applyMomentumToExchangeDeltas(lockedRelationshipDeltas, source, target);
  const normalized = {
    sourceCharacterId: source.characterId || fallback?.sourceCharacterId || exchange.sourceCharacterId || "",
    responseCharacterId: target.characterId || fallback?.responseCharacterId || exchange.responseCharacterId || "",
    sourceCharacterName: source.characterName || fallback?.sourceCharacterName || exchange.sourceCharacterName || "",
    responseCharacterName: target.characterName || fallback?.responseCharacterName || exchange.responseCharacterName || "",
    dialogueTurns: lockedDialogueTurns || [],
    eventOutcome,
    relationshipDeltas: momentumRelationshipDeltas,
    sharedObject,
    generatedFrom: exchange.generatedFrom || "model-agent-dialogue",
  };
  return normalized.dialogueTurns.length ? normalized : null;
}

function normalizeDialogueTurnsForShift(turns = []) {
  return (Array.isArray(turns) ? turns : [])
    .map((turn) => {
      const line = String(turn?.line || "").trim();
      if (!line) return null;
      return {
        speakerId: String(turn?.speakerId || ""),
        speakerName: String(turn?.speakerName || ""),
        targetId: String(turn?.targetId || ""),
        targetName: String(turn?.targetName || ""),
        line,
        turnRole: String(turn?.turnRole || ""),
        respondsTo: String(turn?.respondsTo || ""),
      };
    })
    .filter(Boolean);
}

function exchangeRelationshipShift(exchange = {}) {
  const turns = exchange.dialogueTurns || [];
  const dialogueTurns = normalizeDialogueTurnsForShift(turns);
  const continuationTurns = turns.slice(3).filter((turn) => turn?.line);
  const followupTurn = continuationTurns.at(-1)?.line || turns[3]?.line || "";
  const finalTurn = turns.at?.(-1)?.line || followupTurn || turns[2]?.line || turns[1]?.line || turns[0]?.line || "";
  return (exchange.relationshipDeltas || []).map((shift) => ({
    ...shift,
    generatedFrom: "model-agent-dialogue",
    dialogueTurnCount: dialogueTurns.length,
    dialogueTurns,
    eventOutcome: exchange.eventOutcome || shift.unspoken || "",
    sharedObject: exchange.sharedObject || "",
    finalTurn,
    followupTurn,
    relationshipSource: "model-agent-exchange",
  }));
}

function pairKey(fromCharacterId = "", toCharacterId = "") {
  return `${fromCharacterId}->${toCharacterId}`;
}

function normalizeParsedRelationshipShifts(shifts = [], agentExchanges = []) {
  const allowedPairs = new Set(agentExchanges.flatMap((exchange) => [
    pairKey(exchange.sourceCharacterId, exchange.responseCharacterId),
    pairKey(exchange.responseCharacterId, exchange.sourceCharacterId),
  ]));
  const dialoguePairs = new Set(agentExchanges.flatMap((exchange) =>
    (exchange.relationshipDeltas || []).map((shift) => pairKey(shift.fromCharacterId, shift.toCharacterId))
  ));
  return (Array.isArray(shifts) ? shifts : []).filter((shift) => (
    allowedPairs.has(pairKey(shift.fromCharacterId, shift.toCharacterId))
    && !dialoguePairs.has(pairKey(shift.fromCharacterId, shift.toCharacterId))
  ));
}

function normalizePresenceChanges(parsed = {}, privateSimulations = [], compact = {}) {
  const parsedByCharacter = new Map((parsed.presenceChanges || []).map((change) => [change.characterId, change]));
  return privateSimulations.map((simulation) => {
    const character = (compact.activeCharacters || []).find((item) => item.id === simulation.characterId) || {};
    const resolved = resolvePresenceDecision({
      simulation,
      character,
      relationships: compact.relationships || [],
      currentLocation: compact.selectedLocation || {},
      availableLocations: compact.availableLocations || [compact.selectedLocation].filter(Boolean),
    });
    if (resolved.decision === "stay") return null;
    const modelChange = parsedByCharacter.get(simulation.characterId) || {};
    const departureAfterTurn = Math.max(1, Math.round(Number(modelChange.departureAfterTurn || 1)));
    return {
      ...resolved,
      characterName: modelChange.characterName || resolved.characterName,
      departureAfterTurn,
      destinationId: resolved.destinationId || modelChange.destinationId || "",
      destinationName: resolved.destinationName || modelChange.destinationName || "",
      trigger: modelChange.trigger || resolved.trigger,
      visibleDeparture: modelChange.visibleDeparture
        || resolved.departureMethod
        || (resolved.decision === "leave"
          ? `${resolved.characterName}越过门槛，离开了${compact.selectedLocation?.name || "这里"}。`
          : `${resolved.characterName}朝出口迈了一步，却没有走成。`),
    };
  }).filter(Boolean);
}

function dialogueSemanticKey(line = "") {
  return String(line || "")
    .replace(/[“”"「」『』]/g, "")
    .replace(/[，,。！？!?；;：:\s]/g, "")
    .trim();
}

function isBackendTurnManagementLine(line = "") {
  const text = String(line || "");
  return /(?:第?\s*\d+|几|多)\s*轮|上一轮|本轮|未结清|把话推回去|接住(?:刚才|上一轮|那句|这句).*话|继续(?:追问|回应)上一句/.test(text);
}

function sanitizeAgentExchangeDialogue(agentExchanges = []) {
  const seenBySpeaker = new Map();
  return agentExchanges.map((exchange) => ({
    ...exchange,
    dialogueTurns: (exchange.dialogueTurns || []).filter((turn) => {
      if (isBackendTurnManagementLine(turn.line)) return false;
      const key = dialogueSemanticKey(turn.line);
      if (!key) return false;
      const seen = seenBySpeaker.get(turn.speakerId || turn.speakerName || "") || [];
      const duplicate = seen.some((previous) => (
        previous === key
        || (Math.min(previous.length, key.length) >= 12 && (previous.includes(key) || key.includes(previous)))
      ));
      if (duplicate) return false;
      seen.push(key);
      seenBySpeaker.set(turn.speakerId || turn.speakerName || "", seen);
      return true;
    }),
  })).filter((exchange) => exchange.dialogueTurns.length);
}

function trimExchangesAfterDeparture(agentExchanges = [], presenceChanges = []) {
  const departures = new Map(presenceChanges
    .filter((change) => change.decision === "leave")
    .map((change) => [change.characterId, change.departureAfterTurn]));
  if (!departures.size) return agentExchanges;
  let ordinal = 0;
  return agentExchanges.map((exchange) => ({
    ...exchange,
    dialogueTurns: (exchange.dialogueTurns || []).filter((turn) => {
      ordinal += 1;
      return ![turn.speakerId, turn.targetId].some((characterId) => (
        departures.has(characterId) && ordinal > departures.get(characterId)
      ));
    }),
  })).filter((exchange) => exchange.dialogueTurns.length);
}

function normalizeRemainingCastAftermath(parsed = {}, presenceChanges = [], privateSimulations = []) {
  const departedIds = new Set(presenceChanges.filter((change) => change.decision === "leave").map((change) => change.characterId));
  if (!departedIds.size) return [];
  const remaining = privateSimulations.filter((simulation) => !departedIds.has(simulation.characterId));
  const departedNames = presenceChanges.filter((change) => change.decision === "leave").map((change) => change.characterName).filter(Boolean);
  const valid = (parsed.remainingCastAftermath || []).filter((aftermath) => {
    const ids = Array.isArray(aftermath.characterIds) ? aftermath.characterIds : [];
    const dialogue = String(aftermath.dialogue || "");
    return ids.length > 0
      && ids.every((id) => remaining.some((simulation) => simulation.characterId === id))
      && departedNames.every((name) => !dialogue.includes(`${name}说`));
  }).map((aftermath) => ({
    characterIds: aftermath.characterIds,
    beat: String(aftermath.beat || "").trim(),
    dialogue: String(aftermath.dialogue || "").trim(),
  })).filter((aftermath) => aftermath.beat || aftermath.dialogue);
  if (valid.length || !remaining.length) return valid;
  const leaver = presenceChanges.find((change) => change.decision === "leave");
  const first = remaining[0];
  const second = remaining[1];
  return [{
    characterIds: remaining.slice(0, 2).map((simulation) => simulation.characterId),
    beat: `${leaver.characterName}离开后，${remaining.slice(0, 2).map((simulation) => simulation.characterName).join("和")}留在原地，没有立刻追上去。`,
    dialogue: second ? `${first.characterName}对${second.characterName}说：“先别动他留下的东西。”` : "",
  }];
}

function appendPresenceToSceneText(sceneText = "", presenceChanges = [], aftermath = []) {
  let next = String(sceneText || "").trim();
  const additions = [
    ...presenceChanges.map((change) => change.visibleDeparture),
    ...aftermath.flatMap((item) => [item.beat, item.dialogue]),
  ].map((item) => String(item || "").trim()).filter(Boolean);
  for (const addition of additions) {
    if (next.includes(addition)) continue;
    next = `${next}${next ? " " : ""}${addition}`;
  }
  return next;
}

export function normalizeSceneInteraction(parsed = {}, privateSimulations = [], visibilityLayer = {}, compact = {}) {
  const normalizedExchanges = (Array.isArray(parsed.agentExchanges) && parsed.agentExchanges.length
    ? parsed.agentExchanges.map((exchange) => normalizeAgentExchange(exchange, privateSimulations)).filter(Boolean)
    : fallbackAgentExchanges(privateSimulations));
  const presenceChanges = normalizePresenceChanges(parsed, privateSimulations, compact);
  const agentExchanges = sanitizeAgentExchangeDialogue(trimExchangesAfterDeparture(normalizedExchanges, presenceChanges));
  const remainingCastAftermath = normalizeRemainingCastAftermath(parsed, presenceChanges, privateSimulations);
  const departedIds = new Set(presenceChanges.filter((change) => change.decision === "leave").map((change) => change.characterId));
  const agentRelationshipShifts = agentExchanges.flatMap(exchangeRelationshipShift);
  const parsedRelationshipShifts = normalizeParsedRelationshipShifts(parsed.relationshipShift, agentExchanges);
  const fallbackSceneText = sceneTextFromAgentExchanges(agentExchanges);
  const sceneText = appendPresenceToSceneText(
    mergeSceneTextWithAgentExchanges(parsed.sceneText, fallbackSceneText, agentExchanges),
    presenceChanges,
    remainingCastAftermath,
  );
  return {
    surfaceEvent: parsed.surfaceEvent || "人物在同一场所中让私人后台撞上可见事实。",
    sceneText: sceneText || "两个人停在场中，没有人把手边的东西先收回去。",
    directorNotes: parsed.directorNotes || "SceneInteractionSimulator returned normalized defaults.",
    interactionBeats: Array.isArray(parsed.interactionBeats) ? parsed.interactionBeats : privateSimulations.map((sim) => ({
      actorId: sim.characterId,
      actorName: sim.characterName,
      targetId: sim.targetCharacterId,
      targetName: sim.targetCharacterName,
      visibleBeat: sim.publicGoal,
      privateIntent: sim.privateDesire,
      defensiveMask: sim.defensiveMask,
      shadowLeak: sim.shadowImpulse,
      result: sim.riskCreated,
    })),
    misunderstandings: Array.isArray(parsed.misunderstandings) ? parsed.misunderstandings : [],
    reversals: Array.isArray(parsed.reversals) ? parsed.reversals : [],
    visibilityFlips: Array.isArray(parsed.visibilityFlips) ? parsed.visibilityFlips : (visibilityLayer.perCharacter || []).map((row) => ({
      characterId: row.characterId,
      characterName: row.characterName,
      blindSpot: row.blindSpots?.[0] || "盲点未明。",
      possibleExposure: `${row.characterName}的盲点可能被场所压力暴露。`,
    })),
    relationshipMutationIntents: Array.isArray(parsed.relationshipMutationIntents) ? parsed.relationshipMutationIntents : [],
    agentExchanges,
    presenceChanges,
    presentAtEndIds: privateSimulations.map((simulation) => simulation.characterId).filter((id) => !departedIds.has(id)),
    remainingCastAftermath,
    agentRelationshipShifts,
    evidenceCreated: Array.isArray(parsed.evidenceCreated) ? parsed.evidenceCreated : [],
    rumorCreated: Array.isArray(parsed.rumorCreated) ? parsed.rumorCreated : [],
    memoryDistortions: Array.isArray(parsed.memoryDistortions) ? parsed.memoryDistortions : [],
    irreversibleTraces: Array.isArray(parsed.irreversibleTraces) ? parsed.irreversibleTraces : [],
    subtextMatrix: Array.isArray(parsed.subtextMatrix) ? parsed.subtextMatrix : [],
    relationshipShift: [
      ...parsedRelationshipShifts,
      ...agentRelationshipShifts,
    ],
  };
}

export async function runSceneInteractionSimulator(compact, privateSimulations, visibilityLayer, { signal } = {}) {
  const startedAt = Date.now();
    const { parsed, meta } = await callOpenAIJson({
      system: systemPrompt(),
      user: buildSceneInteractionUserPrompt({ compact, privateSimulations, visibilityLayer }),
    schema: sceneInteractionSchema,
    schemaName: "character_town_scene_interaction",
    schemaHintMode: compact.pipelineMode === "fast" || compact.pipelineMode === "balanced" ? "compact" : "full",
    signal,
  });
  return {
    sceneInteraction: normalizeSceneInteraction(parsed, privateSimulations, visibilityLayer, compact),
    stage: {
      name: "SceneInteractionSimulator",
      provider: "openai",
      model: meta.model,
      elapsedMs: Date.now() - startedAt,
      responseId: meta.responseId,
    },
  };
}
