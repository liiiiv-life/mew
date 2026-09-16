import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { ProjectAgentSettings } from '../shared/project-agent-context.ts'

export const SETTINGS_PATH = '.mew/agent-context.json'
export class ProjectSetupError extends Error {}

export function defaultAgentSettings(docsDir = 'docs'): ProjectAgentSettings {
  return { version: 1, enabled: true, docsDir, entrypoints: [], instructions: '' }
}

/** Existing ancestors must be real directories; never traverse a symlink on writes. */
export function safeProjectPath(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || [...relative].some(c => c.charCodeAt(0) < 32)
    || relative.split('/').some(part => ['..', '.', '', '.git', '.data', 'node_modules'].includes(part))) {
    throw new ProjectSetupError('프로젝트 안의 상대 경로를 입력하세요')
  }
  let target = root
  for (const part of relative.split('/')) {
    if (fs.existsSync(target) && !fs.lstatSync(target).isDirectory()) throw new ProjectSetupError('경로에 실제 폴더가 필요합니다')
    target = path.join(target, part)
    try {
      if (fs.lstatSync(target).isSymbolicLink()) throw new ProjectSetupError('문서 연결에 심볼릭 링크를 사용할 수 없습니다')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return target
}

export function normalizeAgentSettings(root: string, value: unknown): ProjectAgentSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProjectSetupError('에이전트 설정 형식을 확인하세요')
  const v = value as Record<string, unknown>
  if (v.version !== 1 || typeof v.enabled !== 'boolean' || typeof v.docsDir !== 'string'
    || !Array.isArray(v.entrypoints) || v.entrypoints.length > 16 || v.entrypoints.some(p => typeof p !== 'string' || p.length > 1024)
    || typeof v.instructions !== 'string' || v.instructions.length > 8000) throw new ProjectSetupError('에이전트 설정 형식을 확인하세요 (추가 지침 최대 8,000자)')
  const docsDir = v.docsDir.trim()
  if (docsDir.length > 1024 || docsDir === '.mew') throw new ProjectSetupError('Documents 전용 하위 폴더를 선택하세요')
  const docsRoot = safeProjectPath(root, docsDir)
  if (fs.existsSync(docsRoot) && !fs.statSync(docsRoot).isDirectory()) throw new ProjectSetupError('Documents 경로는 폴더여야 합니다')
  const entrypoints = [...new Set((v.entrypoints as string[]).map(p => p.trim()).filter(Boolean))]
  for (const entry of entrypoints) {
    const target = safeProjectPath(root, entry)
    if (!/\.md$/i.test(entry) || fs.existsSync(target) && !fs.statSync(target).isFile()) throw new ProjectSetupError(`문서 진입점 경로를 확인하세요: ${entry}`)
  }
  return { version: 1, enabled: v.enabled, docsDir, entrypoints, instructions: v.instructions.trim() }
}

export function readProjectAgentSettings(root: string): ProjectAgentSettings | null {
  const file = safeProjectPath(root, SETTINGS_PATH)
  if (!fs.existsSync(file)) return null
  if (fs.statSync(file).size > 48_000) throw new ProjectSetupError('에이전트 설정 파일이 너무 큽니다')
  let value: unknown
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch { throw new ProjectSetupError('에이전트 설정 JSON을 읽을 수 없습니다') }
  return normalizeAgentSettings(root, value)
}

export function writeProjectAgentSettings(root: string, settings: ProjectAgentSettings): void {
  const normalized = normalizeAgentSettings(root, settings)
  const file = safeProjectPath(root, SETTINGS_PATH)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    fs.renameSync(temporary, file)
  } finally { fs.rmSync(temporary, { force: true }) }
}

export function projectDocsDir(root: string, fallback?: string): string {
  const settings = readProjectAgentSettings(root)
  if (settings) return settings.docsDir
  if (fallback && !path.isAbsolute(fallback)) {
    try { if (fs.statSync(safeProjectPath(root, fallback)).isDirectory()) return fallback } catch { /* legacy setting belongs to another project */ }
  }
  return !fs.existsSync(path.join(root, 'docs')) && fs.existsSync(path.join(root, '.mew/docs')) ? '.mew/docs' : 'docs'
}
