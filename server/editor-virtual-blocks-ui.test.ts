import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
const paragraphs = Array.from({ length: 600 }, (_, i) => `문단 ${i + 1}: 한글과 English **강조** 및 [내부 문서](./other.md)를 함께 편집합니다.`)
const content = ['---', 'title: 큰 문서', '---', '', '# 첫 제목', '', ...paragraphs.flatMap((text, i) => i === 399
  ? ['## 먼 제목', '', text, '']
  : i === 299
    ? ['> 가상 블록 인용문', '', '```ts', 'const windowed = true', '```', '', '| A | B |', '| --- | --- |', '| 하나 | 둘 |', '', '- [ ] 창 밖 할 일', '- [x] 끝난 할 일', '', '![도형](/fixture.svg)', '', '<div data-mew-db="windowed-db"></div>', '', text, '']
    : [text, ''])].join('\n')

test('Hotview windows block descendants and preserves edits, navigation, selection and shared documents', { skip: !domBrowserExecutable(), timeout: 90_000 }, async () => {
  const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import * as Y from 'yjs';
import {Awareness} from 'y-protocols/awareness';
import {Editor} from ${JSON.stringify(path.join(root, 'packages/editor/src/Editor.tsx'))};
import {applyFontPreferences,DEFAULT_FONT_PREFERENCES} from ${JSON.stringify(path.join(root, 'src/utils/fontPreferences.ts'))};
import {virtualBlockState,scrollVirtualPositionIntoView} from ${JSON.stringify(path.join(root, 'packages/editor/src/editor/virtualBlocks.ts'))};
applyFontPreferences(DEFAULT_FONT_PREFERENCES);
const api={db:{getView:async()=>({id:'windowed-db',title:'블록 DB',kind:'managed',editable:true,columns:[],rows:[]}),subscribe:()=>()=>{},rename:async(_,title)=>{window.savedDbTitle=title}},fetchFile:async()=>({content:''}),fetchLinkPreview:async()=>({title:null,description:null})};
const ydoc=new Y.Doc();const awareness=new Awareness(ydoc);awareness.setLocalStateField('user',{name:'test',color:'#5588aa'});
const collab=new URLSearchParams(location.search).has('collab')?{ydoc,awareness,synced:true}:undefined;
function Fixture(){
 const [value,setValue]=React.useState(${JSON.stringify(content)});
 const [readOnly,setReadOnly]=React.useState(false);
 const handle=React.useRef();
 window.value=value;window.load=setValue;window.readOnly=setReadOnly;window.handle=handle;
 window.virtualState=()=>virtualBlockState(document.querySelector('.ProseMirror').editor.view);
 window.showDatabase=()=>{const ed=document.querySelector('.ProseMirror').editor;ed.commands.setTextSelection(1);let position;ed.state.doc.forEach((node,pos)=>{if(node.type.name==='database')position=pos});if(position!==undefined)scrollVirtualPositionIntoView(ed.view,position)};
 return <div style={{height:'100dvh'}}><Editor ref={handle} value={value} onChange={setValue} readOnly={readOnly} api={api} path="large.md" collab={collab}/></div>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const styles: string[] = []
  const bundle = await build({
    input: 'virtual:windowed-editor.tsx', write: false, platform: 'browser', output: { format: 'esm', codeSplitting: false },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('production') } },
    plugins: [{
      name: 'windowed-editor-fixture',
      resolveId(id) { if (id === 'virtual:windowed-editor.tsx') return id },
      async load(id) {
        if (id === 'virtual:windowed-editor.tsx') return source
        if (id.endsWith('.css')) { styles.push(await fs.readFile(id, 'utf8')); return { code: '', moduleType: 'js' } }
      },
    }],
  })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const cssSources = await Promise.all(['packages/editor/src/Editor.tsx', 'packages/editor/src/editor/FrontmatterPanel.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set((source + cssSources.join('\n')).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + styles.join('\n')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) for (const collab of [false, true]) {
      const page = await browser.newPage({ viewport })
      page.setDefaultTimeout(10_000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-windowed-editor.test/**', async route => {
        const url = new URL(route.request().url())
        if (url.pathname.startsWith('/fonts/')) return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'font/woff2', body: await fs.readFile(path.join(root, 'public', url.pathname)) })
        if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        if (url.pathname === '/fixture.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64"><rect width="96" height="64" fill="#6688aa"/></svg>' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fonts/ibm-plex/fonts.css"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` })
      })
      await page.goto(`http://mew-windowed-editor.test/${collab ? '?collab' : ''}`)
      const editor = page.locator('.ProseMirror')
      await editor.locator('p').filter({ hasText: '문단 1:' }).waitFor()
      await page.waitForFunction('window.virtualState().active && window.virtualState().rendered < 100')
      assert.ok(await editor.locator('.mew-virtual-block').count() > 450)
      assert.ok(await editor.locator('p').count() < 100, 'only visible and selected descendants are mounted')
      assert.equal(await page.evaluate('window.value'), content, 'windowing does not normalize the stored source')

      // Model-driven heading navigation must mount its target without changing the source.
      await page.evaluate('window.handle.current.scrollToHeading(1)')
      await editor.locator('h2').filter({ hasText: '먼 제목' }).waitFor()
      await page.waitForFunction(`(() => {const h=document.querySelector('.ProseMirror h2');return h&&h.getBoundingClientRect().top<innerHeight&&h.getBoundingClientRect().bottom>0})()`)

      // Source-line restoration and the app's find bar also reach initially unmounted blocks.
      await page.evaluate(`window.handle.current.restoreViewAnchor({line:${content.split('\n').findIndex(line => line.startsWith('문단 500:')) + 1},offset:120})`)
      await editor.locator('p').filter({ hasText: '문단 500:' }).waitFor()
      await page.evaluate('window.handle.current.openSearch("문단 525:")')
      await editor.locator('p').filter({ hasText: '문단 525:' }).waitFor()
      await page.locator('.editor-search-bar input').first().focus()
      await page.keyboard.press('Escape')

      await page.evaluate(`window.handle.current.restoreViewAnchor({line:${content.split('\n').findIndex(line => line === '```ts') + 1},offset:120})`)
      await editor.locator('.code-block-wrap').filter({ hasText: 'const windowed = true' }).waitFor()
      await editor.locator('.tableWrapper table').waitFor()
      await editor.locator('input[type="checkbox"]').first().waitFor()
      await editor.locator('img').waitFor()

      // A node view can own a draft input while the ProseMirror selection stays elsewhere.
      await page.evaluate('window.showDatabase()')
      const dbTitle = editor.locator('input:not([type="checkbox"])').first()
      await dbTitle.fill('저장 전 DB 초안')
      // Finish the mobile viewport's focus adjustment before simulating a later scroll gesture.
      await dbTitle.evaluate(el => new Promise(resolve => el.ownerDocument.defaultView!.requestAnimationFrame(() => el.ownerDocument.defaultView!.requestAnimationFrame(resolve))))
      await page.locator('.editor-root').dispatchEvent('wheel')
      await editor.evaluate(el => {
        const scroller = el.closest('.editor-root')!
        scroller.scrollTop = scroller.scrollHeight
        scroller.dispatchEvent(new (el.ownerDocument.defaultView!.Event)('scroll'))
      })
      await editor.locator('p').filter({ hasText: '문단 600:' }).waitFor()
      assert.equal(await dbTitle.inputValue(), '저장 전 DB 초안')
      assert.equal(await dbTitle.evaluate(el => el.ownerDocument.activeElement === el), true, 'offscreen input retains its focus and unsaved draft')
      await dbTitle.blur()
      await page.waitForFunction('window.savedDbTitle === "저장 전 DB 초안"')
      await editor.evaluate(el => {
        const ed = (el as unknown as { editor: any }).editor
        ed.commands.setTextSelection(1)
        const scroller = el.closest('.editor-root')!
        scroller.scrollTop = scroller.scrollHeight
        scroller.dispatchEvent(new (el.ownerDocument.defaultView!.Event)('scroll'))
      })
      await dbTitle.waitFor({ state: 'detached' })

      // Selection from outside the old DOM window mounts the new block synchronously.
      const editPosition = await editor.evaluate(el => {
        const ed = (el as unknown as { editor: any }).editor
        let position = 0
        ed.state.doc.descendants((node: any, pos: number) => { if (node.isText && node.text?.startsWith('문단 450:')) position = pos })
        ed.commands.setTextSelection(position)
        ed.view.focus()
        return position
      })
      const target = editor.locator('p').filter({ hasText: '문단 450:' })
      await target.waitFor()
      await target.scrollIntoViewIfNeeded()
      await page.waitForFunction(`(expected => {
        const ed=document.querySelector('.ProseMirror').editor, selection=document.getSelection();
        return ed.view.hasFocus() && ed.state.selection.head===expected && selection?.focusNode
          && ed.view.posAtDOM(selection.focusNode,selection.focusOffset)===expected;
      })(${JSON.stringify(editPosition)})`)
      await page.keyboard.insertText('추가한글 ')
      await page.waitForFunction('window.value.includes("추가한글 문단 450:")')
      await page.keyboard.press('ControlOrMeta+z')
      await page.waitForFunction('!window.value.includes("추가한글")')

      // Copying across block boundaries uses the complete model, including initially hidden blocks.
      const copied = await editor.evaluate(el => {
        const ed = (el as unknown as { editor: any }).editor
        let from = 0, to = 0
        ed.state.doc.descendants((node: any, pos: number) => {
          if (node.isText && node.text?.startsWith('문단 440:')) from = pos
          if (node.isText && node.text?.startsWith('문단 455:')) to = pos + node.nodeSize
        })
        ed.commands.setTextSelection({ from, to })
        return ed.view.props.clipboardTextSerializer(ed.state.selection.content(), ed.view)
      })
      assert.match(copied, /문단 440:/)
      assert.match(copied, /문단 455:/)
      assert.ok(await editor.locator('p').count() < 120)

      // Reading by scrolling must not snap back to the retained caret.
      await editor.evaluate(el => {
        const ed = (el as unknown as { editor: any }).editor
        ed.commands.setTextSelection(1)
      })
      await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      await page.locator('.editor-root').dispatchEvent('wheel')
      await editor.evaluate(el => {
        const scroller = el.closest('.editor-root')!
        scroller.scrollTop = scroller.scrollHeight
        scroller.dispatchEvent(new (el.ownerDocument.defaultView!.Event)('scroll'))
      })
      await editor.locator('p').filter({ hasText: '문단 600:' }).waitFor()
      assert.ok(await editor.locator('.mew-virtual-block').count() > 450)
      assert.ok(await page.locator('.editor-root').evaluate(el => el.scrollTop > el.clientHeight * 3))

      // Resize and font invalidation refresh estimates while the retained model remains whole.
      await page.setViewportSize({ width: viewport.width === 1280 ? 900 : 430, height: viewport.height })
      await page.locator('html').evaluate(el => {
        el.style.setProperty('--mew-font-markdown', '"IBM Plex Sans KR", sans-serif')
        el.ownerDocument.defaultView!.dispatchEvent(new (el.ownerDocument.defaultView!.Event)('resize'))
      })
      await page.waitForFunction('window.virtualState().rendered > 0 && window.virtualState().rendered < 120')
      const endText = await editor.evaluate(el => (el as unknown as { editor: any }).editor.state.doc.textContent)
      assert.ok(endText.includes('문단 1:') && endText.includes('문단 600:'))
      assert.deepEqual(errors, [])

      if (!collab) {
        await page.evaluate('window.load("원본 첫 줄\\n\\n\\n다음 문단")')
        await editor.locator('p').filter({ hasText: '원본 첫 줄' }).waitFor()
        assert.equal(await editor.locator('.mew-virtual-block').count(), 0, 'small replacement documents return to native views')
        assert.deepEqual(await editor.locator('[data-mew-line-numbers]').evaluateAll(els => els.map(el => el.getAttribute('data-mew-line-numbers'))), ['1', '4'])
        await page.evaluate('window.load("원본 첫 줄\\n\\n다음 문단\\n")')
        await page.waitForFunction(`(() => [...document.querySelectorAll('.ProseMirror [data-mew-line-numbers]')].map(el=>el.dataset.mewLineNumbers).join(',') === '1,3')()`)
        await page.evaluate('window.handle.current.setRawContent("원본 첫 줄\\n\\n\\n\\n다음 문단")')
        await page.waitForFunction(`(() => [...document.querySelectorAll('.ProseMirror [data-mew-line-numbers]')].map(el=>el.dataset.mewLineNumbers).join(',') === '1,5')()`)
      }
      await page.close()
    }
  } finally { await browser.close() }
})
