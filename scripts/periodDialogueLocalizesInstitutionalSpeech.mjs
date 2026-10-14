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
);

const offsiteDialogueLeaks = shifts.filter((shift) => {
  const locationName = shift.locationName || "";
  const text = (shift.dialogueTurns || []).map((turn) => turn.line).join(" ");
  const gateLeak = !/四方法契门|法契|契门|界石/.test(locationName)
    && /扣契|铜盘|盖印|留给界石|贴着界石|界石还照着/.test(text);
  const clinicLeak = !/万灵|医坊/.test(locationName)
    && /药炉前|留在药炉旁|诊床/.test(text);
  return gateLeak || clinicLeak;
});

assert.equal(
  offsiteDialogueLeaks.length,
  0,
  `institutional speech should localize to the current district, got:\n${JSON.stringify(offsiteDialogueLeaks.slice(0, 5).map((shift) => ({
    slot: shift.periodSlot,
    locationName: shift.locationName,
    sharedObject: shift.sharedObject,
    turns: (shift.dialogueTurns || []).map((turn) => `${turn.speakerName}: ${turn.line}`),
  })), null, 2)}`,
);

const offsiteObserverLeaks = buildObservationEvents(draft, state).filter((event) => {
  const locationName = event.location || "";
  const text = event.text || "";
  const gateLeak = !/四方法契门|法契|契门|界石/.test(locationName)
    && /扣契|铜盘|盖印|留给界石|贴着界石|界石还照着/.test(text);
  const clinicLeak = !/万灵|医坊/.test(locationName)
    && /药炉前|留在药炉旁|诊床/.test(text);
  return event.movementSource === "period-tick" && (gateLeak || clinicLeak);
});

assert.equal(
  offsiteObserverLeaks.length,
  0,
  `observer prose should not surface offsite institutional speech, got:\n${JSON.stringify(offsiteObserverLeaks.slice(0, 5).map((event) => ({
    time: event.time,
    location: event.location,
    text: event.text,
  })), null, 2)}`,
);

const gateSurfaceLeaks = shifts.filter((shift) => {
  const locationName = shift.locationName || "";
  if (!/四方法契门|法契|契门|界石/.test(locationName)) return false;
  const text = (shift.dialogueTurns || []).map((turn) => turn.line).join(" ");
  return /(?:灵契|契牌|毒誓符|魔印|符)[^。！？]{0,18}桌面/.test(text);
});

assert.equal(
  gateSurfaceLeaks.length,
  0,
  `contract-gate dialogue should keep contract objects on the gate surface, got:\n${JSON.stringify(gateSurfaceLeaks.slice(0, 5).map((shift) => ({
    slot: shift.periodSlot,
    locationName: shift.locationName,
    sharedObject: shift.sharedObject,
    turns: (shift.dialogueTurns || []).map((turn) => `${turn.speakerName}: ${turn.line}`),
  })), null, 2)}`,
);

console.log("periodDialogueLocalizesInstitutionalSpeech:test passed", {
  checked: shifts.length,
});
