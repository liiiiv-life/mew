import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { launchBrowserDisplay, usesVirtualBrowserDisplay } from './browser-dom-display.ts'
import { launchNativeBrowser } from './browser-dom-process.ts'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('only Linux headed profiles use a virtual display unless desktop is explicit', () => {
  assert.equal(usesVirtualBrowserDisplay(false, {}, 'linux'), true)
  assert.equal(usesVirtualBrowserDisplay(false, { MEW_BROWSER_DISPLAY: 'desktop' }, 'linux'), false)
  assert.equal(usesVirtualBrowserDisplay(true, {}, 'linux'), false)
  for (const platform of ['darwin', 'win32'] as const) assert.equal(usesVirtualBrowserDisplay(false, {}, platform), false)
  assert.throws(() => usesVirtualBrowserDisplay(false, { MEW_BROWSER_DISPLAY: 'typo' }, 'linux'), /virtual 또는 desktop/)
})

const hasDisplay = process.platform === 'linux' && spawnSync('Xvfb', ['-help'], { stdio: 'ignore' }).status === 0

test('virtual displays have separate numbers, private credentials and idempotent cleanup', { skip: !hasDisplay, timeout: 20_000 }, async (t) => {
  const first = await launchBrowserDisplay()
  t.after(first.close)
  const second = await launchBrowserDisplay()
  t.after(second.close)
  assert.notEqual(first.env.DISPLAY, second.env.DISPLAY)
  assert.notEqual(first.env.DISPLAY, process.env.DISPLAY)
  assert.notEqual(first.env.XAUTHORITY, second.env.XAUTHORITY)
  assert.equal(first.env.WAYLAND_DISPLAY, undefined)
  assert.equal(fs.statSync(first.env.XAUTHORITY!).mode & 0o777, 0o600)
  assert.equal(fs.statSync(path.dirname(first.env.XAUTHORITY!)).mode & 0o777, 0o700)
  await first.close()
  await first.close()
  await first.exited
  assert.equal(fs.existsSync(first.env.XAUTHORITY!), false)
})

test('headed Chromium runs and opens native popups on its private display', {
  skip: !hasDisplay || !domBrowserExecutable() || process.env.MEW_BROWSER_DISPLAY === 'desktop', timeout: 30_000,
}, async (t) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-display-profile-'))
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }))
  const native = await launchNativeBrowser(domBrowserExecutable()!, profile, false)
  t.after(native.close)
  assert.equal(native.context.pages().length, 0)
  const page = await native.context.newPage()
  assert.equal(await page.evaluate('navigator.webdriver'), false)
  await page.setContent('<input aria-label="Name"><button onclick="window.open(\'about:blank\', \'_blank\', \'width=400,height=300\')">Open</button>')
  await page.getByRole('textbox', { name: 'Name' }).fill('background input')
  assert.equal(await page.getByRole('textbox', { name: 'Name' }).inputValue(), 'background input')
  const popupOpened = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Open' }).click()
  const popup = await popupOpened
  assert.equal(await popup.opener(), page)
  await popup.setContent('<p>Background popup</p>')
  assert.equal(await popup.locator('p').textContent(), 'Background popup')
  await native.close()
})
