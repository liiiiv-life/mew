import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** 프로젝트들이 사는 폴더 — 최상위 폴더 하나가 프로젝트 하나.
 *  기본값은 앱 폴더의 부모. 앱과 워크스페이스가 떨어져 있으면
 *  (컨테이너 배포처럼) `MEW_WORKSPACE`로 지정한다.
 *
 *  const가 아니라 let인 이유: 홈 탭에서 워크스페이스를 통째로 바꿀 수 있다(workspace.ts).
 *  ESM 라이브 바인딩이라 **호출 시점에 읽는 쪽**은 자동으로 새 값을 본다 — 모듈 최상단에서
 *  이 값을 복사해 두면 낡는다는 뜻이다(그런 곳은 setWorkspaceRoot를 부르는 쪽이 같이 고쳐야 한다). */
export let WORKSPACE_ROOT = process.env.MEW_WORKSPACE
  ? path.resolve(process.env.MEW_WORKSPACE)
  : path.resolve(here, '../..')
/** 워크스페이스 하나에 딸린 mew 전용 폴더 — docs 레포가 여기 산다 */
export let MEW_DIR = path.join(WORKSPACE_ROOT, '.mew')

/** docs는 **프로젝트가 아니라** 워크스페이스에 하나뿐인 특별 레포다. 프로젝트 목록에 서지 않고
 *  (점으로 시작하는 `.mew` 아래라 PROJECT_NAME_RE에 애초에 걸리지 않는다) 만들거나 지울 수 없다.
 *  다만 문서·트리·검색·협업 방 키는 전부 프로젝트 이름으로 도는 구조라, **이름 'docs'는 그대로 두고
 *  경로만** 여기로 꺾는다 — projectRoot가 이 이름만 특별 취급한다. */
export const DEFAULT_PROJECT = 'docs'
export let DOCS_ROOT = path.join(MEW_DIR, DEFAULT_PROJECT)

/** 워크스페이스를 갈아끼운다 — 파생 경로(MEW_DIR·DOCS_ROOT)도 같이 다시 계산한다.
 *  실제 전환 절차(검증·설정 저장·감시자/협업 방 정리)는 workspace.ts가 맡는다. */
export function setWorkspaceRoot(absolutePath: string): void {
  WORKSPACE_ROOT = path.resolve(absolutePath)
  MEW_DIR = path.join(WORKSPACE_ROOT, '.mew')
  DOCS_ROOT = path.join(MEW_DIR, DEFAULT_PROJECT)
}

/** docs 폴더는 항상 존재한다 — 없으면 빈 폴더로 만든다(새 워크스페이스는 빈 docs로 시작) */
export function ensureDocsRoot(): string {
  fs.mkdirSync(DOCS_ROOT, { recursive: true })
  return DOCS_ROOT
}

/** 이 편집기 앱 자신이 들어 있는 프로젝트 폴더 이름(예: 'mew') — UI로 자기 자신을 삭제/개명하지 못하게 보호한다 */
export const APP_PROJECT = path.basename(path.resolve(here, '..'))

/** 이름을 바꾸거나 삭제할 수 없는 프로젝트 — 기본(docs)과 앱 자신 */
export function isProtectedProject(name: string): boolean {
  return name === DEFAULT_PROJECT || name === APP_PROJECT
}

export class UnsafePathError extends Error {}
export class UnknownProjectError extends Error {}

const PROJECT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

// 어떤 역할로도 API에 노출하지 않는 경로 — 저장소 내부와 이 앱 자신의 인증 데이터(.data/users.json 등).
const DENY_SEGMENTS = new Set(['.git', 'node_modules', '.data'])

// 시크릿 파일(.env·.env.local 등, .env.example 제외). 로그인 사용자에게는 열려 있고 **게스트에게만** 차단된다
// — 로그인 가능한 역할은 어차피 셸이나 파일 조작 권한을 갖기 때문. 게스트 차단은 guestAccess.ts가 이 함수로 한다.
const SECRET_FILE_RE = /^\.env(\..+)?$/

export function isSecretFile(name: string): boolean {
  return SECRET_FILE_RE.test(name) && name !== '.env.example'
}

export function isDeniedSegment(name: string): boolean {
  return DENY_SEGMENTS.has(name)
}

/** 새 프로젝트 폴더로 허용되는 이름인지 — listProjects의 필터와 같은 규칙.
 *  'docs'는 특별 레포 이름이라 프로젝트로 만들 수 없다(만들면 경로가 겹쳐 가려진다). */
export function isValidProjectName(name: string): boolean {
  return PROJECT_NAME_RE.test(name) && name !== 'node_modules' && name !== DEFAULT_PROJECT
}

/** 워크스페이스의 프로젝트 목록 — docs는 프로젝트가 아니므로 들어가지 않는다 */
export function listProjects(): string[] {
  return fs
    .readdirSync(WORKSPACE_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isValidProjectName(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
}

export function projectRoot(project: string): string {
  if (project === DEFAULT_PROJECT) return ensureDocsRoot()
  if (!PROJECT_NAME_RE.test(project)) throw new UnknownProjectError(`올바른 프로젝트 이름이 아닙니다: ${project}`)
  const root = path.join(WORKSPACE_ROOT, project)
  let stat: fs.Stats
  try {
    stat = fs.statSync(root)
  } catch {
    throw new UnknownProjectError(`존재하지 않는 프로젝트입니다: ${project}`)
  }
  if (!stat.isDirectory()) throw new UnknownProjectError(`존재하지 않는 프로젝트입니다: ${project}`)
  return root
}

/** 프로젝트 상대 경로를 절대 경로로 — 루트 탈출과 차단 경로(.git·node_modules·.data)를 거부한다 */
export function resolveProjectPath(project: string, relativePath: string): string {
  const root = projectRoot(project)
  const normalized = relativePath.replace(/^\/+/, '')
  const resolved = path.resolve(root, normalized)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new UnsafePathError(`Path escapes project root: ${relativePath}`)
  }
  if (resolved !== root) {
    for (const segment of path.relative(root, resolved).split(path.sep)) {
      if (isDeniedSegment(segment)) throw new UnsafePathError(`접근이 차단된 경로입니다: ${relativePath}`)
    }
  }
  return resolved
}

/** Resolves a repo-relative path against DOCS_ROOT, rejecting any path that escapes it. */
export function resolveDocsPath(relativePath: string): string {
  return resolveProjectPath(DEFAULT_PROJECT, relativePath)
}

export function toRelativePath(absolutePath: string): string {
  return path.relative(DOCS_ROOT, absolutePath)
}
