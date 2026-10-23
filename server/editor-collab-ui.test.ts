import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const content = '---\ntitle: "문서 테스트"\n---\n\n# File content\n\nSelected file body\n\n[문서](guides/editor.md)\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'

test('Markdown failures stay inside the document and recover through Plain or another file', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const source = `
import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {I18nProvider} from ${JSON.stringify(new URL('../src/i18n.tsx', import.meta.url).pathname)};
import {EditorPane} from ${JSON.stringify(new URL('../src/components/EditorPane.tsx', import.meta.url).pathname)};
import {DockWorkspace,DockPanel} from ${JSON.stringify(new URL('../src/components/DockWorkspace.tsx', import.meta.url).pathname)};
import {useTabs} from ${JSON.stringify(new URL('../src/hooks/useTabs.ts', import.meta.url).pathname)};
const noop=()=>{};
const callbacks=Object.fromEntries(['registerHandle','registerElement','registerTabBar','onFocus','onActivate','onPin','onCloseTab','onReorder','onSetViewMode','onChangeContent','onOpenLink','onOpenHistory','onSetTocOpen','onOpenSidebar','onTabDragMove','onTabDrop'].map(key=>[key,noop]));
function Fixture(){
  const tabs=useTabs('docs',noop,noop,'/fixture');
  const [dock,setDock]=React.useState(null);
  window.tabs=tabs;
  return <><nav aria-label="Documents">{['first.md','second.md','broken.md','broken-effect.md','broken-direct.md'].map(path=><button key={path} onClick={()=>tabs.openFile(path)}>{path}</button>)}</nav>
    <DockWorkspace value={dock} onChange={setDock} foreground="editor" apiRef={null} onEditorDrop={()=>'main'}>
      <DockPanel id="editor:main" kind="editor" tabs={tabs.panes[0].tabs.map(t=>t.path)}>
        <EditorPane {...callbacks} onChangeContent={tabs.updateTabContent} onSetViewMode={tabs.setTabViewMode} pane={tabs.panes[0]} role="owner" authEmail="owner@example.test" project="docs" tree={[]} presence={{}} focused isGuest={false} showSidebarButton={false} tocOpen={false} dropZone={null}/>
      </DockPanel>
    </DockWorkspace></>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
  const bundle = await build({
    input: 'virtual:editor-recovery.tsx', write: false, platform: 'browser', output: { format: 'esm', codeSplitting: false },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{
      name: 'editor-recovery-fixture',
      resolveId(id) {
        if (id === 'virtual:editor-recovery.tsx') return id
        if (id.endsWith('.css')) return 'virtual:style'
      },
      load(id) {
        if (id === 'virtual:editor-recovery.tsx') return source
        if (id === 'virtual:style') return ''
      },
      transform(code, id) {
        if (!id.endsWith('/packages/editor/src/Editor.tsx')) return
        // Exercise both render failures and editor initialization effect failures in the real tree.
        const anchor = '  const { frontmatter, body, lineNumbers: frontmatterLineNumbers } = useMemo('
        assert.ok(code.includes(anchor))
        return code.replace(anchor, `
  useEffect(() => { if (path === 'broken-effect.md') throw new Error('fixture initialization failure') }, [path])
  if (path === 'broken.md' || path === 'broken-direct.md') throw new Error('fixture render failure')
${anchor}`)
      },
    }],
  })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const root = path.resolve(import.meta.dirname, '..')
  const ui = (await Promise.all(['src/components/EditorPane.tsx', 'src/components/markdown-error-boundary.tsx', 'src/components/DockWorkspace.tsx', 'src/components/TabBar.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set((source + ui).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport })
      page.setDefaultTimeout(5000)
      const errors: string[] = [], writes: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.addInitScript(() => localStorage.setItem('mew:locale', 'ko'))
      await page.route('http://mew-editor.test/**', async route => {
        const url = new URL(route.request().url())
        if (url.pathname === '/api/file') {
          if (route.request().method() !== 'GET') writes.push(route.request().postData() ?? '')
          return route.fulfill({ json: { path: url.searchParams.get('path'), content, editable: true } })
        }
        if (url.pathname === '/api/comments') return route.fulfill({ json: { threads: [] } })
        if (url.pathname === '/api/members') return route.fulfill({ json: { members: [] } })
        if (url.pathname === '/api/table-layout') return route.fulfill({ json: { tables: [] } })
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] })
        return route.fulfill(url.pathname === '/app.js'
          ? { contentType: 'text/javascript', body: chunk.code }
          : { contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\nbody{background:var(--color-surface-deep);color:var(--color-ink)}[data-dock-workspace]{position:relative;height:700px}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` })
      })
      await page.routeWebSocket('**/api/collab?**', ws => {
        ws.onMessage(message => {
          // Empty Yjs syncStep2: the real editor then seeds its document from the loaded file.
          if (typeof message !== 'string' && message[0] === 0 && message[1] === 0) ws.send(Buffer.from([0, 1, 2, 0, 0]))
        })
      })
      await page.goto('http://mew-editor.test/')
      const open = (path: string) => page.getByRole('navigation', { name: 'Documents' }).getByRole('button', { name: path, exact: true }).click()
      await open('first.md')
      await page.locator('.ProseMirror').filter({ hasText: 'Selected file body' }).waitFor()
      await open('second.md')
      await page.locator('.ProseMirror').filter({ hasText: 'Selected file body' }).waitFor()
      assert.deepEqual(errors, [])
      for (const path of ['broken.md', 'broken-effect.md']) {
        await open(path)
        await page.getByRole('alert').filter({ hasText: 'Markdown 편집 화면을 표시하지 못했습니다.' }).waitFor()
        if (path === 'broken.md' && process.env.MEW_EDITOR_SCREENSHOT_DIR) {
          await page.screenshot({ path: `${process.env.MEW_EDITOR_SCREENSHOT_DIR}/markdown-recovery-${viewport.width}.png` })
        }
        assert.equal(await page.getByRole('navigation', { name: 'Documents' }).isVisible(), true)
        await page.getByRole('button', { name: '원문 모드로 열기', exact: true }).click()
        await page.locator('.cm-content').filter({ hasText: 'Selected file body' }).waitFor()
        assert.equal(await page.evaluate('window.tabs.activeTab.content'), content, 'recovery preserves the exact loaded Markdown')
        assert.equal(await page.evaluate('window.tabs.activeTab.savedContent'), content)
        await open('first.md')
        await page.locator('.ProseMirror').filter({ hasText: 'Selected file body' }).waitFor()
      }
      // A different file must recover directly, even without choosing Plain first.
      await open('broken-direct.md')
      await page.getByRole('alert').waitFor()
      await open('second.md')
      await page.locator('.ProseMirror').filter({ hasText: 'Selected file body' }).waitFor()
      assert.deepEqual(errors, [], 'caught editor errors never unmount the app')
      assert.deepEqual(writes, [], 'opening and recovering do not save or rewrite the document')
      await page.close()
    }
  } finally { await browser.close() }
})
