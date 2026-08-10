// 세션 목록 — 어댑터를 거치지 않고 Claude Code의 세션 JSONL을 직접 읽는 지름길(agentSessionList.ts).
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const cwd = '/tmp/mew-session-list-cwd'
const config = await fsp.mkdtemp(path.join(os.tmpdir(), 'mew-sessions-'))
process.env.MEW_AGENT_CONFIG_DIR = config
// 설정 폴더를 env로 정한 뒤에 읽어야 한다 — configDir()은 호출 때마다 env를 본다
const { listSessionsFromDisk } = await import('./agentSessionList.ts')

const dir = path.join(config, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'))
await fsp.mkdir(dir, { recursive: true })

const line = (entry: unknown) => `${JSON.stringify(entry)}\n`
const userLine = (text: string, sessionCwd = cwd) =>
  line({ type: 'user', cwd: sessionCwd, timestamp: '2026-08-11T00:00:00Z', message: { content: [{ type: 'text', text }] } })

async function write(file: string, body: string, mtime: Date) {
  const full = path.join(dir, file)
  await fsp.writeFile(full, body)
  await fsp.utimes(full, mtime, mtime)
}

test('첫 사용자 발화가 제목이 되고, 최근 순으로 온다', async () => {
  await write('aaa.jsonl', userLine('오래된 질문'), new Date('2026-08-01T00:00:00Z'))
  await write('bbb.jsonl', userLine('새 질문') + userLine('둘째 질문'), new Date('2026-08-10T00:00:00Z'))
  const sessions = await listSessionsFromDisk(cwd)
  assert.deepEqual(
    sessions.map((s) => [s.sessionId, s.title]),
    [
      ['bbb', '새 질문'],
      ['aaa', '오래된 질문'],
    ],
  )
})

test('다른 폴더의 세션과 서브에이전트 기록은 빠진다', async () => {
  await write('ccc.jsonl', userLine('남의 워크스페이스', '/tmp/somewhere-else'), new Date('2026-08-11T00:00:00Z'))
  await write('agent-ddd.jsonl', userLine('서브에이전트'), new Date('2026-08-11T00:00:00Z'))
  const ids = (await listSessionsFromDisk(cwd)).map((s) => s.sessionId)
  assert.equal(ids.includes('ccc'), false, 'cwd가 다르면 뺀다')
  assert.equal(ids.includes('agent-ddd'), false, 'agent-*.jsonl은 사람이 고를 대화가 아니다')
})

test('파일이 바뀌면 캐시가 아니라 새 값을 읽는다', async () => {
  await write('eee.jsonl', userLine('처음 제목'), new Date('2026-08-05T00:00:00Z'))
  assert.equal((await listSessionsFromDisk(cwd)).find((s) => s.sessionId === 'eee')?.title, '처음 제목')
  // 같은 크기로 덮어써도 mtime이 달라지면 다시 읽는다
  await write('eee.jsonl', userLine('바뀐 제목'), new Date('2026-08-06T00:00:00Z'))
  assert.equal((await listSessionsFromDisk(cwd)).find((s) => s.sessionId === 'eee')?.title, '바뀐 제목')
})

test('세션 폴더가 없으면 빈 목록이다', async () => {
  assert.deepEqual(await listSessionsFromDisk('/tmp/mew-no-such-workspace'), [])
})

test.after(async () => {
  await fsp.rm(config, { recursive: true, force: true })
})
