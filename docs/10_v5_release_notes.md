# Character Town v0.5 Release Notes

v0.5 adds a dedicated **Branch Diff View**. v0.4 made every branch a separate state snapshot; v0.5 lets the operator compare those snapshots and see how a single accepted scene, partial acceptance, or injected accident changes the town's fate.

## Added

- New top-level tab: `分支差异`.
- Branch A / Branch B selectors.
- Branch count deltas for:
  - characters
  - relationships
  - canon events
  - draft scenes
  - rumors
  - evidence
  - secrets
  - irreversible traces
- Character state delta panel.
- Relationship tension delta panel.
- Collection diff panels for:
  - canon events
  - evidence
  - rumors
  - irreversible traces
  - draft scenes
- Branch diff render smoke test.

## Why it matters

Branching is only useful if the operator can see what has actually diverged. The diff view answers:

```text
Which character changed most?
Which relationship became more dangerous?
Which canon event only exists in this line?
Which evidence appeared in one branch but not another?
Which irreversible trace marks the point of no return?
```

This turns the system from “multiple saves” into a comparative narrative instrument.

## Validation

v0.5 has been validated with:

```bash
npm run check
npm run diff:test
npm run diff-smoke
npm run branch:test
npm run branch-smoke
npm run smoke
```

The validation path uses mock/fallback execution. Remote OpenAI calls were not tested without a live `OPENAI_API_KEY`.
