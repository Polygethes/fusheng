# Phase 74：人物相对感知与认知行动升级方案

> **2026-07-22 权威更新：** 本文的感官接收、注意、职业解码、匿名假设和信息代价设计继续有效；认知行动候选必须改由 Character Agent 在主观评价与心理计算后生成，数学只估值、不预制或选择，详见 [Character Agent 内部心理工具与自主表达架构](./24_character_agent_internal_psychology_tools.md)。

## 1. 目标

本阶段解决的不是某一句问话，而是一个通用底层问题：

> 世界只产生客观信号；每个 Character Agent 依据自己的感官、注意力、欲望、性格、职业、身体状态与既有认识，形成不同的主观证据，再决定要不要观察、询问、试探、等待、离开或采取其他行动。

需要让酒馆先跑通以下能力，并保持可迁移到新人物、新场景和多场景：

1. 同一客观场面，不同人物实际注意到不同内容；
2. 感官障碍改变信号来源，而不是简单减少一份统一视觉描述；
3. 职业能力改变特征解码深度，不直接给出正确结论；
4. 性格与欲望改变注意力分配，也允许视野狭窄、过载和误判；
5. 询问只是认知行动之一，而且会暴露提问者的信息；
6. 人物先判断一个地点或信息源是否值得接近，再决定问什么；
7. 第一印象、身份假设、关系与世界真实身份保持分层；
8. 数学工具为人物形成主观证据和候选比较，不替 Character Agent 作最终行为选择。

本阶段不把某句“自然台词”写成固定规则，也不把洛照的选择编译成所有人物的行为模板。

---

## 2. 权威边界

```text
World Signal Field
  客观位置、光线、声响、气味、动作、物件表面和传播路径
        ↓
Character Sensory Transform
  本人的视觉、听觉、触觉等能力与当前身体状态
        ↓
Private Attention Tool
  本人的欲望、性格、职业、威胁敏感、当前目标与有限注意力
        ↓
Competence Decoder
  本人凭经验能从所注意特征中推断什么
        ↓
Private Entity / Location / Claim Hypotheses
  带来源、置信度和矛盾的主观模型
        ↓
Epistemic Action Candidates
  观察、倾听、移位、询问、试探、跟随、等待、离开等
        ↓
Character Agent
  选择行为、表达策略和实际话语
        ↓
World Resolution
  只结算动作是否发生、信号传播与客观后果
```

硬边界：

- 世界不知道“人物注意到了什么”，只知道哪些信号客观上能够抵达；
- 私人感知工具不能确认世界身份、隐藏意图或职业结论；
- 数学排名不等于人物的最终选择；
- 人物可以忽略高分线索、误解证据、问低效问题、撒谎或故意暴露自己；
- 结构验证只保护来源、空间、句柄和状态权威，不审查人物想法是否正确；
- Narrator、UI 与观察者心理继续是单向输出，不回流到人物或世界。

---

## 3. 当前实现的根因

### 3.1 传播与感知混在一起

当前 `spatialPerception.mjs` 主要判断人物是否在固定视觉距离内，或近期是否产生了能沿声学路径抵达的声音。这能够阻止隔墙视觉和无来源声音，却没有人物专属感官能力、光照、噪声遮蔽、朝向和特征级接收。

### 3.2 同一语义描述先于人物注意力

当前 impact 投影通常先生成一条通用的 `description` 或 `literalSpeech`，再附上 fidelity 与 ambiguity。不同人物虽然收到不同强度，但仍容易先得到同一份已经解释过的语义。

### 3.3 调度相关性被误当成意识内容

当前 `personalRelevance` 与 `impactScore` 可用于决定谁值得获得回合，但不能证明某个细节已经进入人物意识。调度压力、感官接收和主动注意需要三个不同对象。

### 3.4 职业能力已经有数据，却没有进入特征解码

洛照 foundation 已有公共空间阅读、佩剑管理和第一手证据偏好，但运行时没有足够细的原始信号让这些能力工作。结果仍接近“所有人物共用一双眼睛”。

### 3.5 认知行动缺少地点信念和反向泄露

现有候选已经允许 observe、ask、wait 和 leave，却没有明确计算：

- 为什么认为目标或线索可能在这个地点；
- 为什么认为眼前的人知道答案；
- 这个问题能排除多少可能性；
- 提问会向对方暴露什么；
- 继续观察是否比开口更符合此人的性格和当前压力。

因此容易生成“近来可有使剑的人在这里落脚”这类高基数、低诊断力的问题。

---

## 4. 新增运行对象

### 4.1 `WorldSignalFeature`

世界只记录可以被感官接收的表面，不直接写人物结论：

```js
{
  signalId,
  sourceEntityId,          // 仅世界结算层保留
  sourceZoneId,
  modality,                // visual / sound / smell / touch / vibration
  domainTags,              // weapon, gait, voice, clothing, commerce...
  physicalFeature,         // 剑鞘某处有重复磨痕，而不是“惯用快剑”
  intensity,
  durationSeconds,
  visibilitySurface,
  transmissionRequirements,
  occurredAtSeconds,
}
```

人物外观不写成一段完整简介，而由结构化、可传播的表面特征组成，例如：

- 衣料、颜色、磨损、洁净程度；
- 身高范围、姿态、步幅、左右负重差；
- 呼吸节奏、嗓音、口音、衣料和金属摩擦声；
- 佩带位置、握持状态、剑鞘磨痕；
- 疲惫、疼痛或紧张形成的可见/可听表征。

隐藏属性、真实能力、姓名和内心目的不能直接成为 signal。

### 4.2 `CharacterPerceptionProfile`

作为 Character Agent foundation 的可编译私有模块：

```js
{
  sensoryChannels: {
    visual: { availability, acuity, motionSensitivity, lowLightTolerance },
    sound: { availability, acuity, rhythmResolution, sourceLocalization },
    smell: { availability, acuity },
    touch: { availability, acuity },
    vibration: { availability, acuity }
  },
  attention: {
    baselineBudget,
    sensitivityThreshold,
    distractibility,
    overloadSensitivity,
    orientingBiases
  },
  domainDecoders: [{ domain, competenceRange, supportedInferences }],
  informationStyle: {
    directInquiry,
    concealmentNeed,
    patience,
    verificationThreshold,
    socialRiskSensitivity,
    reactionReadingConfidence
  }
}
```

边界：

- 缺失参数使用明确的中性兼容值，不根据职业名称偷偷补人格；
- 盲人只是 `visual.availability=0`，不自动获得超常听觉；增强听觉必须由独立证据或训练支持；
- 敏感者可以降低接收阈值，但噪声、过载和误报风险也随之上升；
- 剑狂通过注意力权重和有限预算表现狭窄视野，不是世界删除了非剑类信号；
- 职业提高解码能力，不保证判断正确，也不创造欲望。

### 4.3 `ReceivedSignalCandidate` 与 `NoticedEvidence`

服务端保留两层：

```js
// 世界审计层，不直接进入 Agent prompt
ReceivedSignalCandidate {
  signalId,
  anonymousSourceHandle,
  modality,
  receivedStrength,
  noise,
  route,
  rawFeature,
}

// 人物私有意识输入
NoticedEvidence {
  evidenceId,
  anonymousSourceHandle,
  modality,
  noticedFeature,
  fidelity,
  ambiguity,
  attentionReasonTags,
  sourceSignalIds,
}
```

未被注意的 raw signal 不进入人物可回忆的 experience trace。服务端可以保留它作调试审计，但 UI、模型输入和人物记忆均不得读取。

### 4.4 `PrivateEntityModel`

初见一个人时建立私人匿名模型，不立即建立关系：

```js
{
  perceivedEntityHandle,
  noticedEvidenceIds,
  hypotheses: [{ proposition, confidence, basisEvidenceIds }],
  identityCandidates: [{ knownEntityHandle, confidence, basisEvidenceIds }],
  affectiveResponse,
  attentionPriority,
  contradictions,
  lastUpdatedAtSeconds,
}
```

人物可以把眼前人错误地当成某个 `known_entity`。这是人物信念，不改变世界 canonical identity。之后获得矛盾证据时可以修正；旧判断保留来源，不被无痕覆盖。

### 4.5 `LocationBeliefState`

```js
{
  subjectHandle,             // known_entity、物件或信息主题
  locations: [{
    locationHandle,
    likelihoodBand,
    basisEvidenceIds,
    lastUpdatedAtSeconds,
  }],
  unknownMass,
}
```

它表达人物认为目标或线索可能在哪里，不泄露世界真实位置。酒馆是否值得进入、停留或询问，必须基于人物自己的证据和先验。

### 4.6 `EpistemicActionCandidate`

```js
{
  candidateId,
  primitive,                 // observe / listen / reposition / ask_direct...
  targetHandle,
  informationGoal,
  expectedEvidenceKinds,
  presuppositions,
  answerabilityEstimate,
  expectedInformationGain,
  reactionDiagnosticity,
  disclosurePayload,
  exposureCost,
  socialCost,
  timeCost,
  uncertaintyRisk,
  feasibleAffordanceIds,
}
```

候选族至少包括：

- 保持当前活动并顺带监听；
- 将注意力转向某类信号；
- 移到更容易听见/看见的位置；
- 直接询问；
- 间接询问或只问信息源是否认识某人；
- 给出部分信息，观察反应；
- 制造非破坏性刺激，观察谁响应；
- 跟随、等待、另找信息源或离开。

“沉默”不是候选缺失。人物可以不公开行动，但仍更新私人注意力和假设。

---

## 5. 数学工具

### 5.1 感官接收

对人物 `i`、特征 `f`、模态 `m`：

```text
Reception(i,f,m)
= SignalStrength(f,m)
× Transmission(m, distance, barriers, light, ambientNoise)
× SensoryCapacity(i,m)
× BodyModifier(i,m,t)
```

这是“有机会接收到”，不是“已经注意到”。

### 5.2 前意识显著性与有限注意力

```text
Salience(i,f)
= Reception(i,f)
× [
    wg GoalMatch(i,f)
  + wd DesireMatch(i,f)
  + wt TraitBias(i,f)
  + wp ProfessionBias(i,f)
  + wh ThreatOrTraumaBias(i,f)
  + wn Novelty(i,f)
  + wr RelationshipRelevance(i,f)
  ]
- NoiseCompetition(i,f)
```

当前疲劳、疼痛、情绪激活和认知负荷共同决定注意力预算：

```text
Budget(i,t) = baselineCapacity × bodyState × cognitiveLoadModifier
```

在预算内使用可复现的带噪阈值或 seeded softmax 选择 `NoticedEvidence`。噪声种子只用于审计与回归，不进入人物叙述。

这一步模拟自动注意，不决定公开行为。人物之后仍可主动转头、靠近、细听或检查，以改变下一轮可获得的信号。

### 5.3 职业解码与假设

```text
DecodeStrength(i,f,h)
= Attention(i,f)
× Expertise(i,domain(f))
× Fidelity(f)
× Diagnosticity_i(f,h)
```

```text
BeliefOdds_next(h)
= BeliefOdds_now(h)
+ Σ EvidenceReliability_i(e) × DecodeStrength(i,e,h)
- ContradictionStrength_i(e,h)
```

实现阶段保留 0..1 范围与置信区间，不伪装成精确脑科学概率。`Diagnosticity_i` 使用人物掌握的先验和经验，而不是世界的全知统计。

### 5.4 地点选择

```text
LocationValue_i(L)
= P_i(target-or-source-at-L | owned evidence) × informationValue
+ otherNeedFit
- travelCost
- timeCost
- exposureCost
- expectedSocialCost
```

人物如果没有任何酒馆相关线索，可以因吃饭、休息或酒馆作为一般信息节点而进入，但不能被系统悄悄告知谢真石就在这里。

### 5.5 认知行动与提问

```text
EpistemicUtility_i(a)
= wi ExpectedInformationGain_i(a)
+ wr ReactionDiagnosticity_i(a)
+ wg GoalProgress_i(a)
+ wc ControlValue_i(a)
- we DisclosureCost_i(a)
- ws SocialCost_i(a)
- wt TimeCost_i(a)
- wu UncertaintyRisk_i(a)
- wp PresuppositionMismatch_i(a)
```

提问的信息增益可用人物自己的信念分布估计：

```text
EIG_i(q) = H(B_i) - Σ_response P_i(response|q) × H(B_i|response)
```

“使剑者”若在人物认知里非常常见，回答“有”几乎不能缩小范围，因此 EIG 很低。它仍可以因隐藏姓名、制造反应或故意绕弯而被选择；低信息量只形成代价和诊断，不成为禁言门控。

### 5.6 何时停止收集信息

```text
act when:
confidence >= personalVerificationThreshold
or urgencyLoss > expectedValueOfMoreEvidence
or remainingSearchCost > expectedInformationValue
```

阈值受谨慎、冲动、时间压力、自信、失败代价和对第一手证据的偏好共同影响。同一个人物在不同状态下也会改变阈值。

---

## 6. 说话前提不再由模板决定

每个问题都生成私有的 presupposition annotation：

```text
“谢真石还在不在？”
  隐含：本人认为他先前在这里，并认为听者知道其去留

“谢真石在不在？”
  隐含：本人认为这里是其当前可能位置

“掌柜可认得谢真石？”
  隐含：本人认为掌柜可能拥有本地社会知识

“近来可有使剑的人落脚？”
  隐含：使剑可有效区分目标，且掌柜会记住这一类别
```

annotation 只供 Character Agent 比较，不审查台词。人物可能因为撒谎、记错、试探、调戏、掩饰或判断失误，说出与自己信念不完全相符的话。

自然语言生成顺序应为：

```text
认知目标
→ 选择信息行动
→ 选择披露策略
→ 选择问题前提和信息颗粒度
→ 按人物声纹说出来
```

禁止重新建立“必须承接上一句”“必须符合事实”或“必须高信息量”的台词审查器。

---

## 7. 运行时接入方式

为避免每个回合增加一次额外远程模型调用，第一版采用一段自动心理变换加一次 Character Agent 决策：

1. 世界提交动作后生成结构化 raw signals；
2. 空间传播只生成 `ReceivedSignalCandidate`；
3. Character Agent 私有数学工具按当前 profile/state 生成有限 `NoticedEvidence`；
4. 只有 noticed evidence 进入记忆编码、私人实体模型和正式 Agent 输入；
5. 场景适配器提供中性的物理/社会 affordance；
6. 私有认知工具生成多种 epistemic action candidates 及因子账本；
7. Character Agent 自己选择候选，也可以选择较低分候选；
8. Agent 返回假设更新、交流计划、话语和动作尝试；
9. 世界只结算公开动作及新的信号；
10. 其他人物重复自己的独立感知过程。

主动观察必须跨轮取得新证据：选择“细看剑鞘”不能在同一输出里自动获得隐藏结果；世界在动作成功后，才于下一轮提供更高 fidelity 的相应 signal。

预计实现面：

- `src/server/simulation/spatialPerception.mjs`：保留通路传播，升级为模态和特征级 reception；
- 新建通用 `characterPerception.mjs`：负责感官变换、显著性、注意力预算与 noticed evidence；
- 新建通用 `epistemicActionUtility.mjs`：负责地点价值、信息增益、披露和前提错配账本；
- `src/server/ecology/validatedCharacterAnchorRuntime.mjs`：编译和验证人物感知/信息风格；
- `src/engine/characterAgentMemory.js`：保存私人匿名人物模型、地点信念和有来源的假设；
- `src/server/pipeline/tavernCausalScene.mjs`：只作为酒馆 signal/affordance 适配器并接入正式回合；
- `src/server/ecology/codexTrustedTavernAgentChannel.mjs`：阻止 raw unseen signal、canonical identity 和世界位置泄漏；
- `src/server/pipeline/tavernEcologyAppraisal.mjs`：消费认知候选因子，但继续保留 Character-Agent 选择权。

观察者 UI 可以展示本人已经注意到的证据、当前假设、置信带和选择该认知行动的私有因子；默认不展示人物没有注意到的 raw signals。调试模式可另看 server audit，但该视图仍不得回流模拟。

---

## 8. 数据迁移

### 8.1 旧人物

- 保留现有 foundation v1；
- 未配置感官档案时使用中性 profile；
- 不从“剑客”“掌柜”“敏感”等自然语言标签自动猜精确数值；
- 只把已有作者证据编译为领域偏置和能力范围；
- 后续重新锚定人物时，感知与信息风格成为固定问答流程的一部分。

### 8.2 洛照

只迁移已经确认的内容：

- 第一手证据偏好高；
- 身份未确认时会观察；
- 受过剑修空间与佩剑管理训练；
- 高价值剑术线索会提高注意力；
- 不因传闻直接确认身份和实力；
- 不喜欢与目标无关的公共麻烦。

不写入：

- 固定选择某个座位；
- 固定点茶；
- 固定保持沉默；
- 固定先询问或永不询问；
- 固定说出某一句话。

### 8.3 新人物锚定流程新增问题

1. 哪些感官存在障碍、训练或异常敏感？
2. 在陌生环境中首先会注意什么，常忽略什么？
3. 哪些职业细节是他能解读而普通人不能的？
4. 信息不够时，他更倾向问、看、试、等还是离开？
5. 他多害怕暴露自己的目标和兴趣？
6. 需要多高把握才会接近或采取行动？
7. 疲惫、恐惧、兴奋和时间压力怎样改变以上选择？

这些回答形成范围和开放选择轴，不形成固定动作规则。

---

## 9. 实施阶段

### P0：冻结边界并建立 RED 合同

- 固定世界信号、人物接收、注意、解码、信念和行动的权威表；
- 为当前通用描述直灌、未知身份合并和未根据地询问建立失败样例；
- 保留人物说错、撒谎和故意低效提问的合法性反例。

验收：新测试在旧实现上能精确暴露感知同质化，但不因人物内容错误而失败。

### P1：foundation 与场景信号 schema

- 增加通用 `CharacterPerceptionProfile` 编译与验证；
- 增加 `WorldSignalFeature`、人物动态表征和环境 light/noise/facing/occlusion；
- 将物件 public appearance 拆成特征，不暴露 canonical label。

验收：盲人测试人物不会收到颜色与视觉动作；世界也不会自动赠送增强听觉。

### P2：人物私有感知数学工具

- 新建通用 reception、salience、budget 与 feature selection 模块；
- 将 scheduler relevance 与 conscious evidence 分开；
- raw received signal 只留 server audit，noticed evidence 才能进入 Agent 和记忆。

验收：同一场面下，不同感官/欲望/职业/状态得到不同 evidence 集；同一人物疲惫前后也会变化。

### P3：职业解码、匿名人物模型与错误身份

- 按领域能力从物理特征生成有来源的推断候选；
- 建立 `PrivateEntityModel`；
- 支持错误身份链接、怀疑、修正和来源保留；
- 第一印象不自动写正式关系。

验收：剑客可从剑鞘磨损形成推断，掌柜不会自动获得该推断；二者都不能得到世界保证的“高手”。

### P4：地点信念与认知行动规划

- 建立 `LocationBeliefState` 与人物自己的类别先验；
- 生成观察、倾听、移位、直接/间接询问、试探、跟随、等待和离开候选；
- 增加信息增益、反应诊断、披露、前提错配、时间和社交成本；
- 候选只排名，不预选最终行为。

验收：没有地点证据时，“还在不在”显示高前提错配；高可靠线索出现后同一问法的成本下降。两种情况都不被内容审查器封禁。

### P5：正式酒馆运行纵切

- 在 `tavernCausalScene` 接入 raw signal → noticed evidence → Agent decision；
- 更新 Agent schema、受信任通道输入审计、记忆写入和观察者心理；
- 将主动细看/细听作为需要时间和世界反馈的动作；
- 保持微时钟、匿名句柄、物件状态和 participant-owned thread 不回退。

验收：人物可以不说话地持续取证；询问后对方只接收到实际话语和可见动作，不接收到提问者的私有信息目标。

### P6：通用差异矩阵

使用非正史测试人物证明可迁移性：

1. 视力正常者与盲人；
2. 剑术专家与无相关经验者；
3. 剑类注意极窄者与经营者；
4. 高敏感低负荷与高敏感过载；
5. 谨慎保密者与急迫直接者；
6. 同一人物精力充足与疲惫状态。

验收重点是输入、证据、候选和权威差异，不规定唯一台词。

### P7：洛照 Gate 8 替代验收

- 先完成全部本地结构与因果回归；
- 审计洛照只收到本人真正注意到的证据；
- 确认地点信念、问题前提和披露成本没有作者答案泄漏；
- 取得新的单次知情授权后才调用真实模型；
- 由作者判断人物是否像洛照，确定性测试不能替代真实感验收；
- 接受的具体台词和行动仍只作为证据，不写回固定运行政策。

---

## 10. 验收矩阵

| 类别 | 必须通过 | 不允许冒充通过 |
|---|---|---|
| 感官 | 盲人无视觉证据；声音受距离和噪声影响 | 用一段“盲人感知描写”模板替代信号计算 |
| 注意 | 欲望、职业、性格、状态改变 noticed evidence | 世界按角色名预选正确线索 |
| 专业 | 专家得到更深但带不确定性的推断 | 专业标签直接等于正确答案 |
| 信息 | 问、看、听、试、等、走同时可选 | 系统为了对白强迫询问 |
| 地点 | 行动使用人物自己的地点信念 | 世界真实位置偷渡进人物先验 |
| 提问 | 计算信息增益、披露和前提错配 | 禁止人物问低效、错误或骗人的问题 |
| 身份 | 匿名模型可误认并可修正 | canonical identity 自动确认 |
| 关系 | 第一印象独立保存，确认后才有来源地合并 | 看见一次就自动建立关系 |
| 记忆 | 只编码 noticed evidence | 把所有传播到附近的信号都写进回忆 |
| 行为 | Character Agent 拥有最终选择 | 数学最高分直接成为公开行动 |
| 质量 | 真实模型样本由作者接受 | schema PASS 或本地测试等于人物自然 |

---

## 11. 第一阶段简化边界

- 酒馆纵切先完整实现视觉与听觉；嗅觉、触觉和振动保留同一 schema 与最小传播合同，不伪造完整物理模拟；
- 使用区域、相邻路径、朝向、遮挡、光照和环境噪声，不建立连续三维光学/声学引擎；
- 原始信号必须结构化产生，不从最终小说文本反向猜世界事实；
- 使用可审计的范围、置信带和 seeded noise，不宣称模拟真实神经元；
- 地点信念先支持“当前酒馆各区域、酒馆外未知地点和已知目标地点”，接口保持可扩展到多场景图；
- 不替尚未锚定的人物发明感官缺陷、职业专长、保密程度或确认阈值；
- 不在本阶段重做 Narrator 文风，只保证观察者最终只写人物真正公开的动作和话语。

---

## 12. 本次错误的验收结论

“近来可有使剑的人在这里落脚”不能通过删除句子或建立禁用短语解决。升级后它应表现为：

- 如果人物认为使剑者常见，信息增益低；
- 如果人物没有理由认为目标与酒馆有关，地点价值低；
- 如果人物不愿暴露姓名，披露成本可能使宽泛问题重新有竞争力；
- 如果人物擅长读反应，宽泛问题可能具有较高反应诊断价值；
- 如果人物急迫、直接或已经掌握可靠地点线索，直接询问可能更有竞争力；
- 最终仍由人物Agent选择，并允许这个人物在某次具体状态下作出并不聪明的决定。

我们验收的是这条完整因果链是否属于人物，而不是某一句话是否符合系统预设答案。

---

## 13. P7 首次真实样本与作废结论

取得单次知情授权后，受信任模型通道完成了五次真实 Character Agent 调用。表面行动链为：洛照进堂观察；谢真石询问来意；洛照直接询问谢真石是否在场；谢真石确认身份；洛照提出换到不碍事的地方过一招。剑始终佩在身上，拜帖始终收好，身份也没有在确认前自动写入关系。

这个样本不得进入作者真实感验收，原因不是台词好坏，而是发现了两项底层越权：

1. 洛照在地点信念和消息来源都为空时，绕过了同一数学工具已经算出的提问前提错配，借通用 `respond` 候选说出了“谢真石在这里吗”；
2. 谢真石没有说出口的私有欲望语义，被旧的响应候选链传给了洛照，形成跨 Agent 内心泄漏。

本地修复后的合同为：

- 行动同时保留仅供本人连续性使用的私有语义，以及只由实际话语、可见动作和已成立公共承诺构成的公开语义；其他 Agent 只能接收后者；
- 任何新提出的信息问题，都必须引用同一批认知行动候选，并声明它是在接受前提、表达不确定、试探、欺骗、误记或虚构；系统记录认知与表达的差异，但不禁止人物说错话、说谎或故意试探；
- 受信任通道在调用前拒绝携带他人 `desire_*` 的响应候选，也拒绝缺少认知问题选项的可提问响应；
- 运行报告只有在因果链完整、动作数达标且认知诊断为零时，才可以进入作者判断；结构失败不能再伪装成“等待作者接受”。

相关本地因果、记忆、关系、线程、声音、观察者相对感知与受信任输入审计回归已经通过。洛照的 `behaviorAcceptance` 继续保持 `pending`；首次真实样本不写回人物关系、锚定政策或正式 Gate。下一次真实调用必须重新取得一次新的明确授权。

---

## 14. P7 修复后替代样本

在新的单次知情授权下，替代运行完成五次真实模型请求。第一次洛照决策只因行动后连续性引用不符合合同而进行一次修复；公开行动、台词和动机方向没有改变。最终提交四项行动：

1. 洛照扶稳仍佩在腰间的剑，越过门槛进入堂前；
2. 谢真石停下收碗，问：“吃饭，还是住店？”
3. 洛照答：“都不是。我来打听消息。”
4. 谢真石没有代替她补全来意，只抬眼示意她继续说。

该样本的系统边界成立：洛照没有收到谢真石的私有欲望，谢真石也没有收到洛照的私有欲望；没有无依据的目标地点提问；匿名眼前人与传闻中的谢真石仍是不同认识对象；佩剑保持佩戴、带鞘，拜帖保持收在行囊；没有自动确认身份、建立关系或改变锚定事实。

两句对白都触发了“人物声音偏通用”的遥测提示，而且样本在洛照说出具体所问消息之前结束。这些属于作者真实感判断材料，不是系统可以代替作者裁决的失败或通过。运行状态因此是 `author_review_required`，正式 `behaviorAcceptance` 继续为 `pending`。

---

## 15. 作者修正：来意、消费与直接试探的连续链

作者接受“我来打听消息”作为完整的来意解释，但否定谢真石随后用空手势等待洛照补全。人物说自己来打听消息，并不等于句法或社会行动尚未完成；如果没有具体问题、请求或已经建立的共同话题，对方没有必须追问或示意继续的义务。

更自然的后续具有三类彼此独立的可能性：洛照可以先点一壶茶，可以选择合适的位置坐下，也可以在时机合适时直接拿自己听过的传闻试探。三者可以按这个顺序发生，也可以被人物当下的口渴、钱财、警惕、拥挤、服务等待与信息压力重新排序；系统不得把作者举例编译成固定剧本。

为此，正式运行增加以下通用能力：

1. 酒馆公开茶饭、价格、库存、经手人、客位和占桌惯例；世界只保证这些东西存在或不存在，不决定人物是否消费。
2. Character Agent 使用身体需要、停留正当性、信息掩护、价格、等待、暴露与空间特征比较请求服务和选位候选，最终选择仍为空，等待 Agent 自己提交。
3. 点茶、上茶、饮用和付款是四个可独立结算的动作；点茶不会自动喝完、付清，也不会把“来打听消息”结案。
4. 坐下会占用客观位置，离开会释放；佩剑、行囊和其他随身物不会因选位自动离身。
5. 人物可以引用本人记忆中有来源、未验证的 claim belief，形成直接试探反应的认知候选。该候选不提供预写台词，人物仍可直问、旁敲侧击、隐瞒来源、暂不发问或离开。

“听说谢真石一年登了九层塔？”在本文中只是作者说明自然问法的例子，不是已经成立的正史。当前洛照只拥有模糊的剑术传闻，因此运行时不得自行补出九层塔。将来若确认此事，必须以有来源的世界事实或人物记忆进入认知层，之后人物才可能基于它发问、怀疑或撒谎。

本地验收已证明真实服务/座位生命周期、口渴反馈、自有传闻候选、佩剑持续附着和私人来意持续开放；Gate 的目标轮次也由四轮扩为六轮，以便观察消费、落座和发问是否由人物连续选择。确定性测试只证明这些可能性已进入正式运行链，不证明洛照一定选择其中任何一个。新的真实双 Agent 样本仍需新的单次知情授权，并继续由作者独占真实性判断权。

---

## 16. 新真实运行发现：物理可见不等于人物必然注意

在新的单次授权下，本地预检通过。首次受信任启动因沙箱无法写 Codex 状态库而在模型执行前失败；随后按同一授权进入可写的受信任环境。真实通道完成两次洛照调用，其中一次只修复同一进门选择的连续性引用。最终公开提交的唯一行动是洛照从门槛进入堂前，没有说话，也没有确认眼前人的身份。

谢真石准备取得第一轮时，调用前审计以 `VISIBLE_WORN_OBJECT_MISSING` 中止。长剑仍是世界中公开佩带的物件，但在当时的信号竞争和有限注意预算下，没有进入谢真石本轮 `perceivedObjects`。旧 Gate 却要求物理可见的佩剑必然成为意识内容，这与本方案的核心边界冲突。

同一份输入还暴露了反方向泄漏：来访事务的 `arrivalCue` 直接从客观物件账本写出“佩着一柄带鞘长剑”。也就是说，人物的感知物件表没有剑，事务摘要却替他注意到了剑。问题不是剑离身，而是两个观察者输入通道采用了不同的认识权威。

修复后的规则为：

1. 世界物件账本独占“剑是否仍由洛照持有、佩带、带鞘”的客观状态；人物注意与否不能改变它。
2. 感知工具独占“谢真石本轮是否注意到剑”。物理信号可达只产生候选，有限注意可以选择或漏掉。
3. 面向人物的来访摘要只能引用该人物已经注意到的物件，不得从客观账本越过注意层补写。
4. 受信任调用前不再要求每个人都看见剑，只检查 `perceivedObjects` 与来访摘要一致。
5. 完整场景结束时另由服务器硬验佩剑仍附着、带鞘，拜帖仍由洛照持有、收在行囊且未公开；这项客观连续性不能由人物感知代替。

本地回归同时覆盖“同一客观佩剑被注意到”和“因有限注意未被选中”两种合法结果。前者可以进入人物摘要，后者不得以任何旁路文字泄漏。此次真实运行在谢真石模型调用前结束，没有形成对话、消费、选位或传闻试探样本，因此不能交由作者判断人物真实性。授权已经产生两次真实模型请求，视为已消费；再次运行仍需新的明确授权。

---

## 17. 第二次修复后运行：真实沉默与错误静止必须区分

取得新的单次授权后，受信任通道完成四次真实调用，全部输入审计通过且没有修复请求。场景中依次发生：

1. 洛照越过门槛进入堂前，没有说话；
2. 谢真石手里仍拢着旧碗，在她的带鞘长剑上停了一眼；
3. 洛照注意到这道目光，转而观察他的手、肩与步位；
4. 谢真石微微侧身，继续观察她的手、肩与步位。

两人的私有理由并非空白：谢真石认为佩剑只能令人留意，不能证明剑术高明；洛照认为先看身体使用方式，比拿传闻直接套身份可靠。身份没有提前合并，关系没有变化，佩剑与拜帖状态也全部正确。因此，“两人选择暂时不说话”本身不是错误。

第三轮输入同时证明新服务链已经进入正式 Agent：洛照知道有一文热茶、两文热饭，自己带十文钱；她看见四个中性客位，也得到信息掩护、停留正当性和自有传闻试探候选。她没有选择它们，而选择继续观察。数学候选存在但不拥有最终决定，这正是 Character Agent 权威的预期结果。

错误发生在场景之后：运行只完成四个动作便在约 29 秒标记 `quiescent`，既没有达到六轮，也没有把洛照第三步保存为对谢真石第二步的因果承接。

连续时钟的根因是冷却签名只包含来访阶段、人物区域与可供性。第一次跨过短冷却后，即使人物又提交了新的目光动作，来访仍是同一阶段，系统便误以为自己已经等待过这个状态。修复后，最新提交动作也是因果状态的一部分；每出现一个新世界动作，场景可以再跨过一次短冷却，而最大轮数和场景秒数继续限制无穷观察循环。

非语言因果的根因是旧字段把 `targetCharacterId` 主要解释为说话对象。现在，明显注视、试探或作用于某人的动作也必须记录现场对象；物理影响可以定向传播。后续人物只有在自己的 cognitive appraisal 确实引用了该 noticed evidence，并把下一步仍指向来源人物时，才继承它作为 causal parent。这样既不会把所有同场动作强行连线，也不会要求人物必须开口才能发生交互。

通用失败测试在旧时钟上稳定复现 4 动作后静止；修复后完成 6 个静默动作，并形成至少一组有来源的无台词 causal pair。真实报告仍保持 `execution_incomplete`，不会被本地修复追溯改写成通过；四次真实请求已经消费此次授权，下一次运行仍需新的明确授权与作者最终判断。
