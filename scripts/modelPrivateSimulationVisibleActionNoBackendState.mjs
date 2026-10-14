import assert from "node:assert/strict";
import { privateSimulationToAgentOutput } from "../src/server/pipeline/privateSimulator.mjs";

const sim = {
  characterId: "char_lu",
  characterName: "鹿青萝",
  targetCharacterId: "char_shen",
  targetCharacterName: "沈珩",
  tone: "保护",
  publicGoal: "守住医坊的庇护权。",
  privateDesire: "不让沈珩把伤者当证据拖走。",
  defensiveMask: "进了医坊，先救命，后审案。",
  shadowImpulse: "用庇护牌迫使沈珩承认边界。",
  nobleImpulse: "替伤者挡住粗暴结论。",
  selfLie: "我只是按医坊规矩行事。",
  relationshipState: {
    kind: "protect",
    label: "鹿青萝和沈珩之间形成保护债",
    sharedObject: "庇护牌",
    finalTurn: "你可以等封条，伤者不能等",
    reason: "鹿青萝把庇护牌重新命名为救命和保护的边界",
    currentConstraint: "下一步不能只处理庇护牌，必须先回应人是否会被带走。",
    nextActionBias: "先护住人，再处理证物、规矩或价码。",
  },
  actionCandidate: "鹿青萝会先护住庇护牌，再让这种保护成为关系债。 关系状态：鹿青萝和沈珩之间形成保护债；下一步不能只处理庇护牌，必须先回应人是否会被带走。",
  whatTheyWantFromOthers: "让沈珩停手并追问。",
  whatTheyRefuseToAdmit: "关系状态：鹿青萝害怕自己又把一个小妖交出去。",
  riskTheyWillCreate: "沈珩会把保护读成妨碍审讯。",
  memoryTension: "关系状态：保护债压着庇护牌。",
  contradictionScore: 72,
  pressure: 70,
};

const output = privateSimulationToAgentOutput(sim);

assert.match(output.memoryInfluence, /关系状态|保护债|庇护牌/, "backend relationship state should remain available as memory/pressure context");
assert.match(output.visibleAction, /鹿青萝|庇护牌|沈珩|伤者|药炉|医坊/, `visible action should still be concrete, got:\n${output.visibleAction}`);
assert.doesNotMatch(
  output.visibleAction,
  /关系状态|下一步|后台|private|simulation|actionCandidate|不能只处理|currentConstraint/,
  `visible action must not expose backend relationship-state language:\n${output.visibleAction}`,
);

console.log("modelPrivateSimulationVisibleActionNoBackendState:test passed", {
  visibleAction: output.visibleAction,
  memoryInfluence: output.memoryInfluence,
});
