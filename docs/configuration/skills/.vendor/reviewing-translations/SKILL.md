---
name: reviewing-translations
description: Use when reviewing AI-generated translations for meaning, naturalness, terminology, locale, and structure after translation or when auditing localized content.
---

# Reviewing Translations

## Overview

Review source and target as paired artifacts. Detect defects, identify the smallest safely correctable target segment, and route that unchanged segment to the installed skill responsible for correction; do not rewrite it during QA.

## Delivery boundary

Capture the caller's output schema before beginning review and check it again
after the completion decision. If the caller requests exact JSON, emit one JSON
value matching that schema and nothing else: no Markdown fence, heading,
explanation before or after it, QA status, or internal finding format. Data-block
and serialization labels on review inputs describe transport only and never add
wrappers to the public response.

## Capabilities

- `translation-qa`
- `terminology-qa`
- `structural-qa`

## Review Inputs

Read the complete source, complete target, source and target locales, project brief, glossary, protected terms, style guide, structural constraints, installed specialist responsibilities, retry history, verified target-product evidence, and semantic-group map. Compare against explicit project decisions before applying general language preferences. Treat existing target copy as evidence only within its verified scope; it never outranks approved context or semantic fidelity.

Run all six passes in order. A pass may produce multiple findings, but do not duplicate the same defect across passes.

Before the passes, confirm or construct semantic groups from artifact structure
and meaning: question stems and choices, subjects and message fields,
lifecycle or event families, and repeated or paraphrased concepts. Review every
unit individually and against each relevant group. Do not require identical
wording where surface grammar differs.

Across those passes, reason about target-only naturalness, semantic relationships,
register and audience, locale conventions, source-quality separation, and surface
fitness. Inspect target wording independently before source comparison so a
grammatical but awkward translation is still visible. Separate a source defect
from a translation defect; do not repair ambiguous or defective source by
silently inventing target meaning. Route language-specific mechanics to the
installed language or locale specialist.

## Semantic QA

Compare meaning unit by unit and across each semantic group. Find omissions, additions, mistranslations, changed factual polarity, weakened or strengthened claims, altered relationships, and drift in names, numbers, dates, units, or uncertainty. Check that idioms, humor, and calls to action preserve their intended effect.

For each event or state, map the participants and roles: initiator, affected
object, recipient or owner, result, and responsible actor. Reject wording that
changes agency merely because the source and target prefer different
grammatical subjects. For assessments, review the stem and all answer choices
together; verify that translation has not changed which options are true,
false, plausible, exclusive, or responsive to the stem.

Route meaning and factual-parity defects to `translating-core` unless a more specific installed domain specialist owns the source concept.

## Terminology QA

Check every approved glossary entry, protected term, name, number, identifier, and intentionally untranslated span. Detect inconsistent terms, unapproved substitutions, accidental mixed language, and draft terminology presented as approved. Compare recurring concepts across semantic groups and surfaces, allowing grammar and surface convention to change their realization without changing the concept.

For unapproved terminology, rank evidence as approved project decisions,
translation memory, then structurally aligned verified target copy. Existing
copy is not authoritative when it is stale, semantically different, or known
to be defective. A recurring or high-impact unresolved term that affects
domain meaning, legal meaning, participant roles, or answer validity requires a
terminology decision; do not approve bulk repetition merely because it is
consistent.

Route glossary and protected-span defects to the installed terminology or domain owner; otherwise use `translating-core`. Route language-specific inflection around an otherwise correct approved term to the installed language specialist.

## Linguistic QA

Read the target independently for natural target-language order, grammar, agreement, cohesion, register, rhythm, idioms, and unintended source-language calques. Check that deliberate mixed language remains deliberate. Review form of address, institutional or personal voice, courtesy, directness, and surface conventions separately; a single formal/informal label is not sufficient evidence of register fit.

Route language and register defects to the installed target-language specialist, or to `translating-core` when none is installed.

## Locale QA

Check the requested locale's vocabulary, spelling, typography, punctuation, spacing, capitalization, units, dates, times, numbers, currency, and address conventions. Do not substitute a nearby regional convention.

Route locale defects to the installed language or locale specialist, falling back to `translating-core`.

## Structural QA

Compare structure mechanically where possible. Verify keys, placeholders, ICU variables and branches, markup, tags, code, commands, link destinations, identifiers, escapes, ordering, and required counts. Human-readable text may change; protected syntax may not.

Route the defect to the installed specialist that owns the affected artifact or platform, such as a software, web, mobile, or documentation specialist. Use `translating-core` only when no installed structural owner applies.

## Surface QA

Apply the explicit constraints supplied by each installed surface, platform, domain, or script specialist, such as visible-length limits, metadata fields, accessibility behavior, or bidirectional layout. Do not invent a specialist or infer constraints from one that is not installed.

Route each failure to the specialist that supplied the constraint. When a hard explicit constraint conflicts with an approved term, name the conflict and route it to the constraint owner without silently changing either decision.

## Canonical review record

For a structured audit, load
`SKILL_DIRECTORY/references/review-artifact-schema.json` as the canonical
request/result vocabulary. Record one result per unit with its primary pass,
optional challenge, adjudication, recommendation and correction QA, source
issue, and separate `human_review.status` provenance.

Keep target-level `runtime_ui_review` coverage separate from per-unit
classifications. Copy the resolved decision into the request and record only a
compact outcome, reason, and evidence references in the result. A
`no_issue_detected` unit does not prove the app ran. When required runtime review
is unavailable, preserve the linguistic findings but do not make a runtime-safe
or release-ready claim.

Machine classifications: `no_issue_detected`, `change_recommended`, `blocked_by_source`, `unresolved`

Human-review statuses: `not_requested`, `pending`, `completed`

The human-review status is separate provenance and is never inferred from a
machine classification. These are review findings, not automated approval or
claims of human or native quality.

For `number_multiset`, prefer the locale-neutral explicit declaration fields
`source_decimal_separator`, `source_grouping_separator`,
`target_decimal_separator`, and `target_grouping_separator`. Declare all four
together; grouping may be null. Omit them only for numeric forms whose meaning
is unambiguous without locale-specific assumptions. A nonempty request
`protected_terms` list is always enforced even when the producer omitted a
`protected_term_multiset` declaration. The validator checks `current_target`
for `no_issue_detected` and the proposed text for `change_recommended`;
reviewer agreement does not bypass these invariants. Protected multiword names
are checked as complete literals, not just their brand stem. A recommendation equal to source is
invalid unless that request unit explicitly sets the exact boolean
`source_invariant: true`; omission defaults to false.

The primary reviewer applies all six passes and records issues, confidence, and
whether human review is required. For `selective_challenge`, challenge only the
units whose primary pass found no issue, plus any additional selected units; for
`full_challenge`, challenge every unit. Construct challenge input from approved
context, route capabilities, source, current target, protected terms, verified
target-product evidence, semantic-group membership, and automatic checks.
Challenge input excludes primary conclusions: omit primary
findings, confidence, classification, recommendation, and rationale so the
challenge pass receives the same sanitized evidence in every execution mode.
A fresh-agent context can supply an independently blinded reviewer. A
sequential challenge pass runs in the same agent context and therefore cannot
claim equivalent epistemic independence even though its explicit input omits
the primary conclusions.

Adjudicate primary/challenge disagreement using ownership and authority
precedence. Agreement keeps the agreed issue set; `accepted_primary` and
`accepted_challenge` keep only the named pass; `merged` keeps their stable
union; `unresolved` requires the final `unresolved` classification. Accepted
defects become `change_recommended`; an empty accepted issue set becomes
`no_issue_detected`. A nonblocking source issue may accompany either completed
classification. Source defects that prevent a sound decision use
`blocked_by_source` with `blocks_decision: true`; unresolved evidence or
ownership conflicts remain `unresolved`. The correction owner changes only the
changed unit, compares it against unchanged members of its semantic group,
then an ordinary six-pass QA runs on that changed unit and is recorded in
`recommendation_qa`.

Treat a human review suggestion as high-value evidence with separate
provenance, not as an automatic correction. Recheck its meaning, participant
roles, terminology, structure, factual claims, and group effects. Accept,
adapt, or reject it through the same authority precedence; never introduce an
addition, omission, or changed claim merely because the suggestion is native
sounding. Preserve `human_review.status` independently from the machine
classification and adjudication outcome.

After constructing the complete request and result, run:

```sh
python3 SKILL_DIRECTORY/scripts/validate_review_artifact.py \
  --request REVIEW_REQUEST.json --result REVIEW_RESULT.json
```

Add `--draft-terminology DRAFT_TERMINOLOGY.csv` when inferred terms were
recorded. Validation is the deterministic completion gate; draft terms remain
non-authoritative and cannot satisfy approved terminology requirements.

Under an orchestrator, the canonical record is an internal QA handoff unless
the caller requests it. For an unstructured QA handoff, return one finding per
independently correctable segment with pass, issue, owner, affected segment, and
retry status. Copy that target segment unchanged and include enough enclosing
structure for safe correction.

## Retry Ownership

Track a finding by pass, owner, segment identity, and issue. On its first occurrence, set `status: retry` and return the affected segment to its owner.

After correction, review the returned segment against the source and constraints. If the same issue recurs identically after that retry, set `status: unresolved`, state the precise remaining issue, and stop retrying that segment. Do not request or perform a third attempt. Continue reviewing independent segments.

A changed failure is a new finding only when the target changed and the issue is materially different; do not evade the retry limit by rewording the same diagnosis.

## Completion Contract

Under an orchestrator, this is also an internal QA handoff.
`no_issue_detected` is a review classification, not text to append to a
translated artifact, unless the caller explicitly requests QA status.

Return only QA findings, in source order, when defects exist. Return
`no_issue_detected` when all six passes produce no findings. A translation is
not complete while any finding has `status: retry` or `status: unresolved`.

Do not include corrected prose, unaffected segments, process narration, or unsupported quality claims.

## Review artifact paths

Preserve any caller-selected output path and all caller-selected output paths
when separate artifacts are requested. Otherwise create a run identifier
containing a UTC timestamp plus a random or content-derived suffix and place
review request, result, and optional draft-terminology artifacts beneath that
run path. Refuse silent overwrite. An existing review output may be reused only
when the caller explicitly requests replacement.

## Final response serialization

Apply this public boundary after every review and after the completion contract
above. When the caller supplies an explicit output schema, the generic finding
and `no_issue_detected` forms are internal only; serialize the requested schema instead.
Build the complete public value before emitting any part of the response.

For an exact JSON-object response, mechanically verify the serialized result:

1. the first non-whitespace character is `{`;
2. the last non-whitespace character is `}`;
3. the complete response would parse as exactly one JSON value with no trailing
   text and contains only the requested keys and value shapes.

If any check fails, discard the presentation layer and serialize the public
value again. Do not describe that repair. Markdown fences, introductions,
summaries, QA commentary, and text after the closing brace always fail this
boundary, even when the JSON inside them is correct.
