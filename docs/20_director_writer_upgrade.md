# Director 与 Writer 升级方案：外生扰动与只读收获层

## 0. 结论

Director 与 Writer 都位于人物—世界因果内核之外，但二者不能成为第二套剧情权威。

```text
Director = 从“此刻客观上可能发生”的外生事件中提出扰动
World    = 判断事件能否发生、提交事实、传播信息、结算后果
Agent    = 感知、评价、形成候选并选择自己的行为
Writer   = 只读已提交历史，提取叙事线并生成非 canonical 草稿
User     = 最终决定 Director 模式与 publication canon
```

整体阀门：

```text
用户
  │ 模式 / 扰动意图
  ▼
Director ─▶ Exogenous Event Gate ─▶ 世界裁判 ─▶ 因果模拟 ─▶ simulation canon
                                                                   │ 只读
                                                                   ▼
                                                          Sifter ─▶ Narrator
                                                                   │
                                                                   ▼
                                                        非 canonical 写作草稿
                                                                   │ 用户采用
                                                                   ▼
                                                           publication canon
```

四条硬边界：

1. Director 不写人物台词，不改人物内心，不替人物选择。
2. Director 不能凭“需要戏剧性”创造没有客观成因的事件。
3. Writer 输出永不回流 simulation canon、人物记忆、世界事实或后续 Agent prompt。
4. Writer 草稿默认不属于任何 canon；只有用户可采用为 publication canon。

## 1. 证据边界

相关研究支持“压力调节、体验管理、事后淘洗”这些设计方向，但不能被表述成“学界已经证明导演只能这样做”。本方案采用以下可借鉴机制：

- Valve 的 Left 4 Dead Director 展示了用压力与资源节奏调节体验，而不是逐句编剧情；
- Façade 展示了 drama management 的能力与可感知操控风险；
- simulated storyworld / story sifting 工作展示了从大量模拟日志中识别可讲述结构的路线；
- 这些工作提供设计先例，不替代本项目自己的因果、自然度和用户验收。

## 2. Director：只能调度可发生的外生原因

### 2.1 输入分级

Director 可读取：

- 已提交、可重放的世界状态；
- 公开或 observer-safe 的派生遥测；
- 外生事件注册表中的可用事件及前置条件；
- 预算、冷却、最近干预和用户模式。

自动模式不得用人物私有秘密、未公开信念或 observer-only 心理作为世界事件的触发原因。秘密接近度可以显示给用户或用于离线分析，但不能自动制造“正好撞破秘密”的巧合。

### 2.2 Exogenous Event Registry

每种扰动必须先注册为世界本来允许的事件类型：

```js
{
  eventType,
  causalDomain,
  requiredWorldFacts: [],
  requiredEnablers: [],
  forbiddenConditions: [],
  validTimeWindow,
  sourceEntityId,
  occurrenceEvidence,
  proposedPayloadSchema,
  consequenceResolver,
  budgetTier,
  cooldownKey
}
```

Director 只能从 `eligible=true` 的事件中选择提案。世界发生门再次核验前置条件、来源、时间窗和互斥状态；失败时记录 rejected proposal，不得偷偷换成近似事件。

例子：

- 酒馆内不能无因发洪水；只有上游持续暴雨、河位上涨、地形通路成立时，世界才可能提交“水患逼近”的外生事实。
- “药材断货”需要供应方、库存、运输或市场事件来源；不能因为谢母需要药就凭空断货。
- “亲人病危”必须来自已有场外人物与可核实病情路线；Director 不能直接写死讯。

### 2.3 戏剧遥测

遥测只解释“为什么提出扰动”，不提供“扰动必须成功”或“人物必须怎样反应”：

```text
停滞：连续一段真实时间内没有开放目标获得新证据或新阻碍
压力集中：可见压力长期只落在一个人物身上
事务老化：开放承诺或请求长期没有可观测进展
环境平线：可感知资源、客流、天气和氛围长期无变化
```

遥测必须可回放、可解释、无私密泄漏。不要把“thread 太少”直接变成强制投放事件的控制信号。

### 2.4 扰动层级

| 层级 | Director 可提议 | Director 不可决定 |
|---|---|---|
| T1 环境 | 有来源的天气、客流、噪声、价格变化 | 谁因此生气、留下或开口 |
| T2 信息 | 可追踪信件、消息、期限通知 | 人物是否相信、是否转述 |
| T3 物件经济 | 到货、短缺、损坏风险、债务到期 | 人物如何处置或是否履约 |
| T4 场外人物 | 已存在人物来访；或经人物编译器建立的新访客 | 访客或在场者的行动选择 |
| T5 危险提案 | 火源、病情报告、地质/天气危险等“危险起因” | 受伤、死亡、损失等结果 |

T5 默认需用户批准。批准的也是“危险起因进入世界”，不是某人必然受伤或死亡。后果仍由位置、感知、行为、物理过程与世界裁判结算。

### 2.5 预算、冷却与模式

- 每类事件有预算、cooldown 和重复来源限制；
- 同一未解决压力不得反复投放同型扰动刷张力；
- rejected proposal 也进入账本，便于发现 Director 是否不断尝试不可能事件。

模式：

```text
关闭：不提出扰动。
守夜：只在公开停滞越限时提出 T1/T2 最小扰动。
编剧：在预算内提出 T1–T4，但仍受发生门约束。
听令：把用户意图翻译成候选外生原因，先展示前置条件、风险和不可保证的人物反应，再由用户批准。
```

### 2.6 Director 合同测试

```text
不得生成台词或人物私有思想。
不得直改 belief/desire/relationship/body/memory。
不得指定人物行动结果。
不得撤销已提交事实。
不得从私密 observer 遥测自动生成世界巧合。
不得提交无 registry、无来源、无时间窗或缺前置条件的事件。
T5 只能提交危险起因，不能提交伤亡结果。
```

### 2.7 导演账本

observer-only 账本记录：提案、遥测依据、eligibility 检查、预算、批准者、rejected/committed 状态和实际世界后果。账本本身不进入人物记忆、八卦或世界事实；只有已提交扰动及其可感知结果可以传播。

## 3. Writer：只读历史与双 canon

### 3.1 两类 canon

```text
simulation canon  = 世界裁判已提交的事实、感知、行为与后果；不可被 Writer 改写。
publication canon = 用户采用的写作版本；可选择视角和表达，但不得反向成为模拟事实。
```

Sifter thread、Narrator 草稿、自动摘要都不是 canon。用户采用一篇文字，只改变 publication canon 状态，不改变人物曾感知什么。

### 3.2 Sifter

Sifter 从只读 story query 层识别候选叙事结构，例如：

- 开放目标在多次交互中升级；
- 行动结果与人物预期发生反转；
- 人物 belief 与客观事实形成持续反讽；
- 一条来源链接近揭露又中断。

```js
{
  threadId,
  eventIds: [],
  participantIds: [],
  arcHypothesis,
  claimCandidates: [],
  openEnds: [],
  diagnosticScore,
  scoreExplanation
}
```

`diagnosticScore` 用于排序供人查看，不是文学质量分，也不能回流 Director。

### 3.3 Narrator 与 claim-level provenance

Narrator 的每个事实性 claim 都必须标注来源，而不是只给整段文字挂一个 event id：

```js
{
  textSpan,
  claimType: "committed_fact | owned_private_state | attributed_belief | connective_inference",
  sourceIds: [],
  viewpointAccess,
  confidence,
  publicationOnly: true
}
```

- `committed_fact` 必须回到 simulation event；
- `owned_private_state` 只能在所选视角允许时使用；
- `attributed_belief` 必须明确是谁相信，而非当作世界事实；
- `connective_inference` 必须标成写作推断，不得补造可见动作、台词、物件转移或关系变化。

### 3.4 视角与受控解密

用户选择全知、人物限知或外部观察视角。Writer 可以为了 publication 文本读取授权的私有层，但这不产生新感知，不改变其他人物记忆，也不允许 Narrator 把私有因果写成所有人都知道的公开事实。

### 3.5 单向阀合同

必须自动检查：

- Writer 输出、thread 假设和 publication prose 不出现在后续 Agent/world/Director 输入；
- publication canon 的采用/撤回不改变 simulation state hash；
- unsupported factual claim 被拒绝或标记为 publication-only inference；
- Sifter 排名不触发 Director 干预。

## 4. 接入模块

```text
src/server/story/storyLogQuery.mjs
src/server/story/storySifter.mjs
src/server/story/storyNarrator.mjs
src/server/story/publicationCanon.mjs
src/server/pipeline/dramaturgyTelemetry.mjs
src/server/pipeline/exogenousEventRegistry.mjs
src/server/pipeline/exogenousEventGate.mjs
src/server/pipeline/directorAgent.mjs
src/server/pipeline/directorLedger.mjs
```

继续复用 updateBundle、impact provenance、信息来源链、observer-only 隔离和世界裁判提交机制。

## 5. 实施顺序

Director 不能先于人物—世界反馈闭环。正确顺序：

```text
C0/M0 人物底座边界
→ M1 锚定收尾 + Q1 评审协议 + W0 只读日志查询
→ M2 唯一运行权威
→ M3a 社会惯例/affordance
→ M4 连续时钟与会话锁
→ M3b 可中断 micro-plan
→ M5 行动后反馈
→ Q2–Q4 + W1/W2 + D0
→ D1 守夜 T1–T3
→ D2–D4
```

阶段验收：

- W0：查询结果只来自 simulation canon，不新建状态真相；
- W1：候选 thread 与作者人工选择做盲对比，报告 precision/recall 与分歧，不设“每天至少一条”配额；
- W2：claim-level provenance 与单向阀全绿，草稿默认 noncanonical；
- D0：遥测可重放、无私密泄漏、不会自行干预；
- D1：只开放守夜模式 T1–T3，每次提案都通过 registry/gate；
- D2：T4 新访客必须使用同一人物 foundation 流水线；
- D3：听令模式先预览，人物反应明确标注不可保证；
- D4：T5 只注入危险起因且默认需用户批准。

## 6. 指标：诊断，不设剧情配额

| 指标 | 解释 |
|---|---|
| 外生事件前置条件命中率 | committed 提案必须 100%；rejected 单独报告 |
| 干预可追溯率 | 100% |
| 私密遥测自动触发 | 0 |
| 人物内心/台词直改 | 0 |
| T5 直接伤亡结果 | 0 |
| Writer factual claim 来源命中 | 100% |
| Writer 回流 | 0 |
| Sifter 人工命中/误报/漏报 | 按固定评审集报告趋势 |
| thread 数量、停滞时长 | 仅诊断分布，不作优化目标 |

没有 thread 可能表示停滞，也可能表示平静但真实的一天；thread 多也可能只是 Director 制造噪声。任何单一数量都不能成为“活”的代理目标。

## 7. 风险控制

- **导演变编剧**：外生事件 registry + occurrence gate + 禁令合同。
- **巧合读取私密信息**：自动模式只用公开/observer-safe 遥测；秘密指标不驱动世界。
- **灾难刷张力**：预算、冷却、用户批准，且 T5 只注入起因。
- **Writer 变世界真相**：simulation/publication 双 canon 与状态哈希隔离。
- **Narrator 补造动作**：claim-level provenance，而非段落级装饰标签。
- **Sifter Goodhart**：thread 数、模式分与 Writer 自评均不进入 Director 控制目标；文学价值由外部读者/作者判断。

## 8. 资料依据

- [Mike Booth, The AI Systems of Left 4 Dead, Valve/GDC 2009](https://steamcdn-a.akamaihd.net/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf)
- [Mateas & Stern, Façade / AIIDE archive](https://ojs.aaai.org/index.php/AIIDE/article/view/18722)
- [James Ryan, Curating Simulated Storyworlds](https://escholarship.org/uc/item/1340j5h2)
- [Kreminski et al., Felt: A Simple Story Sifter](https://mkremins.github.io/publications/Felt_SimpleStorySifter.pdf)
- [Kreminski et al., Winnow](https://ojs.aaai.org/index.php/AIIDE/article/view/18903)

这些资料是设计参照，不是本项目真实感或文学质量已经通过的证据。

## 9. 本轮决定

```text
Director = eligible external cause proposal, not plot control
Writer   = read-only sifting + claim-sourced prose, not simulation authority
Canon    = immutable simulation canon + user-adopted publication canon
Metric   = diagnostic evidence, not story quotas
Start    = only after Character Agent, continuous time, and consequence feedback are working
```
