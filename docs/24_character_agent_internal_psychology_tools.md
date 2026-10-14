# Character Agent 内部心理工具与自主表达架构

> 状态：设计完成，待作者确认。本文不代表运行时代码已经切换。
>
> 当前验收场：望梯酒馆。目标能力必须可迁移到新人物、新场景、多场景与更多人物。
>
> **2026-07-23 权威补充：** 本文中的“场景规范、许可、可供性”只能作为客观事实或人物主观预期的输入，不得成为场景许可表或统一心理压力。多地点运行与行动尝试边界见 [无场景裁决权的多地点人物世界运行时](./27_no_scene_authority_world_runtime.md)。

## 0. 结论

数学层不再是站在人物之外的行动裁判，也不是台词生成后的修正器。

它应当成为 **Character Agent 自己使用的一组私有心理工具**：把人物已经形成的主观理解，与其欲望、身体、性格、关系、记忆和环境压力结合，计算出真实存在于此人的情绪、冲动、阻碍、调节能力、泄露压力和行动代价。随后仍由这个 Character Agent 生成可能行动、决定是否克制、选择做什么、公开什么，并以自己的身体和嗓子实现。

新的唯一因果链是：

```text
客观世界信号与可供性
  ↓ 接收者相对的感官投影
Character Agent 注意、解释、相信或怀疑
  ↓ 本人调用内部心理工具
欲望激活 + 混合情绪 + 身体压力 + 调节能力 + 关系意义
  ↓ Character Agent 生成自己的候选行动
本人调用候选估值工具，得到压力、代价与不确定性
  ↓ Character Agent 自主选择，并决定如何调节和表达
本人调用泄露工具，得知没有完全压住的通道压力
  ↓ Character Agent 写出动作时序、实际话语和物理尝试
世界只结算时间、空间、物件、传播与客观结果
  ↓ 下一轮由各接收者分别感知和评价
记忆、关系、欲望、身体与自我认识继续变化
```

这里有两个同样重要的原则：

1. **数学结果不是可有可无的建议。** 它构成人物此刻真实的内部心理条件；选择逆着强烈冲动行动会消耗控制力，也可能留下反弹、疲劳、后悔或挫败。
2. **数学结果不是最终决定。** 它不能返回选中的行动、固定表达模式、具体动作或台词，也不能在人物说完后替人物重写。

---

## 1. 本文取代哪些旧条款

本文保留既有方案中的世界事实、相对感知、记忆分层、主观信念、动作尝试与世界结果分离；但正式取代下列旧运行思想：

- `docs/18` 中“场景先产生封闭的合法候选，统一公式完成行动选择，LLM 只负责实现”的链路；
- `docs/19` 中“数学效用选定动作以后，模型不得更换行动”的链路；
- `docs/22` 中为了节省成本，把 `cognitiveAppraisal`、候选选择、表达意图和最终台词塞入同一次模型输出的简化；
- 当前运行时由 `expressionStrategyFor` 根据最高 coping 类别预先指定 `firm-boundary / cool / assert` 等表达方式的做法；
- 把通用 `respond_to_impact` 当作人物具体欲望，并让不同人物共享同一回应压力的做法。

继续有效的边界包括：

- 世界事实不会因人物说错、撒谎或误记而改变；
- 同一事件对不同人物产生不同感知证据；
- 听见不等于相信，记得不等于真实，说出不等于内心相信；
- 人物提交的是尝试，世界返回成功、部分成功或失败；
- 关系变化必须来自接收者自己的评价；
- Narrator、Writer、UI 和观察者账本只能单向读取，不能回流人物和世界。

---

## 2. 唯一权威分工

| 层 | 唯一拥有的权威 | 可以提供 | 明确禁止 |
|---|---|---|---|
| 世界 | 时间、位置、物件、资源、场景规范、信号传播、真实可行性与结果 | 客观信号、资源、诱惑、风险、已知动作时长、可供性 | 推断人物内心、替人物选择、自动改关系、润色台词 |
| 感知投影 | 某个接收者实际可能收到的感觉证据 | 光影、声音、气味、动作表面、遮挡、噪声、匿名句柄 | 确认隐藏身份、替人物决定注意到了什么或意味着什么 |
| Character Agent | 注意、解释、信念、欲望关联、候选生成、调节选择、最终行动、披露、动作和话语 | 调用私有心理工具并参考结果 | 直接写入客观世界成功结果、他人内心或他人关系 |
| 心理数学工具 | 根据本人提交的主观意义与人物参数，计算内部状态、压力、代价、范围和不确定性 | 欲望强度、混合情绪、调节容量、残余泄露、候选效用分解 | 生成候选、返回选中候选、固定表达策略、写动作或台词 |
| 记忆工具 | 保存体验痕迹，计算编码、衰减、检索与混源压力 | 召回片段、来源感、置信与缺损 | 把回忆提升为世界事实，替人物决定相信什么 |
| 世界结算 | 对人物实际提交的尝试作客观结算 | success / partial / failed、耗时、物件变化、传播结果 | 把失败偷偷改成别的成功动作，或解释人物为何这么做 |
| Validator | schema、句柄、来源和越权写入的结构保护 | 报告不可解析或越权字段 | 风格评分、重选行动、补写情绪、改台词使其“更自然” |
| Observer / Writer | 面向用户的观察与成文 | 私有账本的受控展示、可见事件的整理 | 将旁白、心理解释或戏剧要求回写模拟 |

### 2.1 数学工具的禁用字段

任何心理工具输出一旦含有下列语义，即视为权力泄漏：

```text
selectedCandidateId
chosenAction / actionAttempt
expressionStrategy / expressionMode
communicationPlan / tactic / disclosureChoice
literalSpeech / suggestedLine / shouldSay
visibleAction / intendedGesture
worldOutcome
relationshipDeltaAsFact
```

工具可以返回 `candidateEvaluations[]`，但 `selection` 必须为空；可以返回某个通道的泄露压力，但不能把它写成“抬眼盯住对方”之类具体表演。

### 2.2 Character Agent 的独占字段

下列内容只能由本人 Agent 产生：

```text
noticedEvidenceIds
interpretations / beliefOperations
generatedCandidates
selectedCandidateId
regulationChoice
communicationPlan
speechRealizationPlan
embodiedIntent
utterance.literalSpeech
actionAttempt
```

如果 Agent 选择了低估值行动，系统记录“决定偏离预测”，但不修正。未被模型捕捉的价值、冲动或自我矛盾可成为后续校准证据，而不是当场判错。

---

## 3. 为什么当前样本有情绪数值却没有人物情绪

最近一次洛照—谢真石 Gate 8 样本中：

- 谢真石的模型评价已经写出“警觉中带着好奇”；运行时唤醒度约为 `0.666`，情绪泄露约为 `0.694`；
- 洛照运行时唤醒度约为 `0.954`；
- 但两人都被装入同一个 `respond_to_impact` 候选，并得到相同的通用回应欲望和 `61.2` 压力；
- 候选进入 Agent 前，又被最高 coping 类别预制为 `firm-boundary / cool / assert`；
- voice 工具随后把这一预制策略直接加到直接度、冷暖、保留与压缩参数中。

因此，问题不是“模型完全没有生成情绪”，而是主观情绪没有进入本轮表达的因果位置：

```text
服务端先推断情绪
→ 服务端先生成候选
→ 服务端先指定表达策略
→ voice 参数先计算
→ 最后模型才在最终答案里写 cognitiveAppraisal
```

这个顺序使“警觉中带着好奇”只能成为事后说明，不能改变同一句话的停顿、注视、反问方式和行动中断。洛照“终于可能遇到目标”的期待、兴奋与戒备也没有机会成为同轮心理输入。

---

## 4. 新的 Agent Turn：同一个人物，多次内部推理

“一次人物回合”不再等于“一次把所有 JSON 都吐完的模型调用”。它是同一个 Character Agent 持续拥有上下文的一段私有认知过程。

### 4.1 正式协议

```text
T0  WorldProjection
    世界提供本人可收到的证据、身体事实、关系记忆与环境可供性。

T1  SubjectiveAppraisal
    Character Agent 决定注意什么、如何理解、相信多少，以及牵动了哪些欲望、价值、自我形象和关系期待。

T2  PsychologyToolCall
    工具根据 T1 与人物参数，计算欲望激活、混合情绪、行动倾向、控制容量、认知负荷和调节选项。

T3  CandidateGeneration
    Character Agent 看到自己的心理状态后，提出 3–7 个此刻本人真可能想到的行动；沉默、等待、继续手头动作、误判后的尝试都可成为候选。

T4  CandidateEvaluationToolCall
    工具对本人提出的候选计算预期推进、代价、风险、关系意义、身体成本和不确定性；不选择。

T5  AgentChoiceAndRegulation
    Character Agent 自主选一个候选，并决定压住、重评、延迟、转移、表达或混合调节哪些情绪。

T6  RegulationAndLeakageToolCall
    工具计算本次调节实际可能压住多少、消耗多少，以及哪些身体或声音通道仍有残余压力；不写表演。

T7  Realization
    Character Agent 用自己的嗓子、身体、关系距离和动作时序，写出实际言语与尝试。本人在提交前自行核对高残余情绪是显露、转移、继续压制还是因通道不可用而未显现。

T8  WorldResolution
    世界结算动作耗时、物件、空间、服务、付款、传播和实际结果。

T9  Feedback
    结果成为新的感知证据；人物下一轮再评价满足、挫败、关系与记忆，不由世界自动代写。
```

### 4.2 实现形态建议

首选是同一 Character Agent 会话中的受限工具调用循环。模型可以在一个逻辑回合内先评价，再调用心理工具，再生成并估值候选，最后表达。

若当前受信任通道暂时不能稳定支持工具循环，第一版可采用三段式适配器：

1. 同一 Agent 的评价段；
2. 同一 Agent 的候选生成段；
3. 同一 Agent 的选择与表达段；

中间仅插入本地纯函数。三段必须共享同一个 `agentTurnId`、人物私有上下文和前段原始输出；不得换成 Director、Planner 或另一个“台词 Agent”。成本可以以后优化，不能再次用同轮单输出破坏因果顺序。

---

## 5. 心理变量：共用结构，个人权重

### 5.1 五层输入

所有人物共用同一组变量类别：

```text
Pᵢ  稳定人格与价值权重
Sᵢ(t)  当前身体、心境、疲劳、疼痛、压力与认知负荷
Dᵢ(t)  每个具体欲望、职责、承诺与未决意图
Rᵢ→j(t)  本人指向对方的关系期待与风险，不要求对称
Mᵢ(t)  记忆、信念、自我模型、创伤线索与习惯
E(t)  本人感知到的环境机会、资源、规范、公开性与危险
```

同样清高的两个人可以因为一个疲惫、一个刚获胜；一个面对陌生人、一个面对亲密者；一个欲望受阻已久、一个尚不着急，而产生完全不同的反应。

### 5.2 人格不等于一句标签

一个人物的稳定参数至少分为六组：

| 参数组 | 决定什么 | 不得直接决定什么 |
|---|---|---|
| 注意与评价权重 | 更容易注意何种证据、把什么看得重要 | 具体结论 |
| 情绪响应增益 | 哪类意义更容易激发兴奋、羞耻、愤怒、恐惧等 | 当前唯一情绪 |
| 调节能力与习惯 | 控制容量、习惯压制或重评、调节成本 | 本轮一定压制 |
| 泄露通道敏感 | 情绪更容易从目光、声音、动作还是语言漏出 | 固定动作模板 |
| 候选估值权重 | 欲望、关系、规范、身体、风险各有多重 | 最终行动 |
| 嗓音形成参数 | 压力、亲密、疲劳如何改变直接度、节奏、冷暖与保留 | 固定句式或必用词 |

“洛照清高、克制、怕示弱”不是一句运行指令，而会分别影响：自我相关性、示弱威胁、公共麻烦成本、控制容量、情绪泄露通道和候选代价。

### 5.3 环境既提供阻碍，也提供诱惑

世界向人物提供客观可感知资源：茶、饭、武器、灵宝、金钱、春药、僻静位置、名望机会、危险、旁观者和社会规范。心理工具只计算这些东西对 **这个人物** 的价值。

```text
OpportunityValueᵢ(resource)
= PerceivedAvailability
 × DesireMatchᵢ
 × BelievedUsefulnessᵢ
 × CurrentNeedᵢ
 × PersonalValueWeightᵢ
```

武器对剑修可能显著，对只追逐情欲的人可能近乎无关；春药客观存在也不会自动诱惑所有人物。世界不替人物判定“诱人”。

---

## 6. 主观事件评价

### 6.1 Agent 先提交意义，不提交情绪答案

Agent 的评价对象为本人真正注意到的证据：

```js
SubjectiveAppraisalProposal {
  eventId,
  noticedEvidenceIds,
  interpretations: [{ evidenceIds, meaning, confidence }],
  beliefOperations,
  relevanceLinks: [{
    sourceId,                 // desire / value / self-schema / relationship / memory
    relation,                 // advances / threatens / reveals / contradicts / reminds...
    strength,
    confidence
  }],
  appraisalAxes: {
    selfRelevance,
    goalCongruence,
    novelty,
    expectedness,
    opportunityValue,
    threat,
    controllability,
    changeability,
    certaintyDelta,
    normCompatibility,
    selfImageCongruence,
    publicExposure,
    relationshipMeaning: {
      affiliation,
      status,
      trust,
      rejection,
      care,
      betrayal
    }
  },
  uncertainty,
  alternativesConsidered
}
```

Agent 可以误解、投射、低估或拒绝相信。工具只检查引用证据是否属于本人，不判断意义是否“正确”。

### 6.2 欲望激活

每个具体欲望单独更新，不压成一个通用 `activeGoal`：

```text
Dᵢg(t+1) = clamp(
    retentionᵢg · Dᵢg(t)
  + cueMatchᵢg · noticed · believedRelevance
  + urgencyᵢg
  + frustrationᵢg
  + relationshipExpectationᵢg
  + bodyNeedCouplingᵢg
  - satisfactionᵢg
  - adaptationᵢg,
  0, 1)
```

“回应别人”不是人物欲望。它可以是礼貌、职责、关系维护、好奇、威胁处理或避免麻烦的候选功能，必须回到人物自己的真实驱动力。

### 6.3 混合情绪，而不是一个 dominant 标签

对每种情绪通道 `k` 独立计算：

```text
zᵢk = bᵢk
     + Wᵃᵢk · Appraisalᵢ
     + Wᵈᵢk · DesireActivationᵢ
     + Wᵐᵢk · MoodAndMemoryᵢ
     + Wʳᵢk · RelationshipMeaningᵢ
     + Wᵇᵢk · BodyStateᵢ

Emotionᵢk = sigmoid(zᵢk)
```

第一版采用可并存的基础通道，而非 softmax 独占分类：

```text
surprise / curiosity / anticipation / excitement / joy
pride / affection / wariness / fear / irritation / anger
shame / guilt / disappointment / sadness / aversion
```

VAD 只作为混合情绪的摘要，不再反过来决定人物属于 `assert` 还是 `avoid`。允许“兴奋 + 戒备”“好奇 + 自尊受威胁”“生气 + 舍不得伤害对方”同时成立。

### 6.4 关系不是简单缓冲器

亲密关系既可能降低威胁，也可能提高暴露和伤害：

```text
RelationshipMeaning
= safetyBuffer
 + expectedCare
 + fearOfLoss
 + opinionImportance
 + entitlementExpectation
 + accumulatedResentment
```

所以，一个冲动者被创伤触发但面对亲近目标时，可能更能压住攻击，也可能因为“你最不该这样对我”而更愤怒。公式提供各方向压力，Agent 决定如何理解和行动。

---

## 7. 情绪调节与真实泄露

### 7.1 调节容量

```text
ControlCapacityᵢ(t) = clamp(
    traitSelfControl
  + practicedSkill
  + roleDiscipline
  + feltSafety
  + preparation
  - arousalLoad
  - fatigue
  - pain
  - cognitiveLoad
  - traumaActivation,
  0, 1)
```

工具为多种调节方式给出“可能效果与代价”，但不选：

```text
suppress / reappraise / delay / redirect / conceal
express / seek_support / disengage / tolerate
```

### 7.2 Agent 选择调节，工具计算实际残余

Character Agent 提交：

```js
RegulationChoice {
  strategies: [{ strategy, targetEmotionIds, effort }],
  intendedPublicEffect,
  acceptedCosts
}
```

工具计算：

```text
EffectiveRegulationᵢ(s,k)
= sigmoid(ControlCapacityᵢ + skillᵢs + contextFit
          - Emotionᵢk - effortOverload)

ResidualEmotionᵢk
= Emotionᵢk · (1 - Σs effortₛ · EffectiveRegulationᵢ(s,k))
 + reboundᵢk

RegulationCost
= effort · EmotionLoad · (1 + failureRate + suppressionCost)
```

人物可以成功保持冷静，也可以表面压住大部分兴奋但仍被对方看出一瞬。选择长期强压会影响疲劳、反弹和后续状态。

### 7.3 泄露只给通道压力，不给动作答案

```text
Leakᵢc = sigmoid(
    Σk Wˡᵉᵃᵏᵢkc · ResidualEmotionᵢk
  + arousal
  + bodyInstability
  - maskingSkillᵢc
  - remainingControl)
```

第一版通道：

```text
gaze / attentionLock / responseLatency / breath
voiceOnset / pace / pitch / volume / lexicalSharpness
movementInterruption / posture / handTension / objectHandling
orientation / proximity
```

`attentionLock=0.78` 不等于系统替洛照写“目光一亮”。她可以盯住剑、短暂停顿、把注意力从茶移开，也可能再次动用控制压下去；具体表现仍由她本人生成。

### 7.4 克制不等于没有情绪

Agent 最终提交前必须在私有层说明每个高残余通道如何处理：

```text
expressed      由本人具体动作或声线承载
displaced      转移到另一个动作或物件
masked         再次消耗控制力压制
unavailable    因感官／身体通道客观不可用
```

这是同一个 Agent 的提交前自我核对，不是外部 validator 修改其作品。若选择 `masked`，必须实际扣除控制成本；不能免费宣布“完全没表现”。

---

## 8. 候选行动：由人物生成，数学只估值

### 8.1 世界可供性不是封闭菜单

世界可以告诉人物：门可通向何处、茶需要怎样制作、桌椅能否使用、何处公开或僻静、某物看上去能否拿取。这些是行动材料，不是世界替人物写好的选项。

Character Agent 可以：

- 组合多个可供性，形成自己的短计划；
- 尝试一个基于错误信念的动作，并让世界返回失败；
- 保持沉默、继续手头动作、观察、等待、转移话题或离开；
- 生成场景注册表没有预写语义、但可由通用动作原语表达的尝试。

### 8.2 Agent 候选合同

```js
AgentCandidate {
  candidateId,
  intention,                 // 本人想推进什么，不是预写台词
  attemptPrimitive,
  targetHandle,
  perceivedPrerequisites,
  expectedEffects: [{ sourceId, direction, magnitude, confidence }],
  socialMeaning,
  timingIntent,
  disclosureNeed,
  uncertainty
}
```

每轮建议生成 3–7 个真正有差异的候选；紧急反射可少于 3 个，复杂计划不得无限展开。至少允许一个“不公开行动／继续观察”的候选，但不强迫人物选择它。

### 8.3 候选估值

工具只根据人物自己的信念估计：

```text
Uᵢ(a,t) =
    Σg Dᵢg · Eᵢ[GoalProgress(g,a)]
  + EmotionCompatibilityᵢ(a)
  + ValueAndSelfImageᵢ(a)
  + RelationshipMeaningᵢ(a)
  + InformationGainᵢ(a)
  + HabitAndIntentionContinuityᵢ(a)
  - PerceivedBodyCostᵢ(a)
  - PerceivedThreatAndNormCostᵢ(a)
  - ExposureAndRelationshipRiskᵢ(a)
  - OpportunityAndSwitchingCostᵢ(a)
  - UncertaintyCostᵢ(a)
```

输出为：

```js
CandidateEvaluation {
  candidateId,
  utilityRange: { low, expected, high },
  factorVector,
  uncertainty,
  predictedTendencyProbability,
  conflicts,
  unmodeledFactorRisk
}
```

不做词典序义务强制，不自动选择最高分，也不因客观上不可行就删除人物基于错误认知产生的尝试。世界隐藏事实只在结算时生效。

### 8.4 选择偏离不是错误

Agent 可以因为一时冲动、坚持原则、想证明自由、刻意冒险或无法清楚解释的直觉，选择非最高分候选。系统只记录：

```text
predictionSurprise
selectedVsExpectedGap
possibleMissingPersonalFactor
futureCalibrationEvidence
```

不得要求 Agent 用一段解释性台词向角色对手或用户证明选择合理。

---

## 9. 说话方式如何从欲望和情绪长出来

### 9.1 三层形成

```text
稳定的“嗓子”
  人物看重什么、对谁怎样说、解释成本、礼貌习惯、节奏与泄露通道

× 本轮交际意图
  想得到回答、试探、安抚、隐藏、挑衅、结束、拖延或只是占住话轮

× 当前心理与身体
  混合情绪、残余泄露、疲劳、疼痛、关系距离、公开压力

= 本轮实际语气、节奏、措辞、停顿、动作与话语
```

“直接”只是斜率和倾向，不是短句模板；“清冷”不等于每句话都像公文；“熟悉”可以通过省略共享背景表现，而不是重复说明两人关系。

### 9.2 最小公开信息与情绪质感必须正交

现有最小充分信息工具保留，但拆成两条独立轴：

1. `propositionalPayload`：若不公开就无法完成已选行动的最少命题；
2. `affectiveTexture`：停顿、起声、目光、呼吸、节奏、动作中断和省略所携带的情绪与关系质感。

删除多余解释时只能压缩第一轴，不能顺手把第二轴删除。

例如，人物可以只说一个足以让对方回应的问题；但“只说一句”仍可以有发现目标后的短暂停顿、对剑的注意力偏移、压住兴奋后的声线变化。系统不得把“少解释”误实现为“无情绪的硬句子”。

### 9.3 先做事、边做边说、做完再说

世界为服务和物理行动提供真实阶段与时长；Character Agent 决定言语落在哪个时点：

```text
before_action / during_action / after_action
delayed / interrupted / silence
```

客人要茶以后，取壶、添水、候水、投茶、浸泡、端上都需要世界时间。人物可先应一声再去做，可边取壶边问，也可等茶落桌后继续；不能由 Narrator 把“要茶”与“茶已端上”压成无耗时的同一事实。

---

## 10. 状态、记忆、关系与自我认识怎样更新

### 10.1 世界结果不直接等于心理结果

```text
WorldOutcome
→ recipient-specific percept
→ Character Agent outcome appraisal
→ desire satisfaction / frustration proposal
→ emotion and regulation update
→ memory encoding
→ relationship appraisal
```

世界可以确认剑招是否碰到目标、茶是否端上、钱是否移动；不能自动判断人物“满意了”“被冒犯了”或“更信任对方”。

### 10.2 短、中、长期速度分开

| 时间尺度 | 变量 | 更新方式 |
|---|---|---|
| 秒—分钟 | 注意、混合情绪、唤醒、冲动、控制余量 | 每次重要感知与调节后更新并衰减 |
| 小时—数日 | 心境、挫败、疲劳、未决意图、关系期待 | 由连续结果、休息与反刍积累 |
| 数日—长期 | 信念、习惯、关系维度、自我模型 | 由重复证据或高意义事件更新 |
| 极慢 | 核心价值、人格权重、创伤结构 | 不因单句对话自动改变；需要长期轨迹或重大选择 |

### 10.3 重大选择与自我改变

人物作出与既有自我模型高度冲突、代价高、不可轻易撤回且被本人记住的选择时，Agent 可以提出 `identityRevisionEvidence`：

```text
MajorChoiceScore
= selfModelConflict
 × consequenceMagnitude
 × irreversibility
 × voluntaryOwnership
 × memoryPersistence
```

越过阈值并不自动改人格。它只生成“我可能不是原来以为的那种人”的长期证据；之后由回忆、解释、重复选择和故事发展逐渐形成自我修订。

---

## 11. 两个人面对同一事件，公式怎样产生不同人物

以下只展示心理推导，不预写最后动作或台词。

### 11.1 洛照：眼前陌生人可能就是传闻目标

可能的主观评价：

```text
goalCongruence      高：可能接近验证谢真石剑术的目标
novelty             中高：目标可能突然就在眼前
certaintyDelta      高但未完成：线索显著，身份仍未确认
opportunityValue    高：可以第一手验证
publicExposure      中高：贸然显露目的会增加麻烦
selfImageThreat     中：误判或示弱不可接受
```

结合她的参数，心理工具可能得到：

```text
anticipation 高 + excitement 中高 + curiosity 高 + wariness 中
接近与验证倾向高
控制容量高
公开披露倾向低
注意锁定或短暂停顿的残余泄露高于长篇解释
```

这不等于系统命令她盯住、问话或约战。她仍可继续喝茶、观察、直接试探、暂时离开，或选择其他由她生成的行动。

### 11.2 谢真石：陌生剑客专程打听自己的剑

可能的主观评价：

```text
selfRelevance       高：对方谈的是自己的名声与剑
novelty             中高：来客可能为自己而来
opportunityValue    中：可能得到验证、挑战或帮助
statusMeaning       中：被慕名找到带来被看见感
threat              中：来意与实力不明
publicExposure      中：仍在自家酒馆，需要顾及招待和场面
```

结合他的参数，心理工具可能得到：

```text
curiosity 中高 + pride 中 + wariness 中 + excitement 低至中
原先手头动作可能被打断
既想确认对方来意，也不愿显得太在意
目光、反应延迟或反问节奏可能比解释原则更容易泄露情绪
```

这同样不是一句固定台词。真实差异来自评价、权重、状态与调节，不来自“谢真石必须使用某个句式”。

### 11.3 同一人物在不同状态

洛照在以下两种状态中不应复制同一行为：

```text
A：刚到、体力充足、线索少、公共场合拥挤
B：连续受挫、目标即将离开、后院安静、本人已有较强身份把握
```

B 中目标紧迫、挫败和机会价值上升，公开麻烦下降；即使人格不变，直接行动的压力也会显著提高。

---

## 12. 新运行对象

### 12.1 `CharacterPsychologySnapshotV2`

```js
{
  agentTurnId,
  sourceAppraisalId,
  desireActivations: [{ desireId, value, contributors }],
  emotionMixture: [{ emotionId, value, contributors }],
  affectSummary: { valence, arousal, dominance },
  actionTendencies: {
    orient, approach, withdraw, confront, conceal, affiliate, persist
  },
  controlCapacity,
  cognitiveLoad,
  regulationOptions: [{ strategy, estimatedEffectRange, costRange }],
  uncertainty,
  privateFactorLedger
}
```

`actionTendencies` 只是身体与心理方向，不是动作候选，也没有 `dominant` 强制字段。

### 12.2 `CharacterCandidateEvaluationV2`

```js
{
  agentTurnId,
  authority: "character-private-psychology-tool",
  evaluations: [CandidateEvaluation],
  selection: null,
  factorLedger
}
```

### 12.3 `CharacterRegulationOutcomeV2`

```js
{
  agentTurnId,
  sourceRegulationChoiceId,
  effectiveRegulation,
  residualEmotion,
  channelLeakagePressures,
  regulationCost,
  reboundRisk,
  selection: null,
  realization: null
}
```

### 12.4 `CharacterDecisionV3`

由 Agent 独占：

```js
{
  agentTurnId,
  generatedCandidates,
  selectedCandidateId,
  regulationChoice,
  emotionHandling,
  communicationPlan,
  speechRealizationPlan,
  embodiedIntent,
  utterance,
  actionAttempt,
  privateDecisionBasis
}
```

Observer 可以看到受控心理浮层；其他人物只能收到真实传播到他们的言语、动作表面和世界结果。

---

## 13. 从当前实现迁移

### D0：权力合同先行

- 为所有心理工具增加禁止字段测试；
- 测试候选来源必须为 `character-agent`；
- 测试 `selectedCandidateId` 只能出现在 Agent 最终决定；
- 测试 Validator 不得改选、改台词或补情绪；
- 测试世界只结算尝试。

### D1：拆开同轮认知与决定

- 将当前一次性 `tavernCausalAgentDecisionSchema` 拆为 appraisal、candidate proposal、final decision 三个阶段；
- 建立 `agentTurnId` 与同一人物上下文连续性；
- `cognitiveAppraisal` 必须先于本轮心理快照，不能再与台词同时首次出现。

### D2：收回服务端的主观解释权

- `tavernEventAppraisal.mjs` 保留时间衰减和客观输入整理；
- 正负性、目标意义、机会、威胁、自我相关和关系意义改由 Agent appraisal 提交；
- 工具基于这些主观输入计算混合情绪，不再以 VAD 直接生成最高 coping 标签。

### D3：退役预制表达策略

- 删除 `expressionStrategyFor` 对候选和 voice 的运行权威；
- coping 改为并存的方向压力或调节选项，不再返回 `dominant` 作为表达命令；
- voice 工具读取心理快照与调节残余，只给参数压力，不给 `firm / cool / minimal` 模式。

### D4：候选生成权归还 Character Agent

- Smart Affordance 与 Social Practice 只提供世界材料、规则和可能动作原语；
- 现有生态与 epistemic candidate generator 降级为开发期影子建议或彻底退役，不进入正式 Agent 的封闭候选列表；
- Agent 先生成候选，候选估值工具再计算；工具输出不含选择。

### D5：调节、泄露与具身表达

- 新增调节选择和泄露工具；
- 扩展 `embodiedIntent`，区分自动反应、本人调节和最终可见表达；
- 最小信息工具只压缩命题解释，不压缩情绪质感；
- 语音和动作均支持 before / during / after / delayed / interrupted。

### D6：行动后反馈

- 世界结果先投影为感知；
- 欲望满足、挫败、关系变化、记忆和自我模型均由接收者下一步评价；
- 调节成本、控制消耗与反弹进入连续状态。

### D7：酒馆验收后再泛化

- 先跑望梯酒馆连续微时钟；
- 再用一个非酒馆、非洛照、非谢真石场景验证同一内核；
- 真实模型测试保持本地输入审计、远程运行与作者质量判断分离，并逐次获得授权。

### 13.1 兼容策略

新增运行开关：

```text
characterCognitionProtocolVersion = 2
```

旧协议只用于旧存档读取和对照，不可与 v2 同时对同一个人物作决定。迁移期 Observer 可并排展示旧分数与新心理工具输出，但旧分数不得回流 v2 Agent。

---

## 14. 验收矩阵

### 14.1 结构合同

- 心理工具输出不含选中候选、表达策略、动作或台词；
- Agent appraisal 在心理计算之前真实存在；
- 所有候选均有 Agent 来源，世界可供性只作为依据；
- 最终选择、调节、披露、动作和台词均由同一 Agent 提交；
- Validator 只能拒绝 schema 或权威越界，不能做质量重写；
- 世界失败不会换成另一个成功动作。

### 14.2 因果反事实

1. **同事件、不同人物**：洛照与谢真石得到不同评价、混合情绪、泄露通道和候选集。
2. **同人物、不同状态**：疲劳、疼痛、挫败、公开性或目标确定性变化时，候选估值与表达质感随之变化。
3. **同人物、不同关系**：亲密既可缓冲威胁，也可提高羞耻、期待或受伤权重，不做单向加减。
4. **高情绪、高控制**：可保持克制，但有调节成本和合理残余，不自动变成无情绪硬句。
5. **高情绪、低控制**：泄露增强，但 Agent 仍决定具体表现，不套统一爆发模板。
6. **低命题负载、高情绪质感**：一句短话仍能明显属于这个人物和此刻关系。
7. **服务动作时序**：点茶、沏茶、端茶与对话占用真实时间，可交错但不瞬间完成。
8. **错误认知行动**：人物可基于误判尝试，世界只返回客观失败，不在选择前删掉人格错误。

### 14.3 人物质量验收

确定性测试只能证明权力边界和因果顺序。以下判断仍由作者完成：

- 是否能感到人物先产生了情绪，再选择怎样控制；
- 动作、停顿和说话节奏是否来自当下欲望与关系；
- 遮名后是否仍能分辨洛照与谢真石；
- 人物是否拥有矛盾、犹豫、冲动、克制和状态变化，而不是参数模板；
- 连续多轮是否自然承接前一秒，而非每轮重新汇报任务。

---

## 15. 性能与简化边界

第一版接受比当前更多的模型往返，以换取正确的因果顺序。优化顺序应为：

1. 先证明同一 Agent 工具循环的质量；
2. 再缓存未变化的人格、记忆和世界投影；
3. 简单身体维护可使用轻量回合，复杂社会事件使用完整回合；
4. 最后才考虑合并调用，但不得让 appraisal 再次晚于心理计算。

必要简化：

- 情绪采用约 16 个可并存通道，不模拟完整神经系统；
- 每轮候选通常 3–7 个；
- 调节最多允许一次主动修订，避免无限自省；
- 数值保留给本人和 Observer，不要求人物在台词中解释；
- 稳定人格权重不因单轮自动训练；参数校准与人物创作仍由作者决定。

---

## 16. 本阶段完成标准

本设计只有满足以下条件才可进入实现：

- 作者确认数学工具“构成心理，但不拥有决定权”的表述准确；
- 作者确认同一 Character Agent 的多阶段工具循环可以接受；
- 作者确认候选必须由人物生成，世界可供性不是封闭菜单；
- 作者确认“最小命题负载”与“情绪质感”完全分离；
- 作者确认高残余情绪需要由人物自行处理，并产生真实调节成本，而非外部补写；
- 旧文档中被本文取代的行动选择与单调用简化不再作为运行权威。

确认后才进入 D0 合同测试；在此之前不修改当前正式运行链。
