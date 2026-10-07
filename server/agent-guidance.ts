import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DATA_DIR, writeFileAtomic } from './dataDir.ts'
import { guidanceOptions, type GuidanceKey, type GuidanceSnapshot } from '../shared/agent-guidance.ts'

export const AGENT_GUIDANCE_PATH = path.join(DATA_DIR, 'agent-guidance.md')
const legacyPath = path.join(DATA_DIR, 'agent-guidance.txt')
const template = new URL('./prompts/agent-guidance.txt', import.meta.url)

function seed(): Buffer {
  try { return fs.readFileSync(legacyPath) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return fs.readFileSync(template)
  }
}

/** Publish a complete seed atomically; concurrent hosts never replace an existing file. */
export function ensureAgentGuidance(): string {
  try { fs.lstatSync(AGENT_GUIDANCE_PATH); return AGENT_GUIDANCE_PATH }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
  const temporaryDir = fs.mkdtempSync(path.join(DATA_DIR, '.agent-guidance-'))
  const temporary = path.join(temporaryDir, 'seed')
  try {
    fs.writeFileSync(temporary, seed(), { mode: 0o600 })
    try { fs.linkSync(temporary, AGENT_GUIDANCE_PATH) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  } finally { fs.rmSync(temporaryDir, { recursive: true, force: true }) }
  return AGENT_GUIDANCE_PATH
}

/** No cache: edits apply to the next request. Preview alone does not create state. */
export function readAgentGuidance(): string {
  try { return withDebuggerDefault(currentDocumentationGuidance(fs.readFileSync(AGENT_GUIDANCE_PATH, 'utf8').trim())) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return withDebuggerDefault(currentDocumentationGuidance(seed().toString('utf8').trim()))
  }
}

/** Update only the former default wording; handwritten guidance and stored settings stay intact. */
function currentDocumentationGuidance(content: string): string {
  return content
    .replace('Use Documents entrypoints and maps to find only the current documents relevant to the task.', 'Use Documents entrypoints, then scan document paths and frontmatter description fields to select only the current documents relevant to the task before reading their bodies. Do not use MOC navigation or require map registration.')
    .replace('Update map links for new or moved documents.', 'Give every new or changed document an accurate frontmatter description, and update existing links when paths move; no MOC update is required.')
}

export class GuidanceError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}

const revisionOf = (content: string) => createHash('sha256').update(content).digest('hex')
const markers = (key: GuidanceKey) => [`<!-- mew:agent-setting:${key} -->`, `<!-- /mew:agent-setting:${key} -->`]

function withDebuggerDefault(content: string): string {
  const [start, end] = markers('debugger')
  // Preserve explicit/custom blocks, including damaged markers, for editor repair.
  if (content.includes(start) || content.includes(end)) return content
  return `${content}${content ? '\n\n' : ''}${start}\n${guidanceOptions.debugger.enabled}\n${end}`
}

function region(content: string, key: GuidanceKey) {
  const [start, end] = markers(key)
  const from = content.indexOf(start), closing = content.indexOf(end)
  if (from < 0 && closing < 0) return null
  if (from < 0 || closing < from + start.length || content.indexOf(start, from + start.length) >= 0 || content.indexOf(end, closing + end.length) >= 0) {
    throw new GuidanceError('설정 구간을 읽을 수 없습니다. 파일 보기에서 중복되거나 누락된 설정 표시를 확인하세요.', 409)
  }
  return { from, to: closing + end.length, text: content.slice(from + start.length, closing).trim() }
}

function snapshot(content: string): GuidanceSnapshot {
  const settings = {} as GuidanceSnapshot['settings']
  for (const key of Object.keys(guidanceOptions) as GuidanceKey[]) {
    try {
      const block = region(content, key)
      settings[key] = block ? Object.entries(guidanceOptions[key]).find(([, text]) => text === block.text)?.[0] ?? 'custom' : key === 'debugger' ? 'enabled' : 'inherit'
    } catch { settings[key] = 'custom' }
  }
  return { path: AGENT_GUIDANCE_PATH, content, revision: revisionOf(content), settings }
}

export function agentGuidanceSettings(): GuidanceSnapshot {
  return snapshot(fs.readFileSync(ensureAgentGuidance(), 'utf8'))
}

export function updateAgentGuidance(input: unknown): GuidanceSnapshot {
  const value = input as { key?: unknown; value?: unknown; revision?: unknown } | null
  if (!value || typeof value.key !== 'string' || !Object.hasOwn(guidanceOptions, value.key)) throw new GuidanceError('올바른 설정 항목을 선택하세요.')
  const key = value.key as GuidanceKey
  const options = guidanceOptions[key] as Record<string, string>
  if (typeof value.value !== 'string' || !Object.hasOwn(options, value.value) || typeof value.revision !== 'string') throw new GuidanceError('올바른 설정값을 선택하세요.')
  const current = agentGuidanceSettings()
  if (current.revision !== value.revision) throw new GuidanceError('지침 파일이 변경되었습니다. 다시 불러온 뒤 설정을 변경하세요.', 409)
  // Validate every region before writing so damaged/nested markers never consume other instructions.
  const regions = (Object.keys(guidanceOptions) as GuidanceKey[]).map(k => region(current.content, k)).filter(r => r !== null).sort((a, b) => a.from - b.from)
  if (regions.some((r, i) => i > 0 && r.from < regions[i - 1].to)) throw new GuidanceError('설정 구간이 겹칩니다. 파일 보기에서 설정 표시를 확인하세요.', 409)
  const block = region(current.content, key), [start, end] = markers(key)
  const text = options[value.value]
  const replacement = text ? `${start}\n${text}\n${end}` : ''
  const content = block
    ? current.content.slice(0, block.from) + replacement + current.content.slice(block.to)
    : replacement ? current.content + `${current.content.endsWith('\n\n') || !current.content ? '' : current.content.endsWith('\n') ? '\n' : '\n\n'}${replacement}\n` : current.content
  writeFileAtomic(AGENT_GUIDANCE_PATH, content)
  return snapshot(content)
}
