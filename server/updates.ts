import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { MEW_APP_ROOT } from './mewUpdate.ts'
import { findExecutable, RUNTIMES, resolvedSpec, claudeCliSpec, type SpawnSpec } from './agentRuntimes.ts'
import { ANTIGRAVITY_ACP_VERSION, antigravityCommand } from './antigravityAcp.ts'
import { runtimeStatuses } from './agentRuntimeInstall.ts'
import { agentProcessRunning, primeReleaseUrl, primeReleaseVersion } from './update-policy.ts'
import type { UpdateItem, UpdateJob, UpdatesStatus } from '../shared/updates.ts'
const exec = promisify(execFile)
export type UpdateCandidate = UpdateItem & { command?: SpawnSpec; lookup?: () => Promise<string> }
let catalog: UpdateCandidate[] = []
let checkedAt = 0
let checking: Promise<UpdatesStatus> | null = null
const job: UpdateJob = { running: false, items: [] }
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
async function output(cmd: string, args: string[]) {
  const result = await exec(cmd, args, { cwd: MEW_APP_ROOT, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 })
  return result.stdout.trim()
}
async function remoteJson(url: string): Promise<any> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'mew-update-check' } })
  if (!response.ok) throw new Error(`버전 조회 실패 (${response.status})`)
  return response.json()
}
async function npmLatest(name: string): Promise<string> {
  const data = await remoteJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`)
  if (typeof data.version !== 'string') throw new Error('최신 버전을 읽지 못했습니다')
  return data.version
}
async function primeLatest(): Promise<string> {
  if (process.env.PRIME_AGENT_VERSION) return primeReleaseVersion(process.env.PRIME_AGENT_VERSION)
  const installer = await fetch('https://app.primeintellect.ai/prime-agent/install.sh', { signal: AbortSignal.timeout(15_000) })
  if (!installer.ok) throw new Error(`Prime 배포 조회 실패 (${installer.status})`)
  const url = primeReleaseUrl(await installer.text(), process.env.PRIME_AGENT_DOWNLOAD_BASE_URL, process.env.PRIME_AGENT_RELEASE_CHANNEL || 'stable')
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`Prime 버전 조회 실패 (${response.status})`)
  return primeReleaseVersion(await response.text())
}

async function assertAgentIdle(row: UpdateCandidate) {
  if (row.category !== 'agent') return
  const runtime = row.id.split(':')[1]
  const spec = runtime === 'prime' ? { cmd: process.env.MEW_PRIME_AGENT_EXECUTABLE || 'prime-agent' } : resolvedSpec(runtime)
  const cli = runtime === 'claude' ? claudeCliSpec([]).cmd : runtime === 'codex' ? RUNTIMES.codex.logout!().cmd : null
  const commands = [spec?.cmd, cli].filter((cmd): cmd is string => !!cmd && cmd !== process.execPath)
  for (const command of [...commands]) {
    try { commands.push(fs.realpathSync(findExecutable(command) ?? command)) } catch { /* Keep the configured command. */ }
  }
  // Inspect all processes owned by the server user, including detached hosts and terminal CLIs.
  const processes = await output('ps', ['-u', String(process.getuid!()), '-o', 'args='])
  if (agentProcessRunning(processes, runtime, commands)) throw new Error(`${row.label} 실행 중입니다. 에이전트를 종료한 뒤 업데이트해 주세요`)
}

export function newer(current: string | null, latest: string | null): boolean {
  if (!current || !latest || current === latest) return false
  const parse = (value: string) => value.match(/(?:^|\s|v)(\d+)\.(\d+)(?:\.(\d+))?(?:-([\w.-]+))?/)
  const a = parse(current), b = parse(latest)
  if (!a || !b) return false
  for (let i = 1; i <= 3; i++) { const diff = Number(b[i] ?? 0) - Number(a[i] ?? 0); if (diff) return diff > 0 }
  if (a[4] && !b[4]) return true
  if (!a[4] && b[4]) return false
  if (a[4] && b[4]) {
    const left = a[4].split('.'), right = b[4].split('.')
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      if (left[i] === right[i]) continue
      if (left[i] === undefined) return true
      if (right[i] === undefined) return false
      const l = /^\d+$/.test(left[i]), r = /^\d+$/.test(right[i])
      if (l !== r) return l
      return l ? Number(right[i]) > Number(left[i]) : right[i] > left[i]
    }
  }
  return false
}

function item(id: string, label: string, category: UpdateItem['category'], current: string | null): UpdateCandidate {
  return { id, label, category, current, latest: null, available: false, canUpdate: false, error: null }
}
const npmAgents: Record<string, string> = { kimi: '@moonshot-ai/kimi-code', openclaw: 'openclaw', opencode: 'opencode-ai', prime: 'prime-agent', codex: '@openai/codex', claude: '@anthropic-ai/claude-code' }
async function agents(): Promise<UpdateCandidate[]> {
  let globals: Record<string, { version?: string }> = {}
  try { globals = JSON.parse(await output('npm', ['ls', '-g', '--depth=0', '--json'])).dependencies ?? {} } catch { /* Non-npm installations remain visible. */ }
  let globalRoot: string | null = null
  try { globalRoot = await output('npm', ['root', '-g']) } catch { /* Unmanaged installations are not rewritten. */ }
  const managedNpm = (command: string, pkg: string) => {
    if (!globalRoot || !globals[pkg]) return false
    try {
      const executable = fs.realpathSync(findExecutable(command) ?? command)
      const directory = fs.realpathSync(path.join(globalRoot, pkg))
      const relative = path.relative(directory, executable)
      return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
    } catch { return false }
  }
  const rows: UpdateCandidate[] = []
  for (const status of runtimeStatuses().filter(row => row.installed && row.id !== 'tmux')) {
    if (status.id === 'claude' || status.id === 'codex') continue // Bundled ACP adapters are updated with Mew, not independently.
    if (status.id === 'antigravity') {
      const row = item('agent:antigravity', status.label, 'agent', resolvedSpec('antigravity')?.cmd === antigravityCommand() ? ANTIGRAVITY_ACP_VERSION : null)
      row.lookup = async () => (await remoteJson('https://raw.githubusercontent.com/agentclientprotocol/registry/main/antigravity-acp/agent.json')).version
      row.error = '버전 고정 ACP 배포본은 Mew 업데이트로 적용합니다'
      rows.push(row)
      continue
    }
    const spec = status.id === 'prime' ? { cmd: process.env.MEW_PRIME_AGENT_EXECUTABLE || 'prime-agent', args: [] } : resolvedSpec(status.id)
    if (!spec || !findExecutable(spec.cmd) && !fs.existsSync(spec.cmd)) continue
    let current: string | null = null
    try { current = (await output(spec.cmd, ['--version'])).match(/\d+\.\d+(?:\.\d+)?(?:-[\w.-]+)?/)?.[0] ?? null } catch { /* Show unknown instead of guessing. */ }
    const row = item(`agent:${status.id}`, status.label, 'agent', current)
    const pkg = npmAgents[status.id]
    if (pkg && managedNpm(spec.cmd, pkg)) row.current = globals[pkg].version!
    if (status.id === 'prime') {
      row.lookup = primeLatest
      row.command = { cmd: spec.cmd, args: ['update'] }
    } else if (pkg) {
      row.lookup = () => npmLatest(pkg)
      if (managedNpm(spec.cmd, pkg)) row.command = { cmd: 'npm', args: ['install', '-g', `${pkg}@latest`, '--no-audit', '--no-fund'] }
      else row.error = '설치 경로를 자동으로 업데이트할 수 없습니다'
    } else if (status.id === 'hermes') {
      row.lookup = async () => (await remoteJson('https://pypi.org/pypi/hermes-agent/json')).info.version
      if (findExecutable('uv')) row.command = { cmd: 'uv', args: ['tool', 'upgrade', 'hermes-agent'] }
    } else if (status.id === 'cursor') {
      row.lookup = async () => {
        const response = await fetch('https://cursor.com/install', { signal: AbortSignal.timeout(15_000) })
        if (!response.ok) throw new Error('Cursor 버전 조회 실패')
        const version = (await response.text()).match(/downloads\.cursor\.com\/[^/]+\/([^/]+)\//)?.[1]
        if (!version) throw new Error('Cursor 최신 버전을 읽지 못했습니다')
        return version
      }
      row.command = { cmd: spec.cmd, args: ['update'] }
    } else row.error = '공식 최신 버전 조회를 지원하지 않습니다'
    rows.push(row)
  }
  for (const [id, pkg] of Object.entries(npmAgents).filter(([id]) => id === 'claude' || id === 'codex')) {
    const cli = id === 'codex' ? { cmd: RUNTIMES.codex.logout!().cmd, args: [] } : claudeCliSpec([])
    const command = cli.cmd
    if (!findExecutable(command) && !fs.existsSync(command)) continue
    let current: string | null = managedNpm(command, pkg) ? globals[pkg]?.version ?? null : null
    try { current ??= (await output(command, [...cli.args, '--version'])).match(/\d+\.\d+\.\d+/)?.[0] ?? null } catch { /* Unknown */ }
    const row = item(`cli:${id}`, id === 'claude' ? 'Claude Code CLI' : 'Codex CLI', 'agent', current)
    row.lookup = () => npmLatest(pkg)
    if (managedNpm(command, pkg)) row.command = { cmd: 'npm', args: ['install', '-g', `${pkg}@latest`, '--no-audit', '--no-fund'] }
    else if (id === 'claude' && cli.args.length === 0) row.command = { cmd: command, args: ['update'] }
    else row.error = '설치 경로를 자동으로 업데이트할 수 없습니다'
    rows.push(row)
  }
  for (const [id, pkg] of Object.entries(npmAgents)) {
    if (id === 'prime' || id === 'claude' || id === 'codex' || rows.some(row => row.id === `agent:${id}`) || !globals[pkg]?.version) continue
    const row = item(`agent:${id}`, RUNTIMES[id]?.label ?? pkg, 'agent', globals[pkg].version!)
    row.lookup = () => npmLatest(pkg)
    row.command = { cmd: 'npm', args: ['install', '-g', `${pkg}@latest`, '--no-audit', '--no-fund'] }
    rows.push(row)
  }
  return rows
}
async function systems(): Promise<UpdateCandidate[]> {
  const rows: UpdateCandidate[] = []
  const commands: [string, string[]][] = [['node', ['--version']], ['npm', ['--version']], ['git', ['--version']], ['tmux', ['-V']], ['python3', ['--version']], ['uv', ['--version']], ['cargo', ['--version']], ['rustc', ['--version']], ['docker', ['--version']], ['make', ['--version']], ['gcc', ['--version']], ['g++', ['--version']]]
  for (const [cmd, args] of commands) {
    if (!findExecutable(cmd)) continue
    let current: string | null = null
    try { current = (await output(cmd, args)).match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? null } catch { /* unknown */ }
    const row = item(`system:${cmd}`, cmd === 'node' ? 'Node.js' : cmd, 'system', current)
    if (cmd === 'npm') { row.lookup = () => npmLatest('npm'); row.command = { cmd: 'npm', args: ['install', '-g', 'npm@latest'] } }
    else if (cmd === 'uv') {
      row.lookup = async () => (await remoteJson('https://api.github.com/repos/astral-sh/uv/releases/latest')).tag_name.replace(/^v/, '')
      row.command = { cmd: 'uv', args: ['self', 'update'] }
    } else if ((cmd === 'rustc' || cmd === 'cargo') && findExecutable('rustup')) {
      row.lookup = async () => {
        const response = await fetch('https://static.rust-lang.org/dist/channel-rust-stable.toml', { signal: AbortSignal.timeout(15_000) })
        if (!response.ok) throw new Error('Rust 버전 조회 실패')
        const version = (await response.text()).match(/\[pkg\.rust\]\s+version = "([^" ]+)/)?.[1]
        if (!version) throw new Error('Rust 최신 버전을 읽지 못했습니다')
        return version
      }
      row.command = { cmd: 'rustup', args: ['update', 'stable'] }
    } else if (cmd === 'node') {
      row.lookup = async () => { const releases = await remoteJson('https://nodejs.org/dist/index.json'); return releases.find((release: any) => release.lts)?.version.replace(/^v/, '') }
      row.error = 'Node 설치 관리 도구에서 업데이트해 주세요'
    } else if (findExecutable('brew')) {
      const formula = cmd === 'python3' ? 'python' : cmd === 'rustc' || cmd === 'cargo' ? 'rust' : cmd
      row.lookup = async () => { const data = JSON.parse(await output('brew', ['info', '--json=v2', formula])); return data.formulae[0].versions.stable }
      row.command = { cmd: 'brew', args: ['upgrade', formula] }
    } else if (findExecutable('apt-cache')) {
      const pkg = cmd === 'docker' ? 'docker-ce' : cmd
      row.lookup = async () => {
        const policy = await output('apt-cache', ['policy', pkg])
        const installed = policy.match(/Installed:\s+(\S+)/)?.[1]
        const latest = policy.match(/Candidate:\s+(\S+)/)?.[1]
        if (!latest || latest === '(none)' || !installed || installed === '(none)') throw new Error('패키지 관리자가 설치한 도구가 아닙니다')
        row.current = installed
        return latest
      }
      row.error = '배포판 패키지 목록 기준입니다. 시스템 패키지 관리자에서 업데이트해 주세요'
    } else row.error = '설치 관리 도구에서 업데이트해 주세요'
    rows.push(row)
  }
  return rows
}
function snapshot(): UpdatesStatus { return { items: catalog.map(({ command: _command, lookup: _lookup, ...row }) => row), checkedAt, job: structuredClone(job) } }
export async function updatesStatus(refresh = false): Promise<UpdatesStatus> {
  if (checking) return checking
  if (job.running || checkedAt && !refresh) return snapshot()
  checking = (async () => {
    const [agentRows, systemRows] = await Promise.all([agents(), systems()])
    const rows = [...agentRows, ...systemRows]
    let next = 0
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (next < rows.length) {
        const row = rows[next++]
        if (!row.lookup) continue
        try {
          row.latest = await row.lookup()
          row.available = newer(row.current, row.latest)
          if (row.id.startsWith('system:') && row.error?.startsWith('배포판') && row.current && row.latest) {
            try { await exec('dpkg', ['--compare-versions', row.latest, 'gt', row.current], { timeout: 5000 }); row.available = true }
            catch { row.available = false }
          }
          row.canUpdate = row.available && !!row.command
        } catch (error) { row.error = message(error) }
      }
    }))
    catalog = rows
    checkedAt = Date.now()
    return snapshot()
  })().finally(() => { checking = null })
  return checking
}
export function updatesRunning(): boolean { return job.running }
export async function startUpdates(ids: unknown): Promise<UpdatesStatus> {
  if (job.running) throw new Error('이미 업데이트 중입니다')
  if (runtimeStatuses().some(row => row.installing)) throw new Error('에이전트 설치 작업이 끝난 뒤 업데이트해 주세요')
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string')) throw new Error('업데이트 항목이 필요합니다')
  await updatesStatus(true)
  if (job.running) throw new Error('이미 업데이트 중입니다')
  const selected = selectUpdates(catalog, ids)
  for (const row of selected) await assertAgentIdle(row)
  if (job.running) throw new Error('이미 업데이트 중입니다')
  job.running = true
  job.items = selected.map(row => ({ id: row!.id, state: 'queued', error: null }))
  void runUpdateQueue(selected, job, async spec => {
    const row = selected.find(row => row.command === spec)!
    await assertAgentIdle(row)
    await exec(spec.cmd, spec.args, { cwd: MEW_APP_ROOT, env: { ...process.env, ...spec.env }, timeout: 10 * 60_000, maxBuffer: 2 * 1024 * 1024 })
  }).finally(() => { checkedAt = 0 })
  return snapshot()
}
export function selectUpdates(catalog: UpdateCandidate[], ids: unknown): UpdateCandidate[] {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string')) throw new Error('업데이트 항목이 필요합니다')
  const selected = [...new Set(ids as string[])].map(id => catalog.find(row => row.id === id))
  if (selected.some(row => !row?.canUpdate || !row.command || row.id.startsWith('npm:') || row.category === 'dependency')) throw new Error('업데이트할 수 없는 항목입니다. 버전을 다시 확인해 주세요')
  if (selected.some(row => row?.category === 'agent') && selected.length !== 1) throw new Error('에이전트는 개별 업데이트만 가능합니다')
  return selected as UpdateCandidate[]
}
export async function runUpdateQueue(selected: UpdateCandidate[], job: UpdateJob, run: (spec: SpawnSpec) => Promise<void>) {
  try {
    for (const row of selected) {
      const entry = job.items.find(entry => entry.id === row.id)!
      entry.state = 'running'
      try { await run(row.command!); entry.state = 'succeeded' }
      catch (error) { entry.state = 'failed'; entry.error = message(error).slice(-2000) }
    }
  } finally { job.running = false }
}
