import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

function isExecutable(file: string): boolean {
  try {
    if (!fs.statSync(file).isFile()) return false
    fs.accessSync(file, fs.constants.X_OK)
    return true
  } catch { return false }
}

/** Resolve for the server OS/user, including macOS apps installed only for that user. */
export function domBrowserExecutable({
  env = process.env, platform = process.platform, home = os.homedir(), bundledExecutable = chromium.executablePath(),
}: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; home?: string; bundledExecutable?: string } = {}): string | undefined {
  const explicit = env.MEW_BROWSER_EXECUTABLE
  if (explicit) {
    if (!path.isAbsolute(explicit) || !isExecutable(explicit)) {
      throw new Error('서버 Chromium 실행 설정 MEW_BROWSER_EXECUTABLE에는 실행 가능한 파일의 절대 경로가 필요합니다. macOS에서는 .app 폴더 안의 Contents/MacOS 실행 파일을 지정해 주세요.')
    }
    return explicit
  }
  const system = platform === 'darwin'
    ? ['Google Chrome', 'Chromium'].flatMap((name) => [
      path.join(home, 'Applications', `${name}.app`, 'Contents', 'MacOS', name),
      path.join('/Applications', `${name}.app`, 'Contents', 'MacOS', name),
    ])
    : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
  // Playwright chooses the bundled executable for the host OS and architecture.
  // Keep that tested binary first; launching app bundle internals needs no shell/open -a.
  return [bundledExecutable, ...system].find(isExecutable)
}
