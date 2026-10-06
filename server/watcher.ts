import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_PROJECT, isDeniedSegment, projectRoot, UnknownProjectError } from './paths.ts'
import { readIgnoreSet } from './ignoreList.ts'
import { broadcastTree } from './presence.ts'
import {
  fileCatalogStatus,
  noteFileContentChanged,
  readyFileCatalog,
  reconcileFileCatalog,
  refreshFileCatalogParent,
  resetFileCatalogs,
  warmFileCatalog,
} from './fileCatalog.ts'
import { resetSearchIndex } from './searchCatalog.ts'
import { measure } from './perfMarks.ts'

// 감시할 때 내려가지 않는 디렉터리. 트리에 안 보이는 것(숨김 목록)과 접근 차단 세그먼트(node_modules·.git·.data)에
// 더해 build까지 제외한다 — node_modules를 통째로 inotify로 걸면 감시 수천 개가 되어 한계(ENOSPC)에 걸리고,
// flutter build/ 는 수천 디렉터리를 만들어 감시 폭발을 일으킨다. build 안 산출물(APK/AAB)이 트리에 새로
// 뜨는 건 드문 경우라 새로고침에 맡긴다. (Node의 recursive watch는 하위 트리 제외를 지원하지 않아 직접 건다.)
function noDescend(ignore: Set<string>): Set<string> {
  return new Set([...ignore, 'build'])
}

/** root 아래에서 실제로 watch를 걸 디렉터리 절대경로 목록 — node_modules 등 제외 구역은 내려가지 않는다 */
export function collectWatchDirs(root: string, ignore: Set<string> = readIgnoreSet()): string[] {
  const skip = noDescend(ignore)
  const out: string[] = []
  const walk = (dir: string) => {
    out.push(dir)
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return // 경쟁 상태로 사라진 디렉터리 — 다음 sync에서 정리된다
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !skip.has(entry.name) && !isDeniedSegment(entry.name)) {
        walk(path.join(dir, entry.name))
      }
    }
  }
  walk(root)
  return out
}

/** 느린 파일시스템에서도 감시자 등록이 HTTP 이벤트 루프를 독점하지 않는 비동기 순회. */
export async function collectWatchDirsAsync(root: string, ignore: Set<string> = readIgnoreSet()): Promise<string[]> {
  const skip = noDescend(ignore)
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    out.push(dir)
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !skip.has(entry.name) && !isDeniedSegment(entry.name)) {
        await walk(path.join(dir, entry.name))
      }
    }
  }
  await walk(root)
  return out
}

// 한 프로젝트 루트를 감시한다. 하위 디렉터리마다 non-recursive fs.watch를 걸고(제외 구역은 건너뜀),
// 이벤트는 영향 받은 부모·파일만 catalog에 반영한다. 새/삭제 디렉터리의 watch도 그 하위만 맞추며,
// filename을 잃은 OS 이벤트에서만 안전하게 전체 watch 집합을 다시 확인한다.
class TreeWatcher {
  private readonly project: string
  private readonly root: string
  private readonly watchers = new Map<string, fs.FSWatcher>() // absDir -> watcher
  private timer: NodeJS.Timeout | null = null
  private closed = false
  private refreshing = false
  private refreshAgain = false
  private readonly pendingParents = new Set<string>()
  private readonly pendingContent = new Set<string>()
  private readonly pendingWatchTargets = new Set<string>()
  private needsFullSync = false

  constructor(project: string, root: string) {
    this.project = project
    this.root = root
  }

  async start() {
    warmFileCatalog(this.project)
    const snapshot = await readyFileCatalog(this.project)
    const skip = noDescend(readIgnoreSet())
    const dirs = [...snapshot.childrenByParent.keys()]
      .filter((relDir) => relDir.split('/').filter(Boolean).every((segment) => !skip.has(segment) && !isDeniedSegment(segment)))
      .map((relDir) => relDir ? path.join(this.root, ...relDir.split('/')) : this.root)
    await this.sync(new Set(dirs))
  }

  /** 현재 디스크 구조에 맞춰 watch 집합을 맞춘다 — 새 디렉터리엔 watch를 걸고, 사라진 것은 닫는다 */
  private async sync(wanted?: Set<string>) {
    const desired = wanted ?? new Set(await measure('watch.sync', {}, () => collectWatchDirsAsync(this.root)))
    // 워크스페이스 전환 중 비동기 순회가 끝나도 옛 폴더 감시자를 되살리지 않는다.
    if (this.closed) return
    for (const [dir, watcher] of this.watchers) {
      if (!desired.has(dir)) {
        watcher.close()
        this.watchers.delete(dir)
      }
    }
    for (const dir of desired) {
      this.addWatcher(dir)
    }
  }

  private addWatcher(dir: string) {
    if (this.closed || this.watchers.has(dir)) return
    try {
      const watcher = fs.watch(dir, (eventType, filename) => this.schedule(dir, eventType, filename))
      watcher.on('error', () => {
        watcher.close()
        this.watchers.delete(dir)
        this.schedule(dir, 'rename', null)
      })
      this.watchers.set(dir, watcher)
    } catch {
      // 방금 사라진 디렉터리 — 다음 이벤트나 fallback sync에서 정리된다
    }
  }

  private async syncTarget(target: string) {
    for (const [dir, watcher] of this.watchers) {
      if (dir === target || dir.startsWith(`${target}${path.sep}`)) {
        let exists = false
        try { exists = fs.statSync(dir).isDirectory() } catch { /* 삭제됨 */ }
        if (!exists) { watcher.close(); this.watchers.delete(dir) }
      }
    }
    let isDirectory = false
    try { isDirectory = fs.statSync(target).isDirectory() } catch { /* 삭제됨 */ }
    if (!isDirectory) return
    for (const dir of await collectWatchDirsAsync(target)) this.addWatcher(dir)
  }

  close() {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
  }

  private schedule(dir: string, eventType: string, filename: string | Buffer | null) {
    if (this.closed) return
    const relDir = path.relative(this.root, dir).split(path.sep).join('/')
    const name = filename?.toString()
    if (eventType === 'rename' || !name) {
      this.pendingParents.add(relDir)
      // A .mew marker changes the containing folder's project flag in its parent.
      if (name === '.mew' && relDir) {
        const parent = path.posix.dirname(relDir)
        this.pendingParents.add(parent === '.' ? '' : parent)
      }
      if (name) {
        const relPath = relDir ? `${relDir}/${name}` : name
        this.pendingContent.add(relPath)
        this.pendingWatchTargets.add(path.join(dir, name))
      }
      else this.needsFullSync = true
    }
    else this.pendingContent.add(relDir ? `${relDir}/${name}` : name)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.refresh()
    }, 300)
  }

  private async refresh() {
    if (this.refreshing) {
      this.refreshAgain = true
      return
    }
    this.refreshing = true
    try {
      do {
        this.refreshAgain = false
        const parents = [...this.pendingParents]
        const content = [...this.pendingContent]
        const watchTargets = [...this.pendingWatchTargets]
        const fullSync = this.needsFullSync
        this.pendingParents.clear()
        this.pendingContent.clear()
        this.pendingWatchTargets.clear()
        this.needsFullSync = false
        if (this.closed) return
        for (const relPath of content) noteFileContentChanged(this.project, relPath)
        const changedParents: string[] = []
        if (fullSync) {
          if (await reconcileFileCatalog(this.project)) changedParents.push('')
          await this.sync()
        } else {
          for (const parent of parents) {
            if (await refreshFileCatalogParent(this.project, parent)) changedParents.push(parent)
          }
          for (const target of watchTargets) await this.syncTarget(target)
        }
        if (changedParents.length) {
          const status = fileCatalogStatus(this.project)
          broadcastTree({ type: 'tree', project: this.project, version: status.version, parents: changedParents })
        }
      } while (this.refreshAgain && !this.closed)
    } finally {
      this.refreshing = false
    }
  }
}

const watchers = new Map<string, TreeWatcher>()

/** 프로젝트 트리를 감시해 구조가 바뀌면(파일·폴더 생성·삭제·이동) 모든 세션에 tree 신호를 보낸다.
 *  여러 번 불러도 안전(멱등)하고, 존재하지 않는 프로젝트면 아무것도 하지 않는다. */
export function watchProjectTree(project: string) {
  let root: string
  try {
    root = projectRoot(project)
  } catch (err) {
    if (err instanceof UnknownProjectError) return
    throw err
  }
  if (watchers.has(root)) return
  const watcher = new TreeWatcher(project, root)
  watchers.set(root, watcher)
  void watcher.start().catch(() => {
    // 권한 변경·삭제·네트워크 드라이브 단절은 트리 응답 자체를 실패시키지 않는다.
    watcher.close()
    if (watchers.get(root) === watcher) watchers.delete(root)
  })
}

/** docs 루트 감시 — 서버·dev 플러그인 부팅 시 호출(다른 프로젝트는 /api/tree 최초 조회 때 지연 등록된다) */
export function watchDocsTree() {
  watchProjectTree(DEFAULT_PROJECT)
}

/**
 * 감시를 전부 접는다 — 숨김 목록이 바뀌었을 때 부른다. 살아 있는 watcher는 이미 지나간 숨김 규칙으로
 * 디렉터리 집합과 catalog snapshot을 옛 규칙으로 들고 있으므로 접어 둔다. 클라이언트가 새 트리를 받을 때
 * 새 규칙으로 watcher·catalog·정확 검색 색인을 다시 만든다.
 */
export function resetTreeWatchers() {
  for (const watcher of watchers.values()) watcher.close()
  watchers.clear()
  resetFileCatalogs()
  resetSearchIndex()
}
