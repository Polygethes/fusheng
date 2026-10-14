# Sol medium：10 个人物回合真实测试

状态：**完成，10/10 个人物回合**。

模型固定为 `gpt-5.6-sol`，推理等级 `medium`，通过已有 ChatGPT 登录调用 Codex CLI。使用与生产模型页面相同的持久会话处理器、人物阶段及世界结算；逐轮继续同一个世界，每个人物独立续接自己的模型会话。测试直接调用服务端处理器，没有使用浏览器点击。

初始场景为《逍遥游》望梯酒馆：洛照在门槛，谢真石在堂前。两次调用模式，开启日计划；每个回合最多三次模型请求，包含一次协议修正。候选、选择、对白、动作均由真实模型返回；测试禁止使用本地固定回复替代模型。

用户确认的口径是 10 个人物回合，日计划或反思也占一个人物回合。下表逐字保留模型的公开表达；它描述人物的动作尝试，世界结算结果另列。

| 回合 | 人物 | 模型实际对白或动作 | 世界结果 | 耗时 |
|---:|---|---|---|---:|
| 1 | 洛照 | “谢真石在这里吗？” | success；版本 1 | 145.9 秒 |
| 2 | 谢真石 | “我就是。你是谁，找我什么事？” | success；版本 2 | 168.6 秒 |
| 3 | 洛照 | “洛照。我来找你试剑。这里不合适，换个地方。” 听见对方自报身份后，她的目光在对方身上骤然定住片刻。 | success；版本 3 | 175.6 秒 |
| 4 | 谢真石 | “先别急着试。你为什么专程找我？再亮一式给我看看——真有本事，我再跟你换地方。” 她的目光转向对方佩剑与握剑的手，停留得比方才更久。 | success；版本 4 | 201.3 秒 |
| 5 | 洛照 | 她的手落向剑柄与鞘口，肩胯随即错开，开始以连鞘长剑演一式。 | success；版本 5 | 267.2 秒 |
| 6 | 谢真石 | 她的视线从剑柄移向肩胯与落脚处，紧随正在展开的剑式，没有挪开。 | success；版本 6 | 386.2 秒 |
| 7 | 洛照 | 她收住演式后的余势，转而静候堂前那人的回应。 | partial；版本 7 | 165.7 秒 |
| 8 | 谢真石 | “我刚才只看见你带着剑，没看清招。把那一式完整演完。还有——你为什么偏要找我？” | success；版本 8 | 251.2 秒 |
| 9 | 洛照 | “来找你，是想亲自看看我在你剑下能走多远。招可以再演一次。看完，换地方试。” | success；版本 9 | 220.2 秒 |
| 10 | 谢真石 | 他没有接话，视线随即从来人脸上移向握剑的手与下盘。 目光一落到对方的握剑与落脚处便明显定住，没有再分向堂中别处。 | success；版本 10 | 203.9 秒 |

## 请求与失败记录

当前运行累计执行 2777.7 秒，已发起 31 次模型阶段请求。执行时间包含失败调用，但不含停机修改代码的间隔；从本次世界启动算起的实际经过时间为 3046.5 秒。包括前期排错在内，总计 35 次 CLI 阶段调用尝试；供应商在生成前拒绝的请求单独保留，不能算成人物回合。

已结束的模型调用尝试耗时合计 2775.2 秒；已完成人物回合中的协议修正共 6 次。

| 运行 | 已完成回合 | 模型调用尝试 | 状态 |
|---:|---:|---:|---|
| 1 | 0 | 1 | failed：Turn 1 failed: CODEX_TRUSTED_CHANNEL_FAILED: Persistent tavern session command failed. |
| 2 | 0 | 1 | failed：Turn 1 failed: CODEX_TRUSTED_CHANNEL_FAILED: Persistent tavern session command failed. |
| 3 | 0 | 2 | failed：Turn 1 failed: CHARACTER_AGENT_CANDIDATES_REJECTED: Persistent tavern session command failed. |
| 4 | 10 | 31 | complete |

- 第 4 回合曾中断：`CHARACTER_AGENT_TURN_COMMIT_REJECTED`，当时世界版本 3。失败不计为已完成回合。
- 第 7 回合曾中断：`ENOENT`，当时世界版本 6。失败不计为已完成回合。
- 2026-09-07T04:27:32.130Z 从已完成的 3 回合之后继续；之前的 11 次调用仍计入总数。
- 2026-09-07T04:46:54.066Z 从已完成的 6 回合之后继续；之前的 21 次调用仍计入总数。
- 第 7 回合第 21 次调用由测试执行者主动停止，用于加载记忆延续修复。当时六轮已经保存，该调用没有完整返回；其 ENOENT 是中断后缺少输出文件的记录，不计为模型内容错误。

前期真实测试发现：Codex 严格结构化输出要求所有对象字段都列入 required；原代码的可选字段会令供应商在生成前拒绝。已将可选字段编码为可空值，并在人物校验前恢复为省略。随后发现 activationState 与 feasibilityHandling 的字段说明容易误读，已明确其含义，并为这两类错误提供不含私密引用的固定修正说明。世界规则与校验器未放宽。

第 4 回合还暴露了合并输出格式与现有校验不一致的问题：格式允许列出实际情绪却把 primaryChannelId 留空。现已用条件分支禁止这个组合，同时保留无情绪影响的合法输出。人物仍自行填写，系统不改写情绪、动作或台词。此前回合保持原样，从当前会话继续测试。

第 4、6、7 回合的旧证据报错经复现确认属于项目缺陷：模型按协议选择保留旧认知，服务器展开时却复制了上一轮的证据引用，再把它当成本轮新观察拒绝。已修复为保留认知内容与心理来源，不替人物制造新观察；模型明确填写的新证据仍须通过原有校验。第 7 回合重启后加载此修复。

## 原始返回

以下链接是模型实际返回的完整 JSON，包含作者可见的人物私人心理字段，保留在本机临时目录；未把这些私人内容写入本报告。它们是应用要求模型输出的数据，不包含 Codex 内部推理日志。公共审计 JSON 记录了文件摘要。

- 第 1 回合，第 1 次调用：[awaiting_subjective_appraisal_and_candidates](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/001.json)（89.4 秒，通过）。
- 第 1 回合，第 2 次调用：[awaiting_agent_choice_and_turn_commit](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/002.json)（41.5 秒，被拒绝或仅部分通过）。
- 第 1 回合，第 3 次调用：[awaiting_agent_turn_commit](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/003.json)（14.8 秒，通过）。
- 第 2 回合，第 4 次调用：[awaiting_subjective_appraisal_and_candidates](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/004.json)（110.1 秒，通过）。
- 第 2 回合，第 5 次调用：[awaiting_agent_choice_and_turn_commit](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/005.json)（42.4 秒，被拒绝或仅部分通过）。
- 第 2 回合，第 6 次调用：[awaiting_agent_turn_commit](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/006.json)（16.0 秒，通过）。
- 第 3 回合，第 7 次调用：[awaiting_subjective_appraisal_and_candidates](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/007.json)（133.2 秒，通过）。
- 第 3 回合，第 8 次调用：[awaiting_agent_choice_and_turn_commit](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/008.json)（42.2 秒，通过）。
- 第 4 回合，第 9 次调用：[awaiting_subjective_appraisal_and_candidates](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/009.json)（168.0 秒，被拒绝或仅部分通过）。
- 第 4 回合，第 10 次调用：[awaiting_subjective_appraisal_and_candidates](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/010.json)（137.4 秒，通过）。
- 第 4 回合，第 11 次调用：[awaiting_agent_choice_and_turn_commit](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/011.json)（75.5 秒，被拒绝或仅部分通过）。
- 第 4 回合，第 12 次调用：[awaiting_subjective_appraisal_and_candidates](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/012.json)（132.9 秒，通过）。
- 第 4 回合，第 13 次调用：[awaiting_agent_choice_and_turn_commit](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/013.json)（68.2 秒，通过）。
- 第 5 回合，第 14 次调用：[awaiting_subjective_appraisal_and_candidates](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/014.json)（203.9 秒，通过）。
- 第 5 回合，第 15 次调用：[awaiting_agent_choice_and_turn_commit](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/015.json)（44.4 秒，被拒绝或仅部分通过）。
- 第 5 回合，第 16 次调用：[awaiting_agent_turn_commit](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/016.json)（18.7 秒，通过）。
- 第 6 回合，第 17 次调用：[awaiting_subjective_appraisal_and_candidates](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/017.json)（158.5 秒，被拒绝或仅部分通过）。
- 第 6 回合，第 18 次调用：[awaiting_subjective_appraisal_and_candidates](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/018.json)（181.8 秒，通过）。
- 第 6 回合，第 19 次调用：[awaiting_agent_choice_and_turn_commit](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/019.json)（45.6 秒，通过）。
- 第 7 回合，第 20 次调用：[awaiting_subjective_appraisal_and_candidates](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/020.json)（135.5 秒，被拒绝或仅部分通过）。
- 第 7 回合，第 22 次调用：[awaiting_subjective_appraisal_and_candidates](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/022.json)（101.7 秒，通过）。
- 第 7 回合，第 23 次调用：[awaiting_agent_choice_and_turn_commit](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/023.json)（63.8 秒，通过）。
- 第 8 回合，第 24 次调用：[awaiting_subjective_appraisal_and_candidates](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/024.json)（163.4 秒，通过）。
- 第 8 回合，第 25 次调用：[awaiting_agent_choice_and_turn_commit](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/025.json)（43.3 秒，被拒绝或仅部分通过）。
- 第 8 回合，第 26 次调用：[awaiting_agent_turn_commit](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/026.json)（44.2 秒，通过）。
- 第 9 回合，第 27 次调用：[awaiting_subjective_appraisal_and_candidates](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/027.json)（126.3 秒，通过）。
- 第 9 回合，第 28 次调用：[awaiting_agent_choice_and_turn_commit](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/028.json)（77.7 秒，被拒绝或仅部分通过）。
- 第 9 回合，第 29 次调用：[awaiting_agent_turn_commit](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/029.json)（16.0 秒，通过）。
- 第 10 回合，第 30 次调用：[awaiting_subjective_appraisal_and_candidates](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/030.json)（157.9 秒，通过）。
- 第 10 回合，第 31 次调用：[awaiting_agent_choice_and_turn_commit](/var/folders/4s/s7b7dll16717kk2c2ljqx0280000gn/T/gtown-sol-medium-10-turns-ytBmm7/model-outputs/031.json)（45.8 秒，通过）。

性能口径：这里计量真实模型、校验和持久化的总时间，不含界面回合间等待。此前快速模式的 4.30 倍结果来自本地固定回复的浏览器测试，不能当作真实模型提速。CLI 返回的 token 用量按每次事件原样记录，未把可能包含会话累计量的计数相加。

复测入口：`node scripts/runV27SolMediumReview.mjs --run`。该命令会真实调用模型；普通测试不会执行它。

## 实测结论与后续优先项

完成 10/10 个人物回合，洛照、谢真石各 5 回合；6 个发言回合、4 个无对白动作回合，未触发日计划或反思。世界结果为 9 次成功、1 次部分完成。第 7 回合已经建立倾听，但对方没有可听见的话音，因此“部分完成”符合实际输入。

成功提交的 10 轮使用 26 次模型调用：4 轮直接使用两次，6 轮用了三次。加上同一世界中未提交的尝试，主测试共 31 次；加上前期排错共 35 次调用尝试，其中 32 次留下完整结构化返回，另 2 次在生成前被拒绝、1 次由执行者主动停止。

主测试累计执行 46 分 18 秒，包含失败调用；加上中途停止修改代码的间隔，墙钟时间为 50 分 46 秒。模型调用链（进程启动、网络与模型返回合计）占累计执行时间约 99.9%。这不是纯推理耗时的测量。

原始 JSON 与逐轮公开台词、动作逐字核对通过；所有对白均已送达指定人物，共用一个持续会话。世界版本从 1 到 10 单调前进。第 8 回合真实返回保留了 4 条旧认知并直接通过，验证到本次记忆延续修复。

最新完整回归 531/531 通过，71.7 秒；语法与差异格式检查通过。固定回复只用于这些离线回归，不计入这 10 个真实人物回合。

仍存在两个内容或模拟质量问题，未通过改写原文掩盖：

- 第 4、6 回合把谢真石的动作写成了“她”，与项目 publicIdentity 中的“他”不一致；尚未修复。
- 第 6 回合观察剑式时，世界只返回“身上可见一柄带鞘长剑”，没有招式细节；第 8 回合模型据此说“没看清招”。需进一步检查动作过程到旁观者感知的内容与时序，不能只改台词来消除重复。

下一步加速建议先对比一个三次调用方案：合并评估与候选，单独选择，本地计算真实情绪结果后再表达。当前六轮已经需要第三次调用，主要用于修正合并阶段对情绪结果的预估；分开后只需向表达阶段发送已选动作的上下文，可避免对多个候选重复发送场景。此次单次提示正文最大 527,936 字节，尚不含输出 schema。该方案的速度收益仍需实际对比，当前不宣称已证实的倍数。
