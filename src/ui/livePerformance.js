const PUBLIC_EVENT_TYPES = new Set(["action", "dialogue", "exchange_outcome"]);

function nextAgent(agents = [], identity = {}, status = "present") {
  const characterId = identity.characterId || identity.actorId || identity.speakerId || "";
  const characterName = identity.characterName || identity.actorName || identity.speakerName || characterId;
  if (!characterId && !characterName) return agents;
  const key = characterId || characterName;
  const existingIndex = agents.findIndex((agent) => (agent.characterId || agent.characterName) === key);
  const value = {
    characterId,
    characterName,
    status,
  };
  if (existingIndex < 0) return [...agents, value];
  return agents.map((agent, index) => index === existingIndex ? { ...agent, ...value } : agent);
}

function setAgentStatus(agents, identity, status) {
  return nextAgent(agents, identity, status);
}

function observerPsychology(event = {}) {
  const entry = event.observerPsychology;
  const hasExplanation = Boolean(entry?.privateReason || entry?.formulaReason || entry?.selectedIntent);
  if (!entry || entry.visibility !== "observer-only" || !entry.actionId || !hasExplanation) return null;
  return {
    ...entry,
    schemaVersion: 1,
    visibility: "observer-only",
    source: "causal-character-agent-decision",
    actionId: String(entry.actionId || "").trim(),
    characterId: String(entry.characterId || "").trim(),
    characterName: String(entry.characterName || "").trim(),
    desire: String(entry.desire || "").trim(),
    currentIntention: String(entry.currentIntention || "").trim(),
    privateReason: String(entry.privateReason || "").trim(),
    formulaReason: String(entry.formulaReason || "").trim(),
    trigger: entry.trigger ? {
      ...entry.trigger,
      impactId: String(entry.trigger.impactId || "").trim(),
      sourceCharacterId: String(entry.trigger.sourceCharacterId || "").trim(),
      type: String(entry.trigger.type || "").trim(),
      modality: String(entry.trigger.modality || "").trim(),
      content: String(entry.trigger.content || "").trim(),
      topic: String(entry.trigger.topic || "").trim(),
      directed: Boolean(entry.trigger.directed),
    } : null,
    slotId: String(entry.slotId || "").trim(),
    slotLabel: String(entry.slotLabel || "").trim(),
    decidedAtSeconds: Math.max(0, Number(entry.decidedAtSeconds || 0)),
  };
}

function publicEvent(event, index) {
  const base = {
    id: event.id || `live_${event.type}_${index}`,
    type: event.type,
    slotLabel: event.slotLabel || "",
    locationName: event.locationName || "",
  };
  if (event.type === "action") {
    return {
      ...base,
      actorId: event.actorId || "",
      actorName: event.actorName || "",
      targetId: event.targetId || "",
      targetName: event.targetName || "",
      text: String(event.text || "").trim(),
      observerPsychology: observerPsychology(event),
    };
  }
  if (event.type === "dialogue") {
    return {
      ...base,
      speakerId: event.speakerId || "",
      speakerName: event.speakerName || "",
      targetId: event.targetId || "",
      targetName: event.targetName || "",
      line: String(event.line || "").trim(),
      turnRole: event.turnRole || "turn",
      respondsTo: String(event.respondsTo || "").trim(),
      responseSourceLine: String(event.responseSourceLine || "").trim(),
      responseSourceSpeakerId: String(event.responseSourceSpeakerId || "").trim(),
      responseSourceSlotId: String(event.responseSourceSlotId || "").trim(),
      responseSourceSlotLabel: String(event.responseSourceSlotLabel || "").trim(),
      responseThreadId: String(event.responseThreadId || "").trim(),
      responseTopic: String(event.responseTopic || "").trim(),
      sharedObject: String(event.sharedObject || "").trim(),
      observerPsychology: observerPsychology(event),
    };
  }
  return {
    ...base,
    sourceCharacterId: event.sourceCharacterId || "",
    sourceCharacterName: event.sourceCharacterName || "",
    responseCharacterId: event.responseCharacterId || "",
    responseCharacterName: event.responseCharacterName || "",
    sharedObject: String(event.sharedObject || "").trim(),
    text: String(event.text || "").trim(),
  };
}

function appendPublicEvent(events, event) {
  if (!PUBLIC_EVENT_TYPES.has(event.type)) return events;
  const sanitized = publicEvent(event, events.length);
  const visibleText = sanitized.text || sanitized.line;
  if (!visibleText) return events;
  return [...events, sanitized].slice(-160);
}

function sceneAgents(event) {
  return (event.characterIds || []).map((characterId, index) => ({
    characterId,
    characterName: event.characterNames?.[index] || characterId,
    status: "waiting",
  }));
}

export function createLivePerformance({ locationName = "", grain = "scene" } = {}) {
  return {
    runId: "pending",
    draftId: null,
    status: "running",
    phase: "starting",
    grain,
    locationName,
    slotLabel: "",
    label: locationName ? `${locationName} · 即将开始` : "即将开始",
    agents: [],
    events: [],
    novelText: "",
    psychologyByCharacter: {},
  };
}

function privateReaction(event = {}) {
  return {
    characterId: event.characterId || "",
    characterName: event.characterName || "",
    spokenLine: String(event.spokenLine || "").trim(),
    heardLine: String(event.heardLine || "").trim(),
    speakerName: String(event.speakerName || "").trim(),
    interpretation: String(event.interpretation || "").trim(),
    feeling: String(event.feeling || "").trim(),
    bodyResponse: String(event.bodyResponse || "").trim(),
    privateThought: String(event.privateThought || "").trim(),
    selfLie: String(event.selfLie || "").trim(),
    nextImpulse: String(event.nextImpulse || "").trim(),
  };
}

export function reduceLivePerformanceEvent(current, event = {}) {
  const live = current || createLivePerformance();
  let agents = live.agents || [];
  let label = live.label;
  let phase = live.phase;
  let status = live.status;
  let novelText = live.novelText || "";
  let psychologyByCharacter = live.psychologyByCharacter || {};
  const locationName = event.locationName || live.locationName || "";
  const slotLabel = event.slotLabel || live.slotLabel || "";

  if (event.type === "run_started") {
    phase = "starting";
    label = locationName ? `${locationName} · 正在召集人物` : "正在召集人物";
  } else if (event.type === "period_started") {
    phase = "period";
    label = `${event.grain === "week" ? "一周" : "一天"}开始运转`;
  } else if (event.type === "connection_retrying") {
    phase = "reconnecting";
    label = `连接波动 · 正在续接${event.attempt ? ` ${event.attempt}/2` : ""}`;
  } else if (event.type === "scene_started") {
    phase = "preparing";
    agents = sceneAgents(event);
    label = [slotLabel, locationName, "人物准备中"].filter(Boolean).join(" · ");
  } else if (event.type === "agent_thinking") {
    phase = "preparing";
    agents = setAgentStatus(agents, event, "preparing");
    label = `${event.characterName || "人物"}正在准备`;
  } else if (event.type === "agent_ready") {
    agents = setAgentStatus(agents, event, "ready");
    label = `${event.characterName || "人物"}已经就位`;
  } else if (event.type === "agent_failed") {
    agents = setAgentStatus(agents, event, "failed");
  } else if (event.type === "shared_space") {
    phase = "interaction";
    agents = (event.characterIds || []).reduce((next, characterId, index) => setAgentStatus(next, {
      characterId,
      characterName: event.characterNames?.[index] || characterId,
    }, "present"), agents);
    label = [slotLabel, locationName, "人物已经同场"].filter(Boolean).join(" · ");
  } else if (event.type === "novel_started") {
    phase = "writing";
    label = [slotLabel, locationName, "正文正在写入"].filter(Boolean).join(" · ");
  } else if (event.type === "novel_delta") {
    phase = "writing";
    novelText += String(event.text || event.delta || "");
    label = [slotLabel, locationName, "正文正在写入"].filter(Boolean).join(" · ");
  } else if (event.type === "novel_complete") {
    phase = "interaction";
    label = [slotLabel, locationName, "这一页已经写成"].filter(Boolean).join(" · ");
  } else if (event.type === "psychology_update") {
    const reaction = privateReaction(event);
    const existingReaction = psychologyByCharacter[reaction.characterId] || null;
    const existingMoments = Array.isArray(existingReaction)
      ? existingReaction
      : Array.isArray(existingReaction?.moments)
        ? existingReaction.moments
        : existingReaction ? [existingReaction] : [];
    if (reaction.characterId) psychologyByCharacter = {
      ...psychologyByCharacter,
      [reaction.characterId]: {
        ...reaction,
        moments: [...existingMoments, reaction].slice(-8),
      },
    };
  } else if (event.type === "action") {
    phase = "interaction";
    agents = setAgentStatus(agents, { characterId: event.actorId, characterName: event.actorName }, "acting");
    agents = setAgentStatus(agents, { characterId: event.targetId, characterName: event.targetName }, "observing");
    label = `${event.actorName || "人物"}采取行动`;
  } else if (event.type === "exchange_started") {
    phase = "interaction";
    agents = setAgentStatus(agents, { characterId: event.sourceCharacterId, characterName: event.sourceCharacterName }, "acting");
    agents = setAgentStatus(agents, { characterId: event.responseCharacterId, characterName: event.responseCharacterName }, "responding");
    label = `${event.sourceCharacterName || "人物"}与${event.responseCharacterName || "对方"}发生交锋`;
  } else if (event.type === "dialogue") {
    phase = "interaction";
    agents = setAgentStatus(agents, { characterId: event.speakerId, characterName: event.speakerName }, "speaking");
    agents = setAgentStatus(agents, { characterId: event.targetId, characterName: event.targetName }, "observing");
    label = `${event.speakerName || "人物"}回应${event.targetName || "对方"}`;
  } else if (event.type === "exchange_outcome") {
    agents = setAgentStatus(agents, { characterId: event.sourceCharacterId, characterName: event.sourceCharacterName }, "present");
    agents = setAgentStatus(agents, { characterId: event.responseCharacterId, characterName: event.responseCharacterName }, "present");
    label = event.sharedObject ? `${event.sharedObject}留下了后果` : "后果已经落下";
  } else if (event.type === "scene_complete") {
    phase = "scene_complete";
    if (String(event.sceneText || "").trim()) novelText = String(event.sceneText);
    agents = agents.map((agent) => ({ ...agent, status: "present" }));
    label = [slotLabel, locationName, "这一场已经发生"].filter(Boolean).join(" · ");
  } else if (event.type === "period_complete") {
    phase = "period_complete";
    label = `${event.grain === "week" ? "一周" : "一天"}已经运转完毕`;
  } else if (event.type === "complete") {
    phase = "complete";
    status = "complete";
    label = "演出完成";
  } else if (event.type === "error") {
    phase = "error";
    status = "error";
    label = event.kind === "model_stage" ? "模型阶段失败" : "演出中断";
  }

  return {
    ...live,
    runId: event.runId || live.runId,
    draftId: event.type === "complete" ? event.draft?.id || live.draftId : live.draftId,
    status,
    phase,
    locationName,
    slotLabel,
    label,
    agents,
    novelText,
    psychologyByCharacter,
    errorKind: event.type === "error" ? event.kind || "run_error" : live.errorKind || "",
    errorStage: event.type === "error" ? event.stage || "" : live.errorStage || "",
    events: appendPublicEvent(live.events || [], event),
  };
}

export function liveEventDelay(event = {}) {
  if (event.type === "dialogue") return 260;
  if (event.type === "action" || event.type === "exchange_outcome") return 180;
  return 0;
}
