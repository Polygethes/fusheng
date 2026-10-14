# 第 11–20 回合续测：Luna high → Sol medium

从上次 Luna high 的第 10 回合存档继续，新增 10 个人物回合。第 11–15 回合使用 Luna high；按用户中途指示，第 16–20 回合切换为 Sol medium。三阶段流程，三个人物延续原模型会话。10 个行动回合，0 个维护回合。

总墙钟 64 分 19.8 秒，其中运行段合计 48 分 30.0 秒、客户端兼容排查、模型切换和中途修复间隔 15 分 49.8 秒。模型调用耗时合计 48 分 28.1 秒，运行期间调用以外 1.9 秒。32 次调用拿到完整回复，协议拒绝 2 次。调用耗时包含客户端、网络和模型，不能等同于纯推理时间。

逐轮耗时列只列完成该回合的运行段；第 18 回合早先被拒和中断的耗时已计入上方总耗时。

## 世界实际发生的内容

对白取自世界已结算的话语，身体动作取自实际视觉投递。候选、意图和被中断稿件不算世界事件。

| 回合 | 人物 | 模型 | 实际对白、动作或感知结果 | 结算 | 耗时 |
|---|---|---|---|---|---|
| 11 | 洛照 | Luna high | 听到：周珉，你要我等什么？ | success | 4 分 56.2 秒 |
| 12 | 周珉 | Luna high | “我想请你指点一下剑法，看看我还有哪里不对。” | success | 4 分 8.9 秒 |
| 13 | 谢真石 | Luna high | “那你先使一遍。” | success | 4 分 28.2 秒 |
| 14 | 洛照 | Luna high | 看到：身上可见短剑 | success | 4 分 4.1 秒 |
| 15 | 周珉 | Luna high | 脚下先错半步，随即收稳；手臂沿熟悉的剑路连走数式，最后停在收势。 | success | 3 分 23.7 秒 |
| 16 | 谢真石 | Sol medium | “起手那半步错了。不过你收得快，后面几式也稳住了。” | success | 4 分 1.7 秒 |
| 17 | 洛照 | Sol medium | “你看得准。若你此刻能完整出手，和我走一轮。” | success | 4 分 51.2 秒 |
| 18 | 周珉 | Sol medium | “真石，起手那半步该怎么改？” | success | 3 分 18.9 秒 |
| 19 | 谢真石 | Sol medium | “你先使几式给我看。看过了，我再决定走不走这一轮。” | success | 4 分 14.5 秒 |
| 20 | 洛照 | Sol medium | 她束袖的手停下，重心随即压低，脚下切出半步，双臂循着剑路接连走起数式。 | success | 5 分 59.6 秒 |

## 已修复与验证

- 观察、倾听动作中的身体表达：只投递人物明确写出的动作，按视线范围送达；没有身体表达时不会自动制造点头或转脸。没有听到声音时，已做出的可见动作仍能送达。回归测试覆盖人物桥接、世界结算和接收者收件箱。
- 关系更新格式：none 不得带维度变化；provisional／retained 必须有感知人物、来源和至少一个关系维度变化。人物仍决定是否改变关系。
- 未决认识改用明确的增量提交：未修改条目继续保留，人物可以修正、确认或驳回；旧证据不会变成本轮新观察。
- 说话伴随身体动作与单独的视觉细节也已补齐：视觉内容按视线投递，隔墙听众不会收到目光细节。此补充修复发生于最后运行段启动之后，使用第 18 回合原始提交离线重放及感官隔离回归测试验证；本表保留原运行记录，没有把重放写入历史或计为新回合。
- 18 项相关测试脚本通过，另有真实拒绝稿的完整判断流程重放、真实身体表达的世界结算重放，以及差异格式检查。
- 测试运行器支持明确指定 Codex 客户端。旧客户端恢复会话时报 paginated_threads 不受支持，改用应用附带客户端后正常接续。

此次真实样本中，观察／倾听且带非空身体表达的回合为：无，因此这项修复的正向覆盖来自回归测试。练习动作回合为 15、20。

## 运行中断与证据边界

首次启动未得到模型回复，也没有结算。Luna 段完成第 15 回合后，按用户要求中止第 16 回合生成并切换模型。第 18 回合又因程序自动保留的旧认识引用了已裁剪来源而被拒；暂停重交、修复并用真实拒绝稿离线复核后，从第 17 回合存档继续完成第 18–20 回合。只在保留展开时清理不可用引用，不改变旧判断，显式提交的非法来源仍受校验。原始运行器将终止信号记为 failed，单独的中断记录区分用户要求切换和程序修复；终止信号不计为协议拒绝，真实来源拒绝单独计入。Sol 恢复时只迁移后续调用的模型配置，人物会话标识、阶段记录和世界存档保留。

第 20 回合另有一次模型格式冲突：无声练习却填写了对话接续标记。系统只重交最终表达，已选行动保持相同，最后仍然没有台词。总计两次协议拒绝：一次程序旧来源问题、一次模型的对话标记冲突。

世界内累计推进 128 秒，实际说话 6 回合。模型变化与情境变化同时发生，这次混合样本不能用于严格比较 Luna 和 Sol 的速度或质量。

## 这次能确认什么

这次形成了“求教 → 演示 → 具体指点 → 邀约 → 再演示”的连续变化。第 16 回合对“错半步、随后收稳”的反馈，与第 15 回合实际送达的动作对应；第 20 回合洛照也执行了展示。

截至第 20 回合，双方尚未交手；演示采用通用练习结算，没有攻防接触、胜负或剑术能力的客观判定。药包与拜帖的取出、展示和交接没有触发，不能用此样本验收那些真实模型链。洛照第 11、14 回合仍在被动收集信息；切换 Sol 后虽然出现主动邀约，因模型、情境和运行修复都发生过变化，不能据此单独归因于 Sol。

模型调用仍是速度瓶颈。对白中“完整出手”等条件化措辞也仍值得人工判断；这些测试证明提交和结算情况，不代表自然度已经合格。

## 原始记录与接续存档

- [Luna 段原始报告](<run-artifacts>/luna-high-20260912/gtown-auto-three-call-shared-SE9h2W/report.json)、[Sol 第一段原始报告](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-XvjNfZ/report.json)、[Sol 修复后原始报告](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-Hog2UK/report.json)。
- [模型切换记录](<run-artifacts>/sol-medium-20260912/model-switch-manifest.json)、[用户要求中断记录](<run-artifacts>/luna-high-20260912/gtown-auto-three-call-shared-SE9h2W/interruption.json)。
- [最终世界存档](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-Hog2UK/latest-world-checkpoint.json)、[最终人物模型会话存档](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-Hog2UK/model-checkpoint.json)。

每一轮的完整原始回复：

- 第 11 回合 洛照：[001.output.json](<run-artifacts>/luna-high-20260912/gtown-auto-three-call-shared-SE9h2W/calls/001.output.json)、[002.output.json](<run-artifacts>/luna-high-20260912/gtown-auto-three-call-shared-SE9h2W/calls/002.output.json)、[003.output.json](<run-artifacts>/luna-high-20260912/gtown-auto-three-call-shared-SE9h2W/calls/003.output.json)。
- 第 12 回合 周珉：[004.output.json](<run-artifacts>/luna-high-20260912/gtown-auto-three-call-shared-SE9h2W/calls/004.output.json)、[005.output.json](<run-artifacts>/luna-high-20260912/gtown-auto-three-call-shared-SE9h2W/calls/005.output.json)、[006.output.json](<run-artifacts>/luna-high-20260912/gtown-auto-three-call-shared-SE9h2W/calls/006.output.json)。
- 第 13 回合 谢真石：[007.output.json](<run-artifacts>/luna-high-20260912/gtown-auto-three-call-shared-SE9h2W/calls/007.output.json)、[008.output.json](<run-artifacts>/luna-high-20260912/gtown-auto-three-call-shared-SE9h2W/calls/008.output.json)、[009.output.json](<run-artifacts>/luna-high-20260912/gtown-auto-three-call-shared-SE9h2W/calls/009.output.json)。
- 第 14 回合 洛照：[010.output.json](<run-artifacts>/luna-high-20260912/gtown-auto-three-call-shared-SE9h2W/calls/010.output.json)、[011.output.json](<run-artifacts>/luna-high-20260912/gtown-auto-three-call-shared-SE9h2W/calls/011.output.json)、[012.output.json](<run-artifacts>/luna-high-20260912/gtown-auto-three-call-shared-SE9h2W/calls/012.output.json)。
- 第 15 回合 周珉：[013.output.json](<run-artifacts>/luna-high-20260912/gtown-auto-three-call-shared-SE9h2W/calls/013.output.json)、[014.output.json](<run-artifacts>/luna-high-20260912/gtown-auto-three-call-shared-SE9h2W/calls/014.output.json)、[015.output.json](<run-artifacts>/luna-high-20260912/gtown-auto-three-call-shared-SE9h2W/calls/015.output.json)。
- 第 16 回合 谢真石：[001.output.json](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-XvjNfZ/calls/001.output.json)、[002.output.json](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-XvjNfZ/calls/002.output.json)、[003.output.json](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-XvjNfZ/calls/003.output.json)。
- 第 17 回合 洛照：[004.output.json](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-XvjNfZ/calls/004.output.json)、[005.output.json](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-XvjNfZ/calls/005.output.json)、[006.output.json](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-XvjNfZ/calls/006.output.json)。
- 第 18 回合 周珉：[001.output.json](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-Hog2UK/calls/001.output.json)、[002.output.json](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-Hog2UK/calls/002.output.json)、[003.output.json](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-Hog2UK/calls/003.output.json)。
- 第 19 回合 谢真石：[004.output.json](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-Hog2UK/calls/004.output.json)、[005.output.json](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-Hog2UK/calls/005.output.json)、[006.output.json](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-Hog2UK/calls/006.output.json)。
- 第 20 回合 洛照：[007.output.json](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-Hog2UK/calls/007.output.json)、[008.output.json](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-Hog2UK/calls/008.output.json)、[009.output.json](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-Hog2UK/calls/009.output.json)、[010.output.json](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-Hog2UK/calls/010.output.json)。

补充修复证据：[旧来源完整流程重放](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-XvjNfZ/full-appraisal-replay-check.json)、[第 18 回合身体表达离线重放](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-Hog2UK/speech-body-offline-replay.json)、[最终代码记录](<run-artifacts>/sol-medium-20260912/gtown-auto-three-call-shared-Hog2UK/final-fix-provenance.json)。
