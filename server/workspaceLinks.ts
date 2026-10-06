// 에이전트 답변의 로컬 파일 링크를 현재 워크스페이스의 프로젝트·상대경로로 바꾼다.
// 브라우저가 서버 절대경로를 직접 열지 않고 App의 문서 탭 열기 흐름으로 들어가기 위한 경계다.
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_PROJECT, isDeniedSegment, listProjects, WORKSPACE_PROJECT, workspacePaths } from './paths.ts'

export interface WorkspaceFileLink {
  project: string
  path: string
  line: number | null
}

interface WorkspaceRoots {
  workspaceRoot: string
  docsRoot: string
  projects: string[]
}

function inside(root: string, candidate: string): string | null {
  const relative = path.relative(root, candidate)
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return null
  if (relative.split(path.sep).some(isDeniedSegment)) return null
  return relative.split(path.sep).join('/')
}

function pathAndLine(raw: string): { filePath: string; line: number | null } | null {
  let value = raw.trim()
  if (!value) return null

  const hashLine = value.match(/#L(\d+)(?:-L?\d+)?$/i)
  let line = hashLine ? Number(hashLine[1]) : null
  value = value.replace(/#.*$/, '').replace(/\?.*$/, '')

  if (/^file:/i.test(value)) {
    try {
      const url = new URL(value)
      if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost')) return null
      value = url.pathname
    } catch {
      return null
    }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return null
  }

  try {
    value = decodeURIComponent(value)
  } catch {
    return null
  }

  const suffix = value.match(/:(\d+)(?::\d+)?$/)
  if (suffix) {
    line ??= Number(suffix[1])
    value = value.slice(0, -suffix[0].length)
  }
  if (line !== null && (!Number.isSafeInteger(line) || line < 1)) line = null
  return { filePath: value, line }
}

/** 테스트에서는 임시 루트를 주입하고, 실제 요청에서는 아래 resolveWorkspaceLink가 라이브 경로를 넣는다. */
export function resolveWorkspaceLinkAt(raw: string, roots: WorkspaceRoots): WorkspaceFileLink | null {
  const parsed = pathAndLine(raw)
  if (!parsed) return null
  const absolute = path.isAbsolute(parsed.filePath)
    ? path.resolve(parsed.filePath)
    : path.resolve(roots.workspaceRoot, parsed.filePath)

  try {
    if (!fs.statSync(absolute).isFile()) return null
  } catch {
    return null
  }

  const docsPath = inside(roots.docsRoot, absolute)
  if (docsPath) return { project: DEFAULT_PROJECT, path: docsPath, line: parsed.line }

  for (const project of roots.projects) {
    const relative = inside(path.join(roots.workspaceRoot, project), absolute)
    if (relative) return { project, path: relative, line: parsed.line }
  }

  const workspacePath = inside(roots.workspaceRoot, absolute)
  return workspacePath ? { project: WORKSPACE_PROJECT, path: workspacePath, line: parsed.line } : null
}

export function resolveWorkspaceLink(raw: string): WorkspaceFileLink | null {
  return resolveWorkspaceLinkAt(raw, {
    workspaceRoot: workspacePaths.root,
    docsRoot: workspacePaths.docsRoot,
    projects: listProjects(),
  })
}
