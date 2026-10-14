# v0.8 角色记忆编辑器与正史证据图谱

## 设计目的

人物小镇的目标不是让人物记住事实，而是让人物带着被欲望、羞耻、自我神话和关系压力改写过的记忆继续行动。

记忆不是背景设定。记忆是行动偏置。

## 记忆模型

每条记忆包含：

```json
{
  "id": "mem_xxx",
  "characterId": "char_a",
  "targetCharacterId": "char_b",
  "type": "selective",
  "stance": "self_defense",
  "content": "人物记得什么",
  "publicVersion": "他愿意公开承认的版本",
  "privateVersion": "他私下真正携带的版本",
  "distortion": "记忆如何被欲望、羞耻或自我神话篡改",
  "reliability": 55,
  "heat": 60,
  "sourceCanonEventId": "canon_xxx"
}
```

### 记忆类型

```text
accurate      准确记忆
selective     选择性记忆
misremembered 误记
suppressed    压抑
fabricated    篡改
weaponized    武器化记忆
```

### 记忆立场

```text
self_defense     自辩
self_accusation  自控 / 自我控告
desire           欲望
revenge          报复
protection       保护
confusion        混乱
```

## 图谱模型

图谱节点：

```text
character
canon
evidence
rumor
trace
memory
```

图谱连接：

```text
正史 → 人物
证据 → 人物
谣言 → 草稿
痕迹 → 人物
记忆 → 记忆者
记忆 → 对象人物
记忆 → 来源正史 / 草稿 / 证据 / 谣言
```

## 播放循环中的作用

赞同草稿后：

1. 每个参与人物获得一条新记忆。
2. 记忆从该人物的显性行动、隐藏行动、自欺句和不愿承认的快感生成。
3. 记忆进入当前分支快照。
4. 后续 CharacterAgent prompt 会读取相关记忆。
5. DirectorSynthesizer 会把记忆/证据压力转化为场景行动。

## 叙事意义

同一个事件在不同人物那里不再是同一个事实：

```text
A 记成保护。
B 记成羞辱。
C 记成证据。
D 记成可以利用的谣言。
```

这使人物小镇从“状态驱动”进一步变成“记忆驱动”。
