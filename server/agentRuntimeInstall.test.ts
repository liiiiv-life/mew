import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { installRuntime, runtimeStatuses, RuntimeInstallError } from './agentRuntimeInstall.ts'
import { KIMI_GLOBAL_LOGIN_METHOD_ID, RUNTIMES, RUNTIME_LOGIN_METHOD_ID, resolvedTerminalSpec, runtimeLoginSpec } from './agentRuntimes.ts'

test('런타임 상태는 서버 등록표 전체를 설치 여부와 함께 내려준다', () => {
  const statuses = runtimeStatuses()
  assert.deepEqual(statuses.map((item) => item.id), Object.keys(RUNTIMES))
  assert.ok(statuses.every((item) => typeof item.installed === 'boolean'))
  assert.ok(statuses.every((item) => item.installable))
})

test('등록표에 없는 id로는 설치 명령을 만들 수 없다', async () => {
  await assert.rejects(installRuntime('../anything'), RuntimeInstallError)
})

test('등록된 런타임은 표면별로 공식 CLI 또는 고정 ACP 인증 명령을 가진다', () => {
  const keys = [
    'MEW_AGENT_ARGS', 'MEW_AGENT_CLAUDE_ARGS', 'MEW_AGENT_CODEX_ARGS', 'MEW_AGENT_HERMES_ARGS',
    'MEW_AGENT_KIMI_ARGS', 'MEW_AGENT_ANTIGRAVITY_ARGS', 'MEW_AGENT_OPENCLAW_ARGS',
    'MEW_AGENT_OPENCODE_ARGS', 'MEW_AGENT_CURSOR_ARGS', 'MEW_AGENT_PRIME_ARGS', 'NO_BROWSER', 'NO_OPEN_BROWSER',
  ]
  const saved = new Map(keys.map((key) => [key, process.env[key]]))
  for (const key of keys) delete process.env[key]
  try {
    assert.equal(RUNTIME_LOGIN_METHOD_ID, 'mew-runtime-login')
    assert.deepEqual(Object.keys(RUNTIMES), [
      'claude', 'codex', 'hermes', 'kimi', 'antigravity', 'openclaw', 'opencode', 'cursor', 'prime',
    ])
    assert.equal(RUNTIMES.claude.surface, 'terminal')
    assert.equal(resolvedTerminalSpec('claude')?.cmd.endsWith('/claude') || resolvedTerminalSpec('claude')?.cmd === 'claude', true)
    assert.equal(resolvedTerminalSpec('claude')?.env?.CLAUDECODE, undefined)
    assert.equal(RUNTIMES.antigravity.surface, 'terminal')
    assert.equal(path.basename(resolvedTerminalSpec('antigravity')?.cmd ?? ''), 'agy')
    assert.ok(RUNTIMES.antigravity.install?.().args[1]?.includes('antigravity.google/cli/install.sh'))
    assert.deepEqual(runtimeLoginSpec('codex').args, ['login', '--device-auth'])
    assert.equal(runtimeLoginSpec('codex').surface, 'browser')
    assert.deepEqual(runtimeLoginSpec('codex').verificationHosts, ['auth.openai.com'])
    assert.deepEqual(runtimeLoginSpec('hermes').args, ['acp', '--setup'])
    assert.deepEqual(runtimeLoginSpec('kimi').args, ['login'])
    assert.deepEqual(runtimeLoginSpec('kimi', KIMI_GLOBAL_LOGIN_METHOD_ID).args, ['login', '--region', 'global'])
    assert.equal(runtimeLoginSpec('kimi', KIMI_GLOBAL_LOGIN_METHOD_ID).surface, 'browser')
    assert.deepEqual(runtimeLoginSpec('openclaw').args, ['onboard', '--tui'])
    assert.deepEqual(runtimeLoginSpec('opencode').args, ['auth', 'login'])
    assert.deepEqual(runtimeLoginSpec('cursor').args, ['login'])
    assert.equal(runtimeLoginSpec('cursor').surface, 'browser')
    assert.equal(runtimeLoginSpec('hermes').surface, 'terminal')
    assert.equal(RUNTIMES.cursor.spec?.().env?.NO_OPEN_BROWSER, '1')
    // Prime Agent — 공식 인스톨러 + Mew 소유 RPC→ACP 어댑터
    const primeInstall = RUNTIMES.prime.install?.()
    assert.ok(primeInstall?.args[1]?.includes('prime-agent/install.sh'), '공식 인스톨러 URL을 쓴다')
    assert.equal(RUNTIMES.prime.spec?.().cmd, process.execPath)
    assert.ok(RUNTIMES.prime.spec?.().args[0]?.endsWith('/server/primeAdapter.ts'))
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('ACP 런타임 인증 방법 id는 각각 고유하고 browser 표면은 host allowlist를 가진다', () => {
  for (const runtime of Object.values(RUNTIMES)) {
    const methods = runtime.auth.methods()
    if (runtime.surface === 'terminal') {
      assert.deepEqual(methods, [])
      continue
    }
    assert.ok(methods.length > 0, `${runtime.id}: 인증 방법 없음`)
    assert.equal(new Set(methods.map((method) => method.id)).size, methods.length, `${runtime.id}: 인증 method id 중복`)
    for (const method of methods) {
      assert.ok(method.cmd)
      assert.ok(method.label)
      if (method.surface === 'browser') assert.ok(method.verificationHosts && method.verificationHosts.length > 0)
      else assert.equal(method.verificationHosts, undefined)
    }
  }
})
