# v0.6 Operator Intervention Layer

## Purpose

The intervention layer gives the operator precise control over inner action without collapsing the system into ordinary outlining.

A good intervention does not say: “make this plot happen.”

It says: “force this character to misread, protect, betray, confess, withdraw, punish, or save under a specific internal pressure.”

## Intervention Card

```json
{
  "type": "force_action",
  "action": "protect",
  "targetCharacterId": "char_lin",
  "secondaryCharacterId": "char_shen",
  "instruction": "林澄保护沈闻山，但保护本身也保存一个能伤害他的证据。",
  "intensity": 76,
  "persistence": "next_play"
}
```

## Supported Types

```text
lock_motivation
lock_relationship
force_misread
force_action
event_impact
force_silence
force_protect
force_betray
force_confession
```

## Supported Action Directions

```text
misread
protect
frame
silence
confess
approach
withdraw
punish
save
betray
```

## How It Affects Playback

1. The state stores active interventions in the current branch snapshot.
2. Mock and model pipelines receive active interventions.
3. Character agents translate interventions into playable actions.
4. Director synthesis makes the intervention alter scene dynamics.
5. State updater writes reasons explaining the state change.
6. On acceptance, `next_play` interventions are consumed.

## Anti-Safety Requirement

The intervention layer must not convert story into moral repair.

Every intervention should still preserve ambiguity:

- protection may contain possession
- confession may contain control
- silence may contain accusation
- betrayal may contain love
- rescue may contain self-worship
- punishment may contain a plea to be stopped
