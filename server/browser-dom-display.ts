import { spawn, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Readable } from 'node:stream'

const displays = new Map<ChildProcess, string>()
process.once('exit', () => {
  for (const [child, directory] of displays) {
    child.kill('SIGTERM')
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

export function usesVirtualBrowserDisplay(headless: boolean, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (env.MEW_BROWSER_DISPLAY && !['virtual', 'desktop'].includes(env.MEW_BROWSER_DISPLAY)) {
    throw new Error('MEW_BROWSER_DISPLAY는 virtual 또는 desktop이어야 합니다.')
  }
  return !headless && platform === 'linux' && env.MEW_BROWSER_DISPLAY !== 'desktop'
}

/** A private X server keeps native windows and site popups off the host desktop. */
export async function launchBrowserDisplay(): Promise<{ env: NodeJS.ProcessEnv; exited: Promise<void>; close: () => Promise<void> }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-browser-display-'))
  const authority = path.join(directory, 'authority')
  // Xauthority: FamilyWild, any address/display, MIT-MAGIC-COOKIE-1.
  // The server and its client both read this private, per-process credential.
  const field = (value: Buffer) => {
    const length = Buffer.alloc(2)
    length.writeUInt16BE(value.length)
    return Buffer.concat([length, value])
  }
  try {
    fs.writeFileSync(authority, Buffer.concat([
      Buffer.from([0xff, 0xff]), field(Buffer.alloc(0)), field(Buffer.alloc(0)),
      field(Buffer.from('MIT-MAGIC-COOKIE-1')), field(crypto.randomBytes(16)),
    ]), { mode: 0o600 })
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true })
    throw error
  }
  // A high starting number avoids shadowing WSLg's filesystem-only :0 socket.
  // Linux abstract sockets also avoid writing WSLg's read-only /tmp/.X11-unix.
  const child = spawn('Xvfb', [`:${crypto.randomInt(10000, 60000)}`, '-displayfd', '3', '-screen', '0', '1920x1080x24', '-nolisten', 'tcp', '-nolisten', 'unix', '-auth', authority], {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
  })
  displays.set(child, directory)
  let stopped = false
  const exited = new Promise<void>((resolve) => {
    const done = () => { stopped = true; resolve() }
    child.once('exit', done)
    child.once('error', done)
  })
  let closing: Promise<void> | undefined
  const close = () => closing ??= (async () => {
    if (!stopped) {
      child.kill('SIGTERM')
      const timer = setTimeout(() => { if (!stopped) child.kill('SIGKILL') }, 1500)
      timer.unref()
      await exited
      clearTimeout(timer)
    }
    displays.delete(child)
    fs.rmSync(directory, { recursive: true, force: true })
  })()
  try {
    const display = await new Promise<string>((resolve, reject) => {
      let pending = ''
      const output = child.stdio[3] as Readable
      const timer = setTimeout(() => finish(new Error('서버 브라우저 가상 화면 준비 시간이 초과됐습니다.')), 10_000)
      const failure = () => finish(new Error('서버 브라우저 가상 화면을 시작하지 못했습니다. Xvfb를 설치해 주세요 (Debian/Ubuntu: sudo apt install xvfb). 실제 데스크톱 사용은 MEW_BROWSER_DISPLAY=desktop으로 선택할 수 있습니다.'))
      const receive = (data: Buffer) => {
        pending = (pending + data.toString()).slice(-64)
        if (/^\d+\n$/.test(pending)) finish(undefined, `:${pending.trim()}`)
      }
      function finish(error?: Error, value?: string) {
        clearTimeout(timer)
        output.off('data', receive)
        child.off('exit', failure)
        child.off('error', failure)
        if (error) reject(error); else resolve(value!)
      }
      output.on('data', receive)
      child.once('exit', failure)
      child.once('error', failure)
    })
    return { env: { ...process.env, DISPLAY: display, XAUTHORITY: authority, WAYLAND_DISPLAY: undefined }, exited, close }
  } catch (error) {
    await close()
    throw error
  }
}
