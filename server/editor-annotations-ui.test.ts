import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Locator, type Page } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const initialContent = '# Annotation fixture\n\n선택할 본문과 커서 위치를 확인합니다.\n\n다음 문단을 유지합니다.\n'

async function selectText(editor: Locator, text: string, collapsed = false) {
  await editor.click()
  await editor.evaluate(async (el, { text, collapsed }) => {
    const doc = el.ownerDocument
    const walker = doc.createTreeWalker(el, 4)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const offset = node.textContent?.indexOf(text) ?? -1
      if (offset < 0) continue
      const range = doc.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + text.length)
      if (collapsed) range.collapse(false)
      const selection = doc.defaultView!.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      await new Promise<void>(resolve => doc.defaultView!.requestAnimationFrame(() => doc.defaultView!.requestAnimationFrame(() => resolve())))
      return
    }
    throw new Error(`Text not found in editor: ${text}`)
  }, { text, collapsed })
}

async function sourceValue(page: Page): Promise<string> {
  return page.locator('[data-fixture-value]').getAttribute('data-fixture-value') as Promise<string>
}

async function waitForSource(page: Page, text: string) {
  await page.waitForFunction(`document.querySelector('[data-fixture-value]')?.getAttribute('data-fixture-value')?.includes(${JSON.stringify(text)})`)
}

async function assertWithinViewport(dialog: Locator, viewport: { width: number; height: number }) {
  const box = await dialog.boundingBox()
  assert.ok(box, 'annotation dialog is visible')
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
    JSON.stringify({ viewport, dialog: box }))
}

test('Markdown annotations preserve selections, edit in popovers, round-trip through Plain, and respect readonly on desktop and mobile', {
  skip: !domBrowserExecutable(), timeout: 90_000,
}, async t => {
  const repo = path.resolve(import.meta.dirname, '..')
  const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {EditorPane} from ${JSON.stringify(path.join(repo, 'src/components/EditorPane.tsx'))};
import {I18nProvider} from ${JSON.stringify(path.join(repo, 'src/i18n.tsx'))};
import {insertAnnotation} from ${JSON.stringify(path.join(repo, 'packages/editor/src/editor/annotations.ts'))};
window.annotationFixtureInsert=insertAnnotation;
const noop=()=>{};
const callbacks=Object.fromEntries(['registerHandle','registerElement','registerTabBar','onFocus','onActivate','onPin','onCloseTab','onReorder','onOpenLink','onOpenHistory','onSetTocOpen','onOpenSidebar','onTabDragMove','onTabDrop'].map(key=>[key,noop]));
function Fixture(){
  const [value,setValue]=React.useState(()=>localStorage.getItem('annotation-fixture-value')??${JSON.stringify(initialContent)});
  const [viewMode,setMode]=React.useState('hotview');
  const readOnly=new URLSearchParams(location.search).has('readonly');
  const update=(_,next)=>{localStorage.setItem('annotation-fixture-value',next);setValue(next)};
  return <div className="flex h-dvh flex-col bg-surface-deep text-ink" data-fixture-value={value}>
    <EditorPane {...callbacks} pane={{id:'fixture',activePath:'fixture.md',tabs:[{path:'fixture.md',content:value,viewMode,editable:!readOnly,preview:false}]}}
      onChangeContent={update} onSetViewMode={(_,mode)=>setMode(mode)} role="guest" authEmail={null} project="docs" tree={[]} presence={{}}
      focused isGuest={false} showSidebarButton={false} tocOpen={false} dropZone={null}/>
  </div>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
  const candidates = [source], styles: string[] = []
  const bundle = await build({
    input: 'virtual:annotations.tsx', write: false, platform: 'browser', output: { format: 'esm', codeSplitting: false },
    onwarn(warning, warn) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning) },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{
      name: 'annotations-fixture',
      resolveId(id) { if (id === 'virtual:annotations.tsx') return id },
      async load(id) {
        if (id === 'virtual:annotations.tsx') return source
        if (id.endsWith('.tsx')) candidates.push(await fs.readFile(id, 'utf8'))
        if (id.endsWith('.css')) { styles.push(await fs.readFile(id, 'utf8')); return { code: '', moduleType: 'js' } }
      },
    }],
  })
  const compiler = await compile(await fs.readFile(path.join(repo, 'src/index.css'), 'utf8'), { base: path.join(repo, 'src'), onDependency() {} })
  const css = compiler.build([...new Set(candidates.join('\n').match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + styles.join('\n')
  const entry = bundle.output.find(item => item.type === 'chunk' && item.isEntry)!
  assert.ok(entry.type === 'chunk')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  const screenshotDir = process.env.MEW_EDITOR_SCREENSHOT_DIR
  if (screenshotDir) await fs.mkdir(screenshotDir, { recursive: true })

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, hasTouch: viewport.width < 768, locale: 'ko-KR' })
    page.setDefaultTimeout(5000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      localStorage.setItem('mew:locale', 'ko')
      localStorage.setItem('mew:ui-locale', 'ko')
    })
    await page.route('http://mew-annotations.test/**', route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/comments') return route.fulfill({ json: { threads: [] } })
      if (url.pathname === '/api/members') return route.fulfill({ json: { members: [] } })
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] })
      if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: entry.code })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` })
    })
    await page.goto('http://mew-annotations.test/')
    const editor = page.locator('.ProseMirror')
    await editor.getByText('선택할 본문과 커서 위치를 확인합니다.', { exact: true }).waitFor()
    const listButton = page.getByRole('button', { name: '주석 목록', exact: true })
    const commentBox = (await page.getByRole('button', { name: '댓글 목록', exact: true }).boundingBox())!
    const annotationBox = (await listButton.boundingBox())!
    assert.ok(annotationBox.x >= commentBox.x + commentBox.width && annotationBox.x - commentBox.x - commentBox.width <= 10,
      'annotation list button sits immediately after comments')

    await selectText(editor, '본문과')
    await page.keyboard.press("Control+Quote")
    const first = page.getByRole('dialog', { name: '주석 1)', exact: true })
    const input = page.getByRole('textbox', { name: '주석 내용', exact: true })
    await first.waitFor()
    if (viewport.width >= 768) assert.equal(await input.evaluate(el => el.ownerDocument.activeElement === el), true, 'new annotation focuses its input')
    await input.fill('처음 주석')
    await waitForSource(page, '1. 처음 주석')
    assert.match(await sourceValue(page), /선택할 본문과\^\[1\] 커서 위치를 확인합니다\./, 'selection text remains and the marker is inserted after it')
    assert.equal(await editor.locator('sup[data-annotation-number="1"]').textContent(), '1')
    assert.equal(await editor.locator('sup[data-annotation-number="1"]').evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el, '::after').content), '")"')
    assert.equal(await editor.getByText('$Annotations$', { exact: true }).isVisible(), false)
    assert.equal(await editor.getByText('처음 주석', { exact: true }).isVisible(), false, 'annotation metadata is hidden in Hotview')
    await assertWithinViewport(first, viewport)
    await first.getByRole('button', { name: '닫기', exact: true }).click()
    await editor.locator('sup[data-annotation-number="1"]').click()
    await first.waitFor()
    assert.equal(await input.inputValue(), '처음 주석')
    await input.fill('')
    await input.pressSequentially('Hello world')
    assert.equal(await input.inputValue(), 'Hello world', 'typing a space does not trim the current input or join words')
    await input.press('Enter')
    await input.pressSequentially('Second line')
    assert.equal(await input.inputValue(), 'Hello world\nSecond line', 'a typed newline remains available while entering the next paragraph')
    await waitForSource(page, 'Hello world')
    await waitForSource(page, 'Second line')
    await first.getByRole('button', { name: '닫기', exact: true }).click()
    await page.reload()
    await editor.locator('sup[data-annotation-number="1"]').waitFor()
    await editor.locator('sup[data-annotation-number="1"]').click()
    await first.waitFor()
    assert.equal(await input.inputValue(), 'Hello world\nSecond line', 'typed spaces and paragraphs survive saving and reloading')
    await input.fill('수정한 주석')
    await waitForSource(page, '1. 수정한 주석')
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `annotation-edit-${viewport.width}.png`) })
    await first.getByRole('button', { name: '닫기', exact: true }).click()

    await selectText(editor, '다음 문단', true)
    await page.keyboard.press('Control+Quote')
    const second = page.getByRole('dialog', { name: '주석 2)', exact: true })
    await second.waitFor()
    await input.fill('두 번째 주석')
    await waitForSource(page, '2. 두 번째 주석')
    assert.match(await sourceValue(page), /다음 문단\^\[2\]을 유지합니다\./, 'a collapsed cursor inserts without removing nearby text')
    await second.getByRole('button', { name: '닫기', exact: true }).click()

    await listButton.click()
    const list = page.getByRole('dialog', { name: '주석 목록', exact: true })
    await list.waitFor()
    await listButton.click()
    await list.waitFor({ state: 'hidden' })
    await listButton.click()
    await list.waitFor()
    await list.getByRole('button', { name: /1\).*수정한 주석/ }).waitFor()
    await list.getByRole('button', { name: /2\).*두 번째 주석/ }).waitFor()
    await assertWithinViewport(list, viewport)
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `annotation-list-${viewport.width}.png`) })
    await list.getByRole('button', { name: /1\).*수정한 주석/ }).click()
    await first.waitFor()
    assert.equal(await input.inputValue(), '수정한 주석')

    // Apply a document transaction without moving focus out of the open textarea,
    // as a collaborator inserting a marker before the annotation would do.
    assert.equal(await editor.evaluate(el => {
      const tiptap = (el as unknown as { editor: {
        commands: { setTextSelection: (position: number) => boolean }
      } }).editor
      tiptap.commands.setTextSelection(1)
      const fixture = el.ownerDocument.defaultView as unknown as { annotationFixtureInsert: (editor: unknown) => number | null }
      return fixture.annotationFixtureInsert(tiptap)
    }), 1)
    await first.waitFor({ state: 'hidden' })
    await waitForSource(page, '2. 수정한 주석')
    await waitForSource(page, '3. 두 번째 주석')
    assert.equal(await editor.locator('sup[data-annotation-number]').count(), 3)
    await editor.locator('sup[data-annotation-number="2"]').click()
    await second.waitFor()
    assert.equal(await input.inputValue(), '수정한 주석', 'renumbering closes the old popup without changing its annotation')
    await second.getByRole('button', { name: '닫기', exact: true }).click()
    await editor.locator('sup[data-annotation-number="1"]').click()
    await first.waitFor()
    assert.equal(await input.inputValue(), '')
    await first.getByRole('button', { name: '주석 삭제', exact: true }).click()
    await page.waitForFunction("document.querySelectorAll('.ProseMirror sup[data-annotation-number]').length === 2")
    await waitForSource(page, '1. 수정한 주석')
    await waitForSource(page, '2. 두 번째 주석')

    const beforeSwitch = await sourceValue(page)
    await page.getByRole('button', { name: 'Plain', exact: true }).click()
    await page.locator('.cm-content').waitFor()
    assert.match(await page.locator('.cm-content').innerText(), /# \$Annotations\$/)
    assert.match(await page.locator('.cm-content').innerText(), /1\. 수정한 주석/)
    assert.equal(await sourceValue(page), beforeSwitch, 'opening Plain preserves the Markdown bytes')
    await page.locator('.cm-line').filter({ hasText: /^다음 문단/ }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Control+Quote')
    const third = page.getByRole('dialog', { name: '주석 3)', exact: true })
    await third.waitFor()
    await input.fill('Plain에서 추가')
    await waitForSource(page, '3. Plain에서 추가')
    await third.getByRole('button', { name: '닫기', exact: true }).click()
    await listButton.click()
    await list.getByRole('button', { name: /3\).*Plain에서 추가/ }).click()
    await third.waitFor()
    await input.fill('Plain에서 편집')
    await waitForSource(page, '3. Plain에서 편집')
    await third.getByRole('button', { name: '주석 삭제', exact: true }).click()
    await page.waitForFunction("!document.querySelector('[data-fixture-value]')?.getAttribute('data-fixture-value')?.includes('3. Plain에서 편집')")
    assert.doesNotMatch(await sourceValue(page), /\^\[3\]|Plain에서 편집/, 'the list can edit and delete annotations while Plain is active')
    await listButton.click()
    await list.getByRole('button', { name: '주석 추가', exact: true }).click()
    await third.waitFor()
    await input.fill('Plain에서 추가')
    await waitForSource(page, '3. Plain에서 추가')
    await third.getByRole('button', { name: '닫기', exact: true }).click()
    const withThree = await sourceValue(page)
    await page.getByRole('button', { name: 'Hotview', exact: true }).click()
    await editor.locator('sup[data-annotation-number="3"]').waitFor()
    assert.equal(await editor.locator('sup[data-annotation-number]').count(), 3)
    assert.equal(await sourceValue(page), withThree)
    assert.doesNotMatch(await editor.innerText(), /\$Annotations\$|수정한 주석|두 번째 주석|Plain에서 추가/)

    await page.reload()
    await editor.locator('sup[data-annotation-number="3"]').waitFor()
    assert.equal(await sourceValue(page), withThree, 'reloading parses the saved inline markers and definitions')
    await editor.locator('sup[data-annotation-number="1"]').click()
    await first.waitFor()
    assert.equal(await input.inputValue(), '수정한 주석')
    await first.getByRole('button', { name: '닫기', exact: true }).click()

    await page.goto('http://mew-annotations.test/?readonly=1')
    await editor.locator('sup[data-annotation-number="1"]').waitFor()
    assert.equal(await editor.getAttribute('contenteditable'), 'false')
    await editor.locator('sup[data-annotation-number="1"]').click()
    await first.waitFor()
    assert.equal(await input.inputValue(), '수정한 주석')
    assert.equal(await input.evaluate(el => el.hasAttribute('readonly') || el.hasAttribute('disabled')), true)
    const remove = first.getByRole('button', { name: '주석 삭제', exact: true })
    assert.ok(await remove.count() === 0 || await remove.isDisabled(), 'readonly annotations cannot be deleted')
    await first.getByRole('button', { name: '닫기', exact: true }).click()
    await editor.click()
    await page.keyboard.press('Control+Quote')
    assert.equal(await page.getByRole('dialog', { name: /^주석 \d+\)$/ }).count(), 0, 'readonly shortcut does not create annotations')
    assert.equal(await sourceValue(page), withThree)
    await listButton.click()
    await list.waitFor()
    const add = list.getByRole('button', { name: '주석 추가', exact: true })
    assert.ok(await add.count() === 0 || await add.isDisabled())

    await page.goto('http://mew-annotations.test/')
    await editor.locator('sup[data-annotation-number="3"]').waitFor()
    await editor.locator('sup[data-annotation-number="2"]').click()
    await second.waitFor()
    await second.getByRole('button', { name: '주석 삭제', exact: true }).click()
    await page.waitForFunction("document.querySelectorAll('.ProseMirror sup[data-annotation-number]').length === 2")
    assert.doesNotMatch(await sourceValue(page), /두 번째 주석|\^\[3\]/)
    assert.match(await sourceValue(page), /2\. Plain에서 추가/, 'removing a middle annotation renumbers its remaining definition and marker')
    for (const count of [2, 1]) {
      await editor.locator('sup[data-annotation-number="1"]').click()
      await first.waitFor()
      await first.getByRole('button', { name: '주석 삭제', exact: true }).click()
      await page.waitForFunction(`document.querySelectorAll('.ProseMirror sup[data-annotation-number]').length === ${count - 1}`)
    }
    const afterDelete = await sourceValue(page)
    assert.doesNotMatch(afterDelete, /\$Annotations\$|\^\[\d+\]/, 'deleting the final annotation removes the storage section')
    assert.match(afterDelete, /선택할 본문과 커서 위치를 확인합니다\./)
    assert.match(afterDelete, /다음 문단을 유지합니다\./)
    assert.deepEqual(errors, [])
    await page.close()
  }
})
