# Character Town v0.6 Release Notes

v0.6 adds the **Operator Intervention Layer**.

The operator can now do more than write a freeform directive or inject an accident. The UI supports structured intervention cards that constrain the next play cycle:

- lock motivation
- lock relationship direction
- force misreading
- force action
- event impact
- force silence
- force protection
- force betrayal/framing
- force confession

Each card selects an acting character, a target character, an action direction, intensity, persistence, and concrete instruction.

## Play Loop Change

```text
CharacterAgent(s)
→ Operator Intervention Layer
→ DirectorSynthesizer
→ DepthAuditor
→ RepairPass
→ StateArchivist
```

The intervention is not treated as a plot command. Each character agent must translate it into a Stanislavski-style playable action, with surface justification, hidden desire, shame, power reason, self-deception, unadmitted pleasure, and self-punishment.

## UI Changes

- New top tab: `干预层`.
- Control deck shows active intervention count.
- Draft detail tabs include `状态理由`.
- Intervention cards are branch-local and may be one-shot or persistent.

## State Changes

Branch snapshots now include:

```text
interventions
stateChangeReasons
```

Accepted drafts archive state-change reasons and consume `next_play` interventions.

## Validation

v0.6 is validated with:

```bash
npm run check
npm run smoke
npm run branch:test
npm run branch-smoke
npm run diff:test
npm run diff-smoke
npm run intervention:test
npm run intervention-smoke
```
