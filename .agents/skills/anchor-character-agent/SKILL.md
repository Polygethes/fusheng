---
name: anchor-character-agent
description: Establish or revise a reusable scene and Character Agent from canon plus structured user interviews. Use when opening a new scene, adding a new character, correcting an existing character's psychology, defining scene ownership, resources, affordances, and information routes, calibrating desire and personality through controlled situations, anchoring distinctive speech and relationships, initializing source-aware memory, preserving story-open major choices, mapping one accepted payload into runtime authority surfaces, or validating that a character behaves consistently without letting mathematics or the world choose for them.
---

# Anchor Character Agent

Build an auditable scene-and-character packet before editing live runtime data. Reuse the anchoring method learned from Luo Zhao, never her personality, values, desires, voice, or numerical weights.

## Preserve the authority boundary

- Let the scene and world own objective facts, topology, resources, affordances, constraints, witnesses, information routes, and resolved consequences.
- Let hard feasibility remove only actions that cannot physically or causally be attempted. Treat etiquette, law, permission norms, shame, reputation, likely objection, and expected punishment as perceptible social pressures unless an actual barrier or another committed action blocks execution.
- Let each Character Agent own perception, belief, memory, desire, appraisal, relationship interpretation, candidate choice, speech, and silence.
- Let each Character Agent also own stance, position selection, facing, carried-object handling, and other embodied choices. The world may expose concrete positions and their objective tradeoffs, but it must not label one as character-fitting or preferred.
- Let a venue expose current services, prices, availability, operators, transaction state, and social customs without deciding whether a visitor consumes anything. A visitor owns whether and what to request; an operator owns whether and how to respond; delivery and settlement occur only through later committed actions.
- Let the world label objective food and currency classes. Let the character foundation own bodily dependence, conversion efficiency, acquisition access, and value sensitivity. Easy access to money never creates carried tender, and low need for food never forbids voluntary consumption.
- Use mathematics only inside the Character Agent to compare personal pressures. Never let a global score, scheduler, narrator, or world layer select the final action.
- Let the story layer recognize consequential history and self-change. Never let it prewrite a major choice.
- Treat presence as a caused action. A timetable may constrain feasibility, but it is not a reason to appear.
- Keep one live authority for every state. Generated summaries and prompt projections must point back to that authority.

## Create the work packet

Start one shared scene contract and one character folder:

    node .agents/skills/anchor-character-agent/scripts/init_anchor_workspace.mjs
      --root .codex/anchors
      --scene <scene-id>
      --scene-name <scene-name>
      --character <character-id>
      --name <character-name>

Reuse the same scene id when adding another character. The initializer preserves the accepted scene contract and creates a separate character packet.

The packet deliberately separates four authorities:

- `anchor-payload.json`: authoring index and evidence ledger;
- `character-foundation.json`: the only personality/psychology artifact eligible for Character-Agent input;
- `calibration-evidence.json`: controlled contrasts, accepted speech samples, relationship cases, and Holdouts used only for testing and compilation;
- `memory-seed.json`: only memories the character can own.

Never merge these files for prompt convenience. Existing v1 authoring records may remain as immutable migration sources, but their compiled foundation and calibration suite must still be separate.

Read [interview-and-gates.md](references/interview-and-gates.md) before interviewing. Advance one gate at a time. Ask one to three questions per turn and record the answer before inferring a rule.

## Gate 0: establish scope and sources

1. Name the story time, scene, character, and intended runtime.
2. Read the selected source material and distinguish canon, user-confirmed answers, runtime defaults, generated output, and unknowns.
3. Trace the current live files and symbols for scene facts, psychology, voice, relationships, memory, presence, candidate choice, and validation.
4. Mark conflicting sources. Do not average them or silently choose the most convenient one.
5. State the authority boundary to the user before calibration.

## Gate 1: confirm the objective scene

Complete the shared scene contract before asking what the character wants there. Follow [scene-contract-schema.md](references/scene-contract-schema.md).

Confirm:

- ownership, operator, or institution;
- zones, routes, privacy, distance, and visibility;
- concrete standing, sitting, working, watching, and transit positions inside a zone, with neutral facts such as sightline, exposure, traffic, reach, and exits;
- resources, valuable objects, services, temptations, and hazards;
- physically available actions and required preconditions;
- socially discouraged, forbidden, embarrassing, dangerous, or costly actions that remain physically attemptable, plus their observable cues and possible consequences;
- impossible events and the enabling conditions that would make them possible;
- public roles, responsibilities, and transaction procedures;
- current service offers and prices, plus separate visitor-request, operator-response, fulfillment, and settlement steps; no request may imply automatic delivery, payment, or satisfaction;
- objective sustenance class for food and drink, including mundane nutrition, spiritual nutrition and hydration; the venue cannot assume equal value for every body;
- currency class and settlement requirements, keeping mundane copper distinct from cultivation resources and current liquidity distinct from long-run acquisition ease;
- object possession, wear or attachment state, and the explicit transitions required to draw, detach, place, hand over, consume, or store an object;
- entry and exit affordances;
- direct observation, overhearing, messenger, rumor, and gossip routes, including distortion;
- atmosphere and current pressures.

Keep opportunities character-neutral. A sword can exist without attracting every character. A rumor can propagate without becoming true.

Run the scene counterexamples before marking this gate confirmed:

- an unsupported disaster cannot occur;
- a private-zone event is not directly perceived from the public room;
- a completed transaction does not force departure;
- a schedule does not summon a visitor;
- an attractive resource only matters to a character whose psychology appraises it as relevant.
- a norm-violating action remains available when physically possible; different Character Agents may comply, negotiate, conceal, or violate it, and the world resolves the resulting responses and consequences.
- a visitor may request tea, food, water, another service, sit without buying, or leave according to their own appraisal; the scene cannot mark one answer as proper, and an operator's response requires that operator's later perception and choice.

## Gate 2: confirm the character fact card

Separate material into:

- confirmed facts;
- inferences awaiting confirmation;
- unknowns;
- incompatible claims;
- story-open choice axes.

Also confirm why the person is here now, the causal entry trigger, current purpose, public role, body state, possessions, direct knowledge, reported knowledge, and prohibited knowledge. Anchor sustenance physiology separately from appetite: ordinary-food dependence, fasting band, conversion efficiency, alternative nourishment and state-triggered exceptions. Anchor material position separately from current cash: currency domain, acquisition ease, strategic value, conversion friction, debts and carried tender. Record current outward physical surfaces separately as world-facing signal features: modality, the literal visible/audible/smell surface, domain tags, strength, and whether it is actually being emitted now. A robe, callus, gait sound, breathing rhythm, or scabbard wear may be a signal; a real identity, skill level, hidden intention, relationship meaning, or temperament conclusion may not. A latent voice quality is not an active sound until the person speaks, and dynamic clothing or injury signs belong to current world state rather than permanent psychology. Confirm sensory disability or training separately from personality: blindness removes visual reception but does not automatically grant enhanced hearing. Separate personality and desire from trained competence, procedural habit, and current performance capacity. A swordsman's spatial awareness or habit of keeping a weapon on-body is neither a desire nor a prewritten action.

Do not assign numbers yet. Do not import Luo Zhao's profile. Mark this gate confirmed only after the user accepts the fact card.

## Gate 3: calibrate desire and psychology

Start with a concrete positive state the character wants for themself. Separate it from duty, inhibition, fear, principle, and judgment about another person.

Use controlled contrasts. Change one condition at a time:

- public versus private;
- near versus far;
- direct evidence versus rumor;
- stranger versus intimate;
- rested versus exhausted or injured;
- cheap versus costly;
- mundane food versus spiritual food, and mortal-frequency hunger versus long-fasting cultivation physiology;
- carried cash versus easy access to the same currency after a real acquisition action;
- available resource versus absent resource;
- first block versus repeated frustration;
- low consequence versus identity-threatening choice.

Ask what the person notices, wants, does, says, suppresses, postpones, and later returns to. Record evidence ids, scope, counterevidence, inferred ranges, and confidence.

Calibrate perception through the same controlled-contrast method: what enters the person's sensory range, what wins finite attention, what they routinely miss, what their profession lets them decode, how overload changes fidelity, whether they ask or observe, and how much inquiry would reveal about their own goal. Compile these as ranges in `perceptionProfile`; never compile one preferred question, position, target, or response.

Record the questions and answers in `calibration-evidence.json`. Compile only reusable ranges, cost sensitivities, epistemic tendencies, desire dynamics, relationship dimensions, and expression tendencies into `character-foundation.json`. A calibration answer is evidence about a mechanism; it is not a future action rule.

Use [calibration-model.md](references/calibration-model.md) for variables and update functions. Infer ranges rather than decorative precision. Keep stable dispositions apart from dynamic body, emotion, belief, desire pressure, and relationship state.

Do not confuse:

- waiting with care;
- combat respect with trust or intimacy;
- public restraint with shame;
- leaving with desire satisfaction;
- a service duty with a personal desire;
- knowledge of a rumor with belief in the rumor.

## Gate 4: anchor action, speech, and relationships

Do not compile character-specific `situation -> action` families. Confirm instead which personal variables change appraisal: directness, control, exposure cost, effort cost, evidence threshold, delay tolerance, harm aversion, relationship sensitivity, and similar reusable parameters. Calibrate perceptual and procedural competence separately: what the person reliably notices, what alternatives they can generate, how fluently they execute, and how fatigue, injury, distraction, or unfamiliarity degrades performance. Competence shapes perception, candidate quality, feasibility estimates, and execution reliability; it never supplies the desire or final choice.

The generic cognitive core must first transform objective world signals through the person's sensory channels, finite attention, current body state, desire relevance and trained decoders. Only noticed evidence may enter owned memory. It then forms concrete candidates from that private evidence, the world's current affordances, and universal action primitives such as observe, listen, reposition, ask, move, use or transfer an object, wait, conceal, refuse, and leave. Asking is an information action with possible self-disclosure and bad presuppositions, not a required dialogue beat. The Character Agent may choose a non-top-scored feasible candidate. The world may reject an impossible attempt and resolve consequences, but neither the world nor the calibration record chooses the intention.

Treat service use as ordinary Agent action, not venue automation. A guest request opens a pending transaction thread; it does not create an accepted order, delivered item, consumed item, payment, relationship change, or completed purpose. The operator must perceive that request and make a separate Character-Agent choice before the world can resolve fulfillment. Sitting without ordering remains physically attemptable when space is available; house custom enters appraisal as social pressure and may prompt a later operator action.

Anchor speech as goal-directed action. Test at least:

- pressure or challenge;
- genuine evaluation or surprise;
- commitment, refusal, or departure.

Derive directness, sentence shape, explanation cost, preferred pragmatic forms, pressure mutation, praise conditions, relationship registers, silence conditions, and forbidden generic replies. Preserve exact accepted lines only in `calibration-evidence.json`. Compile aggregate shape and functional tendencies; never expose samples, sample regexes, or whole-sentence lexicon to the Agent.

Model relationships as dimensions such as trust, warmth, fear, obligation, respect, resentment, attraction, and power. Keep observed calibration cases outside runtime; compile only reusable appraisal sensitivities and dimension-update tendencies. Update only dimensions supported by an act the character perceived. Relationship state modifies appraisal, inhibition, target choice, and speech register; it never overwrites the character's own desire.

## Gate 5: initialize source-aware memory

Use the separate memory seed described in [anchor-payload-schema.md](references/anchor-payload-schema.md) and [runtime-mapping.md](references/runtime-mapping.md).

Store only events the character could have perceived or reports they received. For each seed, preserve:

- source and evidence type;
- time and place;
- direct observation, inference, testimony, or rumor status;
- confidence and possible distortion;
- emotional and self-relevance;
- commitments and unresolved loops;
- relationship target and affected dimensions;
- self-narrative claim when relevant.

If no prior memory is authorized, state an explicit empty reason. Never invent a convenient shared history. Major self-change requires consequential evidence, prediction error, and later consolidation; one dramatic beat does not rewrite identity automatically.

## Gate 6: validate with unseen holdouts

Create at least three situations not used during calibration:

1. a stereotype counterexample;
2. a changed evidence, relationship, body, or environmental condition;
3. a blocked desire or consequential choice.

Treat the Character Agent, not the author, as the blind subject. Give the Agent only the accepted character foundation, current state, relationship and memory state, objective scene facts, and concrete candidates formed by the generic cognitive core from current affordances. Require a compact auditable projection containing perceived facts, activated pressures, multiple feasible or attemptable candidates, chosen action, speech or functional silence, expected world consequences, relevant memory retrieval, and dimension-specific relationship effects.

Show that Agent-derived projection to the author and ask only for authenticity acceptance or correction. Do not ask the author to prewrite what the character does. When rejected, diagnose whether the cause is a missing foundation fact, a wrong weight or qualitative range, an epistemic boundary error, a relationship error, a missing world or service affordance, a forced or auto-completed transaction, an invalid object/attachment transition, a missing competence or procedural-habit model, a preselected spatial answer, or an invalid consequence model. Do not add a one-scene `situation -> response` rule unless the author explicitly confirms a reusable mechanism and its scope.

Mark the anchor validated only after three holdouts pass. Keep unresolved story choices unresolved.

Store Holdout situations, predictions, corrections, and acceptance only in `calibration-evidence.json` and the human-readable `holdouts.md`. They must never appear in Agent prompts, candidate policy, autobiographical memory, preferred lexicon, or fixed relationship rules.

## Gate 7: map one accepted payload into runtime

Follow [runtime-mapping.md](references/runtime-mapping.md). Name one exact path and symbol for every live authority:

- scene facts;
- current world-facing physical signal surfaces;
- psychology and appraisal;
- voice;
- relationships;
- memory;
- presence and travel;
- candidate compilation and Character-Agent choice;
- validation and consequences.

Keep generated prompt cards, UI summaries, and observer prose as derived projections. Reject an unknown, blocked, retargeted, or affordance-swapped candidate id instead of substituting a director-selected action.

The authoring record and calibration suite may be read by an offline compiler or checker. The live Character Agent may receive only the sanitized `character-foundation.json` projection, owned memory, perceived world state, subjective relationships, and candidates produced by the generic cognitive core. Fail the runtime gate if author evidence, calibration answers, Holdouts, exact speech samples, `actionPolicy.candidateFamilies`, or character-specific cognitive update scripts appear on the Agent surface.

Run:

    node .agents/skills/anchor-character-agent/scripts/check_anchor_workspace.mjs
      --root .codex/anchors
      --scene <scene-id>
      --character <character-id>
      --gate runtime

## Gate 8: prove behavior, not field presence

Add and pass causal counterexamples for:

- a non-highest-score feasible choice made by the Character Agent;
- an unresolved desire surviving delay, transaction completion, departure, and return;
- direct knowledge differing from rumor;
- distance and privacy blocking propagation;
- relationship closeness changing expression without erasing a triggered desire;
- speech changing with function and relationship rather than using one generic register;
- body or dynamic state changing behavior while stable character weights remain the same;
- a new scene and non-Luo character using the same process without inheriting Luo Zhao's traits.

Inspect visible output for timing, target, location, causality, distinctive language, and relationship consequence. Passing a schema test alone does not prove a living character.

## Completion gate

Do not call the process complete until:

- the scene contract is user-confirmed;
- the fact card separates fact, inference, unknown, conflict, and story-open choice;
- desire is positive, concrete, and self-owned;
- opportunity, inhibition, body state, relationship, and memory remain independent inputs;
- speech has at least three functional evidence anchors;
- memory sources and epistemic limits are explicit;
- at least three unseen holdouts passed;
- calibration samples and Holdouts remain outside runtime input;
- concrete action candidates come from the generic cognitive core, not a character-authored action menu;
- position candidates contain objective spatial tradeoffs rather than author-declared character fit, and the Character Agent chooses among them;
- services expose neutral offers and a causal request-response-fulfillment-settlement chain; neither consumption nor non-consumption is preselected, and each person's step belongs to that person's Agent;
- possession, attachment, object state, and location remain distinct; attached equipment cannot be placed or transferred without an explicit detach/draw transition;
- competence and procedural habit influence noticing, candidate formation, execution, and uncertainty without becoming desire or a fixed response;
- sensory channels, attention ranges, professional decoders and information style are explicit; raw signal delivery is not treated as conscious evidence or memory;
- confirmed outward surfaces are mapped to current world `publicSignalFeatures` as physical signals, while hidden intent, identity and skill conclusions remain absent;
- runtime mapping names exact live authorities without duplicates;
- causal behavior tests pass for the new character and scene;
- the remaining unknowns and architecture gaps are reported plainly.

Use [validated-example-luozhao.md](references/validated-example-luozhao.md) only to understand the completed evidence chain. Never use it as a personality template.
