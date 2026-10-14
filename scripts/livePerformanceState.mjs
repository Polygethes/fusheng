import assert from "node:assert/strict";
import { createLivePerformance, reduceLivePerformanceEvent } from "../src/ui/livePerformance.js";

let live = createLivePerformance({
  locationName: "四方法契门",
  grain: "scene",
});
live = reduceLivePerformanceEvent(live, { type: "run_started", runId: "run_1", locationName: "四方法契门" });
live = reduceLivePerformanceEvent(live, {
  type: "scene_started",
  slotLabel: "上午",
  locationName: "四方法契门",
  characterIds: ["char_shen", "char_yan"],
  characterNames: ["沈珩", "阎无咎"],
});
live = reduceLivePerformanceEvent(live, { type: "agent_thinking", characterId: "char_shen", characterName: "沈珩" });
live = reduceLivePerformanceEvent(live, { type: "agent_ready", characterId: "char_yan", characterName: "阎无咎" });
live = reduceLivePerformanceEvent(live, {
  type: "action",
  actorId: "char_shen",
  actorName: "沈珩",
  targetId: "char_yan",
  targetName: "阎无咎",
  text: "沈珩把契牌扣在铜盘边。",
  privateDesire: "绝不能进入现实状态",
});
live = reduceLivePerformanceEvent(live, {
  type: "dialogue",
  speakerId: "char_yan",
  speakerName: "阎无咎",
  targetId: "char_shen",
  targetName: "沈珩",
  line: "先把契牌还我。",
  respondsTo: "名字写明白再说。",
  privateIntent: "绝不能进入现实状态",
});

assert.equal(live.runId, "run_1");
assert.equal(live.status, "running");
assert.equal(live.agents.find((agent) => agent.characterId === "char_shen")?.status, "observing");
assert.equal(live.agents.find((agent) => agent.characterId === "char_yan")?.status, "speaking");
assert.deepEqual(live.events.map((event) => event.type), ["action", "dialogue"]);
assert.equal(live.events[1].targetName, "沈珩");
assert.equal(live.events[1].respondsTo, "名字写明白再说。");
assert.doesNotMatch(JSON.stringify(live), /绝不能进入现实状态|privateDesire|privateIntent/);

live = reduceLivePerformanceEvent(live, { type: "complete", draft: { id: "draft_1" } });
assert.equal(live.status, "complete");
assert.equal(live.draftId, "draft_1");

console.log("livePerformanceState:test passed", { events: live.events.length, agents: live.agents.length });
