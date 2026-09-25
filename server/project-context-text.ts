import fs from 'node:fs'
import path from 'node:path'
import { ragAgentGuidance } from './rag/guidance.ts'
import { readAgentGuidance } from './agent-guidance.ts'
import { commitSkillGuidance } from './mew-skills.ts'
import type { AgentContextBinding, ProjectAgentSettings } from '../shared/project-agent-context.ts'

export const CONTEXT_START = '<mew-context version="1">'
export const CONTEXT_END = '</mew-context>'

export function describeAgentContext(binding: AgentContextBinding, settings: ProjectAgentSettings, cwd: string): string {
  if (!settings.enabled) return ''
  const candidates = [path.join(binding.projectRoot, 'AGENTS.md'), path.join(binding.projectRoot, 'README.md'),
    ...['AGENT.md', 'README.md', 'MOC.md'].map(p => path.join(binding.docsRoot, p)),
    ...settings.entrypoints.map(p => path.join(binding.projectRoot, p))]
  if (cwd !== binding.projectRoot) candidates.push(path.join(cwd, 'AGENTS.md'), path.join(cwd, 'README.md'), path.join(cwd, 'docs/MOC.md'))
  const entries = [...new Set(candidates)].filter(p => { try { return fs.statSync(p).isFile() } catch { return false } })
  return [
    readAgentGuidance(),
    commitSkillGuidance(),
    ragAgentGuidance(binding.projectRoot, binding.docsRoot),
    `Project root: ${JSON.stringify(binding.projectRoot)}`,
    `Working directory: ${JSON.stringify(cwd)}`,
    `Documents folder: ${JSON.stringify(binding.docsRoot)}`,
    `Documentation boot paths (read if present):\n${['AGENT.md', 'README.md', 'MOC.md'].map(p => `- ${JSON.stringify(path.join(binding.docsRoot, p))}`).join('\n')}`,
    entries.length ? `Existing entrypoints (paths, not document contents):\n${entries.map(p => `- ${JSON.stringify(p)}`).join('\n')}` : 'No entrypoint documents found yet. Use the existing project structure; Documents setup is available from its settings in mew.',
    settings.entrypoints.length ? `Configured entrypoints (report missing files):\n${settings.entrypoints.map(p => `- ${JSON.stringify(path.join(binding.projectRoot, p))}`).join('\n')}` : '',
    settings.instructions ? `Additional project guidance:\n${settings.instructions}` : '',
  ].filter(Boolean).join('\n\n')
}

export function contextBlock(text: string): string {
  return `${CONTEXT_START}\n${text}\n${CONTEXT_END}`
}

/** Adapters may concatenate ACP text blocks when replaying history. */
export function stripMewContext(text: string): string {
  if (!text.includes(CONTEXT_START)) return text
  return text.replace(/\s*<mew-context version="1">[\s\S]*?<\/mew-context>/g, '').trimEnd()
}
