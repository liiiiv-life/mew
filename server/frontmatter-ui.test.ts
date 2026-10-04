import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('frontmatter handles reorder and edit persistent field types on desktop and touch', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const initial = '---\ntitle: Document\nstatus: Draft\nreference: "[Guide](../guide.md)"\ncount: "123"\ndue: "2026-10-02"\n---\n\nBody'
  const source = `
import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {FrontmatterPanel} from ${JSON.stringify(path.join(root, 'packages/editor/src/editor/FrontmatterPanel.tsx'))};
import {splitFrontmatter,joinFrontmatter} from ${JSON.stringify(path.join(root, 'packages/editor/src/utils/frontmatter.ts'))};
const shared = new Map();
const optionsApi = {fetch: async key => shared.get(key) ?? null, update: async (key, change) => {
 await new Promise(resolve => setTimeout(resolve, 10));
 if(window.failOptions) throw new Error('Could not save options');
 const next = [...new Set([...(shared.get(key) ?? change.seed), ...change.add])].filter(v => !change.remove.includes(v));
 shared.set(key, next); return next;
}};
function Fixture(){
 const [current,setCurrent]=React.useState(${JSON.stringify(initial)}), [other,setOther]=React.useState('---\\ntitle: Other\\nstatus: \"\" # mew:field {\"type\":\"select\"}\\n---\\n\\nBody'), [documentName,setDocumentName]=React.useState('current'), [epoch,setEpoch]=React.useState(0), [readOnly,setReadOnly]=React.useState(false);
 const value = documentName === 'current' ? current : other, setValue = documentName === 'current' ? setCurrent : setOther;
 const {frontmatter, lineNumbers}=splitFrontmatter(value); window.saved=value; window.open=(...args)=>{window.external=args;return null;};
 return <><button onClick={()=>setDocumentName(name=>name==='current'?'other':'current')}>Other document</button><button onClick={()=>setEpoch(e=>e+1)}>Reload</button><button onClick={()=>setReadOnly(r=>!r)}>Read-only</button>
 <div className="editor-root" style={{height:650,overflow:'auto'}}><FrontmatterPanel key={epoch} data={frontmatter} lineNumbers={lineNumbers} docPath={documentName+'.md'} optionsApi={optionsApi} readOnly={readOnly} onChange={next=>setValue(joinFrontmatter(next,'Body'))} onOpenLink={p=>window.opened=p}/></div></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const candidates = [source]
  const bundle = await build({ input: 'virtual:frontmatter.tsx', write: false, platform: 'browser', output: { format: 'esm' },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'frontmatter-fixture', resolveId(id) { if (id === 'virtual:frontmatter.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' },
      async load(id) {
        if (id === 'virtual:frontmatter.tsx') return source
        if (id === 'virtual:style') return ''
        if (id.endsWith('.tsx')) candidates.push(await fs.readFile(id, 'utf8'))
      },
    }],
  })
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const calendarCss = (await Promise.all(['date-field.css', 'date-calendar.css'].map(name => fs.readFile(path.join(root, 'packages/ui/src', name), 'utf8')))).join('\n')
  const css = calendarCss + compiler.build([...new Set(candidates.join('\n').match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + await fs.readFile(path.join(root, 'packages/editor/src/editor/editor.css'), 'utf8')
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: width < 500, isMobile: width < 500 })
      const errors: string[] = []
      page.on('pageerror', e => errors.push(e.message))
      await page.route('http://mew-frontmatter.test/**', route => route.fulfill(route.request().url().endsWith('/app.js')
        ? { contentType: 'text/javascript', body: chunk.code }
        : { contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` }))
      await page.goto('http://mew-frontmatter.test/')
      const rows = page.locator('.frontmatter-property'), handles = page.getByRole('button', { name: '필드 순서 변경', exact: true })
      await rows.first().waitFor()
      assert.equal(await page.locator('select,datalist').count(), 0)
      assert.equal(await page.locator('input[type="date"]').count(), 0)
      const dueRow = rows.filter({ has: page.getByRole('textbox', { name: 'due', exact: true }) })
      await dueRow.getByRole('button', { name: '달력 열기', exact: true }).click()
      const calendar = page.getByRole('dialog', { name: '날짜 선택', exact: true })
      await calendar.locator('.task-range-calendar').waitFor()
      if (width < 500) {
        const touch = await page.context().newCDPSession(page)
        const swipeMonth = async (dx: number, dy = 0, cancel = false) => {
          const box = (await calendar.getByRole('grid').boundingBox())!
          const x = box.x + box.width / 2, y = box.y + box.height / 2
          await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
          for (let step = 1; step <= 4; step++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * step / 4, y: y + dy * step / 4 }] })
          await touch.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] })
        }
        await swipeMonth(-90)
        await calendar.getByRole('grid', { name: '2026년 11월' }).waitFor()
        assert.equal(await calendar.getByRole('textbox', { name: '월', exact: true }).inputValue(), '11')
        assert.equal(await dueRow.getByRole('textbox', { name: 'due', exact: true }).inputValue(), '2026-10-02')
        await swipeMonth(90)
        await calendar.getByRole('grid', { name: '2026년 10월' }).waitFor()
        assert.equal(await calendar.getByRole('textbox', { name: '월', exact: true }).inputValue(), '10')
        await swipeMonth(8, 70)
        assert.equal(await calendar.getByRole('textbox', { name: '월', exact: true }).inputValue(), '10')
        await swipeMonth(-90, 0, true)
        assert.equal(await calendar.getByRole('textbox', { name: '월', exact: true }).inputValue(), '10')
      }
      await calendar.locator('[data-date="2026-10-04"]').click()
      await page.waitForFunction(`window.saved.includes('2026-10-04')`)
      await dueRow.getByRole('button', { name: '달력 열기', exact: true }).click()
      await page.keyboard.press('Escape')
      assert.equal(await calendar.count(), 0)
      await handles.first().focus()
      await page.keyboard.press('Shift+F10')
      await page.getByRole('dialog', { name: '필드 타입 변경' }).waitFor()
      await page.keyboard.press('End')
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('Enter')
      assert.equal(await rows.first().getByRole('textbox', { name: 'status' }).inputValue(), 'Draft')
      assert.equal(await rows.first().getByRole('textbox', { name: 'status' }).getAttribute('aria-invalid'), 'true')
      await handles.first().focus()
      await page.keyboard.press('Shift+F10')
      await page.getByRole('dialog', { name: '필드 타입 변경' }).getByRole('button', { name: '텍스트', exact: true }).click()
      await handles.first().focus()
      await page.keyboard.press('Alt+ArrowDown')
      assert.equal(await rows.nth(1).getByRole('textbox', { name: '필드명' }).inputValue(), 'status')
      await handles.nth(1).focus()
      await page.keyboard.press('Alt+ArrowUp')
      assert.equal(await rows.first().getByRole('textbox', { name: '필드명' }).inputValue(), 'status')
      const geometry = await rows.first().evaluate(row => ({
        handle: row.querySelector('button')!.getBoundingClientRect().right,
        label: row.querySelector('input')!.getBoundingClientRect().left,
      }))
      assert.ok(geometry.handle <= geometry.label, 'handle stays before the indented field label')
      await page.getByRole('link', { name: 'Guide', exact: true }).click()
      assert.equal(await page.evaluate('window.opened'), 'guide.md')
      const from = (await handles.first().boundingBox())!, to = (await rows.last().boundingBox())!
      if (width < 500) {
        const cdp = await page.context().newCDPSession(page)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x + from.width / 2, y: from.y + from.height / 2 }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + from.width / 2, y: to.y + to.height - 1 }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      } else {
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
        await page.mouse.down()
        await page.mouse.move(from.x + from.width / 2, to.y + to.height - 1, { steps: 8 })
        await page.mouse.up()
      }
      await page.waitForFunction(`window.saved.indexOf('due:') < window.saved.indexOf('status:')`)
      const openMenu = async () => { await handles.last().click({ button: width < 500 ? 'left' : 'right' }); await page.getByRole('dialog', { name: '필드 타입 변경' }).waitFor() }
      await openMenu()
      const menu = page.getByRole('dialog', { name: '필드 타입 변경' })
      await menu.getByRole('button', { name: '단일선택', exact: true }).click()
      await menu.getByRole('textbox', { name: '새 선택 항목' }).fill('Published')
      await menu.getByRole('button', { name: '추가', exact: true }).click()
      await menu.getByRole('textbox', { name: '새 선택 항목' }).fill('Archive')
      await menu.getByRole('button', { name: '추가', exact: true }).click()
      await menu.getByRole('button', { name: 'Archive 항목 삭제' }).click()
      await page.waitForFunction(`!window.saved.includes('Archive')`)
      assert.ok(!(await page.evaluate('window.saved') as string).includes('Archive'))
      const snapshot = await page.evaluate('window.saved')
      await page.keyboard.press('Escape')
      assert.equal(await menu.count(), 0)
      const single = rows.last().getByRole('combobox', { name: 'status', exact: true })
      await single.click()
      await page.getByRole('option', { name: 'Published', exact: true }).click()
      assert.ok((await page.evaluate('window.saved') as string).includes('status: "Published"'))
      await page.getByRole('button', { name: 'Reload', exact: true }).click()
      assert.equal(await rows.last().getByRole('combobox').count(), 1)
      assert.ok((snapshot as string).includes('# mew:field'))
      await openMenu()
      await menu.getByRole('button', { name: '다중선택', exact: true }).click()
      await page.keyboard.press('Escape')
      await rows.last().getByRole('button', { name: 'status', exact: true }).click()
      const choices = page.getByRole('dialog', { name: 'status', exact: true })
      await choices.getByRole('option', { name: 'Draft', exact: true }).click()
      assert.ok((await page.evaluate('window.saved') as string).includes('Published'))
      assert.equal(await choices.getByRole('option', { name: 'Draft', exact: true }).getAttribute('aria-selected'), 'true')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Reload', exact: true }).click()
      assert.equal(await rows.last().getByRole('button', { name: 'status' }).textContent(), 'PublishedDraft')
      await rows.last().getByRole('button', { name: 'status', exact: true }).click()
      const search = choices.getByRole('combobox', { name: '검색 또는 새 항목' })
      await search.fill('Review')
      await search.press('Enter')
      await page.waitForFunction(`window.saved.includes('Review')`)
      await search.fill('Review')
      assert.equal(await choices.getByRole('option', { name: '“Review” 추가' }).count(), 0, 'existing names are not duplicated')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Other document', exact: true }).click()
      await rows.first().getByRole('combobox', { name: 'status', exact: true }).click()
      await page.getByRole('option', { name: 'Review', exact: true }).waitFor()
      await page.getByRole('combobox', { name: '검색 또는 새 항목' }).fill('Approved')
      await page.getByRole('option', { name: '“Approved” 추가', exact: true }).click()
      await page.waitForFunction(`window.saved.includes('status: "Approved"')`)
      await page.getByRole('button', { name: 'Reload', exact: true }).click()
      assert.equal(await rows.first().getByRole('combobox', { name: 'status', exact: true }).textContent(), 'Approved')
      await page.getByRole('button', { name: 'Other document', exact: true }).click()
      await rows.last().getByRole('button', { name: 'status', exact: true }).click()
      await choices.getByRole('option', { name: 'Approved', exact: true }).waitFor()
      for (const theme of ['dark', 'light']) {
        await page.locator('html').evaluate((el, theme) => { el.className = theme }, theme)
        const bounds = (await choices.boundingBox())!
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= 844)
        if (process.env.MEW_EDITOR_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MEW_EDITOR_SCREENSHOT_DIR}/frontmatter-select-${width}-${theme}.png` })
      }
      await search.fill('조합중')
      const beforeComposition = await page.evaluate('window.saved')
      await search.evaluate(el => {
        const Keyboard = el.ownerDocument.defaultView!.KeyboardEvent
        el.dispatchEvent(new Keyboard('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
      })
      assert.equal(await page.evaluate('window.saved'), beforeComposition)
      await page.evaluate('window.failOptions = true')
      await search.fill('Failed')
      await search.press('Enter')
      await page.getByRole('alert').waitFor()
      assert.ok(!(await page.evaluate('window.saved') as string).includes('Failed'))
      await page.evaluate('window.failOptions = false')
      await page.keyboard.press('Escape')
      await openMenu()
      await menu.getByRole('button', { name: '텍스트', exact: true }).click()
      assert.ok(await rows.last().getByRole('textbox', { name: 'status' }).inputValue(), 'changing type retains all selections')
      for (const type of ['숫자', '날짜', '글 링크']) {
        await openMenu()
        await menu.getByRole('button', { name: type, exact: true }).click()
      }
      await rows.last().getByRole('button', { name: '링크 편집' }).click()
      await rows.last().getByRole('textbox', { name: 'status' }).fill('https://example.com')
      await page.getByRole('button', { name: 'Reload' }).click()
      assert.equal(await rows.last().getByRole('link', { name: 'https://example.com' }).count(), 1)
      await rows.last().getByRole('link', { name: 'https://example.com' }).click()
      assert.deepEqual(await page.evaluate('window.external'), ['https://example.com', '_blank', 'noopener,noreferrer'])
      await openMenu()
      await page.locator('html').click({ position: { x: width - 4, y: 4 } })
      assert.equal(await menu.count(), 0)
      await openMenu()
      await page.goBack()
      await menu.waitFor({ state: 'detached' })
      for (const theme of ['dark', 'light']) {
        await page.locator('html').evaluate((el, theme) => { el.className = theme }, theme)
        await openMenu()
        const rect = (await menu.boundingBox())!
        assert.ok(rect.x >= 0 && rect.x + rect.width <= width + 1 && rect.y >= 0 && rect.y + rect.height <= 844)
        assert.equal(await page.locator('html').evaluate(el => el.scrollWidth > el.clientWidth), false)
        if (process.env.MEW_EDITOR_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MEW_EDITOR_SCREENSHOT_DIR}/frontmatter-${width}-${theme}.png` })
        await page.keyboard.press('Escape')
      }
      await openMenu()
      assert.equal(await menu.locator('button').last().textContent(), '필드 삭제')
      await menu.getByRole('button', { name: '필드 삭제', exact: true }).click()
      assert.equal(await menu.count(), 0)
      assert.equal(await rows.count(), 3)
      assert.ok(!(await page.evaluate('window.saved') as string).includes('status:'))
      await page.getByRole('button', { name: 'Reload' }).click()
      assert.equal(await rows.count(), 3)
      await page.getByRole('button', { name: 'Read-only' }).click()
      assert.equal(await handles.count(), 0)
      assert.equal(await page.getByRole('button', { name: '필드 삭제' }).count(), 0)
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
