// 세션 JSONL 파싱 — 벤더(Claude Code) 파일 형식에 기대는 유일한 지점이라 계약을 여기 박아 둔다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-usage-'))
process.env.MEW_AGENT_CONFIG_DIR = configDir
const { UsageReader, sessionFilePath } = await import('./agentUsage.ts')

const cwd = '/tmp/mew-usage-project'
const sessionId = 'sess-1'

function line(entry: unknown): string {
  return JSON.stringify(entry) + '\n'
}

const assistant = (usage: Record<string, number>, extra: Record<string, unknown> = {}) =>
  line({ type: 'assistant', timestamp: '2026-08-05T00:00:01.000Z', message: { usage }, ...extra })

const userText = (text: string) =>
  line({ type: 'user', timestamp: '2026-08-05T00:00:00.000Z', message: { content: [{ type: 'text', text }] } })

const toolResult = () =>
  line({ type: 'user', timestamp: '2026-08-05T00:00:02.000Z', message: { content: [{ type: 'tool_result', content: 'ok' }] } })

test('기록이 없으면 null', async () => {
  const reader = new UsageReader(cwd, 'missing')
  assert.equal(await reader.read(), null)
})

test('토큰·턴 수를 모으고, 덧붙은 줄만 이어서 읽는다', async () => {
  const file = sessionFilePath(cwd, sessionId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    userText('첫 질문') +
      assistant({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 }) +
      toolResult(),
  )

  const reader = new UsageReader(cwd, sessionId)
  const first = await reader.read()
  assert.deepEqual(first, {
    input: 10,
    output: 5,
    cacheWrite: 100,
    cacheRead: 1000,
    context: 1110,
    turns: 1,
    startedAt: '2026-08-05T00:00:00.000Z',
    cost: null,
  })

  // 서브에이전트(sidechain) 사용량은 합계에 들어가지만 컨텍스트는 본선 기준으로 남는다
  fs.appendFileSync(
    file,
    userText('둘째 질문') +
      assistant({ input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 7 }, { isSidechain: true }) +
      assistant({ input_tokens: 20, output_tokens: 7, cache_read_input_tokens: 2000 }),
  )
  const second = await reader.read()
  assert.equal(second?.turns, 2, '도구 결과는 턴으로 세지 않는다')
  assert.equal(second?.input, 31)
  assert.equal(second?.output, 13)
  assert.equal(second?.cacheRead, 3007)
  assert.equal(second?.context, 2020, '컨텍스트는 마지막 본선 응답이 들고 간 양')
})

test('모델을 아는 줄만 돈으로 환산한다 — 캐시 쓰기는 TTL별 배수가 다르다', async () => {
  const file = sessionFilePath(cwd, 'cost')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    // opus 5 = 입력 $5 / 출력 $25 per MTok. 1M 입력 + 1M 출력 + 1M(5분 쓰기 ×1.25) + 1M(1시간 쓰기 ×2) + 1M(읽기 ×0.1)
    line({
      type: 'assistant',
      timestamp: '2026-08-05T00:00:01.000Z',
      message: {
        model: 'claude-opus-5-20260101',
        usage: {
          input_tokens: 1_000_000,
          output_tokens: 1_000_000,
          cache_creation_input_tokens: 2_000_000,
          cache_read_input_tokens: 1_000_000,
          cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 },
        },
      },
    }) +
      // 가격표에 없는 모델은 토큰만 세고 돈에는 넣지 않는다
      line({
        type: 'assistant',
        timestamp: '2026-08-05T00:00:02.000Z',
        message: { model: 'some-local-model', usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } },
      }),
  )

  const usage = await new UsageReader(cwd, 'cost').read()
  assert.equal(usage?.input, 2_000_000, '값을 모르는 모델도 토큰은 센다')
  // 5 + 25 + 6.25 + 10 + 0.5
  assert.equal(usage?.cost, 46.75)
})

test('아직 다 쓰이지 않은 마지막 줄은 다음 읽기에 이어 붙인다', async () => {
  const file = sessionFilePath(cwd, 'partial')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const whole = assistant({ input_tokens: 42, output_tokens: 1 })
  fs.writeFileSync(file, whole.slice(0, 20))

  const reader = new UsageReader(cwd, 'partial')
  assert.equal(await reader.read(), null, '반쪽 줄은 아직 세지 않는다')

  fs.appendFileSync(file, whole.slice(20))
  const usage = await reader.read()
  assert.equal(usage?.input, 42, '줄이 완성되면 정확히 한 번 세어진다')
})
