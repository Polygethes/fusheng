# 主观认知、记忆与表达分层升级方案

> **2026-07-22 权威更新：** 本文的认知、记忆、表达与世界结果分层继续有效；P3 中“同一次模型输出同时产生首次 appraisal 与最终决定”的单调用简化，以及任何预制候选／表达策略的做法，已由 [Character Agent 内部心理工具与自主表达架构](./24_character_agent_internal_psychology_tools.md) 取代。

## 0. 结论

本次升级不再把“符合客观事实”“来源充足”“回答上一句话”或“每句都有明显声纹”当作人物公开表达的准入条件。

新的总原则是：

```text
知识边界不是禁言器，而是认知来源边界。
客观事实不是台词审查器，而是世界结算器。
人物可以相信错误的事、记错、猜测、撒谎、玩笑、调戏、回避和顾左右而言他。
世界只保证这些行为不会自动改写客观事实、他人内心或物理结果。
```

`docs/18_v13_tavern_ecosystem_architecture.md` 与 `docs/19_generic_causal_simulation_kernel.md` 中把“未知事实、未承接问句、错误时间/空间/物件主张”列为行动前硬门控的部分，由本方案修正。今后的硬门控只保护运行权威和世界结算，不审查人物主观内容是否正确、合作或合理。

第一阶段仍只在望梯酒馆跑通，并以洛照、谢真石的连续入店互动作为真实验收；所有 schema 与函数保持场景、人物无关，以便以后换人物和多场景复用。

---

## 1. 当前错误来源

当前链路实际近似于：

```text
世界写好的事件文本
→ 原样送给人物
→ 自动编码为经历和信念
→ 候选要求回应或解决
→ 台词必须证明来源、承接问题、符合事实并显示人物声纹
→ 任一诊断失败便让模型按同一候选重写
→ answer / inform / refuse 自动关闭对话线程
```

这会产生五类系统性错误：

1. `carried` 被写成 `in hand / visible`，人物尚未选择展示物件，别人已经围绕它行动。
2. 世界事件文本含真实姓名，陌生人的感知和记忆在 `identityKnown=false` 时仍收到姓名。
3. 听见一句话便自动形成与其 semantic frame 对应的 belief，缺少“听见但不信、误解、暂不判断”的间隙。
4. `VOICE_IDENTITY_TOO_GENERIC`、`UNSUPPORTED_*`、请求对象和承接检查会删除或重写自然短句、谎言、错误记忆、回避与反问。
5. 对话线程按 speech-act 标签关闭，无法表达“回应了，但没有回答”“我觉得答过了，对方觉得没有”。

对应的主要现有权威面：

- `src/server/pipeline/tavernCausalScene.mjs`：Agent 输入、decision schema、语义/物质校验、impact、提交、时钟与线程；
- `src/server/pipeline/tavernCharacterVoice.mjs`：单句声纹硬拒绝；
- `src/engine/semanticTurnValidator.js`：目标、来源和时间主张硬拒绝；
- `src/engine/characterAgentMemory.js`：感知后自动生成 belief；
- `src/server/simulation/objectLedger.mjs`：缺少收纳、在手、外露与展示状态；
- `src/server/simulation/interactionScheduler.mjs`：只有 awaiting / unresolved / resolved；
- `src/server/pipeline/tavernEcologyRuntime.mjs`：一个 impact 只形成一个带“回应义务”的候选；
- `src/server/ecology/tavernEventAppraisal.mjs`：在人物解释前根据共享文本和 speech-act 推断意义。

---

## 2. 新的单向权威链

```text
客观世界事实 WorldFact
  ↓ recipient-specific projection
感官证据 PerceptPacket
  ↓ Character Agent notices and interprets
主观认知 CognitiveAppraisal / BeliefState
  ↕ retrieval and reconstruction
人物记忆 MemoryTrace / RecallInstance
  ↓ Character Agent chooses what effect it wants
表达意图 CommunicationPlan / EmbodiedIntent
  ↓ voice-shaped realization
实际言语与尝试 UtteranceEvent / ActionAttempt
  ↓ physical propagation and resolution
听者感知 ListenerPercept + WorldOutcome
  ↓ listener Character Agent appraisal
听者信念、关系与后续行动
```

只允许沿箭头传递。禁止以下自动提升：

- 世界知道某人是谁，不等于陌生人感知到姓名；
- 人物听见命题 P，不等于人物相信 P；
- 人物记得 P，不等于 P 真实发生过；
- 人物相信 P，不等于人物会公开说 P；
- 人物说 P，不等于人物相信 P；
- 人物说 P，不等于世界把 P 记为事实；
- 听者听见 P，不等于听者相信 P；
- 人物作出尝试，不等于尝试成功；
- 一方觉得问题已回答，不等于另一方也觉得线程已解决。

---

## 3. 六个独立运行对象

### 3.1 客观事实 `WorldFactLedger`

世界继续拥有：

- 时间、场景、区域与通路；
- 人物真实位置；
- 物件真实状态；
- 已提交动作及物理结果；
- 服务、库存、钱款与交易状态；
- 声音、视觉、触碰实际传播到谁。

该账本不直接进入 Character Agent prompt。它只用于生成某个人能收到的 `PerceptPacket`，以及结算行动尝试。

### 3.2 人物专属感知 `PerceptPacketV2`

```js
{
  evidenceId,
  perceivedEntityHandle,       // 对该人物稳定的匿名句柄，不暴露真实 characterId
  recognizedIdentity: null,    // 真正确认后才包含公开姓名/身份
  modality,                    // sound / visual / touch / smell / proprioception
  sensoryFeatures,             // 实际听见的字、轮廓、动作、距离、遮挡
  fidelity,
  ambiguity,
  sourceRoute,
  occurredAt,
  serverAudit: { worldEventId } // 不进入 Agent 输入
}
```

同一世界事件对不同人物生成不同 packet。陌生人只收到“一个佩剑来客跨过门槛”，不能收到“洛照进入堂前”。

### 3.3 主观认知与信念 `CognitiveStateV2`

Character Agent 在同一次决策中返回：

```js
{
  noticedEvidenceIds,
  interpretations: [{ evidenceIds, meaning, confidence }],
  beliefOperations: [{
    proposition,
    operation: "adopt" | "revise" | "doubt" | "reject" | "suspend",
    confidenceBand,
    sourceEvidenceIds,
    reasoningMode: "direct" | "inference" | "rumor" | "guess" | "confabulation"
  }]
}
```

数学层可以计算注意力、证据可靠度和先验冲突，供人物参考；最终是否相信、怀疑或暂缓仍属于 Character Agent。世界只验证引用的 evidence 是否真的属于此人，不验证人物结论是否正确。

### 3.4 记忆 `CharacterMemoryV2`

记忆分三层保存：

1. `experienceTrace`：当时真正抵达感官的证据，追加写入，不随回忆改写；
2. `engram`：编码后的片段、要旨、情绪、来源感与保留强度；
3. `recallInstance`：某次在当前状态下重构出来的记忆版本，可以失真、混源、漏掉细节或加入错误解释。

belief 不再由 episode 自动生成。回忆也不直接替换原始 trace。

共享数学工具：

```text
EncodingStrength
= sigmoid(attention + salience + selfRelevance + emotion
          - fatigue - cognitiveLoad)

RecallProbability
= sigmoid(encoding - timeDecay + cueMatch + rehearsal
          + goalCongruence - interference)

RecallReconstruction
= survivingFragments + gist + currentBeliefBias
   + currentAffectBias + sourceConfusionNoise
```

每个人使用相同函数，但注意力、疲劳、情绪一致性、来源敏感度、压抑倾向、反刍倾向和混源率不同。数学结果是重构压力和不确定性，不是唯一记忆文本的全局裁决。

### 3.5 表达意图 `CommunicationPlan`

认知与实际说话之间增加一个只属于说话者的私有层：

```js
{
  goal: "inform" | "obtain_information" | "conceal" | "mislead"
      | "tease" | "provoke" | "soothe" | "buy_time" | "end_exchange",
  tactic: "direct" | "partial" | "evade" | "counter_question"
      | "redirect" | "lie" | "bluff" | "joke" | "ignore" | "silence",
  disclosure: "full" | "partial" | "withhold" | "false" | "mixed",
  epistemicRelation: "believes" | "doubts" | "uncertain" | "knows_false"
      | "guessing" | "misremembered" | "confabulated" | "not_applicable",
  intendedAudienceHandles,
  desiredEffect,
  threadDisposition: "settle" | "refuse" | "defer" | "evade"
      | "counter" | "redirect" | "ignore" | "open_new" | "none"
}
```

这一层解释“为什么她明明相信 A，却说 B”，也解释顾左右而言他、反问、调戏和沉默。它只供本人心理审计，不传给听者。

### 3.6 实际言语和动作尝试

实际输出拆成：

```js
{
  utterance: { literalSpeech, vocalMode },
  embodiedIntent: { manner, posture, intendedGesture },
  actionAttempt: { primitive, objectId, targetHandle, destinationId }
}
```

人物拥有字句、语气、姿态和尝试。世界只结算：

- 声音是否传到某人；
- 动作是否能成功、失败或部分完成；
- 物件是否真实移动；
- 目标是否实际在场；
- 旁人看见或听见什么。

`literalSpeech` 永远只是“某人说了这句话”。即使人物说“钱已经付了”，钱款账本也不会改变。

---

## 4. 声纹改为“嗓子”，不再限制“嘴形”

声纹仍保留：

- 人物稳定追求、自我威胁与注意偏向如何进入表达；
- 对眼前事实的评价习惯、直接程度与解释成本；
- 停顿、改口、称呼与情绪泄露的倾向；
- 对陌生人、熟人、权威和敌手的语域变化；
- 身体、欲望和压力怎样改变披露、措辞与互动姿态；
- 愿意公开多少信息；
- 哪类评价、承诺和赞美需要什么证据。

声纹不再保留目标字数、分句范围、必用词或正则台词模板。句子长短不是人物身份：同一个人会因为对象、风险、身体、欲望和当下要表达的内容而短说、长说、说完整、改口或有意省略。校准原话只证明心理功能，不进入运行时供模型模仿。

但所有 voice 检查改成软诊断：

- “客官，找人还是住店？”可以是完全合格的普通情境语言；
- “嗯”“知道了”可以与动作共同形成回答，也可以只是敷衍；
- 普通服务话术不因“任何人都能说”而被拒绝；
- 病句、停顿、重复和错称也可以是人物状态；
- 多轮窗口只评估语境、意图和互动连贯性，不用长度或标志词给人物身份打分；
- 软诊断不得触发自动二次模型重写。

保留的硬拒绝只针对 schema 无法解析、人物试图直接写入他人内心或世界成功结果、候选/实体句柄根本不存在等运行权威错误。

---

## 5. 对话线程改为双方各自理解

客观 `ConversationThread` 只记录发生过的 turn，不再拥有唯一的“已经回答”真相。

每个参与者分别保存：

```js
{
  threadId,
  ownerCharacterId,
  perceivedTurns,
  expectationState: "open" | "satisfied" | "abandoned" | "escalated",
  obligationState: "none" | "felt" | "accepted" | "rejected" | "ignored",
  interpretedDisposition: "answered" | "refused" | "deferred"
      | "evaded" | "countered" | "misunderstood" | "unknown",
  pressure,
  lastEvidenceIds
}
```

因此：

- 洛照听见“找人还是住店”，只说“一壶茶”，可以是有意回避；
- 她已经处理了这次声音 impact，但谢真石的问题在谢真石那里仍可能未解决；
- 洛照可能认为自己已经表达了“不想说”，谢真石可能认为她仍欠一句答案；
- 谢真石是否继续追问，由他的欲望、职责、关系、耐心和场面压力决定；
- 世界不强迫下一轮必须回答，也不因出现 `inform` 自动关闭线程。

---

## 6. 物件、空间和时间只约束结果

### 6.1 物件状态 v2

```js
{
  holderActorId,
  containerObjectId,
  carryMode,       // worn / packed / pocketed / hand_left / hand_right
  inHand,
  exposure,        // hidden / partially_visible / visible
  displayedToHandles,
  attachment,
  sceneId,
  zoneId,
  state
}
```

显式操作包括：`take_out`、`store`、`show`、`hide`、`draw`、`sheathe`、`transfer_attempt`。人物可以声称、误记或尝试违反物件事实；只有成功物理结果必须符合 ledger。

洛照当前正确初态：

- 佩剑贴身佩带、可见、未出鞘；
- 拜帖由洛照持有，但收在随身容器中，不在手、不外露、未展示；
- 酒馆任何人都不能在她主动取出前感知到拜帖。

### 6.2 空间和时间

人物可以说错地点、记错昨日、谎称去过某处，也可以尝试走错门。世界只负责：

- 不把错误陈述写成地图和时间事实；
- 不把穿墙、隔空交付或不存在目标的尝试结算成功；
- 将失败或部分完成形成新的可感知事件；
- 让旁人自行解释这是失误、谎言、玩笑还是异常状态。

---

## 7. 数学层的新职责

数学仍是 Character Agent 的心理工具，分别提供：

```text
NoticeScore(evidence)
BeliefPressure(proposition)
RecallPressure(memory)
CommunicationUtility(tactic)
ActionAttemptUtility(action)
```

表达策略效用示例：

```text
Uᵢ(tactic)
= goalGain
 selfPresentationGain
 relationshipEffect
 controlGain
 deceptionOrPlayReward
- exposureRisk
- socialCost
- cognitiveEffort
- expectedRetaliation
```

相同公式下：

- 清高、直接、控制力强的洛照更可能短答、部分披露或直接反问；
- 害怕丢脸的人在公开场合更可能回避、撒谎或转移；
- 与目标亲近会改变说法、风险估计和预期伤害，但不会删除原欲望；
- 疲劳、醉酒、创伤激活和记忆混源会提高误判、失言或冲动尝试的概率。

数学只提供比较材料。Character Agent 可以选择非最高分 tactic；世界、调度器和 voice validator都不得替它改选。

---

## 8. 实施顺序

### P0：先建立 RED 合同

新增通用反例：

1. 人物听见问题后顾左右而言他，话语正常提交，原问题没有被世界自动关闭；
2. 人物谎称已经付款，钱款仍为未付；
3. 人物错误声称“昨日见过你”，台词不被删除，记为无当前证据的主观 claim；
4. 人物故意叫错名字调戏对方，系统不把它当后台串人；
5. 人物尝试递出仍在包中的物件，转交失败且 ledger 不变；
6. 陌生接收者的 prompt、感知和记忆中没有真实姓名；
7. “客官，找人还是住店？”不会因通用或不够显眼而触发 repair；
8. 听者可以听见同一句谎言但形成不同信念。

### P1：感知投影与匿名实体句柄

改造 `createImpactFactor`、`deliverImpactFactor`、`publicPerceivedImpacts` 和 `buildAgentInput`。世界事件保留真实 id，Agent 只收到本人可识别的 handle、感觉特征和已确认身份。

### P2：Memory v2 与 belief 分离

升级 `characterAgentMemory.js`：

- episode 不再自动生成 belief；
- 增加 immutable experience trace、engram、recall instance；
- belief update 必须来自 Character Agent appraisal；
- 将 v1 资料标记为 `legacy_auto_projection` 后兼容迁移，不把旧 belief 冒充客观知识。

### P3：Character Agent decision v2

扩展一次模型调用的输出，加入 `cognitiveAppraisal`、`communicationPlan`、`embodiedIntent` 和 `actionAttempt`。不增加每一步的模型调用次数，避免为了分层把延迟和成本成倍放大。

### P4：撤销内容型硬门禁

修改 `tavernCharacterVoice.mjs`、`semanticTurnValidator.js` 和 `normalizeTavernCharacterDecision`：

- voice identity、通用话术、裸应声、重复、错误时间/听闻主张改为软诊断；
- 地址不同、话题转移和不回答改为可记录策略；
- 只有越权状态写入、输入侧隐藏事实泄漏、不可解析 schema 触发拒绝/repair；
- 自动 repair 不再因风格或真实性判断重写公开台词。

### P5：物理尝试—世界结果分离

升级 object ledger 和 world resolution：

- agent 提交 attempt，不预写成功；
- 世界返回 success / partial / failed 及可感知结果；
- utterance claim 与 object/service/payment ledger 完全隔离；
- 补齐收纳、在手、可见和展示状态。

### P6：双方主观线程与对话微时钟

- 用 participant-owned thread state 替换 speech-act 自动 resolve；
- `heard/processed` 与 `answered/satisfied` 分开；
- 直接话轮按短句长度和同时动作计算约 1–8 秒；
- 移动、做工、吃饭继续使用宏观时长；
- 回避后是否追问由请求者 Agent 的剩余压力决定。

### P7：洛照 Gate 8 重建与验收

修正 authoring foundation、memory seed、compiled registry 与 fixture：

- “佩剑持拜帖”改为“佩剑，拜帖收于随身容器”；
- `arrivalCue` 只属于来客本人的来访/自传事实，不得直接进入公共 impact 或他人的 material facts；公共外观必须从当前 zone 与 object presentation 重新投影；
- expected host、职责匹配和 persistent active visit 不构成知情证据；未披露交易字段对非本人保持 unknown，不在当前 scene runtime 的来客不进入即时事实；
- 当前短计划可包含喝茶与问去梯云宗的路，但不预写顺序或台词；
- 谢真石拥有自己是梯云宗内门弟子、熟悉返宗路线的自有知识；
- 初始感知只出现匿名佩剑来客；
- “客官，找人还是住店？”可作为模型自然生成的可能结果，不写成预期答案；
- 先跑全部本地反例，新的真实远程 Gate 8 仍需作者另行知情授权。

---

## 9. 必要简化边界

第一版不追求完整脑科学模拟：

- 每次激活仍只调用一个 Character Agent；认知、表达意图和行动在同一私有输出中分层，不拆成多个远程模型；
- 每个 percept 只保存一个当前主解释和少量备选，不维护无限解释树；
- 记忆只在编码、衰减、检索和重大再巩固时更新，不持续模拟睡眠与神经活动；
- belief 使用结构化命题、来源和置信区间，不尝试形式化全部自然语言；
- 谎言、玩笑、猜测和误记先用 epistemic relation 表示，不建立复杂测谎器；
- 听者只看到实际言语与动作，不看到说话者的 communication plan；
- narrator 和 UI 仍是单向观察者，不把私有心理回流到世界或其他人物。

---

## 10. 完成标准

本阶段只有同时满足以下条件才算完成：

- 客观事件、感官证据、belief、memory recall、communication plan、utterance 和 world outcome 各有唯一权威；
- 未知姓名不会通过文本、id、semantic frame、memory cue 或 observer metadata 进入人物输入；
- episode 不再自动等同于 belief，听见陈述不自动相信陈述；
- 人物可谎言、猜测、记错、调戏、回避、反问、沉默和故意叫错人；
- 这些表达不会改写物件、空间、时间、付款、服务或他人内心；
- 失败尝试产生真实后果，而不是被预先删除或偷偷改成成功动作；
- voice 只塑造跨轮稳定嗓音，不再逐句限制嘴形或触发风格性 repair；
- 双方可对同一对话是否解决拥有不同判断；
- 连续短对话不再每轮消耗 18–35 秒；
- 洛照的拜帖初态不可见，谢真石的宗门知识完整；
- 新合同在非洛照、非酒馆样本上同样成立；
- 真实模型自然度只有作者可以接受，确定性合同不得冒充人物质量结论。

---

## 11. 2026-07-20 本地实施结果

P0–P6 的生产纵切已经接通，P7 的真实模型与作者验收仍保持独立门禁。

当前运行链为：

```text
WorldFact / object ledger / topology
  → recipient-specific PerceptPacket
  → immutable experience trace
  → state-dependent RecallInstance
  → Character Agent cognitiveAppraisal
  → Character Agent communicationPlan
  → utterance + embodiedIntent + actionAttempt
  → worldResolution(success | partial | failed | not_attempted)
  → recipient delivery
  → recipient-owned thread appraisal / belief / relationship response
```

已实现的关键边界：

- 感知只编码“本人收到什么”，不再自动把言语命题提升为 belief；belief 的 adopt、revise、doubt、reject 与 suspend 由本人的 cognitive appraisal 提交。
- experience trace 追加保存且不可被回忆改写；recall instance 根据编码强度、线索、延迟、复述、目标一致性、疲劳、认知负荷、情绪偏置、信念偏置、干扰、压抑与来源敏感度重构，并保留省略、时空模糊、情绪着色和混源标记。
- 对话线程保存每个参与者自己的 processing、interpretation、satisfaction、response need 与 self closure。一方发出回答只能关闭自己一侧；听者必须真正收到并在自己的下一次决策中判断是否满足。
- `utterance.literalSpeech`、`embodiedIntent.intendedGesture` 与 `actionAttempt` 是三个独立层。人物可以一边说真话、谎话或顾左右而言他，一边尝试一个成功或失败的物理动作。
- world resolution 只提交真实位置、物件、服务、付款与 affordance 后果。它保留通过验证的 Agent 动作表现，不把人物动作改写成统一模板；不可能的动作只返回失败和原因，不把意图文本当成既成事实。
- 声纹运行输入保存人格到表达的因果来源、关系语域与状态变化；遥测只检查语境、意图和互动连贯性，不按句长、分句、固定词汇或人物台词模板评分，也不删除普通服务话、病句、错称、重复或不合作回答。
- 陌生人物与其物件使用接收者专属匿名句柄；真实 id、姓名、slug 与私有物件 id 不进入未识别者的 Agent 输入。
- 直接对话采用微时钟；移动、劳动、消费等继续使用相应物理时长。跨区域发声先作为真实言语发生，再由场景声学路径、距离与音量决定具体谁收到。

兼容边界：旧 decision 仍可通过迁移适配器投射成新三层对象，供旧存档和确定性测试读取；新的正式模型 schema 已要求显式返回 cognition、communication、utterance、embodied intent 与 action attempt。兼容字段不是第二套运行权威。

本地确定性回归已覆盖记忆重构、双方主观线程、错误主张、匿名身份、物件取出与转交、失败动作不吞台词、跨区声音传播、来访事务、完整经营流程、关系评价、连续时段恢复，以及洛照/周珉行为 dry-run。它们证明边界与因果链可运行，不证明远程模型生成已经达到作者要求的自然人物质感。

---

## 12. 身份指代必须分为世界、认识与当下感知三层

第二次真实 Gate 8 样本证明，“隐藏姓名”仍不足以构成认识隔离。若人物听说过的目标与眼前陌生人共用一个匿名 id，模型仍会在结构上提前知道二者相同。

运行输入现采用：

```text
canonical identity  世界知道的真实身份，只用于传播与结算
known_entity        本人记忆、传闻或命题中的已知人物，可能只知道姓名
perceived_entity    本轮真正感知到、但尚未确认身份的具体人
```

合同如下：

- foundation 欲望、传闻、姓名知识和身份识别规则使用 `known_entity`；
- `perceivedCharacters`、当前 impact、可供性、身体动作、对话听者和关系评价使用 `perceived_entity`；
- 世界不得因两个句柄背后指向同一个 canonical id，就替人物完成认人；
- 心理数学层只把已经由本人确认的身份计入“目标在场”与关系效用，陌生人的出现仍可以造成一般观察、警觉、好奇或社交机会；
- 人物可以在台词中猜测、试探或说出记忆中的姓名，但这不会把认识命题自动写成身份事实；
- 后续只有 Character Agent 基于本人证据提交身份确认，记忆系统才可建立两个句柄的连接；在此之前二者必须保持不同。

受信任远程通道在调用模型前检查：`hearsayActorIds` 不得与未确认的 `perceivedCharacters` 相交；知道姓名但未认出本人的 foundation 实体必须使用 `known_entity`；欲望目标不得提前绑定当前陌生人。任何一项失败都会在外发前终止。

第三次真实 Gate 8 暴露出更深一层：顶层句柄分开仍不够，候选内部每个字段也必须按权威投影。欲望候选采用以下边界：

- `candidateId`、`driveId`、欲望描述、`desirePressure`、阻碍含义、意图连续性、`semanticFrame`、`commitmentTopic` 与动作语义提示属于人物认识层；
- `targetCharacterId`、实际听者、身体动作对象、物件句柄、`affordanceId`、当前 impact 与空间绑定属于感知层；
- 不得用整份认识候选覆盖感知候选，否则记忆中的人会成为身体目标；也不得保留整份感知候选，否则眼前陌生人的公开角色会改写人物长期欲望；
- 受信任输入审计必须验证 `desirePressure.desireId/want` 与底座欲望一致，并阻止 `pursue_desired_state` 的主题或动作提示绑定到未确认身份者的当前角色。

因此，“人物想找谢真石”与“人物此刻对酒馆帮工说话”可以同时成立，且只有人物之后基于证据确认身份，二者才允许在记忆层建立联系。
