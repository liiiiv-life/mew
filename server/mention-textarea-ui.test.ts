import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('mention candidates stay visible above clipped panels and scroll independently on desktop/mobile', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const source = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {MentionTextarea} from '${root}/src/components/MentionTextarea.tsx';
const options=Array.from({length:30},(_,i)=>({id:'document-'+i,label:'문서 '+String(i+1).padStart(2,'0'),hint:'Documents/reference-'+String(i+1).padStart(2,'0')+'.md',insert:'[[docs:reference-'+String(i+1).padStart(2,'0')+'.md]]'}));
function Fixture(){const [value,setValue]=useState('');return <>
<header data-fixture-header style={{position:'fixed',inset:'0 0 auto',height:128,zIndex:1000,background:'var(--color-surface-raised)',borderBottom:'1px solid var(--color-edge)'}}>상단 도구</header>
<div data-parent-scroll style={{position:'fixed',top:80,left:16,right:16,height:'calc(100vh - 96px)',overflowY:'auto'}}>
<div style={{height:1200,paddingTop:200}}>
<section data-clipped-panel style={{height:200,display:'flex',flexDirection:'column',justifyContent:'flex-end',overflow:'hidden',position:'relative',background:'var(--color-surface-deep)',border:'1px solid var(--color-edge)'}}>
<div data-input-shell style={{height:72,display:'flex',flexShrink:0}}><MentionTextarea value={value} onChange={setValue} options={options} maxResults={Infinity} submitHint="멘션 테스트 입력" style={{height:'100%'}} className="block h-full w-full resize-none rounded bg-surface px-2 py-1.5 text-sm text-ink outline-none"/></div>
</section></div></div></>}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const candidates = [source]
  const bundle = await build({ input: 'virtual:mention.tsx', write: false, platform: 'browser',
    output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'mention-fixture', resolveId(id) { if (id === 'virtual:mention.tsx') return id }, async load(id) {
      if (id === 'virtual:mention.tsx') return source
      if (id.endsWith('.tsx')) candidates.push(await fs.readFile(id, 'utf8'))
      if (id.endsWith('.css')) return { code: '', moduleType: 'js' }
    } }],
  })
  const chunk = bundle.output.find(item => item.type === 'chunk'); assert.ok(chunk)
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set(candidates.join('\n').match(/[A-Za-z0-9_@!&:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) for (const dark of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce' })
      page.setDefaultTimeout(5000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      try {
        await page.route('http://mew-mention.test/**', route => route.fulfill(new URL(route.request().url()).pathname === '/app.js'
          ? { contentType: 'text/javascript', body: chunk.code }
          : { contentType: 'text/html', body: `<!doctype html><html class="${dark ? 'dark' : ''}" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/app.js"></script></html>` }))
        await page.goto('http://mew-mention.test/')
        const input = page.getByRole('textbox', { name: '멘션 테스트 입력' })
        const outer = page.locator('[data-parent-scroll]')
        await input.waitFor()
        await outer.evaluate(el => { el.scrollTop = 120 })
        const initialParentScroll = await outer.evaluate(el => el.scrollTop)
        await input.fill('@')
        const first = page.getByRole('button', { name: '문서 01 Documents/reference-01.md', exact: true })
        const last = page.getByRole('button', { name: '문서 30 Documents/reference-30.md', exact: true })
        await first.waitFor()
        const menu = first.locator('..')
        const assertMenuBounds = async () => {
          const geometry = await menu.evaluate(el => {
            const view = el.ownerDocument.defaultView!, rect = el.getBoundingClientRect(), viewport = view.visualViewport
            return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, height: rect.height,
              viewportTop: viewport?.offsetTop ?? 0, viewportLeft: viewport?.offsetLeft ?? 0,
              viewportRight: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? view.innerWidth),
              viewportBottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? view.innerHeight),
              overflow: view.getComputedStyle(el).overflowY, overscroll: view.getComputedStyle(el).overscrollBehaviorY,
              gutter: view.getComputedStyle(el).scrollbarGutter, scrollbar: view.getComputedStyle(el, '::-webkit-scrollbar').width,
              client: el.clientHeight, total: el.scrollHeight }
          })
          assert.ok(geometry.height > 0 && geometry.height <= 224, 'menu respects its height cap')
          assert.ok(geometry.top >= geometry.viewportTop && geometry.left >= geometry.viewportLeft && geometry.right <= geometry.viewportRight && geometry.bottom <= geometry.viewportBottom, `menu fits the visible viewport: ${JSON.stringify(geometry)}`)
          assert.equal(geometry.overflow, 'auto')
          assert.equal(geometry.overscroll, 'contain')
          assert.equal(geometry.gutter, 'stable')
          assert.equal(geometry.scrollbar, '6px')
          assert.ok(geometry.total > geometry.client, 'all candidates stay available in the scrolling list')
          return geometry
        }
        const initial = await assertMenuBounds()
        const panel = (await page.locator('[data-clipped-panel]').boundingBox())!
        const header = (await page.locator('[data-fixture-header]').boundingBox())!
        assert.ok(initial.top < panel.y && initial.top < header.y + header.height, 'fixture covers both clipped and header-overlap cases')
        assert.equal(await menu.evaluate(el => el.parentElement === el.ownerDocument.body), true, 'menu escapes the clipping ancestors')
        assert.equal(await first.evaluate(el => {
          const bounds = el.getBoundingClientRect()
          return el.contains(el.ownerDocument.elementFromPoint(bounds.left + 8, bounds.top + bounds.height / 2))
        }), true, 'candidate receives pointer input above the header')
        assert.equal(await outer.evaluate(el => el.scrollTop), initialParentScroll, 'opening leaves parent scroll untouched')

        if (process.env.MEW_MENTION_SCREENSHOTS) {
          await fs.mkdir(process.env.MEW_MENTION_SCREENSHOTS, { recursive: true })
          await page.screenshot({ path: path.join(process.env.MEW_MENTION_SCREENSHOTS, `mention-${width}-${dark ? 'dark' : 'light'}.png`) })
        }
        await menu.hover()
        await page.mouse.wheel(0, 2000)
        await menu.evaluate(async el => {
          const view = el.ownerDocument.defaultView!
          for (let frame = 0; frame < 120 && el.scrollTop + el.clientHeight < el.scrollHeight - 1; frame++) await new Promise<void>(resolve => view.requestAnimationFrame(() => resolve()))
        })
        assert.ok(await menu.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 1), 'wheel reaches the final candidate')
        assert.equal(await outer.evaluate(el => el.scrollTop), initialParentScroll, 'wheel scroll stays in the candidate list')
        await last.click()
        await menu.waitFor({ state: 'hidden' })
        await input.evaluate(async el => {
          const view = el.ownerDocument.defaultView!
          await new Promise<void>(resolve => view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve())))
        })
        assert.equal(await input.inputValue(), '[[docs:reference-30.md]] ')
        await input.fill('@')
        await first.waitFor()
        await input.press('ArrowUp')
        assert.ok(await menu.evaluate(el => el.scrollTop > 0), 'keyboard wrap scrolls the last candidate into view')
        assert.equal(await outer.evaluate(el => el.scrollTop), initialParentScroll, 'keyboard selection leaves parent scroll untouched')
        await input.press('Enter')
        await menu.waitFor({ state: 'hidden' })
        await input.evaluate(async el => {
          const view = el.ownerDocument.defaultView!
          await new Promise<void>(resolve => view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve())))
        })
        assert.equal(await input.inputValue(), '[[docs:reference-30.md]] ')

        await input.fill('@')
        await first.waitFor()
        await page.locator('[data-input-shell]').evaluate(el => { el.style.height = '160px' })
        await menu.evaluate(async el => {
          const view = el.ownerDocument.defaultView!
          for (let frame = 0; frame < 120 && el.getBoundingClientRect().height >= 224; frame++) await new Promise<void>(resolve => view.requestAnimationFrame(() => resolve()))
        })
        const resized = await assertMenuBounds()
        assert.ok(resized.height < initial.height, 'wrapper resize reduces menu height to available space')
        assert.equal(await outer.evaluate(el => el.scrollTop), initialParentScroll)

        await menu.evaluate(el => {
          const viewport = el.ownerDocument.defaultView!.visualViewport!
          Object.defineProperty(viewport, 'height', { configurable: true, value: 180 })
          viewport.dispatchEvent(new Event('resize'))
        })
        await menu.evaluate(async el => {
          const view = el.ownerDocument.defaultView!
          for (let frame = 0; frame < 120 && el.getBoundingClientRect().bottom > 180; frame++) await new Promise<void>(resolve => view.requestAnimationFrame(() => resolve()))
        })
        const keyboardBelowAnchor = await assertMenuBounds()
        assert.equal(keyboardBelowAnchor.viewportTop, 0, 'height-only keyboard resize keeps the viewport origin')
        assert.ok(keyboardBelowAnchor.top >= 0 && keyboardBelowAnchor.bottom <= 180, 'menu stays above a keyboard that covers its input anchor')
        await menu.evaluate(el => {
          const viewport = el.ownerDocument.defaultView!.visualViewport!
          Reflect.deleteProperty(viewport, 'height')
          viewport.dispatchEvent(new Event('resize'))
        })

        await menu.evaluate(el => {
          const viewport = el.ownerDocument.defaultView!.visualViewport!
          Object.defineProperties(viewport, { offsetTop: { configurable: true, value: 100 }, height: { configurable: true, value: 500 } })
          viewport.dispatchEvent(new Event('resize'))
        })
        await menu.evaluate(async el => {
          const view = el.ownerDocument.defaultView!
          for (let frame = 0; frame < 120 && el.getBoundingClientRect().top < 100; frame++) await new Promise<void>(resolve => view.requestAnimationFrame(() => resolve()))
        })
        const keyboard = await assertMenuBounds()
        assert.ok(keyboard.height < resized.height, 'visual viewport changes reduce the available menu height')
        await menu.evaluate(el => {
          const viewport = el.ownerDocument.defaultView!.visualViewport!
          Reflect.deleteProperty(viewport, 'offsetTop'); Reflect.deleteProperty(viewport, 'height')
          viewport.dispatchEvent(new Event('resize'))
        })
        await page.setViewportSize({ width, height: 600 })
        await menu.evaluate(async el => {
          const view = el.ownerDocument.defaultView!
          await new Promise<void>(resolve => view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve())))
        })
        await assertMenuBounds()
        await input.press('Escape')
        assert.equal(await menu.count(), 0)
        assert.deepEqual(errors, [])
      } finally { await page.close() }
    }
  } finally { await browser.close() }
})
