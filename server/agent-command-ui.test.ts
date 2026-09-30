import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Locator } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import type { AgentAttachmentInput } from '../shared/agent-attachment.ts'
import type { AgentCommandRecord } from '../shared/agent-command.ts'

const root = path.resolve(import.meta.dirname, '..')

async function composerValue(input: Locator): Promise<string> {
  if (await input.locator('.cm-placeholder').count()) return ''
  return (await input.locator('.cm-line').allTextContents()).join('\n')
}

test('CLI composer, live-to-saved popup, keyboard focus and reload on desktop/mobile', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const source = `
import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {AgentPanel} from '${root}/src/components/AgentPanel.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {useMobileKeyboard} from '${root}/src/hooks/use-mobile-keyboard.ts';
localStorage.setItem('mew:locale','ko'); window.agentMessages=[];
class Socket {
  static OPEN=1; readyState=1;
  constructor(){window.agentSocket=this;setTimeout(()=>{this.onopen?.();this.emit({type:'replay',events:[]});this.emit({type:'models',models:{currentModelId:'test',availableModels:[{modelId:'test',name:'Test model'}]}});this.emit({type:'meta',meta:{sessionId:'conversation',startedAt:new Date().toISOString(),turns:0,busy:false,queued:[],usage:null,canLoad:true,canList:true}})},30)}
  emit(value){this.onmessage?.({data:JSON.stringify(value)})}
  send(raw){window.agentMessages.push(JSON.parse(raw))}
  close(){this.readyState=3;this.onclose?.()}
}
window.WebSocket=Socket;
const preparedTabs=location.search.includes('prepared')?fetch('/api/user-ui/agent-tabs?workspace=/workspace').then(r=>r.json()):undefined;
function Fixture(){
  const keyboard=useMobileKeyboard();
  const [project,setProject]=React.useState('test'); window.setEditorProject=setProject;
  return <div className="mew-workspace flex h-full flex-col" data-mobile-keyboard={keyboard?'':undefined}>
    <div className="mew-workspace-content min-h-0 flex-1"><AgentPanel preparedTabs={preparedTabs} project={project} workspacePath='/workspace' tree={[{name:'README.md',path:'README.md',type:'file'}]} focusedFilePath={null} onOpenFile={()=>{}} onClose={()=>{}} /></div>
  </div>;
}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:cli.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'cli-fixture',
    async resolveId(id, importer) {
      if (id === 'virtual:cli.tsx') return id
      if (id === '@mew/tmux-term') return 'virtual:terminal.tsx'
      if (id.endsWith('.css')) return 'virtual:style'
      if (id.endsWith('?raw')) { const resolved = await this.resolve(id.slice(0, -4), importer, { skipSelf: true }); if (resolved) return `${resolved.id}?raw` }
    },
    async load(id) {
      if (id.endsWith('?raw')) return `export default ${JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))}`
      if (id === 'virtual:cli.tsx') return source
      if (id === 'virtual:style') return ''
      if (id === 'virtual:terminal.tsx') return 'export const isHiddenTmuxSession=()=>false; export function TmuxTerminal(){return <div className="xterm h-full p-3"><textarea aria-label="테스트 터미널" defaultValue="live command output"/></div>}'
    },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const files = ['src/components/AgentPanel.tsx', 'src/components/agent-command-bubble.tsx', 'src/components/SessionTerminalPopup.tsx', 'src/components/MentionTextarea.tsx']
  const content = (await Promise.all(files.map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, locale: 'ko-KR' })
      page.setDefaultTimeout(6000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      const records: AgentCommandRecord[] = []
      let uploads = 0
      const uploadBodies: string[] = []
      let holdUpload = false
      let releaseUpload: (() => void) | undefined
      let launches = 0
      let tabReads = 0
      let documentReads = 0
      let documentMode: 'ready' | 'failed' | 'delayed' = 'ready'
      let releaseDocuments: (() => void) | undefined
      let markDocumentRequest: () => void = () => {}
      const documentRequest = new Promise<void>(resolve => { markDocumentRequest = resolve })
      await page.route('http://mew-cli.test/**', async route => {
        const url = new URL(route.request().url()), pathname = url.pathname
        if (pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        if (pathname === '/api/upload-into') {
          uploads++
          uploadBodies.push(route.request().postData() ?? '')
          if (holdUpload) await new Promise<void>(resolve => { releaseUpload = resolve })
          return route.fulfill({ json: { relPath: `.mew/assets/clipboard-${uploads}.png` } })
        }
        if (pathname === '/api/agent/commands') {
          if (route.request().method() === 'POST') {
            launches++
            const record = { ...route.request().postDataJSON(), session: 'mewcmd-fixture', state: 'queued', startedAt: Date.now(), finishedAt: null, exitCode: null }
            records.push(record)
            return route.fulfill({ json: { command: record } })
          }
          return route.fulfill({ json: { commands: records } })
        }
        if (pathname.endsWith('/output')) return route.fulfill({ json: { command: records[0], text: 'first line\nlast line\n' } })
        if (pathname === '/api/user-ui/agent-tabs' && route.request().method() === 'GET') tabReads++
        if (pathname === '/api/user-ui/agent-tabs') return route.fulfill({ json: { state: { tabs: [{ id: 'test', label: 'Codex', runtime: 'codex', cwd: '/workspace', renamed: true }], activeId: 'test' }, claims: [] } })
        if (pathname === '/api/agent-cwd') return route.fulfill({ json: { cwd: '/workspace' } })
        if (pathname === '/api/tree' && url.searchParams.get('project') === 'docs') {
          documentReads++
          assert.equal(url.searchParams.has('path'), false, 'Documents uses the full tree, not the expanded sidebar')
          if (documentMode === 'failed') return route.fulfill({ status: 503, json: { error: 'unavailable' } })
          if (documentMode === 'delayed') {
            const gate = new Promise<void>(resolve => { releaseDocuments = resolve })
            markDocumentRequest()
            await gate
          }
          return route.fulfill({ json: [
            { name: 'README.md', path: 'README.md', type: 'file' },
            { name: 'guides', path: 'guides', type: 'dir', children: [{ name: 'setup.md', path: 'guides/setup.md', type: 'file' }] },
          ] })
        }
        if (pathname === '/api/projects') return route.fulfill({ json: [] })
        if (pathname.startsWith('/api/')) return route.fulfill({ json: { settings: null, skills: [], jobs: [], runtimes: [] } })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-cli.test/' + (width === 390 ? '?prepared=1' : ''))
      const toggle = page.getByRole('button', { name: 'CLI 명령 모드', exact: true })
      await toggle.waitFor()
      assert.equal(tabReads, 1, 'prepared tab metadata is consumed without a second initial GET')
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
      const model = page.getByTitle('모델', { exact: true })
      const toggleBox = await toggle.boundingBox(), modelBox = await model.boundingBox()
      assert.ok(toggleBox && modelBox && toggleBox.x < modelBox.x)
      const draft = page.locator('[contenteditable="true"][aria-placeholder="텍스트 입력"]')
      assert.equal(documentReads, 0, 'Documents is loaded on demand')
      assert.equal(await draft.getAttribute('contenteditable'), 'true', 'mobile keyboards receive a rich editing host')
      const composer = page.locator('[data-keep-keyboard]')
      const assertComposerBottomAligned = async () => {
        const inputBottom = await composer.locator('.cm-editor').evaluate(el => el.parentElement!.getBoundingClientRect().bottom)
        const sendBox = await composer.getByRole('button', { name: '전송', exact: true }).boundingBox()
        assert.ok(sendBox && Math.abs(sendBox.y + sendBox.height - inputBottom) < 0.5, 'send and input bottoms share the same y coordinate')
      }
      await assertComposerBottomAligned()
      const resizeHandle = composer.getByRole('separator', { name: '입력창 높이 조절' })
      for (let i = 0; i < 20; i++) await resizeHandle.press('ArrowDown')
      await assertComposerBottomAligned()
      assert.equal((await composer.boundingBox())!.height, 137, 'minimum includes the 28px settings row and 1px top border')
      // Intrinsic button size changes must update the minimum without a JS pixel sum.
      await composer.getByRole('button', { name: '전송', exact: true }).evaluate(el => { el.style.height = '48px' })
      await resizeHandle.evaluate(async el => {
        const view = el.ownerDocument.defaultView!
        while (el.getAttribute('aria-valuemin') !== '153') await new Promise<void>(resolve => view.requestAnimationFrame(() => resolve()))
      })
      assert.equal((await composer.boundingBox())!.height, 153)
      await assertComposerBottomAligned()
      await composer.getByRole('button', { name: '전송', exact: true }).evaluate(el => { el.style.height = '' })
      await resizeHandle.evaluate(async el => {
        const view = el.ownerDocument.defaultView!
        while (el.getAttribute('aria-valuemin') !== '137') await new Promise<void>(resolve => view.requestAnimationFrame(() => resolve()))
      })
      for (let i = 0; i < 4; i++) await resizeHandle.press('ArrowUp')
      await assertComposerBottomAligned()
      const initialComposer = await composer.boundingBox()
      if (width === 390) assert.equal(initialComposer!.y + initialComposer!.height, 844 - 48, 'composer clears the mobile dock reservation')
      const longDraft = Array.from({ length: 80 }, (_, i) => `${i + 1}. 긴 입력 내용이 줄바꿈되어도 입력칸 안에서 모두 확인할 수 있어야 합니다.`).join('\n')
      await draft.fill(longDraft)
      await draft.press('Control+End')
      await page.waitForFunction(`() => {
        const scroller = document.querySelector('[data-keep-keyboard] .cm-scroller')
        return scroller.scrollHeight > scroller.clientHeight && scroller.scrollTop > 0
      }`)
      const assertInputContained = async () => {
        const bounds = await composer.boundingBox()
        const scroller = await page.locator('[data-keep-keyboard] .cm-scroller').boundingBox()
        assert.ok(bounds && scroller && scroller.y + scroller.height <= bounds.y + bounds.height, 'long input scrolls inside the composer')
      }
      await assertInputContained()
      assert.deepEqual(await composer.boundingBox(), initialComposer, 'typing must not grow or move the composer')
      if (width === 390) {
        await page.evaluate(`(() => {
          Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 440 })
          window.visualViewport.dispatchEvent(new Event('resize'))
        })()`)
        await page.waitForFunction(`() => document.querySelector('[data-keep-keyboard]').getBoundingClientRect().bottom <= 440`)
        await draft.press('Control+Home')
        await draft.press('Control+End')
        await assertInputContained()
        if (process.env.MEW_CLI_SCREENSHOTS) {
          await fs.mkdir(process.env.MEW_CLI_SCREENSHOTS, { recursive: true })
          await page.screenshot({ path: path.join(process.env.MEW_CLI_SCREENSHOTS, 'composer-keyboard-overflow.png') })
        }
        await page.evaluate(`(() => {
          Reflect.deleteProperty(window.visualViewport, 'height')
          window.visualViewport.dispatchEvent(new Event('resize'))
        })()`)
        await page.waitForFunction(`bottom => Math.abs(document.querySelector('[data-keep-keyboard]').getBoundingClientRect().bottom - bottom) < 1`, initialComposer!.y + initialComposer!.height)
      }
      await draft.fill(longDraft.replaceAll('\n', ' '))
      await draft.press('Control+End')
      await assertInputContained()
      assert.deepEqual(await composer.boundingBox(), initialComposer, 'wrapped text keeps the same input height')
      await draft.fill('사진 두 장')
      for (const eventType of ['paste', 'beforeinput']) {
        await page.evaluate(`window.setEditorProject(${JSON.stringify(eventType === 'paste' ? 'docs' : '.workspace')})`)
        await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        const uploaded = page.waitForResponse(response => response.url().endsWith('/api/upload-into'))
        const prevented = await page.evaluate<boolean>(`(() => {
          const element = document.querySelector('[contenteditable="true"][aria-placeholder="텍스트 입력"]')
          const eventType = ${JSON.stringify(eventType)}
          const data = new DataTransfer()
          data.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'photo.png', { type: 'image/png' }))
          const event = eventType === 'paste'
            ? new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
            : new InputEvent('beforeinput', { inputType: 'insertFromPaste', dataTransfer: data, bubbles: true, cancelable: true })
          element.dispatchEvent(event)
          return event.defaultPrevented
        })()`)
        assert.equal(prevented, true)
        await uploaded
        await page.getByRole('button', { name: '전송', exact: true }).waitFor()
        // Wait for React's upload completion before committing the next image.
        await page.waitForFunction(`() => !document.querySelector('button[aria-label="전송"]')?.disabled`)
      }
      assert.equal(uploads, 2)
      for (const body of uploadBodies) {
        assert.match(body, /name="project"\r\n\r\n\.workspace\r\n/, 'attachments belong to the root even when editing Documents')
        assert.match(body, /name="destDir"\r\n\r\n\.mew\/assets\r\n/)
      }
      assert.equal(await page.getByRole('button', { name: 'png 첨부 제거', exact: true }).count(), 2)
      assert.equal(await draft.locator('img').count(), 0, 'photos stay in attachment tags, never the text document')
      await draft.press('Control+Enter')
      const photoPrompt = await page.evaluate<{ text: string; images: unknown[] }>("window.agentMessages.find(message => message.type === 'prompt')")
      assert.match(photoPrompt.text, /사진 두 장/)
      assert.match(photoPrompt.text, /\[\[\.workspace:\.mew\/assets\/clipboard-1.png\]\]/)
      assert.equal(photoPrompt.images.length, 2)
      await page.evaluate('window.agentMessages=[]')
      await page.evaluate("window.setEditorProject('docs')")

      const files: AgentAttachmentInput[] = [
        { project: 'test', path: '.mew/files/clipboard-1.png', mimeType: 'image/png' },
        { project: 'test', path: '.mew/files/notes.pdf', mimeType: 'application/pdf' },
      ]
      const showQueue = async (text: string, attachments = files) => {
        await page.evaluate(({ text, attachments }) => {
          (globalThis as any).agentSocket.emit({ type: 'meta', meta: { sessionId: 'conversation', busy: true, queued: [text], queuedKinds: ['prompt'], queuedAttachments: [attachments] } })
        }, { text, attachments })
        await page.locator('[data-agent-queue]').evaluate(async (root, text) => {
          for (let frame = 0; frame < 60; frame++) {
            const rows = root.querySelectorAll('[data-queue-row]')
            if (rows.length === 1 && rows[0].querySelector('button[aria-expanded] > span')?.textContent === text) return
            await new Promise(resolve => root.ownerDocument.defaultView!.requestAnimationFrame(resolve))
          }
          throw new Error('queue metadata did not render')
        }, text)
      }
      await page.evaluate("window.agentMessages=[];window.agentSocket.emit({type:'meta',meta:{sessionId:'conversation',busy:true,queued:['첫 대기','둘째 대기'],queuedKinds:['prompt','prompt'],queuedAttachments:[[],[]]}})")
      const handles = page.getByRole('button', { name: '드래그해서 순서 변경', exact: true })
      await handles.nth(1).waitFor({ state: 'visible' })
      assert.equal(await handles.count(), 2)
      const firstHandle = await handles.first().boundingBox()
      const secondHandle = await handles.nth(1).boundingBox()
      assert.ok(firstHandle && secondHandle)
      const from = { x: firstHandle.x + firstHandle.width / 2, y: firstHandle.y + firstHandle.height / 2 }
      const to = { x: secondHandle.x + secondHandle.width / 2, y: secondHandle.y + secondHandle.height / 2 }
      const checkQueuePreview = async () => {
        await page.locator('[data-queue-drop-placeholder]').waitFor()
        // Wait for the authored shift rather than asserting an intermediate animation frame.
        await page.locator('[data-agent-queue]').evaluate(async root => {
          const el = root.querySelector('[data-queue-row="1"]')!
          const slot = root.querySelector('[data-queue-slot="0"]')!
          for (let frame = 0; frame < 60; frame++) {
            if (Math.abs(el.getBoundingClientRect().top - slot.getBoundingClientRect().top) < 1) return
            await new Promise(resolve => root.ownerDocument.defaultView!.requestAnimationFrame(resolve))
          }
          throw new Error('neighbor did not move into the vacated slot')
        })
        const placeholder = await page.locator('[data-queue-drop-placeholder]').boundingBox()
        const destination = await page.locator('[data-queue-slot="1"]').boundingBox()
        assert.ok(placeholder && destination && Math.abs(placeholder.y - destination.y) < 1, 'insertion gap follows the destination')
        assert.equal(await page.evaluate("window.agentMessages.filter(message => message.type === 'move_queued').length"), 0, 'preview does not commit the order')
        if (process.env.MEW_CLI_SCREENSHOTS) {
          await fs.mkdir(process.env.MEW_CLI_SCREENSHOTS, { recursive: true })
          await page.screenshot({ path: path.join(process.env.MEW_CLI_SCREENSHOTS, `queue-drag-${width}.png`) })
        }
      }
      if (width === 390) {
        const touch = await page.context().newCDPSession(page)
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to] })
        await checkQueuePreview()
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await touch.detach()
      } else {
        await page.mouse.move(from.x, from.y)
        await page.mouse.down()
        await page.mouse.move(to.x, to.y, { steps: 3 })
        await checkQueuePreview()
        await page.mouse.up()
      }
      assert.deepEqual(await page.evaluate("window.agentMessages.filter(message => message.type === 'move_queued')"), [{ type: 'move_queued', from: 0, to: 1 }], 'handle drags immediately without holding')
      assert.equal(await page.locator('[data-editing-queue]').count(), 0, 'drag does not start editing')
      await handles.nth(1).press('ArrowUp')
      assert.deepEqual(await page.evaluate("window.agentMessages.filter(message => message.type === 'move_queued').at(-1)"), { type: 'move_queued', from: 1, to: 0 })
      await page.evaluate("window.agentMessages=[];window.agentSocket.emit({type:'meta',meta:{sessionId:'conversation',busy:true,queued:['위 항목','여러 줄\\n둘째 줄\\n셋째 줄\\n넷째 줄','아래 항목'],queuedKinds:['prompt','prompt','prompt'],queuedAttachments:[[],[],[]]}})")
      await page.getByRole('button', { name: '여러 줄 둘째 줄 셋째 줄 넷째 줄', exact: true }).click()
      const tallSlot = await page.locator('[data-queue-slot="1"]').boundingBox()
      const lastSlot = await page.locator('[data-queue-slot="2"]').boundingBox()
      assert.ok(tallSlot && lastSlot && tallSlot.height > lastSlot.height)
      const tallHandle = handles.nth(1)
      const tallBox = await tallHandle.boundingBox()
      assert.ok(tallBox)
      const tallFrom = { clientX: tallBox.x + tallBox.width / 2, clientY: tallBox.y + tallBox.height / 2 }
      const tallTo = { clientX: tallFrom.clientX, clientY: lastSlot.y + lastSlot.height / 2 }
      await tallHandle.dispatchEvent('pointerdown', { ...tallFrom, pointerId: 73, pointerType: 'mouse', button: 0 })
      await tallHandle.dispatchEvent('pointermove', { ...tallTo, pointerId: 73, pointerType: 'mouse' })
      await page.locator('[data-queue-drop-placeholder]').waitFor()
      await page.locator('[data-agent-queue]').evaluate(async root => {
        for (let frame = 0; frame < 15; frame++) await new Promise(resolve => root.ownerDocument.defaultView!.requestAnimationFrame(resolve))
      })
      const tallGap = await page.locator('[data-queue-drop-placeholder]').boundingBox()
      const movedLast = await page.locator('[data-queue-row="2"]').boundingBox()
      assert.ok(tallGap && movedLast && Math.abs(tallGap.y + tallGap.height - (lastSlot.y + lastSlot.height)) < 1, 'tall row insertion aligns with the end of its destination')
      assert.ok(movedLast.y + movedLast.height <= tallGap.y, 'short neighbor moves clear of the tall insertion gap')
      await tallHandle.dispatchEvent('pointercancel', { pointerId: 73, pointerType: 'mouse' })
      assert.equal(await page.locator('[data-queue-drop-placeholder]').count(), 0)
      assert.equal(await page.evaluate("window.agentMessages.filter(message => message.type === 'move_queued').length"), 0, 'cancel restores the original order without committing')
      await tallHandle.dispatchEvent('pointerdown', { ...tallFrom, pointerId: 74, pointerType: 'mouse', button: 0 })
      await tallHandle.dispatchEvent('pointermove', { ...tallTo, pointerId: 74, pointerType: 'mouse' })
      await page.locator('[data-queue-drop-placeholder]').waitFor()
      await page.keyboard.press('Escape')
      await page.locator('[data-queue-drop-placeholder]').waitFor({ state: 'detached' })
      assert.equal(await handles.count(), 3, 'Esc cancels only the drag and preserves the panel')
      assert.equal(await page.evaluate("window.agentMessages.filter(message => message.type === 'move_queued').length"), 0)
      const restoredLast = await page.locator('[data-queue-row="2"]').boundingBox()
      assert.ok(restoredLast && Math.abs(restoredLast.y - lastSlot.y) < 1)
      await page.evaluate('window.agentMessages=[]')
      await draft.fill('보존할 새 메시지')
      const fullQueueText = '첫째 줄\n둘째 줄\n셋째 줄\n넷째 줄\n다섯째 줄\n마지막 줄'
      await showQueue(fullQueueText, [])
      const fullQueueItem = page.locator('[data-agent-queue] button[aria-expanded]')
      await fullQueueItem.click()
      assert.equal(await fullQueueItem.getAttribute('aria-expanded'), 'true')
      assert.equal(await fullQueueItem.locator('span').first().textContent(), fullQueueText)
      assert.equal(await page.locator('[data-editing-queue]').count(), 0, 'body click only expands the queue')
      assert.equal(await composerValue(draft), '보존할 새 메시지')
      assert.equal(await page.evaluate("window.agentMessages.some(message => message.type === 'begin_edit_queued')"), false)
      const expandedBody = fullQueueItem.locator('span').first()
      const scrollSize = await expandedBody.evaluate(el => {
        el.scrollTop = el.scrollHeight
        return { height: el.clientHeight, total: el.scrollHeight, top: el.scrollTop, line: parseFloat(el.ownerDocument.defaultView!.getComputedStyle(el).lineHeight) }
      })
      assert.ok(scrollSize.total > scrollSize.height && scrollSize.top > 0, 'long queue content scrolls internally')
      assert.ok(scrollSize.height <= scrollSize.line * 4, 'expanded content is capped at four lines')
      const editButton = page.locator('[data-agent-queue]').getByRole('button', { name: '편집', exact: true })
      const editBox = await editButton.boundingBox()
      const deleteBox = await page.getByRole('button', { name: '대기 메시지 취소', exact: true }).boundingBox()
      assert.ok(editBox && deleteBox && editBox.x + editBox.width <= deleteBox.x, 'pencil is immediately before X')
      await fullQueueItem.click()
      assert.equal(await fullQueueItem.getAttribute('aria-expanded'), 'false')
      await showQueue('첨부 확인')
      await page.locator('[data-agent-queue]').getByRole('button', { name: '편집', exact: true }).click()
      const queuedInput = page.getByRole('textbox', { name: '대기 메시지 수정칸', exact: true })
      await queuedInput.waitFor()
      assert.equal(await composerValue(queuedInput), '첨부 확인', 'attachment paths stay out of editable text')
      assert.equal(await page.getByRole('button', { name: '파일 첨부', exact: true }).count(), 1, 'queue edit reuses the composer attachment picker')
      assert.equal(await page.locator('[data-agent-queue]').getByRole('textbox').count(), 0, 'queue rows do not contain inline editors')
      assert.equal(await page.locator('[data-agent-composer]').getByRole('textbox').count(), 1)
      assert.equal(await page.getByRole('button', { name: 'CLI 명령 모드', exact: true }).isDisabled(), true)
      const cancelBounds = await page.getByRole('button', { name: '취소', exact: true }).boundingBox()
      const saveBounds = await page.getByRole('button', { name: '저장', exact: true }).boundingBox()
      assert.ok(cancelBounds && saveBounds && cancelBounds.y + cancelBounds.height <= saveBounds.y, 'queue cancel is above the composer save')
      assert.equal(await page.locator('[data-agent-queue]').getByRole('button', { name: '취소', exact: true }).innerText(), '취소')
      assert.equal(await page.locator('[data-agent-composer]').getByRole('button', { name: '취소', exact: true }).count(), 0)
      assert.equal(await page.getByRole('button', { name: '예약 메시지', exact: true }).count(), 0)
      await page.getByRole('button', { name: 'png', exact: true }).click()
      await page.getByRole('dialog').waitFor()
      assert.match(await page.getByRole('dialog').locator('img').getAttribute('src') ?? '', /clipboard-1.png/)
      await page.keyboard.press('Escape')
      assert.equal(await queuedInput.count(), 1, 'closing preview does not cancel the edit')
      await page.getByRole('button', { name: 'pdf 첨부 제거', exact: true }).click()
      await queuedInput.fill('취소할 수정')
      await page.getByRole('button', { name: '취소', exact: true }).click()
      assert.equal(await composerValue(draft), '보존할 새 메시지', 'cancel restores the unsent composer draft')
      await page.locator('[data-agent-queue]').getByRole('button', { name: '편집', exact: true }).click()
      assert.equal(await page.getByRole('button', { name: 'pdf 첨부 제거', exact: true }).count(), 1, 'cancel restores original attachments')
      await page.getByRole('button', { name: 'pdf 첨부 제거', exact: true }).click()
      holdUpload = true
      const picker = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: '파일 첨부', exact: true }).first().click()
      await (await picker).setFiles({ name: 'added.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71]) })
      await page.getByRole('status').filter({ hasText: '첨부 중…' }).waitFor()
      assert.equal(await page.getByRole('button', { name: '저장', exact: true }).isDisabled(), true)
      await queuedInput.press('Control+Enter')
      assert.equal(await page.evaluate("window.agentMessages.some(message => message.type === 'edit_queued')"), false)
      for (let attempt = 0; !releaseUpload && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
      holdUpload = false
      releaseUpload!()
      await page.waitForFunction(`() => document.querySelectorAll('button[aria-label="png 첨부 제거"]').length === 2`)
      await queuedInput.fill('')
      await page.waitForFunction(`() => !Array.from(document.querySelectorAll('[role="status"]')).some(element => element.textContent.includes('첨부 중'))`)
      await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const queueBounds = await queuedInput.boundingBox()
      assert.ok(queueBounds && queueBounds.x >= 0 && queueBounds.x + queueBounds.width <= width, 'queue editor fits the viewport')
      if (process.env.MEW_CLI_SCREENSHOTS) {
        await fs.mkdir(process.env.MEW_CLI_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: path.join(process.env.MEW_CLI_SCREENSHOTS, `queue-attachments-${width}.png`) })
      }
      await page.getByRole('button', { name: '저장', exact: true }).click()
      const edited = await page.evaluate<{ text: string; attachments: AgentAttachmentInput[] }>("window.agentMessages.find(message => message.type === 'edit_queued')")
      assert.equal(edited.text, '', 'attachment-only queue items can be saved')
      assert.equal(await composerValue(draft), '보존할 새 메시지', 'save restores the unsent composer draft')
      assert.deepEqual(edited.attachments.map(file => file.path), ['.mew/files/clipboard-1.png', '.mew/assets/clipboard-3.png'])
      assert.equal(edited.attachments[1].project, '.workspace')
      assert.match(uploadBodies[2], /name="project"\r\n\r\n\.workspace\r\n/)
      assert.match(uploadBodies[2], /name="destDir"\r\n\r\n\.mew\/assets\r\n/)
      assert.equal(edited.attachments[0].image, undefined, 'existing bytes are retained by the supervisor')
      assert.ok(edited.attachments[1].image?.data)
      await showQueue('', edited.attachments)
      await page.locator('[data-agent-queue]').getByRole('button', { name: '편집', exact: true }).click()
      await queuedInput.waitFor()
      await page.getByRole('button', { name: 'png 첨부 제거', exact: true }).first().click()
      await page.getByRole('button', { name: 'png 첨부 제거', exact: true }).first().click()
      assert.equal(await page.getByRole('button', { name: '저장', exact: true }).isDisabled(), true, 'empty text and attachments cannot be saved')
      await page.getByRole('button', { name: '취소', exact: true }).click()
      await page.locator('[data-agent-queue]').getByRole('button', { name: '편집', exact: true }).click()
      holdUpload = true
      releaseUpload = undefined
      const latePicker = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: '파일 첨부', exact: true }).first().click()
      await (await latePicker).setFiles({ name: 'late.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71]) })
      for (let attempt = 0; !releaseUpload && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
      await page.getByRole('button', { name: '취소', exact: true }).click()
      await page.locator('[data-agent-queue]').getByRole('button', { name: '편집', exact: true }).click()
      const lateResponse = page.waitForResponse(response => response.url().includes('/api/upload-into'))
      holdUpload = false
      releaseUpload!()
      await lateResponse
      await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      assert.equal(await page.getByRole('button', { name: 'png 첨부 제거', exact: true }).count(), 2, 'late upload from cancelled edit cannot attach to the next edit or composer')
      await page.getByRole('button', { name: '취소', exact: true }).click()
      // The shared editor preserves normal drafts, attachments and CLI mode across queue edits.
      const draftPicker = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: '파일 첨부', exact: true }).click()
      await (await draftPicker).setFiles({ name: 'draft.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71]) })
      await page.getByRole('button', { name: 'png 첨부 제거', exact: true }).waitFor()
      await showQueue('키보드로 수정', [])
      await page.locator('[data-agent-queue]').getByRole('button', { name: '편집', exact: true }).click()
      await queuedInput.waitFor()
      await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      assert.equal(await page.getByRole('button', { name: 'png 첨부 제거', exact: true }).count(), 0, 'new-message attachments stay out of queue edits')
      await queuedInput.fill('저장할 수정')
      await queuedInput.press('Control+Enter')
      assert.equal(await composerValue(draft), '보존할 새 메시지')
      await page.getByRole('button', { name: 'png 첨부 제거', exact: true }).waitFor()
      assert.equal(await page.evaluate("window.agentMessages.filter(message => message.type === 'edit_queued').at(-1).text"), '저장할 수정')
      await page.getByRole('button', { name: 'png 첨부 제거', exact: true }).click()
      await page.getByRole('button', { name: 'CLI 명령 모드', exact: true }).click()
      await page.locator('[data-agent-queue]').getByRole('button', { name: '편집', exact: true }).click()
      await queuedInput.waitFor()
      await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      assert.equal(await page.getByRole('button', { name: 'CLI 명령 모드', exact: true }).getAttribute('aria-pressed'), 'false')
      await queuedInput.fill('취소할 수정')
      await queuedInput.press('Escape')
      assert.equal(await composerValue(draft), '보존할 새 메시지')
      assert.equal(await page.getByRole('button', { name: 'CLI 명령 모드', exact: true }).getAttribute('aria-pressed'), 'true', 'cancel restores CLI mode')
      await page.locator('[data-agent-queue]').getByRole('button', { name: '편집', exact: true }).click()
      await queuedInput.waitFor()
      await queuedInput.fill('뒤로가기로 취소할 수정')
      await page.evaluate('window.history.back()')
      await queuedInput.waitFor({ state: 'detached' })
      assert.equal(await composerValue(draft), '보존할 새 메시지')
      assert.equal(await page.getByRole('button', { name: 'CLI 명령 모드', exact: true }).getAttribute('aria-pressed'), 'true')
      assert.equal(await page.getByRole('button', { name: '키보드로 수정', exact: true }).count(), 1, 'Back preserves the queued item and the panel')
      assert.equal(await page.evaluate('window.agentMessages.at(-1).type'), 'cancel_edit_queued')
      await page.getByRole('button', { name: 'CLI 명령 모드', exact: true }).click()
      await page.evaluate("window.agentMessages=[];window.agentSocket.emit({type:'meta',meta:{sessionId:'conversation',busy:false,queued:[],queuedKinds:[],queuedAttachments:[]}})")
      await page.evaluate("window.setEditorProject('test')")

      await draft.fill('첫 줄\n둘째 줄')
      await draft.press('Home')
      await draft.press('ArrowUp')
      assert.equal(await draft.locator('.cm-line').allTextContents().then(lines => lines.join('\n')), '첫 줄\n둘째 줄', 'up inside a multiline draft moves the caret')
      await draft.press('Control+Home')
      await draft.press('ArrowUp')
      assert.equal(await draft.locator('.cm-line').allTextContents().then(lines => lines.join('\n')), '사진 두 장', 'first visual line recalls the last prompt')
      await draft.press('Control+End')
      await draft.press('ArrowDown')
      assert.equal(await draft.locator('.cm-line').allTextContents().then(lines => lines.join('\n')), '첫 줄\n둘째 줄', 'down restores the unsent multiline draft')
      await page.evaluate('new Promise(requestAnimationFrame)')
      await draft.press('Control+a')
      await page.evaluate(`(() => {
        const element = document.querySelector('[contenteditable="true"][aria-placeholder="텍스트 입력"]')
        const data = new DataTransfer()
        data.setData('text/plain', '한글 붙여넣기\\n두 번째 줄')
        data.setData('text/html', '<b>한글 붙여넣기</b><br>두 번째 줄')
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
      })()`)
      assert.equal(await draft.locator('.cm-line').allTextContents().then(lines => lines.join('\n')), '한글 붙여넣기\n두 번째 줄')
      assert.equal(await draft.locator('b, br').count(), 0, 'formatted clipboard text remains plain text')
      await page.evaluate(`(() => {
        const element = document.querySelector('[contenteditable="true"][aria-placeholder="텍스트 입력"]')
        element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true }))
        element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '글' }))
      })()`)
      assert.equal(await page.evaluate("window.agentMessages.some(message => message.type === 'prompt')"), false, 'IME composition cannot submit the prompt')
      if (process.env.MEW_CLI_SCREENSHOTS) {
        await fs.mkdir(process.env.MEW_CLI_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: path.join(process.env.MEW_CLI_SCREENSHOTS, `composer-${width}.png`) })
      }
      await draft.fill('@README')
      const documentOption = page.getByRole('button', { name: 'README.md Documents/README.md', exact: true })
      await documentOption.waitFor()
      assert.equal(await page.getByRole('button', { name: 'README.md README.md', exact: true }).count(), 1)
      await documentOption.click()
      assert.equal(await composerValue(draft), '[[docs:README.md]] ')
      await draft.press('Control+Enter')
      assert.equal(await page.evaluate("window.agentMessages.find(message => message.type === 'prompt')?.text"), '[[docs:README.md]]')
      await page.evaluate('window.agentMessages=[]')
      await draft.fill('@setup')
      await page.getByRole('button', { name: 'setup.md Documents/guides/setup.md', exact: true }).waitFor()
      await draft.press('Enter')
      assert.equal(await composerValue(draft), '[[docs:guides/setup.md]] ')
      documentMode = 'failed'
      const failed = page.waitForResponse(response => response.url().includes('/api/tree?project=docs'))
      await draft.fill('@README'); await failed
      await page.getByRole('button', { name: 'README.md README.md', exact: true }).click()
      assert.equal(await composerValue(draft), '[[test:README.md]] ', 'a failed Documents request keeps current-project candidates')
      documentMode = 'delayed'
      await draft.fill('@setup'); await documentRequest
      await draft.press('Escape')
      releaseDocuments!()
      await draft.fill('unchanged draft')
      assert.equal(await page.getByRole('button', { name: 'setup.md Documents/guides/setup.md', exact: true }).count(), 0)
      documentMode = 'ready'
      const ready = page.waitForResponse(response => response.url().includes('/api/tree?project=docs'))
      await draft.fill('@setup'); await ready
      await page.getByRole('button', { name: 'setup.md Documents/guides/setup.md', exact: true }).waitFor()
      await draft.press('Escape')
      const command = '  printf "%s\\n" "hello"\nprintf "done"\n'
      await draft.fill(command)
      await draft.press('Control+Tab')
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true')
      assert.equal(await composerValue(draft), command)
      assert.ok(await page.evaluate('document.activeElement?.getAttribute("contenteditable") === "true"'))
      await draft.press('Control+Tab')
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
      await toggle.focus()
      await page.keyboard.press('Control+Tab')
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
      await toggle.click()
      await page.evaluate(`window.agentSocket.emit({type:'meta',meta:{sessionId:'conversation',busy:true,queued:[],queuedKinds:[],activeTask:null}})`)
      const accepted = page.waitForResponse(response => response.url().endsWith('/api/agent/commands') && response.request().method() === 'POST')
      await page.getByRole('button', { name: '명령 실행', exact: true }).click()
      await accepted
      await page.evaluate(`window.agentSocket.emit({type:'meta',meta:{sessionId:'conversation',busy:true,queued:[${JSON.stringify(command)}],queuedKinds:['cli'],activeTask:null}})`)
      await page.getByTitle('대기 중인 CLI 명령', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: /터미널 열기/ }).count(), 0)
      assert.equal(records[0].state, 'queued')
      records[0] = { ...records[0], state: 'running' }
      await page.evaluate(`window.agentSocket.emit({type:'meta',meta:{sessionId:'conversation',busy:true,queued:[],queuedKinds:[],activeTask:'cli'}})`)
      await page.getByRole('button', { name: /터미널 열기.*실행 중/ }).waitFor().catch(async error => {
        throw new Error(`${error.message}\n${JSON.stringify({ errors, records, body: await page.locator('body').innerText() })}`)
      })
      assert.equal(launches, 1)
      assert.equal(records[0].command, command)
      assert.equal(await page.evaluate("window.agentMessages.some(message => message.type === 'prompt')"), false)
      await page.getByRole('button', { name: /터미널 열기.*실행 중/ }).click()
      await page.getByRole('textbox', { name: '테스트 터미널' }).focus()
      records[0] = { ...records[0], state: 'completed', finishedAt: Date.now(), exitCode: 0, archived: true }
      await page.evaluate(`window.agentSocket.emit({type:'meta',meta:{sessionId:'conversation',busy:false,queued:[],queuedKinds:[],activeTask:null}})`)
      const output = page.getByLabel('저장된 터미널 출력')
      await output.waitFor()
      assert.match(await output.innerText(), /last line/)
      assert.ok(await page.evaluate("document.querySelector('[role=dialog]')?.contains(document.activeElement)"))
      await page.getByRole('button', { name: '닫기', exact: true }).focus()
      await page.keyboard.press('Tab')
      assert.ok(await page.evaluate("document.querySelector('[role=dialog]')?.contains(document.activeElement)"))
      assert.equal(await page.getByRole('button', { name: '종료', exact: true }).count(), 0)
      if (process.env.MEW_CLI_SCREENSHOTS) {
        await fs.mkdir(process.env.MEW_CLI_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: path.join(process.env.MEW_CLI_SCREENSHOTS, `cli-output-${width}.png`) })
      }
      await page.keyboard.press('Escape')
      assert.equal(await page.getByRole('dialog').count(), 0)
      const saved = page.getByRole('button', { name: /실행 기록 보기.*완료/ })
      if (process.env.MEW_CLI_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.MEW_CLI_SCREENSHOTS, `cli-chat-${width}.png`) })
      await saved.focus()
      await saved.click()
      await output.waitFor()
      assert.equal(launches, 1)
      await page.keyboard.press('Escape')
      assert.equal(await page.evaluate("document.activeElement?.textContent?.includes('실행 기록 보기')"), true)
      await page.reload()
      await saved.waitFor()
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
      assert.equal(launches, 1)
      assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
