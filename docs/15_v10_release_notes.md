# Character Town v1.0 Release Notes

## 主题

v1.0 新增 Character Intent Planner：角色自主计划层。

v0.9 之前，人物已经有四线、记忆、关系、干预和正史回放。v1.0 把人物推进到“主动谋划”：人物不只根据当前状态反应，而是带着短期计划、中期伪装和长期自我神话进入下一次播放。

## 新增功能

- 分支快照保存 `characterPlans`。
- 自动为每个角色生成默认计划。
- 计划可冻结、重建、手动编辑战术与文本。
- CharacterAgent 读取计划并输出 `planInfluence`、`planNextAction`、`planStatus`。
- DepthAuditor 增加计划审查字段：`planUseScore`、`planRisk`、`activePlanCount`、`highPressurePlanCount`。
- StateArchivist 在赞同正史后推进计划进度，并写入计划类状态理由。
- UI 新增“计划层”页面。
- 新增 planner 测试与 smoke test。

## 新增验证

```bash
npm run planner:test
npm run planner-smoke
```

## 核心判断

深层人物不只是被动反应，也不只是带着记忆行动。他会主动谋划自己的命运：接近谁、撤退谁、保护谁、惩罚谁、设证、藏证、承认、背叛、自毁，且每个计划都会被伪装成更体面的理由。
