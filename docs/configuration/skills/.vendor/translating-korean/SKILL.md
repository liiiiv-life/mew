---
name: translating-korean
description: Use when refining Korean translations for the requested locale and register, including speech level, honorifics, spacing, counters, loanwords, and concise UI copy.
---

# Translating Korean

## Overview

Revise an approved `translating-core` draft into natural Korean for the configured locale, market, audience, and product relationship. Preserve meaning, glossary decisions, placeholders, resource syntax, and protected values exactly.

This specialist covers common product Korean patterns, not every social or industry register. Do not claim native-speaker review.

## Capabilities

- `language:korean`
- `locale:ko`

## Entry Contract

Require an explicit locale or market and a speech level/register for each surface. “Korean” or “polite” alone is insufficient when the product relationship is undefined. If the locale or required register is missing, return one focused question through the orchestrator and withhold target copy.

Consume the core draft, source context, surface, audience relationship, glossary, protected terms, placeholder types/examples, and length constraints. Do not create copy before project setup and approval. Never install or download another skill at runtime.

Before finalizing a sentence whose actor is an opaque placeholder, record how the product handles Korean particles. If supplied examples have different final-sound behavior and the task declares neither an approved josa selector nor an approved particle-free message pattern, return one focused integration question and withhold that affected string. A newly invented wording is not an approved pattern.

## Refine the Draft

1. Preserve facts, actors, intent, approved terms, placeholders, code, links, markup, names, and identifiers.
2. Apply one consistent speech level and product voice. Keep concise UI labels compatible with the declared long-form style without forcing every label into a full sentence ending.
3. Add honorifics or honorific verb forms only when the referent and product relationship justify them. Never infer that a display-name placeholder is a person, senior, customer, or colleague.
4. Handle particles around placeholders deliberately. When the final sound of a runtime value is unknown, use an approved particle-selection function or rewrite the complete sentence naturally; do not hard-code one member of an `이/가`, `은/는`, `을/를`, or `으로/로` pair. Never append an invented type noun such as “account,” “user,” “team,” or “person” to make a convenient particle boundary. If no approved particle function or natural meaning-preserving rewrite exists, return one focused integration question through the orchestrator and withhold the affected string.
5. Choose counters from what is counted and the product meaning. Test zero, one, and larger representative values without renaming or separating placeholders.
6. Follow approved choices for native terminology, Sino-Korean terms, loanwords, abbreviations, and product names. Do not alternate them for stylistic variety.
7. Apply Korean spacing and punctuation to prose while keeping protected Latin strings, API names, versions, code, and URLs exact.

Use project context and pinned knowledge first. Research only a concrete unresolved current Korean market term, product convention, or usage question; record the source and decision through the orchestrator. Do not browse for routine grammar or every string.

## Product UI

State the action or result directly and keep labels parallel to adjacent controls. Avoid awkward nominalization, colon templates, or passive wording used only to escape a placeholder particle; a rewrite must still sound like ordinary Korean and preserve who acted. Check placeholder joins, count/counter order, truncation, wrapping, and screen-reader pronunciation.

## Long-Form Content

Maintain the approved speech level across instructions, conditions, explanations, and calls to action. Prefer clear Korean clause order over English noun phrases and causative chains. Shape approval conditions as a direct verbal clause—for example, make the plan receive `{userName}`'s approval—rather than stacking “regarding the plan,” “approval,” and “completion.” Resolve ambiguous pronouns from source context rather than silently inventing a referent.

## Common Literal-Translation Failures

- mixing `합니다`, `해요`, plain, and noun-label styles without a surface rule
- appending `님` or using honorific verbs for opaque placeholders without relationship evidence
- hard-coding a particle that fails for runtime values with a different final sound
- using colons, passive clauses, or heavy nominalization merely to avoid particle selection
- appending `계정`, `사용자`, `팀`, or another unverified type to an opaque placeholder
- choosing a people counter for an entity whose membership type is unknown
- copying English noun stacks, pronouns, or clause order into unnatural Korean
- alternating loanwords and translated terminology despite the glossary
- incorrect Korean spacing around bound nouns, particles, counters, or protected Latin terms
- changing placeholder names, code, API identifiers, versions, URLs, or product names

## QA Handoff

Pass source, core draft, revision, locale/market, speech level, relationship assumptions, glossary, placeholder examples, protected values, and constraints to `reviewing-translations`. Verify:

- meaning, actors, facts, names, numbers, links, placeholders, and structure remain complete
- speech level and honorific treatment match the configured audience consistently
- every placeholder-dependent particle works for representative Hangul, Latin, numeric, and bot/team values, or is avoided through a natural rewrite
- counters and surrounding agreement match the counted entity for representative values
- spacing, punctuation, terminology, loanwords, and abbreviations follow one approved convention
- UI copy is concise and ordinary in context; long-form prose flows naturally without stacked nominalizations
- protected values and executable syntax remain exact

Block the affected segment on missing locale/register, honorific assumptions, particle mismatch, counter errors, register drift, unnatural nominalization, ambiguous semantic invention, glossary inconsistency, or protected-value corruption. Return only the smallest failing segment to the responsible specialist.
