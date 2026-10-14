import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildObservationEvents } from "../src/ui/render.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});

state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.activeTab = "observe";

const draft = playNext(state);
const shifts = (draft.relationshipShift || []).filter((shift) =>
  shift.generatedFrom === "agent-dialogue-relationship"
  && !/四方法契门|法契|契门/.test(shift.locationName || "")
);
const misplaced = shifts.filter((shift) => {
  const text = `${shift.eventOutcome || ""} ${(shift.dialogueTurns || []).map((turn) => turn.line).join(" ")}`;
  const gateProcedureLeak = /(?:妖丹盒|渡令|庇护牌|药炉|照骨镜).*贴着界石|(?:符|魔印|妖丹盒|渡令|庇护牌|药炉|照骨镜).*留给界石|盖印的人仍停在铜盘外/.test(text);
  const clinicSurfaceLeak = !/万灵|医坊/.test(shift.locationName || "")
    && /拿离药炉|留在药炉旁|诊床|伤者仍留在医坊/.test(text);
  const heavyClinicPropMovedOffsite = !/万灵|医坊/.test(shift.locationName || "")
    && /药炉[^。！？]*?(案台|石阶|水线|岸边|铜盘|镜下|推|挪|压)/.test(text);
  return gateProcedureLeak || clinicSurfaceLeak || heavyClinicPropMovedOffsite;
});

assert.equal(
  misplaced.length,
  0,
  `non-gate period dialogue should use local procedure language, got:\n${JSON.stringify(misplaced.slice(0, 4).map((shift) => ({
    slot: shift.periodSlot,
    locationName: shift.locationName,
    sharedObject: shift.sharedObject,
    eventOutcome: shift.eventOutcome,
    turns: (shift.dialogueTurns || []).map((turn) => turn.line),
  })), null, 2)}`,
);

const observationEvents = buildObservationEvents(draft, state).filter((event) => !/万灵|医坊/.test(event.location || ""));
const misplacedObserverEvents = observationEvents.filter((event) =>
  /药炉[^。！？]*?(案台|石阶|水线|岸边|铜盘|镜下|推|挪|压)|诊床|伤者仍留在医坊|留给界石|盖印的人也先别进来/.test(event.text || ""),
);

assert.equal(
  misplacedObserverEvents.length,
  0,
  `observer prose should not move clinic surfaces into other locations, got:\n${JSON.stringify(misplacedObserverEvents.slice(0, 4).map((event) => ({
    time: event.time,
    location: event.location,
    text: event.text,
  })), null, 2)}`,
);

console.log("periodNonGateDialogueUsesLocalProcedure:test passed", {
  checked: shifts.length,
});
