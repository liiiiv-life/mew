import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const source = `
  import React from '${process.cwd()}/node_modules/react/index.js';
  import {createRoot} from '${process.cwd()}/node_modules/react-dom/client.js';
  import {useFocusedShortcutScope} from '${process.cwd()}/packages/shortcuts/src/index.ts';
  import {useFocusedWorkspacePanel} from '${process.cwd()}/src/hooks/use-focused-workspace-panel.ts';
  import {captureAppTabShortcuts} from '${process.cwd()}/src/utils/app-tab-shortcuts.ts';
  export {captureDesktopKeyboard} from '${process.cwd()}/src/utils/desktop-keyboard.ts';
  export {captureAppKeyboardLock,APP_KEYBOARD_KEYS} from '${process.cwd()}/src/utils/keyboard-lock.ts';
  function App(){
    useFocusedWorkspacePanel();
    const ref=React.useRef(null);
    useFocusedShortcutScope(ref,{closeTab(){window.appCloses++;return true},newTab(){window.appOpens++;return true}});
    React.useEffect(()=>{window.appReady=true;return captureAppTabShortcuts({closeEditorTab(){window.appCloses++},create(event,kind){window.creates.push(kind)}})},[]);
    return <section ref={ref} data-workspace-panel="editor" data-dock-panel="editor:a">
      <header data-dock-tab-bar>{[1,2,3].map(n=><button key={n} role="tab" aria-selected={n===1} onClick={e=>{window.selections.push(n);for(const b of e.currentTarget.parentElement.children)b.setAttribute('aria-selected',String(b===e.currentTarget))}}>Tab {n}</button>)}</header>
      <input id="editor"/>
    </section>
  }
  export function mountApp(){const root=createRoot(document.querySelector('#mount'));root.render(<App/>);return ()=>root.unmount()}
`
let bundle: Promise<string> | undefined
function keyboardBundle() {
  return bundle ??= build({ input: 'virtual:keyboard.tsx', write: false, platform: 'browser', output: { format: 'iife', name: 'KeyboardCapture' },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'fixture', resolveId: id => id === 'virtual:keyboard.tsx' ? id : undefined, load: id => id === 'virtual:keyboard.tsx' ? source : undefined }],
  }).then(result => result.output.find(item => item.type === 'chunk')!.code)
}

test('remote viewport captures shortcuts, locks fullscreen keys and releases on focus/close', { skip: !domBrowserExecutable() }, async () => {
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage()
    await page.route('http://localhost/keyboard', route => route.fulfill({ contentType: 'text/html', body: '<button id="tool">Tool</button><div id="stage" tabindex="0">Remote</div>' }))
    await page.goto('http://localhost/keyboard')
    await page.addScriptTag({ content: await keyboardBundle() })
    await page.evaluate(`
      window.events=[];window.keyboardStatus=[];window.locks=0;window.unlocks=0;window.copies=0;window.pastes=0;window.full=false;
      Object.defineProperty(document,'fullscreenElement',{get:()=>window.full?document.documentElement:null});
      window.cleanup=KeyboardCapture.captureDesktopKeyboard({
        input:{key:(...args)=>events.push(args),release:()=>events.push(['release'])},
        target:el=>el===document.querySelector('#stage'),detected(){},
        copy:async()=>{window.copies++},paste:async()=>{window.pastes++},status:value=>window.keyboardStatus.push(value),
        keyboard:{lock:async()=>{window.locks++},unlock:()=>{window.unlocks++}}
      });
    `)
    const stage = page.locator('#stage')
    await stage.focus()
    for (const combo of ['Control+w', 'Meta', 'Escape', 'F6', 'Tab']) await page.keyboard.press(combo)
    assert.equal(await page.locator('#stage').evaluate(el => el.ownerDocument.activeElement === el), true)
    const keys = await page.evaluate('window.events') as unknown[][]
    for (const code of ['KeyW', 'MetaLeft', 'Escape', 'F6', 'Tab']) assert.ok(keys.some(e => e[0] === code && e[1] === true), code)
    await page.keyboard.press('Control+v')
    assert.equal(await page.evaluate('window.pastes'), 1)
    assert.ok(!(await page.evaluate('window.events') as unknown[][]).some(e => e[0] === 'KeyV'))
    await page.keyboard.press('Control+c')
    await page.waitForFunction('window.copies===1')
    await page.evaluate('window.full=true;document.dispatchEvent(new Event("fullscreenchange"))')
    await page.waitForFunction('window.keyboardStatus.at(-1)==="locked"')
    await page.locator('#tool').focus()
    assert.equal(await page.evaluate('window.unlocks'), 1)
    await stage.focus()
    await page.waitForFunction('window.locks===2')
    await page.evaluate('window.cleanup()')
    const before = await page.evaluate('window.events.length')
    await page.keyboard.press('a')
    assert.equal(await page.evaluate('window.events.length'), before)
    await page.evaluate(`
      const options={input:{key(){},release(){}},target:el=>el===document.querySelector('#stage'),detected(){},copy:async()=>{},paste:async()=>{},status:value=>window.keyboardStatus.push(value)};
      window.deniedCleanup=KeyboardCapture.captureDesktopKeyboard({...options,keyboard:{lock:()=>Promise.reject(new Error('Permission denied')),unlock(){}}});
    `)
    await page.waitForFunction('window.keyboardStatus.at(-1)==="denied"')
    await page.evaluate(`
      window.deniedCleanup(); window.pendingLocks=[]; window.ownerUnlocks=0;
      const keyboard={lock:()=>new Promise(resolve=>window.pendingLocks.push(resolve)),unlock(){window.ownerUnlocks++}};
      const options={input:{key(){},release(){}},target:el=>el===document.querySelector('#stage'),detected(){},copy:async()=>{},paste:async()=>{},status(){},keyboard};
      const oldCleanup=KeyboardCapture.captureDesktopKeyboard(options);
      oldCleanup(); window.latestCleanup=KeyboardCapture.captureDesktopKeyboard(options);
      window.pendingLocks[1](); window.pendingLocks[0]();
    `)
    await page.waitForFunction('window.ownerUnlocks===1')
    await page.evaluate('window.latestCleanup()')
    assert.equal(await page.evaluate('window.ownerUnlocks'), 2, 'late approval from a closed capture cannot unlock its replacement')

  } finally { await browser.close() }
})

test('remote keyboard precedes mounted app shortcuts, restores app lock and forwards repeats and paste fallback', { skip: !domBrowserExecutable(), timeout: 25_000 }, async () => {
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    await page.route('http://localhost/keyboard', route => route.fulfill({ contentType: 'text/html', body: '<div id="mount"></div><button id="tool">Tool</button><div role="dialog"><input id="modal"><div id="stage" tabindex="0">Remote</div></div>' }))
    await page.goto('http://localhost/keyboard')
    await page.addScriptTag({ content: await keyboardBundle() })
    await page.evaluate(`
      window.events=[];window.keyboardStatus=[];window.locks=[];window.unlocks=0;window.appCloses=0;window.appOpens=0;window.creates=[];window.selections=[];window.full=true;
      Object.defineProperty(document,'fullscreenElement',{get:()=>window.full?document.documentElement:null});
      window.keyboard={lock:async keys=>{window.locks.push(keys??'all')},unlock(){window.unlocks++}};
      window.stopApp=KeyboardCapture.mountApp();window.stopLock=KeyboardCapture.captureAppKeyboardLock(window.keyboard);
    `)
    await page.waitForFunction('window.appReady')
    const editor = page.locator('#editor'), stage = page.locator('#stage')
    await editor.focus()
    for (const combo of ['Control+n', 'Control+t', 'Meta+n']) await page.keyboard.press(combo)
    assert.equal(await page.evaluate('window.appOpens'), 3)
    for (const combo of ['Control+w', 'Control+Shift+w']) await page.keyboard.press(combo)
    assert.equal(await page.evaluate('window.appCloses'), 2)
    await page.keyboard.press('Control+Shift+n')
    assert.deepEqual(await page.evaluate('window.creates'), ['folder'])
    for (const combo of ['Control+2', 'Meta+3', 'Control+Tab', 'Control+Shift+Tab', 'Control+PageUp', 'Control+PageDown']) await page.keyboard.press(combo)
    assert.deepEqual(await page.evaluate('window.selections'), [2, 3, 1, 3, 2, 3])
    await page.locator('#modal').focus()
    for (const combo of ['Control+w', 'Control+n', 'Control+Shift+n', 'Control+2', 'Control+Tab']) await page.keyboard.press(combo)
    assert.equal(await page.evaluate('window.appCloses'), 2)
    assert.equal(await page.evaluate('window.appOpens'), 3)
    assert.deepEqual(await page.evaluate('window.creates'), ['folder'])
    assert.deepEqual(await page.evaluate('window.selections'), [2, 3, 1, 3, 2, 3])

    // App capture listeners are already mounted: the remote route must still win.
    await stage.focus()
    await page.evaluate(`window.pasteMode='success';window.pasteAllowed=[];
      window.stopRemote=KeyboardCapture.captureDesktopKeyboard({
        input:{key:(...args)=>window.events.push(args),release:()=>window.events.push(['release'])},
        target:el=>el===document.querySelector('#stage'),detected(){},copy:async()=>{},
        paste:async allowed=>{if(window.pasteMode==='pending')await new Promise(resolve=>window.finishPaste=resolve);window.pasteAllowed.push(allowed());if(window.pasteMode==='throw')throw new Error('Clipboard denied');return window.pasteMode!=='false'},
        status:value=>window.keyboardStatus.push(value),keyboard:window.keyboard
      });window.events=[];`)
    await page.waitForFunction('window.keyboardStatus.at(-1)==="locked"')
    assert.equal(await page.evaluate('window.locks.at(-1)'), 'all')
    const combos = ['Control+w', 'Control+n', 'Control+Shift+n', 'Control+t', 'Control+2', 'Control+Tab', 'Control+Shift+Tab', 'Control+PageUp', 'Control+PageDown', 'Alt+n', 'Alt+2', 'Meta+w', 'Escape', 'F6', 'Tab', 'Insert', 'Numpad1', 'NumpadAdd', 'NumpadEnter']
    for (const combo of combos) await page.keyboard.press(combo)
    const keys = await page.evaluate('window.events') as unknown[][]
    for (const code of ['KeyW', 'KeyN', 'KeyT', 'Digit2', 'Tab', 'PageUp', 'PageDown', 'Escape', 'F6', 'Insert', 'Numpad1', 'NumpadAdd', 'NumpadEnter']) {
      assert.ok(keys.some(e => e[0] === code && e[1] === true), `${code} down`)
      assert.ok(keys.some(e => e[0] === code && e[1] === false), `${code} up`)
    }
    assert.equal(await page.evaluate('window.appCloses'), 2)
    assert.equal(await page.evaluate('window.appOpens'), 3)
    assert.equal(await stage.evaluate(el => el.ownerDocument.activeElement === el), true)
    await page.evaluate('window.events=[]')
    await page.keyboard.down('a'); await page.keyboard.down('a'); await page.keyboard.down('a'); await page.keyboard.up('a')
    assert.deepEqual(await page.evaluate('window.events'), [['KeyA', true], ['KeyA', false], ['KeyA', true], ['KeyA', false], ['KeyA', true], ['KeyA', false]])
    await page.locator('#tool').focus()
    await page.keyboard.down('b'); await stage.focus(); await page.evaluate('window.events=[]')
    await page.keyboard.down('b'); await page.keyboard.down('b'); await page.keyboard.up('b')
    assert.deepEqual(await page.evaluate('window.events'), [['KeyB', true], ['KeyB', false], ['KeyB', true], ['KeyB', false]], 'repeats start forwarding even when the initial keydown happened outside the remote viewport')
    const pastes = await page.evaluate('window.pasteAllowed.length')
    await page.evaluate('window.events=[]')
    await page.keyboard.press('Control+Shift+v')
    assert.deepEqual(await page.evaluate('window.events'), [['ControlLeft', true], ['ShiftLeft', true], ['KeyV', true], ['KeyV', false], ['ShiftLeft', false], ['ControlLeft', false]])
    assert.equal(await page.evaluate('window.pasteAllowed.length'), pastes, 'modified paste combinations retain their remote meaning')
    for (const mode of ['false', 'throw']) {
      await page.evaluate(`window.events=[];window.pasteMode=${JSON.stringify(mode)}`)
      await page.keyboard.press('Control+v')
      await page.waitForFunction('window.events.some(e=>e[0]==="KeyV"&&e[1]===false)')
      const pasteKeys = await page.evaluate('window.events') as unknown[][]
      assert.ok(pasteKeys.findIndex(e => e[0] === 'ControlLeft' && e[1] === true) < pasteKeys.findIndex(e => e[0] === 'KeyV' && e[1] === true))
    }
    await page.evaluate('window.events=[];window.pasteMode="pending"')
    await page.keyboard.press('Control+v')
    await page.waitForFunction('!!window.finishPaste')
    await page.locator('#tool').focus()
    await page.evaluate('window.finishPaste()')
    await page.waitForFunction('window.pasteAllowed.at(-1)===false')
    assert.ok(!(await page.evaluate('window.events') as unknown[][]).some(e => e[0] === 'KeyV'), 'late clipboard approval cannot paste after focus moves')
    assert.deepEqual(await page.evaluate('window.locks.at(-1)'), await page.evaluate('KeyboardCapture.APP_KEYBOARD_KEYS'), 'returning from remote restores app shortcuts')
    await page.keyboard.press('Control+n')
    assert.deepEqual(await page.evaluate('window.creates'), ['folder', 'file'])
    await stage.focus()
    await page.keyboard.down('Control')
    await page.evaluate('window.dispatchEvent(new Event("blur"))')
    assert.deepEqual((await page.evaluate('window.events') as unknown[][]).at(-1), ['release'])
    await page.keyboard.up('Control')
    await page.evaluate('window.dispatchEvent(new Event("focus"))')
    assert.equal(await page.evaluate('window.locks.at(-1)'), 'all')
    await page.evaluate('window.stopRemote()')
    assert.deepEqual(await page.evaluate('window.locks.at(-1)'), await page.evaluate('KeyboardCapture.APP_KEYBOARD_KEYS'))
    await page.evaluate('window.full=false;document.dispatchEvent(new Event("fullscreenchange"));window.stopLock();window.stopApp()')
    assert.ok((await page.evaluate('window.unlocks') as number) > 0)
  } finally { await browser.close() }
})
