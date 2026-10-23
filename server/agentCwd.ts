import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export class AgentCwdError extends Error {}

function expandedPath(input: string, fallback: string, base: string): string {
  const trimmed = input.trim()
  const expanded = !trimmed
    ? fallback
    : trimmed === '~' || trimmed.startsWith('~/')
      ? path.join(os.homedir(), trimmed.slice(1))
      : trimmed
  return path.resolve(base, expanded)
}

/**
 * 에이전트 세션 cwd를 정규화한다. 빈 값은 fallback, 상대경로는 base 기준이며 `~`는 서버 사용자 홈이다.
 * 파일 도구의 보안 경계가 아니라 잘못된 cwd로 프로세스를 반복 spawn하지 않게 하는 입력 검사다(ADR 0077).
 */
export function resolveAgentCwd(input: unknown, fallback: string, base = fallback): string {
  if (typeof input !== 'string') throw new AgentCwdError('작업 경로가 올바르지 않습니다')
  const resolved = expandedPath(input, fallback, base)
  let stat: fs.Stats
  try {
    stat = fs.statSync(resolved)
  } catch {
    throw new AgentCwdError(`폴더를 찾을 수 없습니다: ${resolved}`)
  }
  if (!stat.isDirectory()) throw new AgentCwdError(`폴더가 아닙니다: ${resolved}`)
  return resolved
}

export type AgentCwdSuggestion = { name: string; path: string }
export type AgentCwdSuggestions = { directory: string; prefix: string; dirs: AgentCwdSuggestion[] }

function childDirs(directory: string, prefix: string): AgentCwdSuggestion[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch {
    throw new AgentCwdError(`폴더를 열 수 없습니다: ${directory}`)
  }
  return entries
    .filter((entry) => entry.name.startsWith(prefix))
    .filter((entry) => {
      if (entry.isDirectory()) return true
      if (!entry.isSymbolicLink()) return false
      try { return fs.statSync(path.join(directory, entry.name)).isDirectory() } catch { return false }
    })
    .map((entry) => ({ name: entry.name, path: path.join(directory, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * 주소창 자동완성. entered=false면 마지막 경로 조각을 접두어로 보고 부모의 일치 폴더만,
 * entered=true면 그 경로 안으로 들어가 모든 하위 폴더를 돌려준다.
 */
export function suggestAgentCwds(
  input: unknown,
  fallback: string,
  base = fallback,
  entered = false,
): AgentCwdSuggestions {
  if (typeof input !== 'string') throw new AgentCwdError('작업 경로가 올바르지 않습니다')
  const candidate = expandedPath(input, fallback, base)
  const endsWithSeparator = input.trim().endsWith(path.sep)
  const directory = entered || endsWithSeparator ? resolveAgentCwd(candidate, fallback, base) : path.dirname(candidate)
  // 부모도 실제로 열 수 있는 디렉터리여야 한다.
  resolveAgentCwd(directory, fallback, base)
  const prefix = entered || endsWithSeparator ? '' : path.basename(candidate)
  return { directory, prefix, dirs: childDirs(directory, prefix) }
}
