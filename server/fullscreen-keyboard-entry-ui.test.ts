import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'rolldown'
import { chromium, type Page } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

// Headless has no Android keyboard compositor. This fixture verifies native API
// ordering and viewport recovery; it does not reproduce the OS's black stripe.
const fixtureSource = `
import {requestFullscreenWithKeyboard,fullscreenKeyboardOverlay} from '${new URL('../packages/ui/src/virtual-keyboard.ts', import.meta.url).pathname}';
import {observeWorkspaceViewport} from '${new URL('../src/utils/workspace-viewport.ts', import.meta.url).pathname}';
const previous=new URLSearchParams(location.search).get('previous')==='true';
const unsupported=new URLSearchParams(location.search).has('unsupported');
const keyboard=new EventTarget();let overlay=previous,fullscreen=null,resolveNative,rejectNative;
window.nativeCalls=[];window.nativeRequests=[];window.requests=[];window.overlayWrites=[];window.requestState='idle';window.options={navigationUI:'hide'};
Object.defineProperties(keyboard,{
 overlaysContent:{get:()=>overlay,set:value=>{overlay=value;window.overlayWrites.push(value)}},
 boundingRect:{value:new DOMRect(),writable:true},
});
if(!unsupported)Object.defineProperty(navigator,'virtualKeyboard',{value:keyboard,configurable:true});
else Object.defineProperty(navigator,'virtualKeyboard',{value:undefined,configurable:true});
Object.defineProperty(document,'fullscreenElement',{get:()=>fullscreen,configurable:true});
document.documentElement.requestFullscreen=function(options){
 window.nativeCalls.push({overlay:keyboard.overlaysContent,active:navigator.userActivation.isActive,pending:fullscreenKeyboardOverlay(),sameOptions:options===window.options});
 if(window.throwNative)throw new TypeError('fullscreen rejected');
 return new Promise((resolve,reject)=>{resolveNative=resolve;rejectNative=reject;window.nativeRequests.push({resolve,reject})});
};
window.resolveFullscreen=()=>{fullscreen=document.documentElement;document.dispatchEvent(new Event('fullscreenchange'));resolveNative()};
window.rejectFullscreen=()=>rejectNative(new TypeError('fullscreen rejected'));
window.exitFullscreen=()=>{fullscreen=null;document.dispatchEvent(new Event('fullscreenchange'))};
window.resizeViewport=height=>{
 Object.defineProperty(window,'innerHeight',{value:height,configurable:true});
 Object.defineProperty(visualViewport,'height',{value:height,configurable:true});
 window.dispatchEvent(new Event('resize'));visualViewport.dispatchEvent(new Event('resize'));
};
window.coverWithKeyboard=height=>{keyboard.boundingRect=new DOMRect(0,height?844-height:0,height?innerWidth:0,height);keyboard.dispatchEvent(new Event('geometrychange'))};
window.fixtureState=()=>({overlay:keyboard.overlaysContent,pending:fullscreenKeyboardOverlay(),request:window.requestState,fullscreen:!!document.fullscreenElement});
window.stopViewport=observeWorkspaceViewport();
const button=document.querySelector('#fullscreen');
button.addEventListener('pointerdown',event=>event.preventDefault());
button.addEventListener('click',()=>{
 const index=window.requests.length;window.requests.push('pending');window.requestState='pending';
 requestFullscreenWithKeyboard(document.documentElement,window.options).then(()=>{window.requestState='resolved';window.requests[index]='resolved'},()=>{window.requestState='rejected';window.requests[index]='rejected'});
});
window.fixtureReady=true;
`

test('fullscreen keyboard policy is prepared before native entry and survives pending viewport changes', { skip: !domBrowserExecutable(), timeout: 40_000 }, async t => {
  const bundle = await build({
    input: 'virtual:fullscreen-keyboard-entry', write: false, platform: 'browser', output: { format: 'iife' },
    plugins: [{ name: 'fullscreen-keyboard-entry-fixture',
      resolveId(id) { if (id === 'virtual:fullscreen-keyboard-entry') return id },
      load(id) { if (id === 'virtual:fullscreen-keyboard-entry') return fixtureSource },
    }],
  })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  const createPage = async ({ width = 390, touch = true, query = '', frame = false } = {}) => {
    const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: touch })
    page.setDefaultTimeout(3000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('https://fullscreen-entry.test/**', route => {
      if (new URL(route.request().url()).pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
      const body = frame && new URL(route.request().url()).pathname === '/'
        ? '<iframe src="/frame" allow="fullscreen"></iframe>'
        : '<main><header><button id="fullscreen">Fullscreen</button></header><section></section><footer><textarea aria-label="Message"></textarea><button>Send</button></footer></main><script src="/app.js"></script>'
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,interactive-widget=resizes-content"><style>html,body{height:100%;margin:0;overflow:hidden}iframe{height:100%;width:100%;border:0}main{height:var(--app-height,100dvh);display:flex;flex-direction:column}header{height:40px;flex-shrink:0}section{flex:1;min-height:0}footer{height:140px;display:flex;flex-shrink:0}textarea{flex:1;min-width:0}</style>${body}` })
    })
    await page.goto(`https://fullscreen-entry.test/${query}`)
    const app = frame ? page.frames().find(item => item.url() === 'https://fullscreen-entry.test/frame')! : page.mainFrame()
    await app.waitForFunction('window.fixtureReady')
    return { page, app, errors }
  }
  const flushResize = async (page: Page) => {
    await page.locator('main').evaluate(async el => {
      const win = el.ownerDocument.defaultView!
      win.dispatchEvent(new win.Event('resize'))
      win.visualViewport!.dispatchEvent(new win.Event('resize'))
      await new Promise<void>(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())))
    })
  }
  try {
    await t.test('the native call sees overlay enabled in its original user activation, including a wide touch layout', async () => {
      for (const width of [390, 980]) {
        const { page, app, errors } = await createPage({ width })
        try {
          await app.getByRole('textbox').focus()
          await app.getByRole('button', { name: 'Fullscreen', exact: true }).click()
          assert.deepEqual(await app.evaluate('window.nativeCalls'), [{ overlay: true, active: true, pending: true, sameOptions: true }])
          await flushResize(page)
          assert.deepEqual(await app.evaluate('window.fixtureState()'), { overlay: true, pending: true, request: 'pending', fullscreen: false }, 'pending native entry survives observer animation frames')
          assert.equal(await app.getByRole('textbox').evaluate(el => el.ownerDocument.activeElement === el), true, 'preparation keeps the input focused')
          await app.evaluate('window.rejectFullscreen()')
          await app.waitForFunction('window.requestState === "rejected"')
          assert.deepEqual(errors, [])
        } finally { await page.close() }
      }
    })

    await t.test('rejected or synchronously throwing entry restores the original policy and visible focused input', async () => {
      for (const previous of [false, true]) {
        for (const synchronous of [false, true]) {
          const { page, app, errors } = await createPage({ query: `?previous=${previous}` })
          try {
            await app.getByRole('textbox').focus()
            await app.evaluate(`window.throwNative=${synchronous}`)
            await app.getByRole('button', { name: 'Fullscreen', exact: true }).click()
            if (!synchronous) {
              await flushResize(page)
              await app.evaluate('window.rejectFullscreen()')
            }
            await app.waitForFunction('window.requestState === "rejected"')
            await flushResize(page)
            assert.deepEqual(await app.evaluate('window.fixtureState()'), { overlay: previous, pending: false, request: 'rejected', fullscreen: false })
            assert.equal(await app.locator('main').evaluate(el => el.getBoundingClientRect().bottom), 844)
            assert.equal(await app.getByRole('textbox').evaluate(el => el.ownerDocument.activeElement === el), true)
            assert.deepEqual(errors, [])
          } finally { await page.close() }
        }
      }
    })

    await t.test('one rejected concurrent request cannot restore policy while another entry is pending', async () => {
      for (const secondSucceeds of [false, true]) {
        const { page, app, errors } = await createPage()
        try {
          await app.getByRole('textbox').focus()
          const button = app.getByRole('button', { name: 'Fullscreen', exact: true })
          await button.click()
          await button.click()
          await app.evaluate('window.nativeRequests[0].reject(new TypeError("first rejection"))')
          await app.waitForFunction('window.requests[0] === "rejected"')
          await flushResize(page)
          assert.deepEqual(await app.evaluate('window.requests'), ['rejected', 'pending'])
          assert.equal(await app.evaluate('window.fixtureState().overlay && window.fixtureState().pending'), true)
          if (secondSucceeds) {
            await app.evaluate('window.resolveFullscreen()')
            await app.waitForFunction('window.requests[1] === "resolved"')
            await flushResize(page)
            assert.equal(await app.evaluate('window.fixtureState().overlay && window.fixtureState().fullscreen'), true)
            await app.evaluate('window.exitFullscreen()')
          } else {
            await app.evaluate('window.nativeRequests[1].reject(new TypeError("second rejection"))')
            await app.waitForFunction('window.requests[1] === "rejected"')
          }
          await flushResize(page)
          assert.equal(await app.evaluate('window.fixtureState().overlay || window.fixtureState().pending'), false)
          assert.equal(await app.getByRole('textbox').evaluate(el => el.ownerDocument.activeElement === el), true)
          assert.deepEqual(errors, [])
        } finally { await page.close() }
      }
    })

    await t.test('successful entry handles keyboard cycles, keyboard-open entry and exit without losing focus', async () => {
      for (const alreadyOpen of [false, true]) {
        const { page, app, errors } = await createPage()
        try {
          const input = app.getByRole('textbox')
          await input.fill('Keep this input focused')
          if (alreadyOpen) {
            await app.evaluate('window.resizeViewport(480);window.coverWithKeyboard(364)')
            await app.waitForFunction('document.querySelector("main").getBoundingClientRect().bottom === 480')
          }
          await app.getByRole('button', { name: 'Fullscreen', exact: true }).click()
          await flushResize(page)
          assert.equal(await app.evaluate('window.fixtureState().overlay'), true)
          await app.evaluate('window.resizeViewport(844);window.resolveFullscreen()')
          await app.waitForFunction('window.requestState === "resolved"')
          for (const height of [364, 0, 364, 0]) {
            await app.evaluate(`window.coverWithKeyboard(${height})`)
            const bottom = 844 - height
            await app.waitForFunction(`document.querySelector('main').getBoundingClientRect().bottom === ${bottom}`)
            for (const control of [input, app.getByRole('button', { name: 'Send', exact: true })]) {
              const box = (await control.boundingBox())!
              assert.ok(box.y >= 0 && box.y + box.height <= bottom, 'input and send remain above keyboard geometry')
            }
            assert.equal(await input.evaluate(el => el.ownerDocument.activeElement === el), true)
          }
          await app.evaluate('window.coverWithKeyboard(364);window.resizeViewport(480);window.exitFullscreen()')
          await app.waitForFunction('window.fixtureState().overlay === false && !window.fixtureState().pending')
          await app.waitForFunction('document.querySelector("main").getBoundingClientRect().bottom === 480')
          await app.evaluate('window.coverWithKeyboard(0);window.resizeViewport(844)')
          await app.waitForFunction('document.querySelector("main").getBoundingClientRect().bottom === 844')
          assert.equal(await input.inputValue(), 'Keep this input focused')
          assert.equal(await input.evaluate(el => el.ownerDocument.activeElement === el), true)
          assert.deepEqual(errors, [])
        } finally { await page.close() }
      }
    })

    await t.test('mouse, child frames and browsers without VirtualKeyboard keep native entry behavior', async () => {
      for (const options of [{ width: 1280, touch: false }, { frame: true }, { query: '?unsupported' }]) {
        const { page, app, errors } = await createPage(options)
        try {
          await app.getByRole('button', { name: 'Fullscreen', exact: true }).click()
          const calls = await app.evaluate('window.nativeCalls') as { overlay: boolean; active: boolean; sameOptions: boolean }[]
          assert.equal(calls.length, 1)
          assert.equal(calls[0]!.overlay, false, 'excluded contexts do not enable keyboard overlays before native entry')
          assert.equal(calls[0]!.active, true)
          assert.equal(calls[0]!.sameOptions, true)
          await app.evaluate('window.rejectFullscreen()')
          await app.waitForFunction('window.requestState === "rejected"')
          assert.equal(await app.evaluate('window.fixtureState().overlay'), false)
          assert.deepEqual(errors, [])
        } finally { await page.close() }
      }
    })
  } finally { await browser.close() }
})
