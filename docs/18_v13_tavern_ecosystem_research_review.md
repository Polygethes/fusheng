# 望梯酒馆生态缸：学界与游戏界可借鉴模型调研

## 1. 调研结论

没有一篇论文或一个游戏系统，能直接提供“真实人物 Agent 的完整公式”。现有研究各自解决的是不同层：

| 问题 | 最适合借鉴的研究 |
|---|---|
| 人物相信什么、想要什么、正在坚持什么 | BDI、意图重新考虑 |
| 同样性格为何因情境而产生不同表现 | CAPS、Whole Trait、人格状态分布 |
| 事件对人物意味着什么 | CPM、EMA、OCC、FAtiMA |
| 饥饿、疲劳、疼痛怎样改变行动价值 | Homeostatic Reinforcement Learning |
| 在多个合法行为中如何选择 | The Sims / Utility AI |
| 场所与物件如何提供行为机会 | The Sims Smart Terrain / Smart Objects |
| 多人社交事务如何保持连续 | Versu Social Practices |
| 关系、历史和身份怎样影响社交意愿 | Prom Week / Comme il Faut |
| 已选目标怎样形成短行动计划 | F.E.A.R. / GOAP |
| 一个计划怎样连续、可中断地执行 | Behavior Tree |
| 人物行动与世界事实怎样分权 | Concordia |
| 多人物时间怎样自然推进 | MASON、Repast、异步离散事件模拟 |
| 记忆为何此刻被想起 | ACT-R、Generative Agents |
| 公开情绪怎样影响同场人物 | 多 Agent 情绪传播模型 |

最合理的工程方案不是任选一个，而是把这些模型按职责拼成轻量混合架构：

```text
BDI / OCC 数据分型
→ CAPS 人格—情境调制
→ EMA/CPM 事件评价
→ Homeostasis 身体驱力
→ Versu/CiF 提供社会行动
→ Utility AI 选择意图
→ GOAP 只规划短路径
→ Behavior Tree 执行
→ Concordia 式世界裁判
→ 异步事件队列推进时间
```

---

## 2. 第一优先级：应直接采用

### 2.1 BDI：分开信念、欲望和意图

[Rao 与 Georgeff 的 BDI 论文](https://aaai.org/papers/icmas95-042-bdi-agents-from-theory-to-practice/)把 Agent 分为：

- `belief`：人物相信世界怎样，不等于世界真相；
- `desire`：人物希望达成的正向状态，可同时存在多个；
- `intention`：人物经过取舍后，已经决定持续推进的目标。

[意图重新考虑研究](https://www.cs.ox.ac.uk/people/michael.wooldridge/pubs/agents2001a.pdf)进一步说明：意图不能每个 tick 清空，也不能永远坚持。只有完成、已不可能、关键事实改变、身体无法继续或替代目标持续明显更优时，才重新选择。

对项目的直接价值：

- 彻底取消 `activeGoal = commitments[0]`；
- 欲望、职责、承诺、原则和当前方案分别存储；
- 谢真石说“我自己决定”后，下一时段不能无缘无故改成“我替你接手”；
- 周珉的举荐欲望不会因一次含糊延期被自动关闭。

局限：纯 BDI 过于理性，不能解释身体、情绪、羞耻和近似选择间的自然波动。

### 2.2 Utility AI 与 The Sims：共享公式、不同权重

[Game AI Pro 的 Utility Theory](https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter09_An_Introduction_to_Utility_Theory.pdf)和[Utility Considerations](https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter13_Choosing_Effective_Utility-Based_Considerations.pdf)提供了最直接的数学工程方法：

- 原始状态先通过响应曲线归一化到可比较范围；
- 多个 consideration 共同决定一个行动的效用；
- 硬性不合法行动先排除；
- 只在高分候选附近抽样；
- 为正在执行的行为加入惯性，避免来回摇摆。

The Sims 的 Smart Terrain 更进一步：附近物件向人物“广告”自己能提供什么。[2000 年 Game Developer 资料](https://media.gdcvault.com/GD_Mag_Archives/GDM_August_2000.pdf)举例说明，冰箱广告食物、食物广告需要烹饪、微波炉广告可以烹饪，人物由需要和环境逐步形成行为。

对酒馆的直接映射：

```text
柴堆：advertise 补柴、搬湿柴、劈柴
饭锅：advertise 盛饭、添火、收灶
柜台：advertise 结账、记账、验货
门口：advertise 迎客、离店、观察来人
人物：advertise 可对话、可递交、可邀请、可回应
社会惯例：advertise 询价、付款、追问、拒绝、延期
```

人物不是在无限语言空间里乱想，而是从当前场所、关系和事务真实提供的行动中选择。

局限：The Sims 式纯即时需求选择会缺少长期意图，因此必须与 BDI 结合。

### 2.3 CPM / EMA / FAtiMA：事件的意义来自人物自己

[Scherer 的 Component Process Model](https://biblio.ugent.be/publication/4316089)与[Marsella、Gratch 的 EMA](https://stacymarsella.org/publications/pdf/EMA_Dynamics.pdf)关注的不是“事件客观上有多大”，而是人物如何评价它：

```text
relevance              与我的目标相关吗
goal congruence        帮助还是阻碍
expectedness           是否意外
agency / blame         谁造成、该怪谁
controllability        我能否直接改变
changeability          别人或环境能否改变
power                  我有多少能力和地位
urgency                延误是否恶化
norm compatibility     是否符合个人与社会规范
ego involvement        是否触及身份与尊严
```

[FAtiMA Modular](https://arxiv.org/abs/2103.03020)证明这些评价可以与记忆、目标推理和行动选择解耦成模块。

直接价值：同一句“明天再说”，周珉会评估为目标继续受阻、控制权低、期限压力升高；谢母可能评估为丈夫回避且家计风险未消失；无关客人则可能只感知气氛变化。

局限：这些理论没有给出一套普适人物权重；情绪名称也不应成为直接行动脚本。

### 2.4 身体稳态：同一行动对不同状态价值不同

[Homeostatic Reinforcement Learning](https://elifesciences.org/articles/04811)把身体驱力表示为当前内部状态与理想设定点的距离，并把行动价值定义为减少了多少偏离：

```text
Drive(H) = distance(H, H*)
BodyReward(a) = Drive(Ht) - Drive(Ht + effect(a))
```

直接价值：

- 同一碗饭对很饿的人价值高，对刚吃完的人价值低；
- 同样性格的两个人，因疲劳、疼痛或体力不同而选择不同；
- 休息、吃饭、喝水不再是随机填充动作；
- 劈柴、搬水会真实改变下一次行为成本。

局限：只能用于生理调节，不能把入内门、尊严、交手和关系认可都解释成身体稳态。

### 2.5 CAPS 与 Whole Trait：人格是 if–then 反应分布

[Mischel、Shoda 的 CAPS](https://doi.org/10.1037/0033-295X.102.2.246)把稳定人格理解为情境触发的认知—情感反应模式；[Fleeson 的人格状态分布研究](https://simine.com/407/readings/Fleeson_2001.pdf)发现，同一个人在日常情境中会表现出很大变化，但行为分布的中心和对线索的反应性具有稳定个体差异。

这为“统一公式、个人权重、动态状态”提供了直接理论依据：

```text
如果 公开、人多、兴趣可能暴露
那么 洛照的隐私成本和表达阈值升高

如果 私下、谢真石可接近、没有旁观者
那么 交手欲望更容易进入直接行动
```

人格不是“内向的人少说话”，而是：

- 对哪些线索更敏感；
- 哪些目标、记忆和情绪会被激活；
- 阈值和反应延迟多高；
- 受阻后坚持、转向还是放弃；
- 恢复得快还是慢。

---

## 3. 社会互动：最接近酒馆生态缸的先例

### 3.1 Versu：社会惯例提供行动，但不替人物决定

[Versu](https://www.cs.engr.uky.edu/~sgware/reading/papers/evans2014versu.pdf)使用 `social practice` 表示用餐、宴会、谈话等重复社会场景。它是一种反应式联合计划：维持参与角色、共同状态、可做动作和连续性，但人物仍依据自己的欲望决定是否执行。

望梯酒馆可建立：

- 住宿结账惯例；
- 送货验收惯例；
- 以工换饭惯例；
- 私下谈话惯例；
- 追问举荐惯例；
- 约战惯例；
- 午间营业惯例。

多个惯例可同时运行。它们只提供 affordance，不规定“正午谁必须出现、谁必须说哪句”。

这是解决连续事务和开放问题最值得采用的游戏界模型。

局限：Versu 的逻辑语言和完整剧情管理太重，不应照搬中央 Drama Manager。

### 3.2 Prom Week / CiF：社交动作也有意愿分和后果

[Comme il Faut](https://ojs.aaai.org/index.php/AIIDE/article/download/12454/12313/15982)把社交交换表示为：

```text
social intent
+ initiator / responder
+ preconditions
+ influence rules
+ relationship microtheories
+ social history
+ accept / reject volition
+ effects / trigger rules
```

对酒馆最有价值的部分：

- 周珉提出“给我一个明确答复”与谢真石愿不愿回应，要分别计算；
- 父子、熟客、欠情、竞争者、求举荐者等关系可以通过少量正交 microtheory 贡献权重；
- 社交动作的成功或失败会更新社会状态，并影响后续选择。

不能照搬：CiF 原系统常把社交事实视为全体可知，而且规则量可膨胀到数千条。酒馆必须保留距离、遮挡、个人记忆和八卦来源链，并严格控制规则数量。

### 3.3 社会规范：旁观者和个人原则要分开

OCC 将关切分成目标、行为标准和态度；[Bicchieri 的社会规范研究](https://doi.org/10.1177/1470594X10369276)进一步区分别人通常怎么做、别人认为我应该怎么做、违反后可能有何制裁、哪些人属于重要参照群体。

工程上应分成：

```text
PersonalStandardCost  // 无人看见时仍可能存在
SocialNormCost        // 随公开性、旁观者和制裁概率变化
PrivacyExposureCost   // 人物自己的暴露敏感
```

这正好解释洛照：交手欲望不变，但堂前、后院和院外的行动成本不同。

---

## 4. 第二优先级：选择性采用

### 4.1 GOAP：只决定“怎么做”，不决定“想要什么”

[Jeff Orkin 的 GOAP](https://static.hlt.bme.hu/semantics/external/pages/GOAP/alumni.media.mit.edu/_jorkin/GOAP_draft_AIWisdom2_2003.pdf)用行动前提、效果和成本，在世界状态空间里为已选目标搜索一条行动路径。

适合：

```text
目标：与谢真石私下交谈
计划：确认在场 → 靠近 → 邀请去后院 → 到达 → 开口
```

```text
目标：交饭
计划：确认验工 → 取碗 → 盛饭 → 靠近 → 转移所有权 → 记账
```

限制：

- 只有 Utility 层已选定目标后才规划；
- 计划只保留 2–5 个原子动作；
- 一句即时回答不调用 GOAP；
- 新影响到来时允许重新规划；
- 羞耻、关系和欲望竞争不由 GOAP 计算。

### 4.2 Behavior Tree：只做连续执行与中断

[Behavior Trees in Robotics and AI](https://arxiv.org/abs/1709.00084)强调模块化、反应性和任务切换。它适合执行一个已经选定的计划：

```text
检查紧急中断
→ 检查计划仍合法
→ 执行下一个原子动作
→ 等待完成事件
→ 成功则推进
→ 失败则回到规划器
```

它不适合决定人物欲望。若把人格、关系和所有社交分支写进树，系统会重新变成庞大的预写脚本。

### 4.3 ACT-R：只借记忆激活

[ACT-R 官方资料](https://act-r.psy.cmu.edu/)的记忆模型强调，不是全部记忆都同时可用。基础激活近似为：

```text
BaseActivation(m) = ln Σj (timeSinceRetrievalj)^(-d)
```

项目可加入当前线索、关系相关性和个人重要性；每次决策只检索：

- 当前意图；
- 当前对话对象；
- 最近三至五个感知事件；
- 一至三个被线索唤起的长期记忆；
- 当前身体和情绪摘要。

这有助于防止所有人同时处理全世界全部事实。完整 ACT-R 的毫秒认知、视觉和 production system 不适合本项目。

### 4.4 Soar：只借 operator、偏好与 impasse

[Soar 官方架构](https://soar.eecs.umich.edu/soar_manual/02_TheSoarArchitecture/)的 input → proposal → decision → application 很适合候选行动处理：

- 不合法行动：`prohibit`；
- 欲望收益与阻碍：numeric preference；
- 当前意图：`better`；
- 重复行动：`reject/worse`；
- 无法区分或无合法行动：impasse。

impasse 时可以生成“观察更多信息、询问、降低阻碍、等待”子目标，而不是输出填充动作。完整 Soar runtime 对七人酒馆过重。

### 4.5 Generative Agents：借检索与反思，不借预制日程

[Generative Agents](https://arxiv.org/abs/2304.03442)的观察、记忆、反思、计划结构及消融结果值得采用。它的记忆检索综合 recency、importance、relevance。

反思适合在同一欲望连续受阻、关系预期被违背、重要经历积累或一天结束时触发。反思只是本人的新判断，不能自动成为世界事实或其他人的知识。

不能采用“先写全天计划，再按计划决定人物何时出现”。计划只能预约未来重新评估。

---

## 5. 环境与时间

### 5.1 Concordia：人物提出意图，环境裁判事实

[Concordia](https://deepmind.google/research/publications/64717/)让人物描述行动尝试，由 Game Master 检查物理合理性并产生结果。

本项目应借这个分权，但不能让 LLM Game Master 成为世界真相：

```text
人物 Agent：提出 actor、target、intent
确定性世界裁判：检查距离、权限、物件、时间、称呼和经营状态
语言模型：在固定结果内自然表达
```

这比“让更聪明模型一次写完整场景”可靠得多。

### 5.2 MASON / Repast：异步下一事件

[MASON](https://people.cs.gmu.edu/~sean/papers/simulation.pdf)是离散事件多 Agent 模拟框架，并明确分离模型与可视化。[异步人工社会研究](https://jasss.soc.surrey.ac.uk/3/1/2.html)表明，强制同步时间片可能产生顺序伪影，异步事件更适合各自以不同速率行动的社会系统。

酒馆应使用绝对秒与事件优先队列：

```text
环境变化
→ 行动完成与物质结算
→ 影响传播
→ 私人 appraisal
→ 人物激活
→ 行动提议
→ 世界裁判
→ 状态更新
```

回答可在几秒后发生，端饭可能几十秒，劈柴几十分钟，饥饿每隔一段时间懒更新。清晨/正午只改变环境，不切断会话或重排演员。

### 5.3 情绪传播：只传播公开表达

[多 Agent 情绪传播模型](https://doi.org/10.1007/s12559-014-9277-9)常用：

```text
channel = senderExpressiveness × routeStrength × receiverSusceptibility
```

项目再乘以距离、遮挡、注意力、关系和噪声。只能传播被语气、动作、表情表现出来的情绪，不能传播 privateReason 或隐藏创伤。

---

## 6. 第一版不建议采用

### 6.1 完整 Active Inference

[Active Inference](https://pmc.ncbi.nlm.nih.gov/articles/PMC7732703/)能把偏好满足和信息增益统一到 expected free energy，但需要完整的概率生成模型、隐藏状态和策略推断。它理论漂亮，第一版却难以解释、调参与定位错误。

建议只借 `InformationGain`：人物可因不确定而选择观察或询问，不引入整套 free-energy 架构。

### 6.2 深度强化学习

酒馆没有大量可靠人类行为数据，也没有明确的单一奖励函数。直接训练容易学到“更像验收脚本”而不是真实人物，并降低可解释性。第一版用人工可解释参数和反事实校准；积累足够选择日志后，再考虑学习权重。

### 6.3 完整 ACT-R、Soar 或神经心理模型

它们适合认知研究或通用智能实验，但会显著增加状态、规则和调试复杂度。当前目标是七人、一个场景、可见因果一致，不是复刻人脑。

### 6.4 中央 Drama Manager

Façade 式戏剧管理可制造强情节，但会让中央系统为“好看”改变人物选择。这与生态缸目标相冲突。导演层最多注入天气、来客、消息等外部条件，不能决定谁必须说什么。

---

## 7. 调研后的最终技术组合

```text
人物编译层
  OCC：目标 / 标准 / 态度分型
  BDI：belief / desire / intention 分离
  CAPS：人格的 if–then 权重和阈值

运行状态层
  Homeostasis：身体需要
  EMA/CPM：事件 appraisal
  ACT-R：有限记忆检索
  ALMA：情绪 / 心境 / 人格时间尺度

行动供给层
  Smart Objects：物件与地点 affordance
  Versu：社会惯例 affordance
  CiF：关系微理论与发起/回应意愿

决策执行层
  Utility AI：统一公式选择意图
  BDI：保持当前意图
  GOAP：必要时生成短计划
  Behavior Tree：连续执行和中断

世界层
  Concordia 边界：人物提议、环境裁判
  MASON/Repast：异步事件队列
  空间传播：距离、声音、视线、注意力

表达层
  LLM：只负责已固定意图、对象和事实内的自然中文
```

一句话概括：

> Versu 告诉酒馆“此刻可以做什么”；The Sims/Utility AI 让人物决定“我更想做哪件事”；CiF 解释“对方愿不愿接受”；GOAP 决定“怎样做成”；Behavior Tree 保证行动连续；Concordia 式世界裁判决定“究竟发生了什么”。

## 8. 对现有升级方案的影响

广泛调研强化了原方案的核心，但增加了三个关键组件：

1. **Social Practice Registry**：解决接待、结账、验货、追问、约战等多人事务的连续性，不再靠时段脚本。
2. **Smart Affordance Advertisement**：把现有经营 affordance 扩展到物件、地点、人物和会话，让行动候选来自真实环境。
3. **短计划执行层**：Utility 先选欲望与意图，GOAP 只在需要时规划 2–5 步，Behavior Tree 负责完成或中断。

这些组件会纳入正式升级设计，但第一阶段仍坚持：先修人物分型、硬事实门控、统一效用公式和连续时间，再扩展短计划。
