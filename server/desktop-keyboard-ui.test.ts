import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('remote viewport captures shortcuts, locks fullscreen keys and releases on focus/close', { skip: !domBrowserExecutable() }, async () => {
  const bundle = await build({ input: 'src/utils/desktop-keyboard.ts', write: false, platform: 'browser', output: { format: 'iife', name: 'KeyboardCapture' } })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<button id="tool">Tool</button><div id="stage" tabindex="0">Remote</div>')
    await page.addScriptTag({ content: chunk.code })
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
