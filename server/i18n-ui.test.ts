import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('language changes reach agent history, editor controls and shared dialogs without losing drafts', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const source = `import React, {useEffect,useRef,useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {AgentPanel} from '${root}/src/components/AgentPanel.tsx';
import {CodePane} from '${root}/src/components/CodePane.tsx';
import {I18nProvider,useI18n} from '${root}/src/i18n.tsx';
import {ConfirmDialog} from '${root}/packages/ui/src/ConfirmDialog.tsx';
import {Editor} from '${root}/node_modules/@tiptap/core/dist/index.js';
import Document from '${root}/node_modules/@tiptap/extension-document/dist/index.js';
import Paragraph from '${root}/node_modules/@tiptap/extension-paragraph/dist/index.js';
import Text from '${root}/node_modules/@tiptap/extension-text/dist/index.js';
import {CodeBlockWithCopy} from '${root}/packages/editor/src/editor/CodeBlockWithCopy.ts';
localStorage.setItem('mew:locale',new URLSearchParams(location.search).get('locale')||'en');
window.sockets={};
class Socket {
 static OPEN=1;readyState=0;
 constructor(url){this.tab=new URL(url).searchParams.get('tab');window.sockets[this.tab]=this;}
 emit(value){this.onmessage?.({data:JSON.stringify(value)})}
 open(){this.readyState=1;this.onopen?.();this.emit({type:'replay',events:[]});this.emit({type:'meta',meta:{sessionId:this.tab,startedAt:new Date().toISOString(),turns:0,busy:false,queued:[],usage:null,canLoad:true,canList:true}})}
 send(){}
 close(){this.readyState=3;this.onclose?.()}
}
window.WebSocket=Socket;
function Fixture(){
 const {setLocale}=useI18n();const [confirm,setConfirm]=useState(false);const code=useRef(null);const rich=useRef(null);
 window.changeLanguage=setLocale;window.showConfirm=()=>setConfirm(true);
 useEffect(()=>{window.codePane=code.current;const editor=new Editor({element:rich.current,extensions:[Document,Paragraph,Text,CodeBlockWithCopy],content:'<pre><code>user content: 한국어</code></pre>'});window.richEditor=editor;return()=>editor.destroy()},[]);
 return <><section id="code" style={{height:120}}><CodePane ref={code} path="notes.txt" value="user draft 한국어" readOnly={false} onChange={value=>window.codeValue=value}/></section><section ref={rich}/><section id="agent" style={{height:620,position:'relative'}}><AgentPanel project="test" workspacePath="/workspace" tree={[]} focusedFilePath={null} onOpenFile={()=>{}} onClose={()=>{}}/></section>{confirm&&<ConfirmDialog message="User content 한국어" onCancel={()=>setConfirm(false)} onConfirm={()=>setConfirm(false)}/>}</>;
}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const result = await build({ input: 'virtual:i18n.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'i18n-fixture',
    async resolveId(id, importer) {
      if (id === 'virtual:i18n.tsx') return id
      if (id === '@mew/tmux-term') return 'virtual:terminal'
      if (id.endsWith('.css')) return 'virtual:style'
      if (id.endsWith('?raw')) { const found = await this.resolve(id.slice(0, -4), importer, { skipSelf: true }); if (found) return `${found.id}?raw` }
    },
    async load(id) {
      if (id === 'virtual:i18n.tsx') return source
      if (id === 'virtual:terminal') return 'export const isHiddenTmuxSession=()=>false;export function TmuxTerminal(){return null}'
      if (id === 'virtual:style') return ''
      if (id.endsWith('?raw')) return `export default ${JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))}`
    },
  }] })
  const chunk = result.output.find(item => item.type === 'chunk')!
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const components = await Promise.all(['src/components/AgentPanel.tsx', 'src/components/MentionTextarea.tsx', 'packages/ui/src/ConfirmDialog.tsx'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))
  const css = compiler.build([...new Set((source + components.join('\n')).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } })
      page.setDefaultTimeout(4000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-i18n.test/**', route => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        if (pathname === '/api/user-ui/agent-tabs') return route.fulfill({ json: { state: { tabs: [{ id: 'first', label: 'Codex', runtime: 'codex', cwd: '/workspace' }], activeId: 'first' }, claims: [] } })
        if (pathname === '/api/agent-cwd') return route.fulfill({ json: { cwd: '/workspace' } })
        if (pathname === '/api/projects') return route.fulfill({ json: [] })
        if (pathname.startsWith('/api/')) return route.fulfill({ json: { settings: null, skills: [], jobs: [], commands: [], runtimes: [], sessions: [] } })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-i18n.test/')
      await page.waitForFunction('!!window.sockets.first && !!window.codePane')
      await page.evaluate('window.sockets.first.open();window.codePane.openSearch()')
      await page.locator('#code .cm-search').getByPlaceholder('Find', { exact: true }).fill('user')
      const draft = page.locator('[data-agent-session]:visible textarea').last()
      await draft.fill('Keep this draft 한국어')
      for (const [locale, history, refresh, find, copy, cancel, ok] of [
        ['en', 'History', 'Refresh current conversation', 'Find', 'Copy code', 'Cancel', 'OK'],
        ['zh-CN', '历史记录', '刷新当前对话', '查找', '复制代码', '取消', '确定'],
        ['ja', '履歴', '現在の会話を再読み込み', '検索', 'コードをコピー', 'キャンセル', '確認'],
        ['ko', '히스토리', '현재 대화 새로고침', '찾기', '코드 복사', '취소', '확인'],
      ]) {
        await page.evaluate(locale => (globalThis as any).changeLanguage(locale), locale)
        await page.getByRole('button', { name: history, exact: true }).click()
        assert.ok(await page.getByRole('button', { name: refresh, exact: true }).isVisible())
        await page.getByRole('button', { name: history, exact: true }).click()
        assert.equal(await draft.inputValue(), 'Keep this draft 한국어')
        assert.equal(await page.locator('#code .cm-search').getByPlaceholder(find, { exact: true }).inputValue(), 'user')
        assert.equal(await page.locator('.code-block-copy').getAttribute('aria-label'), copy)
        assert.equal(await page.locator('.tiptap').textContent(), 'user content: 한국어')
        assert.equal(await page.locator('#code .cm-content').textContent(), 'user draft 한국어')
        await page.evaluate('window.showConfirm()')
        const dialog = page.getByRole('dialog')
        await dialog.getByRole('button', { name: ok, exact: true }).waitFor()
        await dialog.getByRole('button', { name: cancel, exact: true }).click()
        assert.equal(await page.evaluate('document.documentElement.lang'), locale)
        if (process.env.MEW_UI_SCREENSHOTS && (locale === 'en' || locale === 'ja')) await page.screenshot({ path: path.join(process.env.MEW_UI_SCREENSHOTS, `mew-i18n-${width}-${locale}.png`) })
      }
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
