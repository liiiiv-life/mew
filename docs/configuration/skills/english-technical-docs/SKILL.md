---
name: english-technical-docs
description: "Connect installed documentation, writing-clearly-and-concisely, and translation specialists for English source documents or English target revisions. Design structure, refine English, finalize the source, then translate requested targets directly and review them with installed specialists."
---

# English technical documentation routing

This skill selects stages and languages. Read and apply the installed specialists; this entrypoint does not replace their editing or translation instructions.

1. Use the [shared workflow](../technical-docs-common/workflow.md) to establish scope, reader, and source language. New documents default to mew's effective response language; explicit requests and existing project/file language requirements take precedence.
2. For source structure work, read [documentation](../.vendor/documentation/SKILL.md). Preserve established internal specification and contract formats.
3. Refine English originals with [writing-clearly-and-concisely](../.vendor/writing-clearly-and-concisely/SKILL.md), loading its composition reference when needed. Compare technical meaning and protected content, then finalize the source.
4. For requested translations, follow the [translation routing](../technical-docs-common/translation.md). English targets use `translating-core` and `writing-clearly-and-concisely`, followed by `reviewing-translations` against the finalized source.

If English is only a target, start with the actual source-language entrypoint. Do not substitute a summary for a specialist's SKILL.md. Resolve shared references relative to this file's real location.
