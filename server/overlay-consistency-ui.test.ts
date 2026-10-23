import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Locator } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('real editor and calendar popups share hamburger opacity and backdrop blur', { skip: !domBrowserExecutable(), timeout: 90_000 }, async t => {
  const root = path.resolve(import.meta.dirname, '..')
  const source = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {HeaderMenuPopup} from '${root}/src/components/header-menu-popup.tsx';
import {SlashMenu} from '${root}/packages/editor/src/editor/SlashMenu.tsx';
import {MentionTooltip} from '${root}/packages/editor/src/editor/MentionTooltip.tsx';
import {LinkTooltip} from '${root}/packages/editor/src/editor/LinkTooltip.tsx';
import {TableTooltip} from '${root}/packages/editor/src/editor/TableTooltip.tsx';
import {DateField} from '${root}/packages/ui/src/date-field.tsx';
import {setUiLocale} from '@mew/ui/i18n-core';
import {applyThemePalette,THEME_PRESETS} from '${root}/src/utils/theme-color.ts';
setUiLocale('ko');applyThemePalette(THEME_PRESETS.find(item=>item.id===new URL(location.href).searchParams.get('theme')).palette);
const api={fetchFile:async()=>({content:'---\\ntitle: Overlay linked document\\n---\\nExample'}),fetchLinkPreview:async()=>({title:'External preview',description:'Preview description'})};
const modes=['header','slash','mention','link-view','link-edit','table','date'];
function Fixture(){const [mode,setMode]=useState(null),[result,setResult]=useState(''),[date,setDate]=useState('2026-10-15');
const finish=value=>{setResult(value);setMode(null)},close=()=>finish(mode+':closed'),position={top:174,left:16};
return <main className="mew-workspace h-full"><nav style={{position:'relative',zIndex:1,display:'flex',flexWrap:'wrap',gap:6,padding:12}}>
{modes.map(item=><button key={item} data-open={item} onClick={()=>{setResult('');setMode(item)}}>{item}</button>)}</nav>
<output id="result">{result}</output><div aria-hidden="true" style={{padding:16,lineHeight:'32px',color:'var(--color-ink-secondary)'}}>{Array.from({length:20},(_,i)=><p key={i}>Workspace content behind the popup · {i}</p>)}</div>
<div data-overlay-host>
{mode==='header'&&<HeaderMenuPopup x={16} y={174} trigger={null} label="Reference hamburger" onClose={close} items={[{id:'action',label:'Header action',icon:null,onSelect:()=>finish('header-action')}]}/>}
{mode==='slash'&&<SlashMenu position={{top:150,bottom:174,left:16}} getAnchor={()=>({top:150,bottom:174,left:16})} commands={[{id:'first',title:'First command',description:'First description',keywords:[],run(){}},{id:'second',title:'Second command',description:'Second description',keywords:[],run(){}}]} selectedIndex={0} onSelect={item=>finish(item.id)}/>}
{mode==='mention'&&<MentionTooltip position={position} results={[{path:'first.md',label:'First mention'},{path:'second.md',label:'Second mention'}]} selectedIndex={0} onSelect={item=>finish(item.path)}/>}
{(mode==='link-view'||mode==='link-edit')&&<LinkTooltip key={mode} editor={null} api={api} position={position} initialHref={mode==='link-view'?'linked.md':'https://example.test/'} initialText="Original label" range={{from:1,to:5}} docPath="guide.md" initialMode={mode==='link-view'?'view':'edit'} onClose={close} onOpenInternal={file=>finish(file)}/>}
{mode==='table'&&<TableTooltip editor={null} position={{top:240,left:innerWidth/2}} mode="add" onClose={close}/>}
{mode==='date'&&<div style={{position:'fixed',top:150,left:16}}><DateField label="Fixture date" value={date} onChange={value=>{setDate(value);setResult(value)}}/></div>}
</div></main>}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const candidates = [source], styles: string[] = []
  const bundle = await build({ input: 'virtual:overlay-consistency.tsx', write: false, platform: 'browser',
    output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'overlay-consistency-fixture', resolveId(id) { if (id === 'virtual:overlay-consistency.tsx') return id }, async load(id) {
      if (id === 'virtual:overlay-consistency.tsx') return source
      if (id.endsWith('.tsx')) candidates.push(await fs.readFile(id, 'utf8'))
      if (id.endsWith('.css')) { styles.push(await fs.readFile(id, 'utf8')); return { code: '', moduleType: 'js' } }
    } }],
  })
  const chunk = bundle.output.find(item => item.type === 'chunk'); assert.ok(chunk)
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set(candidates.join('\n').match(/[A-Za-z0-9_@!&:/.[\]()%,-]+/g))]) + styles.join('\n')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  const screenshots = '/tmp/mew-overlay-consistency'
  await fs.mkdir(screenshots, { recursive: true })
  const visual = (locator: Locator) => locator.evaluateAll(elements => elements.map(el => {
    const style = el.ownerDocument.defaultView!.getComputedStyle(el)
    const context = el.ownerDocument.createElement('canvas').getContext('2d')!
    context.fillStyle = style.backgroundColor; context.fillRect(0, 0, 1, 1)
    return { alpha: context.getImageData(0, 0, 1, 1).data[3] / 255, backdrop: style.backdropFilter, filter: style.filter, opacity: style.opacity }
  }))
  for (const width of [390, 1100]) for (const theme of ['midnight', 'rose', 'dark', 'light']) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, isMobile: width === 390, hasTouch: width === 390, reducedMotion: 'reduce' })
    try {
      const page = await context.newPage(), errors: string[] = []
      page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-overlay-consistency.test/**', route => route.fulfill(new URL(route.request().url()).pathname === '/app.js'
        ? { contentType: 'text/javascript', body: chunk.code }
        : { contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` }))
      await page.goto(`http://mew-overlay-consistency.test/?theme=${theme}`)
      const translucent = theme !== 'dark'
      const expected = { alpha: translucent ? Math.round(.75 * 255) / 255 : 1, backdrop: translucent ? 'blur(6px)' : 'none', filter: 'none', opacity: '1' }
      const select = async (mode: string) => { await page.locator(`[data-open="${mode}"]`).click() }
      const capture = (name: string) => page.screenshot({ path: path.join(screenshots, `${theme}-${width}-${name}.png`) })
      const check = async (locator: Locator, name: string, count = 1) => {
        await locator.first().waitFor({ state: 'visible' })
        assert.equal(await locator.count(), count, `${theme}/${width}: ${name} surface count`)
        assert.deepEqual(await visual(locator), Array.from({ length: count }, () => expected), `${theme}/${width}: ${name} matches hamburger surface`)
      }
      const checkSolid = async (locator: Locator, name: string) => {
        assert.ok((await visual(locator)).every(style => style.alpha === 1 && style.backdrop === 'none' && style.opacity === '1'), `${theme}/${width}: ${name} stays solid and sharp`)
      }
      await select('header')
      await check(page.locator('[data-header-menu]'), 'reference hamburger')
      await capture('header')
      await page.getByRole('menuitem', { name: 'Header action' }).click()
      assert.equal(await page.locator('#result').textContent(), 'header-action')
      assert.equal(await page.locator('[data-header-menu]').count(), 0)

      for (const mode of ['slash', 'mention', 'link-view', 'link-edit', 'table', 'date']) {
        await select(mode)
        if (mode === 'date') await page.getByRole('button', { name: '달력 열기' }).click()
        const surface = page.locator(mode === 'date' ? '.mew-calendar' : '[data-overlay-host] .mew-overlay-surface')
        await check(surface, mode, mode === 'table' ? 4 : 1)
        if (mode === 'slash' || mode === 'mention') {
          const option = page.getByRole('button', { name: mode === 'slash' ? /Second command/ : /Second mention/ })
          if (width === 1100) { await option.hover(); await checkSolid(option, `${mode} hover`) }
          else await checkSolid(surface.getByRole('button').first(), `${mode} touch selection`)
          await capture(mode); await option.click()
          assert.equal(await page.locator('#result').textContent(), mode === 'slash' ? 'second' : 'second.md')
        } else if (mode === 'link-view') {
          await capture(mode)
          await page.getByRole('button', { name: 'Overlay linked document', exact: true }).click()
          assert.equal(await page.locator('#result').textContent(), 'linked.md')
        } else if (mode === 'link-edit') {
          const fields = surface.locator('input')
          await checkSolid(fields, 'link editor fields')
          await page.getByPlaceholder('표시 텍스트').fill('Edited label')
          assert.equal(await page.getByPlaceholder('표시 텍스트').inputValue(), 'Edited label')
          await capture(mode); await page.getByRole('button', { name: '제거', exact: true }).click()
          assert.equal(await page.locator('#result').textContent(), 'link-edit:closed')
        } else if (mode === 'table') {
          await capture(mode); await page.getByRole('button', { name: '↑ 행 추가', exact: true }).click()
          assert.equal(await page.locator('#result').textContent(), 'table:closed')
        } else {
          await checkSolid(surface.locator('.mew-calendar-shortcuts button'), 'calendar shortcuts')
          await capture(mode); await surface.locator('[data-date="2026-10-16"]').click()
          assert.equal(await page.getByRole('textbox', { name: 'Fixture date' }).inputValue(), '2026-10-16')
          assert.equal(await page.locator('#result').textContent(), '2026-10-16')
        }
        assert.equal(await surface.count(), 0, `${mode} closes after its action`)
      }
      await select('link-edit'); await page.getByPlaceholder('표시 텍스트').waitFor(); await page.keyboard.press('Escape')
      assert.equal(await page.locator('[data-overlay-host] .mew-overlay-surface').count(), 0, 'Escape closes the link editor')
      await select('date'); await page.getByRole('button', { name: '달력 열기' }).click(); await page.locator('.mew-calendar').waitFor(); await page.keyboard.press('Escape')
      assert.equal(await page.locator('.mew-calendar').count(), 0, 'Escape closes the calendar')
      assert.deepEqual(errors, [])
    } finally { await context.close() }
  }
})
