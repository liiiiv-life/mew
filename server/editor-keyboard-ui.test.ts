import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('mobile editors shrink after keyboard resize and keep the tapped line above the keyboard', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const content = '---\ntitle: Mobile\nproperty: value\n---\n\n' + Array.from({ length: 80 }, (_, i) => `Line ${i + 1}`).join('\n\n')
  const source = `
import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {Editor} from ${JSON.stringify(path.join(root, 'packages/editor/src/Editor.tsx'))};
import {CodePane} from ${JSON.stringify(path.join(root, 'src/components/CodePane.tsx'))};
import {observeEditorViewport} from "@mew/ui";
const api={db:{},fetchFile:async()=>({content:''}),fetchLinkPreview:async()=>({title:null,description:null})};
function Fixture(){
 const [mode,setMode]=React.useState('hotview'), [value,setValue]=React.useState(${JSON.stringify(content)});
 const host=React.useRef(null); React.useEffect(()=>observeEditorViewport(host.current,()=>{},true),[]);
 const handle=React.useRef(null); window.value=value; window.handle=handle;
 return <><header style={{height:40}}><button onClick={()=>setMode('hotview')}>Hotview</button><button onClick={()=>setMode('plain')}>Plain</button><button onClick={()=>setValue(${JSON.stringify(content)})}>Reset</button></header>
 <main ref={host} style={{display:'flex',flexDirection:'column',height:window.innerHeight-40,position:'relative'}}><div style={{flex:1,minHeight:0}}>{mode==='hotview'?<Editor ref={handle} value={value} onChange={setValue} api={api} path="fixture.md"/>:<CodePane ref={handle} path="fixture.md" value={value} onChange={setValue} readOnly={false}/>}</div><div data-editor-status-bar style={{flexShrink:0,height:16}}>File size · selected characters</div></main>
 <div id="keyboard" style={{position:'fixed',left:0,right:0,bottom:0,height:0,background:'#454545',zIndex:100,pointerEvents:'none'}}/></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const candidates: string[] = [source], styles: string[] = []
  const bundle = await build({ input: 'virtual:keyboard.tsx', write: false, platform: 'browser', output: { format: 'esm', codeSplitting: false },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'keyboard-fixture', resolveId(id) { if (id === 'virtual:keyboard.tsx') return id },
      async load(id) {
        if (id === 'virtual:keyboard.tsx') return source
        if (id.endsWith('.tsx')) candidates.push(await fs.readFile(id, 'utf8'))
        if (id.endsWith('.css')) { styles.push(await fs.readFile(id, 'utf8')); return { code: '', moduleType: 'js' } }
      },
    }],
  })
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set(candidates.join('\n').match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + styles.join('\n')
  const chunk = bundle.output.find(item => item.type === 'chunk' && item.isEntry)!
  assert.ok(chunk.type === 'chunk')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: width < 768 })
      const errors: string[] = []
      page.on('pageerror', e => errors.push(e.message))
      // Headless Chromium has no OS keyboard. Resize the real VisualViewport event target independently
      // of the layout viewport, then also exercise browsers that resize both viewports.
      await page.addInitScript(`(() => {
        const viewport=window.visualViewport, proto=Object.getPrototypeOf(viewport);
        const nativeHeight=Object.getOwnPropertyDescriptor(proto,'height').get.bind(viewport);
        const nativeOffset=Object.getOwnPropertyDescriptor(proto,'offsetTop').get.bind(viewport);
        let height=null,offset=null;
        Object.defineProperty(viewport,'height',{get:()=>height??nativeHeight()});
        Object.defineProperty(viewport,'offsetTop',{get:()=>offset??nativeOffset()});
        window.setVisibleViewport=(next,nextOffset=0)=>{
          height=next;offset=next===null?null:nextOffset;
          const keyboard=document.getElementById('keyboard'); if(keyboard) keyboard.style.height=next===null?'0px':Math.max(0,window.innerHeight-next-nextOffset)+'px';
          viewport.dispatchEvent(new Event('resize'));viewport.dispatchEvent(new Event('scroll'));
        };
      })()`)
      await page.route('http://mew-keyboard.test/**', route => route.fulfill(route.request().url().includes('/api/')
        ? { contentType: 'application/json', body: '[]' }
        : route.request().url().endsWith('/app.js') ? { contentType: 'text/javascript', body: chunk.code }
        : { contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` }))
      await page.goto('http://mew-keyboard.test/')
      for (const mode of ['hotview', 'plain']) {
        await page.getByRole('button', { name: mode === 'hotview' ? 'Hotview' : 'Plain', exact: true }).click()
        const selector = mode === 'hotview' ? '.editor-root' : '.cm-scroller'
        const scroller = page.locator(selector)
        await scroller.waitFor()
        const target = mode === 'hotview' ? page.locator('.tiptap [data-mew-line-numbers="28"]') : page.locator('.cm-line').filter({ hasText: /^Line 12$/ })
        await target.click()
        // A second touch on the same cursor position need not produce a selection transaction.
        await target.click()
        await page.waitForFunction('window.handle.current.getSelectedLineRange().start === 28')
        const original = await scroller.boundingBox()
        if (width >= 768) {
          await page.evaluate('window.setVisibleViewport(500)')
          await page.waitForTimeout(60)
          assert.ok(Math.abs((await scroller.boundingBox())!.height - original!.height) < 1, 'desktop retains its layout')
          await page.evaluate('window.setVisibleViewport(null)')
          continue
        }
        for (const [height, offset] of [[650, 0], [500, 0], [420, 60], [480, 0]]) {
          await page.evaluate(`window.setVisibleViewport(${height},${offset})`)
          await page.waitForFunction(`(() => {
            const root=document.querySelector('${selector}'), box=root.getBoundingClientRect(), viewport=window.visualViewport;
            const bottom=viewport.offsetTop+viewport.height;
            const cursor=${mode === 'hotview' ? 'window.getSelection().getRangeAt(0).getBoundingClientRect()' : "document.querySelector('.cm-cursor').getBoundingClientRect()"};
            const bar=document.querySelector('[data-mobile-key-bar]')?.getBoundingClientRect();
            const status=document.querySelector('[data-editor-status-bar]').getBoundingClientRect();
            return status.height===16 && status.bottom<=Math.min(bottom,bar?bar.top:Infinity)+1 && box.bottom<=status.top+1 && box.bottom<=bottom+1 && cursor.top>=Math.max(box.top,viewport.offsetTop) && cursor.bottom<=Math.min(box.bottom,bottom,bar?bar.top:Infinity)-10 && (!bar||bar.bottom<=bottom+1);
          })()`, undefined, { timeout: 5000 })
          assert.equal(await page.evaluate('window.handle.current.getSelectedLineRange().start'), 28)
          assert.equal(await page.evaluate('window.value'), content, 'keyboard layout changes never write to the document')
        }
        if (process.env.MEW_EDITOR_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MEW_EDITOR_SCREENSHOT_DIR}/keyboard-${mode}.png` })
        await page.keyboard.type('typed')
        assert.ok((await page.evaluate('window.value') as string).includes('typed'))
        await page.evaluate('window.setVisibleViewport(null)')
        await page.waitForFunction(`document.querySelector('${selector}').getBoundingClientRect().height > 730`)
        await page.getByRole('button', { name: 'Reset', exact: true }).click()
        // Chromium's resizes-content path: both layout and visual viewport shrink.
        await target.click()
        await page.setViewportSize({ width, height: 500 })
        await page.waitForFunction(`document.querySelector('${selector}').getBoundingClientRect().bottom <= 501`)
        await page.setViewportSize({ width, height: 844 })
        await page.waitForFunction(`document.querySelector('${selector}').getBoundingClientRect().height > 730`)
        await page.locator('body').click({ position: { x: width - 1, y: 2 } })
        const readingScroll = await scroller.evaluate(el => el.scrollTop)
        await page.evaluate('window.setVisibleViewport(500)')
        await page.waitForTimeout(60)
        assert.equal(await scroller.evaluate(el => el.scrollTop), readingScroll, 'an unfocused editor preserves the reading position')
        await page.evaluate('window.setVisibleViewport(null)')
      }
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
