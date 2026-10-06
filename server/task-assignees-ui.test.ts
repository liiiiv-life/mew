import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

// Isolated browser fixture; never starts or builds the running application.
test('task assignees support avatars, keyboard, drafts, persistence, mobile and read-only', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-assignee-ui-'))
  process.env.MEW_DATA_DIR = directory
  process.env.MEW_WORKSPACE = path.join(directory, 'workspace')
  await fs.mkdir(process.env.MEW_WORKSPACE)
  const { createTaskListRouter } = await import('./task-list-routes.ts')
  const { WORKSPACE_ROOT } = await import('./paths.ts')
  const { readTaskList } = await import('./task-list.ts')
  const root = path.resolve(import.meta.dirname, '..')
  const source = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {I18nProvider} from '${root}/src/i18n.tsx';import {TaskPanel} from '${root}/src/components/task-panel.tsx';import {useTaskList} from '${root}/src/hooks/use-task-list.ts';
localStorage.setItem('mew:locale','ko');
function Fixture(){const [readOnly,setReadOnly]=useState(false);const session=useTaskList(${JSON.stringify(WORKSPACE_ROOT)},'one@example.test',true);return <div style={{height:'100dvh',display:'flex',flexDirection:'column'}}><button onClick={()=>setReadOnly(!readOnly)}>Read only</button><div style={{flex:1,minHeight:0}}><TaskPanel workspace=${JSON.stringify(WORKSPACE_ROOT)} session={{...session,canEdit:session.canEdit&&!readOnly}} onClose={()=>{}}/></div></div>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:assignees.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:assignees.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:assignees.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const files = ['src/components/task-panel.tsx', 'src/components/task-text.tsx', 'src/components/task-tag-filter.tsx', 'src/components/DockWorkspace.tsx']
  const ui = (await Promise.all(files.map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set((source + ui).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + await fs.readFile(`${root}/src/components/task-panel.css`, 'utf8') + await fs.readFile(`${root}/packages/ui/src/date-field.css`, 'utf8') + await fs.readFile(`${root}/packages/ui/src/date-calendar.css`, 'utf8')
  const avatar = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#0e7490"/><circle cx="20" cy="14" r="7" fill="white"/><path d="M7 35a13 13 0 0 1 26 0" fill="white"/></svg>').toString('base64')}`
  const members = [{ email: 'one@example.test', displayName: '김담당', avatarDataUrl: avatar }, { email: 'two@example.test', displayName: '이협업', avatarDataUrl: null }]
  let rosterFailure = true
  const app = express(); app.use(express.json())
  app.use((req, _res, next) => { req.auth = { role: 'owner', email: 'one@example.test', mustChangePassword: false }; next() })
  app.use('/api/task-list', createTaskListRouter())
  app.get('/api/member-profiles', (_req, res) => { if (rosterFailure) res.status(500).json({ error: 'fixture' }); else res.json({ members }) })
  app.get('/api/tree', (_req, res) => res.json([]))
  app.get('/app.js', (_req, res) => res.type('js').send(bundle.output.find(item => item.type === 'chunk')!.code))
  app.get('/', (_req, res) => res.type('html').send(`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`))
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 640 } }); page.setDefaultTimeout(5000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${address.port}`)
    const panel = page.getByRole('region', { name: '태스크', exact: true }), draft = panel.getByRole('textbox', { name: '새 태스크' })
    await draft.fill('담당자 지정 검토'); await draft.press('Enter')
    const rows = panel.locator('[data-task-id]'), first = rows.first()
    await first.getByRole('button', { name: '담당자', exact: true }).click()
    const popup = page.getByRole('dialog', { name: '담당자', exact: true })
    await popup.getByRole('alert').waitFor(); rosterFailure = false
    await popup.getByRole('button', { name: '다시 시도' }).click()
    await popup.getByRole('option', { name: /김담당/ }).waitFor()
    await popup.getByRole('option', { name: /김담당/ }).click()
    const search = popup.getByRole('textbox', { name: '담당자 검색' })
    await search.fill('two@'); await search.press('Enter')
    assert.equal(await popup.getByRole('option').getAttribute('aria-selected'), 'true')
    await search.fill(''); await page.screenshot({ path: '/tmp/mew-assignees-desktop.png' })
    await search.press('Escape'); assert.equal(await popup.count(), 0)
    assert.equal(await first.locator('.task-assignee-avatar').count(), 2)
    assert.equal(await first.locator('.task-assignee-avatar img').getAttribute('src'), avatar)
    assert.doesNotMatch(await first.innerText(), /김담당|이협업/)
    assert.equal(await first.locator('.task-assignee-trigger').evaluate(el => el === el.ownerDocument.activeElement), true)
    await page.waitForResponse(response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok())
    await page.reload(); await first.locator('.task-assignee-avatar img').waitFor()
    assert.deepEqual(readTaskList(WORKSPACE_ROOT)[0].assignees, ['one@example.test', 'two@example.test'])
    const text = first.getByRole('textbox', { name: '태스크 내용', exact: true })
    await text.focus(); await text.press('End'); await text.press('Enter')
    assert.equal(await rows.nth(1).locator('.task-assignee-avatar').count(), 2, 'split retains assignees')
    await draft.fill('담당자 포함 초안'); await panel.locator('.task-draft').getByRole('button', { name: '담당자', exact: true }).click()
    await popup.getByRole('option', { name: /김담당/ }).click()
    await page.reload()
    assert.equal(await draft.inputValue(), '담당자 포함 초안')
    assert.equal(await panel.locator('.task-draft .task-assignee-avatar').count(), 1, 'reload preserves assignee drafts')
    await draft.press('Enter'); assert.equal(await panel.locator('.task-draft .task-assignee-avatar').count(), 0)
    await page.setViewportSize({ width: 320, height: 720 })
    await page.locator('html').evaluate(el => el.classList.add('dark'))
    const mobile = await browser.newContext({ viewport: { width: 320, height: 720 }, hasTouch: true, isMobile: true })
    const touch = await mobile.newPage(); touch.setDefaultTimeout(5000)
    await touch.goto(`http://127.0.0.1:${address.port}`)
    const touchFirst = touch.locator('[data-task-id]').first()
    await touchFirst.locator('.task-assignee-trigger').tap()
    const touchPopup = touch.getByRole('dialog', { name: '담당자', exact: true })
    const bounds = await touchPopup.boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 320)
    assert.equal(await touchPopup.getByRole('textbox').evaluate(el => el === el.ownerDocument.activeElement), false, 'touch opening does not summon the keyboard')
    await touch.locator('html').evaluate(el => el.classList.add('dark'))
    await touch.screenshot({ path: '/tmp/mew-assignees-mobile.png' })
    await touchPopup.getByRole('option', { name: /이협업/ }).tap()
    assert.equal(await touchPopup.getByRole('option', { name: /이협업/ }).getAttribute('aria-selected'), 'false')
    await touchFirst.getByRole('textbox', { name: '태스크 내용', exact: true }).tap()
    await touch.getByRole('button', { name: 'Read only' }).tap()
    assert.equal(await touchFirst.locator('button.task-assignee-trigger').count(), 0)
    assert.ok(await touchFirst.locator('.task-assignee-avatar').count() > 0)
    assert.deepEqual(errors, [])
    await mobile.close()
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(directory, { recursive: true, force: true }) }
})
