import path from 'node:path'
import simpleGit from 'simple-git'
import { DOCS_ROOT } from './paths'

const git = simpleGit({ baseDir: DOCS_ROOT })

export interface CommitResult {
  message: string
  files: string[]
  hash: string | null
}

/** 마지막 커밋(HEAD) 시점의 파일 내용 — 없으면(새 파일 등) null */
export async function showHeadContent(relPath: string): Promise<string | null> {
  try {
    return await git.show([`HEAD:${relPath}`])
  } catch {
    return null
  }
}

/** Stages relPath(s) plus any changed MOC.md files and commits them together. Returns null if nothing changed. */
export async function commitFile(
  relPaths: string | string[],
  action: 'add' | 'update' | 'delete' | 'rename',
  message?: string,
): Promise<CommitResult | null> {
  const paths = Array.isArray(relPaths) ? relPaths : [relPaths]
  const status = await git.status()
  const filesToStage = new Set<string>(paths)
  for (const f of [...status.modified, ...status.not_added, ...status.created, ...status.deleted]) {
    if (/^_?MOC\.md$/.test(path.basename(f))) filesToStage.add(f)
  }

  await git.add([...filesToStage])
  const staged = await git.diff(['--cached', '--name-only'])
  if (!staged.trim()) return null

  const msg = message ?? `docs: ${action} ${paths.join(', ')}`
  const result = await git.commit(msg)
  return { message: msg, files: [...filesToStage], hash: result.commit || null }
}
