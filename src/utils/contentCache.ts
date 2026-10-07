import { scopedBrowserStorage } from '@mew/ui/browser-storage-scope'
import { writeBrowserStorage } from '@mew/ui/browser-storage'
// 최근 연 파일의 본문 캐시 — 메모리(핫) + localStorage(콜드) 두 층.
//
// 탭을 오갈 때(특히 preview 탭이 이전 파일을 밀어낸 뒤 다시 열 때) 서버에서 처음부터 다시 받지
// 않고 바로 내용을 채운다. 디스크 층은 **새로고침 뒤**를 메운다 — 열려 있던 탭은 전부 복원되는데
// 예전에는 본문을 하나도 들고 있지 않아, 탭 수만큼의 `/api/file` 왕복이 끝날 때까지 전부 빈
// 화면이었다. 이제 캐시된 본문으로 즉시 그리고, fetch가 도착하면 최신본으로 갈아끼운다.
//
// 신원(로그인 이메일)마다 칸을 나누고, 신원이 바뀌면 **다른 칸을 전부 지운다** — 로그아웃·세션
// 만료·계정 전환 뒤에 남의 본문이 이 브라우저에 남아 있지 않게. 로그인해 있는 동안 자기 본문이
// 디스크에 남는 것은 의도된 것이다(그게 이 캐시의 목적이다).
const MEM_MAX = 20
/** localStorage에 남길 문서 수 — 넘으면 오래된 것부터 버린다 */
const DISK_MAX = 40
/** 이보다 큰 본문은 디스크에 두지 않는다 — 하나가 쿼터를 다 먹으면 캐시 전체가 날아간다 */
const MAX_BYTES = 128 * 1024
const PREFIX = 'mew:content:'
/** 그 칸의 LRU 순서(오래된 것부터)를 담는 키 */
const ORDER_SUFFIX = '@order'

export interface CachedFile {
  content: string
  editable: boolean
}

// 삽입 순서 = 최근 사용 순서(LRU). 접근할 때마다 지웠다 다시 넣어 맨 뒤로 보낸다.
const cache = new Map<string, CachedFile>()

let identity = 'guest'
let workspace = ''
let scope = `${PREFIX}${identity}:`
// 처음 쓸 때 읽어 온다 — 모듈이 로드되는 시점에는 localStorage를 건드리지 않는다.
// (로그인하지 않은 채로 계속 쓰는 경우 setContentIdentity가 한 번도 안 불리므로 여기서 채워야 한다)
let order: string[] | null = null

function orderList(): string[] {
  if (!order) order = loadOrder()
  return order
}

// 프로젝트마다 같은 경로(README.md 등)가 있으므로 키에 프로젝트를 넣는다 — 안 그러면
// 프로젝트를 옮겼을 때 옆 프로젝트의 내용이 잠깐 떠 있다가 fetch로 덮인다.
function key(project: string, path: string): string {
  return `${project} ${path}`
}

function loadOrder(): string[] {
  try {
    const raw = scopedBrowserStorage().getItem(scope + ORDER_SUFFIX)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function saveOrder() {
  try {
    writeBrowserStorage(scope + ORDER_SUFFIX, JSON.stringify(orderList()))
  } catch {
    /* 쿼터·비활성 저장소 — 캐시는 없어도 되는 것이다 */
  }
}

/** 본문 캐시를 디스크에서 지운다. `keepScope`면 지금 신원의 칸만 남긴다 */
export function clearPersistedContent(keepScope = false) {
  try {
    const doomed: string[] = []
    for (let i = 0; i < scopedBrowserStorage().length; i++) {
      const k = scopedBrowserStorage().key(i)
      if (!k || !k.startsWith(PREFIX)) continue
      if (keepScope && k.startsWith(scope)) continue
      doomed.push(k)
    }
    for (const k of doomed) scopedBrowserStorage().removeItem(k)
  } catch {
    /* 저장소를 못 쓰는 브라우저 — 메모리 층만으로 돈다 */
  }
  if (!keepScope) order = []
}

/**
 * 지금 로그인한 사람으로 캐시 칸을 바꾼다. **탭 복원보다 먼저** 불러야 한다(App).
 * 바뀌었으면 다른 칸의 본문은 디스크에서 지운다.
 */
function setScope(dropOtherIdentities = false) {
  // 루트를 아직 모르는 초기 로그인/기존 설치는 예전 키 형식을 유지한다. 실제 루트가 확인된
  // 뒤에만 경로를 더해 프로젝트 간 `.workspace` 충돌을 막는다.
  const next = workspace ? `${PREFIX}${identity}:${workspace}:` : `${PREFIX}${identity}:`
  if (next === scope) return
  scope = next
  cache.clear()
  // 로그인 신원이 바뀔 때만 다른 신원의 본문을 지운다. 루트만 옮길 때 지우면 프로젝트별
  // 캐시를 만들었어도 바로 이전 프로젝트 캐시를 잃어버린다.
  if (dropOtherIdentities) clearPersistedContent(true)
  order = loadOrder()
}

export function setContentIdentity(email: string | null) {
  identity = email ?? 'guest'
  setScope(true)
}

/** 루트 프로젝트마다 `.workspace`라는 API 이름이 같으므로 본문 캐시도 절대 경로로 나눈다. */
export function setContentWorkspace(path: string | null) {
  workspace = path ?? ''
  setScope()
}

function remember(k: string, file: CachedFile) {
  cache.delete(k)
  cache.set(k, file)
  while (cache.size > MEM_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

function readDisk(k: string): CachedFile | undefined {
  try {
    const raw = scopedBrowserStorage().getItem(scope + k)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Partial<CachedFile>
    if (typeof parsed?.content !== 'string') return undefined
    return { content: parsed.content, editable: parsed.editable !== false }
  } catch {
    return undefined
  }
}

function writeDisk(k: string, file: CachedFile) {
  if (file.content.length > MAX_BYTES) {
    try { scopedBrowserStorage().removeItem(scope + k) } catch { /* Optional cache only. */ }
    return
  }
  const payload = JSON.stringify(file)
  if (!writeBrowserStorage(scope + k, payload)) return
  order = orderList().filter((x) => x !== k)
  order.push(k)
  while (order.length > DISK_MAX) {
    const oldest = order.shift()
    if (oldest === undefined) break
    try {
      scopedBrowserStorage().removeItem(scope + oldest)
    } catch {
      /* 이미 없다 */
    }
  }
  saveOrder()
}

export function getCachedFile(project: string, path: string): CachedFile | undefined {
  const k = key(project, path)
  const hit = cache.get(k)
  if (hit) {
    remember(k, hit)
    return hit
  }
  const stored = readDisk(k)
  if (stored) remember(k, stored)
  return stored
}

export function putCachedFile(project: string, path: string, file: CachedFile) {
  const k = key(project, path)
  remember(k, file)
  writeDisk(k, file)
}

export function dropCachedFile(project: string, path: string) {
  const k = key(project, path)
  cache.delete(k)
  order = orderList().filter((x) => x !== k)
  try {
    scopedBrowserStorage().removeItem(scope + k)
  } catch {
    /* 저장소를 못 쓴다 */
  }
  saveOrder()
}

export function clearFileContentCache() { cache.clear(); clearPersistedContent() }
