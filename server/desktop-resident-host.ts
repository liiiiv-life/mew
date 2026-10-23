import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { PassThrough, Writable } from 'node:stream'
import { hostReader } from '../native/remote-desktop/host-wire.mjs'
import type { DesktopHostProcess } from './remote-desktop-host.ts'

/** Owns one login host. A session ends only after native capture acknowledges stop. */
export function residentDesktopHost(launch: () => Promise<DesktopHostProcess>, { startupMs = 40_000, stopMs = 3500, heartbeatMs = 2500, quarantineMs = 11_250, killMs = 4000 } = {}) {
  let process: DesktopHostProcess | undefined, warming: Promise<void> | undefined, closing = false
  let quarantineUntil = 0
  let active: { id: string; host: DesktopHostProcess; ending: boolean; timer?: ReturnType<typeof setTimeout> } | undefined
  const write = (value: unknown) => {
    if (!process || process.stdin.destroyed || process.stdin.writableLength > 256 * 1024) throw new Error('Desktop parent unavailable')
    process.stdin.write(`${JSON.stringify(value)}\n`)
  }
  const finish = () => {
    if (!active) return
    const previous = active; active = undefined; clearTimeout(previous.timer)
    previous.host.stdout.push(null); previous.host.emit('exit', 0)
  }
  const retire = () => {
    if (active) quarantineUntil = Date.now() + quarantineMs
    const previous = process; process = undefined
    if (previous) {
      const kill = setTimeout(() => previous.kill('SIGKILL'), killMs); kill.unref()
      previous.once('exit', () => clearTimeout(kill))
      previous.stdin.end(); previous.kill('SIGTERM')
    }
  }
  const heartbeat = setInterval(() => { if (process && !active) { try { write({ type: 'lease' }) } catch { retire() } } }, heartbeatMs)
  heartbeat.unref()
  const warm = () => {
    if (closing) return Promise.reject(new Error('Desktop server closed'))
    if (warming) return warming
    if (process) return Promise.resolve()
    const pending = (async () => {
      if (Date.now() < quarantineUntil) await new Promise(resolve => setTimeout(resolve, quarantineUntil - Date.now()))
      if (closing) throw new Error('Desktop server closed')
      const child = await launch()
      if (closing) { child.stdin.end(); child.kill('SIGTERM'); throw new Error('Desktop server closed') }
      process = child
      await new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(() => { if (process === child) retire(); reject(new Error('Native GPU host startup timed out')) }, startupMs)
        deadline.unref()
        const failed = () => { clearTimeout(deadline); if (process === child) { if (active) quarantineUntil = Date.now() + quarantineMs; process = undefined; finish() }; reject(new Error('Native GPU host exited')) }
        child.once('exit', failed); child.once('error', failed)
        child.stdin.on('error', () => { if (process === child) { retire(); finish() } })
        const read = hostReader(value => {
          if (process !== child) return
          if (value.type === 'ready' && !value.session) { clearTimeout(deadline); resolve(); return }
          if (!active || value.session !== active.id) {
            if (value.type === 'error' && !value.session) { retire(); finish(); clearTimeout(deadline); reject(new Error('Native GPU host failed')) }
            return
          }
          if (value.type === 'stopped') { if (active.ending) finish(); return }
          if (!active.ending) {
            const { session: _session, ...message } = value
            if (active.host.stdout.readableLength > 256 * 1024) { retire(); finish(); return }
            ;(active.host.stdout as PassThrough).write(`MEW_DESKTOP ${JSON.stringify(message)}\n`)
          }
        }, () => { throw new Error('Video cannot enter signaling') })
        child.stdout.on('data', (chunk: Buffer) => { if (process !== child) return; try { read(chunk) } catch { retire(); finish(); clearTimeout(deadline); reject(new Error('Invalid desktop host output')) } })
      })
    })()
    warming = pending.finally(() => { warming = undefined })
    return warming
  }
  return {
    warm,
    async acquire(): Promise<DesktopHostProcess> {
      await warm()
      if (active || closing) throw new Error('Desktop host already leased')
      const id = randomBytes(16).toString('hex'), stdout = new PassThrough(), stderr = new PassThrough()
      const end = () => {
        if (!active || active.id !== id || active.ending) return
        active.ending = true
        try { write({ type: 'stop', session: id }) } catch { retire(); finish(); return }
        active.timer = setTimeout(() => { retire(); finish() }, stopMs); active.timer.unref()
      }
      const stdin = new Writable({
        write(chunk, _encoding, done) {
          try {
            if (active?.id === id && !active.ending) {
              for (const line of chunk.toString().split('\n').filter(Boolean)) {
                const message = JSON.parse(line)
                if (message.type === 'stop') end()
                else write({ ...message, session: id })
              }
            }
            done()
          } catch (error) { done(error as Error); end() }
        },
        final(done) { end(); done() },
      })
      const host = Object.assign(new EventEmitter(), { stdin, stdout, stderr, desktopNetworkHint: process?.desktopNetworkHint, kill() { if (active?.id === id) { retire(); finish() }; return true } }) as DesktopHostProcess
      active = { id, host, ending: false }
      return host
    },
    async close() {
      if (closing) return
      closing = true; clearInterval(heartbeat)
      const child = process
      const exited = child ? new Promise<void>(resolve => {
        const deadline = setTimeout(resolve, killMs + 500); deadline.unref()
        child.once('exit', () => { clearTimeout(deadline); resolve() })
      }) : Promise.resolve()
      retire(); finish(); await exited; await warming?.catch(() => {})
    },
  }
}
