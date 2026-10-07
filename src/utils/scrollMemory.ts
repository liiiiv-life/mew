import { scopedBrowserStorage } from '@mew/ui/browser-storage-scope'
import { writeBrowserStorage } from '@mew/ui/browser-storage'
// 문서별 스크롤 위치 저장·복원 (ADR 0039). 새로고침·브라우저 재시작(ADR 0038)에 더해
// 탭·창 전환에도 복원한다 — ADR 0029의 전환 복원 금지는 0039가 대체했다.

const storageKey = (project: string) => `mew:scroll:${project}`

function loadMap(project: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(scopedBrowserStorage().getItem(storageKey(project)) ?? '{}')
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

// 프로젝트명·경로에는 공백이 올 수 있어 NUL로 잇는다
const pendingKey = (project: string, path: string) => `${project}\u0000${path}`

// 스크롤은 초당 수십 번 오므로 모아서 쓴다 — pagehide에서 남은 것을 마저 써 새로고침 직전 위치를 잃지 않는다
const pending = new Map<string, number>()
let timer: ReturnType<typeof setTimeout> | null = null

export function flushScroll() {
  if (timer) clearTimeout(timer)
  timer = null
  const byProject = new Map<string, Record<string, number>>()
  for (const [k, top] of pending) {
    const cut = k.indexOf('\u0000')
    const project = k.slice(0, cut)
    const map = byProject.get(project) ?? loadMap(project)
    map[k.slice(cut + 1)] = top
    byProject.set(project, map)
  }
  pending.clear()
  // ponytail: 지운 파일의 항목이 남는다 — 항목당 수십 바이트라 방치, 문제되면 open-tabs 기준으로 청소
  for (const [project, map] of byProject) writeBrowserStorage(storageKey(project), JSON.stringify(map))
}

// 네이티브 드래그(사이드바 파일 끌기) 중에는 저장을 잠근다 — 드래그가 에디터 스크롤 영역
// 가장자리를 지나면 브라우저가 자동 스크롤을 일으키고, 그 이벤트가 사용자 위치인 양 저장돼
// 값을 0으로 오염시킨다. 분할 리마운트 복원이 읽을 값이 사라져 원래 칸이 맨 위로 돌아가던 원인.
let suppressed = false
export function setScrollSaveSuppressed(on: boolean) {
  suppressed = on
}

export function saveScroll(project: string, path: string, top: number) {
  if (suppressed) return
  pending.set(pendingKey(project, path), Math.round(top))
  if (!timer) timer = setTimeout(flushScroll, 200)
}

// 아직 flush 안 된 최신값(pending)을 우선한다 — 탭 전환 직전 스크롤이 여기 있다
export function getScroll(project: string, path: string): number | null {
  const top = pending.get(pendingKey(project, path)) ?? loadMap(project)[path]
  return typeof top === 'number' && top > 0 ? top : null
}

// 사이드바 파일 트리의 스크롤도 같은 저장소에 얹는다 — 모아쓰기·pagehide 마무리를 그대로 쓴다.
// 실제 경로에는 NUL이 들어갈 수 없으므로 어떤 파일과도 겹치지 않는 자리다
const TREE_PATH = '\u0000tree'
export const saveTreeScroll = (project: string, top: number) => saveScroll(project, TREE_PATH, top)
export const getTreeScroll = (project: string) => getScroll(project, TREE_PATH)

if (typeof window !== 'undefined') window.addEventListener('pagehide', flushScroll)
