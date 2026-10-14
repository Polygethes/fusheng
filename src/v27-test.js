import { createV27PersistentModelSessionClient } from "./engine/v27PersistentModelSessionClient.js";
import { privateV27MaintenancePresentation } from "./engine/v27TurnPresentation.js";
import {
  INK_TAVERN_ZONE_LAYOUT,
  createInkTavernStageController,
  tavernPresentationKeyForTurn,
} from "./ui/inkTavernStage.js";

const AUTO_MODEL_TURN_COUNT = 5;
const HISTORY_PLAYBACK_INTERVAL_MS = 900;
const INITIAL_RUNTIME = Object.freeze({
  nowSeconds: 0,
  worldVersion: 0,
  eventCount: 0,
  readyQueue: ["char_xyy_xiezenshi", "char_xyy_luozhao"],
  characters: [
    { characterId: "char_xyy_xiezenshi", name: "谢真石", zoneId: "counter", positionId: "" },
    { characterId: "char_xyy_luozhao", name: "洛照", zoneId: "threshold", positionId: "" },
  ],
  turns: [],
});

const statusNode = document.querySelector("#runtime-status");
const localButton = document.querySelector("#run-local");
const modelButton = document.querySelector("#run-model");
const autoButton = document.querySelector("#run-auto");
const stopAutoButton = document.querySelector("#stop-auto");
const consentInput = document.querySelector("#model-consent");
const consentCopy = document.querySelector("#model-consent-copy");
const consentDetailsNode = document.querySelector("#model-consent-details");
const batchDetailsNode = document.querySelector("#model-batch-details");
const resetModelButton = document.querySelector("#reset-model-session");
const modelSessionStatus = document.querySelector("#model-session-status");
const outputNode = document.querySelector("#run-output");
const actorOutputNode = document.querySelector("#actor-output");
const metaNode = document.querySelector("#run-meta");
const explanationNode = document.querySelector("#run-explanation");
const alertNode = document.querySelector("#run-alert");
const liveNode = document.querySelector("#v27-live-region");
const stageNode = document.querySelector("#ink-tavern-stage");
const stageWorkspace = document.querySelector(".v27-stage-workspace");
const timelineNode = document.querySelector("#turn-timeline");
const scrubberInput = document.querySelector("#turn-scrubber");
const historyPosition = document.querySelector("#history-position");
const historyPrevButton = document.querySelector("#history-prev");
const historyPlayButton = document.querySelector("#history-play");
const historyNextButton = document.querySelector("#history-next");
const historyLatestButton = document.querySelector("#history-latest");
const inspector = document.querySelector("#v27-inspector");
const inspectorTitle = document.querySelector("#v27-inspector-title");
const openInspectorButton = document.querySelector("#open-inspector");
const closeInspectorButton = inspector.querySelector('[data-action="close-v27-inspector"]');
const inspectorMedia = window.matchMedia("(max-width: 820px)");
const stageController = createInkTavernStageController(stageNode);

let maxProviderRequestsPerActorTurn = 3;
let usesApiKey = true;
let modelDisplayLabel = "当前配置模型 API";
let modelConfigurationReady = false;
let latestPayload = { runtime: INITIAL_RUNTIME };
let latestRuntime = INITIAL_RUNTIME;
let activeTurnKey = "";
let activeActorId = "";
let followLive = true;
let historyPlaying = false;
let historyPlaybackToken = 0;
let generationRunning = false;
let autoStopRequested = false;
let activeOperation = "";
let inspectorTrigger = null;

function clean(value = "") {
  return String(value ?? "").trim();
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function runtimeFrom(payload = {}) {
  return payload.runtime || payload.observation || payload;
}

function characterIdFor(row = {}) {
  return clean(row.characterId || row.id);
}

function characterFor(characterId = "") {
  return (latestRuntime.characters || []).find((row) => characterIdFor(row) === characterId) || null;
}

function characterNameFor(characterId = "") {
  return clean(characterFor(characterId)?.name || characterId || "人物");
}

function zoneLabelFor(zoneId = "") {
  return INK_TAVERN_ZONE_LAYOUT[zoneId]?.label || clean(zoneId) || "客栈里";
}

function realizationFor(turn = {}) {
  const publicRealization = turn.publicRealization || {};
  return {
    actionType: clean(turn.actionType || publicRealization.actionType),
    targetCharacterId: clean(turn.targetCharacterId || publicRealization.targetCharacterId),
    speech: clean(turn.speech || publicRealization.speech),
    visibleAction: clean(turn.visibleAction || publicRealization.visibleAction),
  };
}

function stableTurnKey(turn = {}, index = 0) {
  const explicit = clean(
    turn.agentTurnId
      || turn.turnId
      || turn.actionId
      || turn.outcome?.worldEventId
      || turn.outcome?.eventId
      || turn.eventId,
  );
  return explicit || tavernPresentationKeyForTurn(turn) || `turn-${index + 1}`;
}

function turnRows() {
  return Array.isArray(latestRuntime.turns) ? latestRuntime.turns : [];
}

function turnIndexForKey(turnKey = "") {
  if (!turnKey) return -1;
  return turnRows().findIndex((turn, index) => stableTurnKey(turn, index) === turnKey);
}

function framePositionForTurnKey(turnKey = "") {
  const index = turnIndexForKey(turnKey);
  return index < 0 ? 0 : index + 1;
}

function turnAtPosition(position = 0) {
  const index = Math.max(0, Number(position) || 0) - 1;
  return position > 0 ? turnRows()[index] || null : null;
}

function formatWorldTime(seconds = 0) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const day = Math.floor(safeSeconds / 86400) + 1;
  const withinDay = safeSeconds % 86400;
  const hour = String(Math.floor(withinDay / 3600)).padStart(2, "0");
  const minute = String(Math.floor((withinDay % 3600) / 60)).padStart(2, "0");
  return `第 ${day} 天 ${hour}:${minute}`;
}

function textureText(rows = []) {
  return (rows || []).map((row) => row.feature).filter(Boolean).join("；");
}

function observerPsychologyRows(turn = {}) {
  const psychology = turn.observerOnlyPsychology || {};
  const impulse = psychology.automaticCommunicationImpulse || {};
  return [
    ["此刻想做", psychology.selectedIntention],
    ["为什么这样做", psychology.privateDecisionBasis],
    ["开口或行动前的冲动", impulse.feltTendency],
    ["正在压住的冲突", impulse.conflict?.present ? impulse.conflict.description : ""],
  ].filter(([, value]) => clean(value));
}

function worldStatus(turn = {}) {
  const maintenance = privateV27MaintenancePresentation(turn);
  if (maintenance) return {
    label: maintenance.outcome.label,
    detail: maintenance.outcome.detail,
    status: "quiet",
  };
  const outcome = turn.outcome || {};
  if (outcome.label) return {
    label: clean(outcome.label),
    detail: clean(outcome.detail),
    status: clean(outcome.status || "quiet"),
  };
  const failed = outcome.status === "failed";
  const partial = outcome.status === "partial";
  const failedCodes = (outcome.failedEffects || []).map((row) => clean(row.message || row.code)).filter(Boolean).join("、");
  return {
    label: failed ? "尝试没有发生" : partial ? "动作只完成了一部分" : outcome.status ? "世界已经结算" : "没有新增世界事实",
    detail: failedCodes || (failed ? "人物仍在上一次结算的位置。" : `世界时间推进 ${Math.max(0, Number(outcome.durationSeconds) || 0)} 秒。`),
    status: clean(outcome.status || "quiet"),
  };
}

function renderPsychologyRows(rows = []) {
  if (!rows.length) return '<p class="v27-inspector-note">人物没有向观察者公开更完整的行动内因。</p>';
  return `<dl class="v27-psychology-list">${rows.map(([label, value]) => `
    <div class="v27-psychology-row">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>`).join("")}</dl>`;
}

function renderTurnDetail(turn = null, index = -1) {
  if (!turn) {
    outputNode.className = "v27-empty";
    outputNode.innerHTML = "<p>这是人物开始行动前的公开世界状态。</p>";
    inspectorTitle.textContent = "初始世界";
    return;
  }
  const maintenance = privateV27MaintenancePresentation(turn);
  const realization = realizationFor(turn);
  const status = worldStatus(turn);
  const characterName = clean(turn.characterName || characterNameFor(characterIdFor(turn)));
  const action = maintenance ? maintenance.description : realization.visibleAction || "保持观察，没有提交新的可见动作。";
  const speech = maintenance ? "" : realization.speech;
  const texture = Array.isArray(turn.affectiveTexture)
    ? turn.affectiveTexture.join("；")
    : textureText(turn.publicRealization?.observableAffectiveTexture);
  const nextReady = (latestRuntime.readyQueue || []).map(characterNameFor).filter(Boolean).join("、") || "世界等待新的可行动条件";
  inspectorTitle.textContent = `第 ${index + 1} 回合 · ${characterName}`;
  outputNode.className = "";
  outputNode.innerHTML = `
    <dl class="v27-causal-chain">
      <div class="v27-causal-step">
        <dt>人物接住了什么</dt>
        <dd>${escapeHtml(maintenance ? "人物自己的维护时机已经到来。" : observerPsychologyRows(turn)[0]?.[1] || "人物读取了此刻可见、可听见的世界。")}</dd>
      </div>
      <div class="v27-causal-step">
        <dt>${escapeHtml(maintenance ? maintenance.completionLabel : `${characterName}做了什么`)}</dt>
        <dd>${escapeHtml(action)}</dd>
      </div>
      ${speech ? `<div class="v27-causal-step"><dt>说出口的话</dt><dd class="v27-dialogue">“${escapeHtml(speech)}”</dd></div>` : ""}
      ${texture ? `<div class="v27-causal-step"><dt>别人能感到的表面</dt><dd>${escapeHtml(texture)}</dd></div>` : ""}
      <div class="v27-causal-step">
        <dt>${escapeHtml(status.label)}</dt>
        <dd>${escapeHtml(status.detail || "公开世界已经保存这次结果。")}</dd>
      </div>
      <div class="v27-causal-step">
        <dt>接下来</dt>
        <dd>${escapeHtml(nextReady)}</dd>
      </div>
    </dl>
    ${maintenance ? '<p class="v27-inspector-note">这是人物自己的维护回合；私人计划与反思不会写入旁观者可见世界。</p>' : ""}`;
}

function renderActorDetail(characterId = "") {
  const character = characterFor(characterId);
  if (!character) {
    actorOutputNode.className = "v27-empty";
    actorOutputNode.innerHTML = "<p>这个人物当前不在公开酒馆投影中。</p>";
    return;
  }
  const latestTurnIndex = [...turnRows()].map(characterIdFor).lastIndexOf(characterId);
  const latestTurn = latestTurnIndex >= 0 ? turnRows()[latestTurnIndex] : null;
  const maintenance = latestTurn ? privateV27MaintenancePresentation(latestTurn) : null;
  const realization = realizationFor(latestTurn || {});
  inspectorTitle.textContent = clean(character.name || "人物");
  actorOutputNode.className = "";
  actorOutputNode.innerHTML = `
    <dl class="v27-causal-chain">
      <div class="v27-causal-step"><dt>当前位置</dt><dd>${escapeHtml(zoneLabelFor(character.zoneId))}</dd></div>
      <div class="v27-causal-step"><dt>最近一次公开行动</dt><dd>${escapeHtml(realization.visibleAction || "正在观察客栈，没有新的公开动作。")}</dd></div>
      ${realization.speech && !maintenance ? `<div class="v27-causal-step"><dt>最近说过</dt><dd class="v27-dialogue">“${escapeHtml(realization.speech)}”</dd></div>` : ""}
    </dl>
    ${maintenance ? "" : `<div class="v27-actor-wrap">${renderPsychologyRows(observerPsychologyRows(latestTurn || {}))}</div>`}
    <p class="v27-inspector-note">人物内因只供观察者理解，不会被这个页面写回人物或世界。</p>`;
}

function timelineSummary(turn = {}) {
  const maintenance = privateV27MaintenancePresentation(turn);
  const realization = realizationFor(turn);
  return clean(maintenance?.description || realization.speech || realization.visibleAction || "保持观察");
}

function renderTimeline() {
  const turns = turnRows();
  if (!turns.length) {
    timelineNode.innerHTML = '<li class="v27-turn-empty">运行一个回合后，因果节拍会出现在这里。</li>';
    return;
  }
  timelineNode.innerHTML = turns.map((turn, index) => {
    const turnKey = stableTurnKey(turn, index);
    const maintenance = privateV27MaintenancePresentation(turn);
    const status = worldStatus(turn);
    const name = clean(turn.characterName || characterNameFor(characterIdFor(turn)) || maintenance?.actorLabel || "世界");
    return `<li>
      <button
        class="v27-turn-button"
        type="button"
        data-action="seek-turn"
        data-turn-key="${escapeHtml(turnKey)}"
        data-character="${escapeHtml(characterIdFor(turn))}"
        aria-current="${turnKey === activeTurnKey ? "step" : "false"}"
        aria-label="查看第 ${index + 1} 回合，${escapeHtml(name)}"
      >
        <span class="v27-turn-index">${String(index + 1).padStart(2, "0")}</span>
        <span class="v27-turn-name">${escapeHtml(name)}</span>
        <span class="v27-turn-result">${escapeHtml(status.status === "failed" ? "未发生" : maintenance ? "私有" : "已结算")}</span>
        <span class="v27-turn-summary">${escapeHtml(timelineSummary(turn))}</span>
      </button>
    </li>`;
  }).join("");
}

function updatePlaybackControls(position = framePositionForTurnKey(activeTurnKey)) {
  const totalTurns = turnRows().length;
  const safePosition = Math.max(0, Math.min(totalTurns, Number(position) || 0));
  scrubberInput.max = String(totalTurns);
  scrubberInput.value = String(safePosition);
  scrubberInput.disabled = totalTurns === 0;
  historyPrevButton.disabled = safePosition <= 0;
  historyNextButton.disabled = safePosition >= totalTurns;
  historyLatestButton.disabled = totalTurns === 0 || safePosition >= totalTurns;
  historyPlayButton.disabled = totalTurns === 0;
  historyPlayButton.textContent = historyPlaying ? "暂停" : "播放";
  historyPlayButton.setAttribute("aria-pressed", historyPlaying ? "true" : "false");
  historyPosition.textContent = safePosition === 0 ? `初始 · ${totalTurns} 回合` : `${safePosition} / ${totalTurns}`;
}

function selectTurnByKey(turnKey = "", { open = false, tab = "cause", preservePlayback = false } = {}) {
  if (!preservePlayback) stopHistoryPlayback();
  const index = turnIndexForKey(turnKey);
  activeTurnKey = index >= 0 ? stableTurnKey(turnRows()[index], index) : "";
  const position = framePositionForTurnKey(turnKey);
  followLive = turnRows().length === 0 || position === turnRows().length;
  stageController.seek(latestRuntime, framePositionForTurnKey(turnKey));
  stageNode.querySelectorAll("[data-stage-actor]").forEach((node) => {
    node.toggleAttribute("data-history-active", characterIdFor(turnRows()[index] || {}) === node.dataset.character);
  });
  timelineNode.querySelectorAll("[data-turn-key]").forEach((button) => {
    const current = button.dataset.turnKey === activeTurnKey;
    button.setAttribute("aria-current", current ? "step" : "false");
  });
  renderTurnDetail(index >= 0 ? turnRows()[index] : null, index);
  updatePlaybackControls(position);
  updateRunMeta();
  if (open) openInspector(tab, timelineNode.querySelector(`[data-turn-key="${CSS.escape(activeTurnKey)}"]`));
}

function selectFrame(position = 0, options = {}) {
  const safePosition = Math.max(0, Math.min(turnRows().length, Number(position) || 0));
  const turn = turnAtPosition(safePosition);
  const turnKey = turn ? stableTurnKey(turn, safePosition - 1) : "";
  selectTurnByKey(turnKey, options);
}

function stopHistoryPlayback() {
  historyPlaybackToken += 1;
  historyPlaying = false;
  updatePlaybackControls();
}

async function startHistoryPlayback() {
  if (!turnRows().length) return;
  if (historyPlaying) {
    stopHistoryPlayback();
    return;
  }
  historyPlaying = true;
  const token = ++historyPlaybackToken;
  let position = framePositionForTurnKey(activeTurnKey);
  if (position >= turnRows().length) {
    position = 0;
    selectFrame(0, { preservePlayback: true });
  }
  updatePlaybackControls(position);
  while (token === historyPlaybackToken && position < turnRows().length) {
    await new Promise((resolve) => window.setTimeout(resolve, HISTORY_PLAYBACK_INTERVAL_MS));
    if (token !== historyPlaybackToken) return;
    position += 1;
    selectFrame(position, { preservePlayback: true });
  }
  if (token === historyPlaybackToken) stopHistoryPlayback();
}

function updateRunMeta() {
  const turns = turnRows();
  const activeIndex = turnIndexForKey(activeTurnKey);
  const location = activeIndex >= 0 ? `第 ${activeIndex + 1} 回合` : turns.length ? `${turns.length} 回合` : "世界尚未起时";
  metaNode.textContent = `${location} · ${formatWorldTime(latestRuntime.nowSeconds)}${followLive ? " · 现场" : " · 回看"}`;
}

function renderRuntime(payload = {}, { replay = true, forceLatest = false } = {}) {
  const previousTurnCount = turnRows().length;
  const previousActiveKey = activeTurnKey;
  const wasFollowing = followLive || !previousActiveKey || framePositionForTurnKey(previousActiveKey) >= previousTurnCount;
  latestPayload = payload;
  latestRuntime = runtimeFrom(payload);
  const turns = turnRows();
  const preservedIndex = turns.findIndex((turn, index) => stableTurnKey(turn, index) === previousActiveKey);
  if (turns.length && (forceLatest || wasFollowing || preservedIndex < 0)) {
    activeTurnKey = stableTurnKey(turns.at(-1), turns.length - 1);
    followLive = true;
  } else if (preservedIndex >= 0) {
    activeTurnKey = stableTurnKey(turns[preservedIndex], preservedIndex);
    followLive = preservedIndex === turns.length - 1;
  } else {
    activeTurnKey = "";
    followLive = true;
  }
  renderTimeline();
  selectTurnByKey(activeTurnKey, { preservePlayback: true });
  updateRunMeta();
  const providerBudget = payload.providerRequestBudget || {};
  const localFixture = /^local-(?:five-stage|character-agent)-fixture(?:-persistent)?$/.test(payload.mode || "");
  if (localFixture && payload.explanation) {
    explanationNode.textContent = payload.explanation;
  } else if (providerBudget.maxProviderRequests || payload.maxProviderRequests) {
    const requestLabel = usesApiKey ? "外部请求" : "本机 Codex 调用";
    explanationNode.textContent = `最近一回合使用 ${providerBudget.usedProviderRequests || 0}/${providerBudget.maxProviderRequests || payload.maxProviderRequests || 0} 次${requestLabel}。`;
  }
  alertNode.hidden = true;
  stageNode.removeAttribute("aria-busy");
  if (replay && turns.length > previousTurnCount) liveNode.textContent = `第 ${turns.length} 回合已经结算。`;
  updateModelSessionStatus();
}

function inspectorIsMobile() {
  return inspectorMedia.matches;
}

function selectInspectorTab(tabName = "cause") {
  inspector.querySelectorAll("[data-inspector-tab]").forEach((button) => {
    const selected = button.dataset.inspectorTab === tabName;
    button.setAttribute("aria-selected", selected ? "true" : "false");
    document.querySelector(`#inspector-${button.dataset.inspectorTab}`).hidden = !selected;
  });
  if (tabName === "actor") renderActorDetail(activeActorId);
}

function openInspector(tabName = "cause", trigger = null) {
  inspectorTrigger = trigger || document.activeElement || openInspectorButton;
  selectInspectorTab(tabName);
  if (!inspector.open) {
    if (inspectorIsMobile()) inspector.showModal();
    else inspector.show();
  }
  openInspectorButton.setAttribute("aria-expanded", "true");
  inspectorTitle.focus({ preventScroll: true });
}

function closeInspector({ restoreFocus = true } = {}) {
  if (inspector.open) inspector.close();
  openInspectorButton.setAttribute("aria-expanded", "false");
  stageNode.querySelectorAll('[data-action="inspect-tavern-actor"][aria-expanded="true"]').forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });
  if (restoreFocus) {
    const target = inspectorTrigger?.isConnected ? inspectorTrigger : openInspectorButton;
    target?.focus?.({ preventScroll: true });
  }
  inspectorTrigger = null;
}

function updateConsentCopy() {
  const automaticBudget = AUTO_MODEL_TURN_COUNT * maxProviderRequestsPerActorTurn;
  consentCopy.textContent = usesApiKey
    ? `授权本次选择：推进一回合最多 ${maxProviderRequestsPerActorTurn} 次真实外部请求；连续运行固定 ${AUTO_MODEL_TURN_COUNT} 回合，总计最多 ${automaticBudget} 次。停止、错误、完成或刷新即授权失效。`
    : `授权本次选择：推进一回合最多 ${maxProviderRequestsPerActorTurn} 次本机 Codex 调用；连续运行固定 ${AUTO_MODEL_TURN_COUNT} 回合，总计最多 ${automaticBudget} 次。不使用项目 API 密钥；停止、错误、完成或刷新即授权失效。`;
  consentDetailsNode.textContent = `公开行动回合默认合并为 2 次基础调用：第一次完成人物评估与候选生成，本地数学公式评价候选；第二次由人物读取数学反馈后自主选择、调节并提交。每回合最多 1 次协议修正，合计上限 ${maxProviderRequestsPerActorTurn} 次。日计划或反思回合只调用 1 次。`;
  batchDetailsNode.textContent = `连续运行固定为 ${AUTO_MODEL_TURN_COUNT} 个真实人物回合，严格串行，总计最多 ${automaticBudget} 次调用；停止、错误、完成或刷新都会让本次授权失效。只发送隔离的人物底座、私人记忆、关系、心理参数与当前酒馆投影；不发送仓库、密钥、本地路径或配置。当前内核为 Phase 92 原子四阶段链。`;
}

function updateActionAvailability() {
  const authorized = modelConfigurationReady && consentInput.checked && !generationRunning;
  modelButton.disabled = !authorized;
  autoButton.disabled = !authorized;
  consentInput.disabled = !modelConfigurationReady || generationRunning;
  localButton.disabled = generationRunning;
  const snapshot = modelSessionClient.snapshot();
  resetModelButton.disabled = generationRunning || !snapshot.sessionRef?.sessionId
    || Boolean(snapshot.pendingCommand && snapshot.pendingCommand.operation !== "reset");
  stopAutoButton.hidden = activeOperation !== "auto";
  stopAutoButton.disabled = activeOperation !== "auto" || autoStopRequested;
}

function updateModelSessionStatus() {
  const snapshot = modelSessionClient.snapshot();
  const ref = snapshot.sessionRef;
  const pending = snapshot.pendingCommand;
  modelSessionStatus.textContent = ref
    ? `同一双人物会话 · 进度 ${ref.sessionRevision} · 世界 ${ref.worldVersion}${pending ? " · 有一个回合等待确认" : ""}`
    : "尚未建立真实双人物持久会话。";
  updateActionAvailability();
}

function consumeAuthorization() {
  if (!modelConfigurationReady || !consentInput.checked) return;
  consentInput.checked = false;
  return true;
}

function setLoading(button, label, operation = "manual") {
  generationRunning = true;
  activeOperation = operation;
  autoStopRequested = false;
  button.dataset.previousLabel = button.textContent;
  button.textContent = label;
  alertNode.hidden = true;
  stageNode.setAttribute("aria-busy", "true");
  stageController.setStatus("running", "人物正在形成行动；上一份已结算世界仍然可查看。");
  updateActionAvailability();
}

function clearLoading(button) {
  generationRunning = false;
  activeOperation = "";
  autoStopRequested = false;
  stageNode.removeAttribute("aria-busy");
  button.textContent = button.dataset.previousLabel || button.textContent;
  updateModelSessionStatus();
}

function showError(error) {
  const payload = error?.payload || {};
  const failure = payload.failure || {};
  const message = clean(failure.message || error?.message || String(error));
  alertNode.innerHTML = `<strong>本轮未结算。</strong> ${escapeHtml(message)} 人物仍在上一次公开位置。`;
  alertNode.hidden = false;
  metaNode.textContent = "运行已安全停止";
  explanationNode.textContent = "错误没有覆盖已经结算的舞台与历史；可以检查详情后重新授权。";
  stageController.setStatus("error", "本轮没有新的世界结算，人物仍停留在上一次公开位置。");
  selectInspectorTab("run");
}

async function requestJson(path, body = null) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || `请求失败（${response.status}）`);
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

const modelSessionClient = createV27PersistentModelSessionClient({
  storage: window.sessionStorage,
  request: requestJson,
});

async function loadStatus() {
  try {
    const status = await requestJson("/api/v27/tavern/status");
    usesApiKey = status.usesApiKey !== false;
    modelDisplayLabel = status.modelDisplayLabel || status.model || "当前配置模型";
    maxProviderRequestsPerActorTurn = Number(status.maxProviderRequestsPerActorTurn || 3);
    modelConfigurationReady = true;
    statusNode.className = "v27-runtime-state ready";
    statusNode.textContent = `已就绪 · ${modelDisplayLabel}`;
    consentInput.disabled = false;
    updateConsentCopy();
    updateActionAvailability();
  } catch {
    modelConfigurationReady = false;
    consentInput.checked = false;
    consentInput.disabled = true;
    statusNode.className = "v27-runtime-state failed";
    statusNode.textContent = "人物运行时未连接";
    updateActionAvailability();
  }
}

stageNode.addEventListener("click", (event) => {
  const button = event.target.closest('[data-action="inspect-tavern-actor"]');
  if (!button || !stageNode.contains(button)) return;
  const actorRoot = button.closest("[data-stage-actor]");
  activeActorId = clean(actorRoot?.dataset.character);
  stageNode.querySelectorAll('[data-action="inspect-tavern-actor"][aria-expanded="true"]').forEach((other) => {
    if (other !== button) other.setAttribute("aria-expanded", "false");
  });
  button.setAttribute("aria-expanded", "true");
  const latestActorTurnIndex = [...turnRows()].map(characterIdFor).lastIndexOf(activeActorId);
  if (latestActorTurnIndex >= 0) {
    selectTurnByKey(stableTurnKey(turnRows()[latestActorTurnIndex], latestActorTurnIndex), { preservePlayback: false });
  }
  renderActorDetail(activeActorId);
  openInspector("actor", button);
});

timelineNode.addEventListener("click", (event) => {
  const button = event.target.closest('[data-action="seek-turn"]');
  if (!button) return;
  selectTurnByKey(button.dataset.turnKey, { open: true, tab: "cause" });
});

historyPrevButton.addEventListener("click", () => selectFrame(framePositionForTurnKey(activeTurnKey) - 1));
historyNextButton.addEventListener("click", () => selectFrame(framePositionForTurnKey(activeTurnKey) + 1));
historyLatestButton.addEventListener("click", () => selectFrame(turnRows().length));
historyPlayButton.addEventListener("click", () => { void startHistoryPlayback(); });
scrubberInput.addEventListener("input", () => selectFrame(Number(scrubberInput.value)));

openInspectorButton.addEventListener("click", () => openInspector("cause", openInspectorButton));
closeInspectorButton.addEventListener("click", () => closeInspector());
inspector.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeInspector();
});
inspector.addEventListener("click", (event) => {
  if (!inspectorIsMobile() || event.target !== inspector) return;
  const bounds = inspector.getBoundingClientRect();
  const inside = event.clientX >= bounds.left && event.clientX <= bounds.right
    && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
  if (!inside) closeInspector();
});

inspector.querySelector("[role=tablist]").addEventListener("click", (event) => {
  const tab = event.target.closest("[data-inspector-tab]");
  if (!tab) return;
  selectInspectorTab(tab.dataset.inspectorTab);
});

inspector.querySelector("[role=tablist]").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const tabs = [...inspector.querySelectorAll("[data-inspector-tab]")];
  const current = tabs.indexOf(document.activeElement);
  if (current < 0) return;
  event.preventDefault();
  const next = (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
  selectInspectorTab(tabs[next].dataset.inspectorTab);
});

inspectorMedia.addEventListener("change", () => {
  if (!inspector.open) return;
  const selectedTab = inspector.querySelector('[role="tab"][aria-selected="true"]')?.dataset.inspectorTab || "cause";
  inspector.close();
  if (inspectorIsMobile()) inspector.showModal();
  else inspector.show();
  selectInspectorTab(selectedTab);
});

consentInput.addEventListener("change", updateActionAvailability);

localButton.addEventListener("click", async () => {
  setLoading(localButton, "正在自检…", "local");
  try {
    renderRuntime(await requestJson("/api/v27/tavern/demo", {}), { forceLatest: true });
  } catch (error) {
    showError(error);
  } finally {
    clearLoading(localButton);
  }
});

modelButton.addEventListener("click", async () => {
  if (!consumeAuthorization()) return;
  setLoading(modelButton, "人物正在行动…", "manual");
  try {
    const result = await modelSessionClient.runAuthorizedTurn({ authorizationAcknowledged: true });
    renderRuntime({
      ...result.displayedObservation,
      runtime: result.displayedObservation,
    }, { forceLatest: true });
  } catch (error) {
    showError(error);
  } finally {
    clearLoading(modelButton);
  }
});

autoButton.addEventListener("click", async () => {
  if (!consumeAuthorization()) return;
  setLoading(autoButton, `连续运行 0/${AUTO_MODEL_TURN_COUNT}`, "auto");
  let completedTurns = 0;
  try {
    for (let index = 0; index < AUTO_MODEL_TURN_COUNT; index += 1) {
      if (autoStopRequested || !generationRunning) break;
      autoButton.textContent = `连续运行 ${index + 1}/${AUTO_MODEL_TURN_COUNT}`;
      metaNode.textContent = `人物正在形成第 ${index + 1}/${AUTO_MODEL_TURN_COUNT} 个回合`;
      const result = await modelSessionClient.runAuthorizedTurn({ authorizationAcknowledged: true });
      completedTurns += 1;
      renderRuntime({
        ...result.displayedObservation,
        runtime: result.displayedObservation,
      }, { forceLatest: true });
    }
    liveNode.textContent = autoStopRequested
      ? `连续运行已在第 ${completedTurns} 回合后停止。`
      : `连续运行已完成 ${completedTurns} 回合。`;
    explanationNode.textContent = autoStopRequested
      ? `已保留完成的 ${completedTurns} 个回合；新的外部请求没有发出。`
      : `连续运行已经到达固定上限 ${AUTO_MODEL_TURN_COUNT} 回合。`;
  } catch (error) {
    showError(error);
  } finally {
    clearLoading(autoButton);
  }
});

stopAutoButton.addEventListener("click", () => {
  autoStopRequested = true;
  stopAutoButton.disabled = true;
  stopAutoButton.textContent = "本轮结算后停止";
  metaNode.textContent = "已请求停止；当前回合完成后不再发出下一次调用";
});

resetModelButton.addEventListener("click", async () => {
  setLoading(resetModelButton, "正在重置…", "reset");
  try {
    const result = await modelSessionClient.reset();
    if (result.displayedObservation) {
      renderRuntime({
        ...result.displayedObservation,
        runtime: result.displayedObservation,
        explanation: "人物会话已回到同一份冻结酒馆底座；重置没有调用模型。",
      }, { forceLatest: true });
    }
  } catch (error) {
    showError(error);
  } finally {
    clearLoading(resetModelButton);
  }
});

stageController.seek(INITIAL_RUNTIME, 0);
renderTimeline();
renderTurnDetail(null, -1);
updatePlaybackControls(0);
updateRunMeta();
updateConsentCopy();
updateModelSessionStatus();

const restoredModelObservation = modelSessionClient.snapshot().observation;
if (restoredModelObservation) {
  renderRuntime({
    ...restoredModelObservation,
    runtime: restoredModelObservation,
  }, { replay: false, forceLatest: true });
}

if (inspectorMedia.matches) {
  window.requestAnimationFrame(() => {
    stageWorkspace.scrollLeft = Math.max(0, (stageWorkspace.scrollWidth - stageWorkspace.clientWidth) / 2);
  });
}

void loadStatus();
