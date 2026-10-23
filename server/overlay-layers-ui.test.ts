import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
test('image previews escape panel stacking; command dialogs remain legible above the dock', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const source = `import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AgentImagePreviewDialog} from '${root}/src/components/agent-image-preview-dialog.tsx';
import {CommandButtonMenu} from '${root}/src/components/CommandButtonMenu.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {applyThemePalette} from '${root}/src/utils/theme-color.ts';
import {useFloatingPanel} from '${root}/src/hooks/use-floating-panel.ts';
localStorage.setItem('mew:locale','ko');
window.setTheme=light=>applyThemePalette({background:light?'#ffffff':'#101020',text:light?'#202020':'#eeeeee',primary:light?'#5642c7':'#9082da',gradient:{colors:light?['#eeeeff','#ffeeee']:['#102030','#302040'],angle:135,animated:false}});
window.setTheme(false);
function Fixture(){const [image,setImage]=useState(false);const a=useFloatingPanel('a',null),b=useFloatingPanel('b',null);window.focusMany=()=>{for(let i=0;i<1500;i++){a.focus();b.focus()}};return <main className="mew-workspace"><div style={{position:'relative',zIndex:10,transform:'translateZ(0)'}}><button onClick={()=>setImage(true)}>Preview</button><header><CommandButtonMenu project="test"/></header>{image&&<AgentImagePreviewDialog src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='red'/%3E%3C/svg%3E" name="sample" onClose={()=>setImage(false)}/>}</div><nav className="mobile-dock" style={{height:48}}>Dock</nav><div id="floating-a" style={{...a.style,pointerEvents:'none'}}/><div id="floating-b" style={{...b.style,pointerEvents:'none'}}/><div className="mewcat-notifications" style={{width:80,height:30}}>Notice</div></main>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:layers.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) {
    if (id === 'virtual:layers.tsx') return id
    if (id.endsWith('.css')) return 'virtual:style'
    if (id.endsWith('/SessionTerminalPopup')) return 'virtual:terminal'
  }, load(id) {
    if (id === 'virtual:layers.tsx') return source
    if (id === 'virtual:style') return ''
    if (id === 'virtual:terminal') return 'export function SessionTerminalPopup(){return null}'
  } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk'); assert.ok(chunk)
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const files = ['src/components/agent-image-preview-dialog.tsx', 'src/components/CommandButtonMenu.tsx']
  const content = source + (await Promise.all(files.map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const css = compiler.build([...new Set(content.match(/[A-Za-z0-9_@!&:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [390, 1100]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: width === 390 })
      await page.route('http://mew-layers.test/**', route => {
        if (new URL(route.request().url()).pathname.startsWith('/api/')) return route.fulfill({ json: { buttons: [{ name: '서버 시작', command: 'echo start', oneShot: false, running: false, session: 'fixture' }] } })
        return route.fulfill({ contentType: 'text/html', body: `<html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${chunk.code}</script></html>` })
      })
      page.setDefaultTimeout(5000)
      await page.goto('http://mew-layers.test/')
      await page.getByRole('button', { name: 'Preview', exact: true }).waitFor()
      await page.evaluate('window.focusMany()')
      const layers = await page.locator('#floating-a, #floating-b').evaluateAll(elements => elements.map(el => Number(el.ownerDocument.defaultView!.getComputedStyle(el).zIndex)))
      assert.deepEqual(layers, [60, 61], 'repeated focus cannot overtake menus or modals')
      for (const light of [false, true]) {
        await page.evaluate(`window.setTheme(${light})`)
        const commands = page.getByRole('button', { name: /test.*(명령어 버튼|command buttons)/i })
        await commands.click()
        const menu = page.locator('[data-cmd-overlay][data-menu-variant]')
        await menu.waitFor()
        assert.equal(await commands.getAttribute('aria-expanded'), 'true')
        assert.equal(await menu.evaluate(el => el.parentElement === el.ownerDocument.body), true)
        const bounds = await menu.boundingBox(); assert.ok(bounds)
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width)
        await page.screenshot({ path: `/tmp/mew-layers-${width}-${light ? 'light' : 'dark'}-dropdown.png` })
        await page.keyboard.press('Escape')
        await menu.waitFor({ state: 'detached' })
        assert.equal(await commands.getAttribute('aria-expanded'), 'false')
        await commands.click()
        await page.getByRole('button', { name: /명령 추가|Add command/ }).click()
        const dialog = page.getByRole('dialog', { name: /명령 추가|Add command/ })
        await dialog.waitFor()
        await menu.waitFor({ state: 'detached' })
        assert.equal(await commands.getAttribute('aria-expanded'), 'false', 'adding a command closes the dropdown')
        const style = await dialog.evaluate(el => {
          const view = el.ownerDocument.defaultView!, style = view.getComputedStyle(el)
          const canvas = el.ownerDocument.createElement('canvas'); canvas.width = canvas.height = 1
          const context = canvas.getContext('2d')!; context.fillStyle = style.backgroundColor; context.fillRect(0, 0, 1, 1)
          return { alpha: context.getImageData(0, 0, 1, 1).data[3], blur: style.backdropFilter, layer: Number(view.getComputedStyle(el.parentElement!).zIndex), notice: Number(view.getComputedStyle(el.ownerDocument.querySelector('.mewcat-notifications')!).zIndex) }
        })
        assert.equal(style.blur, 'blur(6px)')
        assert.ok(Math.abs(style.alpha - 191) <= 1, JSON.stringify(style))
        assert.ok(style.layer > style.notice)
        await page.screenshot({ path: `/tmp/mew-layers-${width}-${light ? 'light' : 'dark'}-command.png` })
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' })
        await menu.waitFor({ state: 'detached' })
        await commands.click()
        const row = menu.getByRole('button', { name: '서버 시작', exact: true })
        await row.waitFor()
        if (width === 390) await row.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1 })
        else await row.click({ button: 'right' })
        const editor = page.getByRole('dialog', { name: /명령 수정|Edit command/ })
        await editor.waitFor()
        await menu.waitFor({ state: 'detached' })
        assert.equal(await commands.getAttribute('aria-expanded'), 'false', 'editing closes the dropdown after long press or right click')
        assert.equal(await editor.locator('input').first().inputValue(), '서버 시작')
        assert.equal(await editor.locator('textarea').inputValue(), 'echo start')
        assert.equal(await editor.evaluate(el => {
          const rect = el.getBoundingClientRect()
          return el.contains(el.ownerDocument.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
        }), true, 'the command editor receives pointer input without a menu above it')
        await page.screenshot({ path: `/tmp/mew-layers-${width}-${light ? 'light' : 'dark'}-command-edit.png` })
        await editor.getByRole('button', { name: /취소|Cancel/, exact: true }).click()
        await editor.waitFor({ state: 'detached' })
        await menu.waitFor({ state: 'detached' })
        await page.getByRole('button', { name: 'Preview', exact: true }).click()
        const preview = page.getByRole('dialog', { name: /sample.*(사진 미리보기|image preview)/ })
        await preview.waitFor()
        assert.equal(await preview.evaluate(el => el.parentElement!.parentElement === el.ownerDocument.body), true, 'the viewer portals out of the transformed low-layer panel')
        assert.equal(await preview.evaluate(el => {
          const doc = el.ownerDocument, dock = doc.querySelector('.mobile-dock')!, rect = dock.getBoundingClientRect()
          return el.parentElement!.contains(doc.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
        }), true, 'the viewer backdrop covers the dock and receives its pointer input')
        await page.screenshot({ path: `/tmp/mew-layers-${width}-${light ? 'light' : 'dark'}-image.png` })
        await page.keyboard.press('Escape'); await preview.waitFor({ state: 'detached' })
      }
      await page.close()
    }
  } finally { await browser.close() }
})
