// 지난 세션 목록 — Claude Code가 남긴 세션 JSONL을 우리가 직접 훑는다(어댑터를 거치지 않는다).
//
// 어댑터의 unstable_listSessions는 세션 파일을 **통째로** 읽는다(readFile → split). 이 워크스페이스는
// 파일 256개·266MB라 한 번에 1초가 넘고, 창은 탭마다 어댑터를 하나씩 두므로 그 값이 탭 수만큼 곱해졌다.
// 여기서는 제목·cwd가 들어 있는 앞부분만 읽고, (mtime,size)가 그대로면 다시 읽지 않는다
// — 두 번째 호출부터는 stat만 돈다(256개 기준 ~20ms).
//
// 값이 필요한 곳은 창의 "지난 세션 고르기" 화면뿐이다. 불러오기 자체는 여전히 어댑터가 한다.
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { SessionInfo } from '@agentclientprotocol/sdk'
import { sessionDirPath } from './agentUsage.ts'

/** 제목·cwd를 찾으려고 읽는 머리 크기. 첫 사용자 발화는 파일 맨 앞에 있다 */
const HEAD_BYTES = 64 * 1024

/** 어댑터의 PAGE_SIZE와 같다 — 창은 첫 페이지만 그린다 */
const MAX_SESSIONS = 50

type Parsed = { title: string | null; cwd: string | null }
type Cached = Parsed & { mtimeMs: number; size: number }

/** 파일 경로 → 마지막으로 읽어 둔 값. 파일이 그대로면(mtime·size) 다시 읽지 않는다 */
let cache = new Map<string, Cached>()

function titleOf(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const first = content[0] as { text?: unknown } | string | undefined
  if (typeof first === 'string') return first
  return typeof first?.text === 'string' ? first.text : null
}

/** 파일 머리에서 제목(첫 사용자 발화)과 cwd를 뽑는다 */
async function readHead(file: string, size: number): Promise<Parsed> {
  const handle = await fsp.open(file, 'r')
  let text: string
  try {
    const buffer = Buffer.alloc(Math.min(size, HEAD_BYTES))
    await handle.read(buffer, 0, buffer.length, 0)
    text = buffer.toString('utf8')
  } finally {
    await handle.close()
  }
  const lines = text.split('\n')
  // 머리만 읽었으면 마지막 줄은 잘려 있다 — 파일 전체를 읽은 경우에만 살린다
  if (size > HEAD_BYTES) lines.pop()
  const parsed: Parsed = { title: null, cwd: null }
  for (const line of lines) {
    if (!line.trim()) continue
    let entry: { type?: string; cwd?: unknown; isSidechain?: boolean; message?: { content?: unknown } }
    try {
      entry = JSON.parse(line) as typeof entry
    } catch {
      continue
    }
    // 서브에이전트 줄은 그 세션의 것이 아니다(제목이 엉뚱해진다)
    if (entry.isSidechain === true) continue
    if (typeof entry.cwd === 'string') parsed.cwd = entry.cwd
    if (!parsed.title && entry.type === 'user') {
      const title = titleOf(entry.message?.content)
      // 어댑터의 sanitizeTitle과 같은 규칙 — 목록에 보이던 이름이 달라지지 않게 한다
      if (title) {
        const flat = title.replace(/\s+/g, ' ').trim()
        parsed.title = flat.length > 128 ? `${flat.slice(0, 127)}…` : flat || null
      }
    }
    if (parsed.title && parsed.cwd) break
  }
  return parsed
}

/**
 * 이 워크스페이스에서 돌았던 세션 — 최근 순 50개.
 * 폴더가 없거나 읽을 수 없으면 빈 목록이다(목록은 있으면 좋은 것이지 창이 뜨는 조건이 아니다).
 */
export async function listSessionsFromDisk(cwd: string): Promise<SessionInfo[]> {
  const dir = sessionDirPath(cwd)
  let files: string[]
  try {
    files = await fsp.readdir(dir)
  } catch {
    return []
  }
  const next = new Map<string, Cached>()
  const sessions: SessionInfo[] = []
  for (const file of files) {
    // agent-*.jsonl은 서브에이전트 기록이라 사람이 고를 대화가 아니다
    if (!file.endsWith('.jsonl') || file.startsWith('agent-')) continue
    const full = path.join(dir, file)
    try {
      const stat = await fsp.stat(full)
      const hit = cache.get(full)
      const parsed = hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size ? hit : await readHead(full, stat.size)
      next.set(full, { ...parsed, mtimeMs: stat.mtimeMs, size: stat.size })
      // 폴더 이름은 cwd를 뭉갠 값이라("/a-b"와 "/a/b"가 같은 폴더) 기록된 cwd로 한 번 더 거른다
      if (parsed.cwd !== cwd) continue
      sessions.push({ sessionId: file.slice(0, -'.jsonl'.length), cwd, title: parsed.title, updatedAt: stat.mtime.toISOString() })
    } catch {
      /* 지워졌거나 읽을 수 없는 파일 — 목록에서 빠질 뿐이다 */
    }
  }
  // 지워진 파일은 캐시에서도 사라진다(이번에 본 것만 남긴다)
  cache = next
  sessions.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  return sessions.slice(0, MAX_SESSIONS)
}
