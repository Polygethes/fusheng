# Objective Scene Contract

Create one scene contract before calibrating characters for a new location. Reuse it for every character entering that scene. The contract describes objective possibilities and constraints; it must not contain a character's private desire or predicted choice.

```js
{
  schemaVersion: 1,
  sceneId: "stable-scene-id",
  status: "draft | confirmed | validated",

  identity: {
    name: "human-facing name",
    canonSourceIds: [],
    timeScope: "when this contract is true"
  },

  ownership: {
    ownerCharacterId: "",
    operatorCharacterIds: [],
    institutionId: ""
  },

  economy: {
    currency: { id, label, physicalMedium, scope, notEquivalentTo },
    mundaneCurrencyAccessRule,
    ordinaryFoodPolicy,
    sustenanceAppraisalRule,
    offerings: [{
      id,
      label,
      priceWen,
      contents,
      sustenance: { class, mundaneNutrition, spiritualNutrition, hydration, sensoryValue },
      bodyEffects,
      currentAvailabilityEvidenceIds
    }]
  },

  topology: {
    zones: [{ id, label, privacy, capacity, observableFromZoneIds }],
    routes: [{ fromZoneId, toZoneId, modality, requirements, barriers }],
    positions: [{
      id,
      zoneId,
      postureOptions,
      reachableFromPositionIds,
      objectiveMetrics: {
        informationAccess,
        visualCoverage,
        socialExposure,
        approachability,
        trafficInterference,
        movementClearance,
        exitAccess,
        comfort
      }
    }],
    privateZoneIds: []
  },

  resources: [{
    id,
    label,
    quantity,
    holderId,
    zoneId,
    valueTags,
    consumable,
    state,
    attachment: {
      active,
      actorId,
      mode,
      transitionRequiresExplicitOperation
    }
  }],
  resourceAbsenceReason: "required when resources is intentionally empty",
  affordances: [{
    id,
    transactionPhase: "none | request | operator_response | fulfillment | settlement",
    offeringIds,
    actorRequirements,
    targetRequirements,
    zoneRequirements,
    consumes,
    produces
  }],
  impossibilities: [{ id, claim, reason, enablingConditions }],
  roles: [{ id, label, holderCharacterIds, responsibilities, permissions }],

  environmentalPressures: {
    atmosphere: [{ id, observableCue, appraisalTags, intensityRange }],
    temptations: [{ id, resourceId, relevantDesireTags, salienceRange }],
    hazards: [{ id, triggerConditions, affectedZones, consequenceTags }],
    socialNorms: [{
      id,
      cueConditions,
      normativeExpectation,
      violationPhysicallyPossible,
      pressureOnset,
      likelyResponderRoleIds,
      possibleResponseTags,
      possibleConsequenceTags
    }],
    neutralReason: "optional explanation when a pressure category is intentionally empty"
  },

  informationRoutes: [{
    id,
    sourceZoneId,
    recipientZoneIds,
    modalities,
    barriers,
    distortionRiskRange,
    supportsGossip
  }],

  presencePolicy: {
    entryRequiresCharacterCause: true,
    exitIsAffordanceNotSchedule: true,
    scheduleRole: "constraint-only"
  },

  validation: {
    counterexamples: [{ id, attemptedEvent, expectedResult, passed }]
  }
}
```

## Required distinctions

- Record an owner, operator, or institution explicitly. A public place may have institutional ownership, but it cannot be ownerless by omission.
- A zone is not a precise position. Describe concrete seats, stations, edges, entrances, sightlines, traffic paths, and exits when position can affect behavior. Keep every metric objective and character-neutral: never add `preferred`, `bestFor`, `characterFit`, a rank, or an expected choice.
- Separate a role's responsibility from a person's desire. A proprietor may need to receive payment while privately wanting something unrelated.
- Separate a venue's menu from a visitor's choice. Offers, prices, current availability, visible operators, body state, money, and table-use customs are inputs to appraisal; they cannot encode `preferredOffer`, compulsory consumption, or an expected order.
- Split every service transaction into causal phases. A visitor request only opens a pending thread; an operator independently accepts, asks, refuses, or delays; fulfillment transfers the actual item or service; settlement transfers payment. No phase may silently imply a later one.
- Separate object possession, attachment, state, and location. A worn sword may be held by and attached to its owner while she moves; placing or transferring it requires a committed detach/draw transition when the attachment contract says so.
- Record temptations as available resources with relevance tags. A sword, medicine, rumor, private room, rare manual, or aphrodisiac affects only characters whose desires/appraisals make it salient.
- Record impossibility with enabling conditions. “Flood cannot occur here” is too broad; state which upstream weather, river, structural, or magical conditions would make it possible.
- Treat atmosphere as perceived cues, not a command to feel a particular emotion.
- Do not encode social disapproval as physical impossibility. A norm, law, house rule, permission expectation, reputation risk, or likely objection is an observable pressure with possible responders and consequences. It removes an action only when a real barrier exists or another actor actually performs a successful intervention.
- For socially bounded spaces, store physical attemptability separately from whether permission is required and currently granted. Reaching the public side of a doorway is not the same event as crossing into the bounded zone.
- Keep an attempted violation distinct from successful completion. A person may draw a sword despite a house rule, be interrupted by the operator, frighten guests before stopping, or complete the action and suffer later consequences.
- Treat time and schedules as feasibility constraints. Entry and exit still require a character-owned cause.

## Scene validation counterexamples

Before marking `validated`, test at least:

1. An action that is impossible because the required object, route, permission, or condition is absent.
2. An opportunity that exists physically but is irrelevant to one character and highly salient to another.
3. Speech or gossip blocked by distance, privacy, noise, or a closed route.
4. A visitor who has completed a transaction but still has a personal reason to remain.
5. A character who may leave but is not expelled by a time label.
6. A physically possible but socially disapproved action that remains available to differently weighted Character Agents and produces consequences only after someone attempts it.
7. Two objectively usable positions with different exposure, sightline, traffic, and exit tradeoffs, neither of which the scene contract labels as the character's answer.
8. A worn or fixed object that follows its actor during movement and cannot teleport to furniture or another holder without the required explicit transition.
9. A visitor who can request one of several services, remain briefly without ordering, or leave, with no world-authored preferred answer and no automatic fulfillment.
10. A service request that stays pending until an operator perceives it and chooses a response; delivery, consumption, and settlement remain separate verified events.
