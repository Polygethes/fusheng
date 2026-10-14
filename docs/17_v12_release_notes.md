# Character Town v1.2 Release Notes

## 主题

v1.2 将 v1.1 的实时人物模拟骨架接入真实模型编排。

## 真实模型路径

```text
CharacterPrivateSimulator(s)
→ VisibilityLayer
→ SceneInteractionSimulator
→ DepthAuditor
→ RepairPass
→ StateArchivist
```

## 新增内容

- 新增 `privateSimulator.mjs`：每个参与人物独立生成私人后台。
- 新增 `visibilityLayer.mjs`：生成不对称认知地形。
- 新增 `sceneInteractionSimulator.mjs`：把私人后台放进场所，实时模拟互动。
- 更新 `openaiPipeline.mjs`：真实模型模式下按阶段编排模拟。
- 新增 `realModelSmoke.mjs`：有 OpenAI key 时跑真实模型 smoke；无 key 时跳过。
- 更新 `modelRouter.mjs`：`/api/health` 返回 v1.2 与当前 provider。

## 本地验证

已通过：

```bash
npm run check
npm run smoke
npm run branch:test
npm run branch-smoke
npm run diff:test
npm run diff-smoke
npm run intervention:test
npm run intervention-smoke
npm run timeline:test
npm run timeline-smoke
npm run memory:test
npm run memory-smoke
npm run memory-audit:test
npm run memory-audit-smoke
npm run planner:test
npm run planner-smoke
npm run simulation:test
npm run simulation-smoke
npm run real-model:smoke
```

`real-model:smoke` 在当前环境没有 `OPENAI_API_KEY`，结果为安全跳过。

## 未验证

没有在当前环境使用真实 `OPENAI_API_KEY` 做远程模型调用验证。

## 下一步

v1.3 应该做真实模型评测套件：固定场景电池、深度评分、退化检测、成本/延迟记录、人工操盘样例回放。
