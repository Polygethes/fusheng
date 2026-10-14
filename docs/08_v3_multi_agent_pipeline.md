# v0.3 多代理流水线说明

v0.3 把 v0.2 的单次模型调用改造成五段流水线。

```text
CharacterAgent → DirectorSynthesizer → DepthAuditor → RepairPass → StateArchivist
```

## 1. CharacterAgent

每个参与人物单独调用一次。该阶段只允许人物根据自己的四条行动线行动，不允许替全局故事做“正确安排”。

输入：

- 当前人物角色卡
- 同场人物摘要
- 关系状态
- 当前地点
- 操盘指令
- 注入事件
- 近期正史、谣言、证据、不可逆痕迹

输出：

```json
{
  "characterId": "char_lin",
  "targetCharacterId": "char_shen",
  "tone": "试探",
  "visibleAction": "...",
  "hiddenAction": "...",
  "defenseAction": "...",
  "shadowAction": "...",
  "selfDeceptionSentence": "...",
  "wantsFromOthers": "...",
  "desiredEmotionalResponse": "...",
  "possibleHarm": "...",
  "possibleNobleAction": "...",
  "possibleEvidenceLeft": "..."
}
```

## 2. DirectorSynthesizer

把多个独立人物行动合成场景。导演不能把人物修成安全，也不能抹掉矛盾。

输出：

- `surfaceEvent`
- `sceneText`
- `subtextMatrix`
- `relationshipShift`
- `irreversibleTraces`

## 3. DepthAuditor

v0.3 先运行本地审查器，再在真实模型模式下运行模型审查器；两者结果合并，用来判断是否进入 RepairPass。

审查草稿是否落入安全叙事。

检查项：

- 角色是否像白纸
- 是否只有主角复杂
- 是否只有单一动机
- 是否把道德行动写成天然正确
- 是否把忏悔写成净化
- 是否缺少不可逆痕迹
- 是否用解释替代行动

## 4. RepairPass

只有在审查器判定需要修复时运行。它不能把故事修成“正确答案”，只能增强：

- 人物主动性
- 多义动机
- 高尚行动里的污染
- 恶意行动里的求救/爱/羞耻
- 关系互染
- 不可逆痕迹

## 5. StateArchivist

本地模块，不调用模型。它把草稿转成状态更新包：

- character patches
- relationship deltas
- rumors
- evidence
- irreversible traces
- secrets

这些更新只有在用户点击“赞同”或“部分赞同”后才写入正史。

## 6. Fallback

没有 OpenAI key 或模型调用失败时，服务端自动回退到 mock engine，除非请求设置：

```json
{ "allowFallback": false }
```

## 7. 新文件

```text
src/server/pipeline/responseClient.mjs
src/server/pipeline/context.mjs
src/server/pipeline/characterAgents.mjs
src/server/pipeline/director.mjs
src/server/pipeline/repairPass.mjs
src/server/pipeline/openaiPipeline.mjs
src/server/pipeline/schemas.mjs
```
