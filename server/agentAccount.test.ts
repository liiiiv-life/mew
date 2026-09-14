import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { accessIssueFromError, SUBSCRIPTION_URLS } from '../shared/agent-access.ts'
import type { SpawnSpec } from './agentRuntimes.ts'

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-account-test-data-'))
process.env.MEW_DATA_DIR = dataDir
const { parseRuntimeAccount, readRuntimeAccount, runtimeAccountSpec } = await import('./agentAccount.ts')
const { RUNTIMES } = await import('./agentRuntimes.ts')
test.after(() => fs.rm(dataDir, { recursive: true, force: true }))

test('billing failures override misleading auth wrappers, but ordinary forbidden/rate limits do not', () => {
  assert.equal(accessIssueFromError({ code: -32000, message: "Authentication required: 403 You've reached your monthly usage limit for this billing cycle. Your quota will be refreshed in the next cycle." }), 'quota_exhausted')
  assert.equal(accessIssueFromError(new Error('insufficient_quota')), 'quota_exhausted')
  assert.equal(accessIssueFromError({ message: 'Request failed', data: { error: 'subscription required' } }), 'subscription_required')
  assert.equal(accessIssueFromError('Your credit balance is too low'), 'credits_exhausted')
  for (const message of ['Authentication required', '403 Forbidden', '429 Too many requests', 'rate limit reached', 'You need permission to read this file']) assert.equal(accessIssueFromError({ code: -32000, message }), null)
  assert.equal(Object.hasOwn(SUBSCRIPTION_URLS, 'antigravity'), false)
  assert.equal(runtimeAccountSpec('antigravity'), null)
})

test('account projection preserves unknown/free/API distinctions and excludes credentials', () => {
  const kimi = parseRuntimeAccount('kimi', { kind: 'ok', userInfo: { userId: 'id', email: 'a@example.test', userLevelName: 'VIP10', token: 'secret' } }, { kind: 'error', message: 'insufficient balance' })
  assert.equal(kimi.authentication, 'connected')
  assert.equal(kimi.account, 'a@example.test')
  assert.equal(kimi.subscription, 'unknown')
  assert.equal(kimi.issue, 'credits_exhausted')
  assert.equal(JSON.stringify(kimi).includes('secret'), false)
  const free = parseRuntimeAccount('codex', { account: { type: 'chatgpt', email: 'free@example.test', planType: 'free' } }, { rateLimits: { primary: { usedPercent: 20 } } })
  assert.equal(free.subscription, 'free')
  assert.equal(free.issue, null, 'a free plan with available usage remains usable')
  assert.equal(parseRuntimeAccount('codex', { account: { type: 'apiKey' } }).subscriptionUrl, null)
  assert.equal(parseRuntimeAccount('cursor', { isAuthenticated: true, userInfo: { email: 'cursor@example.test', accessToken: 'secret' } }).account, 'cursor@example.test')
  const used = { rateLimits: { primary: { usedPercent: 100 }, credits: { balance: '12' } } }
  assert.equal(parseRuntimeAccount('codex', { account: { type: 'chatgpt' } }, used).issue, null, 'remaining credits do not imply blocked access')
})

test('owned Kimi status server stays authenticated and loopback-only, filters output, coalesces and exits', { timeout: 15_000 }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-account-probe-'))
  const file = path.join(dir, 'kimi')
  const pidFile = path.join(dir, 'pid')
  await fs.writeFile(file, `#!${process.execPath}
import http from 'node:http'; import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));
if (!process.argv.includes('--no-open') || !process.argv.includes('127.0.0.1') || process.argv.includes('--dangerous-bypass-auth')) process.exit(9);
const server=http.createServer((req,res)=>{
 if(req.headers.authorization!=='Bearer private-fixture-token') { res.writeHead(401).end(); return }
 const data=req.url.endsWith('userinfo')?{kind:'ok',userInfo:{userId:'fixture',email:'kimi@example.test',userLevelName:'free',accessToken:'never-return'}}:req.url.endsWith('region')?{region:'global'}:{kind:'ok',summary:{limit:10,used:10},limits:[]};
 res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({data}));
});
server.listen(0,'127.0.0.1',()=>console.log('Kimi server: http://127.0.0.1:'+server.address().port+'/#token=private-fixture-token'));
`, { mode: 0o700 })
  t.mock.method(RUNTIMES.kimi as { spec: () => SpawnSpec }, 'spec', () => ({ cmd: file, args: [] }))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const first = readRuntimeAccount('kimi')
  assert.equal(readRuntimeAccount('kimi'), first)
  const result = await first
  assert.equal(result.account, 'kimi@example.test')
  assert.equal(result.subscription, 'free')
  assert.equal(result.issue, 'quota_exhausted')
  assert.match(result.subscriptionUrl!, /^https:\/\/www.kimi.ai\//)
  assert.doesNotMatch(JSON.stringify(result), /private-fixture-token|never-return/)
  const pid = Number(await fs.readFile(pidFile, 'utf8'))
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
})

test('Codex account RPC requests only read methods and closes its process', { timeout: 15_000 }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-codex-account-'))
  const file = path.join(dir, 'codex')
  await fs.writeFile(file, `#!${process.execPath}
import {createInterface} from 'node:readline';
for await(const line of createInterface({input:process.stdin})) {
 const r=JSON.parse(line);
 if(!['initialize','initialized','account/read','account/rateLimits/read'].includes(r.method)) process.exit(9);
 if(r.method==='initialized') continue;
 const result=r.method==='account/read'?{account:{type:'chatgpt',email:'codex@example.test',planType:'pro'}}:r.method==='account/rateLimits/read'?{rateLimits:{primary:{usedPercent:100}}}:{};
 console.log(JSON.stringify({id:r.id,result}));
}
`, { mode: 0o700 })
  t.mock.method(RUNTIMES.codex as { spec: () => SpawnSpec }, 'spec', () => ({ cmd: 'unused-adapter', args: [], env: { CODEX_PATH: file } }))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const result = await readRuntimeAccount('codex')
  assert.equal(result.account, 'codex@example.test')
  assert.equal(result.subscription, 'paid')
  assert.equal(result.issue, 'quota_exhausted')
})

test('missing CLI and unsupported status are unknown, never misreported as signed out or free', { timeout: 3000 }, async (t) => {
  t.mock.method(RUNTIMES.cursor as { spec: () => SpawnSpec }, 'spec', () => ({ cmd: '/nonexistent/mew-account-cli', args: [] }))
  const account = await readRuntimeAccount('cursor')
  assert.equal(account.authentication, 'unknown')
  assert.equal(account.subscription, 'unknown')
  await assert.rejects(readRuntimeAccount('not-a-runtime'))
})
