import { tavernCharacterAgentV2OutputSchemaForStage } from "../pipeline/tavernCharacterAgentV2.mjs";
import { buildV27RelayModelRequest } from "../pipeline/v27RelayModelRequest.mjs";
import { openAIJsonCharacterModelStageDefinition } from "./openAIJsonCharacterModelProvider.mjs";
import { callModelJson, geminiResponseSchema } from "../model/modelClient.mjs";
import { createCompactStageWire, compactWireLegendText } from "../pipeline/compactStageWire.mjs";

export { geminiResponseSchema };

/** How long one attempt at a stage may take before it is abandoned and retried. */
export function stageTimeoutMs(phase) {
  if (phase === "awaiting_performance_beat") return 45_000;
  if (phase === "awaiting_day_schedule") return 90_000;
  return 180_000;
}

export async function callGeminiCharacterStage(stageInput, {
  apiKey = process.env.GEMINI_API_KEY,
  model = "gemini-3.8-flash",
  thinkingLevel = "medium",
  apiBaseUrl = process.env.GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com",
  responseFormat = "json_schema",
  previousOutput = null,
  fetchImpl = fetch,
  signal,
  timeoutMs = stageTimeoutMs(stageInput.phase),
  sleep,
  onRequest,
  onResponse,
  wire = "canonical",
} = {}) {
  const promptStage = ["awaiting_performance_beat", "awaiting_day_schedule"].includes(stageInput.phase);
  const definition = promptStage ? { outputKey: stageInput.outputKey || "performance" } : openAIJsonCharacterModelStageDefinition(stageInput);
  if (!definition) throw Object.assign(new Error("Unsupported character phase."), { code: "GEMINI_CHARACTER_PHASE_INVALID" });

  const useCompact = !promptStage && wire === "compact";
  let stageWire = null;
  let canonicalSchema = null;
  if (!promptStage) {
    canonicalSchema = tavernCharacterAgentV2OutputSchemaForStage(stageInput);
    if (useCompact) {
      stageWire = createCompactStageWire(canonicalSchema);
    }
  }

  const request = promptStage
    ? { systemPrompt: stageInput.prompt.system, userPrompt: stageInput.prompt.user, schema: stageInput.schema }
    : buildV27RelayModelRequest({ stageInput, schema: useCompact ? stageWire.schema : canonicalSchema });

  if (useCompact && stageWire.legend.length > 0) {
    const legendText = compactWireLegendText(stageWire.legend);
    if (legendText) {
      request.userPrompt += `\n\n${legendText}`;
    }
  }

  if (promptStage && stageInput.protocolRepairFeedback) {
    request.userPrompt += `\n\n你上一次的回答没有通过检查：${JSON.stringify(stageInput.protocolRepairFeedback.issues)}。照着同样的人物心思，改正后完整地重新回答。`;
  }
  if (!promptStage && stageInput.protocolRepairFeedback && previousOutput !== null) {
    const formattedPrevious = (useCompact && typeof previousOutput === "object")
      ? JSON.stringify(stageWire.compact(previousOutput))
      : JSON.stringify(previousOutput);
    request.userPrompt += `\n\nYour previous response for THIS SAME character, turn and stage was rejected. Repair that response against the listed violations and return the complete corrected object. Preserve your other valid decisions; do not regenerate unrelated content.\n${formattedPrevious}`;
  }

  const result = await callModelJson(request, {
    apiKey,
    model,
    thinkingLevel,
    apiBaseUrl,
    responseFormat,
    fetchImpl,
    signal,
    timeoutMs,
    ...(sleep !== undefined ? { sleep } : {}),
    onRequest,
    onResponse,
  });

  if (useCompact) {
    return {
      [definition.outputKey]: stageWire.expand(result.output),
      stage: { ...result.stage, wire: "compact" },
    };
  }

  return { [definition.outputKey]: result.output, stage: result.stage };
}
