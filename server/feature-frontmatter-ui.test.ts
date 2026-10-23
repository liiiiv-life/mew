import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('feature frontmatter displays compact file links and commit tags without changing YAML on desktop and mobile', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const initial = '---\ntitle: 기능 문서\nfiles:\n  - "src/아주 긴 파일 경로/공백 #100%?.tsx" # keep file comment\n  - docs/guide.md\ncommits:\n  - repository: ""\n    hash: abc1234567890abcdef1234567890abcdef1234567\n    subject: 첫 구현\n  - repository: packages/app\n    hash: def5678901234abcdef1234567890abcdef1234567\n    subject: 하위 저장소\n---\n\n본문 [가이드](../guide.md)'
  const source = `
import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {Editor} from ${JSON.stringify(path.join(root, 'packages/editor/src/Editor.tsx'))};
import {editorLinkTabPath} from ${JSON.stringify(path.join(root, 'src/utils/editor-files.ts'))};
const api={db:{},fetchFile:async()=>({content:''}),fetchLinkPreview:async()=>({title:null,description:null})};
function Fixture(){
 const [value,setValue]=React.useState(${JSON.stringify(initial)}), [readOnly,setReadOnly]=React.useState(false), [feature,setFeature]=React.useState(true);
 window.saved=value;
 return <><button onClick={()=>setReadOnly(r=>!r)}>Read-only</button><button onClick={()=>setFeature(r=>!r)}>Other document</button>
 <div style={{height:720}}><Editor value={value} onChange={setValue} api={api} readOnly={readOnly} path={feature?'features/기능.md':'guide.md'}
 fileLinkContext={{path:'/work/notes/reference/'+(feature?'features/기능.md':'guide.md'),docsRoot:'/work/notes/reference',projectRoot:'/work'}}
 onOpenLink={p=>{window.opened=editorLinkTabPath('docs',p,{path:'/work',docsPath:'/work/notes/reference'});}}/></div></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const candidates = [source], styles: string[] = []
  const bundle = await build({ input: 'virtual:feature-frontmatter.tsx', write: false, platform: 'browser', output: { format: 'esm' },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
      name: 'feature-frontmatter-fixture', resolveId(id) { if (id === 'virtual:feature-frontmatter.tsx') return id },
      async load(id) {
        if (id === 'virtual:feature-frontmatter.tsx') return source
        if (id.endsWith('.css')) { styles.push(await fs.readFile(id, 'utf8')); return { code: '', moduleType: 'js' } }
        if (id.endsWith('.tsx')) candidates.push(await fs.readFile(id, 'utf8'))
      },
    }] })
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set(candidates.join('\n').match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + styles.join('\n')
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: width < 500, isMobile: width < 500 })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-feature-properties.test/**', route => route.fulfill(route.request().url().endsWith('/app.js')
        ? { contentType: 'text/javascript', body: chunk.code }
        : { contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` }))
      await page.goto('http://mew-feature-properties.test/')
      const files = page.locator('[data-feature-references="files"]'), commits = page.locator('[data-feature-references="commits"]')
      await files.waitFor()
      assert.equal(await files.getByRole('link').count(), 2)
      assert.equal(await commits.getByText('abc1234', { exact: true }).count(), 1)
      assert.match((await commits.getByText('def5678', { exact: true }).getAttribute('title'))!, /packages\/app\ndef5678.*\n하위 저장소/)
      assert.equal(await page.evaluate('window.saved'), initial, 'viewing leaves YAML unchanged')
      for (const theme of ['dark', 'light']) {
        await page.locator('html').evaluate((el, theme) => { el.className = theme }, theme)
        assert.equal(await page.locator('.frontmatter-panel').evaluate(el => el.scrollWidth <= el.clientWidth), true)
        const sizes = await files.getByRole('link').first().evaluate(el => ({
          property: parseFloat(el.ownerDocument.defaultView!.getComputedStyle(el).fontSize),
          body: parseFloat(el.ownerDocument.defaultView!.getComputedStyle(el.ownerDocument.querySelector('.tiptap a')!).fontSize),
          icon: el.ownerDocument.defaultView!.getComputedStyle(el, '::before').maskImage,
        }))
        assert.ok(sizes.property < sizes.body)
        assert.ok(sizes.icon.includes('svg'))
        await page.screenshot({ path: `/tmp/mew-feature-properties-${width}-${theme}.png` })
      }
      await files.getByRole('link').first().click()
      assert.equal(await page.evaluate('window.opened'), 'src/아주 긴 파일 경로/공백 #100%?.tsx')
      await files.getByRole('link').last().focus()
      await page.keyboard.press('Enter')
      assert.equal(await page.evaluate('window.opened'), 'docs/guide.md')
      await files.getByRole('button', { name: 'files 편집', exact: true }).click()
      const fileInput = page.getByRole('textbox', { name: 'files', exact: true })
      await fileInput.fill('["../invalid"]')
      await fileInput.press('Enter')
      assert.equal(await fileInput.getAttribute('aria-invalid'), 'true')
      assert.equal(await page.evaluate('window.saved'), initial)
      await fileInput.press('Escape')
      await files.getByRole('button', { name: 'files 편집', exact: true }).click()
      await fileInput.fill('["src/next.ts"]')
      await fileInput.press('Enter')
      await files.getByRole('link', { name: 'src/next.ts', exact: true }).waitFor()
      const yaml = () => page.evaluate('window.saved').then(value => parse((value as string).split('---')[1]))
      assert.deepEqual((await yaml()).files, ['src/next.ts'])
      assert.equal((await yaml()).commits[0].subject, '첫 구현')
      await commits.getByRole('button', { name: 'commits 편집', exact: true }).click()
      const commitInput = page.getByRole('textbox', { name: 'commits', exact: true })
      await commitInput.fill('[]')
      await page.getByRole('textbox', { name: '제목', exact: true }).click()
      assert.deepEqual((await yaml()).commits, [])
      await commits.getByRole('button', { name: 'commits 편집', exact: true }).click()
      await commitInput.fill('[{"repository":"","hash":"fedcba9876543210","subject":"새 커밋"}]')
      await commitInput.press('Enter')
      await commits.getByText('fedcba9', { exact: true }).waitFor()
      assert.deepEqual((await yaml()).commits, [{ repository: '', hash: 'fedcba9876543210', subject: '새 커밋' }])
      await page.getByRole('button', { name: 'Read-only', exact: true }).click()
      assert.equal(await page.getByRole('button', { name: /^(files|commits) 편집$/ }).count(), 0)
      await files.getByRole('link').click()
      assert.equal(await page.evaluate('window.opened'), 'src/next.ts')
      await page.getByRole('button', { name: 'Other document', exact: true }).click()
      assert.equal(await page.locator('[data-feature-references]').count(), 0)
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
