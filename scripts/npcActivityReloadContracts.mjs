import assert from "node:assert/strict";
import * as store from "../src/state/store.js";

const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const values = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
});

try {
  store.applySetupWorld({ setupWorldPrompt: "逍遥游，望梯酒馆", setupPeoplePrompt: "谢真石、洛照" });
  store.setUi({ engineMode: "v27", activeTab: "reality", npcActivitySpeed: "fast" });
  const before = store.getState();
  const runtimeId = `tavern-v27:${before.project.runtimeInstanceId}`;
  const ref = store.setRuntimeSessionRef({ runtimeId, sessionId: "reload-regression-session", sessionRevision: 2, worldVersion: 1 });
  store.setRuntimeObservation(runtimeId, {
    sessionRef: ref, worldVersion: 1, nowSeconds: 1, eventCount: 1,
    turns: [{
      characterId: "char_xyy_xiezenshi", agentTurnId: "reload-regression-turn", turnKind: "action",
      outcome: { worldVersion: 1, status: "success", primitive: "speak", resolvedEffects: [{ kind: "speech_emitted", vocalMode: "conversational" }] },
    }],
  });
  const expected = store.getState();
  const persisted = values.get("character-town-observer-state-v12");
  assert.ok(JSON.parse(persisted).runtimeObservations[0].observation.turns[0].outcome.resolvedEffects.length);

  // A new module evaluation reproduces browser refresh. importState() alone
  // cannot catch initialization-order failures because its constants are ready.
  const reloadedStore = await import("../src/state/store.js?npc-activity-reload-contract");
  const reloaded = reloadedStore.getState();
  assert.equal(reloaded.project.runtimeInstanceId, expected.project.runtimeInstanceId,
    "refresh must retain the running world's identity instead of resetting to setup");
  assert.equal(reloaded.ui.activeTab, "reality");
  assert.equal(reloaded.ui.npcActivitySpeed, "fast");
  assert.equal(reloaded.ui.npcActivityRunning, false);
  assert.equal(reloaded.ui.v27Running, false);
  assert.deepEqual(reloaded.runtimeSessions, expected.runtimeSessions);
  assert.deepEqual(reloaded.ui.v27Observation, expected.ui.v27Observation);
  assert.equal(values.get("character-town-observer-state-v12"), persisted, "refresh must not overwrite the existing world with defaults");
  console.log("NPC activity reload contracts passed: committed world, history, cursor and fast preference survive fresh module initialization");
} finally {
  if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
  else delete globalThis.localStorage;
}
