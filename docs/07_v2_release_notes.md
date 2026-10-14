# 人物小镇 v0.2 Release Notes

## 本版目标

把 v0.1 的单页原型升级为可开发 MVP：

- 服务端模型入口：`POST /api/play`。
- OpenAI Responses API 适配：`src/server/openaiProvider.mjs`。
- 前端驱动模式：browser mock / server auto / server OpenAI。
- 部分赞同：用户可只确认场景、人物、关系、谣言、证据、不可逆痕迹中的部分项。
- 分支树：从草稿开分支，分支保存自己的草稿与正史索引。
- 保留 mock fallback：没有 API key 或远程失败时仍可运行。

## 服务端模型路径

```text
前端 playService
→ POST /api/play
→ server.mjs
→ src/server/modelRouter.mjs
→ mockEngine 或 openaiProvider
→ auditDraft
→ buildUpdateBundle
→ 返回 draft
```

## OpenAI 环境变量

```bash
export OPENAI_API_KEY="..."
export CHARACTER_TOWN_MODEL="gpt-5.5"
export CHARACTER_TOWN_MODEL_MODE="auto"
export CHARACTER_TOWN_MAX_OUTPUT_TOKENS="3200"
```

`CHARACTER_TOWN_MODEL_MODE=mock` 会强制服务端 mock。

## 部分赞同语义

完整赞同会将草稿文本和全部状态更新写入正史。

部分赞同会根据 UI 勾选项过滤 `updateBundle`：

- `scene`
- `characters`
- `relationships`
- `rumors`
- `evidence`
- `irreversibleTraces`
- `secrets`

## 分支语义

MVP 中，分支用于记录草稿与正史归属。人物状态仍是全局共享状态。

下一版要做“分支隔离状态”：每条分支拥有独立 state snapshot。
