import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { BrowserContext } from 'playwright-core'
import { DATA_DIR } from './dataDir.ts'
import { launchNativeBrowser, type NativeBrowser } from './browser-dom-process.ts'

type Profile = { browser: Promise<NativeBrowser>; users: number; closing?: Promise<void> }
const profiles = new Map<string, Profile>()

/** Use the server desktop when available; never silently retry a failed GUI launch headless. */
export function domBrowserHeadless(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (env.MEW_BROWSER_HEADLESS === '1') return true
  if (env.MEW_BROWSER_HEADLESS === '0') return false
  if (env.MEW_BROWSER_HEADLESS) throw new Error('서버 Chromium 실행 설정 MEW_BROWSER_HEADLESS는 0 또는 1이어야 합니다.')
  return platform !== 'win32' && platform !== 'darwin' && !env.DISPLAY && !env.WAYLAND_DISPLAY
}

/** Separate on-disk profiles: source-site state never enters the Mew web origin. */
export async function acquireBrowserProfile(account: string, executablePath: string): Promise<{ context: BrowserContext; release: () => Promise<void> }> {
  let profile = profiles.get(account)
  if (profile?.closing) { await profile.closing; return acquireBrowserProfile(account, executablePath) }
  if (!profile) {
    const dir = path.join(DATA_DIR, 'browser', 'profiles', crypto.createHash('sha256').update(account).digest('hex'))
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    const browser = launchNativeBrowser(executablePath, dir, domBrowserHeadless())
    profile = { browser, users: 0 }
    profiles.set(account, profile)
    const created = profile
    void browser.then(({ context }) => {
      context.setDefaultTimeout(4000)
      context.once('close', () => {
        created.closing ??= browser.then((value) => value.close()).finally(() => { if (profiles.get(account) === created) profiles.delete(account) })
      })
    }, () => { if (profiles.get(account) === created) profiles.delete(account) })
  }
  profile.users++
  const current = profile
  const browser = await profile.browser
  const context = browser.context
  let released = false
  return { context, release: async () => {
    if (released) return
    released = true
    if (--current.users === 0) {
      current.closing = browser.close().finally(() => { if (profiles.get(account) === current) profiles.delete(account) })
      await current.closing
    }
  } }
}
