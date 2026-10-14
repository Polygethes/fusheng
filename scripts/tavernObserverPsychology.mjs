import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { playModelPeriodWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";
import { renderApp } from "../src/ui/render.js";
import { createLivePerformance, reduceLivePerformanceEvent } from "../src/ui/livePerformance.js";
import { buildManuscriptTimelineEntries } from "../src/ui/realityTimeline.js";
import { applyGeneratedSetupWorld, exportState, getState, importState, saveDraft } from "../src/state/store.js";

// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "scene";
state.ui.engineMode = "openai";
state.ui.setupCompleted = true;
state.ui.activeTab = "reality";

const privateInputs = [];
const events = [];
let spoken = false;
const draft = await playModelPeriodWithRunners(state, {
  pipelineMode: "live",
  characterAgentProtocolVersion: 1,
  characterIds: ["char_xyy_xiemu", "char_xyy_xieheng"],
  positions: { char_xyy_xiemu: "counter", char_xyy_xieheng: "hall" },
  seedImpacts: [{
    sourceCharacterId: "world:tavern-door",
    sourceZoneId: "threshold",
    type: "physical",
    modality: "sound",
    intensity: 96,
    radius: 3,
    directedTargetId: "char_xyy_xiemu",
    content: "门外有人叩门，柜台上的钥匙轻轻一震。",
    topic: "门外来客",
  }],
  maxSteps: 3,
  onProgress(event) { events.push(structuredClone(event)); },
  runners: {
    async runTavernCausalAgent(input) {
      privateInputs.push(structuredClone(input));
      const target = input.perceivedCharacters.find((item) => item.id !== input.agent.id);
      if (!spoken && target) {
        const candidate = input.privateActionCandidates.find((item) => (
          item.feasible && item.actionKind === "handle_environment_event"
        ));
        assert.ok(candidate, "the perceived door event must remain a selectable Agent-owned candidate");
        spoken = true;
        return { decision: {
          candidateId: candidate.candidateId,
          actionType: "speak",
          speechAct: "inform",
          targetCharacterId: target.id,
          vocalMode: "call_out",
          speech: "门外有人，你先看一眼。",
          visibleAction: `${input.agent.name}按住被震响的钥匙，抬眼看向${target.name}`,
          moveToZoneId: "",
          affordanceId: "",
          informationSourceImpactId: "",
          commitmentAction: "open",
          commitmentTopic: "查看门外来客",
          privateReason: "OBSERVER_ONLY_MOTIVE：客人已经敲门，我得先让离门更近的人去确认，不能让堂前显得没人做主。",
        }, stage: { name: "CausalAgent:observer-psychology", provider: "test", elapsedMs: 1 } };
      }
      const withheldCandidate = input.privateActionCandidates.find((item) => item.feasible);
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
        privateReason: "OBSERVER_ONLY_PASS",
      }, stage: { name: "CausalAgent:observer-pass", provider: "test", elapsedMs: 1 } };
    },
  },
});

const entry = draft.observerPsychology?.find((item) => /OBSERVER_ONLY_MOTIVE/.test(item.privateReason || ""));
assert.ok(entry, "the accepted Agent decision must retain one observer-only motivation entry");
assert.equal(entry.actionId, draft.causalScene.actions[0].id, "psychology must bind to the exact canonical action id");
assert.equal(entry.characterId, draft.causalScene.actions[0].actorId, "psychology must bind to the acting Agent");
assert.match(entry.trigger?.content || "", /叩门|钥匙/, "the observer note should retain the actually perceived trigger");
assert.ok(entry.desire || entry.currentIntention, "the observer note should expose the current desire or intention used by the Agent");
assert.ok(entry.selectedIntent?.selectedCandidateId, "the observer note must identify the exact intent selected by the Character Agent");
assert.ok(entry.factorTrace?.candidates?.some((candidate) => candidate.candidateId === entry.factorTrace.selectedCandidateId), "the observer note must retain the selected score and its factor ledger");

const forbiddenPublicSurfaces = {
  novelText: draft.novelText,
  actions: draft.causalScene.actions,
  impacts: draft.causalScene.impacts,
  deliveries: draft.causalScene.deliveries,
  updateBundle: draft.updateBundle,
  eventThreads: draft.updateBundle.tavernState?.eventThreads,
};
assert.ok(!JSON.stringify(forbiddenPublicSurfaces).includes("OBSERVER_ONLY_"), "observer psychology must not enter public world facts or Agent-readable state");
assert.ok(privateInputs.every((input) => !JSON.stringify(input).includes("OBSERVER_ONLY_MOTIVE")), "later Agent inputs must never receive another Agent's observer note");

const streamedDialogue = events.find((event) => event.type === "dialogue" && /门外有人/.test(event.line || ""));
assert.equal(streamedDialogue?.observerPsychology?.actionId, entry.actionId, "live dialogue must carry the matching observer-only note");

Object.assign(entry, {
  relationshipAppraisal: {
    relationshipId: "rel_xyy_xiemu_to_xieheng",
    fromCharacterId: "char_xyy_xiemu",
    toCharacterId: "char_xyy_xieheng",
    closeness: 63,
    tension: 18,
    trust: 71,
  },
  copingBias: { approach: 0.14, avoid: 0.08, assert: 0.12, inhibit: 0.1, repair: 0.56, repairNeed: 0.78, dominant: "repair" },
  expressionStrategy: { mode: "relationship-repair", directness: "direct", warmth: "warm", motive: "repair" },
  eventAppraisal: {
    applied: true,
    impactId: "impact_observer_ui_contract",
    cueIds: ["unattended_guest"],
    affect: {
      before: { valence: 0.12, arousal: 0.28, dominance: 0.52 },
      after: { valence: -0.08, arousal: 0.47, dominance: 0.45 },
    },
    copingBias: { dominant: "repair" },
    sensitivities: [{
      sensitivityId: "sensitivity_xiemu_unattended_guest",
      threatMeaning: "客人进门却无人招呼",
      matchedCueIds: ["unattended_guest"],
      after: 0.64,
    }],
  },
});

const observed = {
  ...state,
  draftScenes: [draft],
  ui: {
    ...state.ui,
    lastDraftId: draft.id,
    observerPlayback: { draftId: draft.id, visibleCount: 4, totalCount: 4, status: "complete" },
  },
};
const html = renderApp(observed);
assert.match(html, /data-agent-mind-trigger/, "the responding portrait must be an interactive psychology trigger");
assert.match(html, /OBSERVER_ONLY_MOTIVE/, "the observer tooltip must render the actual Agent reason without rewriting it");
assert.match(html, /仅观察者可见/, "the tooltip must mark the epistemic boundary explicitly");
assert.match(html, /人物选中的行动/, "the tooltip must show which scored option the Character Agent selected");
assert.match(html, /推动因子|阻碍因子/, "the tooltip must explain the strongest personal factors behind the action");
assert.match(html, /本人对对方的关系/, "the tooltip must expose the acting character's directional relationship appraisal");
assert.match(html, /亲近 63 · 戒备 18 · 信任 71/, "the relationship row must render the exact directed values used by the Agent");
assert.match(html, /这件事造成的心理变化/, "the tooltip must expose affect before and after the perceived event");
assert.match(html, /被触发的敏感点/, "the tooltip must expose the named sensitivity activated by the event");
assert.match(html, /客人进门却无人招呼 64%/, "the sensitivity row must render the real activation level");
assert.match(html, /应对与表达/, "the tooltip must expose coping and expression strategy together");
assert.match(html, /修复关系 · 先修复关系/, "the coping row must render the selected dominant response and expression strategy");
assert.match(html, /修复需要 78%/, "the observer must see why relationship repair is currently available");

applyGeneratedSetupWorld(state, state.worldSetup?.sourcePrompts || {});
saveDraft(draft);
const serialized = exportState();
assert.ok(serialized.includes("OBSERVER_ONLY_MOTIVE"), "observer psychology must survive a refresh");
importState(serialized);


const restored = getState().draftScenes.find((item) => item.id === draft.id);
assert.equal(restored.observerPsychology?.[0]?.actionId, entry.actionId, "persisted psychology must keep its action binding");
assert.equal(restored.observerPsychology?.[0]?.factorTrace?.selectedCandidateId, entry.factorTrace.selectedCandidateId, "formula provenance must survive refresh with the hover explanation");
assert.ok(restored.observerPsychology?.[0]?.factorTrace?.candidates?.[0]?.positiveFactors?.length, "the strongest personal factors must survive refresh");
assert.equal(restored.observerPsychology?.[0]?.relationshipAppraisal?.toCharacterId, "char_xyy_xieheng", "the exact directed relationship appraisal must survive refresh");
assert.equal(restored.observerPsychology?.[0]?.eventAppraisal?.sensitivities?.[0]?.after, 0.64, "the event-specific sensitivity activation must survive refresh");
assert.equal(restored.observerPsychology?.[0]?.copingBias?.dominant, "repair", "the coping choice must survive refresh");
assert.equal(restored.observerPsychology?.[0]?.copingBias?.repairNeed, 0.78, "the sourced repair need must survive refresh");
assert.equal(restored.observerPsychology?.[0]?.expressionStrategy?.mode, "relationship-repair", "the expression strategy must survive refresh");

const silentPsychology = {
  schemaVersion: 1,
  visibility: "observer-only",
  source: "causal-character-agent-decision",
  actionId: "silent_action_yan",
  characterId: "char_xyy_yanzhizhong",
  characterName: "严执中",
  desire: "亲眼确认堂前的人和名录是否相符",
  currentIntention: "先观察眼前的人",
  privateReason: "",
  formulaReason: "候选记录就在眼前，人物权衡后选择先停步观察。",
  selectedIntent: {
    selectedCandidateId: "observe_candidate",
    label: "站定观察眼前的人",
    actionKind: "observe_target",
    targetCharacterId: "char_xyy_xiezenshi",
    activationScore: 61,
  },
  factorTrace: {
    visibility: "observer-only",
    formulaVersion: "test-v1",
    selectedCandidateId: "observe_candidate",
    candidates: [{ candidateId: "observe_candidate", label: "站定观察眼前的人", activationScore: 61, feasible: true }],
  },
  relationshipAppraisal: { toCharacterId: "char_xyy_xiezenshi", closeness: 8, tension: 21, trust: 12 },
  copingBias: { dominant: "inhibit" },
  expressionStrategy: { mode: "silent-focus" },
  trigger: { type: "visual", modality: "visual", content: "谢真石正在堂前活动。", topic: "核验候选", directed: false },
};
const motherSilentPsychology = {
  ...silentPsychology,
  actionId: "silent_action_mother",
  characterId: "char_xyy_xiemu",
  characterName: "谢母",
  formulaReason: "灶边的水壶挡着火口，人物权衡后选择先把它提开。",
  selectedIntent: { ...silentPsychology.selectedIntent, selectedCandidateId: "clear_stove", label: "提开水壶", actionKind: "handle_environment_event", targetCharacterId: "" },
  factorTrace: { ...silentPsychology.factorTrace, selectedCandidateId: "clear_stove", candidates: [{ candidateId: "clear_stove", label: "提开水壶", activationScore: 58, feasible: true }] },
};

let silentLive = createLivePerformance({ locationName: "望梯酒馆", grain: "scene" });
silentLive = reduceLivePerformanceEvent(silentLive, {
  type: "action",
  id: "silent_action_yan",
  actorId: "char_xyy_yanzhizhong",
  actorName: "严执中",
  text: "严执中向前走了两步，站定注视",
  observerPsychology: silentPsychology,
});
silentLive = reduceLivePerformanceEvent(silentLive, { type: "novel_delta", text: "严执中向前走了两步，站定注视。\n\n" });
silentLive = reduceLivePerformanceEvent(silentLive, {
  type: "action",
  id: "silent_action_mother",
  actorId: "char_xyy_xiemu",
  actorName: "谢母",
  text: "谢母把灶边的水壶提到一旁",
  observerPsychology: motherSilentPsychology,
});
silentLive = reduceLivePerformanceEvent(silentLive, { type: "novel_delta", text: "谢母把灶边的水壶提到一旁。\n\n" });

const retainedSilentPsychology = silentLive.events.find((event) => event.id === "silent_action_yan")?.observerPsychology;
assert.equal(retainedSilentPsychology?.formulaReason, silentPsychology.formulaReason, "formula-only silent actions must survive live event sanitization");
assert.equal(retainedSilentPsychology?.factorTrace?.selectedCandidateId, "observe_candidate", "live sanitization must retain the complete factor trace");
assert.equal(retainedSilentPsychology?.relationshipAppraisal?.toCharacterId, "char_xyy_xiezenshi", "live sanitization must retain relationship appraisal without a privateReason");

const parsedSilentActions = buildManuscriptTimelineEntries(silentLive.novelText, [], {}, silentLive.events.filter((event) => event.type === "action"));
assert.deepEqual(
  parsedSilentActions.map((item) => item.actionId),
  ["silent_action_yan", "silent_action_mother"],
  "separate causal actions must not merge into one narration after manuscript parsing",
);
assert.equal(parsedSilentActions[0].actorId, "char_xyy_yanzhizhong", "parsed silent narration must retain its actor binding");
assert.equal(parsedSilentActions[0].observerPsychology?.formulaReason, silentPsychology.formulaReason, "parsed silent narration must retain its psychology binding");

const authoritativeSceneText = `严执中带着掌籍名录留在堂前，正等酒馆经手人同他办理候选留宿与接引登记。\n\n${silentLive.novelText}`;
silentLive = reduceLivePerformanceEvent(silentLive, {
  type: "scene_complete",
  sceneText: authoritativeSceneText,
  locationName: "望梯酒馆",
  slotLabel: "午后",
});
assert.equal(silentLive.novelText, authoritativeSceneText, "scene_complete must replace the action-only stream with the authoritative text that includes public visit context");
const completedLiveEntries = buildManuscriptTimelineEntries(silentLive.novelText, [], {}, silentLive.events.filter((event) => event.type === "action"));
assert.match(completedLiveEntries[0]?.text || "", /候选留宿与接引登记/, "the public visit purpose must remain the visible beginning after completion");
assert.equal(completedLiveEntries.find((item) => item.actionId === "silent_action_yan")?.observerPsychology?.formulaReason, silentPsychology.formulaReason, "authoritative completion text must keep the silent action psychology binding");

const liveObserved = {
  ...state,
  ui: {
    ...state.ui,
    livePerformance: silentLive,
  },
};
const silentHtml = renderApp(liveObserved);
assert.match(silentHtml, /data-agent-action-id="silent_action_yan"/, "the manuscript timeline must render a psychology trigger for the first silent action");
assert.match(silentHtml, /data-agent-action-id="silent_action_mother"/, "the manuscript timeline must render a separate psychology trigger for the next silent action");
assert.match(silentHtml, /候选记录就在眼前，人物权衡后选择先停步观察/, "Agent-owned motivation must remain visible to the observer after novel text arrives");

const completedSilentDraft = {
  ...draft,
  id: "draft_silent_action_binding",
  novelText: silentLive.novelText,
  sceneText: silentLive.novelText,
  observerPsychology: [silentPsychology, motherSilentPsychology],
  causalScene: {
    ...(draft.causalScene || {}),
    actions: [
      { id: "silent_action_yan", actorId: "char_xyy_yanzhizhong", actorName: "严执中", visibleAction: "严执中向前走了两步，站定注视" },
      { id: "silent_action_mother", actorId: "char_xyy_xiemu", actorName: "谢母", visibleAction: "谢母把灶边的水壶提到一旁" },
    ],
  },
};
const completedSilentHtml = renderApp({
  ...state,
  draftScenes: [completedSilentDraft],
  ui: {
    ...state.ui,
    lastDraftId: completedSilentDraft.id,
    livePerformance: null,
    observerPlayback: { draftId: completedSilentDraft.id, visibleCount: 2, totalCount: 2, status: "complete" },
  },
});
assert.match(completedSilentHtml, /data-agent-action-id="silent_action_yan"/, "the completed manuscript timeline must retain the first silent action binding");
assert.match(completedSilentHtml, /data-agent-action-id="silent_action_mother"/, "the completed manuscript timeline must keep separate action ids after reload-style rendering");

console.log("tavernObserverPsychology:test passed", {
  actionId: entry.actionId,
  characterId: entry.characterId,
  streamed: Boolean(streamedDialogue),
  silentActionsBound: parsedSilentActions.length,
});
