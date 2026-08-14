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
/** 워크스페이스 하나에 딸린 mew 전용 폴더 — 프로젝트별 설정(`.mew/cmd-button.json` 등)이 여기 산다 */
export const MEW_DIR_NAME = '.mew'

/** docs는 **프로젝트가 아니라** 워크스페이스에 하나뿐인 특별 레포다. 프로젝트 목록에 서지 않고
 *  (listProjects가 DOCS_DIR을 걸러낸다) 만들거나 지울 수 없다.
 *  다만 문서·트리·검색·협업 방 키는 전부 프로젝트 이름으로 도는 구조라, **이름 'docs'는 그대로 두고
 *  경로만** 여기로 꺾는다 — projectRoot가 이 이름만 특별 취급한다. */
export const DEFAULT_PROJECT = 'docs'

/** docs로 쓸 폴더 — **워크스페이스 루트 기준 상대 경로**다(기본 `docs`).
 *  워크스페이스 안의 폴더 아무거나 고를 수 있다(홈/docs 설정 → `MEW_DOCS`에 저장, workspace.ts).
 *  옛 설치는 `.mew/docs`에 있었다 — 고른 것이 없고 그 폴더만 있으면 그대로 쓴다. */
export let DOCS_DIR = resolveDocsDir(WORKSPACE_ROOT)
export let DOCS_ROOT = path.join(WORKSPACE_ROOT, DOCS_DIR)

function resolveDocsDir(root: string): string {
  // 고른 이름은 **그 워크스페이스에 실제로 있을 때만** 쓴다 — 워크스페이스를 갈아끼우면 남의 폴더
  // 이름이 따라와 엉뚱한 빈 폴더를 만들기 때문이다(고를 때는 존재를 검사한다, workspace.ts)
  const chosen = process.env.MEW_DOCS?.trim()
  if (chosen && fs.existsSync(path.join(root, chosen))) return path.normalize(chosen)
  const legacy = path.join(MEW_DIR_NAME, DEFAULT_PROJECT)
  if (!fs.existsSync(path.join(root, DEFAULT_PROJECT)) && fs.existsSync(path.join(root, legacy))) return legacy
  return DEFAULT_PROJECT
}

/** 홈 탭이 보는 가짜 프로젝트 — 루트가 **워크스페이스 폴더 자신**이다. docs와 같은 요령으로
 *  이름만 특별 취급하고 경로를 꺾어, 트리·문서·검색이 프로젝트 스코프 그대로 돈다.
 *  점으로 시작해 실제 프로젝트 이름과 겹칠 수 없고(isValidProjectName) 프로젝트 목록에도 서지 않는다.
 *  트리에서는 프로젝트 폴더와 `.mew`를 걷어낸다(tree.ts) — 그 자리는 위쪽 탭 줄이 맡는다. */
export const WORKSPACE_PROJECT = '.workspace'

/** 워크스페이스를 갈아끼운다 — 파생 경로(DOCS_DIR·DOCS_ROOT)도 같이 다시 계산한다.
 *  실제 전환 절차(검증·설정 저장·감시자/협업 방 정리)는 workspace.ts가 맡는다. */
export function setWorkspaceRoot(absolutePath: string): void {
  WORKSPACE_ROOT = path.resolve(absolutePath)
  DOCS_DIR = resolveDocsDir(WORKSPACE_ROOT)
  DOCS_ROOT = path.join(WORKSPACE_ROOT, DOCS_DIR)
}

/** docs 폴더를 워크스페이스 안 다른 폴더로 바꾼다 — 인자는 워크스페이스 루트 기준 상대 경로.
 *  다음 실행에도 남도록 `MEW_DOCS`에 같이 적는다(setWorkspaceRoot가 이 값을 다시 읽는다). */
export function setDocsDir(relativeDir: string): void {
  DOCS_DIR = path.normalize(relativeDir)
  DOCS_ROOT = path.join(WORKSPACE_ROOT, DOCS_DIR)
  process.env.MEW_DOCS = DOCS_DIR
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
 *  'docs'는 특별 레포 이름이라 프로젝트로 만들 수 없다(만들면 경로가 겹쳐 가려진다).
 *  지금 docs로 쓰는 폴더도 마찬가지 — 프로젝트 탭과 docs 탭에 같은 폴더가 두 번 서면 안 된다. */
export function isValidProjectName(name: string): boolean {
  return (
    PROJECT_NAME_RE.test(name) && name !== 'node_modules' && name !== DEFAULT_PROJECT && name !== docsTopSegment()
  )
}

/** DOCS_DIR의 첫 칸 — 워크스페이스 루트에서 docs가 차지하는 폴더 이름(`.mew/docs`면 `.mew`) */
export function docsTopSegment(): string {
  return DOCS_DIR.split(path.sep)[0]
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
  if (project === WORKSPACE_PROJECT) return WORKSPACE_ROOT
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
