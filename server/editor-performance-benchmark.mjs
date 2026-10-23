import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

// Match the isolated browser fixtures: no application server, dist writes or real files opened.
const root = fileURLToPath(new URL('..', import.meta.url))
const sizes = (process.env.MEW_BENCH_SIZES ?? '50,500,5000').split(',').map(Number)
const rounds = Number(process.env.MEW_BENCH_ROUNDS ?? 3)
const largeRounds = Number(process.env.MEW_BENCH_LARGE_ROUNDS ?? 1)
const samples = Number(process.env.MEW_BENCH_SAMPLES ?? 30)
const output = process.env.MEW_BENCH_OUTPUT ?? '/tmp/mew-editor-performance.json'
const instrumented = process.env.MEW_BENCH_INSTRUMENT !== '0'
const lineFocus = process.env.MEW_BENCH_NO_LINE_FOCUS !== '1'
const modes = (process.env.MEW_BENCH_MODES ?? 'hotview,plain').split(',')
assert.ok(sizes.every(n => Number.isInteger(n) && n > 0) && Number.isInteger(rounds) && rounds > 0 && Number.isInteger(samples) && samples >= 5)
assert.ok(Number.isInteger(largeRounds) && largeRounds > 0)
assert.ok(modes.length > 0 && modes.every(mode => ['hotview', 'plain'].includes(mode)))
const sourceFiles = ['packages/editor/src/Editor.tsx', 'packages/editor/src/editor/lineFocus.ts', 'src/components/EditorPane.tsx', 'src/components/CodePane.tsx']
const sourceSnapshots = new Map(await Promise.all(sourceFiles.map(async file => [path.join(root, file), await fs.readFile(path.join(root, file), 'utf8')])))
const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(sourceSnapshots.get(path.join(root, file))).digest('hex')]))

function documentText(count) {
  return ['---', 'title: 성능 측정 예제', '---', '', '# 에디터 성능 측정', '', ...Array.from({ length: count }, (_, i) =>
    `문단 ${i + 1}: 한글과 English를 함께 작성합니다. **중요한 내용**과 \`inline code\`, [문서 링크](./example.md)를 포함합니다. 긴 문서에서도 입력과 줄바꿈이 자연스러운지 확인합니다.\n`,
  )].join('\n')
}

const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {EditorPane} from ${JSON.stringify(path.join(root, 'src/components/EditorPane.tsx'))};
import {I18nProvider} from ${JSON.stringify(path.join(root, 'src/i18n.tsx'))};
import {EditorView as CodeMirrorView} from '@codemirror/view';
import {applyFontPreferences,DEFAULT_FONT_PREFERENCES} from ${JSON.stringify(path.join(root, 'src/utils/fontPreferences.ts'))};
const config=window.benchmarkConfig;
applyFontPreferences(DEFAULT_FONT_PREFERENCES);
const noop=()=>{};
const callbacks=Object.fromEntries(['registerHandle','registerElement','registerTabBar','onFocus','onActivate','onPin','onCloseTab','onReorder','onOpenLink','onOpenHistory','onSetTocOpen','onOpenSidebar','onTabDragMove','onTabDrop'].map(k=>[k,noop]));
window.benchmark={timings:{},keys:[],enabled:false,changes:0};
window.findCodeView=el=>CodeMirrorView.findFromDOM(el);
window.recordTiming=(name,start)=>{
  const b=window.benchmark;if(!b.enabled)return;
  (b.timings[name]??=[]).push(performance.now()-start);
};
window.wrapTiming=(target,key,name)=>{
  const original=target[key];if(typeof original!=='function')return;
  target[key]=function(...args){const start=performance.now();try{return original.apply(this,args)}finally{window.recordTiming(name,start)}};
};
function Fixture(){
  const [value,setValue]=React.useState(config.content);
  window.benchmarkValue=value;
  return <div className="flex h-dvh flex-col"><EditorPane {...callbacks}
    pane={{id:'benchmark',activePath:'example.md',tabs:[{path:'example.md',content:value,viewMode:config.mode,editable:true,preview:false}]}}
    onChangeContent={(_,v)=>{window.benchmark.changes++;setValue(v)}} onSetViewMode={noop}
    role="guest" authEmail={null} project="benchmark" tree={[]} presence={{}} focused isGuest showSidebarButton={false} tocOpen={false} dropZone={null}/></div>;
}
window.benchmarkMountStart=performance.now();
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);
`
const styles = []
const bundle = await build({
  input: 'virtual:editor-performance.tsx', write: false, platform: 'browser',
  output: { format: 'esm', codeSplitting: false, sourcemap: 'inline' },
  transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('production') } },
  plugins: [{
    name: 'editor-performance-fixture',
    resolveId(id) { if (id === 'virtual:editor-performance.tsx') return id },
    async load(id) {
      if (id === 'virtual:editor-performance.tsx') return source
      if (sourceSnapshots.has(id)) return sourceSnapshots.get(id)
      if (id.endsWith('.css')) { styles.push(await fs.readFile(id, 'utf8')); return { code: '', moduleType: 'js' } }
    },
  }],
})
const chunk = bundle.output.find(item => item.type === 'chunk')
assert.ok(chunk)
if (process.env.MEW_BENCH_BUNDLE) await fs.writeFile(process.env.MEW_BENCH_BUNDLE, chunk.code)
const cssSources = await Promise.all([
  'src/components/EditorPane.tsx', 'src/components/TabBar.tsx', 'packages/editor/src/Editor.tsx',
].map(file => fs.readFile(path.join(root, file), 'utf8')))
const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), {
  base: path.join(root, 'src'), onDependency() {},
})
const css = compiler.build([...new Set((source + cssSources.join('\n')).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + styles.join('\n')

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = p => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0
  return { n: sorted.length, median: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) ?? 0, total: sorted.reduce((a, b) => a + b, 0) }
}
const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
const results = []
try {
  for (let round = 0; round < rounds; round++) {
    // Alternate the mode order to avoid consistently favoring a warm host.
    for (const count of sizes) for (const mode of round % 2 ? [...modes].reverse() : modes) {
      if (count >= 5000 && round >= largeRounds) continue
      const content = documentText(count)
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
      page.setDefaultTimeout(120_000)
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-editor-benchmark.test/**', async route => {
        const url = new URL(route.request().url())
        if (url.pathname.startsWith('/fonts/')) {
          const font = path.join(root, 'public', url.pathname)
          return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'font/woff2', body: await fs.readFile(font) })
        }
        if (url.pathname === '/api/comments') return route.fulfill({ json: { threads: [] } })
        if (url.pathname === '/api/members') return route.fulfill({ json: { members: [] } })
        if (url.pathname === '/api/table-layout') return route.fulfill({ json: { tables: [] } })
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] })
        if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fonts/ibm-plex/fonts.css"><style>${css}</style><div id="root"></div><script>window.benchmarkConfig=${JSON.stringify({ content, mode })}</script><script type="module" src="/app.js"></script></html>` })
      })
      const client = await page.context().newCDPSession(page)
      await client.send('Performance.enable')
      await page.goto('http://mew-editor-benchmark.test/')
      const selector = mode === 'hotview' ? '.ProseMirror' : '.cm-content'
      await page.locator(selector).waitFor()
      const mountMs = await page.evaluate(async () => {
        await document.fonts.ready
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return performance.now() - window.benchmarkMountStart
      })
      await page.locator(selector).evaluate((el, options) => {
        const w = el.ownerDocument.defaultView
        w.benchmark.editor = el.editor
        if (el.editor) {
          const ed = el.editor
          if (!options.lineFocus) {
            const plugins = ed.state.plugins.filter(plugin => !plugin.key.startsWith('lineFocus$'))
            ed.view.updateState(ed.state.reconfigure({ plugins }))
          }
          if (options.instrumented) {
            w.wrapTiming(ed.view, 'dispatch', 'dispatch')
            w.wrapTiming(ed.view, 'updateState', 'viewUpdate')
            w.wrapTiming(ed.storage.markdown, 'getMarkdown', 'getMarkdown')
            w.wrapTiming(ed.storage.markdown.serializer, 'serialize', 'serialize')
            w.wrapTiming(ed.storage.markdown.parser, 'parse', 'parseMarkdown')
            for (const plugin of ed.state.plugins) {
              if (plugin.key.startsWith('lineFocus$')) w.wrapTiming(plugin.props, 'decorations', 'lineFocus')
            }
            for (const key of ['update', 'selectionUpdate']) {
              const original = ed.options[key === 'update' ? 'onUpdate' : 'onSelectionUpdate']
              const callbacks = ed.callbacks[key]
              const index = callbacks?.indexOf(original)
              if (index >= 0) callbacks[index] = function(...args) {
                const start = performance.now()
                try { return original.apply(this, args) } finally { w.recordTiming(key, start) }
              }
            }
          }
          let start
          ed.state.doc.descendants((node, pos) => { if (node.type.name === 'paragraph' && start === undefined) start = pos + 1; return false })
          ed.commands.setTextSelection(start)
          ed.commands.focus()
        } else {
          const view = w.findCodeView(el)
          if (options.instrumented) w.wrapTiming(view, 'dispatch', 'dispatch')
          const pos = view.state.doc.line(7).from
          view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
          view.focus()
        }
        el.addEventListener('keydown', event => {
          if (!w.benchmark.enabled || event.key.length !== 1) return
          const start = performance.now()
          const entry = { key: event.key, start }
          w.benchmark.keys.push(entry)
          // Second rAF is a frame-boundary proxy, not a paint timestamp or field INP.
          requestAnimationFrame(() => requestAnimationFrame(() => { entry.frameMs = performance.now() - start }))
        }, true)
      }, { instrumented, lineFocus })
      await page.locator(selector).focus()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      for (let i = 0; i < 5; i++) await page.keyboard.press('x')
      await page.waitForTimeout(150)
      assert.ok(await page.evaluate(() => window.benchmarkValue.includes('xxxxx')), `warm-up edits must reach the controlled value (${mode})`)
      const dom = await page.locator(selector).evaluate(el => ({ nodes: el.querySelectorAll('*').length, renderedLines: el.querySelectorAll('.cm-line').length, scrollHeight: el.scrollHeight, font: getComputedStyle(el).fontFamily, fontsLoaded: el.ownerDocument.fonts.check('16px "IBM Plex Sans KR"') }))
      const before = Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
      await page.evaluate(() => {
        window.benchmark.timings = {}
        window.benchmark.keys = []
        window.benchmark.changes = 0
        window.benchmark.enabled = true
      })
      const profilePath = process.env.MEW_BENCH_PROFILE
      const profileThisCase = profilePath && round === 0 && count === Math.max(...sizes) && mode === 'hotview'
      if (profileThisCase) {
        await client.send('Profiler.enable')
        await client.send('Profiler.setSamplingInterval', { interval: 1000 })
        await client.send('Profiler.start')
      }
      for (let i = 0; i < samples; i++) {
        await page.keyboard.press('x')
        await page.waitForFunction(n => window.benchmark.keys.length === n && window.benchmark.keys.at(-1).frameMs !== undefined, i + 1)
      }
      await page.waitForTimeout(80)
      const after = Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
      const measured = await page.evaluate(() => {
        window.benchmark.enabled = false
        return { timings: window.benchmark.timings, keys: window.benchmark.keys, changes: window.benchmark.changes }
      })
      if (profileThisCase) {
        const { profile } = await client.send('Profiler.stop')
        await fs.writeFile(profilePath, JSON.stringify(profile))
      }
      assert.equal(measured.changes, samples, 'every key must emit exactly one content change')
      assert.equal(measured.keys.length, samples)
      if (instrumented && mode === 'hotview') {
        for (const name of ['serialize', 'update', ...(lineFocus ? ['lineFocus'] : [])]) {
          assert.ok(measured.timings[name]?.length > 0, `missing ${name} instrumentation`)
        }
      }
      assert.deepEqual(errors, [])
      const metricNames = ['ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration', 'LayoutCount', 'RecalcStyleCount']
      const row = {
        round: round + 1, mode, paragraphs: count, bytes: Buffer.byteLength(content), mountMs, dom,
        frameMs: stats(measured.keys.map(k => k.frameMs)),
        frameSamplesMs: measured.keys.map(k => k.frameMs),
        timings: Object.fromEntries(Object.entries(measured.timings).map(([name, values]) => [name, stats(values)])),
        cdpPerKey: Object.fromEntries(metricNames.map(name => [name, (after[name] - before[name]) / samples * (name.endsWith('Duration') ? 1000 : 1)])),
      }
      results.push(row)
      console.log(JSON.stringify(row))
      await fs.writeFile(output, JSON.stringify({ environment: { date: new Date().toISOString(), node: process.version, chromium: browser.version(), platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model, cpuCount: os.cpus().length, viewport: '1280x800', react: 'production', collaboration: false, samples, rounds, largeRounds, instrumented, lineFocus, sourceHashes }, results }, null, 2) + '\n')
      await client.detach()
      await page.close()
    }
  }
} finally {
  await browser.close()
}
console.log(`Results: ${output}`)
