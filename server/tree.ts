import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_PROJECT,
  WORKSPACE_PROJECT,
  docsTopSegment,
  isDeniedSegment,
  isSecretFile,
  projectRoot,
  resolveProjectPath,
} from './paths.ts'
import { readProjectIcon } from './projectIcons.ts'
import { hasProjectMarker } from './subprojects.ts'
import { readIgnoreSet } from './ignoreList.ts'

export interface TreeNode {
  editable?: boolean
  name: string
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
  /** 깊이와 무관하게 실제 `.mew` 디렉터리를 가진 하위 프로젝트 폴더 */
  project?: boolean
  icon?: string | null
  /** 폴더 자체가 Git 저장소 루트인지 (`.git` 파일 또는 폴더 존재) */
  git?: boolean
  guestAccess?: { view: boolean; edit: boolean }
}

/**
 * 트리를 어떤 눈으로 그릴지.
 *
 * `showAll`이면 **숨김 목록도 확장자 필터도 적용하지 않고 디스크에 있는 그대로** 보여준다 —
 * owner·manager 전용이다(`reqAuth.ts`의 `seesEveryFile`). 셸을 가진 역할에게 확장자 화이트리스트는
 * 방어가 아니라 "방금 만든 파일이 사이드바에 안 뜬다"는 혼란일 뿐이라 역할별로 갈랐다.
 * 정책 기준본은 `docs/ops/mew/access-model.md`.
 *
 * showAll이어도 걷어내지 않는 둘 — 숨김 규칙이 아니라 구조적 제약이다:
 *  - `.git`·`node_modules`·`.data`(`isDeniedSegment`) — API가 경로 자체를 거부하므로 트리에 세워도
 *    열리지 않고, node_modules 하나로 항목이 수만 개가 된다.
 *  - `build/` 안의 산출물(`DOWNLOAD_ONLY_DIRS`) — flutter build 하나가 9천 항목이다. APK/AAB는 보인다.
 */
export interface TreeOptions {
  showAll?: boolean
}

// 숨길 이름 목록은 설정 창에서 바뀌므로 상수가 아니라 매 트리마다 읽는다(ignoreList.ts가 캐시한다).
// 트리 한 번에 한 번만 읽어 walk 전체에 같은 집합을 흘려보낸다 — 도중에 바뀌어도 트리 하나는 일관된다.

// docs 외 프로젝트에서 트리에 노출할 텍스트 파일들 — 에디터는 utf-8 텍스트만 다룬다
const TEXT_EXTENSIONS = new Set([
  '.md', '.mdx', '.txt',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.jsonc', '.yml', '.yaml', '.toml', '.ini',
  '.css', '.scss', '.html', '.svg',
  '.sh', '.zsh', '.bash', '.py', '.sql', '.rs', '.go',
])
const TEXT_FILENAMES = new Set(['README', 'Dockerfile', 'Makefile', 'LICENSE', '.gitignore', '.env.example', '.oxlintrc.json'])

// 트리에 노출하고 미디어 뷰어(/api/raw 스트리밍)로 여는 바이너리 파일들 — 에디터로는 열지 않는다
export const MEDIA_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.ico',
  '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.opus',
  '.mp4', '.webm', '.mov', '.m4v', '.mkv',
  '.pdf',
  '.xlsx', // 표는 브라우저에서 직접 파싱해 읽기 전용으로 그린다 (src/utils/xlsx.ts)
  // csv·tsv도 같은 표 뷰어로 간다. 글자 파일이지만 에디터에 그대로 펴면 쉼표 줄이 늘어서 읽을 수 없고,
  // 엑셀이 뱉은 파일은 대개 cp949라 utf-8로 읽으면 글자가 깨진다 (src/utils/csv.ts)
  '.csv', '.tsv',
])

// 트리에 노출하되 미리보기 없이 다운로드만 하는 바이너리 — 빌드 산출물 등 (Android APK/AAB)
export const DOWNLOAD_EXTENSIONS = new Set([
  '.apk', '.aab',
])

// 기본은 숨기지만 내부의 다운로드 파일(APK/AAB)만은 노출하는 디렉터리 — flutter build/ 등
// 산출물 전체(에셋 사본·중간 파일 수천 개)를 트리에 쏟지 않으려고 다운로드 파일만 통과시키고 빈 폴더는 접는다
const DOWNLOAD_ONLY_DIRS = new Set(['build'])

const TOP_LEVEL_DIR_ORDER = ['.new', 'company', 'products', 'programs', 'events', 'ops', 'decisions', 'archives']

function topLevelRank(name: string): number {
  const index = TOP_LEVEL_DIR_ORDER.indexOf(name)
  return index === -1 ? TOP_LEVEL_DIR_ORDER.length : index
}

function isVisibleFile(name: string, docsOnly: boolean): boolean {
  const ext = path.extname(name).toLowerCase()
  if (docsOnly) return name.endsWith('.md') || MEDIA_EXTENSIONS.has(ext) || DOWNLOAD_EXTENSIONS.has(ext)
  // .env·.env.local 등 — 트리에는 보이지만 게스트 트리에서는 guestAccess가 걷어낸다
  if (isSecretFile(name)) return true
  if (TEXT_FILENAMES.has(name)) return true
  return TEXT_EXTENSIONS.has(ext) || MEDIA_EXTENSIONS.has(ext) || DOWNLOAD_EXTENSIONS.has(ext)
}

// 트리 하나를 그리는 동안 변하지 않는 판정 재료 — 옵션·프로젝트에서 한 번만 뽑아 walk 전체에 흘려보낸다
interface Filters {
  /** docs 프로젝트 — SSoT 규칙대로 .md와 미디어만 보이고, 최상위 폴더는 정해진 순서로 선다 */
  docsOnly: boolean
  ignore: Set<string>
  showAll: boolean
  /** **맨 위 칸에서만** 걷어낼 이름들 — 홈(워크스페이스 루트)의 프로젝트 폴더·docs 폴더·`.mew`.
   *  숨기는 게 아니라 자리를 옮긴 것이다: 프로젝트는 프로젝트 탭이, docs는 docs 탭이 맡는다.
   *  깊은 곳에 같은 이름이 있으면 그건 그냥 폴더이므로 건드리지 않는다. */
  hideAtRoot: ReadonlySet<string>
}

const NOTHING_IGNORED: ReadonlySet<string> = new Set()

function filtersFor(project: string, opts: TreeOptions): Filters {
  const showAll = opts.showAll === true
  return {
    docsOnly: project === DEFAULT_PROJECT,
    // showAll이면 숨김 목록을 읽지도 않는다 — 정렬 규칙(docsOnly)은 역할과 무관하므로 그대로 둔다
    ignore: showAll ? (NOTHING_IGNORED as Set<string>) : readIgnoreSet(),
    showAll,
    // Documents는 파일 보기 맨 위에 실제 경로의 폴더로 따로 표시한다.
    // 루트 목록에서만 중복을 제외하고 하위 경로의 파일 탐색은 허용한다.
    hideAtRoot: project === WORKSPACE_PROJECT ? new Set([docsTopSegment()]) : NOTHING_IGNORED,
  }
}

function fileVisible(name: string, f: Filters, downloadOnly: boolean): boolean {
  if (downloadOnly) return DOWNLOAD_EXTENSIONS.has(path.extname(name).toLowerCase())
  return f.showAll || isVisibleFile(name, f.docsOnly)
}

function walk(absDir: string, relDir: string, f: Filters, downloadOnly = false): TreeNode[] {
  const entries = fs.readdirSync(absDir, { withFileTypes: true })
  const nodes: TreeNode[] = []
  for (const entry of entries) {
    if (f.ignore.has(entry.name) || isDeniedSegment(entry.name)) continue
    if (relDir === '' && f.hideAtRoot.has(entry.name)) continue
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
    const absPath = path.join(absDir, entry.name)
    if (entry.isDirectory()) {
      // build/ 같은 다운로드 전용 구역은 내부를 훑되 APK/AAB로 이어지지 않는 빈 폴더는 접는다 (산출물 홍수 방지)
      const childDownloadOnly = downloadOnly || DOWNLOAD_ONLY_DIRS.has(entry.name)
      const children = walk(absPath, relPath, f, childDownloadOnly)
      if (childDownloadOnly && children.length === 0) continue
      nodes.push({
        name: entry.name,
        path: relPath,
        type: 'dir',
        children,
        project: hasProjectMarker(absPath),
        icon: hasProjectMarker(absPath) ? readProjectIcon(absPath) : undefined,
        git: fs.existsSync(path.join(absPath, '.git')),
      })
    } else if (entry.isFile()) {
      if (fileVisible(entry.name, f, downloadOnly)) nodes.push({ name: entry.name, path: relPath, type: 'file' })
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    if (f.docsOnly && relDir === '' && a.type === 'dir') {
      const rankDiff = topLevelRank(a.name) - topLevelRank(b.name)
      if (rankDiff !== 0) return rankDiff
    }
    return a.name.localeCompare(b.name)
  })
  return nodes
}

/**
 * 요청 경로용 비동기 트리 순회. /mnt/c 같은 느린 파일시스템에서 동기 readdirSync를 재귀 호출하면
 * 디렉터리 하나를 읽는 동안 Node 이벤트 루프 전체가 멎는다. 순서는 일부러 직렬로 유지한다 — 큰
 * 워크스페이스에서 모든 디렉터리 read를 한꺼번에 던져 파일시스템을 더 압박하지 않으면서, 각 read
 * 사이에는 다른 HTTP 요청이 처리될 수 있다.
 */
async function walkAsync(absDir: string, relDir: string, f: Filters, downloadOnly = false): Promise<TreeNode[]> {
  const entries = await fs.promises.readdir(absDir, { withFileTypes: true })
  const nodes: TreeNode[] = []
  for (const entry of entries) {
    if (f.ignore.has(entry.name) || isDeniedSegment(entry.name)) continue
    if (relDir === '' && f.hideAtRoot.has(entry.name)) continue
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
    const absPath = path.join(absDir, entry.name)
    if (entry.isDirectory()) {
      const childDownloadOnly = downloadOnly || DOWNLOAD_ONLY_DIRS.has(entry.name)
      const children = await walkAsync(absPath, relPath, f, childDownloadOnly)
      if (childDownloadOnly && children.length === 0) continue
      nodes.push({
        name: entry.name,
        path: relPath,
        type: 'dir',
        children,
        project: hasProjectMarker(absPath),
        icon: hasProjectMarker(absPath) ? readProjectIcon(absPath) : undefined,
        git: fs.existsSync(path.join(absPath, '.git')),
      })
    } else if (entry.isFile()) {
      if (fileVisible(entry.name, f, downloadOnly)) nodes.push({ name: entry.name, path: relPath, type: 'file' })
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    if (f.docsOnly && relDir === '' && a.type === 'dir') {
      const rankDiff = topLevelRank(a.name) - topLevelRank(b.name)
      if (rankDiff !== 0) return rankDiff
    }
    return a.name.localeCompare(b.name)
  })
  return nodes
}

export function buildTree(project: string = DEFAULT_PROJECT, opts: TreeOptions = {}): TreeNode[] {
  return walk(projectRoot(project), '', filtersFor(project, opts))
}

/** HTTP 요청과 파일 감시 갱신에서는 이 버전을 써서 느린 디스크 I/O가 서버 전체를 막지 않게 한다. */
export function buildTreeAsync(project: string = DEFAULT_PROJECT, opts: TreeOptions = {}): Promise<TreeNode[]> {
  return walkAsync(projectRoot(project), '', filtersFor(project, opts))
}

/**
 * 사이드바가 폴더를 펼칠 때 쓰는 한 단계 목록. 전체 트리와 같은 가시성·정렬 규칙을 쓰되,
 * 요청한 디렉터리의 직접 자식만 돌려 큰 프로젝트의 첫 화면을 막지 않는다.
 */
export async function listTreeDirAsync(project: string = DEFAULT_PROJECT, relDir = '', opts: TreeOptions = {}): Promise<TreeNode[]> {
  const normalized = relDir.replace(/^\/+|\/+$/g, '')
  const f = filtersFor(project, opts)
  if (normalized && !isPathVisible(project, normalized, { ...opts, type: 'dir' })) return []
  const absDir = resolveProjectPath(project, normalized)
  const stat = await fs.promises.stat(absDir)
  if (!stat.isDirectory()) return []

  const downloadOnly = normalized.split('/').filter(Boolean).some((segment) => DOWNLOAD_ONLY_DIRS.has(segment))
  const entries = await fs.promises.readdir(absDir, { withFileTypes: true })
  const nodes: TreeNode[] = []
  for (const entry of entries) {
    if (f.ignore.has(entry.name) || isDeniedSegment(entry.name)) continue
    if (!normalized && f.hideAtRoot.has(entry.name)) continue
    const relPath = normalized ? `${normalized}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (!isPathVisible(project, relPath, { ...opts, type: 'dir' })) continue
      nodes.push({
        name: entry.name,
        path: relPath,
        type: 'dir',
        project: hasProjectMarker(path.join(absDir, entry.name)),
        icon: hasProjectMarker(path.join(absDir, entry.name)) ? readProjectIcon(path.join(absDir, entry.name)) : undefined,
        git: fs.existsSync(path.join(absDir, entry.name, '.git')),
      })
    } else if (entry.isFile() && fileVisible(entry.name, f, downloadOnly)) {
      nodes.push({ name: entry.name, path: relPath, type: 'file' })
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    if (f.docsOnly && !normalized && a.type === 'dir') {
      const rankDiff = topLevelRank(a.name) - topLevelRank(b.name)
      if (rankDiff !== 0) return rankDiff
    }
    return a.name.localeCompare(b.name)
  })
  return nodes
}

/**
 * 이 경로가 그 눈으로 그린 트리에 실제로 뜨는지 — 디스크를 읽지 않고 이름 규칙만으로 판정한다.
 * 파일을 만들었는데 사이드바에 나타나지 않을 때 조용히 넘어가지 않고 그 자리에서 알려주려고 쓴다.
 *
 * **인가 경계가 아니라 UI 판정이다.** 트리에 안 뜨는 파일도 경로만 알면 API로 읽힌다 —
 * 실제 경계는 `guestAccess.ts`와 `paths.ts`가 친다(`docs/ops/mew/access-model.md`).
 */
export function isPathVisible(
  project: string,
  relPath: string,
  opts: TreeOptions & { type?: 'file' | 'dir' } = {},
): boolean {
  const f = filtersFor(project, opts)
  const segments = relPath.split('/').filter((s) => s.length > 0)
  if (segments.length === 0) return false
  let downloadOnly = false
  for (let i = 0; i < segments.length; i++) {
    const name = segments[i]
    if (f.ignore.has(name) || isDeniedSegment(name)) return false
    if (i === segments.length - 1 && opts.type !== 'dir') return fileVisible(name, f, downloadOnly)
    if (DOWNLOAD_ONLY_DIRS.has(name)) downloadOnly = true
  }
  return true
}
