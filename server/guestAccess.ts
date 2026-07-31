import fs from 'node:fs'
import path from 'node:path'
import type { TreeNode } from './tree.ts'
import { isSecretFile, listProjects } from './paths.ts'
import { DATA_DIR, writeFileAtomic } from './dataDir.ts'

const FILE = path.join(DATA_DIR, 'guest-access.json')

export interface GuestRule {
  path: string // '' = 프로젝트 루트(전체)
  view: boolean
  edit: boolean
}

interface GuestAccessFile {
  version: 1
  projects: Record<string, GuestRule[]>
}

let cache: GuestAccessFile | null = null
let cacheMtime = -1

function load(): GuestAccessFile {
  let mtime = -1
  try {
    mtime = fs.statSync(FILE).mtimeMs
  } catch {
    cache = null
    return { version: 1, projects: {} }
  }
  if (cache && mtime === cacheMtime) return cache
  const parsed = JSON.parse(fs.readFileSync(FILE, 'utf-8')) as GuestAccessFile
  cache = parsed
  cacheMtime = mtime
  return parsed
}

function save(data: GuestAccessFile) {
  writeFileAtomic(FILE, JSON.stringify(data, null, 2) + '\n')
  cache = null
}

function rulesFor(project: string): GuestRule[] {
  return load().projects[project] ?? []
}

/** 가장 구체적인(가장 긴 path prefix) 규칙이 이긴다 — 파일 자체 규칙 > 조상 폴더 규칙 > 프로젝트 루트('') 규칙 */
function resolveRule(project: string, relPath: string): GuestRule | null {
  const rules = rulesFor(project)
  let best: GuestRule | null = null
  for (const rule of rules) {
    const matches = rule.path === '' || relPath === rule.path || relPath.startsWith(rule.path + '/')
    if (!matches) continue
    if (!best || rule.path.length > best.path.length) best = rule
  }
  return best
}

// 시크릿 파일은 게스트에게 규칙보다 우선해서 막는다 — 규칙은 확장자를 보지 않으므로 프로젝트 루트('')에
// view를 주면 .env까지 딸려간다. 트리 필터·라우트 가드·presence가 전부 아래 두 함수를 거치므로 여기 한 곳이면 된다.
function isSecretPath(relPath: string): boolean {
  return relPath.split('/').some(isSecretFile)
}

export function isGuestViewable(project: string, relPath: string): boolean {
  if (isSecretPath(relPath)) return false
  return resolveRule(project, relPath)?.view ?? false
}

export function isGuestEditable(project: string, relPath: string): boolean {
  if (isSecretPath(relPath)) return false
  return resolveRule(project, relPath)?.edit ?? false
}

export function getGuestRule(project: string, relPath: string): GuestRule | null {
  return rulesFor(project).find((r) => r.path === relPath) ?? null
}

/** edit이면 view도 함께 켠다(편집은 보기를 전제) — 호출자를 신뢰하지 않고 서버에서 강제한다 */
export function setGuestRule(project: string, relPath: string, view: boolean, edit: boolean) {
  const effectiveView = edit ? true : view
  const data = load()
  const list = data.projects[project] ?? []
  const idx = list.findIndex((r) => r.path === relPath)
  if (!effectiveView && !edit) {
    if (idx !== -1) list.splice(idx, 1)
  } else if (idx !== -1) {
    list[idx] = { path: relPath, view: effectiveView, edit }
  } else {
    list.push({ path: relPath, view: effectiveView, edit })
  }
  data.projects[project] = list
  save(data)
}

export function listGuestVisibleProjects(): string[] {
  const data = load()
  return listProjects().filter((p) => (data.projects[p] ?? []).some((r) => r.view))
}

/** 게스트 트리 필터 — 자신이 보이거나, 보이는 후손이 있으면 포함(탐색 경로 확보) */
export function filterTreeForGuest(project: string, nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = []
  for (const node of nodes) {
    if (node.type === 'file') {
      if (isGuestViewable(project, node.path)) out.push(node)
    } else {
      const children = filterTreeForGuest(project, node.children ?? [])
      const selfViewable = isGuestViewable(project, node.path)
      if (selfViewable || children.length > 0) {
        out.push({ ...node, children })
      }
    }
  }
  return out
}

/** member+ 사이드바 아이콘 표시용 — 트리 전체에 현재 게스트 규칙 상태를 붙인다(자기 노드에 정확히 걸린 규칙만) */
export function decorateTreeWithGuestAccess(project: string, nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    const rule = getGuestRule(project, node.path)
    const decorated: TreeNode = { ...node, guestAccess: { view: rule?.view ?? false, edit: rule?.edit ?? false } }
    if (node.type === 'dir') decorated.children = decorateTreeWithGuestAccess(project, node.children ?? [])
    return decorated
  })
}
