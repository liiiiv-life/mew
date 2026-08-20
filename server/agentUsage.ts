// 세션 사용량 — ACP에는 토큰 사용량 표면이 없어서 Claude Code가 남기는 세션 JSONL을 읽는다(ADR 0036).
// 읽기 전용·선택적이다: 파일이 없거나 형식이 바뀌면 사용량만 null이 되고 에이전트 창은 그대로 돈다.
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export type Usage = {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  /** 마지막 응답이 실제로 들고 간 컨텍스트 크기 */
  context: number
  /** 사용자 발화 수 — 도구 결과로 되돌아온 user 항목은 세지 않는다 */
  turns: number
  startedAt: string | null
  /**
   * 같은 토큰을 API로 샀다면 얼마인가(USD). 구독제로 도는 세션이면 실제 청구액이 아니라 환산값이다.
   * 값을 매길 수 없는 모델(가격표에 없는 이름)만 나왔으면 null.
   */
  cost: number | null
}

/**
 * 100만 토큰당 정가(USD). 입력·출력만 둔다 — 캐시는 입력가에서 파생한다:
 * 쓰기 5분 ×1.25 · 1시간 ×2, 읽기 ×0.1.
 * 도입가 할인(Sonnet 5 등)은 넣지 않는다. 기간이 끝나면 조용히 틀리는 값이 되기 때문에, 정가로 조금 비싸게 잡는다.
 */
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-fable-5': { input: 10, output: 50 },
  'claude-mythos-5': { input: 10, output: 50 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
}

/** JSONL의 모델 이름은 날짜가 붙기도 한다(claude-sonnet-4-5-20250929) — 앞부분으로 찾는다 */
function priceOf(model: string | undefined): { input: number; output: number } | null {
  if (!model) return null
  const key = Object.keys(PRICE_PER_MTOK).find((id) => model.startsWith(id))
  return key ? PRICE_PER_MTOK[key] : null
}

/** 자식에게 넘기는 CLAUDE_CONFIG_DIR과 같은 값이어야 한다(agentAcp의 spawn env 참고) */
function configDir(): string {
  return process.env.MEW_AGENT_CONFIG_DIR || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

/** claude-agent-acp의 encodeProjectPath와 같은 규칙이어야 한다 — 어긋나면 사용량만 비어 보인다 */
export function sessionDirPath(cwd: string): string {
  return path.join(configDir(), 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'))
}

export function sessionFilePath(cwd: string, sessionId: string): string {
  return path.join(sessionDirPath(cwd), `${sessionId}.jsonl`)
}

type Entry = {
  type?: string
  timestamp?: string
  isSidechain?: boolean
  isMeta?: boolean
  message?: {
    content?: unknown
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
      /** 캐시 쓰기는 TTL마다 값이 다르다(5분 ×1.25 · 1시간 ×2) — 있으면 이걸로 나눠 센다 */
      cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
    }
  }
}

function hasTextBlock(content: unknown): boolean {
  if (typeof content === 'string') return true
  if (!Array.isArray(content)) return false
  return content.some((block) => typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text')
}

/** 한 세션 파일을 이어서 읽는다 — 이미 읽은 바이트는 다시 파싱하지 않는다 */
export class UsageReader {
  readonly file: string
  #offset = 0
  #partial = ''
  #seen = false
  #usage: Usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, context: 0, turns: 0, startedAt: null, cost: null }

  constructor(cwd: string, sessionId: string) {
    this.file = sessionFilePath(cwd, sessionId)
  }

  /** 마지막으로 읽은 뒤 늘어난 줄만 더한다. 파일이 없으면 null */
  async read(): Promise<Usage | null> {
    try {
      const stat = await fsp.stat(this.file)
      // 파일이 줄었다면(회전·재작성) 처음부터 다시 읽는다
      if (stat.size < this.#offset) {
        this.#offset = 0
        this.#partial = ''
        this.#usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, context: 0, turns: 0, startedAt: null, cost: null }
      }
      if (stat.size > this.#offset) {
        const handle = await fsp.open(this.file, 'r')
        try {
          const buffer = Buffer.alloc(stat.size - this.#offset)
          await handle.read(buffer, 0, buffer.length, this.#offset)
          this.#consume(buffer.toString('utf8'))
        } finally {
          await handle.close()
        }
        this.#offset = stat.size
      }
    } catch {
      return null
    }
    return this.#seen ? { ...this.#usage } : null
  }

  #consume(chunk: string) {
    const lines = (this.#partial + chunk).split('\n')
    // 마지막 줄은 아직 다 안 쓰였을 수 있다 — 다음 읽기에 이어 붙인다
    this.#partial = lines.pop() ?? ''
    const usage = this.#usage
    for (const line of lines) {
      if (!line.trim()) continue
      let entry: Entry
      try {
        entry = JSON.parse(line) as Entry
      } catch {
        continue
      }
      this.#seen = true
      if (!usage.startedAt && typeof entry.timestamp === 'string') usage.startedAt = entry.timestamp
      if (entry.type === 'assistant') {
        const u = entry.message?.usage
        if (!u) continue
        const input = u.input_tokens ?? 0
        const output = u.output_tokens ?? 0
        const cacheWrite = u.cache_creation_input_tokens ?? 0
        const cacheRead = u.cache_read_input_tokens ?? 0
        usage.input += input
        usage.output += output
        usage.cacheWrite += cacheWrite
        usage.cacheRead += cacheRead
        // 값을 아는 모델만 더한다 — 서브에이전트(sidechain)도 돈은 나가므로 함께 센다
        const price = priceOf(entry.message?.model)
        if (price) {
          const write5m = u.cache_creation?.ephemeral_5m_input_tokens ?? cacheWrite
          const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
          const dollars =
            (input * price.input +
              output * price.output +
              write5m * price.input * 1.25 +
              write1h * price.input * 2 +
              cacheRead * price.input * 0.1) /
            1_000_000
          usage.cost = (usage.cost ?? 0) + dollars
        }
        // 컨텍스트는 본선 응답 기준 — 서브에이전트(sidechain)는 자기 컨텍스트라 섞지 않는다
        if (entry.isSidechain !== true) usage.context = input + cacheWrite + cacheRead
      } else if (entry.type === 'user' && entry.isSidechain !== true && entry.isMeta !== true) {
        if (hasTextBlock(entry.message?.content)) usage.turns += 1
      }
    }
  }
}
