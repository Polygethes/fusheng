# 人物小镇 MVP v0.3 Release Notes

## 版本目标

v0.3 把 v0.2 的“单次合成 / mock fallback”推进成真正的多代理流水线。

核心流水线：

```text
CharacterAgent(s)
→ DirectorSynthesizer
→ DepthAuditor
→ RepairPass
→ StateArchivist
```

## 新增内容

### 1. 服务端多代理流水线

新增目录：

```text
src/server/pipeline/
  responseClient.mjs
  schemas.mjs
  context.mjs
  characterAgents.mjs
  director.mjs
  repairPass.mjs
  openaiPipeline.mjs
```

每个参与人物都会先由 CharacterAgent 独立生成行动线，随后由 DirectorSynthesizer 合成场景。

### 2. RepairPass

DepthAuditor 检测到以下问题时，RepairPass 会介入：

- 安全收束风险过高。
- 人物过于单义。
- 人物可能成为白纸。
- 多重动机不足。
- 缺少不可逆痕迹。

RepairPass 的目的不是让内容更温和，而是让场景更行动化、更多义、更不可逆。

### 3. 流水线 UI

操盘台新增“流水线”视图，用来查看：

- provider
- model
- 每个阶段
- stage 耗时
- 是否触发 RepairPass
- fallback 错误

### 4. mock 与 OpenAI 模式统一

没有 `OPENAI_API_KEY` 时，系统仍可完整本地运行 mock。

有 `OPENAI_API_KEY` 时，`auto` / `openai` 会尝试多代理流水线。

### 5. 状态与正史机制保留

v0.3 继续保留：

- 完整赞同
- 部分赞同
- 分支树
- 正史时间线
- 证据系统
- 谣言系统
- 不可逆痕迹

## 环境变量

```bash
export OPENAI_API_KEY="你的 key"
export CHARACTER_TOWN_MODEL="gpt-5.5"

# 可选：禁用 RepairPass
export CHARACTER_TOWN_DISABLE_REPAIR="1"

# 可选：强制触发 RepairPass
export CHARACTER_TOWN_FORCE_REPAIR="1"

# 可选：调整不同阶段 token
export CHARACTER_TOWN_AGENT_MAX_OUTPUT_TOKENS="1400"
export CHARACTER_TOWN_DIRECTOR_MAX_OUTPUT_TOKENS="2600"
export CHARACTER_TOWN_REPAIR_MAX_OUTPUT_TOKENS="3000"
```

## 验证

已通过：

```bash
npm run check
npm run smoke
```

并手动测试：

```text
GET /api/health
POST /api/play
```

## 下一步

v0.4 应该优先做：

1. 分支隔离状态：每条分支拥有自己的角色状态、关系、谣言和证据。
2. 真实角色卡生成 API：前端输入人物概念后，由模型生成完整深层角色卡。
3. 真实小镇生成 API：根据题材和场所概念生成压力场。
4. 关系热力图与小镇地图视图。
5. 模型调用 tracing 与错误重试。
