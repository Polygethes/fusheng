# Stanford Generative Agents（Smallville）参考基线

> 状态：外部一手来源调研与 GTOWN 工程参考矩阵  
> 调研日期：2026-08-30  
> 使用范围：为“人物能够连续、自然地产生对话与行为”提供架构和评测参照；不是斯坦福官方认证，也不是对 GTOWN 当前完成度的声明。

## 0. 结论先行

“斯坦福小镇”的真正参考价值，不是让语言模型直接续写一段看起来像小说的文本，而是把人物放进一个持续运行的闭环：人物只感知局部世界，把经历写入自己的记忆，按当前情境检索，形成反思和跨时间计划，在新事件出现时决定继续、交谈或改计划，最后由世界执行移动与物件状态变化。作者公开代码的主循环明确调用 `perceive → retrieve → plan → reflect → execute`；论文则把记忆、检索、反思和规划描述为相互反馈的架构。[论文 §4](https://arxiv.org/html/2304.03442#S4)；[官方代码 `persona.py`](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/persona.py#L167-L209)

因此，GTOWN 的完成标准不能只是“能生成台词”，而应同时满足：

1. 台词和行为来自人物实际得到的局部证据，而不是全知场景答案；
2. 过去经历能被有来源地召回，并影响当下选择；
3. 人物有跨时间计划，也能因新感知而重排计划；
4. 对话由相遇、关系、当前活动和双方各自记忆触发，双方都保有回应或结束的权利；
5. 行为必须落回空间、时间、物件和他人，产生可回放的世界后果；
6. “自然、可信”最终需要真实模型连续样本和盲评，不能只由结构化合同自证。

原论文**没有公布一个可以照抄的官方 pass/fail 标准**。它报告的是人类可信度排序、消融比较，以及一次 25 人物、两天模拟的描述性社会指标；论文还明确说现有评测时间短、其人类基线不是最高水平，未来仍需建立严格 benchmark。[论文 §6](https://arxiv.org/html/2304.03442#S6)；[论文 §7](https://arxiv.org/html/2304.03442#S7)；[论文 §8.2](https://arxiv.org/html/2304.03442#S8.SS2)

## 1. 一手来源与证据边界

| 来源 | 本文用来确认什么 | 不能据此声称什么 |
|---|---|---|
| [UIST 2023 原论文（arXiv v2）](https://arxiv.org/html/2304.03442) | 架构、实验设计、消融结果、两天模拟结果、已知错误与限制 | 不能把一次实验结果当作所有系统的官方门槛 |
| [论文作者官方代码仓库](https://github.com/joonspk-research/generative_agents) | 实际模块、调用顺序、感知范围、对话循环、路径执行、保存与回放方式 | 代码仓库不是认证套件；README 没有定义质量 benchmark |
| [Stanford HAI 官方项目说明](https://hai.stanford.edu/news/computational-agents-exhibit-believable-humanlike-behavior) | 研究团队对主要技术贡献、评测和异常行为的官方概述 | 新闻页是研究说明，不替代论文方法与数据 |

本文没有使用搜索摘要、媒体转述或第三方复刻项目作为证据。仓库链接指向作者账号 `joonspk-research` 的公开代码；读取的是 `main` 分支在调研日可见的版本，后续分支变化应重新核对。

## 2. Smallville 实际实现了什么

### 2.1 核心是持续认知—行动循环，不是一次性场景生成

公开实现中，每个人物保存空间记忆、关联记忆和短期 `scratch` 状态；每个时间步更新位置与时间，然后依次感知、检索、规划、反思和执行。新的一天会触发长期日程规划。[官方代码 `persona.py`](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/persona.py#L27-L44)；[官方代码 `persona.py`](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/persona.py#L167-L209)

```text
局部世界
  → 感知并写入本人记忆
  → 以当前事件为焦点检索
  → 继续原计划 / 交谈 / 等待 / 重排计划
  → 必要时形成带证据的高层反思
  → 把计划落实为坐标、动作与物件状态
  → 下一时间步再次感知后果
```

一个容易忽略的实现细节是：论文用反馈图描述整体关系，但公开代码在单次 `move()` 中先 `plan`、后 `reflect`。因此本轮新生成的反思通常服务于后续轮次，而不是倒过来改写本轮已经选定的动作。[论文 Figure 5 / §4](https://arxiv.org/html/2304.03442#S4)；[官方代码 `persona.py`](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/persona.py#L198-L209)

### 2.2 感知是人物局部的，并受空间、注意带宽与重复抑制约束

人物先按视觉半径取得附近格子，只接收同一 arena 内、距离最近且不超过注意带宽的事件；`retention` 用于避免每个时间步重复记住同一事件。新感知还会更新该人物自己的空间树，而不是直接获得全地图最新状态。[官方代码 `perceive.py`](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/perceive.py#L23-L96)；[论文 §5.1](https://arxiv.org/html/2304.03442#S5.SS1)

论文明确指出人物并非全知：每个人拥有自己逐步学到的环境子树，离开某处后信息可能过时，重新进入才更新。[论文 §5.1](https://arxiv.org/html/2304.03442#S5.SS1)

**对 GTOWN 的含义：**“人物为什么开口或行动”必须能追溯到本人的回执、注意和召回；不能因为世界日志里存在某事实，就默认所有人都知道。

### 2.3 记忆流不是聊天历史，而是有时间、重要度、向量与来源关系的经历记录

论文中的 memory stream 保存自然语言经历、创建时间和最近访问时间；基本条目包括本人行为、他人行为与物件事件。检索把当前情境作为查询，组合近期性、重要性和相关性，再取上下文窗口可容纳的高分记忆。[论文 §4.1](https://arxiv.org/html/2304.03442#S4.SS1)

公开实现也分别计算：

- `recency`：随次序衰减；
- `importance`：使用记忆的 poignancy；
- `relevance`：焦点与记忆 embedding 的余弦相似度；
- 归一化后加权排序，再返回高分节点。

[官方代码 `retrieve.py`](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/retrieve.py#L121-L179)；[官方代码 `retrieve.py`](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/retrieve.py#L182-L234)

论文正文给出的实验性公式把三项等权相加，而当前公开代码里还叠加了实现权重；这说明应借鉴的是“多因素、情境相关检索”这一机制，不应把某组数字误当永恒标准。[论文 §4.1](https://arxiv.org/html/2304.03442#S4.SS1)；[官方代码 `retrieve.py`](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/retrieve.py#L210-L228)

### 2.4 反思把多条经历综合成高层认识，并保留证据指针

反思不是每轮固定生成。论文实现按新事件重要度累计触发，阈值为 150，实际约每天两三次；系统先从近期记忆提出值得思考的问题，再检索相关记忆，形成更高层洞见，并把反思重新写入记忆流。[论文 §4.2](https://arxiv.org/html/2304.03442#S4.SS2)

公开代码会为每条洞见保存其证据节点 ID，之后反思也可参与新的检索与更高层综合。[官方代码 `reflect.py`](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/reflect.py#L19-L49)；[官方代码 `reflect.py`](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/reflect.py#L92-L121)

**对 GTOWN 的含义：**关系判断、自我认识和长期意图可以是人物推论，但必须与客观事件分层，并保留“由哪些本人记忆推得”的来源。

### 2.5 计划先覆盖长时间，再逐层细化；反应会修改余下计划

论文首先生成一天 5–8 个大块计划，再分解为小时级和 5–15 分钟级行动。计划含地点、开始时间与持续时间，也进入记忆流供后续检索；人物感知到新事件时决定继续原计划还是反应，并从反应发生处重新生成余下计划。[论文 §4.3](https://arxiv.org/html/2304.03442#S4.SS3)；[论文 §4.3.1](https://arxiv.org/html/2304.03442#S4.SS3.SSS1)

公开代码在新日生成长期计划，在当前动作结束时确定下一个细分动作；随后从新感知里选择一个焦点，决定交谈、等待或不反应。[官方代码 `plan.py`](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/plan.py#L422-L455)；[官方代码 `plan.py`](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/plan.py#L850-L915)

**对 GTOWN 的含义：**自然行为既不能每轮失忆式随机选择，也不能被日程锁死。需要同时证明“延续自己的事”和“因真正注意到的新事改变行为”。

### 2.6 对话是感知和计划中的一种社会反应

论文的对话流程不是先生成一整场作者剧本：发起者根据对方、关系记忆、当前活动与预定反应生成开场；被回应者从自己的视角重新检索关系与上一句，再决定回应，直到一方结束。[论文 §4.3.2](https://arxiv.org/html/2304.03442#S4.SS3.SSS2)

公开代码进一步显示：

- 是否交谈要先经过 `generate_decide_to_talk`，并检查睡眠、当前对话、冷却等条件；
- 双方轮流用各自检索到的关系、当前活动和最近对话生成一句；
- 任一方可返回 `end`；循环还有有限上限；
- 成功建立对话后，双方都获得同步的聊天活动、时长与对话记录。

[官方代码 `plan.py`](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/plan.py#L638-L735)；[官方代码 `converse.py`](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/converse.py#L95-L163)；[官方代码 `plan.py`](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/plan.py#L786-L826)

**对 GTOWN 的含义：**自然对话的最小单位不是“系统替角色写一句”，而是“人物在有资格注意和回应时得到一次自主选择机会”。拒答、转开、沉默、结束都可以自然；被调度器漏掉回应机会不可以。

### 2.7 世界负责把意图接到空间与物件后果

Smallville 的服务端维护人物位置、当前动作和正在交互的物件；每个时间步读取人物输出、移动人物、更新物件状态，再把可见范围中的人物和物件送回各人物。[论文 §5](https://arxiv.org/html/2304.03442#S5)

地点和物件用包含树接到自然语言推理；动作先选区域、子区域和叶节点，再用传统路径算法移动。执行模块还会避开已被人物占用的候选格，并把动作说明与目标地址一起返回。[论文 §5.1](https://arxiv.org/html/2304.03442#S5.SS1)；[官方代码 `execute.py`](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/execute.py#L14-L148)

官方仓库支持保存、从已有模拟续跑、调试回放和压缩后的演示；每个游戏 step 代表 10 秒。[官方 README](https://github.com/joonspk-research/generative_agents/blob/main/README.md#L30-L65)

## 3. 原论文怎样评测，而不是我们想象它怎样评测

### 3.1 受控评测：访谈 + 消融 + 人类可信度排序

研究者在完整架构运行两天后“访谈”人物，用五类问题检查自我知识、记忆、计划、反应和反思，每类五题。100 名评审者在同一人物上比较五种条件：完整架构、三种逐步移除观察/反思/计划的消融条件，以及看过人物回放后由人类代演撰写的回答。评审任务是按 **believability** 排序，分析使用 TrueSkill、Kruskal–Wallis 和后续检验，而不是逐题判定官方通过或失败。[论文 §6.1–§6.4](https://arxiv.org/html/2304.03442#S6)

完整架构获得最高 TrueSkill 评分（`μ=29.89, σ=0.72`），移除反思后次之，继续移除规划后再下降；这证明论文条件下这些模块对可信度有因果贡献，但不产生可移植的绝对合格线。[论文 §6.5.1](https://arxiv.org/html/2304.03442#S6.SS5.SSS1)

### 3.2 端到端评测：一次两天社会模拟的描述性测量

研究者让 25 个人物连续互动两个游戏日，观察三个社会结果：[论文 §7](https://arxiv.org/html/2304.03442#S7)

| 观察维度 | 原论文测量方法 | 论文报告结果 |
|---|---|---|
| 信息传播 | 初始只有发起人知道竞选或派对；两天后访谈所有人物，并回查具体对话，排除凭空声称 | 竞选信息从 1 人到 8 人；派对信息从 1 人到 13 人 |
| 关系形成 | 前后分别询问人物是否认识其他每个人；只有双方都声称认识才形成无向边 | 网络密度从 `0.167` 升到 `0.74`；453 个关系回答中 1.3% 被判为幻觉 |
| 协调 | 已听到派对的人还需计划，并在正确时间地点实际到场 | 12 名受邀者中 5 人到场；未到场者有冲突或没有形成到场计划 |

以上方法和数据来自[论文 §7.1.1–§7.1.2](https://arxiv.org/html/2304.03442#S7.SS1)。这些数字是一次实验的结果，不是作者宣布的产品 SLA。

## 4. 为什么不存在可照抄的“Stanford pass/fail”

以下结论是对已查一手来源的范围判断：

1. 受控实验要求参与者排序可信度，并报告条件间统计差异；没有给每条对话或每次行为设绝对通过分数。[论文 §6](https://arxiv.org/html/2304.03442#S6)
2. 端到端实验报告传播率、关系密度和到场人数；没有声明“达到 52% 传播或 5/12 到场即为合格”。[论文 §7.1](https://arxiv.org/html/2304.03442#S7.SS1)
3. 作者明确说人类 crowdworker 条件只提供基本行为基线，不代表最高人类水平。[论文 §6.2](https://arxiv.org/html/2304.03442#S6.SS2)
4. 作者明确把短时间尺度、非金标准人类基线和缺少严格 benchmark 列为未来工作。[论文 §8.2](https://arxiv.org/html/2304.03442#S8.SS2)
5. 官方 README 只给出安装、运行、保存、回放、演示和自定义步骤；在所查版本中没有发布质量验收命令或官方 benchmark。[官方 README](https://github.com/joonspk-research/generative_agents/blob/main/README.md)

所以本文后面的门槛一律标为 **GTOWN 项目内标准**。它们受 Stanford 方法启发，但不能写成“达到 Stanford 官方标准”。

## 5. 原系统已经公开承认的边界

| 边界 | 一手证据 | 对 GTOWN 的直接教训 |
|---|---|---|
| 检索失败或只取到半段记忆 | 人物可能听过竞选却答不知道，也可能记得派对上的议题却不确定派对是否存在。[论文 §6.5.2](https://arxiv.org/html/2304.03442#S6.SS5.SSS2) | 不能只测“记忆已写入”；必须测正确记忆能否在需要时被召回 |
| 记忆 embellishment / 身份串线 | 人物会把同名历史人物的经历错误嫁接给邻居。[论文 §6.5.2](https://arxiv.org/html/2304.03442#S6.SS5.SSS2) | 推论、传闻、事实、谎言和来源必须分层 |
| 地点选择随知识增长而失常 | 人物后来会选酒吧吃午饭等不典型地点。[论文 §7.2](https://arxiv.org/html/2304.03442#S7.SS2) | 地点可行不等于人物、时段和社会语境上合适 |
| 物理/社会规范没有进入语言状态 | 人物会挤入单人浴室、关店后进店。[论文 §7.2](https://arxiv.org/html/2304.03442#S7.SS2) | 物理容量、营业时段、门锁等应由世界明确结算，不能靠模型常识猜 |
| 台词过分正式、人物过分合作 | 近亲对话也像礼貌公文，人物很少拒绝不合自己兴趣的建议。[论文 §7.2](https://arxiv.org/html/2304.03442#S7.SS2)；[Stanford HAI](https://hai.stanford.edu/news/computational-agents-exhibit-believable-humanlike-behavior) | “像 Stanford”不等于复制其语言缺陷；GTOWN 应单独测口语自然度、拒绝能力和人物差异 |
| 成本与速度 | 25 人物跑两天耗费数千美元 token credits，并用时数天。[论文 §8.2](https://arxiv.org/html/2304.03442#S8.SS2) | 真实模型长跑必须 checkpoint、可续跑、记录模型版本与成本 |
| 长期与鲁棒性未知 | 作者列出 prompt hacking、memory hacking、幻觉和模型偏差，且长期评测不足。[论文 §8.2](https://arxiv.org/html/2304.03442#S8.SS2) | 不应把一个漂亮短样本当成长期稳定性证明 |

## 6. GTOWN 可执行参考矩阵

下表是**目标映射，不是当前完成声明**。GTOWN 对应对象来自现有 [无场景裁决权设计](./27_no_scene_authority_world_runtime.md) 与 [人物运行时设计](./28_pi_character_runtime_grok_world_governance.md)。

| Stanford 架构/评测要素 | GTOWN 目标落点 | 必须留下的可审计证据 | 建议门禁 | 优先级 |
|---|---|---|---|---|
| 局部感知、非全知空间树 | `SituationProjection` + `PerCharacterEventReceipt` + `PlaceGraph` | 每次注意的世界事件 ID、传播通道、距离/遮挡/新鲜度、未注意原因 | 机器合同：未送达事实不得进入人物上下文 | P0 |
| 完整且私有的经历记录 | `CharacterPrivateJournal` + 本人情景记忆 | 世界事件来源、本人行动、字面台词、创建/访问时间、事实/传闻/推论类别 | 机器合同：跨人物隐私零泄漏；本人已结算行动恰好写入一次 | P0 |
| 情境相关的多因素检索 | 召回工具 + `CharacterContextAssembler` | 查询焦点、候选记忆、近期/重要/相关分、入选和落选原因 | 反事实合同：删掉关键记忆后行为或回答应可观察地改变 | P0 |
| 有证据的高层反思 | 人物私有心理/关系/自我模型更新 | 反思条目、证据记忆 ID、生成时间、是否已被后续召回 | 机器合同：反思不能伪装成客观世界事实 | P1 |
| 分层计划与事件反应 | 欲望/意图/承诺 + `CharacterSessionActor` | 长期意图、当前行动、预计时长、被何事件打断、余下计划怎样变化 | 连续性测试：不会无原因重复吃饭/重开已完成事务；也不会无视高显著事件 | P0 |
| 人物自主决定是否交谈 | 对话线程 + Character Agent 选择阶段 | 发起/回应者各自输入、选择、拒绝/沉默/结束、调度机会 | 机器合同：被注意的直接话语必获回应机会；内容仍由人物自主决定 | P0 |
| 记忆和关系条件化的轮流对话 | `discourseContext` + 各自召回 + 字面公共 turns | 每句 speaker、target、前文、触发记忆、当前共同活动、终止原因 | 真实模型盲评 + 重复/断答/角色串音诊断 | P0 |
| 意图落回世界位置和物件 | `ActionAttempt` + `WorldCommitCoordinator` + `WorldActionRegistry` | 尝试表面、目标效果、成功/失败效果、位置、物件、耗时、附带后果 | 机器合同：无瞬移、无无中生有物件、无未提交世界改写 | P0 |
| 世界后果反哺下一轮 | `WorldEventJournal` → 逐人物回执 | 单调世界版本、因果父事件、每人送达/注意/消费状态 | 回放合同：同日志得到同世界；结果能在下一次相关选择中出现 | P0 |
| 信息传播 | 对话/观察事件与人物信念 | 从初始知情者到每个新知情者的完整事件链 | 长跑指标：只把有来源传播计入，人物撒谎另行标注 | P1 |
| 关系形成 | 双方私有关系评价 + 可见交往史 | 双方各自证据和评价，不用单一全局关系数冒充双方内心 | 长跑指标：分别报告单向认识、双方认识和关系质量变化 | P1 |
| 协调与到场 | `Commitment` / `SharedActivity` / 行程与世界位置 | 听闻 → 接受/拒绝 → 写入计划 → 出发 → 到场/缺席及原因 | 长跑指标：同时报告成功、合理冲突、遗忘和调度失败 | P1 |
| 保存、续跑、审计 | checkpoint + 三本账 + replay | 模型/提示版本、随机种子、事件日志、人物 checkpoint、成本 | 发布门禁：中断后可续跑且不重放已提交后果 | P0 |

## 7. GTOWN 项目内验收协议（建议初版）

以下数值是为了让本项目能明确收口而提出的**本地标准**，不是 Stanford 官方门槛。第一次完成全链路后应保存原始样本，再根据盲评者一致性校准阈值。

### A. 硬合同：必须 100% 通过

1. 每个公开行为和台词都能追溯到人物 turn、当时局部投影与世界版本；
2. 未送达或未注意的事实不能直接进入人物上下文；初始设定、推论、传闻、欺骗和事实必须可区分；
3. 被人物注意到的直接提问、请求或攻击必须获得一次自主响应机会；回答、拒绝、回避、沉默或反击均合法；
4. 每项 `ActionAttempt` 只能由世界协调器提交一次，成功、部分成功和失败都写入日志；
5. 位置、物件、容量、耗时和在场关系不得被台词或计划直接篡改；
6. 本人已完成行为与共同经历能在下一次相关召回中出现，不重复写入；
7. checkpoint 恢复后事件 ID、世界版本和已结算后果不重复。

### B. 受控人物访谈：复用方法，不照抄分数

为每个核心人物建立 25 题题库，保持论文的五类结构：自我知识、记忆、计划、意外反应、反思。每轮从每类抽题，对以下条件做盲序比较：

- 完整运行时；
- 无反思；
- 只有近期观察、无长期计划；
- 无人物记忆的单次模型回答。

每条回答由至少 3 名不了解条件的评审者按 1–5 分评价：人物一致性、证据正确性、跨时间连续性、反应适切性、语言自然度。建议首个发布门槛为：完整运行时各维度中位数不低于 4，且在成对比较中至少 60% 被偏好于最强消融条件。必须同时报告样本量、分歧和失败样本，不能只报平均分。

### C. 连续对话与行为盲评

固定人物与世界初态，但至少运行 30 个独立真实模型窗口，覆盖：初次相遇、熟人问答、利益冲突、服务/交易、被打断的工作、共同活动、可合理拒绝的请求。每个窗口至少保留触发前状态、完整 turns、非语言动作、世界结果和后续一次召回。

建议首个发布门槛：

- 语境承接、人物声音、关系差异、行动—台词耦合、非模板感五项中位数均不低于 4/5；
- 严重故障（角色串音、无来源知情、已完成事务无解释重开、调度漏答、不可行效果被当成成功）低于 5%；
- 至少 80% 的窗口中，下一轮能看见刚才对话或行为造成的具体差异；
- 不把“礼貌地回答所有问题”当自然度；有合理动机时必须能拒绝、敷衍、误解、转开或结束。

### D. 端到端社会运行

至少运行 10 个可复现种子；每个种子从只有一个人物知道的信息、一个可选的群体活动意图、若干既有关系与日常事务开始。系统不能脚本化指定传播路径、邀请名单或到场者，只能注入初始人物记忆和世界条件。

每次运行报告：

1. 有证据的信息传播树，以及无来源声称/主动撒谎的独立计数；
2. 单向认识、双方认识和双方关系评价的前后变化；
3. 邀请、接受/拒绝、写入计划、出发、到场/缺席的完整漏斗；
4. 计划被打断和恢复的数量与原因；
5. 不合地点、违反物理状态、过度正式、过度合作、重复开场等错误率；
6. 总模型调用、token、时长、失败重试和恢复次数。

首个版本不应复制原论文的 `13/25`、`0.74` 或 `5/12` 作为门槛。建议先要求 10 个种子中至少 7 个同时出现一条可追溯的多人信息链、一次基于真实交往的双方关系变化、以及一次有接受或拒绝后果的协调活动；所有结果都必须无隐藏场景干预并可完整回放。

### E. 完成声明模板

只有同时满足以下条件，才可以说“已达到 GTOWN 的 Stanford-inspired 自然人物基线”：

- P0 架构合同全部通过；
- 真实模型连续样本达到 B/C 门槛；
- 完整架构在盲评中优于消融条件；
- D 类长跑达到本项目预先登记的门槛；
- 所有失败样本、模型版本、提示版本、随机种子和人工评分均可复核。

不得写“通过 Stanford 官方标准”。更准确的表述是：

> GTOWN 已按 Park 等人的感知—记忆—检索—反思—规划—行动架构与访谈/消融/端到端评测方法，完成本项目预先登记的自然对话和行为门禁。

## 8. 对当前修复顺序的直接建议

1. **先修 P0 因果与调度断链。** 一句好台词如果来自错误知情、错误在场或漏掉对方回应，不属于可信行为。
2. **再保证检索真的影响选择。** 仅有“记忆写入成功”的合同不足以达到论文架构；要有删除关键记忆就改变回答/计划的反事实测试。
3. **把对话作为双方连续人物 turn。** 发起、回应、拒绝、动作和终止都应由各自状态生成，并写回下一轮可见后果。
4. **同时补分层计划与重规划。** 没有跨时间计划，局部自然会很快变成重复吃饭、重复问答或随机漂移；没有反应能力，人物又会像照表运行。
5. **最后用真实模型盲评收口自然度。** 自动合同负责证明没有结构性作弊；人类评审负责判断语言、关系、节奏和行为是否真的像活人。

## 9. 引用索引

- Joon Sung Park et al., [*Generative Agents: Interactive Simulacra of Human Behavior*](https://arxiv.org/html/2304.03442), UIST 2023, arXiv v2.
- 论文作者仓库，[`joonspk-research/generative_agents`](https://github.com/joonspk-research/generative_agents).
- Stanford HAI, [*Computational Agents Exhibit Believable Humanlike Behavior*](https://hai.stanford.edu/news/computational-agents-exhibit-believable-humanlike-behavior), 2023-09-21.
