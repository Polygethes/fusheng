/**
 * Tavern adapter for the protocol-v2 Character Agent turn.
 *
 * The tavern contributes recipient-specific evidence, affordances, service
 * facts, time, and private character foundations. It does not provide a closed
 * action-candidate list. One logical Character Agent is invoked at five causal
 * stages and keeps appraisal, candidates, choice, automatic impulse,
 * post-regulation expression planning, realization, and literal speech
 * authority throughout.
 */

import { callOpenAIJson } from "./responseClient.mjs";
import { bodyActionsSchema, PHYSICAL_AFFECTIVE_CUES } from "../simulation/physicalExpression.mjs";
import { waitConditionSchema } from "../simulation/characterExecutionControl.mjs";
import { projectedReplyTargets } from "../simulation/characterConversationContinuity.mjs";
import { createCharacterTurnExecution } from "../simulation/characterTurnExecution.mjs";
import { prepareCharacterStageSubmission } from "../simulation/characterStageSubmission.mjs";
import { formatCharacterContextForPrompt, resolveCharacterPromptFormat } from "./characterModelPromptPacking.mjs";
import { buildTavernAffectiveSpeechRealizationTool } from "./tavernCharacterVoice.mjs";
import {
  buildCharacterSpeechHabitPressureTool,
  projectCharacterSpeechHabitSurface,
} from "../simulation/characterVoiceHabits.mjs";
import { tavernCharacterRelationshipAppraisalSchema } from "../ecology/tavernRelationshipDynamics.mjs";
import {
  CHARACTER_DESIRE_CRITERION_PROMOTION_MODES,
  CHARACTER_DESIRE_CRITERION_STATE_FACTORS,
  CHARACTER_DESIRE_CRITERION_USE_TYPES,
  CHARACTER_EPISTEMIC_ACTION_MODES,
  CHARACTER_EPISTEMIC_DOMAINS,
  CHARACTER_EPISTEMIC_RELIANCE_SCOPES,
  CHARACTER_EPISTEMIC_STATUSES,
  CHARACTER_EPISTEMIC_WORKING_STANCES,
  CHARACTER_PSYCHOLOGY_EMOTION_IDS,
  CHARACTER_PSYCHOLOGY_LEAKAGE_CHANNELS,
  deriveDesireCriterionLedger,
} from "../simulation/characterPsychologyTools.mjs";
import {
  buildCharacterAgentAppraisalAndCandidatesStageInput,
  buildCharacterAgentChoiceAndTurnCommitStageInput,
  buildCharacterAgentStageInput,
  createCharacterAgentTurnSession,
  submitCharacterAgentCandidates,
  submitCharacterAgentChoiceAndRegulation,
  submitCharacterAgentExpressionPlan,
  submitCharacterAgentRealization,
  submitCharacterAgentTurnCommit,
  submitCharacterSubjectiveAppraisal,
} from "../simulation/characterAgentTurnProtocol.mjs";

export const TAVERN_CHARACTER_AGENT_V2_VERSION = "tavern-character-agent-v2.10";
export const TAVERN_CHARACTER_AGENT_V2_CALL_MODES = Object.freeze(["standard", "two-call", "three-call"]);

const TAVERN_CHARACTER_AGENT_V2_CALL_MODE_SET = new Set(TAVERN_CHARACTER_AGENT_V2_CALL_MODES);

export function resolveTavernCharacterAgentV2CallMode(value = "standard") {
  const normalized = clean(value) || "standard";
  if (!TAVERN_CHARACTER_AGENT_V2_CALL_MODE_SET.has(normalized)) {
    const error = new TypeError(`Unknown Tavern Character Agent call mode: ${normalized}.`);
    error.code = "TAVERN_CHARACTER_AGENT_CALL_MODE_INVALID";
    throw error;
  }
  return normalized;
}

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
const THREAD_DISPOSITIONS = ["settle", "refuse", "defer", "evade", "counter", "redirect", "ignore", "open_new", "none"];
const PRESUPPOSITION_STANCES = ["not_applicable", "accept", "uncertain", "deliberate_probe", "deceptive", "misremembered", "confabulated"];
const SHARED_CONTEXT_TREATMENTS = [
  "not_applicable", "accept_as_given", "reopen_to_clarify", "question_memory",
  "challenge_truth", "tease", "deceive", "misremembered", "confabulated",
];
const THREAD_INTERPRETATIONS = ["answered", "refused", "deferred", "evaded", "countered", "redirected", "ignored", "misunderstood", "unclear", "new_request", "not_applicable"];
const THREAD_SATISFACTION_STATES = ["satisfied", "unsatisfied", "uncertain", "not_applicable"];
const THREAD_RESPONSE_NEEDS = ["none", "low", "medium", "high"];
const THREAD_SELF_CLOSURES = ["open", "closed_for_self"];
const SPEECH_ACTS = ["none", "greet", "ask", "answer", "offer", "refuse", "negotiate", "warn", "gossip", "confide", "inform"];
const CHARACTER_ATTEMPT_PRIMITIVES = [
  "wait",
  "none", "speak", "observe", "listen", "gesture", "interact", "move", "leave", "rest", "practice",
  "use_affordance", "pickup", "take_out", "show", "hide", "store", "draw", "sheathe", "transfer", "place", "consume",
];
const CONTINUATION_TRIGGER_TYPES = [
  "target_response", "target_attention_confirmed", "new_relevant_evidence",
  "own_action_settled",
  "elapsed_without_progress", "internal_pressure", "opportunity_window",
];
const PUBLIC_INTERACTION_MOVES = [
  "none", "initiate", "respond", "ask", "answer", "acknowledge", "offer", "refuse",
  "evade", "counter", "redirect", "mislead", "tease", "warn", "soothe", "close", "silence",
];
const AFFECTIVE_INFLUENCE_MODES = [
  "no_live_influence",
  "shape_wording",
  "shape_timing",
  "shape_action",
  "leak_publicly",
  "contained_privately",
  "displaced",
];
const ATOMIC_POST_TURN_DISPOSITIONS = ["no_thread", "keep_resumable", "close_for_self"];
const COMMUNICATION_REMAINDER_TREATMENTS = [
  "leave_private", "imply", "defer", "release_broadly", "not_applicable",
];
const WORLD_ATTEMPT_PRIMITIVES = new Set([
  "wait",
  "none", "speak", "observe", "listen", "gesture", "interact", "move", "leave", "rest", "practice", "use_affordance", "pickup", "take_out", "show", "hide", "store",
  "draw", "sheathe", "transfer", "place", "consume",
]);

const relationshipMeaningSchema = {
  type: "object",
  additionalProperties: false,
  required: ["affiliation", "status", "trust", "rejection", "care", "betrayal"],
  properties: Object.fromEntries([
    "affiliation", "status", "trust", "rejection", "care", "betrayal",
  ].map((id) => [id, { type: "number", minimum: -1, maximum: 1 }])),
};

export const tavernCharacterSubjectiveAppraisalV2Schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "ownerAuthority", "appraisalId", "agentTurnId", "eventId", "noticedEvidenceIds",
    "interpretations", "beliefOperations", "epistemicPositions", "relevanceLinks", "appraisalAxes",
    "desireGroundings",
    "uncertainty", "alternativesConsidered", "entityModelUpdates", "locationBeliefUpdates",
    "sourceKnowledgeBeliefUpdates", "threadAppraisals", "relationshipAppraisal",
    "priorActionOutcomeAppraisal",
  ],
  properties: {
    ownerAuthority: { type: "string", enum: ["character-agent"] },
    appraisalId: { type: "string" },
    agentTurnId: { type: "string" },
    eventId: { type: "string" },
    epistemicPositionUpdateMode: {
      type: "string", enum: ["complete", "retain_unmentioned"],
      description: "可明确选择 retain_unmentioned：epistemicPositions 只提交改变或新增的立场，本地原样沿用仍在当前感知范围内的其他既有立场，不把旧证据当作本轮新观察。complete 或省略此字段表示提交完整列表；遗漏未决立场仍会被拒。",
    },
    noticedEvidenceIds: { type: "array", items: { type: "string" } },
    interpretations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["evidenceIds", "meaning", "confidence"],
        properties: {
          evidenceIds: { type: "array", items: { type: "string" } },
          meaning: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    beliefOperations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["proposition", "operation", "confidence", "sourceEvidenceIds", "reasoningMode"],
        properties: {
          proposition: { type: "string" },
          operation: { type: "string", enum: ["adopt", "revise", "doubt", "reject", "suspend"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          sourceEvidenceIds: { type: "array", items: { type: "string" } },
          reasoningMode: { type: "string", enum: ["direct", "inference", "rumor", "guess", "confabulation"] },
        },
      },
    },
    epistemicPositions: {
      type: "array",
      maxItems: 12,
      description: "本人对不同认识问题分别形成的私有立场。最终确认与当前可否暂时据此行动是两件事；identity、ability、intent 等域不得自动共享怀疑强度。只有当前没有相关认识问题、也没有仍被感知对象的既有未决立场时才可为空；省略不能替代遗忘或改变判断。上一回合留下、本轮毫无改动的立场仍必须在这里占一个条目，但可以只写 positionId、domain、subjectHandle 并把 carriedUnchanged 设为 true，其余字段省略——本地会按 id 原样恢复上一回合的内容。",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["positionId", "domain", "subjectHandle"],
        optionalProperties: [
          "carriedUnchanged", "proposition", "confidence", "status",
          "workingStance", "relianceScope", "basisEvidenceIds", "basisPsychologicalSourceIds", "privateReason",
        ],
        properties: {
          carriedUnchanged: {
            type: "boolean",
            description: "true 表示这条立场与上一回合完全相同（confidence、status、workingStance、relianceScope、proposition 与依据都没变），本轮按 id 原样保留，其余字段一律省略。只要有任何一处改变，就必须省略这个字段并完整写出全部内容。",
          },
          positionId: { type: "string" },
          domain: { type: "string", enum: [...CHARACTER_EPISTEMIC_DOMAINS] },
          subjectHandle: { type: "string" },
          proposition: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          status: { type: "string", enum: [...CHARACTER_EPISTEMIC_STATUSES] },
          workingStance: { type: "string", enum: [...CHARACTER_EPISTEMIC_WORKING_STANCES] },
          relianceScope: { type: "string", enum: [...CHARACTER_EPISTEMIC_RELIANCE_SCOPES] },
          basisEvidenceIds: { type: "array", items: { type: "string" } },
          basisPsychologicalSourceIds: { type: "array", items: { type: "string" } },
          privateReason: { type: "string" },
        },
      },
    },
    relevanceLinks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceId", "relation", "strength", "confidence"],
        properties: {
          sourceId: { type: "string" },
          relation: { type: "string" },
          strength: { type: "number", minimum: 0, maximum: 1 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    desireGroundings: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "desireId", "feltWant", "terminalExperience", "terminalContractAcknowledged",
          "promotedCriteria", "activationState", "activationEvidenceIds", "activationPsychologicalSourceIds",
          "missingActivationConditions", "immediatePull", "currentlyPerceivedPossible",
          "inhibitors", "acceptableTransformations", "privateSummary",
        ],
        properties: {
          desireId: { type: "string" },
          feltWant: { type: "string" },
          terminalExperience: { type: "string" },
          terminalContractAcknowledged: {
            type: "boolean",
            enum: [true],
            description: "只确认本人读过终局合同；不得逐条复述成当前待办或问话。",
          },
          promotedCriteria: {
            type: "array",
            description: "通常为空。只有人物本人认为某条终局条件在这一刻具有独立依据和现实显著性时才列出；条件仅仅存在于欲望中不构成提升理由。current_concern 只授权它成为候选来源，不表示行动前必须先解决。",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "criterionId", "mode", "basisEvidenceIds", "basisPsychologicalSourceIds",
                "basisStateFactors", "privateReason",
              ],
              properties: {
                criterionId: { type: "string" },
                mode: { type: "string", enum: [...CHARACTER_DESIRE_CRITERION_PROMOTION_MODES] },
                basisEvidenceIds: { type: "array", items: { type: "string" } },
                basisPsychologicalSourceIds: { type: "array", items: { type: "string" } },
                basisStateFactors: { type: "array", items: { type: "string", enum: [...CHARACTER_DESIRE_CRITERION_STATE_FACTORS] } },
                privateReason: { type: "string" },
              },
            },
          },
          activationState: {
            type: "string", enum: ["inactive", "latent", "uncertain", "triggered", "active"],
            description: "欲望是否在心理上起作用，不是当前行动是否可行。只有 activationMode=cue_gated 的欲望才可因缺少触发线索而填 inactive 或 latent；persistent 欲望不得使用这两个值。尚未找到目标、能力未知或行动条件不足，应体现在 currentlyPerceivedPossible 与 inhibitors，不表示欲望潜伏。",
          },
          activationEvidenceIds: {
            type: "array",
            items: { type: "string" },
            description: "Only current world evidence personally noticed in this turn; never put memory, belief, value, self-schema, relationship or desire ids here",
          },
          activationPsychologicalSourceIds: {
            type: "array",
            items: { type: "string" },
            description: "Owned memory, belief, value, self-schema, relationship, commitment or desire ids that make the desire matter now; these are internal sources, not perceived world evidence",
          },
          missingActivationConditions: { type: "array", items: { type: "string" } },
          immediatePull: { type: "number", minimum: 0, maximum: 1 },
          currentlyPerceivedPossible: { type: "number", minimum: 0, maximum: 1 },
          inhibitors: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "strength", "basisEvidenceIds"],
              properties: {
                kind: { type: "string", enum: ["audience", "venue_norm", "harm", "body", "duty", "relationship", "uncertainty", "access", "other"] },
                strength: { type: "number", minimum: 0, maximum: 1 },
                basisEvidenceIds: { type: "array", items: { type: "string" } },
              },
            },
          },
          acceptableTransformations: { type: "array", items: { type: "string", enum: ["place", "timing", "intensity", "disclosure", "manner"] } },
          privateSummary: { type: "string" },
        },
      },
    },
    appraisalAxes: {
      type: "object",
      additionalProperties: false,
      required: [
        "selfRelevance", "goalCongruence", "novelty", "expectedness", "opportunityValue",
        "threat", "controllability", "changeability", "certaintyDelta", "normCompatibility",
        "selfImageCongruence", "publicExposure", "relationshipMeaning",
      ],
      properties: {
        selfRelevance: { type: "number", minimum: -1, maximum: 1 },
        goalCongruence: { type: "number", minimum: -1, maximum: 1 },
        novelty: { type: "number", minimum: -1, maximum: 1 },
        expectedness: { type: "number", minimum: -1, maximum: 1 },
        opportunityValue: { type: "number", minimum: -1, maximum: 1 },
        threat: { type: "number", minimum: -1, maximum: 1 },
        controllability: { type: "number", minimum: -1, maximum: 1 },
        changeability: { type: "number", minimum: -1, maximum: 1 },
        certaintyDelta: { type: "number", minimum: -1, maximum: 1 },
        normCompatibility: { type: "number", minimum: -1, maximum: 1 },
        selfImageCongruence: { type: "number", minimum: -1, maximum: 1 },
        publicExposure: { type: "number", minimum: -1, maximum: 1 },
        relationshipMeaning: relationshipMeaningSchema,
      },
    },
    uncertainty: { type: "number", minimum: 0, maximum: 1 },
    alternativesConsidered: { type: "array", items: { type: "string" } },
    entityModelUpdates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["perceivedEntityHandle", "noticedEvidenceIds", "hypotheses", "identityCandidates", "affectiveResponse", "attentionPriority"],
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
                operation: { type: "string", enum: ["adopt", "revise", "doubt", "reject", "suspend"] },
                confidenceBand: { type: "string", enum: ["low", "medium", "high"] },
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
                operation: { type: "string", enum: ["adopt", "revise", "doubt", "reject", "suspend"] },
                confidenceBand: { type: "string", enum: ["low", "medium", "high"] },
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
          "subjectHandle", "locationHandle", "operation", "assertedLikelihood", "sourceReliability",
          "confidenceBand", "basisEvidenceIds", "sourceType",
        ],
        properties: {
          subjectHandle: { type: "string" },
          locationHandle: { type: "string" },
          operation: { type: "string", enum: ["revise", "decrease", "doubt", "reject", "suspend"] },
          assertedLikelihood: { type: "number", minimum: 0, maximum: 1 },
          sourceReliability: { type: "number", minimum: 0, maximum: 1 },
          confidenceBand: { type: "string", enum: ["low", "medium", "high"] },
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
          "sourceHandle", "subjectHandle", "operation", "assertedLikelihood", "sourceReliability",
          "confidenceBand", "basisEvidenceIds",
        ],
        properties: {
          sourceHandle: { type: "string" },
          subjectHandle: { type: "string" },
          operation: { type: "string", enum: ["revise", "decrease", "doubt", "reject", "suspend"] },
          assertedLikelihood: { type: "number", minimum: 0, maximum: 1 },
          sourceReliability: { type: "number", minimum: 0, maximum: 1 },
          confidenceBand: { type: "string", enum: ["low", "medium", "high"] },
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
    relationshipAppraisal: tavernCharacterRelationshipAppraisalSchema,
    priorActionOutcomeAppraisal: {
      type: "object",
      additionalProperties: false,
      required: [
        "ownerAuthority", "sourceAgentTurnId", "status", "noticedOutcomeEvidenceIds",
        "perceivedInformationGain", "perceivedGoalProgress", "perceivedCost",
        "unexpectedness", "stillUnresolved", "summary",
      ],
      properties: {
        ownerAuthority: { type: "string", enum: ["character-agent"] },
        sourceAgentTurnId: { type: "string" },
        status: { type: "string", enum: ["no_prior_action", "perceived", "unclear", "unnoticed"] },
        noticedOutcomeEvidenceIds: { type: "array", items: { type: "string" } },
        perceivedInformationGain: { type: "number", minimum: 0, maximum: 1 },
        perceivedGoalProgress: { type: "number", minimum: -1, maximum: 1 },
        perceivedCost: { type: "number", minimum: 0, maximum: 1 },
        unexpectedness: { type: "number", minimum: 0, maximum: 1 },
        stillUnresolved: { type: "boolean" },
        summary: { type: "string" },
      },
    },
  },
};

const factorInputsSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "emotionCompatibility", "valueAndSelfImage", "relationshipMeaning", "informationGain",
    "habitAndIntentionContinuity", "bodyCost", "threatAndNormCost",
    "exposureAndRelationshipRisk", "opportunityAndSwitchingCost", "uncertaintyCost",
  ],
  properties: Object.fromEntries([
    "emotionCompatibility", "valueAndSelfImage", "relationshipMeaning", "informationGain",
    "habitAndIntentionContinuity", "bodyCost", "threatAndNormCost",
    "exposureAndRelationshipRisk", "opportunityAndSwitchingCost", "uncertaintyCost",
  ].map((id) => [id, { type: "number", minimum: 0, maximum: 1 }])),
};

export const tavernCharacterCandidatesV2Schema = {
  type: "object",
  additionalProperties: false,
  required: ["ownerAuthority", "agentTurnId", "candidates"],
  properties: {
    ownerAuthority: { type: "string", enum: ["character-agent"] },
    agentTurnId: { type: "string" },
    candidates: {
      type: "array",
      minItems: 1,
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "originAuthority", "candidateId", "intention", "attemptPrimitive", "targetHandle", "actionBinding",
          "perceivedPrerequisites", "domains", "expectedEffects", "desireRelations", "criterionUses", "epistemicHandling", "sharedActivity", "factorInputs", "timingIntent",
          "uncertainty",
        ],
        properties: {
          originAuthority: { type: "string", enum: ["character-agent"] },
          candidateId: { type: "string" },
          intention: { type: "string", description: "人物私下考虑的单一动作与目标。共同活动的完整条件只写进 sharedActivity，不在这里预写公开命题、披露提纲或台词。" },
          attemptPrimitive: { type: "string", enum: CHARACTER_ATTEMPT_PRIMITIVES, description: "interact 对物品仅触碰，不会做工或改变资源。做工、装水、倒水、备餐、验收须选相应 affordance 的 use_affordance 操作；开始不等于完成。" },
          targetHandle: { type: "string" },
          actionBinding: {
            type: "object",
            description: "把这个候选绑定到一个具体世界锚点：kind 指明锚点类型，且只填写对应的那一个 id，其余 id 直接省略不写；none 表示此动作不需要世界锚点，五个 id 全部省略。复合意图（走过去、坐下、再观察）拆成当前主动作一个绑定，其余留给 continuationIntentions。选择后动作身份被锁定，实现阶段不能换成别的动作或别的锚点。",
            additionalProperties: false,
            required: ["kind"],
            optionalProperties: ["targetCharacterId", "objectId", "destinationId", "positionId", "affordanceId"],
            properties: {
              kind: { type: "string", enum: ["none", "character", "object", "place", "position", "affordance"] },
              targetCharacterId: { type: "string" },
              objectId: { type: "string" },
              destinationId: { type: "string" },
              positionId: { type: "string" },
              affordanceId: { type: "string" },
            },
          },
          feasibilityHandling: {
            type: "object",
            description: "人物如何使用当前可知的行动可行性。它不是世界替人物选动作：follow 表示按已知前提行动，question 表示本人怀疑该判断，deliberate_attempt 表示明知当前条件冲突仍要尝试，unknown 表示信息不足，not_applicable 表示本候选与现有可行性表面无关。relationToGoal 描述当前动作与所引用 surface 的关系；它不描述动作与人物长期欲望的关系，后者写入 desireRelations。",
            additionalProperties: false,
            required: ["surfaceId", "relationToGoal", "stance", "privateReason"],
            properties: {
              surfaceId: { type: "string" },
              relationToGoal: {
                type: "string", enum: ["direct_attempt", "prerequisite_step", "exploratory", "unrelated"],
                description: "prerequisite_step + follow 必须对应该 surface 的一项 currentlyAttemptable 不为 false 的 knownPrerequisiteOptions，且本候选 attemptPrimitive、actionBinding.destinationId 与其 primitive、destinationId 一致。该列表为空时不能声称遵循前置步骤。直接检查一个可操作物件属于对该物件的 direct_attempt，即使人物把它当作后续目标的准备。",
              },
              stance: { type: "string", enum: ["follow", "question", "deliberate_attempt", "unknown", "not_applicable"] },
              privateReason: { type: "string" },
            },
          },
          perceivedPrerequisites: { type: "array", items: { type: "string" } },
          domains: { type: "array", minItems: 1, items: { type: "string" } },
          expectedEffects: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["sourceId", "direction", "magnitude", "confidence"],
              properties: {
                sourceId: { type: "string" },
                direction: { type: "string" },
                magnitude: { type: "number", minimum: 0, maximum: 1 },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
            },
          },
          desireRelations: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "desireId", "relation", "terminalConditionMatch", "counterfactualResult",
                "preservesNonSubstitutableConditions", "confidence",
              ],
              properties: {
                desireId: { type: "string" },
                relation: { type: "string", enum: ["direct_contact", "enable", "probe", "defer", "avoid", "substitute", "unrelated"] },
                terminalConditionMatch: { type: "number", minimum: 0, maximum: 1 },
                counterfactualResult: { type: "string", minLength: 1 },
                preservesNonSubstitutableConditions: { type: "boolean" },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
            },
          },
          criterionUses: {
            type: "array",
            description: "默认空。候选若专门核实、保护或推进一条终局条件，只能引用主观评价中已由本人提升为 current_concern 的 criterion。",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["desireId", "criterionId", "use", "privatePurpose"],
              properties: {
                desireId: { type: "string" },
                criterionId: { type: "string" },
                use: { type: "string", enum: [...CHARACTER_DESIRE_CRITERION_USE_TYPES] },
                privatePurpose: { type: "string" },
              },
            },
          },
          epistemicHandling: {
            type: "object",
            description: "这个候选如何对待本人当前相关的不确定性。它可以先核验，也可以暂时采用、边行动边验证、保持悬置后继续、回避或利用歧义；数学只计算代价与学习机会，不替人物选择。没有相关不确定性时使用 not_relevant。",
            additionalProperties: false,
            required: [
              "positionIds", "mode", "errorIfWrong", "actionReversibility",
              "learningDuringAction", "delayCost", "privateReason",
            ],
            properties: {
              positionIds: { type: "array", items: { type: "string" } },
              mode: { type: "string", enum: [...CHARACTER_EPISTEMIC_ACTION_MODES] },
              errorIfWrong: { type: "number", minimum: 0, maximum: 1 },
              actionReversibility: { type: "number", minimum: 0, maximum: 1 },
              learningDuringAction: { type: "number", minimum: 0, maximum: 1 },
              delayCost: { type: "number", minimum: 0, maximum: 1 },
              privateReason: { type: "string" },
            },
          },
          sharedActivity: {
            type: "object",
            description: "只表示需要双方同意并由世界持续结算的真实共同行动；普通提问、回答和交谈使用对话线程，operation 必须为 none。operation 为 none 时，其余字段全部省略不写，不要填空字符串或空对象。",
            additionalProperties: false,
            required: ["operation"],
            optionalProperties: ["activityId", "kind", "participantIds", "requestedZoneId", "response", "boundaries"],
            properties: {
              operation: { type: "string", enum: ["none", "propose", "respond", "coordinate", "start", "complete", "withdraw"] },
              activityId: { type: "string" },
              kind: { type: "string", description: "真实共同承诺的种类，例如 controlled_spar、escort、joint_task；不要填写 conversation、inquiry 或其他普通轮流说话的名称。" },
              participantIds: { type: "array", items: { type: "string" } },
              requestedZoneId: { type: "string" },
              response: { type: "string", enum: ["none", "accept", "refuse", "counter"] },
              boundaries: {
                type: "object",
                additionalProperties: false,
                required: ["intensity", "propertyProtection", "harmLimit", "note"],
                properties: {
                  intensity: { type: "string" },
                  propertyProtection: { type: "boolean" },
                  harmLimit: { type: "string" },
                  note: { type: "string" },
                },
              },
            },
          },
          factorInputs: factorInputsSchema,
          timingIntent: { type: "string" },
          uncertainty: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

const communicationPlanV2Schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "goal", "tactic", "disclosure", "epistemicRelation", "intendedAudienceCharacterIds",
    "desiredEffect", "threadDisposition", "epistemicActionCandidateId",
    "presuppositionStance", "epistemicBasisEvidenceIds", "subtext",
  ],
  properties: {
    goal: { type: "string", enum: COMMUNICATION_GOALS },
    tactic: { type: "string", enum: COMMUNICATION_TACTICS },
    disclosure: { type: "string", enum: COMMUNICATION_DISCLOSURES },
    epistemicRelation: { type: "string", enum: COMMUNICATION_EPISTEMIC_RELATIONS },
    intendedAudienceCharacterIds: { type: "array", items: { type: "string" } },
    desiredEffect: { type: "string" },
    threadDisposition: { type: "string", enum: THREAD_DISPOSITIONS },
    epistemicActionCandidateId: { type: "string" },
    presuppositionStance: { type: "string", enum: PRESUPPOSITION_STANCES },
    epistemicBasisEvidenceIds: { type: "array", items: { type: "string" } },
    subtext: { type: "string" },
  },
};

const automaticCommunicationImpulseV2Schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "ownerAuthority", "impulseId", "mode", "triggerEvidenceIds", "discourseAnchorIds",
    "motiveSourceIds", "perceivedTurnDemand", "feltTendency", "urgency",
    "disclosurePressure", "inhibitionPressure", "conflict",
  ],
  properties: {
    ownerAuthority: { type: "string", enum: ["character-agent"] },
    impulseId: { type: "string" },
    mode: { type: "string", enum: ["speech", "silence", "nonverbal", "mixed", "none"] },
    triggerEvidenceIds: { type: "array", items: { type: "string" }, description: "真正被本人感知并触发此冲动的证据；可以为空，但不能引用世界全知事实" },
    discourseAnchorIds: { type: "array", items: { type: "string" }, description: "此刻自动承接的共同经历、本人行动或字面话语锚点" },
    motiveSourceIds: { type: "array", items: { type: "string" }, description: "人物自己的欲望、价值、自我认识、关系或记忆来源；数学和世界 id 不属于这里" },
    perceivedTurnDemand: { type: "string", description: "调节前，人物觉得这个交流时刻正在向自己索取什么" },
    feltTendency: { type: "string", description: "调节前最先涌出的语义与情感方向，例如想反问、只承认一部分、堵回去或沉默；不是完整台词" },
    urgency: { type: "number", minimum: 0, maximum: 1 },
    disclosurePressure: { type: "number", minimum: 0, maximum: 1 },
    inhibitionPressure: { type: "number", minimum: 0, maximum: 1 },
    conflict: {
      type: "object",
      additionalProperties: false,
      required: ["present", "opposingSourceIds", "description"],
      properties: {
        present: { type: "boolean" },
        opposingSourceIds: { type: "array", items: { type: "string" } },
        description: { type: "string", description: "冲突存在时写人物自己的私有描述；没有冲突时留空" },
      },
    },
  },
};

export const tavernCharacterRegulatedExpressionPlanV2Schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "ownerAuthority", "sourceImpulseId", "impulseTransformation", "mode", "actionIntent", "publicStance",
    "nonverbalUndertone", "privateRemainderPresent", "relationshipStance", "timing", "turnYield",
  ],
  properties: {
    ownerAuthority: { type: "string", enum: ["character-agent"] },
    sourceImpulseId: { type: "string" },
    impulseTransformation: {
      type: "object",
      additionalProperties: false,
      required: ["treatment", "privateBasis"],
      properties: {
        treatment: { type: "string", enum: ["express", "mask", "redirect", "delay", "withhold", "blend", "not_applicable"] },
        privateBasis: { type: "string", description: "人物如何处理自动冲动的私有依据；最终措辞阶段不可见" },
      },
    },
    mode: { type: "string", enum: ["speech", "nonverbal", "mixed", "silence"] },
    actionIntent: { type: "string", description: "只写准备让身体或声音尝试什么，不写选择它的完整心理理由，也不预写台词" },
    publicStance: {
      type: "object",
      additionalProperties: false,
      required: [
        "interactionMove", "releasedMeaning", "audienceCharacterIds", "disclosure", "epistemicRelation",
        "intendedEffect", "threadDisposition", "sharedContextAnchorIds", "sharedContextTreatment",
      ],
      properties: {
        interactionMove: { type: "string", enum: PUBLIC_INTERACTION_MOVES, description: "人物此刻允许进入公开行为的交往动作；不是句式、模板或待朗读的标签" },
        releasedMeaning: { type: "string", description: "调节后愿意让声音或动作承载的那一股意思；不是完整命题表，也不是预写台词" },
        audienceCharacterIds: { type: "array", items: { type: "string" } },
        disclosure: { type: "string", enum: COMMUNICATION_DISCLOSURES },
        epistemicRelation: { type: "string", enum: COMMUNICATION_EPISTEMIC_RELATIONS },
        intendedEffect: { type: "string", description: "人物希望对方出现的反应；可以为空，不能作为固定措辞" },
        threadDisposition: { type: "string", enum: THREAD_DISPOSITIONS },
        sharedContextAnchorIds: { type: "array", items: { type: "string" } },
        sharedContextTreatment: { type: "string", enum: SHARED_CONTEXT_TREATMENTS },
      },
    },
    nonverbalUndertone: { type: "string", description: "只供目光、停顿、呼吸、节奏与动作承载的情感质地；不得作为需要亲口解释的命题" },
    privateRemainderPresent: { type: "boolean", description: "是否仍有未公开内容；只给布尔边界，不把私密内容送进最终措辞阶段" },
    relationshipStance: { type: "string", description: "此刻以怎样的关系姿态面对对方，不是固定句式" },
    timing: { type: "string", enum: ["before_action", "during_action", "after_action", "standalone", "delayed", "silence"] },
    turnYield: { type: "string", enum: ["yield", "hold", "close", "not_applicable"] },
  },
};

export const tavernCharacterChoiceV2Schema = {
  type: "object",
  additionalProperties: false,
  required: ["ownerAuthority", "agentTurnId", "selectedCandidateId", "regulationChoice", "goalPreservation", "automaticCommunicationImpulse", "continuationIntentions", "privateDecisionBasis"],
  properties: {
    ownerAuthority: { type: "string", enum: ["character-agent"] },
    agentTurnId: { type: "string" },
    selectedCandidateId: { type: "string" },
    regulationChoice: {
      type: "object",
      additionalProperties: false,
      required: ["ownerAuthority", "regulationChoiceId", "agentTurnId", "strategies", "acceptedCosts"],
      properties: {
        ownerAuthority: { type: "string", enum: ["character-agent"] },
        regulationChoiceId: { type: "string" },
        agentTurnId: { type: "string" },
        strategies: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["strategy", "targetEmotionIds", "effort", "contextFit"],
            properties: {
              strategy: { type: "string", enum: ["suppress", "reappraise", "delay", "redirect", "conceal", "express", "seek_support", "disengage", "tolerate"] },
              targetEmotionIds: { type: "array", items: { type: "string" } },
              effort: { type: "number", minimum: 0, maximum: 1 },
              contextFit: { type: "number", minimum: 0, maximum: 1 },
            },
          },
        },
        acceptedCosts: { type: "array", items: { type: "string" } },
      },
    },
    goalPreservation: {
      type: "object",
      additionalProperties: false,
      required: [
        "preservedDesireIds", "transformedDimensions", "terminalExperiencePreserved",
        "acceptedDelay", "acceptedResidualFrustration", "privateBasis",
      ],
      properties: {
        preservedDesireIds: { type: "array", items: { type: "string" } },
        transformedDimensions: { type: "array", items: { type: "string", enum: ["place", "timing", "intensity", "disclosure", "manner"] } },
        terminalExperiencePreserved: { type: "boolean" },
        acceptedDelay: { type: "boolean" },
        acceptedResidualFrustration: { type: "number", minimum: 0, maximum: 1 },
        privateBasis: { type: "string" },
      },
    },
    automaticCommunicationImpulse: automaticCommunicationImpulseV2Schema,
    continuationIntentions: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "ownerAuthority", "intentionId", "triggerType", "intendedPrimitive", "targetHandle",
          "linkedSourceIds", "minimumDelaySeconds", "triggerThreshold", "maxDeferrals", "privatePurpose",
        ],
        properties: {
          ownerAuthority: { type: "string", enum: ["character-agent"] },
          intentionId: { type: "string" },
          triggerType: { type: "string", enum: CONTINUATION_TRIGGER_TYPES },
          intendedPrimitive: { type: "string", enum: CHARACTER_ATTEMPT_PRIMITIVES },
          targetHandle: { type: "string" },
          linkedSourceIds: { type: "array", items: { type: "string" } },
          minimumDelaySeconds: { type: "number", minimum: 0, maximum: 86400 },
          triggerThreshold: { type: "number", minimum: 0, maximum: 1 },
          maxDeferrals: { type: "integer", minimum: 0, maximum: 6 },
          privatePurpose: { type: "string" },
        },
      },
    },
    privateDecisionBasis: { type: "string" },
  },
};

export const tavernCharacterRealizationV2Schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "ownerAuthority", "agentTurnId", "emotionHandling", "surfaceRealization",
    "realizedSpeechHabitIds", "embodiedIntent", "utterance", "actionAttempt",
  ],
  properties: {
    ownerAuthority: { type: "string", enum: ["character-agent"] },
    agentTurnId: { type: "string" },
    emotionHandling: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["channel", "handling", "basis"],
        properties: {
          channel: { type: "string" },
          handling: { type: "string", enum: ["expressed", "displaced", "masked", "unavailable"] },
          basis: { type: "string" },
        },
      },
    },
    realizedSpeechHabitIds: {
      type: "array",
      items: { type: "string" },
      description: "只列实际进入本次声音、节奏、注意、披露或交接方式的条件性习惯；不是把所有高压力习惯照单全收。",
    },
    surfaceRealization: {
      type: "object",
      additionalProperties: false,
      required: [
        "timing", "affectiveTexture", "relationshipRegister", "appliedVoiceParameters",
        "intentionalDepartureReason",
      ],
      properties: {
        timing: { type: "string", enum: ["before_action", "during_action", "after_action", "standalone", "delayed", "silence"] },
        affectiveTexture: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["channel", "modality", "feature", "cue"],
            properties: {
              channel: { type: "string", description: "gaze、voiceOnset、breath、posture 等实际泄漏通道" },
              modality: { type: "string", enum: ["visual", "sound", "touch", "smell"] },
              feature: { type: "string", description: "他人可以感知的具体表面特征，不解释其私人原因" },
              cue: { type: "string", enum: Object.keys(PHYSICAL_AFFECTIVE_CUES), description: JSON.stringify(PHYSICAL_AFFECTIVE_CUES) },
            },
          },
          description: "情绪进入停顿、视线、呼吸、声音或动作后形成的公开感知表面；每项必须绑定传播媒介",
        },
        relationshipRegister: { type: "string" },
        appliedVoiceParameters: {
          type: "object",
          additionalProperties: false,
          required: ["directness", "compression", "warmth", "reserve", "formality", "emotionalLeakage"],
          properties: Object.fromEntries([
            "directness", "compression", "warmth", "reserve", "formality", "emotionalLeakage",
          ].map((id) => [id, { type: "number", minimum: 0, maximum: 1 }])),
        },
        intentionalDepartureReason: { type: "string" },
      },
    },
    embodiedIntent: {
      type: "object",
      additionalProperties: false,
      required: ["automaticReaction", "chosenRegulation", "manner", "posture", "intendedGesture"],
      properties: {
        automaticReaction: { type: "string" },
        chosenRegulation: { type: "string" },
        manner: { type: "string" },
        posture: { type: "string" },
        intendedGesture: { type: "string" },
        bodyActions: structuredClone(bodyActionsSchema),
      },
    },
    utterance: {
      type: "object",
      additionalProperties: false,
      required: ["literalSpeech", "vocalMode", "speechAct", "speechFunctions"],
      properties: {
        literalSpeech: { type: "string" },
        vocalMode: { type: "string", enum: ["conversational", "call_out"] },
        speechAct: { type: "string", enum: SPEECH_ACTS },
        speechFunctions: { type: "array", items: { type: "string", enum: SPEECH_ACTS } },
      },
    },
    actionAttempt: {
      type: "object",
      additionalProperties: false,
      required: ["primitive", "objectId", "targetCharacterId", "destinationId", "positionId", "affordanceId"],
      properties: {
        primitive: { type: "string", enum: CHARACTER_ATTEMPT_PRIMITIVES },
        objectId: { type: "string" },
        targetCharacterId: { type: "string" },
        destinationId: { type: "string" },
        positionId: { type: "string" },
        affordanceId: { type: "string" },
        contactOperation: { type: "string", enum: ["", "touch", "knock"], description: "interact 面向近旁地点时可明确触碰或叩击。叩声由接触结算产生，不由动作散文或情绪描述产生。其他动作留空。" },
        waitCondition: structuredClone(waitConditionSchema),
      },
    },
  },
};

export const tavernCharacterTurnCommitV2Schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "ownerAuthority", "agentTurnId", "privateExpressionTrace", "conversationAnchorSelection",
    "actionAttempt", "publicExpression",
  ],
  properties: {
    ownerAuthority: { type: "string", enum: ["character-agent"] },
    agentTurnId: { type: "string" },
    privateExpressionTrace: {
      type: "object",
      additionalProperties: false,
      required: ["affectiveInfluence"],
      properties: {
        affectiveInfluence: {
          type: "object",
          description: "人物在完成公开表达后，记录仍活着的情绪实际去了哪里。它用于私人连续性和公开泄漏一致性，不是台词提纲。",
          additionalProperties: false,
          required: ["mode", "privateBasis"],
          properties: {
            sourceEmotionIds: { type: "array", items: { type: "string", enum: [...CHARACTER_PSYCHOLOGY_EMOTION_IDS] }, description: "可省略。活情绪列表已由冻结的调节结果保存，无需再抄写；若主动引用则必须准确。" },
            mode: {
              type: "string",
              enum: AFFECTIVE_INFLUENCE_MODES,
              description: "这是 publicExpression 写定后对实际结果的私人记录。affectiveDeltas 非空时必须为 leak_publicly，并用 primaryChannelId 对应真实泄漏通道；contained_privately、shape_wording、shape_timing、shape_action 不得同时提交公开情绪泄漏。",
            },
            primaryChannelId: {
              type: "string", enum: ["", ...CHARACTER_PSYCHOLOGY_LEAKAGE_CHANNELS],
              description: "只要 sourceEmotionIds 非空，就必须填写一个仍有压力的真实通道；即使 mode=contained_privately 或 shape_wording，也不能留空。通道承受压力不等于公开泄漏，是否泄漏由 mode 与 affectiveDeltas 表达。",
            },
            privateBasis: { type: "string" },
          },
        },
      },
    },
    conversationAnchorSelection: {
      type: "object",
      description: "若这句话回复或续接既有对话，只选择本轮提供的 opaque anchor、reply/continue 模式和目标人物 handle；不得填写 world thread、source action 或 parent turn。人物还必须在写定实际台词后选择：保留本人一侧可续接、只关闭本人一侧，或在没有说话时不产生线程。不得由台词字面猜测结束意图。",
      additionalProperties: false,
      required: ["anchorHandle", "mode", "targetParticipantHandle", "postTurnDisposition"],
      properties: {
        anchorHandle: { type: "string" },
        mode: { type: "string", enum: ["none", "reply", "continue"] },
        targetParticipantHandle: { type: "string" },
        postTurnDisposition: { type: "string", enum: ATOMIC_POST_TURN_DISPOSITIONS },
      },
    },
    actionAttempt: clone(tavernCharacterRealizationV2Schema.properties.actionAttempt),
    publicExpression: {
      type: "object",
      additionalProperties: false,
      required: [
        "mode", "audienceCharacterIds", "timing", "utterance", "bodyDelta", "bodyActions", "affectiveDeltas",
      ],
      properties: {
        mode: { type: "string", enum: ["speech", "nonverbal", "mixed", "silence"] },
        audienceCharacterIds: { type: "array", items: { type: "string" } },
        timing: { type: "string", enum: ["before_action", "during_action", "after_action", "standalone", "delayed", "silence"] },
        utterance: {
          type: "object",
          description: "只提交人物实际说出的字面话与发声方式；speech act/functions 由服务端在字面话生成后结合对话现场观察，不由人物预先自报。",
          additionalProperties: false,
          required: ["literalSpeech", "vocalMode"],
          properties: {
            literalSpeech: { type: "string" },
            vocalMode: { type: "string", enum: ["conversational", "call_out"] },
          },
        },
        bodyDelta: {
          type: "string",
          description: "可选动作意图草稿，无额外文字时为空。此文字不会成为公开事实；实际动作由 actionAttempt、bodyActions 与世界结算决定，不得用散文代替拿物、移动或工作操作。",
        },
        bodyActions: structuredClone(bodyActionsSchema),
        affectiveDeltas: {
          ...clone(tavernCharacterRealizationV2Schema.properties.surfaceRealization.properties.affectiveTexture),
          maxItems: 2,
          description: "零至两个这一刻新泄漏、且别人可能感知到的情绪变化；feature 使用 expressionMoment.expressionProtocol.publicDescriptionLanguage。这是事件接口描述，不是人物使用的剧情内语言。没有显著变化就用空数组；不要用常态语气、既有姿势或物件不变来填表。",
        },
      },
    },
  },
};

export const tavernCharacterReflectionV27Schema = {
  type: "object",
  additionalProperties: false,
  required: ["ownerAuthority", "insights"],
  properties: {
    ownerAuthority: { type: "string", enum: ["character-agent"] },
    insights: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["proposition", "sourceMemoryIds", "confidence", "importance", "semanticFrame"],
        properties: {
          proposition: { type: "string" },
          sourceMemoryIds: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          importance: { type: "number", minimum: 0, maximum: 1 },
          semanticFrame: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "predicate", "topicId", "lexicalAnchors"],
            properties: {
              kind: { type: "string", enum: ["reflection_insight"] },
              predicate: { type: "string" },
              topicId: { type: "string" },
              lexicalAnchors: {
                type: "array",
                maxItems: 8,
                items: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

export const tavernCharacterDayPlanningV27Schema = {
  type: "object",
  additionalProperties: false,
  required: ["ownerAuthority", "planBlocks"],
  properties: {
    ownerAuthority: { type: "string", enum: ["character-agent"] },
    planBlocks: {
      type: "array",
      minItems: 5,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "relativeStartSeconds", "relativeEndSeconds", "activityType",
          "desiredZoneHandle", "privatePurpose", "sourceIds",
        ],
        properties: {
          relativeStartSeconds: { type: "number", minimum: 0, maximum: 86_400 },
          relativeEndSeconds: { type: "number", minimum: 0, maximum: 86_400 },
          activityType: { type: "string", minLength: 1 },
          desiredZoneHandle: { type: "string" },
          privatePurpose: { type: "string", minLength: 1 },
          sourceIds: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: { type: "string" },
          },
        },
      },
    },
  },
};

function ownedPsychologicalSourceIds(stageInput = {}) {
  return [...new Set((stageInput.referenceContract?.ownedPsychologicalSourceIds || [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean))];
}

function bindOwnedPsychologicalSources(schema = {}, phase = "", sourceIds = []) {
  const copy = structuredClone(schema);
  let sourceArraySchema = null;
  let sourceIdSchema = null;
  if (phase === "awaiting_subjective_appraisal") {
    sourceArraySchema = copy.properties?.relevanceLinks;
    sourceIdSchema = sourceArraySchema?.items?.properties?.sourceId;
  } else if (phase === "awaiting_agent_candidates") {
    sourceArraySchema = copy.properties?.candidates?.items?.properties?.expectedEffects;
    sourceIdSchema = sourceArraySchema?.items?.properties?.sourceId;
  } else if (phase === "awaiting_agent_choice_and_regulation") {
    sourceArraySchema = copy.properties?.continuationIntentions?.items?.properties?.linkedSourceIds;
    sourceIdSchema = sourceArraySchema?.items;
  }
  if (!sourceArraySchema || !sourceIdSchema) return copy;
  if (sourceIds.length) {
    sourceIdSchema.enum = sourceIds;
  } else {
    sourceArraySchema.maxItems = 0;
  }
  const bindDesireId = (node) => {
    if (!node) return;
    if (sourceIds.length) node.enum = sourceIds;
  };
  if (phase === "awaiting_subjective_appraisal") {
    bindDesireId(copy.properties?.desireGroundings?.items?.properties?.desireId);
    const activationSources = copy.properties?.desireGroundings?.items?.properties?.activationPsychologicalSourceIds;
    if (activationSources?.items) {
      if (sourceIds.length) activationSources.items.enum = sourceIds;
      else activationSources.maxItems = 0;
    }
    const promotionSources = copy.properties?.desireGroundings?.items?.properties?.promotedCriteria
      ?.items?.properties?.basisPsychologicalSourceIds;
    if (promotionSources?.items) {
      if (sourceIds.length) promotionSources.items.enum = sourceIds;
      else promotionSources.maxItems = 0;
    }
    const epistemicSources = copy.properties?.epistemicPositions?.items?.properties?.basisPsychologicalSourceIds;
    if (epistemicSources?.items) {
      if (sourceIds.length) epistemicSources.items.enum = sourceIds;
      else epistemicSources.maxItems = 0;
    }
  }
  if (phase === "awaiting_agent_candidates") {
    bindDesireId(copy.properties?.candidates?.items?.properties?.desireRelations?.items?.properties?.desireId);
    bindDesireId(copy.properties?.candidates?.items?.properties?.criterionUses?.items?.properties?.desireId);
  }
  if (phase === "awaiting_agent_choice_and_regulation") {
    const preservedIds = copy.properties?.goalPreservation?.properties?.preservedDesireIds;
    if (preservedIds?.items && sourceIds.length) preservedIds.items.enum = sourceIds;
    for (const sourceArray of [
      copy.properties?.automaticCommunicationImpulse?.properties?.motiveSourceIds,
      copy.properties?.automaticCommunicationImpulse?.properties?.conflict?.properties?.opposingSourceIds,
    ]) {
      if (!sourceArray?.items) continue;
      if (sourceIds.length) sourceArray.items.enum = sourceIds;
      else sourceArray.maxItems = 0;
    }
  }
  return copy;
}

function bindConversationSelection(schema, anchors) {
  if (!schema?.properties) return;
  const none = clone(schema);
  delete none.anyOf;
  for (const [field, value] of Object.entries({ mode: "none", anchorHandle: "", targetParticipantHandle: "" })) {
    none.properties[field].enum = [value];
  }
  const branches = [none];
  const seen = new Set();
  for (const anchor of anchors) {
    const signature = JSON.stringify([anchor.anchorHandle, anchor.allowedModes, anchor.participantHandles, projectedReplyTargets(anchor)]);
    if (seen.has(signature) || !anchor.participantHandles?.length || !anchor.allowedModes?.length) continue;
    seen.add(signature);
    for (const mode of anchor.allowedModes) {
      const targets = mode === "reply" ? projectedReplyTargets(anchor) : anchor.participantHandles;
      if (!targets.length) continue;
      const branch = clone(none);
      branch.properties.mode.enum = [mode];
      branch.properties.anchorHandle.enum = [anchor.anchorHandle];
      branch.properties.targetParticipantHandle.enum = targets;
      branches.push(branch);
    }
  }
  schema.anyOf = branches;
}

function additionalActionFields(action = {}) {
  const primitive = clean(action.primitive || action.attemptPrimitive);
  // Every physical action may carry an utterance to a perceived recipient.
  // A primary character binding is still locked separately below.
  const fields = new Set(["targetCharacterId"]);
  // Recipients and placement destinations are secondary parameters of these
  // object operations, not replacements for the selected object binding.
  if (["show", "transfer", "use_affordance"].includes(primitive)) fields.add("targetCharacterId");
  if (["show", "transfer"].includes(primitive)) fields.add("objectId");
  if (["place", "store"].includes(primitive)) fields.add("destinationId");
  if (!action.actionBinding?.kind || action.actionBinding.kind === "none") {
    if (["speak", "observe", "listen", "act", "gesture", "interact"].includes(primitive)) fields.add("targetCharacterId");
    if (["move", "leave"].includes(primitive)) fields.add("destinationId");
    if (["pickup", "take_out", "show", "hide", "store", "draw", "sheathe", "transfer", "place", "consume"].includes(primitive)) fields.add("objectId");
    if (primitive === "use_affordance") fields.add("affordanceId");
  }
  return fields;
}

/**
 * Bind structured output references to sources the current character actually
 * owns. World obligations and affordances remain visible materials, but they
 * cannot enter private desire/value/memory links merely because they also have
 * an `id` field.
 */
export function tavernCharacterAgentV2OutputSchemaForStage(stageInput = {}) {
  const phase = String(stageInput.phase || "").trim();
  if (phase === "awaiting_subjective_appraisal_and_candidates") {
    const appraisalStageInput = {
      ...stageInput,
      phase: "awaiting_subjective_appraisal",
      requestedOutput: "subjective_appraisal_only",
    };
    const candidateStageInput = {
      ...stageInput,
      phase: "awaiting_agent_candidates",
      requestedOutput: "character_generated_candidates_only",
      referenceContract: {
        ...clone(stageInput.referenceContract || {}),
        // The sibling appraisal has not been parsed yet, so structured-output
        // enums may use any owned terminal criterion. The normal candidate
        // validator later narrows this to criteria actually promoted as a
        // current concern by that sibling appraisal.
        currentConcernCriterionIds: clone(
          stageInput.referenceContract?.ownedDesireCriterionIds || [],
        ),
        // Position ids are authored by the sibling appraisal in the same JSON
        // object and cannot be expressed as a cross-property JSON-Schema enum.
        // This placeholder is removed below; protocol validation provides the
        // authoritative cross-reference check.
        ownedEpistemicPositionIds: ["__sibling_appraisal_position__"],
      },
    };
    const candidatesSchema = tavernCharacterAgentV2OutputSchemaForStage(candidateStageInput);
    const positionIds = candidatesSchema.properties?.candidates?.items
      ?.properties?.epistemicHandling?.properties?.positionIds;
    if (positionIds) {
      delete positionIds.maxItems;
      if (positionIds.items) delete positionIds.items.enum;
    }
    return {
      type: "object",
      additionalProperties: false,
      required: ["appraisal", "candidates"],
      properties: {
        appraisal: tavernCharacterAgentV2OutputSchemaForStage(appraisalStageInput),
        candidates: candidatesSchema,
      },
    };
  }
  if (phase === "awaiting_agent_choice_and_turn_commit") {
    const choiceSchema = tavernCharacterAgentV2OutputSchemaForStage({
      ...stageInput,
      phase: "awaiting_agent_choice_and_regulation",
      requestedOutput: "selected_candidate_regulation_and_automatic_impulse_only",
    });
    const commitSchema = clone(tavernCharacterTurnCommitV2Schema);
    if (commitSchema.properties?.agentTurnId) {
      commitSchema.properties.agentTurnId.enum = [clean(stageInput.agentTurnId)];
    }
    const contexts = stageInput.candidateCommitContexts || [];
    const moments = contexts.map((row) => row?.expressionMoment || {});
    // Regulation has not run yet in a combined call, so do not invent its
    // residual values. We can still enforce the state's independent format
    // rule: any cited live emotion needs a real channel, even when contained.
    const trace = commitSchema.properties.privateExpressionTrace.properties;
    const influence = trace.affectiveInfluence;
    const noInfluence = clone(influence);
    noInfluence.properties.mode.enum = ["no_live_influence"];
    noInfluence.properties.sourceEmotionIds.maxItems = 0;
    noInfluence.properties.primaryChannelId.enum = [""];
    const emptySources = clone(influence);
    emptySources.properties.mode.enum = AFFECTIVE_INFLUENCE_MODES.filter(mode => mode !== "no_live_influence");
    emptySources.properties.sourceEmotionIds.maxItems = 0;
    const withSources = clone(emptySources);
    delete withSources.properties.sourceEmotionIds.maxItems;
    withSources.properties.sourceEmotionIds.minItems = 1;
    withSources.properties.primaryChannelId.enum = [...CHARACTER_PSYCHOLOGY_LEAKAGE_CHANNELS];
    trace.affectiveInfluence = { anyOf: [noInfluence, emptySources, withSources] };
    const audienceIds = [...new Set(moments.flatMap((moment) => (
      moment.allowedAudienceCharacterIds || []
    )).map(clean).filter(Boolean))];
    const audiences = commitSchema.properties?.publicExpression?.properties?.audienceCharacterIds;
    if (audiences?.items) {
      if (audienceIds.length) audiences.items.enum = audienceIds;
      else audiences.maxItems = 0;
    }
    const anchors = moments.flatMap((moment) => moment.conversationAnchors?.anchors || []);
    const selection = commitSchema.properties?.conversationAnchorSelection?.properties || {};
    const anchorHandles = [...new Set(anchors.map((row) => clean(row?.anchorHandle)).filter(Boolean))];
    const modes = [...new Set(anchors.flatMap((row) => row?.allowedModes || []).map(clean).filter(Boolean))];
    const participants = [...new Set(anchors.flatMap((row) => row?.participantHandles || []).map(clean).filter(Boolean))];
    if (selection.anchorHandle) selection.anchorHandle.enum = ["", ...anchorHandles];
    if (selection.mode) selection.mode.enum = ["none", ...modes];
    if (selection.targetParticipantHandle) selection.targetParticipantHandle.enum = ["", ...participants];
    bindConversationSelection(commitSchema.properties.conversationAnchorSelection, anchors);
    const attempt = commitSchema.properties?.actionAttempt?.properties || {};
    const candidateActions = contexts.map((row) => row?.selectedAction || {});
    const primitives = [...new Set(candidateActions.map((row) => clean(row?.attemptPrimitive)).filter(Boolean))];
    if (attempt.primitive && primitives.length) attempt.primitive.enum = primitives;
    const bindingFields = {
      character: ["targetCharacterId", "targetCharacterId"],
      object: ["objectId", "objectId"],
      place: ["destinationId", "destinationId"],
      position: ["positionId", "positionId"],
      affordance: ["affordanceId", "affordanceId"],
    };
    for (const field of ["objectId", "targetCharacterId", "destinationId", "positionId", "affordanceId"]) {
      const values = candidateActions.flatMap((action) => {
        const binding = action?.actionBinding || {};
        const pair = bindingFields[clean(binding.kind)];
        return pair?.[1] === field ? [clean(binding[pair[0]])] : [];
      }).filter(Boolean);
      const kind = Object.entries(bindingFields).find(([, pair]) => pair[1] === field)?.[0];
      const allowed = candidateActions.some(action => additionalActionFields(action).has(field))
        ? stageInput.referenceContract?.perceivedTargetHandlesByBindingKind?.[kind] || [] : [];
      if (attempt[field]) attempt[field].enum = ["", ...new Set([...values, ...allowed])];
    }
    return {
      type: "object",
      additionalProperties: false,
      required: ["choice", "turnCommit"],
      properties: {
        choice: choiceSchema,
        turnCommit: commitSchema,
      },
    };
  }
  const baseSchemas = {
    awaiting_subjective_appraisal: tavernCharacterSubjectiveAppraisalV2Schema,
    awaiting_agent_candidates: tavernCharacterCandidatesV2Schema,
    awaiting_agent_choice_and_regulation: tavernCharacterChoiceV2Schema,
    awaiting_agent_turn_commit: tavernCharacterTurnCommitV2Schema,
    awaiting_agent_expression_planning: tavernCharacterRegulatedExpressionPlanV2Schema,
    awaiting_agent_realization: tavernCharacterRealizationV2Schema,
    awaiting_character_reflection: tavernCharacterReflectionV27Schema,
    awaiting_character_day_planning: tavernCharacterDayPlanningV27Schema,
  };
  const baseSchema = baseSchemas[phase];
  if (!baseSchema) throw new Error(`Unsupported Character Agent v2 phase: ${phase}`);
  const bound = bindOwnedPsychologicalSources(baseSchema, phase, ownedPsychologicalSourceIds(stageInput));
  if (bound.properties?.agentTurnId && clean(stageInput.agentTurnId)) {
    bound.properties.agentTurnId.enum = [clean(stageInput.agentTurnId)];
  }
  if (phase === "awaiting_character_day_planning") {
    const allowedSourceIds = [...new Set((stageInput.referenceContract?.ownedSourceIds || [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean))];
    const allowedZoneHandles = [...new Set((stageInput.referenceContract?.allowedZoneHandles || [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean))];
    bound.properties.planBlocks.minItems = stageInput.submissionContract?.minPlanBlocks ?? 5;
    bound.properties.planBlocks.maxItems = stageInput.submissionContract?.maxPlanBlocks ?? 8;
    const block = bound.properties?.planBlocks?.items;
    const sourceIds = block?.properties?.sourceIds;
    if (sourceIds?.items) {
      if (allowedSourceIds.length) sourceIds.items.enum = allowedSourceIds;
      else sourceIds.maxItems = 0;
    }
    const desiredZoneHandle = block?.properties?.desiredZoneHandle;
    if (desiredZoneHandle) desiredZoneHandle.enum = ["", ...allowedZoneHandles];
    const requestedHorizon = Number(stageInput.horizon?.durationSeconds);
    const horizonSeconds = Number.isFinite(requestedHorizon)
      ? Math.max(1, Math.min(86_400, requestedHorizon))
      : 86_400;
    if (block?.properties?.relativeStartSeconds) {
      block.properties.relativeStartSeconds.maximum = horizonSeconds;
    }
    if (block?.properties?.relativeEndSeconds) {
      block.properties.relativeEndSeconds.maximum = horizonSeconds;
    }
    return bound;
  }
  if (phase === "awaiting_character_reflection") {
    const allowedSourceMemoryIds = [...new Set((stageInput.submissionContract?.allowedSourceMemoryIds || [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean))];
    const sourceIds = bound.properties?.insights?.items?.properties?.sourceMemoryIds;
    if (sourceIds?.items) {
      if (allowedSourceMemoryIds.length) sourceIds.items.enum = allowedSourceMemoryIds;
      else sourceIds.maxItems = 0;
    }
    return bound;
  }
  const desireIds = [...new Set((stageInput.referenceContract?.ownedDesireIds || [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean))];
  const bindDesireEnum = (node) => {
    if (!node) return;
    if (desireIds.length) node.enum = desireIds;
  };
  if (phase === "awaiting_subjective_appraisal") {
    const perceivedPeople = stageInput.referenceContract?.perceivedCharacterHandles;
    const relationshipTarget = bound.properties?.relationshipAppraisal?.properties?.targetCharacterId;
    if (Array.isArray(perceivedPeople) && relationshipTarget) {
      relationshipTarget.enum = ["", ...new Set(perceivedPeople.map(clean).filter(Boolean))];
      relationshipTarget.description = "只使用本轮 referenceContract.perceivedCharacterHandles 中的感知人物句柄；recognizedIdentity.characterId 是识别信息，不能用作这里的引用。没有关系更新时可为空。";
    }
    const relationship = bound.properties?.relationshipAppraisal;
    if (relationship) {
      // Same source pool as the protocol validator: evidence and perceived impacts together.
      const evidenceIds = [...new Set([...(stageInput.worldProjection?.evidence || []), ...(stageInput.worldProjection?.perceivedImpacts || [])]
        .flatMap(row => [row?.evidenceId, row?.impactId, row?.eventId, row?.id]).map(clean).filter(Boolean))];
      if (evidenceIds.length) relationship.properties.sourceImpactIds.items.enum = evidenceIds;
      else relationship.properties.sourceImpactIds.maxItems = 0;
      const unchanged = clone(relationship);
      unchanged.properties.changeMode.enum = ["none"];
      unchanged.properties.dimensionChanges.maxItems = 0;
      unchanged.properties.sourceImpactIds.maxItems = 0;
      const changed = clone(relationship);
      changed.properties.changeMode.enum = ["provisional", "retained"];
      changed.properties.targetCharacterId.minLength = 1;
      if (Array.isArray(perceivedPeople)) changed.properties.targetCharacterId.enum = [...new Set(perceivedPeople.map(clean).filter(Boolean))];
      changed.properties.sourceImpactIds.minItems = 1;
      changed.properties.dimensionChanges.minItems = 1;
      // Match the domain validator without selecting a relationship judgment. A change needs both a
      // perceived target and received evidence; without either, offering it would be an unsatisfiable branch.
      const noTarget = Array.isArray(perceivedPeople) && !changed.properties.targetCharacterId.enum.length;
      relationship.anyOf = noTarget || !evidenceIds.length ? [unchanged] : [unchanged, changed];
    }
    const groundings = bound.properties?.desireGroundings;
    bindDesireEnum(groundings?.items?.properties?.desireId);
    const desires = stageInput.privateContext?.desires || [];
    if (groundings?.items && desires.length) {
      const persistent = desires.filter(row => row.activationMode === "persistent").map(row => clean(row.desireId));
      const cueGated = desires.filter(row => row.activationMode === "cue_gated").map(row => clean(row.desireId));
      const remaining = desireIds.filter(id => !persistent.includes(id) && !cueGated.includes(id));
      const branches = [];
      for (const [ids, states, needsEvidence] of [[persistent, ["uncertain", "triggered", "active"], false],
        [remaining, ["inactive", "latent", "uncertain", "triggered", "active"], false],
        [cueGated, ["inactive", "latent", "uncertain"], false], [cueGated, ["triggered", "active"], true]]) {
        if (!ids.length) continue;
        branches.push({ type: "object", properties: { desireId: { type: "string", enum: ids },
          activationState: { type: "string", enum: states },
          ...(needsEvidence ? { activationEvidenceIds: { type: "array", minItems: 1 } } : {}) } });
      }
      if (branches.length) groundings.items.anyOf = branches;
    }
    if (!desireIds.length && groundings) groundings.maxItems = 0;
    const criterionIds = [...new Set((stageInput.referenceContract?.ownedDesireCriterionIds || [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean))];
    const promotions = groundings?.items?.properties?.promotedCriteria;
    const criterionId = promotions?.items?.properties?.criterionId;
    if (criterionId) {
      if (criterionIds.length) criterionId.enum = criterionIds;
      else promotions.maxItems = 0;
    }
    const perceivedTargets = new Set((stageInput.referenceContract?.perceivedTargetHandles || [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean));
    const unresolvedStatuses = new Set(["unknown", "provisional", "suspended"]);
    const priorPositionSlots = new Set((stageInput.privateContext?.state?.priorRegulationCarryover?.epistemicPositions || [])
      .filter((position) => unresolvedStatuses.has(String(position?.status || "").trim()))
      .filter((position) => perceivedTargets.has(String(position?.subjectHandle || "").trim()))
      .map((position) => `${String(position?.domain || "").trim()}::${String(position?.subjectHandle || "").trim()}`));
    // For ongoing unresolved memory, require the existing explicit delta
    // operation. Every belief remains editable (including settled/rejected);
    // omission is not a delete operation and old evidence is not noticed anew.
    if (priorPositionSlots.size && bound.properties?.epistemicPositions) {
      bound.properties.epistemicPositionUpdateMode.enum = ["retain_unmentioned"];
      if (!bound.required.includes("epistemicPositionUpdateMode")) bound.required.push("epistemicPositionUpdateMode");
      bound.properties.epistemicPositions.description = `本轮以 retain_unmentioned 提交认识增量：当前有 ${priorPositionSlots.size} 类既有未决立场，只写新增或修改的条目；没有修改可写空数组。仍被感知对象的其他既有立场原样保留，旧证据不算本轮新观察。本人可明确修正、settled 或 rejected 任一立场；程序不替本人决定判断。`;
    }
  }
  if (phase === "awaiting_agent_candidates") {
    const relations = bound.properties?.candidates?.items?.properties?.desireRelations;
    bindDesireEnum(relations?.items?.properties?.desireId);
    if (!desireIds.length && relations) relations.maxItems = 0;
    const criterionUses = bound.properties?.candidates?.items?.properties?.criterionUses;
    bindDesireEnum(criterionUses?.items?.properties?.desireId);
    const currentConcernCriterionIds = [...new Set((stageInput.referenceContract?.currentConcernCriterionIds || [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean))];
    const criterionId = criterionUses?.items?.properties?.criterionId;
    if (criterionId) {
      if (currentConcernCriterionIds.length) criterionId.enum = currentConcernCriterionIds;
      else criterionUses.maxItems = 0;
    }
    const feasibilityIds = [...new Set((stageInput.referenceContract?.perceivedActionFeasibilityIds || [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean))];
    const candidateItem = bound.properties?.candidates?.items;
    const candidateProperties = candidateItem?.properties || {};
    // Binding enums below constrain visible operations. Cross-field primitive /
    // operation pairs are checked by submission preflight and domain validation;
    // partial object branches are not portable to strict model-output providers.
    const feasibilityHandlingSchema = candidateProperties.feasibilityHandling;
    const feasibilitySurfaceId = feasibilityHandlingSchema?.properties?.surfaceId;
    if (feasibilityIds.length && candidateItem) {
      if (!candidateItem.required.includes("feasibilityHandling")) candidateItem.required.push("feasibilityHandling");
      if (feasibilitySurfaceId) feasibilitySurfaceId.enum = ["", ...feasibilityIds];
      const unrelatedBranch = clone(feasibilityHandlingSchema);
      unrelatedBranch.properties.surfaceId.enum = [""];
      unrelatedBranch.properties.relationToGoal.enum = ["unrelated"];
      unrelatedBranch.properties.stance.enum = ["not_applicable"];
      const citedBranch = clone(feasibilityHandlingSchema);
      citedBranch.properties.surfaceId.enum = feasibilityIds;
      citedBranch.properties.relationToGoal.enum = ["direct_attempt", "prerequisite_step", "exploratory"];
      citedBranch.properties.stance.enum = ["follow", "question", "deliberate_attempt", "unknown"];
      candidateProperties.feasibilityHandling = {
        description: feasibilityHandlingSchema.description,
        anyOf: [unrelatedBranch, citedBranch],
      };
    } else if (feasibilityHandlingSchema) {
      feasibilityHandlingSchema.properties.surfaceId.enum = [""];
      feasibilityHandlingSchema.properties.relationToGoal.enum = ["unrelated"];
      feasibilityHandlingSchema.properties.stance.enum = ["not_applicable"];
    }
    // Bind target and action-binding anchors to what this character actually
    // perceives (people, objects, reachable zones, guest positions), so a
    // candidate cannot cite a world anchor that does not exist for it.
    const targetHandles = [...new Set((stageInput.referenceContract?.perceivedTargetHandles || [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean))];
    if (targetHandles.length) {
      const anchorEnum = ["", ...targetHandles];
      if (candidateProperties.targetHandle) candidateProperties.targetHandle.enum = anchorEnum;
      const byKind = stageInput.referenceContract?.perceivedTargetHandlesByBindingKind || {};
      const fieldKind = {
        targetCharacterId: "character",
        objectId: "object",
        destinationId: "place",
        positionId: "position",
        affordanceId: "affordance",
      };
      for (const [field, kind] of Object.entries(fieldKind)) {
        const node = candidateProperties.actionBinding?.properties?.[field];
        if (!node) continue;
        const kindTargets = [...new Set((byKind[kind] || []).map((value) => clean(value)).filter(Boolean))];
        node.enum = ["", ...kindTargets];
      }
      if (candidateProperties.actionBinding && Object.keys(byKind).length) {
        const bindingSchema = candidateProperties.actionBinding;
        const branches = [];
        for (const kind of ["none", "character", "object", "place", "position", "affordance"]) {
          const selectedField = Object.entries(fieldKind).find(([, bindingKind]) => bindingKind === kind)?.[0] || "";
          const kindTargets = kind === "none"
            ? []
            : [...new Set((byKind[kind] || []).map((value) => clean(value)).filter(Boolean))];
          if (kind !== "none" && !kindTargets.length) continue;
          const branch = clone(bindingSchema);
          branch.properties.kind.enum = [kind];
          for (const field of Object.keys(fieldKind)) branch.properties[field].enum = [""];
          if (selectedField) branch.properties[selectedField].enum = kindTargets;
          branches.push(branch);
        }
        candidateProperties.actionBinding = {
          description: bindingSchema.description,
          anyOf: branches,
        };
      }
    }
    const epistemicPositionIds = [...new Set((stageInput.referenceContract?.ownedEpistemicPositionIds || [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean))];
    const handlingPositions = bound.properties?.candidates?.items?.properties?.epistemicHandling?.properties?.positionIds;
    if (handlingPositions?.items) {
      if (epistemicPositionIds.length) handlingPositions.items.enum = epistemicPositionIds;
      else handlingPositions.maxItems = 0;
    }
  }
  if (phase === "awaiting_agent_choice_and_regulation") {
    const continuationTarget = bound.properties?.continuationIntentions?.items?.properties?.targetHandle;
    if (continuationTarget) continuationTarget.enum = ["", ...new Set(stageInput.referenceContract?.perceivedTargetHandles || [])];
    if (bound.properties?.selectedCandidateId && stageInput.generatedCandidates) {
      bound.properties.selectedCandidateId.enum = stageInput.generatedCandidates.map(row => clean(row.candidateId));
    }
    const preserved = bound.properties?.goalPreservation?.properties?.preservedDesireIds;
    bindDesireEnum(preserved?.items);
    if (!desireIds.length && preserved) preserved.maxItems = 0;
    const evidenceIds = [...new Set((stageInput.referenceContract?.perceivedEvidenceIds || [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean))];
    const triggerEvidence = bound.properties?.automaticCommunicationImpulse?.properties?.triggerEvidenceIds;
    if (triggerEvidence?.items) {
      if (evidenceIds.length) triggerEvidence.items.enum = evidenceIds;
      else triggerEvidence.maxItems = 0;
    }
    const anchorIds = [...new Set((stageInput.referenceContract?.discourseAnchorIds || [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean))];
    const impulseAnchors = bound.properties?.automaticCommunicationImpulse?.properties?.discourseAnchorIds;
    if (impulseAnchors?.items) {
      if (anchorIds.length) impulseAnchors.items.enum = anchorIds;
      else impulseAnchors.maxItems = 0;
    }
  }
  if (phase === "awaiting_agent_expression_planning") {
    const sourceImpulseId = String(stageInput.automaticCommunicationImpulse?.impulseId || "").trim();
    if (sourceImpulseId && bound.properties?.sourceImpulseId) bound.properties.sourceImpulseId.enum = [sourceImpulseId];
    const anchorIds = [...new Set((stageInput.referenceContract?.discourseAnchorIds || [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean))];
    const sharedAnchors = bound.properties?.publicStance?.properties?.sharedContextAnchorIds;
    if (sharedAnchors?.items) {
      if (anchorIds.length) sharedAnchors.items.enum = anchorIds;
      else sharedAnchors.maxItems = 0;
    }
  }
  if (phase === "awaiting_agent_realization") {
    const habitIds = Object.keys(stageInput.speechHabitSurface?.habitPressures || {});
    const realizedHabitIds = bound.properties?.realizedSpeechHabitIds;
    if (realizedHabitIds?.items) {
      if (habitIds.length) realizedHabitIds.items.enum = habitIds;
      else realizedHabitIds.maxItems = 0;
    }
  }
  if (phase === "awaiting_agent_turn_commit") {
    const selected = stageInput.expressionMoment?.lockedAction || {};
    const attempt = bound.properties?.actionAttempt?.properties || {};
    if (clean(selected.primitive) && attempt.primitive) {
      attempt.primitive.enum = [clean(selected.primitive)];
    }
    const binding = selected.actionBinding || {};
    const bindingFields = {
      character: ["targetCharacterId", "targetCharacterId"],
      object: ["objectId", "objectId"],
      place: ["destinationId", "destinationId"],
      position: ["positionId", "positionId"],
      affordance: ["affordanceId", "affordanceId"],
    };
    const pair = bindingFields[clean(binding.kind)];
    const additionalFields = additionalActionFields(selected);
    for (const field of ["objectId", "targetCharacterId", "destinationId", "positionId", "affordanceId"]) {
      const kind = Object.entries(bindingFields).find(([, pair]) => pair[1] === field)?.[0];
      const allowed = additionalFields.has(field) ? stageInput.actionReferenceOptions?.[kind] || [] : [];
      if (attempt[field]) attempt[field].enum = ["", ...allowed];
    }
    if (pair) {
      const [bindingField, attemptField] = pair;
      const anchor = clean(binding[bindingField]);
      if (anchor && attempt[attemptField]) attempt[attemptField].enum = [anchor];
    }
    if (selected.primitive === "transfer") {
      for (const field of ["objectId", "targetCharacterId"]) {
        if (attempt[field]) { attempt[field].minLength = 1; attempt[field].enum = attempt[field].enum.filter(Boolean); }
      }
    }
    const audienceIds = [...new Set((stageInput.expressionMoment?.allowedAudienceCharacterIds || [])
      .map((value) => clean(value))
      .filter(Boolean))];
    if (attempt.targetCharacterId && clean(binding.kind) !== "character" && additionalFields.has("targetCharacterId")) {
      attempt.targetCharacterId.enum = [...new Set([...attempt.targetCharacterId.enum, ...audienceIds])];
    }
    const audiences = bound.properties?.publicExpression?.properties?.audienceCharacterIds;
    if (audiences?.items) {
      if (audienceIds.length) audiences.items.enum = audienceIds;
      else audiences.maxItems = 0;
    }
    const conversationAnchors = stageInput.expressionMoment?.conversationAnchors?.anchors || [];
    const conversationSelection = bound.properties?.conversationAnchorSelection?.properties || {};
    const anchorHandles = [...new Set(conversationAnchors.map((row) => clean(row?.anchorHandle)).filter(Boolean))];
    const conversationModes = [...new Set(conversationAnchors.flatMap((row) => row?.allowedModes || []).map(clean).filter(Boolean))];
    const participantHandles = [...new Set(conversationAnchors.flatMap((row) => row?.participantHandles || []).map(clean).filter(Boolean))];
    if (conversationSelection.anchorHandle) conversationSelection.anchorHandle.enum = ["", ...anchorHandles];
    if (conversationSelection.mode) conversationSelection.mode.enum = ["none", ...conversationModes];
    if (conversationSelection.targetParticipantHandle) {
      conversationSelection.targetParticipantHandle.enum = ["", ...participantHandles];
    }
    bindConversationSelection(bound.properties.conversationAnchorSelection, conversationAnchors);
    const residue = stageInput.expressionMoment?.innerContinuity?.affectiveResidue;
    const materialResidualEmotionIds = [...new Set((residue?.liveEmotions || [])
      .filter((row) => ["low", "medium", "high", "very_high"].includes(clean(row?.intensity)))
      .map((row) => clean(row?.emotionId))
      .filter(Boolean))];
    const affectiveInfluence = bound.properties?.privateExpressionTrace?.properties?.affectiveInfluence?.properties;
    const affectiveSources = affectiveInfluence?.sourceEmotionIds;
    if (affectiveSources?.items) {
      if (materialResidualEmotionIds.length) affectiveSources.items.enum = materialResidualEmotionIds;
      else affectiveSources.maxItems = 0;
    }
    if (materialResidualEmotionIds.length) {
      // The host already owns the frozen residual list. Do not make the model
      // copy derived ids just to acknowledge its own chosen handling mode.
      if (affectiveInfluence?.primaryChannelId) {
        const channels = Array.isArray(residue?.possibleLeakageChannels)
          ? [...new Set(residue.possibleLeakageChannels.map(row => clean(row?.channelId))
            .filter(id => CHARACTER_PSYCHOLOGY_LEAKAGE_CHANNELS.includes(id)))]
          : [...CHARACTER_PSYCHOLOGY_LEAKAGE_CHANNELS];
        affectiveInfluence.primaryChannelId.enum = channels.length ? channels : [""];
        if (!channels.length && affectiveSources) affectiveSources.maxItems = 0;
      }
      if (affectiveInfluence?.mode) {
        affectiveInfluence.mode.enum = AFFECTIVE_INFLUENCE_MODES.filter((mode) => mode !== "no_live_influence");
      }
    } else if (Array.isArray(residue?.liveEmotions)) {
      if (affectiveInfluence?.primaryChannelId) affectiveInfluence.primaryChannelId.enum = [""];
      if (affectiveInfluence?.mode) affectiveInfluence.mode.enum = ["no_live_influence"];
    }
    if (Array.isArray(residue?.possibleLeakageChannels)) {
      const liveChannels = new Set(residue.possibleLeakageChannels.map(row => clean(row?.channelId)));
      const cues = Object.entries(PHYSICAL_AFFECTIVE_CUES).filter(([, value]) => liveChannels.has(value.channel)).map(([cue]) => cue);
      const deltas = bound.properties?.publicExpression?.properties?.affectiveDeltas;
      if (!cues.length) {
        if (deltas) deltas.maxItems = 0;
        if (affectiveInfluence?.mode) affectiveInfluence.mode.enum = affectiveInfluence.mode.enum.filter(mode => mode !== "leak_publicly");
      } else if (deltas?.items?.properties?.cue) deltas.items.properties.cue.enum = cues;
    }
    if (bound.properties?.agentTurnId) bound.properties.agentTurnId.enum = [clean(stageInput.agentTurnId)];
  }
  if (phase === "awaiting_subjective_appraisal") {
    const evidenceIds = [...new Set((stageInput.referenceContract?.perceivedEvidenceIds || [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean))];
    const perceivedCharacterHandles = [...new Set((stageInput.referenceContract?.perceivedCharacterHandles || [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean))];
    const knownEntityHandles = [...new Set((stageInput.referenceContract?.knownEntityHandles || [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean))];
    bindEvidenceReferenceEnums(bound, evidenceIds);
    const priorOutcome = bound.properties?.priorActionOutcomeAppraisal?.properties;
    const sourceTurnId = clean(stageInput.privateContext?.priorActionOutcomeContext?.pendingSourceAgentTurnId
      || stageInput.privateContext?.state?.priorRegulationCarryover?.pendingActionForecast?.sourceAgentTurnId);
    if (priorOutcome?.sourceAgentTurnId) {
      priorOutcome.sourceAgentTurnId.enum = [sourceTurnId];
      priorOutcome.status.enum = sourceTurnId ? ["perceived", "unclear", "unnoticed"] : ["no_prior_action"];
    }
    const outcomeEvidence = priorOutcome?.noticedOutcomeEvidenceIds;
    if (outcomeEvidence?.items) {
      if (evidenceIds.length) outcomeEvidence.items.enum = evidenceIds;
      else outcomeEvidence.maxItems = 0;
    }
    const activationEvidence = bound.properties?.desireGroundings?.items?.properties?.activationEvidenceIds;
    if (activationEvidence?.items) {
      if (evidenceIds.length) activationEvidence.items.enum = evidenceIds;
      else activationEvidence.maxItems = 0;
    }
    const promotionEvidence = bound.properties?.desireGroundings?.items?.properties?.promotedCriteria
      ?.items?.properties?.basisEvidenceIds;
    if (promotionEvidence?.items) {
      if (evidenceIds.length) promotionEvidence.items.enum = evidenceIds;
      else promotionEvidence.maxItems = 0;
    }
    const epistemicPositions = bound.properties?.epistemicPositions;
    const epistemicEvidence = epistemicPositions?.items?.properties?.basisEvidenceIds;
    if (epistemicEvidence?.items) {
      if (evidenceIds.length) epistemicEvidence.items.enum = evidenceIds;
      else epistemicEvidence.maxItems = 0;
    }
    const epistemicSubject = epistemicPositions?.items?.properties?.subjectHandle;
    if (epistemicSubject) epistemicSubject.enum = ["", ...perceivedCharacterHandles];
    const entityModels = bound.properties?.entityModelUpdates;
    const perceivedEntityHandle = entityModels?.items?.properties?.perceivedEntityHandle;
    if (perceivedEntityHandle) {
      if (perceivedCharacterHandles.length) perceivedEntityHandle.enum = perceivedCharacterHandles;
      else entityModels.maxItems = 0;
    }
    const identityCandidates = entityModels?.items?.properties?.identityCandidates;
    const knownEntityHandle = identityCandidates?.items?.properties?.knownEntityHandle;
    if (knownEntityHandle) {
      if (knownEntityHandles.length) knownEntityHandle.enum = knownEntityHandles;
      else identityCandidates.maxItems = 0;
    }
    const epistemicSubjectHandles = [...new Set([
      ...perceivedCharacterHandles,
      ...knownEntityHandles,
    ])];
    const locationBeliefs = bound.properties?.locationBeliefUpdates;
    const locationSubject = locationBeliefs?.items?.properties?.subjectHandle;
    if (locationSubject) {
      if (epistemicSubjectHandles.length) locationSubject.enum = epistemicSubjectHandles;
      else locationBeliefs.maxItems = 0;
    }
    const sourceKnowledge = bound.properties?.sourceKnowledgeBeliefUpdates;
    const sourceHandle = sourceKnowledge?.items?.properties?.sourceHandle;
    const knowledgeSubject = sourceKnowledge?.items?.properties?.subjectHandle;
    if (sourceHandle) {
      if (epistemicSubjectHandles.length) sourceHandle.enum = epistemicSubjectHandles;
      else sourceKnowledge.maxItems = 0;
    }
    if (knowledgeSubject) {
      if (knownEntityHandles.length) knowledgeSubject.enum = knownEntityHandles;
      else sourceKnowledge.maxItems = 0;
    }
  }
  return bound;
}

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function bindEvidenceReferenceEnums(schemaNode, evidenceIds = []) {
  if (!schemaNode || typeof schemaNode !== "object") return;
  for (const [propertyName, propertySchema] of Object.entries(schemaNode.properties || {})) {
    if (/(?:evidence)ids$/iu.test(propertyName)
      && propertySchema?.type === "array"
      && propertySchema.items) {
      if (evidenceIds.length) propertySchema.items.enum = [...evidenceIds];
      else propertySchema.maxItems = 0;
    }
    bindEvidenceReferenceEnums(propertySchema, evidenceIds);
  }
  if (schemaNode.items) bindEvidenceReferenceEnums(schemaNode.items, evidenceIds);
}

function clone(value) {
  return structuredClone(value);
}

function withoutLegacyExpressionAuthority(value) {
  if (Array.isArray(value)) return value.map(withoutLegacyExpressionAuthority);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "expressionStrategy")
    .map(([key, row]) => [key, withoutLegacyExpressionAuthority(row)]));
}

function rows(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.entries(value).map(([id, row]) => ({ id, ...(row || {}) }));
  return [];
}

function projectedEvidence(input = {}) {
  const fromImpacts = (input.perceivedImpacts || []).map((row) => ({
    evidenceId: clean(row.evidenceId || row.impactId || row.id),
    modality: clean(row.modality),
    content: clean(row.content),
    topic: clean(row.topic),
    actionKind: clean(row.actionKind),
    directed: row.directed === true,
    speechAct: clean(row.speechAct || "none"),
    speechFunctions: clone(row.speechFunctions || []),
    semanticFrame: clone(row.semanticFrame || {}),
    // The recipient projection already decided whether this person is known.
    // Keep that epistemic result: a confirmed person must not be demoted back
    // into an anonymous perceived_entity merely because every sensory delivery
    // also carries a stable perceptual handle for traceability.
    sourceEntityHandle: clean(
      row.identityKnown !== false && (row.recognizedIdentity?.characterId || row.perceivedSourceCharacterId || row.sourceCharacterId)
        ? row.recognizedIdentity?.characterId || row.perceivedSourceCharacterId || row.sourceCharacterId
        : row.sourceEntityHandle || row.sourceCharacterId,
    ),
    occurredAt: row.occurredAt || row.occurredAtSeconds || null,
  }));
  const fromFrame = (input.perceptionFrame?.noticedEvidence || []).map((row) => ({
    evidenceId: clean(row.evidenceId || row.id),
    modality: clean(row.modality),
    content: clean(row.physicalFeature || row.content || row.feature),
    topic: clean(row.domain || row.topic),
    sourceEntityHandle: clean(row.anonymousSourceHandle || row.sourceEntityHandle),
    occurredAt: row.occurredAt || row.occurredAtSeconds || null,
  }));
  const found = new Set();
  return [...fromImpacts, ...fromFrame].filter((row) => {
    if (!row.evidenceId || found.has(row.evidenceId)) return false;
    found.add(row.evidenceId);
    return true;
  });
}

function mappedDesires(input = {}) {
  const profile = input.agent?.privateState?.ecologyProfile || {};
  const state = input.agent?.privateState?.ecologyState || {};
  const anchor = input.agent?.psychologyAnchor || {};
  const mergedById = new Map();
  // Foundation rows carry meaning; runtime rows carry the changing numbers.
  // Merge them instead of letting the first sparse runtime row erase the
  // authored desire that the numbers are supposed to describe.
  for (const row of [
    ...rows(anchor.coreDesires),
    ...rows(anchor.desires),
    ...rows(profile.desires),
    ...rows(state.desires),
  ]) {
    const desireId = clean(row.desireId || row.id);
    if (!desireId) continue;
    const previous = mergedById.get(desireId) || {};
    mergedById.set(desireId, {
      ...previous,
      ...row,
      desiredState: { ...(previous.desiredState || {}), ...(row.desiredState || {}) },
      authoredSatisfactionCondition: {
        ...(previous.authoredSatisfactionCondition || previous.satisfactionCondition || {}),
        ...(row.authoredSatisfactionCondition || row.satisfactionCondition || {}),
      },
      progressEvidence: [...new Set([...(previous.progressEvidence || []), ...(row.progressEvidence || [])])],
      activationCues: [...new Set([...(previous.activationCues || []), ...(row.activationCues || [])])],
      target: typeof row.target === "object"
        ? { ...(typeof previous.target === "object" ? previous.target : {}), ...row.target }
        : row.target ?? previous.target,
    });
  }
  return [...mergedById.entries()].map(([desireId, row]) => {
    const desiredStateLabel = clean(`${row.desiredState?.verb || ""}${row.desiredState?.object || ""}`);
    const satisfactionCondition = clone(row.authoredSatisfactionCondition || row.satisfactionCondition || {});
    const terminalExperience = clean(
      row.desiredState?.observableOutcome
      || satisfactionCondition.requiredEvidence
      || satisfactionCondition.criteria?.requiredEvidence
      || desiredStateLabel,
    );
    const typedNonSubstitutableConditions = satisfactionCondition.type === "valid_firsthand_exchange"
      ? [
        "本人必须亲自参与这次交换",
        "目标人物必须处于能够真实回应的状态",
        `必须形成至少${Number(satisfactionCondition.criteria?.attackDefenseRoundsAtLeast || 1)}轮有效来回`,
        "旁观、传闻或对方单独演示不能代替这次第一手交换",
      ]
      : [];
    const mappedDesire = {
      desireId,
      label: clean(row.want || row.label || row.desire || desiredStateLabel || row.target?.label),
      desiredState: clone(row.desiredState || {}),
      target: clone(row.target || null),
      terminalExperience,
      satisfactionCondition,
      progressEvidence: clone(row.progressEvidence || []),
      activationCues: clone(row.activationCues || []),
      activationMode: clean(
        row.activationPolicy?.mode
        || row.activationMode
        || row.runtimeProjection?.activationMode,
      ) || (/state_activated/u.test(clean(row.qualitativeStrength || row.runtimeProjection?.qualitativeStrength)) ? "cue_gated" : "persistent"),
      activationDoesNotCount: clone(row.activationPolicy?.doesNotCount || []),
      latentActivationCap: Number(row.activationPolicy?.latentActivationCap ?? row.latentActivationCap ?? 0.12),
      potentialStrength: Number(row.potentialStrength ?? row.baseStrength ?? row.previousActivation ?? row.strength ?? 0),
      nonSubstitutableConditions: clone(
        satisfactionCondition.doesNotCount
        || satisfactionCondition.criteria?.doesNotCount
        || typedNonSubstitutableConditions,
      ),
      previousActivation: Number(row.previousActivation ?? row.activation ?? row.strength ?? row.baseline ?? 0),
      retention: Number(row.retention ?? 0.9),
      cueMatch: Number(row.cueMatch ?? row.cueActivation ?? row.cue ?? 0),
      urgency: Number(row.urgency ?? 0),
      frustration: Number(row.frustration ?? 0),
      relationshipExpectation: Number(row.relationshipExpectation ?? 0),
      bodyNeedCoupling: Number(row.bodyNeedCoupling ?? row.needCoupling ?? 0),
      satisfaction: Number(row.satisfaction ?? row.satiation ?? 0),
      adaptation: Number(row.adaptation ?? 0),
    };
    mappedDesire.criterionLedger = deriveDesireCriterionLedger([mappedDesire]);
    mappedDesire.criterionPolicy = {
      defaultCandidateRole: "terminal_evaluation_only",
      promotionAuthority: "character-agent",
      rule: "A terminal criterion may evaluate final validity, but cannot originate a present action unless this Character Agent promotes it from independent current evidence or private state.",
    };
    return [mappedDesire];
  }).flat();
}

function objectiveWorldMaterialFacts(materialFacts = {}) {
  const source = clone(materialFacts);
  const sanitizeRow = (row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return row;
    const {
      personalOpenLoops: _privateLoops,
      hiddenAgenda: _hiddenAgenda,
      privatePursuit: _privatePursuit,
      ...objective
    } = row;
    if (objective.purposeStatus === "undisclosed") objective.objectiveSummary = {};
    return objective;
  };
  if (Array.isArray(source)) return source.map(sanitizeRow);
  return sanitizeRow(source);
}

function qualitativeDispositionLevel(disposition = {}, fallback = 0.5) {
  const range = disposition?.range;
  if (Array.isArray(range) && range.length >= 2 && range.every((value) => Number.isFinite(Number(value)))) {
    return Math.max(0, Math.min(1, (Number(range[0]) + Number(range[1])) / 2));
  }
  const label = clean(disposition?.qualitativeLevel).toLowerCase();
  if (/very[_ -]?high|very[_ -]?strong|极高|很强/u.test(label)) return 0.9;
  if (/high|strong|preferred|高|强|偏好/u.test(label)) return 0.76;
  if (/low|弱|低/u.test(label)) return 0.24;
  return fallback;
}

function dispositionDomains(dispositionId = "", disposition = {}) {
  const textValue = `${dispositionId} ${clean(disposition?.scope)}`.toLowerCase();
  const domains = [];
  if (/sword|martial|cultivation|ability|skill|training|剑|武|修行|能力|训练/u.test(textValue)) domains.push("martial");
  if (/social|public|approval|face|stranger|公开|社交|颜面|陌生/u.test(textValue)) domains.push("social");
  if (/duty|promise|official|work|complication|职责|承诺|事务|经营/u.test(textValue)) domains.push("duty");
  if (/body|weakness|endurance|fatigue|pain|身体|弱点|耐力|疲劳|疼痛/u.test(textValue)) domains.push("body");
  if (/relationship|friend|trust|betray|关系|朋友|信任|背叛/u.test(textValue)) domains.push("relationship");
  if (/economic|wealth|price|money|经济|财富|价格|钱/u.test(textValue)) domains.push("economic");
  return domains.length ? [...new Set(domains)] : ["general"];
}

function compileDomainValuation(authored = {}, dispositions = {}) {
  const result = clone(authored || {});
  const multiply = (domain, factor, multiplier) => {
    result[domain] = result[domain] || {};
    const previous = Number(result[domain][factor] ?? 1);
    result[domain][factor] = Math.max(0.35, Math.min(1.8, previous * multiplier));
  };
  for (const [id, disposition] of Object.entries(dispositions || {})) {
    const level = qualitativeDispositionLevel(disposition);
    const key = id.toLowerCase();
    const domains = dispositionDomains(id, disposition);
    for (const domain of domains) {
      if (/mastery|drive|pursuit|achievement|进取|求道/u.test(key)) multiply(domain, "goalProgress", 1 + level * 0.38);
      if (/directevidence|evidencepreference|verification|亲证|证据/u.test(key)) {
        multiply(domain, "informationGain", 1 + level * 0.28);
        multiply(domain, "proxySubstitution", 1 + level * 0.36);
      }
      if (/socialapprovalneed|approvalneed|颜面需求/u.test(key)) multiply(domain, "exposureAndRelationshipRisk", 0.55 + level * 0.9);
      if (/controlledforce|forcecontrol|控力/u.test(key)) {
        multiply(domain, "threatAndNormCost", 1 - level * 0.26);
        multiply(domain, "goalProgress", 1 + level * 0.16);
      }
      if (/complicationcost|switchingcost|麻烦/u.test(key)) multiply(domain, "opportunityAndSwitchingCost", 1 + level * 0.3);
      if (/disclosureresistance|exposurecost|暴露/u.test(key)) multiply(domain, "exposureAndRelationshipRisk", 1 + level * 0.34);
      if (/unresolveddesireretention|persistence|坚持/u.test(key)) multiply(domain, "habitAndIntentionContinuity", 1 + level * 0.24);
    }
  }
  return result;
}

function strongestDisposition(dispositions = {}, pattern) {
  const matches = Object.entries(dispositions || {})
    .filter(([id, disposition]) => pattern.test(`${id} ${clean(disposition?.scope)}`.toLowerCase()))
    .map(([id, disposition]) => ({ id, value: qualitativeDispositionLevel(disposition) }))
    .sort((left, right) => right.value - left.value);
  return matches[0] || null;
}

function dispositionShapedPersonality(base = {}, dispositions = {}) {
  const personality = clone(base || {});
  const mappings = {
    selfControl: /inhibitory.?control|self.?control|impulse.?control|克制|自控/u,
    persistence: /persistence|retention|persever|坚持|持续/u,
    caution: /caution|risk.?aversion|complication.?cost|谨慎|风险|麻烦/u,
    impulsivity: /impulsiv|冲动/u,
    competitiveness: /competit|mastery.?drive|achievement.?drive|好胜|求胜/u,
    autonomy: /autonomy|self.?direction|independen|自主|自决/u,
    introversion: /introversion|social.?reserve|内向|寡言/u,
    care: /care|affiliation|compassion|关怀|照料/u,
  };
  const sources = {};
  for (const [trait, pattern] of Object.entries(mappings)) {
    const match = strongestDisposition(dispositions, pattern);
    if (!match) continue;
    personality[trait] = match.value;
    sources[trait] = match.id;
  }
  return { personality, sources };
}

/** Compile authored qualitative dispositions into the shared psychology tool profile. */
export function compileTavernCharacterPsychologyProfile(input = {}) {
  const ecologyProfile = input.agent?.privateState?.ecologyProfile || {};
  const anchor = input.agent?.psychologyAnchor || {};
  const authored = ecologyProfile.psychologyToolsV2 || anchor.psychologyToolsV2 || {};
  const dispositions = anchor.stablePsychology?.dispositions || {};
  const dispositionMidpoint = (id, fallback) => {
    const range = dispositions[id]?.range;
    if (!Array.isArray(range) || range.length < 2 || !range.every((value) => Number.isFinite(Number(value)))) return fallback;
    return (Number(range[0]) + Number(range[1])) / 2;
  };
  const shapedPersonality = dispositionShapedPersonality({
    ...(ecologyProfile.personality || {}),
    ...(anchor.personality || {}),
    ...(authored.personality || {}),
  }, dispositions);
  const personality = shapedPersonality.personality;
  const authoredLearning = authored.behaviorLearning || {};
  const inhibitoryControl = strongestDisposition(
    dispositions,
    /inhibitory.?control|self.?control|impulse.?control|克制|自控/u,
  );
  const excitementGain = strongestDisposition(
    dispositions,
    /excitement.?gain|excitement.?sensitivity|兴奋增益|兴奋敏感/u,
  );
  const regulation = clone(authored.regulation || {});
  if (inhibitoryControl) {
    if (!Number.isFinite(Number(regulation.practicedSkill))) regulation.practicedSkill = inhibitoryControl.value;
    regulation.strategySkills = {
      suppress: inhibitoryControl.value,
      conceal: inhibitoryControl.value,
      delay: Math.max(0.35, inhibitoryControl.value * 0.92),
      ...(regulation.strategySkills || {}),
    };
  }
  const emotionResponse = clone(authored.emotionResponse || {});
  if (excitementGain) {
    emotionResponse.emotions = clone(emotionResponse.emotions || {});
    emotionResponse.emotions.excitement = {
      gain: Math.max(0.6, Math.min(1.55, 0.62 + excitementGain.value)),
      ...(emotionResponse.emotions.excitement || {}),
    };
  }
  const leakage = clone(authored.leakage || {});
  if (inhibitoryControl) {
    const currentMasking = leakage.maskingSkills || {};
    leakage.maskingSkills = Object.fromEntries([
      "gaze", "attentionLock", "responseLatency", "breath", "voiceOnset", "pace", "pitch", "volume",
      "lexicalSharpness", "movementInterruption", "posture", "handTension", "objectHandling", "orientation", "proximity",
    ].map((channel) => [channel, Number.isFinite(Number(currentMasking[channel]))
      ? Number(currentMasking[channel])
      : Math.max(0.2, Math.min(0.96, inhibitoryControl.value * (["gaze", "attentionLock"].includes(channel) ? 0.86 : 1)))]));
  }
  return {
    personality,
    emotionResponse,
    regulation,
    leakage,
    candidateValuation: clone(authored.candidateValuation || {}),
    domainValuation: compileDomainValuation(authored.domainValuation || {}, dispositions),
    stableDispositionProjection: Object.fromEntries(Object.entries(dispositions).map(([id, disposition]) => [id, {
      level: qualitativeDispositionLevel(disposition),
      domains: dispositionDomains(id, disposition),
      scope: clean(disposition?.scope),
    }])),
    behaviorLearning: {
      noGainThreshold: Number(authoredLearning.noGainThreshold ?? 0.14),
      goalProgressThreshold: Number(authoredLearning.goalProgressThreshold ?? 0.08),
      feedbackLearningRate: Number(authoredLearning.feedbackLearningRate ?? 0.72),
      repetitionSensitivity: Number(authoredLearning.repetitionSensitivity
        ?? dispositionMidpoint("irrelevantComplicationCost", personality.conscientiousness ?? 0.68)),
      predictionErrorSensitivity: Number(authoredLearning.predictionErrorSensitivity
        ?? dispositionMidpoint("directEvidencePreference", personality.caution ?? 0.66)),
      persistenceInsulation: Number(authoredLearning.persistenceInsulation
        ?? dispositionMidpoint("unresolvedDesireRetention", personality.persistence ?? 0.5)),
      compulsiveRepetitionBias: Number(authoredLearning.compulsiveRepetitionBias ?? personality.compulsivity ?? 0),
      continuationCommitmentWeight: Number(authoredLearning.continuationCommitmentWeight
        ?? dispositionMidpoint("unresolvedDesireRetention", personality.persistence ?? 0.62)),
      regulationDebtSensitivity: Number(authoredLearning.regulationDebtSensitivity
        ?? dispositionMidpoint("inhibitoryControl", personality.selfControl ?? 0.58)),
    },
    dispositionProjection: {
      authority: "character-authored-foundation-to-private-psychology-tool",
      personalitySources: shapedPersonality.sources,
      inhibitoryControlSourceId: clean(inhibitoryControl?.id),
      excitementGainSourceId: clean(excitementGain?.id),
      selection: null,
    },
  };
}

function mappedProfile(input = {}) {
  return compileTavernCharacterPsychologyProfile(input);
}

function mappedState(input = {}) {
  const ecology = input.agent?.privateState?.ecologyState || {};
  const body = ecology.body || ecology.bodyState || {};
  const affect = ecology.affect || {};
  const carryover = ecology.characterPsychologyV2State || {};
  const subjectiveCarryover = clone(carryover);
  // The world may retain an objective settlement for audit, but this Character
  // Agent may only learn consequences through its recipient-specific evidence.
  // Its own forecast, regulation debt, learning history and intentions remain.
  delete subjectiveCarryover.pendingObjectiveOutcome;
  return {
    mood: {
      valence: Number(carryover.mood?.valence ?? affect.valence ?? 0),
      arousal: Number(carryover.mood?.arousal ?? affect.arousal ?? 0.3),
    },
    body: clone(body),
    cognitiveLoad: Math.max(Number(ecology.cognitiveLoad || 0), Number(carryover.cognitiveLoad || 0)),
    traumaActivation: Math.max(0, ...Object.values(ecology.sensitivityActivations || {}).map((row) => Number(row?.activation || 0))),
    feltSafety: Number(ecology.feltSafety ?? 0.5),
    preparation: Math.max(0, Number(ecology.preparation ?? 0.25) - Number(carryover.controlDepletion || 0) * 0.2),
    subjectiveWorldTimeSeconds: Number(input.scene?.characterElapsedSeconds ?? ecology.elapsedSeconds ?? 0),
    internalWakePressure: Number(carryover.internalWakePressure || 0),
    continuationIntentions: clone(carryover.continuationIntentions || []),
    voiceHabitUsage: clone(ecology.voiceHabitUsage || []),
    priorRegulationCarryover: subjectiveCarryover,
  };
}

function priorActionOutcomeContext(state = {}) {
  const forecast = state?.priorRegulationCarryover?.pendingActionForecast || {};
  const pendingSourceAgentTurnId = clean(forecast.sourceAgentTurnId);
  return {
    authority: "character-agent-turn-protocol",
    hasPendingAgentAction: Boolean(pendingSourceAgentTurnId),
    pendingSourceAgentTurnId,
    outcomeSubject: pendingSourceAgentTurnId ? "pending_character_agent_action_only" : "none",
    recentOwnActionsClassification: "settled_continuity_context_only",
    settledInteractionEventsClassification: "settled_continuity_context_only",
    requiredStatusWhenNoPendingAgentAction: "no_prior_action",
  };
}

/** Map a canonical tavern input without forwarding legacy private candidates. */
function projectPsychologyFoundationForTurn(anchor = {}) {
  return {
    schemaVersion: Number(anchor.schemaVersion || 1),
    characterId: clean(anchor.characterId),
    identityModel: clone(anchor.identityModel || {}),
    stablePsychology: clone(anchor.stablePsychology || {}),
    dynamicPsychology: clone(anchor.dynamicPsychology || {}),
    epistemics: clone(anchor.epistemics || {}),
    inhibitors: clone(anchor.inhibitors || []),
    competenceModel: clone(anchor.competenceModel || {}),
    values: clone(anchor.values || []),
    projectionRule: "Relevant authored Character foundation only; desires, relationships, memory, perception and speech each travel through their dedicated runtime surfaces.",
  };
}

export function createTavernCharacterAgentV2Session(input = {}) {
  const characterId = clean(input.agent?.id);
  const step = Number(input.scene?.step ?? input.scene?.elapsedSeconds ?? 0);
  const agentTurnId = clean(input.agentTurnId) || `agent-turn:${clean(input.scene?.id || "tavern")}:${step}:${characterId}`;
  const relationshipContext = clone(input.agent?.relationshipContext || []);
  const privateState = mappedState(input);
  return createCharacterAgentTurnSession(withoutLegacyExpressionAuthority({
    agentTurnId,
    characterId,
    submissionMode: clean(input.submissionMode) || "staged",
    worldProjection: {
      temporalContext: clone(input.temporalContext || {}),
      ownTimeExperience: clone(input.ownTimeExperience || {}),
      authority: "recipient-specific-world-projection",
      supportedAttemptPrimitives: [...CHARACTER_ATTEMPT_PRIMITIVES],
      scene: clone(input.scene || {}),
      evidence: projectedEvidence(input),
      perceivedImpacts: clone(input.perceivedImpacts || []),
      perceivedCharacters: clone(input.perceivedCharacters || []),
      perceivedObjects: clone(input.perceivedObjects || []),
      perceivedReferences: clone(input.perceivedReferences || []),
      actionFeasibilities: clone(input.actionFeasibilities || []),
      affordances: clone(input.availableAffordances || []),
      serviceChoice: clone(input.serviceChoice || null),
      materialFacts: objectiveWorldMaterialFacts(input.materialFacts || {}),
      settledInteractionEvents: clone(input.settledInteractionEvents || []),
      discourseContext: clone(input.discourseContext || {}),
      conversationAnchors: clone(input.conversationAnchors || null),
      reachableZones: clone(input.reachableZones || []),
      openConversationThreads: clone(input.openConversationThreads || []),
      recentOwnActions: clone(input.recentOwnActions || []),
      ownCommitments: clone(input.ownCommitments || []),
      institution: clone(input.institution || {}),
      socialContext: clone(input.socialContext || {}),
      currentResponsibilities: clone(input.currentResponsibilities || input.agent?.currentResponsibilities || null),
      sharedActivities: clone(input.sharedActivities || []),
      ongoingOwnActivities: clone(input.ongoingOwnActivities || []),
      ownedWorldProcesses: clone(input.ownedWorldProcesses || []),
      activationCause: clone(input.activationCause || null),
      accessGrants: clone(input.accessGrants || []),
      recentFailedAttempts: clone(input.recentFailedAttempts || []),
    },
    privateContext: {
      profile: mappedProfile(input),
      state: privateState,
      priorActionOutcomeContext: priorActionOutcomeContext(privateState),
      desires: mappedDesires(input),
      values: clone(input.agent?.psychologyAnchor?.values || []),
      selfSchemas: clone(input.agent?.memoryContext?.selfNarrative?.currentClaims || []),
      relationships: relationshipContext,
      knownEntityReferences: clone(input.agent?.knownEntityReferences || []),
      memoryContext: clone(input.agent?.memoryContext || {}),
      psychologyAnchor: projectPsychologyFoundationForTurn(input.agent?.psychologyAnchor || {}),
      voiceContract: clone(input.agent?.voiceContract || {}),
      expressionProtocol: clone(input.agent?.expressionProtocol || {}),
      livedSituation: {
        role: clean(input.agent?.role),
        standing: clean(input.agent?.standing),
        currentIntention: clean(input.agent?.currentIntention),
        currentResponsibilities: clone(input.agent?.currentResponsibilities || input.currentResponsibilities || null),
        currentActivities: clone(
          Array.isArray(input.agent?.currentActivities)
            ? input.agent.currentActivities
            : input.ongoingOwnActivities || [],
        ),
        ownCommitments: clone(input.ownCommitments || []),
        recentOwnActions: clone(input.recentOwnActions || []),
        activePlanProjection: clone(input.activePlanProjection || null),
      },
    },
  }));
}

function stageDefinition(phase, stageInput = {}) {
  if (phase === "awaiting_character_day_planning") return {
    stage: "character_day_planning",
    schema: tavernCharacterAgentV2OutputSchemaForStage({ ...stageInput, phase }),
    schemaName: "tavern_character_day_planning_v27",
    outputKey: "dayPlan",
  };
  if (phase === "awaiting_character_reflection") return {
    stage: "character_reflection",
    schema: tavernCharacterAgentV2OutputSchemaForStage({ ...stageInput, phase }),
    schemaName: "tavern_character_reflection_v27",
    outputKey: "reflection",
  };
  if (phase === "awaiting_subjective_appraisal") return {
    stage: "subjective_appraisal",
    schema: tavernCharacterAgentV2OutputSchemaForStage({ ...stageInput, phase }),
    schemaName: "tavern_character_subjective_appraisal_v2",
    outputKey: "appraisal",
  };
  if (phase === "awaiting_subjective_appraisal_and_candidates") return {
    stage: "subjective_appraisal_and_candidates",
    schema: tavernCharacterAgentV2OutputSchemaForStage({ ...stageInput, phase }),
    schemaName: "tavern_character_appraisal_candidates_v27_fast",
    outputKey: "appraisalAndCandidates",
  };
  if (phase === "awaiting_agent_candidates") return {
    stage: "agent_candidates",
    schema: tavernCharacterAgentV2OutputSchemaForStage({ ...stageInput, phase }),
    schemaName: "tavern_character_candidates_v2",
    outputKey: "candidates",
  };
  if (phase === "awaiting_agent_turn_commit") return {
    stage: "agent_turn_commit",
    schema: tavernCharacterAgentV2OutputSchemaForStage({ ...stageInput, phase }),
    schemaName: "tavern_character_turn_commit_v2",
    outputKey: "turnCommit",
  };
  if (phase === "awaiting_agent_choice_and_turn_commit") return {
    stage: "agent_choice_and_turn_commit",
    schema: tavernCharacterAgentV2OutputSchemaForStage({ ...stageInput, phase }),
    schemaName: "tavern_character_choice_commit_v27_fast",
    outputKey: "choiceAndTurnCommit",
  };
  if (phase === "awaiting_agent_choice_and_regulation") return {
    stage: "agent_choice_and_regulation",
    schema: tavernCharacterAgentV2OutputSchemaForStage({ ...stageInput, phase }),
    schemaName: "tavern_character_choice_v2",
    outputKey: "choice",
  };
  if (phase === "awaiting_agent_expression_planning") return {
    stage: "agent_expression_planning",
    schema: tavernCharacterAgentV2OutputSchemaForStage({ ...stageInput, phase }),
    schemaName: "tavern_character_regulated_expression_plan_v2",
    outputKey: "expressionPlan",
  };
  if (phase === "awaiting_agent_realization") return {
    stage: "agent_realization",
    schema: tavernCharacterAgentV2OutputSchemaForStage({ ...stageInput, phase }),
    schemaName: "tavern_character_realization_v2",
    outputKey: "realization",
  };
  throw new Error(`Unsupported Character Agent v2 phase: ${phase}`);
}

export function tavernCharacterAgentV2SystemPrompt(stageInput = {}) {
  const rules = {
    awaiting_subjective_appraisal: "你只能说明本人注意了什么、怎样理解、相信或怀疑什么，以及它牵动了本人哪些欲望、价值、自我认识和关系意义。对本轮真正相关的欲望，先读清 foundation 中的终局经验、满足条件、不算数的替代和 activationCues；用 terminalContractAcknowledged 确认即可，不要把满足条件逐条改写成当前待办、问题或 missingActivationConditions。activationMode=persistent 表示欲望本身不靠外部线索才存在；只要本人在本轮承认它仍在，就不能仅因目标身份、时机或终局有效性尚未确认而把 activationState 写成 inactive／latent。这些未知可以降低 currentlyPerceivedPossible、成为 inhibitor 或进入分域认识，但不是激活开关。只有 cue_gated 欲望才需要真实 activation cue 才能从 latent 进入当前心理。criterionLedger 中每一项默认都只用于最终判断欲望是否真正满足。promotedCriteria 通常为空；只有当本人因这一轮亲见证据，或独立的身体、关系、职责、承诺、人格、记忆、当前活动、即时风险等私人状态，真正在此刻开始留意某条条件时才提升。仅仅因为条件属于一个已激活欲望，不能提升它。monitor 只表示留意；current_concern 只表示本人允许它参与下一阶段的候选来源，不是行动前必须解决的门槛，也不替本人选行动。先读取 privateContext.state.priorRegulationCarryover.epistemicPositions：它们是本人上一回合留下的可修正认识，不是世界事实。若本轮 schema 指定 epistemicPositionUpdateMode=retain_unmentioned，就只在 epistemicPositions 写新增或修改的立场；没有修改可写空数组。仍被感知对象的其他既有立场会原样保留，旧证据不算本轮新观察。本人始终可以根据新证据保留、修正、settled、rejected 或继续悬置任一立场，不能用遗漏代替明确改变判断。若 schema 允许且本人选择 complete，则必须提交完整列表，保留每个仍被感知对象的未决 domain；原样保留的条目可只写 positionId、domain、subjectHandle 和 carriedUnchanged=true，其余字段省略；修改的条目必须完整填写。再用 epistemicPositions 把身份、能力、意图、地点等不同认识问题分开：最终是否确认，与当前是否愿意在低成本可逆行动中暂时据此交往，是两件事。可以保留怀疑并暂时采用，可以悬置结论，也可以要求先核验；一个域的证据标准不能自动扩张到所有域。activationEvidenceIds 只能填写本人这一轮亲自感知、且已列入 noticedEvidenceIds 的世界证据；记忆、信念、价值、自我认识、关系、承诺与欲望本身必须填写在 activationPsychologicalSourceIds，不能伪装成眼前证据。privateContext.knownEntityReferences 表示本人知道其姓名或存在、却未必认得长相的人；把一个 perceivedEntityHandle 视为某位已知人物的可能身份时，identityCandidates 只能使用相应的 knownEntityHandle，不能使用世界 canonical character id，也不能因此宣布已经认出；但这不禁止人物形成明确标为 provisional 的工作性身份立场。relationshipAppraisal 只有在本人确实要形成某个关系维度变化时才使用 provisional 或 retained，此时必须同时填写已感知对象、来源和至少一个 dimensionChange；若只是形成“此人可以交涉”“此人暂时没有敌意”之类尚不足以改变关系维度的陌生人印象，写进 entityModelUpdates，并把 relationshipAppraisal.changeMode 设为 none。activationMode 为 cue_gated 时，线索是欲望进入当前心理的前提：内在信念只能解释这个线索为什么重要，不能替代线索本身；例如要求亲眼确认高明时，佩剑、传闻、邀约、旧记忆或未看清的动作都不能替代确认。非 cue_gated 的长期欲望则可以由本人已有的心理来源在没有新外部线索时变得迫切。用 desireGroundings 分开填写激活状态与即时拉力，再写出本人此刻真正想经历什么、有哪些真实阻碍、地点／时机／力度／披露／方式中哪些可以调整。不要把阻碍、激活前提或终局验收表误写成欲望。先读取 privateContext.priorActionOutcomeContext：只有 hasPendingAgentAction=true 时，priorActionOutcomeAppraisal 才能评价等待反馈的上一轮 Character Agent 行动；worldProjection.recentOwnActions 与 settledInteractionEvents 都只是已经结算的生活连续性，不能因此把 status 写成 perceived、unclear 或 unnoticed。hasPendingAgentAction=false 时必须填 no_prior_action。若确有 pendingActionForecast，必须只用本人实际注意到的证据评价它带来了多少信息、终局进展和代价；不能把世界的客观成功直接当成心理收获。不要生成候选、选择、动作或台词。",
    awaiting_agent_candidates: "你已经看见本人的心理状态和欲望落地。由你本人生成一至七个此刻真可能想到的行动候选。cue_gated 且仍为 inactive／latent 的欲望只是潜在倾向，不能因为眼前存在验证机会就被偷换成当前终点；除非另一个已经激活的欲望独立支持，否则不要专门为它索取表演或制造代理目标。终局 criterion 默认只是事后有效性判断，不是提问清单、检查清单或候选模板。若某个候选专门核实、保护、推进或避免破坏一条终局条件，必须在 criterionUses 引用本人本轮已提升为 current_concern 的 criterion；未提升或仅为 monitor 的 criterion 不得成为候选来源。current_concern 并不要求先核验；人物仍可带着它直接行动、边做边验、暂时采用、悬置或回避。每个候选用 epistemicHandling 说明自己如何处理相关 epistemicPositions：分别估计误判代价、当前动作可逆性、行动中能否继续获得证据和延迟代价。没有相关不确定性用 not_relevant。不要把所有不确定性都折成一项询问，也不要假定先核验永远最谨慎；这些数值只交给心理工具计算，不替本人选择。直接追求整个欲望、观察别的现实线索、延期或做无关生活事务时 criterionUses 可以为空。每个候选都要用 desireRelations 回答反事实：若它完全成功，本人实际会得到什么；它是在直接进入终局、创造条件、有限试探、延期、回避，还是拿更便宜的东西替代真正想要的经验。这里可以用完整终局合同核对结果，但核对不能反过来创造候选。信息收益不能冒充欲望满足；若动作只确认一个本来没有异常证据的手边物件或重复已知状态，它可以是人物真实想到的选择，但不得包装成推进另一个开放欲望。若仍选择它，诚实标为 defer、unrelated 或 substitute，并让机会成本与后续无进展反馈存在。若候选涉及交手、合作、带路或其他需要双方同意、在说完之后仍需共同执行的真实活动，用 sharedActivity 表示提议、回应、协调、开始、完成或撤回；你不能替另一人物同意，也不能把尚未接受的活动直接开始。完整条件只保存在 sharedActivity；candidate intention 只写本人私下想尝试的一个动作与目标，不重复整理成准备公开的命题表，也不在本阶段决定披露提纲。普通提问、回答、打听、闲谈或顾左右而言他只属于对话线程，sharedActivity.operation 填 none，不能为轮流说话另造一个待批准的共同活动。每个候选必须用 actionBinding 把动作绑定到一个具体世界锚点：对人用 character，对物用 object，去某处用 place，占用某个客位用 position，执行 availableAffordances 中的一项现实能力用 affordance，纯说话或沉默用 none；只填 kind 对应的那一个 id，且只能引用本人确实感知到的锚点。actionFeasibilities 是本人当前可知、可能过时的行动条件，不是命令，也不是奖励：容易做到不等于值得做，物理上能走也不等于已经获得许可。地点移动若存在相应表面，必须真实引用；本人可以遵守、怀疑、没留意或明知越界仍去，但不能把已知的许可冲突伪称为无关。数学工具会按本人的谨慎、自控、冲动、社会暴露敏感度计算主观摩擦，仍不替本人选择。用 feasibilityHandling 表明当前动作是在遵循前提、怀疑判断、明知冲突仍尝试，还是与该表面无关；先到达再拿取时，目标是拿到物件，当前原子步骤仍应是 move，并标为 prerequisite_step。'走过去、坐下、再观察'这类复合意图必须拆开：本候选只承载当前主动作；若本人确实保留下一步，可在选择阶段的 continuationIntentions 中写成收到本步客观结果后重新考虑，而不是预先强制未来动作。worldProjection.temporalContext 是本人可知的剩余时间和逾期后果，ownTimeExperience 是本人实际等待的记录。不要把已经答应、维持准备或等下一次机会当作目标已经推进。短暂看听结束后仍无新依据时，可以重新考虑手段、询问、协商、做前置工作、离开或有条件地继续等；这些是可能性，由本人取舍。工作可供性的 expectedDurationSeconds 是完整一个单位的客观耗时，不必拆成逐斧、逐口的重复准备。世界可供性只是材料，不是封闭菜单；不要选择、不要写台词或具体表演。",
    awaiting_agent_choice_and_regulation: "数学结果只是你本人的心理估值，不是命令。由你从自己生成的候选中选择一个，并决定怎样调节情绪；可以选择非最高预测值。候选评估中的 epistemicAssessment 只分别计算误判风险、行动中学习价值和延迟代价：它不要求先消除不确定性。结合人物性格、欲望、动作可逆性与错误后果，亲自决定是暂信、边做边验、先核验、悬置、回避还是利用歧义。用 goalPreservation 说明哪些欲望的终局仍被本人保留，以及自控究竟改变了地点、时机、力度、披露或方式，还是接受了延期与残余挫折。terminalExperiencePreserved 表示人物没有拿更便宜的代理目标替换原欲望，不表示本轮行动已经推进或满足欲望：defer、avoid 或 unrelated 的行动仍可能让欲望留在人物心里；只有 substitute 或破坏 nonSubstitutableConditions 时不能填写 true。不要把信息代理说成已经获得终局经验。regulationChoice 只选择如何处理情绪及本人接受什么代价，不写期望公开传达的命题或表达提纲。随后从 impulseGroundingSurface 中实际可见的共同语境、本人行动、关系、身体、记忆和声音倾向，写出调节前自然冒出的 automaticCommunicationImpulse：它可以想说、想沉默、想用动作挡开或同时存在冲突，但只能引用本人真的感知到的 evidence、共同语境 anchor 和本人拥有的心理 source。feltTendency 是半成形的语义／情感方向，不是台词；不要在本阶段形成调节后的表达计划。continuationIntentions 是本人愿意保留的零至三个条件性短期意图；若人物主动把一件多步事务拆成当前一步与下一步，可用 own_action_settled 表示“等本人这一步得到客观结算后再重新决定”，它只保证再次思考，不预选下一动作。不要预写实际台词、动作表演或世界结果。",
    awaiting_agent_turn_commit: "你仍是刚才完成选择的同一个人物。expressionMoment 是你此刻正在经历的现场：真实前情、刚听见的原话、手边活动、关系与身体、仍活着的欲望和情绪、自己的声音倾向，以及已经锁定的动作。它不是台词摘要，也不是要逐项交代的任务表。先让这些东西在同一瞬间自然相撞，再决定这个人实际上开口、停顿、回避、说错、撒谎、沉默或用动作表达什么。对现场人物的身份、称谓、年龄、性别或关系，只能使用本人当前感知与记忆明确提供的部分；未知时用来人、对方、此人等中性指代，不能凭姓名、底层句柄或习惯擅自补全。languageUse 是这个人物在剧情内真正会用于公开说话的语言能力，只约束 literalSpeech，世界不会替人物翻译。bodyDelta 和 affectiveDeltas.feature 仅为审计草稿；实际身体动作选 bodyActions，情绪表面选受支持的 cue。动作散文不能建立物体变化、声音或移动。字面对白仍由本人写定。只提交这一刻真正新增的 ActionAttempt 与 PublicExpression。privateExpressionTrace 必须在公开表达写定以后回看实际结果：affectiveDeltas 非空就表示真的泄漏，mode 必须是 leak_publicly，primaryChannelId 必须与泄漏通道一致；若 mode 是 contained_privately 或只影响措辞、时机、动作，affectiveDeltas 必须为空。若这句话确实回复或续接 expressionMoment.conversationAnchors 中的一段经历，只在 conversationAnchorSelection 选择其中一个 opaque anchor、允许的 mode 和实际说话对象；不要猜写或复述世界线程号、来源动作或父话轮。新开话题或沉默时选择 none。literalSpeech 非空时，postTurnDisposition 由人物本人选择 keep_resumable 或 close_for_self；没有说话时只能选择 no_thread。它只决定本人一侧是否愿意续接，不能替对方关闭，也不能从“再见”、拒绝或沉默的字面自动推断。不要给自己的话预先分类，不要解释后台规则，不要复述未变化的姿势、持物和物件状态。",
    awaiting_agent_expression_planning: "你仍是同一个人物。行动、自动语言冲动和调节策略已经由你选择；数学只提供控制消耗、情绪泄漏与条件性语言习惯压力，没有替你决定表达。现在决定原始冲动有多少真正进入公开行为。若选择涉及共同活动，communicationNeedSurface 会区分眼下必须让对方认得的核心动作、需要协调的变化与可留在私人理解中稍后再谈的条件；它不替你决定披露，也不是台词清单。publicStance 不是话术表：interactionMove 只说明交往动作，releasedMeaning 只保留调节后愿意让声音或动作承载的那股意思，不能预写完整句子或列出命题清单。人物可以答、问、拒绝、回避、反问、撒谎、沉默、顾左右而言他，也可以因情绪和性格多说；不要为了让后台字段齐全而增加公开解释。privateRemainderPresent 只标记仍有未说内容，不把私密理由交给下一阶段。speechHabitTool 是此刻的条件性倾向，可采用、抵抗或偏离，不能把习惯说明念给对方。先读本人亲历的共同前情和上一句实际话语，再形成一个连贯的公开姿态；不要改选行动、写实际台词或宣布世界结果。",
    awaiting_agent_realization: "现在让同一个人物用自己的身体和嗓子完成已经选定的公开姿态。worldSurface 给出亲历前情、本人刚做过的事和最近字面话语；regulatedExpressionPlan.publicStance.releasedMeaning 只是一股允许进入行为的意思，不是必须逐字转述的句子。communicationNeedSurface 只帮助你分清哪些共同活动内容是当前新变化，哪些仍可留在私人理解里；它不禁止你多说，也不要求你逐项说。请从人物此刻真正注意的具体处自然开口、停顿、转开或沉默，允许关系熟悉带来的省略，也允许情绪、身体和性格改变节奏与措辞。不要自评是否像表单，不要对照后台项目逐条验收；只需让发言和动作成为这个人在这一刻会做的一个完整具身节拍。privateRemainderPresent 仅表示还有东西没说，禁止自行展开。speechHabitSurface 只是压力表，只登记真正进入本次声音的习惯。已选动作和世界锚点已经锁定：actionAttempt 必须继承 selectedAction 的 attemptPrimitive 与 actionBinding；可以让短暂目光、停顿、手边动作与一句话自然共存，但不能偷换为第二个独立战略选择，也不能宣布世界结果。",
  };
  if (stageInput.phase === "awaiting_subjective_appraisal_and_candidates") {
    const repair = stageInput.protocolRepairFeedback
      ? "\n\n上一份合并输出没有通过协议。仍由同一个人物完整重做 appraisal 与 candidates；只修正 protocolRepairFeedback 指出的结构、引用或 authority 错误，不进入选择和公开表达。"
      : "";
    return `你是同一个 Character Agent，正在一次私人思考中依次完成主观评估与候选生成。

先完成 appraisal：只依据本人收到的 recipient-specific worldProjection 与 privateContext，说明本人实际注意了什么、如何理解、哪些欲望、价值、关系、身体、职责、承诺或当前活动被牵动。再完成 candidates：候选不是世界菜单，也不是数学替你生成的答案，而是同一个人物在刚才那份 appraisal 之后真正想到的三至四种此刻可能行动。

两个对象虽然在同一份 JSON 中返回，因果边界仍然严格：candidate 只能使用 sibling appraisal.noticedEvidenceIds 中的世界证据；epistemicHandling.positionIds 只能引用 sibling appraisal.epistemicPositions 中本人刚保留或形成的 positionId；criterionUses 只能引用 sibling appraisal.desireGroundings 中被本人明确提升为 current_concern 的 criterionId。不能预选候选、写公开台词、提交世界结果，也不能让候选声称使用自己没有注意到的证据。

本地心理工具会在这份响应通过后，先由 appraisal 计算心理快照，再验证并评价 candidates；评价结果会在下一次调用中返回给你，但 selection 始终为空，数学不拥有人物选择权。凡是私人心理来源 id，只能逐字取自 referenceContract.ownedPsychologicalSourceIds。只输出当前合并 schema 要求的 JSON。${repair}`;
  }
  if (stageInput.phase === "awaiting_agent_choice_and_turn_commit") {
    const repair = stageInput.protocolRepairFeedback
      ? "\n\n上一份合并输出没有通过协议。仍由同一个人物完整重做 choice 与 turnCommit；修正 protocolRepairFeedback 指出的违规，不让 Validator 替人物改选，也不要把错误说明写进公开表达。"
      : "";
    return `你是同一个 Character Agent，正在同一个连续瞬间里完成自己的选择、调节策略与公开节拍。

candidateEvaluation 是本地心理数学对你自己所生候选的真实压力反馈，但 selection 必须为 null：它不替你选择。先由你在 choice 中选择一个 candidateId、决定 regulationChoice、保留或改变什么目标，并形成调节前 automaticCommunicationImpulse。然后只使用 candidateCommitContexts 中与所选 candidateId 对应的 expressionMoment，把同一个已选动作写成 turnCommit；不得混用另一候选的动作、锚点或表达现场。

服务器会先接受 choice，再用既有本地心理工具计算这项 regulationChoice 的真实 residualEmotion、channelLeakagePressures、remainingControl 与 regulationCost，最后才校验同一响应中的 turnCommit。因而 turnCommit 必须诚实承接当前 psychologySnapshot 与自己刚选的调节方式：不能把强烈情绪当作凭空消失；若选择 contained_privately、shape_wording、shape_timing 或 shape_action，publicExpression.affectiveDeltas 必须为空；若确实公开泄漏，mode 必须为 leak_publicly，通道要一致。任何矛盾都会使整个合并响应在进入世界前被拒绝。

literalSpeech 只写人物真正说出的字面话；bodyDelta 和 affectiveDeltas 只写这一刻新出现的可观察变化，不复述持续姿势或后台心理。只能提交 ActionAttempt 与 PublicExpression，不能宣布世界是否成功，也不能把 privateReason、数值、数学标签或对话流程说明念成台词。只输出当前合并 schema 要求的 JSON。${repair}`;
  }
  const repairRule = stageInput.protocolRepairFeedback
    ? `\n\n上一份同阶段输出没有被协议接受。protocolRepairFeedback 只列出结构、authority 或本人不拥有的引用错误。你仍是同一个人物，必须重新输出当前阶段的完整结果；只修正这些违规，不进入下一阶段，不让 Validator 替你删除心理内容、补写欲望、选择行动或改变公开表达。只能使用本输入 referenceContract 中本人确实拥有的 id。`
    : "";
  if (stageInput.phase === "awaiting_character_day_planning") {
    return `你就是这个人物，正在为自己安排本次 horizon 指定范围内的生活意向。${stageInput.horizon?.granularity === "near_term_blocks" ? "这次只作一至四个近程安排。" : "整天模式使用 24 小时内的五至八个粗时间块。"}

只能依据 privateContext 中本人的记忆与信念、自我认识、已经接受的职责与承诺、当前活动和 currentBodyNeeds 来形成 submissionContract 指定数量的时间块。near_term_blocks 只安排眼前可重新判断的短事务，每块不得超过 maxBlockSeconds；不必填满计划时域，也不要把入座、看一眼、答一句扩成小时级活动。远期愿望继续留在自己的记忆与承诺中。currentBodyNeeds 只表示本人此刻的饥饿、口渴、疲劳、疼痛与体力感受，是可考虑的本人私有材料，不是调度命令：任何数值或分档都不会自动替你安排吃饭、喝水、休息或其他时段。relativeStartSeconds 与 relativeEndSeconds 都相对本次 horizon.startAtSeconds，必须落在本次 horizon.durationSeconds 内，时间块不能重叠；sourceIds 必须逐字取自 referenceContract.ownedSourceIds，desiredZoneHandle 只能为空或逐字取自 referenceContract.allowedZoneHandles。

这是可以被来客、意外、身体需要和新认识打断或日后修订的生活意向，不是动作脚本。activityType 只写宽泛生活活动，privatePurpose 只写本人的简短理由；不要预选原子动作，不要写行动尝试、台词、公开表达、别人会怎样回应或世界将发生什么，也不要宣称计划已经完成。只输出当前 schema 要求的 JSON。${repairRule}`;
  }
  if (stageInput.phase === "awaiting_character_reflection") {
    return `你就是这个人物，正在独自整理最近真正留在本人记忆里的经历。

只能依据 privateContext.memorySlice 中本次机会列出的本人记忆，形成零至五条主观洞见；每条 sourceMemoryIds 必须逐字取自 submissionContract.allowedSourceMemoryIds。洞见可以概括反复出现的倾向、关系感受、矛盾、担忧或对自己的新认识，但它仍是本人的推断，不是世界事实，也不能替别人下结论。若这些经历尚不足以形成诚实的新洞见，insights 用空数组。

activePlanProjection 只是本人此前保留的计划，可帮助理解自己为何在意这些经历；它不是命令。不要生成候选、选择动作、修改世界、关系数值或日程，不要写台词、公开表达或第三人称旁白。只输出当前 schema 要求的 JSON。${repairRule}`;
  }
  if (stageInput.phase === "awaiting_agent_turn_commit") {
    const atomicRepairRule = stageInput.protocolRepairFeedback
      ? "\n\n上一份输出只有协议结构或引用错误。仍由同一个人物重写这一整个公开节拍；修正所列错误，不改变已经锁定的动作，也不要把错误说明说出口。"
      : "";
    return `你就是这个人物，正活在同一个连续瞬间里。\n\n${rules.awaiting_agent_turn_commit}\n\nexpressionMoment.voiceHabits 只是此刻可能冒出来的个人习惯，不是命令；recentUseFatigue 越高，越不该机械重复同一种表面。人物的欲望、关系、情绪、身体、刚听见的话和手边动作可以互相打断，也可以让一句话没说满。不要追求把信息交代完整，只让这一拍真实发生。先从 recentLiteralTurns 中最后一句真实话语和 livedContinuity 中本人此刻的身份、职责、手边活动重新听一遍现场，再让内部冲动只改变取舍、节奏、停顿和锋芒；禁止把“有限披露、维持交换、拉回方向、等待回应、结束话轮”这类后台操作说明翻译成公开台词。普通相邻话轮里，回答完对方刚问的内容就已经自然把话轮交还，不必另说“现在你可以回答”“该你说了”或解释谈话流程；只有人物真的选择施压、挑衅或支配，且当前情绪与关系确实支持时，才可能把这种话轮控制公开出来。literalSpeech 只能使用 expressionMoment.languageUse.availablePublicLanguages 中人物实际会说的语言；bodyDelta 与 affectiveDeltas.feature 则统一使用 expressionMoment.expressionProtocol.publicDescriptionLanguage 描述事件，两者不要混为一层。\n\n只输出当前 schema 要求的 JSON。${atomicRepairRule}`;
  }
  const situationalCandidateRule = stageInput.phase === "awaiting_agent_candidates"
    ? "\n候选的真实来源不只有长期欲望：价值与自我认识、关系、身体、正在做的事、本人已经接受的角色与职责、承诺，以及眼前实际出现的机会，都可以独立使一个动作进入考虑。desireRelations 只诚实说明候选与欲望的关系；它可以为空或 unrelated，不能为了让普通生活动作显得重要而硬绑到当前长期欲望。若 currentResponsibilities 中有涉及本人已经感知到的在场者或事务的 objectiveOpportunityCue，不得仅因它与长期欲望无关而从候选中消失；至少让一个本人可能采取的履责、招呼、延后、请人接手或明确忽略候选进入比较，但仍不得预选它。"
    : "";
  const scopedPsychologyRule = ["awaiting_subjective_appraisal", "awaiting_agent_candidates", "awaiting_agent_choice_and_regulation"].includes(stageInput.phase)
    ? "\n人物档案中的恐惧、防御、创伤、证据偏好和披露阻力都只能在各自声明的 scope 或当前确有证据激活的相邻领域生效，不能仅因词面相似便泛化到所有行动。例如害怕公开自身身体弱点，不等于害怕普通自报姓名；在高后果能力判断中偏好第一手证据，不等于日常低成本交往前必须核验一切。先判断当前事件是否真的落在该作用域内，再让相关权重进入数学估值。automaticCommunicationImpulse.motiveSourceIds 可以为空；不要为了填字段把与此刻关联很弱的长期欲望强行变成说话原因。"
    : "";
  const uncertainIdentityRule = [
    "awaiting_subjective_appraisal",
    "awaiting_agent_candidates",
    "awaiting_agent_choice_and_regulation",
    "awaiting_agent_expression_planning",
    "awaiting_agent_realization",
  ].includes(stageInput.phase)
    ? "\nperceivedCharacters 只提供本人真正注意到的人物表面。身份、称谓、年龄、性别或关系没有在当前感知与本人记忆中明确给出时，只能用来人、对方、此人等中性指代；不能从姓名、底层句柄、常见印象或语言习惯擅自补全。"
    : "";
  const activityRule = ["awaiting_agent_candidates", "awaiting_agent_choice_and_regulation", "awaiting_agent_turn_commit", "awaiting_agent_expression_planning", "awaiting_agent_realization"].includes(stageInput.phase)
    ? "\nongoingOwnActivities 是本人此刻没有自动消失的生活。人物可以继续、暂停、放下，或把回应自然嵌进手边动作；不要因有人出现便默认停下，也不要让一句话无故悬在身体之外。"
    : "";
  const responsibilityRule = ["awaiting_subjective_appraisal", "awaiting_agent_candidates", "awaiting_agent_choice_and_regulation"].includes(stageInput.phase)
    ? "\ncurrentResponsibilities 只把本人已接受的身份、既有职责和眼前客观机会放进心理判断；selection 永远为空。人物可以感到责任拉力，也可以继续原事、稍后处理、请别人接手、忽略或离开，不能把它当成世界下达的招呼或说话命令。"
    : "";
  return `你是同一个 Character Agent，当前处于一个逻辑回合的 ${stageInput.phase} 阶段。

${rules[stageInput.phase] || "只完成当前阶段。"}${situationalCandidateRule}${scopedPsychologyRule}${uncertainIdentityRule}${activityRule}${responsibilityRule}

数学工具构成你此刻真实的心理压力，但不拥有你的选择权。不要把 privateReason、数值、后台标签或心理总结直接念成台词。
凡是 relevanceLinks.sourceId 或 expectedEffects.sourceId，只能引用 referenceContract.ownedPsychologicalSourceIds 中的 id。世界证据、可供性、义务、资源、物件、地点与过程可以影响你的理解，但不是你拥有的心理来源 id。
只输出当前 schema 要求的 JSON。${repairRule}`;
}

export function tavernCharacterAgentV2UserPrompt(stageInput = {}, {
  format = globalThis.process?.env?.GTOWN_CHARACTER_PROMPT_FORMAT || "shared",
} = {}) {
  resolveCharacterPromptFormat(format);
  const indent = format === "expanded" ? 2 : undefined;
  const referenceContract = stageInput.referenceContract || {};
  const perceivedFeasibilitySurfaces = (stageInput.worldProjection?.actionFeasibilities || []).map((surface) => ({
    surfaceId: clean(surface?.feasibilityId),
    targetHandle: clean(surface?.targetHandle),
    bindingKind: clean(surface?.bindingKind),
    currentlyAttemptable: typeof (surface?.directAttempt?.currentlyAttemptable
      ?? surface?.directManipulation?.currentlyAttemptable) === "boolean"
      ? (surface?.directAttempt?.currentlyAttemptable ?? surface.directManipulation.currentlyAttemptable)
      : null,
    status: clean(surface?.directAttempt?.status || surface?.directManipulation?.status),
    socialAccess: surface?.socialAccess ? {
      permissionRequiredByNorm: surface.socialAccess.permissionRequiredByNorm === true,
      permissionCurrentlyGranted: surface.socialAccess.permissionCurrentlyGranted === true,
      violationPhysicallyPossible: surface.socialAccess.violationPhysicallyPossible === true,
      boundaryIds: [...new Set((surface.socialAccess.boundaryIds || []).map(clean).filter(Boolean))],
      claimantIds: [...new Set((surface.socialAccess.claimantIds || []).map(clean).filter(Boolean))],
      possibleResponseTags: [...new Set((surface.socialAccess.possibleResponseTags || []).map(clean).filter(Boolean))],
    } : null,
    knownPrerequisiteOptions: (surface?.knownPrerequisiteOptions || []).map((option) => ({
      primitive: clean(option?.primitive),
      destinationId: clean(option?.destinationId),
      currentlyAttemptable: option?.currentlyAttemptable !== false,
      socialAccess: option?.socialAccess ? {
        permissionRequiredByNorm: option.socialAccess.permissionRequiredByNorm === true,
        permissionCurrentlyGranted: option.socialAccess.permissionCurrentlyGranted === true,
        violationPhysicallyPossible: option.socialAccess.violationPhysicallyPossible === true,
        boundaryIds: [...new Set((option.socialAccess.boundaryIds || []).map(clean).filter(Boolean))],
        possibleResponseTags: [...new Set((option.socialAccess.possibleResponseTags || []).map(clean).filter(Boolean))],
      } : null,
    })),
  })).filter((surface) => surface.surfaceId);
  const candidateReferenceIndex = [
    "awaiting_agent_candidates",
    "awaiting_subjective_appraisal_and_candidates",
  ].includes(stageInput.phase)
    ? {
      candidateCountGuidance: "通常只生成 3 至 4 个此刻真正可能想到的候选；不要为了填满上限制造候选。",
      targetHandle: ["", ...new Set((referenceContract.perceivedTargetHandles || []).map(clean).filter(Boolean))],
      actionBindingByKind: Object.fromEntries(
        ["character", "object", "place", "position", "affordance"].map((kind) => [
          kind,
          [...new Set((referenceContract.perceivedTargetHandlesByBindingKind?.[kind] || [])
            .map(clean).filter(Boolean))],
        ]),
      ),
      feasibilitySurfaceId: ["", ...new Set((referenceContract.perceivedActionFeasibilityIds || [])
        .map(clean).filter(Boolean))],
      feasibilitySurfaces: perceivedFeasibilitySurfaces,
      requiredFeasibilityHandlingShape: {
        surfaceId: "不引用表面时为空；引用时逐字使用 feasibilitySurfaceId",
        relationToGoal: "direct_attempt | prerequisite_step | exploratory | unrelated",
        stance: "follow | question | deliberate_attempt | unknown | not_applicable",
        privateReason: "人物自己的简短理由",
      },
      epistemicPositionId: stageInput.phase === "awaiting_subjective_appraisal_and_candidates"
        ? "逐字引用 sibling appraisal.epistemicPositions 中本次同时形成或保留的 positionId"
        : [...new Set((referenceContract.ownedEpistemicPositionIds || [])
          .map(clean).filter(Boolean))],
      epistemicHandlingRule: stageInput.phase === "awaiting_subjective_appraisal_and_candidates"
        ? "mode=not_relevant 时 positionIds 必须为空；其余 mode 必须至少逐字引用 sibling appraisal.epistemicPositions 中的一个 positionId。"
        : "mode=not_relevant 时 positionIds 必须为空；其余 mode 必须至少逐字引用一个 epistemicPositionId。若索引为空，只能使用 not_relevant。",
      requiredEpistemicHandlingShape: {
        positionIds: [],
        mode: CHARACTER_EPISTEMIC_ACTION_MODES.join(" | "),
        errorIfWrong: "0..1",
        actionReversibility: "0..1",
        learningDuringAction: "0..1",
        delayCost: "0..1",
        privateReason: "人物自己的简短理由",
      },
    }
    : null;
  const choiceReferenceIndex = [
    "awaiting_agent_choice_and_regulation",
    "awaiting_agent_choice_and_turn_commit",
  ].includes(stageInput.phase)
    ? {
      selectableCandidates: (stageInput.generatedCandidates || []).map((candidate) => ({
        candidateId: clean(candidate?.candidateId),
        relatedDesireIds: [...new Set((candidate?.desireRelations || [])
          .map((relation) => clean(relation?.desireId)).filter(Boolean))],
      })).filter((candidate) => candidate.candidateId),
      goalPreservationRule: "preservedDesireIds 只能取自所选 candidateId 的 relatedDesireIds；没有关联的欲望不能声称由该候选保留。",
    }
    : null;
  const referenceReminder = candidateReferenceIndex
      ? `\n\n当前候选阶段的短索引与必填心理工具形状：\n${JSON.stringify(candidateReferenceIndex, null, indent)}\n每一个候选都必须完整填写 feasibilityHandling 与 epistemicHandling。任何自然语言概念若不在这个索引中，就不是可引用的内部 ID。不得翻译、缩写或猜造 ID；可以改想别的候选，也可以使用空 targetHandle、none actionBinding 与不相关的 feasibilityHandling。若本人想到的最终物件或地点不在索引中，但索引里存在通向它的当前可达地点，本候选只能把当前原子 move 绑定到那个真实可达地点；不得把尚不可引用的最终地点填进 targetHandle 或 actionBinding。若引用 requires_prerequisite 的表面并选择 prerequisite_step，当前候选的 attemptPrimitive 与 destinationId 必须逐字对应其中一项 knownPrerequisiteOptions；否则不要声称正在遵循该前置步骤。地点表面的 socialAccess 同时是人物已知的社会事实：物理上能走不等于已经获得许可。permissionRequiredByNorm=true 且 permissionCurrentlyGranted=false 时，移动候选必须引用该表面；follow 不能假装许可已经存在，但本人仍可用 question、unknown 或 deliberate_attempt 表达怀疑、没留意或明知越界。提交前逐项自查：follow、question、deliberate_attempt、unknown 必须逐字引用一个 feasibility surfaceId；unrelated、not_applicable 的 surfaceId 必须为空。这个索引只约束引用真实性，不替你生成或选择行动。`
    : choiceReferenceIndex
      ? `\n\n当前选择阶段的候选—欲望对应索引：\n${JSON.stringify(choiceReferenceIndex, null, indent)}\n先选择 candidateId，再只从该候选的 relatedDesireIds 中填写 preservedDesireIds。这个索引只防止引用矛盾，不替人物选择候选或决定保留哪些欲望。`
      : "";
  return `这是你在当前阶段拥有的私人输入：\n${formatCharacterContextForPrompt(stageInput, format)}${referenceReminder}`;
}

export async function runTavernCharacterAgentV2Stage(stageInput, {
  signal,
  requestBudget = null,
  requestContext = {},
} = {}) {
  const definition = stageDefinition(stageInput.phase, stageInput);
  const startedAt = Date.now();
  const { parsed, meta } = await callOpenAIJson({
    system: tavernCharacterAgentV2SystemPrompt(stageInput),
    user: tavernCharacterAgentV2UserPrompt(stageInput),
    schema: definition.schema,
    schemaName: definition.schemaName,
    // Chat-completions providers only enforce `json_object`, not this nested
    // Character Agent contract. The full schema is therefore part of the
    // character's usable protocol surface; a top-level-only hint hides the
    // required desire, appraisal and enum shapes from the model.
    schemaHintMode: "full",
    signal,
    requestBudget,
    requestContext: {
      characterId: stageInput.characterId || requestContext.characterId,
      agentTurnId: stageInput.agentTurnId || requestContext.agentTurnId,
      phase: stageInput.phase || requestContext.phase,
    },
  });
  return {
    [definition.outputKey]: parsed || {},
    stage: {
      name: `TavernCharacterAgentV2:${definition.stage}:${stageInput.characterId || "unknown"}`,
      provider: "openai",
      model: meta?.model || "",
      elapsedMs: Date.now() - startedAt,
    },
  };
}

function realizationVoiceSurface(tool = {}) {
  return {
    schemaVersion: tool.schemaVersion || 2,
    authority: tool.authority || "character-private-affective-voice-tool",
    selectionAuthority: "character-agent",
    contextSignals: clone(tool.contextSignals || {}),
    parameters: clone(tool.parameters || {}),
    channelLeakagePressures: clone(tool.channelLeakagePressures || {}),
    payloadAxes: clone(tool.payloadAxes || {}),
    forbiddenAuthority: clone(tool.forbiddenAuthority || {}),
    surfaceRule: clean(tool.surfaceRule),
  };
}

function unwrapStageResult(result, key) {
  if (result && typeof result === "object" && result[key] && typeof result[key] === "object") return result[key];
  if (result && typeof result === "object" && result.decision && typeof result.decision === "object") return result.decision;
  return result || {};
}

// Fixed contract text only: raw validator messages can contain private ids or
// facts the current character is not entitled to receive.
const PROTOCOL_REPAIR_GUIDANCE = Object.freeze({
  STAGE_OUTPUT_INVALID_JSON: "Your previous response was not valid JSON. Return exactly one complete JSON object with no prose outside or inside its syntax. Keep your authored decisions, correct JSON syntax, and include all fields required by this stage's schema.",
  AGENT_CANDIDATE_COUNTERFACTUAL_RESULT_MISSING: "Every desireRelations entry, including unrelated or defer, needs a non-empty counterfactualResult describing what this Character would actually experience if the candidate succeeded. Complete that field yourself; retain your other valid decisions.",
  DESIRE_GROUNDING_ACTIVE_WITHOUT_EVIDENCE: "For activationMode=cue_gated, triggered or active needs personally noticed current activationEvidenceIds. Memories alone cannot replace the trigger. Reassess the activation or cite actual noticed evidence; do not invent evidence or change an unrelated decision.",
  CHARACTER_AGENT_GOAL_PRESERVATION_CONTRADICTION: "The selected candidate has a substitute relation or declares preservesNonSubstitutableConditions=false for a preserved desire. It cannot also claim terminalExperiencePreserved=true. Reconcile your preservation claim or candidate choice yourself; defer alone does not imply substitution.",
  CHARACTER_AGENT_RELATIONSHIP_FIRSTHAND_REQUIRED: "A retained relationship change needs noticed firsthand evidence from or about the same perceived target. An anonymous sourceEntityHandle counts; hearsay or another person's self-action does not. Reassess your evidence or provisional/retained judgment yourself.",
  CHARACTER_AGENT_CONTINUATION_TARGET_UNKNOWN: "continuationIntentions[].targetHandle must be empty or a current referenceContract.perceivedTargetHandles entry. A remembered name or a canonical identity is not interchangeable with a perceived handle. Keep or revise your intention yourself.",
  CHARACTER_AGENT_WAIT_CONDITION_INVALID: "Keep the accepted wait action. Choose your own waitCondition: deadline, new_evidence, target_speech or own_process_ready; supply maximumSeconds from 1 to 86400 and interruptOnDirectSpeech true or false. Target speech uses the bound perceived Character; process readiness requires your own existing process. The executor cannot choose these conditions for you.",
  CHARACTER_AGENT_AFFECTIVE_CHANNEL_NOT_LIVE: "Use only a channel listed in expressionMoment.innerContinuity.affectiveResidue.possibleLeakageChannels. It reflects the already-computed regulation outcome; a familiar channel name alone is not evidence that it is active. Keep the accepted action and decide the expression yourself.",
  CHARACTER_AGENT_AFFECTIVE_INFLUENCE_SOURCE_NOT_LIVE: "Cite only expressionMoment.innerContinuity.affectiveResidue.liveEmotions whose intensity is low, medium, high or very_high. A very_low residual is below the material-influence threshold. Keep the accepted action and decide its expression yourself.",
  CHARACTER_AGENT_AFFECTIVE_CHANNEL_MISSING: "When sourceEmotionIds is non-empty, primaryChannelId must name a channel with actual post-regulation pressure, including for contained_privately or shape_wording. Naming a channel does not require public leakage. Choose from the supplied expressionMoment; do not invent a channel or alter the Character's chosen action.",
  CHARACTER_AGENT_RELATIONSHIP_TARGET_REQUIRED: "Use one current referenceContract.perceivedCharacterHandles entry for relationshipAppraisal.targetCharacterId. A recognizedIdentity.characterId or knownEntityHandle is not a perceived person handle. Keep the Character's relationship judgment and correct only its reference.",
  CHARACTER_AGENT_RELATIONSHIP_CHANGE_REQUIRED: "provisional or retained requires at least one actual relationship dimension change and a perceived target and source. If the Character has only a situational impression, use none and put that impression in entityModelUpdates. The Character decides whether any relationship dimension changes.",
  SUBJECTIVE_EPISTEMIC_POSITION_SILENTLY_DROPPED: "Use the current schema's explicit retain_unmentioned update mode and submit only new or revised positions. Unmentioned prior positions on still-perceived subjects remain unchanged; explicitly revise, settle or reject any position the Character now judges differently. Do not treat old evidence as a new observation.",
  DESIRE_GROUNDING_PERSISTENT_MARKED_LATENT: "activationState describes psychological activation, not action feasibility. A persistent desire cannot be inactive or latent; missing target knowledge or action conditions belong in currentlyPerceivedPossible and inhibitors. The Character still decides its pressure and action.",
  AGENT_CANDIDATE_PREREQUISITE_STEP_MISMATCH: "prerequisite_step with follow must bind an attemptable entry in the cited surface's knownPrerequisiteOptions: attemptPrimitive and actionBinding.destinationId must match its primitive and destinationId. An empty list has no such step. relationToGoal describes the action relative to this surface, not preparation for a long-term desire; use desireRelations for that separate relationship. Reassess the label or candidate yourself.",
});

function protocolRepairViolations(error = {}) {
  const genericMessage = "Revise the submitted value at this path to satisfy the current stage schema and owned-reference contract.";
  return (error.issues || []).map((row) => ({
    code: (/^[A-Z][A-Z0-9_]{0,159}$/u.test(clean(row?.code))
      ? clean(row?.code)
      : "CHARACTER_AGENT_PROTOCOL_VIOLATION"),
    path: (/^[A-Za-z][A-Za-z0-9]*(?:\[\d+\])?(?:\.[A-Za-z][A-Za-z0-9]*(?:\[\d+\])?)*$/u.test(clean(row?.path))
      ? clean(row?.path).slice(0, 240)
      : "submission"),
    message: PROTOCOL_REPAIR_GUIDANCE[clean(row?.code)] || genericMessage,
  }));
}

function annotateProtocolStageFailure(error, {
  stageInput,
  stage,
  protocolRepairAttempts = 0,
} = {}) {
  error.failedPhase = clean(stageInput?.phase);
  error.failedStage = clean(stage);
  error.characterId = clean(stageInput?.characterId);
  error.agentTurnId = clean(stageInput?.agentTurnId);
  error.protocolRepairAttempts = Math.max(0, Math.floor(Number(protocolRepairAttempts || 0)));
  return error;
}

function protocolRepairFeedback(error, { stageInput, stage, attempt } = {}) {
  return {
    authority: "character-agent-protocol-validator",
    operation: "same-character-same-stage-rewrite",
    attempt,
    phase: clean(stageInput?.phase),
    stage: clean(stage),
    violations: protocolRepairViolations(error),
    rule: "Rewrite the complete current-stage output yourself. Fix only listed protocol or owned-reference violations; do not advance stage or let the validator choose psychological content or action.",
  };
}

function affectiveVoiceStageSurface(session = {}) {
  const tool = buildTavernAffectiveSpeechRealizationTool({
    voiceContract: session.privateContext.voiceContract || {},
    targetCharacterId: session.generatedCandidates.find((row) => row.candidateId === session.agentChoice?.selectedCandidateId)?.targetHandle || "",
    relationshipContext: session.privateContext.relationships || [],
    psychologySnapshot: session.psychologySnapshot,
    regulationOutcome: session.regulationOutcome,
    bodyState: session.privateContext.state?.body || {},
    agentTurnId: session.agentTurnId,
  });
  return realizationVoiceSurface(tool);
}

function unitSpeechHabitSignal(value, fallback = 0) {
  let numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (Math.abs(numeric) > 1 && Math.abs(numeric) <= 100) numeric /= 100;
  return Math.max(0, Math.min(1, numeric));
}

function uniqueSpeechHabitTags(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => clean(value).toLowerCase().replace(/[\s-]+/g, "_"))
    .filter(Boolean))];
}

/**
 * Turn concrete, already perceived subject matter into broad reusable domains.
 * This is a scene adapter, not an interpretation or choice model: it never
 * decides what the subject means to the character or how the character speaks.
 */
function semanticSpeechHabitTags(values = []) {
  const joined = (Array.isArray(values) ? values : [values])
    .map((value) => typeof value === "string" ? value : JSON.stringify(value || {}))
    .join(" ")
    .toLowerCase();
  const tags = [];
  const add = (tag, pattern) => { if (pattern.test(joined)) tags.push(tag); };
  add("martial", /sword|martial|spar|duel|skill|training|剑|剑法|剑招|武|比试|交手|切磋|修行|练习/u);
  add("identity", /identity|recogn|name|age|身份|认出|姓名|名字|年龄|称呼/u);
  add("body", /body|weak|injur|pain|fatigue|endurance|伤|累|乏|喘|弱|体力|耐力|隐疾|疼|病/u);
  add("own_weakness", /own weakness|admit.*weak|自身弱|承认.*弱|自己的伤|隐疾|求助/u);
  add("service", /service|serve|tea|meal|lodg|payment|茶|饭|酒|住店|客房|房钱|茶钱|饭钱|招呼/u);
  add("tavern_service", /service|serve|tea|meal|lodg|茶|饭|酒|住店|客房|招呼/u);
  add("commitment", /commit|promise|accept|refus|recommend|承诺|答应|拒绝|举荐|准话|回信/u);
  add("guidance", /guide|teach|correct|指点|指导|教|纠正/u);
  add("effort", /effort|practice|improv|认真|用心|练习|进步|改进/u);
  add("help", /help|support|求助|帮忙|帮助|依靠/u);
  add("deliberate_avoidance", /avoid|ignore|evade|回避|装作没看见|故意忽视|顾左右而言他/u);
  return uniqueSpeechHabitTags(tags);
}

function selectedCandidateForSpeechHabits(session = {}) {
  return (session.generatedCandidates || [])
    .find((row) => row?.candidateId === session.agentChoice?.selectedCandidateId) || {};
}

function selectedMotiveAlignment(candidate = {}) {
  const relationStrength = {
    direct_contact: 0.94,
    enable: 0.68,
    probe: 0.52,
    defer: 0.3,
    avoid: 0.14,
    substitute: 0.08,
    unrelated: 0.1,
  };
  return Math.max(0, ...(candidate.desireRelations || []).map((row) => (
    Number(relationStrength[clean(row?.relation)] || 0) * unitSpeechHabitSignal(row?.confidence, 0.5)
  )));
}

function relationshipSpeechHabitContext(session = {}, candidate = {}) {
  const targetId = clean(candidate.targetHandle);
  const row = (session.privateContext?.relationships || [])
    .find((relationship) => clean(relationship?.otherCharacterId) === targetId) || null;
  const target = (session.worldProjection?.perceivedCharacters || [])
    .find((character) => clean(character?.id) === targetId) || {};
  const label = clean(row?.label).toLowerCase();
  const tags = [];
  if (targetId && !row) tags.push("stranger");
  if (/父子|父女|父亲|爹/u.test(label)) tags.push("father", "family");
  if (/母子|母女|母亲|娘/u.test(label)) tags.push("mother", "family");
  if (/夫妻|家人|兄弟|姐妹|兄妹|姐弟/u.test(label)) tags.push("family");
  if (/发小|好友|朋友|旧识|同门|熟客/u.test(label)) tags.push("close_peer");
  if (/客|访/u.test(`${label} ${clean(target?.standing)} ${clean(target?.role)}`)) tags.push("guest");
  if ((candidate.domains || []).includes("martial") && targetId) tags.push("prospective_opponent");
  return {
    tags: uniqueSpeechHabitTags(tags),
    closeness: unitSpeechHabitSignal(row?.publicPressure?.closeness),
    tension: unitSpeechHabitSignal(row?.publicPressure?.tension),
  };
}

function speechHabitTurnContext(session = {}) {
  const candidate = selectedCandidateForSpeechHabits(session);
  const automaticImpulse = session.agentChoice?.automaticCommunicationImpulse || {};
  const expressionPlan = session.regulatedExpressionPlan || {};
  const topicTags = uniqueSpeechHabitTags([
    ...(candidate.domains || []),
    ...semanticSpeechHabitTags([
      candidate.sharedActivity?.kind,
      automaticImpulse.perceivedTurnDemand,
      automaticImpulse.feltTendency,
      expressionPlan.publicStance?.interactionMove,
      expressionPlan.publicStance?.releasedMeaning,
      session.privateContext?.livedSituation?.role,
      session.privateContext?.livedSituation?.standing,
      session.worldProjection?.currentResponsibilities,
    ]),
  ]);
  const noticedEvidenceIds = new Set(session.subjectiveAppraisal?.noticedEvidenceIds || []);
  const noticedEvidence = (session.worldProjection?.evidence || [])
    .filter((row) => noticedEvidenceIds.has(row?.evidenceId || row?.id));
  const noticedInterpretations = session.subjectiveAppraisal?.interpretations || [];
  const directMartialEvidence = semanticSpeechHabitTags([...noticedEvidence, ...noticedInterpretations]).includes("martial")
    && [...noticedEvidence, ...noticedInterpretations].some((row) => /高妙|精妙|高明|excellent|exceptional|masterful/u.test(JSON.stringify(row || {})));
  if (directMartialEvidence) topicTags.push("verified_martial_skill");
  const motiveAlignment = selectedMotiveAlignment(candidate);
  if (topicTags.includes("social") && motiveAlignment < 0.22) topicTags.push("irrelevant_social");
  const relationship = relationshipSpeechHabitContext(session, candidate);
  const emotionMixture = session.psychologySnapshot?.emotionMixture || [];
  const affectTags = emotionMixture
    .filter((row) => unitSpeechHabitSignal(row?.value) >= 0.38)
    .sort((left, right) => Number(right?.value || 0) - Number(left?.value || 0))
    .slice(0, 5)
    .map((row) => row?.emotionId);
  const body = session.privateContext?.state?.body || {};
  const fatigue = unitSpeechHabitSignal(body.fatigue ?? body.fatigueLoad ?? body.exhaustion);
  const pain = unitSpeechHabitSignal(body.pain ?? body.painLoad ?? body.injury);
  const bodyTags = [
    ...(fatigue >= 0.55 ? ["high_fatigue"] : []),
    ...(fatigue >= 0.78 ? ["depleted"] : []),
    ...(pain >= 0.55 ? ["high_pain"] : []),
    ...(unitSpeechHabitSignal(body.hunger) >= 0.58 ? ["hungry"] : []),
    ...(unitSpeechHabitSignal(body.thirst) >= 0.58 ? ["thirsty"] : []),
  ];
  const social = session.worldProjection?.socialContext || {};
  const venueTags = [
    "tavern",
    social.place?.publicAccess === true ? "public_room" : "private_space",
    clean(session.worldProjection?.scene?.zoneId),
  ];
  const hasDirectedSpeech = (session.worldProjection?.perceivedImpacts || []).some((row) => (
    clean(row?.speechAct) && clean(row?.speechAct) !== "none"
  )) || (session.worldProjection?.openConversationThreads || []).some((row) => (
    clean(row?.responseNeed) && clean(row?.responseNeed) !== "none"
  ));
  const usage = session.privateContext?.state?.voiceHabitUsage || [];
  const highestRecordedTurn = Math.max(0, ...usage.map((row) => Number(row?.turnIndex || 0)));
  const sceneTurn = Number(session.worldProjection?.scene?.step);
  const turnIndex = Number.isFinite(sceneTurn) ? sceneTurn : highestRecordedTurn + 1;
  return {
    topicTags: uniqueSpeechHabitTags(topicTags),
    relationshipTags: relationship.tags,
    affectTags: uniqueSpeechHabitTags(affectTags),
    bodyTags: uniqueSpeechHabitTags(bodyTags),
    venueTags: uniqueSpeechHabitTags(venueTags),
    turnMode: hasDirectedSpeech ? "answer" : "self_initiated",
    publicExposure: unitSpeechHabitSignal(social.audienceExposure),
    closeness: relationship.closeness,
    tension: relationship.tension,
    arousal: unitSpeechHabitSignal(session.psychologySnapshot?.affectSummary?.arousal ?? session.privateContext?.state?.mood?.arousal),
    fatigue,
    motiveAlignment,
    disclosurePressure: unitSpeechHabitSignal(automaticImpulse.disclosurePressure),
    inhibitionPressure: unitSpeechHabitSignal(automaticImpulse.inhibitionPressure),
    turnIndex,
  };
}

function speechHabitStageArtifacts(session = {}) {
  const foundation = session.privateContext?.voiceContract?.voiceFoundation;
  if (!foundation?.habits?.length) return null;
  const tool = buildCharacterSpeechHabitPressureTool({
    characterId: session.characterId,
    foundation,
    context: speechHabitTurnContext(session),
    recentCommittedSpeech: session.privateContext?.state?.voiceHabitUsage || [],
  });
  return {
    tool,
    surface: projectCharacterSpeechHabitSurface(tool),
  };
}

function expressionMomentVoiceHabits(surface = {}) {
  const rank = { very_high: 5, high: 4, medium: 3, low: 2, very_low: 1 };
  const tendencies = Object.values(surface.habitPressures || {})
    .sort((left, right) => Number(rank[clean(right?.pressureBand)] || 0) - Number(rank[clean(left?.pressureBand)] || 0))
    .slice(0, 5)
    .map((row) => ({
      habitId: clean(row.habitId),
      tendency: clean(row.function),
      pressure: clean(row.pressureBand),
      recentUseFatigue: clean(row.repeatFatigueBand),
      possibleChannels: uniqueSpeechHabitTags(row.realizationChannels || []),
    }));
  return {
    attentionDrawnTo: uniqueSpeechHabitTags(surface.attentionTargets || []),
    tendencies,
    note: "这些是此刻较活跃的个人习惯，不是句式；人物可以顺从、混合、抵抗或完全不用。",
  };
}

/** Run one complete private v2 turn. This function never resolves the world. */
export async function runTavernCharacterAgentTurnV2(input = {}, {
  runStage = runTavernCharacterAgentV2Stage,
  signal,
  onStageAccepted,
  onStageRejected,
  maxStageProtocolRepairs = 0,
  characterAgentCallMode = "standard",
  executionCheckpoint = null,
  onExecutionCheckpoint,
} = {}) {
  const normalizedCallMode = resolveTavernCharacterAgentV2CallMode(characterAgentCallMode);
  const execution = normalizedCallMode === "three-call" ? createCharacterTurnExecution({ input, protocolVersion: TAVERN_CHARACTER_AGENT_V2_VERSION,
    checkpoint: executionCheckpoint, maxRepairs: maxStageProtocolRepairs, onCheckpoint: onExecutionCheckpoint }) : null;
  if (execution) input = execution.initialInput;
  let session = createTavernCharacterAgentV2Session(input);
  if (normalizedCallMode !== "standard" && (session.submissionMode || "staged") !== "atomic") {
    const error = new TypeError("Combined-appraisal Character Agent execution requires atomic submission mode.");
    error.code = normalizedCallMode === "three-call"
      ? "TAVERN_CHARACTER_AGENT_THREE_CALL_REQUIRES_ATOMIC"
      : "TAVERN_CHARACTER_AGENT_TWO_CALL_REQUIRES_ATOMIC";
    throw error;
  }
  const stages = [];
  const stageInputs = [];
  const notifyStageAccepted = async (acceptedInput, stage) => {
    if (typeof onStageAccepted !== "function") return;
    await onStageAccepted({
      stage,
      phase: acceptedInput.phase,
      agentTurnId: acceptedInput.agentTurnId,
      characterId: acceptedInput.characterId,
    });
  };
  const notifyStageRejected = async (rejectedInput, stage, error, repairAttempt) => {
    if (typeof onStageRejected !== "function") return;
    await onStageRejected({
      stage,
      phase: rejectedInput.phase,
      agentTurnId: rejectedInput.agentTurnId,
      characterId: rejectedInput.characterId,
      repairAttempt,
      issues: protocolRepairViolations(error),
    });
  };
  const repairLimit = Number(maxStageProtocolRepairs ?? 0);
  if (!Number.isSafeInteger(repairLimit) || repairLimit < 0 || repairLimit > 10) {
    throw new RangeError("maxStageProtocolRepairs must be an integer from 0 to 10.");
  }
  const repairableProtocolCodes = new Set([
    "CHARACTER_AGENT_APPRAISAL_REJECTED",
    "CHARACTER_AGENT_CANDIDATES_REJECTED",
    "CHARACTER_AGENT_CHOICE_REJECTED",
    "CHARACTER_AGENT_TURN_COMMIT_REJECTED",
    "CHARACTER_AGENT_EXPRESSION_PLAN_REJECTED",
    "CHARACTER_AGENT_REALIZATION_CONTRACT_REJECTED",
    "CHARACTER_AGENT_REALIZATION_REJECTED",
    "CHARACTER_STAGE_OUTPUT_INVALID",
  ]);
  let protocolRepairAttempts = execution?.repairAttempts || 0;
  const invokeStage = async (invocationInput, stage, options = {}) => {
    try {
      const { onResponseReceived, ...plainOptions } = options;
      const invocationOptions = { signal, stage, ...plainOptions };
      if (onResponseReceived) Object.defineProperty(invocationOptions, "onResponseReceived", { value: onResponseReceived });
      return await runStage(clone(invocationInput), invocationOptions);
    } catch (error) {
      throw annotateProtocolStageFailure(error, {
        stageInput: invocationInput,
        stage,
        protocolRepairAttempts: options.protocolRepairAttempt || 0,
      });
    }
  };
  const submitStage = (invocationInput, stage, submitter, protocolRepairAttempts = 0) => {
    try {
      return submitter();
    } catch (error) {
      throw annotateProtocolStageFailure(error, {
        stageInput: invocationInput,
        stage,
        protocolRepairAttempts,
      });
    }
  };

  const runValidatedStage = async ({ stage, buildInput, prepareInput, submit, initialRepairFeedback = null }) => {
    const replayed = execution?.acceptedStage(stage);
    if (replayed) {
      session = replayed.session; stageInputs.push(replayed.input);
      if (replayed.resultStage) stages.push(replayed.resultStage);
      return;
    }
    let repairFeedback = initialRepairFeedback || execution?.repairFeedback;
    while (true) {
      let stageInput = typeof buildInput === "function"
        ? buildInput(session)
        : buildCharacterAgentStageInput(session);
      if (typeof prepareInput === "function") stageInput = prepareInput(stageInput, session);
      if (repairFeedback) stageInput = { ...stageInput, protocolRepairFeedback: clone(repairFeedback) };
      const outputSchema = execution ? tavernCharacterAgentV2OutputSchemaForStage(stageInput) : null;
      if (execution) stageInput = await execution.prepareStage(stage, stageInput, outputSchema);
      stageInputs.push(clone(stageInput));
      try {
        let result = execution?.pendingResponse;
        if (!execution?.hasPendingResponse) {
          if (execution) await execution.beforeModelCall();
          result = await invokeStage(stageInput, stage, { protocolRepairAttempt: protocolRepairAttempts,
            ...(execution ? { onResponseReceived: response => execution.receiveResponse(response) } : {}) });
          if (execution) await execution.receiveResponse(result);
        }
        if (result?.stage) stages.push(clone(result.stage));
        if (execution) {
          const key = { subjective_appraisal_and_candidates: "appraisalAndCandidates", agent_choice_and_regulation: "choice", agent_turn_commit: "turnCommit" }[stage];
          const checked = prepareCharacterStageSubmission(stageInput, unwrapStageResult(result, key), outputSchema);
          if (!checked.valid) throw Object.assign(new Error("Character stage output does not match the frozen contract."), { code: "CHARACTER_STAGE_OUTPUT_INVALID", issues: checked.issues });
          result = { [key]: checked.output, ...(result?.stage ? { stage: result.stage } : {}) };
        }
        session = submitStage(
          stageInput,
          stage,
          () => submit(session, result),
          protocolRepairAttempts,
        );
        if (execution) await execution.acceptStage(stage, session, result);
        await notifyStageAccepted(stageInput, stage);
        return;
      } catch (error) {
        const repairable = repairableProtocolCodes.has(error?.code)
          && protocolRepairViolations(error).length > 0;
        if (execution && repairable) {
          repairFeedback = protocolRepairFeedback(error, { stageInput, stage, attempt: protocolRepairAttempts + 1 });
          await notifyStageRejected(stageInput, stage, error, protocolRepairAttempts + 1);
          await execution.rejectStage(error, repairFeedback);
          protocolRepairAttempts = execution.repairAttempts;
          continue;
        }
        if (!repairable || protocolRepairAttempts >= repairLimit) {
          await notifyStageRejected(stageInput, stage, error, protocolRepairAttempts);
          throw error;
        }
        protocolRepairAttempts += 1;
        await notifyStageRejected(stageInput, stage, error, protocolRepairAttempts);
        repairFeedback = protocolRepairFeedback(error, {
          stageInput,
          stage,
          attempt: protocolRepairAttempts,
        });
      }
    }
  };

  if (normalizedCallMode !== "standard") {
    await runValidatedStage({
      stage: "subjective_appraisal_and_candidates",
      buildInput: buildCharacterAgentAppraisalAndCandidatesStageInput,
      submit: (currentSession, result) => {
        const payload = unwrapStageResult(result, "appraisalAndCandidates");
        const appraised = submitCharacterSubjectiveAppraisal(
          currentSession,
          payload.appraisal,
        );
        const candidatePayload = payload.candidates || {};
        return submitCharacterAgentCandidates(
          appraised,
          Array.isArray(candidatePayload)
            ? candidatePayload
            : candidatePayload.candidates || [],
        );
      },
    });
  }
  if (normalizedCallMode === "two-call") {
    const combinedStage = "agent_choice_and_turn_commit";
    let combinedRepairFeedback = null;
    while (true) {
      let stageInput = buildCharacterAgentChoiceAndTurnCommitStageInput(session);
      stageInput = {
        ...stageInput,
        candidateCommitContexts: (stageInput.candidateCommitContexts || []).map((context) => {
          const candidateSession = {
            ...session,
            agentChoice: {
              selectedCandidateId: clean(context.candidateId),
              automaticCommunicationImpulse: null,
            },
            regulationOutcome: null,
          };
          const speechHabits = speechHabitStageArtifacts(candidateSession);
          if (!speechHabits) return context;
          return {
            ...context,
            expressionMoment: {
              ...context.expressionMoment,
              voiceHabits: expressionMomentVoiceHabits(speechHabits.surface),
            },
          };
        }),
      };
      if (combinedRepairFeedback) {
        stageInput = { ...stageInput, protocolRepairFeedback: clone(combinedRepairFeedback) };
      }
      stageInputs.push(clone(stageInput));
      const result = await invokeStage(stageInput, combinedStage, {
        protocolRepairAttempt: protocolRepairAttempts,
      });
      if (result?.stage) stages.push(clone(result.stage));
      let payload;
      let chosen;
      try {
        payload = submitStage(
          stageInput,
          combinedStage,
          () => unwrapStageResult(result, "choiceAndTurnCommit"),
          protocolRepairAttempts,
        );
        chosen = submitStage(
          stageInput,
          combinedStage,
          () => submitCharacterAgentChoiceAndRegulation(session, payload.choice),
          protocolRepairAttempts,
        );
      } catch (error) {
        const repairable = repairableProtocolCodes.has(error?.code)
          && protocolRepairViolations(error).length > 0;
        if (!repairable || protocolRepairAttempts >= repairLimit) {
          await notifyStageRejected(stageInput, combinedStage, error, protocolRepairAttempts);
          throw error;
        }
        protocolRepairAttempts += 1;
        await notifyStageRejected(stageInput, combinedStage, error, protocolRepairAttempts);
        combinedRepairFeedback = protocolRepairFeedback(error, {
          stageInput,
          stage: combinedStage,
          attempt: protocolRepairAttempts,
        });
        continue;
      }

      try {
        session = submitStage(
          stageInput,
          combinedStage,
          () => submitCharacterAgentTurnCommit(chosen, payload.turnCommit),
          protocolRepairAttempts,
        );
        await notifyStageAccepted(stageInput, combinedStage);
        break;
      } catch (error) {
        const repairable = repairableProtocolCodes.has(error?.code)
          && protocolRepairViolations(error).length > 0;
        if (!repairable || protocolRepairAttempts >= repairLimit) {
          await notifyStageRejected(stageInput, combinedStage, error, protocolRepairAttempts);
          throw error;
        }

        // Preserve the accepted choice throughout all remaining bounded
        // repairs. Every subsequent call uses the standalone commit schema.
        protocolRepairAttempts += 1;
        await notifyStageRejected(stageInput, combinedStage, error, protocolRepairAttempts);
        session = chosen;
        await runValidatedStage({
          stage: "agent_turn_commit",
          initialRepairFeedback: protocolRepairFeedback(error, {
            stageInput,
            stage: combinedStage,
            attempt: protocolRepairAttempts,
          }),
          buildInput: buildCharacterAgentStageInput,
          prepareInput: (input, currentSession) => {
            const speechHabits = speechHabitStageArtifacts(currentSession);
            return speechHabits ? { ...input, expressionMoment: {
              ...input.expressionMoment, voiceHabits: expressionMomentVoiceHabits(speechHabits.surface),
            } } : input;
          },
          submit: (currentSession, result) => submitCharacterAgentTurnCommit(
            currentSession, unwrapStageResult(result, "turnCommit"),
          ),
        });
        break;
      }
    }

    return {
      protocolVersion: TAVERN_CHARACTER_AGENT_V2_VERSION,
      executionMode: "two-call-atomic-commit",
      protocolRepairAttempts,
      decision: clone(session.finalDecision),
      session,
      stages,
      stageInputs,
    };
  }

  if (normalizedCallMode === "standard") {
    await runValidatedStage({
      stage: "subjective_appraisal",
      submit: (currentSession, result) => submitCharacterSubjectiveAppraisal(
        currentSession,
        unwrapStageResult(result, "appraisal"),
      ),
    });

    await runValidatedStage({
      stage: "agent_candidates",
      submit: (currentSession, result) => {
        const candidatePayload = unwrapStageResult(result, "candidates");
        return submitCharacterAgentCandidates(
          currentSession,
          Array.isArray(candidatePayload) ? candidatePayload : candidatePayload.candidates || [],
        );
      },
    });
  }

  await runValidatedStage({
    stage: "agent_choice_and_regulation",
    submit: (currentSession, result) => submitCharacterAgentChoiceAndRegulation(
      currentSession,
      unwrapStageResult(result, "choice"),
    ),
  });

  if ((session.submissionMode || "staged") === "atomic") {
    await runValidatedStage({
      stage: "agent_turn_commit",
      prepareInput: (stageInput, currentSession) => {
        const speechHabits = speechHabitStageArtifacts(currentSession);
        if (!speechHabits) return stageInput;
        return {
          ...stageInput,
          expressionMoment: {
            ...stageInput.expressionMoment,
            voiceHabits: expressionMomentVoiceHabits(speechHabits.surface),
          },
        };
      },
      submit: (currentSession, result) => submitCharacterAgentTurnCommit(
        currentSession,
        unwrapStageResult(result, "turnCommit"),
      ),
    });
    return {
      protocolVersion: TAVERN_CHARACTER_AGENT_V2_VERSION,
      executionMode: normalizedCallMode === "three-call" ? "three-call-atomic-commit" : "atomic-commit",
      protocolRepairAttempts,
      decision: clone(session.finalDecision),
      session,
      stages,
      stageInputs,
    };
  }

  await runValidatedStage({
    stage: "agent_expression_planning",
    prepareInput: (stageInput, currentSession) => {
      const speechHabits = speechHabitStageArtifacts(currentSession);
      return {
        ...stageInput,
        affectiveVoiceTool: affectiveVoiceStageSurface(currentSession),
        ...(speechHabits ? { speechHabitTool: speechHabits.tool } : {}),
      };
    },
    submit: (currentSession, result) => submitCharacterAgentExpressionPlan(
      currentSession,
      unwrapStageResult(result, "expressionPlan"),
    ),
  });

  await runValidatedStage({
    stage: "agent_realization",
    prepareInput: (stageInput, currentSession) => {
      const speechHabits = speechHabitStageArtifacts(currentSession);
      return {
        ...stageInput,
        affectiveVoiceTool: affectiveVoiceStageSurface(currentSession),
        ...(speechHabits ? { speechHabitSurface: speechHabits.surface } : {}),
      };
    },
    submit: (currentSession, result) => submitCharacterAgentRealization(
      currentSession,
      unwrapStageResult(result, "realization"),
    ),
  });

  return {
    protocolVersion: TAVERN_CHARACTER_AGENT_V2_VERSION,
    executionMode: "staged",
    protocolRepairAttempts,
    decision: clone(session.finalDecision),
    session,
    stages,
    stageInputs,
  };
}

function confidenceBand(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "medium";
  if (numeric < 0.34) return "low";
  if (numeric < 0.67) return "medium";
  return "high";
}

const OBSERVABLE_ACTION_PLACEHOLDERS = new Set([
  "无", "无动作", "没有", "没有动作", "无可见动作", "不适用", "暂无",
  "none", "no action", "n/a", "na", "null", "nil",
]);

/**
 * The realization schema requires `intendedGesture`, so a model with no bodily
 * action writes a placeholder such as "无". A placeholder means "no visible
 * action": it must never render as one, be committed as a world fact, or turn
 * an `act` attempt into a phantom gesture.
 */
function normalizeObservableActionText(value = "") {
  const text = clean(value);
  const core = text
    .replace(/^[\s（(\[【]+|[\s）)\]】。.．,，!！]+$/gu, "")
    .toLowerCase();
  if (!core || /^[-—–_]+$/u.test(core)) return "";
  return OBSERVABLE_ACTION_PLACEHOLDERS.has(core) ? "" : text;
}

function worldAttemptPrimitive(primitive = "none", intendedGesture = "") {
  const normalized = clean(primitive);
  if (WORLD_ATTEMPT_PRIMITIVES.has(normalized)) return normalized;
  const error = new Error(`Unsupported Character Agent action primitive: ${normalized || "(empty)"}. Submit a supported primitive; the world cannot silently discard an explicit action.`);
  error.code = "TAVERN_CHARACTER_AGENT_UNSUPPORTED_ACTION_PRIMITIVE";
  error.evidence = { primitive: normalized, supportedAttemptPrimitives: [...CHARACTER_ATTEMPT_PRIMITIVES] };
  throw error;
}

function actionTypeForAttempt(primitive = "none", literalSpeech = "") {
  if (primitive === "speak") return clean(literalSpeech) ? "speak" : "pass";
  if (primitive === "move") return "move";
  if (primitive === "leave") return "leave";
  if (["interact", "use_affordance"].includes(primitive)) return "interact";
  if (primitive !== "none") return "act";
  return clean(literalSpeech) ? "speak" : "pass";
}

const RAW_CONVERSATION_LINEAGE_FIELDS = new Set([
  "conversationThreadHandle", "lineageBinding", "parentTurnId", "responseToTurnId",
  "sourceActionId", "sourceThreadId", "threadId", "worldThreadId",
]);

function findCharacterAuthoredRawConversationLineage(value, path = "turnCommit") {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findCharacterAuthoredRawConversationLineage(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return "";
  }
  for (const [key, child] of Object.entries(value)) {
    if (RAW_CONVERSATION_LINEAGE_FIELDS.has(key)) return `${path}.${key}`;
    const found = findCharacterAuthoredRawConversationLineage(child, `${path}.${key}`);
    if (found) return found;
  }
  return "";
}

function assertCharacterAuthoredConversationSelectionIsOpaque(turnCommit = null) {
  if (!turnCommit) return;
  const forbiddenField = findCharacterAuthoredRawConversationLineage(turnCommit);
  if (!forbiddenField) return;
  const error = new Error("Character-authored conversation continuation may use only an opaque anchor selection.");
  error.code = "TAVERN_CHARACTER_AGENT_RAW_CONVERSATION_LINEAGE_FORBIDDEN";
  error.evidence = { forbiddenField };
  throw error;
}

function legacySpeechRealizationPlan(realization = {}, affectiveVoiceTool = {}) {
  const plan = realization.speechRealizationPlan || {};
  return {
    mustConvey: clone(plan.propositionalPayload || []),
    mayReveal: clone(plan.mayReveal || []),
    withhold: clone(plan.withhold || []),
    desiredListenerEffect: clean(realization.communicationPlan?.desiredEffect),
    subtext: clean(realization.communicationPlan?.subtext),
    relationshipRegister: clean(plan.relationshipRegister),
    timing: clean(plan.timing) || (clean(realization.utterance?.literalSpeech) ? "standalone" : "silence"),
    appliedVoiceParameters: clone(plan.appliedVoiceParameters || Object.fromEntries(Object.entries(affectiveVoiceTool.parameters || {}).map(([id, row]) => [id, Number(row?.value ?? row)]))),
    intentionalDepartureReason: clean(plan.intentionalDepartureReason),
    minimumSufficiency: clone(plan.minimumSufficiency || {}),
    selfCheck: clone(plan.selfCheck || {}),
  };
}

/**
 * Lower one completed v2 Agent turn into the existing world validator.
 *
 * This adapter never creates candidates, scores them, selects one, changes
 * literal speech, or predicts a world outcome. The compatibility candidate
 * table is derived exclusively from candidates authored by this Agent in this
 * turn, so the legacy normalizer can verify references while the world keeps
 * physical settlement authority.
 */
export function bridgeTavernCharacterAgentV2ResultForWorld(result = {}, input = {}) {
  const session = result.session || {};
  if (result.protocolVersion !== TAVERN_CHARACTER_AGENT_V2_VERSION || session.phase !== "ready_for_world_resolution") {
    const error = new Error("A completed Tavern Character Agent v2 turn is required before world bridging.");
    error.code = "TAVERN_CHARACTER_AGENT_V2_NOT_READY";
    throw error;
  }
  const decision = session.finalDecision || result.decision || {};
  assertCharacterAuthoredConversationSelectionIsOpaque(session.turnCommit || null);
  const selectedCandidateId = clean(decision.selectedCandidateId);
  const realization = decision;
  const finalStageInput = [...(result.stageInputs || [])].reverse().find((row) => (
    ["awaiting_agent_turn_commit", "awaiting_agent_realization"].includes(row.phase)
  )) || {};
  const affectiveVoiceTool = clone(finalStageInput.affectiveVoiceTool || {});
  const finalAttempt = realization.actionAttempt || {};
  const intendedGesture = normalizeObservableActionText(realization.embodiedIntent?.intendedGesture);
  let finalPrimitive = worldAttemptPrimitive(finalAttempt.primitive, intendedGesture);
  // A placeholder-only act still carries its real utterance: the character
  // spoke, so the world receives a speak attempt rather than nothing.
  if (finalPrimitive === "none" && clean(realization.utterance?.literalSpeech)) finalPrimitive = "speak";
  const selectedCandidate = (session.generatedCandidates || []).find((row) => row.candidateId === selectedCandidateId) || {};
  const evaluationById = new Map((session.candidateEvaluation?.evaluations || []).map((row) => [row.candidateId, row]));
  const compatibilityCandidates = (session.generatedCandidates || []).map((candidate) => {
    const evaluation = evaluationById.get(candidate.candidateId) || {};
    const selected = candidate.candidateId === selectedCandidateId;
    return {
      candidateId: candidate.candidateId,
      candidateClass: "character-agent-v2",
      originAuthority: "character-agent",
      label: candidate.intention || candidate.candidateId,
      actionKind: candidate.attemptPrimitive || "act",
      targetCharacterId: candidate.targetHandle || "",
      driveId: candidate.expectedEffects?.[0]?.sourceId || "",
      desire: "",
      semanticFrame: null,
      feasible: true,
      blockedBy: [],
      priorityTier: 0,
      activationScore: Number(evaluation.predictedTendencyProbability || 0) * 100,
      factorLedger: clone(evaluation.factorVector || {}),
      expectedEffects: clone(candidate.expectedEffects || []),
      desireRelations: clone(candidate.desireRelations || []),
      domains: clone(candidate.domains || []),
      sharedActivity: clone(candidate.sharedActivity || null),
      perceivedPrerequisites: clone(candidate.perceivedPrerequisites || []),
      realization: {
        mode: candidate.attemptPrimitive || "act",
        allowSpeech: true,
        requireSpeech: selected ? Boolean(clean(realization.utterance?.literalSpeech)) : false,
        allowedSpeechActs: [...SPEECH_ACTS],
        affordanceId: selected ? clean(finalAttempt.affordanceId) : "",
        responseSourceImpactId: "",
        observationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
      },
      ...(selected ? { speechRealization: { voicePsychologyTool: affectiveVoiceTool } } : {}),
    };
  });
  const bridgedInput = {
    ...input,
    characterAgentProtocolVersion: 2,
    privateActionCandidates: compatibilityCandidates,
  };
  const appraisal = session.subjectiveAppraisal || {};
  const communicationPlan = realization.communicationPlan || {};
  const utterance = realization.utterance || {};
  const selectedActionBinding = clone(selectedCandidate.actionBinding || null);
  const actionTargetCharacterId = clean(finalAttempt.targetCharacterId)
    || (clean(selectedActionBinding?.kind) === "character"
      ? clean(selectedActionBinding?.targetCharacterId)
      : "");
  const speechTargetCharacterId = clean(utterance.literalSpeech)
    ? clean(communicationPlan.intendedAudienceCharacterIds?.[0]) || actionTargetCharacterId
    : "";
  const submittedConversationSelection = session.turnCommit?.conversationAnchorSelection || {};
  const conversationAnchorSelection = {
    anchorHandle: clean(submittedConversationSelection.anchorHandle),
    mode: clean(submittedConversationSelection.mode || "none"),
    targetParticipantHandle: clean(submittedConversationSelection.targetParticipantHandle),
  };
  // An expression audience and a physical action anchor are separate facts.
  // A silent listen/observe action aimed at a place or object must never be
  // rebound to whoever happened to be present in the expression plan.
  const publicTargetCharacterId = actionTargetCharacterId || speechTargetCharacterId;
  const rawDecision = {
    candidateId: selectedCandidateId,
    choiceAuthority: "character-agent",
    actionType: actionTypeForAttempt(finalPrimitive, utterance.literalSpeech),
    speechAct: clean(utterance.speechAct) || (clean(utterance.literalSpeech) ? "inform" : "none"),
    speechFunctions: clone(utterance.speechFunctions || []),
    sourceActionId: "",
    sourceThreadId: "",
    responseToTurnId: "",
    conversationAnchorSelection,
    targetCharacterId: publicTargetCharacterId,
    speechTargetCharacterId,
    speech: clean(utterance.literalSpeech),
    visibleAction: intendedGesture,
    bodyActions: clone(realization.embodiedIntent?.bodyActions || []),
    observableAffectiveTexture: clone(realization.speechRealizationPlan?.affectiveTexture || []),
    moveToZoneId: clean(finalAttempt.destinationId),
    affordanceId: clean(finalAttempt.affordanceId),
    informationSourceImpactId: "",
    commitmentAction: "none",
    commitmentTopic: "",
    decisionValue: "none",
    privateReason: clean(decision.privateDecisionBasis),
    goalPreservation: clone(decision.goalPreservation || {}),
    realizedSpeechHabitIds: clone(decision.realizedSpeechHabitIds || []),
    sharedActivity: clone(decision.sharedActivity || selectedCandidate.sharedActivity || null),
    cognitiveAppraisal: {
      noticedEvidenceIds: clone(appraisal.noticedEvidenceIds || []),
      interpretations: (appraisal.interpretations || []).map((row) => ({
        evidenceIds: clone(row.evidenceIds || []),
        meaning: clean(row.meaning),
        confidenceBand: confidenceBand(row.confidence),
      })),
      beliefOperations: (appraisal.beliefOperations || []).map((row) => ({
        proposition: clean(row.proposition),
        operation: clean(row.operation) || "suspend",
        confidenceBand: confidenceBand(row.confidence),
        sourceEvidenceIds: clone(row.sourceEvidenceIds || []),
        reasoningMode: clean(row.reasoningMode) || "inference",
      })),
      entityModelUpdates: clone(appraisal.entityModelUpdates || []),
      locationBeliefUpdates: clone(appraisal.locationBeliefUpdates || []),
      sourceKnowledgeBeliefUpdates: clone(appraisal.sourceKnowledgeBeliefUpdates || []),
      threadAppraisals: clone(appraisal.threadAppraisals || []),
    },
    relationshipAppraisal: clone(appraisal.relationshipAppraisal || {
      phase: "pending_perception_appraisal",
      targetCharacterId: "",
      sourceImpactIds: [],
      changeMode: "none",
      dimensionChanges: [],
      reason: "",
    }),
    communicationPlan: {
      goal: clean(communicationPlan.goal) || "none",
      tactic: clean(communicationPlan.tactic) || "silence",
      disclosure: clean(communicationPlan.disclosure) || "withhold",
      epistemicRelation: clean(communicationPlan.epistemicRelation) || "not_applicable",
      intendedAudienceCharacterIds: clone(communicationPlan.intendedAudienceCharacterIds || []),
      desiredEffect: clean(communicationPlan.desiredEffect),
      threadDisposition: clean(communicationPlan.threadDisposition) || "none",
      epistemicActionCandidateId: clean(communicationPlan.epistemicActionCandidateId),
      presuppositionStance: clean(communicationPlan.presuppositionStance) || "not_applicable",
      epistemicBasisEvidenceIds: clone(communicationPlan.epistemicBasisEvidenceIds || []),
    },
    speechRealizationPlan: legacySpeechRealizationPlan(realization, affectiveVoiceTool),
    utterance: {
      literalSpeech: clean(utterance.literalSpeech),
      vocalMode: utterance.vocalMode === "call_out" ? "call_out" : "conversational",
    },
    embodiedIntent: {
      manner: clean(realization.embodiedIntent?.manner),
      posture: clean(realization.embodiedIntent?.posture),
      intendedGesture,
      bodyActions: clone(realization.embodiedIntent?.bodyActions || []),
    },
    actionAttempt: {
      primitive: finalPrimitive,
      objectId: clean(finalAttempt.objectId),
      targetCharacterId: clean(finalAttempt.targetCharacterId),
      destinationId: clean(finalAttempt.destinationId),
      positionId: clean(finalAttempt.positionId),
      affordanceId: clean(finalAttempt.affordanceId),
      contactOperation: clean(finalAttempt.contactOperation),
      waitCondition: clone(finalAttempt.waitCondition),
      actionBinding: selectedActionBinding,
    },
  };
  return {
    protocolVersion: TAVERN_CHARACTER_AGENT_V2_VERSION,
    input: bridgedInput,
    rawDecision,
    compatibilityCandidates,
    selectedCandidate: clone(selectedCandidate || null),
    selectedEvaluation: clone(evaluationById.get(selectedCandidateId) || null),
    affectiveVoiceTool,
  };
}
