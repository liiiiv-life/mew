import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('project browser and app dialogs preserve input, focus and operation boundaries', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const source = `import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {OpenProjectDialog} from '${root}/src/components/OpenProjectDialog.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {useDialog} from '${root}/packages/ui/src/use-dialog.tsx';
localStorage.setItem('mew:locale','ko');
function Fixture(){const [open,setOpen]=useState(false);const dialogs=useDialog();return <><button onClick={()=>setOpen(true)}>프로젝트 추가</button><button onClick={async()=>{window.answer=await dialogs.prompt({message:'이름 변경',defaultValue:'before',confirmLabel:'저장'})}}>이름 바꾸기</button><button onClick={async()=>{window.answer=await dialogs.confirm({message:'삭제할까요?',danger:true,confirmLabel:'삭제'})}}>삭제 확인</button>{dialogs.dialog}{open&&<OpenProjectDialog basePath='/home/test' onClose={()=>setOpen(false)} onOpen={p=>{window.opened=p;setOpen(false)}}/>}</>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:project.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:project.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:project.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const files = ['src/components/OpenProjectDialog.tsx', 'src/components/cloud-storage-locations.tsx', 'packages/ui/src/dialog-frame.tsx', 'packages/ui/src/ConfirmDialog.tsx', 'packages/ui/src/prompt-dialog.tsx']
  const content = (await Promise.all(files.map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 850 }, hasTouch: true })
    const mutations: { endpoint: string; body: Record<string, string> }[] = []
    const names = ['mew', 'sleeeep', 'alaaaarm', 'a-very-long-project-folder-name-that-must-stay-inside-the-dialog']
    let failFolder = true
    let releaseClone: (() => void) | undefined
    let initialized = false
    let cloudMode: 'found' | 'empty' | 'failed' = 'found'
    const cloudFolders = [
      { provider: 'onedrive', name: 'OneDrive - Work', path: '/cloud/OneDrive' },
      { provider: 'google-drive', name: 'GoogleDrive-person@example.test', path: '/cloud/GoogleDrive' },
      { provider: 'icloud', name: 'iCloud Drive', path: '/cloud/iCloud' },
    ]
    await context.route('http://mew-project.test/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/fs/cloud-storage') {
        if (cloudMode === 'failed') return route.fulfill({ status: 503, json: { error: 'Unavailable' } })
        return route.fulfill({ json: { folders: cloudMode === 'empty' ? [] : cloudFolders } })
      }
      if (url.pathname === '/api/fs/entries') {
        const current = url.searchParams.get('path') || '/home/test'
        if (current === '/missing') return route.fulfill({ status: 404, json: { error: '폴더를 찾을 수 없습니다' } })
        const entries = current === '/home/test' ? names.map((name, i) => ({ name, path: `${current}/${name}`, type: 'dir', git: i === 0, size: null })) : []
        if (current === '/cloud/OneDrive') entries.push({ name: 'work', path: '/cloud/OneDrive/work', type: 'dir', git: false, size: null })
        if (initialized) entries.push({ name: '.git', path: `${current}/.git`, type: 'dir', git: false, size: null })
        return route.fulfill({ json: { path: current, parent: current === '/' ? null : '/home/test', entries } })
      }
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        mutations.push({ endpoint: url.pathname, body })
        if (url.pathname === '/api/fs/folder' && failFolder) { failFolder = false; return route.fulfill({ status: 409, json: { error: '이미 존재하는 폴더입니다' } }) }
        if (url.pathname === '/api/fs/git/clone') await new Promise<void>(resolve => { releaseClone = resolve })
        if (url.pathname === '/api/fs/git/init') initialized = true
        if (body.name) names.push(body.name)
        return route.fulfill({ json: { ok: true, path: `${body.parent}/${body.name}` } })
      }
      return route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(4000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('dialog', async dialog => { errors.push(`Native dialog: ${dialog.type()}`); await dialog.dismiss() })
    await page.goto('http://mew-project.test/')
    const trigger = page.getByRole('button', { name: '프로젝트 추가', exact: true })
    const dialog = page.getByRole('dialog', { name: '새 프로젝트 열기' })
    for (const [width, dark] of [[1200, true], [390, true], [1200, false], [390, false]] as const) {
      await page.setViewportSize({ width, height: 850 })
      await page.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`)
      await trigger.click()
      await dialog.getByRole('button', { name: 'mew Git' }).waitFor()
      await dialog.getByRole('button', { name: 'OneDrive - Work 폴더로 이동' }).waitFor()
      assert.equal(await dialog.getByRole('textbox', { name: '프로젝트 경로' }).evaluate(el => el === el.ownerDocument.activeElement), true)
      const box = await dialog.boundingBox()
      assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.height < 850)
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true)
      await page.screenshot({ path: `/tmp/mew-project-${width}-${dark ? 'dark' : 'light'}.png` })
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      assert.equal(await trigger.evaluate(el => el === el.ownerDocument.activeElement), true)
    }
    await trigger.click()
    await dialog.getByRole('button', { name: 'mew Git' }).waitFor()
    await dialog.getByRole('textbox', { name: '폴더 이름으로 필터' }).fill('zzz')
    await dialog.getByText('일치하는 폴더가 없습니다', { exact: true }).waitFor()
    await dialog.getByRole('textbox', { name: '폴더 이름으로 필터' }).fill('')
    await dialog.getByRole('button', { name: '새 폴더', exact: true }).click()
    const name = dialog.getByRole('textbox', { name: '폴더 이름', exact: true })
    await name.fill('../bad')
    assert.equal(await dialog.getByRole('button', { name: '새 폴더', exact: true }).isDisabled(), true)
    await name.fill('새 프로젝트')
    await name.press('Enter')
    await dialog.getByRole('alert').waitFor()
    assert.equal(await name.inputValue(), '새 프로젝트')
    await page.screenshot({ path: '/tmp/mew-project-create-error-mobile.png' })
    await dialog.getByRole('button', { name: '새 폴더', exact: true }).click()
    await dialog.getByRole('button', { name: '새 프로젝트', exact: true }).waitFor()
    assert.deepEqual(mutations.slice(0, 2).map(item => item.body), [{ parent: '/home/test', name: '새 프로젝트' }, { parent: '/home/test', name: '새 프로젝트' }])
    await dialog.getByRole('button', { name: 'Git 복제', exact: true }).click()
    await dialog.getByRole('textbox', { name: 'Git 저장소 주소' }).fill('https://github.com/team/cloned.git')
    assert.equal(await name.getAttribute('placeholder'), 'cloned')
    await dialog.getByRole('button', { name: 'Git 복제', exact: true }).click()
    await page.waitForFunction("document.querySelector('[role=\"dialog\"]')?.getAttribute('aria-busy') === 'true'")
    await page.keyboard.press('Escape')
    await page.screenshot({ path: '/tmp/mew-project-clone-mobile.png' })
    assert.equal(await dialog.count(), 1)
    assert.equal(await dialog.getByRole('button', { name: '취소', exact: true }).isDisabled(), true)
    while (!releaseClone) await new Promise(resolve => setTimeout(resolve, 10))
    releaseClone()
    await dialog.getByRole('button', { name: 'cloned', exact: true }).waitFor()
    assert.deepEqual(mutations.at(-1)?.body, { parent: '/home/test', url: 'https://github.com/team/cloned.git', name: 'cloned' })
    await dialog.getByRole('button', { name: 'Git 초기화', exact: true }).click()
    await page.keyboard.press('Escape')
    assert.equal(mutations.filter(item => item.endpoint.endsWith('/init')).length, 0)
    assert.equal(await dialog.getByRole('button', { name: 'Git 초기화', exact: true }).evaluate(el => el === el.ownerDocument.activeElement), true)
    await dialog.getByRole('button', { name: 'Git 초기화', exact: true }).click()
    await dialog.getByRole('button', { name: 'Git 초기화', exact: true }).click()
    await dialog.getByRole('button', { name: 'Git 저장소', exact: true }).waitFor()
    assert.equal(await dialog.getByRole('button', { name: 'Git 저장소', exact: true }).isDisabled(), true)
    const address = dialog.getByRole('textbox', { name: '프로젝트 경로' })
    await address.fill('/missing')
    await address.press('Enter')
    await dialog.getByRole('alert').waitFor()
    assert.equal(await dialog.getByRole('button', { name: '이 프로젝트 열기' }).isDisabled(), true)
    await address.fill('/home/test/mew')
    await address.press('Enter')
    await dialog.getByRole('button', { name: '이 프로젝트 열기' }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await page.evaluate('window.opened'), '/home/test/mew')
    // A shortcut navigates only; opening a chosen subfolder remains explicit.
    await page.evaluate('window.opened = null')
    await trigger.click()
    await dialog.getByRole('button', { name: 'OneDrive - Work 폴더로 이동' }).click()
    await dialog.getByRole('button', { name: 'work', exact: true }).waitFor()
    assert.equal(await address.inputValue(), '/cloud/OneDrive')
    assert.equal(await page.evaluate('window.opened'), null)
    await dialog.getByRole('button', { name: 'work', exact: true }).click()
    await dialog.getByRole('button', { name: '이 프로젝트 열기' }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await page.evaluate('window.opened'), '/cloud/OneDrive/work')
    cloudFolders.push({ provider: 'onedrive', name: 'OneDrive - Work', path: '/cloud/OtherDrive' })
    await trigger.click()
    const otherDrive = dialog.getByRole('button', { name: 'OneDrive - Work (/cloud/OtherDrive) 폴더로 이동', exact: true })
    await otherDrive.waitFor()
    assert.match(await otherDrive.innerText(), /\/cloud\/OtherDrive/)
    // Tab through every shortcut: the bounded list scrolls the focused item into view.
    const originalDrive = dialog.getByRole('button', { name: 'OneDrive - Work (/cloud/OneDrive) 폴더로 이동', exact: true })
    await originalDrive.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    const icloud = dialog.getByRole('button', { name: 'iCloud Drive 폴더로 이동' })
    assert.equal(await icloud.evaluate(el => el === el.ownerDocument.activeElement), true)
    assert.equal(await icloud.evaluate(el => {
      const bounds = el.getBoundingClientRect(), region = el.closest('section')!.getBoundingClientRect()
      return bounds.top >= region.top && bounds.bottom <= region.bottom
    }), true)
    await icloud.tap()
    await page.waitForFunction(`document.querySelector('input[aria-label="프로젝트 경로"]').value === '/cloud/iCloud'`)
    await otherDrive.tap()
    await page.waitForFunction(`document.querySelector('input[aria-label="프로젝트 경로"]').value === '/cloud/OtherDrive'`)
    await page.screenshot({ path: '/tmp/mew-project-duplicate-mobile.png' })
    await page.keyboard.press('Escape')
    cloudMode = 'failed'
    await trigger.click()
    await dialog.getByText('바로가기를 불러오지 못했습니다. 다시 찾기를 눌러 주세요.').waitFor()
    await dialog.getByRole('button', { name: 'mew Git' }).waitFor()
    cloudMode = 'empty'
    await dialog.getByRole('button', { name: '클라우드 폴더 다시 찾기' }).click()
    await dialog.getByRole('region', { name: '클라우드 폴더 바로가기' }).waitFor({ state: 'detached' })
    await page.keyboard.press('Escape')
    const rename = page.getByRole('button', { name: '이름 바꾸기' })
    await rename.click()
    const prompt = page.getByRole('dialog', { name: '이름 변경' })
    await prompt.getByRole('textbox').fill('after')
    await prompt.getByRole('textbox').press('Enter')
    await prompt.waitFor({ state: 'detached' })
    assert.equal(await page.evaluate('window.answer'), 'after')
    assert.equal(await rename.evaluate(el => el === el.ownerDocument.activeElement), true)
    await page.getByRole('button', { name: '삭제 확인' }).click()
    const confirm = page.getByRole('dialog', { name: '삭제할까요?' })
    assert.equal(await confirm.getByRole('button', { name: '취소' }).evaluate(el => el === el.ownerDocument.activeElement), true)
    await page.keyboard.press('Shift+Tab')
    assert.equal(await confirm.getByRole('button', { name: '삭제', exact: true }).evaluate(el => el === el.ownerDocument.activeElement), true)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await confirm.waitFor({ state: 'detached' })
    assert.equal(await page.evaluate('window.answer'), false)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
