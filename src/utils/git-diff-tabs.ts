import type { GitChangedFile } from '../api/client'

export interface GitDiffTarget {
  project: string
  repositoryPath: string
  source: { kind: 'working' } | { kind: 'commit'; hash: string }
  file: GitChangedFile
}

const PREFIX = 'mew:diff:'

export function gitDiffTabPath(target: GitDiffTarget): string {
  return PREFIX + encodeURIComponent(JSON.stringify([target.project, target.repositoryPath, target.source.kind === 'commit' ? target.source.hash : null, target.file.path]))
}

export function gitDiffTarget(path: string): Omit<GitDiffTarget, 'file'> & { filePath: string } | null {
  if (!path.startsWith(PREFIX)) return null
  try {
    const value: unknown = JSON.parse(decodeURIComponent(path.slice(PREFIX.length)))
    if (!Array.isArray(value) || value.length !== 4) return null
    const [project, repositoryPath, hash, filePath] = value
    if (typeof project !== 'string' || typeof repositoryPath !== 'string' || typeof filePath !== 'string' || hash !== null && typeof hash !== 'string') return null
    return { project, repositoryPath, source: hash === null ? { kind: 'working' } : { kind: 'commit', hash }, filePath }
  } catch { return null }
}
