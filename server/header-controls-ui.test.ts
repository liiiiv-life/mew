import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('header controls share compact themed geometry and remain usable with long project names', { skip: !domBrowserExecutable(), timeout: 40_000 }, async () => {
  const source = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {HoverTipLayer} from '@mew/ui';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {ProjectSwitcher} from '${root}/src/components/ProjectSwitcher.tsx';
import {HeaderMenu} from '${root}/src/components/HeaderMenu.tsx';
import {HeaderNotifications} from '${root}/src/components/header-notifications.tsx';
import {HeaderResources} from '${root}/src/components/header-resources.tsx';
import {ActiveSessionsButton} from '${root}/src/components/active-sessions-button.tsx';
import {LayoutPresets} from '${root}/src/components/layout-presets.tsx';
import {headerIconControlClassName} from '${root}/src/components/header-control.ts';
import {factoryLayout,normalizeLayoutSnapshot} from '${root}/src/utils/layout-presets.ts';
import {publishMewcatNotice} from '${root}/src/utils/mewcat-notifications.ts';
const layout=factoryLayout(normalizeLayoutSnapshot({version:1,dock:{version:1,groups:[{id:'editor:main',kind:'editor'}],tree:{id:'editor:main'}},open:{editor:true,sidebar:true}}));
const project='/projects/Research-and-development-notes-with-a-very-long-project-name';
const base={browser:'Chrome',device:'Desktop',connectedAt:1789522800000,workspaceLabel:'Research',project:'.workspace',path:'README.md',visible:true};
const presence={selfId:'self',sessions:[{...base,id:'self',email:'alex@example.test',displayName:'Alex Park'},{...base,id:'self-mobile',email:'alex@example.test',displayName:'Alex Park',device:'Phone'},{...base,id:'member-one',email:'jo@example.test',displayName:'Jo'},{...base,id:'member-two',email:'kim@example.test',displayName:'Kim'}]};
const avatar='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#426b63"/><text x="16" y="21" text-anchor="middle" fill="white" font-family="sans-serif" font-size="15">A</text></svg>');
window.headerActions={fullscreen:0,resources:0,layout:0,menu:0};
function Fixture(){React.useEffect(()=>{publishMewcatNotice({key:'header-fixture',kind:'test',level:'success',source:'Fixture'})},[]);return <>
<header data-app-header className="flex h-9 items-stretch border-b border-edge bg-surface pr-2 md:h-11">
<ProjectSwitcher paths={[project]} activePath={project} fallbackLabel="Research" canOpen={true} canChangeIcon={false} icons={{}} onActivate={()=>{}} onIconChange={()=>{}} onOpen={()=>{}}/>
<div data-header-controls className="flex shrink-0 items-center gap-1 pl-1.5">
<HeaderResources onOpen={()=>{window.headerActions.resources++}}/>
<ActiveSessionsButton presence={presence} profile={{email:'alex@example.test',displayName:'Alex Park',avatarDataUrl:avatar}}/>
<div className="hidden md:contents"><LayoutPresets storageKey="header-layout-fixture" factory={layout} capture={()=>layout} onApply={()=>{window.headerActions.layout++}}/></div>
<HoverTipLayer className="contents" placement="bottom"><button type="button" aria-label="전체화면" data-tip="전체화면" className={headerIconControlClassName} onClick={()=>{window.headerActions.fullscreen++}}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button></HoverTipLayer>
<HeaderNotifications/>
<HeaderMenu items={[{id:'settings',label:'설정',icon:<svg width="16" height="16"><circle cx="8" cy="8" r="5" stroke="currentColor" fill="none"/></svg>,onSelect:()=>{window.headerActions.menu++}},{id:'help',label:'도움말',icon:<svg width="16" height="16"><path d="M8 3v6m0 3v1" stroke="currentColor"/></svg>,onSelect:()=>{window.headerActions.menu++}}]}/>
</div></header>
<main tabIndex={-1} className="min-h-40 bg-surface-deep p-3 text-sm text-ink-secondary">README.md</main>
<span data-reference-secondary className="hidden text-ink-secondary"/><span data-reference-ink className="hidden text-ink"/><span data-reference-accent className="hidden text-accent"/><span data-reference-hover className="hidden bg-surface-hover"/>
</>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({
    input: 'virtual:header-controls.tsx', write: false, platform: 'browser',
    output: { format: 'iife', codeSplitting: false },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'header-fixture', async resolveId(id, importer) {
      if (id === 'virtual:header-controls.tsx') return id
      if (id.endsWith('.css')) return 'virtual:style'
      if (id.endsWith('?raw')) {
        const resolved = await this.resolve(id.slice(0, -4), importer, { skipSelf: true })
        if (resolved) return `${resolved.id}?raw`
      }
    }, async load(id) {
      if (id === 'virtual:header-controls.tsx') return source
      if (id === 'virtual:style') return ''
      if (id.endsWith('?raw')) return `export default ${JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))}`
    } }],
  })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const files = ['src/components/header-control.ts', 'src/components/ProjectSwitcher.tsx', 'src/components/ProjectIcon.tsx', 'src/components/HeaderMenu.tsx', 'src/components/header-menu-popup.tsx', 'src/components/header-notifications.tsx', 'src/components/header-resources.tsx', 'src/components/active-sessions-button.tsx', 'src/components/layout-presets.tsx', 'packages/ui/src/dialog-frame.tsx', 'packages/ui/src/HoverTipLayer.tsx', 'packages/ui/src/action-menu.tsx']
  const content = source + (await Promise.all(files.map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set(content.match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, hasTouch: true })
    page.setDefaultTimeout(3000)
    const errors: string[] = [], unexpected: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript("localStorage.setItem('mew:locale','ko')")
    await page.route('http://mew-header-controls.test/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/system-stats') return route.fulfill({ json: { cpu: { model: 'Fixture CPU', cores: 8, usage: 37, loadavg: [0.4, 0.3, 0.3], temperature: null }, memory: { total: 16_000, used: 6400, available: 9600 }, gpus: [{ name: 'Fixture GPU', utilization: 24 }], processes: [], uptime: 3600, hostname: 'fixture' } })
      if (url.pathname.startsWith('/api/')) { unexpected.push(url.pathname); return route.fulfill({ json: {} }) }
      if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    })
    await page.goto('http://mew-header-controls.test/')
    const header = page.locator('[data-app-header]')
    const menu = header.getByRole('button', { name: '메뉴', exact: true })
    const bell = header.getByRole('button', { name: '알림: 1', exact: true })
    const fullscreen = header.getByRole('button', { name: '전체화면', exact: true })
    const layouts = header.getByRole('button', { name: '레이아웃', exact: true })
    const resources = header.getByRole('button', { name: '시스템 자원 보기', exact: true })
    const sessions = header.locator('[data-active-sessions]')
    await bell.waitFor()
    await sessions.locator('[data-active-sessions-count]').waitFor()
    await page.getByText('CPU 37% · RAM 40% · GPU 24%', { exact: true }).waitFor({ state: 'attached' })
    assert.equal(await sessions.locator('[data-active-sessions-count]').innerText(), '4')
    assert.equal(await sessions.getAttribute('aria-label'), '활성 세션 4개')
    assert.equal(await sessions.locator('img, [data-profile-avatar], [data-other-people]').count(), 0)

    for (const width of [1100, 390, 320]) for (const dark of [true, false]) {
      await page.setViewportSize({ width, height: 700 })
      await page.locator('html').evaluate((element, enabled) => element.classList.toggle('dark', enabled), dark)
      await page.mouse.move(0, 100)
      await page.locator('main').focus()
      const size = width >= 768 ? 32 : 28
      const expectedColor = await page.locator('[data-reference-secondary]').evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).color)
      const ink = await page.locator('[data-reference-ink]').evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).color)
      const accent = await page.locator('[data-reference-accent]').evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).color)
      const hover = await page.locator('[data-reference-hover]').evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).backgroundColor)
      const controls = [resources, sessions, fullscreen, bell, menu, ...(width >= 768 ? [layouts] : [])]
      const measurements = []
      for (const control of controls) {
        measurements.push(await control.evaluate(element => {
          const style = element.ownerDocument.defaultView!.getComputedStyle(element), rect = element.getBoundingClientRect()
          return { label: element.getAttribute('aria-label'), x: rect.x, y: rect.y, width: rect.width, height: rect.height, color: style.color, background: style.backgroundColor, borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth] }
        }))
      }
      for (const measurement of measurements) {
        assert.equal(measurement.height, size, `${measurement.label}: ${width}px button height`)
        assert.equal(measurement.color, expectedColor, `${measurement.label}: shared default text color`)
        assert.deepEqual(measurement.borders, ['0px', '0px', '0px', '0px'], `${measurement.label}: borderless header control`)
        assert.equal(measurement.background, 'rgba(0, 0, 0, 0)')
        assert.ok(measurement.x >= 0 && measurement.x + measurement.width <= width, `${measurement.label}: remains inside ${width}px viewport`)
        assert.equal(measurement.width, size)
      }
      assert.equal(new Set(measurements.map(item => item.y + item.height / 2)).size, 1, `all controls share the same vertical center: ${JSON.stringify(measurements.map(item => ({ label: item.label, center: item.y + item.height / 2 })))}`)
      assert.equal(await header.evaluate(element => element.scrollWidth <= element.clientWidth), true, 'long project names do not push header controls outside the viewport')
      assert.equal(await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth), true)
      const project = await header.locator('[data-project-switcher]').boundingBox()
      assert.ok(project && project.width > 0, 'the project selector retains visible space')
      assert.equal(await menu.innerText(), '', 'the menu trigger has an icon and an accessible name')
      assert.equal(await menu.getAttribute('title'), null, 'the menu uses the immediate shared tooltip')
      assert.equal(await layouts.isVisible(), width >= 768)
      const sessionIcon = (await sessions.locator('[data-active-sessions-icon]').boundingBox())!
      assert.equal(sessionIcon.width, 16)
      assert.equal(sessionIcon.height, 16)
      for (const icon of [fullscreen, bell, menu]) {
        const box = (await icon.locator('svg').boundingBox())!
        assert.equal(box.width, 16)
        assert.equal(box.height, 16)
      }

      for (const control of controls) {
        await control.hover()
        if (width >= 768) {
          const tooltip = page.getByRole('tooltip')
          await tooltip.waitFor()
          if (control === sessions) assert.equal(await tooltip.innerText(), '활성 세션 4개')
          const tipBounds = (await tooltip.boundingBox())!, buttonBounds = (await control.boundingBox())!
          assert.ok(tipBounds.y >= buttonBounds.y + buttonBounds.height + 5, 'header tooltips open below their controls')
          assert.ok(tipBounds.x >= 0 && tipBounds.x + tipBounds.width <= width, 'header tooltips stay inside the viewport')
        }
        assert.deepEqual(await control.evaluate(element => {
          const style = element.ownerDocument.defaultView!.getComputedStyle(element)
          return { color: style.color, background: style.backgroundColor }
        }), { color: ink, background: hover }, 'header controls share the same hover colors')
        await page.mouse.move(0, 100)
        await page.keyboard.press('Tab')
        await control.focus()
        assert.deepEqual(await control.evaluate(element => {
          const style = element.ownerDocument.defaultView!.getComputedStyle(element)
          return { visible: element.matches(':focus-visible'), color: style.outlineColor, width: style.outlineWidth }
        }), { visible: true, color: accent, width: '2px' }, 'keyboard focus uses the shared accent outline')
      }
      await fullscreen.press('Enter')
      await resources.click()
      await menu.focus(); await menu.press('Enter')
      const popup = page.getByRole('menu', { name: '메뉴', exact: true })
      await popup.waitFor()
      assert.equal(await popup.getByRole('menuitem', { name: '설정', exact: true }).evaluate(element => element === element.ownerDocument.activeElement), true)
      await page.keyboard.press('ArrowDown')
      assert.equal(await popup.getByRole('menuitem', { name: '도움말', exact: true }).evaluate(element => element === element.ownerDocument.activeElement), true)
      await page.keyboard.press('Enter')
      await popup.waitFor({ state: 'detached' })
      assert.equal(await menu.evaluate(element => element === element.ownerDocument.activeElement), true)
      await menu.press('Enter'); await popup.waitFor(); await page.keyboard.press('Escape')
      await popup.waitFor({ state: 'detached' })
      assert.equal(await menu.evaluate(element => element === element.ownerDocument.activeElement), true)

      await bell.click()
      const notices = page.getByRole('dialog', { name: '알림', exact: true })
      await notices.waitFor()
      const noticeBounds = (await notices.boundingBox())!
      assert.ok(noticeBounds.x >= 0 && noticeBounds.x + noticeBounds.width <= width)
      await page.keyboard.press('Escape'); await notices.waitFor({ state: 'detached' })
      assert.equal(await bell.evaluate(element => element === element.ownerDocument.activeElement), true)
      if (width >= 768) {
        await layouts.click()
        const dialog = page.getByRole('dialog', { name: '레이아웃', exact: true })
        await dialog.waitFor(); await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' })
        assert.equal(await layouts.evaluate(element => element === element.ownerDocument.activeElement), true)
      }
      await page.mouse.move(0, 100)
      await page.locator('main').focus()
      await header.screenshot({ path: `/tmp/mew-header-controls-${width}-${dark ? 'dark' : 'light'}.png` })
    }
    assert.deepEqual(await page.evaluate('window.headerActions'), { fullscreen: 6, resources: 6, layout: 0, menu: 6 })
    assert.deepEqual(unexpected, [])
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
