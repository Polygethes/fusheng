# Calibration And Psychological Mathematics

## Separate weight from state

Use one shared family of functions with character-specific weights, thresholds, interaction terms, and current state.

For action candidate `a` considered privately by character `i`:

```text
U_i(a,t) = sum_k(w_i,k * f_k(a, perceived_world, body_i, emotion_i, memory_i, relationship_i,j))
           + interaction_terms
           - inhibition_costs
```

The formula returns private evidence for deliberation. The character Agent owns the final choice. The world supplies feasible affordances and resolves the attempted action.

## Candidate instantiation boundary

Do not store a character-specific list mapping situations to responses. Before utility is calculated, the shared cognitive core combines:

```text
candidate_set = instantiate(universal_action_primitives,
                            perceived_affordances,
                            reachable_targets,
                            held_objects,
                            current_open_loops)
```

Universal primitives include observing, moving, manipulating or transferring an object, communicating, waiting, concealing, refusing, and leaving. A foundation changes appraisal weights and thresholds; it does not add the answer from a calibration scenario. Hard feasibility removes impossible attempts. Social pressure remains a cost unless an actual barrier or committed intervention blocks execution.

## Competence, habit, and current performance

Keep stable competence and procedural habit separate from desire, personality, and temporary capacity:

```text
effective_competence_i,k(t) = base_competence_i,k
                            * state_capacity_i(t)
                            * context_familiarity_i,k(t)
                            * attention_available_i(t)
```

Use effective competence to change what cues are noticed, how many viable candidates are generated, how accurately costs and consequences are estimated, and how reliably a committed action is executed. It may make an expert preserve weapon control or choose a better sightline without turning either result into a fixed rule. The same expert can choose differently under fatigue, injury, distraction, urgency, or a changed goal.

## Embodied position choice

Let the world describe concrete positions with objective measurements. Let the Character Agent privately appraise them:

```text
U_i(position,t) = goal_fit
                + information_access
                + competence_fit
                + spatial_control
                + equipment_control
                + body_fit
                + exit_access
                - social_exposure
                - traffic_interference
                - switching_cost
```

Each term uses character-specific weights and current state. The formula is a psychological comparison tool, not a world-selected result. Never store `preferredPosition`, `characterFit`, rank, or expected choice in world input.

Treat object transitions as part of embodied feasibility:

```text
can_place_attached_object = possesses_object
                          * explicit_detach_or_draw_committed
                          * target_reachable
```

Movement carries attached equipment with the actor. A holder change, detachment, placement, or transfer must be caused by its own valid action rather than inferred from prose.

## Situated service choice

Let the venue publish only current offers, prices, availability, operators, transaction state, and observable customs. Combine those facts with the visitor's owned money and current body needs inside that visitor's private appraisal:

```text
U_i(service,t) = need_relief
               + stay_legitimacy
               + information_cover
               + comfort
               - price_cost
               - interaction_exposure
               - service_delay
               - switching_cost
```

The weights are character-specific and state-sensitive. This formula may make tea attractive to one visitor, a meal attractive to another, or non-consumption attractive to the same person at another time; it never creates an order by itself.

Preserve the causal transaction chain:

```text
guest request
  -> operator perceives and chooses a response
  -> world verifies any committed fulfillment
  -> guest receives or consumes
  -> payer and operator separately commit settlement
```

A request opens a pending thread only. It cannot auto-serve, auto-consume, deduct money, improve a relationship, satisfy an information goal, or make the operator answer. Occupying a table without ordering remains physically possible; the custom becomes a perceived social cost and can cause an operator response only after that operator notices and acts.

## Separate hard feasibility from social pressure

Hard feasibility answers whether the action can be attempted at all:

```text
hard_feasible = has_required_object
             * route_or_reach_exists
             * minimum_physical_capacity
             * minimum_execution_space
             * no_unbroken_material_barrier
```

Do not place etiquette, law, house rules, shame, reputation, expected objection, or possible punishment in this product. When the action is physically attemptable, expose those facts to the Character Agent as costs:

```text
social_pressure_cost = perceived_norm_strength
                     * visibility
                     * expected_sanction
                     * audience_importance
                     * character_norm_sensitivity
                     * relationship_modifiers
```

A compliant character may refrain, a calculating character may negotiate or conceal, and an impulsive or highly driven character may violate the same norm. The world does not preselect among them. If another person objects, that objection is a new perceived action; it blocks execution only if that person's later intervention actually succeeds.

For spatial entry, keep physical attemptability and social permission in separate fields:

```text
position.available = physically_attemptable_now
position.socialAccess = {
  permissionRequiredByNorm,
  permissionCurrentlyGranted,
  violationPhysicallyPossible,
  evidenceIds,
  possibleResponseTags
}
```

An open route into a household or staff work area may therefore remain an available attempt while carrying norm cost. Approaching the public side of a boundary is not itself a violation. Crossing it creates a visible event only after world commit; possible responders still require perception and their own Character-Agent choice.

## Desire pressure and recurrence

Keep desire strength independent from obstacles:

```text
desire_pressure = baseline
                + cue_activation
                + frustration
                + need_coupling
                + deadline_pressure
                - satiation
```

Update an unresolved desire without treating suppression as completion:

```text
D_next = clamp(retention * D_now
               + frustration_gain * frustration
               + cue_gain * new_cue
               - resolution_gain * verified_resolution)
```

High self-control can stop the current action while high retention keeps the desire alive.

## Subjective belief

Represent knowledge with source and confidence:

```text
B_next = B_now + learning_rate * source_reliability * evidence_strength * (observation - B_now)
```

Let hearsay change search priority or uncertainty without forcing the claimed fact to become believed.

## Appraisal and emotion

Derive domain emotion from appraised relevance rather than a global emotionality label:

```text
emotion_activation = goal_relevance
                   * novelty
                   * certainty
                   * domain_sensitivity
```

A socially cold character can therefore show strong excitement when a cultivation-relevant possibility appears.

## Inhibition

Score each inhibitor separately:

```text
inhibition_cost = physical_risk
                + body_cost
                + irrelevant_complication
                + relationship_harm
                + norm_or_identity_cost
                + current_obligation
```

Do not convert these costs into a weaker desire. A character may strongly want an action and still choose to wait.

## Environmental opportunity and temptation

Let the scene expose resources and opportunities without assigning interest:

```text
opportunity_salience = resource_availability
                     * perceptual_access
                     * desire_relevance
                     * expected_value
                     * novelty
```

The same object may strongly activate one character and leave another indifferent. Absence of a relevant resource should remove the opportunity term, not rewrite personality.

## Memory relevance

Use memory as issue salience and evidence, not as an external order:

```text
memory_pressure = cue_match
                * accessibility
                * retention
                * source_confidence
                * self_or_goal_relevance
```

Let appraisal and coping determine whether remembered pressure produces approach, avoidance, repair, assertion, or silence. A rumor may raise search priority while remaining uncertain.

Revise self-narrative only after a confirmed consequential choice backed by an owned episode. Preserve the prior claim as a version rather than deleting it.

## Post-choice continuity is two-stage

Before execution, the Character Agent may only propose qualitative directions:

```text
continuity_proposal = {
  action_memory_if_committed,
  desire_status_and_pressure_direction,
  dynamic_state_direction,
  self_narrative_candidate
}
```

After execution, settle each proposed change against its declared evidence gate:

```text
apply_internal_delta = action_committed
                    * settlement_condition_met

settlement_condition_met in {
  action_committed,
  verified_progress,
  verified_resolution
}
```

Doing an action is not proof that its expected reward occurred. A blocked or unsuccessful exchange may still create frustration, but it cannot grant progress, satisfaction, relief, or an identity-changing episode that the world did not actually produce. Keep pending self-narrative conflicts bounded until repetition or story significance supports consolidation.

## Relationship update

Use a vector rather than one affinity number:

```text
R_i,j,k(next) = clamp(R_i,j,k(now)
                      + sensitivity_i,k * appraised_impact_k
                      * memory_accessibility)
```

Update only supported dimensions. Keep competence respect, rivalry, trust, care, affection, fear, resentment, dependence, and obligation distinct.

## Speech as an action candidate

```text
speech_utility = goal_impact
               + truth_confidence
               + pressure_value
               + relationship_strategy
               - explanation_cost
               - exposure_cost
               - social_maintenance_cost
```

Compare speech with silence, movement, waiting, observation, and physical action. Do not manufacture dialogue merely because a scene tick occurred.

## Inferring ranges

Use behavior contrasts:

- Same desire, different audience -> infer public inhibition or approval sensitivity.
- Same opportunity, different evidence source -> infer epistemic weights.
- Same refusal, different relationship -> infer relationship modulation.
- Same obstacle, different goal relevance -> infer whether cost is general or domain-specific.
- Same stimulus, different body state -> infer state sensitivity rather than personality change.

Require repeated evidence before narrowing a range. Keep broad ranges when a decision remains context-dependent.
