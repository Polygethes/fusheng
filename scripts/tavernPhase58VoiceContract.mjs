import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  runTavernCausalScene,
  tavernCausalAgentSystemPrompt,
} from "../src/server/pipeline/tavernCausalScene.mjs";

const IDS = {
  son: "char_xyy_xiezenshi",
  zhou: "char_xyy_zhoumin",
  luo: "char_xyy_luozhao",
  yan: "char_xyy_yanzhizhong",
  father: "char_xyy_xieheng",
  mother: "char_xyy_xiemu",
  chen: "char_xyy_chenyan",
};

const failures = [];
const passes = [];

function check(condition, contract, evidence = "") {
  if (condition) passes.push(contract);
  else failures.push({ contract, evidence });
}

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nonEmptyObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length);
}

function voiceBehaviorSignature(contract = {}) {
  const {
    characterId: _characterId,
    characterName: _characterName,
    name: _name,
    schemaVersion: _schemaVersion,
    ...behavior
  } = contract || {};
  return JSON.stringify(behavior);
}

function violationRows(result) {
  if (Array.isArray(result)) return result;
  return [
    ...(Array.isArray(result?.violations) ? result.violations : []),
    ...(Array.isArray(result?.voiceViolations) ? result.voiceViolations : []),
    ...(Array.isArray(result?.semanticViolations) ? result.semanticViolations : []),
    ...(Array.isArray(result?.diagnosticFindings) ? result.diagnosticFindings : []),
    ...(Array.isArray(result?.claimAnnotations) ? result.claimAnnotations : []),
  ];
}

function isExplicitVoiceViolation(row = {}) {
  const code = String(row?.code || row?.type || row || "");
  return /VOICE|GENERIC|BARE|UNNATURAL|REGISTER|CUSTOMER|SERVICE|SIMULATION|ROUND|COURTESY|INSTITUTION/i.test(code);
}

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "scene";
state.ui.engineMode = "openai";

let voiceModule = null;
try {
  voiceModule = await import("../src/server/pipeline/tavernCharacterVoice.mjs");
} catch (error) {
  failures.push({
    contract: "存在 causal 声纹模块 tavernCharacterVoice.mjs",
    evidence: String(error?.code || error?.message || error),
  });
}

const buildVoiceContract = voiceModule?.buildTavernVoiceContract;
const validateVoice = voiceModule?.validateTavernVoiceRealization;
check(typeof buildVoiceContract === "function", "声纹模块导出 buildTavernVoiceContract");
check(typeof validateVoice === "function", "声纹模块导出 validateTavernVoiceRealization");

const characters = state.characters.filter((character) => Object.values(IDS).includes(character.id));
check(characters.length === 7, "测试夹具包含七名望梯酒馆人物", characters.map((character) => character.name).join("、"));

const contracts = new Map();
if (typeof buildVoiceContract === "function") {
  for (const character of characters) {
    let contract = null;
    try {
      contract = buildVoiceContract(character, {
        targetCharacterId: "",
        relationshipContext: [],
        expressionStrategy: { mode: "direct-engagement", directness: "clear", warmth: "neutral" },
      });
    } catch (error) {
      failures.push({
        contract: `${character.name}的 voiceContract 可以被构建`,
        evidence: String(error?.stack || error),
      });
      continue;
    }
    contracts.set(character.id, contract);
    check(nonEmptyObject(contract), `${character.name}有结构化 voiceContract`, JSON.stringify(contract));
    check(
      nonEmptyObject(contract?.voiceFormation) && Array.isArray(contract?.voiceFormation?.sourceOrder),
      `${character.name}声纹声明人格到表达的因果来源`,
      JSON.stringify(contract),
    );
    check(
      nonEmptyObject(contract?.personalityVoice)
        && Array.isArray(contract?.personalityVoice?.attentionPriorities)
        && Array.isArray(contract?.personalityVoice?.appraisalHabits),
      `${character.name}声纹包含注意、评价与披露倾向`,
      JSON.stringify(contract),
    );
    check(nonEmptyObject(contract?.expressionTendencies?.pressureResponse), `${character.name}声纹包含状态驱动的表达变化`, JSON.stringify(contract));
    check(nonEmptyText(contract?.expressionTendencies?.silenceStyle), `${character.name}声纹包含有心理功能的沉默方式`, JSON.stringify(contract));
    check(nonEmptyObject(contract?.relationshipRegisters), `${character.name}声纹包含 relationshipRegisters`, JSON.stringify(contract));
    check(!Object.hasOwn(contract, "sentenceShape"), `${character.name}声纹不设置句长或分句形状`, JSON.stringify(contract));
    check(!Object.hasOwn(contract, "preferredLexicon"), `${character.name}声纹不设置必用标志词`, JSON.stringify(contract));
    check(!Object.hasOwn(contract, "identitySignals"), `${character.name}声纹不设置台词正则身份模板`, JSON.stringify(contract));
  }

  const signatures = [...contracts.values()].map(voiceBehaviorSignature);
  check(
    signatures.length === 7 && new Set(signatures).size === 7,
    "七人的声纹行为结构互异，不能只靠 characterId 或姓名区分",
    JSON.stringify([...contracts.entries()].map(([id, contract]) => ({ id, signature: voiceBehaviorSignature(contract) })), null, 2),
  );
}

// Capture the actual live causal Agent cards instead of testing only seed data.
const capturedInputs = [];
try {
  await runTavernCausalScene(state, {
    allowOrphanVisitors: true,
    characterIds: characters.map((character) => character.id),
    positions: Object.fromEntries(characters.map((character) => [character.id, "hall"])),
    seedImpacts: characters.map((character, index) => ({
      id: `impact_voice_contract_probe_${index + 1}`,
      sourceCharacterId: "world:voice-contract-probe",
      sourceZoneId: "hall",
      type: "information",
      modality: "sound",
      intensity: 95,
      radius: 0,
      directedTargetId: character.id,
      content: `只供${character.name}察觉的声纹输入探针。`,
    })),
    maxSteps: characters.length,
    minimumActivationScore: 0,
    async runAgent(input) {
      capturedInputs.push(structuredClone(input));
      const candidate = input.privateActionCandidates.find((row) => row.feasible && !row.realization?.affordanceId)
        || input.privateActionCandidates.find((row) => row.feasible);
      return { decision: {
        candidateId: candidate?.candidateId || "",
        actionType: "pass",
        speechAct: "none",
        targetCharacterId: "",
        speech: "",
        visibleAction: "",
        moveToZoneId: "",
        affordanceId: "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        privateReason: "确定性声纹输入探针保持安静。",
      } };
    },
  });
} catch (error) {
  failures.push({ contract: "可以捕获 live causal Agent 输入", evidence: String(error?.stack || error) });
}

const capturedById = new Map(capturedInputs.map((input) => [input.agent?.id, input]));
for (const character of characters) {
  const input = capturedById.get(character.id);
  check(Boolean(input), `${character.name}实际参与一次 live causal Agent 输入捕获`);
  check(
    Boolean(input && Object.hasOwn(input.agent || {}, "voiceContract") && nonEmptyObject(input.agent.voiceContract)),
    `${character.name}的 voiceContract 明确暴露在 agent 顶层`,
    input ? `agent keys: ${Object.keys(input.agent || {}).join(", ")}` : "missing input",
  );
}

const promptProbeContract = contracts.get(IDS.mother) || {
  voiceFormation: { sourceOrder: ["人格", "当下状态", "关系", "表达策略"] },
  personalityVoice: { attentionPriorities: ["眼前事务"], appraisalHabits: ["具体判断"] },
  expressionTendencies: { pressureResponse: {}, silenceStyle: "先停下手里的活。" },
  relationshipRegisters: { family: "家常而具体" },
};
const systemPrompt = tavernCausalAgentSystemPrompt({
  agent: { name: "谢母", voiceContract: promptProbeContract },
});
check(
  /voiceContract|声纹/.test(systemPrompt) && /声纹|口吻|嘴里说出来/.test(systemPrompt),
  "causal system prompt 明确要求执行 agent.voiceContract",
  systemPrompt,
);
check(
  /不是句式模板|不设目标字数、分句数|不要为证明声纹强塞标志词/.test(systemPrompt),
  "causal system prompt 把声纹设为人格表达因果而非嘴形模板",
  systemPrompt,
);
check(
  /可以回答、拒绝、延期、反问、回避|别人.+不是强制答题|什么都不做/.test(systemPrompt),
  "causal system prompt 允许人物不承接、回避或保持沉默",
  systemPrompt,
);

const badSamples = [
  {
    label: "裸应答：知道了",
    characterId: IDS.father,
    targetCharacterId: IDS.son,
    speech: "知道了",
    speechAct: "answer",
    requiresSubstantiveAnswer: true,
    affordanceType: "",
  },
  {
    label: "不自然碎句：嗯，空下来过去",
    characterId: IDS.father,
    targetCharacterId: IDS.mother,
    speech: "嗯，空下来过去",
    speechAct: "answer",
    requiresSubstantiveAnswer: true,
    affordanceType: "",
  },
  {
    label: "通用交易话术：茶不错。这是茶钱，收好",
    characterId: IDS.yan,
    targetCharacterId: IDS.mother,
    speech: "茶不错。这是茶钱，收好",
    speechAct: "inform",
    requiresSubstantiveAnswer: false,
    affordanceType: "pay_cash",
  },
  {
    label: "现代客服腔：您看看合不合口味",
    characterId: IDS.mother,
    targetCharacterId: IDS.yan,
    speech: "您看看合不合口味",
    speechAct: "offer",
    requiresSubstantiveAnswer: false,
    affordanceType: "serve_guest",
  },
  {
    label: "模拟轮次泄漏：下一轮药钱你打算从哪来",
    characterId: IDS.mother,
    targetCharacterId: IDS.father,
    speech: "下一轮药钱你打算从哪来",
    speechAct: "ask",
    requiresSubstantiveAnswer: false,
    affordanceType: "",
    expectedCode: "SIMULATION_ROUND_LANGUAGE",
  },
  {
    label: "模拟轮次泄漏：上一轮举荐的事还没有答复",
    characterId: IDS.zhou,
    targetCharacterId: IDS.son,
    speech: "上一轮举荐的事还没有答复",
    speechAct: "inform",
    requiresSubstantiveAnswer: false,
    affordanceType: "",
    expectedCode: "SIMULATION_ROUND_LANGUAGE",
  },
  {
    label: "模拟轮次泄漏：这轮茶钱已经结清",
    characterId: IDS.yan,
    targetCharacterId: IDS.mother,
    speech: "这轮茶钱已经结清",
    speechAct: "inform",
    requiresSubstantiveAnswer: false,
    affordanceType: "pay_cash",
    expectedCode: "SIMULATION_ROUND_LANGUAGE",
  },
  {
    label: "空泛礼貌：感谢您的配合，您先请",
    characterId: IDS.mother,
    targetCharacterId: IDS.yan,
    speech: "感谢您的配合，您先请",
    speechAct: "inform",
    requiresSubstantiveAnswer: false,
    affordanceType: "receive_guest",
    expectedCode: "EMPTY_COURTESY_REGISTER",
  },
  {
    label: "机构播报：本店今日茶饭照常，诸位客官请依次结账",
    characterId: IDS.mother,
    targetCharacterId: "",
    speech: "本店今日茶饭照常，诸位客官请依次结账",
    speechAct: "inform",
    requiresSubstantiveAnswer: false,
    affordanceType: "",
    expectedCode: "INSTITUTIONAL_BROADCAST_REGISTER",
  },
  {
    label: "机构播报：酒馆今日照常营业，有事请到柜台办理",
    characterId: IDS.father,
    targetCharacterId: "",
    speech: "酒馆今日照常营业，有事请到柜台办理",
    speechAct: "inform",
    requiresSubstantiveAnswer: false,
    affordanceType: "",
    expectedCode: "INSTITUTIONAL_BROADCAST_REGISTER",
  },
];

if (typeof validateVoice === "function") {
  for (const sample of badSamples) {
    const character = characters.find((item) => item.id === sample.characterId);
    const voiceContract = contracts.get(sample.characterId)
      || (typeof buildVoiceContract === "function" ? buildVoiceContract(character, {
        targetCharacterId: sample.targetCharacterId,
        relationshipContext: [],
        expressionStrategy: { mode: "direct-engagement", directness: "clear", warmth: "neutral" },
      }) : null);
    let result = null;
    try {
      result = await validateVoice({
        speech: sample.speech,
        speechAct: sample.speechAct,
        characterId: sample.characterId,
        targetCharacterId: sample.targetCharacterId,
        voiceContract,
        requiresSubstantiveAnswer: sample.requiresSubstantiveAnswer,
        affordanceType: sample.affordanceType,
      });
    } catch (error) {
      failures.push({ contract: `${sample.label}可以完成声纹校验`, evidence: String(error?.stack || error) });
      continue;
    }
    const rows = violationRows(result);
    const explicitViolation = sample.expectedCode
      ? rows.some((row) => String(row?.code || row?.type || row || "") === sample.expectedCode)
      : rows.some(isExplicitVoiceViolation);
    check(
      result?.publish === true && result?.publicSpeech === sample.speech,
      `${sample.label}作为人物实际说出口的话必须原样公开`,
      JSON.stringify(result),
    );
    check(
      explicitViolation,
      `${sample.label}必须留下声纹诊断，但诊断不能代替人物开口`,
      JSON.stringify(result),
    );
  }
} else {
  for (const sample of badSamples) {
    failures.push({
      contract: `${sample.label}必须原样公开并留下非阻断声纹诊断`,
      evidence: "validateTavernVoiceRealization 尚未实现",
    });
  }
}

async function roleAddressProbe({ actorId, targetId, speech, label }) {
  const probeState = structuredClone(state);
  const result = await runTavernCausalScene(probeState, {
    allowOrphanVisitors: true,
    characterIds: [actorId, targetId],
    positions: { [actorId]: "hall", [targetId]: "hall" },
    seedImpacts: [{
      id: `impact_phase58_role_${actorId}_${targetId}`,
      sourceCharacterId: targetId,
      sourceZoneId: "hall",
      type: "institution",
      modality: "visual",
      intensity: 100,
      radius: 0,
      directedTargetId: actorId,
      content: "堂前有人，需要决定是否开口。",
      topic: "角色称呼检查",
    }],
    maxSteps: 1,
    minimumActivationScore: 0,
    async runAgent(input) {
      const candidate = input.privateActionCandidates.find((row) => row.feasible && row.targetCharacterId === targetId)
        || input.privateActionCandidates.find((row) => row.feasible);
      return { decision: {
        candidateId: candidate?.candidateId || "",
        actionType: "speak",
        speechAct: "inform",
        targetCharacterId: targetId,
        speech,
        visibleAction: "人物停下手里的事，朝对方抬眼",
        moveToZoneId: "",
        affordanceId: "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        privateReason: "确定性探针故意把角色称谓发给错误对象。",
      } };
    },
  });
  const committed = (result.actions || []).some((action) => action.speech === speech);
  const codes = (result.decisions || []).flatMap((entry) => [
    ...(entry.decision?.claimAnnotations || []),
    ...(entry.decision?.semanticViolations || []),
  ]).map((violation) => violation.code);
  check(committed, `${label}仍是人物可以真实说出口的台词`, JSON.stringify(result.actions || []));
  check(codes.includes("DIALOGUE_ROLE_ADDRESS_MISMATCH"), `${label}必须留下角色称谓与对象不一致的主张标注`, codes.join(","));
}

await roleAddressProbe({
  actorId: IDS.mother,
  targetId: IDS.father,
  speech: "这位客官，灶上还有热饭。",
  label: "谢母把谢恒叫作客官",
});
await roleAddressProbe({
  actorId: IDS.luo,
  targetId: IDS.father,
  speech: "谢掌柜，我想问一件事。",
  label: "洛照把谢恒叫作掌柜",
});
await roleAddressProbe({
  actorId: IDS.luo,
  targetId: IDS.mother,
  speech: "谢掌灶，淋雨湿了衣服。",
  label: "洛照自造不存在的掌灶称谓",
});

if (failures.length) {
  console.error(`tavernPhase58VoiceContract: RED (${failures.length} contracts currently violated)`);
  failures.forEach((failure, index) => {
    console.error(`${index + 1}. ${failure.contract}`);
    if (failure.evidence) console.error(`   evidence: ${failure.evidence}`);
  });
  console.error(`Passing fixture/contracts: ${passes.length}`);
  process.exitCode = 1;
} else {
  console.log(`tavernPhase58VoiceContract:test passed (${passes.length} contracts)`);
}
