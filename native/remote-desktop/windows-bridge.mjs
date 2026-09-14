import net from 'node:net'
import crypto from 'node:crypto'
import path from 'node:path'
import { spawn } from 'node:child_process'

// Only built-ins: this console process can run from the WSL source directory.
const entry = process.argv[2]
if (!entry || !path.win32.isAbsolute(entry)) throw new Error('Windows desktop entry is required')
const token = crypto.randomBytes(32).toString('hex')
const pipe = `\\\\.\\pipe\\mew-desktop-${crypto.randomBytes(24).toString('hex')}`
let launcher, channel, stopping = false
let input = Buffer.alloc(0)
const candidates = new Set()
const emitError = message => process.stdout.write(`MEW_DESKTOP ${JSON.stringify({ type: 'error', message })}\n`)
const stop = () => {
  if (stopping) return
  stopping = true; clearTimeout(deadline); server.close()
  for (const socket of candidates) socket.destroy()
  channel?.end()
  // The broker observes this PID and removes its task; Electron observes pipe EOF.
  setTimeout(() => process.exit(0), 1500).unref()
  if (!channel) process.exit(0)
}
const fail = message => { emitError(message); stop() }
const server = net.createServer(socket => {
  if (stopping || channel || candidates.size >= 4) { socket.destroy(); return }
  candidates.add(socket)
  socket.setTimeout(3000, () => socket.destroy())
  socket.on('error', () => socket.destroy())
  socket.on('close', () => { candidates.delete(socket); if (socket === channel) stop() })
  let pending = Buffer.alloc(0)
  const authenticate = chunk => {
    pending = Buffer.concat([pending, chunk])
    const end = pending.indexOf(10)
    if (end < 0 && pending.length <= 64) return
    if (end !== 64 || !crypto.timingSafeEqual(pending.subarray(0, 64), Buffer.from(token))) { socket.destroy(); return }
    socket.pause(); socket.off('data', authenticate); socket.setTimeout(0)
    channel = socket; candidates.delete(socket); clearTimeout(deadline); server.close()
    for (const other of candidates) other.destroy()
    if (pending.length > end + 1) socket.unshift(pending.subarray(end + 1))
    socket.pipe(process.stdout, { end: false })
    if (input.length) socket.write(input)
    input = Buffer.alloc(0)
    socket.on('drain', () => process.stdin.resume())
  }
  socket.on('data', authenticate)
})
server.on('error', () => fail('Windows 원격 데스크톱 통신 파이프를 열지 못했습니다.'))
const deadline = setTimeout(() => fail('Windows 로그인 데스크톱을 시작하지 못했습니다. 같은 Windows 계정으로 로그인되어 있는지와 작업 스케줄러 정책을 확인해 주세요.'), 40000)
process.stdin.on('end', stop); process.stdin.on('error', stop)
process.stdin.on('data', chunk => {
  if (stopping) return
  if (channel) { if (!channel.write(chunk)) process.stdin.pause() }
  else {
    input = Buffer.concat([input, chunk])
    if (input.length > 256 * 1024) fail('Windows 시작 요청이 너무 큽니다.')
  }
})
process.stdout.on('error', stop); process.on('SIGTERM', stop); process.on('SIGINT', stop)
server.listen(pipe, () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
  const bootstrap = `mew-desktop-bootstrap-${crypto.randomBytes(24).toString('hex')}`
  launcher = spawn(path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.win32.join(path.win32.dirname(entry), 'windows-session.ps1'),
    '-Mode', 'broker', '-BootstrapPipe', bootstrap, '-BridgePid', String(process.pid),
  ], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  launcher.stdin.on('error', () => { if (!stopping) fail('Windows 데스크톱 시작 요청을 전달하지 못했습니다.') })
  launcher.stdin.end(`${JSON.stringify({ entry, pipe, token })}\n`)
  launcher.stderr.resume(); let result = ''
  launcher.stdout.on('data', chunk => { if (result.length < 1024) result += chunk.toString() })
  launcher.once('error', () => fail('Windows 데스크톱 시작 도구를 실행하지 못했습니다.'))
  launcher.once('exit', code => {
    if ((code || !result.includes('LAUNCHED')) && !stopping) {
      const stage = result.match(/SESSION_LAUNCH_FAILED:([a-z]+)/)?.[1] ?? 'startup'
      fail(`Windows 로그인 세션에서 실행하지 못했습니다 (${stage}). 같은 Windows 계정으로 로그인하고 작업 스케줄러 실행 권한을 확인해 주세요.`)
    }
  })
})
