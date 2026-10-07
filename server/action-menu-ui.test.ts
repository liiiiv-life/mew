import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('shared action menus share styles, skip disabled actions and retain modal focus and clipboard gestures', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const source = `
import React,{useState,useRef} from 'react';import {createRoot} from 'react-dom/client';
import {ActionMenu,ActionMenuItem,ActionMenuSeparator,DialogFrame} from '@mew/ui';
import {Copy} from 'iconoir-react';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {FileActionMenu} from '${root}/src/components/file-action-menu.tsx';
import {TabActionMenu} from '${root}/src/components/tab-action-menu.tsx';
import {GitChangesMenu} from '${root}/src/components/git-changes-menu.tsx';
import {TaskActionMenu} from '${root}/src/components/task-action-menu.tsx';
import {HeaderMenu} from '${root}/src/components/HeaderMenu.tsx';
import {TableCopyMenu} from '${root}/packages/editor/src/editor/TableCopyMenu.tsx';
localStorage.setItem('mew:locale','ko');window.actions=[];
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied=text}}});
function Fixture(){
 const [open,setOpen]=useState(null),[modal,setModal]=useState(false),[outside,setOutside]=useState(0);
 const origin=useRef(null),table=useRef(null);const close=()=>setOpen(null),action=()=>window.actions.push('selected');
 const x=innerWidth-2,y=innerHeight-2;
 const editor={state:{doc:{nodeAt:()=>({}),type:{create:()=>({})}}},storage:{markdown:{serializer:{serialize:()=> '|셀|'}}}};
 const controls=<><button id="outside" onClick={()=>setOutside(v=>v+1)}>Outside {outside}</button>
 <button ref={origin} id="shared" onClick={()=>setOpen('shared')}>공용</button>
 {['file','tab','git','task','table'].map(name=><button key={name} id={name} onClick={()=>setOpen(name)}>{name}</button>)}
 <HeaderMenu items={[{id:'copy',label:'헤더 동작',icon:<Copy/>,onSelect:action,hint:'Ctrl+C'}]}/>
 <table ref={table}><tbody><tr><td>셀</td></tr></tbody></table>
 {open==='shared'&&<ActionMenu x={x} y={y} trigger={origin.current} onClose={close} label="공용">
  <ActionMenuItem icon={<Copy/>} onClick={action}>첫째</ActionMenuItem>
  <ActionMenuItem disabled icon={<Copy/>} onClick={action}>비활성</ActionMenuItem><ActionMenuSeparator/>
  <ActionMenuItem icon={<Copy/>} checked danger hint="힌트" onClick={action}>셋째</ActionMenuItem>
 </ActionMenu>}
 {open==='file'&&<FileActionMenu x={x} y={y} onClose={close} onRename={action}/>}
 {open==='tab'&&<TabActionMenu x={x} y={y} onClose={close} onRename={action} onCloseTab={action} onMaximize={action}/>}
 {open==='git'&&<GitChangesMenu x={x} y={y} onClose={close} onInclude={action} onExclude={action} onDiscard={action}/>}
 {open==='task'&&<TaskActionMenu anchor={{x,y,trigger:origin.current}} task={{id:'task',done:false,text:'Task'}} onClose={close} onOpenDocument={action} onToggleDone={action}/>}
 {open==='table'&&<TableCopyMenu editor={editor} pos={0} tableDom={table.current} position={{left:x,top:y}} onClose={close} onError={text=>{throw Error(text)}}/>}
 </>;
 return <><button id="modal" onClick={()=>setModal(true)}>모달</button>
 {modal?<DialogFrame labelledBy="title" onClose={()=>setModal(false)}><h2 id="title">테스트 모달</h2>{controls}</DialogFrame>:controls}
 <nav className="mobile-dock" style={{position:'fixed',bottom:0,height:50,width:'100%'}}/>
 </>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
  const bundle = await build({ input: 'virtual:action-menu.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'fixture',
    resolveId(id) { if (id === 'virtual:action-menu.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' },
    load(id) { if (id === 'virtual:action-menu.tsx') return source; if (id === 'virtual:style') return '' },
  }] })
  const css = await fs.readFile(path.join(root, 'packages/ui/src/action-menu.css'), 'utf8')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) for (const dark of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 800 }, hasTouch: width === 390 })
      page.setDefaultTimeout(4000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-menu.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
        :root{--color-surface:${dark ? '#151515' : '#fff'};--color-surface-raised:${dark ? '#252525' : '#fff'};--color-surface-hover:${dark ? '#333' : '#eee'};--color-ink:${dark ? '#eee' : '#222'};--color-ink-muted:${dark ? '#aaa' : '#666'};--color-edge:#888;--color-danger:${dark ? '#ff7676' : '#b00'};--color-accent:#679eff}
        *{box-sizing:border-box}body{background:var(--color-surface);color:var(--color-ink);font:14px sans-serif}button{color:inherit}svg{width:16px;height:16px}
        ${css}
        .mew-action-menu{--mew-action-menu-min-width:190px}.mew-action-menu-item{gap:9px}
        .mew-dialog{background:var(--color-surface);padding:10px}
      </style><div id="root"></div><script>${bundle.output.find(item => item.type === 'chunk')!.code}</script></html>` }))
      await page.goto('http://mew-menu.test/')
      const menu = page.getByRole('menu')
      for (const id of ['file', 'tab', 'git', 'task', 'table', 'header']) {
        await (id === 'header' ? page.getByRole('button', { name: '메뉴', exact: true }) : page.locator(`#${id}`)).click()
        await menu.waitFor()
        const first = menu.locator('[data-action-menu-item]').first()
        const style = await first.evaluate(el => {
          const view = el.ownerDocument.defaultView!, item = view.getComputedStyle(el), popup = view.getComputedStyle(el.closest('[role=menu]')!)
          return { gap: item.gap, padding: item.padding, fontSize: item.fontSize, minWidth: popup.minWidth, radius: popup.borderRadius, icon: view.getComputedStyle(el.querySelector('svg')!).width }
        })
        assert.deepEqual(style, { gap: '9px', padding: '4px 8px', fontSize: '14px', minWidth: '190px', radius: '0px', icon: '16px' }, `${id} uses the shared stylesheet`)
        const rect = await menu.boundingBox(); assert.ok(rect)
        assert.ok(rect.x >= 4 && rect.x + rect.width <= width - 4)
        assert.ok(rect.y + rect.height <= (width < 768 ? 746 : 796))
        await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' })
      }
      await page.locator('#shared').click()
      await page.keyboard.press('ArrowDown')
      assert.equal(await menu.getByRole('menuitemcheckbox', { name: '셋째 힌트' }).evaluate(el => el === el.ownerDocument.activeElement), true)
      await page.keyboard.press('Home'); await page.keyboard.press('Tab')
      assert.equal(await page.locator('#shared').evaluate(el => el === el.ownerDocument.activeElement), true)
      await page.locator('#shared').click(); await menu.waitFor()
      await page.locator('#outside').click()
      assert.equal(await page.locator('#outside').textContent(), 'Outside 0', 'dismissal consumes the underlying click')
      await page.locator('#table').click()
      await menu.getByRole('menuitem', { name: 'md로 복사 기본', exact: true }).click()
      assert.equal(await page.evaluate('window.copied'), '|셀|')
      if (process.env.MEW_MENU_SCREENSHOTS) {
        await fs.mkdir(process.env.MEW_MENU_SCREENSHOTS, { recursive: true })
        await page.addStyleTag({ content: '.mew-action-menu{--mew-action-menu-min-width:168px}.mew-action-menu-item{gap:6px}' })
        await page.locator('#shared').click(); await menu.waitFor()
        await menu.screenshot({ path: path.join(process.env.MEW_MENU_SCREENSHOTS, `menu-${width}-${dark ? 'dark' : 'light'}.png`) })
        await page.keyboard.press('Escape')
      }
      await page.locator('#modal').click()
      const dialog = page.getByRole('dialog', { name: '테스트 모달' })
      await dialog.locator('#shared').click()
      await dialog.getByRole('menu').waitFor()
      await page.keyboard.press('Escape')
      assert.equal(await dialog.isVisible(), true, 'Esc dismisses the menu above the modal')
      assert.equal(await dialog.locator('#shared').evaluate(el => el === el.ownerDocument.activeElement), true)
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
