# v0.5 Branch Diff View

## Purpose

The branch diff view is for the operator, not the reader. It shows how two possible histories diverge after different accepts, partial accepts, injected accidents, and repair passes.

## Core principle

A branch is not just a timeline. It is a full state snapshot:

```text
characters
relationships
canonEvents
draftScenes
rumors
evidence
secrets
irreversibleTraces
```

The diff view compares snapshot A and snapshot B.

## Panels

### 1. Summary

Shows the strongest divergence:

- largest character state shift
- largest relationship tension shift
- newly accepted canon events
- new evidence
- new irreversible traces

### 2. Character diff

Compares each matching character's current state metrics:

```text
desire
shame
rage
love
disgust
selfDeception
selfDestruction
protectionImpulse
revengeImpulse
```

It also highlights changed self-lie and shadow action line when present.

### 3. Relationship diff

Compares directional relationship state, for example:

```text
林澄 → 沈闻山
沈闻山 → 林澄
周既明 → 沈闻山
```

Relationship diff is directional because love, resentment, power, deception, and desire to be seen are not symmetric.

### 4. Collection diff

Shows added/missing items in:

```text
canon events
evidence
rumors
irreversible traces
drafts
```

## Operator use

The operator can use this view after forking a draft and accepting different outcomes in each line.

Example workflow:

```text
1. Play a scene.
2. Fork the draft.
3. In branch A, fully accept it.
4. In branch B, partially accept only evidence and rumor.
5. Open 分支差异.
6. Compare A and B.
```

The important result is not that the story text differs. The important result is that the town state differs.

## Design constraint

The diff view must not flatten relationships into simple good/bad outcomes. It should preserve directional ambiguity:

```text
A character can become more loving and more vengeful at the same time.
A relationship can gain protection and deception at the same time.
A branch can lose a canon event but gain a stronger rumor.
```
