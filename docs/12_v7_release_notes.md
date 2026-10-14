# Character Town v0.7 Release Notes

## 版本目标

v0.7 把 v0.6 的“操盘手干预层”推进为“关系时间轴 + 内心法庭回放 + 正史撤销重演”。

这版的核心不是继续增加故事生成能力，而是让操盘手能回看：

- 一段关系如何一步步变形。
- 某个人物每次行动中的表层理由、欲望理由、防御理由、阴影理由。
- 一次赞同如何改变人物状态、关系张力、证据、谣言和不可逆痕迹。
- 哪个正史节点可以被撤销，并从接受前快照重新播放。

## 新增功能

### 1. 关系回放页面

顶部新增“关系回放”页面。

它包括：

- 关系 A / 关系 B 选择器。
- 回放人物选择器。
- 正史事件选择器。
- 关系时间轴。
- 内心法庭回放。
- 状态变化理由。
- 撤销与重演面板。

### 2. 正史事件写入前/后快照

每次 `acceptDraftWithOptions` 写入正史时，现在会保存：

```js
preAcceptSnapshot
postAcceptSnapshot
replay
```

其中 `replay` 保存：

- `agentOutputs`
- `subtextMatrix`
- `audit`
- `pipelineMeta`
- `interventionsApplied`
- `updateBundle`
- `stateChangeReasons`

### 3. 内心法庭回放

系统会从正史事件的源草稿与 replay 材料中拆出人物行动：

- 显性行动
- 隐藏行动
- 防御伪装
- 阴影行动
- 想得到的情绪反应
- 不愿承认的快感
- 可能留下的证据

### 4. 撤销正史

`undoCanonEvent(canonEventId)` 会：

1. 找到目标正史。
2. 读取 `preAcceptSnapshot`。
3. 恢复当前分支到该正史写入前状态。
4. 生成 `replayMarker`。
5. 允许操盘手从该节点重新播放。

### 5. 撤销并重演

界面支持：

- 撤销正史。
- 立即调用播放生成新草稿。
- 新草稿不会自动写入正史，仍需要操盘手赞同。

## 已验证

通过：

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
```

本地服务验证：

```text
GET  /api/health
POST /api/play
```

当前没有使用真实 `OPENAI_API_KEY` 做远程模型调用验证。
