import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
type Palette = { background: string; text: string; primary: string; gradient?: { colors: [string, string]; angle: number; animated: boolean } }

test('theme palettes migrate, preview, persist and customize in desktop/mobile settings', { skip: !domBrowserExecutable(), timeout: 90_000 }, async () => {
  const source = `import React,{useState,useEffect} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {SettingsModal} from '${root}/src/components/SettingsModal.tsx';
import {ConfirmDialog} from '${root}/packages/ui/src/ConfirmDialog.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {loadFontPreferences,saveFontPreferences} from '${root}/src/utils/fontPreferences.ts';
import {applyThemePalette,loadThemeSettings,saveThemeSettings,THEME_PRESETS} from '${root}/src/utils/theme-color.ts';
window.fixturePresets=THEME_PRESETS;
localStorage.setItem('mew:locale','ko');
if(!localStorage.getItem('fixture-seeded')){localStorage.setItem('mew:accent-color',JSON.stringify({accent:'#185e91',accentStrong:'#000000',link:'#ffffff'}));localStorage.setItem('fixture-seeded','1')}
function Fixture(){
 const [settings,setSettings]=useState(loadThemeSettings),[danger,setDanger]=useState(false),[open,setOpen]=useState(true);
 const [fonts,setFonts]=useState(loadFontPreferences);
 useEffect(()=>{applyThemePalette(settings.palette);saveThemeSettings(settings)},[settings]);
 return <><main id="sample-workspace" className="mew-workspace bg-surface-deep" style={{position:'fixed',inset:0,pointerEvents:'none'}}>
 <section id="sample-panel" className="bg-surface-deep" style={{height:'100%'}}><div id="sample-editor" className="cm-editor bg-surface-deep" style={{height:'100%'}}>Theme workspace</div></section>
 <input id="sample-control" className="bg-surface-deep" aria-hidden="true" tabIndex={-1}/><div role="dialog" aria-hidden="true"><div id="sample-dialog-surface" className="bg-surface-deep"/></div><div data-floating-panel="fixture" className="bg-surface-deep" id="sample-floating"><div id="sample-floating-surface" className="bg-surface-deep"/></div>
 <div id="sample-sticky" data-tree-sticky-depth="0" className="sticky bg-surface-deep">Folder</div><div id="sample-path-tooltip" className="absolute bg-surface-deep">folder/file.ts</div><div id="sample-sidebar" data-sidebar className="absolute bg-surface-deep"/>
 <div id="sample-neutral-card" className="bg-surface">Card</div><button id="sample-neutral-button" className="bg-surface-raised" aria-hidden="true" tabIndex={-1}>Neutral</button><textarea id="sample-neutral-input" className="bg-surface" aria-hidden="true" tabIndex={-1}/><div id="sample-neutral-hover" className="bg-surface-hover">Hover</div>
 <div id="sample-dialog-glass" role="dialog" aria-hidden="true" className="bg-surface"><div id="sample-dialog-neutral" className="bg-surface-raised"/></div><div id="sample-floating-glass" data-floating-panel="neutral" aria-hidden="true" className="bg-surface"><div id="sample-floating-neutral" className="bg-surface-raised"/></div>
 <div id="sample-menu-glass" role="menu" aria-hidden="true" className="bg-surface-raised"><div id="sample-menu-neutral" className="bg-surface"/></div><div id="sample-listbox-glass" role="listbox" aria-hidden="true" className="bg-surface"><div id="sample-listbox-neutral" className="bg-surface-hover"/></div><div role="tooltip" id="sample-tooltip-neutral" aria-hidden="true" className="bg-surface"/>
 <div className="sticky bg-surface"><div id="sample-sticky-neutral" className="bg-surface-raised"/></div><div data-agent-loading aria-hidden="true" className="bg-surface"><div id="sample-loading-neutral" className="bg-surface-raised"/></div><div id="sample-popup-neutral" className="absolute bg-surface-raised" aria-hidden="true"/>
 </main>{open&&<SettingsModal email={null} displayName={null} avatarDataUrl={null} canEditIgnore={false} themeSettings={settings} onThemeSettingsChange={setSettings} fontPreferences={fonts} onFontPreferencesChange={next=>{setFonts(next);saveFontPreferences(next)}} mewcatSkin={null} onMewcatSkinChange={()=>{}} onClose={()=>{localStorage.setItem('settings-closed','1');setOpen(false)}} onLoggedOut={()=>{}}/>}
 <div style={{position:'fixed',bottom:0,left:0,zIndex:60,display:'flex',gap:12,padding:8,background:'var(--color-surface)'}}><a id="sample-link" className="text-link" href="#">링크</a><button id="sample-button" className="bg-accent text-ink-on-accent hover:bg-accent-strong" onClick={()=>setDanger(true)}>삭제 확인 열기</button></div>
 {danger&&<ConfirmDialog message="삭제 확인" confirmLabel="삭제" danger onConfirm={()=>setDanger(false)} onCancel={()=>setDanger(false)}/>}</>
}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:theme.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:theme.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:theme.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk'); assert.ok(chunk)
  const content = (await Promise.all(['src/components/SettingsModal.tsx', 'src/components/theme-settings.tsx', 'packages/ui/src/select-field.tsx', 'packages/ui/src/color-picker.tsx', 'packages/ui/src/ConfirmDialog.tsx', 'packages/ui/src/dialog-frame.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@!&:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
    page.setDefaultTimeout(5000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.route('http://localhost:48975/**', async route => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname.startsWith('/fonts/ibm-plex/')) {
        await route.fulfill({ contentType: pathname.endsWith('.css') ? 'text/css' : 'font/woff2', body: await fs.readFile(path.join(root, 'public', pathname.slice(1))) })
        return
      }
      await route.fulfill(pathname === '/app.js'
        ? { contentType: 'text/javascript', body: chunk.code }
        : { contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fonts/ibm-plex/fonts.css"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    })
    await page.goto('http://localhost:48975/')
    const field = page.getByRole('textbox', { name: '주요색 HEX 코드' })
    const background = page.getByRole('textbox', { name: '배경색 HEX 코드' })
    const text = page.getByRole('textbox', { name: '글씨색 HEX 코드' })
    const customize = page.getByRole('button', { name: '테마 커스터마이징', exact: true })
    const editor = page.getByRole('group', { name: '커스텀 테마', exact: true })
    const grid = page.getByRole('group', { name: '테마', exact: true })
    const gradient = editor.getByRole('checkbox', { name: '그라데이션', exact: true })
    const gradientColors = [1, 2].map(index => editor.getByRole('textbox', { name: `그라데이션 색 ${index} HEX 코드`, exact: true }))
    const gradientAngle = editor.getByRole('slider', { name: '그라데이션 방향', exact: true })
    const gradientAnimation = editor.getByRole('checkbox', { name: '배경 애니메이션', exact: true })
    const colorNames = new Map([[background, '배경색'], [text, '글씨색'], [field, '주요색'], ...gradientColors.map((input, index) => [input, `그라데이션 색 ${index + 1}`] as const)])
    const openColor = async (input: typeof field) => {
      const name = colorNames.get(input)
      if (!name) return
      const button = editor.getByRole('button', { name, exact: true })
      if (await button.getAttribute('aria-expanded') !== 'true') await button.click()
    }
    const fillColor = async (input: typeof field, value: string) => { await openColor(input); await input.fill(value) }
    const readColor = async (input: typeof field) => { await openColor(input); return input.inputValue() }

    const tokens = () => page.evaluate<string[]>(`(()=>{const s=getComputedStyle(document.documentElement);return ['surface-deep','surface','surface-raised','ink','ink-secondary','accent','accent-strong','link','ink-on-accent'].map(k=>s.getPropertyValue('--color-'+k).trim())})()`)
    const globalBackground = () => page.locator('body').evaluate(el => {
      const style = el.ownerDocument.defaultView!.getComputedStyle(el, '::before')
      const root = el.ownerDocument.documentElement
      return { gradient: root.classList.contains('theme-gradient'), image: style.backgroundImage, animation: style.animationName, imageToken: root.style.getPropertyValue('--theme-background-image'), animationToken: root.style.getPropertyValue('--theme-background-animation') }
    })
    const sampleBackground = (sample: ReturnType<typeof editor.locator>) => sample.evaluate(el => {
      const style = el.ownerDocument.defaultView!.getComputedStyle(el, '::before')
      return { image: style.backgroundImage, animation: style.animationName }
    })
    const workspaceBackgrounds = () => page.locator('#sample-workspace, #sample-panel, #sample-editor, #sample-control, #sample-dialog-surface, #sample-floating, #sample-floating-surface, #sample-sticky, #sample-path-tooltip').evaluateAll(elements => elements.map(el => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor))
    const backgroundAlpha = (selector: string) => page.locator(selector).evaluateAll(elements => elements.map(el => {
      const canvas = el.ownerDocument.createElement('canvas')
      canvas.width = canvas.height = 1
      const context = canvas.getContext('2d')!
      context.fillStyle = el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor
      context.fillRect(0, 0, 1, 1)
      return context.getImageData(0, 0, 1, 1).data[3] / 255
    }))
    const neutralComponents = '#sample-neutral-card, #sample-neutral-button, #sample-neutral-input, #sample-neutral-hover'
    const protectedComponents = '#sample-dialog-neutral, #sample-floating-neutral, #sample-menu-neutral, #sample-listbox-neutral, #sample-sticky-neutral, #sample-loading-neutral'
    const glassComponents = '#sample-dialog-surface, #sample-floating, #sample-path-tooltip, #sample-dialog-glass, #sample-floating-glass, #sample-menu-glass, #sample-listbox-glass, #sample-tooltip-neutral, #sample-popup-neutral'
    const stored = () => page.evaluate<{ palette: Palette; custom: Palette[] }>(`JSON.parse(localStorage.getItem('mew:themes'))`)
    const presets = await page.evaluate<{ id: string; palette: Palette }[]>('window.fixturePresets')
    const capture = async (name: string) => {
      if (!process.env.MEW_THEME_SCREENSHOTS) return
      await fs.mkdir(process.env.MEW_THEME_SCREENSHOTS, { recursive: true })
      await page.screenshot({ path: path.join(process.env.MEW_THEME_SCREENSHOTS, `${name}.png`) })
    }
    await page.getByRole('button', { name: '커스텀 1', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '커스텀 1', exact: true }).getAttribute('aria-pressed'), 'true')
    assert.equal((await stored()).palette.primary, '#3094dd', 'migration preserves the previous visible accent')
    assert.equal(await grid.getByRole('button').count(), 9, 'seven presets, the migrated theme and the final add button')
    assert.equal(await page.locator('select, datalist, input[list]').count(), 0)
    const language = page.getByRole('combobox', { name: '언어', exact: true })
    await language.press('Enter'); await language.press('ArrowDown')
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
    await customize.click()
    assert.equal(await editor.getByRole('textbox').count(), 0, 'HEX inputs stay inside closed color pickers')
    assert.equal(await readColor(background), '#0a0a0a')
    assert.equal(await readColor(text), '#e5e5e5')
    const original = await tokens()
    await fillColor(field, '#')
    assert.deepEqual(await tokens(), original, 'incomplete draft colors never replace the active palette')
    await fillColor(background, '#1B252D'); await fillColor(text, '#F4ECE2'); await fillColor(field, '#DDAA22')
    assert.deepEqual(await tokens(), original, 'draft changes stay in the preview until the theme is added')
    const preview = editor.locator('.theme-background-sample').first()
    assert.equal(await preview.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor), 'rgb(27, 37, 45)')
    assert.equal(await preview.locator('span').nth(1).evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).color), 'rgb(244, 236, 226)')
    assert.equal(await preview.locator('span').nth(2).evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).color), 'rgb(221, 170, 34)')
    await fillColor(text, '#1b252d')
    assert.equal(await editor.getByRole('status').count(), 1, 'low text contrast is visible before saving')
    await fillColor(text, '#f4ece2')
    assert.equal(await editor.getByRole('status').count(), 0)
    await fillColor(field, '#oops'); await field.blur()
    assert.equal(await readColor(field), '#ddaa22')
    await editor.getByRole('button', { name: '테마 추가', exact: true }).click()
    assert.equal(await editor.count(), 0)
    const customPalette = { background: '#1b252d', text: '#f4ece2', primary: '#ddaa22' }
    await page.waitForFunction(`JSON.parse(localStorage.getItem('mew:themes')).palette.primary==='#ddaa22'`)
    assert.deepEqual((await stored()).palette, customPalette)
    assert.equal((await stored()).custom.length, 2)
    assert.equal(await page.getByRole('button', { name: '커스텀 2', exact: true }).getAttribute('aria-pressed'), 'true')
    assert.equal((await tokens())[0], customPalette.background)
    assert.equal((await tokens())[3], customPalette.text)
    assert.equal((await tokens())[5], customPalette.primary)
    await page.reload(); await customize.waitFor()
    assert.equal(await page.getByRole('button', { name: '커스텀 2', exact: true }).getAttribute('aria-pressed'), 'true')
    assert.deepEqual((await stored()).palette, customPalette)
    await customize.focus(); await customize.press('Enter')
    assert.equal(await readColor(field), '#ddaa22')
    const trigger = page.getByRole('button', { name: '주요색', exact: true })
    const picker = page.getByRole('group', { name: '주요색', exact: true })
    await openColor(field)
    const hue = page.getByRole('slider', { name: '색조', exact: true })
    const saturation = page.getByRole('slider', { name: '채도', exact: true })
    const brightness = page.getByRole('slider', { name: '밝기', exact: true })
    await hue.fill('210'); await saturation.fill('67'); await brightness.fill('60')
    assert.equal(await readColor(field), '#326699')
    await hue.focus(); await hue.press('ArrowRight')
    assert.equal(await hue.inputValue(), '211')
    await brightness.fill('0'); await hue.fill('120'); await saturation.fill('100'); await brightness.fill('100')
    assert.equal(await readColor(field), '#00ff00', 'black retains hue and saturation edits')
    await saturation.fill('0'); await hue.fill('240'); await saturation.fill('100')
    assert.equal(await readColor(field), '#0000ff', 'gray retains hue edits')
    const plane = picker.locator('.touch-none[aria-hidden=true]')
    const planeRect = await plane.boundingBox(); assert.ok(planeRect)
    await page.mouse.move(planeRect.x + planeRect.width / 2, planeRect.y + planeRect.height / 2)
    await page.mouse.down(); await page.mouse.move(planeRect.x + planeRect.width + 10, planeRect.y - 10); await page.mouse.up()
    assert.equal(await readColor(field), '#0000ff', 'dragging outside the plane clamps at its edge')
    await hue.press('Escape')
    assert.equal(await picker.count(), 0)
    assert.equal(await trigger.evaluate(el => el.ownerDocument.activeElement === el), true)
    await fillColor(field, '#oops'); await field.press('Escape')
    assert.equal(await picker.count(), 0)
    assert.equal(await readColor(field), '#0000ff')
    assert.equal(await editor.count(), 1, 'escaping a color input keeps the custom editor')
    await field.locator('..').getByRole('button', { name: '초기화' }).click()
    assert.equal(await readColor(field), '#ddaa22')
    await editor.getByRole('button', { name: '테마 추가', exact: true }).click()
    assert.equal((await stored()).custom.length, 2, 'adding the same palette selects it without duplicates')
    await page.getByRole('button', { name: '커스텀 2', exact: true }).click()
    assert.equal(await editor.count(), 1, 'selecting a custom tile opens its editor immediately')
    assert.equal(await page.getByRole('button', { name: '커스텀 테마 편집', exact: true }).count(), 0)
    const beforeCancel = await stored()
    await fillColor(field, '#123456')
    await editor.getByRole('button', { name: '취소', exact: true }).click()
    assert.equal(await editor.count(), 0)
    assert.deepEqual(await stored(), beforeCancel, 'cancel discards edits and keeps the selected saved theme')
    assert.equal(await page.getByRole('button', { name: '커스텀 2', exact: true }).evaluate(el => el.ownerDocument.activeElement === el), true)
    await page.getByRole('button', { name: '커스텀 2', exact: true }).click()
    assert.equal(await readColor(field), '#ddaa22')
    await fillColor(field, '#75b7ef')
    await editor.getByRole('button', { name: '테마 저장', exact: true }).click()
    assert.equal((await stored()).custom.length, 2, 'editing replaces one saved custom theme')
    assert.equal((await stored()).palette.primary, '#75b7ef')
    await customize.click(); await fillColor(field, '#75b7ef'); await field.press('Escape')
    assert.equal(await picker.count(), 0)
    await page.keyboard.press('Escape')
    assert.equal(await editor.count(), 0, 'Escape from a focused HEX field closes the picker, then the editor')
    await customize.click(); await trigger.click(); await page.evaluate('history.back()')
    await picker.waitFor({ state: 'hidden' })
    assert.equal(await editor.count(), 1, 'Back closes just the open picker')
    await page.evaluate('history.back()'); await editor.waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate("localStorage.getItem('settings-closed')"), null)
    await customize.click(); await page.keyboard.press('Escape')
    assert.equal(await editor.count(), 0)
    await page.getByRole('button', { name: '커스텀 2', exact: true }).click()
    await editor.getByRole('button', { name: '커스텀 테마 삭제', exact: true }).click()
    assert.equal((await stored()).custom.length, 1)
    assert.deepEqual((await stored()).palette, presets.find(preset => preset.id === 'midnight')!.palette)
    await page.getByRole('button', { name: '다크', exact: true }).click()
    const solidBackground = await globalBackground()
    const solidWorkspace = await workspaceBackgrounds()
    assert.deepEqual(await backgroundAlpha(neutralComponents), Array(4).fill(1), 'solid themes keep neutral cards, buttons, inputs and hover surfaces opaque')
    assert.equal(solidBackground.gradient, false)
    assert.equal(solidBackground.image, 'none')
    assert.equal(solidBackground.animation, 'none')
    await customize.click()
    assert.equal(await gradient.isChecked(), false)
    assert.equal(await gradientColors[0].count(), 0, 'solid themes keep gradient fields collapsed')
    await fillColor(background, customPalette.background); await fillColor(text, customPalette.text); await fillColor(field, customPalette.primary)
    await gradient.check()
    for (const [index, color] of ['#102030', '#274D60'].entries()) await fillColor(gradientColors[index], color)
    await gradientAngle.fill('135'); await gradientAnimation.check()
    assert.deepEqual(await globalBackground(), solidBackground, 'gradient drafts leave the active background layer and variables unchanged')
    assert.deepEqual((await stored()).palette, presets[0].palette, 'gradient drafts are not persisted')
    const gradientPreview = await sampleBackground(preview)
    assert.match(gradientPreview.image, /gradient\(/)
    assert.match(gradientPreview.image, /rgb\(16, 32, 48\)/)
    assert.match(gradientPreview.image, /rgb\(39, 77, 96\)/)
    assert.notEqual(gradientPreview.animation, 'none')
    await fillColor(gradientColors[1], customPalette.text)
    assert.equal(await editor.getByRole('status').count(), 1, 'contrast guidance includes the gradient colors')
    await fillColor(gradientColors[1], '#274d60')
    assert.equal(await editor.getByRole('status').count(), 0)
    await editor.getByRole('button', { name: '테마 추가', exact: true }).click()
    const gradientPalette: Palette = { ...customPalette, gradient: { colors: ['#102030', '#274d60'], angle: 135, animated: true } }
    assert.deepEqual((await stored()).palette, gradientPalette)
    assert.equal((await stored()).custom.length, 2)
    assert.equal(await page.getByRole('button', { name: '커스텀 2', exact: true }).getAttribute('aria-pressed'), 'true')
    const appliedGradient = await globalBackground()
    assert.equal(appliedGradient.gradient, true)
    assert.equal(appliedGradient.image, gradientPreview.image)
    assert.notEqual(appliedGradient.animation, 'none')
    assert.notEqual(appliedGradient.imageToken, '')
    assert.notEqual(appliedGradient.animationToken, '')
    const gradientWorkspace = await workspaceBackgrounds()
    assert.deepEqual(gradientWorkspace.slice(0, 3), ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'], 'workspace shells and editor reveal one continuous background')
    assert.deepEqual(await backgroundAlpha('#sample-control, #sample-sticky'), [1, 1], 'controls and sticky tree rows remain opaque')
    assert.equal(gradientWorkspace[6], 'rgba(0, 0, 0, 0)', 'floating panel bodies reveal the translucent outer surface')
    assert.ok((await backgroundAlpha(neutralComponents)).every(alpha => alpha > .2 && alpha < .95), 'gradient themes tint neutral cards, buttons, inputs and hover surfaces translucently')
    assert.deepEqual(await backgroundAlpha(protectedComponents), Array(6).fill(1), 'nested controls, sticky content and loading boundaries retain solid neutral tokens')
    assert.ok((await backgroundAlpha(glassComponents)).every(alpha => Math.abs(alpha - .75) < .005), 'overlapping surfaces use a 75% background')
    assert.ok((await page.locator(glassComponents).evaluateAll(elements => elements.map(el => el.ownerDocument.defaultView!.getComputedStyle(el).backdropFilter))).every(filter => filter === 'blur(6px)'))
    const settingsSurface = page.getByRole('dialog', { name: '설정', exact: true }).locator(':scope > .bg-surface-deep')
    assert.ok(Math.abs((await backgroundAlpha('[role=dialog][aria-label=설정] > .bg-surface-deep'))[0] - .75) < .005, 'the actual settings panel has a translucent background')
    assert.equal(await settingsSurface.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backdropFilter), 'blur(6px)')
    assert.deepEqual(await page.getByRole('dialog', { name: '설정', exact: true }).evaluate(el => {
      const canvas = el.ownerDocument.createElement('canvas')
      canvas.width = canvas.height = 1
      const context = canvas.getContext('2d')!
      context.fillStyle = el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor
      context.fillRect(0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data]
    }), [0, 0, 0, 128], 'the dialog scrim is preserved')
    const checkOverlayAppearance = async (label: string) => {
      const { dark, gradient } = await page.locator('html').evaluate(el => ({ dark: el.classList.contains('dark'), gradient: el.classList.contains('theme-gradient') }))
      const translucent = !dark || gradient
      assert.ok((await backgroundAlpha(glassComponents)).every(alpha => Math.abs(alpha - (translucent ? .75 : 1)) < .005), `${label}: overlays keep the theme's background opacity`)
      assert.ok((await page.locator(glassComponents).evaluateAll(elements => elements.map(el => el.ownerDocument.defaultView!.getComputedStyle(el).backdropFilter))).every(filter => filter === (translucent ? 'blur(6px)' : 'none')), `${label}: overlays blur only the translucent background`)
      assert.ok(Math.abs((await backgroundAlpha('[role=dialog][aria-label=설정] > .bg-surface-deep'))[0] - (translucent ? .75 : 1)) < .005, `${label}: the actual settings surface follows the shared opacity`)
      const scrim = await page.getByRole('dialog', { name: '설정', exact: true }).evaluate(el => {
        const view = el.ownerDocument.defaultView!
        const surface = el.querySelector(':scope > .bg-surface-deep')!
        const canvas = el.ownerDocument.createElement('canvas')
        canvas.width = canvas.height = 1
        const context = canvas.getContext('2d')!
        context.fillStyle = view.getComputedStyle(el).backgroundColor
        context.fillRect(0, 0, 1, 1)
        return { background: [...context.getImageData(0, 0, 1, 1).data], shadow: view.getComputedStyle(surface).boxShadow, spread: Math.max(view.innerWidth, view.innerHeight) }
      })
      assert.deepEqual(scrim.background, [0, 0, 0, dark ? 128 : 0], `${label}: only light themes clear the scrim beneath the panel`)
      if (!dark) assert.ok(scrim.shadow.includes(`rgba(0, 0, 0, 0.5) 0px 0px 0px ${scrim.spread}px`), `${label}: the light modal keeps its scrim outside the rounded panel`)
    }
    await language.click()
    const glassList = page.getByRole('listbox', { name: '언어', exact: true })
    assert.ok((await backgroundAlpha('[role=listbox]:not([aria-hidden=true])')).every(alpha => Math.abs(alpha - .75) < .005), 'the actual language dropdown has a 75% background')
    assert.equal(await glassList.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backdropFilter), 'blur(6px)')
    await language.press('Escape')
    assert.equal(await glassList.count(), 0, 'the blurred dropdown retains keyboard dismissal')
    assert.deepEqual(await backgroundAlpha('#sample-button'), [1], 'the primary action retains its solid semantic color')
    assert.equal(await page.locator('#sample-sidebar').evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'the mobile sidebar reveals the shared gradient despite its absolute position')
    await page.reload(); await customize.waitFor()
    assert.deepEqual((await stored()).palette, gradientPalette, 'gradient colors, angle and animation survive reload')
    assert.deepEqual(await globalBackground(), appliedGradient)
    await customize.click()
    assert.equal(await gradient.isChecked(), true)
    assert.equal(await readColor(gradientColors[0]), '#102030')
    assert.equal(await readColor(gradientColors[1]), '#274d60')
    assert.equal(await gradientAngle.inputValue(), '135')
    assert.equal(await gradientAnimation.isChecked(), true)
    await editor.getByRole('button', { name: '테마 추가', exact: true }).click()
    assert.equal((await stored()).custom.length, 2, 'identical gradients select the saved theme without duplicates')
    await customize.click(); await gradient.uncheck()
    assert.equal(await gradientColors[0].count(), 0)
    assert.equal((await sampleBackground(preview)).image, 'none', 'switching a draft to solid clears its gradient preview')
    assert.deepEqual(await globalBackground(), appliedGradient)
    await editor.getByRole('button', { name: '테마 추가', exact: true }).click()
    assert.equal((await stored()).custom.length, 3, 'solid colors and the same colors with a gradient remain distinct themes')
    assert.deepEqual((await stored()).palette, customPalette)
    assert.deepEqual(await globalBackground(), { ...solidBackground, imageToken: 'none', animationToken: 'none' })
    await page.getByRole('button', { name: '커스텀 3', exact: true }).click()
    await editor.getByRole('button', { name: '커스텀 테마 삭제', exact: true }).click()
    await page.getByRole('button', { name: '커스텀 2', exact: true }).click()
    await gradientAngle.fill('225'); await gradientAnimation.uncheck()
    assert.deepEqual(await globalBackground(), appliedGradient, 'editing saved gradient motion stays in the draft until saved')
    await editor.getByRole('button', { name: '테마 저장', exact: true }).click()
    assert.equal((await stored()).custom.length, 2)
    assert.deepEqual((await stored()).palette.gradient, { ...gradientPalette.gradient, angle: 225, animated: false })
    assert.notEqual((await globalBackground()).image, appliedGradient.image, 'saved direction changes the gradient geometry')
    assert.equal((await globalBackground()).animation, 'none')
    await customize.click(); await gradientAngle.fill('315')
    await editor.getByRole('button', { name: '테마 추가', exact: true }).click()
    assert.equal((await stored()).custom.length, 3, 'different gradient directions remain separate saved themes')
    assert.equal(await grid.getByRole('button', { pressed: true }).count(), 1)
    await page.getByRole('button', { name: '커스텀 3', exact: true }).click()
    await editor.getByRole('button', { name: '커스텀 테마 삭제', exact: true }).click()
    await page.getByRole('button', { name: '커스텀 2', exact: true }).click()
    await editor.getByRole('button', { name: '커스텀 테마 삭제', exact: true }).click()
    assert.equal((await stored()).custom.length, 1)
    assert.deepEqual((await stored()).palette, presets.find(preset => preset.id === 'midnight')!.palette)
    await page.getByRole('button', { name: '다크', exact: true }).click()
    assert.deepEqual(await workspaceBackgrounds(), solidWorkspace, 'removing the gradient restores solid workspace surfaces')
    assert.deepEqual(await backgroundAlpha(neutralComponents), Array(4).fill(1), 'removing the gradient restores opaque neutral component surfaces')
    assert.deepEqual(await backgroundAlpha(glassComponents), Array(9).fill(1), 'solid themes restore opaque overlays')
    assert.ok((await page.locator(glassComponents).evaluateAll(elements => elements.map(el => el.ownerDocument.defaultView!.getComputedStyle(el).backdropFilter))).every(filter => filter === 'none'), 'solid themes restore unfiltered overlays')
    assert.equal((await globalBackground()).gradient, false)
    assert.equal((await globalBackground()).image, 'none')
    assert.equal((await globalBackground()).animation, 'none')
    for (const preset of presets) {
      const labels = ['다크', '라이트', '미드나이트', '포레스트', '페이퍼', '로즈', '오션']
      const tile = page.getByRole('button', { name: labels[presets.indexOf(preset)], exact: true })
      await tile.focus(); await tile.press('Enter')
      assert.equal(await tile.getAttribute('aria-pressed'), 'true')
      assert.deepEqual((await stored()).palette, preset.palette)
      const current = await tokens()
      assert.equal(current[0], preset.palette.background)
      assert.equal(current[3], preset.palette.text)
      assert.equal(current[5], preset.palette.primary)
      const layer = await globalBackground()
      const tileLayer = await sampleBackground(tile)
      await checkOverlayAppearance(preset.id)
      if (['midnight', 'rose', 'ocean'].includes(preset.id)) {
        assert.ok(preset.palette.gradient, `${preset.id} has a gradient preset`)
        assert.equal(layer.gradient, true)
        assert.match(layer.image, /gradient\(/)
        assert.match(tileLayer.image, /gradient\(/)
        assert.notEqual(layer.animation, 'none')
        assert.notEqual(tileLayer.animation, 'none')
      } else {
        assert.equal(layer.gradient, false)
        assert.equal(layer.image, 'none')
        assert.equal(layer.animation, 'none')
        assert.equal(tileLayer.image, 'none')
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await customize.click()
    assert.equal((await globalBackground()).animation, 'none', 'reduced motion stops the full background animation')
    assert.equal((await sampleBackground(preview)).animation, 'none', 'reduced motion stops the draft preview animation')
    assert.equal((await sampleBackground(page.getByRole('button', { name: '오션', exact: true }))).animation, 'none', 'reduced motion stops preset tile animations')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    assert.notEqual((await globalBackground()).animation, 'none')
    assert.notEqual((await sampleBackground(preview)).animation, 'none')
    await editor.getByRole('button', { name: '취소', exact: true }).click()
    for (const width of [1100, 390, 320]) {
      await page.setViewportSize({ width, height: 850 })
      if (width === 390) await page.getByRole('button', { name: '화면', exact: true }).click()
      for (const [id, label] of [['midnight', '미드나이트'], ['rose', '로즈'], ['ocean', '오션']]) {
        await page.getByRole('button', { name: label, exact: true }).click()
        assert.equal((await globalBackground()).gradient, true)
        await checkOverlayAppearance(`${width}/${id}`)
        assert.equal(await page.evaluate('document.documentElement.scrollWidth>innerWidth'), false)
        await capture(`${width}-${id}-gradient`)
      }
      for (const mode of ['dark', 'light']) {
        const tile = page.getByRole('button', { name: mode === 'dark' ? '다크' : '라이트', exact: true })
        await tile.click()
        assert.equal(await page.locator('html').evaluate(el => el.classList.contains('dark')), mode === 'dark')
        await checkOverlayAppearance(`${width}/${mode}`)
        const buttons = await grid.getByRole('button').all()
        for (const button of buttons) {
          const bounds = await button.boundingBox()
          assert.ok(bounds && bounds.width >= 44 && bounds.height >= 44 && bounds.x >= 0 && bounds.x + bounds.width <= width)
        }
        assert.equal(await grid.getByRole('button').last().getAttribute('aria-label'), '테마 커스터마이징')
        await capture(`${width}-${mode}-grid`)
        for (const dropdown of [language, font]) {
          await dropdown.click()
          const list = page.getByRole('listbox')
          const bounds = await list.boundingBox()
          assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 850)
          assert.ok((await backgroundAlpha('[role=listbox]:not([aria-hidden=true])')).every(alpha => Math.abs(alpha - (mode === 'light' ? .75 : 1)) < .005), `${width}/${mode}: the actual dropdown follows the shared opacity`)
          assert.equal(await list.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backdropFilter), mode === 'light' ? 'blur(6px)' : 'none', `${width}/${mode}: the actual dropdown follows the shared blur`)
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
        await customize.click()
        for (const input of [background, text, field]) {
          await openColor(input)
          const bounds = await input.boundingBox()
          assert.ok(bounds && bounds.width > 80 && bounds.x >= 0 && bounds.x + bounds.width <= width)
        }
        await page.keyboard.press('Escape')
        await capture(`${width}-${mode}-custom`)
        await gradient.check()
        const backgroundButton = editor.getByRole('button', { name: '배경색', exact: true })
        const gradientButtons = [1, 2].map(number => editor.getByRole('button', { name: `그라데이션 색 ${number}`, exact: true }))
        const backgroundBounds = await backgroundButton.boundingBox(); assert.ok(backgroundBounds)
        const textBounds = await editor.getByRole('button', { name: '글씨색', exact: true }).boundingBox(); assert.ok(textBounds)
        for (const button of gradientButtons) {
          const bounds = await button.boundingBox(); assert.ok(bounds)
          assert.ok(bounds.y < textBounds.y, 'gradient colors stay in the background section above text colors')
          if (width >= 390) assert.ok(Math.abs(bounds.y - backgroundBounds.y) < 2, 'gradient colors sit beside the background color')
        }
        assert.equal(await editor.getByRole('textbox').count(), 0)
        for (const input of [...gradientColors, gradientAngle]) {
          await openColor(input)
          const bounds = await input.boundingBox()
          assert.ok(bounds && bounds.width > 80 && bounds.x >= 0 && bounds.x + bounds.width <= width)
        }
        assert.match((await sampleBackground(preview)).image, /gradient\(/)
        assert.equal(await page.evaluate('document.documentElement.scrollWidth>innerWidth'), false)
        await page.keyboard.press('Escape')
        await capture(`${width}-${mode}-gradient-custom`)
        await openColor(field)
        const pickerRect = await picker.boundingBox(); assert.ok(pickerRect && pickerRect.x >= 0 && pickerRect.x + pickerRect.width <= width)
        await picker.scrollIntoViewIfNeeded()
        await capture(`${width}-${mode}-color-picker`)
        if (width === 390 && mode === 'dark') {
          const touch = await page.context().newCDPSession(page)
          const area = await plane.boundingBox(); assert.ok(area)
          const before = await readColor(field)
          await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: area.x + area.width / 2, y: area.y + area.height / 2 }] })
          await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: area.x + area.width * .75, y: area.y + area.height * .25 }] })
          await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          await touch.detach()
          assert.notEqual(await readColor(field), before, 'touch dragging updates the preview color')
        }
        assert.equal(await page.evaluate('document.documentElement.scrollWidth>innerWidth'), false)
        await picker.getByRole('button', { name: '닫기', exact: true }).click()
        await editor.getByRole('button', { name: '취소', exact: true }).click()
      }
      await page.getByRole('button', { name: '커스텀 1', exact: true }).click()
      assert.equal(await editor.count(), 1)
      const remove = editor.getByRole('button', { name: '커스텀 테마 삭제', exact: true })
      await remove.scrollIntoViewIfNeeded()
      const removeBounds = await remove.boundingBox(); assert.ok(removeBounds)
      assert.ok(removeBounds.x >= 0 && removeBounds.x + removeBounds.width <= width && removeBounds.height >= 44)
      await capture(`${width}-edit-custom`)
      await editor.getByRole('button', { name: '취소', exact: true }).click()
    }
    await customize.click()
    for (const [option, labels, addLabel] of [
      ['English', ['Background color HEX code', 'Text color HEX code', 'Primary color HEX code'], 'Add theme'],
      ['日本語', ['背景色の HEX コード', '文字色の HEX コード', '主要色の HEX コード'], 'テーマを追加'],
      ['简体中文', ['背景色 HEX 代码', '文字色 HEX 代码', '主要色 HEX 代码'], '添加主题'],
      ['한국어', ['배경색 HEX 코드', '글씨색 HEX 코드', '주요색 HEX 코드'], '테마 추가'],
    ] as const) {
      await page.getByRole('combobox').first().click()
      await page.getByRole('option', { name: option, exact: true }).click()
      for (const label of labels) {
        const colorLabel = label.replace(/(?: HEX (?:code|代码|코드)|の HEX コード)$/, '')
        await page.getByRole('button', { name: colorLabel, exact: true }).click()
        assert.equal(await page.getByRole('textbox', { name: label, exact: true }).count(), 1)
        await page.keyboard.press('Escape')
      }
      assert.equal(await page.getByRole('button', { name: addLabel, exact: true }).count(), 1)
    }
    await editor.getByRole('button', { name: '취소', exact: true }).click()
    await page.setViewportSize({ width: 1100, height: 850 })
    await page.getByRole('button', { name: '다크', exact: true }).click()
    assert.equal(await page.evaluate("localStorage.getItem('settings-closed')"), null, 'custom editor and picker dismissal never close settings')
    await page.keyboard.press('Escape')
    await page.getByRole('dialog', { name: '설정', exact: true }).waitFor({ state: 'hidden' })
    const before = await page.locator('#sample-button').evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor)
    await page.locator('#sample-button').hover()
    const hover = await page.locator('#sample-button').evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor)
    assert.notEqual(hover, before)
    await page.locator('#sample-button').click()
    assert.equal(await page.getByRole('button', { name: '삭제', exact: true }).evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).color), 'rgb(255, 255, 255)', 'danger button labels remain independent')
    assert.equal(await page.evaluate("localStorage.getItem('settings-closed')"), '1')
    await page.setViewportSize({ width: 390, height: 850 })
    const device = await page.context().newCDPSession(page)
    await device.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await page.reload()
    await page.getByRole('button', { name: '화면', exact: true }).click()
    await customize.click(); await openColor(field)
    assert.equal(await page.evaluate("matchMedia('(pointer:coarse)').matches"), true)
    const hexBounds = await field.boundingBox(); assert.ok(hexBounds && hexBounds.height >= 40, 'touch HEX input remains easy to target')
    await device.detach()
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
