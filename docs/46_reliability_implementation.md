# 模拟可靠性实施记录

依据 [方案 45](./45_model_independent_simulation_reliability_plan.md)，2026-09-14 实施。批次 1–4 的代码和报告路径已落地；72 项相关本地回归及语法检查通过，报告与恢复入口已验证。Luna high、Sol medium 的真实验收尚未启动，不能把以下固定回复测试当作模型质量结论。

开始时已有的 46 个未提交文件已在外层 `.gtown-run-artifacts/reliability-20260914/before/` 备份，摘要见同级 `baseline.json`。没有迁移或改写旧 100 回合存档，也没有据历史动作文字补造物理结果；存档目录未包含在该文件基线内，因此不声称做过逐文件哈希对照。

## 1. 世界事实与模型文字

- 人物协议为 v2.10。取消 `act` 自动转换为成功手势；未知操作需要人物自己修正。
- 自由动作文字进入 `authoredExpressionDraft`，保留审计用途；不能写世界、发声、移动物品或填满杯子。
- 身体动作改用有定义的操作、方向、幅度、速度；情绪表面从受支持的 cue 生成确定的视听描述。未知 cue、继承属性名和声道不匹配均不能变成物理事实。
- 世界动作注册器、能力注册器、工作和服务的直接入口都做相同处理，没有调用者自填的 trusted 旁路。
- 人物对白原样保留，包括误判、隐瞒和谎言。“柴都劈完了”可以成为话语事实，不能据此增加成柴。
- 同一休息或练习状态的连续结算不重复广播原有姿势；拿起、取出、展示、藏起、放置等描述对应实际物品操作。

首个反例在修复前确实把“第五斧落下”的散文公开；修复后的跨入口测试保证这种文字不会进入结算结果或他人感知。支持的动作范围仍然有限，未实现的表演动作需要扩充明确操作。

主要实现：[physicalExpression.mjs](../src/server/simulation/physicalExpression.mjs)、[worldActionRegistry.mjs](../src/server/simulation/worldActionRegistry.mjs)、[characterAgentTurnProtocol.mjs](../src/server/simulation/characterAgentTurnProtocol.mjs)。

## 2. 柴、水、茶、交付的实际路径

- 劈柴要求实际持有工具，完成一束仍需 42 秒；资源变化、负荷、声音和可见结果属于同一工作过程。
- 添水要求先在后院取水、持桶移动、再向灶边水缸倒水。水源、桶、水缸之间按容量转移，空桶不能开始添水。
- 初始水缸 55%、容量两桶；倒入一满桶只消耗 0.9 桶，桶内仍有 0.1 桶。满线按客观状态完成，不能为了凑次数继续计工。
- 服务沿用准备、端送、饮用的真实过程；“倒茶”草稿不能替代容器和内容物操作。
- 药包与清单各自交付；放下一个物品不会顺带移动另一个，也不等于收件人验收。

主要实现：[workCapability.mjs](../src/server/simulation/workCapability.mjs)、[serviceCapability.mjs](../src/server/simulation/serviceCapability.mjs)、[skills.js](../src/worldbuilding/skills.js)。

## 3. 三次调用、冻结阶段与有限修复

新运行采用“理解并提出候选 → 选择与调节 → 实际调节后表达”。评价器保持 `selection: null`，程序不代选行动或改写对白。

服务端保存阶段票据、输入和 schema 摘要、原始回复、接受记录与调用预算。角色无需手抄归属、回合号等固定元数据。活情绪列表与压力已经保存在冻结状态中；主观处理方式仍由人物选择。省略冗余情绪引用不能绕过公开 cue 的真实压力检查；有感受而没有外显通道时，仍可选择私下承受。

每次行动决策最多 3 次正常调用加 2 次修复，预算跨阶段和恢复保留；私人计划或反思同样最多追加 2 次修复。耗尽后标为 `suspended_model_error`，不补写替代决定。程序异常与模型格式错误分开，不能吞掉未知异常继续演出成功。

生产默认入口、网页会话、自动执行器、中继和文件桥均使用三次调用。底层四次／两次路径仅保留诊断用途；服务端环境必须显式设置 `GTOWN_V27_DIAGNOSTIC_LEGACY_CALL_MODE=1`，自动执行器必须显式传入 `--diagnostic-legacy-call-mode`，才可选择旧模式。这些诊断路径不属于新严格模式的验收范围。

主要实现：[characterTurnExecution.mjs](../src/server/simulation/characterTurnExecution.mjs)、[tavernCharacterAgentV2.mjs](../src/server/pipeline/tavernCharacterAgentV2.mjs)、[characterMaintenanceStageProtocol.mjs](../src/server/simulation/characterMaintenanceStageProtocol.mjs)。

## 4. 持久恢复覆盖实际运行入口

保存点包括收到回复、阶段接受、行动待提交、世界结算、回合完成。已接受的理解和选择从保存记录恢复；同键同文重复提交返回原结算，同键异文拒绝。旧存档缺少请求摘要时明确拒绝不可信的重复结算，不猜测其身份。

| 入口 | 实际保存与恢复 |
|---|---|
| 自动模型执行器 | 保存人物／模型检查点、阶段原始输入输出和公共回合记录；最终回合已落盘而外层报告未更新时，从检查点补回报告。 |
| 中继 | `/validate` 只预检；`/respond` 在回复与检查点落盘后返回收据，不等下个阶段。无效提交也消耗预算；重复回执去重。阶段原文保存在 `world-save.json.stages/`。 |
| 文件桥 | 保存 `runtime.checkpoint.json` 和逐阶段请求／回复；旧目录需要显式 `TAVERN_V27_BRIDGE_RESUME=1` 恢复，不能当新运行覆盖。 |
| 网页持久会话 | 每个保存点更新会话版本与执行租约，失败后保留最近阶段。原始阶段记录另存不可变 `execution-audit/`，不随只保留四份的世界快照轮换而丢失。 |

等待中的旧截止通知会带着明确的废弃原因退出队列，不会唤醒后来新登记的等待。已因预算暂停、但仍持有冻结阶段的人物，恢复时不会重新进入就绪队列。

自动 Codex 执行器已复核只读沙箱、禁工具和不加载项目配置。外部中继／文件桥只能约束提交后的行为，不能证明外部控制者没有其他文件权限；来源继续标为 `external-unverified`。通用外部控制者不能据一张收据获得进程隔离或模型身份已验证的结论。

主要实现：[characterWorldRuntime.mjs](../src/server/simulation/characterWorldRuntime.mjs)、[worldCommitCoordinator.mjs](../src/server/simulation/worldCommitCoordinator.mjs)、[worldRuntimeSessionService.mjs](../src/server/simulation/worldRuntimeSessionService.mjs)、[worldRuntimeSessionRepository.mjs](../src/server/simulation/worldRuntimeSessionRepository.mjs)。

## 5. 消息、等待、公平与停滞

- 在实际听觉条件允许时，明确对本人说的话优先呈现；同轮来自两人的话保留各自来源和时间。每次最多保护 32 条，超出部分继续待处理，不静默截断。
- 稳定持物和姿势仍在当前感知中，但不再借每次新事件重复投递为新消息。
- 已呈现、已注意、已解释、已处理与感知过期分别记录；没有呈现或过期的消息保留原始时间，不能整批清空，也不能以后冒充新近发生。
- `wait` 必须由人物选定条件、1–86400 秒期限及是否允许直接来话打断。登记后不轮询模型，只在真实条件或截止点唤醒；只有本人既有过程才能成为等待的过程对象。
- 本人的日计划截止时间进入私人上下文，人物可以据此设定等待期限；程序不强迫他遵从计划。长时固定回复测试明确选择在计划到期时结束等待。
- 普通决策连续占用机会时，到期计划／反思在最多 3 次非紧迫机会后优先调度；紧迫阻塞另行记录。
- 连续 3 次同义行动无新证据或相关效果，给本人一次私人复核；复核后仍等价空转则标为 `stalled`。实际休息恢复和已登记等待不按空转处理。暂停不等于人物认输或改变主意。
- 空闲推进不会跳到指定目标时间之后的等待截止点。时间上限只在完整人物回合之间暂停，不参与计划排队；边界上新到期的机会原序保留在检查点中，恢复后继续。已经开始的行动／待结算记录必须完成，不能把半个回合当作完成。

停滞保护针对连续同义无效行动，并不保证识别所有复杂循环，更不保证人物主动推动情节。外层人物回合预算仍是最终调用上限。

主要实现：[characterExecutionControl.mjs](../src/server/simulation/characterExecutionControl.mjs)、[characterPerception.mjs](../src/server/simulation/characterPerception.mjs)、[characterSessionActor.mjs](../src/server/simulation/characterSessionActor.mjs)。

## 6. 报告与验证边界

报告的公开对白来自真正发出的原话，动作和资源来自世界结算。私人反思、被拒草稿、尝试、部分成功和客观完成分别列出。工作完成数明确标为存档累计值；本次报告中的人物决策和模型请求按所列记录统计。

`turn_limit_reached` 只表示预算用完。尚未配置全场景统一终局判据，因此 `scenarioCompletionEvaluated=false`、`scenarioComplete=null`；柴水数量、药包／清单验收、服务容器和共同活动状态仍按客观数据展示，不能自行宣称比试或故事完成。

最终验证：**72 项相关回归全部通过**。包含核心与当前产品路径 65 项、网页入口 2 项、显式旧模式诊断 1 项、一天／七天运行与恢复 3 项、中继 1 项；语法检查另行通过。完整索引为外层 `.gtown-run-artifacts/reliability-20260914/verification-summary.json`。

当前本地验证输出位于该目录：

- `final-local-contract-results.json`：核心与当前产品路径回归。
- `long-horizon-results.json`：一天运行、一天存档重放、七天运行／重放。
- 网页会话、中继、语法检查各自保存完整日志。
- 酒馆整条固定回复流程：22 个人物回合，18 次行动决策、4 次反思、58 次阶段提供方调用、12 个世界事件，真实服务链完成。
- 一天固定回复流程：78 个人物回合、18 次计划唤醒、11 次反思；第 12 小时暂停后恢复，与连续运行的世界、事件、私人记忆、收据及回合序列一致。

- 七天固定回复流程：563 个人物回合、304 次世界行动尝试、94 次反思。三个人物均获得 7 次日计划机会；第三天暂停后恢复，与连续运行的世界、事件、人物私人状态、消息收据、待处理队列及逐回合顺序完全一致。
- 中继本地固定回复测试的首条收据为 13.8 毫秒；这是一次本机回执测量，不是模型速度基准。

这些测试验证运行约束与恢复一致性，不验证对白自然度、人物主动性或文学质量。没有把固定回复来源标成 Luna 或 Sol，也没有据此报告真实模型吞吐。

## 7. 尚待执行的真实模型验收

已完成使用新世界、Luna high／Sol medium 各最多 10 个人物回合的运行准备；当前真实模型调用数为 0。首阶段待发送内容保存在外层 `review-inputs/gtown-auto-three-call-shared-FcCWDd/first-stage-input.json`。

自动审批拒绝了 Luna 启动：要求明确授权将人物设定、私人记忆、场景感知、规则和逐阶段回复发送到已登录 ChatGPT 对应的 OpenAI 模型服务。授权问题已提出，未收到答复；两组真实测试均未启动。原始数据、实际模型标识、逐回合公开结果、修复成本与质量审阅必须在真实调用后补齐。

本记录不代表整个项目所有历史回归均已运行，也不代表旧协议存档已完成迁移；当前覆盖的是上述新严格模式、主要产品入口和明确的诊断兼容回归。
