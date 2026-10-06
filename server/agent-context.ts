import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_DIR, writeFileAtomic } from './dataDir.ts'
import { workspacePaths } from './paths.ts'
import { defaultAgentSettings, projectDocsDir, readProjectAgentSettings, SETTINGS_PATH } from './project-agent-settings.ts'
import { contextBlock, describeAgentContext } from './project-context-text.ts'
import type { AgentContextBinding } from '../shared/project-agent-context.ts'
import { ensureAgentGuidance } from './agent-guidance.ts'

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function parseAgentContext(value: unknown): AgentContextBinding | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Partial<AgentContextBinding>
  if (typeof v.projectRoot !== 'string' || typeof v.docsRoot !== 'string' || !path.isAbsolute(v.projectRoot) || !path.isAbsolute(v.docsRoot)
    || v.docsRoot === v.projectRoot || !inside(v.projectRoot, v.docsRoot)) return null
  return { projectRoot: path.resolve(v.projectRoot), docsRoot: path.resolve(v.docsRoot) }
}

/** Called in the parent before launching a detached host; never borrow an unrelated active project. */
export function captureAgentContext(cwd: string): AgentContextBinding {
  if (process.env.MEW_AGENT_CONTEXT) {
    const inherited = parseAgentContext(JSON.parse(process.env.MEW_AGENT_CONTEXT))
    if (inherited && inside(inherited.projectRoot, cwd)) return inherited
  }
  const root = path.resolve(cwd)
  // An explicitly configured nested project owns its own context.
  let candidate = root
  while (true) {
    if (fs.existsSync(path.join(candidate, SETTINGS_PATH))) return { projectRoot: candidate, docsRoot: path.join(candidate, projectDocsDir(candidate)) }
    if (candidate === workspacePaths.root) break
    const parent = path.dirname(candidate)
    if (parent === candidate) break
    candidate = parent
  }
  if (inside(workspacePaths.root, root)) return { projectRoot: workspacePaths.root, docsRoot: workspacePaths.docsRoot }
  return { projectRoot: root, docsRoot: path.join(root, projectDocsDir(root)) }
}

export function refreshAgentContext(binding: AgentContextBinding): AgentContextBinding {
  return { projectRoot: binding.projectRoot, docsRoot: path.join(binding.projectRoot, projectDocsDir(binding.projectRoot, path.relative(binding.projectRoot, binding.docsRoot))) }
}

export function agentContextText(binding: AgentContextBinding, cwd: string): string {
  const settings = readProjectAgentSettings(binding.projectRoot) ?? defaultAgentSettings(path.relative(binding.projectRoot, binding.docsRoot))
  if (settings.enabled) ensureAgentGuidance()
  const text = describeAgentContext(binding, settings, cwd)
  return text ? contextBlock(text) : ''
}

function bindingFile(runtime: string, cwd: string, sessionId: string): string {
  const hash = crypto.createHash('sha256').update(JSON.stringify([runtime, cwd, sessionId])).digest('hex')
  return path.join(DATA_DIR, 'agent-contexts', `${hash}.json`)
}

export function restoreAgentContext(runtime: string, cwd: string, sessionId: string): AgentContextBinding | null {
  const file = bindingFile(runtime, cwd, sessionId)
  if (!fs.existsSync(file)) return null
  const binding = parseAgentContext(JSON.parse(fs.readFileSync(file, 'utf8')))
  if (!binding || !inside(binding.projectRoot, cwd)) throw new Error('저장된 에이전트 문서 연결을 확인하세요')
  return binding
}

export function saveAgentContext(runtime: string, cwd: string, sessionId: string, binding: AgentContextBinding): void {
  const file = bindingFile(runtime, cwd, sessionId)
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  writeFileAtomic(file, `${JSON.stringify(binding)}\n`)
}
