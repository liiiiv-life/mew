import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('dock settings apply visibility, order, reset, persistence and responsive themes', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {SettingsModal} from '${root}/src/components/SettingsModal.tsx';
import {MobileDock} from '${root}/src/components/mobile-dock.tsx';
const available=['sidebar','editor','agent','terminal','git','features','memo','tasks'];
function Fixture(){return <><MobileDock active="editor" available={available} hidden={false} onSelect={()=>{}} onNavigate={()=>{}}/><SettingsModal email={null} displayName={null} avatarDataUrl={null} canEditIgnore={false} theme="dark" fontPreferences={{ui:'Arial',markdown:'Arial',mono:'monospace'}} themeColor="#9082da" mewcatSkin={null} mewcatHideDesktop={false} dockAvailable={available} onClose={()=>{}} onLoggedOut={()=>{}} onProfileChanged={()=>{}} onToggleTheme={()=>{}} onFontPreferencesChange={()=>{}} onThemeColorChange={()=>{}} onMewcatSkinChange={()=>{}} onMewcatHideDesktopChange={()=>{}}/></>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:dock.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', async resolveId(id, importer) {
    if (id === 'virtual:dock.tsx') return id
    if (id.endsWith('.css')) return 'virtual:style'
    if (id.endsWith('?raw')) {
      const resolved = await this.resolve(id.slice(0, -4), importer, { skipSelf: true })
      if (resolved) return `${resolved.id}?raw`
    }
  }, async load(id) {
    if (id.endsWith('?raw')) return `export default ${JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))}`
    if (id === 'virtual:dock.tsx') return source
    if (id === 'virtual:style') return ''
  } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const content = (await Promise.all(['src/components/mobile-dock.tsx', 'src/components/dock-settings-panel.tsx', 'src/components/SettingsModal.tsx', 'packages/ui/src/HoverTipLayer.tsx'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
    page.setDefaultTimeout(3000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript("localStorage.setItem('mew:locale','en')")
    await page.route('http://mew-dock-settings.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${chunk.code}</script></html>` }))
    await page.goto('http://mew-dock-settings.test/')
    await page.getByRole('button', { name: 'Bottom dock', exact: true }).click()
    const panel = page.locator('[data-dock-settings]')
    const dock = page.getByRole('navigation', { name: 'Workspace dock' })
    const ids = () => dock.locator('[data-dock-item]').evaluateAll(elements => elements.map(el => el.getAttribute('data-dock-item')))
    const toggle = panel.getByRole('switch', { name: 'Agent', exact: true })
    await toggle.uncheck()
    assert.equal((await ids()).includes('agent'), false)
    assert.equal(await panel.locator('[data-dock-preview=agent]').count(), 0)
    assert.equal(await page.evaluate(() => localStorage.getItem('mew:mobile-dock-hidden')), '["agent"]')
    await panel.locator('[data-dock-setting=git]').getByRole('button').first().click()
    assert.deepEqual((await ids()).slice(0, 4), ['sidebar', 'editor', 'git', 'terminal'])
    await page.reload()
    await page.getByRole('button', { name: 'Bottom dock', exact: true }).click()
    assert.equal(await toggle.isChecked(), false)
    assert.deepEqual((await ids()).slice(0, 4), ['sidebar', 'editor', 'git', 'terminal'])
    await panel.getByRole('button', { name: 'Reset', exact: true }).click()
    assert.equal(await toggle.isChecked(), true)
    for (const theme of ['dark', 'light']) {
      await page.locator('html').evaluate((el, theme) => el.className = theme, theme)
      for (const width of [1100, 390, 320]) {
        await page.setViewportSize({ width, height: 850 })
        assert.ok(await panel.isVisible())
        assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth))
        assert.ok(await page.locator('html').evaluate(el => el.scrollWidth <= el.clientWidth))
        await page.screenshot({ path: `/tmp/mew-dock-settings-${theme}-${width}.png` })
      }
    }
    for (const input of await panel.getByRole('switch').all()) await input.uncheck()
    assert.equal(await dock.count(), 0)
    await panel.getByText('No items shown in the dock').waitFor()
    await panel.getByRole('button', { name: 'Reset', exact: true }).click()
    await dock.waitFor()
    await toggle.focus()
    await page.keyboard.press('Space')
    assert.equal(await toggle.isChecked(), false)
    await page.locator('html').evaluate(el => {
      const view = el.ownerDocument.defaultView!
      view.localStorage.setItem('mew:mobile-dock-hidden', '["git"]')
      view.dispatchEvent(new view.StorageEvent('storage', { key: 'mew:mobile-dock-hidden' }))
    })
    assert.equal(await toggle.isChecked(), true)
    assert.equal((await ids()).includes('git'), false)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
