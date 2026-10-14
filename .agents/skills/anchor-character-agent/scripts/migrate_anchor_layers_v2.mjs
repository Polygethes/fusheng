#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compileCharacterFoundation } from "../../../../src/server/ecology/validatedCharacterAnchorRuntime.mjs";

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    result[key] = value;
    index += 1;
  }
  return result;
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function calibrationStatus(anchor, manifest) {
  if (anchor.status === "validated" && manifest.gates?.holdouts === "passed") return "validated";
  if (["calibrated", "validated"].includes(anchor.status) && manifest.gates?.calibration === "calibrated") return "calibrated";
  return "draft";
}

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root || ".codex/anchors");
const sceneId = String(args.scene || "").trim();
if (!sceneId) throw new Error("--scene is required");
const charactersDir = path.join(root, sceneId, "characters");
const characterIds = (await readdir(charactersDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const plans = [];
for (const characterId of characterIds) {
  const characterDir = path.join(charactersDir, characterId);
  const anchorPath = path.join(characterDir, "anchor-payload.json");
  const manifestPath = path.join(characterDir, "manifest.json");
  const runtimeMapPath = path.join(characterDir, "runtime-map.json");
  const foundationPath = path.join(characterDir, "character-foundation.json");
  const calibrationPath = path.join(characterDir, "calibration-evidence.json");
  if (await exists(foundationPath) || await exists(calibrationPath)) {
    throw new Error(`Separated layers already exist for ${characterId}; migration refuses to overwrite them`);
  }
  const [anchorText, manifestText, runtimeMapText] = await Promise.all([
    readFile(anchorPath, "utf8"),
    readFile(manifestPath, "utf8"),
    readFile(runtimeMapPath, "utf8"),
  ]);
  const anchor = JSON.parse(anchorText);
  const manifest = JSON.parse(manifestText);
  const runtimeMap = JSON.parse(runtimeMapText);
  const foundation = compileCharacterFoundation(anchor);
  const calibration = {
    schemaVersion: 1,
    recordType: "character-calibration-suite",
    characterId,
    status: calibrationStatus(anchor, manifest),
    source: {
      artifact: "anchor-payload.json",
      sha256: hash(anchorText),
      role: "authoring-and-audit-only",
    },
    controlledContrasts: structuredClone(anchor.validation?.calibrationScenarios || []),
    speechSamples: structuredClone(anchor.speechPolicy?.evidenceAnchors || []),
    relationshipCases: structuredClone(anchor.relationshipModel?.updateRules || []),
    holdouts: structuredClone(anchor.validation?.holdouts || []),
  };
  const migratedManifest = structuredClone(manifest);
  migratedManifest.schemaVersion = 2;
  migratedManifest.artifacts = {
    ...migratedManifest.artifacts,
    characterFoundation: "character-foundation.json",
    calibrationEvidence: "calibration-evidence.json",
  };
  const migratedRuntimeMap = structuredClone(runtimeMap);
  migratedRuntimeMap.schemaVersion = 2;
  migratedRuntimeMap.runtimeBoundary = {
    agentInputArtifactIds: ["characterFoundation", "memorySeed"],
    forbiddenAgentInputArtifactIds: ["anchorPayload", "calibrationEvidence", "holdouts"],
    compilerMayReadAuthoringArtifacts: true,
    agentReceivesCompiledProjectionOnly: true,
  };
  plans.push({
    characterId,
    foundationPath,
    calibrationPath,
    manifestPath,
    runtimeMapPath,
    foundation,
    calibration,
    migratedManifest,
    migratedRuntimeMap,
  });
}

for (const plan of plans) {
  await writeFile(plan.foundationPath, json(plan.foundation), { encoding: "utf8", flag: "wx" });
  await writeFile(plan.calibrationPath, json(plan.calibration), { encoding: "utf8", flag: "wx" });
  await writeFile(plan.manifestPath, json(plan.migratedManifest), "utf8");
  await writeFile(plan.runtimeMapPath, json(plan.migratedRuntimeMap), "utf8");
}

console.log(JSON.stringify({
  sceneId,
  migratedCharacters: plans.map((plan) => ({
    characterId: plan.characterId,
    foundationStatus: plan.foundation.status,
    calibrationStatus: plan.calibration.status,
  })),
}, null, 2));
