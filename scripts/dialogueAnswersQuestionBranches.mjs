import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const simulationTick = {
  id: "tick_question_branch",
  periodSlot: "上午",
  locationId: "loc_xianxia_contract_gate",
  locationName: "四方法契门",
  privateSimulations: [
    {
      id: "sim_shen",
      characterId: "char_shen",
      characterName: "沈珩",
      targetCharacterId: "char_yan",
      targetCharacterName: "阎无咎",
      tone: "试探",
      privateDesire: "让阎无咎承认证据不能走",
      defensiveMask: "按城规，证据不能走。",
      shadowImpulse: "用城规把沉默逼成证词",
      publicGoal: "验契并扣住证据",
      agentProfile: {
        publicIdentity: "正道玄衡宗执律剑修",
        dramaticObjective: "让对方承认证据不能走",
        leverageObject: "灵契",
      },
    },
    {
      id: "sim_yan",
      characterId: "char_yan",
      characterName: "阎无咎",
      targetCharacterId: "char_shen",
      targetCharacterName: "沈珩",
      tone: "伪装",
      privateDesire: "带走翻案证物，不让旧案被改价",
      defensiveMask: "我押的是灵契，不是命。",
      shadowImpulse: "用价码拖住审讯",
      publicGoal: "换符并试价",
      agentProfile: {
        publicIdentity: "邪派血河楼使者",
        dramaticObjective: "带走能让血河楼翻案的证物",
        leverageObject: "毒誓符",
      },
    },
  ],
};

const sourceOutput = {
  outputId: "out_shen",
  characterId: "char_shen",
  targetCharacterId: "char_yan",
  visibleAction: "沈珩扣住阎无咎面前的灵契，按到界石前，灵痕亮了一下。沈珩说：“灵契压进铜盘里。”",
  tone: "试探",
};

const responseOutput = {
  outputId: "out_yan",
  characterId: "char_yan",
  targetCharacterId: "char_shen",
  visibleAction: "阎无咎没有接沈珩推来的灵契，把一枚符压到铜盘边。",
  tone: "伪装",
  interactionInput: {
    sourceOutputId: sourceOutput.outputId,
    sourceCharacterId: sourceOutput.characterId,
    observedVisibleAction: sourceOutput.visibleAction,
    sharedObject: "灵契",
  },
};

const scene = runSceneInteractionSimulation({
  state: { characters: [], relationships: [] },
  simulationTick,
  agentOutputs: [sourceOutput, responseOutput],
});

const exchange = scene.agentExchanges[0];
const turns = exchange?.dialogueTurns || [];
const questionTurn = turns.find((turn) => /还是/.test(turn.line || ""));
const answerTurn = turns.find((turn) => turn.respondsTo === questionTurn?.line)
  || turns[turns.findIndex((turn) => turn === questionTurn) + 1];

assert.ok(questionTurn, `exchange should generate a real branch question, got:\n${turns.map((turn) => turn.line).join("\n")}`);
assert.ok(answerTurn?.line, `question should have an answer turn, got:\n${JSON.stringify(turns, null, 2)}`);

const answer = answerTurn.line;

assert.match(answer, /我(?:先|只|不)?答|不是|不买|不拿|不把|不让/, `answer should openly answer rather than only move objects, got: ${answer}`);
assert.match(questionTurn.line, /证据[^？]*还是[^？]*命/, `fixture should ask a real evidence/life branch question, got: ${questionTurn.line}`);
assert.match(answer, /证据/, `answer should choose the evidence branch of "${questionTurn.line}", got: ${answer}`);
assert.match(answer, /命/, `answer should explicitly refuse or answer the life-price branch of "${questionTurn.line}", got: ${answer}`);
assert.match(
  exchange.eventOutcome || "",
  /命|价码|人被当成|没有被写成/,
  `event outcome should turn the life-price answer into a visible consequence, got: ${exchange.eventOutcome}`,
);

const daredQuestionCase = Array.from({ length: 40 }, (_, index) => {
  const tick = { ...simulationTick, id: `tick_question_dare_${index}` };
  const source = { ...sourceOutput, outputId: `out_shen_dare_${index}` };
  const response = {
    ...responseOutput,
    outputId: `out_yan_dare_${index}`,
    interactionInput: {
      ...responseOutput.interactionInput,
      sourceOutputId: source.outputId,
      observedVisibleAction: source.visibleAction,
    },
  };
  const trial = runSceneInteractionSimulation({
    state: { characters: [], relationships: [] },
    simulationTick: tick,
    agentOutputs: [source, response],
  });
  const trialTurns = trial.agentExchanges[0]?.dialogueTurns || [];
  const trialQuestionIndex = trialTurns.findIndex((turn) => /敢把价码和旧案分开说吗/.test(turn.line || ""));
  if (trialQuestionIndex < 0) return null;
  return {
    question: trialTurns[trialQuestionIndex],
    answer: trialTurns[trialQuestionIndex + 1],
    outcome: trial.agentExchanges[0]?.eventOutcome || "",
    turns: trialTurns,
  };
}).find(Boolean);

assert.ok(daredQuestionCase, "fixture should be able to generate a dare question about price and old case");
assert.match(
  daredQuestionCase.answer?.line || "",
  /价码/,
  `answer should respond to the price half of "${daredQuestionCase.question.line}", got: ${daredQuestionCase.answer?.line}`,
);
assert.match(
  daredQuestionCase.answer?.line || "",
  /旧案/,
  `answer should respond to the old-case half of "${daredQuestionCase.question.line}", got: ${daredQuestionCase.answer?.line}`,
);
assert.match(
  daredQuestionCase.outcome || "",
  /价码|旧案|账册|摊主/,
  `event outcome should make the price/old-case answer visible, got: ${daredQuestionCase.outcome}`,
);

const oldCasePriceQuestionCase = Array.from({ length: 80 }, (_, index) => {
  const tick = { ...simulationTick, id: `tick_question_oldcase_price_${index}` };
  const source = { ...sourceOutput, outputId: `out_shen_oldcase_price_${index}` };
  const response = {
    ...responseOutput,
    outputId: `out_yan_oldcase_price_${index}`,
    interactionInput: {
      ...responseOutput.interactionInput,
      sourceOutputId: source.outputId,
      observedVisibleAction: source.visibleAction,
    },
  };
  const trial = runSceneInteractionSimulation({
    state: { characters: [], relationships: [] },
    simulationTick: tick,
    agentOutputs: [source, response],
  });
  const trialTurns = trial.agentExchanges[0]?.dialogueTurns || [];
  const trialQuestionIndex = trialTurns.findIndex((turn) => /旧案开口的价你敢听吗/.test(turn.line || ""));
  if (trialQuestionIndex < 0) return null;
  return {
    question: trialTurns[trialQuestionIndex],
    answer: trialTurns[trialQuestionIndex + 1],
    outcome: trial.agentExchanges[0]?.eventOutcome || "",
    turns: trialTurns,
  };
}).find(Boolean);

assert.ok(oldCasePriceQuestionCase, "fixture should be able to generate an old-case price question");
assert.match(
  oldCasePriceQuestionCase.answer?.line || "",
  /旧案/,
  `answer should respond to the old-case part of "${oldCasePriceQuestionCase.question.line}", got: ${oldCasePriceQuestionCase.answer?.line}`,
);
assert.match(
  oldCasePriceQuestionCase.answer?.line || "",
  /价/,
  `answer should respond to the price part of "${oldCasePriceQuestionCase.question.line}", got: ${oldCasePriceQuestionCase.answer?.line}`,
);
assert.match(
  oldCasePriceQuestionCase.outcome || "",
  /旧案|价|账册|摊主|暗账/,
  `event outcome should make the old-case price answer visible, got: ${oldCasePriceQuestionCase.outcome}`,
);

console.log("dialogueAnswersQuestionBranches:test passed", {
  question: questionTurn.line,
  answer,
  outcome: exchange.eventOutcome,
  daredQuestion: daredQuestionCase.question.line,
  daredOutcome: daredQuestionCase.outcome,
  oldCasePriceQuestion: oldCasePriceQuestionCase.question.line,
  oldCasePriceOutcome: oldCasePriceQuestionCase.outcome,
});
