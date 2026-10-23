import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('task creation shortcuts follow the current view and preserve permission, draft and workspace boundaries', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const source = `import React,{useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';
import {TaskPanel} from '${root}/src/components/task-panel.tsx';import {I18nProvider} from '${root}/src/i18n.tsx';
import {captureAppTabShortcuts} from '${root}/src/utils/app-tab-shortcuts.ts';
import {TASK_LIMIT} from '${root}/shared/task-list.ts';import {setUiLocale} from '@mew/ui/i18n-core';setUiLocale('ko');localStorage.setItem('mew:locale','ko');
function Fixture(){const [tasks,setTasks]=useState([]),[draft,setDraft]=useState(''),[draftTags,setDraftTags]=useState([]),[draftAssignees,setDraftAssignees]=useState([]),[canEdit,setCanEdit]=useState(true),[loading,setLoading]=useState(false),[workspace,setWorkspace]=useState('one'),[dialog,setDialog]=useState(false);
useEffect(()=>captureAppTabShortcuts({closeEditorTab:()=>{},create:()=>{throw Error('Unexpected file creation')}}),[]);
const session={tasks,canEdit,loading,draft,draftTags,draftAssignees,setDraft,setDraftTags,setDraftAssignees,tagColors:{},edit:setTasks,flush:async()=>{},retry:async()=>{}};
return <><button id='readonly' onClick={()=>setCanEdit(!canEdit)}>Permission</button><button id='loading' onClick={()=>setLoading(!loading)}>Loading</button><button id='limit' onClick={()=>setTasks(Array.from({length:TASK_LIMIT},(_,i)=>({id:String(i),text:'limit',done:true})))}>Limit</button><button id='workspace' onClick={()=>setWorkspace('two')}>Workspace</button><button id='dialog' onClick={()=>setDialog(true)}>Dialog</button><output id='state'>{JSON.stringify(tasks)}</output><TaskPanel workspace={workspace} session={session} onClose={()=>{}}/>{dialog&&<div role='dialog'><input autoFocus/></div>}</>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:task-shortcuts.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:task-shortcuts.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:task-shortcuts.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const css = await fs.readFile(path.join(root, 'src/components/task-panel.css'), 'utf8') + await fs.readFile(path.join(root, 'packages/ui/src/date-field.css'), 'utf8')
  const app = express()
  app.get('/', (_req, res) => res.send(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px sans-serif}section{display:flex;flex-direction:column;height:600px}.task-view-body{flex:1;min-height:0;overflow:auto}#state{display:none}${css}</style><div id='root'></div><script>${bundle.output.find(item => item.type === 'chunk')!.code}</script>`))
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
      const panel = page.getByRole('region', { name: '태스크', exact: true })
      const title = panel.locator('.task-panel-title'), draft = panel.getByRole('textbox', { name: '새 태스크' })
      const pressCreate = async (keys = 'Control+n') => { await title.focus(); await page.keyboard.press(keys) }
      const assertDraftFocused = async () => { await panel.locator('.task-draft textarea:focus').waitFor({ state: 'visible' }) }
      await pressCreate(); await assertDraftFocused()
      await draft.fill('목록 항목'); await draft.press('Enter')
      assert.equal(await panel.locator('[data-task-id]').count(), 1)
      await draft.fill('작성 중 초안'); await draft.press('Control+n'); await assertDraftFocused()
      assert.equal(await draft.inputValue(), '작성 중 초안')
      await draft.fill('')
      await panel.getByRole('tab', { name: '달력', exact: true }).click()
      const selectedDate = await panel.locator('[role=gridcell][aria-selected=true] .task-calendar-day').getAttribute('data-date')
      await pressCreate('Meta+n'); await assertDraftFocused()
      await draft.fill('달력 항목'); await draft.press('Enter')
      const calendarTask = JSON.parse((await page.locator('#state').textContent())!).find((task: { text: string }) => task.text === '달력 항목')
      assert.ok(calendarTask.date)
      if (selectedDate) assert.equal(calendarTask.date, selectedDate)
      await panel.getByRole('tab', { name: '간트', exact: true }).click()
      await pressCreate()
      let tasks = JSON.parse((await page.locator('#state').textContent())!)
      assert.equal(tasks.length, 3)
      assert.equal(tasks.at(-1).text, '새 태스크')
      await page.locator('#workspace').click()
      await pressCreate('Alt+n')
      assert.equal(JSON.parse((await page.locator('#state').textContent())!).length, 4)
      await page.locator('#readonly').click(); await pressCreate()
      assert.equal(JSON.parse((await page.locator('#state').textContent())!).length, 4)
      await page.locator('#readonly').click(); await page.locator('#loading').click(); await pressCreate()
      assert.equal(JSON.parse((await page.locator('#state').textContent())!).length, 4)
      await page.locator('#loading').click(); await page.locator('#limit').click(); await pressCreate()
      tasks = JSON.parse((await page.locator('#state').textContent())!)
      assert.equal(tasks.length, 2000)
      await page.locator('#dialog').click(); await page.keyboard.press('Control+n')
      assert.equal(JSON.parse((await page.locator('#state').textContent())!).length, 2000)
      await page.close()
    }
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
