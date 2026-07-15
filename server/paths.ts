import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const DOCS_ROOT = path.resolve(here, '../../docs')

export class UnsafePathError extends Error {}

/** Resolves a repo-relative path against DOCS_ROOT, rejecting any path that escapes it. */
export function resolveDocsPath(relativePath: string): string {
  const normalized = relativePath.replace(/^\/+/, '')
  const resolved = path.resolve(DOCS_ROOT, normalized)
  if (resolved !== DOCS_ROOT && !resolved.startsWith(DOCS_ROOT + path.sep)) {
    throw new UnsafePathError(`Path escapes docs root: ${relativePath}`)
  }
  return resolved
}

export function toRelativePath(absolutePath: string): string {
  return path.relative(DOCS_ROOT, absolutePath)
}
