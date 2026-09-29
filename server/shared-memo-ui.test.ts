import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('shared memo dock, keyboard focus, drag, presence, live Markdown and persisted reopen', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-memo-ui-'))
  process.env.MEW_DATA_DIR = directory
  const { attachCollabWebSocket, closeAllRooms } = await import('./collab.ts')
  const root = path.resolve(import.meta.dirname, '..')
  const source = `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {SharedMemo} from '${root}/src/components/shared-memo.tsx';
import {MobileDock} from '${root}/src/components/mobile-dock.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
localStorage.setItem('mew:locale','ko');
function Fixture(){const [open,setOpen]=useState(false);const [focus,setFocus]=useState(0);return <><input aria-label="Outside"/><MobileDock active={open?'memo':'editor'} openPanels={open?['memo']:[]} available={['editor','memo']} hidden={false} onNavigate={()=>{}} onSelect={id=>{setOpen(current=>id==='memo'?(innerWidth>=768?!current:true):false);setFocus(value=>value+1)}}/><SharedMemo authEmail={new URLSearchParams(location.search).get('user') || 'one@example.test'} open={open} onOpenChange={setOpen} focusSignal={focus}/></>}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
  const bundle = await build({ input: 'virtual:memo.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'memo-fixture', resolveId(id) { if (id === 'virtual:memo.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' },
    load(id) { if (id === 'virtual:memo.tsx') return source; if (id === 'virtual:style') return '' },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const ui = (await Promise.all(['src/components/shared-memo.tsx', 'src/components/PresenceDots.tsx', 'src/components/mobile-dock.tsx', 'packages/editor/src/Editor.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set((source + ui).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + '\n' + (await Promise.all(['packages/editor/src/editor/editor.css', 'src/components/shared-memo.css'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(chunk.code); return }
    res.setHeader('Content-Type', 'text/html')
    res.end(`<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`)
  })
  attachCollabWebSocket(server as unknown as Parameters<typeof attachCollabWebSocket>[0])
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const one = await browser.newPage({ viewport: { width: 1100, height: 800 } })
    const two = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const errors: string[] = []
    for (const page of [one, two]) { page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message)) }
    await one.goto(base); await two.goto(`${base}?user=two@example.test`)
    await one.getByRole('textbox', { name: 'Outside' }).focus()
    await one.keyboard.press('Control+m')
    const memo = one.getByRole('dialog', { name: '메모', exact: true })
    await memo.locator('.tiptap[contenteditable=true]').waitFor()
    await one.waitForFunction("document.activeElement?.classList.contains('tiptap')")
    await one.keyboard.type('# Shared memo'); await one.keyboard.press('Enter')
    await one.keyboard.type('First note')
    await two.locator('[data-dock-item=memo]').tap()
    await two.locator('.tiptap h1').filter({ hasText: 'Shared memo' }).waitFor()
    const mobileMemo = two.getByRole('dialog', { name: '메모', exact: true })
    await mobileMemo.locator('.tiptap[contenteditable=true]').focus()
    const keyBar = mobileMemo.locator('[data-mobile-key-bar]')
    await keyBar.waitFor({ state: 'hidden' })
    const originalMobile = (await mobileMemo.boundingBox())!
    const setKeyboardViewport = async (height: number, offsetTop = 0, eventType = 'resize') => {
      await mobileMemo.evaluate((el, viewport) => {
        const visual = el.ownerDocument.defaultView!.visualViewport!
        Object.defineProperty(visual, 'height', { configurable: true, value: viewport.height })
        Object.defineProperty(visual, 'offsetTop', { configurable: true, value: viewport.offsetTop })
        const event = el.ownerDocument.createEvent('Event')
        event.initEvent(viewport.eventType, false, false)
        visual.dispatchEvent(event)
      }, { height, offsetTop, eventType })
    }
    const expectMemoTop = async (top: number) => {
      await mobileMemo.evaluate(async (el, expected) => {
        for (let frame = 0; frame < 60 && Math.abs(el.getBoundingClientRect().top - expected) > 0.5; frame++) {
          await new Promise(resolve => el.ownerDocument.defaultView!.requestAnimationFrame(resolve))
        }
      }, top)
      assert.equal((await mobileMemo.boundingBox())!.y, top)
    }
    await setKeyboardViewport(600)
    await expectMemoTop(originalMobile.y)
    await setKeyboardViewport(470)
    await expectMemoTop(470 - 24 - originalMobile.height)
    await keyBar.waitFor({ state: 'visible' })
    await keyBar.getByRole('button', { name: 'Ctrl', exact: true }).dispatchEvent('click')
    await keyBar.getByRole('button', { name: 'Shift', exact: true }).dispatchEvent('click')
    assert.equal((await mobileMemo.boundingBox())!.height, originalMobile.height, 'keyboard avoidance moves the popup without shrinking it')
    await setKeyboardViewport(260)
    await expectMemoTop(8)
    assert.ok((await mobileMemo.boundingBox())!.height > 260, 'a tall popup keeps its header visible even when the bottom cannot fit')
    await setKeyboardViewport(260, 95, 'scroll')
    await expectMemoTop(103)
    await mobileMemo.getByRole('button', { name: '닫기', exact: true }).waitFor({ state: 'visible' })
    await setKeyboardViewport(844)
    await expectMemoTop(originalMobile.y)
    await keyBar.waitFor({ state: 'hidden' })
    assert.equal(await mobileMemo.locator('.tiptap').evaluate(el => el === el.ownerDocument.activeElement), true, 'keyboard dismissal hides the extra keys even while the editor retains focus')
    assert.deepEqual(await mobileMemo.boundingBox(), originalMobile, 'dismissing the keyboard restores the original geometry')
    await setKeyboardViewport(470)
    await keyBar.waitFor({ state: 'visible' })
    assert.equal(await keyBar.getByRole('button', { name: 'Ctrl', exact: true }).getAttribute('aria-pressed'), 'false')
    assert.equal(await keyBar.getByRole('button', { name: 'Shift', exact: true }).getAttribute('aria-pressed'), 'false')
    await setKeyboardViewport(844)
    await keyBar.waitFor({ state: 'hidden' })
    await mobileMemo.evaluate(el => {
      const visual = el.ownerDocument.defaultView!.visualViewport!
      Reflect.deleteProperty(visual, 'height')
      Reflect.deleteProperty(visual, 'offsetTop')
    })
    await two.setViewportSize({ width: 390, height: 500 })
    await keyBar.waitFor({ state: 'visible' })
    await two.setViewportSize({ width: 390, height: 844 })
    await keyBar.waitFor({ state: 'hidden' })
    await memo.locator('[title="2명이 작업 중입니다"]').waitFor()
    await two.locator('.tiptap').press('Control+End'); await two.keyboard.press('Enter'); await two.keyboard.type('Second note')
    await memo.locator('p').filter({ hasText: 'Second note' }).waitFor()
    closeAllRooms()
    await one.keyboard.press('Control+End'); await one.keyboard.type('!')
    await two.locator('.tiptap').filter({ hasText: 'Second note!' }).waitFor()
    await one.getByRole('textbox', { name: 'Outside' }).click()
    assert.equal(await memo.isVisible(), true, 'outside clicks leave the popup open')
    await one.keyboard.press('Control+m')
    assert.equal(await memo.locator('.tiptap').evaluate(el => el === el.ownerDocument.activeElement), true)
    await one.keyboard.press('Control+m')
    assert.equal(await memo.isVisible(), false)
    await two.locator('[title="1명이 작업 중입니다"]').waitFor()
    assert.equal(await one.getByRole('textbox', { name: 'Outside' }).evaluate(el => el === el.ownerDocument.activeElement), true)
    await one.keyboard.press('Control+m'); await memo.waitFor()
    assert.equal(await one.locator('[data-dock-item=memo]').getAttribute('aria-pressed'), 'true')
    await one.locator('[data-dock-item=memo]').click()
    await memo.waitFor({ state: 'hidden' })
    assert.equal(await one.locator('[data-dock-item=memo]').getAttribute('aria-pressed'), 'false')
    await one.locator('[data-dock-item=memo]').click()
    await memo.waitFor()
    const reopenedText = await memo.locator('.tiptap').evaluate(element => {
      const content = element.cloneNode(true) as {
        textContent: string | null
        querySelectorAll(selector: string): Iterable<{ remove(): void }>
      }
      for (const label of content.querySelectorAll('.collaboration-carets__label')) label.remove()
      return content.textContent
    })
    assert.ok(reopenedText?.includes('Second note!'), `dock reopening preserves shared content: ${JSON.stringify(reopenedText)}`)
    const before = (await memo.boundingBox())!
    const handle = memo.getByRole('button', { name: '메모 위치 이동' })
    const handleBox = (await handle.boundingBox())!
    await one.mouse.move(handleBox.x + 70, handleBox.y + 15); await one.mouse.down(); await one.mouse.move(handleBox.x + 240, handleBox.y + 90); await one.mouse.up()
    const after = (await memo.boundingBox())!
    assert.ok(after.x > before.x + 100 && after.y > before.y + 50)
    const dragResize = async (direction: string, dx: number, dy: number) => {
      const box = (await memo.locator(`[data-resize="${direction}"]`).boundingBox())!
      await one.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await one.mouse.down()
      await one.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 3 })
      await one.mouse.up()
      return (await memo.boundingBox())!
    }
    for (const direction of ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se']) {
      const start = (await memo.boundingBox())!
      const dx = direction.includes('w') ? 24 : direction.includes('e') ? -24 : 0
      const dy = direction.includes('n') ? 24 : direction.includes('s') ? -24 : 0
      const smaller = await dragResize(direction, dx, dy)
      assert.deepEqual(smaller, {
        x: start.x + (direction.includes('w') ? 24 : 0),
        y: start.y + (direction.includes('n') ? 24 : 0),
        width: start.width - Math.abs(dx), height: start.height - Math.abs(dy),
      }, `${direction}: resizing keeps the opposite edges fixed`)
      assert.deepEqual(await dragResize(direction, -dx, -dy), start, `${direction}: expands again`)
    }
    const limited = await dragResize('se', 1500, 1500)
    assert.equal(limited.x, after.x)
    assert.equal(limited.y, after.y)
    assert.equal(limited.x + limited.width, 1092)
    assert.equal(limited.y + limited.height, 776)
    const minimum = await dragResize('nw', 1500, 1500)
    assert.equal(minimum.width, 280)
    assert.equal(minimum.height, 180)
    assert.equal(minimum.x + minimum.width, 1092)
    assert.equal(minimum.y + minimum.height, 776)
    await memo.locator('[data-resize=nw]').focus()
    await one.keyboard.press('ArrowLeft'); await one.keyboard.press('ArrowUp')
    const keyboardSize = (await memo.boundingBox())!
    assert.equal(keyboardSize.width, 296)
    assert.equal(keyboardSize.height, 196)
    await one.keyboard.press('Escape')
    await memo.waitFor({ state: 'hidden' })
    await one.keyboard.press('Control+m')
    await memo.waitFor()
    assert.deepEqual(await memo.boundingBox(), keyboardSize, 'closing preserves the resized geometry')
    await one.setViewportSize({ width: 360, height: 640 })
    await one.waitForFunction("(() => { const rect = document.querySelector('.shared-memo').getBoundingClientRect(); return rect.right <= innerWidth && rect.bottom <= innerHeight })()")
    await two.evaluate("document.documentElement.classList.remove('dark')")
    await two.getByRole('button', { name: '메모 위치 이동' }).focus(); await two.keyboard.press('ArrowRight')
    const mobile = (await two.getByRole('dialog').boundingBox())!
    assert.ok(mobile.x >= 0 && mobile.x + mobile.width <= 390)
    const touchHandle = (await two.locator('[data-resize=se]').boundingBox())!
    const touch = await two.context().newCDPSession(two)
    const touchX = touchHandle.x + touchHandle.width / 2, touchY = touchHandle.y + touchHandle.height / 2
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchX, y: touchY }] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchX - 32, y: touchY - 40 }] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await touch.detach()
    const touchSize = (await two.getByRole('dialog').boundingBox())!
    assert.equal(touchSize.width, mobile.width - 32)
    assert.equal(touchSize.height, mobile.height - 40)
    assert.equal(touchSize.x, mobile.x)
    assert.equal(touchSize.y, mobile.y)
    if (process.env.MEW_MEMO_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.MEW_MEMO_SCREENSHOT_DIR, { recursive: true })
      await two.screenshot({ path: path.join(process.env.MEW_MEMO_SCREENSHOT_DIR, 'memo-mobile-light.png') })
      await one.setViewportSize({ width: 1100, height: 800 })
      await one.screenshot({ path: path.join(process.env.MEW_MEMO_SCREENSHOT_DIR, 'memo-desktop-dark.png') })
    }
    await one.getByRole('button', { name: '닫기', exact: true }).click()
    await two.keyboard.press('Escape')
    assert.equal(await two.getByRole('dialog').isVisible(), false)
    await one.close(); await two.close()
    const reopened = await browser.newPage()
    reopened.setDefaultTimeout(5000)
    await reopened.goto(base); await reopened.keyboard.press('Control+m')
    await reopened.locator('.tiptap').filter({ hasText: 'Second note!' }).waitFor()
    assert.equal(await reopened.locator('.tiptap h1').count(), 1, 'reopening does not seed duplicate content')
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
