import path from 'node:path'
import simpleGit from 'simple-git'
import { DOCS_ROOT } from './paths'

const git = simpleGit({ baseDir: DOCS_ROOT })

export interface CommitResult {
  message: string
  files: string[]
  hash: string | null
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
    if (path.basename(f) === 'MOC.md') filesToStage.add(f)
  }

  await git.add([...filesToStage])
  const staged = await git.diff(['--cached', '--name-only'])
  if (!staged.trim()) return null

  const msg = message ?? `docs: ${action} ${paths.join(', ')}`
  const result = await git.commit(msg)
  return { message: msg, files: [...filesToStage], hash: result.commit || null }
}
