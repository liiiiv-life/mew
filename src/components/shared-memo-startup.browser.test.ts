import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from '../../server/browser-dom-executable.ts'

test('delayed memo focus protects the existing editor and preserves each reopen target', { skip: !domBrowserExecutable(), timeout: 15_000 }, async t => {
  const memo = new URL('./shared-memo.tsx', import.meta.url).pathname
  const hook = new URL('../hooks/use-shared-memo.ts', import.meta.url).pathname
  const deferred = new URL('./deferred-component.tsx', import.meta.url).pathname
  const i18n = new URL('../i18n.tsx', import.meta.url).pathname
  const code = new URL('./CodePane.tsx', import.meta.url).pathname
  const react = import.meta.resolve('react'), reactDom = import.meta.resolve('react-dom/client')
  const result = await build({
    input: 'virtual:memo.tsx', write: false, platform: 'browser', output: { format: 'esm' },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('production') } },
    plugins: [{
      name: 'delayed-memo',
      resolveId(id) {
        if (id.startsWith('virtual:')) return id
        if (id === '@mew/editor') return 'virtual:editor.tsx'
        if (id.endsWith('.css')) return 'virtual:style'
      },
      load(id) {
        if (id === 'virtual:style') return ''
        if (id === code) return 'export function CodePane(){return null}'
        if (id === 'virtual:editor.tsx') return `import React from ${JSON.stringify(react)}; export const Editor=React.forwardRef(()=> <div contentEditable className="tiptap"/>);`
        if (id === 'virtual:memo.tsx') return `
          import React from ${JSON.stringify(react)};
          import {createRoot} from ${JSON.stringify(reactDom)};
          import {useSharedMemo} from ${JSON.stringify(hook)};
          import {deferredComponent} from ${JSON.stringify(deferred)};
          import {I18nProvider} from ${JSON.stringify(i18n)};
          const SharedMemo=deferredComponent(async()=>({default:(await import(${JSON.stringify(memo)})).SharedMemo}));
          localStorage.setItem('mew:locale','ko');
          window.WebSocket=class {static OPEN=1;readyState=0;send(){}close(){this.readyState=3}};
          function Fixture(){
            const [open,setOpen]=React.useState(false);
            const session=useSharedMemo({authEmail:'fixture@test',open,onOpenChange:setOpen});
            const mounted=React.useRef(false);if(open)mounted.current=true;
            return <><textarea aria-label="Existing editor" defaultValue="Keep this text"/><textarea aria-label="Other editor"/><button onMouseDown={event=>event.preventDefault()} onClick={()=>setOpen(true)}>Open memo</button>{mounted.current && <div hidden={!open}><SharedMemo session={session} open={open}/></div>}</>;
          }
          createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
      },
    }],
  })
  const chunks = result.output.filter(chunk => chunk.type === 'chunk')
  const entry = chunks.find(chunk => chunk.isEntry)!
  const memoChunk = chunks.find(chunk => memo in chunk.modules)!
  const scripts = new Map(chunks.map(chunk => [`/${chunk.fileName}`, chunk.code]))
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ locale: 'ko-KR' })
  page.setDefaultTimeout(3000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let releaseMemo: (() => void) | undefined, onMemoRequest: (() => void) | undefined
  const memoRequested = new Promise<void>(resolve => { onMemoRequest = resolve })
  await page.route('http://memo-focus.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === `/${memoChunk.fileName}`) await new Promise<void>(resolve => { releaseMemo = resolve; onMemoRequest!() })
    const script = scripts.get(path)
    await route.fulfill(script !== undefined ? { contentType: 'text/javascript', body: script }
      : { contentType: 'text/html', body: `<html><body><div id="root"></div><script type="module" src="/${entry.fileName}"></script></body></html>` })
  })
  await page.goto('http://memo-focus.test/')
  const existing = page.getByRole('textbox', { name: 'Existing editor' })
  await existing.focus()
  await existing.press('Control+m')
  await memoRequested
  await page.getByRole('status').waitFor({ state: 'attached' })
  await existing.evaluate(el => new Promise<void>(resolve => el.ownerDocument.defaultView!.requestAnimationFrame(() => el.ownerDocument.defaultView!.requestAnimationFrame(() => resolve()))))
  assert.equal(await existing.evaluate(el => el === el.ownerDocument.activeElement), true, 'the pre-download focus attempt has finished while the memo is still absent')
  assert.ok(releaseMemo)
  releaseMemo()
  const region = page.getByRole('region', { name: '메모', exact: true })
  await region.waitFor()
  await region.evaluate(el => new Promise<void>(resolve => el.ownerDocument.defaultView!.requestAnimationFrame(() => resolve())))
  assert.equal(await region.evaluate(el => el === el.ownerDocument.activeElement), true, 'module completion moves focus into the memo panel')
  assert.equal(await region.locator('.tiptap').evaluate(el => el === el.ownerDocument.activeElement), false, 'opening a memo does not force focus into its text input')
  await page.keyboard.type('unrelated keystrokes')
  assert.equal(await existing.inputValue(), 'Keep this text', 'keystrokes cannot modify the previously focused editor')
  await region.getByRole('button', { name: '닫기', exact: true }).click()
  await region.waitFor({ state: 'hidden' })
  assert.equal(await existing.evaluate(el => el === el.ownerDocument.activeElement), true)
  const other = page.getByRole('textbox', { name: 'Other editor' })
  await other.focus()
  await page.getByRole('button', { name: 'Open memo', exact: true }).click()
  await region.waitFor()
  await region.evaluate(el => new Promise<void>(resolve => el.ownerDocument.defaultView!.requestAnimationFrame(() => resolve())))
  assert.equal(await region.evaluate(el => el === el.ownerDocument.activeElement), true)
  await region.getByRole('button', { name: '닫기', exact: true }).click()
  await region.waitFor({ state: 'hidden' })
  assert.equal(await other.evaluate(el => el === el.ownerDocument.activeElement), true, 'a reopened memo restores the current opener instead of the first editor')
  assert.deepEqual(errors, [])
})
