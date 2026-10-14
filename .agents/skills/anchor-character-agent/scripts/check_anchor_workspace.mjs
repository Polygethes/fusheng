#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

const GATES = ["draft", "calibrated", "validated", "runtime", "behavior"];
const REQUIRED_RUNTIME_SURFACES = [
  "sceneFacts",
  "psychology",
  "voice",
  "relationships",
  "memory",
  "presence",
  "candidateCompilation",
  "validation",
];
const REQUIRED_BEHAVIOR_CATEGORIES = [
  "agent_non_top_choice",
  "unresolved_desire_survives_delay",
  "rumor_differs_from_direct_knowledge",
  "private_zone_blocks_propagation",
  "relationship_changes_expression_not_desire",
  "voice_changes_by_function",
  "body_state_changes_behavior",
  "non_luozhao_portability",
];
const FORBIDDEN_POSITION_ANSWER_KEYS = [
  "characterFit",
  "bestFor",
  "preferred",
  "preferredPositionId",
  "expectedChoice",
  "rank",
  "score",
  "utility",
];
const FORBIDDEN_SERVICE_ANSWER_KEYS = [
  "chosen",
  "chosenOfferId",
  "expectedAction",
  "expectedChoice",
  "preferred",
  "preferredOfferId",
  "rank",
  "recommendation",
  "score",
  "utility",
];
const SERVICE_TRANSACTION_PHASES = [
  "request",
  "operator_response",
  "fulfillment",
  "settlement",
];

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    result[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

async function readJsonOptional(target) {
  try {
    return await readJson(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function add(errors, condition, code, message) {
  if (!condition) errors.push({ code, message });
}

function gateAtLeast(requested, expected) {
  return GATES.indexOf(requested) >= GATES.indexOf(expected);
}

function containsOwnKey(value, forbiddenKey) {
  if (!value || typeof value !== "object") return false;
  if (Object.hasOwn(value, forbiddenKey)) return true;
  return Object.values(value).some((child) => containsOwnKey(child, forbiddenKey));
}

const args = parseArgs(process.argv.slice(2));
const sceneId = String(args.scene || "").trim();
const characterId = String(args.character || "").trim();
const requestedGate = String(args.gate || "draft").trim();
if (!sceneId || !characterId) throw new Error("--scene and --character are required");
if (!GATES.includes(requestedGate)) throw new Error(`--gate must be one of ${GATES.join(", ")}`);

const root = path.resolve(args.root || ".codex/anchors");
const sceneDir = path.join(root, sceneId);
const characterDir = path.join(sceneDir, "characters", characterId);
const [scene, manifest, anchor, memory, runtimeMap, separatedFoundation, separatedCalibration] = await Promise.all([
  readJson(path.join(sceneDir, "scene-contract.json")),
  readJson(path.join(characterDir, "manifest.json")),
  readJson(path.join(characterDir, "anchor-payload.json")),
  readJson(path.join(characterDir, "memory-seed.json")),
  readJson(path.join(characterDir, "runtime-map.json")),
  readJsonOptional(path.join(characterDir, "character-foundation.json")),
  readJsonOptional(path.join(characterDir, "calibration-evidence.json")),
]);
const foundation = separatedFoundation || anchor;
const calibration = separatedCalibration || {
  characterId: anchor.characterId,
  controlledContrasts: anchor.validation?.calibrationScenarios || [],
  speechSamples: anchor.speechPolicy?.evidenceAnchors || [],
  relationshipCases: anchor.relationshipModel?.updateRules || [],
  holdouts: anchor.validation?.holdouts || [],
};
const usesSeparatedLayers = Boolean(separatedFoundation || separatedCalibration);
const errors = [];

add(errors, scene.sceneId === sceneId, "SCENE_ID_MISMATCH", "scene contract id does not match the workspace");
add(errors, manifest.characterId === characterId
  && anchor.characterId === characterId
  && foundation.characterId === characterId
  && (!usesSeparatedLayers || calibration.characterId === characterId),
"CHARACTER_ID_MISMATCH", "character ids do not match the workspace");
add(errors, memory.ownerCharacterId === characterId, "MEMORY_OWNER_MISMATCH", "memory seed must belong to the anchored character");
add(errors, Array.isArray(scene.affordances) && Array.isArray(scene.impossibilities), "SCENE_STRUCTURE_MISSING", "scene affordances and impossibilities must be arrays");
add(errors, Array.isArray(anchor.evidence?.confirmed), "ANCHOR_STRUCTURE_MISSING", "authoring index must preserve evidence categories");
add(errors, Array.isArray(foundation.desires) && (!usesSeparatedLayers || foundation.runtimeSurface === "character-foundation"),
  "FOUNDATION_STRUCTURE_MISSING", "character foundation must expose desires and an explicit runtime surface");
add(errors, Array.isArray(calibration.controlledContrasts) && Array.isArray(calibration.speechSamples) && Array.isArray(calibration.holdouts),
  "CALIBRATION_STRUCTURE_MISSING", "calibration suite must keep controlled contrasts, speech samples, and holdouts outside runtime");

if (usesSeparatedLayers) {
  add(errors, Boolean(separatedFoundation && separatedCalibration), "CHARACTER_LAYERS_INCOMPLETE", "both character-foundation.json and calibration-evidence.json are required");
  const validV2Index = anchor.recordType === "character-authoring-index"
    && anchor.foundationRef === "character-foundation.json"
    && anchor.calibrationEvidenceRef === "calibration-evidence.json";
  const validLegacyMigration = anchor.schemaVersion === 1
    && manifest.artifacts?.characterFoundation === "character-foundation.json"
    && manifest.artifacts?.calibrationEvidence === "calibration-evidence.json";
  add(errors, validV2Index || validLegacyMigration,
  "AUTHORING_INDEX_REFERENCE_INVALID", "authoring index must reference the separated foundation and calibration suite");
  const leaksAuthoringData = ["evidence", "validation", "actionPolicy", "candidateFamilies"]
    .some((key) => containsOwnKey(foundation, key))
    || Object.hasOwn(foundation.dynamicPsychology || {}, "updateRules")
    || Object.hasOwn(foundation.speechPolicy || {}, "evidenceAnchors");
  add(errors, !leaksAuthoringData, "FOUNDATION_AUTHORING_DATA_LEAK",
    "runtime foundation must not contain author evidence, calibration answers, holdouts, fixed speech samples, or situation-to-action scripts");
}

if (gateAtLeast(requestedGate, "calibrated")) {
  add(errors, ["confirmed", "validated"].includes(scene.status), "SCENE_NOT_CONFIRMED", "confirm the objective scene contract first");
  add(errors, ["confirmed", "validated"].includes(manifest.gates?.sceneContract), "SCENE_GATE_NOT_CONFIRMED", "manifest scene gate is not confirmed");
  add(errors, manifest.gates?.factConfirmation === "confirmed", "FACTS_NOT_CONFIRMED", "character fact card is not user-confirmed");
  add(errors, nonEmpty(scene.identity?.name) && nonEmpty(scene.identity?.timeScope), "SCENE_IDENTITY_INCOMPLETE", "scene name and story-time scope are required");
  add(errors, nonEmpty(scene.ownership?.ownerCharacterId)
    || nonEmpty(scene.ownership?.institutionId)
    || (scene.ownership?.operatorCharacterIds || []).length > 0, "SCENE_OWNER_MISSING", "name an owner, institution, or operator");
  const zoneRows = scene.topology?.zones || [];
  const zoneIds = zoneRows.map((row) => row.id).filter(nonEmpty);
  const zoneIdSet = new Set(zoneIds);
  add(errors, zoneRows.length > 0, "SCENE_ZONES_MISSING", "define at least one zone");
  add(errors, zoneIds.length === zoneRows.length && zoneIdSet.size === zoneRows.length,
    "SCENE_ZONE_IDS_INVALID", "every scene zone needs one unique stable id");
  const routeRows = scene.topology?.routes || [];
  add(errors, zoneRows.length <= 1 || routeRows.length > 0,
    "SCENE_ROUTES_MISSING", "multiple zones need explicit traversable routes and barriers");
  add(errors, routeRows.every((row) => zoneIdSet.has(row.fromZoneId) && zoneIdSet.has(row.toZoneId)),
    "SCENE_ROUTE_ENDPOINT_INVALID", "every route endpoint must name a defined zone");
  const rawPositionRows = scene.topology?.positions;
  const positionRows = rawPositionRows === undefined ? [] : (Array.isArray(rawPositionRows) ? rawPositionRows : []);
  const positionIds = positionRows.map((row) => row.id).filter(nonEmpty);
  add(errors, (rawPositionRows === undefined || Array.isArray(rawPositionRows))
    && positionIds.length === positionRows.length
    && new Set(positionIds).size === positionRows.length
    && positionRows.every((row) => zoneIdSet.has(row.zoneId)),
  "SCENE_POSITION_CONTRACT_INVALID", "every concrete position needs one unique id and a defined parent zone");
  add(errors, !FORBIDDEN_POSITION_ANSWER_KEYS.some((key) => containsOwnKey(positionRows, key)),
    "SCENE_POSITION_ANSWER_LEAK", "scene positions may expose only objective spatial facts, never character fit, preference, rank, score, utility, or expected choice");
  add(errors, (scene.resources || []).length > 0 || nonEmpty(scene.resourceAbsenceReason),
    "SCENE_RESOURCES_UNSTATED", "define scene resources or explicitly state why none exist");
  add(errors, (scene.resources || []).every((row) => nonEmpty(row.id) && (!nonEmpty(row.zoneId) || zoneIdSet.has(row.zoneId))),
    "SCENE_RESOURCE_LOCATION_INVALID", "every resource needs an id and any zone reference must exist");
  add(errors, (scene.resources || []).every((row) => {
    if (row.attachment?.active !== true) return true;
    const holderId = String(row.holderActorId || row.holderId || "").trim();
    return nonEmpty(holderId)
      && row.attachment.actorId === holderId
      && nonEmpty(row.attachment.mode)
      && typeof row.attachment.transitionRequiresExplicitOperation === "boolean";
  }), "SCENE_RESOURCE_ATTACHMENT_INVALID",
  "an active attachment needs a concrete mode, explicit transition policy, and an actor matching the resource holder");
  add(errors, scene.affordances.length > 0, "SCENE_AFFORDANCES_MISSING", "define at least one scene affordance");
  const affordanceIds = new Set((scene.affordances || []).map((row) => row.id).filter(nonEmpty));
  add(errors, affordanceIds.size === scene.affordances.length, "SCENE_AFFORDANCE_IDS_INVALID", "every affordance needs one unique stable id");
  const serviceOffers = scene.economy?.offerings;
  if (serviceOffers !== undefined) {
    const validOfferRows = Array.isArray(serviceOffers) ? serviceOffers : [];
    const offeringIds = new Set(validOfferRows.map((row) => row.id).filter(nonEmpty));
    add(errors, Array.isArray(serviceOffers)
      && validOfferRows.length > 0
      && offeringIds.size === validOfferRows.length
      && validOfferRows.every((row) => nonEmpty(row.label) && Number.isFinite(row.priceWen) && row.priceWen >= 0),
    "SCENE_SERVICE_OFFER_CONTRACT_INVALID", "service offerings need unique ids, labels, and non-negative current prices");
    add(errors, !FORBIDDEN_SERVICE_ANSWER_KEYS.some((key) => containsOwnKey(validOfferRows, key)),
      "SCENE_SERVICE_CHOICE_ANSWER_LEAK", "service facts may not contain a preferred offer, rank, score, utility, recommendation, or expected character choice");
    const transactionAffordances = (scene.affordances || []).filter((row) => nonEmpty(row.transactionPhase));
    const transactionPhases = new Set(transactionAffordances.map((row) => row.transactionPhase));
    add(errors, SERVICE_TRANSACTION_PHASES.every((phase) => transactionPhases.has(phase)),
      "SCENE_SERVICE_TRANSACTION_PHASE_MISSING", "a service venue must separate visitor request, operator response, fulfillment, and settlement affordances");
    add(errors, transactionAffordances.every((row) => SERVICE_TRANSACTION_PHASES.includes(row.transactionPhase)
      && Array.isArray(row.offeringIds)
      && row.offeringIds.length > 0
      && row.offeringIds.every((id) => offeringIds.has(id))),
    "SCENE_SERVICE_TRANSACTION_REFERENCE_INVALID", "every transaction affordance must name a valid phase and one or more current offering ids");
  }
  add(errors, scene.impossibilities.length > 0, "SCENE_IMPOSSIBILITIES_MISSING", "define at least one impossible-without-enablers event");
  add(errors, scene.impossibilities.every((row) => nonEmpty(row.id) && nonEmpty(row.claim)
    && Array.isArray(row.enablingConditions) && row.enablingConditions.length > 0),
  "SCENE_IMPOSSIBILITY_CAUSE_MISSING", "every impossible event needs a claim and explicit enabling conditions");
  add(errors, (scene.roles || []).length > 0, "SCENE_ROLES_MISSING", "define at least one public role or responsibility");
  const roleIds = new Set((scene.roles || []).map((row) => row.id).filter(nonEmpty));
  add(errors, roleIds.size === scene.roles.length
    && scene.roles.every((row) => Array.isArray(row.responsibilities) && row.responsibilities.length > 0),
  "SCENE_ROLE_CONTRACT_INVALID", "every role needs one unique id and concrete responsibilities");
  add(errors, (scene.informationRoutes || []).length > 0, "SCENE_INFORMATION_ROUTES_MISSING", "define direct or indirect information propagation");
  add(errors, (scene.informationRoutes || []).every((row) => nonEmpty(row.id)
    && zoneIdSet.has(row.sourceZoneId)
    && Array.isArray(row.recipientZoneIds)
    && row.recipientZoneIds.length > 0
    && row.recipientZoneIds.every((zoneId) => zoneIdSet.has(zoneId))),
  "SCENE_INFORMATION_ROUTE_INVALID", "information routes must connect defined zones");
  add(errors, scene.presencePolicy?.entryRequiresCharacterCause === true
    && scene.presencePolicy?.exitIsAffordanceNotSchedule === true
    && scene.presencePolicy?.scheduleRole === "constraint-only",
  "SCENE_PRESENCE_POLICY_INVALID", "presence must stay causal and schedules constraint-only");
  if (scene.status === "validated") {
    const sceneCases = scene.validation?.counterexamples || [];
    add(errors, sceneCases.length >= 5 && sceneCases.every((row) => row.passed === true
      && nonEmpty(row.attemptedEvent) && nonEmpty(row.expectedResult)),
      "SCENE_COUNTEREXAMPLES_NOT_PASSED", "a validated scene needs five passed causal counterexamples");
  }
  add(errors, ["calibrated", "validated"].includes(foundation.status), "ANCHOR_NOT_CALIBRATED", "character foundation status must be calibrated or validated");
  add(errors, ["calibrated", "validated"].includes(manifest.gates?.calibration), "CALIBRATION_GATE_NOT_PASSED", "manifest calibration gate is not passed");
  add(errors, (anchor.evidence?.confirmed || []).length > 0, "CONFIRMED_EVIDENCE_MISSING", "calibration needs confirmed evidence");
  const binding = (foundation.sceneBindings || []).find((row) => row.sceneId === sceneId);
  add(errors, binding && nonEmpty(binding.reasonForPresence) && nonEmpty(binding.entryCause) && nonEmpty(binding.currentPurpose),
    "SCENE_BINDING_INCOMPLETE", "the character needs a reason for presence, causal entry trigger, and current purpose");
  add(errors, binding
    && (binding.responsibilityRoleIds || []).every((id) => roleIds.has(id))
    && (binding.knownAffordanceIds || []).every((id) => affordanceIds.has(id)),
  "SCENE_BINDING_REFERENCE_INVALID", "scene binding roles and affordances must exist in the scene contract");
  add(errors, (foundation.desires || []).length > 0, "DESIRE_MISSING", "calibration needs a positive self-owned desire");
  for (const desire of foundation.desires || []) {
    add(errors, desire.ownerCharacterId === characterId && desire.desiredState?.subjectCharacterId === characterId,
      "DESIRE_NOT_SELF_OWNED", "every desire must be owned by this character");
    add(errors, nonEmpty(desire.desiredState?.verb) && !/^(?:不|别|勿|未|无|避免|不能|不要|不得)/u.test(desire.desiredState.verb),
      "DESIRE_WRITTEN_AS_RULE", "desire verb must be a positive action/state");
    add(errors, Array.isArray(desire.progressEvidence) && desire.progressEvidence.length > 0,
      "DESIRE_PROGRESS_UNSTATED", "define observable evidence of progress without calling it satisfaction");
    add(errors, nonEmpty(desire.satisfactionCondition) || (desire.satisfactionCondition && typeof desire.satisfactionCondition === "object"),
      "DESIRE_SATISFACTION_UNSTATED", "define the verified condition that can actually close the desire");
  }
  add(errors, (foundation.inhibitors || []).length > 0, "INHIBITORS_MISSING", "keep inhibitors separate from desire");
  add(errors, (calibration.speechSamples || []).length >= 3, "SPEECH_ANCHORS_INSUFFICIENT", "calibration needs three speech functions outside runtime");
  add(errors, new Set((calibration.speechSamples || []).map((row) => row.function).filter(nonEmpty)).size >= 3,
    "SPEECH_FUNCTIONS_NOT_DISTINCT", "speech anchors must cover at least three distinct functions");
  add(errors, (calibration.speechSamples || []).every((row) => nonEmpty(row.line)
    && (nonEmpty(row.evidenceId) || (Array.isArray(row.sourceEvidenceIds) && row.sourceEvidenceIds.length > 0))),
    "SPEECH_EVIDENCE_MISSING", "every speech anchor needs an accepted line and evidence id");
  add(errors, (foundation.relationshipModel?.updateRules || foundation.relationshipModel?.updateTendencies || []).length > 0,
    "RELATIONSHIP_RULES_MISSING", "foundation needs reusable dimensional relationship update tendencies");
  const contrasts = calibration.controlledContrasts || [];
  add(errors, contrasts.length >= 3
    && new Set(contrasts.map((row) => row.changedVariable).filter(nonEmpty)).size >= 3
    && new Set(contrasts.map((row) => row.domain).filter(nonEmpty)).size >= 2,
  "CONTROLLED_CONTRASTS_INSUFFICIENT", "calibration needs three changed variables across at least two behavioral domains");
  const memoryRows = [...(memory.episodes || []), ...(memory.beliefs || []), ...(memory.commitments || [])];
  add(errors, memoryRows.length > 0 || nonEmpty(memory.emptyReason), "MEMORY_BOUNDARY_UNSTATED", "seed memory or state why it intentionally begins empty");
  add(errors, memoryRows.every((row) => nonEmpty(row.sourceType) || nonEmpty(row.source) || nonEmpty(row.provenance)),
    "MEMORY_SOURCE_MISSING", "every memory seed needs an explicit source type or provenance");
}

if (gateAtLeast(requestedGate, "validated")) {
  const holdouts = calibration.holdouts || [];
  add(errors, foundation.status === "validated", "ANCHOR_NOT_VALIDATED", "character foundation status is not validated");
  add(errors, manifest.gates?.holdouts === "passed", "HOLDOUT_GATE_NOT_PASSED", "manifest holdout gate is not passed");
  add(errors, holdouts.length >= 3
    && holdouts.every((row) => row.accepted === true && nonEmpty(row.unseenSituation) && nonEmpty(row.prediction)),
  "HOLDOUTS_NOT_PASSED", "three unseen holdouts with recorded predictions must be accepted");
}

if (gateAtLeast(requestedGate, "runtime")) {
  add(errors, manifest.gates?.runtimeMapping === "mapped", "RUNTIME_GATE_NOT_MAPPED", "manifest runtime mapping gate is not mapped");
  add(errors, ["runtime-mapped", "behavior-accepted"].includes(runtimeMap.status),
    "RUNTIME_MAP_STATUS_INVALID", "runtime map status must declare runtime-mapped or behavior-accepted");
  const authorityKeys = Object.keys(runtimeMap.authoritySurfaces || {});
  add(errors, REQUIRED_RUNTIME_SURFACES.every((surface) => authorityKeys.includes(surface)),
    "RUNTIME_SURFACE_MISSING", "every required live authority surface must be present");
  const authorityPairs = [];
  for (const surface of REQUIRED_RUNTIME_SURFACES) {
    const authority = runtimeMap.authoritySurfaces?.[surface];
    add(errors, nonEmpty(authority?.path) && nonEmpty(authority?.symbol), "RUNTIME_AUTHORITY_MISSING", `${surface} lacks one exact live authority`);
    if (nonEmpty(authority?.path) && nonEmpty(authority?.symbol)) authorityPairs.push(`${authority.path}#${authority.symbol}`);
  }
  add(errors, new Set(authorityPairs).size === authorityPairs.length,
    "RUNTIME_AUTHORITY_DUPLICATED", "two state surfaces may not claim the same live path and symbol");
  if (usesSeparatedLayers) {
    const boundary = runtimeMap.runtimeBoundary || {};
    add(errors, (boundary.agentInputArtifactIds || []).includes("characterFoundation")
      && (boundary.agentInputArtifactIds || []).includes("memorySeed")
      && !(boundary.agentInputArtifactIds || []).includes("calibrationEvidence")
      && (boundary.forbiddenAgentInputArtifactIds || []).includes("anchorPayload")
      && (boundary.forbiddenAgentInputArtifactIds || []).includes("calibrationEvidence"),
    "RUNTIME_ARTIFACT_BOUNDARY_INVALID", "runtime may load only the character foundation and owned memory, never authoring or calibration artifacts");
  }
}

if (gateAtLeast(requestedGate, "behavior")) {
  const tests = runtimeMap.acceptanceTests || [];
  add(errors, manifest.gates?.behaviorAcceptance === "passed", "BEHAVIOR_GATE_NOT_PASSED", "manifest behavior gate is not passed");
  const passedCategories = new Set(tests.filter((row) => row.passed === true).map((row) => row.category || row.id));
  add(errors, REQUIRED_BEHAVIOR_CATEGORIES.every((category) => passedCategories.has(category)),
    "BEHAVIOR_TESTS_NOT_PASSED", "all eight causal portability categories must pass");
}

const result = {
  valid: errors.length === 0,
  requestedGate,
  sceneId,
  characterId,
  errors,
};
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
