import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'

const children = new Set<ChildProcess>()
process.once('exit', () => { for (const child of children) child.kill('SIGTERM') })

export type NativeBrowser = { context: BrowserContext; close: () => Promise<void> }

/** Launch our own profile with minimal flags; attach only to its loopback endpoint. */
export async function launchNativeBrowser(executablePath: string, profileDir: string, headless: boolean): Promise<NativeBrowser> {
  const reservation = net.createServer()
  await new Promise<void>((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve) })
  const port = (reservation.address() as net.AddressInfo).port
  await new Promise<void>((resolve) => reservation.close(() => resolve()))
  const child = spawn(executablePath, [
    `--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1', '--no-first-run',
    ...(headless ? ['--headless=new'] : []), 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  children.add(child)
  let exited = false
  const exit = new Promise<void>((resolve) => {
    const done = () => { exited = true; children.delete(child); resolve() }
    child.once('exit', done)
    child.once('error', done)
  })
  const waitForExit = async (ms: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([exit, new Promise<void>((resolve) => { timer = setTimeout(resolve, ms) })])
    clearTimeout(timer)
  }
  let browser: Browser | undefined
  let closing: Promise<void> | undefined
  const close = (): Promise<void> => closing ??= (async () => {
    if (browser?.isConnected()) {
      const control = await browser.newBrowserCDPSession().catch(() => null)
      if (control) await Promise.race([control.send('Browser.close').catch(() => {}), new Promise<void>((resolve) => { const timer = setTimeout(resolve, 1000); timer.unref() })])
      await browser.close().catch(() => {})
      // Browser.close replies before Chromium finishes flushing profile storage.
      // Give the owned process time to exit cleanly before escalating to signals.
      if (!exited) await waitForExit(1000)
    }
    if (!exited) {
      child.kill('SIGTERM')
      const timer = setTimeout(() => { if (!exited) child.kill('SIGKILL') }, 1500)
      timer.unref()
      await exit
      clearTimeout(timer)
    }
  })()
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let pending = ''
      const timer = setTimeout(() => finish(new Error('서버 Chromium의 디버깅 연결을 열지 못했습니다. 디스플레이와 프로필 사용 상태를 확인해 주세요.')), 15_000)
      const failure = () => finish(new Error('서버 Chromium 프로세스를 실행하지 못했습니다. 설치 경로와 디스플레이를 확인해 주세요.'))
      const receive = (data: Buffer) => {
        pending = (pending + data.toString()).slice(-8192)
        const match = pending.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-zA-Z0-9-]+)/)
        if (match && new URL(match[1]).port === String(port)) finish(undefined, match[1])
      }
      function finish(error?: Error, value?: string) {
        clearTimeout(timer)
        child.stderr!.off('data', receive)
        child.off('exit', failure)
        child.off('error', failure)
        if (error) reject(error); else resolve(value!)
      }
      child.stderr!.on('data', receive)
      child.once('exit', failure)
      child.once('error', failure)
    })
    // Keep draining stderr without recording page URLs or other browser output.
    child.stderr!.resume()
    browser = await chromium.connectOverCDP(endpoint, { timeout: 15_000 })
    const context = browser.contexts()[0]
    if (!context) throw new Error('서버 Chromium 프로필에 연결하지 못했습니다.')
    context.once('close', () => { void close() })
    return { context, close }
  } catch (error) {
    await close()
    throw error
  }
}
