# v1.2 Real Model Realtime Orchestration

## 目标

把“人物小镇”的播放循环从 mock 模拟推进到真实模型实时模拟。

v1.2 不再让一个模型一次性安排所有剧情，而是拆成多个阶段：

1. 每个人物先独立生成私人内心模拟。
2. 可见性层决定谁知道什么、误信什么、隐藏什么。
3. 场景互动模拟器把人物放进同一个场所。
4. 深度审查器检查人物是否变浅、安全、单义、解释化。
5. 修复器只修复人物深度和关系行动，不负责道德收束。

## 阶段一：CharacterPrivateSimulator

输入：

```text
人物卡
人物计划
人物记忆
当前关系
场所
操盘指令
意外事件
操盘干预
```

输出兼容 `agentOutputSchema`，同时必须填充：

```text
realtimePublicGoal
realtimePrivateDesire
realtimeDefensiveMask
realtimeShadowImpulse
realtimeNobleImpulse
realtimeLieToSelf
realtimeActionCandidate
realtimePressure
realtimeContradictionScore
falseBeliefs
withheldFacts
```

## 阶段二：VisibilityLayer

输出：

```text
visibleFacts
hiddenFacts
perCharacter[].knownFacts
perCharacter[].falseBeliefs
perCharacter[].withheldFacts
perCharacter[].blindSpots
perCharacter[].suspectedSecrets
perCharacter[].possibleVisibilityFlips
```

原则：不能让人物共享完整真相。完整真相会杀死误读。

## 阶段三：SceneInteractionSimulator

输出：

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

原则：场景不是情节摘要，而是人物在可见性不对称中临场行动。

## 阶段四：DepthAuditor

审查重点：

```text
私人意图覆盖率
可见性层是否影响行动
是否仍然变成安全收束
是否有人物只是承受者
记忆是否改变行动
计划是否变成剧情脚本
关系是否互相污染
是否留下不可逆痕迹
```

## 阶段五：RepairPass

RepairPass 不修复伦理，不让人物“变正确”。

它只修复：

```text
人物单义
关系单向
场景解释化
内心没有变成行动
没有误读
没有可见性翻转
没有不可逆痕迹
```

## 测试路径

mock：

```bash
npm run smoke
npm run simulation:test
```

真实模型：

```bash
export OPENAI_API_KEY="你的 key"
export CHARACTER_TOWN_MODEL="gpt-5.5"
npm run real-model:smoke
```
