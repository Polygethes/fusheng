import { createId } from "../data/seed.js";
import { interventionReasonNotes } from "../state/interventions.js";
import { advancePlansFromDraft, auditIntentPlans } from "../state/intentPlanner.js";
import { ensureCharacterPlans, advancePlanFromOutput } from "../state/intentPlanner.js";

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function names(state, ids) {
  return ids.map((id) => state.characters.find((character) => character.id === id)?.name || id);
}

function characterStateDelta(output) {
  const byTone = {
    惩罚: { rage: 5, shame: 4, revengeImpulse: 6, selfDeception: 2, desire: 2 },
    接近: { desire: 6, shame: 3, love: 3, selfDeception: 2, protectionImpulse: 1 },
    伪装: { selfDeception: 6, shame: 3, disgust: 2, desire: 1 },
    保护: { protectionImpulse: 6, love: 3, shame: 2, wantsToPossess: 0 },
    陷害: { revengeImpulse: 7, shame: 4, rage: 4, selfDeception: 3 },
    求证: { desire: 4, shame: 5, wantsToBeSeen: 0, selfDeception: 2 },
    自毁: { selfDestruction: 7, shame: 4, disgust: 3 },
    共谋: { desire: 4, love: 2, selfDeception: 4, shame: 3 },
    试探: { desire: 3, shame: 2, selfDeception: 3, revengeImpulse: 1 },
  };
  return byTone[output.tone] || byTone.试探;
}

function addDelta(target = {}, key = "", value = 0) {
  if (!key || !value) return target;
  target[key] = (target[key] || 0) + value;
  return target;
}

function exchangeStateDeltaForShift(shift = {}, side = "source") {
  const deltas = shift.deltas || {};
  const actKind = shift.relationshipDialogueAct?.kind || "";
  const text = [
    shift.eventOutcome,
    shift.finalTurn,
    shift.followupTurn,
    shift.unspoken,
    shift.misreading,
    shift.relationshipDialogueAct?.reason,
  ].filter(Boolean).join(" ");
  const next = {};

  if (actKind === "protect" || Number(deltas.protection || 0) > 0 || /庇护|护住|救命|药炉|医坊|伤者/.test(text)) {
    addDelta(next, side === "source" ? "protectionImpulse" : "shame", 6 + Math.min(4, Number(deltas.protection || 0)));
  }
  if (actKind === "control" || Number(deltas.power || 0) > 0 || /临时控制|解释权|界石|铜盘|必须先把理由/.test(text)) {
    addDelta(next, side === "source" ? "selfDeception" : "rage", 2 + Math.min(3, Number(deltas.power || 0)));
    addDelta(next, "desire", side === "source" ? 2 : 1);
  }
  if (actKind === "withdraw" || Number(deltas.wantsToEscape || 0) > 0 || Number(deltas.fear || 0) > 0 || /没能|不能|退路|拒交|被挡/.test(text)) {
    addDelta(next, side === "source" ? "shame" : "selfDeception", 1 + Math.min(4, Number(deltas.wantsToEscape || 0) + Number(deltas.fear || 0)));
  }
  if (actKind === "accuse" || Number(deltas.resentment || 0) > 0 || /指认|追责|审讯|证据/.test(text)) {
    addDelta(next, "rage", 1 + Math.min(4, Number(deltas.resentment || 0)));
  }
  if (Number(deltas.revenge || 0) > 0) {
    addDelta(next, "revengeImpulse", Math.min(5, Number(deltas.revenge || 0)));
  }
  if (Number(deltas.deception || 0) > 0 || actKind === "bargain") {
    addDelta(next, "selfDeception", 1 + Math.min(3, Number(deltas.deception || 0)));
  }

  return next;
}

function buildExchangeStateDeltaMap(relationshipShift = []) {
  const byCharacterId = new Map();
  const merge = (characterId, delta, shift) => {
    if (!characterId || !Object.keys(delta || {}).length) return;
    const current = byCharacterId.get(characterId) || { delta: {}, shifts: [] };
    for (const [key, value] of Object.entries(delta)) {
      current.delta[key] = (current.delta[key] || 0) + Number(value || 0);
    }
    current.shifts.push(shift);
    byCharacterId.set(characterId, current);
  };
  for (const shift of relationshipShift || []) {
    if (!shift || shift.generatedFrom !== "agent-dialogue-relationship") continue;
    merge(shift.fromCharacterId, exchangeStateDeltaForShift(shift, "source"), shift);
    merge(shift.toCharacterId, exchangeStateDeltaForShift(shift, "target"), shift);
  }
  return byCharacterId;
}

function mergeStateDeltas(...deltas) {
  const merged = {};
  for (const delta of deltas) {
    for (const [key, value] of Object.entries(delta || {})) {
      merged[key] = (merged[key] || 0) + Number(value || 0);
    }
  }
  return merged;
}

export function buildUpdateBundle(draft, state) {
  const characterPatchMap = new Map();
  const exchangeStateDeltas = buildExchangeStateDeltaMap(draft.relationshipShift || []);
  for (const output of draft.agentOutputs || []) {
    const character = state.characters.find((item) => item.id === output.characterId);
    if (!character) continue;
    const exchangeState = exchangeStateDeltas.get(character.id) || null;
    const delta = mergeStateDeltas(characterStateDelta(output), exchangeState?.delta || {});
    const previousPatch = characterPatchMap.get(character.id);
    const nextState = { ...(previousPatch?.currentState || character.currentState) };
    for (const [key, value] of Object.entries(delta)) {
      if (typeof nextState[key] === "number") nextState[key] = clamp(nextState[key] + value);
    }
    nextState.currentSelfLie = output.selfDeceptionSentence || nextState.currentSelfLie;
    characterPatchMap.set(character.id, {
      id: character.id,
      currentState: nextState,
      ...(output.currentActivity ? { currentActivity: output.currentActivity } : {}),
      exchangeStateSources: exchangeState?.shifts?.map((shift) => ({
        sourceOutputId: shift.sourceOutputId || "",
        responseOutputId: shift.responseOutputId || "",
        eventOutcome: shift.eventOutcome || "",
        sharedObject: shift.sharedObject || "",
        actKind: shift.relationshipDialogueAct?.kind || "",
      })) || [],
    });
  }
  const presenceChanges = Array.isArray(draft.presenceChanges)
    ? draft.presenceChanges
    : (draft.sceneInteraction?.presenceChanges || []);
  for (const change of presenceChanges) {
    const character = state.characters.find((item) => item.id === change.characterId);
    if (!character || change.decision === "stay") continue;
    const previousPatch = characterPatchMap.get(character.id) || {};
    const originId = draft.locationId || character.currentLocationId || "";
    const didLeave = change.decision === "leave" && change.destinationId;
    characterPatchMap.set(character.id, {
      ...previousPatch,
      id: character.id,
      currentState: previousPatch.currentState || { ...(character.currentState || {}) },
      previousLocationId: didLeave ? originId : character.previousLocationId || "",
      currentLocationId: didLeave ? change.destinationId : character.currentLocationId || originId,
      inTransit: false,
      lastPresenceDecision: change.decision,
      lastMovementReason: change.trigger || change.reason || "",
      lastPresenceDraftId: draft.id,
    });
  }
  const characterPatches = [...characterPatchMap.values()];

  const participantNames = names(state, draft.participantIds || []);
  const location = state.locations.find((item) => item.id === draft.locationId);
  const evidence = (draft.irreversibleTraces || []).map((trace) => ({
    id: createId("ev"),
    projectId: state.project.id,
    createdAt: new Date().toISOString(),
    type: inferEvidenceType(trace),
    content: trace,
    locationId: draft.locationId,
    ownerCharacterId: draft.participantIds?.[0],
    canBeMisreadAs: "关系异常、特殊对待、权力打压或保护。",
    sourceDraftId: draft.id,
  }));

  const rumors = [];
  if (location && participantNames.length > 1) {
    rumors.push({
      id: createId("rumor"),
      projectId: state.project.id,
      createdAt: new Date().toISOString(),
      content: `${participantNames.join("和")}在${location.name}的互动被人描述成“不像普通关系”。`,
      sourceLocationId: draft.locationId,
      distortion: "把多重动机压缩成一种可传播模板。",
      spreadRisk: clamp(35 + (draft.audit?.safeClosureRisk || 0) / 3 + (draft.injectedEvent ? 18 : 0) + (draft.interventionsApplied?.length ? 12 : 0) + Number(draft.eventImpact || 0) / 8),
      sourceDraftId: draft.id,
    });
  }

  const irreversibleTraces = (draft.irreversibleTraces || []).map((trace) => ({
    id: createId("trace"),
    projectId: state.project.id,
    createdAt: new Date().toISOString(),
    content: trace,
    sourceDraftId: draft.id,
    participantIds: draft.participantIds || [],
  }));

  const characterMemories = [
    ...buildCharacterMemories(draft, state),
    ...buildRelationshipDialogueMemories(draft, state),
  ];
  const characterPlans = buildCharacterPlanPatches(draft, state);
  const townStateLedger = buildTownStateLedger(draft, state);

  return {
    characters: characterPatches,
    relationships: draft.relationshipShift || [],
    rumors,
    evidence,
    characterMemories,
    characterPlans,
    townStateLedger,
    secrets: [],
    irreversibleTraces,
    stateChangeReasons: buildStateChangeReasons(draft, state, characterPatches, draft.relationshipShift || [], characterPlans, townStateLedger),
    consumedInterventionIds: (draft.interventionsApplied || []).filter((item) => (item.persistence || "next_play") === "next_play").map((item) => item.id),
  };
}



function buildCharacterPlanPatches(draft, state) {
  const plans = ensureCharacterPlans(state);
  const fromOutputs = (draft.agentOutputs || []).map((output) => {
    const plan = findPlanForAgentOutput(plans, output);
    return advancePlanFromOutput(plan, { ...output, sourceDraftId: draft.id }, state);
  }).filter(Boolean);
  return mergePlanPatches(fromOutputs, buildRelationshipPlanPatches(draft, state, plans));
}

function mergePlanPatches(...groups) {
  const byId = new Map();
  for (const patch of groups.flat()) {
    if (!patch?.id) continue;
    byId.set(patch.id, { ...(byId.get(patch.id) || {}), ...patch });
  }
  return [...byId.values()];
}

function findPlanForAgentOutput(plans = [], output = {}) {
  const characterPlans = plans.filter((item) => item.characterId === output.characterId);
  const referencedId = output.intentPlanId || output.planId;
  return characterPlans.find((item) => item.id === referencedId)
    || characterPlans.find((item) => output.targetCharacterId && item.targetCharacterId === output.targetCharacterId)
    || characterPlans[0]
    || null;
}

function buildRelationshipPlanPatches(draft, state, plans = ensureCharacterPlans(state)) {
  return (draft.relationshipShift || [])
    .filter((shift) => shift?.relationshipMomentum || shift?.generatedFrom === "agent-dialogue-relationship" || shift?.generatedFrom === "model-agent-dialogue")
    .filter((shift) => shift.fromCharacterId && shift.toCharacterId)
    .map((shift) => {
      const plan = findPlanForRelationshipShift(plans, shift);
      const character = state.characters.find((item) => item.id === shift.fromCharacterId);
      const target = state.characters.find((item) => item.id === shift.toCharacterId);
      if (!plan || !character || !target) return null;
      const tactic = tacticFromRelationshipShift(shift);
      const pressureBoost = Math.min(18, 6 + Number(shift.relationshipMomentum?.historyCount || 0) * 3);
      const sharedObject = shift.sharedObject || "场中物件";
      const planLine = dramaticRelationshipPlanLine({ shift, character, target, tactic, sharedObject });
      const immediateObjective = tactic === "control"
        ? `借${sharedObject}和城规压住${target.name}的命名，让解释权继续留在自己手里。`
        : `${actionClauseForPlanTactic(tactic, target, sharedObject)}，并让${sharedObject}继续逼出回应。`;
      const next = {
        ...plan,
        targetCharacterId: shift.toCharacterId,
        mode: tactic,
        modeLabel: tacticLabelForPlan(tactic),
        currentTactic: tactic,
        nextActionBias: toneForPlanTactic(tactic),
        pressure: clamp(Number(plan.pressure || plan.heat || 50) + pressureBoost),
        heat: clamp(Number(plan.heat || plan.pressure || 50) + Math.ceil(pressureBoost / 2)),
        risk: clamp(Number(plan.risk || plan.heat || 40) + Math.ceil(pressureBoost / 2)),
        progress: clamp(Number(plan.progress || 0) + 8),
        updatedAt: new Date().toISOString(),
        lastAdvancedByDraftId: draft.id,
        lastPlanResult: "对方的回应改写了下一步计划",
        shortTerm: planLine,
        shortTermPlan: planLine,
        hiddenObjective: `${character.name}想让${target.name}为“${rememberedTurnForPlan(shift, sharedObject)}”给出新的回应。`,
        immediateObjective,
        plannedActionVerb: verbForPlanTactic(tactic),
        desiredMisreading: `${target.name}最好把这一步误读成${tactic === "protect" ? "保护" : tactic === "punish" ? "城规或标准" : "普通流程"}。`,
        shadowProfit: `${character.name}获得短暂收益：${target.name}必须回应${character.name}留下的东西。`,
        riskIfExposed: `一旦被看穿，${character.name}会失去解释权，${target.name}会得到反行动空间。`,
        planObstacle: `${target.name}也有自己的行动线，可能误读、反击、保护、陷害或拒绝。`,
        planLog: [
          { at: new Date().toISOString(), line: `下一步：${planLine}` },
          ...(plan.planLog || []).map(sanitizePlanLogEntry),
        ].slice(0, 12),
      };
      return next;
    })
    .filter(Boolean);
}

function sanitizePlanLogEntry(entry = {}) {
  if (typeof entry === "string") return sanitizePlanLine(entry);
  return { ...entry, line: sanitizePlanLine(entry.line || "") };
}

function dramaticRelationshipPlanLine({ shift, character, target, tactic, sharedObject }) {
  const objects = relationshipPlanObjects(shift, sharedObject);
  const objectPhrase = objects.join("、") || sharedObject;
  const surface = planSurfaceFromShift(shift);
  const remembered = rememberedTurnForPlan(shift, objectPhrase);
  const actionLine = tactic === "control"
    ? `${character.name}下一步要借${objectPhrase}从${target.name}手里夺回解释权`
    : `${character.name}下一步要把${objectPhrase}留在${surface}，${actionClauseForPlanTactic(tactic, target, objectPhrase)}`;
  const pressureLine = remembered
    ? `刚才那句“${remembered}”还压在${surface}`
    : `${objectPhrase}还压在${surface}`;
  return sanitizePlanLine(`${pressureLine}；${actionLine}。`);
}

function actionClauseForPlanTactic(tactic = "wait", target = {}, objectPhrase = "场中物件") {
  const targetName = target.name || "对方";
  return {
    approach: `靠近${targetName}`,
    withdraw: `从${targetName}面前撤退，并遮掩${objectPhrase}留下的痕迹`,
    protect: `保护${targetName}`,
    punish: `逼问${targetName}`,
    control: `从${targetName}手里夺回解释权`,
    hide_evidence: `藏住证据，不让${targetName}先拿到${objectPhrase}`,
    plant_evidence: `把证据推到${targetName}面前`,
    wait: `等${targetName}先动`,
  }[tactic] || `试探${targetName}`;
}

function relationshipPlanObjects(shift = {}, fallback = "场中物件") {
  const fromMomentum = Array.isArray(shift.relationshipMomentum?.objects) ? shift.relationshipMomentum.objects : [];
  const contestableObjects = [
    "灵契",
    "妖丹盒",
    "庇护牌",
    "照骨镜",
    "渡令",
    "魂灯",
    "停剑令",
    "铜铃",
    "剑匣",
    "药炉",
    "毒誓符",
    "账册",
    "封条",
  ];
  const haystack = [
    shift.sharedObject,
    shift.followupTurn,
    shift.finalTurn,
    shift.unspoken,
    shift.eventOutcome,
    shift.misreading,
    shift.relationshipMomentum?.latestTurn,
  ].filter(Boolean).join(" ");
  const extracted = contestableObjects.filter((item) => haystack.includes(item));
  return uniqueNonEmpty([shift.sharedObject, ...extracted, ...fromMomentum, fallback]).slice(0, 3);
}

function uniqueNonEmpty(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const value = String(item || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function rememberedTurnForPlan(shift = {}, fallback = "这件事") {
  const outcome = String(shift.eventOutcome || "");
  if (/暗账|没能.*收回|收回暗账|藏回/.test(outcome)) return trimPlanSentence(outcome);
  return trimPlanSentence(
    shift.relationshipMomentum?.latestTurn
      || shift.followupTurn
      || shift.finalTurn
      || shift.unspoken
      || shift.eventOutcome
      || fallback,
  );
}

function trimPlanSentence(text = "", maxLength = 36) {
  const normalized = String(text || "")
    .replace(/^关系变化来自未结清对话：?/, "")
    .replace(/^连续\d+\s*轮围绕/, "")
    .replace(/没结清.*$/, "")
    .replace(/[“”"]/g, "")
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

function planSurfaceFromShift(shift = {}) {
  const text = [
    shift.locationName,
    shift.locationId,
    shift.sharedObject,
    shift.eventOutcome,
    shift.followupTurn,
    shift.finalTurn,
    shift.unspoken,
  ].filter(Boolean).join(" ");
  if (/法契|契门|界石|铜盘|灵契/.test(text)) return "铜盘前";
  if (/无咎市|妖丹|摊|账册|案台/.test(text)) return "案台边";
  if (/照骨|镜|封条|剑匣/.test(text)) return "镜面下";
  if (/归墟|渡|水阵|水线|岸|石阶|渡令/.test(text)) return "水线前";
  if (/医坊|庇护|药炉/.test(text)) return "药炉旁";
  if (/茶楼|茶桌|停剑令/.test(text)) return "茶桌旁";
  return "明处";
}

function sanitizePlanLine(line = "") {
  return String(line || "")
    .replace(/关系回流：?/g, "下一步：")
    .replace(/关系变化来自未结清对话：?/g, "刚才那句话还压在场中：")
    .replace(/连续\d+\s*轮围绕([^，。]+)没结清，?关系变化(?:必须改写[^。]*|不再按单次互动计算)?。?/g, "$1还留在场中，谁也不能把它当成一次小冲突收走。")
    .replace(/未结清/g, "还没说完")
    .replace(/不再按单次互动计算/g, "不能被当成一次小冲突")
    .trim();
}

function findPlanForRelationshipShift(plans = [], shift = {}) {
  const characterPlans = plans.filter((item) => item.characterId === shift.fromCharacterId);
  return characterPlans.find((item) => item.targetCharacterId === shift.toCharacterId)
    || characterPlans[0]
    || null;
}

function tacticFromRelationshipShift(shift = {}) {
  const deltas = shift.deltas || {};
  const text = [
    shift.misreading,
    shift.unspoken,
    shift.eventOutcome,
    shift.finalTurn,
    shift.followupTurn,
    shift.sharedObject,
  ].filter(Boolean).join(" ");
  if (/暗账|没能.*收回|收回暗账|藏回/.test(text)) return "hide_evidence";
  if (Number(deltas.revenge || 0) > 0 || Number(deltas.resentment || 0) >= 4) return "punish";
  if (Number(deltas.protection || 0) > 0) return "protect";
  if (Number(deltas.power || 0) >= 3 || (Number(deltas.power || 0) > 0 && /解释权|城规|规矩|界石|盖印|名字|命名/.test(text))) return "control";
  if (Number(deltas.fear || 0) > 0 || Number(deltas.wantsToEscape || 0) > 0) return "withdraw";
  if (Number(deltas.deception || 0) > 2) return "hide_evidence";
  if (Number(deltas.wantsToBeSeen || 0) > 0) return "approach";
  return "wait";
}

function tacticLabelForPlan(tactic = "wait") {
  return {
    approach: "接近计划",
    withdraw: "撤退计划",
    protect: "保护计划",
    punish: "惩罚计划",
    control: "控局计划",
    hide_evidence: "藏证计划",
    plant_evidence: "设证计划",
    wait: "等待计划",
  }[tactic] || "计划";
}

function toneForPlanTactic(tactic = "wait") {
  return {
    approach: "接近",
    withdraw: "伪装",
    protect: "保护",
    punish: "惩罚",
    control: "伪装",
    hide_evidence: "伪装",
    plant_evidence: "共谋",
    wait: "试探",
  }[tactic] || "试探";
}

function verbForPlanTactic(tactic = "wait") {
  return {
    approach: "靠近",
    withdraw: "撤退并遮掩",
    protect: "保护",
    punish: "逼问",
    control: "夺回解释权",
    hide_evidence: "藏住证据",
    plant_evidence: "设下证据",
    wait: "等待",
  }[tactic] || "试探";
}

function buildCharacterMemories(draft, state) {
  const branchId = draft.branchId || state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
  return (draft.agentOutputs || []).map((output) => {
    const character = state.characters.find((item) => item.id === output.characterId);
    const target = state.characters.find((item) => item.id === output.targetCharacterId);
    const typeByTone = {
      惩罚: "weaponized",
      接近: "selective",
      伪装: "suppressed",
      保护: "selective",
      陷害: "weaponized",
      自毁: "suppressed",
      共谋: "misremembered",
      求证: "selective",
      试探: "selective",
    };
    const stanceByTone = {
      惩罚: "revenge",
      接近: "desire",
      伪装: "self_defense",
      保护: "protection",
      陷害: "revenge",
      自毁: "self_accusation",
      共谋: "desire",
      求证: "confusion",
      试探: "confusion",
    };
    return {
      id: createId("mem"),
      projectId: state.project.id,
      branchId,
      characterId: output.characterId,
      targetCharacterId: output.targetCharacterId || null,
      type: typeByTone[output.tone] || "selective",
      stance: stanceByTone[output.tone] || "confusion",
      content: `${character?.name || output.characterId}记住了自己本轮动作“${output.visibleAction}”，但更危险的是隐藏动作：“${output.hiddenAction}”。`,
      publicVersion: output.surfaceJustification || output.defenseAction || "这只是一次正常行动。",
      privateVersion: output.unadmittedPleasure || output.desireReason || output.hiddenAction || "无法公开承认的收益。",
      distortion: `这段记忆可能把${target?.name || "对方"}的反应改写成自我神话的证据；它来自草稿 ${draft.id}。`,
      reliability: clamp(output.tone === "伪装" || output.tone === "共谋" ? 44 : 58, 0, 100),
      heat: clamp((draft.audit?.safeClosureRisk || 35) + 24 + Number(draft.eventImpact || 0) / 6, 0, 100),
      locked: false,
      sourceDraftId: draft.id,
      source: "accepted_draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });
}

function dialogueMemoryType(shift = {}) {
  const deltas = shift.deltas || {};
  if (Number(deltas.revenge || 0) > 0 || Number(deltas.resentment || 0) >= 3) return "weaponized";
  if (Number(deltas.fear || 0) > 0 || Number(deltas.wantsToEscape || 0) > 0) return "suppressed";
  if (Number(deltas.protection || 0) > 0) return "selective";
  return "selective";
}

function dialogueMemoryStance(shift = {}) {
  const deltas = shift.deltas || {};
  if (Number(deltas.revenge || 0) > 0 || Number(deltas.resentment || 0) >= 3) return "revenge";
  if (Number(deltas.fear || 0) > 0 || Number(deltas.wantsToEscape || 0) > 0) return "self_defense";
  if (Number(deltas.protection || 0) > 0) return "protection";
  if (Number(deltas.wantsToBeSeen || 0) > 0) return "desire";
  return "confusion";
}

function normalizeDialogueTurnsForRelationship(turns = []) {
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
        triggeredBy: String(turn?.triggeredBy || ""),
      };
    })
    .filter(Boolean);
}

function buildRelationshipDialogueMemories(draft, state) {
  const branchId = draft.branchId || state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
  return (draft.relationshipShift || [])
    .filter((shift) => shift?.generatedFrom === "agent-dialogue-relationship" || shift?.generatedFrom === "model-agent-dialogue")
    .filter((shift) => shift.fromCharacterId && shift.toCharacterId)
    .map((shift) => {
      const character = state.characters.find((item) => item.id === shift.fromCharacterId);
      const target = state.characters.find((item) => item.id === shift.toCharacterId);
      const location = state.locations.find((item) => item.id === (shift.locationId || draft.locationId));
      const locationName = shift.locationName || location?.name || "场中";
      const objectLine = shift.sharedObject ? `，${shift.sharedObject}没有从场中消失` : "";
      const triggeredBy = String(shift.triggeredBy || shift.conductorSignal?.inWorldClue || "").trim();
      const dialogueActReason = String(shift.relationshipDialogueAct?.reason || "").trim();
      const retrievalCue = [
        locationName,
        shift.sharedObject || "",
        triggeredBy,
        shift.relationshipDialogueAct?.kind || "",
        dialogueActReason,
        shift.followupTurn || shift.finalTurn || "",
      ].filter(Boolean).join(" / ");
      const eventLine = [
        triggeredBy ? `线索：${triggeredBy}` : "",
        dialogueActReason ? `关系动作：${dialogueActReason}` : "",
        shift.unspoken,
        shift.followupTurn && shift.followupTurn !== shift.unspoken ? `追问：${shift.followupTurn}` : "",
        shift.eventOutcome,
        shift.misreading,
      ].filter(Boolean).join(" ");
      return {
        id: createId("mem"),
        projectId: state.project.id,
        branchId,
        characterId: shift.fromCharacterId,
        targetCharacterId: shift.toCharacterId,
        type: dialogueMemoryType(shift),
        stance: dialogueMemoryStance(shift),
        content: `关系对话记忆：${character?.name || shift.fromCharacterId}记住了${target?.name || shift.toCharacterId}在${locationName}的回应${objectLine}。`,
        publicVersion: shift.unspoken || "这只是一次按规矩发生的对话。",
        privateVersion: `${shift.misreading || "对方的回应被重新命名。"} ${eventLine}`,
        distortion: `这段记忆来自对话关系变化；${character?.name || "人物"}会把它当成${target?.name || "对方"}正在逼近、挑战、保护或撤退的证据。`,
        reliability: clamp(46 + Number(shift.dialogueTurnCount || 0) * 2, 0, 70),
        heat: clamp(76 + Number(draft.eventImpact || 0) / 6 + Number(shift.dialogueTurnCount || 0) * 3, 0, 100),
        locked: false,
        retrievalCue,
        sourceDraftId: draft.id,
        source: "agent_dialogue_relationship",
        sourceRelationshipShift: {
          generatedFrom: shift.generatedFrom,
          sourceOutputId: shift.sourceOutputId || "",
          responseOutputId: shift.responseOutputId || "",
          sharedObject: shift.sharedObject || "",
          locationId: shift.locationId || "",
          locationName: shift.locationName || locationName,
          periodSlot: shift.periodSlot || "",
          triggeredBy,
          conductorSignal: shift.conductorSignal || null,
          relationshipDialogueAct: shift.relationshipDialogueAct || null,
          dialogueTurnCount: shift.dialogueTurnCount || 0,
          dialogueTurns: normalizeDialogueTurnsForRelationship(shift.dialogueTurns),
          finalTurn: shift.finalTurn || "",
          followupTurn: shift.followupTurn || "",
          relationshipSource: shift.relationshipSource || "",
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });
}

function buildTownStateLedger(draft, state) {
  const branchId = draft.branchId || state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
  const entries = [];
  const ticks = Array.isArray(draft.periodSimulation?.ticks) && draft.periodSimulation.ticks.length
    ? draft.periodSimulation.ticks
    : [{
        id: draft.simulationTick?.id || draft.id,
        label: draft.timeGrain || "场景",
        locationId: draft.locationId,
        locationName: state.locations?.find((item) => item.id === draft.locationId)?.name || draft.locationName || "场中",
        sceneInteraction: draft.sceneInteraction,
      }];

  for (const tick of ticks) {
    const exchanges = tick.sceneInteraction?.agentExchanges || [];
    for (const [index, exchange] of exchanges.entries()) {
      const entry = townStateLedgerEntryFromExchange({
        draft,
        state,
        branchId,
        tick,
        exchange,
        index,
      });
      if (entry) entries.push(entry);
    }
    const presenceChanges = tick.sceneInteraction?.presenceChanges
      || (tick.id === draft.simulationTick?.id || tick.id === draft.id ? draft.presenceChanges || draft.sceneInteraction?.presenceChanges : [])
      || [];
    for (const [index, change] of presenceChanges.entries()) {
      if (!change || change.decision === "stay") continue;
      const character = state.characters?.find((item) => item.id === change.characterId);
      const locationName = tick.locationName || state.locations?.find((item) => item.id === tick.locationId)?.name || "场中";
      const destinationName = change.destinationName || state.locations?.find((item) => item.id === change.destinationId)?.name || "出口外";
      const fact = change.decision === "leave"
        ? (change.visibleDeparture || `${change.characterName || character?.name || "有人"}离开${locationName}，去了${destinationName}`)
        : (change.visibleDeparture || `${change.characterName || character?.name || "有人"}试图离开${locationName}，但没有走成`);
      entries.push({
        id: createId("ledger"),
        projectId: state.project?.id || draft.projectId,
        branchId,
        createdAt: new Date().toISOString(),
        sourceDraftId: draft.id,
        sourceTickId: tick.id || "",
        sourceExchangeId: `presence:${change.characterId}:${index}`,
        periodSlot: tick.label || "",
        locationId: tick.locationId || draft.locationId || "",
        locationName,
        fromCharacterId: change.characterId || "",
        fromCharacterName: change.characterName || character?.name || change.characterId || "有人",
        toCharacterId: "",
        toCharacterName: destinationName,
        object: "人物位置",
        kind: "presence_change",
        fact,
        consequence: change.decision === "leave"
          ? `${locationName}失去一名在场者，${destinationName}得到一名新到者。`
          : `${locationName}里的其他人看见了这次未完成的退场。`,
        finalTurn: "",
        stateKey: [branchId, "presence", change.characterId].filter(Boolean).join(":"),
      });
    }
  }
  return dedupeTownStateLedger(entries).slice(0, 80);
}

function townStateLedgerEntryFromExchange({ draft, state, branchId, tick, exchange, index }) {
  if (!exchange || typeof exchange !== "object") return null;
  const fromCharacterId = exchange.sourceCharacterId || exchange.actorId || exchange.characterId || "";
  const toCharacterId = exchange.responseCharacterId || exchange.targetId || exchange.targetCharacterId || "";
  const fromCharacterName = exchange.sourceCharacterName || exchange.actorName || state.characters?.find((item) => item.id === fromCharacterId)?.name || fromCharacterId || "有人";
  const toCharacterName = exchange.responseCharacterName || exchange.targetName || state.characters?.find((item) => item.id === toCharacterId)?.name || toCharacterId || "对方";
  const object = normalizeLedgerObject(exchange.sharedObject || exchange.conductorSignal?.object || extractLedgerObject(exchange.eventOutcome || exchange.stateDelta || ""));
  const fact = cleanLedgerSentence(exchange.eventOutcome || exchange.stateDelta || exchange.responseBeat || exchange.visibleBeat || "");
  if (!object || !fact) return null;
  const locationName = tick.locationName || state.locations?.find((item) => item.id === tick.locationId)?.name || "场中";
  const locationId = tick.locationId || draft.locationId || "";
  const actKind = exchange.relationshipDeltas?.find((shift) => shift?.relationshipDialogueAct?.kind)?.relationshipDialogueAct?.kind
    || exchange.relationshipDeltas?.[0]?.relationshipDialogueAct?.kind
    || inferLedgerKindFromFact(fact);
  const finalTurn = cleanLedgerSentence(
    exchange.dialogueTurns?.at?.(-1)?.line
      || exchange.relationshipDeltas?.[0]?.followupTurn
      || "",
  );
  const consequence = ledgerConsequence({
    actKind,
    fact,
    object,
    fromCharacterName,
    toCharacterName,
    locationName,
    finalTurn,
  });

  return {
    id: createId("ledger"),
    projectId: state.project?.id || draft.projectId,
    branchId,
    createdAt: new Date().toISOString(),
    sourceDraftId: draft.id,
    sourceTickId: tick.id || "",
    sourceExchangeId: [exchange.sourceOutputId, exchange.responseOutputId, index].filter((item) => item !== undefined && item !== "").join(":"),
    periodSlot: tick.label || "",
    locationId,
    locationName,
    fromCharacterId,
    fromCharacterName,
    toCharacterId,
    toCharacterName,
    object,
    kind: actKind,
    fact,
    consequence,
    finalTurn,
    stateKey: [branchId, locationId, object, fromCharacterId, toCharacterId].filter(Boolean).join(":"),
  };
}

function cleanLedgerSentence(text = "") {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/关系状态|下一步|后台|simulation|private|这轮关系/g, "")
    .trim()
    .replace(/[。！？；]+$/g, "");
}

function normalizeLedgerObject(object = "") {
  const value = String(object || "").trim();
  if (!value || /^(这件东西|那件东西|另一件东西|原来的东西|场中物件)$/.test(value)) return "";
  return value.replace(/[，。；！？、\s].*$/g, "").trim();
}

function extractLedgerObject(text = "") {
  const knownObjects = [
    "灵契",
    "妖丹盒",
    "庇护牌",
    "照骨镜",
    "渡令",
    "魂灯",
    "停剑令",
    "铜铃",
    "剑匣",
    "药炉",
    "界石",
    "铜盘",
    "账册",
    "封条",
  ];
  const haystack = String(text || "");
  return knownObjects.find((item) => haystack.includes(item)) || "";
}

function inferLedgerKindFromFact(fact = "") {
  if (/庇护|救命|挡住|护住/.test(fact)) return "protect";
  if (/价码|账册|交易|换手/.test(fact)) return "bargain";
  if (/逼|指认|证据|审|问/.test(fact)) return "accuse";
  if (/退|没有接|没有拿走|不能带走/.test(fact)) return "withdraw";
  if (/界石|铜盘|照见|盖印|解释权|名字/.test(fact)) return "control";
  return "unresolved";
}

function ledgerConsequence({ actKind, fact, object, fromCharacterName, toCharacterName, locationName, finalTurn }) {
  const turnTail = finalTurn ? `；${toCharacterName}刚说过的“${finalTurn}”留作下次追问` : "";
  const byKind = {
    protect: `${object}留在${locationName}，${fromCharacterName}替${toCharacterName}挡下一次直接带走或审讯${turnTail}`,
    control: `${object}留在${locationName}的见证处，${toCharacterName}必须当场回应，${fromCharacterName}暂时控制解释权${turnTail}`,
    bargain: `${object}转入${locationName}的价码，${toCharacterName}欠下一个可追问的答复${turnTail}`,
    withdraw: `${object}留在${locationName}，${toCharacterName}失去直接带走它的空档${turnTail}`,
    accuse: `${object}成为${locationName}里的指认凭据，${toCharacterName}必须交代来源${turnTail}`,
    punish: `${object}被扣在${locationName}，${toCharacterName}下一次开口不得绕过这件事${turnTail}`,
  };
  return cleanLedgerSentence(byKind[actKind] || `${object}留在${locationName}，${fromCharacterName}和${toCharacterName}都不能把这次碰面当作无事发生${turnTail}` || fact);
}

function dedupeTownStateLedger(entries = []) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    const signature = [
      entry.sourceDraftId,
      entry.sourceTickId,
      entry.sourceExchangeId,
      entry.object,
      entry.fact,
      entry.consequence,
    ].join("|");
    if (seen.has(signature)) continue;
    seen.add(signature);
    result.push(entry);
  }
  return result;
}

function findCharacterStateSourceShift(relationshipShift = [], characterId = "", outputId = "") {
  return (relationshipShift || []).find((shift) => (
    shift?.generatedFrom === "agent-dialogue-relationship"
    && (
      (outputId && (shift.sourceOutputId === outputId || shift.responseOutputId === outputId))
      || shift.fromCharacterId === characterId
      || shift.toCharacterId === characterId
    )
  )) || null;
}

function buildStateChangeReasons(draft, state, characterPatches, relationshipShift, characterPlans = [], townStateLedger = []) {
  const reasons = [];
  for (const entry of townStateLedger || []) {
    reasons.push({
      id: createId("reason"),
      projectId: state.project.id,
      branchId: draft.branchId || state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main",
      createdAt: new Date().toISOString(),
      kind: "town_state_ledger",
      sourceDraftId: draft.id,
      locationId: entry.locationId,
      locationName: entry.locationName,
      characterId: entry.fromCharacterId,
      characterName: entry.fromCharacterName,
      reason: `${entry.locationName}的可见事实改变：${entry.fact}。${entry.consequence}。`,
      deltaSummary: `${entry.object}; ${entry.fromCharacterName} -> ${entry.toCharacterName}`,
    });
  }
  for (const patch of characterPatches || []) {
    const character = state.characters.find((item) => item.id === patch.id);
    const output = (draft.agentOutputs || []).find((item) => item.characterId === patch.id);
    if (!character || !output) continue;
    const sourceShift = findCharacterStateSourceShift(relationshipShift, character.id, output.outputId);
    const deltas = [];
    for (const [key, value] of Object.entries(patch.currentState || {})) {
      const before = character.currentState?.[key];
      if (typeof before === "number" && typeof value === "number" && before !== value) deltas.push(`${key}: ${before}→${value}`);
    }
    reasons.push({
      id: createId("reason"),
      projectId: state.project.id,
      branchId: draft.branchId || state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main",
      createdAt: new Date().toISOString(),
      kind: "character_state",
      characterId: character.id,
      characterName: character.name,
      sourceDraftId: draft.id,
      sourceOutputId: sourceShift?.sourceOutputId || output.outputId || "",
      responseOutputId: sourceShift?.responseOutputId || "",
      sourceExchangeId: [sourceShift?.sourceOutputId || output.outputId || "", sourceShift?.responseOutputId || ""].filter(Boolean).join(":"),
      reason: `${character.name} 的状态变化来自本轮动作“${output.visibleAction}”${sourceShift?.eventOutcome ? `，并被互动后果推进：“${sourceShift.eventOutcome}”` : ""}：表层理由是“${output.surfaceJustification || output.defenseAction}”，欲望理由是“${output.desireReason || output.hiddenAction}”，阴影收益是“${output.unadmittedPleasure || output.shadowAction}”。`,
      deltaSummary: deltas.slice(0, 8).join("；"),
    });
  }
  for (const shift of relationshipShift || []) {
    const from = state.characters.find((item) => item.id === shift.fromCharacterId)?.name || shift.fromCharacterId;
    const to = state.characters.find((item) => item.id === shift.toCharacterId)?.name || shift.toCharacterId;
    const deltaSummary = Object.entries(shift.deltas || {}).map(([key, value]) => `${key}${Number(value) >= 0 ? "+" : ""}${value}`).join("；");
    reasons.push({
      id: createId("reason"),
      projectId: state.project.id,
      branchId: draft.branchId || state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main",
      createdAt: new Date().toISOString(),
      kind: "relationship_shift",
      relationshipLabel: `${from} → ${to}`,
      sourceDraftId: draft.id,
      interventionId: shift.interventionId || null,
      reason: `关系变化来自本轮误读：“${shift.misreading || "无"}”；未说出口的是：“${shift.unspoken || "无"}”。`,
      deltaSummary,
    });
  }
  const planReasons = (characterPlans || []).map((patch) => {
    const character = state.characters.find((item) => item.id === patch.characterId);
    return {
      id: createId("reason"),
      projectId: state.project.id,
      branchId: draft.branchId || state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main",
      createdAt: new Date().toISOString(),
      kind: "intent_plan",
      characterId: patch.characterId,
      characterName: character?.name || patch.characterId,
      sourceDraftId: draft.id,
      reason: `${character?.name || "人物"} 的自主计划被本轮行动推进：status=${patch.status || "active"}；tactic=${patch.currentTactic || "unknown"}；next=${patch.nextActionBias || "无"}`,
      deltaSummary: `progress ${patch.progress}; pressure ${patch.pressure}; risk ${patch.risk}`,
    };
  });
  return [...interventionReasonNotes(state, draft), ...buildPeriodSimulationReasons(draft, state), ...buildSimulationReasons(draft, state), ...buildMemoryAuditReasons(draft, state), ...planReasons, ...reasons];
}

function buildSimulationReasons(draft, state) {
  const tick = draft.simulationTick;
  if (!tick) return [];
  const branchId = draft.branchId || state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
  const privateReasons = (tick.privateSimulations || []).slice(0, 8).map((sim) => ({
    id: createId("reason"),
    projectId: state.project.id,
    branchId,
    createdAt: new Date().toISOString(),
    kind: "private_simulation",
    characterId: sim.characterId,
    characterName: sim.characterName,
    sourceDraftId: draft.id,
    reason: `${sim.characterName} 在实时私人模拟中先生成：公开目标=“${sim.publicGoal}”；私人欲望=“${sim.privateDesire}”；防御面具=“${sim.defensiveMask}”；阴影冲动=“${sim.shadowImpulse}”。`,
    deltaSummary: `tick ${tick.id}; contradiction ${sim.contradictionScore}; target ${sim.targetCharacterName || sim.targetCharacterId}`,
  }));
  const interactionReasons = (draft.sceneInteraction?.misunderstandings || []).slice(0, 6).map((item) => ({
    id: createId("reason"),
    projectId: state.project.id,
    branchId,
    createdAt: new Date().toISOString(),
    kind: "scene_interaction_simulation",
    sourceDraftId: draft.id,
    reason: `实时互动模拟制造误读：${item.misunderstanding || item}`,
    deltaSummary: `tick ${tick.id}; location ${tick.locationName}`,
  }));
  return [...privateReasons, ...interactionReasons];
}

function buildPeriodSimulationReasons(draft, state) {
  const period = draft.periodSimulation;
  if (!period) return [];
  const branchId = draft.branchId || state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
  const locationNames = (period.locationIds || []).map((id) => state.locations.find((location) => location.id === id)?.name || id);
  const participantNames = names(state, period.participantIds || []);
  const summary = {
    id: createId("reason"),
    projectId: state.project.id,
    branchId,
    createdAt: new Date().toISOString(),
    kind: "period_simulation",
    sourceDraftId: draft.id,
    reason: `本轮播放按 ${period.duration} 推进整个小镇：${period.tickCount || period.ticks?.length || 0} 个时间段、${locationNames.length} 个地点、${participantNames.length} 个角色被纳入同一次运转。`,
    deltaSummary: `locations ${locationNames.join(" / ")}; participants ${participantNames.join(" / ")}`,
  };
  const tickReasons = (period.ticks || []).slice(0, 6).map((tick) => ({
    id: createId("reason"),
    projectId: state.project.id,
    branchId,
    createdAt: new Date().toISOString(),
    kind: "period_simulation",
    sourceDraftId: draft.id,
    reason: `${tick.label} 在 ${tick.locationName} 生成镇内 tick：${tick.surfaceEvent || "多人行动并行发生"}。`,
    deltaSummary: `tick ${tick.simulationTick?.id || tick.id}; participants ${(tick.participantIds || []).join(", ")}`,
  }));
  return [summary, ...tickReasons];
}

function buildMemoryAuditReasons(draft, state) {
  const audit = draft.audit?.memoryAudit || draft.memoryAudit;
  if (!audit) return [];
  const branchId = draft.branchId || state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
  const used = (audit.usedMemories || []).slice(0, 6).map((item) => {
    const memory = (state.characterMemories || []).find((candidate) => candidate.id === item.memoryId) || item;
    const character = state.characters.find((candidate) => candidate.id === (memory.characterId || item.characterId));
    return {
      id: createId("reason"),
      projectId: state.project.id,
      branchId,
      createdAt: new Date().toISOString(),
      kind: "memory_use",
      characterId: memory.characterId || item.characterId,
      characterName: character?.name || memory.characterId || item.characterId,
      sourceDraftId: draft.id,
      memoryId: item.memoryId,
      reason: `记忆进入行动：${character?.name || "人物"} 把“${memory.content || memory.privateVersion || item.memoryId}”以 ${memory.type || item.type}/${memory.stance || item.stance} 的方式带入本轮动作。`,
      deltaSummary: `memoryContinuityScore ${audit.memoryContinuityScore}；memoryWeaponizationScore ${audit.memoryWeaponizationScore}`,
    };
  });
  const ignored = (audit.ignoredMemories || []).slice(0, 4).map((item) => {
    const memory = (state.characterMemories || []).find((candidate) => candidate.id === item.memoryId) || item;
    const character = state.characters.find((candidate) => candidate.id === (memory.characterId || item.characterId));
    return {
      id: createId("reason"),
      projectId: state.project.id,
      branchId,
      createdAt: new Date().toISOString(),
      kind: "memory_blind_spot",
      characterId: memory.characterId || item.characterId,
      characterName: character?.name || memory.characterId || item.characterId,
      sourceDraftId: draft.id,
      memoryId: item.memoryId,
      reason: `记忆盲区：${character?.name || "人物"} 没有把高热记忆“${memory.content || memory.privateVersion || item.memoryId}”转化为可表演行动。`,
      deltaSummary: `memoryBlindnessRisk ${audit.memoryBlindnessRisk}`,
    };
  });
  return [...used, ...ignored];
}

function buildIntentPlanReasons(draft, state, planPatches = []) {
  const audit = draft.audit?.intentPlanAudit || auditIntentPlans(state, draft);
  const branchId = draft.branchId || state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
  const reasons = (planPatches || []).slice(0, 8).map((plan) => {
    const character = state.characters.find((item) => item.id === plan.characterId);
    const target = state.characters.find((item) => item.id === plan.targetCharacterId);
    return {
      id: createId("reason"),
      projectId: state.project.id,
      branchId,
      createdAt: new Date().toISOString(),
      kind: "intent_plan",
      characterId: plan.characterId,
      characterName: character?.name || plan.characterId,
      sourceDraftId: draft.id,
      planId: plan.id,
      reason: `${character?.name || "人物"} 的自主计划“${plan.modeLabel || plan.mode}”推进到 ${plan.progress ?? 0}；目标对象是 ${target?.name || plan.targetCharacterId}。短期计划：${plan.shortTerm || "无"}`,
      deltaSummary: `planPressureScore ${audit.planPressureScore}; planChangedActionScore ${audit.planChangedActionScore}; ignoredPlanRisk ${audit.ignoredPlanRisk}`
    };
  });
  if (audit?.warnings?.length) {
    reasons.push({
      id: createId("reason"),
      projectId: state.project.id,
      branchId,
      createdAt: new Date().toISOString(),
      kind: "intent_plan_audit",
      sourceDraftId: draft.id,
      reason: `自主计划审查：${audit.warnings.join("；")}`,
      deltaSummary: `activePlanCount ${audit.activePlanCount}; planConflictScore ${audit.planConflictScore}`
    });
  }
  return reasons;
}


function inferEvidenceType(trace) {
  if (/邮件|批注|材料|记录|修订|说明|申请|文件/.test(trace)) return "document";
  if (/走廊|教室|会议|办公室|门口/.test(trace)) return "witnessed_event";
  if (/论坛|群|谣言|截图/.test(trace)) return "rumor_trace";
  return "trace";
}
