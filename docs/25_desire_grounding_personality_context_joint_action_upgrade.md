# Character Agent v2.4：欲望落地、性格—情境耦合与共同活动

> **2026-07-23 权威补充：** 本文的欲望落地、领域人格、自控塑形与共同活动独立同意继续有效；`venueNormPressure`、静态 `accessStatus` 或地点权限不得作为场景统一裁决。它们应按 [无场景裁决权的多地点人物世界运行时](./27_no_scene_authority_world_runtime.md) 拆为物理条件、社会事实、人物认识与预期后果。

## 1. 本次升级解决什么

本次缺陷不是一句“先演一招给我看”写得不好，而是人物在产生这句话以前，已经把自己的欲望换掉了。

洛照想亲自进入一轮有效攻防，借谢真石的剑验证自己的极限；谢真石若被真正的剑术吸引，想要的也不是站在一旁收集一份安全报告。旧运行时只给 Agent 看见欲望强度、信息收益和笼统风险，没有把“什么经验才算得到它”带进计算。于是模型把低成本的信息代理误当成欲望进展，再由语言层把这个错误决定说得完整。

v2.4 不禁止“观察”“询问”“演示”或任何词。它要求人物知道这些行为与自己的欲望究竟是什么关系：直接抵达、创造条件、有限试探、延期、回避，还是替代。人物仍可选择谨慎方案，但欲望不会因此被伪装成已经满足。

## 2. 权威边界

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| 作者底座 | 人物稳定追求、恐惧、自我认识、性格范围、欲望终点、满足条件、已确认记忆 | 当前回合答案、固定台词、固定行动 |
| 世界投影 | 当前在场者、真实旁观者、距离、传播、路线、许可、资源、物件、财物、职责、客观结果 | 人物如何理解、是否害羞、是否接受邀请 |
| Character Agent | 注意、解释、欲望落地、候选生成、调节选择、最终行动、身体实现与台词 | 宣布物理结果、替对方同意 |
| 心理数学工具 | 计算欲望激活、情绪、性格权重、候选与终点的关系、冲突、调节余量和预测范围 | 生成候选、选择最高分、改写行动、事后修正台词 |
| 世界裁判 | 判断动作能否发生、移动是否可达、物件是否改变、共同活动是否具备双方同意与物理条件 | 判断人物“应该”做什么、把失败动作降格成没发生过的 pass |

核心约束仍为：`candidateEvaluation.selection === null`。所有数学结果只是这个人物可读取的私人心理仪表。

> 当前运行时已由 v2.5 把下述流程拆成五阶段；欲望与世界边界不变，新增的是“自动语言冲动 → 数学调节 → 调节后表达计划”的严格先后关系。

## 3. 同一人物 Agent 的五阶段运行

### 阶段 A：主观评价与欲望落地

人物收到有限感知、私人记忆、关系、身体状态和完整欲望语义。除既有 appraisal 外，人物为当前真正被激活的欲望填写 `desireGroundings`：

```json
{
  "desireId": "desire_x",
  "feltWant": "此刻本人实际想得到或经历什么",
  "terminalExperience": "怎样的亲历状态才真正算数",
  "satisfactionCriteriaRead": ["本人认为本轮必须成立的条件"],
  "nonSubstitutableConditions": ["不能由旁观、传闻或他人代做替换的部分"],
  "activationState": "inactive|latent|uncertain|triggered|active",
  "activationEvidenceIds": ["本人实际注意到的线索"],
  "activationPsychologicalSourceIds": ["使该欲望在此刻变得重要的本人记忆、信念、价值、自我认识、关系或承诺"],
  "missingActivationConditions": ["底座要求但当前尚未成立的条件"],
  "immediatePull": 0.0,
  "currentlyPerceivedPossible": 0.0,
  "inhibitors": [
    { "kind": "audience|venue_norm|harm|body|duty|relationship|uncertainty|access", "strength": 0.0, "basisEvidenceIds": [] }
  ],
  "acceptableTransformations": ["place", "timing", "intensity", "disclosure", "manner"],
  "privateSummary": "不对外公开的本人理解"
}
```

作者底座提供终点和不可替代语义；人物根据当下状态解释它。数学工具不能替人物填写这份材料。

`state_activated` 欲望必须编译为 `cue_gated`，并把稳定潜力与当下激活拆开。没有人物亲自确认底座规定的线索时，它只保留低水平潜在吸引；佩剑、传闻、邀约或“以后可以验证”的机会不能冒充线索已经成立。线索是否被本人注意和相信由 Character Agent 填写，数学工具只据该主观判断计算当前压力。

### 阶段 B：人物产生候选，数学显示关系

每个 Agent 自产候选必须声明与一个或多个欲望的关系：

```json
{
  "desireRelations": [
    {
      "desireId": "desire_x",
      "relation": "direct_contact|enable|probe|defer|avoid|substitute|unrelated",
      "terminalConditionMatch": 0.0,
      "counterfactualResult": "若动作完全成功，本人实际上会得到什么",
      "preservesNonSubstitutableConditions": true,
      "confidence": 0.0
    }
  ],
  "activityProposal": null
}
```

`direct_contact` 表示动作成功本身已经进入欲望终局；`enable` 只创造条件；`probe` 只增加局部信息；`defer` 保留未来意图但本轮没有进展；`avoid` 远离终点；`substitute` 用更便宜的东西替代真正想要的经验；`unrelated` 与该欲望无关。

候选可以选择任何关系类型。工具只让差异可见，不能删除候选。

### 阶段 C：人物选择与调节

人物可选非最高预测值。若使用自控，必须同时填写 `goalPreservation`：

```json
{
  "preservedDesireIds": ["desire_x"],
  "transformedDimensions": ["place", "intensity"],
  "terminalExperiencePreserved": true,
  "acceptedDelay": false,
  "acceptedResidualFrustration": 0.0,
  "privateBasis": "为什么这是塑形而不是换目标"
}
```

自控的作用是扩大“如何做”的可选范围：换地点、减力度、等一个短时机、少暴露目的、改变动作方式。它不自动提高回避的价值，也不把直接欲望改写成信息收集。

`terminalExperiencePreserved` 描述的是人物有没有在心里保留原欲望，不是本轮动作有没有推进它。人物可以暂缓、回避，甚至先做一件与欲望无关的事，同时仍未放弃真正想要的经验；这些情况必须保留延期与残余挫折。只有把代理目标当成真正满足（`substitute`），或破坏了不可替代条件时，才不能声称终局经验仍被保留。这样，协议负责识别偷换目标，但不替人物决定现在必须追逐哪一条欲望。

同一阶段里，人物还只写一份调节前的 `automaticCommunicationImpulse`：什么事实触发了自己、此刻感觉被要求回应什么、最先想表达或压住什么，以及披露与抑制压力。它不是台词，也不是数学工具的输出。

### 阶段 D：人物在调节结果之后规划表达

心理数学工具先根据人物自己选择的调节策略计算控制余量、成本与残余泄漏。随后仍由同一个人物 Agent 决定原冲动是被表达、遮掩、转向、延迟、压住还是混合，并形成调节后的开口动作、最低公共增量、潜台词和交接点。数学只给出内心数值状态，不能替人物写这份计划。

### 阶段 E：人物用身体和嗓子实现

人物只实现已选行动，不再重建理由。情绪可以进入目光、停顿、呼吸、动作速度、声线与措辞；不要求把情绪解释成台词。世界收到的是实际话语、动作尝试和可能的共同活动操作。

## 4. 欲望关系计算

对欲望 `d`、候选 `a`，人物填写的关系经过结构校验后形成：

- `C_d(a)`：终局直接接触，范围 `0..1`；
- `E_d(a)`：使能进展，范围 `0..1`；
- `P_d(a)`：局部试探，范围 `0..1`；
- `F_d(a)`：延期，范围 `0..1`；
- `A_d(a)`：回避，范围 `0..1`；
- `S_d(a)`：替代，范围 `0..1`；
- `M_d(a)`：不可替代条件匹配，范围 `0..1`；
- `D_d`：当前欲望激活。

关系上限由类型给出，不由一段漂亮解释突破：

```text
direct_contact: 1.00
enable:         0.58
probe:          0.24
defer:          0.04
avoid:         -0.32
substitute:     0.08，并另计替代代价
unrelated:      0.00
```

候选对欲望的即时进展为：

```text
G_d(a) = D_d × confidence × M_d(a)
         × relation_cap(relation) × terminalConditionMatch
```

对 `enable` 与 `probe`，`terminalConditionMatch` 表示它们对未来终点的真实帮助，不表示本轮满足。信息收益 `I(a)` 保留为独立正向因子，不能再写进 `G_d(a)`。

替代暴露量：

```text
Proxy_d(a) = D_d × S_d(a) × (1 - terminalConditionMatch)
```

候选总效用只作为预测：

```text
U_p(a) = Σ_d G_d(a)
       + w_E,p,domain × enablingProgress(a)
       + w_I,p,domain × informationGain(a)
       + emotionCompatibility + valueFit + relationshipMeaning + continuity
       - bodyCost - harmRisk - venueNormCost - audienceExposure
       - dutyCost - uncertaintyCost - switchingCost
       - w_proxy,p,domain × proxySubstitution(a)
       - repetitionWithoutGain(a)
```

输出仍包含每项贡献、范围与冲突，且 `selection: null`。

### 欲望连续更新

只有人物在下一轮注意并评价到结果，欲望才更新：

```text
D_d(t+1) = clamp(
  D_d(t)
  + cueActivation
  + urgencyGrowth
  + blockedFrustration
  - appraisedTerminalSatisfaction
  - naturalAdaptation,
  0, 1
)
```

`probe` 获得信息可以降低不确定性，但不会自动降低终局欲望；若连续探查没有更接近终点，`blockedFrustration` 与 `repetitionWithoutGain` 上升。

## 5. 性格 × 领域 × 状态 × 情境

人物不是一组全局“谨慎／直接”的刻度。稳定倾向必须保留作用域，例如：

- `martial`: 交手、武器、技艺验证；
- `social`: 颜面、搭话、陌生人、公开表达；
- `duty`: 经营、照顾、承诺与职责；
- `body`: 疼痛、疲劳、疾病与恢复；
- `relationship`: 亲密、信任、地位与背叛；
- `economic`: 财富、价格与物质收益。

对因素 `f` 的有效权重：

```text
w_eff(p,f,a) = clamp(
  w_base(f)
  × [1 + Σ_k trait(p,k,domain(a)) × scopeFit(k,domain(a)) × stateGate(k) × contextRelevance(k,a)],
  0.35 × w_base,
  1.80 × w_base
)
```

同一个高自控人物在不同领域可以产生不同结果：武艺领域可能更准确地控制力道并直接接近；亲密关系领域可能压住追问；经营职责激活时可能先协调店务。人格不给出行动答案，只改变人物对收益、风险和调节能力的私人体验。

## 6. 社会压力与场所事实拆分

世界向人物提供以下独立事实，不再输出一个含混的 `publicness`：

- `directParticipantIds`：本次动作的共同参与者；
- `thirdPartyObserverIds`：能够实际看见／听见且不属于活动参与者的人；
- `observerNoticeProbability`：由距离、遮挡、光照、噪声和注意状态决定；
- `venueNormPressure`：酒馆对打斗、喧哗、闯入后院等行为的规则压力；
- `propertyRisk`：桌椅、酒水、客人和建筑可能受损；
- `dutyConflict`：人物当前经营、照顾、交接等职责冲突；
- `accessStatus`：公开、受限、获准、随行可进入或不可达。

实际旁观压力：

```text
AudienceExposure(a) = Σ_o noticeProbability(o,a) × perceivedConcernAbout(o) / max(1, observerCount)
```

目标本人不是第三方旁观者。只有两名参与者在堂前时，普通观众注视压力接近零；酒馆规矩和财物风险仍可存在。

## 7. 共同活动与许可

交手、合作、带路和跟随不是一个人物的单边动作。新增通用 `sharedActivity` 状态：

```json
{
  "activityId": "activity:...",
  "kind": "spar|escort|cooperate|joint_task|custom",
  "initiatorId": "char_a",
  "participantIds": ["char_a", "char_b"],
  "status": "proposed|countered|accepted|refused|coordinating|active|completed|abandoned",
  "requestedZoneId": "courtyard",
  "boundaries": { "intensity": "controlled", "propertyProtection": true },
  "consentByCharacterId": { "char_a": "accepted", "char_b": "pending" },
  "accessGrantIds": [],
  "sourceActionIds": []
}
```

规则：

1. 发起者只能提出，世界不能替对方接受。
2. 被邀请者必须实际收到提议，再由自己的 Agent 接受、拒绝、反提条件或回避。
3. 反提条件会生成修订后的活动条款：反提者视为接受自己提出的新条款，其余参与者重新成为 `pending`；下一回合优先交给真正拥有答复权的人。
4. 双方接受后才形成 `shared_intention`。
5. 有管理权限的人可以通过接受、带领或明确许可产生有范围、人物和时限的 `accessGrant`；不能把后院永久改成公共区域。
6. 移动、拔剑、交手仍是后续实际动作，接受邀请不等于已经到达或已经交手。
7. 任何一方可因新身体状态、风险或职责撤回；世界只记录公开撤回及客观后果。
8. 普通提问、回答、打听和闲谈由对话线程承接，不创建 `sharedActivity`。共同活动只保存“话说完以后仍需要双方共同执行”的承诺，例如交手、带路、护送、合作或共同任务。

## 8. 失败动作必须成为下一轮证据

不可达移动不能在 normalizer 中变成 `pass`。世界应提交：

- 原始 `actionAttempt`；
- `status: failed`；
- 失败码与从／到位置；
- 消耗的少量真实时间；
- 只向行动者送达的本体／视觉反馈；
- 以 `agentTurnId + attemptId` 为键的短冷却。

下一轮人物可以把它理解为门被挡住、自己没获许可、路线判断错了，或选择其他解释。失败不会由世界自动变成羞耻、退缩或重试。

每次 Agent 激活使用单调 `scene.step` 生成唯一回合 id；同一秒内的不同尝试不再碰撞。

## 9. v2.4 最小迁移

1. 保留作者底座原始 `satisfactionCondition`、`progressEvidence` 和 `desiredState` 到私人 Agent 投影，不再只留下数字。
2. 在主观评价 schema 增加 `desireGroundings`；不增加模型调用阶段。
3. 在候选 schema 增加 `desireRelations` 与可空 `activityProposal`。
4. 心理工具增加关系类型计算、代理替代暴露、领域权重与目标保留账本；继续禁止任何选择字段。
5. 世界投影拆分参与者、第三方观察者、场所规范、财物、职责和许可。
6. 增加共享活动注册表及有范围访问许可。
7. 无效移动进入世界失败结算，并通过下一轮感知反馈给人物。
8. 场景投影携带 `runtime.step`，保证 Agent 回合唯一。

本轮不把“洛照提出交手”“谢真石接受”“去后院”写成固定答案。它们只是当前人物与情境下应当可以自然推导出的候选链。

## 10. 验收合同

### 通用合同

- 一个以真实互相攻防为终点的匿名人物：直接共同活动、请求对方单独展示、继续观察三者必须显示不同的终局接触、信息收益和残余欲望；数学不得选择。
- 同一稳定人物在“无第三方观察者／多人注视”“武艺领域／亲密关系领域”“精力充足／受伤疲劳”下产生不同权重，但保留同一个人可辨识的倾向。
- 高自控可以降低力道、换地点或延迟，却不能把终局欲望自动改写成观察。
- 共同活动必须经历提议与另一人物回应；单边提议不能创建双方同意。
- 有范围许可只能开放指定人物、位置和时间；过期或无许可的移动仍失败。
- 同秒两个 Agent 激活拥有不同 id；失败移动生成可感知失败结果，不变成 pass。
- 使用完全非酒馆、非仙侠人物与场景运行同一合同，证明能力可泛化。

### 酒馆连续质量测试

- 只投影洛照、谢真石现有底座、私人记忆、关系、当前身体与酒馆客观状态；不加入预期台词和预选行动。
- 至少完成四轮双 Agent 连续互动；v2.5 调用上限为 `5 stages × 8 activations = 40`。
- 检查欲望关系账本、真实旁观者、共同活动状态、路线和世界结算是否连续。
- 自动合同只判断结构、事实和因果。人物是否真实、情绪是否可感、话语是否自然，仍由作者独占接受权。

## 11. 明确不做的事

- 不用关键词禁令修补“演”。
- 不给洛照或谢真石写场景专属行动表。
- 不让数学取最高分替人物选择。
- 不因酒馆是公共场所就凭空制造观众。
- 不因提议成立就替另一人物同意。
- 不把本地合同 GREEN 或远程模型输出自动晋升为人物正史。

## 12. 本地实现与回归结论

v2.4.1 当时接入了四阶段 Character Agent、心理工具、世界投影与因果场景；v2.5 已在此基础上把表达规划独立为第五阶段：

- 欲望终点、满足条件、进展证据和不可替代条件会进入人物私有投影；候选必须说明自己是直接接触、使能、试探、延期、回避还是替代。
- `enable` 与 `probe` 不再增加本轮终局满足；信息收益单独计算，数学结果继续保持 `selection: null`。
- 性格权重按行动领域计算；自控只能由人物用于地点、力度、时机、披露和方式的塑形，不能自动把欲望改成保守代理。
- 直接参与者与第三方观察者分开；没有第三人时 audience exposure 为零，酒馆规范、财物风险和职责冲突仍独立存在。
- 共同活动需要提议与另一人物回应；后院只可由有权限者发出限定人物、区域与时限的访问许可。
- 反提议会转移答复权、调度义务与修订条款；原提议不会继续作为另一个未解决请求残留。
- 条件性欲望的稳定潜力与当下激活已分离；未经本人确认的高明剑术线索不会再把谢真石自动唤醒为“索取单方展示”。
- 不可达动作保留为失败尝试，并向行动者返回可感知反馈；同一秒内的连续 Agent 激活使用不同回合身份。
- 跨时段请求按“线程＋请求者＋回应者”统一身份，防止同一问题被场景锁与持久线程重复建立、回答后仍卡住时间。

语言层维持认知、记忆、表达与世界事实的分层：错称呼、说错、欺骗或调戏可以真的被人物说出口，世界不替人物审查台词；关系语用异常会作为诊断与后续可感知事实保留。物理移动、物件持有与共同活动同意仍由世界裁判结算。

首次 v2.4 四轮真实样本完成 32 次调用后，作者拒绝了“先使一招、不交锋”的人物判断；完整世界审计同时发现反提议后答复权丢失、协调失败和后院许可断链。v2.4.1 已在本地修复上述根因，并让质量门把共同活动协议失败判为 `system_audit_failed`，不再误报为可供作者评审。

本地验收已通过欲望落地、条件性欲望激活、社会情境、反提议答复权、共同活动调度、限定访问许可、心理学习、五阶段 Agent、非酒馆泛化、正式酒馆场景、关系方向、世界失败反馈、跨时段对话、记忆持久化、访客生命周期、语法和隔离输入审计。此结论只证明结构与因果合同成立；修复后的人物质感仍需新的、当次明确授权的真实模型四轮样本由作者判断。
