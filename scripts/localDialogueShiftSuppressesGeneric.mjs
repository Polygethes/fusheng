import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

state.ui.timeGrain = "scene";
state.ui.activeCharacterIds = ["char_xianxia_shenheng", "char_xianxia_yanwujie"];
state.ui.selectedLocationId = "loc_xianxia_contract_gate";

const draft = playNext(state);
const dialoguePairs = new Set(
  (draft.relationshipShift || [])
    .filter((shift) => shift.generatedFrom === "agent-dialogue-relationship")
    .map((shift) => `${shift.fromCharacterId}->${shift.toCharacterId}`),
);

assert.ok(dialoguePairs.size >= 2, "scene should produce dialogue-derived relationship shifts in both directions");

const genericDuplicates = (draft.relationshipShift || [])
  .filter((shift) => dialoguePairs.has(`${shift.fromCharacterId}->${shift.toCharacterId}`))
  .filter((shift) => shift.generatedFrom !== "agent-dialogue-relationship")
  .filter((shift) => !shift.interventionId);

assert.equal(
  genericDuplicates.length,
  0,
  `dialogue pairs should not also receive generic tone/mutation shifts: ${JSON.stringify(genericDuplicates, null, 2)}`,
);

for (const shift of draft.updateBundle?.relationships || []) {
  const pair = `${shift.fromCharacterId}->${shift.toCharacterId}`;
  if (!dialoguePairs.has(pair) || shift.interventionId) continue;
  assert.equal(
    shift.generatedFrom,
    "agent-dialogue-relationship",
    `update bundle should preserve only dialogue-derived shifts for ${pair}`,
  );
}

console.log("localDialogueShiftSuppressesGeneric:test passed", {
  dialoguePairs: [...dialoguePairs],
  relationshipShiftCount: draft.relationshipShift?.length || 0,
});
