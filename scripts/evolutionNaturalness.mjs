import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

const { applySetupWorld, getState, recordObservedDraft, resetState, setUi } = await import("../src/state/store.js");
const { playNext } = await import("../src/engine/mockEngine.js");
const { buildCharacterLanguageQualityReport } = await import("../src/server/evaluation/characterLanguageQuality.mjs");

const DAYS = 7;

resetState();
applySetupWorld({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});
setUi({ timeGrain: "day", focusMode: "ambient", activeTab: "observe", engineMode: "mock" });

function stripQuotedSpeech(text = "") {
  return String(text)
    .replace(/[，,、]?\s*(?:[\u4e00-\u9fa5·]{1,12})?(?:低声|轻声|压低声音|小声|急忙|慢慢)?说[：:]?[“"「『][^”"」』]+[”"」』][。！？]?/g, "")
    .replace(/[“"「『][^”"」』]+[”"」』]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function attributionRefs(output = {}) {
  const ids = [
    output.memoryId,
    output.planId,
    output.activeRelationshipId,
    output.privateSimulationId,
    output.relationshipDialogueMemory?.sharedObject,
    output.relationshipState?.sharedObject,
    output.memoryInfluence,
    output.planInfluence,
    output.relationshipPressure,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  return [...new Set(ids)];
}

const quoteSamples = [];
const actionSamples = [];
const draftsByDay = [];

for (let day = 0; day < DAYS; day += 1) {
  const draft = playNext(getState());
  draftsByDay.push(draft);

  for (const [tickIndex, tick] of (draft.periodSimulation?.ticks || []).entries()) {
    for (const exchange of tick.sceneInteraction?.agentExchanges || []) {
      for (const [turnIndex, turn] of (exchange.dialogueTurns || []).entries()) {
        const utterance = String(turn.line || turn.text || "").trim();
        if (!utterance) continue;
        quoteSamples.push({
          sampleId: `day${day}_tick${tickIndex}_turn${turnIndex}`,
          conversationId: `day_${day}`,
          sceneIndex: day,
          turnIndex,
          characterId: turn.speakerId || "",
          utterance,
          // Deliberate recall of a remembered consequence ("我记得…") is a
          // motivated repetition, not a stock line — the diagnostic should
          // skip it instead of counting it against the repetition budget.
          repetitionMotivation: /^我记得/.test(utterance)
            ? { intentional: true, basisCode: "remembered_relationship_consequence" }
            : undefined,
        });
      }
    }
  }

  for (const [outputIndex, output] of (draft.agentOutputs || []).entries()) {
    const visibleAction = stripQuotedSpeech(output.visibleAction || "");
    if (!visibleAction) continue;
    actionSamples.push({
      sampleId: output.outputId || `day${day}_out${outputIndex}`,
      conversationId: `day_${day}`,
      sceneIndex: day,
      turnIndex: outputIndex,
      characterId: output.characterId || "",
      visibleAction,
      attribution: {
        desireIds: [output.privateDesire, output.realtimePrivateDesire].filter(Boolean),
        memoryIds: [output.memoryId, output.memoryInfluence].filter(Boolean),
        beliefIds: [output.falseBeliefs?.length ? output.outputId : ""].filter(Boolean),
        cueIds: [output.conductorSignal?.inWorldClue].filter(Boolean),
        relationshipStateIds: attributionRefs(output),
      },
    });
  }

  recordObservedDraft(draft);
}

const report = buildCharacterLanguageQualityReport({ samples: [...quoteSamples, ...actionSamples] });

const repetitionCodes = report.diagnostics
  .filter((row) => row.code === "UNMOTIVATED_NEAR_REPETITION" || row.code === "CROSS_SCENE_UNMOTIVATED_REPETITION");
const leakageCodes = report.diagnostics
  .filter((row) => row.code === "BACKEND_CLASSIFICATION_EXPOSED" || row.code === "PRIVATE_IDENTIFIER_EXPOSED");

const establishedObjects = new Set();
for (const draft of draftsByDay) {
  for (const output of draft.agentOutputs || []) {
    for (const value of [output.relationshipState?.sharedObject, output.relationshipDialogueMemory?.sharedObject]) {
      if (value) establishedObjects.add(String(value));
    }
  }
}
const relationshipOutputsAfterDay0 = actionSamples.filter((sample) => (
  sample.sceneIndex > 0
  && sample.attribution.relationshipStateIds.length > 0
));
const groundedShare = relationshipOutputsAfterDay0.filter((sample) => (
  [...establishedObjects].some((object) => sample.visibleAction.includes(object))
)).length / Math.max(1, relationshipOutputsAfterDay0.length);

const CALIBRATE = process.env.EVOLUTION_NATURALNESS_CALIBRATE === "1";
if (CALIBRATE) {
  console.log(JSON.stringify({
    quoteSamples: quoteSamples.length,
    actionSamples: actionSamples.length,
    repetition: repetitionCodes.length,
    repetitionDetails: repetitionCodes.slice(0, 4),
    leakage: leakageCodes.length,
    attribution: report.attribution,
    establishedObjects: [...establishedObjects],
    relationshipOutputsAfterDay0: relationshipOutputsAfterDay0.length,
    groundedShare,
  }, null, 2));
}

// 引擎已确定性化（种子 PRNG + 序列 id），本契约两次运行完全一致，预算可以精确：
// 当前测得 15 处无动机复读（回忆类"我记得"已按动机豁免）。这是刻意感的量化
// 债务：每消化一批就收紧一次，目标 0。任何上涨都是回归。
const REPETITION_BUDGET = 15;

assert.ok(quoteSamples.length >= 40, `seven days should expose enough attributed dialogue, got ${quoteSamples.length}`);
assert.ok(actionSamples.length >= 60, `seven days should expose enough observable actions, got ${actionSamples.length}`);
assert.equal(leakageCodes.length, 0, `quoted dialogue and actions must not leak backend identifiers:\n${JSON.stringify(leakageCodes.slice(0, 5), null, 2)}`);
assert.ok(
  repetitionCodes.length <= REPETITION_BUDGET,
  `cross-scene/day repetition must not grow past its recorded budget (${REPETITION_BUDGET}), got ${repetitionCodes.length}:\n${JSON.stringify(repetitionCodes.slice(0, 5), null, 2)}`,
);
assert.equal(report.attribution.unattributedSampleIds.length, 0, `every observable action must stay attributable to private state:\n${JSON.stringify(report.attribution, null, 2)}`);
assert.ok(
  report.attribution.coverage >= 0.95,
  `behavior attribution coverage must stay high, got ${report.attribution.coverage}`,
);
assert.ok(
  groundedShare >= 0.5,
  `later-day relationship actions should stay grounded in established shared objects, got ${groundedShare} over ${relationshipOutputsAfterDay0.length} actions`,
);

console.log("evolution-naturalness:test passed", {
  days: DAYS,
  quoteSamples: quoteSamples.length,
  actionSamples: actionSamples.length,
  attributionCoverage: report.attribution.coverage,
  groundedShare: Number(groundedShare.toFixed(3)),
  repetitionDiagnostics: repetitionCodes.length,
});
