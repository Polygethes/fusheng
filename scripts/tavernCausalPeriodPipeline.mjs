import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { playModelPeriodWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";
import { renderApp } from "../src/ui/render.js";
import { applyGeneratedSetupWorld, applyUpdateBundle, exportState, getState, importState, saveDraft } from "../src/state/store.js";

// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "day";
state.ui.engineMode = "openai";
state.ui.setupCompleted = true;
const startDay = Number(state.tavernState.day || 0);
const startTick = Number(state.tavernState.tick || 0);
let oldDecisionCalls = 0;
let witnessCalls = 0;
const causalInputs = [];
const callsBySlot = new Map();
let allowPersistedRequestAnswer = false;

const runners = {
    async runTavernAgentDecision() {
      oldDecisionCalls += 1;
      throw new Error("legacy full-period decision replay must not run");
    },
    async runBackgroundSlot() {
      witnessCalls += 1;
      throw new Error("Activity Witness must not rewrite causal period prose");
    },
    async runTavernCausalAgent(input) {
      causalInputs.push(structuredClone(input));
      const slotKey = input.scene.slotId;
      const callIndex = callsBySlot.get(slotKey) || 0;
      callsBySlot.set(slotKey, callIndex + 1);
      const target = input.perceivedCharacters.find((item) => item.identityKnown) || input.perceivedCharacters[0];
      const feasibleCandidates = input.privateActionCandidates.filter((item) => item.feasible);
      const affordance = (input.availableAffordances || []).find((item) => (
        feasibleCandidates.some((candidate) => candidate.realization?.affordanceId === item.id)
      )) || null;
      const affordanceCandidate = affordance
        ? feasibleCandidates.find((candidate) => candidate.realization?.affordanceId === affordance.id)
        : null;
      const socialCandidate = feasibleCandidates.find((candidate) => (
        candidate.targetCharacterId
        && input.perceivedCharacters.some((character) => character.id === candidate.targetCharacterId)
        && (candidate.realization?.requireSpeech || candidate.realization?.allowSpeech !== false)
      )) || feasibleCandidates.find((candidate) => (
        !candidate.targetCharacterId && candidate.realization?.allowSpeech === true
      )) || null;
      const receivedUnappraisedThread = (input.openConversationThreads || []).find((thread) => (
        thread.myState?.processingStatus === "received_unappraised"
      ));
      const incomingThread = receivedUnappraisedThread
        || (input.openConversationThreads || []).find((thread) => (
          thread.id === input.activation?.sourceThreadId
          || thread.nextObligationCharacterId === input.agent.id
        ));
      const latestIncomingTurn = incomingThread?.turns?.at(-1) || null;
      const incomingTurnRole = `${latestIncomingTurn?.turnRole || ""} ${latestIncomingTurn?.speechAct || ""} ${(latestIncomingTurn?.speechFunctions || []).join(" ")}`;
      const incomingTurnRequestsAnswer = /ask|question|request|open/.test(incomingTurnRole);
      if (allowPersistedRequestAnswer && incomingThread && incomingTurnRequestsAnswer) {
        const requesterId = latestIncomingTurn?.speakerId || input.activation?.sourceCharacterId || "";
        const responseCandidate = feasibleCandidates.find((candidate) => candidate.targetCharacterId === requesterId)
          || feasibleCandidates.find((candidate) => candidate.actionKind === "handle_environment_event")
          || feasibleCandidates[0]
          || null;
        return { decision: {
          candidateId: responseCandidate?.candidateId || "",
          actionType: "speak",
          speechAct: "answer",
          speechFunctions: ["answer", "inform"],
          targetCharacterId: requesterId,
          speech: `${input.scene.slotLabel}的事我听见了，现在给你明确答复。`,
          visibleAction: `${input.agent.name}停下手里的动作看向对方`,
          moveToZoneId: "",
          affordanceId: "",
          informationSourceImpactId: "",
          commitmentAction: "none",
          commitmentTopic: input.activation?.topic || "当前请求",
          communicationPlan: {
            goal: "inform",
            tactic: "direct",
            disclosure: "full",
            epistemicRelation: "believes",
            intendedAudienceCharacterIds: [requesterId],
            desiredEffect: "明确回答刚才抵达本人的请求",
            threadDisposition: "settle",
          },
          privateReason: "对方的请求仍停在当前时段，本人现在明确回答。",
        }, stage: { name: `Causal:${slotKey}:answer`, provider: "test", elapsedMs: 1 } };
      }
      if (allowPersistedRequestAnswer && receivedUnappraisedThread) {
        const sourceTurnId = receivedUnappraisedThread.turns?.at(-1)?.id
          || receivedUnappraisedThread.myState?.lastReceivedTurnId
          || "";
        return { decision: {
          candidateId: feasibleCandidates[0]?.candidateId || "",
          actionType: "pass",
          speechAct: "none",
          targetCharacterId: "",
          speech: "",
          visibleAction: "",
          moveToZoneId: "",
          affordanceId: "",
          informationSourceImpactId: "",
          commitmentAction: "none",
          commitmentTopic: "",
          privateReason: "已经听见明确回应，这个请求对本人可以结束。",
          cognitiveAppraisal: {
            noticedEvidenceIds: [],
            interpretations: [],
            beliefOperations: [],
            threadAppraisals: [{
              threadId: receivedUnappraisedThread.id,
              sourceTurnId,
              interpretation: "answered",
              satisfaction: "satisfied",
              responseNeed: "none",
              selfClosure: "closed_for_self",
              summary: "对方已经明确回答，本人不再追问。",
            }],
          },
          communicationPlan: {
            goal: "none",
            tactic: "silence",
            disclosure: "withhold",
            epistemicRelation: "not_applicable",
            intendedAudienceCharacterIds: [],
            desiredEffect: "",
            threadDisposition: "none",
          },
        }, stage: { name: `Causal:${slotKey}:listener-appraisal`, provider: "test", elapsedMs: 1 } };
      }
      if (callIndex === 0 && affordance && affordanceCandidate) {
        const purpose = affordance.type === "declare_visit_purpose"
          ? affordance.label.replace(/^.*?说明[：:]?/, "")
          : "";
        return { decision: {
          candidateId: affordanceCandidate.candidateId,
          actionType: affordance.actionType,
          speechAct: purpose ? "inform" : "none",
          targetCharacterId: affordance.targetCharacterId || "",
          speech: purpose ? `我来${purpose}。` : "",
          visibleAction: "",
          moveToZoneId: affordance.moveToZoneId || "",
          affordanceId: affordance.id,
          informationSourceImpactId: "",
          commitmentAction: "none",
          commitmentTopic: purpose,
          privateReason: "人物先处理自己此刻真正选中的可提交事务。",
        }, stage: { name: `Causal:${slotKey}`, provider: "test", elapsedMs: 1 } };
      }
      if (callIndex === 0 && target && socialCandidate) {
        const chosenTargetId = socialCandidate.targetCharacterId || target.id;
        return { decision: {
          candidateId: socialCandidate.candidateId,
          actionType: "speak",
          speechAct: "inform",
          targetCharacterId: chosenTargetId,
          speech: `${input.scene.slotLabel}的事现在说清。`,
          visibleAction: `${input.agent.name}停下手里的动作看向对方`,
          moveToZoneId: "",
          affordanceId: "",
          informationSourceImpactId: "",
          commitmentAction: "none",
          commitmentTopic: "",
          privateReason: "只处理当前时段实际抵达的影响。",
        }, stage: { name: `Causal:${slotKey}`, provider: "test", elapsedMs: 1 } };
      }
      const withheldCandidate = feasibleCandidates[0] || null;
      return { decision: {
        candidateId: withheldCandidate?.candidateId || "",
        actionType: "pass",
        speechAct: "none",
        targetCharacterId: "",
        speech: "",
        visibleAction: "",
        moveToZoneId: "",
        affordanceId: "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        privateReason: "当前影响已经处理。",
      }, stage: { name: `Causal:${slotKey}:pass`, provider: "test", elapsedMs: 1 } };
    },
};

const periodOptions = {
  pipelineMode: "live",
  characterAgentProtocolVersion: 1,
  maxStepsPerSlot: 4,
  runners,
};

applyGeneratedSetupWorld(state, state.worldSetup?.sourcePrompts || {});
const draft = await playModelPeriodWithRunners(state, periodOptions);
const periodDrafts = [draft];
applyUpdateBundle(draft.updateBundle);
let resumedState = structuredClone(getState());
allowPersistedRequestAnswer = true;
for (let resumeAttempt = 0; resumedState.tavernState?.periodCursor?.status === "blocked" && resumeAttempt < 12; resumeAttempt += 1) {
  const resumedDraft = await playModelPeriodWithRunners(resumedState, periodOptions);
  periodDrafts.push(resumedDraft);
  applyUpdateBundle(resumedDraft.updateBundle);
  resumedState = structuredClone(getState());
}
const completedDraft = periodDrafts.at(-1);
const allTicks = periodDrafts.flatMap((periodDraft) => periodDraft.periodSimulation.ticks || []);
const completedSlotLabels = allTicks
  .filter((tick, index) => tick.causalScene?.macroTimeAdvanced || index === allTicks.length - 1)
  .map((tick) => tick.label)
  .filter((label, index, labels) => label !== labels[index - 1]);

assert.equal(oldDecisionCalls, 0, "day mode must not probe and replay a prewritten deterministic day");
assert.equal(witnessCalls, 0, "day mode must not call a second prose author");
assert.equal(draft.pipelineMeta.mode, "model-tavern-causal-period");
assert.match(draft.pipelineMeta.pipeline, /MacroTrigger→CausalAgentScene→Commit→AdvanceClock/);
assert.deepEqual(completedSlotLabels, ["清晨", "正午", "午后", "黄昏", "夜深"]);
assert.ok(allTicks.every((tick) => tick.causalScene));
assert.ok(allTicks.every((tick) => tick.agentParticipation?.witness?.ran === false));
assert.equal(completedDraft.updateBundle.tavernState.periodCursor, null, "resume must eventually clear the blocked period cursor");
assert.ok(causalInputs.length >= 5 && causalInputs.every((input) => input.scene.slotId && input.scene.slotLabel));
assert.equal(completedDraft.updateBundle.tavernState.day, startDay + 1);
assert.equal(completedDraft.updateBundle.tavernState.tick, startTick + 5);
assert.ok(completedDraft.updateBundle.characters.every((character) => character.ecologyState?.characterId === character.id), "the completed day must return every Agent's updated body, desire, intention, and offstage presence state");
assert.ok(periodDrafts.length >= 2, "the fixture must exercise the persisted period-resume path");
assert.ok(draft.causalPeriod.blockedBy, "the first command must preserve its unresolved slot instead of advancing past it");
assert.ok(completedDraft.causalPeriod.slots.every((slot) => slot.committedBeforeNextSlot === true));

for (const periodDraft of periodDrafts) {
  for (const tick of periodDraft.periodSimulation.ticks) {
    for (const exchange of tick.sceneInteraction?.agentExchanges || []) {
      for (const turn of exchange.dialogueTurns || []) {
        assert.equal(turn.slotId, tick.slotId, "dialogue provenance remains inside the causal scene where it happened");
        const occurrences = periodDraft.novelText.split(turn.line).length - 1;
        assert.equal(occurrences, 1, `canonical dialogue must be authored once: ${turn.line}`);
      }
    }
  }
}

assert.ok(periodDrafts.every((periodDraft) => !JSON.stringify(periodDraft.pipelineMeta).includes("ActivityWitness")));
assert.ok(periodDrafts.every((periodDraft) => !JSON.stringify(periodDraft.pipelineMeta).includes("AffordanceProbe")));

const html = renderApp({
  ...state,
  draftScenes: [draft],
  ui: { ...state.ui, activeTab: "reality", lastDraftId: draft.id, observerPlayback: { draftId: draft.id, visibleCount: 50, totalCount: 50, status: "complete" } },
});
assert.match(html, /清晨 · 0–/);
assert.match(html, /场景整理：未调用/);
assert.doesNotMatch(html, /Activity Witness/);

saveDraft(completedDraft);
const canonicalDraftBytes = JSON.stringify(completedDraft).length;
assert.ok(canonicalDraftBytes < 2_000_000, `the canonical resumed causal-period draft must stay below the 2MB guard: ${canonicalDraftBytes}`);
const serialized = exportState();
importState(serialized);


const restored = getState().draftScenes.find((item) => item.id === completedDraft.id);
assert.deepEqual(
  restored.periodSimulation.ticks.map((tick) => tick.label),
  completedDraft.periodSimulation.ticks.map((tick) => tick.label),
);
assert.equal(
  restored.periodSimulation.ticks[0].causalScene.slotLabel,
  completedDraft.periodSimulation.ticks[0].causalScene.slotLabel,
);
assert.ok(restored.periodSimulation.ticks.every((tick) => tick.causalScene?.actions));

console.log("tavernCausalPeriodPipeline:test passed", {
  slots: completedSlotLabels.length,
  resumes: periodDrafts.length - 1,
  causalCalls: causalInputs.length,
  day: completedDraft.updateBundle.tavernState.day,
  tick: completedDraft.updateBundle.tavernState.tick,
  draftBytes: canonicalDraftBytes,
  snapshotBytes: serialized.length,
});
