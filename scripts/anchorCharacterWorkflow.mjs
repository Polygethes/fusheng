import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const skillRoot = path.join(projectRoot, ".agents", "skills", "anchor-character-agent");
const initScript = path.join(skillRoot, "scripts", "init_anchor_workspace.mjs");
const checkScript = path.join(skillRoot, "scripts", "check_anchor_workspace.mjs");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gtown-anchor-workflow-"));

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

function parseOutput(result) {
  assert.ok(result.stdout.trim(), "expected a JSON result on stdout");
  return JSON.parse(result.stdout);
}

async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

async function writeJson(target, value) {
  await writeFile(target, JSON.stringify(value, null, 2) + "\n", "utf8");
}

const sceneId = "scene_river_ferry";
const characterId = "char_gu_lin";
const sceneDir = path.join(tempRoot, sceneId);
const characterDir = path.join(sceneDir, "characters", characterId);
const commonArgs = ["--root", tempRoot, "--scene", sceneId, "--character", characterId];
const report = {
  fixture: "synthetic-portability-contract",
  sceneId,
  characterId,
  checks: [],
};

try {
  const initialized = run(initScript, [
    "--root", tempRoot,
    "--scene", sceneId,
    "--scene-name", "鹭水渡口",
    "--character", characterId,
    "--name", "顾临",
  ]);
  assert.equal(initialized.status, 0, initialized.stderr);
  const initializedPacket = parseOutput(initialized);
  assert.equal(initializedPacket.createdSceneContract, true);
  assert.equal(initializedPacket.artifacts.characterFoundation, "character-foundation.json");
  assert.equal(initializedPacket.artifacts.calibrationEvidence, "calibration-evidence.json");
  const freshAuthoringIndex = await readJson(path.join(characterDir, initializedPacket.artifacts.anchorPayload));
  const freshFoundation = await readJson(path.join(characterDir, initializedPacket.artifacts.characterFoundation));
  const freshCalibration = await readJson(path.join(characterDir, initializedPacket.artifacts.calibrationEvidence));
  assert.equal(freshAuthoringIndex.recordType, "character-authoring-index");
  assert.equal(freshFoundation.runtimeSurface, "character-foundation");
  assert.equal(freshCalibration.recordType, "character-calibration-suite");
  for (const forbiddenKey of ["evidence", "validation", "actionPolicy"]) {
    assert.equal(Object.hasOwn(freshFoundation, forbiddenKey), false, `${forbiddenKey} must not be initialized in the runtime foundation`);
  }
  assert.equal(Object.hasOwn(freshFoundation.dynamicPsychology, "updateRules"), false);
  assert.equal(Object.hasOwn(freshFoundation.speechPolicy, "evidenceAnchors"), false);
  report.checks.push("first character creates one shared scene contract and three separated character layers");

  const draft = run(checkScript, [...commonArgs, "--gate", "draft"]);
  assert.equal(draft.status, 0, draft.stderr);
  assert.equal(parseOutput(draft).valid, true);
  report.checks.push("fresh packet passes only the draft structural gate");

  const premature = run(checkScript, [...commonArgs, "--gate", "calibrated"]);
  assert.notEqual(premature.status, 0, "an incomplete packet must not pass calibration");
  const prematureCodes = new Set(parseOutput(premature).errors.map((row) => row.code));
  for (const expected of [
    "SCENE_NOT_CONFIRMED",
    "FACTS_NOT_CONFIRMED",
    "DESIRE_MISSING",
    "SPEECH_ANCHORS_INSUFFICIENT",
    "MEMORY_BOUNDARY_UNSTATED",
  ]) {
    assert.ok(prematureCodes.has(expected), "missing expected gate error: " + expected);
  }
  report.checks.push("stage gates reject an unconfirmed scene and decorative empty psychology");

  const scene = await readJson(path.join(sceneDir, "scene-contract.json"));
  scene.status = "validated";
  scene.identity.timeScope = "第一日清晨至渡口收船前";
  scene.ownership = {
    ownerCharacterId: "",
    operatorCharacterIds: ["char_ferry_keeper"],
    institutionId: "institution_lushui_ferry",
  };
  scene.topology = {
    zones: [
      { id: "dock", label: "船埠", privacy: "public", capacity: 20, observableFromZoneIds: ["dock", "toll_booth"] },
      { id: "toll_booth", label: "渡钱亭", privacy: "public", capacity: 5, observableFromZoneIds: ["dock", "toll_booth"] },
      { id: "records_room", label: "档房", privacy: "private", capacity: 2, observableFromZoneIds: ["records_room"] },
    ],
    routes: [
      { fromZoneId: "dock", toZoneId: "toll_booth", modality: "walk", requirements: [], barriers: [] },
      { fromZoneId: "toll_booth", toZoneId: "records_room", modality: "walk", requirements: ["operator_permission"], barriers: ["locked_door"] },
    ],
    privateZoneIds: ["records_room"],
  };
  scene.resources = [
    { id: "ferry_boat", label: "渡船", quantity: 1, holderId: "institution_lushui_ferry", zoneId: "dock", valueTags: ["transport"], consumable: false },
    { id: "crossing_register", label: "渡运簿", quantity: 1, holderId: "char_ferry_keeper", zoneId: "records_room", valueTags: ["evidence", "family_business"], consumable: false },
  ];
  scene.affordances = [
    { id: "buy_passage", actorRequirements: ["can_pay"], targetRequirements: ["ferry_operating"], zoneRequirements: ["toll_booth"], consumes: ["fare"], produces: ["passage_right"] },
    { id: "ask_about_register", actorRequirements: ["can_speak"], targetRequirements: ["operator_present"], zoneRequirements: ["toll_booth"], consumes: [], produces: ["operator_response"] },
  ];
  scene.impossibilities = [
    { id: "river_flood", claim: "河水在无征兆时突然漫过渡口", reason: "缺少上游来水", enablingConditions: ["sustained_upstream_rain", "rising_water"] },
    { id: "read_private_register", claim: "访客隔着锁门阅读档房原簿", reason: "缺少物理和权限通路", enablingConditions: ["records_room_access"] },
  ];
  scene.roles = [
    { id: "ferry_keeper", label: "守渡人", holderCharacterIds: ["char_ferry_keeper"], responsibilities: ["sell_passage", "control_records_room_access"], permissions: ["open_records_room"] },
  ];
  scene.informationRoutes = [
    { id: "dock_direct_sight", sourceZoneId: "dock", recipientZoneIds: ["dock", "toll_booth"], modalities: ["sight", "voice"], barriers: ["crowd_noise"], distortionRiskRange: [0, 0.1], supportsGossip: false },
    { id: "toll_booth_rumor", sourceZoneId: "toll_booth", recipientZoneIds: ["dock"], modalities: ["reported_speech"], barriers: ["distance", "noise"], distortionRiskRange: [0.2, 0.7], supportsGossip: true },
  ];
  scene.validation.counterexamples = [
    { id: "no_rain_no_flood", attemptedEvent: "无上游雨情时河水暴涨", expectedResult: "rejected_missing_enabler", passed: true },
    { id: "private_records_not_visible", attemptedEvent: "船埠访客直接看见锁闭档房的簿文", expectedResult: "perception_blocked", passed: true },
    { id: "payment_does_not_force_exit", attemptedEvent: "顾临付完渡钱后仍要查簿", expectedResult: "personal_goal_remains_open", passed: true },
    { id: "schedule_does_not_summon", attemptedEvent: "正午标签自动生成访客", expectedResult: "rejected_missing_character_cause", passed: true },
    { id: "resource_requires_personal_relevance", attemptedEvent: "与渡运簿无关者被强制吸引", expectedResult: "no_salience_without_desire_relevance", passed: true },
  ];
  await writeJson(path.join(sceneDir, "scene-contract.json"), scene);

  const manifestPath = path.join(characterDir, "manifest.json");
  const manifest = await readJson(manifestPath);
  manifest.gates = {
    sceneContract: "validated",
    factConfirmation: "confirmed",
    calibration: "calibrated",
    holdouts: "passed",
    runtimeMapping: "mapped",
    behaviorAcceptance: "passed",
  };
  await writeJson(manifestPath, manifest);

  const anchorPath = path.join(characterDir, "anchor-payload.json");
  const anchor = await readJson(anchorPath);
  anchor.status = "validated";
  anchor.evidence.confirmed = [
    {
      id: "fact.gu_lin.owned_goal",
      claim: "顾临想亲手找回被调包的家族渡运簿，以证明自己有能力接手家业。",
      source: "synthetic portability fixture",
    },
  ];
  await writeJson(anchorPath, anchor);

  const foundationPath = path.join(characterDir, "character-foundation.json");
  const foundation = await readJson(foundationPath);
  foundation.status = "validated";
  foundation.numericCalibrationStatus = "range-calibrated";
  foundation.identityModel.openChoiceAxes = [{
    id: "choice.gu_lin.independence_vs_family_help",
    valuesInConflict: ["独立查清", "接受家族帮助"],
    contexts: ["直接证据即将消失"],
    resolution: "story-open",
  }];
  foundation.stablePsychology.corePursuits = [
    { id: "recover_family_register", desiredSelfState: "能独立追回家业证据的人", weightRange: [0.75, 0.9], evidenceIds: ["fact.gu_lin.owned_goal"] },
  ];
  foundation.stablePsychology.selfThreats = [
    { id: "depending_on_family_rescue", fearedSelfState: "遇事仍只能等长辈收拾", activationRange: [0.65, 0.85], evidenceIds: ["fact.gu_lin.owned_goal"] },
  ];
  foundation.dynamicPsychology.stateVariables = [
    { id: "fatigue", baselineRange: [0.1, 0.3], decayRange: [0.1, 0.2], bounds: [0, 1] },
    { id: "urgency", baselineRange: [0.5, 0.7], decayRange: [0.02, 0.08], bounds: [0, 1] },
    { id: "suspicion", baselineRange: [0.4, 0.6], decayRange: [0.05, 0.15], bounds: [0, 1] },
  ];
  foundation.sceneBindings = [
    {
      sceneId,
      reasonForPresence: "顾临想查清家族渡运簿在此处被调包的环节。",
      entryCause: "他比对封签后发现昨夜渡船记录不一致，步行来到渡口。",
      currentPurpose: "核对公开船次并争取查看原始登记。",
      responsibilityRoleIds: [],
      knownAffordanceIds: ["ask_about_register"],
      prohibitedKnowledge: ["records_room_contents"],
      exitConditions: ["obtains_verifiable_lead", "ferry_closes_and_no_access"],
    },
  ];
  foundation.desires = [
    {
      id: "desire.gu_lin.recover_register",
      ownerCharacterId: characterId,
      desiredState: {
        subjectCharacterId: characterId,
        verb: "取回",
        object: "被调包的家族渡运簿",
        observableOutcome: "顾临亲手取回原簿并完成封签与笔迹核验",
      },
      baselineRange: [0.75, 0.9],
      progressEvidence: ["核对到一条可验证的船次记录", "取得有来源的经手人线索"],
      satisfactionCondition: "顾临亲手取回原簿并以封签和笔迹完成核验。",
      recurrence: "until_verified_recovered",
    },
  ];
  foundation.inhibitors = [
    { id: "inhibitor.private_records", conditionPattern: "records_room_access_absent", costChannel: "physical_permission", weightRange: [0.8, 1], meaning: "无法直接进入档房", doesNotMean: "不再想追回原簿" },
    { id: "inhibitor.public_accusation_cost", conditionPattern: "unverified_accusation_before_crowd", costChannel: "reputation_and_evidence", weightRange: [0.55, 0.75], meaning: "公开指控会损害查证", doesNotMean: "害怕所有人注视" },
  ];
  foundation.speechPolicy.silenceDefault = "没有可推进查证的内容时保持沉默并观察记录流向。";
  foundation.speechPolicy.pragmaticForms = ["直接询问可核验记录", "压力下缩短解释", "承诺后续查证"];
  foundation.speechPolicy.lexicalFocus = ["渡运簿", "船次", "封签", "经手人"];
  foundation.relationshipModel.dimensions = ["trust", "obligation", "suspicion", "respect"];
  foundation.relationshipModel.updateRules = [
    {
      observedPattern: "对方提供可独立复核的直接证据",
      appraisal: "对方提高了查证进展而非要求盲信",
      deltas: { trust: 0.2, suspicion: -0.2 },
    },
  ];
  await writeJson(foundationPath, foundation);

  const calibrationPath = path.join(characterDir, "calibration-evidence.json");
  const calibration = await readJson(calibrationPath);
  calibration.status = "validated";
  calibration.speechSamples = [
    { function: "information_request", line: "昨夜最后一班船，谁碰过渡运簿？", evidenceId: "calibration.direct_vs_rumor" },
    { function: "pressure", line: "我问的是簿子，不是谁替谁担保。", evidenceId: "calibration.public_vs_private" },
    { function: "commitment", line: "今日查不清，我明日还来。", evidenceId: "fact.gu_lin.owned_goal" },
  ];
  calibration.relationshipCases = [
    {
      observedPattern: "shares_verifiable_record",
      appraisal: "对方提供了可复核证据",
      deltas: { trust: 0.2, suspicion: -0.2 },
      evidenceIds: ["calibration.direct_vs_rumor"],
    },
  ];
  calibration.controlledContrasts = [
    {
      id: "calibration.direct_vs_rumor",
      domain: "epistemic",
      changedVariable: "evidence_source",
      answer: "先核对公开船次，不把船客传言当成盗簿事实。",
      inferredEvidenceIds: ["fact.gu_lin.owned_goal"],
    },
    {
      id: "calibration.public_vs_private",
      domain: "social",
      changedVariable: "audience",
      answer: "在人多处只问记录，不公开指控经手人。",
      inferredEvidenceIds: ["fact.gu_lin.owned_goal"],
    },
    {
      id: "calibration.rested_vs_injured",
      domain: "body",
      changedVariable: "body_state",
      answer: "受伤时先请人抄录船次，保留线索后离开。",
      inferredEvidenceIds: ["fact.gu_lin.owned_goal"],
    },
  ];
  calibration.holdouts = [
    {
      id: "holdout.stereotype_counterexample",
      unseenSituation: "家族长辈主动派人替他索要簿册。",
      prediction: "拒绝让对方代办，但会使用对方提供的可验证手续。",
      accepted: true,
    },
    {
      id: "holdout.injured_with_direct_evidence",
      unseenSituation: "他受伤时亲眼看见原簿被送上即将离岸的船。",
      prediction: "提高追索紧迫度，但仍在身体可行范围内选择呼喊截船或请求封渡。",
      accepted: true,
    },
    {
      id: "holdout.blocked_private_access",
      unseenSituation: "档房关闭且守渡人拒绝放行。",
      prediction: "转查公开船次和经手人，不把受阻当成目标完成。",
      accepted: true,
    },
  ];
  await writeJson(calibrationPath, calibration);

  const memoryPath = path.join(characterDir, "memory-seed.json");
  const memory = await readJson(memoryPath);
  memory.status = "confirmed";
  memory.emptyReason = "";
  memory.beliefs = [
    {
      id: "belief.register_swapped",
      sourceType: "direct_comparison",
      confidence: 0.82,
      claim: "家族渡运簿与自己封存的版本不一致。",
    },
  ];
  await writeJson(memoryPath, memory);

  const runtimePath = path.join(characterDir, "runtime-map.json");
  const runtime = await readJson(runtimePath);
  runtime.status = "behavior-accepted";
  for (const [surface, authority] of Object.entries(runtime.authoritySurfaces)) {
    authority.path = "synthetic/" + sceneId + "/" + characterId + ".mjs";
    authority.symbol = "authority_" + surface;
  }
  runtime.acceptanceTests = [
    "agent_non_top_choice",
    "unresolved_desire_survives_delay",
    "rumor_differs_from_direct_knowledge",
    "private_zone_blocks_propagation",
    "relationship_changes_expression_not_desire",
    "voice_changes_by_function",
    "body_state_changes_behavior",
    "non_luozhao_portability",
  ].map((id) => ({ id, passed: true }));
  await writeJson(runtimePath, runtime);

  const embodiedContaminatedScene = await readJson(path.join(sceneDir, "scene-contract.json"));
  embodiedContaminatedScene.topology.positions = [{
    id: "position_dock_edge",
    zoneId: "dock",
    objectiveMetrics: { visualCoverage: [0.7, 0.9] },
    preferredPositionId: "author_selected_answer",
  }];
  embodiedContaminatedScene.resources[1].attachment = {
    active: true,
    actorId: "char_someone_else",
    mode: "worn_on_body",
    transitionRequiresExplicitOperation: true,
  };
  await writeJson(path.join(sceneDir, "scene-contract.json"), embodiedContaminatedScene);
  const embodiedContaminated = run(checkScript, [...commonArgs, "--gate", "calibrated"]);
  assert.notEqual(embodiedContaminated.status, 0, "world-authored position answers and impossible attachment ownership must fail");
  const embodiedCodes = new Set(parseOutput(embodiedContaminated).errors.map((row) => row.code));
  assert.ok(embodiedCodes.has("SCENE_POSITION_ANSWER_LEAK"));
  assert.ok(embodiedCodes.has("SCENE_RESOURCE_ATTACHMENT_INVALID"));
  delete embodiedContaminatedScene.topology.positions;
  delete embodiedContaminatedScene.resources[1].attachment;
  await writeJson(path.join(sceneDir, "scene-contract.json"), embodiedContaminatedScene);
  report.checks.push("scene authority rejects preselected positions and attachment-holder contradictions");

  const serviceContaminatedScene = await readJson(path.join(sceneDir, "scene-contract.json"));
  serviceContaminatedScene.economy = {
    currency: { id: "copper_wen", label: "文", physicalMedium: "铜钱" },
    offerings: [{
      id: "plain_tea",
      label: "清茶",
      priceWen: 1,
      preferredOfferId: "author_selected_answer",
    }],
  };
  await writeJson(path.join(sceneDir, "scene-contract.json"), serviceContaminatedScene);
  const serviceContaminated = run(checkScript, [...commonArgs, "--gate", "calibrated"]);
  assert.notEqual(serviceContaminated.status, 0, "world-authored consumption answers and auto-completed service chains must fail");
  const serviceCodes = new Set(parseOutput(serviceContaminated).errors.map((row) => row.code));
  assert.ok(serviceCodes.has("SCENE_SERVICE_CHOICE_ANSWER_LEAK"));
  assert.ok(serviceCodes.has("SCENE_SERVICE_TRANSACTION_PHASE_MISSING"));
  delete serviceContaminatedScene.economy;
  await writeJson(path.join(sceneDir, "scene-contract.json"), serviceContaminatedScene);
  report.checks.push("scene authority rejects preferred consumption answers and missing transaction phases");

  const behavior = run(checkScript, [...commonArgs, "--gate", "behavior"]);
  assert.equal(behavior.status, 0, behavior.stderr || behavior.stdout);
  assert.equal(parseOutput(behavior).valid, true);
  report.checks.push("a non-Luo psychology and river-scene packet passes every structural gate");

  const contaminatedFoundation = await readJson(foundationPath);
  contaminatedFoundation.actionPolicy = {
    candidateFamilies: [{ situation: "keeper refuses", response: "repeat the calibration answer" }],
  };
  await writeJson(foundationPath, contaminatedFoundation);
  const contaminated = run(checkScript, [...commonArgs, "--gate", "draft"]);
  assert.notEqual(contaminated.status, 0, "a situation-to-action script must fail even the draft runtime-foundation boundary");
  assert.ok(parseOutput(contaminated).errors.some((row) => row.code === "FOUNDATION_AUTHORING_DATA_LEAK"));
  delete contaminatedFoundation.actionPolicy;
  await writeJson(foundationPath, contaminatedFoundation);
  report.checks.push("runtime foundation rejects calibration answers and situation-to-action menus");

  const acceptedSceneBytes = await readFile(path.join(sceneDir, "scene-contract.json"), "utf8");
  const secondCharacter = run(initScript, [
    "--root", tempRoot,
    "--scene", sceneId,
    "--scene-name", "ignored replacement name",
    "--character", "char_su_yao",
    "--name", "苏遥",
  ]);
  assert.equal(secondCharacter.status, 0, secondCharacter.stderr);
  assert.equal(parseOutput(secondCharacter).createdSceneContract, false);
  assert.equal(await readFile(path.join(sceneDir, "scene-contract.json"), "utf8"), acceptedSceneBytes);
  report.checks.push("adding another character preserves the already accepted scene authority");

  const duplicate = run(initScript, [
    "--root", tempRoot,
    "--scene", sceneId,
    "--character", characterId,
    "--name", "duplicate",
  ]);
  assert.notEqual(duplicate.status, 0, "duplicate character authority must be refused");
  report.checks.push("duplicate character authority is rejected");

  const skillText = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
  const exampleText = await readFile(path.join(skillRoot, "references", "validated-example-luozhao.md"), "utf8");
  assert.match(skillText, /confirm the objective scene/i);
  assert.match(skillText, /source-aware memory/i);
  assert.match(skillText, /never her personality/i);
  assert.match(exampleText, /must never be copied/i);
  report.checks.push("the reusable method explicitly forbids copying Luo Zhao's personality");

  console.log(JSON.stringify({ ...report, valid: true }, null, 2));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
