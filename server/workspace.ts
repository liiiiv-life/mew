import { writeActiveWorkspace } from './userUiState.ts'
import { broadcastAccount } from './presence.ts'
import { workspaceContext } from './paths.ts'
// 로그인 사용자의 활성 루트는 계정 원장과 요청 컨텍스트에 저장한다.
// 계정 없는 CLI·서버 초기화는 기존 전역 기본 루트와 환경 설정을 사용한다.
import fs from 'node:fs'
import { defaultAgentSettings, readProjectAgentSettings, writeProjectAgentSettings } from './project-agent-settings.ts'
import path from 'node:path'
import { configFiles } from './config.ts'
import { ensureDocsRoot, listProjects, setDocsDir, setWorkspaceRoot, workspacePaths } from './paths.ts'
import { resetTreeWatchers, watchDocsTree } from './watcher.ts'
import { closeAllRooms } from './collab.ts'
import { broadcast } from './presence.ts'

export class WorkspaceError extends Error {}

export interface WorkspaceInfo {
  path: string
  /** 이 폴더 안에서 프로젝트로 잡히는 것들 — 폴더 하나가 프로젝트 하나다 */
  projects: string[]
  /** docs로 쓰는 폴더 — 워크스페이스 루트 기준 상대 경로 */
  docs: string
  /** 같은 폴더의 절대 경로 — 설정 화면이 그대로 보여준다 */
  docsPath: string
}

export function currentWorkspace(): WorkspaceInfo {
  return { path: workspacePaths.root, projects: listProjects(), docs: workspacePaths.docsDir, docsPath: workspacePaths.docsRoot }
}

/** 설정 파일에 그대로 쓸 수 있는 경로인지 — 셸(`. config.env`)과 Node(loadEnvFile) 둘 다 읽는 파일이다 */
function assertStorable(abs: string) {
  if (/[\n\r']/.test(abs)) throw new WorkspaceError('경로에 줄바꿈이나 작은따옴표가 있으면 설정에 저장할 수 없습니다')
}

/** 파일에서 그 키의 줄만 걷어낸 나머지 — 없는 파일이면 빈 문자열 */
function withoutKey(file: string, key: string): string {
  if (!fs.existsSync(file)) return ''
  const re = new RegExp(`^\\s*${key}\\s*=`)
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !re.test(line))
    .join('\n')
    .replace(/\n+$/, '')
}

/** 다음 실행에도 같은 값으로 뜨도록 설정 파일에 남긴다 — 쓰는 곳은 언제나 첫 번째(XDG) 설정 파일이다.
 *  다만 configFiles()는 뒤가 앞을 덮으므로, 뒤쪽 파일(레포 `.env`)에 남은 같은 키는 지워야
 *  다음 부팅에서 옛 값으로 되돌아가지 않는다. */
function persist(key: string, value: string) {
  const [primary, ...rest] = configFiles()
  fs.mkdirSync(path.dirname(primary), { recursive: true, mode: 0o700 })
  const kept = withoutKey(primary, key)
  // 공백 등이 들어간 경로도 셸이 한 낱말로 읽도록 항상 따옴표로 감싼다(작은따옴표는 위에서 걸렀다)
  fs.writeFileSync(primary, `${kept ? kept + '\n' : ''}${key}='${value}'\n`, { mode: 0o600 })

  for (const file of rest) {
    if (!fs.existsSync(file)) continue
    const stripped = withoutKey(file, key)
    if (stripped !== fs.readFileSync(file, 'utf8').replace(/\n+$/, '')) {
      fs.writeFileSync(file, stripped ? stripped + '\n' : '')
    }
  }
}

/**
 * 워크스페이스를 바꾼다. 성공하면 새 워크스페이스 정보를 돌려준다.
 * 로그인 사용자의 전환은 같은 계정에만 알리며 다른 계정의 작업 경로와 협업 방을 유지한다.
 */
export function switchWorkspace(target: string, initialProject?: string): WorkspaceInfo {
  const abs = path.resolve(target)
  assertStorable(abs)
  let stat: fs.Stats
  try {
    stat = fs.statSync(abs)
  } catch {
    throw new WorkspaceError(`없는 폴더입니다: ${abs}`)
  }
  if (!stat.isDirectory()) throw new WorkspaceError(`폴더가 아닙니다: ${abs}`)
  const context = workspaceContext.getStore()
  if (context?.account) {
    setWorkspaceRoot(abs)
    ensureDocsRoot()
    writeActiveWorkspace(context.account, abs)
    watchDocsTree()
    broadcastAccount(context.account, { type: 'workspace', ...(initialProject ? { project: initialProject } : {}) })
    return currentWorkspace()
  }
  if (abs === workspacePaths.root) return currentWorkspace()

  // 옛 폴더에 매인 것부터 접는다 — 새 경로가 걸린 뒤에 접으면 엉뚱한 파일을 붙들고 있게 된다
  resetTreeWatchers()
  closeAllRooms()
  // 에이전트 감독은 cwd를 이미 고정해 독립적으로 돈다. 프로젝트 전환은 화면의 활성
  // 루트만 바꾸며, 이전 프로젝트의 작업을 끊지 않는다(ADR 0092).

  setWorkspaceRoot(abs)
  ensureDocsRoot()
  persist('MEW_WORKSPACE', abs)
  watchDocsTree()
  broadcast({ type: 'workspace', ...(initialProject ? { project: initialProject } : {}) })

  return currentWorkspace()
}

/**
 * docs로 쓸 폴더를 워크스페이스 **안에서** 바꾼다. 워크스페이스 갈아끼우기의 축소판이다 —
 * 경로만 꺾이므로 프로젝트·터미널·에이전트는 그대로 두고, 옛 docs에 매인 감시자와 협업 방만 접는다.
 * 부르는 쪽은 화면을 다시 띄운다 — 열린 docs 탭이 옛 폴더의 파일이다.
 */
export function switchDocsRoot(target: string): WorkspaceInfo {
  const abs = path.resolve(target)
  assertStorable(abs)
  let stat: fs.Stats
  try {
    stat = fs.statSync(abs)
  } catch {
    throw new WorkspaceError(`없는 폴더입니다: ${abs}`)
  }
  if (!stat.isDirectory()) throw new WorkspaceError(`폴더가 아닙니다: ${abs}`)
  if (abs === workspacePaths.root) throw new WorkspaceError('워크스페이스 폴더 자신은 docs가 될 수 없습니다')
  if (abs !== workspacePaths.root && !abs.startsWith(workspacePaths.root + path.sep)) {
    throw new WorkspaceError(`워크스페이스 안의 폴더만 docs로 쓸 수 있습니다: ${abs}`)
  }
  if (abs === workspacePaths.docsRoot) return currentWorkspace()

  const settings = readProjectAgentSettings(workspacePaths.root) ?? defaultAgentSettings()
  writeProjectAgentSettings(workspacePaths.root, { ...settings, docsDir: path.relative(workspacePaths.root, abs) })

  resetTreeWatchers()
  closeAllRooms()
  setDocsDir(path.relative(workspacePaths.root, abs))
  if (!workspaceContext.getStore()?.account) persist('MEW_DOCS', workspacePaths.docsDir)
  watchDocsTree()
  // Documents 위치는 프로젝트 공통 설정이다. 각 계정은 자기 활성 루트를 다시 읽는다.
  broadcast({ type: 'workspace' })

  return currentWorkspace()
}
