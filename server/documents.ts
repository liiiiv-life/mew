import fs from 'node:fs'
import path from 'node:path'
import { DOCS_ROOT } from './paths'

export class ConflictError extends Error {}

/** Walks up from relDir toward DOCS_ROOT looking for the nearest MOC.md, falling back to the root one. */
function findNearestMoc(relDir: string): string {
  let dir = relDir
  while (dir && dir !== '.') {
    const candidate = path.join(dir, 'MOC.md')
    if (fs.existsSync(path.join(DOCS_ROOT, candidate))) return candidate.split(path.sep).join('/')
    dir = path.dirname(dir)
  }
  return 'MOC.md'
}

function appendMocLink(mocRelPath: string, targetRelPath: string, title: string) {
  const mocAbs = path.join(DOCS_ROOT, mocRelPath)
  const linkPath = path.relative(path.dirname(mocAbs), path.join(DOCS_ROOT, targetRelPath)).split(path.sep).join('/')
  const content = fs.readFileSync(mocAbs, 'utf-8')
  fs.writeFileSync(mocAbs, content.replace(/\s*$/, '') + `\n- [${title}](${linkPath})\n`, 'utf-8')
}

/** Creates a new document with a bare `# title` heading and links it from the nearest MOC.md. */
export function createDocument(relPath: string, title: string): { relPath: string; mocRelPath: string } {
  const abs = path.join(DOCS_ROOT, relPath)
  if (fs.existsSync(abs)) throw new ConflictError(`이미 존재하는 파일입니다: ${relPath}`)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, `# ${title}\n`, 'utf-8')
  const mocRelPath = findNearestMoc(path.dirname(relPath))
  appendMocLink(mocRelPath, relPath, title)
  return { relPath, mocRelPath }
}

/** Creates an empty directory (a no-op in git until it holds a tracked file). */
export function createFolder(relPath: string): { relPath: string } {
  const abs = path.join(DOCS_ROOT, relPath)
  if (fs.existsSync(abs)) throw new ConflictError(`이미 존재하는 폴더입니다: ${relPath}`)
  fs.mkdirSync(abs, { recursive: true })
  return { relPath }
}

/** Renames/moves a file or directory on disk. */
export function renamePath(oldRelPath: string, newRelPath: string): void {
  const oldAbs = path.join(DOCS_ROOT, oldRelPath)
  const newAbs = path.join(DOCS_ROOT, newRelPath)
  if (!fs.existsSync(oldAbs)) throw new ConflictError(`존재하지 않는 경로입니다: ${oldRelPath}`)
  if (fs.existsSync(newAbs)) throw new ConflictError(`이미 존재하는 경로입니다: ${newRelPath}`)
  fs.mkdirSync(path.dirname(newAbs), { recursive: true })
  fs.renameSync(oldAbs, newAbs)
}

/** Deletes a file or directory (recursively) from disk. */
export function deletePath(relPath: string): void {
  fs.rmSync(path.join(DOCS_ROOT, relPath), { recursive: true, force: true })
}
