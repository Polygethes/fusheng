import assert from "node:assert/strict";
import { createInitialEcologyState } from "../src/server/ecology/tavernEcologyState.mjs";
import { appraiseTavernAgentEcology } from "../src/server/pipeline/tavernEcologyRuntime.mjs";

const IDS = {
  xiezenshi: "char_xyy_xiezenshi",
  xieheng: "char_xyy_xieheng",
  xiemu: "char_xyy_xiemu",
  zhoumin: "char_xyy_zhoumin",
  luozhao: "char_xyy_luozhao",
};

const results = [];
const diagnostics = {};

function clone(value) {
  return structuredClone(value);
}

async function contract(name, run) {
  try {
    await run();
    results.push({ name, status: "GREEN" });
  } catch (error) {
    results.push({ name, status: "RED", message: error.message });
  }
}

function runtimeAt({ slotLabel = "正午", step = 0 } = {}) {
  return {
    elapsedSeconds: 120,
    macroDay: 1,
    macroTick: 1,
    step,
    slotContext: { slotId: "behavior-contract", slotLabel },
    actions: [],
    commitments: [],
    requestLocks: [],
  };
}

function directRequestImpact(targetCharacterId) {
  return {
    impactId: `impact:same-direct-request:${targetCharacterId}`,
    sourceCharacterId: IDS.zhoumin,
    directed: true,
    directedTargetId: targetCharacterId,
    type: "speech",
    modality: "sound",
    impactScore: 82,
    content: "谢家长辈，能否现在给我一个明确答复？",
    topic: "同一直接请求",
    provenance: { kind: "firsthand", sourceActionId: "action:same-direct-request" },
  };
}

function appraiseDirectRequest({ characterId, name, affect, relationships }) {
  const ecologyState = createInitialEcologyState(characterId, {
    locationId: "loc_xyy_tavern",
    zoneId: "堂前",
    observableAtStage: true,
    affect,
  });
  return appraiseTavernAgentEcology({
    character: { id: characterId, name, lifeState: { present: true }, ecologyState },
    runtime: runtimeAt(),
    actor: { present: true, zoneId: "hall" },
    pendingImpacts: [directRequestImpact(characterId)],
    visibleCharacterIds: [IDS.zhoumin],
    availableAffordances: [],
    recentOwnActions: [],
    relationships,
  });
}

function impactEvaluation(ecology) {
  return ecology.appraisal.candidates.find((candidate) => candidate.candidateId.includes("same-direct-request"));
}

function strategyOf(ecology) {
  const candidate = (ecology.candidates || []).find((row) => row.id.includes("same-direct-request")) || {};
  return candidate.expressionStrategy ?? candidate.copingBias ?? null;
}

await contract("same request: relationship and affect change score and coping", () => {
  const fatherThreatenedRelation = [{
    fromCharacterId: IDS.xieheng,
    toCharacterId: IDS.zhoumin,
    dependence: 12,
    resentment: 76,
    fear: 38,
    protection: 8,
    wantsToBeSeen: 18,
  }];
  const fatherSafeRelation = [{
    fromCharacterId: IDS.xieheng,
    toCharacterId: IDS.zhoumin,
    dependence: 68,
    resentment: 6,
    fear: 3,
    protection: 54,
    wantsToBeSeen: 62,
  }];
  const motherSafeRelation = [{
    fromCharacterId: IDS.xiemu,
    toCharacterId: IDS.zhoumin,
    dependence: 76,
    resentment: 4,
    fear: 2,
    protection: 71,
    wantsToBeSeen: 64,
  }];

  const fatherThreatened = appraiseDirectRequest({
    characterId: IDS.xieheng,
    name: "谢恒",
    affect: { valence: -0.72, arousal: 0.92, dominance: 0.38 },
    relationships: fatherThreatenedRelation,
  });
  const fatherSafe = appraiseDirectRequest({
    characterId: IDS.xieheng,
    name: "谢恒",
    affect: { valence: 0.18, arousal: 0.28, dominance: 0.7 },
    relationships: fatherSafeRelation,
  });
  const motherSafe = appraiseDirectRequest({
    characterId: IDS.xiemu,
    name: "谢母",
    affect: { valence: 0.24, arousal: 0.34, dominance: 0.73 },
    relationships: motherSafeRelation,
  });

  const threatenedScore = impactEvaluation(fatherThreatened)?.activationScore;
  const safeScore = impactEvaluation(fatherSafe)?.activationScore;
  const motherScore = impactEvaluation(motherSafe)?.activationScore;
  const gaps = [];
  if (!Number.isFinite(threatenedScore) || !Number.isFinite(safeScore) || Math.abs(threatenedScore - safeScore) < 3) {
    gaps.push(`same Xie Heng score ignored affect/relationship: threatened=${threatenedScore}, safe=${safeScore}`);
  }
  if (!Number.isFinite(motherScore) || Math.abs(threatenedScore - motherScore) < 2) {
    gaps.push(`Xie Heng and Xie Mu did not diverge enough on the same request: father=${threatenedScore}, mother=${motherScore}`);
  }
  const fatherStrategy = strategyOf(fatherThreatened);
  const motherStrategy = strategyOf(motherSafe);
  diagnostics.sameRequest = {
    fatherThreatenedScore: threatenedScore,
    fatherSafeScore: safeScore,
    motherSafeScore: motherScore,
    fatherThreatenedStrategy: fatherStrategy,
    fatherSafeStrategy: strategyOf(fatherSafe),
    motherSafeStrategy: motherStrategy,
  };
  if (fatherStrategy == null || motherStrategy == null) {
    gaps.push(`the relevant private candidates lack expressionStrategy/copingBias: father=${JSON.stringify(fatherStrategy)}, mother=${JSON.stringify(motherStrategy)}`);
  } else if (JSON.stringify(fatherStrategy) === JSON.stringify(motherStrategy)) {
    gaps.push(`different agents chose the same coping strategy: ${JSON.stringify(fatherStrategy)}`);
  }
  assert.deepEqual(gaps, []);
});

function appraiseLuo({ publicExposure, zoneId, slotLabel, visibleCharacterIds }) {
  const ecologyState = createInitialEcologyState(IDS.luozhao, {
    locationId: "loc_xyy_tavern",
    zoneId: zoneId === "hall" ? "堂前" : "后院",
    observableAtStage: true,
  });
  const desire = ecologyState.desires.desire_luozhao_test_own_limit_against_xiezenshi;
  desire.strength = 1;
  desire.frustration = 0.8;
  desire.urgency = 0.8;
  desire.cue = 1;
  desire.cueActivation = 1;
  ecologyState.perceivedEnvironment.atmosphere.publicScrutiny = publicExposure;

  return appraiseTavernAgentEcology({
    character: { id: IDS.luozhao, name: "洛照", lifeState: { present: true }, ecologyState },
    runtime: runtimeAt({ slotLabel }),
    actor: { present: true, zoneId },
    pendingImpacts: [],
    visibleCharacterIds,
    availableAffordances: [],
    recentOwnActions: [],
    relationships: [{
      fromCharacterId: IDS.luozhao,
      toCharacterId: IDS.xiezenshi,
      dependence: 12,
      resentment: 2,
      fear: 3,
      protection: 5,
      wantsToBeSeen: 66,
    }],
  });
}

function validatedPursuitCandidate(ecology) {
  return ecology.appraisal.candidates.find((candidate) => candidate.driveId === "desire_luozhao_test_own_limit_against_xiezenshi");
}

await contract("Luo Zhao: validated psychology stays generic while public-trouble inhibition remains Agent-owned", () => {
  const publicHall = appraiseLuo({
    publicExposure: 0.92,
    zoneId: "hall",
    slotLabel: "正午",
    visibleCharacterIds: [IDS.xiezenshi, IDS.xiemu, IDS.xieheng, IDS.zhoumin],
  });
  const privateCourtyard = appraiseLuo({
    publicExposure: 0,
    zoneId: "courtyard",
    slotLabel: "夜深",
    visibleCharacterIds: [IDS.xiezenshi],
  });
  const publicPursuit = validatedPursuitCandidate(publicHall);
  const privatePursuit = validatedPursuitCandidate(privateCourtyard);
  diagnostics.luozhao = {
    publicCandidateId: publicPursuit?.candidateId,
    privateCandidateId: privatePursuit?.candidateId,
    publicActivation: publicPursuit?.activationScore,
    privateActivation: privatePursuit?.activationScore,
    desirePressure: publicPursuit?.desirePressure?.score,
  };
  assert.equal(publicPursuit?.actionKind, "pursue_desired_state");
  assert.equal(privatePursuit?.actionKind, "pursue_desired_state");
  assert.equal(publicPursuit?.desirePressure.score, privatePursuit?.desirePressure.score,
    "public exposure must not rewrite Luo Zhao's underlying desire pressure");
  assert.equal(
    publicHall.candidates.filter((candidate) => candidate.driveId === "desire_luozhao_test_own_limit_against_xiezenshi").length,
    1,
    "the deterministic layer must not revive a Luo-specific invite/observe action menu",
  );
  assert.ok(publicHall.profile.psychologyAnchor.inhibitors.some((row) => row.id === "inhibitor_luozhao_irrelevant_public_trouble"));
});

async function relationshipDynamics() {
  try {
    return await import("../src/server/ecology/tavernRelationshipDynamics.mjs");
  } catch (error) {
    throw new Error(`relationship evidence bridge is missing: ${error.code || error.message}`);
  }
}

function protectionFixture() {
  const action = {
    id: "action:zhoumin-protects-xiezenshi",
    actorId: IDS.zhoumin,
    targetCharacterId: IDS.xiezenshi,
    actionType: "interact",
    actionKind: "protect",
    speech: "",
    visibleAction: "周珉侧身挡到谢真石身前，用袖口隔开倾倒的热汤",
    committed: true,
  };
  const outcome = {
    id: "outcome:zhoumin-protects-xiezenshi",
    status: "committed",
    applied: true,
    sourceActionId: action.id,
    receivedByCharacterIds: [IDS.xiezenshi],
    relationshipEvidence: [{
      id: "evidence:nonverbal-protection",
      verified: true,
      authority: "recipient-character-agent",
      type: "nonverbal_protection",
      sourceActionId: action.id,
      actorCharacterId: IDS.zhoumin,
      targetCharacterId: IDS.xiezenshi,
      observerCharacterId: IDS.xiezenshi,
      witnessedByCharacterIds: [IDS.xiezenshi],
      deltas: { protection: 4, dependence: 2 },
    }],
  };
  return { action, outcome };
}

await contract("nonverbal protection creates recipient-to-protector directional evidence", async () => {
  const dynamics = await relationshipDynamics();
  assert.equal(typeof dynamics.deriveRelationshipDeltas, "function", "deriveRelationshipDeltas export is required");
  const derived = dynamics.deriveRelationshipDeltas(protectionFixture());
  const shifts = Array.isArray(derived) ? derived : derived?.shifts || [];
  const recipientToProtector = shifts.find((shift) => (
    shift.fromCharacterId === IDS.xiezenshi && shift.toCharacterId === IDS.zhoumin
  ));
  const mirrored = shifts.find((shift) => (
    shift.fromCharacterId === IDS.zhoumin && shift.toCharacterId === IDS.xiezenshi
  ));
  assert.ok(recipientToProtector, `verified nonverbal protection needs Xie Zhenshi -> Zhou Min evidence, got ${JSON.stringify(shifts)}`);
  assert.ok(Object.values(recipientToProtector.deltas || {}).some((value) => Number(value) !== 0), "directional evidence needs at least one non-zero relation delta");
  assert.equal(mirrored, undefined, "one received impact must not fabricate the reverse relationship appraisal");
  assert.equal(recipientToProtector.sourceActionId || recipientToProtector.provenance?.sourceActionId, "action:zhoumin-protects-xiezenshi");
});

await contract("reverse relationship remains independent when one direction updates", async () => {
  const dynamics = await relationshipDynamics();
  assert.equal(typeof dynamics.getDirectedRelationship, "function", "getDirectedRelationship export is required");
  assert.equal(typeof dynamics.applyDirectionalRelationshipDelta, "function", "applyDirectionalRelationshipDelta export is required");
  const forward = {
    id: "rel:xiezenshi-to-zhoumin",
    fromCharacterId: IDS.xiezenshi,
    toCharacterId: IDS.zhoumin,
    dependence: 24,
    resentment: 9,
    fear: 5,
    protection: 12,
    wantsToBeSeen: 31,
  };
  const reverse = {
    id: "rel:zhoumin-to-xiezenshi",
    fromCharacterId: IDS.zhoumin,
    toCharacterId: IDS.xiezenshi,
    dependence: 62,
    resentment: 18,
    fear: 7,
    protection: 79,
    wantsToBeSeen: 73,
  };
  const relationships = [clone(forward), clone(reverse)];
  const reverseBefore = clone(reverse);
  assert.equal(dynamics.getDirectedRelationship(relationships, IDS.xiezenshi, IDS.zhoumin)?.id, forward.id);
  assert.equal(dynamics.getDirectedRelationship(relationships, IDS.zhoumin, IDS.xiezenshi)?.id, reverse.id);

  const derived = dynamics.deriveRelationshipDeltas(protectionFixture());
  const shifts = Array.isArray(derived) ? derived : derived?.shifts || [];
  const shift = shifts.find((entry) => entry.fromCharacterId === IDS.xiezenshi && entry.toCharacterId === IDS.zhoumin);
  assert.ok(shift, "the protection fixture must first produce its directed delta");
  const nextRelationships = relationships.map((relationship) => (
    relationship.fromCharacterId === shift.fromCharacterId && relationship.toCharacterId === shift.toCharacterId
      ? dynamics.applyDirectionalRelationshipDelta(relationship, shift.deltas || shift)
      : relationship
  ));
  const nextForward = dynamics.getDirectedRelationship(nextRelationships, IDS.xiezenshi, IDS.zhoumin);
  const nextReverse = dynamics.getDirectedRelationship(nextRelationships, IDS.zhoumin, IDS.xiezenshi);
  assert.notDeepEqual(nextForward, forward, "the evidenced direction must change");
  assert.deepEqual(nextReverse, reverseBefore, "the reverse direction must remain byte-for-byte independent");
});

const red = results.filter((result) => result.status === "RED");
for (const result of results) {
  console.log(`${result.status} ${result.name}${result.message ? `\n  ${result.message}` : ""}`);
}
console.log("tavernEcologyBehaviorContracts", {
  contracts: results.length,
  green: results.length - red.length,
  red: red.length,
  diagnostics,
});
if (process.argv.includes("--diagnostics")) console.log(JSON.stringify(diagnostics, null, 2));

if (red.length && !process.argv.includes("--report")) {
  throw new AggregateError(red.map((result) => new Error(`${result.name}: ${result.message}`)), `${red.length} ecology behavior contracts are still RED`);
}
