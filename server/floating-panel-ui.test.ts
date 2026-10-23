import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
const root = path.resolve(import.meta.dirname, '..'), require = createRequire(`${root}/package.json`)
test('popup modes preserve content, resize, move, restore and return to mobile panels', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const source = `import React,{useState,useRef} from '${require.resolve('react')}';
import {createRoot} from '${require.resolve('react-dom/client')}';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {DockWorkspace,DockPanel} from '${root}/src/components/DockWorkspace.tsx';
import {useToolPresentation} from '${root}/src/hooks/use-tool-presentation.ts';
import {ToolPresentationToggle} from '${root}/src/components/tool-presentation-toggle.tsx';
import {SettingsModal} from '${root}/src/components/SettingsModal.tsx';
function Fixture(){ const [state,setState]=useState(null),[settings,setSettings]=useState(false),[memoClosed,setMemoClosed]=useState(false),ref=useRef(null),modes=useToolPresentation(); return <div className="flex h-dvh flex-col bg-surface text-ink"><button onClick={()=>setSettings(true)}>Settings</button><div className="mew-workspace-content relative flex min-h-0 flex-1 overflow-hidden"><aside data-sidebar className="hidden w-64 shrink-0 bg-surface md:block">Documents</aside><DockWorkspace apiRef={ref} value={state} onChange={setState} foreground="memo" onEditorDrop={()=>'main'}><DockPanel id="editor:main" kind="editor" tabs={['a']}><div>editor</div></DockPanel><DockPanel id="memo" kind="memo" visible={!memoClosed} floating={modes.memo==='popup'} storageKey="fixture:popup" tabs={['memo']} mobileSelected><div className="shared-memo flex h-full flex-col"><header data-dock-tab-bar className="flex h-9 shrink-0"><div role="tab" tabIndex={0} className="flex-1">메모</div><ToolPresentationToggle tool="memo"/><button aria-label="닫기" onClick={()=>setMemoClosed(true)}>×</button></header><textarea className="min-h-0 flex-1" defaultValue="draft" /></div></DockPanel><DockPanel id="tasks" kind="tasks" floating={modes.tasks==='popup'} storageKey="fixture:tasks" tabs={['tasks']}><div data-dock-tab-bar className="flex h-9 shrink-0">태스크<ToolPresentationToggle tool="tasks"/></div><textarea defaultValue="task draft" /></DockPanel></DockWorkspace></div>{settings&&<SettingsModal email={null} displayName={null} avatarDataUrl={null} canEditIgnore={false} theme="dark" fontPreferences={{ui:'Arial',markdown:'Arial',mono:'monospace'}} themeColor="#9082da" mewcatSkin={null} mewcatHideDesktop={false} onClose={()=>setSettings(false)} onLoggedOut={()=>{}} onProfileChanged={()=>{}} onToggleTheme={()=>{}} onFontPreferencesChange={()=>{}} onThemeColorChange={()=>{}} onMewcatSkinChange={()=>{}} onMewcatHideDesktopChange={()=>{}}/>}</div>};createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:fixture.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', async resolveId(id, importer) { if (id.endsWith('?raw')) { const resolved = await this.resolve(id.slice(0, -4), importer, {skipSelf:true}); if (resolved) return resolved.id+'?raw' } if (id === 'virtual:fixture.tsx') return id; if(id.endsWith('.css')) return 'virtual:style' }, async load(id) { if(id.endsWith('?raw')) return 'export default '+JSON.stringify(await fs.readFile(id.slice(0,-4),'utf8')); if (id === 'virtual:fixture.tsx') return source; if(id==='virtual:style') return '' } }] })
  const content = source + (await Promise.all(['src/components/DockWorkspace.tsx', 'src/components/tool-presentation-toggle.tsx', 'src/components/SettingsModal.tsx', 'packages/ui/src/select-field.tsx'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set(content.match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))]) + '\n' + await fs.readFile(`${root}/src/components/shared-memo.css`, 'utf8')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
    await page.route('http://fixture/**', route => route.fulfill(route.request().url().endsWith('/app.js') ? { contentType: 'text/javascript', body: bundle.output[0].code } : { contentType: 'text/html', body: `<html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` }))
    await page.addInitScript(() => localStorage.setItem('mew:locale', 'ko'))
    await page.goto('http://fixture/')
    const memo = page.locator('[data-dock-panel="memo"]')
    await memo.locator('textarea').fill('preserved draft')
    await memo.getByRole('button', { name: '팝업으로 전환', exact: true }).click()
    await page.locator('[data-floating-panel]').waitFor()
    assert.equal(await memo.locator('textarea').inputValue(), 'preserved draft')
    await memo.evaluate(el => el.ownerDocument.documentElement.classList.add('theme-gradient'))
    const appearance = () => memo.evaluate(el => ({ opacity: el.ownerDocument.defaultView!.getComputedStyle(el).opacity, blur: el.ownerDocument.defaultView!.getComputedStyle(el).backdropFilter }))
    assert.equal((await appearance()).opacity, '1', 'focused popup retains full opacity')
    assert.equal((await appearance()).blur, 'blur(6px)', 'focused popup retains theme blur')
    await page.getByRole('button', { name: 'Settings', exact: true }).focus()
    assert.deepEqual(await appearance(), { opacity: '0.2', blur: 'none' }, 'outside focus dims the popup and removes blur')
    await memo.getByRole('tab').click()
    assert.equal((await appearance()).opacity, '1', 'clicking the title restores the active appearance')
    await memo.locator('textarea').focus()
    assert.equal((await appearance()).blur, 'blur(6px)', 'keyboard focus inside restores theme blur')
    await memo.evaluate(el => el.ownerDocument.documentElement.classList.remove('theme-gradient'))
    const before = (await memo.boundingBox())!
    assert.equal(await memo.getByRole('button', { name: '위치 이동', exact: true }).count(), 0)
    const handle = memo.locator('[data-dock-tab-bar]')
    const box = (await handle.boundingBox())!
    await page.mouse.move(box.x + 30, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + 110, box.y + box.height / 2 + 50); await page.mouse.up()
    const moved = (await memo.boundingBox())!
    assert.ok(moved.x > before.x + 60 && moved.y > before.y + 30)
    await memo.getByRole('tab').focus()
    await page.keyboard.press('ArrowRight')
    assert.equal((await memo.boundingBox())!.x, moved.x + 12, 'title tab supports keyboard movement')
    await memo.getByRole('button', { name: '크기 조절', exact: true }).focus()
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown')
    const sidebarMove = (await handle.boundingBox())!
    await page.mouse.move(sidebarMove.x + 30, sidebarMove.y + sidebarMove.height / 2)
    await page.mouse.down()
    await page.mouse.move(40, sidebarMove.y + sidebarMove.height / 2)
    await page.mouse.up()
    const overSidebar = (await memo.boundingBox())!
    const dockBounds = (await page.locator('[data-dock-workspace]').boundingBox())!
    assert.ok(overSidebar.x < dockBounds.x, 'memo can move over the sidebar outside the dock')
    assert.equal(await handle.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(el.ownerDocument.elementFromPoint(r.x + 10, r.y + 10)) }), true, 'popup remains visible and interactive over the sidebar')
    assert.equal(await memo.locator('textarea').inputValue(), 'preserved draft')
    const resized = (await memo.boundingBox())!
    assert.ok(resized.width > moved.width && resized.height > moved.height)
    const saved = await page.evaluate("localStorage.getItem('fixture:popup')")
    await page.reload(); await page.locator('[data-floating-panel]').waitFor()
    assert.deepEqual(await memo.boundingBox(), resized)
    const tasks = page.locator('[data-dock-panel="tasks"]')
    await tasks.getByRole('button', { name: '팝업으로 전환', exact: true }).click()
    await tasks.locator('[aria-label="패널로 전환"]').waitFor()
    assert.equal(await memo.getAttribute('data-floating-panel'), 'true', 'each tool toggles independently')
    await memo.evaluate(el => { el.style.zIndex = '1049' })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '설정', exact: true })
    await settings.waitFor()
    assert.equal(await settings.evaluate(el => el.parentElement === el.ownerDocument.body), true)
    assert.equal(await settings.evaluate(el => { const doc = el.ownerDocument; return el.contains(doc.elementFromPoint(100, 100)) }), true, 'settings cover the workspace layer range')
    assert.equal(await settings.getByText('메모 (PC)', { exact: true }).count(), 0)
    assert.equal(await settings.getByText('태스크 (PC)', { exact: true }).count(), 0)
    const language = settings.getByRole('combobox', { name: '언어', exact: true })
    await language.click()
    const languageMenu = settings.getByRole('listbox', { name: '언어', exact: true })
    await languageMenu.waitFor()
    assert.equal(await languageMenu.evaluate(el => { const rect = el.getBoundingClientRect(); return el.contains(el.ownerDocument.elementFromPoint(rect.x + 10, rect.y + 10)) }), true, 'settings dropdown remains above its modal')
    await page.screenshot({ path: '/tmp/mew-popup-settings-desktop.png' })
    await page.keyboard.press('Escape'); assert.equal(await settings.count(), 1)
    await page.keyboard.press('Escape'); assert.equal(await settings.count(), 0)
    await tasks.getByRole('button', { name: '패널로 전환', exact: true }).click()
    assert.equal(await tasks.locator('textarea').inputValue(), 'task draft')
    await page.screenshot({ path: '/tmp/mew-popup-desktop.png' })
    await page.setViewportSize({ width: 390, height: 720 })
    await memo.evaluate(el => new Promise<void>(resolve => { const check = () => { if (!el.hasAttribute('data-floating-panel')) resolve(); else setTimeout(check, 10) }; check() }))
    assert.ok((await memo.boundingBox())!.width <= 390)
    assert.equal(await memo.getByRole('button', { name: '패널로 전환', exact: true }).isVisible(), false)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await settings.getByRole('button', { name: '화면', exact: true }).click()
    await settings.getByRole('combobox', { name: '언어', exact: true }).click()
    await languageMenu.waitFor()
    await page.screenshot({ path: '/tmp/mew-popup-settings-mobile.png' })
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
    assert.equal(await page.evaluate("localStorage.getItem('fixture:popup')"), saved)
    await page.screenshot({ path: '/tmp/mew-popup-mobile.png' })
    await page.setViewportSize({ width: 1100, height: 800 })
    await page.locator('[data-floating-panel]').waitFor()
    await memo.getByRole('button', { name: '패널로 전환', exact: true }).click()
    await memo.evaluate(el => new Promise<void>(resolve => { const check = () => { if (!el.hasAttribute('data-floating-panel')) resolve(); else setTimeout(check, 10) }; check() }))
    assert.equal(await memo.locator('textarea').inputValue(), 'draft')
    await memo.getByRole('button', { name: '팝업으로 전환', exact: true }).click()
    await memo.getByRole('button', { name: '닫기', exact: true }).click()
    assert.equal(await memo.isVisible(), false, 'close button still closes the popup')
  } finally { await browser.close() }
})
