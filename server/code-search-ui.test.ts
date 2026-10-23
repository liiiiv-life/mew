import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('code search supports compact responsive controls, keyboard navigation and safe replacement', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const workspaceExports = new Map<string, string>()
  for (const name of ['editor', 'ui', 'mobile-keys', 'shortcuts', 'tmux-term']) {
    const directory = path.join(root, 'packages', name)
    const pkg = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'))
    for (const [entry, target] of Object.entries(pkg.exports as Record<string, string>)) workspaceExports.set(`@mew/${name}${entry === '.' ? '' : entry.slice(1)}`, path.resolve(directory, target))
  }
  const content = 'const alpha = "Alpha alphabet";\nconst beta = "alpha";\n// alpha Beta\n'
  const source = `import React,{useEffect,useRef,useState} from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {EditorView} from '@codemirror/view';
import {CodePane} from ${JSON.stringify(path.join(root, 'src/components/CodePane.tsx'))};
import {I18nProvider,useI18n} from ${JSON.stringify(path.join(root, 'src/i18n.tsx'))};
import {applyThemePalette,THEME_PRESETS} from ${JSON.stringify(path.join(root, 'src/utils/theme-color.ts'))};
const params=new URLSearchParams(location.search);
localStorage.setItem('mew:locale',params.get('locale')||'ko');
applyThemePalette(THEME_PRESETS.find(p=>p.id===params.get('theme')).palette);
window.escaped=0;window.addEventListener('keydown',event=>{if(event.key==='Escape')window.escaped++});
function Fixture(){
 const {setLocale}=useI18n(),pane=useRef(null),[value,setValue]=useState(${JSON.stringify(content)}),[readOnly,setReadOnly]=useState(false);
 window.fixtureValue=value;window.fixtureSetValue=setValue;window.fixtureReadOnly=setReadOnly;window.fixtureLocale=setLocale;
 window.fixtureView=()=>EditorView.findFromDOM(document.querySelector('.cm-editor'));
 useEffect(()=>{window.fixtureOpen=query=>pane.current.openSearch(query)},[]);
 return <main className="mew-workspace h-full"><CodePane ref={pane} path="fixture.ts" value={value} onChange={setValue} readOnly={readOnly}/></main>;
}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const candidates = [source], styles: string[] = []
  const bundle = await build({ input: 'virtual:code-search.tsx', write: false, platform: 'browser', output: { format: 'esm', codeSplitting: false },
    onwarn(warning, defaultHandler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') defaultHandler(warning) },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'code-search-fixture',
    resolveId(id) { if (id === 'virtual:code-search.tsx') return id; return workspaceExports.get(id) },
    async load(id) {
      if (id === 'virtual:code-search.tsx') return source
      if (id.endsWith('.tsx')) candidates.push(await fs.readFile(id, 'utf8'))
      if (id.endsWith('.css')) { styles.push(await fs.readFile(id, 'utf8')); return { code: '', moduleType: 'js' } }
    },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk' && item.isEntry)!
  assert.ok(chunk.type === 'chunk')
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set(candidates.join('\n').match(/[A-Za-z0-9_@!&:/.[\]()%,-]+/g))]) + styles.join('\n')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    if (process.env.MEW_UI_SCREENSHOTS) await fs.mkdir(process.env.MEW_UI_SCREENSHOTS, { recursive: true })
    for (const { width, theme, locale, find } of [
      { width: 680, theme: 'midnight', locale: 'ko', find: '찾기' },
      { width: 390, theme: 'rose', locale: 'en', find: 'Find' },
      { width: 320, theme: 'ocean', locale: 'ja', find: '検索' },
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 640 }, hasTouch: width < 680, isMobile: width < 680 })
      page.setDefaultTimeout(5000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-code-search.test/**', route => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        if (pathname.startsWith('/api/')) return route.fulfill({ json: [] })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` })
      })
      await page.goto(`http://mew-code-search.test/?theme=${theme}&locale=${locale}`)
      const editor = page.locator('.cm-content'), panel = page.locator('.cm-search.mew-code-search')
      const query = panel.locator('input[name=search]'), replace = panel.locator('input[name=replace]')
      const button = (name: string) => panel.locator(`button[name=${name}]`)
      const count = () => panel.locator('.mew-code-search-count').innerText()
      const selected = () => editor.evaluate(el => {
        const view = (el.ownerDocument.defaultView as any).fixtureView()
        return view.state.selection.ranges.map((range: { from: number; to: number }) => ({ from: range.from, to: range.to, text: view.state.sliceDoc(range.from, range.to) }))
      })
      const total = async () => Number((await count()).match(/\d+/g)?.at(-1) ?? 0)
      await editor.waitFor()
      await page.waitForFunction('!!window.fixtureOpen')
      await editor.click()
      await editor.press('Control+f')
      await query.waitFor()
      assert.equal(await query.getAttribute('placeholder'), find)
      assert.ok(await query.getAttribute('aria-label'), 'search field has a translated accessible name')
      assert.equal(await replace.isVisible(), false, 'replacement starts collapsed')
      for (const name of ['next', 'prev', 'select', 'close', 'case', 're', 'word', 'toggleReplace']) {
        assert.ok(await button(name).getAttribute('aria-label'), `${name} has an accessible name`)
        assert.ok(await button(name).getAttribute('data-tip'), `${name} uses the shared tooltip`)
      }
      if (width === 680) {
        await button('close').hover()
        await page.getByRole('tooltip').waitFor()
        assert.equal(await page.getByRole('tooltip').innerText(), await button('close').getAttribute('data-tip'))
      }
      await query.fill('alpha')
      assert.equal(await total(), 5)
      await query.press('Enter')
      const first = await selected()
      assert.equal(first[0]?.text.toLowerCase(), 'alpha')
      await query.press('Enter')
      assert.notDeepEqual(await selected(), first)
      await query.press('Shift+Enter')
      assert.deepEqual(await selected(), first, 'reverse navigation returns to the preceding match')
      const beforeIme = await selected()
      await query.evaluate(el => el.dispatchEvent(new el.ownerDocument.defaultView!.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true })))
      assert.deepEqual(await selected(), beforeIme, 'IME confirmation does not navigate')
      await button('word').click()
      assert.equal(await button('word').getAttribute('aria-pressed'), 'true')
      assert.equal(await total(), 4)
      await button('case').click()
      assert.equal(await button('case').getAttribute('aria-pressed'), 'true')
      assert.equal(await total(), 3)
      await button('re').click()
      assert.equal(await button('re').getAttribute('aria-pressed'), 'true')
      await query.fill('[')
      assert.equal(await query.getAttribute('aria-invalid'), 'true')
      assert.equal(await button('next').isDisabled(), true)
      await query.fill('alpha')
      assert.notEqual(await query.getAttribute('aria-invalid'), 'true')
      await button('re').click()
      await button('case').click()
      await button('word').click()
      await query.fill('not present')
      assert.equal(await total(), 0)
      for (const name of ['next', 'prev', 'select']) assert.equal(await button(name).isDisabled(), true)
      await query.fill('alpha')
      await button('select').click()
      assert.equal((await selected()).length, 5, 'select all matches preserves CodeMirror multiple selections')
      await button('toggleReplace').click()
      assert.equal(await button('toggleReplace').getAttribute('aria-expanded'), 'true')
      await replace.fill('omega')
      if (process.env.MEW_UI_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.MEW_UI_SCREENSHOTS, `code-search-${width}-${theme}-${locale}.png`) })
      const geometry = await panel.evaluate(el => {
        const bounds = el.getBoundingClientRect()
        const visible = [...el.querySelectorAll('input,button')].filter(item => (item as any).getClientRects().length)
        return { width: bounds.width, scrollWidth: el.scrollWidth, controls: visible.map(item => { const box = item.getBoundingClientRect(); return { left: box.left, right: box.right, height: box.height } }) }
      })
      assert.ok(geometry.scrollWidth <= Math.ceil(geometry.width) + 1, `search panel does not overflow at ${width}px`)
      for (const control of geometry.controls) {
        assert.ok(control.left >= 0 && control.right <= width + 1, `controls stay reachable at ${width}px`)
        assert.ok(control.height >= 24, 'compact controls retain a usable click target')
      }
      await page.evaluate('window.fixtureLocale("zh-CN")')
      await page.waitForFunction('document.querySelector(".cm-search input[name=search]")?.getAttribute("placeholder")==="查找"')
      assert.equal(await query.inputValue(), 'alpha', 'changing locale preserves the search query')
      assert.equal(await replace.inputValue(), 'omega', 'changing locale preserves the replacement')
      assert.equal(await replace.isVisible(), true, 'changing locale preserves the expanded replacement row')
      assert.equal(await page.evaluate('window.fixtureValue'), content, 'finding and changing options do not modify the document')
      await query.press('Enter')
      await replace.press('Enter')
      await page.waitForFunction('window.fixtureValue.includes("omega")')
      assert.equal((await page.evaluate('window.fixtureValue') as string).match(/omega/g)?.length, 1, 'Enter replaces a single match')
      await button('replaceAll').click()
      await page.waitForFunction('!window.fixtureValue.toLowerCase().includes("alpha")')
      assert.equal((await page.evaluate('window.fixtureValue') as string).match(/omega/g)?.length, 5)
      await query.press('Escape')
      assert.equal(await panel.count(), 0)
      assert.equal(await page.evaluate('window.escaped'), 0, 'search consumes Escape before workspace dismissal')
      await editor.press('Control+z')
      await page.waitForFunction('window.fixtureValue.toLowerCase().includes("alpha")')
      await page.evaluate('window.fixtureReadOnly(true)')
      await page.waitForFunction('document.querySelector(".cm-content")?.getAttribute("contenteditable")==="false"')
      const beforeReadOnly = await page.evaluate('window.fixtureValue')
      await page.evaluate('window.fixtureOpen("alpha")')
      await query.waitFor()
      assert.equal(await query.inputValue(), 'alpha')
      assert.equal(await button('toggleReplace').isVisible(), false, 'read-only files do not offer replacement')
      assert.equal(await replace.isVisible(), false)
      await query.press('Enter')
      assert.equal((await selected())[0]?.text.toLowerCase(), 'alpha')
      assert.equal(await page.evaluate('window.fixtureValue'), beforeReadOnly)
      await button('close').click()
      assert.equal(await panel.count(), 0)
      if (width === 680) {
        await page.evaluate('window.fixtureReadOnly(false);window.fixtureSetValue("a ".repeat(10001))')
        await page.waitForFunction('document.querySelector(".cm-content")?.getAttribute("contenteditable")==="true" && window.fixtureView().state.doc.length===20002')
        await page.evaluate('window.fixtureOpen("a")')
        await query.waitFor()
        assert.match(await count(), /10[,.]?000\+/, 'large documents report a bounded match count')
        assert.equal(await button('select').isDisabled(), true, 'select all reflects the CodeMirror selection limit')
        assert.equal(await button('next').isDisabled(), false)
        await button('next').click()
        assert.equal((await selected())[0]?.text, 'a', 'navigation remains available after count truncation')
        await button('close').click()
      }
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
