import assert from "node:assert/strict";
import { streamSceneNovel } from "../src/server/pipeline/novelStreamer.mjs";

const compact = {
  selectedLocation: { id: "room", name: "门厅" },
  activeCharacters: [{ id: "a", name: "甲" }, { id: "b", name: "乙" }],
};
const scene = {
  surfaceEvent: "两个人同时按住门把。",
  sceneText: "门把在两只手之间响了一声。乙说：“你先退后。”甲没有松手。",
  interactionBeats: [{ actorId: "a", actorName: "甲", targetId: "b", targetName: "乙", beat: "甲按住门把。" }],
  agentExchanges: [{
    dialogueTurns: [{ speakerId: "b", speakerName: "乙", targetId: "a", targetName: "甲", line: "你先退后。" }],
    eventOutcome: "甲没有松手。",
  }],
};

const partialDeltas = [];
const partial = await streamSceneNovel(compact, scene, {
  callStream: async ({ onDelta }) => {
    await onDelta("门把在两只手之间轻轻响了");
    throw new TypeError("fetch failed");
  },
  onDelta: async (delta) => partialDeltas.push(delta),
});
assert.equal(partial.novelText, partialDeltas.join(""));
assert.match(partial.novelText, /门把在两只手之间/);
assert.equal(partial.degraded, true, "a broken stream after visible text should finalize the partial manuscript");
assert.equal(partial.failure, "fetch failed");

const fallbackDeltas = [];
const fallback = await streamSceneNovel(compact, scene, {
  callStream: async () => { throw new TypeError("fetch failed"); },
  onDelta: async (delta) => fallbackDeltas.push(delta),
});
assert.equal(fallback.novelText, scene.sceneText, "a writer failure before the first token should reuse the real structured scene prose");
assert.equal(fallbackDeltas.join(""), scene.sceneText, "fallback prose must still travel through the live manuscript channel");
assert.equal(fallback.degraded, true);

console.log("novelStreamerFailureRecovery:test passed", {
  partialLength: partial.novelText.length,
  fallbackLength: fallback.novelText.length,
});
