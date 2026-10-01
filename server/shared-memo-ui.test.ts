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

test('shared memo panel docking, focus, presence, shared editing and persisted reopen', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-memo-ui-'))
  process.env.MEW_DATA_DIR = directory
  const { attachCollabWebSocket, closeAllRooms } = await import('./collab.ts')
  const root = path.resolve(import.meta.dirname, '..')
  const source = `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {SharedMemo} from '${root}/src/components/shared-memo.tsx';
import {MobileDock} from '${root}/src/components/mobile-dock.tsx';
import {DockWorkspace,DockPanel} from '${root}/src/components/DockWorkspace.tsx';
import {useSharedMemo} from '${root}/src/hooks/use-shared-memo.ts';
import {useOverlayDismiss} from '@mew/ui';
import {I18nProvider} from '${root}/src/i18n.tsx';
localStorage.setItem('mew:locale','ko');
function Fixture(){
  const [open,setOpen]=useState(false),[focus,setFocus]=useState(0),[front,setFront]=useState('editor'),[dock,setDock]=useState(null),[project,setProject]=useState(0);
  const changeOpen=React.useCallback(value=>{setOpen(value);setFront(value?'memo':'editor')},[]);
  const session=useSharedMemo({authEmail:new URLSearchParams(location.search).get('user')||'one@example.test',open,onOpenChange:changeOpen,focusSignal:focus,onFocus:()=>setFront('memo')});
  useOverlayDismiss(open&&front==='memo'?session.close:false,{escapePhase:'bubble'});
  return <div style={{height:'100dvh',display:'flex',flexDirection:'column'}}>
    <button onClick={()=>setProject(value=>value+1)}>Switch project</button>
    <MobileDock active={front} openPanels={open?['editor','memo']:['editor']} available={['editor','memo']} hidden={false} onNavigate={()=>{}} onSelect={id=>{if(id==='memo'){changeOpen(innerWidth>=768&&front==='memo'?!open:true);setFocus(value=>value+1)}else setFront('editor')}}/>
    <DockWorkspace key={project} value={dock} onChange={setDock} foreground={front} apiRef={null} onEditorDrop={()=>''}>
      <DockPanel id="editor" kind="editor" tabs={['editor']} mobileSelected onFocus={()=>setFront('editor')}><input aria-label="Outside"/></DockPanel>
      <DockPanel id="memo" kind="memo" tabs={['memo']} visible={open} mobileSelected onFocus={()=>setFront('memo')}><SharedMemo session={session} open={open}/></DockPanel>
    </DockWorkspace>
  </div>
}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
  const bundle = await build({ input: 'virtual:memo.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'memo-fixture', resolveId(id) { if (id === 'virtual:memo.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' },
    load(id) { if (id === 'virtual:memo.tsx') return source; if (id === 'virtual:style') return '' },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const ui = (await Promise.all(['src/components/shared-memo.tsx', 'src/components/DockWorkspace.tsx', 'src/components/PresenceDots.tsx', 'src/components/mobile-dock.tsx', 'packages/editor/src/Editor.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
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
    const memo = one.getByRole('region', { name: '메모', exact: true })
    await memo.locator('.tiptap[contenteditable=true]').waitFor()
    await one.waitForFunction("document.activeElement?.classList.contains('tiptap')")
    await one.keyboard.type('# Shared memo'); await one.keyboard.press('Enter')
    await one.keyboard.type('First note')
    await two.locator('[data-dock-item=memo]').tap()
    await two.locator('.tiptap h1').filter({ hasText: 'Shared memo' }).waitFor()
    const mobileMemo = two.getByRole('region', { name: '메모', exact: true })
    await mobileMemo.locator('.tiptap[contenteditable=true]').focus()
    const keyBar = mobileMemo.locator('[data-mobile-key-bar]')
    await keyBar.waitFor({ state: 'hidden' })
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
    await setKeyboardViewport(600)
    await setKeyboardViewport(470)
    await keyBar.waitFor({ state: 'visible' })
    await keyBar.getByRole('button', { name: 'Ctrl', exact: true }).dispatchEvent('click')
    await keyBar.getByRole('button', { name: 'Shift', exact: true }).dispatchEvent('click')
    await setKeyboardViewport(260)
    await setKeyboardViewport(260, 95, 'scroll')
    await mobileMemo.getByRole('button', { name: '닫기', exact: true }).waitFor({ state: 'visible' })
    await setKeyboardViewport(844)
    await keyBar.waitFor({ state: 'hidden' })
    assert.equal(await mobileMemo.locator('.tiptap').evaluate(el => el === el.ownerDocument.activeElement), true, 'keyboard dismissal hides the extra keys even while the editor retains focus')
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
    assert.equal(await memo.isVisible(), true, 'outside clicks leave the panel open')
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
    const grip = one.locator('[data-dock-panel="memo"]').getByLabel('패널 이동')
    const gripBox = (await grip.boundingBox())!
    const editorBox = (await one.locator('[data-dock-panel="editor"]').boundingBox())!
    await one.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
    await one.mouse.down(); await one.mouse.move(editorBox.x + 8, editorBox.y + editorBox.height / 2, { steps: 8 }); await one.mouse.up()
    assert.ok((await memo.boundingBox())!.x < before.x, 'memo moves using the common dock grip')
    const separator = one.getByRole('separator')
    const separatorBox = (await separator.boundingBox())!
    const widthBeforeResize = (await memo.boundingBox())!.width
    await one.mouse.move(separatorBox.x + 2, separatorBox.y + 100); await one.mouse.down(); await one.mouse.move(separatorBox.x + 82, separatorBox.y + 100); await one.mouse.up()
    assert.ok((await memo.boundingBox())!.width > widthBeforeResize + 50, 'common dock separator resizes the memo')
    await memo.getByRole('tab', { name: '메모', exact: true }).dblclick()
    await one.locator('[data-dock-panel="memo"][data-dock-expanded]').waitFor()
    await one.keyboard.press('Escape')
    assert.equal(await one.locator('[data-dock-expanded]').count(), 0)
    assert.equal(await memo.isVisible(), true, 'first Escape restores the expanded panel')
    await one.getByRole('button', { name: 'Switch project' }).click()
    await memo.locator('.tiptap').waitFor()
    await memo.locator('.tiptap').filter({ hasText: 'Second note' }).waitFor()
    const remountedText = await memo.locator('.tiptap').evaluate(el => {
      const copy = el.cloneNode(true) as { textContent: string | null; querySelectorAll(selector: string): Iterable<{ remove(): void }> }
      for (const label of copy.querySelectorAll('.collaboration-carets__label')) label.remove()
      return copy.textContent
    })
    assert.ok(remountedText?.includes('Second note!'), 'project switches preserve the shared document')
    await memo.locator('.tiptap').focus()
    await one.keyboard.press('Escape')
    await memo.waitFor({ state: 'hidden' })
    await one.keyboard.press('Control+m')
    await memo.waitFor()
    await two.evaluate("document.documentElement.classList.remove('dark')")
    assert.equal(await two.locator('[data-resize]').count(), 0, 'popup resize handles are removed')
    assert.equal(await two.getByRole('dialog').count(), 0, 'memo is a workspace panel')
    assert.ok(await mobileMemo.evaluate(el => el.scrollWidth <= el.clientWidth), 'mobile memo fits its panel')
    if (process.env.MEW_MEMO_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.MEW_MEMO_SCREENSHOT_DIR, { recursive: true })
      await two.screenshot({ path: path.join(process.env.MEW_MEMO_SCREENSHOT_DIR, 'memo-mobile-light.png') })
      await one.setViewportSize({ width: 1100, height: 800 })
      await one.screenshot({ path: path.join(process.env.MEW_MEMO_SCREENSHOT_DIR, 'memo-desktop-dark.png') })
    }
    await one.getByRole('button', { name: '닫기', exact: true }).click()
    await two.keyboard.press('Escape')
    assert.equal(await mobileMemo.isVisible(), false)
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
