import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'rolldown'
import { chromium, type Page } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

async function hookFixture() {
  const source = `
import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {I18nProvider} from ${JSON.stringify(new URL('../src/i18n.tsx', import.meta.url).pathname)};
import {useTabs} from ${JSON.stringify(new URL('../src/hooks/useTabs.ts', import.meta.url).pathname)};
import {getCachedFile} from ${JSON.stringify(new URL('../src/utils/contentCache.ts', import.meta.url).pathname)};
const noop=()=>{};
const plain=path=>({path,preview:false,viewMode:'plain'});
const split=new URLSearchParams(location.search).get('mode')==='split';
const state=split
  ?{panes:[{id:'first',tabs:[plain('shared.txt'),plain('other.txt')],activePath:'other.txt'},{id:'second',tabs:[plain('shared.txt')],activePath:'shared.txt'}],layout:{kind:'split',dir:'row',kids:[{kind:'leaf',id:'first'},{kind:'leaf',id:'second'}]},focusedPaneId:'second'}
  :{panes:[{id:'main',tabs:[{path:'retry.txt',preview:true,viewMode:'plain'}],activePath:'retry.txt'}],layout:{kind:'leaf',id:'main'},focusedPaneId:'main'};
const accountTabs={docs:state};
window.accountWrites=[];
const accountChanged=(project,payload)=>window.accountWrites.push(JSON.stringify(payload));
window.failedTabWrites=0;
window.successfulTabWrites=0;
let failWrites=0;
window.failNextTabWrite=()=>{failWrites=2};
window.cachedContent=path=>getCachedFile('docs',path)?.content;
const originalSetItem=Storage.prototype.setItem;
Storage.prototype.setItem=function(key,value){
  if(key.startsWith('mew:open-tabs')){
    if(failWrites>0){failWrites--;window.failedTabWrites++;throw new DOMException('Fixture quota exceeded','QuotaExceededError')}
    window.successfulTabWrites++;
  }
  return originalSetItem.call(this,key,value);
};
function Fixture(){
  const tabs=useTabs('docs',noop,noop,'/fixture',accountTabs,accountChanged);
  window.tabs=tabs;
  return <output>{tabs.panes.map(pane=>pane.tabs.map(tab=>tab.content).join('|')).join(';')}</output>;
}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({
    input: 'virtual:tab-cache-state.tsx', write: false, platform: 'browser', output: { format: 'esm', codeSplitting: false },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'tab-cache-state-fixture', resolveId(id) {
      if (id === 'virtual:tab-cache-state.tsx') return id
      if (id.endsWith('.css')) return 'virtual:style'
    }, load(id) {
      if (id === 'virtual:tab-cache-state.tsx') return source
      if (id === 'virtual:style') return ''
    } }],
  })
  return bundle.output.find(item => item.type === 'chunk')!.code
}

async function installRoutes(page: Page, code: string, hold: (url: URL) => Promise<void> | undefined) {
  const writes: Array<{ path: string; content: string; expectedContent?: string }> = []
  await page.route('http://mew-tab-state.test/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/file') {
      if (route.request().method() === 'PUT') {
        const payload = route.request().postDataJSON() as { path: string; content: string; expectedContent?: string }
        writes.push(payload)
        return route.fulfill({ json: { ok: true, commit: null, content: payload.content } })
      }
      await hold(url)
      return route.fulfill({ json: { path: url.searchParams.get('path'), content: 'Shared baseline', editable: true } })
    }
    if (url.pathname === '/api/rules') await hold(url)
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] })
    return route.fulfill(url.pathname === '/app.js'
      ? { contentType: 'text/javascript', body: code }
      : { contentType: 'text/html', body: '<!doctype html><html><div id="root"></div><script type="module" src="/app.js"></script></html>' })
  })
  return writes
}

test('verified split-pane edits are accepted while callbacks from its unverified peer are ignored', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const code = await hookFixture()
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    let sharedReads = 0
    const writes = await installRoutes(page, code, url => {
      if (url.pathname === '/api/file' && url.searchParams.get('path') === 'shared.txt' && ++sharedReads > 1) return gate
    })
    await page.goto('http://mew-tab-state.test/?mode=split')
    await page.waitForFunction("window.tabs?.panes[1].tabs[0].editable && !window.tabs.panes[1].tabs[0].revalidating")
    assert.equal(await page.evaluate('window.tabs.panes[0].tabs[0].deferredLoad'), true, 'the first pane has not activated the shared file yet')
    await page.evaluate("window.tabs.openFile('shared.txt', {paneId:'first'})")
    await page.waitForFunction('window.tabs.panes[0].tabs[0].revalidating === true')
    assert.equal(await page.evaluate('window.tabs.panes[1].tabs[0].revalidating'), false)
    assert.equal(await page.evaluate('window.tabs.panes[1].tabs[0].editable'), true)
    await page.evaluate("window.tabs.updateTabContent('shared.txt', 'Rejected peer update', 'first'); new Promise(resolve => requestAnimationFrame(resolve))")
    assert.deepEqual(await page.evaluate("window.tabs.panes.map(pane => pane.tabs.find(tab => tab.path === 'shared.txt').content)"), ['Shared baseline', 'Shared baseline'])
    await page.evaluate("window.tabs.updateTabContent('shared.txt', 'Verified pane edit', 'second'); new Promise(resolve => requestAnimationFrame(resolve))")
    assert.deepEqual(await page.evaluate("window.tabs.panes.map(pane => pane.tabs.find(tab => tab.path === 'shared.txt').content)"), ['Verified pane edit', 'Verified pane edit'], 'the verified originating pane controls whether the edit is admitted')
    await page.evaluate("window.tabs.updateTabContent('shared.txt', 'Rejected later peer update', 'first'); new Promise(resolve => requestAnimationFrame(resolve))")
    assert.equal(await page.evaluate('window.tabs.panes[1].tabs[0].content'), 'Verified pane edit')
    await page.waitForFunction("window.tabs.panes[1].tabs[0].savedContent === 'Verified pane edit' && window.tabs.panes[1].tabs[0].status === 'saved'")
    assert.equal(writes.length, 1, 'the verified pane autosaves even when the first matching pane is still revalidating')
    assert.equal(writes[0].path, 'shared.txt')
    assert.equal(writes[0].content, 'Verified pane edit')
    assert.equal(writes[0].expectedContent, 'Shared baseline')
    assert.equal(await page.evaluate('window.tabs.panes[0].tabs[0].revalidating'), true, 'the old GET is still in flight after the newer PUT succeeds')
    assert.equal(await page.evaluate("window.cachedContent('shared.txt')"), 'Verified pane edit')
    release()
    await page.waitForFunction('window.tabs.panes[0].tabs[0].revalidating === false')
    assert.deepEqual(await page.evaluate("window.tabs.panes.map(pane => { const tab=pane.tabs.find(tab => tab.path === 'shared.txt'); return {content:tab.content,savedContent:tab.savedContent} })"), [
      { content: 'Verified pane edit', savedContent: 'Verified pane edit' },
      { content: 'Verified pane edit', savedContent: 'Verified pane edit' },
    ], 'the older GET cannot overwrite a newer saved buffer in either pane')
    assert.equal(await page.evaluate("window.cachedContent('shared.txt')"), 'Verified pane edit', 'the older GET cannot replace the newer cached body')
    assert.equal(writes.length, 1)
    await page.close()
  } finally { release(); await browser.close() }
})

test('failed local tab metadata persistence retries on a body update without repeating account notifications', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const code = await hookFixture()
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    await installRoutes(page, code, () => gate)
    await page.goto('http://mew-tab-state.test/?mode=retry')
    await page.waitForFunction('window.tabs?.activeTab?.revalidating && window.accountWrites.length === 1 && window.successfulTabWrites === 1')
    await page.evaluate("window.failNextTabWrite(); window.tabs.pinTab('retry.txt')")
    await page.waitForFunction('window.accountWrites.length === 2')
    assert.equal(await page.evaluate('window.failedTabWrites'), 2, 'one failed persistence call exhausts the storage helper\'s immediate retry')
    assert.equal(await page.evaluate('window.successfulTabWrites'), 1)
    assert.equal(await page.evaluate("JSON.parse(localStorage.getItem('mew:open-tabs:docs@/fixture')).panes[0].tabs[0].preview"), true, 'failed writes leave the previous local metadata intact')
    assert.equal(await page.evaluate('window.tabs.activeTab.preview'), false)
    release()
    await page.waitForFunction("window.tabs.activeTab.content === 'Shared baseline' && !window.tabs.activeTab.revalidating && window.successfulTabWrites === 2")
    assert.equal(await page.evaluate("JSON.parse(localStorage.getItem('mew:open-tabs:docs@/fixture')).panes[0].tabs[0].preview"), false, 'the body response retries unchanged metadata after storage recovers')
    assert.equal(await page.evaluate('window.accountWrites.length'), 2, 'the already delivered account metadata is not sent again after the local retry')
    await page.evaluate("window.tabs.updateTabContent('retry.txt', 'Changed body', 'main'); new Promise(resolve => requestAnimationFrame(resolve))")
    assert.equal(await page.evaluate('window.successfulTabWrites'), 2, 'further body changes reuse successfully persisted metadata')
    assert.equal(await page.evaluate('window.accountWrites.length'), 2)
    await page.close()
  } finally { release(); await browser.close() }
})
