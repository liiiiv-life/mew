import fs from 'node:fs'
import path from 'node:path'
import { projectRoot, resolveProjectPath, UnsafePathError } from './paths.ts'

/** A marker must be a real directory, never a file or a symlink. */
export function hasProjectMarker(directory: string): boolean {
  try { return fs.lstatSync(path.join(directory, '.mew')).isDirectory() } catch { return false }
}

/** Resolve an existing folder without following links beneath the project root. */
export function projectDirectory(project: string, relative: unknown = ''): string {
  if (typeof relative !== 'string' || path.isAbsolute(relative)
    || relative.split(/[\\/]/).some(segment => segment === '..' || segment === '.mew')) {
    throw new UnsafePathError('프로젝트 안의 일반 폴더를 선택하세요')
  }
  const root = projectRoot(project)
  const directory = resolveProjectPath(project, relative)
  let current = root
  for (const segment of path.relative(root, directory).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    if (!fs.lstatSync(current).isDirectory()) throw new UnsafePathError('실제 폴더만 하위 프로젝트로 사용할 수 있습니다')
  }
  return directory
}

export function createSubproject(project: string, relative: unknown): void {
  const directory = projectDirectory(project, relative)
  if (directory === projectRoot(project)) throw new UnsafePathError('하위 폴더를 선택하세요')
  const marker = path.join(directory, '.mew')
  try { fs.mkdirSync(marker) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      if (hasProjectMarker(directory)) return
      throw new UnsafePathError('.mew 위치에 파일 또는 링크가 있습니다. 실제 폴더가 필요합니다')
    }
    throw error
  }
}

/** Resolve a marked descendant for opening as its own root project. */
export function subprojectToOpen(project: string, relative: unknown): string {
  const directory = projectDirectory(project, relative)
  if (directory === projectRoot(project) || !hasProjectMarker(directory)) {
    throw new UnsafePathError('하위 프로젝트 폴더를 선택하세요')
  }
  return directory
}
