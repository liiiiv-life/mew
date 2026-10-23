import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-claude-acp-auth-'))
process.env.MEW_DATA_DIR = path.join(root, 'data')
process.env.MEW_WORKSPACE = root
const adapter = path.join(root, 'adapter.mjs')
const cli = path.join(root, 'claude.mjs')
const authDir = path.join(root, 'claude-config')
fs.mkdirSync(authDir)
const sdkUrl = import.meta.resolve('@agentclientprotocol/sdk')
fs.writeFileSync(adapter, `
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError } from ${JSON.stringify(sdkUrl)};
import { Readable, Writable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
const credential = path.join(process.env.CLAUDE_CONFIG_DIR, 'credential');
if (process.env.CLAUDECODE) process.exit(12);
new AgentSideConnection(() => ({
 initialize: async () => ({protocolVersion:PROTOCOL_VERSION,agentCapabilities:{},authMethods:[
   {id:'claude-ai-login',name:'Claude Subscription'}, {id:'console-login',name:'Anthropic Console'},
   {id:'claude-login',name:'Remote login'}
 ]}),
 newSession: async () => {if(!fs.existsSync(credential))throw RequestError.authRequired();return {sessionId:'claude-auth-ready'}},
 authenticate: async () => {throw Error('OAuth must remain with the CLI')},
 prompt: async () => ({stopReason:'end_turn'}), cancel: async () => {}
}), ndJsonStream(Writable.toWeb(process.stdout),Readable.toWeb(process.stdin)));
`)
fs.writeFileSync(cli, `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
const file = path.join(process.env.CLAUDE_CONFIG_DIR, 'credential');
if(process.env.CLAUDECODE) process.exit(12);
const args=process.argv.slice(2);
if(args[0]!=='auth')process.exit(13);
if(args[1]==='login'){
 console.log('https://claude.ai/oauth/authorize?state=fixture');
 if(fs.existsSync(path.join(process.env.CLAUDE_CONFIG_DIR,'fail')))process.exit(23);
 if(!['--claudeai','--console'].includes(args[2]))process.exit(14);
 fs.writeFileSync(file,args[2]);
}else if(args[1]==='status'){
 console.log(JSON.stringify({loggedIn:fs.existsSync(file),email:'fixture@example.test',subscriptionType:'pro',accessToken:'not-public'}));
}else if(args[1]==='logout')fs.rmSync(file,{force:true});
else process.exit(15);
`)
fs.chmodSync(cli, 0o700)
process.env.MEW_AGENT_CMD = process.execPath
process.env.MEW_AGENT_ARGS = adapter
process.env.CLAUDECODE = 'nested-marker'

const { writeAgentSetting, deleteAgentSetting } = await import('./agentSettings.ts')
const { RUNTIMES, resolvedSpec, claudeCliSpec, RUNTIME_LOGIN_METHOD_ID, CLAUDE_CONSOLE_LOGIN_METHOD_ID } = await import('./agentRuntimes.ts')
const { AgentSession } = await import('./agentAcp.ts')
const { readRuntimeAccount, runtimeAccountSpec } = await import('./agentAccount.ts')
const { sessionDirPath } = await import('./agentUsage.ts')
const { prepareAgentAuthTerminal, readAgentAuthTerminalStatus, browserLoginDetailsFromOutput } = await import('./agentAuthTerminal.ts')
type AgentEvent = import('./agentAcp.ts').AgentEvent
test.after(() => fs.rmSync(root, { recursive: true, force: true }))

test('Claude CLI 설정을 ACP 엔진·로그인·계정 조회·로그아웃에 일관되게 적용하고 실패 뒤 복구한다', async (t) => {
  writeAgentSetting('claude', { cmd: cli, extraArgs: ['--old-tui-only'], env: { CLAUDE_CONFIG_DIR: authDir } })
  const spec = resolvedSpec('claude')!
  assert.equal(spec.cmd, process.execPath, '저장된 CLI 경로가 ACP 어댑터를 덮어쓰지 않는다')
  assert.deepEqual(spec.args, [adapter], '옛 TUI 인자는 ACP로 전달하지 않는다')
  assert.equal(spec.env?.CLAUDE_CODE_EXECUTABLE, cli)
  assert.equal(spec.env?.CLAUDECODE, undefined)
  assert.equal(sessionDirPath(root), path.join(authDir, 'projects', root.replace(/[^a-zA-Z0-9]/g, '-')), '히스토리와 사용량도 같은 인증 환경을 읽는다')

  const session = await AgentSession.start('claude', spec, root)
  t.after(() => session.dispose())
  const events: AgentEvent[] = []
  session.attach((event) => events.push(event))
  const auth = events.find((event) => event.type === 'auth')
  assert.ok(auth?.type === 'auth')
  assert.deepEqual(auth.methods.map(({ id, surface, browserInput }) => ({ id, surface, browserInput })), [
    { id: RUNTIME_LOGIN_METHOD_ID, surface: 'browser', browserInput: 'authorization-code' },
    { id: CLAUDE_CONSOLE_LOGIN_METHOD_ID, surface: 'browser', browserInput: 'authorization-code' },
  ])
  assert.equal(JSON.stringify(auth).includes(authDir), false, '공개 인증 상태에 서버 경로를 노출하지 않는다')
  const login = session.terminalAuthSpec(RUNTIME_LOGIN_METHOD_ID)
  assert.equal(login.cmd, cli)
  assert.deepEqual(login.args, ['auth', 'login', '--claudeai'])
  assert.equal(login.env?.CLAUDE_CONFIG_DIR, authDir)

  fs.writeFileSync(path.join(authDir, 'fail'), '')
  const failed = prepareAgentAuthTerminal('claude', 'test-tab', RUNTIME_LOGIN_METHOD_ID, login)
  execFileSync('bash', ['-c', failed])
  assert.deepEqual(readAgentAuthTerminalStatus('claude', 'test-tab', RUNTIME_LOGIN_METHOD_ID, true), { state: 'failed', exitCode: 23 })
  await assert.rejects(session.retryAuthentication())
  assert.equal(events.some((event) => event.type === 'auth_complete'), false)

  fs.rmSync(path.join(authDir, 'fail'))
  const success = prepareAgentAuthTerminal('claude', 'test-tab', RUNTIME_LOGIN_METHOD_ID, login)
  const output = execFileSync('bash', ['-c', success], { encoding: 'utf8' })
  assert.equal(browserLoginDetailsFromOutput(output, ['claude.ai']).verificationUrl, 'https://claude.ai/oauth/authorize?state=fixture')
  assert.deepEqual(readAgentAuthTerminalStatus('claude', 'test-tab', RUNTIME_LOGIN_METHOD_ID, true), { state: 'succeeded', exitCode: 0 })
  await session.retryAuthentication()
  assert.ok(events.some((event) => event.type === 'auth_complete'))
  assert.ok(events.some((event) => event.type === 'meta' && event.meta.sessionId === 'claude-auth-ready'))

  assert.equal(runtimeAccountSpec('claude')?.cmd, cli)
  const account = await readRuntimeAccount('claude')
  assert.equal(account.authentication, 'connected')
  assert.equal(account.account, 'fixture@example.test')
  assert.equal(JSON.stringify(account).includes('not-public'), false)
  const logout = RUNTIMES.claude.logout!()
  assert.equal(logout.cmd, cli)
  execFileSync(logout.cmd, logout.args, { env: { ...process.env, ...logout.env } })
  assert.equal((await readRuntimeAccount('claude')).authentication, 'signed_out')

  const consoleLogin = session.terminalAuthSpec(CLAUDE_CONSOLE_LOGIN_METHOD_ID)
  execFileSync(consoleLogin.cmd, consoleLogin.args, { env: { ...process.env, ...consoleLogin.env } })
  assert.equal(fs.readFileSync(path.join(authDir, 'credential'), 'utf8'), '--console')
})

test('호스트 CLI가 없으면 상태 명령도 고정 어댑터의 --cli 위임을 쓴다', () => {
  deleteAgentSetting('claude')
  const keys = ['PATH', 'MEW_AGENT_CLAUDE_CLI_CMD', 'CLAUDE_CODE_EXECUTABLE', 'MEW_AGENT_CMD', 'MEW_AGENT_CLAUDE_CMD', 'MEW_AGENT_ARGS']
  const saved = keys.map((key) => process.env[key])
  keys.forEach((key) => delete process.env[key])
  try {
    const status = claudeCliSpec(['auth', 'status', '--json'])
    assert.equal(path.basename(status.cmd), 'claude-agent-acp')
    assert.deepEqual(status.args, ['--cli', 'auth', 'status', '--json'])
  } finally {
    keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i] })
  }
})
