import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
const root = path.resolve(import.meta.dirname, '..')
test('fur picker updates every cat, restores after reload and resets on desktop/mobile', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
 const source = `import React from '${root}/node_modules/react/index.js';import {createRoot} from '${root}/node_modules/react-dom/client.js';import {I18nProvider} from '${root}/src/i18n.tsx';import {SettingsModal} from '${root}/src/components/SettingsModal.tsx';import {MewcatMark} from '${root}/src/components/Mewcat.tsx';import {loadFontPreferences} from '${root}/src/utils/fontPreferences.ts';createRoot(document.getElementById('root')).render(<I18nProvider><SettingsModal email={null} displayName={null} avatarDataUrl={null} canEditIgnore={false} theme="dark" themeColor="#4432a8" onThemeColorChange={()=>{}} fontPreferences={loadFontPreferences()} onFontPreferencesChange={()=>{}} mewcatSkin="mew" onMewcatSkinChange={()=>{}} onMewcatHideDesktopChange={()=>{}} onToggleTheme={()=>{}} onClose={()=>{}} onLoggedOut={()=>{}}/><div className="fixed bottom-0 left-0"><MewcatMark className="live-cat h-12 w-12"/><MewcatMark className="giant-cat h-24 w-24"/></div></I18nProvider>);`
 const bundle = await build({input:'virtual:fur.tsx',write:false,platform:'browser',output:{format:'iife'},transform:{jsx:'react-jsx',define:{'process.env.NODE_ENV':JSON.stringify('test')}},plugins:[{name:'fixture',resolveId(id){if(id==='virtual:fur.tsx')return id;if(id.endsWith('.css'))return 'virtual:style'},load(id){if(id==='virtual:fur.tsx')return source;if(id==='virtual:style')return ''}}]})
 const content = source + await fs.readFile(`${root}/src/components/SettingsModal.tsx`,'utf8') + await fs.readFile(`${root}/packages/ui/src/color-picker.tsx`,'utf8')
 const compiler = await compile(await fs.readFile(`${root}/src/index.css`,'utf8'),{base:`${root}/src`,onDependency(){}})
 const css = compiler.build([...new Set(content.match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
 const browser = await chromium.launch({executablePath:domBrowserExecutable(),chromiumSandbox:true})
 try {
  const page = await browser.newPage({viewport:{width:1100,height:800}})
  await page.addInitScript(()=>localStorage.setItem('mew:locale','ko'))
  await page.route('http://fixture/**',route=>route.fulfill(route.request().url().endsWith('/app.js')?{contentType:'text/javascript',body:bundle.output[0].code}: {contentType:'text/html',body:`<html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`}))
  await page.goto('http://fixture/')
  await page.getByRole('button',{name:'뮤캣',exact:true}).click()
  const hex = page.getByRole('textbox',{name:'털색 HEX',exact:true})
  await hex.fill('#ff8800')
  const fur = () => page.locator('.live-cat path').first().evaluate(el=>el.ownerDocument.defaultView!.getComputedStyle(el).fill)
  assert.equal(await fur(),'rgb(255, 136, 0)')
  assert.equal(await page.locator('.giant-cat path').first().evaluate(el=>el.ownerDocument.defaultView!.getComputedStyle(el).fill),'rgb(255, 136, 0)')
  assert.equal(await page.evaluate("localStorage.getItem('mew:mewcat-fur-color')"),'#ff8800')
  await page.screenshot({path:'/tmp/mew-fur-desktop.png'})
  await page.reload()
  assert.equal(await fur(),'rgb(255, 136, 0)')
  await page.getByRole('button',{name:'뮤캣',exact:true}).click()
  await page.setViewportSize({width:390,height:720})
  await hex.fill('#ffffff')
  assert.equal(await fur(),'rgb(255, 255, 255)')
  await page.screenshot({path:'/tmp/mew-fur-mobile.png'})
  await page.getByRole('button',{name:'초기화',exact:true}).first().click()
  assert.equal(await fur(),'rgb(23, 23, 23)')
 } finally {await browser.close()}
})
