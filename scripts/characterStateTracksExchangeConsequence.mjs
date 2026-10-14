import assert from "node:assert/strict";
import { buildUpdateBundle } from "../src/engine/stateUpdater.js";

const state = {
  project: { id: "project_test" },
  ui: { activeBranchId: "branch_main" },
  characters: [
    {
      id: "char_lu",
      name: "鹿青萝",
      currentState: {
        desire: 20,
        shame: 20,
        rage: 20,
        selfDeception: 20,
        revengeImpulse: 20,
        protectionImpulse: 20,
        currentSelfLie: "我只是守着药炉。",
      },
    },
    {
      id: "char_shen",
      name: "沈珩",
      currentState: {
        desire: 20,
        shame: 20,
        rage: 20,
        selfDeception: 20,
        revengeImpulse: 20,
        protectionImpulse: 20,
        currentSelfLie: "我只是按城法审讯。",
      },
    },
  ],
  locations: [{ id: "loc_clinic", name: "万灵医坊" }],
  relationships: [],
  characterPlans: [],
};

const draft = {
  id: "draft_exchange_state_trace",
  projectId: "project_test",
  branchId: "branch_main",
  locationId: "loc_clinic",
  participantIds: ["char_lu", "char_shen"],
  agentOutputs: [
    {
      outputId: "out_lu_protect",
      characterId: "char_lu",
      targetCharacterId: "char_shen",
      tone: "试探",
      visibleAction: "鹿青萝把庇护牌压到药炉旁，挡住沈珩看向伤者的路。",
      surfaceJustification: "药炉前先救人。",
      desireReason: "她不想让证词变成逼供。",
      hiddenAction: "她把证词藏在庇护牌下。",
      unadmittedPleasure: "沈珩必须先向医坊解释。",
    },
  ],
  relationshipShift: [
    {
      generatedFrom: "agent-dialogue-relationship",
      relationshipSource: "agent-exchange",
      sourceOutputId: "out_lu_protect",
      responseOutputId: "out_shen_blocked",
      fromCharacterId: "char_lu",
      toCharacterId: "char_shen",
      sharedObject: "庇护牌",
      locationId: "loc_clinic",
      locationName: "万灵医坊",
      dialogueTurnCount: 4,
      dialogueTurns: [
        { speakerId: "char_lu", speakerName: "鹿青萝", line: "药炉前先救人。" },
        { speakerId: "char_shen", speakerName: "沈珩", line: "证词不能留在医坊。" },
        { speakerId: "char_lu", speakerName: "鹿青萝", line: "病人先活，证词不能现在交。" },
      ],
      relationshipDialogueAct: {
        kind: "protect",
        reason: "鹿青萝把庇护牌重新命名为救命和保护的边界。",
      },
      deltas: { protection: 5, fear: 2, wantsToEscape: 2 },
      eventOutcome: "沈珩没能带走半份证词，鹿青萝用庇护牌护住伤者并获得医坊临时控制；沈珩若要审讯，必须先把理由交给药炉",
      finalTurn: "病人先活，证词不能现在交。",
      followupTurn: "病人先活，证词不能现在交。",
      misreading: "鹿青萝把沈珩的审讯听成对伤者的逼近。",
      unspoken: "庇护牌留在药炉旁。",
    },
  ],
  periodSimulation: {
    ticks: [
      {
        id: "tick_clinic",
        label: "下午",
        locationId: "loc_clinic",
        locationName: "万灵医坊",
        sceneInteraction: {
          agentExchanges: [
            {
              sourceOutputId: "out_lu_protect",
              responseOutputId: "out_shen_blocked",
              sourceCharacterId: "char_lu",
              responseCharacterId: "char_shen",
              actorName: "鹿青萝",
              targetName: "沈珩",
              sharedObject: "庇护牌",
              eventOutcome: "沈珩没能带走半份证词，鹿青萝用庇护牌护住伤者并获得医坊临时控制；沈珩若要审讯，必须先把理由交给药炉",
              relationshipDeltas: [],
              dialogueTurns: [],
            },
          ],
        },
      },
    ],
  },
  irreversibleTraces: [],
  audit: {},
};

const bundle = buildUpdateBundle(draft, state);
const luPatch = bundle.characters.find((patch) => patch.id === "char_lu");
assert.ok(luPatch, "鹿青萝 should receive a state patch");

assert.ok(
  luPatch.currentState.protectionImpulse >= 28,
  `protective exchange consequence should push protectionImpulse beyond tone-only update, got ${luPatch.currentState.protectionImpulse}`,
);

const stateReason = bundle.stateChangeReasons.find((reason) => reason.kind === "character_state" && reason.characterId === "char_lu");
assert.ok(stateReason, "character_state reason should exist for 鹿青萝");
assert.equal(stateReason.sourceOutputId, "out_lu_protect", "character_state reason should trace source output");
assert.equal(stateReason.responseOutputId, "out_shen_blocked", "character_state reason should trace response output");
assert.match(
  `${stateReason.reason} ${stateReason.deltaSummary}`,
  /沈珩没能带走|医坊临时控制|庇护牌|protectionImpulse/,
  "character_state reason should cite the exchange consequence, not only the visible action",
);

console.log("characterStateTracksExchangeConsequence:test passed", {
  protectionImpulse: luPatch.currentState.protectionImpulse,
  reason: stateReason.reason,
});
