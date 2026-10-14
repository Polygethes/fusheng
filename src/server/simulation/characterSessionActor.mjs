import { assembleCharacterTurnContext } from "./characterContextAssembler.mjs";
import { assertCharacterRuntimePort } from "./characterRuntimePort.mjs";
import { initialExecutionControl, urgentWake } from "./characterExecutionControl.mjs";

export const CHARACTER_SESSION_ACTOR_VERSION = "character-session-actor-v1";

const MAX_PRIVATE_JOURNAL_ENTRIES = 512;

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function fail(code, message, evidence = {}) {
  const error = new Error(message);
  error.code = code;
  error.evidence = clone(evidence);
  return error;
}

function wakePriority(wake = {}) {
  if (urgentWake(wake)) return 100;
  const kind = clean(wake.kind);
  const causeType = clean(wake.causeType || wake.kind);
  // A real change in the character's perceived world must be considered
  // before a synthetic opportunity to continue an earlier intention.  This
  // only orders thought opportunities; it does not choose the response.
  if (["world_evidence", "new_external_impact"].includes(causeType)) return 30;
  if (causeType === "day_planning_due") return 25;
  if (causeType === "plan_due") return 20;
  if (causeType === "reflection_due") return 10;
  if (kind === "continuation_due") return 10;
  return 20;
}

function mergeOwnedState(base = {}, patch = {}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return clone(base);
  for (const key of ["worldPatch", "worldState", "statePatch", "entities", "worldJournal", "otherCharacterPrivateStates"]) {
    if (Object.hasOwn(patch, key)) {
      throw fail("CHARACTER_ACTOR_PRIVATE_PATCH_WORLD_FIELD_FORBIDDEN", "Private patch contains objective world state.", { key });
    }
  }
  const output = clone(base || {});
  for (const [key, value] of Object.entries(patch)) {
    // Pending attempts are a canonical keyed collection. Outcome reduction
    // returns the complete next collection so removing a settled attempt must
    // not be undone by recursive merge semantics.
    output[key] = key === "pendingAttemptContinuityById"
      ? clone(value || {})
      : value && typeof value === "object" && !Array.isArray(value)
      ? mergeOwnedState(output[key] && typeof output[key] === "object" ? output[key] : {}, value)
      : clone(value);
  }
  return output;
}

class CharacterSessionActor {
  constructor({
    characterId,
    privateState = {},
    runtimePort,
    contextAssembler = assembleCharacterTurnContext,
    checkpoint = null,
  } = {}) {
    this.characterId = clean(characterId || checkpoint?.characterId);
    if (!this.characterId) throw fail("CHARACTER_ACTOR_ID_REQUIRED", "Character Session Actor requires characterId.");
    this.runtimePort = assertCharacterRuntimePort(runtimePort);
    this.contextAssembler = contextAssembler;
    this.privateState = clone(checkpoint?.privateState || privateState || {});
    if (!this.privateState.ownerCharacterId) this.privateState.ownerCharacterId = this.characterId;
    if (clean(this.privateState.ownerCharacterId) !== this.characterId) {
      throw fail("CHARACTER_ACTOR_PRIVATE_OWNER_MISMATCH", "Character private state belongs to another actor.");
    }
    this.mailbox = clone(checkpoint?.mailbox || []);
    this.privateJournal = clone(Array.isArray(checkpoint?.privateJournal)
      ? checkpoint.privateJournal
      : []).slice(-MAX_PRIVATE_JOURNAL_ENTRIES);
    this.seenWakeIds = new Set(checkpoint?.seenWakeIds || []);
    this.pendingAttemptIds = new Set(checkpoint?.pendingAttemptIds || []);
    this.pendingTurn = clone(checkpoint?.pendingTurn || null);
    this.inFlightWake = clone(checkpoint?.inFlightWake || null);
    this.inFlightReceiptEvidenceIds = clone(checkpoint?.inFlightReceiptEvidenceIds ?? null);
    this.executionControl = initialExecutionControl(checkpoint?.executionControl);
    // A wake can arrive while a restored Actor has no live runtime handle.
    // Keep that delivery debt separate from the authoritative mailbox so the
    // newly-opened session receives the same wake history as an uninterrupted
    // session. Older checkpoints omit this field; their pending mailboxes are
    // conservatively treated as already forwarded to avoid duplicate prompts.
    this.unforwardedWakeIds = new Set(checkpoint?.unforwardedWakeIds || []);
    this.turnSequence = Math.max(0, Number(checkpoint?.turnSequence || 0));
    this.runtimeCheckpoint = clone(checkpoint?.runtimeCheckpoint || null);
    this.handle = null;
    this.activeTurnId = "";
    this.activeWakeId = "";
    this.activeWakeIds = [];
  }

  appendPrivateJournal(entry = {}) {
    this.privateJournal = [
      ...this.privateJournal,
      clone(entry),
    ].slice(-MAX_PRIVATE_JOURNAL_ENTRIES);
  }

  async open() {
    if (!this.handle) {
      this.handle = await this.runtimePort.openSession({
        characterId: this.characterId,
        runtimeCheckpoint: this.runtimeCheckpoint,
      });
    }
    // Preserve arrival order, not mailbox priority order. The latter may move
    // external evidence ahead of an older plan wake for decision scheduling,
    // but an uninterrupted runtime port has already observed both in their
    // original enqueue order.
    for (const wakeId of [...this.unforwardedWakeIds]) {
      const wake = this.mailbox.find((row) => clean(row?.wakeId) === wakeId);
      if (!wake) {
        this.unforwardedWakeIds.delete(wakeId);
        continue;
      }
      await this.runtimePort.enqueueWake(this.handle, wake);
      this.unforwardedWakeIds.delete(wakeId);
    }
    return this.handle;
  }

  async enqueueWake(wake = {}) {
    const wakeId = clean(wake.wakeId || wake.id);
    if (!wakeId) throw fail("CHARACTER_ACTOR_WAKE_ID_REQUIRED", "Character wake requires wakeId.");
    const recipientId = clean(wake.recipientCharacterId);
    if (recipientId && recipientId !== this.characterId) {
      throw fail("CHARACTER_ACTOR_WAKE_RECIPIENT_MISMATCH", "Character wake belongs to another actor.");
    }
    if (this.seenWakeIds.has(wakeId) || this.mailbox.some((row) => clean(row.wakeId) === wakeId)) return false;
    const normalized = { ...clone(wake), wakeId, recipientCharacterId: this.characterId };
    // Keep the wake currently being processed at the head of the mailbox.
    // Among pending wakes, preserve FIFO within a priority while allowing
    // genuine external evidence to overtake scheduler-created continuations.
    const firstPendingIndex = this.activeTurnId ? Math.max(1, this.activeWakeIds.length) : 0;
    const priority = wakePriority(normalized);
    const relativeIndex = this.mailbox.slice(firstPendingIndex)
      .findIndex((row) => wakePriority(row) < priority);
    const insertionIndex = relativeIndex < 0
      ? this.mailbox.length
      : firstPendingIndex + relativeIndex;
    this.mailbox.splice(insertionIndex, 0, normalized);
    this.unforwardedWakeIds.add(wakeId);
    if (this.handle) {
      await this.runtimePort.enqueueWake(this.handle, normalized);
      this.unforwardedWakeIds.delete(wakeId);
    }
    this.appendPrivateJournal({ kind: "wake_enqueued", wakeId });
    return true;
  }

  prunePendingWakes({
    staleEvidenceIds = [],
    activeContinuationIntentionIds = [],
    activePlanStepReferenceIds = [],
    activeReflectionOpportunityIds = [],
    activeWaitAttemptId,
  } = {}) {
    const staleEvidence = new Set((staleEvidenceIds || []).map(clean).filter(Boolean));
    const activeContinuations = new Set((activeContinuationIntentionIds || []).map(clean).filter(Boolean));
    const activePlanStepReferences = new Set((activePlanStepReferenceIds || []).map(clean).filter(Boolean));
    const activeReflectionOpportunities = new Set((activeReflectionOpportunityIds || []).map(clean).filter(Boolean));
    const firstPendingIndex = this.activeTurnId ? Math.max(1, this.activeWakeIds.length) : 0;
    const retained = this.mailbox.slice(0, firstPendingIndex);
    const discarded = [];

    for (const sourceWake of this.mailbox.slice(firstPendingIndex)) {
      if ((this.inFlightWake?.sourceWakeIds || [this.inFlightWake?.wakeId]).includes(clean(sourceWake.wakeId))) {
        retained.push(clone(sourceWake)); continue;
      }
      const wake = clone(sourceWake);
      const kind = clean(wake.kind || wake.causeType);
      if (kind === "wait_deadline" && activeWaitAttemptId !== undefined
        && (!activeWaitAttemptId || wake.wakeId !== `wake:wait:${activeWaitAttemptId}`)) {
        discarded.push({ wakeId: clean(wake.wakeId), reason: "settled_or_superseded_wait" });
        continue;
      }
      if (["world_evidence", "new_external_impact"].includes(kind)) {
        const originalEvidenceIds = (wake.evidenceIds || []).map(clean).filter(Boolean);
        wake.evidenceIds = originalEvidenceIds.filter((evidenceId) => !staleEvidence.has(evidenceId));
        wake.evidence = (wake.evidence || []).filter((row) => (
          !staleEvidence.has(clean(row?.evidenceId))
        ));
        const carriedOnlyEvidence = originalEvidenceIds.length > 0 && !(wake.processIds || []).length;
        if (carriedOnlyEvidence && wake.evidenceIds.length === 0) {
          discarded.push({ wakeId: clean(wake.wakeId), reason: "settled_evidence" });
          continue;
        }
      }
      if (clean(wake.causeType) === "plan_due") {
        const referenceIds = (wake.planStepRefs || [])
          .map((row) => clean(row?.referenceId || row))
          .filter(Boolean);
        if (!referenceIds.length || referenceIds.some((referenceId) => !activePlanStepReferences.has(referenceId))) {
          discarded.push({ wakeId: clean(wake.wakeId), reason: "superseded_plan_schedule" });
          continue;
        }
      } else if (clean(wake.causeType || wake.kind) === "reflection_due") {
        const opportunityId = clean(wake.reflectionOpportunityId);
        if (!opportunityId || !activeReflectionOpportunities.has(opportunityId)) {
          discarded.push({ wakeId: clean(wake.wakeId), reason: "settled_or_superseded_reflection" });
          continue;
        }
      } else if (kind === "continuation_due") {
        const originalIds = (wake.continuationIntentionIds || []).map(clean).filter(Boolean);
        wake.continuationIntentionIds = originalIds.filter((intentionId) => activeContinuations.has(intentionId));
        if (originalIds.length > 0 && wake.continuationIntentionIds.length === 0) {
          discarded.push({ wakeId: clean(wake.wakeId), reason: "inactive_continuation" });
          continue;
        }
      }
      retained.push(wake);
    }

    this.mailbox = retained;
    for (const row of discarded) {
      this.unforwardedWakeIds.delete(row.wakeId);
      if (row.wakeId) this.seenWakeIds.add(row.wakeId);
      this.appendPrivateJournal({ kind: "wake_discarded", wakeId: row.wakeId, reason: row.reason });
    }
    return clone({ discarded, mailboxLength: this.mailbox.length });
  }

  async runNextTurn({ worldVersion = 0, situationProjection = {}, rememberedContext = {}, wakeBundle = null, retainPendingTurn = false, receiptEvidenceIds = null } = {}) {
    if (this.pendingTurn) return clone(this.pendingTurn);
    if (this.activeTurnId) {
      throw fail("CHARACTER_ACTOR_TURN_ALREADY_ACTIVE", "Character already has an active turn.", {
        characterId: this.characterId,
        activeTurnId: this.activeTurnId,
      });
    }
    const primaryWake = this.inFlightWake
      ? this.mailbox.find(row => row.wakeId === this.inFlightWake.wakeId) : this.mailbox[0];
    if (!primaryWake) return null;
    if (this.inFlightWake) wakeBundle = clone(this.inFlightWake);
    const bundledWakeIds = [...new Set((wakeBundle?.sourceWakeIds || [])
      .map(clean)
      .filter(Boolean))];
    const wake = wakeBundle ? clone(wakeBundle) : clone(primaryWake);
    const sourceWakeIds = bundledWakeIds.length ? bundledWakeIds : [clean(primaryWake.wakeId)];
    if (sourceWakeIds[0] !== clean(primaryWake.wakeId)
      || sourceWakeIds.some((wakeId) => !this.mailbox.some((row) => clean(row.wakeId) === wakeId))) {
      throw fail("CHARACTER_ACTOR_WAKE_BUNDLE_INVALID", "A coalesced wake must start with the current mailbox head and cite only pending wakes.", {
        primaryWakeId: clean(primaryWake.wakeId),
        sourceWakeIds,
      });
    }
    // The wake id remains separate causal provenance in the private journal.
    // Embedding it in the turn id makes event -> wake -> turn -> event ids grow
    // recursively during a long conversation.
    const agentTurnId = `agent-turn:${this.characterId}:${this.turnSequence + 1}`;
    this.activeTurnId = agentTurnId;
    this.activeWakeId = clean(primaryWake.wakeId);
    this.activeWakeIds = [...sourceWakeIds];
    this.inFlightWake = { ...clone(wake), sourceWakeIds: [...sourceWakeIds] };
    // Host-owned receipt scope is frozen before private reduction can consume
    // retained self-evidence. It is not supplied by the model result.
    if (this.inFlightReceiptEvidenceIds === null) this.inFlightReceiptEvidenceIds = clone(receiptEvidenceIds);
    this.appendPrivateJournal({ kind: "turn_started", agentTurnId, wakeId: wake.wakeId, sourceWakeIds: [...sourceWakeIds] });
    try {
      await this.open();
      const context = this.contextAssembler({
        characterId: this.characterId,
        agentTurnId,
        wake,
        worldVersion,
        situationProjection,
        privateState: this.privateState,
        rememberedContext,
        receiptEvidenceIds: this.inFlightReceiptEvidenceIds,
      });
      const result = await this.runtimePort.runTurn(this.handle, context);
      for (const key of ["worldPatch", "worldState", "statePatch", "committedEvent", "worldMutation"]) {
        if (Object.hasOwn(result || {}, key)) {
          throw fail("CHARACTER_RUNTIME_WORLD_WRITE_FORBIDDEN", "Character turn tried to write the objective world.", { key });
        }
      }
      if (clean(result.characterId) && clean(result.characterId) !== this.characterId) {
        throw fail("CHARACTER_ACTOR_TURN_RESULT_OWNER_MISMATCH", "Turn result belongs to another character.");
      }
      if (clean(result.agentTurnId) && clean(result.agentTurnId) !== agentTurnId) {
        throw fail("CHARACTER_ACTOR_TURN_RESULT_ID_MISMATCH", "Turn result belongs to another Agent turn.");
      }
      this.privateState = mergeOwnedState(this.privateState, result.privateStatePatch || {});
      const rawAttempt = result.actionAttempt ? clone(result.actionAttempt) : null;
      const actionAttempt = rawAttempt ? {
        ...rawAttempt,
        attemptId: clean(rawAttempt.attemptId) || `action-attempt:${agentTurnId}`,
        actorId: this.characterId,
        agentTurnId,
        expectedWorldVersion: Math.max(0, Math.floor(Number(worldVersion || 0))),
      } : null;
      if (actionAttempt) this.pendingAttemptIds.add(actionAttempt.attemptId);
      const presentation = result.privateResult?.evidencePresentation;
      const handled = new Set([...(presentation?.presentedEvidenceIds || []), ...(presentation?.expiredEvidenceIds || [])]);
      const completedWakeIds = [];
      this.mailbox = this.mailbox.flatMap(row => {
        if (!sourceWakeIds.includes(clean(row.wakeId))) return [row];
        const remaining = presentation ? (row.evidenceIds || []).filter(id => !handled.has(id)) : [];
        if (remaining.length) return [{ ...row, evidenceIds: remaining,
          evidence: (row.evidence || []).filter(item => remaining.includes(item.evidenceId)), previouslyOfferedAtAgentTurnId: agentTurnId }];
        completedWakeIds.push(clean(row.wakeId)); return [];
      });
      for (const wakeId of completedWakeIds) this.unforwardedWakeIds.delete(wakeId);
      for (const wakeId of completedWakeIds) this.seenWakeIds.add(wakeId);
      this.turnSequence += 1;
      this.appendPrivateJournal({
        kind: "turn_completed",
        agentTurnId,
        wakeId: wake.wakeId,
        sourceWakeIds: [...sourceWakeIds],
        actionAttemptId: actionAttempt?.attemptId || "",
      });
      const completedTurn = {
        schemaVersion: CHARACTER_SESSION_ACTOR_VERSION,
        characterId: this.characterId,
        agentTurnId,
        wake: clone(wake),
        actionAttempt,
        privateResult: clone(result.privateResult || {}),
        receiptEvidenceIds: clone(this.inFlightReceiptEvidenceIds),
      };
      if (retainPendingTurn) this.pendingTurn = completedTurn;
      this.inFlightWake = null;
      this.inFlightReceiptEvidenceIds = null;
      return clone(completedTurn);
    } catch (error) {
      this.appendPrivateJournal({ kind: "turn_failed", agentTurnId, wakeId: wake.wakeId, code: error.code || "ERROR" });
      throw error;
    } finally {
      this.activeTurnId = "";
      this.activeWakeId = "";
      this.activeWakeIds = [];
    }
  }

  async applyWorldOutcome(outcome = {}) {
    if (outcome.authority !== "world-resolution") {
      throw fail("CHARACTER_ACTOR_OUTCOME_AUTHORITY_INVALID", "Only world resolution may return an outcome.");
    }
    if (clean(outcome.actorId) && clean(outcome.actorId) !== this.characterId) {
      throw fail("CHARACTER_ACTOR_OUTCOME_OWNER_MISMATCH", "World outcome belongs to another character.");
    }
    const attemptId = clean(outcome.actionAttemptId);
    const outcomeId = clean(outcome.outcomeId);
    const outcomeAlreadyApplied = (this.privateState.appliedPrivateOutcomeIds || []).includes(outcomeId)
      || (this.privateState.appliedPrivateOutcomeRecords || []).some((row) => clean(row?.outcomeId) === outcomeId);
    if (attemptId && !this.pendingAttemptIds.has(attemptId) && !outcomeAlreadyApplied) {
      throw fail("CHARACTER_ACTOR_OUTCOME_ATTEMPT_UNKNOWN", "World outcome does not match this actor's pending attempt.", { attemptId });
    }
    await this.open();
    const result = await this.runtimePort.applyWorldOutcome(this.handle, clone(outcome), {
      characterId: this.characterId,
      privateContext: clone(this.privateState),
    });
    this.privateState = mergeOwnedState(this.privateState, result?.privateStatePatch || {});
    if (attemptId) this.pendingAttemptIds.delete(attemptId);
    if (!result?.idempotent) {
      this.appendPrivateJournal({
        kind: "world_outcome_applied",
        outcomeId,
        actionAttemptId: attemptId,
        worldVersion: Number(outcome.worldVersion || 0),
      });
    }
    return clone(result || {});
  }

  async checkpoint() {
    const runtimeCheckpoint = this.handle
      ? await this.runtimePort.checkpoint(this.handle)
      : clone(this.runtimeCheckpoint);
    return {
      schemaVersion: CHARACTER_SESSION_ACTOR_VERSION,
      characterId: this.characterId,
      privateState: clone(this.privateState),
      mailbox: clone(this.mailbox),
      privateJournal: clone(this.privateJournal),
      seenWakeIds: [...this.seenWakeIds],
      pendingAttemptIds: [...this.pendingAttemptIds],
      pendingTurn: clone(this.pendingTurn),
      inFlightWake: clone(this.inFlightWake),
      inFlightReceiptEvidenceIds: clone(this.inFlightReceiptEvidenceIds),
      executionControl: clone(this.executionControl),
      unforwardedWakeIds: [...this.unforwardedWakeIds],
      turnSequence: this.turnSequence,
      runtimeCheckpoint: clone(runtimeCheckpoint),
    };
  }

  async close() {
    if (!this.handle) return;
    await this.runtimePort.closeSession(this.handle);
    this.handle = null;
  }
}

export function createCharacterSessionActor(input = {}) {
  return new CharacterSessionActor(input);
}

export function restoreCharacterSessionActor(checkpoint = {}, options = {}) {
  return new CharacterSessionActor({
    ...options,
    characterId: checkpoint.characterId,
    checkpoint,
  });
}
