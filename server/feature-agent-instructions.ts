import path from 'node:path'
import type { FeatureRun } from '../shared/features.ts'

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

/** Owned by mew, identical for every selected agent preset and ACP runtime. */
export function featureAgentInstructions(directory: string, workspace: string, run: FeatureRun): string {
  const command = [process.execPath, path.join(import.meta.dirname, 'feature-cli.ts'), directory, workspace, run.id].map(quote).join(' ')
  return `${run.agentSet.role}

<mew-feature-request version="1">
This is a user-authorized feature implementation request managed by mew. Follow the project's existing instructions and documentation contracts. Work only on the requested feature. Do not start unrelated requests. Feature definitions are Markdown files under this project's Documents/features directory; their paths appear as documentPath in the list. Those files are the canonical feature specifications. Do not create a second feature specification elsewhere. Keep installation, operations, ADRs and shared guidance in their existing owning documents. Use the common commands below for assignment and result recording; do not directly edit mew's runtime state files. Ordinary external Markdown edits are allowed but never trigger a new run automatically.

Request: ${JSON.stringify({ title: run.title, content: run.content, targetId: run.targetId, parentId: run.parentId })}

1. Before changing project code, run this common mew command to inspect the current feature tree and versions:
${command} list
2. Decide whether this is a new independent feature, an update to an existing feature, or a child feature. Preserve existing IDs and history. Honor targetId (update that feature) and parentId (create a child there) when present. For ambiguous scope, ask the user in the conversation; do not invent completed work.
3. Connect this request to its feature by sending exactly one JSON object on stdin to:
${command} assign
Use a quoted shell heredoc or a temporary JSON file; never interpolate user text into shell commands.
Schema: {"action":"new|update|child","title":"full feature title","content":"full requirements after merging this request","reason":"brief classification reason","featureId":"existing ID for update","version":CURRENT_EXISTING_FEATURE_VERSION,"parentId":"parent ID for child"}.
Omit irrelevant ID/version fields. Keep existing requirements when updating; do not replace the whole feature with only this request's delta. On version conflict, reread the tree. If the user edited the specifically targeted feature after submitting this request, stop and explain the conflict instead of overwriting it.
4. Only after assign succeeds, implement the feature, run appropriate verification and update other owning project documentation as needed. For the assigned feature document, use assign for requirements and report for implementation results; editing it directly after assignment changes its version, so completion will preserve that edit and keep this run's result only in history. The assigned item is blue while you work. Do not claim user verification or set green/red yourself.
5. As your final tool action after implementation and verification, send JSON on stdin to:
${command} report
Schema: {"summary":"what changed and why, plus limitations","validation":"checks actually performed and results","files":["project-relative/file.ts"],"commits":[{"repository":"project-relative repository root, or empty string for current root","hash":"real commit hash"}]}.
Record only actual relevant files and commits. An empty commits array is valid; this request does not require an automatic commit. Existing uncommitted work must not be attributed to you. Deleted files may be listed only when a linked commit records the deletion; otherwise describe them in summary. Never include secrets in reports.
6. If the report command rejects a file or commit, correct the report using real evidence. After the report succeeds, finish with a concise answer to the user. mew marks mint only after both a valid report and normal turn completion. User edits made during this run are preserved.
</mew-feature-request>`
}
