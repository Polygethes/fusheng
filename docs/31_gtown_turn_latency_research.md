# GTOWN 回合延迟：一手源码与官方文档研究

> 状态：性能研究与架构建议，不含业务代码修改  
> 调研日期：2026-08-31  
> 研究范围：Stanford Generative Agents、AI Town / Convex、SillyTavern，以及 OpenAI、Anthropic、vLLM、llama.cpp 的官方文档与源码。

## 0. 结论先行

GTOWN 最值得先解决的不是“再少放一点上下文”，而是**一次可见角色回合被拆成了多少个串行模型请求**。OpenAI 的官方延迟指南也把“更少的请求、更少的输出、并行化、流式呈现、能不用模型就不用模型”列为不同且相互叠加的杠杆；它特别指出，一般场景中减少输出 token 对总时长近似线性有效，而普通长度输入即使减半，常常只有较小收益。[OpenAI 延迟优化指南](https://developers.openai.com/api/docs/guides/latency-optimization)

对 GTOWN，建议把发布目标收敛为：

1. **未被唤醒的角色：0 次模型调用。**日常移动、碰撞、资格判断、候选说话人筛选和世界结算用确定性代码。
2. **GTOWN 近期目标应是每名活跃角色 2 次文本模型调用，而不是 1 次。**现有自主性合同是“模型生成候选 → 本地数学评估 → 模型读取评估反馈后自主选择”；第二次调用依赖本地计算结果，不能与第一次合并或并行。第一次只生成候选，第二次一次性返回选择、短计划、台词、行动意图和结束信号。详见现有[人物运行时设计](./28_pi_character_runtime_grok_world_governance.md)。
3. **对话按因果顺序串行，独立角色并行。**同一对话的下一句依赖上一句，不能伪并行；互不依赖的角色准备、检索和非冲突行动可以并行，最终世界提交仍串行。
4. **摘要、embedding、反思和长期计划移到后台，并按阈值/冷却触发。**它们不应阻塞本句首 token 或本轮画面更新。
5. **稳定前缀 + 动态后缀，短输出优先，立刻流式显示。**缓存只缩短 prefill，不会缩短长答案的 decode；流式主要改善感知等待，不等于后台总耗时下降。
6. **1-call 是改变合同后的长期选项。**只有改为“本地数学直接选中候选”，或让模型在同一次请求里自行估算而不再读取本地数学反馈，才可能做到 1-call；两者都改变当前的自主选择/可审计边界，需另做质量与产品决策。
7. **分层用模型。**路由和硬规则不用模型；前台两次调用都用快速模型和低推理强度；较强模型只用于稀有的后台反思、长程规划或异常审计。

上述结论不是根据宣传页推断，而是来自项目源码中的请求数量和官方推理服务的延迟机制。

## 1. 证据边界与口径

本文把一次“文本模型调用”定义为一次会生成文本/结构化文本的推理请求；embedding 单列。调用数来自调研日可见源码的静态路径分析，**不含 SDK 自动重试、失败修复、限流重试和供应商内部调度**。源码里的上限不是平均值，也不是 GTOWN 当前实测。

评估互动速度至少要区分：

- `TTFT`：从请求发出到第一个 token；主要受排队、网络、prefill、缓存命中影响；
- `ITL/TPS`：后续 token 的间隔/速度；主要受模型 decode 与服务负载影响；
- `E2E`：从用户动作到世界提交并可继续交互；串行请求数、重试和后台任务误入关键路径会被全部累加；
- `perceived latency`：用户多久看到第一段有意义的反馈；流式、局部状态和动画可以改善它，但不应掩盖 E2E。

## 2. 每个项目实际怎样控制调用放大

### 2.1 Stanford Generative Agents：昂贵模块有门控，但一次事件仍可能爆发成几十次请求

公开实现每个模拟步都经过 `perceive → retrieve → plan → reflect → execute`，但这不等于每步都调用五次模型；计划只在新日或当前动作结束时重建，反思也有重要度阈值。[论文 §4](https://arxiv.org/html/2304.03442#S4)；[官方 `persona.py`](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/persona.py#L167-L209)；[官方 `plan.py`](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/plan.py#L931-L1007)

| 场景 | 源码可见的调用账本 | 延迟含义 |
|---|---:|---|
| 当前动作未结束、没有新事件、未到反思阈值 | 可为 **0 次文本调用** | “每个 tick 都让所有人物思考”并不是必要设计。 |
| 写入一个非 idle 的新感知事件 | **1 次重要度判断 + 1 次 embedding**；重复事件由 retention 抑制 | 只处理新信息，并复用相同描述的 embedding。[`perceive.py`](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/perceive.py#L100-L181) |
| 当前动作结束，创建下一动作 | **7–8 次文本调用**，长任务还可能额外分解 | 区域、房间、物件、emoji、事件三元组、物件描述等被拆开生成；这是典型的串行请求放大。[`plan.py`](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/plan.py#L521-L652) |
| 当前 `agent_chat_v2` 一场对话 | 最多 16 句；每句先总结关系、再生成该句，即最多 **32 次**；加发起判断、整场摘要、双方日程重写，关键事务最高约 **36 次文本调用** | 对话自然不代表必须把“关系摘要”和“说一句话”拆成两个串行请求。[`converse.py`](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/converse.py#L126-L179)；[`plan.py`](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/plan.py#L860-L904) |
| 阈值反思 | 一次反思先 1 个焦点请求、3 个洞见请求，再为最多 15 条想法分别生成事件三元组和重要度：约 **34 次文本调用 + 15 次 embedding** | 论文把反思设为重要度累计触发，阈值 150，约每天 2–3 次；不能放在每个互动回合。[论文 §4.2](https://arxiv.org/html/2304.03442#S4.SS2)；[`reflect.py`](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/reflect.py#L99-L185) |
| 对话结束后的每个人物记忆加工 | 规划想法和 memo 各自产生一次正文、事件三元组、重要度，共 **6 次文本调用 + 2 次 embedding/人物** | 即使对话本身结束，后处理也可能继续占用角色；应从可见回复关键路径移走。[`reflect.py`](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/reflect.py#L190-L244) |

源码其实已经保留了一个明确信号：`agent_chat_v1` 注释为“optimized for speed via batch generation”，它用双方各一次关系摘要、各一次想法摘要，再一次生成完整对话，总共 5 次文本调用；后来启用的逐句 `v2` 换来了更强的交互因果，却把调用数推高。[`converse.py`](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/converse.py#L76-L103)

**可借鉴的不是复制这些调用数，而是它的门控思想：**稳定行动继续执行；只对新事件建记忆；反思低频触发；日计划按天生成。论文也明确承认 25 人物两天模拟用了数天和数千美元 token credits，因此原实现是认知架构参考，不是低延迟产品基线。[论文 §8.2](https://arxiv.org/html/2304.03442#S8.SS2)

### 2.2 AI Town / Convex：实时世界与长模型操作解耦，一条可见消息只做一次 completion

AI Town 把同步、可重放的游戏状态与慢速 agent operations 分开；角色一次只允许一个进行中的 operation，但多个角色的 operation 可以独立推进。高频聊天消息还被放在游戏引擎之外的表中，避免每条消息都拖累世界循环。[官方架构说明](https://github.com/a16z-infra/ai-town/blob/main/ARCHITECTURE.md)；[角色状态机](https://github.com/a16z-infra/ai-town/blob/main/convex/aiTown/agent.ts)

它的低延迟做法很具体：

- 普通闲逛、选择活动和许多状态转移是代码/随机规则，当前实现没有为每次日常移动询问 LLM。[`agentOperations.ts`](https://github.com/a16z-infra/ai-town/blob/main/convex/aiTown/agentOperations.ts)
- 开场、继续、离场三种可见消息路径，各自只做 **1 次 chat completion**；提示词要求短回复，生成上限为 300 token。生成前会做记忆检索，但 embedding 先查缓存。[`conversation.ts`](https://github.com/a16z-infra/ai-town/blob/main/convex/agent/conversation.ts)
- 对话最多 8 条消息；这用明确上限控制总请求数，而不是依赖模型永远自行收尾。[`constants.ts`](https://github.com/a16z-infra/ai-town/blob/main/convex/constants.ts)
- 对话结束后，每个人物做一次摘要、一次 1-token 重要度判断、一次 embedding；只有累计重要度超过 500 才反思。反思产生的多条洞见，其重要度和 embedding 用异步映射并行处理。[`memory.ts`](https://github.com/a16z-infra/ai-town/blob/main/convex/agent/memory.ts)
- embedding 缓存以文本 SHA-256 为键，并把未命中的文本批量送往 embedding API；README 还建议服务慢时把 `NUM_MEMORIES_TO_SEARCH` 调到 1 以减小 prompt。[`embeddingsCache.ts`](https://github.com/a16z-infra/ai-town/blob/main/convex/agent/embeddingsCache.ts)；[官方 README](https://github.com/a16z-infra/ai-town#readme)
- LLM 封装支持流式，但当前对话路径没有启用 `stream`，因此“像 AI Town”不自动等于首 token 很快；GTOWN 仍需显式接通 UI 流。[`llm.ts`](https://github.com/a16z-infra/ai-town/blob/main/convex/util/llm.ts)；[`conversation.ts`](https://github.com/a16z-infra/ai-town/blob/main/convex/agent/conversation.ts)

AI Town 的核心经验是：**实时循环持续推进，LLM 只是受控的异步 operation；每句只生成一次；低价值行为不用模型；对话结束后再加工记忆。**

### 2.3 SillyTavern：先用廉价规则选说话人，摘要按窗口压力触发

SillyTavern 的群聊并不会先用一次 LLM 决定所有谁说话。`Natural order` 根据名字提及、角色 talkativeness 概率和随机回退选择角色；手动模式则只让被选角色生成。默认情况下，当前说话角色只携带自己的角色卡。[官方群聊文档](https://docs.sillytavern.app/usage/core-concepts/groupchats/)

这给 GTOWN 两条直接启发：

1. 候选人资格、被点名、冷却、距离和发言概率可用代码完成；真正被唤醒的角色在自己的唯一一次生成中决定说什么、做什么或沉默。
2. “Join character cards”会让所有角色卡组成稳定联合前缀，可能提高 llama.cpp prompt reuse，但官方同时提醒它会造成角色人格混合；不能为了 cache hit 把所有人物私有上下文塞进同一 prompt。[官方群聊文档](https://docs.sillytavern.app/usage/core-concepts/groupchats/)

摘要模块提供 blocking 与 non-blocking 等模式。官方说明：raw blocking 会破坏普通聊天前缀，对 prompt 处理慢的 llama.cpp 尤其不利；classic blocking 更能保留可复用前缀；non-blocking 不阻塞聊天，但前提是后端能并发处理。摘要应按消息数、字数或上下文压力触发，并限制每次处理数量，而不是每轮总结；文档也提醒摘要会丢事实或产生幻觉。[官方 Summarize 文档](https://docs.sillytavern.app/extensions/summarize/)

Chat Vectorization 的默认策略是用最近 2 条消息查询、取回 3 条历史、保留最近 5 条不被替换；向量化在发送/接收时后台运行。官方特别警告，动态检索会改变 prompt 前缀并经常破坏 prompt caching；逐消息“向量摘要”还会为每条消息增加一次独立生成请求。缓存和动态重排不能不做取舍地同时打开。[官方 Chat Vectorization 文档](https://github.com/SillyTavern/SillyTavern-Docs/blob/main/extensions/Chat-vectorization.md)

SillyTavern FAQ 还指出：Auto-Continue 会连续生成多个小回复，因此更慢；缩短 Response Length、关闭不需要的 Auto-Continue 更直接。流式渲染的推荐帧率是 10–15 FPS，以免 UI 每个 token 都重排抖动。[官方 FAQ](https://github.com/SillyTavern/SillyTavern-Docs/blob/main/Usage/faq.md)

## 3. 推理服务各自能加速什么

| 机制 | 官方能力 | 能改善 | 不能改善 / 风险 |
|---|---|---|---|
| OpenAI Prompt Caching | 支持模型会自动缓存共享前缀；把静态指令、角色不可变资料和示例放前面，把本轮状态、时间戳、RAG 和最近消息放后面；通过 `cached_tokens` 观察命中，并可用稳定的 `prompt_cache_key` 帮助路由。[官方文档](https://developers.openai.com/api/docs/guides/prompt-caching) | 长稳定前缀的 prefill 与 TTFT | 不缩短输出 decode；重写历史、把随机值放前缀、每轮改变工具定义都会降低命中。 |
| Anthropic Prompt Caching | 缓存前缀顺序为 tools → system → messages；要求前缀精确一致，默认 5 分钟，也有 1 小时 TTL。并发请求只有在首个响应开始后才能复用刚写入的 cache。[官方文档](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) | 长角色设定/世界规则的 prefill；首请求开始后可让同前缀的兄弟请求命中 | 冷启动并不会消失；同时发出全部同前缀请求可能都 miss；动态字段放在 breakpoint 前会整体失效。 |
| 更短输出、较快模型、较低 reasoning effort | OpenAI 建议先减少输出 token、选更快模型、减少/合并请求；Anthropic 也建议缓存、去掉无用 token、向下扫 effort，并用多模型策略分配智能。[OpenAI 延迟指南](https://developers.openai.com/api/docs/guides/latency-optimization)；[Anthropic 成本与智能优化](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence) | TTFT 之后的生成时间和总成本；模型分层还能隔离稀有重任务 | 需用同一批质量样本验证；不能把所有人物统一降到最小模型后只看速度。 |
| 流式输出 | OpenAI 把 streaming 视为降低用户等待最有效的手段之一；llama.cpp server 也提供兼容的流式接口。[OpenAI 延迟指南](https://developers.openai.com/api/docs/guides/latency-optimization)；[llama.cpp server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) | perceived latency、首句可见时间 | 不减少总 token、完整提交时间或串行调用数；世界事实应在结构化结果校验后提交。 |
| vLLM continuous batching / chunked prefill | vLLM 提供 continuous batching、chunked prefill、prefix caching 和量化；chunked prefill 会把 prefill 与 decode 放进同一批次，并可用 `max_num_batched_tokens` 在 TTFT 与 ITL/吞吐间调节。[官方 README](https://github.com/vllm-project/vllm/blob/main/README.md)；[优化与调参](https://docs.vllm.ai/en/stable/configuration/optimization/) | 多人物并发吞吐、共享服务利用率；合理配置下兼顾 decode | 吞吐提高不保证单用户 p95 更低；批次过大、并发过高会恶化排队或 ITL，必须按 GTOWN 负载压测。 |
| vLLM Automatic Prefix Caching | 自动复用相同前缀的 KV cache，适合多轮对话和共享长文档。[官方 APC 文档](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/) | 重复前缀的 prefill | 官方明确说明不加速新 token 生成，也不帮助前缀不同或主要时间花在长输出的请求。 |
| vLLM speculative decoding | 小 draft/speculator 先提议、主模型验证，结果保持与目标模型一致。[官方 Speculators 文档](https://docs.vllm.ai/projects/speculators/en/latest/) | 部分工作负载的 decode latency | 收益强依赖模型、提示和并发；需要以真实角色台词长度测试，不能只看吞吐 benchmark。 |
| llama.cpp slots / continuous batching / prompt cache | server 用多个 slot 共享 batch，支持 continuous batching、slot 状态保存/恢复和 metrics；completion 工具的 prompt cache 能明显减少长 prompt 的启动成本。[server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)；[server 开发说明](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README-dev.md)；[completion README](https://github.com/ggml-org/llama.cpp/blob/master/tools/completion/README.md) | 本地模型的多会话吞吐、角色会话前缀复用、可观测性 | slot 太少会排队，太多并发会争用同一模型；量化、batch 大小和上下文长度是质量/内存/延迟共同权衡。 |

不要把供应商的离线 Batch API 与 vLLM/llama.cpp 的 continuous batching 混为一谈：前者适合非实时作业和成本优化，**不应放在互动前台**；后者是推理服务器对同时到达请求的调度方式。

## 4. 建议的 GTOWN 快速回合合同

### 4.1 前台关键路径

```text
世界事件到达
  → 代码门控：哪些人物真的获得一次选择机会（0 LLM）
  → 并行准备：局部投影 + top-k 私有记忆 + 稳定前缀（0 文本 LLM）
  → 每名活跃人物生成少量候选（第 1 次 LLM）
  → 本地数学评估候选，形成可审计反馈（0 LLM）
  → 人物读取数学反馈后自主选择，并流式返回 surfaceText + action（第 2 次 LLM）
  → 代码校验 + 冲突排序 + 世界串行提交（0 LLM）
  → 下一轮回执
```

第二次结构化生成应同时返回：

- `surfaceText`：一句短台词或空；
- `actionAttempt`：行动类型、目标、必要参数；
- `conversationSignal`：继续、结束、拒绝、沉默；
- `memoryRefs`：本轮实际使用的少量记忆 ID；
- `shortHorizonIntent`：只有确实变化时返回。

这不是要求模型暴露隐藏推理过程。候选、数学评估、最终选择、台词和行动结果应是可审计的**决策输出**；完整 chain-of-thought 不应存储或展示。若结构校验失败，允许一次受控修复；修复率必须单独计数，不能让“正常回合 2 次”被静默重试掩盖。

#### 为什么当前合同不能压成 1 次

```text
请求 1 的候选
  → 本地数学评分（请求 1 完成后才能算）
  → 请求 2 读取真实评分并自主选择
```

这里存在真实的因果边。把请求 1 和请求 2 并行会让第二次看不到评分；把两者合并，会在下列方案中二选一：

- 本地评分在生成后直接替人物做最终选择：速度可到 1-call，但人物不再读取评分后自主决定；
- 模型在同一次请求里自行估算评分：仍保留模型选择，但失去本地数学反馈及其独立可审计性。

因此本文建议 **P1 先实现稳定的 2-call fast path**。长期是否切换 1-call，要以人物自主性、数学约束效果、质量盲评和真实延迟收益共同决定，而不是把它当作纯性能重构。

在这个合同下，最终台词只能从第 2 次请求开始流式显示；streaming 可以缩短“第二次请求开始后到首字可见”的等待，却不会消除第 1 次生成、本地评分或第 2 次 TTFT。第 1 阶段只能用思考状态、动作预备动画等非语义反馈改善体感，不能提前展示尚未自主选定的台词。

### 4.2 并发边界

- 可以并行：互不依赖人物的上下文装配、embedding 缓存查找、独立动作候选、后台摘要/反思。
- 必须串行：候选生成 → 本地数学评估 → 人物最终选择；同一对话中后一句依赖前一句；共享物件/位置的最终提交；失败后需要读取新世界状态的重试。
- 五个“认知阶段”里，除上述两段模型调用外，优先折叠进候选请求或最终选择请求；只有真正独立的准备工作才适合 `Promise.all`。把有因果依赖的调用同时发出会快但会失真。
- 多角色同前缀使用 Anthropic 缓存时，先让一个 warm-up 请求开始返回，再发同前缀兄弟请求；否则并发可能一起冷 miss。OpenAI/本地服务则按各自缓存统计验证，不假设命中。

### 4.3 上下文与缓存布局

建议固定顺序：

1. 世界硬规则、输出 schema、工具定义；
2. 角色不可变身份与声音约束；
3. 较稳定的滚动摘要/长期承诺；
4. 本轮检索到的少量相关记忆；
5. 最近 4–8 个必要 turns；
6. 当前局部观察、世界版本和用户输入。

前 1–3 层尽量逐字稳定，动态时间戳、随机 ID 和本轮状态只放后缀。历史在同一会话内尽量 append-only；触发 compaction 时接受首个请求缓存冷启动，并比较“更少输入 token”是否足以抵消 miss。

检索数量不要照抄某项目默认值：可从 AI Town 的 1–3 条、SillyTavern 的 3 条历史作为实验起点，但必须检查关键记忆召回率。原始事件账本应保留，摘要只是检索层，不是事实唯一副本。

### 4.4 后台频率

| 任务 | 建议触发 | 前台是否等待 |
|---|---|---|
| embedding | 新记忆落账后批量/缓存处理 | 否；本轮可先用字面近期记忆 |
| 对话摘要 | 每 N 条、每 N token、对话结束或接近上下文压力时 | 否，除非下一轮已必须依赖它 |
| 反思 | 显著度累计阈值 + 最短冷却 + 每日上限 | 否 |
| 长程计划 | 新日、承诺变化或重大世界事件 | 否；当前短动作继续执行 |
| 质量审计 | 抽样、异常、合同失败或离线回放 | 否；不要每轮再叫一个 judge |

这同时保留 Stanford 的记忆—反思—计划价值，以及 AI Town/SillyTavern 的互动节奏。反思降频不是删除人格深度，而是把深思结果用于后续回合。

### 4.5 模型分层与输出预算

建议建立三层，而不是一刀切降级：

- **T0 确定性代码**：门控、寻路、碰撞、库存、日常动作、发言资格、缓存键、世界结算；
- **T1 快速前台模型**：第一次生成少量候选，第二次读取本地数学反馈并返回台词 + 短时意图 + 行动尝试；两次都用低/最小 reasoning effort，并在同一批盲评样本上确认人物质量；
- **T2 较强后台模型**：低频反思、长程计划、摘要修复、异常审计。

先把前台输出限制到“一句可见语言 + 紧凑行动 schema”，再实测 64/96/128/180 output token 上限；这些是实验档位，不是先验标准。只有用户明确要求长叙述时才提高预算。

## 5. 实施优先级与验证方法

### P0：先画出请求瀑布

为每个用户动作、角色 wake 和世界 commit 记录：`request_id`、角色、foreground/background、模型、reasoning effort、输入/输出 token、cached token、排队开始、发出时间、首 token、完成、校验/修复、世界提交、UI 首次绘制、重试原因。

必须能回答：

- 每个可见角色回合有几次前台文本请求、几次 embedding、几次重试？
- p50/p95 的 TTFT、生成时长、E2E 各是多少？
- 最慢回合是在 provider 排队、prefill、decode、串行阶段、校验修复，还是世界提交？
- 缓存命中率是多少；命中时 TTFT 是否真的下降？
- 并发角色数上升后，单句 TTFT/ITL 与总吞吐怎样变化？

### P1：消除串行调用放大

1. 把同一人物回合收敛成“候选生成 + 读取本地数学反馈后的自主选择”两次结构化生成；
2. 日常无事角色保持 0 调用；
3. 每名可见发言者不再额外调用关系摘要、路由或 judge；正常前台总数严格控制为 2 次；
4. 摘要、embedding、反思、judge 全部退出首句关键路径；
5. 缩短输出并接通流式 UI。

这一步通常应早于大规模 prompt 精简。缓存和短上下文当然重要，但不会替你把 5–30 次串行网络往返压到 GTOWN 合同允许的 2 次。

### P2：稳定前缀和服务调参

按角色/世界版本构造稳定 cache key，记录命中；再比较 OpenAI/Anthropic 的托管缓存，或 vLLM/llama.cpp 的 APC/slot。自托管时分别压测 `TTFT`、`ITL`、p95 与总吞吐，不用“每秒总 token”代替互动体验。

### 建议 A/B

固定同一批世界种子、人物和 30–100 个互动窗口，逐项加入变量：

| 版本 | 改动 | 主要验证 |
|---|---|---|
| A | 当前实现 | 请求瀑布与质量基线 |
| B | 每角色收敛为 2-call fast path | E2E、失败修复率、数学反馈是否被正确使用、角色一致性 |
| C | B + 短输出 + 流式 | 首个有意义文本时间、完整时长 |
| D | C + 稳定前缀/cache key | cached token、TTFT、冷/热 p95 |
| E | D + 后台摘要/反思 + 模型分层 | 前台 p95、后台积压、长期连续性 |
| F（研究项） | E + 1-call 合同变体（本地直选或模型自评） | 额外延迟收益是否值得自主性/可审计边界变化 |

每个版本同时保存盲评质量：人物声音、记忆正确性、行为可行性、对话承接和非模板感。若速度提高但合同失败或人物质量显著下降，不算完成。

## 6. 最关键的工程判断

1. **先数请求，不先猜模型。**若一回合有 5 个串行 completion，把模型快 20% 仍可能远慢于收敛到 GTOWN 必需的两次。
2. **先减输出，再微调普通长度输入。**对话短、动作 schema 紧凑，往往比盲目删角色事实更安全、更有效。
3. **缓存只救稳定 prefill。**动态 RAG、每轮重写摘要、时间戳前置和工具定义变化都会让命中变差。
4. **流式是体验优化，不是架构赎罪券。**它可以让首句一秒内出现，但 20 个后台串行调用仍会拖住下一轮。
5. **并行不等于所有人同时说。**独立准备并行、共享世界串行、对话因果串行，三者必须分开。
6. **后台任务要有背压。**摘要/反思若生产速度高于消费能力，需要队列上限、合并、丢弃过期任务和角色级单飞，不能无限堆积。
7. **最合理的近期目标是“0 或 2”。**无事人物 0 次；真正行动/发言人物前台 2 次（候选、数学反馈后自主选择）；少数结构失败才额外修复。长期思考另算后台预算，1-call 另算产品合同实验。

## 7. 一手来源索引

- Stanford Generative Agents：[论文](https://arxiv.org/html/2304.03442)、[作者官方仓库](https://github.com/joonspk-research/generative_agents)
- AI Town / Convex：[官方仓库](https://github.com/a16z-infra/ai-town)、[架构说明](https://github.com/a16z-infra/ai-town/blob/main/ARCHITECTURE.md)
- SillyTavern：[群聊](https://docs.sillytavern.app/usage/core-concepts/groupchats/)、[摘要](https://docs.sillytavern.app/extensions/summarize/)、[Chat Vectorization](https://github.com/SillyTavern/SillyTavern-Docs/blob/main/extensions/Chat-vectorization.md)、[FAQ](https://github.com/SillyTavern/SillyTavern-Docs/blob/main/Usage/faq.md)
- OpenAI：[延迟优化](https://developers.openai.com/api/docs/guides/latency-optimization)、[Prompt Caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- Anthropic：[Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)、[成本与智能优化](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)
- vLLM：[README](https://github.com/vllm-project/vllm/blob/main/README.md)、[Automatic Prefix Caching](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/)、[优化配置](https://docs.vllm.ai/en/stable/configuration/optimization/)、[Speculators](https://docs.vllm.ai/projects/speculators/en/latest/)
- llama.cpp：[server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)、[server 开发说明](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README-dev.md)、[completion README](https://github.com/ggml-org/llama.cpp/blob/master/tools/completion/README.md)
