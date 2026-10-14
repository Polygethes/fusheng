export const agentOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "characterId",
    "targetCharacterId",
    "tone",
    "visibleAction",
    "hiddenAction",
    "defenseAction",
    "shadowAction",
    "selfDeceptionSentence",
    "wantsFromOthers",
    "desiredEmotionalResponse",
    "possibleHarm",
    "possibleNobleAction",
    "possibleEvidenceLeft",
    "surfaceJustification",
    "desireReason",
    "shameReason",
    "powerReason",
    "selfDeceptionReason",
    "unadmittedPleasure",
    "postActionSelfPunishment",
    "planInfluence",
    "planNextAction",
    "planStatus",
    "realtimePublicGoal",
    "realtimePrivateDesire",
    "realtimeDefensiveMask",
    "realtimeShadowImpulse",
    "realtimeNobleImpulse",
    "realtimeLieToSelf",
    "realtimeActionCandidate",
    "realtimePressure",
    "realtimeContradictionScore",
    "falseBeliefs",
    "withheldFacts"
  ],
  properties: {
    characterId: { type: "string" },
    targetCharacterId: { type: "string" },
    tone: { type: "string", enum: ["惩罚", "接近", "伪装", "保护", "试探", "自毁", "共谋", "陷害", "撤退", "求证"] },
    visibleAction: { type: "string" },
    hiddenAction: { type: "string" },
    defenseAction: { type: "string" },
    shadowAction: { type: "string" },
    selfDeceptionSentence: { type: "string" },
    wantsFromOthers: { type: "string" },
    desiredEmotionalResponse: { type: "string" },
    possibleHarm: { type: "string" },
    possibleNobleAction: { type: "string" },
    possibleEvidenceLeft: { type: "string" },
    surfaceJustification: { type: "string" },
    desireReason: { type: "string" },
    shameReason: { type: "string" },
    powerReason: { type: "string" },
    selfDeceptionReason: { type: "string" },
    unadmittedPleasure: { type: "string" },
    postActionSelfPunishment: { type: "string" },
    memoryId: { type: "string" },
    memoryInfluence: { type: "string" },
    planId: { type: "string" },
    planInfluence: { type: "string" },
    planNextAction: { type: "string" },
    planStatus: { type: "string" },
    realtimePublicGoal: { type: "string" },
    realtimePrivateDesire: { type: "string" },
    realtimeDefensiveMask: { type: "string" },
    realtimeShadowImpulse: { type: "string" },
    realtimeNobleImpulse: { type: "string" },
    realtimeLieToSelf: { type: "string" },
    realtimeActionCandidate: { type: "string" },
    realtimePressure: { type: "number" },
    realtimeContradictionScore: { type: "number" },
    visibilityFacts: { type: "array", items: { type: "string" } },
    falseBeliefs: { type: "array", items: { type: "string" } },
    withheldFacts: { type: "array", items: { type: "string" } }
  }
};

export const agentsBatchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["agentOutputs"],
  properties: {
    agentOutputs: { type: "array", items: agentOutputSchema }
  }
};

export const directorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["surfaceEvent", "sceneText", "subtextMatrix", "relationshipShift", "irreversibleTraces", "directorNotes"],
  properties: {
    surfaceEvent: { type: "string" },
    sceneText: { type: "string" },
    directorNotes: { type: "string" },
    subtextMatrix: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["speakerId", "speaker", "line", "surface", "hiddenAction", "speakerWants", "listenerMisreads"],
        properties: {
          speakerId: { type: "string" },
          speaker: { type: "string" },
          line: { type: "string" },
          surface: { type: "string" },
          hiddenAction: { type: "string" },
          speakerWants: { type: "string" },
          listenerMisreads: { type: "string" }
        }
      }
    },
    relationshipShift: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fromCharacterId", "toCharacterId", "deltas", "misreading", "unspoken"],
        properties: {
          fromCharacterId: { type: "string" },
          toCharacterId: { type: "string" },
          deltas: {
            type: "object",
            additionalProperties: false,
            properties: {
              love: { type: "number" }, attraction: { type: "number" }, resentment: { type: "number" }, fear: { type: "number" }, dependence: { type: "number" },
              power: { type: "number" }, shame: { type: "number" }, jealousy: { type: "number" }, protection: { type: "number" }, revenge: { type: "number" },
              deception: { type: "number" }, wantsToBeSeen: { type: "number" }, wantsToPossess: { type: "number" }, wantsToEscape: { type: "number" }, wantsToDestroy: { type: "number" }
            }
          },
          misreading: { type: "string" },
          unspoken: { type: "string" }
        }
      }
    },
    irreversibleTraces: { type: "array", items: { type: "string" } }
  }
};

const dialogueTurnSchema = {
  type: "object",
  additionalProperties: false,
  required: ["speakerId", "speakerName", "targetId", "targetName", "line", "turnRole"],
  properties: {
    speakerId: { type: "string" },
    speakerName: { type: "string" },
    targetId: { type: "string" },
    targetName: { type: "string" },
    line: { type: "string" },
    turnRole: { type: "string", enum: ["claim", "response", "counter", "turn"] },
    respondsTo: { type: "string" }
  }
};

const agentExchangeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sourceCharacterId", "responseCharacterId", "sourceCharacterName", "responseCharacterName", "dialogueTurns", "eventOutcome", "relationshipDeltas", "sharedObject", "generatedFrom"],
  properties: {
    sourceCharacterId: { type: "string" },
    responseCharacterId: { type: "string" },
    sourceCharacterName: { type: "string" },
    responseCharacterName: { type: "string" },
    dialogueTurns: { type: "array", items: dialogueTurnSchema },
    eventOutcome: { type: "string" },
    relationshipDeltas: directorSchema.properties.relationshipShift,
    sharedObject: { type: "string" },
    generatedFrom: { type: "string" }
  }
};


export const visibilityLayerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["visibleFacts", "hiddenFacts", "perCharacter", "visibilityNotes"],
  properties: {
    visibleFacts: { type: "array", items: { type: "string" } },
    hiddenFacts: { type: "array", items: { type: "string" } },
    visibilityNotes: { type: "string" },
    perCharacter: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["characterId", "characterName", "targetCharacterId", "targetCharacterName", "knownFacts", "falseBeliefs", "withheldFacts", "blindSpots", "suspectedSecrets", "possibleVisibilityFlips"],
        properties: {
          characterId: { type: "string" },
          characterName: { type: "string" },
          targetCharacterId: { type: "string" },
          targetCharacterName: { type: "string" },
          knownFacts: { type: "array", items: { type: "string" } },
          falseBeliefs: { type: "array", items: { type: "string" } },
          withheldFacts: { type: "array", items: { type: "string" } },
          blindSpots: { type: "array", items: { type: "string" } },
          suspectedSecrets: { type: "array", items: { type: "string" } },
          possibleVisibilityFlips: { type: "array", items: { type: "string" } }
        }
      }
    }
  }
};

export const sceneInteractionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["surfaceEvent", "sceneText", "sceneThesis", "interactionBeats", "agentExchanges", "presenceChanges", "remainingCastAftermath", "misunderstandings", "reversals", "visibilityFlips", "relationshipMutationIntents", "evidenceCreated", "rumorCreated", "memoryDistortions", "irreversibleTraces", "subtextMatrix", "relationshipShift", "directorNotes", "simulationNotes"],
  properties: {
    surfaceEvent: { type: "string" },
    sceneText: { type: "string" },
    sceneThesis: { type: "string" },
    directorNotes: { type: "string" },
    simulationNotes: { type: "array", items: { type: "string" } },
    interactionBeats: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["actorId", "actorName", "targetId", "targetName", "beat", "privateIntent", "defensiveMask", "shadowLeak"],
        properties: {
          actorId: { type: "string" },
          actorName: { type: "string" },
          targetId: { type: "string" },
          targetName: { type: "string" },
          beat: { type: "string" },
          privateIntent: { type: "string" },
          defensiveMask: { type: "string" },
          shadowLeak: { type: "string" }
        }
      }
    },
    agentExchanges: { type: "array", items: agentExchangeSchema },
    presenceChanges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["characterId", "characterName", "decision", "departureAfterTurn", "destinationId", "destinationName", "trigger", "visibleDeparture"],
        properties: {
          characterId: { type: "string" },
          characterName: { type: "string" },
          decision: { type: "string", enum: ["stay", "leave", "blocked"] },
          departureAfterTurn: { type: "number" },
          destinationId: { type: "string" },
          destinationName: { type: "string" },
          trigger: { type: "string" },
          visibleDeparture: { type: "string" }
        }
      }
    },
    remainingCastAftermath: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["characterIds", "beat", "dialogue"],
        properties: {
          characterIds: { type: "array", items: { type: "string" } },
          beat: { type: "string" },
          dialogue: { type: "string" }
        }
      }
    },
    misunderstandings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fromCharacterId", "toCharacterId", "misunderstanding", "falseCertainty"],
        properties: {
          fromCharacterId: { type: "string" },
          toCharacterId: { type: "string" },
          misunderstanding: { type: "string" },
          falseCertainty: { type: "string" }
        }
      }
    },
    reversals: { type: "array", items: { type: "string" } },
    visibilityFlips: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["characterId", "characterName", "blindSpot", "possibleExposure"],
        properties: {
          characterId: { type: "string" },
          characterName: { type: "string" },
          blindSpot: { type: "string" },
          possibleExposure: { type: "string" }
        }
      }
    },
    relationshipMutationIntents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fromCharacterId", "toCharacterId", "mutation", "expectedDelta"],
        properties: {
          fromCharacterId: { type: "string" },
          toCharacterId: { type: "string" },
          mutation: { type: "string" },
          expectedDelta: { type: "string" }
        }
      }
    },
    evidenceCreated: { type: "array", items: { type: "string" } },
    rumorCreated: { type: "array", items: { type: "string" } },
    memoryDistortions: { type: "array", items: { type: "string" } },
    irreversibleTraces: { type: "array", items: { type: "string" } },
    subtextMatrix: directorSchema.properties.subtextMatrix,
    relationshipShift: directorSchema.properties.relationshipShift
  }
};

export const repairedDraftSchema = {
  type: "object",
  additionalProperties: false,
  required: ["surfaceEvent", "sceneText", "agentOutputs", "subtextMatrix", "relationshipShift", "irreversibleTraces", "repairNotes"],
  properties: {
    surfaceEvent: { type: "string" },
    sceneText: { type: "string" },
    agentOutputs: { type: "array", items: agentOutputSchema },
    subtextMatrix: directorSchema.properties.subtextMatrix,
    relationshipShift: directorSchema.properties.relationshipShift,
    irreversibleTraces: { type: "array", items: { type: "string" } },
    repairNotes: { type: "string" }
  }
};

export const depthAuditSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "flatCharacterRisk",
    "safeClosureRisk",
    "singleMotivationRisk",
    "moralRepairBias",
    "irreversibleConsequenceScore",
    "multiMotivationScore",
    "relationshipMutualContaminationScore",
    "memoryPressureScore",
    "memoryChangedActionScore",
    "memoryConflictScore",
    "memorySelfRevisionScore",
    "ignoredMemoryRisk",
    "singleMemoryRisk",
    "memoryUseRisk",
    "activeMemoryCount",
    "highRiskMemoryCount",
    "planUseScore",
    "planRisk",
    "activePlanCount",
    "highPressurePlanCount",
    "realtimeSimulationScore",
    "realtimeSimulationRisk",
    "visibilityScore",
    "avgContradiction",
    "privateSimulationCount",
    "warnings",
    "requiredFixes",
    "repairNeeded",
    "repairBrief"
  ],
  properties: {
    flatCharacterRisk: { type: "number" },
    safeClosureRisk: { type: "number" },
    singleMotivationRisk: { type: "number" },
    moralRepairBias: { type: "number" },
    irreversibleConsequenceScore: { type: "number" },
    multiMotivationScore: { type: "number" },
    relationshipMutualContaminationScore: { type: "number" },
    memoryPressureScore: { type: "number" },
    memoryChangedActionScore: { type: "number" },
    memoryConflictScore: { type: "number" },
    memorySelfRevisionScore: { type: "number" },
    ignoredMemoryRisk: { type: "number" },
    singleMemoryRisk: { type: "number" },
    memoryUseRisk: { type: "number" },
    activeMemoryCount: { type: "number" },
    highRiskMemoryCount: { type: "number" },
    planUseScore: { type: "number" },
    planRisk: { type: "number" },
    activePlanCount: { type: "number" },
    highPressurePlanCount: { type: "number" },
    realtimeSimulationScore: { type: "number" },
    realtimeSimulationRisk: { type: "number" },
    visibilityScore: { type: "number" },
    avgContradiction: { type: "number" },
    privateSimulationCount: { type: "number" },
    warnings: { type: "array", items: { type: "string" } },
    requiredFixes: { type: "array", items: { type: "string" } },
    repairNeeded: { type: "boolean" },
    repairBrief: { type: "string" }
  }
};

export const privateSimulationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "characterId",
    "targetCharacterId",
    "tone",
    "publicGoal",
    "privateDesire",
    "defensiveMask",
    "shadowImpulse",
    "nobleImpulse",
    "selfLie",
    "actionCandidate",
    "wantsFromOthers",
    "refusesToAdmit",
    "riskCreated",
    "falseBeliefs",
    "withheldFacts",
    "pressure",
    "contradictionScore",
    "currentActivity",
    "activityDurationTicks",
    "reactionIntent",
    "reactionTargetCharacterId",
    "reactionReason",
    "conversationObjective",
    "conversationEndCondition",
    "presenceIntent",
    "exitUrgency",
    "exitResistance",
    "exitTrigger",
    "exitReason",
    "desiredDestinationId",
    "departureMethod"
  ],
  properties: {
    characterId: { type: "string" },
    targetCharacterId: { type: "string" },
    tone: { type: "string", enum: ["惩罚", "接近", "伪装", "保护", "试探", "自毁", "共谋", "陷害", "撤退", "求证"] },
    publicGoal: { type: "string" },
    privateDesire: { type: "string" },
    defensiveMask: { type: "string" },
    shadowImpulse: { type: "string" },
    nobleImpulse: { type: "string" },
    selfLie: { type: "string" },
    actionCandidate: { type: "string" },
    wantsFromOthers: { type: "string" },
    refusesToAdmit: { type: "string" },
    riskCreated: { type: "string" },
    memoryId: { type: "string" },
    memoryInfluence: { type: "string" },
    memoryDistortionAction: { type: "string" },
    planId: { type: "string" },
    planInfluence: { type: "string" },
    planNextAction: { type: "string" },
    planStatus: { type: "string" },
    falseBeliefs: { type: "array", items: { type: "string" } },
    withheldFacts: { type: "array", items: { type: "string" } },
    pressure: { type: "number" },
    contradictionScore: { type: "number" },
    currentActivity: { type: "string" },
    activityDurationTicks: { type: "number" },
    reactionIntent: { type: "string", enum: ["continue", "talk", "respond", "wait", "leave"] },
    reactionTargetCharacterId: { type: "string" },
    reactionReason: { type: "string" },
    conversationObjective: { type: "string" },
    conversationEndCondition: { type: "string" },
    presenceIntent: { type: "string", enum: ["stay", "leave"] },
    exitUrgency: { type: "number" },
    exitResistance: { type: "number" },
    exitTrigger: { type: "string" },
    exitReason: { type: "string" },
    desiredDestinationId: { type: "string" },
    departureMethod: { type: "string" },
    unadmittedPleasure: { type: "string" },
    postActionSelfPunishment: { type: "string" }
  }
};

export const visibilityLayerModelSchema = visibilityLayerSchema;
export const sceneInteractionModelSchema = sceneInteractionSchema;
