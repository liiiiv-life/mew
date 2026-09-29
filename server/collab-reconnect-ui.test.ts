import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('collab recovers stalled handshakes and sync without losing local edits', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `
import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {useCollab} from ${JSON.stringify(new URL('../src/hooks/useCollab.ts', import.meta.url).pathname)};
function Fixture(){
  const collab=useCollab('docs','file.md','owner@example.test');
  window.collab=collab;
  return <output>{collab?.connected ? 'connected' : 'waiting'}</output>;
}
const root=createRoot(document.getElementById('root'));
window.unmount=()=>root.unmount();
root.render(<Fixture/>);`
  const bundle = await build({
    input: 'virtual:collab.tsx', write: false, platform: 'browser', output: { format: 'esm' },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'collab-fixture', resolveId(id) { if (id === 'virtual:collab.tsx') return id }, load(id) { if (id === 'virtual:collab.tsx') return source } }],
  })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.clock.install()
    // Explicitly model a transport that never emits close, even when asked to close.
    await page.addInitScript(`
      window.sockets=[];
      window.WebSocket=class {
        static OPEN=1;
        readyState=0;
        constructor(){window.sockets.push(this)}
        send(){}
        close(){this.readyState=3}
        open(){this.readyState=1;this.onopen?.({})}
        message(bytes){this.onmessage?.({data:new Uint8Array(bytes).buffer})}
        disconnect(){this.readyState=3;this.onclose?.({})}
      };
    `)
    await page.route('http://mew-collab.test/**', route => route.fulfill(route.request().url().endsWith('/app.js')
      ? { contentType: 'text/javascript', body: chunk.code }
      : { contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' }))
    await page.goto('http://mew-collab.test/')
    await page.waitForFunction('window.collab && window.sockets.length === 1')
    await page.evaluate(`(() => {
      window.originalDoc=window.collab.ydoc;
      window.collab.ydoc.getText('draft').insert(0,'unsent edit');
      window.lateMessage=window.sockets[0].onmessage;
    })()`)
    await page.clock.runFor(10_300)
    assert.equal(await page.evaluate('window.sockets.length'), 2, 'a stalled CONNECTING socket must retry without waiting for close')
    await page.evaluate(`(() => {
      window.lateMessage({data:new Uint8Array([0,1,2,0,0]).buffer});
      window.sockets[1].open();
      window.sockets[1].message([0,0,1,0]);
    })()`)
    assert.equal(await page.evaluate('window.collab.synced'), false, 'late responses and syncStep1 must not complete initial sync')
    await page.clock.runFor(10_600)
    assert.equal(await page.evaluate('window.sockets.length'), 3, 'an open socket with no document response must also retry')
    await page.evaluate('window.sockets[2].open(); window.sockets[2].message([0,1,2,0,0])')
    await page.getByText('connected', { exact: true }).waitFor()
    assert.equal(await page.evaluate('window.collab.ydoc === window.originalDoc'), true)
    assert.equal(await page.evaluate("window.collab.ydoc.getText('draft').toString()"), 'unsent edit')
    await page.clock.runFor(30_000)
    assert.equal(await page.evaluate('window.sockets.length'), 3, 'successful sync cancels the deadline')
    await page.evaluate('window.sockets[2].disconnect()')
    await page.clock.runFor(300)
    assert.equal(await page.evaluate('window.sockets.length'), 4, 'successful sync resets the reconnect backoff')
    await page.evaluate('window.unmount()')
    await page.clock.runFor(20_000)
    assert.equal(await page.evaluate('window.sockets.length'), 4, 'unmount cancels pending recovery')
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
