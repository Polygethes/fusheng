import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const STORAGE_KEY = "character-town-observer-state-v12";
const IDS = {
  mother: "char_xyy_xiemu",
  father: "char_xyy_xieheng",
  son: "char_xyy_xiezenshi",
  chen: "char_xyy_chenyan",
  luo: "char_xyy_luozhao",
};

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

const {
  exportState,
  getState,
  importState,
} = await import("../src/state/store.js");

const LOCK = {
  id: "request-lock:phase59:persist",
  threadId: "thread:phase59:unfinished-answer",
  requesterId: IDS.father,
  responderId: IDS.son,
  sourceActionId: "action:phase59:question:1",
  sourceImpactId: "impact:phase59:question:1",
  latestActionId: "action:phase59:question:retry-2",
  topic: "明早是否继续练剑",
  status: "unresolved",
  openedAtStep: 7,
  attempts: 2,
  maxAttempts: 3,
  resolvedByActionId: "",
  resolution: "",
};

const CURSOR = {
  status: "blocked",
  day: 4,
  slotBaseId: "afternoon",
  slotId: "day-4-afternoon",
  slotLabel: "午后",
  nextSlotIndex: 2,
  completedSlotBaseIds: ["dawn", "noon"],
  blockedRequestIds: [LOCK.id],
  arrivalCharacterIds: [IDS.chen],
  macroTriggerSeeded: true,
};

const HISTORIC_OBJECTS = {
  tavern_tool_wiping_cloth: {
    id: "tavern_tool_wiping_cloth",
    label: "已经用旧的擦桌抹布",
    aliases: ["抹布", "旧抹布"],
    holderActorId: IDS.chen,
    sceneId: "loc_xyy_tavern",
    zoneId: "courtyard",
    portable: true,
    state: {
      cleanEnough: false,
      stain: "药汁",
      lastUsedActionId: "action:history:wipe-table",
    },
  },
  tavern_room_key_guest_1: {
    id: "tavern_room_key_guest_1",
    label: "一号客房钥匙",
    aliases: ["客房钥匙"],
    holderActorId: IDS.luo,
    sceneId: "loc_xyy_tavern",
    zoneId: "guest_room",
    portable: true,
    state: {
      roomId: "guest_room_1",
      deliveredByActionId: "action:history:lodging-key",
    },
  },
  tavern_object_history_only_token: {
    id: "tavern_object_history_only_token",
    label: "旧住客留下的木牌",
    aliases: ["木牌"],
    holderActorId: "",
    sceneId: "loc_xyy_tavern",
    zoneId: "counter",
    portable: true,
    state: { inscription: "丙字房", canonicalSinceDay: 2 },
  },
};

function clone(value) {
  return structuredClone(value);
}

function legacyTavernState(base) {
  const tavern = clone(base.tavernState);
  tavern.schemaVersion = 8;
  tavern.institution = { ...(tavern.institution || {}), schemaVersion: 3 };
  delete tavern.institution.objectTemplates;
  tavern.objectLedger = {
    schemaVersion: 1,
    objects: clone(HISTORIC_OBJECTS),
    heldByActor: {
      [IDS.chen]: ["tavern_tool_wiping_cloth"],
      [IDS.luo]: ["tavern_room_key_guest_1"],
    },
    heldByCharacter: {
      [IDS.chen]: ["tavern_tool_wiping_cloth"],
      [IDS.luo]: ["tavern_room_key_guest_1"],
    },
  };
  tavern.sceneRuntime = {
    id: "scene-runtime:phase59:persist",
    schemaVersion: 1,
    locationId: "loc_xyy_tavern",
    macroDay: 3,
    macroTick: 17,
    elapsedSeconds: 188,
    step: 9,
    activeCharacterIds: [IDS.father, IDS.son],
    agents: {
      [IDS.father]: {
        characterId: IDS.father,
        characterName: "谢恒",
        role: "东家",
        standing: "owner",
        zoneId: "courtyard",
        present: true,
      },
      [IDS.son]: {
        characterId: IDS.son,
        characterName: "谢真石",
        role: "店家少年",
        standing: "household_worker",
        zoneId: "courtyard",
        present: true,
      },
    },
    commitments: [],
    requestLocks: [clone(LOCK)],
    lastActorId: IDS.father,
  };
  tavern.periodCursor = clone(CURSOR);
  return tavern;
}

function buildLegacyFixture() {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  state.worldSetup.tavernLifeVersion = 8;
  state.worldSetup.tavernObjectLedgerVersion = 0;
  state.tavernState = legacyTavernState(state);
  state.project.activeBranchId = "branch_main";
  state.ui.activeBranchId = "branch_main";
  state.branches = [{
    id: "branch_main",
    title: "主线",
    stateMode: "isolated",
    snapshotSchemaVersion: 2,
    snapshot: {
      characters: clone(state.characters),
      relationships: clone(state.relationships),
      canonEvents: clone(state.canonEvents || []),
      draftScenes: clone(state.draftScenes || []),
      rumors: clone(state.rumors || []),
      evidence: clone(state.evidence || []),
      secrets: clone(state.secrets || []),
      characterMemories: clone(state.characterMemories || []),
      characterPlans: clone(state.characterPlans || []),
      townStateLedger: clone(state.townStateLedger || []),
      interventions: clone(state.interventions || []),
      stateChangeReasons: clone(state.stateChangeReasons || []),
      replayMarkers: clone(state.replayMarkers || []),
      irreversibleTraces: clone(state.irreversibleTraces || []),
      storyRevisions: clone(state.storyRevisions || []),
      tavernState: clone(state.tavernState),
    },
  }];
  return state;
}

function activeBranch(state) {
  const id = state.ui?.activeBranchId || state.project?.activeBranchId;
  const branch = (state.branches || []).find((row) => row.id === id);
  assert.ok(branch, `missing active branch ${id}`);
  assert.ok(branch.snapshot, `active branch ${id} has no reconstructed snapshot`);
  return branch;
}

function projectedLock(lock = {}) {
  return {
    id: lock.id,
    threadId: lock.threadId,
    requesterId: lock.requesterId,
    responderId: lock.responderId,
    sourceActionId: lock.sourceActionId,
    sourceImpactId: lock.sourceImpactId,
    latestActionId: lock.latestActionId,
    topic: lock.topic,
    status: lock.status,
    openedAtStep: lock.openedAtStep,
    attempts: lock.attempts,
    maxAttempts: lock.maxAttempts,
    resolvedByActionId: lock.resolvedByActionId,
    resolution: lock.resolution,
  };
}

function assertHistoricObjectWasNotReset(tavernState, context) {
  const ledger = tavernState?.objectLedger;
  assert.ok(ledger?.objects, `${context}: object ledger missing`);
  for (const [objectId, expected] of Object.entries(HISTORIC_OBJECTS)) {
    const actual = ledger.objects[objectId];
    assert.ok(actual, `${context}: migration discarded historical object ${objectId}`);
    assert.equal(actual.label, expected.label, `${context}: ${objectId} label was reset from history`);
    assert.equal(actual.holderActorId, expected.holderActorId, `${context}: ${objectId} holder was reset from history`);
    assert.equal(actual.sceneId, expected.sceneId, `${context}: ${objectId} scene was reset from history`);
    assert.equal(actual.zoneId, expected.zoneId, `${context}: ${objectId} zone was reset from history`);
    assert.equal(actual.portable, expected.portable, `${context}: ${objectId} portability was reset from history`);
    assert.deepEqual(actual.state, expected.state, `${context}: ${objectId} lived state was reset from history`);
    for (const alias of expected.aliases) assert.ok(actual.aliases?.includes(alias), `${context}: ${objectId} lost historical alias ${alias}`);
  }
  assert.ok(ledger.objects.tavern_tool_wood_axe, `${context}: missing template object was not added`);
  assert.equal(ledger.objects.tavern_tool_wood_axe.zoneId, "courtyard");
  assert.equal(ledger.objects.tavern_tool_wood_axe.holderActorId, "");
  assert.ok(ledger.objects.tavern_vessel_meal_1, `${context}: V2 must add a concrete reusable meal vessel`);
  assert.deepEqual(ledger.objects.tavern_vessel_meal_1.state.serviceTypes, ["meal", "lodging", "work_meal"]);
  assert.equal(ledger.objects.tavern_vessel_meal_1.state.vesselType, "meal_bowl");
  assert.equal(ledger.objects.tavern_vessel_meal_1.state.contents, "empty");
  assert.ok(ledger.objects.tavern_vessel_teapot_1, `${context}: material economy migration must add a reusable tea pot`);
  assert.equal(ledger.objects.tavern_vessel_teapot_1.state.vesselType, "tea_pot");
}

function assertRuntimeContinuity(tavernState, context) {
  const locks = tavernState?.sceneRuntime?.requestLocks || [];
  assert.equal(locks.length, 1, `${context}: persisted request lock missing or duplicated`);
  assert.deepEqual(projectedLock(locks[0]), projectedLock(LOCK), `${context}: request lock lost causal continuation fields`);
  assert.deepEqual(tavernState?.periodCursor, CURSOR, `${context}: blocked period cursor changed during persistence`);
}

function assertTopAndActiveBranchAgree(state, context) {
  const branchTavern = activeBranch(state).snapshot.tavernState;
  assert.deepEqual(
    branchTavern.objectLedger,
    state.tavernState.objectLedger,
    `${context}: active branch object ledger differs from top-level truth`,
  );
  assert.deepEqual(
    branchTavern.sceneRuntime?.requestLocks,
    state.tavernState.sceneRuntime?.requestLocks,
    `${context}: active branch request locks differ from top-level truth`,
  );
  assert.deepEqual(
    branchTavern.periodCursor,
    state.tavernState.periodCursor,
    `${context}: active branch period cursor differs from top-level truth`,
  );
}

function assertAllContracts(state, context) {
  assert.equal(state.worldSetup?.tavernObjectLedgerVersion, 3, `${context}: object ledger migration version not committed`);
  assert.ok(state.tavernState?.objectLedger?.objects?.tavern_room_key_guest_2, `${context}: second lodging key was not migrated`);
  assert.ok(state.tavernState?.objectLedger?.objects?.tavern_room_key_guest_3, `${context}: third lodging key was not migrated`);
  assertHistoricObjectWasNotReset(state.tavernState, `${context}/top`);
  assertRuntimeContinuity(state.tavernState, `${context}/top`);
  assertTopAndActiveBranchAgree(state, context);
  const branchTavern = activeBranch(state).snapshot.tavernState;
  assertHistoricObjectWasNotReset(branchTavern, `${context}/active-branch`);
  assertRuntimeContinuity(branchTavern, `${context}/active-branch`);
}

const legacy = buildLegacyFixture();
importState(JSON.stringify(legacy));
const migrated = getState();
assertAllContracts(migrated, "migration");

const fullExport = exportState();
importState(fullExport);
const fullRoundTrip = getState();
assertAllContracts(fullRoundTrip, "full-export-round-trip");

const compactPayload = storage.get(STORAGE_KEY);
assert.ok(compactPayload, "store did not write a local-persistence payload");
const compactParsed = JSON.parse(compactPayload);
const compactLock = compactParsed.tavernState?.sceneRuntime?.requestLocks?.[0];
assert.deepEqual(projectedLock(compactLock), projectedLock(LOCK), "local-persistence compaction dropped request lock continuation fields");
assert.deepEqual(compactParsed.tavernState?.periodCursor, CURSOR, "local-persistence compaction dropped periodCursor");
assert.equal(
  compactParsed.branches?.find((branch) => branch.id === "branch_main")?.snapshot,
  null,
  "fixture must exercise the real compact active-branch reconstruction path",
);

importState(compactPayload);
const localRoundTrip = getState();
assertAllContracts(localRoundTrip, "local-persistence-round-trip");

console.log("tavernPhase59PersistenceMigration:test passed", {
  migrationVersion: localRoundTrip.worldSetup.tavernObjectLedgerVersion,
  preservedHistoricObjectIds: Object.keys(HISTORIC_OBJECTS),
  addedTemplateObjectId: "tavern_tool_wood_axe",
  requestLock: projectedLock(localRoundTrip.tavernState.sceneRuntime.requestLocks[0]),
  periodCursor: localRoundTrip.tavernState.periodCursor,
  activeBranchId: localRoundTrip.ui.activeBranchId,
});
