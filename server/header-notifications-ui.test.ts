import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
test('header notifications work without Mewcat and settings separate the optional cat channel', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React,{useState,useRef} from 'react';import {createRoot} from 'react-dom/client';
import {I18nProvider} from '${root}/src/i18n.tsx';import {HeaderNotifications} from '${root}/src/components/header-notifications.tsx';
import {SettingsModal} from '${root}/src/components/SettingsModal.tsx';import {Mewcat} from '${root}/src/components/Mewcat.tsx';import {publishMewcatNotice} from '${root}/src/utils/mewcat-notifications.ts';
window.addEventListener('mew:open-notification',event=>window.openedNotice=event.detail.target);
function Fixture(){const [settings,setSettings]=useState(false),[cat,setCat]=useState(null),counter=useRef(0);return <><header style={{height:40,display:'flex',justifyContent:'flex-end',alignItems:'center',gap:8}}><HeaderNotifications/><span aria-label="활성 세션">1</span><button onClick={()=>setSettings(true)}>Settings</button></header><button onClick={()=>publishMewcatNotice({key:'header:'+counter.current++,kind:'error',level:'danger',source:'Codex',target:{tabId:'agent',cwd:'/fixture'}})}>Send notice</button><button onClick={()=>setCat(cat?null:'mew')}>Toggle cat</button><Mewcat skin={cat}/>{settings&&<SettingsModal email={null} displayName={null} avatarDataUrl={null} canEditIgnore={false} theme="dark" fontPreferences={{ui:'Arial',markdown:'Arial',mono:'monospace'}} themeColor="#9082da" mewcatSkin={cat} mewcatHideDesktop={false} onClose={()=>setSettings(false)} onLoggedOut={()=>{}} onProfileChanged={()=>{}} onToggleTheme={()=>{}} onFontPreferencesChange={()=>{}} onThemeColorChange={()=>{}} onMewcatSkinChange={setCat} onMewcatHideDesktopChange={()=>{}}/>}</>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:header.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', async resolveId(id, importer) { if (id === 'virtual:header.tsx') return id; if (id.endsWith('.css')) return 'virtual:style'; if (id.endsWith('?raw')) { const resolved = await this.resolve(id.slice(0, -4), importer, { skipSelf: true }); if (resolved) return `${resolved.id}?raw` } }, async load(id) { if (id === 'virtual:header.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return `export default ${JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))}` } }] })
  const files = ['src/components/header-notifications.tsx','src/components/SettingsModal.tsx','src/components/mewcat-notifications.tsx','packages/ui/src/dialog-frame.tsx','packages/ui/src/select-field.tsx']
  const content = source + (await Promise.all(files.map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set(content.match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } }); page.setDefaultTimeout(4000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript("localStorage.setItem('mew:locale','ko')")
    await page.route('http://mew-notices.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${bundle.output.find(item=>item.type==='chunk')!.code}</script></html>` }))
    await page.goto('http://mew-notices.test/')
    const bell = page.getByRole('button', { name: '알림: 1', exact: true })
    assert.equal(await bell.count(), 0)
    await page.getByRole('button', { name: 'Send notice' }).click(); await bell.waitFor()
    assert.equal(await page.locator('.mewcat').count(), 0)
    const bellRect = (await bell.boundingBox())!, sessions = (await page.getByLabel('활성 세션').boundingBox())!
    assert.ok(bellRect.x + bellRect.width <= sessions.x)
    await bell.click()
    const notices = page.getByRole('dialog', { name: '알림', exact: true }); await notices.waitFor()
    await page.screenshot({ path: '/tmp/mew-header-notifications-desktop.png' })
    await notices.getByRole('button', { name: /에이전트.*오류/ }).click()
    assert.deepEqual(await page.evaluate('window.openedNotice'), { tabId: 'agent', cwd: '/fixture' })
    assert.equal(await bell.count(), 0)
    await page.getByRole('button', { name: 'Send notice' }).click()
    await page.getByRole('button', { name: 'Settings' }).click()
    const settings = page.getByRole('dialog', { name: '설정', exact: true })
    await settings.getByRole('button', { name: '알림', exact: true }).click()
    assert.equal(await settings.getByRole('checkbox', { name: '앱 내 알림' }).isChecked(), true)
    assert.equal(await settings.getByRole('checkbox', { name: '뮤캣으로도 알림 표시' }).count(), 0)
    await settings.getByRole('checkbox', { name: '앱 내 알림' }).uncheck(); assert.equal(await bell.count(), 0)
    await settings.getByRole('checkbox', { name: '앱 내 알림' }).check()
    await settings.getByRole('button', { name: '뮤캣', exact: true }).click()
    assert.equal(await settings.getByRole('checkbox', { name: '앱 내 알림' }).count(), 0, 'notifications moved out of the cat tab')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Toggle cat' }).click(); await page.locator('.mewcat').waitFor()
    await page.getByRole('button', { name: 'Settings' }).click()
    await settings.getByRole('button', { name: '알림', exact: true }).click()
    await settings.getByRole('checkbox', { name: '뮤캣으로도 알림 표시' }).uncheck()
    await page.screenshot({ path: '/tmp/mew-notification-settings-desktop.png' })
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.mewcat-notifications-auto').count(), 0)
    assert.equal(await bell.count(), 1)
    await page.reload(); await page.getByRole('button', { name: 'Send notice' }).click()
    await page.getByRole('button', { name: 'Toggle cat' }).click()
    assert.equal(await page.locator('.mewcat-notifications-auto').count(), 0, 'cat preference survives reload')
    await page.setViewportSize({ width: 320, height: 720 }); await page.locator('html').evaluate(el => el.classList.remove('dark'))
    await bell.click(); await notices.waitFor()
    const bounds = (await notices.boundingBox())!; assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320)
    await page.screenshot({ path: '/tmp/mew-header-notifications-mobile.png' })
    await page.keyboard.press('Escape'); assert.equal(await bell.evaluate(el => el === el.ownerDocument.activeElement), true)
    await bell.click(); await notices.getByRole('button', { name: '모두 확인', exact: true }).click()
    assert.equal(await bell.count(), 0)
    await page.getByRole('button', { name: 'Settings' }).click()
    await settings.getByRole('button', { name: '알림', exact: true }).click()
    assert.equal(await settings.getByRole('checkbox', { name: '뮤캣으로도 알림 표시' }).isChecked(), false)
    await page.screenshot({ path: '/tmp/mew-notification-settings-mobile.png' })
    await page.keyboard.press('Escape')
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
