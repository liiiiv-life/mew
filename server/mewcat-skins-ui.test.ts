import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('Mewcat settings upload five strips, keep fixed cycles, preserve input, restore and edit skins on desktop/mobile', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const source = `
import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {Mewcat} from '${root}/src/components/Mewcat.tsx';
import {SettingsModal} from '${root}/src/components/SettingsModal.tsx';
import {loadFontPreferences} from '${root}/src/utils/fontPreferences.ts';
import {loadMewcatSkin,saveMewcatSkin} from '${root}/src/utils/mewcatSkin.ts';
import {setBrowserStorageScope,scopedBrowserStorage} from '${root}/packages/ui/src/browser-storage-scope.ts';
Object.defineProperty(document,'fullscreenEnabled',{value:false});
Math.random=()=>0.45;
setBrowserStorageScope('test-account',new URLSearchParams(location.search).get('scope')||'one');
scopedBrowserStorage().setItem('mew:locale','ko');
window.backgroundClicks=0;
function Fixture(){
 const [skin,setSkin]=useState(loadMewcatSkin),[open,setOpen]=useState(true);
 const change=value=>{saveMewcatSkin(value);setSkin(value)};
 return <><button id="background" style={{position:'fixed',inset:0}} onClick={()=>window.backgroundClicks++}>Background</button>
 <button id="settings" style={{position:'fixed',top:0,left:0}} onClick={()=>setOpen(true)}>Settings</button>
 <nav className="mobile-dock" style={{position:'fixed',bottom:0,height:48,width:'100%'}} onClick={()=>window.backgroundClicks++}>Dock</nav>
 <Mewcat skin={skin}/>{open&&<SettingsModal email={null} displayName={null} avatarDataUrl={null} canEditIgnore={false} theme="dark" themeColor="#4432a8" fontPreferences={loadFontPreferences()} mewcatSkin={skin} mewcatHideDesktop={false} onMewcatSkinChange={change} onMewcatHideDesktopChange={()=>{}} onFontPreferencesChange={()=>{}} onThemeColorChange={()=>{}} onToggleTheme={()=>{}} onClose={()=>setOpen(false)} onLoggedOut={()=>{}} onProfileChanged={()=>{}}/>}</>
}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:skins.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:skins.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:skins.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const files = ['src/components/SettingsModal.tsx', 'src/components/mewcat-skin-settings.tsx', 'src/components/mewcat-break.tsx', 'packages/ui/src/color-picker.tsx']
  const content = source + (await Promise.all(files.map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build(content.match(/[A-Za-z0-9_@:/.[\]()%,-]+/g) ?? [])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const mobile of [false, true]) {
      const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1100, height: 900 }, hasTouch: mobile })
      page.setDefaultTimeout(6000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://skins.test/**', async route => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname.startsWith('/mewcat/kitten/') && pathname.endsWith('.png')) return route.fulfill({ contentType: 'image/png', body: await fs.readFile(`${root}/public${pathname}`) })
        return route.fulfill({ contentType: 'text/html', body: `<html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${chunk.code}</script></html>` })
      })
      await page.clock.install()
      await page.goto('http://skins.test/')
      const settings = page.getByRole('dialog')
      await settings.getByRole('button', { name: '뮤캣', exact: true }).click()
      await settings.getByRole('button', { name: '아기 고양이', exact: true }).click()
      await page.locator('.mewcat > .mewcat-art > .mewcat-sprite').waitFor()
      await settings.getByRole('button', { name: '스킨 추가', exact: true }).click()
      await settings.getByRole('button', { name: '저장', exact: true }).click()
      await settings.getByRole('alert').getByText('스킨 이름과 다섯 동작의 이미지를 입력하세요.', { exact: true }).waitFor()
      await settings.getByRole('textbox', { name: '스킨 이름', exact: true }).fill('My kitten')
      await settings.getByLabel('가만히 있기 스프라이트', { exact: true }).setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken image') })
      await settings.getByRole('alert').getByText('이미지를 읽을 수 없습니다.', { exact: true }).waitFor()
      const walkPng = await page.locator('#root').evaluate(el => {
        const canvas = el.ownerDocument.createElement('canvas')
        canvas.width = 1000; canvas.height = 100
        const context = canvas.getContext('2d')!
        for (let index = 0; index < 10; index++) {
          context.fillStyle = `hsl(${index * 30} 70% 50%)`
          context.fillRect(index * 100 + 30, 20, 40, 80)
        }
        return canvas.toDataURL('image/png').split(',')[1]
      })
      const actions = ['가만히 있기', '걷기', '뛰기', '쓰다듬기', '목덜미 잡기']
      const files = ['idle', 'walk', 'run', 'love', 'struggle']
      for (let index = 0; index < actions.length; index++) {
        await settings.getByLabel(`${actions[index]} 스프라이트`, { exact: true }).setInputFiles(index === 1
          ? { name: 'walk-10.png', mimeType: 'image/png', buffer: Buffer.from(walkPng, 'base64') }
          : `${root}/public/mewcat/kitten/${files[index]}.png`)
        await settings.getByLabel(`${actions[index]} 프레임 수`, { exact: true }).fill(index === 1 ? '10' : '8')
      }
      await settings.getByLabel('걷기 프레임 수', { exact: true }).fill('11')
      await settings.getByRole('button', { name: '저장', exact: true }).click()
      assert.match(await settings.getByRole('alert').innerText(), /프레임 수는 1~256/)
      await settings.getByLabel('걷기 프레임 수', { exact: true }).fill('10')
      assert.equal(await settings.evaluate(el => el.scrollWidth <= el.clientWidth), true)
      await page.screenshot({ path: `/tmp/mewcat-skin-editor-${mobile ? 'mobile' : 'desktop'}.png` })
      await settings.getByRole('button', { name: '저장', exact: true }).click()
      await settings.getByRole('button', { name: 'My kitten', exact: true }).waitFor().catch(async error => { throw new Error(`${error.message}\n${await settings.innerText()}`) })
      assert.equal(await settings.getByRole('button', { name: 'My kitten', exact: true }).getAttribute('aria-pressed'), 'true')
      await settings.getByRole('button', { name: '닫기', exact: true }).last().click()
      const cat = page.locator('.mewcat')
      const sprite = cat.locator('.mewcat-sprite')
      await sprite.waitFor()
      await page.clock.pauseAt(new Date(Date.now() + 100))
      await page.clock.runFor(1500)
      assert.equal(await cat.getAttribute('data-activity'), 'walk')
      assert.equal(await sprite.getAttribute('viewBox'), '0 0 100 100', '10 input frames are used directly')
      const before = (await cat.boundingBox())!
      const firstFrame = await sprite.getAttribute('data-frame')
      await page.clock.runFor(880)
      assert.equal(await sprite.getAttribute('data-frame'), firstFrame, '10-frame walk still cycles in 880ms')
      const after = (await cat.boundingBox())!
      assert.ok(Math.abs(after.x - before.x - 48 * 0.88) < 2, 'walk movement keeps its original speed')
      await page.mouse.click(after.x + 1, after.y + 1)
      assert.equal(await page.evaluate('window.backgroundClicks'), 1, 'transparent sprite space passes input through')
      await page.mouse.move(after.x + 24, after.y + 35); await page.mouse.down()
      await page.mouse.move(after.x + 44, after.y - 100)
      assert.equal(await cat.getAttribute('data-activity'), 'struggle')
      const held = (await cat.boundingBox())!
      await page.clock.runFor(700)
      const stillHeld = (await cat.boundingBox())!
      assert.ok(Math.abs(held.x - stillHeld.x) < 1 && Math.abs(held.y - stillHeld.y) < 1)
      await page.mouse.up()
      assert.equal(await cat.getAttribute('data-activity'), 'fall')
      assert.equal(await sprite.getAttribute('viewBox'), '0 0 128 128', 'falling reuses the run strip')
      await page.clock.runFor(1800)
      assert.ok(Math.abs((await cat.boundingBox())!.y + 48 - 900) < 2, 'sprite lands on the viewport floor over the dock')
      await page.clock.resume()
      await page.reload()
      await sprite.waitFor()
      await settings.getByRole('button', { name: '뮤캣', exact: true }).click()
      await settings.getByRole('button', { name: '스킨 수정: My kitten', exact: true }).click()
      assert.equal(await settings.getByLabel('걷기 프레임 수', { exact: true }).inputValue(), '10')
      await settings.getByLabel('걷기 프레임 수', { exact: true }).fill('5')
      await settings.getByRole('button', { name: '저장', exact: true }).click()
      await settings.getByRole('textbox', { name: '스킨 이름', exact: true }).waitFor({ state: 'detached' })
      await page.goto('http://skins.test/?scope=other')
      await settings.getByRole('button', { name: '뮤캣', exact: true }).click()
      assert.equal(await settings.getByRole('button', { name: 'My kitten', exact: true }).count(), 0, 'skins are isolated between remote instances')
      assert.equal(await settings.getByRole('button', { name: '기본', exact: true }).getAttribute('aria-pressed'), 'true')
      await page.goto('http://skins.test/')
      await sprite.waitFor()
      await settings.getByRole('button', { name: '뮤캣', exact: true }).click()
      await settings.getByRole('button', { name: '스킨 수정: My kitten', exact: true }).click()
      assert.equal(await settings.getByLabel('걷기 프레임 수', { exact: true }).inputValue(), '5', 'edited frame count persists in the original scope')
      await settings.getByRole('button', { name: '취소', exact: true }).click()
      await settings.getByRole('button', { name: '스킨 삭제: My kitten', exact: true }).click()
      await settings.getByRole('button', { name: 'My kitten', exact: true }).waitFor({ state: 'detached' })
      assert.equal(await settings.getByRole('button', { name: '기본', exact: true }).getAttribute('aria-pressed'), 'true')
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
