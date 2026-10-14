import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const repeated = [];

for (let index = 0; index < 80; index += 1) {
  const scene = runSceneInteractionSimulation({
    state: { characters: [] },
    simulationTick: {
      id: `tick_teahouse_repeated_object_clause_${index}`,
      locationId: "loc_xianxia_teahouse",
      locationName: "停剑茶楼",
      visiblePressure: "停剑令压在茶盏旁，谈判桌边的人都看着谁先伸手。",
      privateSimulations: [
        {
          characterId: "char_xianxia_shenheng",
          characterName: "沈珩",
          privateDesire: "让闻夏承认停剑令不能被带离桌面。",
          defensiveMask: "让照骨司先验。",
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
          defensiveMask: "停剑令还在，谁先拔剑谁先破禁。",
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
        outputId: `out_repeated_clause_shen_${index}`,
        characterId: "char_xianxia_shenheng",
        targetCharacterId: "char_xianxia_wenxia",
        characterName: "沈珩",
        visibleAction: "沈珩扣住闻夏面前的停剑令，推到明处。沈珩说：“让照骨司先验。”",
      },
      {
        outputId: `out_repeated_clause_wenxia_${index}`,
        characterId: "char_xianxia_wenxia",
        targetCharacterId: "char_xianxia_shenheng",
        characterName: "闻夏",
        visibleAction: "闻夏把沈珩递来的停剑令拨回两人中间，没有让它换手。闻夏说：“停剑令还在，谁先拔剑谁先破禁。”",
        interactionInput: {
          sourceCharacterId: "char_xianxia_shenheng",
          sourceOutputId: `out_repeated_clause_shen_${index}`,
          observedVisibleAction: "沈珩扣住闻夏面前的停剑令，推到明处。沈珩说：“让照骨司先验。”",
          sharedObject: "停剑令",
        },
      },
    ],
  });

  for (const turn of scene.agentExchanges?.[0]?.dialogueTurns || []) {
    const line = turn.line || "";
    if (startsMultipleClausesWithSameObject(line)) repeated.push(line);
  }
}

assert.deepEqual(
  repeated,
  [],
  `a single spoken turn should not restart multiple clauses with the same object:\n${repeated.join("\n")}`,
);

console.log("dialogueNoRepeatedObjectAcrossClauses:test passed");

function startsMultipleClausesWithSameObject(line = "") {
  const objects = ["灵契", "停剑令", "妖丹盒", "照骨镜", "渡令", "庇护牌", "魂灯"];
  const clauses = String(line || "")
    .split(/[；。！？]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return objects.some((object) => clauses.filter((clause) => clause.startsWith(object)).length > 1);
}
