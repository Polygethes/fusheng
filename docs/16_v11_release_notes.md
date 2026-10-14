# Character Town v1.2 Release Notes

## 主题

v1.2 新增 **真实模型实时模拟编排 Character Simulation Loop**。

上一版 v1.0 的 Character Intent Planner 让人物拥有计划，但计划仍可能变成机械剧情。v1.2 的目标是把计划降级为人物的内在倾向与自我谎言，把真正的故事生成交给实时模拟：人物先独立生成私人欲望、防御面具、阴影冲动和行动候选，再在同一个场所中互相误读、遮掩、反击、保护、设证、沉默或共谋。

## 新流水线

```text
SimulationTick
→ CharacterPrivateSimulator
→ VisibilityLayer
→ SceneInteractionSimulator
→ CharacterAgent
→ DepthAuditor
→ StateArchivist
```

## 新增文件

```text
src/state/simulationLoop.js
scripts/realtimeSimulation.mjs
scripts/realtimeSimulationSmoke.mjs
docs/16_v12_realtime_character_simulation_loop.md
```

## 新增草稿字段

```text
simulationMode
simulationTick
visibilityLayer
privateSimulations
sceneInteraction
```

## 新增审查指标

```text
privateIntentCoverage
contradictionPressureScore
visibilityTensionScore
unscriptedCollisionScore
planScriptRisk
directorOverrideRisk
sceneSimulationScore
```

## 关键行为变化

- `mockEngine` 不再直接从计划合成场景；它先构造 `SimulationTick`。
- 每个参与人物都会得到一条 `privateSimulation`。
- 场景合成会读取 `sceneInteraction`，把误读、反转和可见性翻转写入文本、关系变化和不可逆痕迹。
- `DepthAuditor` 会惩罚“计划像剧情”“导演覆盖人物私人意图”“缺少实时碰撞”等问题。
- UI 新增“实时模拟”页面，并在草稿详情中新增“模拟”视图。

## 已验证

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
```

当前验证使用 mock / fallback 路径，没有使用真实远程模型 key。
