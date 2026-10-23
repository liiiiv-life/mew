import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Locator, type Page } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const markdown = '# Context fixture\n\nAlpha selected text omega.\n\nSecond paragraph target.\n\n<br/>\n'
const code = 'const selected = "value";\nconst next = "target";\n'
const labels = ['주석 추가', '댓글 달기', '복사', '잘라내기', '붙여넣기', '삭제', '전체 선택']

async function control(page: Page, action: 'reset' | 'set' | 'clipboard' | 'release', values: Record<string, unknown> = {}) {
  await page.locator('[data-context-fixture]').evaluate((el, { action, values }) => {
    const fixture = el.ownerDocument.defaultView as unknown as { contextFixtureControl: (action: string, values: Record<string, unknown>) => void }
    fixture.contextFixtureControl(action, values)
  }, { action, values })
}

async function value(page: Page) { return (await page.locator('[data-context-fixture]').getAttribute('data-value'))! }
function surface(page: Page) { return page.locator('.ProseMirror, .cm-content') }
function menu(page: Page) { return page.getByRole('menu', { name: '에디터 메뉴', exact: true }) }
function item(page: Page, label: string) { return menu(page).getByRole('menuitem', { name: label, exact: true }) }

async function reset(page: Page, values: Record<string, unknown> = {}) {
  const previous = await page.locator('[data-context-fixture]').getAttribute('data-generation')
  await control(page, 'reset', values)
  await page.waitForFunction(({ el, previous }) => el.getAttribute('data-generation') !== previous, { el: await page.locator('[data-context-fixture]').elementHandle(), previous })
  await surface(page).waitFor()
}

async function point(page: Page, text: string, offset = 0) {
  return surface(page).evaluate((el, { text, offset }) => {
    const doc = el.ownerDocument, walker = doc.createTreeWalker(el, 4)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(text) ?? -1
      if (at < 0) continue
      const range = doc.createRange()
      range.setStart(node, at + offset)
      range.collapse(true)
      const rect = range.getBoundingClientRect()
      return { x: rect.left + .2, y: rect.top + rect.height / 2 }
    }
    throw new Error(`Context text not found: ${text}`)
  }, { text, offset })
}

async function select(page: Page, text: string) {
  const editor = surface(page)
  await editor.click()
  await editor.evaluate((el, text) => {
    const doc = el.ownerDocument, walker = doc.createTreeWalker(el, 4)
    el.focus({ preventScroll: true })
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(text) ?? -1
      if (at < 0) continue
      const range = doc.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + text.length)
      const selection = doc.defaultView!.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      doc.dispatchEvent(new doc.defaultView!.Event('selectionchange'))
      return
    }
    throw new Error(`Selection text not found: ${text}`)
  }, text)
  await page.waitForFunction(({ el, text }) => {
    const fixture = el.ownerDocument.defaultView as unknown as { contextFixtureSelection: () => string | null }
    return fixture.contextFixtureSelection() === text
  }, { el: await editor.elementHandle(), text })
}

async function open(page: Page, text: string, offset = 0) {
  const at = await point(page, text, offset)
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await menu(page).waitFor()
}

async function clipboardWaiting(page: Page, kind: 'readWaiting' | 'writeWaiting') {
  await page.waitForFunction(({ el, kind }) => {
    const fixture = el.ownerDocument.defaultView as unknown as { contextClipboard: Record<string, unknown> }
    return fixture.contextClipboard[kind] === true
  }, { el: await page.locator('[data-context-fixture]').elementHandle(), kind })
}

async function settle(page: Page) {
  await page.locator('[data-context-fixture]').evaluate(el => new Promise<void>(resolve => el.ownerDocument.defaultView!.requestAnimationFrame(() => el.ownerDocument.defaultView!.requestAnimationFrame(() => resolve()))))
}

async function assertMenu(menu: Locator, width: number, height: number) {
  assert.equal(await menu.getByRole('menuitem').count(), labels.length)
  for (const label of labels) {
    const row = menu.getByRole('menuitem', { name: label, exact: true })
    assert.equal(await row.count(), 1)
    assert.equal(await row.evaluate(el => {
      const nodes = el.childNodes as ArrayLike<{ nodeType: number; textContent: string | null }>
      const icon = el.querySelector('svg'), text = Array.from(nodes).find(node => node.nodeType === 3 && node.textContent?.trim())
      if (!icon || !text) return false
      const range = el.ownerDocument.createRange()
      range.selectNodeContents(text)
      return icon.getBoundingClientRect().right < range.getBoundingClientRect().left
    }), true, `${label} has its icon before its text`)
  }
  const box = await menu.boundingBox()
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height)
}

test('editor context menus preserve native selections and apply scoped actions in Hotview, Plain, and code', {
  skip: !domBrowserExecutable(), timeout: 120_000,
}, async t => {
  const repo = path.resolve(import.meta.dirname, '..')
  const source = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {EditorPane} from ${JSON.stringify(path.join(repo, 'src/components/EditorPane.tsx'))};
import {I18nProvider} from ${JSON.stringify(path.join(repo, 'src/i18n.tsx'))};
const noop=()=>{},defaults={path:'fixture.md',value:${JSON.stringify(markdown)},viewMode:'hotview',editable:true,access:true,workspace:'/fixture/workspace-a'};
const clip=window.contextClipboard={text:'PASTED',writes:[],failRead:false,failWrite:false,holdRead:false,holdWrite:false,readWaiting:false,writeWaiting:false};
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
 async readText(){if(clip.failRead)throw Error('read denied');if(clip.holdRead){clip.readWaiting=true;await new Promise(resolve=>clip.releaseRead=resolve);clip.readWaiting=false}return clip.text},
 async writeText(text){if(clip.failWrite)throw Error('write denied');if(clip.holdWrite){clip.writeWaiting=true;await new Promise(resolve=>clip.releaseWrite=resolve);clip.writeWaiting=false}clip.text=text;clip.writes.push(text)}
}});
const exec=document.execCommand.bind(document);document.execCommand=(name,...args)=>name==='copy'&&clip.failWrite?false:exec(name,...args);
const callbacks=Object.fromEntries(['registerElement','registerTabBar','onFocus','onActivate','onPin','onCloseTab','onReorder','onOpenLink','onOpenHistory','onSetTocOpen','onOpenSidebar','onTabDragMove','onTabDrop'].map(key=>[key,noop]));
function Fixture(){const [state,setState]=React.useState({...defaults,generation:0});const handle=React.useRef(null);
 window.contextFixtureSelection=()=>handle.current?.getSelectedText()??null;
 window.contextFixtureControl=(action,values)=>{if(action==='reset')setState(old=>({...defaults,...values,generation:old.generation+1}));else if(action==='set')setState(old=>({...old,...values}));else if(action==='clipboard')Object.assign(clip,values);else{clip.releaseRead?.();clip.releaseWrite?.()}};
 const register=React.useCallback((_,next)=>handle.current=next,[]);
 return <div className="flex h-dvh flex-col bg-surface-deep text-ink" data-context-fixture data-value={state.value} data-generation={state.generation} data-workspace={state.workspace} data-editable={state.editable}>
 <EditorPane key={state.generation} {...callbacks} registerHandle={register} workspace={{path:state.workspace}} canCollaborate={state.access}
 pane={{id:'fixture',activePath:state.path,tabs:[{path:state.path,content:state.value,viewMode:state.viewMode,editable:state.editable,preview:false}]}}
 onChangeContent={(_,value)=>setState(old=>({...old,value}))} onSetViewMode={(_,viewMode)=>setState(old=>({...old,viewMode}))}
 role="guest" authEmail="saens@example.test" project="docs" tree={[]} presence={{}} focused isGuest={false} showSidebarButton={false} tocOpen={false} dropZone={null}/></div>;
}createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
  const candidates = [source], styles: string[] = []
  const bundle = await build({ input: 'virtual:editor-context.tsx', write: false, platform: 'browser', output: { format: 'esm', codeSplitting: false },
    onwarn(warning, warn) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning) },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'editor-context-fixture', resolveId(id) { if (id === 'virtual:editor-context.tsx') return id }, async load(id) {
      if (id === 'virtual:editor-context.tsx') return source
      if (id.endsWith('.tsx')) candidates.push(await fs.readFile(id, 'utf8'))
      if (id.endsWith('.css')) { styles.push(await fs.readFile(id, 'utf8')); return { code: '', moduleType: 'js' } }
    } }],
  })
  const compiler = await compile(await fs.readFile(path.join(repo, 'src/index.css'), 'utf8'), { base: path.join(repo, 'src'), onDependency() {} })
  const css = compiler.build([...new Set(candidates.join('\n').match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + styles.join('\n')
  const entry = bundle.output.find(item => item.type === 'chunk' && item.isEntry)!
  assert.ok(entry.type === 'chunk')
  const javascript = entry.code
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  const captures = process.env.MEW_CONTEXT_MENU_SCREENSHOT_DIR
  if (captures) await fs.mkdir(captures, { recursive: true })
  async function createPage(width: number, theme: string) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: width < 768, locale: 'ko-KR' })
    page.setDefaultTimeout(5000)
    await page.addInitScript(() => { localStorage.setItem('mew:locale', 'ko'); localStorage.setItem('mew:ui-locale', 'ko') })
    await page.route('http://mew-editor-context.test/**', route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/comments') return route.fulfill({ json: { threads: [] } })
      if (url.pathname === '/api/members') return route.fulfill({ json: { members: [] } })
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] })
      return route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: javascript }
        : { contentType: 'text/html', body: `<!doctype html><html class="${theme === 'dark' ? 'dark' : ''}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` })
    })
    await page.goto('http://mew-editor-context.test/')
    await surface(page).getByText('Alpha selected text omega.', { exact: true }).waitFor()
    return page
  }

  for (const width of [1280, 390]) for (const theme of ['light', 'dark']) {
    const page = await createPage(width, theme)
    await select(page, 'selected text')
    await open(page, 'selected text', 3)
    await assertMenu(menu(page), width, 844)
    if (captures) await page.screenshot({ path: path.join(captures, `editor-menu-${width}-${theme}.png`) })
    await item(page, '복사').click()
    assert.equal(await page.locator('[data-context-fixture]').evaluate(el => (el.ownerDocument.defaultView as unknown as { contextClipboard: { text: string } }).contextClipboard.text), 'selected text', 'right clicking inside a selection preserves the copied text')
    await control(page, 'set', { editable: false })
    await page.locator('[data-editable="false"]').waitFor()
    await open(page, 'selected text', 3)
    assert.equal(await menu(page).getByRole('menuitem').count(), 7)
    for (const label of ['주석 추가', '댓글 달기', '잘라내기', '붙여넣기', '삭제']) assert.equal(await item(page, label).isDisabled(), true, `readonly disables ${label}`)
    await page.close()
  }

  const page = await createPage(1280, 'light')
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await select(page, 'selected text')
  await open(page, 'Second paragraph target.', 6)
  for (const label of ['복사', '잘라내기', '삭제']) assert.equal(await item(page, label).isDisabled(), true, `a right click outside the old selection clears ${label}`)
  await item(page, '주석 추가').click()
  const annotation = page.getByRole('dialog', { name: '주석 1)', exact: true })
  await annotation.waitFor()
  assert.match(await value(page), /Second.*\^\[1\].*paragraph target\./)
  assert.match(await value(page), /Alpha selected text omega\./)
  await annotation.getByRole('button', { name: '닫기', exact: true }).click()
  await reset(page)
  await surface(page).locator('p').filter({ hasText: /^$/ }).last().click({ button: 'right', position: { x: 12, y: 6 } })
  await menu(page).waitFor()
  assert.equal(await item(page, '댓글 달기').isDisabled(), true, 'an empty paragraph has no comment target')
  await page.keyboard.press('Escape')

  for (const viewMode of ['hotview', 'plain']) {
    await reset(page, { viewMode })
    await open(page, 'Second paragraph target.', 6)
    await item(page, '댓글 달기').click()
    const comment = page.getByRole('dialog', { name: '댓글', exact: true })
    await comment.getByTitle('Second paragraph target.', { exact: true }).waitFor()
    await comment.getByRole('button', { name: '댓글 닫기', exact: true }).click()
    await select(page, 'selected text')
    await open(page, 'selected text', 3)
    await control(page, 'clipboard', { failWrite: true })
    const unchanged = await value(page)
    await item(page, '복사').click()
    await page.getByText('복사하지 못했습니다. Ctrl/Cmd+C로 다시 시도하세요.', { exact: true }).waitFor()
    await open(page, 'selected text', 3)
    await item(page, '잘라내기').click()
    await page.getByText('잘라내지 못했습니다. Ctrl/Cmd+X로 다시 시도하세요.', { exact: true }).waitFor()
    assert.equal(await value(page), unchanged, 'a denied clipboard write never cuts the selection')
    await control(page, 'clipboard', { failWrite: false })
    await open(page, 'selected text', 3)
    await item(page, '잘라내기').click()
    await page.waitForFunction(el => !el.getAttribute('data-value')?.includes('selected text'), await page.locator('[data-context-fixture]').elementHandle())
    await reset(page, { viewMode })
    await select(page, 'selected text')
    await open(page, 'selected text', 3)
    await control(page, 'clipboard', { failRead: true })
    await item(page, '붙여넣기').click()
    await page.getByText('붙여넣지 못했습니다. Ctrl/Cmd+V로 다시 시도하세요.', { exact: true }).waitFor()
    await control(page, 'clipboard', { failRead: false })
    await open(page, 'selected text', 3)
    await control(page, 'clipboard', { text: 'PASTED' })
    await item(page, '붙여넣기').click()
    await page.waitForFunction(el => el.getAttribute('data-value')?.includes('Alpha PASTED omega.'), await page.locator('[data-context-fixture]').elementHandle())
    await reset(page, { viewMode })
    await select(page, 'selected text')
    await open(page, 'selected text', 3)
    await item(page, '삭제').click()
    assert.doesNotMatch(await value(page), /selected text/)
    await open(page, 'Second paragraph target.', 6)
    await item(page, '전체 선택').click()
    const all = await page.locator('[data-context-fixture]').evaluate(el => (el.ownerDocument.defaultView as unknown as { contextFixtureSelection: () => string | null }).contextFixtureSelection())
    assert.match(all ?? '', /Context fixture[\s\S]*Alpha[\s\S]*Second paragraph target/)
    await open(page, 'Second paragraph target.', 6)
    assert.equal(await item(page, '복사').isDisabled(), false)
    await page.keyboard.press('Escape')
  }

  await reset(page, { path: 'fixture.ts', value: code, viewMode: 'plain' })
  await select(page, 'selected')
  await open(page, 'selected', 3)
  assert.equal(await item(page, '주석 추가').isDisabled(), true)
  await item(page, '복사').click()
  assert.equal(await page.locator('[data-context-fixture]').evaluate(el => (el.ownerDocument.defaultView as unknown as { contextClipboard: { text: string } }).contextClipboard.text), 'selected')
  await open(page, 'next', 2)
  await item(page, '댓글 달기').click()
  await page.getByRole('dialog', { name: '댓글', exact: true }).getByTitle('const next = "target";', { exact: true }).waitFor()
  await page.getByRole('button', { name: '댓글 닫기', exact: true }).click()
  const blank = await page.locator('.cm-scroller').boundingBox()
  assert.ok(blank)
  await page.mouse.click(blank.x + 100, blank.y + blank.height - 16, { button: 'right' })
  await menu(page).waitFor()
  assert.equal(await item(page, '복사').isDisabled(), true)
  await control(page, 'clipboard', { text: 'TAIL' })
  await item(page, '붙여넣기').click()
  await page.waitForFunction(({ el, expected }) => el.getAttribute('data-value') === expected, { el: await page.locator('[data-context-fixture]').elementHandle(), expected: code + 'TAIL' })

  for (const scope of [{ workspace: '/fixture/workspace-b' }, { path: 'other.md' }, { viewMode: 'plain' }, { editable: false }]) {
    await reset(page)
    await open(page, 'Second paragraph target.', 6)
    await control(page, 'clipboard', { text: 'LATE PASTE', holdRead: true })
    await item(page, '붙여넣기').click()
    await clipboardWaiting(page, 'readWaiting')
    await control(page, 'set', scope)
    await settle(page)
    await control(page, 'release')
    await settle(page)
    assert.equal(await value(page), markdown, `pending paste is discarded after ${JSON.stringify(scope)}`)
    await control(page, 'clipboard', { holdRead: false })
  }
  await reset(page)
  await select(page, 'selected text')
  await open(page, 'selected text', 3)
  await control(page, 'clipboard', { holdWrite: true })
  await item(page, '잘라내기').click()
  await clipboardWaiting(page, 'writeWaiting')
  await control(page, 'set', { editable: false })
  await page.locator('[data-editable="false"]').waitFor()
  await control(page, 'release')
  await settle(page)
  assert.equal(await value(page), markdown, 'pending clipboard write cannot cut after edit access is revoked')
  await control(page, 'clipboard', { holdWrite: false })

  await reset(page, { value: '| H1 | H2 |\n|---|---|\n| A1 | A2 |\n' })
  await surface(page).getByText('A2', { exact: true }).click({ button: 'right' })
  await menu(page).waitFor()
  for (const name of ['행 추가', '열 추가', 'csv로 복사', '이미지로 복사']) await menu(page).getByRole('menuitem', { name, exact: true }).waitFor()
  await menu(page).getByRole('menuitem', { name: /^md로 복사/ }).waitFor()
  if (captures) await page.screenshot({ path: path.join(captures, 'editor-menu-table-1280-light.png') })
  await menu(page).getByRole('menuitem', { name: '행 추가', exact: true }).click()
  assert.equal(await surface(page).locator('tr').count(), 3)
  assert.deepEqual(errors, [])
  await page.close()
})
