import assert from 'node:assert/strict'
import test from 'node:test'
import { installRuntime, runtimeStatuses, RuntimeInstallError } from './agentRuntimeInstall.ts'
import { RUNTIMES, RUNTIME_LOGIN_METHOD_ID, runtimeLoginSpec } from './agentRuntimes.ts'

test('런타임 상태는 서버 등록표 전체를 설치 여부와 함께 내려준다', () => {
  const statuses = runtimeStatuses()
  assert.deepEqual(statuses.map((item) => item.id), Object.keys(RUNTIMES))
  assert.ok(statuses.every((item) => typeof item.installed === 'boolean'))
  assert.ok(statuses.every((item) => item.installable))
})

test('등록표에 없는 id로는 설치 명령을 만들 수 없다', async () => {
  await assert.rejects(installRuntime('../anything'), RuntimeInstallError)
})

test('등록된 8개 런타임 모두 요청값과 무관한 GUI 로그인 명령을 가진다', () => {
  const keys = [
    'MEW_AGENT_ARGS', 'MEW_AGENT_CLAUDE_ARGS', 'MEW_AGENT_CODEX_ARGS', 'MEW_AGENT_HERMES_ARGS',
    'MEW_AGENT_KIMI_ARGS', 'MEW_AGENT_GEMINI_ARGS', 'MEW_AGENT_OPENCLAW_ARGS',
    'MEW_AGENT_OPENCODE_ARGS', 'MEW_AGENT_CURSOR_ARGS', 'NO_BROWSER', 'NO_OPEN_BROWSER',
  ]
  const saved = new Map(keys.map((key) => [key, process.env[key]]))
  for (const key of keys) delete process.env[key]
  try {
    assert.equal(RUNTIME_LOGIN_METHOD_ID, 'mew-runtime-login')
    assert.deepEqual(Object.keys(RUNTIMES), [
      'claude', 'codex', 'hermes', 'kimi', 'gemini', 'openclaw', 'opencode', 'cursor',
    ])
    assert.deepEqual(runtimeLoginSpec('claude').args.slice(-1), ['--cli'])
    assert.deepEqual(runtimeLoginSpec('codex').args, ['login', '--device-auth'])
    assert.deepEqual(runtimeLoginSpec('hermes').args, ['acp', '--setup'])
    assert.deepEqual(runtimeLoginSpec('kimi').args, ['login'])
    assert.deepEqual(runtimeLoginSpec('gemini').args, ['--skip-trust'])
    assert.deepEqual(runtimeLoginSpec('openclaw').args, ['onboard', '--tui'])
    assert.deepEqual(runtimeLoginSpec('opencode').args, ['auth', 'login'])
    assert.deepEqual(runtimeLoginSpec('cursor').args, ['login'])
    assert.deepEqual(RUNTIMES.gemini.spec().args, ['--acp'], 'Gemini의 정식 ACP 플래그를 쓴다')
    assert.equal(RUNTIMES.gemini.spec().env?.NO_BROWSER, 'true')
    assert.equal(RUNTIMES.cursor.spec().env?.NO_OPEN_BROWSER, '1')
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
