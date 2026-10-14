import { playNext as playWithMock } from "../engine/mockEngine.js";
import { playWithOpenAIPipeline } from "./pipeline/openaiPipeline.mjs";
import { currentModel, currentProviderConfig } from "./pipeline/responseClient.mjs";
import { resolveCharacterModelEnvironment } from "./modelEnvironment.mjs";

/**
 * A run is model-backed only when the operator supplied BOTH a key and an
 * explicit model. A key alone used to be enough because the model name was
 * inferred from the base URL; that inference is gone, so a key without a model
 * now correctly resolves to the deterministic path instead of guessing.
 */
function hasOpenAIKey() {
  return Boolean(currentProviderConfig().apiKey) && Boolean(currentModel());
}

function resolvedPipelineMode(value = "") {
  const requested = value || process.env.CHARACTER_TOWN_PIPELINE_MODE || "balanced";
  if (requested === "quality" || requested === "fast" || requested === "live") return requested;
  return "balanced";
}

function pipelineLabel(provider, pipelineMode = resolvedPipelineMode()) {
  return provider === "openai-pipeline"
    ? (pipelineMode === "quality"
      ? "OpenAI CharacterPrivateSimulator→CognitiveReactionGate→AgentDialogue→OpenAI VisibilityLayer→OpenAI SceneInteractionSimulator→OpenAI DepthAuditor→RepairPass→StateArchivist"
      : pipelineMode === "balanced"
        ? "OpenAI CharacterPrivateSimulator→CognitiveReactionGate→AgentDialogue→LocalVisibility→OpenAI SceneInteractionSimulator→OpenAI NovelStreamer + SelectivePsychology/LocalAudit→StateArchivist"
        : pipelineMode === "live"
          ? "OpenAI CharacterPrivateSimulator→OpenAI LiveTurnLoop→LocalVisibility→OpenAI SceneInteractionSimulator→OpenAI NovelStreamer + SelectivePsychology/LocalAudit→StateArchivist"
          : "OpenAI CharacterPrivateSimulator→CognitiveReactionGate→AgentDialogue→LocalVisibility→OpenAI SceneInteractionSimulator→OpenAI NovelStreamer + LocalPsychology/LocalAudit→StateArchivist")
    : "MockPrivateSimulator(CharacterPrivateSimulator mock)→MockVisibilityLayer(VisibilityLayer mock)→MockSceneInteractionSimulator(SceneInteractionSimulator mock)→DepthAuditor→StateArchivist";
}

export function modelStatus(modeOverride = null) {
  const requested = modeOverride || process.env.CHARACTER_TOWN_MODEL_MODE || "auto";
  const openaiConfigured = hasOpenAIKey();
  const resolvedProvider = requested === "mock" ? "mock" : (openaiConfigured ? "openai-pipeline" : "mock");
  const pipelineMode = resolvedPipelineMode();
  return {
    ok: true,
    service: "character-town-mvp-v12",
    version: "1.2.0",
    availableModes: ["mock", "openai", "auto"],
    defaultMode: requested,
    provider: resolvedProvider,
    openaiConfigured,
    openaiModel: currentModel(),
    characterModel: (() => {
      const resolved = resolveCharacterModelEnvironment(process.env);
      return {
        transport: resolved.transport,
        model: resolved.model,
        source: resolved.reason,
        agentShell: resolved.shell.present ? resolved.shell.label : "",
        concurrency: resolved.concurrency,
        label: resolved.displayLabel,
      };
    })(),
    pipelineMode,
    pipeline: pipelineLabel(resolvedProvider, pipelineMode),
    simulationFocus: "xiaoyaoyou-tavern-life",
    fixedStage: { id: "loc_xyy_tavern", name: "望梯酒馆" },
    tavernPipeline: resolvedProvider === "openai-pipeline"
      ? "Scene/Beat:CausalAgentScene(Action→Impact→SpatialPropagation→PrivateAppraisal→NextAgent→Commit) | Day/Week:MacroTrigger→CausalAgentScene→Commit→AdvanceClock→CanonicalActionLedger"
      : "TavernLifeKernel→ConsequenceLedger→NarrativeDetector→StateArchivist",
    tavernRemoteCalls: resolvedProvider === "openai-pipeline" ? { scene: 12, day: 30, week: 175 } : { scene: 0, day: 0, week: 0 },
    remoteCallsForThreeCharacters: resolvedProvider === "openai-pipeline" ? (pipelineMode === "fast" ? 5 : pipelineMode === "balanced" ? 6 : pipelineMode === "live" ? 14 : 11) : 0,
    repairEnabled: pipelineMode === "quality" && process.env.CHARACTER_TOWN_DISABLE_REPAIR !== "1",
  };
}

export async function playFromServer(state, options = {}) {
  const requestedMode = options.mode || state?.ui?.engineMode || process.env.CHARACTER_TOWN_MODEL_MODE || "auto";
  const mode = requestedMode === "auto" ? (hasOpenAIKey() ? "openai" : "mock") : requestedMode;
  const pipelineMode = resolvedPipelineMode(options.pipelineMode);
  if (mode === "openai") {
    try {
      return await playWithOpenAIPipeline(state, { ...options, pipelineMode });
    } catch (error) {
      if (options.allowFallback === false) throw error;
      const draft = playWithMock(state);
      draft.provider = "mock-fallback";
      draft.providerWarning = error?.message || String(error);
      draft.branchId = state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
      draft.engineMeta = {
        mode: "mock-fallback",
        failedProvider: "openai-pipeline",
        error: error?.message || String(error),
        pipeline: pipelineLabel("mock", pipelineMode),
        stages: [{ name: "MockFallback", provider: "local" }],
      };
      return draft;
    }
  }
  const draft = playWithMock(state);
  draft.provider = "mock";
  draft.branchId = state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
  draft.engineMeta = {
    mode: "mock",
    pipeline: pipelineLabel("mock", pipelineMode),
    stages: [
      { name: "MockPrivateSimulator", provider: "local" },
      { name: "MockVisibilityLayer", provider: "local" },
      { name: "MockSceneInteractionSimulator", provider: "local" },
      { name: "DepthAuditor", provider: "local" },
      { name: "StateArchivist", provider: "local" },
    ],
  };
  return draft;
}
