import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { buildObservationEvents, renderApp } from "../src/ui/render.js";

const state = structuredClone(initialState);
state.ui.activeTab = "observe";
state.ui.timeGrain = "day";
state.ui.focusMode = "location";
state.ui.selectedLocationId = "loc_gregor_room";

const draft = {
  id: "draft_no_template_leak",
  createdAt: "2026-06-29T03:58:00.000Z",
  locationId: "loc_gregor_room",
  participantIds: ["char_gregor", "char_grete", "char_father", "char_mother"],
  periodSimulation: {
    ticks: [
      {
        id: "tick_room",
        label: "上午",
        resolution: "focused_scene",
        locationId: "loc_gregor_room",
        locationName: "格里高尔房间",
        participantIds: ["char_gregor", "char_grete", "char_father"],
        agentOutputs: [
          { characterId: "char_gregor", targetCharacterId: "char_grete", visibleAction: "格里高尔看向格蕾特" },
          { characterId: "char_grete", targetCharacterId: "char_gregor", visibleAction: "私人模拟" },
        ],
      },
      {
        id: "tick_table",
        label: "中午",
        resolution: "background",
        locationId: "loc_parlor",
        locationName: "家庭餐桌",
        participantIds: ["char_grete", "char_father", "char_mother"],
        agentOutputs: [
          { characterId: "char_grete", targetCharacterId: "char_father", visibleAction: "私人模拟" },
          { characterId: "char_father", targetCharacterId: "char_grete", visibleAction: "父亲看向格蕾特" },
        ],
      },
      {
        id: "tick_office",
        label: "下午",
        resolution: "background",
        locationId: "loc_office_counter",
        locationName: "公司柜台",
        participantIds: ["char_father", "char_mother", "char_gregor"],
        agentOutputs: [
          {
            characterId: "char_mother",
            targetCharacterId: "char_gregor",
            visibleAction: "母亲以扶门框、低声劝、避开账本、整理餐具为理由，给了格里高尔一个比旁人更细的回应。 把动作推向：母亲下一步要靠近格里高尔：表面上维持当前身份，实际上测试格里高尔是否会按自己需要的方式回应。",
          },
        ],
      },
    ],
  },
};

state.draftScenes = [draft];
state.ui.observerPlayback = {
  draftId: draft.id,
  visibleCount: 3,
  totalCount: 3,
  status: "complete",
};

const events = buildObservationEvents(draft, state);
const feedText = events.flatMap((event) => [event.text, ...(event.beats || []).map((beat) => beat.text)]).join("\n");
const html = renderApp(state);

assert.ok(!/看向/.test(feedText), "observer feed should not degrade to generic 'look at target' actions");
assert.ok(!/私人模拟|后台运行|低精度|自主计划|把动作推向|表面上|实际上|为理由|更细的回应/.test(feedText), "observer feed should not leak engine or explanatory planning language");
assert.ok(!/你先别开门|把账本拿来/.test(feedText), "observer feed should not synthesize repeated placeholder dialogue for missing actions");
assert.ok(feedText.includes("扶住门框"), "explanatory action lists should be converted into visible stage action");
assert.ok(feedText.includes("低声劝格里高尔"), "converted action should preserve the playable relation to the target");
assert.ok(!/私人模拟|后台运行|低精度|自主计划|把动作推向|表面上|实际上|为理由|更细的回应|看向/.test(html), "rendered observer UI must be protected by the same quality gate");

console.log("observerNoTemplateLeak:test passed", {
  events: events.length,
  sample: events[2]?.beats?.map((beat) => beat.text).join(" / "),
});
