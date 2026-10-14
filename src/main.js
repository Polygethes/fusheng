import {
  getState,
  subscribe,
  resetState,
  importState,
  exportState,
  updateWorldSetup,
  applySetupWorld,
  applyGeneratedSetupWorld,
  beginNewWorldSetup,
  cancelNewWorldSetup,
  setActiveTab,
  setUi,
  setTransientUi,
  setPartialAcceptance,
  setInterventionDraft,
  addIntervention,
  toggleIntervention,
  deleteIntervention,
  clearInterventions,
  setActiveBranch,
  createBranchFromDraft,
  selectCharacter,
  toggleActiveCharacter,
  updateCharacter,
  updateCharacterNested,
  addCharacter,
  deleteCharacter,
  updateTown,
  updateLocation,
  recordObservedDraft,
  acceptDraft,
  acceptDraftWithOptions,
  undoCanonEvent,
  replayCanonEvent,
  setMemoryDraft,
  addCharacterMemory,
  updateCharacterMemory,
  mutateCharacterMemory,
  deleteCharacterMemory,
  createMemoryFromCanonEvent,
  setPlanDraft,
  addCharacterPlan,
  deleteCharacterPlan,
  selectCharacterPlan,
  updateCharacterPlan,
  regenerateCharacterPlan,
  freezeCharacterPlan,
  resetStoryWorkspace,
  saveStoryRevision,
  clearRuntimeSessionRef,
  commitRuntimeSessionResult,
  getRuntimeObservation,
  getRuntimeSessionRef,
  setRuntimeObservation,
  setRuntimeSessionRef,
} from "./state/store.js";
import { setSessionIdSalt } from "./data/seed.js";
import { buildSaveMetadata, prepareSavePayload, saveRepository } from "./state/saveSlots.js";
import { buildObservationEvents, inferPixelPreview, renderApp } from "./ui/render.js";
import { advanceObserverPlayback, buildInitialObserverPlayback } from "./ui/observerPlayback.js";
import { createLivePerformance, liveEventDelay, reduceLivePerformanceEvent } from "./ui/livePerformance.js";
import { hydratePixelPortraits } from "./ui/pixelPortrait.js";
import { setupAgentMindTooltip } from "./ui/agentMindTooltip.js";
import { createNpcActivityLoop, npcActivityIntervalMs } from "./ui/npcActivityLoop.js";
import { reconcileInkTavernStageDom } from "./ui/inkTavernStage.js";
import { downloadText, readFileAsText, toast } from "./ui/dom.js";
import { playNext } from "./engine/playService.js";
import { createV27SessionController } from "./engine/v27SessionController.js";
import { captureV27SaveState, restoreV27SaveState } from "./engine/v27SaveService.js";
import { buildSetupWorldForEngine } from "./engine/setupService.js";
import { pickRandomInjectedEvent } from "./worldbuilding/injectedEvents.js";

// Ids stay deterministic inside a session but never collide with ids persisted
// by an earlier session in localStorage.
setSessionIdSalt(Date.now().toString(36));

const app = document.querySelector("#app");
setupAgentMindTooltip(app);
const OBSERVER_PLAYBACK_MS = 1250;
let observerPlaybackTimer = null;
let activeLivePerformance = null;
let liveRenderFrame = null;
let saveOperationInFlight = false;
const v27SessionController = createV27SessionController({
  getState,
  getRuntimeSessionRef,
  setRuntimeSessionRef,
  clearRuntimeSessionRef,
  getRuntimeObservation,
  setRuntimeObservation,
  commitRuntimeSessionResult,
});

function isNpcActivityContext(state = getState()) {
  return Boolean(
    state.worldSetup?.fixedStage
    && state.ui?.engineMode === "v27"
    && ["observe", "reality"].includes(state.ui?.activeTab),
  );
}

async function runNpcActivityTurn() {
  if (saveOperationInFlight) throw new Error("存档操作完成后才能继续人物活动。");
  if (!isNpcActivityContext()) {
    const error = new Error("人物活动已停止：当前不在人物自决的客栈观察场。");
    error.code = "NPC_ACTIVITY_CONTEXT_INACTIVE";
    throw error;
  }
  setTransientUi({ v27Running: true, lastPlayError: "" });
  try {
    const result = await v27SessionController.runLocalTurn();
    setTransientUi({ lastPlayError: "" });
    return result;
  } catch (error) {
    setTransientUi({ lastPlayError: error?.message || "人物活动回合运行失败。" });
    throw error;
  } finally {
    setTransientUi({ v27Running: false });
  }
}

const npcActivityLoop = createNpcActivityLoop({
  runOnce: runNpcActivityTurn,
  intervalMs: npcActivityIntervalMs(getState().ui?.npcActivitySpeed),
  onStateChange(activity) {
    setTransientUi({
      npcActivityRunning: activity.running,
      npcActivityStatus: activity.running ? "running" : "stopped",
      v27Running: activity.inFlight,
    });
  },
  onError(error) {
    if (error?.code === "NPC_ACTIVITY_CONTEXT_INACTIVE") return;
    toast("人物活动已停下，请查看运行错误后再开始。");
  },
});

function stopNpcActivity({ announce = false } = {}) {
  const activity = npcActivityLoop.snapshot();
  if (!activity.running && !activity.scheduled) return false;
  npcActivityLoop.stop();
  if (announce) toast("人物会在当前回合结算后停下。");
  return true;
}

async function refreshSaveSlots() {
  setTransientUi({ saveSlotsStatus: "loading" });
  try {
    const saveSlots = await saveRepository.list();
    setTransientUi({ saveSlots, saveSlotsStatus: "ready" });
  } catch (error) {
    setTransientUi({ saveSlots: [], saveSlotsStatus: "error" });
    toast(`读取存档失败：${error.message}`);
  }
}

async function saveCurrentWorld({ id = "", name = "" } = {}) {
  return withSettledSaveOperation(async () => {
    const current = await captureV27SaveState(getState());
    return saveRepository.save({ id, name, payload: prepareSavePayload(current), metadata: buildSaveMetadata(current) });
  });
}

async function withSettledSaveOperation(operation) {
  if (saveOperationInFlight || getState().ui?.v27Running || activeLivePerformance?.status === "running") {
    throw new Error("请等待当前回合或存档操作完成后再试。");
  }
  stopNpcActivity();
  saveOperationInFlight = true;
  try { return await operation(); } finally { saveOperationInFlight = false; }
}

function flushLiveRender() {
  if (liveRenderFrame !== null && globalThis.cancelAnimationFrame) cancelAnimationFrame(liveRenderFrame);
  liveRenderFrame = null;
  setTransientUi({ livePerformance: activeLivePerformance });
}

function scheduleLiveRender() {
  if (!globalThis.requestAnimationFrame) {
    flushLiveRender();
    return;
  }
  if (liveRenderFrame !== null) return;
  liveRenderFrame = requestAnimationFrame(() => {
    liveRenderFrame = null;
    setTransientUi({ livePerformance: activeLivePerformance });
  });
}

function readSetupPromptsFromDom() {
  return {
    setupWorldPrompt: app.querySelector('[data-key="setupWorldPrompt"]')?.value || getState().ui.setupWorldPrompt || "",
    setupPeoplePrompt: app.querySelector('[data-key="setupPeoplePrompt"]')?.value || getState().ui.setupPeoplePrompt || "",
  };
}

function updatePixelPreviewFromDom() {
  const preview = inferPixelPreview(readSetupPromptsFromDom());
  const viewport = app.querySelector("[data-pixel-viewport]");
  if (!viewport) return;

  viewport.dataset.pixelTheme = preview.theme;
  viewport.dataset.pixelMapView = preview.view || "top-down";
  const title = app.querySelector("[data-pixel-preview-title]");
  if (title) title.textContent = preview.title;
  const copy = app.querySelector(".pixel-preview-copy");
  if (copy) copy.textContent = preview.town;
  const actors = app.querySelector("[data-pixel-preview-actors]");
  if (actors) actors.textContent = preview.actors.join("、");
  const objects = app.querySelector("[data-pixel-preview-objects]");
  if (objects) objects.textContent = preview.objects.join("、");
  const locations = app.querySelector("[data-pixel-preview-locations]");
  if (locations) locations.textContent = preview.locations.join("、");

  viewport.querySelectorAll("[data-pixel-person]").forEach((node, index) => {
    const actor = preview.actors[index] || "";
    node.dataset.pixelActor = actor;
    node.dataset.movementSource = "setup-preview";
    node.title = actor;
    const label = node.querySelector(".pixel-person-label");
    if (label) label.textContent = actor;
  });
  viewport.querySelectorAll("[data-plan-fixture]").forEach((node, index) => {
    const fixture = preview.objects[index % preview.objects.length] || "";
    node.dataset.planFixture = fixture;
    node.title = fixture;
  });
  const districts = preview.districts || preview.locations || [];
  viewport.querySelectorAll("[data-pixel-district]").forEach((node, index) => {
    const district = districts[index % districts.length] || "";
    node.dataset.pixelDistrict = district;
    node.dataset.planBlock = district;
    node.title = district;
  });
  const paths = preview.paths || [];
  viewport.querySelectorAll("[data-pixel-path]").forEach((node, index) => {
    const path = paths[index % paths.length] || "";
    node.dataset.pixelPath = path;
    node.dataset.planRoad = path;
    node.title = path;
  });
}

function render(state = getState()) {
  const preservedInkTavernStage = app.querySelector('[data-ink-tavern-game-stage="true"]');
  let stageParking = null;
  if (preservedInkTavernStage) {
    stageParking = document.createElement("div");
    stageParking.className = "ink-tavern-stage-parking";
    stageParking.setAttribute("aria-hidden", "true");
    document.body.append(stageParking);
    stageParking.append(preservedInkTavernStage);
  }
  app.innerHTML = renderApp(state);
  const nextInkTavernStage = app.querySelector('[data-ink-tavern-game-stage="true"]');
  if (preservedInkTavernStage && nextInkTavernStage) {
    reconcileInkTavernStageDom(preservedInkTavernStage, nextInkTavernStage);
    nextInkTavernStage.replaceWith(preservedInkTavernStage);
  }
  stageParking?.remove();
  hydratePixelPortraits(app, state.characters || []);
  const playback = state.ui?.observerPlayback;
  const liveStatus = state.ui?.livePerformance?.status;
  if (playback?.status === "playing" || playback?.status === "complete" || liveStatus === "running") {
    const stream = app.querySelector(".observer-stream");
    if (stream) stream.scrollTop = stream.scrollHeight;
  }
}

function stopObserverPlayback() {
  if (!observerPlaybackTimer) return;
  clearInterval(observerPlaybackTimer);
  observerPlaybackTimer = null;
}

function scheduleObserverPlayback(draftId) {
  stopObserverPlayback();
  observerPlaybackTimer = setInterval(() => {
    const state = getState();
    const playback = state.ui?.observerPlayback;
    if (!playback || playback.draftId !== draftId || playback.status !== "playing") {
      stopObserverPlayback();
      return;
    }
    const next = advanceObserverPlayback(playback);
    setUi({ observerPlayback: next });
    if (next.status !== "playing") stopObserverPlayback();
  }, OBSERVER_PLAYBACK_MS);
}

subscribe((state) => {
  npcActivityLoop.setIntervalMs(npcActivityIntervalMs(state.ui?.npcActivitySpeed));
  render(state);
});
render();
const startupPlayback = getState().ui?.observerPlayback;
if (startupPlayback?.status === "playing" && startupPlayback.draftId) {
  scheduleObserverPlayback(startupPlayback.draftId);
}
if (getState().ui?.activeTab === "saves") refreshSaveSlots();

app.addEventListener("input", (event) => {
  const target = event.target;
  if (
    target.dataset?.action === "ui-input"
    && ["setupWorldPrompt", "setupPeoplePrompt"].includes(target.dataset.key)
  ) {
    updatePixelPreviewFromDom();
  }
});

app.addEventListener("click", async (event) => {
  if (saveOperationInFlight) { toast("请等待存档操作完成。"); return; }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;

  if (action === "tab") {
    stopNpcActivity();
    const nextTab = button.dataset.tab;
    if (nextTab === "saves") {
      const currentTab = getState().ui?.activeTab || "reality";
      setUi({ activeTab: "saves", saveReturnTab: currentTab === "saves" ? "reality" : currentTab });
      await refreshSaveSlots();
    } else {
      setActiveTab(nextTab);
    }
  }

  if (action === "open-world-setup") {
    stopNpcActivity();
    beginNewWorldSetup();
  }

  if (action === "cancel-world-setup") {
    cancelNewWorldSetup();
  }

  if (action === "world-option") {
    updateWorldSetup({ [button.dataset.key]: button.dataset.value });
  }

  if (action === "setup-step") {
    setUi({ ...readSetupPromptsFromDom(), setupStep: button.dataset.step || "world" });
  }

  if (action === "setup-preset") {
    const current = readSetupPromptsFromDom();
    setUi({
      setupWorldPrompt: button.dataset.worldPrompt || current.setupWorldPrompt,
      setupPeoplePrompt: button.dataset.peoplePrompt || current.setupPeoplePrompt,
    });
  }

  if (action === "enter-simulation") {
    stopNpcActivity();
    const setupPrompts = readSetupPromptsFromDom();
    button.disabled = true;
    const previousText = button.textContent;
    button.textContent = "建镇中…";
    try {
      const response = await buildSetupWorldForEngine(setupPrompts, { engineMode: getState().ui.engineMode });
      applyGeneratedSetupWorld(response.generated, setupPrompts);
      const model = response.generated?.worldSetup?.modelGeneration?.model;
      const provider = response.provider === "local-skill" ? "本地 skill 建镇。" : model ? `模型建镇：${model}。` : "";
      toast(`已进入世界。${provider}点击开始观察，小镇会按当前时间粒度运行。`);
    } catch (error) {
      console.warn("Setup API failed, falling back to local worldbuilding.", error);
      applySetupWorld(setupPrompts);
      toast("已进入世界。服务端建镇不可用，已使用本地 skill 生成。点击开始观察，小镇会按当前时间粒度运行。");
    } finally {
      button.disabled = false;
      button.textContent = previousText;
    }
  }

  if (action === "select-character") {
    selectCharacter(button.dataset.id);
  }

  if (action === "toggle-active") {
    toggleActiveCharacter(button.dataset.id);
  }

  if (action === "delete-character") {
    if (confirm("删除这个人物？相关关系也会被删除。")) deleteCharacter(button.dataset.id);
  }

  if (action === "select-location") {
    setUi({ selectedLocationId: button.dataset.id });
  }

  if (action === "story-reset") {
    resetStoryWorkspace(button.dataset.id || null);
    toast("已恢复现实素材。");
  }

  if (action === "inspect-tavern-actor") {
    const actor = button.closest("[data-stage-actor]");
    const inspector = button.querySelector("[data-actor-inspector]");
    const willOpen = button.getAttribute("aria-expanded") !== "true";
    actor?.parentElement?.querySelectorAll('[data-action="inspect-tavern-actor"][aria-expanded="true"]')
      .forEach((other) => {
        if (other === button) return;
        other.setAttribute("aria-expanded", "false");
        const otherInspector = other.querySelector("[data-actor-inspector]");
        if (otherInspector) otherInspector.hidden = true;
      });
    button.setAttribute("aria-expanded", willOpen ? "true" : "false");
    if (inspector) inspector.hidden = !willOpen;
    return;
  }

  if (action === "toggle-npc-activity") {
    stopObserverPlayback();
    const activity = npcActivityLoop.snapshot();
    if (activity.running) {
      stopNpcActivity({ announce: true });
    } else if (isNpcActivityContext()) {
      setTransientUi({ lastPlayError: "" });
      npcActivityLoop.start();
      toast("人物开始在客栈中活动。再次点击可停止。");
    }
    return;
  }

  if (action === "play" && getState().ui.engineMode === "v27") {
    stopObserverPlayback();
    button.disabled = true;
    const previousText = button.textContent;
    button.textContent = "运行中…";
    setTransientUi({ v27Running: true, lastPlayError: "" });
    try {
      // The main UI runs the local atomic Character Agent fixture, which calls no provider.
      // A model run spends the authorized request budget and stays behind the
      // dedicated observation page's explicit consent control.
      const { observation, displayedObservation } = await v27SessionController.runLocalTurn();
      setUi({ v27Running: false, lastPlayError: "" });
      const latestTurns = observation.turns || [];
      const settled = latestTurns.filter((turn) => turn.outcome.status === "settled").length;
      toast(`${latestTurns.length} 个人物回合完成，${settled} 次被世界接住；当前共保留 ${displayedObservation.turns.length} 回合。本地夹具未调用外部模型。`);
    } catch (error) {
      setUi({ v27Running: false, lastPlayError: error?.message || "v2.7 运行时调用失败。" });
      toast("v2.7 运行时调用失败。");
    } finally {
      button.disabled = false;
      button.textContent = previousText;
    }
    return;
  }

  if (action === "play") {
    stopObserverPlayback();
    button.disabled = true;
    const previousText = button.textContent;
    button.textContent = "生成中…";
    try {
      const sourceState = getState();
      const focusLocation = sourceState.ui.focusMode === "location"
        ? sourceState.locations.find((location) => location.id === sourceState.ui.selectedLocationId) || sourceState.locations[0]
        : null;
      activeLivePerformance = createLivePerformance({
        locationName: focusLocation?.name || sourceState.town?.name || "",
        grain: sourceState.ui.timeGrain,
      });
      setTransientUi({
        lastPlayError: "",
        observerPlayback: null,
        livePerformance: activeLivePerformance,
      });
      const draft = await playNext(sourceState, {
        onEvent: async (streamEvent) => {
          activeLivePerformance = reduceLivePerformanceEvent(activeLivePerformance, streamEvent);
          if (streamEvent.type === "novel_delta") scheduleLiveRender();
          else flushLiveRender();
          const delay = liveEventDelay(streamEvent);
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        },
      });
      const totalCount = buildObservationEvents(draft, sourceState).length;
      flushLiveRender();
      const playback = sourceState.ui.engineMode === "openai"
        ? { draftId: draft.id, visibleCount: totalCount, totalCount, status: "complete" }
        : buildInitialObserverPlayback(draft, totalCount);
      recordObservedDraft(draft);
      activeLivePerformance = {
        ...(activeLivePerformance || createLivePerformance()),
        status: "complete",
        phase: "complete",
        draftId: draft.id,
        label: "演出完成",
      };
      setUi({
        lastPlayError: "",
        observerPlayback: playback,
        livePerformance: activeLivePerformance,
      });
      if (playback.status === "playing") scheduleObserverPlayback(draft.id);
      const warning = draft.providerWarning ? `（${draft.providerWarning}）` : "";
      toast(`观察开始。事件会按时间流逐条出现，并写入小镇状态。${warning}`);
    } catch (error) {
      flushLiveRender();
      const modelStageError = error?.kind === "model_stage";
      activeLivePerformance = {
        ...(activeLivePerformance || createLivePerformance()),
        status: modelStageError ? "error" : "interrupted",
        phase: modelStageError ? "error" : "interrupted",
        errorKind: error?.kind || "connection",
        errorStage: error?.stage || "",
        label: modelStageError ? "DeepSeek 阶段失败 · 现场已保留" : "连接中断 · 现场已保留",
      };
      setUi({
        lastPlayError: error?.message || String(error),
        livePerformance: activeLivePerformance,
      });
      toast("连接或模型调用中断，当前观察内容已经保留。 ");
    } finally {
      button.disabled = false;
      button.textContent = previousText;
    }
  }

  if (action === "accept-draft") {
    const state = getState();
    const draft = state.draftScenes.find((item) => item.id === state.ui.lastDraftId) || state.draftScenes[0];
    if (!draft) return;
    acceptDraft(draft.id, draft.updateBundle);
    toast("已完整写入正史。人物状态、关系、证据与谣言已更新。");
  }

  if (action === "accept-partial-draft") {
    const state = getState();
    const draft = state.draftScenes.find((item) => item.id === state.ui.lastDraftId) || state.draftScenes[0];
    if (!draft) return;
    acceptDraftWithOptions(draft.id, draft.updateBundle, state.ui.partialAcceptance);
    toast("已部分写入正史。未勾选状态不会更新。");
  }

  if (action === "branch-select" || action === "switch-branch") {
    stopNpcActivity();
    setActiveBranch(button.dataset.id);
    toast("已切换分支并恢复该分支的独立状态快照。");
  }

  if (action === "fork-draft") {
    const state = getState();
    const draft = state.draftScenes.find((item) => item.id === state.ui.lastDraftId) || state.draftScenes[0];
    if (!draft) return;
    createBranchFromDraft(draft.id);
    toast("已从当前草稿开出独立状态分支。");
  }


  if (action === "undo-canon") {
    if (!confirm("撤销这条正史并恢复到它发生前？后续状态会回到该快照。")) return;
    const marker = undoCanonEvent(button.dataset.id);
    toast(marker ? "已撤销正史，并留下重演标记。" : "撤销失败：没有找到可恢复快照。");
  }

  if (action === "replay-canon") {
    const event = replayCanonEvent(button.dataset.id);
    toast(event ? "已切到操盘台。可以注入新干预后播放重演。" : "没有找到可重演事件。");
  }

  if (action === "undo-and-replay") {
    if (!confirm("撤销这条正史并切到操盘台重演？")) return;
    const marker = undoCanonEvent(button.dataset.id);
    if (marker) replayCanonEvent(marker.id);
    toast(marker ? "已撤销并准备重演。" : "撤销失败：没有找到可恢复快照。");
  }

  if (action === "ui-select-button") {
    if (button.dataset.key === "engineMode" && button.dataset.value !== "v27") stopNpcActivity();
    setUi({ [button.dataset.key]: button.dataset.value });
  }


  if (action === "detail-mode") {
    setUi({ detailMode: button.dataset.mode });
  }

  if (action === "inject-random-event") {
    const injectedEvent = pickRandomInjectedEvent(getState());
    setUi({ injectedEvent });
    toast("已注入意外事件。点击播放生效。 ");
  }

  if (action === "select-memory") {
    setUi({ selectedMemoryId: button.dataset.id });
  }

  if (action === "mutate-memory") {
    mutateCharacterMemory(button.dataset.id, button.dataset.mode || "distort");
    toast("已改变这段记忆的准确性/可见性。下一次播放会把它作为人物偏置。 ");
  }

  if (action === "delete-memory") {
    if (confirm("删除这段人物记忆？")) {
      deleteCharacterMemory(button.dataset.id);
      toast("已删除人物记忆。 ");
    }
  }

  if (action === "memory-fill-from-selected") {
    const st = getState();
    const source = st.canonEvents[0] || st.evidence[0] || st.rumors[0];
    if (source) {
      setMemoryDraft({
        text: `人物把“${source.title || source.content || source.summary || "某个事件"}”记成了能继续行动的私人版本：它既像证据，也像借口。`,
        sourceType: source.summary ? "canon" : source.canBeMisreadAs ? "evidence" : "rumor",
        sourceId: source.id,
      });
      toast("已用当前正史/证据填充记忆草稿。 ");
    }
  }


  if (action === "plan-freeze" || action === "freeze-plan") {
    freezeCharacterPlan(button.dataset.id);
    toast("已冻结/解冻该人物的自主计划。 ");
  }

  if (action === "plan-regenerate" || action === "regenerate-plan") {
    regenerateCharacterPlan(button.dataset.id);
    toast("已重建该人物的自主计划。 ");
  }

  if (action === "select-plan") {
    setUi({ selectedPlanId: button.dataset.id });
  }

  if (action === "toggle-intervention") {
    toggleIntervention(button.dataset.id);
    toast("已切换干预启用状态。 ");
  }

  if (action === "delete-intervention") {
    deleteIntervention(button.dataset.id);
    toast("已删除操盘干预。 ");
  }

  if (action === "clear-interventions") {
    if (confirm("清空当前分支的全部操盘干预？")) {
      clearInterventions();
      toast("已清空操盘干预。 ");
    }
  }

  if (action === "delete-memory") {
    if (confirm("删除这段人物记忆？")) {
      deleteCharacterMemory(button.dataset.id);
      toast("已删除人物记忆。 ");
    }
  }

  if (action === "memory-from-canon") {
    const memory = createMemoryFromCanonEvent(button.dataset.id, getState().ui.memoryCharacterId);
    toast(memory ? "已把正史转成该人物的私人记忆。 " : "没有找到正史事件。 ");
  }

  if (action === "add-plan") {
    const plan = addCharacterPlan({});
    toast(plan ? "已添加自主计划。 " : "添加失败：未找到人物。 ");
  }

  if (action === "select-plan") {
    selectCharacterPlan(button.dataset.id);
    toast("已选择该计划。 ");
  }

  if (action === "delete-plan") {
    if (confirm("删除这条自主计划？")) {
      deleteCharacterPlan(button.dataset.id);
      toast("已删除自主计划。 ");
    }
  }

  if (action === "export-state") {
    downloadText(`character-town-state-${Date.now()}.json`, exportState());
  }

  if (action === "load-save") {
    if (!confirm("读取这个存档并替换当前世界？")) return;
    try {
      await withSettledSaveOperation(async () => {
        const saved = await saveRepository.load(button.dataset.id);
        const restored = await restoreV27SaveState(saved.payload);
        activeLivePerformance = null;
        importState(JSON.stringify(restored), { preserveRuntimeIdentity: true });
        toast(`已读取“${saved.name}”。`);
      });
    } catch (error) {
      alert(`读取失败：${error.message}`);
    }
  }

  if (action === "overwrite-save") {
    const current = getState();
    const save = (current.ui?.saveSlots || []).find((item) => item.id === button.dataset.id);
    if (!save || !confirm(`用当前世界覆盖“${save.name}”？`)) return;
    try {
      await saveCurrentWorld({ id: save.id, name: save.name });
      await refreshSaveSlots();
      toast(`已覆盖“${save.name}”。`);
    } catch (error) {
      alert(`覆盖失败：${error.message}`);
    }
  }

  if (action === "delete-save") {
    const current = getState();
    const save = (current.ui?.saveSlots || []).find((item) => item.id === button.dataset.id);
    if (!save || !confirm(`删除“${save.name}”？`)) return;
    try {
      await saveRepository.delete(save.id);
      await refreshSaveSlots();
      toast(`已删除“${save.name}”。`);
    } catch (error) {
      alert(`删除失败：${error.message}`);
    }
  }

  if (action === "reset-state") {
    if (confirm("重置会清空当前本地状态，确认？")) {
      stopNpcActivity();
      resetState();
      toast("已重置到种子状态。 ");
    }
  }
});

app.addEventListener("change", async (event) => {
  if (saveOperationInFlight) return;
  const target = event.target;
  const action = target.dataset.action;
  if (!action) return;

  if (action === "import-state") {
    const file = target.files?.[0];
    if (!file) return;
    try {
      stopNpcActivity();
      const text = await readFileAsText(file);
      importState(text);
      toast("导入完成。 ");
    } catch (error) {
      alert(`导入失败：${error.message}`);
    }
  }

  if (action === "ui-select") {
    if (target.dataset.key === "engineMode" && target.value !== "v27") stopNpcActivity();
    setUi({ [target.dataset.key]: target.value });
  }

  if (action === "story-source") {
    resetStoryWorkspace(target.value);
  }

  if (action === "ui-checkbox") {
    setUi({ [target.dataset.key]: Boolean(target.checked) });
  }

  if (action === "partial-accept") {
    setPartialAcceptance(target.dataset.key, target.checked);
  }

  if (action === "ui-range") {
    setUi({ [target.dataset.key]: Number(target.value) });
  }

  if (action === "memory-draft" || action === "memory-draft-range") {
    const value = action === "memory-draft-range" ? Number(target.value) : target.value;
    setMemoryDraft({ [target.dataset.key]: value });
  }

  if (action === "memory-edit" || action === "memory-edit-range") {
    const value = action === "memory-edit-range" ? Number(target.value) : target.value;
    updateCharacterMemory(target.dataset.id, { [target.dataset.key]: value });
  }

  if (action === "plan-select" || action === "plan-range" || action === "plan-edit-range") {
    const value = action === "plan-range" || action === "plan-edit-range" ? Number(target.value) : target.value;
    updateCharacterPlan(target.dataset.id, { [target.dataset.key]: value });
  }

  if (action === "plan-draft" || action === "plan-draft-range") {
    const value = action === "plan-draft-range" ? Number(target.value) : target.value;
    setPlanDraft({ [target.dataset.key]: value });
  }

  if (action === "memory-draft" || action === "memory-draft-range") {
    const value = action === "memory-draft-range" ? Number(target.value) : target.value;
    setMemoryDraft({ [target.dataset.key]: value });
  }

  if (action === "memory-source-select") {
    const [sourceType, sourceId] = String(target.value || "manual:").split(":");
    setMemoryDraft({ sourceType: sourceType || "manual", sourceId: sourceId || "" });
  }


  if (action === "plan-select" || action === "plan-range" || action === "plan-edit-range") {
    const value = action === "plan-range" || action === "plan-edit-range" ? Number(target.value) : target.value;
    updateCharacterPlan(target.dataset.id, { [target.dataset.key]: value });
  }

  if (action === "intervention-draft" || action === "intervention-draft-range") {
    const value = action === "intervention-draft-range" ? Number(target.value) : target.value;
    setInterventionDraft({ [target.dataset.key]: value });
  }

  if (action === "character-state") {
    const id = target.dataset.id;
    const key = target.dataset.key;
    const value = Number(target.value);
    updateCharacter(id, (character) => ({ currentState: { ...character.currentState, [key]: value } }));
  }
});

app.addEventListener("focusout", (event) => {
  const target = event.target;
  const action = target.dataset.action;
  if (!action) return;

  if (action === "ui-input") {
    setUi({ [target.dataset.key]: target.value });
  }

  if (action === "memory-draft") {
    setMemoryDraft({ [target.dataset.key]: target.value });
  }

  if (action === "memory-draft") {
    setMemoryDraft({ [target.dataset.key]: target.value });
  }

  if (action === "memory-edit") {
    updateCharacterMemory(target.dataset.id, { [target.dataset.key]: target.value });
  }

  if (action === "plan-edit") {
    updateCharacterPlan(target.dataset.id, { [target.dataset.key]: target.value });
  }

  if (action === "plan-draft") {
    setPlanDraft({ [target.dataset.key]: target.value });
  }


  if (action === "plan-edit") {
    updateCharacterPlan(target.dataset.id, { [target.dataset.key]: target.value });
  }

  if (action === "intervention-draft") {
    setInterventionDraft({ [target.dataset.key]: target.value });
  }

  if (action === "character-field") {
    updateCharacter(target.dataset.id, { [target.dataset.key]: target.value });
  }

  if (action === "character-nested") {
    updateCharacterNested(target.dataset.id, target.dataset.path, target.value);
  }

  if (action === "town-field") {
    updateTown({ [target.dataset.key]: target.value });
  }

  if (action === "location-field") {
    updateLocation(target.dataset.id, { [target.dataset.key]: target.value });
  }
});

app.addEventListener("submit", async (event) => {
  if (saveOperationInFlight) { event.preventDefault(); return; }
  if (event.target.id === "save-world-form") {
    event.preventDefault();
    const data = new FormData(event.target);
    const name = String(data.get("name") || "").trim();
    const submit = event.target.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const saved = await saveCurrentWorld({ name });
      await refreshSaveSlots();
      toast(`已保存“${saved.name}”。`);
    } catch (error) {
      alert(`保存失败：${error.message}`);
    } finally {
      if (submit) submit.disabled = false;
    }
    return;
  }

  if (event.target.id === "story-editor-form") {
    event.preventDefault();
    const data = new FormData(event.target);
    const revision = saveStoryRevision({
      sourceDraftId: String(data.get("sourceDraftId") || "") || null,
      sourceText: String(data.get("sourceText") || ""),
      title: String(data.get("title") || "").trim(),
      mode: String(data.get("mode") || "close-third"),
      rewriteText: String(data.get("rewriteText") || "").trim(),
    });
    toast(revision ? "故事稿已保存。现实状态没有改变。" : "没有可保存的正文。");
    return;
  }

  if (event.target.id === "memory-form") {
    event.preventDefault();
    const data = new FormData(event.target);
    addCharacterMemory({
      characterId: String(data.get("characterId") || ""),
      targetCharacterId: String(data.get("targetCharacterId") || "") || null,
      type: String(data.get("type") || "selective"),
      stance: String(data.get("stance") || "self_defense"),
      content: String(data.get("content") || "").trim(),
      publicVersion: String(data.get("publicVersion") || "").trim(),
      privateVersion: String(data.get("privateVersion") || "").trim(),
      distortion: String(data.get("distortion") || "").trim(),
      reliability: Number(data.get("reliability") || 55),
      heat: Number(data.get("heat") || 60),
    });
    toast("已写入角色记忆。它会随当前分支保存，并进入证据图谱。 ");
    return;
  }

  if (event.target.id === "operator-intervention-form") {
    event.preventDefault();
    const data = new FormData(event.target);
    addIntervention({
      type: String(data.get("type") || "force_action"),
      action: String(data.get("action") || "misread"),
      targetCharacterId: String(data.get("targetCharacterId") || ""),
      secondaryCharacterId: String(data.get("secondaryCharacterId") || ""),
      instruction: String(data.get("instruction") || "").trim(),
      intensity: Number(data.get("intensity") || 60),
      persistence: String(data.get("persistence") || "next_play"),
    });
    toast("已加入操盘干预。下一次播放会写入人物行动。 ");
    return;
  }

  if (event.target.id !== "new-character-form") return;
  event.preventDefault();
  const data = new FormData(event.target);
  addCharacter({
    name: String(data.get("name") || "").trim(),
    publicIdentity: String(data.get("publicIdentity") || "").trim(),
    concept: String(data.get("concept") || "").trim(),
  });
  toast("已生成新角色卡。 ");
});

globalThis.addEventListener?.("pagehide", () => {
  npcActivityLoop.stop();
});
