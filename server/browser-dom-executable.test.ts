import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('macOS discovers user Chrome apps with spaces and preserves explicit/bundled priority', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mew browser mac-'))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  const chrome = path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  const bundledExecutable = path.join(home, 'playwright/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
  const options = { env: {}, platform: 'darwin' as const, home, bundledExecutable }
  const executable = async (file: string) => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  }
  await executable(chrome)
  assert.equal(domBrowserExecutable(options), chrome)
  await executable(bundledExecutable)
  assert.equal(domBrowserExecutable(options), bundledExecutable)
  assert.equal(domBrowserExecutable({ ...options, env: { MEW_BROWSER_EXECUTABLE: chrome } }), chrome)
  // A stale/incomplete bundled installation must not mask an installed system app.
  await fs.chmod(bundledExecutable, 0o600)
  assert.equal(domBrowserExecutable(options), chrome)
  await fs.rm(bundledExecutable)
  await fs.mkdir(bundledExecutable)
  assert.equal(domBrowserExecutable(options), chrome)
  for (const explicit of [path.join(home, 'missing'), path.join(home, 'Applications/Google Chrome.app'), './chrome']) {
    assert.throws(() => domBrowserExecutable({ ...options, env: { MEW_BROWSER_EXECUTABLE: explicit } }), /MEW_BROWSER_EXECUTABLE/)
  }
})

test('macOS discovers user Chromium when Chrome is unavailable', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-chromium-mac-'))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  const executable = path.join(home, 'Applications/Chromium.app/Contents/MacOS/Chromium')
  await fs.mkdir(path.dirname(executable), { recursive: true })
  await fs.writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  // Isolate automatic discovery from any Chrome installed on the test runner.
  const syncFs = (await import('node:fs')).default
  const originalStat = syncFs.statSync
  t.mock.method(syncFs, 'statSync', (file: string) => {
    if (file.startsWith('/Applications/')) throw new Error('not installed')
    return originalStat(file)
  })
  assert.equal(domBrowserExecutable({ env: {}, platform: 'darwin', home, bundledExecutable: path.join(home, 'missing') }), executable)
})
