import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { mewcatAssistantMessages } from '../src/components/mewcat-assistant-copy.ts'
import { LOCALES } from '../src/i18n-locales.ts'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(`${root}/package.json`)
type Fixture = { setLocale: (locale: string) => void; current: { receive: (message: object) => void }; prompts: string[]; actions: object[]; connections: number; runtime: string }

test('Mewcat assistant supports translated connection, chat, IME, actions, replay and agent switching on desktop and mobile', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const source = `
import React from '${require.resolve('react')}';
import {createRoot} from '${require.resolve('react-dom/client')}';
import {I18nProvider,useI18n} from '${root}/src/i18n.tsx';
import {Mewcat} from '${root}/src/components/Mewcat.tsx';
window.actions=[];window.prompts=[];window.connections=0;
const meta={sessionId:'assistant-session',busy:false,queued:[],canLoad:true,canList:false,turns:0};
class FakeSocket {
 static OPEN=1;readyState=1;
 constructor(url){window.current=this;window.connections++;window.runtime=new URL(url).searchParams.get('runtime');setTimeout(()=>{this.onopen?.();this.receive({type:'meta',meta})},10)}
 receive(message){this.onmessage?.({data:JSON.stringify(message)})}
 send(raw){const m=JSON.parse(raw);if(m.type==='prompt'){window.prompts.push(m.text);this.receive({type:'turn_start'});this.receive({type:'update',update:{sessionUpdate:'user_message_chunk',content:{type:'text',text:m.text}}});this.receive({type:'update',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'프로젝트를 준비했어요.'}}});this.receive({type:'turn_end',stopReason:'end_turn'});}if(m.type==='mewcat_action_result')window.actions.push(m);if(m.type==='clear_session')this.receive({type:'reset'});}
 close(){this.readyState=3;this.onclose?.()}
}
window.WebSocket=FakeSocket;
function Fixture(){const {setLocale}=useI18n();window.setLocale=setLocale;const [runtime,setRuntime]=React.useState(null);const [choose,setChoose]=React.useState(false);const [project,setProject]=React.useState('/workspace');return <>
{choose&&<button onClick={()=>{setRuntime('codex');setChoose(false)}}>Choose Codex</button>}
<Mewcat skin="mew" onOpenSystemStats={()=>{}} assistant={{account:'owner@test',enabled:true,runtime,projectRoot:project,onRuntimeChange:setRuntime,onConnect:()=>setChoose(true),onAction:async action=>{if(action.kind==='open_project')setProject(action.path)}}}/>
</>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:mewcat-assistant.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:mewcat-assistant.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:mewcat-assistant.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')
  assert.ok(chunk && chunk.type === 'chunk')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const uiSource = (await Promise.all(['mewcat-assistant.tsx', 'mewcat-resources.tsx', 'mewcat-notifications.tsx'].map(file => fs.readFile(`${root}/src/components/${file}`, 'utf8')))).join(' ')
  const css = compiler.build([...new Set(uiSource.match(/[\w:/.[\]()%,-]+/g) ?? [])])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), headless: true, args: ['--no-sandbox'] })
  try {
    for (const mobile of [false, true]) {
      const width = mobile ? 390 : 1100
      const page = await browser.newPage({ viewport: { width, height: mobile ? 844 : 800 }, isMobile: mobile, hasTouch: mobile })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://assistant.test/**', route => {
        if (route.request().url().includes('/api/system-stats')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ cpu: { usage: 15 }, memory: { used: 1, total: 2 }, gpus: [] }) })
        if (route.request().url().includes('/api/agent-runtimes')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runtimes: [{ id: 'codex', label: 'Codex', surface: 'acp', installed: true }, { id: 'claude', label: 'Claude Agent', surface: 'acp', installed: true }] }) })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html ${mobile ? '' : 'class="dark"'}><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${chunk.code}</script></html>` })
      })
      await page.goto('http://assistant.test/')
      await page.locator('.mewcat').click()
      const popup = page.locator('.mewcat-notifications')
      for (const locale of LOCALES) {
        await page.evaluate(locale => (globalThis as unknown as Fixture).setLocale(locale), locale)
        const c = mewcatAssistantMessages(locale)
        await popup.getByRole('button', { name: c['mewcat.assistant.connect'], exact: true }).waitFor()
        assert.equal(await popup.getByText(c['mewcat.assistant.guide'], { exact: true }).count(), 1)
      }
      await page.evaluate(() => (globalThis as unknown as Fixture).setLocale('ko'))
      await popup.getByRole('button', { name: '에이전트 연결', exact: true }).click()
      await page.getByRole('button', { name: 'Choose Codex' }).click()
      await page.locator('.mewcat').click()
      const input = popup.getByRole('textbox', { name: '뮤 도우미에게 질문' })
      await input.waitFor()
      await page.waitForFunction(() => (globalThis as unknown as Fixture).connections === 1)
      await input.fill('메모 앱을 만들고 싶어')
      await input.evaluate(el => el.dispatchEvent(new el.ownerDocument.defaultView!.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })))
      assert.deepEqual(await page.evaluate(() => (globalThis as unknown as Fixture).prompts), [])
      await input.press('Enter')
      await popup.getByText('프로젝트를 준비했어요.', { exact: true }).waitFor()
      assert.deepEqual(await page.evaluate(() => (globalThis as unknown as Fixture).prompts), ['메모 앱을 만들고 싶어'])
      await page.evaluate(() => (globalThis as unknown as Fixture).current.receive({ type: 'mewcat_action', id: 'open-1', action: { kind: 'open_project', path: '/workspace/notes' } }))
      await page.waitForFunction(() => (globalThis as unknown as Fixture).actions.length === 1)
      assert.equal(await page.evaluate(() => (globalThis as unknown as Fixture).connections), 1, 'project changes retain the assistant session')
      for (const locale of LOCALES) {
        await page.evaluate(locale => (globalThis as unknown as Fixture).setLocale(locale), locale)
        const c = mewcatAssistantMessages(locale)
        await popup.getByRole('textbox', { name: c['mewcat.assistant.input'] }).waitFor()
        assert.equal(await popup.getByRole('textbox').getAttribute('placeholder'), c['mewcat.assistant.hint'])
        assert.equal(await popup.getByRole('button', { name: c['mewcat.assistant.change'], exact: true }).count(), 1)
        assert.equal(await popup.getByText('프로젝트를 준비했어요.', { exact: true }).count(), 1, 'existing response stays in its original language')
      }
      await page.evaluate(() => (globalThis as unknown as Fixture).setLocale('ko'))
      for (const theme of ['dark', 'light']) {
        await page.locator('html').evaluate((el, dark) => el.classList.toggle('dark', dark), theme === 'dark')
        const box = await popup.boundingBox()
        assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width)
        assert.equal(await page.locator('html').evaluate(el => el.scrollWidth <= el.ownerDocument.defaultView!.innerWidth), true)
        await page.screenshot({ path: `/tmp/mewcat-assistant-${mobile ? 'mobile' : 'desktop'}-${theme}.png` })
      }
      await popup.getByRole('button', { name: '닫기', exact: true }).click()
      await page.locator('.mewcat').click()
      await popup.getByText('프로젝트를 준비했어요.', { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => (globalThis as unknown as Fixture).connections), 1, 'closing the popup keeps the conversation alive')
      await popup.getByRole('button', { name: '도우미 에이전트 변경', exact: true }).click()
      await popup.getByRole('combobox', { name: '도우미 에이전트', exact: true }).click()
      await page.getByRole('option', { name: 'Claude Agent', exact: true }).click()
      await page.waitForFunction(() => (globalThis as unknown as Fixture).runtime === 'claude')
      await page.evaluate(() => (globalThis as unknown as Fixture).current.receive({ type: 'replay', events: [{ type: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Restored response' } } }] }))
      await popup.getByText('Restored response', { exact: true }).waitFor()
      assert.equal(await popup.getByText('프로젝트를 준비했어요.', { exact: true }).count(), 0)
      await page.evaluate(() => (globalThis as unknown as Fixture).current.receive({ type: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '\nLong response\n'.repeat(100) } } }))
      await page.waitForFunction(() => (globalThis as unknown as Fixture).connections === 2)
      assert.equal(await popup.locator('.mewcat-assistant-conversation').evaluate(el => {
        const style = el.ownerDocument.defaultView!.getComputedStyle(el)
        return style.maxHeight === 'none' && style.overflowY === 'visible'
      }), true)
      assert.equal(await popup.locator('.mewcat-notifications-content').evaluate(el => el.scrollHeight > el.clientHeight), true)
      const clear = popup.getByRole('button', { name: '대화 기록 지우기', exact: true })
      await page.evaluate(() => (globalThis as unknown as Fixture).current.receive({ type: 'turn_start' }))
      assert.equal(await clear.isDisabled(), true)
      await page.evaluate(() => (globalThis as unknown as Fixture).current.receive({ type: 'turn_end', stopReason: 'end_turn' }))
      await clear.click()
      assert.equal(await popup.getByRole('log').locator('p').count(), 0)
      assert.equal(await clear.isDisabled(), true)
      await page.evaluate(() => (globalThis as unknown as Fixture).current.receive({ type: 'error', message: 'MEWCAT_ACTION_FAILED' }))
      await popup.getByRole('button', { name: '다시 연결', exact: true }).waitFor()
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
