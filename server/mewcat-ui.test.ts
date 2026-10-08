import test from 'node:test'
import { mewpetUiFixture } from './mewpet-ui-fixture.ts'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { mewcatNotificationCopy } from '../src/components/mewcat-notification-copy.ts'
import { LOCALES } from '../src/i18n-locales.ts'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(`${root}/package.json`)

type MewcatFixture = {
  setLocale: (locale: string) => void
  clearNotices: () => void
}

test('Mewcat notices and resource summaries fit themes, open targets and stop polling after dismissal', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  // In-memory fixture only: no app build, server, authenticated workspace or dist changes.
  const source = `
// This fixture covers cat behavior in a fullscreen-unavailable client.
Object.defineProperty(document,'fullscreenEnabled',{value:false});
import React from '${require.resolve('react')}';
import {createRoot} from '${require.resolve('react-dom/client')}';
import {I18nProvider,useI18n} from '${root}/src/i18n.tsx';
import {Mewcat} from '${root}/src/components/Mewcat.tsx';
import {SystemStatsModal} from '${root}/src/components/SystemStatsModal.tsx';
import {MewcatNotificationSettings} from '${root}/src/components/mewcat-notifications.tsx';
import {publishMewcatNotice,clearMewcatNotices} from '${root}/src/utils/mewcat-notifications.ts';
localStorage.setItem('mew:locale','ko');
Math.random=()=>0.7;
window.clearNotices=clearMewcatNotices;
window.updateNotice=()=>publishMewcatNotice({key:'updates',kind:'updates',level:'success',source:'mew · Codex · Claude · 설치된 의존성 업데이트',target:'updates'});
window.addRecent=()=>{publishMewcatNotice({key:'older',kind:'complete',level:'success',source:'Older agent'});publishMewcatNotice({key:'newer',kind:'error',level:'danger',source:'Newest agent'});};
window.addAll=()=>['complete','stopped','error','permission','cpu','memory','gpu','temperature','test'].forEach(kind=>publishMewcatNotice({key:'locale:'+kind,kind,level:'warning',source:kind==='test'?'Mewcat':'Original agent',target:'system'}));
window.complete=(source='Codex · mew')=>publishMewcatNotice({key:'completion',kind:'complete',level:'success',source,target:{tabId:'completed-agent',cwd:'/workspace'}});
window.notify=()=>publishMewcatNotice({key:'sample',kind:'memory',level:'warning',source:'95%',target:'system'});
window.addEventListener('mew:open-notification',event=>window.openedTarget=event.detail.target);
function Fixture(){window.setLocale=useI18n().setLocale;const [open,setOpen]=React.useState(false);const [allowed,setAllowed]=React.useState(true);window.setAllowed=setAllowed;return <><div style={{padding:24,maxWidth:480}}><MewcatNotificationSettings/></div><Mewcat skin="mew" onOpenSystemStats={allowed?()=>setOpen(true):undefined}/>{open&&<SystemStatsModal onClose={()=>setOpen(false)}/>}</>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:mewcat.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:mewcat.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:mewcat.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')
  assert.ok(chunk && chunk.type === 'chunk')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const uiSource = (await Promise.all(['mewcat-notifications.tsx', 'mewcat-resources.tsx', 'SystemStatsModal.tsx'].map(file => fs.readFile(`${root}/src/components/${file}`, 'utf8')))).join('\n')
  const css = compiler.build(uiSource.match(/[A-Za-z0-9_:[\]/.%!#()-]+/g) ?? [])
  const petFiles = await mewpetUiFixture()
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const mobile of [false, true]) for (const light of [false, true]) {
      const width = mobile ? 390 : 1280
      const page = await browser.newPage({ viewport: { width, height: mobile ? 844 : 800 }, hasTouch: mobile })
      page.setDefaultTimeout(4000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      let samples = 0, unavailable = false, fail = false, cpu = 24
      await page.route('http://mewcat.test/**', route => {
        if (new URL(route.request().url()).pathname === '/api/system-stats') {
          samples++
          return route.fulfill(fail ? { status: 500, json: { error: 'unavailable' } } : { json: { cpu: { usage: cpu, cores: 8, model: 'Fixture CPU', temperature: null, loadavg: [1, 1, 1] }, memory: { used: 8 * 1024 ** 3, total: 16 * 1024 ** 3, available: 8 * 1024 ** 3 }, gpus: unavailable ? [] : [{ name: 'GPU A', utilization: 12, temperature: null, memoryUsedMb: null, memoryTotalMb: null }, { name: 'GPU B', utilization: 62, temperature: null, memoryUsedMb: null, memoryTotalMb: null }], processes: [], hostname: 'mew-test', uptime: 60 } })
        }
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html ${light ? '' : 'class="dark"'}><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${chunk.code}</script></html>` })
      })
      await page.route('**/mewcat/**', async route => route.fulfill({ contentType: 'image/png', body: await fs.readFile(`${root}/public${new URL(route.request().url()).pathname}`) }))
      await petFiles.route(page)
      await page.goto('http://mewcat.test/')
      await page.waitForSelector('.mewcat-sprite')
      const noticeOrigin = await page.evaluate(`(() => {
        const box = document.querySelector('.mewcat').getBoundingClientRect();
        window.notify();
        return { x: box.x, y: box.y };
      })()`) as { x: number; y: number }
      const bubble = page.locator('.mewcat-notifications')
      await bubble.waitFor()
      await page.waitForTimeout(100)
      const notifiedCat = (await page.locator('.mewcat').boundingBox())!
      assert.ok(Math.abs(notifiedCat.x - noticeOrigin.x) < 3, 'incoming notice preserves the cat position')
      const box = await bubble.boundingBox()
      assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.y >= 0)
      assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true)
      await page.screenshot({ path: `/tmp/mewcat-${mobile ? 'mobile' : 'desktop'}-${light ? 'light' : 'dark'}.png` })
      for (const locale of LOCALES) {
        await page.evaluate(locale => (globalThis as unknown as MewcatFixture).setLocale(locale), locale)
        await bubble.getByText(mewcatNotificationCopy[locale].memory, { exact: true }).waitFor()
        assert.equal(await bubble.getByRole('button', { name: mewcatNotificationCopy[locale].system, exact: true }).count(), 1)
      }
      await page.evaluate(() => (globalThis as unknown as MewcatFixture).setLocale('ko'))
      await page.getByRole('button', { name: '시스템 자원 보기', exact: true }).click()
      assert.equal(await page.evaluate('window.openedTarget'), 'system')
      await bubble.waitFor({ state: 'detached' })
      await page.waitForFunction("document.querySelector('.mewcat').dataset.activity === 'run'")
      assert.equal(samples, 0, 'resource summary does not poll before opening')
      await page.evaluate('window.complete()')
      await bubble.getByText(mewcatNotificationCopy.ko.complete, { exact: true }).waitFor()
      await page.screenshot({ path: `/tmp/mewcat-complete-${mobile ? 'mobile' : 'desktop'}-${light ? 'light' : 'dark'}.png` })
      for (const locale of LOCALES) {
        await page.evaluate(locale => (globalThis as unknown as MewcatFixture).setLocale(locale), locale)
        const open = bubble.getByRole('button', { name: mewcatNotificationCopy[locale].open, exact: true })
        await open.waitFor()
        const action = (await open.boundingBox())!, bounds = (await bubble.boundingBox())!
        assert.ok(action.x >= bounds.x && action.x + action.width <= bounds.x + bounds.width)
        if (mobile) assert.ok(action.height >= 44, 'compact appearance retains its touch target')
      }
      await page.evaluate(() => (globalThis as unknown as MewcatFixture).setLocale('ko'))
      await page.evaluate("window.complete('Codex · 아주 긴 프로젝트 이름과 에이전트 이름이 함께 표시되는 작업 완료 알림')")
      assert.equal(await bubble.evaluate(element => element.scrollWidth <= element.clientWidth), true)
      const conversation = bubble.getByRole('button', { name: mewcatNotificationCopy.ko.open, exact: true })
      if (mobile) await conversation.tap(); else await conversation.click()
      assert.deepEqual(await page.evaluate('window.openedTarget'), { tabId: 'completed-agent', cwd: '/workspace' })
      await bubble.waitFor({ state: 'detached' })
      await page.evaluate("window.updateNotice()")
      await bubble.getByText(mewcatNotificationCopy.ko.updates, { exact: true }).waitFor()
      assert.equal(await bubble.locator('.mewcat-notifications-content').evaluate(el => {
        const style = el.ownerDocument.defaultView!.getComputedStyle(el)
        el.scrollTop = el.scrollHeight
        const bounds = el.getBoundingClientRect()
        const textFits = Array.from(el.querySelectorAll('p')).every(p => (p as typeof el).getBoundingClientRect().bottom <= bounds.bottom)
        return style.overflowY === 'clip' && style.maxHeight === 'none' && el.scrollTop === 0 && textFits
      }), true, 'update notification shows all content without internal scrolling')
      await bubble.getByRole('button', { name: mewcatNotificationCopy.ko.updateOpen, exact: true }).click()
      assert.equal(await page.evaluate('window.openedTarget'), 'updates')
      await bubble.waitFor({ state: 'detached' })
      const cat = page.getByRole('button', { name: '뮤펫', exact: true })
      await cat.evaluate(el => el.addEventListener('pointerdown', () => { (el.ownerDocument.defaultView as unknown as { tappedCatX: number }).tappedCatX = el.getBoundingClientRect().x }, { once: true }))
      if (mobile) await cat.tap({ force: true, position: { x: 24, y: 35 } }); else await cat.click({ force: true, position: { x: 24, y: 35 } })
      const summary = page.getByRole('complementary', { name: '최근 알림', exact: true })
      await summary.getByText('CPU-24%', { exact: true }).waitFor()
      assert.equal(await summary.getByText('메모리-50%', { exact: true }).count(), 1)
      assert.equal(await summary.getByText('GPU-62%', { exact: true }).count(), 1)
      assert.equal(await summary.getByText('최근 알림이 없어요.', { exact: true }).count(), 1)
      const memoryLabels = { ko: '메모리', en: 'Memory', ja: 'メモリ', 'zh-CN': '内存' }
      for (const locale of LOCALES) {
        await page.evaluate(locale => (globalThis as unknown as MewcatFixture).setLocale(locale), locale)
        await bubble.getByText(mewcatNotificationCopy[locale].empty, { exact: true }).waitFor()
        assert.equal(await bubble.getAttribute('aria-label'), mewcatNotificationCopy[locale].recent)
        assert.equal(await bubble.getByText(`${memoryLabels[locale]}-50%`, { exact: true }).count(), 1)
      }
      await page.evaluate('window.addAll()')
      for (const locale of LOCALES) {
        await page.evaluate(locale => (globalThis as unknown as MewcatFixture).setLocale(locale), locale)
        const copy = mewcatNotificationCopy[locale]
        await bubble.getByText(copy.complete, { exact: true }).waitFor()
        for (const kind of ['stopped', 'error', 'permission', 'cpu', 'memory', 'gpu', 'temperature', 'testBody'] as const) {
          assert.equal(await bubble.getByText(copy[kind], { exact: true }).count(), 1)
        }
        assert.equal(await bubble.getByText('Original agent', { exact: true }).count(), 8, 'user source remains unchanged')
        const catName = locale === 'ko' ? '뮤펫' : 'Mewpet'
        assert.equal(await bubble.getByRole('button', { name: `${copy.dismiss}: ${catName}`, exact: true }).count(), 1)
        assert.equal(await page.locator('.mewcat').getAttribute('aria-label'), catName)
        assert.equal(await page.evaluate('document.documentElement.lang'), locale)
        assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true)
        await page.screenshot({ path: `/tmp/mewcat-locale-${locale}-${mobile ? 'mobile' : 'desktop'}-${light ? 'light' : 'dark'}.png` })
      }
      await page.evaluate(() => {
        const fixture = globalThis as unknown as MewcatFixture
        fixture.clearNotices()
        fixture.setLocale('ko')
      })
      await page.evaluate('window.addRecent()')
      await summary.getByText('Newest agent', { exact: true }).waitFor()
      assert.match(await summary.locator('li').first().innerText(), /Newest agent/)
      await summary.getByRole('button', { name: '알림 닫기: Newest agent', exact: true }).click()
      assert.equal(await summary.locator('li').count(), 1)
      assert.equal(await summary.getByText('Older agent', { exact: true }).count(), 1)
      cpu = 37
      const refreshStarted = Date.now()
      await summary.getByText('CPU-37%', { exact: true }).waitFor({ timeout: 1500 })
      assert.ok(Date.now() - refreshStarted < 1500, 'open bubble refreshes on a half-second cadence')
      await page.waitForTimeout(650)
      await page.screenshot({ path: `/tmp/mewcat-resources-${mobile ? 'mobile' : 'desktop'}-${light ? 'light' : 'dark'}.png` })
      const tappedCatX = await page.evaluate('window.tappedCatX') as number
      assert.ok(Math.abs((await cat.boundingBox())!.x - tappedCatX) < 1, 'opening the summary does not teleport the cat after love animation')
      const summaryBox = await summary.boundingBox()
      assert.ok(summaryBox && summaryBox.x >= 0 && summaryBox.x + summaryBox.width <= width)
      await summary.getByRole('button', { name: '시스템 자원 보기', exact: true }).click()
      await summary.waitFor({ state: 'detached' })
      await page.getByText('mew-test ·', { exact: false }).waitFor()
      await page.keyboard.press('Escape')
      await page.getByText('mew-test ·', { exact: false }).waitFor({ state: 'detached' })
      const closedSamples = samples
      await page.waitForTimeout(2100)
      assert.equal(samples, closedSamples, 'closed summary stops polling')
      await page.evaluate('window.clearNotices()')
      await cat.focus(); await page.keyboard.press('Enter')
      await summary.waitFor()
      await summary.getByText('CPU-37%', { exact: true }).waitFor()
      unavailable = true
      await summary.getByText('GPU-—', { exact: true }).waitFor()
      fail = true
      await summary.getByTitle('자원 현황을 불러오지 못했습니다', { exact: true }).waitFor()
      assert.equal(await summary.getByRole('button', { name: '시스템 자원 보기', exact: true }).getAttribute('title'), '자원 현황을 불러오지 못했습니다')
      await page.keyboard.press('Escape')
      await summary.waitFor({ state: 'detached' })
      // Freeze roaming so edge positions and the tail can be checked exactly.
      await page.clock.install()
      await page.clock.pauseAt(new Date(Date.now() + 1000))
      for (const targetX of [0, (width - 48) / 2, width - 48]) {
        const before = (await cat.boundingBox())!
        await page.mouse.move(before.x + 24, before.y + 35)
        await page.mouse.down()
        await page.mouse.move(targetX + 24, before.y + 35)
        await page.clock.runFor(160)
        await page.mouse.up()
        await page.clock.runFor(32)
        const clicked = (await cat.boundingBox())!
        assert.ok(Math.abs(clicked.x - targetX) < 3, 'drag reaches the requested edge')
        // A zero-distance edge move is a tap and may already have opened the bubble.
        if (await cat.getAttribute('aria-expanded') !== 'true') { await cat.focus(); await page.keyboard.press('Enter') }
        await summary.waitFor()
        await page.waitForFunction("document.querySelector('.mewcat').getAttribute('aria-expanded') === 'true'")
        await page.clock.runFor(800)
        const still = (await cat.boundingBox())!
        assert.ok(Math.abs(still.x - clicked.x) < 1, `cat stays where clicked: ${JSON.stringify({targetX, clicked, still, activity: await cat.getAttribute('data-activity')})}`)
        const positioned = (await summary.boundingBox())!
        assert.ok(positioned.x >= 0 && positioned.x + positioned.width <= width && positioned.y >= 0)
        const tail = await summary.evaluate(el => {
          const style = el.ownerDocument.defaultView!.getComputedStyle(el, '::after')
          return el.getBoundingClientRect().left + 1 + parseFloat(style.left)
        })
        assert.ok(Math.abs(tail - (still.x + still.width / 2)) <= 8, 'tail tracks the cat when the bubble is clamped at the edge')
        await page.screenshot({ path: `/tmp/mewcat-anchor-${width}-${light ? 'light' : 'dark'}-${Math.round(targetX)}.png` })
        await page.keyboard.press('Escape')
        await summary.waitFor({ state: 'detached' })
      }
      await page.evaluate('window.setAllowed(false)')
      await page.locator('.mewcat').click({ force: true, position: { x: 24, y: 35 } })
      await summary.waitFor()
      assert.equal(await summary.getByRole('button', { name: '시스템 자원 보기', exact: true }).count(), 0, 'notifications remain available without resource permission')
      const deniedSamples = samples
      await page.clock.runFor(1000)
      assert.equal(samples, deniedSamples, 'no resource requests without permission')
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close(); await petFiles.close() }
})
