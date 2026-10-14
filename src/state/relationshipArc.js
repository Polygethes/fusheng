function cleanText(text = "", maxLength = 72) {
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[。！？…]+$/g, "")
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

function dialogueTurns(shift = {}) {
  return Array.isArray(shift.dialogueTurns) ? shift.dialogueTurns.filter(Boolean) : [];
}

function stateReplyLine(shift = {}) {
  const turn = dialogueTurns(shift).find((item) => item?.turnRole === "state_reply" && item.line);
  return cleanText(turn?.line || shift.followupTurn || shift.finalTurn || shift.unspoken || shift.eventOutcome || "");
}

function inferArcKind(shift = {}) {
  const explicit = String(shift.relationshipDialogueAct?.kind || "").trim();
  if (explicit) return explicit;
  const deltas = shift.deltas || {};
  const text = [
    shift.unspoken,
    shift.misreading,
    shift.eventOutcome,
    shift.finalTurn,
    shift.followupTurn,
  ].filter(Boolean).join(" ");
  if (Number(deltas.protection || 0) > 0 || /保护|庇护|救命|挡/.test(text)) return "protect";
  if (Number(deltas.power || 0) > 0 || /解释权|城法|命名|见证|盖印|铜盘/.test(text)) return "control";
  if (/价码|旧案|交易|进账|暗账/.test(text)) return "bargain";
  if (Number(deltas.fear || 0) > 0 || Number(deltas.wantsToEscape || 0) > 0 || /退路|撤|逃/.test(text)) return "withdraw";
  if (Number(deltas.resentment || 0) > 0 || Number(deltas.revenge || 0) > 0 || /证据|交代|控诉|逼问/.test(text)) return "accuse";
  return "unresolved";
}

function arcTemplate(kind = "unresolved") {
  return {
    protect: {
      label: "保护债已经成立",
      nextBias: "先护住人，再处理证物、规矩或价码。",
      obligation: "不能只处理物件，必须回应人是否会被带走。",
    },
    control: {
      label: "解释权被扣在见证处",
      nextBias: "争夺命名权、盖印流程或规矩解释。",
      obligation: "不能绕过见证流程，谁命名谁就要先亮手。",
    },
    bargain: {
      label: "旧案价码没有结清",
      nextBias: "把价码、旧案和上一句未答的话重新摆到明处。",
      obligation: "不能让物件直接进账，必须先回应旧案、条件或欠下的话。",
    },
    withdraw: {
      label: "退路已经被看见",
      nextBias: "退半步，但留下物件、问题或没有交出的解释。",
      obligation: "不能只后退，刚才那句话仍要留在场中。",
    },
    accuse: {
      label: "控诉压力已经落桌",
      nextBias: "逼对方承认证据、名字或责任的归属。",
      obligation: "不能把证据收走，必须回应来源、名字或责任。",
    },
    unresolved: {
      label: "未结清对白还压在场中",
      nextBias: "接住上一轮没有说完的话，再移动物件或关系位置。",
      obligation: "不能假装上一轮已经离场，必须接住留下的话。",
    },
  }[kind] || {
    label: "未结清对白还压在场中",
    nextBias: "接住上一轮没有说完的话，再移动物件或关系位置。",
    obligation: "不能假装上一轮已经离场，必须接住留下的话。",
  };
}

export function buildRelationshipArcFromShift(shift = {}, previousArc = null) {
  if (!shift || typeof shift !== "object") return null;
  const kind = inferArcKind(shift);
  const template = arcTemplate(kind);
  const sharedObject = cleanText(shift.sharedObject || previousArc?.sharedObject || "场中物件", 24);
  const currentObligation = stateReplyLine(shift) || cleanText(shift.unspoken || template.obligation);
  const actReason = cleanText(shift.relationshipDialogueAct?.reason || shift.misreading || template.obligation);
  const historyCount = Math.max(
    Number(previousArc?.historyCount || 0) + 1,
    Number(shift.relationshipMomentum?.historyCount || 0),
    Number(shift.dialogueTurnCount || 0) >= 5 ? 2 : 1,
  );
  return {
    kind,
    label: template.label,
    sharedObject,
    locationId: shift.locationId || previousArc?.locationId || "",
    locationName: shift.locationName || previousArc?.locationName || "",
    currentObligation,
    nextActionBias: template.nextBias,
    reason: actReason,
    pressure: Math.min(100, Number(previousArc?.pressure || 40) + 10 + Math.max(0, Number(shift.dialogueTurnCount || 0) - 3) * 3),
    historyCount,
    lastTurn: cleanText(shift.followupTurn || shift.finalTurn || currentObligation),
    updatedAt: new Date().toISOString(),
    source: shift.generatedFrom || shift.relationshipSource || "relationship-shift",
  };
}

export function relationshipArcSummary(rel = null, actorName = "有人", targetName = "对方") {
  const arc = rel?.relationshipArc;
  if (!arc) return "";
  const place = arc.locationName ? `在${arc.locationName}` : "";
  return `${actorName}和${targetName}${place}的关系阶段：${arc.label}；${arc.sharedObject || "场中物件"}还牵着下一步：${arc.currentObligation || arc.nextActionBias}`;
}
