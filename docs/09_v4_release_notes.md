# Character Town v0.4 Release Notes

## 版本目标

v0.4 将 v0.3 的“分支树”升级为真正的“分支状态隔离”。

v0.3 中，分支能记录不同正史/草稿，但人物状态、关系、证据、谣言和不可逆痕迹仍主要共享当前沙盘状态。v0.4 中，每条分支拥有自己的 `snapshot`，切换分支时恢复对应状态。

## 新增能力

```text
Branch Snapshot
→ active branch restore
→ isolated canon / drafts
→ isolated characters / relationships
→ isolated rumors / evidence / secrets / irreversible traces
```

### 1. 分支快照

每个 branch 现在保存：

```json
{
  "snapshot": {
    "characters": [],
    "relationships": [],
    "canonEvents": [],
    "draftScenes": [],
    "rumors": [],
    "evidence": [],
    "secrets": [],
    "irreversibleTraces": []
  }
}
```

### 2. 切换分支恢复状态

`setActiveBranch(branchId)` 会先保存当前分支快照，再恢复目标分支快照。

恢复内容包括：

- 人物当前状态
- 关系张力
- 当前分支正史
- 当前分支草稿
- 谣言
- 证据
- 秘密
- 不可逆痕迹

### 3. 从草稿开分支

`createBranchFromDraft(draftId)` 会复制当前分支快照，并把该草稿作为 fork point 放入新分支。

新分支此后独立演化。

### 4. 赞同只影响当前分支

完整赞同、部分赞同都会只更新当前 active branch 的 snapshot。

### 5. 档案室按当前分支展示

档案室展示的是当前分支恢复后的状态，不再混合其他分支的证据、谣言和不可逆痕迹。

## 修改文件

- `src/state/store.js`
  - 新增 branch snapshot 结构。
  - 新增 `persistActiveBranchSnapshot()`。
  - 新增 `restoreBranchSnapshot()`。
  - 改写 `setActiveBranch()`。
  - 改写 `createBranchFromDraft()`。
  - 改写 `acceptDraftWithOptions()` 与 `applyUpdateBundle()` 的分支写入路径。

- `src/ui/render.js`
  - 分支卡显示每条分支内的正史、草稿、证据、谣言数量。
  - 档案室不再过滤 inherited canon，而是显示当前恢复快照中的正史。

- `src/server/modelRouter.mjs`
  - 服务状态更新到 v0.4。

- `README.md`
  - 更新 v0.4 使用说明。

## 验证

已通过：

```bash
npm run check
npm run smoke
npm run branch-smoke
```

已验证：

```text
GET /api/health
POST /api/play
```

当前验证在 mock / fallback 路径完成，未使用真实 `OPENAI_API_KEY` 做远程模型调用验证。

## 仍然未做

v0.4 做的是状态隔离，不是完整 Git 式版本控制。

未实现：

- 分支 diff 视图。
- 分支合并。
- 单个事件 cherry-pick。
- 分支命名编辑。
- 分支删除。
- 分支状态压缩。

## 下一步建议

v0.5 应优先做：

1. 分支差异视图。
2. 真实角色生成 API。
3. 真实小镇生成 API。
4. 关系热力图。
5. 地图式小镇视图。
