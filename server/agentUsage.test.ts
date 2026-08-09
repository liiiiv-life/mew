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
