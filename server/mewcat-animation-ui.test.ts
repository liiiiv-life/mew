import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { mewpetUiFixture } from './mewpet-ui-fixture.ts'
import { MEWCAT_ALL_SPRITE_ACTIONS, MEWCAT_CYCLE_MS } from '../src/utils/mewcat-sprites.ts'

const root = path.resolve(import.meta.dirname, '..')

test('Mewpet previews and walking artwork animate; falling poses loop within a narrow tilt in both motion preferences', { skip: !domBrowserExecutable(), timeout: 90_000 }, async () => {
  const source = `
import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {Mewcat} from '${root}/src/components/Mewcat.tsx';
import {MewcatSprite} from '${root}/src/components/mewcat-sprite.tsx';
import {prepareSpriteStrip,readSpriteImage} from '${root}/src/utils/mewcat-sprite-storage.ts';
Object.defineProperty(document,'fullscreenEnabled',{value:false});
Math.random=()=>0.4;
async function start(){
 const catalog=await (await fetch('/api/mewpet/skins')).json();
 const skins=await Promise.all(catalog.skins.map(async skin=>({id:skin.id,sprites:Object.fromEntries(await Promise.all(Object.entries(skin.sprites).map(async([action,source])=>{
  const response=await fetch(source.url),image=await readSpriteImage(await response.blob(),source.frames);
  return [action,await prepareSpriteStrip(image)];
 })))})));
 function Fixture(){
  const [action,setAction]=useState('walk');
  window.setPreviewAction=setAction;
  return <><div id='previews' data-action={action} style={{display:'flex',gap:4}}>{skins.map(skin=><div key={skin.id} data-skin={skin.id} style={{width:48,height:48,background:'#fff'}}><MewcatSprite strip={skin.sprites[action]} action={action} playing/></div>)}</div>
   <div id='static' style={{width:48,height:48}}><MewcatSprite strip={skins[0].sprites.idle}/></div><Mewcat skin='capybara'/></>;
 }
 createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);
}
start();`
  const bundle = await build({ input: 'virtual:animation.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:animation.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:animation.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const petFiles = await mewpetUiFixture()
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const mobile of [false, true]) for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1000, height: 1400 }, hasTouch: mobile, reducedMotion })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.clock.install({ time: new Date('2026-10-09T00:00:00Z') })
      await page.clock.pauseAt(new Date('2026-10-09T00:00:01Z'))
      await page.route('http://animation.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>${compiler.build([])}</style><div id="root"></div><script>${chunk.code}</script>` }))
      await petFiles.route(page)
      await page.goto('http://animation.test/')
      const previews = page.locator('#previews .mewcat-sprite')
      await page.waitForFunction("document.querySelectorAll('#previews .mewcat-sprite[data-frame]').length === 1")
      const cat = page.locator('.mewcat'), walking = cat.locator('.mewcat-sprite')
      await walking.waitFor()
      const ids = await page.locator('#previews > [data-skin]').evaluateAll(elements => elements.map(el => el.getAttribute('data-skin')))
      assert.deepEqual(ids, ['capybara'])
      for (const action of MEWCAT_ALL_SPRITE_ACTIONS) {
        await page.evaluate(`window.setPreviewAction(${JSON.stringify(action)})`)
        await page.waitForFunction(`document.querySelector('#previews')?.getAttribute('data-action') === ${JSON.stringify(action)} && [...document.querySelectorAll('#previews .mewcat-sprite')].every(el => el.getAttribute('data-frame') === '0')`)
        assert.deepEqual(await previews.evaluateAll(elements => elements.map(el => el.getAttribute('data-frame'))), Array(ids.length).fill('0'))
        const before = action === 'walk' ? await Promise.all(ids.map(id => page.locator(`#previews > [data-skin="${id}"]`).screenshot())) : []
        const frames = petFiles.store.list().skins[0].sprites[action]!.frames
        await page.clock.runFor(MEWCAT_CYCLE_MS[action] / frames + 16)
        const states = await previews.evaluateAll(elements => elements.map(el => ({ frame: el.getAttribute('data-frame'), x: el.querySelector('image')?.getAttribute('x') })))
        assert.deepEqual(states, Array.from({ length: ids.length }, () => ({ frame: '1', x: '-128' })), `${mobile ? 'mobile' : 'desktop'}/${reducedMotion}/${action} advances the capybara strip`)
        if (action === 'fall') {
          const angles = await previews.first().evaluate(async el => {
            const image = el.ownerDocument.createElement('img')
            image.src = el.querySelector('image')!.getAttribute('href')!
            await image.decode()
            const canvas = el.ownerDocument.createElement('canvas')
            canvas.width = image.width; canvas.height = image.height
            const ctx = canvas.getContext('2d')!
            ctx.drawImage(image, 0, 0)
            return Array.from({ length: 8 }, (_, frame) => {
              const data = ctx.getImageData(frame * 128, 0, 128, 128).data
              let n = 0, sx = 0, sy = 0, xx = 0, xy = 0, yy = 0
              for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) if (data[(y * 128 + x) * 4 + 3] > 128) {
                n++; sx += x; sy += y; xx += x * x; xy += x * y; yy += y * y
              }
              return Math.atan2(2 * (xy / n - sx / n * sy / n), xx / n - (sx / n) ** 2 - (yy / n - (sy / n) ** 2)) / 2 * 180 / Math.PI
            })
          })
          assert.ok(angles.every(angle => angle >= 39.8 && angle <= 45.2), 'every airborne pose stays near 40–45 degrees')
          assert.ok(Math.abs(angles[7] - angles[0]) < 1.3, 'last-to-first poses have neighboring tilt angles')
          await page.clock.runFor(MEWCAT_CYCLE_MS.fall * 6 / frames)
          assert.equal(await previews.first().getAttribute('data-frame'), '7', 'descent reaches its final inclined pose')
          await page.clock.runFor(MEWCAT_CYCLE_MS.fall / frames)
          assert.equal(await previews.first().getAttribute('data-frame'), '0', 'descent loops into its neighboring inclined pose')
          await page.clock.runFor(MEWCAT_CYCLE_MS.fall / frames)
          assert.equal(await previews.first().getAttribute('data-frame'), '1', 'preview continues its gentle tilt after the loop boundary')
        }
        if (action === 'walk') for (const [index, id] of ids.entries()) {
          const after = await page.locator(`#previews > [data-skin="${id}"]`).screenshot()
          assert.notDeepEqual(after, before[index], `${id} walk changes visible pixels`)
        }
      }
      assert.equal(await cat.getAttribute('data-activity'), 'walk')
      const frame = await walking.getAttribute('data-frame')
      await page.clock.runFor(MEWCAT_CYCLE_MS.walk / 8 + 16)
      assert.notEqual(await walking.getAttribute('data-frame'), frame, 'walking pet advances its artwork as it moves')
      assert.equal(await page.locator('#static .mewcat-sprite').getAttribute('data-frame'), '0', 'selection thumbnails stay static')
      const grabPoint = await cat.evaluate(el => {
        const box = el.getBoundingClientRect()
        for (let y = 3; y < box.height - 3; y++) for (let x = 3; x < box.width - 3; x++) {
          const point = { x: box.x + x, y: box.y + y }
          if ([-2, 0, 2].every(dx => [-2, 0, 2].every(dy => el.ownerDocument.elementFromPoint(point.x + dx, point.y + dy)?.closest('.mewcat') === el))) return point
        }
        throw new Error('No painted grab point')
      })
      await page.mouse.move(grabPoint.x, grabPoint.y)
      await page.mouse.down()
      await page.mouse.move(grabPoint.x, 80)
      await page.clock.runFor(160)
      await page.mouse.up()
      assert.equal(await cat.getAttribute('data-activity'), 'fall')
      await page.clock.runFor(510)
      assert.equal(await walking.getAttribute('data-frame'), '7', 'falling pet reaches the last pose')
      await page.clock.runFor(70)
      assert.equal(await cat.getAttribute('data-activity'), 'fall')
      assert.equal(await walking.getAttribute('data-frame'), '0', 'falling pet loops into its neighboring inclined pose')
      await page.clock.runFor(70)
      assert.equal(await walking.getAttribute('data-frame'), '1', 'falling pet continues through neighboring inclined poses')
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close(); await petFiles.close() }
})
