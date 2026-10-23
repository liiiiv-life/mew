import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Locator, type Page } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
async function drag(page: Page, locator: Locator, start: { x: number; y: number }, end: { x: number; y: number }): Promise<void> {
  const box = await locator.boundingBox()
  assert.ok(box)
  await page.mouse.move(box.x + start.x, box.y + start.y)
  await page.mouse.down()
  await page.mouse.move(box.x + end.x, box.y + end.y, { steps: 6 })
  await page.mouse.up()
}

test('drawing popup supports vector edits, clipboard, history, PNG attachments and workspace isolation on desktop/mobile', { skip: !domBrowserExecutable(), timeout: 90_000 }, async () => {
  const source = `
import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {AgentPanel} from '${root}/src/components/AgentPanel.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
localStorage.setItem('mew:locale','ko');
class Socket {
 static OPEN=1; readyState=1;
 constructor(){window.agentSocket=this;setTimeout(()=>{this.onopen?.();this.emit({type:'replay',events:[]});this.emit({type:'models',models:{currentModelId:'test',availableModels:[{modelId:'test',name:'Test model'}]}});this.emit({type:'meta',meta:{sessionId:'drawing-conversation',startedAt:new Date().toISOString(),turns:0,busy:false,queued:[],usage:null,canLoad:true,canList:true}})},20)}
 emit(value){this.onmessage?.({data:JSON.stringify(value)})}
 send(){}
 close(){this.readyState=3;this.onclose?.()}
}
window.WebSocket=Socket;
function Fixture(){const [workspace,setWorkspace]=React.useState('/workspace');window.changeWorkspace=setWorkspace;return <div className="flex h-full flex-col"><AgentPanel project="test" workspacePath={workspace} tree={[]} focusedFilePath={null} onOpenFile={()=>{}} onClose={()=>{}}/></div>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:drawing.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'drawing-fixture',
    async resolveId(id, importer) {
      if (id === 'virtual:drawing.tsx') return id
      if (id === '@mew/tmux-term') return 'virtual:terminal.tsx'
      if (id.endsWith('.css')) return 'virtual:style'
      if (id.endsWith('?raw')) { const resolved = await this.resolve(id.slice(0, -4), importer, { skipSelf: true }); if (resolved) return `${resolved.id}?raw` }
    },
    async load(id) {
      if (id.endsWith('?raw')) return `export default ${JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))}`
      if (id === 'virtual:drawing.tsx') return source
      if (id === 'virtual:style') return ''
      if (id === 'virtual:terminal.tsx') return 'export const isHiddenTmuxSession=()=>false; export function TmuxTerminal(){return <div/>}'
    },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const drawingFiles = (await fs.readdir(`${root}/src/components/drawing`)).filter(name => /\.(tsx|css)$/.test(name))
  const content = (await Promise.all(['src/components/AgentPanel.tsx', 'src/components/MentionTextarea.tsx', 'packages/ui/src/dialog-frame.tsx', 'packages/ui/src/action-menu.tsx', 'packages/ui/src/select-field.tsx', 'packages/ui/src/color-picker.tsx', 'packages/ui/src/HoverTipLayer.tsx', ...drawingFiles.map(name => `src/components/drawing/${name}`)].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const utilityCss = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  const drawingCss = (await Promise.all(drawingFiles.filter(name => name.endsWith('.css')).map(name => fs.readFile(`${root}/src/components/drawing/${name}`, 'utf8')))).join('\n')
  const fontData = await fs.readFile(`${root}/public/fonts/ibm-plex/plex-mono-2.5.0-regular.woff2`)
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, locale: 'ko-KR', permissions: ['clipboard-read', 'clipboard-write'] })
      page.setDefaultTimeout(6000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      const drawings: { id: string; name: string; createdAt: string; path: string; bytes: number; svg: string; projectRoot: string }[] = []
      const uploads: string[] = []
      let workspace = '/workspace'
      let failUpload = false
      let fontRequests = 0
      await page.route('https://fonts.googleapis.com/**', route => {
        fontRequests++
        return route.fulfill({ contentType: 'text/css', body: "@font-face{font-family:'Roboto';font-style:normal;font-weight:400;src:url(https://fonts.gstatic.com/fixture.woff2) format('woff2');}" })
      })
      await page.route('https://fonts.gstatic.com/**', route => route.fulfill({ contentType: 'font/woff2', body: fontData }))
      await page.route('https://mew-drawing.test/**', async route => {
        const request = route.request(), url = new URL(request.url()), pathname = url.pathname
        if (pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        if (pathname === '/api/agent/drawings') {
          if (request.method() === 'POST') {
            const input = request.postDataJSON()
            if (input.projectRoot !== workspace) return route.fulfill({ status: 409, json: { error: '작업 폴더가 변경되었습니다' } })
            const record = { id: `drawing-${drawings.length + 1}`, name: input.name, svg: input.svg, createdAt: new Date().toISOString(), path: `.mew/temp/drawings/drawing-${drawings.length + 1}.svg`, bytes: input.svg.length, projectRoot: workspace }
            drawings.unshift(record)
            return route.fulfill({ json: record })
          }
          return route.fulfill({ json: { drawings, projectRoot: workspace } })
        }
        if (pathname.startsWith('/api/agent/drawings/')) return route.fulfill({ json: drawings.find(record => record.id === pathname.split('/').at(-1)) })
        if (pathname === '/api/upload-into') {
          if (failUpload) { failUpload = false; return route.fulfill({ status: 503, json: { error: '다시 시도할 수 있는 첨부 오류' } }) }
          uploads.push(request.postDataBuffer()!.toString('latin1'))
          return route.fulfill({ json: { relPath: `.mew/temp/assets/drawing-${uploads.length}.png` } })
        }
        if (pathname === '/api/user-ui/agent-tabs') return route.fulfill({ json: { state: { tabs: [{ id: 'drawing-test', label: 'Codex', runtime: 'codex', cwd: '/workspace', renamed: true }], activeId: 'drawing-test' }, claims: [] } })
        if (pathname === '/api/agent-cwd') return route.fulfill({ json: { cwd: '/workspace' } })
        if (pathname === '/api/projects') return route.fulfill({ json: [] })
        if (pathname.startsWith('/api/')) return route.fulfill({ json: { settings: null, skills: [], jobs: [], runtimes: [], commands: [] } })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${utilityCss}\n${drawingCss}\nhtml,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      await page.goto('https://mew-drawing.test/')
      const open = page.getByRole('button', { name: '그림판 열기', exact: true })
      await open.waitFor()
      assert.equal(drawings.length, 0)
      const toggle = page.getByRole('button', { name: 'CLI 명령 모드', exact: true })
      await toggle.click()
      assert.equal(await open.isDisabled(), true)
      await toggle.click()
      const openBox = await open.boundingBox(), inputBox = await page.locator('.cm-editor').locator('..').boundingBox()
      assert.ok(openBox && inputBox && openBox.x >= inputBox.x && openBox.x + openBox.width <= inputBox.x + inputBox.width + 1)
      await open.click()
      const dialog = page.getByRole('dialog', { name: '그림판', exact: true })
      await dialog.waitFor()
      const canvas = dialog.locator('[data-drawing-canvas]')
      await canvas.waitFor()
      const bounds = await dialog.boundingBox()
      assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1)
      await canvas.focus()
      await canvas.press('r')
      await drag(page, canvas, { x: 80, y: 100 }, { x: 180, y: 180 })
      const objects = canvas.locator('[data-drawing-object]')
      await objects.first().waitFor()
      assert.equal(await objects.count(), 1)
      assert.equal(await objects.first().locator('rect').count(), 1)
      const snappedPosition = (await objects.first().getAttribute('transform'))!.match(/translate\(([-\d.]+) ([-\d.]+)\)/)!
      assert.equal(Number(snappedPosition[1]) % 20, 0)
      assert.equal(Number(snappedPosition[2]) % 20, 0)
      await canvas.press('r')
      const canvasBox = await canvas.boundingBox()
      assert.ok(canvasBox)
      await page.mouse.move(canvasBox.x + 250, canvasBox.y + 130)
      await page.mouse.down()
      await page.mouse.move(canvasBox.x + 300, canvasBox.y + 160, { steps: 3 })
      await objects.nth(1).waitFor()
      await page.keyboard.press('Control+z')
      await page.mouse.up()
      await objects.nth(1).waitFor({ state: 'detached' })
      assert.equal(await objects.count(), 1, 'undo during a pointer gesture does not resurrect the unfinished object')
      await canvas.press('Control+z')
      await objects.first().waitFor({ state: 'detached' })
      await canvas.press('Control+Shift+z')
      await objects.first().waitFor()
      const rectangle = objects.first().locator('rect')
      await canvas.press('v')
      await rectangle.click({ position: { x: 2, y: 2 } })
      const previousWidth = Number(await rectangle.getAttribute('width'))
      const resize = canvas.locator('[data-resize-handle="e"]')
      await resize.waitFor()
      const handle = await resize.boundingBox()
      assert.ok(handle)
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
      await page.mouse.down()
      await page.mouse.move(handle.x + handle.width / 2 + 40, handle.y + handle.height / 2, { steps: 4 })
      await page.mouse.up()
      assert.ok(Number(await rectangle.getAttribute('width')) > previousWidth)
      const beforeRotate = await objects.first().getAttribute('transform')
      const rotate = await canvas.locator('[data-rotate-handle]').boundingBox()
      assert.ok(rotate)
      await page.mouse.move(rotate.x + rotate.width / 2, rotate.y + rotate.height / 2)
      await page.mouse.down()
      await page.mouse.move(rotate.x + rotate.width / 2 + 45, rotate.y + rotate.height / 2 + 25, { steps: 6 })
      await page.mouse.up()
      assert.notEqual(await objects.first().getAttribute('transform'), beforeRotate)
      await canvas.press('f')
      await canvas.press('0')
      assert.equal(await rectangle.getAttribute('fill'), 'none')
      await canvas.press('3')
      assert.equal(await rectangle.getAttribute('fill'), '#ef4444')
      await canvas.press('Escape')
      await canvas.press('Shift+F10')
      const menu = dialog.getByRole('menu', { name: '개체 편집', exact: true })
      const widthField = menu.getByRole('spinbutton', { name: '너비', exact: true })
      await widthField.fill('180')
      await widthField.press('Enter')
      assert.equal(Number(await rectangle.getAttribute('width')), 180)
      await menu.press('Escape')
      await canvas.focus()
      await canvas.press('Control+c')
      await canvas.press('Control+v')
      await objects.nth(1).waitFor()
      const firstIds = await objects.evaluateAll(elements => elements.map(element => element.getAttribute('data-drawing-object')))
      await canvas.press('Control+[')
      assert.deepEqual(await objects.evaluateAll(elements => elements.map(element => element.getAttribute('data-drawing-object'))), [...firstIds].reverse())
      await canvas.press('Control+]')
      await canvas.press('Control+a')
      await canvas.press('Control+g')
      await canvas.press('o')
      await drag(page, canvas, { x: 220, y: 230 }, { x: 300, y: 300 })
      assert.equal(await canvas.locator('[data-drawing-object] > ellipse').count(), 1)
      await canvas.press('l')
      await drag(page, canvas, { x: 100, y: 360 }, { x: 240, y: 340 })
      await canvas.press('p')
      await drag(page, canvas, { x: 70, y: 460 }, { x: 110, y: 430 })
      await drag(page, canvas, { x: 240, y: 460 }, { x: 280, y: 490 })
      await canvas.press('Enter')
      assert.ok((await objects.last().locator('path').getAttribute('d'))!.includes('C'), 'pen drags create a Bézier curve')
      await canvas.press('t')
      await canvas.click({ position: { x: 70, y: 520 } })
      const text = dialog.getByRole('textbox', { name: '그림 텍스트', exact: true })
      await text.fill('Review flow')
      await text.press('Control+Enter')
      assert.equal(await canvas.locator('[data-drawing-object] text').textContent(), 'Review flow')
      await canvas.press('Shift+F10')
      await menu.getByRole('combobox', { name: '글꼴', exact: true }).click()
      await page.getByRole('option', { name: 'Roboto', exact: true }).click()
      await menu.press('Escape')
      await canvas.focus()
      const textShape = canvas.locator('[data-drawing-object] text')
      await textShape.evaluate(async element => { await element.ownerDocument.fonts.ready })
      const textBeforeResize = await textShape.boundingBox()
      const textResize = await canvas.locator('[data-resize-handle="e"]').boundingBox()
      assert.ok(textBeforeResize && textResize)
      await page.mouse.move(textResize.x + textResize.width / 2, textResize.y + textResize.height / 2)
      await page.mouse.down()
      await page.mouse.move(textResize.x + textResize.width / 2 + 50, textResize.y + textResize.height / 2, { steps: 4 })
      await page.mouse.up()
      const textAfterResize = await textShape.boundingBox()
      assert.ok(textAfterResize && textAfterResize.width > textBeforeResize.width + 20, 'text edge resizing changes the rendered text width')
      await canvas.press('Control+a')
      await canvas.press('Shift+F10')
      assert.equal(await menu.getByRole('spinbutton', { name: '너비', exact: true }).count(), 0, 'mixed text and shapes expose only shared colors')
      assert.equal(await menu.getByRole('combobox', { name: '글꼴', exact: true }).count(), 0)
      await menu.press('Escape')
      await canvas.focus()
      await canvas.press('v')
      await canvas.press('+')
      assert.match((await objects.first().evaluate(element => element.parentElement?.getAttribute('transform')))!, /scale\(1\.2\)/)
      const originBeforePan = await canvas.locator('.drawing-origin').getAttribute('transform')
      await canvas.press('Space')
      await page.keyboard.down('Space')
      await drag(page, canvas, { x: 310, y: 590 }, { x: 330, y: 610 })
      await page.keyboard.up('Space')
      assert.notEqual(await canvas.locator('.drawing-origin').getAttribute('transform'), originBeforePan)
      await canvas.press('Control+0')
      assert.match((await objects.first().evaluate(element => element.parentElement?.getAttribute('transform')))!, /scale\(1\)/)
      await dialog.getByRole('button', { name: '그리드 설정', exact: true }).click()
      const gridSpacing = dialog.getByRole('spinbutton', { name: '격자 간격', exact: true })
      await gridSpacing.fill('25')
      await gridSpacing.press('Enter')
      await dialog.locator('.drawing-panel-grid').getByRole('button', { name: '닫기', exact: true }).click()
      const screenshot = await canvas.evaluate(element => {
        const image = element.ownerDocument.createElement('canvas')
        image.width = 220; image.height = 120
        const context = image.getContext('2d')!
        context.fillStyle = '#edf2ff'; context.fillRect(0, 0, 220, 120)
        context.fillStyle = '#4354b8'; context.fillRect(16, 16, 188, 20)
        context.fillStyle = '#fff'; context.fillRect(16, 50, 84, 54); context.fillRect(116, 50, 88, 54)
        context.fillStyle = '#1f2937'; context.font = '12px sans-serif'; context.fillText('Screenshot context', 24, 30)
        return image.toDataURL('image/png').split(',')[1]
      })
      await canvas.evaluate((element, png) => {
        const browserWindow = element.ownerDocument.defaultView!
        const data = new browserWindow.DataTransfer()
        data.items.add(new File([Uint8Array.from(atob(png), character => character.charCodeAt(0))], 'screenshot.png', { type: 'image/png' }))
        element.dispatchEvent(new browserWindow.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
      }, screenshot)
      await canvas.locator('image').waitFor()
      assert.equal(await objects.count(), 7)
      await dialog.getByRole('button', { name: '모두 보기', exact: true }).click()
      await page.screenshot({ path: `/tmp/mew-drawing-${width === 1100 ? 'desktop' : 'mobile'}.png` })
      const save = dialog.getByRole('button', { name: '저장', exact: true })
      failUpload = true
      await save.click()
      await dialog.getByText('다시 시도할 수 있는 첨부 오류', { exact: true }).waitFor()
      assert.equal(await dialog.isVisible(), true, 'failed attachment leaves the drawing available for retry')
      await save.click()
      await dialog.waitFor({ state: 'detached' })
      assert.equal(uploads.length, 1)
      assert.equal(drawings.length, 1, 'attachment retries reuse the same SVG history entry')
      await page.getByRole('button', { name: 'png 첨부 제거', exact: true }).waitFor()
      assert.ok(uploads[0].includes('image/png'))
      assert.ok(uploads[0].includes('.mew/temp/assets'))
      assert.ok(uploads[0].includes('/workspace'))
      assert.ok(drawings[0].svg.includes('<metadata id="mew-drawing">'))
      assert.ok(drawings[0].svg.includes('data:image/png;base64,'))
      assert.ok(drawings[0].svg.includes('<rect'))
      assert.ok(drawings[0].svg.includes('data:font/woff2;base64,'))
      assert.match(drawings[0].svg, /<g transform="scale\([\d.]+ [\d.]+\)"><text/)
      assert.ok(fontRequests > 0)
      const metadata = drawings[0].svg.match(/<metadata id="mew-drawing">(.*?)<\/metadata>/)![1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      const savedDocument = JSON.parse(metadata)
      assert.equal(savedDocument.grid.size, 25)
      assert.ok(savedDocument.objects[0].groupId && savedDocument.objects[0].groupId === savedDocument.objects[1].groupId)
      assert.notEqual(savedDocument.objects[0].rotation, 0)
      assert.ok(savedDocument.objects.find((object: { type: string }) => object.type === 'text').textScaleX > 1, 'saved text retains its resized aspect ratio')
      await page.locator('.cm-content').press('Control+Alt+d')
      await dialog.waitFor()
      await dialog.getByRole('button', { name: '그림 기록', exact: true }).click()
      await dialog.locator('.drawing-history-list button').first().click()
      await canvas.locator('image').waitFor()
      assert.equal(await canvas.locator('[data-drawing-object]').count(), 7)
      workspace = '/second-workspace'
      await page.evaluate('window.changeWorkspace("/second-workspace")')
      await dialog.waitFor({ state: 'detached' })
      assert.equal(uploads.length, 1, 'workspace switches do not attach the old drawing')
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
