# v1.3 望梯酒馆“生态缸”人物 Agent 升级方案

> **2026-07-22 权威更新：** 本文关于“场景生成封闭候选、数学完成行动选择、LLM 只实现已选动作”的条款已由 [Character Agent 内部心理工具与自主表达架构](./24_character_agent_internal_psychology_tools.md) 取代。本文的世界事实、身体、欲望、环境、传播、连续时间和行动后反馈仍作为背景设计保留。
>
> **2026-07-23 权威更新：** 本文关于“人物知道足够信息、拥有权限、场地允许某类行动才可尝试”以及统一场所规范成本的条款，已由 [无场景裁决权的多地点人物世界运行时](./27_no_scene_authority_world_runtime.md) 取代。物理与社会条件约束世界结果和人物预期，不构成场景对人物选择的许可表。

## 0. 结论

数学方式可行，并且适合解决当前人物行为缺乏因果、欲望无法持续、对话被时段切断的问题。

但正确形式不是“一个巨大总分决定一切”，而是：

```text
共同的认知与行动公式
× 每个人不同的权重、阈值、惯性和恢复速度
× 每一刻不同的身体、情绪、欲望、关系和环境状态
= 此刻不同的行为倾向
```

同时必须把三类问题分开：

1. **硬事实**：目标是否在场、是否听见、物件归谁、钱是否已付。这些先由世界规则裁决，不能参与加减分。
2. **行动取舍**：在合法行动中，欲望能推进多少、阻碍有多大、人物愿意承担什么代价。这部分用统一公式计算。
3. **自然表达**：选定“谁对谁做什么”以后，模型只负责具体动作、语气和台词，不得修改对象、事实和事务结果。

因此，真正的“人物 Agent”不是单独一个 LLM，而是：

```text
人物长期结构
+ 私有动态状态
+ 主观信念与记忆
+ 数学评估器
+ 行动选择器
+ 语言/动作实现模型
+ 世界裁判
```

本方案只把望梯酒馆作为当前高精度观察场。酒馆外世界继续存在，但第一阶段只维护位置、目标和未完事务，不展开场外叙事。

---

## 1. 为什么它比“再写更强提示词”可靠

当前系统已经有空间传播、影响链和真实人物调用，但人物真正收到的 `activeGoal` 来自第一条 commitment；原始具体欲望没有进入实时评估。当前激活分也主要是“最强影响 + 初始压力 - 冷却”，因此：

- 职责、边界、禁令会被误显示成欲望；
- 洛照想交手、周珉想得到举荐答复，没有真正参与行动竞争；
- 受阻的欲望不会积累挫败和再次寻找机会；
- 同一人物跨时段不保留自己的行动与意图；
- 模型只能临场猜“害羞、疲劳、人多”是否重要；
- 提示词即便写对，也无法阻止目标不存在、重复交钱、未听见却回答等硬错误。

数学层的价值不是把人变简单，而是让每次行动都能回答：

```text
他想得到什么？
这件事现在有多急？
当前行动能推进多少？
什么在阻碍他？
他为什么没有选择另一个行动？
行动之后，他的状态发生了什么变化？
```

---

## 2. 共享公式，个人参数

### 2.1 人物状态

人物 `i` 在时刻 `t` 的私有状态定义为：

```text
Sᵢ(t) = {
  traits,          // 长期性格：慢变量
  sensitivities,  // 创伤/羞耻/威胁敏感模式：慢变量
  body(t),         // 饥饿、疲劳、疼痛、体力、困倦
  affect(t),       // 短期情绪与中期心境
  beliefs(t),      // 本人相信的事实及来源
  desires(t),      // 多个具体欲望及当前强度
  intention(t),    // 已选中且正在持续的目标与方案
  duties(t),       // 职责、承诺、规范，不冒充欲望
  relationships(t),
  attention(t),
  memories(t)
}
```

场景状态：

```text
E(t) = {
  time,
  zones,
  light,
  noise,
  crowd,
  privacy,
  weather,
  serviceLoad,
  atmosphere,
  objects,
  openTransactions,
  openConversations
}
```

所有人物使用相同字段和相同计算步骤。差异来自：

- 因子权重 `wᵢ`；
- 表达阈值 `θᵢ`；
- 当前意图惯性 `cᵢ`；
- 近似行动间的选择温度 `Tᵢ`；
- 情绪、挫败和创伤唤醒的衰减速度 `τᵢ`；
- 当下动态状态 `Sᵢ(t)`。

这能自然产生“性格相近、状态不同、行为不同”：同样内敛的两个人，一个饥饿且疲惫，另一个刚休息好且欲望已被连续阻碍，面对同一机会时会得到不同净压力。

### 2.2 性格只修改参数

性格不能直接生成台词，也不能直接等于欲望。

| 性格维度 | 主要修改的量 |
|---|---|
| 内敛 / 害羞 | 公开表达成本、被注视成本、表达阈值 |
| 坚持 / 固执 | 意图惯性、未满足欲望增长、放弃阈值 |
| 尽责 | 职责积压压力、未完成事务成本 |
| 谨慎 | 危险、未知后果、错误行动的预估成本 |
| 好胜 | 能力验证、地位比较、挑战行动的收益 |
| 体贴 | 对他人造成损害、公开使人难堪的成本 |
| 冲动 | 反应延迟、表达阈值、选择温度 |
| 自主需求 | 被代替决定、被逼迫、被控制的关系成本 |

例如“内敛”不会让人物永远沉默。它只是让“当众直接提出”成本更高；当欲望积累、环境变私密或期限逼近时，仍然可能越过阈值。

---

## 3. 欲望、职责、原则、创伤必须分型

### 3.1 欲望标准

一条合法欲望必须：

- 主体是人物自己；
- 用肯定方式描述想获得的状态；
- 有具体对象或结果；
- 能判断是否满足；
- 可以受阻，但不把阻碍写进欲望；
- 不等于职责、禁令、秘密、性格或作者评价。

```yaml
id: duel_with_xiezhen
desiredState: 与谢真石完成一次双方认可的正式交手
targetCharacterId: xie_zhen_shi
baseIntensity: 0.72
naturalGrowthPerHour: 0.015
satisfactionCondition: duel_completed_with_xiezhen
abandonmentCondition: target_permanently_unavailable
```

### 3.2 现有错误字段的正确归类

| 现有内容 | 正确类型 | 对应的真实欲望 |
|---|---|---|
| 交手前不接受别人替对手写好的评价 | 原则 / 边界 | 洛照想亲自与谢真石交手 |
| 短缺必须当天记到账板 | 职责 / 工作标准 | 谢恒想凑齐药钱并保住酒馆周转 |
| 不在人前揭穿谢真石的体力问题 | 社交抑制 / 保护策略 | 周珉想得到谢真石明确的举荐答复 |
| 未完成次数不能因旁人经过就算完 | 完成标准 | 陈砚想完成具体训练并获得继续修炼的机会 |

### 3.3 创伤与敏感模式

创伤不作为永久负分，也不作为人格标签。它记录“什么线索会让人物把当前情境解释为威胁”：

```yaml
triggerFeatures: [public_scrutiny, senior_judgment]
threatMeaning: 再次在人前失去体面和控制
threatPrior: 0.65
shameGain: 0.40
avoidanceBias: 0.25
recoveryHalfLifeSeconds: 900
safeContextReduction: 0.55
```

只有实际感知到匹配线索时才激活，并受环境、关系安全感和时间衰减影响。它可能推动退开、僵住、转移话题、先观察或寻找私下机会；不能自动生成一段漂亮的“创伤解释”。

---

## 4. 统一数学模型

### 4.1 第一道：硬门控

对人物 `i` 的候选行动 `a`：

```text
Fᵢ(a,t) = ∏ 1[preconditionₖ 成立]
```

任何一项不成立，行动效用直接为负无穷，不能被欲望抵消：

- 目标真实存在且在可感知/可达范围；
- 人物知道足够信息，不会声称听见未听见的事；
- 物件存在且所有权正确；
- 经营事务尚未完成；
- 人物有相应权限；
- 场地允许该类行动；
- 回答确实有一个尚未关闭的来源问题；
- 称呼、动作对象、字段 target 和会话 addressee 一致。

这一步负责消灭隔空对话、重复交钱、未收到饭却说吃完、对周珉却叫真石等问题。

### 4.2 身体稳态

身体需要使用同一组归一化变量：

```text
BodyDriveᵢ(t) = (Σₖ wᵢₖ · |Hᵢₖ(t) - H*ᵢₖ|ⁿ)^(1/m)

BodyRewardᵢ(a) = BodyDriveᵢ(t) - BodyDriveᵢ(t + effect(a))
```

于是：

- 同一碗饭对很饿的人价值高，对刚吃完的人接近零；
- 劈柴对受伤、疲劳人物的成本明显升高；
- 休息不是通用填充动作，而是在疲劳确实越过阈值时才有价值。

身体状态随连续时间更新：

```text
hunger  += timeGrowth - foodEffect
fatigue += actionCost + sleepDebt - restRecovery
pain    += injuryCost - recovery
stamina += recovery - exertion
```

### 4.3 欲望强度

每个欲望 `g` 有独立状态，不能把所有愿望压成一句 `activeGoal`：

```text
Dᵢg(t+Δt) = clamp(
  Dᵢg(t)
  + naturalGrowth · Δt
  + relevantCue
  + verifiedUrgency
  + frustrationAfterBlock
  + relationshipExpectation
  - satisfaction
  - adaptation
  - competingNeedSuppression,
  0, 1
)
```

说明：

- `verifiedUrgency` 必须来自真实期限，不能由模型编造“明早回山”；
- 延期不会把欲望关闭，只会在仍未满足时提高挫败；
- 只有满足条件、目标不可能或人物明确放弃，欲望才结束；
- 当前 intention 具有惯性，不因旁人经过或时段标签改变就清空。

### 4.4 事件主观评估

人物只对真正传播到自己的事件 `e` 进行 appraisal：

```text
Appraisalᵢ(e) = {
  relevance,
  goalCongruence,
  urgency,
  expectedness,
  agency,
  blameOrCredit,
  controllability,
  changeability,
  normCompatibility,
  egoInvolvement,
  threat,
  availablePower
}
```

这里不是把所有项直接相加成“生气 63”。它们先决定可用的应对方向：

- 高阻碍、他人责任、高可控：要求、制止、对质；
- 高威胁、低可控：退开、观察、求助；
- 自己控制低但对方可改变：交涉、等待、找有权者；
- 自身责任且规范受损：修复、遮掩、道歉；
- 目标有利且可控：接近、推进、承诺。

### 4.5 行动推动力与阻碍力

先对合法行动计算推动力：

```text
Approachᵢ(a,t) =
  Σg [Dᵢg(t) · ExpectedProgressᵢ(g,a)]
  + BodyRewardᵢ(a)
  + EmotionReliefᵢ(a)
  + DutyReliefᵢ(a)
  + RelationshipGainᵢ(a)
  + InformationGainᵢ(a)
```

再计算阻碍：

```text
Resistanceᵢ(a,t) =
  PhysicalCost
  + SocialExposureCost
  + NormCost
  + ThreatCost
  + PrivacyCost
  + RelationshipRisk
  + UncertaintyCost
  + CompetingGoalCost
  + DutyInterruptionCost
```

人格、身体、创伤和当前氛围通过个人权重改变每一项：

```text
wᵢ(t) = w_base
       + PersonalityMatrix · traitsᵢ
       + SensitivityMatrix · activeTriggersᵢ(t)
       + MoodMatrix · moodᵢ(t)
```

统一净效用：

```text
Uᵢ(a,t) =
  Fᵢ(a,t) · [
    Psuccessᵢ(a) · Approachᵢ(a,t)
    - Resistanceᵢ(a,t)
    + IntentionContinuityᵢ(a)
    - SwitchingCostᵢ(a)
    - RepetitionPenaltyᵢ(a)
    - ContradictionRiskᵢ(a)
  ]
```

表达激活度：

```text
Activationᵢ(a,t) = sigmoid(kᵢ · (Uᵢ(a,t) - θᵢ))
```

`θᵢ` 是人物表达/行动阈值，`kᵢ` 是阈值附近的敏感程度。

### 4.6 不是永远取最高分

纯 `argmax` 会让人物机械重复。选择方式为：

1. 排除所有硬门控失败的行动；
2. 排除未过最低满足阈值的行动；
3. 只保留距最高分不超过约 8% 的候选；
4. 用带固定随机种子的 softmax 选择：

```text
Pᵢ(a) = exp(Uᵢ(a)/Tᵢ) / Σ exp(Uᵢ(b)/Tᵢ)
```

- `Tᵢ` 低：果断、稳定、较少摇摆；
- `Tᵢ` 高：犹豫、探索、近似选择更容易变化；
- 当前 intention 获得连续性加分，避免每一步换目标；
- 紧急事件可压过惯性，但普通噪声不能。

这样相近性格不会变成复制人，而同一个人物在相同状态和固定种子下又能复现，便于调试。

---

## 5. “有欲望但不能直接做”的处理

候选行动必须分层，而不是只给“做 / 不做”：

```text
直接满足：当面提出、接受、拒绝、交手
降低阻碍：请旁人离开、换到后院、等待打烊
间接推进：观察、试探、询问、制造独处机会
保护性应对：转移话题、保持距离、找有权者
暂时压制：继续手头事务，但保留未满足欲望和可见泄露
```

洛照示例（数字仅为待校准的解释样例）：

| 候选行动 | 欲望推进 | 机会 | 主要阻碍 | 净分 |
|---|---:|---:|---:|---:|
| 白天堂前直接拔剑 | +72 | +18 | 公共场合 -20、人多 -17、内敛 -19、酒馆规范 -25 | 9 |
| 观察谢真石练剑 | +31 | +16 | 暴露兴趣 -7 | 40 |
| 询问打烊后是否愿意交手 | +58 | +14 | 内敛 -12、被拒风险 -8 | 52 |
| 去后院或院外正式邀战 | +72 | +20 | 风险 -9、体力顾虑 -6 | 77 |

如果表达阈值为 35，她不会在堂前拔剑，但会观察、试探或提出换地点。到了夜晚安静后院，公开性和规范成本下降，“正式邀战”就可能越过阈值。

这正是“欲望受到阻碍”而不是“人物没有欲望”。

---

## 6. 行动之后必须真的改变人和环境

每个提交成功的行动都生成 Outcome：

```text
Outcome = {
  physicalChanges,
  transactionChanges,
  desireProgress,
  desireSatisfaction,
  frustration,
  bodyCost,
  emotionAppraisalSeed,
  relationshipEvidence,
  atmosphereContribution,
  observableImpacts
}
```

更新规则：

- 得到明确答复才满足“得到明确答复”，含糊延期不满足；
- 试图推进却受阻，增加 frustration，并提高寻找替代行动的概率；
- 吃饭更新饥饿和体力，不能只更新账本；
- 劈柴更新疲劳、疼痛、柴堆和旁观者印象；
- 公开拒绝和私下拒绝产生不同关系与羞耻影响；
- “嗯”只有在确实完成开放问题时才可能关闭会话；
- 关系变化基于可验证事件和主观 appraisal，不能按 speech act 自动加分。

---

## 7. 酒馆氛围不是作者旁白

场景氛围使用分区向量：

```text
Atmosphere(zone,t) = {
  bustle,
  tension,
  warmth,
  scrutiny,
  privacy,
  noise
}
```

它由实际公开事件累积并衰减：

```text
A(t+Δt) = A_baseline
        + (A(t)-A_baseline) · exp(-Δt/τ)
        + Σ publicEventContribution
```

氛围只传播公开可感知的表达：提高音量、拔剑、争执、突然沉默、集体注视、热闹客流。人物未表达的私人心理不能进入全场氛围。

不同人物对同一氛围的权重不同：谢母可能把拥挤首先理解为服务压力，洛照可能理解为不适合公开邀战，周珉可能理解为不宜把举荐逼问得太难看。

---

## 8. 影响传播与异步时间

### 8.1 传播

每个世界事件按通道传播：

```text
Impact(e→j,c) =
  Strength(e,c)
  · DistanceKernel(c,d)
  · Occlusion(c)
  · Attention(j)
  · Salience(j,e)
```

通道至少包括直接目标、视觉、声音、物理后果、社会评价、信息内容。

- 堂前说话可能传到柜台，不会自动穿过关闭的客房门；
- 递钱只对同区直接目标产生物件影响；
- 八卦必须由人物主动转述，生成新的 information event；
- 转述保存 source chain、可信度和可能失真，不能远程复制原始事实。

### 8.2 连续时间

不再用“清晨 / 正午 / 午后 / 黄昏 / 夜深”重开演员名单。它们只改变光照、客流、噪声、营业状态等环境参数。

运行使用下一事件队列：

1. 外部事件、身体需要、期限、未完事务或已抵达影响唤醒人物；
2. 人物重新评估行动候选；
3. 得分过阈值者进入队列；
4. 世界裁判提交最先到期的行动；
5. 新影响传播，再激活受影响者；
6. 时钟跳到下一个实际事件。

反应延迟：

```text
Latencyᵢ = Lbaseᵢ
         · (1 + CognitiveLoad + Inhibition)
         / (1 + Arousal + PersonalRelevance)
```

直接提问会给 expectedResponder 一个高优先级会话 claim，所以通常几秒内回应。若人物故意沉默、离开、被打断或正在完成不可中断动作，系统必须把它提交为明确事件，而不是让对话无理由跨过数小时。

场景只有在以下条件同时成立时才静止：

- 无人的激活度超过阈值；
- 没有尚待回应的直接提问；
- 没有到期经营事务；
- 没有已排队外部事件；
- 人物都在继续可持续的常规行动。

安全步数耗尽时保持同一场景时间续跑，不自动跳到下一个宏观时段。

---

## 9. 人物 Agent 的新结构

### 9.0 场景先提供行动，不让模型凭空发明

广泛调研后，在人物 Agent 前增加两个候选行动来源：

1. **Smart Affordance Registry**：门、桌、饭锅、柴堆、柜台、物件和人物，根据当前位置和状态广告自己可提供的行动。
2. **Social Practice Registry**：接待、住宿结账、验货、以工换饭、私人谈话、追问举荐、约战等社会惯例，保存参与角色、开放问题、当前阶段和合法下一步。

它们只回答“此刻可以做什么”，不决定人物一定要做什么。人物自己的欲望、身体、情绪、关系和阻碍再对这些候选行动评分。

```text
物理对象 affordance
+ 经营事务 affordance
+ 社会惯例 affordance
+ 基础自发行动（观察、等待、移动、离开）
→ 合法候选行动集合
→ 人物效用计算
```

这同时借鉴 The Sims 的 smart terrain 和 Versu 的 social practice，但保留本项目已有的空间、知识和物件硬校验。

### 9.1 人物塑造 Agent：只在编译/编辑人物时使用

职责是把创作资料编译为结构化人物档案：

```text
Character source
→ beliefs / values / concrete desires
→ duties / commitments / boundaries
→ traits / sensitivities
→ relationship-specific expectations
→ address lexicon
→ satisfaction and abandonment conditions
```

编译器必须拒绝：

- 否定句欲望；
- 把职责当欲望；
- 把关于他人的保护策略当自身愿望；
- 没有对象、没有完成条件的抽象口号；
- 两个人物共用同一目标或台词模板；
- 称呼关系与角色身份冲突。

这一步需要人工检查一次。它不在每轮行动前重新“创造人物”。

### 9.2 运行时人物 Agent

```text
私有感知与信念
→ Appraisal
→ 欲望/职责/身体/情绪更新
→ 生成结构化候选行动
→ 硬门控
→ 统一效用公式
→ 带惯性的行动选择
→ LLM 实现动作与台词
→ 语义验证
→ 世界提交
```

LLM 接收的 actor、target、speechAct、topic、knownFacts、forbiddenClaims 和事务阶段均已固定。校验失败只能重写措辞，不得偷偷换对象、结果或时间。

### 9.3 世界裁判

人物只能提交“想做什么”，世界裁判决定：

- 是否做得到；
- 实际发生了什么；
- 物件和钱如何变化；
- 谁真正看见/听见；
- 产生哪些后果。

### 9.4 短计划与连续执行

统一效用公式先决定“想推进哪个目标、选择哪类行动”。只有该意图确实需要多个步骤时，才使用轻量 GOAP 生成 2–5 步短计划；随后用 Behavior Tree 式执行器维持 running/success/failure、中断和回退。

```text
Utility：选择“与谢真石私下谈”
GOAP：确认在场 → 靠近 → 邀请去后院 → 到达 → 开口
Executor：逐步执行；若谢真石离开或被直接叫住，则中断并重新评估
```

GOAP 不产生欲望，Behavior Tree 不决定人格；即时回答也不调用规划器。

---

## 10. 七名人物的第一版配置方向

以下是建模方向，不是最终数值；最终权重需用反事实情境校准。

| 人物 | 核心具体欲望 | 主要阻碍/敏感 | 参数倾向 |
|---|---|---|---|
| 谢真石 | 自己决定是否给周珉举荐；继续推进自己的剑术；完成当下必要活计 | 疲劳、被公开催逼、父母替自己决定、用杂务回避选择 | 自主高、内敛高、坚持中高、表达阈值高 |
| 谢恒 | 凑齐药钱并保住酒馆周转；让经营账目不失控 | 钱的来源被追问、公开失面、秘密暴露、事务积压 | 隐私高、控制高、尽责高、切换成本高 |
| 谢母 | 弄清药钱来源并让家庭账目真正闭合；把客人妥善安置 | 外人在场、服务压力、丈夫回避、家计不确定 | 尽责高、照料高、行动阈值低、公开冲突成本中高 |
| 周珉 | 从谢真石本人得到举荐的明确答复，并据真实期限完成师门事务 | 友情债、显得功利、旁人在场、谢真石持续回避 | 地位需求高、坚持高、社交主动中、挫败增长快 |
| 洛照 | 与谢真石完成一次双方认可的正式交手，亲自判断他的剑 | 白天公共场合、人多、酒馆规范、不愿暴露兴趣、对方疲劳或未同意 | 好胜高、自主高、内敛高、风险容忍中高 |
| 陈砚 | 靠自己的能力换到今日食物，并获得继续修炼和参加考核的机会 | 饥饿、资源少、身份低、害怕被视为讨便宜、体力消耗 | 能力需求高、尽责中高、地位敏感中、身体因子权重大 |
| 严执中 | 找到可由本人验证的合适候选，并让名录经得住核查 | 传闻不可靠、程序被绕开、公共压力、错误背书风险 | 规范高、谨慎高、尽责高、证据阈值高 |

关键区分：

- 周珉不是“送药吃饭模板”，举荐未解决时事务不能因饭吃完而完成；
- 陈砚不是“另一个周珉”，他的压力中心是生存、能力和考核机会；
- 洛照住宿结清也不等于交手欲望结束；
- 谢恒“记账”是职责行动，“凑药钱并维持周转”才是欲望；
- 谢真石的杂务可以是真实职责，也可能是回避高压力选择的 coping，二者要由当时状态决定。

---

## 11. 观察界面

现有头像心理浮层改为展示真实评分账本，而不是只有 LLM 的事后解释：

```text
此刻主要欲望：与谢真石完成一次正式交手        74
实际触发：看见谢真石独自在后院练剑            +16
环境机会：后院无人、距离可达                    +18
阻碍：内敛                                      -12
阻碍：担心对方疲劳                               -8
意图连续性：已观察两次仍未满足                    +9
净效用：约到打烊后交手                            63
个人阈值：                                       41

选中：询问打烊后是否愿意交手
未选：当堂拔剑 12 / 继续观察 38 / 离店 7
```

再附一行由人物 Agent 生成、但不参与计算的私有措辞：

> 现在问出口会暴露得太明显，但再等下去可能错过他。

评分账本只给观察者，绝不能传播给其他人物、记忆、八卦、关系或世界事实。

---

## 12. 在现有项目中的接入方式

不新建第三套模拟器。在现有因果场景中插入生态评估层。

建议模块：

```text
src/server/pipeline/tavernEcologyProfile.mjs
src/server/pipeline/tavernEcologyState.mjs
src/server/pipeline/tavernAppraisalEngine.mjs
src/server/pipeline/tavernOutcomeUpdater.mjs
src/server/pipeline/tavernDialogueValidator.mjs
src/server/pipeline/tavernPracticeRegistry.mjs
src/server/pipeline/tavernAffordanceRegistry.mjs
src/server/pipeline/tavernMicroPlanner.mjs
src/server/pipeline/tavernActionExecutor.mjs
```

继续复用：

- 酒馆分区与空间传播；
- impact provenance 和八卦来源链；
- 行动 → 影响 → 激活下一人物的因果循环；
- 经营 affordance、库存、钱箱、权限和物件校验；
- observer-only 心理隔离；
- updateBundle、存档与分支框架。

替换：

- `activeGoal = commitments[0]`；
- 当前简化的 `intrinsicPressure / personalRelevance / candidateScore`；
- 时段表直接决定人物出场；
- 每个时段重开一场并清空自身行动记忆；
- 普通 answer/refuse 自动关闭事务；
- 只按 speech act 自动改变关系；
- observerPsychology 把 activeGoal 直接叫欲望。

逐步退役旧的双轨 needs、候选分和整日决定器，防止同一人物有多份状态真相。

---

## 13. 分阶段升级

### 阶段 A：人物数据合同与错误硬门槛

- 重写七人的欲望、职责、原则、边界、敏感和称呼表；
- 增加欲望语义校验器；
- 增加 actor/target/称呼/动作对象/回答来源一致性；
- 增加知识来源、物件所有权、事务完成状态和期限 provenance 校验。

验收：现有用户样本中的对象错位、虚空听见、重复交饭/付钱、编造明日期限全部成为 RED 并转绿。

### 阶段 B：生态状态与公式影子模式

- 建立唯一的 `ecologyProfile` 和 `ecologyState`；
- 接入身体、欲望、阻碍、人格权重、情绪、关系和氛围；
- 新公式只记录评分，不改变旧行动选择；
- 在观察界面对比“旧选择 / 新评分”。

验收：固定种子的同一输入可复现；每项分数能追溯到唯一状态来源；没有重复扣分。

### 阶段 C：替换人物激活与行动选择

- 新 appraiser 替换 `intrinsicPressure / personalRelevance / candidateScore`；
- 引入 intention 连续性、欲望满足与受挫；
- 公式生成并选择结构化行动语义；
- LLM 只实现台词和可见动作。

验收：每个提交行动绑定一个欲望、职责或事件应对；无因动作显著下降，受阻欲望能产生替代行动。

### 阶段 C2：社会惯例与短计划

- 把住宿、验货、以工换饭、追问举荐和约战注册为通用 social practice；
- 把物件、区域、人物与会话转成状态驱动的 affordance advertisement；
- 仅对需要多个步骤的已选意图运行 2–5 步 micro-plan；
- 执行器等待真实完成事件，并在新影响到来时允许中断或重规划。

验收：事务能跨多个动作保持同一目标和参与者；社会惯例只提供选择，不强迫人物按脚本行动。

### 阶段 D：连续时钟与会话锁

- 宏观时段降为环境参数；
- 引入下一事件队列和反应延迟；
- 直接问答保持同一会话和秒级时间；
- 步数上限只暂停，不跳时段。

验收：一段普通连续问答不跨小时；延期、沉默或离开必须是明确行动。

### 阶段 E：行动后反馈与氛围

- 身体消耗、欲望满足、挫败、情绪和氛围统一更新；
- 关系变化基于事件证据与主观 appraisal；
- observerPsychology 显示评分账本和未选候选。

验收：吃饭、劳作、拒绝、延期、公开/私下表达能产生不同后续状态。

### 阶段 F：场外连续性接口

- `present=false` 必须有具体场外 location；
- 人物在场外低精度更新身体、行程、欲望和约定；
- 进入酒馆是 travel action，不是时段瞬移；
- UI 仍只展示酒馆实际可感知内容。

第一轮不生成场外剧情，避免扩大范围。

---

## 14. 校准与测试

权重不是心理学真理，也不能为了写出预定剧情反向调参。第一版采用可解释手工参数，通过 20–50 个反事实情境校准。

必须包含：

1. 同一洛照：白天拥挤堂前不会拔剑，但会试探或约战；夜晚安静后院可能正式提出交手。
2. 两名性格相近人物：一个疲劳饥饿、一个精力充足，对同一劳作请求选择不同。
3. 同一周珉：首次延期可接受，连续含糊回复后 frustration 上升，主动确认压力变大。
4. 同一谢真石：低压力时继续杂务，高压力且被直接追问时不能无限用杂务关闭话题。
5. 目标不在场：再强欲望也不能隔空说话，只能等待、寻找、留言或转向其他合法行动。
6. 已付款/已交饭：任何分数都不能让事务重复发生。
7. 未听见旧对话：不能声称“方才我听见”。
8. 场景步数耗尽：恢复时仍在同一分钟和同一会话。

核心指标：

| 指标 | 目标 |
|---|---:|
| actor / target / 称呼 / 动作对象一致率 | 100% |
| 无来源事实声明 | 0 |
| 物质事务重复提交 | 0 |
| 每个行动的动机账本覆盖率 | 100% |
| 受阻欲望跨行动保留率 | 100% |
| 普通直接问答无故跨时段 | 0 |
| 场外人物位置连续率 | 100% |
| 同人跨状态行为敏感度 | 必须显著变化 |
| 不同人物在同状态下的策略区分度 | 必须显著变化 |

最后仍需真实模型盲测，因为绿色单测只能证明因果合同，不能替代“看起来像活人”的可见验收。

---

## 15. 风险控制

- **公式解释错误数据**：先修人物欲望分类，再上公式。
- **多份状态真相**：`ecologyState` 必须成为唯一人物动态权威，旧 lifeState 只迁移不并行决定。
- **不可行事实被当普通负分**：硬门控永远在评分之前。
- **因子重复计算**：疲劳只能有一个权威源，通过不同函数引用，不能在四处独立累计。
- **纯最高分导致机械**：使用阈值、意图惯性、近最高分 softmax 和固定种子。
- **随机性导致荒唐行为**：只在已合法且接近最高分的候选中抽样。
- **反馈爆炸**：合并同源影响、设置习惯化和短 refractory period、限制每秒事件预算。
- **创伤把人变成症状**：只在匹配线索和上下文中偏置评估，并允许安全经验降低敏感。
- **LLM 绕过公式**：模型不得自由修改 actor、target、事实、物件和时间。
- **观察者心理泄漏**：评分账本与私有措辞保持 observer-only。
- **权重伪科学**：所有参数标记为产品模型，通过反事实和人工可见验收校准。

---

## 16. 资料依据

- [Rao & Georgeff：BDI Agents: From Theory to Practice](https://aaai.org/papers/icmas95-042-bdi-agents-from-theory-to-practice/)：区分 belief、desire 与 intention。
- [Marsella & Gratch：EMA Appraisal Dynamics](https://stacymarsella.org/publications/pdf/EMA_Dynamics.pdf)：事件评估、应对与重新评估循环。
- [Keramati & Gutkin：Homeostatic Reinforcement Learning](https://elifesciences.org/articles/04811)：身体驱力与状态偏差减少。
- [Gebhard：ALMA](https://alma.dfki.de/papers/aamas05.pdf)：人格、心境、情绪的不同时间尺度。
- [FAtiMA Toolkit](https://arxiv.org/abs/2103.03020)：模块化社会情绪 Agent、目标与行动规则分层。
- [Generative Agents](https://arxiv.org/abs/2304.03442)：观察、记忆、反思与计划的作用边界。
- [Game AI Pro：Utility Theory](https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter09_An_Introduction_to_Utility_Theory.pdf)：归一化效用、候选选择与行为评分。
- [Google DeepMind Concordia](https://deepmind.google/research/publications/64717/)：Agent 行动尝试与环境裁判分离。

## 17. 本轮设计决定

本次升级采用：

```text
硬门控
→ 共享公式
→ 个人权重
→ 动态身心状态
→ 意图连续性
→ 近最高分可复现抽样
→ LLM 自然实现
→ 世界裁判提交
→ 影响传播与重新评估
```

第一实施目标不是让酒馆“每天发生更多事”，而是让每一件发生的事都来自某个人正在承受的具体压力，并真实改变下一刻所有能感知它的人。
