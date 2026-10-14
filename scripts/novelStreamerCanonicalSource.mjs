import assert from "node:assert/strict";
import { buildCanonicalSceneSource, streamSceneNovel } from "../src/server/pipeline/novelStreamer.mjs";

const compact = {
  selectedLocation: { id: "gate", name: "四方法契门" },
  activeCharacters: [{ id: "shen", name: "沈珩" }, { id: "yan", name: "阎无咎" }],
};
const sceneInteraction = {
  surfaceEvent: "铜盘截住两块契牌。",
  sceneText: "沈珩扣住契牌。沈珩说：“把契牌留下。”沈珩说：“把契牌留下。”",
  interactionBeats: [
    { actorId: "shen", actorName: "沈珩", targetId: "yan", targetName: "阎无咎", beat: "沈珩扣住契牌。" },
    { actorId: "shen", actorName: "沈珩", targetId: "yan", targetName: "阎无咎", beat: "沈珩扣住契牌。" },
  ],
  agentExchanges: [{
    sharedObject: "契牌",
    dialogueTurns: [
      { speakerId: "shen", speakerName: "沈珩", targetId: "yan", targetName: "阎无咎", line: "把契牌留下。" },
      { speakerId: "yan", speakerName: "阎无咎", targetId: "shen", targetName: "沈珩", line: "你先说是谁要我的命。" },
    ],
    eventOutcome: "两块契牌都没有离开铜盘。",
  }],
};

const source = buildCanonicalSceneSource(compact, sceneInteraction);
assert.equal(source.actions.length, 1, "duplicate structured actions should enter the writer once");
assert.equal(source.dialogue.length, 2, "each public line should enter the writer once");
assert.equal((JSON.stringify(source).match(/把契牌留下/g) || []).length, 1, "sceneText must not duplicate canonical dialogue");

let prompt = "";
const deltas = [];
const result = await streamSceneNovel(compact, sceneInteraction, {
  callStream: async ({ user, onDelta }) => {
    prompt = user;
    await onDelta("雨水敲着铜盘。\n\n");
    await onDelta("沈珩说：“把契牌留下。”");
    return { text: deltas.join(""), meta: { model: "fixture", provider: "test" } };
  },
  onDelta: async (delta) => deltas.push(delta),
});

assert.match(prompt, /你先说是谁要我的命/, "the writer should receive the complete public transcript");
assert.equal(result.novelText, "雨水敲着铜盘。\n\n沈珩说：“把契牌留下。”", "the canonical manuscript should be exactly the streamed text");

console.log("novelStreamerCanonicalSource:test passed", { actions: source.actions.length, dialogue: source.dialogue.length });
