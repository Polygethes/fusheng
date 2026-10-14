import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const storageKey = "character-town-observer-state-v12";
const v2 = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
v2.worldSetup.tavernLifeVersion = 2;
v2.ui.engineMode = "local";
const values = new Map([[storageKey, JSON.stringify(v2)]]);
globalThis.localStorage = {
  getItem(key) { return values.get(key) ?? null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};

const store = await import(`../src/state/store.js?runtime-migration=${Date.now()}`);
const migrated = store.getState();
assert.equal(migrated.worldSetup.tavernLifeVersion, 11);
assert.equal(migrated.ui.engineMode, "openai");

const originalFetch = globalThis.fetch;
let requestUrl = "";
let requestBody = null;
globalThis.fetch = async (url, options) => {
  requestUrl = String(url);
  requestBody = JSON.parse(options.body);
  const encoder = new TextEncoder();
  const payload = [
    { type: "run_started", seq: 1, runId: "v2_migration_remote_run" },
    { type: "dialogue", seq: 2, speakerId: "char_xyy_xieheng", speakerName: "谢恒", targetId: "char_xyy_xiemu", targetName: "谢母", line: "今晚的米，还够几桌？" },
    { type: "complete", seq: 3, draft: { id: "draft_v2_remote", provider: "model-tavern-activity-witness", novelText: "谢恒问了今晚的米。" } },
  ].map((event) => `${JSON.stringify(event)}\n`).join("");
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "application/x-ndjson" } });
};

try {
  const { playNext } = await import(`../src/engine/playService.js?runtime-route=${Date.now()}`);
  const events = [];
  const draft = await playNext(migrated, { onEvent(event) { events.push(event); } });
  assert.equal(requestUrl, "/api/engine/play/stream", "migrated v2 save must stop running browser mock directly");
  assert.equal(requestBody.mode, "openai");
  assert.equal(requestBody.allowFallback, false);
  assert.ok(events.some((event) => event.type === "dialogue"));
  assert.equal(draft.id, "draft_v2_remote");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("tavernV2BrowserPlayRoutesRemote:test passed", { mode: requestBody.mode, requestUrl });
