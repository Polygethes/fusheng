# v0.4 Branch Isolation Design

## 问题

人物小镇的分支不应该只是“文本分支”。

如果 A 分支里沈闻山已经自毁，B 分支里沈闻山还在维持体面，那么两条分支必须拥有不同的：

- 人物状态
- 关系状态
- 正史时间线
- 草稿池
- 谣言
- 证据
- 不可逆痕迹

否则用户切换分支时，人物仍然共享同一份心理状态，故事会失去操盘意义。

## 设计目标

```text
每条分支 = 一条独立命运线
```

每条分支必须能保存：

```text
同一批人物在不同选择后的不同状态。
```

## 数据结构

Branch 新增 `snapshot`：

```ts
type BranchSnapshot = {
  characters: Character[];
  relationships: Relationship[];
  canonEvents: CanonEvent[];
  draftScenes: DraftScene[];
  rumors: Rumor[];
  evidence: Evidence[];
  secrets: Secret[];
  irreversibleTraces: IrreversibleTrace[];
};
```

Branch 结构：

```ts
type Branch = {
  id: string;
  projectId: string;
  title: string;
  parentBranchId: string | null;
  forkedFromDraftId: string | null;
  forkedFromCanonEventId: string | null;
  createdAt: string;
  canonEventIds: string[];
  draftSceneIds: string[];
  note: string;
  stateMode: "isolated";
  snapshotSchemaVersion: 1;
  snapshot: BranchSnapshot;
};
```

## Active State 与 Snapshot

前端运行时仍然保留一份 top-level active state：

```text
state.characters
state.relationships
state.canonEvents
state.draftScenes
state.rumors
state.evidence
state.secrets
state.irreversibleTraces
```

这些字段始终代表“当前 active branch”。

所有 branch 的完整状态则保存在：

```text
state.branches[n].snapshot
```

## 切换分支流程

```text
persistActiveBranchSnapshot()
→ set activeBranchId
→ restoreBranchSnapshot(targetBranch)
→ render
```

### syncActiveBranchSnapshot

把当前 top-level active state 写回当前 branch 的 snapshot。

### restoreBranchSnapshot

把目标 branch 的 snapshot 写到 top-level active state。

## 播放流程

播放时，模型只接收当前 active state。

```text
current branch snapshot restored as top-level state
→ POST /api/play
→ draft.branchId = activeBranchId
→ saveDraft(draft)
→ persist active branch snapshot
```

## 赞同流程

```text
acceptDraftWithOptions(draftId)
→ create canon event with active branch id
→ applyUpdateBundle to top-level state
→ sync active branch snapshot
```

## 从草稿开分支

```text
persist parent branch snapshot
→ copy current top-level active state
→ put forked draft into new snapshot
→ create branch
→ set new branch active
→ restore new snapshot
```

## 为什么不把 branch snapshot 做成服务端状态

当前 MVP 是本地沙盘，状态保存在浏览器 localStorage 中。

v0.4 先保证前端数据模型正确。后续接后端数据库时，可以把 branch snapshot 拆成独立表或事件溯源结构。

## 后续演进

### v0.5 分支 diff

比较两个 branch：

- 人物状态差异
- 关系数值差异
- 正史事件差异
- 谣言差异
- 证据差异
- 不可逆痕迹差异

### v0.6 分支合并

允许用户选择某条分支中的事件、证据或关系状态，合并到另一条分支。

### v0.7 事件溯源

用 event sourcing 替代完整 snapshot，减少状态体积，并允许回放任意分支。
