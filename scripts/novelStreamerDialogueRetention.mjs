import assert from "node:assert/strict";
import { streamSceneNovel } from "../src/server/pipeline/novelStreamer.mjs";

const compact = {
  selectedLocation: { id: "reservoir", name: "储水区" },
  activeCharacters: [
    { id: "mela", name: "梅拉", publicIdentity: "守水人" },
    { id: "lily", name: "莉莉", publicIdentity: "信号手" },
  ],
};
const sceneInteraction = {
  surfaceEvent: "水位线又退了一指。",
  interactionBeats: [{ actorId: "mela", actorName: "梅拉", targetId: "lily", targetName: "莉莉", beat: "梅拉把沙漏放到水位刻痕旁。" }],
  agentExchanges: [{
    sourceCharacterId: "mela",
    sourceCharacterName: "梅拉",
    responseCharacterId: "lily",
    responseCharacterName: "莉莉",
    sharedObject: "沙漏",
    dialogueTurns: [
      { speakerId: "mela", speakerName: "梅拉", targetId: "lily", targetName: "莉莉", line: "日落前，你选一条路。" },
      { speakerId: "lily", speakerName: "莉莉", targetId: "mela", targetName: "梅拉", line: "我去找信号弹落下的地方。" },
      { speakerId: "mela", speakerName: "梅拉", targetId: "lily", targetName: "莉莉", line: "把路线画出来，我跟你去。" },
    ],
    eventOutcome: "沙漏和路线图都留在水位刻痕旁。",
  }],
};

const emitted = [];
const result = await streamSceneNovel(compact, sceneInteraction, {
  callStream: async ({ onDelta }) => {
    const text = "梅拉把沙漏放在水位刻痕旁。莉莉隔着石槽看着她。";
    await onDelta(text);
    return { text, meta: { provider: "test", model: "writer-without-dialogue" } };
  },
  onDelta: async (delta) => emitted.push(delta),
});

assert.match(result.novelText, /日落前，你选一条路/, "actual agent dialogue must survive a writer that omits all speech");
assert.match(result.novelText, /我去找信号弹落下的地方/, "the response must survive with the initiating line");
assert.ok(/[“”]/.test(result.novelText), "retained agent dialogue should remain novel dialogue, not debug labels");
assert.equal(emitted.join(""), result.novelText, "the visible stream and final manuscript must remain byte-identical");

console.log("novelStreamerDialogueRetention:test passed", { novelText: result.novelText });
