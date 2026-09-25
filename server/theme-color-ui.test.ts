import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('one theme color migrates, edits, resets and adapts live in desktop/mobile settings', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const source = `import React,{useState,useEffect} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {SettingsModal} from '${root}/src/components/SettingsModal.tsx';
import {ConfirmDialog} from '${root}/packages/ui/src/ConfirmDialog.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {loadFontPreferences,saveFontPreferences} from '${root}/src/utils/fontPreferences.ts';
import {applyThemeColor,loadThemeColor,saveThemeColor} from '${root}/src/utils/theme-color.ts';
localStorage.setItem('mew:locale','ko');
if(!localStorage.getItem('fixture-seeded')){localStorage.setItem('mew:accent-color',JSON.stringify({accent:'#185e91',accentStrong:'#000000',link:'#ffffff'}));localStorage.setItem('fixture-seeded','1')}
function Fixture(){
 const [theme,setTheme]=useState(localStorage.getItem('mew:theme')||'dark'),[color,setColor]=useState(loadThemeColor),[danger,setDanger]=useState(false);
 const [fonts,setFonts]=useState(loadFontPreferences);
 useEffect(()=>{document.documentElement.classList.toggle('dark',theme==='dark');localStorage.setItem('mew:theme',theme);applyThemeColor(color,theme)},[color,theme]);
 useEffect(()=>{saveThemeColor(color)},[color]);
 return <><SettingsModal email={null} displayName={null} avatarDataUrl={null} canEditIgnore={false} theme={theme} themeColor={color} onThemeColorChange={setColor} fontPreferences={fonts} onFontPreferencesChange={next=>{setFonts(next);saveFontPreferences(next)}} mewcatSkin={null} onMewcatSkinChange={()=>{}} onToggleTheme={()=>setTheme(t=>t==='dark'?'light':'dark')} onClose={()=>localStorage.setItem('settings-closed','1')} onLoggedOut={()=>{}}/>
 <div style={{position:'fixed',bottom:0,left:0,zIndex:60,display:'flex',gap:12,padding:8,background:'var(--color-surface)'}}><a id="sample-link" className="text-link" href="#">링크</a><button id="sample-button" className="bg-accent text-ink-on-accent hover:bg-accent-strong" onClick={()=>setDanger(true)}>삭제 확인 열기</button></div>
 {danger&&<ConfirmDialog message="삭제 확인" confirmLabel="삭제" danger onConfirm={()=>setDanger(false)} onCancel={()=>setDanger(false)}/>}</>
}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:theme.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:theme.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:theme.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk'); assert.ok(chunk)
  const content = (await Promise.all(['src/components/SettingsModal.tsx', 'packages/ui/src/select-field.tsx', 'packages/ui/src/color-picker.tsx', 'packages/ui/src/ConfirmDialog.tsx', 'packages/ui/src/dialog-frame.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@!&:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
    page.setDefaultTimeout(5000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.route('http://localhost:48975/**', route => route.fulfill(new URL(route.request().url()).pathname === '/app.js'
      ? { contentType: 'text/javascript', body: chunk.code }
      : { contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` }))
    await page.goto('http://localhost:48975/')
    const field = page.getByRole('textbox', { name: '테마색 HEX 코드' })
    const tokens = () => page.evaluate(`(()=>{const s=getComputedStyle(document.documentElement);return ['accent','accent-strong','link','ink-on-accent'].map(k=>s.getPropertyValue('--color-'+k).trim())})()`)
    await field.waitFor()
    assert.equal(await page.locator('select, datalist, input[list]').count(), 0)
    const language = page.getByRole('combobox', { name: '언어', exact: true })
    await language.press('ArrowDown'); await language.press('ArrowDown')
    assert.equal(await page.evaluate("localStorage.getItem('mew:locale')"), 'ko', 'navigation does not save')
    await language.press('Enter')
    await page.getByRole('combobox', { name: 'Language', exact: true }).click()
    await page.getByRole('option', { name: '한국어', exact: true }).click()
    const font = page.getByRole('combobox', { name: '코드', exact: true })
    await font.fill('Custom'); await font.press('End'); await font.press('Space'); await font.pressSequentially('Mono')
    assert.equal(await font.inputValue(), 'Custom Mono', 'custom fonts allow spaces')
    await font.press('Home'); await font.press('End'); await font.press('Enter')
    assert.equal(await font.inputValue(), 'Custom Mono', 'text editing does not pick a suggestion')
    await font.click()
    await font.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
    assert.equal(await font.inputValue(), 'Custom Mono', 'IME confirmation does not pick a suggestion')
    await language.click()
    assert.equal(await page.getByRole('listbox', { name: '코드', exact: true }).count(), 0, 'outside click closes font suggestions')
    await language.press('Escape')
    await page.reload(); await font.waitFor()
    assert.equal(await font.inputValue(), 'Custom Mono', 'custom font survives reload')
    await font.click(); await font.press('ArrowUp'); await font.press('Enter')
    assert.equal(await font.inputValue(), 'Consolas')
    await font.click(); await font.press('Escape')
    assert.equal(await page.getByRole('listbox').count(), 0)
    assert.equal(await font.evaluate(el => el.ownerDocument.activeElement === el), true)
    await font.click(); await page.evaluate('history.back()'); await page.getByRole('listbox').waitFor({ state: 'hidden' })
    await font.click(); await font.press('Tab')
    assert.equal(await page.getByRole('listbox').count(), 0)
    await page.keyboard.press('Enter')
    assert.equal(await font.inputValue(), 'IBM Plex Mono', 'Tab reaches the font reset button')
    assert.equal(await page.locator('input[type=color]').count(), 0)
    assert.equal(await field.inputValue(), '#185e91')
    await page.waitForFunction(`localStorage.getItem('mew:theme-color')==='#185e91'`)
    const original = await tokens()
    await field.fill('#')
    assert.deepEqual(await tokens(), original, 'partial HEX input does not replace the palette')
    await field.fill('#DDAA22')
    await page.waitForFunction(`localStorage.getItem('mew:theme-color')==='#ddaa22'`)
    const dark = await tokens()
    await page.getByRole('button', { name: '라이트', exact: true }).click()
    const light = await tokens(); assert.notDeepEqual(light, dark)
    assert.equal(await field.inputValue(), '#ddaa22')
    await page.reload(); await field.waitFor()
    assert.equal(await field.inputValue(), '#ddaa22'); assert.deepEqual(await tokens(), light)
    await field.fill('#oops'); await field.blur()
    assert.equal(await field.inputValue(), '#ddaa22')
    const trigger = page.getByRole('button', { name: '테마색', exact: true })
    const picker = page.getByRole('group', { name: '테마색', exact: true })
    await trigger.click()
    const hue = page.getByRole('slider', { name: '색조', exact: true })
    const saturation = page.getByRole('slider', { name: '채도', exact: true })
    const brightness = page.getByRole('slider', { name: '밝기', exact: true })
    await hue.fill('210'); await saturation.fill('67'); await brightness.fill('60')
    assert.equal(await field.inputValue(), '#326699')
    await hue.focus(); await hue.press('ArrowRight')
    assert.equal(await hue.inputValue(), '211')
    await brightness.fill('0'); await hue.fill('120'); await saturation.fill('100'); await brightness.fill('100')
    assert.equal(await field.inputValue(), '#00ff00', 'black retains hue and saturation edits')
    await saturation.fill('0'); await hue.fill('240'); await saturation.fill('100')
    assert.equal(await field.inputValue(), '#0000ff', 'gray retains hue edits')
    const plane = picker.locator('[aria-hidden=true]')
    const planeRect = await plane.boundingBox(); assert.ok(planeRect)
    await page.mouse.move(planeRect.x + planeRect.width / 2, planeRect.y + planeRect.height / 2)
    await page.mouse.down(); await page.mouse.move(planeRect.x + planeRect.width + 10, planeRect.y - 10); await page.mouse.up()
    assert.equal(await field.inputValue(), '#0000ff', 'dragging beyond the plane clamps at its edge')
    await hue.press('Escape')
    assert.equal(await picker.count(), 0)
    assert.equal(await trigger.evaluate(el => el.ownerDocument.activeElement === el), true)
    await field.fill('#oops'); await field.press('Escape')
    assert.equal(await field.inputValue(), '#0000ff')
    await trigger.click(); await page.evaluate('history.back()'); await picker.waitFor({ state: 'hidden' })
    await trigger.click(); await page.getByRole('button', { name: '라이트', exact: true }).click()
    assert.equal(await picker.count(), 0, 'outside click dismisses the picker')
    await field.locator('..').getByRole('button', { name: '초기화' }).click()
    assert.equal(await field.inputValue(), '#4432a8')
    for (const width of [1100, 390, 320]) {
      await page.setViewportSize({ width, height: 850 })
      if (width === 390) await page.getByRole('button', { name: '화면', exact: true }).click()
      for (const mode of ['dark', 'light']) {
        await page.getByRole('button', { name: mode === 'dark' ? '다크' : '라이트', exact: true }).click()
        for (const dropdown of [language, font]) {
          await dropdown.click()
          const list = page.getByRole('listbox')
          const bounds = await list.boundingBox()
          assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 850)
          if (process.env.MEW_THEME_SCREENSHOTS) {
            await fs.mkdir(process.env.MEW_THEME_SCREENSHOTS, { recursive: true })
            await page.screenshot({ path: path.join(process.env.MEW_THEME_SCREENSHOTS, `${width}-${mode}-${dropdown === font ? 'font' : 'language'}.png`) })
          }
          if (dropdown === font && width === 390 && mode === 'dark') {
            const option = page.getByRole('option', { name: 'Georgia', exact: true })
            await option.scrollIntoViewIfNeeded()
            const box = await option.boundingBox(); assert.ok(box)
            const touch = await page.context().newCDPSession(page)
            await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] })
            await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
            await touch.detach()
            assert.equal(await font.inputValue(), 'Georgia')
          } else await dropdown.press('Escape')
        }
        const rect = await field.boundingBox(); assert.ok(rect && rect.width > 80 && rect.x >= 0 && rect.x + rect.width <= width)
        assert.equal(await page.evaluate('document.documentElement.scrollWidth>innerWidth'), false)
        const ink = await page.locator('#sample-button').evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).color)
        assert.equal(ink, mode === 'dark' ? 'rgb(23, 23, 23)' : 'rgb(255, 255, 255)')
        const before = await page.locator('#sample-button').evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor)
        await page.locator('#sample-button').hover()
        const hover = await page.locator('#sample-button').evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor)
        assert.notEqual(hover, before)
        await page.mouse.move(0, 0)
        await trigger.click()
        const pickerRect = await picker.boundingBox(); assert.ok(pickerRect && pickerRect.x >= 0 && pickerRect.x + pickerRect.width <= width)
        if (width === 390 && mode === 'dark') {
          const touch = await page.context().newCDPSession(page)
          const area = await plane.boundingBox(); assert.ok(area)
          await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: area.x + area.width / 2, y: area.y + area.height / 2 }] })
          await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: area.x + area.width * .75, y: area.y + area.height * .25 }] })
          await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          await touch.detach()
          assert.notEqual(await field.inputValue(), '#4432a8', 'touch dragging changes the color')
          await field.locator('..').getByRole('button', { name: '초기화' }).click()
        }
        if (process.env.MEW_THEME_SCREENSHOTS) {
          await fs.mkdir(process.env.MEW_THEME_SCREENSHOTS, { recursive: true })
          await page.screenshot({ path: path.join(process.env.MEW_THEME_SCREENSHOTS, `${width}-${mode}.png`) })
        }
        await picker.getByRole('button', { name: '닫기', exact: true }).click()
      }
    }
    await page.getByRole('button', { name: '다크', exact: true }).click()
    await page.locator('#sample-button').click()
    assert.equal(await page.getByRole('button', { name: '삭제', exact: true }).evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).color), 'rgb(255, 255, 255)', 'danger labels keep their independent color')
    assert.equal(await page.evaluate("localStorage.getItem('settings-closed')"), null, 'picker dismissal never closes settings')
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
