import test from 'node:test'
import path from 'node:path'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const root=path.resolve(import.meta.dirname, '..'),require=createRequire(`${root}/package.json`)
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Locator } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
// Only the session transports are stubbed; tab bars, drag gestures and layout use production components.
test('tab drops and individual panel closes collapse layout without losing sessions', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
const targets=['src/components/DockWorkspace.tsx','src/components/AgentPanel.tsx','src/components/BrowserPanel.tsx','src/components/TabBar.tsx']
const content=(await Promise.all(targets.map(p=>fs.readFile(`${root}/${p}`,'utf8')))).join('\n')
const source=`import React,{useState,useRef,useEffect} from '${require.resolve('react')}';
import {createRoot} from '${require.resolve('react-dom/client')}';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {DockWorkspace,DockPanel,DockGrip} from '${root}/src/components/DockWorkspace.tsx';
import {AgentPanel} from '${root}/src/components/AgentPanel.tsx';
import {BrowserPanel} from '${root}/src/components/BrowserPanel.tsx';
import {TabBar} from '${root}/src/components/TabBar.tsx';
window.mounts={};window.unmounts={};window.commands=[];
function Fixture(){
 const [state,setState]=useState(JSON.parse(localStorage.getItem('fixture:dock')||'null'));
 const [agent,setAgent]=useState(true),[terminal,setTerminal]=useState(true),[browser,setBrowser]=useState(true),[foreground,setForeground]=useState('agent');
 const [editors,setEditors]=useState([{id:'main',tabs:[{path:'README.md',preview:false},{path:'notes.md',preview:false}]}]);
 const ref=useRef(null);
 window.fixture={state,setState,setAgent,setTerminal,setBrowser,setForeground};
 const save=state=>{setState(state);localStorage.setItem('fixture:dock',JSON.stringify(state))};
 return <div className="flex h-dvh flex-col bg-surface-deep text-ink"><div className="flex h-10 shrink-0 items-center gap-4 px-3"><button onClick={()=>setAgent(v=>!v)}>에이전트</button><button onClick={()=>setTerminal(v=>!v)}>터미널</button><button onClick={()=>setBrowser(v=>!v)}>브라우저</button></div>
 <DockWorkspace apiRef={ref} value={state} onChange={save} foreground={foreground} onEditorDrop={(path,source,target)=>{const id=target||crypto.randomUUID();setEditors(prev=>[...prev.map(p=>p.id===source?{...p,tabs:p.tabs.filter(t=>t.path!==path)}:p.id===id?{...p,tabs:[...p.tabs,{path,preview:false}]}:p),...(!target?[{id,tabs:[{path,preview:false}]}]:[])].filter(p=>p.tabs.length));return id}}>
 {editors.map(p=><DockPanel key={p.id} id={'editor:'+p.id} kind="editor"><div data-dock-tab-bar className="flex h-9 shrink-0"><DockGrip group={'editor:'+p.id}/><TabBar tabs={p.tabs} activePath={p.tabs[0]?.path} presence={{}} onActivate={()=>{}} onPin={()=>{}} onClose={()=>{}} onReorder={()=>{}} onDragMove={(path,x,y)=>ref.current.preview('editor:'+p.id,path,x,y)} onDrop={(path,x,y)=>ref.current.drop('editor:'+p.id,path,x,y)}/></div><div className="p-4"><h1>mew</h1><p>작업 중인 문서</p></div></DockPanel>)}
 <AgentPanel project="mew" workspacePath="/fixture" tree={[]} focusedFilePath={null} onOpenFile={()=>{}} onClose={()=>setAgent(false)} onCloseTerminal={()=>setTerminal(false)} agentOpen={agent} terminalOpen={terminal}/>
 <BrowserPanel visible={browser} onClose={()=>setBrowser(false)}/>
 </DockWorkspace></div>
}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
const bundle=await build({input:'virtual:dock.tsx',write:false,platform:'browser',output:{format:'iife'},transform:{jsx:'react-jsx',define:{'process.env.NODE_ENV':JSON.stringify('test')}},plugins:[{name:'fixture',resolveId(id){if(id==='virtual:dock.tsx')return id;if(id.endsWith('.css'))return 'virtual:style'},async load(id){if(id.endsWith('?raw'))return 'export default '+JSON.stringify(await fs.readFile(id.slice(0,-4),'utf8'));if(id==='virtual:dock.tsx')return source;if(id==='virtual:style')return '';if(id.endsWith('/server-dom-browser.tsx'))return `import React,{useEffect} from '${require.resolve('react')}';export function ServerDomBrowserTabs(){return null};export function ServerDomBrowser({streamUrl,onController}){useEffect(()=>{window.mounts[streamUrl]=(window.mounts[streamUrl]||0)+1;onController({command:(name,args)=>window.commands.push({name,args,streamUrl})});return()=>{window.unmounts[streamUrl]=(window.unmounts[streamUrl]||0)+1}},[]);return <div className="h-full bg-white p-4 text-black">Web page <input data-browser={streamUrl} defaultValue="browser state"/><iframe title="Remote page fixture" style={{width:"100%",height:"100%",border:0}} srcDoc="<html><body style='margin:0;height:100vh'><iframe title='Nested page' style='width:100%;height:100%;border:0' srcdoc='Nested page'></iframe></body></html>"/></div>}`},transform(code,id){if(id.endsWith('/AgentPanel.tsx')){const start=code.indexOf('  const renderSession = (tab:'),end=code.indexOf('  if (dock) return',start);assert.ok(start>=0 && end>start);return code.slice(0,start)+`  const renderSession = (tab) => <SessionProbe id={tab.id}/>;\n`+code.slice(end)+`\nfunction SessionProbe({id}){useEffect(()=>{window.mounts[id]=(window.mounts[id]||0)+1;return()=>{window.unmounts[id]=(window.unmounts[id]||0)+1}},[]);return <textarea data-session={id} className="h-full w-full bg-surface-deep p-3 text-ink" defaultValue={id.startsWith('t')?'$ pwd\\n/fixture':'대화 중인 에이전트'}/>}`}}}]})
const chunk=bundle.output.find(x=>x.type==='chunk')
assert.ok(chunk && chunk.type === 'chunk')
const js=chunk.code
const compiler=await compile(await fs.readFile(`${root}/src/index.css`,'utf8'),{base:`${root}/src`,onDependency(){}})
const css=compiler.build([...new Set((content+source+' h-dvh text-black bg-white').match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
const browser=await chromium.launch({executablePath:domBrowserExecutable(),chromiumSandbox:true})
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(8000)
 const errors: string[]=[];page.on('pageerror',e=>errors.push(e.message))
 let tabs=[{id:'a1',label:'코드 작업',runtime:'codex',cwd:'/fixture'},{id:'a2',label:'문서 작업',runtime:'codex',cwd:'/fixture'},{id:'t1',label:'터미널 1',runtime:'tmux',cwd:'/fixture'},{id:'t2',label:'터미널 2',runtime:'tmux',cwd:'/fixture'}]
 const btabs=[{id:'b1',url:'http://localhost:3100/',title:'Preview',streamUrl:'/stream/b1'},{id:'b2',url:'https://example.test/',title:'Reference',streamUrl:'/stream/b2'}]
 await page.route('http://localhost:48973/**',async route=>{
  const p=new URL(route.request().url()).pathname,method=route.request().method()
  if(p==='/api/user-ui/agent-tabs'){if(method==='PUT'){tabs=route.request().postDataJSON().tabs;return route.fulfill({json:{state:{tabs,activeId:'a1'}}})}return route.fulfill({json:{state:{tabs,activeId:'a1'},claims:[]}})}
  if(p==='/api/agent-cwd')return route.fulfill({json:{cwd:'/fixture'}})
  if(p==='/api/browser-dom/tabs')return route.fulfill({json:btabs})
  if(p.startsWith('/api/'))return route.fulfill({json:{}})
  return route.fulfill(p==='/app.js'?{contentType:'text/javascript',body:js}:{contentType:'text/html',body:`<!doctype html><html class="dark" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><body><div id="root"></div><script src="/app.js"></script></body></html>`})
 })
 await page.addInitScript("localStorage.setItem('mew:locale','ko')")
 await page.goto('http://localhost:48973/')
 await page.locator('[data-session="a1"]').waitFor();await page.locator('[data-session="t1"]').waitFor()
 const bounds=async (id: string)=>{const panel=page.locator(`[data-dock-panel="${id}"]`);await panel.waitFor();const bounds=await panel.boundingBox();assert.ok(bounds);return bounds}
 const dragTab=async(locator: Locator,target: string,xpart: number,ypart: number)=>{await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox(),r=await bounds(target);assert.ok(b&&r);await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+9,b.y+b.height/2+9);await page.mouse.move(r.x+r.width*xpart,r.y+r.height*ypart,{steps:12});await page.locator('[data-dock-preview]').waitFor();await page.mouse.up()}
 const mergeAtEmptyBar = async (locator: Locator, target: string) => {
  const r=await bounds(target)
  const x=r.x+r.width-38, y=r.y+18
  assert.equal(await page.evaluate(`(() => {
    const hit=document.elementFromPoint(${x},${y})
    return !!hit?.closest('[data-dock-tab-bar]') && !hit.closest('[role="tab"], [draggable="false"]')
  })()`),true,'drop point must be empty tab-bar space, not a tab item')
  await dragTab(locator,target,(r.width-38)/r.width,18/r.height)
 }
 const groups = [
  {kind:'agent', first:'a1', second:'a2', firstLabel:'코드 작업', secondLabel:'문서 작업'},
  {kind:'terminal', first:'t1', second:'t2', firstLabel:'터미널 1', secondLabel:'터미널 2'},
  {kind:'browser', first:'b1', second:'b2', firstLabel:'Preview', secondLabel:'Reference'},
 ]
 await page.locator('[data-session="a1"]').fill('KEEP AGENT DRAFT')
 await page.locator('[data-session="t1"]').fill('KEEP TERMINAL DRAFT')
 // Cross into a real iframe in one move: without pointer capture the parent
 // window stops receiving pointermove/pointerup, even with no server round trip.
 const resizeHandle = page.getByRole('separator').first()
 const initialDockState = await page.evaluate('window.fixture.state')
 const handle = await resizeHandle.boundingBox()
 assert.ok(handle)
 const startX = handle.x + handle.width / 2, resizeY = handle.y + handle.height / 2
 const beforeResize = await bounds('browser')
 await page.mouse.move(startX, resizeY)
 await page.mouse.down()
 await page.mouse.move(startX + 1, resizeY)
 await page.mouse.move(startX + 100, resizeY)
 await page.mouse.move(startX + 140, resizeY)
 await page.mouse.up()
 const afterResize = await bounds('browser')
 assert.ok(beforeResize.width - afterResize.width > 130, 'resize must follow the pointer across browser iframes')
 await page.mouse.move(startX - 50, resizeY)
 assert.ok(Math.abs((await bounds('browser')).width - afterResize.width) < 1, 'pointerup must stop resizing')
 const cancelHandle = await resizeHandle.boundingBox()
 assert.ok(cancelHandle)
 await page.evaluate(`document.querySelector('[role="separator"]').addEventListener('pointerdown', e => window.resizePointerId = e.pointerId, {once:true})`)
 await page.mouse.move(cancelHandle.x + 2, resizeY)
 await page.mouse.down()
 await page.mouse.move(cancelHandle.x - 30, resizeY)
 const beforeCancel = await bounds('browser')
 await page.evaluate(`document.querySelector('[role="separator"]').dispatchEvent(new PointerEvent('pointercancel', {pointerId:window.resizePointerId,bubbles:true}))`)
 await page.mouse.move(cancelHandle.x - 80, resizeY)
 await page.mouse.up()
 assert.ok(Math.abs((await bounds('browser')).width - beforeCancel.width) < 1, 'cancelled drag must release capture and stop resizing')
 // Verify keyboard resizing, then restore the tab-drag fixture's original geometry.
 await resizeHandle.focus()
 const beforeKeyboard = await bounds('browser')
 await page.keyboard.press('ArrowLeft')
 assert.ok((await bounds('browser')).width > beforeKeyboard.width + 50, 'keyboard resizing must remain available')
 await page.evaluate(`window.fixture.setState(${JSON.stringify(initialDockState)})`)
 await page.waitForFunction(`Math.abs(document.querySelector('[data-dock-panel="browser"]').getBoundingClientRect().width - ${beforeResize.width}) < 1`)
 for(const group of groups){
  await dragTab(page.locator(`[data-dock-panel="${group.kind}"]`).getByText(group.secondLabel,{exact:true}),group.kind,.95,.5)
  const detached=await page.evaluate<string>(`window.fixture.state.tabs[${JSON.stringify(`${group.kind}:${group.second}`)}]`)
  assert.ok(detached.startsWith(group.kind+':'))
  await bounds(detached)
  await mergeAtEmptyBar(page.locator(`[data-dock-panel="${group.kind}"]`).getByText(group.firstLabel,{exact:true}),detached)
  await page.locator(`[data-dock-panel="${group.kind}"]`).waitFor({state:'hidden'})
  assert.equal(await page.evaluate<string>(`window.fixture.state.tabs[${JSON.stringify(`${group.kind}:${group.first}`)}]`),detached)
  await page.locator(`[data-dock-panel="${detached}"]`).getByText(group.firstLabel,{exact:true}).waitFor()
  if(group.kind==='browser') assert.equal(Math.round((await bounds(detached)).height),860)
 }
 assert.equal(await page.locator('[data-session="a1"]').inputValue(),'KEEP AGENT DRAFT')
 assert.equal(await page.locator('[data-session="t1"]').inputValue(),'KEEP TERMINAL DRAFT')
 assert.deepEqual(await page.evaluate('window.unmounts'),{})
 // A detached source also disappears after its last tab moves into an existing group.
 const sourceGroup=await page.evaluate<string>("window.fixture.state.tabs['agent:a1']")
 await dragTab(page.locator(`[data-dock-panel="${sourceGroup}"]`).getByText('코드 작업',{exact:true}),sourceGroup,.95,.5)
 const targetGroup=await page.evaluate<string>("window.fixture.state.tabs['agent:a1']")
 await mergeAtEmptyBar(page.locator(`[data-dock-panel="${sourceGroup}"]`).getByText('문서 작업',{exact:true}),targetGroup)
 await page.locator(`[data-dock-panel="${sourceGroup}"]`).waitFor({state:'detached'})
 assert.deepEqual(await page.evaluate('window.unmounts'),{})

 // Closing the default and detached panels is symmetric. Other panels expand, and reopening
 // the kind restores one group rather than the removed split. Run it for every auxiliary kind.
 for (const group of groups) {
  const current = await page.evaluate<string>(`window.fixture.state.tabs[${JSON.stringify(`${group.kind}:${group.first}`)}]`)
  // Put both tabs in the default group so its close button is exercised as well.
  await page.evaluate(({ kind }) => {
    const fixture = (globalThis as unknown as { fixture: { state: { tabs: Record<string, string>; groups: Array<{ id: string; kind: string }> }; setState: (state: unknown) => void } }).fixture
    fixture.setState({ ...fixture.state, groups: [...fixture.state.groups.filter((item) => item.kind !== kind), { id: kind, kind }], tabs: Object.fromEntries(Object.entries(fixture.state.tabs).map(([key, id]) => [key, key.startsWith(kind + ':') ? kind : id])) })
  }, { kind: group.kind })
  await bounds(group.kind)
  await dragTab(page.locator(`[data-dock-panel="${group.kind}"]`).getByText(group.secondLabel, { exact: true }), group.kind, .95, .5)
  const split = await page.evaluate<string>(`window.fixture.state.tabs[${JSON.stringify(`${group.kind}:${group.second}`)}]`)
  const before = await bounds(group.kind), siblingBefore = await bounds(split)
  await page.locator(`[data-dock-panel="${group.kind}"]`).getByRole('button', { name: group.kind === 'agent' ? '에이전트 닫기' : group.kind === 'terminal' ? '터미널 닫기' : '브라우저 닫기', exact: true }).click()
  await page.locator(`[data-dock-panel="${group.kind}"]`).waitFor({ state: 'hidden' })
  const expanded = await bounds(split)
  assert.ok(Math.abs(expanded.width - before.width - siblingBefore.width - 4) < 1, `${group.kind}: sibling fills closed panel`)
  await page.locator(`[data-dock-panel="${split}"]`).getByText(group.firstLabel, { exact: true }).waitFor()
  assert.deepEqual(await page.evaluate('window.unmounts'), {})
  await page.locator(`[data-dock-panel="${split}"]`).getByRole('button', { name: group.kind === 'agent' ? '에이전트 닫기' : group.kind === 'terminal' ? '터미널 닫기' : '브라우저 닫기', exact: true }).click()
  await page.locator(`[data-dock-panel="${split}"]`).waitFor({ state: 'detached' })
  const setter = group.kind === 'agent' ? 'setAgent' : group.kind === 'terminal' ? 'setTerminal' : 'setBrowser'
  await page.evaluate(`window.fixture.${setter}(true)`)
  await bounds(group.kind)
  const visibleGroups = await page.locator(`[data-dock-panel^="${group.kind}"]:visible`).count()
  assert.equal(visibleGroups, 1, `${group.kind}: closed split must not return`)
  assert.notEqual(current, undefined)
  assert.deepEqual(await page.evaluate('window.unmounts'), {})
 }
 assert.equal(await page.locator('[data-session="a1"]').inputValue(), 'KEEP AGENT DRAFT')
 assert.equal(await page.locator('[data-session="t1"]').inputValue(), 'KEEP TERMINAL DRAFT')
 await page.reload()
 for (const group of groups) {
  await page.locator(`[data-dock-panel="${group.kind}"]`).getByText(group.firstLabel, { exact: true }).waitFor()
  assert.equal(await page.locator(`[data-dock-panel^="${group.kind}"]:visible`).count(), 1, `${group.kind}: reload must not restore a closed split`)
 }
 assert.deepEqual(errors,[])
}finally{await browser.close()}
})
