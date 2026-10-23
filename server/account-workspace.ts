import fs from 'node:fs'
import { WORKSPACE_ROOT, pathsForWorkspace, workspaceContext } from './paths.ts'
import { readActiveWorkspace } from './userUiState.ts'

/** Snapshot the account's root for the entire request, including asynchronous work. */
export function runAccountWorkspace<T>(account: string | null, action: () => T): T {
  const saved = account ? readActiveWorkspace(account) : null
  let root = WORKSPACE_ROOT
  if (saved) {
    try { if (fs.statSync(saved).isDirectory()) root = saved } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
    }
  }
  return workspaceContext.run(pathsForWorkspace(root, account), action)
}
