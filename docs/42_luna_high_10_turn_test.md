# Luna high：10 个人物回合实测

模型：`gpt-5.6-luna`，推理档位：`high`。从初始场景开始，3 个日计划、0 个反思、7 个行动回合。全部使用真实模型输出；人物各自续接独立会话。

总墙钟 43 分 47.8 秒，其中中途诊断、修复与重启间隔 4 分 19.9 秒。两个运行段合计 39 分 27.9 秒；30 次模型调用；阶段拒绝 7 次。模型调用合计 39 分 26.8 秒，运行期间调用以外 1.0 秒。计时包含调用启动、网络与模型，不等同于纯推理时间。

本次有一次明确的中止和续测：两阶段首段在第 6 回合耗尽两次修复机会，停在 5 个已结算回合。保留全部失败稿；补上关系目标的感知句柄约束，改用现有三阶段流程，并恢复第 5 回合世界存档及同一人物模型会话，完成剩余 5 回合。模型会话保留自己的失败稿；被拒绝的第 6 回合没有写入世界。前后不是同一配置的一次无故障跑通。

公开对白仅取世界已结算的话语；候选意图和私人计划不视为已经发生的行动。

| 回合 | 人物 | 类型 | 已发生的内容或私人计划 | 世界结果 | 耗时 |
|---|---|---|---|---|---|
| 1 | 谢真石 | 私人日计划 | 酒馆杂务、恢复与安顿、适度剑术练习、酒馆日常事务、处理宗门与人情事务、休整与独处、准备返宗与考核 | 没有公开行动 | 32.2 秒 |
| 2 | 洛照 | 私人日计划 | 观察环境与整理来意、谨慎打探消息、安静休整与照看随身物件、进食饮水与休整、辨认与整理传闻、休息与自我照料、回顾所得消息并保留余地 | 没有公开行动 | 29.0 秒 |
| 3 | 周珉 | 私人日计划 | 安顿与观察、处理送药交接、日常起居、休整、思量内门去向、整理后续打算 | 没有公开行动 | 24.7 秒 |
| 4 | 谢真石 | 行动 | 从堂前移动至后院 | success：从堂前移动至后院 | 3 分 25.3 秒 |
| 5 | 洛照 | 行动 | 观察谢真石；后院有一人；身上可见短剑 | success：观察谢真石 | 3 分 41.3 秒 |
| 6 | 周珉 | 行动 | “真石兄，等我一下。” | success：从堂前移动至后院；话语已发出；话语已投递给谢真石；话语已投递给洛照；未经允准进入后院 | 2 分 21.3 秒 |
| 7 | 谢真石 | 行动 | 留意周珉的声音 | success：留意周珉的声音 | 5 分 36.8 秒 |
| 8 | 洛照 | 行动 | 观察谢真石；后院有一人；身上可见短剑 | success：观察谢真石 | 3 分 19.6 秒 |
| 9 | 周珉 | 行动 | 观察谢真石；后院有一人；可见随身物：短剑 | success：观察谢真石 | 6 分 24.6 秒 |
| 10 | 谢真石 | 行动 | “周珉，你要我等什么？” | success：话语已发出；话语已投递给洛照；话语已投递给周珉 | 6 分 38.1 秒 |

## 对这次结果的判断

- 10 个人物回合中有 7 个实际行动回合，世界内推进 11 秒；实际说出对白的回合为 2 个。完成计数不等于完成 10 轮连续对话。
- 洛照在第 5、8 回合两次观察同一人，得到完全相同的“后院有一人；身上可见短剑”。这两次观察没有带来新的线索。
- 第 7 回合模型选择倾听，同时写了转脸动作；第 9 回合周珉仍不确定对方是否听见。世界没有投递那段转脸动作，使周珉的输入缺少这个回应线索。这是需要继续修补的世界反馈问题。
- 关系引用已补上允许值；暂时关系变化必须给出维度、完整认识更新不得丢失未决项等条件，仍会引起模型重交。三阶段使表达拿到真实调节结果，但不能消除判断阶段的所有协议错误。
- 此样本不足以证明药包交接、拜帖取出和展示的真实模型链已修好；应以实际是否触发并完成那些动作来验收。

## 每轮原始反馈

- 第 1 回合 谢真石：[001.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-two-call-shared-jP6lak/calls/001.output.json)。
- 第 2 回合 洛照：[002.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-two-call-shared-jP6lak/calls/002.output.json)。
- 第 3 回合 周珉：[003.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-two-call-shared-jP6lak/calls/003.output.json)。
- 第 4 回合 谢真石：[004.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-two-call-shared-jP6lak/calls/004.output.json)，[005.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-two-call-shared-jP6lak/calls/005.output.json)。
- 第 5 回合 洛照：[006.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-two-call-shared-jP6lak/calls/006.output.json)，[007.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-two-call-shared-jP6lak/calls/007.output.json)，[008.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-two-call-shared-jP6lak/calls/008.output.json)。
- 第 6 回合 周珉：[001.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/calls/001.output.json)，[002.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/calls/002.output.json)，[003.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/calls/003.output.json)。
- 第 7 回合 谢真石：[004.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/calls/004.output.json)，[005.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/calls/005.output.json)，[006.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/calls/006.output.json)，[007.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/calls/007.output.json)。
- 第 8 回合 洛照：[008.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/calls/008.output.json)，[009.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/calls/009.output.json)，[010.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/calls/010.output.json)。
- 第 9 回合 周珉：[011.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/calls/011.output.json)，[012.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/calls/012.output.json)，[013.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/calls/013.output.json)，[014.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/calls/014.output.json)。
- 第 10 回合 谢真石：[015.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/calls/015.output.json)，[016.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/calls/016.output.json)，[017.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/calls/017.output.json)，[018.output.json](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/calls/018.output.json)。
- 第 6 回合首段未结算尝试（保留失败稿与当时已通过的中间稿）：[9 awaiting_subjective_appraisal_and_candidates](<run-artifacts>/luna-high-20260911/gtown-auto-two-call-shared-jP6lak/calls/009.output.json)，[10 awaiting_subjective_appraisal_and_candidates](<run-artifacts>/luna-high-20260911/gtown-auto-two-call-shared-jP6lak/calls/010.output.json)，[11 awaiting_subjective_appraisal_and_candidates](<run-artifacts>/luna-high-20260911/gtown-auto-two-call-shared-jP6lak/calls/011.output.json)，[12 awaiting_agent_choice_and_turn_commit](<run-artifacts>/luna-high-20260911/gtown-auto-two-call-shared-jP6lak/calls/012.output.json)。这些不是另一组已发生的对白或行动。

## 阶段拒绝与模型重交

- 修复前，两阶段，第 5 回合：awaiting_agent_choice_and_turn_commit。CHARACTER_AGENT_AFFECTIVE_INFLUENCE_LIVE_SOURCE_IGNORED（privateExpressionTrace.affectiveInfluence.sourceEmotionIds）。原稿保留在对应运行段 calls 目录。
- 修复前，两阶段，第 6 回合：awaiting_subjective_appraisal_and_candidates。CHARACTER_AGENT_RELATIONSHIP_TARGET_REQUIRED（relationshipAppraisal.targetCharacterId）。原稿保留在对应运行段 calls 目录。
- 修复前，两阶段，第 6 回合：awaiting_subjective_appraisal_and_candidates。CHARACTER_AGENT_RELATIONSHIP_TARGET_REQUIRED（relationshipAppraisal.targetCharacterId）。原稿保留在对应运行段 calls 目录。
- 修复前，两阶段，第 6 回合：awaiting_agent_choice_and_turn_commit。CHARACTER_AGENT_AFFECTIVE_INFLUENCE_SOURCE_NOT_LIVE（privateExpressionTrace.affectiveInfluence.sourceEmotionIds）。原稿保留在对应运行段 calls 目录。
- 修复后，三阶段，第 7 回合：awaiting_subjective_appraisal_and_candidates。CHARACTER_AGENT_RELATIONSHIP_CHANGE_REQUIRED（relationshipAppraisal.dimensionChanges）。原稿保留在对应运行段 calls 目录。
- 修复后，三阶段，第 9 回合：awaiting_subjective_appraisal_and_candidates。SUBJECTIVE_EPISTEMIC_POSITION_SILENTLY_DROPPED（epistemicPositions）。原稿保留在对应运行段 calls 目录。
- 修复后，三阶段，第 10 回合：awaiting_subjective_appraisal_and_candidates。SUBJECTIVE_EPISTEMIC_POSITION_SILENTLY_DROPPED（epistemicPositions）。原稿保留在对应运行段 calls 目录。

## 已接受表达与世界记录的差异

- 第 7 回合 谢真石：模型提交“脚步停住，脸转向周珉。”，但这段可见动作没有出现在 committedFacts 或 deliveries 中；世界只结算了 留意周珉的声音。不能将提交文本直接当成其他人物已看到的动作。

## 最终状态变化

```json
[
  {
    "entity": "谢真石",
    "field": "zoneId",
    "before": "hall",
    "after": "courtyard"
  },
  {
    "entity": "周珉",
    "field": "zoneId",
    "before": "hall",
    "after": "courtyard"
  }
]
```

## 核验与复现

- 每次调用参数、原始文件哈希和世界结算均已逐项核对，详见 [verification.json](<run-artifacts>/luna-high-20260911/verification.json)。这只证明执行记录可信，不代表人物表现已通过质量验收。
- 代码基准：`e9ccc52cd4ca8fea9d83c7cc444664563566db50` 加运行时的未提交改动；[首段源码哈希](<run-artifacts>/luna-high-20260911/gtown-auto-two-call-shared-jP6lak/source-provenance.json)；[续测源码哈希](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/source-provenance.json)。
- [首段完整计时及失败记录](<run-artifacts>/luna-high-20260911/gtown-auto-two-call-shared-jP6lak/report.json)；[续测完整计时及阶段记录](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/report.json)；[最终世界存档](<run-artifacts>/luna-high-20260911/gtown-auto-three-call-shared-PJPAby/latest-world-checkpoint.json)。

```text
node scripts/runV27AutomaticModelBenchmark.mjs --run --fresh --turns 10 --model gpt-5.6-luna --reasoning-effort high --call-mode three-call
```
