import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from '../../server/browser-dom-executable.ts'
import { verifyDemoFeatureTasks } from '../../server/demo-feature-tasks-browser-flow.ts'
import { verifyDemoTerminal } from '../../server/demo-terminal-browser-flow.ts'
import { createDemoRepositorySource } from '../../tools/demo-snapshot.mjs'
import repositoryIndex from './repository-index.json' with { type: 'json' }
import { verifyDemoHost } from '../../server/demo-host-browser-flow.ts'

const root = path.resolve(import.meta.dirname, '../..')

test('the shared demo supports files, features, tasks, terminals, projects and reset without a backend', { skip: !domBrowserExecutable(), timeout: 120_000 }, async t => {
  const source = `import { initializeDemo } from ${JSON.stringify(path.join(root, 'src/demo/initialize.ts'))};
    const { store } = await initializeDemo(); globalThis.demoWorkspace = store;
    const { getAppRuntime } = await import(${JSON.stringify(path.join(root, 'src/runtime/app-runtime.ts'))});
    const transport = getAppRuntime().transport, fetch = transport.fetch.bind(transport);
    globalThis.demoRuntime = getAppRuntime();
    globalThis.demoFailedRequests = [];
    transport.fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (!response.ok) globalThis.demoFailedRequests.push({ input: String(input), method: init?.method ?? 'GET', body: init?.body, status: response.status, error: await response.clone().text() });
      return response;
    };
    await import(${JSON.stringify(path.join(root, 'src/main.tsx'))});`
  const bundle = await build({
    input: 'virtual:demo-test.tsx', write: false, platform: 'browser', output: { format: 'esm' },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'import.meta.hot': 'false', 'import.meta.env.BASE_URL': JSON.stringify('/demo/') } },
    plugins: [{ name: 'demo-browser-fixture', resolveId(id) {
      if (id === 'virtual:demo-test.tsx') return id
      if (id.endsWith('.css')) return 'virtual:style'
      if (/\.(?:png|webp|jpe?g|gif|woff2?)(?:\?url)?$/.test(id)) return 'virtual:image'
    }, async load(id) {
      if (id === 'virtual:demo-test.tsx') return source
      if (id === 'virtual:style') return ''
      if (id === 'virtual:image') return 'export default "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"'
      if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))
    } }],
  })
  const chunks = bundle.output.filter(item => item.type === 'chunk')
  const entry = chunks.find(item => item.isEntry)!
  const scripts = new Map(chunks.map(item => [`/demo/${item.fileName}`, item.code]))
  const styleSources: string[] = []
  for (const directory of ['src', 'packages']) {
    for (const file of await fs.readdir(path.join(root, directory), { recursive: true })) if (/\.(?:tsx|css)$/.test(file)) styleSources.push(path.join(root, directory, file))
  }
  const content = (await Promise.all(styleSources.map(file => fs.readFile(file, 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = [
    compiler.build([...new Set(content.match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))]),
    ...(await Promise.all(styleSources.filter(file => file.endsWith('.css') && file !== path.join(root, 'src/index.css')).sort().map(file => fs.readFile(file, 'utf8')))),
    await fs.readFile(new URL(import.meta.resolve('@xterm/xterm/css/xterm.css')), 'utf8'),
  ].join('\n')
  const repositorySource = createDemoRepositorySource(repositoryIndex, root)
  const screenshots = path.join(os.tmpdir(), 'mew-demo-review')
  await fs.mkdir(screenshots, { recursive: true })
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())

  for (const width of [1440, 390]) await t.test(`${width}px visitor has an isolated interactive workspace`, async () => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ko-KR' })
    const page = await context.newPage()
    page.setDefaultTimeout(12_000)
    const repositoryRequests: string[] = []
    const errors: string[] = [], leakedRequests: string[] = [], realSockets: string[] = [], consoleErrors: string[] = []
    page.on('pageerror', error => errors.push(error.stack ?? error.message))
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('websocket', socket => realSockets.push(socket.url()))
    await page.addInitScript(() => {
      if (window.top !== window) return
      localStorage.setItem('mew:demo-test-existing', 'preserve me')
      localStorage.setItem('mew:fonts', '{"ui":"Existing UI","markdown":"Existing document","mono":"Existing mono"}')
      localStorage.setItem('mew:shortcuts', '{"toggleMemo":"Ctrl+Alt+9"}')
      sessionStorage.setItem('mew:break-progress', 'existing progress')
    })
    await page.addInitScript(`globalThis.demoPeerConnections = 0; globalThis.RTCPeerConnection = new Proxy(RTCPeerConnection, { construct(target, args) { globalThis.demoPeerConnections++; return Reflect.construct(target, args); } });`)
    await page.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (scripts.has(url.pathname)) return route.fulfill({ contentType: 'text/javascript', body: scripts.get(url.pathname)! })
      const object = /^\/demo\/repository\/([a-f0-9]{64})\.(json|bin|svg|png|jpe?g|webp|pdf)$/.exec(url.pathname)
      if (object) {
        repositoryRequests.push(url.pathname)
        if (object[2] === 'json') return route.fulfill({ contentType: 'application/json', body: repositorySource.load(object[1]) })
        const raw = repositorySource.loadRaw(object[1])
        return route.fulfill({ contentType: object[2] === 'bin' ? 'application/octet-stream' : raw.contentType, body: raw.bytes })
      }

      if (/^\/demo\/mewcat\/capybara\/[\w-]+\.webp$/.test(url.pathname)) return route.fulfill({ contentType: 'image/webp', body: await fs.readFile(path.join(root, 'public', url.pathname.slice('/demo/'.length))) })
      if (/^\/demo\/fonts\/ibm-plex\/[\w.-]+\.(?:css|woff2?|ttf)$/.test(url.pathname)) return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'font/woff2', body: await fs.readFile(path.join(root, 'public', url.pathname.slice('/demo/'.length))) })
      if (url.origin === 'https://mew-demo.test' && url.pathname === '/demo/') {
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="ko" class="dark"><meta charset="utf-8"><meta name="mew-demo-app" content="1"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/demo/fonts/ibm-plex/fonts.css"><style>${css}</style><div id="root"></div><script type="module" src="/demo/${entry.fileName}"></script></html>` })
      }
      if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue()
      leakedRequests.push(route.request().method() + ' ' + url.href)
      return route.fulfill({ status: 404, body: 'Unexpected network request' })
    })
    try {
      await page.goto('https://mew-demo.test/demo/', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-runtime-controls]').waitFor()
      assert.equal(new URL(page.url()).pathname, '/demo/')
      if (width === 390) await page.locator('.mobile-dock [data-dock-item="editor"]').click()
      const editor = page.locator('.ProseMirror[contenteditable="true"]:visible').first()
      await editor.waitFor()
      assert.equal(repositoryRequests.length, 0, 'initial workspace must not fetch lazy file contents')
      const initialFileCount = await page.evaluate<number>('globalThis.demoWorkspace.fileMetadata().length')
      assert.ok(initialFileCount > 1900)
      const lazyText = 'server/serve.ts'
      const lazyContent = await page.evaluate<string>(`globalThis.demoRuntime.transport.fetch('/api/file?path=${lazyText}').then(response => response.json()).then(file => file.content)`)
      assert.match(lazyContent, /import /)
      assert.equal(repositoryRequests.length, 1, 'opening one source file requests one object')
      await page.evaluate(`globalThis.demoRuntime.transport.fetch('/api/file?path=${lazyText}').then(response => response.text())`)
      assert.equal(repositoryRequests.length, 1, 'reopening a cached file requests no object')
      assert.deepEqual(await page.evaluate('globalThis.demoWorkspace.gitWorkingTree().files'), [])

      await editor.press('Control+End')
      await editor.press('Enter')
      await page.keyboard.insertText('내 데모 메모를 저장합니다.')
      await page.waitForFunction(`globalThis.demoWorkspace.readFile('docs/welcome.md').content.includes('내 데모 메모를 저장합니다.')`)
      assert.equal(await page.evaluate(`globalThis.demoWorkspace.gitWorkingTree().files.some(file => file.path === 'docs/welcome.md')`), true)
      await page.evaluate(`window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))`)
      assert.equal(await page.evaluate(`globalThis.demoWorkspace.readFile('docs/welcome.md').content.includes('내 데모 메모를 저장합니다.')`), true)

      if (width === 390) await page.locator('.mobile-dock [data-dock-item="sidebar"]').click()
      const sidebar = page.locator('[data-sidebar]')
      await sidebar.getByRole('button', { name: '새 문서', exact: true }).click()
      const newDocument = sidebar.getByPlaceholder('새 문서 이름', { exact: true })
      await newDocument.fill('나의 데모 문서')
      await newDocument.press('Enter')
      await newDocument.waitFor({ state: 'detached' })
      await page.waitForFunction(`globalThis.demoWorkspace.readFile('docs/나의 데모 문서.md').content.includes('나의 데모 문서')`)
      if (width === 390) await page.locator('.mobile-dock [data-dock-item="editor"]').click()
      await editor.waitFor()
      await editor.press('Control+End')
      await page.keyboard.insertText('Documents에서도 자동저장합니다.')
      await page.waitForFunction(`globalThis.demoWorkspace.readFile('docs/나의 데모 문서.md').content.includes('Documents에서도 자동저장합니다.')`)
      if (width === 390) await page.locator('.mobile-dock [data-dock-item="sidebar"]').click()
      await sidebar.locator('[data-document-page="나의 데모 문서.md"]').waitFor()
      await page.locator('[data-explorer-toggle]').getByRole('button', { name: '파일', exact: true }).click()
      await sidebar.getByRole('button', { name: '새 파일', exact: true }).click()
      const newFile = sidebar.getByPlaceholder('새 파일 이름', { exact: true })
      await newFile.fill('my-demo.md')
      await newFile.press('Enter')
      await newFile.waitFor({ state: 'detached' })
      await page.waitForFunction(`globalThis.demoWorkspace.fileEntries().some(file => file.path === 'my-demo.md')`)
      if (width === 390) await page.locator('.mobile-dock [data-dock-item="editor"]').click()
      await editor.waitFor()
      await editor.press('Control+End')
      await editor.press('Enter')
      await page.keyboard.insertText('새 파일에서도 자동저장합니다.')
      await page.waitForFunction(`globalThis.demoWorkspace.readFile('my-demo.md').content.includes('새 파일에서도 자동저장합니다.')`)
      if (width === 390) await page.locator('.mobile-dock [data-dock-item="sidebar"]').click()
      await sidebar.locator('[data-path="my-demo.md"]').waitFor()
      assert.equal(await page.evaluate(`globalThis.demoWorkspace.gitWorkingTree().files.some(file => file.path === 'my-demo.md' && file.status === '?')`), true)

      if (width === 390) await page.locator('.mobile-dock').getByRole('button', { name: '에이전트', exact: true }).click()
      const composer = page.locator('[data-agent-composer] [contenteditable="true"]').first()
      await composer.fill('Mew 데모 문서를 정리해 주세요')
      await page.getByRole('button', { name: '전송', exact: true }).click()
      await page.waitForFunction(`globalThis.demoWorkspace.readFile('docs/welcome.md').content.includes('에이전트와 정리한 다음 단계')`)

      if (width === 390) await page.locator('.mobile-dock [data-dock-item="git"]').click()
      await page.getByText('docs/welcome.md', { exact: true }).first().waitFor()
      await page.evaluate('document.fonts.ready')
      await page.screenshot({ path: path.join(screenshots, width === 1440 ? 'desktop.png' : 'mobile.png'), fullPage: true })
      assert.deepEqual(errors, [])
      assert.deepEqual(consoleErrors.filter(message => /Hotview failed|tiptap error/.test(message)), [])
      assert.deepEqual(realSockets, [])
      assert.deepEqual(leakedRequests, [])
      assert.equal(await page.evaluate(`localStorage.getItem('mew:demo-test-existing')`), 'preserve me')
      assert.equal(await page.evaluate(`JSON.parse(localStorage.getItem('mew:fonts')).ui`), 'Existing UI')
      assert.equal(await page.evaluate(`localStorage.getItem('mew:shortcuts')`), '{"toggleMemo":"Ctrl+Alt+9"}')
      assert.equal(await page.evaluate(`sessionStorage.getItem('mew:break-progress')`), 'existing progress')
      assert.deepEqual(await page.evaluate(`indexedDB.databases().then(items => items.map(item => item.name))`), [])

      await verifyDemoTerminal(page, width)
      await verifyDemoFeatureTasks(page, width)
      await verifyDemoHost(page, width, screenshots)

      await page.locator('[data-project-switcher]').click()
      await page.getByRole('menu', { name: '프로젝트 선택', exact: true }).getByRole('menuitem', { name: '프로젝트 추가', exact: true }).click()
      const projectDialog = page.getByRole('dialog', { name: '새 프로젝트 열기', exact: true })
      await projectDialog.getByRole('button', { name: '새 폴더', exact: true }).click()
      const projectName = projectDialog.getByRole('textbox', { name: '폴더 이름', exact: true })
      await projectName.fill('My demo project')
      await projectName.press('Enter')
      await projectDialog.getByRole('button', { name: 'My demo project', exact: true }).click()
      await projectDialog.getByRole('button', { name: '이 프로젝트 열기', exact: true }).click()
      await projectDialog.waitFor({ state: 'detached' })
      await page.waitForFunction(`globalThis.demoWorkspace.workspaceInfo().path.endsWith('/My demo project')`)
      assert.match(await page.evaluate(`globalThis.demoWorkspace.readFile('README.md').content`), /^# mew : my easy workspace/)
      assert.equal(await page.evaluate(`globalThis.demoWorkspace.workspaceInfo().docsPath.endsWith('/My demo project/docs')`), true)
      await page.locator('[data-project-switcher]').click()
      await page.locator('[data-project-option="/demo/mew-playground"]').click()
      await page.waitForFunction(`globalThis.demoWorkspace.workspaceInfo().path === '/demo/mew-playground'`)
      assert.equal(await page.evaluate(`globalThis.demoWorkspace.readFile('my-demo.md').content.includes('새 파일에서도 자동저장합니다.')`), true)
      assert.deepEqual(errors, [])
      assert.deepEqual(leakedRequests, [])
      assert.deepEqual(realSockets, [])
      assert.deepEqual(await page.evaluate('globalThis.demoFailedRequests'), [])
      assert.equal(await page.evaluate('globalThis.demoPeerConnections'), 0)

      await page.getByRole('button', { name: 'Demo 초기화', exact: true }).click()
      await page.locator('[data-runtime-controls]').waitFor()
      await page.waitForFunction(`globalThis.demoWorkspace && !globalThis.demoWorkspace.readFile('docs/welcome.md').content.includes('내 데모 메모를 저장합니다.')`)
      assert.equal(await page.evaluate(`globalThis.demoWorkspace.gitWorkingTree().files.length`), 0)
      assert.deepEqual(errors, [])
    } catch (error) {
      await page.screenshot({ path: path.join(screenshots, `failure-${width}.png`), fullPage: true })
      t.diagnostic(JSON.stringify({ errors, consoleErrors, leakedRequests, failedRequests: await page.evaluate('globalThis.demoFailedRequests'), body: (await page.locator('body').innerText()).slice(0, 6000) }))
      throw error
    } finally { await context.close() }
  })
})
