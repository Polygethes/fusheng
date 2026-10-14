#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { tavernCharacterAgentV2OutputSchemaForStage } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { createCompactStageWire, missingRequiredPaths } from "../src/server/pipeline/compactStageWire.mjs";
import { callGeminiCharacterStage } from "../src/server/ecology/geminiCharacterStage.mjs";

const args = process.argv.slice(2);
const arg = (flag, fallback = undefined) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const hasFlag = (flag) => args.includes(flag);

function redact(str) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return String(str);
  return String(str).replaceAll(key, "<REDACTED>");
}

function redactedError(msg) {
  process.stderr.write(redact(msg) + "\n");
}

function median(numbers) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function main() {
  const fromDir = arg("--from");
  if (!fromDir) {
    redactedError("Missing required argument --from <directory>");
    process.exit(1);
  }

  const targetPhase = arg("--phase", "awaiting_subjective_appraisal_and_candidates");
  const samplesLimit = Number(arg("--samples", "3"));
  const rounds = Number(arg("--rounds", "1"));
  const model = arg("--model", "gemini-3.8-flash-high");
  const responseFormat = arg("--response-format", "json_schema");
  const maxRequests = Number(arg("--max-requests", "12"));
  const outPath = arg("--out", path.join(os.tmpdir(), `compact-wire-benchmark-${Date.now()}.json`));
  const isRun = hasFlag("--run");

  const reportPath = path.join(fromDir, "report.json");
  if (!fs.existsSync(reportPath)) {
    redactedError(`Report not found at ${reportPath}`);
    process.exit(1);
  }

  const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8"));
  const calls = report.calls || [];

  const selectedSamples = [];
  for (const call of calls) {
    if (selectedSamples.length >= samplesLimit) break;
    if (call.phase !== targetPhase) continue;
    if (call.accepted !== true) continue;
    const indexStr = String(call.index).padStart(3, "0");
    const inputPath = path.join(fromDir, "calls", `${indexStr}.input.json`);
    if (!fs.existsSync(inputPath)) continue;

    const input = JSON.parse(await fs.promises.readFile(inputPath, "utf8"));
    const schema = tavernCharacterAgentV2OutputSchemaForStage(input);
    const wire = createCompactStageWire(schema);
    const canonicalBytes = Buffer.byteLength(JSON.stringify(schema), "utf8");
    const wireBytes = Buffer.byteLength(JSON.stringify(wire.schema), "utf8");
    const legendCount = wire.legend.length;

    selectedSamples.push({
      indexStr,
      input,
      schema,
      canonicalBytes,
      wireBytes,
      legendCount,
    });
  }

  for (const s of selectedSamples) {
    console.log(`${s.indexStr}: ${s.canonicalBytes} bytes -> ${s.wireBytes} bytes, ${s.legendCount} legend items`);
  }

  const plannedRequests = selectedSamples.length * rounds * 2;
  console.log(`planned requests: ${plannedRequests}`);

  if (!isRun) {
    process.exit(0);
  }

  if (plannedRequests > maxRequests) {
    redactedError(`Planned requests (${plannedRequests}) exceed --max-requests (${maxRequests}).`);
    process.exit(1);
  }

  if (!process.env.GEMINI_API_KEY) {
    redactedError("Missing GEMINI_API_KEY in environment.");
    process.exit(1);
  }

  const records = [];

  for (let r = 0; r < rounds; r++) {
    for (let s = 0; s < selectedSamples.length; s++) {
      const sampleItem = selectedSamples[s];
      const wires = ((r + s) % 2 === 0) ? ["canonical", "compact"] : ["compact", "canonical"];

      for (const wireMode of wires) {
        let ok = true;
        let errorCode = null;
        let elapsedMs = null;
        let attempts = null;
        let promptTokens = null;
        let completionTokens = null;
        let reasoningTokens = null;
        let outputChars = null;
        let missingRequired = null;

        try {
          const result = await callGeminiCharacterStage(sampleItem.input, {
            model,
            responseFormat,
            wire: wireMode,
            onResponse(res) {
              elapsedMs = res.elapsedMs ?? null;
              attempts = res.attempts ?? null;
              const raw = res.raw;
              if (raw) {
                if (raw.usage) {
                  promptTokens = raw.usage.prompt_tokens ?? null;
                  completionTokens = raw.usage.completion_tokens ?? null;
                  reasoningTokens = raw.usage.completion_tokens_details?.reasoning_tokens ?? null;
                } else if (raw.usageMetadata) {
                  promptTokens = raw.usageMetadata.promptTokenCount ?? null;
                  completionTokens = raw.usageMetadata.candidatesTokenCount ?? null;
                  reasoningTokens = raw.usageMetadata.thoughtsTokenCount ?? null;
                }
              }
            },
          });

          const outputKey = Object.keys(result).find((k) => k !== "stage");
          const restoredObj = result[outputKey];
          outputChars = JSON.stringify(restoredObj).length;
          missingRequired = missingRequiredPaths(sampleItem.schema, restoredObj).length;
        } catch (err) {
          ok = false;
          errorCode = err.code ?? null;
          if (err.attempts) attempts = err.attempts;
        }

        records.push({
          sample: s,
          round: r,
          wire: wireMode,
          ok,
          errorCode,
          elapsedMs,
          attempts,
          promptTokens,
          completionTokens,
          reasoningTokens,
          outputChars,
          missingRequired,
        });
      }
    }
  }

  await fs.promises.writeFile(outPath, JSON.stringify(records, null, 2) + "\n", { mode: 0o600 });

  for (const w of ["canonical", "compact"]) {
    const subset = records.filter((rec) => rec.wire === w);
    const successCount = subset.filter((rec) => rec.ok).length;
    const elapsedMedian = median(subset.filter((rec) => rec.elapsedMs != null).map((rec) => rec.elapsedMs));
    const completionMedian = median(subset.filter((rec) => rec.completionTokens != null).map((rec) => rec.completionTokens));
    const reasoningMedian = median(subset.filter((rec) => rec.reasoningTokens != null).map((rec) => rec.reasoningTokens));
    const visibleMedian = median(
      subset
        .filter((rec) => rec.completionTokens != null)
        .map((rec) => rec.completionTokens - (rec.reasoningTokens ?? 0))
    );
    const missingTotal = subset
      .filter((rec) => rec.missingRequired != null)
      .reduce((sum, rec) => sum + rec.missingRequired, 0);

    console.log(
      `[${w}] success: ${successCount}/${subset.length}, elapsed median: ${elapsedMedian}ms, completion median: ${completionMedian}, reasoning median: ${reasoningMedian}, visible median: ${visibleMedian}, missingRequired total: ${missingTotal}`
    );
  }
}

main().catch((err) => {
  redactedError(err.stack || err.message);
  process.exit(1);
});
