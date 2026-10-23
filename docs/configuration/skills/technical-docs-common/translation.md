---
description: "실제로 설치한 translating-core·translating-documentation·언어별 번역 스킬·reviewing-translations를 원문에서 대상 언어로 연결하는 순서와 전달 정보."
---

# Translation specialist sequence

## Handoff from the finalized source

Read [translating-documentation](../.vendor/translating-documentation/SKILL.md) and [translating-core](../.vendor/translating-core/SKILL.md). Supply the complete source, source language, each requested target, reader and documentation surface, approved structure, existing glossary and UI labels, protected syntax, and reference mapping. Translate directly from this source; do not relay through Korean or English.

Use the project's known regional and style choices. The supported Korean, Japanese, and Chinese defaults are `ko-KR`, `ja-JP`, and `zh-CN` (Simplified Chinese, Mainland China). English uses the project's established variant; retain locale-neutral wording when no regional distinction is needed. Infer register from existing documents and purpose, and state that decision in the internal brief. Ask only about a material unresolved choice. A user-authorized translation with this resolved brief satisfies setup/authorization; it does not need a second approval flow.

## Translation, target refinement, and editing

1. `translating-documentation` classifies translatable prose and protected document structures. `translating-core` produces the meaning-faithful target draft.
2. Read the target specialist: [Korean](../.vendor/translating-korean/SKILL.md), [Japanese](../.vendor/translating-japanese/SKILL.md), or [Chinese](../.vendor/translating-chinese/SKILL.md). English uses core's naturalness guidance. Pass the source, core draft, resolved locale/register, glossary, and protected content. This stage handles translation-specific linguistic mechanics.
3. Read the target editor from [workflow.md](workflow.md) to refine target sentences and paragraphs. Preserve the finalized source structure and factual meaning; this stage does not independently redesign the document.
4. Read [reviewing-translations](../.vendor/reviewing-translations/SKILL.md) and run its paired-artifact QA after all target editing. Use the supplied specialist ownership when returning a defective span for correction, then recheck the corrected span against the unchanged source. Honor its retry limit and report unresolved issues accurately.

Use the ordinary internal QA handoff for normal document translation. Structured audit records, independent challenge reviewers, and validator artifacts apply when that mode is actually requested and supported. Do not claim native-speaker or human review. Do not publish or execute code while translating. Project-specific safe checks take precedence over a specialist's example execution suggestions.

Update only the source and targets in the requested task. Protect placeholders, commands, code, identifiers, diagrams, URLs, and machine-owned frontmatter. Change translated headings or links only using the project's verified mapping, and check resulting anchors with the actual renderer.
