import path from 'node:path'
import { DATA_DIR, readJsonFile, writeFileAtomic } from './dataDir.ts'

// 트리·검색·감시에서 통째로 건너뛸 **이름** 목록. 경로가 아니라 이름이라 어느 깊이에 있든 그 이름의
// 폴더·파일은 보이지 않는다(예: 'dist' → 모든 프로젝트의 모든 dist/). 프로젝트별이 아니라 전역이고,
// 설정 창에서 owner/manager가 고친다. 저장 위치는 .data/ — 워크스페이스가 아니라 앱 폴더 안이다.
//
// 파일 형식: { "names": ["dist", ".next", ...] }
const IGNORE_FILE = path.join(DATA_DIR, 'ignore.json')

/** 아직 아무것도 저장하지 않았을 때 쓰는 목록 — 설정 창의 "기본값으로" 버튼도 이걸 되돌린다 */
export const DEFAULT_IGNORE = [
  '.git',
  'node_modules',
  '.foam',
  '.github',
  '.obsidian',
  '.tokensave',
  '.vscode',
  '.idea',
  '.data',
  'dist',
  // 'build'는 기본 숨김이 아니다 — 내부의 APK/AAB만 노출(tree.ts DOWNLOAD_ONLY_DIRS), 나머지·빈 폴더는 walk에서 접는다
  '.next',
  '.venv',
  '__pycache__',
  '.claude',
]

// 목록에서 빼도 계속 차단되는 이름 — paths.ts의 DENY_SEGMENTS가 API 계층에서 막는다(저장소 내부·인증 데이터).
// 지울 수 있는 것처럼 보이면 "지웠는데 왜 안 보이지"가 되므로 UI가 고정 항목으로 표시한다.
export const LOCKED_IGNORE = ['.git', 'node_modules', '.data']

const MAX_ENTRIES = 200
const MAX_NAME_LEN = 64
// 이름 하나여야 한다 — 경로 구분자·상위 참조가 들어오면 "이름 비교"라는 의미가 깨진다
const NAME_RE = /^[^/\\]+$/

export class IgnoreListError extends Error {}

// 트리를 그릴 때마다 파일을 읽지 않게 메모리에 들고 있는다. 쓰기는 이 서버 프로세스를 거치므로
// 무효화 지점은 writeIgnoreList 하나뿐이다.
let cache: string[] | null = null

/** 현재 숨김 목록. 파일이 없거나 깨져 있으면 기본값 — 못 읽었다고 아무것도 안 숨기면 트리가 터진다 */
export function readIgnoreList(): string[] {
  if (cache) return cache
  let parsed: { names?: unknown } | null = null
  try {
    parsed = readJsonFile<{ names?: unknown }>(IGNORE_FILE)
  } catch {
    return DEFAULT_IGNORE
  }
  if (!parsed || !Array.isArray(parsed.names)) return DEFAULT_IGNORE
  const names = parsed.names.filter((n): n is string => typeof n === 'string' && NAME_RE.test(n))
  cache = dedupe(names)
  return cache
}

export function readIgnoreSet(): Set<string> {
  return new Set(readIgnoreList())
}

/** 클라이언트가 보낸 목록을 검증해 정규화한다 — 통과 못 하면 IgnoreListError(=400) */
export function normalizeIgnoreList(input: unknown): string[] {
  if (!Array.isArray(input)) throw new IgnoreListError('숨김 목록이 배열이 아닙니다')
  if (input.length > MAX_ENTRIES) throw new IgnoreListError(`숨김 항목은 최대 ${MAX_ENTRIES}개까지입니다`)
  const out: string[] = []
  for (const item of input) {
    if (typeof item !== 'string') throw new IgnoreListError('숨김 항목은 문자열이어야 합니다')
    const name = item.trim()
    if (!name) throw new IgnoreListError('빈 이름은 넣을 수 없습니다')
    if (name.length > MAX_NAME_LEN) throw new IgnoreListError(`이름은 ${MAX_NAME_LEN}자 이하여야 합니다`)
    if (!NAME_RE.test(name)) throw new IgnoreListError(`경로가 아니라 폴더·파일 이름 하나를 넣으세요: ${name}`)
    if (name === '.' || name === '..') throw new IgnoreListError(`쓸 수 없는 이름입니다: ${name}`)
    out.push(name)
  }
  // 차단 경로는 목록에서 빠져도 실제로는 계속 막히므로, 저장할 때 도로 넣어 목록과 실제를 일치시킨다
  return dedupe([...out, ...LOCKED_IGNORE])
}

export function writeIgnoreList(names: string[]): void {
  writeFileAtomic(IGNORE_FILE, `${JSON.stringify({ names }, null, 2)}\n`, 0o644)
  cache = dedupe(names)
}

function dedupe(names: string[]): string[] {
  return [...new Set(names)]
}
