import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('fullscreen keyboard geometry keeps the real agent composer and editor controls reachable without viewport resize', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const source = `import React from 'react';import {createRoot} from 'react-dom/client';
import {AgentPanel} from '${root}/src/components/AgentPanel.tsx';
import {CodePane} from '${root}/src/components/CodePane.tsx';
import {MobileKeyBar} from '@mew/mobile-keys';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {useMobileKeyboard} from '${root}/src/hooks/use-mobile-keyboard.ts';
import {observeWorkspaceViewport} from '${root}/src/utils/workspace-viewport.ts';
import {requestFullscreenWithKeyboard} from '@mew/ui/virtual-keyboard';
import {observeEditorViewport} from '@mew/ui';
localStorage.setItem('mew:locale','ko');window.sent=[];
class Socket {
 static OPEN=1;readyState=0;
 constructor(){setTimeout(()=>{this.readyState=1;this.onopen?.();this.emit({type:'history',page:{generation:'keyboard',sessionId:'current',start:0,end:0,total:0,usersBefore:0,mode:'replace',events:[],controls:[]}});this.emit({type:'meta',meta:{sessionId:'current',startedAt:new Date().toISOString(),turns:0,busy:false,queued:[],usage:null,canLoad:true,canList:true}})},10)}
 emit(event){this.onmessage?.({data:JSON.stringify(event)})}
 send(raw){window.sent.push(JSON.parse(raw))}
 close(){this.readyState=3;this.onclose?.()}
}
window.WebSocket=Socket;
function EditorFixture(){const host=React.useRef(null);const [value,setValue]=React.useState('Mobile editing');React.useEffect(()=>observeEditorViewport(host.current,()=>{},true),[]);return <section ref={host} style={{display:'flex',flexDirection:'column',height:'100%',minHeight:0,width:'100%'}}><div style={{flex:1,minHeight:0}}><CodePane path="fixture.txt" value={value} onChange={setValue} readOnly={false}/></div><footer data-editor-status-bar style={{height:16,flexShrink:0}}>File size</footer><MobileKeyBar ctrlActive={false} shiftActive={false} onToggleCtrl={()=>{}} onToggleShift={()=>{}} onEsc={()=>{}} onTab={()=>{}} onArrow={()=>{}}/></section>}
function Fixture(){
 const hidden=useMobileKeyboard(),[editor,setEditor]=React.useState(false);window.setEditor=setEditor;
 React.useEffect(()=>{const stop=observeWorkspaceViewport();window.stopViewport=stop;return stop},[]);
 return <main className="mew-workspace flex flex-col overflow-hidden bg-surface text-ink" data-mobile-keyboard={hidden||undefined} style={{height:'var(--app-height,100dvh)'}}><header style={{height:36,flexShrink:0}}><button data-fullscreen onClick={()=>requestFullscreenWithKeyboard(document.documentElement)}>Fullscreen</button></header><div className="mew-workspace-content flex min-h-0 flex-1">{editor?<EditorFixture/>:<AgentPanel cacheAccount="keyboard-test" project="test" workspacePath="/workspace" tree={[]} focusedFilePath={null} onOpenFile={()=>{}} onClose={()=>{}}/>}</div><nav aria-label="Dock" hidden={hidden}>Dock</nav></main>;
}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const candidates = [source]
  const bundle = await build({ input: 'virtual:fullscreen-keyboard.tsx', write: false, platform: 'browser', output: { format: 'iife' },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'fullscreen-keyboard-fixture',
      async resolveId(id, importer) {
        if (id === 'virtual:fullscreen-keyboard.tsx') return id
        if (id === '@mew/tmux-term') return 'virtual:terminal'
        if (id.endsWith('.css')) return 'virtual:style'
        if (id.endsWith('?raw')) { const resolved = await this.resolve(id.slice(0, -4), importer, { skipSelf: true }); if (resolved) return `${resolved.id}?raw` }
      },
      async load(id) {
        if (id === 'virtual:fullscreen-keyboard.tsx') return source
        if (id === 'virtual:terminal') return 'export const isHiddenTmuxSession=()=>false;export function TmuxTerminal(){return null}'
        if (id === 'virtual:style') return ''
        if (id.endsWith('?raw')) return `export default ${JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))}`
        if (id.endsWith('.tsx')) candidates.push(await fs.readFile(id, 'utf8'))
      },
    }],
  })
  const chunk = bundle.output.find(item => item.type === 'chunk'); assert.ok(chunk)
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set(candidates.join('\n').match(/[A-Za-z0-9_@!&:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const [width, touch] of [[390, true], [980, true], [1280, false]] as const) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: touch })
      page.setDefaultTimeout(5000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      // Headless has no OS keyboard. Model a compositor overlay independently of
      // every viewport API and CSS root size, including legacy Chromium's y=0.
      await page.addInitScript(`window.keyboard=new EventTarget();keyboard.overlaysContent=false;keyboard.boundingRect=new DOMRect();Object.defineProperty(navigator,'virtualKeyboard',{value:keyboard,configurable:true});window.coverWithKeyboard=(height,legacy=false)=>{keyboard.boundingRect=new DOMRect(0,typeof legacy==='number'?legacy:height&&!legacy?innerHeight-height:0,height?innerWidth:0,height);const cover=document.querySelector('#keyboard');cover.style.height=height+'px';keyboard.dispatchEvent(new Event('geometrychange'))};`)
      await page.route('http://mew-fullscreen-keyboard.test/**', route => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        if (pathname === '/api/user-ui/agent-tabs') return route.fulfill({ json: { state: { tabs: [{ id: 'keyboard', label: 'History', renamed: true, runtime: 'codex', cwd: '/workspace', sessionIds: { [JSON.stringify(['codex', '/workspace'])]: 'current' } }], activeId: 'keyboard' }, claims: [] } })
        if (pathname === '/api/agent-cwd') return route.fulfill({ json: { cwd: '/workspace' } })
        if (pathname === '/api/projects') return route.fulfill({ json: [] })
        if (pathname.startsWith('/api/')) return route.fulfill({ json: { settings: null, skills: [], jobs: [], commands: [], runtimes: [] } })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,interactive-widget=resizes-content"><style>${css}#keyboard{position:fixed;inset:auto 0 0;height:0;background:#333;z-index:2147483647}</style><div id="root"></div><div id="keyboard"></div><script src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-fullscreen-keyboard.test/')
      const composer = page.locator('[data-agent-composer]')
      const input = composer.locator('[contenteditable="true"]')
      await input.waitFor()
      assert.equal(await page.evaluate('keyboard.overlaysContent'), false, 'normal pages retain resizes-content')
      await page.locator('[data-fullscreen]').click()
      await page.waitForFunction('document.fullscreenElement === document.documentElement')
      await page.waitForFunction(`keyboard.overlaysContent === ${touch}`)
      await input.fill('Keyboard test')
      const send = page.getByRole('button', { name: '전송', exact: true })
      if (!touch) {
        await page.evaluate('window.coverWithKeyboard(364)')
        await page.waitForTimeout(40)
        assert.equal(await page.locator('main').evaluate(el => el.getBoundingClientRect().bottom), 844, 'desktop never opts into keyboard overlay management')
        await page.close()
        continue
      }
      for (const legacy of [false, true, 24]) {
        await page.evaluate(`window.coverWithKeyboard(364,${legacy})`)
        await page.waitForFunction('document.querySelector("main").getBoundingClientRect().bottom === 480')
        await page.getByRole('navigation', { name: 'Dock' }).waitFor({ state: 'hidden' })
        assert.deepEqual(await input.evaluate(el => {
          const doc = el.ownerDocument, win = doc.defaultView!
          return [win.innerHeight, win.visualViewport!.height, doc.documentElement.clientHeight, doc.documentElement.getBoundingClientRect().bottom]
        }), [844, 844, 844, 844], 'all previous measurements still report an unobscured screen')
        for (const control of [composer, input, send]) {
          const bounds = (await control.boundingBox())!
          assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 480, 'composer, input and send fit above the keyboard')
        }
        assert.equal(await send.evaluate(el => {
          const bounds = el.getBoundingClientRect()
          return el.ownerDocument.elementFromPoint(bounds.x + bounds.width / 2, bounds.bottom - 1) === el
        }), true, 'the keyboard overlay does not intercept the send button')
        assert.equal(await input.evaluate(el => el === el.ownerDocument.activeElement), true)
        await page.screenshot({ path: `/tmp/mew-fullscreen-keyboard-${legacy === false ? 'standard' : legacy === true ? 'legacy-zero' : 'legacy-offset'}.png` })
        await page.evaluate('window.coverWithKeyboard(0)')
        await page.waitForFunction('document.querySelector("main").getBoundingClientRect().bottom === 844')
        await page.getByRole('navigation', { name: 'Dock' }).waitFor({ state: 'visible' })
      }
      await page.evaluate('window.coverWithKeyboard(364)')
      await page.waitForFunction('document.querySelector("main").getBoundingClientRect().bottom === 480')
      await send.click()
      await page.waitForFunction('window.sent.some(message=>message.type==="prompt")')
      assert.equal(await input.evaluate(el => el === el.ownerDocument.activeElement), true, 'sending keeps the keyboard focus')
      await page.evaluate('window.setEditor(true)')
      const editor = page.locator('.cm-content[contenteditable="true"]')
      await editor.fill('Editing above the keyboard')
      const bar = page.locator('[data-mobile-key-bar]')
      await bar.waitFor()
      await page.waitForFunction('document.querySelector("[data-mobile-key-bar]").getBoundingClientRect().bottom === 480')
      await page.waitForFunction('document.querySelector("[data-editor-status-bar]").getBoundingClientRect().bottom <= document.querySelector("[data-mobile-key-bar]").getBoundingClientRect().top')
      const status = (await page.locator('[data-editor-status-bar]').boundingBox())!
      const barBounds = (await bar.boundingBox())!
      assert.ok(status.y + status.height <= barBounds.y, 'editor status remains above the fixed key bar')
      await page.evaluate('window.coverWithKeyboard(0)')
      await page.waitForFunction(`document.querySelector('[data-mobile-key-bar]').getBoundingClientRect().bottom === ${width < 768 ? 796 : 844}`)
      await page.evaluate('window.coverWithKeyboard(364)')
      await page.waitForFunction('document.querySelector("[data-mobile-key-bar]").getBoundingClientRect().bottom === 480')
      await page.setViewportSize({ width: 1280, height: 844 })
      await page.waitForFunction('keyboard.overlaysContent === true && document.querySelector("main").getBoundingClientRect().bottom === 480')
      await page.getByRole('navigation', { name: 'Dock' }).waitFor({ state: 'hidden' })
      await page.evaluate('window.coverWithKeyboard(0)')
      await page.setViewportSize({ width: 390, height: 844 })
      await page.waitForFunction('keyboard.overlaysContent === true')
      await page.evaluate('window.coverWithKeyboard(364)')
      await page.waitForFunction('document.querySelector("[data-mobile-key-bar]").getBoundingClientRect().bottom === 480')
      await page.locator('main').evaluate(el => el.ownerDocument.exitFullscreen())
      await page.waitForFunction('keyboard.overlaysContent === false')
      await page.waitForFunction('document.querySelector("[data-mobile-key-bar]").getBoundingClientRect().bottom === 796')
      await page.getByRole('navigation', { name: 'Dock' }).waitFor({ state: 'visible' })
      await page.evaluate('window.coverWithKeyboard(0)')
      await page.locator('[data-fullscreen]').click()
      await page.waitForFunction('keyboard.overlaysContent === true')
      await page.evaluate('window.coverWithKeyboard(364); window.stopViewport()')
      await page.waitForTimeout(40)
      assert.equal(await page.evaluate('keyboard.overlaysContent'), false, 'disposal restores the prior browser policy')
      assert.equal(await page.locator('main').evaluate(el => el.ownerDocument.documentElement.style.getPropertyValue('--app-height')), '', 'queued geometry updates are cancelled on disposal')
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
