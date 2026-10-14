import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const badLines = [];

for (let index = 0; index < 24; index += 1) {
  const scene = runSceneInteractionSimulation({
    state: { characters: [] },
    simulationTick: {
      id: `tick_teahouse_write_name_${index}`,
      locationId: "loc_xianxia_teahouse",
      locationName: "停剑茶楼",
      visiblePressure: "停剑令压在茶盏旁，谈判桌边的人都看着谁先伸手。",
      privateSimulations: [
        {
          characterId: "char_xianxia_shenheng",
          characterName: "沈珩",
          privateDesire: "让闻夏承认停剑令不能被带离桌面。",
          defensiveMask: "剑可以停，证据不能走。",
          shadowImpulse: "把谈判资格先压到自己手里。",
          agentProfile: {
            publicIdentity: "正道玄衡宗执律剑修",
            dramaticObjective: "让停剑城承认正道审判资格",
          },
        },
        {
          characterId: "char_xianxia_wenxia",
          characterName: "闻夏",
          privateDesire: "让停剑令留在桌面，但不让沈珩越过城法。",
          defensiveMask: "城法只认灵痕和供词。",
          shadowImpulse: "把正道审讯拖回停剑流程。",
          agentProfile: {
            publicIdentity: "城中执法者",
            dramaticObjective: "让正邪两派都留在停剑令下说话",
          },
        },
      ],
    },
    agentOutputs: [
      {
        outputId: `out_shen_${index}`,
        characterId: "char_xianxia_shenheng",
        targetCharacterId: "char_xianxia_wenxia",
        characterName: "沈珩",
        visibleAction: "沈珩扣住闻夏面前的停剑令，把停剑令推到桌面。沈珩说：“按城规，证据不能走。”",
      },
      {
        outputId: `out_wenxia_${index}`,
        characterId: "char_xianxia_wenxia",
        targetCharacterId: "char_xianxia_shenheng",
        characterName: "闻夏",
        visibleAction: "闻夏让沈珩推来的停剑令停在原处，指节压住边缘。闻夏说：“停剑令压在桌面，谁先伸手谁先说名？”",
        interactionInput: {
          sourceCharacterId: "char_xianxia_shenheng",
          sourceOutputId: `out_shen_${index}`,
          observedVisibleAction: "沈珩扣住闻夏面前的停剑令，把停剑令推到桌面。沈珩说：“按城规，证据不能走。”",
          sharedObject: "停剑令",
        },
      },
    ],
  });

  for (const turn of scene.agentExchanges?.[0]?.dialogueTurns || []) {
    if (/写清楚再写名|名字写清楚再写名/.test(turn.line || "")) badLines.push(turn.line);
  }
}

assert.deepEqual(
  badLines,
  [],
  `institutional localization should not turn a procedure into duplicate write-name phrasing:\n${badLines.join("\n")}`,
);

console.log("dialogueNoWriteClearThenWriteName:test passed");
