# Product

## Register

product

## Users

Novelists, screenwriters, game narrative designers, interactive-fiction creators, directors, and character creators who are actively shaping scenes, memories, relationships, branches, and canon in a deep narrative sandbox.

## Product Purpose

Character Town helps users create complex characters, place them inside a pressure field, run real-time character simulation, inspect private motives and visible actions, then decide what becomes canon. Success means the interface lets users steer narrative state without flattening characters into plot functions.

## Current Scope

The shipping product is not yet the general sandbox described above. It is one fixed stage — the Wangti Tavern of *Xiaoyaoyou* — with seven authored characters, and depth in that single setting is the current bet: character ids, ecology profiles, relationship seeds, voice contracts and portraits are all authored against it, and the setup flow opens pre-filled rather than blank.

As of 2026-10-09 a second stage runs on the same v2.7 runtime: worlds are world packs (`src/worlds/<id>/pack.mjs`), and *借星* (藏星谷 · 顾家) is authored from a user beacon, validated and smoke-tested alongside the tavern. The pixel stage observer (`/stage.html`) replays and follows runs of any registered pack.

Generalisation is still partial. New worlds are authored by hand from a beacon (no automatic world compiler), the main UI and the legacy scene pipeline remain tavern-only, the blank-world setup flow is still red, and relationship dimensions are fixed to the tavern's set. Describe the product as a multi-stage character simulator whose stages are authored packs, not as a tool that builds any world from a prompt.

## Brand Personality

Precise, dramatic, severe. The product should feel like a serious control room for human contradiction: analytical enough to trust, theatrical enough to invite risk, and calm enough for repeated use.

## Anti-references

Avoid generic SaaS dashboards, cozy writing-app paper textures, fantasy RPG character sheets, decorative glassmorphism, warm beige editorial layouts, and interfaces that make the model feel like an automatic novel generator.

## Design Principles

1. Preserve the operator role: the user should always feel they are steering state, not reading passive output.
2. Make hidden structure visible: motives, misreadings, evidence, branches, and simulation ticks should be inspectable without burying the scene.
3. Treat drama as state: visual emphasis should reveal pressure, contradiction, and irreversibility.
4. Keep tools familiar: standard controls, dense panels, and predictable navigation matter more than novelty.
5. Let the aesthetic sharpen the work: geometric composition can create tension, but it must not obscure workflow.

## Accessibility & Inclusion

Target WCAG AA contrast for core text and controls. Support keyboard-visible focus, reduced motion, clear disabled states, and color-independent status cues.
