# Runtime Mapping And Delivery Packet

## Required packet

One scene and character onboarding packet contains:

```text
<root>/<scene-id>/
├── scene-contract.json
└── characters/<character-id>/
    ├── manifest.json
    ├── fact-card.md
    ├── interview-log.md
    ├── anchor-payload.json
    ├── character-foundation.json
    ├── calibration-evidence.json
    ├── memory-seed.json
    ├── holdouts.md
    └── runtime-map.json
```

Create it with `scripts/init_anchor_workspace.mjs`. Check it with `scripts/check_anchor_workspace.mjs` at each gate.

## Single-authority mapping

Name the exact file and exported symbol for every row:

| Surface | Owns | Must not own |
|---|---|---|
| scene facts | topology, objects, resources, roles, affordances, information routes | private desire or predicted choice |
| psychology | stable ranges, dynamic state, desire, threat, inhibitors, epistemics | objective world truth |
| voice | sentence shape, pragmatic forms, registers, silence, evidence anchors | plot outcomes |
| relationships | directional dimensions and evidence-backed update rules | global affinity shortcuts |
| memory | perceived episodes, beliefs, source chains, commitments, self-narrative | events the person never perceived |
| presence | character-owned reason to enter, remain, leave, or return | schedule teleportation |
| candidate compilation | generic candidates from perceived affordances, universal primitives, and private psychological factors | character-specific situation-to-action menus or final Agent choice |
| validation | schema, causal, semantic, Holdout, and behavior contracts outside runtime | literary authority or Agent prompt content |

If two files own the same field, choose one and convert the other into a derived projection or migration bridge.

## Artifact input boundary

The offline compiler and checker may read the authoring record, calibration suite, foundation, and memory seed. The live Character Agent may receive only:

- `character-foundation.json` or its byte-equivalent frozen projection;
- `memory-seed.json` after it has been normalized into owned memory;
- current perceived world facts and affordances;
- current subjective relationship state;
- candidates produced by the generic cognitive core.

`runtime-map.json.runtimeBoundary` must list `characterFoundation` and `memorySeed` as Agent inputs, and must list `anchorPayload`, `calibrationEvidence`, and `holdouts` as forbidden Agent inputs. Compiler provenance may still point to a legacy authoring record; provenance is not permission to pass that record into the model.

## Memory seed boundary

Write `memory-seed.json` directly in the Character Agent memory schema:

- `episodes`: only owned perceptions or self-actions; include objective event id, source, location/time, semantic frame, confidence, accessibility, and retention;
- `beliefs`: propositions derived from those episodes, including uncertainty and contradiction state;
- `commitments`: requester/requested actor/beneficiary/counterparty roles and open status;
- `selfNarrative`: current claims, prior versions, and bounded pending candidates produced by committed owned episodes;
- `emptyReason`: required when the character intentionally begins with no autobiographical scene-relevant memory.

Never convert biography prose into authoritative social roles by word order. Preserve it as unstructured, lower-confidence recollection until roles are confirmed.

## Integration order

1. Confirm or validate the scene contract.
2. Compile or load the sanitized character foundation; never wire the authoring record directly to Agent input.
3. Derive the existing voice contract from foundation speech parameters. Calibration samples may determine aggregate sentence shape offline but must not appear in the result.
4. Seed directional relationships with evidence ids.
5. Initialize `agentMemory` from the memory seed.
6. Bind presence to a character-owned reason and travel feasibility.
7. Let the shared cognitive core instantiate feasible or attemptable candidates from perceived affordances and universal action primitives, then appraise them with desire, body, relationship, memory, and inhibitor parameters.
8. Let the Character Agent select `candidateId` and emit only a qualitative `pending_world_resolution` continuity proposal. It may name action-memory, desire-pressure, dynamic-state, and self-narrative candidates; it may not write them yet.
9. Let the world validate and resolve the attempted action. A committed attempt is not evidence that its expected benefit occurred.
10. Encode the actor's actual `self_action` episode, apply verified material/desire consequences, then settle the proposal. `progress_if_verified` and `resolve_if_verified` require matching world evidence; identity revision additionally requires a consequential world outcome and the owned episode.
11. Persist settled outcomes back to state, memory, relationships, and self-narrative. Keep unresolved desire pressure and bounded, unconsolidated self-narrative candidates alive.
12. Run the acceptance cases recorded in `runtime-map.json`.

## Completion states

- `draft`: facts or questions are still open; do not wire runtime.
- `calibrated`: enough evidence exists for ranges and predictions; runtime experiments may begin.
- `validated`: at least three unseen holdouts were accepted.
- `runtime-mapped`: every authority surface points to one live implementation.
- `behavior-accepted`: deterministic causal contracts pass and any claimed real-model naturalness was separately observed.

Storage migration alone never advances one of these states. A draft foundation remains draft after physical separation; a pending Holdout remains pending in the calibration suite.

## Required behavior categories

Record these stable categories in `runtime-map.json`; test names may be more specific:

- `agent_non_top_choice`
- `unresolved_desire_survives_delay`
- `rumor_differs_from_direct_knowledge`
- `private_zone_blocks_propagation`
- `relationship_changes_expression_not_desire`
- `voice_changes_by_function`
- `body_state_changes_behavior`
- `non_luozhao_portability`
