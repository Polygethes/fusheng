import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const source = {
  characterId: "char_shen",
  characterName: "沈珩",
  targetCharacterId: "char_yan",
  targetCharacterName: "阎无咎",
  tone: "惩罚",
  defensiveMask: "按城法扣契，不按宗门私仇。",
  agentProfile: {
    publicIdentity: "正道玄衡宗执律剑修",
    dramaticObjective: "让停剑城承认正道审判仍有资格扣押邪派证人。",
    leverageObject: "灵契",
    dialogueMoves: ["按城法扣契，不按宗门私仇。", "剑可以停，证据不能走。"],
  },
};

const yan = {
  characterId: "char_yan",
  characterName: "阎无咎",
  targetCharacterId: "char_shen",
  targetCharacterName: "沈珩",
  tone: "伪装",
  defensiveMask: "我押的是灵契，不是命。",
  agentProfile: {
    publicIdentity: "邪派血河楼使者",
    dramaticObjective: "在不破城规的情况下带走能让血河楼翻案的证物。",
    leverageObject: "魔印",
    dialogueMoves: ["我押的是灵契，不是命。", "价码到了，旧案自然开口。"],
  },
};

const lu = {
  characterId: "char_lu",
  characterName: "鹿青萝",
  targetCharacterId: "char_shen",
  targetCharacterName: "沈珩",
  tone: "保护",
  defensiveMask: "进了医坊，先救命，后审案。",
  agentProfile: {
    publicIdentity: "妖族鹿妖医",
    dramaticObjective: "守住医坊的庇护权，不让任何一派把病人当证据拖走。",
    leverageObject: "庇护牌",
    dialogueMoves: ["进了医坊，先救命，后审案。", "药炉前不问正邪。"],
  },
};

const sourceOutput = {
  outputId: "out_shen",
  characterId: source.characterId,
  characterName: source.characterName,
  visibleAction: "沈珩扣住阎无咎面前的灵契，另一只手拦住守门人的印。",
};

const scene = runSceneInteractionSimulation({
  state: { characters: [] },
  simulationTick: {
    id: "tick_same_scene_source_claim_targets_differ",
    locationId: "loc_gate",
    locationName: "四方法契门",
    visiblePressure: "界石照着灵契，守门人的印停在铜盘外。",
    privateSimulations: [source, yan, lu],
  },
  agentOutputs: [
    sourceOutput,
    {
      outputId: "out_yan",
      characterId: yan.characterId,
      characterName: yan.characterName,
      visibleAction: "阎无咎挡住沈珩伸向灵契的手，把灵契往外推到铜盘边外沿。",
      interactionInput: {
        sourceCharacterId: source.characterId,
        sourceOutputId: sourceOutput.outputId,
        observedVisibleAction: sourceOutput.visibleAction,
        sharedObject: "灵契",
      },
    },
    {
      outputId: "out_lu",
      characterId: lu.characterId,
      characterName: lu.characterName,
      visibleAction: "鹿青萝把话吞回去，指尖却把庇护牌压住。",
      interactionInput: {
        sourceCharacterId: source.characterId,
        sourceOutputId: sourceOutput.outputId,
        observedVisibleAction: sourceOutput.visibleAction,
        sharedObject: "灵契",
      },
    },
  ],
});

const claims = (scene.agentExchanges || [])
  .map((exchange) => (exchange.dialogueTurns || [])[0])
  .filter((turn) => turn?.speakerId === source.characterId);

assert.equal(claims.length, 2, "test setup should produce two source claims in the same scene");
assert.equal(
  new Set(claims.map((turn) => turn.line)).size,
  claims.length,
  `same speaker should not reuse the exact same claim for different targets:\n${claims.map((turn) => `${turn.targetName}: ${turn.line}`).join("\n")}`,
);

const luClaim = claims.find((turn) => turn.targetId === lu.characterId)?.line || "";
assert.match(
  luClaim,
  /庇护牌|伤者|救命|人名|鹿青萝/,
  `claim redirected to 鹿青萝 should acknowledge her stake instead of repeating only the first target's contract line: ${luClaim}`,
);

const counters = (scene.agentExchanges || [])
  .flatMap((exchange) => exchange.dialogueTurns || [])
  .filter((turn) => turn?.speakerId === source.characterId && turn?.turnRole === "counter");

assert.equal(counters.length, 2, "test setup should produce two source counters in the same scene");
assert.equal(
  new Set(counters.map((turn) => turn.line)).size,
  counters.length,
  `same speaker should not reuse the exact same counter for different targets:\n${counters.map((turn) => `${turn.targetName}: ${turn.line}`).join("\n")}`,
);

const luCounter = counters.find((turn) => turn.targetId === lu.characterId)?.line || "";
assert.match(
  luCounter,
  /庇护牌|伤者|救命|人名|鹿青萝/,
  `counter redirected to 鹿青萝 should answer her stake instead of repeating only contract procedure: ${luCounter}`,
);

console.log("sameSceneSourceClaimTargetsDiffer:test passed", {
  claims: claims.map((turn) => `${turn.targetName}: ${turn.line}`),
  counters: counters.map((turn) => `${turn.targetName}: ${turn.line}`),
});
