import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
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
import {ProjectSwitcher} from '${root}/src/components/ProjectSwitcher.tsx';
import {CommandButtonMenu} from '${root}/src/components/CommandButtonMenu.tsx';
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
 <HeaderMenu items={[{id:'copy',label:'헤더 동작',icon:<Copy/>,onSelect:action,hint:'Ctrl+C'}, {id:'disabled',label:'비활성 헤더',icon:<Copy/>,onSelect:action,disabled:true}, {id:'toggle',label:'헤더 토글',icon:<Copy/>,onSelect:action,active:true}]}/>
 <header className="flex h-9"><ProjectSwitcher paths={['/alpha','/beta']} activePath="/alpha" fallbackLabel="alpha" canOpen canChangeIcon={false} icons={{}} onActivate={action} onIconChange={()=>{}} onOpen={action}/>
 <CommandButtonMenu project=".workspace" title="명령 목록"/></header>
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
  const content = (await Promise.all(['src/components/ProjectSwitcher.tsx', 'src/components/CommandButtonMenu.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) for (const dark of [false, true]) for (const gradient of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 800 }, hasTouch: width === 390 })
      page.setDefaultTimeout(4000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-menu.test/**', route => {
        const url = new URL(route.request().url())
        if (url.pathname === '/api/cmd-buttons') return route.fulfill({ json: { buttons: [{ name: '서버 시작', command: 'echo test', session: 'fixture', running: false, oneShot: false }, { name: '서버 확인', command: 'echo ok', session: 'fixture2', running: false, oneShot: false }] } })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="ko" class="${dark ? 'dark' : ''} ${gradient ? 'theme-gradient' : ''}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
        :root{--color-surface:${dark ? '#151515' : '#fff'};--color-surface-raised:${dark ? '#252525' : '#fff'};--color-surface-hover:${dark ? '#333' : '#eee'};--color-ink:${dark ? '#eee' : '#222'};--color-ink-muted:${dark ? '#aaa' : '#666'};--color-edge:#888;--color-danger:${dark ? '#ff7676' : '#b00'};--color-accent:#679eff}
        :root{--color-surface-solid:${dark ? '#151515' : '#fff'};--color-surface-raised-solid:${dark ? '#252525' : '#fff'};--color-surface-hover-solid:${dark ? '#333' : '#eee'}}
        *{box-sizing:border-box}body{background:var(--color-surface);color:var(--color-ink);font:14px sans-serif}button{color:inherit}svg{width:16px;height:16px}
        ${css}
        .mew-action-menu{--mew-action-menu-min-width:190px}.mew-action-menu-item{gap:9px}
        .mew-dialog{background:var(--color-surface);padding:10px}
      </style><div id="root"></div><script>${bundle.output.find(item => item.type === 'chunk')!.code}</script></html>` }) })
      await page.goto('http://mew-menu.test/')
      const menu = page.getByRole('menu')
      for (const id of ['file', 'tab', 'git', 'task', 'table']) {
        await page.locator(`#${id}`).click()
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
      const headerTrigger = page.getByRole('button', { name: '메뉴', exact: true })
      await headerTrigger.click(); await menu.waitFor()
      const headerStyle = await menu.evaluate(el => {
        const view = el.ownerDocument.defaultView!, popup = view.getComputedStyle(el)
        const row = view.getComputedStyle(el.querySelector('button')!)
        return { radius: popup.borderRadius, padding: popup.padding, minWidth: popup.minWidth, rowRadius: row.borderRadius, rowPadding: row.padding, gap: row.gap, shared: el.hasAttribute('data-action-menu') }
      })
      assert.deepEqual(headerStyle, { radius: '8px', padding: '4px', minWidth: '220px', rowRadius: '4px', rowPadding: '6px 10px', gap: '8px', shared: true }, 'header uses the shared rounded dropdown variant')
      const headerRect = await menu.boundingBox(); assert.ok(headerRect)
      assert.ok(headerRect.x >= 4 && headerRect.x + headerRect.width <= width - 4)
      assert.ok(headerRect.y + headerRect.height <= (width < 768 ? 746 : 796))
      await page.keyboard.press('ArrowDown')
      assert.equal(await menu.getByRole('menuitemcheckbox', { name: '헤더 토글' }).evaluate(el => el === el.ownerDocument.activeElement), true)
      await page.keyboard.press('Home'); await page.keyboard.press('Enter')
      await menu.waitFor({ state: 'hidden' })
      assert.equal(await page.evaluate('window.actions.length'), 1)
      assert.equal(await headerTrigger.evaluate(el => el === el.ownerDocument.activeElement), true)
      await headerTrigger.click(); await page.keyboard.press('Tab'); await menu.waitFor({ state: 'hidden' })
      assert.equal(await headerTrigger.evaluate(el => el === el.ownerDocument.activeElement), true)
      await headerTrigger.click(); await menu.waitFor(); await page.locator('#outside').click()
      assert.equal(await page.locator('#outside').textContent(), 'Outside 0')
      if (process.env.MEW_MENU_SCREENSHOTS) {
        await fs.mkdir(process.env.MEW_MENU_SCREENSHOTS, { recursive: true })
        await headerTrigger.click(); await menu.waitFor()
        await menu.screenshot({ path: path.join(process.env.MEW_MENU_SCREENSHOTS, `header-${width}-${dark ? 'dark' : 'light'}-${gradient ? 'gradient' : 'solid'}.png`) })
        await page.keyboard.press('Escape')
      }
      const metrics = async (selector: string) => page.locator(selector).evaluate(el => {
        const view = el.ownerDocument.defaultView!, surface = view.getComputedStyle(el)
        const row = el.querySelector('button')!, item = view.getComputedStyle(row)
        return { width: el.getBoundingClientRect().width, font: item.font, lineHeight: item.lineHeight,
          height: row.getBoundingClientRect().height, padding: item.padding, gap: item.gap,
          radius: surface.borderRadius, surfacePadding: surface.padding,
          background: surface.backgroundColor, backdrop: surface.backdropFilter }
      })
      await headerTrigger.click(); await menu.waitFor()
      const reference = await metrics('[data-header-menu]')
      assert.equal(reference.backdrop, gradient || !dark ? 'blur(6px)' : 'none')
      await page.keyboard.press('Escape')
      await page.locator('[data-project-switcher]').click(); await menu.waitFor()
      assert.deepEqual(await metrics('[data-action-menu]'), reference, 'project dropdown matches hamburger dimensions and typography')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+e')
      const commands = page.locator('[data-cmd-overlay]')
      await commands.getByRole('button', { name: '서버 시작', exact: true }).waitFor()
      const commandRect = await commands.boundingBox(); assert.ok(commandRect)
      assert.ok(commandRect.x >= 4 && commandRect.x + commandRect.width <= width - 4)
      assert.ok(commandRect.y >= 4 && commandRect.y + commandRect.height <= 800)
      assert.deepEqual(await metrics('[data-cmd-overlay]'), reference, 'command dropdown matches hamburger dimensions and typography')
      assert.equal(await commands.getByRole('button', { name: '서버 시작', exact: true }).evaluate(el => el === el.ownerDocument.activeElement), true)
      assert.equal(await commands.textContent().then(text => text?.includes('.workspace')), false)
      await page.keyboard.press('ArrowDown')
      assert.equal(await commands.getByRole('button', { name: '서버 확인', exact: true }).evaluate(el => el === el.ownerDocument.activeElement), true)
      await page.keyboard.press('ArrowRight')
      assert.equal(await commands.getByRole('button', { name: '서버 확인 실행', exact: true }).evaluate(el => el === el.ownerDocument.activeElement), true)
      if (process.env.MEW_MENU_SCREENSHOTS) {
        await page.screenshot({ path: path.join(process.env.MEW_MENU_SCREENSHOTS, `page-${width}-${dark ? 'dark' : 'light'}-${gradient ? 'gradient' : 'solid'}.png`) })
        await commands.screenshot({ path: path.join(process.env.MEW_MENU_SCREENSHOTS, `commands-${width}-${dark ? 'dark' : 'light'}-${gradient ? 'gradient' : 'solid'}.png`) })
      }
      await page.keyboard.press('Escape'); await commands.waitFor({ state: 'hidden' })
      assert.equal(await page.getByRole('button', { name: '명령 목록', exact: true }).evaluate(el => el === el.ownerDocument.activeElement), true)
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
        await menu.screenshot({ path: path.join(process.env.MEW_MENU_SCREENSHOTS, `menu-${width}-${dark ? 'dark' : 'light'}-${gradient ? 'gradient' : 'solid'}.png`) })
        await page.keyboard.press('Escape')
      }
      await page.locator('#modal').click()
      const dialog = page.getByRole('dialog', { name: '테스트 모달' })
      await dialog.locator('#shared').click()
      await dialog.getByRole('menu').waitFor()
      await page.keyboard.press('Escape')
      assert.equal(await dialog.isVisible(), true, 'Esc dismisses the menu above the modal')
      assert.equal(await dialog.locator('#shared').evaluate(el => el === el.ownerDocument.activeElement), true)
      await dialog.getByRole('button', { name: '메뉴', exact: true }).click()
      await dialog.getByRole('menu').waitFor(); await page.keyboard.press('Escape')
      assert.equal(await dialog.isVisible(), true, 'header Esc retains modal')
      assert.equal(await dialog.getByRole('button', { name: '메뉴', exact: true }).evaluate(el => el === el.ownerDocument.activeElement), true)
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
