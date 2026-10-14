import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildObservationEvents } from "../src/ui/render.js";

const state = {
  project: { id: "proj_mock_naturalness", title: "取经路", activeBranchId: "branch_main" },
  ui: {
    engineMode: "mock",
    activeTab: "observe",
    activeBranchId: "branch_main",
    timeGrain: "day",
    focusMode: "ambient",
    selectedLocationId: "loc_gate",
    activeCharacterIds: ["char_tang", "char_wukong", "char_bajie"],
    userDirective: "",
    injectedEvent: "",
  },
  town: { id: "town_mock_naturalness", name: "取经路上的流动小镇" },
  branches: [{ id: "branch_main", title: "主线" }],
  relationships: [],
  characterMemories: [],
  characterPlans: [],
  interventions: [],
  evidence: [],
  rumors: [],
  irreversibleTraces: [],
  canonEvents: [],
  draftScenes: [],
  locations: [
    { id: "loc_gate", name: "山门前", likelyEvents: ["山门求救"] },
    { id: "loc_forest", name: "密林小路", likelyEvents: ["行李落地"] },
    { id: "loc_cave", name: "妖洞厅", likelyEvents: ["妖影掠过"] },
  ],
  characters: [
    {
      id: "char_tang",
      name: "唐僧",
      currentState: { desire: 60, shame: 30, rage: 20, selfDeception: 45, revengeImpulse: 10, protectionImpulse: 65 },
      actionLines: { visible: "念经、收好通关文牒、让同行者停下。", desire: "抵达目的地。", defense: "按规矩继续走。", shadow: "让别人替他承担危险。" },
      actionVerbs: { visible: ["念经"], hidden: ["等待"] },
      defenseLanguage: ["先停一停"],
    },
    {
      id: "char_wukong",
      name: "孙悟空",
      currentState: { desire: 50, shame: 20, rage: 50, selfDeception: 35, revengeImpulse: 30, protectionImpulse: 45 },
      actionLines: { visible: "探路、挡住来人、用金箍棒点地。", desire: "先看清危险。", defense: "只是照规矩办。", shadow: "把不耐烦藏进保护。" },
      actionVerbs: { visible: ["探路"], hidden: ["试探"] },
      defenseLanguage: ["我去前面看看"],
    },
    {
      id: "char_bajie",
      name: "猪八戒",
      currentState: { desire: 42, shame: 25, rage: 22, selfDeception: 50, revengeImpulse: 20, protectionImpulse: 28 },
      actionLines: { visible: "讨价还价、扶住行李担、往路边退。", desire: "少担一点苦。", defense: "这路不对劲。", shadow: "把偷懒说成谨慎。" },
      actionVerbs: { visible: ["讨价还价"], hidden: ["拖延"] },
      defenseLanguage: ["这路不对劲"],
    },
  ],
};

const draft = playNext(state);
const events = buildObservationEvents(draft, state);
const feedText = events.flatMap((event) => [event.text, ...(event.beats || []).map((beat) => beat.text)]).join("\n");

assert.ok(!/念经.+一句|探路.+一句|冷笑.+一句|讨价还价.+一句/.test(feedText), "physical or continuous actions should not be rendered as 'verb target one sentence'");
assert.ok(!/手里的(?:桌沿|门边的椅子)|把手里的|桌沿摊开|门边的椅子摊开/.test(feedText), "non-portable scenery should not be held or unfolded");
assert.ok(!/[\u4e00-\u9fa5·]{2,12}\s+随后/.test(feedText), "dialogue stripping should not leave a speaker-name fragment before the next action");
assert.ok(/通关文牒|行李担|金箍棒|石阶|火把/.test(feedText), "journey-world actions should use plausible concrete props");

console.log("mockActionNaturalness:test passed", {
  draftId: draft.id,
  sample: events[0]?.beats?.map((beat) => beat.text).join(" / "),
});
