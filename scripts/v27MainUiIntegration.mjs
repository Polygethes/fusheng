// Contract: the v2.7 character-owned runtime is reachable from the main UI.
//
// The runtime shipped behind a standalone `/v27.html` page while the main
// reality space kept running the legacy scene pipeline, so the architecture the
// project had converged on was unreachable for anyone who did not type the URL.
// The reality space now offers it as a third run mode alongside the rule preview
// and the remote model.
//
// It also has to stay honest about what it produces: a v2.7 run commits world
// facts and character turns, not a narrated scene draft, so there is nothing for
// "写入正史" to accept.

import assert from "node:assert/strict";
import { renderApp } from "../src/ui/render.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createV27SessionController } from "../src/engine/v27SessionController.js";
import {
  normalizeV27Observation,
  mergeV27ObservationHistory,
  runV27LocalObservation,
  v27RuntimeIdForWorld,
} from "../src/engine/v27Service.js";

function baseState(engineMode) {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  state.ui.setupCompleted = true;
  state.ui.activeTab = "reality";
  state.ui.engineMode = engineMode;
  state.branches = [{ id: "branch_main", title: "主线", snapshot: {} }];
  return state;
}

function publicObservation(sessionId, turnId, speech = "", {
  runtimeId = "tavern-v27",
  sessionRevision = 2,
  worldVersion = 1,
} = {}) {
  return {
    mode: "local-character-agent-fixture-persistent",
    externalModelCalled: false,
    authorQualityVerdict: "not_claimed",
    worldVersion,
    eventCount: 1,
    schemaVersion: "test",
    sessionRef: {
      runtimeId,
      sessionId,
      sessionRevision,
      worldVersion,
    },
    turns: [{
      index: 1,
      characterId: "char_xyy_xiezenshi",
      characterName: "谢真石",
      agentTurnId: turnId,
      wakeKind: "opportunity_window",
      submissionMode: "atomic",
      characterAgentCompleted: true,
      acceptedStageCount: 4,
      expectedAcceptedStageCount: 4,
      fiveStageCompleted: false,
      protocolRepairCount: 0,
      actionType: speech ? "speak" : "observe",
      targetCharacterId: "char_xyy_luozhao",
      speech,
      visibleAction: "谢真石抬起眼。",
      affectiveTexture: ["目光停了一瞬"],
      outcome: { status: "settled", label: "世界已接住动作", detail: "世界版本 1" },
      privateState: { mustNeverPersist: true },
    }],
    checkpoint: { mustNeverPersist: true },
    observerOnlyPsychology: { privateDecisionBasis: "不得进入公开账本" },
  };
}

// 1. The run mode is offered on the fixed stage, next to the existing two.
{
  const html = renderApp(baseState("local"));
  assert.match(html, /data-engine-mode="v27"/, "the reality space must offer the v2.7 run mode");
  assert.match(html, /人物自决/, "the v2.7 run mode must be labelled for the author, not by version number alone");
  assert.match(html, /data-engine-mode="local"/, "the rule preview must remain available");
  assert.match(html, /data-engine-mode="openai"/, "the remote model must remain available");
}

// 2. Selecting it changes the reality space rather than leaving the legacy
//    timeline on screen under a new label.
{
  const html = renderApp(baseState("v27"));
  assert.match(html, /v2\.7 人物自决/, "the header must report the active runtime");
  assert.match(html, /运行人物回合/, "the primary action must describe a character turn, not scene playback");
  assert.match(html, /href="\/v27\.html"/, "the main reality space must link to the authorized real-model observation page");
  assert.match(html, /真实人物观察页/, "the dedicated model surface needs a non-technical entry label");
  assert.doesNotMatch(html, /data-agent-participation/, "the legacy agent participation strip must not render under v2.7");
  assert.doesNotMatch(html, /五阶段心理回合|本地五阶段夹具/, "the current atomic runtime must not be introduced as the historical five-stage flow");
}

// 3. A v2.7 run has no draft to canonise, so accepting must stay disabled.
{
  const html = renderApp(baseState("v27"));
  const acceptButton = html.match(/<button[^>]*data-action="accept-draft"[^>]*>/);
  assert.ok(acceptButton, "the accept control must still be present");
  assert.match(acceptButton[0], /disabled/, "a v2.7 run produces world facts, not a scene draft to accept as canon");
}

// 4. Committed turns render with speech, visible action and world settlement.
{
  const state = baseState("v27");
  state.ui.v27Observation = normalizeV27Observation({
    mode: "local-character-agent-fixture",
    externalModelCalled: false,
    authorQualityVerdict: "not_claimed",
    runtime: {
      worldVersion: 2,
      eventCount: 2,
      turns: [
        {
          characterId: "char_xyy_xiezenshi",
          characterName: "谢真石",
          agentTurnId: "agent-turn:char_xyy_xiezenshi:1",
          submissionMode: "atomic",
          characterAgentCompleted: true,
          acceptedStageCount: 4,
          expectedAcceptedStageCount: 4,
          fiveStageAgentCompleted: false,
          protocolRepairCount: 0,
          publicRealization: {
            actionType: "speak",
            targetCharacterId: "char_xyy_luozhao",
            speech: "客官，要些什么？",
            visibleAction: "谢真石从柜边抬起眼。",
            observableAffectiveTexture: [{ channel: "voice", feature: "语气自然" }],
          },
          outcome: { status: "settled", worldVersion: 1, durationSeconds: 1, failedEffects: [] },
        },
        {
          characterId: "char_xyy_luozhao",
          characterName: "洛照",
          agentTurnId: "agent-turn:char_xyy_luozhao:1",
          submissionMode: "atomic",
          characterAgentCompleted: true,
          acceptedStageCount: 4,
          expectedAcceptedStageCount: 4,
          fiveStageAgentCompleted: false,
          protocolRepairCount: 1,
          publicRealization: { actionType: "pass", speech: "", visibleAction: "", observableAffectiveTexture: [] },
          outcome: null,
        },
      ],
    },
  });
  const html = renderApp(state);
  assert.match(html, /客官，要些什么？/, "committed speech must reach the observer");
  assert.match(html, /谢真石从柜边抬起眼。/, "the visible action must reach the observer");
  assert.match(html, /语气自然/, "observable affective texture must reach the observer");
  assert.match(html, /世界已接住动作/, "world settlement must be reported");
  assert.match(html, /原子人物回合完成/, "current v2.7 turns must identify atomic completion");
  assert.doesNotMatch(html, /五阶段人物回合完成|五阶段完成/, "atomic turns may not be presented as legacy five-stage completion");
  assert.match(html, /这一回合没有对外发生可见动作或台词/, "a silent turn must be reported as silence, not filled in");
  assert.match(html, /含 1 次协议自主修正/, "a protocol repair must stay visible instead of being smoothed over");
  assert.match(html, /未调用外部模型/, "a local run must state that no provider was called");
}

// 4b. Historical staged observations remain readable, but only those records
//     receive the five-stage compatibility label.
{
  const state = baseState("v27");
  state.ui.v27Observation = normalizeV27Observation({
    mode: "local-five-stage-fixture",
    externalModelCalled: false,
    runtime: {
      worldVersion: 1,
      eventCount: 1,
      turns: [{
        characterId: "char_xyy_xiezenshi",
        characterName: "谢真石",
        agentTurnId: "agent-turn:legacy-staged:1",
        submissionMode: "staged",
        fiveStageAgentCompleted: true,
        publicRealization: { actionType: "pass", speech: "", visibleAction: "", observableAffectiveTexture: [] },
        outcome: null,
      }],
    },
  });
  const html = renderApp(state);
  assert.match(html, /五阶段人物回合完成/, "legacy staged observations must remain intelligible");
  assert.doesNotMatch(html, /原子人物回合完成/, "staged compatibility records may not masquerade as atomic completion");
}

// 4c. A private day-planning turn is a completed Character operation, not an
//     undeclared action or a claim that the Character merely stayed silent.
{
  const state = baseState("v27");
  state.ui.v27Observation = normalizeV27Observation({
    mode: "local-character-agent-fixture-persistent",
    externalModelCalled: false,
    runtime: {
      worldVersion: 1,
      eventCount: 1,
      turns: [{
        characterId: "char_xyy_xiezenshi",
        characterName: "谢真石",
        agentTurnId: "agent-turn:day-planning:1",
        wakeKind: "day_planning_due",
        turnKind: "day_planning",
        submissionMode: "day_planning",
        characterAgentCompleted: true,
        acceptedStageCount: 1,
        expectedAcceptedStageCount: 1,
        publicRealization: {},
        outcome: null,
      }],
    },
  });
  assert.equal(state.ui.v27Observation.turns[0].turnKind, "day_planning",
    "the observer normalizer must retain the public turn classification");
  const html = renderApp(state);
  assert.match(html, /安排接下来一天/u);
  assert.match(html, /私有日计划已形成/u);
  assert.doesNotMatch(html, /未声明|人物保持沉默或继续观察/u,
    "private planning must not be misreported as an undeclared or silent public action");
  assert.doesNotMatch(html, /planBlocks|privatePurpose|sourceIds/u,
    "the observer may know planning occurred but never receive its private contents");
}

// 4d. Reflection is the other private maintenance turn. Older durable/public
//     observations may carry only submissionMode, so the client must recover
//     the same public classification without exposing any insight text.
{
  const state = baseState("v27");
  state.ui.v27Observation = normalizeV27Observation({
    mode: "local-character-agent-fixture-persistent",
    externalModelCalled: false,
    runtime: {
      worldVersion: 1,
      eventCount: 1,
      turns: [{
        characterId: "char_xyy_xiezenshi",
        characterName: "谢真石",
        agentTurnId: "agent-turn:reflection:1",
        wakeKind: "reflection_due",
        turnKind: "action",
        submissionMode: "reflection",
        characterAgentCompleted: true,
        acceptedStageCount: 1,
        expectedAcceptedStageCount: 1,
        publicRealization: {},
        outcome: null,
        reflection: {
          insights: [{ proposition: "这段私人洞见绝不能出现在观察界面。" }],
        },
      }],
    },
  });
  assert.equal(state.ui.v27Observation.turns[0].turnKind, "reflection",
    "private maintenance submissionMode must fail closed even when a legacy turnKind says action");
  const html = renderApp(state);
  assert.match(html, /私有反思已完成/u);
  assert.match(html, /仅更新人物自己的理解/u);
  assert.match(html, /没有新增世界事实/u);
  assert.doesNotMatch(html, /未声明|这一行动从人物内部如何形成|这段私人洞见/u,
    "private reflection must be labelled without masquerading as an action or leaking insight content");
}

// 5. The normalizer refuses placeholder tokens, matching the world bridge: "无"
//    is an empty answer, not a visible action.
{
  const observation = normalizeV27Observation({
    runtime: {
      turns: [{
        characterId: "c1",
        characterName: "某人",
        publicRealization: { actionType: "act", speech: "无", visibleAction: "none", observableAffectiveTexture: [{ feature: "N/A" }] },
        outcome: null,
      }],
    },
  });
  const [turn] = observation.turns;
  assert.equal(turn.speech, "", "placeholder speech must normalise to empty");
  assert.equal(turn.visibleAction, "", "placeholder visible action must normalise to empty");
  assert.deepEqual(turn.affectiveTexture, [], "placeholder texture must normalise away");
  assert.equal(turn.outcome.status, "quiet", "a turn with no outcome must read as quiet, not as success");
}

// 6. The run mode has to survive branch restore; otherwise switching branches
//    silently drops the author back onto the legacy engine.
{
  const memory = new Map();
  globalThis.localStorage = {
    getItem(key) { return memory.has(key) ? memory.get(key) : null; },
    setItem(key, value) { memory.set(key, String(value)); },
    removeItem(key) { memory.delete(key); },
    clear() { memory.clear(); },
  };
  const store = await import("../src/state/store.js");
  store.resetState();
  store.setUi({ engineMode: "v27" });
  const mainBranchId = store.getState().ui.activeBranchId;
  const runtimeId = v27RuntimeIdForWorld({
    runtimeInstanceId: store.getState().project.runtimeInstanceId,
  });
  store.setRuntimeSessionRef({
    runtimeId,
    projectId: store.getState().project.id,
    branchId: mainBranchId,
    sessionId: "runtime-session:main",
    sessionRevision: 2,
  });
  store.saveDraft({
    id: "draft_v27_mode",
    projectId: store.getState().project.id,
    branchId: mainBranchId,
    locationId: store.getState().ui.selectedLocationId,
    participantIds: store.getState().characters.slice(0, 2).map((character) => character.id),
    surfaceEvent: "运行模式保持测试",
    sceneText: "保持。",
    relationshipShift: [],
    irreversibleTraces: [],
    updateBundle: {},
  });
  const fork = store.createBranchFromDraft("draft_v27_mode", "运行模式分支");
  assert.equal(store.getRuntimeSessionRef(runtimeId), null, "a new branch must not reuse the parent's live runtime session");
  store.setRuntimeSessionRef({
    runtimeId,
    projectId: store.getState().project.id,
    branchId: fork.id,
    sessionId: "runtime-session:fork",
    sessionRevision: 4,
  });
  store.setActiveBranch(mainBranchId);
  assert.equal(store.getRuntimeSessionRef(runtimeId).sessionId, "runtime-session:main");
  store.setActiveBranch(fork.id);
  assert.equal(store.getState().ui.engineMode, "v27", "the v2.7 run mode must survive branch switching");
  assert.equal(store.getRuntimeSessionRef(runtimeId).sessionId, "runtime-session:fork");
}

// 7. The browser keeps only an opaque branch-owned reference. It may render
//    public session progress, but never receives the persisted checkpoint.
{
  const observation = normalizeV27Observation({
    sessionRef: {
      runtimeId: "tavern-v27",
      sessionId: "runtime-session:opaque",
      sessionRevision: 6,
    },
    runtime: { worldVersion: 3, eventCount: 3, turns: [] },
  });
  assert.equal(observation.sessionRef.sessionId, "runtime-session:opaque");
  assert.equal(observation.sessionRef.sessionRevision, 6);
  assert.equal("checkpoint" in observation.sessionRef, false);
  assert.equal("privateState" in observation.sessionRef, false);
}

// 8. Consecutive local clicks address one durable server-owned session. The
//    first command explicitly starts it; the next command continues from the
//    returned revision instead of replaying the seed demo endpoint.
{
  const originalFetch = globalThis.fetch;
  const calls = [];
  const responses = [
    {
      sessionRef: {
        projectId: "project:ui",
        branchId: "branch:ui",
        runtimeId: "tavern-v27",
        sessionId: "runtime-session:ui",
      },
      sessionRevision: 2,
      worldVersion: 1,
      observation: { schemaVersion: "test", worldVersion: 1, eventCount: 1, turns: [] },
    },
    {
      sessionRef: {
        projectId: "project:ui",
        branchId: "branch:ui",
        runtimeId: "tavern-v27",
        sessionId: "runtime-session:ui",
      },
      sessionRevision: 4,
      worldVersion: 2,
      observation: { schemaVersion: "test", worldVersion: 2, eventCount: 2, turns: [] },
    },
  ];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, body: JSON.parse(options.body || "{}") });
    const payload = responses.shift();
    return { ok: true, status: 200, async json() { return payload; } };
  };
  try {
    const started = await runV27LocalObservation({
      projectId: "project:ui",
      branchId: "branch:ui",
      runtimeId: "tavern-v27",
    });
    assert.equal(calls[0].url, "/api/v27/tavern/session/start");
    assert.equal(calls[0].body.expectedRevision, 0);
    assert.match(calls[0].body.commandId, /^v27:start:/);
    assert.equal(started.worldVersion, 1);
    assert.equal(started.sessionRef.sessionRevision, 2);

    const continued = await runV27LocalObservation({
      projectId: "project:ui",
      branchId: "branch:ui",
      runtimeId: "tavern-v27",
      sessionRef: started.sessionRef,
    });
    assert.equal(calls[1].url, "/api/v27/tavern/session/continue");
    assert.equal(calls[1].body.expectedRevision, 2);
    assert.match(calls[1].body.commandId, /^v27:continue:/);
    assert.equal(continued.worldVersion, 2);
    assert.equal(continued.sessionRef.sessionRevision, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// 9. The observer keeps a bounded, deduplicated history for the same opaque
//    session, so one-character commands still read as a continuous exchange.
{
  const first = normalizeV27Observation({
    sessionRef: { runtimeId: "tavern-v27", sessionId: "runtime-session:history", sessionRevision: 2 },
    runtime: {
      worldVersion: 1,
      turns: [{ characterId: "c1", agentTurnId: "turn:c1:1", publicRealization: {}, outcome: null }],
    },
  });
  const second = normalizeV27Observation({
    sessionRef: { runtimeId: "tavern-v27", sessionId: "runtime-session:history", sessionRevision: 4 },
    runtime: {
      worldVersion: 2,
      turns: [
        { characterId: "c1", agentTurnId: "turn:c1:1", publicRealization: {}, outcome: null },
        { characterId: "c2", agentTurnId: "turn:c2:1", publicRealization: {}, outcome: null },
      ],
    },
  });
  const merged = mergeV27ObservationHistory(first, second);
  assert.deepEqual(merged.turns.map((turn) => turn.agentTurnId), ["turn:c1:1", "turn:c2:1"]);
  assert.deepEqual(merged.turns.map((turn) => turn.index), [1, 2]);
  assert.equal(merged.worldVersion, 2);
  const otherSession = normalizeV27Observation({
    sessionRef: { runtimeId: "tavern-v27", sessionId: "runtime-session:other", sessionRevision: 2 },
    runtime: { worldVersion: 1, turns: [] },
  });
  assert.deepEqual(mergeV27ObservationHistory(merged, otherSession).turns, []);
}

// 10. Runtime observations are public, branch-owned state. Forking starts with
//     no transport or observer history, and switching restores each branch's
//     own public observation instead of leaking the last globally rendered one.
{
  const store = await import("../src/state/store.js");
  store.resetState();
  store.setUi({ engineMode: "v27" });
  const mainBranchId = store.getState().ui.activeBranchId;
  const runtimeId = v27RuntimeIdForWorld({
    runtimeInstanceId: store.getState().project.runtimeInstanceId,
  });
  const mainObservation = publicObservation(
    "runtime-session:main-observation",
    "turn:main:1",
    "主线。 ",
    { runtimeId },
  );
  Object.assign(mainObservation, {
    nowSeconds: 17,
    readyQueue: ["char_xyy_luozhao", ""],
    characters: [{
      characterId: "char_xyy_xiezenshi",
      name: "谢真石",
      present: true,
      placeId: "loc_xyy_tavern",
      zoneId: "hall",
      positionId: "position:tavern-hall-side-wall-table",
      orientationTargetId: "char_xyy_luozhao",
      listeningTargetId: "char_xyy_luozhao",
      listeningTargetKind: "character",
      privateState: { desire: "store-character-secret" },
    }],
    objects: [{
      id: "position:tavern-hall-side-wall-table",
      kind: "position",
      label: "堂前侧墙空桌",
      placeId: "loc_xyy_tavern",
      zoneId: "hall",
      holderCharacterId: "",
      occupantCharacterIds: ["char_xyy_xiezenshi", ""],
      state: { hiddenContents: "store-object-secret" },
      custody: { privateOwner: "store-object-secret" },
    }],
  });
  Object.assign(mainObservation.turns[0].outcome, {
    primitive: "move",
    worldVersion: 1,
    durationSeconds: 3,
    resolvedEffects: [{
      kind: "actor_movement",
      actorId: "char_xyy_xiezenshi",
      fromZoneId: "hall",
      toZoneId: "courtyard",
      privateDecisionBasis: "store-outcome-secret",
      memoryContext: { secret: "store-outcome-secret" },
    }],
    committedFacts: [{
      kind: "movement_attempted",
      actorId: "char_xyy_xiezenshi",
      fromZoneId: "hall",
      toZoneId: "courtyard",
      visibleAction: "谢真石走向后院。",
      hiddenIntent: "store-outcome-secret",
      provenance: { sourceThreadId: "store-outcome-secret" },
    }],
    deliveries: [{ privateInterpretation: "store-outcome-secret" }],
    privateState: { desire: "store-outcome-secret" },
  });
  assert.throws(
    () => store.setRuntimeObservation(runtimeId, mainObservation),
    /会话|session/i,
    "an observation without a matching live session has no public provenance",
  );
  store.setRuntimeSessionRef({
    runtimeId,
    sessionId: "runtime-session:main-observation",
    sessionRevision: 2,
    worldVersion: 1,
  });
  store.setRuntimeObservation(runtimeId, mainObservation);
  const storedMainObservation = store.getRuntimeObservation(runtimeId);
  assert.equal(storedMainObservation.turns[0].agentTurnId, "turn:main:1");
  assert.equal(storedMainObservation.turns[0].submissionMode, "atomic");
  assert.equal(storedMainObservation.turns[0].characterAgentCompleted, true);
  assert.equal(storedMainObservation.turns[0].acceptedStageCount, 4);
  assert.equal(storedMainObservation.turns[0].expectedAcceptedStageCount, 4);
  assert.equal(storedMainObservation.turns[0].fiveStageCompleted, false);
  assert.equal(storedMainObservation.nowSeconds, 17);
  assert.deepEqual(storedMainObservation.readyQueue, ["char_xyy_luozhao"]);
  assert.deepEqual(storedMainObservation.characters, [{
    characterId: "char_xyy_xiezenshi",
    name: "谢真石",
    present: true,
    placeId: "loc_xyy_tavern",
    zoneId: "hall",
    positionId: "position:tavern-hall-side-wall-table",
    orientationTargetId: "char_xyy_luozhao",
    listeningTargetId: "char_xyy_luozhao",
    listeningTargetKind: "character",
  }]);
  assert.deepEqual(storedMainObservation.objects, [{
    id: "position:tavern-hall-side-wall-table",
    kind: "position",
    label: "堂前侧墙空桌",
    placeId: "loc_xyy_tavern",
    zoneId: "hall",
    holderCharacterId: "",
    occupantCharacterIds: ["char_xyy_xiezenshi"],
  }]);
  assert.deepEqual(storedMainObservation.turns[0].outcome, {
    status: "settled",
    label: "世界已接住动作",
    detail: "世界版本 1",
    primitive: "move",
    worldVersion: 1,
    durationSeconds: 3,
    resolvedEffects: [{
      kind: "actor_movement",
      actorId: "char_xyy_xiezenshi",
      fromZoneId: "hall",
      toZoneId: "courtyard",
    }],
    committedFacts: [{
      kind: "movement_attempted",
      actorId: "char_xyy_xiezenshi",
      fromZoneId: "hall",
      toZoneId: "courtyard",
      visibleAction: "谢真石走向后院。",
    }],
  });
  assert.equal(JSON.stringify(storedMainObservation).includes("store-character-secret"), false);
  assert.equal(JSON.stringify(storedMainObservation).includes("store-object-secret"), false);
  assert.equal(JSON.stringify(storedMainObservation).includes("store-outcome-secret"), false);
  assert.equal(store.getState().ui.v27Observation.turns[0].agentTurnId, "turn:main:1");
  assert.deepEqual(store.getState().ui.v27Observation.characters, storedMainObservation.characters);
  assert.deepEqual(store.getState().ui.v27Observation.objects, storedMainObservation.objects);
  assert.equal("checkpoint" in store.getRuntimeObservation(runtimeId), false);
  assert.equal("observerOnlyPsychology" in store.getRuntimeObservation(runtimeId), false);
  assert.equal("privateState" in store.getRuntimeObservation(runtimeId).turns[0], false);

  store.saveDraft({
    id: "draft_v27_observation_fork",
    projectId: store.getState().project.id,
    branchId: mainBranchId,
    locationId: store.getState().ui.selectedLocationId,
    participantIds: [],
    surfaceEvent: "公开观察分支隔离",
    sceneText: "隔离。",
    relationshipShift: [],
    irreversibleTraces: [],
    updateBundle: {},
  });
  const fork = store.createBranchFromDraft("draft_v27_observation_fork", "观察隔离分支");
  assert.equal(store.getRuntimeObservation(runtimeId), null, "a fork must not inherit public runtime observations");
  assert.equal(store.getState().ui.v27Observation, null, "the rendered observation must clear on a fresh fork");

  store.setRuntimeSessionRef({
    runtimeId,
    sessionId: "runtime-session:fork-observation",
    sessionRevision: 2,
    worldVersion: 1,
  });
  store.setRuntimeObservation(
    runtimeId,
    publicObservation("runtime-session:fork-observation", "turn:fork:1", "分支。", { runtimeId }),
  );
  store.setActiveBranch(mainBranchId);
  assert.equal(store.getRuntimeObservation(runtimeId).turns[0].agentTurnId, "turn:main:1");
  assert.equal(store.getState().ui.v27Observation.turns[0].agentTurnId, "turn:main:1");
  assert.equal(store.getRuntimeObservation(runtimeId).nowSeconds, 17);
  assert.deepEqual(store.getRuntimeObservation(runtimeId).characters, storedMainObservation.characters);
  assert.deepEqual(store.getRuntimeObservation(runtimeId).objects, storedMainObservation.objects);
  store.setActiveBranch(fork.id);
  assert.equal(store.getRuntimeObservation(runtimeId).turns[0].agentTurnId, "turn:fork:1");
  assert.equal(store.getState().ui.v27Observation.turns[0].agentTurnId, "turn:fork:1");
}

// 10b. Spatial snapshots do not weaken the existing bounded public history:
//      only the latest 80 Character turns remain in branch-owned persistence.
{
  const store = await import("../src/state/store.js");
  store.resetState();
  const runtimeId = v27RuntimeIdForWorld({
    runtimeInstanceId: store.getState().project.runtimeInstanceId,
  });
  store.setRuntimeSessionRef({
    runtimeId,
    sessionId: "runtime-session:bounded-observation",
    sessionRevision: 2,
    worldVersion: 1,
  });
  const bounded = publicObservation(
    "runtime-session:bounded-observation",
    "turn:bounded:1",
    "",
    { runtimeId },
  );
  const seedTurn = bounded.turns[0];
  bounded.turns = Array.from({ length: 83 }, (_, index) => ({
    ...structuredClone(seedTurn),
    index: index + 1,
    agentTurnId: `turn:bounded:${index + 1}`,
  }));
  store.setRuntimeObservation(runtimeId, bounded);
  const stored = store.getRuntimeObservation(runtimeId);
  assert.equal(stored.turns.length, 80);
  assert.equal(stored.turns[0].agentTurnId, "turn:bounded:4");
  assert.equal(stored.turns.at(-1).agentTurnId, "turn:bounded:83");
}

// 11. A runtime instance namespace survives an ordinary persisted refresh, but
//     rebuilding the world creates a new incarnation and clears every branch's
//     server reference and public observer ledger.
{
  const store = await import("../src/state/store.js");
  store.resetState();
  const firstInstanceId = store.getState().project.runtimeInstanceId;
  const runtimeId = v27RuntimeIdForWorld({ runtimeInstanceId: firstInstanceId });
  assert.ok(firstInstanceId, "every live project needs a runtime instance id");
  store.setUi({ engineMode: "v27" });
  const refreshedStore = await import(`../src/state/store.js?runtime-refresh=${Date.now()}`);
  assert.equal(
    refreshedStore.getState().project.runtimeInstanceId,
    firstInstanceId,
    "ordinary persisted refresh must retain the same runtime instance",
  );

  store.setRuntimeSessionRef({
    runtimeId,
    sessionId: "runtime-session:before-rebuild",
    sessionRevision: 2,
    worldVersion: 1,
  });
  store.setRuntimeObservation(
    runtimeId,
    publicObservation("runtime-session:before-rebuild", "turn:before-rebuild:1", "", { runtimeId }),
  );
  const generated = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  store.applyGeneratedSetupWorld(generated, {
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  const rebuilt = store.getState();
  assert.notEqual(rebuilt.project.runtimeInstanceId, firstInstanceId);
  assert.deepEqual(rebuilt.runtimeSessions, []);
  assert.deepEqual(rebuilt.runtimeObservations, []);
  assert.equal(rebuilt.ui.v27Observation, null);
  assert.ok(rebuilt.branches.every((branch) => !(branch.snapshot?.runtimeSessions || []).length));
  assert.ok(rebuilt.branches.every((branch) => !(branch.snapshot?.runtimeObservations || []).length));
  assert.ok(rebuilt.branches.every((branch) => !(branch.runtimeClientState?.sessions || []).length));
  assert.ok(rebuilt.branches.every((branch) => !(branch.runtimeClientState?.observations || []).length));
}

// 12. A pending transport command is persistable before the server returns. It
//     cannot be overwritten by another command, regress a committed revision or
//     silently switch to another server session.
{
  const store = await import("../src/state/store.js");
  store.resetState();
  const runtimeId = v27RuntimeIdForWorld({
    runtimeInstanceId: store.getState().project.runtimeInstanceId,
  });
  const pending = store.setRuntimeSessionRef({
    runtimeId,
    pendingCommand: {
      commandId: "command:start:one",
      operation: "start",
      expectedRevision: 0,
      timestamp: "2026-07-26T12:00:00.000Z",
      privatePrompt: "must be stripped",
    },
  });
  assert.equal(pending.sessionId, "");
  assert.deepEqual(Object.keys(pending.pendingCommand).sort(), [
    "commandId", "expectedRevision", "operation", "timestamp",
  ]);
  assert.throws(() => store.setRuntimeSessionRef({
    runtimeId,
    pendingCommand: {
      commandId: "command:start:two",
      operation: "start",
      expectedRevision: 0,
      timestamp: "2026-07-26T12:00:01.000Z",
    },
  }), /pending|待决|未完成/i);

  assert.throws(() => store.setRuntimeSessionRef({
    runtimeId,
    sessionId: "runtime-session:one",
    sessionRevision: 2,
    worldVersion: 1,
  }), /command|命令|待决/i, "a response may not clear an unrelated pending command without its id");
  const completed = store.setRuntimeSessionRef({
    runtimeId,
    sessionId: "runtime-session:one",
    sessionRevision: 2,
    worldVersion: 1,
  }, { resolvedCommandId: "command:start:one" });
  assert.equal(completed.sessionId, "runtime-session:one");
  assert.equal(completed.pendingCommand, null);
  assert.throws(() => store.setRuntimeSessionRef({
    runtimeId,
    sessionId: "runtime-session:one",
    sessionRevision: 0,
  }), /revision|版本|回退/i);
  assert.throws(() => store.setRuntimeSessionRef({
    runtimeId,
    sessionId: "runtime-session:other",
    sessionRevision: 4,
  }), /session|会话|覆盖/i);

  const continuedPending = store.setRuntimeSessionRef({
    runtimeId,
    pendingCommand: {
      commandId: "command:continue:one",
      operation: "continue",
      expectedRevision: 2,
      timestamp: "2026-07-26T12:01:00.000Z",
    },
  });
  assert.equal(continuedPending.sessionId, "runtime-session:one");
  assert.equal(continuedPending.sessionRevision, 2);
  assert.equal(continuedPending.pendingCommand.commandId, "command:continue:one");
}

// 13. Canon undo rewinds authored world state, not a live server transport.
//     Its snapshots contain neither the opaque session ref nor public observer
//     history, and undo keeps the latest transport/observation untouched.
{
  const store = await import("../src/state/store.js");
  store.resetState();
  const branchId = store.getState().ui.activeBranchId;
  const runtimeId = v27RuntimeIdForWorld({
    runtimeInstanceId: store.getState().project.runtimeInstanceId,
  });
  store.setRuntimeSessionRef({
    runtimeId,
    sessionId: "runtime-session:canon",
    sessionRevision: 2,
    worldVersion: 1,
  });
  store.setRuntimeObservation(
    runtimeId,
    publicObservation("runtime-session:canon", "turn:canon:1", "", { runtimeId }),
  );
  store.saveDraft({
    id: "draft_v27_canon_transport",
    projectId: store.getState().project.id,
    branchId,
    locationId: store.getState().ui.selectedLocationId,
    participantIds: [],
    surfaceEvent: "正史与运行传输分离",
    sceneText: "正史。",
    relationshipShift: [],
    irreversibleTraces: [],
    updateBundle: {},
  });
  const canon = store.acceptDraft("draft_v27_canon_transport", {});
  assert.equal("runtimeSessions" in canon.preAcceptSnapshot, false);
  assert.equal("runtimeObservations" in canon.preAcceptSnapshot, false);
  assert.equal("runtimeSessions" in canon.postAcceptSnapshot, false);
  assert.equal("runtimeObservations" in canon.postAcceptSnapshot, false);

  store.setRuntimeSessionRef({
    runtimeId,
    pendingCommand: {
      commandId: "command:canon:advance",
      operation: "continue",
      expectedRevision: 2,
      timestamp: "2026-07-26T12:20:00.000Z",
    },
  });
  store.setRuntimeSessionRef({
    runtimeId,
    sessionId: "runtime-session:canon",
    sessionRevision: 4,
    worldVersion: 2,
  }, { resolvedCommandId: "command:canon:advance" });
  store.setRuntimeObservation(
    runtimeId,
    publicObservation("runtime-session:canon", "turn:canon:2", "", {
      runtimeId,
      sessionRevision: 4,
      worldVersion: 2,
    }),
  );
  store.undoCanonEvent(canon.id);
  assert.equal(store.getRuntimeSessionRef(runtimeId).sessionRevision, 4);
  assert.equal(store.getRuntimeObservation(runtimeId).turns[0].agentTurnId, "turn:canon:2");
  assert.equal(store.getState().ui.v27Observation.turns[0].agentTurnId, "turn:canon:2");
}

// 14. Explicit imports are new local incarnations. Even a modern export or a
//     legacy payload may not reconnect to another checkout's opaque server
//     session or carry its branch observer history into this one.
{
  const store = await import("../src/state/store.js");
  store.resetState();
  const runtimeId = v27RuntimeIdForWorld({
    runtimeInstanceId: store.getState().project.runtimeInstanceId,
  });
  store.setRuntimeSessionRef({
    runtimeId,
    sessionId: "runtime-session:exported",
    sessionRevision: 6,
  });
  store.setRuntimeObservation(
    runtimeId,
    publicObservation("runtime-session:exported", "turn:exported:1", "", {
      runtimeId,
      sessionRevision: 6,
      worldVersion: 0,
    }),
  );
  const exported = JSON.parse(store.exportState());
  const exportedInstanceId = exported.project.runtimeInstanceId;
  store.importState(JSON.stringify(exported), { preserveRuntimeIdentity: true });
  assert.equal(store.getState().project.runtimeInstanceId, exportedInstanceId);
  assert.equal(store.getRuntimeSessionRef(runtimeId).sessionId, "runtime-session:exported");
  assert.equal(store.getRuntimeObservation(runtimeId).turns[0].agentTurnId, "turn:exported:1");

  store.importState(JSON.stringify(exported));
  assert.notEqual(store.getState().project.runtimeInstanceId, exportedInstanceId);
  assert.equal(store.getRuntimeSessionRef(runtimeId), null);
  assert.equal(store.getRuntimeObservation(runtimeId), null);
  assert.equal(store.getState().ui.v27Observation, null);
  assert.ok(store.getState().branches.every((branch) => !(branch.snapshot?.runtimeSessions || []).length));
  assert.ok(store.getState().branches.every((branch) => !(branch.snapshot?.runtimeObservations || []).length));
  assert.ok(store.getState().branches.every((branch) => !(branch.runtimeClientState?.sessions || []).length));
  assert.ok(store.getState().branches.every((branch) => !(branch.runtimeClientState?.observations || []).length));

  delete exported.project.runtimeInstanceId;
  delete exported.project.runtimeNamespace;
  exported.runtimeSessions = [{
    runtimeId,
    projectId: exported.project.id,
    branchId: exported.ui.activeBranchId,
    sessionId: "runtime-session:legacy-leak",
    sessionRevision: 8,
  }];
  exported.runtimeObservations = [{
    runtimeId,
    projectId: exported.project.id,
    branchId: exported.ui.activeBranchId,
    observation: publicObservation("runtime-session:legacy-leak", "turn:legacy-leak:1", "", { runtimeId }),
  }];
  exported.ui.v27Observation = publicObservation(
    "runtime-session:legacy-leak",
    "turn:legacy-leak:1",
    "",
    { runtimeId },
  );
  store.importState(JSON.stringify(exported));
  assert.ok(store.getState().project.runtimeInstanceId);
  assert.equal(store.getRuntimeSessionRef(runtimeId), null);
  assert.equal(store.getRuntimeObservation(runtimeId), null);
  assert.equal(store.getState().ui.v27Observation, null);
}

// 15. The actual browser controller and store form one transaction: the
//     command is durable before network execution, while the returned cursor
//     and public observation commit together under that same command id.
{
  const store = await import("../src/state/store.js");
  store.resetState();
  let pendingSeenDuringExecution = null;
  const controller = createV27SessionController({
    getState: store.getState,
    getRuntimeSessionRef: store.getRuntimeSessionRef,
    setRuntimeSessionRef: store.setRuntimeSessionRef,
    clearRuntimeSessionRef: store.clearRuntimeSessionRef,
    getRuntimeObservation: store.getRuntimeObservation,
    setRuntimeObservation: store.setRuntimeObservation,
    commitRuntimeSessionResult: store.commitRuntimeSessionResult,
    async runLocalObservation(input) {
      pendingSeenDuringExecution = store.getRuntimeSessionRef(input.runtimeId)?.pendingCommand || null;
      return {
        mode: "local-character-agent-fixture-persistent",
        externalModelCalled: false,
        authorQualityVerdict: "not_claimed",
        explanation: "真实 store/controller 接线。",
        worldVersion: 1,
        eventCount: 1,
        schemaVersion: "test",
        sessionRef: {
          runtimeId: input.runtimeId,
          projectId: input.projectId,
          branchId: input.branchId,
          sessionId: "runtime-session:real-store-controller",
          sessionRevision: 2,
          worldVersion: 1,
        },
        turns: [{
          index: 1,
          characterId: "char_xyy_xiezenshi",
          characterName: "谢真石",
          agentTurnId: "turn:real-store-controller:1",
          wakeKind: "opportunity_window",
          submissionMode: "atomic",
          characterAgentCompleted: true,
          acceptedStageCount: 4,
          expectedAcceptedStageCount: 4,
          fiveStageCompleted: false,
          protocolRepairCount: 0,
          actionType: "observe",
          targetCharacterId: "char_xyy_luozhao",
          speech: "",
          visibleAction: "谢真石抬眼看去。",
          affectiveTexture: [],
          outcome: { status: "settled", label: "世界已接住动作", detail: "世界版本 1" },
          privateState: { mustNeverPersist: true },
        }],
        completedAt: "2026-07-26T12:30:00.000Z",
      };
    },
  });
  const result = await controller.runLocalTurn();
  const runtimeId = v27RuntimeIdForWorld({
    runtimeInstanceId: store.getState().project.runtimeInstanceId,
  });
  assert.ok(pendingSeenDuringExecution?.commandId, "the command must be durable before execution starts");
  assert.equal(store.getRuntimeSessionRef(runtimeId).pendingCommand, null);
  assert.equal(store.getRuntimeSessionRef(runtimeId).sessionRevision, 2);
  assert.equal(store.getRuntimeObservation(runtimeId).turns[0].agentTurnId, "turn:real-store-controller:1");
  assert.equal(store.getRuntimeObservation(runtimeId).turns[0].submissionMode, "atomic");
  assert.equal(store.getRuntimeObservation(runtimeId).turns[0].characterAgentCompleted, true);
  assert.equal(store.getRuntimeObservation(runtimeId).turns[0].fiveStageCompleted, false);
  assert.equal("privateState" in store.getRuntimeObservation(runtimeId).turns[0], false);
  assert.equal(result.displayedObservation.turns[0].agentTurnId, "turn:real-store-controller:1");
}

console.log("v2.7 main UI integration contract passed");
