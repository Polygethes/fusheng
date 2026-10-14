# v1.2 真实模型实时模拟编排

## 目标

v1.1 的实时模拟主要在 mock/local 层完成。v1.2 的目标是让真实模型路径按相同哲学运行：

1. 人物先独立生成私人后台。
2. 可见性层决定谁知道什么、误信什么、隐藏什么。
3. 场景互动模拟器让这些私人后台在同一场所中碰撞。
4. DepthAuditor 检查是否变浅、安全、单义。
5. RepairPass 修复“模拟不够活”的场景。

## 为什么不叫计划碰撞

计划碰撞容易把人物变成状态机。v1.2 的规则是：

```text
计划不是剧情。
计划是人物进入场景前对自己的谎言。
```

因此真实模型路径不计算“谁会撞谁”，而是即时模拟每个人在当前场所、记忆、计划、干预和信息不对称下会如何行动。

## 三个模型阶段

### CharacterPrivateSimulator

每个参与人物单独调用一次模型。输出：

```text
publicGoal
privateDesire
defensiveMask
shadowImpulse
nobleImpulse
selfLie
actionCandidate
whatTheyWantFromOthers
whatTheyRefuseToAdmit
riskTheyWillCreate
planLine
memoryLine
contradictionScore
pressure
```

### VisibilityLayer

读取所有私人模拟，输出：

```text
visibleFacts
hiddenFacts
perCharacter.knownFacts
perCharacter.blindSpots
perCharacter.falseBeliefs
perCharacter.withheldFacts
perCharacter.secretLevers
perCharacter.visibleOthers
```

### SceneInteractionSimulator

读取私人模拟和可见性层，输出：

```text
surfaceEvent
sceneText
interactionBeats
misunderstandings
reversals
visibilityFlips
relationshipMutationIntents
evidenceCreated
rumorCreated
memoryDistortions
irreversibleTraces
subtextMatrix
relationshipShift
```

## Adapter

系统仍需要旧 UI 和 `StateUpdater` 使用 `agentOutputs`。因此 v1.2 增加：

```text
privateSimulationToAgentOutput
```

它把私人模拟转成旧的行动输出字段，同时保留 realtime 字段，避免 UI 和状态更新断裂。

## 失败路径

如果没有 `OPENAI_API_KEY`，或者真实模型调用失败，并且 `allowFallback !== false`，系统会回退到 mock 路径。
