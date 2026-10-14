function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function speechKey(value = "") {
  return clean(value).replace(/[“”"「」『』，,。！？!?；;：:\s]/g, "");
}

function uniqueTurns(turns = []) {
  const seen = new Set();
  return (turns || []).filter((turn) => {
    const key = `${turn.speakerId || turn.speakerName}|${speechKey(turn.line || turn.text)}`;
    if (!speechKey(turn.line || turn.text) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function identityKey(id = "", name = "") {
  return clean(id || name);
}

export function assignDialogueSides(entries = []) {
  const pairs = new Map();
  return (entries || []).map((entry) => {
    if (entry?.type !== "dialogue") return { ...entry };
    const speaker = identityKey(entry.speakerId, entry.speakerName);
    const target = identityKey(entry.targetId, entry.targetName);
    if (!speaker) return { ...entry, side: "left" };
    if (!target || target === speaker) return { ...entry, side: "left" };
    const pairKey = [speaker, target].sort().join("::");
    if (!pairs.has(pairKey)) pairs.set(pairKey, { left: speaker, right: target });
    const pair = pairs.get(pairKey);
    return { ...entry, side: pair.right === speaker ? "right" : "left" };
  });
}

export function buildSpeakerThoughtMap(reactions = [], privateSimulations = []) {
  const thoughts = new Map();
  for (const simulation of privateSimulations || []) {
    const characterId = identityKey(simulation.characterId, simulation.characterName);
    if (!characterId) continue;
    const thought = clean(
      simulation.privateThought
      || simulation.whatTheyRefuseToAdmit
      || simulation.privateDesire
      || simulation.shadowImpulse,
    );
    if (!thought) continue;
    thoughts.set(characterId, {
      characterId,
      thought,
      feeling: clean(simulation.feeling),
      heardLine: clean(simulation.heardLine),
      moments: [],
    });
  }
  const reactionMoments = (reactions || []).flatMap((item) => {
    if (Array.isArray(item)) return item;
    if (Array.isArray(item?.moments)) return item.moments;
    return [item];
  });
  for (const reaction of reactionMoments) {
    const characterId = identityKey(reaction.characterId, reaction.characterName);
    const thought = clean(reaction.privateThought || reaction.thought);
    if (!characterId || !thought) continue;
    const previous = thoughts.get(characterId) || { characterId, moments: [] };
    const moment = {
      characterId,
      thought,
      feeling: clean(reaction.feeling),
      heardLine: clean(reaction.heardLine),
      spokenLine: clean(reaction.spokenLine),
    };
    thoughts.set(characterId, {
      ...previous,
      ...moment,
      moments: [...(previous.moments || []), moment],
    });
  }
  return thoughts;
}

export function buildObserverPsychologyMap(draft = {}) {
  const entries = [
    ...(draft.observerPsychology || []),
    ...(draft.periodSimulation?.ticks || []).flatMap((tick) => tick.observerPsychology || []),
  ];
  return new Map(entries.filter((entry) => entry?.actionId).map((entry) => [entry.actionId, entry]));
}

export function speakerThoughtForEntry(thoughts = new Map(), entry = {}) {
  const identity = identityKey(entry.speakerId, entry.speakerName);
  const state = thoughts.get(identity) || null;
  if (!state) return null;
  const spokenKey = speechKey(entry.text || entry.line);
  const exact = (state.moments || []).find((moment) => moment.spokenLine && speechKey(moment.spokenLine) === spokenKey);
  return exact || state;
}

export function collectDraftDialogueTurns(draft = {}) {
  const observerByAction = buildObserverPsychologyMap(draft);
  const scenes = [
    draft.sceneInteraction,
    ...(draft.periodSimulation?.ticks || []).map((tick) => tick.sceneInteraction),
  ].filter(Boolean);
  return uniqueTurns(scenes.flatMap((scene) => (scene.agentExchanges || [])
    .flatMap((exchange) => (exchange.dialogueTurns || []).map((turn) => ({
      ...turn,
      line: clean(turn.line || turn.text),
      sharedObject: exchange.sharedObject || "",
      observerPsychology: observerByAction.get(turn.actionId || turn.turnId) || null,
    })))));
}

function matchTurn(quote, turns, used) {
  const key = speechKey(quote);
  const index = turns.findIndex((turn, turnIndex) => {
    if (used.has(turnIndex)) return false;
    const turnKey = speechKey(turn.line || turn.text);
    return turnKey === key || (Math.min(turnKey.length, key.length) >= 6 && (turnKey.includes(key) || key.includes(turnKey)));
  });
  if (index < 0) return null;
  used.add(index);
  return turns[index];
}

function trimSpeechCue(value = "") {
  return clean(value)
    .replace(/(?:压低声音|低声|轻声|冷冷地|忽然)?(?:说|问|答道|回答|喊道|开口)[：:]?\s*$/u, "")
    .replace(/[：:，,]\s*$/u, "")
    .trim();
}

function pushNarration(entries, text, metadata = {}) {
  const value = trimSpeechCue(text);
  if (!value) return;
  const previous = entries.at(-1);
  const actionId = clean(metadata.actionId);
  const previousActionId = clean(previous?.actionId);
  if (previous?.type === "narration"
    && previous.slotLabel === metadata.slotLabel
    && previousActionId === actionId) {
    previous.text = clean(`${previous.text} ${value}`);
    return;
  }
  entries.push({ type: "narration", text: value, ...metadata });
}

function matchVisibleAction(paragraph = "", actions = [], used = new Set()) {
  const paragraphText = clean(paragraph);
  return (actions || []).find((action, index) => {
    if (used.has(index)) return false;
    const actionText = clean(action.text || action.visibleAction);
    if (!actionText || !paragraphText.includes(actionText)) return false;
    used.add(index);
    return true;
  }) || null;
}

function actionMetadata(action = null, metadata = {}) {
  if (!action) return metadata;
  return {
    ...metadata,
    actionId: action.id || action.actionId || "",
    actorId: action.actorId || action.characterId || "",
    actorName: action.actorName || action.characterName || "",
    targetId: action.targetId || action.targetCharacterId || "",
    targetName: action.targetName || action.targetCharacterName || "",
    observerPsychology: action.observerPsychology || null,
  };
}

export function buildManuscriptTimelineEntries(text = "", turns = [], metadata = {}, actions = []) {
  const entries = [];
  const normalizedTurns = uniqueTurns(turns);
  const used = new Set();
  const usedActions = new Set();
  const paragraphs = String(text || "").split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const quotePattern = /[“「『"]([^”」』"]+)[”」』"]/g;

  for (const paragraph of paragraphs) {
    const matchedAction = matchVisibleAction(paragraph, actions, usedActions);
    const paragraphMetadata = actionMetadata(matchedAction, metadata);
    let cursor = 0;
    let match;
    let foundQuote = false;
    while ((match = quotePattern.exec(paragraph))) {
      foundQuote = true;
      const turn = matchTurn(match[1], normalizedTurns, used);
      pushNarration(entries, paragraph.slice(cursor, match.index), paragraphMetadata);
      if (turn?.speakerId || turn?.speakerName) {
        entries.push({
          type: "dialogue",
          turnId: turn.turnId || turn.actionId || "",
          actionId: turn.actionId || turn.turnId || "",
          text: clean(match[1]),
          speakerId: turn.speakerId || "",
          speakerName: turn.speakerName || "",
          targetId: turn.targetId || "",
          targetName: turn.targetName || "",
          turnRole: turn.turnRole || "turn",
          respondsTo: turn.respondsTo || "",
          responseSourceLine: clean(turn.responseSourceLine),
          responseSourceSpeakerId: turn.responseSourceSpeakerId || "",
          responseSourceSlotId: turn.responseSourceSlotId || "",
          responseSourceSlotLabel: clean(turn.responseSourceSlotLabel),
          responseThreadId: turn.responseThreadId || "",
          responseTopic: clean(turn.responseTopic),
          interactionKind: turn.interactionKind || "",
          sourceImpactId: turn.sourceImpactId || "",
          observerPsychology: turn.observerPsychology || null,
          ...paragraphMetadata,
        });
      } else {
        pushNarration(entries, `“${clean(match[1])}”`, paragraphMetadata);
      }
      cursor = match.index + match[0].length;
    }
    if (foundQuote) pushNarration(entries, paragraph.slice(cursor), paragraphMetadata);
    else pushNarration(entries, paragraph, paragraphMetadata);
    quotePattern.lastIndex = 0;
  }
  return entries;
}

function terminalSpeech(line = "", usedSpeech = new Set()) {
  const parts = String(line || "")
    .match(/[^。！？!?]+[。！？!?]?/g)
    ?.map((part) => clean(part))
    .filter(Boolean) || [];
  const ranked = parts
    .filter((part) => !/第?\d+轮|上一轮|把话推回去|重新说|上次那句话|上次你没有回答|上次我们就是在这里谈崩/.test(part))
    .map((part, index) => {
      const key = speechKey(part);
      const generic = /^(这对大家都好|我只是照规矩办|现在不是说这个的时候|请立即说明|慢一点|退回去)[。！？!?]?$/.test(part);
      const score = (/[？?]$/.test(part) ? 8 : 0)
        + (part.length >= 8 && part.length <= 34 ? 4 : 0)
        + (/不能|没有|留下|带走|名字|原因|损失|退路|办法|规矩/.test(part) ? 3 : 0)
        - (generic ? 9 : 0)
        - (usedSpeech.has(key) ? 100 : 0)
        + index * 0.1;
      return { part, key, score, index };
    })
    .filter((item) => item.key && !usedSpeech.has(item.key))
    .sort((a, b) => b.score - a.score || b.part.length - a.part.length);
  const selected = ranked[0] || null;
  let chosen = selected?.part || "";
  if (selected && /[？?]$/.test(chosen) && chosen.length <= 8) {
    const follow = parts.slice(selected.index + 1)
      .find((part) => !/第?\d+轮|上一轮|上次那句话|重新说/.test(part));
    if (follow) chosen = clean(`${chosen}${follow}`);
  }
  if (chosen.length <= 34) return chosen;
  return `${chosen.slice(0, 33).replace(/[，,；;：:]?$/g, "")}…`;
}

function actionFromTick(tick = {}, namesById = new Map(), preferredIds = new Set()) {
  const candidates = (tick.agentOutputs || []).flatMap((output) => {
    const actorName = namesById.get(output.characterId) || "";
    return String(output.visibleAction || "")
      .split(/[。！？]/)
      .map(clean)
      .filter(Boolean)
      .map((text) => ({ text, actorName, preferred: preferredIds.has(output.characterId) }));
  });
  const ranked = candidates.slice().sort((a, b) => Number(b.preferred) - Number(a.preferred));
  const physical = ranked.find((candidate) => (
    candidate.actorName
    && candidate.text.includes(candidate.actorName)
    && /把|按|扣|推|拦|挡|递|放|退|走|收|藏|贴|挪|压|伸手|转身/.test(candidate.text)
    && !/说[：:]?|到一半|围着\S+停住/.test(candidate.text)
  ));
  const picked = physical || ranked.find((candidate) => candidate.actorName && candidate.text.includes(candidate.actorName) && !/说[：:]?|到一半/.test(candidate.text));
  return clean(picked?.text || "").replace(/[“”"「」『』]/g, "").slice(0, 72);
}

function consequenceFromTick(tick = {}, selectedExchange = null) {
  const exchange = selectedExchange || (tick.sceneInteraction?.agentExchanges || []).find((item) => clean(item.eventOutcome));
  const clauses = String(exchange?.eventOutcome || "")
    .split(/[；;]/)
    .map(clean)
    .filter(Boolean)
    .filter((clause) => !/场面临时控制|旁观者|若要审讯/.test(clause));
  const material = clauses.find((clause) => /没有|仍|留|扣|收回|停在|换到|不能/.test(clause)) || clauses[0];
  const change = [...clauses].reverse().find((clause) => clause !== material && /没有|仍|留|扣|收回|停在|换到|不能|欠下/.test(clause));
  return clean([material, change].filter(Boolean).join("；")).slice(0, 88)
    || clean(tick.synthesized?.irreversibleTraces?.[0] || tick.surfaceEvent).slice(0, 88);
}

function occurrenceFromTick(tick = {}, location = {}, usedOccurrences = new Set()) {
  const candidates = [
    tick.slotFocus,
    ...(location.likelyEvents || []),
    ...(tick.backgroundEvents || []),
    tick.surfaceEvent,
  ].map((item) => clean(item).replace(/[。！？]+$/g, "")).filter(Boolean);
  const event = candidates.find((candidate) => !usedOccurrences.has(candidate)) || candidates[0] || "现场出现变化";
  usedOccurrences.add(event);
  return event.replace(/[。！？]+$/g, "").slice(0, 56);
}

export function buildLocalNewsBriefs(draft = {}, state = {}, visibleCount = Infinity) {
  const namesById = new Map((state.characters || []).map((character) => [character.id, character.name]));
  const locationsById = new Map((state.locations || []).map((location) => [location.id, location]));
  const usedSpeech = new Set();
  const usedOccurrences = new Set();
  const speakerUsage = new Map();
  return (draft.periodSimulation?.ticks || []).slice(0, visibleCount).map((tick) => {
    let selected = { dialogue: [], exchange: null, score: -Infinity };
    for (const exchange of tick.sceneInteraction?.agentExchanges || []) {
      const temporaryUsed = new Set(usedSpeech);
      const candidate = uniqueTurns((exchange?.dialogueTurns || []).slice(0, 2)).map((turn) => {
        const speakerName = turn.speakerName || namesById.get(turn.speakerId) || "";
        if ((!turn.speakerId && !speakerName) || /^(人物|不明人物|未知人物|有人)$/.test(speakerName)) return null;
        const line = terminalSpeech(turn.line || turn.text, temporaryUsed);
        if (line) temporaryUsed.add(speechKey(line));
        return {
          speakerId: turn.speakerId || "",
          speakerName,
          targetId: turn.targetId || "",
          targetName: turn.targetName || namesById.get(turn.targetId) || "",
          line,
        };
      }).filter((turn) => turn?.line);
      const usagePenalty = candidate.reduce((total, turn) => total + Number(speakerUsage.get(turn.speakerId) || 0), 0);
      const freshSpeakers = new Set(candidate.filter((turn) => !speakerUsage.has(turn.speakerId)).map((turn) => turn.speakerId)).size;
      const score = candidate.length * 100 + freshSpeakers * 18 - usagePenalty * 32;
      if (score > selected.score) selected = { dialogue: candidate, exchange, score };
    }
    const availableDialogue = selected.dialogue;
    const dialogue = (state.characters || []).length >= 4
      ? availableDialogue.filter((turn) => Number(speakerUsage.get(turn.speakerId) || 0) < 3)
      : availableDialogue;
    if (!dialogue.length && availableDialogue.length) {
      dialogue.push(availableDialogue.slice().sort((a, b) => Number(speakerUsage.get(a.speakerId) || 0) - Number(speakerUsage.get(b.speakerId) || 0))[0]);
    }
    for (const turn of dialogue) usedSpeech.add(speechKey(turn.line));
    for (const turn of dialogue) speakerUsage.set(turn.speakerId, Number(speakerUsage.get(turn.speakerId) || 0) + 1);
    const preferredIds = new Set(dialogue.flatMap((turn) => [turn.speakerId, turn.targetId]).filter(Boolean));
    return {
      type: "news",
      id: tick.id || `${draft.id}_${tick.order}`,
      slotLabel: tick.label || "",
      locationId: tick.locationId || "",
      locationName: tick.locationName || locationsById.get(tick.locationId)?.name || "",
      occurrence: occurrenceFromTick(tick, locationsById.get(tick.locationId) || {}, usedOccurrences),
      action: actionFromTick(tick, namesById, preferredIds),
      dialogue,
      consequence: consequenceFromTick(tick, selected.exchange),
    };
  });
}

export function buildLiveEventTimelineEntries(events = []) {
  return (events || []).filter((event) => ["action", "dialogue", "exchange_outcome"].includes(event.type)).map((event) => {
    if (event.type === "dialogue") return {
      type: "dialogue",
      text: clean(event.line),
      speakerId: event.speakerId || "",
      speakerName: event.speakerName || "",
      targetId: event.targetId || "",
      targetName: event.targetName || "",
      turnRole: event.turnRole || "turn",
      respondsTo: event.respondsTo || "",
      responseSourceLine: clean(event.responseSourceLine),
      responseSourceSpeakerId: event.responseSourceSpeakerId || "",
      responseSourceSlotId: event.responseSourceSlotId || "",
      responseSourceSlotLabel: clean(event.responseSourceSlotLabel),
      responseThreadId: event.responseThreadId || "",
      responseTopic: clean(event.responseTopic),
      actionId: event.id || event.actionId || "",
      observerPsychology: event.observerPsychology || null,
    };
    return {
      type: "narration",
      text: clean(event.text),
      actorId: event.actorId || event.sourceCharacterId || "",
      actorName: event.actorName || event.sourceCharacterName || "",
      targetName: event.targetName || event.responseCharacterName || "",
      kind: event.type,
      actionId: event.id || event.actionId || "",
      observerPsychology: event.observerPsychology || null,
    };
  }).filter((entry) => entry.text);
}
