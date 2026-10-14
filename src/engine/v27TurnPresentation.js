const PRIVATE_MAINTENANCE_TURNS = Object.freeze({
  day_planning: Object.freeze({
    completedLabel: "私有日计划已形成",
    incompleteLabel: "私有日计划未完成",
    actionLabel: "安排接下来一天",
    description: "人物在私下安排接下来一天；具体内容不会被旁观者或其他人物读取。",
    outcome: Object.freeze({
      status: "quiet",
      label: "仅更新人物自己的安排",
      detail: "没有新增世界事实，计划内容不向旁观者公开。",
    }),
  }),
  reflection: Object.freeze({
    completedLabel: "私有反思已完成",
    incompleteLabel: "私有反思未完成",
    actionLabel: "整理自己的理解",
    description: "人物在私下整理自己的经历与理解；具体内容不会被旁观者或其他人物读取。",
    outcome: Object.freeze({
      status: "quiet",
      label: "仅更新人物自己的理解",
      detail: "没有新增世界事实，反思内容不向旁观者公开。",
    }),
  }),
});

function clean(value = "") {
  return String(value ?? "").trim();
}

export function classifyV27TurnKind(turn = {}) {
  const submissionMode = clean(turn.submissionMode);
  if (["day_planning", "reflection"].includes(submissionMode)) return submissionMode;
  const explicit = clean(turn.turnKind);
  if (["day_planning", "reflection"].includes(explicit)) return explicit;
  const wakeKind = clean(turn.wakeKind || turn.wake?.kind || turn.wake?.causeType);
  if (wakeKind === "day_planning_due") return "day_planning";
  if (wakeKind === "reflection_due") return "reflection";
  return "action";
}

export function privateV27MaintenancePresentation(turn = {}) {
  const turnKind = classifyV27TurnKind(turn);
  const presentation = PRIVATE_MAINTENANCE_TURNS[turnKind];
  if (!presentation) return null;
  const completed = turn.characterAgentCompleted === true;
  return {
    turnKind,
    completionLabel: completed ? presentation.completedLabel : presentation.incompleteLabel,
    actionLabel: presentation.actionLabel,
    description: presentation.description,
    outcome: { ...presentation.outcome },
  };
}
