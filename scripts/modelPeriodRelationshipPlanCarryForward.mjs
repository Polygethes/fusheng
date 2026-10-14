import assert from "node:assert/strict";
import { playModelPeriodWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";
import { normalizePrivateSimulation } from "../src/server/pipeline/privateSimulator.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.engineMode = "openai";
state.ui.activeCharacterIds = ["char_xianxia_shenheng", "char_xianxia_yanwujie"];
state.ui.selectedLocationId = "loc_xianxia_contract_gate";
state.characterPlans = [];

const compactSnapshots = [];
const privateSimulationSnapshots = [];
let sceneCallCount = 0;

const runners = {
  async runPrivateSimulators(compact) {
    compactSnapshots.push(compact);
    const shen = compact.activeCharacters.find((character) => character.id === "char_xianxia_shenheng");
    const yan = compact.activeCharacters.find((character) => character.id === "char_xianxia_yanwujie");
    const privateSimulations = [
      normalizePrivateSimulation({}, compact, shen, yan.id),
      normalizePrivateSimulation({}, compact, yan, shen.id),
    ];
    privateSimulationSnapshots.push(privateSimulations);
    return {
      privateSimulations,
      agentOutputs: [],
      stages: [{ name: `FakePrivate:${compactSnapshots.length}`, provider: "test" }],
    };
  },
  async runVisibilityLayer(_compact, privateSimulations) {
    return {
      visibilityLayer: {
        visibleFacts: ["四方法契门前，铜盘和界石都在。"],
        hiddenFacts: ["盖印人还没有进门。"],
        perCharacter: privateSimulations.map((sim) => ({
          characterId: sim.characterId,
          characterName: sim.characterName,
          targetCharacterId: sim.targetCharacterId,
          targetCharacterName: sim.targetCharacterName,
          knownFacts: ["灵契还在铜盘里。"],
          falseBeliefs: [],
          withheldFacts: [],
          blindSpots: [],
          suspectedSecrets: [],
          possibleVisibilityFlips: [],
        })),
      },
      stage: { name: "FakeVisibility", provider: "test" },
    };
  },
  async runSceneInteractionSimulator(_compact, privateSimulations) {
    sceneCallCount += 1;
    const shen = privateSimulations.find((sim) => sim.characterId === "char_xianxia_shenheng");
    const yan = privateSimulations.find((sim) => sim.characterId === "char_xianxia_yanwujie");
    const firstTick = sceneCallCount === 1;
    const eventOutcome = firstTick
      ? "阎无咎没有接走灵契，把灵契留给界石；盖印的人停在铜盘外，名字没有写进盘边。"
      : "阎无咎按上一段计划把灵契留给界石，盖印的人仍停在铜盘外。";
    const relationshipDeltas = [
      {
        generatedFrom: "model-agent-dialogue",
        relationshipSource: "agent-exchange",
        fromCharacterId: yan.characterId,
        toCharacterId: shen.characterId,
        deltas: firstTick ? { power: 3, deception: 2, wantsToEscape: 1 } : { power: 1, deception: 1 },
        sharedObject: "灵契",
        eventOutcome,
        finalTurn: firstTick ? "名字先不写，盖印的人也先别进来。" : "城规先照灵契，解释权不能由你替我写。",
        followupTurn: firstTick ? "" : "城规先照灵契，解释权不能由你替我写。",
        dialogueTurnCount: firstTick ? 3 : 4,
        misreading: "阎无咎把沈珩逼到铜盘前的开口听成必须借城规夺回解释权。",
        unspoken: firstTick ? "名字先不写。" : "解释权不能由你替我写。",
      },
    ];
    return {
      sceneInteraction: {
        surfaceEvent: `四方法契门第${sceneCallCount}次围绕灵契停住`,
        sceneText: `${yan.characterName}说：“${relationshipDeltas[0].finalTurn}”`,
        sceneThesis: "计划应该被下一段读取。",
        interactionBeats: [],
        agentExchanges: [{
          sourceCharacterId: shen.characterId,
          responseCharacterId: yan.characterId,
          sourceCharacterName: shen.characterName,
          responseCharacterName: yan.characterName,
          sharedObject: "灵契",
          dialogueTurns: [
            { speakerId: shen.characterId, speakerName: shen.characterName, targetId: yan.characterId, targetName: yan.characterName, line: "那你要谁替你盖印？", turnRole: "claim" },
            { speakerId: yan.characterId, speakerName: yan.characterName, targetId: shen.characterId, targetName: shen.characterName, line: relationshipDeltas[0].finalTurn, turnRole: "response" },
            { speakerId: shen.characterId, speakerName: shen.characterName, targetId: yan.characterId, targetName: yan.characterName, line: "界石可以等，名字不能替你写。", turnRole: "counter" },
          ],
          eventOutcome,
          relationshipDeltas,
          generatedFrom: "model-agent-dialogue",
        }],
        misunderstandings: [],
        reversals: [],
        visibilityFlips: [],
        relationshipMutationIntents: [],
        evidenceCreated: [],
        rumorCreated: [],
        memoryDistortions: [],
        irreversibleTraces: [eventOutcome],
        subtextMatrix: [],
        relationshipShift: relationshipDeltas,
        directorNotes: "",
        simulationNotes: [],
      },
      stage: { name: `FakeScene:${sceneCallCount}`, provider: "test" },
    };
  },
  async runDepthAuditor(_compact, _draft, localAudit) {
    return {
      audit: {
        ...localAudit,
        shouldRegenerate: false,
        safeClosureRisk: 0,
        whitePaperCharacterRisk: 0,
        multiMotivationScore: 100,
        irreversibleConsequenceScore: 100,
        memoryUseRisk: 0,
        ignoredMemoryRisk: 0,
        memoryChangedActionScore: 100,
        singleMemoryRisk: 0,
        planRisk: 0,
        planUseScore: 100,
        realtimeSimulationRisk: 0,
        realtimeSimulationScore: 100,
        privateIntentCoverage: 100,
        unscriptedCollisionScore: 100,
        requiredFixes: [],
      },
      stage: { name: "FakeAudit", provider: "test" },
    };
  },
  async runRepairPass() {
    throw new Error("repair should not run in this test");
  },
};

const draft = await playModelPeriodWithRunners(state, { runners });

assert.ok(compactSnapshots.length >= 2, "period playback should run at least two ticks");

const secondCompactYan = compactSnapshots[1].activeCharacters.find((character) => character.id === "char_xianxia_yanwujie");
assert.ok(secondCompactYan?.plan, "second tick compact state should carry Yan's rewritten plan");
assert.equal(secondCompactYan.plan.currentTactic, "control", `Yan's carried plan should be control, got ${secondCompactYan.plan.currentTactic}`);
assert.match(
  `${secondCompactYan.plan.shortTerm} ${secondCompactYan.plan.immediateObjective}`,
  /解释权|界石|盖印|灵契|名字/,
  "carried control plan should preserve the concrete rule/object from the prior relationship shift",
);

const secondTickYanSim = privateSimulationSnapshots[1].find((sim) => sim.characterId === "char_xianxia_yanwujie");
assert.equal(secondTickYanSim.tone, "伪装", `second tick private simulation should be biased by carried control plan, got ${secondTickYanSim.tone}`);
assert.match(
  `${secondTickYanSim.planLine} ${secondTickYanSim.actionCandidate}`,
  /解释权|界石|盖印|灵契|名字/,
  "second tick private simulation should turn the carried control plan into action material",
);

assert.ok(
  draft.periodSimulation.ticks.slice(1).some((tick) =>
    (tick.privateSimulations || []).some((sim) =>
      sim.characterId === "char_xianxia_yanwujie" && /解释权|界石|盖印|灵契|名字/.test(`${sim.planLine} ${sim.actionCandidate}`)
    )
  ),
  "later period ticks should expose the carried plan through their private simulations",
);

console.log("modelPeriodRelationshipPlanCarryForward:test passed", {
  carriedTactic: secondCompactYan.plan.currentTactic,
  secondTickTone: secondTickYanSim.tone,
  secondTickAction: secondTickYanSim.actionCandidate,
});
