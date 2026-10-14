# v2.7 运行实现补充：Pi 式人物内核与 Grok 式世界治理

> 状态：Phase 83 伴随实现设计。本文从属于 `docs/27_no_scene_authority_world_runtime.md`。Pi 与 Grok Build 都是借鉴来源，不是 GTOWN 的正史、世界事实或人物选择权威。

## 0. 结论

```text
GTOWN
= 一个 Grok 式世界治理内核
+ N 个 Pi 式长期人物会话运行时
+ 现有五阶段 Character Agent 自主协议
```

这里的“Pi 式”和“Grok 式”描述架构特征，不表示立即接入、Fork 或重写：

- Pi 解决一个人物怎样长期保持自己的消息、上下文、记忆投影、活动 turn 和模型会话；
- Grok 式治理解决许多人物怎样经过版本、幂等、能力边界、checkpoint 和恢复，共同写入一个客观世界；
- GTOWN 的五阶段协议决定人物怎样评价、生成候选、选择、调节、表达和具身行动；
- GTOWN 的世界因果模型决定尝试的哪些表面、目标效果、失败和附带结果真正发生。

任何外部运行时都不能改写后两条。

## 1. 三层权威

### 1.1 人物层：`CharacterSessionActor`

每个人物拥有一个跨地点、跨日持续的 Actor。它是以下私有状态的唯一写入者：

- 身体、情绪和调节残留；
- 欲望、意图、挫折与自我模型；
- 主观信念、匿名人物模型和地点认识；
- 本人的关系评价；
- 记忆痕迹、召回实例、来源混淆与遗忘结果；
- 本人接受的承诺及本人对对话／共同活动的理解；
- 已提交自身行动、语言习惯使用与私有学习结果。

它只拥有“本人状态”，不拥有本人所在地点、他人物件、伤害结果、交易账目或关系对方的内心。

### 1.2 人物思考核心：现有五阶段协议

`characterAgentTurnProtocol.mjs` 继续作为唯一人物思考顺序：

```text
主观评价
→ 本人生成候选
→ 本人选择与调节
→ 本人表达规划
→ 本人具身实现
→ ActionAttempt
```

Pi 式会话循环只能承载这一协议，不能用自由工具循环跳过阶段，也不能把“工具返回最高分”当成人物选择。

### 1.3 世界层：`WorldCommitCoordinator`

所有客观改变只能由一个协调器串行提交：

- 位置和姿态；
- 物件状态、持有、转交、消耗与损坏；
- 声音、动作和物理影响传播；
- 金钱、库存、服务和工作进程；
- 伤害、天气、火势、水流与疾病；
- 公开承诺、共同活动和制度记录。

协调器只结算人物已经提交的尝试，不生成候选、不选择人物、不修改人物私有心理。

## 2. 内部端口优先于 Pi 依赖

先建立由 GTOWN 控制的 `CharacterRuntimePort`：

```ts
interface CharacterRuntimePort {
  openSession(input: CharacterSessionOpen): Promise<CharacterSessionHandle>;
  enqueueWake(handle: CharacterSessionHandle, wake: CharacterWakeEnvelope): Promise<void>;
  runTurn(handle: CharacterSessionHandle, input: CharacterTurnInput): Promise<CharacterTurnResult>;
  applyWorldOutcome(handle: CharacterSessionHandle, outcome: CharacterWorldOutcome): Promise<void>;
  checkpoint(handle: CharacterSessionHandle): Promise<CharacterCheckpointRef>;
  closeSession(handle: CharacterSessionHandle): Promise<void>;
}
```

端口合同要求：

- `runTurn` 内部必须运行现有五阶段协议；
- 返回值只能是人物私有更新提案和 `ActionAttempt`，不能直接修改世界；
- `applyWorldOutcome` 只能处理已经由世界提交的结果；
- 同一人物最多有一个活动 turn；
- 不同人物可以并行准备上下文或思考，但不能并行提交世界；
- runtime adapter 可以是当前本地实现，也可以是后续 Pi adapter；
- adapter 更换不能改变日志格式、世界协议或人物权威。

因此，未来 Pi 版本升级、API 变化或依赖移除都不会使人物正史状态失去解释能力。

## 3. Pi 式可借鉴部分

### 3.1 应用自有消息一直保留到模型边界

人物邮箱保存 GTOWN 类型，而不是提前压成 user/assistant 文本：

```ts
type CharacterRuntimeMessage =
  | WorldEvidenceDelivery
  | ActionOutcomeDelivery
  | BodyThresholdWake
  | CommitmentDueWake
  | ContinuationDueWake
  | CharacterPrivateCheckpoint
  | RuntimeControlMessage;
```

只有 `CharacterContextAssembler` 在某次人物 turn 开始时，才把相关消息转换为模型阶段输入。

### 3.2 会话与事件流

可借鉴：

- 每人物独立 session；
- 阶段开始、完成、失败和取消事件；
- 可恢复的 turn checkpoint；
- 开发期 tracing 与非正史分支；
- 模型调用边界的上下文变换。

不得借鉴为正史权威：

- 通用 Agent 自由调用世界写工具；
- 把模型消息历史当作人物完整记忆；
- 把会话摘要当成客观事实；
- 让一个人物单独回退共享世界；
- 用 steer/follow-up 在正史运行中无因果地改变人物欲望或选择。

### 3.3 工具范围

人物运行时只允许两类工具：

1. 本人私有只读／计算工具：召回、心理数学、关系评价、身体查询、语言形成；
2. `submitActionAttempt`：把本人已经选择的尝试交给世界协调器。

文件系统、网络、进程、数据库和世界状态对象都不能作为人物 Agent 的同权工具暴露。第三方运行时缺少 sandbox 时，由 GTOWN 宿主边界限制，而不是依赖 Prompt 自律。

## 4. `CharacterContextAssembler`

它是人物模型上下文的唯一出口，对应 Pi 式 context transform，但服从 GTOWN 认知边界。

输入来源：

- 本次 wake provenance；
- 本人事件回执中仍新鲜或仍有独立义务的证据；
- 经过本人感知工具形成的 `SituationProjection`；
- 本人拥有并在本次真正召回的记忆；
- 本人身体、情绪、欲望、意图和调节残留；
- 本人对他人、地点、关系和社会事实的当前认识；
- 当前世界提供的中性物理条件、资源、物件和行动材料；
- 本人已结算行动与世界反馈。

禁止输入：

- 全局世界日志全文；
- 未送达、未注意的其他地点事件；
- 其他人物私有日志、心理数值或候选；
- 服务器真实身份映射；
- Director、Writer 或作者预设的场景答案；
- Pi/Grok 自身运行遥测中的“建议动作”。

Assembler 可以压缩上下文，但压缩结果带有：

```ts
{
  authority: "derived-context-cache",
  sourceEventIds: [],
  sourcePrivateEntryIds: [],
  createdAtWorldVersion,
  disposable: true,
}
```

它不是人物记忆的唯一来源，也不能写回世界。

## 5. 三本账，而不是一份万能会话历史

### 5.1 `WorldEventJournal`

只保存客观已提交事实、失败尝试及因果父项，是世界回放权威。

### 5.2 `CharacterPrivateJournal`

每个人物单独追加，保存：

- 收到／注意／评价／消费的世界 evidence 引用；
- 本人的主观评价和信念操作；
- 私有候选、选择、调节与表达规划；
- 由已提交结果产生的本人状态更新；
- 人物 checkpoint 与日志 cursor。

它可以引用 `worldEventId`，但不能宣告新世界事实。

### 5.3 `ModelContextCache`

模型消息、压缩摘要和阶段缓存。它可删除、重建或因模型 adapter 更换而失效，不属于正史。

Observer／Writer／UI 另行从世界日志和已允许公开的角色表面读取，不属于以上任何写入权威。

## 6. 世界提交协议

每次尝试至少包含：

```ts
{
  attemptId,
  actorId,
  sourceAgentTurnId,
  expectedWorldVersion,
  primitive,
  parameters,
  attemptSurface,
  intendedEffects,
  idempotencyKey,
}
```

协调器按顺序执行：

1. 检查 `attemptId`／`idempotencyKey` 是否已经提交；
2. 比较 `expectedWorldVersion` 与最新版本；
3. 若世界已变化，返回冲突和新的局部事实，不替人物换动作；
4. 在最新世界状态上重新验证物理条件、资源、距离和目标；
5. 分别结算尝试表面、成功目标、失败目标与附带影响；
6. 追加 `WorldEventJournal`；
7. 生成逐人物物理传播与事件回执；
8. 向行动者投递幂等 `WorldOutcome`。

版本冲突不等于人物选择错误。人物 Actor 可以根据新证据继续原意、改手段、放弃、恼怒或误解，仍由本人下一轮决定。

## 7. 崩溃恢复与分支

### 7.1 Actor checkpoint

至少保存：

```ts
{
  characterId,
  privateJournalCursor,
  lastConsumedWorldVersion,
  activeAgentTurnId,
  activeTurnPhase,
  pendingAttemptId,
  modelContextCacheRef,
}
```

恢复规则：

- ActionAttempt 尚未进入世界日志：丢弃未提交世界效果，可从同一 wake 重建人物 turn；
- ActionAttempt 已提交但 Actor 未收到结果：按 `attemptId` 重投同一 WorldOutcome；
- Actor 已应用结果但 checkpoint 尚未刷新：私有日志幂等键阻止重复学习；
- 世界日志与人物 checkpoint 不一致时，以世界日志决定客观事实，以人物私有日志决定本人已经处理到哪里。

### 7.2 分支

- 单人物会话分支只用于调试，不形成正史；
- 正史世界分叉必须从同一 `worldVersion` 复制完整世界日志、所有相关人物 checkpoint 和持续进程；
- 不允许只回退一个人物，让其带着未来记忆进入旧世界。

## 8. 调度与并发

Wake Scheduler 只投递 `CharacterWakeEnvelope`：

```ts
{
  wakeId,
  characterId,
  causeType,
  evidenceIds,
  obligationIds,
  dueAtSeconds,
  basedOnWorldVersion,
}
```

它不能携带候选、目标台词或“应该做什么”。

并发规则：

- 多个人物可并行进行感知投影、记忆召回和五阶段思考；
- 每个人物内部串行；
- 所有 `ActionAttempt` 进入一个世界提交轴；
- 后提交者若基于旧版本，收到冲突结果并由本人重新反应；
- Director、Writer、UI 永远不能进入提交队列。

## 9. 与当前 Phase 83 的连接

截至 `60ad290`：

- P2 `WorldEventJournal` 底座已完成；
- P3/P4a 逐人物事件回执已经接入酒馆并通过生产合同；
- P5a 已把物理移动与社会许可分开；
- 附件中“P4 回执仍停在 delivered”的诊断属于早期快照，不再是当前事实。

继续顺序：

```text
P5b 社会事实／人物信念／职责与可能后果
→ P6a CharacterRuntimePort + CharacterContextAssembler
→ P6b CharacterSessionActor + CharacterPrivateJournal
→ P7 WorldCommitCoordinator + WorldActionRegistry
→ P7b Actor 只经协调器提交并接收结果
→ P8 持续活动、承诺、工作和世界进程
→ P9 酒馆数据化迁移
→ P10 多地点、多人物、跨日验收
→ P11 非正史 Pi adapter 试验
```

当前阶段不安装 Pi，也不引入 Grok Build 依赖。

## 10. Pi adapter 后置试验

只有以下内部合同稳定后才允许试验：

- `CharacterRuntimePort`；
- `CharacterContextAssembler`；
- `CharacterSessionActor` 单写入；
- `WorldCommitCoordinator` 版本与幂等；
- 世界／人物／模型缓存三账分离；
- 崩溃恢复合同。

试验范围：

- 非正史人物；
- 非酒馆地点；
- 锁定依赖版本；
- 不提供文件、网络、进程或世界直写工具；
- 可以随时切回本地 adapter；
- 不把试验会话、摘要或分支自动晋升为正史。

最低验收：

1. 四名以上人物各自拥有独立会话与私有日志；
2. 同一人物跨三个地点保留身体、物件、欲望和承诺；
3. 任一人物都看不到别人私有状态；
4. 并发思考只产生串行世界提交；
5. 崩溃后从世界日志和人物 checkpoint 恢复；
6. Pi adapter 与本地 adapter 通过同一协议合同；
7. 结构通过不自动等于作者人物质量通过。

## 11. 永久禁止项

- 不把人物做成 Director 的 subagent；
- 不让任务完成率替代欲望、挣扎、失败和改变；
- 不让场景插件决定允许事件、人物候选或动作结果；
- 不让数学工具、调度器、Pi 工具、Grok 治理或 Validator 替人物选择；
- 不让 Pi session、摘要或 checkpoint 替代世界日志；
- 不让世界日志直接写人物信念和关系；
- 不让一个人物会话分支单独改写共享正史；
- 不因第三方 SDK 方便而复制第二套 Character Agent 协议。
