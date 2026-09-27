import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Locator } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
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
createRoot(document.getElementById('root')).render(<I18nProvider><AgentPanel preparedTabs={preparedTabs} project='test' workspacePath='/workspace' tree={[{name:'README.md',path:'README.md',type:'file'}]} focusedFilePath={null} onOpenFile={()=>{}} onClose={()=>{}} /></I18nProvider>);`
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
          return route.fulfill({ json: { relPath: `.mew/files/clipboard-${uploads}.png` } })
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
      await draft.fill('사진 두 장')
      for (const eventType of ['paste', 'beforeinput']) {
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
      assert.equal(await page.getByRole('button', { name: 'png 첨부 제거', exact: true }).count(), 2)
      assert.equal(await draft.locator('img').count(), 0, 'photos stay in attachment tags, never the text document')
      await draft.press('Control+Enter')
      const photoPrompt = await page.evaluate<{ text: string; images: unknown[] }>("window.agentMessages.find(message => message.type === 'prompt')")
      assert.match(photoPrompt.text, /사진 두 장/)
      assert.match(photoPrompt.text, /\[\[test:\.mew\/files\/clipboard-1.png\]\]/)
      assert.equal(photoPrompt.images.length, 2)
      await page.evaluate('window.agentMessages=[]')

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
