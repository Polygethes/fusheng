#!/usr/bin/env node

import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    result[key] = value;
    index += 1;
  }
  return result;
}

function safeId(value, label) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) {
    throw new Error(`${label} must use stable ASCII letters, digits, dot, colon, underscore, or hyphen`);
  }
  return id;
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeNew(target, content) {
  await writeFile(target, content, { encoding: "utf8", flag: "wx" });
}

const args = parseArgs(process.argv.slice(2));
const sceneId = safeId(args.scene, "scene id");
const characterId = safeId(args.character, "character id");
const characterName = String(args.name || "").trim();
if (!characterName) throw new Error("--name is required");
const root = path.resolve(args.root || ".codex/anchors");
const sceneDir = path.join(root, sceneId);
const characterDir = path.join(sceneDir, "characters", characterId);
if (await exists(characterDir)) throw new Error(`Character anchor workspace already exists: ${characterDir}`);

await mkdir(characterDir, { recursive: true });
const sceneContractPath = path.join(sceneDir, "scene-contract.json");
const createdSceneContract = !(await exists(sceneContractPath));
if (createdSceneContract) {
  await writeNew(sceneContractPath, json({
    schemaVersion: 1,
    sceneId,
    status: "draft",
    identity: { name: String(args["scene-name"] || ""), canonSourceIds: [], timeScope: "" },
    ownership: { ownerCharacterId: "", operatorCharacterIds: [], institutionId: "" },
    topology: { zones: [], routes: [], privateZoneIds: [] },
    resources: [],
    resourceAbsenceReason: "",
    affordances: [],
    impossibilities: [],
    roles: [],
    environmentalPressures: { atmosphere: [], temptations: [], hazards: [], neutralReason: "" },
    informationRoutes: [],
    presencePolicy: {
      entryRequiresCharacterCause: true,
      exitIsAffordanceNotSchedule: true,
      scheduleRole: "constraint-only",
    },
    validation: { counterexamples: [] },
  }));
}

const artifacts = {
  factCard: "fact-card.md",
  interviewLog: "interview-log.md",
  anchorPayload: "anchor-payload.json",
  characterFoundation: "character-foundation.json",
  calibrationEvidence: "calibration-evidence.json",
  memorySeed: "memory-seed.json",
  holdouts: "holdouts.md",
  runtimeMap: "runtime-map.json",
};

await writeNew(path.join(characterDir, "manifest.json"), json({
  schemaVersion: 2,
  sceneId,
  characterId,
  characterName,
  createdAt: new Date().toISOString(),
  gates: {
    sceneContract: "draft",
    factConfirmation: "pending",
    calibration: "pending",
    holdouts: "pending",
    runtimeMapping: "pending",
    behaviorAcceptance: "pending",
  },
  artifacts,
}));

await writeNew(path.join(characterDir, artifacts.factCard), `# ${characterName} Fact Card\n\nStatus: draft\n\n## Authority sources\n\n- Canon sources:\n- Runtime sources:\n- Story time:\n\n## Confirmed facts\n\n## Inferences awaiting confirmation\n\n## Unknowns\n\n## Conflicts\n\n## Story-open choice axes\n\n## Presence in ${sceneId}\n\n- Why here now:\n- Entry cause and evidence:\n- Current purpose:\n- Public role/responsibilities:\n- Body and possessions:\n- What this person knows by direct experience:\n- What this person knows only by report or rumor:\n\n## World-facing physical signal surface\n\nRecord only active literal surfaces such as clothing, posture, emitted breathing or footstep sound, and object wear. Do not record identity, hidden intent, relationship meaning, temperament, or skill conclusions.\n\n- Current visual signals:\n- Current audible signals (only while actually emitted):\n- Current smell or vibration signals:\n- Dynamic override conditions:\n`);

await writeNew(path.join(characterDir, artifacts.interviewLog), `# ${characterName} Interview Log\n\nAsk one to three questions per turn. Record the answer, evidence id, scope, counterevidence, and inferred range.\n\n## Desire and verified satisfaction\n\n## Threat, trauma, and intolerable self-state\n\n## Sensory channels and impairments\n\n## Attention priorities, blind spots, and overload\n\n## Professional feature decoding\n\n## Information seeking, verification, and self-disclosure\n\n## Evidence reliability\n\n## Public/private contrast\n\n## Relationship contrast\n\n## Body-state contrast\n\n## Sustenance physiology, fasting, mundane/spiritual nutrition, and state exceptions\n\n## Wealth sources, currency domains, acquisition access, debt, and current liquidity\n\n## Consumption habits, quality sensitivity, price sensitivity, and status display\n\n## Resource or temptation contrast\n\n## Blocking, frustration, and recurrence\n\n## Speech functions and silence\n\n## Major-choice axis\n`);

await writeNew(path.join(characterDir, artifacts.anchorPayload), json({
  schemaVersion: 2,
  recordType: "character-authoring-index",
  characterId,
  status: "draft",
  evidence: { confirmed: [], inferences: [], unknowns: [], conflicts: [], openChoiceAxes: [] },
  foundationRef: artifacts.characterFoundation,
  calibrationEvidenceRef: artifacts.calibrationEvidence,
  memorySeedRef: artifacts.memorySeed,
  authoringNotes: [],
}));

await writeNew(path.join(characterDir, artifacts.characterFoundation), json({
  schemaVersion: 1,
  runtimeSurface: "character-foundation",
  characterId,
  status: "draft",
  numericCalibrationStatus: "unassigned",
  identityModel: { conflicts: [], openChoiceAxes: [] },
  stablePsychology: { corePursuits: [], selfThreats: [], dispositions: {} },
  physiology: {
    authority: "",
    sustenance: {
      mode: "ordinary_food_dependent",
      authorBand: "",
      numericAuthority: "engine-operational-default-from-author-band",
      authorNumericCalibration: "unassigned",
      ordinaryFoodDependenceRange: [0, 1],
      ordinaryFoodRecoveryEfficiencyRange: [0, 1],
      basalHungerGrowthRange: [0, 1],
      exertionHungerCouplingRange: [0, 1],
      spiritualFoodConversionRange: [0, 1],
      fastingToleranceBand: "",
      alternativeSustenanceSources: [],
      exceptions: [],
    },
  },
  materialEconomy: {
    wealthBand: "",
    materialPosition: "",
    sources: [],
    access: { reserveMode: "", reserveDescription: "", businessTillAccess: false, institutionalSupport: false },
    currencyAccess: {
      copper_wen: {
        currencyClass: "mundane",
        acquisitionEaseRange: [0, 1],
        strategicValueRange: [0, 1],
        conversionFrictionRange: [0, 1],
        acquisitionRequiresAction: true,
        carriedTenderRequiredAtSettlement: true,
        description: "",
      },
    },
    obligations: [],
    consumptionPreferences: {
      priceSensitivity: [0, 1],
      qualitySensitivity: [0, 1],
      statusDisplayDrive: [0, 1],
      wasteAversion: [0, 1],
      bargainingWillingness: [0, 1],
      transactionPatience: [0, 1],
    },
    categoryKnowledge: {},
  },
  dynamicPsychology: { stateVariables: [] },
  epistemics: { sourceReliability: {}, knownEntities: [], beliefUpdatePolicy: {} },
  perceptionProfile: {
    sensoryChannels: {},
    attention: { orientingBiases: {} },
    domainDecoders: [],
    informationStyle: {},
  },
  sceneBindings: [{
    sceneId,
    reasonForPresence: "",
    entryCause: "",
    currentPurpose: "",
    responsibilityRoleIds: [],
    knownAffordanceIds: [],
    prohibitedKnowledge: [],
    exitConditions: [],
  }],
  desires: [],
  inhibitors: [],
  speechPolicy: {
    silenceDefault: "",
    explanationCostRange: [0, 1],
    socialMaintenanceRange: [0, 1],
    pragmaticForms: [],
    praiseConditions: [],
    pressureMutation: [],
    relationshipRegisters: {},
    forbiddenRegisters: [],
    lexicalFocus: [],
  },
  relationshipModel: { dimensions: [], updateRules: [], forbiddenCollapses: [] },
  memoryPolicy: { seedRef: artifacts.memorySeed, encodingBiases: {}, retrievalBiases: {} },
}));

await writeNew(path.join(characterDir, artifacts.calibrationEvidence), json({
  schemaVersion: 1,
  recordType: "character-calibration-suite",
  characterId,
  status: "draft",
  controlledContrasts: [],
  speechSamples: [],
  relationshipCases: [],
  holdouts: [],
}));

await writeNew(path.join(characterDir, artifacts.memorySeed), json({
  schemaVersion: 1,
  ownerCharacterId: characterId,
  status: "draft",
  emptyReason: "",
  episodes: [],
  beliefs: [],
  commitments: [],
  impressions: [],
  selfNarrative: { currentClaims: [], versions: [], pendingCandidates: [] },
}));

await writeNew(path.join(characterDir, artifacts.holdouts), `# ${characterName} Holdouts\n\nDo not reveal the intended answer while asking. Record user acceptance or correction.\n\n## Holdout 1: stereotype counterexample\n\n## Holdout 2: changed evidence, relationship, or body state\n\n## Holdout 3: blocked desire or consequential choice\n`);

await writeNew(path.join(characterDir, artifacts.runtimeMap), json({
  schemaVersion: 1,
  sceneId,
  characterId,
  status: "draft",
  authoritySurfaces: Object.fromEntries([
    "sceneFacts", "worldSignals", "psychology", "voice", "relationships", "memory", "presence", "candidateCompilation", "validation",
  ].map((key) => [key, { path: "", symbol: "", derivedProjectionPaths: [] }])),
  runtimeBoundary: {
    agentInputArtifactIds: ["characterFoundation", "memorySeed"],
    forbiddenAgentInputArtifactIds: ["anchorPayload", "calibrationEvidence", "holdouts"],
  },
  acceptanceTests: [],
  remainingGaps: [],
}));

console.log(JSON.stringify({ root, sceneDir, characterDir, createdSceneContract, artifacts }, null, 2));
