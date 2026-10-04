import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { RUNTIMES, claudeCliSpec, resolvedSpec, resolvedTerminalSpec, type SpawnSpec } from './agentRuntimes.ts'
import { accessIssueFromError, SUBSCRIPTION_URLS, type RuntimeAccount } from '../shared/agent-access.ts'
import { quotaWindows } from '../shared/agent-quota.ts'

type RecordValue = Record<string, any>
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? [...value].filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('').slice(0, 200) : null

function subscription(plan: string | null): RuntimeAccount['subscription'] {
  if (!plan) return 'unknown'
  if (/^(free|none|unsubscribed|免费(?:用户|版)?|未订阅)$/i.test(plan)) return 'free'
  if (/^(plus|pro|ultra|max|team|business|enterprise|edu|moderato|allegro|allegretto|vivace)$/i.test(plan)) return 'paid'
  return 'unknown'
}

function base(runtime: string): RuntimeAccount {
  return { runtime, account: null, plan: null, authentication: 'unknown', subscription: 'unknown', issue: null, subscriptionUrl: SUBSCRIPTION_URLS[runtime] ?? null, note: null, checkedAt: new Date().toISOString() }
}

/** Strictly project public status fields; never return the CLI's raw output. */
export function parseRuntimeAccount(runtime: string, input: unknown, usageInput?: unknown): RuntimeAccount {
  const result = base(runtime)
  result.quota = quotaWindows(runtime, usageInput)
  const data = record(input)
  if (runtime === 'kimi') {
    const info = record(data.userInfo)
    if (data.kind === 'ok' && text(info.userId)) {
      result.authentication = 'connected'
      result.account = text(info.email) ?? text(info.nickname) ?? text(info.username) ?? text(info.userId)
      result.plan = text(info.userLevelName)
    } else if (data.status === 401) result.authentication = 'signed_out'
    const usage = record(usageInput)
    result.issue = accessIssueFromError(usage) ?? accessIssueFromError(data)
    const rows = [record(usage.summary), ...(Array.isArray(usage.limits) ? usage.limits.map(record) : [])]
    const extra = record(usage.extra_usage)
    if (!result.issue && usage.kind === 'ok' && rows.some((row) => typeof row.limit === 'number' && row.limit >= 0 && typeof row.used === 'number' && row.used >= row.limit) && !(typeof extra.balance_cents === 'number' && extra.balance_cents > 0)) result.issue = 'quota_exhausted'
    if (data.kind === 'error' || usage.kind === 'error') result.note = '계정 또는 사용량 정보를 모두 확인하지 못했습니다. 구독 페이지에서 확인해 주세요.'
  } else if (runtime === 'codex') {
    const account = record(data.account)
    if (account.type === 'chatgpt') {
      result.authentication = 'connected'
      result.account = text(account.email)
      result.plan = text(account.planType)
    } else if (account.type === 'apiKey') {
      result.authentication = 'api_key'
      result.subscriptionUrl = null
      result.note = 'API 키로 연결되어 있습니다. ChatGPT 구독과 API 사용량은 별개입니다.'
    } else if (data.account === null && data.requiresOpenaiAuth === true) result.authentication = 'signed_out'
    const limits = record(record(usageInput).rateLimits)
    const credits = record(limits.credits)
    if ([limits.primary, limits.secondary].some((row) => typeof record(row).usedPercent === 'number' && record(row).usedPercent >= 100) && credits.unlimited !== true && !(Number(credits.balance) > 0)) result.issue = 'quota_exhausted'
  } else if (runtime === 'claude') {
    result.authentication = data.loggedIn === true ? data.authMethod === 'api_key' ? 'api_key' : 'connected' : data.loggedIn === false ? 'signed_out' : 'unknown'
    result.account = text(data.email)
    result.plan = text(data.subscriptionType)
    if (result.authentication === 'api_key') {
      result.subscriptionUrl = null
      result.note = 'API 키로 연결되어 있습니다. Claude 구독과 API 사용량은 별개입니다.'
    }
  } else if (runtime === 'cursor') {
    result.authentication = data.isAuthenticated === true ? 'connected' : data.isAuthenticated === false ? 'signed_out' : 'unknown'
    result.account = text(record(data.userInfo).email)
    result.plan = text(data.membershipType)
  }
  result.subscription = subscription(result.plan)
  if (result.authentication !== 'connected') result.quota = []
  if (result.subscription === 'unknown' && result.plan && !result.note) result.note = '공급자가 반환한 플랜 표시만으로 유료 구독 여부를 확정할 수 없습니다. 구독 페이지에서 확인해 주세요.'
  return result
}

/** Fixed status commands, with the same executable/environment as the runtime. No prompt is sent. */
export function runtimeAccountSpec(runtime: string): SpawnSpec | null {
  if (runtime === 'claude') return claudeCliSpec(['auth', 'status', '--json'])
  const spec = RUNTIMES[runtime]?.surface === 'terminal' ? resolvedTerminalSpec(runtime) : resolvedSpec(runtime)
  if (!spec) return null
  if (runtime === 'kimi') return { ...spec, args: ['web', '--host', '127.0.0.1', '--port', '0', '--no-open', '--log-level', 'error'] }
  if (runtime === 'codex') return { cmd: spec.env?.CODEX_PATH || 'codex', env: spec.env, args: ['app-server'] }
  if (runtime === 'cursor') return { ...spec, args: ['status', '--format', 'json'] }
  return null
}

const children = new Set<ChildProcessWithoutNullStreams>()
process.once('exit', () => { for (const child of children) child.kill('SIGTERM') })

async function probe(runtime: string, spec: SpawnSpec, claudeUsage = false): Promise<RuntimeAccount> {
  const child = spawn(spec.cmd, spec.args, { env: { ...process.env, ...spec.env }, stdio: 'pipe' })
  children.add(child)
  let exited = false
  const exit = new Promise<void>((resolve) => {
    const done = () => { exited = true; children.delete(child); resolve() }
    child.once('exit', done); child.once('error', done)
  })
  const controller = new AbortController()
  const lines = createInterface({ input: child.stdout })
  let size = 0
  child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 256 * 1024) controller.abort() })
  child.stderr.resume()
  const stop = () => { child.kill('SIGTERM'); lines.close() }
  controller.signal.addEventListener('abort', stop, { once: true })
  const timer = setTimeout(() => controller.abort(), 20_000)
  const rpc = (id: number | null, method: string, params?: unknown) => child.stdin.write(JSON.stringify({ ...(id === null ? {} : { id }), method, ...(params === undefined ? {} : { params }) }) + '\n')
  const control = (request_id: string, subtype: string) => child.stdin.write(JSON.stringify({ type: 'control_request', request_id, request: { subtype, ...(subtype === 'get_usage' ? { skip_behaviors: true } : {}) } }) + '\n')
  // A failed stdin must not emit an unhandled EPIPE if an older CLI exits early.
  child.stdin.on('error', () => controller.abort())
  try {
    if (runtime === 'codex') rpc(1, 'initialize', { clientInfo: { name: 'mew_account_status', version: '1.0.0' } })
    if (claudeUsage) control('initialize', 'initialize')
    let account: unknown
    let output = ''
    for await (const line of lines) {
      if (controller.signal.aborted) break
      if (claudeUsage) {
        let message: RecordValue
        try { message = record(JSON.parse(line)) } catch { continue }
        if (message.type !== 'control_response') continue
        const response = record(message.response)
        if (response.subtype === 'error') throw new Error('usage control unavailable')
        if (response.request_id === 'initialize') control('usage', 'get_usage')
        if (response.request_id === 'usage') return { ...base(runtime), quota: quotaWindows(runtime, response.response) }
        continue
      }
      if (runtime === 'kimi') {
        const match = line.match(/Kimi server: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/)
        if (!match) continue
        const url = new URL(match[1])
        const token = new URLSearchParams(url.hash.slice(1)).get('token')
        if (!token || !url.port || url.username || url.password) throw new Error('invalid local endpoint')
        const get = async (route: string) => {
          const response = await fetch(`${url.origin}/api/v1/oauth/${route}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, redirect: 'error' })
          if (!response.ok) throw new Error('account query failed')
          return record(await response.json()).data
        }
        const unavailable = { kind: 'error', message: 'Status unavailable' }
        const [info, usage, region] = await Promise.all([get('userinfo').catch(() => unavailable), get('usage').catch(() => unavailable), get('region').catch(() => ({}))])
        const result = parseRuntimeAccount(runtime, info, usage)
        if (record(region).region === 'global') result.subscriptionUrl = 'https://www.kimi.ai/membership/subscription?tab=quota'
        return result
      }
      if (runtime === 'codex') {
        let response: RecordValue
        try { response = record(JSON.parse(line)) } catch { continue }
        if (response.id === 1) {
          if (response.error) throw new Error('initialize failed')
          rpc(null, 'initialized'); rpc(2, 'account/read', { refreshToken: false })
        } else if (response.id === 2) {
          if (response.error) throw new Error('account unavailable')
          account = response.result
          if (record(record(account).account).type !== 'chatgpt') return parseRuntimeAccount(runtime, account)
          rpc(3, 'account/rateLimits/read')
        } else if (response.id === 3) {
          const result = parseRuntimeAccount(runtime, account, response.result)
          if (response.error) result.note = '플랜은 확인했지만 최신 사용량은 확인하지 못했습니다.'
          return result
        }
      } else output += line + '\n'
    }
    if (runtime !== 'kimi' && runtime !== 'codex' && !controller.signal.aborted && !claudeUsage) {
      const result = parseRuntimeAccount(runtime, JSON.parse(output))
      if (runtime === 'claude' && result.authentication === 'connected') {
        const usage = await probe(runtime, claudeCliSpec(['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--setting-sources', '', '--settings', '{"disableAllHooks":true}', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', '']), true).catch(() => null)
        result.quota = usage?.quota ?? []
      }
      return result
    }
    throw new Error('account status unavailable')
  } finally {
    clearTimeout(timer)
    controller.abort()
    lines.close()
    if (!exited) {
      child.kill('SIGTERM')
      const kill = setTimeout(() => child.kill('SIGKILL'), 1500)
      await exit
      clearTimeout(kill)
    }
  }
}

// Only coalesce in-flight reads. No persistent account data or stale quota cache.
const pending = new Map<string, Promise<RuntimeAccount>>()
export function readRuntimeAccount(runtime: string): Promise<RuntimeAccount> {
  if (!Object.hasOwn(RUNTIMES, runtime)) return Promise.reject(new Error('지원하지 않는 런타임입니다'))
  const existing = pending.get(runtime)
  if (existing) return existing
  const spec = runtimeAccountSpec(runtime)
  if (!spec) return Promise.resolve({ ...base(runtime), note: '이 런타임은 계정·구독 자동 조회를 제공하지 않습니다.' })
  const result = probe(runtime, spec).catch(() => ({ ...base(runtime), note: '계정 상태를 확인하지 못했습니다. CLI 설치·로그인 상태를 확인하거나 구독 페이지를 열어 주세요.' })).finally(() => pending.delete(runtime))
  pending.set(runtime, result)
  return result
}
