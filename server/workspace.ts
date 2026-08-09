// 워크스페이스 갈아끼우기 — 홈 탭에서 "다른 폴더를 열기"를 누르면 여기로 온다.
//
// 프로세스를 다시 띄우지 않고 바꾼다: paths.ts의 경로들이 라이브 바인딩이라, 요청 때마다 경로를 푸는
// 쪽(문서·트리·검색·프로젝트 목록)은 setWorkspaceRoot 한 번으로 전부 새 폴더를 본다. 대신 **옛 폴더에
// 매여 있던 것들**은 여기서 손으로 접는다 — 트리 감시자와 협업 방. 다음 실행에도 유지되도록 설정 파일에
// 적어 둔다.
//
// 못 따라오는 것: 이미 떠 있는 tmux 세션의 작업 디렉터리(tmux 서버가 들고 있다). 새 세션부터 새 폴더에서
// 열린다 — 부르는 쪽(api.ts)이 tmuxManager.cwd를 같이 고친다.
import fs from 'node:fs'
import path from 'node:path'
import { configFiles } from './config.ts'
import { ensureDocsRoot, listProjects, setWorkspaceRoot, WORKSPACE_ROOT } from './paths.ts'
import { resetTreeWatchers, watchDocsTree } from './watcher.ts'
import { closeAllRooms } from './collab.ts'
import { disposeAllSessions } from './agentAcp.ts'
import { broadcast } from './presence.ts'

export class WorkspaceError extends Error {}

export interface WorkspaceInfo {
  path: string
  /** 이 폴더 안에서 프로젝트로 잡히는 것들 — 폴더 하나가 프로젝트 하나다 */
  projects: string[]
}

export function currentWorkspace(): WorkspaceInfo {
  return { path: WORKSPACE_ROOT, projects: listProjects() }
}

/** 설정 파일에 그대로 쓸 수 있는 경로인지 — 셸(`. config.env`)과 Node(loadEnvFile) 둘 다 읽는 파일이다 */
function assertStorable(abs: string) {
  if (/[\n\r']/.test(abs)) throw new WorkspaceError('경로에 줄바꿈이나 작은따옴표가 있으면 설정에 저장할 수 없습니다')
}

/** 파일에서 MEW_WORKSPACE 줄만 걷어낸 나머지 — 없는 파일이면 빈 문자열 */
function withoutWorkspaceKey(file: string): string {
  if (!fs.existsSync(file)) return ''
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*MEW_WORKSPACE\s*=/.test(line))
    .join('\n')
    .replace(/\n+$/, '')
}

/** 다음 실행에도 이 워크스페이스로 뜨도록 설정 파일에 남긴다 — 쓰는 곳은 언제나 첫 번째(XDG) 설정 파일이다.
 *  다만 configFiles()는 뒤가 앞을 덮으므로, 뒤쪽 파일(레포 `.env`)에 남은 MEW_WORKSPACE는 지워야
 *  다음 부팅에서 옛 폴더로 되돌아가지 않는다. */
function persist(abs: string) {
  const [primary, ...rest] = configFiles()
  fs.mkdirSync(path.dirname(primary), { recursive: true, mode: 0o700 })
  const kept = withoutWorkspaceKey(primary)
  // 공백 등이 들어간 경로도 셸이 한 낱말로 읽도록 항상 따옴표로 감싼다(작은따옴표는 위에서 걸렀다)
  fs.writeFileSync(primary, `${kept ? kept + '\n' : ''}MEW_WORKSPACE='${abs}'\n`, { mode: 0o600 })

  for (const file of rest) {
    if (!fs.existsSync(file)) continue
    const stripped = withoutWorkspaceKey(file)
    if (stripped !== fs.readFileSync(file, 'utf8').replace(/\n+$/, '')) {
      fs.writeFileSync(file, stripped ? stripped + '\n' : '')
    }
  }
}

/**
 * 워크스페이스를 바꾼다. 성공하면 새 워크스페이스 정보를 돌려준다.
 * 부르는 쪽은 **모든 클라이언트를 새로고침시켜야 한다** — 열린 탭·트리·프로젝트가 전부 옛 폴더의 것이다.
 */
export function switchWorkspace(target: string): WorkspaceInfo {
  const abs = path.resolve(target)
  assertStorable(abs)
  let stat: fs.Stats
  try {
    stat = fs.statSync(abs)
  } catch {
    throw new WorkspaceError(`없는 폴더입니다: ${abs}`)
  }
  if (!stat.isDirectory()) throw new WorkspaceError(`폴더가 아닙니다: ${abs}`)
  if (abs === WORKSPACE_ROOT) return currentWorkspace()

  // 옛 폴더에 매인 것부터 접는다 — 새 경로가 걸린 뒤에 접으면 엉뚱한 파일을 붙들고 있게 된다
  resetTreeWatchers()
  closeAllRooms()
  // 에이전트는 뜰 때 cwd가 정해진다(child process) — 새 폴더에서 다시 떠야 한다
  disposeAllSessions()

  setWorkspaceRoot(abs)
  ensureDocsRoot()
  persist(abs)
  watchDocsTree()
  broadcast({ type: 'workspace' })

  return currentWorkspace()
}
