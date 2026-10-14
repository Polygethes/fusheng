# Character Intent Planner

## 目的

Character Intent Planner 是人物小镇的角色自主计划层。

它解决的问题是：人物不能只在“播放”时被动响应场景。深层人物应当带着自己的计划进入场景，并且这些计划会被其他人物、场所、记忆、证据、谣言和操盘手干预打断、扭曲或反噬。

## 计划三层

```text
短期计划
  角色下一步想推进的可表演行动。

中期伪装
  角色如何把计划伪装成原则、爱、保护、学术、正义、程序、牺牲或成熟。

长期自我神话
  角色为什么非要让这个计划成立；它保护了角色怎样的自我叙事。
```

## 计划模式

```text
approach        接近
withdraw        撤退
protect         保护
punish          惩罚
plant_evidence  设证
hide_evidence   藏证
confess         承认
betray          背叛
self_destroy    自毁
wait            等待
```

## 计划如何进入播放

1. `ensureCharacterPlans(state)` 为当前分支的人物补齐计划。
2. `compactState(state)` 把人物当前计划传给 CharacterAgent。
3. CharacterAgent 必须输出：

```text
planId
planInfluence
planNextAction
planStatus
```

4. DirectorSynthesizer 把计划冲突合成场景。
5. DepthAuditor 检查计划是否只是装饰。
6. StateArchivist 在正史赞同后推进计划进度。

## 审查标准

计划不合格的情况：

- 角色没有计划，只是响应场景。
- 计划没有短期行动。
- 计划没有中期伪装。
- 计划没有长期自我神话。
- 计划没有影响 `visibleAction`、`hiddenAction`、`defenseAction`、`shadowAction` 或 `possibleEvidenceLeft`。
- 高压计划被完全忽略。

## 操盘意义

操盘手不只是指定事件，而是可以观察人物“想怎么推进自己命运”。

这让人物小镇从“事件模拟器”升级为“人物意志模拟器”。
