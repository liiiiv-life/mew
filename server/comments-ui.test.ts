import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Locator, type Page } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

interface CommentThread {
  id: string
  anchor: unknown
  comments: { id: string; author: string; time: number; text: string; edited?: number }[]
}

const content = '# 함께 다듬는 문서\n\n선택한 문장에 의견을 남기고 함께 확인합니다.\n\n본문은 댓글을 작성해도 그대로 유지됩니다.\n'
const author = 'saens@example.test'
const firstText = '이 문장은 조금 더 구체적으로 설명하면 좋겠습니다.'
const replyText = '좋아요. 실제 사용 예시를 한 줄 더 추가하겠습니다.'
const failureText = '댓글 저장을 다시 시도해 주세요.'

async function selectQuote(editor: Locator) {
  await editor.click()
  await editor.evaluate(el => {
    const doc = el.ownerDocument
    el.focus({ preventScroll: true })
    const walker = doc.createTreeWalker(el, 4)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const offset = node.textContent?.indexOf('선택한 문장') ?? -1
      if (offset < 0) continue
      const range = doc.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + '선택한 문장'.length)
      const selection = doc.defaultView!.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      // Feed the native selection through ProseMirror's DOM observer before its
      // deferred focus reconciliation can restore the previous collapsed caret.
      doc.dispatchEvent(new doc.defaultView!.Event('selectionchange'))
      return
    }
    throw new Error('Comment quote was not found')
  })
  try {
    await editor.page().waitForFunction(el => {
      const state = (el as unknown as { editor: { state: {
        selection: { from: number; to: number }
        doc: { textBetween: (from: number, to: number) => string }
      } } }).editor.state
      return el.ownerDocument.activeElement === el
        && el.ownerDocument.defaultView!.getSelection()?.toString() === '선택한 문장'
        && state.doc.textBetween(state.selection.from, state.selection.to) === '선택한 문장'
    }, await editor.elementHandle())
  } catch (error) {
    const state = await editor.evaluate(el => ({
      native: el.ownerDocument.defaultView!.getSelection()?.toString(),
      active: el.ownerDocument.activeElement?.className,
      selection: (el as unknown as { editor: { state: { selection: { toJSON: () => unknown } } } }).editor.state.selection.toJSON(),
    }))
    throw new Error(`${String(error)}\nComment selection did not synchronize: ${JSON.stringify(state)}`)
  }
}

function composerInput(page: Page) { return page.getByPlaceholder('댓글 입력 — @로 멤버 멘션', { exact: true }) }
function replyInput(page: Page) { return page.getByPlaceholder('답글 — @로 멤버 멘션', { exact: true }) }
function containingPopover(input: Locator) { return input.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " fixed ")][1]') }

async function withinViewport(dialog: Locator, viewport: { width: number; height: number }) {
  const bounds = await dialog.boundingBox()
  assert.ok(bounds, 'comment surface is visible')
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1,
    JSON.stringify({ viewport, bounds }))
}

async function assertOverlayTheme(dialog: Locator, theme: string) {
  const style = await dialog.evaluate(el => {
    const computed = el.ownerDocument.defaultView!.getComputedStyle(el)
    return { background: computed.backgroundColor, backdrop: computed.backdropFilter }
  })
  const alpha = /\/\s*([\d.]+)\s*\)$/.exec(style.background)
    ?? /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/.exec(style.background)
  assert.equal(alpha ? Number(alpha[1]) : 1, theme === 'light' ? .75 : 1, `comment overlay fill: ${style.background}`)
  assert.equal(style.backdrop, theme === 'light' ? 'blur(6px)' : 'none')
}

test('comments open with Ctrl+Shift+C, preserve failed drafts, and support post, reply, edit, and delete across themes and mobile', {
  skip: !domBrowserExecutable(), timeout: 120_000,
}, async t => {
  const repo = path.resolve(import.meta.dirname, '..')
  const baselineSource = process.env.MEW_COMMENTS_BASELINE_SOURCE
  const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {EditorPane} from ${JSON.stringify(path.join(repo, 'src/components/EditorPane.tsx'))};
import {I18nProvider} from ${JSON.stringify(path.join(repo, 'src/i18n.tsx'))};
${baselineSource ? "import {matchesShortcut} from '@mew/shortcuts';" : `import {captureCommentShortcut} from ${JSON.stringify(path.join(repo, 'src/utils/comment-shortcut.ts'))};`}
const noop=()=>{};
const callbacks=Object.fromEntries(['registerElement','registerTabBar','onFocus','onActivate','onPin','onCloseTab','onReorder','onOpenLink','onOpenHistory','onSetTocOpen','onOpenSidebar','onTabDragMove','onTabDrop'].map(key=>[key,noop]));
function Fixture(){
  const [value,setValue]=React.useState(${JSON.stringify(content)});
  const [viewMode,setMode]=React.useState('hotview');
  const [access,setAccess]=React.useState(true);
  const [workspacePath,setWorkspacePath]=React.useState('/fixture/workspace-a');
  window.commentFixtureSetScope=next=>{if(next.enabled!==undefined)setAccess(next.enabled);if(next.workspace!==undefined)setWorkspacePath(next.workspace)};
  const handle=React.useRef(null);
  React.useEffect(()=>{
    ${baselineSource ? `const onKey=event=>{if(matchesShortcut(event,'Ctrl+Shift+C')){event.preventDefault();handle.current?.startComment()}};
    window.addEventListener('keydown',onKey,true);
    return ()=>window.removeEventListener('keydown',onKey,true);` : 'return captureCommentShortcut({enabled:()=>true,startComment:()=>handle.current?.startComment()??false});'}
  },[]);
  const register=React.useCallback((_,next)=>{handle.current=next},[]);
  return <div className="flex h-dvh flex-col bg-surface-deep text-ink" data-workspace-panel="editor" data-fixture-value={value} data-fixture-access={access} data-fixture-workspace={workspacePath}>
    <EditorPane {...callbacks} registerHandle={register} canCollaborate={access} workspace={{path:workspacePath}}
      pane={{id:'fixture',activePath:'fixture.md',tabs:[{path:'fixture.md',content:value,viewMode,editable:true,preview:false}]}}
      onChangeContent={(_,next)=>setValue(next)} onSetViewMode={(_,mode)=>setMode(mode)} role="guest" authEmail=${JSON.stringify(author)} project="docs" tree={[]} presence={{}}
      focused isGuest={false} showSidebarButton={false} tocOpen={false} dropZone={null}/>
  </div>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
  const candidates = [source], styles: string[] = []
  const bundle = await build({
    input: 'virtual:comments.tsx', write: false, platform: 'browser', output: { format: 'esm', codeSplitting: false },
    onwarn(warning, warn) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning) },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{
      name: 'comments-fixture',
      resolveId(id) { if (id === 'virtual:comments.tsx') return id },
      async load(id) {
        if (id === 'virtual:comments.tsx') return source
        if (baselineSource && id === path.join(repo, 'src/components/Comments.tsx')) {
          const original = await fs.readFile(baselineSource, 'utf8')
          candidates.push(original)
          return original
        }
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
  const screenshotDir = process.env.MEW_COMMENTS_SCREENSHOT_DIR
  if (screenshotDir) await fs.mkdir(screenshotDir, { recursive: true })

  for (const viewport of process.env.MEW_COMMENTS_SCOPE_ONLY ? [] : [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport, hasTouch: viewport.width < 768, locale: 'ko-KR', colorScheme: theme as 'light' | 'dark' })
      page.setDefaultTimeout(5000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.addInitScript(() => {
        localStorage.setItem('mew:locale', 'ko')
        localStorage.setItem('mew:ui-locale', 'ko')
      })
      let threads: CommentThread[] = []
      let failNext: string | null = null
      let nextId = 0
      const requests: string[] = []
      await page.route('http://mew-comments.test/**', route => {
        const request = route.request(), url = new URL(request.url()), method = request.method()
        if (url.pathname === '/api/comments') {
          if (method === 'GET') return route.fulfill({ json: { threads } })
          requests.push(method)
          if (method === failNext) {
            failNext = null
            return route.fulfill({ status: 503, json: { error: failureText } })
          }
          if (method === 'POST') {
            const body = request.postDataJSON() as { threadId?: string; anchor?: CommentThread['anchor']; text: string }
            let thread = threads.find(item => item.id === body.threadId)
            if (!thread) {
              thread = { id: `thread-${++nextId}`, anchor: body.anchor!, comments: [] }
              threads.push(thread)
            }
            thread.comments.push({ id: `comment-${++nextId}`, author, time: Date.UTC(2026, 9, 22, 4, 30), text: body.text })
            return route.fulfill({ json: { ok: true, thread } })
          }
          if (method === 'PUT') {
            const body = request.postDataJSON() as { threadId: string; commentId: string; text: string }
            const thread = threads.find(item => item.id === body.threadId)!
            const comment = thread.comments.find(item => item.id === body.commentId)!
            comment.text = body.text
            comment.edited = Date.UTC(2026, 9, 22, 4, 35)
            return route.fulfill({ json: { ok: true, thread } })
          }
          if (method === 'DELETE') {
            const thread = threads.find(item => item.id === url.searchParams.get('threadId'))!
            thread.comments = thread.comments.filter(item => item.id !== url.searchParams.get('commentId'))
            if (!thread.comments.length) threads = threads.filter(item => item !== thread)
            return route.fulfill({ json: { ok: true, thread: thread.comments.length ? thread : null } })
          }
        }
        if (url.pathname === '/api/members') return route.fulfill({ json: { members: [author, 'minji@example.test'] } })
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] })
        if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: entry.code })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="${theme === 'dark' ? 'dark' : ''}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-comments.test/')
      const editor = page.locator('.ProseMirror')
      await editor.getByText('선택한 문장에 의견을 남기고 함께 확인합니다.', { exact: true }).waitFor()
      await selectQuote(editor)
      const prevented = await editor.evaluate(el => {
        const win = el.ownerDocument.defaultView!
        const event = new win.KeyboardEvent('keydown', { key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
        el.dispatchEvent(event)
        return event.defaultPrevented
      })
      assert.equal(prevented, true, 'Ctrl+Shift+C consumes the browser default')
      const input = composerInput(page)
      try { await input.waitFor() } catch (error) {
        const selection = await editor.evaluate(el => ({
          selected: el.ownerDocument.defaultView!.getSelection()?.toString(),
          state: (el as unknown as { editor: { state: { selection: { toJSON: () => unknown } } } }).editor.state.selection.toJSON(),
        }))
        throw new Error(`${String(error)}\nViewport: ${viewport.width}, theme: ${theme}\nSelection: ${JSON.stringify(selection)}\nBrowser errors: ${JSON.stringify(errors)}`)
      }
      const composer = baselineSource ? containingPopover(input) : page.getByRole('dialog', { name: '댓글', exact: true })
      if (!baselineSource) {
        assert.equal(await composer.getAttribute('role'), 'dialog')
        assert.equal(await composer.getAttribute('aria-label'), '댓글')
        await composer.getByRole('button', { name: '댓글 닫기', exact: true }).click()
        await input.waitFor({ state: 'hidden' })
        await selectQuote(editor)
        await page.keyboard.press('Control+Shift+C')
        await input.waitFor()
        assert.equal(await input.getAttribute('aria-label'), '댓글 내용')
      }
      await input.fill(firstText)
      await withinViewport(composer, viewport)
      if (!baselineSource) await assertOverlayTheme(composer, theme)
      if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `composer-${viewport.width}-${theme}.png`) })
      if (!baselineSource) {
        assert.equal(await composer.getAttribute('role'), 'dialog')
        failNext = 'POST'
        await composer.getByRole('button', { name: '댓글 달기', exact: true }).click()
        await composer.getByRole('alert').waitFor()
        assert.equal(await input.inputValue(), firstText, 'a failed comment keeps its draft')
      }
      await composer.getByRole('button', { name: '댓글 달기', exact: true }).click()
      await input.waitFor({ state: 'hidden' })
      assert.equal(threads.length, 1)
      const listButton = page.getByRole('button', { name: '댓글 목록', exact: true })
      await listButton.click()
      const listItem = page.getByRole('button').filter({ hasText: firstText })
      try { await listItem.waitFor() } catch (error) {
        throw new Error(`${String(error)}\nComment dialogs: ${await page.getByRole('dialog').allTextContents()}\nButton state: ${await listButton.getAttribute('aria-expanded')}\nThreads: ${JSON.stringify(threads)}\nBrowser errors: ${JSON.stringify(errors)}`)
      }
      if (!baselineSource) {
        const list = page.getByRole('dialog', { name: '댓글 목록', exact: true })
        await withinViewport(list, viewport)
        await assertOverlayTheme(list, theme)
        await listButton.click()
        await list.waitFor({ state: 'hidden' })
        await listButton.click()
        await list.waitFor()
        await page.getByRole('button', { name: '주석 목록', exact: true }).click()
        const annotations = page.getByRole('dialog', { name: '주석 목록', exact: true })
        await annotations.waitFor()
        await list.waitFor({ state: 'hidden' })
        await listButton.click()
        await list.waitFor()
        await annotations.waitFor({ state: 'hidden' })
      }
      if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `list-${viewport.width}-${theme}.png`) })
      await listItem.click()
      const reply = replyInput(page)
      await reply.waitFor()
      const thread = baselineSource ? containingPopover(reply) : page.getByRole('dialog', { name: '댓글', exact: true })
      await withinViewport(thread, viewport)
      if (!baselineSource) await assertOverlayTheme(thread, theme)
      await reply.fill(replyText)
      if (!baselineSource) assert.equal(await reply.evaluate(el => el.scrollHeight <= el.clientHeight + 1), true, 'a short wrapped reply remains visible without clipping its first line')
      if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `thread-${viewport.width}-${theme}.png`) })
      if (baselineSource) { await page.close(); continue }
      assert.equal(await thread.getAttribute('role'), 'dialog')
      failNext = 'POST'
      await thread.getByRole('button', { name: '답글 달기', exact: true }).click()
      await thread.getByRole('alert').waitFor()
      assert.equal(await reply.inputValue(), replyText, 'a failed reply keeps its draft')
      await thread.getByRole('button', { name: '답글 달기', exact: true }).click()
      await thread.getByText(replyText, { exact: true }).waitFor()
      await page.waitForFunction(el => (el as unknown as { value: string }).value === '', await reply.elementHandle())
      assert.equal(await reply.inputValue(), '')
      await thread.getByText(firstText, { exact: true }).hover()
      await thread.getByRole('button', { name: '댓글 수정', exact: true }).first().click()
      const edit = thread.getByRole('textbox', { name: '댓글 수정 입력', exact: true })
      await edit.fill('취소할 수정')
      await edit.press('Escape')
      await edit.waitFor({ state: 'hidden' })
      await thread.waitFor()
      await thread.getByText(firstText, { exact: true }).hover()
      await thread.getByRole('button', { name: '댓글 수정', exact: true }).first().click()
      await edit.fill('명확한 예시를 추가해 주세요.')
      failNext = 'PUT'
      await thread.getByRole('button', { name: '저장', exact: true }).click()
      await thread.getByRole('alert').waitFor()
      assert.equal(await edit.inputValue(), '명확한 예시를 추가해 주세요.', 'a failed edit remains open with its draft')
      await thread.getByRole('button', { name: '저장', exact: true }).click()
      await edit.waitFor({ state: 'hidden' })
      await thread.getByText('명확한 예시를 추가해 주세요.', { exact: true }).waitFor()
      await thread.getByText(replyText, { exact: true }).hover()
      failNext = 'DELETE'
      await thread.getByRole('button', { name: '댓글 삭제', exact: true }).last().click()
      await thread.getByRole('alert').waitFor()
      await thread.getByText(replyText, { exact: true }).waitFor()
      await thread.getByRole('button', { name: '댓글 삭제', exact: true }).last().click()
      await thread.getByText(replyText, { exact: true }).waitFor({ state: 'hidden' })
      await thread.getByRole('button', { name: '댓글 삭제', exact: true }).click()
      await thread.waitFor({ state: 'hidden' })
      assert.deepEqual(threads, [])
      await listButton.click()
      await page.getByText('이 파일에는 댓글이 없습니다', { exact: true }).waitFor()
      assert.equal(await page.locator('[data-fixture-value]').getAttribute('data-fixture-value'), content, 'comments do not change the Markdown source')
      assert.deepEqual(requests, ['POST', 'POST', 'POST', 'POST', 'PUT', 'PUT', 'DELETE', 'DELETE', 'DELETE'])
      assert.deepEqual(errors, [])
      await page.close()
    }
  }

  if (!baselineSource) await t.test('late comment mutations cannot restore popovers after access or workspace changes', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR' })
    page.setDefaultTimeout(5000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => { localStorage.setItem('mew:locale', 'ko'); localStorage.setItem('mew:ui-locale', 'ko') })
    let fetchedThreads: CommentThread[] = []
    let submittedAnchor: unknown
    let complete: (thread: CommentThread) => Promise<void> = async () => { throw new Error('No comment mutation is pending') }
    let markCaptured: () => void = () => {}
    let captured = new Promise<void>(resolve => { markCaptured = resolve })
    await page.route('http://mew-comments.test/**', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.pathname === '/api/comments') {
        if (request.method() === 'GET') return route.fulfill({ json: { threads: fetchedThreads } })
        if (request.method() === 'POST') submittedAnchor = request.postDataJSON().anchor
        return new Promise<void>(resolve => {
          complete = async thread => { await route.fulfill({ json: { ok: true, thread } }); resolve() }
          markCaptured()
        })
      }
      if (url.pathname === '/api/members') return route.fulfill({ json: { members: [author] } })
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] })
      if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: entry.code })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` })
    })
    await page.goto('http://mew-comments.test/')
    const editor = page.locator('.ProseMirror'), root = page.locator('[data-fixture-value]')
    await editor.getByText('선택한 문장에 의견을 남기고 함께 확인합니다.', { exact: true }).waitFor()
    await selectQuote(editor)
    await page.keyboard.press('Control+Shift+C')
    const input = composerInput(page), dialog = page.getByRole('dialog', { name: '댓글', exact: true })
    await input.fill('권한 변경 전에 요청한 댓글')
    await dialog.getByRole('button', { name: '댓글 달기', exact: true }).click()
    await captured
    await root.evaluate(el => (el.ownerDocument.defaultView as unknown as { commentFixtureSetScope: (scope: { enabled: boolean }) => void }).commentFixtureSetScope({ enabled: false }))
    await page.locator('[data-fixture-access="false"]').waitFor()
    await dialog.waitFor({ state: 'hidden' })
    const oldThread: CommentThread = { id: 'old-thread', anchor: submittedAnchor, comments: [{ id: 'old-comment', author, time: Date.UTC(2026, 9, 22), text: firstText }] }
    const postResponse = page.waitForResponse(response => response.request().method() === 'POST')
    await complete(oldThread)
    await (await postResponse).finished()
    await root.evaluate(el => new Promise<void>(resolve => el.ownerDocument.defaultView!.requestAnimationFrame(() => el.ownerDocument.defaultView!.requestAnimationFrame(() => resolve()))))
    assert.equal(await page.getByRole('dialog').count(), 0, 'a late create response cannot reopen the revoked comment popup')
    assert.equal(await editor.locator('[data-thread]').count(), 0, 'a late create response cannot restore revoked comment highlights')

    fetchedThreads = [oldThread]
    await root.evaluate(el => (el.ownerDocument.defaultView as unknown as { commentFixtureSetScope: (scope: { enabled: boolean; workspace: string }) => void }).commentFixtureSetScope({ enabled: true, workspace: '/fixture/workspace-b' }))
    await page.locator('[data-fixture-workspace="/fixture/workspace-b"]').waitFor()
    const listButton = page.getByRole('button', { name: '댓글 목록', exact: true })
    await listButton.click()
    await page.getByRole('button').filter({ hasText: firstText }).click()
    await dialog.getByText(firstText, { exact: true }).hover()
    await dialog.getByRole('button', { name: '댓글 수정', exact: true }).click()
    await dialog.getByRole('textbox', { name: '댓글 수정 입력', exact: true }).fill('이전 워크스페이스의 늦은 수정')
    captured = new Promise<void>(resolve => { markCaptured = resolve })
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    await captured
    fetchedThreads = []
    await root.evaluate(el => (el.ownerDocument.defaultView as unknown as { commentFixtureSetScope: (scope: { workspace: string }) => void }).commentFixtureSetScope({ workspace: '/fixture/workspace-c' }))
    await page.locator('[data-fixture-workspace="/fixture/workspace-c"]').waitFor()
    await dialog.waitFor({ state: 'hidden' })
    const editResponse = page.waitForResponse(response => response.request().method() === 'PUT')
    await complete({ ...oldThread, comments: [{ ...oldThread.comments[0], text: '이전 워크스페이스의 늦은 수정' }] })
    await (await editResponse).finished()
    await root.evaluate(el => new Promise<void>(resolve => el.ownerDocument.defaultView!.requestAnimationFrame(() => el.ownerDocument.defaultView!.requestAnimationFrame(() => resolve()))))
    assert.equal(await page.getByRole('dialog').count(), 0)
    await listButton.click()
    await page.getByText('이 파일에는 댓글이 없습니다', { exact: true }).waitFor()
    assert.equal(await page.getByText('이전 워크스페이스의 늦은 수정', { exact: true }).count(), 0, 'a late update cannot populate the same filename in another workspace')
    assert.deepEqual(errors, [])
    await page.close()
  })
})
