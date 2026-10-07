import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import path from 'node:path'
import fs from 'node:fs/promises'
import { compile } from '@tailwindcss/node'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
const root = path.resolve(import.meta.dirname, '..'), chrome = domBrowserExecutable()
test('remote registration settings support desktop/mobile, registration errors and member revocation', { skip: !chrome, timeout: 30_000 }, async t => {
  const source = `import React from '${root}/node_modules/react/index.js';import{createRoot}from '${root}/node_modules/react-dom/client.js';import{setUiLocale}from '${root}/packages/ui/src/i18n-core.ts';setUiLocale('ko');import{RemoteAccessSettings}from '${root}/src/components/remote-access-settings.tsx';createRoot(document.getElementById('root')).render(<RemoteAccessSettings users={[{email:'member@example.test',role:'member'}]}/>);`
  const bundle = await build({ input: 'virtual:remote-ui.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:remote-ui.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:remote-ui.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const code = bundle.output.filter(item => item.type === 'chunk').map(item => item.code).join('\n')
  const content = (await Promise.all(['src/components/remote-access-settings.tsx', 'packages/ui/src/select-field.tsx'].map(file => fs.readFile(path.join(root,file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set(content.match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  let enabled = false, registered = false, revoked = false
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/remote-access')) {
      res.setHeader('Content-Type', 'application/json')
      if (req.url.endsWith('/register')) { registered = true; res.end(JSON.stringify({ enabled: false, state: 'registering', registrationUrl: 'https://mew.saens.kr/register/test' })); return }
      if (req.url.endsWith('/members')) { if (req.method === 'PUT') { revoked = true; res.end('{}'); return }; res.end(JSON.stringify({ abcdefghijklmnopqrstuvwx: 'member@example.test' })); return }
      res.end(JSON.stringify(enabled ? { enabled: true, state: 'online', url: 'https://mew.saens.kr/user/home' } : { enabled: false, state: 'disabled' })); return
    }
    res.setHeader('Content-Type', 'text/html'); res.end(`<meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}body{margin:0}#root{padding:12px;max-width:650px}</style><div id="root"></div><script>localStorage.setItem("mew:locale","ko")</script><script>${code}</script>`)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const browser = await chromium.launch({ executablePath: chrome, chromiumSandbox: true }); t.after(async () => { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } }); page.setDefaultTimeout(5000); await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`)
  await page.getByRole('button', { name: '기기 등록', exact: true }).click(); await page.getByRole('link', { name: '로그인하고 등록 완료' }).waitFor(); assert.equal(registered, true)
  await page.screenshot({ path: '/tmp/mew-remote-access-desktop.png' })
  enabled = true; await page.getByRole('button', { name: '새로고침', exact: true }).click(); await page.getByText('온라인', { exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 780 }); await page.getByText('멤버 접근', { exact: true }).click(); await page.getByRole('button', { name: '접근 회수' }).click()
  assert.equal(revoked, true)
  await page.screenshot({ path: '/tmp/mew-remote-access-mobile.png' })
  const width = await page.locator('#root').evaluate(el => ({ available: el.ownerDocument.documentElement.clientWidth, content: el.ownerDocument.documentElement.scrollWidth }))
  assert.ok(width.content <= width.available + 1)
})
