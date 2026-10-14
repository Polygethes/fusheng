# Character Town v0.8 Release Notes

## 核心主题

v0.8 增加“角色记忆编辑器 + 正史证据图谱”。人物不再只由当前状态数值和关系张力驱动，而会带着准确记忆、选择性记忆、误记、压抑记忆、篡改记忆和武器化记忆继续行动。

## 新增功能

- 新顶部页面：记忆/证据。
- 新状态对象：characterMemories。
- 新图谱对象：evidenceLinks。
- 播放并赞同草稿后，系统自动为参与人物生成记忆。
- 角色记忆随分支隔离。
- 服务端模型 compact context 增加 activeCharacterMemories 与 evidenceLinks。
- 记忆图谱显示人物、正史、证据、谣言、不可逆痕迹和记忆之间的关系。

## 新增脚本

```bash
npm run memory:test
npm run memory-smoke
```

## 验证结果

已通过：

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
npm run memory:test
npm run memory-smoke
```

另用 `PORT=8899 npm start` 验证本地服务 `/api/health` 与静态首页可访问。

## 未验证

未使用真实 `OPENAI_API_KEY` 进行远程模型调用验证。
