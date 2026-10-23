import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('Mermaid renders the remote desktop diagram, opens on demand and recovers on desktop/mobile', { skip: !domBrowserExecutable(), timeout: 60000 }, async () => {
  const doc = await fs.readFile(new URL('../docs/development/remote-desktop.md', import.meta.url), 'utf8')
  const diagram = doc.match(/```mermaid\n([\s\S]*?)\n```/)![1]
  const modulePath = new URL('../packages/editor/src/editor/diagram-preview.ts', import.meta.url).pathname
  const source = `import {createDiagramPreview} from ${JSON.stringify(modulePath)};
const dom=document.querySelector('.code-block-wrap'), pre=dom.querySelector('pre');
const view=createDiagramPreview(dom,pre,'mermaid',${JSON.stringify(diagram)});
document.querySelector('#invalid').onclick=()=>view.update('mermaid','flowchart LR\\n A --> [');
document.querySelector('#recover').onclick=()=>view.update('mermaid','flowchart LR\\n A[Recovered] --> B[OK]');`
  const bundle = await build({ input: 'virtual:diagram', write: false, platform: 'browser', output: { format: 'esm', inlineDynamicImports: true },
    plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:diagram') return id }, load(id) { if (id === 'virtual:diagram') return source } }] })
  const script = bundle.output.find(item => item.type === 'chunk')!
  const css = await fs.readFile(new URL('../packages/editor/src/editor/editor.css', import.meta.url), 'utf8')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-diagram.test/**', route => route.fulfill(route.request().url().endsWith('/app.js')
        ? { contentType: 'text/javascript', body: script.code }
        : { contentType: 'text/html', body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}.code-block-wrap{position:relative}</style><div class="code-block-wrap"><pre>source</pre></div><button id="invalid">Invalid</button><button id="recover">Recover</button><script type="module" src="/app.js"></script>` }))
      await page.goto('http://mew-diagram.test/')
      assert.equal(await page.locator('pre').isVisible(), true)
      assert.equal(await page.locator('.diagram-preview').count(), 0)
      await page.getByRole('button', { name: '다이어그램 보기', exact: true }).click()
      await page.getByRole('dialog').waitFor()
      await page.locator('.diagram-preview svg').waitFor()
      assert.match(await page.locator('.diagram-preview').textContent() ?? '', /Mew 서버/)
      assert.equal(await page.locator('pre').isVisible(), true)
      await page.keyboard.press('Escape')
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.equal(await page.getByRole('button', { name: '다이어그램 보기', exact: true }).evaluate(el => el === el.ownerDocument.activeElement), true)
      await page.getByRole('button', { name: '다이어그램 보기', exact: true }).click()
      await page.getByRole('button', { name: 'Invalid', exact: true }).click()
      await page.getByText('다이어그램을 표시할 수 없습니다. 코드를 확인해 주세요.', { exact: true }).waitFor()
      assert.equal(await page.locator('pre').isVisible(), true)
      await page.getByRole('button', { name: 'Recover', exact: true }).click()
      await page.locator('.diagram-preview svg').waitFor()
      assert.match(await page.locator('.diagram-preview').textContent() ?? '', /Recovered/)
      await page.getByRole('button', { name: '닫기', exact: true }).click()
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.equal(await page.locator('pre').isVisible(), true)
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
