import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_PROJECT, isDeniedSegment, projectRoot, UnknownProjectError } from './paths.ts'
import { buildTree } from './tree.ts'
import { readIgnoreSet } from './ignoreList.ts'
import { broadcast } from './presence.ts'

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

// 한 프로젝트 루트를 감시한다. 하위 디렉터리마다 non-recursive fs.watch를 걸고(제외 구역은 건너뜀),
// 이벤트가 나면 디바운스 후 트리 구조 JSON을 다시 계산해 실제로 달라졌을 때만 tree 신호를 브로드캐스트한다.
// 본문 저장(내용만 변경)도 이벤트를 내지만 트리 구조는 그대로라 브로드캐스트되지 않는다.
class TreeWatcher {
  private readonly project: string
  private readonly root: string
  private readonly watchers = new Map<string, fs.FSWatcher>() // absDir -> watcher
  private timer: NodeJS.Timeout | null = null
  private lastJson = ''

  constructor(project: string, root: string) {
    this.project = project
    this.root = root
    this.lastJson = this.signature()
    this.sync()
  }

  private signature(): string {
    try {
      return JSON.stringify(buildTree(this.project))
    } catch {
      return this.lastJson // 삭제·이동 도중의 일시 상태는 다음 이벤트에서 따라잡는다
    }
  }

  /** 현재 디스크 구조에 맞춰 watch 집합을 맞춘다 — 새 디렉터리엔 watch를 걸고, 사라진 것은 닫는다 */
  private sync() {
    const wanted = new Set(collectWatchDirs(this.root))
    for (const [dir, watcher] of this.watchers) {
      if (!wanted.has(dir)) {
        watcher.close()
        this.watchers.delete(dir)
      }
    }
    for (const dir of wanted) {
      if (this.watchers.has(dir)) continue
      try {
        const watcher = fs.watch(dir, () => this.schedule())
        watcher.on('error', () => {
          watcher.close()
          this.watchers.delete(dir)
          this.schedule()
        })
        this.watchers.set(dir, watcher)
      } catch {
        // 방금 사라진 디렉터리 — 다음 sync에서 정리된다
      }
    }
  }

  close() {
    if (this.timer) clearTimeout(this.timer)
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.sync() // 새로 생긴 하위 디렉터리에 watch 추가 / 사라진 것 정리
      const json = this.signature()
      if (json === this.lastJson) return
      this.lastJson = json
      broadcast({ type: 'tree' })
    }, 300)
  }
}

const watchers = new Map<string, TreeWatcher>()

/** 프로젝트 트리를 감시해 구조가 바뀌면(파일·폴더 생성·삭제·이동) 모든 세션에 tree 신호를 보낸다.
 *  여러 번 불러도 안전(멱등)하고, 존재하지 않는 프로젝트면 아무것도 하지 않는다. */
export function watchProjectTree(project: string) {
  if (watchers.has(project)) return
  let root: string
  try {
    root = projectRoot(project)
  } catch (err) {
    if (err instanceof UnknownProjectError) return
    throw err
  }
  watchers.set(project, new TreeWatcher(project, root))
}

/** docs 루트 감시 — 서버·dev 플러그인 부팅 시 호출(다른 프로젝트는 /api/tree 최초 조회 때 지연 등록된다) */
export function watchDocsTree() {
  watchProjectTree(DEFAULT_PROJECT)
}

/**
 * 감시를 전부 접는다 — 숨김 목록이 바뀌었을 때 부른다. 살아 있는 watcher는 이미 지나간 숨김 규칙으로
 * 디렉터리 집합과 트리 서명(lastJson)을 들고 있어서, 그대로 두면 새 규칙이 반영된 트리를 "변화 없음"으로
 * 흘려버린다. 접어두면 클라이언트가 새 트리를 받을 때(/api/tree) 새 규칙으로 다시 등록된다.
 */
export function resetTreeWatchers() {
  for (const watcher of watchers.values()) watcher.close()
  watchers.clear()
}
