import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('task context menus provide icon actions, keyboard navigation, viewport placement and read-only protection in all views', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const source = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {TaskPanel} from '${root}/src/components/task-panel.tsx';import {I18nProvider} from '${root}/src/i18n.tsx';
import {localToday} from '@mew/ui/date-value';import {setUiLocale} from '@mew/ui/i18n-core';setUiLocale('ko');localStorage.setItem('mew:locale','ko');
function Fixture(){const [tasks,setTasks]=useState([{id:'one',text:'첫 태스크',done:false,path:'docs/tasks/첫 태스크.md',startDate:localToday(),date:localToday()},{id:'two',text:'다음 태스크',done:false,path:'docs/tasks/다음 태스크.md',date:localToday()}]),[canEdit,setCanEdit]=useState(true),[draft,setDraft]=useState(''),[draftTags,setDraftTags]=useState([]),[opened,setOpened]=useState('');
const session={tasks,canEdit,draft,draftTags,setDraft,setDraftTags,edit:setTasks,flush:async()=>{},retry:async()=>{}};
return <><button id='readonly' onClick={()=>setCanEdit(!canEdit)}>Permission</button><button id='outside'>Outside</button><output>{opened}</output><TaskPanel workspace='fixture' session={session} onClose={()=>{}} onOpenFile={setOpened}/><div className='mobile-dock' style={{position:'fixed',bottom:0,height:50,width:'100%'}}/></>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:menu.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:menu.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:menu.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const css = await fs.readFile(path.join(root, 'src/components/task-panel.css'), 'utf8')
  const calendarCss = await fs.readFile(path.join(root, 'packages/ui/src/date-field.css'), 'utf8')
  const app = express()
  app.get('/', (_req, res) => res.send(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--color-surface:#fff;--color-surface-deep:#f8f8f8;--color-surface-hover:#eee;--color-ink:#222;--color-ink-secondary:#666;--color-danger:#b00;--color-accent:#06b;--color-edge:#ddd}body{margin:8px;font:14px sans-serif}*{box-sizing:border-box}button{border:0;background:transparent}section{display:flex;flex-direction:column;height:600px;width:100%}.task-view-body{flex:1;min-height:0;overflow:auto}.task-tag-add svg{width:14px;height:14px}${calendarCss}${css}</style><div id='root'></div><script>${bundle.output.find(item => item.type === 'chunk')!.code}</script>`))
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const errors: string[] = []
    for (const mobile of [false, true]) {
      const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1100, height: 800 }, hasTouch: mobile, isMobile: mobile })
      page.setDefaultTimeout(4000); page.on('pageerror', error => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${address.port}`)
      const row = page.locator('[data-task-id=one]'), menu = page.getByRole('menu', { name: '태스크', exact: true })
      await row.locator('textarea').click({ button: 'right' })
      await menu.waitFor({ state: 'visible' })
      assert.equal(await menu.locator('button').count(), 4)
      assert.equal(await menu.locator('button > svg[aria-hidden=true]').count(), 4)
      await menu.getByRole('menuitem', { name: '문서 열기' }).click()
      assert.equal(await page.locator('output').textContent(), 'docs/tasks/첫 태스크.md')
      await row.locator('textarea').press('Shift+F10')
      const documentAction = menu.getByRole('menuitem', { name: '문서 열기' })
      await documentAction.waitFor({ state: 'visible' })
      await documentAction.press('ArrowDown'); await menu.getByRole('menuitem', { name: '일정 편집' }).press('Enter')
      const dateDialog = page.getByRole('dialog', { name: '일정 편집' })
      await dateDialog.waitFor({ state: 'visible' }); await dateDialog.press('Escape')
      await dateDialog.waitFor({ state: 'hidden' })
      await row.click({ button: 'right' }); await menu.getByRole('menuitemcheckbox', { name: '완료' }).click()
      await row.waitFor({ state: 'detached' })
      await page.locator('[data-task-id=two] textarea').fill('다음 태스크 수정')
      await page.getByRole('tab', { name: '달력', exact: true }).click()
      assert.equal(await page.locator('[data-task-id=one]').count(), 0, 'calendar also hides completed items')
      assert.equal(await page.locator('.task-calendar-day[aria-current=date] small').textContent(), '1', 'calendar counts exclude hidden items')
      await page.getByRole('tab', { name: '간트', exact: true }).click()
      assert.equal(await page.locator('[data-gantt-bar=one]').count(), 0, 'Gantt also hides completed items')
      await page.getByRole('checkbox', { name: '완료된 항목 보기', exact: true }).check()
      assert.equal(await page.locator('[data-gantt-bar=one]').count(), 1, 'showing completed restores the hidden Gantt task')
      await page.getByRole('tab', { name: '달력', exact: true }).click()
      assert.equal(await page.locator('.task-calendar-day[aria-current=date] small').textContent(), '2', 'completion filter carries across views')
      await page.getByRole('tab', { name: '목록', exact: true }).click()
      assert.equal(await row.getAttribute('data-done'), 'true')
      await row.click({ button: 'right' })
      assert.equal(await menu.getByRole('menuitemcheckbox', { name: '완료' }).getAttribute('aria-checked'), 'true')
      await menu.getByRole('menuitemcheckbox', { name: '완료' }).click()
      await row.locator('textarea').press('Shift+F10')
      await menu.getByRole('menuitem', { name: '문서 열기' }).press('Escape'); await menu.waitFor({ state: 'hidden' })
      assert.equal(await row.locator('textarea').evaluate(el => el === el.ownerDocument.activeElement), true)
      await page.locator('#readonly').click()
      await row.click({ button: 'right' }); assert.equal(await menu.locator('button').count(), 1)
      await menu.getByRole('menuitem', { name: '문서 열기' }).click()
      await page.locator('#readonly').click()
      await page.getByRole('tab', { name: '달력', exact: true }).click()
      await row.click({ button: 'right' }); await menu.getByRole('menuitem', { name: '일정 편집' }).click()
      await dateDialog.waitFor({ state: 'visible' }); await dateDialog.press('Escape')
      await page.getByRole('tab', { name: '간트', exact: true }).click()
      const name = page.locator('.task-gantt-label button').filter({ hasText: '첫 태스크' })
      await name.click({ button: 'right' }); await menu.getByRole('menuitem', { name: '문서 열기' }).click()
      await page.locator('[data-gantt-bar=one]').click({ button: 'right' }); await menu.getByRole('menuitem', { name: '일정 편집' }).click()
      await dateDialog.waitFor({ state: 'visible' }); await dateDialog.press('Escape')
      await page.getByRole('tab', { name: '목록', exact: true }).click()
      await row.evaluate((el, x) => el.dispatchEvent(new el.ownerDocument.defaultView!.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: 798 })), mobile ? 388 : 1098)
      await menu.evaluate(el => new Promise<void>(resolve => el.ownerDocument.defaultView!.requestAnimationFrame(() => resolve())))
      const bounds = (await menu.boundingBox())!, dock = (await page.locator('.mobile-dock').boundingBox())!
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= (mobile ? 390 : 1100))
      assert.ok(bounds.y + bounds.height <= (mobile ? dock.y : 800), JSON.stringify({mobile,bounds,dock,details:await menu.evaluate(el=>({style:el.getAttribute('style'),viewport:el.ownerDocument.defaultView!.visualViewport?.offsetTop,scroll:el.ownerDocument.defaultView!.scrollY}))}))
      await page.locator('#outside').evaluate(el => el.addEventListener('click', () => el.setAttribute('data-clicked', 'true')))
      await page.locator('#outside').click(); await menu.waitFor({ state: 'hidden' })
      assert.equal(await page.locator('#outside').getAttribute('data-clicked'), null, 'outside click closes only the menu')
      await row.click({ button: 'right' }); await menu.getByRole('menuitem', { name: '태스크 삭제' }).click()
      await row.waitFor({ state: 'detached' }); assert.equal(await page.locator('[data-task-id]').count(), 1)
      assert.equal(await page.locator('textarea:focus').count(), 0)
      await page.close()
    }
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
