// Wire-level checks only. The Character Agent still owns every appraisal,
// candidate, choice and expression; the turn protocol remains authoritative.
import { validateCapabilityActionBinding } from "./physicalActionContract.mjs";
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const list = value => Array.isArray(value) ? value : [];
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const FIXED_METADATA = new Set(["ownerAuthority", "originAuthority", "agentTurnId", "sourceAgentTurnId"]);
export const CHARACTER_STAGE_SUBMISSION_VERSION = "character-stage-submission-v2";

// This is the deliberately small JSON-Schema vocabulary emitted by the local
// stage schema builder, not a validator for arbitrary third-party schemas.
export function validateCharacterOutputShape(value, schema, path = "output") {
  const errors = [];
  const add = (code, message, extra = {}) => errors.push({ code, path, message, ...extra });
  if (schema.anyOf) {
    const branches = schema.anyOf.map(branch => validateCharacterOutputShape(value, branch, path));
    if (!branches.some(branch => branch.length === 0)) {
      errors.push(...branches.sort((a, b) => a.length - b.length)[0]);
    }
  }
  const matchesType = type => type === "object" ? record(value)
    : type === "array" ? Array.isArray(value)
      : type === "integer" ? Number.isInteger(value)
        : type === "number" ? typeof value === "number" && Number.isFinite(value)
          : type === "null" ? value === null : typeof value === type;
  if (schema.type && ![].concat(schema.type).some(matchesType)) {
    add("STAGE_OUTPUT_TYPE", `Expected ${[].concat(schema.type).join(" or ")}.`);
    return errors;
  }
  if (schema.enum && !schema.enum.some(item => same(item, value))) {
    add("STAGE_OUTPUT_ENUM", "Choose a value from the current stage's allowed list.", { allowedValues: schema.enum });
  }
  if (record(value)) {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) {
      errors.push({ code: "STAGE_OUTPUT_REQUIRED", path: `${path}.${key}`, message: "Required by the current stage." });
    }
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...validateCharacterOutputShape(child, schema.properties[key], `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push({
        code: "STAGE_OUTPUT_UNKNOWN_FIELD", path: `${path}.${key}`, message: "This field does not belong to the current stage.",
      });
    }
  }
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0)) add("STAGE_OUTPUT_MIN_ITEMS", `At least ${schema.minItems} entries are required.`);
    if (value.length > (schema.maxItems ?? Infinity)) add("STAGE_OUTPUT_MAX_ITEMS", `At most ${schema.maxItems} entries are allowed.`);
    if (schema.items) value.forEach((child, index) => errors.push(...validateCharacterOutputShape(child, schema.items, `${path}[${index}]`)));
  }
  if (typeof value === "string") {
    if ([...value].length < (schema.minLength ?? 0)) add("STAGE_OUTPUT_MIN_LENGTH", `At least ${schema.minLength} characters are required.`);
    if ([...value].length > (schema.maxLength ?? Infinity)) add("STAGE_OUTPUT_MAX_LENGTH", `At most ${schema.maxLength} characters are allowed.`);
  }
  if (typeof value === "number") {
    if (value < (schema.minimum ?? -Infinity)) add("STAGE_OUTPUT_MINIMUM", `Minimum is ${schema.minimum}.`);
    if (value > (schema.maximum ?? Infinity)) add("STAGE_OUTPUT_MAXIMUM", `Maximum is ${schema.maximum}.`);
  }
  return errors;
}

function fillFixedMetadata(value, schema, changes, path = "output") {
  if (record(value)) {
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (!Object.hasOwn(value, key) && FIXED_METADATA.has(key) && childSchema.enum?.length === 1) {
        value[key] = childSchema.enum[0];
        changes.push(`${path}.${key}`);
      }
      if (Object.hasOwn(value, key)) fillFixedMetadata(value[key], childSchema, changes, `${path}.${key}`);
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((child, index) => fillFixedMetadata(child, schema.items, changes, `${path}[${index}]`));
}

export function prepareCharacterStageSubmission(stageInput, authoredOutput, schema) {
  const output = structuredClone(authoredOutput);
  const filledMetadata = [];
  fillFixedMetadata(output, schema, filledMetadata);
  const issues = validateCharacterOutputShape(output, schema);
  // Sibling references cannot be encoded as independent schema enums. Check
  // them without changing the response, selecting an alternative or deciding
  // whether the Character's subjective interpretation is true.
  if (!issues.length && record(output)) {
    const candidates = stageInput.phase === "awaiting_subjective_appraisal_and_candidates" ? output.candidates?.candidates
      : stageInput.phase === "awaiting_agent_candidates" ? output.candidates : [];
    for (const [index, candidate] of list(candidates).entries()) issues.push(...validateCapabilityActionBinding(
      candidate, stageInput.worldProjection?.affordances || [], `candidates[${index}]`));
    const choice = stageInput.phase === "awaiting_agent_choice_and_turn_commit" ? output.choice
      : stageInput.phase === "awaiting_agent_choice_and_regulation" ? output : null;
    if (choice) {
      const selected = list(stageInput.generatedCandidates).find(row => row.candidateId === choice.selectedCandidateId);
      const related = new Set(list(selected?.desireRelations).map(row => row.desireId));
      for (const id of list(choice.goalPreservation?.preservedDesireIds)) if (!related.has(id)) issues.push({
        code: "CHARACTER_AGENT_PRESERVED_DESIRE_UNLINKED", path: "choice.goalPreservation.preservedDesireIds",
        message: "The selected candidate does not declare this desire relation. Revise your choice or your preservation claim explicitly.",
        desireId: id, allowedValues: [...related],
      });
    }
    const appraisal = stageInput.phase === "awaiting_subjective_appraisal_and_candidates" ? output.appraisal
      : stageInput.phase === "awaiting_subjective_appraisal" ? output : null;
    if (appraisal) {
      const noticed = new Set(appraisal.noticedEvidenceIds);
      const evidence = [...list(stageInput.worldProjection?.evidence), ...list(stageInput.worldProjection?.perceivedImpacts)];
      const aliases = new Map(evidence.flatMap(row => [row.evidenceId, row.impactId, row.eventId, row.id]
        .filter(Boolean).map(id => [id, row.evidenceId || row.impactId || row.eventId || row.id])));
      const noticedCanonical = new Set([...noticed].map(id => aliases.get(id) || id));
      const checkNoticed = (node, path) => {
        if (!record(node) || node.carriedUnchanged === true) return;
        for (const [key, value] of Object.entries(node)) {
          if (/(evidence|impact)Ids$/iu.test(key) && key !== "noticedEvidenceIds") for (const id of list(value)) if (!noticedCanonical.has(aliases.get(id) || id)) issues.push({
            code: "CHARACTER_AGENT_EVIDENCE_NOT_NOTICED", path: `${path}.${key}`,
            message: "A cited source must be explicitly noticed by this Character in this appraisal.", evidenceId: id,
          });
          if (Array.isArray(value)) value.forEach((item, index) => checkNoticed(item, `${path}.${key}[${index}]`));
          else if (record(value)) checkNoticed(value, `${path}.${key}`);
        }
      };
      checkNoticed(appraisal, "appraisal");
    }
  }
  return { output, filledMetadata, valid: issues.length === 0, issues };
}

export function characterStageSubmissionContract(stageInput, schema, stageId) {
  return {
    schemaVersion: CHARACTER_STAGE_SUBMISSION_VERSION, stageId, phase: stageInput.phase,
    requiredOutputFields: schema.required || [],
    runtimeMetadata: { agentTurnId: stageInput.agentTurnId, ownerAuthority: "character-agent" },
    rule: "Submit {stageId, output}; output must match this stage's frozen schema. Missing fixed authority/turn metadata is filled; contradictory metadata is rejected. /validate is read-only. /respond consumes one bounded submission even if it returns 422; read the next pending stage after rejection. HTTP 202 is a durable receipt, not world success. Never replace content already received under a stageId.",
    choiceAlreadyAccepted: stageInput.phase === "awaiting_agent_turn_commit",
  };
}
