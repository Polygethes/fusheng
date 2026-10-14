import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const source = {
  characterId: "char_azhao",
  characterName: "阿照",
  targetCharacterId: "char_aoji",
  targetCharacterName: "敖霁",
  tone: "伪装",
  agentProfile: {
    publicIdentity: "镜塔档案库的照骨镜器灵",
    dramaticObjective: "找到自己的原主姓名",
  },
};

const target = {
  characterId: "char_aoji",
  characterName: "敖霁",
  targetCharacterId: "char_azhao",
  targetCharacterName: "阿照",
  tone: "保护",
  agentProfile: {
    publicIdentity: "龙裔水府少主",
    dramaticObjective: "保住龙裔对渡口的控制",
  },
};

const leaked = [];

for (let index = 0; index < 12; index += 1) {
  const scene = runSceneInteractionSimulation({
    state: { characters: [] },
    simulationTick: {
      id: `tick_market_aoji_${index}`,
      periodSlot: "傍晚",
      locationId: "loc_market",
      locationName: "无咎市",
      visiblePressure: "摊主停住笔，妖丹盒压在案台。",
      privateSimulations: [source, target],
    },
    agentOutputs: [
      {
        outputId: `out_azhao_${index}`,
        characterId: "char_azhao",
        targetCharacterId: "char_aoji",
        visibleAction: "阿照把妖丹盒推到案台边，让铜夹停在账页上。",
      },
      {
        outputId: `out_aoji_${index}`,
        characterId: "char_aoji",
        targetCharacterId: "char_azhao",
        visibleAction: "敖霁把庇护牌压到妖丹盒旁，没有让阿照收走账页。",
        interactionInput: {
          sourceCharacterId: "char_azhao",
          sourceOutputId: `out_azhao_${index}`,
          observedVisibleAction: "阿照把妖丹盒推到案台边，让铜夹停在账页上。",
          sharedObject: "妖丹盒",
        },
      },
    ],
  });
  for (const turn of scene.agentExchanges?.[0]?.dialogueTurns || []) {
    if (turn.speakerName !== "敖霁") continue;
    if (/(?:妖丹盒|庇护牌|账页|铜夹)[^。！？]*(?:水线|水阵|渡口|不离岸|过岸|水路|潮痕|岸上|岸边)/.test(turn.line || "")) {
      leaked.push({ index, line: turn.line });
    }
  }
}

assert.deepEqual(
  leaked,
  [],
  `offsite character voice should keep current market objects on the market surface instead of moving them to ferry language:\n${JSON.stringify(leaked, null, 2)}`,
);

console.log("dialogueVoiceSurfaceLocalizesCurrentDistrict:test passed");
