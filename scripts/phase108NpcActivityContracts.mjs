// Phase 108 — NPC activity and motion contracts.
//
// Public seams agreed for this slice:
//   1. renderApp(state): the fixed v2.7 tavern exposes one accessible
//      start/stop activity control and reflects its state on the game stage.
//   2. createNpcActivityLoop(...): a timer-injected controller repeatedly runs
//      one authoritative turn and can be stopped without a stale callback
//      starting another turn.
//   3. renderInkTavernStageMarkup(observation, options) + the shared tavern CSS:
//      local wandering is visibly marked but never changes an authoritative
//      zone; only a committed actor_movement in the public observation may do
//      that. Reduced-motion users receive no actor animation or transition.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const failures = [];
const checks = {};

async function contract(name, assertion) {
  try {
    await assertion();
    checks[name] = "passed";
  } catch (error) {
    checks[name] = "failed";
    failures.push({ name, reason: error?.message || String(error) });
  }
}

function fixedTavernState(activityRunning = false) {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  state.ui = {
    ...state.ui,
    setupCompleted: true,
    activeTab: "reality",
    engineMode: "v27",
    showObserverStage: false,
    v27Observation: null,
    v27Running: false,
    npcActivityRunning: activityRunning,
    // Accept this spelling during the Phase 108 migration. The rendered
    // contract is independent of which of the two state keys survives.
    npcActivityStatus: activityRunning ? "running" : "stopped",
  };
  state.branches = [{ id: "branch_main", title: "主线", snapshot: {} }];
  return state;
}

function tagContaining(markup, needle) {
  const index = markup.indexOf(needle);
  assert.ok(index >= 0, `missing markup token: ${needle}`);
  const start = markup.lastIndexOf("<", index);
  const end = markup.indexOf(">", index);
  assert.ok(start >= 0 && end > index, `cannot isolate tag containing: ${needle}`);
  return markup.slice(start, end + 1);
}

function percentageDeclaration(ruleBody, property) {
  const match = ruleBody.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([0-9.]+)%`, "u"));
  assert.ok(match, `missing percentage ${property} declaration`);
  return Number(match[1]);
}

function exactRuleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^{}]*)\\}`, "mu"));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const renderModule = await import("../src/ui/render.js");
const stageModule = await import("../src/ui/inkTavernStage.js");
const { renderApp } = renderModule;
const { renderInkTavernStageMarkup, buildInkTavernActorStates } = stageModule;

await contract("fixed tavern exposes an idle start-activity button", () => {
  const html = renderApp(fixedTavernState(false));
  const control = tagContaining(html, 'data-npc-activity-control="true"');
  assert.match(control, /data-action=["']toggle-npc-activity["']/u);
  assert.match(control, /aria-pressed=["']false["']/u);
  const controlEnd = html.indexOf("</button>", html.indexOf(control));
  const controlMarkup = html.slice(html.indexOf(control), controlEnd + "</button>".length);
  assert.match(controlMarkup, /开始(?:人物)?活动/u);
  assert.match(html, /data-npc-activity-state=["']stopped["']/u);
});

await contract("running tavern exposes a stop-activity button", () => {
  const html = renderApp(fixedTavernState(true));
  const control = tagContaining(html, 'data-npc-activity-control="true"');
  assert.match(control, /data-action=["']toggle-npc-activity["']/u);
  assert.match(control, /aria-pressed=["']true["']/u);
  const controlEnd = html.indexOf("</button>", html.indexOf(control));
  const controlMarkup = html.slice(html.indexOf(control), controlEnd + "</button>".length);
  assert.match(controlMarkup, /停止(?:人物)?活动/u);
  assert.match(html, /data-npc-activity-state=["']running["']/u);
});

let activityModule = null;
await contract("NPC activity loop is available as a testable public controller", async () => {
  try {
    activityModule = await import("../src/ui/npcActivityLoop.js");
  } catch (error) {
    assert.fail(`missing src/ui/npcActivityLoop.js (${error?.code || error})`);
  }
  assert.equal(
    typeof activityModule.createNpcActivityLoop,
    "function",
    "npcActivityLoop.js must export createNpcActivityLoop",
  );
});

if (typeof activityModule?.createNpcActivityLoop === "function") {
  await contract("activity loop runs immediately, repeats, and stop invalidates stale timers", async () => {
    const pending = new Map();
    const cancelled = [];
    let nextTimerId = 1;
    let runCount = 0;
    const clock = {
      setTimeout(callback, delayMs) {
        const id = nextTimerId;
        nextTimerId += 1;
        pending.set(id, { callback, delayMs });
        return id;
      },
      clearTimeout(id) {
        cancelled.push(id);
        pending.delete(id);
      },
    };
    const loop = activityModule.createNpcActivityLoop({
      runOnce: async () => { runCount += 1; },
      intervalMs: 75,
      clock,
    });

    assert.equal(typeof loop.start, "function");
    assert.equal(typeof loop.stop, "function");
    assert.equal(typeof loop.snapshot, "function");
    assert.equal(loop.snapshot().running, false);

    loop.start();
    loop.start();
    await flushMicrotasks();
    assert.equal(runCount, 1, "start must run promptly and repeated start must not create a parallel loop");
    assert.equal(loop.snapshot().running, true);
    assert.equal(pending.size, 1, "a completed turn must schedule exactly one next turn");
    const [firstTimerId, firstTimer] = [...pending.entries()][0];
    assert.equal(firstTimer.delayMs, 75, "the injected interval must be honored");

    pending.delete(firstTimerId);
    firstTimer.callback();
    await flushMicrotasks();
    assert.equal(runCount, 2, "the scheduled callback must continue the activity loop");
    assert.equal(pending.size, 1, "the next turn must schedule exactly one successor");

    const [staleTimerId, staleTimer] = [...pending.entries()][0];
    loop.stop();
    assert.equal(loop.snapshot().running, false);
    assert.ok(cancelled.includes(staleTimerId), "stop must cancel the outstanding timer");
    staleTimer.callback();
    await flushMicrotasks();
    assert.equal(runCount, 2, "a callback captured before stop must not run another turn");
    assert.equal(pending.size, 0, "stop must leave no scheduled successor");
  });

  await contract("stopping an in-flight turn prevents it from scheduling a successor", async () => {
    const pending = new Map();
    let nextTimerId = 1;
    let releaseTurn;
    let runCount = 0;
    const loop = activityModule.createNpcActivityLoop({
      runOnce: () => {
        runCount += 1;
        return new Promise((resolve) => { releaseTurn = resolve; });
      },
      intervalMs: 25,
      clock: {
        setTimeout(callback, delayMs) {
          const id = nextTimerId;
          nextTimerId += 1;
          pending.set(id, { callback, delayMs });
          return id;
        },
        clearTimeout(id) { pending.delete(id); },
      },
    });

    loop.start();
    await flushMicrotasks();
    assert.equal(runCount, 1);
    assert.equal(loop.snapshot().running, true);
    loop.stop();
    releaseTurn();
    await flushMicrotasks();
    assert.equal(loop.snapshot().running, false);
    assert.equal(pending.size, 0, "an in-flight result may settle, but it may not restart a stopped loop");
  });
}

const quietObservation = {
  nowSeconds: 10 * 3600,
  worldVersion: 1,
  characters: [{
    characterId: "char_xyy_xiezenshi",
    name: "谢真石",
    present: true,
    placeId: "loc_xyy_tavern",
    zoneId: "hall",
  }],
  turns: [],
};

await contract("active idle NPCs receive a walkable patrol within their current zone", () => {
  const markup = renderInkTavernStageMarkup(quietObservation, { activityRunning: true });
  const actor = tagContaining(markup, 'data-character="char_xyy_xiezenshi"');
  assert.match(actor, /class=["'][^"']*\bis-patrolling\b[^"']*["']/u);
  assert.match(actor, /data-local-motion=["']patrol["']/u);
  assert.match(actor, /data-idle-route=["'][^"']+;[^"']+["']/u);
  assert.match(actor, /data-zone=["']hall["']/u);
  assert.match(actor, /data-previous-zone=["']hall["']/u);
  assert.doesNotMatch(actor, /\bis-moving\b/u);
});

await contract("local activity cannot infer cross-zone travel from prose", () => {
  const observation = {
    ...quietObservation,
    worldVersion: 2,
    turns: [{
      characterId: "char_xyy_xiezenshi",
      publicRealization: {
        actionType: "move",
        speech: "",
        visibleAction: "谢真石想去后院看看。",
      },
      outcome: {
        status: "settled",
        committedFacts: [],
        resolvedEffects: [],
      },
    }],
  };
  const [actorState] = buildInkTavernActorStates(observation);
  assert.equal(actorState.zoneId, "hall");
  assert.equal(actorState.previousZoneId, "hall");
  assert.equal(actorState.movementCommitted, false);
  const actor = tagContaining(
    renderInkTavernStageMarkup(observation, { activityRunning: true }),
    'data-character="char_xyy_xiezenshi"',
  );
  assert.match(actor, /data-zone=["']hall["']/u);
  assert.match(actor, /data-previous-zone=["']hall["']/u);
  assert.doesNotMatch(actor, /data-movement-source=["']observation["']/u);
  assert.doesNotMatch(actor, /\bis-moving\b/u);
});

await contract("only a committed observation movement produces cross-zone travel", () => {
  const observation = {
    ...quietObservation,
    worldVersion: 3,
    characters: [{
      ...quietObservation.characters[0],
      zoneId: "counter",
    }],
    turns: [{
      characterId: "char_xyy_xiezenshi",
      publicRealization: {
        actionType: "move",
        speech: "",
        visibleAction: "谢真石走到柜台后。",
      },
      outcome: {
        status: "settled",
        committedFacts: [{
          kind: "actor_movement",
          actorId: "char_xyy_xiezenshi",
          fromZoneId: "hall",
          toZoneId: "counter",
        }],
      },
    }],
  };
  const [actorState] = buildInkTavernActorStates(observation);
  assert.equal(actorState.zoneId, "counter");
  assert.equal(actorState.previousZoneId, "hall");
  assert.equal(actorState.movementCommitted, true);
  const actor = tagContaining(
    renderInkTavernStageMarkup(observation, { activityRunning: true }),
    'data-character="char_xyy_xiezenshi"',
  );
  assert.match(actor, /data-zone=["']counter["']/u);
  assert.match(actor, /data-previous-zone=["']hall["']/u);
  assert.match(actor, /data-movement-source=["']observation["']/u);
  assert.match(actor, /data-movement-key=["'][^"']+["']/u);
  assert.match(actor, /\bis-moving\b/u);
  assert.doesNotMatch(actor, /\bis-wandering\b/u, "cross-zone travel and local wandering must not compete");
});

const stageCss = await readFile(new URL("../src/ink-tavern-stage.css", import.meta.url), "utf8");
const mainCss = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

await contract("NPCs are significantly smaller than the Phase 107 figures", () => {
  assert.match(mainCss, /@import\s+["']\.\/ink-tavern-stage\.css["']/u, "the main page must load the shared stage CSS");
  const figureRule = exactRuleBody(stageCss, ".ink-tavern-figure");
  const portraitRule = exactRuleBody(stageCss, '.ink-tavern-actor[data-sprite-kind="portrait"] .ink-tavern-figure');
  const figureWidth = percentageDeclaration(figureRule, "width");
  const figureHeight = percentageDeclaration(figureRule, "height");
  const portraitWidth = percentageDeclaration(portraitRule, "width");
  const portraitHeight = percentageDeclaration(portraitRule, "height");
  assert.ok(figureWidth <= 8, `full-body NPC width must be <= 8% of the stage, received ${figureWidth}%`);
  assert.ok(figureHeight <= 28, `full-body NPC height must be <= 28% of the stage, received ${figureHeight}%`);
  assert.ok(portraitWidth <= 8, `portrait NPC width must be <= 8% of the stage, received ${portraitWidth}%`);
  assert.ok(portraitHeight <= 25, `portrait NPC height must be <= 25% of the stage, received ${portraitHeight}%`);
});

await contract("patrolling uses the navigation route rather than a CSS side-to-side illusion", async () => {
  const stageSource = await readFile(new URL("../src/ui/inkTavernStage.js", import.meta.url), "utf8");
  assert.match(stageSource, /buildTavernPatrolRoute/u);
  assert.match(stageSource, /iterations\s*:\s*Infinity/u);
  assert.match(stageSource, /data-idle-route/u);
  assert.doesNotMatch(stageCss, /ink-tavern-local-wander|npc-roam-distance/u);
});

await contract("reduced-motion removes all tavern actor motion", () => {
  const mediaStart = stageCss.search(/@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/u);
  assert.ok(mediaStart >= 0, "missing prefers-reduced-motion: reduce fallback");
  const reducedMotionCss = stageCss.slice(mediaStart);
  assert.match(reducedMotionCss, /\.ink-tavern-actor/u);
  assert.match(reducedMotionCss, /\.ink-tavern-figure/u);
  assert.match(reducedMotionCss, /animation\s*:\s*none\s*!important/u);
  assert.match(reducedMotionCss, /transition\s*:\s*none\s*!important/u);
});

const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
await contract("the main entry wires the activity button to the loop controller", () => {
  assert.ok(
    /from\s+["']\.\/ui\/npcActivityLoop\.js["']/u.test(mainSource),
    "main.js must import the public NPC activity loop controller",
  );
  assert.ok(
    /action\s*===\s*["']toggle-npc-activity["']/u.test(mainSource),
    "main.js must handle the rendered toggle-npc-activity action",
  );
  assert.ok(/\.start\s*\(/u.test(mainSource), "the activity action must be able to start the loop");
  assert.ok(/\.stop\s*\(/u.test(mainSource), "the activity action must be able to stop the loop");
});

await contract("stage actor nodes survive unrelated activity renders", async () => {
  assert.ok(
    /reconcileInkTavernStageDom/u.test(mainSource),
    "main.js must reconcile the persistent tavern stage",
  );
  assert.ok(
    /preservedInkTavernStage[\s\S]*nextInkTavernStage\.replaceWith\(preservedInkTavernStage\)/u.test(mainSource),
    "the existing stage must be reinserted instead of replacing all actor nodes",
  );
  const stageSource = await readFile(new URL("../src/ui/inkTavernStage.js", import.meta.url), "utf8");
  assert.ok(
    /export function reconcileInkTavernStageDom/u.test(stageSource),
    "the stage module must expose keyed DOM reconciliation",
  );
  assert.ok(
    /previousMovementKey[\s\S]*previousMovementKey !== nextMovementKey/u.test(stageSource),
    "movement animation may restart only for a new authoritative presentation key",
  );
});

const report = {
  status: failures.length ? "expected-red" : "all-passed",
  checks,
  failures,
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
