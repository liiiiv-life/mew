import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

// Isolated fixtures only: never build dist, start a server or write real project files.
const origin = 'https://mew.liiiiv.life'
const cssNames = (await fs.readdir(new URL('../dist/assets/', import.meta.url))).filter(name => name.endsWith('.css'))
const css = (await Promise.all(cssNames.map(name => fs.readFile(new URL('../dist/assets/' + name, import.meta.url), 'utf8')))).join('\n')
const rounds = Number(process.env.MEW_BENCH_ROUNDS ?? 7)
const delay = Number(process.env.MEW_BENCH_DELAY ?? 180)
assert.ok(Number.isInteger(rounds) && rounds > 0 && Number.isFinite(delay) && delay >= 0)
const output = process.env.MEW_BENCH_OUTPUT ?? '/tmp/mew-file-open-benchmark.json'
const content = '# Benchmark document\n\n' + 'A paragraph with **bold text**, `code` and a [link](./other.md).\n\n'.repeat(60)
const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {EditorPane} from ${JSON.stringify(new URL('../src/components/EditorPane.tsx', import.meta.url).pathname)};
import {I18nProvider} from ${JSON.stringify(new URL('../src/i18n.tsx', import.meta.url).pathname)};
import {useTabs} from ${JSON.stringify(new URL('../src/hooks/useTabs.ts', import.meta.url).pathname)};
const noop=()=>{};
const callbacks=Object.fromEntries(['registerHandle','registerElement','registerTabBar','onFocus','onActivate','onPin','onCloseTab','onReorder','onOpenLink','onOpenHistory','onSetTocOpen','onOpenSidebar','onTabDragMove','onTabDrop'].map(k=>[k,noop]));
function Fixture(){
 const tabs=useTabs('benchmark',noop,message=>{throw new Error(message)},'/benchmark');
 window.tabs=tabs;
 return <div style={{height:700,display:'flex',flexDirection:'column'}}><button onClick={()=>tabs.openFile('example.md')}>Open document</button><EditorPane {...callbacks} onChangeContent={tabs.updateTabContent} onSetViewMode={tabs.setTabViewMode} pane={tabs.panes[0]} role="owner" authEmail="benchmark@example.test" project="benchmark" tree={[]} presence={{}} focused isGuest={false} showSidebarButton={false} tocOpen={false} dropZone={null}/></div>;
}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);
`
const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
const results = [], bundles = new Map()
try {
 // Real deployed origin, unauthenticated: measure only public navigation, never invent a login.
 const live = await browser.newPage()
 const started = performance.now()
 const response = await live.goto(origin)
 console.log(JSON.stringify({ kind: 'live-public-navigation', status: response.status(), navigationMs: performance.now() - started, fileStatus: (await live.request.get(origin + '/api/file?project=docs&path=README.md')).status() }))
 await live.close()
 for (const serial of [true, false]) {
  const bundle = await build({
   input:'virtual:file-open.tsx', write:false, platform:'browser', output:{format:'esm',codeSplitting:false},
   transform:{jsx:'react-jsx',define:{'process.env.NODE_ENV':JSON.stringify('production')}},
   plugins:[{name:'file-open-fixture',resolveId(id){if(id==='virtual:file-open.tsx')return id},async load(id){
    if(id==='virtual:file-open.tsx')return source;
    if(id.endsWith('.css'))return {code:'',moduleType:'js'};
    if(serial && id.endsWith('/src/components/EditorPane.tsx')) return (await fs.readFile(id,'utf8')).replace('useCollab(project, preparedCollabPath, authEmail)','useCollab(project, collabPath, authEmail)');
   }}],
  })
  bundles.set(serial,bundle.output.find(item=>item.type==='chunk').code)
 }
 for(let round=0;round<rounds;round++) {
  for(const serial of round%2 ? [false,true] : [true,false]) {
   const code=bundles.get(serial)
   const context=await browser.newContext(), page=await context.newPage()
   page.setDefaultTimeout(15000)
   const errors=[], requests=[]
   page.on('pageerror',e=>errors.push(e.message))
   await page.route(origin+'/**',async route=>{
    const url=new URL(route.request().url())
    if(url.pathname.startsWith('/fonts/')) return route.fulfill({contentType:'font/woff2',body:await fs.readFile(new URL('../public'+url.pathname,import.meta.url))})
    if(url.pathname==='/api/file') {
     assert.equal(route.request().method(),'GET','benchmark must never save')
     requests.push({kind:'file',at:performance.now()})
     await new Promise(r=>setTimeout(r,delay))
     return route.fulfill({json:{path:'example.md',content,editable:true}})
    }
    if(url.pathname==='/api/comments')return route.fulfill({json:{threads:[]}})
    if(url.pathname==='/api/members')return route.fulfill({json:{members:[]}})
    if(url.pathname==='/api/table-layout')return route.fulfill({json:{tables:[]}})
    if(url.pathname.startsWith('/api/'))return route.fulfill({json:[]})
    return route.fulfill(url.pathname==='/fixture.js'?{contentType:'text/javascript',body:code}:{contentType:'text/html',body:'<!doctype html><html><meta charset="utf-8"><style>'+css+'</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>'})
   })
   await page.routeWebSocket('**/api/collab?**',ws=>{
    requests.push({kind:'collab',at:performance.now()})
    const timer=setTimeout(()=>ws.send(Buffer.from([0,1,2,0,0])),delay)
    ws.onClose(()=>clearTimeout(timer))
    ws.onMessage(()=>{})
   })
   await page.goto(origin+'/__isolated_file_open_benchmark__')
   await page.getByRole('button',{name:'Open document',exact:true}).waitFor()
   await page.evaluate(() => {
    const observer=new MutationObserver(() => {
     requestAnimationFrame(() => {
      if(window.firstReadableFrame !== undefined || !document.querySelector('.ProseMirror')?.textContent.includes('A paragraph')) return
      window.firstReadableFrame=performance.now()
      observer.disconnect()
     })
    })
    observer.observe(document.getElementById('root'),{childList:true,subtree:true,characterData:true})
   })
   await page.getByRole('button',{name:'Open document',exact:true}).click()
   await page.waitForFunction(()=>{
    const el=document.querySelector('.ProseMirror')
    return el?.textContent.includes('A paragraph') && el.getAttribute('contenteditable')==='true' && el.editor?.extensionManager.extensions.some(extension=>extension.name==='collaboration') && !window.tabs.activeTab.revalidating
   })
   const timings=await page.evaluate(async()=>{
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
    const name='mew:file-open:'+window.tabs.activeTab.openTrace.id+':start'
    const start=performance.getEntriesByName(name)[0].startTime
    return {readyMs:performance.now()-start,firstReadableFrameMs:window.firstReadableFrame-start}
   })
   assert.deepEqual(errors,[])
   const row={serial,round,...timings,requestStartGapMs:requests.find(r=>r.kind==='collab').at-requests.find(r=>r.kind==='file').at}
   results.push(row)
   console.log(JSON.stringify(row))
   await context.close()
  }
 }
 const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)]
 const summary=Object.fromEntries([true,false].map(serial=>[serial?'serial':'parallel',{medianMs:median(results.filter(r=>r.serial===serial).map(r=>r.readyMs)),firstReadableFrameMedianMs:median(results.filter(r=>r.serial===serial).map(r=>r.firstReadableFrameMs)),rounds}]))
 const report={chromium:browser.version(),node:process.version,kind:'synthetic-http-and-websocket-delay',origin,delayMs:delay,paragraphs:60,summary,results}
 await fs.writeFile(output,JSON.stringify(report,null,2))
 console.log(JSON.stringify(report))
} finally {await browser.close()}
