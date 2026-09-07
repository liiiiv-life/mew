import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agent-auth-terminal-'))
process.env.MEW_DATA_DIR = dataDir
const {
  authFailureMessageFromOutput,
  browserLoginDetailsFromOutput,
  browserLoginUrlFromOutput,
  prepareAgentAuthTerminal,
  readAgentAuthTerminalStatus,
} = await import('./agentAuthTerminal.ts')
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

test('terminal auth 명령의 성공·실패 exit code를 원자적으로 기록한다', () => {
  const success = prepareAgentAuthTerminal('kimi', 'tab', 'login', {
    cmd: process.execPath,
    args: ['-e', 'process.exit(0)'],
    label: 'Kimi login',
  })
  execFileSync('bash', ['-lc', success])
  assert.deepEqual(readAgentAuthTerminalStatus('kimi', 'tab', 'login', true), {
    state: 'succeeded', exitCode: 0,
  })

  const failure = prepareAgentAuthTerminal('kimi', 'tab', 'login', {
    cmd: process.execPath,
    args: ['-e', 'process.exit(23)'],
    label: 'Kimi login',
  })
  execFileSync('bash', ['-lc', failure])
  assert.deepEqual(readAgentAuthTerminalStatus('kimi', 'tab', 'login', true), {
    state: 'failed', exitCode: 23,
  })
})

test('결과 없이 tmux가 사라지면 중단으로 구분한다', () => {
  prepareAgentAuthTerminal('kimi', 'interrupted-tab', 'login', {
    cmd: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 1000)'],
    label: 'Kimi login',
  })
  assert.deepEqual(readAgentAuthTerminalStatus('kimi', 'interrupted-tab', 'login', false), {
    state: 'interrupted', exitCode: null,
  })
})

test('허용한 Kimi OAuth URL만 브라우저 로그인으로 추출한다', () => {
  const output = 'Visit https://auth.kimi.com/device?code=abc&state=xyz to continue'
  assert.equal(browserLoginUrlFromOutput(output, ['auth.kimi.com']), 'https://auth.kimi.com/device?code=abc&state=xyz')
  assert.equal(browserLoginUrlFromOutput('https://example.com/login', ['auth.kimi.com']), null)
})

test('tmux가 줄바꿈한 Kimi OAuth URL을 복원한다', () => {
  const output = 'Opening browser: https://\nwww.kimi.com/code/authorize_device?user_code=DV\n5A-BCRC\nWaiting…'
  assert.equal(
    browserLoginUrlFromOutput(output, ['www.kimi.com']),
    'https://www.kimi.com/code/authorize_device?user_code=DV5A-BCRC',
  )
})

test('global Kimi 로그인의 kimi.ai URL도 줄바꿈 뒤 복원한다', () => {
  const output = 'Opening browser: https://www.kimi.ai/code/authorize_device?user_code=AB\nCD-EF12\nWaiting…'
  assert.equal(
    browserLoginUrlFromOutput(output, ['www.kimi.ai']),
    'https://www.kimi.ai/code/authorize_device?user_code=ABCD-EF12',
  )
})

test('Codex device URL과 일회용 코드를 같이 추출한다', () => {
  assert.deepEqual(
    browserLoginDetailsFromOutput(
      'Open https://auth.openai.com/codex/device\nEnter this one-time code:\nABCD-EFGH',
      ['auth.openai.com'],
    ),
    { verificationUrl: 'https://auth.openai.com/codex/device', verificationCode: 'ABCD-EFGH' },
  )
})

test('Cursor challenge URL은 등록한 host에서만 전달한다', () => {
  const output = "Open a browser and navigate to this link: https://cursor.com/loginDeepControl?challenge=abc&uuid=123"
  assert.deepEqual(browserLoginDetailsFromOutput(output, ['cursor.com']), {
    verificationUrl: 'https://cursor.com/loginDeepControl?challenge=abc&uuid=123',
    verificationCode: null,
  })
  assert.equal(browserLoginDetailsFromOutput(output, ['auth.openai.com']).verificationUrl, null)
})

test('브라우저 로그인 실패 이유는 URL·일회용 코드를 지우고 한 줄만 보여 준다', () => {
  const output = 'Use https://auth.example.test/?token=secret\nLogin failed for code ABCD-EFGH: The server had an error'
  assert.equal(authFailureMessageFromOutput(output), 'Login failed for code [일회용 코드]: The server had an error')
  assert.equal(authFailureMessageFromOutput('\u001b[31mLogin failed: denied\u001b[0m'), 'Login failed: denied')
})

test('브라우저 로그인 실패 이유의 구분자 뒤 토큰과 bearer 값을 지운다', () => {
  assert.equal(
    authFailureMessageFromOutput('Error: token=very-secret-token Bearer abc.def.ghi'),
    'Error: token=[비밀값] Bearer [비밀값]',
  )
  assert.equal(
    authFailureMessageFromOutput('Authentication failed: api_key: sk-user-secret-value'),
    'Authentication failed: api_key: [비밀값]',
  )
})
