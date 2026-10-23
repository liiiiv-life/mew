import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('top-level keyboard geometry reaches a fullscreen app through two launcher frames', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const bundle = await build({ input: {
    keyboard: new URL('../packages/ui/src/virtual-keyboard.ts', import.meta.url).pathname,
    workspace: new URL('../src/utils/workspace-viewport.ts', import.meta.url).pathname,
  }, write: false, platform: 'browser', output: { format: 'esm', entryFileNames: '[name].js' } })
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const [width, touch] of [[390, true], [980, true], [1280, false]] as const) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: touch })
      page.setDefaultTimeout(5000)
      const warnings: string[] = []
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => { if (message.text().includes('top level browsing context')) warnings.push(message.text()) })
      await page.addInitScript(`
        const keyboard=new EventTarget();let overlay=false;
        Object.defineProperties(keyboard,{overlaysContent:{get:()=>window===top&&overlay,set:value=>{if(window!==top)throw Error('child cannot set keyboard policy');overlay=value}},boundingRect:{value:new DOMRect(),writable:true}});
        Object.defineProperty(navigator,'virtualKeyboard',{value:keyboard});
        window.coverWithKeyboard=height=>{keyboard.boundingRect=new DOMRect(0,0,height?innerWidth:0,height);keyboard.dispatchEvent(new Event('geometrychange'))};
      `)
      await page.route('https://*.test/**', route => {
        const url = new URL(route.request().url())
        const chunk = bundle.output.find(item => item.type === 'chunk' && `/${item.fileName}` === url.pathname)
        if (chunk?.type === 'chunk') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        const body = url.pathname === '/' ? `
          <iframe allow="fullscreen"></iframe><script type="module">
          import {observeHostedKeyboard} from '/keyboard.js';
          window.addEventListener('message',event=>{if(event.source!==document.querySelector('iframe').contentWindow||event.origin!=='https://app.test'||!event.ports[0])return;const port=event.ports[0];window.stopKeyboard=observeHostedKeyboard(geometry=>port.postMessage(geometry));});
          document.querySelector('iframe').src='https://app.test/launch';
          </script>` : url.pathname === '/launch' ? `
          <iframe allow="fullscreen" src="/app"></iframe><script>
          const relay=new MessageChannel();let appPort,last;relay.port1.onmessage=({data})=>{last=data;appPort?.postMessage(data)};
          window.addEventListener('message',event=>{if(event.source!==document.querySelector('iframe').contentWindow||event.origin!==location.origin||!event.ports[0])return;appPort=event.ports[0];if(last)appPort.postMessage(last)});
          parent.postMessage('ready','https://central.test',[relay.port2]);
          </script>` : `
          <main><button id="fullscreen">Fullscreen</button><section></section><footer><textarea aria-label="Message"></textarea><button>Send</button></footer></main><script type="module">
          import {installHostedKeyboard,virtualKeyboardViewportBottom} from '/keyboard.js';
          import {observeWorkspaceViewport} from '/workspace.js';
          const keyboard=installHostedKeyboard(),channel=new MessageChannel();channel.port1.onmessage=({data})=>{keyboard.update(data);window.keyboardBottom=virtualKeyboardViewportBottom()};
          parent.postMessage('ready',location.origin,[channel.port2]);window.stopViewport=observeWorkspaceViewport();
          document.querySelector('#fullscreen').onclick=()=>document.documentElement.requestFullscreen();
          </script>`
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{height:100%;margin:0;overflow:hidden}iframe{width:100%;height:100%;border:0}main{height:var(--app-height,100dvh);display:flex;flex-direction:column;background:#142737;color:#eee}section{flex:1;min-height:0}footer{height:140px;display:flex;flex-shrink:0}textarea{flex:1}</style>${body}` })
      })
      await page.goto('https://central.test/')
      const app = page.frameLocator('iframe').frameLocator('iframe')
      await app.getByRole('button', { name: 'Fullscreen', exact: true }).click()
      await page.waitForFunction(`navigator.virtualKeyboard.overlaysContent === ${touch} && !!document.fullscreenElement`)
      await app.getByRole('textbox').fill('Fullscreen keyboard')
      await page.evaluate('coverWithKeyboard(364)')
      const bottom = touch ? 480 : 844
      const appFrame = page.frames().find(frame => frame.url() === 'https://app.test/app')!
      await appFrame.waitForFunction(`document.querySelector('main').getBoundingClientRect().bottom === ${bottom}`, undefined, { timeout: 5000 })
      for (const control of [app.getByRole('textbox'), app.getByRole('button', { name: 'Send', exact: true })]) {
        const bounds = (await control.boundingBox())!
        assert.ok(bounds.y + bounds.height <= bottom)
        assert.equal(await control.evaluate(el => {
          const box = el.getBoundingClientRect()
          return el.ownerDocument.elementFromPoint(box.x + box.width / 2, box.bottom - 1) === el
        }), true)
      }
      await page.screenshot({ path: `/tmp/mewlink-fullscreen-keyboard-${width}.png` })
      await page.evaluate('coverWithKeyboard(0)')
      await appFrame.waitForFunction("document.querySelector('main').getBoundingClientRect().bottom === 844", undefined, { timeout: 5000 })
      await app.locator('main').evaluate(el => el.ownerDocument.exitFullscreen())
      await page.waitForFunction('navigator.virtualKeyboard.overlaysContent === false')
      await page.evaluate('stopKeyboard()')
      assert.deepEqual(warnings, [])
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
