import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const EXPECTED_BACKGROUND_PATH = "/assets/ink-tavern/tavern-topdown-v2.png";
const EXPECTED_CHARACTER_ASSET_PATHS = Object.freeze({
  char_xyy_xiezenshi: "/assets/ink-tavern/xiezenshi-npc.png",
  char_xyy_luozhao: "/assets/ink-tavern/luozhao-npc.png",
  char_xyy_zhoumin: "/assets/ink-tavern/zhoumin-npc.png",
});
const EXPECTED_ZONE_IDS = Object.freeze([
  "threshold",
  "hall",
  "counter",
  "stove",
  "courtyard",
  "stairs",
  "guest_room",
]);
const EXPECTED_INITIAL_CHARACTER_IDS = Object.freeze([
  "char_xyy_xiezenshi",
  "char_xyy_luozhao",
]);

function repositoryPath(publicPath = "") {
  return fileURLToPath(new URL(`..${publicPath}`, import.meta.url));
}

async function readPngDimensions(publicPath = "") {
  const bytes = await readFile(repositoryPath(publicPath));
  assert.ok(bytes.length >= 24, `${publicPath} must contain a complete PNG header`);
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    `${publicPath} must be a PNG`,
  );
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR", `${publicPath} must start with IHDR`);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  assert.ok(width > 0 && height > 0, `${publicPath} must declare positive pixel dimensions`);
  return { width, height };
}

// Asset availability is an independent seam: the view must not depend on a
// remote image host or on a generated URL that changes between runs.
const backgroundDimensions = await readPngDimensions(EXPECTED_BACKGROUND_PATH);
assert.ok(
  backgroundDimensions.width > backgroundDimensions.height,
  "the top-down tavern map must be a landscape image suitable for the stage viewport",
);
for (const publicPath of Object.values(EXPECTED_CHARACTER_ASSET_PATHS)) {
  await readPngDimensions(publicPath);
}

let stage;
try {
  stage = await import("../src/ui/inkTavernStage.js");
} catch (error) {
  assert.fail(`Phase 107 production seam is missing: src/ui/inkTavernStage.js (${error?.code || error})`);
}

const {
  INK_TAVERN_ASSETS,
  INK_TAVERN_ZONE_LAYOUT,
  classifyInkTavernTime,
  buildInkTavernActorStates,
} = stage;

assert.equal(typeof INK_TAVERN_ASSETS, "object", "the stage must export its local asset manifest");
assert.equal(INK_TAVERN_ASSETS.background, EXPECTED_BACKGROUND_PATH);
assert.deepEqual(
  Object.fromEntries(Object.keys(EXPECTED_CHARACTER_ASSET_PATHS).map((characterId) => [
    characterId,
    INK_TAVERN_ASSETS.characters?.[characterId],
  ])),
  EXPECTED_CHARACTER_ASSET_PATHS,
  "the local character manifest must cover Xie Zhenshi, Luo Zhao and Zhou Min",
);
for (const publicPath of [
  INK_TAVERN_ASSETS.background,
  ...Object.values(INK_TAVERN_ASSETS.characters || {}),
]) {
  assert.match(publicPath, /^\/assets\//u, "stage assets must use local public paths");
  assert.doesNotMatch(publicPath, /^(?:https?:)?\/\//u, "stage assets must never require a remote host");
}

assert.equal(typeof INK_TAVERN_ZONE_LAYOUT, "object", "the stage must export a seven-zone layout");
assert.deepEqual(
  Object.keys(INK_TAVERN_ZONE_LAYOUT).sort(),
  [...EXPECTED_ZONE_IDS].sort(),
  "the visual layout must cover every authoritative tavern zone exactly once",
);
for (const zoneId of EXPECTED_ZONE_IDS) {
  const zone = INK_TAVERN_ZONE_LAYOUT[zoneId];
  assert.equal(typeof zone?.label, "string", `${zoneId} must have a public label`);
  assert.ok(zone.label.trim(), `${zoneId} must have a non-empty public label`);
  assert.ok(Number.isFinite(zone?.x) && zone.x >= 0 && zone.x <= 100, `${zoneId}.x must be a stage percentage`);
  assert.ok(Number.isFinite(zone?.y) && zone.y >= 0 && zone.y <= 100, `${zoneId}.y must be a stage percentage`);
}

assert.equal(typeof classifyInkTavernTime, "function", "the stage must classify continuous world time");
assert.deepEqual([
  classifyInkTavernTime(0),
  classifyInkTavernTime(5 * 3600),
  classifyInkTavernTime(10 * 3600),
  classifyInkTavernTime(14 * 3600),
  classifyInkTavernTime(18 * 3600),
  classifyInkTavernTime(21 * 3600),
  classifyInkTavernTime((24 + 5) * 3600),
], [
  "night",
  "dawn",
  "noon",
  "afternoon",
  "dusk",
  "night",
  "dawn",
], "time classification must be deterministic and wrap across world days");

assert.equal(typeof buildInkTavernActorStates, "function", "the stage must derive actor state from a public observation");

const successfulPublicObservation = {
  nowSeconds: 10 * 3600,
  characters: [{
    id: "char_xyy_xiezenshi",
    name: "谢真石",
    zoneId: "counter",
  }],
  turns: [{
    characterId: "char_xyy_xiezenshi",
    submissionMode: "atomic",
    privateState: { speech: "私有状态中的句子绝不能出现" },
    observerOnlyPsychology: { privateDecisionBasis: "私有心理也不能成为气泡" },
    publicRealization: {
      actionType: "move",
      speech: "茶好了。",
      visibleAction: "谢真石提着茶壶绕到柜台后。",
    },
    outcome: {
      status: "success",
      committedFacts: [{
        kind: "actor_movement",
        actorId: "char_xyy_xiezenshi",
        fromZoneId: "hall",
        toZoneId: "counter",
      }],
    },
  }],
};
const [movedXie] = buildInkTavernActorStates(successfulPublicObservation);
assert.equal(movedXie.characterId, "char_xyy_xiezenshi");
assert.equal(movedXie.name, "谢真石");
assert.equal(movedXie.zoneId, "counter");
assert.equal(movedXie.previousZoneId, "hall");
assert.equal(movedXie.movementCommitted, true);
assert.equal(movedXie.speech, "茶好了。", "speech bubbles must use the literal public realization");
assert.equal(movedXie.assetPath, EXPECTED_CHARACTER_ASSET_PATHS.char_xyy_xiezenshi);
assert.doesNotMatch(JSON.stringify(movedXie), /私有状态中的句子|私有心理也不能成为气泡/u);

const failedMovementObservation = {
  nowSeconds: 14 * 3600,
  characters: [{
    id: "char_xyy_luozhao",
    name: "洛照",
    zoneId: "hall",
  }],
  turns: [{
    characterId: "char_xyy_luozhao",
    submissionMode: "atomic",
    publicRealization: {
      actionType: "move",
      speech: "",
      visibleAction: "洛照试图往灶边走。",
    },
    outcome: {
      status: "failed",
      committedFacts: [{
        kind: "movement_attempted",
        actorId: "char_xyy_luozhao",
        fromZoneId: "hall",
        toZoneId: "stove",
      }],
      failedEffects: [{ code: "PLACE_MOVE_NOT_ADJACENT" }],
    },
  }],
};
const [blockedLuo] = buildInkTavernActorStates(failedMovementObservation);
assert.equal(blockedLuo.zoneId, "hall");
assert.equal(blockedLuo.previousZoneId, "hall", "a failed movement attempt must not create visual travel");
assert.equal(blockedLuo.movementCommitted, false);
assert.equal(blockedLuo.assetPath, EXPECTED_CHARACTER_ASSET_PATHS.char_xyy_luozhao);

for (const submissionMode of ["day_planning", "reflection"]) {
  const [maintainingZhou] = buildInkTavernActorStates({
    nowSeconds: 21 * 3600,
    characters: [{
      id: "char_xyy_zhoumin",
      name: "周珉",
      zoneId: "courtyard",
    }],
    turns: [{
      characterId: "char_xyy_zhoumin",
      turnKind: submissionMode,
      submissionMode,
      privateState: { authoredLine: "真正的私有维护文本" },
      // Fail closed even if a malformed maintenance projection accidentally
      // contains a realization-shaped field.
      publicRealization: { actionType: "speak", speech: "维护回合不应产生气泡" },
      outcome: null,
    }],
  });
  assert.equal(maintainingZhou.zoneId, "courtyard");
  assert.equal(maintainingZhou.previousZoneId, "courtyard");
  assert.equal(maintainingZhou.movementCommitted, false);
  assert.equal(maintainingZhou.speech, "", `${submissionMode} must not produce a speech bubble`);
  assert.equal(maintainingZhou.assetPath, EXPECTED_CHARACTER_ASSET_PATHS.char_xyy_zhoumin);
  assert.doesNotMatch(JSON.stringify(maintainingZhou), /真正的私有维护文本|维护回合不应产生气泡/u);
}

// Main-entry integration seam. The fixed tavern is the game surface, so its
// authored initial cast must be visible before the first runtime observation.
// Once a v2.7 observation exists, that public projection replaces the fallback
// placement. Historical prose remains available as a secondary ledger; it may
// not remain the primary body or drive the stage.
function fixedTavernState(engineMode = "local") {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  state.ui.setupCompleted = true;
  state.ui.activeTab = "reality";
  state.ui.engineMode = engineMode;
  state.ui.showObserverStage = false;
  state.ui.v27Observation = null;
  state.branches = [{ id: "branch_main", title: "主线", snapshot: {} }];
  return state;
}

const integrationFailures = [];
function integrationContract(label, assertion) {
  try {
    assertion();
  } catch (error) {
    integrationFailures.push(`${label}: ${error?.message || error}`);
  }
}

const renderSource = await readFile(new URL("../src/ui/render.js", import.meta.url), "utf8");
integrationContract("render.js imports the ink-tavern stage model", () => {
  assert.ok(
    /from\s+["']\.\/inkTavernStage\.js["']/u.test(renderSource),
    "missing import from ./inkTavernStage.js",
  );
});
integrationContract("render.js calls the public ink-tavern renderer", () => {
  assert.ok(
    /renderInkTavernStageMarkup\s*\(/u.test(renderSource),
    "renderInkTavernStageMarkup(observation) is not called",
  );
});

let renderAppForIntegration = null;
try {
  ({ renderApp: renderAppForIntegration } = await import("../src/ui/render.js"));
} catch (error) {
  integrationFailures.push(`render.js remains importable: ${error?.message || error}`);
}

if (typeof renderAppForIntegration === "function") {
  const initialGameHtml = renderAppForIntegration(fixedTavernState("local"));
  integrationContract("fixed tavern renders the game stage before any observation", () => {
    assert.ok(/data-ink-tavern-game-stage="true"/u.test(initialGameHtml), "formal stage root is absent");
    assert.ok(
      new RegExp(EXPECTED_BACKGROUND_PATH.replaceAll("/", "\\/"), "u").test(initialGameHtml),
      "formal stage background is absent",
    );
    assert.match(initialGameHtml, /data-projection="three-quarter-top-down"/u);
    assert.match(initialGameHtml, /data-navigation="walkable-graph"/u);
  });
  for (const characterId of EXPECTED_INITIAL_CHARACTER_IDS) {
    integrationContract(`initial game stage includes ${characterId}`, () => {
      assert.ok(
        new RegExp(`data-character=["']${characterId}["']`, "u").test(initialGameHtml),
        "the first frame must not be an empty diagnostic shell",
      );
    });
  }
  integrationContract("offstage visitors are not fabricated into the initial cast", () => {
    assert.ok(
      !/data-character=["']char_xyy_zhoumin["']/u.test(initialGameHtml),
      "Zhou Min must remain offstage until a public observation places him in the tavern",
    );
  });
  integrationContract("the formal stage is not gated by the old optional overview toggle", () => {
    assert.ok(
      initialGameHtml.indexOf('data-ink-tavern-game-stage="true"') >= 0,
      "showObserverStage=false must not hide the game surface",
    );
  });
}

const v27GameState = fixedTavernState("v27");
v27GameState.draftScenes = [{
  id: "draft:legacy-must-remain-ledger-only",
  projectId: v27GameState.project.id,
  branchId: "branch_main",
  locationId: "loc_xyy_tavern",
  participantIds: ["char_xyy_yanzhizhong"],
  sceneText: "旧草稿人物占住了旧舞台，这句话不得成为游戏主体。",
  surfaceEvent: "旧观察文本",
  relationshipShift: [],
  irreversibleTraces: [],
  updateBundle: {},
}];
v27GameState.ui.lastDraftId = "draft:legacy-must-remain-ledger-only";
v27GameState.ui.v27Observation = {
  mode: "local-character-agent-fixture-persistent",
  externalModelCalled: false,
  authorQualityVerdict: "not_claimed",
  explanation: "公开 v2.7 投影",
  worldVersion: 7,
  nowSeconds: 18 * 3600,
  eventCount: 7,
  schemaVersion: "phase107-game-first-test",
  providerRequestBudget: null,
  characters: [
    { characterId: "char_xyy_xiezenshi", name: "谢真石", zoneId: "counter" },
    { characterId: "char_xyy_luozhao", name: "洛照", zoneId: "hall" },
    { characterId: "char_xyy_zhoumin", name: "周珉", zoneId: "courtyard" },
  ],
  readyQueue: [],
  turns: [{
    index: 1,
    characterId: "char_xyy_luozhao",
    characterName: "洛照",
    agentTurnId: "agent-turn:phase107:luo:1",
    wakeKind: "world_evidence",
    submissionMode: "atomic",
    characterAgentCompleted: true,
    acceptedStageCount: 4,
    expectedAcceptedStageCount: 4,
    fiveStageCompleted: false,
    protocolRepairCount: 0,
    actionType: "speak",
    targetCharacterId: "char_xyy_xiezenshi",
    speech: "这句来自 v2.7 的公开投影。",
    visibleAction: "洛照在堂前停住。",
    affectiveTexture: [],
    outcome: { status: "settled", label: "世界已接住动作", detail: "世界版本 7" },
  }],
  completedAt: "2026-08-31T00:00:00.000Z",
};

if (typeof renderAppForIntegration === "function") {
  const v27GameHtml = renderAppForIntegration(v27GameState);
  integrationContract("v27 stage consumes the current public observation", () => {
    assert.ok(/data-ink-tavern-game-stage="true"/u.test(v27GameHtml), "formal stage root is absent");
    assert.ok(
      /data-character="char_xyy_luozhao"[^>]*data-zone="hall"/u.test(v27GameHtml),
      "Luo Zhao was not placed from v27Observation",
    );
    assert.ok(/这句来自 v2\.7 的公开投影。/u.test(v27GameHtml), "public v2.7 speech is absent");
  });
  integrationContract("legacy draft does not drive the v27 game stage", () => {
    assert.ok(!/旧草稿人物占住了旧舞台/u.test(v27GameHtml), "legacy draft prose leaked into the v27 game surface");
  });
  integrationContract("the prior text observer is a secondary action ledger", () => {
    const stageIndex = v27GameHtml.indexOf('data-ink-tavern-game-stage="true"');
    const ledgerIndex = v27GameHtml.indexOf('data-v27-action-ledger="true"');
    assert.ok(stageIndex >= 0, "the game stage must exist");
    assert.ok(ledgerIndex > stageIndex, "the action ledger must follow the game stage");
    assert.ok(
      /(?:因果|行动)账本/u.test(v27GameHtml.slice(ledgerIndex)),
      "the secondary ledger needs a user-facing ledger label",
    );
  });
}

assert.deepEqual(
  integrationFailures,
  [],
  `Phase 107 game-first integration is incomplete:\n${integrationFailures.map((row) => `- ${row}`).join("\n")}`,
);

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    localTopDownBackground: backgroundDimensions,
    localCharacterAssets: Object.keys(EXPECTED_CHARACTER_ASSET_PATHS),
    authoritativeSevenZoneLayout: true,
    deterministicTimePeriods: true,
    publicObservationDrivesActorState: true,
    failedMovementDoesNotAnimate: true,
    privateMaintenanceHasNoSpeechBubble: true,
    fixedTavernStartsWithFormalGameStage: true,
    v27ObservationOwnsGameStage: true,
    historicalTextIsSecondaryLedger: true,
  },
}, null, 2));
