import test from 'node:test'
import { mewpetUiFixture } from './mewpet-ui-fixture.ts'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { MEWPET_ANIMATIONS as MEWCAT_ALL_SPRITE_ACTIONS } from '../shared/mewpet-skins.ts'

const root = path.resolve(import.meta.dirname, '..')

test('Mewcat settings preserve seven required strips and save, remove and restore optional transitions', { skip: !domBrowserExecutable(), timeout: 90_000 }, async () => {
  const source = `
import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {Mewcat} from '${root}/src/components/Mewcat.tsx';
import {SettingsModal} from '${root}/src/components/SettingsModal.tsx';
import {loadFontPreferences} from '${root}/src/utils/fontPreferences.ts';
import {loadMewcatSkin,saveMewcatSkin} from '${root}/src/utils/mewcatSkin.ts';
import {spriteStore} from '${root}/src/utils/mewcat-sprite-storage.ts';
import {setRemoteTransport} from '${root}/src/utils/remote-transport.ts';
import {setBrowserStorageScope,scopedBrowserStorage,remoteStorageName} from '${root}/packages/ui/src/browser-storage-scope.ts';
Object.defineProperty(document,'fullscreenEnabled',{value:false});
Math.random=()=>0.45;
setBrowserStorageScope('test-account',new URLSearchParams(location.search).get('scope')||'one');
scopedBrowserStorage().setItem('mew:locale','ko');
window.backgroundClicks=0;
window.petRequests=[];
setRemoteTransport({fetch:async(url,init)=>{window.petRequests.push(String(url));if(init?.body instanceof FormData){const request=new Request(new URL(url,location.origin),init);return fetch(url,{...init,headers:request.headers,body:await request.arrayBuffer()})}return fetch(url,init)},socket:()=>{throw new Error('unused socket')},close:()=>{}});
window.legacySkin=()=>{const skin=spriteStore().snapshot.skins.find(item=>item.name==='My kitten');return {database:remoteStorageName('mewcat-sprite-skins'),skin:{id:skin.id,name:skin.name,sprites:Object.fromEntries(Object.entries(skin.sprites).filter(([action])=>action!=='jump'&&action!=='fall').map(([action,image])=>[action,{blob:image.blob,width:image.width,height:image.height,frames:image.frames}]))}}};
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
  const petFiles = await mewpetUiFixture()
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const mobile of [false, true]) {
      const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1100, height: 900 }, hasTouch: mobile })
      page.setDefaultTimeout(6000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://skins.test/**', async route => {
        const pathname = new URL(route.request().url()).pathname
        if (/^\/mewcat\/(kitten|silhouette|russian-blue|korean-shorthair|capybara)\/[a-z-]+\.png$/.test(pathname)) return route.fulfill({ contentType: 'image/png', body: await fs.readFile(`${root}/public${pathname}`) })
        return route.fulfill({ contentType: 'text/html', body: `<html class="${mobile ? '' : 'dark'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${chunk.code}</script></html>` })
      })
      await page.clock.install()
      await petFiles.route(page)
      await page.goto('http://skins.test/')
      const settings = page.getByRole('dialog')
      await settings.getByRole('button', { name: '뮤펫', exact: true }).click()
      const silhouette = settings.getByRole('button', { name: '뮤펫 (기본)', exact: true })
      assert.equal(await silhouette.getAttribute('aria-pressed'), 'true')
      await silhouette.locator('.mewcat-sprite').waitFor()
      await page.locator('.mewcat > .mewcat-art > .mewcat-sprite').waitFor()
      await settings.getByRole('button', { name: '아기 고양이', exact: true }).locator('.mewcat-sprite').waitFor()
      const animals = [
        { name: '러시안블루', folder: 'russian-blue' },
        { name: '코리안 숏헤어', folder: 'korean-shorthair' },
        { name: '카피바라', folder: 'capybara' },
      ]
      for (const animal of animals) await settings.getByRole('button', { name: animal.name, exact: true }).locator('.mewcat-sprite').waitFor()
      const silhouetteImage = await page.locator('.mewcat > .mewcat-art > .mewcat-sprite image').getAttribute('href')
      assert.equal(await settings.getByRole('button', { name: '기본', exact: true }).count(), 0)
      assert.equal(await settings.getByText('털색', { exact: true }).count(), 0)
      assert.equal(await page.locator('.mewcat-mark').count(), 0)
      await page.screenshot({ path: `/tmp/mewcat-builtins-${mobile ? 'mobile' : 'desktop'}.png` })
      const animalImages = new Set<string | null>([silhouetteImage])
      for (const animal of animals) {
        const option = settings.getByRole('button', { name: animal.name, exact: true })
        await option.click()
        assert.equal(await option.getAttribute('aria-pressed'), 'true')
        await page.locator('.mewcat > .mewcat-art > .mewcat-sprite').waitFor()
        const animalImage = await page.locator('.mewcat > .mewcat-art > .mewcat-sprite image').getAttribute('href')
        assert.ok(animalImage && !animalImages.has(animalImage), 'each animal renders its own artwork')
        animalImages.add(animalImage)
        await settings.getByRole('button', { name: '스킨 추가', exact: true }).click()
        const samples = await settings.getByRole('link', { name: /예제 이미지 다운로드$/ }).evaluateAll(links => links.map(link => link.getAttribute('href')))
        assert.deepEqual(samples.map(url => new URL(url!, 'http://skins.test').pathname), ['idle', 'walk', 'run', 'jump', 'fall', 'love', 'struggle'].map(action => `/api/mewpet/skins/${animal.folder}/${action}`))
        await settings.locator('summary').filter({ hasText: '전환 모션 (선택)' }).click()
        const allSamples = await settings.getByRole('link', { name: /예제 이미지 다운로드$/ }).evaluateAll(links => links.map(link => link.getAttribute('href')))
        assert.deepEqual(allSamples.map(url => new URL(url!, 'http://skins.test').pathname), MEWCAT_ALL_SPRITE_ACTIONS.map(action => `/api/mewpet/skins/${animal.folder}/${action}`))
        await settings.getByRole('button', { name: '취소', exact: true }).click()
      }
      await page.reload()
      await settings.getByRole('button', { name: '뮤펫', exact: true }).click()
      assert.equal(await settings.getByRole('button', { name: '카피바라', exact: true }).getAttribute('aria-pressed'), 'true', 'animal selection survives reload')
      assert.equal(await settings.evaluate(el => el.scrollWidth <= el.clientWidth), true)
      await settings.getByRole('button', { name: '아기 고양이', exact: true }).click()
      await page.locator('.mewcat > .mewcat-art > .mewcat-sprite').waitFor()
      assert.notEqual(await page.locator('.mewcat > .mewcat-art > .mewcat-sprite image').getAttribute('href'), silhouetteImage, 'the existing kitten remains a separate skin')
      await settings.getByRole('button', { name: '스킨 추가', exact: true }).click()
      assert.match((await settings.getByRole('link', { name: '걷기: 예제 이미지 다운로드', exact: true }).getAttribute('href'))!, /^\/api\/mewpet\/skins\/kitten\/walk\?v=/)
      await settings.getByRole('button', { name: '저장', exact: true }).click()
      await settings.getByRole('alert').getByText('스킨 이름과 일곱 동작의 이미지를 입력하세요.', { exact: true }).waitFor()
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
      const idleWebp = await page.locator('#root').evaluate(async el => {
        const win = el.ownerDocument.defaultView!, response = await win.fetch('/api/mewpet/skins/kitten/idle')
        const image = await win.createImageBitmap(await response.blob()), canvas = el.ownerDocument.createElement('canvas')
        canvas.width = image.width; canvas.height = image.height
        canvas.getContext('2d')!.drawImage(image, 0, 0); image.close()
        return canvas.toDataURL('image/webp').split(',')[1]
      })
      const actions = ['가만히 있기', '걷기', '뛰기', '공중 상승', '공중 하강', '쓰다듬기', '목덜미 잡기']
      const files = ['idle', 'walk', 'run', 'jump', 'fall', 'love', 'struggle']
      for (let index = 0; index < actions.length; index++) {
        await settings.getByLabel(`${actions[index]} 스프라이트`, { exact: true }).setInputFiles(index === 1
          ? { name: 'walk-10.png', mimeType: 'image/png', buffer: Buffer.from(walkPng, 'base64') }
          : index === 0 ? { name: 'idle.webp', mimeType: 'image/webp', buffer: Buffer.from(idleWebp, 'base64') } : `${root}/public/mewcat/kitten/${files[index]}.png`)
        await settings.getByLabel(`${actions[index]} 프레임 수`, { exact: true }).fill(index === 1 ? '10' : '8')
      }
      await settings.getByLabel('걷기 프레임 수', { exact: true }).fill('11')
      await settings.getByRole('button', { name: '저장', exact: true }).click()
      assert.match(await settings.getByRole('alert').innerText(), /프레임 수는 1~256/)
      await settings.getByLabel('걷기 프레임 수', { exact: true }).fill('10')
      assert.equal(await settings.evaluate(el => el.scrollWidth <= el.clientWidth), true)
      await page.screenshot({ path: `/tmp/mewcat-skin-editor-${mobile ? 'mobile' : 'desktop'}.png` })
      await settings.getByRole('button', { name: '저장', exact: true }).click()
      await settings.getByRole('button', { name: 'My kitten', exact: true }).waitFor().catch(async error => { throw new Error(`${error.message}\n${petFiles.errors.join('\n')}\n${await settings.innerText()}`) })
      assert.equal(await settings.getByRole('button', { name: 'My kitten', exact: true }).getAttribute('aria-pressed'), 'true')
      assert.equal(petFiles.store.image(petFiles.store.list().skins.find(item => item.name === 'My kitten')!.id, 'idle').mime, 'image/webp')
      await settings.getByRole('button', { name: '스킨 수정: My kitten', exact: true }).click()
      await settings.locator('summary').filter({ hasText: '전환 모션 (선택)' }).click()
      for (const [name, action] of [['뛰기 → 걷기', 'run-walk'], ['바닥 → 점프', 'takeoff'], ['낙하 → 착지', 'landing'], ['상승 → 하강', 'apex']]) {
        await settings.getByLabel(`${name} 스프라이트`, { exact: true }).setInputFiles(`${root}/public/mewcat/kitten/${action}.png`)
        await settings.getByRole('button', { name: `${name} 이미지 제거`, exact: true }).waitFor()
      }
      await settings.getByLabel('상승 → 하강 프레임 수', { exact: true }).fill('11')
      await settings.getByRole('button', { name: '저장', exact: true }).click()
      assert.match(await settings.getByRole('alert').innerText(), /상승 → 하강.*프레임 수는 1~256/)
      await settings.getByLabel('상승 → 하강 프레임 수', { exact: true }).fill('8')
      await settings.getByRole('button', { name: '뛰기 → 걷기 이미지 제거', exact: true }).click()
      assert.match(await settings.locator('summary').innerText(), /3\/9/)
      assert.equal(await settings.evaluate(el => el.scrollWidth <= el.clientWidth), true)
      await page.screenshot({ path: `/tmp/mewcat-transitions-editor-${mobile ? 'mobile-light' : 'desktop-dark'}.png` })
      await settings.getByRole('button', { name: '저장', exact: true }).click()
      await settings.getByRole('textbox', { name: '스킨 이름', exact: true }).waitFor({ state: 'detached' })
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
      assert.equal(await sprite.getAttribute('viewBox'), '0 0 128 128', 'falling uses its own descent strip')
      await page.clock.runFor(1800)
      assert.ok(Math.abs((await cat.boundingBox())!.y + 48 - 900) < 2, 'sprite lands on the viewport floor over the dock')
      await page.clock.resume()
      const legacyId = petFiles.store.list().skins.find(item => item.name === 'My kitten')!.id
      await page.locator('#root').evaluate(async el => {
        const win = el.ownerDocument.defaultView! as typeof el.ownerDocument.defaultView & { legacySkin(): { database: string; skin: unknown } }
        const legacy = win.legacySkin()
        await new Promise<void>((resolve, reject) => {
          const request = win.indexedDB.open(legacy.database, 1)
          request.onupgradeneeded = () => request.result.createObjectStore('skins', { keyPath: 'id' })
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result, tx = db.transaction('skins', 'readwrite')
            tx.objectStore('skins').put(legacy.skin)
            tx.oncomplete = () => { db.close(); resolve() }
            tx.onerror = tx.onabort = () => { db.close(); reject(tx.error) }
          }
        })
      })
      petFiles.store.delete(legacyId)
      await page.reload()
      await sprite.waitFor()
      await settings.getByRole('button', { name: '뮤펫', exact: true }).click()
      await settings.getByRole('button', { name: '스킨 수정: My kitten', exact: true }).click()
      await settings.locator('summary').filter({ hasText: '전환 모션 (선택)' }).click()
      assert.match(await settings.locator('summary').innerText(), /3\/9/, 'optional strips survive global reload and legacy required-strip migration')
      assert.equal(await settings.getByRole('button', { name: '뛰기 → 걷기 이미지 제거', exact: true }).count(), 0, 'removed transitions remain absent')
      assert.equal(await settings.getByLabel('바닥 → 점프 프레임 수', { exact: true }).inputValue(), '8')
      assert.equal(await settings.getByLabel('걷기 프레임 수', { exact: true }).inputValue(), '10')
      assert.equal(await settings.getByLabel('공중 상승 프레임 수', { exact: true }).inputValue(), '1', 'legacy custom skins receive a separate ascent pose')
      assert.equal(await settings.getByLabel('공중 하강 프레임 수', { exact: true }).inputValue(), '1', 'legacy custom skins receive a separate descent pose')
      await settings.getByLabel('걷기 프레임 수', { exact: true }).fill('5')
      await settings.getByRole('button', { name: '저장', exact: true }).click()
      await settings.getByRole('textbox', { name: '스킨 이름', exact: true }).waitFor({ state: 'detached' })
      await page.goto('http://skins.test/?scope=other')
      await settings.getByRole('button', { name: '뮤펫', exact: true }).click()
      await settings.getByRole('button', { name: 'My kitten', exact: true }).waitFor()
      assert.equal(await settings.getByRole('button', { name: 'My kitten', exact: true }).count(), 1, 'the server library is shared across preference scopes')
      assert.equal(await settings.getByRole('button', { name: '뮤펫 (기본)', exact: true }).getAttribute('aria-pressed'), 'true')
      await page.goto('http://skins.test/')
      await sprite.waitFor()
      await settings.getByRole('button', { name: '뮤펫', exact: true }).click()
      await settings.getByRole('button', { name: '스킨 수정: My kitten', exact: true }).click()
      assert.equal(await settings.getByLabel('걷기 프레임 수', { exact: true }).inputValue(), '5', 'edited frame count persists in the original scope')
      await settings.getByRole('button', { name: '취소', exact: true }).click()
      await settings.getByRole('button', { name: '스킨 삭제: My kitten', exact: true }).click()
      await settings.getByRole('button', { name: 'My kitten', exact: true }).waitFor({ state: 'detached' })
      assert.equal(await settings.getByRole('button', { name: '뮤펫 (기본)', exact: true }).getAttribute('aria-pressed'), 'true')
      await settings.getByRole('button', { name: '스킨 추가', exact: true }).click()
      assert.match((await settings.getByRole('link', { name: '걷기: 예제 이미지 다운로드', exact: true }).getAttribute('href'))!, /^\/api\/mewpet\/skins\/mew\/walk\?v=/)
      await settings.getByRole('button', { name: '취소', exact: true }).click()
      const directory = path.join(petFiles.store.directory, 'hot-pet')
      await fs.mkdir(directory, { recursive: true })
      const manifest = JSON.parse(await fs.readFile(`${root}/public/mewcat/kitten/skin.json`, 'utf8'))
      manifest.id = 'hot-pet'; manifest.name = 'Hot pet'; manifest.translated = false
      for (const action of MEWCAT_ALL_SPRITE_ACTIONS) {
        try { await fs.copyFile(`${root}/public/mewcat/kitten/${action}.png`, `${directory}/${action}.png`) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      }
      await fs.writeFile(`${directory}/skin.json`, JSON.stringify(manifest))
      await settings.getByRole('button', { name: '새로고침', exact: true }).click()
      await settings.getByRole('button', { name: 'Hot pet', exact: true }).click()
      await page.locator('.mewcat > .mewcat-art > .mewcat-sprite image').waitFor()
      const oldImage = await page.locator('.mewcat > .mewcat-art > .mewcat-sprite image').getAttribute('href')
      manifest.name = 'Updated pet'
      await fs.copyFile(`${root}/public/mewcat/capybara/idle.png`, `${directory}/idle.png`)
      await fs.writeFile(`${directory}/skin.json`, JSON.stringify(manifest))
      await settings.getByRole('button', { name: '새로고침', exact: true }).click()
      await settings.getByRole('button', { name: 'Updated pet', exact: true }).waitFor()
      assert.equal(await settings.getByRole('button', { name: 'Updated pet', exact: true }).getAttribute('aria-pressed'), 'true')
      assert.notEqual(await page.locator('.mewcat > .mewcat-art > .mewcat-sprite image').getAttribute('href'), oldImage, 'file replacement refreshes the active skin without a build')
      assert.ok((await page.evaluate('window.petRequests') as string[]).some(url => url.startsWith('/api/mewpet/skins/')), 'catalog and sprite requests use the remote transport')
      await fs.rm(directory, { recursive: true })
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close(); await petFiles.close() }
})
