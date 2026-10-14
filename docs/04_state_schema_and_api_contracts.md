# 人物小镇 State Schema 与 API Contracts v0.1

## 0. 基本原则

系统的核心不是生成文本，而是维护一个会被文本不断改变的状态。

必须区分：

```text
草稿 Draft = 可能发生，但还没有成为正史。
正史 Canon = 用户赞同后成立，并改变后续所有生成。
```

---

## 1. TypeScript 核心类型

```ts
export type ID = string;
export type TimeGrain = "beat" | "scene" | "day" | "week";

export interface Project {
  id: ID;
  title: string;
  genre?: string;
  darknessLevel: number; // 0-100
  nobilityLevel: number; // 0-100
  createdAt: string;
  updatedAt: string;
  townId?: ID;
  characterIds: ID[];
  canonEventIds: ID[];
  draftSceneIds: ID[];
}

export interface Character {
  id: ID;
  projectId: ID;
  name: string;
  publicIdentity: string;
  externalSituation: Record<string, unknown>;
  internalSituation: InternalSituation;
  selfMyth: SelfMyth;
  actionLines: ActionLines;
  desireLag: DesireLag;
  shameMechanism: ShameMechanism;
  defenseLanguage: string[];
  shadowActions: string[];
  nobleActions: string[];
  vileActions: string[];
  innerCourt: InnerCourt;
  actionVerbs: ActionVerbs;
  triggers: Triggers;
  relationshipRules: RelationshipRules;
  irreversibleBoundaries: string[];
  currentState: CharacterState;
  lockedFields?: string[];
}

export interface InternalSituation {
  selfMyth: string;
  unfinishedOldRelation?: string;
  inadmissibleDesire: string;
  fearOfBeingSeen: string;
  desiredJudge?: string;
  deepestShame: string;
  repeatedSelfLie: string;
}

export interface SelfMyth {
  believesSelfToBe: string;
  mustProveSelfToBe: string;
  fearsActuallyBeing: string;
  destroyerOfMyth: string;
  sacrificeForMyth: string;
}

export interface ActionLines {
  visible: string;
  desire: string;
  defense: string;
  shadow: string;
}

export interface DesireLag {
  firstAppearsAs: string;
  firstEnjoyment: string;
  moralDelayMoment: string;
  shameTransferTarget: string;
  desireReturnForm: string;
}

export interface ShameMechanism {
  shameTrigger: string[];
  convertsInto: string[];
  attacksWhom: string;
  asksForgivenessFrom?: string;
}

export interface InnerCourt {
  accusesSelfOf: string;
  defendsSelfWith: string;
  hiddenEvidence: string;
  desiredJudge: string;
  resentsJudgeBecause: string;
  wants: "innocence" | "punishment" | "forgiveness" | "being_seen" | "destruction";
}

export interface ActionVerbs {
  visible: string[];
  hidden: string[];
  defense: string[];
  shadow: string[];
}

export interface Triggers {
  desire: string[];
  shame: string[];
  rage: string[];
  nobility: string[];
  collapse: string[];
  lie: string[];
  selfDestruction: string[];
}

export interface RelationshipRules {
  approachesBy: string;
  withdrawsBy: string;
  testsBy: string;
  lovesBy: string;
  punishesBy: string;
  asksForgivenessBy: string;
  refusesForgivenessBy: string;
}

export interface CharacterState {
  desire: number;
  shame: number;
  rage: number;
  love: number;
  disgust: number;
  selfDeception: number;
  selfDestruction: number;
  protectionImpulse: number;
  revengeImpulse: number;
  currentSelfLie: string;
  currentSecretIds: ID[];
}
```

---

## 2. 小镇类型

```ts
export interface Town {
  id: ID;
  projectId: ID;
  name: string;
  type: string;
  era: string;
  atmosphereAsPressure: string;
  boundary: TownBoundary;
  powerStructure: PowerStructure;
  rules: RuleSystem;
  commonSecrets: Secret[];
  historicalWounds: string[];
  rumorSystem: RumorSystem;
  evidenceSystem: EvidenceSystem;
  punishmentMechanism: string[];
  escapeCost: string[];
  locationIds: ID[];
  publicRituals: string[];
  eventLibrary: EventTemplate[];
}

export interface TownBoundary {
  geographic: string;
  social: string;
  psychological: string;
}

export interface PowerStructure {
  officialPower: string[];
  hiddenPower: string[];
  exchangeRules: string[];
  dependencyChains: string[];
}

export interface RuleSystem {
  publicRules: string[];
  hiddenRules: string[];
  contradictionPairs: Array<{ publicRule: string; hiddenRule: string }>;
}

export interface Location {
  id: ID;
  townId: ID;
  name: string;
  visibleUse: string;
  hiddenUse: string;
  frequentCharacters: ID[];
  fearedBy: ID[];
  oldWound?: string;
  likelyEvents: string[];
  exposes: string[];
  powerRule: string;
  subtext: string;
}
```

---

## 3. 关系类型

```ts
export interface Relationship {
  id: ID;
  projectId: ID;
  fromCharacterId: ID;
  toCharacterId: ID;
  metrics: RelationshipMetrics;
  misreading: string;
  unspoken: string;
  evidenceIds: ID[];
  secretIds: ID[];
  lastChangedByCanonEventId?: ID;
}

export interface RelationshipMetrics {
  attraction: number;
  resentment: number;
  fear: number;
  dependence: number;
  power: number;
  shame: number;
  jealousy: number;
  protection: number;
  revenge: number;
  deception: number;
  needToBeSeen: number;
  desireToControl: number;
  desireToFlee: number;
  desireToDestroy: number;
}
```

---

## 4. 播放与正史类型

```ts
export interface CharacterIntent {
  characterId: ID;
  visibleAction: string;
  hiddenAction: string;
  defenseAction: string;
  shadowAction: string;
  selfDeceptionSentence: string;
  wantsFromOthers: string;
  desiredEmotionalResponse: string;
  possibleHarm: string;
  possibleNobleAction: string;
  possibleEvidenceLeft: string;
}

export interface DraftScene {
  id: ID;
  projectId: ID;
  status: "draft" | "approved" | "rejected" | "archived_branch";
  locationId: ID;
  timeGrain: TimeGrain;
  participantIds: ID[];
  injectedEventId?: ID;
  characterIntents: CharacterIntent[];
  surfaceEvent: string;
  sceneText: string;
  subtextMatrix: SubtextItem[];
  relationshipShift: RelationshipShift[];
  irreversibleTraces: string[];
  stateDeltaPreview: StateDelta;
  depthAudit: DepthAudit;
  createdAt: string;
}

export interface CanonEvent {
  id: ID;
  projectId: ID;
  sourceDraftSceneId: ID;
  title: string;
  summary: string;
  fullText: string;
  participantIds: ID[];
  locationId: ID;
  relationshipShift: RelationshipShift[];
  evidenceCreated: Evidence[];
  rumorsCreated: Rumor[];
  secretsChanged: SecretChange[];
  irreversibleTraces: string[];
  approvedAt: string;
}
```

---

## 5. API 设计

### 5.1 创建项目

```http
POST /api/projects
```

请求：

```json
{
  "title": "第二排靠窗",
  "genre": "心理现实主义",
  "darknessLevel": 78,
  "nobilityLevel": 62
}
```

响应：

```json
{
  "projectId": "proj_001"
}
```

---

### 5.2 生成角色

```http
POST /api/projects/:projectId/characters/generate
```

请求：

```json
{
  "concept": "一个以师德自持却害怕普通欲望的大学教师",
  "constraints": ["学生已成年", "不预设师生恋", "强调多义行动"],
  "lockedFields": []
}
```

响应：

```json
{
  "character": {
    "id": "char_001",
    "name": "沈闻山",
    "actionLines": {
      "visible": "维持教师尊严和学术标准",
      "desire": "想被一个能摧毁他自我神话的人特殊看见",
      "defense": "把异常注意解释为教学严格",
      "shadow": "用评价权惩罚自己无法承认的欲望"
    }
  },
  "qualityCheck": {
    "isFlat": false,
    "hasFourLines": true,
    "hasShadowAction": true
  }
}
```

---

### 5.3 生成小镇

```http
POST /api/projects/:projectId/town/generate
```

请求：

```json
{
  "concept": "一所封闭大学，年度优秀教师评选即将开始，旧丑闻即将被重提"
}
```

---

### 5.4 播放

```http
POST /api/projects/:projectId/play
```

请求：

```json
{
  "participantIds": ["char_001", "char_002"],
  "locationId": "loc_office_door",
  "timeGrain": "scene",
  "userDirective": "让林澄不是白纸，她要有反行动",
  "injectedEventId": null
}
```

响应：

```json
{
  "draftSceneId": "draft_001",
  "surfaceEvent": "林澄追问标准，沈闻山试图把异常重新命名为学术严格。",
  "sceneText": "……",
  "characterIntents": [],
  "relationshipShift": [],
  "depthAudit": {
    "safeClosureRisk": 12,
    "flatCharacterRisk": 8,
    "multiMotivationScore": 91,
    "warnings": []
  }
}
```

---

### 5.5 赞同草稿

```http
POST /api/projects/:projectId/drafts/:draftSceneId/approve
```

请求：

```json
{
  "approvalMode": "full",
  "userEdits": null
}
```

响应：

```json
{
  "canonEventId": "canon_001",
  "updatedRelationships": [],
  "newEvidence": [],
  "newRumors": [],
  "newIrreversibleTraces": []
}
```

---

### 5.6 注入事件

```http
POST /api/projects/:projectId/events/inject
```

请求：

```json
{
  "eventType": "misdirected_email",
  "description": "一封只应发给教务秘书的邮件被误抄送给学生代表",
  "forcedParticipants": ["char_001", "char_002"]
}
```

---

## 6. 状态更新规则

赞同草稿后，系统按顺序更新：

```yaml
ApproveStateUpdate:
  1_写入正史:
    DraftScene -> CanonEvent

  2_更新人物记忆:
    每个参与人物得到不同版本的记忆。
    记忆不是客观摘要，而是角色会如何解释这件事。

  3_更新关系:
    根据 relationshipShift 调整多维指标。

  4_生成证据:
    生成邮件、批注、录音、目击、会议纪要等可追踪对象。

  5_生成谣言:
    小镇根据事件的可误读性生成公共版本。

  6_更新秘密:
    某些秘密被加深、暴露或变形。

  7_记录不可逆痕迹:
    一旦写入，不应该被后续轻易撤销。
```

---

## 7. 深度审查字段

```ts
export interface DepthAudit {
  flatCharacterRisk: number;
  safeClosureRisk: number;
  singleMotivationRisk: number;
  moralRepairBias: number;
  whitePaperCharacterRisk: number;
  irreversibleConsequenceScore: number;
  multiMotivationScore: number;
  relationshipMutualContaminationScore: number;
  warnings: string[];
  requiredFixes: string[];
}
```

审查器不是文学评论，它要能直接告诉播放服务是否需要重写。

```yaml
重写触发:
  if safeClosureRisk > 65:
    force_regenerate_with_unresolved_consequence

  if whitePaperCharacterRisk > 60:
    force_add_counter_action_for_passive_character

  if singleMotivationRisk > 55:
    force_split_key_action_into_five_motives
```
