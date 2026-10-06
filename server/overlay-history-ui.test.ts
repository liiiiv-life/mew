import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('mobile Back exhausts popup, screen visits and remaining panels before leaving the app', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `
import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {useOverlayDismiss} from '${root}/packages/ui/src/useOverlayDismiss.ts';
import {useWorkspacePanelDismissals} from '${root}/src/hooks/use-panel-dismissals.ts';
import {WORKSPACE_PANEL_IDS} from '${root}/src/utils/mobile-panel-stack.ts';
function Fixture(){
  const [open,setOpen]=useState(['agent','git']);
  const [foreground,setForeground]=useState('git');
  const [screen,setScreen]=useState('list');
  const [popup,setPopup]=useState(false);
  const panels=Object.fromEntries(WORKSPACE_PANEL_IDS.map(id=>[id,{
    open:open.includes(id),close:()=>{
      const remaining=open.filter(p=>p!==id);setOpen(remaining);setForeground(remaining.at(-1)??'editor');
    }
  }]));
  useWorkspacePanelDismissals(panels,foreground==='editor'?null:foreground,{
    enabled:true,scope:'fixture',show:setForeground,
    screens:{git:{key:screen,restore:()=>setScreen(screen)}}
  });
  useOverlayDismiss(popup&&(()=>setPopup(false)));
  return <><div data-screen>{foreground}:{screen}:{popup?'popup':'plain'}</div>
    <button onClick={()=>setScreen('diff')}>Diff</button>
    <button onClick={()=>setForeground('editor')}>Editor</button>
    <button onClick={()=>setPopup(true)}>Popup</button></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const bundle = await build({ input: 'virtual:overlay-history.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:overlay-history.tsx') return id; if (id.endsWith('.css')) return 'virtual:empty-css'; return null }, load(id) { if (id === 'virtual:overlay-history.tsx') return source; if (id === 'virtual:empty-css') return ''; return null } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')
  assert.ok(chunk && chunk.type === 'chunk')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://mew-history.test/**', route => {
      const pathname = new URL(route.request().url()).pathname
      return route.fulfill(pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : {
        contentType: 'text/html', body: pathname === '/before' ? '<p>Before mew</p>' : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>',
      })
    })
    await page.goto('http://mew-history.test/before')
    await page.goto('http://mew-history.test/app')
    const state = page.locator('[data-screen]')
    const expectState = async (value: string) => {
      await page.waitForFunction(`document.querySelector('[data-screen]')?.textContent === ${JSON.stringify(value)}`)
      assert.equal(page.url(), 'http://mew-history.test/app')
    }
    const back = async (expected: string, guarded = true) => {
      await state.evaluate(el => el.ownerDocument.defaultView?.history.back())
      await expectState(expected)
      await page.waitForFunction(`!!history.state?.mewOverlayGuard === ${guarded}`)
    }
    await expectState('git:list:plain')
    await page.getByRole('button', { name: 'Diff', exact: true }).click()
    await page.getByRole('button', { name: 'Editor', exact: true }).click()
    await page.getByRole('button', { name: 'Popup', exact: true }).click()
    await back('editor:diff:plain')
    await back('git:diff:plain')
    await back('git:list:plain')
    // This close retains the same shared overlay registration for the remaining agent panel.
    await back('agent:list:plain')
    await back('editor:list:plain', false)
    assert.equal(await state.textContent(), 'editor:list:plain')
    await state.evaluate(el => el.ownerDocument.defaultView?.history.back())
    await page.waitForURL('http://mew-history.test/before')
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
