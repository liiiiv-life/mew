import fs from 'node:fs'
import path from 'node:path'
import simpleGit, { type SimpleGit } from 'simple-git'
import { DEFAULT_PROJECT, projectRoot } from './paths.ts'

// 프로젝트마다 자기 레포에서 커밋한다 — git 레포가 아닌 폴더는 커밋 없이 저장만 된다
const gitByProject = new Map<string, SimpleGit | null>()

function gitFor(project: string): SimpleGit | null {
  let git = gitByProject.get(project)
  if (git === undefined) {
    const root = projectRoot(project)
    git = fs.existsSync(path.join(root, '.git')) ? simpleGit({ baseDir: root }) : null
    gitByProject.set(project, git)
  }
  return git
}

export interface CommitResult {
  message: string
  files: string[]
  hash: string | null
}

/** 마지막 커밋(HEAD) 시점의 파일 내용 — 없으면(새 파일·비레포 등) null */
export async function showHeadContent(project: string, relPath: string): Promise<string | null> {
  const git = gitFor(project)
  if (!git) return null
  try {
    return await git.show([`HEAD:${relPath}`])
  } catch {
    return null
  }
}

/** 특정 커밋 시점의 파일 내용 — 없으면(그 커밋에 파일이 없음·비레포 등) null */
export async function showAtCommit(project: string, relPath: string, hash: string): Promise<string | null> {
  const git = gitFor(project)
  if (!git) return null
  try {
    return await git.show([`${hash}:${relPath}`])
  } catch {
    return null
  }
}

export interface FileHistoryEntry {
  hash: string
  date: string
  message: string
}

/** 특정 파일의 커밋 이력(최신순, 제목 한 줄만) — git 레포가 아니거나 커밋이 없으면 빈 배열 */
export async function fileHistory(project: string, relPath: string): Promise<FileHistoryEntry[]> {
  const git = gitFor(project)
  if (!git) return []
  try {
    const log = await git.log({ file: relPath })
    return log.all.map((entry) => ({ hash: entry.hash, date: entry.date, message: entry.message }))
  } catch {
    return []
  }
}

/** Stages relPath(s) plus (docs only) any changed MOC.md files and commits them together. Returns null if nothing changed. */
export async function commitFile(
  project: string,
  relPaths: string | string[],
  action: 'add' | 'update' | 'delete' | 'rename',
  message?: string,
): Promise<CommitResult | null> {
  const git = gitFor(project)
  if (!git) return null

  const paths = Array.isArray(relPaths) ? relPaths : [relPaths]
  const filesToStage = new Set<string>(paths)
  if (project === DEFAULT_PROJECT) {
    const status = await git.status()
    for (const f of [...status.modified, ...status.not_added, ...status.created, ...status.deleted]) {
      if (/^_?MOC\.md$/.test(path.basename(f))) filesToStage.add(f)
    }
  }

  await git.add([...filesToStage])
  const staged = await git.diff(['--cached', '--name-only'])
  if (!staged.trim()) return null

  const msg = message ?? `${project}: ${action} ${paths.join(', ')}`
  const result = await git.commit(msg)
  return { message: msg, files: [...filesToStage], hash: result.commit || null }
}
