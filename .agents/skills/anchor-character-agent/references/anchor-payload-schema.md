# Character Authoring, Foundation, And Calibration Schema

Do not use one payload as both author evidence and a live Character-Agent brain. A character packet has four separate authorities.

## 1. Authoring index and evidence ledger

`anchor-payload.json` records what the author confirmed, inferred, left unknown, contradicted, or deliberately kept story-open. It is an audit/compiler input, never an Agent input.

```js
{
  schemaVersion: 2,
  recordType: "character-authoring-index",
  characterId: "stable-id",
  status: "draft | calibrated | validated",
  evidence: {
    confirmed: [{ id, claim, provenance, confidence }],
    inferences: [{ id, claim, evidenceIds, confidence }],
    unknowns: [{ id, question, consequence }],
    conflicts: [{ id, poles, hierarchy, status }],
    openChoiceAxes: [{ id, valuesInConflict, contexts, resolution: "story-open" }]
  },
  foundationRef: "character-foundation.json",
  calibrationEvidenceRef: "calibration-evidence.json",
  memorySeedRef: "memory-seed.json",
  authoringNotes: []
}
```

Migrated v1 packets may keep their full `anchor-payload.json` byte-for-byte as a legacy authoring record when a validated registry hash depends on it. Their manifest must still name the separated foundation and calibration artifacts.

### World-facing physical signal surface

Current outward surfaces are world state, not psychological parameters. The runtime map may compile confirmed fact-card material into `characters[].publicSignalFeatures`; `lifeState.publicSignalFeatures` is the current-state override when clothing, injury, emitted sound, or another surface changes.

```js
publicSignalFeatures: [{
  featureId,
  modality,             // visual / sound / smell / vibration
  physicalFeature,      // literal surface only
  domainTags,           // clothing / weapon / gait / voice / commerce...
  intensity,
  durationSeconds,
  transmissionFactor,
  noiseResistance
}]
```

Only signals physically active now belong in this list. A voice profile does not emit sound while the person is silent. Do not include canonical identity, hidden intent, relationship meaning, temperament labels, or skill conclusions. Other Characters receive only the subset that reaches their senses and wins their private attention; the full surface inventory is never copied into their prompt.

## 2. Runtime character foundation

`character-foundation.json` contains only reusable facts and psychological parameters. It answers “what kind of person is this?” and “what pressures matter to them?” It must never answer “what action do they take in this situation?”

```js
{
  schemaVersion: 1,
  runtimeSurface: "character-foundation",
  characterId: "stable-id",
  status: "draft | calibrated | validated",
  numericCalibrationStatus: "unassigned | range-calibrated",

  identityModel: {
    conflicts: [],
    openChoiceAxes: []
  },

  stablePsychology: {
    corePursuits: [{ id, desiredSelfState, weightRange }],
    selfThreats: [{ id, fearedSelfState, activationRange }],
    dispositions: { parameterId: { range: [0, 1], scope } }
  },

  physiology: {
    authority,
    sustenance: {
      mode,                 // ordinary_food_dependent | reduced_mundane_dependence | long_fasting_low_mundane_need | bigu_independent
      authorBand,
      numericAuthority,
      authorNumericCalibration,
      ordinaryFoodDependenceRange: [0, 1],
      ordinaryFoodRecoveryEfficiencyRange: [0, 1],
      basalHungerGrowthRange: [0, 1],
      exertionHungerCouplingRange: [0, 1],
      spiritualFoodConversionRange: [0, 1],
      fastingToleranceBand,
      alternativeSustenanceSources: [],
      exceptions: []
    }
  },

  materialEconomy: {
    wealthBand,            // 稳定物质处境，不是当前钱包数字
    materialPosition,      // 收入、资产、依附与流动性之间的具体关系
    sources: [{ id, kind, description, reliability }],
    access: { reserveMode, reserveDescription, businessTillAccess, institutionalSupport },
    currencyAccess: {
      currencyId: {
        currencyClass,      // mundane | cultivation | institutional
        acquisitionEaseRange: [0, 1],
        strategicValueRange: [0, 1],
        conversionFrictionRange: [0, 1],
        acquisitionRequiresAction: true,
        carriedTenderRequiredAtSettlement: true,
        description
      }
    },
    obligations: [{ id, description, pressureRange }],
    consumptionPreferences: {
      priceSensitivity: [0, 1],
      qualitySensitivity: [0, 1],
      statusDisplayDrive: [0, 1],
      wasteAversion: [0, 1],
      bargainingWillingness: [0, 1],
      transactionPatience: [0, 1]
    },
    categoryKnowledge: {}
  },

  dynamicPsychology: {
    stateVariables: [{ id, baselineRange, decayRange, bounds }]
  },

  epistemics: {
    sourceReliability: {},
    knownEntities: [{ entityId, knowsName, recognizesIdentity, basis }],
    beliefUpdatePolicy: {}
  },

  competenceModel: {
    perceptualCompetences: [{
      id,
      domain,
      baseRange,
      noticedCueTypes: [],
      uncertaintyPolicy,
      stateSensitivity: []
    }],
    proceduralCompetences: [{
      id,
      domain,
      baseRange,
      supportedPrimitiveIds: [],
      equipmentHabits: [],
      degradationFactors: []
    }],
    boundaries: {
      affects: ["perception", "candidate-generation", "cost-estimation", "execution"],
      doesNotChooseDesire: true,
      doesNotChooseFinalAction: true
    }
  },

  perceptionProfile: {
    sensoryChannels: {
      visual: { availability, acuity },
      sound: { availability, acuity, rhythmResolution, sourceLocalization }
    },
    attention: {
      baselineBudgetRange,
      sensitivityThresholdRange,
      distractibilityRange,
      overloadSensitivityRange,
      orientingBiases: { domainTag: [minimum, maximum] }
    },
    domainDecoders: [{ id, domain, competenceRange, supportedInferences: [] }],
    informationStyle: {
      directInquiryRange,
      concealmentNeedRange,
      patienceRange,
      verificationThresholdRange,
      socialRiskSensitivityRange,
      reactionReadingConfidenceRange
    }
  },

  sceneBindings: [{
    sceneId,
    reasonForPresence,
    entryCause,
    currentPurpose,
    responsibilityRoleIds: [],
    knownAffordanceIds: [],
    prohibitedKnowledge: [],
    exitConditions: []
  }],

  desires: [{
    id,
    ownerCharacterId,
    desiredState: { subjectCharacterId, verb, object, observableOutcome },
    target,
    baselineRange,
    activationCues: [],
    progressEvidence: [],
    satisfactionCondition,
    unresolvedDynamics: {
      retentionRange,
      frustrationGainRange,
      cueGainRange,
      resolutionGainRange
    }
  }],

  inhibitors: [{ id, conditionPattern, costChannel, weightRange, meaning, doesNotMean }],

  speechPolicy: {
    silenceDefault,
    explanationCostRange,
    socialMaintenanceRange,
    pragmaticForms: [],
    praiseConditions: [],
    pressureMutation: [],
    relationshipRegisters: {},
    forbiddenRegisters: [],
    lexicalFocus: []
  },

  relationshipModel: {
    dimensions: [],
    updateRules: [{ observedPattern, appraisal, deltas }],
    forbiddenCollapses: []
  },

  memoryPolicy: { seedRef: "memory-seed.json", encodingBiases: {}, retrievalBiases: {} }
}
```

Relationship update rules must describe a reusable perceived-act mechanism, such as “provides independently verifiable evidence,” not a one-scene future script. Exact calibration cases remain in the calibration suite.

The foundation must not contain any of these:

- `evidence`, provenance, evidence ids, author confidence, or validation verdicts;
- `validation`, calibration answers, Holdouts, or Holdout predictions;
- `actionPolicy`, `candidateFamilies`, fixed escalation routes, or situation-to-action scripts;
- competence fields such as `expectedChoice`, `fixedAction`, `preferredPositionId`, `situationToAction`, or any disguised answer lookup;
- perception fields such as `preferredQuestion`, `expectedObservation`, `fixedTarget`, or any situation-specific inquiry answer;
- consumption fields such as `fixedPurchase`, `defaultOrder`, `preferredOfferingId`, or any situation-to-purchase answer;
- character-specific `dynamicPsychology.updateRules` that execute a calibration answer;
- `speechPolicy.evidenceAnchors`, accepted sample lines, sample regexes, or whole sample sentences used as lexicon.

## 3. Calibration and Holdout suite

`calibration-evidence.json` stores tests and author judgments. The compiler and checker may read it; the Character Agent may not.

```js
{
  schemaVersion: 1,
  recordType: "character-calibration-suite",
  characterId: "stable-id",
  status: "draft | calibrated | validated",
  controlledContrasts: [{
    id,
    domain,
    changedVariable,
    answer,
    inferredEvidenceIds
  }],
  speechSamples: [{ function, line, evidenceId }],
  relationshipCases: [{ observedPattern, appraisal, deltas, evidenceIds }],
  holdouts: [{ id, unseenSituation, prediction, accepted }]
}
```

Use the samples to infer ranges and aggregate voice shape. Never copy them into memory, prompt guidance, preferred lexicon, candidate policy, or relationship state.

## 4. Owned memory seed

`memory-seed.json` contains only events, beliefs, commitments, impressions, and self-narrative states the character can own. `selfNarrative` has `currentClaims`, historical `versions`, and a bounded `pendingCandidates` list for committed owned episodes that have not yet earned consolidation. It is not a place to hide calibration answers. If no prior memory is authorized, record an explicit `emptyReason`.

## Generic cognitive core contract

The generic cognitive core is code shared by all characters, not another character file. Each turn it:

1. receives the character's perceived world facts and affordances;
2. retrieves relevant owned memory and subjective relationship state;
3. instantiates universal action primitives that are currently feasible or attemptable;
4. uses foundation parameters, effective competence, procedural habits, and current capacity as the character's private appraisal tool;
5. presents multiple candidates to the Character Agent;
6. accepts the Agent's chosen candidate id, including a feasible non-top-scored choice, plus a qualitative `pending_world_resolution` continuity proposal that cannot mutate state;
7. lets the world validate the attempt and resolve objective consequences;
8. only after commit, settles action memory, unresolved desire pressure, dynamic state, and self-narrative against actual evidence.

The formula can rank pressures but cannot make the final choice. The world can make an action impossible but cannot replace it with a preferred intention.

## Invariants

- Keep normalized weights, state, confidence, and source reliability in `[0, 1]`; relationship and affect deltas stay in `[-1, 1]`.
- Retain ranges in the authoring/calibration layer. If runtime needs one value, record the compilation policy without exposing author evidence to the Agent.
- A false rumor may enter subjective belief but never objective world truth.
- `recognizesIdentity` and `knowsName` are different facts.
- Delay, suppression, transaction completion, departure, or a related action never closes a desire without matching outcome evidence.
- Presence needs a character-owned cause and feasible route; schedule labels are constraints only.
- A position is a character-owned choice. The world may expose neutral spatial metrics but cannot declare which option fits a particular character.
- Possession, attachment, object state, and location are independent fields. Movement preserves active attachment; detach, draw, place, transfer, and consume require their own committed transitions.
- `openChoiceAxes` remain unresolved until consequential experience, prediction error, later reflection, and consolidation support self-change.
- The actual autobiographical records live only in `memory-seed.json`; biography prose does not become a typed social role by word order.
- Stable wealth access and consumption preferences belong to the foundation; the exact coins currently carried belong to owned world state. A cash box, family property, sect allowance, credit, and personal wallet are distinct resources and may not be collapsed into one number.
- A venue exposes product category, quality, serving size, price, stock, preparation cost, service delay, and observable cues. It may state which item is objectively most expensive, but it may never mark which item a character should buy.

## Runtime compilation

An offline compiler may read all four artifacts. The live Agent input is limited to:

- sanitized character foundation;
- owned private memory and subjective beliefs;
- directional relationship estimates owned by this character;
- perceived world facts, opportunities, pressures, and affordances;
- concrete candidates generated by the generic cognitive core.

Never expose another character's private state, author evidence, calibration answers, Holdouts, observer telemetry, or fixed sample dialogue.

The character packet does not own scene topology, resources, routes, physical possibilities, or consequences. Create the shared scene contract first and follow [runtime-mapping.md](runtime-mapping.md) when wiring the compiled projection.
