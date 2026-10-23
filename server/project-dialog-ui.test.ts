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
import {ServerFileExplorer} from '${root}/src/components/ServerFileExplorer.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {useDialog} from '${root}/packages/ui/src/use-dialog.tsx';
localStorage.setItem('mew:locale',new URL(location.href).searchParams.get('locale')||'ko');
function Fixture(){const [open,setOpen]=useState(false);const [explorer,setExplorer]=useState(false);const dialogs=useDialog();return <><button onClick={()=>setExplorer(true)}>파일 탐색</button>{explorer&&<ServerFileExplorer isOwner={false} onClose={()=>setExplorer(false)} onOpenFile={p=>window.openedFile=p} onRenamed={(...args)=>window.renamed=args} onDeleted={(...args)=>window.deleted=args}/>}<button onClick={()=>setOpen(true)}>프로젝트 추가</button><button onClick={async()=>{window.answer=await dialogs.prompt({message:'이름 변경',defaultValue:'before',confirmLabel:'저장'})}}>이름 바꾸기</button><button onClick={async()=>{window.answer=await dialogs.confirm({message:'삭제할까요?',danger:true,confirmLabel:'삭제'})}}>삭제 확인</button>{dialogs.dialog}{open&&<OpenProjectDialog basePath='/home/test' onClose={()=>setOpen(false)} onOpen={p=>{window.opened=p;setOpen(false)}}/>}</>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:project.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:project.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:project.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const files = ['src/components/file-action-menu.tsx', 'src/hooks/use-external-file-actions.tsx', 'src/components/file-browser.tsx', 'src/components/ServerFileExplorer.tsx', 'src/components/OpenProjectDialog.tsx', 'src/components/file-browser-favorites.tsx', 'packages/ui/src/dialog-frame.tsx', 'packages/ui/src/ConfirmDialog.tsx', 'packages/ui/src/prompt-dialog.tsx']
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
    let externalFile = 'readme.txt'
    let externalDirectory = '/home/test/mew'
    let externalExists = true
    const browsed: string[] = []
    let cloudMode: 'found' | 'empty' | 'failed' = 'found'
    const favoriteAdds = new Set<string>()
    const favoriteHidden = new Set<string>()
    let failFavoriteSave = false
    let directoryCreated = false
    let failDirectory = false
    const cloudFolders = [
      { provider: 'onedrive', name: 'OneDrive - Work', path: '/cloud/OneDrive' },
      { provider: 'google-drive', name: 'GoogleDrive-person@example.test', path: '/cloud/GoogleDrive' },
      { provider: 'icloud', name: 'iCloud Drive', path: '/cloud/iCloud' },
    ]
    await context.route('http://mew-project.test/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/fs/favorites') {
        if (route.request().method() === 'PUT') {
          if (failFavoriteSave) return route.fulfill({ status: 503, json: { error: 'Save failed' } })
          const { path: folder, favorite } = route.request().postDataJSON()
          if (favorite) { favoriteAdds.add(folder); favoriteHidden.delete(folder) }
          else { favoriteAdds.delete(folder); favoriteHidden.add(folder) }
          return route.fulfill({ json: { ok: true } })
        }
        if (cloudMode === 'failed') return route.fulfill({ status: 503, json: { error: 'Unavailable' } })
        const defaults = cloudMode === 'empty' ? [] : [{ path: '/home/test', name: 'test', kind: 'home' }, ...cloudFolders.map(folder => ({ ...folder, kind: 'cloud' }))]
        const folders = defaults.filter(folder => !favoriteHidden.has(folder.path))
        for (const folder of favoriteAdds) if (!folders.some(item => item.path === folder)) folders.push({ path: folder, name: folder.split('/').at(-1)!, kind: 'custom' })
        return route.fulfill({ json: { folders } })
      }
      if (url.pathname === '/api/fs/download') return route.fulfill({ headers: { 'Content-Disposition': 'attachment; filename=readme.txt' }, contentType: 'text/plain', body: 'example' })
      if (url.pathname === '/api/agent-cwd/suggestions') return route.fulfill({ json: { dirs: [{ name: 'mew', path: '/home/test/mew' }] } })
      if (url.pathname === '/api/fs/entries') {
        const current = url.searchParams.get('path') || '/home/test'
        browsed.push(current)
        if (current === '/home/test/new-parent/new-project' && !directoryCreated) return route.fulfill({ status: 404, json: { error: 'Missing directory', code: 'MISSING_DIRECTORY', missing: { path: current, existingPath: '/home/test', missingName: 'new-parent' } } })
        if (current === '/missing') return route.fulfill({ status: 404, json: { error: '폴더를 찾을 수 없습니다' } })
        const entries = current === '/home/test' ? names.map((name, i) => ({ name, path: `${current}/${name}`, type: 'dir', git: i === 0, size: null })) : []
        if (current === externalDirectory && externalExists) entries.push({ name: externalFile, path: `${current}/${externalFile}`, type: 'file', git: false, size: null })
        if (current === '/cloud/OneDrive') entries.push({ name: 'work', path: '/cloud/OneDrive/work', type: 'dir', git: false, size: null })
        if (initialized) entries.push({ name: '.git', path: `${current}/.git`, type: 'dir', git: false, size: null })
        return route.fulfill({ json: { path: current, parent: current === '/' ? null : '/home/test', entries } })
      }
      if (url.pathname === '/api/fs/path' && route.request().method() === 'DELETE') {
        externalExists = false
        return route.fulfill({ json: { ok: true } })
      }
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        mutations.push({ endpoint: url.pathname, body })
        if (url.pathname === '/api/fs/directory') {
          if (failDirectory) return route.fulfill({ status: 403, json: { error: 'Creation denied' } })
          directoryCreated = true
          return route.fulfill({ json: { ok: true, path: body.path } })
        }
        if (url.pathname === '/api/fs/paste') {
          if (body.mode === 'cut') externalDirectory = body.destination
          return route.fulfill({ json: { ok: true, path: `${body.destination}/${body.source.split('/').at(-1)}` } })
        }
        if (url.pathname === '/api/fs/folder' && failFolder) { failFolder = false; return route.fulfill({ status: 409, json: { error: '이미 존재하는 폴더입니다' } }) }
        if (url.pathname === '/api/fs/git/clone') await new Promise<void>(resolve => { releaseClone = resolve })
        if (url.pathname === '/api/fs/git/init') initialized = true
        if (url.pathname === '/api/fs/rename') { externalFile = body.name; return route.fulfill({ json: { ok: true, path: `/home/test/mew/${externalFile}` } }) }
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
    const openFavorites = async (owner: typeof dialog) => {
      const button = owner.getByRole('button', { name: '즐겨찾기', exact: true })
      if (await button.getAttribute('aria-expanded') !== 'true') await button.click()
    }
    for (const [width, dark] of [[1200, true], [390, true], [1200, false], [390, false]] as const) {
      await page.setViewportSize({ width, height: 850 })
      await page.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`)
      await trigger.click()
      await dialog.getByRole('button', { name: 'mew Git' }).waitFor()
      assert.equal(await dialog.getByRole('textbox', { name: '프로젝트 경로' }).evaluate(el => el === el.ownerDocument.activeElement), false)
      assert.equal(await dialog.getByRole('heading', { name: '새 프로젝트 열기' }).evaluate(el => el === el.ownerDocument.activeElement), true)
      assert.equal(await dialog.getByRole('button', { name: 'OneDrive - Work 폴더로 이동' }).count(), 0)
      await openFavorites(dialog)
      await dialog.getByRole('button', { name: 'OneDrive - Work 폴더로 이동' }).waitFor()
      const dropdown = dialog.getByRole('group', { name: '즐겨찾기', exact: true })
      const dropdownBox = await dropdown.boundingBox()
      assert.ok(dropdownBox && dropdownBox.x >= 0 && dropdownBox.x + dropdownBox.width <= width && dropdownBox.y + dropdownBox.height <= 850)
      await page.screenshot({ path: `/tmp/mew-favorites-${width}-${dark ? 'dark' : 'light'}.png` })
      await page.keyboard.press('End')
      assert.equal(await dropdown.getByRole('button').last().evaluate(el => el === el.ownerDocument.activeElement), true)
      await page.keyboard.press('Home')
      assert.equal(await dropdown.getByRole('button').first().evaluate(el => el === el.ownerDocument.activeElement), true)
      await page.keyboard.press('Escape')
      await dropdown.waitFor({ state: 'detached' })
      await openFavorites(dialog)
      await page.evaluate('history.back()')
      await dropdown.waitFor({ state: 'detached' })
      await openFavorites(dialog)
      await page.mouse.click(2, 2)
      await dropdown.waitFor({ state: 'detached' })
      assert.equal(await dialog.count(), 1)
      const box = await dialog.boundingBox()
      assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.height < 850)
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true)
      await dialog.getByRole('button', { name: 'mew Git', exact: true }).click({ button: 'right' })
      const menu = dialog.locator('[data-file-action-menu]')
      await menu.waitFor()
      for (const label of ['복사', '잘라내기', '붙여넣기', '삭제', '이름 변경', '즐겨찾기로 추가']) assert.equal(await menu.getByRole('menuitem', { name: label, exact: true }).count(), 1)
      assert.equal(await menu.getByRole('menuitem', { name: '붙여넣기', exact: true }).isDisabled(), true)
      const menuBounds = await menu.boundingBox()
      assert.ok(menuBounds && menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= width && menuBounds.y + menuBounds.height <= 850)
      await page.screenshot({ path: `/tmp/mew-project-menu-${width}-${dark ? 'dark' : 'light'}.png` })
      await page.keyboard.press('Escape')
      await menu.waitFor({ state: 'detached' })
      assert.equal(await dialog.count(), 1)
      await dialog.getByRole('button', { name: 'mew Git', exact: true }).click({ button: 'right' })
      await dialog.getByRole('button', { name: 'sleeeep', exact: true }).click({ position: { x: 8, y: 10 } })
      await menu.waitFor({ state: 'detached' })
      assert.equal(await dialog.getByRole('textbox', { name: '프로젝트 경로' }).inputValue(), '/home/test', 'outside dismissal does not navigate underneath')

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
    await address.fill('/home/test/new-parent/new-project')
    await address.press('Enter')
    const createPath = page.getByRole('dialog', { name: '/home/test에 new-parent가 없습니다. 경로를 생성할까요?', exact: true })
    await createPath.waitFor()
    assert.equal(mutations.filter(item => item.endpoint === '/api/fs/directory').length, 0)
    await page.keyboard.press('Escape')
    await createPath.waitFor({ state: 'detached' })
    assert.equal(await dialog.count(), 1)
    assert.equal(await address.inputValue(), '/home/test/new-parent/new-project')
    await address.press('Enter'); await createPath.waitFor()
    failDirectory = true
    await createPath.getByRole('button', { name: '경로 생성', exact: true }).click()
    await dialog.getByRole('alert').filter({ hasText: 'Creation denied' }).waitFor()
    failDirectory = false
    await address.press('Enter'); await createPath.waitFor()
    await createPath.getByRole('button', { name: '경로 생성', exact: true }).click()
    await page.waitForFunction(`document.querySelector('input[aria-label="프로젝트 경로"]').value === '/home/test/new-parent/new-project' && !document.querySelector('[role=alert]')`)
    assert.deepEqual(mutations.at(-1), { endpoint: '/api/fs/directory', body: { path: '/home/test/new-parent/new-project' } })
    assert.equal(await page.evaluate('window.opened'), undefined, 'creation only navigates; project opening is explicit')
    await address.fill('/home/test/mew')
    await address.press('Enter')
    await dialog.getByRole('button', { name: '이 프로젝트 열기' }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await page.evaluate('window.opened'), '/home/test/mew')
    // A shortcut navigates only; opening a chosen subfolder remains explicit.
    await page.evaluate('window.opened = null')
    await trigger.click()
    await openFavorites(dialog)
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
    await openFavorites(dialog)
    await otherDrive.waitFor()
    assert.match(await otherDrive.innerText(), /\/cloud\/OtherDrive/)
    // Tab through every shortcut: the bounded list scrolls the focused item into view.
    const originalDrive = dialog.getByRole('button', { name: 'OneDrive - Work (/cloud/OneDrive) 폴더로 이동', exact: true })
    await originalDrive.focus()
    for (let index = 0; index < 4; index++) await page.keyboard.press('Tab')
    const icloud = dialog.getByRole('button', { name: 'iCloud Drive 폴더로 이동' })
    assert.equal(await icloud.evaluate(el => el === el.ownerDocument.activeElement), true)
    assert.equal(await icloud.evaluate(el => {
      const bounds = el.getBoundingClientRect(), region = el.closest('[role=group]')!.getBoundingClientRect()
      return bounds.top >= region.top && bounds.bottom <= region.bottom
    }), true)
    await icloud.tap()
    await page.waitForFunction(`document.querySelector('input[aria-label="프로젝트 경로"]').value === '/cloud/iCloud'`)
    await openFavorites(dialog)
    await otherDrive.tap()
    await page.waitForFunction(`document.querySelector('input[aria-label="프로젝트 경로"]').value === '/cloud/OtherDrive'`)
    await page.screenshot({ path: '/tmp/mew-project-duplicate-mobile.png' })
    await page.keyboard.press('Escape')
    cloudMode = 'failed'
    await trigger.click()
    await dialog.getByRole('alert').filter({ hasText: '즐겨찾기를 불러오거나 저장하지 못했습니다.' }).waitFor()
    await dialog.getByRole('button', { name: 'mew Git' }).waitFor()
    cloudMode = 'empty'
    await dialog.getByRole('button', { name: '즐겨찾기 새로고침' }).click()
    await openFavorites(dialog)
    await dialog.getByText('자주 쓰는 폴더를 추가하세요.', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
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
    cloudMode = 'found'
    await trigger.click()
    await dialog.getByRole('button', { name: 'mew Git', exact: true }).waitFor()
    await dialog.getByRole('button', { name: 'sleeeep', exact: true }).click({ button: 'right' })
    await dialog.getByRole('menuitem', { name: '즐겨찾기로 추가', exact: true }).click()
    await openFavorites(dialog)
    await dialog.getByRole('button', { name: 'sleeeep 폴더로 이동', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await address.inputValue(), '/home/test', 'adding a favorite does not navigate or open a project')

    await address.fill('/home/test/mew')
    await address.press('Enter')
    await dialog.getByRole('button', { name: '현재 폴더를 즐겨찾기에 추가', exact: true }).click()
    await openFavorites(dialog)
    await dialog.getByRole('button', { name: 'mew 폴더로 이동', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    const explorerTrigger = page.getByRole('button', { name: '파일 탐색', exact: true })
    const explorer = page.getByRole('dialog', { name: '서버 파일 탐색기' })
    const browseCount = browsed.filter(item => item === '/home/test/mew').length
    for (const [width, dark] of [[1200, true], [390, true], [1200, false], [390, false]] as const) {
      await page.setViewportSize({ width, height: 850 })
      await page.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`)
      await explorerTrigger.click()
      await explorer.getByRole('button', { name: 'mew Git', exact: true }).waitFor()
      assert.equal(await explorer.evaluate(el => el.scrollWidth <= el.clientWidth), true)
      const box = await explorer.boundingBox()
      assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.height < 850)
      await page.screenshot({ path: `/tmp/mew-explorer-${width}-${dark ? 'dark' : 'light'}.png` })
      await page.keyboard.press('Escape')
      await explorer.waitFor({ state: 'detached' })
      assert.equal(await explorerTrigger.evaluate(el => el === el.ownerDocument.activeElement), true)
    }
    assert.equal(browsed.filter(item => item === '/home/test/mew').length, browseCount, 'closed folders are not preloaded')
    await explorerTrigger.click()
    const favorites = explorer
    await openFavorites(explorer)
    await favorites.getByRole('button', { name: 'mew 폴더로 이동', exact: true }).waitFor()
    const favoritesBox = await explorer.getByRole('region', { name: '즐겨찾기', exact: true }).boundingBox()
    const addressBox = await explorer.getByRole('textbox', { name: '서버 경로 입력', exact: true }).boundingBox()
    assert.ok(favoritesBox && addressBox && favoritesBox.y + favoritesBox.height <= addressBox.y, 'favorites are above the address bar')
    failFavoriteSave = true
    await favorites.getByRole('button', { name: 'mew 즐겨찾기 제거', exact: true }).click()
    await favorites.getByRole('alert').waitFor()
    await openFavorites(explorer)
    assert.equal(await favorites.getByRole('button', { name: 'mew 폴더로 이동', exact: true }).count(), 1)
    failFavoriteSave = false
    await favorites.getByRole('button', { name: 'mew 즐겨찾기 제거', exact: true }).click()
    await favorites.getByRole('button', { name: 'mew 폴더로 이동', exact: true }).waitFor({ state: 'detached' })
    await openFavorites(explorer)
    await favorites.getByRole('button', { name: '홈 즐겨찾기 제거', exact: true }).click()
    await favorites.getByRole('button', { name: '홈 폴더로 이동', exact: true }).waitFor({ state: 'detached' })
    await page.keyboard.press('Escape')
    await explorerTrigger.click()
    await openFavorites(explorer)
    await favorites.getByRole('button', { name: 'iCloud Drive 폴더로 이동', exact: true }).waitFor()
    assert.equal(await favorites.getByRole('button', { name: '홈 폴더로 이동', exact: true }).count(), 0)
    assert.equal(await favorites.getByRole('button', { name: 'mew 폴더로 이동', exact: true }).count(), 0)
    await page.keyboard.press('Escape')
    const folder = explorer.getByRole('button', { name: 'mew Git', exact: true })
    // Touch hold uses the same menu and must not expand the directory on release.
    const point = await folder.boundingBox()
    assert.ok(point)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x + 20, y: point.y + point.height / 2, id: 1 }] })
    await explorer.getByRole('menuitem', { name: '즐겨찾기로 추가', exact: true }).waitFor()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    assert.equal(await folder.getAttribute('aria-expanded'), 'false')
    await explorer.getByRole('menuitem', { name: '즐겨찾기로 추가', exact: true }).click()
    await openFavorites(explorer)
    await favorites.getByRole('button', { name: 'mew 폴더로 이동', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await folder.click()
    const file = explorer.getByRole('button', { name: 'readme.txt', exact: true })
    await file.waitFor()
    assert.equal(await folder.getAttribute('aria-expanded'), 'true')
    await file.click({ button: 'right' })
    assert.equal(await explorer.getByRole('menuitem', { name: '즐겨찾기로 추가', exact: true }).count(), 0)
    assert.equal(await explorer.getByRole('menuitem', { name: '프로젝트로 열기', exact: true }).count(), 0)
    const [download] = await Promise.all([page.waitForEvent('download'), explorer.getByRole('menuitem', { name: '다운로드', exact: true }).click()])
    assert.equal(download.suggestedFilename(), 'readme.txt')
    await file.click({ button: 'right' })
    await explorer.getByRole('menuitem', { name: '이름 변경', exact: true }).click()
    const renameFile = page.getByRole('dialog', { name: '새 이름', exact: true })
    await renameFile.getByRole('textbox').fill('renamed.txt')
    await renameFile.getByRole('button', { name: '저장', exact: true }).click()
    const renamedFile = explorer.getByRole('button', { name: 'renamed.txt', exact: true })
    await renamedFile.waitFor()
    assert.deepEqual(await page.evaluate('window.renamed'), ['/home/test/mew/readme.txt', '/home/test/mew/renamed.txt', 'file'])
    await renamedFile.click({ button: 'right' })
    await explorer.getByRole('menuitem', { name: '복사', exact: true }).click()
    await renamedFile.click({ button: 'right' })
    assert.equal(await explorer.getByRole('menuitem', { name: '프로젝트로 열기', exact: true }).count(), 0)
    await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/fs/paste')), explorer.getByRole('menuitem', { name: '붙여넣기', exact: true }).click()])
    assert.deepEqual(mutations.at(-1)?.body, { source: '/home/test/mew/renamed.txt', destination: '/home/test/mew', mode: 'copy' })
    await renamedFile.click({ button: 'right' })
    await explorer.getByRole('menuitem', { name: '삭제', exact: true }).click()
    const deleteFile = page.getByRole('dialog', { name: '이 경로를 삭제할까요?', exact: true })
    await deleteFile.getByRole('button', { name: '취소', exact: true }).click()
    await renamedFile.waitFor()
    const filter = explorer.getByRole('textbox', { name: '이름으로 필터', exact: true })
    await filter.fill('zzz')
    await explorer.getByText('일치하는 항목이 없습니다', { exact: true }).waitFor()
    await filter.fill('')
    const serverAddress = explorer.getByRole('textbox', { name: '서버 경로 입력', exact: true })
    await serverAddress.fill('/missing')
    await serverAddress.press('Enter')
    await explorer.getByRole('alert').waitFor()
    await serverAddress.fill('/home/test/mew')
    await serverAddress.press('Enter')
    await renamedFile.waitFor()
    await renamedFile.click()
    await explorer.waitFor({ state: 'detached' })
    assert.equal(await page.evaluate('window.openedFile'), '/home/test/mew/renamed.txt')
    await explorerTrigger.click()
    await folder.click()
    await renamedFile.waitFor()
    const destination = explorer.getByRole('button', { name: 'sleeeep', exact: true })
    await destination.click()
    await renamedFile.click({ button: 'right' })
    await explorer.getByRole('menuitem', { name: '잘라내기', exact: true }).click()
    await destination.click({ button: 'right' })
    await explorer.getByRole('menuitem', { name: '붙여넣기', exact: true }).click()
    const moved = explorer.locator('button[title="/home/test/sleeeep/renamed.txt"]')
    await moved.waitFor()
    assert.equal(await explorer.locator('button[title="/home/test/mew/renamed.txt"]').count(), 0)
    assert.deepEqual(await page.evaluate('window.renamed'), ['/home/test/mew/renamed.txt', '/home/test/sleeeep/renamed.txt', 'file'])
    await destination.click({ button: 'right' })
    assert.equal(await explorer.getByRole('menuitem', { name: '붙여넣기', exact: true }).isDisabled(), true)
    await page.keyboard.press('Escape')
    await moved.click({ button: 'right' })
    await explorer.getByRole('menuitem', { name: '삭제', exact: true }).click()
    await page.getByRole('dialog', { name: '이 경로를 삭제할까요?', exact: true }).getByRole('button', { name: '삭제', exact: true }).click()
    await moved.waitFor({ state: 'detached' })
    assert.deepEqual(await page.evaluate('window.deleted'), ['/home/test/sleeeep/renamed.txt', 'file'])

    directoryCreated = false
    const directoryWrites = mutations.filter(item => item.endpoint === '/api/fs/directory').length
    for (const [locale, message, label] of [
      ['ko', '/home/test에 new-parent가 없습니다. 경로를 생성할까요?', '경로 생성'],
      ['en', 'new-parent does not exist in /home/test. Create the path?', 'Create path'],
      ['zh-CN', '/home/test 中不存在 new-parent。要创建此路径吗？', '创建路径'],
      ['ja', '/home/test に new-parent がありません。パスを作成しますか？', 'パスを作成'],
    ]) {
      const localized = await context.newPage()
      localized.setDefaultTimeout(4000)
      await localized.setViewportSize({ width: 320, height: 640 })
      await localized.goto(`http://mew-project.test/?locale=${locale}`)
      await localized.getByRole('button', { name: '프로젝트 추가', exact: true }).click()
      const panel = localized.getByRole('dialog')
      await panel.getByRole('button', { name: 'mew Git', exact: true }).waitFor()
      const pathField = panel.getByRole('textbox').first()
      await pathField.fill('/home/test/new-parent/new-project'); await pathField.press('Enter')
      const question = localized.getByRole('dialog', { name: message, exact: true })
      await question.getByRole('button', { name: label, exact: true }).waitFor()
      assert.match(await question.innerText(), /\/home\/test\/new-parent\/new-project/)
      const bounds = await question.boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 320)
      await localized.screenshot({ path: `/tmp/mew-create-path-${locale}.png` })
      await localized.keyboard.press('Escape'); await question.waitFor({ state: 'detached' })
      assert.equal(await localized.getByRole('dialog').count(), 1)
      await localized.close()
    }
    assert.equal(mutations.filter(item => item.endpoint === '/api/fs/directory').length, directoryWrites, 'dismissing translated confirmations never creates a path')
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
