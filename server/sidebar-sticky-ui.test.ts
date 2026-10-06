import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('sidebar stacks open ancestors while scrolling and releases them at each subtree end', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {FileTree} from '${root}/src/components/FileTree.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
localStorage.setItem('mew:locale','ko');
const noop=()=>{}; const file=path=>({path,name:path.split('/').pop(),type:'file'});
const files=(path,count)=>Array.from({length:count},(_,i)=>file(path+'/note-'+i+'.md'));
const branch=(path,level)=>({path,name:path.split('/').pop(),type:'dir',children:level<3?[...files(path+'/before',12),branch(path+'/child',level+1),...files(path+'/after',12)]:files(path,40)});
const tree=[...files('prefix',12),branch('parent',1),...files('outside',20)];
window.selected=[];
function Fixture(){
  const [selected,setSelected]=React.useState(null),[signal,setSignal]=React.useState(0);
  return <><button id="reveal" onClick={()=>{setSelected('parent/child/child/note-0.md');setSignal(n=>n+1)}}>Reveal</button>
  <div style={{height:320,width:320}}><FileTree documentPages={new URLSearchParams(location.search).has('docs')} project=".workspace" tree={tree}
    accountState={{openDirs:['parent','parent/child','parent/child/child'],scrollTop:0}} selectedPath={selected} readOnly={true} searchFocusSignal={0}
    newFileSignal={{n:0,parentPath:null}} revealSignal={signal} presence={{}} onSelect={path=>window.selected.push(path)}
    onFileCreated={noop} onFolderCreated={noop} onRenamed={noop} onDeleted={noop} onNotice={noop} registerSearchCancel={noop}/></div></>;
}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:sidebar-sticky.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:sidebar-sticky.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, async load(id) { if (id === 'virtual:sidebar-sticky.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8')) } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/file-action-menu.tsx', 'src/components/FileTree.tsx', 'src/hooks/use-tree-touch-gesture.ts'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 700 }, hasTouch: true })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.setDefaultTimeout(3000)
    await page.route('http://mew-sticky.test/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/api/')) { await route.fulfill({ json: {} }); return }
      await route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    })
    await page.goto('http://mew-sticky.test/')
    const list=page.locator('[data-tree-key] > div[tabindex]');
    const header=(depth:number)=>page.locator('[data-tree-sticky-depth="'+depth+'"]');
    const scrollTo=async (path:string,offset:number)=>{
      await page.locator('[data-path="'+path+'"]').evaluate((el,offset)=>{
        const list=el.closest('[data-tree-key]')!.querySelector(':scope > div[tabindex]')!;
        list.scrollTop+=el.getBoundingClientRect().top-list.getBoundingClientRect().top-offset;
      },offset);
      await page.waitForTimeout(80);
    };
    for(const mobile of [false,true]) {
      await page.setViewportSize(mobile?{width:390,height:844}:{width:1100,height:700});
      for(const docs of [false,true]) {
        await page.evaluate(()=>localStorage.clear());
        await page.goto('http://mew-sticky.test/'+(docs?'?docs':''));
        await page.locator('[data-path="parent/child/child/note-20.md"]').waitFor();
        await scrollTo('parent/child/child/note-20.md',100);
        const listBox=await list.boundingBox();assert.ok(listBox);
        const stackTop=listBox.y+await list.evaluate(el=>parseFloat(el.ownerDocument.defaultView!.getComputedStyle(el).paddingTop));
        for(let depth=0;depth<3;depth++) {
          const box=await header(depth).boundingBox();assert.ok(box);
          assert.ok(Math.abs(box.y-stackTop-depth*28)<1,JSON.stringify({mobile,docs,depth,box,listBox,scroll:await list.evaluate(el=>el.scrollTop)}));
          assert.equal(box.height,28);
          const hits=await header(depth).evaluate(el=>{
            const rect=el.getBoundingClientRect();const hit=el.ownerDocument.elementFromPoint(rect.x+100,rect.y+rect.height/2);
            return !!hit&&el.contains(hit);
          });assert.equal(hits,true,'sticky ancestors stay above child content and guide lines');
        }
        for(const theme of ['dark','light']) {
          await page.locator('html').evaluate((el,theme)=>{el.className=theme},theme);
          await page.screenshot({path:'/tmp/mew-sticky-'+(docs?'docs':'files')+'-'+(mobile?'mobile':'desktop')+'-'+theme+'.png'});
        }
        await page.locator('[data-path="parent/child/child/note-20.md"]').click();
        assert.ok((await page.evaluate('window.selected') as string[]).includes('parent/child/child/note-20.md'));
        await scrollTo('parent/child/after/note-2.md',84);
        const third=await header(2).boundingBox();assert.ok(third);
        assert.ok(third.y+third.height<=stackTop+56,'deepest ancestor leaves at its subtree end');
        const second=await header(1).boundingBox();assert.ok(second);assert.equal(second.y,stackTop+28);
        await scrollTo('parent/after/note-2.md',56);
        const child=await header(1).boundingBox();assert.ok(child);assert.ok(child.y+child.height<=stackTop+28);
        await scrollTo('outside/note-2.md',0);
        const parent=await header(0).boundingBox();assert.ok(parent);assert.ok(parent.y+parent.height<=stackTop,'root ancestor does not follow outside its folder');
        await page.locator('#reveal').click();
        await page.waitForTimeout(150);
        const revealed=await page.locator('[data-path="parent/child/child/note-0.md"]').boundingBox();assert.ok(revealed);
        assert.ok(revealed.y>=stackTop+84-1,JSON.stringify({mobile,docs,revealed,stackTop}));
        assert.ok(revealed.y+revealed.height<=listBox.y+listBox.height);
        if(docs) await page.locator('[data-document-page="parent/child"] > [data-tree-sticky-depth] button[aria-expanded]').click();
        else await page.locator('[data-path="parent/child"]').click();
        assert.equal(await page.locator('[data-tree-sticky-depth]').count(),1,'closing a pinned ancestor removes descendant headers');
      }
    }
    assert.deepEqual(errors,[]);
  } finally {await browser.close()}
})
