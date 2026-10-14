import assert from "node:assert/strict";
import { createLivePerformance, reduceLivePerformanceEvent } from "../src/ui/livePerformance.js";

let live = createLivePerformance({ locationName: "四方法契门" });
live = reduceLivePerformanceEvent(live, { type: "novel_delta", text: "雨落在" });
live = reduceLivePerformanceEvent(live, { type: "novel_delta", text: "铜盘上。" });
live = reduceLivePerformanceEvent(live, {
  type: "psychology_update",
  characterId: "shen",
  characterName: "沈珩",
  heardLine: "你先说是谁要我的命。",
  speakerName: "阎无咎",
  interpretation: "他在拖时间。",
  feeling: "警惕",
  bodyResponse: "拇指抵住剑格。",
  privateThought: "他在等谁来？",
  nextImpulse: "追问幕后的人。",
});

assert.equal(live.novelText, "雨落在铜盘上。", "model deltas should append to one canonical manuscript");
assert.equal(live.psychologyByCharacter.shen.privateThought, "他在等谁来？", "live psychology should be keyed by character");
assert.ok(!live.novelText.includes("他在等谁来"), "private thought must not leak into the reality manuscript");
assert.equal(live.events.length, 0, "legacy action/dialogue cards must not become a second visible manuscript");

console.log("liveNovelPsychologyState:test passed");
