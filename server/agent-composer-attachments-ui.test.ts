import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Page } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
const photoToken = '[[.workspace:.mew/assets/photo copy.png]]'
const pendingToken = '[[mew-upload:69d56432-f275-4489-821f-8ae04804211f]]'
const dragOverlay = 'body > .cm-editor[aria-hidden="true"]'
type Position = { left: number; right: number; top: number; bottom: number }

async function rawDocument(page: Page): Promise<string> {
  return page.evaluate('window.composerFixture.raw()')
}

async function select(page: Page, from: number, to = from): Promise<void> {
  await page.evaluate(`window.composerFixture.select(${from},${to})`)
}

async function reset(page: Page, text: string): Promise<void> {
  await page.evaluate(`window.composerFixture.reset(${JSON.stringify(text)})`)
  await page.getByRole('textbox', { name: '첨부 테스트 입력', exact: true }).evaluate(element =>
    new Promise<void>(resolve => element.ownerDocument.defaultView!.requestAnimationFrame(() =>
      element.ownerDocument.defaultView!.requestAnimationFrame(() => resolve()))))
  assert.equal(await rawDocument(page), text)
}

async function settlePointer(page: Page): Promise<void> {
  await page.locator('.cm-content').evaluate(element => new Promise<void>(resolve =>
    element.ownerDocument.defaultView!.requestAnimationFrame(() =>
      element.ownerDocument.defaultView!.requestAnimationFrame(() => resolve()))))
}

async function holdAttachment(page: Page): Promise<void> {
  const button = page.locator('.cm-content [data-attachment-token]').getByRole('button', { name: 'photo copy.png 사진 미리보기', exact: true })
  const box = await button.boundingBox()
  assert.ok(box)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.locator(dragOverlay).waitFor({ state: 'attached' })
  assert.equal(await page.locator('.cm-content [data-attachment-dragging]').count(), 1)
}

async function moveToPosition(page: Page, position: number, steps = 8): Promise<void> {
  const coords = await page.evaluate<Position>(`window.composerFixture.coords(${position})`)
  assert.ok(coords)
  await page.mouse.move(coords.left + 1, (coords.top + coords.bottom) / 2, { steps })
  await settlePointer(page)
}

test('inline attachment editing and long-press moves preserve the controlled document on desktop/mobile', { skip: !domBrowserExecutable(), timeout: 60_000 }, async t => {
  const source = `
import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {EditorView} from '${root}/node_modules/@codemirror/view/dist/index.js';
import {AgentComposerInput} from '${root}/src/components/agent-composer-input.tsx';
localStorage.setItem('mew:locale','ko');
window.previewed=[];
function Fixture(){
  const [value,setValue]=React.useState('');
  const [generation,setGeneration]=React.useState(0);
  const input=React.useRef(null);
  const results=React.useRef(new Map());
  const view=()=>EditorView.findFromDOM(input.current.element);
  window.composerFixture={
    raw:()=>input.current.value,
    selected:()=>({from:input.current.selectionStart,to:input.current.selectionEnd}),
    select:(from,to=from)=>{input.current.focus();input.current.setSelectionRange(from,to)},
    insert:text=>input.current.insertText(text),
    replace:(token,text)=>{results.current.set(token,text);setValue(current=>current.replace(token,text))},
    coords:position=>{
      const previous={from:input.current.selectionStart,to:input.current.selectionEnd};
      input.current.setSelectionRange(position,position);
      const coords=view().coordsAtPos(view().state.selection.main.head);
      input.current.setSelectionRange(previous.from,previous.to);
      return coords;
    },
    reset:text=>{results.current.clear();setValue(text);setGeneration(current=>current+1)},
  };
  return <main style={{maxWidth:640,margin:'80px auto',padding:16}}>
    <div data-composer-shell onPointerDownCapture={event=>event.currentTarget.dataset.pointerType=event.pointerType} style={{height:156,padding:8,border:'1px solid var(--color-edge)',borderRadius:8,background:'var(--color-surface)',color:'var(--color-ink)',fontSize:16,lineHeight:'28px'}}>
      <AgentComposerInput key={generation} value={value} onChange={next=>setValue(next)} onKeyDown={()=>{}}
        inputRef={input} label="첨부 테스트 입력" placeholder="텍스트 입력" style={{height:'100%'}}
        resolvePendingToken={token=>results.current.get(token)}
        attachmentForToken={token=>({name:token.includes('mew-upload:')?'업로드 중.png':token.slice(2,-2).split('/').at(-1),mimeType:'image/png',pending:token.includes('mew-upload:'),preview:()=>window.previewed.push(token)})}/>
    </div>
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const candidates = [source]
  const bundle = await build({
    input: 'virtual:inline-attachments.tsx', write: false, platform: 'browser',
    output: { format: 'iife', codeSplitting: false },
    onwarn(warning, warn) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning) },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{
      name: 'inline-attachment-fixture',
      resolveId(id) {
        if (id === 'virtual:inline-attachments.tsx') return id
        if (id.endsWith('.css')) return 'virtual:css'
      },
      async load(id) {
        if (id === 'virtual:inline-attachments.tsx') return source
        if (id === 'virtual:css') return ''
        if (id.endsWith('.tsx')) candidates.push(await fs.readFile(id, 'utf8'))
      },
    }],
  })
  const chunk = bundle.output.find(item => item.type === 'chunk')
  assert.ok(chunk)
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set(candidates.join('\n').match(/[A-Za-z0-9_@!&:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  for (const width of [1100, 390]) for (const dark of [true, false]) {
    await t.test(`${width}px ${dark ? 'dark' : 'light'}`, async matrix => {
      const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: width === 390, locale: 'ko-KR', reducedMotion: 'reduce' })
      page.setDefaultTimeout(4000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      matrix.after(() => page.close())
      await page.route('http://mew-inline-attachments.test/**', route => route.fulfill(new URL(route.request().url()).pathname === '/app.js'
        ? { contentType: 'text/javascript', body: chunk.code }
        : { contentType: 'text/html', body: `<!doctype html><html class="${dark ? 'dark' : ''}" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}html,body{margin:0;min-height:100%;background:var(--color-surface-deep);color:var(--color-ink)}</style><div id="root"></div><script src="/app.js"></script></html>` }))
      await page.goto('http://mew-inline-attachments.test/')
      const input = page.getByRole('textbox', { name: '첨부 테스트 입력', exact: true })
      await input.waitFor()

      await matrix.test('inline insertion, cursor movement, atomic deletion and undo', async () => {
        await reset(page, 'alpha omega')
        await select(page, 6)
        await page.evaluate(`window.composerFixture.insert(${JSON.stringify(photoToken)})`)
        const original = `alpha ${photoToken}omega`
        assert.equal(await rawDocument(page), original)
        const attachment = input.locator('[data-attachment-token]')
        await attachment.getByRole('button', { name: 'png 첨부 제거', exact: true }).waitFor()
        assert.equal(await input.textContent(), 'alpha omega', 'raw upload paths stay hidden behind the inline icon tag')
        assert.equal(await attachment.evaluate(element => element.parentElement?.classList.contains('cm-line')), true)
        assert.equal(await attachment.evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).display), 'inline-flex')
        assert.deepEqual(await page.evaluate('window.composerFixture.selected()'), { from: 6 + photoToken.length, to: 6 + photoToken.length })
        await input.press('ArrowLeft')
        assert.deepEqual(await page.evaluate('window.composerFixture.selected()'), { from: 6, to: 6 }, 'left arrow skips the whole attachment')
        await input.press('ArrowRight')
        assert.deepEqual(await page.evaluate('window.composerFixture.selected()'), { from: 6 + photoToken.length, to: 6 + photoToken.length }, 'right arrow skips the whole attachment')
        await page.keyboard.type('R')
        await select(page, 6)
        await page.keyboard.type('L')
        const typed = `alpha L${photoToken}Romega`
        assert.equal(await rawDocument(page), typed, 'ordinary text can be typed on both sides of the tag')
        await select(page, 7)
        await input.press('Delete')
        assert.equal(await rawDocument(page), 'alpha LRomega', 'Delete removes one complete attachment')
        await input.press('Control+z')
        assert.equal(await rawDocument(page), typed, 'undo restores the deleted attachment and its metadata')
        await select(page, 7 + photoToken.length)
        await input.press('Backspace')
        assert.equal(await rawDocument(page), 'alpha LRomega', 'Backspace removes one complete attachment')
        await input.press('Control+z')
        assert.equal(await rawDocument(page), typed)
        await select(page, 6, 7 + photoToken.length + 1)
        await page.evaluate(`window.composerFixture.insert(${JSON.stringify(photoToken)})`)
        assert.equal(await rawDocument(page), `alpha ${photoToken}omega`, 'insertion replaces the focused selection')
        assert.deepEqual(errors, [])
      })

      await matrix.test('pending upload replacement keeps edits and the attachment position', async () => {
        await reset(page, 'left right')
        await select(page, 5)
        await page.evaluate(`window.composerFixture.insert(${JSON.stringify(pendingToken)})`)
        await input.getByRole('status', { name: '첨부 중…', exact: true }).waitFor()
        await select(page, 0)
        await page.keyboard.type('new ')
        await page.evaluate(`window.composerFixture.replace(${JSON.stringify(pendingToken)},${JSON.stringify(photoToken)})`)
        await input.getByRole('button', { name: 'photo copy.png 사진 미리보기', exact: true }).waitFor()
        assert.equal(await rawDocument(page), `new left ${photoToken}right`)
        assert.equal(await input.getByRole('status').count(), 0)
        assert.equal((await input.innerText()).includes('.mew/assets'), false)
        await reset(page, 'left right')
        await select(page, 5)
        await page.evaluate(`window.composerFixture.insert(${JSON.stringify(pendingToken)})`)
        await page.evaluate(`window.composerFixture.replace(${JSON.stringify(pendingToken)},${JSON.stringify(photoToken)})`)
        await input.getByRole('button', { name: 'photo copy.png 사진 미리보기', exact: true }).waitFor()
        assert.equal(await rawDocument(page), `left ${photoToken}right`)
        await input.press('Control+z')
        assert.equal(await rawDocument(page), 'left right', 'undo after upload completion removes the completed inline attachment')
        await input.press('Control+Shift+z')
        assert.equal(await rawDocument(page), `left ${photoToken}right`, 'redo restores the completed attachment rather than a stale upload')
        assert.equal(await input.getByRole('status').count(), 0)
        await select(page, 5, 5 + photoToken.length)
        const copied = await input.evaluate(element => {
          const browserWindow = element.ownerDocument.defaultView!
          const data = new browserWindow.DataTransfer()
          element.dispatchEvent(new browserWindow.ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
          return data.getData('text/plain')
        })
        assert.equal(copied, photoToken, 'copy exports the completed file reference rather than the internal upload identity')
        assert.deepEqual(errors, [])
      })

      await matrix.test('settled uploads restored through undo and redo use the final reference', async settlement => {
        for (const deletion of ['Backspace', 'remove button']) {
          await settlement.test(`pending deletion with ${deletion}`, async () => {
            await reset(page, 'left right')
            await select(page, 5)
            await page.evaluate(`window.composerFixture.insert(${JSON.stringify(pendingToken)})`)
            await input.getByRole('status', { name: '첨부 중…', exact: true }).waitFor()
            if (deletion === 'Backspace') await input.press('Backspace')
            else await input.getByRole('button', { name: 'png 첨부 제거', exact: true }).click()
            assert.equal(await rawDocument(page), 'left right')
            await page.evaluate(`window.composerFixture.replace(${JSON.stringify(pendingToken)},${JSON.stringify(photoToken)})`)
            await input.press('Control+z')
            assert.equal(await rawDocument(page), `left ${photoToken}right`, `undoing ${deletion} after upload completion restores the final file`)
            assert.equal(await input.getByRole('status').count(), 0)
            await input.press('Control+Shift+z')
            assert.equal(await rawDocument(page), 'left right', `redoing ${deletion} removes the completed file again`)
          })
        }

        await settlement.test('pending insertion undone before completion', async () => {
          await reset(page, 'left right')
          await select(page, 5)
          await page.evaluate(`window.composerFixture.insert(${JSON.stringify(pendingToken)})`)
          await input.press('Control+z')
          assert.equal(await rawDocument(page), 'left right')
          await page.evaluate(`window.composerFixture.replace(${JSON.stringify(pendingToken)},${JSON.stringify(photoToken)})`)
          await input.press('Control+Shift+z')
          assert.equal(await rawDocument(page), `left ${photoToken}right`, 'redoing a pending insertion after completion restores the final file')
          assert.equal(await input.getByRole('status').count(), 0)
          assert.deepEqual(errors, [])
        })
      })

      await matrix.test('failed uploads cannot restore stale loading tags through undo', async () => {
        for (const deleteBeforeFailure of [false, true]) {
          await reset(page, 'left right')
          await select(page, 5)
          await page.evaluate(`window.composerFixture.insert(${JSON.stringify(pendingToken)})`)
          await input.getByRole('status', { name: '첨부 중…', exact: true }).waitFor()
          if (deleteBeforeFailure) {
            await input.getByRole('button', { name: 'png 첨부 제거', exact: true }).click()
            assert.equal(await rawDocument(page), 'left right')
          }
          await page.evaluate(`window.composerFixture.replace(${JSON.stringify(pendingToken)},'')`)
          await settlePointer(page)
          assert.equal(await rawDocument(page), 'left right')
          await input.press('Control+z')
          assert.equal((await rawDocument(page)).includes('[[mew-upload:'), false, 'a failed upload stays absent when its former insertion or deletion is undone')
          assert.equal(await input.getByRole('status').count(), 0)
        }
        assert.deepEqual(errors, [])
      })

      await matrix.test('ordinary pointer click opens preview once', async () => {
        await reset(page, `before ${photoToken} after`)
        const previous = await page.evaluate<number>('window.previewed.length')
        await input.getByRole('button', { name: 'photo copy.png 사진 미리보기', exact: true }).click()
        assert.equal(await page.evaluate<number>('window.previewed.length'), previous + 1)
        assert.equal(await rawDocument(page), `before ${photoToken} after`)
        assert.deepEqual(errors, [])
      })

      await matrix.test('held pointer moves inline attachment and undo restores its position', async () => {
        const original = `Start ${photoToken} middle end\nsecond line`
        await reset(page, original)
        const previous = await page.evaluate<number>('window.previewed.length')
        await holdAttachment(page)
        await moveToPosition(page, 0, 80)
        await page.mouse.up()
        const moved = `${photoToken}Start  middle end\nsecond line`
        assert.equal(await rawDocument(page), moved)
        assert.equal(await page.evaluate<number>('window.previewed.length'), previous, 'dragging does not also open preview')
        assert.equal(await page.locator('body > [aria-hidden="true"]').count(), 0)
        await input.press('Control+z')
        assert.equal(await rawDocument(page), original)
        await input.press('Control+Shift+z')
        assert.equal(await rawDocument(page), moved)
        await holdAttachment(page)
        await moveToPosition(page, moved.length)
        await page.mouse.up()
        assert.equal(await rawDocument(page), `Start  middle end\nsecond line${photoToken}`, 'the tag moves across explicit line breaks')
        await input.press('Control+z')
        assert.equal(await rawDocument(page), moved)
        const screenshotDir = '/tmp/mew-inline-attachments'
        await fs.mkdir(screenshotDir, { recursive: true })
        await page.screenshot({ path: path.join(screenshotDir, `inline-${width}-${dark ? 'dark' : 'light'}.png`) })
        assert.deepEqual(errors, [])
      })

      await matrix.test('Escape and release outside the editor cancel the pointer move', async () => {
        const original = `Start ${photoToken} middle end`
        await reset(page, original)
        const previous = await page.evaluate<number>('window.previewed.length')
        await holdAttachment(page)
        await moveToPosition(page, 0)
        await page.keyboard.press('Escape')
        await page.mouse.up()
        assert.equal(await rawDocument(page), original)
        assert.equal(await page.locator('body > [aria-hidden="true"]').count(), 0)
        await holdAttachment(page)
        await page.mouse.move(width / 2, 400, { steps: 8 })
        await settlePointer(page)
        await page.mouse.up()
        assert.equal(await rawDocument(page), original, 'dropping outside the editing region leaves the token in place')
        assert.equal(await page.locator('body > [aria-hidden="true"]').count(), 0)
        assert.equal(await page.evaluate<number>('window.previewed.length'), previous)
        assert.deepEqual(errors, [])
      })

      if (width === 390 && dark) await matrix.test('native touch long press moves the attachment with pointer capture', async touchTest => {
        const original = `Start ${photoToken} middle end`
        await reset(page, original)
        const button = input.getByRole('button', { name: 'photo copy.png 사진 미리보기', exact: true })
        const box = await button.boundingBox()
        assert.ok(box)
        assert.equal(await button.locator('..').evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).touchAction), 'none')
        const client = await page.context().newCDPSession(page)
        touchTest.after(() => client.detach())
        const previous = await page.evaluate<number>('window.previewed.length')
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }] })
        try {
          await page.locator(dragOverlay).waitFor({ state: 'attached' })
          assert.equal(await page.locator('[data-composer-shell]').getAttribute('data-pointer-type'), 'touch')
          const coords = await page.evaluate<Position>('window.composerFixture.coords(0)')
          assert.ok(coords)
          await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: coords.left + 1, y: (coords.top + coords.bottom) / 2, id: 1 }] })
          await settlePointer(page)
        } finally {
          await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        }
        assert.equal(await rawDocument(page), `${photoToken}Start  middle end`)
        assert.equal(await page.evaluate<number>('window.previewed.length'), previous)
        assert.equal(await page.locator('body > [aria-hidden="true"]').count(), 0)
        await input.press('Control+z')
        assert.equal(await rawDocument(page), original)
        assert.deepEqual(errors, [])
      })
    })
  }
})
