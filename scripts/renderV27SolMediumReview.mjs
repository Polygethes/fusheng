// Render only public outcomes. Raw character JSON stays in the private run dir.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const runDirs = process.argv.slice(2).map(value => path.resolve(value));
assert.ok(runDirs.length, "Supply run directories in chronological order");
const reports = await Promise.all(runDirs.map(async directory => (
  JSON.parse(await readFile(path.join(directory, "report.json"), "utf8"))
)));
const current = reports.at(-1);
const publicRuns = [];
for (const report of reports) {
  assert.equal(report.model, "gpt-5.6-sol");
  assert.equal(report.reasoningEffort, "medium");
  const calls = [];
  for (const call of report.calls) {
    let outputPath = call.outputFile ? path.join(report.outputDir, call.outputFile) : null;
    const raw = outputPath ? await readFile(outputPath).catch(error => {
      if (error.code !== "ENOENT" || !call.error) throw error;
      outputPath = null;
      return null;
    }) : null;
    calls.push({
      index: call.index, actorTurn: call.turn, characterId: call.characterId,
      phase: call.phase, sessionOperation: call.sessionOperation,
      model: call.model, reasoningEffort: call.reasoningEffort,
      elapsedMs: call.elapsedMs, promptBytes: call.promptBytes,
      accepted: call.accepted, error: call.error,
      providerErrors: call.providerErrors || [],
      outputPath, outputSha256: raw ? createHash("sha256").update(raw).digest("hex") : null,
      usageReportedByCli: call.usage,
    });
  }
  publicRuns.push({
    status: report.status, startedAt: report.startedAt, finishedAt: report.finishedAt,
    elapsedMs: report.elapsedMs, completedActorTurns: report.turns.length,
    model: report.model, reasoningEffort: report.reasoningEffort,
    calls, rejections: report.rejections, error: report.error,
    failedCommands: report.failures.map(row => ({
      actorTurn: row.turn, status: row.status, code: row.response?.code,
      worldVersion: row.response?.worldVersion, sessionRevision: row.response?.sessionRevision,
    })),
    resumptions: report.resumptions || [],
    controlledInterruption: await readFile(path.join(report.outputDir, "pause-for-memory-fix.json"), "utf8")
      .then(JSON.parse).catch(error => { if (error.code === "ENOENT") return null; throw error; }),
  });
}
const turns = current.turns.map(row => {
  assert.equal(row.response.externalModelCalled, true);
  assert.equal(row.response.observation.turns.length, 1);
  const turn = row.response.observation.turns[0];
  return {
    index: row.index, elapsedMs: row.elapsedMs,
    characterId: turn.characterId, characterName: turn.characterName,
    agentTurnId: turn.agentTurnId, turnKind: turn.turnKind, wakeKind: turn.wakeKind,
    publicRealization: turn.publicRealization, outcome: turn.outcome,
    characterAgentCompleted: turn.characterAgentCompleted,
    protocolRepairCount: turn.protocolRepairCount,
    worldVersion: row.response.worldVersion,
    providerRequests: row.response.providerRequestBudget.usedProviderRequests,
    outputFiles: publicRuns.at(-1).calls.filter(call => call.actorTurn === row.index && call.outputPath)
      .map(call => call.outputPath),
  };
});
assert.equal(new Set(turns.map(turn => turn.agentTurnId)).size, turns.length);
for (let i = 0; i < turns.length; i += 1) {
  assert.equal(turns[i].index, i + 1);
  assert.equal(turns[i].characterAgentCompleted, true);
  if (i) assert.ok(turns[i].worldVersion >= turns[i - 1].worldVersion);
}
if (current.status === "complete") assert.equal(turns.length, 10);
for (const turn of turns.filter(row => row.turnKind === "action")) {
  const output = JSON.parse(await readFile(turn.outputFiles.at(-1), "utf8"));
  const expression = (output.turnCommit || output).publicExpression;
  assert.ok(expression, "every public action must be traceable to the model's final JSON");
  assert.equal(turn.publicRealization.speech, String(expression.utterance?.literalSpeech || "").trim(),
    "the report must preserve the model's actual words");
  assert.equal(turn.publicRealization.visibleAction, String(expression.bodyDelta || "").trim(),
    "the report must preserve the model's actual visible action");
}
const publicReport = {
  status: current.status, model: current.model, reasoningEffort: current.reasoningEffort,
  requestedActorTurns: 10, completedActorTurns: turns.length,
  activeExecutionElapsedMs: current.elapsedMs,
  wallClockElapsedMs: (current.finishedAt ? Date.parse(current.finishedAt) : Date.now()) - Date.parse(current.startedAt),
  transport: current.transport, characterAgentCallMode: current.characterAgentCallMode,
  enableDayPlanning: current.enableDayPlanning,
  allRunsProviderRequests: publicRuns.reduce((sum, run) => sum + run.calls.length, 0),
  completedRunProviderRequests: current.calls.length,
  runs: publicRuns, turns,
};
const seconds = value => (Number(value || 0) / 1000).toFixed(1);
const escapeCell = value => String(value || "").replaceAll("|", "\\|").replaceAll("\n", "<br>");
const currentRun = publicRuns.at(-1);
const returnedCalls = currentRun.calls.filter(call => Number.isFinite(call.elapsedMs));
const modelElapsedMs = returnedCalls.reduce((sum, call) => sum + call.elapsedMs, 0);
const repairCount = turns.reduce((sum, turn) => sum + turn.protocolRepairCount, 0);
publicReport.metrics = {
  speechTurns: turns.filter(turn => turn.publicRealization.speech).length,
  completedCommandProviderRequests: turns.reduce((sum, turn) => sum + turn.providerRequests, 0),
  twoCallTurns: turns.filter(turn => turn.providerRequests === 2).length,
  acceptedTurnProtocolRepairs: repairCount, modelAttemptElapsedMs: modelElapsedMs,
  maxPromptBytes: Math.max(0, ...currentRun.calls.map(call => call.promptBytes)),
};
const publicText = turn => {
  const visible = [...new Set([
    turn.publicRealization.speech ? `“${turn.publicRealization.speech}”` : "",
    turn.publicRealization.visibleAction,
    ...(turn.publicRealization.observableAffectiveTexture || []).map(row => row.feature),
  ].filter(Boolean))].join(" ");
  if (visible) return visible;
  if (turn.turnKind === "day_planning") return "日计划回合：模型形成私人生活安排，无公开对白或动作。";
  if (turn.turnKind === "reflection") return "反思回合：模型整理私人记忆，无公开对白或动作。";
  return "无公开对白或可见动作。";
};
const lines = [
  "# Sol medium：10 个人物回合真实测试", "",
  `状态：**${current.status === "complete" ? "完成" : current.status === "failed" ? "中断，保留失败证据" : "进行中"}，${turns.length}/10 个人物回合**。`, "",
  "模型固定为 `gpt-5.6-sol`，推理等级 `medium`，通过已有 ChatGPT 登录调用 Codex CLI。使用与生产模型页面相同的持久会话处理器、人物阶段及世界结算；逐轮继续同一个世界，每个人物独立续接自己的模型会话。测试直接调用服务端处理器，没有使用浏览器点击。", "",
  "初始场景为《逍遥游》望梯酒馆：洛照在门槛，谢真石在堂前。两次调用模式，开启日计划；每个回合最多三次模型请求，包含一次协议修正。候选、选择、对白、动作均由真实模型返回；测试禁止使用本地固定回复替代模型。", "",
  "用户确认的口径是 10 个人物回合，日计划或反思也占一个人物回合。下表逐字保留模型的公开表达；它描述人物的动作尝试，世界结算结果另列。", "",
  "| 回合 | 人物 | 模型实际对白或动作 | 世界结果 | 耗时 |", "|---:|---|---|---|---:|",
  ...turns.map(turn => `| ${turn.index} | ${turn.characterName} | ${escapeCell(publicText(turn))} | ${escapeCell(turn.outcome?.status || "无世界动作")}；版本 ${turn.worldVersion} | ${seconds(turn.elapsedMs)} 秒 |`),
  "", "## 请求与失败记录", "",
  `当前运行累计执行 ${seconds(current.elapsedMs)} 秒，已发起 ${current.calls.length} 次模型阶段请求。执行时间包含失败调用，但不含停机修改代码的间隔；从本次世界启动算起的实际经过时间为 ${seconds(publicReport.wallClockElapsedMs)} 秒。包括前期排错在内，总计 ${publicReport.allRunsProviderRequests} 次 CLI 阶段调用尝试；供应商在生成前拒绝的请求单独保留，不能算成人物回合。`, "",
  `已结束的模型调用尝试耗时合计 ${seconds(modelElapsedMs)} 秒；已完成人物回合中的协议修正共 ${repairCount} 次。`, "",
  "| 运行 | 已完成回合 | 模型调用尝试 | 状态 |", "|---:|---:|---:|---|",
  ...publicRuns.map((run, index) => `| ${index + 1} | ${run.completedActorTurns} | ${run.calls.length} | ${escapeCell(run.status)}${run.error ? `：${escapeCell(run.error.message)}` : ""} |`),
  "", ...currentRun.failedCommands.map(row => `- 第 ${row.actorTurn} 回合曾中断：\`${row.code}\`，当时世界版本 ${row.worldVersion}。失败不计为已完成回合。`),
  ...currentRun.resumptions.map(row => `- ${row.resumedAt} 从已完成的 ${row.completedActorTurns} 回合之后继续；之前的 ${row.providerRequestsAlreadyUsed} 次调用仍计入总数。`),
  ...(currentRun.controlledInterruption ? ["- 第 7 回合第 21 次调用由测试执行者主动停止，用于加载记忆延续修复。当时六轮已经保存，该调用没有完整返回；其 ENOENT 是中断后缺少输出文件的记录，不计为模型内容错误。"] : []),
  "", "前期真实测试发现：Codex 严格结构化输出要求所有对象字段都列入 required；原代码的可选字段会令供应商在生成前拒绝。已将可选字段编码为可空值，并在人物校验前恢复为省略。随后发现 activationState 与 feasibilityHandling 的字段说明容易误读，已明确其含义，并为这两类错误提供不含私密引用的固定修正说明。世界规则与校验器未放宽。", "",
  "第 4 回合还暴露了合并输出格式与现有校验不一致的问题：格式允许列出实际情绪却把 primaryChannelId 留空。现已用条件分支禁止这个组合，同时保留无情绪影响的合法输出。人物仍自行填写，系统不改写情绪、动作或台词。此前回合保持原样，从当前会话继续测试。", "",
  "第 4、6、7 回合的旧证据报错经复现确认属于项目缺陷：模型按协议选择保留旧认知，服务器展开时却复制了上一轮的证据引用，再把它当成本轮新观察拒绝。已修复为保留认知内容与心理来源，不替人物制造新观察；模型明确填写的新证据仍须通过原有校验。第 7 回合重启后加载此修复。", "",
  "## 原始返回", "",
  "以下链接是模型实际返回的完整 JSON，包含作者可见的人物私人心理字段，保留在本机临时目录；未把这些私人内容写入本报告。它们是应用要求模型输出的数据，不包含 Codex 内部推理日志。公共审计 JSON 记录了文件摘要。", "",
  ...currentRun.calls.filter(call => call.outputPath).map(call => `- 第 ${call.actorTurn} 回合，第 ${call.index} 次调用：[${call.phase}](${call.outputPath})（${seconds(call.elapsedMs)} 秒，${call.accepted === true ? "通过" : call.accepted === false ? "被拒绝或仅部分通过" : "待校验"}）。`),
  "", "性能口径：这里计量真实模型、校验和持久化的总时间，不含界面回合间等待。此前快速模式的 4.30 倍结果来自本地固定回复的浏览器测试，不能当作真实模型提速。CLI 返回的 token 用量按每次事件原样记录，未把可能包含会话累计量的计数相加。", "",
  "复测入口：`node scripts/runV27SolMediumReview.mjs --run`。该命令会真实调用模型；普通测试不会执行它。", "",
];
const docsDir = path.resolve("docs");
await writeFile(path.join(docsDir, "34_sol_medium_10_turns.json"), JSON.stringify(publicReport, null, 2) + "\n");
await writeFile(path.join(docsDir, "34_sol_medium_10_turns.md"), lines.join("\n"));
console.log(JSON.stringify({ status: current.status, completedActorTurns: turns.length, allRunsProviderRequests: publicReport.allRunsProviderRequests }));
