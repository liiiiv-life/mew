import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-antigravity-test-'))
process.env.MEW_DATA_DIR = path.join(root, 'data')
process.env.MEW_WORKSPACE = root
const { antigravityAuthUrl, antigravityDistribution, antigravityCommand } = await import('./antigravityAcp.ts')
const { resolvedSpec, agentSetRuntimeList } = await import('./agentRuntimes.ts')
const { writeAgentSetting } = await import('./agentSettings.ts')
const { AgentSession } = await import('./agentAcp.ts')
const { installAntigravityAcp } = await import('./installAntigravityAcp.ts')
type AgentEvent = import('./agentAcp.ts').AgentEvent
test.after(() => fs.rmSync(root, { recursive: true, force: true }))

test('official distribution selects supported architectures and ignores saved agy TUI commands', () => {
  for (const [platform, arch, target] of [['linux', 'x64', 'linux-x86_64'], ['linux', 'arm64', 'linux-arm64'], ['darwin', 'arm64', 'darwin-arm64']] as const) {
    const { url, args } = antigravityDistribution(platform, arch)
    assert.equal(new URL(url).hostname, 'dl.google.com')
    assert.ok(url.endsWith(`1.1.1-${target}.zip`))
    assert.deepEqual(args, platform === 'linux' ? ['--uid='] : [])
  }
  assert.throws(() => antigravityDistribution('darwin', 'x64'), /공식 배포본/)
  process.env.MEW_AGENT_ANTIGRAVITY_CMD = '/old/agy'
  process.env.MEW_AGENT_ANTIGRAVITY_ARGS = '--theme dark'
  writeAgentSetting('antigravity', { cmd: '/old/custom-agy', extraArgs: ['--old-tui'], env: { GEMINI_HOME: path.join(root, 'gemini') } })
  assert.equal(resolvedSpec('antigravity')?.cmd, antigravityCommand())
  assert.equal(resolvedSpec('antigravity')?.args.includes('--old-tui'), false)
  assert.equal(resolvedSpec('antigravity')?.env?.GEMINI_HOME, path.join(root, 'gemini'))
  assert.ok(agentSetRuntimeList().some(({ id }) => id === 'antigravity'))
  delete process.env.MEW_AGENT_ANTIGRAVITY_CMD
  delete process.env.MEW_AGENT_ANTIGRAVITY_ARGS
})

test('OAuth stderr URL rejects spoofed hosts, credentials, ports and unrelated Google pages', () => {
  assert.equal(antigravityAuthUrl('Open: https://accounts.google.com/o/oauth2/auth?state=fixture'), 'https://accounts.google.com/o/oauth2/auth?state=fixture')
  for (const url of ['https://accounts.google.com.evil.test/o/oauth2/auth', 'http://accounts.google.com/o/oauth2/auth', 'https://user@accounts.google.com/o/oauth2/auth', 'https://accounts.google.com:8443/o/oauth2/auth', 'https://accounts.google.com/unrelated', 'http://127.0.0.1:1234']) {
    assert.equal(antigravityAuthUrl(url), null, url)
  }
})

test('installer stages the official archive, cleans failures and preserves an existing installation', async (t) => {
  // A stored ZIP with two inert files named like the distribution (never executable test code).
  const zip = Buffer.from('UEsDBBQAAAAAAJMKL11lSM2QGAAAABgAAAASAAAAYWd5X2FjcF9zZXJ2ZXIucGFyZml4dHVyZSwgZG8gbm90IGV4ZWN1dGUKUEsDBBQAAAAAAJMKL11lSM2QGAAAABgAAAAVAAAAbG9jYWxoYXJuZXNzX2V4dGVybmFsZml4dHVyZSwgZG8gbm90IGV4ZWN1dGUKUEsBAhQDFAAAAAAAkwovXWVIzZAYAAAAGAAAABIAAAAAAAAAAAAAAIABAAAAAGFneV9hY3Bfc2VydmVyLnBhclBLAQIUAxQAAAAAAJMKL11lSM2QGAAAABgAAAAVAAAAAAAAAAAAAACAAUgAAABsb2NhbGhhcm5lc3NfZXh0ZXJuYWxQSwUGAAAAAAIAAgCDAAAAkwAAAAAA', 'base64')
  let broken = true
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, antigravityDistribution().url)
    assert.equal(options.redirect, 'error')
    return new Response(broken ? 'invalid zip' : zip)
  })
  const destination = path.dirname(antigravityCommand())
  const parent = path.dirname(destination)
  await assert.rejects(installAntigravityAcp())
  assert.equal(fs.existsSync(destination), false)
  assert.deepEqual(fs.readdirSync(parent), [])
  broken = false
  await installAntigravityAcp()
  assert.match(fs.readFileSync(antigravityCommand(), 'utf8'), /fixture/)
  assert.equal(fs.statSync(path.join(destination, 'localharness_external')).mode & 0o777, 0o700)
  fs.writeFileSync(antigravityCommand(), 'existing installation')
  await assert.rejects(installAntigravityAcp())
  assert.equal(fs.readFileSync(antigravityCommand(), 'utf8'), 'existing installation')
  assert.deepEqual(fs.readdirSync(parent), [path.basename(destination)])
})

const fixture = path.join(root, 'agent.mjs')
fs.writeFileSync(fixture, `
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError } from ${JSON.stringify(import.meta.resolve('@agentclientprotocol/sdk'))};
import { Readable, Writable } from 'node:stream';
import fs from 'node:fs';
let signedIn=false;
new AgentSideConnection(() => ({
 initialize: async () => ({protocolVersion:PROTOCOL_VERSION,agentCapabilities:{loadSession:true},authMethods:[
  {id:'oauth-personal',name:'Log in with Google'}, {id:'oauth-business',name:'Gemini Enterprise'},
  {id:'gemini-api-key',name:'Gemini API key'}, {id:'agent-platform',name:'Agent Platform'}
 ]}),
 newSession: async () => {if(!signedIn)throw RequestError.authRequired();return {sessionId:'antigravity-ready',models:{currentModelId:'fixture',availableModels:[{modelId:'fixture',name:'Fixture'}]}}},
 authenticate: async (params) => {
  if(params.methodId==='gemini-api-key') {
   if(params._meta)throw Error('API key must come from process environment');
   signedIn=true;return {};
  }
  const action=fs.readFileSync(process.env.FIXTURE_ACTION,'utf8');
  process.stderr.write('ignore https://accounts.google.com.evil.test/o/oauth2/auth?state=bad\\n');
  process.stderr.write('Open the following link to authenticate the ACP server: https://accounts.goo');
  await new Promise(r=>setTimeout(r,20));
  process.stderr.write('gle.com/o/oauth2/auth?state=ephemeral-fixture\\n');
  if(action==='wait')await new Promise(()=>{});
  await new Promise(r=>setTimeout(r,100));
  if(action==='fail')throw Error('Account ineligible');
  signedIn=true;return {};
 },
 prompt: async () => ({stopReason:'end_turn'}), cancel: async () => {}
}),ndJsonStream(Writable.toWeb(process.stdout),Readable.toWeb(process.stdin)));
`)

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 8_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for auth event')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('Google OAuth handles chunked URL, reconnect, cancellation, failure and successful retry without persisting URL', async (t) => {
  const action = path.join(root, 'action')
  fs.writeFileSync(action, 'wait')
  const session = await AgentSession.start('antigravity', { cmd: process.execPath, args: [fixture], env: { FIXTURE_ACTION: action } }, root)
  t.after(() => session.dispose())
  const events: AgentEvent[] = []
  session.attach((event) => events.push(event))
  const auth = events.find((event) => event.type === 'auth')
  assert.ok(auth?.type === 'auth')
  assert.deepEqual(auth.methods.map(({ id }) => id), ['oauth-personal', 'oauth-business', 'gemini-api-key', 'agent-platform'])
  assert.equal(auth.methods.find(({ id }) => id === 'gemini-api-key')?.kind, 'agent', 'no unsupported API-key _meta input')
  const cancelled = assert.rejects(session.authenticate('oauth-personal'), /취소/)
  await until(() => events.some((event) => event.type === 'auth_url'))
  const url = events.find((event) => event.type === 'auth_url')!
  assert.ok(url.type === 'auth_url')
  assert.equal(new URL(url.url).hostname, 'accounts.google.com')
  const replay: AgentEvent[] = []
  const detach = session.attach((event) => replay.push(event))
  assert.ok(replay.some((event) => event.type === 'auth_url' && event.id === url.id))
  detach()
  session.answerElicitation(url.id, 'cancel')
  await cancelled
  assert.equal(session.disposed, false)
  assert.ok(events.some((event) => event.type === 'auth_url_done' && event.id === url.id))
  fs.writeFileSync(action, 'fail')
  await assert.rejects(session.authenticate('oauth-personal'), (error: unknown) => JSON.stringify(error).includes('Account ineligible'))
  fs.writeFileSync(action, 'success')
  await session.authenticate('oauth-personal')
  assert.equal(session.sessionId, 'antigravity-ready')
  assert.ok(events.some((event) => event.type === 'auth_complete'))
  assert.equal(JSON.stringify(session.snapshot()).includes('ephemeral-fixture'), false)
  const attached: AgentEvent[] = []
  session.attach((event) => attached.push(event))
  assert.equal(attached.some((event) => event.type === 'auth_url'), false)
})

test('Gemini API key authentication uses the configured environment and plain method request', async (t) => {
  const session = await AgentSession.start('antigravity', { cmd: process.execPath, args: [fixture], env: { GEMINI_API_KEY: 'fixture-key' } }, root)
  t.after(() => session.dispose())
  await session.authenticate('gemini-api-key')
  assert.equal(session.sessionId, 'antigravity-ready')
})
