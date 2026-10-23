---
name: translating-chinese
description: Use when refining Chinese translations for script and region, including Simplified or Traditional Chinese, classifiers, terminology, punctuation, and product conventions.
---

# Translating Chinese

## Overview

Revise an approved `translating-core` draft into natural Chinese for the configured script, region, market, audience, and register. Preserve meaning, glossary decisions, placeholders, resource syntax, and protected values exactly.

This specialist covers common product locales, not every regional or community variety. Do not claim native-speaker review.

## Capabilities

- `language:chinese`
- `locale:zh-Hans`
- `locale:zh-Hant`

## Entry Contract

Require both a script and an explicit region or market. Simplified (`zh-Hans`) and Traditional (`zh-Hant`) identify writing systems, not complete product locales; “Chinese,” “Simplified Chinese,” and “Traditional Chinese” alone are insufficient. If region or market is missing, return one focused question through the orchestrator and withhold all target copy.

Consume the core draft, locale/market, surface, audience/register, glossary for that exact locale, protected terms, placeholder examples, and length constraints. A term approved for Mainland China does not automatically approve its character-converted form for Taiwan, Hong Kong, Macau, Singapore, or another market.

Do not create target copy before project setup and approval. Never install or download another skill at runtime.

## Refine the Draft

1. Preserve facts, intent, names, approved terminology, placeholders, code, URLs, markup, and identifiers.
2. Choose vocabulary, function words, product conventions, and register for the configured region; do not invent “region-neutral” wording to avoid a missing market decision.
3. Treat Simplified/Traditional conversion as only a possible orthographic operation. Re-translate and review terminology, syntax, idiom, and product conventions for the target locale rather than mechanically converting characters.
4. Choose classifiers from the counted entity and regional usage. Check whether a classifier is required, optional, or unnatural in that UI context, and test representative values without renaming placeholders.
5. Prefer natural Chinese information order and omit source pronouns or articles when context permits. Preserve the actor when omission would change responsibility.
6. Apply locale-appropriate punctuation, quotation marks, and typography. Chinese prose normally has no spaces between Chinese words; add boundaries around protected Latin strings only when the configured style or readability requires them.
7. Keep UI concise and long-form prose coherent; do not force both into identical source-shaped sentences.

Use project context and pinned knowledge first. Research only a specific unresolved current regional term, market convention, or product usage; record the source and decision through the orchestrator. Do not browse for routine grammar or each string.

## Product UI

State the action, result, or status directly. Avoid redundant subjects, possessives, and English-style filler while retaining product meaning. Check classifier placement, placeholder boundaries, truncation, wrapping, and screen-reader speech. A button label should name the actual action, not mechanically reproduce every source word.

## Long-Form Content

Use consistent regional terminology and register across headings, instructions, conditions, and calls to action. Restructure causatives, passives, and product-as-agent claims into natural Chinese while preserving who or what causes the result. Maintain coherent transitions and reference chains rather than translating sentence by sentence.

## Common Literal-Translation Failures

- treating `zh-Hans` or `zh-Hant` as a complete market locale
- publishing supposedly cross-region “generic Chinese” without an approved market
- mechanically converting characters and assuming terminology and idiom remain valid
- copying a Mainland glossary term into Traditional Chinese, or the reverse, without a locale decision
- inserting a generic classifier for every count or omitting one where the phrase requires it
- retaining English word order, pronouns, passives, or product-as-agent constructions unnaturally
- adding spaces between Chinese words mechanically or corrupting protected Latin syntax
- mixing regional vocabulary, quotation marks, or UI conventions in one deliverable

## QA Handoff

Pass source, core draft, revision, full locale and market, register, exact-locale glossary, protected values, and surface constraints to `reviewing-translations`. Verify:

- script and region match the configured locale throughout; no unapproved cross-region mixture remains
- meaning, actors, facts, names, numbers, links, placeholders, and structure remain complete
- terminology is approved for this locale rather than merely character-converted
- classifiers and surrounding grammar work for representative runtime values
- punctuation, quotation marks, no-space conventions, and Latin boundaries fit the target market and format
- UI copy is concise and unambiguous; long-form prose has natural regional Chinese flow
- protected values, resource syntax, code, URLs, and identifiers remain exact

Block the affected segment on missing region/market, script mismatch, mechanical-conversion artifacts, regional terminology drift, classifier errors, literal phrasing, or protected-value corruption. Return only the smallest failing segment to the responsible specialist.
