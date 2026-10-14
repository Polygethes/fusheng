import { createId } from "../../data/seed.js";
import { callOpenAIJson } from "./responseClient.mjs";
import {
  applyTavernCausalAffordance,
  buildTavernSituatedServiceChoice,
  listTavernCausalAffordances,
  nextTavernServiceProcessReadyAtElapsedSeconds,
  tavernCausalMaterialFacts,
  tavernPublicVisitPresenceCue,
  tavernRestoredVisitorZone,
  tavernSettledInteractionEvents,
  tavernVisitPurposeSpeechIsConcrete,
} from "./tavernCausalEconomy.mjs";
import {
  interactionForResponder,
  latestAwaitingInteraction,
  recordInteractionPass,
  resolveInteraction,
  unresolvedInteractions,
} from "../simulation/interactionScheduler.mjs";
import {
  characterEventEvidenceRecords,
  createCharacterEventReceiptLedger,
  deliveryQualifiesAsNewExternalImpact,
  markCharacterEvidenceAppraised,
  markCharacterEvidenceConsumed,
  markCharacterEvidenceNoticed,
  registerCharacterEventDelivery,
} from "../simulation/characterEventReceipts.mjs";
import {
  conversationalSpeechAllowed,
  perceiveEntity,
} from "../simulation/spatialPerception.mjs";
import {
  buildCharacterPerceptionFrame,
  normalizeCharacterPerceptionProfile,
  normalizeWorldSignalFeature,
  validateWorldSignalFeature,
} from "../simulation/characterPerception.mjs";
import {
  generateEpistemicActionCandidates,
  scoreEpistemicActionCandidates,
} from "../simulation/epistemicActionUtility.mjs";
import {
  applyObjectOperations,
  normalizeObjectLedger,
  objectPublicPerceptionLabel,
  objectVisibleToObserver,
  relocateHeldObjects,
  validatePossessionClaims,
} from "../simulation/objectLedger.mjs";
import { deriveDesireSatisfactionEffects } from "../simulation/desireSatisfaction.mjs";
import { offeringServiceKind } from "../simulation/materialEconomy.mjs";
import { normalizeOfferingSustenance } from "../simulation/cultivationSustenance.mjs";
import {
  characterPostChoiceContinuityProposalSchema,
  settleCharacterPostChoiceContinuity,
  validateCharacterPostChoiceContinuityProposal,
} from "../simulation/characterPostChoiceContinuity.mjs";
import {
  normalizeObjectiveSocialFacts,
} from "../simulation/characterSocialAppraisal.mjs";
import {
  getTavernEcologyProfile,
  TAVERN_SCENE_ID,
} from "../ecology/tavernEcologyProfile.mjs";
import { TAVERN_ZONE_VOCABULARY } from "../ecology/tavernZoneVocabulary.mjs";
import {
  buildValidatedAnchorCandidateGuidance,
  findValidatedCharacterAnchorRuntime,
  mergeValidatedCharacterAnchorMemoryState,
} from "../ecology/validatedCharacterAnchorRuntime.mjs";
import { validateSemanticTurn } from "../../engine/semanticTurnValidator.js";
import {
  advanceCharacterAgentMemory,
  applyCharacterCognitiveAppraisal,
  applyCharacterLocationBeliefUpdate,
  applyCharacterMemoryOutcome,
  applyCharacterPrivateEntityModelUpdate,
  applyCharacterSourceKnowledgeBeliefUpdate,
  buildCharacterEpistemicBeliefState,
  createCharacterAgentMemoryState,
  encodeCharacterPerception,
  memoryInfluenceForCandidate,
  normalizeCharacterAgentMemoryState,
  normalizeSemanticFrame,
  reconstructCharacterAgentMemory,
  validateSemanticRoleBinding,
} from "../../engine/characterAgentMemory.js";
import {
  appraiseTavernAgentEcology,
  bindTavernAgentEcologyChoice,
  ecologyAgentCandidateBundle,
  ecologyDecisionSummary,
  ensureTavernEcology,
} from "./tavernEcologyRuntime.mjs";
import { applyTavernEcologyOutcome } from "./tavernEcologyOutcome.mjs";
import {
  advanceTavernEcologyTime,
  appraiseTavernPerceivedEvent,
} from "../ecology/tavernEventAppraisal.mjs";
import {
  applyDirectionalRelationshipDelta,
  deriveRelationshipDeltas,
  getDirectedRelationship,
  noOpTavernCharacterRelationshipAppraisal,
  tavernCharacterRelationshipAppraisalSchema,
  tavernRelationshipDeltasFromCharacterAppraisal,
  TAVERN_RELATIONSHIP_METRICS,
  validateTavernCharacterRelationshipAppraisal,
} from "../ecology/tavernRelationshipDynamics.mjs";
import { getTavernAddressingRule } from "../ecology/tavernRelationshipSeeds.mjs";
import {
  buildTavernConversationalRealization,
  buildTavernVoiceContract,
  validateTavernVoiceRealization,
} from "./tavernCharacterVoice.mjs";
import {
  bridgeTavernCharacterAgentV2ResultForWorld,
  runTavernCharacterAgentTurnV2,
  runTavernCharacterAgentV2Stage,
} from "./tavernCharacterAgentV2.mjs";
import { attachCharacterAgentWorldOutcome } from "../simulation/characterAgentTurnProtocol.mjs";
import { advanceCharacterPsychologyCarryover } from "../simulation/characterPsychologyTools.mjs";
import { recordCommittedSpeechHabitUse } from "../simulation/characterVoiceHabits.mjs";
import { deriveCharacterSocialContext } from "../simulation/characterSocialContext.mjs";
import {
  projectAdjacentMovementOptions,
  resolvePlaceMovementAttempt,
} from "../simulation/placeMovementBoundary.mjs";
import {
  deriveCharacterDiscourseContext,
  mergeCharacterRecentOwnActions,
  seedCharacterOwnedOperationMemory,
} from "../simulation/characterOperationalContinuity.mjs";
import {
  applyCharacterSharedActivityResponse,
  createCharacterSharedActivityProposal,
  createScopedCharacterAccessGrant,
} from "../simulation/characterSharedActivity.mjs";

export { listTavernCausalAffordances } from "./tavernCausalEconomy.mjs";

const LOCATION_ID = "loc_xyy_tavern";
const ACTION_TYPES = new Set(["act", "speak", "move", "interact", "pass", "leave"]);
const SPEECH_ACTS = new Set(["none", "greet", "ask", "answer", "offer", "refuse", "negotiate", "warn", "gossip", "confide", "inform"]);
// Legacy vocabulary from the pre-causal agent runner, mapped onto the causal
// speech-act set so a drifted response is recovered instead of silenced.
const LEGACY_SPEECH_ACT_MAP = new Map([
  ["statement", "greet"],
  ["acknowledge", "greet"],
  ["reply", "answer"],
  ["confirm", "answer"],
  ["request", "ask"],
  ["question", "ask"],
]);
const COMMITMENT_ACTIONS = new Set(["none", "open", "fulfill", "defer", "drop"]);
const DECISION_VALUES = new Set(["none", "accept", "refuse", "defer"]);
const COGNITIVE_BELIEF_OPERATIONS = ["adopt", "revise", "doubt", "reject", "suspend"];
const COGNITIVE_REASONING_MODES = ["direct", "inference", "rumor", "guess", "confabulation"];
const CONFIDENCE_BANDS = ["low", "medium", "high"];
const COMMUNICATION_GOALS = [
  "none", "inform", "obtain_information", "conceal", "mislead", "tease", "provoke", "soothe", "buy_time", "end_exchange",
];
const COMMUNICATION_TACTICS = [
  "direct", "partial", "evade", "counter_question", "redirect", "lie", "bluff", "joke", "ignore", "silence",
];
const COMMUNICATION_DISCLOSURES = ["full", "partial", "withhold", "false", "mixed"];
const COMMUNICATION_EPISTEMIC_RELATIONS = [
  "believes", "doubts", "uncertain", "knows_false", "guessing", "misremembered", "confabulated", "not_applicable",
];
const QUESTION_PRESUPPOSITION_STANCES = [
  "not_applicable", "accept", "uncertain", "deliberate_probe", "deceptive", "misremembered", "confabulated",
];
const THREAD_DISPOSITIONS = ["settle", "refuse", "defer", "evade", "counter", "redirect", "ignore", "open_new", "none"];
const THREAD_INTERPRETATIONS = ["answered", "refused", "deferred", "evaded", "countered", "redirected", "ignored", "misunderstood", "unclear", "new_request", "not_applicable"];
const THREAD_SATISFACTION_STATES = ["satisfied", "unsatisfied", "uncertain", "not_applicable"];
const THREAD_RESPONSE_NEEDS = ["none", "low", "medium", "high"];
const THREAD_SELF_CLOSURES = ["open", "closed_for_self"];
const ACTION_ATTEMPT_PRIMITIVES = [
  "none", "speak", "observe", "listen", "gesture", "interact", "move", "leave", "rest", "practice",
  "use_affordance", "pickup", "take_out", "show", "hide", "store",
  "draw", "sheathe", "transfer", "place", "consume",
];
const TAVERN_OBJECT_CLAIM_ALIASES = Object.freeze([
  "碗筷", "饭碗", "茶碗", "筷子", "客房钥匙", "药包", "清单", "木剑", "短剑", "长剑", "包袱", "工具",
]);
const POSSESSION_ACTION_PATTERN = /(?:放下|递给|交给|收起|拔出|抽出|拿出|掏出|端起|捧起|提起|抱起|握住|挥动)/u;

function utteranceHasQuestionForm(speech = "") {
  const line = text(speech, 500);
  if (!line) return false;
  if (/[？?]/u.test(line)) return true;
  return /(?:吗|么|是不是|是否|谁|哪(?:位|里|儿|个)?|什么|为何|为什么|怎么|多少|几时|可有|有没有|能否|可否)(?:呢|啊|呀)?[。！!…]*$/u.test(line);
}

export function inferPublicSpeechFunctions({
  speech = "",
  speechAct = "none",
  speechFunctions = [],
} = {}) {
  if (!text(speech, 500)) return [];
  const functions = new Set((Array.isArray(speechFunctions) ? speechFunctions : [])
    .filter((speechFunction) => SPEECH_ACTS.has(speechFunction) && speechFunction !== "none"));
  if (SPEECH_ACTS.has(speechAct) && speechAct !== "none") functions.add(speechAct);
  if (utteranceHasQuestionForm(speech)) functions.add("ask");
  return [...functions];
}

function actionSpeechFunctions(action = {}) {
  return inferPublicSpeechFunctions(action);
}
// The remote/public Character Agent input must not carry the server's hidden
// identity map. Keep its canonical twin in-process and associate it by object
// identity; WeakMap entries cannot be serialized into the model request.
const CANONICAL_AGENT_INPUTS = new WeakMap();

export const TAVERN_SCENE_TOPOLOGY = {
  schemaVersion: 1,
  locationId: LOCATION_ID,
  defaultZoneId: "hall",
  standingDefaultZoneIds: {
    manager: "counter",
    proprietor: "hall",
    household_worker: "courtyard",
    lodging_guest: "guest_room",
  },
  responsibilityRules: [],
  zones: {
    threshold: { id: "threshold", label: "门槛", closed: false },
    hall: { id: "hall", label: "堂前", closed: false },
    counter: { id: "counter", label: "柜台", closed: false },
    stove: { id: "stove", label: "灶边", closed: false },
    courtyard: { id: "courtyard", label: "后院", closed: false },
    stairs: { id: "stairs", label: "楼梯口", closed: false },
    guest_room: { id: "guest_room", label: "楼上客房", closed: true },
  },
  edges: [
    { from: "threshold", to: "hall", move: 1, sound: 1, visual: 1, conversation: true },
    { from: "hall", to: "counter", move: 1, sound: 1, visual: 1, conversation: true },
    { from: "counter", to: "stove", move: 1, sound: 1, visual: 1 },
    { from: "hall", to: "courtyard", move: 1, sound: 1, visual: 1.25 },
    { from: "hall", to: "stairs", move: 1, sound: 1, visual: 1 },
    { from: "stairs", to: "guest_room", move: 1, sound: Infinity, visual: Infinity, barrier: "closed-door" },
  ],
};

export const tavernCharacterCognitiveAppraisalSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "noticedEvidenceIds",
    "interpretations",
    "beliefOperations",
    "entityModelUpdates",
    "locationBeliefUpdates",
    "sourceKnowledgeBeliefUpdates",
    "threadAppraisals",
  ],
  properties: {
    noticedEvidenceIds: { type: "array", items: { type: "string" } },
    interpretations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["evidenceIds", "meaning", "confidenceBand"],
        properties: {
          evidenceIds: { type: "array", items: { type: "string" } },
          meaning: { type: "string" },
          confidenceBand: { type: "string", enum: CONFIDENCE_BANDS },
        },
      },
    },
    beliefOperations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["proposition", "operation", "confidenceBand", "sourceEvidenceIds", "reasoningMode"],
        properties: {
          proposition: { type: "string" },
          operation: { type: "string", enum: COGNITIVE_BELIEF_OPERATIONS },
          confidenceBand: { type: "string", enum: CONFIDENCE_BANDS },
          sourceEvidenceIds: { type: "array", items: { type: "string" } },
          reasoningMode: { type: "string", enum: COGNITIVE_REASONING_MODES },
        },
      },
    },
    entityModelUpdates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "perceivedEntityHandle",
          "noticedEvidenceIds",
          "hypotheses",
          "identityCandidates",
          "affectiveResponse",
          "attentionPriority",
        ],
        properties: {
          perceivedEntityHandle: { type: "string" },
          noticedEvidenceIds: { type: "array", items: { type: "string" } },
          hypotheses: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["hypothesisId", "proposition", "operation", "confidenceBand", "basisEvidenceIds"],
              properties: {
                hypothesisId: { type: "string" },
                proposition: { type: "string" },
                operation: { type: "string", enum: COGNITIVE_BELIEF_OPERATIONS },
                confidenceBand: { type: "string", enum: CONFIDENCE_BANDS },
                basisEvidenceIds: { type: "array", items: { type: "string" } },
              },
            },
          },
          identityCandidates: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["knownEntityHandle", "operation", "confidenceBand", "basisEvidenceIds"],
              properties: {
                knownEntityHandle: { type: "string" },
                operation: { type: "string", enum: COGNITIVE_BELIEF_OPERATIONS },
                confidenceBand: { type: "string", enum: CONFIDENCE_BANDS },
                basisEvidenceIds: { type: "array", items: { type: "string" } },
              },
            },
          },
          affectiveResponse: {
            type: "object",
            additionalProperties: false,
            required: ["label", "valence", "arousal"],
            properties: {
              label: { type: "string" },
              valence: { type: "number", minimum: -1, maximum: 1 },
              arousal: { type: "number", minimum: 0, maximum: 1 },
            },
          },
          attentionPriority: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    locationBeliefUpdates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "subjectHandle",
          "locationHandle",
          "operation",
          "assertedLikelihood",
          "sourceReliability",
          "confidenceBand",
          "basisEvidenceIds",
          "sourceType",
        ],
        properties: {
          subjectHandle: { type: "string" },
          locationHandle: { type: "string" },
          operation: { type: "string", enum: ["revise", "decrease", "doubt", "reject", "suspend"] },
          assertedLikelihood: { type: "number", minimum: 0, maximum: 1 },
          sourceReliability: { type: "number", minimum: 0, maximum: 1 },
          confidenceBand: { type: "string", enum: CONFIDENCE_BANDS },
          basisEvidenceIds: { type: "array", items: { type: "string" } },
          sourceType: { type: "string" },
        },
      },
    },
    sourceKnowledgeBeliefUpdates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "sourceHandle",
          "subjectHandle",
          "operation",
          "assertedLikelihood",
          "sourceReliability",
          "confidenceBand",
          "basisEvidenceIds",
        ],
        properties: {
          sourceHandle: { type: "string" },
          subjectHandle: { type: "string" },
          operation: { type: "string", enum: ["revise", "decrease", "doubt", "reject", "suspend"] },
          assertedLikelihood: { type: "number", minimum: 0, maximum: 1 },
          sourceReliability: { type: "number", minimum: 0, maximum: 1 },
          confidenceBand: { type: "string", enum: CONFIDENCE_BANDS },
          basisEvidenceIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    threadAppraisals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["threadId", "sourceTurnId", "interpretation", "satisfaction", "responseNeed", "selfClosure", "summary"],
        properties: {
          threadId: { type: "string" },
          sourceTurnId: { type: "string" },
          interpretation: { type: "string", enum: THREAD_INTERPRETATIONS },
          satisfaction: { type: "string", enum: THREAD_SATISFACTION_STATES },
          responseNeed: { type: "string", enum: THREAD_RESPONSE_NEEDS },
          selfClosure: { type: "string", enum: THREAD_SELF_CLOSURES },
          summary: { type: "string" },
        },
      },
    },
  },
};

export const tavernCharacterCommunicationPlanSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "goal",
    "tactic",
    "disclosure",
    "epistemicRelation",
    "intendedAudienceCharacterIds",
    "desiredEffect",
    "threadDisposition",
    "epistemicActionCandidateId",
    "presuppositionStance",
    "epistemicBasisEvidenceIds",
  ],
  properties: {
    goal: { type: "string", enum: COMMUNICATION_GOALS },
    tactic: { type: "string", enum: COMMUNICATION_TACTICS },
    disclosure: { type: "string", enum: COMMUNICATION_DISCLOSURES },
    epistemicRelation: { type: "string", enum: COMMUNICATION_EPISTEMIC_RELATIONS },
    intendedAudienceCharacterIds: { type: "array", items: { type: "string" } },
    desiredEffect: { type: "string" },
    threadDisposition: { type: "string", enum: THREAD_DISPOSITIONS },
    epistemicActionCandidateId: {
      type: "string",
      description: "若这句话借回应提出了关于本人未决信息目标的新问题，填写 epistemicDecisionSupport 中实际采用的候选 id；普通寒暄、服务确认、反问或不提问时为空",
    },
    presuppositionStance: {
      type: "string",
      enum: QUESTION_PRESUPPOSITION_STANCES,
      description: "本人如何对待所选问题自带的前提；前提不足仍可故意试探、撒谎或记错，但必须属于人物自己的取舍",
    },
    epistemicBasisEvidenceIds: {
      type: "array",
      items: { type: "string" },
      description: "支撑本人采用该询问前提的 noticed/memory evidence；没有证据而故意试探、欺骗、误记时可以为空",
    },
  },
};

export const tavernCharacterUtteranceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["literalSpeech", "vocalMode"],
  properties: {
    literalSpeech: { type: "string", description: "人物实际发出的字句；沉默时为空" },
    vocalMode: { type: "string", enum: ["conversational", "call_out"], description: "声音的实际发出方式" },
  },
};

export const tavernCharacterSpeechRealizationPlanSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "mustConvey",
    "mayReveal",
    "withhold",
    "desiredListenerEffect",
    "subtext",
    "relationshipRegister",
    "timing",
    "appliedVoiceParameters",
    "intentionalDepartureReason",
    "minimumSufficiency",
    "selfCheck",
  ],
  properties: {
    mustConvey: { type: "array", items: { type: "string" }, description: "若这次不说就无法完成已选行动的最少公开语义；沉默时可为空" },
    mayReveal: { type: "array", items: { type: "string" }, description: "本人愿意顺带泄露的判断、情绪或关系态度" },
    withhold: { type: "array", items: { type: "string" }, description: "本人决定继续留在心里的真实动机或信息" },
    desiredListenerEffect: { type: "string", description: "本人希望听者理解、回答、退让、相信、误判或暂不追问什么" },
    subtext: { type: "string", description: "说出口内容之下由动作、停顿、关系与省略承载的意思" },
    relationshipRegister: { type: "string", description: "本轮实际采用的关系距离与称呼语域，不是作者标签" },
    timing: {
      type: "string",
      enum: ["before_action", "during_action", "after_action", "standalone", "delayed", "silence"],
      description: "这句话相对于本轮身体动作发生的时机",
    },
    appliedVoiceParameters: {
      type: "object",
      additionalProperties: false,
      required: ["directness", "compression", "warmth", "reserve", "formality", "emotionalLeakage"],
      properties: {
        directness: { type: "number", minimum: 0, maximum: 1 },
        compression: { type: "number", minimum: 0, maximum: 1 },
        warmth: { type: "number", minimum: 0, maximum: 1 },
        reserve: { type: "number", minimum: 0, maximum: 1 },
        formality: { type: "number", minimum: 0, maximum: 1 },
        emotionalLeakage: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    intentionalDepartureReason: { type: "string", description: "若本人有意偏离心理工具给出的倾向，说明当下策略原因；没有则为空" },
    minimumSufficiency: {
      type: "object",
      additionalProperties: false,
      required: [
        "listenerCanRespondAfterMustConvey",
        "additionalPublicExplanationServesChosenAction",
        "additionalPublicExplanationPurpose",
        "explanationsKeptPrivate",
      ],
      properties: {
        listenerCanRespondAfterMustConvey: {
          type: "boolean",
          description: "只公开 mustConvey 后，听者是否已经拥有足够信息作出下一步回应或行动",
        },
        additionalPublicExplanationServesChosenAction: {
          type: "boolean",
          description: "mustConvey 之外的公开解释是否确实承担已选行动中的说服、警告、教导、修复、欺骗、挑衅等具体功能",
        },
        additionalPublicExplanationPurpose: {
          type: "string",
          description: "额外公开解释在已选行动中承担的具体功能；没有则为空，展示人格或讲清本人原则不算功能",
        },
        explanationsKeptPrivate: {
          type: "array",
          items: { type: "string" },
          description: "与局面有关但本轮不必公开的判断原则、理由链或自我解释，留作潜台词与后续行动依据",
        },
      },
    },
    selfCheck: {
      type: "object",
      additionalProperties: false,
      required: [
        "soundsLikePrivateSummary",
        "interchangeableAcrossCharacters",
        "repeatsWhatActionAlreadyShows",
        "containsUnnecessaryExplanatoryTail",
      ],
      properties: {
        soundsLikePrivateSummary: { type: "boolean" },
        interchangeableAcrossCharacters: { type: "boolean" },
        repeatsWhatActionAlreadyShows: { type: "boolean" },
        containsUnnecessaryExplanatoryTail: { type: "boolean" },
      },
    },
  },
};

export const tavernCharacterEmbodiedIntentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["manner", "posture", "intendedGesture"],
  properties: {
    manner: { type: "string", description: "人物想以怎样的身体方式行动，不预写成功结果" },
    posture: { type: "string", description: "行动前本人采用或维持的身体姿态" },
    intendedGesture: { type: "string", description: "本人打算做出的可见动作；世界会另行裁决是否发生" },
  },
};

export const tavernCharacterActionAttemptSchema = {
  type: "object",
  additionalProperties: false,
  required: ["primitive", "objectId", "targetCharacterId", "destinationId", "affordanceId"],
  properties: {
    primitive: { type: "string", enum: ACTION_ATTEMPT_PRIMITIVES },
    objectId: { type: "string" },
    targetCharacterId: { type: "string" },
    destinationId: { type: "string" },
    affordanceId: { type: "string" },
  },
};

export const tavernCausalAgentDecisionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "candidateId", "actionType", "speechAct", "speechFunctions", "targetCharacterId", "speech", "visibleAction",
    "moveToZoneId", "vocalMode", "affordanceId", "informationSourceImpactId", "commitmentAction", "commitmentTopic", "decisionValue", "semanticFrameId", "semanticRoleBindings", "cognitiveAppraisal", "communicationPlan", "speechRealizationPlan", "utterance", "embodiedIntent", "actionAttempt", "privateReason", "relationshipAppraisal", "postChoiceContinuity",
  ],
  properties: {
    candidateId: { type: "string", description: "从 privateActionCandidates 中由本人选出的一个可行候选 id" },
    actionType: { type: "string", enum: [...ACTION_TYPES] },
    speechAct: { type: "string", enum: [...SPEECH_ACTS] },
    speechFunctions: {
      type: "array",
      items: { type: "string", enum: [...SPEECH_ACTS].filter((speechFunction) => speechFunction !== "none") },
      description: "这句公开话实际承担的全部功能；例如先回答再反问时填写 answer 与 ask。无台词时为空数组。",
    },
    targetCharacterId: { type: "string" },
    speech: { type: "string", description: "人物真正说出口的话；不说话时为空" },
    visibleAction: { type: "string", description: "他人可以看见的一个身体动作；不写心理" },
    observableAffectiveTexture: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["channel", "modality", "feature"],
        properties: {
          channel: { type: "string" },
          modality: { type: "string", enum: ["visual", "sound", "touch", "smell"] },
          feature: { type: "string" },
        },
      },
      description: "人物已经选择公开实现、且他人可能感知到的停顿、视线、呼吸、声音或动作质感；不得包含私有动机解释",
    },
    moveToZoneId: { type: "string", description: "移动目标 zone；不移动时为空" },
    vocalMode: { type: "string", enum: ["conversational", "call_out"], description: "普通交谈或明确向相邻区域喊话" },
    affordanceId: { type: "string", description: "执行 availableAffordances 中的经营动作时填写其 id；普通动作时为空" },
    informationSourceImpactId: { type: "string", description: "转述或八卦时引用本人确实感知过的信息 impact id" },
    commitmentAction: { type: "string", enum: [...COMMITMENT_ACTIONS] },
    commitmentTopic: { type: "string" },
    decisionValue: { type: "string", enum: [...DECISION_VALUES], description: "只在本人明确作出接受、拒绝或延期决定时填写；其他行动为 none" },
    semanticFrameId: { type: "string", description: "候选含 semanticFrame 时原样填写其 id；没有时为空" },
    semanticRoleBindings: { type: "object", additionalProperties: { type: "string" }, description: "候选含 semanticFrame 时原样复述其中 roles；没有时为空对象" },
    cognitiveAppraisal: tavernCharacterCognitiveAppraisalSchema,
    communicationPlan: tavernCharacterCommunicationPlanSchema,
    speechRealizationPlan: tavernCharacterSpeechRealizationPlanSchema,
    utterance: tavernCharacterUtteranceSchema,
    embodiedIntent: tavernCharacterEmbodiedIntentSchema,
    actionAttempt: tavernCharacterActionAttemptSchema,
    privateReason: { type: "string", description: "只属于本人、不对其他 Agent 公开的决定原因" },
    relationshipAppraisal: tavernCharacterRelationshipAppraisalSchema,
    postChoiceContinuity: characterPostChoiceContinuityProposalSchema,
  },
};

function deepClone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}

function text(value = "", max = 220) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function observableAffectiveTexture(value = []) {
  const rows = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    const feature = text(typeof raw === "string" ? raw : raw?.feature, 180);
    if (!feature) continue;
    const channel = text(typeof raw === "string" ? "legacy_unspecified" : raw?.channel, 80) || "unspecified";
    const proposedModality = text(typeof raw === "string" ? "visual" : raw?.modality, 40);
    const modality = ["visual", "sound", "touch", "smell"].includes(proposedModality)
      ? proposedModality
      : "visual";
    const key = `${channel}:${modality}:${feature}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ channel, modality, feature });
    if (rows.length >= 4) break;
  }
  return rows;
}

function tavernPossessionClaims(visibleAction = "") {
  const line = text(visibleAction, 220);
  if (!line || !POSSESSION_ACTION_PATTERN.test(line)) return [];
  return TAVERN_OBJECT_CLAIM_ALIASES
    .filter((alias) => line.includes(alias))
    .map((objectAlias, claimIndex) => ({ claimIndex, objectAlias, requiresPossession: true }));
}

function stableImpactId(prefix = "impact", ...parts) {
  let hash = 2166136261;
  for (const character of parts.map((part) => String(part ?? "")).join("|")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}:${(hash >>> 0).toString(36)}`;
}

function replaceIdentityReferences(value, replacements = new Map()) {
  if (!replacements.size) return deepClone(value);
  const ordered = [...replacements.entries()].sort((left, right) => right[0].length - left[0].length);
  const replaceString = (source = "") => {
    let next = String(source);
    for (const [from, to] of ordered) {
      if (from) next = next.split(from).join(to);
    }
    return next;
  };
  const visit = (row) => {
    if (typeof row === "string") return replaceString(row);
    if (Array.isArray(row)) return row.map(visit);
    if (!row || typeof row !== "object") return row;
    return Object.fromEntries(Object.entries(row).map(([key, child]) => [replaceString(key), visit(child)]));
  };
  return visit(value);
}

function redactUnrecognizedIdentityNames(value, replacements = new Map()) {
  if (!replacements.size) return value;
  const ordered = [...replacements.entries()].sort((left, right) => right[0].length - left[0].length);
  const literalSpeechKeys = new Set([
    "speech",
    "utterance",
    "literalSpeech",
    "responseSourceLine",
    "publicSpeech",
    "proposedSpeech",
    // This field is derived only from literal public turns. Hearing somebody
    // say a name does not prove who they are, but the name itself must not be
    // rewritten into the listener's generic visual role.
    "mentionedCharacterNames",
  ]);
  const replaceString = (source = "") => {
    let next = String(source);
    for (const [from, to] of ordered) {
      if (from) next = next.split(from).join(to);
    }
    return next;
  };
  const visit = (row, key = "", parent = null) => {
    if (typeof row === "string") {
      const literalContent = key === "content" && ["speech", "information"].includes(parent?.type);
      const heardContent = key === "content" && ["sound", "hearing", "direct_speech"].includes(parent?.modality);
      const heardFeature = key === "feature" && ["sound", "hearing", "direct_speech"].includes(parent?.modality);
      return literalSpeechKeys.has(key) || literalContent || heardContent || heardFeature ? row : replaceString(row);
    }
    if (Array.isArray(row)) return row.map((child) => visit(child, key, parent));
    if (!row || typeof row !== "object") return row;
    return Object.fromEntries(Object.entries(row).map(([childKey, child]) => [childKey, visit(child, childKey, row)]));
  };
  return visit(value);
}

function identityReferenceMaps(state = {}, runtime = {}, actorId = "") {
  const perceptualCanonicalToProjected = new Map();
  const epistemicCanonicalToProjected = new Map();
  const perceptualHiddenNameToRole = new Map();
  const epistemicHiddenNameToRole = new Map();
  const hiddenCharacterIds = new Set();
  const actor = characterById(state, actorId) || {};
  const anchorRuntime = validatedSceneRuntimeFor(actor);
  const knownByNameCharacterIds = new Set(
    (anchorRuntime?.characterFoundation?.epistemics?.knownEntities || [])
      .filter((row) => row?.knowsName === true && row?.recognizesIdentity !== true)
      .map((row) => row.entityId)
      .filter(Boolean),
  );
  for (const knownCharacterId of knownByNameCharacterIds) {
    epistemicCanonicalToProjected.set(
      knownCharacterId,
      stableImpactId("known_entity", actorId, knownCharacterId),
    );
    const identifierSlug = knownCharacterId.split("_").filter(Boolean).at(-1) || "";
    if (identifierSlug.length >= 5) {
      epistemicCanonicalToProjected.set(
        identifierSlug,
        stableImpactId("known_slug", actorId, knownCharacterId),
      );
    }
  }
  for (const other of Object.values(runtime.agents || {})) {
    if (!other?.characterId || other.characterId === actorId) continue;
    if (identityIsKnown(state, actorId, other.characterId)) continue;
    hiddenCharacterIds.add(other.characterId);
    const knowsNameWithoutRecognizing = knownByNameCharacterIds.has(other.characterId);
    perceptualCanonicalToProjected.set(
      other.characterId,
      stableImpactId("perceived_entity", actorId, other.characterId),
    );
    epistemicCanonicalToProjected.set(
      other.characterId,
      stableImpactId(knowsNameWithoutRecognizing ? "known_entity" : "perceived_entity", actorId, other.characterId),
    );
    const identifierSlug = other.characterId.split("_").filter(Boolean).at(-1) || "";
    if (identifierSlug.length >= 5) {
      perceptualCanonicalToProjected.set(
        identifierSlug,
        stableImpactId("perceived_slug", actorId, other.characterId),
      );
      epistemicCanonicalToProjected.set(
        identifierSlug,
        stableImpactId(knowsNameWithoutRecognizing ? "known_slug" : "perceived_slug", actorId, other.characterId),
      );
    }
    if (other.characterName) {
      perceptualHiddenNameToRole.set(other.characterName, unknownVisibleRole(other));
      if (!knowsNameWithoutRecognizing) {
        epistemicHiddenNameToRole.set(other.characterName, unknownVisibleRole(other));
      }
    }
  }
  for (const object of Object.values(state.tavernState?.objectLedger?.objects || {})) {
    const holderActorId = object.holderActorId || object.initialHolderActorId || object.attachment?.actorId || "";
    if (!object.id || !hiddenCharacterIds.has(holderActorId)) continue;
    const knowsHolderByName = knownByNameCharacterIds.has(holderActorId);
    perceptualCanonicalToProjected.set(object.id, stableImpactId("perceived_object", actorId, object.id));
    epistemicCanonicalToProjected.set(
      object.id,
      stableImpactId(knowsHolderByName ? "known_object" : "perceived_object", actorId, object.id),
    );
  }
  const projectedToCanonical = new Map([
    ...perceptualCanonicalToProjected.entries(),
    ...epistemicCanonicalToProjected.entries(),
  ].map(([canonical, projected]) => [projected, canonical]));
  return {
    perceptualCanonicalToProjected,
    epistemicCanonicalToProjected,
    projectedToCanonical,
    perceptualHiddenNameToRole,
    epistemicHiddenNameToRole,
    knownByNameCharacterIds,
    epistemicProjectedIds: new Set(epistemicCanonicalToProjected.values()),
  };
}

function mergeProjectedActionCandidate(perceptualCandidate = {}, epistemicCandidate = {}) {
  const merged = deepClone(perceptualCandidate);
  const informationSeeking = epistemicCandidate.candidateClass === "epistemic";
  if (informationSeeking) {
    for (const key of ["candidateId", "candidateClass", "driveId", "label", "desire", "actionKind"]) {
      if (Object.hasOwn(epistemicCandidate, key)) merged[key] = deepClone(epistemicCandidate[key]);
    }
    if (epistemicCandidate.semanticFrame) {
      const semantic = deepClone(epistemicCandidate.semanticFrame);
      const physicalRoles = perceptualCandidate.semanticFrame?.roles || {};
      semantic.roles = {
        ...(semantic.roles || {}),
        ...(physicalRoles.actor ? { actor: physicalRoles.actor } : {}),
        ...(physicalRoles.addressee ? { addressee: physicalRoles.addressee } : {}),
      };
      merged.semanticFrame = semantic;
    }
    if (epistemicCandidate.realization?.ownedClaimReference) {
      merged.realization = {
        ...(merged.realization || {}),
        ownedClaimReference: deepClone(epistemicCandidate.realization.ownedClaimReference),
        wordingAuthority: epistemicCandidate.realization.wordingAuthority || "character-agent",
      };
    }
    if (epistemicCandidate.ownDecisionFactors) {
      merged.ownDecisionFactors = { ...(merged.ownDecisionFactors || {}) };
      for (const key of ["desirePressure", "obstacleResistance", "intentionContinuity", "factorLedger"]) {
        if (Object.hasOwn(epistemicCandidate.ownDecisionFactors, key)) {
          merged.ownDecisionFactors[key] = deepClone(epistemicCandidate.ownDecisionFactors[key]);
        }
      }
    }
  }
  const epistemicDrive = epistemicCandidate.actionKind === "pursue_desired_state"
    || String(epistemicCandidate.candidateId || "").startsWith("desire:")
    || String(epistemicCandidate.driveId || "").startsWith("desire_");
  if (epistemicDrive) {
    for (const key of [
      "candidateId",
      "driveId",
      "label",
      "desire",
      "copingBias",
      "expressionStrategy",
      "semanticFrame",
      "blockedBy",
    ]) {
      if (Object.hasOwn(epistemicCandidate, key)) merged[key] = deepClone(epistemicCandidate[key]);
    }
    // A desire belongs to the character's epistemic model: its name, target,
    // pressure and semantic topic must continue to refer to the person known
    // from memory/hearsay.  Physical listeners, affordances and observation
    // sources still come from the perceptual projection below.  Replacing the
    // whole candidate would silently turn a merely perceived stranger into the
    // known target; keeping the whole perceptual candidate would do the reverse
    // and rewrite the desire itself as being about "the tavern worker".
    if (epistemicCandidate.realization) {
      merged.realization = { ...(merged.realization || {}) };
      for (const key of ["commitmentTopic", "visibleActionHint"]) {
        if (Object.hasOwn(epistemicCandidate.realization, key)) {
          merged.realization[key] = deepClone(epistemicCandidate.realization[key]);
        }
      }
    }
    if (epistemicCandidate.ownDecisionFactors) {
      merged.ownDecisionFactors = { ...(merged.ownDecisionFactors || {}) };
      for (const key of ["desirePressure", "obstacleResistance", "intentionContinuity"]) {
        if (Object.hasOwn(epistemicCandidate.ownDecisionFactors, key)) {
          merged.ownDecisionFactors[key] = deepClone(epistemicCandidate.ownDecisionFactors[key]);
        }
      }
    }
  }
  if (epistemicCandidate.ownDecisionFactors?.anchorGuidance) {
    merged.ownDecisionFactors = {
      ...(merged.ownDecisionFactors || {}),
      anchorGuidance: deepClone(epistemicCandidate.ownDecisionFactors.anchorGuidance),
    };
  }
  return merged;
}

function projectAgentInputIdentityReferences(canonicalInput = {}, state = {}, runtime = {}) {
  const actorId = canonicalInput.agent?.id || "";
  const {
    perceptualCanonicalToProjected,
    epistemicCanonicalToProjected,
    projectedToCanonical,
    perceptualHiddenNameToRole,
    epistemicHiddenNameToRole,
  } = identityReferenceMaps(state, runtime, actorId);
  const authoritativeInput = replaceIdentityReferences(canonicalInput, projectedToCanonical);
  const perceptualProjection = redactUnrecognizedIdentityNames(
    replaceIdentityReferences(authoritativeInput, perceptualCanonicalToProjected),
    perceptualHiddenNameToRole,
  );
  const epistemicProjection = redactUnrecognizedIdentityNames(
    replaceIdentityReferences(authoritativeInput, epistemicCanonicalToProjected),
    epistemicHiddenNameToRole,
  );
  const projected = deepClone(epistemicProjection);
  projected.agent = {
    ...projected.agent,
    attentionTargetId: perceptualProjection.agent?.attentionTargetId || "",
    relationshipContext: deepClone(perceptualProjection.agent?.relationshipContext || []),
    voiceContract: deepClone(perceptualProjection.agent?.voiceContract || {}),
  };
  for (const key of [
    "activation",
    "perceptionFrame",
    "perceivedImpacts",
    "perceptionMemory",
    "perceivedCharacters",
    "materialFacts",
    "perceivedObjects",
    "availableAffordances",
    "serviceChoice",
    "settledInteractionEvents",
    "recentOwnActions",
    "discourseContext",
    "reachableZones",
    "repairFeedback",
  ]) {
    if (Object.hasOwn(perceptualProjection, key)) projected[key] = deepClone(perceptualProjection[key]);
  }
  // Conversation has two simultaneous reference layers. Physical speakers and
  // addressees remain opaque perceived entities until the listener recognizes
  // them, while the listener's own thread appraisal may still use a name they
  // already know from memory or hearsay. Keep those layers separate instead of
  // redacting the private appraisal with the visual-role projection.
  projected.openConversationThreads = (perceptualProjection.openConversationThreads || []).map((thread) => {
    const epistemicThread = (epistemicProjection.openConversationThreads || [])
      .find((candidate) => candidate.id === thread.id);
    return {
      ...deepClone(thread),
      topic: epistemicThread?.topic ?? thread.topic,
      myState: deepClone(epistemicThread?.myState || thread.myState || null),
    };
  });
  projected.privateActionCandidates = (perceptualProjection.privateActionCandidates || []).map((candidate, index) => (
    mergeProjectedActionCandidate(candidate, epistemicProjection.privateActionCandidates?.[index] || {})
  ));
  projected.identityReferenceContract = {
    knownEntityPrefix: "known_entity:",
    perceivedEntityPrefix: "perceived_entity:",
    mergeAuthority: "character-agent-cognitive-appraisal",
    rule: "known_entity 表示本人记忆或传闻里知道的人；perceived_entity 表示眼前尚未确认身份的人。二者不是同一指代，只有本人依据新证据确认身份后才可合并。身体动作、对话听者与关系评价只能指向 perceivedCharacters 中的实体。",
  };
  CANONICAL_AGENT_INPUTS.set(projected, authoritativeInput);
  return projected;
}

function canonicalAgentInput(input = {}, state = {}, runtime = {}) {
  const stored = CANONICAL_AGENT_INPUTS.get(input);
  if (stored) return stored;
  const actorId = input.agent?.id || "";
  const { projectedToCanonical } = identityReferenceMaps(state, runtime, actorId);
  return replaceIdentityReferences(input, projectedToCanonical);
}

function canonicalizeAgentOutput(raw = {}, projectedInput = {}, state = {}, runtime = {}) {
  const actorId = canonicalAgentInput(projectedInput, state, runtime)?.agent?.id || projectedInput.agent?.id || "";
  const { projectedToCanonical, epistemicProjectedIds } = identityReferenceMaps(state, runtime, actorId);
  const physicalTargetPaths = [
    ["targetCharacterId"],
    ["actionAttempt", "targetCharacterId"],
    ["relationshipAppraisal", "targetCharacterId"],
  ];
  const projectedPerceivedIds = new Set((projectedInput.perceivedCharacters || []).map((row) => row.id).filter(Boolean));
  const protectedTargets = physicalTargetPaths.map((path) => {
    const value = path.reduce((cursor, key) => cursor?.[key], raw);
    return {
      path,
      value: epistemicProjectedIds.has(value) && !projectedPerceivedIds.has(value) ? value : null,
    };
  });
  const protectedAudiences = (raw.communicationPlan?.intendedAudienceCharacterIds || [])
    .map((value, index) => ({ index, value }))
    .filter(({ value }) => epistemicProjectedIds.has(value) && !projectedPerceivedIds.has(value));
  const canonicalized = replaceIdentityReferences(raw, projectedToCanonical);
  for (const { path, value } of protectedTargets) {
    if (!value) continue;
    const parent = path.slice(0, -1).reduce((cursor, key) => cursor?.[key], canonicalized);
    if (parent) parent[path.at(-1)] = value;
    else if (path.length === 1) canonicalized[path[0]] = value;
  }
  for (const { index, value } of protectedAudiences) {
    if (canonicalized.communicationPlan?.intendedAudienceCharacterIds) {
      canonicalized.communicationPlan.intendedAudienceCharacterIds[index] = value;
    }
  }
  return canonicalized;
}

function characterById(state, characterId) {
  return (state.characters || []).find((character) => character.id === characterId) || null;
}

function memoryClockSeconds(runtime = {}) {
  const day = Number(runtime.slotContext?.day ?? runtime.macroDay ?? 0);
  return Math.max(0, day * 24 * 60 * 60 + Number(runtime.elapsedSeconds || 0));
}

function initialCharacterMemory(character = {}, runtime = {}) {
  const source = mergeValidatedCharacterAnchorMemoryState(
    character.agentMemory || createCharacterAgentMemoryState(character.id),
    character.id,
  );
  return advanceCharacterAgentMemory(
    normalizeCharacterAgentMemoryState(source, character.id),
    { nowSeconds: memoryClockSeconds(runtime) },
  );
}

function sceneAgencyFor(character = {}) {
  return character.lifeProfile?.agency
    || character.agency
    || character.sceneAgency
    || character.lifeProfile?.tavernAgency
    || {};
}

function validatedSceneRuntimeFor(character = {}) {
  return character?.id
    ? findValidatedCharacterAnchorRuntime(character.id, { sceneId: TAVERN_SCENE_ID })
    : null;
}

function validatedRecognizedIdentityIds(runtime = null, character = {}) {
  if (!runtime) return new Set();
  const recognized = new Set((runtime.characterFoundation?.epistemics?.knownEntities || [])
    .filter((row) => row?.recognizesIdentity === true)
    .map((row) => row.entityId)
    .filter(Boolean));
  for (const key of Object.keys(runtime.characterFoundation?.speechPolicy?.relationshipRegisters || {})) {
    if (key.startsWith("char_")) recognized.add(key);
  }
  for (const row of character.agentMemory?.identityKnowledge || []) {
    if (row?.characterId && row?.status === "confirmed") recognized.add(row.characterId);
  }
  return recognized;
}

function validatedKnowledgeBoundary(runtime = null, character = {}) {
  if (!runtime) return null;
  const knownEntities = runtime.characterFoundation?.epistemics?.knownEntities || [];
  const recognizedIdentityIds = validatedRecognizedIdentityIds(runtime, character);
  const binding = runtime.presenceProjection || {};
  return {
    knownActorIds: [...recognizedIdentityIds],
    hearsayActorIds: knownEntities
      .filter((row) => row?.knowsName === true && row?.recognizesIdentity !== true)
      .map((row) => row.entityId)
      .filter(Boolean),
    identityUnknownActorIds: knownEntities
      .filter((row) => row?.recognizesIdentity !== true)
      .map((row) => row.entityId)
      .filter(Boolean),
    publicFacts: [],
    privateFacts: [],
    entryState: deepClone(binding.entryState || {}),
    prohibitedKnowledge: deepClone(binding.prohibitedKnowledge || []),
  };
}

function isTavernVisitor(character = {}) {
  return character.lifeProfile?.simulationTier === "visitor"
    || Boolean(sceneAgencyFor(character).visitPolicy);
}

function directedRelationshipFor(state, fromCharacterId, toCharacterId) {
  return getDirectedRelationship(state, fromCharacterId, toCharacterId);
}

function relationshipExistsBetween(state, firstId, secondId) {
  return Boolean(
    directedRelationshipFor(state, firstId, secondId)
    || directedRelationshipFor(state, secondId, firstId),
  );
}

function edgesFrom(topology, zoneId, modality) {
  const weightKey = modality === "movement" ? "move" : modality;
  const edges = [];
  for (const edge of topology.edges || []) {
    const weight = Number(edge[weightKey]);
    if (!Number.isFinite(weight)) continue;
    if (edge.from === zoneId) edges.push({
      zoneId: edge.to,
      weight,
      barrier: edge.barrier || "",
      conversational: edge.conversation === true,
    });
    if (edge.to === zoneId) edges.push({
      zoneId: edge.from,
      weight,
      barrier: edge.barrier || "",
      conversational: edge.conversation === true,
    });
  }
  return edges;
}

export function spatialRoute(topology = TAVERN_SCENE_TOPOLOGY, fromZoneId = "", toZoneId = "", modality = "sound") {
  if (!topology.zones?.[fromZoneId] || !topology.zones?.[toZoneId]) return null;
  if (fromZoneId === toZoneId) return {
    distance: 0,
    zones: [fromZoneId],
    barriers: [],
    conversational: true,
  };
  if (["touch", "object"].includes(modality)) return null;
  const frontier = [{
    zoneId: fromZoneId,
    distance: 0,
    zones: [fromZoneId],
    barriers: [],
    conversational: true,
  }];
  const best = new Map([[fromZoneId, 0]]);
  while (frontier.length) {
    frontier.sort((a, b) => a.distance - b.distance);
    const current = frontier.shift();
    if (current.zoneId === toZoneId) return current;
    for (const edge of edgesFrom(topology, current.zoneId, modality)) {
      const distance = current.distance + edge.weight;
      if (distance >= (best.get(edge.zoneId) ?? Infinity)) continue;
      best.set(edge.zoneId, distance);
      frontier.push({
        zoneId: edge.zoneId,
        distance,
        zones: [...current.zones, edge.zoneId],
        barriers: edge.barrier ? [...current.barriers, edge.barrier] : [...current.barriers],
        conversational: current.conversational === true && edge.conversational === true,
      });
    }
  }
  return null;
}

function agencyStanding(character = {}) {
  const validatedRuntime = validatedSceneRuntimeFor(character);
  if (validatedRuntime) return getTavernEcologyProfile(character.id)?.standing || "visitor";
  return sceneAgencyFor(character).standing || "visitor";
}

function defaultZoneFor(character = {}, topology = TAVERN_SCENE_TOPOLOGY) {
  const committedZoneId = character.lifeState?.zoneId || character.lifeState?.location?.zoneId;
  if (committedZoneId && topology.zones?.[committedZoneId]) return committedZoneId;
  const ecologyZoneId = character.ecologyState?.presence?.zoneId;
  if (ecologyZoneId && topology.zones?.[ecologyZoneId]) return ecologyZoneId;
  const declaredZoneId = sceneAgencyFor(character).defaultZoneId;
  if (declaredZoneId && topology.zones?.[declaredZoneId]) return declaredZoneId;
  const standing = agencyStanding(character);
  const standingZoneId = topology.standingDefaultZoneIds?.[standing];
  if (standingZoneId && topology.zones?.[standingZoneId]) return standingZoneId;
  if (topology.defaultZoneId && topology.zones?.[topology.defaultZoneId]) return topology.defaultZoneId;
  return Object.keys(topology.zones || {})[0] || "";
}

function compileCharacterPublicSignalFeatures(character = {}) {
  const authored = Array.isArray(character.lifeState?.publicSignalFeatures)
    ? character.lifeState.publicSignalFeatures
    : Array.isArray(character.publicSignalFeatures) ? character.publicSignalFeatures : [];
  const features = [];
  const issues = [];
  for (const [index, source] of authored.entries()) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      issues.push({
        code: "CHARACTER_PUBLIC_SIGNAL_NOT_OBJECT",
        characterId: character.id || "",
        featureIndex: index,
        path: `characters.${character.id || "unknown"}.publicSignalFeatures[${index}]`,
        message: "人物公开信号必须是物理表面对象",
      });
      continue;
    }
    const featureId = text(source.featureId, 180) || `surface-${index + 1}`;
    const candidate = {
      ...deepClone(source),
      schemaVersion: 1,
      signalId: `character-surface:${character.id || "unknown"}:${featureId}`,
      sourceEntityId: character.id || "",
      sourceZoneId: "",
      modality: text(source.modality, 40) || "visual",
      featureId,
      physicalFeature: text(source.physicalFeature, 500),
      domainTags: Array.isArray(source.domainTags) ? source.domainTags : [],
      intensity: source.intensity ?? 0.65,
      durationSeconds: source.durationSeconds ?? 1,
      transmissionFactor: source.transmissionFactor ?? 1,
      noiseResistance: source.noiseResistance ?? 0.15,
    };
    const report = validateWorldSignalFeature(candidate);
    if (!report.valid) {
      issues.push(...report.errors.map((issue) => ({
        ...issue,
        characterId: character.id || "",
        featureIndex: index,
        path: `characters.${character.id || "unknown"}.publicSignalFeatures[${index}].${issue.path}`,
      })));
      continue;
    }
    features.push(normalizeWorldSignalFeature(candidate));
  }
  return { features, issues };
}

function intrinsicPressure(character = {}) {
  const needs = character.lifeState?.needs || {};
  const needPeak = Math.max(0, ...Object.values(needs).map(Number).filter(Number.isFinite));
  const declaredDutyPriority = clamp(sceneAgencyFor(character).servicePolicy?.priority ?? sceneAgencyFor(character).responsibilityPriority ?? 0);
  const duty = declaredDutyPriority * 0.18;
  const ecologyDesires = Object.values(character.ecologyState?.desires || {});
  const strongestEcologyDesire = Math.max(0, ...ecologyDesires.map((desire) => Number(desire.strength || 0) * 100));
  const unfinished = ecologyDesires.length || character.lifeState?.activeGoal ? 10 : 0;
  return clamp(Math.max(needPeak, strongestEcologyDesire) * 0.42 + duty + unfinished, 12, 78);
}

function publicRole(character = {}) {
  const validatedRuntime = validatedSceneRuntimeFor(character);
  if (validatedRuntime?.presenceProjection?.reasonForPresence) {
    return validatedRuntime.presenceProjection.reasonForPresence;
  }
  return character.lifeProfile?.role || character.externalSituation || agencyStanding(character);
}

function ownPrivateSceneState(state, character = {}, { locationId = LOCATION_ID, zoneId = null } = {}) {
  const ecology = ensureTavernEcology(character, {
    present: Boolean(character.lifeState?.present),
    locationId,
    zoneId,
  });
  const leadingDesire = ecology.profile?.desires?.slice().sort((left, right) => {
    const leftState = ecology.state?.desires?.[left.id] || {};
    const rightState = ecology.state?.desires?.[right.id] || {};
    return (Number(rightState.strength || right.baseStrength || 0) + Number(rightState.frustration || 0))
      - (Number(leftState.strength || left.baseStrength || 0) + Number(leftState.frustration || 0));
  })[0] || null;
  const leadingDesireText = leadingDesire
    ? `${leadingDesire.desiredState?.verb || ""}${leadingDesire.desiredState?.object || leadingDesire.target?.label || ""}`
    : "";
  const psychologyAnchor = ecology.profile?.psychologyAnchor || null;
  // The ecology profile carries only a compact runtime reference.  Private
  // Agent input needs the full validated foundation for epistemic boundaries,
  // speech registers and scene binding; treating the compact reference as the
  // foundation silently erased hearsay/identity-unknown facts.
  const validatedRuntime = ecology.profile?.validatedAnchorRuntime
    ? (validatedSceneRuntimeFor(character) || ecology.profile.validatedAnchorRuntime)
    : null;
  const usesValidatedRuntime = Boolean(validatedRuntime);
  const sceneBinding = validatedRuntime?.presenceProjection || null;
  const sceneAgency = sceneAgencyFor(character);
  const anchoredPursuit = (psychologyAnchor?.stablePsychology?.corePursuits || [])
    .map((pursuit) => text(pursuit.desiredSelfState, 220))
    .filter(Boolean)
    .join("；");
  return {
    needs: deepClone(character.lifeState?.needs || {}),
    currentActivity: deepClone(character.lifeState?.currentActivity || character.currentActivity || null),
    activeGoal: leadingDesireText || character.lifeState?.activeGoal || character.lifeProfile?.privatePursuit || "",
    hiddenAgenda: usesValidatedRuntime
      ? anchoredPursuit
      : character.lifeState?.hiddenAgenda || anchoredPursuit || character.lifeProfile?.privatePursuit || "",
    privatePursuit: anchoredPursuit || character.lifeProfile?.privatePursuit || "",
    refusalBoundary: usesValidatedRuntime ? "" : character.lifeProfile?.refusal || "",
    commitments: usesValidatedRuntime ? [] : deepClone(character.lifeProfile?.commitments || []),
    ecologyProfile: deepClone(ecology.profile || character.ecologyProfile || null),
    ecologyState: deepClone(ecology.state || character.ecologyState || null),
    speechProfile: usesValidatedRuntime ? {} : deepClone(character.speechProfile || {}),
    selfModel: usesValidatedRuntime ? {
      authority: "validated-character-foundation-and-owned-memory-only",
      characterId: character.id,
      runtimeSurface: psychologyAnchor?.runtimeSurface || "character-foundation",
      numericCalibrationStatus: psychologyAnchor?.numericCalibrationStatus || "unassigned",
    } : {
      authority: "owned-character-material",
      internalSituation: deepClone(character.internalSituation || {}),
      selfMyth: deepClone(character.selfMyth || {}),
      actionLines: deepClone(character.actionLines || {}),
      desireLag: deepClone(character.desireLag || {}),
      shameMechanism: deepClone(character.shameMechanism || {}),
      innerCourt: deepClone(character.innerCourt || {}),
      relationshipRules: deepClone(character.relationshipRules || {}),
      irreversibleBoundaries: deepClone(character.irreversibleBoundaries || []),
      currentState: deepClone(character.currentState || {}),
    },
    sceneRole: {
      authority: sceneBinding ? "validated-scene-binding" : "scene-agency",
      reasonForPresence: sceneBinding?.reasonForPresence || sceneAgency.placeRelationship || "",
      entryCause: sceneBinding?.entryCause || "",
      currentPurpose: sceneBinding?.currentPurpose || leadingDesireText || character.lifeProfile?.privatePursuit || "",
      placeRelationship: sceneBinding?.reasonForPresence || sceneAgency.placeRelationship || "",
      responsibilities: usesValidatedRuntime
        ? (ecology.profile?.duties || []).map((item) => item.responsibility).filter(Boolean)
        : deepClone(sceneAgency.responsibilities || []),
      authorityCapabilities: deepClone(sceneAgency.authority || {}),
      knowledgeBoundary: deepClone(
        usesValidatedRuntime
          ? validatedKnowledgeBoundary(validatedRuntime, character)
          : sceneAgency.knowledgeBoundary || {},
      ),
      knownAffordanceIds: deepClone(sceneBinding?.knownAffordanceIds || []),
      exitConditions: deepClone(sceneBinding?.exitConditions || []),
    },
    ownMemories: (usesValidatedRuntime ? [] : (state.characterMemories || []))
      .filter((memory) => memory.characterId === character.id)
      .slice(0, 8)
      .map((memory) => ({ id: memory.id || "", content: memory.privateVersion || memory.content || "", day: memory.day || null, type: memory.type || "" })),
  };
}

function migratedParticipantThreadState(thread = {}, characterId = "") {
  const lastTurn = [...(thread.turns || [])].reverse().find((turn) => turn.speakerId) || null;
  const isNext = thread.nextObligationCharacterId === characterId;
  const isLastSpeaker = lastTurn?.speakerId === characterId;
  return {
    schemaVersion: 1,
    threadId: thread.id || "",
    characterId,
    processingStatus: isNext ? "remembered_unappraised" : "appraised",
    perceivedDisposition: "unclear",
    satisfaction: isLastSpeaker && thread.status === "open" ? "unsatisfied" : "uncertain",
    responseNeed: isNext ? "medium" : "none",
    selfClosure: thread.status === "resolved" ? "closed_for_self" : "open",
    lastReceivedTurnId: isNext ? lastTurn?.turnId || lastTurn?.id || "" : "",
    lastAppraisedTurnId: "",
    lastSpokenTurnId: isLastSpeaker ? lastTurn?.turnId || lastTurn?.id || "" : "",
    outgoingDisposition: "none",
    pressure: isNext ? 0.55 : isLastSpeaker && thread.status === "open" ? 0.48 : 0.2,
    summary: "",
    authority: "legacy-shared-thread-migration",
  };
}

function initialParticipantThreadStates(state = {}) {
  const result = {};
  for (const thread of state.tavernState?.eventThreads || []) {
    if (!thread?.id) continue;
    result[thread.id] = {};
    for (const characterId of thread.participantIds || []) {
      result[thread.id][characterId] = {
        ...migratedParticipantThreadState(thread, characterId),
        ...deepClone(thread.participantStates?.[characterId] || {}),
        threadId: thread.id,
        characterId,
      };
    }
  }
  return result;
}

function ensureRuntimeParticipantThreadState(runtime = {}, threadId = "", characterId = "") {
  if (!threadId || !characterId) return null;
  runtime.participantThreadStates ||= {};
  runtime.participantThreadStates[threadId] ||= {};
  runtime.participantThreadStates[threadId][characterId] ||= {
    schemaVersion: 1,
    threadId,
    characterId,
    processingStatus: "unprocessed",
    perceivedDisposition: "unclear",
    satisfaction: "uncertain",
    responseNeed: "none",
    selfClosure: "open",
    lastReceivedTurnId: "",
    lastAppraisedTurnId: "",
    lastSpokenTurnId: "",
    outgoingDisposition: "none",
    pressure: 0.2,
    summary: "",
    authority: "character-owned-thread-state",
  };
  return runtime.participantThreadStates[threadId][characterId];
}

export function buildTavernSceneRuntime(state = {}, {
  characterIds = [],
  positions = {},
  topology = TAVERN_SCENE_TOPOLOGY,
  slotContext = {},
  allowOrphanVisitors = false,
} = {}) {
  const requestedIds = characterIds.length
    ? characterIds
    : (state.characters || [])
      .filter((character) => character.lifeState?.present)
      .map((character) => character.id);
  const activeVisitorIds = new Set((state.tavernState?.activeVisits || []).map((visit) => visit.visitorId));
  const selectedIds = requestedIds.filter((characterId) => {
    const character = characterById(state, characterId);
    return allowOrphanVisitors || !isTavernVisitor(character) || activeVisitorIds.has(characterId);
  });
  const agents = {};
  const worldSignalValidationIssues = [];
  for (const characterId of selectedIds) {
    const character = characterById(state, characterId);
    if (!character) continue;
    const stored = state.tavernState?.sceneRuntime?.agents?.[characterId] || {};
    const activeVisit = (state.tavernState?.activeVisits || []).find((visit) => visit.visitorId === characterId) || null;
    const explicitlyPositioned = Boolean(topology.zones[positions[characterId]]);
    const hasStoredZone = Boolean(topology.zones[stored.zoneId]);
    const restoredStoredZoneId = hasStoredZone
      ? tavernRestoredVisitorZone({ visit: activeVisit, storedAgent: stored })
      : "";
    const proposedZoneId = explicitlyPositioned
      ? positions[characterId]
      : topology.zones[restoredStoredZoneId] ? restoredStoredZoneId : defaultZoneFor(character, topology);
    const purposeDeclared = activeVisit?.purposeStatus === "declared" || activeVisit?.purposeDisclosureStatus === "declared";
    const purposeDisclosureRequired = activeVisit?.purposeDisclosureRequired !== false;
    // Explicit scene input is a current-world placement. Persisted placement
    // is trusted across scenes only when it does not contradict an undisclosed
    // visit or carries the world's committed movement provenance.
    const zoneId = activeVisit && !explicitlyPositioned && !topology.zones[restoredStoredZoneId]
      ? purposeDisclosureRequired && !purposeDeclared
        ? "threshold"
        : (activeVisit.purposeZoneIds?.[0] || "hall")
      : proposedZoneId;
    const sceneLocationId = topology.locationId || LOCATION_ID;
    const ecology = ensureTavernEcology(character, {
      present: true,
      zoneId,
      locationId: sceneLocationId,
      elapsedSeconds: Number(stored.ecologyState?.elapsedSeconds || 0),
    });
    const firstDesire = ecology.profile?.desires?.[0];
    const firstDesireText = firstDesire ? `${firstDesire.desiredState?.verb || ""}${firstDesire.desiredState?.object || ""}` : "";
    const memoryState = initialCharacterMemory(character, {
      macroDay: Number(slotContext.day ?? state.tavernState?.day ?? 0),
      slotContext,
      elapsedSeconds: 0,
    });
    const publicSignalSurface = compileCharacterPublicSignalFeatures(character);
    worldSignalValidationIssues.push(...publicSignalSurface.issues);
    character.agentMemory = deepClone(memoryState);
    const carriedZoneProvenance = stored.zoneId === zoneId && stored.zoneProvenance
      ? deepClone(stored.zoneProvenance)
      : null;
    const zoneProvenance = carriedZoneProvenance || {
      schemaVersion: 1,
      authority: explicitlyPositioned ? "scene-position-input" : activeVisit ? "visit-lifecycle-restore" : "scene-default",
      ...(activeVisit?.id ? { sourceVisitId: activeVisit.id } : {}),
      toZoneId: zoneId,
    };
    const ecologyState = deepClone(stored.ecologyState || ecology.state || null);
    if (ecologyState?.presence) {
      ecologyState.presence.locationId = sceneLocationId;
      ecologyState.presence.zoneId = zoneId;
      ecologyState.presence.observableAtStage = true;
    }
    agents[characterId] = {
      characterId,
      characterName: character.name || characterId,
      role: publicRole(character),
      standing: agencyStanding(character),
      zoneId,
      zoneProvenance,
      present: true,
      publicSignalFeatures: deepClone(publicSignalSurface.features),
      currentIntention: stored.currentIntention || firstDesireText || character.lifeState?.activeGoal || character.lifeProfile?.privatePursuit || "继续眼下的生活",
      attentionTargetId: stored.attentionTargetId || "",
      attentionFocus: stored.attentionTargetId ? {
        schemaVersion: 1,
        authority: "legacy-attention-migration",
        mode: "carried-focus",
        targetCharacterId: stored.attentionTargetId,
        domainTags: ["attention-target"],
        startedAtSeconds: 0,
        expiresAtSeconds: 30,
        sourceActionId: "",
      } : null,
      intrinsicPressure: intrinsicPressure(character),
      inbox: [],
      perceptionMemory: deepClone(stored.perceptionMemory || []).slice(-12),
      memoryState,
      recentActionIds: [],
      cooldownUntilSeconds: 0,
      hasActed: false,
      consecutivePasses: 0,
      privateState: ownPrivateSceneState(state, character, { locationId: sceneLocationId, zoneId }),
      ecologyState,
      ecologySceneStartSeconds: Number(stored.ecologyState?.elapsedSeconds ?? ecology.state?.elapsedSeconds ?? 0),
    };
  }
  const persistedRequestLocks = (state.tavernState?.sceneRuntime?.requestLocks || [])
    .filter((lock) => lock?.id && lock.status !== "resolved")
    .map((lock) => deepClone(lock));
  const threadRequestLocks = (state.tavernState?.eventThreads || []).filter((thread) => thread.status === "open").flatMap((thread) => {
    const lastTurn = [...(thread.turns || [])].reverse().find((turn) => turn.speakerId && (turn.addresseeId || turn.targetCharacterId));
    if (!lastTurn) return [];
    return [{
      id: `request_lock:${thread.id}`,
      threadId: thread.id,
      requesterId: lastTurn.speakerId,
      responderId: lastTurn.addresseeId || lastTurn.targetCharacterId,
      topic: thread.topic || "未命名请求",
      status: thread.nextObligationCharacterId ? "awaiting" : "paused",
      openedAtStep: 0,
      latestActionId: lastTurn.turnId || lastTurn.id || "",
    }];
  });
  // The persistent scene lock and the durable conversation thread are two
  // projections of the same social obligation.  Their technical ids differ,
  // so deduplicating by id creates two requests: an answer resolves one while
  // the duplicate keeps the clock blocked.  Identity belongs to the shared
  // thread and its two directed roles, not to either projection's row id.
  const requestLocksByInteraction = new Map();
  for (const lock of [...persistedRequestLocks, ...threadRequestLocks]) {
    const interactionKey = lock.threadId && lock.requesterId && lock.responderId
      ? `${lock.threadId}:${lock.requesterId}:${lock.responderId}`
      : `row:${lock.id}`;
    const existing = requestLocksByInteraction.get(interactionKey);
    if (!existing) {
      requestLocksByInteraction.set(interactionKey, lock);
      continue;
    }
    // Persisted runtime is the more recent settlement authority.  A thread
    // projection may fill missing provenance, but must not overwrite its
    // current status, attempt count, or latest concrete action.
    requestLocksByInteraction.set(interactionKey, {
      ...deepClone(lock),
      ...deepClone(existing),
      threadId: existing.threadId || lock.threadId || "",
      latestActionId: existing.latestActionId || lock.latestActionId || "",
    });
  }
  const requestLocks = [...requestLocksByInteraction.values()];
  return {
    id: createId("tavern_causal_scene"),
    schemaVersion: 1,
    locationId: topology.locationId || LOCATION_ID,
    topology: deepClone(topology),
    macroDay: Number(state.tavernState?.day || 0),
    macroTick: Number(state.tavernState?.tick || 0),
    slotContext: {
      day: Number(slotContext.day ?? state.tavernState?.day ?? 0),
      slotId: slotContext.slotId || "causal-scene",
      slotLabel: slotContext.slotLabel || "同一场",
      slotBaseId: slotContext.slotBaseId || "scene",
    },
    elapsedSeconds: 0,
    step: 0,
    activeCharacterIds: Object.keys(agents),
    agents,
    worldSignalValidationIssues,
    impacts: [],
    deliveries: [],
    eventReceipts: createCharacterEventReceiptLedger(),
    eventAppraisals: [],
    cognitiveAppraisals: [],
    relationshipShifts: [],
    relationshipAppraisals: [],
    threadAppraisals: [],
    participantThreadStates: initialParticipantThreadStates(state),
    actions: [],
    requestLocks,
    commitments: [
      ...(state.tavernState?.sceneRuntime?.commitments || []),
      ...(state.tavernState?.eventThreads || [])
        .filter((thread) => thread.status === "open")
        .map((thread) => ({
          id: thread.id,
          topic: thread.topic || "未完事务",
          ownerId: thread.nextObligationCharacterId || thread.participantIds?.[0] || "",
          targetCharacterId: thread.participantIds?.find((id) => id !== thread.nextObligationCharacterId) || "",
          status: "open",
          source: "event-thread",
        })),
    ].filter((item, index, list) => item?.id && list.findIndex((candidate) => candidate.id === item.id) === index).slice(-12),
    sharedActivities: deepClone(state.tavernState?.sceneRuntime?.sharedActivities || []),
    accessGrants: deepClone(state.tavernState?.sceneRuntime?.accessGrants || []),
    failedAttemptCooldowns: deepClone(state.tavernState?.sceneRuntime?.failedAttemptCooldowns || []),
    lastActorId: "",
  };
}

export function createImpactFactor(input = {}, {
  responsibilityRules: _deprecatedResponsibilityRules = [],
} = {}) {
  const semanticFrame = normalizeSemanticFrame(input.semanticFrame || {
    kind: input.type === "speech" || input.type === "information" ? "communication" : "event",
    predicate: input.actionKind || (input.speechAct && input.speechAct !== "none" ? input.speechAct : input.type || "event"),
    topicId: input.topic || input.actionKind || input.type || "event",
    roles: {
      ...(input.sourceCharacterId ? { actor: input.sourceCharacterId } : {}),
      ...(input.directedTargetId ? { addressee: input.directedTargetId } : {}),
    },
    object: { id: input.objectiveEventId || input.causedByActionId || input.id || "", label: input.topic || input.content || "" },
    lexicalAnchors: input.topic ? [input.topic] : [],
    importance: Number(input.importance || 0.4),
  });
  return {
    id: input.id || createId("impact"),
    causedByActionId: input.causedByActionId || "",
    objectiveEventId: input.objectiveEventId || input.causedByActionId || input.id || "",
    sourceCharacterId: input.sourceCharacterId || "",
    sourceZoneId: input.sourceZoneId || "hall",
    locationId: input.locationId || LOCATION_ID,
    type: input.type || "physical",
    modality: input.modality || "visual",
    intensity: clamp(input.intensity ?? 50),
    radius: Math.max(0, Number(input.radius ?? 1)),
    directedTargetId: input.directedTargetId || "",
    content: text(input.content, 260),
    topic: text(input.topic, 120),
    observableAffectiveTexture: observableAffectiveTexture(input.observableAffectiveTexture),
    publicEvent: Boolean(input.publicEvent),
    publicEventKind: input.publicEventKind || "",
    surfaceEvent: text(input.surfaceEvent || input.content, 260),
    createdAtSeconds: Math.max(0, Number(input.createdAtSeconds || 0)),
    committed: input.committed !== false,
    speechAct: input.speechAct || "none",
    speechFunctions: [...(input.speechFunctions || inferPublicSpeechFunctions(input))],
    actionKind: input.actionKind || "",
    commitmentAction: input.commitmentAction || "none",
    semanticFrame,
    cueIds: [...new Set(input.cueIds || [])],
    responsibilityTags: [],
    socialFactIds: [...new Set(input.socialFactIds || [])],
    outcomeValence: Math.max(-1, Math.min(1, Number(input.outcomeValence || 0))),
    threat: Math.max(0, Math.min(1, Number(input.threat || 0))),
    publicness: Math.max(0, Math.min(1, Number(input.publicness || 0))),
    directParticipantIds: [...new Set(input.directParticipantIds || [])],
    thirdPartyObserverIds: [...new Set(input.thirdPartyObserverIds || [])],
    controlDelta: Math.max(-1, Math.min(1, Number(input.controlDelta || 0))),
    repairOpportunity: Math.max(0, Math.min(1, Number(input.repairOpportunity || 0))),
    provenance: {
      kind: input.provenance?.kind || "firsthand",
      sourceActionId: input.provenance?.sourceActionId || input.causedByActionId || "",
      sourceImpactIds: [...new Set(input.provenance?.sourceImpactIds || [])],
      sourceThreadId: input.provenance?.sourceThreadId || "",
      responseToTurnId: input.provenance?.responseToTurnId || "",
      responseSourceLine: text(input.provenance?.responseSourceLine, 220),
      responseSourceSlotId: input.provenance?.responseSourceSlotId || "",
      responseSourceSlotLabel: input.provenance?.responseSourceSlotLabel || "",
      speakerCharacterId: input.provenance?.speakerCharacterId || input.sourceCharacterId || "",
      claimedOriginalSourceId: input.provenance?.claimedOriginalSourceId || "",
      sourceCharacterChain: [...new Set(input.provenance?.sourceCharacterChain || [])],
      suspectedMotive: text(input.provenance?.suspectedMotive, 180),
      confidence: Number.isFinite(Number(input.provenance?.confidence)) ? Number(input.provenance.confidence) : undefined,
    },
  };
}

function objectiveSocialContextForAction(runtime = {}, action = {}) {
  const sourceZoneId = action.actorZoneId || runtime.agents?.[action.actorId]?.zoneId || "hall";
  const publicZone = ["threshold", "hall", "counter", "stove", "stairs"].includes(sourceZoneId);
  const activity = (runtime.sharedActivities || []).find((row) => row.activityId === action.sharedActivity?.activityId) || null;
  const directParticipantIds = [
    action.actorId,
    action.targetCharacterId,
    ...(activity?.participantIds || []),
    ...(action.sharedActivity?.participantIds || []),
  ].filter(Boolean);
  const potentialObservers = Object.values(runtime.agents || {}).flatMap((agent) => {
    if (!agent.present || agent.characterId === action.actorId) return [];
    const route = spatialRoute(runtime.topology || TAVERN_SCENE_TOPOLOGY, sourceZoneId, agent.zoneId, action.speech ? "sound" : "visual");
    if (!route || route.distance > 2) return [];
    return [{
      characterId: agent.characterId,
      noticeProbability: route.distance <= 0 ? 1 : route.distance <= 1 ? 0.82 : 0.56,
      perceivedConcernWeight: 0.5,
      modalities: [action.speech ? "sound" : "visual"],
    }];
  });
  return deriveCharacterSocialContext({
    actorId: action.actorId,
    directParticipantIds,
    potentialObservers,
    place: {
      placeId: runtime.locationId || LOCATION_ID,
      zoneId: sourceZoneId,
      publicAccess: publicZone,
    },
    socialFacts: (runtime.socialFacts || []).filter((fact) => (
      !action.socialFactIds?.length || action.socialFactIds.includes(fact.factId || fact.id)
    )),
  });
}

function actionPsychologyDimensions(runtime = {}, action = {}) {
  const socialContext = objectiveSocialContextForAction(runtime, action);
  const witnesses = socialContext.thirdPartyObserverIds.length;
  const publicness = socialContext.audienceExposure;
  const speechFunctions = actionSpeechFunctions(action);
  const cueIds = [];
  if (publicness >= 0.58) cueIds.push("public_scrutiny");
  if (witnesses >= 3) cueIds.push("crowded_public_space");
  if (/(?:药钱|钱的来路|当票|典当)/.test(`${action.speech || ""} ${action.commitmentTopic || ""}`) && publicness >= 0.58) {
    cueIds.push("public_question_about_money");
  }
  if (/(?:交手|比剑|决斗)/.test(`${action.speech || ""} ${action.commitmentTopic || ""}`) && witnesses >= 2) {
    cueIds.push("spectator_attention");
  }
  const outcomeValence = speechFunctions.some((speechFunction) => ["greet", "offer", "confide"].includes(speechFunction))
    ? 0.2
    : speechFunctions.some((speechFunction) => ["warn", "refuse"].includes(speechFunction)) ? -0.28 : 0;
  const threat = speechFunctions.includes("warn") ? 0.58 : speechFunctions.includes("refuse") ? 0.18 : 0;
  const controlDelta = speechFunctions.some((speechFunction) => ["ask", "negotiate", "warn"].includes(speechFunction)) || action.commitmentAction === "open"
    ? -0.18
    : speechFunctions.some((speechFunction) => ["answer", "inform"].includes(speechFunction)) ? 0.06 : 0;
  const repairOpportunity = speechFunctions.some((speechFunction) => ["answer", "offer", "confide"].includes(speechFunction)) ? 0.4 : 0;
  return {
    committed: action.committed === true,
    publicness,
    directParticipantIds: socialContext.directParticipantIds,
    thirdPartyObserverIds: socialContext.thirdPartyObserverIds,
    socialFactIds: socialContext.socialFacts.map((fact) => fact.factId),
    cueIds,
    outcomeValence,
    threat,
    controlDelta,
    repairOpportunity,
  };
}

function relationshipRelevance(state, impact, recipientId) {
  if (!impact.sourceCharacterId || impact.sourceCharacterId.startsWith("world:")) return 0;
  const relationship = directedRelationshipFor(state, recipientId, impact.sourceCharacterId);
  if (!relationship) return 0;
  return clamp((
    Number(relationship.dependence || 0)
    + Number(relationship.resentment || 0)
    + Number(relationship.wantsToBeSeen || 0)
    + Number(relationship.protection || 0)
  ) / 20, 0, 18);
}

function personalRelevance(state, runtime, impact, recipient) {
  const character = characterById(state, recipient.characterId) || {};
  let relevance = impact.directedTargetId === recipient.characterId ? 42 : 0;
  if (text(impact.content).includes(character.name || "__no_name__")) relevance += 18;
  relevance += relationshipRelevance(state, impact, recipient.characterId);
  const privateText = JSON.stringify({
    activeGoal: recipient.privateState?.activeGoal,
    hiddenAgenda: recipient.privateState?.hiddenAgenda,
    commitments: recipient.privateState?.commitments,
  });
  const topicTokens = text(impact.topic || impact.content).split(/[，。；！？、\s]/).filter((token) => token.length >= 2).slice(0, 5);
  if (topicTokens.some((token) => privateText.includes(token))) relevance += 18;
  return clamp(relevance, 0, 70);
}

function impactAttenuation(modality, distance) {
  if (modality === "sound") return distance * 18;
  if (modality === "visual") return distance * 24;
  if (modality === "smell") return distance * 22;
  return distance * 30;
}

function projectImpactForRecipient(state = {}, runtime = {}, impact = {}, recipient = {}) {
  const sourceAgent = runtime.agents?.[impact.sourceCharacterId] || null;
  const identityKnown = !sourceAgent || impact.sourceCharacterId.startsWith("world:")
    ? true
    : identityIsKnown(state, recipient.characterId, impact.sourceCharacterId);
  const anonymousRole = sourceAgent ? unknownVisibleRole(sourceAgent) : "现场来源";
  const sourceName = sourceAgent?.characterName || "";
  const replaceUnknownSourceName = (value = "") => {
    const line = text(value, 260);
    if (identityKnown || !sourceName || impact.type === "speech" || impact.type === "information") return line;
    return line.split(sourceName).join(anonymousRole);
  };
  const entityHandle = impact.sourceCharacterId.startsWith("world:")
    ? impact.sourceCharacterId
    : stableImpactId("perceived_entity", recipient.characterId, impact.sourceCharacterId);
  const content = replaceUnknownSourceName(impact.content);
  const topic = replaceUnknownSourceName(impact.topic);
  const projectedAffectiveTexture = observableAffectiveTexture(impact.observableAffectiveTexture)
    .map((row) => ({ ...row, feature: replaceUnknownSourceName(row.feature) }));
  const provenance = deepClone(impact.provenance || {});
  const semanticFrame = deepClone(impact.semanticFrame || null);
  if (!identityKnown && sourceAgent) {
    provenance.speakerCharacterId = "";
    provenance.claimedOriginalSourceId = "";
    provenance.sourceCharacterChain = [];
    if (semanticFrame?.roles) {
      for (const [role, characterId] of Object.entries(semanticFrame.roles)) {
        if (characterId === impact.sourceCharacterId) semanticFrame.roles[role] = entityHandle;
      }
    }
  }
  return {
    evidenceId: stableImpactId("evidence", impact.id, recipient.characterId),
    sourceEntityHandle: entityHandle,
    perceivedSourceCharacterId: identityKnown ? impact.sourceCharacterId : "",
    identityKnown,
    recognizedIdentity: identityKnown && sourceAgent ? {
      characterId: sourceAgent.characterId,
      name: sourceAgent.characterName,
      role: sourceAgent.role,
    } : null,
    content,
    topic,
    observableAffectiveTexture: projectedAffectiveTexture,
    provenance,
    semanticFrame,
    perceptPacket: {
      schemaVersion: 2,
      perceivedEntityHandle: entityHandle,
      recognizedIdentity: identityKnown && sourceAgent ? {
        name: sourceAgent.characterName,
        role: sourceAgent.role,
      } : null,
      modality: impact.modality,
      sensoryFeatures: impact.type === "speech" || impact.type === "information"
        ? { literalSpeech: content, observableAffectiveTexture: projectedAffectiveTexture, sourceRole: identityKnown ? sourceAgent?.role || "" : anonymousRole }
        : { description: content, observableAffectiveTexture: projectedAffectiveTexture, sourceRole: identityKnown ? sourceAgent?.role || "" : anonymousRole },
      fidelity: 1,
      ambiguity: identityKnown ? 0.05 : 0.55,
      sourceRoute: [],
      occurredAt: Number(impact.createdAtSeconds || 0),
    },
  };
}

export function deliverImpactFactor(state = {}, runtime = {}, impactInput = {}) {
  const impact = impactInput.id ? impactInput : createImpactFactor(impactInput);
  if (impact.locationId !== runtime.locationId) return [];
  const deliveries = [];
  for (const recipient of Object.values(runtime.agents || {})) {
    if (!recipient.present || recipient.characterId === impact.sourceCharacterId) continue;
    if (impact.modality === "memory" && recipient.characterId !== impact.directedTargetId) continue;
    if (impact.directedTargetId && ["touch", "object"].includes(impact.modality) && recipient.characterId !== impact.directedTargetId) continue;
    const route = impact.modality === "memory"
      ? { distance: 0, zones: [recipient.zoneId], barriers: [] }
      : spatialRoute(runtime.topology || TAVERN_SCENE_TOPOLOGY, impact.sourceZoneId, recipient.zoneId, impact.modality);
    if (!route || route.distance > impact.radius) continue;
    if (["touch", "object"].includes(impact.modality) && route.distance !== 0) continue;
    const receivedIntensity = clamp(impact.intensity - impactAttenuation(impact.modality, route.distance));
    if (receivedIntensity < 12) continue;
    const relevance = personalRelevance(state, runtime, impact, recipient);
    const impactScore = clamp(receivedIntensity + relevance + (impact.directedTargetId === recipient.characterId ? 8 : 0), 0, 160);
    const projection = projectImpactForRecipient(state, runtime, impact, recipient);
    projection.perceptPacket.sourceRoute = [...route.zones];
    projection.perceptPacket.fidelity = Math.max(0, Math.min(1, receivedIntensity / Math.max(1, Number(impact.intensity || 1))));
    projection.perceptPacket.ambiguity = Math.max(
      projection.perceptPacket.ambiguity,
      Math.min(0.95, (100 - receivedIntensity) / 100 + route.barriers.length * 0.18),
    );
    deliveries.push({
      id: createId("impact_delivery"),
      impactId: impact.id,
      objectiveEventId: impact.objectiveEventId || impact.causedByActionId || impact.id,
      recipientId: recipient.characterId,
      sourceCharacterId: impact.sourceCharacterId,
      sourceEntityHandle: projection.sourceEntityHandle,
      perceivedSourceCharacterId: projection.perceivedSourceCharacterId,
      identityKnown: projection.identityKnown,
      recognizedIdentity: projection.recognizedIdentity,
      sourceZoneId: impact.sourceZoneId,
      recipientZoneId: recipient.zoneId,
      type: impact.type,
      modality: impact.modality,
      evidenceId: projection.evidenceId,
      content: projection.content,
      topic: projection.topic,
      observableAffectiveTexture: projection.observableAffectiveTexture,
      speechAct: impact.speechAct || "none",
      speechFunctions: [...(impact.speechFunctions || [])],
      actionKind: impact.actionKind || "",
      route: route.zones,
      barriers: route.barriers,
      distance: route.distance,
      receivedIntensity,
      personalRelevance: relevance,
      impactScore,
      responsibilityTags: [...(impact.responsibilityTags || [])],
      directed: impact.directedTargetId === recipient.characterId,
      semanticFrame: projection.semanticFrame,
      provenance: projection.provenance,
      perceptPacket: projection.perceptPacket,
      serverAudit: {
        worldEventId: impact.objectiveEventId || impact.causedByActionId || impact.id,
        sourceCharacterId: impact.sourceCharacterId,
      },
      deliveredAtSeconds: runtime.elapsedSeconds || 0,
      processedAtStep: null,
    });
  }
  return deliveries.sort((a, b) => b.impactScore - a.impactScore || a.recipientId.localeCompare(b.recipientId));
}

function ensureRuntimeEventReceipts(runtime = {}) {
  if (!runtime.eventReceipts) runtime.eventReceipts = createCharacterEventReceiptLedger();
  return runtime.eventReceipts;
}

function registerRuntimeImpactDelivery(runtime = {}, delivery = {}) {
  return registerCharacterEventDelivery(ensureRuntimeEventReceipts(runtime), delivery, {
    deliveredAtSeconds: delivery.deliveredAtSeconds,
    step: runtime.step,
  });
}

function isFreshExternalDelivery(runtime = {}, delivery = {}) {
  return deliveryQualifiesAsNewExternalImpact(ensureRuntimeEventReceipts(runtime), delivery);
}

function evidenceIdForDelivery(delivery = {}) {
  return text(
    delivery.noticedProjection?.evidenceId
    || delivery.noticedEvidenceId
    || delivery.evidenceId,
    220,
  );
}

function receiptEvidenceIdsInStatuses(runtime = {}, characterId = "", evidenceIds = [], statuses = []) {
  const allowed = new Set(statuses);
  return characterEventEvidenceRecords(
    ensureRuntimeEventReceipts(runtime),
    characterId,
    evidenceIds,
  ).filter((row) => allowed.has(row.status)).map((row) => row.evidenceId);
}

function markRuntimeDeliveriesNoticed(runtime = {}, actor = {}, deliveries = []) {
  for (const delivery of deliveries || []) registerRuntimeImpactDelivery(runtime, delivery);
  const evidenceIds = [...new Set((deliveries || []).map(evidenceIdForDelivery).filter(Boolean))];
  const eligible = receiptEvidenceIdsInStatuses(runtime, actor.characterId, evidenceIds, ["delivered", "noticed"]);
  if (!eligible.length) return [];
  return markCharacterEvidenceNoticed(ensureRuntimeEventReceipts(runtime), {
    characterId: actor.characterId,
    evidenceIds: eligible,
    agentTurnId: `activation:${runtime.id}:${runtime.step}:${actor.characterId}`,
    step: runtime.step,
  });
}

function markRuntimeAppraisedEvidence(runtime = {}, actor = {}, decision = {}, agentTurnId = "") {
  if (decision.cognitiveAppraisalAuthority !== "character-agent") return [];
  const evidenceIds = [...new Set(decision.cognitiveAppraisal?.noticedEvidenceIds || [])];
  const eligible = receiptEvidenceIdsInStatuses(runtime, actor.characterId, evidenceIds, ["delivered", "noticed"]);
  if (!eligible.length) return [];
  return markCharacterEvidenceAppraised(ensureRuntimeEventReceipts(runtime), {
    characterId: actor.characterId,
    evidenceIds: eligible,
    agentTurnId: agentTurnId || `agent-turn:${runtime.id}:${runtime.step}:${actor.characterId}`,
    step: runtime.step,
  });
}

function consumeRuntimeAppraisedEvidence(runtime = {}, actor = {}, decision = {}, agentTurnId = "", disposition = "") {
  const evidenceIds = [...new Set(decision.cognitiveAppraisal?.noticedEvidenceIds || [])];
  const eligible = receiptEvidenceIdsInStatuses(runtime, actor.characterId, evidenceIds, ["appraised"]);
  if (!eligible.length) return [];
  return markCharacterEvidenceConsumed(ensureRuntimeEventReceipts(runtime), {
    characterId: actor.characterId,
    evidenceIds: eligible,
    agentTurnId: agentTurnId || `agent-turn:${runtime.id}:${runtime.step}:${actor.characterId}`,
    step: runtime.step,
    disposition: disposition || "acted_or_explicitly_deferred",
  });
}

function memoryEncodingContextForDelivery(runtime = {}, delivery = {}) {
  const agent = runtime.agents?.[delivery.recipientId] || {};
  const ecology = agent.ecologyState || {};
  const body = ecology.body || ecology.bodyState || {};
  const affect = ecology.affect || {};
  const energy = Number(body.energy);
  const affectArousal = Number(affect.arousal);
  const fallbackArousal = Number(delivery.impactScore) / 160;
  return {
    attention: Math.max(0.18, Math.min(1,
      Number.isFinite(Number(delivery.noticedSalience))
        ? Number(delivery.noticedSalience)
        : Number(delivery.receivedIntensity || 0) / 100,
    )),
    goalRelevance: Math.max(0, Math.min(1, Number(delivery.personalRelevance || 0) / 70)),
    surprise: delivery.directed ? 0.28 : 0.42,
    emotionalArousal: Math.max(0, Math.min(1,
      Number.isFinite(affectArousal)
        ? affectArousal
        : Number.isFinite(fallbackArousal) ? fallbackArousal : 0.35,
    )),
    selfRelevance: delivery.directed ? 0.84 : Math.max(0.18, Math.min(0.72, Number(delivery.personalRelevance || 0) / 90)),
    relationshipRelevance: Math.max(0, Math.min(1, Number(delivery.personalRelevance || 0) / 85)),
    fatigue: Number.isFinite(energy) ? Math.max(0, Math.min(1, 1 - energy)) : 0.2,
    cognitiveLoad: Math.max(0.08, Math.min(0.75, Number(body.exertion || 0) * 0.55 + 0.12)),
  };
}

function memoryRecallOptionsForAgent(actor = {}, selected = {}, pending = [], anchorRuntime = null, memoryState = {}) {
  const ecology = actor.ecologyState || {};
  const body = ecology.body || ecology.bodyState || {};
  const affect = ecology.affect || {};
  const fatigue = Number.isFinite(Number(body.fatigue))
    ? Number(body.fatigue)
    : Number.isFinite(Number(body.energy)) ? 1 - Number(body.energy) : 0.2;
  const exertion = Number(body.exertion || 0);
  const arousal = Number.isFinite(Number(affect.arousal)) ? Number(affect.arousal) : 0.35;
  const valence = Number.isFinite(Number(affect.valence)) ? Math.abs(Number(affect.valence)) : 0.2;
  const matchingBeliefConfidence = Math.max(0, ...(memoryState.beliefs || []).map((belief) => Number(belief.confidence || 0)));
  const policy = anchorRuntime?.characterFoundation?.memoryPolicy
    || anchorRuntime?.memoryProjection?.policy
    || {};
  return {
    profile: deepClone(policy.retrievalParameters || policy.reconstructionParameters || {}),
    context: {
      fatigue: Math.max(0, Math.min(1, fatigue)),
      cognitiveLoad: Math.max(0.08, Math.min(1, exertion * 0.5 + pending.length * 0.055)),
      emotionalArousal: Math.max(0, Math.min(1, arousal)),
      currentAffectBias: Math.max(0, Math.min(1, valence)),
      currentBeliefBias: Math.max(0, Math.min(1, matchingBeliefConfidence * 0.45)),
      goalCongruence: Math.max(0.15, Math.min(1, Number(selected.score || selected.activationScore || 50) / 100)),
      interference: Math.max(0, Math.min(1, pending.length <= 1 ? 0.08 : 0.08 + (pending.length - 1) * 0.09)),
      rehearsal: 0,
      suppression: 0,
    },
  };
}

function commitDeliveryToCharacterMemory(workingState = {}, runtime = {}, impact = {}, delivery = {}) {
  const character = characterById(workingState, delivery.recipientId);
  const agent = runtime.agents?.[delivery.recipientId];
  if (!character || !agent) return null;
  const current = agent.memoryState || character.agentMemory || createCharacterAgentMemoryState(character.id);
  let next = encodeCharacterPerception(current, {
    impact,
    delivery,
    nowSeconds: memoryClockSeconds(runtime),
    worldDay: Number(runtime.slotContext?.day ?? runtime.macroDay ?? 0),
    locationId: runtime.locationId || LOCATION_ID,
    zoneId: agent.zoneId,
    encodingContext: memoryEncodingContextForDelivery(runtime, delivery),
    emotion: deepClone(agent.ecologyState?.affect || {}),
    desireIds: Object.keys(agent.ecologyState?.desires || {}),
    beliefMode: "deferred",
  });
  agent.memoryState = next;
  character.agentMemory = deepClone(next);
  return next;
}

function commitActionToActorMemory(workingState = {}, runtime = {}, action = {}, primaryImpact = null) {
  const actor = runtime.agents?.[action.actorId];
  if (!actor || !primaryImpact) return null;
  const selfImpact = {
    ...primaryImpact,
    id: `self:${primaryImpact.id}`,
    objectiveEventId: action.id,
    provenance: {
      ...(primaryImpact.provenance || {}),
      kind: "self_action",
      sourceActionId: action.id,
      speakerCharacterId: action.actorId,
      sourceCharacterChain: [action.actorId],
      confidence: 0.99,
    },
  };
  let next = commitDeliveryToCharacterMemory(workingState, runtime, selfImpact, {
    id: `self-delivery:${action.id}`,
    impactId: selfImpact.id,
    objectiveEventId: action.id,
    recipientId: action.actorId,
    sourceCharacterId: action.actorId,
    sourceZoneId: action.actorZoneId,
    recipientZoneId: actor.zoneId,
    type: primaryImpact.type,
    modality: "self_action",
    content: action.speech || action.visibleAction || primaryImpact.content,
    topic: action.commitmentTopic || primaryImpact.topic,
    route: [actor.zoneId],
    barriers: [],
    distance: 0,
    receivedIntensity: 100,
    personalRelevance: 70,
    impactScore: 160,
    directed: true,
    semanticFrame: deepClone(action.semanticFrame || primaryImpact.semanticFrame),
    provenance: deepClone(selfImpact.provenance),
    deliveredAtSeconds: runtime.elapsedSeconds,
    processedAtStep: runtime.step,
  });
  // A committed answer can settle the actor's own procedural obligation, but
  // it must not manufacture a belief for the listener. Belief adoption remains
  // exclusively owned by each recipient's later cognitive appraisal.
  if (next && ["settle", "refuse"].includes(action.threadDisposition) && action.semanticFrame?.decisionValue) {
    const sourceEpisodeId = next.episodes.find((episode) => episode.objectiveEventId === action.id)?.id || "";
    next = applyCharacterMemoryOutcome(next, {
      frame: action.semanticFrame,
      sourceEpisodeId,
      nowSeconds: memoryClockSeconds(runtime),
    });
    actor.memoryState = next;
    const character = characterById(workingState, action.actorId);
    if (character) character.agentMemory = deepClone(next);
  }
  return next;
}

function commitDeliveredEventAppraisal(workingState, runtime, impact, delivery) {
  const agent = runtime.agents?.[delivery.recipientId];
  const character = characterById(workingState, delivery.recipientId);
  if (!agent || !character) return null;
  const ensured = ensureTavernEcology(character, {
    present: agent.present !== false,
    zoneId: agent.zoneId,
    locationId: runtime.locationId || LOCATION_ID,
    elapsedSeconds: Number(agent.ecologyState?.elapsedSeconds || character.ecologyState?.elapsedSeconds || 0),
  });
  const ecologyState = agent.ecologyState || character.ecologyState || ensured.state;
  if (!ensured.profile || !ecologyState) return null;
  const sceneAbsoluteSecond = Number(agent.ecologySceneStartSeconds || 0)
    + Number(delivery.deliveredAtSeconds ?? runtime.elapsedSeconds ?? 0);
  const elapsedSeconds = Math.max(0, sceneAbsoluteSecond - Number(ecologyState.elapsedSeconds || 0));
  const relationship = impact.sourceCharacterId?.startsWith("world:") || delivery.identityKnown === false
    ? null
    : directedRelationshipFor(workingState, delivery.recipientId, impact.sourceCharacterId);
  const sourceActionId = impact.provenance?.sourceActionId || impact.causedByActionId || "";
  const appraisalEventId = impact.appraisalEventId
    || (sourceActionId ? `action_event:${sourceActionId}` : impact.id);
  const appraisalDelivery = { ...delivery, impactId: appraisalEventId };
  const appraisalImpact = {
    ...impact,
    id: appraisalEventId,
    sourceCharacterId: delivery.perceivedSourceCharacterId || delivery.sourceEntityHandle || impact.sourceCharacterId,
    content: delivery.content,
    topic: delivery.topic,
    semanticFrame: deepClone(delivery.semanticFrame || impact.semanticFrame),
    provenance: deepClone(delivery.provenance || impact.provenance),
  };
  const appraisal = appraiseTavernPerceivedEvent({
    profile: ensured.profile,
    ecologyState,
    delivery: appraisalDelivery,
    impact: appraisalImpact,
    relationship: relationship || {},
    elapsedSeconds,
  });
  const existingEntry = (runtime.eventAppraisals || []).find((entry) => (
    entry.recipientId === delivery.recipientId && entry.impactId === appraisalEventId
  ));
  if (!appraisal.applied) {
    if (appraisal.reason === "duplicate-impact" && existingEntry) {
      existingEntry.sourceImpactIds = [...new Set([...(existingEntry.sourceImpactIds || []), ...(delivery.sourceImpactIds || [delivery.impactId])])];
      delivery.eventAppraisalId = existingEntry.id;
    }
    return appraisal;
  }
  agent.ecologyState = deepClone(appraisal.nextState);
  agent.privateState.ecologyState = deepClone(appraisal.nextState);
  character.ecologyState = deepClone(appraisal.nextState);
  const eventEntry = {
    id: `event_appraisal:${delivery.id}`,
    recipientId: delivery.recipientId,
    sourceCharacterId: delivery.perceivedSourceCharacterId || delivery.sourceEntityHandle || "",
    impactId: appraisalEventId,
    sourceImpactIds: [...new Set(delivery.sourceImpactIds || [delivery.impactId])],
    deliveredAtSeconds: delivery.deliveredAtSeconds,
    copingBias: deepClone(appraisal.copingBias),
    observerTrace: deepClone(appraisal.observerTrace),
  };
  runtime.eventAppraisals.push(eventEntry);
  delivery.eventAppraisalId = eventEntry.id;
  return appraisal;
}

function commitGroupedActionEventAppraisals(workingState, runtime, action, impacts = []) {
  const impactsById = new Map(impacts.map((impact) => [impact.id, impact]));
  const byRecipient = new Map();
  for (const delivery of action.deliveries || []) {
    const rows = byRecipient.get(delivery.recipientId) || [];
    rows.push({ delivery, impact: impactsById.get(delivery.impactId) || {} });
    byRecipient.set(delivery.recipientId, rows);
  }
  for (const rows of byRecipient.values()) {
    rows.sort((left, right) => (
      Number(Boolean(right.delivery.directed)) - Number(Boolean(left.delivery.directed))
      || Number(right.impact.type === "speech") - Number(left.impact.type === "speech")
      || Number(right.delivery.impactScore || 0) - Number(left.delivery.impactScore || 0)
    ));
    const primary = rows[0];
    if (!primary) continue;
    const directed = rows.some((row) => row.delivery.directed);
    const directedRows = rows.filter((row) => row.delivery.directed);
    const targetRows = directedRows.length ? directedRows : rows;
    const sourceImpactIds = rows.map((row) => row.delivery.impactId);
    const content = [...new Set(rows.map((row) => row.impact.content || row.delivery.content).filter(Boolean))].join("；");
    const topic = [...new Set(rows.map((row) => row.impact.topic || row.delivery.topic).filter(Boolean))].join("；");
    const compositeImpact = {
      ...primary.impact,
      id: `action_event:${action.id}`,
      appraisalEventId: `action_event:${action.id}`,
      content,
      topic,
      cueIds: [...new Set(rows.flatMap((row) => row.impact.cueIds || []))],
      intensity: Math.max(...rows.map((row) => Number(row.impact.intensity || 0))),
      publicness: Math.max(...rows.map((row) => Number(row.impact.publicness || 0))),
      threat: Math.max(...targetRows.map((row) => Number(row.impact.threat || 0))) * (directed ? 1 : 0.45),
      controlDelta: directed ? targetRows.reduce((strongest, row) => (
        Math.abs(Number(row.impact.controlDelta || 0)) > Math.abs(strongest) ? Number(row.impact.controlDelta || 0) : strongest
      ), 0) : 0,
      repairOpportunity: directed ? Math.max(...targetRows.map((row) => Number(row.impact.repairOpportunity || 0))) : 0,
      committed: action.committed === true,
    };
    const compositeDelivery = {
      ...primary.delivery,
      impactId: compositeImpact.id,
      sourceImpactIds,
      directed,
      content,
      topic,
      receivedIntensity: Math.max(...rows.map((row) => Number(row.delivery.receivedIntensity || 0))),
      impactScore: Math.max(...rows.map((row) => Number(row.delivery.impactScore || 0))),
    };
    commitDeliveredEventAppraisal(workingState, runtime, compositeImpact, compositeDelivery);
    const eventAppraisalId = (runtime.eventAppraisals || []).find((entry) => (
      entry.recipientId === compositeDelivery.recipientId && entry.impactId === compositeImpact.id
    ))?.id || "";
    for (const row of rows) row.delivery.eventAppraisalId = eventAppraisalId;
  }
}

function ecologyForCandidate(
  state,
  runtime,
  agent,
  strongest,
  subjectivePending = null,
  subjectivePerceivedCharacters = null,
) {
  const character = characterById(state, agent.characterId) || {};
  const perceivedCharacters = subjectivePerceivedCharacters
    || perceivedCharactersFor(state, runtime, agent.characterId);
  const perceivedCharacterIds = perceivedCharacters.map((characterRow) => characterRow.id);
  const recognizedCharacterIds = perceivedCharacters
    .filter((characterRow) => characterRow.identityKnown === true)
    .map((characterRow) => characterRow.id);
  const ownedRecognizedRelationships = (state.relationships || []).filter((relationship) => (
    relationship.fromCharacterId === agent.characterId
    && recognizedCharacterIds.includes(relationship.toCharacterId)
  ));
  const ownVisit = (state.tavernState?.activeVisits || []).find((visit) => visit.visitorId === agent.characterId);
  const situatedPosition = (state.tavernState?.institution?.guestPositions || []).find((position) => (
    position.id === ownVisit?.seatingPositionId
  )) || null;
  return appraiseTavernAgentEcology({
    character: { ...character, ecologyState: agent.ecologyState || character.ecologyState },
    runtime,
    actor: agent,
    pendingImpacts: strongest
      ? [strongest, ...((subjectivePending || (agent.inbox || []))
        .filter((delivery) => (
          delivery.processedAtStep == null
          && delivery.id !== strongest.id
          && isFreshExternalDelivery(runtime, delivery)
        )))].slice(0, 8)
      : [],
    visibleCharacterIds: perceivedCharacterIds,
    recognizedCharacterIds,
    availableAffordances: listTavernCausalAffordances(state, runtime, agent.characterId, perceivedCharacterIds),
    recentOwnActions: (runtime.actions || []).filter((action) => action.actorId === agent.characterId).slice(-4),
    relationships: ownedRecognizedRelationships,
    situatedPosition,
  });
}

const CHARACTER_INTERNAL_WAKE_THRESHOLD = 34;

function continuationWakeBasis(runtime = {}, agent = {}, strongest = null) {
  const carryover = agent.ecologyState?.characterPsychologyV2State
    || agent.privateState?.ecologyState?.characterPsychologyV2State
    || {};
  const currentCharacterSeconds = Number(agent.ecologySceneStartSeconds || 0) + Number(runtime.elapsedSeconds || 0);
  const internalPressure = Math.max(0, Math.min(1, Number(carryover.internalWakePressure || 0)));
  const sourceHandle = strongest?.perceivedSourceCharacterId
    || strongest?.sourceCharacterId
    || strongest?.recognizedIdentity?.characterId
    || strongest?.sourceEntityHandle
    || "";
  const maturedIntentions = [];
  for (const intention of carryover.continuationIntentions || []) {
    if (intention?.status && intention.status !== "active") continue;
    const ageSeconds = Math.max(0, currentCharacterSeconds - Number(intention.createdAtCharacterSeconds || 0));
    const threshold = Math.max(0, Math.min(1, Number(intention.triggerThreshold ?? 0.5)));
    const targetMatches = !intention.targetHandle || intention.targetHandle === sourceHandle;
    let mature = false;
    let reason = "";
    if (intention.triggerType === "elapsed_without_progress"
      && ageSeconds >= Number(intention.minimumDelaySeconds || 0)) {
      mature = true;
      reason = "authored-delay-elapsed";
    } else if (intention.triggerType === "internal_pressure" && internalPressure >= threshold) {
      mature = true;
      reason = "internal-pressure-threshold";
    } else if (intention.triggerType === "new_relevant_evidence" && strongest) {
      mature = true;
      reason = "new-perceived-impact";
    } else if (intention.triggerType === "target_response" && strongest && targetMatches) {
      mature = true;
      reason = "target-originated-impact";
    } else if (intention.triggerType === "target_attention_confirmed"
      && strongest && targetMatches && strongest.actionKind === "observe") {
      mature = true;
      reason = "target-attention-impact";
    }
    if (mature) maturedIntentions.push({
      intentionId: intention.intentionId || "",
      triggerType: intention.triggerType || "",
      reason,
      ageSeconds,
    });
  }
  return { internalPressure, maturedIntentions };
}

function candidateScore(state, runtime, agent) {
  const pending = (agent.inbox || []).filter((delivery) => (
    delivery.processedAtStep == null
    && isFreshExternalDelivery(runtime, delivery)
    && (
      delivery.noticedProjection
      || !Number.isFinite(Number(delivery.attentionDeferredUntilSeconds))
      || Number(delivery.attentionDeferredUntilSeconds) <= Number(runtime.elapsedSeconds || 0)
    )
  ));
  const strongest = pending.slice().sort((a, b) => b.impactScore - a.impactScore)[0] || null;
  const ecology = ecologyForCandidate(state, runtime, agent, strongest);
  const continuationWake = continuationWakeBasis(runtime, agent, strongest);
  const continuationPlanPressure = continuationWake.maturedIntentions.length
    ? 36 + Math.min(8, continuationWake.maturedIntentions.length * 4)
    : 0;
  const privatePressure = continuationWake.internalPressure * 40;
  if (!ecology) {
    const legacyImpactPressure = strongest?.impactScore || 0;
    const legacyFirstMovePressure = agent.hasActed ? 0 : Number(agent.intrinsicPressure || 0);
    const legacyOnPassCooldown = Number(agent.cooldownUntilSeconds || 0) > Number(runtime.elapsedSeconds || 0);
    const legacyCooldownPenalty = legacyOnPassCooldown ? (strongest?.directed ? 48 : 1_000) : 0;
    const legacyRepetitionPenalty = runtime.lastActorId === agent.characterId ? 22 : 0;
    const wakeReasons = [
      ...(strongest ? ["perceived-world-impact"] : []),
      ...(legacyFirstMovePressure >= CHARACTER_INTERNAL_WAKE_THRESHOLD ? ["intrinsic-pressure"] : []),
      ...(continuationWake.maturedIntentions.length ? ["matured-continuation-intention"] : []),
    ];
    return {
      score: legacyImpactPressure
        + legacyFirstMovePressure * (legacyImpactPressure ? 0.22 : 1)
        + continuationPlanPressure
        + privatePressure
        - legacyCooldownPenalty
        - legacyRepetitionPenalty,
      strongest,
      ecology: null,
      priorityTier: 0,
      feasible: true,
      wakeBasis: {
        qualifying: wakeReasons.length > 0,
        kind: strongest ? "external-impact" : continuationWake.maturedIntentions.length ? "continuation-intention" : "internal-pressure",
        reasons: wakeReasons,
        externalImpactScore: Number(strongest?.impactScore || 0),
        internalEcologyScore: legacyFirstMovePressure,
        internalPsychologyPressure: continuationWake.internalPressure,
        maturedContinuationIntentions: continuationWake.maturedIntentions,
      },
    };
  }
  const ecologyPressure = Number(ecology?.activationScore || 0);
  const impactPressure = strongest?.directed ? Math.min(18, Number(strongest.impactScore || 0) * 0.12) : 0;
  const firstMovePressure = agent.hasActed ? 0 : Number(agent.intrinsicPressure || 0) * 0.14;
  // A voluntary pass means "not now", not "activate me again before anyone
  // else can react".  Keep a direct new impact capable of interrupting that
  // short cooldown, while non-directed and intrinsic pressure must yield the
  // floor until another present Character has had a chance or time advances.
  const onPassCooldown = Number(agent.cooldownUntilSeconds || 0) > Number(runtime.elapsedSeconds || 0);
  const cooldownPenalty = onPassCooldown ? (strongest?.directed ? 48 : 1_000) : 0;
  const repetitionPenalty = runtime.lastActorId === agent.characterId ? 22 : 0;
  const priorityTier = Number(ecology.priorityTier || 0);
  // Priority tiers order genuine obligations, but a non-directed stimulus may
  // not let an actor on cooldown reserve the scheduling floor. Demote only the
  // scheduler's effective tier; the Character Agent's private appraisal stays
  // intact, and a fresh directed impact can still interrupt the cooldown.
  const effectivePriorityTier = onPassCooldown && !strongest?.directed ? 0 : priorityTier;
  const wakeReasons = [
    ...(strongest ? ["perceived-world-impact"] : []),
    ...(effectivePriorityTier > 0 ? ["live-obligation"] : []),
    ...(ecologyPressure >= CHARACTER_INTERNAL_WAKE_THRESHOLD ? ["active-desire-or-duty-pressure"] : []),
    ...(continuationWake.internalPressure >= 0.5 ? ["accumulated-private-pressure"] : []),
    ...(continuationWake.maturedIntentions.length ? ["matured-continuation-intention"] : []),
  ];
  return {
    score: ecologyPressure
      + impactPressure
      + firstMovePressure
      + continuationPlanPressure
      + privatePressure
      - cooldownPenalty
      - repetitionPenalty,
    strongest,
    ecology,
    priorityTier: effectivePriorityTier,
    feasible: Boolean((ecology.appraisal?.candidates || []).some((candidate) => candidate.feasible)),
    wakeBasis: {
      qualifying: wakeReasons.length > 0,
      kind: strongest
        ? "external-impact"
        : continuationWake.maturedIntentions.length
          ? "continuation-intention"
          : effectivePriorityTier > 0
            ? "obligation"
            : "internal-pressure",
      reasons: wakeReasons,
      externalImpactScore: Number(strongest?.impactScore || 0),
      internalEcologyScore: ecologyPressure,
      internalPsychologyPressure: continuationWake.internalPressure,
      maturedContinuationIntentions: continuationWake.maturedIntentions,
    },
  };
}

function awaitingRequestDelivery(runtime = {}, lock = {}) {
  if (!lock?.latestActionId || !lock?.responderId) return null;
  const responder = runtime.agents?.[lock.responderId];
  if (!responder?.present) return null;
  const candidateImpacts = new Set((runtime.impacts || [])
    .filter((impact) => (
      impact.causedByActionId === lock.latestActionId
      && impact.sourceCharacterId === lock.requesterId
      && impact.directedTargetId === lock.responderId
      && impact.modality === "sound"
    ))
    .map((impact) => impact.id));
  return (responder.inbox || [])
    .filter((delivery) => delivery.processedAtStep == null && candidateImpacts.has(delivery.impactId))
    .sort((a, b) => b.impactScore - a.impactScore)[0] || null;
}

function latestAwaitingRequest(runtime = {}) {
  return latestAwaitingInteraction(runtime.requestLocks || [], {
    participantAvailable: (characterId) => Boolean(runtime.agents?.[characterId]?.present),
    requestHasDelivery: (request) => Boolean(awaitingRequestDelivery(runtime, request)),
  });
}

function awaitingSharedActivityDelivery(runtime = {}, activity = {}, responderId = "") {
  const latestActionId = [...(activity.sourceActionIds || [])].filter(Boolean).at(-1) || "";
  if (!latestActionId || !responderId) return null;
  const responder = runtime.agents?.[responderId];
  if (!responder?.present) return null;
  const candidateImpacts = new Set((runtime.impacts || [])
    .filter((impact) => impact.causedByActionId === latestActionId)
    .map((impact) => impact.id));
  return (responder.inbox || [])
    .filter((delivery) => delivery.processedAtStep == null && candidateImpacts.has(delivery.impactId))
    .sort((a, b) => b.impactScore - a.impactScore)[0] || null;
}

function latestPendingSharedActivityResponse(runtime = {}) {
  for (const activity of [...(runtime.sharedActivities || [])].reverse()) {
    if (!["proposed", "countered"].includes(activity?.status)) continue;
    const pendingIds = (activity.pendingResponseCharacterIds || activity.participantIds || [])
      .filter((characterId) => activity.consentByCharacterId?.[characterId] === "pending");
    for (const responderId of pendingIds) {
      const delivery = awaitingSharedActivityDelivery(runtime, activity, responderId);
      if (delivery) return { activity, responderId, delivery };
    }
  }
  return null;
}

function requestLockForSelection(runtime = {}, selected = {}) {
  return interactionForResponder(runtime.requestLocks || [], selected.characterId, {
    sourceImpactId: selected.sourceImpactId,
    deliveryForRequest: (request) => awaitingRequestDelivery(runtime, request),
  });
}

function pendingThreadImpactForDecision(runtime = {}, actorId = "", decision = {}) {
  if (!decision.speech || !decision.targetCharacterId) return null;
  // A persisted thread is a reply source only while its concrete request lock
  // still awaits this actor. The broader commitment record can remain open for
  // auditing after an answer; using that alone would make the original asker
  // answer the descendant answer and randomly restart a closed conversation.
  const matchingLocks = (runtime.requestLocks || [])
    .filter((lock) => (
      ["awaiting", "unresolved"].includes(lock.status)
      && lock.responderId === actorId
      && lock.requesterId === decision.targetCharacterId
    ))
    .sort((left, right) => Number(right.openedAtStep || 0) - Number(left.openedAtStep || 0));
  for (const lock of matchingLocks) {
    const delivery = awaitingRequestDelivery(runtime, lock);
    if (delivery) return delivery;
  }
  return null;
}

export function selectNextCausalAgent(runtime = {}, { minimumScore = 34, state = {} } = {}) {
  const awaitingSharedActivity = latestPendingSharedActivityResponse(runtime);
  if (awaitingSharedActivity) {
    const agent = runtime.agents[awaitingSharedActivity.responderId];
    const ecology = ecologyForCandidate(state, runtime, agent, awaitingSharedActivity.delivery);
    return {
      characterId: agent.characterId,
      score: Math.max(110, Math.round(candidateScore(state, runtime, agent).score)),
      sourceImpactId: awaitingSharedActivity.delivery.impactId,
      deliveryId: awaitingSharedActivity.delivery.id,
      ecology,
      requestLockId: "",
      sharedActivityId: awaitingSharedActivity.activity.activityId,
      localInteractionPriority: true,
      wakeBasis: {
        qualifying: true,
        kind: "shared-activity-consent",
        reasons: ["pending-owned-shared-activity-response"],
        externalImpactScore: Number(awaitingSharedActivity.delivery.impactScore || 0),
        internalEcologyScore: Number(ecology?.activationScore || 0),
        internalPsychologyPressure: 0,
        maturedContinuationIntentions: [],
      },
    };
  }
  const awaitingLock = latestAwaitingRequest(runtime);
  if (awaitingLock) {
    const agent = runtime.agents[awaitingLock.responderId];
    const delivery = awaitingRequestDelivery(runtime, awaitingLock);
    const ecology = ecologyForCandidate(state, runtime, agent, delivery);
    return {
      characterId: agent.characterId,
      score: Math.max(100, Math.round(candidateScore(state, runtime, agent).score)),
      sourceImpactId: delivery.impactId,
      deliveryId: delivery.id,
      ecology,
      requestLockId: awaitingLock.id,
      localInteractionPriority: true,
      wakeBasis: {
        qualifying: true,
        kind: "direct-request",
        reasons: ["unanswered-directed-request"],
        externalImpactScore: Number(delivery.impactScore || 0),
        internalEcologyScore: Number(ecology?.activationScore || 0),
        internalPsychologyPressure: 0,
        maturedContinuationIntentions: [],
      },
    };
  }
  const ranked = Object.values(runtime.agents || {})
    .filter((agent) => agent.present)
    .map((agent) => ({ agent, ...candidateScore(state, runtime, agent) }))
    .filter((candidate) => candidate.wakeBasis?.qualifying === true)
    .sort((a, b) => (
      Number(b.feasible) - Number(a.feasible)
      || Number(b.priorityTier || 0) - Number(a.priorityTier || 0)
      || b.score - a.score
      || a.agent.characterId.localeCompare(b.agent.characterId)
    ));
  const selected = ranked[0];
  if (!selected?.feasible || selected.score < minimumScore) return null;
  const sourceImpactId = selected.strongest?.impactId || "";
  const selectedDelivery = sourceImpactId
    ? (selected.agent.inbox || []).find((delivery) => (
      delivery.impactId === sourceImpactId
      && delivery.processedAtStep == null
      && isFreshExternalDelivery(runtime, delivery)
    ))
    : null;
  return {
    characterId: selected.agent.characterId,
    score: Math.round(selected.score),
    priorityTier: Number(selected.priorityTier || 0),
    sourceImpactId,
    deliveryId: selectedDelivery?.id || "",
    ecology: selected.ecology,
    wakeBasis: deepClone(selected.wakeBasis || null),
  };
}

function identityIsKnown(state, actorId, otherId) {
  const actor = characterById(state, actorId) || {};
  const other = characterById(state, otherId) || {};
  const validatedRuntime = validatedSceneRuntimeFor(actor);
  if (validatedRuntime) {
    return validatedRecognizedIdentityIds(validatedRuntime, actor).has(otherId);
  }
  if (relationshipExistsBetween(state, actorId, otherId)) return true;
  const knownActorIds = new Set([
    ...(actor.lifeState?.knownActorIds || []),
    ...(actor.lifeProfile?.knownActorIds || []),
    ...(sceneAgencyFor(actor).knowledgeBoundary?.knownActorIds || []),
  ]);
  if (knownActorIds.has(otherId)) return true;
  const ownMemoryText = [
    ...(state.characterMemories || [])
      .filter((memory) => memory.characterId === actorId)
      .map((memory) => `${memory.content || ""} ${memory.privateVersion || ""}`),
    ...(sceneAgencyFor(actor).knowledgeBoundary?.publicFacts || []),
    ...(sceneAgencyFor(actor).knowledgeBoundary?.privateFacts || []),
  ].join(" ");
  return Boolean(other.name && ownMemoryText.includes(other.name));
}

function unknownVisibleRole(agent = {}) {
  return {
    manager: "掌柜",
    proprietor: "酒馆东家",
    household_worker: "酒馆帮工",
    visitor: "来客",
  }[agent.standing] || "场中人";
}

function routedPublicSignalFeature(feature = {}, runtime = {}, observerZoneId = "", subjectZoneId = "") {
  const modality = perceptionModality(feature.modality);
  if (["touch", "proprioception"].includes(modality)) return null;
  const routeModality = modality === "visual" ? "visual" : "sound";
  const route = spatialRoute(runtime.topology, subjectZoneId, observerZoneId, routeModality);
  if (!route) return null;
  const maximumDistance = {
    visual: 2,
    sound: 4,
    smell: 2,
    vibration: 0,
  }[modality] ?? 0;
  if (Number(route.distance) > maximumDistance) return null;
  const distanceLossPerUnit = {
    visual: 0.13,
    sound: 0.1,
    smell: 0.24,
    vibration: 0.35,
  }[modality] ?? 0.2;
  const authoredTransmission = feature.transmission || {};
  return {
    ...deepClone(feature),
    sourceZoneId: subjectZoneId,
    transmission: {
      ...deepClone(authoredTransmission),
      factor: perceptionUnit(authoredTransmission.factor, 1),
      distanceLoss: perceptionUnit(
        perceptionUnit(authoredTransmission.distanceLoss)
          + Math.max(0, Number(route.distance || 0)) * distanceLossPerUnit,
      ),
      barrierLoss: perceptionUnit(
        perceptionUnit(authoredTransmission.barrierLoss)
          + (route.barriers || []).length * 0.28,
      ),
      occlusion: perceptionUnit(authoredTransmission.occlusion),
    },
    route: {
      modality: routeModality,
      distance: Number(route.distance || 0),
      barriers: [...(route.barriers || [])],
    },
  };
}

function perceivedCharactersFor(state, runtime, actorId) {
  const actor = runtime.agents?.[actorId];
  if (!actor) return [];
  const observations = [
    ...(actor.inbox || []),
    ...(actor.perceptionMemory || []),
  ];
  return Object.values(runtime.agents || []).map((other) => {
    if (!other.present || other.characterId === actorId) return false;
    const spatialPerception = perceiveEntity({
      observer: actor,
      subject: other,
      observations,
      nowSeconds: runtime.elapsedSeconds || 0,
      routeFor: (fromZoneId, toZoneId, modality) => spatialRoute(runtime.topology, fromZoneId, toZoneId, modality),
    });
    const observableSignalFeatures = (other.publicSignalFeatures || [])
      .map((feature) => routedPublicSignalFeature(feature, runtime, actor.zoneId, other.zoneId))
      .filter(Boolean);
    const featureModalities = new Set(observableSignalFeatures.map((feature) => feature.modality));
    const canSee = Boolean(spatialPerception?.canSee || featureModalities.has("visual"));
    const canHear = Boolean(spatialPerception?.canHear || featureModalities.has("sound"));
    const canSmell = featureModalities.has("smell");
    const canFeelVibration = featureModalities.has("vibration");
    if (!spatialPerception && observableSignalFeatures.length === 0) return null;
    const perceptionMode = canSee
      ? (canHear ? "visible-and-audible" : "visible")
      : canHear ? "audible-only"
        : canSmell ? "smell-only"
          : canFeelVibration ? "vibration-only" : "signal-only";
    const identityKnown = identityIsKnown(state, actorId, other.characterId);
    return {
      id: other.characterId,
      name: identityKnown ? other.characterName : "",
      identityKnown,
      role: identityKnown ? other.role : unknownVisibleRole(other),
      standing: other.standing,
      perception: perceptionMode,
      observableModalities: [...featureModalities],
      publicSignalFeatures: observableSignalFeatures,
      zoneId: canSee ? other.zoneId : "",
      zoneLabel: canSee
        ? runtime.topology.zones?.[other.zoneId]?.label || other.zoneId
        : canHear ? "声音传来的方向" : canSmell ? "气味传来的方向" : "震动传来的方向",
      currentVisibleActivity: canSee ? other.currentVisibleActivity || "" : "",
    };
  }).filter(Boolean);
}

export function buildTavernOwnedRelationshipContext(state, actorId, perceivedCharacters) {
  const perceivedIds = new Set(perceivedCharacters.map((character) => character.id));
  const ownerCharacter = characterById(state, actorId) || {};
  const ownedImpressions = ownerCharacter.agentMemory?.impressions || [];
  const validatedRuntime = validatedSceneRuntimeFor(ownerCharacter);
  const recognizedIdentityIds = validatedRecognizedIdentityIds(validatedRuntime, ownerCharacter);
  return (state.relationships || []).filter((relationship) => (
    relationship.fromCharacterId === actorId
    && perceivedIds.has(relationship.toCharacterId)
    && (!validatedRuntime || recognizedIdentityIds.has(relationship.toCharacterId))
  )).map((relationship) => {
    const otherId = relationship.toCharacterId;
    const authoredAddressing = getTavernAddressingRule(actorId, otherId);
    const addressing = relationship.addressingRule
      ? {
          addressingRule: relationship.addressingRule,
          allowedAddresses: relationship.allowedAddresses?.length
            ? [...relationship.allowedAddresses]
            : [...(authoredAddressing.allowedAddresses || [])],
        }
      : authoredAddressing;
    const ownedImpression = ownedImpressions.find((impression) => impression.targetCharacterId === otherId) || null;
    return {
      otherCharacterId: otherId,
      label: relationship.label || "已有关系",
      ...addressing,
      publicPressure: {
        closeness: clamp((Number(relationship.dependence || 0) + Number(relationship.protection || 0)) / 2),
        tension: clamp((Number(relationship.resentment || 0) + Number(relationship.fear || 0)) / 2),
      },
      ownedImpression: ownedImpression ? {
        id: ownedImpression.id || "",
        summary: text(ownedImpression.summary, 240),
        dimensions: deepClone(ownedImpression.dimensions || {}),
        sourceType: ownedImpression.sourceType || "",
        sourceEpisodeIds: [...(ownedImpression.sourceEpisodeIds || [])],
        recentAppraisals: deepClone(ownedImpression.recentAppraisals || []).slice(-6),
      } : null,
    };
  });
}

function leadingAddress(speech = "", input = {}) {
  const line = text(speech, 180);
  const roleAddresses = ["这位客官", "客官", "掌柜", "掌灶", "东家", "长老"];
  // Detect common kinship terms even when they are not allowed in the acting
  // person's relationship card; otherwise an invalid address such as a spouse
  // calling the other person “爹” would be treated as no address at all.
  const kinshipAddresses = ["爹爹", "娘亲", "父亲", "母亲", "伯父", "伯母", "叔父", "婶娘", "爹", "娘"];
  const relationshipAddresses = (input.agent?.relationshipContext || [])
    .flatMap((relationship) => relationship.allowedAddresses || []);
  const known = [...new Set([...relationshipAddresses, ...roleAddresses, ...kinshipAddresses])]
    .sort((left, right) => right.length - left.length);
  const explicitAddress = known.find((alias) => new RegExp(`^${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[，,：:\\s]|$)`).test(line));
  if (explicitAddress) return explicitAddress;
  // Role titles are often prefixed by a family name (for example “谢掌柜”).
  // Return the canonical role portion so role validation and relationship
  // address rules still share one vocabulary instead of learning every name.
  const prefixedRole = line.match(/^[\p{Script=Han}]{1,2}(这位客官|客官|掌柜|掌灶|东家|长老)(?:[，,：:\s]|$)/u);
  return prefixedRole?.[1] || "";
}

function roleAddressViolation(input = {}, targetCharacterId = "", address = "") {
  if (!targetCharacterId || !address) return null;
  const target = (input.perceivedCharacters || []).find((character) => character.id === targetCharacterId) || null;
  const requirements = [
    { pattern: /掌柜$/, validate: (standing) => standing === "manager", label: "掌柜只能指本场景中承担掌柜职责的人" },
    { pattern: /掌灶$/, validate: () => false, label: "当前场景没有声明“掌灶”这一公开职务" },
    { pattern: /东家$/, validate: (standing) => standing === "proprietor", label: "东家只能指本场景的经营所有人" },
    { pattern: /(?:这位)?客官$/, validate: (standing) => standing === "visitor" || standing.endsWith("_guest"), label: "客官只能指当前来店访客" },
  ];
  const requirement = requirements.find((item) => item.pattern.test(address));
  if (!requirement) return null;
  if (requirement.validate(target?.standing || "")) return null;
  return {
    code: "DIALOGUE_ROLE_ADDRESS_MISMATCH",
    field: "utterance",
    message: `称呼“${address}”与公开对话对象不一致：${requirement.label}。`,
    evidence: { targetCharacterId, targetStanding: target?.standing || "", address },
  };
}

function directedAddressViolation(input = {}, targetCharacterId = "", speech = "") {
  if (!targetCharacterId || !speech) return null;
  const address = leadingAddress(speech, input);
  const roleViolation = roleAddressViolation(input, targetCharacterId, address);
  if (roleViolation) return roleViolation;
  const relationship = (input.agent?.relationshipContext || []).find((item) => item.otherCharacterId === targetCharacterId);
  const allowedAddresses = relationship?.allowedAddresses || [];
  if (!allowedAddresses.length) return null;
  if (!address || allowedAddresses.includes(address)) return null;
  return {
    code: "DIALOGUE_ADDRESS_NOT_ALLOWED",
    field: "utterance",
    message: `当前关系下不能用“${address}”称呼对方；可用称呼为${allowedAddresses.join("、")}。`,
    evidence: { actorId: input.agent?.id || "", targetCharacterId, address, allowedAddresses: [...allowedAddresses] },
  };
}

function tavernSocialBoundariesForActor(state, runtime, actorId) {
  const authoredBoundaries = [
    ...(runtime.topology?.socialBoundaries || []),
    ...(state.tavernState?.socialBoundaries || []),
  ].map((boundary) => deepClone(boundary));
  const activeVisit = (state.tavernState?.activeVisits || []).find((visit) => visit.visitorId === actorId && !["completed", "refused", "abandoned"].includes(visit.stage));
  if (!activeVisit?.allowedZoneIds?.length) return authoredBoundaries;
  const sociallyGrantedByVisit = new Set(activeVisit.allowedZoneIds);
  const sociallyUnpermittedZoneIds = Object.keys(runtime.topology?.zones || {})
    .filter((candidateZoneId) => !sociallyGrantedByVisit.has(candidateZoneId));
  if (!sociallyUnpermittedZoneIds.length) return authoredBoundaries;
  return [
    ...authoredBoundaries,
    {
      id: `social-boundary:visit-scope:${activeVisit.id || actorId}`,
      zoneIds: sociallyUnpermittedZoneIds,
      permissionRequiredByNorm: true,
      evidenceIds: [`social-fact:visit-scope:${activeVisit.id || actorId}`],
      claimantIds: [...new Set([
        activeVisit.hostId,
        ...(activeVisit.expectedHostIds || []),
      ].filter(Boolean))],
      possibleResponseTags: ["ignore", "question", "warn", "intervene"],
      source: "legacy-visit-social-scope",
    },
  ];
}

function tavernObjectiveSocialFactsForActor(state, runtime, actor, perceivedCharacterIds = []) {
  const visibleIds = new Set([actor.characterId, ...(perceivedCharacterIds || [])]);
  const facts = [
    ...(runtime.socialFacts || []),
    ...(state.tavernState?.socialFacts || []),
  ];
  for (const boundary of tavernSocialBoundariesForActor(state, runtime, actor.characterId)) {
    facts.push({
      factId: boundary.id || `social-boundary:${actor.characterId}:${(boundary.zoneIds || []).join("+")}`,
      kind: "access_claim",
      subjectId: actor.characterId,
      entityId: runtime.locationId || LOCATION_ID,
      zoneIds: [...new Set(boundary.zoneIds || [])],
      claimantIds: [...new Set(boundary.claimantIds || [])],
      topic: "claimed_access_boundary",
      possibleResponseTags: [...new Set(boundary.possibleResponseTags || [])],
      sourceEvidenceIds: [...new Set(boundary.evidenceIds || [])],
    });
  }
  for (const visit of state.tavernState?.activeVisits || []) {
    if (["completed", "refused", "abandoned"].includes(visit.stage)) continue;
    if (!visibleIds.has(visit.visitorId)) continue;
    const disclosureEvidenceId = visit.purposeDeclaredByActionId || visit.arrivalActionId || visit.id;
    facts.push({
      factId: `social-fact:visit:${visit.id}`,
      kind: visit.purposeDisclosureStatus === "declared" || visit.purposeStatus === "declared"
        ? "declared_request"
        : "arrival",
      actorId: visit.visitorId,
      addresseeIds: [],
      entityId: runtime.locationId || LOCATION_ID,
      topic: visit.purposeDisclosureStatus === "declared" || visit.purposeStatus === "declared"
        ? (visit.declaredPurpose || visit.purpose || "declared_visit")
        : "person_arrived",
      sourceEvidenceIds: disclosureEvidenceId ? [disclosureEvidenceId] : [],
      occurredAtSeconds: Number(visit.arrivedAtSeconds ?? runtime.elapsedSeconds ?? 0),
    });
  }
  return normalizeObjectiveSocialFacts(facts);
}

export function tavernMovementOptionsForActor(state, runtime, actorId, zoneId) {
  return projectAdjacentMovementOptions({
    topology: runtime.topology,
    fromZoneId: zoneId,
    actorId,
    socialBoundaries: tavernSocialBoundariesForActor(state, runtime, actorId),
    accessGrants: runtime.accessGrants || [],
    step: runtime.step,
  });
}

function reachableZones(state, runtime, actorId, zoneId) {
  return tavernMovementOptionsForActor(state, runtime, actorId, zoneId);
}

function publicPerceivedImpacts(deliveries = []) {
  return deliveries.map((delivery) => {
    const semanticFrame = deepClone(delivery.semanticFrame || null);
    if (semanticFrame?.roles && delivery.identityKnown === false) {
      for (const [role, characterId] of Object.entries(semanticFrame.roles)) {
        if (characterId === delivery.sourceCharacterId) semanticFrame.roles[role] = delivery.sourceEntityHandle;
      }
    }
    return {
      evidenceId: delivery.evidenceId || delivery.impactId,
      impactId: delivery.impactId,
      objectiveEventId: delivery.objectiveEventId || "",
      sourceCharacterId: delivery.perceivedSourceCharacterId || "",
      sourceEntityHandle: delivery.sourceEntityHandle || "",
      identityKnown: delivery.identityKnown !== false,
      recognizedIdentity: deepClone(delivery.recognizedIdentity || null),
      type: delivery.type,
      modality: delivery.modality,
      content: delivery.content,
      topic: delivery.topic,
      observableAffectiveTexture: observableAffectiveTexture(delivery.observableAffectiveTexture),
      speechAct: delivery.speechAct || "none",
      speechFunctions: [...(delivery.speechFunctions || [])],
      directed: delivery.directed,
      semanticFrame,
      provenance: deepClone(delivery.provenance),
      perceptPacket: deepClone(delivery.perceptPacket || null),
    };
  });
}

function dialogueSurfaceSignalsForTurn(turn = {}, state = {}) {
  const utterance = text(turn.utterance || turn.line, 500);
  const speechFunctions = Array.isArray(turn.speechFunctions) && turn.speechFunctions.length
    ? [...new Set(turn.speechFunctions.filter(Boolean))]
    : inferPublicSpeechFunctions({ speech: utterance, speechAct: turn.speechAct || turn.action || "none" });
  const mentionedCharacterNames = (state.characters || [])
    .map((character) => text(character.name, 80))
    .filter((name) => name && utterance.includes(name));
  const statedVisitIntents = [];
  if (/(?:^|[，。！!；;、\s])(?:我)?(?:是来|来|要|想)?(?:找人|寻人)(?:[，。！!；;、\s]|$)/u.test(utterance)) statedVisitIntents.push("seek_person");
  if (/(?:住店|投宿|要间房|住一晚)/u.test(utterance)) statedVisitIntents.push("lodging");
  if (/(?:吃饭|用饭|热饭|来(?:碗|份).{0,4}饭)/u.test(utterance)) statedVisitIntents.push("meal");
  if (/(?:喝茶|来(?:壶|碗|杯).{0,4}茶|要茶)/u.test(utterance)) statedVisitIntents.push("tea");
  if (/(?:打听|问路|问个?消息)/u.test(utterance)) statedVisitIntents.push("seek_information");
  const questionKinds = [];
  if (speechFunctions.includes("ask")) {
    if (/(?:是你吗|可是你|你是|你是不是|莫非是你)/u.test(utterance)) questionKinds.push("identity_confirmation");
    if (/(?:找|寻).{0,4}(?:谁|哪位)|找的是谁/u.test(utterance)) questionKinds.push("sought_person");
    if (/(?:来意|来做什么|什么事|为何而来)/u.test(utterance)) questionKinds.push("visit_purpose");
    if (/(?:住店|吃饭|用饭|喝茶).{0,8}(?:还是|或|要不要)/u.test(utterance)) questionKinds.push("service_choice");
    if (!questionKinds.length) questionKinds.push("other");
  }
  return {
    turnId: turn.id || turn.turnId || "",
    speakerId: turn.speakerId || "",
    utterance,
    speechFunctions,
    mentionedCharacterNames: [...new Set(mentionedCharacterNames)],
    statedVisitIntents: [...new Set(statedVisitIntents)],
    questionKinds: [...new Set(questionKinds)],
  };
}

function publicDialogueContentLedger(turns = [], state = {}) {
  const rows = turns.map((turn) => dialogueSurfaceSignalsForTurn(turn, state));
  return {
    authority: "literal-public-turns-only",
    truthStatus: "not-verified",
    rule: "这里只登记当事人确实听见的字面内容，不保证为真。人物可以怀疑、误听、逗弄或故意要求重说；若再次询问已经字面给出的信息，应由人物自己的认知或表达目的造成，而不是系统遗失上句。",
    mentionedCharacterNames: [...new Set(rows.flatMap((row) => row.mentionedCharacterNames))],
    statedVisitIntents: [...new Set(rows.flatMap((row) => row.statedVisitIntents))],
    latestTurn: rows.at(-1) || null,
  };
}

function privateConversationThreadsForAgent(state = {}, runtime = {}, actorId = "") {
  const threads = new Map();
  for (const thread of state.tavernState?.eventThreads || []) {
    if (!thread?.id || !(thread.participantIds || []).includes(actorId)) continue;
    const myState = ensureRuntimeParticipantThreadState(runtime, thread.id, actorId)
      || migratedParticipantThreadState(thread, actorId);
    if (thread.status !== "open" && myState.selfClosure === "closed_for_self") continue;
    const storedTurns = thread.turns || [];
    const lastOwnedUptakeTurnId = myState.lastReceivedTurnId || myState.lastAppraisedTurnId || "";
    const lastOwnedUptakeIndex = storedTurns.findIndex((turn) => (
      (turn.turnId || turn.id || "") === lastOwnedUptakeTurnId
    ));
    const ownedTurns = storedTurns.filter((turn, index) => (
      turn.speakerId === actorId
      || (lastOwnedUptakeIndex >= 0 && index <= lastOwnedUptakeIndex)
    ));
    threads.set(thread.id, {
      id: thread.id,
      status: myState.selfClosure === "closed_for_self" ? "closed_for_self" : "open_for_self",
      topic: thread.topic || "",
      participantIds: [...(thread.participantIds || [])],
      nextObligationCharacterId: thread.nextObligationCharacterId === actorId ? actorId : "",
      myState: deepClone(myState),
      turns: ownedTurns.slice(-6).map((turn) => ({
        id: turn.turnId || turn.id || "",
        speakerId: turn.speakerId || "",
        addresseeId: turn.addresseeId || turn.targetCharacterId || "",
        speechAct: turn.action || turn.speechAct || "inform",
        speechFunctions: [...(turn.speechFunctions || inferPublicSpeechFunctions({
          speech: turn.line || turn.utterance || "",
          speechAct: turn.action || turn.speechAct || "inform",
        }))],
        utterance: turn.line || turn.utterance || "",
        day: Number(turn.day || 0),
        slotId: turn.slotId || "",
        slotLabel: turn.slotLabel || "",
      })),
    });
  }
  for (const lock of runtime.requestLocks || []) {
    const threadId = lock.threadId || lock.sourceThreadId || "";
    if (!threadId || ![lock.requesterId, lock.responderId].includes(actorId)) continue;
    const existing = threads.get(threadId);
    const participantIds = [...new Set([...(existing?.participantIds || []), lock.requesterId, lock.responderId].filter(Boolean))];
    const ownedPerceptionMemory = runtime.agents?.[actorId]?.perceptionMemory || [];
    const actionWasNoticed = (actionId) => ownedPerceptionMemory.some((memory) => (
      memory.provenance?.sourceActionId === actionId
      || memory.objectiveEventId === actionId
      || memory.sourceImpactIds?.includes(actionId)
    ));
    const liveTurns = (runtime.actions || []).filter((action) => (
      action.sourceThreadId === threadId
      && action.speech
      && (action.actorId === actorId || actionWasNoticed(action.id))
    )).slice(-6).map((action) => ({
      id: action.id,
      speakerId: action.actorId,
      addresseeId: action.targetCharacterId,
      speechAct: action.speechAct,
      speechFunctions: actionSpeechFunctions(action),
      utterance: action.speech,
      day: Number(runtime.slotContext?.day || 0),
      slotId: action.slotId || runtime.slotContext?.slotId || "",
      slotLabel: action.slotLabel || runtime.slotContext?.slotLabel || "",
    }));
    if (!existing && !liveTurns.length && lock.requesterId !== actorId) continue;
    const myState = ensureRuntimeParticipantThreadState(runtime, threadId, actorId);
    threads.set(threadId, {
      id: threadId,
      status: myState?.selfClosure === "closed_for_self" ? "closed_for_self" : "open_for_self",
      topic: existing?.topic || lock.topic || "未命名请求",
      participantIds,
      nextObligationCharacterId: lock.responderId === actorId && lock.status === "awaiting" ? actorId : "",
      myState: deepClone(myState),
      turns: [...(existing?.turns || []), ...liveTurns]
        .filter((turn, index, rows) => turn.id && rows.findIndex((row) => row.id === turn.id) === index)
        .slice(-6),
    });
  }
  return [...threads.values()].map((thread) => ({
    ...thread,
    publicContentLedger: publicDialogueContentLedger(thread.turns || [], state),
  }));
}

function perceivedObjectsForAgent(state = {}, runtime = {}, actorId = "") {
  const ledger = normalizeObjectLedger(state.tavernState?.objectLedger || {});
  const actor = runtime.agents?.[actorId];
  if (!actor) return [];
  return Object.values(ledger.objects || {}).filter((object) => {
    if (object.holderActorId === actorId) return true;
    const sameZone = object.sceneId === runtime.locationId && object.zoneId === actor.zoneId;
    return sameZone && objectVisibleToObserver(object, actorId);
  }).map((object) => {
    const ownObject = object.holderActorId === actorId;
    const possiblePrimitives = [];
    if (ownObject) {
      if (object.custody?.inHand) possiblePrimitives.push("show", "hide", "store", "transfer", "place");
      else if (object.attachment?.active && object.state?.sheathed !== false) possiblePrimitives.push("draw");
      else possiblePrimitives.push("take_out");
      if (object.state?.sheathed === false && object.custody?.inHand) possiblePrimitives.push("sheathe");
      if (object.state?.consumable === true) possiblePrimitives.push("consume");
    } else if (!object.holderActorId && object.portable) possiblePrimitives.push("pickup");
    return {
      id: object.id,
      label: ownObject ? object.label : objectPublicPerceptionLabel(object),
      holderCharacterId: object.holderActorId || "",
      zoneId: object.zoneId || "",
      ownObject,
      custody: ownObject ? deepClone(object.custody || {}) : {
        inHand: object.custody?.inHand === true,
        storageMode: object.custody?.inHand ? "in_hand" : "not_in_hand",
      },
      presentation: deepClone(object.presentation || {}),
      possiblePrimitives: [...new Set(possiblePrimitives)],
    };
  });
}

function perceptionUnit(value, fallback = 0) {
  let number = Number(value);
  if (!Number.isFinite(number)) number = fallback;
  if (Math.abs(number) > 1 && Math.abs(number) <= 100) number /= 100;
  return Math.max(0, Math.min(1, number));
}

function perceptionModality(modality = "") {
  return ({
    hearing: "sound",
    direct_speech: "sound",
    object: "touch",
    memory: "proprioception",
    self_action: "proprioception",
  })[modality] || (["visual", "sound", "smell", "touch", "vibration", "proprioception"].includes(modality)
    ? modality
    : "visual");
}

function perceptionBodyStateForAgent(actor = {}, rawPendingCount = 0) {
  const ecology = actor.ecologyState || actor.privateState?.ecologyState || {};
  const body = ecology.body || ecology.bodyState || {};
  const energy = Number(body.energy);
  const fatigue = Number.isFinite(Number(body.fatigue))
    ? perceptionUnit(body.fatigue)
    : Number.isFinite(energy) ? perceptionUnit(1 - energy) : 0.2;
  return {
    fatigue,
    pain: perceptionUnit(body.pain ?? body.injuryLoad),
    cognitiveLoad: Math.max(
      perceptionUnit(body.cognitiveLoad),
      perceptionUnit(Number(body.exertion || 0) * 0.45 + Math.max(0, rawPendingCount - 1) * 0.055),
    ),
    sensoryImpairments: deepClone(body.sensoryImpairments || {}),
  };
}

function tavernPerceptionEnvironment(state = {}) {
  const source = state.tavernState?.perceptionEnvironment || {};
  const modalityTransmission = Object.fromEntries([
    "visual",
    "sound",
    "smell",
    "touch",
    "vibration",
    "proprioception",
  ].map((modality) => [
    modality,
    perceptionUnit(source.modalityTransmission?.[modality], 1),
  ]));
  return {
    schemaVersion: 1,
    authority: "world-state",
    light: perceptionUnit(source.light, 1),
    ambientNoise: perceptionUnit(source.ambientNoise, 0),
    modalityTransmission,
  };
}

function activeAttentionFocus(actor = {}, runtime = {}) {
  const focus = actor.attentionFocus && typeof actor.attentionFocus === "object"
    ? actor.attentionFocus
    : null;
  const nowSeconds = Number(runtime.elapsedSeconds || 0);
  if (focus && Number(focus.expiresAtSeconds || 0) > nowSeconds) {
    return {
      mode: focus.mode || "observe",
      targetCharacterId: focus.targetCharacterId || "",
      domainTags: [...new Set((focus.domainTags || []).filter(Boolean))],
      expiresAtSeconds: Number(focus.expiresAtSeconds || 0),
      sourceActionId: focus.sourceActionId || "",
    };
  }
  if (focus) {
    if (actor.attentionTargetId && actor.attentionTargetId === focus.targetCharacterId) {
      actor.attentionTargetId = "";
    }
    actor.attentionFocus = null;
  }
  return actor.attentionTargetId ? {
    mode: "legacy-target",
    targetCharacterId: actor.attentionTargetId,
    domainTags: ["attention-target"],
    expiresAtSeconds: null,
    sourceActionId: "",
  } : null;
}

function deliveryPerceptionSignal(delivery = {}, actor = {}, runtime = {}) {
  const sourceCanonicalId = delivery.serverAudit?.sourceCharacterId || delivery.sourceCharacterId || "";
  const attentionTarget = activeAttentionFocus(actor, runtime)?.targetCharacterId || "";
  const modality = perceptionModality(delivery.modality);
  const tags = new Set([
    modality,
    delivery.type || "event",
    ...(delivery.responsibilityTags || []),
    ...(delivery.directed ? ["directed"] : []),
    ...(delivery.actionKind ? [delivery.actionKind, `action:${delivery.actionKind}`] : []),
    ...(sourceCanonicalId && sourceCanonicalId === attentionTarget ? ["attention-target"] : []),
    ...(delivery.provenance?.kind ? [delivery.provenance.kind] : []),
  ].filter(Boolean));
  return {
    signal: {
      schemaVersion: 1,
      signalId: `delivery:${delivery.id}`,
      sourceEntityHandle: delivery.sourceEntityHandle || delivery.perceivedSourceCharacterId || sourceCanonicalId,
      sourceZoneId: delivery.sourceZoneId || "",
      modality,
      featureId: `impact:${delivery.impactId}:${delivery.type || modality}`,
      physicalFeature: text([
        delivery.content,
        ...observableAffectiveTexture(delivery.observableAffectiveTexture).map((row) => row.feature),
      ].filter(Boolean).join("；"), 500),
      domainTags: [...tags],
      intensity: perceptionUnit(delivery.receivedIntensity, 0.5),
      durationSeconds: 0,
      transmissionFactor: 1,
      noiseResistance: perceptionUnit(delivery.perceptPacket?.fidelity, 0.35),
      transmission: { factor: 1, distanceLoss: 0, barrierLoss: 0, occlusion: 0 },
      occurredAtSeconds: Number(delivery.deliveredAtSeconds || runtime.elapsedSeconds || 0),
    },
    binding: {
      kind: "delivery",
      delivery,
      sourceCharacterId: sourceCanonicalId,
    },
  };
}

function staticCharacterPerceptionSignals(character = {}, actor = {}, runtime = {}) {
  const rows = [];
  const canSee = ["visible", "visible-and-audible"].includes(character.perception);
  const attentionTarget = activeAttentionFocus(actor, runtime)?.targetCharacterId || "";
  if (canSee) {
    const feature = character.currentVisibleActivity
      ? text(character.currentVisibleActivity, 500)
      : `${character.zoneLabel || "场中"}有一人`;
    rows.push({
      signal: {
        schemaVersion: 1,
        signalId: `presence:${actor.characterId}:${character.id}:${runtime.step}`,
        sourceEntityHandle: character.id,
        sourceZoneId: character.zoneId || "",
        modality: "visual",
        featureId: `visible-person:${character.id}`,
        physicalFeature: feature,
        domainTags: [
          "person",
          "presence",
          character.standing || "",
          ...(character.id === attentionTarget ? ["attention-target"] : []),
        ].filter(Boolean),
        intensity: character.currentVisibleActivity ? 0.96 : 0.98,
        durationSeconds: 1,
        transmissionFactor: 1,
        noiseResistance: 1,
        transmission: { factor: 1, distanceLoss: 0, barrierLoss: 0, occlusion: 0 },
        occurredAtSeconds: Number(runtime.elapsedSeconds || 0),
      },
      binding: { kind: "character", characterId: character.id },
    });
  }
  for (const [index, feature] of (character.publicSignalFeatures || []).entries()) {
    rows.push({
      signal: {
        schemaVersion: 1,
        signalId: `surface:${actor.characterId}:${character.id}:${feature.featureId || index + 1}:${runtime.step}`,
        sourceEntityHandle: character.id,
        sourceZoneId: character.zoneId || feature.sourceZoneId || "",
        modality: perceptionModality(feature.modality),
        featureId: `character-surface:${feature.featureId || index + 1}`,
        physicalFeature: text(feature.physicalFeature, 500),
        domainTags: [
          "person",
          "surface-feature",
          ...(feature.domainTags || []),
          ...(character.id === attentionTarget ? ["attention-target"] : []),
        ].filter(Boolean),
        intensity: perceptionUnit(feature.intensity, 0.65),
        durationSeconds: Math.max(0, Number(feature.durationSeconds || 0)),
        transmissionFactor: perceptionUnit(feature.transmissionFactor, 1),
        noiseResistance: perceptionUnit(feature.noiseResistance, 0.15),
        transmission: deepClone(feature.transmission || {}),
        occurredAtSeconds: Number(runtime.elapsedSeconds || 0),
      },
      binding: { kind: "character", characterId: character.id },
    });
  }
  return rows;
}

function staticObjectPerceptionSignal(object = {}, actor = {}, runtime = {}) {
  if (object.ownObject || !object.label) return null;
  const publicWeapon = /剑|刀|枪|弓|刃/u.test(object.label);
  return {
    signal: {
      schemaVersion: 1,
      signalId: `object:${actor.characterId}:${object.id}:${runtime.step}`,
      sourceEntityHandle: object.holderCharacterId || `perceived_object:${object.id}`,
      sourceZoneId: object.zoneId || "",
      modality: "visual",
      featureId: `visible-object:${object.id}`,
      physicalFeature: text(object.label, 500),
      domainTags: ["object", "carried-object", ...(publicWeapon ? ["weapon", "sword"] : [])],
      intensity: 0.82,
      durationSeconds: 1,
      transmissionFactor: 1,
      noiseResistance: 1,
      transmission: { factor: 1, distanceLoss: 0, barrierLoss: 0, occlusion: 0 },
      occurredAtSeconds: Number(runtime.elapsedSeconds || 0),
    },
    binding: { kind: "object", objectId: object.id, holderCharacterId: object.holderCharacterId || "" },
  };
}

function publicCharacterPerceptionFrame(frame = {}) {
  const trace = frame.attentionTrace || {};
  return {
    schemaVersion: frame.schemaVersion || 1,
    formulaVersion: frame.formulaVersion || "",
    authority: frame.authority || "character-private-perception-tool",
    noticedEvidence: deepClone(frame.noticedEvidence || []),
    interpretations: deepClone(frame.interpretations || []),
    attentionState: {
      authority: trace.authority || "character-private-automatic-attention",
      baselineBudget: Number(trace.baselineBudget || 0),
      effectiveBudget: Number(trace.effectiveBudget || 0),
      sensitivityThreshold: Number(trace.sensitivityThreshold || 0),
      overloadRatio: Number(trace.overloadRatio || 0),
      uncertaintyPenalty: Number(trace.uncertaintyPenalty || 0),
    },
  };
}

function noticedDeliveryProjection(delivery = {}, evidence = {}) {
  const content = evidence.noticedFeature;
  const perceptionWasCoarsened = text(content, 500) !== text(delivery.content, 500);
  const semanticFrame = deepClone(delivery.semanticFrame || null);
  if (perceptionWasCoarsened && semanticFrame) {
    if (semanticFrame.object) semanticFrame.object.label = content;
    semanticFrame.lexicalAnchors = [];
  }
  return {
    ...deepClone(delivery),
    rawEvidenceId: delivery.evidenceId || "",
    evidenceId: evidence.evidenceId,
    content,
    topic: perceptionWasCoarsened
      ? (delivery.actionKind === "observe" ? "未看清的注意动作" : "未看清的现场动作")
      : delivery.topic,
    semanticFrame,
    noticeStatus: "noticed",
    noticedAtStep: delivery.noticedAtStep,
    noticedSalience: Number(evidence.salience || 0),
    noticedFidelity: Number(evidence.fidelity || 0),
    noticedAmbiguity: Number(evidence.ambiguity || 0),
    attentionReasonTags: [...(evidence.attentionReasonTags || [])],
    perceptPacket: {
      ...(deepClone(delivery.perceptPacket || {})),
      modality: evidence.modality || delivery.modality,
      sensoryFeatures: {
        noticedFeature: evidence.noticedFeature,
        observableAffectiveTexture: observableAffectiveTexture(delivery.observableAffectiveTexture),
      },
      fidelity: Number(evidence.fidelity || 0),
      ambiguity: Number(evidence.ambiguity || 0),
    },
  };
}

function commitNoticedDeliveries(workingState = {}, runtime = {}, actor = {}, rows = []) {
  const newlyNoticed = [];
  for (const { delivery, evidence } of rows) {
    if (!delivery || !evidence || delivery.noticedProjection) continue;
    delivery.noticedAtStep = runtime.step;
    delivery.noticeStatus = "noticed";
    delivery.attentionDeferredUntilSeconds = null;
    const projection = noticedDeliveryProjection(delivery, evidence);
    delivery.noticedEvidenceId = projection.evidenceId;
    delivery.noticedProjection = deepClone(projection);
    newlyNoticed.push(projection);
    if (!(actor.perceptionMemory || []).some((memory) => memory.impactId === projection.impactId)) {
      actor.perceptionMemory.push(deepClone(projection));
    }
    const impact = (runtime.impacts || []).find((row) => row.id === delivery.impactId) || {};
    commitDeliveryToCharacterMemory(workingState, runtime, impact, projection);
    const sourceAction = (runtime.actions || []).find((action) => action.id === impact.causedByActionId);
    if (sourceAction) markParticipantThreadDelivery(runtime, sourceAction, impact, projection);
  }
  actor.perceptionMemory = (actor.perceptionMemory || []).slice(-16);

  const bySourceAction = new Map();
  for (const projection of newlyNoticed) {
    const impact = (runtime.impacts || []).find((row) => row.id === projection.impactId) || null;
    const sourceActionId = impact?.causedByActionId || impact?.provenance?.sourceActionId || "";
    if (!impact || !sourceActionId) {
      if (impact) commitDeliveredEventAppraisal(workingState, runtime, impact, projection);
      continue;
    }
    const group = bySourceAction.get(sourceActionId) || { impacts: [], deliveries: [] };
    group.impacts.push(impact);
    group.deliveries.push(projection);
    bySourceAction.set(sourceActionId, group);
  }
  for (const [sourceActionId, group] of bySourceAction.entries()) {
    const sourceAction = (runtime.actions || []).find((action) => action.id === sourceActionId) || { id: sourceActionId };
    const perceivedAction = { ...sourceAction, deliveries: group.deliveries };
    commitGroupedActionEventAppraisals(workingState, runtime, perceivedAction, group.impacts);
    commitRecipientEcologyEvidence(workingState, runtime, perceivedAction);
  }
  return newlyNoticed;
}

function buildTavernCharacterPerception({
  state = {},
  runtime = {},
  actor = {},
  rawPending = [],
  reachableCharacters = [],
  reachableObjects = [],
  validatedAnchorRuntime = null,
} = {}) {
  const profile = normalizeCharacterPerceptionProfile(
    validatedAnchorRuntime?.perceptionProjection
      || validatedAnchorRuntime?.characterFoundation?.perceptionProfile
      || actor.privateState?.perceptionProfile
      || {},
  );
  const bindings = new Map();
  const signalRows = [];
  for (const delivery of rawPending.filter((row) => !row.noticedProjection)) {
    const row = deliveryPerceptionSignal(delivery, actor, runtime);
    if (!row.signal.physicalFeature) continue;
    signalRows.push(row.signal);
    bindings.set(row.signal.signalId, row.binding);
  }
  for (const character of reachableCharacters) {
    for (const row of staticCharacterPerceptionSignals(character, actor, runtime)) {
      if (!row.signal.physicalFeature) continue;
      signalRows.push(row.signal);
      bindings.set(row.signal.signalId, row.binding);
    }
  }
  for (const object of reachableObjects) {
    const row = staticObjectPerceptionSignal(object, actor, runtime);
    if (!row) continue;
    signalRows.push(row.signal);
    bindings.set(row.signal.signalId, row.binding);
  }
  const responsibilityDomains = [...new Set(rawPending.flatMap((delivery) => delivery.responsibilityTags || []))];
  const attentionFocus = activeAttentionFocus(actor, runtime);
  const frame = buildCharacterPerceptionFrame({
    signals: signalRows,
    profile,
    environment: tavernPerceptionEnvironment(state),
    bodyState: perceptionBodyStateForAgent(actor, rawPending.length),
    attentionContext: {
      goalDomains: attentionFocus?.domainTags || [],
      dutyDomains: responsibilityDomains,
      novelDomains: ["arrival"],
    },
    seed: `${runtime.id}:${runtime.step}:${actor.characterId}`,
  });
  const deliveryRows = [];
  const noticedCharacterIds = new Set();
  const noticedObjectIds = new Set();
  const evidenceByCharacterId = new Map();
  for (const evidence of frame.noticedEvidence || []) {
    for (const signalId of evidence.sourceSignalIds || []) {
      const binding = bindings.get(signalId);
      if (!binding) continue;
      if (binding.kind === "delivery") {
        deliveryRows.push({ delivery: binding.delivery, evidence });
        if (binding.sourceCharacterId && runtime.agents?.[binding.sourceCharacterId]) {
          noticedCharacterIds.add(binding.sourceCharacterId);
          const ids = evidenceByCharacterId.get(binding.sourceCharacterId) || [];
          ids.push(evidence.evidenceId);
          evidenceByCharacterId.set(binding.sourceCharacterId, ids);
        }
      }
      if (binding.kind === "character") {
        noticedCharacterIds.add(binding.characterId);
        const ids = evidenceByCharacterId.get(binding.characterId) || [];
        ids.push(evidence.evidenceId);
        evidenceByCharacterId.set(binding.characterId, ids);
      }
      if (binding.kind === "object") {
        noticedObjectIds.add(binding.objectId);
        if (binding.holderCharacterId) noticedCharacterIds.add(binding.holderCharacterId);
      }
    }
  }
  for (const delivery of rawPending) {
    if (delivery.noticedProjection) continue;
    if (deliveryRows.some((row) => row.delivery.id === delivery.id)) continue;
    delivery.noticeStatus = "not-noticed";
    delivery.attentionAttempts = Number(delivery.attentionAttempts || 0) + 1;
    delivery.attentionDeferredUntilSeconds = Number(runtime.elapsedSeconds || 0) + Math.min(60, 12 + delivery.attentionAttempts * 8);
  }
  const newlyNoticed = commitNoticedDeliveries(state, runtime, actor, deliveryRows);
  const previouslyNoticed = rawPending
    .filter((delivery) => delivery.noticedProjection)
    .map((delivery) => deepClone(delivery.noticedProjection));
  const noticedDeliveries = [...previouslyNoticed, ...newlyNoticed]
    .filter((delivery, index, rows) => rows.findIndex((row) => row.impactId === delivery.impactId) === index)
    .sort((left, right) => Number(right.impactScore || 0) - Number(left.impactScore || 0));
  const perceivedCharacters = reachableCharacters.filter((row) => noticedCharacterIds.has(row.id)).map((row) => {
    const {
      publicSignalFeatures: _rawPublicSignalFeatures,
      observableModalities: _rawObservableModalities,
      ...publicCharacter
    } = row;
    return {
      ...publicCharacter,
      noticedEvidenceIds: [...new Set(evidenceByCharacterId.get(row.id) || [])],
      noticedFeatures: (frame.noticedEvidence || []).filter((evidence) => (
        (evidenceByCharacterId.get(row.id) || []).includes(evidence.evidenceId)
      )).map((evidence) => ({
        evidenceId: evidence.evidenceId,
        modality: evidence.modality,
        feature: evidence.noticedFeature,
        fidelity: evidence.fidelity,
        ambiguity: evidence.ambiguity,
      })),
    };
  });
  const perceivedObjects = reachableObjects.filter((object) => object.ownObject || noticedObjectIds.has(object.id));
  runtime.perceptionAudits ||= [];
  runtime.perceptionAudits.push({
    step: runtime.step,
    characterId: actor.characterId,
    frame: deepClone(frame),
    noticedImpactIds: noticedDeliveries.map((delivery) => delivery.impactId),
  });
  actor.lastPerceptionFrame = deepClone(frame);
  actor.currentNoticedDeliveries = deepClone(noticedDeliveries);
  return {
    profile,
    frame,
    publicFrame: publicCharacterPerceptionFrame(frame),
    noticedDeliveries,
    perceivedCharacters,
    perceivedObjects,
  };
}

function unresolvedInformationGoal(validatedAnchorRuntime = null) {
  const foundation = validatedAnchorRuntime?.characterFoundation || {};
  const known = new Map((foundation.epistemics?.knownEntities || []).map((row) => [row.entityId, row]));
  for (const desire of foundation.desires || []) {
    const targetId = typeof desire.target === "string" ? desire.target : desire.target?.id;
    if (!targetId || !String(targetId).startsWith("char_")) continue;
    const epistemic = known.get(targetId);
    if (!epistemic || epistemic.recognizesIdentity !== false) continue;
    return {
      goalId: `information:${desire.id}`,
      subjectHandle: targetId,
      subjectLabel: text(desire.target?.label || "", 120),
      desireId: desire.id,
      desireText: text(
        `${desire.desiredState?.verb || ""}${desire.desiredState?.object || desire.target?.label || ""}`,
        260,
      ),
      descriptors: deepClone(epistemic.descriptors || []),
    };
  }
  return null;
}

function epistemicAffordancesForAgent(state = {}, runtime = {}, actor = {}, perceivedCharacters = []) {
  const affordances = [
    { id: `epistemic-affordance:listen:${actor.zoneId}`, epistemicPrimitive: "listen" },
    { id: `epistemic-affordance:wait:${actor.zoneId}`, epistemicPrimitive: "wait" },
    { id: `epistemic-affordance:leave:${actor.zoneId}`, epistemicPrimitive: "leave" },
  ];
  for (const character of perceivedCharacters) {
    affordances.push({
      id: `epistemic-affordance:observe:${character.id}`,
      epistemicPrimitive: "observe",
      targetHandle: character.id,
    });
    affordances.push({
      id: `epistemic-affordance:ask:${character.id}`,
      epistemicPrimitive: "ask",
      targetHandle: character.id,
    });
  }
  for (const zone of reachableZones(state, runtime, actor.characterId, actor.zoneId)) {
    if (zone.id === actor.zoneId) continue;
    affordances.push({
      id: `epistemic-affordance:reposition:${zone.id}`,
      epistemicPrimitive: "reposition",
      destinationId: zone.id,
    });
  }
  return affordances;
}

function epistemicCandidateLabel(primitive = "") {
  return ({
    listen: "先听现场有没有相关线索",
    observe: "继续观察眼前的人与反应",
    ask_source_knowledge: "试探对方是否知道目标",
    ask_current_presence: "直接询问目标当前是否在这里",
    ask_prior_presence: "询问目标此前是否来过这里",
    ask_by_descriptor: "用已有特征作间接询问",
    ask_claim_reaction: "用本人记得但未证实的说法直接试探对方反应",
    wait: "留下等待更多信息出现",
    leave: "离开这里另寻信息来源",
    reposition: "换到更利于取得信息的位置",
  })[primitive] || "取得更多信息";
}

function safeEpistemicDecisionSupport(scored = {}) {
  return {
    formulaVersion: scored.formulaVersion || "",
    authority: scored.authority || "character-private-epistemic-tool",
    evaluations: (scored.evaluations || []).map((row) => ({
      candidateId: row.candidateId,
      primitive: row.primitive,
      targetHandle: row.targetHandle || "",
      feasible: row.feasible !== false,
      expectedInformationGain: Number(row.expectedInformationGain || 0),
      presupposition: {
        mismatch: Number(row.presupposition?.mismatch || 0),
        blocked: false,
        evaluations: (row.presupposition?.evaluations || []).map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          ownedLikelihood: Number(entry.ownedLikelihood || 0),
          minimumLikelihood: Number(entry.minimumLikelihood || 0),
          mismatch: Number(entry.mismatch || 0),
        })),
      },
      disclosurePayload: Number(row.disclosurePayload || 0),
      score: Number(row.score || 0),
      factorLedger: deepClone(row.factorLedger || []),
      ownedClaimReference: deepClone(row.ownedClaimReference || null),
    })),
    selection: deepClone(scored.selection || {
      authority: "character-agent",
      selectedCandidateId: null,
      pool: [],
    }),
  };
}

function augmentEcologyWithEpistemicCandidates(ecology = null, {
  actor = {},
  state = {},
  validatedAnchorRuntime = null,
  memoryState = {},
  perceivedCharacters = [],
  runtime = {},
} = {}) {
  const informationGoal = unresolvedInformationGoal(validatedAnchorRuntime);
  const subjectSlug = text(informationGoal?.subjectHandle || "", 180).split("_").filter(Boolean).at(-1) || "";
  const claimSubjectHandlesByBeliefId = Object.fromEntries((memoryState.beliefs || []).flatMap((belief) => {
    if (!informationGoal) return [];
    const surface = `${belief.propositionKey || ""} ${belief.currentValue || belief.claim || belief.proposition || ""}`;
    const matches = (informationGoal.subjectLabel && surface.includes(informationGoal.subjectLabel))
      || (subjectSlug && surface.toLowerCase().includes(subjectSlug.toLowerCase()));
    return matches ? [[belief.id, informationGoal.subjectHandle]] : [];
  }));
  const beliefState = buildCharacterEpistemicBeliefState(memoryState, { claimSubjectHandlesByBeliefId });
  if (!ecology) return { ecology, beliefState, support: null };
  if (!informationGoal) return { ecology, beliefState, support: null };
  const affordances = epistemicAffordancesForAgent(state, runtime, actor, perceivedCharacters);
  const rawCandidates = generateEpistemicActionCandidates({
    informationGoal,
    currentLocationHandle: `location:${runtime.locationId || LOCATION_ID}`,
    perceivedSources: perceivedCharacters.map((row) => ({ handle: row.id, role: row.role })),
    availableAffordances: affordances,
    beliefState,
  });
  const scored = scoreEpistemicActionCandidates({
    actorProfile: validatedAnchorRuntime?.perceptionProjection || {},
    beliefState,
    candidates: rawCandidates,
    context: {
      urgency: Math.max(0, ...(ecology.desires || []).map((desire) => perceptionUnit(desire.strength))),
    },
  });
  const evaluations = new Map((scored.evaluations || []).map((row) => [row.candidateId, row]));
  const intents = rawCandidates.map((candidate) => {
    const ask = candidate.primitive.startsWith("ask_");
    const targetCharacterId = candidate.targetHandle || "";
    const destinationId = candidate.primitive === "reposition"
      ? affordances.find((row) => row.id === candidate.affordanceId)?.destinationId || ""
      : "";
    return {
      id: candidate.candidateId,
      candidateClass: "epistemic",
      label: epistemicCandidateLabel(candidate.primitive),
      driveId: informationGoal.goalId,
      desire: { id: informationGoal.desireId, want: informationGoal.desireText },
      actionKind: candidate.primitive,
      targetCharacterId,
      semanticFrame: normalizeSemanticFrame({
        id: `frame:${candidate.candidateId}`,
        kind: "information-seeking",
        predicate: candidate.primitive,
        topicId: informationGoal.goalId,
        roles: {
          actor: actor.characterId,
          ...(targetCharacterId ? { addressee: targetCharacterId } : {}),
          subject: informationGoal.subjectHandle,
        },
        object: candidate.ownedClaimReference
          ? { id: candidate.ownedClaimReference.beliefId, label: candidate.ownedClaimReference.claimSummary }
          : { id: informationGoal.subjectHandle, label: "尚待确认的目标人物" },
        lexicalAnchors: [],
        importance: 0.48,
      }),
      realization: {
        mode: ask ? "speak" : candidate.primitive === "leave" ? "leave" : candidate.primitive === "reposition" ? "move" : "act",
        requireSpeech: ask,
        targetCharacterId,
        moveToZoneId: destinationId,
        epistemicPrimitive: candidate.primitive,
        ...(candidate.ownedClaimReference ? {
          ownedClaimReference: deepClone(candidate.ownedClaimReference),
          wordingAuthority: "character-agent",
        } : {}),
      },
      relationshipAppraisal: {},
      copingBias: {},
      expressionStrategy: {},
      epistemicCandidate: deepClone(candidate),
    };
  });
  const appraisalRows = intents.map((intent) => {
    const evaluation = evaluations.get(intent.id) || {};
    return {
      candidateId: intent.id,
      label: intent.label,
      driveId: intent.driveId,
      feasible: evaluation.feasible !== false,
      blockedBy: [],
      activationScore: clamp(50 + Number(evaluation.score || 0) * 24, 0, 100),
      genericPriorityTier: 2,
      desirePressure: {
        desireId: informationGoal.desireId,
        want: informationGoal.desireText,
        score: Math.max(0, Number(evaluation.expectedInformationGain || 0) * 100),
      },
      bodyAppraisal: {},
      obstacleResistance: {
        presuppositionMismatch: Number(evaluation.presupposition?.mismatch || 0),
        reverseDisclosure: Number(evaluation.disclosurePayload || 0),
      },
      intentionContinuity: { informationGoalId: informationGoal.goalId },
      hardGates: [],
      factorLedger: deepClone(evaluation.factorLedger || []),
    };
  });
  const appendedPool = appraisalRows.map((row) => ({
    candidateId: row.candidateId,
    score: row.activationScore,
    selected: false,
  }));
  return {
    ecology: {
      ...ecology,
      candidates: [...(ecology.candidates || []), ...intents],
      appraisal: {
        ...(ecology.appraisal || {}),
        candidates: [...(ecology.appraisal?.candidates || []), ...appraisalRows],
        selection: {
          ...(ecology.appraisal?.selection || {}),
          authority: "character-agent",
          selectedCandidateId: null,
          pool: [...(ecology.appraisal?.selection?.pool || []), ...appendedPool]
            .sort((left, right) => Number(right.score || 0) - Number(left.score || 0)),
        },
      },
      epistemicAppraisal: safeEpistemicDecisionSupport(scored),
    },
    beliefState,
    support: safeEpistemicDecisionSupport(scored),
  };
}

function buildAgentInput(state, runtime, selected, { characterAgentProtocolVersion = 1 } = {}) {
  const useCharacterAgentV2 = Number(characterAgentProtocolVersion) === 2;
  const actor = runtime.agents[selected.characterId];
  const settledInteractionEvents = tavernSettledInteractionEvents(state, actor.characterId);
  const ownedObligationDeliveryId = selected.localInteractionPriority ? selected.deliveryId || "" : "";
  const rawPending = (actor.inbox || []).filter((delivery) => (
    delivery.processedAtStep == null
    && (
      isFreshExternalDelivery(runtime, delivery)
      || (ownedObligationDeliveryId && delivery.id === ownedObligationDeliveryId)
    )
  ))
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 16);
  const reachableCharacters = perceivedCharactersFor(state, runtime, actor.characterId);
  const reachableObjects = perceivedObjectsForAgent(state, runtime, actor.characterId);
  const validatedAnchorRuntime = findValidatedCharacterAnchorRuntime(actor.characterId, {
    sceneId: actor.privateState?.ecologyProfile?.sceneId || "",
  });
  const perception = buildTavernCharacterPerception({
    state,
    runtime,
    actor,
    rawPending,
    reachableCharacters,
    reachableObjects,
    validatedAnchorRuntime,
  });
  markRuntimeDeliveriesNoticed(runtime, actor, perception.noticedDeliveries);
  const pending = perception.noticedDeliveries.slice(0, 8);
  const perceivedCharacters = perception.perceivedCharacters;
  const perceivedObjects = perception.perceivedObjects;
  const perceivedCharacterIds = perceivedCharacters.map((character) => character.id);
  let sourceImpact = selected.sourceImpactId
    ? pending.find((impact) => impact.impactId === selected.sourceImpactId) || null
    : null;
  if (!sourceImpact) sourceImpact = pending[0] || null;
  selected.sourceImpactId = sourceImpact?.impactId || "";
  selected.deliveryId = sourceImpact?.id || "";
  if (!useCharacterAgentV2) {
    selected.ecology = ecologyForCandidate(
      state,
      runtime,
      actor,
      sourceImpact,
      pending,
      perceivedCharacters,
    );
  }
  const memoryCues = {
    nowSeconds: memoryClockSeconds(runtime),
    sourceImpactId: selected.sourceImpactId || "",
    characterIds: [...new Set(pending.flatMap((impact) => [
      impact.perceivedSourceCharacterId || impact.sourceEntityHandle,
      impact.semanticFrame?.roles ? Object.values(impact.semanticFrame.roles) : [],
    ]).flat().filter(Boolean))],
    topicIds: [...new Set(pending.map((impact) => impact.semanticFrame?.topicId || impact.topic).filter(Boolean))],
    predicates: [...new Set(pending.map((impact) => impact.semanticFrame?.predicate).filter(Boolean))],
    lexicalCues: [...new Set(pending.flatMap((impact) => impact.semanticFrame?.lexicalAnchors || []).filter(Boolean))],
    limit: 8,
  };
  let memoryState = normalizeCharacterAgentMemoryState(
    actor.memoryState || createCharacterAgentMemoryState(actor.characterId),
    actor.characterId,
  );
  memoryState = seedCharacterOwnedOperationMemory(memoryState, {
    characterId: actor.characterId,
    settledInteractionEvents,
    nowSeconds: memoryClockSeconds(runtime),
    worldDay: Number(runtime.slotContext?.day ?? runtime.macroDay ?? 0),
    locationId: runtime.locationId,
    zoneId: actor.zoneId,
  });
  const reconstructed = reconstructCharacterAgentMemory(memoryState, memoryCues, memoryRecallOptionsForAgent(
    actor,
    selected,
    pending,
    validatedAnchorRuntime,
    memoryState,
  ));
  memoryState = reconstructed.memory;
  const settledOwnSourceIds = new Set(settledInteractionEvents
    .filter((event) => event.actorId === actor.characterId)
    .map((event) => event.actionId || event.id)
    .filter(Boolean));
  const settledOwnEpisodes = (memoryState.episodes || []).filter((episode) => (
    episode.source?.kind === "self_action"
    && settledOwnSourceIds.has(episode.source?.sourceActionId)
  ));
  const sceneMemoryContext = {
    ...(reconstructed.memoryContext || {}),
    episodes: [
      ...settledOwnEpisodes,
      ...(reconstructed.memoryContext?.episodes || []).filter((episode) => !settledOwnEpisodes.some((owned) => owned.id === episode.id)),
    ].filter((episode, index, rows) => rows.findIndex((row) => row.id === episode.id) === index).slice(0, 10),
  };
  actor.memoryState = memoryState;
  const memoryOwner = characterById(state, actor.characterId);
  if (memoryOwner) memoryOwner.agentMemory = deepClone(memoryState);
  const epistemic = useCharacterAgentV2
    ? {
      ecology: selected.ecology,
      beliefState: buildCharacterEpistemicBeliefState(memoryState),
      support: null,
    }
    : augmentEcologyWithEpistemicCandidates(selected.ecology, {
      actor,
      state,
      validatedAnchorRuntime,
      memoryState,
      perceivedCharacters,
      runtime,
    });
  if (!useCharacterAgentV2) selected.ecology = epistemic.ecology;
  const privateActionCandidates = useCharacterAgentV2 ? [] : ecologyAgentCandidateBundle(selected.ecology).map((candidate) => {
    const semanticFrame = candidate.semanticFrame?.id || candidate.semanticFrame?.predicate
      ? normalizeSemanticFrame(candidate.semanticFrame)
      : null;
    const baseMemoryInfluence = memoryInfluenceForCandidate(memoryState, {
      ...candidate,
      semanticFrame,
      sourceImpactId: candidate.realization?.responseSourceImpactId || candidate.realization?.observationSourceImpactId || selected.sourceImpactId || "",
    }, { nowSeconds: memoryClockSeconds(runtime) });
    const preMemoryActivationScore = Number(candidate.activationScore || 0);
    const memoryScoreDelta = candidate.feasible ? Math.round(baseMemoryInfluence.total * 1800) / 100 : 0;
    const activationScore = candidate.feasible
      ? clamp(preMemoryActivationScore + memoryScoreDelta, 0, 100)
      : 0;
    const memoryInfluence = {
      ...baseMemoryInfluence,
      scoreDelta: memoryScoreDelta,
      preMemoryActivationScore,
      postMemoryActivationScore: activationScore,
    };
    return {
      ...candidate,
      candidateClass: candidate.candidateId.startsWith("epistemic:") ? "epistemic" : "ecology",
      semanticFrame,
      preMemoryActivationScore,
      memoryScoreDelta,
      activationScore,
      memoryInfluence,
      ownDecisionFactors: {
        ...(candidate.ownDecisionFactors || {}),
        memoryInfluence,
        ...(validatedAnchorRuntime ? {
          anchorGuidance: buildValidatedAnchorCandidateGuidance(validatedAnchorRuntime, candidate),
        } : {}),
      },
    };
  });
  const candidateMemoryEpisodeIds = new Set(privateActionCandidates.flatMap((candidate) => candidate.memoryInfluence?.basisEpisodeIds || []));
  const candidateMemoryBeliefIds = new Set(privateActionCandidates.flatMap((candidate) => candidate.memoryInfluence?.basisBeliefIds || []));
  const candidateMemoryCommitmentIds = new Set(privateActionCandidates.flatMap((candidate) => candidate.memoryInfluence?.basisCommitmentIds || []));
  const mergeRows = (preferred = [], fallback = [], limit = 10) => {
    const rows = [];
    const ids = new Set();
    for (const row of [...preferred, ...fallback]) {
      if (!row?.id || ids.has(row.id)) continue;
      ids.add(row.id);
      rows.push(deepClone(row));
      if (rows.length >= limit) break;
    }
    return rows;
  };
  const memoryContext = {
    ...sceneMemoryContext,
    episodes: mergeRows(
      sceneMemoryContext.episodes.filter((episode) => candidateMemoryEpisodeIds.has(episode.id)),
      sceneMemoryContext.episodes,
      10,
    ),
    beliefs: mergeRows(
      memoryState.beliefs.filter((belief) => candidateMemoryBeliefIds.has(belief.id)),
      sceneMemoryContext.beliefs,
      8,
    ),
    commitments: mergeRows(
      memoryState.commitments.filter((commitment) => candidateMemoryCommitmentIds.has(commitment.id)),
      sceneMemoryContext.commitments,
      8,
    ),
  };
  const relationshipContext = buildTavernOwnedRelationshipContext(state, actor.characterId, perceivedCharacters);
  const character = characterById(state, actor.characterId) || {};
  const voiceContract = buildTavernVoiceContract(character, {
    targetCharacterId: actor.attentionTargetId || "",
    relationshipContext,
    expressionStrategy: {},
  });
  const conversationalActionCandidates = privateActionCandidates.map((candidate) => {
    const candidateSourceImpactId = candidate.realization?.responseSourceImpactId
      || candidate.realization?.observationSourceImpactId
      || candidate.sourceImpactId
      || selected.sourceImpactId
      || "";
    const candidateSourceImpact = pending.find((impact) => impact.impactId === candidateSourceImpactId)
      || (sourceImpact?.impactId === candidateSourceImpactId ? sourceImpact : null);
    const mayRealizeQuestion = (candidate.realization?.allowedSpeechActs || []).includes("ask")
      || String(candidate.realization?.epistemicPrimitive || "").startsWith("ask_");
    const epistemicQuestionOptions = mayRealizeQuestion
      ? (epistemic.support?.evaluations || []).filter((row) => String(row.primitive || "").startsWith("ask_")).map((row) => ({
        candidateId: row.candidateId,
        primitive: row.primitive,
        targetHandle: row.targetHandle || "",
        feasible: row.feasible !== false,
        score: Number(row.score || 0),
        disclosurePayload: Number(row.disclosurePayload || 0),
        presupposition: deepClone(row.presupposition || { mismatch: 0, blocked: false, evaluations: [] }),
        ownedClaimReference: deepClone(row.ownedClaimReference || null),
      }))
      : [];
    return {
      ...candidate,
      realization: {
        ...(candidate.realization || {}),
        ...(mayRealizeQuestion ? {
          epistemicQuestionOptions,
          epistemicQuestionAccountingRule: "若回应中另行提出关于本人未决信息目标的问题，必须由人物选择其中一个选项，并在 communicationPlan 说明如何对待其前提；数学只提供代价，不替人物决定或禁言。",
        } : {}),
      },
      speechRealization: buildTavernConversationalRealization({
        voiceContract,
        candidate,
        sourceImpact: candidateSourceImpact,
        relationshipContext,
        dynamicState: actor.privateState?.ecologyState || actor.ecologyState || {},
      }),
    };
  });
  const availableAffordances = listTavernCausalAffordances(state, runtime, actor.characterId, perceivedCharacterIds);
  const situatedServiceChoice = buildTavernSituatedServiceChoice(
    state,
    runtime,
    actor.characterId,
    perceivedCharacterIds,
  );
  const sourceParticipantId = sourceImpact?.perceivedSourceCharacterId || sourceImpact?.sourceCharacterId || "";
  const publicZone = ["threshold", "hall", "counter", "stove", "stairs"].includes(actor.zoneId);
  const socialContext = deriveCharacterSocialContext({
    actorId: actor.characterId,
    directParticipantIds: [actor.characterId, sourceParticipantId].filter(Boolean),
    potentialObservers: Object.values(runtime.agents || {}).flatMap((other) => {
      if (!other.present || other.characterId === actor.characterId) return [];
      const route = spatialRoute(runtime.topology || TAVERN_SCENE_TOPOLOGY, actor.zoneId, other.zoneId, "visual");
      if (!route || route.distance > 2) return [];
      return [{
        characterId: other.characterId,
        noticeProbability: route.distance <= 0 ? 1 : route.distance <= 1 ? 0.82 : 0.56,
        modalities: ["visual", "sound"],
      }];
    }),
    place: {
      placeId: runtime.locationId || LOCATION_ID,
      zoneId: actor.zoneId,
      publicAccess: publicZone,
    },
    socialFacts: tavernObjectiveSocialFactsForActor(
      state,
      runtime,
      actor,
      perceivedCharacterIds,
    ),
  });
  const materialFacts = tavernCausalMaterialFacts(
    state,
    runtime,
    actor.characterId,
    perceivedCharacterIds,
    perceivedObjects.map((object) => object.id),
  );
  const recentOwnActions = mergeCharacterRecentOwnActions({
    characterId: actor.characterId,
    settledInteractionEvents,
    runtimeActions: (runtime.actions || []).map((action) => ({
      ...action,
      speechFunctions: actionSpeechFunctions(action),
    })),
    limit: 4,
  });
  const openConversationThreads = privateConversationThreadsForAgent(state, runtime, actor.characterId);
  const discourseContext = deriveCharacterDiscourseContext({
    characterId: actor.characterId,
    settledInteractionEvents,
    recentOwnActions,
    openConversationThreads,
  });
  const canonicalInput = {
    scene: {
      id: runtime.id,
      step: runtime.step,
      locationId: runtime.locationId,
      locationName: "望梯酒馆",
      elapsedSeconds: runtime.elapsedSeconds,
      characterElapsedSeconds: Number(actor.ecologySceneStartSeconds || 0) + Number(runtime.elapsedSeconds || 0),
      zoneId: actor.zoneId,
      zoneLabel: runtime.topology.zones?.[actor.zoneId]?.label || actor.zoneId,
      slotId: runtime.slotContext?.slotId || "causal-scene",
      slotLabel: runtime.slotContext?.slotLabel || "同一场",
      day: Number(runtime.slotContext?.day ?? runtime.macroDay ?? 0),
    },
    agent: {
      id: actor.characterId,
      name: actor.characterName,
      role: actor.role,
      standing: actor.standing,
      currentIntention: actor.currentIntention,
      attentionTargetId: actor.attentionTargetId,
      privateState: deepClone(actor.privateState),
      psychologyAnchor: deepClone(actor.privateState?.ecologyProfile?.psychologyAnchor || null),
      perceptionProfile: deepClone(perception.profile),
      relationshipContext,
      voiceContract,
      memoryContext,
    },
    activation: sourceImpact ? {
      impactId: sourceImpact.impactId,
      sourceCharacterId: sourceImpact.perceivedSourceCharacterId || "",
      sourceEntityHandle: sourceImpact.sourceEntityHandle || "",
      identityKnown: sourceImpact.identityKnown !== false,
      evidenceId: sourceImpact.evidenceId || sourceImpact.impactId,
      type: sourceImpact.type || "",
      modality: sourceImpact.modality || "",
      directed: Boolean(sourceImpact.directed),
      content: sourceImpact.content || "",
      topic: sourceImpact.topic || "",
      speechAct: sourceImpact.speechAct || "none",
      speechFunctions: [...(sourceImpact.speechFunctions || [])],
      actionKind: sourceImpact.actionKind || "",
      sourceActionId: sourceImpact.provenance?.sourceActionId || "",
      sourceThreadId: sourceImpact.provenance?.sourceThreadId || "",
      responseToTurnId: sourceImpact.provenance?.responseToTurnId || "",
      responseSourceLine: sourceImpact.provenance?.responseSourceLine || "",
      responseSourceSlotId: sourceImpact.provenance?.responseSourceSlotId || "",
      responseSourceSlotLabel: sourceImpact.provenance?.responseSourceSlotLabel || "",
    } : null,
    choiceAuthority: {
      owner: "character-agent",
      mathematicsRole: useCharacterAgentV2
        ? "private-psychological-state-and-evaluation-after-subjective-appraisal"
        : "private-psychological-appraisal",
      worldRole: "facts-affordances-feasibility-consequences",
      rule: useCharacterAgentV2
        ? "appraise first, then generate candidates, use private mathematics, choose and realize; the world may reject but never substitute another intention"
        : "choose exactly one feasible candidateId; the world may reject but never substitute another intention",
    },
    relationshipAppraisalContract: {
      owner: "character-agent",
      metricIds: [...TAVERN_RELATIONSHIP_METRICS],
      rule: "声音、动作和世界结果只是本人可评价的证据，不自动改变关系；none 可不更新，provisional 只保留暂时印象，retained 才产生持久维度变化。",
    },
    privateActionCandidates: conversationalActionCandidates,
    perceptionFrame: perception.publicFrame,
    perceivedImpacts: publicPerceivedImpacts(pending),
    perceptionMemory: publicPerceivedImpacts((actor.perceptionMemory || []).slice(-10)),
    perceivedCharacters,
    epistemicBeliefState: deepClone(epistemic.beliefState),
    epistemicDecisionSupport: deepClone(epistemic.support || {
      formulaVersion: "",
      authority: "character-private-epistemic-tool",
      evaluations: [],
      selection: { authority: "character-agent", selectedCandidateId: null, pool: [] },
    }),
    materialFacts,
    settledInteractionEvents: deepClone(settledInteractionEvents),
    discourseContext,
    socialContext,
    sharedActivities: deepClone((runtime.sharedActivities || []).filter((activity) => (activity.participantIds || []).includes(actor.characterId))),
    accessGrants: deepClone((runtime.accessGrants || []).filter((grant) => (grant.beneficiaryIds || []).includes(actor.characterId))),
    recentFailedAttempts: deepClone((runtime.failedAttemptCooldowns || []).filter((row) => (
      row.actorId === actor.characterId && Number(row.expiresAtStep || 0) >= runtime.step
    ))),
    perceivedObjects,
    availableAffordances,
    serviceChoice: situatedServiceChoice ? {
      actorId: situatedServiceChoice.actorId,
      operatorActorIds: [...situatedServiceChoice.operatorActorIds],
      bodyNeeds: deepClone(situatedServiceChoice.bodyNeeds),
      ownedTender: deepClone(situatedServiceChoice.ownedTender),
      economicContext: deepClone(situatedServiceChoice.economicContext),
      sustenanceContext: deepClone(situatedServiceChoice.sustenanceContext),
      offers: deepClone(situatedServiceChoice.offers),
      tableUseNorm: deepClone(situatedServiceChoice.tableUseNorm),
      currentTransactionState: situatedServiceChoice.currentTransactionState,
      guestPositionOptions: deepClone(situatedServiceChoice.guestPositionOptions),
    } : null,
    serviceChoiceTool: deepClone(situatedServiceChoice?.tool || null),
    recentOwnActions,
    reachableZones: reachableZones(state, runtime, actor.characterId, actor.zoneId),
    ownCommitments: (runtime.commitments || []).filter((commitment) => commitment.ownerId === actor.characterId || commitment.targetCharacterId === actor.characterId),
    openConversationThreads,
    institution: deepClone(state.tavernState?.institution || {}),
  };
  return projectAgentInputIdentityReferences(canonicalInput, state, runtime);
}

function observerPsychologyForDecision(input = {}, selected = {}, decision = {}, action = {}, runtime = {}) {
  const privateState = input.agent?.privateState || {};
  const selectedPrivateCandidate = (input.privateActionCandidates || []).find((candidate) => candidate.candidateId === decision.candidateId) || null;
  const memoryInfluence = selectedPrivateCandidate?.memoryInfluence || null;
  const memoryEpisodeIds = new Set(memoryInfluence?.basisEpisodeIds || []);
  const memoryBeliefIds = new Set(memoryInfluence?.basisBeliefIds || []);
  const memoryCommitmentIds = new Set(memoryInfluence?.basisCommitmentIds || []);
  const memoryContext = input.agent?.memoryContext || {};
  const memoryBasis = memoryInfluence && (
    memoryEpisodeIds.size || memoryBeliefIds.size || memoryCommitmentIds.size
  ) ? {
    influence: deepClone(memoryInfluence),
    episodes: (memoryContext.episodes || []).filter((episode) => memoryEpisodeIds.has(episode.id)).slice(0, 4).map((episode) => ({
      id: episode.id,
      content: text(episode.perception?.content, 180),
      topic: text(episode.perception?.topic || episode.semanticFrame?.object?.label, 100),
      sourceKind: episode.source?.kind || "",
      sourceConfidence: Number(episode.source?.confidence || 0),
      accessibility: Number(episode.accessibility || 0),
      semanticFrame: deepClone(episode.semanticFrame || null),
    })),
    beliefs: (memoryContext.beliefs || []).filter((belief) => memoryBeliefIds.has(belief.id)).slice(0, 3).map((belief) => ({
      id: belief.id,
      currentValue: belief.currentValue || "",
      confidence: Number(belief.confidence || 0),
      status: belief.status || "",
      semanticFrame: deepClone(belief.semanticFrame || null),
    })),
    commitments: (memoryContext.commitments || []).filter((commitment) => memoryCommitmentIds.has(commitment.id)).slice(0, 3).map((commitment) => ({
      id: commitment.id,
      ownerRole: commitment.ownerRole || "",
      counterpartyCharacterId: commitment.counterpartyCharacterId || "",
      beneficiaryCharacterId: commitment.beneficiaryCharacterId || "",
      requestedAct: text(commitment.requestedAct, 180),
      status: commitment.status || "",
    })),
  } : null;
  const trigger = selected.sourceImpactId
    ? (input.perceivedImpacts || []).find((impact) => impact.impactId === selected.sourceImpactId) || null
    : null;
  const desire = text(
    selected.ecology?.selectedDesire?.want
    || privateState.activeGoal
    || privateState.hiddenAgenda
    || privateState.privatePursuit
    || input.agent?.currentIntention
    || "继续眼下的生活",
    180,
  );
  const eventAppraisal = [...(runtime.eventAppraisals || [])].reverse().find((entry) => (
    entry.recipientId === (input.agent?.id || action.actorId)
    && (!selected.sourceImpactId || entry.impactId === selected.sourceImpactId || (entry.sourceImpactIds || []).includes(selected.sourceImpactId))
  )) || null;
  const relationshipAppraisal = selected.ecology?.selectedIntent?.relationshipAppraisal || {};
  const copingBias = selected.ecology?.selectedIntent?.copingBias || {};
  const expressionStrategy = selected.ecology?.selectedIntent?.expressionStrategy || {};
  const selectedIntent = ecologyDecisionSummary(selected.ecology);
  if (selectedIntent && selectedPrivateCandidate) {
    selectedIntent.activationScore = selectedPrivateCandidate.activationScore;
    selectedIntent.preMemoryActivationScore = selectedPrivateCandidate.preMemoryActivationScore;
    selectedIntent.memoryScoreDelta = selectedPrivateCandidate.memoryScoreDelta;
  }
  const factorTrace = selected.ecology?.appraisal?.observerFactorTrace
    ? deepClone(selected.ecology.appraisal.observerFactorTrace)
    : null;
  if (factorTrace && selectedPrivateCandidate) {
    factorTrace.candidates = (factorTrace.candidates || []).map((candidate) => (
      candidate.candidateId === decision.candidateId ? {
        ...candidate,
        activationScore: selectedPrivateCandidate.activationScore,
        positiveFactors: [
          ...(candidate.positiveFactors || []),
          ...(selectedPrivateCandidate.memoryScoreDelta > 0 ? [{
            id: "retrieved-memory",
            label: "此刻可提取的相关记忆",
            contribution: selectedPrivateCandidate.memoryScoreDelta,
          }] : []),
        ],
      } : candidate
    ));
  }
  const copingLabel = {
    approach: "靠近并处理",
    avoid: "先拉开距离",
    assert: "明确守住边界",
    inhibit: "压住表达",
    repair: "先修复关系",
  }[copingBias.dominant] || "按当前状态处理";
  const formulaReason = text([
    `自己此刻想要${desire}`,
    trigger ? `“${text(trigger.content, 90)}”确实抵达了自己` : "这次行动来自自己的需要、职责或未完目标",
    relationshipAppraisal.toCharacterId
      ? `自己对对方的亲近为${Math.round(relationshipAppraisal.closeness || 0)}、戒备为${Math.round(relationshipAppraisal.tension || 0)}`
      : "这次行动没有借用不存在的关系前情",
    `当前的表达调节偏向${copingLabel}`,
    memoryBasis?.influence?.explanation || "没有相关旧记忆额外推高这项行动",
    `所以本人选择“${selected.ecology?.selectedIntent?.label || "眼前行动"}”并以${expressionStrategy.mode || "当前方式"}表达`,
  ].join("；"), 420);
  return {
    schemaVersion: 1,
    visibility: "observer-only",
    source: "causal-character-agent-decision",
    actionId: action.id || "",
    characterId: input.agent?.id || action.actorId || "",
    characterName: input.agent?.name || action.actorName || "",
    desire,
    currentIntention: text(input.agent?.currentIntention || desire, 180),
    privateReason: text(decision.privateReason, 220),
    formulaReason,
    trigger: trigger ? {
      impactId: trigger.impactId || selected.sourceImpactId || "",
      sourceCharacterId: trigger.sourceCharacterId || "",
      type: trigger.type || "",
      modality: trigger.modality || "",
      content: text(trigger.content, 220),
      topic: text(trigger.topic, 120),
      directed: Boolean(trigger.directed),
    } : {
      impactId: "",
      sourceCharacterId: "self",
      type: "intrinsic",
      modality: "internal",
      content: "自身需要、职责或未完承诺达到行动阈值。",
      topic: text(input.agent?.currentIntention || desire, 120),
      directed: false,
    },
    slotId: input.scene?.slotId || "causal-scene",
    slotLabel: input.scene?.slotLabel || "同一场",
    decidedAtSeconds: Number(action.startedAtSeconds ?? input.scene?.elapsedSeconds ?? 0),
    factorTrace,
    selectedIntent,
    relationshipAppraisal: deepClone(relationshipAppraisal),
    copingBias: deepClone(copingBias),
    expressionStrategy: deepClone(expressionStrategy),
    eventAppraisal: eventAppraisal?.observerTrace ? deepClone(eventAppraisal.observerTrace) : null,
    memoryBasis,
  };
}

export function tavernCausalAgentSystemPrompt(input = {}) {
  return `你是望梯酒馆里持续生活的人物 Agent「${input.agent?.name || "人物"}」，不是按剧本轮流说话的角色。

你只能根据：自己的私有状态、perceptionFrame 中本人实际注意到的细节、perceivedImpacts、自己检索到的记忆、以及当前被本人注意到的人作决定。世界收到但你没有注意到的原始信号不会出现在输入里，也不能作为可靠知识来源；但你仍可能猜测、误认、撒谎、玩笑、调戏或记错，不能把这些主观内容冒充世界事实。

决定原则：
- privateActionCandidates 是你自己的心理模型为眼前局面生成的行动候选。数学分数只是你衡量欲望、身体、阻碍、关系、性格和意图惯性的私人工具，不是世界替你下达的命令。
- agent.perceptionProfile 与 perceptionFrame 是你自己的感官、注意和专业解码工具。noticedEvidence 是本轮真正进入你注意的物理细节；同场存在不等于你一定看见，收到声音也不等于你一定听清。attentionState 只说明当下容量与不确定性，不泄露你没有注意到的信号。
- epistemicBeliefState 只包含你本人当前对目标地点、信息源和匿名人物的可修正认识，不是世界真相。epistemicDecisionSupport 只比较观察、倾听、询问、等待、移位和离开的信息价值、反向暴露、时间与社会代价，selectedCandidateId 永远由你决定；前提错配只增加风险，不禁止你故意试探、乱问或顾左右而言他。
- ask_claim_reaction 表示你可以拿自己记忆里确实存在但尚未证实的说法直接试探眼前人的回答或反应。ownedClaimReference 只提供你拥有的说法及来源状态，不替你写问句，也不保证说法为真；是否直问、怎样改述、是否假装确信仍由你决定。
- 候选的 ownDecisionFactors.anchorGuidance 若存在，只说明通用候选来源以及本轮可使用的人格、欲望、阻碍、认识与关系参数。具体手段必须由你从当前可感知事实、世界 affordance 和通用行动原语中形成；校准回答、Holdout 与作者预写的情境动作不属于运行输入。
- agent.memoryContext 是你此刻因人物、话题和现场线索实际想起的有限记忆，不是世界全知记录；记忆影响候选压力，但不能替你选择行动。来源为 gossip / reported 的内容只是一条带来源和可信度的说法，不自动等于事实。
- cognitiveAppraisal 记录你怎样解释 perceptionFrame 已经选中的 evidence，以及对命题采取 adopt/revise/doubt/reject/suspend 中哪一种态度。注意到一句话不等于相信它；只能引用自己输入里真实存在的 evidence id，confabulation 可以没有来源但必须如实标注 reasoningMode。
- entityModelUpdates 只更新你对当前“perceived_entity”的匿名私人模型；identityCandidates 可支持、怀疑或否定某个“known_entity”，但不是世界认证。locationBeliefUpdates 与 sourceKnowledgeBeliefUpdates 分别更新“目标可能在哪里”和“眼前信息源可能知道多少”，必须保留来源、可靠度和置信档；三类数组都可以为空，不能因为世界底层知道身份或位置就填写。
- cognitiveAppraisal.threadAppraisals 记录你本人怎样理解已经抵达自己的具体话轮：对方是回答、拒绝、延期、回避、反问、转向、忽略还是没有说清；你是否满意、还多想回应、以及这件事对你自己是否已经结束。openConversationThreads 只给出你的 myState，不会泄露别人心里是否结案。
- communicationPlan 位于“相信什么”和“实际说什么”之间。你可以 direct、partial、evade、counter_question、redirect、lie、bluff、joke、ignore 或 silence；epistemicRelation 要说明你与自己所说内容的关系。它是私有表达意图，不会传给听者。
- 如果你在回应别人时另行提出了关于本人未决信息目标的问题，不能因为选了普通 respond 候选就绕过 epistemicDecisionSupport：从该候选 realization.epistemicQuestionOptions 选择真正采用的 epistemicActionCandidateId，并用 presuppositionStance 说明你是接受、不确定、故意试探、欺骗、误记还是虚构其前提。没有依据仍可以乱问、试探、撒谎或顾左右而言他；epistemicBasisEvidenceIds 可以为空，但这种取舍必须属于你本人。普通服务确认、寒暄或不涉及该信息目标的问题可把 id 留空。
- 实际输出先有私有的 speechRealizationPlan，再分成三个并列的外在层：utterance.literalSpeech 是确实发出的字句；embodiedIntent 是本人想采用的方式、姿态与动作；actionAttempt 是本人真正尝试交给世界的动作原语、物件、对象、目的地或 affordance。可以一边说话一边行动，也可以说话成功而动作失败。
- utterance / embodiedIntent / actionAttempt 是本轮运行权威。旧 speech、visibleAction、moveToZoneId、vocalMode、affordanceId 只是兼容镜像，必须分别与 literalSpeech、intendedGesture、destinationId、vocalMode、actionAttempt.affordanceId 保持一致，不能在两套字段里写两个不同决定。
- 候选含 semanticFrame 时，其中 requester、requestedActor、beneficiary、ultimateRecipient 等角色是这件社会事务的既有语义。选中后必须原样回填 semanticFrameId 与 semanticRoleBindings；可以拒绝、接受或延期，但不得交换“谁请求谁替谁做什么”。
- 先由你本人比较候选，再从 feasible=true 的候选中选择一个 candidateId。你可以选择并非最高分但仍可行的行动，只要这符合你的性格、当下取舍和真实选择；世界只能验证事实与后果，不能替换成另一个候选。
- 选定后按该候选的 targetCharacterId、actionKind、realization、expressionStrategy 与 speechRealization 实现自然动作和台词，不得偷换对象、凭空使用 affordance，或选择 hard gate 已失败的行动。speechRealization 只约束如何把本人已经选中的意图说出来，不替你选意图。
- 欲望不会因为公共场合而消失；公共场合、人多、害羞、疲劳和规范是独立阻碍。压住一次行动也不等于欲望已经满足。
- agent.voiceContract 是人物怎样形成声音的心理映射，不是句式模板。人格与当下心理状态先决定他注意什么、怎样评价、想让谁知道多少，再由关系、身体、情绪和压力决定措辞、节奏、停顿与动作泄露；不设目标字数、分句数、固定句型或必用词。同一个人可以短说、长说、完整说明、改口或有意省略，不要为证明声纹强塞标志词，也不要复诵校准原话。
- 每个候选的 speechRealization.voicePsychologyTool 是你自己的声音心理计算工具。先在 speechRealizationPlan 中分别写清 mustConvey、mayReveal、withhold、desiredListenerEffect 与 subtext，再决定话在动作前、动作中、动作后还是稍后说，最后才形成 utterance.literalSpeech。mustConvey 只放“若不公开就无法完成已选行动”的最少公开语义，不是所有与局面有关的真相；判断原则、理由链、价值观和人物自我解释默认留在 withhold、subtext 或 explanationsKeptPrivate，除非已选行动此刻确实要说服、警告、教导、修复、欺骗、挑衅或承担另一项具体公开功能。工具给出的 directness、compression、warmth、reserve、formality、emotionalLeakage 是当下倾向而非嘴形；你可以有意偏离，但要在 intentionalDepartureReason 说明本人策略。
- 在 speechRealizationPlan.minimumSufficiency 中做删除测试：只说 mustConvey 后，如果听者已经能回答或行动，而且额外解释没有服务已选行动中的具体功能，就把解释移入 explanationsKeptPrivate，并让出话轮等待对方反应。人物不必逐字回答对方问句的每一层，可以只确认身份或事实，也可以回避、转向、隐瞒；“展示我的人格、原则或声纹”不算额外公开解释的有效目的。这里判断的是语义负载而非字数，不能把它做成短句模板或截断器。
- speechRealizationPlan.selfCheck 由你本人检查：这句话是否像在向系统汇报私有任务，是否换成另一个人物也完全一样，动作已经表达的内容是否又被台词念了一遍，以及完成最少公开语义后是否还拖着一段无行动功能的解释尾巴。发现问题时应在写出 literalSpeech 前自行重组表达；世界不会事后替你改台词。
- voiceContract.driftRisks 只是提醒长期声音可能滑向哪里，不是禁词表；人物仍可能因为疲劳、敷衍、模仿、撒谎、职业场合或偶然失态说出和平常不同的话。
- 台词不是 privateReason、欲望列表、sceneRole 或 personalOpenLoops 的口头摘要。一个人物心里可以同时压着多件事，但一句话只需突出眼下最需要对方回应的一个动作；次要目的可以借停顿顺带露出、以后再说，或继续留在心里。
- 别人的话只是你可处理的刺激，不是强制答题。你可以回答、拒绝、延期、反问、回避、顾左右而言他、误解、沉默或另开话题；用 communicationPlan.threadDisposition 说明本人打算如何处理线程。关系越熟，越可以省略双方已经知道的内容。
- openConversationThreads.publicContentLedger 只整理本人已经听见的原话中明确出现过的姓名、来意和问题，不保证内容为真。提出问题前先看上一句是否已经字面给出答案；你仍可因为怀疑、误听、试探、逗弄或故意逼对方重说而再问，但那必须是你本人的认知或表达选择，不能像系统遗失了上一句。
- agent.psychologyAnchor 是由作者材料、校准和保留题编译出的本人运行底座：只含核心追求、自我威胁、稳定倾向、动态状态基线、信息可信度、欲望、阻碍、语言功能和关系维度。它不含校准答案、保留题、固定台词或预写行动；你必须结合眼前所见自行形成并选择具体手段。
- agent.privateState.selfModel 只说明本轮人物权威来源；validated 人物的心理内容以 psychologyAnchor 和 owned memory 为准。sceneRole 只提供在场原因、当前来意、职责、本人所知的许可事实和场所关系；职责不是核心欲望，场所也不会替你选择行动。
- postChoiceContinuity 是你对“如果这次行动被世界真正提交，自己的记忆、未满足欲望压力、动态状态和自我认识可能怎样延续”的定性提案。它必须保持 phase=pending_world_resolution，并引用输入中真实存在的 candidate/desire/state/memory ids；你不能预先宣布收益已经发生，也不能直接改写状态。世界结算后才决定哪些提案落账。
- relationshipAppraisal 只属于你本人对自己已经感知到的人和事件的解释。别人说了 answer、refuse 或帮了忙，并不自动决定你更信任、依赖或怨恨他；你可以选 none。provisional 只保留暂时印象，retained 必须引用本人直接感知且确实关于该对象的 impact，世界只验证来源和应用你本人选择的维度方向。
- “嗯”“知道了”、普通服务话、无对象客套、机构口吻或把现实说成“上一轮”都会进入声纹与状态诊断，但不会被系统自动删除。是否这样说由你的人格、状态和表达目的决定，世界只记录实际说出口的字句。
- 对熟人刚刚提出的明确请求，极短应声可以和紧接着的动作共同承担意义；也可以只敷衍、回避或什么都不做。不要为了让单句独立完整而复述双方都知道的内容。
- 可以继续手上的事、主动做事、说话、移动、交付物件、拒绝、延期或保持沉默；不需要为了轮到自己而硬说话。
- targetCharacterId 只能是 perceivedCharacters 中的人；moveToZoneId 只能来自 reachableZones，而且每次只能尝试相邻一段。reachableZones 中的 physicalAccess 说明路线与障碍，socialAccess 只是本人可评价的许可／所有权事实：未获许可不会删除目的地，物理障碍则可能让到达失败。availableAffordances 若给出 moveToZoneId，必须使用该目标，不能把一次经营动作偷换成另一个目的地。
- targetCharacterId 表示本轮言语、接触、明显注视或其他具体行动实际指向的现场人物；即使所选心理候选没有预绑对象，只要 visibleAction 明确写在看、试探或作用某个 perceivedCharacters，就应填写该人物句柄。intendedAudienceCharacterIds 只表示你想让谁收到话；实际称呼可以因误认、挑衅、玩笑或记忆错误而不同。visibleAction 涉及真实接触、移动或物件时仍必须由世界验证，错误台词不会替你完成动作。
- perceivedCharacters 只列本人本轮确实注意到的人，并附本人注意到的有限特征；它不是全场人物名单。其中 identityKnown=false 的人仍是未确认身份者。你可以试探、猜测、故意叫错或提到自己听过的姓名，但 cognitiveAppraisal 不能把这种说法伪装成已经确认的观察。
- identityReferenceContract 中 known_entity 是你从记忆或传闻里知道的那个人，perceived_entity 是眼前尚未认出的具体来客；即使世界底层知道他们恰好是谁，你也不能把两个句柄自动视为同一人。只有你依据本轮确实感知到的证据形成身份确认后，后续记忆才可以建立连接；本轮身体动作、对话听者和关系评价仍只能指向 perceivedCharacters。
- 八卦或转述若填写 informationSourceImpactId，只能引用本人 perceptionMemory 或 agent.memoryContext 中真实存在的来源；也可以不引用而说未经证实、虚构或故意编造的话，可信度与后果由听者自己的 Agent 判断。
- speechAct 只描述这句话最主要的公开功能；speechFunctions 必须列出这句话实际承担的全部公开功能，不要求把一句话压成单一功能。你可以在回答旧问题后紧接着提出自己的问题，此时应同时登记 answer 与 ask。threadDisposition 说明你主观上想结清、拒绝、延期、回避、反问、转向、忽略或另开线程。说了一句话不会自动等于回答完毕。
- threadDisposition 只表达说话者本人想怎样处理这次发言，不能替听者决定“已经回答”“我满意了”或“线程结束”。听者必须先真正收到话，再在自己的下一次 cognitiveAppraisal.threadAppraisals 中作判断；双方可以长期对同一段对话持不同理解。
- visibleAction 只写身体上可见的动作，不写心理和结果；世界内核会验证距离、相邻通路、物理障碍、物件和经营后果。社会许可不会抹掉已经发生的尝试或越界，只会成为本人和真实感知者可能评价的事实与后果。
- embodiedIntent.intendedGesture 只写本人打算怎样动，不得把“对方已经接到”“钱已经入账”“房已分好”之类结果写成意图。actionAttempt.primitive=none 表示没有提交身体尝试；物件动作必须引用 perceivedObjects 中本人确实能定位的 objectId。世界会另行返回 success / partial / failed / not_attempted，绝不把意图文字直接当成既成事实。
- decisionValue 只记录本人此刻真正作出的 accept/refuse/defer 决定；含糊回应、询问、日常陈述和沉默必须写 none。
- materialFacts 是世界用于结算的公开经营事实，不是禁言清单。你可以忘记、质疑、撒谎或再次询问；但只有 availableAffordances 与世界提交能够真正接待、验货、派活、做工、交饭、结账或改变库存，台词宣称不会改账。
- 茶饭遵循 request → preparation process → ready → finish → delivery movement → serve → consume → settlement。点单不会瞬间变出成品；start_service_preparation 会占用真实器皿与库存并创建有 readyAtSeconds 的世界过程，时间走完后仍需 finish_service_preparation 收尾，再由人物实际送到客人面前。过程等待期间你仍可观察、说话或处理别的刺激；continuous_work 可被 interrupt/resume，passive_wait 不会因为说一句话自动停止。
- serviceChoice 与 serviceChoiceTool 若存在，描述当前可见商品的类别、份量、品质线索、价格与库存，以及本人身体需要、修行补给方式、实际钱包、凡俗钱财取得成本、经济义务、消费倾向、客位和占桌惯例。凡食只按本人的凡食依赖度产生生理价值；高阶修士仍可因口味、礼节、社交、停留或打听消息而消费。凡俗钱财容易取得只降低价格压力，不会凭空增加当前钱袋。不能因为人物说“来打听消息”就推断其拒绝一切茶饭，不能因为有钱就推断其必点最贵，也不能因为点茶就宣告私人目的已完成。数学只比较价值，最终服务与座位由本人选择。
- 人物可以公开说明来意，也可以先点单、落座、观察、问一个具体话头、转开或继续沉默；公开多少由本人的表达策略决定。不要因为后台知道“打听消息”等抽象目的，就把后台目的标签原样念成一句任务汇报。只有实际问句、明确请求或仍在等待答复的 conversation thread 才形成回应义务。
- receive_guest 只表示当面接住来意：可以确认需求、价钱与是否有空房，但不能提前指定哪间房、说钥匙已交、把楼上客房说成后院，也不能在未留下 commitment 时说饭茶“马上来”。房间、饭茶和钱各自由后续 affordance 真正提交。
- 选择 declare_visit_purpose 时，台词必须真的说出本次具体目的，并自然包含该 affordance 的 requiredPurposeTerms；“进来了”“还是老样子”或单纯寒暄都不算说明来意。
- availableAffordances 为空不等于无事可做：可以先移动到当事人所在 zone、说清来意或继续自己的行动，但不得凭空改变库存、钱箱和来访阶段。
- recentOwnActions 供你感知自己的行为惯性。重复动作可能自然、焦虑、习惯或机械；系统只做多轮诊断，不因重复本身自动删掉。
- repairFeedback 只会在候选 id、私有证据引用、动作结构、物件、非相邻目的地或 affordance 等协议错误时出现，不会因为人物打算越界、台词不真实、不合作或不够有声纹而触发。锁门等物理失败由世界作为行动结果返还，不要求人物先改选。attempt=1 时，若 candidateId 有效可保持同一候选只修正越权部分，若 id 不存在或不可行则由你本人重新选择；attempt=2 表示上一份修正仍无法成为世界行动，你必须由同一个人物重新比较当前 feasible=true 的候选并给出一份完整的新决定。世界不会替人物补选，也不会把技术拒绝当成沉默或放弃。
- 一个回答如果没有提出新问题，不要求对方再确认。只输出 JSON。`;
}

export function tavernCausalAgentUserPrompt(input = {}) {
  return `你此刻收到的个人场景输入：
${JSON.stringify(input, null, 2)}

决定自己接下来的一次行动。`;
}

async function defaultRunAgent(input, { signal } = {}) {
  const startedAt = Date.now();
  const { parsed, meta } = await callOpenAIJson({
    system: tavernCausalAgentSystemPrompt(input),
    user: tavernCausalAgentUserPrompt(input),
    schema: tavernCausalAgentDecisionSchema,
    schemaName: "character_town_tavern_causal_agent",
    schemaHintMode: "compact",
    signal,
  });
  return {
    decision: parsed || {},
    stage: {
      name: `TavernCausalAgent:${input.agent?.name || input.agent?.id || "unknown"}`,
      provider: "openai",
      model: meta?.model || "",
      elapsedMs: Date.now() - startedAt,
    },
  };
}

export const runTavernCausalAgent = defaultRunAgent;

function repeatedGestureSignature(value = "") {
  const line = text(value, 180);
  if (/擦.{0,8}(手|围裙)|在围裙上.{0,8}擦/.test(line)) return "wipe-hands";
  if (/点了?点头|点头|颔首/.test(line)) return "nod";
  if (/扶正.{0,8}(凳|椅)/.test(line)) return "straighten-seat";
  return "";
}

function normalizedSpeechForComparison(value = "") {
  return text(value, 240)
    .replace(/[\s，。！？、；：,.!?;:“”"'「」『』（）()—…]/g, "")
    .replace(/^(?:好|行|嗯|那|可是|但是|不过)+/u, "");
}

function speechShingles(value = "") {
  const normalized = normalizedSpeechForComparison(value);
  const shingles = new Set();
  for (let index = 0; index < normalized.length - 1; index += 1) shingles.add(normalized.slice(index, index + 2));
  return shingles;
}

function speechSimilarity(left = "", right = "") {
  const leftNormalized = normalizedSpeechForComparison(left);
  const rightNormalized = normalizedSpeechForComparison(right);
  if (!leftNormalized || !rightNormalized) return 0;
  if (leftNormalized === rightNormalized) return 1;
  const leftShingles = speechShingles(leftNormalized);
  const rightShingles = speechShingles(rightNormalized);
  if (!leftShingles.size || !rightShingles.size) return 0;
  let overlap = 0;
  for (const shingle of leftShingles) if (rightShingles.has(shingle)) overlap += 1;
  return (2 * overlap) / (leftShingles.size + rightShingles.size);
}

function continuationSpeechNeedsSource(value = "") {
  const line = text(value, 180);
  if (!line) return false;
  return /^(?:嗯|好|行|知道了|我知道了|明白了|我明白了)[，。！？、\s]?/u.test(line)
    || /(?:这事|那事|刚才|方才|先前|回头再说|晚些再说|明早再说|不必再问|别再问|你自己拿主意)/u.test(line);
}

function semanticCharacters(state = {}, runtime = {}) {
  return (state.characters || []).map((character) => ({
    id: character.id,
    name: character.name || runtime.agents?.[character.id]?.characterName || character.id,
    aliases: [...new Set((state.relationships || [])
      .filter((relationship) => relationship.toCharacterId === character.id)
      .flatMap((relationship) => relationship.allowedAddresses || [])
      .filter(Boolean))],
  }));
}

function semanticZones(runtime = {}) {
  // Labels and aliases come from the single canonical zone vocabulary.
  return Object.values(runtime.topology?.zones || {}).map((zone) => {
    const vocabulary = TAVERN_ZONE_VOCABULARY[zone.id] || {};
    return {
      id: zone.id,
      label: zone.label || vocabulary.label || zone.id,
      aliases: [
        ...(vocabulary.label && vocabulary.label !== (zone.label || vocabulary.label) ? [vocabulary.label] : []),
        ...(vocabulary.aliases || []),
      ],
    };
  });
}

function semanticObservationRows(input = {}) {
  const actorId = input.agent?.id || "";
  const live = [...(input.perceivedImpacts || []), ...(input.perceptionMemory || [])].map((impact) => ({
    id: impact.impactId,
    observerId: actorId,
    channel: impact.modality,
    content: impact.content,
    eventId: impact.provenance?.sourceActionId || impact.impactId,
  }));
  const remembered = (input.agent?.memoryContext?.episodes || []).map((episode) => ({
    id: episode.id,
    observerId: actorId,
    channel: episode.perception?.modality || "memory",
    content: episode.perception?.content || "",
    eventId: episode.objectiveEventId || episode.sourceImpactId || episode.id,
  }));
  return [...live, ...remembered];
}

function semanticFactRows(input = {}) {
  const actorId = input.agent?.id || "";
  const material = (input.materialFacts || []).map((fact, index) => ({
    id: fact.id || `material-fact:${fact.visitId || index}`,
    content: JSON.stringify(fact),
    tags: ["material", fact.serviceStatus, fact.paymentStatus, fact.deliveryStatus, fact.lodgingStatus].filter(Boolean),
    knownByCharacterIds: [actorId],
  }));
  const memories = (input.agent?.privateState?.ownMemories || []).filter((memory) => memory.id).map((memory) => ({
    id: memory.id,
    content: memory.content,
    tags: [memory.type, memory.day != null ? `day:${memory.day}` : ""].filter(Boolean),
    knownByCharacterIds: [actorId],
  }));
  const cognitiveMemories = (input.agent?.memoryContext?.episodes || []).map((episode) => ({
    id: episode.id,
    content: `${episode.perception?.content || ""} ${episode.semanticFrame?.object?.label || ""}`.trim(),
    tags: [episode.semanticFrame?.predicate, episode.semanticFrame?.topicId, `day:${episode.perceivedAt?.worldDay ?? ""}`].filter(Boolean),
    knownByCharacterIds: [actorId],
  }));
  return [...material, ...memories, ...cognitiveMemories];
}

function semanticSourceConversation(input = {}, runtime = {}) {
  const actorId = input.agent?.id || "";
  const sourceImpactId = input.activation?.impactId || "";
  const perceived = [...(input.perceivedImpacts || []), ...(input.perceptionMemory || [])];
  const sourceImpact = perceived.find((impact) => impact.impactId === sourceImpactId);
  const sourceActionId = sourceImpact?.provenance?.sourceActionId || input.activation?.sourceActionId || "";
  const sourceAction = (runtime.actions || []).find((action) => action.id === sourceActionId);
  if (sourceAction?.speech && sourceAction.targetCharacterId === actorId) {
    return {
      conversationId: `conversation:${sourceAction.id}`,
      turnId: sourceAction.id,
      participantIds: [sourceAction.actorId, actorId],
      turn: {
        id: sourceAction.id,
        speakerId: sourceAction.actorId,
        addresseeId: actorId,
        speechAct: sourceAction.speechAct,
        speechFunctions: actionSpeechFunctions(sourceAction),
        utterance: sourceAction.speech,
      },
    };
  }
  const liveSourceCharacterId = sourceImpact?.sourceCharacterId || input.activation?.sourceCharacterId || "";
  const liveDirectedSpeech = Boolean(sourceImpact?.directed ?? input.activation?.directed)
    && (sourceImpact?.modality || input.activation?.modality) === "sound"
    && (sourceImpact?.type || input.activation?.type) === "speech"
    && liveSourceCharacterId
    && liveSourceCharacterId !== actorId
    && text(sourceImpact?.content || input.activation?.content, 260);
  if (liveDirectedSpeech) {
    const turnId = sourceActionId || sourceImpactId;
    return {
      conversationId: `conversation:${turnId}`,
      turnId,
      participantIds: [liveSourceCharacterId, actorId],
      turn: {
        id: turnId,
        speakerId: liveSourceCharacterId,
        addresseeId: actorId,
        speechAct: sourceImpact?.speechAct || "inform",
        speechFunctions: [...(sourceImpact?.speechFunctions || inferPublicSpeechFunctions({
          speech: sourceImpact?.content || input.activation?.content || "",
          speechAct: sourceImpact?.speechAct || "inform",
        }))],
        utterance: sourceImpact?.content || input.activation?.content || "",
      },
    };
  }
  const sourceThreadId = sourceImpact?.provenance?.sourceThreadId || "";
  const thread = (input.openConversationThreads || []).find((candidate) => candidate.id === sourceThreadId);
  const sourceTurn = [...(thread?.turns || [])].reverse().find((turn) => (
    turn.utterance && (!turn.addresseeId || turn.addresseeId === actorId)
  ));
  if (!thread || !sourceTurn || (thread.nextObligationCharacterId && thread.nextObligationCharacterId !== actorId)) return null;
  return {
    conversationId: `conversation:${thread.id}`,
    turnId: sourceTurn.id,
    participantIds: [...(thread.participantIds || [])],
    turn: sourceTurn,
  };
}

function semanticConversationRows(input = {}, runtime = {}) {
  const source = semanticSourceConversation(input, runtime);
  if (!source) return [];
  return [{
    id: source.conversationId,
    status: "open",
    participantIds: source.participantIds,
    expectedResponderId: input.agent?.id || "",
    openTurnIds: [source.turnId],
    turns: [source.turn],
  }];
}

function semanticEvidenceForDecision(input = {}, runtime = {}, speech = "") {
  const perceived = [...(input.perceivedImpacts || []), ...(input.perceptionMemory || [])];
  const activation = perceived.find((impact) => impact.impactId === input.activation?.impactId);
  const sourceObservationIds = [
    input.activation?.modality === "sound" ? input.activation?.impactId : "",
  ].filter(Boolean);
  const facts = semanticFactRows(input);
  const temporalEvidenceIds = facts.filter((fact) => (
    (/明早|明日|明天|翌日/.test(speech) && /明早|明日|明天|翌日/.test(fact.content))
    || (/昨日|昨天|昨晚|昨夜|昨儿/.test(speech) && /昨日|昨天|昨晚|昨夜|昨儿/.test(fact.content))
  )).map((fact) => fact.id);
  const sourceConversation = semanticSourceConversation(input, runtime);
  return {
    sourceObservationIds,
    temporalEvidenceIds,
    responseToTurnId: sourceConversation?.turnId || "",
    conversationId: sourceConversation?.conversationId || "",
    facts,
  };
}

function chineseCount(value = "") {
  const token = String(value || "");
  if (/^\d+$/.test(token)) return Number(token);
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (Object.hasOwn(digits, token)) return digits[token];
  if (token === "十") return 10;
  const match = token.match(/^([一二两三四五六七八九])?十([一二两三四五六七八九])?$/u);
  if (!match) return Number.NaN;
  return (match[1] ? digits[match[1]] : 1) * 10 + (match[2] ? digits[match[2]] : 0);
}

function contradictoryPriceEquation(spoken = "") {
  const totalMatch = spoken.match(/(?:一共|一并|合计|总共).{0,4}([零一二两三四五六七八九十\d]+)(?:枚|文)/u);
  if (!totalMatch || totalMatch.index == null) return null;
  const componentAmounts = [...spoken.slice(0, totalMatch.index).matchAll(/([零一二两三四五六七八九十\d]+)(?:枚|文)/gu)]
    .map((match) => chineseCount(match[1]))
    .filter(Number.isFinite);
  const total = chineseCount(totalMatch[1]);
  if (componentAmounts.length < 2 || !Number.isFinite(total)) return null;
  const sum = componentAmounts.reduce((value, amount) => value + amount, 0);
  return sum === total ? null : { componentAmounts, total, sum };
}

function materialClaimViolations(
  input = {},
  selectedAffordance = null,
  targetCharacterId = "",
  speech = "",
  visibleAction = "",
  commitmentAction = "none",
  commitmentTopic = "",
) {
  const allowedType = selectedAffordance?.type || "";
  const actorId = input.agent?.id || "";
  const facts = (input.materialFacts || []).filter((fact) => (
    !targetCharacterId
    || fact.visitorId === targetCharacterId
    || fact.hostId === targetCharacterId
    || fact.visitorId === actorId
  ));
  const spoken = text(speech, 180);
  const visible = text(visibleAction, 180);
  const violations = [];
  const add = (code, field, message) => violations.push({ code, field, message, evidence: { allowedAffordanceType: allowedType } });
  if (facts.some((fact) => fact.paymentMode === "cash" && Number(fact.price || 0) >= 0) && /银(?:子|两)?|钱银/.test(spoken)) {
    add("MATERIAL_CURRENCY_MISMATCH", "utterance", "人物说出的银钱单位与酒馆当前铜钱账目不一致；该话语不改写真实价格或账本。");
  }
  const priceContradiction = contradictoryPriceEquation(spoken);
  if (priceContradiction) {
    violations.push({
      code: "MATERIAL_PRICE_ARITHMETIC_CONTRADICTION",
      field: "utterance",
      message: "人物说出的分项价格与合计彼此矛盾；该话语照常发生，但不形成有效账目结算。",
      evidence: { allowedAffordanceType: allowedType, ...priceContradiction },
    });
  }
  const lodgingPending = facts.some((fact) => fact.lodgingStatus === "pending");
  if (lodgingPending && allowedType !== "assign_lodging") {
    if (/(?:客房|房间).{0,14}(?:留给|留一间|备一间|安排好|定下|给你留|收拾|拾掇|靠东|靠西|靠北|靠南|靠窗|那间|哪间|空着)|(?:留给|留一间|备一间|安排好|定下|收拾|拾掇|靠东|靠西|靠北|靠南|靠窗).{0,14}(?:客房|房间)|(?:二楼|楼上).{0,12}(?:靠东|靠西|靠北|靠南|靠窗|那间|哪间|空着|床铺)|(?:靠东|靠西|靠北|靠南|靠窗).{0,8}(?:那间|哪间).{0,8}(?:空着|床铺)|(?:先|可以|可).{0,5}(?:上楼|进房|回房)|钥匙.{0,10}(?:交给|给你|收好)/u.test(spoken)) {
      add("MATERIAL_LODGING_NOT_ASSIGNED", "utterance", "人物声称已经留房或交钥匙，但客房与钥匙尚未通过世界动作完成交付。");
    }
    if (/(?:把|将).{0,12}(?:钥匙).{0,12}(?:交|递|塞|放到)|(?:领|带).{0,8}(?:上楼|认门)/.test(visible)) {
      add("MATERIAL_LODGING_NOT_ASSIGNED", "visibleAction", "交钥匙或领客认房必须由 assign_lodging 经营动作提交。");
    }
  }
  const servicePending = facts.some((fact) => !["served", "not_required", "unknown"].includes(fact.serviceStatus));
  if (servicePending && !["serve_guest", "serve_work_meal", "verify_and_serve_work_meal"].includes(allowedType)) {
    if (/(?:饭|热饭|茶|热茶).{0,10}(?:已经送到|已经端来|给你端来|给你送来|好了，?趁热|来了|慢用)|(?:已经|这就).{0,8}(?:把|将).{0,8}(?:饭|茶).{0,8}(?:交给|端给|送给)/.test(spoken)) {
      add("MATERIAL_SERVICE_NOT_SERVED", "utterance", "人物声称饭茶已经送到，但服务账本尚未记录实际交付。");
    }
    if (/(?:把|将|端着).{0,16}(?:热饭|饭碗|热茶|茶碗).{0,16}(?:交到|递给|端到|放到|放在).{0,8}(?:面前|桌上|手中)/.test(visible)) {
      add("MATERIAL_SERVICE_NOT_SERVED", "visibleAction", "把饭茶交到客人手中或桌上必须由服务 affordance 提交。");
    }
    const trackedServiceProcess = [
      "approach_service_station",
      "start_service_preparation",
      "interrupt_service_preparation",
      "resume_service_preparation",
      "finish_service_preparation",
      "approach_service_delivery",
    ].includes(allowedType);
    const trackedServicePromise = trackedServiceProcess
      || (commitmentAction === "open" && /(?:饭|茶|上饭|上茶)/u.test(text(commitmentTopic, 120)));
    if (!trackedServicePromise && /(?:饭|茶).{0,10}(?:马上|这就|待会儿|一会儿|等下|稍后|就|好了|热好|做好).{0,8}(?:来|端|送|好|热|盛|煮|上|拿)|(?:马上|这就|待会儿|一会儿|等下|稍后).{0,5}(?:端|送|上|热|盛|煮).{0,5}(?:饭|茶)|(?:端|送|拿).{0,6}(?:饭|茶).{0,8}(?:屋里|房里|房间)/u.test(spoken)) {
      add("MATERIAL_SERVICE_PROMISE_UNTRACKED", "utterance", "人物口头许诺稍后上饭或上茶，但没有建立可追踪承诺；该话语本身不保证服务会发生。");
    }
  }
  if (/(?:客房|房间).{0,10}(?:在|位于|设在).{0,6}(?:后院|院里)|(?:后院|院里).{0,10}(?:客房|房间)/u.test(spoken)) {
    add("MATERIAL_LODGING_ZONE_CONTRADICTION", "utterance", "台词宣称的房间位置与本场景空间拓扑不一致：客房区与后院是两个不同分区。 ");
  }
  const deliveryPending = facts.some((fact) => fact.deliveryStatus === "pending");
  const deliverySettlementPattern = /(?:药包|货物|清单).{0,16}(?:验收|收进柜台|已经收下)/;
  if (deliveryPending && allowedType !== "accept_delivery") {
    if (deliverySettlementPattern.test(spoken)) {
      add("MATERIAL_DELIVERY_NOT_ACCEPTED", "utterance", "人物声称货物已经验收，但交付账本仍是待验状态。");
    }
    if (deliverySettlementPattern.test(visible)) {
      add("MATERIAL_DELIVERY_NOT_ACCEPTED", "visibleAction", "货物验收与收柜必须由 accept_delivery 世界动作结算。");
    }
  }
  const paymentPending = facts.some((fact) => fact.paymentStatus === "unpaid");
  if (paymentPending && !["pay_cash", "settle_cash"].includes(allowedType)) {
    const paymentSettlementPattern = /(?:铜钱|房饭钱|饭钱|茶钱).{0,12}(?:收齐|付清|结清|收入钱箱)|(?:收齐|付清|结清).{0,12}(?:铜钱|账|钱)/;
    if (paymentSettlementPattern.test(spoken)) {
      add("MATERIAL_PAYMENT_NOT_SETTLED", "utterance", "人物声称账款已经结清，但付款账本仍是未付状态。");
    }
    if (paymentSettlementPattern.test(visible)) {
      add("MATERIAL_PAYMENT_NOT_SETTLED", "visibleAction", "实际点钱入账必须由 pay_cash 或 settle_cash 世界动作结算。");
    }
    if (/(?:数出|取出|摸出|掏出|拿出).{0,14}(?:铜钱|钱).{0,16}(?:放在|放到|递给|交给|推给|推到|推过去)|(?:铜钱|钱).{0,12}(?:放在|放到|递给|交给|推给|推到|推过去).{0,10}(?:桌|柜台|手)/u.test(visible)) {
      add("MATERIAL_PAYMENT_ACTION_UNAUTHORIZED", "visibleAction", "递钱、桌上放钱或把钱推给经手人必须由 pay_cash/settle_cash 提交，不能只写进自由动作。 ");
    }
  }
  const paymentSettled = facts.some((fact) => ["paid", "credit", "work_settled"].includes(fact.paymentStatus));
  const repeatedPaymentPattern = /(?:铜钱|房饭钱|饭钱|茶钱).{0,16}(?:收进|收入|收下|点清|推给|递给|交给).{0,8}(?:钱箱|柜台|手中)?|(?:收进|收入|收下|点清).{0,10}(?:钱箱|铜钱|房饭钱|饭钱|茶钱)/u;
  if (paymentSettled && !["pay_cash", "settle_cash"].includes(allowedType)) {
    if (repeatedPaymentPattern.test(spoken)) {
      add("MATERIAL_PAYMENT_ALREADY_SETTLED", "utterance", "人物声称再次收钱或交钱，但真实账目已经结清；话语不会重复入账。");
    }
    if (repeatedPaymentPattern.test(visible)) {
      add("MATERIAL_PAYMENT_ALREADY_SETTLED", "visibleAction", "真实账目已经结清，重复收钱动作不会再次写入账本。");
    }
  }
  return violations;
}

function validateFinalDecisionSemantics(candidate = {}, input = {}, state = {}, runtime = {}) {
  const evidence = semanticEvidenceForDecision(input, runtime, candidate.speech || "");
  const context = {
    characters: semanticCharacters(state, runtime),
    zones: semanticZones(runtime),
    observations: semanticObservationRows(input),
    facts: evidence.facts,
    openConversations: semanticConversationRows(input, runtime),
  };
  return validateSemanticTurn({
    actorId: input.agent?.id || "",
    actorZoneId: input.scene?.zoneId || "",
    targetCharacterId: candidate.targetCharacterId || "",
    speechAct: candidate.speechAct || "none",
    utterance: candidate.speech || "",
    visibleAction: candidate.visibleAction || "",
    moveToZoneId: candidate.moveToZoneId || "",
    sourceObservationIds: [candidate.informationSourceImpactId, ...evidence.sourceObservationIds].filter(Boolean),
    temporalEvidenceIds: evidence.temporalEvidenceIds,
    responseToTurnId: evidence.responseToTurnId,
    conversationId: evidence.conversationId,
  }, context);
}

function noOpCognitiveAppraisal() {
  return {
    noticedEvidenceIds: [],
    interpretations: [],
    beliefOperations: [],
    entityModelUpdates: [],
    locationBeliefUpdates: [],
    sourceKnowledgeBeliefUpdates: [],
    threadAppraisals: [],
  };
}

function noOpCommunicationPlan() {
  return {
    goal: "none",
    tactic: "silence",
    disclosure: "withhold",
    epistemicRelation: "not_applicable",
    intendedAudienceCharacterIds: [],
    desiredEffect: "",
    threadDisposition: "none",
    epistemicActionCandidateId: "",
    presuppositionStance: "not_applicable",
    epistemicBasisEvidenceIds: [],
  };
}

function voiceToolParameterValues(tool = {}) {
  const parameters = tool.parameters || {};
  const unit = (value, fallback = 0.5) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
  };
  return {
    directness: unit(parameters.directness?.value),
    compression: unit(parameters.compression?.value),
    warmth: unit(parameters.warmth?.value),
    reserve: unit(parameters.reserve?.value),
    formality: unit(parameters.formality?.value),
    emotionalLeakage: unit(parameters.emotionalLeakage?.value),
  };
}

function noOpSpeechRealizationPlan(tool = {}, { hasSpeech = false } = {}) {
  return {
    mustConvey: [],
    mayReveal: [],
    withhold: [],
    desiredListenerEffect: "",
    subtext: "",
    relationshipRegister: "",
    timing: hasSpeech ? "standalone" : "silence",
    appliedVoiceParameters: voiceToolParameterValues(tool),
    intentionalDepartureReason: "",
    minimumSufficiency: {
      listenerCanRespondAfterMustConvey: false,
      additionalPublicExplanationServesChosenAction: false,
      additionalPublicExplanationPurpose: "",
      explanationsKeptPrivate: [],
    },
    selfCheck: {
      soundsLikePrivateSummary: false,
      interchangeableAcrossCharacters: false,
      repeatsWhatActionAlreadyShows: false,
      containsUnnecessaryExplanatoryTail: false,
    },
  };
}

function normalizeSpeechRealizationPlan(rawPlan = null, tool = {}, { hasSpeech = false } = {}) {
  if (!rawPlan || typeof rawPlan !== "object" || Array.isArray(rawPlan)) {
    return {
      value: noOpSpeechRealizationPlan(tool, { hasSpeech }),
      authority: "legacy-voice-plan-migration-adapter",
      diagnostics: [],
    };
  }
  const allowedTiming = new Set(["before_action", "during_action", "after_action", "standalone", "delayed", "silence"]);
  const baseParameters = voiceToolParameterValues(tool);
  const applied = Object.fromEntries(Object.keys(baseParameters).map((key) => {
    const numeric = Number(rawPlan.appliedVoiceParameters?.[key]);
    return [key, Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : baseParameters[key]];
  }));
  const rows = (value, max = 6) => [...new Set((Array.isArray(value) ? value : [])
    .map((row) => text(row, 180))
    .filter(Boolean))].slice(0, max);
  const value = {
    mustConvey: rows(rawPlan.mustConvey),
    mayReveal: rows(rawPlan.mayReveal),
    withhold: rows(rawPlan.withhold),
    desiredListenerEffect: text(rawPlan.desiredListenerEffect, 220),
    subtext: text(rawPlan.subtext, 220),
    relationshipRegister: text(rawPlan.relationshipRegister, 160),
    timing: allowedTiming.has(rawPlan.timing) ? rawPlan.timing : (hasSpeech ? "standalone" : "silence"),
    appliedVoiceParameters: applied,
    intentionalDepartureReason: text(rawPlan.intentionalDepartureReason, 220),
    minimumSufficiency: {
      listenerCanRespondAfterMustConvey: Boolean(rawPlan.minimumSufficiency?.listenerCanRespondAfterMustConvey),
      additionalPublicExplanationServesChosenAction: Boolean(rawPlan.minimumSufficiency?.additionalPublicExplanationServesChosenAction),
      additionalPublicExplanationPurpose: text(rawPlan.minimumSufficiency?.additionalPublicExplanationPurpose, 220),
      explanationsKeptPrivate: rows(rawPlan.minimumSufficiency?.explanationsKeptPrivate),
    },
    selfCheck: {
      soundsLikePrivateSummary: Boolean(rawPlan.selfCheck?.soundsLikePrivateSummary),
      interchangeableAcrossCharacters: Boolean(rawPlan.selfCheck?.interchangeableAcrossCharacters),
      repeatsWhatActionAlreadyShows: Boolean(rawPlan.selfCheck?.repeatsWhatActionAlreadyShows),
      containsUnnecessaryExplanatoryTail: Boolean(rawPlan.selfCheck?.containsUnnecessaryExplanatoryTail),
    },
  };
  const diagnostics = [];
  if (!hasSpeech && value.timing !== "silence") diagnostics.push({
    code: "VOICE_PLAN_TIMING_WITHOUT_SPEECH",
    layer: "speechRealizationPlan",
    message: "人物没有说话，但私有表达计划仍把台词安排在动作前后；只记录诊断，不替人物开口。",
  });
  if (hasSpeech && value.timing === "silence") diagnostics.push({
    code: "VOICE_PLAN_SILENCE_WITH_LITERAL_SPEECH",
    layer: "speechRealizationPlan",
    message: "人物的私有表达计划选择沉默，但实际又说出了话；现实保留原话，心理归因需要复核。",
  });
  if (hasSpeech && (value.selfCheck.soundsLikePrivateSummary
    || value.selfCheck.interchangeableAcrossCharacters
    || value.selfCheck.containsUnnecessaryExplanatoryTail)) diagnostics.push({
    code: "VOICE_PLAN_SELF_REPORTED_SURFACE_DRIFT",
    layer: "speechRealizationPlan",
    message: "人物自己的表达复核已发现后台摘要腔、可互换台词或无行动功能的解释尾巴；不审查删除原话，但把漂移留给后续同一 Agent 重新考虑。",
    evidence: deepClone(value.selfCheck),
  });
  if (hasSpeech && value.selfCheck.containsUnnecessaryExplanatoryTail) diagnostics.push({
    code: "VOICE_PLAN_UNNECESSARY_EXPLANATORY_TAIL",
    layer: "speechRealizationPlan.minimumSufficiency",
    message: "最少公开语义已经足以让听者回应，后续解释没有承担已选行动的具体功能；人物原话仍被保留。",
    evidence: deepClone(value.minimumSufficiency),
  });
  if (hasSpeech
    && value.minimumSufficiency.additionalPublicExplanationServesChosenAction
    && !value.minimumSufficiency.additionalPublicExplanationPurpose) diagnostics.push({
    code: "VOICE_PLAN_EXPLANATION_PURPOSE_MISSING",
    layer: "speechRealizationPlan.minimumSufficiency",
    message: "人物声称额外解释服务已选行动，却没有说明它承担什么具体功能；原话不被审查，表达计划需要复核。",
  });
  return { value, authority: "character-agent", diagnostics };
}

function legacyActionAttempt(raw = {}) {
  const destinationId = text(raw.moveToZoneId, 80);
  const affordanceId = text(raw.affordanceId, 160);
  const intendedGesture = text(raw.visibleAction, 180);
  const actionType = ACTION_TYPES.has(raw.actionType) ? raw.actionType : "pass";
  const primitive = affordanceId
    ? "use_affordance"
    : destinationId ? "move"
    : actionType === "leave" ? "leave"
    : intendedGesture ? (actionType === "interact" ? "interact" : "gesture")
    : "none";
  return {
    primitive,
    objectId: "",
    targetCharacterId: text(raw.targetCharacterId, 160),
    destinationId,
    affordanceId,
  };
}

function normalizeCharacterExpressionLayers(raw = {}) {
  const hasUtterance = raw.utterance && typeof raw.utterance === "object" && !Array.isArray(raw.utterance);
  const hasEmbodiedIntent = raw.embodiedIntent && typeof raw.embodiedIntent === "object" && !Array.isArray(raw.embodiedIntent);
  const hasActionAttempt = raw.actionAttempt && typeof raw.actionAttempt === "object" && !Array.isArray(raw.actionAttempt);
  const fallbackAttempt = legacyActionAttempt(raw);
  const primitive = ACTION_ATTEMPT_PRIMITIVES.includes(raw.actionAttempt?.primitive)
    ? raw.actionAttempt.primitive
    : fallbackAttempt.primitive;
  return {
    utterance: {
      literalSpeech: text(hasUtterance ? raw.utterance.literalSpeech : raw.speech, 180)
        .replace(/^[“”"「」『』]+|[“”"「」『』]+$/g, ""),
      vocalMode: (hasUtterance ? raw.utterance.vocalMode : raw.vocalMode) === "call_out" ? "call_out" : "conversational",
    },
    embodiedIntent: {
      manner: text(hasEmbodiedIntent ? raw.embodiedIntent.manner : "", 160),
      posture: text(hasEmbodiedIntent ? raw.embodiedIntent.posture : "", 160),
      intendedGesture: text(hasEmbodiedIntent ? raw.embodiedIntent.intendedGesture : raw.visibleAction, 180),
    },
    observableAffectiveTexture: observableAffectiveTexture(
      raw.observableAffectiveTexture || raw.speechRealizationPlan?.affectiveTexture || [],
    ),
    actionAttempt: {
      primitive,
      objectId: text(hasActionAttempt ? raw.actionAttempt.objectId : fallbackAttempt.objectId, 200),
      targetCharacterId: text(hasActionAttempt ? raw.actionAttempt.targetCharacterId : fallbackAttempt.targetCharacterId, 160),
      destinationId: text(hasActionAttempt ? raw.actionAttempt.destinationId : fallbackAttempt.destinationId, 80),
      affordanceId: text(hasActionAttempt ? raw.actionAttempt.affordanceId : fallbackAttempt.affordanceId, 200),
    },
    authority: {
      utterance: hasUtterance ? "character-agent" : "legacy-outward-fields-migration-adapter",
      embodiedIntent: hasEmbodiedIntent ? "character-agent" : "legacy-outward-fields-migration-adapter",
      actionAttempt: hasActionAttempt ? "character-agent" : "legacy-outward-fields-migration-adapter",
    },
  };
}

function uniqueTextRows(values = [], max = 220) {
  return [...new Set((values || []).map((value) => text(value, max)).filter(Boolean))];
}

function ownedCognitiveEvidenceIds(input = {}) {
  return new Set([
    ...(input.perceptionFrame?.noticedEvidence || []).flatMap((row) => [
      row.evidenceId,
      ...(row.sourceSignalIds || []),
    ]),
    ...(input.perceivedImpacts || []).flatMap((row) => [row.evidenceId, row.impactId]),
    ...(input.perceptionMemory || []).flatMap((row) => [row.evidenceId, row.impactId]),
    ...(input.agent?.memoryContext?.episodes || []).flatMap((episode) => [
      ...(episode.evidenceIds || []),
      episode.sourceImpactId,
      ...(episode.sourceImpactIds || []),
    ]),
    // A remembered belief is already part of this character's owned
    // cognition. Its provenance may therefore ground a communication tactic
    // or a new appraisal even when the original scene signal is no longer in
    // the current perception window.
    ...(input.agent?.memoryContext?.beliefs || []).flatMap((belief) => [
      ...(belief.supportingEvidenceIds || []),
      ...(belief.provenance?.evidenceIds || []),
    ]),
  ].filter(Boolean));
}

function normalizeCognitiveAppraisal(raw = {}, input = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length === 0) {
    return { value: noOpCognitiveAppraisal(), authority: "legacy-noop-migration-adapter", violations: [] };
  }
  const ownedEvidenceIds = ownedCognitiveEvidenceIds(input);
  const value = {
    noticedEvidenceIds: uniqueTextRows(raw.noticedEvidenceIds || []),
    interpretations: (raw.interpretations || []).map((row) => ({
      evidenceIds: uniqueTextRows(row?.evidenceIds || []),
      meaning: text(row?.meaning, 360),
      confidenceBand: CONFIDENCE_BANDS.includes(row?.confidenceBand) ? row.confidenceBand : "medium",
    })).filter((row) => row.meaning),
    beliefOperations: (raw.beliefOperations || []).map((row) => ({
      proposition: text(row?.proposition, 360),
      operation: COGNITIVE_BELIEF_OPERATIONS.includes(row?.operation) ? row.operation : "suspend",
      confidenceBand: CONFIDENCE_BANDS.includes(row?.confidenceBand) ? row.confidenceBand : "medium",
      sourceEvidenceIds: uniqueTextRows(row?.sourceEvidenceIds || []),
      reasoningMode: COGNITIVE_REASONING_MODES.includes(row?.reasoningMode) ? row.reasoningMode : "inference",
    })).filter((row) => row.proposition),
    entityModelUpdates: (raw.entityModelUpdates || []).map((row) => ({
      perceivedEntityHandle: text(row?.perceivedEntityHandle, 220),
      noticedEvidenceIds: uniqueTextRows(row?.noticedEvidenceIds || []),
      hypotheses: (row?.hypotheses || []).map((hypothesis) => ({
        hypothesisId: text(hypothesis?.hypothesisId, 220),
        proposition: text(hypothesis?.proposition, 360),
        operation: COGNITIVE_BELIEF_OPERATIONS.includes(hypothesis?.operation) ? hypothesis.operation : "suspend",
        confidenceBand: CONFIDENCE_BANDS.includes(hypothesis?.confidenceBand) ? hypothesis.confidenceBand : "medium",
        basisEvidenceIds: uniqueTextRows(hypothesis?.basisEvidenceIds || []),
      })).filter((hypothesis) => hypothesis.hypothesisId && hypothesis.proposition),
      identityCandidates: (row?.identityCandidates || []).map((identity) => ({
        knownEntityHandle: text(identity?.knownEntityHandle, 220),
        operation: COGNITIVE_BELIEF_OPERATIONS.includes(identity?.operation) ? identity.operation : "suspend",
        confidenceBand: CONFIDENCE_BANDS.includes(identity?.confidenceBand) ? identity.confidenceBand : "medium",
        basisEvidenceIds: uniqueTextRows(identity?.basisEvidenceIds || []),
      })).filter((identity) => identity.knownEntityHandle),
      affectiveResponse: {
        label: text(row?.affectiveResponse?.label, 180),
        valence: Math.max(-1, Math.min(1, Number(row?.affectiveResponse?.valence || 0))),
        arousal: perceptionUnit(row?.affectiveResponse?.arousal),
      },
      attentionPriority: perceptionUnit(row?.attentionPriority, 0.4),
    })).filter((row) => row.perceivedEntityHandle),
    locationBeliefUpdates: (raw.locationBeliefUpdates || []).map((row) => ({
      subjectHandle: text(row?.subjectHandle, 220),
      locationHandle: text(row?.locationHandle, 220),
      operation: ["revise", "decrease", "doubt", "reject", "suspend"].includes(row?.operation) ? row.operation : "suspend",
      assertedLikelihood: perceptionUnit(row?.assertedLikelihood, 0.5),
      sourceReliability: perceptionUnit(row?.sourceReliability, 0.5),
      confidenceBand: CONFIDENCE_BANDS.includes(row?.confidenceBand) ? row.confidenceBand : "medium",
      basisEvidenceIds: uniqueTextRows(row?.basisEvidenceIds || []),
      sourceType: text(row?.sourceType, 80) || "inference",
    })).filter((row) => row.subjectHandle && row.locationHandle),
    sourceKnowledgeBeliefUpdates: (raw.sourceKnowledgeBeliefUpdates || []).map((row) => ({
      sourceHandle: text(row?.sourceHandle, 220),
      subjectHandle: text(row?.subjectHandle, 220),
      operation: ["revise", "decrease", "doubt", "reject", "suspend"].includes(row?.operation) ? row.operation : "suspend",
      assertedLikelihood: perceptionUnit(row?.assertedLikelihood, 0.5),
      sourceReliability: perceptionUnit(row?.sourceReliability, 0.5),
      confidenceBand: CONFIDENCE_BANDS.includes(row?.confidenceBand) ? row.confidenceBand : "medium",
      basisEvidenceIds: uniqueTextRows(row?.basisEvidenceIds || []),
    })).filter((row) => row.sourceHandle && row.subjectHandle),
    threadAppraisals: (raw.threadAppraisals || []).map((row) => ({
      threadId: text(row?.threadId, 240),
      sourceTurnId: text(row?.sourceTurnId, 240),
      interpretation: THREAD_INTERPRETATIONS.includes(row?.interpretation) ? row.interpretation : "unclear",
      satisfaction: THREAD_SATISFACTION_STATES.includes(row?.satisfaction) ? row.satisfaction : "uncertain",
      responseNeed: THREAD_RESPONSE_NEEDS.includes(row?.responseNeed) ? row.responseNeed : "none",
      selfClosure: THREAD_SELF_CLOSURES.includes(row?.selfClosure) ? row.selfClosure : "open",
      summary: text(row?.summary, 320),
    })).filter((row) => row.threadId),
  };
  const violations = [];
  const check = (ids, field) => {
    const unknownEvidenceIds = ids.filter((id) => !ownedEvidenceIds.has(id));
    if (!unknownEvidenceIds.length) return;
    violations.push({
      code: "COGNITIVE_EVIDENCE_NOT_OWNED",
      field,
      message: "人物的心理判断引用了没有进入本人感知或记忆的证据；世界不会替人物补造来源。",
      evidence: { unknownEvidenceIds },
    });
  };
  check(value.noticedEvidenceIds, "cognitiveAppraisal.noticedEvidenceIds");
  value.interpretations.forEach((row, index) => check(row.evidenceIds, `cognitiveAppraisal.interpretations[${index}].evidenceIds`));
  value.beliefOperations.forEach((row, index) => {
    if (row.reasoningMode !== "confabulation" || row.sourceEvidenceIds.length) {
      check(row.sourceEvidenceIds, `cognitiveAppraisal.beliefOperations[${index}].sourceEvidenceIds`);
    }
  });
  value.entityModelUpdates.forEach((row, index) => {
    check(row.noticedEvidenceIds, `cognitiveAppraisal.entityModelUpdates[${index}].noticedEvidenceIds`);
    row.hypotheses.forEach((hypothesis, hypothesisIndex) => check(
      hypothesis.basisEvidenceIds,
      `cognitiveAppraisal.entityModelUpdates[${index}].hypotheses[${hypothesisIndex}].basisEvidenceIds`,
    ));
    row.identityCandidates.forEach((identity, identityIndex) => check(
      identity.basisEvidenceIds,
      `cognitiveAppraisal.entityModelUpdates[${index}].identityCandidates[${identityIndex}].basisEvidenceIds`,
    ));
  });
  value.locationBeliefUpdates.forEach((row, index) => check(
    row.basisEvidenceIds,
    `cognitiveAppraisal.locationBeliefUpdates[${index}].basisEvidenceIds`,
  ));
  value.sourceKnowledgeBeliefUpdates.forEach((row, index) => check(
    row.basisEvidenceIds,
    `cognitiveAppraisal.sourceKnowledgeBeliefUpdates[${index}].basisEvidenceIds`,
  ));
  const ownedThreadIds = new Set([
    input.activation?.sourceThreadId,
    ...(input.openConversationThreads || []).map((thread) => thread.id),
  ].filter(Boolean));
  const ownedTurnIds = new Set([
    input.activation?.sourceActionId,
    input.activation?.responseToTurnId,
    ...(input.openConversationThreads || []).flatMap((thread) => (thread.turns || []).map((turn) => turn.id)),
  ].filter(Boolean));
  value.threadAppraisals.forEach((row, index) => {
    if (!ownedThreadIds.has(row.threadId)) violations.push({
      code: "COGNITIVE_THREAD_NOT_OWNED",
      field: `cognitiveAppraisal.threadAppraisals[${index}].threadId`,
      message: "人物只能评价已经进入本人对话经历的线程。",
      evidence: { threadId: row.threadId },
    });
    if (row.sourceTurnId && ownedTurnIds.size && !ownedTurnIds.has(row.sourceTurnId)) violations.push({
      code: "COGNITIVE_THREAD_TURN_NOT_OWNED",
      field: `cognitiveAppraisal.threadAppraisals[${index}].sourceTurnId`,
      message: "人物的线程判断引用了没有进入本人感知的具体话轮。",
      evidence: { sourceTurnId: row.sourceTurnId },
    });
  });
  return { value, authority: "character-agent", violations };
}

function legacyCommunicationPlan(raw = {}) {
  const speechAct = raw.speechAct || "none";
  if (!text(raw.speech)) return noOpCommunicationPlan();
  if (["ask", "offer", "negotiate", "warn"].includes(speechAct)) {
    return { ...noOpCommunicationPlan(), goal: speechAct === "ask" ? "obtain_information" : "inform", tactic: "direct", disclosure: "partial", epistemicRelation: "not_applicable", threadDisposition: "open_new" };
  }
  if (speechAct === "refuse") {
    return { ...noOpCommunicationPlan(), goal: "end_exchange", tactic: "direct", disclosure: "full", epistemicRelation: "believes", threadDisposition: "refuse" };
  }
  if (["answer", "inform"].includes(speechAct)) {
    return { ...noOpCommunicationPlan(), goal: "inform", tactic: "direct", disclosure: "full", epistemicRelation: "believes", threadDisposition: "settle" };
  }
  return { ...noOpCommunicationPlan(), goal: "inform", tactic: "direct", disclosure: "partial", epistemicRelation: "not_applicable" };
}

function normalizeCommunicationPlan(raw = {}, input = {}, fallbackDecision = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length === 0) {
    const value = legacyCommunicationPlan(fallbackDecision);
    value.intendedAudienceCharacterIds = fallbackDecision.targetCharacterId ? [fallbackDecision.targetCharacterId] : [];
    return { value, authority: "legacy-speech-act-migration-adapter", violations: [] };
  }
  const perceivedIds = new Set((input.perceivedCharacters || []).map((row) => row.id).filter(Boolean));
  const value = {
    goal: COMMUNICATION_GOALS.includes(raw.goal) ? raw.goal : "none",
    tactic: COMMUNICATION_TACTICS.includes(raw.tactic) ? raw.tactic : "silence",
    disclosure: COMMUNICATION_DISCLOSURES.includes(raw.disclosure) ? raw.disclosure : "withhold",
    epistemicRelation: COMMUNICATION_EPISTEMIC_RELATIONS.includes(raw.epistemicRelation) ? raw.epistemicRelation : "not_applicable",
    intendedAudienceCharacterIds: uniqueTextRows(raw.intendedAudienceCharacterIds || []),
    desiredEffect: text(raw.desiredEffect, 280),
    threadDisposition: THREAD_DISPOSITIONS.includes(raw.threadDisposition) ? raw.threadDisposition : "none",
    epistemicActionCandidateId: text(raw.epistemicActionCandidateId, 160),
    presuppositionStance: QUESTION_PRESUPPOSITION_STANCES.includes(raw.presuppositionStance)
      ? raw.presuppositionStance
      : "not_applicable",
    epistemicBasisEvidenceIds: uniqueTextRows(raw.epistemicBasisEvidenceIds || []),
  };
  const unknownAudienceCharacterIds = value.intendedAudienceCharacterIds.filter((id) => !perceivedIds.has(id));
  const violations = [];
  if (unknownAudienceCharacterIds.length) violations.push({
    code: "COMMUNICATION_AUDIENCE_NOT_PERCEIVED",
    field: "communicationPlan.intendedAudienceCharacterIds",
    message: "人物的表达计划引用了当前没有感知到的听者。",
    evidence: { unknownAudienceCharacterIds },
  });
  const ownedEvidenceIds = ownedCognitiveEvidenceIds(input);
  const unknownEpistemicBasisEvidenceIds = value.epistemicBasisEvidenceIds.filter((id) => !ownedEvidenceIds.has(id));
  if (unknownEpistemicBasisEvidenceIds.length) violations.push({
    code: "COMMUNICATION_EPISTEMIC_EVIDENCE_NOT_OWNED",
    field: "communicationPlan.epistemicBasisEvidenceIds",
    message: "人物只能用本人确实注意到或记起的证据说明为什么采用这个询问前提。",
    evidence: { unknownEpistemicBasisEvidenceIds },
  });
  return { value, authority: "character-agent", violations };
}

function ownedInformationTargetLabels(input = {}) {
  const unresolvedKnownEntityIds = new Set((input.agent?.psychologyAnchor?.epistemics?.knownEntities || [])
    .filter((entity) => entity?.knowsName === true && entity?.recognizesIdentity !== true)
    .map((entity) => String(entity.entityId || ""))
    .filter(Boolean));
  return [...new Set([
    ...(input.agent?.psychologyAnchor?.desires || []).map((desire) => (
      unresolvedKnownEntityIds.has(String(desire?.target?.id || "")) ? text(desire?.target?.label, 100) : ""
    )),
    ...(input.agent?.privateState?.ecologyProfile?.desires || []).map((desire) => (
      unresolvedKnownEntityIds.has(String(desire?.target?.id || "")) ? text(desire?.target?.label, 100) : ""
    )),
  ].filter(Boolean))];
}

function auditEpistemicQuestionRealization({
  input = {},
  chosenCandidate = {},
  speechAct = "none",
  speechFunctions = [],
  speech = "",
  communicationPlan = {},
} = {}) {
  const evaluations = input.epistemicDecisionSupport?.evaluations || [];
  const explicitEpistemicCandidate = chosenCandidate.candidateClass === "epistemic"
    || String(chosenCandidate.candidateId || "").startsWith("epistemic:");
  const explicitEpistemicQuestion = explicitEpistemicCandidate && String(
    chosenCandidate.realization?.epistemicPrimitive
      || chosenCandidate.semanticFrame?.predicate
      || chosenCandidate.actionKind
      || "",
  ).startsWith("ask_");
  const selectedCandidateId = text(
    communicationPlan.epistemicActionCandidateId
      || (explicitEpistemicQuestion ? chosenCandidate.candidateId : ""),
    160,
  );
  const selectedEvaluation = evaluations.find((row) => row.candidateId === selectedCandidateId) || null;
  const targetLabels = ownedInformationTargetLabels(input);
  const referencesOwnedInformationTarget = targetLabels.some((label) => speech.includes(label));
  const realizesQuestion = speechFunctions.includes("ask") || utteranceHasQuestionForm(speech);
  const requiresAccounting = realizesQuestion && (
    explicitEpistemicQuestion
    || Boolean(selectedCandidateId)
    || referencesOwnedInformationTarget
  );
  const diagnostics = [];
  if (requiresAccounting && !selectedCandidateId) diagnostics.push({
    code: "QUESTION_EPISTEMIC_ACCOUNTING_MISSING",
    field: "communicationPlan.epistemicActionCandidateId",
    message: "这句话在回应中提出了关于本人未决信息目标的新问题，却没有接入同一套信息收益、暴露与前提计算。台词仍会发生，但不能作为干净的心理模型证据。",
    evidence: { targetLabels, speech },
  });
  if (selectedCandidateId && !selectedEvaluation) diagnostics.push({
    code: "QUESTION_EPISTEMIC_CANDIDATE_UNKNOWN",
    field: "communicationPlan.epistemicActionCandidateId",
    message: "人物声称采用的信息行动不在本人本轮数学工具提供的候选中。台词仍会发生，但该心理解释不可验。",
    evidence: {
      selectedCandidateId,
      availableCandidateIds: evaluations.map((row) => row.candidateId),
    },
  });
  if (selectedEvaluation?.targetHandle) {
    const audienceIds = communicationPlan.intendedAudienceCharacterIds || [];
    if (audienceIds.length && !audienceIds.includes(selectedEvaluation.targetHandle)) diagnostics.push({
      code: "QUESTION_EPISTEMIC_TARGET_MISMATCH",
      field: "communicationPlan.intendedAudienceCharacterIds",
      message: "人物采用的信息行动与实际询问对象不是同一个本人感知到的信息源。",
      evidence: { expectedTargetHandle: selectedEvaluation.targetHandle, audienceIds },
    });
  }
  const mismatch = Number(selectedEvaluation?.presupposition?.mismatch || 0);
  if (mismatch >= 0.25 && ["not_applicable", "accept"].includes(communicationPlan.presuppositionStance)) {
    diagnostics.push({
      code: "QUESTION_PRESUPPOSITION_MISMATCH_UNACCOUNTED",
      field: "communicationPlan.presuppositionStance",
      message: "本人拥有的地点或信息源认识不足以支撑这句问法，但人物没有把它标成不确定、故意试探、欺骗或误记。台词不会被审查删除，心理归因仍不完整。",
      evidence: {
        selectedCandidateId,
        mismatch,
        presupposition: deepClone(selectedEvaluation?.presupposition || null),
      },
    });
  }
  if (selectedCandidateId && !realizesQuestion) diagnostics.push({
    code: "EPISTEMIC_QUESTION_PLAN_WITHOUT_QUESTION",
    field: "utterance",
    message: "人物填写了询问信息行动，但实际没有发出问题；数学工具不会替这句话制造询问效果。",
    evidence: { selectedCandidateId, speechAct, speechFunctions, speech },
  });
  return {
    authority: "character-private-epistemic-tool-and-agent-accounting",
    status: diagnostics.length ? "diagnostic" : requiresAccounting || selectedCandidateId ? "accounted" : "not_applicable",
    requiresAccounting,
    referencesOwnedInformationTarget,
    targetLabels,
    selectedCandidateId,
    selectedPrimitive: selectedEvaluation?.primitive || "",
    score: selectedEvaluation ? Number(selectedEvaluation.score || 0) : null,
    presupposition: deepClone(selectedEvaluation?.presupposition || null),
    presuppositionStance: communicationPlan.presuppositionStance || "not_applicable",
    basisEvidenceIds: [...(communicationPlan.epistemicBasisEvidenceIds || [])],
    diagnostics,
  };
}

function rejectedCandidateDecision(raw = {}, violation = {}) {
  const expression = normalizeCharacterExpressionLayers(raw);
  return {
    candidateId: "",
    choiceAuthority: "character-agent:rejected",
    actionType: "pass",
    speechAct: "none",
    speechFunctions: [],
    targetCharacterId: "",
    speech: "",
    visibleAction: "",
    moveToZoneId: "",
    vocalMode: "conversational",
    affordanceId: "",
    informationSourceImpactId: "",
    commitmentAction: "none",
    commitmentTopic: "",
    decisionValue: "none",
    cognitiveAppraisal: noOpCognitiveAppraisal(),
    cognitiveAppraisalAuthority: "character-agent:rejected",
    communicationPlan: noOpCommunicationPlan(),
    communicationPlanAuthority: "character-agent:rejected",
    speechRealizationPlan: noOpSpeechRealizationPlan({}, { hasSpeech: false }),
    speechRealizationPlanAuthority: "character-agent:rejected",
    utterance: expression.utterance,
    utteranceAuthority: expression.authority.utterance,
    embodiedIntent: expression.embodiedIntent,
    embodiedIntentAuthority: expression.authority.embodiedIntent,
    actionAttempt: expression.actionAttempt,
    actionAttemptAuthority: expression.authority.actionAttempt,
    privateReason: text(raw.privateReason, 220),
    relationshipAppraisal: noOpTavernCharacterRelationshipAppraisal(),
    epistemicQuestionAudit: {
      authority: "character-private-epistemic-tool-and-agent-accounting",
      status: "not_applicable",
      diagnostics: [],
    },
    epistemicDiagnostics: [],
    privateProposalDiagnostics: [],
    semanticViolations: [violation],
  };
}

function collectContinuityIds(value, target = new Set(), depth = 0) {
  if (depth > 10 || value == null) return target;
  if (Array.isArray(value)) {
    for (const item of value) collectContinuityIds(item, target, depth + 1);
    return target;
  }
  if (typeof value !== "object") return target;
  for (const [key, child] of Object.entries(value)) {
    if ((key === "id" || /Id$/u.test(key)) && typeof child === "string" && child.trim()) target.add(child.trim());
    collectContinuityIds(child, target, depth + 1);
  }
  return target;
}

function continuityValidationContextForInput(input = {}, chosenCandidate = {}) {
  const ecologyState = input.agent?.privateState?.ecologyState || {};
  const desireIds = Object.keys(ecologyState.desires || {});
  const dynamicStateIds = Object.keys(ecologyState.dynamicPsychology || {});
  const knownBasisIds = new Set([
    chosenCandidate.candidateId,
    chosenCandidate.driveId,
    ...desireIds,
    ...dynamicStateIds,
  ].filter(Boolean));
  for (const candidate of input.privateActionCandidates || []) {
    for (const id of [candidate.candidateId, candidate.driveId, candidate.sourceImpactId]) if (id) knownBasisIds.add(id);
  }
  collectContinuityIds(input.agent?.psychologyAnchor, knownBasisIds);
  collectContinuityIds(input.agent?.memoryContext, knownBasisIds);
  collectContinuityIds(input.agent?.relationshipContext, knownBasisIds);
  collectContinuityIds(input.perceptionFrame, knownBasisIds);
  collectContinuityIds(input.perceivedImpacts, knownBasisIds);
  collectContinuityIds(input.perceptionMemory, knownBasisIds);
  // Concrete affordances and material facts are legitimate reasons for an
  // action memory (paying, ordering, consuming, moving, using an object). The
  // candidate id and the executable affordance id are intentionally distinct,
  // so both must be accepted as character-owned continuity evidence.
  collectContinuityIds(input.availableAffordances, knownBasisIds);
  collectContinuityIds(input.materialFacts, knownBasisIds);
  collectContinuityIds(input.agent?.privateState?.ownedResources, knownBasisIds);
  return {
    chosenCandidateId: chosenCandidate.candidateId || "",
    knownBasisIds: [...knownBasisIds],
    desireIds,
    dynamicStateIds,
    ownedSelfClaimIds: (input.agent?.memoryContext?.selfNarrative?.currentClaims || [])
      .map((row) => row?.id)
      .filter(Boolean),
    requiredDesireIds: desireIds.includes(chosenCandidate.driveId) ? [chosenCandidate.driveId] : [],
  };
}

function noOpContinuityProposal(context = {}, chosenCandidateId = "") {
  return {
    phase: "pending_world_resolution",
    choiceSignificance: "ordinary",
    actionMemory: { mode: "none", content: "", basisIds: [] },
    desireContinuity: (context.desireIds || []).map((desireId) => ({
      desireId,
      status: "unaffected",
      pressureDirection: "stable",
      strengthBand: "low",
      settlementCondition: "action_committed",
      reason: "兼容调用没有提交主观连续性变化。",
      basisIds: [desireId, chosenCandidateId].filter(Boolean),
    })),
    dynamicStateContinuity: [],
    selfNarrative: {
      mode: "none",
      proposedClaim: "",
      replacesClaimIds: [],
      significanceBand: "low",
      permanenceBand: "low",
      basisIds: [],
      consolidationStatus: "not_applicable",
    },
  };
}

function realizedActionSemanticFrame({
  sourceFrame = null,
  candidateId = "",
  actorCharacterId = "",
  targetCharacterId = "",
  actionType = "act",
  speechAct = "none",
  speech = "",
  visibleAction = "",
  commitmentTopic = "",
  decisionValue = "none",
} = {}) {
  const hasSpeech = Boolean(text(speech));
  if (!hasSpeech) {
    if (!text(visibleAction) || actionType === "pass") return null;
    const predicate = actionType === "move" ? "move" : actionType === "leave" ? "leave" : "act";
    const topicId = text(sourceFrame?.topicId || commitmentTopic || sourceFrame?.object?.label || "眼前行动", 120);
    const safeCandidateId = text(candidateId || sourceFrame?.id || topicId, 160);
    return normalizeSemanticFrame({
      id: `frame:action:${predicate}:${safeCandidateId}:actor_${actorCharacterId}:target_${targetCharacterId}`,
      kind: "action",
      predicate,
      topicId,
      roles: {
        actor: actorCharacterId,
        ...(targetCharacterId ? { target: targetCharacterId } : {}),
      },
      object: sourceFrame?.object || {
        id: safeCandidateId,
        label: topicId,
      },
      requestedAct: "",
      decisionValue: "",
      truthValue: "",
      polarity: 1,
      lexicalAnchors: sourceFrame?.lexicalAnchors || [topicId],
      importance: sourceFrame?.importance ?? 0.4,
      parentFrameId: sourceFrame?.id || "",
    });
  }
  if (sourceFrame?.kind && ["social_request", "social_decision"].includes(sourceFrame.kind)) {
    return normalizeSemanticFrame({
      ...sourceFrame,
      kind: decisionValue !== "none" && sourceFrame.kind === "social_request"
        ? "social_decision"
        : sourceFrame.kind,
      decisionValue: decisionValue !== "none" ? decisionValue : sourceFrame.decisionValue,
      parentFrameId: sourceFrame.parentFrameId || sourceFrame.id,
    });
  }
  const predicate = speechAct && speechAct !== "none" ? speechAct : "speak";
  const topicId = text(sourceFrame?.topicId || commitmentTopic || sourceFrame?.object?.label || "当面交谈", 120);
  const safeCandidateId = text(candidateId || sourceFrame?.id || topicId, 160);
  return normalizeSemanticFrame({
    id: `frame:utterance:${predicate}:${safeCandidateId}:actor_${actorCharacterId}:addressee_${targetCharacterId}`,
    kind: "communication",
    predicate,
    topicId,
    roles: {
      actor: actorCharacterId,
      addressee: targetCharacterId,
    },
    object: sourceFrame?.object || {
      id: safeCandidateId,
      label: topicId,
    },
    requestedAct: predicate === "ask" ? topicId : "",
    decisionValue: decisionValue !== "none" ? decisionValue : "",
    truthValue: "",
    polarity: 1,
    lexicalAnchors: sourceFrame?.lexicalAnchors || [topicId],
    importance: sourceFrame?.importance ?? 0.4,
    parentFrameId: sourceFrame?.id || "",
  });
}

function publicActionSurface(action = {}, surface = "primary") {
  if (surface === "speech") return text(action.speech, 180);
  if (surface === "visual") return text([
    action.visibleAction,
    ...observableAffectiveTexture(action.observableAffectiveTexture)
      .filter((row) => row.modality === "visual")
      .map((row) => row.feature),
  ].filter(Boolean).join("；"), 260);
  if (surface === "movement") {
    return text(action.visibleAction || (action.moveToZoneId ? `${action.actorName || "人物"}发生了位置移动` : ""), 180);
  }
  return text(action.speech || action.visibleAction, 180);
}

function observableTextureForModality(action = {}, modality = "visual") {
  return observableAffectiveTexture(action.observableAffectiveTexture)
    .filter((row) => row.modality === modality);
}

function observableTextureSurface(rows = []) {
  return observableAffectiveTexture(rows).map((row) => row.feature).join("；");
}

function publicTopicGroundedInSpeech(topic = "", speech = "") {
  const ignored = new Set(["的", "了", "是", "否", "这", "那", "我", "你", "他", "她", "它", "人", "事", "本", "自"]);
  const topicCharacters = [...new Set([...text(topic, 160)].filter((character) => (
    /[\p{L}\p{N}]/u.test(character) && !ignored.has(character)
  )))];
  if (topicCharacters.length < 2) return false;
  const speechCharacters = new Set([...text(speech, 220)]);
  const overlap = topicCharacters.filter((character) => speechCharacters.has(character)).length;
  return overlap >= 2 && overlap / topicCharacters.length >= 0.2;
}

function publicSemanticFrameForAction(action = {}, surface = "primary") {
  if ((surface === "speech" || surface === "primary")
    && action.speech
    && action.publicSemanticFrame?.kind
    && ["social_request", "social_decision"].includes(action.publicSemanticFrame.kind)) {
    return deepClone(action.publicSemanticFrame);
  }
  const publicSurface = publicActionSurface(action, surface);
  if (!publicSurface) return null;
  const communication = surface === "speech" || (surface === "primary" && Boolean(action.speech));
  const speechFunctions = communication ? actionSpeechFunctions(action) : [];
  const predicate = communication
    ? (action.speechAct && action.speechAct !== "none" ? action.speechAct : "speak")
    : surface === "movement" || action.actionType === "move" ? "move" : action.actionType === "leave" ? "leave" : "act";
  const actionId = text(action.id, 160) || "pending-action";
  return normalizeSemanticFrame({
    id: `frame:public:${communication ? "utterance" : "action"}:${actionId}:${predicate}`,
    kind: communication ? "communication" : "event",
    predicate,
    topicId: publicSurface,
    roles: communication ? {
      actor: action.actorId || "",
      ...(action.targetCharacterId ? { addressee: action.targetCharacterId } : {}),
    } : {
      actor: action.actorId || "",
      ...(action.actionAttempt?.targetCharacterId || (!action.speech ? action.targetCharacterId : "")
        ? { target: action.actionAttempt?.targetCharacterId || action.targetCharacterId }
        : {}),
    },
    object: {
      id: `public-surface:${actionId}:${surface}`,
      label: publicSurface,
    },
    requestedAct: communication && speechFunctions.includes("ask") ? publicSurface : "",
    decisionValue: communication && action.decisionValue !== "none" ? action.decisionValue : "",
    truthValue: "",
    polarity: 1,
    lexicalAnchors: [publicSurface],
    importance: 0.4,
    parentFrameId: "",
  });
}

function refreshPublicActionSemantics(action = {}) {
  const structuredPublicSocialFrame = action.speech
    && action.semanticFrame?.kind
    && ["social_request", "social_decision"].includes(action.semanticFrame.kind);
  if (structuredPublicSocialFrame) {
    action.publicTopic = text(
      action.commitmentTopic || action.semanticFrame?.topicId || action.speech,
      180,
    );
    action.publicSemanticFrame = deepClone(action.semanticFrame);
    return action;
  }
  const groundedCommitmentTopic = action.speech
    && action.commitmentTopic
    && publicTopicGroundedInSpeech(action.commitmentTopic, action.speech);
  if (groundedCommitmentTopic) {
    action.publicTopic = text(action.commitmentTopic, 180);
    const baseFrame = publicSemanticFrameForAction({ ...action, publicSemanticFrame: null }, "speech");
    action.publicSemanticFrame = normalizeSemanticFrame({
      ...baseFrame,
      topicId: action.publicTopic,
      object: {
        id: `public-topic:${text(action.id, 160) || "pending-action"}`,
        label: action.publicTopic,
      },
      requestedAct: baseFrame?.predicate === "ask" ? action.publicTopic : "",
      lexicalAnchors: [action.publicTopic],
      parentFrameId: "",
    });
    return action;
  }
  action.publicTopic = publicActionSurface(action, "primary");
  action.publicSemanticFrame = publicSemanticFrameForAction(action, "primary");
  return action;
}

export function normalizeTavernCharacterDecision(raw = {}, input = {}, state = {}, runtime = {}) {
  // Some providers drift around the declared schema and wrap the decision in
  // the schema name. Unwrap the known wrapper before normalizing so a
  // recoverable response is not silently converted into silence.
  if (raw?.character_town_tavern_agent_decision && typeof raw.character_town_tavern_agent_decision === "object") {
    raw = raw.character_town_tavern_agent_decision;
  }
  raw = raw?.decision && typeof raw.decision === "object" ? raw.decision : raw;
  const projectedInput = input;
  const projectedRaw = deepClone(raw);
  raw = canonicalizeAgentOutput(raw, projectedInput, state, runtime);
  input = canonicalAgentInput(projectedInput, state, runtime);
  const expression = normalizeCharacterExpressionLayers(raw);
  const requestedCandidateId = text(raw.candidateId, 120);
  const chosenCandidate = (input.privateActionCandidates || []).find((candidate) => candidate.candidateId === requestedCandidateId) || null;
  if (!chosenCandidate) {
    return rejectedCandidateDecision(raw, {
      code: "AGENT_CANDIDATE_NOT_AVAILABLE",
      field: "candidateId",
      message: "人物必须亲自从本次收到的行动候选中选择；世界不会根据输出猜测或补选意图。",
      evidence: {
        requestedCandidateId,
        availableCandidateIds: (input.privateActionCandidates || []).map((candidate) => candidate.candidateId),
      },
    });
  }
  if (!chosenCandidate.feasible) {
    return rejectedCandidateDecision(raw, {
      code: "AGENT_CANDIDATE_BLOCKED",
      field: "candidateId",
      message: "人物选择的行动存在未通过的物理或事实硬闸，世界拒绝执行但不会替换成别的意图。",
      evidence: {
        requestedCandidateId,
        blockedBy: [...(chosenCandidate.blockedBy || [])],
      },
    });
  }
  const privateProposalDiagnostics = [];
  const speechRealizationPlan = normalizeSpeechRealizationPlan(
    raw.speechRealizationPlan,
    chosenCandidate.speechRealization?.voicePsychologyTool || {},
    { hasSpeech: Boolean(expression.utterance.literalSpeech) },
  );
  privateProposalDiagnostics.push(...speechRealizationPlan.diagnostics);
  const continuityContext = continuityValidationContextForInput(input, chosenCandidate);
  const continuityFromAgent = Boolean(raw.postChoiceContinuity && typeof raw.postChoiceContinuity === "object");
  let postChoiceContinuity = continuityFromAgent
    ? deepClone(raw.postChoiceContinuity)
    : noOpContinuityProposal(continuityContext, chosenCandidate.candidateId);
  let postChoiceContinuityAuthority = continuityFromAgent
    ? "character-agent"
    : "legacy-noop-migration-adapter";
  const continuityValidation = validateCharacterPostChoiceContinuityProposal(
    postChoiceContinuity,
    continuityContext,
  );
  if (!continuityValidation.valid) {
    privateProposalDiagnostics.push({
      code: "CHARACTER_CONTINUITY_PROPOSAL_INVALID",
      layer: "postChoiceContinuity",
      field: "postChoiceContinuity",
      message: "人物的行动后心理提案引用了不存在的欲望、状态或依据；只拒绝该私有更新，保留独立合法的现实行动。",
      evidence: { errors: continuityValidation.errors },
    });
    postChoiceContinuity = noOpContinuityProposal(continuityContext, chosenCandidate.candidateId);
    postChoiceContinuityAuthority = "character-agent:rejected";
  }
  const relationshipAppraisalFromAgent = Boolean(raw.relationshipAppraisal && typeof raw.relationshipAppraisal === "object");
  let relationshipAppraisal = relationshipAppraisalFromAgent
    ? deepClone(raw.relationshipAppraisal)
    : noOpTavernCharacterRelationshipAppraisal();
  let relationshipAppraisalAuthority = relationshipAppraisalFromAgent
    ? "character-agent"
    : "legacy-noop-migration-adapter";
  const relationshipPerceivedImpacts = [
    ...(input.perceivedImpacts || []),
    ...(input.perceptionMemory || []),
  ];
  const rememberedRelationshipImpactIds = (input.agent?.memoryContext?.episodes || []).flatMap((episode) => (
    [episode.sourceImpactId, ...(episode.sourceImpactIds || [])]
  )).filter(Boolean);
  const relationshipAppraisalValidation = validateTavernCharacterRelationshipAppraisal(
    relationshipAppraisal,
    {
      perceivedCharacterIds: (input.perceivedCharacters || []).map((character) => character.id),
      perceivedImpactIds: [
        ...relationshipPerceivedImpacts.map((impact) => impact.impactId).filter(Boolean),
        ...rememberedRelationshipImpactIds,
      ],
      perceivedImpacts: relationshipPerceivedImpacts,
    },
  );
  if (!relationshipAppraisalValidation.valid) {
    privateProposalDiagnostics.push({
      code: "CHARACTER_RELATIONSHIP_APPRAISAL_INVALID",
      layer: "relationshipAppraisal",
      field: "relationshipAppraisal",
      message: "人物的关系评价引用了未感知的人或事件；只拒绝该关系更新，保留独立合法的现实行动。",
      evidence: { errors: relationshipAppraisalValidation.errors },
    });
    relationshipAppraisal = noOpTavernCharacterRelationshipAppraisal();
    relationshipAppraisalAuthority = "character-agent:rejected";
  }
  let cognitive = normalizeCognitiveAppraisal(projectedRaw.cognitiveAppraisal, projectedInput);
  if (cognitive.violations.length) {
    privateProposalDiagnostics.push(...cognitive.violations.map((violation) => ({
      ...deepClone(violation),
      layer: "cognitiveAppraisal",
      message: `${text(violation.message, 260)}；只拒绝该认知更新，保留独立合法的现实行动。`,
    })));
    cognitive = {
      value: noOpCognitiveAppraisal(),
      authority: "character-agent:rejected",
      violations: [],
    };
  }
  let communication = normalizeCommunicationPlan(raw.communicationPlan, input, raw);
  const hardCommunicationViolations = communication.violations.filter((violation) => (
    violation.code === "COMMUNICATION_AUDIENCE_NOT_PERCEIVED"
  ));
  if (hardCommunicationViolations.length) {
    return rejectedCandidateDecision(raw, hardCommunicationViolations[0]);
  }
  const privateCommunicationViolations = communication.violations.filter((violation) => (
    violation.code !== "COMMUNICATION_AUDIENCE_NOT_PERCEIVED"
  ));
  if (privateCommunicationViolations.length) {
    privateProposalDiagnostics.push(...privateCommunicationViolations.map((violation) => ({
      ...deepClone(violation),
      layer: "communicationPlan",
      message: `${text(violation.message, 260)}；只拒绝该私有表达归因，人物实际说出的内容仍由现实层单独校验。`,
    })));
    communication = {
      value: noOpCommunicationPlan(),
      authority: "character-agent:rejected",
      violations: [],
    };
  }
  const chosenSemanticFrame = chosenCandidate.semanticFrame?.id || chosenCandidate.semanticFrame?.predicate
    ? normalizeSemanticFrame(chosenCandidate.semanticFrame)
    : null;
  const perceivedIds = new Set((input.perceivedCharacters || []).map((character) => character.id));
  const reachableIds = new Set((input.reachableZones || []).map((zone) => zone.id));
  const rememberedImpactIds = new Set([
    ...(input.perceivedImpacts || []).map((impact) => impact.impactId),
    ...(input.perceptionMemory || []).map((impact) => impact.impactId),
    ...(input.agent?.memoryContext?.episodes || []).flatMap((episode) => [episode.sourceImpactId, ...(episode.sourceImpactIds || [])]),
  ]);
  let actionType = ACTION_TYPES.has(raw.actionType) ? raw.actionType : "pass";
  let speechAct = SPEECH_ACTS.has(raw.speechAct)
    ? raw.speechAct
    : (LEGACY_SPEECH_ACT_MAP.get(raw.speechAct) && SPEECH_ACTS.has(LEGACY_SPEECH_ACT_MAP.get(raw.speechAct))
      ? LEGACY_SPEECH_ACT_MAP.get(raw.speechAct)
      : "none");
  if (expression.authority.actionAttempt === "character-agent") {
    if (expression.actionAttempt.primitive === "speak") actionType = expression.utterance.literalSpeech ? "speak" : "pass";
    else if (expression.actionAttempt.primitive === "move") actionType = "move";
    else if (expression.actionAttempt.primitive === "leave") actionType = "leave";
    else if (expression.actionAttempt.primitive === "interact" || expression.actionAttempt.primitive === "use_affordance") actionType = "interact";
    else if (expression.actionAttempt.primitive !== "none") actionType = "act";
    else actionType = expression.utterance.literalSpeech ? "speak" : "pass";
  }
  const chosenTargetCharacterId = chosenCandidate.targetCharacterId || "";
  // Some candidates are intrinsically about one person (a reply, a promise,
  // a relationship desire); those keep their bound target.  Environmental and
  // bodily candidates deliberately leave the target open so the Character
  // Agent can decide whether to handle them alone or address somebody who is
  // actually perceived.  The mathematical tool must not make that social
  // choice on the person's behalf.
  // The candidate records what initially activated the person; it is not a
  // muzzle. For non-material communication the Character Agent may address a
  // different perceived person (redirect, teasing, mistaken identity, etc.).
  // A selected physical affordance rebinds its actual recipient below.
  const intendedSpeechTargetId = (communication.value.intendedAudienceCharacterIds || []).find((characterId) => perceivedIds.has(characterId)) || "";
  const attemptedTargetCharacterId = perceivedIds.has(expression.actionAttempt.targetCharacterId)
    ? expression.actionAttempt.targetCharacterId
    : "";
  let targetCharacterId = expression.utterance.literalSpeech && intendedSpeechTargetId
    ? intendedSpeechTargetId
    : perceivedIds.has(raw.targetCharacterId)
    ? raw.targetCharacterId
    : attemptedTargetCharacterId
      ? attemptedTargetCharacterId
    : (perceivedIds.has(chosenTargetCharacterId) ? chosenTargetCharacterId : "");
  let speech = expression.utterance.literalSpeech;
  let visibleAction = expression.embodiedIntent.intendedGesture;
  const proposedSpeech = speech;
  const proposedVisibleAction = visibleAction;
  const proposedMoveToZoneId = expression.actionAttempt.destinationId;
  let moveToZoneId = reachableIds.has(proposedMoveToZoneId) && proposedMoveToZoneId !== input.scene.zoneId ? proposedMoveToZoneId : "";
  const vocalMode = expression.utterance.vocalMode;
  const realization = chosenCandidate.realization || {};
  const mandatedAffordanceId = realization.affordanceId || "";
  let selectedAffordance = (input.availableAffordances || []).find((item) => item.id === (mandatedAffordanceId || expression.actionAttempt.affordanceId)) || null;
  let affordanceId = selectedAffordance?.id || "";
  if (selectedAffordance?.targetCharacterId) targetCharacterId = selectedAffordance.targetCharacterId;
  let informationSourceImpactId = rememberedImpactIds.has(raw.informationSourceImpactId) ? raw.informationSourceImpactId : "";
  let commitmentAction = COMMITMENT_ACTIONS.has(raw.commitmentAction) ? raw.commitmentAction : "none";
  let commitmentTopic = text(raw.commitmentTopic, 120);
  let decisionValue = DECISION_VALUES.has(raw.decisionValue) ? raw.decisionValue : "none";
  const materialViolations = [];
  const dialogueViolations = [];
  const objectAttemptPrimitives = new Set(["pickup", "take_out", "show", "hide", "store", "draw", "sheathe", "transfer", "place", "consume"]);
  if (expression.authority.actionAttempt === "character-agent" && selectedAffordance && expression.actionAttempt.primitive !== "use_affordance") {
    materialViolations.push({
      code: "ACTION_ATTEMPT_AFFORDANCE_PRIMITIVE_MISMATCH",
      field: "actionAttempt",
      message: "人物选择了包含世界经营动作的候选，却没有实际尝试该 affordance；台词仍可发生，但经营状态不会改变。",
      evidence: { primitive: expression.actionAttempt.primitive, affordanceId: selectedAffordance.id },
    });
    selectedAffordance = null;
    affordanceId = "";
  }
  if (expression.actionAttempt.primitive === "use_affordance" && !selectedAffordance) {
    materialViolations.push({
      code: "ACTION_ATTEMPT_AFFORDANCE_UNAVAILABLE",
      field: "actionAttempt",
      message: "人物尝试的世界 affordance 当前不可用；世界记录失败，不替本人选择别的经营动作。",
      evidence: { affordanceId: expression.actionAttempt.affordanceId },
    });
  }
  if (expression.actionAttempt.primitive === "none" && expression.authority.actionAttempt === "character-agent") {
    visibleAction = "";
    moveToZoneId = "";
  }
  if (expression.actionAttempt.primitive === "move" && !expression.actionAttempt.destinationId) {
    materialViolations.push({
      code: "ACTION_ATTEMPT_DESTINATION_MISSING",
      field: "actionAttempt",
      message: "人物尝试移动却没有指定要去的相邻位置；世界只能记录失败尝试，不能替本人选择目的地。",
      evidence: { actionAttempt: deepClone(expression.actionAttempt) },
    });
  }
  if (expression.actionAttempt.destinationId && expression.actionAttempt.primitive !== "move" && expression.actionAttempt.primitive !== "use_affordance") {
    materialViolations.push({
      code: "ACTION_ATTEMPT_PRIMITIVE_DESTINATION_MISMATCH",
      field: "actionAttempt",
      message: "人物给出了移动目的地，却没有尝试移动；世界不会把两种动作自动拼在一起。",
      evidence: { actionAttempt: deepClone(expression.actionAttempt) },
    });
  }
  if (objectAttemptPrimitives.has(expression.actionAttempt.primitive) && !expression.actionAttempt.objectId) {
    materialViolations.push({
      code: "ACTION_ATTEMPT_OBJECT_MISSING",
      field: "actionAttempt",
      message: "物件动作没有指出具体物件；世界不会根据动作描写猜测是哪一件。",
      evidence: { actionAttempt: deepClone(expression.actionAttempt) },
    });
  }
  if (expression.actionAttempt.objectId && !normalizeObjectLedger(state.tavernState?.objectLedger || {}).objects?.[expression.actionAttempt.objectId]) {
    materialViolations.push({
      code: "ACTION_ATTEMPT_OBJECT_UNKNOWN",
      field: "actionAttempt",
      message: "人物尝试操作的物件不在自己的已知现场物件中；世界不会凭空生成它。",
      evidence: { objectId: expression.actionAttempt.objectId },
    });
  }
  if (expression.actionAttempt.targetCharacterId && !perceivedIds.has(expression.actionAttempt.targetCharacterId)) {
    materialViolations.push({
      code: "ACTION_ATTEMPT_TARGET_UNAVAILABLE",
      field: "actionAttempt",
      message: "人物尝试作用的对象当前不在本人可定位的现场人物中。",
      evidence: { targetCharacterId: expression.actionAttempt.targetCharacterId },
    });
  }
  if (chosenSemanticFrame && raw.semanticFrameId && raw.semanticFrameId !== chosenSemanticFrame.id) {
    dialogueViolations.push({
      code: "SEMANTIC_FRAME_ID_MISMATCH",
      field: "semanticFrameId",
      message: "人物可以决定如何回应，但不能把候选所处理的那件事换成另一个社会事件。",
      evidence: { expectedFrameId: chosenSemanticFrame.id, proposedFrameId: raw.semanticFrameId },
    });
  }
  if (chosenSemanticFrame && raw.semanticRoleBindings && Object.keys(raw.semanticRoleBindings).length) {
    const binding = validateSemanticRoleBinding({ ...chosenSemanticFrame, roles: raw.semanticRoleBindings }, chosenSemanticFrame);
    dialogueViolations.push(...binding.violations);
  }
  if (chosenTargetCharacterId && targetCharacterId && targetCharacterId !== chosenTargetCharacterId) {
    dialogueViolations.push({
      code: "AGENT_CANDIDATE_TARGET_MISMATCH",
      field: "targetCharacterId",
      message: "人物实际说话的对象与最初激活这一意图的人不同；可能是转向、回避、误认或故意顾左右而言他，原线程不会因此自动结清。",
      evidence: { candidateId: chosenCandidate.candidateId, candidateTargetCharacterId: chosenTargetCharacterId, proposedTargetCharacterId: targetCharacterId },
    });
  }
  if (expression.actionAttempt.affordanceId && expression.actionAttempt.affordanceId !== mandatedAffordanceId) {
    materialViolations.push({
      code: "AGENT_CANDIDATE_AFFORDANCE_MISMATCH",
      field: "actionAttempt",
      message: "人物不能选择一个心理候选，却借另一个经营动作改变世界。",
      evidence: { candidateId: chosenCandidate.candidateId, candidateAffordanceId: mandatedAffordanceId, proposedAffordanceId: expression.actionAttempt.affordanceId },
    });
    selectedAffordance = null;
    affordanceId = "";
  }
  // A psychological candidate selects what the person is trying to do; it is
  // not a gag order. Speech is an independent emitted channel and may coexist
  // with observing, resting, practising, moving, or a failed physical attempt.
  if (proposedMoveToZoneId && proposedMoveToZoneId !== input.scene.zoneId && !reachableIds.has(proposedMoveToZoneId)) {
    materialViolations.push({
      code: "ACTION_ATTEMPT_DESTINATION_UNREACHABLE",
      field: "moveToZoneId",
      message: "人物尝试前往的位置当前不是相邻的物理移动目标；世界保留这次失败尝试。社会许可不会删除物理上可尝试的位置。",
      evidence: { proposedMoveToZoneId, reachableZoneIds: [...reachableIds] },
    });
  }
  if (speechAct === "gossip" && !informationSourceImpactId) {
    dialogueViolations.push({
      code: "GOSSIP_SOURCE_NOT_CITED",
      field: "utterance",
      message: "人物没有给这句转述绑定可追溯来源；这会降低可信度，但不会阻止人物把话说出口。",
      evidence: { proposedInformationSourceImpactId: raw.informationSourceImpactId || "" },
    });
  }
  if (!speech) speechAct = "none";
  const unknownIdentityUse = (input.perceivedCharacters || [])
    .filter((character) => !character.identityKnown)
    .map((character) => ({
      characterId: character.id,
      name: runtime.agents?.[character.id]?.characterName || "",
    }))
    .filter((character) => character.name)
    .find((character) => {
      const escapedName = character.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const directAddress = new RegExp(`^${escapedName}(?:[，,：:\\s]|$)`, "u").test(speech);
      const assertedIdentity = new RegExp(`(?:你|他|她|此人|这人|那人).{0,4}(?:就是|正是|是)${escapedName}`, "u").test(speech);
      return directAddress || assertedIdentity;
    });
  if (speech && unknownIdentityUse) {
    dialogueViolations.push({
      code: "UNKNOWN_IDENTITY_USED_AS_CONFIRMED_ADDRESS",
      field: "utterance",
      message: "人物把尚未确认身份的在场者当成了某个姓名；这可能是试探、误认或故意称呼，只记录为主张。",
      evidence: {
        targetCharacterId: unknownIdentityUse.characterId,
        unconfirmedName: unknownIdentityUse.name,
      },
    });
  }
  const resolvedMaterialQuestion = (input.materialFacts || []).some((fact) => (
    (fact.serviceStatus === "served" && /(饭|茶).*(吃|喝|端|送).*(了|过|没|吗|还是)|吃过|喝过|端过/.test(speech))
    || (fact.deliveryStatus === "accepted" && /(药包|货|清单).*(交|收|验).*(了|没|吗|还是)|交接过/.test(speech))
    || (["paid", "credit", "work_settled"].includes(fact.paymentStatus) && /(钱|账).*(付|收|结).*(了|没|吗|还是)|结清.*[吗？?]/.test(speech))
    || (fact.lodgingStatus === "assigned" && /(钥匙|客房|房间).*(给|交|安排|在哪|哪里).*(了|没|吗|还是|？|\?)/.test(speech))
  ));
  if (resolvedMaterialQuestion) {
    dialogueViolations.push({
      code: "RESOLVED_MATERIAL_FACT_QUESTIONED_AGAIN",
      field: "utterance",
      message: "人物再次询问了客观上已经完成的事务；这可能来自遗忘、怀疑、确认或故意找话。",
      evidence: {},
    });
  }
  const repeatedOwnSpeech = speech
    ? (input.recentOwnActions || []).find((action) => action.speech && speechSimilarity(speech, action.speech) >= 0.82)
    : null;
  if (repeatedOwnSpeech) {
    dialogueViolations.push({
      code: "SAME_SCENE_NEAR_DUPLICATE_SPEECH",
      field: "utterance",
      message: "人物不能在同一场景用近似原句重复已经表达过的立场。",
      evidence: { previousSpeech: text(repeatedOwnSpeech.speech, 180) },
    });
  }
  if (selectedAffordance) {
    actionType = ACTION_TYPES.has(selectedAffordance.actionType) ? selectedAffordance.actionType : "interact";
    if (selectedAffordance.targetCharacterId && perceivedIds.has(selectedAffordance.targetCharacterId)) {
      targetCharacterId = selectedAffordance.targetCharacterId;
    }
    visibleAction = visibleAction || text(selectedAffordance.canonicalVisibleAction, 180);
    if (selectedAffordance.moveToZoneId && reachableIds.has(selectedAffordance.moveToZoneId)) {
      moveToZoneId = selectedAffordance.moveToZoneId;
    } else if (selectedAffordance.moveToZoneId) {
      materialViolations.push({
        code: "AFFORDANCE_DESTINATION_NOT_REACHABLE",
        field: "moveToZoneId",
        message: "世界提供的行动目标当前不在一跳可达区域内，不能提交。",
        evidence: { affordanceId: selectedAffordance.id, moveToZoneId: selectedAffordance.moveToZoneId },
      });
      selectedAffordance = null;
      affordanceId = "";
    }
  }
  const ownUndisclosedVisit = (state.tavernState?.activeVisits || []).find((visit) => (
    visit.visitorId === input.agent?.id
    && !["completed", "refused", "abandoned"].includes(visit.stage)
    && visit.purposeDisclosureRequired !== false
    && (visit.purposeStatus || visit.purposeDisclosureStatus) === "undisclosed"
  ));
  if (ownUndisclosedVisit && !["declare_visit_purpose", "approach_reception"].includes(selectedAffordance?.type || "")) {
    materialViolations.push({
      code: "VISIT_PURPOSE_REQUIRED_BEFORE_ENTRY",
      field: proposedMoveToZoneId ? "moveToZoneId" : proposedVisibleAction ? "visibleAction" : "decision",
      message: "新来客必须先通过 declare_visit_purpose 当面说明具体来意；普通动作、观察或移动都不能绕过这一步。",
      evidence: { visitId: ownUndisclosedVisit.id, proposedMoveToZoneId, proposedVisibleAction },
    });
    selectedAffordance = null;
    affordanceId = "";
    actionType = "pass";
    speech = "";
    speechAct = "none";
    targetCharacterId = "";
    visibleAction = "";
    moveToZoneId = "";
  }
  const mandatedTargetId = chosenCandidate.targetCharacterId || "";
  // A material affordance names the unique real counterparty. Without such a
  // transaction, only fill a missing addressee from the activating intention;
  // never overwrite an explicit perceived addressee chosen by the Agent.
  if (!selectedAffordance?.targetCharacterId && !targetCharacterId && mandatedTargetId && perceivedIds.has(mandatedTargetId)) {
    targetCharacterId = mandatedTargetId;
  }
  const allowedSpeechActs = new Set([
    ...(realization.allowedSpeechActs || []),
    ...(selectedAffordance?.allowedSpeechActs || []),
  ].filter((item) => SPEECH_ACTS.has(item)));
  if (speech && allowedSpeechActs.size && !allowedSpeechActs.has(speechAct)) {
    speechAct = allowedSpeechActs.has("inform") ? "inform" : [...allowedSpeechActs][0] || "none";
  }
  if (speech && ["speak", "respond"].includes(realization.mode)) actionType = "speak";
  if (!speech && ["observe", "practice", "rest", "act"].includes(realization.mode) && actionType === "speak") actionType = "act";
  if (speech && realization.commitmentAction && COMMITMENT_ACTIONS.has(realization.commitmentAction)) {
    commitmentAction = realization.commitmentAction;
    commitmentTopic = text(realization.commitmentTopic || commitmentTopic, 120);
  }
  if (!selectedAffordance) {
    const possession = validatePossessionClaims({
      ledger: state.tavernState?.objectLedger || {},
      actorId: input.agent?.id || "",
      claims: tavernPossessionClaims(proposedVisibleAction),
    });
    if (!possession.ok) {
      materialViolations.push(...possession.violations.map((violation) => ({
        ...violation,
        field: "visibleAction",
        message: "人物不能公开做出需要持有某物的动作，除非物件账本确认它正在本人手中。",
      })));
      visibleAction = "";
    }
  }
  materialViolations.push(...materialClaimViolations(
    input,
    selectedAffordance,
    targetCharacterId,
    proposedSpeech,
    proposedVisibleAction,
    commitmentAction,
    commitmentTopic,
  ));
  const actionAttemptFailures = materialViolations.filter((violation) => ["visibleAction", "moveToZoneId", "actionAttempt"].includes(violation.field));
  if (actionAttemptFailures.length) {
    // A sentence may lie about the world, but declarative prose cannot make an
    // impossible object transfer or service handoff true. Keep any utterance,
    // drop only the ungrounded physical result, and expose the failed attempt
    // separately from speech/content diagnostics.
    visibleAction = "";
    if (!selectedAffordance) {
      if (speech) actionType = "speak";
      else if (expression.actionAttempt.primitive === "none" && !moveToZoneId && actionType !== "leave") actionType = "pass";
    }
  }
  const addressViolation = directedAddressViolation(input, targetCharacterId, speech);
  if (addressViolation) {
    dialogueViolations.push(addressViolation);
  }
  const hasDialogueSource = Boolean(
    input.activation?.sourceActionId
    || input.activation?.sourceThreadId
    || (input.openConversationThreads || []).some((thread) => thread.nextObligationCharacterId === input.agent?.id),
  );
  if (speech && continuationSpeechNeedsSource(speech) && !hasDialogueSource) {
    dialogueViolations.push({
      code: "MISSING_DIALOGUE_CONTINUATION_SOURCE",
      field: "utterance",
      message: "承接、确认或延期式台词必须有当前话轮或可追溯未完线程，不能用 inform 标签伪装来源。",
      evidence: { speech, speechAct },
    });
  }
  if (speech && selectedAffordance?.type === "declare_visit_purpose" && !tavernVisitPurposeSpeechIsConcrete(selectedAffordance, speech)) {
    dialogueViolations.push({
      code: "DIALOGUE_VISIT_PURPOSE_NOT_DISCLOSED",
      field: "utterance",
      message: "来客必须说出这次要办的具体事情，寒暄或报到不能把来意改成已公开。",
      evidence: { speech, requiredPurposeTerms: [...(selectedAffordance.requiredPurposeTerms || [])] },
    });
    selectedAffordance = null;
    affordanceId = "";
    actionType = speech ? "speak" : "pass";
  }
  const recentlyResolvedPairRequest = (runtime.requestLocks || []).some((lock) => (
    lock.requesterId === input.agent?.id
    && lock.responderId === targetCharacterId
    && lock.status === "resolved"
    && Number.isFinite(Number(lock.resolvedAtStep))
    && runtime.step - Number(lock.resolvedAtStep) <= 2
  ));
  const hasFreshRequestCause = Boolean(input.activation?.impactId || informationSourceImpactId);
  if (speech
    && ["ask", "offer", "negotiate", "warn"].includes(speechAct)
    && recentlyResolvedPairRequest
    && !hasFreshRequestCause) {
    dialogueViolations.push({
      code: "RECENTLY_RESOLVED_REQUEST_REOPENED_WITHOUT_CAUSE",
      field: "utterance",
      message: "同一对话双方刚刚完成一个请求；没有新的可感知事件时，不能立刻把已回答的问题当成新请求重开。",
      evidence: { requesterId: input.agent?.id || "", responderId: targetCharacterId, commitmentTopic },
    });
  }
  const speechTarget = runtime.agents?.[targetCharacterId] || null;
  const speechSourceZoneId = moveToZoneId || input.scene?.zoneId || "";
  if (speech && speechTarget && !conversationalSpeechAllowed({
    sourceZoneId: speechSourceZoneId,
    targetZoneId: speechTarget.zoneId,
    vocalMode,
    routeFor: (fromZoneId, toZoneId, modality) => spatialRoute(runtime.topology, fromZoneId, toZoneId, modality),
  })) {
    dialogueViolations.push({
      code: "DIALOGUE_TARGET_OUT_OF_RANGE",
      field: "utterance",
      message: "普通交谈必须发生在同一区域或世界明确标记为可自然交谈的相邻区域；其他跨区需要明确喊话且声音路径可达。",
      evidence: { sourceZoneId: speechSourceZoneId, targetZoneId: speechTarget.zoneId, vocalMode },
    });
  }
  const resolvedVoiceContract = buildTavernVoiceContract(characterById(state, input.agent?.id || "") || {}, {
    targetCharacterId,
    relationshipContext: input.agent?.relationshipContext || [],
    expressionStrategy: chosenCandidate.expressionStrategy || {},
  });
  const conversationRealization = chosenCandidate.speechRealization || buildTavernConversationalRealization({
    voiceContract: resolvedVoiceContract,
    candidate: chosenCandidate,
    sourceImpact: (input.perceivedImpacts || []).find((impact) => (
      impact.impactId === (
        chosenCandidate.realization?.responseSourceImpactId
        || chosenCandidate.realization?.observationSourceImpactId
        || input.activation?.impactId
      )
    )) || null,
    relationshipContext: input.agent?.relationshipContext || [],
    dynamicState: input.agent?.privateState?.ecologyState || {},
  });
  const voice = validateTavernVoiceRealization({
    speech,
    visibleAction,
    speechAct,
    characterId: input.agent?.id || "",
    targetCharacterId,
    voiceContract: resolvedVoiceContract,
    conversationRealization,
    requiresSubstantiveAnswer: speechAct === "answer" || Boolean(input.activation?.sourceActionId || input.activation?.sourceThreadId),
    affordanceType: selectedAffordance?.type || "",
    contextTopics: [
      commitmentTopic,
      input.activation?.topic,
      input.activation?.content,
      chosenCandidate.label,
      selectedAffordance?.label,
      selectedAffordance?.authoritativeFact,
    ].filter(Boolean),
    speechRealizationPlan: speechRealizationPlan.value,
  });
  if (!voice.ok) dialogueViolations.push(...(voice.hardViolations || []));
  if (selectedAffordance?.requiresSpeech && !speech) {
    materialViolations.push({
      code: "AFFORDANCE_REQUIRES_OBSERVABLE_SPEECH",
      field: "actionAttempt",
      message: "说明来意或接待回应必须真的说出口；沉默不能改变来访阶段。",
      evidence: { affordanceId: selectedAffordance.id, affordanceType: selectedAffordance.type },
    });
    selectedAffordance = null;
    affordanceId = "";
  }
  const gesture = repeatedGestureSignature(visibleAction);
  if (gesture && (input.recentOwnActions || []).some((action) => repeatedGestureSignature(action.visibleAction) === gesture)) {
    dialogueViolations.push({
      code: "SAME_SCENE_REPEATED_GESTURE",
      field: "visibleActionStyle",
      message: "人物重复了相近小动作；保留为行为，同时供多轮质感诊断。",
      evidence: { gesture },
    });
  }
  if (speech && actionType === "pass") actionType = "speak";
  if (!speech && actionType === "speak") actionType = moveToZoneId ? "move" : visibleAction ? "act" : "pass";
  if (actionType === "pass") {
    speech = "";
    speechAct = "none";
    targetCharacterId = "";
    informationSourceImpactId = "";
    affordanceId = "";
  }
  if (!speech && !visibleAction && !moveToZoneId && actionType !== "leave"
    && expression.actionAttempt.primitive === "none") actionType = "pass";
  const target = (input.perceivedCharacters || []).find((character) => character.id === targetCharacterId);
  if (actionType === "interact" && target?.zoneId !== input.scene.zoneId) {
    // An adjacent person may be perceived, but touch/object transfer still requires co-location.
    // The Agent must move first; the world must never silently teleport a physical action.
    actionType = moveToZoneId ? "move" : "act";
    if (!speech) targetCharacterId = "";
  }
  if (["fulfill", "defer", "drop"].includes(commitmentAction)) {
    const matchingCommitment = (input.ownCommitments || []).find((commitment) => commitment.topic === commitmentTopic);
    const otherPartyIds = matchingCommitment
      ? [matchingCommitment.ownerId, matchingCommitment.targetCharacterId].filter((id) => id && id !== input.agent.id)
      : [];
    if (!matchingCommitment || (targetCharacterId && otherPartyIds.length && !otherPartyIds.includes(targetCharacterId))) {
      commitmentAction = "none";
      commitmentTopic = "";
    }
  }
  if (commitmentAction === "open" && (!commitmentTopic || !targetCharacterId)) {
    commitmentAction = "none";
    commitmentTopic = "";
  }
  if (decisionValue === "none" && speech) {
    if (speechAct === "refuse" || /(?:不愿|不肯|拒绝|不答应)/u.test(speech)) decisionValue = "refuse";
    else if (commitmentAction === "defer" || /(?:改日|稍后|晚些|还没决定|再给.{0,6}答复)/u.test(speech)) decisionValue = "defer";
    else if (/(?:我答应|我愿意|我肯|可以，就这么办|行，就这么办)/u.test(speech)) decisionValue = "accept";
  }
  const semanticFrame = realizedActionSemanticFrame({
    sourceFrame: chosenSemanticFrame,
    candidateId: chosenCandidate.candidateId,
    actorCharacterId: input.agent?.id || "",
    targetCharacterId,
    actionType,
    speechAct,
    speech,
    visibleAction,
    commitmentTopic,
    decisionValue,
  });
  if (speech && semanticFrame?.kind && ["social_request", "social_decision"].includes(semanticFrame.kind)) {
    const anchors = semanticFrame.lexicalAnchors || [];
    const expectedCounterparty = input.agent?.id === semanticFrame.roles?.requestedActor
      ? semanticFrame.roles?.requester
      : input.agent?.id === semanticFrame.roles?.requester ? semanticFrame.roles?.requestedActor : "";
    if (expectedCounterparty && targetCharacterId !== expectedCounterparty) {
      dialogueViolations.push({
        code: "SEMANTIC_REQUEST_COUNTERPARTY_MISMATCH",
        field: "targetCharacterId",
        message: "这次请求或答复必须交给原社会事件中的实际对方。",
        evidence: { expectedCounterparty, proposedTargetCharacterId: targetCharacterId, semanticFrameId: semanticFrame.id },
      });
    }
    if (anchors.length && !anchors.some((anchor) => speech.includes(anchor))) {
      dialogueViolations.push({
        code: "SEMANTIC_REQUEST_OBJECT_MISSING",
        field: "utterance",
        message: "人物的台词没有说到本人正在请求或答复的具体事项，不能用无对象的自我宣言代替。",
        evidence: { semanticFrameId: semanticFrame.id, requiredConceptAnchors: [...anchors] },
      });
    }
  }
  const hardSemanticRoleFailure = dialogueViolations.some((violation) => [
    "SEMANTIC_FRAME_ID_MISMATCH",
    "SEMANTIC_ROLE_BINDING_MISMATCH",
  ].includes(violation.code));
  if (hardSemanticRoleFailure) {
    actionType = "pass";
    speech = "";
    speechAct = "none";
    targetCharacterId = "";
    visibleAction = "";
    moveToZoneId = "";
    affordanceId = "";
    commitmentAction = "none";
    commitmentTopic = "";
    decisionValue = "none";
  }
  const semantic = validateFinalDecisionSemantics({
    actionType,
    speechAct,
    targetCharacterId,
    speech,
    visibleAction,
    moveToZoneId,
    informationSourceImpactId,
  }, input, state, runtime);
  if (!semantic.ok) {
    const codes = new Set(semantic.violations.map((violation) => violation.code));
    if (codes.has("VISIBLE_ACTION_SOURCE_ZONE_MISMATCH") || codes.has("VISIBLE_ACTION_DESTINATION_UNCOMMITTED")) {
      const destination = (input.reachableZones || []).find((zone) => zone.id === moveToZoneId);
      visibleAction = moveToZoneId
        ? `${input.agent?.name || "人物"}从${input.scene?.zoneLabel || "原处"}朝${destination?.label || moveToZoneId}走去`
        : "";
    }
    if (codes.has("VISIBLE_ACTION_TARGET_MISMATCH")) visibleAction = "";
  }
  if (moveToZoneId && !visibleAction) {
    const destination = (input.reachableZones || []).find((zone) => zone.id === moveToZoneId);
    visibleAction = `${input.agent?.name || "人物"}从${input.scene?.zoneLabel || "原处"}朝${destination?.label || moveToZoneId}走去`;
  }
  if (!speech && !visibleAction && !moveToZoneId && actionType !== "leave" && !selectedAffordance
    && expression.actionAttempt.primitive === "none") {
    actionType = "pass";
    targetCharacterId = "";
    commitmentAction = "none";
    commitmentTopic = "";
  }
  const speechFunctions = inferPublicSpeechFunctions({
    speech,
    speechAct,
    speechFunctions: raw.speechFunctions,
  });
  const epistemicQuestionAudit = auditEpistemicQuestionRealization({
    input,
    chosenCandidate,
    speechAct,
    speechFunctions,
    speech,
    communicationPlan: communication.value,
  });
  const hardDialogueCodes = new Set([
    "SEMANTIC_FRAME_ID_MISMATCH",
    "SEMANTIC_ROLE_BINDING_MISMATCH",
    "SEMANTIC_PREDICATE_MISMATCH",
    "SEMANTIC_TOPIC_MISMATCH",
    "AFFORDANCE_REQUIRES_OBSERVABLE_SPEECH",
  ]);
  const hardViolations = [
    ...materialViolations.filter((violation) => !["utterance", "visibleAction", "visibleActionStyle", "moveToZoneId", "actionAttempt"].includes(violation.field)),
    ...dialogueViolations.filter((violation) => hardDialogueCodes.has(violation.code)),
    ...(semantic.hardViolations || semantic.violations || []),
  ];
  const claimAnnotations = [
    ...materialViolations.filter((violation) => violation.field === "utterance" || violation.field === "visibleActionStyle"),
    ...dialogueViolations.filter((violation) => !hardDialogueCodes.has(violation.code)),
    ...(semantic.claimAnnotations || []),
  ];
  return {
    candidateId: chosenCandidate.candidateId,
    choiceAuthority: "character-agent",
    actionType,
    speechAct,
    speechFunctions,
    targetCharacterId,
    speech,
    visibleAction: actionType === "pass" ? "" : visibleAction,
    observableAffectiveTexture: actionType === "pass"
      ? []
      : observableAffectiveTexture(expression.observableAffectiveTexture),
    moveToZoneId: actionType === "pass" ? "" : moveToZoneId,
    vocalMode: actionType === "pass" ? "conversational" : vocalMode,
    affordanceId,
    informationSourceImpactId,
    commitmentAction,
    commitmentTopic,
    decisionValue,
    cognitiveAppraisal: cognitive.value,
    cognitiveAppraisalAuthority: cognitive.authority,
    communicationPlan: communication.value,
    communicationPlanAuthority: communication.authority,
    speechRealizationPlan: deepClone(speechRealizationPlan.value),
    speechRealizationPlanAuthority: speechRealizationPlan.authority,
    utterance: { literalSpeech: speech, vocalMode },
    utteranceAuthority: expression.authority.utterance,
    embodiedIntent: deepClone(expression.embodiedIntent),
    embodiedIntentAuthority: expression.authority.embodiedIntent,
    actionAttempt: {
      ...deepClone(expression.actionAttempt),
      primitive: affordanceId ? "use_affordance" : expression.actionAttempt.primitive,
      targetCharacterId: expression.actionAttempt.targetCharacterId || selectedAffordance?.targetCharacterId || attemptedTargetCharacterId || "",
      destinationId: expression.actionAttempt.destinationId || selectedAffordance?.moveToZoneId || proposedMoveToZoneId || "",
      affordanceId: expression.actionAttempt.affordanceId || affordanceId || "",
    },
    actionAttemptAuthority: expression.authority.actionAttempt,
    semanticFrame: actionType === "pass" ? null : semanticFrame,
    semanticFrameId: actionType === "pass" ? "" : semanticFrame?.id || "",
    semanticRoleBindings: actionType === "pass" ? {} : deepClone(semanticFrame?.roles || {}),
    privateReason: text(raw.privateReason, 220),
    goalPreservation: deepClone(raw.goalPreservation || {}),
    realizedSpeechHabitIds: [...new Set((raw.realizedSpeechHabitIds || [])
      .map((value) => text(value, 160))
      .filter(Boolean))],
    sharedActivity: deepClone(raw.sharedActivity || null),
    relationshipAppraisal,
    relationshipAppraisalAuthority,
    postChoiceContinuity,
    postChoiceContinuityAuthority,
    privateProposalDiagnostics,
    hardViolations,
    claimAnnotations,
    actionAttemptFailures,
    epistemicQuestionAudit,
    epistemicDiagnostics: deepClone(epistemicQuestionAudit.diagnostics || []),
    voiceDiagnostics: deepClone(voice.diagnosticFindings || []),
    semanticViolations: hardViolations,
  };
}

function impactProvenanceForAction(runtime, action, kind = "firsthand") {
  const sourceImpactIds = [];
  if (action.informationSourceImpactId) sourceImpactIds.push(action.informationSourceImpactId);
  else if (action.causalParentImpactId) sourceImpactIds.push(action.causalParentImpactId);
  const parentImpact = (runtime.impacts || []).find((impact) => impact.id === action.causalParentImpactId);
  const sourceEpisode = action.informationSourceImpactId
    ? (runtime.agents?.[action.actorId]?.memoryState?.episodes || []).find((episode) => episode.sourceImpactId === action.informationSourceImpactId)
    : null;
  return {
    kind,
    sourceActionId: action.id,
    sourceImpactIds,
    // Conversation identity and response obligation are different things.  A
    // reply keeps the thread id for memory/narration provenance even though
    // updateRuntimeConversationLocks may resolve the request immediately.
    sourceThreadId: action.sourceThreadId || parentImpact?.provenance?.sourceThreadId || "",
    responseToTurnId: action.responseToTurnId || "",
    responseSourceLine: action.responseSourceLine || "",
    responseSourceSlotId: action.responseSourceSlotId || "",
    responseSourceSlotLabel: action.responseSourceSlotLabel || "",
    speakerCharacterId: action.actorId,
    claimedOriginalSourceId: sourceEpisode?.source?.claimedOriginalSourceId || sourceEpisode?.source?.immediateSourceCharacterId || "",
    sourceCharacterChain: kind === "gossip"
      ? [...new Set([...(sourceEpisode?.source?.characterChain || []), sourceEpisode?.source?.immediateSourceCharacterId, action.actorId].filter(Boolean))]
      : [action.actorId],
    suspectedMotive: sourceEpisode?.source?.suspectedMotive || "",
    confidence: kind === "gossip" ? Math.min(0.72, Number(sourceEpisode?.source?.confidence || 0.58) * 0.86) : 0.97,
  };
}

export function deriveImpactFactorsFromAction(state = {}, runtime = {}, action = {}) {
  const impacts = [];
  const sourceZoneId = action.speechSourceZoneId || action.toZoneId || action.actorZoneId || runtime.agents?.[action.actorId]?.zoneId || "hall";
  const psychology = actionPsychologyDimensions(runtime, action);
  const soundTexture = observableTextureForModality(action, "sound");
  const visualTexture = observableTextureForModality(action, "visual");
  const touchTexture = observableTextureForModality(action, "touch");
  const smellTexture = observableTextureForModality(action, "smell");
  if (action.speech) {
    impacts.push(createImpactFactor({
      causedByActionId: action.id,
      locationId: runtime.locationId || LOCATION_ID,
      sourceCharacterId: action.actorId,
      sourceZoneId,
      type: "speech",
      modality: "sound",
      intensity: action.targetCharacterId ? 82 : 68,
      radius: 2.5,
      directedTargetId: action.targetCharacterId || "",
      content: action.speech,
      observableAffectiveTexture: soundTexture,
      topic: action.publicTopic || publicActionSurface(action, "speech"),
      speechAct: action.speechAct,
      speechFunctions: actionSpeechFunctions(action),
      actionKind: action.actionKind,
      commitmentAction: action.commitmentAction,
      semanticFrame: deepClone(publicSemanticFrameForAction(action, "speech")),
      ...psychology,
      createdAtSeconds: runtime.elapsedSeconds,
      provenance: impactProvenanceForAction(runtime, action),
    }));
    if (action.speechAct === "gossip" || action.informationSourceImpactId) {
      impacts.push(createImpactFactor({
        causedByActionId: action.id,
        locationId: runtime.locationId || LOCATION_ID,
        sourceCharacterId: action.actorId,
        sourceZoneId,
        type: "information",
        modality: "sound",
        intensity: 72,
        radius: 2.25,
        directedTargetId: action.targetCharacterId || "",
        content: action.speech,
        topic: action.publicTopic || publicActionSurface(action, "speech"),
        speechAct: action.speechAct,
        speechFunctions: actionSpeechFunctions(action),
        actionKind: action.actionKind,
        commitmentAction: action.commitmentAction,
        semanticFrame: deepClone(publicSemanticFrameForAction(action, "speech")),
        ...psychology,
        createdAtSeconds: runtime.elapsedSeconds,
        provenance: impactProvenanceForAction(runtime, action, "gossip"),
      }));
    }
  }
  if (action.visibleAction || visualTexture.length) {
    const physicalTargetCharacterId = action.actionAttempt?.targetCharacterId || (!action.speech ? action.targetCharacterId : "");
    const visualSurface = text(action.visibleAction || observableTextureSurface(visualTexture), 260);
    impacts.push(createImpactFactor({
      causedByActionId: action.id,
      locationId: runtime.locationId || LOCATION_ID,
      sourceCharacterId: action.actorId,
      sourceZoneId,
      type: action.actionType === "interact" ? "resource" : "physical",
      modality: action.actionType === "interact" && physicalTargetCharacterId ? "touch" : "visual",
      intensity: action.actionType === "interact" ? 86 : 52,
      radius: action.actionType === "interact" ? 0 : 1.5,
      directedTargetId: physicalTargetCharacterId,
      content: visualSurface,
      observableAffectiveTexture: visualTexture,
      topic: publicActionSurface(action, "visual"),
      actionKind: action.actionKind,
      commitmentAction: action.commitmentAction,
      semanticFrame: deepClone(publicSemanticFrameForAction(action, "visual")),
      ...psychology,
      createdAtSeconds: runtime.elapsedSeconds,
      provenance: impactProvenanceForAction(runtime, action),
    }));
  }
  if (!action.speech && soundTexture.length) {
    impacts.push(createImpactFactor({
      causedByActionId: action.id,
      locationId: runtime.locationId || LOCATION_ID,
      sourceCharacterId: action.actorId,
      sourceZoneId,
      type: "physical",
      modality: "sound",
      intensity: 42,
      radius: 1.25,
      directedTargetId: action.actionAttempt?.targetCharacterId || action.targetCharacterId || "",
      content: observableTextureSurface(soundTexture),
      observableAffectiveTexture: soundTexture,
      topic: observableTextureSurface(soundTexture),
      actionKind: action.actionKind,
      semanticFrame: deepClone(publicSemanticFrameForAction(action, "visual")),
      ...psychology,
      createdAtSeconds: runtime.elapsedSeconds,
      provenance: impactProvenanceForAction(runtime, action),
    }));
  }
  for (const [modality, rows] of [["touch", touchTexture], ["smell", smellTexture]]) {
    if (!rows.length) continue;
    impacts.push(createImpactFactor({
      causedByActionId: action.id,
      locationId: runtime.locationId || LOCATION_ID,
      sourceCharacterId: action.actorId,
      sourceZoneId,
      type: "physical",
      modality,
      intensity: modality === "touch" ? 58 : 36,
      radius: modality === "touch" ? 0 : 1,
      directedTargetId: modality === "touch"
        ? action.actionAttempt?.targetCharacterId || action.targetCharacterId || ""
        : "",
      content: observableTextureSurface(rows),
      observableAffectiveTexture: rows,
      topic: observableTextureSurface(rows),
      actionKind: action.actionKind,
      semanticFrame: deepClone(publicSemanticFrameForAction(action, "visual")),
      ...psychology,
      createdAtSeconds: runtime.elapsedSeconds,
      provenance: impactProvenanceForAction(runtime, action),
    }));
  }
  if (action.moveToZoneId) {
    impacts.push(createImpactFactor({
      causedByActionId: action.id,
      locationId: runtime.locationId || LOCATION_ID,
      sourceCharacterId: action.actorId,
      sourceZoneId: action.moveToZoneId,
      type: "physical",
      modality: "visual",
      intensity: 48,
      radius: 1.5,
      content: `${action.actorName || action.actorId}走到${runtime.topology.zones?.[action.moveToZoneId]?.label || action.moveToZoneId}。`,
      topic: publicActionSurface(action, "movement"),
      semanticFrame: deepClone(publicSemanticFrameForAction(action, "movement")),
      committed: action.committed === true,
      createdAtSeconds: runtime.elapsedSeconds,
      provenance: impactProvenanceForAction(runtime, action),
    }));
  }
  if (["failed", "partial"].includes(action.worldResolution?.status)
    && (action.worldResolution?.failureCodes || []).length) {
    const firstViolation = action.worldResolution?.violations?.[0] || {};
    impacts.push(createImpactFactor({
      causedByActionId: action.id,
      locationId: runtime.locationId || LOCATION_ID,
      sourceCharacterId: "world:action-feedback",
      sourceZoneId: action.actorZoneId || runtime.agents?.[action.actorId]?.zoneId || sourceZoneId,
      type: "action_feedback",
      modality: "touch",
      intensity: 94,
      radius: 0,
      directedTargetId: action.actorId,
      content: text(firstViolation.message || "这个动作没有按本人的意图发生。", 260),
      topic: "行动尝试的现实反馈",
      cueIds: [...new Set(action.worldResolution.failureCodes || [])],
      outcomeValence: -0.22,
      controlDelta: -0.34,
      committed: true,
      createdAtSeconds: runtime.elapsedSeconds,
      provenance: {
        kind: "world_feedback",
        sourceActionId: action.id,
        sourceImpactIds: [],
      },
    }));
  }
  return impacts;
}

function applyCommitment(runtime, action) {
  if (!action.commitmentTopic || action.commitmentAction === "none") return;
  const sharedTopic = action.publicTopic || action.commitmentTopic;
  const matching = [...(runtime.commitments || [])].reverse().find((commitment) => (
    commitment.status === "open"
    && [sharedTopic, action.commitmentTopic].includes(commitment.topic)
    && [commitment.ownerId, commitment.targetCharacterId].includes(action.actorId)
  ));
  if (action.commitmentAction === "open") {
    runtime.commitments.push({
      id: createId("scene_commitment"),
      topic: sharedTopic,
      ownerId: action.actorId,
      targetCharacterId: action.targetCharacterId || "",
      status: "open",
      openedAtSeconds: runtime.elapsedSeconds,
      sourceActionId: action.id,
    });
  } else if (matching) {
    matching.status = action.commitmentAction === "fulfill"
      ? "fulfilled"
      : action.commitmentAction === "defer" ? "deferred" : "dropped";
    matching.closedAtSeconds = runtime.elapsedSeconds;
    matching.closedByActionId = action.id;
  }
}

export function updateRuntimeConversationLocks(runtime, action) {
  const sharedActivityOperation = action.sharedActivity?.operation || "none";
  const sharedActivityResponse = action.sharedActivity?.response || "none";
  const sharedActivityOpensRequest = sharedActivityOperation === "propose"
    || (sharedActivityOperation === "respond" && sharedActivityResponse === "counter");
  const sharedActivitySettlesIncoming = sharedActivityOperation === "respond"
    && ["accept", "refuse", "counter"].includes(sharedActivityResponse);
  if ((!action.speech && !sharedActivityOpensRequest && !sharedActivitySettlesIncoming) || !action.targetCharacterId) return;
  const reverseLocks = (runtime.requestLocks || []).filter((lock) => (
    lock.requesterId === action.targetCharacterId
    && lock.responderId === action.actorId
    && ["awaiting", "paused", "unresolved"].includes(lock.status)
  ));
  const disposition = THREAD_DISPOSITIONS.includes(action.threadDisposition) ? action.threadDisposition : "none";
  const speechFunctions = actionSpeechFunctions(action);
  const asksForResponse = speechFunctions.includes("ask") && (
    action.speechAct === "ask"
    || action.communicationPlan?.goal === "obtain_information"
    || action.communicationPlan?.tactic === "counter_question"
    || ["counter", "open_new"].includes(disposition)
  );
  const opensRequest = disposition === "open_new"
    || (disposition === "counter" && action.communicationPlan?.tactic === "counter_question")
    || asksForResponse
    || sharedActivityOpensRequest
    || (action.communicationPlanAuthority !== "character-agent" && ["ask", "offer", "negotiate", "warn"].includes(action.speechAct));
  const inheritedLock = [...reverseLocks].reverse().find((lock) => (
    (action.responseToTurnId && lock.latestActionId === action.responseToTurnId)
    || (action.sourceThreadId && [lock.threadId, lock.sourceThreadId].includes(action.sourceThreadId))
  )) || reverseLocks[reverseLocks.length - 1] || null;
  const inheritedThreadId = action.sourceThreadId
    || inheritedLock?.threadId
    || inheritedLock?.sourceThreadId
    || "";
  if (inheritedThreadId) action.sourceThreadId = inheritedThreadId;
  if (inheritedLock && action.responseToTurnId !== inheritedLock.latestActionId) {
    action.responseToTurnId = inheritedLock.latestActionId || action.responseToTurnId || "";
    const sourceAction = (runtime.actions || []).find((candidate) => candidate.id === inheritedLock.latestActionId);
    if (sourceAction) {
      action.responseSourceLine = sourceAction.speech || action.responseSourceLine || "";
      action.responseSourceSlotId = sourceAction.slotId || action.responseSourceSlotId || "";
      action.responseSourceSlotLabel = sourceAction.slotLabel || action.responseSourceSlotLabel || "";
    }
  }
  if (inheritedLock) {
    // Public speech and private thread intent are distinct. If the utterance
    // actually answers the latest incoming request, release that scheduling
    // lock even when the same utterance immediately opens a new question. This
    // does not decide whether either participant feels satisfied; their owned
    // thread appraisals remain independent.
    if (speechFunctions.includes("answer") || ["settle", "refuse"].includes(disposition) || sharedActivitySettlesIncoming) {
      resolveInteraction(inheritedLock, {
        step: runtime.step,
        actionId: action.id,
        resolution: sharedActivityResponse === "counter"
          ? "counteroffer_emitted"
          : sharedActivityResponse === "refuse" || disposition === "refuse"
            ? "refusal_emitted"
            : "response_emitted",
      });
    } else if (["defer", "evade", "counter", "redirect", "ignore"].includes(disposition)) {
      inheritedLock.status = disposition === "defer" ? "deferred" : "unresolved";
      inheritedLock.resolution = disposition;
      inheritedLock.latestResponseActionId = action.id;
      inheritedLock.respondedAtStep = runtime.step;
    }
  }
  const sourceThreadId = inheritedThreadId || (opensRequest ? `live_thread:${action.id}` : "");
  if (sourceThreadId) {
    action.sourceThreadId = sourceThreadId;
    const speakerState = ensureRuntimeParticipantThreadState(runtime, sourceThreadId, action.actorId);
    if (speakerState) {
      speakerState.lastSpokenTurnId = action.id;
      speakerState.outgoingDisposition = disposition;
      speakerState.processingStatus = "appraised";
      speakerState.authority = action.communicationPlanAuthority === "character-agent"
        ? "character-agent"
        : "legacy-speech-act-migration-adapter";
      if (["settle", "refuse"].includes(disposition)) {
        speakerState.selfClosure = "closed_for_self";
        speakerState.responseNeed = "none";
        speakerState.pressure = Math.min(Number(speakerState.pressure || 0.2), 0.12);
      } else if (["defer", "evade", "counter", "redirect", "open_new"].includes(disposition)) {
        speakerState.selfClosure = "open";
      }
      if (opensRequest) {
        speakerState.satisfaction = "unsatisfied";
        speakerState.responseNeed = "medium";
        speakerState.selfClosure = "open";
        speakerState.pressure = Math.max(Number(speakerState.pressure || 0.2), 0.55);
      }
    }
    const recipientState = ensureRuntimeParticipantThreadState(runtime, sourceThreadId, action.targetCharacterId);
    if (recipientState) {
      recipientState.processingStatus = "awaiting_delivery";
      recipientState.selfClosure = "open";
      recipientState.authority = "character-owned-thread-state";
    }
  }
  if (opensRequest) {
    const existing = [...(runtime.requestLocks || [])].reverse().find((lock) => (
      lock.requesterId === action.actorId && lock.responderId === action.targetCharacterId
    ));
    if (existing) {
      existing.status = "awaiting";
      existing.latestActionId = action.id;
      existing.topic = action.publicTopic || existing.topic || "未命名请求";
      existing.threadId = existing.threadId || sourceThreadId;
      existing.attempts = 0;
    } else {
      runtime.requestLocks.push({
        id: createId("request_lock"),
        threadId: sourceThreadId,
        requesterId: action.actorId,
        responderId: action.targetCharacterId,
        topic: action.publicTopic || "未命名请求",
        status: "awaiting",
        openedAtStep: runtime.step,
        latestActionId: action.id,
        attempts: 0,
      });
    }
    return;
  }
}

function markParticipantThreadDelivery(runtime, action, impact, delivery) {
  if (!action.speech || impact?.type !== "speech" || !action.sourceThreadId) return null;
  if (!delivery?.recipientId || delivery.recipientId === action.actorId) return null;
  const participant = ensureRuntimeParticipantThreadState(runtime, action.sourceThreadId, delivery.recipientId);
  if (!participant) return null;
  participant.processingStatus = "received_unappraised";
  participant.lastReceivedTurnId = action.id;
  participant.perceivedDisposition = "unclear";
  participant.selfClosure = "open";
  participant.pressure = Math.max(Number(participant.pressure || 0.2), 0.45);
  participant.authority = "awaiting-character-agent-appraisal";
  return participant;
}

function worldResolutionBase(action = {}) {
  return {
    schemaVersion: 1,
    authority: "world-kernel",
    status: "not_attempted",
    attempt: deepClone(action.actionAttempt || { primitive: "none", objectId: "", targetCharacterId: "", destinationId: "", affordanceId: "" }),
    visibleOutcome: "",
    observableAffectiveTexture: [],
    committedFacts: [],
    objectOperations: [],
    failureCodes: [],
    violations: [],
    movementCommitted: false,
  };
}

function objectOperationForActionAttempt(action = {}, runtime = {}) {
  const attempt = action.actionAttempt || {};
  const common = { objectId: attempt.objectId, actorId: action.actorId };
  if (attempt.primitive === "pickup") return { ...common, type: "pickup" };
  if (attempt.primitive === "take_out") return { ...common, type: "take_out" };
  if (attempt.primitive === "show") return {
    ...common,
    type: "show",
    displayedToActorIds: attempt.targetCharacterId ? [attempt.targetCharacterId] : [],
  };
  if (attempt.primitive === "hide") return { ...common, type: "hide" };
  if (attempt.primitive === "store") return { ...common, type: "store", storageMode: "packed" };
  if (attempt.primitive === "draw") return { ...common, type: "draw", affordanceId: attempt.affordanceId || action.id };
  if (attempt.primitive === "sheathe") return { ...common, type: "sheathe", affordanceId: attempt.affordanceId || action.id };
  if (attempt.primitive === "transfer") return {
    ...common,
    type: "transfer_attempt",
    toHolderActorId: attempt.targetCharacterId,
  };
  if (attempt.primitive === "place") return {
    ...common,
    type: "place",
    zoneId: attempt.destinationId || runtime.agents?.[action.actorId]?.zoneId || action.actorZoneId,
  };
  if (attempt.primitive === "consume") return { ...common, type: "consume" };
  return null;
}

export function settleFreeActionAttempt(workingState, runtime, action) {
  const result = worldResolutionBase(action);
  const attempt = action.actionAttempt || {};
  const preflightViolations = deepClone(action.actionAttemptFailures || []);
  if (attempt.primitive === "none") return result;
  if (attempt.primitive === "move") {
    const routeFailureCodes = new Set([
      "ACTION_ATTEMPT_DESTINATION_MISSING",
      "ACTION_ATTEMPT_DESTINATION_UNREACHABLE",
    ]);
    const blockingPreflightViolations = preflightViolations.filter((violation) => !routeFailureCodes.has(violation.code));
    if (blockingPreflightViolations.length) {
      result.status = "failed";
      result.visibleOutcome = action.visibleAction || "";
      result.committedFacts = [{
        kind: "movement_attempted",
        actorId: action.actorId,
        fromZoneId: action.actorZoneId || "",
        toZoneId: attempt.destinationId || "",
      }];
      result.violations = blockingPreflightViolations;
      result.failureCodes = [...new Set(blockingPreflightViolations.map((violation) => violation.code).filter(Boolean))];
      return result;
    }
    const movement = resolvePlaceMovementAttempt({
      topology: runtime.topology || TAVERN_SCENE_TOPOLOGY,
      actorId: action.actorId,
      fromZoneId: action.actorZoneId,
      toZoneId: attempt.destinationId,
      socialBoundaries: tavernSocialBoundariesForActor(workingState, runtime, action.actorId),
      accessGrants: runtime.accessGrants || [],
      step: runtime.step,
    });
    result.status = movement.status;
    result.movementCommitted = movement.movementCommitted;
    result.committedFacts = deepClone(movement.committedFacts || []);
    result.physicalBarrier = deepClone(movement.physicalBarrier || null);
    result.crossedSocialBoundaryIds = [...(movement.crossedSocialBoundaryIds || [])];
    result.possibleSocialResponseTags = [...(movement.possibleSocialResponseTags || [])];
    result.failureCodes = [...new Set([
      ...(movement.failureCodes || []),
      ...(movement.status === "failed" ? ["ACTION_ATTEMPT_DESTINATION_UNREACHABLE"] : []),
    ])];
    result.visibleOutcome = action.visibleAction || (movement.movementCommitted
      ? `${action.actorName || "人物"}朝${runtime.topology.zones?.[attempt.destinationId]?.label || attempt.destinationId}走去`
      : `${action.actorName || "人物"}试着朝${runtime.topology.zones?.[attempt.destinationId]?.label || attempt.destinationId || "目标方向"}走去`);
    if (movement.status === "failed") {
      const barrierKind = movement.physicalBarrier?.kind || "";
      result.violations = [{
        code: movement.failureCodes?.[0] || "ACTION_ATTEMPT_DESTINATION_UNREACHABLE",
        field: "actionAttempt.destinationId",
        message: barrierKind
          ? `人物已经尝试移动，但被${barrierKind}这一物理障碍挡住，目标位置没有到达。`
          : "人物已经尝试移动，但目标位置不相邻或不存在，移动没有到达目的地。",
        evidence: {
          fromZoneId: action.actorZoneId,
          destinationId: attempt.destinationId,
          physicalBarrier: deepClone(movement.physicalBarrier || null),
        },
      }];
    }
    return result;
  }
  if (preflightViolations.length) {
    result.status = "failed";
    result.violations = preflightViolations;
    result.failureCodes = [...new Set(preflightViolations.map((violation) => violation.code).filter(Boolean))];
    return result;
  }
  if (attempt.primitive === "speak") {
    if (!action.speech) {
      result.status = "failed";
      result.failureCodes = ["ACTION_ATTEMPT_SPEECH_EMPTY"];
      result.violations = [{
        code: "ACTION_ATTEMPT_SPEECH_EMPTY",
        field: "actionAttempt.primitive",
        message: "人物提交了说话动作，却没有实际发出字句。世界不会把无声意图记成已经说出口。",
        evidence: { actorId: action.actorId, targetCharacterId: attempt.targetCharacterId || "" },
      }];
      return result;
    }
    result.status = "success";
    result.visibleOutcome = action.visibleAction || "";
    result.committedFacts.push({
      kind: "utterance_emitted",
      actorId: action.actorId,
      targetCharacterId: attempt.targetCharacterId || action.targetCharacterId || "",
    });
    return result;
  }
  if (["observe", "listen"].includes(attempt.primitive)) {
    const target = attempt.targetCharacterId ? runtime.agents?.[attempt.targetCharacterId] : null;
    const modality = attempt.primitive === "observe" ? "visual" : "sound";
    const route = target?.present
      ? spatialRoute(runtime.topology || TAVERN_SCENE_TOPOLOGY, action.actorZoneId, target.zoneId, modality)
      : null;
    if (attempt.targetCharacterId && (!target?.present || !route)) {
      result.status = "failed";
      result.failureCodes = ["ACTION_ATTEMPT_ATTENTION_TARGET_UNAVAILABLE"];
      result.violations = [{
        code: "ACTION_ATTEMPT_ATTENTION_TARGET_UNAVAILABLE",
        field: "actionAttempt.targetCharacterId",
        message: "人物试图定向观察或倾听的对象不在当前感知路径上；世界只记录失败尝试，不生成观察所得。",
        evidence: { primitive: attempt.primitive, targetCharacterId: attempt.targetCharacterId },
      }];
      return result;
    }
    result.status = "success";
    result.visibleOutcome = action.visibleAction || "";
    result.committedFacts.push({
      kind: "attention_orientation",
      actorId: action.actorId,
      targetCharacterId: attempt.targetCharacterId || "",
      modality,
      zoneId: action.actorZoneId || "",
    });
    return result;
  }
  if (attempt.primitive === "interact") {
    const target = runtime.agents?.[attempt.targetCharacterId];
    if (!target?.present || target.zoneId !== action.actorZoneId) {
      result.status = "failed";
      result.failureCodes = ["ACTION_ATTEMPT_TARGET_NOT_COLOCATED"];
      result.violations = [{
        code: "ACTION_ATTEMPT_TARGET_NOT_COLOCATED",
        field: "actionAttempt.targetCharacterId",
        message: "需要近身接触的对象不在同一位置，动作没有触及对方。",
        evidence: { actorZoneId: action.actorZoneId, targetZoneId: target?.zoneId || "" },
      }];
      return result;
    }
  }
  const objectOperation = objectOperationForActionAttempt(action, runtime);
  if (objectOperation) {
    const objectResult = applyObjectOperations({
      ledger: workingState.tavernState?.objectLedger || {},
      operations: [objectOperation],
      actors: Object.values(runtime.agents || {}).map((agent) => ({
        id: agent.characterId,
        present: agent.present !== false,
        sceneId: runtime.locationId,
        zoneId: agent.zoneId,
      })),
      topology: runtime.topology,
    });
    if (!objectResult.ok) {
      result.status = "failed";
      result.violations = deepClone(objectResult.violations || []);
      result.failureCodes = [...new Set((objectResult.violations || []).map((violation) => violation.code).filter(Boolean))];
      return result;
    }
    workingState.tavernState.objectLedger = objectResult.ledger;
    result.objectOperations = [deepClone(objectOperation)];
    result.committedFacts.push({ kind: "object_ledger_transition", objectId: attempt.objectId, operationType: objectOperation.type });
  }
  result.status = "success";
  result.visibleOutcome = action.visibleAction || "";
  return result;
}

function settleAffordanceActionAttempt(action, selectedAffordance, material) {
  const result = worldResolutionBase(action);
  if (!selectedAffordance) return result;
  if (!material) {
    result.status = "failed";
    result.failureCodes = ["MATERIAL_AFFORDANCE_TRANSACTION_REJECTED"];
    result.violations = [{
      code: "MATERIAL_AFFORDANCE_TRANSACTION_REJECTED",
      field: "actionAttempt.affordanceId",
      message: "世界在执行时发现该经营动作的实时条件不再成立；没有账目、物件或服务状态被改写。",
      evidence: { affordanceId: selectedAffordance.id, affordanceType: selectedAffordance.type },
    }];
    return result;
  }
  const preflightFailures = deepClone(action.actionAttemptFailures || []);
  result.status = preflightFailures.length ? "partial" : "success";
  result.visibleOutcome = action.visibleAction || selectedAffordance.canonicalVisibleAction || "";
  result.objectOperations = deepClone(material.objectOperations || []);
  result.committedFacts = [
    { kind: "affordance_transition", affordanceId: selectedAffordance.id, affordanceType: selectedAffordance.type, visitId: selectedAffordance.visitId || "" },
    ...(material.objectOperations || []).map((operation) => ({ kind: "object_ledger_transition", objectId: operation.objectId || "", operationType: operation.type || "" })),
  ];
  result.violations = preflightFailures;
  result.failureCodes = [...new Set(preflightFailures.map((violation) => violation.code).filter(Boolean))];
  result.movementCommitted = Boolean(selectedAffordance.moveToZoneId && action.moveToZoneId === selectedAffordance.moveToZoneId);
  return result;
}

function settleSharedActivityOperation(runtime = {}, action = {}) {
  const operation = action.sharedActivity || {};
  const kind = text(operation.operation, 40);
  if (!kind || kind === "none") return null;
  try {
    const outwardAttempt = action.actionAttempt?.primitive && action.actionAttempt.primitive !== "none";
    if (!action.speech && !action.visibleAction && !outwardAttempt) {
      const error = new Error("A shared-activity operation needs an outwardly perceivable proposal, response, coordination, or withdrawal.");
      error.code = "SHARED_ACTIVITY_OPERATION_NOT_EXPRESSED";
      throw error;
    }
    if (kind === "propose") {
      const participantIds = [...new Set([action.actorId, ...(operation.participantIds || [])].filter(Boolean))];
      if (action.targetCharacterId && !participantIds.includes(action.targetCharacterId)) {
        const error = new Error("The publicly addressed participant is missing from the shared-activity proposal.");
        error.code = "SHARED_ACTIVITY_TARGET_NOT_PARTICIPANT";
        throw error;
      }
      if (participantIds.some((characterId) => !runtime.agents?.[characterId]?.present)) {
        const error = new Error("A proposed participant is not present for this shared-activity proposal.");
        error.code = "SHARED_ACTIVITY_PARTICIPANT_NOT_PRESENT";
        throw error;
      }
      if ((runtime.sharedActivities || []).some((row) => row.activityId === operation.activityId && !["completed", "abandoned", "refused"].includes(row.status))) {
        const error = new Error("A live shared activity already uses this id.");
        error.code = "SHARED_ACTIVITY_ID_COLLISION";
        throw error;
      }
      const activity = createCharacterSharedActivityProposal({
        activityId: operation.activityId,
        kind: operation.kind,
        initiatorId: action.actorId,
        participantIds: participantIds.length > 1 ? participantIds : [action.targetCharacterId],
        requestedZoneId: operation.requestedZoneId,
        boundaries: operation.boundaries,
        sourceActionId: action.id,
      });
      runtime.sharedActivities.push(activity);
      return { status: "success", activity, accessGrant: null };
    }
    const index = (runtime.sharedActivities || []).findIndex((row) => row.activityId === operation.activityId);
    if (index < 0) {
      const error = new Error("The referenced shared activity does not exist.");
      error.code = "SHARED_ACTIVITY_NOT_FOUND";
      throw error;
    }
    const current = runtime.sharedActivities[index];
    if (kind === "respond") {
      const activity = applyCharacterSharedActivityResponse(current, {
        responderId: action.actorId,
        response: operation.response,
        sourceActionId: action.id,
        counter: {
          kind: operation.kind,
          requestedZoneId: operation.requestedZoneId,
          boundaries: operation.boundaries || {},
        },
      });
      runtime.sharedActivities[index] = activity;
      return { status: "success", activity, accessGrant: null };
    }
    if (kind === "coordinate") {
      if (!current.participantIds?.includes(action.actorId) || !["accepted", "coordinating"].includes(current.status)) {
        const error = new Error("Only a participant in an accepted shared activity may coordinate it.");
        error.code = "SHARED_ACTIVITY_COORDINATION_NOT_READY";
        throw error;
      }
      const zoneId = text(operation.requestedZoneId || current.requestedZoneId, 80);
      let accessGrant = null;
      const standing = runtime.agents?.[action.actorId]?.standing || "";
      const canGrantVenueAccess = ["manager", "proprietor", "household_worker"].includes(standing);
      if (zoneId && canGrantVenueAccess) {
        accessGrant = createScopedCharacterAccessGrant({
          grantId: `access:${current.activityId}:${runtime.step}`,
          grantorId: action.actorId,
          authorizedGrantorIds: [action.actorId],
          beneficiaryIds: current.participantIds.filter((id) => id !== action.actorId),
          zoneIds: [zoneId],
          activity: current,
          issuedAtStep: runtime.step,
          expiresAtStep: runtime.step + 4,
        });
        runtime.accessGrants.push(accessGrant);
      }
      const activity = {
        ...deepClone(current),
        status: "coordinating",
        requestedZoneId: zoneId || current.requestedZoneId,
        accessGrantIds: [...new Set([...(current.accessGrantIds || []), accessGrant?.grantId].filter(Boolean))],
        sourceActionIds: [...new Set([...(current.sourceActionIds || []), action.id])],
      };
      runtime.sharedActivities[index] = activity;
      return { status: "success", activity, accessGrant };
    }
    if (kind === "withdraw") {
      if (!current.participantIds?.includes(action.actorId)) {
        const error = new Error("Only a participant may withdraw from a shared activity.");
        error.code = "SHARED_ACTIVITY_WITHDRAWAL_NOT_OWNED";
        throw error;
      }
      const activity = {
        ...deepClone(current),
        status: "abandoned",
        withdrawnByCharacterId: action.actorId,
        sourceActionIds: [...new Set([...(current.sourceActionIds || []), action.id])],
      };
      runtime.sharedActivities[index] = activity;
      return { status: "success", activity, accessGrant: null };
    }
    const error = new Error("Unknown shared activity operation.");
    error.code = "SHARED_ACTIVITY_OPERATION_INVALID";
    throw error;
  } catch (error) {
    return {
      status: "failed",
      code: error.code || "SHARED_ACTIVITY_OPERATION_FAILED",
      message: error.message,
      activity: null,
      accessGrant: null,
    };
  }
}

function actionDuration(decision, { respondingToLiveThread = false, selectedAffordance = null } = {}) {
  const speechLength = text(decision.utterance?.literalSpeech || decision.speech, 240).replace(/\s+/g, "").length;
  const speechSeconds = speechLength
    ? Math.max(respondingToLiveThread ? 1 : 2, Math.min(respondingToLiveThread ? 8 : 12, Math.ceil(speechLength / 5) + 1))
    : 0;
  const intendedGesture = decision.embodiedIntent?.intendedGesture || decision.visibleAction;
  const gestureSeconds = intendedGesture ? Math.max(2, Math.min(10, Math.ceil(text(intendedGesture, 240).length / 8))) : 0;
  const movementSeconds = (decision.actionAttempt?.destinationId || decision.moveToZoneId) ? 10 : 0;
  const worldOperationSeconds = ({
    start_service_preparation: 7,
    interrupt_service_preparation: 3,
    resume_service_preparation: 5,
    finish_service_preparation: 6,
    serve_guest: 4,
    serve_work_meal: 4,
  })[selectedAffordance?.type] || 0;
  if (movementSeconds) return Math.max(movementSeconds, speechSeconds + Math.min(4, gestureSeconds));
  if (speechSeconds || gestureSeconds || worldOperationSeconds) return Math.max(1, worldOperationSeconds, speechSeconds + gestureSeconds);
  return 3;
}

async function emit(onEvent, event) {
  if (typeof onEvent === "function") await onEvent(deepClone(event));
}

function observePendingImpacts(runtime, actorId) {
  const actor = runtime.agents[actorId];
  const pending = (actor.currentNoticedDeliveries || []).filter((delivery) => delivery.processedAtStep == null)
    .sort((a, b) => b.impactScore - a.impactScore);
  for (const delivery of pending) {
    if (delivery.seenAtStep == null) delivery.seenAtStep = runtime.step;
  }
  return pending;
}

function markSelectedImpactHandled(runtime, actorId, impactId) {
  if (!impactId) return false;
  const delivery = (runtime.agents?.[actorId]?.inbox || []).find((item) => item.impactId === impactId && item.processedAtStep == null);
  if (!delivery) return false;
  delivery.processedAtStep = runtime.step;
  delivery.handledAtStep = runtime.step;
  return true;
}

function seedSceneImpacts(state, runtime, seedImpacts = []) {
  const seeds = [...seedImpacts];
  if (text(state.ui?.injectedEvent)) {
    seeds.push({
      id: stableImpactId("impact_injected", state.ui.injectedEvent, state.ui?.eventImpact || 72),
      sourceCharacterId: "world:injected-event",
      sourceZoneId: "hall",
      type: "physical",
      modality: "sound",
      intensity: clamp(state.ui?.eventImpact || 72, 45, 95),
      radius: 3,
      content: text(state.ui.injectedEvent, 240),
    });
  }
  const newlyArrivedVisitorIds = new Set(seeds
    .filter((seed) => seed.publicEvent === true && seed.publicEventKind === "arrival")
    .map((seed) => seed.sourceCharacterId)
    .filter(Boolean));
  for (const visit of state.tavernState?.activeVisits || []) {
    const visitor = runtime.agents?.[visit.visitorId];
    if (!visitor?.present) continue;
    if (["completed", "refused", "abandoned"].includes(visit.stage)) {
      const visitorName = visit.visitorName || visitor.characterName;
      const zoneLabel = runtime.topology?.zones?.[visitor.zoneId]?.label || "原处";
      seeds.push({
        id: stableImpactId("impact_visit_transaction_complete", visit.id || visit.visitorId, visit.stage, visit.purpose),
        sourceCharacterId: visit.visitorId,
        sourceZoneId: visitor.zoneId,
        type: "service",
        modality: "visual",
        intensity: 38,
        radius: 2,
        directedTargetId: "",
        content: `${visitorName}在酒馆内的交割和账目已经办清，人仍留在${zoneLabel}。`,
        topic: `${visitorName}的酒馆交易已清`,
        publicEvent: true,
        publicEventKind: "active_visit_context",
        surfaceEvent: `${visitorName}在酒馆内的交割和账目已经办清，人仍留在${zoneLabel}。`,
        provenance: { kind: "firsthand", sourceImpactIds: [] },
      });
      continue;
    }
    const purposeDeclared = visit.purposeStatus === "declared" || visit.purposeDisclosureStatus === "declared";
    const selfDirectedVisit = visit.selfDirected === true || visit.kind === "self_directed";
    const zoneLabel = runtime.topology?.zones?.[visitor.zoneId]?.label || "原处";
    const visitorName = visit.visitorName || visitor.characterName;
    const publicPresenceCue = tavernPublicVisitPresenceCue(state, visit, {
      zoneId: visitor.zoneId,
      zoneLabel,
    });
    const publicContext = selfDirectedVisit
      ? `${visitorName}${publicPresenceCue}；尚未向任何人建立必须回应或结算的事务。`
      : purposeDeclared
      ? `${visitorName}${publicPresenceCue}，已经说明${visit.purpose || "自己的来意"}，还在等店里能作主的人回应。`
      : `${visitorName}${publicPresenceCue}，来意还没有亲口说明。`;
    seeds.push({
      id: stableImpactId("impact_visit", visit.id || visit.visitorId, visit.stage, visit.purpose || visit.requestedService),
      sourceCharacterId: visit.visitorId,
      sourceZoneId: visitor.zoneId,
      type: "service",
      modality: "visual",
      intensity: visit.stage === "waiting" ? 78 : 62,
      radius: 2,
      directedTargetId: selfDirectedVisit
        ? ""
        : visit.hostId || visit.expectedHostIds?.find((id) => runtime.agents?.[id]?.present) || "",
      content: selfDirectedVisit
        ? `${visitorName}${publicPresenceCue}，正在自行观察或决定下一步。`
        : purposeDeclared
        ? `${visitorName}已经说明${visit.purpose || "来意"}，正在${zoneLabel}等店里能作主的人回应。`
        : `${visitorName}${publicPresenceCue}，来意尚未亲口说明。`,
      topic: selfDirectedVisit
        ? "来客正在自主决定行动"
        : purposeDeclared ? visit.purpose || "已说明的来客事务" : "来客尚未说明来意",
      publicEvent: !newlyArrivedVisitorIds.has(visit.visitorId),
      publicEventKind: "active_visit_context",
      surfaceEvent: publicContext,
      provenance: { kind: "firsthand", sourceImpactIds: [] },
    });
  }
  for (const thread of state.tavernState?.eventThreads || []) {
    if (thread.status !== "open" || !thread.nextObligationCharacterId || !runtime.agents?.[thread.nextObligationCharacterId]?.present) continue;
    const lastTurn = [...(thread.turns || [])].reverse().find((turn) => turn.line) || null;
    const sourceId = lastTurn?.speakerId || thread.participantIds?.find((id) => id !== thread.nextObligationCharacterId) || "world:unfinished-business";
    const sourceZoneId = runtime.agents[thread.nextObligationCharacterId].zoneId;
    seeds.push({
      id: stableImpactId("impact_thread", thread.id, lastTurn?.turnId || lastTurn?.id || lastTurn?.line || thread.topic),
      sourceCharacterId: sourceId,
      sourceZoneId,
      type: "memory_obligation",
      modality: "memory",
      intensity: 82,
      radius: 0,
      directedTargetId: thread.nextObligationCharacterId,
      content: lastTurn?.line
        ? `你记得${lastTurn?.speakerName || "对方"}在${lastTurn?.slotLabel || "先前"}说过：“${lastTurn.line}”`
        : `你记得这件未完事务仍在等自己的回应：${thread.topic || "未命名事务"}。`,
      topic: thread.topic || "未完事务",
      provenance: {
        kind: "memory",
        sourceImpactIds: [],
        sourceThreadId: thread.id,
        responseToTurnId: lastTurn?.turnId || lastTurn?.id || "",
        responseSourceLine: lastTurn?.line || "",
        responseSourceSlotId: lastTurn?.slotId || thread.openedSlot || "",
        responseSourceSlotLabel: lastTurn?.slotLabel || "先前",
      },
    });
  }
  return seeds.map((impact) => createImpactFactor(
    { ...impact, locationId: impact.locationId || runtime.locationId, createdAtSeconds: 0 },
    { responsibilityRules: runtime.topology?.responsibilityRules || [] },
  ));
}

export function publicCommittedAction(action = {}) {
  const copy = deepClone(action);
  copy.commitmentTopic = copy.publicTopic || "";
  copy.semanticFrame = deepClone(copy.publicSemanticFrame || null);
  copy.semanticFrameId = copy.semanticFrame?.id || "";
  copy.semanticRoleBindings = deepClone(copy.semanticFrame?.roles || {});
  delete copy.publicTopic;
  delete copy.publicSemanticFrame;
  delete copy.privateReason;
  delete copy.goalPreservation;
  delete copy.cognitiveAppraisalAuthority;
  delete copy.relationshipAppraisalAuthority;
  delete copy.communicationPlan;
  delete copy.communicationPlanAuthority;
  delete copy.speechRealizationPlan;
  delete copy.speechRealizationPlanAuthority;
  delete copy.epistemicQuestionAudit;
  delete copy.epistemicDiagnostics;
  delete copy.embodiedIntent;
  delete copy.embodiedIntentAuthority;
  delete copy.actionAttemptAuthority;
  delete copy.utteranceAuthority;
  delete copy.speakerThreadDisposition;
  delete copy.threadDisposition;
  delete copy.threadSettlementEligible;
  delete copy.postChoiceContinuity;
  delete copy.postChoiceContinuityAuthority;
  delete copy.realizedSpeechHabitIds;
  delete copy.continuitySettlement;
  delete copy.privateProposalDiagnostics;
  if (copy.sharedActivityResolution) {
    copy.sharedActivityTransition = {
      status: copy.sharedActivityResolution.status || "",
      code: copy.sharedActivityResolution.code || "",
      operation: copy.sharedActivity?.operation || "none",
      activityId: copy.sharedActivityResolution.activity?.activityId || copy.sharedActivity?.activityId || "",
      activityStatus: copy.sharedActivityResolution.activity?.status || "",
      accessGrantId: copy.sharedActivityResolution.accessGrant?.grantId || "",
    };
  }
  delete copy.sharedActivity;
  delete copy.sharedActivityResolution;
  return copy;
}

function publicSceneRuntime(runtime) {
  const copy = deepClone(runtime);
  delete copy.worldSignalValidationIssues;
  delete copy.eventReceipts;
  delete copy.eventAppraisals;
  delete copy.cognitiveAppraisals;
  delete copy.relationshipAppraisals;
  delete copy.threadAppraisals;
  delete copy.participantThreadStates;
  delete copy.continuitySettlements;
  for (const agent of Object.values(copy.agents || {})) {
    if (agent.attentionFocus) {
      agent.attentionTargetId = "";
    }
    delete agent.attentionFocus;
    delete agent.publicSignalFeatures;
    delete agent.privateState;
    delete agent.ecologyState;
    delete agent.ecologySceneStartSeconds;
    delete agent.memoryState;
  }
  copy.actions = (copy.actions || []).map(publicCommittedAction);
  return copy;
}

function commitCharacterCognitiveAppraisal(workingState, runtime, actor, decision, input) {
  if (decision.cognitiveAppraisalAuthority !== "character-agent") return null;
  const character = characterById(workingState, actor.characterId);
  if (!character) return null;
  const current = actor.memoryState || character.agentMemory || createCharacterAgentMemoryState(actor.characterId);
  const allowedEvidenceIds = [...ownedCognitiveEvidenceIds(input)];
  const nowSeconds = memoryClockSeconds(runtime);
  const base = applyCharacterCognitiveAppraisal(current, decision.cognitiveAppraisal, {
    allowedEvidenceIds,
    nowSeconds,
  });
  let nextMemory = base.memory;
  const specializedUpdates = {
    entityModels: [],
    locationBeliefs: [],
    sourceKnowledgeBeliefs: [],
  };
  const specializedViolations = [];
  if (base.valid) {
    for (const update of decision.cognitiveAppraisal?.entityModelUpdates || []) {
      const result = applyCharacterPrivateEntityModelUpdate(nextMemory, update, { allowedEvidenceIds, nowSeconds });
      specializedUpdates.entityModels.push({ valid: result.valid, update: deepClone(result.update), model: deepClone(result.model) });
      if (!result.valid) specializedViolations.push(...(result.violations || []));
      else nextMemory = result.memory;
    }
    for (const update of decision.cognitiveAppraisal?.locationBeliefUpdates || []) {
      const result = applyCharacterLocationBeliefUpdate(nextMemory, update, { allowedEvidenceIds, nowSeconds });
      specializedUpdates.locationBeliefs.push({ valid: result.valid, update: deepClone(result.update), belief: deepClone(result.belief) });
      if (!result.valid) specializedViolations.push(...(result.violations || []));
      else nextMemory = result.memory;
    }
    for (const update of decision.cognitiveAppraisal?.sourceKnowledgeBeliefUpdates || []) {
      const result = applyCharacterSourceKnowledgeBeliefUpdate(nextMemory, update, { allowedEvidenceIds, nowSeconds });
      specializedUpdates.sourceKnowledgeBeliefs.push({ valid: result.valid, update: deepClone(result.update), belief: deepClone(result.belief) });
      if (!result.valid) specializedViolations.push(...(result.violations || []));
      else nextMemory = result.memory;
    }
  }
  const valid = base.valid && specializedViolations.length === 0;
  const violations = [...(base.violations || []), ...specializedViolations];
  const trace = {
    schemaVersion: 1,
    visibility: "observer-only",
    excludedFromOtherAgentMemory: true,
    authority: "character-agent",
    characterId: actor.characterId,
    valid,
    appraisal: deepClone(decision.cognitiveAppraisal),
    specializedUpdates: deepClone(specializedUpdates),
    violations: deepClone(violations),
    appliedAtSeconds: Number(runtime.elapsedSeconds || 0),
  };
  runtime.cognitiveAppraisals.push(trace);
  if (!valid) return trace;
  actor.memoryState = deepClone(nextMemory);
  character.agentMemory = deepClone(nextMemory);
  return trace;
}

function threadPressureForAppraisal(appraisal = {}) {
  const responsePressure = { none: 0.08, low: 0.28, medium: 0.55, high: 0.82 }[appraisal.responseNeed] ?? 0.2;
  if (appraisal.selfClosure === "closed_for_self") return Math.min(responsePressure, 0.12);
  if (appraisal.satisfaction === "unsatisfied") return Math.max(responsePressure, 0.62);
  if (appraisal.satisfaction === "satisfied") return Math.min(responsePressure, 0.24);
  return responsePressure;
}

function commitCharacterOwnedThreadAppraisal(workingState, runtime, actor, decision, input) {
  if (decision.cognitiveAppraisalAuthority !== "character-agent") return [];
  const ownedThreadIds = new Set((input.openConversationThreads || []).map((thread) => thread.id).filter(Boolean));
  if (input.activation?.sourceThreadId) ownedThreadIds.add(input.activation.sourceThreadId);
  const traces = [];
  for (const appraisal of decision.cognitiveAppraisal?.threadAppraisals || []) {
    if (!ownedThreadIds.has(appraisal.threadId)) continue;
    const owned = ensureRuntimeParticipantThreadState(runtime, appraisal.threadId, actor.characterId);
    if (!owned) continue;
    Object.assign(owned, {
      schemaVersion: 1,
      threadId: appraisal.threadId,
      characterId: actor.characterId,
      processingStatus: "appraised",
      perceivedDisposition: appraisal.interpretation,
      satisfaction: appraisal.satisfaction,
      responseNeed: appraisal.responseNeed,
      selfClosure: appraisal.selfClosure,
      lastAppraisedTurnId: appraisal.sourceTurnId || owned.lastReceivedTurnId || "",
      pressure: threadPressureForAppraisal(appraisal),
      summary: appraisal.summary || "",
      authority: "character-agent",
    });
    const persisted = (workingState.tavernState?.eventThreads || []).find((thread) => thread.id === appraisal.threadId);
    if (persisted) {
      persisted.participantStates ||= {};
      persisted.participantStates[actor.characterId] = deepClone(owned);
    }
    const trace = {
      schemaVersion: 1,
      visibility: "observer-only",
      excludedFromOtherAgentInputs: true,
      authority: "character-agent",
      characterId: actor.characterId,
      threadId: appraisal.threadId,
      sourceTurnId: appraisal.sourceTurnId || "",
      appraisal: deepClone(appraisal),
      participantState: deepClone(owned),
      appliedAtSeconds: Number(runtime.elapsedSeconds || 0),
    };
    runtime.threadAppraisals.push(trace);
    traces.push(trace);
  }
  return traces;
}

function commitActorEcology(workingState, runtime, actor, selected, decision, action = null, material = null) {
  const character = characterById(workingState, actor.characterId);
  if (!character || !selected.ecology?.state || !selected.ecology?.selectedIntent) return;
  const selectedIntent = selected.ecology.selectedIntent || null;
  const evaluation = selected.ecology.appraisal?.selectedCandidate || {};
  const selectedDriveId = selectedIntent?.driveId || "";
  const persistentDriveId = selectedDriveId && selected.ecology.state.desires?.[selectedDriveId]
    ? selectedDriveId
    : "";
  const outcomeCandidate = selectedIntent ? {
    ...selectedIntent,
    driveId: persistentDriveId,
    desireId: persistentDriveId,
  } : {};
  const outcomeEvaluation = {
    ...evaluation,
    driveId: persistentDriveId,
    desireId: persistentDriveId,
    desirePressure: evaluation.desirePressure ? {
      ...evaluation.desirePressure,
      desireId: persistentDriveId,
    } : evaluation.desirePressure,
  };
  const actionKind = decision.actionType === "pass"
    ? "pass"
    : decision.commitmentAction === "defer" ? "defer"
      : selectedIntent?.actionKind || decision.actionType;
  const worldStatus = action?.worldResolution?.status || (action ? "success" : "not_attempted");
  const outwardCommitted = Boolean(action?.speech) || ["success", "partial"].includes(worldStatus);
  const consumedOfferingId = material?.affordance?.type === "consume_service"
    ? material.affordance.offeringId || ""
    : "";
  const consumedOffering = consumedOfferingId
    ? material?.affordance?.offering
      || workingState.tavernState?.institution?.offerings?.[consumedOfferingId]
      || {}
    : {};
  const consumedKind = consumedOfferingId ? offeringServiceKind(consumedOffering, consumedOfferingId) : "";
  const consumedSustenance = consumedOfferingId
    ? normalizeOfferingSustenance(consumedOffering, consumedOfferingId)
    : null;
  const committedAction = {
    ...(action || {}),
    committed: outwardCommitted,
    actionKind,
    driveId: persistentDriveId,
    candidateId: selectedIntent?.id || "",
    signature: selectedIntent?.runtimeSignature || "",
    targetCharacterId: decision.targetCharacterId || selectedIntent?.targetCharacterId || "",
  };
  const materialConsequence = {
    id: action?.id || `ecology:${actor.characterId}:${runtime.step}`,
    status: worldStatus === "failed" ? "failed" : "committed",
    description: material?.consequence || action?.materialConsequence || (worldStatus === "failed"
      ? `行动尝试失败：${(action?.worldResolution?.failureCodes || []).join("、") || "世界条件不成立"}`
      : ""),
    bodyDemand: deepClone(selectedIntent?.bodyDemand || {}),
    ...(consumedOfferingId
      && worldStatus !== "failed"
      && (consumedKind === "tea" || consumedSustenance?.class === "mundane_drink")
      ? { drinkConsumed: true }
      : {}),
    ...(consumedOfferingId
      && worldStatus !== "failed"
      && (["meal", "work_meal"].includes(consumedKind) || ["mundane_food", "spiritual_food"].includes(consumedSustenance?.class))
      ? { foodConsumed: true }
      : {}),
    ...(consumedSustenance ? { sustenance: consumedSustenance } : {}),
    ...(actionKind === "rest" && worldStatus !== "failed" ? { restCompleted: true } : {}),
    ...(["practice", "affordance_perform_work", "advance_personal_goal"].includes(actionKind) && worldStatus !== "failed" ? { exertionCompleted: true } : {}),
    desireEffects: deriveDesireSatisfactionEffects({
      desires: selected.ecology.profile?.desires || [],
      action: committedAction,
      ownerActorId: actor.characterId,
    }),
  };
  const elapsedSeconds = action
    ? Math.max(0, Number(action.endedAtSeconds || 0) - Number(action.startedAtSeconds || 0))
    : 0;
  const next = applyTavernEcologyOutcome({
    ecologyState: selected.ecology.state,
    selectedCandidate: outcomeCandidate,
    evaluation: outcomeEvaluation,
    action: committedAction,
    materialConsequence,
    elapsedSeconds,
    sustenanceProfile: selected.ecology.profile?.sustenanceProfile || {},
  });
  next.presence = {
    ...(next.presence || {}),
    locationId: decision.actionType === "leave"
      ? selected.ecology.profile?.initialConditions?.locationId || character.currentLocationId || runtime.locationId
      : runtime.locationId,
    zoneId: decision.actionType === "leave"
      ? selected.ecology.profile?.initialConditions?.zoneId || null
      : actor.zoneId,
    observableAtStage: decision.actionType !== "leave",
    arrivedAtSecond: decision.actionType === "leave" ? null : next.presence?.arrivedAtSecond ?? next.elapsedSeconds,
  };
  actor.ecologyState = deepClone(next);
  actor.privateState.ecologyState = deepClone(next);
  character.ecologyState = deepClone(next);
  if (selected.ecology.selectedDesire?.want) actor.currentIntention = selected.ecology.selectedDesire.want;
}

function commitCharacterVoiceHabitUsage(workingState, runtime, actor, decision, action, characterAgentV2Result) {
  if (!action?.speech || !characterAgentV2Result) return null;
  const foundation = characterAgentV2Result.session?.privateContext?.voiceContract?.voiceFoundation;
  if (!foundation?.habits?.length) return null;
  const character = characterById(workingState, actor.characterId);
  if (!character) return null;
  const ecologyState = deepClone(actor.ecologyState || character.ecologyState || {});
  const nextHistory = recordCommittedSpeechHabitUse(ecologyState.voiceHabitUsage || [], {
    actionId: action.id,
    characterId: actor.characterId,
    committed: action.committed === true,
    turnIndex: runtime.step,
    realizedHabitIds: decision.realizedSpeechHabitIds || [],
  }, { foundation });
  ecologyState.voiceHabitUsage = nextHistory;
  actor.ecologyState = ecologyState;
  actor.privateState.ecologyState = deepClone(ecologyState);
  character.ecologyState = deepClone(ecologyState);
  return deepClone(nextHistory.at(-1) || null);
}

function normalizedWorldSignificance(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
}

function continuityWorldOutcome(action = {}, material = null, impacts = []) {
  const evidenceIds = new Set([action.id].filter(Boolean));
  for (const impact of impacts || []) if (impact?.id) evidenceIds.add(impact.id);
  collectContinuityIds(action.satisfactionEvidence, evidenceIds);
  collectContinuityIds(material?.satisfactionEvidence, evidenceIds);
  collectContinuityIds(material?.objectOperations, evidenceIds);
  collectContinuityIds(action.worldResolution?.committedFacts, evidenceIds);
  const worldStatus = action.worldResolution?.status || "success";
  const significance = Math.max(
    0.24,
    normalizedWorldSignificance(action.semanticFrame?.importance),
    action.decisionValue && action.decisionValue !== "none" ? 0.62 : 0,
    action.commitmentAction && action.commitmentAction !== "none" ? 0.58 : 0,
    action.actionType === "leave" ? 0.5 : 0,
    material ? 0.55 : 0,
    worldStatus === "failed" ? 0.42 : 0,
    impacts.length ? 0.36 : 0,
  );
  return {
    committed: action.committed === true,
    resolutionStatus: worldStatus,
    failureCodes: [...(action.worldResolution?.failureCodes || [])],
    significance,
    evidenceIds: [...evidenceIds],
  };
}

function commitActorPostChoiceContinuity(
  workingState,
  runtime,
  actor,
  input,
  selected,
  decision,
  action,
  material,
  impacts,
) {
  if (!decision.postChoiceContinuity || action.committed !== true) return null;
  if (decision.postChoiceContinuityAuthority === "character-agent:rejected") {
    const continuityDiagnostics = (decision.privateProposalDiagnostics || [])
      .filter((diagnostic) => diagnostic.layer === "postChoiceContinuity");
    const summary = {
      schemaVersion: 1,
      status: "proposal_rejected",
      actionMemory: null,
      desireSettlements: [],
      dynamicStateSettlements: [],
      selfNarrativeOutcome: null,
      errorCodes: continuityDiagnostics.map((diagnostic) => diagnostic.code),
    };
    action.continuitySettlement = summary;
    runtime.continuitySettlements = [
      ...(runtime.continuitySettlements || []),
      { actionId: action.id, characterId: actor.characterId, ...deepClone(summary) },
    ];
    return null;
  }
  const character = characterById(workingState, actor.characterId);
  if (!character || !actor.ecologyState) return null;
  const chosenCandidate = (input.privateActionCandidates || [])
    .find((candidate) => candidate.candidateId === decision.candidateId) || {};
  const validationContext = continuityValidationContextForInput(input, chosenCandidate);
  const settlement = settleCharacterPostChoiceContinuity({
    characterId: actor.characterId,
    proposal: decision.postChoiceContinuity,
    action,
    worldOutcome: continuityWorldOutcome(action, material, impacts),
    memoryState: actor.memoryState || character.agentMemory || createCharacterAgentMemoryState(actor.characterId),
    ecologyState: actor.ecologyState,
    dynamicState: actor.ecologyState.dynamicPsychology || {},
    nowSeconds: memoryClockSeconds(runtime),
    validationContext,
  });
  const nextEcology = {
    ...deepClone(settlement.ecologyState),
    dynamicPsychology: deepClone(settlement.dynamicState),
  };
  actor.memoryState = deepClone(settlement.memoryState);
  character.agentMemory = deepClone(settlement.memoryState);
  actor.ecologyState = nextEcology;
  actor.privateState.ecologyState = deepClone(nextEcology);
  character.ecologyState = deepClone(nextEcology);
  const summary = {
    schemaVersion: settlement.schemaVersion,
    status: settlement.status,
    actionMemory: deepClone(settlement.actionMemory),
    desireSettlements: deepClone(settlement.desireSettlements),
    dynamicStateSettlements: deepClone(settlement.dynamicStateSettlements),
    selfNarrativeOutcome: deepClone(settlement.selfNarrativeOutcome),
    errorCodes: (settlement.errors || []).map((entry) => entry.code),
  };
  action.continuitySettlement = summary;
  runtime.continuitySettlements = [
    ...(runtime.continuitySettlements || []),
    { actionId: action.id, characterId: actor.characterId, ...deepClone(summary) },
  ];
  return settlement;
}

function bindSelectedCharacterChoice(selected = {}, decision = {}, actor = {}) {
  if (!decision.candidateId || !selected.ecology) return selected;
  const ecology = bindTavernAgentEcologyChoice(selected.ecology, decision.candidateId);
  if (!ecology) return selected;
  const realization = ecology.selectedIntent?.realization || {};
  const candidateImpactId = realization.responseSourceImpactId || realization.observationSourceImpactId || "";
  const candidateDelivery = candidateImpactId
    ? (actor.inbox || []).find((delivery) => delivery.impactId === candidateImpactId && delivery.processedAtStep == null) || null
    : null;
  const inheritedDelivery = selected.sourceImpactId
    ? (actor.inbox || []).find((delivery) => delivery.impactId === selected.sourceImpactId) || null
    : null;
  const appraisedEvidenceIds = new Set(decision.cognitiveAppraisal?.noticedEvidenceIds || []);
  const inheritedEvidenceWasAppraised = Boolean(inheritedDelivery && [
    inheritedDelivery.noticedEvidenceId,
    inheritedDelivery.noticedProjection?.evidenceId,
  ].filter(Boolean).some((evidenceId) => appraisedEvidenceIds.has(evidenceId)));
  const actionTargetsInheritedSource = Boolean(
    inheritedDelivery?.sourceCharacterId
    && decision.targetCharacterId === inheritedDelivery.sourceCharacterId
  );
  const inheritedImpactId = inheritedEvidenceWasAppraised && actionTargetsInheritedSource
    ? selected.sourceImpactId || ""
    : "";
  return {
    ...selected,
    ecology,
    sourceImpactId: candidateImpactId
      ? (candidateDelivery?.impactId || candidateImpactId)
      : inheritedImpactId,
    deliveryId: candidateImpactId
      ? (candidateDelivery?.id || "")
      : inheritedImpactId ? inheritedDelivery?.id || "" : "",
  };
}

function bindSelectedCharacterChoiceV2(selected = {}, decision = {}, actor = {}, authoritativeInput = {}, bridge = {}) {
  if (!decision.candidateId) return selected;
  const candidate = (authoritativeInput.privateActionCandidates || [])
    .find((row) => row.candidateId === decision.candidateId) || null;
  if (!candidate) return selected;
  const previousEcology = selected.ecology || {};
  const selectedIntent = {
    ...deepClone(candidate),
    id: candidate.candidateId,
    runtimeSignature: `character-agent-v2:${candidate.candidateId}`,
    targetCharacterId: decision.targetCharacterId || candidate.targetCharacterId || "",
    bodyDemand: deepClone(candidate.bodyDemand || {}),
  };
  const selectedEvaluation = {
    ...deepClone(bridge.selectedEvaluation || {}),
    candidateId: candidate.candidateId,
    driveId: candidate.driveId || "",
    desireId: candidate.driveId || "",
  };
  return {
    ...selected,
    ecology: {
      ...deepClone(previousEcology),
      profile: deepClone(previousEcology.profile || actor.ecologyProfile || { desires: [] }),
      state: deepClone(previousEcology.state || actor.ecologyState || {}),
      selectedIntent,
      appraisal: {
        ...deepClone(previousEcology.appraisal || {}),
        selectedCandidate: selectedEvaluation,
        selectionAuthority: "character-agent-v2",
      },
    },
    characterAgentProtocolVersion: 2,
  };
}

function attachV2WorldOutcome(result = null, action = null, status = "not_attempted") {
  if (!result?.session) return null;
  const worldOutcome = {
    authority: "world-resolution",
    outcomeId: action?.id || `world-outcome:${result.session.agentTurnId}`,
    status: action?.worldResolution?.status || status,
    committed: Boolean(action?.committed),
    visibleOutcome: action?.worldResolution?.visibleOutcome || action?.visibleAction || "",
    movementCommitted: Boolean(action?.worldResolution?.movementCommitted),
    failureCodes: deepClone(action?.worldResolution?.failureCodes || []),
    committedFacts: deepClone(action?.worldResolution?.committedFacts || []),
  };
  return attachCharacterAgentWorldOutcome(result.session, worldOutcome);
}

function commitCharacterPsychologyV2Carryover(workingState, runtime = {}, actor = {}, result = null, objectiveOutcome = null) {
  if (!result?.session?.psychologySnapshot || !result?.session?.regulationOutcome) return null;
  const character = characterById(workingState, actor.characterId);
  if (!character) return null;
  const ecologyState = deepClone(actor.ecologyState || character.ecologyState || {});
  const selectedCandidateId = result.session.agentChoice?.selectedCandidateId || "";
  const selectedCandidate = (result.session.generatedCandidates || [])
    .find((row) => row.candidateId === selectedCandidateId) || null;
  const selectedEvaluation = (result.session.candidateEvaluation?.evaluations || [])
    .find((row) => row.candidateId === selectedCandidateId) || null;
  const next = advanceCharacterPsychologyCarryover({
    previous: ecologyState.characterPsychologyV2State || {},
    snapshot: result.session.psychologySnapshot,
    regulationOutcome: result.session.regulationOutcome,
    profile: result.session.privateContext?.profile || {},
    objectiveOutcome,
    selectedCandidate,
    selectedEvaluation,
    agentChoice: result.session.agentChoice || {},
    worldTimeSeconds: Number(actor.ecologySceneStartSeconds || 0) + Number(runtime.elapsedSeconds || 0),
  });
  ecologyState.characterPsychologyV2State = deepClone(next);
  actor.ecologyState = ecologyState;
  actor.privateState ||= {};
  actor.privateState.ecologyState = deepClone(ecologyState);
  character.ecologyState = deepClone(ecologyState);
  return next;
}

function commitRecipientEcologyEvidence(workingState, runtime, action) {
  const recipientIds = [...new Set((action.deliveries || [])
    .filter((delivery) => ["sound", "hearing", "direct_speech"].includes(delivery.modality || delivery.channel))
    .map((delivery) => delivery.recipientId)
    .filter(Boolean))];
  for (const recipientId of recipientIds) {
    const character = characterById(workingState, recipientId);
    const agent = runtime.agents?.[recipientId];
    const ecologyState = character?.ecologyState || agent?.ecologyState;
    const profile = getTavernEcologyProfile(characterById(workingState, recipientId));
    if (!character || !ecologyState || !profile) continue;
    const desireEffects = deriveDesireSatisfactionEffects({
      desires: profile.desires || [],
      action,
      ownerActorId: recipientId,
    });
    if (!desireEffects.length) continue;
    const next = applyTavernEcologyOutcome({
      ecologyState,
      action: {
        committed: true,
        actionKind: "receive_verified_outcome",
        candidateId: `received:${action.id}`,
        targetCharacterId: action.actorId,
      },
      materialConsequence: {
        id: `received:${action.id}`,
        status: "committed",
        desireEffects,
      },
      elapsedSeconds: 0,
    });
    character.ecologyState = deepClone(next);
    if (agent) {
      agent.ecologyState = deepClone(next);
      agent.privateState.ecologyState = deepClone(next);
    }
  }
}

function defaultDirectedRelationship(workingState, fromCharacterId, toCharacterId) {
  const from = characterById(workingState, fromCharacterId);
  const to = characterById(workingState, toCharacterId);
  return {
    id: createId("rel"),
    projectId: workingState.project?.id || "",
    fromCharacterId,
    toCharacterId,
    label: `${from?.name || fromCharacterId}对${to?.name || toCharacterId}的现场判断`,
    ...Object.fromEntries(TAVERN_RELATIONSHIP_METRICS.map((metric) => [metric, ["jealousy", "revenge", "wantsToPossess", "wantsToDestroy"].includes(metric) ? 0 : 10])),
    misreading: "",
    unspoken: "",
    evidenceIds: [],
  };
}

function commitRelationshipAppraisalToOwnedMemory(workingState, runtime, actor, proposal, sourceImpacts) {
  if (!["provisional", "retained"].includes(proposal.changeMode)) return null;
  const character = characterById(workingState, actor.characterId);
  if (!character) return null;
  const memoryState = normalizeCharacterAgentMemoryState(actor.memoryState || character.agentMemory || {}, actor.characterId);
  const sourceImpactIds = [...new Set(proposal.sourceImpactIds || [])];
  const sourceEpisodeIds = (memoryState.episodes || []).filter((episode) => (
    sourceImpactIds.includes(episode.sourceImpactId)
    || (episode.sourceImpactIds || []).some((impactId) => sourceImpactIds.includes(impactId))
  )).map((episode) => episode.id);
  let impression = (memoryState.impressions || []).find((row) => row.targetCharacterId === proposal.targetCharacterId) || null;
  if (!impression) {
    impression = {
      id: createId("relationship_impression"),
      ownerCharacterId: actor.characterId,
      targetCharacterId: proposal.targetCharacterId,
      sourceType: "character-agent-lived-appraisal",
      summary: "",
      dimensions: {},
      sourceEpisodeIds: [],
      recentAppraisals: [],
    };
    memoryState.impressions.push(impression);
  }
  impression.sourceEpisodeIds = [...new Set([...(impression.sourceEpisodeIds || []), ...sourceEpisodeIds])].slice(-24);
  impression.recentAppraisals = [...(impression.recentAppraisals || []), {
    id: createId("owned_relationship_appraisal"),
    mode: proposal.changeMode,
    sourceImpactIds,
    dimensionChanges: deepClone(proposal.dimensionChanges || []),
    reason: text(proposal.reason, 220),
    sourceContents: sourceImpacts.map((impact) => text(impact.content, 120)).filter(Boolean),
    appraisedAtSeconds: Number(runtime.elapsedSeconds || 0),
  }].slice(-12);
  const nextMemory = normalizeCharacterAgentMemoryState(memoryState, actor.characterId);
  actor.memoryState = deepClone(nextMemory);
  character.agentMemory = deepClone(nextMemory);
  return impression.id;
}

function commitCharacterOwnedRelationshipAppraisal(workingState, runtime, actor, decision) {
  const proposal = decision.relationshipAppraisal || noOpTavernCharacterRelationshipAppraisal();
  if (decision.relationshipAppraisalAuthority !== "character-agent") return [];
  const sourceImpactIds = [...new Set(proposal.sourceImpactIds || [])];
  const sourceImpacts = sourceImpactIds.map((impactId) => (
    (runtime.impacts || []).find((impact) => impact.id === impactId)
  )).filter(Boolean);
  const trace = {
    schemaVersion: 1,
    visibility: "observer-only",
    excludedFromOtherAgentMemory: true,
    authority: "recipient-character-agent",
    appraiserCharacterId: actor.characterId,
    targetCharacterId: proposal.targetCharacterId || "",
    sourceImpactIds,
    changeMode: proposal.changeMode,
    dimensionChanges: deepClone(proposal.dimensionChanges || []),
    reason: text(proposal.reason, 220),
    appliedRelationshipShiftIds: [],
  };
  if (proposal.changeMode === "none") {
    if (proposal.targetCharacterId || sourceImpactIds.length || proposal.reason) runtime.relationshipAppraisals.push(trace);
    return [];
  }
  trace.impressionId = commitRelationshipAppraisalToOwnedMemory(workingState, runtime, actor, proposal, sourceImpacts) || "";
  if (proposal.changeMode !== "retained") {
    runtime.relationshipAppraisals.push(trace);
    return [];
  }
  const deltas = tavernRelationshipDeltasFromCharacterAppraisal(proposal);
  const primaryImpact = sourceImpacts.find((impact) => (
    impact.sourceCharacterId === proposal.targetCharacterId
    || Object.values(impact.semanticFrame?.roles || {}).includes(proposal.targetCharacterId)
  )) || sourceImpacts[0] || null;
  const sourceActionId = primaryImpact?.provenance?.sourceActionId || primaryImpact?.causedByActionId || primaryImpact?.objectiveEventId || primaryImpact?.id || "";
  const perceivedAction = (runtime.actions || []).find((action) => action.id === sourceActionId) || {
    id: sourceActionId || createId("perceived_relationship_event"),
    actorId: proposal.targetCharacterId,
    targetCharacterId: actor.characterId,
    committed: true,
  };
  const evidenceId = createId("character_relationship_evidence");
  const derived = deriveRelationshipDeltas({
    action: perceivedAction,
    outcome: {
      id: createId("character_relationship_outcome"),
      status: "committed",
      applied: true,
      receivedByCharacterIds: [actor.characterId],
      relationshipEvidence: [{
        id: evidenceId,
        authority: "recipient-character-agent",
        verified: true,
        type: "explicit_appraisal",
        sourceActionId: perceivedAction.id,
        actorCharacterId: proposal.targetCharacterId,
        targetCharacterId: actor.characterId,
        observerCharacterId: actor.characterId,
        witnessedByCharacterIds: [actor.characterId],
        deltas,
      }],
    },
  });
  const committedShifts = [];
  for (const rawShift of derived.shifts || []) {
    const existing = directedRelationshipFor(workingState, rawShift.fromCharacterId, rawShift.toCharacterId)
      || defaultDirectedRelationship(workingState, rawShift.fromCharacterId, rawShift.toCharacterId);
    const updated = applyDirectionalRelationshipDelta(existing, rawShift.deltas || rawShift);
    const index = (workingState.relationships || []).findIndex((relationship) => relationship.id === existing.id);
    if (index >= 0) workingState.relationships[index] = updated;
    else workingState.relationships.push(updated);
    const shift = {
      id: createId("relationship_shift"),
      fromCharacterId: rawShift.fromCharacterId,
      toCharacterId: rawShift.toCharacterId,
      generatedFrom: "character-agent-owned-appraisal",
      relationshipSource: "recipient-character-agent-appraisal",
      sourceActionId: perceivedAction.id,
      sourceImpactId: primaryImpact?.id || "",
      locationId: runtime.locationId,
      locationName: "望梯酒馆",
      dialogueTurns: perceivedAction.speech ? [{ speakerId: perceivedAction.actorId, targetId: perceivedAction.targetCharacterId, line: perceivedAction.speech }] : [],
      dialogueTurnCount: perceivedAction.speech ? 1 : 0,
      finalTurn: perceivedAction.speech || "",
      eventOutcome: primaryImpact?.content || perceivedAction.visibleAction || perceivedAction.speech || "人物依据自己确实感知到的事件改变了关系判断。",
      relationshipDialogueAct: perceivedAction.speech ? { kind: perceivedAction.speechAct || "speak", reason: "原话只作为本人评价的证据" } : null,
      deltas: deepClone(rawShift.deltas || {}),
      evidenceIds: [...new Set([...(rawShift.evidenceIds || []), ...sourceImpactIds])],
      rules: [...(rawShift.rules || [])],
      misreading: "",
      unspoken: text(proposal.reason, 220),
    };
    runtime.relationshipShifts.push(shift);
    committedShifts.push(shift);
  }
  trace.appliedRelationshipShiftIds = committedShifts.map((shift) => shift.id);
  trace.worldValidation = deepClone(derived.observerTrace);
  runtime.relationshipAppraisals.push(trace);
  decision.relationshipShiftIds = [...trace.appliedRelationshipShiftIds];
  return committedShifts;
}

function advanceAllActiveEcologyClocks(workingState, runtime) {
  for (const agent of Object.values(runtime.agents || {})) {
    const character = characterById(workingState, agent.characterId);
    if (!character) continue;
    const ensured = ensureTavernEcology(character, {
      present: agent.present !== false,
      zoneId: agent.zoneId,
      locationId: runtime.locationId || LOCATION_ID,
      elapsedSeconds: Number(agent.ecologyState?.elapsedSeconds || character.ecologyState?.elapsedSeconds || 0),
    });
    const ecologyState = agent.ecologyState || character.ecologyState || ensured.state;
    if (!ensured.profile || !ecologyState) continue;
    const sceneEndSecond = Number(agent.ecologySceneStartSeconds || 0) + Number(runtime.elapsedSeconds || 0);
    const elapsedSeconds = Math.max(0, sceneEndSecond - Number(ecologyState.elapsedSeconds || 0));
    const next = advanceTavernEcologyTime({ profile: ensured.profile, ecologyState, elapsedSeconds });
    agent.ecologyState = deepClone(next);
    agent.privateState.ecologyState = deepClone(next);
    character.ecologyState = deepClone(next);
  }
}

function pendingVisitCooldownSignature(state = {}, runtime = {}) {
  const openVisits = (state.tavernState?.activeVisits || []).filter((visit) => (
    !["completed", "refused", "abandoned"].includes(visit.stage)
    && runtime.agents?.[visit.visitorId]?.present
  ));
  if (!openVisits.length) return "";
  const affordances = Object.values(runtime.agents || {}).flatMap((agent) => {
    if (!agent.present) return [];
    const perceivedIds = perceivedCharactersFor(state, runtime, agent.characterId).map((character) => character.id);
    return listTavernCausalAffordances(state, runtime, agent.characterId, perceivedIds)
      .filter((item) => item.visitId && openVisits.some((visit) => visit.id === item.visitId))
      .map((item) => `${agent.characterId}:${item.id}`);
  });
  const activeServiceProcesses = (state.tavernState?.serviceProcesses || [])
    .filter((process) => process.status === "active" && openVisits.some((visit) => visit.id === process.subjectId))
    .map((process) => ({
      id: process.id,
      subjectId: process.subjectId,
      readyAtSeconds: Number(process.readyAtSeconds || 0),
    }));
  // A durative process is itself an unfinished world fact. During infusion or
  // cooking there may be no immediately executable affordance, especially if
  // the operator has stepped away from the visitor. That temporary gap must
  // advance to the process's next boundary rather than masquerade as a quiet,
  // completed scene.
  if (!affordances.length && !activeServiceProcesses.length) return "";
  const lastCommittedAction = (runtime.actions || []).at(-1) || null;
  return JSON.stringify({
    // The visit transaction may remain unchanged while people produce new
    // looks, gestures, speech or other world actions. Each committed action is
    // therefore one new causal state that may advance through the next short
    // cooldown once. hardMaxSteps and maxSceneSeconds remain the outer bounds.
    lastCommittedActionId: lastCommittedAction?.id || "scene-start",
    lastCommittedActionEndedAtSeconds: Number(lastCommittedAction?.endedAtSeconds || 0),
    visits: openVisits.map((visit) => ({
      id: visit.id,
      stage: visit.stage,
      purposeStatus: visit.purposeStatus,
      hostId: visit.hostId || "",
      serviceStatus: visit.serviceStatus,
      servicePreparationStatus: visit.servicePreparationStatus || "",
      serviceProcessId: visit.serviceProcessId || "",
      lodgingStatus: visit.lodgingStatus,
      businessStatus: visit.businessStatus,
      paymentStatus: visit.paymentStatus,
    })),
    zones: Object.fromEntries(Object.values(runtime.agents || {}).filter((agent) => agent.present).map((agent) => [agent.characterId, agent.zoneId])),
    activeServiceProcesses,
    affordances: affordances.sort(),
  });
}

function advanceThroughPendingVisitCooldown(state, runtime, maxSceneSeconds, waitedSignatures) {
  const signature = pendingVisitCooldownSignature(state, runtime);
  if (!signature) return false;
  const actorReadySeconds = Object.values(runtime.agents || {})
    .filter((agent) => agent.present && Number(agent.cooldownUntilSeconds || 0) > Number(runtime.elapsedSeconds || 0))
    .map((agent) => Number(agent.cooldownUntilSeconds));
  const processReadySecond = nextTavernServiceProcessReadyAtElapsedSeconds(state, runtime);
  const nextReadySecond = Math.min(...[
    ...actorReadySeconds,
    ...(Number.isFinite(Number(processReadySecond)) && Number(processReadySecond) > Number(runtime.elapsedSeconds || 0)
      ? [Number(processReadySecond)]
      : []),
  ]);
  if (!Number.isFinite(nextReadySecond) || nextReadySecond > Number(maxSceneSeconds || 0)) return false;
  const waitKey = `${signature}:next=${nextReadySecond}`;
  if (waitedSignatures.has(waitKey)) return false;
  waitedSignatures.add(waitKey);
  runtime.elapsedSeconds = nextReadySecond;
  return true;
}

export async function runTavernCausalScene(state = {}, {
  characterIds = [],
  positions = {},
  topology = TAVERN_SCENE_TOPOLOGY,
  seedImpacts = [],
  runAgent = defaultRunAgent,
  characterAgentProtocolVersion = 1,
  runAgentV2Stage = runTavernCharacterAgentV2Stage,
  onAgentV2StageAccepted,
  signal,
  onEvent,
  maxSteps = 12,
  maxLocalFollowupSteps = 2,
  maxSceneSeconds = 15 * 60,
  minimumActivationScore = 34,
  slotContext = {},
  allowOrphanVisitors = false,
} = {}) {
  const useCharacterAgentV2 = Number(characterAgentProtocolVersion) === 2;
  if (![1, 2].includes(Number(characterAgentProtocolVersion))) {
    const error = new Error(`Unsupported Character Agent protocol version: ${characterAgentProtocolVersion}`);
    error.code = "TAVERN_CHARACTER_AGENT_PROTOCOL_UNSUPPORTED";
    throw error;
  }
  const startedAt = Date.now();
  const workingState = deepClone(state);
  const runtime = buildTavernSceneRuntime(workingState, { characterIds, positions, topology, slotContext, allowOrphanVisitors });
  const decisions = [];
  const stages = [];
  const baseMaxSteps = Math.max(1, Number(maxSteps || 12));
  const localFollowupStepBudget = Math.max(0, Number(maxLocalFollowupSteps || 0));
  const hardMaxSteps = baseMaxSteps + localFollowupStepBudget;
  let stopReason = "quiescent";
  let consecutivePasses = 0;
  let pendingVisitWake = false;
  const waitedVisitCooldownSignatures = new Set();

  for (const impact of seedSceneImpacts(workingState, runtime, seedImpacts)) {
    runtime.impacts.push(impact);
    const deliveries = deliverImpactFactor(workingState, runtime, impact);
    runtime.deliveries.push(...deliveries);
    for (const delivery of deliveries) {
      registerRuntimeImpactDelivery(runtime, delivery);
      runtime.agents[delivery.recipientId].inbox.push(delivery);
    }
    await emit(onEvent, { type: "impact_created", impact });
    for (const delivery of deliveries) await emit(onEvent, { type: "impact_delivered", impactId: impact.id, delivery });
  }

  while (runtime.step < hardMaxSteps && runtime.elapsedSeconds < maxSceneSeconds) {
    const localRequest = latestAwaitingRequest(runtime);
    if (runtime.step >= baseMaxSteps && !localRequest) {
      stopReason = "ordinary-budget-complete";
      break;
    }
    let selected = selectNextCausalAgent(runtime, {
      minimumScore: pendingVisitWake ? 0 : minimumActivationScore,
      state: workingState,
    });
    pendingVisitWake = false;
    if (!selected) {
      if (advanceThroughPendingVisitCooldown(workingState, runtime, maxSceneSeconds, waitedVisitCooldownSignatures)) {
        consecutivePasses = 0;
        selected = selectNextCausalAgent(runtime, { minimumScore: 0, state: workingState });
      }
    }
    if (!selected) {
      stopReason = consecutivePasses ? "all-passed" : "quiescent";
      break;
    }
    runtime.step += 1;
    const actor = runtime.agents[selected.characterId];
    const input = buildAgentInput(workingState, runtime, selected, { characterAgentProtocolVersion });
    let decisionInput = input;
    let authoritativeInput = canonicalAgentInput(input, workingState, runtime);
    const pending = observePendingImpacts(runtime, actor.characterId);
    await emit(onEvent, {
      type: "causal_agent_activated",
      step: runtime.step,
      characterId: actor.characterId,
      characterName: actor.characterName,
      sourceImpactId: selected.sourceImpactId,
      activationScore: selected.score,
      wakeKind: selected.wakeBasis?.kind || "",
      wakeReasons: deepClone(selected.wakeBasis?.reasons || []),
      wakeBasis: deepClone(selected.wakeBasis || null),
      perceivedImpactIds: pending.map((delivery) => delivery.impactId),
    });
    let characterAgentV2Result = null;
    let characterAgentV2Bridge = null;
    let result;
    if (useCharacterAgentV2) {
      characterAgentV2Result = await runTavernCharacterAgentTurnV2(input, {
        runStage: runAgentV2Stage,
        onStageAccepted: onAgentV2StageAccepted,
        signal,
      });
      stages.push(...(characterAgentV2Result.stages || []));
      characterAgentV2Bridge = bridgeTavernCharacterAgentV2ResultForWorld(characterAgentV2Result, input);
      decisionInput = characterAgentV2Bridge.input;
      authoritativeInput = canonicalAgentInput(decisionInput, workingState, runtime);
      result = { decision: characterAgentV2Bridge.rawDecision };
    } else {
      result = await runAgent(input, { signal });
      if (result?.stage) stages.push(result.stage);
    }
    let decision = normalizeTavernCharacterDecision(result?.decision || result || {}, decisionInput, workingState, runtime);
    let repairTrace = null;
    if (!useCharacterAgentV2 && result?.stage?.provider === "openai" && (decision.semanticViolations || []).length) {
      const attempts = [];
      const rejectedCandidateIds = [];
      for (let attempt = 1; attempt <= 2 && (decision.semanticViolations || []).length; attempt += 1) {
        const rejectedRawDecision = result?.decision || result || {};
        const rejectedCandidateId = text(rejectedRawDecision.candidateId, 160);
        if (rejectedCandidateId) rejectedCandidateIds.push(rejectedCandidateId);
        const repairFeedback = {
          attempt,
          mode: attempt === 1 ? "repair-current-realization" : "same-character-reconsideration",
          violations: (decision.semanticViolations || []).map((violation) => ({
            code: violation.code || "SEMANTIC_VIOLATION",
            field: violation.field || "decision",
            message: text(violation.message, 220),
            evidence: deepClone(violation.evidence || {}),
          })),
          rejectedCandidateIds: [...new Set(rejectedCandidateIds)],
          rejectedPublicRealization: {
            candidateId: rejectedCandidateId,
            actionType: rejectedRawDecision.actionType || "",
            speechAct: rejectedRawDecision.speechAct || "none",
            targetCharacterId: rejectedRawDecision.targetCharacterId || "",
            speech: text(rejectedRawDecision.speech || rejectedRawDecision.utterance?.literalSpeech, 180),
            visibleAction: text(rejectedRawDecision.visibleAction || rejectedRawDecision.embodiedIntent?.intendedGesture, 180),
            moveToZoneId: rejectedRawDecision.moveToZoneId || rejectedRawDecision.actionAttempt?.destinationId || "",
            affordanceId: rejectedRawDecision.affordanceId || rejectedRawDecision.actionAttempt?.affordanceId || "",
          },
          instruction: attempt === 1
            ? "保持当前人物；若 candidateId 有效可保持同一候选只修正实现，若 id 不存在或不可行则由人物从 feasible=true 的候选中重新选择。世界不会替人物补选。"
            : "上一份修正仍无法成为世界行动。保持当前人物和同一时刻，由人物本人重新比较全部 feasible=true 候选并提交一份完整的新决定；可以改选，也可以在重新权衡后重做原候选。技术拒绝不等于人物沉默、放弃或已经行动。",
        };
        const repairedInput = projectAgentInputIdentityReferences(
          { ...authoritativeInput, repairFeedback },
          workingState,
          runtime,
        );
        const repairedResult = await runAgent(repairedInput, { signal });
        if (repairedResult?.stage) stages.push(repairedResult.stage);
        const repairedDecision = normalizeTavernCharacterDecision(
          repairedResult?.decision || repairedResult || {},
          repairedInput,
          workingState,
          runtime,
        );
        attempts.push({
          attempt,
          mode: repairFeedback.mode,
          violationCodes: repairFeedback.violations.map((violation) => violation.code),
          resultingViolationCodes: (repairedDecision.semanticViolations || []).map((violation) => violation.code),
          resultingCandidateId: repairedDecision.candidateId || "",
          accepted: !(repairedDecision.semanticViolations || []).length,
        });
        result = repairedResult;
        decision = repairedDecision;
      }
      repairTrace = {
        attempted: true,
        attempts,
        firstViolationCodes: attempts[0]?.violationCodes || [],
        accepted: !(decision.semanticViolations || []).length,
        finalViolationCodes: (decision.semanticViolations || []).map((violation) => violation.code),
      };
    }
    if (
      !repairTrace
      && decision.choiceAuthority === "character-agent:rejected"
      && (decision.semanticViolations || []).length
    ) {
      const canReconsiderInOrdinaryBudget = !useCharacterAgentV2 && runtime.step < baseMaxSteps;
      const decisionTrace = {
        step: runtime.step,
        characterId: actor.characterId,
        sourceImpactId: selected.sourceImpactId,
        activationScore: selected.score,
        candidateId: "",
        choiceAuthority: canReconsiderInOrdinaryBudget
          ? decision.choiceAuthority || "character-agent:rejected"
          : "character-agent:technical-rejection",
        decision: deepClone(decision),
        recoverable: canReconsiderInOrdinaryBudget,
      };
      decisions.push(decisionTrace);
      if (canReconsiderInOrdinaryBudget) {
        await emit(onEvent, {
          type: "causal_agent_decision_rejected",
          step: runtime.step,
          characterId: actor.characterId,
          recoverable: true,
          violationCodes: (decision.semanticViolations || []).map((violation) => violation.code),
        });
        continue;
      }
      stopReason = "character-decision-unrealized";
      await emit(onEvent, {
        type: "causal_agent_decision_unrealized",
        step: runtime.step,
        characterId: actor.characterId,
        violationCodes: (decision.semanticViolations || []).map((violation) => violation.code),
      });
      break;
    }
    if (repairTrace && (decision.semanticViolations || []).length) {
      const decisionTrace = {
        step: runtime.step,
        characterId: actor.characterId,
        sourceImpactId: selected.sourceImpactId,
        activationScore: selected.score,
        candidateId: "",
        choiceAuthority: "character-agent:technical-rejection",
        decision: deepClone(decision),
        repair: repairTrace,
      };
      decisions.push(decisionTrace);
      stopReason = "character-decision-unrealized";
      await emit(onEvent, {
        type: "causal_agent_decision_unrealized",
        step: runtime.step,
        characterId: actor.characterId,
        violationCodes: repairTrace.finalViolationCodes,
      });
      break;
    }
    selected = useCharacterAgentV2
      ? bindSelectedCharacterChoiceV2(selected, decision, actor, authoritativeInput, characterAgentV2Bridge)
      : bindSelectedCharacterChoice(selected, decision, actor);
    if (!selected.sourceImpactId) {
      const inheritedThreadImpact = pendingThreadImpactForDecision(runtime, actor.characterId, decision);
      if (inheritedThreadImpact) selected = {
        ...selected,
        sourceImpactId: inheritedThreadImpact.impactId,
        deliveryId: inheritedThreadImpact.id,
      };
    }
    // Perception does not become belief at delivery time. The same Character
    // Agent call that owns the outward choice first settles what this person
    // noticed, interpreted, doubted, rejected, or suspended.
    const receiptAgentTurnId = characterAgentV2Result?.session?.agentTurnId
      || `agent-turn:${runtime.id}:${runtime.step}:${actor.characterId}`;
    const cognitiveAppraisalTrace = commitCharacterCognitiveAppraisal(
      workingState,
      runtime,
      actor,
      decision,
      authoritativeInput,
    );
    const eventReceiptAppraisals = cognitiveAppraisalTrace?.valid
      ? markRuntimeAppraisedEvidence(runtime, actor, decision, receiptAgentTurnId)
      : [];
    // Conversation closure is participant-owned. The speaker's later outward
    // disposition can only update the speaker; this appraisal is the sole path
    // by which the current actor decides whether an incoming turn satisfied
    // them or still needs a response.
    commitCharacterOwnedThreadAppraisal(workingState, runtime, actor, decision, authoritativeInput);
    // Relationship meaning belongs to the person who perceived the stimulus.
    // Commit that Character Agent's appraisal before branching on the chosen
    // outward action so silence/pass can still retain a private impression.
    commitCharacterOwnedRelationshipAppraisal(workingState, runtime, actor, decision);
    const decisionTrace = {
      step: runtime.step,
      characterId: actor.characterId,
      sourceImpactId: selected.sourceImpactId,
      activationScore: selected.score,
      wakeBasis: deepClone(selected.wakeBasis || null),
      candidateId: decision.candidateId || "",
      choiceAuthority: decision.choiceAuthority || "character-agent:rejected",
      decision: deepClone(decision),
      ...(useCharacterAgentV2 ? {
        characterAgentProtocolVersion: 2,
        characterAgentTurnId: characterAgentV2Result?.session?.agentTurnId || "",
        privatePsychology: {
          subjectiveAppraisal: deepClone(characterAgentV2Result?.session?.subjectiveAppraisal || null),
          psychologySnapshot: deepClone(characterAgentV2Result?.session?.psychologySnapshot || null),
          candidateEvaluation: deepClone(characterAgentV2Result?.session?.candidateEvaluation || null),
          agentChoice: deepClone(characterAgentV2Result?.session?.agentChoice || null),
          regulationOutcome: deepClone(characterAgentV2Result?.session?.regulationOutcome || null),
        },
      } : {}),
      ...(repairTrace ? { repair: repairTrace } : {}),
      eventReceiptAppraisalEventIds: eventReceiptAppraisals.map((receipt) => receipt.eventId),
    };
    decisions.push(decisionTrace);
    actor.hasActed = true;
    actor.intrinsicPressure = Math.max(0, Number(actor.intrinsicPressure || 0) - 36);
    actor.currentIntention = decision.commitmentTopic || actor.currentIntention;

    if (decision.actionType === "pass") {
      let v2PassOutcome = null;
      if (useCharacterAgentV2) {
        const resolvedSession = attachV2WorldOutcome(characterAgentV2Result, null, "not_attempted");
        decisionTrace.characterAgentV2WorldOutcome = deepClone(resolvedSession?.worldOutcome || null);
        v2PassOutcome = resolvedSession?.worldOutcome || null;
      }
      commitActorEcology(workingState, runtime, actor, selected, decision);
      if (useCharacterAgentV2) {
        decisionTrace.characterPsychologyV2Carryover = deepClone(commitCharacterPsychologyV2Carryover(
          workingState,
          runtime,
          actor,
          characterAgentV2Result,
          v2PassOutcome,
        ));
      }
      decisionTrace.eventReceiptConsumptionEventIds = consumeRuntimeAppraisedEvidence(
        runtime,
        actor,
        decision,
        receiptAgentTurnId,
        "explicit_pass_or_defer",
      ).map((receipt) => receipt.eventId);
      const requestLock = requestLockForSelection(runtime, selected);
      if (requestLock) {
        recordInteractionPass(requestLock, {
          step: runtime.step,
          maxAttempts: localFollowupStepBudget,
        });
      } else if (!(decision.semanticViolations || []).length) {
        markSelectedImpactHandled(runtime, actor.characterId, selected.sourceImpactId);
      }
      consecutivePasses += 1;
      actor.consecutivePasses += 1;
      actor.cooldownUntilSeconds = requestLock ? runtime.elapsedSeconds : runtime.elapsedSeconds + 45;
      if (requestLock?.status === "awaiting") {
        consecutivePasses = 0;
        continue;
      }
      if (consecutivePasses >= runtime.activeCharacterIds.length) {
        if (advanceThroughPendingVisitCooldown(workingState, runtime, maxSceneSeconds, waitedVisitCooldownSignatures)) {
          consecutivePasses = 0;
          pendingVisitWake = true;
          continue;
        }
        stopReason = "all-passed";
        break;
      }
      continue;
    }

    consecutivePasses = 0;
    actor.consecutivePasses = 0;
    const causalParentImpact = (runtime.impacts || []).find((impact) => impact.id === selected.sourceImpactId) || null;
    const causalParentAction = causalParentImpact?.causedByActionId
      ? (runtime.actions || []).find((candidate) => candidate.id === causalParentImpact.causedByActionId) || null
      : null;
    const causalParentSpeechAction = causalParentImpact?.type === "speech" && causalParentAction?.speech
      ? causalParentAction
      : null;
    const matchingDecisionDesires = (selected.ecology?.profile?.desires || []).filter((desire) => {
      const condition = desire.satisfactionCondition || {};
      const criteria = condition.criteria || {};
      return condition.type === "communicated_decision"
        && (criteria.actorCharacterId || desire.ownerCharacterId) === actor.characterId
        && (criteria.receiverCharacterId || desire.target?.id) === decision.targetCharacterId;
    });
    const selectedDecisionTopicId = selected.semanticFrame?.topicId
      || decision.semanticFrame?.topicId
      || selected.ecology?.selectedIntent?.semanticFrame?.topicId
      || selected.ecology?.profile?.desires
      ?.find((desire) => desire.id === selected.ecology?.selectedIntent?.driveId)
      ?.satisfactionCondition?.criteria?.topicId || "";
    const inferredDecisionTopicId = matchingDecisionDesires.length === 1
      ? matchingDecisionDesires[0].satisfactionCondition?.criteria?.topicId || ""
      : "";
    const speakerThreadDisposition = decision.communicationPlan?.threadDisposition || "none";
    const semanticSettlementBlocked = (decision.claimAnnotations || []).some((violation) => (
      [
        "SEMANTIC_REQUEST_OBJECT_MISSING",
        "SEMANTIC_REQUEST_COUNTERPARTY_MISMATCH",
        "AGENT_CANDIDATE_TARGET_MISMATCH",
      ].includes(violation.code)
    ));
    const threadDisposition = semanticSettlementBlocked
      && ["settle", "refuse", "defer"].includes(speakerThreadDisposition)
      ? "unresolved"
      : speakerThreadDisposition;
    const publiclySettledFrame = semanticSettlementBlocked && decision.semanticFrame
      ? { ...deepClone(decision.semanticFrame), decisionValue: "" }
      : deepClone(decision.semanticFrame || null);
    const selectedAffordance = (authoritativeInput.availableAffordances || []).find((item) => item.id === decision.affordanceId) || null;
    const action = {
      id: createId("causal_action"),
      characterAgentTurnId: decisionTrace.characterAgentTurnId || "",
      step: runtime.step,
      actorId: actor.characterId,
      actorName: actor.characterName,
      actorZoneId: actor.zoneId,
      fromZoneId: actor.zoneId,
      toZoneId: decision.moveToZoneId || actor.zoneId,
      speechSourceZoneId: decision.speech ? (decision.moveToZoneId || actor.zoneId) : actor.zoneId,
      targetCharacterId: decision.targetCharacterId,
      targetCharacterName: runtime.agents[decision.targetCharacterId]?.characterName || "",
      actionType: decision.actionType,
      speechAct: decision.speechAct,
      speechFunctions: [...(decision.speechFunctions || inferPublicSpeechFunctions(decision))],
      speech: decision.speech,
      // This is the normalized physical proposal, not yet an accomplished
      // world fact. worldResolution overwrites it below with the committed
      // outcome (or an empty result when the attempt fails).
      visibleAction: decision.visibleAction,
      observableAffectiveTexture: observableAffectiveTexture(decision.observableAffectiveTexture),
      moveToZoneId: decision.moveToZoneId,
      affordanceId: decision.affordanceId,
      affordanceType: "",
      visitId: "",
      materialConsequence: "",
      resourceDelta: {},
      objectOperations: [],
      satisfactionEvidence: deepClone(selected.ecology?.selectedIntent?.satisfactionEvidence || null),
      informationSourceImpactId: decision.informationSourceImpactId,
      commitmentAction: semanticSettlementBlocked ? "none" : decision.commitmentAction,
      commitmentTopic: decision.commitmentTopic,
      decisionValue: semanticSettlementBlocked ? "none" : decision.decisionValue || "none",
      communicationPlan: deepClone(decision.communicationPlan || noOpCommunicationPlan()),
      communicationPlanAuthority: decision.communicationPlanAuthority || "",
      speechRealizationPlan: deepClone(decision.speechRealizationPlan || noOpSpeechRealizationPlan({}, { hasSpeech: Boolean(decision.speech) })),
      speechRealizationPlanAuthority: decision.speechRealizationPlanAuthority || "",
      realizedSpeechHabitIds: deepClone(decision.realizedSpeechHabitIds || []),
      epistemicQuestionAudit: deepClone(decision.epistemicQuestionAudit || null),
      epistemicDiagnostics: deepClone(decision.epistemicDiagnostics || []),
      privateProposalDiagnostics: deepClone(decision.privateProposalDiagnostics || []),
      cognitiveAppraisalAuthority: decision.cognitiveAppraisalAuthority || "",
      relationshipAppraisalAuthority: decision.relationshipAppraisalAuthority || "",
      utterance: deepClone(decision.utterance || { literalSpeech: decision.speech || "", vocalMode: decision.vocalMode || "conversational" }),
      utteranceAuthority: decision.utteranceAuthority || "legacy-outward-fields-migration-adapter",
      embodiedIntent: deepClone(decision.embodiedIntent || { manner: "", posture: "", intendedGesture: decision.visibleAction || "" }),
      embodiedIntentAuthority: decision.embodiedIntentAuthority || "legacy-outward-fields-migration-adapter",
      actionAttempt: deepClone(decision.actionAttempt || legacyActionAttempt(decision)),
      actionAttemptAuthority: decision.actionAttemptAuthority || "legacy-outward-fields-migration-adapter",
      speakerThreadDisposition,
      threadDisposition,
      threadSettlementEligible: !semanticSettlementBlocked,
      claimAnnotations: deepClone(decision.claimAnnotations || []),
      actionAttemptFailures: deepClone(decision.actionAttemptFailures || []),
      worldResolution: null,
      semanticFrame: publiclySettledFrame,
      publicSemanticFrame: null,
      publicTopic: "",
      semanticFrameId: decision.semanticFrameId || "",
      decisionTopicId: selectedDecisionTopicId
        || causalParentAction?.decisionTopicId
        || inferredDecisionTopicId
        || "",
      privateReason: decision.privateReason,
      goalPreservation: deepClone(decision.goalPreservation || {}),
      sharedActivity: deepClone(decision.sharedActivity || null),
      candidateId: decision.candidateId || "",
      postChoiceContinuity: deepClone(decision.postChoiceContinuity || null),
      postChoiceContinuityAuthority: decision.postChoiceContinuityAuthority || "",
      causalParentImpactId: selected.sourceImpactId || "",
      sourceThreadId: causalParentSpeechAction?.sourceThreadId
        || causalParentImpact?.provenance?.sourceThreadId
        || "",
      responseToTurnId: causalParentSpeechAction?.id
        || causalParentImpact?.provenance?.responseToTurnId
        || "",
      responseSourceLine: causalParentSpeechAction?.speech
        || causalParentImpact?.provenance?.responseSourceLine
        || "",
      responseSourceSlotId: causalParentSpeechAction?.slotId
        || causalParentImpact?.provenance?.responseSourceSlotId
        || "",
      responseSourceSlotLabel: causalParentSpeechAction?.slotLabel
        || causalParentImpact?.provenance?.responseSourceSlotLabel
        || "",
      actionKind: selected.ecology?.selectedIntent?.actionKind || decision.actionType,
      committed: true,
      ecologyCandidateId: selected.ecology?.selectedIntent?.id || "",
      ecologyRuntimeSignature: selected.ecology?.selectedIntent?.runtimeSignature || "",
      startedAtSeconds: runtime.elapsedSeconds,
      endedAtSeconds: runtime.elapsedSeconds + actionDuration(decision, {
        selectedAffordance,
        respondingToLiveThread: Boolean(
          causalParentImpact?.provenance?.sourceThreadId
          || causalParentImpact?.provenance?.sourceActionId
          || causalParentImpact?.type === "speech",
        ),
      }),
      impactFactors: [],
      deliveries: [],
      slotId: runtime.slotContext?.slotId || "causal-scene",
      slotLabel: runtime.slotContext?.slotLabel || "同一场",
    };
    const observerPsychology = observerPsychologyForDecision(authoritativeInput, selected, decision, action, runtime);
    decisionTrace.actionId = action.id;
    decisionTrace.observerPsychology = deepClone(observerPsychology);
    runtime.elapsedSeconds = action.endedAtSeconds;
    const material = selectedAffordance
      ? applyTavernCausalAffordance(
        workingState,
        runtime,
        action,
        selectedAffordance,
        (authoritativeInput.perceivedCharacters || []).map((character) => character.id),
      )
      : null;
    if (material) {
      action.affordanceType = material.affordance.type;
      action.visitId = material.affordance.visitId;
      action.materialConsequence = material.consequence;
      action.resourceDelta = deepClone(material.resourceDelta || {});
      action.objectOperations = deepClone(material.objectOperations || []);
      action.satisfactionEvidence = deepClone(material.satisfactionEvidence || action.satisfactionEvidence || null);
    } else if (selectedAffordance) {
      decisionTrace.worldResolutionFailed = true;
      decisionTrace.worldResolutionFailureCode = "MATERIAL_AFFORDANCE_TRANSACTION_REJECTED";
    } else action.affordanceId = "";
    action.worldResolution = selectedAffordance
      ? settleAffordanceActionAttempt(action, selectedAffordance, material)
      : settleFreeActionAttempt(workingState, runtime, action);
    const sharedActivityResolution = settleSharedActivityOperation(runtime, action);
    action.sharedActivityResolution = deepClone(sharedActivityResolution);
    if (sharedActivityResolution?.status === "success") {
      if (["not_attempted", "success"].includes(action.worldResolution.status)) action.worldResolution.status = "success";
      action.worldResolution.committedFacts = [
        ...(action.worldResolution.committedFacts || []),
        {
          kind: "shared_activity_transition",
          activityId: sharedActivityResolution.activity?.activityId || "",
          activityStatus: sharedActivityResolution.activity?.status || "",
          operation: action.sharedActivity?.operation || "",
        },
        ...(sharedActivityResolution.accessGrant ? [{
          kind: "scoped_access_grant",
          grantId: sharedActivityResolution.accessGrant.grantId,
          zoneIds: deepClone(sharedActivityResolution.accessGrant.zoneIds || []),
        }] : []),
      ];
    } else if (sharedActivityResolution?.status === "failed") {
      action.worldResolution.status = action.speech ? "partial" : "failed";
      action.worldResolution.failureCodes = [...new Set([
        ...(action.worldResolution.failureCodes || []),
        sharedActivityResolution.code,
      ].filter(Boolean))];
      action.worldResolution.violations = [
        ...(action.worldResolution.violations || []),
        {
          code: sharedActivityResolution.code,
          field: "sharedActivity",
          message: sharedActivityResolution.message,
          evidence: { activityId: action.sharedActivity?.activityId || "", operation: action.sharedActivity?.operation || "" },
        },
      ];
    }
    action.worldResolution.observableAffectiveTexture = (
      action.speech || ["success", "partial"].includes(action.worldResolution.status)
    )
      ? observableAffectiveTexture(action.observableAffectiveTexture)
      : [];
    if (useCharacterAgentV2) {
      const resolvedSession = attachV2WorldOutcome(characterAgentV2Result, action);
      decisionTrace.characterAgentV2WorldOutcome = deepClone(resolvedSession?.worldOutcome || null);
    }
    action.visibleAction = action.worldResolution.visibleOutcome || "";
    action.observableAffectiveTexture = observableAffectiveTexture(
      action.worldResolution.observableAffectiveTexture,
    );
    action.moveToZoneId = action.worldResolution.movementCommitted
      ? action.actionAttempt?.destinationId || decision.moveToZoneId
      : "";
    action.toZoneId = action.moveToZoneId || action.actorZoneId;
    action.speechSourceZoneId = action.speech ? (action.moveToZoneId || action.actorZoneId) : action.actorZoneId;
    action.objectOperations = deepClone(action.worldResolution.objectOperations || action.objectOperations || []);
    if (["failed", "partial"].includes(action.worldResolution.status) && action.worldResolution.violations?.length) {
      action.actionAttemptFailures = [
        ...(action.actionAttemptFailures || []),
        ...action.worldResolution.violations,
      ].filter((violation, index, rows) => rows.findIndex((row) => row.code === violation.code) === index);
    }
    if (["failed", "partial"].includes(action.worldResolution.status)
      && (action.worldResolution.failureCodes || []).length) {
      runtime.failedAttemptCooldowns = (runtime.failedAttemptCooldowns || [])
        .filter((row) => Number(row.expiresAtStep || 0) >= runtime.step);
      runtime.failedAttemptCooldowns.push({
        id: `${action.characterAgentTurnId || `agent-turn:${action.actorId}:${runtime.step}`}:${action.id}`,
        actorId: action.actorId,
        actionId: action.id,
        agentTurnId: action.characterAgentTurnId || "",
        attempt: deepClone(action.actionAttempt || {}),
        failureCodes: [...new Set(action.worldResolution.failureCodes || [])],
        createdAtStep: runtime.step,
        expiresAtStep: runtime.step + 2,
      });
      runtime.failedAttemptCooldowns = runtime.failedAttemptCooldowns.slice(-12);
    }
    if (action.worldResolution.movementCommitted) {
      const fromZoneId = actor.zoneId;
      actor.zoneId = action.actionAttempt?.destinationId || decision.moveToZoneId;
      actor.zoneProvenance = {
        schemaVersion: 1,
        authority: "world-movement-commit",
        sourceActionId: action.id,
        fromZoneId,
        toZoneId: actor.zoneId,
        committedAtStep: runtime.step,
      };
      if (actor.ecologyState?.presence) {
        actor.ecologyState.presence.locationId = runtime.locationId || LOCATION_ID;
        actor.ecologyState.presence.zoneId = actor.zoneId;
        actor.ecologyState.presence.observableAtStage = true;
      }
      if (workingState.tavernState?.objectLedger) {
        workingState.tavernState.objectLedger = relocateHeldObjects({
          ledger: workingState.tavernState.objectLedger,
          actorId: actor.characterId,
          sceneId: runtime.locationId || LOCATION_ID,
          zoneId: actor.zoneId,
        });
      }
    }
    const selectedEpistemicPrimitive = selected.ecology?.selectedIntent?.realization?.epistemicPrimitive
      || selected.ecology?.selectedIntent?.actionKind
      || "";
    if (["observe", "listen"].includes(selectedEpistemicPrimitive)
      && ["success", "partial"].includes(action.worldResolution.status)) {
      const focusTargetId = selectedEpistemicPrimitive === "observe"
        ? decision.targetCharacterId || selected.ecology?.selectedIntent?.targetCharacterId || ""
        : "";
      actor.attentionTargetId = focusTargetId;
      actor.attentionFocus = {
        schemaVersion: 1,
        authority: "character-agent-attention-choice",
        mode: selectedEpistemicPrimitive,
        targetCharacterId: focusTargetId,
        domainTags: selectedEpistemicPrimitive === "observe"
          ? ["attention-target", "person", "movement"]
          : ["sound", "speech", "voice"],
        startedAtSeconds: Number(action.startedAtSeconds || 0),
        expiresAtSeconds: Number(action.endedAtSeconds || runtime.elapsedSeconds || 0) + 45,
        sourceActionId: action.id,
      };
    } else if (decision.targetCharacterId) {
      actor.attentionTargetId = decision.targetCharacterId;
      actor.attentionFocus = {
        schemaVersion: 1,
        authority: "character-agent-attention-choice",
        mode: "interaction",
        targetCharacterId: decision.targetCharacterId,
        domainTags: ["attention-target"],
        startedAtSeconds: Number(action.startedAtSeconds || 0),
        expiresAtSeconds: Number(action.endedAtSeconds || runtime.elapsedSeconds || 0) + 20,
        sourceActionId: action.id,
      };
    }
    // The actor's selected desire/semantic frame remains private decision
    // evidence.  Only the words actually spoken and the world-settled visible
    // action may become the shared topic seen by another Character Agent.
    refreshPublicActionSemantics(action);
    decisionTrace.eventReceiptConsumptionEventIds = consumeRuntimeAppraisedEvidence(
      runtime,
      actor,
      decision,
      receiptAgentTurnId,
      "acted_or_explicitly_deferred",
    ).map((receipt) => receipt.eventId);
    markSelectedImpactHandled(runtime, actor.characterId, selected.sourceImpactId);
    updateRuntimeConversationLocks(runtime, action);
    const impacts = deriveImpactFactorsFromAction(workingState, runtime, action);
    if (material?.consequence) impacts.push(createImpactFactor({
      causedByActionId: action.id,
      locationId: runtime.locationId || LOCATION_ID,
      sourceCharacterId: action.actorId,
      sourceZoneId: action.toZoneId || action.actorZoneId,
      type: "resource",
      modality: material.affordance.type === "assign_work" ? "sound" : "visual",
      intensity: 88,
      radius: material.affordance.type === "assign_work" ? 2.5 : 1.5,
      directedTargetId: material.targetCharacterId || "",
      content: material.consequence,
      topic: material.affordance.label,
      committed: action.committed === true,
      createdAtSeconds: runtime.elapsedSeconds,
      provenance: impactProvenanceForAction(runtime, action),
    }));
    action.impactFactors = impacts;
    for (const impact of impacts) {
      runtime.impacts.push(impact);
      const deliveries = deliverImpactFactor(workingState, runtime, impact);
      runtime.deliveries.push(...deliveries);
      action.deliveries.push(...deliveries);
      for (const delivery of deliveries) {
        registerRuntimeImpactDelivery(runtime, delivery);
        runtime.agents[delivery.recipientId].inbox.push(delivery);
        // Delivery is a server-side propagation fact. Thread uptake, ecology
        // appraisal and episodic encoding wait until this recipient's private
        // perception tool actually selects the signal as noticed evidence.
      }
      await emit(onEvent, { type: "impact_created", step: runtime.step, actionId: action.id, impact });
      for (const delivery of deliveries) await emit(onEvent, { type: "impact_delivered", step: runtime.step, actionId: action.id, impactId: impact.id, delivery });
    }
    commitActionToActorMemory(workingState, runtime, action, impacts.find((impact) => impact.type === "speech") || impacts[0] || null);
    commitActorEcology(workingState, runtime, actor, selected, decision, action, material);
    if (useCharacterAgentV2) {
      decisionTrace.characterPsychologyV2Carryover = deepClone(commitCharacterPsychologyV2Carryover(
        workingState,
        runtime,
        actor,
        characterAgentV2Result,
        decisionTrace.characterAgentV2WorldOutcome,
      ));
      decisionTrace.committedVoiceHabitUse = commitCharacterVoiceHabitUsage(
        workingState,
        runtime,
        actor,
        decision,
        action,
        characterAgentV2Result,
      );
    }
    commitActorPostChoiceContinuity(workingState, runtime, actor, authoritativeInput, selected, decision, action, material, impacts);
    if (decision.actionType === "leave") actor.present = false;
    actor.currentVisibleActivity = action.visibleAction || action.speech || actor.currentVisibleActivity || "";
    actor.recentActionIds = [...actor.recentActionIds, action.id].slice(-6);
    actor.cooldownUntilSeconds = runtime.elapsedSeconds + 12;
    runtime.actions.push(action);
    runtime.lastActorId = actor.characterId;
    applyCommitment(runtime, action);
    await emit(onEvent, {
      type: "causal_action_committed",
      step: runtime.step,
      action: publicCommittedAction(action),
      observerPsychology,
      publicRuntime: publicSceneRuntime(runtime),
    });
  }

  const unresolvedRequests = unresolvedInteractions(runtime.requestLocks || []);
  // A technical rejection is the terminal fact of the run. An older open
  // request may explain what remained unfinished, but must not overwrite and
  // hide the actual failure that stopped the character from acting.
  if (stopReason !== "character-decision-unrealized") {
    if (unresolvedRequests.length) stopReason = "unresolved-request";
    else if (runtime.step >= hardMaxSteps) stopReason = "max-steps";
    else if (runtime.elapsedSeconds >= maxSceneSeconds) stopReason = "max-scene-time";
  }
  advanceAllActiveEcologyClocks(workingState, runtime);
  return {
    actions: runtime.actions,
    unresolvedRequests: deepClone(unresolvedRequests),
    decisions,
    impacts: runtime.impacts,
    publicEvents: runtime.impacts.filter((impact) => impact.publicEvent).map((impact) => ({
      id: impact.id,
      kind: impact.publicEventKind || impact.type,
      sourceCharacterId: impact.sourceCharacterId,
      actorId: impact.sourceCharacterId,
      content: impact.surfaceEvent || impact.content,
      surfaceEvent: impact.surfaceEvent || impact.content,
      createdAtSeconds: impact.createdAtSeconds,
    })),
    deliveries: runtime.deliveries,
    relationshipShifts: deepClone(runtime.relationshipShifts || []),
    relationshipAppraisals: deepClone(runtime.relationshipAppraisals || []),
    sceneRuntime: publicSceneRuntime(runtime),
    privateSceneRuntime: runtime,
    tavernState: deepClone(workingState.tavernState || {}),
    characterPatches: (workingState.characters || []).filter((character) => runtime.activeCharacterIds.includes(character.id)).map((character) => {
      const agent = runtime.agents?.[character.id];
      const ecology = character.ecologyState || agent?.ecologyState || null;
      const present = agent?.present !== false;
      const currentLocationId = present
        ? runtime.locationId || LOCATION_ID
        : ecology?.presence?.locationId || character.currentLocationId || "";
      return {
        id: character.id,
        currentLocationId,
        currentActivity: deepClone(character.currentActivity || character.lifeState?.currentActivity || null),
        lifeState: { ...deepClone(character.lifeState || {}), present },
        ecologyState: deepClone(ecology),
        agentMemory: deepClone(agent?.memoryState || character.agentMemory || createCharacterAgentMemoryState(character.id)),
      };
    }),
    macroTimeAdvanced: false,
    stopReason,
    stages,
    stage: {
      name: "TavernCausalAgentScene",
      provider: stages.some((stage) => stage.provider === "openai") ? "openai" : "test",
      elapsedMs: Date.now() - startedAt,
      stepCount: runtime.step,
      actionCount: runtime.actions.length,
      impactCount: runtime.impacts.length,
      stopReason,
    },
  };
}
