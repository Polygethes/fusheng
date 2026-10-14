import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildObservationEvents } from "../src/ui/render.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});

const market = state.locations.find((location) => /无咎市|市/.test(location.name));
assert.ok(market, "test setup needs a non-contract market district");

const actor = state.characters.find((character) => /沈珩|执律|正道/.test(`${character.name} ${character.publicIdentity}`)) || state.characters[0];
const target = state.characters.find((character) => character.id !== actor.id) || state.characters[1];

state.characterMemories = [
  {
    id: "memory_contract_gate_retreat",
    branchId: state.project.activeBranchId,
    characterId: actor.id,
    targetCharacterId: target.id,
    type: "suppressed",
    stance: "retreat",
    heat: 95,
    reliability: 20,
    content: "上一次在四方法契门，退路被灵契钉住，盖印的人还停在铜盘外。",
    publicVersion: "灵契把退路压在界石前。",
    privateVersion: "那句不能只把话推回去。",
    retrievalCue: "不能只把话推回去",
    sourceRelationshipShift: {
      locationId: "loc_contract_gate",
      locationName: "四方法契门",
      sharedObject: "灵契",
      finalTurn: "不能只把话推回去。",
      eventOutcome: "盖印的人仍停在铜盘外。",
    },
  },
];

state.ui = {
  ...state.ui,
  activeTab: "observe",
  engineMode: "mock",
  focusMode: "focused",
  timeGrain: "scene",
  selectedLocationId: market.id,
  activeCharacterIds: [actor.id, target.id],
};

const draft = playNext(state);
const events = buildObservationEvents(draft, state);
const visibleText = [
  draft.sceneText,
  ...(draft.agentOutputs || []).map((output) => output.visibleAction),
  ...events.flatMap((event) => [
    event.text,
    ...(event.beats || []).map((beat) => beat.text),
  ]),
].filter(Boolean).join("\n");

assert.doesNotMatch(
  visibleText,
  /界石边|铜盘外|盖印的人|留给界石|贴着界石/,
  `non-contract districts must translate old contract-gate memory into local surfaces, got:\n${visibleText}`,
);

assert.match(
  visibleText,
  /案台|妖丹盒/,
  `market scene should keep the remembered pressure on market surfaces, got:\n${visibleText}`,
);

console.log("nonGateMemoryActionLocalizesSurface:test passed", {
  location: market.name,
  actor: actor.name,
  target: target.name,
});
