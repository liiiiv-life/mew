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
export type BrowseEntry = { name: string; path: string; type: 'file' | 'dir'; size: number | null; git?: boolean }
export type BrowseEntriesResult = { path: string; parent: string | null; entries: BrowseEntry[] }

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

/** 서버 파일 탐색기용 한 단계 목록. 숨김·빌드 폴더를 포함해 OS 사용자가 볼 수 있는 항목을 그대로 돌려준다. */
export async function listEntries(input: string): Promise<BrowseEntriesResult> {
  const dir = resolveBrowsePath(input)
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    throw new BrowseError(`폴더를 열 수 없습니다: ${dir}`)
  }
  const result: BrowseEntry[] = []
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    let type: BrowseEntry['type'] | null = entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : null
    let size: number | null = null
    if (entry.isSymbolicLink()) {
      try {
        const stat = await fs.promises.stat(abs)
        type = stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : null
        size = stat.isFile() ? stat.size : null
      } catch {
        type = null
      }
    } else if (type === 'file') {
      try { size = (await fs.promises.stat(abs)).size } catch { size = null }
    }
    if (type) result.push({ name: entry.name, path: abs, type, size, ...(type === 'dir' ? { git: fs.existsSync(path.join(abs, '.git')) } : {}) })
  }
  result.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
  const parent = path.dirname(dir)
  return { path: dir, parent: parent === dir ? null : parent, entries: result }
}

export function resolveExistingPath(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) throw new BrowseError('경로가 필요합니다')
  const abs = resolveBrowsePath(input)
  if (!fs.existsSync(abs)) throw new BrowseError(`경로를 찾을 수 없습니다: ${abs}`)
  return abs
}

function validChildName(input: unknown): string {
  if (typeof input !== 'string' || !input.trim() || input === '.' || input === '..' || input.includes('/') || input.includes('\\')) {
    throw new BrowseError('폴더 이름이 올바르지 않습니다')
  }
  return input.trim()
}

/** 외부 프로젝트 브라우저의 현재 디렉터리에 빈 폴더를 만든다. */
export function createExternalFolder(parentInput: unknown, nameInput: unknown): string {
  const parent = resolveExistingPath(parentInput)
  if (!fs.statSync(parent).isDirectory()) throw new BrowseError(`폴더가 아닙니다: ${parent}`)
  const target = path.join(parent, validChildName(nameInput))
  if (fs.existsSync(target)) throw new BrowseError(`이미 존재하는 경로입니다: ${target}`)
  fs.mkdirSync(target)
  return target
}

export function readExternalFile(input: unknown): { path: string; content: string } {
  const abs = resolveExistingPath(input)
  const stat = fs.statSync(abs)
  if (!stat.isFile()) throw new BrowseError(`파일이 아닙니다: ${abs}`)
  if (stat.size > 10 * 1024 * 1024) throw new BrowseError('텍스트 편집은 10MB 이하 파일만 지원합니다')
  return { path: abs, content: fs.readFileSync(abs, 'utf8') }
}

export function writeExternalFile(input: unknown, content: unknown): string {
  const abs = resolveExistingPath(input)
  if (typeof content !== 'string') throw new BrowseError('파일 내용이 올바르지 않습니다')
  if (!fs.statSync(abs).isFile()) throw new BrowseError(`파일이 아닙니다: ${abs}`)
  fs.writeFileSync(abs, content, 'utf8')
  return abs
}

export function renameExternalPath(input: unknown, name: unknown): string {
  const abs = resolveExistingPath(input)
  if (typeof name !== 'string' || !name.trim() || name.includes('/') || name.includes('\\')) {
    throw new BrowseError('새 이름이 올바르지 않습니다')
  }
  const target = path.join(path.dirname(abs), name.trim())
  if (fs.existsSync(target)) throw new BrowseError(`이미 존재하는 경로입니다: ${target}`)
  fs.renameSync(abs, target)
  return target
}

export function deleteExternalPath(input: unknown): void {
  fs.rmSync(resolveExistingPath(input), { recursive: true, force: true })
}

function availableTarget(destDir: string, source: string): string {
  const ext = fs.statSync(source).isFile() ? path.extname(source) : ''
  const base = path.basename(source, ext)
  for (let n = 0; n < 10_000; n += 1) {
    const suffix = n === 0 ? '' : ` copy${n === 1 ? '' : ` ${n}`}`
    const candidate = path.join(destDir, `${base}${suffix}${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  throw new BrowseError(`복사본 이름을 만들 수 없습니다: ${source}`)
}

export function pasteExternalPath(sourceInput: unknown, destInput: unknown, mode: unknown): string {
  const source = resolveExistingPath(sourceInput)
  const destDir = resolveExistingPath(destInput)
  if (!fs.statSync(destDir).isDirectory()) throw new BrowseError(`폴더가 아닙니다: ${destDir}`)
  if (source === destDir || destDir.startsWith(source + path.sep)) throw new BrowseError('폴더를 자기 자신 안으로 옮길 수 없습니다')
  const target = availableTarget(destDir, source)
  if (mode === 'cut') {
    try {
      fs.renameSync(source, target)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
      fs.cpSync(source, target, { recursive: true })
      fs.rmSync(source, { recursive: true, force: true })
    }
  } else if (mode === 'copy') {
    fs.cpSync(source, target, { recursive: true })
  } else {
    throw new BrowseError('붙여넣기 방식이 올바르지 않습니다')
  }
  return target
}
