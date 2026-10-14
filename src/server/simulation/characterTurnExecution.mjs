import { createHash } from "node:crypto";

const clone = structuredClone;
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
export const submissionDigest = value => createHash("sha256").update(JSON.stringify(ordered(value))).digest("hex");
export function characterExecutionAuditRecord(state = {}) {
  const stage = state.currentStage;
  const shared = { protocolVersion: state.protocolVersion, agentTurnId: state.agentTurnId, callCount: state.callCount, repairAttempts: state.repairAttempts };
  if (stage && ["response_received", "rejected"].includes(stage.status)) return { ...shared, ...structuredClone(stage) };
  const accepted = state.acceptedStages?.at(-1);
  if (!stage && accepted) return { ...shared, status: "accepted", stage: accepted.stage, ticket: accepted.ticket,
    inputDigest: accepted.inputDigest, schemaDigest: accepted.schemaDigest, responseDigest: submissionDigest(accepted.response) };
  return null;
}
function fault(code, message) { return Object.assign(new Error(message), { code }); }

// Explicit host authorization for a repaired contract/provider change. Ordinary
// process restarts still cannot replenish budgets or discard received output.
export function authorizeCharacterTurnRetry(checkpoint, { authorizationId, reason, additionalCalls = 5, additionalRepairs = 2 } = {}) {
  if (!String(authorizationId || "").trim() || !String(reason || "").trim()
    || !Number.isSafeInteger(additionalCalls) || additionalCalls < 1 || additionalCalls > 10
    || !Number.isSafeInteger(additionalRepairs) || additionalRepairs < 0 || additionalRepairs > 10) {
    throw fault("CHARACTER_RETRY_AUTHORIZATION_INVALID", "A retry requires explicit authorization, a reason and bounded additional calls/repairs.");
  }
  const state = clone(checkpoint);
  if (!state || state.schemaVersion !== 1) throw fault("CHARACTER_RETRY_CHECKPOINT_INVALID", "Expected a character execution checkpoint.");
  if ((state.retryAuthorizations || []).some(row => row.authorizationId === authorizationId)) return state;
  if (state.status === "stages_accepted" || state.currentStage?.status === "response_received") {
    throw fault("CHARACTER_RETRY_RECEIVED_OUTPUT_PENDING", "Settle the received or accepted output; a retry must not discard it.");
  }
  state.retryAuthorizations = [...(state.retryAuthorizations || []), { authorizationId, reason,
    priorStatus: state.status, priorMaxCalls: state.maxCalls, priorMaxRepairs: state.maxRepairs,
    callCount: state.callCount, repairAttempts: state.repairAttempts,
    priorStage: clone(state.currentStage), additionalCalls, additionalRepairs }];
  state.maxCalls = state.callCount + additionalCalls;
  state.maxRepairs = state.repairAttempts + additionalRepairs;
  // Accepted stages and the turn's frozen input remain immutable. Only the
  // unaccepted stage contract is regenerated after the host's repair.
  state.currentStage = null;
  state.status = "active";
  return state;
}

/** Host-owned execution state. The Character sees only its frozen stage input;
 * it cannot reset budgets, replace a prior choice or mark a stage accepted. */
export function createCharacterTurnExecution({ input, protocolVersion, checkpoint, maxRepairs = 2, onCheckpoint } = {}) {
  if (!Number.isSafeInteger(maxRepairs) || maxRepairs < 0 || maxRepairs > 10) throw fault("CHARACTER_REPAIR_LIMIT_INVALID", "Repair limit must be an integer from 0 to 10.");
  const state = clone(checkpoint || { schemaVersion: 1, protocolVersion, agentTurnId: input.agentTurnId,
    initialInput: input, acceptedStages: [], currentStage: null, callCount: 0, repairAttempts: 0,
    maxCalls: 3 + maxRepairs, maxRepairs, status: "active" });
  if (state.agentTurnId !== input.agentTurnId || state.protocolVersion !== protocolVersion) throw fault("CHARACTER_EXECUTION_CHECKPOINT_MISMATCH", "Cannot resume a different turn or protocol version.");
  const persist = async () => { if (onCheckpoint) await onCheckpoint(clone(state)); };
  const suspended = () => fault("CHARACTER_MODEL_SUSPENDED", "This decision exhausted its model-call or repair budget. Accepted stages remain saved; no substitute decision was made.");
  if (state.status === "suspended_model_error") throw suspended();
  return {
    get initialInput() { return clone(state.initialInput); },
    get repairAttempts() { return state.repairAttempts; },
    acceptedStage(stage) { return clone(state.acceptedStages.find(row => row.stage === stage) || null); },
    async prepareStage(stage, input, schema) {
      const base = clone(input); delete base.protocolRepairFeedback;
      if (state.currentStage?.stage !== stage) {
        const identity = submissionDigest({ agentTurnId: state.agentTurnId, stage, protocolVersion, input: base, schema });
        state.currentStage = { stage, ticket: `stage:${identity}`, input: base, schema: clone(schema),
          inputDigest: submissionDigest(base), schemaDigest: submissionDigest(schema), status: "prepared" };
        await persist();
      } else if (state.currentStage.inputDigest !== submissionDigest(base) || state.currentStage.schemaDigest !== submissionDigest(schema)) {
        throw fault("CHARACTER_STAGE_SNAPSHOT_MISMATCH", "A resumed stage must use its original context and schema.");
      }
      return { ...clone(state.currentStage.input), ...(input.protocolRepairFeedback ? { protocolRepairFeedback: clone(input.protocolRepairFeedback) } : {}) };
    },
    get pendingResponse() { return state.currentStage?.status === "response_received" ? clone(state.currentStage.response) : null; },
    get hasPendingResponse() { return state.currentStage?.status === "response_received"; },
    async beforeModelCall() {
      if (state.callCount >= state.maxCalls || state.status === "suspended_model_error") {
        state.status = "suspended_model_error"; await persist(); throw suspended();
      }
      state.callCount += 1; state.currentStage.status = "awaiting_model";
      await persist();
    },
    async receiveResponse(response) {
      state.currentStage.response = clone(response); state.currentStage.status = "response_received";
      await persist();
    },
    async acceptStage(stage, session, result) {
      state.acceptedStages.push({ stage, ticket: state.currentStage.ticket, inputDigest: state.currentStage.inputDigest,
        schemaDigest: state.currentStage.schemaDigest, input: clone(state.currentStage.input),
        response: clone(state.currentStage.response), session: clone(session), resultStage: clone(result?.stage || null) });
      state.currentStage = null;
      if (session.phase === "ready_for_world_resolution") state.status = "stages_accepted";
      await persist();
    },
    async rejectStage(error, repairFeedback) {
      state.currentStage.status = "rejected";
      state.currentStage.lastIssues = clone(error.issues || []);
      state.currentStage.rejectedModelText = typeof error.rawOutput === "string" ? error.rawOutput : null;
      state.currentStage.repairFeedback = clone(repairFeedback);
      if (state.repairAttempts >= state.maxRepairs || state.callCount >= state.maxCalls) {
        state.status = "suspended_model_error"; await persist(); throw suspended();
      }
      state.repairAttempts += 1;
      await persist();
    },
    get repairFeedback() {
      const prior = state.retryAuthorizations?.at(-1)?.priorStage;
      const priorFeedback = prior?.repairFeedback && !state.acceptedStages.some(row => row.stage === prior.stage) ? prior.repairFeedback : null;
      return clone(state.currentStage?.repairFeedback || priorFeedback || null);
    },
  };
}
