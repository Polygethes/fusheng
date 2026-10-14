# Character Town v0.9 Release Notes

## Version

`0.9.0`

## Theme

v0.9 adds a **memory-driven DepthAuditor / RepairPass** layer.

v0.8 made memories editable and visible in the evidence graph. v0.9 makes memory an enforcement mechanism: if characters possess hot, distorted, suppressed, or weaponized memories, their next action must show how those memories are used, denied, bent, hidden, misread, saved, deleted, or turned into evidence.

## New capabilities

### 1. Memory-driven local audit

New module:

```text
src/state/memoryAudit.js
```

Primary scores:

```text
memoryPressureScore          current branch memory pressure
memoryChangedActionScore     whether memory changed action
ignoredMemoryRisk            risk that high-heat memory was ignored
singleMemoryRisk             risk that memory is used as a single clean version
memoryConflictScore          divergent versions of same source event/evidence
memorySelfRevisionScore      degree of self-editing, suppression, weaponization
memoryUseRisk                aggregate memory failure risk
```

Compatibility aliases remain available for older UI/docs/tests:

```text
memoryNeglectRisk
memoryActionInfluenceScore
memoryConflictVersionScore
memoryPolysemyScore
memoryDistortionPressure
```

### 2. DepthAuditor includes memory blindness

Updated files:

```text
src/engine/depthAuditor.js
src/server/pipeline/depthAuditor.mjs
src/server/pipeline/schemas.mjs
```

DepthAuditor now warns when:

```text
characters ignore high-heat memories
memory stays as exposition
all characters remember the same event the same way
memories are accurate only and never distorted
memory does not affect visibleAction / hiddenAction / defenseAction / shadowAction / evidence
```

### 3. RepairPass repairs memory blindness

Updated file:

```text
src/server/pipeline/repairPass.mjs
```

RepairPass now instructs the model to turn memory into:

```text
action
silence
misreading
deleted text
saved evidence
protection
revenge
self-defense
confession-as-control
weaponized documentation
```

It explicitly rejects weak exposition such as “the character remembers...” unless that memory changes a playable action.

### 4. CharacterAgent schema supports memory usage

Updated files:

```text
src/server/pipeline/schemas.mjs
src/server/pipeline/context.mjs
src/server/pipeline/characterAgents.mjs
```

Agent outputs now support:

```text
memoryId
memoryInfluence
```

Mock agent outputs also expose:

```text
memoryUse
memoryDistortionAction
```

### 5. New Memory Audit page

Updated file:

```text
src/ui/render.js
```

New top-level page:

```text
记忆审查
```

It shows:

```text
memory pressure
memory action influence
ignored memory risk
single-memory risk
memory conflict versions
per-character memory pressure
ignored hot memories
conflict version groups
```

### 6. New tests

New scripts:

```text
scripts/memoryAudit.mjs
scripts/memoryAuditSmoke.mjs
```

New npm commands:

```bash
npm run memory-audit:test
npm run memory-audit-smoke
```

## Why this matters

Character Town should not merely store facts. A deep character does not remember neutrally. They misremember, protect themselves, weaponize fragments, suppress shame, and turn private versions into public lies.

v0.9 moves the system from:

```text
characters have memories
```

to:

```text
characters are driven, distorted, and trapped by memories
```

## Verification

The v0.9 package was verified with:

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
npm run memory-audit:test
npm run memory-audit-smoke
```

Remote OpenAI calls were not executed during this verification; the full local mock / fallback path was verified.
