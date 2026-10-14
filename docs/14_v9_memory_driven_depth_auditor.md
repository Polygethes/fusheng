# v0.9 Memory-Driven DepthAuditor and RepairPass

## Design goal

The system must stop treating memory as background. Memory must become a character-action constraint.

A character with memory must not simply “remember.” They must do something with memory:

```text
hide it
repeat it
misname it
weaponize it
protect someone with it
punish someone through it
turn it into evidence
turn it into a lie
delete part of it
force someone else to remember it differently
```

## Core audit questions

```text
Does this character have high-heat memory?
Did this action use, suppress, distort, or weaponize that memory?
Did different characters form different versions of the same event?
Does memory alter visible action, hidden action, defense action, shadow action, evidence, rumor, or irreversible trace?
Is memory being used as exposition instead of action?
```

## Scored fields

### memoryPressureScore

High when active characters carry strong memories: high heat, low reliability, suppressed, fabricated, weaponized, or revenge/desire/protection stance.

### memoryChangedActionScore

High when memory appears inside visible action, hidden action, defense action, shadow action, evidence, traces, `memoryId`, or `memoryInfluence`.

### ignoredMemoryRisk

High when active characters have hot memories but the draft does not show them shaping action.

### singleMemoryRisk

High when memory is used as one clean, shared version instead of conflicting private versions.

### memoryConflictScore

High when the same source event, draft, evidence, rumor, or relationship has divergent versions across characters.

### memorySelfRevisionScore

High when memories include selection, suppression, misremembering, fabrication, weaponization, and low reliability.

## Repair rules

When memory audit fails, RepairPass must not add exposition. It must add a playable action.

Weak repair:

```text
He remembers the old incident and feels ashamed.
```

Strong repair:

```text
He opens the old email, deletes the sentence that would explain him too clearly, and forwards the damaged version as if it were the complete record.
```

Weak repair:

```text
She remembers his kindness differently.
```

Strong repair:

```text
She saves the redlined draft under a neutral filename, then quotes only the sentence that makes him look like a teacher and hides the sentence that makes him look like a man waiting to be forgiven.
```

## Model-prompt rule

CharacterAgent receives active memory context. It must answer:

```text
Which memory pressures this action?
How does the character falsify that memory?
What public version does the character perform?
What private version leaks through action?
What evidence does the action leave?
```

## UI rule

The Memory Audit page displays whether each active character actually brought memory into the draft.

A good draft is not one where characters remember the most. A good draft is one where memory changes what they do.
