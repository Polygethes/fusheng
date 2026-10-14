# Validated Example: Luo Zhao

This example demonstrates evidence mapping. Do not reuse its values for other characters.

## Status

`validated` through user-confirmed facts, controlled situations, three speech anchors, and three accepted unseen holdouts.

## Confirmed model

- Pursue the Dao and test her own limit; care little about ordinary social approval.
- Fear her own weakness rather than the public appearance of weakness.
- Retain the secondary conflict between a sect-arranged path and a self-chosen path as story-open.
- Trust direct observation over hearsay. Know Xie Zhenshi's name and rumor but not his face.
- Observe before identifying him.
- Reveal challenge through gaze, attitude, and sword intent; speak if he deliberately ignores it.
- Continue controlled probing when the place is suitable.
- Avoid challenging him in the public tavern because irrelevant trouble degrades the encounter, not because she fears judgment.
- Become excited by a subtle or excellent sword move.
- Wait for a genuinely injured opponent to recover because she wants a valid test, not an easy victory.
- Suppress a forbidden breakthrough opportunity and leave, while unresolved frustration can later bring her back.

## Evidence-backed parameter ranges

| Parameter | Range | Scope |
|-----------|-------|-------|
| masteryDrive | 0.90-0.98 | Cultivation and worthy opponents |
| directEvidencePreference | 0.92-0.99 | Identity and ability judgments |
| socialApprovalNeed | 0.03-0.15 | Ordinary public evaluation |
| inhibitoryControl | 0.80-0.92 | Immediate action suppression |
| controlledForce | 0.82-0.95 | Martial probing; not general emotion control |
| unresolvedDesireRetention | 0.86-0.96 | Unverified high-value opportunities |
| frustrationReactivation | 0.68-0.86 | Repeated failure after suppression |
| domainExcitementGain | 0.82-0.96 | Novel or excellent sword evidence |
| irrelevantComplicationCost | 0.62-0.82 | Costs unrelated to genuine cultivation value |
| speechExplanationCost | 0.72-0.90 | Pressure and commitment speech |

Do not infer general care, trust, affection, or emotional flatness from these ranges.

## Positive self-owned desire

```js
{
  id: "desire_luozhao_test_own_limit_against_xiezenshi",
  ownerCharacterId: "char_xyy_luozhao",
  desiredState: {
    subjectCharacterId: "char_xyy_luozhao",
    verb: "亲自验证",
    object: "自己在谢真石完整状态的剑下能否触及新的极限",
    observableOutcome: "洛照在谢真石未受伤且能够真实回应时完成至少一轮有效攻防，并形成自己的第一手判断"
  }
}
```

Observation, pressure, waiting, and returning are progress actions. Only matching first-hand evidence can satisfy this desire episode.

## What the calibration changes

The answers support reusable parameters: high direct-evidence preference, high cultivation-domain salience, meaningful but non-absolute public-complication cost, controlled force in martial probing, and strong unresolved-desire retention. They do not create an ordered action repertoire.

In a real turn, the generic cognitive core may instantiate observation, movement, speech, waiting, leaving, or a physically attemptable probe only when the current world exposes the needed affordance. Luo Zhao's Agent then weighs those concrete options with her current body, beliefs, relationship state, and foundation parameters. A different scene can therefore produce a new action without adding a Luo-specific route.

## Calibration-only speech samples

- Pressure: `你打算一直装作没看见？`
- Genuine domain evaluation: `好剑。`
- Future commitment: `我会再来。`

Keep these lines in `calibration-evidence.json`. Compile only their pragmatic functions, sentence-shape range, directness, praise condition, and disclosure cost. The live Agent must not receive the quotations or regexes derived from them.

## Relationship update

An excellent observed move raises `competenceRespect`, `rivalry`, and attention. It does not automatically raise `trust`, `care`, or `affection`.

Waiting for recovery initially follows valid-test requirements. Only later evidence can transform it into personal care.

## Accepted holdouts

1. Ignore sect-based flattery; say `让开` only if physically blocked.
2. Treat a claim that Xie cannot survive three moves as search-relevant hearsay, not an ability conclusion; at most ask where he is.
3. After leaving a forbidden sword trace, repeated cultivation frustration can reactivate the unresolved desire and cause a return to observe risks and access.

## What generalizes from this pass

- Confirm the meaning of a behavior before assigning a trait: public restraint meant avoiding irrelevant trouble, not shame.
- Ask controlled contrasts instead of trait labels: rumor/direct evidence, public/private, healthy/injured, ignored/answered, and allowed/forbidden each exposed a different parameter.
- Separate positive desire from inhibition: she still wants a valid test while deciding not to fight here and now.
- Treat speech as goal-directed action and preserve silence as a real candidate.
- Keep capability respect, rivalry, trust, care, and affection separate.
- Preserve story-open identity conflict until a consequential choice actually occurs.

## What must never be copied

Do not reuse Luo Zhao's cultivation focus, low approval need, evidence weights, force control, speech brevity, return pattern, relationship deltas, or numerical ranges for another person. Reuse only the interview order, evidence categories, controlled contrasts, stage gates, and validation method.
