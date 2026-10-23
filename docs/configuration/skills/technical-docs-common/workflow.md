---
description: "공통 문서화 연결 흐름. 원문 언어와 범위를 정한 뒤 설치된 구조·언어별 교정·번역 전문 스킬의 실제 원문을 단계별로 적용한다."
---

# Documentation skill orchestration

Read the selected upstream SKILL.md files at the actual paths below. Their original instructions and supporting files are installed at pinned revisions, not replaced with locally written editing rules. [dependencies.json](../dependencies.json) records roles, source commits, licenses, and file hashes.

## Source language and scope

Use explicit source/document-language requests first, then established project or existing-file language requirements, then mew's effective response-language setting, then the user's message language. A setting change sets a default for new documents; it does not authorize converting existing files or creating every translation.

| Language | Source editor | Translation specialist | Entry point |
| --- | --- | --- | --- |
| Korean | [korean-writing-reviewer](../.vendor/korean-writing-reviewer/SKILL.md) | [translating-korean](../.vendor/translating-korean/SKILL.md) | [Korean](../korean-technical-docs/SKILL.md) |
| English | [writing-clearly-and-concisely](../.vendor/writing-clearly-and-concisely/SKILL.md) | [translating-core](../.vendor/translating-core/SKILL.md) | [English](../english-technical-docs/SKILL.md) |
| Japanese | [yomiyasu](../.vendor/yomiyasu/SKILL.md) | [translating-japanese](../.vendor/translating-japanese/SKILL.md) | [Japanese](../japanese-technical-docs/SKILL.md) |
| Simplified Chinese | [tech-doc-style-chinese](../.vendor/tech-doc-style-chinese/SKILL.md) | [translating-chinese](../.vendor/translating-chinese/SKILL.md) | [Chinese](../chinese-technical-docs/SKILL.md) |

Preserve custom language instructions. Ask only when missing information would materially change the result, while continuing independent work. An unsupported language is not permission to substitute a supported one. Missing specialist files must be reported with their actual paths; do not invent a replacement and claim the specialist ran.

## Source preparation

1. Follow project entrypoints, discovery, ownership, current/history boundaries, and execution restrictions. Determine the requested scope and reader from available context.
2. For structure work, read the installed [documentation](../.vendor/documentation/SKILL.md), using the [project adaptation](structure.md). For a phrasing-only task, keep the approved structure.
3. Read the source editor from the table and its relevant references. Pass the document role, audience, existing terminology/style, requested edit or review mode, and protected technical content. Avoid loading unrelated profiles. Existing authorization and project rules apply to all stages; do not repeat questions whose answers are already established.
4. Check the edited source against the original for conditions, exceptions, actor responsibility, uncertainty, code, links, and implemented/planned/verified status. Run applicable specialist tools and project checks. Do not claim runtime verification for unexecuted examples.
5. Finalize a single source revision for the translation stage. When edits and translations are requested together, this is an internal handoff after verification, not a new approval question. A translation-only request uses the supplied source without rewriting it.

## Translation and completion

Only requested translations proceed through [the translation sequence](translation.md). Each language is translated directly from the same finalized source. Target-specific refinement and the target's source editor both run before final source-target QA; later corrections are rechecked against that source.

A review-only request returns findings without editing files. Do not add unsolicited scoring, translation registries, publishing steps, or permanent QA artifacts. Use an unstructured internal review handoff unless the user requests a structured audit. Apply subagent guidance only within the session's actual delegation permissions; when unavailable or unauthorized, run the stages in the current agent without claiming independent review.

Report actual document changes, specialist stages used, checks performed, and remaining uncertainty. Identify translated languages. Source-only edits leave unrequested counterparts unchanged and report affected versions when relevant.
