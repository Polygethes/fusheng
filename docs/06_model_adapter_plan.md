# Model Adapter Plan

本 MVP 当前使用浏览器内的 mock engine。下一步把 `src/engine/mockEngine.js` 替换为真实模型编排层。

## 目标

播放循环保持不变：

```text
选择人物 + 地点 + 意外事件
→ 每个角色代理独立生成行动
→ 导演合成场景
→ 深度审查
→ 生成草稿
→ 用户赞同
→ 正史档案员更新状态
```

真实模型接入时，不要让一个模型一次性写完整故事。必须分工。

## 建议后端接口

```http
POST /api/run-character-agent
POST /api/synthesize-scene
POST /api/audit-depth
POST /api/archive-canon
POST /api/inject-event
```

## 前端替换点

当前入口：

```js
import { playNext } from "./engine/mockEngine.js";
```

替换为：

```js
import { playNext } from "./engine/modelEngine.js";
```

`modelEngine.js` 应返回与 mock 完全一致的 DraftScene 对象：

```ts
{
  id,
  createdAt,
  locationId,
  participantIds,
  agentOutputs,
  surfaceEvent,
  sceneText,
  subtextMatrix,
  relationshipShift,
  irreversibleTraces,
  audit,
  updateBundle
}
```

## 硬规则

1. CharacterAgent 只为单个角色行动，不负责整体故事。
2. DirectorSynthesizer 只合成碰撞，不负责道德修复。
3. DepthAuditor 有权要求重写。
4. CanonArchivist 只在用户点击“赞同”后更新正史。
5. 所有模型输出必须是 JSON 可解析结构，不要只返回自然语言。
