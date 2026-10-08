import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Locator, type Page } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { MEWCAT_ALL_SPRITE_ACTIONS, MEWCAT_TRANSITION_ACTIONS } from '../src/utils/mewcat-sprites.ts'

const root = path.resolve(import.meta.dirname, '..')
async function advanceTo(page: Page, cat: Locator, attribute: string, value: string, timeout = 6000) {
  for (let elapsed = 0; elapsed <= timeout; elapsed += 32) {
    if (await cat.getAttribute(attribute) === value) return
    await page.clock.runFor(32)
  }
  assert.fail(`Expected ${attribute}=${value}, found ${await cat.getAttribute(attribute)}`)
}
async function grabPoint(cat: Locator) {
  return cat.evaluate(el => {
    const box = el.getBoundingClientRect()
    for (let y = 16; y < 44; y += 2) for (let x = 16; x < 36; x += 2) {
      const point = { x: box.x + x, y: box.y + y }
      if ([-2, 0, 2].every(dx => [-2, 0, 2].every(dy => el.ownerDocument.elementFromPoint(point.x + dx, point.y + dy)?.closest('.mewcat') === el))) return point
    }
    throw new Error('No painted grab point')
  })
}

test('all builtins play nine transitions and autonomous jumps; missing transitions and reduced motion remain usable', { skip: !domBrowserExecutable(), timeout: 120_000 }, async () => {
  const source = `
import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {Mewcat} from '${root}/src/components/Mewcat.tsx';
Object.defineProperty(document,'fullscreenEnabled',{value:false});
window.roamRandom=0.4; Math.random=()=>window.roamRandom;
createRoot(document.getElementById('root')).render(<I18nProvider><Mewcat skin={new URLSearchParams(location.search).get('skin')||'mew'}/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:transitions.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:transitions.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:transitions.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const definitions = [['mew', 'silhouette'], ['kitten', 'kitten'], ['russian-blue', 'russian-blue'], ['korean-shorthair', 'korean-shorthair'], ['capybara', 'capybara']] as const
  const catalog = { failed: false, skins: await Promise.all(definitions.map(async ([id, folder]) => ({ id, name: id, revision: 'test', managed: false, sprites: Object.fromEntries(await Promise.all(MEWCAT_ALL_SPRITE_ACTIONS.map(async action => {
    const image = await fs.readFile(`${root}/public/mewcat/${folder}/${action}.png`)
    return [action, { width: image.readUInt32BE(16), height: image.readUInt32BE(20), frames: 8, url: `/api/mewpet/skins/${id}/${action}?v=test` }]
  }))) }))) }
  const routeSprites = async (page: Page, missing = false) => {
    await page.route('**/api/mewpet/skins**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/mewpet/skins') {
        const skins = catalog.skins.map(skin => ({ ...skin, sprites: Object.fromEntries(Object.entries(skin.sprites).filter(([action]) => !missing || !MEWCAT_TRANSITION_ACTIONS.some(transition => transition === action))) }))
        return route.fulfill({ json: { skins, failed: false, canManage: false } })
      }
      const [, id, action] = url.pathname.match(/^\/api\/mewpet\/skins\/([^/]+)\/([^/]+)$/) ?? []
      const folder = definitions.find(([candidate]) => candidate === id)?.[1]
      assert.ok(folder && MEWCAT_ALL_SPRITE_ACTIONS.some(candidate => candidate === action))
      return route.fulfill({ contentType: 'image/png', body: await fs.readFile(`${root}/public/mewcat/${folder}/${action}.png`) })
    })
    await page.route('**/mewcat/**', async route => {
      const url = new URL(route.request().url())
      const action = path.basename(url.pathname, '.png')
      if (missing && MEWCAT_TRANSITION_ACTIONS.some(transition => transition === action)) return route.fulfill({ status: 404 })
      await route.fulfill({ contentType: 'image/png', body: await fs.readFile(`${root}/public${url.pathname}`) })
    })
  }
  assert.equal(catalog.failed, false)
  assert.equal(catalog.skins.length, 5)
  for (const skin of catalog.skins) for (const action of MEWCAT_TRANSITION_ACTIONS) {
    assert.equal(skin.sprites[action]?.width, 1024)
    assert.equal(skin.sprites[action]?.height, 128)
    assert.equal(skin.sprites[action]?.frames, 8)
  }
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const mobile of [false, true]) for (const skin of catalog.skins) {
      const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1000, height: 700 }, hasTouch: mobile, isMobile: mobile })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.clock.install({ time: new Date('2026-10-08T00:00:00Z') })
      await page.clock.pauseAt(new Date('2026-10-08T00:00:01Z'))
      await page.route('http://transitions.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="${mobile ? '' : 'dark'}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${compiler.build([])}</style><div id="root"></div><script>${chunk.code}</script></html>` }))
      await routeSprites(page)
      await page.goto(`http://transitions.test/?skin=${skin.id}`)
      const cat = page.locator('.mewcat'), sprite = cat.locator('.mewcat-sprite')
      await sprite.waitFor()
      for (const [random, transition] of [[0.7, 'walk-run'], [0.4, 'run-walk'], [0, 'walk-idle'], [0.4, 'idle-walk'], [0.7, 'walk-run'], [0, 'run-idle'], [0.7, 'idle-run']] as const) {
        await page.evaluate(`window.roamRandom=${random}`)
        await advanceTo(page, cat, 'data-transition', transition)
        const strip = await sprite.getAttribute('data-source')
        await page.clock.runFor(64)
        assert.equal(await cat.getAttribute('data-transition'), transition)
        assert.ok(Number(await sprite.getAttribute('data-frame')) > 0, `${skin.id}: transition advances`)
        await page.clock.runFor(300)
        assert.equal(await cat.getAttribute('data-transition'), null)
        assert.notEqual(await sprite.getAttribute('data-source'), strip, `${skin.id}: transition completes into the target strip`)
      }
      await page.evaluate('window.roamRandom=0.95')
      await advanceTo(page, cat, 'data-activity', 'takeoff')
      assert.equal(await cat.getAttribute('data-transition'), 'takeoff')
      const ground = (await cat.boundingBox())!
      await page.clock.runFor(96)
      assert.ok(Math.abs((await cat.boundingBox())!.y - ground.y) < 1, 'anticipation stays grounded')
      await advanceTo(page, cat, 'data-activity', 'jump')
      await page.evaluate('window.roamRandom=0')
      await page.clock.runFor(96)
      assert.ok((await cat.boundingBox())!.y < ground.y - 20, 'autonomous jump rises under the same physics as a throw')
      await advanceTo(page, cat, 'data-transition', 'apex', 1500)
      assert.equal(await cat.getAttribute('data-activity'), 'fall')
      const atApex = (await cat.boundingBox())!
      await page.clock.runFor(64)
      assert.ok((await cat.boundingBox())!.y > atApex.y, 'gravity continues during the apex transition')
      await advanceTo(page, cat, 'data-transition', 'landing', 1500)
      assert.equal(await cat.getAttribute('data-activity'), 'land')
      assert.ok(Math.abs((await cat.boundingBox())!.y + 48 - 700) < 2, 'landing reaches the viewport floor')
      await page.clock.runFor(300)
      assert.equal(await cat.getAttribute('data-transition'), null)
      assert.equal(await cat.getAttribute('data-activity'), 'idle')

      await page.evaluate('window.roamRandom=0.95')
      await advanceTo(page, cat, 'data-activity', 'takeoff')
      const point = await grabPoint(cat)
      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
      assert.equal(await cat.getAttribute('data-transition'), null, 'grabbing cancels anticipation immediately')
      await page.clock.runFor(500)
      assert.equal(await cat.getAttribute('data-activity'), 'idle', 'a held pet does not launch on its own')
      await page.mouse.move(point.x - 30, point.y - 80)
      await page.mouse.up()
      assert.equal(await cat.getAttribute('data-activity'), 'jump')
      assert.equal(await cat.getAttribute('data-transition'), null, 'throwing launches directly without grounded anticipation')
      assert.match(await cat.getAttribute('style') ?? '', /scaleX\(-1\)/, 'throw direction remains authoritative')
      assert.deepEqual(errors, [])
      await page.close()
    }
    for (const mode of ['missing', 'reduce'] as const) {
      const page = await browser.newPage({ viewport: { width: 800, height: 700 }, reducedMotion: mode === 'reduce' ? 'reduce' : 'no-preference' })
      await page.clock.install({ time: new Date('2026-10-08T00:00:00Z') })
      await page.clock.pauseAt(new Date('2026-10-08T00:00:01Z'))
      await page.route('http://transitions.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>${compiler.build([])}</style><div id="root"></div><script>${chunk.code}</script>` }))
      await routeSprites(page, mode === 'missing')
      await page.goto('http://transitions.test/')
      const cat = page.locator('.mewcat')
      await cat.locator('.mewcat-sprite').waitFor()
      await page.evaluate('window.roamRandom=0.95')
      await advanceTo(page, cat, 'data-activity', mode === 'missing' ? 'jump' : 'run')
      assert.equal(await cat.getAttribute('data-transition'), null)
      if (mode === 'missing') {
        await page.evaluate('window.roamRandom=0')
        await advanceTo(page, cat, 'data-activity', 'fall')
        assert.equal(await cat.getAttribute('data-transition'), null)
        await advanceTo(page, cat, 'data-activity', 'land')
        assert.ok(Number(await cat.locator('.mewcat-sprite').getAttribute('data-frame')) >= 4, 'absent landing uses the second half of the required fall strip')
      } else {
        await page.clock.runFor(6000)
        assert.equal(await cat.getAttribute('data-activity'), 'run', 'reduced motion skips autonomous jumps')
        assert.equal(await cat.locator('.mewcat-sprite').getAttribute('data-frame'), '0')
      }
      await page.close()
    }
  } finally { await browser.close() }
})
