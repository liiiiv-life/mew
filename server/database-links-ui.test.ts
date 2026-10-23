import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
const first = '123e4567-e89b-12d3-a456-426614174000'
const second = '123e4567-e89b-12d3-a456-426614174001'
const missing = '123e4567-e89b-12d3-a456-426614174002'

test('Plain DB links open scoped dialogs with shared blur, preserve source and respect references', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const content = [
    `<div data-mew-db="${first}"></div>`, '',
    `<div\n data-mew-db-readonly='true' data-mew-db='${second}'>\n</div>`, '',
    '<div data-mew-db="invalid"></div>', '',
    '```html', `<div data-mew-db="${first}"></div>`, '```', '',
    `<!-- <div data-mew-db="${first}"></div> -->`, '',
    '`<div data-mew-db="' + first + '"></div>`', '',
    `<div data-mew-db="${missing}"></div>`,
  ].join('\n')
  const source = `import React from 'react';import {createRoot} from 'react-dom/client';
import {EditorPane} from '${root}/src/components/EditorPane.tsx';
import {DatabaseListModal} from '${root}/src/components/DatabaseListModal.tsx';
import {createEditorApi} from '${root}/src/api/client.ts';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {applyThemePalette,THEME_PRESETS} from '${root}/src/utils/theme-color.ts';
localStorage.setItem('mew:locale','ko');applyThemePalette(THEME_PRESETS.find(p=>p.id===new URL(location.href).searchParams.get('theme')).palette);
const noop=()=>{},api=createEditorApi('docs').db;
const callbacks=Object.fromEntries(['registerHandle','registerElement','registerTabBar','onFocus','onActivate','onPin','onCloseTab','onReorder','onOpenHistory','onSetTocOpen','onOpenSidebar','onTabDragMove','onTabDrop','onSetViewMode'].map(k=>[k,noop]));
function Fixture(){const [value,setValue]=React.useState(${JSON.stringify(content)}),[list,setList]=React.useState(false),[guest,setGuest]=React.useState(false);
window.saved=value;window.setGuest=setGuest;
return <div className="mew-workspace flex h-dvh flex-col"><button onClick={()=>setList(true)}>Open list</button><EditorPane {...callbacks}
pane={{id:'fixture',activePath:'mew:file:docs/db.md',tabs:[{path:'mew:file:docs/db.md',content:value,viewMode:'plain',editable:true,preview:false}]}}
onChangeContent={(_,v)=>setValue(v)} onOpenLink={p=>window.opened=p} role={guest?'guest':'owner'} authEmail="owner@example.test" project=".workspace" tree={[]} presence={{}} focused isGuest={guest} canCollaborate={false} showSidebarButton={false} tocOpen={false} dropZone={null}/>
{list&&<DatabaseListModal api={api} project="docs" onClose={()=>setList(false)}/>}</div>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const candidates = [source], styles: string[] = []
  const bundle = await build({ input: 'virtual:database-links.tsx', write: false, platform: 'browser', output: { format: 'esm', codeSplitting: false },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'database-links-fixture', resolveId(id) { if (id === 'virtual:database-links.tsx') return id }, async load(id) {
      if (id === 'virtual:database-links.tsx') return source
      if (id.endsWith('.css')) { styles.push(await fs.readFile(id, 'utf8')); return { code: '', moduleType: 'js' } }
      if (id.endsWith('.tsx')) candidates.push(await fs.readFile(id, 'utf8'))
    } }],
  })
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set(candidates.join('\n').match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + styles.join('\n')
  const code = bundle.output.find(item => item.type === 'chunk')!.code
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) for (const theme of ['midnight', 'light']) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: width < 500, hasTouch: width < 500 })
      page.setDefaultTimeout(5000)
      const errors: string[] = [], reads: string[] = [], writes: { project: string; value: string }[] = []
      page.on('pageerror', error => errors.push(error.message))
      const views = [first, second].map((id, index) => ({ id, title: index ? 'Reference DB' : 'Clicked DB', kind: 'managed', editable: true,
        columns: [{ id: 'title', name: '제목', type: 'text', primary: true }], rows: [{ id: 'row', pos: 0, cells: { title: 'Original cell' } }] }))
      await page.routeWebSocket('**/api/db/ws', () => {})
      await page.route('http://mew-db-links.test/**', route => {
        const url = new URL(route.request().url())
        if (url.pathname === '/api/db') { reads.push(url.searchParams.get('project')!); return route.fulfill({ json: views.toReversed() }) }
        if (url.pathname.startsWith('/api/db/')) {
          if (route.request().method() === 'PATCH') {
            const body = route.request().postDataJSON(); writes.push(body)
            return route.fulfill({ json: { value: body.value } })
          }
          reads.push(url.searchParams.get('project')!)
          const view = views.find(view => url.pathname === `/api/db/${view.id}`)
          return route.fulfill(view ? { json: view } : { status: 404, json: { error: 'Database not found' } })
        }
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} })
        return route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: code }
          : { contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` })
      })
      await page.goto(`http://mew-db-links.test/?theme=${theme}`)
      const link = page.locator(`[data-database-link="${first}"]`).first()
      await link.waitFor()
      assert.equal(await page.locator('.cm-line').filter({ hasText: 'invalid' }).locator('[data-database-link]').count(), 0)
      assert.equal(await page.locator(`[data-database-link="${first}"]`).count(), 1, 'fenced, inline-code and commented examples are not links')
      await link.click()
      assert.equal(await page.getByRole('dialog').count(), 0, 'ordinary clicks keep editing the source')
      await link.click({ modifiers: ['Control'] })
      const dialog = page.getByRole('dialog', { name: '데이터베이스', exact: true })
      await dialog.locator('input[value="Clicked DB"]').waitFor()
      assert.equal(await page.evaluate('window.saved'), content, 'Ctrl+click does not alter the Markdown')
      const surface = await dialog.evaluate(el => {
        const win = el.ownerDocument.defaultView!, style = win.getComputedStyle(el), rect = el.getBoundingClientRect()
        const canvas = el.ownerDocument.createElement('canvas'), context = canvas.getContext('2d')!
        canvas.width = canvas.height = 1; context.fillStyle = style.backgroundColor; context.fillRect(0, 0, 1, 1)
        return { alpha: context.getImageData(0, 0, 1, 1).data[3] / 255, blur: style.backdropFilter, filter: style.filter, opacity: style.opacity,
          inBounds: rect.left >= 0 && rect.right <= win.innerWidth && rect.top >= 0 && rect.bottom <= win.innerHeight }
      })
      assert.ok(Math.abs(surface.alpha - .75) < .005)
      assert.equal(surface.blur, 'blur(6px)')
      assert.equal(surface.filter, 'none'); assert.equal(surface.opacity, '1'); assert.equal(surface.inBounds, true)
      if (process.env.MEW_DATABASE_LINK_SCREENSHOTS) {
        await fs.mkdir(process.env.MEW_DATABASE_LINK_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: path.join(process.env.MEW_DATABASE_LINK_SCREENSHOTS, `${theme}-${width}.png`) })
      }
      const cell = dialog.getByRole('textbox', { name: '제목', exact: true })
      const savedResponse = page.waitForResponse(response => response.request().method() === 'PATCH')
      await cell.fill('Edited cell'); await cell.press('Tab')
      await savedResponse
      assert.deepEqual(writes.at(-1), { project: 'docs', columnId: 'title', value: 'Edited cell' })
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      assert.equal(await page.locator('.cm-content').evaluate(el => el === el.ownerDocument.activeElement), true)
      await page.locator(`[data-database-link="${second}"]`).first().click({ modifiers: ['Meta'] })
      await dialog.getByText('참조 · 읽기 전용', { exact: true }).waitFor()
      assert.equal(await dialog.getByRole('textbox').count(), 0, 'Cmd+click preserves a read-only reference')
      await dialog.getByRole('button', { name: '닫기', exact: true }).click()
      await page.locator(`[data-database-link="${missing}"]`).first().click({ modifiers: ['Control'] })
      await dialog.getByText('Database not found', { exact: true }).waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Open list', exact: true }).click()
      await dialog.locator('input[value="Reference DB"]').waitFor()
      await dialog.getByRole('button', { name: 'Clicked DB', exact: true }).click()
      await dialog.locator('input[value="Clicked DB"]').waitFor()
      await page.mouse.click(1, 1)
      await dialog.waitFor({ state: 'detached' })
      assert.ok(reads.length > 0 && reads.every(project => project === 'docs'), 'requests follow the source document scope')
      assert.equal(await page.evaluate('window.saved'), content)
      await page.evaluate('window.setGuest(true)')
      await page.locator('[data-database-link]').first().waitFor({ state: 'detached' })
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
