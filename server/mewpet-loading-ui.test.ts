import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import { compile } from '@tailwindcss/node'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { mewpetUiFixture } from './mewpet-ui-fixture.ts'

const root = path.resolve(import.meta.dirname, '..')
type Snapshot = { loading: boolean; failed: boolean; ids: string[] }

test('selected pet renders while other skins are pending; downloads are bounded and failed refresh preserves it', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `
import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {Mewcat} from '${root}/src/components/Mewcat.tsx';
import {saveMewcatSkin} from '${root}/src/utils/mewcatSkin.ts';
import {spriteStore,loadSpriteSkins} from '${root}/src/utils/mewcat-sprite-storage.ts';
import {publishMewcatNotice} from '${root}/src/utils/mewcat-notifications.ts';
import {scopedBrowserStorage} from '${root}/packages/ui/src/browser-storage-scope.ts';
Object.defineProperty(document,'fullscreenEnabled',{value:false});
Math.random=()=>0.4;
saveMewcatSkin('capybara');
scopedBrowserStorage().setItem('mew:locale','ko');
window.notifyPet=(key='loading')=>publishMewcatNotice({key,kind:'permission',level:'warning',source:key==='loading'?'Loading notice':'New notice'});
window.petSnapshot=()=>{const s=spriteStore().snapshot;return {loading:s.loading,failed:s.failed,ids:s.skins.map(s=>s.id)}};
window.refreshPets=()=>loadSpriteSkins(true);
createRoot(document.getElementById('root')).render(<I18nProvider><Mewcat skin="capybara"/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:pet-loading.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:pet-loading.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:pet-loading.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const toastSource = await fs.readFile(`${root}/packages/ui/src/Toast.tsx`, 'utf8')
  const css = compiler.build(toastSource.match(/[A-Za-z0-9_:[\]/.%!#()-]+/g) ?? [])
  const files = await mewpetUiFixture()
  const sprites = Object.fromEntries(Object.keys(files.store.list().skins[0].sprites).map(action => {
    const image = files.store.image('capybara', action as Parameters<typeof files.store.image>[1])
    return [action, { bytes: image.bytes, frames: image.frames }]
  }))
  for (let index = 0; index < 4; index++) files.store.save(`loading-pet-${index}`, `Loading pet ${index}`, sprites)
  const catalog = files.store.list()
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const mobile of [false, true]) {
      const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1000, height: 700 }, hasTouch: mobile, isMobile: mobile })
      page.setDefaultTimeout(6000)
      let releaseOthers = () => {}
      const others = new Promise<void>(resolve => { releaseOthers = resolve })
      let releaseCatalog = () => {}
      const catalogGate = new Promise<void>(resolve => { releaseCatalog = resolve })
      let active = 0, peak = 0, blocked = 0, selectedRequests = 0, failSelected = false
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.clock.install({ time: new Date('2026-10-08T00:00:00Z') })
      await page.clock.pauseAt(new Date('2026-10-08T00:00:01Z'))
      await page.route('http://pet-loading.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="${mobile ? '' : 'dark'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{background:var(--color-surface)}</style><div id="root"></div><script>${chunk.code}</script></html>` }))
      await page.route('**/api/mewpet/skins**', async route => {
        const url = new URL(route.request().url())
        if (url.pathname === '/api/mewpet/skins') { await catalogGate; return route.fulfill({ json: { ...catalog, canManage: false } }) }
        const [, id, action] = url.pathname.match(/^\/api\/mewpet\/skins\/([^/]+)\/([^/]+)$/)!
        if (id !== 'capybara') { blocked++; await others }
        active++; peak = Math.max(peak, active)
        try {
          if (id === 'capybara') {
            selectedRequests++
            await new Promise(resolve => setTimeout(resolve, 60))
            if (failSelected) return await route.fulfill({ status: 503 })
          }
          const image = files.store.image(id, action as Parameters<typeof files.store.image>[1])
          await route.fulfill({ contentType: image.mime, body: image.bytes })
        } finally { active-- }
      })
      try {
        await page.goto('http://pet-loading.test/', { waitUntil: 'domcontentloaded', timeout: 6000 })
        const cat = page.locator('.mewcat')
        await cat.waitFor({ state: 'attached' })
        assert.equal(await cat.isVisible(), false, 'pet stays hidden until its skin is ready')
        assert.equal(await cat.getAttribute('tabindex'), null)
        assert.equal(await page.locator('.mewcat-placeholder, .mewcat-loading-caption').count(), 0)
        assert.equal(selectedRequests, 0)
        await page.evaluate('window.notifyPet()')
        const toast = page.getByRole('status')
        await toast.getByText('Loading notice', { exact: false }).waitFor()
        assert.equal(await page.locator('.mewcat-notifications').count(), 0, 'notifications do not create a speech bubble')
        await page.clock.runFor(200)
        assert.equal(await cat.isVisible(), false)
        await page.screenshot({ path: `/tmp/mewpet-loading-${mobile ? 'mobile-light' : 'desktop-dark'}.png` })
        await page.clock.runFor(1800)
        await page.evaluate("window.notifyPet('next')")
        await toast.getByText('New notice', { exact: false }).waitFor()
        await page.clock.runFor(700)
        assert.equal(await toast.count(), 1, 'new notice restarts the toast duration')
        await page.clock.runFor(2000)
        assert.equal(await toast.count(), 0, 'toast disappears without dismissing the unread notice')
        releaseCatalog()
        await page.locator('.mewcat-sprite').waitFor({ timeout: 6000 })
        assert.equal(await cat.locator('.mewcat-placeholder').count(), 0)
        assert.equal(await page.getByText('뮤펫 로드중..', { exact: true }).count(), 0)
        const loaded = (await cat.boundingBox())!
        assert.equal(await cat.isVisible(), true, 'ready pet is visible and interactive')
        await page.mouse.move(loaded.x + 26, loaded.y + 31)
        await page.mouse.down()
        await page.mouse.move(loaded.x + 46, loaded.y - 69)
        assert.equal(await cat.getAttribute('data-activity'), 'struggle', 'loaded pet can be dragged')
        await page.clock.runFor(500)
        await page.mouse.up()
        const snapshot = await page.evaluate<Snapshot>('window.petSnapshot()')
        assert.deepEqual(snapshot.ids, ['capybara'], 'selected pet appears before any other skin finishes')
        assert.equal(snapshot.loading, true)
        assert.equal(selectedRequests, 16)
        assert.equal(peak, 4, 'four images are downloaded concurrently')
        releaseOthers()
        await page.evaluate('window.refreshPets()')
        assert.ok(blocked > 0)
        assert.equal(peak, 4, 'the catalog does not launch all 80 requests at once')
        assert.deepEqual((await page.evaluate<Snapshot>('window.petSnapshot()')).ids, catalog.skins.map(skin => skin.id), 'final catalog retains its server order')
        const image = await page.locator('.mewcat-sprite').getAttribute('data-source')
        failSelected = true
        catalog.skins.find(skin => skin.id === 'capybara')!.revision += '-refresh'
        await page.evaluate('window.refreshPets()')
        assert.equal((await page.evaluate<Snapshot>('window.petSnapshot()')).failed, true)
        assert.equal(await page.locator('.mewcat-sprite').getAttribute('data-source'), image, 'failed replacement keeps the displayed sprite')
        assert.deepEqual(errors, [])
      } finally { releaseCatalog(); releaseOthers(); await page.close() }
    }
  } finally { await browser.close(); await files.close() }
})
