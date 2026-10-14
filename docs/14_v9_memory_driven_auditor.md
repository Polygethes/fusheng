# v0.9 Memory-Driven Auditor

## 目的

记忆不能只是角色档案。它必须成为行动偏置。

v0.9 的 MemoryDrivenAuditor 检查：

```text
人物是否忽略关键记忆
同一关系是否存在冲突记忆
武器化记忆是否进入行动
记忆是否只被解释而没有改变动作调性
记忆是否被单义使用
```

## 审查逻辑

`src/state/memoryAudit.js` 会从当前分支中挑选相关记忆：

```text
参与人物的记忆
关于参与人物的记忆
高热记忆
低可信记忆
weaponized / suppressed / misremembered / fabricated 记忆
```

然后检查草稿中的：

```text
sceneText
agentOutputs
memoryId
memoryInfluence
memoryUse
memoryDistortionAction
irreversibleTraces
```

## 关键分数

```text
memoryPressureScore        角色当前承受的记忆压力
memoryChangedActionScore   记忆是否改变了动作
ignoredMemoryRisk          高热记忆被忽略的风险
singleMemoryRisk           记忆被干净化、单义化的风险
memoryConflictScore        同源记忆是否出现冲突版本
memorySelfRevisionScore    记忆是否被自我篡改、压抑、武器化
memoryUseRisk              综合记忆使用失败风险
```

## 修复规则

如果 `ignoredMemoryRisk` 或 `memoryUseRisk` 高，RepairPass 必须：

```text
选择至少一段高热记忆
把它写入 memoryId / memoryInfluence
让它改变行动动词
让它制造误读、证据、沉默、销毁、保存、保护或报复
```

## 判断标准

坏用法：

```text
他想起了那件事，所以很痛苦。
```

好用法：

```text
他把那封旧邮件从附件里删掉，却在正文里留下一个只有对方能看懂的术语。
```

前者是解释。后者是行动。
