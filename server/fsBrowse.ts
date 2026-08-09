// 워크스페이스 **바깥** 파일시스템을 훑는 유일한 통로 — docs 가져오기/내보내기 위치 고르기와
// 워크스페이스 바꾸기가 쓴다. 경로 제한이 없으므로 라우터에서 반드시 owner 전용으로 묶는다.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export class BrowseError extends Error {}

/** 사용자가 친 경로를 절대 경로로 — 빈 값은 홈, `~`는 홈 기준으로 편다 */
export function resolveBrowsePath(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return os.homedir()
  const expanded = trimmed === '~' || trimmed.startsWith('~/') ? path.join(os.homedir(), trimmed.slice(1)) : trimmed
  return path.resolve(expanded)
}

export type BrowseDir = { name: string; path: string }
export type BrowseResult = { path: string; parent: string | null; dirs: BrowseDir[] }

function isDir(abs: string): boolean {
  try {
    return fs.statSync(abs).isDirectory()
  } catch {
    return false
  }
}

/** 폴더 하나의 하위 폴더 목록 — 파일이 아니라 폴더만, 숨김 폴더는 빼고 이름순.
 *  워크스페이스 고르기에서는 여기 나온 폴더 하나하나가 곧 프로젝트다. */
export function listDirs(dir: string): BrowseResult {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    throw new BrowseError(`폴더를 열 수 없습니다: ${dir}`)
  }
  const parent = path.dirname(dir)
  return {
    path: dir,
    parent: parent === dir ? null : parent,
    dirs: entries
      .filter((e) => e.name !== 'node_modules' && !e.name.startsWith('.'))
      // 심볼릭 링크로 걸어둔 폴더도 폴더로 친다 — 워크스페이스를 링크로 두는 경우가 있다
      .filter((e) => e.isDirectory() || (e.isSymbolicLink() && isDir(path.join(dir, e.name))))
      .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}
