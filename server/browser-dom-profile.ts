import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { chromium, type BrowserContext } from 'playwright-core'
import { DATA_DIR } from './dataDir.ts'

type Profile = { context: Promise<BrowserContext>; users: number; closing?: Promise<void> }
const profiles = new Map<string, Profile>()

/** Separate on-disk profiles: source-site state never enters the Mew web origin. */
export async function acquireBrowserProfile(account: string, executablePath: string): Promise<{ context: BrowserContext; release: () => Promise<void> }> {
  let profile = profiles.get(account)
  if (profile?.closing) { await profile.closing; return acquireBrowserProfile(account, executablePath) }
  if (!profile) {
    const dir = path.join(DATA_DIR, 'browser', 'profiles', crypto.createHash('sha256').update(account).digest('hex'))
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    const context = chromium.launchPersistentContext(dir, {
      executablePath, headless: true, chromiumSandbox: true,
      viewport: { width: 900, height: 700 }, serviceWorkers: 'allow', acceptDownloads: true,
    })
    profile = { context, users: 0 }
    profiles.set(account, profile)
    const created = profile
    void context.then((value) => {
      value.setDefaultTimeout(4000)
      value.once('close', () => { if (profiles.get(account) === created) profiles.delete(account) })
    }, () => { if (profiles.get(account) === created) profiles.delete(account) })
  }
  profile.users++
  const current = profile
  const context = await profile.context
  let released = false
  return { context, release: async () => {
    if (released) return
    released = true
    if (--current.users === 0) {
      current.closing = context.close().catch(() => {}).finally(() => { if (profiles.get(account) === current) profiles.delete(account) })
      await current.closing
    }
  } }
}
