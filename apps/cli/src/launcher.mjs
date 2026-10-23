import { fork, spawn } from 'node:child_process'
import path from 'node:path'
import { createServer } from 'node:net'
import { createInterface } from 'node:readline/promises'
import qrcode from 'qrcode-terminal'
import { acquireDataLock, checkLegacyInstance } from './lock.mjs'
import { windowsEnvironment, browserArgs } from './platform/index.mjs'

export async function checkPort(port) {
  if (!port) return
  const probe = createServer()
  await new Promise((resolve, reject) => {
    probe.once('error', error => reject(new Error(`포트 ${port}를 사용할 수 없습니다 (${error.code}). 기존 mew가 실행 중인지 확인하거나 --port를 지정하세요.`)))
    probe.listen(port, '127.0.0.1', () => probe.close(resolve))
  })
}

export function openBrowser(url, platform = process.platform) {
  const command = platform === 'win32' ? path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : platform === 'darwin' ? 'open' : 'xdg-open'
  const child = spawn(command, platform === 'win32' ? browserArgs(url) : [url], { stdio: 'ignore', windowsHide: true })
  child.on('error', () => {})
  child.unref()
}

export function runtimeEnvironment(runtime, options, env = process.env) {
  const environment = {
    ...env,
    MEW_DISTRIBUTION: 'release',
    MEW_OWNER_EMAIL: options.ownerEmail || '',
    MEW_WORKSPACE: options.workspace,
    MEW_DATA_DIR: options.dataDir,
    MEW_TEAM_PORT: String(options.port),
    MEW_BIND: '127.0.0.1',
    MEW_MULTIPLEXER: path.join(runtime, 'bin', process.platform === 'win32' ? 'psmux.exe' : 'tmux'),
    ...(process.platform === 'win32' ? { MEW_WINDOWS_PROCESS_HOST: path.join(runtime, 'native', 'windows', 'process-host.exe') } : {}),
    PATH: [path.join(runtime, 'bin'), path.join(runtime, 'node_modules', '.bin'), env.PATH || env.Path].filter(Boolean).join(path.delimiter),
  }
  return process.platform === 'win32' ? windowsEnvironment(environment) : environment
}

export async function runHost(runtime, options, { log = console.log, error = console.error, forkImpl = fork, input = process.stdin, output = process.stdout, browser = openBrowser } = {}) {
  const child = forkImpl(path.join(runtime, 'server/cli-host.js'), [], {
    cwd: options.workspace, env: runtimeEnvironment(runtime, options), execArgv: [], stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  })
  let ready = false, prompting = false, printedRemote = '', exitSignal = null
  const abort = new AbortController()
  let shutdownTimer
  const stop = signal => {
    exitSignal = signal; abort.abort()
    if (process.platform === 'win32' && child.connected) {
      child.send({ type: 'shutdown' })
      shutdownTimer = setTimeout(() => child.kill('SIGKILL'), 4000); shutdownTimer.unref()
    } else child.kill(signal)
  }
  const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM')
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', terminate)
  let timeout
  const startTimeout = () => {
    clearTimeout(timeout)
    timeout = setTimeout(() => { if (!ready && !prompting) { error('mew 시작을 확인하지 못했습니다. 다시 실행하세요.'); child.kill('SIGTERM') } }, 60_000)
  }
  startTimeout()
  const send = message => { if (child.connected) child.send(message) }
  const onMessage = async message => {
    if (!message || typeof message !== 'object') return
    if (message.type === 'setup-needed') {
      prompting = true
      clearTimeout(timeout)
      let email = options.ownerEmail
      if (!email && !input.isTTY) { error('첫 실행에는 owner 이메일이 필요합니다. 터미널에서 실행하거나 --owner-email을 지정하세요.'); child.kill('SIGTERM'); return }
      if (!email) {
        const reader = createInterface({ input, output })
        try { email = await reader.question('첫 mew 계정 이메일: ', { signal: abort.signal }) } catch { child.kill('SIGTERM'); return } finally { reader.close() }
      }
      if (!email.trim()) { error('owner 이메일을 입력하세요.'); child.kill('SIGTERM'); return }
      prompting = false
      startTimeout()
      send({ type: 'setup-owner', email: email.trim() })
      return
    }
    if (message.type === 'owner-created') {
      log(`첫 계정: ${message.email}\n임시 비밀번호: ${message.password}\n브라우저에서 로그인한 뒤 비밀번호를 바꾸세요.`)
      return
    }
    if (message.type === 'ready') {
      ready = true
      clearTimeout(timeout)
      log(`워크스페이스: ${options.workspace}\nmew: ${message.url}\n외부 접속: 계정 관리 → 원격 접속 → 기기 등록\n종료: Ctrl+C`)
      if (options.open) browser(message.url)
      return
    }
    if (message.type === 'remote-status') {
      const status = message.status
      const url = status?.state === 'online' ? status.url : status?.state === 'registering' ? status.registrationUrl : ''
      if (!url) { printedRemote = ''; return }
      if (url === printedRemote) return
      printedRemote = url
      log(`${status.state === 'online' ? '외부 접속 주소' : 'Mewlink 등록 완료'}: ${url}`)
      qrcode.generate(url, { small: true }, qr => log(qr))
      return
    }
    if (message.type === 'error') error(message.message)
  }
  child.on('message', message => { void onMessage(message).catch(failure => { error(failure.message); child.kill('SIGTERM') }) })
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve(exitSignal === 'SIGINT' ? 130 : exitSignal === 'SIGTERM' ? 143 : code ?? (signal || !ready ? 1 : 0)))
    })
  } finally {
    abort.abort()
    clearTimeout(timeout)
    clearTimeout(shutdownTimer)
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', terminate)
  }
}

export async function launch({ prepare, options, version, target }) {
  await checkLegacyInstance(options.legacyPidfile)
  await checkPort(options.port)
  const unlock = await acquireDataLock(options.dataDir)
  try {
    const runtime = await prepare({ cacheDir: options.cacheDir, version, target, log: console.log })
    return await runHost(runtime, options)
  } finally { await unlock() }
}
