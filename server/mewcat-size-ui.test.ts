import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Page } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

async function expectSize(page: Page, size: number) {
  await page.waitForFunction(`document.querySelector('.mewcat')?.style.width === '${size}px'`)
  const box = (await page.locator('.mewcat').boundingBox())!
  assert.ok(Math.abs(box.width - size) < 0.01 && Math.abs(box.height - size) < 0.01)
}

async function expectFloor(page: Page) {
  const feet = await page.locator('.mewcat .mewcat-sprite-hit').evaluate(path => {
    const view = path.ownerDocument.defaultView!
    const box = path.getBBox()
    const bottom = new view.DOMPoint(box.x, box.y + box.height).matrixTransform(path.getScreenCTM()!).y
    return { bottom, floor: (view.visualViewport?.offsetTop ?? 0) + (view.visualViewport?.height ?? view.innerHeight) }
  })
  assert.ok(Math.abs(feet.bottom - feet.floor) < 1, `feet ${feet.bottom} should meet floor ${feet.floor}`)
}

async function changeRange(page: Page, size: number) {
  await page.getByRole('slider').evaluate((input, next) => {
    const view = input.ownerDocument.defaultView!
    Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')!.set!.call(input, String(next))
    input.dispatchEvent(new view.Event('input', { bubbles: true }))
  }, size)
  await expectSize(page, size)
}

test('Mewcat size settings apply live, preserve dragging and floor bounds, and persist per browser scope', { skip: !domBrowserExecutable(), timeout: 90_000 }, async () => {
  const source = `
import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {I18nProvider,useI18n} from '${root}/src/i18n.tsx';
import {Mewcat} from '${root}/src/components/Mewcat.tsx';
import {SettingsModal} from '${root}/src/components/SettingsModal.tsx';
import {loadFontPreferences} from '${root}/src/utils/fontPreferences.ts';
import {loadMewcatSkin,saveMewcatSkin} from '${root}/src/utils/mewcatSkin.ts';
import {setMewcatSize} from '${root}/src/utils/mewcat-size-preferences.ts';
import {setBrowserStorageScope,scopedBrowserStorage} from '${root}/packages/ui/src/browser-storage-scope.ts';
Object.defineProperty(document,'fullscreenEnabled',{value:false});
Math.random=()=>0;
setBrowserStorageScope('size-test',new URLSearchParams(location.search).get('scope')||'one');
scopedBrowserStorage().setItem('mew:locale','ko');
window.setMewcatSize=setMewcatSize;
window.sizeStorage=scopedBrowserStorage();
const write=Storage.prototype.setItem;
Storage.prototype.setItem=function(key,value){if(window.blockSizeWrites&&key.endsWith('mew:mewcat-size'))throw new DOMException('Blocked','QuotaExceededError');return write.call(this,key,value)};
function Fixture(){
 const [skin,setSkin]=useState(loadMewcatSkin),[open,setOpen]=useState(true);
 const {setLocale}=useI18n();window.changeLanguage=setLocale;
 const change=value=>{saveMewcatSkin(value);setSkin(value)};
 return <><button id="settings" onClick={()=>setOpen(true)}>Settings</button>
 <nav style={{position:'fixed',bottom:0,height:48,width:'100%',background:'var(--color-surface-raised)'}}>Dock</nav>
 <Mewcat skin={skin} portalTarget={new URLSearchParams(location.search).has('portal')?document.getElementById('viewer'):null}/>
 {open&&<SettingsModal email={null} displayName={null} avatarDataUrl={null} canEditIgnore={false} theme="dark" themeColor="#4432a8" fontPreferences={loadFontPreferences()} mewcatSkin={skin} mewcatHideDesktop={false} onMewcatSkinChange={change} onMewcatHideDesktopChange={()=>{}} onFontPreferencesChange={()=>{}} onThemeColorChange={()=>{}} onToggleTheme={()=>{}} onClose={()=>setOpen(false)} onLoggedOut={()=>{}} onProfileChanged={()=>{}}/>}</>
}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:size.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:size.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:size.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const files = ['src/components/SettingsModal.tsx', 'src/components/mewcat-skin-settings.tsx', 'src/components/mewcat-size-settings.tsx', 'src/components/mewcat-break.tsx', 'packages/ui/src/color-picker.tsx']
  const content = (await Promise.all(files.map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build(content.match(/[A-Za-z0-9_@:/.[\]()%,-]+/g) ?? [])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1280, height: mobile ? 844 : 800 }, hasTouch: mobile })
      const errors: string[] = []
      context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
      await context.route('http://mewcat-size.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html ${mobile ? '' : 'class="dark"'}><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><div id="viewer"></div><script>${chunk.code}</script></html>` }))
      await context.route('**/api/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }))
      await context.route('**/mewcat/**', async route => route.fulfill({ contentType: 'image/png', body: await fs.readFile(`${root}/public${new URL(route.request().url()).pathname}`) }))
      const page = await context.newPage()
      page.setDefaultTimeout(5000)
      await page.clock.install()
      await page.goto('http://mewcat-size.test/')
      const openMewcat = async () => {
        await page.getByRole('dialog').getByRole('button', { name: '뮤캣', exact: true }).click()
        await page.getByRole('slider', { name: '기본 크기' }).waitFor()
      }
      await openMewcat()
      await page.locator('.mewcat .mewcat-sprite').waitFor()
      await expectSize(page, 48)
      const slider = page.getByRole('slider', { name: '기본 크기' })
      const reset = slider.locator('..').getByRole('button', { name: '초기화' })
      assert.equal(await slider.inputValue(), '48')
      assert.equal(await reset.isDisabled(), true)
      await slider.focus()
      await page.keyboard.press('End')
      await expectSize(page, 144)
      await expectFloor(page)
      await page.keyboard.press('Home')
      await expectSize(page, 24)
      await expectFloor(page)
      await page.keyboard.press('ArrowRight')
      await expectSize(page, 25)
      if (mobile) {
        const track = (await slider.boundingBox())!
        await page.touchscreen.tap(track.x + track.width * 0.6, track.y + track.height / 2)
        assert.ok(Number(await slider.inputValue()) > 48, 'touch can adjust the size')
      }
      await changeRange(page, 96)
      assert.equal(await reset.isEnabled(), true)
      await expectFloor(page)
      await page.screenshot({ path: `/tmp/mewcat-size-${mobile ? 'mobile-light' : 'desktop-dark'}.png` })
      assert.equal(await slider.evaluate(input => input.ownerDocument.documentElement.scrollWidth > input.ownerDocument.defaultView!.innerWidth), false)
      await page.keyboard.press('Escape')
      const before = (await page.locator('.mewcat').boundingBox())!
      const pointer = { x: before.x + before.width / 2 + 20, y: before.y + before.height * .72 - 120 }
      const cdp = await context.newCDPSession(page)
      const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] })
      if (mobile) {
        await touch('touchStart', pointer.x - 20, pointer.y + 120)
        await touch('touchMove', pointer.x, pointer.y)
      } else {
        await page.mouse.move(pointer.x - 20, pointer.y + 120)
        await page.mouse.down()
        await page.mouse.move(pointer.x, pointer.y)
      }
      assert.equal(await page.locator('.mewcat').getAttribute('data-activity'), 'struggle')
      await page.evaluate('window.setMewcatSize(72)')
      await expectSize(page, 72)
      await page.clock.runFor(600)
      const held = (await page.locator('.mewcat').boundingBox())!
      assert.equal(await page.locator('.mewcat').getAttribute('data-activity'), 'struggle')
      assert.ok(Math.abs(held.x + held.width / 2 - pointer.x) < 1)
      assert.ok(Math.abs(held.y + held.height * .72 - pointer.y) < 1)
      if (mobile) await touch('touchEnd')
      else await page.mouse.up()
      await cdp.detach()
      await page.clock.runFor(1500)
      await expectFloor(page)
      await page.evaluate(`(() => {
        const viewport=window.visualViewport;
        for(const [key,value] of Object.entries({width:320,height:500,offsetLeft:20,offsetTop:80})) Object.defineProperty(viewport,key,{value,configurable:true});
        viewport.dispatchEvent(new Event('resize'));document.dispatchEvent(new Event('fullscreenchange'));
      })()`)
      await expectFloor(page)
      const resized = (await page.locator('.mewcat').boundingBox())!
      assert.ok(resized.x >= 20 && resized.x + resized.width <= 340, 'size respects the visual viewport walls')
      await page.evaluate(`(() => {const viewport=window.visualViewport;for(const key of ['width','height','offsetLeft','offsetTop'])delete viewport[key];viewport.dispatchEvent(new Event('resize'))})()`)
      await expectFloor(page)
      await page.goto('http://mewcat-size.test/?scope=one&portal=1')
      await openMewcat()
      await page.locator('#viewer .mewcat-sprite').waitFor()
      await expectSize(page, 72)
      assert.equal(await slider.inputValue(), '72')
      const silhouetteImage = await page.locator('.mewcat image').getAttribute('href')
      await page.getByRole('button', { name: '아기 고양이', exact: true }).click()
      await page.waitForFunction(`document.querySelector('.mewcat image')?.getAttribute('href') && document.querySelector('.mewcat image').getAttribute('href') !== ${JSON.stringify(silhouetteImage)}`)
      await expectSize(page, 72)
      await expectFloor(page)
      const peer = await context.newPage()
      await peer.goto('http://mewcat-size.test/?scope=one')
      await peer.locator('.mewcat-sprite').waitFor()
      await reset.click()
      await expectSize(page, 48)
      await expectSize(peer, 48)
      await page.evaluate('window.blockSizeWrites=true')
      await changeRange(page, 96)
      assert.match(await page.getByRole('alert').innerText(), /크기를 저장하지 못했습니다/)
      await page.evaluate("window.changeLanguage('en')")
      await page.getByRole('slider', { name: 'Default size' }).waitFor()
      assert.match(await page.getByRole('alert').innerText(), /Could not save the size/)
      await page.reload()
      await openMewcat()
      await expectSize(page, 48)
      assert.equal(await page.getByRole('alert').count(), 0)
      await changeRange(page, 120)
      await page.goto('http://mewcat-size.test/?scope=two')
      await openMewcat()
      await expectSize(page, 48)
      await changeRange(page, 24)
      await expectSize(peer, 120)
      await page.goto('http://mewcat-size.test/?scope=one')
      await openMewcat()
      await expectSize(page, 120)
      await page.evaluate("window.sizeStorage.setItem('mew:mewcat-size','invalid')")
      await page.reload()
      await openMewcat()
      await expectSize(page, 48)
      await page.evaluate("window.sizeStorage.setItem('mew:mewcat-size','999')")
      await page.reload()
      await openMewcat()
      await expectSize(page, 144)
      await page.evaluate("window.sizeStorage.setItem('mew:mewcat-size','-10')")
      await page.reload()
      await openMewcat()
      await expectSize(page, 24)
      assert.deepEqual(errors, [])
      await context.close()
    }
  } finally { await browser.close() }
})
